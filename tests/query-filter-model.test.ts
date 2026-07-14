import assert from 'node:assert/strict';

import {
  applyLedgerFilters,
  applyOrderFilters,
  applyPurchaseFilters,
  applySalesFilters,
  getDepartmentOptions,
  emptyLedgerFilters,
  emptyOrderFilters,
  emptyPurchaseFilters,
  emptySalesFilters,
  submitQueryFilters,
} from '../src/lib/queryFilterModel';

const ledgers = [
  {
    id: 'P-1',
    clientUnit: '客户A',
    projectName: '项目A',
    orderAmount: 100,
    purchaseAmount: 50,
    totalReceived: 20,
    department: '科贸部',
    manager: '张三',
    orderId: '1 个订单',
    orderStatus: 'open',
    orderDate: '2026-06-01',
  },
  {
    id: 'P-2',
    clientUnit: '客户B',
    projectName: '项目B',
    orderAmount: 200,
    purchaseAmount: 70,
    totalReceived: 100,
    department: '政企部',
    manager: '李四',
    orderId: '2 个订单',
    orderStatus: 'closed',
    orderDate: '2026-06-02',
  },
];

const orders = [
  {
    projectId: 'P-1',
    orderId: 'SO-1',
    orderDate: '2026-06-01',
    goodsName: '设备A',
    quantity: '1 台',
    orderValue: 100,
    deliveredQty: 1,
    businessType: '设备销售',
    clientUnit: '客户A',
  },
  {
    projectId: 'P-2',
    orderId: 'SO-2',
    orderDate: '2026-06-02',
    goodsName: '服务B',
    quantity: '1 项',
    orderValue: 200,
    deliveredQty: 0,
    businessType: '咨询服务',
    clientUnit: '客户B',
  },
];

const purchases = [
  {
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '张三',
    department: '科贸部',
    contractNo: 'HT-1',
    contractAmount: 100,
    invoiceAmount: 20,
    paymentAmount: 10,
    supplier: '供应商A',
    paymentDate: '2026-06-01',
  },
  {
    projectId: 'P-2',
    orderId: 'SO-2',
    manager: '李四',
    department: '政企部',
    contractNo: 'HT-2',
    contractAmount: 200,
    invoiceAmount: 40,
    paymentAmount: 20,
    supplier: '供应商B',
    paymentDate: '2026-06-10',
  },
  {
    projectId: 'P-3',
    orderId: 'SO-3',
    manager: '王五',
    department: '物流部',
    contractNo: 'HT-3',
    contractAmount: 300,
    invoiceAmount: 60,
    paymentAmount: 30,
    supplier: '供应商C',
    paymentDate: '2026-06-20',
  },
];

const sales = [
  {
    projectId: 'P-1',
    orderId: 'SO-1',
    manager: '张三',
    department: '科贸部',
    contractNo: 'XS-1',
    contractDate: '2026-05-01',
    contractValue: 100,
    invoiceAmount: 20,
    supplierName: '供应商A',
    receiptDate: '2026-06-01',
  },
  {
    projectId: 'P-2',
    orderId: 'SO-2',
    manager: '李四',
    department: '政企部',
    contractNo: 'XS-2',
    contractDate: '2026-05-02',
    contractValue: 200,
    invoiceAmount: 40,
    supplierName: '供应商B',
    receiptDate: '2026-06-10',
  },
  {
    projectId: 'P-3',
    orderId: 'SO-3',
    manager: '王五',
    department: '物流部',
    contractNo: 'XS-3',
    contractDate: '2026-05-03',
    contractValue: 300,
    invoiceAmount: 60,
    supplierName: '供应商C',
    receiptDate: '2026-06-20',
  },
];

const draftLedgerFilters = { ...emptyLedgerFilters, projectId: 'P-2' };
let submittedLedgerFilters = emptyLedgerFilters;

assert.equal(applyLedgerFilters(ledgers, submittedLedgerFilters).length, 2);
submittedLedgerFilters = submitQueryFilters(draftLedgerFilters);
assert.deepEqual(
  applyLedgerFilters(ledgers, submittedLedgerFilters).map((item) => item.id),
  ['P-2'],
);

const draftOrderFilters = { ...emptyOrderFilters, businessType: '咨询' };
let submittedOrderFilters = emptyOrderFilters;

assert.equal(applyOrderFilters(orders, submittedOrderFilters).length, 2);
submittedOrderFilters = submitQueryFilters(draftOrderFilters);
assert.deepEqual(
  applyOrderFilters(orders, submittedOrderFilters).map((item) => item.orderId),
  ['SO-2'],
);

assert.deepEqual(
  getDepartmentOptions([
    { department: '政企部' },
    { department: '' },
    { department: '科贸部' },
    { department: '政企部' },
    { department: undefined },
  ]),
  ['科贸部', '政企部'],
);

assert.deepEqual(
  applyPurchaseFilters(purchases, { ...emptyPurchaseFilters, paymentStartDate: '2026-06-05', paymentEndDate: '2026-06-15' }).map(
    (item) => item.orderId,
  ),
  ['SO-2'],
);

assert.deepEqual(
  applyPurchaseFilters(purchases, { ...emptyPurchaseFilters, paymentEndDate: '2026-06-10' }).map((item) => item.orderId),
  ['SO-1', 'SO-2'],
);

assert.deepEqual(
  applySalesFilters(sales, { ...emptySalesFilters, receiptStartDate: '2026-06-05', receiptEndDate: '2026-06-15' }).map(
    (item) => item.orderId,
  ),
  ['SO-2'],
);

assert.deepEqual(
  applySalesFilters(sales, { ...emptySalesFilters, receiptStartDate: '2026-06-10' }).map((item) => item.orderId),
  ['SO-2', 'SO-3'],
);

console.log('query filter model tests passed');
