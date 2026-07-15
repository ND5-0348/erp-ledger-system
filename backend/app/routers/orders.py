from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

from ..audit import write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..db import db
from ..serializers import clean_row, clean_rows
from ..validation import BusinessDate, Money, PreciseNumber

router = APIRouter(prefix="/api/orders", tags=["orders"])


class OrderUpdate(BaseModel):
    amount_type: str | None = None
    project_code: str | None = Field(default=None, max_length=64)
    project_name: str | None = None
    department: str | None = None
    branch_company: str | None = None
    account_manager: str | None = None
    order_no: str | None = None
    order_date: BusinessDate | None = None
    business_type: str | None = None
    statistical_category: str | None = None
    team_name: str | None = None
    customer_unit_name: str | None = None
    user_name: str | None = None
    regional_platform: str | None = None
    goods_name: str | None = None
    specification_model: str | None = None
    unit_name: str | None = None
    quantity: PreciseNumber | None = None
    net_unit_price: PreciseNumber | None = None
    unit_price: PreciseNumber | None = None
    net_revenue: Money | None = None
    order_value: Money | None = None
    supplier_name: str | None = None
    purchase_unit_price_no_tax: PreciseNumber | None = None
    purchase_unit_price: PreciseNumber | None = None
    cost_no_tax: Money | None = None
    purchase_amount: Money | None = None
    delivery_date: BusinessDate | None = None
    delivery_quantity: PreciseNumber | None = None
    delivery_revenue_no_tax: Money | None = None
    delivery_value: Money | None = None
    delivery_cost_no_tax: Money | None = None
    delivery_cost: Money | None = None
    pending_delivery_quantity: PreciseNumber | None = None
    pending_delivery_amount_no_tax: Money | None = None
    pending_delivery_amount: Money | None = None


class OrderBatchCreate(BaseModel):
    items: list[OrderUpdate] = Field(min_length=1, max_length=500)


