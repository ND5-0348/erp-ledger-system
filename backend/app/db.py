from __future__ import annotations

import json
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

from .config import DOCS_DIR, settings


# Keep the deployed database's Beijing wall-time convention for DATETIME.
# serializers attaches +08:00 so clients do not interpret these values as UTC.
MYSQL_CONNECT_ARGS = {"init_command": "SET time_zone = '+08:00'"}
engine = create_engine(settings.database_url, pool_pre_ping=True, future=True, connect_args=MYSQL_CONNECT_ARGS)
server_engine = create_engine(settings.server_url, pool_pre_ping=True, future=True, connect_args=MYSQL_CONNECT_ARGS)


@contextmanager
def db() -> Iterator[Connection]:
    with engine.begin() as conn:
        yield conn


def _split_sql(sql: str) -> list[str]:
    cleaned = re.sub(r"^\s*--.*$", "", sql, flags=re.MULTILINE)
    return [part.strip() for part in cleaned.split(";") if part.strip()]


def initialize_schema() -> None:
    schema_path = DOCS_DIR / "erp_ledger_schema.sql"
    statements = _split_sql(schema_path.read_text(encoding="utf-8"))
    view_statements = [statement for statement in statements if statement.lstrip().upper().startswith(("DROP VIEW", "CREATE VIEW"))]
    table_statements = [statement for statement in statements if statement not in view_statements]
    with server_engine.begin() as conn:
        for statement in table_statements:
            conn.execute(text(statement))
    apply_runtime_migrations()
    with engine.begin() as conn:
        for statement in view_statements:
            conn.execute(text(statement))


