"""旧台账多值单元格的纯解析层（H1）。

设计约束：

- **纯函数**：本模块不连数据库、不读写文件、不依赖当前时间。同样的输入永远得到
  同样的输出，便于预检阶段反复重放与人工核对。
- **不猜**：缺年份、日期不存在、金额与日期数量对不上、历史链条无法证明顺序——
  一律产出阻断问题交人工确认，不自动补值、不取平均、不按最后一行覆盖。
- **保留来源**：每个解析结果都带回原始值与位置，人工修正记录的是“原值 → 现值”。

业务规则（2026-09-15 确认）：负责人的「甲/乙/丙」与订单号的「A/B/C」都按旧到新
排列，最后一个是当前值——订单号是同一次改号的别名序列，不是多个独立订单；
财务字段按位置一一对应，多日期配单一金额必须人工分摊。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

# --- 错误码 -----------------------------------------------------------------

AMBIGUOUS_DATE_SEQUENCE = "AMBIGUOUS_DATE_SEQUENCE"
PHASE_COUNT_MISMATCH = "PHASE_COUNT_MISMATCH"
AMOUNT_SPLIT_REQUIRED = "AMOUNT_SPLIT_REQUIRED"
CURRENT_MANAGER_CONFLICT = "CURRENT_MANAGER_CONFLICT"
ORDER_ALIAS_CONFLICT = "ORDER_ALIAS_CONFLICT"
ORDER_HISTORY_CONFLICT = "ORDER_HISTORY_CONFLICT"
UNPARSABLE_VALUE = "UNPARSABLE_VALUE"
# 同一笔可能被填进了模板的多个列组：不阻断，但必须让人看见，不能静默去重或双计。
DUPLICATE_PHASE_SUSPECTED = "DUPLICATE_PHASE_SUSPECTED"

# 单元格内的分隔符。名称类字段与金额/票据类字段共用；日期不走这里，
# 日期必须按完整日期语法切分，否则 2026/09/01 会被拆成三段。
NAME_SEPARATORS = "/／;；\n\r、,，"
VALUE_SEPARATORS = "/／;；\n\r"

# 日与时间之间用可选组而不是 \s*，否则贪婪的 \s* 会把空格吃掉、
# 让后面的时间部分匹配不上，日期尾部就会剩下一段 "00:00:00" 被判为无法解析。
_DATE_TOKEN = re.compile(
    r"(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})"
    r"(?:\s*日)?"
    # Excel 日期单元格读出来是 datetime，字符串形式会带时分秒（"2026-03-05 00:00:00"）；
    # 那是同一个日期，不能因为尾部时间就判为无法解析。
    r"(?:(?:[Tt]|\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?"
)
# 注意不要加 ^ 锚点：这个模式要配 match(text, pos) 在中间位置反复使用。
_TRAILING_SEPARATORS = re.compile(rf"[{re.escape(NAME_SEPARATORS)}]+")


@dataclass(frozen=True)
class Issue:
    """一条解析问题。blocking=False 表示需要人工留意但不阻断预检。"""

    code: str
    message: str
    blocking: bool = True
    sheet: str | None = None
    row: int | None = None
    columns: tuple[str, ...] = ()

    def with_location(self, *, sheet: str | None = None, row: int | None = None,
                      columns: tuple[str, ...] | None = None) -> "Issue":
        return Issue(
            code=self.code,
            message=self.message,
            blocking=self.blocking,
            sheet=sheet if sheet is not None else self.sheet,
            row=row if row is not None else self.row,
            columns=columns if columns is not None else self.columns,
        )


@dataclass(frozen=True)
class ParsedCell:
    """一个单元格的解析结果：原值、有序 tokens、问题。"""

    raw_value: str
    tokens: tuple[str, ...] = ()
    issues: tuple[Issue, ...] = ()


@dataclass(frozen=True)
class Phase:
    """一期财务记录：来源列、组内位置、日期、金额、票据号。"""

    source_columns: tuple[str, ...]
    source_position: int
    date: date | None = None
    amount: Decimal | None = None
    document_no: str | None = None


@dataclass
class SequenceParse:
    """一次“单元格内多值”解析的完整结果。"""

    cell: ParsedCell
    values: list[object] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    @property
    def blocking(self) -> bool:
        return any(issue.blocking for issue in self.issues)

    def add(self, issue: Issue) -> None:
        self.issues.append(issue)
        self.cell = ParsedCell(
            raw_value=self.cell.raw_value,
            tokens=self.cell.tokens,
            issues=tuple(self.issues),
        )


def _as_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _split(raw_value: object, separators: str) -> list[str]:
    """按单个分隔符切分，**不合并连续分隔符**：甲//丙 是三个位置，中间那个空着。"""
    text = _as_text(raw_value)
    if not text:
        return []
    pattern = f"[{re.escape(separators)}]"
    return [part.strip() for part in re.split(pattern, text)]


