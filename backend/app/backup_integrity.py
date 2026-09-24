"""Validate complete backup bytes before any destructive database operation."""
import gzip
import hashlib
import json
from pathlib import Path
from fastapi import HTTPException


def sha256(path: Path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): digest.update(chunk)
    return digest.hexdigest()


def read_payload(path, tables, database, *, allow_source_mapping=False):
    try:
        with gzip.open(path,'rt',encoding='utf-8') as stream: payload=json.load(stream)
    except (OSError,ValueError,EOFError) as exc:
        raise HTTPException(400,'备份文件损坏') from exc
    if not isinstance(payload,dict) or not isinstance(payload.get('tables'),dict):
        raise HTTPException(400,'备份内容格式错误')
    data=payload['tables']; fmt=payload.get('format')
    if fmt=='erp-ledger-backup-v2':
        try: manifest=json.loads(Path(str(path)+'.manifest.json').read_text(encoding='utf-8'))
        except (OSError,ValueError) as exc: raise HTTPException(400,'备份校验清单缺失或损坏') from exc
        if not isinstance(manifest,dict) or manifest.get('sha256')!=sha256(path) or manifest.get('size_bytes')!=path.stat().st_size:
            raise HTTPException(400,'备份文件摘要不符')
        if payload.get('source_database')!=database and not allow_source_mapping:
            raise HTTPException(400,'备份来源数据库不一致，拒绝恢复')
        if payload.get('schema_version')!=2 or set(data)!=set(tables):
            raise HTTPException(400,'备份表清单或结构版本不完整')
        if payload.get('row_counts')!={k:len(v) for k,v in data.items() if isinstance(v,list)}:
            raise HTTPException(400,'备份行数校验失败')
    elif fmt=='erp-ledger-backup-v1':
        optional={'sub_project','project_manager_history','sales_order_number_history','legacy_import_audit_source'}
        if set(data)-set(tables) or set(tables)-set(data)-optional:
            raise HTTPException(400,'旧版备份内容不完整')
        payload['legacy_history_missing']=any(t not in data for t in optional)
        data={**{t:[] for t in tables},**data};payload['tables']=data
    else:
        raise HTTPException(400,'不支持的备份格式')
    if any(not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows) for rows in data.values()):
        raise HTTPException(400,'备份表行格式错误')
    return payload
