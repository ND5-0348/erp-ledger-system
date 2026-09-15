"""旧台账预检会话服务（H3）。

流程：

1. `create_session` 上传并逐行解析，结果落库（原始值与解析结果分开存），
   **不写任何业务表**；有阻断问题时照样建会话，让用户看到问题清单。
2. `list_session_rows` 分页读取，避免一次返回两万条。
3. `apply_resolutions` 接收结构化的逐项修正（不是让用户重新拼斜杠字符串），
   重新执行全部校验。
4. `commit_session` 在写锁内复核权限、文件摘要与阻断状态，再一次事务写入。

会话默认 24 小时有效、随机不可猜 ID；原始文件不落盘，只保存摘要与解析结果。
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .ledger_history import register_manager_history, register_order_numbers
from .legacy_ledger_parser import (
    AMOUNT_SPLIT_REQUIRED,
    Issue,
    build_phases,
    merge_manager_history,
    merge_order_number_history,
    parse_amount_sequence,
    parse_document_sequence,
    parse_name_sequence,
)

PARSER_VERSION = "legacy-parser-1"
SESSION_TTL_HOURS = 24
MAX_PREVIEW_ROWS = 20000

# 财务列组：名称 → (日期列, 金额列, 票据列)，列号为 91 列标准模板的绝对列号。
# 期次按“模板列组顺序、组内位置顺序”展开。
FINANCE_GROUPS: tuple[tuple[str, int, int, int | None], ...] = (
    ("sales_invoice", 74, 76, 73),
    ("sales_receipt", 79, 81, 80),
    ("purchase_payment", 55, 57, 56),
    ("purchase_invoice", 44, 46, 45),
    ("finance_invoice_check", 50, 52, 51),
    ("warehouse_entry", 47, 49, 48),
)

FINANCE_LABELS = {
    "sales_invoice": "销售开票",
    "sales_receipt": "销售回款",
    "purchase_payment": "采购付款",
    "purchase_invoice": "采购收票",
    "finance_invoice_check": "采购入账",
    "warehouse_entry": "采购入库",
}

ORDER_NO_COLUMN = 13
MANAGER_COLUMN = 5
PROJECT_CODE_COLUMN = 2
PROJECT_NAME_COLUMN = 14
GOODS_COLUMN = 15


def _cell(row: tuple[Any, ...], column: int) -> Any:
    index = column - 1
    return row[index] if 0 <= index < len(row) else None


def _text(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value).strip() or None


def _issue_payload(issue: Issue) -> dict[str, Any]:
    return {
        "code": issue.code,
        "message": issue.message,
        "blocking": issue.blocking,
        "sheet": issue.sheet,
        "row": issue.row,
        "columns": list(issue.columns),
    }


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _restore_value(value: Any) -> Any:
    """把会话里存的 ISO 字符串还原成日期对象，再写回规范化工件。

    原始行中的日期在 JSON 里被序列化成字符串；如果直接写回 Excel，
    importer 的日期解析会拒绝带 T 的 ISO 形式。
    """
    if isinstance(value, str) and len(value) >= 10:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    return value


def parse_row(
    row: tuple[Any, ...],
    *,
    excel_row_no: int,
    sheet_name: str,
) -> dict[str, Any]:
    """解析一行：订单号别名链、负责人交接链、各组财务期次，以及全部问题。"""
    issues: list[Issue] = []

    order_cell = _cell(row, ORDER_NO_COLUMN)
    order_parse = merge_order_number_history([order_cell], order_key=_text(order_cell) or "")
    issues.extend(issue.with_location(sheet=sheet_name, row=excel_row_no) for issue in order_parse.issues)

    manager_cell = _cell(row, MANAGER_COLUMN)
    manager_parse = merge_manager_history([manager_cell], project_code=_text(_cell(row, PROJECT_CODE_COLUMN)) or "")
    issues.extend(issue.with_location(sheet=sheet_name, row=excel_row_no) for issue in manager_parse.issues)

    finance: dict[str, Any] = {}
    for name, date_column, amount_column, document_column in FINANCE_GROUPS:
        date_cell = _cell(row, date_column)
        amount_cell = _cell(row, amount_column)
        document_cell = _cell(row, document_column) if document_column else None
        if date_cell in (None, "") and amount_cell in (None, "") and document_cell in (None, ""):
            continue
        phases, group_issues = build_phases(
            date_cell=date_cell,
            amount_cell=amount_cell,
            document_cell=document_cell,
            columns=(FINANCE_LABELS[name],),
            sheet=sheet_name,
            row=excel_row_no,
        )
        issues.extend(group_issues)
        finance[name] = {
            "label": FINANCE_LABELS[name],
            "date_raw": _text(date_cell),
            "amount_raw": _text(amount_cell),
            "document_raw": _text(document_cell),
            "phases": [
                {
                    "position": phase.source_position,
                    "date": phase.date.isoformat() if phase.date else None,
                    "amount": format(phase.amount, "f") if phase.amount is not None else None,
                    "document_no": phase.document_no,
                }
                for phase in phases
            ],
        }

    # 标准模板的第二组（付款 58–60 / 回款 83–86）也按同一规则展开
    for name, date_column, amount_column, document_column in (
        ("purchase_payment", 58, 60, 59),
        ("sales_receipt", 83, 85, 84),
    ):
        date_cell = _cell(row, date_column)
        amount_cell = _cell(row, amount_column)
        document_cell = _cell(row, document_column)
        if date_cell in (None, "") and amount_cell in (None, "") and document_cell in (None, ""):
            continue
        phases, group_issues = build_phases(
            date_cell=date_cell,
            amount_cell=amount_cell,
            document_cell=document_cell,
            columns=(FINANCE_LABELS[name],),
            sheet=sheet_name,
            row=excel_row_no,
        )
        issues.extend(group_issues)
        entry = finance.setdefault(
            name,
            {
                "label": FINANCE_LABELS[name],
                "date_raw": None,
                "amount_raw": None,
                "document_raw": None,
                "phases": [],
            },
        )
        entry["phases"].extend(
            {
                "position": len(entry["phases"]) + index + 1,
                "date": phase.date.isoformat() if phase.date else None,
                "amount": format(phase.amount, "f") if phase.amount is not None else None,
                "document_no": phase.document_no,
            }
            for index, phase in enumerate(phases)
        )

    return {
        "excel_row_no": excel_row_no,
        "project_code": _text(_cell(row, PROJECT_CODE_COLUMN)),
        "order_no": {
            "raw": _text(order_cell),
            "current": order_parse.values[-1] if order_parse.values else None,
            "history": [_jsonable(item) for item in order_parse.values],
        },
        "manager": {
            "raw": _text(manager_cell),
            "current": manager_parse.current,
            "history": manager_parse.history,
        },
        "project_name": _text(_cell(row, PROJECT_NAME_COLUMN)),
        "goods_name": _text(_cell(row, GOODS_COLUMN)),
        "finance": finance,
        "issues": [_issue_payload(issue) for issue in issues],
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    blocking = sum(
        1 for row in rows if any(issue["blocking"] for issue in row["issues"])
    )
    warning = sum(
        1 for row in rows if any(not issue["blocking"] for issue in row["issues"])
    )
    multi_value = sum(
        1
        for row in rows
        if len(row["order_no"]["history"] or []) > 1 or len(row["manager"]["history"] or []) > 1
    )
    return {
        "total_rows": len(rows),
        "blocking_rows": blocking,
        "warning_rows": warning,
        "multi_value_rows": multi_value,
        "comparable": blocking == 0,
    }


def create_session(
    conn: Connection,
    *,
    user_id: int,
    file_name: str,
    content: bytes,
    sheet_index: int = 0,
    header_row: int = 2,
    data_start_row: int = 3,
) -> dict[str, Any]:
    """解析整份文件并落库为预检会话；**不写任何业务表**。"""
    digest = hashlib.sha256(content).hexdigest()
    workbook = load_workbook(_BytesReader(content), read_only=True, data_only=True)
    if len(workbook.worksheets) <= sheet_index:
        raise HTTPException(status_code=422, detail="Excel 中缺少业务工作表")
    worksheet = workbook.worksheets[sheet_index]
    sheet_name = worksheet.title
    parsed_rows: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    for index, row in enumerate(
        worksheet.iter_rows(min_row=data_start_row, values_only=True), start=data_start_row
    ):
        values = tuple(row)
        if not any(value not in (None, "") for value in values):
            continue  # 空行不进会话
        parsed_rows.append((values, parse_row(values, excel_row_no=index, sheet_name=sheet_name)))
    workbook.close()
    rows = [parsed for _, parsed in parsed_rows]
    if len(rows) > MAX_PREVIEW_ROWS:
        raise HTTPException(status_code=413, detail=f"预检单次最多 {MAX_PREVIEW_ROWS} 行，请拆分文件")

    summary = summarize(rows)
    session_id = secrets.token_urlsafe(24)
    expires_at = datetime.now() + timedelta(hours=SESSION_TTL_HOURS)
    conn.execute(
        text(
            """
            INSERT INTO legacy_import_session
              (id, created_by, expires_at, mode, source_file_name, source_sha256,
               parser_version, status, summary_json)
            VALUES
              (:id, :created_by, :expires_at, 'legacy_multi_value', :file_name, :sha256,
               :parser_version, 'pending', CAST(:summary AS JSON))
            """
        ),
        {
            "id": session_id,
            "created_by": user_id,
            "expires_at": expires_at,
            "file_name": file_name,
            "sha256": digest,
            "parser_version": PARSER_VERSION,
            "summary": json.dumps(summary, ensure_ascii=False),
        },
    )
    for values, row in parsed_rows:
        conn.execute(
            text(
                """
                INSERT INTO legacy_import_source
                  (session_id, sheet_name, excel_row_no, raw_json, parsed_json)
                VALUES
                  (:session_id, :sheet_name, :excel_row_no, CAST(:raw AS JSON), CAST(:parsed AS JSON))
                """
            ),
            {
                "session_id": session_id,
                "sheet_name": sheet_name,
                "excel_row_no": row["excel_row_no"],
                # 原始行用于提交时重建工作簿；只存库，不进日志、不进 Git。
                "raw": json.dumps(
                    {"values": [_jsonable(value) for value in values]}, ensure_ascii=False
                ),
                "parsed": json.dumps(row, ensure_ascii=False, default=_jsonable),
            },
        )
    return {
        "session_id": session_id,
        "source_sha256": digest,
        "expires_at": expires_at.isoformat(),
        "parser_version": PARSER_VERSION,
        "summary": summary,
    }


def load_session(conn: Connection, session_id: str, *, user_id: int, is_admin: bool = False) -> dict[str, Any]:
    row = conn.execute(
        text(
            """
            SELECT id, created_by, created_at, expires_at, status, source_file_name,
                   source_sha256, parser_version, summary_json, result_json
            FROM legacy_import_session WHERE id = :id
            """
        ),
        {"id": session_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="预检会话不存在")
    if int(row["created_by"]) != user_id and not is_admin:
        raise HTTPException(status_code=403, detail="无权访问他人的预检会话")
    if row["status"] == "pending" and row["expires_at"] and row["expires_at"] < datetime.now():
        conn.execute(
            text("UPDATE legacy_import_session SET status = 'expired' WHERE id = :id"),
            {"id": session_id},
        )
        row = {**dict(row), "status": "expired"}
    return dict(row)


def list_rows(conn: Connection, session_id: str, *, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    total = conn.execute(
        text("SELECT COUNT(*) FROM legacy_import_source WHERE session_id = :id"),
        {"id": session_id},
    ).scalar()
    rows = conn.execute(
        text(
            """
            SELECT excel_row_no, parsed_json, resolution_json, resolved_at
            FROM legacy_import_source
            WHERE session_id = :id
            ORDER BY excel_row_no
            LIMIT :limit OFFSET :offset
            """
        ),
        {"id": session_id, "limit": limit, "offset": offset},
    ).mappings().all()
    items = []
    for row in rows:
        parsed = row["parsed_json"]
        parsed = json.loads(parsed) if isinstance(parsed, str) else parsed
        resolution = row["resolution_json"]
        resolution = json.loads(resolution) if isinstance(resolution, str) else resolution
        items.append(
            {
                "excel_row_no": int(row["excel_row_no"]),
                "parsed": parsed,
                "resolution": resolution,
                "resolved_at": row["resolved_at"].isoformat() if row["resolved_at"] else None,
            }
        )
    return {"total": int(total or 0), "items": items}


def apply_resolutions(
    conn: Connection,
    session_id: str,
    *,
    user_id: int,
    resolutions: list[dict[str, Any]],
) -> dict[str, Any]:
    """写入逐项人工确认，并对相关行重新执行全部校验。"""
    session = load_session(conn, session_id, user_id=user_id)
    if session["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"会话状态为 {session['status']}，不能修改")

    updated = 0
    for item in resolutions:
        excel_row_no = int(item.get("excel_row_no") or 0)
        if not excel_row_no:
            continue
        exists = conn.execute(
            text(
                "SELECT id FROM legacy_import_source WHERE session_id = :id AND excel_row_no = :row"
            ),
            {"id": session_id, "row": excel_row_no},
        ).scalar()
        if not exists:
            raise HTTPException(status_code=404, detail=f"会话中没有第 {excel_row_no} 行")
        conn.execute(
            text(
                """
                UPDATE legacy_import_source
                SET resolution_json = CAST(:resolution AS JSON),
                    resolved_by = :user_id,
                    resolved_at = CURRENT_TIMESTAMP
                WHERE session_id = :id AND excel_row_no = :row
                """
            ),
            {
                "resolution": json.dumps(item.get("resolution") or {}, ensure_ascii=False),
                "user_id": user_id,
                "id": session_id,
                "row": excel_row_no,
            },
        )
        updated += 1

    summary = recompute_summary(conn, session_id)
    conn.execute(
        text(
            "UPDATE legacy_import_session SET summary_json = CAST(:summary AS JSON) WHERE id = :id"
        ),
        {"summary": json.dumps(summary, ensure_ascii=False), "id": session_id},
    )
    return {"updated": updated, "summary": summary}


def recompute_summary(conn: Connection, session_id: str) -> dict[str, Any]:
    """按“解析结果 + 人工确认”重算阻断情况。"""
    rows = conn.execute(
        text("SELECT parsed_json, resolution_json FROM legacy_import_source WHERE session_id = :id"),
        {"id": session_id},
    ).mappings().all()
    blocking = 0
    resolved = 0
    for row in rows:
        parsed = json.loads(row["parsed_json"]) if isinstance(row["parsed_json"], str) else row["parsed_json"]
        resolution = (
            json.loads(row["resolution_json"])
            if isinstance(row["resolution_json"], str)
            else row["resolution_json"]
        )
        blocking_codes = {
            issue["code"] for issue in parsed.get("issues", []) if issue.get("blocking")
        }
        if resolution:
            resolved += 1
            # 人工确认过的错误码视为已处理
            for key in ("acknowledged_codes", "acknowledged", "codes"):
                for code in resolution.get(key, []) if isinstance(resolution.get(key), list) else []:
                    blocking_codes.discard(code)
        if blocking_codes:
            blocking += 1
    return {
        "total_rows": len(rows),
        "blocking_rows": blocking,
        "resolved_rows": resolved,
        "comparable": blocking == 0,
    }


def finish_session(conn: Connection, session_id: str, *, result: dict[str, Any]) -> None:
    conn.execute(
        text(
            """
            UPDATE legacy_import_session
            SET status = 'committed', committed_at = CURRENT_TIMESTAMP, result_json = CAST(:result AS JSON)
            WHERE id = :id
            """
        ),
        {"result": json.dumps(result, ensure_ascii=False, default=_jsonable), "id": session_id},
    )


def check_commit_ready(conn: Connection, session: dict[str, Any], *, content: bytes) -> dict[str, Any]:
    """提交前复核：状态、文件摘要、阻断问题。"""
    if session["status"] == "committed":
        stored = session.get("result_json")
        return {"already_committed": True, "result": json.loads(stored) if isinstance(stored, str) else stored}
    if session["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"会话状态为 {session['status']}，不能提交")

    digest = hashlib.sha256(content).hexdigest()
    if digest != session["source_sha256"]:
        raise HTTPException(
            status_code=409,
            detail="上传的文件与预检时的文件不一致（内容已改变），请重新预检",
        )

    summary = recompute_summary(conn, session["id"])
    if not summary["comparable"]:
        raise HTTPException(
            status_code=422,
            detail=f"仍有 {summary['blocking_rows']} 行存在阻断问题，请先处理后再提交",
        )
    return {"already_committed": False, "summary": summary}


def commit_session(
    conn: Connection,
    *,
    session_id: str,
    user: Any,
    content: bytes,
    is_admin: bool = False,
) -> dict[str, Any]:
    """提交已通过预检的会话：写锁内复核 → 规范化 → 复用导入服务写入 → 追加期次与历史。

    重复提交同一会话只返回原结果，不会新增业务记录。
    """
    from .importer import import_excel  # 延迟导入，避免模块级循环依赖

    session = load_session(conn, session_id, user_id=user.id, is_admin=is_admin)
    ready = check_commit_ready(conn, session, content=content)
    if ready.get("already_committed"):
        return {"already_committed": True, **(ready.get("result") or {})}

    rows = load_all_rows(conn, session_id)
    workbook_bytes = build_normalized_workbook(rows)
    line_ids: dict[int, int] = {}
    result = import_excel(
        conn,
        reset=False,
        workbook_bytes=workbook_bytes,
        source_file_name=session["source_file_name"],
        user=user,
        strict_template=True,
        line_id_map=line_ids,
    )
    if result["failed_rows"]:
        raise HTTPException(
            status_code=422,
            detail=f"提交失败，已整批回滚：{'；'.join(result.get('errors') or [])}",
        )

    phases = append_phases(conn, rows, line_ids)
    history_records = register_histories(conn, rows, line_ids)
    payload = {
        "session_id": session_id,
        "success_rows": result["success_rows"],
        "skipped_rows": result["skipped_rows"],
        "phases": phases,
        "history_records": history_records,
        "file_sha256": session["source_sha256"],
    }
    finish_session(conn, session_id, result=payload)
    return {"already_committed": False, **payload}


# 业务 → (日期列, 票据列, 金额列)。写期次时按这张表拼列名。
PHASE_TABLE_COLUMNS: dict[str, tuple[str, str, str]] = {
    "sales_invoice": ("invoice_date", "invoice_no", "invoice_amount"),
    "sales_receipt": ("receipt_date", "payment_notice_no", "receipt_amount"),
    "purchase_payment": ("payment_date", "payment_voucher_no", "payment_amount"),
    "purchase_invoice": ("received_invoice_date", "invoice_no", "invoice_amount"),
    "finance_invoice_check": ("received_invoice_date", "voucher_code", "received_invoice_amount"),
    "warehouse_entry": ("warehouse_date", "voucher_no", "warehouse_amount"),
}

# 每组财务在模板里占用的**全部**列。规范化工件要把这些列整体清空：
# 只要漏掉一列（例如开票组的发票号列），importer 的固定列逻辑就会先写一期，
# 追加逻辑再写三期，结果变成四期。
FINANCE_GROUP_COLUMNS: dict[str, tuple[int, ...]] = {
    "sales_invoice": (73, 74, 75, 76, 77),
    "sales_receipt": (79, 80, 81, 82, 83, 84, 85, 86),
    "purchase_payment": (55, 56, 57, 58, 59, 60, 61),
    "purchase_invoice": (44, 45, 46),
    "finance_invoice_check": (50, 51, 52, 53),
    "warehouse_entry": (47, 48, 49),
}

# 到期付款日不参与多值解析，作为采购付款各期共用的行级值保留。
DUE_PAYMENT_DATE_COLUMN = 54

PHASE_SOURCE_COLUMNS: tuple[int, ...] = tuple(
    column for columns in FINANCE_GROUP_COLUMNS.values() for column in columns
)


def load_all_rows(conn: Connection, session_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            SELECT excel_row_no, raw_json, parsed_json, resolution_json
            FROM legacy_import_source WHERE session_id = :id ORDER BY excel_row_no
            """
        ),
        {"id": session_id},
    ).mappings().all()
    result: list[dict[str, Any]] = []
    for row in rows:
        raw = row["raw_json"]
        raw = json.loads(raw) if isinstance(raw, str) else raw
        parsed = row["parsed_json"]
        parsed = json.loads(parsed) if isinstance(parsed, str) else parsed
        resolution = row["resolution_json"]
        resolution = json.loads(resolution) if isinstance(resolution, str) else resolution
        result.append(
            {
                "excel_row_no": int(row["excel_row_no"]),
                "values": list((raw or {}).get("values") or []),
                "parsed": parsed or {},
                "resolution": resolution or {},
            }
        )
    return result


