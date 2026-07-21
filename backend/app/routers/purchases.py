from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from ..audit import write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..db import db
from ..serializers import clean_row, clean_rows
from ..validation import BusinessDate, Money

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


class PurchaseContractCreate(BaseModel):
    purchase_contract_no: str | None = None
    payment_terms: str | None = None
    performance_period: str | None = None
    signed_amount: Money | None = None
    unsigned_amount: Money | None = None


class PurchaseInvoiceCreate(BaseModel):
    received_invoice_date: BusinessDate | None = None
    invoice_no: str | None = None
    invoice_amount: Money


class WarehouseEntryCreate(BaseModel):
    warehouse_date: BusinessDate | None = None
    voucher_no: str | None = None
    warehouse_amount: Money | None = None
    warehouse_amount_no_tax: Money | None = None


class FinanceInvoiceCheckCreate(BaseModel):
    received_invoice_date: BusinessDate | None = None
    received_invoice_amount: Money | None = None
    voucher_code: str | None = None


class FinancePaymentEntryCreate(BaseModel):
    payment_date: BusinessDate | None = None
    voucher_code: str | None = None
    booked_amount: Money | None = None


class PurchasePaymentCreate(BaseModel):
    due_payment_date: BusinessDate | None = None
    payment_date: BusinessDate | None = None
    payment_voucher_no: str | None = None
    payment_amount: Money


