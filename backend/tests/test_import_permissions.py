"""Task 1：整表导入的独立权限与部门边界。

用例先于实现编写：`ledger_import` 权限点、部门边界校验、共享字段保护。
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import text

from app.auth import migrate_ledger_import_permission
from app.config import ROOT_DIR
from app.db import db

TEMPLATE_PATH = ROOT_DIR / "backend" / "templates" / "市场部业务台账模板.xlsx"
USER_PASSWORD = "Ledger-Import-Test-20260915!"
DEPARTMENT_A = "销售部"
DEPARTMENT_B = "市场部"
PROJECT_CODE = "P-IMP-001"


def _row(overrides: dict[int, object] | None = None) -> list[object]:
    """91 列模板的一行，只填业务必需列，其余留空。"""
    values: list[object] = [
        "全额", PROJECT_CODE, DEPARTMENT_A, "安徽分公司", "张三",
        date(2026, 7, 21), "商品销售", "常规", "三级一组",
        "客户单位A", "最终用户A", "区域平台A", "SO-IMP-001", "项目甲",
        "服务器", "规格A", "台", 2, None, None, Decimal("100.00"), None, None, "供应商A",
    ]
    for position, value in (overrides or {}).items():
        values[position - 1] = value
    return values


def _workbook(rows: list[list[object]]) -> bytes:
    workbook = load_workbook(TEMPLATE_PATH)
    worksheet = workbook["Sheet1"]
    for excel_row in range(3, 21):
        for column in range(1, 92):
            worksheet.cell(excel_row, column).value = None
    for offset, row in enumerate(rows):
        for column, value in enumerate(row, start=1):
            worksheet.cell(3 + offset, column, value)
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def _count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)


def _project(project_code: str) -> dict:
    with db() as conn:
        row = conn.execute(
            text("SELECT * FROM project WHERE project_code = :code"), {"code": project_code}
        ).mappings().first()
    return dict(row) if row else {}


def _login(client: TestClient, username: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": username, "password": USER_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_user(
    client: TestClient,
    headers: dict[str, str],
    username: str,
    permissions: list[str],
    *,
    role_code: str = "viewer",
    department_scope: list[str] | None = None,
    can_view: bool = True,
    can_entry: bool = True,
    department_all: bool = True,
) -> dict:
    return client.post(
        "/api/auth/users",
        headers=headers,
        json={
            "username": username,
            "password": USER_PASSWORD,
            "display_name": username,
            "role_code": role_code,
            "permissions": permissions,
            "department_scope": department_scope or [],
            "department_can_view": can_view,
            "department_can_entry": can_entry,
            "department_all": department_all,
        },
    )


def _import(client: TestClient, headers: dict[str, str], rows: list[list[object]], name: str = "test.xlsx"):
    return client.post(
        f"/api/orders/import-excel?filename={name}",
        content=_workbook(rows),
        headers=headers,
    )


@pytest.fixture
def cleanup_users() -> Iterator[list[str]]:
    """删除测试账号及其操作日志：operation_log 对 erp_user 有外键，必须先删日志。"""
    usernames: list[str] = []
    yield usernames
    with db() as conn:
        for username in usernames:
            user_id = conn.execute(
                text("SELECT id FROM erp_user WHERE username = :username"), {"username": username}
            ).scalar()
            if user_id is None:
                continue
            conn.execute(text("DELETE FROM operation_log WHERE user_id = :user_id"), {"user_id": int(user_id)})
            conn.execute(text("DELETE FROM erp_user WHERE id = :user_id"), {"user_id": int(user_id)})


# --- 权限隔离 ---------------------------------------------------------------


def test_order_entry_only_account_cannot_import(client: TestClient, headers: dict[str, str], cleanup_users) -> None:
    """能录订单不等于能整表导入；后端必须拒绝，不依赖前端隐藏按钮。"""
    cleanup_users.append("entry_only")
    assert _create_user(
        client, headers, "entry_only", ["order_entry"], role_code="order_entry", department_all=False
    ).status_code == 200
    response = _import(client, _login(client, "entry_only"), [_row()], "denied.xlsx")
    assert response.status_code == 403, response.text
    assert _count("order_line") == 0
    assert _count("project") == 0


def test_account_without_any_permission_cannot_import(client: TestClient, headers: dict[str, str], cleanup_users) -> None:
    cleanup_users.append("no_permission")
    assert _create_user(
        client, headers, "no_permission", [], department_all=False
    ).status_code == 200
    response = _import(client, _login(client, "no_permission"), [_row()], "denied.xlsx")
    assert response.status_code == 403, response.text
    assert _count("order_line") == 0


def test_account_with_ledger_import_permission_succeeds(client: TestClient, headers: dict[str, str], cleanup_users) -> None:
    cleanup_users.append("ledger_importer")
    created = _create_user(client, headers, "ledger_importer", ["ledger_import"])
    assert created.status_code == 200, created.text
    response = _import(client, _login(client, "ledger_importer"), [_row()], "allowed.xlsx")
    assert response.status_code == 200, response.text
    assert response.json()["success_rows"] == 1
    assert _count("order_line") == 1


def test_admin_keeps_import_ability(client: TestClient, headers: dict[str, str]) -> None:
    response = _import(client, headers, [_row()], "admin.xlsx")
    assert response.status_code == 200, response.text
    assert _count("order_line") == 1


def test_ledger_import_account_requires_explicit_department_policy(
    client: TestClient, headers: dict[str, str], cleanup_users
) -> None:
    """空部门范围不能让“全部部门”被无声表达，必须显式勾选。"""
    cleanup_users.append("implicit_all")
    response = _create_user(
        client, headers, "implicit_all", ["ledger_import"], department_scope=[], department_all=False
    )
    assert response.status_code == 400, response.text
    assert "全部部门" in response.json()["detail"]


def test_ledger_import_account_with_explicit_departments_is_accepted(
    client: TestClient, headers: dict[str, str], cleanup_users
) -> None:
    cleanup_users.append("scoped_importer")
    response = _create_user(
        client,
        headers,
        "scoped_importer",
        ["ledger_import"],
        department_scope=[DEPARTMENT_A],
        department_all=False,
    )
    assert response.status_code == 200, response.text


# --- 部门边界 ---------------------------------------------------------------


def test_cross_department_project_code_cannot_be_reused(
    client: TestClient, headers: dict[str, str], cleanup_users
) -> None:
    """甲部门账号把乙部门的项目编号填成甲部门，也必须被拒绝，且原数据不变。"""
    assert _import(client, headers, [_row({3: DEPARTMENT_B})], "owner.xlsx").status_code == 200
    project_before = _project(PROJECT_CODE)
    lines_before = _count("order_line")

    cleanup_users.append("dept_a")
    assert _create_user(
        client, headers, "dept_a", ["ledger_import"],
        department_scope=[DEPARTMENT_A], department_all=False,
    ).status_code == 200
    response = _import(
        client,
        _login(client, "dept_a"),
        [_row({3: DEPARTMENT_A, 13: "SO-IMP-002"})],
        "cross-department.xlsx",
    )
    assert response.status_code == 403, response.text
    assert _project(PROJECT_CODE) == project_before
    assert _count("order_line") == lines_before


def test_department_outside_scope_fails_the_whole_batch(
    client: TestClient, headers: dict[str, str], cleanup_users
) -> None:
    cleanup_users.append("dept_a_batch")
    assert _create_user(
        client, headers, "dept_a_batch", ["ledger_import"],
        department_scope=[DEPARTMENT_A], department_all=False,
    ).status_code == 200
    rows = [_row(), _row({2: "P-IMP-002", 3: DEPARTMENT_B, 13: "SO-IMP-002"})]
    response = _import(client, _login(client, "dept_a_batch"), rows, "mixed-department.xlsx")
    assert response.status_code == 403, response.text
    assert _count("order_line") == 0
    assert _count("project") == 0


# --- 共享字段保护 -----------------------------------------------------------


def test_shared_project_fields_cannot_be_rewritten_by_plain_import(
    client: TestClient, headers: dict[str, str]
) -> None:
    assert _import(client, headers, [_row()], "first.xlsx").status_code == 200
    project_before = _project(PROJECT_CODE)

    response = _import(client, headers, [_row({4: "江苏分公司", 13: "SO-IMP-002"})], "rewrite.xlsx")
    assert response.status_code == 422, response.text
    assert "分公司" in response.json()["detail"]
    assert _project(PROJECT_CODE) == project_before
    assert _count("order_line") == 1


def test_same_batch_inconsistent_shared_fields_are_rejected(
    client: TestClient, headers: dict[str, str]
) -> None:
    rows = [_row(), _row({13: "SO-IMP-002", 9: "三级二组"})]
    response = _import(client, headers, rows, "self-conflict.xlsx")
    assert response.status_code == 422, response.text
    assert "三级团队" in response.json()["detail"]
    assert _count("order_line") == 0
    assert _count("project") == 0


@pytest.mark.parametrize("position,value", [(10, "客户单位B"), (11, "最终用户B"), (14, "项目乙")])
def test_sub_project_fields_may_differ_between_sub_projects(
    client: TestClient, headers: dict[str, str], position: int, value: str
) -> None:
    """客户单位、最终用户、区域平台属于子项目：不同子项目（这里换了订单）可以不同。"""
    assert _import(client, headers, [_row()], "first.xlsx").status_code == 200
    response = _import(client, headers, [_row({13: "SO-IMP-002", position: value})], "sub-project.xlsx")
    assert response.status_code == 200, response.text
    assert _count("order_line") == 2


def test_sub_project_field_conflict_inside_one_sub_project_is_rejected(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一个订单、同一个子项目内，客户单位不同必须拒绝，不能用最后一行覆盖。"""
    assert _import(client, headers, [_row()], "first.xlsx").status_code == 200
    response = _import(client, headers, [_row({13: "SO-IMP-001", 10: "客户单位B", 15: "交换机"})], "conflict.xlsx")
    assert response.status_code == 422, response.text
    assert "客户单位" in response.json()["detail"]
    assert _count("order_line") == 1


