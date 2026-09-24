"""Local browser QA with disposable data. Never uses the business database."""
import json
import os
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
RESUME='--resume' in sys.argv
DATABASE=json.loads((ROOT/'outputs/h3-preview-20260916/readiness-browser.json').read_text())['database'] if RESUME else 'erp_ledger_test_browser_'+uuid4().hex[:10]
if not DATABASE.startswith('erp_ledger_test_browser_'):raise RuntimeError('Unsafe browser database')
os.environ['MYSQL_DATABASE']=DATABASE
os.environ['BACKUP_ROOT']=str(Path(tempfile.gettempdir())/DATABASE)
os.environ['AUTH_SECRET']='synthetic-browser-secret-isolated-20260917'
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from conftest import initialize_test_schema,assert_safe_test_environment,TEST_PASSWORD
from app.db import engine,server_engine
from app.main import app
from app import maintenance_import
from app.routers import system
from fastapi.testclient import TestClient
from test_ledger_history import _row,_import
from openpyxl import Workbook
from app.ledger_excel import TEMPLATE_HEADERS
from sqlalchemy import text
import uvicorn

initialize_test_schema()
client=TestClient(app)
login=client.post('/api/auth/login',json={'username':'admin','password':TEST_PASSWORD})
assert login.status_code==200
headers={'Authorization':'Bearer '+login.json()['access_token']}
if not RESUME:
    response=_import(client,headers,[_row('QA-FRAME','QA-ORDER')]);assert response.status_code==200,response.text
source=Path(tempfile.gettempdir())/DATABASE;source.mkdir(exist_ok=True)
wb=Workbook();ws=wb.active;ws.append(['合成浏览器验收']);ws.append(TEMPLATE_HEADERS);ws.append(_row('QA-NEW','QA-NEW-ORDER'));wb.save(source/'synthetic.xlsx');wb.close()
maintenance_import.DOCS_DIR=source;system.DOCS_DIR=source
metadata={'database':DATABASE,'url':'http://127.0.0.1:8017','file':str(source/'synthetic.xlsx')}
(ROOT/'outputs/h3-preview-20260916/readiness-browser.json').write_text(json.dumps(metadata),encoding='utf-8')
print(json.dumps(metadata),flush=True)
try:uvicorn.run(app,host='127.0.0.1',port=8017,log_level='warning')
finally:
    engine.dispose();assert_safe_test_environment(DATABASE,os.environ['BACKUP_ROOT'])
    with server_engine.begin() as conn:conn.execute(text(f'DROP DATABASE `{DATABASE}`'))
