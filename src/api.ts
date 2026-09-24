export interface EditContext { data_epoch: number; projects: Record<string,number> }
export function combineEditContexts(contexts: Array<EditContext | undefined>): EditContext | undefined {
  const available=contexts.filter((c): c is EditContext => Boolean(c));
  if (!available.length || available.length!==contexts.length) return undefined;
  const result: EditContext={data_epoch:available[0].data_epoch,projects:{}};
  for (const c of available) {
    if(c.data_epoch!==result.data_epoch) throw new Error('数据已恢复或替换，请重新打开编辑界面');
    for(const [id,version] of Object.entries(c.projects)) {
      if(result.projects[id]!==undefined && result.projects[id]!==version) throw new Error('项目版本不一致，请重新打开编辑界面');
      result.projects[id]=version;
    }
  }
  return result;
}
export interface BackendHistory { edit_context?: EditContext; order_number_history?: string[]; manager_history?: string[] }
export interface HistoryContext {
  edit_context?: EditContext;
  current: { order_line_id: number; sales_order_id: number; project_id: number; project_code: string; order_no: string; account_manager: string | null; department: string | null; branch_company: string | null; team_level3_name: string | null };
  order_numbers: Array<{ order_no: string; history_order: number; source: string }>;
  managers: Array<{ manager_name: string; history_order: number; effective_from: string | null; source: string }>;
  affected_lines: number;
}
const API_BASE = ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL) || '/api';
import type { PreviewCreated, PreviewPage, PreviewResult, PreviewSummary, RowResolution } from './lib/legacyImportPreview';
import type { SourceImportResult, ImportBatch, ImportBatchDetail } from './lib/importReview';
import type { MoneyValue } from './lib/money';

export const UNAUTHORIZED_EVENT = 'erp:unauthorized';

let authToken = '';

export function setApiToken(token: string) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  report?: {total_rows: number; valid_rows: number; skipped_rows: number; error_count: number; errors: import('./lib/importReport').ImportIssue[]};

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
  orderAmount: MoneyValue;
  grossProfit: MoneyValue;
  orderCount: number;
  accountsReceivable: MoneyValue;
  deliveryAccountsReceivable: MoneyValue;
  invoiceAccountsReceivable: MoneyValue;
  accountsPayable: MoneyValue;
  closedCount: number;
}

export interface BackendProjectLedger extends BackendHistory {
  delivery_value?: MoneyValue;
  delivery_cost?: MoneyValue;
  total_paid?: MoneyValue;
  sales_invoice_amount?: MoneyValue;
  received_invoice_amount?: MoneyValue;
  project_code: string;
  project_name: string | null;
  department: string | null;
  branch_company: string | null;
  account_manager: string | null;
  customer_unit_name: string | null;
  first_order_date: string | null;
  last_order_date: string | null;
  order_count: number;
  order_amount: MoneyValue;
  purchase_amount: MoneyValue;
  total_received: MoneyValue;
  delivery_accounts_receivable?: MoneyValue | null;
  invoice_accounts_receivable?: MoneyValue | null;
  accounts_receivable: MoneyValue;
  accounts_payable: MoneyValue;
  gross_profit: MoneyValue;
  computed_close_status: string;
}

