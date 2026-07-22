import assert from 'node:assert/strict';
import { OrderRecord, PurchaseRecord, SalesRecord } from '../src/types';
import { buildProjectOrderSummaries } from '../src/lib/projectOrderSummary';

const orders: OrderRecord[] = [
  {
    orderLineId: 11,
    projectId: 'P-1',
    orderId: 'SO-1',
    orderDate: '2026-07-01',
    goodsName: '设备一',
    specModel: 'M-1',
    quantity: '2 台',
    orderValue: 200,
    purchaseAmount: 120,
    deliveryValue: 100,
    deliveryCost: 60,
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户一',
  },
  {
    orderLineId: 12,
    projectId: 'P-1',
    orderId: 'SO-1',
    orderDate: '2026-07-01',
    goodsName: '设备二',
    specModel: 'M-2',
    quantity: '1 台',
    orderValue: 300,
    purchaseAmount: 180,
    deliveryValue: 300,
    deliveryCost: 180,
    deliveredQty: 1,
    businessType: '销售',
    clientUnit: '客户一',
  },
  {
    orderLineId: 13,
    projectId: 'P-1',
    orderId: 'SO-2',
    orderDate: '2026-07-02',
    goodsName: '服务一',
    quantity: '1 项',
    orderValue: 80,
    deliveredQty: 0,
    businessType: '服务',
    clientUnit: '客户一',
  },
];

const purchases: PurchaseRecord[] = [
  {
    orderLineId: 11,
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '经理',
    department: '部门',
    contractNo: 'PC-1',
    contractAmount: 120,
    invoiceAmount: 50,
    paymentAmount: 20,
    supplier: '厂商一',
  },
  {
    orderLineId: 12,
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '经理',
    department: '部门',
    contractNo: 'PC-2',
    contractAmount: 180,
    invoiceAmount: 70,
    paymentAmount: 30,
    supplier: '厂商二',
  },
];

const sales: SalesRecord[] = [
  {
    orderLineId: 11,
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '经理',
    department: '部门',
    contractNo: 'SC-1',
    contractDate: '2026-07-01',
    contractValue: 200,
    invoiceAmount: 90,
    totalReceived: 40,
  },
  {
    orderLineId: 12,
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '经理',
    department: '部门',
    contractNo: 'SC-2',
    contractDate: '2026-07-01',
    contractValue: 300,
    invoiceAmount: 110,
    totalReceived: 60,
  },
];

const summaries = buildProjectOrderSummaries(orders, purchases, sales);

assert.equal(summaries.length, 2, '同一项目应按订单号合并为两行');
assert.equal(summaries[0].orderId, 'SO-1');
assert.equal(summaries[0].lines.length, 2, 'SO-1 展开后应显示两笔货物');
assert.deepEqual(
  {
    salesOrderAmount: summaries[0].salesOrderAmount,
    purchaseAmount: summaries[0].purchaseAmount,
    deliveryValue: summaries[0].deliveryValue,
    deliveryCost: summaries[0].deliveryCost,
    receiptAmount: summaries[0].receiptAmount,
    paymentAmount: summaries[0].paymentAmount,
    invoiceAmount: summaries[0].invoiceAmount,
    receivedInvoiceAmount: summaries[0].receivedInvoiceAmount,
  },
  {
    salesOrderAmount: 500,
    purchaseAmount: 300,
    deliveryValue: 400,
    deliveryCost: 240,
    receiptAmount: 100,
    paymentAmount: 50,
    invoiceAmount: 200,
    receivedInvoiceAmount: 120,
  },
);
assert.equal(summaries[0].lines[0].supplier, '厂商一');
assert.equal(summaries[1].lines.length, 1);

console.log('project order summary tests passed');
