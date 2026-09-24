"""A real local HTTP client disconnects; server outcome is reconciled by SHA."""
import hashlib
import http.client
import socket
import threading
import uvicorn
from app.main import app
from app.routers import orders
from test_legacy_import_flow import _row,_workbook


def test_disconnected_client_can_reconcile_committed_batch(client,headers,monkeypatch):
    entered=threading.Event();release=threading.Event();finished=threading.Event()
    original=orders._run_order_import
    def delayed(*args):
        entered.set()
        if not release.wait(10):raise RuntimeError('test barrier timed out')
        try:return original(*args)
        finally:finished.set()
    monkeypatch.setattr(orders,'_run_order_import',delayed)
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='critical',lifespan='off'))
    ready=threading.Event()
    original_startup=server.startup
    async def startup(*args,**kwargs):
        await original_startup(*args,**kwargs);ready.set()
    server.startup=startup
    thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
    assert ready.wait(10)
    content=_workbook([_row({2:'DISCONNECT',13:'DISCONNECT'})])
    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
    try:
        connection.request('POST','/api/orders/import-excel?filename=disconnect.xlsx',body=content,headers={**headers,'Content-Type':'application/octet-stream'})
        assert entered.wait(10)
        connection.close();release.set()
        assert finished.wait(20)
        # The user never received the response, but can read the committed result.
        response=client.get('/api/orders/import-status',headers=headers,params={'sha256':hashlib.sha256(content).hexdigest()})
        assert response.status_code==200,response.text
        assert len(response.json()['items'])==1 and response.json()['items'][0]['success_rows']==1
    finally:
        release.set();connection.close();server.should_exit=True;thread.join(timeout=10);sock.close()
    assert not thread.is_alive()
