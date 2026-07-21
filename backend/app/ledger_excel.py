from __future__ import annotations

from copy import copy
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote

from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .auth import CurrentUser, apply_department_scope


TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "市场部业务台账模板.xlsx"
TEMPLATE_FILE_NAME = "市场部业务台账模板.xlsx"
EXPORT_FILE_NAME = "市场部业务台账.xlsx"
TEMPLATE_HEADERS = [
    "全额/净额", "项目编号", "部门", "分公司", "客户经理", "订单日期", "业务类型", "统计类别",
    "三级团队名称", "客户单位名称", "用户", "区域平台", "订单号", "项目名称", "货物名称", "规格型号",
    "单位", "数量", "不含税单价", "单价", "不含税收入", "订单价值", "采购厂商", "不含税采购单价",
    "采购单价", "不含税成本", "采购金额", "交付日期", "交付数量", "交付不含税收入", "交付价值",
    "交付不含税成本", "交付成本", "待交付数量", "待交付金额（不含税）", "待交付金额", "公司合同号",
    "付款期限", "履行期限", "合同签订金额", "待签合同金额", "收票日期", "发票号码", "收票金额",
    "入库日期", "凭证号", "入库金额", "入账日期", "凭证号", "入账金额", "待入账金额", "到期付款日",
    "付款日期", "付款凭证号", "付款金额", "付款日期", "付款凭证号", "付款金额", "付款金额", "应付帐款",
    "不含税毛利润", "税金", "退税", "毛利润", "毛利率", "合同签订日期", "公司合同号", "合同价值",
    "履行期限", "待签合同金额", "开票单据号", "开票日期", "发票号", "发票金额", "待开发票金额",
    "已交付未开票", "回款日期", "缴款单号", "回款金额", "回款占比", "回款日期", "缴款单号",
    "回款金额", "回款占比", "回款合计", "应收款", "是否关闭",
]


def content_disposition(file_name: str) -> str:
    return f"attachment; filename*=UTF-8''{quote(file_name)}"


def template_bytes() -> bytes:
    if not TEMPLATE_PATH.is_file():
        raise FileNotFoundError(f"导入模板不存在：{TEMPLATE_PATH}")
    return TEMPLATE_PATH.read_bytes()


def export_ledger_bytes(conn: Connection, user: CurrentUser) -> bytes:
    workbook = load_workbook(TEMPLATE_PATH)
    worksheet = workbook["Sheet1"]
    if worksheet.max_row > 1:
        worksheet.delete_rows(2, worksheet.max_row - 1)

    conditions = ["p.deleted_at IS NULL", "so.deleted_at IS NULL", "ol.deleted_at IS NULL"]
    params: dict[str, object] = {}
    apply_department_scope(conditions, params, user, "p.department")
    rows = conn.execute(text(_export_sql(" AND ".join(conditions))), params).mappings().all()

    for row_no, row in enumerate(rows, start=2):
        values = _row_values(dict(row))
        for column_no, value in enumerate(values, start=1):
            cell = worksheet.cell(row_no, column_no, value)
            _copy_header_alignment(worksheet.cell(1, column_no), cell)
            if column_no in DATE_COLUMNS and isinstance(value, (date, datetime)):
                cell.number_format = "yyyy-mm-dd"
            elif column_no == 65 and value is not None:
                cell.number_format = "0.00%"
            elif column_no in NUMBER_COLUMNS and value is not None:
                cell.number_format = "#,##0.00"

    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


DATE_COLUMNS = {6, 28, 42, 45, 48, 52, 53, 56, 66, 72, 77, 81}
NUMBER_COLUMNS = set(range(18, 37)) | set(range(40, 66)) | set(range(68, 87))


def _copy_header_alignment(header: Any, target: Any) -> None:
    target.alignment = copy(header.alignment)
    target.border = copy(header.border)


def _date_value(row: dict[str, Any], date_key: str, text_key: str | None = None) -> Any:
    value = row.get(date_key)
    if value is not None:
        return value
    return row.get(text_key) if text_key else None


