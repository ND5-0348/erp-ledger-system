import { OrderRecord, ProjectLedger } from '../types';

export interface DashboardMetricsInput {
  ledgers: ProjectLedger[];
  orders: OrderRecord[];
  department: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardMetrics {
  totalOrderAmount: number;
  grossProfit: number;
  orderCount: number;
  accountsReceivable: number;
  accountsPayable: number;
  closedCount: number;
}

export interface DashboardRankingItem {
  label: string;
  amount: number;
}

export interface DashboardFilters {
  department: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardTrendItem {
  month: string;
  orderAmount: number;
  profit: number;
}

function isClosedOrder(item: OrderRecord) {
  const status = item.orderStatus?.trim().toLowerCase() || '';
  return ['closed', '已关闭', '关闭', '已闭合', '已结案'].includes(status) || item.accountsReceivable === 0;
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
  const totals = new Map<string, number>();
  orders.filter(belongsToDashboardScope(department, startDate, endDate)).forEach((item) => {
    const label = department
      ? item.teamName?.trim() || '未登记三级团队'
      : item.department?.trim() || '未登记部门';
    totals.set(label, (totals.get(label) || 0) + Number(item.orderValue || 0));
  });

  return Array.from(totals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 5);
}

export function getDashboardTrendData(items: Array<ProjectLedger | OrderRecord>, filters: DashboardFilters): DashboardTrendItem[] {
  const totals = new Map<string, { orderAmount: number; profit: number }>();
  const dashboardScopeFilter = belongsToDashboardScope(filters.department, filters.startDate, filters.endDate);

  items.filter(dashboardScopeFilter).forEach((item) => {
    const month = item.orderDate.slice(0, 7);
    if (!month) return;
    const current = totals.get(month) || { orderAmount: 0, profit: 0 };
    const orderAmount = 'orderAmount' in item ? item.orderAmount : item.orderValue;
    const profit = 'orderAmount' in item
      ? item.orderAmount - item.purchaseAmount
      : Number(item.grossProfit ?? (item.orderValue - Number(item.purchaseAmount || 0)));
    current.orderAmount += Number(orderAmount || 0);
    current.profit += profit;
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
    totalOrderAmount: filteredOrders.reduce((sum, item) => sum + Number(item.orderValue || 0), 0),
    grossProfit: filteredOrders.reduce(
      (sum, item) => sum + Number(item.grossProfit ?? (item.orderValue - Number(item.purchaseAmount || 0))),
      0,
    ),
    orderCount: orderGroups.size,
    accountsReceivable: filteredOrders.reduce(
      (sum, item) => sum + Number(item.accountsReceivable ?? Math.max(item.orderValue - Number(item.totalReceived || 0), 0)),
      0,
    ),
    accountsPayable: filteredOrders.reduce(
      (sum, item) => sum + Number(item.accountsPayable ?? Math.max(Number(item.purchaseAmount || 0) - Number(item.totalPaid || 0), 0)),
      0,
    ),
    closedCount: [...orderGroups.values()].filter((lines) => lines.every(isClosedOrder)).length,
  };
}
