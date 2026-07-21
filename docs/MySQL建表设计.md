# MySQL 建表设计

## 1. 适用范围

- 当前运行环境：Python 3.8、MySQL 5.7.21。
- 当前字段基线：`台账字段说明0716.xlsx` 的 B 列；D 列作为调整说明；E 列本期不处理。
- 可执行建表脚本以 `docs/erp_ledger_schema.sql` 为唯一准则，本文件说明业务拆表、迁移和计算口径。
- 字符集使用 `utf8mb4`，排序规则使用 MySQL 5.7 可用的 `utf8mb4_general_ci`。
- 金额使用 `DECIMAL(18,2)`，数量使用 `DECIMAL(20,6)`，单价使用 `DECIMAL(18,6)`，税率和比例使用 `DECIMAL(10,6)`。

## 2. 当前表结构

| 表名 | 中文名称 | 主要职责 |
| --- | --- | --- |
| `import_batch` | 导入批次 | 保存文件、工作表、成功/失败行数和状态 |
| `ledger_raw_row` | 原始台账行 | 保存原始 JSON、行号和哈希，支持导入追溯 |
| `erp_user` | 系统用户 | 登录、角色、部门范围和状态 |
| `operation_log` | 操作日志 | 保存增删改、导入、备份等审计记录 |
| `backup_record` | 备份记录 | 保存备份文件、时间、类型和结果 |
| `project` | 项目 | 项目编号、项目名称、部门、客户和负责人 |
| `sales_order` | 销售订单 | 销售订单号、日期、业务类型、统计类别和关闭状态 |
| `order_line` | 订单明细 | 物资/服务、数量、销售税率、销售单价和销售金额 |
| `purchase_info` | 采购信息 | 采购厂商、采购税率、采购单价、采购金额及预留成本 |
| `delivery_record` | 交付记录 | 交付数量、交付金额和待交付金额 |
| `purchase_contract` | 采购合同 | 合同号、付款期限、履行期限及签订金额 |
| `purchase_invoice` | 采购收票 | 多期收票日期、发票号码和收票金额 |
| `warehouse_entry` | 入库记录 | 多期入库日期、凭证、含税及不含税成本 |
| `finance_invoice_check` | 财务发票校验 | 多期财务收票校验和凭证编码 |
| `finance_payment_entry` | 财务入账付款 | 多期财务付款日期、凭证编码和入账金额 |
| `purchase_payment` | 采购付款 | 多期到期日、付款日期、凭证和付款金额 |
| `sales_contract` | 销售合同 | 合同签订日期、合同号、合同金额和履行期限 |
| `sales_invoice` | 销售开票 | 多期开票单据、日期、发票号和金额 |
| `sales_receipt` | 销售回款 | 多期回款日期、缴款单、金额和占比 |

## 3. 主外键关系

1. `project.id -> sales_order.project_id`：一个项目可有多个销售订单。
2. `sales_order.id -> order_line.sales_order_id`：一个销售订单可有多条明细。
3. `ledger_raw_row.id -> order_line.raw_row_id`：导入明细可回溯原始 Excel 行。
4. `order_line.id` 是采购、交付、合同、发票、入库、付款和回款表的统一业务外键。
5. `purchase_info.order_line_id` 有唯一约束，按一条明细一份采购主信息使用。
6. 多期表使用 `phase_no`；`active_phase_no` 是由 `deleted_at` 生成的列，并与 `order_line_id` 组成唯一键。

多期表包括：

- `purchase_invoice`
- `warehouse_entry`
- `finance_invoice_check`
- `finance_payment_entry`
- `purchase_payment`
- `sales_invoice`
- `sales_receipt`

应用层限制上述业务明细最多录入 20 期。

## 4. 0716 新增及调整字段

### 4.1 销售税率和金额

| 最新字段 | 数据库字段 | 规则 |
| --- | --- | --- |
| 销售税率 | `order_line.sales_tax_rate` | 按百分数保存，`13` 表示 13% |
| 不含税销售单价 | `order_line.sales_unit_price_no_tax` | 可录入，保留 6 位小数 |
| 销售单价 | `order_line.sales_unit_price` | 有税率时由不含税销售单价自动计算 |
| 不含税订单金额 | `order_line.revenue_no_tax` | 数量乘不含税销售单价，保留 2 位小数 |
| 销售订单金额 | `order_line.order_value` | 数量乘销售单价，保留 2 位小数 |
| 销售税金 | `v_order_line_finance.sales_tax_amount` | 销售订单金额减不含税订单金额 |

### 4.2 采购税率和预留成本

