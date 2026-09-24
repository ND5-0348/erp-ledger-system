from __future__ import annotations

import gzip
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .audit import write_operation_log
from .auth import CurrentUser
from .config import BACKUP_DIR, LEGACY_BACKUP_DIR, settings
from .backup_integrity import read_payload, sha256


# 业务备份表清单。顺序即恢复时的插入顺序，必须满足外键依赖：
# project_manager_history 依赖 project；sub_project 依赖 sales_order；
# order_line 依赖 sales_order 与 sub_project；sales_order_number_history 依赖 sales_order。
BACKUP_TABLES = [
    "import_batch",
    "ledger_raw_row",
    "project",
    "project_manager_history",
    "sales_order",
    "sales_order_number_history",
    "sub_project",
    "order_line",
    "purchase_info",
    "delivery_record",
    "purchase_contract",
    "purchase_invoice",
    "warehouse_entry",
    "finance_invoice_check",
    "finance_payment_entry",
    "purchase_payment",
    "sales_contract",
    "sales_invoice",
    "sales_receipt",
    "legacy_import_audit_source",
]


def _json_default(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"Unsupported backup value: {type(value).__name__}")


def _insertable_columns(conn: Connection, table_name: str) -> list[str]:
    rows = conn.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).mappings().all()
    return [str(row["Field"]) for row in rows if "GENERATED" not in str(row.get("Extra") or "").upper()]


def create_backup(conn: Connection, user: CurrentUser, backup_type: str = "manual") -> dict[str, Any]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    file_name = f"erp_ledger_{backup_type}_{timestamp}.json.gz"
    target = BACKUP_DIR / file_name
    temporary = target.with_suffix(".tmp")

    tables: dict[str, list[dict[str, Any]]] = {}
    for table_name in BACKUP_TABLES:
        columns = _insertable_columns(conn, table_name)
        column_sql = ", ".join(f"`{column}`" for column in columns)
        rows = conn.execute(text(f"SELECT {column_sql} FROM `{table_name}` ORDER BY id")).mappings().all()
        tables[table_name] = [dict(row) for row in rows]

    payload = {
        "format": "erp-ledger-backup-v2",
        "source_database": settings.mysql_database,
        "schema_version": 2,
        "row_counts": {name:len(rows) for name,rows in tables.items()},
        "created_at": datetime.now().isoformat(),
        "tables": tables,
    }
    try:
        with gzip.open(temporary, "wt", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, default=_json_default)
        manifest_tmp = Path(str(temporary)+'.manifest.json')
        manifest_tmp.write_text(json.dumps({'sha256':sha256(temporary),'size_bytes':temporary.stat().st_size}),encoding='utf-8')
        read_payload(temporary,BACKUP_TABLES,settings.mysql_database)
        temporary.replace(target)
        manifest_tmp.replace(Path(str(target)+'.manifest.json'))
    except Exception:
        temporary.unlink(missing_ok=True)
        Path(str(temporary)+'.manifest.json').unlink(missing_ok=True)
        raise

    size_bytes = target.stat().st_size
    size_label = f"{size_bytes / 1024 / 1024:.2f} MB"
    result = conn.execute(
        text(
            """
            INSERT INTO backup_record
              (file_name, file_size_label, backup_type, status, storage_path)
            VALUES
              (:file_name, :file_size_label, :backup_type, 'success', :storage_path)
            """
        ),
        {
            "file_name": file_name,
            "file_size_label": size_label,
            "backup_type": backup_type,
            "storage_path": str(target),
        },
    )
    backup_id = int(result.lastrowid or 0)
    write_operation_log(
        conn,
        user,
        "系统维护",
        "create_backup",
        f"创建数据备份 {file_name}",
        after={"backup_id": backup_id, "file_name": file_name, "size_bytes": size_bytes},
    )
    return {"id": backup_id, "file_name": file_name, "file_size_label": size_label, "verified": True}


def backup_payload(conn: Connection, backup_id: int, *, allow_source_mapping=False):
    record = conn.execute(
        text(
            """
            SELECT id, file_name, storage_path, status
            FROM backup_record
            WHERE id = :backup_id
            """
        ),
        {"backup_id": backup_id},
    ).mappings().first()
    if record is None or record["status"] != "success":
        raise HTTPException(status_code=404, detail="备份记录不存在")

    backup_path = Path(str(record["storage_path"])).resolve()
    roots = (BACKUP_DIR.resolve(),LEGACY_BACKUP_DIR.resolve())
    if not (roots[0] in backup_path.parents or backup_path.parent==roots[1]) or not backup_path.is_file():
        raise HTTPException(400,'备份文件无效或已丢失')
    payload=read_payload(backup_path,BACKUP_TABLES,settings.mysql_database,allow_source_mapping=allow_source_mapping)
    return record,payload


