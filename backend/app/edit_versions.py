"""Framework versions and dataset epoch, checked inside the business write lock."""
import json
from contextvars import ContextVar
from fastapi import HTTPException
from sqlalchemy import text, bindparam
from .auth import can_access_department

request_context = ContextVar('edit_request', default=None)


def read_context(conn, project_ids):
    ids=list(set(project_ids))
    epoch=conn.execute(text('SELECT data_epoch FROM business_state WHERE id=1')).scalar_one()
    versions=conn.execute(text('SELECT id, version FROM project WHERE id IN :ids').bindparams(bindparam('ids',expanding=True)),{'ids':ids}).mappings().all() if ids else []
    return {'data_epoch':int(epoch),'projects':{str(r['id']):int(r['version']) for r in versions}}


def line_context(conn, line_ids):
    ids=list(set(line_ids))
    projects=conn.execute(text('SELECT DISTINCT so.project_id FROM order_line ol JOIN sales_order so ON so.id=ol.sales_order_id WHERE ol.id IN :ids').bindparams(bindparam('ids',expanding=True)),{'ids':ids}).scalars().all() if ids else []
    return read_context(conn,projects)


def touch_project(conn, project_id):
    # Only applies in our guarded write transaction; reads/backup snapshots do not increment.
    if 'edit_touched' in conn.info:
        conn.info['edit_touched'].add(int(project_id))


def touch_line(conn, line_id):
    pid=conn.execute(text('SELECT so.project_id FROM order_line ol JOIN sales_order so ON so.id=ol.sales_order_id WHERE ol.id=:id'),{'id':line_id}).scalar()
    if pid is not None: touch_project(conn,pid)


def bump_epoch(conn):
    conn.execute(text('UPDATE business_state SET data_epoch=data_epoch+1 WHERE id=1'))


def start_write(conn):
    conn.info['edit_touched']=set()
    request=request_context.get()
    if request is None:
        return
    path=request.url.path.split('/')[2:]
    method=request.method
    ids=[]
    body=getattr(request.state,'edit_body',{})
    if not isinstance(body,dict): body={}
    protected=False
    if path and path[0]=='orders':
        if len(path)==2 and path[1].isdigit() and method in ('PUT','DELETE'):
            protected=True;ids=[int(path[1])]
        elif path==['orders','batch-basic'] and method=='PUT':
            protected=True;ids=[r.get('order_line_id') for r in body.get('items',[]) if isinstance(r,dict)]
    elif path and path[0] in ('purchases','sales'):
        if len(path)==2 and path[1]=='batch' and method=='PUT':
            protected=True;ids=[r.get('order_line_id') for r in body.get('items',[]) if isinstance(r,dict)]
        elif len(path)==3 and path[1].isdigit() and method in ('POST','PUT'):
            protected=True;ids=[int(path[1])]
        elif len(path)==3 and path[2].isdigit() and method in ('PUT','DELETE'):
            mapping={'contracts':'purchase_contract' if path[0]=='purchases' else 'sales_contract',
                     'invoices':'purchase_invoice' if path[0]=='purchases' else 'sales_invoice',
                     'payments':'purchase_payment','receipts':'sales_receipt','warehouse-entries':'warehouse_entry',
                     'finance-invoice-checks':'finance_invoice_check','finance-payments':'finance_payment_entry'}
            table=mapping.get(path[1])
            if table:
                protected=True
                ids=conn.execute(text(f'SELECT order_line_id FROM {table} WHERE id=:id AND deleted_at IS NULL'),{'id':int(path[2])}).scalars().all()
                if not ids: raise HTTPException(404,'业务记录不存在或已删除')
    elif path and path[0]=='history' and method=='POST':
        protected=True
        ids=[r.get('order_line_id') for r in body.get('items',[]) if isinstance(r,dict)] if path[-1]=='rename-orders' else [body.get('order_line_id')]
    if not protected:
        return
    ids=[i for i in ids if isinstance(i,int) and i>0]
    if not ids:
        raise HTTPException(422,'缺少待修改的订单明细')
    projects=conn.execute(text('''SELECT DISTINCT p.id,p.project_code,
      CASE WHEN ol.source_preserved=1 THEN ol.line_department ELSE p.department END AS department FROM project p
      JOIN sales_order so ON so.project_id=p.id AND so.deleted_at IS NULL
      JOIN order_line ol ON ol.sales_order_id=so.id AND ol.deleted_at IS NULL
      WHERE p.deleted_at IS NULL AND ol.id IN :ids''').bindparams(bindparam('ids',expanding=True)),{'ids':ids}).mappings().all()
    user=getattr(request.state,'current_user',None)
    if user is None or any(not can_access_department(user,r['department'],True) for r in projects):
        raise HTTPException(403,'没有目标项目的维护权限')
    try:
        supplied=json.loads(request.headers.get('X-Edit-Context',''))
        if not isinstance(supplied,dict) or not isinstance(supplied.get('projects'),dict) or not isinstance(supplied.get('data_epoch'),int): raise ValueError()
    except (ValueError,TypeError):
        raise HTTPException(422,'缺少编辑时的数据版本，请重新打开编辑界面')
    actual=read_context(conn,[r['id'] for r in projects])
    conflicts=[r['project_code'] for r in projects if supplied['projects'].get(str(r['id']))!=actual['projects'][str(r['id'])]]
    if supplied['data_epoch']!=actual['data_epoch'] or conflicts:
        raise HTTPException(409,{'code':'EDIT_CONFLICT','message':'数据已被其他操作修改或恢复。本次未保存，请保留输入，重新加载最新数据后再修改。','projects':conflicts})
    conn.info['edit_touched'].update(r['id'] for r in projects)


def finish_write(conn):
    ids=list(conn.info.get('edit_touched',set()))
    if ids:
        conn.execute(text('UPDATE project SET version=version+1 WHERE id IN :ids').bindparams(bindparam('ids',expanding=True)),{'ids':ids})