| 最新字段 | 数据库字段 | 规则 |
| --- | --- | --- |
| 采购税率 | `purchase_info.purchase_tax_rate` | 按百分数保存，`13` 表示 13% |
| 不含税采购单价 | `purchase_info.purchase_unit_price_no_tax` | 可录入，保留 6 位小数 |
| 采购单价 | `purchase_info.purchase_unit_price` | 有税率时由不含税采购单价自动计算 |
| 不含税采购金额 | `purchase_info.cost_no_tax` | 数量乘不含税采购单价，保留 2 位小数 |
| 含税采购金额 | `purchase_info.purchase_amount` | 数量乘采购单价，保留 2 位小数 |
| 采购税金 | `v_order_line_finance.purchase_tax_amount` | 含税采购金额减不含税采购金额 |
| 人工成本 | `purchase_info.labor_cost` | 预留字段，暂不参与利润计算 |
| 其他成本 | `purchase_info.other_cost` | 预留字段，暂不参与利润计算 |

### 4.3 入库和财务付款

| 最新字段 | 数据库字段 | 说明 |
| --- | --- | --- |
| 入库成本金额（含税） | `warehouse_entry.warehouse_amount` | 市场侧录入 |
| 入库成本（不含税） | `warehouse_entry.warehouse_amount_no_tax` | 财务侧录入 |
| 财务付款日期 | `finance_payment_entry.payment_date` | 与采购付款记录独立 |
| 财务凭证编码 | `finance_payment_entry.voucher_code` | 与采购付款凭证独立 |
| 财务入账金额 | `finance_payment_entry.booked_amount` | 用于财务账面应付计算 |

## 5. 自动计算口径

仅当对应税率存在时，订单新增、订单修改和最新版 Excel 导入执行税率联动；未提供税率的历史数据保持原值，避免迁移时被覆盖。

```text
销售单价 = 不含税销售单价 * (1 + 销售税率 / 100)
不含税订单金额 = 数量 * 不含税销售单价
销售订单金额 = 数量 * 销售单价
销售税金 = 销售订单金额 - 不含税订单金额

采购单价 = 不含税采购单价 * (1 + 采购税率 / 100)
不含税采购金额 = 数量 * 不含税采购单价
含税采购金额 = 数量 * 采购单价
采购税金 = 含税采购金额 - 不含税采购金额

待交付数量 = 数量 - 交付数量
待交付金额（不含税） = 不含税订单金额 - 交付不含税收入
待交付金额 = 销售订单金额 - 交付价值

财务付款金额 = finance_payment_entry.booked_amount 有效记录合计
应付账款（财务账面） = 含税采购金额 - 财务付款金额
采购付款金额 = purchase_payment.payment_amount 有效记录合计
应付账款（自动） = 含税采购金额 - 采购付款金额

不含税毛利润 = 不含税订单金额 - 不含税采购金额
不含税毛利率 = 不含税毛利润 / 不含税订单金额 * 100
回款合计 = sales_receipt.receipt_amount 有效记录合计
应收款 = 销售订单金额 - 回款合计
是否关闭 = 应收款为 0 时 closed，否则 open
```

人工成本和其他成本本期只保存、展示和汇总，不进入不含税毛利润或含税毛利润公式。

## 6. 视图

### `v_order_line_finance`

按订单明细输出销售/采购税率、单价、金额、税金、预留成本、交付、合同以及财务聚合值。关键聚合字段：

- `total_finance_checked`：财务发票校验金额合计。
- `total_finance_paid`：财务入账金额合计。
- `financial_accounts_payable`：含税采购金额减财务入账金额。
- `total_paid`：采购付款金额合计。
- `accounts_payable`：含税采购金额减采购付款金额。
- `sales_invoice_amount`：销售开票金额合计。
- `total_received`：销售回款合计。
- `accounts_receivable`：销售订单金额减销售回款合计。

### `v_project_ledger_summary` 和 `v_order_ledger_summary`

分别按项目和销售订单汇总金额、回款、两套应付口径、毛利润、人工成本和其他成本。

## 7. 运行时迁移

后端启动时按以下顺序执行：

1. 执行 `CREATE TABLE IF NOT EXISTS`，创建新增表 `finance_payment_entry`。
2. 为旧库补充 `order_line.sales_tax_rate`。
3. 为旧库补充 `purchase_info.purchase_tax_rate`、`labor_cost`、`other_cost`。
4. 为旧库补充 `warehouse_entry.warehouse_amount_no_tax`。
5. 校正数量列为 `DECIMAL(20,6)`。
6. 为多期表补充生成列和有效期次唯一索引。
7. 在字段迁移完成后重建三个财务视图。

运行时迁移只增加字段、表、索引和重建视图，不清空或重导现有订单数据。

## 8. Excel 导入兼容

- 最新布局通过 `销售税率`、`采购税率` 或 `物资/服务名称` 表头识别。
- 最新布局按 96 个 B 列字段列位解析，旧布局继续使用原列位。
- Excel 百分比内部值 `0.13` 会转换为系统百分数 `13`；文本/数字 `13` 保持为 `13`。
- 最新布局导入一期、二期财务发票校验和财务入账付款；后续期次通过前端录入。
- E 列的 ABCDE 值本期全部忽略，不写入数据库、不参与计算。
- 完整逐字段关系见 `docs/台账字段映射_2026-07-21.md`。
