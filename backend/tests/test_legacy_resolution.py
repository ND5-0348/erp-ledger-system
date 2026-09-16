"""人工修正的结构化校验（纯函数，不连数据库）。

对应 Codex 复审 2026-09-15 的第二项缺陷：多来源财务组的金额必须**按来源列组
分别核对**，不能只把第一个来源组的原合计与全部期次的总和比较。
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.legacy_resolution import (
    FinanceRevision,
    RevisionError,
    RowResolution,
    merge_finance,
    parse_row_resolution,
    validate_finance_revision,
)

LABEL = "采购付款"


def _source(date_raw, amount_raw, document_raw=None, *, first_column=55):
    return {
        "date_column": first_column,
        "amount_column": first_column + 2,
        "document_column": first_column + 1,
        "date_raw": date_raw,
        "amount_raw": amount_raw,
        "document_raw": document_raw,
    }


def _entry(*sources) -> dict:
    """按 parse_row 产出的结构构造一个财务组。"""
    return {
        "label": LABEL,
        "date_raw": sources[0]["date_raw"],
        "amount_raw": sources[0]["amount_raw"],
        "document_raw": sources[0]["document_raw"],
        "raw_sources": list(sources),
        "phases": [],
    }


def _revision(phases: list[dict], reason: str = "") -> FinanceRevision:
    return FinanceRevision.model_validate(
        {"phases": phases, "total_correction_reason": reason}
    )


def _phase(source_group: int, date: str, amount: str, document_no: str | None = None) -> dict:
    return {"source_group": source_group, "date": date, "amount": amount, "document_no": document_no}


TWO_SOURCES = _entry(
    _source("2026/01/05/2026/02/05", "300", first_column=55),
    _source("2026/03/05", "50", "PAY-3", first_column=58),
)


def _codes(issues) -> list[str]:
    return [issue.code for issue in issues]


# --- 按来源组分别核对 -------------------------------------------------------


def test_each_source_group_total_is_checked_separately() -> None:
    """第一组 100+200 对 300，第二组 50 对 50：两组都对得上就通过。"""
    phases, issues, audits = validate_finance_revision(
        TWO_SOURCES,
        _revision(
            [
                _phase(1, "2026-01-05", "100.00"),
                _phase(1, "2026-02-05", "200.00"),
                _phase(2, "2026-03-05", "50.00"),
            ]
        ),
        label=LABEL,
    )
    assert _codes(issues) == []
    assert [phase["amount"] for phase in phases] == ["100.00", "200.00", "50.00"]
    assert [audit["source_group"] for audit in audits] == [1, 2]
    assert audits[0]["original_total"] == "300"
    assert audits[1]["original_total"] == "50"


def test_missing_second_group_is_rejected_even_when_first_total_matches() -> None:
    """只填第一组：总和恰好等于第一组原合计，也不能放行。"""
    _, issues, _ = validate_finance_revision(
        TWO_SOURCES,
        _revision([_phase(1, "2026-01-05", "100.00"), _phase(1, "2026-02-05", "200.00")]),
        label=LABEL,
    )
    assert _codes(issues) != [], "漏掉第二组却被放行"
    assert "第二" in issues[0].message or "2" in issues[0].message


def test_wrong_second_group_total_is_rejected() -> None:
    """第二组填 30（原值 50）且没有理由 → 拒绝。"""
    _, issues, _ = validate_finance_revision(
        TWO_SOURCES,
        _revision(
            [
                _phase(1, "2026-01-05", "100.00"),
                _phase(1, "2026-02-05", "200.00"),
                _phase(2, "2026-03-05", "30.00"),
            ]
        ),
        label=LABEL,
    )
    assert any("50" in issue.message for issue in issues)


def test_first_group_total_may_be_corrected_with_reason() -> None:
    """第一组合计写错时给理由可改，第二组仍按各自的原值核对。"""
    _, issues, audits = validate_finance_revision(
        TWO_SOURCES,
        _revision(
            [
                _phase(1, "2026-01-05", "100.00"),
                _phase(1, "2026-02-05", "150.00"),
                _phase(2, "2026-03-05", "50.00"),
            ],
            "第一组原合计写成 300，实际 250",
        ),
        label=LABEL,
    )
    assert _codes(issues) == []
    assert audits[0]["original_total"] == "300"
    assert audits[0]["corrected_total"] == "250.00"
    assert audits[0]["reason"] == "第一组原合计写成 300，实际 250"
    assert audits[1]["original_total"] == "50"
    assert audits[1]["corrected_total"] == "50.00"


def test_phase_count_is_checked_per_source_group() -> None:
    """第一组日期两个却只填一期 → 拒绝（即使总数看起来对得上）。"""
    _, issues, _ = validate_finance_revision(
        TWO_SOURCES,
        _revision([_phase(1, "2026-01-05", "300.00"), _phase(2, "2026-03-05", "50.00")]),
        label=LABEL,
    )
    assert _codes(issues) != []


def test_unknown_source_group_is_rejected() -> None:
    """修正里出现原表没有的第 3 个来源组 → 拒绝。"""
    _, issues, _ = validate_finance_revision(
        TWO_SOURCES,
        _revision(
            [
                _phase(1, "2026-01-05", "100.00"),
                _phase(1, "2026-02-05", "200.00"),
                _phase(2, "2026-03-05", "50.00"),
                _phase(3, "2026-04-05", "10.00"),
            ]
        ),
        label=LABEL,
    )
    assert _codes(issues) != []


def test_phases_must_follow_source_group_order() -> None:
    """期次必须按来源列组顺序排列，不能把第二组的期次排到第一组前面。"""
    _, issues, _ = validate_finance_revision(
        TWO_SOURCES,
        _revision(
            [
                _phase(2, "2026-03-05", "50.00"),
                _phase(1, "2026-01-05", "100.00"),
                _phase(1, "2026-02-05", "200.00"),
            ]
        ),
        label=LABEL,
    )
    assert _codes(issues) != []


def test_single_source_group_keeps_working() -> None:
    """只有一个来源列组时行为不变。"""
    entry = _entry(_source("2026/01/01/2026/02/01", "300"))
    _, issues, audits = validate_finance_revision(
        entry,
        _revision([_phase(1, "2026-01-01", "100.00"), _phase(1, "2026-02-01", "200.00")]),
        label=LABEL,
    )
    assert _codes(issues) == []
    assert audits[0]["source_group"] == 1


def test_unparsable_source_group_needs_explicit_phases() -> None:
    """原日期无法解析的来源组不能自动核对期次数，但不填就该拒绝。"""
    entry = _entry(
        _source("待定", "300", first_column=55),
        _source("2026/03/05", "50", "PAY-3", first_column=58),
    )
    # 只填了第一组：第二组缺失，即使第一组是"无法核对"的那一组也必须拒绝。
    _, issues, _ = validate_finance_revision(
        entry, _revision([_phase(1, "2026-01-01", "300.00")]), label=LABEL
    )
    assert _codes(issues) != []

    _, ok_issues, _ = validate_finance_revision(
        entry,
        _revision([_phase(1, "2026-01-01", "300.00"), _phase(2, "2026-03-05", "50.00")]),
        label=LABEL,
    )
    assert _codes(ok_issues) == []


# --- 合并与请求解析 ---------------------------------------------------------


def test_merge_finance_keeps_groups_that_were_not_revised() -> None:
    parsed = {
        "sales_invoice": {"label": "销售开票", "phases": [{"position": 1, "amount": "10.00"}]},
        "purchase_payment": {"label": "采购付款", "phases": []},
    }
    revision = {
        "purchase_payment": _revision([_phase(1, "2026-03-05", "50.00")]),
    }
    merged = merge_finance(parsed, revision)
    assert merged["sales_invoice"]["phases"] == [{"position": 1, "amount": "10.00"}]
    assert merged["purchase_payment"]["phases"][0]["amount"] == "50.00"
    assert merged["purchase_payment"]["phases"][0]["source_group"] == 1


def test_source_group_is_required() -> None:
    """不给来源组编号的修正不再被接受：无法按来源组核对金额。"""
    with pytest.raises(Exception):
        FinanceRevision.model_validate({"phases": [{"date": "2026-01-01", "amount": "100.00"}]})


def test_resolution_rejects_unknown_finance_group() -> None:
    with pytest.raises(RevisionError):
        parse_row_resolution(
            {"finance": {"not_a_group": {"phases": [_phase(1, "2026-01-01", "1.00")]}}},
            known_finance_groups={"sales_invoice", "purchase_payment"},
        )


def test_resolution_requires_non_blank_chain_values() -> None:
    with pytest.raises(RevisionError):
        parse_row_resolution(
            {"manager": {"history": ["甲", "  "]}},
            known_finance_groups={"sales_invoice"},
        )


def test_row_resolution_rejects_unknown_top_level_field() -> None:
    with pytest.raises(RevisionError):
        parse_row_resolution(
            {"acknowledged_codes": ["AMOUNT_SPLIT_REQUIRED"]},
            known_finance_groups={"sales_invoice"},
        )


def test_empty_resolution_is_treated_as_no_revision() -> None:
    assert parse_row_resolution({}, known_finance_groups={"sales_invoice"}) is None
    assert parse_row_resolution(None, known_finance_groups={"sales_invoice"}) is None


def test_decimal_scale_is_enforced() -> None:
    """金额沿用系统规则：超过两位小数在结构化校验阶段就拒绝。"""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _revision([_phase(1, "2026-01-01", "1.005")])


def test_future_year_is_rejected() -> None:
    """日期年份沿用系统规则：超过 2099 拒绝。"""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _revision([_phase(1, "2101-01-01", "1.00")])


def test_row_resolution_accepts_chains_and_finance_together() -> None:
    revision = parse_row_resolution(
        {
            "order_no": {"history": ["SO-A", "SO-B"]},
            "manager": {"history": ["甲", "乙"]},
            "finance": {"purchase_payment": {"phases": [_phase(1, "2026-01-01", "100.00")]}},
        },
        known_finance_groups={"purchase_payment"},
    )
    assert isinstance(revision, RowResolution)
    assert revision.order_no.history == ["SO-A", "SO-B"]
    assert revision.manager.history == ["甲", "乙"]
    assert revision.finance["purchase_payment"].phases[0].amount == Decimal("100.00")
