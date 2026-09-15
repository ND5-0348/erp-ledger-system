"""Task 0 安全检查用例：测试环境必须与业务库、业务备份目录彻底隔离。

这些用例验证的是「拒绝发生在任何连接与清理之前」：
危险配置只调用纯函数断言，不建立连接、不执行 DELETE/DROP。
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from sqlalchemy import text

from conftest import TEST_DATABASE_PREFIX, TEST_PASSWORD, assert_safe_test_environment
from app.auth import CurrentUser
from app.backup import create_backup
from app.config import BACKEND_DIR, BACKUP_DIR, ROOT_DIR, settings
from app.db import db

BUSINESS_DATABASE = "erp_ledger"
BUSINESS_BACKUP_DIR = BACKEND_DIR / "backups"
SAFE_TEST_DATABASE = f"{TEST_DATABASE_PREFIX}isolation_probe"


@pytest.fixture
def isolated_backup_root(tmp_path: Path) -> Path:
    """tmp_path 由 pytest 建在系统临时目录下，等价于 BACKUP_ROOT 指向的位置。"""
    return tmp_path


def test_business_database_name_is_rejected(isolated_backup_root: Path) -> None:
    with pytest.raises(RuntimeError, match="拒绝启动测试"):
        assert_safe_test_environment(BUSINESS_DATABASE, isolated_backup_root)


@pytest.mark.parametrize("name", ["", "erp_ledger", "erp_ledger_prod", "erp_ledger_backup", "other_db"])
def test_database_without_test_prefix_is_rejected(name: str, isolated_backup_root: Path) -> None:
    with pytest.raises(RuntimeError):
        assert_safe_test_environment(name, isolated_backup_root)


def test_business_backup_directory_is_rejected(isolated_backup_root: Path) -> None:
    with pytest.raises(RuntimeError, match="备份目录"):
        assert_safe_test_environment(SAFE_TEST_DATABASE, BUSINESS_BACKUP_DIR)


@pytest.mark.parametrize("path", [BACKEND_DIR, ROOT_DIR])
def test_backup_root_outside_temporary_directory_is_rejected(path: Path) -> None:
    with pytest.raises(RuntimeError):
        assert_safe_test_environment(SAFE_TEST_DATABASE, path)


def test_temporary_backup_root_is_accepted(isolated_backup_root: Path) -> None:
    assert_safe_test_environment(SAFE_TEST_DATABASE, isolated_backup_root)


def test_active_settings_point_at_an_isolated_environment() -> None:
    """实际生效的配置也必须落在隔离环境里，而不只是命令行传参正确。"""
    assert settings.mysql_database.startswith(TEST_DATABASE_PREFIX)
    assert settings.mysql_database != BUSINESS_DATABASE

    backup_dir = Path(BACKUP_DIR).resolve()
    assert backup_dir != BUSINESS_BACKUP_DIR.resolve()
    assert Path(tempfile.gettempdir()).resolve() in backup_dir.parents


def test_connected_database_is_the_test_database(mysql_test_database: None) -> None:
    """业务库名只作为对照出现：即使它存在，当前连接也不指向它。"""
    with db() as conn:
        current = conn.execute(text("SELECT DATABASE()")).scalar()
        assert current == settings.mysql_database
        assert current != BUSINESS_DATABASE


def test_business_backup_directory_is_untouched_by_test_backups(mysql_test_database: None) -> None:
    """测试产生的备份必须落在临时目录，业务备份目录的文件集合不得变化。"""
    business_files_before = set(BUSINESS_BACKUP_DIR.glob("*.json.gz")) if BUSINESS_BACKUP_DIR.exists() else set()

    with db() as conn:
        admin_id = conn.execute(text("SELECT id FROM erp_user WHERE username = 'admin'")).scalar()
        created = create_backup(
            conn,
            CurrentUser(
                id=int(admin_id),
                username="admin",
                display_name="admin",
                role_code="admin",
                permissions=["system_admin"],
                department_scope=[],
                department_can_view=True,
                department_can_entry=True,
            ),
            "manual",
        )
        stored_path = Path(
            conn.execute(
                text("SELECT storage_path FROM backup_record WHERE id = :id"), {"id": created["id"]}
            ).scalar()
        ).resolve()

    assert Path(tempfile.gettempdir()).resolve() in stored_path.parents
    assert stored_path.exists()
    business_files_after = set(BUSINESS_BACKUP_DIR.glob("*.json.gz")) if BUSINESS_BACKUP_DIR.exists() else set()
    assert business_files_after == business_files_before


def test_default_admin_password_comes_from_the_test_environment() -> None:
    assert settings.default_admin_password == TEST_PASSWORD
