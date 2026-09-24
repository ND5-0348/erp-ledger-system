"""All fixtures synthetic, test database/backup root guarded by conftest."""
import json
from decimal import Decimal
import pytest
from sqlalchemy import text, event
from openpyxl import Workbook
from app.db import db, engine
from app import maintenance_import as service
from app.backup import BACKUP_TABLES
from app.ledger_excel import TEMPLATE_HEADERS
from test_ledger_history import _row
from test_financial_integration import _create_order
from test_edit_conflicts import edit_headers
from fastapi.testclient import TestClient
from app.main import app


def snapshot():
    with db() as conn:
        return {t:[dict(r) for r in conn.execute(text(f'SELECT * FROM `{t}` ORDER BY id')).mappings()] for t in [*BACKUP_TABLES,'business_state']}


def source(tmp_path, monkeypatch, rows=None, layout=91):
    monkeypatch.setattr(service,'DOCS_DIR',tmp_path)
    wb=Workbook();ws=wb.active
    if layout==91: names=TEMPLATE_HEADERS
    else:
        names=[f'列{i}' for i in range(1,layout+1)]
        for i,name in ((2,'项目编号'),(13,'订单号'),(14,'项目名称')):names[i-1]=name
        if layout==96:names[18]='销售税率'
    ws.append(['合成测试']);ws.append(names)
    for row in rows or [_row('NEW','SO-NEW')]:ws.append(row)
    file=tmp_path/'synthetic.xlsx';wb.save(file);wb.close();return file


def preview(client,headers,file):
    response=client.post('/api/import/preview',json={'file_name':file.name},headers=headers)
    assert response.status_code==200,response.text
    return response.json()


def commit(client,headers,file,report,**overrides):
    return client.post('/api/import/excel',headers=headers,json={'file_name':file.name,'token':report['token'],'confirmation':'替换全部业务数据',**overrides})


def test_preview_and_replacement_epoch_and_sources(client,headers,tmp_path,monkeypatch):
    line,_=_create_order(client,headers,'OLD')
    raw=TestClient(app,raise_server_exceptions=False);old=edit_headers(raw,headers,line)
    file=source(tmp_path,monkeypatch);before=snapshot();report=preview(client,headers,file)
    assert report['token'] and report['valid_rows']==1,report
    assert snapshot()==before
    response=commit(client,headers,file,report);assert response.status_code==200,response.text
    after=snapshot()
    assert after['order_line'][0]['id']>line
    assert after['project'][0]['project_code']=='NEW'
    assert after['business_state'][0]['data_epoch']==before['business_state'][0]['data_epoch']+1
    assert after['legacy_import_audit_source'] and len(after['sales_order_number_history'])==1
    newid=after['order_line'][0]['id']
    assert raw.post(f'/api/sales/{newid}/invoices',headers=old,json={'invoice_amount':'10'}).status_code==409


@pytest.mark.parametrize('fault',['bad_zip','bad_header','last_row','missing_confirmation','changed_file','changed_data','backup','insert'])
def test_replace_failure_preserves_all_business_tables(client,headers,tmp_path,monkeypatch,fault):
    line,_=_create_order(client,headers,'KEEP')
    client.post(f'/api/sales/{line}/invoices',headers=headers,json={'invoice_amount':'10'})
    file=source(tmp_path,monkeypatch)
    report=preview(client,headers,file);assert report['token'],report
    if fault=='bad_zip':file.write_bytes(b'not excel')
    elif fault=='bad_header':file=source(tmp_path,monkeypatch,layout=87);file.write_bytes(file.read_bytes()+b'changed')
    elif fault=='last_row':
        row=_row('BAD','BAD');row[17]=-1
        file=source(tmp_path,monkeypatch,[_row('NEW','NEW'),row])
        report=preview(client,headers,file);assert report['errors'] and not report['token']
        report['token']='invalid'
    elif fault=='changed_file':file.write_bytes(file.read_bytes()+b'changed')
    elif fault=='changed_data':_create_order(client,headers,'OTHER')
    elif fault in ('backup','insert'):
        def fail(*a,**kw):raise RuntimeError('synthetic failure')
        monkeypatch.setattr(service,'create_backup' if fault=='backup' else 'import_excel',fail)
    before=snapshot();deletes=[]
    def observe(conn,cursor,statement,parameters,context,executemany):
        if statement.lstrip().upper().startswith('DELETE'):deletes.append(statement)
    event.listen(engine,'before_cursor_execute',observe)
    try: response=commit(client,headers,file,report,**({'confirmation':''} if fault=='missing_confirmation' else {}))
    finally:event.remove(engine,'before_cursor_execute',observe)
    assert response.status_code in (400,409,422,500)
    assert snapshot()==before
    assert bool(deletes)==(fault=='insert')


@pytest.mark.parametrize('layout',[87,96])
def test_legacy_layout_keeps_finance_groups_separate(client,headers,tmp_path,monkeypatch,layout):
    row=[None]*layout
    base=_row('LEGACY','SO');row[:18]=base[:18]
    row[(21 if layout==96 else 20)-1]=100
    row[(24 if layout==96 else 23)-1]='供应商'
    if layout==87:
        row[47:50]=['2026-07-01','FP',12]
    else:
        row[50:56]=['2026-07-01','FC1',11,'2026-07-02','FC2',12]
        row[56:62]=['2026-07-03','FP1',13,'2026-07-04','FP2',14]
    file=source(tmp_path,monkeypatch,[row],layout=layout)
    report=preview(client,headers,file);assert report['token'],report
    response=commit(client,headers,file,report);assert response.status_code==200,response.text
    after=snapshot()
    assert sum(r['booked_amount'] for r in after['finance_payment_entry'])==Decimal(12 if layout==87 else 27)
    assert sum(r['received_invoice_amount'] for r in after['finance_invoice_check'])==Decimal(0 if layout==87 else 23)


def test_invalid_workbooks_fail_during_readonly_preview(client,headers,tmp_path,monkeypatch):
    _create_order(client,headers,'KEEP');file=source(tmp_path,monkeypatch);before=snapshot()
    file.write_bytes(b'bad zip')
    assert client.post('/api/import/preview',headers=headers,json={'file_name':file.name}).status_code==422
    assert client.post('/api/import/preview',headers=headers,json={'file_name':'../escape.xlsx'}).status_code==400
    assert snapshot()==before


def test_import_permission_does_not_authorize_replacement(client,headers,tmp_path,monkeypatch):
    from test_import_permissions import _create_user,_login
    file=source(tmp_path,monkeypatch)
    assert _create_user(client,headers,'import_only',['ledger_import'],department_scope=[],department_all=True).status_code==200
    limited=_login(client,'import_only')
    before=snapshot()
    assert client.post('/api/import/preview',headers=limited,json={'file_name':file.name}).status_code==403
    assert client.post('/api/import/excel',headers=limited,json={'file_name':file.name,'token':'x','confirmation':'替换全部业务数据'}).status_code==403
    assert snapshot()==before
