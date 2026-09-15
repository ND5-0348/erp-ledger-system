from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text

from ..audit import write_batch_operation_log, write_operation_log
from ..auth import CurrentUser, apply_department_scope, can_access_department, get_current_user, require_permission
from ..backup import create_backup
from ..db import db
from ..importer import import_excel
from ..ledger_excel import (
    EDITABLE_ORDER_KEYS,
    EXPORT_FILE_NAME,
    TEMPLATE_FILE_NAME,
    content_disposition,
    editor_changed_keys,
    editor_columns,
    editor_payload_snapshot,
    editor_rows_for_order_lines,
    export_ledger_bytes,
    template_bytes,
)
from ..serializers import clean_row, clean_rows
from ..validation import BusinessDate, Money, PreciseNumber, Ratio

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
    sales_tax_rate: Ratio | None = None
    net_unit_price: PreciseNumber | None = None
    unit_price: PreciseNumber | None = None
    net_revenue: Money | None = None
    order_value: Money | None = None
    supplier_name: str | None = None
    purchase_tax_rate: Ratio | None = None
    purchase_unit_price_no_tax: PreciseNumber | None = None
    purchase_unit_price: PreciseNumber | None = None
    cost_no_tax: Money | None = None
    purchase_amount: Money | None = None
    labor_cost: Money | None = None
    other_cost: Money | None = None
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


class BasicOrderFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount_type: str | None = None
    project_code: str | None = Field(default=None, max_length=64)
    department: str | None = None
    branch_company: str | None = None
    account_manager: str | None = None
    order_date: BusinessDate | None = None
    business_type: str | None = None
    statistical_category: str | None = None
    team_name: str | None = None
    customer_unit_name: str | None = None
    user_name: str | None = None
    regional_platform: str | None = None
    order_no: str | None = Field(default=None, max_length=64)
    project_name: str | None = None
    goods_name: str | None = None
    specification_model: str | None = None
    unit_name: str | None = None
    quantity: PreciseNumber | None = None
    sales_tax_rate: Ratio | None = None
    net_unit_price: PreciseNumber | None = None
    unit_price: PreciseNumber | None = None
    net_revenue: Money | None = None
    order_value: Money | None = None


class BasicOrderBatchCreate(BaseModel):
    items: list[BasicOrderFields] = Field(min_length=1, max_length=500)


class BasicOrderBatchUpdateItem(BasicOrderFields):
    order_line_id: int = Field(gt=0)


class BasicOrderBatchUpdate(BaseModel):
    items: list[BasicOrderBatchUpdateItem] = Field(min_length=1, max_length=500)


class OrderLineSelection(BaseModel):
    order_line_ids: list[int] = Field(min_length=1, max_length=500)


EXCEL_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_IMPORT_BYTES = 20 * 1024 * 1024


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
                       sales_tax_rate,
                       sales_unit_price_no_tax AS net_unit_price,
                       sales_unit_price AS unit_price,
                       revenue_no_tax AS net_revenue,
                       order_value,
                       sales_tax_amount,
                       supplier_name,
                       purchase_tax_rate,
                       purchase_unit_price_no_tax,
                       purchase_unit_price,
                       cost_no_tax,
                       purchase_amount,
                       purchase_tax_amount,
                       labor_cost,
                       other_cost,
                       delivery_date,
                       delivery_quantity,
                       delivery_revenue_no_tax,
                       delivery_value,
                       delivery_cost_no_tax,
                       delivery_cost,
                       pending_delivery_quantity,
                       pending_delivery_amount_no_tax,
                       pending_delivery_amount,
                       total_received,
                       total_paid,
                       accounts_receivable,
                       accounts_payable,
                       gross_profit,
                       close_status,
                       last_modified_at
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
                           COALESCE(ol.project_name, p.project_name) AS project_name,
                           finance.total_received,
                           finance.total_paid,
                           finance.accounts_receivable,
                           finance.accounts_payable,
                           finance.gross_profit,
                           finance.close_status,
                           finance.last_modified_at,
                           ol.goods_name,
                           ol.specification_model,
                           ol.unit_name,
                           ol.quantity,
                           ol.sales_tax_rate,
                           ol.sales_unit_price_no_tax,
                           ol.sales_unit_price,
                           ol.revenue_no_tax,
                           ol.order_value,
                           COALESCE(ol.order_value, 0) - COALESCE(ol.revenue_no_tax, 0) AS sales_tax_amount,
                           pi.supplier_name,
                           pi.purchase_tax_rate,
                           pi.purchase_unit_price_no_tax,
                           pi.purchase_unit_price,
                           pi.cost_no_tax,
                           pi.purchase_amount,
                           COALESCE(pi.purchase_amount, 0) - COALESCE(pi.cost_no_tax, 0) AS purchase_tax_amount,
                           pi.labor_cost,
                           pi.other_cost,
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
                    LEFT JOIN v_order_line_finance finance ON finance.order_line_id = ol.id
                    WHERE p.deleted_at IS NULL
                ) order_detail
                WHERE {where_sql}
                ORDER BY order_date DESC, order_no, order_line_id
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


