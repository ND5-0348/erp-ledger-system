import gzip
import json
from pathlib import Path
import pytest
from sqlalchemy import text,event
from app.db import db,engine
from app.backup import BACKUP_TABLES
from app.backup_integrity import sha256
from test_maintenance_import import snapshot
from test_financial_integration import _create_order


def backup_file(client,headers):
    response=client.post('/api/backups',headers=headers);assert response.status_code==200,response.text
    ident=response.json()['id']
    with db() as conn:
        path=Path(conn.execute(text('SELECT storage_path FROM backup_record WHERE id=:id'),{'id':ident}).scalar_one())
    return ident,path


def rewrite(path,payload):
    with gzip.open(path,'wt',encoding='utf-8') as stream:json.dump(payload,stream)
    Path(str(path)+'.manifest.json').write_text(json.dumps({'sha256':sha256(path),'size_bytes':path.stat().st_size}),encoding='utf-8')


@pytest.mark.parametrize('fault',['gzip','sha','manifest_type','row_count','source','missing_table','column','path'])
def test_bad_backup_rejected_before_delete(client,headers,tmp_path,fault):
    _create_order(client,headers,'KEEP');ident,path=backup_file(client,headers)
    with gzip.open(path,'rt',encoding='utf-8') as stream:payload=json.load(stream)
    if fault=='gzip':path.write_bytes(b'broken gzip')
    elif fault=='sha':path.write_bytes(path.read_bytes()+b'changed')
    elif fault=='manifest_type':Path(str(path)+'.manifest.json').write_text('[]')
    elif fault=='path':
        foreign=tmp_path/'outside.json.gz';foreign.write_bytes(path.read_bytes())
        with db() as conn:conn.execute(text('UPDATE backup_record SET storage_path=:p WHERE id=:id'),{'p':str(foreign),'id':ident})
    else:
        if fault=='row_count':payload['row_counts']['project']+=1
        elif fault=='source':payload['source_database']='other_database'
        elif fault=='missing_table':del payload['tables']['sales_order_number_history']
        elif fault=='column':payload['tables']['project'][0]['unknown_column']=1
        rewrite(path,payload)
    before=snapshot();deletes=[]
    def observe(conn,cursor,statement,parameters,context,executemany):
        if statement.lstrip().upper().startswith('DELETE'):deletes.append(statement)
    event.listen(engine,'before_cursor_execute',observe)
    try:response=client.post(f'/api/backups/{ident}/restore',headers=headers)
    finally:event.remove(engine,'before_cursor_execute',observe)
    assert response.status_code==400,response.text
    assert snapshot()==before and not deletes


def test_restore_sql_failure_rolls_back_and_v1_has_no_verification_claim(client,headers):
    _create_order(client,headers,'KEEP');ident,path=backup_file(client,headers);before=snapshot()
    def fail(conn,cursor,statement,parameters,context,executemany):
        if statement.lstrip().startswith('INSERT INTO `sales_order`'):raise RuntimeError('synthetic restore fault')
    event.listen(engine,'before_cursor_execute',fail)
    try:response=client.post(f'/api/backups/{ident}/restore',headers=headers)
    finally:event.remove(engine,'before_cursor_execute',fail)
    assert response.status_code==500 and snapshot()==before
    with gzip.open(path,'rt',encoding='utf-8') as stream:payload=json.load(stream)
    payload['format']='erp-ledger-backup-v1'
    for t in ('sub_project','project_manager_history','sales_order_number_history','legacy_import_audit_source'):del payload['tables'][t]
    for row in payload['tables']['order_line']:row.pop('sub_project_id',None)
    for row in payload['tables']['project']:row.pop('version',None)
    rewrite(path,payload)
    verify=client.get(f'/api/backups/{ident}/verify',headers=headers)
    assert verify.status_code==200 and verify.json()['verified'] is False
    response=client.post(f'/api/backups/{ident}/restore',headers=headers)
    assert response.status_code==200,response.text
    after=snapshot();assert len(after['order_line'])==1 and after['order_line'][0]['sub_project_id']
    assert after['sales_order_number_history'][0]['source']=='legacy_restore'
    assert after['business_state'][0]['data_epoch']==before['business_state'][0]['data_epoch']+1


def test_new_backup_restores_provenance_and_all_phases(client,headers):
    line,_=_create_order(client,headers,'SOURCE')
    for index in range(4):
        response=client.post(f'/api/sales/{line}/invoices',headers=headers,json={'invoice_amount':'10','invoice_date':f'2026-07-0{index+1}'})
        assert response.status_code==200,response.text
    with db() as conn:conn.execute(text("INSERT INTO legacy_import_audit_source (session_id,source_sha256,excel_row_no,raw_json) VALUES ('synthetic',:sha,3,:raw)"),{'sha':'a'*64,'raw':json.dumps({'original':'A/B/C','revision':['A','B','C']})})
    before=snapshot();ident,path=backup_file(client,headers)
    assert client.get(f'/api/backups/{ident}/verify',headers=headers).json()['verified'] is True
    client.delete(f'/api/sales/invoices/{before["sales_invoice"][0]["id"]}',headers=headers)
    response=client.post(f'/api/backups/{ident}/restore',headers=headers);assert response.status_code==200,response.text
    after=snapshot()
    for table in BACKUP_TABLES:assert after[table]==before[table],table