def test_account_manager_is_a_framework_field(client: TestClient, headers: dict[str, str]) -> None:
    """客户经理属于框架项目：同一框架下换订单也不能改成别人。"""
    assert _import(client, headers, [_row()], "first.xlsx").status_code == 200
    response = _import(client, headers, [_row({13: "SO-IMP-002", 5: "李四"})], "manager.xlsx")
    assert response.status_code == 422, response.text
    assert "客户经理" in response.json()["detail"]
    assert _count("order_line") == 1


def test_legal_addition_to_existing_project_succeeds(client: TestClient, headers: dict[str, str]) -> None:
    assert _import(client, headers, [_row()], "first.xlsx").status_code == 200
    response = _import(client, headers, [_row({13: "SO-IMP-002", 15: "交换机"})], "addition.xlsx")
    assert response.status_code == 200, response.text
    assert _count("order_line") == 2
    assert _count("project") == 1


# --- 迁移 -------------------------------------------------------------------


def test_legacy_permission_migration_only_extends_existing_admins(cleanup_users) -> None:
    """只有原本已带 system_admin 的账号追加 ledger_import；其余原样保留。"""
    legacy = {
        "legacy_admin": json.dumps(["order_entry", "system_admin"], ensure_ascii=False),
        "legacy_plain": json.dumps(["order_entry"], ensure_ascii=False),
        "legacy_empty": "[]",
        "legacy_null": None,
    }
    with db() as conn:
        for username, permissions in legacy.items():
            cleanup_users.append(username)
            conn.execute(
                text(
                    """
                    INSERT INTO erp_user
                      (username, password_hash, display_name, role_code, permissions_json,
                       department_scope_json, department_can_view, department_can_entry, is_active)
                    VALUES
                      (:username, 'unused', :username, 'viewer', :permissions,
                       '[]', 0, 0, 1)
                    """
                ),
                {"username": username, "permissions": permissions},
            )
        migrate_ledger_import_permission(conn)
        rows = {
            str(row["username"]): row["permissions_json"]
            for row in conn.execute(
                text("SELECT username, permissions_json FROM erp_user")
            ).mappings()
        }

    assert "ledger_import" in json.loads(rows["legacy_admin"])
    assert "system_admin" in json.loads(rows["legacy_admin"])
    assert "ledger_import" not in json.loads(rows["legacy_plain"])
    assert json.loads(rows["legacy_empty"]) == []
    assert rows["legacy_null"] is None


