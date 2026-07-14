from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..audit import write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..db import db
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
               ) AS latest_receipt_date
        FROM v_order_line_finance v
    """
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM ({source_sql}) sales_detail WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT order_line_id, project_code, order_no, account_manager, department, supplier_name, sales_contract_no,
                       sales_contract_signed_date, sales_contract_value, sales_invoice_amount,
                       total_received, accounts_receivable, latest_receipt_date
                FROM ({source_sql}) sales_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, project_code
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.get("/by-order")
def get_sales_detail_by_order(project_id: str, order_id: str, user: CurrentUser = Depends(get_current_user)) -> dict:
    with db() as conn:
        summary_rows = conn.execute(
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
    return get_sales_detail(order_line_id, user)


@router.delete("/receipts/{receipt_id}")
def delete_sales_receipt(
    receipt_id: int,
    user: CurrentUser = Depends(require_permission("sales_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("sales_receipt", receipt_id, user, require_entry=True)
    _soft_delete_detail("sales_receipt", receipt_id, user, "delete_sales_receipt", "销售回款")
    return get_sales_detail(order_line_id, user)


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
            WHERE order_line_id = :order_line_id
            """
        ),
        {"order_line_id": order_line_id},
    ).scalar()
    return int(phase or 1)


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
