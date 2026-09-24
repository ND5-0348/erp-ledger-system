import assert from 'node:assert/strict';
import { rawAmount, formatMoney, sumMoney, differenceMoney } from '../src/lib/money';
import { calculateTaxAmounts, editableNumber } from '../src/lib/orderAmounts';
import { getDashboardMetrics } from '../src/lib/dashboardMetrics';
import { buildProjectOrderSummaries } from '../src/lib/projectOrderSummary';
import type { OrderRecord } from '../src/types';

const large = '90071992547409.93';
assert.equal(rawAmount(large), large);
assert.equal(formatMoney(large), '90,071,992,547,409.93');
assert.equal(formatMoney('9999999999999999.99'), '9,999,999,999,999,999.99');
assert.equal(sumMoney(large, '0.01'), '90071992547409.94');
assert.equal(differenceMoney(large, '0.01'), '90071992547409.92');

const calculated = calculateTaxAmounts({
  quantity: '1000', taxRate: null,
  unitPriceNoTax: '90071992547.40993', unitPrice: '90071992547.40993',
});
assert.equal(calculated.amount, large);
assert.equal(editableNumber(calculated.amount, 2), large);

const base = {
  projectId: 'P', orderId: 'SO', orderDate: '2026-09-24',
  goodsName: '设备', quantity: '1 台', deliveredQty: '0',
  businessType: '销售', clientUnit: '客户',
};
const orders: OrderRecord[] = [
  { ...base, orderLineId: 1, orderValue: large, purchaseAmount: '0.01', totalReceived: '0.01' },
  { ...base, orderLineId: 2, orderValue: '0.01', purchaseAmount: '0', totalReceived: '0' },
];
assert.equal(getDashboardMetrics({ ledgers: [], orders, department: '' }).totalOrderAmount, '90071992547409.94');
const summary = buildProjectOrderSummaries(orders, [], [])[0];
assert.equal(summary.salesOrderAmount, '90071992547409.94');
assert.equal(summary.deliveryAccountsReceivable, '-0.01');
console.log('high amount precision tests passed');
