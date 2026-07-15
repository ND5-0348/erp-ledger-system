# MySQL 建表设计

## 1. 设计原则

- MySQL 版本按当前本机 5.7.21 设计并验证，字符集使用 `utf8mb4`。
- 多期业务表使用 MySQL 5.7 支持的生成列和唯一索引实现有效期次并发保护。
- Excel 是初始数据源，数据库要保留原始导入行，避免解析后的结构表与原台账无法核对。
- 业务表按订单主线拆分：订单基础信息、订单行、采购、交付、采购合同、收票入库、付款、销售合同、开票、回款。
- 不单独建设客户管理和供应商管理模块，客户单位、采购厂商作为业务字段保存。
- Excel 中重复列名按业务上下文拆分，例如采购合同号和销售合同号、一期付款和二期付款、一期回款和二期回款。

## 2. 数据源概览

| 文件 | 工作表 | 用途 |
| --- | --- | --- |
| `2026年市场部业务台账.xlsx` | `供应链公司业务2026` | 主业务明细，87 列，491 条有效业务行 |
| `2026年市场部业务台账.xlsx` | `历年决算进度` | 历年决算汇总，可作为后续报表数据源 |
| `台账字段说明0512.xlsx` | `Sheet1` | 字段分组、字段类型、公式说明 |

主台账当前主要枚举：

| 字段 | 取值摘要 |
| --- | --- |
| 部门 | 科贸部、检维部、物流部 |
| 分公司 | 供应链 |
| 业务类型 | 非电商贸易、电商贸易、其他服务、基础物流、维修服务 |
| 统计类别 | 通服集采、小微ICT、DICT、双碳、物流服务、运输、维修服务、非电商贸易、基差类、其他服务 |
| 全额/净额 | 全额、净额 |
| 是否关闭 | 当前 Excel 中出现“关闭” |

## 3. 表清单

| 表名 | 中文名 | 说明 |
| --- | --- | --- |
| `import_batch` | 导入批次 | 记录 Excel 上传、解析和回滚状态 |
| `ledger_raw_row` | 原始台账行 | 保存每一行原始 JSON |
| `erp_user` | 用户 | 登录和权限 |
| `operation_log` | 操作日志 | 系统操作留痕 |
| `backup_record` | 备份记录 | 系统备份信息 |
| `project_order` | 项目订单 | 项目、客户、部门、订单头 |
| `order_line` | 订单明细 | 货物、数量、售价、订单金额 |
| `purchase_info` | 采购信息 | 采购厂商、采购单价、采购金额 |
| `delivery_record` | 交付记录 | 交付日期、数量、金额、待交付 |
| `purchase_contract` | 采购合同 | 采购合同号、付款/履行期限、签订金额 |
| `purchase_invoice` | 采购收票 | 收票日期、发票号、收票金额 |
| `warehouse_entry` | 入库记录 | 入库日期、凭证号、入库金额 |
| `finance_invoice_check` | 财务发票校验 | 一期/二期发票校验和入账凭证 |
| `purchase_payment` | 采购付款 | 一期/二期付款日期、凭证和金额 |
| `sales_contract` | 销售合同 | 销售合同号、签订日期、合同价值 |
| `sales_invoice` | 销售开票 | 开票单据、开票日期、发票号、金额 |
| `sales_receipt` | 销售回款 | 一期/二期回款日期、缴款单、金额 |

## 4. 建库语句

```sql
CREATE DATABASE IF NOT EXISTS erp_ledger
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE erp_ledger;
```

## 5. 通用字段约定

所有业务表包含以下字段：

```sql
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
deleted_at DATETIME NULL
```

金额字段统一使用：

```sql
DECIMAL(18,2)
```

比例字段统一使用：

```sql
DECIMAL(10,6)
```

## 6. 系统与导入表

### 6.1 import_batch

