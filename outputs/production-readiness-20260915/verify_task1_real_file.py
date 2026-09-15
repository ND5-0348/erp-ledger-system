"""Task 1 回归：用真实业务文件在独立验证库上确认共享字段校验不会误拦。

安全约束：复用 backend/tests/conftest.py 的环境断言（库名必须 erp_ledger_test_ 前缀、
备份目录必须在系统临时目录下），验证结束后 drop 验证库，不触碰 erp_ledger。
只输出统计数字，不打印业务行内容。
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

os.environ["MYSQL_DATABASE"] = "erp_ledger_test_verify_task1"
os.environ["BACKUP_ROOT"] = str(Path(tempfile.gettempdir()) / "erp-ledger-verify-task1")

import conftest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import db, engine, server_engine  # noqa: E402
from app.importer import import_excel  # noqa: E402

DESKTOP = Path.home() / "Desktop"


def main() -> int:
    conftest.initialize_test_schema()
    from app.config import settings

    print(f"验证库已建立：{settings.mysql_database}")

    candidates = sorted(DESKTOP.glob("2026市场部业务台账_已填充_已去重.xlsx"))
    if not candidates:
        print("未在桌面找到业务台账文件")
        return 2
    source = candidates[0]
    print(f"样本文件：{source.name}（{source.stat().st_size} 字节）")

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
        print(
            f"导入结果：成功 {result['success_rows']} 行，失败 {result['failed_rows']} 行，"
            f"跳过非业务行 {result.get('skipped_rows', 0)} 行"
        )
        errors = result.get("errors") or []
        if errors:
            print(f"错误样例（最多 3 条，不含业务数值）：")
            for message in errors[:3]:
                print(f"  - {message[:160]}")
        with db() as conn:
            counts = {
                table: int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)
                for table in ("project", "sales_order", "order_line", "purchase_info")
            }
        print(f"入库统计：{counts}")
    finally:
        engine.dispose()
        with server_engine.begin() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{settings.mysql_database}`"))
        print("验证库已销毁")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
