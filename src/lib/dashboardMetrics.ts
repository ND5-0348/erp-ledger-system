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

function isClosedLedger(item: ProjectLedger) {
  const status = item.orderStatus.trim().toLowerCase();
  return ['closed', '已关闭', '关闭', '已闭合', '已结案'].includes(status);
}

function belongsToDepartment(department: string) {
  return (item: ProjectLedger | OrderRecord) => !department || item.department === department;
}

export function getDashboardDepartments(ledgers: ProjectLedger[]) {
  return Array.from(new Set(ledgers.map((item) => item.department).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
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