@router.get("/template")
def download_order_template(user: CurrentUser = Depends(get_current_user)) -> Response:
    try:
        content = template_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="服务器中的业务台账模板缺失") from exc
    with db() as conn:
        write_operation_log(conn, user, "订单管理", "download_order_template", "下载业务台账模板")
    return Response(
        content=content,
        media_type=EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": content_disposition(TEMPLATE_FILE_NAME)},
    )


@router.get("/export")
def export_orders(
    project_id: str | None = Query(default=None, max_length=255),
    department: str | None = Query(default=None, max_length=255),
    manager: str | None = Query(default=None, max_length=255),
    client_unit: str | None = Query(default=None, max_length=255),
    order_id: str | None = Query(default=None, max_length=255),
    order_status: str | None = Query(default=None, pattern="^(open|closed)$"),
    supplier_name: str | None = Query(default=None, max_length=255),
    start_date: BusinessDate | None = None,
    end_date: BusinessDate | None = None,
    invoice_start_date: BusinessDate | None = None,
    invoice_end_date: BusinessDate | None = None,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="订单日期的开始日期不能晚于结束日期。")
    if invoice_start_date and invoice_end_date and invoice_start_date > invoice_end_date:
        raise HTTPException(status_code=400, detail="开票日期的开始日期不能晚于结束日期。")
    filters = {
        "project_id": project_id,
        "department": department,
        "manager": manager,
        "client_unit": client_unit,
        "order_id": order_id,
        "order_status": order_status,
        "supplier_name": supplier_name,
        "start_date": start_date,
        "end_date": end_date,
        "invoice_start_date": invoice_start_date,
        "invoice_end_date": invoice_end_date,
    }
    active_filters = {key: value for key, value in filters.items() if value not in (None, "")}
    with db() as conn:
        content = export_ledger_bytes(conn, user, active_filters)
        write_operation_log(
            conn,
            user,
            "订单管理",
            "export_orders",
            "按查询条件导出业务台账" if active_filters else "全量导出当前账号权限范围内的业务台账",
            after={key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in active_filters.items()},
        )
    return Response(
        content=content,
        media_type=EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": content_disposition(EXPORT_FILE_NAME)},
    )


@router.post("/import-excel")
async def import_orders_excel(
    request: Request,
    filename: str = Query("市场部业务台账.xlsx", max_length=255),
    user: CurrentUser = Depends(require_permission("ledger_import")),
) -> dict:
    if Path(filename).suffix.lower() != ".xlsx":
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式的业务台账文件")
    content = await request.body()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="上传文件不能超过 20 MB")

    try:
        with db() as conn:
            create_backup(conn, user, "pre_import")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="导入前自动备份失败，已取消导入") from exc

    try:
        with db() as conn:
            result = import_excel(
                conn,
                reset=False,
                workbook_bytes=content,
                source_file_name=Path(filename).name,
                user=user,
                strict_template=True,
            )
            if result["failed_rows"]:
                message = "；".join(result.get("errors") or [])
                detail = f"导入存在 {result['failed_rows']} 条错误数据，已整批回滚"
                if message:
                    detail = f"{detail}：{message}"
                raise HTTPException(status_code=422, detail=detail)
            return result
    except HTTPException:
        raise
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (ValueError, BadZipFile, InvalidFileException, KeyError) as exc:
        raise HTTPException(status_code=422, detail=f"Excel 导入失败：{exc}") from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="导入数据与现有项目、订单或业务明细重复") from exc


