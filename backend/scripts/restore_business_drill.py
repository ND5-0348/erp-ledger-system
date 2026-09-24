"""Explicit offline source mapping into a NEW disposable test database only.

Never exposes source mapping through the web restore API.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from uuid import uuid4

parser=argparse.ArgumentParser()
parser.add_argument('--file',type=Path,required=True)
parser.add_argument('--database',required=True)
parser.add_argument('--allow-source-mapping',action='store_true',required=True)
args=parser.parse_args()
if not re.fullmatch(r'erp_ledger_test_restore_[A-Za-z0-9_]+',args.database):
    parser.error('Only a new erp_ledger_test_restore_* database is allowed')
os.environ['MYSQL_DATABASE']=args.database
os.environ['BACKUP_ROOT']=str(Path(tempfile.gettempdir())/args.database)
os.environ['AUTH_SECRET']='offline-drill-'+uuid4().hex
os.environ['DEFAULT_ADMIN_PASSWORD']=uuid4().hex
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text
from app.config import BACKUP_DIR
from app.db import server_engine,initialize_schema,db
from app.auth import ensure_default_admin
from app.backup import BACKUP_TABLES,restore_backup
from app.backup_integrity import read_payload
from app.write_guard import business_write

payload=read_payload(args.file,BACKUP_TABLES,args.database,allow_source_mapping=True)
with server_engine.connect() as conn:
    if conn.execute(text('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name'),{'name':args.database}).first():
        parser.error('Target database already exists; refusing to overwrite it')
initialize_schema();ensure_default_admin()
BACKUP_DIR.mkdir(parents=True,exist_ok=True)
target=BACKUP_DIR/args.file.name;shutil.copyfile(args.file,target)
manifest=Path(str(args.file)+'.manifest.json')
if manifest.is_file():shutil.copyfile(manifest,Path(str(target)+'.manifest.json'))
from app.auth import current_user_from_token
# Use the normal login/user resolver; no production identity is reused.
from app.main import app
from fastapi.testclient import TestClient
login=TestClient(app).post('/api/auth/login',json={'username':'admin','password':os.environ['DEFAULT_ADMIN_PASSWORD']})
user=current_user_from_token(login.json()['access_token'])
with business_write() as conn:
    ident=conn.execute(text("INSERT INTO backup_record (file_name,file_size_label,backup_type,status,storage_path) VALUES (:name,'drill','offline_drill','success',:path)"),{'name':target.name,'path':str(target)}).lastrowid
    result=restore_backup(conn,ident,user,allow_source_mapping=True)
print(json.dumps({'target_database':args.database,'source_database':payload.get('source_database'),'result':result},ensure_ascii=False))