def effective_order_chain(row: dict[str, Any]) -> list[str]:
    order = row["resolution"].get("order_no") or row["parsed"].get("order_no") or {}
    chain = order.get("history") or []
    if not chain and order.get("current"):
        chain = [order["current"]]
    return [str(item) for item in chain if str(item).strip()]


def effective_manager_chain(row: dict[str, Any]) -> list[str]:
    manager = row["resolution"].get("manager") or row["parsed"].get("manager") or {}
    chain = manager.get("history") or []
    if not chain and manager.get("current"):
        chain = [manager["current"]]
    return [str(item) for item in chain if str(item).strip()]


def build_normalized_workbook(rows: list[dict[str, Any]]) -> bytes:
    """按“原始行 + 人工确认”重建一份规范化工件。

    订单号写当前号（链尾），客户经理写现任；财务源列全部清空，改由
    append_phases 按确认后的期次写入，因此支持任意期数而不是模板的固定两期。
    """
    from .ledger_excel import TEMPLATE_HEADERS, template_bytes

    workbook = load_workbook(_BytesReader(template_bytes()))
    worksheet = workbook.worksheets[0]
    total_columns = len(TEMPLATE_HEADERS)
    for excel_row in range(3, 3 + len(rows) + 1):
        for column in range(1, total_columns + 1):
            worksheet.cell(excel_row, column).value = None

    for offset, row in enumerate(rows):
        values = list(row["values"])
        values += [None] * (total_columns - len(values))
        for column in PHASE_SOURCE_COLUMNS:
            if 1 <= column <= total_columns:
                values[column - 1] = None
        order_chain = effective_order_chain(row)
        if order_chain:
            values[ORDER_NO_COLUMN - 1] = order_chain[-1]
        manager_chain = effective_manager_chain(row)
        if manager_chain:
            values[MANAGER_COLUMN - 1] = manager_chain[-1]
        for column, value in enumerate(values[:total_columns], start=1):
            worksheet.cell(3 + offset, column, _restore_value(value))

    buffer = _BytesWriter()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def _next_phase_no(conn: Connection, table: str, order_line_id: int) -> int:
    value = conn.execute(
        text(
            f"SELECT COALESCE(MAX(phase_no), 0) FROM {table} "
            "WHERE order_line_id = :order_line_id AND deleted_at IS NULL"
        ),
        {"order_line_id": order_line_id},
    ).scalar()
    return int(value or 0) + 1


