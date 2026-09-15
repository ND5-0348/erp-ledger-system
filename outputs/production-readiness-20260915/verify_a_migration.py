"""A 修正迁移演练：在独立验证库上验证「从原始导入记录还原」的子项目迁移。

步骤：
1. 用真实业务文件导入验证库（新导入路径会直接写 sub_project）；
2. 人为退回到“旧结构”：清空 sub_project_id、删除 sub_project、并把框架项目上的
   三列填成第一条出现的值——这正是交接文档描述的旧状态；
3. 执行 migrate_sub_projects()，检查每个子项目是否还原出自己那一行的值；
4. 用完销毁验证库，不触碰 erp_ledger。

只输出计数与对比结论，不打印业务值。
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

os.environ["MYSQL_DATABASE"] = "erp_ledger_test_verify_migration"
os.environ["BACKUP_ROOT"] = str(Path(tempfile.gettempdir()) / "erp-ledger-verify-migration")

import conftest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import db, engine, migrate_sub_projects, server_engine  # noqa: E402
from app.importer import import_excel  # noqa: E402

DESKTOP = Path.home() / "Desktop"


def _scalar(sql: str, **params):
    with db() as conn:
        return conn.execute(text(sql), params).scalar()


def main() -> int:
    conftest.initialize_test_schema()
    print(f"验证库：{settings.mysql_database}")

    source = DESKTOP / "2026市场部业务台账_已填充_已去重.xlsx"
    if not source.exists():
        print("未找到业务文件")
        return 2

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
        print(f"导入：成功 {result['success_rows']} 行，失败 {result['failed_rows']} 行")
        print(
            "新导入后的状态：子项目 %d 个，明细全部挂到子项目：%s"
            % (
                _scalar("SELECT COUNT(*) FROM sub_project"),
                _scalar("SELECT COUNT(*) FROM order_line WHERE sub_project_id IS NULL") == 0,
            )
        )

        # 退回旧结构：只有框架项目上有三列，第一个出现的值代表整个框架
        with db() as conn:
            conn.execute(
                text(
                    """
                    UPDATE project p
                    SET p.customer_unit_name = (
                          SELECT sp.customer_unit_name FROM sub_project sp
                          JOIN sales_order so ON so.id = sp.sales_order_id
                          WHERE so.project_id = p.id ORDER BY sp.id LIMIT 1),
                        p.end_user_name = (
                          SELECT sp.end_user_name FROM sub_project sp
                          JOIN sales_order so ON so.id = sp.sales_order_id
                          WHERE so.project_id = p.id ORDER BY sp.id LIMIT 1),
                        p.regional_platform = (
                          SELECT sp.regional_platform FROM sub_project sp
                          JOIN sales_order so ON so.id = sp.sales_order_id
                          WHERE so.project_id = p.id ORDER BY sp.id LIMIT 1)
                    """
                )
            )
            conn.execute(text("UPDATE order_line SET sub_project_id = NULL"))
            conn.execute(text("DELETE FROM sub_project"))
        print("已退回旧结构：order_line.sub_project_id 全空，sub_project 清空")

        stats = migrate_sub_projects()
        print(f"迁移统计：{stats}")

        print(
            "迁移结果：子项目 %d 个，全部明细已挂接：%s"
            % (
                _scalar("SELECT COUNT(*) FROM sub_project"),
                _scalar("SELECT COUNT(*) FROM order_line WHERE sub_project_id IS NULL") == 0,
            )
        )
        print(
            "框架项目上的三列已清空：%s"
            % (
                _scalar(
                    "SELECT COUNT(*) FROM project WHERE customer_unit_name IS NOT NULL "
                    "OR end_user_name IS NOT NULL OR regional_platform IS NOT NULL"
                )
                == 0
            )
        )
        print(
            "同一订单内不同子项目保留各自客户单位的子项目数：%d"
            % _scalar(
                """
                SELECT COUNT(*) FROM (
                  SELECT sp.sales_order_id
                  FROM sub_project sp
                  WHERE sp.customer_unit_name IS NOT NULL
                  GROUP BY sp.sales_order_id
                  HAVING COUNT(DISTINCT sp.customer_unit_name) > 1
                ) t
                """
            )
        )
        print(
            "可还原出值的子项目字段数：客户单位 %d / 最终用户 %d / 区域平台 %d"
            % (
                _scalar("SELECT COUNT(*) FROM sub_project WHERE customer_unit_name IS NOT NULL"),
                _scalar("SELECT COUNT(*) FROM sub_project WHERE end_user_name IS NOT NULL"),
                _scalar("SELECT COUNT(*) FROM sub_project WHERE regional_platform IS NOT NULL"),
            )
        )
        print(
            "迁移幂等性：再次执行 → %s" % (migrate_sub_projects(),)
        )
    finally:
        engine.dispose()
        with server_engine.begin() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{settings.mysql_database}`"))
        print("验证库已销毁")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
