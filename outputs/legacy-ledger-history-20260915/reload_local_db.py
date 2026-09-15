"""清空并重导本地库（用户已确认库内是测试数据）。

安全措施：
1. 只允许在本机开发库 `erp_ledger` 上运行，其他库名直接退出；
2. 清空前先做一次应用业务备份并校验文件已落盘，作为回退点；
3. 结构变更（子项目表、历史表）先执行，再清空导入。

只输出计数，不打印业务值。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import text  # noqa: E402

from app.auth import CurrentUser  # noqa: E402
from app.backup import create_backup  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import apply_runtime_migrations, db, engine  # noqa: E402
from app.importer import import_excel  # noqa: E402

ALLOWED_DATABASE = "erp_ledger"
SOURCE = Path.home() / "Desktop" / "2026市场部业务台账_已填充_已修正.xlsx"


def main() -> int:
    if settings.mysql_database != ALLOWED_DATABASE:
        print(f"拒绝执行：当前库是 {settings.mysql_database!r}，只允许 {ALLOWED_DATABASE!r}")
        return 2
    if not SOURCE.exists():
        print(f"找不到源文件：{SOURCE}")
        return 2

    with db() as conn:
        admin_row = conn.execute(
            text(
                "SELECT id, username, display_name, role_code, permissions_json, "
                "department_scope_json, department_can_view, department_can_entry "
                "FROM erp_user WHERE username = 'admin'"
            )
        ).mappings().first()
        if admin_row is None:
            print("找不到 admin 账号")
            return 2
        admin = CurrentUser(
            id=int(admin_row["id"]),
            username=str(admin_row["username"]),
            display_name=str(admin_row["display_name"]),
            role_code=str(admin_row["role_code"]),
            permissions=["system_admin"],
            department_scope=[],
            department_can_view=bool(admin_row["department_can_view"]),
            department_can_entry=bool(admin_row["department_can_entry"]),
        )

    apply_runtime_migrations()
    print("结构已就绪")

    before = {}
    with db() as conn:
        for table in ("project", "sales_order", "order_line", "sub_project"):
            before[table] = int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)
        backup = create_backup(conn, admin, "pre_reimport")
    print(f"清空前计数：{before}")
    print(f"回退点备份：{backup['file_name']}（{backup['file_size_label']}）")

    with db() as conn:
        result = import_excel(
            conn,
            reset=True,
            workbook_bytes=SOURCE.read_bytes(),
            source_file_name=SOURCE.name,
            user=admin,
            strict_template=True,
        )
    print(
        f"重导结果：成功 {result['success_rows']} / 失败 {result['failed_rows']} / "
        f"跳过 {result['skipped_rows']}"
    )
    for message in result["errors"][:5]:
        print(f"  错误：{message[:100]}")

    with db() as conn:
        after = {
            table: int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)
            for table in (
                "project", "sales_order", "sub_project", "order_line",
                "sales_order_number_history", "project_manager_history",
            )
        }
    print(f"重导后计数：{after}")
    engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