def test_user_list_reports_effective_permissions_for_legacy_account(
    client: TestClient, headers: dict[str, str], cleanup_users
) -> None:
    """permissions_json 为空表示继承角色默认权限，界面必须看到实际生效的权限。"""
    cleanup_users.append("legacy_role_default")
    with db() as conn:
        conn.execute(
            text(
                """
                INSERT INTO erp_user
                  (username, password_hash, display_name, role_code, permissions_json,
                   department_scope_json, department_can_view, department_can_entry, is_active)
                VALUES ('legacy_role_default', 'unused', 'legacy_role_default', 'admin', NULL,
                        '[]', 1, 1, 1)
                """
            )
        )
    response = client.get("/api/auth/users", headers=headers)
    assert response.status_code == 200, response.text
    item = next(
        user for user in response.json()["items"] if user["username"] == "legacy_role_default"
    )
    assert item["permissions_json"] is None
    assert "system_admin" in item["effective_permissions"]
    assert "ledger_import" in item["effective_permissions"]


def test_permission_migration_is_repeatable(cleanup_users) -> None:
    cleanup_users.append("legacy_repeat")
    with db() as conn:
        conn.execute(
            text(
                """
                INSERT INTO erp_user
                  (username, password_hash, display_name, role_code, permissions_json,
                   department_scope_json, department_can_view, department_can_entry, is_active)
                VALUES ('legacy_repeat', 'unused', 'legacy_repeat', 'viewer',
                        '["system_admin"]', '[]', 0, 0, 1)
                """
            )
        )
        migrate_ledger_import_permission(conn)
        migrate_ledger_import_permission(conn)
        permissions = json.loads(
            conn.execute(
                text("SELECT permissions_json FROM erp_user WHERE username = 'legacy_repeat'")
            ).scalar()
        )
    assert permissions.count("ledger_import") == 1