# --- 名称类：负责人 / 订单号 -------------------------------------------------


def parse_name_sequence(raw_value: object) -> SequenceParse:
    """把「甲/乙/丙」这类名称序列拆成有序 tokens。

    不做去重：甲→乙→甲 是两次交接，不能压成甲→乙。中间空项会被保留为 "",
    以便与相邻位置对齐时看得见缺口。
    """
    text = _as_text(raw_value)
    if not text:
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[])

    tokens = tuple(_split(raw_value, NAME_SEPARATORS))
    issues: list[Issue] = []
    if any(token == "" for token in tokens):
        issues.append(
            Issue(
                code=UNPARSABLE_VALUE,
                message=f"“{text}”中存在空的名称位置，请补齐或改写后重新提交",
            )
        )
    return SequenceParse(
        cell=ParsedCell(raw_value=text, tokens=tokens, issues=tuple(issues)),
        values=list(tokens),
        issues=issues,
    )


# --- 日期 -------------------------------------------------------------------


def parse_date_sequence(raw_value: object) -> SequenceParse:
    """按完整日期语法切分日期序列。

    日期里本身带 `/` 或 `-`，所以不能先按分隔符拆。做法是反复从当前位置匹配
    一个完整日期，跳过日期之间的分隔符，最后要求消费掉全部字符：

    - `2026/09/01`            → 一个日期
    - `2026/09/01/2026/09/15` → 两个日期
    - `9/1/9/15`              → 缺少年份，阻断
    - `2026-02-30`            → 日期不存在，阻断
    """
    if raw_value in (None, ""):
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[])
    if isinstance(raw_value, datetime):
        value = raw_value.date()
        return SequenceParse(
            cell=ParsedCell(raw_value=value.isoformat(), tokens=(value.isoformat(),)),
            values=[value],
        )
    if isinstance(raw_value, date):
        text_value = raw_value.isoformat()
        return SequenceParse(
            cell=ParsedCell(raw_value=text_value, tokens=(text_value,)),
            values=[raw_value],
        )

    text = _as_text(raw_value)
    if not text:
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[])

    parsed: list[date] = []
    tokens: list[str] = []
    position = 0
    remainder = text
    while position < len(text):
        skipped = _TRAILING_SEPARATORS.match(text, position)
        if skipped:
            position = skipped.end()
            continue
        if text[position].isspace():
            position += 1
            continue
        match = _DATE_TOKEN.match(text, position)
        if not match:
            break
        year, month, day = (int(group) for group in match.groups())
        try:
            value = date(year, month, day)
        except ValueError:
            return SequenceParse(
                cell=ParsedCell(raw_value=text, tokens=tuple(tokens)),
                values=parsed,
                issues=[
                    Issue(
                        code=AMBIGUOUS_DATE_SEQUENCE,
                        message=f"“{match.group(0)}”不是有效日期，请核对后重新填写",
                    )
                ],
            )
        parsed.append(value)
        tokens.append(match.group(0))
        position = match.end()

    remainder = text[position:].strip()
    if remainder and remainder.strip(NAME_SEPARATORS):
        return SequenceParse(
            cell=ParsedCell(raw_value=text, tokens=tuple(tokens)),
            values=parsed,
            issues=[
                Issue(
                    code=AMBIGUOUS_DATE_SEQUENCE,
                    message=(
                        f"“{text}”无法唯一拆分为日期序列（剩余片段“{remainder}”）；"
                        "日期之间请用 /、逗号或分号分隔，并写全四位年份"
                    ),
                )
            ],
        )
    if not parsed:
        return SequenceParse(
            cell=ParsedCell(raw_value=text, tokens=()),
            values=[],
            issues=[
                Issue(
                    code=AMBIGUOUS_DATE_SEQUENCE,
                    message=f"“{text}”不是可识别的日期，请写成 YYYY-MM-DD 或 YYYY/MM/DD",
                )
            ],
        )
    return SequenceParse(
        cell=ParsedCell(raw_value=text, tokens=tuple(tokens)), values=parsed
    )


