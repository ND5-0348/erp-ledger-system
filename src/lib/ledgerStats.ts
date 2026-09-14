import { OrderRecord, ProjectLedger, SalesRecord } from '../types';
import type { LedgerFilters } from './queryFilterModel';

export function isClosedStatus(status: string) {
  return ['closed', '已关闭', '关闭', '已闭合', '已结案', '已完成', '已完工'].includes(status.trim());
}

export function getLedgerStats(items: ProjectLedger[], scope?: {
  orders: OrderRecord[];
  sales: SalesRecord[];
  filters: LedgerFilters;
}) {
  const completedCount = items.filter(item => isClosedStatus(item.orderStatus)).length;
  let totalOrderVal = items.reduce((sum, item) => sum + item.orderAmount, 0);
  const filters = scope?.filters;
  if (scope && filters && (filters.startDate || filters.endDate || filters.invoiceStartDate || filters.invoiceEndDate)) {
    const projectIds = new Set(items.map(item => item.id));
    const hasInvoiceDates = Boolean(filters.invoiceStartDate || filters.invoiceEndDate);
    const invoiceLineIds = new Set(scope.sales.filter(item =>
      item.orderLineId !== undefined && (item.invoiceDates || []).some(date =>
        (!filters.invoiceStartDate || date >= filters.invoiceStartDate)
        && (!filters.invoiceEndDate || date <= filters.invoiceEndDate),
      ),
    ).map(item => item.orderLineId));
    totalOrderVal = scope.orders.filter(item => {
      if (!projectIds.has(item.projectId)) return false;
      if (filters.orderId && !item.orderId.toLowerCase().includes(filters.orderId.toLowerCase())) return false;
      if (filters.supplierName && !(item.supplierName || '').toLowerCase().includes(filters.supplierName.toLowerCase())) return false;
      const orderDate = item.orderDate?.slice(0, 10) || '';
      if ((filters.startDate || filters.endDate) && !orderDate) return false;
      if (filters.startDate && orderDate < filters.startDate) return false;
      if (filters.endDate && orderDate > filters.endDate) return false;
      if (hasInvoiceDates && (item.orderLineId === undefined || !invoiceLineIds.has(item.orderLineId))) return false;
      return true;
    }).reduce((sum, item) => sum + Number(item.orderValue || 0), 0);
  }
  return {
    totalOrderVal,
    completedCount,
    inProgressCount: items.length - completedCount,
  };
}