def apply_runtime_migrations() -> None:
    phase_tables = [
        "purchase_invoice",
        "warehouse_entry",
        "finance_invoice_check",
        "finance_payment_entry",
        "purchase_payment",
        "sales_invoice",
        "sales_receipt",
    ]
    with engine.begin() as conn:
        project_name_column_added = False
        additional_columns = {
            "order_line": {
                "project_name": "VARCHAR(255) NULL",
                "sales_tax_rate": "DECIMAL(10,6) NULL",
            },
            "purchase_info": {
                "purchase_tax_rate": "DECIMAL(10,6) NULL",
                "labor_cost": "DECIMAL(18,2) NULL",
                "other_cost": "DECIMAL(18,2) NULL",
            },
            "warehouse_entry": {
                "warehouse_amount_no_tax": "DECIMAL(18,2) NULL",
            },
        }
        for table_name, columns in additional_columns.items():
            for column_name, definition in columns.items():
                column_exists = conn.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM information_schema.columns
                        WHERE table_schema = DATABASE()
                          AND table_name = :table_name
                          AND column_name = :column_name
                        """
                    ),
                    {"table_name": table_name, "column_name": column_name},
                ).scalar()
                if not column_exists:
                    conn.execute(text(f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {definition}"))
                    if table_name == "order_line" and column_name == "project_name":
                        project_name_column_added = True

        if project_name_column_added:
            conn.execute(
                text(
                    """
                    UPDATE order_line ol
                    JOIN sales_order so ON so.id = ol.sales_order_id
                    JOIN project p ON p.id = so.project_id
                    SET ol.project_name = p.project_name
                    WHERE ol.project_name IS NULL
                      AND p.project_name IS NOT NULL
                    """
                )
            )

        precise_columns = {
            "order_line": ["quantity"],
            "delivery_record": ["delivery_quantity", "pending_delivery_quantity"],
        }
        for table_name, column_names in precise_columns.items():
            for column_name in column_names:
                column = conn.execute(
                    text(
                        """
                        SELECT NUMERIC_PRECISION AS numeric_precision,
                               NUMERIC_SCALE AS numeric_scale
                        FROM information_schema.columns
                        WHERE table_schema = DATABASE()
                          AND table_name = :table_name
                          AND column_name = :column_name
                        """
                    ),
                    {"table_name": table_name, "column_name": column_name},
                ).mappings().first()
                if column and (int(column["numeric_precision"] or 0), int(column["numeric_scale"] or 0)) != (20, 6):
                    conn.execute(
                        text(
                            f"ALTER TABLE `{table_name}` "
                            f"MODIFY COLUMN `{column_name}` DECIMAL(20,6) NULL"
                        )
                    )

        for table_name in phase_tables:
            column_exists = conn.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = :table_name
                      AND column_name = 'active_phase_no'
                    """
                ),
                {"table_name": table_name},
            ).scalar()
            if not column_exists:
                conn.execute(
                    text(
                        f"""
                        ALTER TABLE `{table_name}`
                        ADD COLUMN active_phase_no INT
                        GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED
                        """
                    )
                )
            index_name = f"uk_{table_name}_active_phase"
            index_exists = conn.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.statistics
                    WHERE table_schema = DATABASE()
                      AND table_name = :table_name
                      AND index_name = :index_name
                    """
                ),
                {"table_name": table_name, "index_name": index_name},
            ).scalar()
            if not index_exists:
                conn.execute(
                    text(
                        f"""
                        ALTER TABLE `{table_name}`
                        ADD UNIQUE KEY `{index_name}` (order_line_id, active_phase_no)
                        """
                    )
                )

        # 子项目实体的结构随启动生效；存量数据搬迁由 migrate_sub_projects()
        # 显式执行，不在启动时自动改动业务数据。
        _ensure_sub_project_storage(conn)


SUB_PROJECT_DDL = """
CREATE TABLE IF NOT EXISTS sub_project (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  customer_unit_name VARCHAR(255) NULL,
  end_user_name VARCHAR(255) NULL,
  regional_platform VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sub_project_order_name (sales_order_id, name),
  KEY idx_sub_project_customer (customer_unit_name),
  CONSTRAINT fk_sub_project_sales_order FOREIGN KEY (sales_order_id) REFERENCES sales_order(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

# 子项目三字段在原始行 JSON 里的列名候选。标准模板用第一个；
# 旧布局的列名尚未诊断（用户暂无旧表样本），命中不了就留空并计入待确认。
SUB_PROJECT_SOURCE_KEYS: dict[str, tuple[str, ...]] = {
    "customer_unit_name": ("客户单位名称", "客户单位", "客户名称"),
    "end_user_name": ("用户", "最终用户", "最终用户名称"),
    "regional_platform": ("区域平台", "区域平台名称"),
}


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = :table_name
                  AND column_name = :column_name
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        ).scalar()
    )


