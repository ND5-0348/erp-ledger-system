from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from ..audit import write_batch_operation_log, write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..db import db
from ..line_identity import DUPLICATE_LINE_DETAIL, find_duplicate_line, order_line_identity
from ..ledger_excel import (
    editor_changed_keys,
    editor_columns,
    editor_payload_snapshot,
    editor_rows_for_order_lines,
)
from ..serializers import clean_row, clean_rows
from ..validation import BusinessDate, Money, PreciseNumber, Ratio
from ..write_guard import business_write

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


class PurchaseSummaryUpdate(BaseModel):
    supplier_name: str | None = None
    purchase_tax_rate: Ratio | None = None
    purchase_unit_price_no_tax: PreciseNumber | None = None
    purchase_unit_price: PreciseNumber | None = None
    cost_no_tax: Money | None = None
    purchase_amount: Money | None = None
    labor_cost: Money | None = None
    other_cost: Money | None = None


class PurchaseBatchFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier_name: str | None = None
    purchase_tax_rate: Ratio | None = None
    purchase_unit_price_no_tax: PreciseNumber | None = None
    purchase_unit_price: PreciseNumber | None = None
    cost_no_tax: Money | None = None
    purchase_amount: Money | None = None
    delivery_date: BusinessDate | None = None
    delivery_quantity: PreciseNumber | None = None
    delivery_revenue_no_tax: Money | None = None
    delivery_value: Money | None = None
    delivery_cost_no_tax: Money | None = None
    delivery_cost: Money | None = None
    pending_delivery_quantity: PreciseNumber | None = None
    pending_delivery_amount_no_tax: Money | None = None
    pending_delivery_amount: Money | None = None
    purchase_contract_no: str | None = None
    payment_terms: str | None = None
    purchase_performance_period: str | None = None
    purchase_signed_amount: Money | None = None
    purchase_unsigned_amount: Money | None = None
    received_invoice_date: BusinessDate | None = None
    purchase_invoice_no: str | None = None
    purchase_invoice_amount: Money | None = None
    warehouse_date: BusinessDate | None = None
    warehouse_voucher_no: str | None = None
    warehouse_amount: Money | None = None
    booked_date: BusinessDate | None = None
    booked_voucher_code: str | None = None
    booked_amount: Money | None = None
    payment1_due_date: BusinessDate | None = None
    payment1_date: BusinessDate | None = None
    payment1_voucher_no: str | None = None
    payment1_amount: Money | None = None
    payment2_date: BusinessDate | None = None
    payment2_voucher_no: str | None = None
    payment2_amount: Money | None = None


class PurchaseBatchUpdateItem(PurchaseBatchFields):
    order_line_id: int = Field(gt=0)


class PurchaseBatchUpdate(BaseModel):
    items: list[PurchaseBatchUpdateItem] = Field(min_length=1, max_length=500)


