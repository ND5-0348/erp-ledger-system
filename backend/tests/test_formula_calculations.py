from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.financial_calculations import calculate_line
from app.importer import _as_tax_rate
from app.ledger_excel import _ratio


@pytest.mark.parametrize('value,fmt,expected', [
    (0.005, '0.00%', '0.5'), (0.01, '0%', '1'), (0.13, '0%', '13'),
    (0.5, 'General', '0.5'), (1, 'General', '1'), ('0.5%', 'General', '0.5'),
    (13, '0.00"%"', '13'), (13, r'0.00\%', '13'), (0, '0%', '0'),
])
def test_percent_format_not_magnitude_controls_import(value, fmt, expected):
    assert _as_tax_rate(value, fmt) == Decimal(expected)


@pytest.mark.parametrize('value', ['0', '0.5', '1', '13', '100'])
def test_percentage_export_always_converts_percentage_points(value):
    assert Decimal(str(_ratio(Decimal(value)))) == Decimal(value) / 100


def test_changed_gross_price_drives_net_and_delivery():
    previous = dict(quantity=10, sales_tax_rate=13, sales_unit_price_no_tax=100,
                    sales_unit_price=113, delivery_quantity=3)
    result = calculate_line({**previous, 'sales_unit_price': 226}, previous)
    assert result['sales_unit_price_no_tax'] == 200
    assert result['order_value'] == 2260
    assert result['delivery_value'] == 678
    assert result['pending_delivery_amount'] == 1582


def test_amounts_recalculate_without_tax_rate_and_preserve_zero():
    result = calculate_line(dict(quantity=0, sales_unit_price=113,
                                 sales_unit_price_no_tax=100, order_value=999,
                                 delivery_quantity=0, pending_delivery_amount=999))
    assert result['order_value'] == result['pending_delivery_amount'] == 0


def test_pending_amount_is_difference_of_rounded_totals():
    result = calculate_line(dict(quantity=3, sales_unit_price_no_tax='0.335',
                                 delivery_quantity=1))
    assert result['revenue_no_tax'] == Decimal('1.01')
    assert result['delivery_revenue_no_tax'] == Decimal('0.34')
    assert result['pending_delivery_amount_no_tax'] == Decimal('0.67')


def test_half_cent_matches_editor_preview():
    result = calculate_line(dict(quantity='1', sales_unit_price_no_tax='10.075',
                                 sales_unit_price='10.075', delivery_quantity='1'))
    assert result['revenue_no_tax'] == Decimal('10.08')
    assert result['order_value'] == Decimal('10.08')
    assert result['delivery_value'] == Decimal('10.08')


def test_quantity_cannot_drop_below_delivery():
    with pytest.raises(HTTPException) as exc:
        calculate_line(dict(quantity=2, delivery_quantity=3))
    assert exc.value.status_code == 422
