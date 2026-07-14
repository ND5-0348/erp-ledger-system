import assert from 'node:assert/strict';

import {
  ORDER_DELIVERY_DETAIL_COLUMNS,
  ORDER_PURCHASE_DETAIL_COLUMNS,
  ORDER_DETAIL_TABLE_WIDTHS,
} from '../src/lib/orderDetailTables';

assert.deepEqual(ORDER_PURCHASE_DETAIL_COLUMNS.map((column) => column.label), [
  '采购厂商',
  '不含税采购单价',
  '采购单价',
  '不含税成本',
  '采购金额',
  '操作',
]);

assert.deepEqual(ORDER_DELIVERY_DETAIL_COLUMNS.map((column) => column.label), [
  '交付日期',
  '交付数量',
  '交付不含税收入',
  '交付价值',
  '交付不含税成本',
  '交付成本',
  '待交付数量',
  '待交付金额（不含税）',
  '待交付金额',
  '操作',
]);

assert.equal(ORDER_PURCHASE_DETAIL_COLUMNS.at(-1)?.key, 'actions');
assert.equal(ORDER_DELIVERY_DETAIL_COLUMNS.at(-1)?.key, 'actions');
assert.ok(ORDER_DETAIL_TABLE_WIDTHS.purchase >= 860);
assert.ok(ORDER_DETAIL_TABLE_WIDTHS.delivery >= 1180);

console.log('order detail table tests passed');
