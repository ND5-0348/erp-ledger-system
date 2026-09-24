import json
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.db import db
from test_financial_integration import _create_order, _basic_payload


def edit_headers(client, headers, line):
    context=client.get(f'/api/history/lines/{line}',headers=headers).json()['edit_context']
    return {**headers,'X-Edit-Context':json.dumps(context)}


def test_two_editors_missing_version_and_independent_projects(client, headers):
    line,payload=_create_order(client,headers,'VERSION')
    other,other_payload=_create_order(client,headers,'INDEPENDENT')
    raw=TestClient(app,raise_server_exceptions=False)
    old=edit_headers(raw,headers,line)
    independent=edit_headers(raw,headers,other)
    assert raw.put(f'/api/orders/{line}',headers=headers,json=payload).status_code==422
    response=raw.put(f'/api/orders/{line}',headers=old,json={**payload,'goods_name':'A保存'})
    assert response.status_code==200,response.text
    conflict=raw.put(f'/api/orders/{line}',headers=old,json={**payload,'goods_name':'B覆盖'})
    assert conflict.status_code==409,conflict.text
    assert conflict.json()['detail']['code']=='EDIT_CONFLICT'
    assert raw.put(f'/api/orders/{other}',headers=independent,json={**other_payload,'goods_name':'独立保存'}).status_code==200
    with db() as conn:
        assert conn.execute(text('SELECT goods_name FROM order_line WHERE id=:id'),{'id':line}).scalar_one()=='A保存'


def test_financial_write_invalidates_order_and_batch_is_atomic(client, headers):
    line,payload=_create_order(client,headers,'VERSION-FINANCE')
    other,other_payload=_create_order(client,headers,'VERSION-BATCH')
    raw=TestClient(app,raise_server_exceptions=False)
    a=edit_headers(raw,headers,line)
    b=edit_headers(raw,headers,other)
    context=json.loads(a['X-Edit-Context']);context['projects'].update(json.loads(b['X-Edit-Context'])['projects'])
    batch_headers={**headers,'X-Edit-Context':json.dumps(context)}
    invoice=raw.post(f'/api/sales/{line}/invoices',headers=a,json={'invoice_date':'2026-09-17','invoice_amount':'10'})
    assert invoice.status_code==200,invoice.text
    response=raw.put('/api/orders/batch-basic',headers=batch_headers,json={'items':[
        {**_basic_payload(payload),'order_line_id':line,'goods_name':'stale'},
        {**_basic_payload(other_payload),'order_line_id':other,'goods_name':'must rollback'}]})
    assert response.status_code==409,response.text
    with db() as conn:
        assert conn.execute(text('SELECT goods_name FROM order_line WHERE id=:id'),{'id':other}).scalar_one()==other_payload['goods_name']


def test_restore_epoch_rejects_old_editor_even_if_version_returns(client, headers):
    line,payload=_create_order(client,headers,'VERSION-RESTORE')
    raw=TestClient(app,raise_server_exceptions=False)
    old=edit_headers(raw,headers,line)
    backup=client.post('/api/backups',headers=headers)
    assert backup.status_code==200,backup.text
    assert raw.put(f'/api/orders/{line}',headers=old,json={**payload,'goods_name':'change'}).status_code==200
    response=client.post(f"/api/backups/{backup.json()['id']}/restore",headers=headers)
    assert response.status_code==200,response.text
    response=raw.put(f'/api/orders/{line}',headers=old,json=payload)
    assert response.status_code==409,response.text


def test_import_invalidates_open_editor(client, headers):
    from test_ledger_history import _import, _row
    first=_import(client,headers,[_row('VERSION-IMPORT','O')])
    assert first.status_code==200,first.text
    line=client.get('/api/orders',headers=headers).json()['items'][0]['order_line_id']
    raw=TestClient(app,raise_server_exceptions=False)
    old=edit_headers(raw,headers,line)
    response=_import(client,headers,[_row('VERSION-IMPORT','O',overrides={15:'different device'})])
    assert response.status_code==200,response.text
    response=raw.post(f'/api/sales/{line}/invoices',headers=old,json={'invoice_date':'2026-09-17','invoice_amount':'10'})
    assert response.status_code==409,response.text


def test_preview_draft_does_not_increment_but_commit_rejects_changed_baseline(client,headers):
    from test_legacy_import_flow import _row,_workbook
    from app.edit_versions import line_context
    line,payload=_create_order(client,headers,'PREVIEW-VERSION')
    content=_workbook([_row({2:payload['project_code'],5:payload['account_manager'],13:payload['order_no'],15:'new device'})])
    with db() as conn:before=line_context(conn,[line])
    preview=client.post('/api/orders/import-preview?filename=version.xlsx',headers=headers,content=content)
    assert preview.status_code==200,preview.text
    with db() as conn:assert line_context(conn,[line])==before
    response=client.put(f'/api/orders/{line}',headers=headers,json={**payload,'goods_name':'changed'})
    assert response.status_code==200,response.text
    response=client.post(f"/api/orders/import-preview/{preview.json()['session_id']}/commit",headers=headers,content=content)
    assert response.status_code==409,response.text


def test_preview_rejected_after_restore_even_for_new_project(client,headers):
    from test_legacy_import_flow import _row,_workbook
    _create_order(client,headers,'BEFORE-RESTORE')
    backup=client.post('/api/backups',headers=headers).json()['id']
    content=_workbook([_row({2:'PREVIEW-NEW'})])
    preview=client.post('/api/orders/import-preview?filename=new.xlsx',headers=headers,content=content)
    assert preview.status_code==200,preview.text
    assert client.post(f'/api/backups/{backup}/restore',headers=headers).status_code==200
    response=client.post(f"/api/orders/import-preview/{preview.json()['session_id']}/commit",headers=headers,content=content)
    assert response.status_code==409,response.text
