from __future__ import annotations

from fastapi.routing import APIRoute

from app.auth import get_current_user
from app.main import app


def _route(path: str) -> APIRoute:
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path == path:
            return route
    raise AssertionError(f"Route not found: {path}")


def _requires_login(path: str) -> bool:
    route = _route(path)
    return any(dependency.call is get_current_user for dependency in route.dependant.dependencies)


def _route_methods(path: str) -> set[str]:
    methods: set[str] = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path == path:
            methods.update(route.methods or set())
    if not methods:
        raise AssertionError(f"Route not found: {path}")
    return methods


def _required_permissions(path: str, method: str = "GET") -> set[str]:
    permissions: set[str] = set()
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.path != path or method not in (route.methods or set()):
            continue
        for dependency in route.dependant.dependencies:
            closure = getattr(dependency.call, "__closure__", None) or []
            for cell in closure:
                if isinstance(cell.cell_contents, str):
                    permissions.add(cell.cell_contents)
    return permissions


def test_business_api_requires_login_dependency():
    protected_paths = [
        "/api/dashboard/summary",
        "/api/ledgers",
        "/api/orders",
        "/api/purchases",
        "/api/sales",
        "/api/logs",
        "/api/backups",
    ]

    for path in protected_paths:
        assert _requires_login(path), path


def test_health_remains_public():
    assert not _requires_login("/api/health")


def test_edit_and_delete_routes_exist():
    expected_routes = {
        "/api/orders/{order_line_id}": {"PUT", "DELETE"},
        "/api/purchases/contracts/{contract_id}": {"PUT", "DELETE"},
        "/api/purchases/invoices/{invoice_id}": {"PUT", "DELETE"},
        "/api/purchases/payments/{payment_id}": {"PUT", "DELETE"},
        "/api/sales/contracts/{contract_id}": {"PUT", "DELETE"},
        "/api/sales/invoices/{invoice_id}": {"PUT", "DELETE"},
        "/api/sales/receipts/{receipt_id}": {"PUT", "DELETE"},
        "/api/auth/users/{user_id}": {"PUT", "DELETE"},
        "/api/auth/users/{user_id}/reset-password": {"POST"},
        "/api/auth/users/{user_id}/restore": {"POST"},
        "/api/auth/users/{user_id}/permanent": {"DELETE"},
    }

    for path, methods in expected_routes.items():
        assert methods <= _route_methods(path)


def test_order_persistence_routes_exist():
    assert "POST" in _route_methods("/api/orders")
    assert "POST" in _route_methods("/api/orders/batch")


def test_system_metadata_requires_admin_permission():
    assert "system_admin" in _required_permissions("/api/logs")
    assert "system_admin" in _required_permissions("/api/backups")
    assert "system_admin" in _required_permissions("/api/backups", "POST")
    assert "system_admin" in _required_permissions("/api/backups/{backup_id}/restore", "POST")
