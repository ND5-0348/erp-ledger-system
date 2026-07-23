from __future__ import annotations

import re
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

from .config import DOCS_DIR, settings


engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
server_engine = create_engine(settings.server_url, pool_pre_ping=True, future=True)


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
                        SELECT numeric_precision, numeric_scale
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


def table_count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0)


def active_table_count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE deleted_at IS NULL")).scalar() or 0)
