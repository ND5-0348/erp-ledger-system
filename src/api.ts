const API_BASE = ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL) || '/api';
export const UNAUTHORIZED_EVENT = 'erp:unauthorized';

let authToken = '';

export function setApiToken(token: string) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface BackendHealth {
  status: string;
  database: string;
  importedRows: number;
  error?: string | null;
}

export interface BackendDashboardSummary {
  orderAmount: number;
  grossProfit: number;
  orderCount: number;
  accountsReceivable: number;
  accountsPayable: number;
  closedCount: number;
}

export interface BackendProjectLedger {
  delivery_value?: number;
  delivery_cost?: number;
  total_paid?: number;
  sales_invoice_amount?: number;
  received_invoice_amount?: number;
  project_code: string;
  project_name: string | null;
  department: string | null;
  branch_company: string | null;
  account_manager: string | null;
  customer_unit_name: string | null;
  first_order_date: string | null;
  last_order_date: string | null;
  order_count: number;
  order_amount: number;
  purchase_amount: number;
  total_received: number;
  accounts_receivable: number;
  accounts_payable: number;
  gross_profit: number;
  computed_close_status: string;
}

export interface BackendOrderRecord {
  order_line_id?: number;
  amount_type?: string | null;
  project_code: string;
  project_name?: string | null;
  department?: string | null;
  branch_company?: string | null;
  account_manager?: string | null;
  order_no: string;
  order_date: string | null;
  last_modified_at?: string | null;
  statistical_category?: string | null;
  team_name?: string | null;
  goods_name: string | null;
  spec_model?: string | null;
  unit_name: string | null;
  quantity: number | null;
  sales_tax_rate?: number | null;
  net_unit_price?: number | null;
  unit_price?: number | null;
  net_revenue?: number | null;
  order_value: number | null;
  sales_tax_amount?: number | null;
  delivery_quantity: number | null;
  business_type: string | null;
  customer_unit_name: string | null;
  user_name?: string | null;
  regional_platform?: string | null;
  supplier_name?: string | null;
  purchase_tax_rate?: number | null;
  purchase_unit_price_no_tax?: number | null;
  purchase_unit_price?: number | null;
  cost_no_tax?: number | null;
  purchase_amount?: number | null;
  purchase_tax_amount?: number | null;
  labor_cost?: number | null;
  other_cost?: number | null;
  delivery_date?: string | null;
  delivery_revenue_no_tax?: number | null;
  delivery_value?: number | null;
  delivery_cost_no_tax?: number | null;
  delivery_cost?: number | null;
  pending_delivery_quantity?: number | null;
  pending_delivery_amount_no_tax?: number | null;
  pending_delivery_amount?: number | null;
  total_received?: number | null;
  total_paid?: number | null;
  accounts_receivable?: number | null;
  accounts_payable?: number | null;
  gross_profit?: number | null;
  close_status?: string | null;
}

export type BatchEditorValue = string | number | null;

export interface BackendBatchEditorColumn {
  excel_column: string;
  label: string;
  key: string | null;
  value_type: 'text' | 'date' | 'number' | 'percentage';
  editable: boolean;
  required: boolean;
}

export interface BackendBatchEditorRow {
  order_line_id: number;
  values: BatchEditorValue[];
}

export interface BackendBatchEditorResponse {
  editable_from?: string;
  editable_through: string;
  fixed_columns?: string[];
  columns: BackendBatchEditorColumn[];
  rows?: BackendBatchEditorRow[];
}

export interface BackendPurchaseRecord {
  order_line_id: number;
  project_code: string;
  order_no: string;
  account_manager: string | null;
  department: string | null;
  supplier_name: string | null;
  purchase_contract_no: string | null;
  purchase_contract_signed_amount: number | null;
  purchase_amount: number | null;
  received_invoice_amount: number | null;
  total_paid: number | null;
  accounts_payable: number | null;
  latest_payment_date?: string | null;
}

export interface BackendPurchaseContract {
  id: number;
  purchase_contract_no: string | null;
  payment_terms: string | null;
  performance_period: string | null;
  signed_amount: number | null;
  unsigned_amount: number | null;
}

export interface BackendPurchaseInvoice {
  id: number;
  phase_no: number;
  received_invoice_date: string | null;
  received_invoice_date_text: string | null;
  invoice_no: string | null;
  invoice_amount: number | null;
}

