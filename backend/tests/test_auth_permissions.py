from app.auth import CurrentUser, ROLE_PERMISSIONS, can_access_department, has_permission, normalize_permissions


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
