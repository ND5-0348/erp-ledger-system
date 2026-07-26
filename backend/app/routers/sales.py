from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from ..audit import write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..db import db
from ..ledger_excel import editor_columns, editor_rows_for_order_lines
from ..serializers import clean_row, clean_rows
from ..validation import BusinessDate, Money, Ratio

router = APIRouter(prefix="/api/sales", tags=["sales"])


class SalesContractCreate(BaseModel):
    contract_signed_date: BusinessDate | None = None
    sales_contract_no: str | None = None
    contract_value: Money | None = None
    performance_period: str | None = None
    unsigned_contract_amount: Money | None = None


class SalesInvoiceCreate(BaseModel):
    invoice_doc_no: str | None = None
    invoice_date: BusinessDate | None = None
    invoice_no: str | None = None
    invoice_amount: Money
    pending_invoice_amount: Money | None = None
    delivered_not_invoiced_amount: Money | None = None


class SalesReceiptCreate(BaseModel):
    receipt_date: BusinessDate | None = None
    payment_notice_no: str | None = None
    receipt_amount: Money
    receipt_ratio: Ratio | None = None


class SalesBatchFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_signed_date: BusinessDate | None = None
    sales_contract_no: str | None = None
    sales_contract_value: Money | None = None
    sales_performance_period: str | None = None
    sales_unsigned_contract_amount: Money | None = None
    invoice_doc_no: str | None = None
    invoice_date: BusinessDate | None = None
    sales_invoice_no: str | None = None
    sales_invoice_amount: Money | None = None
    pending_invoice_amount: Money | None = None
    delivered_not_invoiced_amount: Money | None = None
    receipt1_date: BusinessDate | None = None
    receipt1_notice_no: str | None = None
    receipt1_amount: Money | None = None
    receipt1_ratio: Ratio | None = None
    receipt2_date: BusinessDate | None = None
    receipt2_notice_no: str | None = None
    receipt2_amount: Money | None = None
    receipt2_ratio: Ratio | None = None
    close_status: str | None = None
    labor_cost: Money | None = None
    other_cost: Money | None = None


class SalesBatchUpdateItem(SalesBatchFields):
    order_line_id: int = Field(gt=0)


class SalesBatchUpdate(BaseModel):
    items: list[SalesBatchUpdateItem] = Field(min_length=1, max_length=500)


class SalesOrderLineSelection(BaseModel):
    order_line_ids: list[int] = Field(min_length=1, max_length=500)


SUMMARY_AMOUNT_FIELDS = {
    "order_value",
    "purchase_amount",
    "delivery_value",
    "purchase_contract_signed_amount",
    "sales_contract_value",
    "sales_invoice_amount",
    "total_received",
    "accounts_receivable",
    "gross_profit",
}