export interface BackendOrderRecord extends BackendHistory {
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
  quantity: MoneyValue | null;
  sales_tax_rate?: number | null;
  net_unit_price?: MoneyValue | null;
  unit_price?: MoneyValue | null;
  net_revenue?: MoneyValue | null;
  order_value: MoneyValue | null;
  sales_tax_amount?: MoneyValue | null;
  delivery_quantity: MoneyValue | null;
  business_type: string | null;
  customer_unit_name: string | null;
  user_name?: string | null;
  regional_platform?: string | null;
  supplier_name?: string | null;
  purchase_tax_rate?: number | null;
  purchase_unit_price_no_tax?: MoneyValue | null;
  purchase_unit_price?: MoneyValue | null;
  cost_no_tax?: MoneyValue | null;
  purchase_amount?: MoneyValue | null;
  purchase_tax_amount?: MoneyValue | null;
  labor_cost?: MoneyValue | null;
  other_cost?: MoneyValue | null;
  delivery_date?: string | null;
  delivery_revenue_no_tax?: MoneyValue | null;
  delivery_value?: MoneyValue | null;
  delivery_cost_no_tax?: MoneyValue | null;
  delivery_cost?: MoneyValue | null;
  pending_delivery_quantity?: MoneyValue | null;
  pending_delivery_amount_no_tax?: MoneyValue | null;
  pending_delivery_amount?: MoneyValue | null;
  total_received?: MoneyValue | null;
  total_paid?: MoneyValue | null;
  delivery_accounts_receivable?: MoneyValue | null;
  invoice_accounts_receivable?: MoneyValue | null;
  accounts_receivable?: MoneyValue | null;
  accounts_payable?: MoneyValue | null;
  gross_profit?: MoneyValue | null;
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
  edit_context?: EditContext;
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

export interface BackendPurchaseRecord extends BackendHistory {
  payment_phases?: Array<{date: string | null; amount: number | null}>;
  order_line_id: number;
  project_code: string;
  order_no: string;
  account_manager: string | null;
  department: string | null;
  supplier_name: string | null;
  purchase_contract_no: string | null;
  purchase_contract_signed_amount: MoneyValue | null;
  purchase_amount: MoneyValue | null;
  received_invoice_amount: MoneyValue | null;
  total_paid: MoneyValue | null;
  accounts_payable: MoneyValue | null;
  latest_payment_date?: string | null;
}

export interface BackendPurchaseContract {
  id: number;
  purchase_contract_no: string | null;
  payment_terms: string | null;
  performance_period: string | null;
  signed_amount: MoneyValue | null;
  unsigned_amount: MoneyValue | null;
}

export interface BackendPurchaseInvoice {
  id: number;
  phase_no: number;
  received_invoice_date: string | null;
  received_invoice_date_text: string | null;
  invoice_no: string | null;
  invoice_amount: MoneyValue | null;
}

export interface BackendPurchasePayment {
  id: number;
  phase_no: number;
  due_payment_date: string | null;
  payment_date: string | null;
  payment_date_text: string | null;
  payment_voucher_no: string | null;
  payment_amount: MoneyValue | null;
}

export interface BackendWarehouseEntry {
  id: number;
  phase_no: number;
  warehouse_date: string | null;
  warehouse_date_text: string | null;
  voucher_no: string | null;
  warehouse_amount: MoneyValue | null;
  warehouse_amount_no_tax: MoneyValue | null;
}

export interface BackendFinanceInvoiceCheck {
  id: number;
  phase_no: number;
  received_invoice_date: string | null;
  received_invoice_date_text: string | null;
  received_invoice_amount: MoneyValue | null;
  voucher_code: string | null;
}

export interface BackendFinancePayment {
  id: number;
  phase_no: number;
  payment_date: string | null;
  payment_date_text: string | null;
  voucher_code: string | null;
  booked_amount: MoneyValue | null;
}

export interface BackendPurchaseDetail {
  edit_context?: EditContext;
  summary: Record<string, string | number | null>;
  contracts: BackendPurchaseContract[];
  invoices: BackendPurchaseInvoice[];
  warehouse_entries: BackendWarehouseEntry[];
  finance_invoice_checks: BackendFinanceInvoiceCheck[];
  finance_payments: BackendFinancePayment[];
  payments: BackendPurchasePayment[];
}

export interface BackendSalesRecord extends BackendHistory {
  receipt_phases?: Array<{date: string | null; amount: number | null}>;
  invoice_phases?: Array<{date: string | null; amount: number | null}>;
  order_line_id: number;
  project_code: string;
  order_no: string;
  account_manager: string | null;
  department: string | null;
  sales_contract_no: string | null;
  sales_contract_signed_date: string | null;
  sales_contract_value: MoneyValue | null;
  sales_invoice_amount: MoneyValue | null;
  total_received: MoneyValue | null;
  delivery_accounts_receivable?: MoneyValue | null;
  invoice_accounts_receivable?: MoneyValue | null;
  accounts_receivable: MoneyValue | null;
  supplier_name?: string | null;
  latest_receipt_date?: string | null;
  invoice_dates?: string | null;
}

export interface BackendSalesContract {
  id: number;
  contract_signed_date: string | null;
  contract_signed_date_text: string | null;
  sales_contract_no: string | null;
  contract_value: MoneyValue | null;
  performance_period: string | null;
  unsigned_contract_amount: MoneyValue | null;
}

export interface BackendSalesInvoice {
  id: number;
  order_line_id?: number;
  phase_no: number;
  invoice_doc_no: string | null;
  invoice_date: string | null;
  invoice_date_text: string | null;
  invoice_no: string | null;
  invoice_amount: MoneyValue | null;
  pending_invoice_amount: MoneyValue | null;
  delivered_not_invoiced_amount: MoneyValue | null;
}

export interface BackendSalesReceipt {
  id: number;
  order_line_id?: number;
  phase_no: number;
  receipt_date: string | null;
  receipt_date_text: string | null;
  payment_notice_no: string | null;
  receipt_amount: MoneyValue | null;
  receipt_ratio: number | null;
}

export interface BackendSalesDetail {
  edit_context?: EditContext;
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
    ...init,
    headers: {...headers, ...init?.headers},
  });
  if (!response.ok) {
    const body = await response.text();
    const message = parseErrorMessage(body) || `HTTP ${response.status}`;
    if (response.status === 401) {
      authToken = '';
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const error=new ApiError(response.status, message);
    try { error.code=JSON.parse(body).detail?.code; } catch { /* Text errors have no code. */ }
    if (response.status === 409 && error.code==='EDIT_CONFLICT') window.dispatchEvent(new CustomEvent('erp:edit-conflict'));
    throw error;
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

async function uploadExcel<T>(path: string, file: File, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ...extraHeaders,
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
  const error = new ApiError(response.status, message);
  try { error.report = JSON.parse(body).report; } catch { /* Plain errors remain readable. */ }
  throw error;
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

export function editingApi(editContext?: EditContext) {
  const editRequest = <T>(path: string, init?: RequestInit) => request<T>(path, {...init,headers:{...init?.headers,...(editContext ? {'X-Edit-Context':JSON.stringify(editContext)} : {})}});
  return {
  createLegacyPreview: (file: File) => uploadExcel<PreviewCreated>(`/orders/import-preview${query({ filename: file.name })}`, file),
  importSource: (file: File, preview: boolean, duplicateToken?: string) => uploadExcel<SourceImportResult>(`/orders/source-import${query({ filename: file.name, preview: String(preview) })}`, file, duplicateToken ? { 'X-Duplicate-Confirmation': duplicateToken } : undefined),
  importBatches: (offset = 0) => editRequest<{ total: number; items: ImportBatch[] }>(`/import-batches?offset=${offset}&limit=20`),
  importBatch: (id: number) => editRequest<ImportBatchDetail>(`/import-batches/${id}`),
  revertImportBatch: (id: number, token: string, confirmation: string) => editRequest<{ reverted_rows: number }>(`/import-batches/${id}/revert`, { method: 'POST', body: JSON.stringify({ token, confirmation }) }),
  getLegacyPreview: (sessionId: string, offset = 0, limit = 20) =>
    editRequest<PreviewPage>(`/orders/import-preview/${encodeURIComponent(sessionId)}${query({ offset, limit })}`),
  resolveLegacyPreview: (sessionId: string, items: Array<{ excel_row_no: number; resolution: RowResolution }>) =>
    editRequest<{ updated: number; summary: PreviewSummary }>(`/orders/import-preview/${encodeURIComponent(sessionId)}/resolutions`, {
      method: 'PUT', body: JSON.stringify({ items }),
    }),
  commitLegacyPreview: (sessionId: string, file: File) =>
    uploadExcel<PreviewResult>(`/orders/import-preview/${encodeURIComponent(sessionId)}/commit`, file),
  setToken: setApiToken,
  login: (data: { username: string; password: string }) =>
    editRequest<{ access_token: string; token_type: string; user: BackendAuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => editRequest<{ user: BackendAuthUser }>('/auth/me'),
  users: (status: 'active' | 'inactive' = 'active') =>
    editRequest<{ items: BackendUserRecord[] }>(`/auth/users${query({ status })}`),
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
    editRequest<{ items: BackendUserRecord[] }>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),
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
  ) => editRequest<{ items: BackendUserRecord[] }>(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserPassword: (userId: number, password: string) =>
    editRequest<{ message: string }>(`/auth/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  deactivateUser: (userId: number) =>
    editRequest<{ items: BackendUserRecord[] }>(`/auth/users/${userId}`, { method: 'DELETE' }),
  restoreUser: (userId: number) =>
    editRequest<{ items: BackendUserRecord[] }>(`/auth/users/${userId}/restore`, { method: 'POST' }),
  permanentlyDeleteUser: (userId: number) =>
    editRequest<{ items: BackendUserRecord[] }>(`/auth/users/${userId}/permanent`, { method: 'DELETE' }),
  history: (id: number) => editRequest<HistoryContext>(`/history/lines/${id}`),
  renameOrders: (items: Array<{order_line_id: number; expected_order_no: string; order_no: string; reason: string}>) => editRequest<{updated: number}>('/history/rename-orders', {method:'POST',body:JSON.stringify({items})}),
  transferProject: (data: unknown) => editRequest<{updated: boolean}>('/history/transfer-project', {method:'POST',body:JSON.stringify(data)}),
  exportHistory: (params: Record<string,string | number | undefined> = {}) => requestBlob(`/history/export${query(params)}`),
  health: () => editRequest<BackendHealth>('/health'),
  importStatus: (sha256: string) => editRequest<{items: Array<{id:number;source_file_name:string;success_rows:number;uploaded_at:string}>; message:string}>(`/orders/import-status${query({sha256})}`),
  maintenanceFiles: () => editRequest<{items: string[]}>('/import/files'),
  previewMaintenance: (file_name: string) => editRequest<import('./lib/importReport').MaintenanceReport>('/import/preview', {method:'POST', body:JSON.stringify({file_name})}),
  replaceMaintenance: async (file_name: string, token: string, confirmation: string) => {
    try { return await editRequest<{success_rows: number; batch_id: number; backup_id: number}>('/import/excel', {method:'POST', body:JSON.stringify({file_name,token,confirmation})}); }
    catch(error) {
      if (error instanceof TypeError || (error instanceof ApiError && error.status>=500)) throw new Error('未能确认替换结果。请先刷新业务数据并核对操作日志中的替换批次，不要重复提交；必要时重新预检。');
      throw error;
    }
  },
  dashboardSummary: () => editRequest<BackendDashboardSummary>('/dashboard/summary'),
  ledgers: (params: Record<string, string | number | undefined> = {}) =>
    editRequest<PageResult<BackendProjectLedger>>(`/ledgers${query(params)}`),
  orders: (params: Record<string, string | number | undefined> = {}) =>
    editRequest<PageResult<BackendOrderRecord>>(`/orders${query(params)}`),
  createOrder: (data: Record<string, string | number | null>) =>
    editRequest<BackendOrderRecord>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  createOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    editRequest<{ created: number; order_line_ids: number[] }>('/orders/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  batchOrderEditorSchema: () => editRequest<BackendBatchEditorResponse>('/orders/batch-editor/schema'),
  batchOrderEditorRows: (orderLineIds: number[]) =>
    editRequest<BackendBatchEditorResponse>('/orders/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  createBasicOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    editRequest<{ created: number; order_line_ids: number[] }>('/orders/batch-basic', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  updateBasicOrdersBatch: (items: Array<Record<string, string | number | null>>) =>
    editRequest<{ updated: number; order_line_ids: number[] }>('/orders/batch-basic', {
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
      source_sha256: string;
    }>(
      `/orders/import-excel${query({ filename: file.name })}`,
      file,
    ),
  updateOrder: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendOrderRecord>(`/orders/${orderLineId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrder: (orderLineId: number) => editRequest<{ deleted: boolean; order_line_id: number }>(`/orders/${orderLineId}`, { method: 'DELETE' }),
  purchases: (params: Record<string, string | number | undefined> = {}) =>
    editRequest<PageResult<BackendPurchaseRecord>>(`/purchases${query(params)}`),
  batchPurchaseEditorRows: (orderLineIds: number[]) =>
    editRequest<BackendBatchEditorResponse>('/purchases/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  updatePurchasesBatch: (items: Array<Record<string, string | number | null>>) =>
    editRequest<{ updated: number; order_line_ids: number[] }>('/purchases/batch', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  purchaseDetail: (orderLineId: number) => editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}`),
  updatePurchaseSummary: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/summary`, { method: 'PUT', body: JSON.stringify(data) }),
  addPurchaseContract: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseContract: (contractId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseContract: (contractId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/contracts/${contractId}`, { method: 'DELETE' }),
  addPurchaseInvoice: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/invoices`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseInvoice: (invoiceId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/invoices/${invoiceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseInvoice: (invoiceId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/invoices/${invoiceId}`, { method: 'DELETE' }),
  addWarehouseEntry: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/warehouse-entries`, { method: 'POST', body: JSON.stringify(data) }),
  updateWarehouseEntry: (entryId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/warehouse-entries/${entryId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWarehouseEntry: (entryId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/warehouse-entries/${entryId}`, { method: 'DELETE' }),
  addFinanceInvoiceCheck: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/finance-invoice-checks`, { method: 'POST', body: JSON.stringify(data) }),
  updateFinanceInvoiceCheck: (checkId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/finance-invoice-checks/${checkId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFinanceInvoiceCheck: (checkId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/finance-invoice-checks/${checkId}`, { method: 'DELETE' }),
  addFinancePayment: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/finance-payments`, { method: 'POST', body: JSON.stringify(data) }),
  updateFinancePayment: (paymentId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/finance-payments/${paymentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFinancePayment: (paymentId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/finance-payments/${paymentId}`, { method: 'DELETE' }),
  addPurchasePayment: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/${orderLineId}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  updatePurchasePayment: (paymentId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendPurchaseDetail>(`/purchases/payments/${paymentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchasePayment: (paymentId: number) =>
    editRequest<BackendPurchaseDetail>(`/purchases/payments/${paymentId}`, { method: 'DELETE' }),
  sales: (params: Record<string, string | number | undefined> = {}) =>
    editRequest<PageResult<BackendSalesRecord>>(`/sales${query(params)}`),
  batchSalesEditorRows: (orderLineIds: number[]) =>
    editRequest<BackendBatchEditorResponse>('/sales/batch-editor/rows', {
      method: 'POST',
      body: JSON.stringify({ order_line_ids: orderLineIds }),
    }),
  updateSalesBatch: (items: Array<Record<string, string | number | null>>) =>
    editRequest<{ updated: number; order_line_ids: number[] }>('/sales/batch', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  salesDetail: (orderLineId: number) => editRequest<BackendSalesDetail>(`/sales/${orderLineId}`),
  salesDetailByOrder: (projectId: string, orderId: string) =>
    editRequest<BackendSalesDetail>(`/sales/by-order${query({ project_id: projectId, order_id: orderId })}`),
  addSalesContract: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/${orderLineId}/contracts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesContract: (contractId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/contracts/${contractId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesContract: (contractId: number) =>
    editRequest<BackendSalesDetail>(`/sales/contracts/${contractId}`, { method: 'DELETE' }),
  addSalesInvoice: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/${orderLineId}/invoices`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesInvoice: (invoiceId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/invoices/${invoiceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesInvoice: (invoiceId: number) =>
    editRequest<BackendSalesDetail>(`/sales/invoices/${invoiceId}`, { method: 'DELETE' }),
  addSalesReceipt: (orderLineId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/${orderLineId}/receipts`, { method: 'POST', body: JSON.stringify(data) }),
  updateSalesReceipt: (receiptId: number, data: Record<string, string | number | null>) =>
    editRequest<BackendSalesDetail>(`/sales/receipts/${receiptId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSalesReceipt: (receiptId: number) =>
    editRequest<BackendSalesDetail>(`/sales/receipts/${receiptId}`, { method: 'DELETE' }),
  logs: () => editRequest<PageResult<BackendOperationLog>>('/logs?limit=100'),
  backups: () => editRequest<PageResult<BackendBackupInfo>>('/backups?limit=100'),
  verifyBackup: (id: number) => editRequest<{verified: boolean; message: string}>(`/backups/${id}/verify`),
  createBackup: () => editRequest<{ id: number; file_name: string; file_size_label: string }>('/backups', { method: 'POST' }),
  restoreBackup: (backupId: number) =>
    editRequest<{ restored: boolean; backup_id: number; restored_rows: number }>(`/backups/${backupId}/restore`, { method: 'POST' }),
};
}
export const api = editingApi();
