"""Local logical dump/restore proof, synthetic databases only, no production data.

Uses the installed MySQL command-line clients. This is separate from the Linux
8.4 two-disk script; successful 5.7 results do not certify 8.4 deployment.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
source='erp_ledger_test_dump_'+uuid4().hex[:10];target=source+'_restore'
os.environ['MYSQL_DATABASE']=source;os.environ['BACKUP_ROOT']=str(Path(tempfile.gettempdir())/source)
os.environ['AUTH_SECRET']='synthetic-dump-drill-'+uuid4().hex
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from conftest import initialize_test_schema,assert_safe_test_environment,TEST_PASSWORD
from app.config import settings
from app.db import db,engine,server_engine
from app.main import app
from sqlalchemy import text,create_engine
from fastapi.testclient import TestClient
from test_ledger_history import _row,_import

assert_safe_test_environment(source,os.environ['BACKUP_ROOT'])
assert_safe_test_environment(target,os.environ['BACKUP_ROOT'])
dump=shutil.which('mysqldump');mysql=shutil.which('mysql')
if not dump or not mysql:raise RuntimeError('MySQL CLI tools unavailable')
temp=Path(tempfile.mkdtemp(prefix='erp-dump-drill-'));cnf=temp/'client.cnf';sql=temp/'synthetic.sql'
def option(value):return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('\n','\\n')+'"'
cnf.write_text('[client]\nhost='+option(settings.mysql_host)+'\nport='+str(settings.mysql_port)+'\nuser='+option(settings.mysql_user)+'\npassword='+option(settings.mysql_password)+'\n',encoding='utf-8');cnf.chmod(0o600)
report={'source':source,'target':target};start=time.monotonic();restored=None
try:
    initialize_test_schema()
    client=TestClient(app);login=client.post('/api/auth/login',json={'username':'admin','password':TEST_PASSWORD})
    headers={'Authorization':'Bearer '+login.json()['access_token']}
    response=_import(client,headers,[_row('SYNTHETIC','SOURCE')]);assert response.status_code==200
    with db() as conn:
        report['mysql_version']=conn.execute(text('SELECT VERSION()')).scalar()
        tables=conn.execute(text("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")).scalars().all()
        counts={t:conn.execute(text(f'SELECT COUNT(*) FROM `{t}`')).scalar_one() for t in tables}
        views=conn.execute(text('SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()')).scalars().all()
        source_totals=dict(conn.execute(text('SELECT SUM(order_value) sales,SUM(total_received) receipts FROM v_order_line_finance')).mappings().one())
    result=subprocess.run([dump,'--defaults-extra-file='+str(cnf),'--single-transaction','--routines','--events','--triggers','--hex-blob','--set-gtid-purged=OFF','--result-file='+str(sql),source],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    if result.returncode:raise RuntimeError('mysqldump failed (details suppressed)')
    with server_engine.begin() as conn:conn.execute(text(f'CREATE DATABASE `{target}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'))
    # Only synthetic generated identifiers are remapped in this local proof.
    # For real data, use an isolated server retaining the original database name.
    content=sql.read_bytes().replace(('`'+source+'`').encode(),('`'+target+'`').encode())
    result=subprocess.run([mysql,'--defaults-extra-file='+str(cnf),target],input=content,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    if result.returncode:raise RuntimeError('mysql restore failed (details suppressed)')
    engine.dispose()
    with server_engine.begin() as conn:conn.execute(text(f'DROP DATABASE `{source}`'))
    restored=create_engine(engine.url.set(database=target))
    with restored.begin() as conn:
        actual={t:conn.execute(text(f'SELECT COUNT(*) FROM `{t}`')).scalar_one() for t in tables}
        assert actual==counts
        for view in views:conn.execute(text(f'SELECT * FROM `{view}` LIMIT 1')).all()
        totals=dict(conn.execute(text('SELECT SUM(order_value) sales,SUM(total_received) receipts FROM v_order_line_finance')).mappings().one());assert totals==source_totals
        from app.auth import verify_password
        stored=conn.execute(text("SELECT password_hash FROM erp_user WHERE username='admin'")).scalar_one();assert verify_password(TEST_PASSWORD,stored)
    report.update({'all_table_counts_match':True,'view_count':len(views),'table_count':len(tables),'view_totals_match':True,'restored_login_password_verified':True,'dump_bytes':len(content),'elapsed_seconds':round(time.monotonic()-start,3)})
    (ROOT/'outputs/h3-preview-20260916/full-restore-drill.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)
finally:
    cnf.unlink(missing_ok=True)
    if restored:restored.dispose()
    engine.dispose()
    with server_engine.begin() as conn:
        for name in (source,target):conn.execute(text(f'DROP DATABASE IF EXISTS `{name}`'))
