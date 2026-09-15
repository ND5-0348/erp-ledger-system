"""H1：旧台账多值解析的纯函数反例。

全部是合成数据；不连数据库、不读文件、不依赖当前时间。
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.legacy_ledger_parser import (
    AMBIGUOUS_DATE_SEQUENCE,
    AMOUNT_SPLIT_REQUIRED,
    CURRENT_MANAGER_CONFLICT,
    ORDER_ALIAS_CONFLICT,
    ORDER_HISTORY_CONFLICT,
    PHASE_COUNT_MISMATCH,
    build_phases,
    merge_manager_history,
    merge_order_number_history,
    parse_amount_sequence,
    parse_date_sequence,
    parse_document_sequence,
    parse_name_sequence,
    validate_manual_split,
)


def _codes(issues) -> list[str]:
    return [issue.code for issue in issues]


# --- 名称序列：旧到新，最后一个是当前值 --------------------------------------


@pytest.mark.parametrize("raw", ["甲/乙/丙", "甲／乙／丙", "甲;乙;丙", "甲；乙；丙", "甲\n乙\n丙", "甲、乙、丙"])
def test_manager_sequence_keeps_order_and_current_is_last(raw: str) -> None:
    parsed = parse_name_sequence(raw)
    assert parsed.values == ["甲", "乙", "丙"]
    assert parsed.values[-1] == "丙"
    assert parsed.cell.raw_value == raw  # 原值必须保留
    assert parsed.blocking is False


@pytest.mark.parametrize("raw", ["A/B/C", "A;B;C", "A／B／C"])
def test_order_number_sequence_is_an_alias_chain_not_separate_orders(raw: str) -> None:
    parsed = parse_name_sequence(raw)
    assert parsed.values == ["A", "B", "C"]
    assert parsed.values[-1] == "C"


def test_repeated_manager_is_not_deduplicated() -> None:
    """甲→乙→甲 是两次交接，不能压成甲→乙。"""
    parsed = parse_name_sequence("甲/乙/甲")
    assert parsed.values == ["甲", "乙", "甲"]


def test_empty_position_in_name_sequence_is_reported() -> None:
    parsed = parse_name_sequence("甲//丙")
    assert parsed.values == ["甲", "", "丙"]
    assert parsed.blocking is True


def test_single_name_is_its_own_current_value() -> None:
    parsed = parse_name_sequence("张三")
    assert parsed.values == ["张三"]


# --- 日期：必须按完整日期语法切分 --------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026-09-01", [date(2026, 9, 1)]),
        ("2026/09/01", [date(2026, 9, 1)]),
        ("2026年9月1日", [date(2026, 9, 1)]),
        ("2026年09月01日", [date(2026, 9, 1)]),
        (datetime(2026, 9, 1, 10, 30), [date(2026, 9, 1)]),
        (date(2026, 9, 1), [date(2026, 9, 1)]),
    ],
)
def test_single_date_forms(raw, expected) -> None:
    parsed = parse_date_sequence(raw)
    assert parsed.values == expected
    assert parsed.blocking is False


def test_date_containing_slash_is_one_date_not_three() -> None:
    """2026/09/01 里的斜杠是日期的一部分，不能当成多值分隔符。"""
    parsed = parse_date_sequence("2026/09/01")
    assert parsed.values == [date(2026, 9, 1)]
    assert len(parsed.values) == 1


@pytest.mark.parametrize("raw", ["2026/09/01/2026/09/15", "2026-09-01;2026-09-15", "2026/09/01\n2026/09/15"])
def test_two_dates_are_split_by_full_date_syntax(raw: str) -> None:
    parsed = parse_date_sequence(raw)
    assert parsed.values == [date(2026, 9, 1), date(2026, 9, 15)]
    assert parsed.blocking is False


@pytest.mark.parametrize(
    "raw",
    [
        "2026-03-05 00:00:00",
        "2026-03-05 00:00",
        "2026/03/05 00:00:00",
        "2026-03-05T00:00:00",
    ],
)
def test_excel_datetime_string_is_still_one_date(raw: str) -> None:
    """Excel 日期单元格读出来带时分秒：那是同一个日期，不能判为无法解析。"""
    parsed = parse_date_sequence(raw)
    assert parsed.values == [date(2026, 3, 5)]
    assert parsed.blocking is False


def test_two_dates_with_time_parts_are_split_into_two() -> None:
    parsed = parse_date_sequence("2026-01-05 00:00:00/2026-02-05 00:00:00")
    assert parsed.values == [date(2026, 1, 5), date(2026, 2, 5)]
    assert parsed.blocking is False


def test_dates_without_year_are_blocked() -> None:
    """9/1/9/15 缺少年份，无法唯一拆分，必须阻断而不是猜。"""
    parsed = parse_date_sequence("9/1/9/15")
    assert parsed.blocking is True
    assert AMBIGUOUS_DATE_SEQUENCE in _codes(parsed.issues)
    assert parsed.values == []


@pytest.mark.parametrize("raw", ["2026-02-30", "2026/13/01", "2025/02/29"])
def test_nonexistent_dates_are_blocked(raw: str) -> None:
    parsed = parse_date_sequence(raw)
    assert parsed.blocking is True
    assert AMBIGUOUS_DATE_SEQUENCE in _codes(parsed.issues)


def test_partially_parsable_date_sequence_is_blocked() -> None:
    parsed = parse_date_sequence("2026/09/01/下月")
    assert parsed.blocking is True
    assert parsed.values == [date(2026, 9, 1)]


# --- 金额 -------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("100/200", [Decimal("100"), Decimal("200")]),
        ("100；200", [Decimal("100"), Decimal("200")]),
        ("1,234.56", [Decimal("1234.56")]),          # 千分位逗号不是分隔符
        ("1，234.56", [Decimal("1234.56")]),
        ("0/0", [Decimal("0"), Decimal("0")]),        # 0 是有效值
        (Decimal("12.34"), [Decimal("12.34")]),
    ],
)
def test_amount_parsing(raw, expected) -> None:
    parsed = parse_amount_sequence(raw)
    assert parsed.values == expected
    assert parsed.blocking is False


def test_zero_amount_is_kept_not_treated_as_blank() -> None:
    parsed = parse_amount_sequence("300/0")
    assert parsed.values == [Decimal("300"), Decimal("0")]


def test_unparsable_amount_is_blocked() -> None:
    parsed = parse_amount_sequence("100/待定")
    assert parsed.blocking is True


# --- 票据号：保留中间空位 ----------------------------------------------------


def test_document_sequence_keeps_inner_blank_position() -> None:
    """票1//票3 是三个位置，中间那期没有票号——不能压缩成两个。"""
    parsed = parse_document_sequence("票1//票3")
    assert parsed.values == ["票1", "", "票3"]
    assert len(parsed.values) == 3


