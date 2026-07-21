import assert from 'node:assert/strict';

import { formatOperationLogDetails } from '../src/lib/operationLogDisplay';

const updateDetail = JSON.stringify({
  summary: '修改订单明细 487',
  before: {
    order_line_id: 487,
    order_no: 'SO-2026-001',
    quantity: '2.000000',
    sales_unit_price_no_tax: '100.000000',
    sales_unit_price: '113.000000',
    updated_at: '2026-07-21T10:00:00',
  },
  after: {
    order_line_id: 487,
    order_no: 'SO-2026-001',
    quantity: '3.000000',
    sales_unit_price_no_tax: '120.000000',
    sales_unit_price: '135.600000',
    updated_at: '2026-07-21T10:05:00',
  },
});

assert.equal(
  formatOperationLogDetails({
    user_name: '系统管理员',
    action_name: 'update_order',
    detail: updateDetail,
  }),
  '系统管理员修改了订单“SO-2026-001”的销售数量：2 → 3；不含税单价：100 → 120；含税单价：113 → 135.6',
);

assert.equal(
  formatOperationLogDetails({
    user_name: '系统管理员',
    action_name: 'remove_test_data',
    detail: JSON.stringify({ summary: '清理测试项目：logistics/test；备份ID=3', before: null, after: null }),
  }),
  '系统管理员清理测试项目：logistics/test；备份ID=3',
);

assert.equal(
  formatOperationLogDetails({
    user_name: null,
    action_name: 'import_excel',
    detail: '导入业务台账.xlsx：成功 488 行，失败 0 行',
  }),
  '系统导入业务台账.xlsx：成功 488 行，失败 0 行',
);

assert.equal(updateDetail.includes('"before"'), true);