def _row_values(row: dict[str, Any]) -> list[Any]:
    return [
        row.get("gross_net_type"), row.get("project_code"), row.get("department"), row.get("branch_company"),
        row.get("account_manager"), row.get("order_date"), row.get("business_type"), row.get("statistic_category"),
        row.get("team_level3_name"), row.get("customer_unit_name"), row.get("end_user_name"), row.get("regional_platform"),
        row.get("order_no"), row.get("project_name"), row.get("goods_name"), row.get("specification_model"),
        row.get("unit_name"), row.get("quantity"), row.get("sales_unit_price_no_tax"), row.get("sales_unit_price"),
        row.get("revenue_no_tax"), row.get("order_value"), row.get("supplier_name"), row.get("purchase_unit_price_no_tax"),
        row.get("purchase_unit_price"), row.get("cost_no_tax"), row.get("purchase_amount"), row.get("delivery_date"),
        row.get("delivery_quantity"), row.get("delivery_revenue_no_tax"), row.get("delivery_value"),
        row.get("delivery_cost_no_tax"), row.get("delivery_cost"), row.get("pending_delivery_quantity"),
        row.get("pending_delivery_amount_no_tax"), row.get("pending_delivery_amount"), row.get("purchase_contract_no"),
        row.get("payment_terms"), row.get("purchase_performance_period"), row.get("purchase_signed_amount"),
        row.get("purchase_unsigned_amount"), _date_value(row, "received_invoice_date", "received_invoice_date_text"),
        row.get("purchase_invoice_no"), row.get("purchase_invoice_amount"),
        _date_value(row, "warehouse_date", "warehouse_date_text"), row.get("warehouse_voucher_no"),
        row.get("warehouse_amount"), _date_value(row, "booked_date", "booked_date_text"), row.get("booked_voucher_code"),
        row.get("booked_amount"), row.get("pending_booked_amount"), row.get("payment1_due_date"),
        _date_value(row, "payment1_date", "payment1_date_text"), row.get("payment1_voucher_no"), row.get("payment1_amount"),
        _date_value(row, "payment2_date", "payment2_date_text"), row.get("payment2_voucher_no"), row.get("payment2_amount"),
        row.get("total_paid"), row.get("accounts_payable"), row.get("gross_profit_no_tax"), row.get("tax_difference"), None,
        row.get("gross_profit"), _ratio(row.get("gross_profit_margin_no_tax")),
        _date_value(row, "contract_signed_date", "contract_signed_date_text"), row.get("sales_contract_no"),
        row.get("sales_contract_value"), row.get("sales_performance_period"), row.get("sales_unsigned_contract_amount"),
        row.get("invoice_doc_no"), _date_value(row, "invoice_date", "invoice_date_text"), row.get("sales_invoice_no"),
        row.get("sales_invoice_amount"), row.get("pending_invoice_amount"), row.get("delivered_not_invoiced_amount"),
        _date_value(row, "receipt1_date", "receipt1_date_text"), row.get("receipt1_notice_no"), row.get("receipt1_amount"),
        _ratio(row.get("receipt1_ratio")), _date_value(row, "receipt2_date", "receipt2_date_text"),
        row.get("receipt2_notice_no"), row.get("receipt2_amount"), _ratio(row.get("receipt2_ratio")),
        row.get("total_received"), row.get("accounts_receivable"), row.get("close_status"),
    ]


def _ratio(value: Any) -> Any:
    if value is None:
        return None
    numeric = float(value)
    return numeric / 100 if abs(numeric) > 1 else numeric


