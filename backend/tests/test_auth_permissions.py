from dataclasses import replace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import config
from app.auth import CurrentUser, ROLE_PERMISSIONS, can_access_department, has_permission, normalize_permissions
from app.routers.auth import UserCreate, _validate_department_permissions


def test_admin_can_use_every_permission():
    for permission in {
        "order_entry",
        "order_edit",
        "order_delete",
        "purchase_entry",
        "purchase_edit",
        "purchase_delete",
        "sales_entry",
        "sales_edit",
        "sales_delete",
        "system_admin",
    }:
        assert has_permission("admin", permission)


def test_entry_roles_are_separated_by_module():
    assert has_permission("order_entry", "order_entry")
    assert not has_permission("order_entry", "purchase_entry")
    assert not has_permission("order_entry", "sales_entry")
    assert not has_permission("order_entry", "order_edit")
    assert not has_permission("order_entry", "order_delete")

    assert has_permission("purchase_entry", "purchase_entry")
    assert not has_permission("purchase_entry", "order_entry")
    assert not has_permission("purchase_entry", "sales_entry")
    assert not has_permission("purchase_entry", "purchase_edit")
    assert not has_permission("purchase_entry", "purchase_delete")

    assert has_permission("sales_entry", "sales_entry")
    assert not has_permission("sales_entry", "order_entry")
    assert not has_permission("sales_entry", "purchase_entry")
    assert not has_permission("sales_entry", "sales_edit")
    assert not has_permission("sales_entry", "sales_delete")


def test_viewer_has_no_write_permissions():
    assert ROLE_PERMISSIONS["viewer"] == set()
    assert not has_permission("viewer", "order_entry")
    assert not has_permission("unknown", "order_entry")


def test_custom_permissions_override_role_defaults():
    assert normalize_permissions("viewer", ["order_entry", "order_edit", "bad_permission"]) == ["order_edit", "order_entry"]
    assert has_permission("viewer", "order_edit", ["order_edit"])
    assert not has_permission("admin", "sales_entry", ["order_entry"])


def test_default_admin_password_allows_admin123(monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, default_admin_password="admin123"))
    config.validate_security_settings()


def test_new_user_password_requires_at_least_six_characters():
    user = UserCreate(
        username="user6",
        password="123456",
        display_name="Test User",
        role_code="viewer",
    )
    assert user.password == "123456"

    with pytest.raises(ValidationError):
        UserCreate(
            username="user5",
            password="12345",
            display_name="Test User",
            role_code="viewer",
        )


def test_department_scope_limits_view_and_entry():
    user = CurrentUser(
        id=1,
        username="dept_user",
        display_name="部门用户",
        role_code="viewer",
        permissions=[],
        department_scope=["科贸部"],
        department_can_view=True,
        department_can_entry=False,
    )

    assert can_access_department(user, "科贸部")
    assert not can_access_department(user, "物流部")
    assert not can_access_department(user, "科贸部", require_entry=True)


def test_department_entry_requires_view_permission():
    for department_scope in (["QA"], []):
        with pytest.raises(HTTPException) as exc_info:
            _validate_department_permissions(
                department_scope,
                department_can_view=False,
                department_can_entry=True,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "勾选录入权限时必须同时勾选查看权限，用于核对录入数据是否有误"

    _validate_department_permissions(["QA"], department_can_view=True, department_can_entry=True)
    _validate_department_permissions(["QA"], department_can_view=True, department_can_entry=False)
    _validate_department_permissions([], department_can_view=False, department_can_entry=False)