export interface BackendPurchasePayment {
  id: number;
  phase_no: number;
  due_payment_date: string | null;
  payment_date: string | null;
  payment_date_text: string | null;
  payment_voucher_no: string | null;
  payment_amount: number | null;
}

export interface BackendWarehouseEntry {
  id: number;
  phase_no: number;
  warehouse_date: string | null;
  warehouse_date_text: string | null;
  voucher_no: string | null;
  warehouse_amount: number | null;
  warehouse_amount_no_tax: number | null;
}

export interface BackendFinanceInvoiceCheck {
  id: number;
  phase_no: number;
  received_invoice_date: string | null;
  received_invoice_date_text: string | null;
  received_invoice_amount: number | null;
  voucher_code: string | null;
}

export interface BackendFinancePayment {
  id: number;
  phase_no: number;
  payment_date: string | null;
  payment_date_text: string | null;
  voucher_code: string | null;
  booked_amount: number | null;
}

export interface BackendPurchaseDetail {
  summary: Record<string, string | number | null>;
  contracts: BackendPurchaseContract[];
  invoices: BackendPurchaseInvoice[];
  warehouse_entries: BackendWarehouseEntry[];
  finance_invoice_checks: BackendFinanceInvoiceCheck[];
  finance_payments: BackendFinancePayment[];
  payments: BackendPurchasePayment[];
}

export interface BackendSalesRecord {
  order_line_id: number;
  project_code: string;
  order_no: string;
  account_manager: string | null;
  department: string | null;
  sales_contract_no: string | null;
  sales_contract_signed_date: string | null;
  sales_contract_value: number | null;
  sales_invoice_amount: number | null;
  total_received: number | null;
  accounts_receivable: number | null;
  supplier_name?: string | null;
  latest_receipt_date?: string | null;
  invoice_dates?: string | null;
}

export interface BackendSalesContract {
  id: number;
  contract_signed_date: string | null;
  contract_signed_date_text: string | null;
  sales_contract_no: string | null;
  contract_value: number | null;
  performance_period: string | null;
  unsigned_contract_amount: number | null;
}

export interface BackendSalesInvoice {
  id: number;
  phase_no: number;
  invoice_doc_no: string | null;
  invoice_date: string | null;
  invoice_date_text: string | null;
  invoice_no: string | null;
  invoice_amount: number | null;
  pending_invoice_amount: number | null;
  delivered_not_invoiced_amount: number | null;
}

export interface BackendSalesReceipt {
  id: number;
  phase_no: number;
  receipt_date: string | null;
  receipt_date_text: string | null;
  payment_notice_no: string | null;
  receipt_amount: number | null;
  receipt_ratio: number | null;
}

export interface BackendSalesDetail {
  summary: Record<string, string | number | null>;
  contracts: BackendSalesContract[];
  invoices: BackendSalesInvoice[];
  receipts: BackendSalesReceipt[];
}

export interface BackendOperationLog {
  id: number;
  user_name: string | null;
  module_name: string;
  action_name: string;
  detail: string;
  status: string;
  created_at: string;
}

export interface BackendBackupInfo {
  id: number;
  file_name: string;
  file_size_label: string | null;
  backup_type: string;
  status: string;
  backup_time: string;
}

export interface BackendAuthUser {
  id: number;
  username: string;
  display_name: string;
  role_code: string;
  role_label: string;
  permissions: string[];
  department_scope: string[];
  department_can_view: boolean;
  department_can_entry: boolean;
}

export interface BackendUserRecord {
  id: number;
  username: string;
  display_name: string;
  role_code: string;
  permissions_json: string[] | string | null;
  /** 实际生效的权限（permissions_json 为空时由后端按角色默认权限补齐）。 */
  effective_permissions?: string[];
  department_scope_json: string[] | string | null;
  department_can_view: number | boolean;
  department_can_entry: number | boolean;
  is_active: number | boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageResult<T> {
  total: number;
  items: T[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    const message = parseErrorMessage(body) || `HTTP ${response.status}`;
    if (response.status === 401) {
      authToken = '';
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, { headers });
  await ensureSuccessfulResponse(response);
  return response.blob();
}

async function uploadExcel<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: file,
  });
  await ensureSuccessfulResponse(response);
  return response.json() as Promise<T>;
}

