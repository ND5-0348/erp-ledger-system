from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.routers.orders import OrderUpdate, _calculated_payload_data
from app.routers.purchases import PurchaseInvoiceCreate, PurchasePaymentCreate
from app.routers.sales import SalesInvoiceCreate, SalesReceiptCreate
from app.validation import validation_error_message
from app.importer import _as_date, _as_tax_rate, _column_position, _is_latest_layout


@pytest.mark.parametrize(
    ("factory", "field"),
    [
        (lambda: OrderUpdate(order_value=-1), "order_value"),
        (lambda: PurchaseInvoiceCreate(invoice_amount=-1), "invoice_amount"),
        (lambda: PurchasePaymentCreate(payment_amount=-1), "payment_amount"),
        (lambda: SalesInvoiceCreate(invoice_amount=-1), "invoice_amount"),
        (lambda: SalesReceiptCreate(receipt_amount=-1), "receipt_amount"),
    ],
)
def test_negative_financial_amounts_are_rejected(factory, field):
    with pytest.raises(ValidationError) as exc_info:
        factory()
    assert field in str(exc_info.value)
    message = validation_error_message(exc_info.value.errors())
    assert "不能为负数" in message
    assert "数据有错误" in message


def test_invalid_business_date_is_rejected():
    with pytest.raises(ValidationError) as exc_info:
        OrderUpdate(order_date="not-a-date")
    assert validation_error_message(exc_info.value.errors()) == "日期格式错误，请检查输入数据。"


def test_business_date_year_must_not_exceed_2099():
    with pytest.raises(ValidationError) as exc_info:
        OrderUpdate(order_date="2100-01-01")
    assert validation_error_message(exc_info.value.errors()) == "日期年份不能超过2099，数据有错误，请检查后重新提交。"

    with pytest.raises(ValueError, match="2099"):
        _as_date(date(2100, 1, 1))


def test_valid_financial_values_are_normalized():
    order = OrderUpdate(order_date="2026-07-14", order_value="123.45")
    assert order.order_date == date(2026, 7, 14)
    assert str(order.order_value) == "123.45"


def test_tax_rates_recalculate_unit_prices_and_amounts():
    payload = OrderUpdate(
        quantity="2.000000",
        sales_tax_rate="13.000000",
        net_unit_price="100.000000",
        purchase_tax_rate="6.000000",
        purchase_unit_price_no_tax="50.000000",
    )
    data = _calculated_payload_data(payload)
    assert data["unit_price"] == Decimal("113.000000")
    assert data["net_revenue"] == Decimal("200.00")
    assert data["order_value"] == Decimal("226.00")
    assert data["purchase_unit_price"] == Decimal("53.000000")
    assert data["cost_no_tax"] == Decimal("100.00")
    assert data["purchase_amount"] == Decimal("106.00")


def test_excel_tax_rate_is_normalized_to_percent_value():
    assert _as_tax_rate(Decimal("0.13"), "0%") == Decimal("13.00")
    assert _as_tax_rate(Decimal("13")) == Decimal("13")
    assert _as_tax_rate(Decimal("0")) == Decimal("0")


def test_import_layout_detection_and_column_compatibility():
    assert _is_latest_layout(["项目编号", "物资/服务名称", "销售税率"])
    assert _is_latest_layout(["项目编号", "采购税率"])
    assert not _is_latest_layout(["项目编号", "货物名称", "不含税单价"])

    assert _column_position(True, 19, 0) == 19
    assert _column_position(False, 20, 19) == 19
    assert _column_position(False, 19) == 0