def _export_sql(where_sql: str) -> str:
    return f"""
        SELECT
          so.gross_net_type, p.project_code, p.department, p.branch_company, p.account_manager,
          so.order_date, so.business_type, so.statistic_category, p.team_level3_name,
          p.customer_unit_name, p.end_user_name, p.regional_platform, so.order_no, p.project_name,
          ol.goods_name, ol.specification_model, ol.unit_name, ol.quantity,
          ol.sales_unit_price_no_tax, ol.sales_unit_price, ol.revenue_no_tax, ol.order_value,
          pi.supplier_name, pi.purchase_unit_price_no_tax, pi.purchase_unit_price, pi.cost_no_tax,
          pi.purchase_amount, dr.delivery_date, dr.delivery_quantity, dr.delivery_revenue_no_tax,
          dr.delivery_value, dr.delivery_cost_no_tax, dr.delivery_cost, dr.pending_delivery_quantity,
          dr.pending_delivery_amount_no_tax, dr.pending_delivery_amount,
          pc.purchase_contract_no, pc.payment_terms, pc.performance_period AS purchase_performance_period,
          pc.signed_amount AS purchase_signed_amount, pc.unsigned_amount AS purchase_unsigned_amount,
          pinv.received_invoice_date, pinv.received_invoice_date_text, pinv.invoice_no AS purchase_invoice_no,
          pinv.invoice_amount AS purchase_invoice_amount, wh.warehouse_date, wh.warehouse_date_text,
          wh.voucher_no AS warehouse_voucher_no, wh.warehouse_amount,
          fpe.payment_date AS booked_date, fpe.payment_date_text AS booked_date_text,
          fpe.voucher_code AS booked_voucher_code, fpe.booked_amount,
          COALESCE(pi.purchase_amount, 0) - COALESCE(fpe_total.booked_amount, 0) AS pending_booked_amount,
          pay1.due_payment_date AS payment1_due_date, pay1.payment_date AS payment1_date,
          pay1.payment_date_text AS payment1_date_text, pay1.payment_voucher_no AS payment1_voucher_no,
          pay1.payment_amount AS payment1_amount, pay2.payment_date AS payment2_date,
          pay2.payment_date_text AS payment2_date_text, pay2.payment_voucher_no AS payment2_voucher_no,
          pay2.payment_amount AS payment2_amount, COALESCE(pay_total.payment_amount, 0) AS total_paid,
          COALESCE(pi.purchase_amount, 0) - COALESCE(pay_total.payment_amount, 0) AS accounts_payable,
          COALESCE(ol.revenue_no_tax, 0) - COALESCE(pi.cost_no_tax, 0) AS gross_profit_no_tax,
          (COALESCE(ol.order_value, 0) - COALESCE(ol.revenue_no_tax, 0))
            - (COALESCE(pi.purchase_amount, 0) - COALESCE(pi.cost_no_tax, 0)) AS tax_difference,
          COALESCE(ol.order_value, 0) - COALESCE(pi.purchase_amount, 0) AS gross_profit,
          CASE WHEN COALESCE(ol.revenue_no_tax, 0) = 0 THEN 0
            ELSE (COALESCE(ol.revenue_no_tax, 0) - COALESCE(pi.cost_no_tax, 0)) / ol.revenue_no_tax * 100 END
            AS gross_profit_margin_no_tax,
          sc.contract_signed_date, sc.contract_signed_date_text, sc.sales_contract_no,
          sc.contract_value AS sales_contract_value, sc.performance_period AS sales_performance_period,
          sc.unsigned_contract_amount AS sales_unsigned_contract_amount,
          sinv.invoice_doc_no, sinv.invoice_date, sinv.invoice_date_text, sinv.invoice_no AS sales_invoice_no,
          sinv.invoice_amount AS sales_invoice_amount, sinv.pending_invoice_amount,
          sinv.delivered_not_invoiced_amount, rec1.receipt_date AS receipt1_date,
          rec1.receipt_date_text AS receipt1_date_text, rec1.payment_notice_no AS receipt1_notice_no,
          rec1.receipt_amount AS receipt1_amount, rec1.receipt_ratio AS receipt1_ratio,
          rec2.receipt_date AS receipt2_date, rec2.receipt_date_text AS receipt2_date_text,
          rec2.payment_notice_no AS receipt2_notice_no, rec2.receipt_amount AS receipt2_amount,
          rec2.receipt_ratio AS receipt2_ratio, COALESCE(rec_total.receipt_amount, 0) AS total_received,
          COALESCE(ol.order_value, 0) - COALESCE(rec_total.receipt_amount, 0) AS accounts_receivable,
          so.close_status
        FROM project p
        JOIN sales_order so ON so.project_id = p.id
        JOIN order_line ol ON ol.sales_order_id = so.id
        LEFT JOIN purchase_info pi ON pi.order_line_id = ol.id AND pi.deleted_at IS NULL
        LEFT JOIN delivery_record dr ON dr.id = (
          SELECT MIN(dr0.id) FROM delivery_record dr0 WHERE dr0.order_line_id = ol.id AND dr0.deleted_at IS NULL
        )
        LEFT JOIN purchase_contract pc ON pc.id = (
          SELECT MIN(pc0.id) FROM purchase_contract pc0 WHERE pc0.order_line_id = ol.id AND pc0.deleted_at IS NULL
        )
        LEFT JOIN purchase_invoice pinv ON pinv.order_line_id = ol.id AND pinv.phase_no = 1 AND pinv.deleted_at IS NULL
        LEFT JOIN warehouse_entry wh ON wh.order_line_id = ol.id AND wh.phase_no = 1 AND wh.deleted_at IS NULL
        LEFT JOIN finance_payment_entry fpe ON fpe.order_line_id = ol.id AND fpe.phase_no = 1 AND fpe.deleted_at IS NULL
        LEFT JOIN purchase_payment pay1 ON pay1.order_line_id = ol.id AND pay1.phase_no = 1 AND pay1.deleted_at IS NULL
        LEFT JOIN purchase_payment pay2 ON pay2.order_line_id = ol.id AND pay2.phase_no = 2 AND pay2.deleted_at IS NULL
        LEFT JOIN sales_contract sc ON sc.id = (
          SELECT MIN(sc0.id) FROM sales_contract sc0 WHERE sc0.order_line_id = ol.id AND sc0.deleted_at IS NULL
        )
        LEFT JOIN sales_invoice sinv ON sinv.order_line_id = ol.id AND sinv.phase_no = 1 AND sinv.deleted_at IS NULL
        LEFT JOIN sales_receipt rec1 ON rec1.order_line_id = ol.id AND rec1.phase_no = 1 AND rec1.deleted_at IS NULL
        LEFT JOIN sales_receipt rec2 ON rec2.order_line_id = ol.id AND rec2.phase_no = 2 AND rec2.deleted_at IS NULL
        LEFT JOIN (
          SELECT order_line_id, SUM(COALESCE(booked_amount, 0)) AS booked_amount
          FROM finance_payment_entry WHERE deleted_at IS NULL GROUP BY order_line_id
        ) fpe_total ON fpe_total.order_line_id = ol.id
        LEFT JOIN (
          SELECT order_line_id, SUM(COALESCE(payment_amount, 0)) AS payment_amount
          FROM purchase_payment WHERE deleted_at IS NULL GROUP BY order_line_id
        ) pay_total ON pay_total.order_line_id = ol.id
        LEFT JOIN (
          SELECT order_line_id, SUM(COALESCE(receipt_amount, 0)) AS receipt_amount
          FROM sales_receipt WHERE deleted_at IS NULL GROUP BY order_line_id
        ) rec_total ON rec_total.order_line_id = ol.id
        WHERE {where_sql}
        ORDER BY so.order_date DESC, so.order_no, ol.id
    """
