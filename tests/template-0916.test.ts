import assert from 'node:assert/strict';
import {getDashboardMetrics} from '../src/lib/dashboardMetrics';
import {aggregateSalesOrderRows, getLedgerFinanceSummary} from '../src/lib/salesDetailModel';
import {buildProjectOrderSummaries} from '../src/lib/projectOrderSummary';
import type {OrderRecord} from '../src/types';

const common = {projectId:'P',orderId:'SO',goodsName:'设备',quantity:'1',deliveredQty:1,businessType:'销售',clientUnit:'客户',department:'测试'};
const orders: OrderRecord[] = [
  {...common,orderLineId:1,orderDate:'2026-09-01',orderValue:1000,deliveryAccountsReceivable:-100,invoiceAccountsReceivable:20,accountsReceivable:999},
  {...common,orderLineId:2,orderDate:'2026-09-02',orderValue:2000,deliveryAccountsReceivable:600,invoiceAccountsReceivable:80,accountsReceivable:999},
];
const metrics = getDashboardMetrics({orders,ledgers:[],department:'测试'});
assert.equal(metrics.deliveryAccountsReceivable,'500.00');
assert.equal(metrics.invoiceAccountsReceivable,'100.00');
const filtered = getDashboardMetrics({orders,ledgers:[],department:'测试',endDate:'2026-09-01'});
assert.equal(filtered.deliveryAccountsReceivable,'-100.00');
assert.equal(filtered.invoiceAccountsReceivable,'20.00');
const summary = buildProjectOrderSummaries(orders,[],[])[0];
assert.equal(summary.deliveryAccountsReceivable,'500.00');
assert.equal(summary.invoiceAccountsReceivable,'100.00');
assert.equal(summary.lines[0].deliveryAccountsReceivable,'-100.00');
const selected = aggregateSalesOrderRows([
  {order_value:1000,delivery_accounts_receivable:-100,invoice_accounts_receivable:20},
  {order_value:2000,delivery_accounts_receivable:600,invoice_accounts_receivable:80},
]);
assert.equal(selected.delivery_accounts_receivable,'500.00');
assert.equal(selected.invoice_accounts_receivable,'100.00');
const ledger = getLedgerFinanceSummary({orderAmount:3000,purchaseAmount:1000,totalReceived:900,deliveryAccountsReceivable:500,invoiceAccountsReceivable:100},[],[]);
assert.equal(ledger.deliveryAccountsReceivable,'500.00');
assert.equal(ledger.invoiceAccountsReceivable,'100.00');
console.log('0916 receivable aggregation tests passed');
