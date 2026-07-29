interface OperationLogSource {
  user_name: string | null;
  action_name: string;
  detail: string;
}

type AuditSnapshot = Record<string, unknown>;

interface AuditDetail {
  summary?: string;
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  batch_entries?: AuditBatchEntry[];
}

interface AuditBatchEntry {
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
}

export interface OperationLogChangeGroup {
  title: string;
  changes: string[];
}

const FIELD_LABELS: Record<string, string> = {
  project_code: '项目编号',
  order_no: '销售订单号',
  amount_type: '全额/净额',
  gross_net_type: '全额/净额',
  department: '部门',
  branch_company: '分公司',
  team_name: '三级团队',
  team_level3_name: '三级团队名称',
  account_manager: '客户经理',
  order_date: '销售订单日期',
  business_type: '业务类型',
  statistical_category: '统计类别',
  statistic_category: '统计类别',
  customer_unit_name: '客户单位名称',
  user_name: '用户',
  end_user_name: '用户',
  regional_platform: '区域平台',
  project_name: '项目名称',
  close_status: '关闭状态',
  goods_name: '货物名称',
  specification_model: '规格型号',
  unit_name: '单位',
  quantity: '销售数量',
  sales_tax_rate: '销售税率',
  sales_unit_price_no_tax: '不含税单价',
  net_unit_price: '不含税单价',
  sales_unit_price: '含税单价',
  unit_price: '含税单价',
  revenue_no_tax: '不含税订单金额',
  net_revenue: '不含税订单金额',
  order_value: '销售订单金额',
  sales_tax_amount: '销售税金',
  supplier_name: '采购厂商',
  purchase_tax_rate: '采购税率',
  purchase_unit_price_no_tax: '采购不含税单价',
  purchase_unit_price: '采购含税单价',
  cost_no_tax: '不含税采购金额',
  purchase_amount: '含税采购金额',
  purchase_tax_amount: '采购税金',
  labor_cost: '人工成本',
  other_cost: '其他成本',
  delivery_date: '交货日期',
  delivery_quantity: '交货数量',
  delivery_revenue_no_tax: '不含税交付收入',
  delivery_value: '交付金额',
  delivery_cost_no_tax: '不含税交付成本',
  delivery_cost: '交付成本',
  pending_delivery_quantity: '未交付数量',
  pending_delivery_amount_no_tax: '不含税未交付金额',
  pending_delivery_amount: '未交付金额',
  purchase_contract_no: '采购合同号',
  payment_terms: '付款条件',
  performance_period: '履约周期',
  purchase_performance_period: '采购履约周期',
  signed_amount: '签约金额',
  unsigned_amount: '未签约金额',
  purchase_signed_amount: '采购合同签约金额',
  purchase_unsigned_amount: '采购合同待签金额',
  phase_no: '期次',
  received_invoice_date: '收票日期',
  invoice_no: '发票号码',
  invoice_amount: '发票金额',
  purchase_invoice_no: '采购发票号码',
  purchase_invoice_amount: '采购发票金额',
  warehouse_date: '入库日期',
  warehouse_voucher_no: '入库凭证号',
  warehouse_entry_date: '入库日期',
  warehouse_amount: '入库金额',
  received_invoice_amount: '已收发票金额',
  booked_date: '入账日期',
  booked_voucher_code: '入账凭证号',
  booked_amount: '入账金额',
  payment1_due_date: '第一期到期付款日期',
  payment1_date: '第一期付款日期',
  payment1_voucher_no: '第一期付款凭证号',
  payment1_amount: '第一期付款金额',
  payment2_date: '第二期付款日期',
  payment2_voucher_no: '第二期付款凭证号',
  payment2_amount: '第二期付款金额',
  due_payment_date: '应付款日期',
  payment_date: '付款日期',
  payment_voucher_no: '付款凭证号',
  payment_amount: '付款金额',
  contract_signed_date: '合同签订日期',
  sales_contract_no: '销售合同号',
  contract_value: '合同金额',
  sales_contract_value: '销售合同金额',
  sales_performance_period: '销售合同履约周期',
  unsigned_contract_amount: '未签合同金额',
  sales_unsigned_contract_amount: '销售合同待签金额',
  invoice_doc_no: '开票单号',
  invoice_date: '开票日期',
  sales_invoice_no: '销售发票号码',
  sales_invoice_amount: '销售发票金额',
  pending_invoice_amount: '待开票金额',
  delivered_not_invoiced_amount: '已交付未开票金额',
  receipt1_date: '第一次回款日期',
  receipt1_notice_no: '第一次回款通知单号',
  receipt1_amount: '第一次回款金额',
  receipt1_ratio: '第一次回款占比',
  receipt2_date: '第二次回款日期',
  receipt2_notice_no: '第二次回款通知单号',
  receipt2_amount: '第二次回款金额',
  receipt2_ratio: '第二次回款占比',
  receipt_date: '回款日期',
  payment_notice_no: '收款通知单号',
  receipt_amount: '回款金额',
  receipt_ratio: '回款比例',
  username: '账号',
  display_name: '显示名称',
  role_name: '角色',
  permissions: '权限',
  department_scope: '部门范围',
  department_can_view: '部门查看权限',
  department_can_entry: '部门录入权限',
  is_active: '账号状态',
  account_status: '账号状态',
};

const UPDATE_ENTITY_LABELS: Record<string, string> = {
  batch_update_basic_order: '基本信息',
  batch_update_purchases: '采购信息',
  batch_update_sales: '销售信息',
  update_order: '订单',
  update_purchase_summary: '采购基础信息',
  update_purchase_contract: '采购合同',
  update_purchase_invoice: '采购收票',
  update_warehouse_entry: '入库记录',
  update_finance_invoice_check: '发票校验',
  update_finance_payment: '财务入账付款',
  update_purchase_payment: '采购付款',
  update_sales_contract: '销售合同',
  update_sales_invoice: '销售开票',
  update_sales_receipt: '销售回款',
  update_user_permissions: '账号',
};

