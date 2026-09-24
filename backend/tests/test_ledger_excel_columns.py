from __future__ import annotations

from app.ledger_excel import editor_columns


TEXT_KEYS = {
    "amount_type",
    "project_code",
    "department",
    "branch_company",
    "account_manager",
    "business_type",
    "statistical_category",
    "team_name",
    "customer_unit_name",
    "user_name",
    "regional_platform",
    "order_no",
    "project_name",
    "goods_name",
    "specification_model",
    "unit_name",
    "supplier_name",
    "purchase_contract_no",
    "payment_terms",
    "purchase_performance_period",
    "purchase_invoice_no",
    "warehouse_voucher_no",
    "booked_voucher_code",
    "payment1_voucher_no",
    "payment2_voucher_no",
    "sales_contract_no",
    "sales_performance_period",
    "invoice_doc_no",
    "sales_invoice_no",
    "receipt1_notice_no",
    "receipt2_notice_no",
    "close_status",
}

DATE_KEYS = {
    "order_date",
    "delivery_date",
    "received_invoice_date",
    "warehouse_date",
    "booked_date",
    "payment1_due_date",
    "payment1_date",
    "payment2_date",
    "contract_signed_date",
    "invoice_date",
    "receipt1_date",
    "receipt2_date",
}

PERCENTAGE_KEYS = {
    "sales_tax_rate",
    "purchase_tax_rate",
    "gross_profit_margin_no_tax",
    "receipt1_ratio",
    "receipt2_ratio",
}


def _mapped_columns() -> list[dict[str, object]]:
    basic = editor_columns("basic")[:23]
    purchase = editor_columns("purchase")[23:67]
    sales = editor_columns("sales")[67:92]
    return [column for column in basic + purchase + sales if column["key"]]


def test_all_batch_editor_column_types_match_business_field_types() -> None:
    columns = _mapped_columns()
    by_key = {str(column["key"]): column for column in columns}

    assert TEXT_KEYS | DATE_KEYS | PERCENTAGE_KEYS <= by_key.keys()

    for key, column in by_key.items():
        expected_type = (
            "text"
            if key in TEXT_KEYS
            else "date"
            if key in DATE_KEYS
            else "percentage"
            if key in PERCENTAGE_KEYS
            else "number"
        )
        assert column["value_type"] == expected_type, (
            f'{column["excel_column"]}列“{column["label"]}”'
            f'（{key}）应为 {expected_type}，实际为 {column["value_type"]}'
        )


def test_text_identifiers_inside_numeric_column_ranges_remain_text() -> None:
    purchase_columns = {
        column["excel_column"]: column for column in editor_columns("purchase")
    }
    sales_columns = {
        column["excel_column"]: column for column in editor_columns("sales")
    }

    assert purchase_columns["X"]["key"] == "supplier_name"
    assert purchase_columns["X"]["value_type"] == "text"
    assert sales_columns["CF"]["key"] == "receipt2_notice_no"
    assert sales_columns["CF"]["value_type"] == "text"