@router.get("")
def list_purchases(
    project_id: str | None = None,
    order_id: str | None = None,
    manager: str | None = None,
    department: str | None = None,
    supplier_name: str | None = None,
    contract_no: str | None = None,
    payment_date: str | None = None,
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
        conditions.append("purchase_contract_no LIKE :contract_no")
        params["contract_no"] = f"%{contract_no}%"
    if payment_date:
        conditions.append("latest_payment_date = :payment_date")
        params["payment_date"] = payment_date
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    source_sql = """
        SELECT v.*,
               (
                 SELECT MAX(pp.payment_date)
                 FROM purchase_payment pp
                 WHERE pp.order_line_id = v.order_line_id
                   AND pp.deleted_at IS NULL
               ) AS latest_payment_date
        FROM v_order_line_finance v
    """
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM ({source_sql}) purchase_detail WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT order_line_id, project_code, order_no, account_manager, department, supplier_name,
                       purchase_contract_no, purchase_contract_signed_amount,
                       purchase_amount, total_paid, accounts_payable, latest_payment_date
                FROM ({source_sql}) purchase_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, project_code
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.get("/{order_line_id}")
def get_purchase_detail(order_line_id: int, user: CurrentUser = Depends(get_current_user)) -> dict:
    with db() as conn:
        summary = conn.execute(
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
                       delivery_quantity, delivery_value, purchase_contract_no,
                       purchase_contract_signed_amount, total_finance_checked,
                       total_finance_paid, financial_accounts_payable,
                       total_paid, accounts_payable, gross_profit_no_tax,
                       gross_profit_margin_no_tax, gross_profit
                FROM v_order_line_finance
                WHERE order_line_id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
        if summary is None:
            raise HTTPException(status_code=404, detail="Purchase order line not found")
        if not can_access_department(user, str(summary["department"]) if summary["department"] is not None else None):
            raise HTTPException(status_code=403, detail="Department permission denied")

        contracts = conn.execute(
            text(
                """
                SELECT id, purchase_contract_no, payment_terms, performance_period,
                       signed_amount, unsigned_amount, created_at
                FROM purchase_contract
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        invoices = conn.execute(
            text(
                """
                SELECT id, phase_no, received_invoice_date, received_invoice_date_text,
                       invoice_no, invoice_amount, created_at
                FROM purchase_invoice
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        warehouse_entries = conn.execute(
            text(
                """
                SELECT id, phase_no, warehouse_date, warehouse_date_text, voucher_no,
                       warehouse_amount, warehouse_amount_no_tax, created_at
                FROM warehouse_entry
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        finance_invoice_checks = conn.execute(
            text(
                """
                SELECT id, phase_no, received_invoice_date, received_invoice_date_text,
                       received_invoice_amount, voucher_code, created_at
                FROM finance_invoice_check
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        finance_payments = conn.execute(
            text(
                """
                SELECT id, phase_no, payment_date, payment_date_text, voucher_code,
                       booked_amount, created_at
                FROM finance_payment_entry
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                ORDER BY phase_no, id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().all()
        payments = conn.execute(
            text(
                """
                SELECT id, phase_no, due_payment_date, payment_date, payment_date_text,
                       payment_voucher_no, payment_amount, created_at
                FROM purchase_payment
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
        "warehouse_entries": clean_rows(warehouse_entries),
        "finance_invoice_checks": clean_rows(finance_invoice_checks),
        "finance_payments": clean_rows(finance_payments),
        "payments": clean_rows(payments),
    }


@router.post("/{order_line_id}/contracts")
def add_purchase_contract(
    order_line_id: int,
    payload: PurchaseContractCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO purchase_contract
                  (order_line_id, purchase_contract_no, payment_terms, performance_period,
                   signed_amount, unsigned_amount)
                VALUES
                  (:order_line_id, :purchase_contract_no, :payment_terms, :performance_period,
                   :signed_amount, :unsigned_amount)
                """
            ),
            {"order_line_id": order_line_id, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "采购管理", "create_purchase_contract", f"新增采购合同 {record_id}",
            after=_record_snapshot(conn, "purchase_contract", record_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.put("/contracts/{contract_id}")
def update_purchase_contract(
    contract_id: int,
    payload: PurchaseContractCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_contract", contract_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "purchase_contract", contract_id)
        conn.execute(
            text(
                """
                UPDATE purchase_contract
                SET purchase_contract_no = :purchase_contract_no,
                    payment_terms = :payment_terms,
                    performance_period = :performance_period,
                    signed_amount = :signed_amount,
                    unsigned_amount = :unsigned_amount
                WHERE id = :contract_id
                """
            ),
            {"contract_id": contract_id, **_payload_dict(payload)},
        )
        write_operation_log(
            conn, user, "采购管理", "update_purchase_contract", f"修改采购合同 {contract_id}",
            before=before, after=_record_snapshot(conn, "purchase_contract", contract_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.delete("/contracts/{contract_id}")
def delete_purchase_contract(
    contract_id: int,
    user: CurrentUser = Depends(require_permission("purchase_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_contract", contract_id, user, require_entry=True)
    _soft_delete_detail("purchase_contract", contract_id, user, "delete_purchase_contract", "采购合同")
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/invoices")
def add_purchase_invoice(
    order_line_id: int,
    payload: PurchaseInvoiceCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "purchase_invoice", order_line_id)
        result = conn.execute(
            text(
                """
                INSERT INTO purchase_invoice
                  (order_line_id, phase_no, received_invoice_date, received_invoice_date_text,
                   invoice_no, invoice_amount)
                VALUES
                  (:order_line_id, :phase_no, :received_invoice_date, :received_invoice_date,
                   :invoice_no, :invoice_amount)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "采购管理", "create_purchase_invoice", f"新增采购收票 {record_id}",
            after=_record_snapshot(conn, "purchase_invoice", record_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.put("/invoices/{invoice_id}")
def update_purchase_invoice(
    invoice_id: int,
    payload: PurchaseInvoiceCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_invoice", invoice_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "purchase_invoice", invoice_id)
        data = _payload_dict(payload)
        conn.execute(
            text(
                """
                UPDATE purchase_invoice
                SET received_invoice_date = :received_invoice_date,
                    received_invoice_date_text = :received_invoice_date,
                    invoice_no = :invoice_no,
                    invoice_amount = :invoice_amount
                WHERE id = :invoice_id
                """
            ),
            {"invoice_id": invoice_id, **data},
        )
        write_operation_log(
            conn, user, "采购管理", "update_purchase_invoice", f"修改采购收票 {invoice_id}",
            before=before, after=_record_snapshot(conn, "purchase_invoice", invoice_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.delete("/invoices/{invoice_id}")
def delete_purchase_invoice(
    invoice_id: int,
    user: CurrentUser = Depends(require_permission("purchase_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_invoice", invoice_id, user, require_entry=True)
    _soft_delete_detail("purchase_invoice", invoice_id, user, "delete_purchase_invoice", "采购收票")
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/warehouse-entries")
def add_warehouse_entry(
    order_line_id: int,
    payload: WarehouseEntryCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "warehouse_entry", order_line_id)
        result = conn.execute(
            text(
                """
                INSERT INTO warehouse_entry
                  (order_line_id, phase_no, warehouse_date, warehouse_date_text,
                   voucher_no, warehouse_amount, warehouse_amount_no_tax)
                VALUES
                  (:order_line_id, :phase_no, :warehouse_date, :warehouse_date,
                   :voucher_no, :warehouse_amount, :warehouse_amount_no_tax)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(conn, user, "采购管理", "create_warehouse_entry", f"新增入库记录 {record_id}", after=_record_snapshot(conn, "warehouse_entry", record_id))
    return get_purchase_detail(order_line_id, user)


@router.put("/warehouse-entries/{entry_id}")
def update_warehouse_entry(
    entry_id: int,
    payload: WarehouseEntryCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("warehouse_entry", entry_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "warehouse_entry", entry_id)
        conn.execute(
            text(
                """
                UPDATE warehouse_entry
                SET warehouse_date = :warehouse_date,
                    warehouse_date_text = :warehouse_date,
                    voucher_no = :voucher_no,
                    warehouse_amount = :warehouse_amount,
                    warehouse_amount_no_tax = :warehouse_amount_no_tax
                WHERE id = :entry_id
                """
            ),
            {"entry_id": entry_id, **_payload_dict(payload)},
        )
        write_operation_log(conn, user, "采购管理", "update_warehouse_entry", f"修改入库记录 {entry_id}", before=before, after=_record_snapshot(conn, "warehouse_entry", entry_id))
    return get_purchase_detail(order_line_id, user)


@router.delete("/warehouse-entries/{entry_id}")
def delete_warehouse_entry(entry_id: int, user: CurrentUser = Depends(require_permission("purchase_delete"))) -> dict:
    order_line_id = _ensure_detail_record("warehouse_entry", entry_id, user, require_entry=True)
    _soft_delete_detail("warehouse_entry", entry_id, user, "delete_warehouse_entry", "入库记录")
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/finance-invoice-checks")
def add_finance_invoice_check(
    order_line_id: int,
    payload: FinanceInvoiceCheckCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "finance_invoice_check", order_line_id)
        result = conn.execute(
            text(
                """
                INSERT INTO finance_invoice_check
                  (order_line_id, phase_no, received_invoice_date, received_invoice_date_text,
                   received_invoice_amount, voucher_code)
                VALUES
                  (:order_line_id, :phase_no, :received_invoice_date, :received_invoice_date,
                   :received_invoice_amount, :voucher_code)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(conn, user, "采购管理", "create_finance_invoice_check", f"新增发票校验 {record_id}", after=_record_snapshot(conn, "finance_invoice_check", record_id))
    return get_purchase_detail(order_line_id, user)


@router.put("/finance-invoice-checks/{check_id}")
def update_finance_invoice_check(
    check_id: int,
    payload: FinanceInvoiceCheckCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("finance_invoice_check", check_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "finance_invoice_check", check_id)
        conn.execute(
            text(
                """
                UPDATE finance_invoice_check
                SET received_invoice_date = :received_invoice_date,
                    received_invoice_date_text = :received_invoice_date,
                    received_invoice_amount = :received_invoice_amount,
                    voucher_code = :voucher_code
                WHERE id = :check_id
                """
            ),
            {"check_id": check_id, **_payload_dict(payload)},
        )
        write_operation_log(conn, user, "采购管理", "update_finance_invoice_check", f"修改发票校验 {check_id}", before=before, after=_record_snapshot(conn, "finance_invoice_check", check_id))
    return get_purchase_detail(order_line_id, user)


@router.delete("/finance-invoice-checks/{check_id}")
def delete_finance_invoice_check(check_id: int, user: CurrentUser = Depends(require_permission("purchase_delete"))) -> dict:
    order_line_id = _ensure_detail_record("finance_invoice_check", check_id, user, require_entry=True)
    _soft_delete_detail("finance_invoice_check", check_id, user, "delete_finance_invoice_check", "发票校验")
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/finance-payments")
def add_finance_payment(
    order_line_id: int,
    payload: FinancePaymentEntryCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "finance_payment_entry", order_line_id)
        result = conn.execute(
            text(
                """
                INSERT INTO finance_payment_entry
                  (order_line_id, phase_no, payment_date, payment_date_text, voucher_code, booked_amount)
                VALUES
                  (:order_line_id, :phase_no, :payment_date, :payment_date, :voucher_code, :booked_amount)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **_payload_dict(payload)},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(conn, user, "采购管理", "create_finance_payment", f"新增财务入账付款 {record_id}", after=_record_snapshot(conn, "finance_payment_entry", record_id))
    return get_purchase_detail(order_line_id, user)


@router.put("/finance-payments/{payment_id}")
def update_finance_payment(
    payment_id: int,
    payload: FinancePaymentEntryCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("finance_payment_entry", payment_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "finance_payment_entry", payment_id)
        conn.execute(
            text(
                """
                UPDATE finance_payment_entry
                SET payment_date = :payment_date,
                    payment_date_text = :payment_date,
                    voucher_code = :voucher_code,
                    booked_amount = :booked_amount
                WHERE id = :payment_id
                """
            ),
            {"payment_id": payment_id, **_payload_dict(payload)},
        )
        write_operation_log(conn, user, "采购管理", "update_finance_payment", f"修改财务入账付款 {payment_id}", before=before, after=_record_snapshot(conn, "finance_payment_entry", payment_id))
    return get_purchase_detail(order_line_id, user)


@router.delete("/finance-payments/{payment_id}")
def delete_finance_payment(payment_id: int, user: CurrentUser = Depends(require_permission("purchase_delete"))) -> dict:
    order_line_id = _ensure_detail_record("finance_payment_entry", payment_id, user, require_entry=True)
    _soft_delete_detail("finance_payment_entry", payment_id, user, "delete_finance_payment", "财务入账付款")
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/payments")
def add_purchase_payment(
    order_line_id: int,
    payload: PurchasePaymentCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        phase_no = _next_phase(conn, "purchase_payment", order_line_id)
        data = _payload_dict(payload)
        _validate_payment_total(conn, order_line_id, payload.payment_amount)
        if phase_no > 1:
            data["due_payment_date"] = None
        result = conn.execute(
            text(
                """
                INSERT INTO purchase_payment
                  (order_line_id, phase_no, due_payment_date, payment_date, payment_date_text,
                   payment_voucher_no, payment_amount)
                VALUES
                  (:order_line_id, :phase_no, :due_payment_date, :payment_date, :payment_date,
                   :payment_voucher_no, :payment_amount)
                """
            ),
            {"order_line_id": order_line_id, "phase_no": phase_no, **data},
        )
        record_id = int(result.lastrowid or 0)
        write_operation_log(
            conn, user, "采购管理", "create_purchase_payment", f"新增采购付款 {record_id}",
            after=_record_snapshot(conn, "purchase_payment", record_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.put("/payments/{payment_id}")
def update_purchase_payment(
    payment_id: int,
    payload: PurchasePaymentCreate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_payment", payment_id, user, require_entry=True)
    with db() as conn:
        before = _record_snapshot(conn, "purchase_payment", payment_id)
        data = _payload_dict(payload)
        _validate_payment_total(conn, order_line_id, payload.payment_amount, payment_id)
        conn.execute(
            text(
                """
                UPDATE purchase_payment
                SET due_payment_date = :due_payment_date,
                    payment_date = :payment_date,
                    payment_date_text = :payment_date,
                    payment_voucher_no = :payment_voucher_no,
                    payment_amount = :payment_amount
                WHERE id = :payment_id
                """
            ),
            {"payment_id": payment_id, **data},
        )
        write_operation_log(
            conn, user, "采购管理", "update_purchase_payment", f"修改采购付款 {payment_id}",
            before=before, after=_record_snapshot(conn, "purchase_payment", payment_id),
        )
    return get_purchase_detail(order_line_id, user)


@router.delete("/payments/{payment_id}")
def delete_purchase_payment(
    payment_id: int,
    user: CurrentUser = Depends(require_permission("purchase_delete")),
) -> dict:
    order_line_id = _ensure_detail_record("purchase_payment", payment_id, user, require_entry=True)
    _soft_delete_detail("purchase_payment", payment_id, user, "delete_purchase_payment", "采购付款")
    return get_purchase_detail(order_line_id, user)


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
        raise HTTPException(status_code=404, detail="Purchase record not found")
    if not can_access_department(user, str(row["department"]) if row["department"] is not None else None, require_entry):
        raise HTTPException(status_code=403, detail="Department permission denied")
    return int(row["order_line_id"])


def _soft_delete_detail(table_name: str, record_id: int, user: CurrentUser, action_name: str, label: str) -> None:
    with db() as conn:
        before = _record_snapshot(conn, table_name, record_id)
        conn.execute(text(f"UPDATE {table_name} SET deleted_at = CURRENT_TIMESTAMP WHERE id = :record_id"), {"record_id": record_id})
        write_operation_log(conn, user, "采购管理", action_name, f"删除{label} {record_id}", before=before)


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
    next_phase = int(phase or 1)
    if next_phase > 20:
        raise HTTPException(status_code=422, detail="最多允许录入20期数据，请检查后重新提交。")
    return next_phase


def _validate_payment_total(conn, order_line_id: int, payment_amount: Decimal, payment_id: int | None = None) -> None:
    conn.execute(
        text("SELECT id FROM order_line WHERE id = :order_line_id FOR UPDATE"),
        {"order_line_id": order_line_id},
    ).scalar()
    purchase_amount = conn.execute(
        text(
            "SELECT purchase_amount FROM purchase_info "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL"
        ),
        {"order_line_id": order_line_id},
    ).scalar()
    params: dict[str, object] = {"order_line_id": order_line_id}
    exclude_clause = ""
    if payment_id is not None:
        exclude_clause = " AND id <> :payment_id"
        params["payment_id"] = payment_id
    paid = conn.execute(
        text(
            "SELECT COALESCE(SUM(payment_amount), 0) FROM purchase_payment "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL" + exclude_clause
        ),
        params,
    ).scalar()
    if Decimal(paid or 0) + payment_amount > Decimal(purchase_amount or 0):
        raise HTTPException(status_code=422, detail="累计付款金额不能超过含税采购金额，数据有错误，请检查后重新提交。")
