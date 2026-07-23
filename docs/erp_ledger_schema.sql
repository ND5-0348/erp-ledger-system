-- ERP ledger schema for MySQL 8.0.
-- Rules:
-- 1. project.project_code is unique.
-- 2. One project can have multiple sales_order.order_no values.
-- 3. Invoice, payment, and receipt tables support multiple phases via phase_no.

CREATE DATABASE IF NOT EXISTS erp_ledger
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE erp_ledger;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS import_batch (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_file_name VARCHAR(255) NOT NULL,
  source_sheet_name VARCHAR(128) NOT NULL,
  header_row_no INT NOT NULL DEFAULT 3,
  data_start_row_no INT NOT NULL DEFAULT 5,
  total_rows INT NOT NULL DEFAULT 0,
  success_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_message TEXT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_import_batch_status (status),
  KEY idx_import_batch_uploaded_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ledger_raw_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_batch_id BIGINT UNSIGNED NOT NULL,
  excel_row_no INT NOT NULL,
  row_hash CHAR(64) NOT NULL,
  raw_json JSON NOT NULL,
  parse_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  parse_message TEXT NULL,
  project_code VARCHAR(64) NULL,
  order_no VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_raw_batch_row (import_batch_id, excel_row_no),
  UNIQUE KEY uk_raw_batch_hash (import_batch_id, row_hash),
  KEY idx_raw_project_order (project_code, order_no),
  CONSTRAINT fk_raw_import_batch FOREIGN KEY (import_batch_id) REFERENCES import_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS erp_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role_code VARCHAR(32) NOT NULL DEFAULT 'viewer',
  permissions_json JSON NULL,
  department_scope_json JSON NULL,
  department_can_view TINYINT(1) NOT NULL DEFAULT 0,
  department_can_entry TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_username (username),
  KEY idx_user_role (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS operation_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  user_name VARCHAR(64) NULL,
  module_name VARCHAR(64) NOT NULL,
  action_name VARCHAR(64) NOT NULL,
  detail TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  request_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_log_time (created_at),
  KEY idx_log_module (module_name, action_name),
  KEY idx_log_user (user_id),
  CONSTRAINT fk_operation_log_user FOREIGN KEY (user_id) REFERENCES erp_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS backup_record (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  file_size_label VARCHAR(32) NULL,
  storage_path VARCHAR(500) NULL,
  backup_type VARCHAR(32) NOT NULL DEFAULT 'manual',
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  created_by BIGINT UNSIGNED NULL,
  backup_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_backup_time (backup_time),
  KEY idx_backup_user (created_by),
  CONSTRAINT fk_backup_record_user FOREIGN KEY (created_by) REFERENCES erp_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS project (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_code VARCHAR(64) NOT NULL,
  project_name VARCHAR(255) NULL,
  department VARCHAR(64) NULL,
  branch_company VARCHAR(64) NULL,
  account_manager VARCHAR(64) NULL,
  team_level3_name VARCHAR(128) NULL,
  customer_unit_name VARCHAR(255) NULL,
  end_user_name VARCHAR(255) NULL,
  regional_platform VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_code (project_code),
  KEY idx_project_customer (customer_unit_name),
  KEY idx_project_manager (account_manager),
  KEY idx_project_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS sales_order (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  import_batch_id BIGINT UNSIGNED NULL,
  source_excel_row_no INT NULL,
  gross_net_type VARCHAR(16) NULL,
  order_no VARCHAR(64) NOT NULL,
  order_date DATE NULL,
  business_type VARCHAR(64) NULL,
  statistic_category VARCHAR(64) NULL,
  close_status VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_order_no (project_id, order_no),
  KEY idx_sales_order_no (order_no),
  KEY idx_sales_order_date (order_date),
  KEY idx_sales_order_type (business_type, statistic_category),
  KEY idx_sales_order_close (close_status),
  CONSTRAINT fk_sales_order_project FOREIGN KEY (project_id) REFERENCES project(id),
  CONSTRAINT fk_sales_order_import_batch FOREIGN KEY (import_batch_id) REFERENCES import_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS order_line (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  raw_row_id BIGINT UNSIGNED NULL,
  source_excel_row_no INT NULL,
  project_name VARCHAR(255) NULL,
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
  PRIMARY KEY (id),
  KEY idx_order_line_order (sales_order_id),
  KEY idx_order_line_raw (raw_row_id),
  KEY idx_order_line_goods (goods_name),
  KEY idx_order_line_value (order_value),
  CONSTRAINT fk_order_line_sales_order FOREIGN KEY (sales_order_id) REFERENCES sales_order(id),
  CONSTRAINT fk_order_line_raw_row FOREIGN KEY (raw_row_id) REFERENCES ledger_raw_row(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_info (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  supplier_name VARCHAR(255) NULL,
  purchase_tax_rate DECIMAL(10,6) NULL,
  purchase_unit_price_no_tax DECIMAL(18,6) NULL,
  purchase_unit_price DECIMAL(18,6) NULL,
  cost_no_tax DECIMAL(18,2) NULL,
  purchase_amount DECIMAL(18,2) NULL,
  labor_cost DECIMAL(18,2) NULL,
  other_cost DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_purchase_info_line (order_line_id),
  KEY idx_purchase_supplier (supplier_name),
  KEY idx_purchase_amount (purchase_amount),
  CONSTRAINT fk_purchase_info_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS delivery_record (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  PRIMARY KEY (id),
  KEY idx_delivery_line (order_line_id),
  KEY idx_delivery_date (delivery_date),
  CONSTRAINT fk_delivery_record_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_contract (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  purchase_contract_no VARCHAR(64) NULL,
  payment_terms VARCHAR(255) NULL,
  performance_period VARCHAR(255) NULL,
  signed_amount DECIMAL(18,2) NULL,
  unsigned_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_purchase_contract_line (order_line_id),
  KEY idx_purchase_contract_no (purchase_contract_no),
  CONSTRAINT fk_purchase_contract_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_invoice (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  received_invoice_date DATE NULL,
  received_invoice_date_text VARCHAR(255) NULL,
  invoice_no VARCHAR(128) NULL,
  invoice_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_purchase_invoice_active_phase (order_line_id, active_phase_no),
  KEY idx_purchase_invoice_line_phase (order_line_id, phase_no),
  KEY idx_purchase_invoice_no (invoice_no),
  KEY idx_purchase_invoice_date (received_invoice_date),
  CONSTRAINT fk_purchase_invoice_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS warehouse_entry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  warehouse_date DATE NULL,
  warehouse_date_text VARCHAR(255) NULL,
  voucher_no VARCHAR(128) NULL,
  warehouse_amount DECIMAL(18,2) NULL,
  warehouse_amount_no_tax DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_warehouse_entry_active_phase (order_line_id, active_phase_no),
  KEY idx_warehouse_line_phase (order_line_id, phase_no),
  KEY idx_warehouse_voucher (voucher_no),
  KEY idx_warehouse_date (warehouse_date),
  CONSTRAINT fk_warehouse_entry_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS finance_invoice_check (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  received_invoice_date DATE NULL,
  received_invoice_date_text VARCHAR(255) NULL,
  received_invoice_amount DECIMAL(18,2) NULL,
  voucher_code VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_finance_invoice_check_active_phase (order_line_id, active_phase_no),
  KEY idx_finance_invoice_line_phase (order_line_id, phase_no),
  KEY idx_finance_invoice_voucher (voucher_code),
  CONSTRAINT fk_finance_invoice_check_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_payment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  due_payment_date DATE NULL,
  payment_date DATE NULL,
  payment_date_text VARCHAR(255) NULL,
  payment_voucher_no VARCHAR(128) NULL,
  payment_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_purchase_payment_active_phase (order_line_id, active_phase_no),
  KEY idx_purchase_payment_line_phase (order_line_id, phase_no),
  KEY idx_purchase_payment_date (payment_date),
  KEY idx_purchase_payment_voucher (payment_voucher_no),
  CONSTRAINT fk_purchase_payment_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS finance_payment_entry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  payment_date DATE NULL,
  payment_date_text VARCHAR(255) NULL,
  voucher_code VARCHAR(128) NULL,
  booked_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_finance_payment_entry_active_phase (order_line_id, active_phase_no),
  KEY idx_finance_payment_line_phase (order_line_id, phase_no),
  KEY idx_finance_payment_date (payment_date),
  KEY idx_finance_payment_voucher (voucher_code),
  CONSTRAINT fk_finance_payment_entry_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS sales_contract (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  contract_signed_date DATE NULL,
  contract_signed_date_text VARCHAR(255) NULL,
  sales_contract_no VARCHAR(64) NULL,
  contract_value DECIMAL(18,2) NULL,
  performance_period VARCHAR(255) NULL,
  unsigned_contract_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_sales_contract_line (order_line_id),
  KEY idx_sales_contract_no (sales_contract_no),
  KEY idx_sales_contract_date (contract_signed_date),
  CONSTRAINT fk_sales_contract_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS sales_invoice (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  invoice_doc_no VARCHAR(128) NULL,
  invoice_date DATE NULL,
  invoice_date_text VARCHAR(255) NULL,
  invoice_no VARCHAR(128) NULL,
  invoice_amount DECIMAL(18,2) NULL,
  pending_invoice_amount DECIMAL(18,2) NULL,
  delivered_not_invoiced_amount DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_invoice_active_phase (order_line_id, active_phase_no),
  KEY idx_sales_invoice_line_phase (order_line_id, phase_no),
  KEY idx_sales_invoice_doc (invoice_doc_no),
  KEY idx_sales_invoice_no (invoice_no),
  KEY idx_sales_invoice_date (invoice_date),
  CONSTRAINT fk_sales_invoice_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS sales_receipt (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_line_id BIGINT UNSIGNED NOT NULL,
  phase_no INT UNSIGNED NOT NULL DEFAULT 1,
  receipt_date DATE NULL,
  receipt_date_text VARCHAR(255) NULL,
  payment_notice_no VARCHAR(128) NULL,
  receipt_amount DECIMAL(18,2) NULL,
  receipt_ratio DECIMAL(10,6) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  active_phase_no INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phase_no ELSE NULL END) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_receipt_active_phase (order_line_id, active_phase_no),
  KEY idx_sales_receipt_line_phase (order_line_id, phase_no),
  KEY idx_sales_receipt_notice (payment_notice_no),
  KEY idx_sales_receipt_date (receipt_date),
  CONSTRAINT fk_sales_receipt_line FOREIGN KEY (order_line_id) REFERENCES order_line(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP VIEW IF EXISTS v_order_line_finance;
CREATE VIEW v_order_line_finance AS
SELECT
  p.project_code,
  so.order_no,
  so.gross_net_type,
  p.department,
  p.branch_company,
  p.account_manager,
  p.team_level3_name,
  so.order_date,
  so.business_type,
  so.statistic_category,
  p.customer_unit_name,
  p.end_user_name,
  p.regional_platform,
  COALESCE(ol.project_name, p.project_name) AS project_name,
  so.close_status,
  ol.id AS order_line_id,
  ol.goods_name,
  ol.specification_model,
  ol.unit_name,
  ol.quantity,
  ol.sales_tax_rate,
  ol.sales_unit_price_no_tax,
  ol.sales_unit_price,
  ol.revenue_no_tax,
  ol.order_value,
  COALESCE(ol.order_value, 0) - COALESCE(ol.revenue_no_tax, 0) AS sales_tax_amount,
  pi.supplier_name,
  pi.purchase_tax_rate,
  pi.purchase_unit_price_no_tax,
  pi.purchase_unit_price,
  pi.cost_no_tax,
  pi.purchase_amount,
  COALESCE(pi.purchase_amount, 0) - COALESCE(pi.cost_no_tax, 0) AS purchase_tax_amount,
  pi.labor_cost,
  pi.other_cost,
  dr.delivery_date,
  dr.delivery_quantity,
  dr.delivery_revenue_no_tax,
  dr.delivery_value,
  dr.delivery_cost_no_tax,
  dr.delivery_cost,
  dr.pending_delivery_quantity,
  dr.pending_delivery_amount_no_tax,
  dr.pending_delivery_amount,
  pc.purchase_contract_no,
  pc.signed_amount AS purchase_contract_signed_amount,
  sc.sales_contract_no,
  sc.contract_signed_date AS sales_contract_signed_date,
  sc.contract_value AS sales_contract_value,
  COALESCE(si_total.invoice_amount, 0) AS sales_invoice_amount,
  COALESCE(fic_total.received_invoice_amount, 0) AS total_finance_checked,
  COALESCE(fpe_total.booked_amount, 0) AS total_finance_paid,
  COALESCE(sr_total.receipt_amount, 0) AS total_received,
  COALESCE(pay_total.payment_amount, 0) AS total_paid,
  COALESCE(ol.order_value, 0) - COALESCE(sr_total.receipt_amount, 0) AS accounts_receivable,
  COALESCE(pi.purchase_amount, 0) - COALESCE(pay_total.payment_amount, 0) AS accounts_payable,
  COALESCE(pi.purchase_amount, 0) - COALESCE(fpe_total.booked_amount, 0) AS financial_accounts_payable,
  COALESCE(ol.revenue_no_tax, 0) - COALESCE(pi.cost_no_tax, 0) AS gross_profit_no_tax,
  CASE
    WHEN COALESCE(ol.revenue_no_tax, 0) = 0 THEN 0
    ELSE (COALESCE(ol.revenue_no_tax, 0) - COALESCE(pi.cost_no_tax, 0)) / ol.revenue_no_tax * 100
  END AS gross_profit_margin_no_tax,
  COALESCE(ol.order_value, 0) - COALESCE(pi.purchase_amount, 0) AS gross_profit
FROM project p
JOIN sales_order so ON so.project_id = p.id AND so.deleted_at IS NULL
JOIN order_line ol ON ol.sales_order_id = so.id AND ol.deleted_at IS NULL
LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
LEFT JOIN delivery_record dr ON dr.order_line_id = ol.id AND dr.deleted_at IS NULL
LEFT JOIN (
  SELECT
    order_line_id,
    GROUP_CONCAT(DISTINCT purchase_contract_no ORDER BY id SEPARATOR ', ') AS purchase_contract_no,
    SUM(COALESCE(signed_amount, 0)) AS signed_amount
  FROM purchase_contract
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) pc ON pc.order_line_id = ol.id
LEFT JOIN (
  SELECT
    order_line_id,
    GROUP_CONCAT(DISTINCT sales_contract_no ORDER BY id SEPARATOR ', ') AS sales_contract_no,
    MAX(contract_signed_date) AS contract_signed_date,
    SUM(COALESCE(contract_value, 0)) AS contract_value
  FROM sales_contract
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) sc ON sc.order_line_id = ol.id
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(invoice_amount, 0)) AS invoice_amount
  FROM sales_invoice
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) si_total ON si_total.order_line_id = ol.id
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(received_invoice_amount, 0)) AS received_invoice_amount
  FROM finance_invoice_check
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) fic_total ON fic_total.order_line_id = ol.id
LEFT JOIN (
  SELECT order_line_id, SUM(COALESCE(booked_amount, 0)) AS booked_amount
  FROM finance_payment_entry
  WHERE deleted_at IS NULL
  GROUP BY order_line_id
) fpe_total ON fpe_total.order_line_id = ol.id
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
WHERE p.deleted_at IS NULL;

DROP VIEW IF EXISTS v_project_ledger_summary;
CREATE VIEW v_project_ledger_summary AS
SELECT
  p.project_code,
  COALESCE(
    GROUP_CONCAT(DISTINCT v.project_name ORDER BY v.project_name SEPARATOR '；'),
    p.project_name
  ) AS project_name,
  p.department,
  p.branch_company,
  p.account_manager,
  p.customer_unit_name,
  MIN(v.order_date) AS first_order_date,
  MAX(v.order_date) AS last_order_date,
  COUNT(DISTINCT v.order_no) AS order_count,
  SUM(COALESCE(v.order_value, 0)) AS order_amount,
  SUM(COALESCE(v.purchase_amount, 0)) AS purchase_amount,
  SUM(COALESCE(v.labor_cost, 0)) AS labor_cost,
  SUM(COALESCE(v.other_cost, 0)) AS other_cost,
  SUM(COALESCE(v.total_finance_paid, 0)) AS total_finance_paid,
  SUM(COALESCE(v.financial_accounts_payable, 0)) AS financial_accounts_payable,
  SUM(COALESCE(v.total_received, 0)) AS total_received,
  SUM(COALESCE(v.accounts_receivable, 0)) AS accounts_receivable,
  SUM(COALESCE(v.accounts_payable, 0)) AS accounts_payable,
  SUM(COALESCE(v.gross_profit_no_tax, 0)) AS gross_profit_no_tax,
  SUM(COALESCE(v.gross_profit, 0)) AS gross_profit,
  CASE WHEN SUM(COALESCE(v.accounts_receivable, 0)) = 0 THEN 'closed' ELSE 'open' END AS computed_close_status
FROM project p
LEFT JOIN v_order_line_finance v ON v.project_code = p.project_code
WHERE p.deleted_at IS NULL
GROUP BY p.project_code, p.project_name, p.department, p.branch_company, p.account_manager, p.customer_unit_name;

DROP VIEW IF EXISTS v_order_ledger_summary;
CREATE VIEW v_order_ledger_summary AS
SELECT
  v.project_code,
  v.order_no,
  GROUP_CONCAT(DISTINCT v.project_name ORDER BY v.project_name SEPARATOR '；') AS project_name,
  v.department,
  v.branch_company,
  v.account_manager,
  v.customer_unit_name,
  v.order_date,
  v.business_type,
  v.statistic_category,
  v.close_status,
  COUNT(v.order_line_id) AS line_count,
  SUM(COALESCE(v.order_value, 0)) AS order_amount,
  SUM(COALESCE(v.purchase_amount, 0)) AS purchase_amount,
  SUM(COALESCE(v.labor_cost, 0)) AS labor_cost,
  SUM(COALESCE(v.other_cost, 0)) AS other_cost,
  SUM(COALESCE(v.total_finance_paid, 0)) AS total_finance_paid,
  SUM(COALESCE(v.financial_accounts_payable, 0)) AS financial_accounts_payable,
  SUM(COALESCE(v.total_received, 0)) AS total_received,
  SUM(COALESCE(v.accounts_receivable, 0)) AS accounts_receivable,
  SUM(COALESCE(v.accounts_payable, 0)) AS accounts_payable,
  SUM(COALESCE(v.gross_profit_no_tax, 0)) AS gross_profit_no_tax,
  SUM(COALESCE(v.gross_profit, 0)) AS gross_profit
FROM v_order_line_finance v
GROUP BY v.project_code, v.order_no, v.department, v.branch_company, v.account_manager,
  v.customer_unit_name, v.order_date, v.business_type, v.statistic_category, v.close_status;
