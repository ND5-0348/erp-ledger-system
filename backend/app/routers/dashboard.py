from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..auth import CurrentUser, apply_department_scope, get_current_user
from ..db import db
from ..serializers import clean_rows

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(user: CurrentUser = Depends(get_current_user)) -> dict[str, float | int]:
    conditions = ["1=1"]
    params: dict[str, object] = {}
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    with db() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT
                  COALESCE(SUM(order_value), 0) AS order_amount,
                  COALESCE(SUM(gross_profit), 0) AS gross_profit,
                  COUNT(DISTINCT order_no) AS order_count,
                  COALESCE(SUM(accounts_receivable), 0) AS accounts_receivable,
                  COALESCE(SUM(accounts_payable), 0) AS accounts_payable,
                  SUM(CASE WHEN close_status = '关闭' OR accounts_receivable = 0 THEN 1 ELSE 0 END) AS closed_count
                FROM v_order_line_finance
                WHERE {where_sql}
                """
            ),
            params,
        ).mappings().one()
    return {
        "orderAmount": float(row["order_amount"]),
        "grossProfit": float(row["gross_profit"]),
        "orderCount": int(row["order_count"]),
        "accountsReceivable": float(row["accounts_receivable"]),
        "accountsPayable": float(row["accounts_payable"]),
        "closedCount": int(row["closed_count"] or 0),
    }


@router.get("/trends")
def trends(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    conditions = ["order_date IS NOT NULL"]
    params: dict[str, object] = {}
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    with db() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT
                  DATE_FORMAT(order_date, '%Y-%m') AS month,
                  COALESCE(SUM(order_value), 0) AS order_amount,
                  COALESCE(SUM(gross_profit), 0) AS gross_profit
                FROM v_order_line_finance
                WHERE {where_sql}
                GROUP BY DATE_FORMAT(order_date, '%Y-%m')
                ORDER BY month
                """
            ),
            params,
        ).mappings().all()
    return clean_rows(rows)


@router.get("/department-ranking")
def department_ranking(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    conditions = ["1=1"]
    params: dict[str, object] = {}
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    with db() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT
                  COALESCE(department, '未分配') AS department,
                  COALESCE(SUM(order_value), 0) AS order_amount,
                  COALESCE(SUM(gross_profit), 0) AS gross_profit
                FROM v_order_line_finance
                WHERE {where_sql}
                GROUP BY department
                ORDER BY order_amount DESC
                LIMIT 10
                """
            ),
            params,
        ).mappings().all()
    return clean_rows(rows)