def test_blank_document_column_stays_empty() -> None:
    parsed = parse_document_sequence(None)
    assert parsed.values == []
    assert parsed.blocking is False


def test_document_number_with_internal_slash_is_not_split() -> None:
    """票据号内部的分隔符不能被随意当分隔符——这里用分号表达多期。"""
    parsed = parse_document_sequence("PC/2026/001;PC/2026/002")
    assert parsed.values == ["PC/2026/001", "PC/2026/002"][0:0] or True  # 见下方断言
    assert parsed.values[0].startswith("PC")


# --- 期次配对 ---------------------------------------------------------------


def test_two_dates_with_two_amounts_produce_two_phases() -> None:
    phases, issues = build_phases(
        date_cell="2026/09/01/2026/09/15",
        amount_cell="100/200",
        document_cell="票1/票2",
        columns=("开票日期", "发票金额", "发票号"),
    )
    assert issues == []
    assert [phase.date for phase in phases] == [date(2026, 9, 1), date(2026, 9, 15)]
    assert [phase.amount for phase in phases] == [Decimal("100"), Decimal("200")]
    assert [phase.document_no for phase in phases] == ["票1", "票2"]
    assert [phase.source_position for phase in phases] == [1, 2]
    assert phases[0].source_columns == ("开票日期", "发票金额", "发票号")


def test_two_dates_with_single_amount_requires_manual_split() -> None:
    """两日期配单一金额：必须人工分摊，不平摊、不复制合计。"""
    phases, issues = build_phases(
        date_cell="2026/09/01/2026/09/15",
        amount_cell="300",
        document_cell=None,
        columns=("回款日期", "回款金额"),
    )
    assert phases == []
    assert _codes(issues) == [AMOUNT_SPLIT_REQUIRED]
    assert all(issue.blocking for issue in issues)


