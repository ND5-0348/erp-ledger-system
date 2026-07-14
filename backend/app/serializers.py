from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping


def clean_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def clean_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: clean_value(value) for key, value in row.items()}


def clean_rows(rows: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [clean_row(row) for row in rows]

