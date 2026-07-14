import { OrderRecord, ProjectLedger, PurchaseRecord, SalesRecord } from '../types';

export type LedgerFilters = {
  projectId: string;
  department: string;
  manager: string;
  clientUnit: string;
  orderId: string;
  orderStatus: string;
  startDate: string;
  endDate: string;
};

export type OrderFilters = {
  projectId: string;
  orderId: string;
  orderDate: string;
  businessType: string;
  clientUnit: string;
  supplierName: string;
  startDate: string;
  endDate: string;
};

export type PurchaseFilters = {
  projectId: string;
  orderId: string;
  manager: string;
  department: string;
  supplier: string;
  contractNo: string;
  paymentStartDate: string;
  paymentEndDate: string;
};

export type SalesFilters = {
  projectId: string;
  orderId: string;
  manager: string;
  department: string;
  supplier: string;
  contractNo: string;
  receiptStartDate: string;
  receiptEndDate: string;
};

export const emptyLedgerFilters: LedgerFilters = {
  projectId: '',
  department: '',
  manager: '',
  clientUnit: '',
  orderId: '',
  orderStatus: '',
  startDate: '',
  endDate: '',
};

export const emptyOrderFilters: OrderFilters = {
  projectId: '',
  orderId: '',
  orderDate: '',
  businessType: '',
  clientUnit: '',
  supplierName: '',
  startDate: '',
  endDate: '',
};

export const emptyPurchaseFilters: PurchaseFilters = {
  projectId: '',
  orderId: '',
  manager: '',
  department: '',
  supplier: '',
  contractNo: '',
  paymentStartDate: '',
  paymentEndDate: '',
};

export const emptySalesFilters: SalesFilters = {
  projectId: '',
  orderId: '',
  manager: '',
  department: '',
  supplier: '',
  contractNo: '',
  receiptStartDate: '',
  receiptEndDate: '',
};

export function submitQueryFilters<T extends Record<string, string>>(filters: T): T {
  return { ...filters };
}

export function getDepartmentOptions(records: Array<{ department?: string | null }>) {
  return Array.from(new Set(records.map((item) => item.department || '').filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
}

function normalizeStatus(status: string) {
  if (status === 'closed' || status.includes('关') || status.includes('闭') || status.includes('完成')) {
    return 'closed';
  }
  return 'open';
}

export function applyLedgerFilters(ledgers: ProjectLedger[], filters: LedgerFilters) {
  return ledgers.filter((item) => {
    if (filters.projectId && !item.id.toLowerCase().includes(filters.projectId.toLowerCase())) return false;
    if (filters.department && item.department !== filters.department) return false;
    if (filters.manager && !item.manager.toLowerCase().includes(filters.manager.toLowerCase())) return false;
    if (filters.clientUnit && !item.clientUnit.toLowerCase().includes(filters.clientUnit.toLowerCase())) return false;
    if (filters.orderId && !item.orderId.toLowerCase().includes(filters.orderId.toLowerCase())) return false;
    if (filters.orderStatus && normalizeStatus(item.orderStatus) !== filters.orderStatus) return false;
    if (filters.startDate && item.orderDate < filters.startDate) return false;
    if (filters.endDate && item.orderDate > filters.endDate) return false;
    return true;
  });
}

export function applyOrderFilters(orders: OrderRecord[], filters: OrderFilters) {
  return orders.filter((item) => {
    if (filters.projectId && !item.projectId.toLowerCase().includes(filters.projectId.toLowerCase())) return false;
    if (filters.orderId && !item.orderId.toLowerCase().includes(filters.orderId.toLowerCase())) return false;
    if (filters.orderDate && item.orderDate !== filters.orderDate) return false;
    if (filters.businessType && !item.businessType.toLowerCase().includes(filters.businessType.toLowerCase())) return false;
    if (filters.clientUnit && !item.clientUnit.toLowerCase().includes(filters.clientUnit.toLowerCase())) return false;
    if (filters.supplierName && !(item.supplierName || '').toLowerCase().includes(filters.supplierName.toLowerCase())) return false;
    if (filters.startDate && item.orderDate < filters.startDate) return false;
    if (filters.endDate && item.orderDate > filters.endDate) return false;
    return true;
  });
}

export function applyPurchaseFilters(purchases: PurchaseRecord[], filters: PurchaseFilters) {
  return purchases.filter((item) => {
    if (filters.projectId && !item.projectId.toLowerCase().includes(filters.projectId.toLowerCase())) return false;
    if (filters.orderId && !item.orderId.toLowerCase().includes(filters.orderId.toLowerCase())) return false;
    if (filters.manager && !item.manager.toLowerCase().includes(filters.manager.toLowerCase())) return false;
    if (filters.department && item.department !== filters.department) return false;
    if (filters.supplier && !item.supplier.toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (filters.contractNo && !item.contractNo.toLowerCase().includes(filters.contractNo.toLowerCase())) return false;
    if (filters.paymentStartDate && (!item.paymentDate || item.paymentDate < filters.paymentStartDate)) return false;
    if (filters.paymentEndDate && (!item.paymentDate || item.paymentDate > filters.paymentEndDate)) return false;
    return true;
  });
}

export function applySalesFilters(sales: SalesRecord[], filters: SalesFilters) {
  return sales.filter((item) => {
    if (filters.projectId && !item.projectId.toLowerCase().includes(filters.projectId.toLowerCase())) return false;
    if (filters.orderId && !item.orderId.toLowerCase().includes(filters.orderId.toLowerCase())) return false;
    if (filters.manager && !item.manager.toLowerCase().includes(filters.manager.toLowerCase())) return false;
    if (filters.department && item.department !== filters.department) return false;
    if (filters.supplier && !(item.supplierName || '').toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (filters.contractNo && !item.contractNo.toLowerCase().includes(filters.contractNo.toLowerCase())) return false;
    if (filters.receiptStartDate && (!item.receiptDate || item.receiptDate < filters.receiptStartDate)) return false;
    if (filters.receiptEndDate && (!item.receiptDate || item.receiptDate > filters.receiptEndDate)) return false;
    return true;
  });
}
