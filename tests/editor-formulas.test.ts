import assert from 'node:assert/strict';
import { recalculateEditorRows } from '../src/lib/editorFormulas';
import { calculateTaxAmounts } from '../src/lib/orderAmounts';
import type { BackendBatchEditorRow } from '../src/api';

const values = Array(92).fill(null);
for (const [col, value] of [[18, 10], [19, 13], [20, 100], [21, 113], [22, 1000], [23, 1130],
  [25, 13], [26, 70], [27, 79.1], [28, 700], [29, 791], [31, 5], [32, 500], [33, 565],
  [34, 350], [35, 395.5], [36, 5], [37, 500], [38, 565], [42, 300], [43, 491],
  [76, 200], [77, 530], [78, -35], [81, 2], [82, 1 / 3], [87, 2]]) values[col - 1] = value;
const old: BackendBatchEditorRow[] = [{ order_line_id: 1, values }];
const edit = (changes: number[][]) => {
  const next = [{ ...old[0], values: [...values] }];
  for (const [col, value] of changes) next[0].values[col - 1] = value;
  return recalculateEditorRows(old, next)[0].values;
};
const changed = edit([[18, 20], [20, 200]]);
assert.equal(changed[22], 4520);
assert.equal(changed[28], 1582);
assert.equal(changed[32], 1130);
assert.equal(changed[37], 3390);
assert.equal(changed[42], 1282);
assert.equal(changed[76], 3920); // 600 total invoiced, including later phases.
const gross = edit([[27, 90.4]]);
assert.equal(gross[25], 80);
assert.equal(gross[28], 904);
assert.equal(gross[34], 452);
const invoice = edit([[76, 400], [81, 4]]);
assert.equal(invoice[76], 330);
assert.equal(invoice[81], 0.5); // 4 / 800; later phases stay in denominator.
assert.equal(invoice[86], 4);
assert.equal(invoice[87], 561); // Delivered 565 minus all receipts 4.
assert.equal(invoice[88], 796); // All three invoice phases 800 minus receipts 4.
const prepaid = edit([[81, 700]]);
assert.equal(prepaid[87], -135); // Preserve advances, never clamp to zero.
assert.equal(prepaid[88], -100);
assert.equal(changed[87], 1128); // Delivery changes propagate to delivery receivable.
assert.equal(changed[88], 598); // Order value does not change invoiced receivable.
const allCleared = edit([[76, -400]]); // denominator reaches zero; UI validation rejects negative input separately.
assert.equal(allCleared[81], null);
assert.equal(values[22], 1130); // Undo snapshot must remain immutable.
assert.equal(calculateTaxAmounts({ quantity: 10, taxRate: 0.5, unitPriceNoTax: null, unitPrice: 100.5 }).amountNoTax, 1000);
const halfCent = edit([[18, 1], [19, null], [20, 10.075], [21, 10.075], [31, 1]]);
assert.equal(halfCent[21], 10.08);
assert.equal(halfCent[22], 10.08);
assert.equal(halfCent[31], 10.08);
assert.equal(halfCent[32], 10.08);
console.log('editor formula tests passed');
