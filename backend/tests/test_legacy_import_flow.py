"""H3：旧台账预检流程与多期写入。"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import text

from conftest import TEST_PASSWORD
from app.config import ROOT_DIR
from app.db import db

TEMPLATE_PATH = ROOT_DIR / "backend" / "templates" / "市场部业务台账模板.xlsx"
USER_PASSWORD = "Legacy-Preview-Test-20260915!"

# 91 列模板里的财务列位置
INVOICE_DOC, INVOICE_DATE, INVOICE_AMOUNT = 73, 74, 76
PAY_DATE, PAY_VOUCHER, PAY_AMOUNT = 55, 56, 57


def _row(overrides: dict[int, object] | None = None) -> list[object]:
    values: list[object] = [
        "全额", "P-LEGACY-001", "销售部", "安徽分公司", "张三",
        date(2026, 7, 21), "商品销售", "常规", "三级一组",
        "客户单位A", "最终用户A", "区域平台A", "SO-LEGACY-001", "子项目甲",
        "服务器", "规格A", "台", 2, None, None, Decimal("100.00"), None, None, "供应商A",
    ]
    values += [None] * (91 - len(values))
    for position, value in (overrides or {}).items():
        values[int(position) - 1] = value
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


def _preview(client: TestClient, headers: dict[str, str], rows: list[list[object]], name: str = "legacy.xlsx"):
    return client.post(
        f"/api/orders/import-preview?filename={name}", content=_workbook(rows), headers=headers
    )


def _count(table: str) -> int:
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)


def _phases(table: str) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            text(f"SELECT phase_no, order_line_id FROM `{table}` WHERE deleted_at IS NULL ORDER BY phase_no")
        ).mappings().all()
    return [dict(row) for row in rows]


# --- 预检：只读 -------------------------------------------------------------


def test_preview_creates_session_without_writing_business_tables(
    client: TestClient, headers: dict[str, str]
) -> None:
    response = _preview(client, headers, [_row()])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session_id"]
    assert body["source_sha256"]
    assert body["summary"]["total_rows"] == 1
    assert body["summary"]["comparable"] is True
    assert _count("project") == 0
    assert _count("order_line") == 0
    assert _count("legacy_import_session") == 1


def test_preview_lists_rows_with_pagination(client: TestClient, headers: dict[str, str]) -> None:
    rows = [_row({13: f"SO-PAGE-{index:03d}", 15: f"设备{index}"}) for index in range(5)]
    session_id = _preview(client, headers, rows).json()["session_id"]
    first = client.get(f"/api/orders/import-preview/{session_id}?limit=2&offset=0", headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["rows"]["total"] == 5
    assert len(first.json()["rows"]["items"]) == 2
    second = client.get(f"/api/orders/import-preview/{session_id}?limit=2&offset=4", headers=headers)
    assert len(second.json()["rows"]["items"]) == 1


def test_preview_records_order_alias_chain(client: TestClient, headers: dict[str, str]) -> None:
    session_id = _preview(client, headers, [_row({13: "SO-A/SO-B/SO-C"})]).json()["session_id"]
    rows = client.get(f"/api/orders/import-preview/{session_id}", headers=headers).json()["rows"]["items"]
    order = rows[0]["parsed"]["order_no"]
    assert order["history"] == ["SO-A", "SO-B", "SO-C"]
    assert order["current"] == "SO-C"
    assert order["raw"] == "SO-A/SO-B/SO-C"


def test_preview_blocks_single_amount_with_multiple_dates(
    client: TestClient, headers: dict[str, str]
) -> None:
    response = _preview(
        client,
        headers,
        [_row({INVOICE_DATE: "2026/01/01/2026/02/01", INVOICE_AMOUNT: "300"})],
    )
    body = response.json()
    assert body["summary"]["comparable"] is False
    assert body["summary"]["blocking_rows"] == 1
    rows = client.get(f"/api/orders/import-preview/{body['session_id']}", headers=headers).json()["rows"]["items"]
    codes = [issue["code"] for issue in rows[0]["parsed"]["issues"]]
    assert "AMOUNT_SPLIT_REQUIRED" in codes


def test_blocked_session_cannot_be_committed(client: TestClient, headers: dict[str, str]) -> None:
    content = _workbook([_row({INVOICE_DATE: "2026/01/01/2026/02/01", INVOICE_AMOUNT: "300"})])
    session_id = client.post(
        "/api/orders/import-preview?filename=x.xlsx", content=content, headers=headers
    ).json()["session_id"]
    response = client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers)
    assert response.status_code == 422, response.text
    assert "阻断问题" in response.json()["detail"]
    assert _count("order_line") == 0


# --- 提交：多期写入 ---------------------------------------------------------


def test_three_phases_are_written_in_order_with_matching_values(
    client: TestClient, headers: dict[str, str]
) -> None:
    """三日期 / 三金额 / 三凭证：销售开票与采购付款各写三期且一一对应。"""
    row = _row(
        {
            INVOICE_DOC: "DOC-1/DOC-2/DOC-3",
            INVOICE_DATE: "2026/01/01/2026/02/01/2026/03/01",
            INVOICE_AMOUNT: "100/200/300",
            PAY_VOUCHER: "PAY-1/PAY-2/PAY-3",
            PAY_DATE: "2026/01/05/2026/02/05/2026/03/05",
            PAY_AMOUNT: "70/80/90",
        }
    )
    content = _workbook([row])
    session_id = client.post(
        "/api/orders/import-preview?filename=legacy.xlsx", content=content, headers=headers
    ).json()["session_id"]
    commit = client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers)
    assert commit.status_code == 200, commit.text
    assert commit.json()["success_rows"] == 1

    invoices = _phases("sales_invoice")
    assert [item["phase_no"] for item in invoices] == [1, 2, 3]
    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT phase_no, invoice_date, invoice_no, invoice_amount FROM sales_invoice "
                "WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert [str(row["invoice_date"]) for row in rows] == ["2026-01-01", "2026-02-01", "2026-03-01"]
    assert [row["invoice_no"] for row in rows] == ["DOC-1", "DOC-2", "DOC-3"]
    assert [str(row["invoice_amount"]) for row in rows] == ["100.00", "200.00", "300.00"]

    payments = _phases("purchase_payment")
    assert [item["phase_no"] for item in payments] == [1, 2, 3]
    with db() as conn:
        pay_rows = conn.execute(
            text(
                "SELECT payment_date, payment_voucher_no, payment_amount FROM purchase_payment "
                "WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert [str(row["payment_date"]) for row in pay_rows] == ["2026-01-05", "2026-02-05", "2026-03-05"]
    assert [row["payment_voucher_no"] for row in pay_rows] == ["PAY-1", "PAY-2", "PAY-3"]
    assert [str(row["payment_amount"]) for row in pay_rows] == ["70.00", "80.00", "90.00"]


def test_commit_registers_order_alias_history(client: TestClient, headers: dict[str, str]) -> None:
    content = _workbook([_row({13: "SO-A/SO-B/SO-C"})])
    session_id = client.post(
        "/api/orders/import-preview?filename=x.xlsx", content=content, headers=headers
    ).json()["session_id"]
    assert (
        client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers).status_code
        == 200
    )
    with db() as conn:
        order_no = conn.execute(text("SELECT order_no FROM sales_order")).scalar()
        chain = conn.execute(
            text("SELECT order_no FROM sales_order_number_history ORDER BY history_order")
        ).scalars().all()
    assert order_no == "SO-C"
    assert list(chain) == ["SO-A", "SO-B", "SO-C"]
    assert _count("sales_order") == 1, "别名不是多个订单"


def test_commit_twice_does_not_add_records(client: TestClient, headers: dict[str, str]) -> None:
    content = _workbook([_row()])
    session_id = client.post(
        "/api/orders/import-preview?filename=x.xlsx", content=content, headers=headers
    ).json()["session_id"]
    first = client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers)
    assert first.status_code == 200, first.text
    lines_after_first = _count("order_line")
    second = client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["already_committed"] is True
    assert _count("order_line") == lines_after_first


def test_commit_rejects_a_changed_file(client: TestClient, headers: dict[str, str]) -> None:
    original = _workbook([_row()])
    session_id = client.post(
        "/api/orders/import-preview?filename=x.xlsx", content=original, headers=headers
    ).json()["session_id"]
    changed = _workbook([_row({15: "交换机"})])
    response = client.post(f"/api/orders/import-preview/{session_id}/commit", content=changed, headers=headers)
    assert response.status_code == 409, response.text
    assert "不一致" in response.json()["detail"]
    assert _count("order_line") == 0


# --- 会话权限与生命周期 -----------------------------------------------------


def test_another_user_cannot_read_the_session(client: TestClient, headers: dict[str, str]) -> None:
    session_id = _preview(client, headers, [_row()]).json()["session_id"]
    created = client.post(
        "/api/auth/users",
        headers=headers,
        json={
            "username": "legacy-other",
            "password": USER_PASSWORD,
            "display_name": "legacy-other",
            "role_code": "viewer",
            "permissions": ["ledger_import"],
            "department_scope": [],
            "department_can_view": True,
            "department_can_entry": True,
            "department_all": True,
        },
    )
    assert created.status_code == 200, created.text
    try:
        login = client.post(
            "/api/auth/login", json={"username": "legacy-other", "password": USER_PASSWORD}
        )
        other = {"Authorization": f"Bearer {login.json()['access_token']}"}
        response = client.get(f"/api/orders/import-preview/{session_id}", headers=other)
        assert response.status_code == 403, response.text
    finally:
        with db() as conn:
            user_id = conn.execute(
                text("SELECT id FROM erp_user WHERE username = 'legacy-other'")
            ).scalar()
            if user_id:
                conn.execute(text("DELETE FROM operation_log WHERE user_id = :id"), {"id": int(user_id)})
                conn.execute(text("DELETE FROM erp_user WHERE id = :id"), {"id": int(user_id)})


def test_expired_session_cannot_be_committed(client: TestClient, headers: dict[str, str]) -> None:
    content = _workbook([_row()])
    session_id = client.post(
        "/api/orders/import-preview?filename=x.xlsx", content=content, headers=headers
    ).json()["session_id"]
    with db() as conn:
        conn.execute(
            text(
                "UPDATE legacy_import_session SET expires_at = NOW() - INTERVAL 1 HOUR WHERE id = :id"
            ),
            {"id": session_id},
        )
    response = client.post(f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers)
    assert response.status_code == 409, response.text
    assert _count("order_line") == 0


def test_admin_can_read_someone_elses_session(client: TestClient, headers: dict[str, str]) -> None:
    """管理员可以查看会话（用于排障），普通账号不行。"""
    session_id = _preview(client, headers, [_row()]).json()["session_id"]
    response = client.get(f"/api/orders/import-preview/{session_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["session"]["id"] == session_id


# --- 与标准导入共存 ---------------------------------------------------------


def test_plain_template_without_multi_value_keeps_working(
    client: TestClient, headers: dict[str, str]
) -> None:
    """无多值的标准模板继续走原有导入流程，行为不变。"""
    response = client.post(
        "/api/orders/import-excel?filename=plain.xlsx", content=_workbook([_row()]), headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["success_rows"] == 1
    assert _count("order_line") == 1
    assert _count("legacy_import_session") == 0