@router.get("/batch-editor/schema")
def get_batch_editor_schema(
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return {
        "editable_through": "W",
        "columns": editor_columns(),
    }


@router.post("/batch-editor/rows")
def get_batch_editor_rows(
    payload: OrderLineSelection,
    user: CurrentUser = Depends(require_permission("order_edit")),
) -> dict:
    unique_ids = list(dict.fromkeys(payload.order_line_ids))
    for order_line_id in unique_ids:
        _ensure_order_line(order_line_id, user, require_entry=True)
    with db() as conn:
        rows = editor_rows_for_order_lines(conn, user, unique_ids)
    if len(rows) != len(unique_ids):
        raise HTTPException(status_code=404, detail="部分订单明细不存在或当前账号无权访问")
    return {
        "editable_through": "W",
        "columns": editor_columns(),
        "rows": rows,
    }


@router.post("/batch-basic")
def create_basic_order_lines_batch(
    payload: BasicOrderBatchCreate,
    user: CurrentUser = Depends(require_permission("order_entry")),
) -> dict:
    order_payloads = [_basic_order_update(item) for item in payload.items]
    for item in order_payloads:
        _validate_create_payload(item, user)
    _validate_batch_create_targets(order_payloads)
    created_ids: list[int] = []
    try:
        with db() as conn:
            for item in order_payloads:
                created_ids.append(_create_order_line(conn, item))
            write_operation_log(
                conn,
                user,
                "订单管理",
                "batch_create_basic_orders",
                f"在线表格批量新增 {len(created_ids)} 条基本信息明细",
                after={"order_line_ids": created_ids, "editable_columns": "A-W"},
            )
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="批量新增包含重复的项目、订单或订单明细") from exc
    return {"created": len(created_ids), "order_line_ids": created_ids}


@router.put("/batch-basic")
def update_basic_order_lines_batch(
    payload: BasicOrderBatchUpdate,
    user: CurrentUser = Depends(require_permission("order_edit")),
) -> dict:
    order_line_ids = [item.order_line_id for item in payload.items]
    if len(set(order_line_ids)) != len(order_line_ids):
        raise HTTPException(status_code=422, detail="批量修改中不能重复提交同一条订单明细")

    prepared: list[tuple[dict, OrderUpdate, dict[str, object], dict[str, object]]] = []
    try:
        with db() as conn:
            for item in payload.items:
                ids = _ensure_order_line_in_conn(conn, item.order_line_id, user, require_entry=True, lock=True)
                order_payload = _basic_order_update(item)
                _validate_create_payload(order_payload, user)
                data = _calculated_payload_data(order_payload)
                current = editor_payload_snapshot(conn, user, item.order_line_id, "basic")
                if editor_changed_keys("basic", current, data):
                    prepared.append((ids, order_payload, data, current))
            _validate_batch_update_targets(conn, prepared)
            audit_entries: list[tuple[dict[str, object], dict[str, object]]] = []
            for ids, _, data, before in prepared:
                _update_basic_order_line_in_conn(
                    conn,
                    int(ids["order_line_id"]),
                    ids,
                    data,
                )
                after = editor_payload_snapshot(conn, user, int(ids["order_line_id"]), "basic")
                audit_entries.append((before, after))
            if audit_entries:
                changed_cell_count = sum(
                    len(editor_changed_keys("basic", before, after))
                    for before, after in audit_entries
                )
                write_batch_operation_log(
                    conn,
                    user,
                    "订单管理",
                    "batch_update_basic_order",
                    f"在线表格批量修改 {len(audit_entries)} 条基本信息，共 {changed_cell_count} 个单元格",
                    entries=audit_entries,
                )
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="批量修改后的项目编号或订单号与现有数据冲突") from exc
    updated_ids = [int(ids["order_line_id"]) for ids, _, _, _ in prepared]
    return {"updated": len(prepared), "order_line_ids": updated_ids}