const ACTION_LABELS: Record<string, string> = {
  remove_test_data: '测试数据清理',
  create_backup: '数据备份',
  restore_backup: '数据恢复',
  import_excel: '数据导入',
  create_order: '新增订单',
  batch_create_orders: '批量新增订单',
  batch_create_basic_orders: '在线表格批量新增基本信息',
  batch_update_basic_order: '在线表格批量修改基本信息',
  batch_update_purchases: '在线表格批量修改采购信息',
  batch_update_sales: '在线表格批量修改销售信息',
  delete_order: '删除订单',
  create_user: '新增账号',
  update_user_permissions: '修改账号权限',
  delete_user: '删除账号',
};

const IGNORED_FIELDS = new Set([
  'id',
  'project_id',
  'sales_order_id',
  'order_line_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'total_finance_checked',
  'total_finance_paid',
  'total_received',
  'total_paid',
  'accounts_receivable',
  'accounts_payable',
  'financial_accounts_payable',
  'gross_profit_no_tax',
  'gross_profit_margin_no_tax',
  'gross_profit',
]);

function parseAuditDetail(detail: string): AuditDetail | null {
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as AuditDetail;
  } catch {
    return null;
  }
}

function isSnapshot(value: unknown): value is AuditSnapshot {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valuesMatch(before: unknown, after: unknown) {
  if (before === after) return true;
  return JSON.stringify(before) === JSON.stringify(after);
}

function formatValue(value: unknown, fieldName = '') {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.join('、') : '空';
  if (typeof value === 'object') return JSON.stringify(value);
  if (
    fieldName
    && /(amount|cost|price|quantity|rate|ratio|value|signed|received|paid|profit|phase_no)/.test(fieldName)
    && /^-?\d+(\.\d+)?$/.test(String(value))
  ) {
    return String(Number(value));
  }
  return String(value);
}

function changedFields(before: AuditSnapshot, after: AuditSnapshot) {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys
    .filter((key) => !IGNORED_FIELDS.has(key) && !key.endsWith('_text'))
    .filter((key) => !valuesMatch(before[key], after[key]))
    .map((key) => `${FIELD_LABELS[key] || `字段“${key}”`}：${formatValue(before[key], key)} → ${formatValue(after[key], key)}`);
}

function snapshotIdentifier(actionName: string, before: AuditSnapshot, after: AuditSnapshot) {
  const projectCode = after.project_code || before.project_code;
  const orderNo = after.order_no || before.order_no;
  const goodsName = after.goods_name || before.goods_name;
  const specificationModel = after.specification_model || before.specification_model;
  const context: string[] = [];
  if (projectCode) context.push(`项目“${formatValue(projectCode)}”`);
  if (orderNo) context.push(`订单“${formatValue(orderNo)}”`);
  if (goodsName) {
    const specification = specificationModel ? `（${formatValue(specificationModel)}）` : '';
    context.push(`货物/服务“${formatValue(goodsName)}${specification}”`);
  }

  if (actionName === 'update_order') {
    if (context.length) return context.join('、');
  }

  if (actionName === 'update_user_permissions') {
    const username = after.username || before.username;
    if (username) return `账号“${formatValue(username)}”`;
  }

  const label = UPDATE_ENTITY_LABELS[actionName] || '记录';
  const recordId = after.id || before.id || after.order_line_id || before.order_line_id;
  const record = recordId ? `${label}“${formatValue(recordId)}”` : label;
  return context.length ? `${context.join('、')}中的${record}` : record;
}

function formatSummary(userName: string, actionName: string, detail: string, audit: AuditDetail | null) {
  const summary = typeof audit?.summary === 'string' ? audit.summary.trim() : detail.trim();
  if (summary && /[\u3400-\u9fff]/u.test(summary)) return `${userName}${summary}`;
  return `${userName}执行了${ACTION_LABELS[actionName] || '系统操作'}`;
}

export function formatOperationLogDetails(item: OperationLogSource) {
  const userName = item.user_name?.trim() || '系统';
  const audit = parseAuditDetail(item.detail);
  const before = isSnapshot(audit?.before) ? audit.before : null;
  const after = isSnapshot(audit?.after) ? audit.after : null;

  if (
    (item.action_name.startsWith('update_') || item.action_name.startsWith('batch_update_'))
    && before
    && after
  ) {
    const changes = changedFields(before, after);
    if (changes.length) {
      return `${userName}修改了${snapshotIdentifier(item.action_name, before, after)}的${changes.join('；')}`;
    }
    if (item.action_name === 'batch_update_basic_order') {
      return `${userName}对${snapshotIdentifier(item.action_name, before, after)}执行了在线表格批量修改（历史日志未保存具体字段差异）`;
    }
  }

  return formatSummary(userName, item.action_name, item.detail, audit);
}

export function formatOperationLogChangeGroups(
  item: OperationLogSource,
): OperationLogChangeGroup[] {
  const audit = parseAuditDetail(item.detail);
  if (!Array.isArray(audit?.batch_entries)) return [];

  return audit.batch_entries.flatMap((entry, index) => {
    const before = isSnapshot(entry?.before) ? entry.before : null;
    const after = isSnapshot(entry?.after) ? entry.after : null;
    if (!before || !after) return [];
    const changes = changedFields(before, after);
    if (!changes.length) return [];
    return [{
      title: `第 ${index + 1} 条 · ${snapshotIdentifier(item.action_name, before, after)}`,
      changes,
    }];
  });
}