class PurchaseOrderLineSelection(BaseModel):
    order_line_ids: list[int] = Field(min_length=1, max_length=500)


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
                 SELECT COALESCE(SUM(pi.invoice_amount), 0)
                 FROM purchase_invoice pi
                 WHERE pi.order_line_id = v.order_line_id
                   AND pi.deleted_at IS NULL
               ) AS received_invoice_amount,
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
                       purchase_amount, received_invoice_amount, total_paid, accounts_payable, latest_payment_date
                FROM ({source_sql}) purchase_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, project_code, order_line_id
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.post("/batch-editor/rows")
def get_purchase_batch_editor_rows(
    payload: PurchaseOrderLineSelection,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    unique_ids = list(dict.fromkeys(payload.order_line_ids))
    with db() as conn:
        rows = editor_rows_for_order_lines(conn, user, unique_ids)
    if len(rows) != len(unique_ids):
        raise HTTPException(status_code=404, detail="部分订单明细不存在或当前账号无权访问")
    return {
        "editable_from": "X",
        "editable_through": "BO",
        "fixed_columns": ["B", "C", "D", "E", "F", "G", "M", "N", "O"],
        "columns": editor_columns("purchase"),
        "rows": rows,
    }


@router.put("/batch")
def update_purchases_batch(
    payload: PurchaseBatchUpdate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    order_line_ids = [item.order_line_id for item in payload.items]
    if len(set(order_line_ids)) != len(order_line_ids):
        raise HTTPException(status_code=422, detail="批量修改中不能重复提交同一条订单明细")

    prepared: list[tuple[int, dict[str, object], dict[str, object], dict[str, object]]] = []
    with business_write() as conn:
        for item in payload.items:
            order_line = _ensure_order_line_in_conn(conn, item.order_line_id, user, lock=True)
            data = _payload_dict(item)
            data.pop("order_line_id", None)
            before = editor_payload_snapshot(conn, user, item.order_line_id, "purchase")
            if editor_changed_keys("purchase", before, data):
                prepared.append((item.order_line_id, order_line, data, before))

        for order_line_id, order_line, data, _ in prepared:
            _validate_purchase_batch_item(conn, order_line_id, order_line, data)

        audit_entries: list[tuple[dict[str, object], dict[str, object]]] = []
        for order_line_id, _, data, before in prepared:
            _save_purchase_batch_item(conn, order_line_id, data)
            audit_entries.append(
                (before, editor_payload_snapshot(conn, user, order_line_id, "purchase"))
            )
        if audit_entries:
            changed_cell_count = sum(
                len(editor_changed_keys("purchase", before, after))
                for before, after in audit_entries
            )
            write_batch_operation_log(
                conn,
                user,
                "采购管理",
                "batch_update_purchases",
                f"在线表格批量修改 {len(audit_entries)} 条采购信息，共 {changed_cell_count} 个单元格",
                entries=audit_entries,
            )
    updated_ids = [order_line_id for order_line_id, _, _, _ in prepared]
    return {"updated": len(prepared), "order_line_ids": updated_ids}


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


@router.put("/{order_line_id}/summary")
def update_purchase_summary(
    order_line_id: int,
    payload: PurchaseSummaryUpdate,
    user: CurrentUser = Depends(require_permission("purchase_edit")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    data = _payload_dict(payload)
    with business_write() as conn:
        before = _purchase_summary_snapshot(conn, order_line_id)
        paid_total = conn.execute(
            text(
                """
                SELECT COALESCE(SUM(payment_amount), 0)
                FROM purchase_payment
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                """
            ),
            {"order_line_id": order_line_id},
        ).scalar()
        if data["purchase_amount"] is not None and Decimal(paid_total or 0) > data["purchase_amount"]:
            raise HTTPException(status_code=422, detail="含税采购金额不能小于已付款合计，数据有错误，请检查后重新提交。")

        # 采购厂商参与唯一性判定：改厂商可能让这条明细与同子项目的另一条完全相同。
        # 采购入口也必须拒绝，不能绕过订单入口的判重规则。
        identity = order_line_identity(conn, order_line_id)
        if identity and find_duplicate_line(
            conn,
            identity["sub_project_id"],
            identity["goods_name"],
            identity["specification_model"],
            identity["quantity"],
            identity["sales_unit_price"],
            data["supplier_name"],
            exclude_order_line_id=order_line_id,
        ):
            raise HTTPException(status_code=409, detail=DUPLICATE_LINE_DETAIL)

        exists = conn.execute(
            text(
                """
                SELECT id
                FROM purchase_info
                WHERE order_line_id = :order_line_id AND deleted_at IS NULL
                LIMIT 1
                """
            ),
            {"order_line_id": order_line_id},
        ).scalar()
        if exists:
            conn.execute(
                text(
                    """
                    UPDATE purchase_info
                    SET supplier_name = :supplier_name,
                        purchase_tax_rate = :purchase_tax_rate,
                        purchase_unit_price_no_tax = :purchase_unit_price_no_tax,
                        purchase_unit_price = :purchase_unit_price,
                        cost_no_tax = :cost_no_tax,
                        purchase_amount = :purchase_amount,
                        labor_cost = :labor_cost,
                        other_cost = :other_cost
                    WHERE id = :purchase_info_id
                    """
                ),
                {"purchase_info_id": int(exists), **data},
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO purchase_info
                      (order_line_id, supplier_name, purchase_tax_rate, purchase_unit_price_no_tax,
                       purchase_unit_price, cost_no_tax, purchase_amount, labor_cost, other_cost)
                    VALUES
                      (:order_line_id, :supplier_name, :purchase_tax_rate, :purchase_unit_price_no_tax,
                       :purchase_unit_price, :cost_no_tax, :purchase_amount, :labor_cost, :other_cost)
                    """
                ),
                {"order_line_id": order_line_id, **data},
            )
        after = _purchase_summary_snapshot(conn, order_line_id)
        write_operation_log(
            conn,
            user,
            "采购管理",
            "update_purchase_summary",
            f"修改订单明细 {order_line_id} 的采购基础信息",
            before=before,
            after=after,
        )
    return get_purchase_detail(order_line_id, user)


@router.post("/{order_line_id}/contracts")
def add_purchase_contract(
    order_line_id: int,
    payload: PurchaseContractCreate,
    user: CurrentUser = Depends(require_permission("purchase_entry")),
) -> dict:
    _ensure_order_line(order_line_id, user, require_entry=True)
    with business_write() as conn:
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
    with business_write() as conn:
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
    with business_write() as conn:
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
    with business_write() as conn:
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
    with business_write() as conn:
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
    with business_write() as conn:
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
    with business_write() as conn:
        phase_no = _next_phase(conn, "finance_invoice_check", order_line_id)
        _validate_finance_invoice_check_total(conn, order_line_id, payload.received_invoice_amount)
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
    with business_write() as conn:
        before = _record_snapshot(conn, "finance_invoice_check", check_id)
        _validate_finance_invoice_check_total(conn, order_line_id, payload.received_invoice_amount, check_id)
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
    with business_write() as conn:
        phase_no = _next_phase(conn, "finance_payment_entry", order_line_id)
        _validate_finance_payment_total(conn, order_line_id, payload.booked_amount)
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
    with business_write() as conn:
        before = _record_snapshot(conn, "finance_payment_entry", payment_id)
        _validate_finance_payment_total(conn, order_line_id, payload.booked_amount, payment_id)
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
    with business_write() as conn:
        phase_no = _next_phase(conn, "purchase_payment", order_line_id)
        data = _payload_dict(payload)
        _validate_payment_total(conn, order_line_id, payload.payment_amount)
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
    with business_write() as conn:
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
            SELECT ol.id AS order_line_id, ol.quantity, p.department
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


def _validate_purchase_batch_item(
    conn,
    order_line_id: int,
    order_line: dict[str, object],
    data: dict[str, object],
) -> None:
    quantity = Decimal(order_line.get("quantity") or 0)
    delivery_quantity = Decimal(data.get("delivery_quantity") or 0)
    if delivery_quantity > quantity:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的交付数量不能超过订单数量",
        )

    purchase_amount = Decimal(data.get("purchase_amount") or 0)
    later_invoice_amount = _phase_amount_outside(
        conn,
        "purchase_invoice",
        "invoice_amount",
        order_line_id,
        {1},
    )
    invoice_amount = Decimal(data.get("purchase_invoice_amount") or 0)
    if later_invoice_amount + invoice_amount > purchase_amount:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的累计收票金额不能超过含税采购金额",
        )

    later_booked_amount = _phase_amount_outside(
        conn,
        "finance_payment_entry",
        "booked_amount",
        order_line_id,
        {1},
    )
    booked_amount = Decimal(data.get("booked_amount") or 0)
    if later_booked_amount + booked_amount > purchase_amount:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的累计财务入账金额不能超过含税采购金额",
        )

    later_payment_amount = _phase_amount_outside(
        conn,
        "purchase_payment",
        "payment_amount",
        order_line_id,
        {1, 2},
    )
    submitted_payment_amount = (
        Decimal(data.get("payment1_amount") or 0)
        + Decimal(data.get("payment2_amount") or 0)
    )
    if later_payment_amount + submitted_payment_amount > purchase_amount:
        raise HTTPException(
            status_code=422,
            detail=f"订单明细 {order_line_id} 的累计付款金额不能超过含税采购金额",
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


def _save_purchase_batch_item(conn, order_line_id: int, data: dict[str, object]) -> None:
    _upsert_order_line_record(
        conn,
        "purchase_info",
        order_line_id,
        {
            "supplier_name": data["supplier_name"],
            "purchase_tax_rate": data["purchase_tax_rate"],
            "purchase_unit_price_no_tax": data["purchase_unit_price_no_tax"],
            "purchase_unit_price": data["purchase_unit_price"],
            "cost_no_tax": data["cost_no_tax"],
            "purchase_amount": data["purchase_amount"],
        },
    )
    _upsert_order_line_record(
        conn,
        "delivery_record",
        order_line_id,
        {
            "delivery_date": data["delivery_date"],
            "delivery_quantity": data["delivery_quantity"],
            "delivery_revenue_no_tax": data["delivery_revenue_no_tax"],
            "delivery_value": data["delivery_value"],
            "delivery_cost_no_tax": data["delivery_cost_no_tax"],
            "delivery_cost": data["delivery_cost"],
            "pending_delivery_quantity": data["pending_delivery_quantity"],
            "pending_delivery_amount_no_tax": data["pending_delivery_amount_no_tax"],
            "pending_delivery_amount": data["pending_delivery_amount"],
        },
    )
    _upsert_order_line_record(
        conn,
        "purchase_contract",
        order_line_id,
        {
            "purchase_contract_no": data["purchase_contract_no"],
            "payment_terms": data["payment_terms"],
            "performance_period": data["purchase_performance_period"],
            "signed_amount": data["purchase_signed_amount"],
            "unsigned_amount": data["purchase_unsigned_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "purchase_invoice",
        order_line_id,
        1,
        {
            "received_invoice_date": data["received_invoice_date"],
            "received_invoice_date_text": None,
            "invoice_no": data["purchase_invoice_no"],
            "invoice_amount": data["purchase_invoice_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "warehouse_entry",
        order_line_id,
        1,
        {
            "warehouse_date": data["warehouse_date"],
            "warehouse_date_text": None,
            "voucher_no": data["warehouse_voucher_no"],
            "warehouse_amount": data["warehouse_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "finance_payment_entry",
        order_line_id,
        1,
        {
            "payment_date": data["booked_date"],
            "payment_date_text": None,
            "voucher_code": data["booked_voucher_code"],
            "booked_amount": data["booked_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "purchase_payment",
        order_line_id,
        1,
        {
            "due_payment_date": data["payment1_due_date"],
            "payment_date": data["payment1_date"],
            "payment_date_text": None,
            "payment_voucher_no": data["payment1_voucher_no"],
            "payment_amount": data["payment1_amount"],
        },
    )
    _upsert_phase_record(
        conn,
        "purchase_payment",
        order_line_id,
        2,
        {
            "due_payment_date": None,
            "payment_date": data["payment2_date"],
            "payment_date_text": None,
            "payment_voucher_no": data["payment2_voucher_no"],
            "payment_amount": data["payment2_amount"],
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
    with business_write() as conn:
        before = _record_snapshot(conn, table_name, record_id)
        conn.execute(text(f"UPDATE {table_name} SET deleted_at = CURRENT_TIMESTAMP WHERE id = :record_id"), {"record_id": record_id})
        write_operation_log(conn, user, "采购管理", action_name, f"删除{label} {record_id}", before=before)


def _record_snapshot(conn, table_name: str, record_id: int):
    return conn.execute(
        text(f"SELECT * FROM {table_name} WHERE id = :record_id"),
        {"record_id": record_id},
    ).mappings().first()


def _purchase_summary_snapshot(conn, order_line_id: int):
    return conn.execute(
        text(
            """
            SELECT pi.id, pi.order_line_id, p.project_code, so.order_no,
                   ol.goods_name, ol.specification_model,
                   pi.supplier_name, pi.purchase_tax_rate,
                   pi.purchase_unit_price_no_tax, pi.purchase_unit_price,
                   pi.cost_no_tax, pi.purchase_amount, pi.labor_cost, pi.other_cost
            FROM order_line ol
            JOIN sales_order so ON so.id = ol.sales_order_id
            JOIN project p ON p.id = so.project_id
            LEFT JOIN purchase_info pi
              ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
            WHERE ol.id = :order_line_id AND ol.deleted_at IS NULL
            """
        ),
        {"order_line_id": order_line_id},
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


def _validate_finance_payment_total(conn, order_line_id: int, booked_amount: Decimal, payment_id: int | None = None) -> None:
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
            "SELECT COALESCE(SUM(booked_amount), 0) FROM finance_payment_entry "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL" + exclude_clause
        ),
        params,
    ).scalar()
    if Decimal(paid or 0) + booked_amount > Decimal(purchase_amount or 0):
        raise HTTPException(status_code=422, detail="累计财务入账付款金额不能超过含税采购金额，数据有错误，请检查后重新提交。")


def _validate_finance_invoice_check_total(conn, order_line_id: int, received_invoice_amount: Decimal | None, check_id: int | None = None) -> None:
    if received_invoice_amount is None:
        return
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
    if check_id is not None:
        exclude_clause = " AND id <> :check_id"
        params["check_id"] = check_id
    checked = conn.execute(
        text(
            "SELECT COALESCE(SUM(received_invoice_amount), 0) FROM finance_invoice_check "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL" + exclude_clause
        ),
        params,
    ).scalar()
    if Decimal(checked or 0) + received_invoice_amount > Decimal(purchase_amount or 0):
        raise HTTPException(status_code=422, detail="累计发票校验金额不能超过含税采购金额，数据有错误，请检查后重新提交。")