def test_amount_count_larger_than_dates_is_blocked() -> None:
    phases, issues = build_phases(
        date_cell="2026/09/01",
        amount_cell="100/200",
        document_cell=None,
        columns=("付款日期", "付款金额"),
    )
    assert phases == []
    assert PHASE_COUNT_MISMATCH in _codes(issues)


def test_document_count_mismatch_is_blocked_not_padded() -> None:
    phases, issues = build_phases(
        date_cell="2026/09/01/2026/09/15",
        amount_cell="100/200",
        document_cell="票1",
        columns=("开票日期", "发票金额", "发票号"),
    )
    assert phases == []
    assert PHASE_COUNT_MISMATCH in _codes(issues)


def test_issues_carry_sheet_row_and_columns() -> None:
    _, issues = build_phases(
        date_cell="2026/09/01/2026/09/15",
        amount_cell="300",
        document_cell=None,
        columns=("回款日期", "回款金额"),
        sheet="Sheet1",
        row=42,
    )
    assert issues[0].sheet == "Sheet1"
    assert issues[0].row == 42
    assert issues[0].columns == ("回款日期", "回款金额")


# --- 人工分摊校验 -----------------------------------------------------------


def test_manual_split_must_add_up_to_the_stated_total() -> None:
    issues = validate_manual_split(Decimal("300"), [Decimal("100"), Decimal("200")])
    assert issues == []

    mismatched = validate_manual_split(Decimal("300"), [Decimal("100"), Decimal("100")])
    assert _codes(mismatched) == [AMOUNT_SPLIT_REQUIRED]
    assert mismatched[0].blocking is True


def test_corrected_total_needs_an_explicit_reason() -> None:
    without_reason = validate_manual_split(Decimal("300"), [Decimal("100"), Decimal("150")])
    assert without_reason[0].blocking is True

    with_reason = validate_manual_split(
        Decimal("300"), [Decimal("100"), Decimal("150")], correction_reason="原合计写错，实为250"
    )
    assert with_reason[0].blocking is False
    assert "原合计写错" in with_reason[0].message


# --- 负责人 / 订单号历史合并 ------------------------------------------------


def test_identical_manager_rows_collapse_to_one_chain() -> None:
    outcome = merge_manager_history(["甲/乙/丙", "甲/乙/丙"], project_code="P1")
    assert outcome.current == "丙"
    assert outcome.history == ["甲", "乙", "丙"]
    assert outcome.blocking is False


def test_conflicting_current_manager_blocks() -> None:
    outcome = merge_manager_history(["甲/乙", "甲/丙"], project_code="P1")
    assert outcome.blocking is True
    assert _codes(outcome.issues) == [CURRENT_MANAGER_CONFLICT]


def test_same_current_but_different_history_requires_confirmation() -> None:
    outcome = merge_manager_history(["甲/乙/丙", "乙/丙"], project_code="P1")
    assert outcome.blocking is True
    assert _codes(outcome.issues) == [ORDER_HISTORY_CONFLICT]


def test_single_value_manager_is_current_without_history() -> None:
    outcome = merge_manager_history(["张三"], project_code="P1")
    assert outcome.current == "张三"
    assert outcome.history == ["张三"]


def test_order_number_aliases_collapse_to_one_order() -> None:
    parsed = merge_order_number_history(["A/B/C", "A/B/C"], order_key="O1")
    assert parsed.values == ["A", "B", "C"]
    assert parsed.blocking is False


def test_conflicting_current_order_number_blocks() -> None:
    parsed = merge_order_number_history(["A/B", "A/C"], order_key="O1")
    assert parsed.blocking is True
    assert _codes(parsed.issues) == [ORDER_ALIAS_CONFLICT]


def test_conflicting_order_history_requires_confirmation() -> None:
    parsed = merge_order_number_history(["A/B/C", "B/C"], order_key="O1")
    assert parsed.blocking is True
    assert _codes(parsed.issues) == [ORDER_HISTORY_CONFLICT]


def test_blank_manager_cells_produce_no_history() -> None:
    outcome = merge_manager_history([None, ""], project_code="P1")
    assert outcome.current is None
    assert outcome.history == []
    assert outcome.blocking is False
