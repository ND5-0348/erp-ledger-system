"""Import history and conservative, reversible batch undo."""
import hashlib
import hmac
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text, bindparam
from .auth import CurrentUser, require_permission, can_access_department
from .backup import create_backup, BACKUP_TABLES
from .db import db
from .write_guard import business_write
from .config import settings
from .serializers import clean_rows, clean_row
from .import_review import dumps, unpack, summary, batch_lines, batch_fingerprint, assert_batch_access
from .edit_versions import bump_epoch
from .audit import write_operation_log

router = APIRouter(prefix='/api/import-batches', tags=['import batches'])


def record_review(conn,result,backup_id):
    review = {k:result[k] for k in ('layout','summary','warnings') if k in result}
    review.setdefault('summary',summary(conn,result['batch_id']))
    conn.execute(text('UPDATE import_batch SET review_json=CAST(:report AS JSON),baseline_sha256=:fingerprint,pre_import_backup_id=:backup WHERE id=:id'),
                 {'id':result['batch_id'],'report':dumps(review),'fingerprint':batch_fingerprint(conn,result['batch_id']),'backup':backup_id})


def get_batch(conn,batch_id,user):
    row = conn.execute(text('''SELECT b.*,u.display_name AS imported_by_name,k.file_name AS backup_file FROM import_batch b
        LEFT JOIN erp_user u ON u.id=b.uploaded_by LEFT JOIN backup_record k ON k.id=b.pre_import_backup_id WHERE b.id=:id'''),{'id':batch_id}).mappings().first()
    if not row:
        raise HTTPException(404,'批次不存在')
    assert_batch_access(conn,row,user)
    return row


def present(conn,row):
    data = {k:row[k] for k in ('id','source_file_name','uploaded_at','success_rows','status','imported_by_name','backup_file','pre_import_backup_id')}
    report = unpack(row['review_json']) or {}
    data['summary'] = report.get('summary') or summary(conn,row['id'])
    data['summary_is_current'] = not bool(report.get('summary'))
    data['layout'] = report.get('layout')
    return clean_row(data)


@router.get('')
def list_batches(offset:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100),user:CurrentUser=Depends(require_permission('ledger_import'))):
    with db() as conn:
        rows = conn.execute(text('''SELECT b.*,u.display_name AS imported_by_name,k.file_name AS backup_file FROM import_batch b
            LEFT JOIN erp_user u ON u.id=b.uploaded_by LEFT JOIN backup_record k ON k.id=b.pre_import_backup_id ORDER BY b.id DESC''')).mappings().all()
        allowed = []
        for row in rows:
            try: assert_batch_access(conn,row,user)
            except HTTPException: continue
            allowed.append(row)
        return {'total':len(allowed),'items':[present(conn,r) for r in allowed[offset:offset+limit]]}


def assessment(conn,batch,user):
    reasons=[]
    if 'system_admin' not in user.permissions:
        reasons.append('仅管理员可撤销整批导入')
    if batch['status']!='completed':
        reasons.append('该批次已撤销或尚未导入完成')
    if not batch['baseline_sha256']:
        reasons.append('历史批次没有导入完成时的快照，无法确认后续修改，暂不支持自动撤销')
    reused = conn.execute(text('''SELECT COUNT(*) FROM order_line ol JOIN ledger_raw_row r ON r.id=ol.raw_row_id
        JOIN sales_order so ON so.id=ol.sales_order_id WHERE r.import_batch_id=:id AND (so.import_batch_id IS NULL OR so.import_batch_id<>:id)'''),{'id':batch['id']}).scalar_one()
    if reused:
        reasons.append('该批次追加到了既有订单，需核对共享字段后逐条处理，不能自动撤销')
    current = batch_fingerprint(conn,batch['id'])
    if batch['baseline_sha256'] and current != batch['baseline_sha256']:
        reasons.append('导入后存在修改、删除或关联新增，自动撤销已禁用，请核对后处理')
    token=hmac.new(settings.auth_secret.encode(),f"{batch['id']}:{current}".encode(),hashlib.sha256).hexdigest() if not reasons else None
    return {'can_revert':not reasons,'reasons':reasons,'token':token,'line_count':len(batch_lines(conn,batch['id'])),
            'message':'仅从业务列表移除本批次数据，底层记录、原文件和账号保留。撤销前自动备份；需要恢复时可在系统管理中选择该备份，恢复前须核对备份后的其他修改。'}


@router.get('/{batch_id}')
def batch_detail(batch_id:int,user:CurrentUser=Depends(require_permission('ledger_import'))):
    with db() as conn:
        row=get_batch(conn,batch_id,user)
        return {**present(conn,row),'warnings':(unpack(row['review_json']) or {}).get('warnings',[]),'undo':assessment(conn,row,user)}


class RevertRequest(BaseModel):
    token:str=Field(min_length=64,max_length=64)
    confirmation:str


@router.post('/{batch_id}/revert')
def revert_batch(batch_id:int,payload:RevertRequest,user:CurrentUser=Depends(require_permission('system_admin'))):
    with business_write() as conn:
        batch=get_batch(conn,batch_id,user)
        check=assessment(conn,batch,user)
        if not check['can_revert'] or not hmac.compare_digest(payload.token,check['token'] or ''):
            raise HTTPException(409, '批次状态已变化或存在后续修改，未撤销，请重新核对')
        if payload.confirmation != f'撤销批次 {batch_id}':
            raise HTTPException(422,'请输入页面显示的撤销确认文字')
        backup=create_backup(conn,user,'pre_batch_revert')
        lines=batch_lines(conn,batch_id)
        ids=[r['id'] for r in lines]
        projects=sorted({r['project_id'] for r in lines})
        orders=sorted({r['sales_order_id'] for r in lines})
        subprojects=sorted({r['sub_project_id'] for r in lines if r['sub_project_id']})
        for table in BACKUP_TABLES[BACKUP_TABLES.index('purchase_info'):]:
            if table=='legacy_import_audit_source':continue
            conn.execute(text(f'UPDATE {table} SET deleted_at=NOW() WHERE order_line_id IN :ids AND deleted_at IS NULL').bindparams(bindparam('ids',expanding=True)),{'ids':ids})
        conn.execute(text('UPDATE order_line SET deleted_at=NOW() WHERE id IN :ids AND deleted_at IS NULL').bindparams(bindparam('ids',expanding=True)),{'ids':ids})
        for table,values,relation in [('sub_project',subprojects,'ol.sub_project_id'),('sales_order',orders,'ol.sales_order_id')]:
            for value in values:
                count=conn.execute(text(f'SELECT COUNT(*) FROM order_line ol WHERE {relation}=:id AND ol.deleted_at IS NULL'),{'id':value}).scalar_one()
                if not count:conn.execute(text(f'UPDATE {table} SET deleted_at=NOW() WHERE id=:id'),{'id':value})
        for project in projects:
            count=conn.execute(text('SELECT COUNT(*) FROM sales_order WHERE project_id=:id AND deleted_at IS NULL'),{'id':project}).scalar_one()
            if not count:conn.execute(text('UPDATE project SET deleted_at=NOW() WHERE id=:id'),{'id':project})
        conn.execute(text("UPDATE import_batch SET status='reverted' WHERE id=:id"),{'id':batch_id})
        bump_epoch(conn)
        write_operation_log(conn,user,'数据导入','revert_import_batch',f'撤销批次 {batch_id}，停用 {len(ids)} 条明细',after={'batch_id':batch_id,'backup_id':backup['id']})
        return {'batch_id':batch_id,'reverted_rows':len(ids),'backup_id':backup['id']}
