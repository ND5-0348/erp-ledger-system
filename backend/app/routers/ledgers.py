from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..auth import CurrentUser, apply_department_scope, get_current_user
from ..db import db
from ..history_queries import order_match, manager_match, enrich_history, enrich_phases
from ..serializers import clean_rows

router = APIRouter(prefix="/api/ledgers", tags=["ledgers"])


@router.get("")
def list_ledgers(
    project_id: str | None = None,
    department: str | None = None,
    manager: str | None = None,
    include_history_manager: bool = False,
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
        conditions.append(manager_match() if include_history_manager else "account_manager LIKE :manager")
        params["manager"] = f"%{manager}%"
    if client_unit:
        conditions.append("customer_unit_name LIKE :client_unit")
        params["client_unit"] = f"%{client_unit}%"
    if order_id:
        conditions.append(order_match("project_code", project=True))
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
    # Scope individual source rows before aggregation: one framework may span departments.
    scope = ['1=1']
    apply_department_scope(scope, params, user, 'finance.department')
    if department:
        scope.append('finance.department = :department')
        conditions.remove('department = :department')

    where_sql = " AND ".join(conditions)
    totals = {key:key for key in ('purchase_amount','labor_cost','other_cost','total_finance_paid',
              'financial_accounts_payable','total_received','accounts_receivable','delivery_accounts_receivable',
              'invoice_accounts_receivable','accounts_payable','gross_profit_no_tax','gross_profit',
              'delivery_value','delivery_cost','total_paid','sales_invoice_amount')}
    totals['order_amount'] = 'order_value'
    sums = ','.join(f'SUM(COALESCE(finance.{column},0)) AS {key}' for key,column in totals.items())
    source_sql = f"""
          SELECT finance.project_code,
                 GROUP_CONCAT(DISTINCT finance.project_name ORDER BY finance.project_name SEPARATOR '；') AS project_name,
                 GROUP_CONCAT(DISTINCT finance.department ORDER BY finance.department SEPARATOR '；') AS department,
                 GROUP_CONCAT(DISTINCT finance.branch_company ORDER BY finance.branch_company SEPARATOR '；') AS branch_company,
                 GROUP_CONCAT(DISTINCT finance.account_manager ORDER BY finance.account_manager SEPARATOR '；') AS account_manager,
                 CASE WHEN COUNT(DISTINCT finance.customer_unit_name)>1 THEN '多个' ELSE MAX(finance.customer_unit_name) END AS customer_unit_name,
                 MIN(finance.order_date) AS first_order_date, MAX(finance.order_date) AS last_order_date,
                 COUNT(DISTINCT finance.order_no) AS order_count,
                 CASE WHEN SUM(COALESCE(finance.accounts_receivable,0))=0 THEN 'closed' ELSE 'open' END AS computed_close_status,
                 {sums}, SUM(COALESCE(received_invoice.invoice_amount,0)) AS received_invoice_amount
          FROM v_order_line_finance finance
          LEFT JOIN (
            SELECT order_line_id, SUM(COALESCE(invoice_amount, 0)) AS invoice_amount
            FROM purchase_invoice
            WHERE deleted_at IS NULL
            GROUP BY order_line_id
          ) received_invoice ON received_invoice.order_line_id = finance.order_line_id
          WHERE {' AND '.join(scope)}
          GROUP BY finance.project_code
    """
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM ({source_sql}) ledger_summary WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT *
                FROM ({source_sql}) ledger_summary
                WHERE {where_sql}
                ORDER BY last_order_date DESC, project_code
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
        items = enrich_history(conn, rows)
    return {"total": int(total or 0), "items": items}
