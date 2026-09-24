import pytest
from fastapi import HTTPException
from app.financial_calculations import calculate_line


def test_calculated_amount_overflow_has_validation_response():
    with pytest.raises(HTTPException) as exc:
        calculate_line(dict(quantity='999999999999.999999', sales_unit_price='999999999999.999999'))
    assert exc.value.status_code == 422