def _table_exists(conn, table_name: str) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_name = :table_name
                """
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _ensure_sub_project_storage(conn) -> None:
    """建子项目表与 order_line.sub_project_id（可重复运行）。"""
    if not _table_exists(conn, "sub_project"):
        conn.execute(text(SUB_PROJECT_DDL))
    if not _column_exists(conn, "order_line", "sub_project_id"):
        conn.execute(text("ALTER TABLE order_line ADD COLUMN sub_project_id BIGINT UNSIGNED NULL AFTER sales_order_id"))
        conn.execute(text("ALTER TABLE order_line ADD KEY idx_order_line_sub_project (sub_project_id)"))
        conn.execute(
            text(
                "ALTER TABLE order_line ADD CONSTRAINT fk_order_line_sub_project "
                "FOREIGN KEY (sub_project_id) REFERENCES sub_project(id)"
            )
        )


def _raw_sub_project_values(raw_json: object) -> dict[str, str | None]:
    """从原始行 JSON 取子项目三字段。取不到就返回 None，不猜。"""
    if raw_json is None:
        return {column: None for column in SUB_PROJECT_SOURCE_KEYS}
    try:
        payload = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    except (TypeError, ValueError):
        return {column: None for column in SUB_PROJECT_SOURCE_KEYS}
    if not isinstance(payload, dict):
        return {column: None for column in SUB_PROJECT_SOURCE_KEYS}
    resolved: dict[str, str | None] = {}
    for column, candidates in SUB_PROJECT_SOURCE_KEYS.items():
        value = None
        for candidate in candidates:
            raw_value = payload.get(candidate)
            text_value = str(raw_value).strip() if raw_value not in (None, "") else ""
            if text_value:
                value = text_value
                break
        resolved[column] = value
    return resolved


def migrate_sub_projects() -> dict[str, int]:
    """把客户单位/最终用户/区域平台从框架项目迁到子项目实体。

    值优先取每行自己的原始导入记录（ledger_raw_row.raw_json），不是框架表上的
    现值——那只代表第一个出现的行。同一子项目内出现互相冲突的值时该字段留空，
    计入 conflicts，等人工确认，不自动挑一个。
    """
    stats = {"sub_projects": 0, "linked_lines": 0, "conflicts": 0, "unresolved": 0}
    with engine.begin() as conn:
        _ensure_sub_project_storage(conn)
        rows = conn.execute(
            text(
                """
                SELECT ol.id AS order_line_id, ol.sales_order_id, ol.project_name, lrr.raw_json
                FROM order_line ol
                LEFT JOIN ledger_raw_row lrr ON lrr.id = ol.raw_row_id
                WHERE ol.sub_project_id IS NULL AND ol.deleted_at IS NULL
                ORDER BY ol.id
                """
            )
        ).mappings().all()
        if not rows:
            return stats

        grouped: dict[tuple[int, str], list[dict[str, str | None]]] = {}
        line_keys: dict[int, tuple[int, str]] = {}
        for row in rows:
            name = str(row["project_name"] or "").strip()
            key = (int(row["sales_order_id"]), name)
            grouped.setdefault(key, []).append(_raw_sub_project_values(row["raw_json"]))
            line_keys[int(row["order_line_id"])] = key

        created: dict[tuple[int, str], int] = {}
        for key, values in grouped.items():
            resolved: dict[str, str | None] = {}
            for column in SUB_PROJECT_SOURCE_KEYS:
                distinct = {value[column] for value in values if value[column]}
                if len(distinct) > 1:
                    # 同一子项目内本就该一致；不一致时留空并计数，不替用户选一个。
                    resolved[column] = None
                    stats["conflicts"] += 1
                else:
                    resolved[column] = next(iter(distinct), None)
                if resolved[column] is None:
                    stats["unresolved"] += 1
            sales_order_id, name = key
            existing = conn.execute(
                text("SELECT id FROM sub_project WHERE sales_order_id = :sales_order_id AND name = :name"),
                {"sales_order_id": sales_order_id, "name": name},
            ).scalar()
            if existing:
                created[key] = int(existing)
                continue
            created[key] = int(
                conn.execute(
                    text(
                        """
                        INSERT INTO sub_project
                          (sales_order_id, name, customer_unit_name, end_user_name, regional_platform)
                        VALUES
                          (:sales_order_id, :name, :customer_unit_name, :end_user_name, :regional_platform)
                        """
                    ),
                    {"sales_order_id": sales_order_id, "name": name, **resolved},
                ).lastrowid
                or 0
            )
            stats["sub_projects"] += 1

        for order_line_id, key in line_keys.items():
            conn.execute(
                text("UPDATE order_line SET sub_project_id = :sub_project_id WHERE id = :order_line_id"),
                {"sub_project_id": created[key], "order_line_id": order_line_id},
            )
            stats["linked_lines"] += 1

        # 全部明细都有子项目归属后，清空框架项目上的这三列：它们保存的是
        # “该框架下第一个出现的值”，留作框架统一值就是串值。
        remaining = conn.execute(
            text("SELECT COUNT(*) FROM order_line WHERE sub_project_id IS NULL AND deleted_at IS NULL")
        ).scalar()
        if not remaining:
            conn.execute(
                text(
                    "UPDATE project SET customer_unit_name = NULL, end_user_name = NULL, "
                    "regional_platform = NULL WHERE customer_unit_name IS NOT NULL "
                    "OR end_user_name IS NOT NULL OR regional_platform IS NOT NULL"
                )
            )
    return stats


def table_count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0)


def active_table_count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL")).scalar() or 0)