@router.get("")
def list_sales(
    project_id: str | None = None,
    order_id: str | None = None,
    manager: str | None = None,
    department: str | None = None,
    supplier_name: str | None = None,
    contract_no: str | None = None,
    receipt_date: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    conditions = ["1=1"]
    params: dict[str, object] = {"limit": limit, "offset": offset}
    if project_id:
        conditions.append("project_code LIKE :project_id")
        params["project_id"] = f"%{project_id}%"
    if order_id:
        conditions.append("order_no LIKE :order_id")
        params["order_id"] = f"%{order_id}%"
    if manager:
        conditions.append("account_manager LIKE :manager")
        params["manager"] = f"%{manager}%"
    if department:
        conditions.append("department = :department")
        params["department"] = department
    if supplier_name:
        conditions.append("supplier_name LIKE :supplier_name")
        params["supplier_name"] = f"%{supplier_name}%"
    if contract_no:
        conditions.append("sales_contract_no LIKE :contract_no")
        params["contract_no"] = f"%{contract_no}%"
    if receipt_date:
        conditions.append("latest_receipt_date = :receipt_date")
        params["receipt_date"] = receipt_date
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    source_sql = """
        SELECT v.*,
               (
                 SELECT MAX(sr.receipt_date)
                 FROM sales_receipt sr
                 WHERE sr.order_line_id = v.order_line_id
                   AND sr.deleted_at IS NULL
               ) AS latest_receipt_date,
               (
                 SELECT GROUP_CONCAT(DISTINCT si.invoice_date ORDER BY si.invoice_date SEPARATOR ',')
                 FROM sales_invoice si
                 WHERE si.order_line_id = v.order_line_id
                   AND si.deleted_at IS NULL
                   AND si.invoice_date IS NOT NULL
               ) AS invoice_dates
        FROM v_order_line_finance v
    """
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM ({source_sql}) sales_detail WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT order_line_id, project_code, order_no, account_manager, department, supplier_name, sales_contract_no,
                       sales_contract_signed_date, sales_contract_value, sales_invoice_amount,
                       total_received, accounts_receivable, latest_receipt_date, invoice_dates
                FROM ({source_sql}) sales_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, project_code
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.post("/batch-editor/rows")
def get_sales_batch_editor_rows(
    payload: SalesOrderLineSelection,
    user: CurrentUser = Depends(require_permission("sales_edit")),
) -> dict:
    unique_ids = list(dict.fromkeys(payload.order_line_ids))
    with db() as conn:
        rows = editor_rows_for_order_lines(conn, user, unique_ids)
    if len(rows) != len(unique_ids):
        raise HTTPException(status_code=404, detail="部分订单明细不存在或当前账号无权访问")
    return {
        "editable_from": "BP",
        "editable_through": "CM",
        "fixed_columns": ["B", "C", "D", "E", "F", "G", "M", "N", "O"],
        "columns": editor_columns("sales"),
        "rows": rows,
    }


@router.put("/batch")
def update_sales_batch(
    payload: SalesBatchUpdate,
    user: CurrentUser = Depends(require_permission("sales_edit")),
) -> dict:
    order_line_ids = [item.order_line_id for item in payload.items]
    if len(set(order_line_ids)) != len(order_line_ids):
        raise HTTPException(status_code=422, detail="批量修改中不能重复提交同一条订单明细")

    prepared: list[tuple[int, dict[str, object], dict[str, object]]] = []
    close_status_by_order: dict[int, str | None] = {}
    with db() as conn:
        for item in payload.items:
            order_line = _ensure_order_line_in_conn(conn, item.order_line_id, user, lock=True)
            data = _payload_dict(item)
            data.pop("order_line_id", None)
            sales_order_id = int(order_line["sales_order_id"])
            close_status = _normalized_optional_text(data.get("close_status"))
            if (
                sales_order_id in close_status_by_order
                and close_status_by_order[sales_order_id] != close_status
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"同一销售订单的 CK 列“是否关闭”必须保持一致（订单ID {sales_order_id}）",
                )
            close_status_by_order[sales_order_id] = close_status
            data["close_status"] = close_status
            prepared.append((item.order_line_id, order_line, data))

        for order_line_id, order_line, data in prepared:
            _validate_sales_batch_item(conn, order_line_id, order_line, data)

        for order_line_id, _, data in prepared:
            _save_sales_batch_item(conn, order_line_id, data)

        for sales_order_id, close_status in close_status_by_order.items():
            conn.execute(
                text("UPDATE sales_order SET close_status = :close_status WHERE id = :sales_order_id"),
                {"sales_order_id": sales_order_id, "close_status": close_status},
            )

        write_operation_log(
            conn,
            user,
            "销售管理",
            "batch_update_sales",
            f"在线表格批量修改 {len(prepared)} 条销售信息",
            after={"order_line_ids": order_line_ids, "editable_columns": "BP-CM（CI-CJ自动汇总列只读）"},
        )
    return {"updated": len(prepared), "order_line_ids": order_line_ids}


@router.get("/by-order")
def get_sales_detail_by_order(project_id: str, order_id: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    with db() as conn:
        summary_rows = conn.execute(
            text(
                """
                SELECT order_line_id, project_code, order_no, department, branch_company,
                       account_manager, order_date, business_type, statistic_category,
                       customer_unit_name, project_name, close_status, goods_name,
                       specification_model, unit_name, quantity, sales_tax_rate,
                       sales_unit_price_no_tax, sales_unit_price, revenue_no_tax, order_value,
                       sales_tax_amount, supplier_name, purchase_tax_rate,
                       purchase_unit_price_no_tax, purchase_unit_price, cost_no_tax,
                       purchase_amount, purchase_tax_amount, labor_cost, other_cost,
                       delivery_quantity, delivery_value,
                       purchase_contract_no, purchase_contract_signed_amount,
                       sales_contract_no, sales_contract_signed_date, sales_contract_value,
                       sales_invoice_amount, total_received, accounts_receivable,
                       gross_profit_no_tax, gross_profit_margin_no_tax, gross_profit
                FROM v_order_line_finance
                WHERE project_code = :project_id AND order_no = :order_id
                ORDER BY order_line_id
                """
            ),
            {"project_id": project_id, "order_id": order_id},
        ).mappings().all()
        if not summary_rows:
            raise HTTPException(status_code=404, detail="Sales order not found")
        if any(
            not can_access_department(user, str(row["department"]) if row["department"] is not None else None)
            for row in summary_rows
        ):
            raise HTTPException(status_code=403, detail="Department permission denied")

        line_filter_sql = """
            SELECT order_line_id
            FROM v_order_line_finance
            WHERE project_code = :project_id AND order_no = :order_id
        """
        contracts = conn.execute(
            text(
                f"""
                SELECT id, order_line_id, contract_signed_date, contract_signed_date_text,
                       sales_contract_no, contract_value, performance_period,
                       unsigned_contract_amount, created_at
                FROM sales_contract
                WHERE order_line_id IN ({line_filter_sql}) AND deleted_at IS NULL
                ORDER BY order_line_id, id
                """
            ),
            {"project_id": project_id, "order_id": order_id},
        ).mappings().all()
        invoices = conn.execute(
            text(
                f"""
                SELECT id, order_line_id, phase_no, invoice_doc_no, invoice_date,
                       invoice_date_text, invoice_no, invoice_amount,
                       pending_invoice_amount, delivered_not_invoiced_amount, created_at
                FROM sales_invoice
                WHERE order_line_id IN ({line_filter_sql}) AND deleted_at IS NULL
                ORDER BY order_line_id, phase_no, id
                """
            ),
            {"project_id": project_id, "order_id": order_id},
        ).mappings().all()
        receipts = conn.execute(
            text(
                f"""
                SELECT id, order_line_id, phase_no, receipt_date, receipt_date_text,
                       payment_notice_no, receipt_amount, receipt_ratio, created_at
                FROM sales_receipt
                WHERE order_line_id IN ({line_filter_sql}) AND deleted_at IS NULL
                ORDER BY order_line_id, phase_no, id
                """
            ),
            {"project_id": project_id, "order_id": order_id},
        ).mappings().all()

    return {
        "summary": clean_row(_aggregate_summary(summary_rows)),
        "contracts": clean_rows(contracts),
        "invoices": clean_rows(invoices),
        "receipts": clean_rows(receipts),
    }


@router.get("/{order_line_id}")
def get_sales_detail(order_line_id: int, user: CurrentUser = Depends(get_current_user)) -> dict:
    with db() as conn:
        summary = conn.execute(
            text(
                """
                SELECT order_line_id, project_code, order_no, department, branch_company,
                       account_manager, order_date, business_type, statistic_category,
                       customer_unit_name, project_name, close_status, goods_name,
                       specification_model, unit_name, quantity, revenue_no_tax, order_value,
                       supplier_name, purchase_amount, delivery_quantity, delivery_value,
                       purchase_contract_no, purchase_contract_signed_amount,
                       sales_contract_no, sales_contract_signed_date, sales_contract_value,
                       sales_invoice_amount, total_received, accounts_receivable, gross_profit
                FROM v_order_line_finance
                WHERE order_line_id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
        if summary is None:
            raise HTTPException(status_code=404, detail="Sales order line not found")
        if not can_access_department(user, str(summary["department"]) if summary["department"] is not None else None):
            raise HTTPException(status_code=403, detail="Department permission denied")

        contracts = conn.execute(
            text(
                """
                SELECT id, contract_signed_date, contract_signed_date_text, sales_contract_no,
                       contract_value, performance_period, unsigned_contract_amount, created_at
                FROM sales_contract
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        invoices = conn.execute(
            text(
                """
                SELECT id, phase_no, invoice_doc_no, invoice_date, invoice_date_text,
                       invoice_no, invoice_amount, pending_invoice_amount,
                       delivered_not_invoiced_amount, created_at
                FROM sales_invoice
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        receipts = conn.execute(
            text(
                """
                SELECT id, phase_no, receipt_date, receipt_date_text, payment_notice_no,
                       receipt_amount, receipt_ratio, created_at
                FROM sales_receipt
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()

    return {
        "summary": clean_row(summary),
        "contracts": clean_rows(contracts),
        "invoices": clean_rows(invoices),
        "receipts": clean_rows(receipts),
    }


@router.post("/{order_line_id}/contracts")
def add_sales_contract(
    order_line_id: int,
    payload: SalesContractCreate,
    user: CurrentUser = Depends(require_permission("sales_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO sales_contract
                  (order_line_id, contract_signed_date, contract_signed_date_text,
                   sales_contract_no, contract_value, performance_period,
                   unsigned_contract_amount)
                VALUES
                  (:order_line_id, :contract_signed_date, :contract_signed_date,
                   :sales_contract_no, :contract_value, :performance_period,
                   :unsigned_contract_amount)
                """
            ),
            {"order_line_id": order_line_id, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "销售管理", "create_sales_contract", f"新增销售合同 {record_id}",
            after=_record_snapshot(conn, "sales_contract", record_id),
        )
    return get_sales_detail(order_line_id, user)


@router.put("/contracts/{contract_id}")
def update_sales_contract(
    contract_id: int,
    payload: SalesContractCreate,
    user: CurrentUser = Depends(require_permission("sales_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_contract", contract_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "sales_contract", contract_id)
        conn.execute(
            text(
                """
                UPDATE sales_contract
                SET contract_signed_date = :contract_signed_date,
                    contract_signed_date_text = :contract_signed_date,
                    sales_contract_no = :sales_contract_no,
                    contract_value = :contract_value,
                    performance_period = :performance_period,
                    unsigned_contract_amount = :unsigned_contract_amount
                WHERE id = :contract_id
                """
            ),
            {"contract_id": contract_id, **_payload_dict(payload)},
        )
        write_operation_log(
            conn, user, "销售管理", "update_sales_contract", f"修改销售合同 {contract_id}",
            before=before, after=_record_snapshot(conn, "sales_contract", contract_id),
        )
    return get_sales_detail(order_line_id, user)


@router.delete("/contracts/{contract_id}")
def delete_sales_contract(
    contract_id: int,
    user: CurrentUser = Depends(require_permission("sales_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_contract", contract_id, user, require_entry=True)
    _soft_delete_detail("sales_contract", contract_id, user, "delete_sales_contract", "销售合同")
    return get_sales_detail(order_line_id, user)


@router.post("/{order_line_id}/invoices")
def add_sales_invoice(
    order_line_id: int,
    payload: SalesInvoiceCreate,
    user: CurrentUser = Depends(require_permission("sales_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "sales_invoice", order_line_id)
        result = conn.execute(
            text(
                """
                INSERT INTO sales_invoice
                  (order_line_id, phase_no, invoice_doc_no, invoice_date,
                   invoice_date_text, invoice_no, invoice_amount,
                   pending_invoice_amount, delivered_not_invoiced_amount)
                VALUES
                  (:order_line_id, :phase_no, :invoice_doc_no, :invoice_date,
                   :invoice_date, :invoice_no, :invoice_amount,
                   :pending_invoice_amount, :delivered_not_invoiced_amount)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "销售管理", "create_sales_invoice", f"新增销售开票 {record_id}",
            after=_record_snapshot(conn, "sales_invoice", record_id),
        )
    return get_sales_detail(order_line_id, user)


@router.put("/invoices/{invoice_id}")
def update_sales_invoice(
    invoice_id: int,
    payload: SalesInvoiceCreate,
    user: CurrentUser = Depends(require_permission("sales_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_invoice", invoice_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "sales_invoice", invoice_id)
        conn.execute(
            text(
                """
                UPDATE sales_invoice
                SET invoice_doc_no = :invoice_doc_no,
                    invoice_date = :invoice_date,
                    invoice_date_text = :invoice_date,
                    invoice_no = :invoice_no,
                    invoice_amount = :invoice_amount,
                    pending_invoice_amount = :pending_invoice_amount,
                    delivered_not_invoiced_amount = :delivered_not_invoiced_amount
                WHERE id = :invoice_id
                """
            ),
            {"invoice_id": invoice_id, **_payload_dict(payload)},
        )
        write_operation_log(
            conn, user, "销售管理", "update_sales_invoice", f"修改销售开票 {invoice_id}",
            before=before, after=_record_snapshot(conn, "sales_invoice", invoice_id),
        )
    return get_sales_detail(order_line_id, user)


@router.delete("/invoices/{invoice_id}")
def delete_sales_invoice(
    invoice_id: int,
    user: CurrentUser = Depends(require_permission("sales_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_invoice", invoice_id, user, require_entry=True)
    _soft_delete_detail("sales_invoice", invoice_id, user, "delete_sales_invoice", "销售开票")
    return get_sales_detail(order_line_id, user)


@router.post("/{order_line_id}/receipts")
def add_sales_receipt(
    order_line_id: int,
    payload: SalesReceiptCreate,
    user: CurrentUser = Depends(require_permission("sales_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "sales_receipt", order_line_id)
        _validate_receipt_total(conn, order_line_id, payload.receipt_amount)
        result = conn.execute(
            text(
                """
                INSERT INTO sales_receipt
                  (order_line_id, phase_no, receipt_date, receipt_date_text,
                   payment_notice_no, receipt_amount, receipt_ratio)
                VALUES
                  (:order_line_id, :phase_no, :receipt_date, :receipt_date,
                   :payment_notice_no, :receipt_amount, :receipt_ratio)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "销售管理", "create_sales_receipt", f"新增销售回款 {record_id}",
            after=_record_snapshot(conn, "sales_receipt", record_id),
        )
        _sync_close_status(conn, order_line_id)
    return get_sales_detail(order_line_id, user)


@router.put("/receipts/{receipt_id}")
def update_sales_receipt(
    receipt_id: int,
    payload: SalesReceiptCreate,
    user: CurrentUser = Depends(require_permission("sales_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_receipt", receipt_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "sales_receipt", receipt_id)
        _validate_receipt_total(conn, order_line_id, payload.receipt_amount, receipt_id)
        conn.execute(
            text(
                """
                UPDATE sales_receipt
                SET receipt_date = :receipt_date,
                    receipt_date_text = :receipt_date,
                    payment_notice_no = :payment_notice_no,
                    receipt_amount = :receipt_amount,
                    receipt_ratio = :receipt_ratio
                WHERE id = :receipt_id
                """
            ),
            {"receipt_id": receipt_id, **_payload_dict(payload)},
        )
        write_operation_log(
            conn, user, "销售管理", "update_sales_receipt", f"修改销售回款 {receipt_id}",
            before=before, after=_record_snapshot(conn, "sales_receipt", receipt_id),
        )
        _sync_close_status(conn, order_line_id)
    return get_sales_detail(order_line_id, user)


@router.delete("/receipts/{receipt_id}")
def delete_sales_receipt(
    receipt_id: int,
    user: CurrentUser = Depends(require_permission("sales_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_receipt", receipt_id, user, require_entry=True)
    _soft_delete_detail("sales_receipt", receipt_id, user, "delete_sales_receipt", "销售回款")
    with db() as conn:
        _sync_close_status(conn, order_line_id)
    return get_sales_detail(order_line_id, user)


def _ensure_order_line_in_conn(
    conn,
    order_line_id: int,
    user: CurrentUser,
    *,
    lock: bool = False,
) -> dict[str, object]:
    lock_sql = " FOR UPDATE" if lock else ""
    row = conn.execute(
        text(
            """
            SELECT ol.id AS order_line_id, ol.sales_order_id, ol.order_value, p.department
            FROM order_line ol
            JOIN sales_order so ON so.id = ol.sales_order_id AND so.deleted_at IS NULL
            JOIN project p ON p.id = so.project_id AND p.deleted_at IS NULL
            WHERE ol.id = :order_line_id AND ol.deleted_at IS NULL
            """
            + lock_sql
        ),
        {"order_line_id": order_line_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"订单明细 {order_line_id} 不存在")
    if not can_access_department(
        user,
        str(row["department"]) if row["department"] is not None else None,
        True,
    ):
        raise HTTPException(status_code=403, detail=f"无权修改订单明细 {order_line_id}")
    return dict(row)


def _validate_sales_batch_item(
    conn,
    order_line_id: int,
    order_line: dict[str, object],
    data: dict[str, object],
) -> None:
    order_value = Decimal(order_line.get("order_value") or 0)
    later_invoice_amount = _phase_amount_outside(
        conn,
        "sales_invoice",
        "invoice_amount",
        order_line_id,
        {1},
    )
    invoice_amount = Decimal(data.get("sales_invoice_amount") or 0)
    if later_invoice_amount + invoice_amount > order_value:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的累计开票金额不能超过订单金额",
        )

    later_receipt_amount = _phase_amount_outside(
        conn,
        "sales_receipt",
        "receipt_amount",
        order_line_id,
        {1, 2},
    )
    submitted_receipt_amount = (
        Decimal(data.get("receipt1_amount") or 0)
        + Decimal(data.get("receipt2_amount") or 0)
    )
    if later_receipt_amount + submitted_receipt_amount > order_value:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的累计回款金额不能超过订单金额",
        )


def _phase_amount_outside(
    conn,
    table_name: str,
    amount_column: str,
    order_line_id: int,
    excluded_phases: set[int],
) -> Decimal:
    params: dict[str, object] = {"order_line_id": order_line_id}
    phase_params: list[str] = []
    for index, phase_no in enumerate(sorted(excluded_phases)):
        key = f"excluded_phase_{index}"
        params[key] = phase_no
        phase_params.append(f":{key}")
    excluded_sql = f"AND phase_no NOT IN ({', '.join(phase_params)})" if phase_params else ""
    amount = conn.execute(
        text(
            f"""
            SELECT COALESCE(SUM({amount_column}), 0)
            FROM {table_name}
            WHERE order_line_id = :order_line_id
              AND deleted_at IS NULL
              {excluded_sql}
            """
        ),
        params,
    ).scalar()
    return Decimal(amount or 0)


def _save_sales_batch_item(conn, order_line_id: int, data: dict[str, object]) -> None:
    _upsert_order_line_record(
        conn,
        "sales_contract",
        order_line_id,
        {
            "contract_signed_date": data["contract_signed_date"],
            "contract_signed_date_text": None,
            "sales_contract_no": data["sales_contract_no"],
            "contract_value": data["sales_contract_value"],
            "performance_period": data["sales_performance_period"],
            "unsigned_contract_amount": data["sales_unsigned_contract_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "sales_invoice",
        order_line_id,
        1,
        {
            "invoice_doc_no": data["invoice_doc_no"],
            "invoice_date": data["invoice_date"],
            "invoice_date_text": None,
            "invoice_no": data["sales_invoice_no"],
            "invoice_amount": data["sales_invoice_amount"],
            "pending_invoice_amount": data["pending_invoice_amount"],
            "delivered_not_invoiced_amount": data["delivered_not_invoiced_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "sales_receipt",
        order_line_id,
        1,
        {
            "receipt_date": data["receipt1_date"],
            "receipt_date_text": None,
            "payment_notice_no": data["receipt1_notice_no"],
            "receipt_amount": data["receipt1_amount"],
            "receipt_ratio": data["receipt1_ratio"],
        },
    )
    _upsert_phase_record(
        conn,
        "sales_receipt",
        order_line_id,
        2,
        {
            "receipt_date": data["receipt2_date"],
            "receipt_date_text": None,
            "payment_notice_no": data["receipt2_notice_no"],
            "receipt_amount": data["receipt2_amount"],
            "receipt_ratio": data["receipt2_ratio"],
        },
    )
    _upsert_order_line_record(
        conn,
        "purchase_info",
        order_line_id,
        {
            "labor_cost": data["labor_cost"],
            "other_cost": data["other_cost"],
        },
    )


def _upsert_order_line_record(
    conn,
    table_name: str,
    order_line_id: int,
    data: dict[str, object],
) -> None:
    record_id = conn.execute(
        text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE order_line_id = :order_line_id
            ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, id
            LIMIT 1
            FOR UPDATE
            """
        ),
        {"order_line_id": order_line_id},
    ).scalar()
    if record_id is None and not _has_persisted_values(data):
        return
    assignments = ", ".join(f"{column_name} = :{column_name}" for column_name in data)
    if record_id is not None:
        conn.execute(
            text(f"UPDATE {table_name} SET {assignments}, deleted_at = NULL WHERE id = :record_id"),
            {"record_id": int(record_id), **data},
        )
        return
    columns = ", ".join(["order_line_id", *data])
    values = ", ".join([":order_line_id", *(f":{column_name}" for column_name in data)])
    conn.execute(
        text(f"INSERT INTO {table_name} ({columns}) VALUES ({values})"),
        {"order_line_id": order_line_id, **data},
    )


def _upsert_phase_record(
    conn,
    table_name: str,
    order_line_id: int,
    phase_no: int,
    data: dict[str, object],
) -> None:
    record_id = conn.execute(
        text(
            f"""
            SELECT id
            FROM {table_name}
            WHERE order_line_id = :order_line_id AND phase_no = :phase_no
            ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, id
            LIMIT 1
            FOR UPDATE
            """
        ),
        {"order_line_id": order_line_id, "phase_no": phase_no},
    ).scalar()
    if record_id is None and not _has_persisted_values(data):
        return
    assignments = ", ".join(f"{column_name} = :{column_name}" for column_name in data)
    if record_id is not None:
        conn.execute(
            text(f"UPDATE {table_name} SET {assignments}, deleted_at = NULL WHERE id = :record_id"),
            {"record_id": int(record_id), **data},
        )
        return
    columns = ", ".join(["order_line_id", "phase_no", *data])
    values = ", ".join([":order_line_id", ":phase_no", *(f":{column_name}" for column_name in data)])
    conn.execute(
        text(f"INSERT INTO {table_name} ({columns}) VALUES ({values})"),
        {"order_line_id": order_line_id, "phase_no": phase_no, **data},
    )


def _has_persisted_values(data: dict[str, object]) -> bool:
    return any(value is not None and str(value).strip() != "" for value in data.values())


def _normalized_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _ensure_order_line(order_line_id: int, user: CurrentUser, require_entry: bool = False) -> None:
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT department
                FROM v_order_line_finance
                WHERE order_line_id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order line not found")
    if not can_access_department(user, str(row["department"]) if row["department"] is not None else None, require_entry):
        raise HTTPException(status_code=403, detail="Department permission denied")


def _payload_dict(payload: BaseModel) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return payload.dict()


def _ensure_detail_record(table_name: str, record_id: int, user: CurrentUser, require_entry: bool = False) -> int:
    with db() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT item.order_line_id, v.department
                FROM {table_name} item
                JOIN v_order_line_finance v ON v.order_line_id = item.order_line_id
                WHERE item.id = :record_id AND item.deleted_at IS NULL
                """
            ),
            {"record_id": record_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Sales record not found")
    if not can_access_department(user, str(row["department"]) if row["department"] is not None else None, require_entry):
        raise HTTPException(status_code=403, detail="Department permission denied")
    return int(row["order_line_id"])


def _soft_delete_detail(table_name: str, record_id: int, user: CurrentUser, action_name: str, label: str) -> None:
    with db() as conn:
        before = _record_snapshot(conn, table_name, record_id)
        conn.execute(text(f"UPDATE {table_name} SET deleted_at = CURRENT_TIMESTAMP WHERE id = :record_id"), {"record_id": record_id})
        write_operation_log(conn, user, "销售管理", action_name, f"删除{label} {record_id}", before=before)


def _record_snapshot(conn, table_name: str, record_id: int):
    return conn.execute(
        text(f"SELECT * FROM {table_name} WHERE id = :record_id"),
        {"record_id": record_id},
    ).mappings().first()


def _next_phase(conn, table_name: str, order_line_id: int) -> int:
    conn.execute(
        text("SELECT id FROM order_line WHERE id = :order_line_id FOR UPDATE"),
        {"order_line_id": order_line_id},
    ).scalar()
    phase = conn.execute(
        text(
            f"""
            SELECT COALESCE(MAX(phase_no), 0) + 1
            FROM {table_name}
            WHERE order_line_id = :order_line_id AND deleted_at IS NULL
            """
        ),
        {"order_line_id": order_line_id},
    ).scalar()
    next_phase = int(phase or 1)
    if next_phase > 20:
        raise HTTPException(status_code=422, detail="最多允许录入20期数据，请检查后重新提交。")
    return next_phase


def _validate_receipt_total(conn, order_line_id: int, receipt_amount: Decimal, receipt_id: int | None = None) -> None:
    order_value = conn.execute(
        text("SELECT order_value FROM order_line WHERE id = :order_line_id FOR UPDATE"),
        {"order_line_id": order_line_id},
    ).scalar()
    params: dict[str, object] = {"order_line_id": order_line_id}
    exclude_clause = ""
    if receipt_id is not None:
        exclude_clause = " AND id <> :receipt_id"
        params["receipt_id"] = receipt_id
    received = conn.execute(
        text(
            "SELECT COALESCE(SUM(receipt_amount), 0) FROM sales_receipt "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL" + exclude_clause
        ),
        params,
    ).scalar()
    if Decimal(received or 0) + receipt_amount > Decimal(order_value or 0):
        raise HTTPException(status_code=422, detail="累计回款金额不能超过订单金额，数据有错误，请检查后重新提交。")


def _aggregate_summary(rows) -> dict:
    first = dict(rows[0])
    result = dict(first)
    for field in SUMMARY_AMOUNT_FIELDS:
        result[field] = sum(row.get(field) or 0 for row in rows)
    for row in rows:
        for key, value in row.items():
            if result.get(key) in (None, "") and value not in (None, ""):
                result[key] = value
    result["primary_order_line_id"] = first.get("order_line_id")
    result["matched_line_count"] = len(rows)
    return result


def _sync_close_status(conn, order_line_id: int) -> None:
    row = conn.execute(
        text("SELECT sales_order_id FROM order_line WHERE id = :id"),
        {"id": order_line_id},
    ).mappings().first()
    if row is None:
        return
    sales_order_id = int(row["sales_order_id"])
    all_closed = conn.execute(
        text(
            """
            SELECT NOT EXISTS (
              SELECT 1 FROM v_order_line_finance v
              WHERE v.order_line_id IN (
                SELECT id FROM order_line WHERE sales_order_id = :so_id AND deleted_at IS NULL
              )
              AND v.accounts_receivable > 0
            ) AS all_closed
            """
        ),
        {"so_id": sales_order_id},
    ).scalar()
    if all_closed:
        conn.execute(
            text("UPDATE sales_order SET close_status = '关闭' WHERE id = :so_id"),
            {"so_id": sales_order_id},
        )
    else:
        conn.execute(
            text("UPDATE sales_order SET close_status = NULL WHERE id = :so_id AND close_status = '关闭'"),
            {"so_id": sales_order_id},
        )
