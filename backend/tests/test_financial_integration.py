from __future__ import annotations

import os
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import text

from app.auth import ALL_PERMISSIONS, CurrentUser, ensure_default_admin
from app.config import ROOT_DIR, settings
from app.db import _split_sql, db, engine, server_engine
from app.main import app
from app.ledger_excel import SAMPLE_ORDER_NO, SAMPLE_PROJECT_CODE, TEMPLATE_HEADERS
from app.routers import purchases

TEST_DATABASE_PREFIX = "erp_ledger_test_"
TEST_PASSWORD = "Integration-Test-20260714!"


def _test_database_name() -> str:
    name = settings.mysql_database
    if not name.startswith(TEST_DATABASE_PREFIX):
        raise RuntimeError(f"Set MYSQL_DATABASE to a name beginning with {TEST_DATABASE_PREFIX!r}.")
    return name


def _initialize_schema() -> None:
    database = _test_database_name()
    schema = (ROOT_DIR / "docs" / "erp_ledger_schema.sql").read_text(encoding="utf-8")
    with server_engine.begin() as conn:
        for statement in _split_sql(schema.replace("erp_ledger", database)):
            conn.execute(text(statement))
    ensure_default_admin()


def _clear_business_data() -> None:
    tables = (
        "sales_receipt", "sales_invoice", "sales_contract", "purchase_payment", "finance_payment_entry",
        "finance_invoice_check", "warehouse_entry", "purchase_invoice",
        "purchase_contract", "delivery_record", "purchase_info", "order_line",
        "sales_order", "ledger_raw_row", "project", "import_batch",
        "backup_record", "operation_log",
    )
    with db() as conn:
        for table in tables:
            conn.execute(text(f"DELETE FROM `{table}`"))


@pytest.fixture(scope="session", autouse=True)
def test_database() -> None:
    database = _test_database_name()
    _initialize_schema()
    yield
    engine.dispose()
    with server_engine.begin() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS `{database}`"))


@pytest.fixture(autouse=True)
def clean_database() -> None:
    _clear_business_data()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _payload(suffix: str) -> dict[str, str]:
    return {
        "amount_type": "gross",
        "project_code": f"QA-{suffix}",
        "project_name": "Financial Integration Test",
        "department": "QA",
        "branch_company": "QA Branch",
        "account_manager": "QA Manager",
        "order_no": f"SO-{suffix}",
        "order_date": "2026-07-14",
        "business_type": "QA",
        "statistical_category": "QA",
        "team_name": "QA Team",
        "customer_unit_name": "QA Customer",
        "user_name": "QA User",
        "regional_platform": "QA Platform",
        "goods_name": "QA Equipment",
        "specification_model": "QA-SPEC",
        "unit_name": "unit",
        "quantity": "10.000000",
        "net_unit_price": "100.000000",
        "unit_price": "113.000000",
        "net_revenue": "1000.00",
        "order_value": "1130.00",
        "supplier_name": "QA Supplier",
        "purchase_unit_price_no_tax": "70.000000",
        "purchase_unit_price": "79.100000",
        "cost_no_tax": "700.00",
        "purchase_amount": "791.00",
        "delivery_date": "2026-07-15",
        "delivery_quantity": "5.000000",
        "delivery_revenue_no_tax": "500.00",
        "delivery_value": "565.00",
        "delivery_cost_no_tax": "350.00",
        "delivery_cost": "395.50",
        "pending_delivery_quantity": "5.000000",
        "pending_delivery_amount_no_tax": "500.00",
        "pending_delivery_amount": "565.00",
    }