@router.get("")
def list_orders(
    project_id: str | None = None,
    order_id: str | None = None,
    business_type: str | None = None,
    client_unit: str | None = None,
    supplier_name: str | None = None,
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
    if order_id:
        conditions.append("order_no LIKE :order_id")
        params["order_id"] = f"%{order_id}%"
    if business_type:
        conditions.append("business_type = :business_type")
        params["business_type"] = business_type
    if client_unit:
        conditions.append("customer_unit_name LIKE :client_unit")
        params["client_unit"] = f"%{client_unit}%"
    if supplier_name:
        conditions.append("supplier_name LIKE :supplier_name")
        params["supplier_name"] = f"%{supplier_name}%"
    if start_date:
        conditions.append("order_date >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("order_date <= :end_date")
        params["end_date"] = end_date
    apply_department_scope(conditions, params, user)
    where_sql = " AND ".join(conditions)
    with db() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM v_order_line_finance WHERE {where_sql}"), params).scalar()
        rows = conn.execute(
            text(
                f"""
                SELECT
                       project_code,
                       order_line_id,
                       order_no,
                       gross_net_type AS amount_type,
                       department,
                       branch_company,
                       account_manager,
                       order_date,
                       business_type,
                       statistic_category AS statistical_category,
                       team_level3_name AS team_name,
                       customer_unit_name,
                       end_user_name AS user_name,
                       regional_platform,
                       project_name,
                       goods_name,
                       specification_model AS spec_model,
                       unit_name,
                       quantity,
                       sales_unit_price_no_tax AS net_unit_price,
                       sales_unit_price AS unit_price,
                       revenue_no_tax AS net_revenue,
                       order_value,
                       supplier_name,
                       purchase_unit_price_no_tax,
                       purchase_unit_price,
                       cost_no_tax,
                       purchase_amount,
                       delivery_date,
                       delivery_quantity,
                       delivery_revenue_no_tax,
                       delivery_value,
                       delivery_cost_no_tax,
                       delivery_cost,
                       pending_delivery_quantity,
                       pending_delivery_amount_no_tax,
                       pending_delivery_amount
                FROM (
                    SELECT
                           p.project_code,
                           ol.id AS order_line_id,
                           so.order_no,
                           so.gross_net_type,
                           p.department,
                           p.branch_company,
                           p.account_manager,
                           p.team_level3_name,
                           p.end_user_name,
                           p.regional_platform,
                           so.order_date,
                           so.business_type,
                           so.statistic_category,
                           p.customer_unit_name,
                           p.project_name,
                           ol.goods_name,
                           ol.specification_model,
                           ol.unit_name,
                           ol.quantity,
                           ol.sales_unit_price_no_tax,
                           ol.sales_unit_price,
                           ol.revenue_no_tax,
                           ol.order_value,
                           pi.supplier_name,
                           pi.purchase_unit_price_no_tax,
                           pi.purchase_unit_price,
                           pi.cost_no_tax,
                           pi.purchase_amount,
                           dr.delivery_date,
                           dr.delivery_quantity,
                           dr.delivery_revenue_no_tax,
                           dr.delivery_value,
                           dr.delivery_cost_no_tax,
                           dr.delivery_cost,
                           dr.pending_delivery_quantity,
                           dr.pending_delivery_amount_no_tax,
                           dr.pending_delivery_amount
                    FROM project p
                    JOIN sales_order so ON so.project_id = p.id AND so.deleted_at IS NULL
                    JOIN order_line ol ON ol.sales_order_id = so.id AND ol.deleted_at IS NULL
                    LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
                    LEFT JOIN delivery_record dr ON dr.order_line_id = ol.id AND dr.deleted_at IS NULL
                    WHERE p.deleted_at IS NULL
                ) order_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, order_no
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.post("")
def create_order_line(
    payload: OrderUpdate,
    user: CurrentUser = Depends(require_permission("order_entry")),
) -> dict:
    _validate_create_payload(payload, user)
    try:
        with db() as conn:
            order_line_id = _create_order_line(conn, payload)
            write_operation_log(
                conn,
                user,
                "订单管理",
                "create_order",
                f"新增订单 {payload.order_no}",
                after=_payload_dict(payload),
            )
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="项目、订单或订单明细已存在") from exc
    return get_order_line(order_line_id, user)


@router.post("/batch")
def create_order_lines_batch(
    payload: OrderBatchCreate,
    user: CurrentUser = Depends(require_permission("order_entry")),
) -> dict:
    for item in payload.items:
        _validate_create_payload(item, user)
    created_ids: list[int] = []
    try:
        with db() as conn:
            for item in payload.items:
                created_ids.append(_create_order_line(conn, item))
            write_operation_log(
                conn,
                user,
                "订单管理",
                "batch_create_orders",
                f"批量新增 {len(created_ids)} 条订单明细",
                after={"order_line_ids": created_ids},
            )
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="批量导入包含重复的项目、订单或订单明细") from exc
    return {"created": len(created_ids), "order_line_ids": created_ids}


@router.put("/{order_line_id}")
def update_order_line(
    order_line_id: int,
    payload: OrderUpdate,
    user: CurrentUser = Depends(require_permission("order_edit")),
) -> dict:
    _validate_create_payload(payload, user)
    ids = _ensure_order_line(order_line_id, user, require_entry=True)
    data = _payload_dict(payload)
    project_data = {
        "project_code": data["project_code"],
        "project_name": data["project_name"],
        "department": data["department"],
        "branch_company": data["branch_company"],
        "account_manager": data["account_manager"],
        "team_level3_name": data["team_name"],
        "customer_unit_name": data["customer_unit_name"],
        "end_user_name": data["user_name"],
        "regional_platform": data["regional_platform"],
    }
    order_data = {
        "gross_net_type": data["amount_type"],
        "order_no": data["order_no"],
        "order_date": data["order_date"],
        "business_type": data["business_type"],
        "statistic_category": data["statistical_category"],
    }
    line_data = {
        "goods_name": data["goods_name"],
        "specification_model": data["specification_model"],
        "unit_name": data["unit_name"],
        "quantity": data["quantity"],
        "sales_unit_price_no_tax": data["net_unit_price"],
        "sales_unit_price": data["unit_price"],
        "revenue_no_tax": data["net_revenue"],
        "order_value": data["order_value"],
    }
    purchase_data = {
        "supplier_name": data["supplier_name"],
        "purchase_unit_price_no_tax": data["purchase_unit_price_no_tax"],
        "purchase_unit_price": data["purchase_unit_price"],
        "cost_no_tax": data["cost_no_tax"],
        "purchase_amount": data["purchase_amount"],
    }
    delivery_data = {
        "delivery_date": data["delivery_date"],
        "delivery_quantity": data["delivery_quantity"],
        "delivery_revenue_no_tax": data["delivery_revenue_no_tax"],
        "delivery_value": data["delivery_value"],
        "delivery_cost_no_tax": data["delivery_cost_no_tax"],
        "delivery_cost": data["delivery_cost"],
        "pending_delivery_quantity": data["pending_delivery_quantity"],
        "pending_delivery_amount_no_tax": data["pending_delivery_amount_no_tax"],
        "pending_delivery_amount": data["pending_delivery_amount"],
    }
    with db() as conn:
        before = conn.execute(
            text("SELECT * FROM v_order_line_finance WHERE order_line_id = :order_line_id"),
            {"order_line_id": order_line_id},
        ).mappings().first()
        conn.execute(
            text(
                """
                UPDATE project
                SET project_code = :project_code,
                    project_name = :project_name,
                    department = :department,
                    branch_company = :branch_company,
                    account_manager = :account_manager,
                    team_level3_name = :team_level3_name,
                    customer_unit_name = :customer_unit_name,
                    end_user_name = :end_user_name,
                    regional_platform = :regional_platform
                WHERE id = :project_id
                """
            ),
            {"project_id": ids["project_id"], **project_data},
        )
        conn.execute(
            text(
                """
                UPDATE sales_order
                SET gross_net_type = :gross_net_type,
                    order_no = :order_no,
                    order_date = :order_date,
                    business_type = :business_type,
                    statistic_category = :statistic_category
                WHERE id = :sales_order_id
                """
            ),
            {"sales_order_id": ids["sales_order_id"], **order_data},
        )
        conn.execute(
            text(
                """
                UPDATE order_line
                SET goods_name = :goods_name,
                    specification_model = :specification_model,
                    unit_name = :unit_name,
                    quantity = :quantity,
                    sales_unit_price_no_tax = :sales_unit_price_no_tax,
                    sales_unit_price = :sales_unit_price,
                    revenue_no_tax = :revenue_no_tax,
                    order_value = :order_value
                WHERE id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id, **line_data},
        )
        _upsert_line_record(conn, "purchase_info", order_line_id, purchase_data)
        _upsert_line_record(conn, "delivery_record", order_line_id, delivery_data)
        after = conn.execute(
            text("SELECT * FROM v_order_line_finance WHERE order_line_id = :order_line_id"),
            {"order_line_id": order_line_id},
        ).mappings().first()
        write_operation_log(
            conn,
            user,
            "订单管理",
            "update_order",
            f"修改订单明细 {order_line_id}",
            before=before,
            after=after,
        )
    return get_order_line(order_line_id, user)


@router.delete("/{order_line_id}")
def delete_order_line(
    order_line_id: int,
    user: CurrentUser = Depends(require_permission("order_delete")),
) -> dict:
    ids = _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        before = conn.execute(
            text("SELECT * FROM v_order_line_finance WHERE order_line_id = :order_line_id"),
            {"order_line_id": order_line_id},
        ).mappings().first()
        conn.execute(text("UPDATE order_line SET deleted_at = CURRENT_TIMESTAMP WHERE id = :order_line_id"), {"order_line_id": order_line_id})
        active_count = conn.execute(
            text("SELECT COUNT(*) FROM order_line WHERE sales_order_id = :sales_order_id AND deleted_at IS NULL"),
            {"sales_order_id": ids["sales_order_id"]},
        ).scalar()
        if int(active_count or 0) == 0:
            conn.execute(text("UPDATE sales_order SET deleted_at = CURRENT_TIMESTAMP WHERE id = :sales_order_id"), {"sales_order_id": ids["sales_order_id"]})
        write_operation_log(
            conn,
            user,
            "订单管理",
            "delete_order",
            f"删除订单明细 {order_line_id}",
            before=before,
        )
    return {"deleted": True, "order_line_id": order_line_id}


def get_order_line(order_line_id: int, user: CurrentUser) -> dict:
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT *
                FROM v_order_line_finance
                WHERE order_line_id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order line not found")
    if not can_access_department(user, str(row["department"]) if row["department"] is not None else None):
        raise HTTPException(status_code=403, detail="Department permission denied")
    return clean_row(row)


def _ensure_order_line(order_line_id: int, user: CurrentUser, require_entry: bool = False) -> dict:
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT ol.id AS order_line_id, ol.sales_order_id, so.project_id, p.department
                FROM order_line ol
                JOIN sales_order so ON so.id = ol.sales_order_id AND so.deleted_at IS NULL
                JOIN project p ON p.id = so.project_id AND p.deleted_at IS NULL
                WHERE ol.id = :order_line_id AND ol.deleted_at IS NULL
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order line not found")
    if not can_access_department(user, str(row["department"]) if row["department"] is not None else None, require_entry):
        raise HTTPException(status_code=403, detail="Department permission denied")
    return dict(row)


def _payload_dict(payload: BaseModel) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return payload.dict()


def _validate_create_payload(payload: OrderUpdate, user: CurrentUser) -> None:
    required = {
        "project_code": payload.project_code,
        "order_no": payload.order_no,
        "goods_name": payload.goods_name,
        "customer_unit_name": payload.customer_unit_name,
    }
    missing = [name for name, value in required.items() if not str(value or "").strip()]
    if payload.order_value is None:
        missing.append("order_value")
    if missing:
        raise HTTPException(status_code=422, detail=f"缺少必填字段: {', '.join(missing)}")
    if not can_access_department(user, payload.department, require_entry=True):
        raise HTTPException(status_code=403, detail="Department permission denied")


def _create_order_line(conn, payload: OrderUpdate) -> int:
    data = _payload_dict(payload)
    project = conn.execute(
        text("SELECT id FROM project WHERE project_code = :project_code LIMIT 1"),
        {"project_code": data["project_code"]},
    ).mappings().first()
    project_values = {
        "project_code": data["project_code"],
        "project_name": data["project_name"],
        "department": data["department"],
        "branch_company": data["branch_company"],
        "account_manager": data["account_manager"],
        "team_level3_name": data["team_name"],
        "customer_unit_name": data["customer_unit_name"],
        "end_user_name": data["user_name"],
        "regional_platform": data["regional_platform"],
    }
    if project:
        project_id = int(project["id"])
        assignments = ", ".join(f"{key} = :{key}" for key in project_values if key != "project_code")
        conn.execute(
            text(f"UPDATE project SET {assignments}, deleted_at = NULL WHERE id = :project_id"),
            {"project_id": project_id, **project_values},
        )
    else:
        result = conn.execute(
            text(
                """
                INSERT INTO project
                  (project_code, project_name, department, branch_company, account_manager,
                   team_level3_name, customer_unit_name, end_user_name, regional_platform)
                VALUES
                  (:project_code, :project_name, :department, :branch_company, :account_manager,
                   :team_level3_name, :customer_unit_name, :end_user_name, :regional_platform)
                """
            ),
            project_values,
        )
        project_id = int(result.lastrowid or 0)

    sales_order = conn.execute(
        text("SELECT id FROM sales_order WHERE project_id = :project_id AND order_no = :order_no LIMIT 1"),
        {"project_id": project_id, "order_no": data["order_no"]},
    ).mappings().first()
    order_values = {
        "project_id": project_id,
        "gross_net_type": data["amount_type"],
        "order_no": data["order_no"],
        "order_date": data["order_date"],
        "business_type": data["business_type"],
        "statistic_category": data["statistical_category"],
    }
    if sales_order:
        sales_order_id = int(sales_order["id"])
        conn.execute(
            text(
                """
                UPDATE sales_order
                SET gross_net_type = :gross_net_type, order_date = :order_date,
                    business_type = :business_type, statistic_category = :statistic_category,
                    deleted_at = NULL
                WHERE id = :sales_order_id
                """
            ),
            {"sales_order_id": sales_order_id, **order_values},
        )
    else:
        result = conn.execute(
            text(
                """
                INSERT INTO sales_order
                  (project_id, gross_net_type, order_no, order_date, business_type, statistic_category)
                VALUES
                  (:project_id, :gross_net_type, :order_no, :order_date, :business_type, :statistic_category)
                """
            ),
            order_values,
        )
        sales_order_id = int(result.lastrowid or 0)

    duplicate = conn.execute(
        text(
            """
            SELECT id FROM order_line
            WHERE sales_order_id = :sales_order_id AND deleted_at IS NULL
              AND COALESCE(goods_name, '') = COALESCE(:goods_name, '')
              AND COALESCE(specification_model, '') = COALESCE(:specification_model, '')
            LIMIT 1
            """
        ),
        {
            "sales_order_id": sales_order_id,
            "goods_name": data["goods_name"],
            "specification_model": data["specification_model"],
        },
    ).scalar()
    if duplicate:
        raise HTTPException(status_code=409, detail="相同订单下已存在同名同规格的明细")

    result = conn.execute(
        text(
            """
            INSERT INTO order_line
              (sales_order_id, goods_name, specification_model, unit_name, quantity,
               sales_unit_price_no_tax, sales_unit_price, revenue_no_tax, order_value)
            VALUES
              (:sales_order_id, :goods_name, :specification_model, :unit_name, :quantity,
               :net_unit_price, :unit_price, :net_revenue, :order_value)
            """
        ),
        {"sales_order_id": sales_order_id, **data},
    )
    order_line_id = int(result.lastrowid or 0)
    _upsert_line_record(
        conn,
        "purchase_info",
        order_line_id,
        {
            "supplier_name": data["supplier_name"],
            "purchase_unit_price_no_tax": data["purchase_unit_price_no_tax"],
            "purchase_unit_price": data["purchase_unit_price"],
            "cost_no_tax": data["cost_no_tax"],
            "purchase_amount": data["purchase_amount"],
        },
    )
    _upsert_line_record(
        conn,
        "delivery_record",
        order_line_id,
        {
            "delivery_date": data["delivery_date"],
            "delivery_quantity": data["delivery_quantity"],
            "delivery_revenue_no_tax": data["delivery_revenue_no_tax"],
            "delivery_value": data["delivery_value"],
            "delivery_cost_no_tax": data["delivery_cost_no_tax"],
            "delivery_cost": data["delivery_cost"],
            "pending_delivery_quantity": data["pending_delivery_quantity"],
            "pending_delivery_amount_no_tax": data["pending_delivery_amount_no_tax"],
            "pending_delivery_amount": data["pending_delivery_amount"],
        },
    )
    return order_line_id


def _upsert_line_record(conn, table_name: str, order_line_id: int, data: dict[str, object]) -> None:
    exists = conn.execute(
        text(f"SELECT id FROM {table_name} WHERE order_line_id = :order_line_id AND deleted_at IS NULL LIMIT 1"),
        {"order_line_id": order_line_id},
    ).scalar()
    assignments = ", ".join(f"{key} = :{key}" for key in data)
    params = {"order_line_id": order_line_id, **data}
    if exists:
        conn.execute(text(f"UPDATE {table_name} SET {assignments} WHERE id = :id"), {"id": exists, **params})
        return
    columns = ", ".join(["order_line_id", *data.keys()])
    values = ", ".join([":order_line_id", *(f":{key}" for key in data)])
    conn.execute(text(f"INSERT INTO {table_name} ({columns}) VALUES ({values})"), params)
