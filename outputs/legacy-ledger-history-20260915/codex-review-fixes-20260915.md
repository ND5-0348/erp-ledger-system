# Codex 静态审查缺陷修复记录（2026-09-15）

代码修复提交：`c7519f7`（`codex/dashboard-filter-timezone`，未推送、未合并）。

本轮只修复 Codex 对 H2/H3 后端缺口提出的五类问题，未推进 H3 前端与 H4。
全部结论来自真实入口（预检 → 人工确认 → 提交；普通 `import-excel`）的测试，
不以辅助函数单元测试代替。所有测试数据为合成数据，使用 Task 0 的隔离数据库
`erp_ledger_test_*` 与系统临时目录下的备份根。

## 一、复现证据

命令（工作区 `D:\GitHub_WorkSpace\erp-ledger-system`）：

```powershell
$env:MYSQL_DATABASE = 'erp_ledger_test_readiness_20260915'
$env:BACKUP_ROOT = Join-Path $env:TEMP 'erp-ledger-readiness-20260915'
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_legacy_import_guards.py -q -p no:cacheprovider
```

| 阶段 | 结果 | 原始日志 |
| --- | --- | --- |
| 修复前 | `14 failed, 3 passed` | `codex-review-repro-before.txt` |
| 修复后 | `26 passed` | `codex-review-repro-after.txt` |

修复前的红灯逐条对应：

```
FAILED test_acknowledged_code_alone_does_not_unblock          # 只确认错误码就放行
FAILED test_split_total_mismatch_is_rejected                  # 合计不符仍接受确认
FAILED test_split_total_correction_records_reason_and_amounts # 修正不重新校验
FAILED test_phase_count_mismatch_revision_is_rejected         # 期次数不符仍接受
FAILED test_invalid_date_in_revision_is_rejected              # 无效日期仍接受
FAILED test_negative_amount_in_revision_is_rejected           # 负数金额仍接受
FAILED test_partial_finance_revision_keeps_other_groups       # 部分修正丢其他组
FAILED test_blank_row_in_middle_keeps_row_correspondence      # 空行导致后续行期次丢失
FAILED test_existing_history_survives_import_with_current_value_only  # 已确认别名被截短
FAILED test_multi_row_manager_chain_conflict_is_not_resolved_by_first_row
FAILED test_multi_row_order_chain_conflict_is_not_resolved_by_first_row
FAILED test_alias_conflict_with_another_order_blocks_whole_batch
FAILED test_plain_import_blocks_order_number_change
FAILED test_backup_failure_blocks_commit
```

## 二、逐条根因与修复

### 问题一：人工确认没有重新校验，仅凭错误码即可消除阻断

**根因**（`backend/app/legacy_import_service.py`）

1. `recompute_summary()` 从人工确认里读 `acknowledged_codes`/`acknowledged`/`codes`，
   直接把这些错误码从阻断集合中 `discard`——确认即放行，与内容无关。
2. `apply_resolutions()` 只写 JSON，没有重新解析、也没有重新执行任何校验
   （函数文档写的"重新执行全部校验"与实现不符）。
3. `validate_manual_split()` 从未被任何生产代码调用，是死代码：多日期单金额的
   分摊结果根本没校验合计。
4. `append_phases()` 直接 INSERT 业务表，绕过金额、日期、票据等既有规则。
5. 取值用 `resolution.get("finance") or parsed.get("finance")`——只要修正里出现
   finance，整份解析结果就被替换，未修改的财务组（如采购付款）直接丢失。

**修复**

- 新增 `backend/app/legacy_resolution.py`：人工确认改为结构化、强类型、禁止多余
  字段的模型（`PhaseRevision`/`FinanceRevision`/`ChainRevision`/`RowResolution`）。
  金额沿用 `Money`（非负、两位小数），日期沿用 `BusinessDate`（真实日期、年份≤2099）。
- `build_row_state()` 统一重算：被修正的组用确认值**重新执行**期次数、合计、日期、
  金额校验；未修正的组继续沿用解析阶段的问题。删除 `acknowledged_codes` 机制。
- `merge_finance()` 逐组覆盖：只替换被修正的组，其余组原样保留。
- 合计修正：原值由服务端从解析结果取值（不信任客户端），修正值为各期之和，
  必须填写理由；原值、修正值、理由、操作者、时间一并写入会话与审计。
- `apply_resolutions()` 对不合法的人工确认整次拒绝（422），不写半成品。

### 问题二：订单别名与冲突检查没有接入真实链路

**根因**

`conflicts_in_project()`、`find_order_by_number()` 只在 `backend/tests/test_ledger_history.py`
里被调用，生产代码零调用。普通导入与预检提交都不检查别名冲突；预检提交的
`register_histories()` 直接用链尾 `UPDATE sales_order SET order_no`，等于普通导入
可以自动改号。

**修复**

- 普通导入（`backend/app/importer.py`）：插入订单前用 `conflicts_in_project()`
  检查该编号是否已被同框架**另一个**订单的当前号或历史号占用，命中即整批阻断；
  订单号或客户经理单元格出现多值（改号链/交接链）时整批拒绝，提示走预检人工确认。
