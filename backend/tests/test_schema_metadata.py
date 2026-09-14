from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, text

from app import db as database


@pytest.mark.parametrize("precision,scale,expected_changes", [(18, 2, 3), (20, 6, 0), (None, None, 0)])
def test_quantity_migration_handles_uppercase_metadata(monkeypatch, precision, scale, expected_changes):
    """Execute the metadata SELECT against uppercase catalog column labels."""
    metadata_engine = create_engine("sqlite://")
    alterations = []
    with metadata_engine.connect() as metadata:
        metadata.exec_driver_sql("ATTACH DATABASE ':memory:' AS information_schema")
        metadata.exec_driver_sql(
            "CREATE TABLE information_schema.columns "
            "(TABLE_SCHEMA TEXT, TABLE_NAME TEXT, COLUMN_NAME TEXT, "
            "NUMERIC_PRECISION INTEGER, NUMERIC_SCALE INTEGER)"
        )
        metadata.connection.driver_connection.create_function("DATABASE", 0, lambda: "erp_ledger")
        if precision is not None:
            for table, column in (
                ("order_line", "quantity"),
                ("delivery_record", "delivery_quantity"),
                ("delivery_record", "pending_delivery_quantity"),
            ):
                metadata.exec_driver_sql(
                    "INSERT INTO information_schema.columns VALUES (?, ?, ?, ?, ?)",
                    ("erp_ledger", table, column, precision, scale),
                )

        class MigrationConnection:
            def execute(self, statement, parameters=None):
                sql = str(statement)
                if "numeric_precision" in sql.lower():
                    return metadata.execute(statement, parameters)
                if sql.lstrip().startswith("ALTER TABLE"):
                    alterations.append(sql)
                # Other migration columns and indexes already exist.
                return metadata.execute(text("SELECT 1"))

        class MigrationEngine:
            @contextmanager
            def begin(self):
                yield MigrationConnection()

        monkeypatch.setattr(database, "engine", MigrationEngine())
        database.apply_runtime_migrations()
        assert len(alterations) == expected_changes
        assert all("DECIMAL(20,6) NULL" in sql for sql in alterations)
    metadata_engine.dispose()
