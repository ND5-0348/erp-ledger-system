from __future__ import annotations

from datetime import date
from decimal import Decimal
from pydantic import AfterValidator, Field
from typing_extensions import Annotated


Money = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)]
PreciseNumber = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=6, allow_inf_nan=False)]
Ratio = Annotated[Decimal, Field(ge=0, le=100, max_digits=10, decimal_places=6, allow_inf_nan=False)]


def validate_business_date(value: date) -> date:
    if value.year > 2099:
        raise ValueError("日期年份不能超过2099")
    return value


BusinessDate = Annotated[date, AfterValidator(validate_business_date)]


FIELD_LABELS = {
    "order_value": "订单金额",
    "purchase_amount": "采购金额",
    "signed_amount": "合同签订金额",
    "unsigned_amount": "待签合同金额",
    "contract_value": "合同金额",
    "unsigned_contract_amount": "待签合同金额",
    "invoice_amount": "发票金额",
    "pending_invoice_amount": "待开发票金额",
    "delivered_not_invoiced_amount": "已交付未开票金额",
    "payment_amount": "付款金额",
    "receipt_amount": "回款金额",
    "net_revenue": "不含税收入",
    "cost_no_tax": "不含税成本",
    "delivery_value": "交付金额",
    "delivery_cost": "交付成本",
    "pending_delivery_amount": "待交付金额",
}


def validation_error_message(errors: list[dict]) -> str:
    for error in errors:
        location = error.get("loc") or []
        field_name = str(location[-1]) if location else ""
        error_type = str(error.get("type") or "")
        field_label = FIELD_LABELS.get(field_name, "金额")
        if error_type == "greater_than_equal" and (
            field_name in FIELD_LABELS
            or "amount" in field_name
            or "value" in field_name
            or "price" in field_name
            or "cost" in field_name
            or "revenue" in field_name
        ):
            return f"{field_label}不能为负数，数据有错误，请检查后重新提交。"
        if "date" in field_name and error_type in {"date_from_datetime_parsing", "date_parsing"}:
            return "日期格式错误，请检查输入数据。"
        if "date" in field_name and error_type == "value_error" and "2099" in str(error):
            return "日期年份不能超过2099，数据有错误，请检查后重新提交。"
        if error_type == "missing":
            return f"{FIELD_LABELS.get(field_name, field_name or '该字段')}为必填项，请检查输入数据。"
    return "提交的数据格式有错误，请检查后重新提交。"