# --- 金额 -------------------------------------------------------------------


def _parse_amount_token(token: str) -> Decimal | None:
    cleaned = token.replace(",", "").replace("，", "").replace(" ", "")
    if cleaned == "":
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def parse_amount_sequence(raw_value: object) -> SequenceParse:
    """金额序列。金额 0 是有效值，不能当成空值过滤掉。"""
    if raw_value in (None, ""):
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[])
    if isinstance(raw_value, (int, float, Decimal)):
        value = Decimal(str(raw_value))
        return SequenceParse(
            cell=ParsedCell(raw_value=str(value), tokens=(str(value),)), values=[value]
        )

    text = _as_text(raw_value)
    tokens = tuple(_split(raw_value, VALUE_SEPARATORS))
    values: list[Decimal] = []
    issues: list[Issue] = []
    for token in tokens:
        if token == "":
            values.append(Decimal(0))
            continue
        amount = _parse_amount_token(token)
        if amount is None:
            issues.append(
                Issue(code=UNPARSABLE_VALUE, message=f"“{token}”不是有效金额，请核对后重新填写")
            )
            continue
        values.append(amount)
    return SequenceParse(
        cell=ParsedCell(raw_value=text, tokens=tokens, issues=tuple(issues)),
        values=values,
        issues=issues,
    )


# --- 票据 / 凭证号 ----------------------------------------------------------


def parse_document_sequence(raw_value: object) -> SequenceParse:
    """票据号序列。中间空位必须保留（票1//票3 是三个位置），不复制到每一期。"""
    text = _as_text(raw_value)
    if not text:
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[])
    tokens = tuple(_split(raw_value, VALUE_SEPARATORS))
    return SequenceParse(
        cell=ParsedCell(raw_value=text, tokens=tokens), values=list(tokens)
    )


# --- 期次配对 ---------------------------------------------------------------


