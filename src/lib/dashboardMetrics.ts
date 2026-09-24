import { OrderRecord, ProjectLedger } from '../types';
import { compareMoney, differenceMoney, sumMoney } from './money';

export interface DashboardMetricsInput {
  ledgers: ProjectLedger[];
  orders: OrderRecord[];
  department: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardMetrics {
  totalOrderAmount: string;
  grossProfit: string;
  orderCount: number;
  accountsReceivable: string;
  deliveryAccountsReceivable: string;
  invoiceAccountsReceivable: string;
  accountsPayable: string;
  closedCount: number;
}

export interface DashboardRankingItem {
  label: string;
  amount: string;
}

export interface DashboardFilters {
  department: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardTrendItem {
  month: string;
  orderAmount: string;
  profit: string;
}

function isClosedOrder(item: OrderRecord) {
  const status = item.orderStatus?.trim().toLowerCase() || '';
  return ['closed', '已关闭', '关闭', '已闭合', '已结案'].includes(status) || (item.accountsReceivable !== undefined && compareMoney(item.accountsReceivable, 0) === 0);
}

function hasOrderDateInRange(orderDate: string | undefined, startDate = '', endDate = '') {
  const normalizedDate = orderDate?.slice(0, 10) || '';
  if (!normalizedDate) return !startDate && !endDate;
  return (!startDate || normalizedDate >= startDate) && (!endDate || normalizedDate <= endDate);
}

function belongsToDashboardScope(department: string, startDate = '', endDate = '') {
  return (item: ProjectLedger | OrderRecord) =>
    (!department || item.department === department) && hasOrderDateInRange(item.orderDate, startDate, endDate);
}

export function getDashboardDepartments(items: Array<ProjectLedger | OrderRecord>) {
  const departments = items
    .map((item) => item.department?.trim())
    .filter((department): department is string => Boolean(department));
  return Array.from(new Set(departments)).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
}

export function getDashboardSalesRanking(
  orders: OrderRecord[],
  department: string,
  startDate = '',
  endDate = '',
): DashboardRankingItem[] {
  const totals = new Map<string, string>();
  orders.filter(belongsToDashboardScope(department, startDate, endDate)).forEach((item) => {
    const label = department
      ? item.teamName?.trim() || '未登记三级团队'
      : item.department?.trim() || '未登记部门';
    totals.set(label, sumMoney(totals.get(label), item.orderValue));
  });

  return Array.from(totals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .filter((item) => compareMoney(item.amount, 0) > 0)
    .sort((a, b) => compareMoney(b.amount, a.amount) || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 5);
}

export function getDashboardTrendData(items: Array<ProjectLedger | OrderRecord>, filters: DashboardFilters): DashboardTrendItem[] {
  const totals = new Map<string, { orderAmount: string; profit: string }>();
  const dashboardScopeFilter = belongsToDashboardScope(filters.department, filters.startDate, filters.endDate);

  items.filter(dashboardScopeFilter).forEach((item) => {
    const month = item.orderDate.slice(0, 7);
    if (!month) return;
    const current = totals.get(month) || { orderAmount: '0.00', profit: '0.00' };
    const orderAmount = 'orderAmount' in item ? item.orderAmount : item.orderValue;
    const profit = 'orderAmount' in item
      ? differenceMoney(item.orderAmount, item.purchaseAmount)
      : item.grossProfit ?? differenceMoney(item.orderValue, item.purchaseAmount);
    current.orderAmount = sumMoney(current.orderAmount, orderAmount);
    current.profit = sumMoney(current.profit, profit);
    totals.set(month, current);
  });

  return Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, totals]) => ({ month, ...totals }));
}

export function getDashboardLatestModifiedAt(orders: OrderRecord[], filters: DashboardFilters) {
  return orders
    .filter(belongsToDashboardScope(filters.department, filters.startDate, filters.endDate))
    .map((item) => item.updatedAt?.replace('T', ' ').slice(0, 19) || '')
    .filter(Boolean)
    .reduce((latest, timestamp) => (timestamp > latest ? timestamp : latest), '');
}

export function getDashboardMetrics({ orders, department, startDate, endDate }: DashboardMetricsInput): DashboardMetrics {
  const dashboardScopeFilter = belongsToDashboardScope(department, startDate, endDate);
  const filteredOrders = orders.filter(dashboardScopeFilter);
  const orderGroups = new Map<string, OrderRecord[]>();
  filteredOrders.forEach((item) => {
    const key = JSON.stringify([item.projectId, item.orderId]);
    const lines = orderGroups.get(key) || [];
    lines.push(item);
    orderGroups.set(key, lines);
  });

  return {
    totalOrderAmount: sumMoney(...filteredOrders.map(item => item.orderValue)),
    grossProfit: sumMoney(...filteredOrders.map(item => item.grossProfit ?? differenceMoney(item.orderValue, item.purchaseAmount))),
    orderCount: orderGroups.size,
    accountsReceivable: sumMoney(...filteredOrders.map(item => item.accountsReceivable ??
      (compareMoney(item.orderValue, item.totalReceived) > 0 ? differenceMoney(item.orderValue, item.totalReceived) : '0.00'))),
    deliveryAccountsReceivable: sumMoney(...filteredOrders.map(item => item.deliveryAccountsReceivable ?? differenceMoney(item.deliveryValue, item.totalReceived))),
    invoiceAccountsReceivable: sumMoney(...filteredOrders.map(item => item.invoiceAccountsReceivable)),
    accountsPayable: sumMoney(...filteredOrders.map(item => item.accountsPayable ??
      (compareMoney(item.purchaseAmount, item.totalPaid) > 0 ? differenceMoney(item.purchaseAmount, item.totalPaid) : '0.00'))),
    closedCount: [...orderGroups.values()].filter((lines) => lines.every(isClosedOrder)).length,
  };
}
