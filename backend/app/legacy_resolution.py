"""人工修正的结构化定义与校验（H3）。

设计要点（对应 Codex 静态审查第一条）：

- 修正用**有明确类型和约束**的结构化数据表达：每期日期、金额、票据号各自是
  独立字段，不接受"重新拼斜杠字符串"，也不接受"确认错误码"这种没有内容的确认。
- 修正后的行**重新执行全部解析与业务校验**，提交前再复核一次；单纯提交已确认
  的错误码不会让不完整或无效的数据通过。
- 同一行的修正按**财务组**合并：只覆盖被修正的组，未修正的组保留解析结果，
  不允许"只改了开票组"把付款组一起丢掉。
- 多日期配单金额时必须逐期填写，各期之和与原合计一致；原合计本身有误时必须
  给出理由，并记录原值、修正值、理由、操作者和时间。

金额与日期沿用系统既有业务规则（`app.validation`）：金额非负、最多两位小数，
日期必须是真实存在的日期且年份不超过 2099。
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Iterable

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .legacy_ledger_parser import (
    Issue,
    PHASE_COUNT_MISMATCH,
    parse_amount_sequence,
    parse_date_sequence,
)
from .validation import BusinessDate, Money

MAX_CHAIN_LENGTH = 50
MAX_PHASES_PER_GROUP = 50
MAX_REASON_LENGTH = 500


class RevisionError(ValueError):
    """人工修正本身不合法：直接拒绝该次请求，不写入任何确认。"""


class PhaseRevision(BaseModel):
    """一期财务的人工确认值。"""

    model_config = ConfigDict(extra="forbid")

    date: BusinessDate
    amount: Money
    document_no: str | None = Field(default=None, max_length=128)


class FinanceRevision(BaseModel):
    """一个财务组的修正：逐期填写，可附带原合计修正理由。"""

    model_config = ConfigDict(extra="forbid")

    phases: list[PhaseRevision] = Field(min_length=1, max_length=MAX_PHASES_PER_GROUP)
    total_correction_reason: str = Field(default="", max_length=MAX_REASON_LENGTH)


class ChainRevision(BaseModel):
    """订单号别名链或客户经理交接链的人工确认值（旧到新，末尾为当前值）。"""

    model_config = ConfigDict(extra="forbid")

    history: list[str] = Field(min_length=1, max_length=MAX_CHAIN_LENGTH)


class RowResolution(BaseModel):
    """一行的人工修正。未列出的字段表示"保持解析结果"。"""

    model_config = ConfigDict(extra="forbid")

    order_no: ChainRevision | None = None
    manager: ChainRevision | None = None
    finance: dict[str, FinanceRevision] = Field(default_factory=dict)


def parse_row_resolution(
    payload: Any, *, known_finance_groups: Iterable[str]
) -> RowResolution | None:
    """把请求里的 resolution 解析成结构化修正。

    空对象或 None 表示没有任何修正（该行仍按解析结果校验）。
    结构不合法时抛 `RevisionError`，由路由层转成 422。
    """
    if payload in (None, {}, []):
        return None
    try:
        revision = RowResolution.model_validate(payload)
    except ValidationError as exc:
        raise RevisionError(_format_validation_error(exc)) from exc
    known = set(known_finance_groups)
    unknown = sorted(name for name in revision.finance if name not in known)
    if unknown:
        raise RevisionError(
            f"未知的财务组：{'、'.join(unknown)}；可选值为 {'、'.join(sorted(known))}"
        )
    for name, entry in revision.finance.items():
        _reject_blank_document(entry, name)
    for field_name, field_label in (("order_no", "订单号"), ("manager", "客户经理")):
        chain = getattr(revision, field_name)
        if chain is None:
            continue
        if any(not item.strip() for item in chain.history):
            raise RevisionError(
                f"{field_label}的历史链里存在空白项；缺历史请只填一个值，不要留空位"
            )
    return revision


def _reject_blank_document(entry: FinanceRevision, name: str) -> None:
    for phase in entry.phases:
        if phase.document_no is not None and not phase.document_no.strip():
            raise RevisionError(f"{name} 的票据号不能是空白字符串；没有票据请留空")


def _format_validation_error(exc: ValidationError) -> str:
    messages: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc") or ())
        error_type = str(error.get("type") or "")
        if error_type == "extra_forbidden":
            messages.append(f"不支持的字段 {location}")
        elif error_type == "greater_than_equal":
            messages.append(f"{location} 不能为负数")
        elif error_type in {"decimal_places", "decimal_max_places"}:
            messages.append(f"{location} 最多两位小数")
        elif error_type in {"date_from_datetime_parsing", "date_parsing", "date_type"}:
            messages.append(f"{location} 不是有效日期")
        elif error_type == "value_error" and "2099" in str(error.get("msg") or ""):
            messages.append(f"{location} 的年份不能超过 2099")
        elif error_type in {"missing", "string_type", "int_type"}:
            messages.append(f"{location} 缺失或类型不正确")
        else:
            messages.append(f"{location or '修正内容'} 不合法（{error_type}）")
    return "人工修正格式错误：" + "；".join(messages)


def raw_sources(parsed_entry: dict[str, Any]) -> list[dict[str, Any]]:
    """一个财务组的全部来源列组（标准模板第一组、第二组……）。"""
    sources = parsed_entry.get("raw_sources")
    if isinstance(sources, list) and sources:
        return [source for source in sources if isinstance(source, dict)]
    return [
        {
            "date_raw": parsed_entry.get("date_raw"),
            "amount_raw": parsed_entry.get("amount_raw"),
            "document_raw": parsed_entry.get("document_raw"),
        }
    ]


def expected_phase_count(parsed_entry: dict[str, Any]) -> int | None:
    """该组原始单元格里可确定的期次数。

    日期能唯一解析出几期就是几期；完全解析不出日期时返回 None（无法判定，
    此时只要求修正给出至少一期，由业务校验决定是否可提交）。
    """
    total = 0
    for source in raw_sources(parsed_entry):
        parsed = parse_date_sequence(source.get("date_raw"))
        if parsed.issues:
            continue
        total += len(parsed.values)
    return total or None


def original_single_total(parsed_entry: dict[str, Any]) -> Decimal | None:
    """原始单元格里"多日期配单一金额"的那个合计值；不是这种情况返回 None。"""
    for source in raw_sources(parsed_entry):
        dates = parse_date_sequence(source.get("date_raw"))
        amounts = parse_amount_sequence(source.get("amount_raw"))
        if dates.issues or amounts.issues:
            continue
        if len(dates.values) > 1 and len(amounts.values) == 1:
            return amounts.values[0]
    return None


def validate_finance_revision(
    parsed_entry: dict[str, Any],
    revision: FinanceRevision,
    *,
    label: str,
) -> tuple[list[dict[str, Any]], list[Issue], dict[str, Any] | None]:
    """校验一个财务组的人工修正。

    返回（规范化后的期次列表、问题列表、合计修正审计）。
    期次数与原日期数不符、各期之和不等于原合计且未给理由时，都返回阻断问题。
    """
    issues: list[Issue] = []
    phases = [
        {
            "position": index + 1,
            "date": phase.date.isoformat(),
            "amount": format(phase.amount, "f"),
            "document_no": phase.document_no,
        }
        for index, phase in enumerate(revision.phases)
    ]

    expected = expected_phase_count(parsed_entry)
    if expected is not None and len(phases) != expected:
        issues.append(
            Issue(
                code=PHASE_COUNT_MISMATCH,
                message=(
                    f"{label}原表有 {expected} 个日期，人工确认填了 {len(phases)} 期，"
                    "请按期补齐（不足的位置也要写清日期与金额）"
                ),
                columns=(label,),
            )
        )

    audit: dict[str, Any] | None = None
    original_total = original_single_total(parsed_entry)
    if original_total is not None:
        corrected_total = sum((phase.amount for phase in revision.phases), Decimal(0))
        reason = revision.total_correction_reason.strip()
        if corrected_total != original_total and not reason:
            issues.append(
                Issue(
                    code=PHASE_COUNT_MISMATCH,
                    message=(
                        f"{label}各期金额之和 {corrected_total} 与原合计 {original_total} 不一致；"
                        "请核对分摊结果，若原合计本身有误请填写修正理由"
                    ),
                    columns=(label,),
                )
            )
        elif corrected_total != original_total:
            # 合计被修正：记录原值、修正值、理由；操作者与时间由会话行记录。
            audit = {
                "group": label,
                "original_total": format(original_total, "f"),
                "corrected_total": format(corrected_total, "f"),
                "reason": reason,
            }
        else:
            audit = {
                "group": label,
                "original_total": format(original_total, "f"),
                "corrected_total": format(corrected_total, "f"),
                "reason": "各期之和与原合计一致，按原合计分摊",
            }

    return phases, issues, audit


def merge_finance(
    parsed_finance: dict[str, Any] | None,
    revision_finance: dict[str, FinanceRevision] | None,
) -> dict[str, Any]:
    """按组覆盖：只替换被人工修正的组，其余组原样保留。

    这是"不允许部分 finance 修正导致其他未修改的财务组被遗漏"的实现点：
    合并以解析结果为底，逐组覆盖，而不是用修正字典整体替换。
    """
    merged: dict[str, Any] = {}
    for name, entry in (parsed_finance or {}).items():
        copied = dict(entry)
        copied["phases"] = [dict(phase) for phase in entry.get("phases") or []]
        merged[name] = copied

    for name, revision in (revision_finance or {}).items():
        entry = merged.setdefault(
            name,
            {
                "label": name,
                "date_raw": None,
                "amount_raw": None,
                "document_raw": None,
                "raw_sources": [],
                "phases": [],
            },
        )
        entry["phases"] = [
            {
                "position": index + 1,
                "date": phase.date.isoformat(),
                "amount": format(phase.amount, "f"),
                "document_no": phase.document_no,
            }
            for index, phase in enumerate(revision.phases)
        ]
        entry["manual"] = True
        if "label" not in entry or entry.get("label") is None:
            entry["label"] = name
    return merged


def chain_revision_values(revision: ChainRevision | None) -> list[str] | None:
    """人工确认的链（去空白）；未确认返回 None。"""
    if revision is None:
        return None
    values = [item.strip() for item in revision.history if item.strip()]
    return values or None


# 统计金额上限与系统单条录入一致：18 位有效数字、2 位小数。
MAX_MONEY = Decimal("9999999999999999.99")
MAX_DOCUMENT_LENGTH = 128
MAX_BUSINESS_YEAR = 2099


def phase_business_issues(
    phase: dict[str, Any], *, label: str, position: int
) -> list[Issue]:
    """写库前对一期财务做与现有录入入口一致的业务校验。

    多期写入不能因为"来自预检"就绕过金额、日期、票据的既有规则。
    """
    issues: list[Issue] = []
    where = f"{label}第 {position} 期"

    date_value = phase.get("date")
    if date_value in (None, ""):
        issues.append(
            Issue(code=PHASE_COUNT_MISMATCH, message=f"{where}缺少日期，不能写入", columns=(label,))
        )
    else:
        try:
            parsed_date = (
                date_value
                if isinstance(date_value, date)
                else date.fromisoformat(str(date_value)[:10])
            )
        except ValueError:
            issues.append(
                Issue(code=PHASE_COUNT_MISMATCH, message=f"{where}的日期格式不正确", columns=(label,))
            )
        else:
            if parsed_date.year > MAX_BUSINESS_YEAR:
                issues.append(
                    Issue(
                        code=PHASE_COUNT_MISMATCH,
                        message=f"{where}的年份不能超过 {MAX_BUSINESS_YEAR}",
                        columns=(label,),
                    )
                )

    amount_value = phase.get("amount")
    if amount_value in (None, ""):
        issues.append(
            Issue(code=PHASE_COUNT_MISMATCH, message=f"{where}缺少金额，不能写入", columns=(label,))
        )
    else:
        try:
            amount = Decimal(str(amount_value))
        except (ArithmeticError, ValueError):
            issues.append(
                Issue(code=PHASE_COUNT_MISMATCH, message=f"{where}的金额不是有效数字", columns=(label,))
            )
        else:
            if amount < 0:
                issues.append(
                    Issue(
                        code=PHASE_COUNT_MISMATCH,
                        message=f"{where}的金额不能为负数，请检查后重新提交",
                        columns=(label,),
                    )
                )
            elif amount > MAX_MONEY:
                issues.append(
                    Issue(
                        code=PHASE_COUNT_MISMATCH,
                        message=f"{where}的金额超出系统允许范围",
                        columns=(label,),
                    )
                )
            elif -amount.as_tuple().exponent > 2:
                issues.append(
                    Issue(
                        code=PHASE_COUNT_MISMATCH,
                        message=f"{where}的金额最多两位小数",
                        columns=(label,),
                    )
                )

    document_no = phase.get("document_no")
    if document_no and len(str(document_no)) > MAX_DOCUMENT_LENGTH:
        issues.append(
            Issue(code=PHASE_COUNT_MISMATCH, message=f"{where}的票据号过长", columns=(label,))
        )
    return issues