@router.put("/{order_line_id}")
def update_order_line(
    order_line_id: int,
    payload: OrderUpdate,
    user: CurrentUser = Depends(require_permission("order_edit")),
) -> dict:
    _validate_create_payload(payload, user)
    ids = _ensure_order_line(order_line_id, user, require_entry=True)
    data = _calculated_payload_data(payload)
    project_data = {
        "project_code": data["project_code"],
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
        "project_name": data["project_name"],
        "goods_name": data["goods_name"],
        "specification_model": data["specification_model"],
        "unit_name": data["unit_name"],
        "quantity": data["quantity"],
        "sales_tax_rate": data["sales_tax_rate"],
        "sales_unit_price_no_tax": data["net_unit_price"],
        "sales_unit_price": data["unit_price"],
        "revenue_no_tax": data["net_revenue"],
        "order_value": data["order_value"],
    }
    purchase_data = {
        "supplier_name": data["supplier_name"],
        "purchase_tax_rate": data["purchase_tax_rate"],
        "purchase_unit_price_no_tax": data["purchase_unit_price_no_tax"],
        "purchase_unit_price": data["purchase_unit_price"],
        "cost_no_tax": data["cost_no_tax"],
        "purchase_amount": data["purchase_amount"],
        "labor_cost": data["labor_cost"],
        "other_cost": data["other_cost"],
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
        _validate_batch_update_targets(conn, [(ids, payload, data, {})])
        before = conn.execute(
            text("SELECT * FROM v_order_line_finance WHERE order_line_id = :order_line_id"),
            {"order_line_id": order_line_id},
        ).mappings().first()
        conn.execute(
            text(
                """
                UPDATE project
                SET project_code = :project_code,
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
                SET project_name = :project_name,
                    goods_name = :goods_name,
                    specification_model = :specification_model,
                    unit_name = :unit_name,
                    quantity = :quantity,
                    sales_tax_rate = :sales_tax_rate,
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
        return _ensure_order_line_in_conn(conn, order_line_id, user, require_entry=require_entry)


def _ensure_order_line_in_conn(
    conn,
    order_line_id: int,
    user: CurrentUser,
    *,
    require_entry: bool = False,
    lock: bool = False,
) -> dict:
    lock_clause = " FOR UPDATE" if lock else ""
    row = conn.execute(
        text(
            """
            SELECT ol.id AS order_line_id, ol.sales_order_id, so.project_id, p.department
            FROM order_line ol
            JOIN sales_order so ON so.id = ol.sales_order_id AND so.deleted_at IS NULL
            JOIN project p ON p.id = so.project_id AND p.deleted_at IS NULL
            WHERE ol.id = :order_line_id AND ol.deleted_at IS NULL
            """ + lock_clause
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


def _basic_order_update(payload: BasicOrderFields) -> OrderUpdate:
    data = _payload_dict(payload)
    data.pop("order_line_id", None)
    if set(data) != set(EDITABLE_ORDER_KEYS):
        raise HTTPException(status_code=422, detail="基本信息在线表格字段与 A-W 列映射不一致")
    return OrderUpdate(**data)


def _validate_create_payload(payload: OrderUpdate, user: CurrentUser) -> None:
    data = _calculated_payload_data(payload)
    required = {
        "project_code": data["project_code"],
        "order_no": data["order_no"],
        "goods_name": data["goods_name"],
        "customer_unit_name": data["customer_unit_name"],
    }
    missing = [name for name, value in required.items() if not str(value or "").strip()]
    if data["order_value"] is None:
        missing.append("order_value")
    if missing:
        raise HTTPException(status_code=422, detail=f"缺少必填字段: {', '.join(missing)}")
    if not can_access_department(user, payload.department, require_entry=True):
        raise HTTPException(status_code=403, detail="Department permission denied")


def _identity_number(value: object) -> Decimal:
    """数量与单价参与明细判重：空值与 0 视为相同，精度不同（740 与 740.000000）不影响比较。"""
    amount = _as_decimal(value)
    return Decimal("0") if amount is None else _price(amount)


def _validate_batch_update_targets(
    conn,
    prepared: list[tuple[dict, OrderUpdate, dict[str, object], dict[str, object]]],
) -> None:
    project_targets: dict[int, tuple[object, ...]] = {}
    order_targets: dict[int, tuple[object, ...]] = {}
    line_targets: dict[int, tuple[str, str, str, Decimal, Decimal, str]] = {}
    order_ids: set[int] = set()

    for ids, _, data, _ in prepared:
        project_id = int(ids["project_id"])
        sales_order_id = int(ids["sales_order_id"])
        order_line_id = int(ids["order_line_id"])
        project_target = tuple(
            data[key]
            for key in (
                "project_code", "department", "branch_company", "account_manager", "team_name",
                "customer_unit_name", "user_name", "regional_platform",
            )
        )
        order_target = tuple(
            data[key]
            for key in ("amount_type", "order_no", "order_date", "business_type", "statistical_category")
        )
        if project_id in project_targets and project_targets[project_id] != project_target:
            raise HTTPException(status_code=422, detail="同一项目的项目级字段必须保持一致，请统一修改后再提交")
        if sales_order_id in order_targets and order_targets[sales_order_id] != order_target:
            raise HTTPException(status_code=422, detail="同一销售订单的订单级字段必须保持一致，请统一修改后再提交")
        project_targets[project_id] = project_target
        order_targets[sales_order_id] = order_target
        line_targets[order_line_id] = (
            str(data["project_name"] or "").strip(),
            str(data["goods_name"] or "").strip(),
            str(data["specification_model"] or "").strip(),
            _identity_number(data["quantity"]),
            _identity_number(data["unit_price"]),
            str(data["supplier_name"] or "").strip(),
        )
        order_ids.add(sales_order_id)

    for sales_order_id in order_ids:
        existing_lines = conn.execute(
            text(
                """
                SELECT ol.id, ol.project_name, ol.goods_name, ol.specification_model,
                       ol.quantity, ol.sales_unit_price, pi.supplier_name
                FROM order_line ol
                LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
                WHERE ol.sales_order_id = :sales_order_id AND ol.deleted_at IS NULL
                """
            ),
            {"sales_order_id": sales_order_id},
        ).mappings().all()
        seen: set[tuple[str, str, str, Decimal, Decimal, str]] = set()
        for row in existing_lines:
            identity = line_targets.get(
                int(row["id"]),
                (
                    str(row["project_name"] or "").strip(),
                    str(row["goods_name"] or "").strip(),
                    str(row["specification_model"] or "").strip(),
                    _identity_number(row["quantity"]),
                    _identity_number(row["sales_unit_price"]),
                    str(row["supplier_name"] or "").strip(),
                ),
            )
            if identity in seen:
                raise HTTPException(
                    status_code=409,
                    detail="同一销售订单、相同项目名称下不能存在同名同规格同数量同单价同采购厂商的重复明细"
                    "（数量、单价或采购厂商不同视为不同明细）",
                )
            seen.add(identity)


def _validate_batch_create_targets(order_payloads: list[OrderUpdate]) -> None:
    project_targets: dict[str, tuple[object, ...]] = {}
    order_targets: dict[tuple[str, str], tuple[object, ...]] = {}
    line_targets: set[tuple[str, str, str, str, str, Decimal, Decimal, str]] = set()

    for payload in order_payloads:
        data = _calculated_payload_data(payload)
        project_code = str(data["project_code"] or "").strip()
        order_no = str(data["order_no"] or "").strip()
        project_target = tuple(
            data[key]
            for key in (
                "department", "branch_company", "account_manager", "team_name",
                "customer_unit_name", "user_name", "regional_platform",
            )
        )
        order_target = tuple(
            data[key]
            for key in ("amount_type", "order_date", "business_type", "statistical_category")
        )
        order_identity = (project_code, order_no)
        line_identity = (
            project_code,
            order_no,
            str(data["project_name"] or "").strip(),
            str(data["goods_name"] or "").strip(),
            str(data["specification_model"] or "").strip(),
            _identity_number(data["quantity"]),
            _identity_number(data["unit_price"]),
            str(data["supplier_name"] or "").strip(),
        )

        if project_code in project_targets and project_targets[project_code] != project_target:
            raise HTTPException(status_code=422, detail="同一项目的项目级字段必须保持一致，请统一修改后再提交")
        if order_identity in order_targets and order_targets[order_identity] != order_target:
            raise HTTPException(status_code=422, detail="同一销售订单的订单级字段必须保持一致，请统一修改后再提交")
        if line_identity in line_targets:
            raise HTTPException(
                status_code=409,
                detail="同一销售订单、相同项目名称下不能存在同名同规格同数量同单价同采购厂商的重复明细"
                "（数量、单价或采购厂商不同视为不同明细）",
            )

        project_targets[project_code] = project_target
        order_targets[order_identity] = order_target
        line_targets.add(line_identity)


def _update_basic_order_line_in_conn(
    conn,
    order_line_id: int,
    ids: dict,
    data: dict[str, object],
) -> None:
    conn.execute(
        text(
            """
            UPDATE project
            SET project_code = :project_code,
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
        {
            "project_id": ids["project_id"],
            "project_code": data["project_code"],
            "department": data["department"],
            "branch_company": data["branch_company"],
            "account_manager": data["account_manager"],
            "team_level3_name": data["team_name"],
            "customer_unit_name": data["customer_unit_name"],
            "end_user_name": data["user_name"],
            "regional_platform": data["regional_platform"],
        },
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
        {
            "sales_order_id": ids["sales_order_id"],
            "gross_net_type": data["amount_type"],
            "order_no": data["order_no"],
            "order_date": data["order_date"],
            "business_type": data["business_type"],
            "statistic_category": data["statistical_category"],
        },
    )
    conn.execute(
        text(
            """
            UPDATE order_line
            SET project_name = :project_name,
                goods_name = :goods_name,
                specification_model = :specification_model,
                unit_name = :unit_name,
                quantity = :quantity,
                sales_tax_rate = :sales_tax_rate,
                sales_unit_price_no_tax = :sales_unit_price_no_tax,
                sales_unit_price = :sales_unit_price,
                revenue_no_tax = :revenue_no_tax,
                order_value = :order_value
            WHERE id = :order_line_id
            """
        ),
        {
            "order_line_id": order_line_id,
            "project_name": data["project_name"],
            "goods_name": data["goods_name"],
            "specification_model": data["specification_model"],
            "unit_name": data["unit_name"],
            "quantity": data["quantity"],
            "sales_tax_rate": data["sales_tax_rate"],
            "sales_unit_price_no_tax": data["net_unit_price"],
            "sales_unit_price": data["unit_price"],
            "revenue_no_tax": data["net_revenue"],
            "order_value": data["order_value"],
        },
    )
def _create_order_line(conn, payload: OrderUpdate) -> int:
    data = _calculated_payload_data(payload)
    project = conn.execute(
        text("SELECT id FROM project WHERE project_code = :project_code LIMIT 1"),
        {"project_code": data["project_code"]},
    ).mappings().first()
    project_values = {
        "project_code": data["project_code"],
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
        project_values["project_name"] = data["project_name"]
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
            SELECT ol.id FROM order_line ol
            LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
            WHERE ol.sales_order_id = :sales_order_id AND ol.deleted_at IS NULL
              AND TRIM(COALESCE(ol.project_name, '')) = TRIM(COALESCE(:project_name, ''))
              AND TRIM(COALESCE(ol.goods_name, '')) = TRIM(COALESCE(:goods_name, ''))
              AND TRIM(COALESCE(ol.specification_model, '')) = TRIM(COALESCE(:specification_model, ''))
              AND COALESCE(ol.quantity, 0) = COALESCE(:quantity, 0)
              AND COALESCE(ol.sales_unit_price, 0) = COALESCE(:sales_unit_price, 0)
              AND TRIM(COALESCE(pi.supplier_name, '')) = TRIM(COALESCE(:supplier_name, ''))
            LIMIT 1
            """
        ),
        {
            "sales_order_id": sales_order_id,
            "goods_name": data["goods_name"],
            "project_name": data["project_name"],
            "specification_model": data["specification_model"],
            "quantity": _as_decimal(data["quantity"]),
            "sales_unit_price": _as_decimal(data["unit_price"]),
            "supplier_name": data["supplier_name"],
        },
    ).scalar()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="相同订单、相同项目名称下已存在同名同规格同数量同单价同采购厂商的明细"
            "（数量、单价或采购厂商不同视为不同明细）",
        )

    result = conn.execute(
        text(
            """
            INSERT INTO order_line
              (sales_order_id, project_name, goods_name, specification_model, unit_name, quantity,
               sales_tax_rate, sales_unit_price_no_tax, sales_unit_price, revenue_no_tax, order_value)
            VALUES
              (:sales_order_id, :project_name, :goods_name, :specification_model, :unit_name, :quantity,
               :sales_tax_rate, :net_unit_price, :unit_price, :net_revenue, :order_value)
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
            "purchase_tax_rate": data["purchase_tax_rate"],
            "purchase_unit_price_no_tax": data["purchase_unit_price_no_tax"],
            "purchase_unit_price": data["purchase_unit_price"],
            "cost_no_tax": data["cost_no_tax"],
            "purchase_amount": data["purchase_amount"],
            "labor_cost": data["labor_cost"],
            "other_cost": data["other_cost"],
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


def _calculated_payload_data(payload: OrderUpdate) -> dict[str, object]:
    data = _payload_dict(payload)
    quantity = _as_decimal(data["quantity"])

    sales_rate = _as_decimal(data["sales_tax_rate"])
    sales_unit_price_no_tax = _as_decimal(data["net_unit_price"])
    sales_unit_price = _as_decimal(data["unit_price"])
    if sales_rate is not None:
        if sales_unit_price_no_tax is not None:
            sales_unit_price = _price(sales_unit_price_no_tax * (Decimal("1") + sales_rate / Decimal("100")))
            data["unit_price"] = sales_unit_price
        if quantity is not None and sales_unit_price_no_tax is not None:
            data["net_revenue"] = _money(quantity * sales_unit_price_no_tax)
        if quantity is not None and sales_unit_price is not None:
            data["order_value"] = _money(quantity * sales_unit_price)

    purchase_rate = _as_decimal(data["purchase_tax_rate"])
    purchase_unit_price_no_tax = _as_decimal(data["purchase_unit_price_no_tax"])
    purchase_unit_price = _as_decimal(data["purchase_unit_price"])
    if purchase_rate is not None:
        if purchase_unit_price_no_tax is not None:
            purchase_unit_price = _price(purchase_unit_price_no_tax * (Decimal("1") + purchase_rate / Decimal("100")))
            data["purchase_unit_price"] = purchase_unit_price
        if quantity is not None and purchase_unit_price_no_tax is not None:
            data["cost_no_tax"] = _money(quantity * purchase_unit_price_no_tax)
        if quantity is not None and purchase_unit_price is not None:
            data["purchase_amount"] = _money(quantity * purchase_unit_price)

    delivery_quantity = _as_decimal(data["delivery_quantity"])
    if quantity is not None and delivery_quantity is not None:
        if delivery_quantity > quantity:
            raise HTTPException(status_code=422, detail="交付数量不能超过订单数量，数据有错误，请检查后重新提交。")
        data["pending_delivery_quantity"] = quantity - delivery_quantity
        if sales_rate is not None and sales_unit_price_no_tax is not None:
            data["delivery_revenue_no_tax"] = _money(delivery_quantity * sales_unit_price_no_tax)
            data["pending_delivery_amount_no_tax"] = _money((quantity - delivery_quantity) * sales_unit_price_no_tax)
        if sales_rate is not None and sales_unit_price is not None:
            data["delivery_value"] = _money(delivery_quantity * sales_unit_price)
            data["pending_delivery_amount"] = _money((quantity - delivery_quantity) * sales_unit_price)
        if purchase_rate is not None and purchase_unit_price_no_tax is not None:
            data["delivery_cost_no_tax"] = _money(delivery_quantity * purchase_unit_price_no_tax)
        if purchase_rate is not None and purchase_unit_price is not None:
            data["delivery_cost"] = _money(delivery_quantity * purchase_unit_price)
    return data


def _as_decimal(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _price(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


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