def append_phases(
    conn: Connection, rows: list[dict[str, Any]], line_ids: dict[int, int]
) -> dict[str, int]:
    """把确认后的每一期财务按顺序写入对应期次表，期号连续分配、不设上限。"""
    written: dict[str, int] = {}
    for row in rows:
        order_line_id = line_ids.get(row["excel_row_no"])
        if not order_line_id:
            continue
        finance = row["resolution"].get("finance") or row["parsed"].get("finance") or {}
        for business, entry in finance.items():
            columns = PHASE_TABLE_COLUMNS.get(business)
            if not columns:
                continue
            date_column, document_column, amount_column = columns
            for phase in entry.get("phases") or []:
                phase_no = _next_phase_no(conn, business, order_line_id)
                conn.execute(
                    text(
                        f"""
                        INSERT INTO {business}
                          (order_line_id, phase_no, {date_column}, {date_column}_text,
                           {document_column}, {amount_column})
                        VALUES
                          (:order_line_id, :phase_no, :date_value, :date_text,
                           :document_value, :amount_value)
                        """
                    ),
                    {
                        "order_line_id": order_line_id,
                        "phase_no": phase_no,
                        "date_value": phase.get("date"),
                        "date_text": phase.get("date"),
                        "document_value": phase.get("document_no"),
                        "amount_value": phase.get("amount"),
                    },
                )
                if business == "purchase_payment":
                    _set_due_payment_date(conn, order_line_id, phase_no, row)
                written[business] = written.get(business, 0) + 1
    return written