def build_phases(
    *,
    date_cell: object,
    amount_cell: object,
    document_cell: object,
    columns: tuple[str, ...] = (),
    sheet: str | None = None,
    row: int | None = None,
) -> tuple[list[Phase], list[Issue]]:
    """把「日期 / 金额 / 票据」三个单元格按位置配对成一期期财务记录。

    - 日期与金额数量一致 → 逐期配对；
    - 多个日期配单一金额 → `AMOUNT_SPLIT_REQUIRED`，绝不平摊；
    - 数量对不上 → `PHASE_COUNT_MISMATCH`；
    - 票据数量不足或过多 → 要求补齐位置，不把票号复制到每一期。
    """
    dates = parse_date_sequence(date_cell)
    amounts = parse_amount_sequence(amount_cell)
    documents = parse_document_sequence(document_cell)

    issues: list[Issue] = []
    for parsed in (dates, amounts, documents):
        issues.extend(parsed.issues)

    def _locate(items: list[Issue]) -> list[Issue]:
        return [issue.with_location(sheet=sheet, row=row, columns=columns) for issue in items]

    if dates.blocking or amounts.blocking:
        return [], _locate(issues)

    date_values = list(dates.values)
    amount_values = list(amounts.values)
    if not date_values:
        if amount_values:
            issues.append(
                Issue(
                    code=PHASE_COUNT_MISMATCH,
                    message="填了金额却没有对应日期，请补齐日期",
                )
            )
        return [], _locate(issues)

    if len(amount_values) == 1 and len(date_values) > 1:
        issues.append(
            Issue(
                code=AMOUNT_SPLIT_REQUIRED,
                message=(
                    f"有 {len(date_values)} 个日期但只有一个金额，必须人工确认每期金额；"
                    "系统不会自动平均分摊，也不会把合计复制给每一期"
                ),
            )
        )
        return [], _locate(issues)

    if len(amount_values) != len(date_values):
        issues.append(
            Issue(
                code=PHASE_COUNT_MISMATCH,
                message=(
                    f"日期 {len(date_values)} 个、金额 {len(amount_values)} 个，数量不一致，"
                    "请补齐或删减后重新提交"
                ),
            )
        )
        return [], _locate(issues)

    document_values = list(documents.values)
    if documents.cell.tokens and len(document_values) != len(date_values):
        issues.append(
            Issue(
                code=PHASE_COUNT_MISMATCH,
                message=(
                    f"日期金额 {len(date_values)} 期，票据号 {len(document_values)} 个，"
                    "请按位置补齐（不足的位置保留空位，不要复制到每一期）"
                ),
            )
        )
        return [], _locate(issues)

    phases = [
        Phase(
            source_columns=columns,
            source_position=index + 1,
            date=date_values[index],
            amount=amount_values[index],
            document_no=document_values[index] if index < len(document_values) else None,
        )
        for index in range(len(date_values))
    ]
    return phases, _locate(issues)


def validate_manual_split(
    raw_total: Decimal | None,
    parts: list[Decimal],
    *,
    correction_reason: str = "",
) -> list[Issue]:
    """人工分摊后的校验。

    原值明确是合计时，各期金额之和必须与合计一致。若用户确认原合计本身写错了，
    必须显式给出理由——不允许静默放行差额。
    """
    if raw_total is None:
        return []
    total = sum(parts, Decimal(0))
    if total == raw_total:
        return []
    if correction_reason.strip():
        return [
            Issue(
                code=AMOUNT_SPLIT_REQUIRED,
                message=(
                    f"已按“{correction_reason.strip()}”修正原合计 {raw_total} 为 {total}，"
                    "该修正已记录原值与理由"
                ),
                blocking=False,
            )
        ]
    return [
        Issue(
            code=AMOUNT_SPLIT_REQUIRED,
            message=(
                f"各期金额之和 {total} 与原合计 {raw_total} 不一致；"
                "请核对分摊结果，若原合计本身有误请填写修正理由"
            ),
        )
    ]


# --- 负责人历史 -------------------------------------------------------------


@dataclass
class ManagerHistoryOutcome:
    """同一框架项目下负责人单元格的归一结果。"""

    current: str | None
    history: list[str]
    issues: list[Issue] = field(default_factory=list)

    @property
    def blocking(self) -> bool:
        return any(issue.blocking for issue in self.issues)


