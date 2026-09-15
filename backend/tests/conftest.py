"""MySQL 集成测试的受控夹具。

安全约束（Task 0）：

1. 只允许在 `erp_ledger_test_` 前缀的独立数据库上建表、清表、删库；
2. 备份根目录必须位于系统临时目录之下，绝不落进业务备份目录 `backend/backups`
   （历史上测试与业务共用该目录，留下了 60 多个孤儿备份文件）；
3. 环境变量必须在导入任何 `app.*` 之前设置——`app.config` 在导入时即固化 Settings
   与 BACKUP_DIR，导入之后再改环境变量不会生效。

夹具依赖链：`client` → `clean_database` → `mysql_test_database`。
会话级 fixture 只建库一次、结束时删库一次，任何测试文件都不会中途删掉别人正在用的库；
不请求 `client` 的纯单元测试（SQLite、序列化）完全不触碰 MySQL。
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Iterator

import pytest

TEST_DATABASE_PREFIX = "erp_ledger_test_"
DEFAULT_TEST_DATABASE = "erp_ledger_test_readiness_20260915"
TEST_PASSWORD = "Integration-Test-20260714!"
DEFAULT_TEST_BACKUP_ROOT = Path(tempfile.gettempdir()) / "erp-ledger-readiness-20260915"


def _is_within(child: Path, parent: Path) -> bool:
    child_text = os.path.normcase(str(child))
    parent_text = os.path.normcase(str(parent))
    return child_text == parent_text or child_text.startswith(parent_text + os.sep)


def assert_safe_test_environment(database: str, backup_root: Path | str) -> None:
    """在建立任何连接之前拒绝危险环境。

    这是纯函数，不连接数据库、不删除任何东西，因此可以被安全检查用例直接调用，
    验证“数据库是业务库或备份目录指向业务目录时立即拒绝启动”。
    """
    if not database or not str(database).startswith(TEST_DATABASE_PREFIX):
        raise RuntimeError(
            f"拒绝启动测试：数据库名必须以 {TEST_DATABASE_PREFIX!r} 开头，当前为 {database!r}；"
            "不得在业务库上运行集成测试。"
        )
    backup_path = Path(backup_root).resolve()
    temporary_root = Path(tempfile.gettempdir()).resolve()
    if not _is_within(backup_path, temporary_root):
        raise RuntimeError(
            f"拒绝启动测试：备份目录必须位于系统临时目录 {temporary_root} 之下，"
            f"当前为 {backup_path}；不得写入业务备份目录。"
        )


_database = os.environ.get("MYSQL_DATABASE") or DEFAULT_TEST_DATABASE
_backup_root = os.environ.get("BACKUP_ROOT") or str(DEFAULT_TEST_BACKUP_ROOT)
assert_safe_test_environment(_database, _backup_root)

# 必须在导入 app.config 之前落地：Settings 的字段默认值在类定义时求值。
os.environ["MYSQL_DATABASE"] = _database
os.environ["BACKUP_ROOT"] = str(Path(_backup_root).resolve())
os.environ["DEFAULT_ADMIN_PASSWORD"] = TEST_PASSWORD

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.auth import ensure_default_admin  # noqa: E402
from app.config import BACKUP_DIR, ROOT_DIR, settings  # noqa: E402
from app.db import _split_sql, db, engine, server_engine  # noqa: E402
from app.main import app  # noqa: E402

# 测试运行时会清空的表。账号、日志、备份记录保留，恢复类用例需要它们。
TEST_BUSINESS_TABLES = (
    "sales_receipt", "sales_invoice", "sales_contract", "purchase_payment", "finance_payment_entry",
    "finance_invoice_check", "warehouse_entry", "purchase_invoice",
    "purchase_contract", "delivery_record", "purchase_info", "order_line", "sub_project",
    "sales_order_number_history", "project_manager_history",
    "sales_order", "ledger_raw_row", "project", "import_batch",
)


def initialize_test_schema() -> None:
    """测试库只建一次：建表 → 保证账号存在。调用前会再校验一次实际生效的配置。"""
    database = settings.mysql_database
    assert_safe_test_environment(database, BACKUP_DIR)
    schema = (ROOT_DIR / "docs" / "erp_ledger_schema.sql").read_text(encoding="utf-8")
    with server_engine.begin() as conn:
        for statement in _split_sql(schema.replace("erp_ledger", database)):
            conn.execute(text(statement))
    ensure_default_admin()


def clear_business_data() -> None:
    with db() as conn:
        for table in TEST_BUSINESS_TABLES + ("backup_record", "operation_log"):
            conn.execute(text(f"DELETE FROM `{table}`"))


@pytest.fixture(scope="session")
def mysql_test_database() -> Iterator[None]:
    """整个会话只初始化一次、结束时销毁一次。"""
    initialize_test_schema()
    try:
        yield
    finally:
        engine.dispose()
        with server_engine.begin() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{settings.mysql_database}`"))


@pytest.fixture
def clean_database(mysql_test_database: None) -> None:
    clear_business_data()


@pytest.fixture
def client(clean_database: None) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
