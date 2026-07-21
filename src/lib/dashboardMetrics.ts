import { OrderRecord, ProjectLedger } from '../types';

export interface DashboardMetricsInput {
  ledgers: ProjectLedger[];
  orders: OrderRecord[];
  department: string;
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

function isClosedLedger(item: ProjectLedger) {
  const status = item.orderStatus.trim().toLowerCase();
  return ['closed', '已关闭', '关闭', '已闭合', '已结案'].includes(status);
}

function belongsToDepartment(department: string) {
  return (item: ProjectLedger | OrderRecord) => !department || item.department === department;
}

export function getDashboardDepartments(items: Array<ProjectLedger | OrderRecord>) {
  const departments = items
    .map((item) => item.department?.trim())
    .filter((department): department is string => Boolean(department));
  return Array.from(new Set(departments)).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
}

export function getDashboardSalesRanking(orders: OrderRecord[], department: string): DashboardRankingItem[] {
  const totals = new Map<string, number>();
  orders.forEach((item) => {
    if (department && item.department !== department) return;
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

export function getDashboardMetrics({ ledgers, orders, department }: DashboardMetricsInput): DashboardMetrics {
  const departmentFilter = belongsToDepartment(department);
  const filteredLedgers = ledgers.filter(departmentFilter);
  const filteredOrders = orders.filter(departmentFilter);

  return {
    totalOrderAmount: filteredLedgers.reduce((sum, item) => sum + item.orderAmount, 0),
    grossProfit: filteredLedgers.reduce((sum, item) => sum + (item.orderAmount - item.purchaseAmount), 0),
    orderCount: filteredOrders.length,
    accountsReceivable: filteredLedgers.reduce((sum, item) => sum + Math.max(item.orderAmount - item.totalReceived, 0), 0),
    accountsPayable: filteredLedgers.reduce((sum, item) => sum + Math.max(item.purchaseAmount - item.totalReceived, 0), 0),
    closedCount: filteredLedgers.filter(isClosedLedger).length,
  };
}
