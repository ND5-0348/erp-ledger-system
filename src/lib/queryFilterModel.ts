import { isClosedStatus } from './ledgerStats';
import { OrderRecord, ProjectLedger, PurchaseRecord, SalesRecord } from '../types';

export type LedgerFilters = {
  projectId: string;
  department: string;
  manager: string;
  clientUnit: string;
  orderId: string;
  orderStatus: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  invoiceStartDate: string;
  invoiceEndDate: string;
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
  supplierName: '',
  startDate: '',
  endDate: '',
  invoiceStartDate: '',
  invoiceEndDate: '',
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

export function ledgerFiltersToQuery(filters: LedgerFilters): Record<string, string> {
  return {
    project_id: filters.projectId,
    department: filters.department,
    manager: filters.manager,
    client_unit: filters.clientUnit,
    order_id: filters.orderId,
    order_status: filters.orderStatus,
    supplier_name: filters.supplierName,
    start_date: filters.startDate,
    end_date: filters.endDate,
    invoice_start_date: filters.invoiceStartDate,
    invoice_end_date: filters.invoiceEndDate,
  };
}

export function getDepartmentOptions(records: Array<{ department?: string | null }>) {
  return Array.from(new Set(records.map((item) => item.department || '').filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
}

function normalizeStatus(status: string) {
  if (isClosedStatus(status)) {
    return 'closed';
  }
  return 'open';
}

export function applyLedgerFilters(
  ledgers: ProjectLedger[],
  filters: LedgerFilters,
  related: { orders?: OrderRecord[]; purchases?: PurchaseRecord[]; sales?: SalesRecord[] } = {},
) {
  const orderProjectIds = filters.orderId || filters.startDate || filters.endDate
    ? new Set(
        (related.orders || [])
          .filter((item) =>
            (!filters.orderId || item.orderId.toLowerCase().includes(filters.orderId.toLowerCase()))
            && (!filters.startDate || item.orderDate >= filters.startDate)
            && (!filters.endDate || item.orderDate <= filters.endDate),
          )
          .map((item) => item.projectId),
      )
    : null;
  const supplierProjectIds = filters.supplierName
    ? new Set(
        (related.purchases || [])
          .filter((item) => item.supplier.toLowerCase().includes(filters.supplierName.toLowerCase()))
          .map((item) => item.projectId),
      )
    : null;
  const invoiceProjectIds = filters.invoiceStartDate || filters.invoiceEndDate
    ? new Set(
        (related.sales || [])
          .filter((item) =>
            (item.invoiceDates || []).some((date) =>
              (!filters.invoiceStartDate || date >= filters.invoiceStartDate)
              && (!filters.invoiceEndDate || date <= filters.invoiceEndDate),
            ),
          )
          .map((item) => item.projectId),
      )
    : null;

  return ledgers.filter((item) => {
    if (filters.projectId && !item.id.toLowerCase().includes(filters.projectId.toLowerCase())) return false;
    if (filters.department && item.department !== filters.department) return false;
    if (filters.manager && !item.manager.toLowerCase().includes(filters.manager.toLowerCase())) return false;
    if (filters.clientUnit && !item.clientUnit.toLowerCase().includes(filters.clientUnit.toLowerCase())) return false;
    if (orderProjectIds && !orderProjectIds.has(item.id)) return false;
    if (filters.orderStatus && normalizeStatus(item.orderStatus) !== filters.orderStatus) return false;
    if (supplierProjectIds && !supplierProjectIds.has(item.id)) return false;
    if (invoiceProjectIds && !invoiceProjectIds.has(item.id)) return false;
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
