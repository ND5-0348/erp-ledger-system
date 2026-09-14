from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Mapping


def clean_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone(timedelta(hours=8)))
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def clean_row(row: Mapping[str, Any]) -> dict[str, Any]:
    result = {}
    for key, value in row.items():
        # MySQL GREATEST/COALESCE in the finance view can return text rather
        # than datetime. Normalize only this timestamp, never arbitrary text.
        if key == "last_modified_at" and isinstance(value, str):
            value = datetime.fromisoformat(value)
        result[key] = clean_value(value)
    return result


def clean_rows(rows: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [clean_row(row) for row in rows]