def verify_backup(conn: Connection, backup_id: int):
    record,payload=backup_payload(conn,backup_id)
    verified=payload['format']=='erp-ledger-backup-v2'
    return {'backup_id':backup_id,'verified':verified,'format':payload['format'],
            'message':'已校验：摘要、来源、结构和行数一致' if verified else '旧版备份：内容可读取，但缺少摘要与来源元数据，不标记为已校验'}


def restore_backup(conn: Connection, backup_id: int, user: CurrentUser, *, allow_source_mapping=False) -> dict[str, Any]:
    record,payload=backup_payload(conn,backup_id,allow_source_mapping=allow_source_mapping)
    tables=payload['tables']
    # Validate every table and column before deleting anything.
    for table_name,rows in tables.items():
        allowed=set(_insertable_columns(conn,table_name))
        if any(not row or set(row)-allowed for row in rows):
            raise HTTPException(400,f'备份表 {table_name} 字段不符合当前结构')

    for table_name in reversed(BACKUP_TABLES):
        conn.execute(text(f"DELETE FROM `{table_name}`"))

    restored_rows = 0
    for table_name in BACKUP_TABLES:
        allowed_columns = set(_insertable_columns(conn, table_name))
        for raw_row in tables[table_name]:
            if not isinstance(raw_row, dict):
                raise HTTPException(status_code=400, detail=f"备份表 {table_name} 数据格式错误")
            row = {key: value for key, value in raw_row.items() if key in allowed_columns}
            if table_name in ("ledger_raw_row", "legacy_import_audit_source") and isinstance(row.get("raw_json"), (dict, list)):
                row["raw_json"] = json.dumps(row["raw_json"], ensure_ascii=False)
            columns = list(row)
            column_sql = ", ".join(f"`{column}`" for column in columns)
            value_sql = ", ".join(f":{column}" for column in columns)
            conn.execute(text(f"INSERT INTO `{table_name}` ({column_sql}) VALUES ({value_sql})"), row)
            restored_rows += 1

    if payload.get('legacy_history_missing'):
        # Old v1 backups have no normalized subprojects/history: preserve known
        # current values only. Never invent earlier names or effective dates.
        conn.execute(text("""INSERT INTO sub_project (sales_order_id,name,customer_unit_name,end_user_name,regional_platform)
          SELECT DISTINCT so.id, COALESCE(ol.project_name,p.project_name,''),p.customer_unit_name,p.end_user_name,p.regional_platform
          FROM order_line ol JOIN sales_order so ON so.id=ol.sales_order_id JOIN project p ON p.id=so.project_id
          WHERE ol.sub_project_id IS NULL"""))
        conn.execute(text("""UPDATE order_line ol JOIN sales_order so ON so.id=ol.sales_order_id JOIN project p ON p.id=so.project_id
          JOIN sub_project sp ON sp.sales_order_id=so.id AND sp.name=COALESCE(ol.project_name,p.project_name,'')
          SET ol.sub_project_id=sp.id WHERE ol.sub_project_id IS NULL"""))
        conn.execute(text("""INSERT INTO sales_order_number_history (sales_order_id,order_no,history_order,source)
          SELECT so.id,so.order_no,1,'legacy_restore' FROM sales_order so
          WHERE NOT EXISTS (SELECT 1 FROM sales_order_number_history h WHERE h.sales_order_id=so.id)"""))
        conn.execute(text("""INSERT INTO project_manager_history (project_id,manager_name,history_order,source)
          SELECT p.id,p.account_manager,1,'legacy_restore' FROM project p WHERE p.account_manager IS NOT NULL AND p.account_manager<>''
          AND NOT EXISTS (SELECT 1 FROM project_manager_history h WHERE h.project_id=p.id)"""))

    from .edit_versions import bump_epoch
    bump_epoch(conn)

    write_operation_log(
        conn,
        user,
        "系统维护",
        "restore_backup",
        f"从备份 {record['file_name']} 恢复业务数据",
        after={"backup_id": backup_id, "restored_rows": restored_rows},
    )
    return {"restored": True, "backup_id": backup_id, "restored_rows": restored_rows, "legacy_history_missing": bool(payload.get("legacy_history_missing"))}
