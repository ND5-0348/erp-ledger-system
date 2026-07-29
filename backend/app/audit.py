from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .auth import CurrentUser


MUTATION_MODULES = {
    "/api/orders": "订单管理",
    "/api/purchases": "采购管理",
    "/api/sales": "销售管理",
    "/api/auth/users": "账号管理",
    "/api/backups": "系统维护",
    "/api/import": "订单管理",
}


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


def _actor_name(user: CurrentUser) -> str:
    return f"{user.display_name}（账号：{user.username}）"


def _order_context(conn: Connection, before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> dict[str, Any]:
    source = after or before or {}
    context = {
        key: source.get(key)
        for key in ("project_code", "order_no", "goods_name", "specification_model")
        if source.get(key) not in (None, "")
    }
    order_line_id = source.get("order_line_id")
    if not order_line_id:
        return context
    row = conn.execute(
        text(
            """
            SELECT p.project_code, so.order_no, ol.goods_name, ol.specification_model
            FROM order_line ol
            JOIN sales_order so ON so.id = ol.sales_order_id
            JOIN project p ON p.id = so.project_id
            WHERE ol.id = :order_line_id
            """
        ),
        {"order_line_id": order_line_id},
    ).mappings().first()
    database_context = _snapshot(row) or {}
    database_context.update(context)
    return database_context


def _merge_context(snapshot: dict[str, Any] | None, context: Mapping[str, Any]) -> dict[str, Any] | None:
    if snapshot is None:
        return None
    for key, value in context.items():
        snapshot.setdefault(key, value)
    return snapshot


def _context_text(context: Mapping[str, Any]) -> str:
    parts: list[str] = []
    if context.get("project_code"):
        parts.append(f"项目“{context['project_code']}”")
    if context.get("order_no"):
        parts.append(f"订单“{context['order_no']}”")
    if context.get("goods_name"):
        goods = str(context["goods_name"])
        if context.get("specification_model"):
            goods = f"{goods}（{context['specification_model']}）"
        parts.append(f"货物/服务“{goods}”")
    return "、".join(parts)


def failed_mutation_metadata(method: str, path: str) -> tuple[str, str, str] | None:
    if method.upper() not in {"POST", "PUT", "PATCH", "DELETE"} or path == "/api/auth/login":
        return None
    module = next((label for prefix, label in MUTATION_MODULES.items() if path.startswith(prefix)), None)
    if module is None:
        return None
    if "import" in path:
        action_name, action_label = "import_excel", "导入业务台账"
    elif "restore" in path:
        action_name, action_label = "restore_backup", "恢复数据备份"
    elif path.startswith("/api/backups"):
        action_name, action_label = "create_backup", "创建数据备份"
    elif method.upper() == "POST":
        action_name, action_label = "create_failed", "新增数据"
    elif method.upper() in {"PUT", "PATCH"}:
        action_name, action_label = "update_failed", "修改数据"
    else:
        action_name, action_label = "delete_failed", "删除数据"
    return module, action_name, action_label


def failure_reason(status_code: int) -> str:
    return {
        400: "提交内容不符合要求",
        403: "当前账号没有操作权限",
        404: "目标记录不存在",
        409: "数据重复或发生冲突",
        413: "上传文件超过大小限制",
        422: "字段校验未通过",
    }.get(status_code, "服务器处理失败" if status_code >= 500 else f"操作未完成（状态码 {status_code}）")


def write_operation_log(
    conn: Connection,
    user: CurrentUser,
    module_name: str,
    action_name: str,
    detail: str,
    *,
    before: Mapping[str, Any] | None = None,
    after: Mapping[str, Any] | None = None,
    status: str = "success",
) -> None:
    before_snapshot = _snapshot(before)
    after_snapshot = _snapshot(after)
    context = _order_context(conn, before_snapshot, after_snapshot)
    before_snapshot = _merge_context(before_snapshot, context)
    after_snapshot = _merge_context(after_snapshot, context)
    context_label = _context_text(context)
    summary = detail
    if context_label and context_label not in summary:
        summary = f"{summary}（{context_label}）"
    audit_detail = {
        "summary": summary,
        "before": before_snapshot,
        "after": after_snapshot,
    }
    _insert_operation_log(conn, user, module_name, action_name, audit_detail, status)


def write_batch_operation_log(
    conn: Connection,
    user: CurrentUser,
    module_name: str,
    action_name: str,
    detail: str,
    *,
    entries: list[tuple[Mapping[str, Any], Mapping[str, Any]]],
    status: str = "success",
) -> None:
    batch_entries: list[dict[str, Any]] = []
    for before, after in entries:
        before_snapshot = _snapshot(before)
        after_snapshot = _snapshot(after)
        context = _order_context(conn, before_snapshot, after_snapshot)
        batch_entries.append(
            {
                "before": _merge_context(before_snapshot, context),
                "after": _merge_context(after_snapshot, context),
            }
        )
    audit_detail = {
        "summary": detail,
        "before": None,
        "after": None,
        "batch_entries": batch_entries,
    }
    _insert_operation_log(conn, user, module_name, action_name, audit_detail, status)


def _insert_operation_log(
    conn: Connection,
    user: CurrentUser,
    module_name: str,
    action_name: str,
    audit_detail: Mapping[str, Any],
    status: str,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO operation_log
              (user_id, user_name, module_name, action_name, detail, status)
            VALUES
              (:user_id, :user_name, :module_name, :action_name, :detail, :status)
            """
        ),
        {
            "user_id": user.id,
            "user_name": _actor_name(user),
            "module_name": module_name,
            "action_name": action_name,
            "detail": json.dumps(audit_detail, ensure_ascii=False),
            "status": status,
        },
    )
