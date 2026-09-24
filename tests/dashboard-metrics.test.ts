import assert from 'node:assert/strict';

import * as dashboardMetrics from '../src/lib/dashboardMetrics';
import { getDashboardDepartments, getDashboardMetrics, getDashboardSalesRanking } from '../src/lib/dashboardMetrics';
import { OrderRecord, ProjectLedger } from '../src/types';

const ledgers: ProjectLedger[] = [
  {
    id: 'P-1',
    clientUnit: '客户A',
    projectName: '项目A',
    orderAmount: 1000,
    purchaseAmount: 400,
    totalReceived: 250,
    department: '科贸部',
    manager: '张三',
    orderId: '1 个订单',
    orderStatus: '已关闭',
    orderDate: '2026-01-01',
  },
  {
    id: 'P-2',
    clientUnit: '客户B',
    projectName: '项目B',
    orderAmount: 500,
    purchaseAmount: 200,
    totalReceived: 100,
    department: '物流部',
    manager: '李四',
    orderId: '1 个订单',
    orderStatus: '进行中',
    orderDate: '2026-02-02',
  },
  {
    id: 'P-3',
    clientUnit: '客户C',
    projectName: '项目C',
    orderAmount: 300,
    purchaseAmount: 180,
    totalReceived: 0,
    department: '科贸部',
    manager: '王五',
    orderId: '1 个订单',
    orderStatus: '未关闭',
    orderDate: '2026-03-03',
  },
];

const orders: OrderRecord[] = [
  {
    projectId: 'P-1',
    department: '科贸部',
    teamName: '商贸集成团队',
    orderId: 'SO-1',
    orderDate: '2026-01-01',
    goodsName: '设备',
    quantity: '1 台',
    orderValue: 1000,
    purchaseAmount: 400,
    totalReceived: 250,
    totalPaid: 150,
    orderStatus: '已关闭',
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户A',
  },
  {
    projectId: 'P-2',
    department: '物流部',
    teamName: '集客物流团队',
    orderId: 'SO-2',
    orderDate: '2026-02-02',
    goodsName: '材料',
    quantity: '1 批',
    orderValue: 500,
    purchaseAmount: 200,
    totalReceived: 100,
    totalPaid: 100,
    orderStatus: '进行中',
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户B',
  },
  {
    projectId: 'P-3',
    department: '科贸部',
    teamName: '创新业务团队',
    orderId: 'SO-3',
    orderDate: '2026-03-03',
    goodsName: '服务',
    quantity: '1 项',
    orderValue: 300,
    purchaseAmount: 180,
    totalReceived: 0,
    totalPaid: 100,
    orderStatus: '未关闭',
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户C',
  },
];

assert.deepEqual(getDashboardDepartments(orders), ['科贸部', '物流部']);

assert.deepEqual(getDashboardSalesRanking(orders, ''), [
  { label: '科贸部', amount: '1300.00' },
  { label: '物流部', amount: '500.00' },
]);

assert.deepEqual(getDashboardSalesRanking(orders, '科贸部'), [
  { label: '商贸集成团队', amount: '1000.00' },
  { label: '创新业务团队', amount: '300.00' },
]);

const getDateFilteredSalesRanking = dashboardMetrics.getDashboardSalesRanking as (
  items: OrderRecord[],
  department: string,
  startDate: string,
  endDate: string,
) => Array<{ label: string; amount: string }>;

assert.deepEqual(getDateFilteredSalesRanking(orders, '', '2026-02-02', '2026-02-02'), [
  { label: '物流部', amount: '500.00' },
]);

assert.deepEqual(getDashboardMetrics({ ledgers, orders, department: '' }), {
  totalOrderAmount: '1800.00',
  grossProfit: '1020.00',
  orderCount: 3,
  accountsReceivable: '1450.00',
  deliveryAccountsReceivable: '-350.00',
  invoiceAccountsReceivable: '0.00',
  accountsPayable: '430.00',
  closedCount: 1,
});

