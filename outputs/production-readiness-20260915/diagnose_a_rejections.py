"""诊断新规则下被拒绝的行，只输出错误分类与计数，不输出业务值。"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

os.environ["MYSQL_DATABASE"] = "erp_ledger_test_verify_diag"
os.environ["BACKUP_ROOT"] = str(Path(tempfile.gettempdir()) / "erp-ledger-verify-diag")

import conftest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import db, engine, server_engine  # noqa: E402
from app.importer import import_excel  # noqa: E402

PATTERNS = [
    (r"子项目字段与台账不一致：(.+?)（", "子项目字段冲突"),
    (r"项目级共享字段与台账不一致", "框架字段冲突"),
    (r"同名同规格同数量同单价同采购厂商的明细已存在", "子项目内重复明细"),
    (r"缺少项目编号或订单号", "缺编号"),
]


def classify(message: str) -> str:
    for pattern, label in PATTERNS:
        match = re.search(pattern, message)
        if match:
            if label == "子项目字段冲突":
                return f"{label}：{match.group(1)}"
            return label
    return "其他"


def main() -> int:
    conftest.initialize_test_schema()
    source = Path.home() / "Desktop" / "2026市场部业务台账_已填充_已去重.xlsx"
    try:
        with db() as conn:
            result = import_excel(
                conn,
                reset=False,
                workbook_bytes=source.read_bytes(),
                source_file_name=source.name,
                user=None,
                strict_template=True,
            )
        print(f"成功 {result['success_rows']} / 失败 {result['failed_rows']} / 跳过 {result['skipped_rows']}")
        counter = Counter(classify(message) for message in result["errors"])
        for label, count in counter.most_common():
            print(f"  {count:>3}  {label}")
        print(f"（错误列表只保留前 {len(result['errors'])} 条，失败总数 {result['failed_rows']}）")
    finally:
        engine.dispose()
        with server_engine.begin() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{settings.mysql_database}`"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
