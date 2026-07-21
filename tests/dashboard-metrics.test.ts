import assert from 'node:assert/strict';

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
    orderDate: '2026-01-02',
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
    orderDate: '2026-01-03',
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
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户A',
  },
  {
    projectId: 'P-2',
    department: '物流部',
    teamName: '集客物流团队',
    orderId: 'SO-2',
    orderDate: '2026-01-02',
    goodsName: '材料',
    quantity: '1 批',
    orderValue: 500,
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户B',
  },
  {
    projectId: 'P-3',
    department: '科贸部',
    teamName: '创新业务团队',
    orderId: 'SO-3',
    orderDate: '2026-01-03',
    goodsName: '服务',
    quantity: '1 项',
    orderValue: 300,
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户C',
  },
];

assert.deepEqual(getDashboardDepartments(orders), ['科贸部', '物流部']);

assert.deepEqual(getDashboardSalesRanking(orders, ''), [
  { label: '科贸部', amount: 1300 },
  { label: '物流部', amount: 500 },
]);

assert.deepEqual(getDashboardSalesRanking(orders, '科贸部'), [
  { label: '商贸集成团队', amount: 1000 },
  { label: '创新业务团队', amount: 300 },
]);

assert.deepEqual(getDashboardMetrics({ ledgers, orders, department: '' }), {
  totalOrderAmount: 1800,
  grossProfit: 1020,
  orderCount: 3,
  accountsReceivable: 1450,
  accountsPayable: 430,
  closedCount: 1,
});

assert.deepEqual(getDashboardMetrics({ ledgers, orders, department: '科贸部' }), {
  totalOrderAmount: 1300,
  grossProfit: 720,
  orderCount: 2,
  accountsReceivable: 1050,
  accountsPayable: 330,
  closedCount: 1,
});

console.log('dashboard metrics tests passed');