async function ensureSuccessfulResponse(response: Response) {
  if (response.ok) return;
  const body = await response.text();
  const message = parseErrorMessage(body) || `HTTP ${response.status}`;
  if (response.status === 401) {
    authToken = '';
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  throw new ApiError(response.status, message);
}

export function parseErrorMessage(body: string) {
  if (!body) {
    return '';
  }
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') {
      return parsed.detail;
    }
    // 结构化错误：写入忙（409 BUSINESS_WRITE_BUSY）等返回 {code, message}，
    // 直接展示 message，不要把整个 JSON 丢给用户。
    if (parsed.detail && typeof parsed.detail === 'object') {
      const detail = parsed.detail as { message?: unknown };
      if (typeof detail.message === 'string' && detail.message) {
        return detail.message;
      }
    }
    return body;
  } catch {
    return body;
  }
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

export const api = {
  setToken: setApiToken,
  login: (data: { username: string; password: string }) =>
    request<{ access_token: string; token_type: string; user: BackendAuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => request<{ user: BackendAuthUser }>('/auth/me'),
  users: (status: 'active' | 'inactive' = 'active') =>
    request<{ items: BackendUserRecord[] }>(`/auth/users${query({ status })}`),
  createUser: (data: {
    username: string;
    password: string;
    display_name: string;
    role_code: string;
    permissions: string[];
    department_scope: string[];
    department_can_view: boolean;
    department_can_entry: boolean;
    department_all: boolean;
  }) =>
    request<{ items: BackendUserRecord[] }>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUserPermissions: (
    userId: number,
    data: {
      role_code: string;
      permissions: string[];
      department_scope: string[];
      department_can_view: boolean;
      department_can_entry: boolean;
      department_all: boolean;
    },
  ) => request<{ items: BackendUserRecord[] }>(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserPassword: (userId: number, password: string) =>
    request<{ message: string }>(`/auth/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  deactivateUser: (userId: number) =>
    request<{ items: BackendUserRecord[] }>(`/auth/users/${userId}`, { method: 'DELETE' }),
  restoreUser: (userId: number) =>
    request<{ items: BackendUserRecord[] }>(`/auth/users/${userId}/restore`, { method: 'POST' }),
  permanentlyDeleteUser: (userId: number) =>
    request<{ items: BackendUserRecord[] }>(`/auth/users/${userId}/permanent`, { method: 'DELETE' }),
  health: () => request<BackendHealth>('/health'),
  importExcel: () => request<{ success_rows: number; failed_rows: number }>('/import/excel', { method: 'POST' }),
  dashboardSummary: () => request<BackendDashboardSummary>('/dashboard/summary'),
  ledgers: (params: Record<string, string | number | undefined> = {}) =>
    request<PageResult<BackendProjectLedger>>(`/ledgers${query(params)}`),
  orders: (params: Record<string, string | number | undefined> = {}) =>
    request<PageResult<BackendOrderRecord>>(`/orders${query(params)}`),
  createOrder: (data: Record<string, string | number | null>) =>
    request<BackendOrderRecord>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  createOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    request<{ created: number; order_line_ids: number[] }>('/orders/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  batchOrderEditorSchema: () => request<BackendBatchEditorResponse>('/orders/batch-editor/schema'),
  batchOrderEditorRows: (orderLineIds: number[]) =>
    request<BackendBatchEditorResponse>('/orders/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  createBasicOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    request<{ created: number; order_line_ids: number[] }>('/orders/batch-basic', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  updateBasicOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    request<{ updated: number; order_line_ids: number[] }>('/orders/batch-basic', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  downloadOrderTemplate: () => requestBlob('/orders/template'),
  exportOrdersExcel: (params: Record<string, string | number | undefined> = {}) =>
    requestBlob(`/orders/export${query(params)}`),
  importOrdersExcel: (file: File) =>
    uploadExcel<{
      batch_id: number;
      source_file: string;
      success_rows: number;
      failed_rows: number;
      skipped_rows: number;
    }>(
      `/orders/import-excel${query({ filename: file.name })}`,
      file,
    ),
  updateOrder: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendOrderRecord>(`/orders/${orderLineId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrder: (orderLineId: number) => request<{ deleted: boolean; order_line_id: number }>(`/orders/${orderLineId}`, { method: 'DELETE' }),
  purchases: (params: Record<string, string | number | undefined> = {}) =>
    request<PageResult<BackendPurchaseRecord>>(`/purchases${query(params)}`),
  batchPurchaseEditorRows: (orderLineIds: number[]) =>
    request<BackendBatchEditorResponse>('/purchases/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  updatePurchasesBatch: (items: Array<Record<string, string | number | null>>) =>
    request<{ updated: number; order_line_ids: number[] }>('/purchases/batch', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  purchaseDetail: (orderLineId: number) => request<BackendPurchaseDetail>(`/purchases/${orderLineId}`),
  updatePurchaseSummary: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/summary`, { method: 'PUT', body: JSON.stringify(data) }),
  addPurchaseContract: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseContract: (contractId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseContract: (contractId: number) =>
    request<BackendPurchaseDetail>(`/purchases/contracts/${contractId}`, { method: 'DELETE' }),
  addPurchaseInvoice: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/invoices`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseInvoice: (invoiceId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/invoices/${invoiceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseInvoice: (invoiceId: number) =>
    request<BackendPurchaseDetail>(`/purchases/invoices/${invoiceId}`, { method: 'DELETE' }),
  addWarehouseEntry: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/warehouse-entries`, { method: 'POST', body: JSON.stringify(data) }),
  updateWarehouseEntry: (entryId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/warehouse-entries/${entryId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWarehouseEntry: (entryId: number) =>
    request<BackendPurchaseDetail>(`/purchases/warehouse-entries/${entryId}`, { method: 'DELETE' }),
  addFinanceInvoiceCheck: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/finance-invoice-checks`, { method: 'POST', body: JSON.stringify(data) }),
  updateFinanceInvoiceCheck: (checkId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/finance-invoice-checks/${checkId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFinanceInvoiceCheck: (checkId: number) =>
    request<BackendPurchaseDetail>(`/purchases/finance-invoice-checks/${checkId}`, { method: 'DELETE' }),
  addFinancePayment: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/finance-payments`, { method: 'POST', body: JSON.stringify(data) }),
  updateFinancePayment: (paymentId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/finance-payments/${paymentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFinancePayment: (paymentId: number) =>
    request<BackendPurchaseDetail>(`/purchases/finance-payments/${paymentId}`, { method: 'DELETE' }),
  addPurchasePayment: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/${orderLineId}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchasePayment: (paymentId: number, data: Record<string, string | number | null>) =>
    request<BackendPurchaseDetail>(`/purchases/payments/${paymentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchasePayment: (paymentId: number) =>
    request<BackendPurchaseDetail>(`/purchases/payments/${paymentId}`, { method: 'DELETE' }),
  sales: (params: Record<string, string | number | undefined> = {}) =>
    request<PageResult<BackendSalesRecord>>(`/sales${query(params)}`),
  batchSalesEditorRows: (orderLineIds: number[]) =>
    request<BackendBatchEditorResponse>('/sales/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  updateSalesBatch: (items: Array<Record<string, string | number | null>>) =>
    request<{ updated: number; order_line_ids: number[] }>('/sales/batch', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  salesDetail: (orderLineId: number) => request<BackendSalesDetail>(`/sales/${orderLineId}`),
  salesDetailByOrder: (projectId: string, orderId: string) =>
    request<BackendSalesDetail>(`/sales/by-order${query({ project_id: projectId, order_id: orderId })}`),
  addSalesContract: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/${orderLineId}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesContract: (contractId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesContract: (contractId: number) =>
    request<BackendSalesDetail>(`/sales/contracts/${contractId}`, { method: 'DELETE' }),
  addSalesInvoice: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/${orderLineId}/invoices`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesInvoice: (invoiceId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/invoices/${invoiceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesInvoice: (invoiceId: number) =>
    request<BackendSalesDetail>(`/sales/invoices/${invoiceId}`, { method: 'DELETE' }),
  addSalesReceipt: (orderLineId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/${orderLineId}/receipts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesReceipt: (receiptId: number, data: Record<string, string | number | null>) =>
    request<BackendSalesDetail>(`/sales/receipts/${receiptId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesReceipt: (receiptId: number) =>
    request<BackendSalesDetail>(`/sales/receipts/${receiptId}`, { method: 'DELETE' }),
  logs: () => request<PageResult<BackendOperationLog>>('/logs?limit=100'),
  backups: () => request<PageResult<BackendBackupInfo>>('/backups?limit=100'),
  createBackup: () => request<{ id: number; file_name: string; file_size_label: string }>('/backups', { method: 'POST' }),
  restoreBackup: (backupId: number) =>
    request<{ restored: boolean; backup_id: number; restored_rows: number }>(`/backups/${backupId}/restore`, { method: 'POST' }),
};