assert.deepEqual(getDashboardMetrics({ ledgers, orders, department: '科贸部' }), {
  totalOrderAmount: '1300.00',
  grossProfit: '720.00',
  orderCount: 2,
  accountsReceivable: '1050.00',
  deliveryAccountsReceivable: '-250.00',
  invoiceAccountsReceivable: '0.00',
  accountsPayable: '330.00',
  closedCount: 1,
});

assert.deepEqual(
  getDashboardMetrics({
    ledgers,
    orders,
    department: '',
    startDate: '2026-02-02',
    endDate: '2026-02-02',
  }),
  {
    totalOrderAmount: '500.00',
    grossProfit: '300.00',
    orderCount: 1,
    accountsReceivable: '400.00',
    deliveryAccountsReceivable: '-100.00',
    invoiceAccountsReceivable: '0.00',
    accountsPayable: '100.00',
    closedCount: 0,
  },
);

const multiOrderProjectLedger: ProjectLedger = {
  id: 'P-MULTI',
  clientUnit: '客户多订单',
  projectName: '跨月项目',
  orderAmount: 800,
  purchaseAmount: 300,
  totalReceived: 150,
  department: '科贸部',
  manager: '张三',
  orderId: '2 个订单',
  orderStatus: '进行中',
  orderDate: '2026-02-15',
};

const multiOrderRecords = [
  {
    ...orders[0],
    projectId: 'P-MULTI',
    orderId: 'SO-MULTI-1',
    orderDate: '2026-01-15',
    orderValue: 300,
    purchaseAmount: 100,
    totalReceived: 50,
    totalPaid: 20,
    orderStatus: '进行中',
  },
  {
    ...orders[1],
    projectId: 'P-MULTI',
    orderId: 'SO-MULTI-2',
    department: '科贸部',
    orderDate: '2026-02-15',
    orderValue: 500,
    purchaseAmount: 200,
    totalReceived: 100,
    totalPaid: 80,
    orderStatus: '进行中',
  },
];

assert.deepEqual(
  getDashboardMetrics({
    ledgers: [multiOrderProjectLedger],
    orders: multiOrderRecords,
    department: '科贸部',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  }),
  {
    totalOrderAmount: '300.00',
    grossProfit: '200.00',
    orderCount: 1,
    accountsReceivable: '250.00',
    deliveryAccountsReceivable: '-50.00',
    invoiceAccountsReceivable: '0.00',
    accountsPayable: '80.00',
    closedCount: 0,
  },
);

type TrendDataGetter = (
  items: ProjectLedger[],
  filters: { department: string; startDate?: string; endDate?: string },
) => Array<{ month: string; orderAmount: string; profit: string }>;

const getDashboardTrendData = (dashboardMetrics as typeof dashboardMetrics & {
  getDashboardTrendData?: TrendDataGetter;
}).getDashboardTrendData;

assert.ok(getDashboardTrendData, '仪表盘应提供趋势数据汇总');
assert.deepEqual(getDashboardTrendData(ledgers, { department: '' }), [
  { month: '2026-01', orderAmount: '1000.00', profit: '600.00' },
  { month: '2026-02', orderAmount: '500.00', profit: '300.00' },
  { month: '2026-03', orderAmount: '300.00', profit: '120.00' },
]);

type LatestModificationGetter = (
  items: Array<OrderRecord & { updatedAt: string }>,
  filters: { department: string; startDate?: string; endDate?: string },
) => string;

const getDashboardLatestModifiedAt = (dashboardMetrics as typeof dashboardMetrics & {
  getDashboardLatestModifiedAt?: LatestModificationGetter;
}).getDashboardLatestModifiedAt;

const timestampedOrders = [
  { ...orders[0], updatedAt: '2026-01-01 10:00:00' },
  { ...orders[1], updatedAt: '2026-02-02 12:34:56' },
  { ...orders[2], updatedAt: '2026-03-03 15:20:00' },
];

assert.ok(getDashboardLatestModifiedAt, '仪表盘应提供数据最新修改时间');
assert.equal(
  getDashboardLatestModifiedAt(timestampedOrders, {
    department: '',
    startDate: '2026-02-02',
    endDate: '2026-02-02',
  }),
  '2026-02-02 12:34:56',
);

console.log('dashboard metrics tests passed');
