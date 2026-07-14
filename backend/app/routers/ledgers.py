from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..auth import CurrentUser, apply_department_scope, get_current_user
from ..db import db
from ..serializers import clean_rows

router = APIRouter(prefix="/api/ledgers", tags=["ledgers"])


@router.get("")
def list_ledgers(
    project_id: str | None = None,
    department: str | None = None,
    manager: str | None = None,
    client_unit: str | None = None,
    order_id: str | None = None,
    order_status: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    conditions = ["1=1"]
    params: dict[str, object] = {"limit": limit, "offset": offset}
    if project_id:
        conditions.append("project_code LIKE :project_id")
        params["project_id"] = f"%{project_id}%"
    if department:
        conditions.append("department = :department")
        params["department"] = department
    if manager:
        conditions.append("account_manager LIKE :manager")
        params["manager"] = f"%{manager}%"
    if client_unit:
        conditions.append("customer_unit_name LIKE :client_unit")
        params["client_unit"] = f"%{client_unit}%"
    if order_id:
        conditions.append("project_code IN (SELECT project_code FROM v_order_ledger_summary WHERE order_no LIKE :order_id)")
        params["order_id"] = f"%{order_id}%"
    if order_status:
        conditions.append("computed_close_status = :order_status OR :order_status IN ('全部', '')")
        params["order_status"] = order_status
    if start_date:
        conditions.append("last_order_date >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("first_order_date <= :end_date")
        params["end_date"] = end_date
    apply_department_scope(conditions, params, user)

    where_sql = " AND ".join(conditions)
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM v_project_ledger_summary WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM v_project_ledger_summary
                WHERE {where_sql}
                ORDER BY last_order_date DESC, project_code
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}
