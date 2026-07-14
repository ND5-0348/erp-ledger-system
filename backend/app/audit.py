from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .auth import CurrentUser


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _snapshot(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return {key: _json_value(item) for key, item in value.items()}


def write_operation_log(
    conn: Connection,
    user: CurrentUser,
    module_name: str,
    action_name: str,
    detail: str,
    *,
    before: Mapping[str, Any] | None = None,
    after: Mapping[str, Any] | None = None,
) -> None:
    audit_detail = {
        "summary": detail,
        "before": _snapshot(before),
        "after": _snapshot(after),
    }
    conn.execute(
        text(
            """
            INSERT INTO operation_log
              (user_id, user_name, module_name, action_name, detail, status)
            VALUES
              (:user_id, :user_name, :module_name, :action_name, :detail, 'success')
            """
        ),
        {
            "user_id": user.id,
            "user_name": user.display_name,
            "module_name": module_name,
            "action_name": action_name,
            "detail": json.dumps(audit_detail, ensure_ascii=False),
        },
    )

