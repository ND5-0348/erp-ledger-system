"""Shared line calculations. API percentages use 13 for 13%, never fractions."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from fastapi import HTTPException
from sqlalchemy import text


def decimal(value):
    return None if value is None or value == "" else Decimal(str(value))


def money(value):
    if not value.is_finite() or abs(value) > Decimal("9999999999999999.99"):
        raise HTTPException(status_code=422, detail="计算金额超出系统支持范围，请检查数量和单价。")
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def price(value):
    return value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def calculate_line(values: dict, previous: dict | None = None) -> dict:
    """Recompute known inputs; preserve legacy totals only when inputs are absent.

    Both price entry directions are supported. On edit, the changed price wins;
    existing net-price entry remains supported when both prices are supplied.
    """
    result = dict(values)
    quantity = decimal(result.get("quantity"))
    for net_key, gross_key, rate_key, net_amount, gross_amount in (
        ("sales_unit_price_no_tax", "sales_unit_price", "sales_tax_rate", "revenue_no_tax", "order_value"),
        ("purchase_unit_price_no_tax", "purchase_unit_price", "purchase_tax_rate", "cost_no_tax", "purchase_amount"),
    ):
        net, gross, rate = (decimal(result.get(k)) for k in (net_key, gross_key, rate_key))
        gross_changed = previous is not None and gross != decimal(previous.get(gross_key))
        net_changed = previous is not None and net != decimal(previous.get(net_key))
        if rate is not None:
            if gross is not None and (net is None or (gross_changed and not net_changed)):
                net = price(gross / (1 + rate / 100))
            elif net is not None:
                gross = price(net * (1 + rate / 100))
        if any(v is not None and (not v.is_finite() or abs(v) > Decimal("999999999999.999999")) for v in (net, gross)):
            raise HTTPException(status_code=422, detail="计算单价超出系统支持范围，请检查单价和税率。")
        result[net_key], result[gross_key] = net, gross
        if quantity is not None:
            if net is not None:
                result[net_amount] = money(quantity * net)
            if gross is not None:
                result[gross_amount] = money(quantity * gross)

    delivered = decimal(result.get("delivery_quantity"))
    if quantity is not None and delivered is not None:
        if delivered > quantity:
            raise HTTPException(status_code=422, detail="交付数量不能超过订单数量，数据有错误，请检查后重新提交。")
        result["pending_delivery_quantity"] = quantity - delivered
    for target, unit_key in (
        ("delivery_revenue_no_tax", "sales_unit_price_no_tax"),
        ("delivery_value", "sales_unit_price"),
        ("delivery_cost_no_tax", "purchase_unit_price_no_tax"),
        ("delivery_cost", "purchase_unit_price"),
    ):
        unit = decimal(result.get(unit_key))
        if delivered is not None and unit is not None:
            result[target] = money(delivered * unit)
    for target, total, used in (
        ("pending_delivery_amount_no_tax", "revenue_no_tax", "delivery_revenue_no_tax"),
        ("pending_delivery_amount", "order_value", "delivery_value"),
    ):
        total_value, used_value = decimal(result.get(total)), decimal(result.get(used))
        if total_value is not None and used_value is not None:
            result[target] = money(total_value - used_value)
    if previous and previous.get('source_preserved'):
        # A description/date edit must not replace authoritative source totals
        # with a fresh multiplication of rounded unit prices.
        for drivers, outputs in (
            (('quantity','sales_tax_rate','sales_unit_price_no_tax','sales_unit_price'), ('sales_unit_price','revenue_no_tax','order_value')),
            (('quantity','purchase_tax_rate','purchase_unit_price_no_tax','purchase_unit_price'), ('purchase_unit_price','cost_no_tax','purchase_amount')),
            (('delivery_quantity','sales_unit_price_no_tax','sales_unit_price'), ('delivery_revenue_no_tax','delivery_value','pending_delivery_amount_no_tax','pending_delivery_amount')),
            (('delivery_quantity','purchase_unit_price_no_tax','purchase_unit_price'), ('delivery_cost_no_tax','delivery_cost')),
        ):
            if all(decimal(values.get(k, previous.get(k))) == decimal(previous.get(k)) for k in drivers):
                for key in outputs:
                    if key in previous:
                        result[key] = previous[key]
    return result


def line_snapshot(conn, order_line_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM v_order_line_finance WHERE order_line_id=:id"), {"id": order_line_id}).mappings().first()
    return dict(row) if row else {}


def refresh_line(conn, order_line_id: int, *, sales: bool = True, purchase: bool = True) -> None:
    """Called within the owning write transaction; never invoked by GET routes."""
    conn.execute(text("SELECT id FROM order_line WHERE id=:id FOR UPDATE"), {"id": order_line_id})
    from .edit_versions import touch_line
    touch_line(conn, order_line_id)
    current = line_snapshot(conn, order_line_id)
    if not current:
        return
    if current.get('source_preserved'):
        refresh_balances(conn, order_line_id)
        return
    inputs = dict(current)
    if not sales:
        inputs["sales_tax_rate"] = None
    if not purchase:
        inputs["purchase_tax_rate"] = None
    calculated = calculate_line(inputs)
    fields_by_table = {
        "order_line": ["sales_unit_price_no_tax", "sales_unit_price", "revenue_no_tax", "order_value"] if sales else [],
        "purchase_info": ["purchase_unit_price_no_tax", "purchase_unit_price", "cost_no_tax", "purchase_amount"] if purchase else [],
        "delivery_record": ["delivery_revenue_no_tax", "delivery_value", "delivery_cost_no_tax", "delivery_cost", "pending_delivery_quantity", "pending_delivery_amount_no_tax", "pending_delivery_amount"],
    }
    for table, keys in fields_by_table.items():
        changed = {key: calculated.get(key) for key in keys if calculated.get(key) != current.get(key)}
        if not changed:
            continue
        assignments = ", ".join(f"{key}=:{key}" for key in changed)
        identifier = "id" if table == "order_line" else "order_line_id"
        conn.execute(text(f"UPDATE {table} SET {assignments} WHERE {identifier}=:id AND deleted_at IS NULL"), {"id": order_line_id, **changed})
    refresh_balances(conn, order_line_id)


def refresh_balances(conn, order_line_id: int) -> None:
    """Refresh stored calculated compatibility fields after any owning mutation."""
    current = line_snapshot(conn, order_line_id)
    if not current:
        return
    invoiced = decimal(current.get("sales_invoice_amount")) or Decimal(0)
    order_amount = decimal(current.get("order_value")) or Decimal(0)
    delivery_amount = decimal(current.get("delivery_value")) or Decimal(0)
    purchase_amount = decimal(current.get("purchase_amount")) or Decimal(0)
    signed = decimal(current.get("purchase_contract_signed_amount")) or Decimal(0)
    conn.execute(text("UPDATE purchase_contract SET unsigned_amount=:amount WHERE order_line_id=:id AND deleted_at IS NULL"), {"id": order_line_id, "amount": money(purchase_amount-signed)})
    conn.execute(text("UPDATE sales_invoice SET pending_invoice_amount=:pending, delivered_not_invoiced_amount=:delivered WHERE order_line_id=:id AND deleted_at IS NULL"), {"id": order_line_id, "pending": money(order_amount-invoiced), "delivered": money(delivery_amount-invoiced)})
    conn.execute(text("UPDATE sales_receipt SET receipt_ratio=ROUND(receipt_amount / NULLIF(:invoiced,0) * 100,6) WHERE order_line_id=:id AND deleted_at IS NULL"), {"id": order_line_id, "invoiced": invoiced})
    # Closure belongs to the sales order, and all its active lines must balance.
    so_id = conn.execute(text("SELECT sales_order_id FROM order_line WHERE id=:id"), {"id": order_line_id}).scalar()
    remaining = conn.execute(text("SELECT COUNT(*) FROM v_order_line_finance WHERE order_line_id IN (SELECT id FROM order_line WHERE sales_order_id=:id AND deleted_at IS NULL) AND accounts_receivable <> 0"), {"id": so_id}).scalar()
    conn.execute(text("UPDATE sales_order SET close_status=:status WHERE id=:id"), {"id": so_id, "status": None if remaining else "关闭"})


def sales_record_values(summaries, invoices, receipts):
    """Read-time formulas also cover historical records without rewriting them."""
    by_line = {int(row["order_line_id"]): dict(row) for row in summaries}
    only_id = next(iter(by_line), None)
    out_invoices, out_receipts = [], []
    for row in invoices:
        item = dict(row)
        base = by_line[int(item.get("order_line_id") or only_id)]
        total = decimal(base.get("sales_invoice_amount")) or Decimal(0)
        item["pending_invoice_amount"] = money((decimal(base.get("order_value")) or Decimal(0))-total)
        item["delivered_not_invoiced_amount"] = money((decimal(base.get("delivery_value")) or Decimal(0))-total)
        out_invoices.append(item)
    for row in receipts:
        item = dict(row)
        base = by_line[int(item.get("order_line_id") or only_id)]
        total = decimal(base.get("sales_invoice_amount")) or Decimal(0)
        item["receipt_ratio"] = price((decimal(item.get("receipt_amount")) or Decimal(0))/total*100) if total else None
        out_receipts.append(item)
    return out_invoices, out_receipts