def _create_order(client: TestClient, headers: dict[str, str], suffix: str, **updates: str) -> tuple[int, dict[str, str]]:
    payload = _payload(suffix)
    payload.update(updates)
    response = client.post("/api/orders", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return int(response.json()["order_line_id"]), payload


def _d(value: object) -> Decimal:
    return Decimal(str(value))


def _finance(order_line_id: int) -> dict:
    with db() as conn:
        row = conn.execute(
            text("SELECT * FROM v_order_line_finance WHERE order_line_id = :id"),
            {"id": order_line_id},
        ).mappings().one()
    return dict(row)


def _ledger(project_code: str) -> dict:
    with db() as conn:
        row = conn.execute(
            text("SELECT * FROM v_project_ledger_summary WHERE project_code = :code"),
            {"code": project_code},
        ).mappings().one()
    return dict(row)


def _count(table: str, condition: str = "1=1", **params: object) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}` WHERE {condition}"), params).scalar() or 0)


def _action_count(action: str) -> int:
    return _count("operation_log", "action_name = :action", action=action)


def _dashboard(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.get("/api/dashboard/summary", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _payment(amount: str, payment_date: str = "2026-07-20") -> dict[str, str]:
    return {
        "due_payment_date": "2026-07-20",
        "payment_date": payment_date,
        "payment_voucher_no": f"PAY-{amount}",
        "payment_amount": amount,
    }


def _receipt(amount: str, ratio: str = "0.000000") -> dict[str, str]:
    return {
        "receipt_date": "2026-07-30",
        "payment_notice_no": f"RCPT-{amount}",
        "receipt_amount": amount,
        "receipt_ratio": ratio,
    }


def test_project_name_and_supplier_remain_bound_to_each_order_line(
    client: TestClient,
    headers: dict[str, str],
) -> None:
    suffix = "PROJECT-NAME-GRAIN"
    first_id, _ = _create_order(
        client,
        headers,
        suffix,
        project_name="项目名称甲",
        goods_name="设备甲",
        specification_model="SPEC-A",
        supplier_name="采购商甲",
    )
    second_payload = _payload(suffix)
    second_payload.update(
        {
            "project_name": "项目名称乙",
            "goods_name": "设备乙",
            "specification_model": "SPEC-B",
            "supplier_name": "采购商乙",
        }
    )
    second_response = client.post("/api/orders", json=second_payload, headers=headers)
    assert second_response.status_code == 200, second_response.text
    second_id = int(second_response.json()["order_line_id"])

    response = client.get(f"/api/orders?project_id=QA-{suffix}", headers=headers)
    assert response.status_code == 200, response.text
    rows = {int(row["order_line_id"]): row for row in response.json()["items"]}
    assert rows[first_id]["project_name"] == "项目名称甲"
    assert rows[first_id]["supplier_name"] == "采购商甲"
    assert rows[second_id]["project_name"] == "项目名称乙"
    assert rows[second_id]["supplier_name"] == "采购商乙"

    updated = {**second_payload, "project_name": "项目名称乙-已修改"}
    update_response = client.put(f"/api/orders/{second_id}", json=updated, headers=headers)
    assert update_response.status_code == 200, update_response.text
    assert _finance(first_id)["project_name"] == "项目名称甲"
    assert _finance(second_id)["project_name"] == "项目名称乙-已修改"

    with db() as conn:
        order_summary = conn.execute(
            text(
                """
                SELECT project_name, line_count
                FROM v_order_ledger_summary
                WHERE project_code = :project_code AND order_no = :order_no
                """
            ),
            {"project_code": f"QA-{suffix}", "order_no": f"SO-{suffix}"},
        ).mappings().one()
    assert int(order_summary["line_count"]) == 2
    assert set(str(order_summary["project_name"]).split("；")) == {"项目名称甲", "项目名称乙-已修改"}


def test_purchase_summary_can_be_edited_from_purchase_detail(
    client: TestClient,
    headers: dict[str, str],
) -> None:
    order_line_id, payload = _create_order(client, headers, "PURCHASE-SUMMARY")
    response = client.put(
        f"/api/purchases/{order_line_id}/summary",
        headers=headers,
        json={
            "supplier_name": "修改后的采购商",
            "purchase_tax_rate": "13.000000",
            "purchase_unit_price_no_tax": "72.000000",
            "purchase_unit_price": "81.360000",
            "cost_no_tax": "720.00",
            "purchase_amount": "813.60",
            "labor_cost": "12.34",
            "other_cost": "5.67",
        },
    )
    assert response.status_code == 200, response.text
    summary = response.json()["summary"]
    assert summary["supplier_name"] == "修改后的采购商"
    assert _d(summary["purchase_tax_rate"]) == Decimal("13.000000")
    assert _d(summary["purchase_unit_price_no_tax"]) == Decimal("72.000000")
    assert _d(summary["purchase_amount"]) == Decimal("813.60")
    assert _d(summary["labor_cost"]) == Decimal("12.34")
    assert _d(summary["other_cost"]) == Decimal("5.67")
    assert _d(summary["purchase_tax_amount"]) == Decimal("93.60")

    invalid_tax_rate = client.put(
        f"/api/purchases/{order_line_id}/summary",
        headers=headers,
        json={"purchase_tax_rate": "100.000001"},
    )
    assert invalid_tax_rate.status_code == 422, invalid_tax_rate.text

    with db() as conn:
        log = conn.execute(
            text(
                """
                SELECT detail
                FROM operation_log
                WHERE action_name = 'update_purchase_summary'
                ORDER BY id DESC
                LIMIT 1
                """
            )
        ).scalar_one()
    detail = json.loads(str(log))
    assert detail["after"]["project_code"] == payload["project_code"]
    assert detail["after"]["order_no"] == payload["order_no"]
    assert detail["after"]["goods_name"] == payload["goods_name"]
    assert detail["after"]["supplier_name"] == "修改后的采购商"


def _excel_import_file() -> bytes:
    template_path = ROOT_DIR / "backend" / "templates" / "市场部业务台账模板.xlsx"
    workbook = load_workbook(template_path)
    worksheet = workbook["Sheet1"]
    values = [
        "全额", "XL-IMPORT-001", "QA", "QA Branch", "QA Manager", date(2026, 7, 21), "商品销售", "常规",
        "QA Team", "QA Customer", "QA User", "QA Platform", "SO-XL-IMPORT-001", "Excel Import Project",
        "Excel Equipment", "XL-SPEC", "台", 2, Decimal("0.13"), Decimal("100.00"), Decimal("113.00"), Decimal("200.00"),
        Decimal("226.00"), "Excel Supplier", Decimal("0.13"), Decimal("70.00"), Decimal("79.10"), Decimal("140.00"),
        Decimal("158.20"), date(2026, 7, 22), 1, Decimal("100.00"), Decimal("113.00"), Decimal("70.00"),
        Decimal("79.10"), 1, Decimal("100.00"), Decimal("113.00"), "PC-XL-001", "验收后付款", "30天",
        Decimal("158.20"), Decimal("0.00"), date(2026, 7, 23), "PINV-XL-001", Decimal("158.20"),
        date(2026, 7, 24), "WH-XL-001", Decimal("158.20"), date(2026, 7, 25), "BOOK-XL-001",
        Decimal("158.20"), Decimal("0.00"), date(2026, 7, 25), date(2026, 7, 26), "PAY-XL-001",
        Decimal("100.00"), date(2026, 7, 27), "PAY-XL-002", Decimal("58.20"), Decimal("158.20"),
        Decimal("0.00"), Decimal("60.00"), Decimal("7.80"), Decimal("0.00"), Decimal("67.80"),
        Decimal("0.30"), date(2026, 7, 21), "SC-XL-001", Decimal("226.00"), "30天", Decimal("0.00"),
        "DOC-XL-001", date(2026, 7, 28), "SINV-XL-001", Decimal("226.00"), Decimal("0.00"),
        Decimal("0.00"), date(2026, 7, 29), "REC-XL-001", Decimal("100.00"), Decimal("44.2478"),
        date(2026, 7, 30), "REC-XL-002", Decimal("126.00"), Decimal("55.7522"), Decimal("226.00"),
        Decimal("0.00"), "进行中", Decimal("12.34"), Decimal("5.67"),
    ]
    assert len(values) == len(TEMPLATE_HEADERS) == 91
    for column, value in enumerate(values, start=1):
        worksheet.cell(3, column, value)
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def test_excel_template_import_export_round_trip(client: TestClient, headers: dict[str, str]) -> None:
    template_response = client.get("/api/orders/template", headers=headers)
    assert template_response.status_code == 200, template_response.text
    assert _action_count("download_order_template") == 1
    template = load_workbook(BytesIO(template_response.content), read_only=True, data_only=True)
    assert template["Sheet1"].cell(1, 1).value == "订单情况（王淼）"
    assert template["Sheet1"].cell(1, 39).value == "采购合同（周航）"
    assert [template["Sheet1"].cell(2, column).value for column in range(1, 92)] == TEMPLATE_HEADERS
    assert template["Sheet1"].cell(3, 2).value == SAMPLE_PROJECT_CODE
    assert template["Sheet1"].cell(3, 13).value == SAMPLE_ORDER_NO
    assert Decimal(str(template["Sheet1"].cell(3, 19).value)) == Decimal("0.13")
    assert template["Sheet1"].cell(3, 24).value == "示例采购厂商"
    assert Decimal(str(template["Sheet1"].cell(3, 25).value)) == Decimal("0.13")
    assert template["Sheet1"].cell(3, 90).value is None
    assert template["Sheet1"].cell(3, 91).value is None
    template.close()

    untouched_template = client.post(
        "/api/orders/import-excel?filename=市场部业务台账模板.xlsx",
        content=template_response.content,
        headers={**headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    assert untouched_template.status_code == 422, untouched_template.text
    assert "没有可导入的业务数据" in untouched_template.json()["detail"]
    assert _count("order_line") == 0

    partial_workbook = load_workbook(BytesIO(template_response.content))
    partial_workbook["Sheet1"].cell(3, 2, "XL-PARTIAL-EXAMPLE")
    partial_output = BytesIO()
    partial_workbook.save(partial_output)
    partial_workbook.close()
    partial_template = client.post(
        "/api/orders/import-excel?filename=市场部业务台账模板.xlsx",
        content=partial_output.getvalue(),
        headers={**headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    assert partial_template.status_code == 422, partial_template.text
    assert "仍包含示例占位内容" in partial_template.json()["detail"]
    assert _count("order_line") == 0

    content = _excel_import_file()
    import_response = client.post(
        "/api/orders/import-excel?filename=市场部业务台账模板.xlsx",
        content=content,
        headers={**headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    assert import_response.status_code == 200, import_response.text
    assert import_response.json()["success_rows"] == 1
    assert _count("order_line") == 1
    assert _count("finance_payment_entry") == 1
    assert _count("purchase_payment") == 2
    assert _count("sales_receipt") == 2
    with db() as conn:
        booked = conn.execute(text("SELECT booked_amount FROM finance_payment_entry")).scalar_one()
        purchase_info = conn.execute(
            text("SELECT supplier_name, labor_cost, other_cost FROM purchase_info")
        ).mappings().one()
    assert _d(booked) == Decimal("158.20")
    assert purchase_info["supplier_name"] == "Excel Supplier"
    assert _d(purchase_info["labor_cost"]) == Decimal("12.34")
    assert _d(purchase_info["other_cost"]) == Decimal("5.67")

    duplicate_response = client.post(
        "/api/orders/import-excel?filename=市场部业务台账模板.xlsx",
        content=content,
        headers={**headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    assert duplicate_response.status_code == 422, duplicate_response.text
    assert "整批回滚" in duplicate_response.json()["detail"]
    assert _count("order_line") == 1

    create_scoped_user = client.post(
        "/api/auth/users",
        json={
            "username": "excel-scope-user",
            "password": "Excel-Scope-Test-20260721!",
            "display_name": "Excel Scope User",
            "role_code": "order_entry",
            "permissions": ["order_entry"],
            "department_scope": ["OTHER"],
            "department_can_view": True,
            "department_can_entry": True,
        },
        headers=headers,
    )
    assert create_scoped_user.status_code == 200, create_scoped_user.text
    scoped_login = client.post(
        "/api/auth/login",
        json={"username": "excel-scope-user", "password": "Excel-Scope-Test-20260721!"},
    )
    assert scoped_login.status_code == 200, scoped_login.text
    scoped_headers = {"Authorization": f"Bearer {scoped_login.json()['access_token']}"}

    scoped_export_response = client.get("/api/orders/export", headers=scoped_headers)
    assert scoped_export_response.status_code == 200, scoped_export_response.text
    scoped_export = load_workbook(BytesIO(scoped_export_response.content), read_only=True, data_only=True)
    assert scoped_export["Sheet1"].max_row == 2
    scoped_export.close()

    forbidden_import = client.post(
        "/api/orders/import-excel?filename=市场部业务台账模板.xlsx",
        content=content,
        headers={**scoped_headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    assert forbidden_import.status_code == 403, forbidden_import.text
    assert "无权向部门" in forbidden_import.json()["detail"]
    assert _count("order_line") == 1

    export_response = client.get("/api/orders/export", headers=headers)
    assert export_response.status_code == 200, export_response.text
    assert _action_count("export_orders") == 2
    exported = load_workbook(BytesIO(export_response.content), read_only=True, data_only=True)
    worksheet = exported["Sheet1"]
    assert [worksheet.cell(2, column).value for column in range(1, 92)] == TEMPLATE_HEADERS
    assert worksheet.cell(3, 2).value == "XL-IMPORT-001"
    assert worksheet.cell(3, 24).value == "Excel Supplier"
    assert Decimal(str(worksheet.cell(3, 19).value)) == Decimal("0.13")
    assert Decimal(str(worksheet.cell(3, 25).value)) == Decimal("0.13")
    assert Decimal(str(worksheet.cell(3, 52).value)) == Decimal("158.2")
    assert Decimal(str(worksheet.cell(3, 87).value)) == Decimal("226")
    assert worksheet.cell(3, 90).value is None
    assert worksheet.cell(3, 91).value is None
    exported.close()


def _admin_user() -> CurrentUser:
    with db() as conn:
        user_id = conn.execute(text("SELECT id FROM erp_user WHERE username = 'admin'")).scalar_one()
    return CurrentUser(
        id=int(user_id),
        username="admin",
        display_name="admin",
        role_code="admin",
        permissions=sorted(ALL_PERMISSIONS),
        department_scope=[],
        department_can_view=True,
        department_can_entry=True,
    )


def test_tax_calculation_and_finance_entry_mapping(client: TestClient, headers: dict[str, str]) -> None:
    payload = _payload("TAX-MAP")
    payload.update(
        {
            "sales_tax_rate": "13.000000",
            "net_unit_price": "100.000000",
            "unit_price": "0.000000",
            "net_revenue": "0.00",
            "order_value": "0.00",
            "purchase_tax_rate": "13.000000",
            "purchase_unit_price_no_tax": "70.000000",
            "purchase_unit_price": "0.000000",
            "cost_no_tax": "0.00",
            "purchase_amount": "0.00",
            "labor_cost": "12.34",
            "other_cost": "5.67",
        }
    )
    created = client.post("/api/orders", json=payload, headers=headers)
    assert created.status_code == 200, created.text
    order_line_id = int(created.json()["order_line_id"])
    finance = _finance(order_line_id)
    assert _d(finance["sales_unit_price"]) == Decimal("113.000000")
    assert _d(finance["revenue_no_tax"]) == Decimal("1000.00")
    assert _d(finance["order_value"]) == Decimal("1130.00")
    assert _d(finance["sales_tax_amount"]) == Decimal("130.00")
    assert _d(finance["purchase_unit_price"]) == Decimal("79.100000")
    assert _d(finance["cost_no_tax"]) == Decimal("700.00")
    assert _d(finance["purchase_amount"]) == Decimal("791.00")
    assert _d(finance["purchase_tax_amount"]) == Decimal("91.00")
    assert _d(finance["labor_cost"]) == Decimal("12.34")
    assert _d(finance["other_cost"]) == Decimal("5.67")

    warehouse = client.post(
        f"/api/purchases/{order_line_id}/warehouse-entries",
        json={"warehouse_date": "2026-07-16", "voucher_no": "WH-TAX", "warehouse_amount": "791.00", "warehouse_amount_no_tax": "700.00"},
        headers=headers,
    )
    assert warehouse.status_code == 200, warehouse.text
    checked = client.post(
        f"/api/purchases/{order_line_id}/finance-invoice-checks",
        json={"received_invoice_date": "2026-07-17", "received_invoice_amount": "791.00", "voucher_code": "FI-TAX"},
        headers=headers,
    )
    assert checked.status_code == 200, checked.text
    paid = client.post(
        f"/api/purchases/{order_line_id}/finance-payments",
        json={"payment_date": "2026-07-18", "voucher_code": "FP-TAX", "booked_amount": "300.00"},
        headers=headers,
    )
    assert paid.status_code == 200, paid.text
    detail = paid.json()
    assert len(detail["warehouse_entries"]) == 1
    assert len(detail["finance_invoice_checks"]) == 1
    assert len(detail["finance_payments"]) == 1
    assert _d(detail["summary"]["total_finance_checked"]) == Decimal("791.00")
    assert _d(detail["summary"]["total_finance_paid"]) == Decimal("300.00")
    assert _d(detail["summary"]["financial_accounts_payable"]) == Decimal("491.00")


def test_order_user_change_audit_contains_chinese_context(client: TestClient, headers: dict[str, str]) -> None:
    order_line_id, payload = _create_order(client, headers, "AUDIT-USER")
    logs_before_query = _count("operation_log")
    query = client.get("/api/orders", params={"project_id": payload["project_code"]}, headers=headers)
    assert query.status_code == 200, query.text
    detail_query = client.get(f"/api/purchases/{order_line_id}", headers=headers)
    assert detail_query.status_code == 200, detail_query.text
    assert _count("operation_log") == logs_before_query

    updated = {**payload, "user_name": "修改后的用户"}
    response = client.put(f"/api/orders/{order_line_id}", json=updated, headers=headers)
    assert response.status_code == 200, response.text

    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT user_name, detail, status
                FROM operation_log
                WHERE action_name = 'update_order'
                ORDER BY id DESC LIMIT 1
                """
            )
        ).mappings().one()
    detail = json.loads(str(row["detail"]))
    assert row["user_name"] == "系统管理员（账号：admin）"
    assert row["status"] == "success"
    assert detail["before"]["end_user_name"] == "QA User"
    assert detail["after"]["end_user_name"] == "修改后的用户"
    assert detail["after"]["project_code"] == payload["project_code"]
    assert detail["after"]["order_no"] == payload["order_no"]
    assert detail["after"]["goods_name"] == payload["goods_name"]


def test_failed_data_change_is_logged_but_login_is_not(client: TestClient, headers: dict[str, str]) -> None:
    logs_before_login = _count("operation_log")
    login = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
    assert login.status_code == 200, login.text
    assert _count("operation_log") == logs_before_login

    invalid = client.post("/api/orders", json={"project_code": "缺少必填字段"}, headers=headers)
    assert invalid.status_code == 422, invalid.text
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT user_name, module_name, detail, status
                FROM operation_log
                WHERE action_name = 'create_failed'
                ORDER BY id DESC LIMIT 1
                """
            )
        ).mappings().one()
    detail = json.loads(str(row["detail"]))
    assert row["user_name"] == "系统管理员（账号：admin）"
    assert row["module_name"] == "订单管理"
    assert row["status"] == "failed"
    assert detail["summary"] == "新增数据失败：字段校验未通过"


@pytest.mark.parametrize("case", [f"N-{index:02d}" for index in range(1, 13)])
def test_normal_financial_cases(case: str, client: TestClient, headers: dict[str, str]) -> None:
    order_line_id, payload = _create_order(client, headers, case)

    if case == "N-01":
        finance = _finance(order_line_id)
        assert _d(finance["gross_profit_no_tax"]) == Decimal("300.00")
        assert _d(finance["gross_profit"]) == Decimal("339.00")
        assert _d(finance["accounts_receivable"]) == Decimal("1130.00")
        assert _d(finance["accounts_payable"]) == Decimal("791.00")
        assert _count("project") == _count("sales_order") == _count("order_line") == 1
        assert _count("purchase_info", "order_line_id = :id", id=order_line_id) == 1
        assert _count("delivery_record", "order_line_id = :id", id=order_line_id) == 1
        assert _d(_ledger(payload["project_code"])["order_amount"]) == Decimal("1130.00")
        assert _dashboard(client, headers) == {
            "orderAmount": 1130.0, "grossProfit": 339.0, "orderCount": 1,
            "accountsReceivable": 1130.0, "accountsPayable": 791.0, "closedCount": 0,
        }
        assert _action_count("create_order") == 1

    elif case == "N-02":
        response = client.post(
            f"/api/purchases/{order_line_id}/contracts",
            json={"purchase_contract_no": "PC-N02", "signed_amount": "791.00", "unsigned_amount": "0.00"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert _d(response.json()["summary"]["purchase_contract_signed_amount"]) == Decimal("791.00")
        assert _d(_finance(order_line_id)["accounts_payable"]) == Decimal("791.00")
        assert _action_count("create_purchase_contract") == 1

    elif case == "N-03":
        response = client.post(
            f"/api/purchases/{order_line_id}/invoices",
            json={"received_invoice_date": "2026-07-15", "invoice_no": "PI-N03", "invoice_amount": "791.00"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["invoices"][0]["phase_no"] == 1
        assert _d(response.json()["invoices"][0]["invoice_amount"]) == Decimal("791.00")
        assert _d(_finance(order_line_id)["accounts_payable"]) == Decimal("791.00")
        assert _action_count("create_purchase_invoice") == 1

    elif case == "N-04":
        response = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("300.00"), headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["payments"][0]["phase_no"] == 1
        assert response.json()["payments"][0]["due_payment_date"] == "2026-07-20"
        finance = _finance(order_line_id)
        assert _d(finance["total_paid"]) == Decimal("300.00")
        assert _d(finance["accounts_payable"]) == Decimal("491.00")
        assert _dashboard(client, headers)["accountsPayable"] == 491.0

    elif case == "N-05":
        client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("300.00"), headers=headers)
        response = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("491.00", "2026-07-25"), headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["payments"][1]["phase_no"] == 2
        assert response.json()["payments"][1]["due_payment_date"] is None
        finance = _finance(order_line_id)
        assert _d(finance["total_paid"]) == Decimal("791.00")
        assert _d(finance["accounts_payable"]) == Decimal("0.00")

    elif case == "N-06":
        response = client.post(
            f"/api/sales/{order_line_id}/contracts",
            json={"sales_contract_no": "SC-N06", "contract_value": "1130.00", "unsigned_contract_amount": "0.00"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert _d(response.json()["summary"]["sales_contract_value"]) == Decimal("1130.00")
        assert _d(_finance(order_line_id)["accounts_receivable"]) == Decimal("1130.00")
        assert _action_count("create_sales_contract") == 1

    elif case == "N-07":
        response = client.post(
            f"/api/sales/{order_line_id}/invoices",
            json={
                "invoice_doc_no": "SID-N07", "invoice_date": "2026-07-20", "invoice_no": "SI-N07",
                "invoice_amount": "565.00", "pending_invoice_amount": "565.00",
                "delivered_not_invoiced_amount": "0.00",
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["invoices"][0]["phase_no"] == 1
        assert _d(_finance(order_line_id)["sales_invoice_amount"]) == Decimal("565.00")
        assert _d(_finance(order_line_id)["accounts_receivable"]) == Decimal("1130.00")
        sales_rows = client.get("/api/sales", headers=headers)
        assert sales_rows.status_code == 200, sales_rows.text
        sales_row = next(item for item in sales_rows.json()["items"] if item["order_line_id"] == order_line_id)
        assert sales_row["invoice_dates"] == "2026-07-20"

    elif case == "N-08":
        response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("400.00", "35.398230"), headers=headers)
        assert response.status_code == 200, response.text
        finance = _finance(order_line_id)
        assert _d(finance["total_received"]) == Decimal("400.00")
        assert _d(finance["accounts_receivable"]) == Decimal("730.00")
        assert _dashboard(client, headers)["closedCount"] == 0

    elif case == "N-09":
        client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("400.00"), headers=headers)
        response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("730.00"), headers=headers)
        assert response.status_code == 200, response.text
        finance = _finance(order_line_id)
        assert _d(finance["total_received"]) == Decimal("1130.00")
        assert _d(finance["accounts_receivable"]) == Decimal("0.00")
        assert _ledger(payload["project_code"])["computed_close_status"] == "closed"
        assert _dashboard(client, headers)["closedCount"] == 1

    elif case == "N-10":
        first = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("300.00"), headers=headers)
        client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("491.00"), headers=headers)
        payment_id = first.json()["payments"][0]["id"]
        response = client.put(f"/api/purchases/payments/{payment_id}", json=_payment("250.00"), headers=headers)
        assert response.status_code == 200, response.text
        assert _count("purchase_payment", "order_line_id = :id", id=order_line_id) == 2
        finance = _finance(order_line_id)
        assert _d(finance["total_paid"]) == Decimal("741.00")
        assert _d(finance["accounts_payable"]) == Decimal("50.00")
        with db() as conn:
            detail = conn.execute(text("SELECT detail FROM operation_log WHERE action_name = 'update_purchase_payment'")).scalar_one()
        assert '"300.00"' in detail and '"250.00"' in detail

    elif case == "N-11":
        client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("400.00"), headers=headers)
        second = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("730.00"), headers=headers)
        receipt_id = second.json()["receipts"][1]["id"]
        response = client.delete(f"/api/sales/receipts/{receipt_id}", headers=headers)
        assert response.status_code == 200, response.text
        assert _count("sales_receipt", "id = :id AND deleted_at IS NOT NULL", id=receipt_id) == 1
        finance = _finance(order_line_id)
        assert _d(finance["total_received"]) == Decimal("400.00")
        assert _d(finance["accounts_receivable"]) == Decimal("730.00")
        assert _dashboard(client, headers)["closedCount"] == 0

    elif case == "N-12":
        response = client.delete(f"/api/orders/{order_line_id}", headers=headers)
        assert response.status_code == 200, response.text
        assert _count("order_line", "id = :id AND deleted_at IS NOT NULL", id=order_line_id) == 1
        assert _count("sales_order", "deleted_at IS NOT NULL") == 1
        assert _count("v_order_line_finance", "order_line_id = :id", id=order_line_id) == 0
        listed = client.get("/api/orders", params={"project_id": payload["project_code"]}, headers=headers)
        assert listed.status_code == 200
        assert listed.json()["total"] == 0
        assert _action_count("delete_order") == 1


@pytest.mark.parametrize("case", [f"B-{index:02d}" for index in range(1, 9)])
def test_boundary_financial_cases(case: str, client: TestClient, headers: dict[str, str]) -> None:
    if case == "B-01":
        maximum = "9999999999999999.99"
        order_line_id, payload = _create_order(client, headers, case, order_value=maximum, purchase_amount="0.00")
        assert _d(_finance(order_line_id)["order_value"]) == Decimal(maximum)
        response = client.get("/api/orders", params={"project_id": payload["project_code"]}, headers=headers)
        assert response.status_code == 200, response.text
        assert _d(response.json()["items"][0]["order_value"]) == Decimal(maximum)

    elif case == "B-02":
        quantity = "999999999999.999999"
        order_line_id, _ = _create_order(
            client, headers, case, quantity=quantity, net_unit_price=quantity, unit_price=quantity,
            order_value="9999999999999999.99", purchase_amount="0.00",
        )
        with db() as conn:
            stored = conn.execute(text("SELECT quantity FROM order_line WHERE id = :id"), {"id": order_line_id}).scalar_one()
        assert _d(stored) == Decimal(quantity)

    elif case == "B-03":
        order_line_id, _ = _create_order(client, headers, case, quantity="0.000000", delivery_quantity="0.000000")
        response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("0.00", "100.000000"), headers=headers)
        assert response.status_code == 200, response.text
        finance = _finance(order_line_id)
        assert _d(finance["total_received"]) == Decimal("0.00")
        assert _d(finance["accounts_receivable"]) == Decimal("1130.00")
        assert _dashboard(client, headers)["closedCount"] == 0

    elif case == "B-04":
        _, payload = _create_order(client, headers, case, order_date="2099-12-31")
        logs_before = _count("operation_log")
        for limit in (1, 500):
            response = client.get("/api/orders", params={"project_id": payload["project_code"], "limit": limit, "offset": 0}, headers=headers)
            assert response.status_code == 200, response.text
            assert len(response.json()["items"]) <= limit
        assert _count("operation_log") == logs_before

    elif case == "B-05":
        order_line_id, _ = _create_order(client, headers, case)
        client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("100.00"), headers=headers)
        second = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("100.00"), headers=headers)
        payment_id = second.json()["payments"][1]["id"]
        assert client.delete(f"/api/purchases/payments/{payment_id}", headers=headers).status_code == 200
        third = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("100.00"), headers=headers)
        assert [item["phase_no"] for item in third.json()["payments"]] == [1, 3]
        assert _d(_finance(order_line_id)["total_paid"]) == Decimal("200.00")

    elif case == "B-06":
        order_line_id, _ = _create_order(client, headers, case)
        record = purchases.PurchasePaymentCreate(payment_amount=Decimal("1.00"), payment_date=date(2026, 7, 20))
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [pool.submit(purchases.add_purchase_payment, order_line_id, record, _admin_user()) for _ in range(2)]
            [result.result() for result in results]
        with db() as conn:
            phases = conn.execute(
                text("SELECT phase_no FROM purchase_payment WHERE order_line_id = :id AND deleted_at IS NULL ORDER BY phase_no"),
                {"id": order_line_id},
            ).scalars().all()
        assert phases == [1, 2]
        assert _d(_finance(order_line_id)["total_paid"]) == Decimal("2.00")

    elif case == "B-07":
        order_line_id, _ = _create_order(client, headers, case)
        client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("1129.99"), headers=headers)
        client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("0.01"), headers=headers)
        client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("790.99"), headers=headers)
        client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("0.01"), headers=headers)
        finance = _finance(order_line_id)
        assert _d(finance["accounts_receivable"]) == Decimal("0.00")
        assert _d(finance["accounts_payable"]) == Decimal("0.00")
        assert _dashboard(client, headers)["closedCount"] == 1

    elif case == "B-08":
        order_line_id, _ = _create_order(client, headers, case)
        assert client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("1130.00"), headers=headers).status_code == 200
        assert client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("791.00"), headers=headers).status_code == 200
        receipt_before = _count("sales_receipt", "order_line_id = :id", id=order_line_id)
        payment_before = _count("purchase_payment", "order_line_id = :id", id=order_line_id)
        receipt_response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("0.01"), headers=headers)
        payment_response = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("0.01"), headers=headers)
        receipt_after = _count("sales_receipt", "order_line_id = :id", id=order_line_id)
        payment_after = _count("purchase_payment", "order_line_id = :id", id=order_line_id)
        finance = _finance(order_line_id)
        assert (receipt_response.status_code, payment_response.status_code) == (422, 422), {
            "receipt_count_before_after": (receipt_before, receipt_after),
            "payment_count_before_after": (payment_before, payment_after),
            "accounts_receivable": str(finance["accounts_receivable"]),
            "accounts_payable": str(finance["accounts_payable"]),
        }
        assert (receipt_after, payment_after) == (receipt_before, payment_before)
        assert _d(finance["accounts_receivable"]) == Decimal("0.00")
        assert _d(finance["accounts_payable"]) == Decimal("0.00")


@pytest.mark.parametrize("case", [f"I-{index:02d}" for index in range(1, 13)])
def test_invalid_input_cases(case: str, client: TestClient, headers: dict[str, str]) -> None:
    if case == "I-01":
        order_payload = {"project_code": "QA-I01", "order_no": "SO-I01", "goods_name": "x", "customer_unit_name": "y", "order_value": "-0.01"}
        assert client.post("/api/orders", json=order_payload, headers=headers).status_code == 422
        order_line_id, _ = _create_order(client, headers, case)
        assert client.post(f"/api/purchases/{order_line_id}/payments", json=_payment("-1.00"), headers=headers).status_code == 422
        assert client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("-1.00"), headers=headers).status_code == 422
        assert _count("purchase_payment") == _count("sales_receipt") == 0
        assert _d(_finance(order_line_id)["accounts_payable"]) == Decimal("791.00")

    elif case == "I-02":
        order_line_id, _ = _create_order(client, headers, case)
        for amount in ("100.001", "99999999999999999.99", "NaN", "Infinity", "not-a-number"):
            response = client.post(f"/api/purchases/{order_line_id}/payments", json=_payment(amount), headers=headers)
            assert response.status_code == 422, response.text
        assert _count("purchase_payment") == 0
        assert _d(_finance(order_line_id)["accounts_payable"]) == Decimal("791.00")

    elif case == "I-03":
        payload = _payload(case)
        payload["quantity"] = "1.0000001"
        response = client.post("/api/orders", json=payload, headers=headers)
        assert response.status_code == 422, response.text
        assert _count("project") == _count("sales_order") == _count("order_line") == 0

    elif case == "I-04":
        for bad_date in ("not-a-date", "2026-02-30", "2100-01-01"):
            payload = _payload(f"{case}-{bad_date[:4]}")
            payload["order_date"] = bad_date
            response = client.post("/api/orders", json=payload, headers=headers)
            assert response.status_code == 422, response.text
        assert _count("order_line") == 0
        assert _action_count("create_order") == 0

    elif case == "I-05":
        order_line_id, _ = _create_order(client, headers, case)
        for ratio in ("-0.000001", "100.000001", "1.0000001"):
            response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("1.00", ratio), headers=headers)
            assert response.status_code == 422, response.text
        assert _count("sales_receipt") == 0

    elif case == "I-06":
        for field in ("project_code", "order_no", "goods_name", "customer_unit_name", "order_value"):
            payload = _payload(f"{case}-{field}")
            payload.pop(field)
            response = client.post("/api/orders", json=payload, headers=headers)
            assert response.status_code == 422, response.text
        assert _count("project") == _count("sales_order") == _count("order_line") == 0

    elif case == "I-07":
        order_line_id, payload = _create_order(client, headers, case)
        payload["quantity"] = "99.000000"
        response = client.post("/api/orders", json=payload, headers=headers)
        assert response.status_code == 409, response.text
        with db() as conn:
            quantity = conn.execute(text("SELECT quantity FROM order_line WHERE id = :id"), {"id": order_line_id}).scalar_one()
        assert _d(quantity) == Decimal("10.0000")
        assert _count("order_line") == 1
        assert _action_count("create_order") == 1

    elif case == "I-08":
        valid = _payload("I08-valid")
        invalid = _payload("I08-invalid")
        invalid["order_value"] = "-1.00"
        response = client.post("/api/orders/batch", json={"items": [valid, invalid]}, headers=headers)
        assert response.status_code == 422, response.text
        assert _count("project") == _count("sales_order") == _count("order_line") == 0
        assert _action_count("batch_create_orders") == 0

    elif case == "I-09":
        response = client.post("/api/sales/999999/receipts", json=_receipt("1.00"), headers=headers)
        assert response.status_code == 404, response.text
        order_line_id, _ = _create_order(client, headers, case)
        created = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("1.00"), headers=headers)
        receipt_id = created.json()["receipts"][0]["id"]
        assert client.delete(f"/api/sales/receipts/{receipt_id}", headers=headers).status_code == 200
        assert client.put(f"/api/sales/receipts/{receipt_id}", json=_receipt("2.00"), headers=headers).status_code == 404
        assert _count("sales_receipt", "id = :id AND deleted_at IS NOT NULL", id=receipt_id) == 1

    elif case == "I-10":
        order_line_id, _ = _create_order(client, headers, case)
        created = client.post(
            "/api/auth/users",
            json={"username": "viewer-i10", "password": "Viewer-Test-20260714!", "display_name": "Viewer", "role_code": "viewer"},
            headers=headers,
        )
        assert created.status_code == 200, created.text
        login = client.post("/api/auth/login", json={"username": "viewer-i10", "password": "Viewer-Test-20260714!"})
        viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        response = client.post(f"/api/sales/{order_line_id}/receipts", json=_receipt("1.00"), headers=viewer_headers)
        assert response.status_code == 403, response.text
        assert _count("sales_receipt") == 0
        assert _d(_finance(order_line_id)["accounts_receivable"]) == Decimal("1130.00")

    elif case == "I-11":
        _create_order(client, headers, case)
        logs_before = _count("operation_log")
        for params in ({"limit": 0}, {"limit": 501}, {"offset": -1}):
            response = client.get("/api/orders", params=params, headers=headers)
            assert response.status_code == 422, response.text
        assert _count("operation_log") == logs_before

    elif case == "I-12":
        payload = _payload(case)
        payload["project_code"] = "P" * 65
        response = client.post("/api/orders", json=payload, headers=headers)
        assert _count("project") == _count("sales_order") == _count("order_line") == 0
        assert response.status_code == 422, response.text