def _set_due_payment_date(
    conn: Connection, order_line_id: int, phase_no: int, row: dict[str, Any]
) -> None:
    """到期付款日在模板里是行级单值，写入该期时一并带上。"""
    values = row.get("values") or []
    index = DUE_PAYMENT_DATE_COLUMN - 1
    if index >= len(values):
        return
    due = _restore_value(values[index])
    if due in (None, ""):
        return
    conn.execute(
        text(
            "UPDATE purchase_payment SET due_payment_date = :due "
            "WHERE order_line_id = :order_line_id AND phase_no = :phase_no"
        ),
        {"due": due, "order_line_id": order_line_id, "phase_no": phase_no},
    )


def register_histories(
    conn: Connection, rows: list[dict[str, Any]], line_ids: dict[int, int]
) -> int:
    """登记订单号别名链与负责人交接链（链尾为当前值），并同步主记录的当前值。"""
    seen_orders: set[int] = set()
    seen_projects: set[int] = set()
    for row in rows:
        order_line_id = line_ids.get(row["excel_row_no"])
        if not order_line_id:
            continue
        ids = conn.execute(
            text(
                """
                SELECT so.id AS sales_order_id, p.id AS project_id
                FROM order_line ol
                JOIN sales_order so ON so.id = ol.sales_order_id
                JOIN project p ON p.id = so.project_id
                WHERE ol.id = :order_line_id
                """
            ),
            {"order_line_id": order_line_id},
        ).mappings().first()
        if ids is None:
            continue
        sales_order_id = int(ids["sales_order_id"])
        project_id = int(ids["project_id"])

        order_chain = effective_order_chain(row)
        if order_chain and sales_order_id not in seen_orders:
            register_order_numbers(conn, sales_order_id, order_chain)
            conn.execute(
                text("UPDATE sales_order SET order_no = :order_no WHERE id = :id"),
                {"order_no": order_chain[-1], "id": sales_order_id},
            )
            seen_orders.add(sales_order_id)

        manager_chain = effective_manager_chain(row)
        if manager_chain and project_id not in seen_projects:
            register_manager_history(conn, project_id, manager_chain)
            conn.execute(
                text("UPDATE project SET account_manager = :name WHERE id = :project_id"),
                {"name": manager_chain[-1], "project_id": project_id},
            )
            seen_projects.add(project_id)
    return len(seen_orders) + len(seen_projects)


class _BytesWriter:
    def __init__(self) -> None:
        self._chunks: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._chunks.append(bytes(data))
        return len(data)

    def getvalue(self) -> bytes:
        return b"".join(self._chunks)

    def flush(self) -> None:
        return None

    def seekable(self) -> bool:
        return False

    def tell(self) -> int:
        return sum(len(chunk) for chunk in self._chunks)


class _BytesReader:
    """openpyxl 只接受文件路径或类文件对象。"""

    def __init__(self, content: bytes) -> None:
        self._buffer = memoryview(content)
        self._position = 0

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk = bytes(self._buffer[self._position :])
            self._position = len(self._buffer)
            return chunk
        chunk = bytes(self._buffer[self._position : self._position + size])
        self._position += len(chunk)
        return chunk

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self._position = offset
        elif whence == 1:
            self._position += offset
        else:
            self._position = len(self._buffer) + offset
        return self._position

    def tell(self) -> int:
        return self._position

    def seekable(self) -> bool:
        return True
