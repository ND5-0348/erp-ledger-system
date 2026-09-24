"""Synthetic 20k exercise in a disposable guarded MySQL database only."""
import ctypes
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
DATABASE='erp_ledger_test_benchmark_'+uuid4().hex[:10]
os.environ['MYSQL_DATABASE']=DATABASE
os.environ['BACKUP_ROOT']=str(Path(tempfile.gettempdir())/DATABASE)
os.environ['AUTH_SECRET']='synthetic-benchmark-secret-not-production-20260917'
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from conftest import initialize_test_schema,assert_safe_test_environment,TEST_PASSWORD,clear_business_data
from app.db import db,engine,server_engine
from app.main import app
from app.backup import BACKUP_TABLES
from app.ledger_excel import TEMPLATE_HEADERS
from fastapi.testclient import TestClient
from sqlalchemy import text,event
from openpyxl import Workbook

LARGE='--large' in sys.argv
PAGINATION='--pagination' in sys.argv
OUTPUT=ROOT/('outputs/h3-preview-20260916/benchmark-pagination.json' if PAGINATION else 'outputs/h3-preview-20260916/benchmark-large.json' if LARGE else 'outputs/h3-preview-20260916/benchmark-small.json')
report={'database':DATABASE,'environment':'local synthetic MySQL, in-process ASGI clients','runs':[]}


def save():OUTPUT.write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str),encoding='utf-8')


def workbook(n,invalid=False):
    wb=Workbook(write_only=True);ws=wb.create_sheet('Sheet1');ws.append(['合成性能演练']);ws.append(TEMPLATE_HEADERS)
    for i in range(n):
        row=[None]*91
        fields={1:'全额',2:f'P-{"BAD-" if invalid else ""}{i//100:05}',3:'销售部',4:'测试分公司',5:'合成人员',6:'2026-07-01',7:'商品销售',8:'常规',9:'测试组',
                10:'合成客户'+('长文本'*20),11:'合成最终用户',12:'测试平台',13:f'O-{i//2:06}',14:'合成子项目',15:'同一物资',16:'测试规格',17:'台',18:2,21:100,24:f'供应商{i%2}',27:30,
                31:1,44:'2026-07-02',45:f'PI-{i}',46:20,74:'2026-07-03',75:f'SI-{i}',76:50,79:'2026-07-04',80:f'RC-{i}',81:10}
        for pos,value in fields.items():row[pos-1]=value
        if invalid and i==n-1:row[17]=-1
        ws.append(row)
    ws.append(['AIGC content identification','AIGC synthetic footer'])
    stream=BytesIO();wb.save(stream);wb.close();return stream.getvalue()


def fingerprint():
    import hashlib
    with db() as conn:
        return {t:hashlib.sha256(json.dumps([dict(r) for r in conn.execute(text(f'SELECT * FROM `{t}` ORDER BY id')).mappings()],default=str,sort_keys=True).encode()).hexdigest() for t in [*BACKUP_TABLES,'business_state']}


def peak_memory():
    if os.name!='nt':return None
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong)]+[(name,ctypes.c_size_t) for name in ['PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage']]
    data=Counters();data.cb=ctypes.sizeof(data)
    if not ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(-1),ctypes.byref(data),data.cb):return None
    return round(data.PeakWorkingSetSize/1024/1024,2)


try:
    initialize_test_schema();clear_business_data()
    client=TestClient(app,raise_server_exceptions=False)
    response=client.post('/api/auth/login',json={'username':'admin','password':TEST_PASSWORD});assert response.status_code==200
    headers={'Authorization':'Bearer '+response.json()['access_token']}
    with db() as conn:report['mysql_version']=conn.execute(text('SELECT VERSION()')).scalar()
    scenarios=[(600,False)] if PAGINATION else [(500,False),(500,True)] + ([(20000,False),(20000,True)] if LARGE else [])
    for n,invalid in scenarios:
        if not invalid:clear_business_data()
        before=fingerprint();content=workbook(n,invalid);started=threading.Event();cancel=threading.Event();health=[];run_tag=uuid4().hex
        def observe(conn,cursor,statement,parameters,context,executemany):
            if 'INSERT INTO import_batch' in statement:conn.info['benchmark_run']=run_tag;started.set()
            if cancel.is_set() and conn.info.get('benchmark_run')==run_tag:raise RuntimeError('Synthetic benchmark exceeded 300 seconds')
        event.listen(engine,'before_cursor_execute',observe)
        start=time.monotonic()
        with ThreadPoolExecutor(max_workers=1) as executor:
            future=executor.submit(client.post,'/api/orders/import-excel?filename=synthetic.xlsx',content=content,headers=headers)
            started.wait(30)
            while not future.done():
                if time.monotonic()-start>300:cancel.set()
                t=time.monotonic();check=client.get('/api/health');health.append({'seconds':round(time.monotonic()-t,3),'status':check.status_code})
                threading.Event().wait(2)
            response=future.result()
        elapsed=time.monotonic()-start;event.remove(engine,'before_cursor_execute',observe)
        run={'rows':n,'invalid_last_row':invalid,'file_bytes':len(content),'import_and_prebackup_seconds':round(elapsed,3),'http_status':response.status_code,
             'peak_process_memory_mb':peak_memory(),'health_requests':len(health),'max_health_seconds':max(r['seconds'] for r in health),'health_all_ok':all(r['status']==200 for r in health)}
        if cancel.is_set():
            run['exceeded_web_budget']=True;run['unchanged_all_tables_and_epoch']=before==fingerprint()
            assert run['unchanged_all_tables_and_epoch']
        elif invalid:
            run['unchanged_all_tables_and_epoch']=before==fingerprint();run['error_count']=response.json().get('report',{}).get('error_count')
            assert response.status_code==422 and run['unchanged_all_tables_and_epoch']
        else:
            assert response.status_code==200,f'Unexpected status {response.status_code}'
            with db() as conn:
                run['counts']={t:conn.execute(text(f'SELECT COUNT(*) FROM `{t}`')).scalar_one() for t in ('project','sales_order','order_line')}
                run['totals']=dict(conn.execute(text('SELECT SUM(order_value) sales,SUM(purchase_amount) purchases,SUM(sales_invoice_amount) invoices,SUM(total_received) receipts FROM v_order_line_finance')).mappings().one())
                run['database_bytes']=conn.execute(text('SELECT SUM(DATA_LENGTH+INDEX_LENGTH) FROM information_schema.TABLES WHERE TABLE_SCHEMA=:db'),{'db':DATABASE}).scalar()
            assert run['counts']=={'project':n//100,'sales_order':n//2,'order_line':n}
            assert run['totals']=={'sales':200*n,'purchases':60*n,'invoices':50*n,'receipts':10*n}
            total=0
            for offset in range(0,n,500):
                page=client.get(f'/api/orders?limit=500&offset={offset}',headers=headers);assert page.status_code==200;total+=len(page.json()['items'])
            run['all_paginated_rows']=total;assert total==n
        report['runs'].append(run);save();print(json.dumps(run,default=str),flush=True)
        if cancel.is_set():break
except Exception as exc:
    report['failure']=type(exc).__name__+': '+str(exc)[:200];save();raise
finally:
    engine.dispose();assert_safe_test_environment(DATABASE,os.environ['BACKUP_ROOT'])
    with server_engine.begin() as conn:conn.execute(text(f'DROP DATABASE `{DATABASE}`'))
