# Codex 复审（第二轮）两项缺陷修复记录（2026-09-15）

本轮修复 Codex 复审发现的两项缺陷，未推进前端，未推送、未操作业务库。

## 一、复现证据

最小复现脚本（走真实入口：预检 → 人工确认 → 提交）：

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 修复前 | `python outputs/legacy-ledger-history-20260915/repro_codex2_before.py`（在 `c7519f7` 的只读工作树上执行） | `codex2-repro-before.txt` |
| 修复后 | `python outputs/legacy-ledger-history-20260915/repro_codex2_after.py` | `codex2-repro-after.txt` |

### 缺陷一：订单别名连通分组没有按框架隔离

修复前的输出：

```
summary: {'total_rows': 2, 'blocking_rows': 1, 'comparable': False}
cross_row_issues: ['订单的订单号在不同框架填了不同的当前值（SO-C、SO-D），…']
提交结果: 422 （期望 200）
落库订单数: 0 （期望 2）
```

同一文件里 `P-ONE : SO-A/SO-C` 与 `P-TWO : SO-A/SO-D` 只是共享编号 `A`，
按业务规则**跨框架允许同号**，却因为连通分量在全部行上做而被并成一条链，
进而误报"当前值不一致"并整批阻断。

修复后的输出：

```
summary: {'total_rows': 2, 'blocking_rows': 0, 'comparable': True}
cross_row_issues: []
提交结果: 200 ；落库订单数: 2
归属: [('P-ONE', 'SO-C'), ('P-TWO', 'SO-D')]
别名链归属: [('P-ONE','SO-A'), ('P-ONE','SO-C'), ('P-TWO','SO-A'), ('P-TWO','SO-D')]
```

### 缺陷二：多来源财务组的金额没有按来源组核对

场景：第一组付款列（55–57）写两个日期 + 单一金额 `300`，第二组付款列
（58–60）写单值 `50`。第一组需要人工分摊。

修复前的输出：

```
正确拆分 100+200+50 的确认结果: 422 （期望 200）
  详情: …各期金额之和 350.00 与原合计 300 不一致…
漏掉第二组的确认结果: 200 （期望 422）
  详情: None
```

`original_single_total()` 只取**第一个**"多日期单金额"来源组的合计（300），
却与**全部来源组**的期次总和（350）比较：正确的 350 被拒绝，而漏掉第二组、
总和恰好等于 300 的错误数据被放行。

修复后的输出：

```
正确拆分 100+200+50 的确认结果: 200 ；提交结果: 200
落库期次: [(1,'2026-01-05','PAY-1','100.00'), (2,'2026-02-05','PAY-2','200.00'), (3,'2026-03-05','PAY-3','50.00')]
漏掉第二组的确认结果: 422
  详情: 采购付款第 2 个来源列组原表有 1 个日期，人工确认填了 0 期，请按期补齐
第二组金额填错的确认结果: 422
  详情: 采购付款第 2 个来源列组各期金额之和 30.00 与原合计 50 不一致…
```

## 二、根因与修复

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| 一 | `_order_components()` 在全部行上做连通分量，没有按 `project_code` 隔离 | 重命名并改写为 `order_components()`：先按框架分组，再在框架内做连通分量；没有项目编号的行各自成组（`backend/app/legacy_import_service.py`） |
| 二 | `original_single_total()` 跨来源组取第一个合计，与全部期次总和比较 | 改为 `source_amount_total()`：只在**本来源列组内部**求和；`validate_finance_revision()` 逐组核对期次数与本组合计，并要求人工确认的每一期声明 `source_group`（`backend/app/legacy_resolution.py`） |

### 人工确认协议的变化

`PhaseRevision` 新增必填字段 `source_group`（1 起，按模板列组顺序）：

```json
{"source_group": 1, "date": "2026-01-05", "amount": "100.00", "document_no": "PAY-1"}
```

逐组核对规则：

1. 每个来源列组的期次数必须等于该组原始日期数（该组日期无法解析时才跳过数量核对）；
2. 每个来源列组内各期金额之和必须等于**该组自己的**原始金额合计；不一致时必须给出
   修正理由，原值、修正值、理由、操作者、时间一并记录；
3. 期次必须按来源列组顺序排列，不得引用原表不存在的来源列组。

## 三、顺带修复的解析缺陷

复现过程中发现：Excel 日期单元格读出来是 `datetime`，`str()` 之后带 ` 00:00:00`，
`parse_date_sequence()` 把尾部时间视为"无法唯一拆分"，于是**第二组付款的日期
被判为无法解析**（`source_expected_count` 返回 None，跳过核对）。

修复：

- `parse_date_sequence()` 的日期 token 支持尾部时间（`2026-03-05 00:00:00`、
  `2026-03-05T00:00:00`、`2026/03/05 00:00:00`），它们仍是**同一个日期**；
  注意日与时间之间必须用可选组而不是 `\s*`，否则贪婪的空格会吃掉分隔符。
- 预检会话的 `_text()` 对日期类值统一输出 ISO 日期，原值展示与再次解析一致。

## 四、测试

| 文件 | 内容 |
| --- | --- |
| `backend/tests/test_legacy_resolution.py`（新增，19 个纯函数用例） | 按来源组分别核对合计、漏组拒绝、组内金额不符拒绝、单组修正理由、来源组顺序、未知来源组、无法解析组的处理、合并保留未修正组 |
| `backend/tests/test_legacy_import_guards.py`（新增 5 个入口用例） | 跨框架同号不被误报（含落库归属与别名链归属）、正确拆分通过并落库三期、漏组拒绝且无写入、组内金额错拒绝、单组合计修正带理由 |
| `backend/tests/test_legacy_ledger_parser.py`（新增 5 个纯函数用例） | Excel datetime 字符串是同一个日期、多日期带时间部分正确拆分 |

命令与结果：

```powershell
$env:MYSQL_DATABASE = 'erp_ledger_test_readiness_20260915'
$env:BACKUP_ROOT = Join-Path $env:TEMP 'erp-ledger-readiness-20260915'
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q -p no:cacheprovider
# 2 failed, 295 passed, 1 skipped —— 两个失败仍是既有的 N-05 / B-05
```

N-05 / B-05 的失败断言与第一轮基线逐字一致，未削弱。

## 五、仍未做

- H3 前端预检界面、H4、H5、B/C/D 与改号入口（同上一轮，边界未变）。
- 真实旧表样本验收、浏览器交互验收、MySQL 8.4、两万条演练。
