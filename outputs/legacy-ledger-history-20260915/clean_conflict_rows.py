"""按用户要求，把框架字段冲突的行从业务文件中摘除并生成新文件。

只输出行号与冲突字段名，不打印人名/单位等业务值；原文件不改动，
结果另存为 *_已修正.xlsx，并立即在隔离验证库上复验 0 失败。
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

os.environ["MYSQL_DATABASE"] = "erp_ledger_test_verify_clean"
os.environ["BACKUP_ROOT"] = str(Path(tempfile.gettempdir()) / "erp-ledger-verify-clean")

import conftest  # noqa: E402
from openpyxl import load_workbook  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import db, engine, server_engine  # noqa: E402
from app.importer import import_excel  # noqa: E402

DESKTOP = Path.home() / "Desktop"
SOURCE = DESKTOP / "2026市场部业务台账_已填充_已去重.xlsx"
TARGET = DESKTOP / "2026市场部业务台账_已填充_已修正.xlsx"
ROW_PATTERN = re.compile(r"第 (\d+) 行")


def _run(conn, content: bytes, name: str):
    return import_excel(
        conn, reset=False, workbook_bytes=content, source_file_name=name, user=None, strict_template=True
    )


def _clear(conn) -> None:
    """按外键依赖逆序清空，ledger_raw_row 必须最后删（order_line 引用它）。"""
    for table in (
        "sales_receipt", "sales_invoice", "sales_contract", "purchase_payment",
        "finance_payment_entry", "finance_invoice_check", "warehouse_entry",
        "purchase_invoice", "purchase_contract", "delivery_record", "purchase_info",
        "order_line", "sub_project", "sales_order", "project", "ledger_raw_row", "import_batch",
    ):
        conn.execute(text(f"DELETE FROM `{table}`"))


def main() -> int:
    conftest.initialize_test_schema()
    try:
        with db() as conn:
            _clear(conn)
        with db() as conn:
            first = _run(conn, SOURCE.read_bytes(), SOURCE.name)
        print(f"原文件：成功 {first['success_rows']} / 失败 {first['failed_rows']}")

        rows_to_drop: set[int] = set()
        field_names: dict[str, int] = {}
        for message in first["errors"]:
            match = ROW_PATTERN.search(message)
            if match:
                rows_to_drop.add(int(match.group(1)))
            for label in ("客户经理", "分公司", "部门", "三级团队"):
                if f"{label}（台账为" in message:
                    field_names[label] = field_names.get(label, 0) + 1
        if not rows_to_drop:
            print("没有需要摘除的行")
            return 0
        print(f"待摘除行号：{sorted(rows_to_drop)}")
        print(f"冲突字段分布：{field_names}")

        # 生成新文件：只保留非冲突行，表头与其余行原样复制
        workbook = load_workbook(SOURCE, read_only=False, data_only=False)
        worksheet = workbook["Sheet1"]
        for row_no in sorted(rows_to_drop, reverse=True):
            worksheet.delete_rows(row_no, 1)
        workbook.save(TARGET)
        workbook.close()
        print(f"已生成：{TARGET.name}（原文件未改动）")

        with db() as conn:
            _clear(conn)
            second = _run(conn, TARGET.read_bytes(), TARGET.name)
        print(f"新文件复验：成功 {second['success_rows']} / 失败 {second['failed_rows']} / 跳过 {second['skipped_rows']}")
        for message in second["errors"][:5]:
            print(f"  仍有错误：{message[:80]}")
        with db() as conn:
            counts = {
                table: int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)
                for table in ("project", "sales_order", "sub_project", "order_line")
            }
        print(f"入库：{counts}")
    finally:
        engine.dispose()
        with server_engine.begin() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{settings.mysql_database}`"))
        print("验证库已销毁")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
