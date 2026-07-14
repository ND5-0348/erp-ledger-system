import assert from 'node:assert/strict';

import {
  aggregateSalesOrderRows,
  buildLedgerContractRows,
  buildLedgerPaymentRows,
  buildSalesInvoiceDraft,
  getLedgerFinanceSummary,
  getNextReceiptPhase,
  normalizeLedgerStatusLabel,
} from '../src/lib/salesDetailModel';

assert.equal(getNextReceiptPhase([]), 1);
assert.equal(getNextReceiptPhase([{ phase_no: 1 }, { phase_no: 2 }]), 3);

assert.deepEqual(
  buildSalesInvoiceDraft({ contractValue: 1000, invoiceAmount: 250 }),
  {
    invoice_doc_no: '',
    invoice_date: '',
    invoice_no: '',
    invoice_amount: '250',
    pending_invoice_amount: '750',
    delivered_not_invoiced_amount: '',
  },
);

assert.deepEqual(
  aggregateSalesOrderRows([
    {
      project_code: 'AH-1',
      order_no: 'SO-1',
      account_manager: '张三',
      department: '科贸部',
      order_value: 100,
      purchase_amount: 30,
      delivery_value: 80,
      sales_contract_value: 90,
      sales_invoice_amount: 20,
      total_received: 10,
      accounts_receivable: 90,
    },
    {
      project_code: 'AH-1',
      order_no: 'SO-1',
      account_manager: '张三',
      department: '科贸部',
      order_value: 250,
      purchase_amount: 70,
      delivery_value: 200,
      sales_contract_value: 260,
      sales_invoice_amount: 40,
      total_received: 30,
      accounts_receivable: 220,
    },
  ]),
  {
    project_code: 'AH-1',
    order_no: 'SO-1',
    account_manager: '张三',
    department: '科贸部',
    order_value: 350,
    purchase_amount: 100,
    delivery_value: 280,
    sales_contract_value: 350,
    sales_invoice_amount: 60,
    total_received: 40,
    accounts_receivable: 310,
    matched_line_count: 2,
  },
);

const detailLedger = {
  orderAmount: 300,
  purchaseAmount: 120,
  totalReceived: 90,
};
const detailOrders = [
  {
    projectId: 'P-1',
    orderId: 'SO-1',
    goodsName: '摄像机',
    orderValue: 200,
  },
  {
    projectId: 'P-1',
    orderId: 'SO-2',
    goodsName: '交换机',
    orderValue: 100,
  },
];
const detailPurchases = [
  {
    orderLineId: 11,
    projectId: 'P-1',
    orderId: 'SO-1',
    contractNo: 'PC-1',
    supplier: '供应商A',
    contractAmount: 80,
    invoiceAmount: 70,
    paymentAmount: 30,
  },
  {
    orderLineId: 22,
    projectId: 'P-1',
    orderId: 'SO-2',
    contractNo: 'PC-2',
    supplier: '供应商B',
    contractAmount: 40,
    invoiceAmount: 40,
    paymentAmount: 10,
  },
];
const detailSales = [
  {
    orderLineId: 11,
    projectId: 'P-1',
    orderId: 'SO-1',
    contractNo: 'SC-1',
    contractDate: '2026-02-10',
    contractValue: 200,
    invoiceAmount: 150,
    totalReceived: 60,
    accountsReceivable: 140,
  },
  {
    orderLineId: 22,
    projectId: 'P-1',
    orderId: 'SO-2',
    contractNo: 'SC-2',
    contractDate: '2026-02-11',
    contractValue: 100,
    invoiceAmount: 80,
    totalReceived: 30,
    accountsReceivable: 70,
  },
];

assert.equal(normalizeLedgerStatusLabel('open'), '进行中');
assert.equal(normalizeLedgerStatusLabel('closed'), '已关闭');
assert.equal(normalizeLedgerStatusLabel('已完成'), '已关闭');

assert.deepEqual(getLedgerFinanceSummary(detailLedger, detailPurchases, detailSales), {
  accountsPayable: 120,
  paidAmount: 40,
  accountsReceivable: 210,
  receivedAmount: 90,
});

assert.deepEqual(buildLedgerContractRows(detailOrders, detailPurchases, detailSales), [
  {
    orderId: 'SO-1',
    goodsName: '摄像机',
    purchaseContractNo: 'PC-1',
    supplier: '供应商A',
    purchaseContractAmount: 80,
    salesContractNo: 'SC-1',
    salesContractDate: '2026-02-10',
    salesContractValue: 200,
  },
  {
    orderId: 'SO-2',
    goodsName: '交换机',
    purchaseContractNo: 'PC-2',
    supplier: '供应商B',
    purchaseContractAmount: 40,
    salesContractNo: 'SC-2',
    salesContractDate: '2026-02-11',
    salesContractValue: 100,
  },
]);

assert.deepEqual(buildLedgerPaymentRows(detailOrders, detailPurchases, detailSales), [
  {
    orderId: 'SO-1',
    goodsName: '摄像机',
    purchasePaymentAmount: 30,
    accountsPayable: 50,
    salesReceiptDate: '-',
    receiptAmount: 60,
    receiptRatio: 30,
    accountsReceivable: 140,
    grossProfit: 120,
    grossProfitRate: 60,
  },
  {
    orderId: 'SO-2',
    goodsName: '交换机',
    purchasePaymentAmount: 10,
    accountsPayable: 30,
    salesReceiptDate: '-',
    receiptAmount: 30,
    receiptRatio: 30,
    accountsReceivable: 70,
    grossProfit: 60,
    grossProfitRate: 60,
  },
]);

console.log('sales detail model tests passed');