```sql
CREATE TABLE import_batch (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_file_name VARCHAR(255) NOT NULL,
  source_sheet_name VARCHAR(128) NOT NULL,
  header_row_no INT NOT NULL DEFAULT 3,
  data_start_row_no INT NOT NULL DEFAULT 5,
  total_rows INT NOT NULL DEFAULT 0,
  success_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  status ENUM('pending','parsing','completed','failed','rolled_back') NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

### 6.2 ledger_raw_row

```sql
CREATE TABLE ledger_raw_row (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  import_batch_id BIGINT UNSIGNED NOT NULL,
  excel_row_no INT NOT NULL,
  row_hash CHAR(64) NOT NULL,
  raw_json JSON NOT NULL,
  parse_status ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  parse_message TEXT NULL,
  project_code VARCHAR(64) NULL,
  order_no VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_batch_row (import_batch_id, excel_row_no),
  KEY idx_raw_project_order (project_code, order_no),
  CONSTRAINT fk_raw_batch FOREIGN KEY (import_batch_id) REFERENCES import_batch(id)
) ENGINE=InnoDB;
```

### 6.3 erp_user

```sql
CREATE TABLE erp_user (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role ENUM('admin','business','purchase','finance','viewer') NOT NULL DEFAULT 'viewer',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_username (username)
) ENGINE=InnoDB;
```

### 6.4 operation_log

```sql
CREATE TABLE operation_log (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  user_name VARCHAR(64) NULL,
  module_name VARCHAR(64) NOT NULL,
  action_name VARCHAR(64) NOT NULL,
  detail TEXT NOT NULL,
  status ENUM('success','failed','running') NOT NULL DEFAULT 'success',
  request_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_log_time (created_at),
  KEY idx_log_module (module_name, action_name),
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES erp_user(id)
) ENGINE=InnoDB;
```

### 6.5 backup_record

```sql
CREATE TABLE backup_record (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  file_size_label VARCHAR(32) NULL,
  storage_path VARCHAR(500) NULL,
  backup_type ENUM('auto','manual') NOT NULL DEFAULT 'manual',
  status ENUM('success','failed','running') NOT NULL DEFAULT 'success',
  created_by BIGINT UNSIGNED NULL,
  backup_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_backup_time (backup_time),
  CONSTRAINT fk_backup_user FOREIGN KEY (created_by) REFERENCES erp_user(id)
) ENGINE=InnoDB;
```

## 7. 业务主线表

### 7.1 project_order

保存项目和订单头。Excel 中同一项目编号可能对应多条订单行，因此项目订单表只保存头部维度字段。

```sql
CREATE TABLE project_order (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  import_batch_id BIGINT UNSIGNED NULL,
  source_excel_row_no INT NULL,
  gross_net_type ENUM('全额','净额') NULL,
  project_code VARCHAR(64) NOT NULL,
  department VARCHAR(64) NULL,
  branch_company VARCHAR(64) NULL,
  account_manager VARCHAR(64) NULL,
  order_date DATE NULL,
  business_type VARCHAR(64) NULL,
  statistic_category VARCHAR(64) NULL,
  team_level3_name VARCHAR(128) NULL,
  customer_unit_name VARCHAR(255) NULL,
  end_user_name VARCHAR(255) NULL,
  regional_platform VARCHAR(128) NULL,
  order_no VARCHAR(64) NOT NULL,
  project_name VARCHAR(255) NULL,
  close_status VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_project_order (project_code, order_no),
  KEY idx_order_query (department, account_manager, order_date),
  KEY idx_order_customer (customer_unit_name),
  CONSTRAINT fk_order_batch FOREIGN KEY (import_batch_id) REFERENCES import_batch(id)
) ENGINE=InnoDB;
```

### 7.2 order_line

```sql
CREATE TABLE order_line (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  project_order_id BIGINT UNSIGNED NOT NULL,
  source_excel_row_no INT NULL,
  goods_name VARCHAR(255) NULL,
  specification_model VARCHAR(255) NULL,
  unit_name VARCHAR(32) NULL,
  quantity DECIMAL(20,6) NULL,
  sales_tax_rate DECIMAL(10,6) NULL,
  sales_unit_price_no_tax DECIMAL(18,6) NULL,
  sales_unit_price DECIMAL(18,6) NULL,
  revenue_no_tax DECIMAL(18,2) NULL,
  order_value DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_line_order (project_order_id),
  KEY idx_line_goods (goods_name),
  CONSTRAINT fk_line_order FOREIGN KEY (project_order_id) REFERENCES project_order(id)
) ENGINE=InnoDB;
```

### 7.3 purchase_info

```sql
CREATE TABLE purchase_info (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  supplier_name VARCHAR(255) NULL,
  purchase_tax_rate DECIMAL(10,6) NULL,
  purchase_unit_price_no_tax DECIMAL(18,6) NULL,
  purchase_unit_price DECIMAL(18,6) NULL,
  cost_no_tax DECIMAL(18,2) NULL,
  purchase_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_purchase_line (order_line_id),
  KEY idx_purchase_supplier (supplier_name),
  CONSTRAINT fk_purchase_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 7.4 delivery_record

```sql
CREATE TABLE delivery_record (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  delivery_date DATE NULL,
  delivery_quantity DECIMAL(20,6) NULL,
  delivery_revenue_no_tax DECIMAL(18,2) NULL,
  delivery_value DECIMAL(18,2) NULL,
  delivery_cost_no_tax DECIMAL(18,2) NULL,
  delivery_cost DECIMAL(18,2) NULL,
  pending_delivery_quantity DECIMAL(20,6) NULL,
  pending_delivery_amount_no_tax DECIMAL(18,2) NULL,
  pending_delivery_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_delivery_line (order_line_id),
  KEY idx_delivery_date (delivery_date),
  CONSTRAINT fk_delivery_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

## 8. 采购与应付表

### 8.1 purchase_contract

```sql
CREATE TABLE purchase_contract (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  purchase_contract_no VARCHAR(64) NULL,
  payment_terms VARCHAR(255) NULL,
  performance_period VARCHAR(255) NULL,
  signed_amount DECIMAL(18,2) NULL,
  unsigned_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_purchase_contract_no (purchase_contract_no),
  CONSTRAINT fk_purchase_contract_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 8.2 purchase_invoice

```sql
CREATE TABLE purchase_invoice (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  received_invoice_date DATE NULL,
  invoice_no VARCHAR(128) NULL,
  invoice_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_purchase_invoice_no (invoice_no),
  KEY idx_purchase_invoice_date (received_invoice_date),
  CONSTRAINT fk_purchase_invoice_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 8.3 warehouse_entry

```sql
CREATE TABLE warehouse_entry (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  warehouse_date DATE NULL,
  voucher_no VARCHAR(128) NULL,
  warehouse_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_warehouse_voucher (voucher_no),
  KEY idx_warehouse_date (warehouse_date),
  CONSTRAINT fk_warehouse_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 8.4 finance_invoice_check

`phase` 区分一期、二期财务发票校验。

```sql
CREATE TABLE finance_invoice_check (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase TINYINT UNSIGNED NOT NULL,
  received_invoice_date DATE NULL,
  received_invoice_amount DECIMAL(18,2) NULL,
  voucher_code VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_finance_invoice_phase (order_line_id, phase),
  KEY idx_finance_invoice_voucher (voucher_code),
  CONSTRAINT fk_finance_invoice_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 8.5 purchase_payment

`phase` 区分一期、二期付款。`due_payment_date` 主要用于一期付款到期日。

```sql
CREATE TABLE purchase_payment (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase TINYINT UNSIGNED NOT NULL,
  due_payment_date DATE NULL,
  payment_date DATE NULL,
  payment_voucher_no VARCHAR(128) NULL,
  payment_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_purchase_payment_phase (order_line_id, phase),
  KEY idx_purchase_payment_date (payment_date),
  KEY idx_purchase_payment_voucher (payment_voucher_no),
  CONSTRAINT fk_purchase_payment_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

## 9. 销售与应收表

### 9.1 sales_contract

```sql
CREATE TABLE sales_contract (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  contract_signed_date DATE NULL,
  sales_contract_no VARCHAR(64) NULL,
  contract_value DECIMAL(18,2) NULL,
  performance_period VARCHAR(255) NULL,
  unsigned_contract_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_sales_contract_no (sales_contract_no),
  KEY idx_sales_contract_date (contract_signed_date),
  CONSTRAINT fk_sales_contract_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

### 9.2 sales_invoice

```sql
CREATE TABLE sales_invoice (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  invoice_doc_no VARCHAR(128) NULL,
  invoice_date VARCHAR(255) NULL,
  invoice_no VARCHAR(128) NULL,
  invoice_amount DECIMAL(18,2) NULL,
  pending_invoice_amount DECIMAL(18,2) NULL,
  delivered_not_invoiced_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  KEY idx_sales_invoice_doc (invoice_doc_no),
  KEY idx_sales_invoice_no (invoice_no),
  CONSTRAINT fk_sales_invoice_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

说明：字段说明中开票日期可能出现多个日期，因此先用 `VARCHAR(255)` 保存原值，后续可拆成多条记录。

### 9.3 sales_receipt

`phase` 区分一期、二期回款。字段说明中回款日期可能出现多个日期，因此先用文本保存原值。

```sql
CREATE TABLE sales_receipt (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase TINYINT UNSIGNED NOT NULL,
  receipt_date VARCHAR(255) NULL,
  payment_notice_no VARCHAR(128) NULL,
  receipt_amount DECIMAL(18,2) NULL,
  receipt_ratio DECIMAL(10,6) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_sales_receipt_phase (order_line_id, phase),
  KEY idx_sales_receipt_notice (payment_notice_no),
  CONSTRAINT fk_sales_receipt_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB;
```

## 10. 汇总视图

### 10.1 v_ledger_summary

前端台账列表优先读取此视图。

```sql
CREATE OR REPLACE VIEW v_ledger_summary AS
SELECT
  po.project_code,
  po.order_no,
  po.department,
  po.account_manager,
  po.customer_unit_name,
  po.project_name,
  po.order_date,
  po.close_status,
  SUM(COALESCE(ol.order_value, 0)) AS order_amount,
  SUM(COALESCE(pi.purchase_amount, 0)) AS purchase_amount,
  SUM(COALESCE(sr_total.receipt_amount, 0)) AS total_received,
  SUM(COALESCE(ol.order_value, 0)) - SUM(COALESCE(sr_total.receipt_amount, 0)) AS accounts_receivable,
  SUM(COALESCE(ol.revenue_no_tax, 0)) - SUM(COALESCE(pi.cost_no_tax, 0)) AS gross_profit_no_tax,
  SUM(COALESCE(ol.order_value, 0)) - SUM(COALESCE(pi.purchase_amount, 0)) AS gross_profit
FROM project_order po
JOIN order_line ol ON ol.project_order_id = po.id AND ol.deleted_at IS NULL
LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(receipt_amount, 0)) AS receipt_amount
  FROM sales_receipt
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) sr_total ON sr_total.order_line_id = ol.id
WHERE po.deleted_at IS NULL
GROUP BY
  po.project_code,
  po.order_no,
  po.department,
  po.account_manager,
  po.customer_unit_name,
  po.project_name,
  po.order_date,
  po.close_status;
```

### 10.2 v_order_line_finance

后端详情页和导出可读取此视图。

```sql
CREATE OR REPLACE VIEW v_order_line_finance AS
SELECT
  po.project_code,
  po.order_no,
  po.department,
  po.branch_company,
  po.account_manager,
  po.order_date,
  po.business_type,
  po.statistic_category,
  po.customer_unit_name,
  po.project_name,
  po.close_status,
  ol.id AS order_line_id,
  ol.goods_name,
  ol.specification_model,
  ol.unit_name,
  ol.quantity,
  ol.order_value,
  pi.supplier_name,
  pi.purchase_amount,
  dr.delivery_quantity,
  dr.delivery_value,
  pc.purchase_contract_no,
  pc.signed_amount AS purchase_contract_signed_amount,
  sc.sales_contract_no,
  sc.contract_signed_date AS sales_contract_signed_date,
  sc.contract_value AS sales_contract_value,
  si.invoice_amount AS sales_invoice_amount,
  COALESCE(sr_total.receipt_amount, 0) AS total_received,
  COALESCE(pay_total.payment_amount, 0) AS total_paid,
  COALESCE(ol.order_value, 0) - COALESCE(sr_total.receipt_amount, 0) AS accounts_receivable,
  COALESCE(pi.purchase_amount, 0) - COALESCE(pay_total.payment_amount, 0) AS accounts_payable
FROM project_order po
JOIN order_line ol ON ol.project_order_id = po.id AND ol.deleted_at IS NULL
LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
LEFT JOIN delivery_record dr ON dr.order_line_id = ol.id AND dr.deleted_at IS NULL
LEFT JOIN purchase_contract pc ON pc.order_line_id = ol.id AND pc.deleted_at IS NULL
LEFT JOIN sales_contract sc ON sc.order_line_id = ol.id AND sc.deleted_at IS NULL
LEFT JOIN sales_invoice si ON si.order_line_id = ol.id AND si.deleted_at IS NULL
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(receipt_amount, 0)) AS receipt_amount
  FROM sales_receipt
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) sr_total ON sr_total.order_line_id = ol.id
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(payment_amount, 0)) AS payment_amount
  FROM purchase_payment
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) pay_total ON pay_total.order_line_id = ol.id
WHERE po.deleted_at IS NULL;
```

## 11. Excel 字段到数据表映射

| Excel 字段范围 | 目标表 |
| --- | --- |
| 全额/净额、项目编号、部门、分公司、客户经理、订单日期、业务类型、统计类别、三级团队名称、客户单位名称、用户、区域平台、订单号、项目名称、是否关闭 | `project_order` |
| 货物名称、规格型号、单位、数量、不含税单价、单价、不含税收入、订单价值 | `order_line` |
| 采购厂商、不含税采购单价、采购单价、不含税成本、采购金额 | `purchase_info` |
| 交付日期、交付数量、交付不含税收入、交付价值、交付不含税成本、交付成本、待交付数量、待交付金额 | `delivery_record` |
| 采购侧公司合同号、付款期限、履行期限、合同签订金额、待签合同金额 | `purchase_contract` |
| 收票日期、发票号码、收票金额 | `purchase_invoice` |
| 入库日期、凭证号、入库金额 | `warehouse_entry` |
| 财务入账一期/二期收票日期、金额、凭证编码 | `finance_invoice_check` |
| 到期付款日、付款日期、付款凭证号、付款金额 | `purchase_payment` |
| 不含税毛利润、税金、退税、毛利润、毛利率 | 视图计算字段，必要时可在 `order_line` 增加快照列 |
| 销售合同签订日期、销售侧公司合同号、合同价值、履行期限、待签合同金额 | `sales_contract` |
| 开票单据号、开票日期、发票号、发票金额、待开发票金额、已交付未开票 | `sales_invoice` |
| 一期/二期回款日期、缴款单号、回款金额、回款占比 | `sales_receipt` |
| 回款合计、应收款 | 视图计算字段 |

## 12. 索引建议

```sql
CREATE INDEX idx_project_order_project ON project_order(project_code);
CREATE INDEX idx_project_order_no ON project_order(order_no);
CREATE INDEX idx_project_order_date ON project_order(order_date);
CREATE INDEX idx_project_order_dept_manager ON project_order(department, account_manager);
CREATE INDEX idx_order_line_value ON order_line(order_value);
CREATE INDEX idx_purchase_amount ON purchase_info(purchase_amount);
CREATE INDEX idx_sales_contract_value ON sales_contract(contract_value);
CREATE INDEX idx_sales_invoice_amount ON sales_invoice(invoice_amount);
CREATE INDEX idx_sales_receipt_amount ON sales_receipt(receipt_amount);
```

## 13. 导入解析注意事项

- Excel 第 1 行是标题，第 2 行是分组，第 3 行是字段名，第 4 行是合计，第 5 行开始为明细。
- 重复字段不能直接按列名解析，必须按列位和业务分组解析。
- `开票日期`、`回款日期` 字段说明中提示可能存在多个日期，第一版保留文本原值。
- Excel 当前主表缺少显式 `销售税率`、`采购税率`、`不含税毛利率` 列名，但字段说明中有这些口径，导入程序应允许缺列并记录告警。
- 关闭状态当前为“关闭”，未关闭行可能为空；后端展示时可转换为 `closed/open` 或直接返回中文状态。

## 14. 与前端类型的最小适配

| 前端类型 | 后端来源 |
| --- | --- |
| `ProjectLedger.id` | `project_order.project_code` |
| `ProjectLedger.clientUnit` | `project_order.customer_unit_name` |
| `ProjectLedger.projectName` | `project_order.project_name` |
| `ProjectLedger.orderAmount` | `v_ledger_summary.order_amount` |
| `ProjectLedger.purchaseAmount` | `v_ledger_summary.purchase_amount` |
| `ProjectLedger.totalReceived` | `v_ledger_summary.total_received` |
| `ProjectLedger.department` | `project_order.department` |
| `ProjectLedger.manager` | `project_order.account_manager` |
| `ProjectLedger.orderId` | `project_order.order_no` |
| `ProjectLedger.orderStatus` | `project_order.close_status` 或后端状态映射 |
| `ProjectLedger.orderDate` | `project_order.order_date` |
| `OrderRecord` | `project_order` + `order_line` + `delivery_record` |
| `PurchaseRecord` | `project_order` + `purchase_info` + `purchase_contract` + `purchase_invoice` + `purchase_payment` |
| `SalesRecord` | `project_order` + `sales_contract` + `sales_invoice` |

## 15. 后续可选优化

- 将多日期开票、回款拆分为多条明细。
- 把客户单位、采购厂商沉淀为主数据表。
- 建立月度快照表，避免首页报表每次全量聚合。
- 增加业务状态机：未签合同、待交付、待开票、待回款、已关闭。