- 预检提交（`legacy_import_service.cross_row_issues()`）：按"共享任一订单号"把多行
  聚成同一订单，归一后再与库内比对——命中另一个订单的编号整批阻断，
  现任不同或链无法证明包含关系也阻断，并明确提示改号需走授权流程。
- 跨框架同号仍然合法（冲突判定限定在框架内），有链路测试覆盖。

### 问题三：历史链被覆盖、截短或按首行取值

**根因**

1. `register_histories()` 与 `register_order_numbers(prune=True)` 以"本次文件"
   为唯一真相：链变短就 `DELETE` 多余位置，新文件只填当前号时已确认的历史别名
   被整体删除。
2. `parse_row()` 逐行调用 `merge_*_history([单个单元格])`，跨行合并逻辑在真实
   链路里从未生效；提交时用 `seen_orders`/`seen_projects` 集合**只处理第一次
   遇到的那一行**，等于按首行取值。

**修复**

- 新增 `ledger_history.merge_chain()`：文件链与库内已确认链合并，只允许
  "原样保持"与"顺序可证明地补充"；现任不同、或两条链互不包含时阻断。
  子序列判断保留重复任职（甲→乙→甲 是三个位置）。
- `register_order_numbers()` / `register_manager_history()` 默认 `prune=False`
  （只补不删），并在链比库内更短时直接报错，防止误用造成截短。
- 预检会话按框架（负责人）与订单连通分量（别名）做**整份文件**的链归一，
  再与库内现状比对；不一致时不按首行、不按集合重排，直接阻断。

### 问题四：预检提交缺备份、审计与统一的财务校验

**根因**

`commit_session()` 没有导入前备份、没有操作日志；`append_phases()` 直接写表，
不经过任何业务校验。

**修复**

- `_commit_import_preview()` 与普通导入一致，先做 `pre_legacy_commit` 业务备份
  （独立事务、写锁内）；备份失败直接取消提交，不写任何业务数据。
- `append_phases()` 写库前对每一期执行 `phase_business_issues()`：金额非负、
  最多两位小数、不超上限，日期真实存在且年份≤2099，票据号长度受限；任一期
  不合法整批回滚。
- 提交成功写 `operation_log`（会话、文件摘要、成功/跳过行数、期次数、历史记录数），
  人工修正写 `resolve_legacy_import` 审计（操作者、时间、行号、合计原值/修正值/理由）。
  **原始业务行内容不进入日志。**
- 备份、业务写入、历史修改、会话状态同处一个写锁事务，任一步失败一起回滚；
  重复提交同一会话只返回原结果。

### 额外发现（同一批测试暴露）

**Excel 中间有空行时，空行之后所有行的财务期次整体丢失。**
`build_normalized_workbook()` 把非空行紧凑排列，而 `import_excel` 返回的
明细映射用的是**规范化后的行号**，`append_phases` 却按**原始行号**去查——
空行之后的行全部查不到自己的明细，期次与历史整段丢失。
修复：`build_normalized_workbook()` 返回"原始行号 → 规范化行号"映射，
写期次与历史都通过该映射定位明细。测试 `test_blank_row_in_middle_keeps_row_correspondence`。

## 三、H1 计划第 8 条（多期列展开）的实际状态

交接文档此前写"多期列展开未实现"，与代码不符。实际状态：

| 项 | 状态 |
| --- | --- |
| 标准模板第二组付款列（58/59/60）展开 | **已实现**，与第一组按"列组顺序、组内位置顺序"拼接 |
| 标准模板第二组回款列（83/84/85）展开 | **已实现**，同上 |
| 两组并存时期次顺序与金额对应 | **已实现**，测试 `test_second_group_merges_with_in_cell_multi_values`、`test_second_group_receipt_merges_with_in_cell_multi_values` |
| 到期付款日（54 列）不再让 importer 抢先写一条空期次 | **本轮修复**（54 列一并纳入规范化清空，由 append_phases 逐期写入） |
| 跨列组疑似重复（同日期同金额填在两处） | **本轮补上**：不去重、不双计，产出非阻断提示 `DUPLICATE_PHASE_SUSPECTED` 交人工确认 |
| 每个期次的"来源列组"记录 | **已实现**：`raw_sources` 与期次的 `source_column`/`source_group` |
| 真实旧表样本验收 | **仍未做**（无样本），解析规则只对合成样本负责 |
| H3 前端展示来源与疑似重复 | **未做**（H3 前端整体未开发） |

## 四、本轮未做（保持原状）

- H3 前端预检界面、H4 搜索/导出、H5 恢复整合、B/C/D 各阶段。
- 真实旧表格式诊断：分隔符集合、日期写法、旧表头名称仍未经真实样本核实。
- MySQL 8.4 兼容验证、两万条规模演练、浏览器交互验收。
- N-05 / B-05 两个既有失败仍未定位根因，断言未削弱，见
  `codex-review-after-full.txt` 的失败明细。
