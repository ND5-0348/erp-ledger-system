from test_ledger_history import _import,_row
from test_maintenance_import import snapshot
from test_financial_integration import _create_order


def test_complete_error_report_and_rollback(client,headers):
    _create_order(client,headers,'KEEP');before=snapshot()
    rows=[]
    for i in range(31):
        row=_row(f'BAD-{i}',f'O-{i}');row[17]=-1;rows.append(row)
    response=_import(client,headers,rows)
    assert response.status_code==422,response.text
    report=response.json()['report']
    assert report['error_count']==31 and len(report['errors'])==31
    assert report['errors'][-1]['row']==33 and report['errors'][-1]['column']
    assert snapshot()==before


def test_success_includes_batch_and_file_digest(client,headers):
    response=_import(client,headers,[_row('P','SO')]);assert response.status_code==200,response.text
    assert response.json()['batch_id']>0 and len(response.json()['source_sha256'])==64
    status=client.get('/api/orders/import-status',params={'sha256':response.json()['source_sha256']},headers=headers)
    assert status.status_code==200 and status.json()['items'][0]['id']==response.json()['batch_id']