def merge_chain_sequences(
    chains: list[list[str]],
    *,
    what: str,
    key: str = "",
    entity: str = "",
    current_conflict_code: str = CURRENT_MANAGER_CONFLICT,
    history_conflict_code: str = ORDER_HISTORY_CONFLICT,
) -> tuple[list[str] | None, list[Issue]]:
    """把同一实体（一个框架的负责人 / 一个订单的别名）的多条链归一。

    规则（服务层与解析层共用，保证预检与写库判断一致）：

    - 各行完全相同 → 归一，最后一个是当前值；
    - 当前值不同 → 阻断，**不按最后一行或第一行覆盖**；
    - 当前值相同但历史链条不同 → 阻断，要求人工确认（不按人名集合重排）。

    返回（归一后的链 或 None、问题列表）。
    """
    normalized = [tuple(str(item).strip() for item in chain) for chain in chains if chain]
    normalized = [chain for chain in normalized if any(chain)]
    if not normalized:
        return [], []

    distinct = list(dict.fromkeys(normalized))
    if len(distinct) == 1:
        return list(distinct[0]), []

    prefix = f"{entity} {key}".strip() if key else entity
    current_values = {chain[-1] for chain in distinct}
    if len(current_values) > 1:
        return None, [
            Issue(
                code=current_conflict_code,
                message=(
                    f"{prefix}的{what}在不同行填了不同的当前值"
                    f"（{ '、'.join(sorted(current_values)) }），"
                    "请核实是否为交接记录或填写错误，系统不会自动取某一行"
                ),
            )
        ]

    return None, [
        Issue(
            code=history_conflict_code,
            message=(
                f"{prefix}的{what}历史链条不一致"
                f"（{ ' | '.join('/'.join(chain) for chain in distinct) }），"
                "无法证明先后顺序，请人工确认后填写"
            ),
        )
    ]


def merge_manager_history(cells: list[object], *, project_code: str = "") -> ManagerHistoryOutcome:
    """把同一框架项目多行的负责人单元格合并成一条历史链。

    规则：
    - 各行解析出的序列**完全相同** → 归一，最后一个是现任；
    - 现任不同 → `CURRENT_MANAGER_CONFLICT`，阻断（不按最后一行覆盖）；
    - 现任相同但历史链条不同且无法证明顺序 → `ORDER_HISTORY_CONFLICT`，要求确认。
    """
    sequences: list[list[str]] = []
    issues: list[Issue] = []
    for cell in cells:
        parsed = parse_name_sequence(cell)
        issues.extend(parsed.issues)
        if parsed.values:
            sequences.append([str(item) for item in parsed.values])

    if not sequences:
        return ManagerHistoryOutcome(current=None, history=[], issues=issues)

    chain, merge_issues = merge_chain_sequences(
        sequences, what="客户经理", key=project_code, entity="项目"
    )
    if chain is None:
        return ManagerHistoryOutcome(current=None, history=[], issues=issues + merge_issues)
    return ManagerHistoryOutcome(current=chain[-1], history=chain, issues=issues)


def merge_order_number_history(cells: list[object], *, order_key: str = "") -> SequenceParse:
    """同一订单的订单号单元格合并：A/B/C 是同一次改号的别名序列，不是多个订单。

    现任（最后一个）不同 → 阻断；历史链条不同但现任相同 → 需要人工确认。
    """
    parsed_cells = [parse_name_sequence(cell) for cell in cells]
    sequences = [
        [str(item) for item in parsed.cell.tokens] for parsed in parsed_cells if parsed.cell.tokens
    ]
    issues: list[Issue] = []
    for parsed in parsed_cells:
        issues.extend(parsed.issues)

    if not sequences:
        return SequenceParse(cell=ParsedCell(raw_value="", tokens=()), values=[], issues=issues)

    chain, merge_issues = merge_chain_sequences(
        sequences,
        what="订单号",
        key=order_key,
        entity="订单",
        current_conflict_code=ORDER_ALIAS_CONFLICT,
    )
    if chain is None:
        return SequenceParse(
            cell=ParsedCell(raw_value="", tokens=()), values=[], issues=issues + merge_issues
        )
    return SequenceParse(
        cell=ParsedCell(raw_value=" / ".join(chain), tokens=tuple(chain), issues=tuple(issues)),
        values=chain,
        issues=issues,
    )
