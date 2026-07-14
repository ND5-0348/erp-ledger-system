from datetime import date

import pytest
from pydantic import ValidationError

from app.routers.orders import OrderUpdate
from app.routers.purchases import PurchaseInvoiceCreate, PurchasePaymentCreate
from app.routers.sales import SalesInvoiceCreate, SalesReceiptCreate
from app.validation import validation_error_message
from app.importer import _as_date


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
