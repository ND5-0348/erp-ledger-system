"""Read-only inventory. Does not initialize schema, move or delete any file.

Run from backend: python scripts/backup_inventory.py
"""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text
from app.db import db
from app.config import BACKUP_DIR, LEGACY_BACKUP_DIR, settings
from app.backup import BACKUP_TABLES
from app.backup_integrity import read_payload


def inventory():
    with db() as conn:
        records=conn.execute(text('SELECT id,storage_path FROM backup_record')).mappings().all()
    registered={Path(r['storage_path']).resolve():r['id'] for r in records}
    found={p.resolve() for root in (BACKUP_DIR,LEGACY_BACKUP_DIR) for p in root.glob('*.json.gz')}
    report={'database':settings.mysql_database,'missing':[], 'unregistered':[], 'files':[]}
    report['missing']=[{'id':ident,'name':p.name} for p,ident in registered.items() if not p.is_file()]
    report['unregistered']=[p.name for p in sorted(found-set(registered))]
    for p in sorted(found):
        try:
            payload=read_payload(p,BACKUP_TABLES,settings.mysql_database)
            status='verified' if payload['format']=='erp-ledger-backup-v2' else 'legacy_unverified'
        except Exception:status='invalid_or_foreign'
        report['files'].append({'name':p.name,'registered':p in registered,'status':status})
    return report


if __name__=='__main__':print(json.dumps(inventory(),ensure_ascii=False,indent=2))
