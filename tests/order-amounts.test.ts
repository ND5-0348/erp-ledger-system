import assert from 'node:assert/strict';

import { calculateTaxAmounts, editableNumber } from '../src/lib/orderAmounts';

const sales = calculateTaxAmounts({ quantity: 2, taxRate: 13, unitPriceNoTax: 100 });
assert.deepEqual(sales, {
  taxRate: 13,
  unitPriceNoTax: 100,
  unitPrice: 113,
  amountNoTax: 200,
  amount: 226,
  taxAmount: 26,
});

const updated = calculateTaxAmounts({ quantity: '3', taxRate: '6', unitPriceNoTax: '99.99', unitPrice: '0' });
assert.equal(updated.unitPrice, 105.9894);
assert.equal(updated.amountNoTax, 299.97);
assert.equal(updated.amount, 317.97);
assert.equal(updated.taxAmount, 18);
assert.equal(editableNumber(updated.unitPrice), '105.9894');

console.log('order amount tests passed');
