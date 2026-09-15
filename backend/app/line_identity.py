"""明细唯一性判定的唯一实现。

规则（2026-09-15 确认）：限定在同一**子项目**内，以下五项组合唯一——

    物资／服务名称 ＋ 规格 ＋ 销售单价 ＋ 数量 ＋ 采购厂商

任一项不同即为不同明细；跨子项目、跨订单、跨框架允许五项完全相同。

Excel 导入、单条新增/修改、批量新增/修改、采购汇总与批量采购修改都必须调用这里，
否则某一个入口就能绕过唯一性规则。
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

DUPLICATE_LINE_DETAIL = (
    "相同订单、相同子项目下已存在同名同规格同数量同单价同采购厂商的明细"
    "（数量、单价或采购厂商不同视为不同明细）"
)


def find_duplicate_line(
    conn: Connection,
    sub_project_id: int | None,
    goods_name: object,
    specification_model: object,
    quantity: object,
    sales_unit_price: object,
    supplier_name: object,
    *,
    exclude_order_line_id: int | None = None,
) -> int | None:
    """返回同一子项目内五项完全相同的另一条明细 id；没有则返回 None。"""
    if not sub_project_id:
        return None
    row = conn.execute(
        text(
            """
            SELECT ol.id
            FROM order_line ol
            LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
            WHERE ol.sub_project_id = :sub_project_id
              AND ol.deleted_at IS NULL
              AND (:exclude_order_line_id IS NULL OR ol.id <> :exclude_order_line_id)
              AND TRIM(COALESCE(ol.goods_name, '')) = TRIM(COALESCE(:goods_name, ''))
              AND TRIM(COALESCE(ol.specification_model, '')) = TRIM(COALESCE(:specification_model, ''))
              AND COALESCE(ol.quantity, 0) = COALESCE(:quantity, 0)
              AND COALESCE(ol.sales_unit_price, 0) = COALESCE(:sales_unit_price, 0)
              AND TRIM(COALESCE(pi.supplier_name, '')) = TRIM(COALESCE(:supplier_name, ''))
            LIMIT 1
            """
        ),
        {
            "sub_project_id": sub_project_id,
            "exclude_order_line_id": exclude_order_line_id,
            "goods_name": goods_name,
            "specification_model": specification_model,
            "quantity": quantity,
            "sales_unit_price": sales_unit_price,
            "supplier_name": supplier_name,
        },
    ).scalar()
    return int(row) if row else None


def order_line_identity(conn: Connection, order_line_id: int) -> dict | None:
    """取判重需要的明细侧字段（子项目、物资名称、规格、数量、销售单价）。"""
    row = conn.execute(
        text(
            """
            SELECT sub_project_id, goods_name, specification_model, quantity, sales_unit_price
            FROM order_line
            WHERE id = :order_line_id AND deleted_at IS NULL
            """
        ),
        {"order_line_id": order_line_id},
    ).mappings().first()
    return dict(row) if row else None
