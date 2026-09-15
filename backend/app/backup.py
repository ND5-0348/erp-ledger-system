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
from .config import BACKUP_DIR


# 业务备份表清单。顺序即恢复时的插入顺序，必须满足外键依赖：
# sub_project 依赖 sales_order，order_line 依赖 sales_order 与 sub_project。
BACKUP_TABLES = [
    "import_batch",
    "ledger_raw_row",
    "project",
    "sales_order",
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
        "format": "erp-ledger-backup-v1",
        "created_at": datetime.now().isoformat(),
        "tables": tables,
    }
    try:
        with gzip.open(temporary, "wt", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, default=_json_default)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
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
    return {"id": backup_id, "file_name": file_name, "file_size_label": size_label}


def restore_backup(conn: Connection, backup_id: int, user: CurrentUser) -> dict[str, Any]:
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
    backup_root = BACKUP_DIR.resolve()
    if backup_root not in backup_path.parents or not backup_path.is_file():
        raise HTTPException(status_code=400, detail="备份文件无效或已丢失")

    try:
        with gzip.open(backup_path, "rt", encoding="utf-8") as stream:
            payload = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="备份文件损坏") from exc

    if payload.get("format") != "erp-ledger-backup-v1" or not isinstance(payload.get("tables"), dict):
        raise HTTPException(status_code=400, detail="不支持的备份格式")
    tables = payload["tables"]
    if set(tables) != set(BACKUP_TABLES):
        raise HTTPException(status_code=400, detail="备份内容不完整")

    for table_name in reversed(BACKUP_TABLES):
        conn.execute(text(f"DELETE FROM `{table_name}`"))

    restored_rows = 0
    for table_name in BACKUP_TABLES:
        allowed_columns = set(_insertable_columns(conn, table_name))
        for raw_row in tables[table_name]:
            if not isinstance(raw_row, dict):
                raise HTTPException(status_code=400, detail=f"备份表 {table_name} 数据格式错误")
            row = {key: value for key, value in raw_row.items() if key in allowed_columns}
            if table_name == "ledger_raw_row" and isinstance(row.get("raw_json"), (dict, list)):
                row["raw_json"] = json.dumps(row["raw_json"], ensure_ascii=False)
            columns = list(row)
            column_sql = ", ".join(f"`{column}`" for column in columns)
            value_sql = ", ".join(f":{column}" for column in columns)
            conn.execute(text(f"INSERT INTO `{table_name}` ({column_sql}) VALUES ({value_sql})"), row)
            restored_rows += 1

    write_operation_log(
        conn,
        user,
        "系统维护",
        "restore_backup",
        f"从备份 {record['file_name']} 恢复业务数据",
        after={"backup_id": backup_id, "restored_rows": restored_rows},
    )
    return {"restored": True, "backup_id": backup_id, "restored_rows": restored_rows}
