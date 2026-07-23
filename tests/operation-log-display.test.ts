import assert from 'node:assert/strict';

import { formatOperationLogDetails } from '../src/lib/operationLogDisplay';

const updateDetail = JSON.stringify({
  summary: '修改订单明细 487',
  before: {
    order_line_id: 487,
    project_code: 'AH24000082-01',
    order_no: 'SO-2026-001',
    goods_name: '全球眼IPC球机',
    specification_model: '200万高清红外',
    end_user_name: '电信',
    quantity: '2.000000',
    sales_unit_price_no_tax: '100.000000',
    sales_unit_price: '113.000000',
    updated_at: '2026-07-21T10:00:00',
  },
  after: {
    order_line_id: 487,
    project_code: 'AH24000082-01',
    order_no: 'SO-2026-001',
    goods_name: '全球眼IPC球机',
    specification_model: '200万高清红外',
    end_user_name: '移动',
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
  '系统管理员修改了项目“AH24000082-01”、订单“SO-2026-001”、货物/服务“全球眼IPC球机（200万高清红外）”的用户：电信 → 移动；销售数量：2 → 3；不含税单价：100 → 120；含税单价：113 → 135.6',
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
    user_name: '系统管理员',
    action_name: 'update_purchase_summary',
    detail: JSON.stringify({
      summary: '修改订单明细 487 的采购基础信息',
      before: {
        order_line_id: 487,
        project_code: 'AH24000082-01',
        order_no: 'SO-2026-001',
        goods_name: '全球眼IPC球机',
        supplier_name: '采购商甲',
        purchase_tax_rate: '0.000000',
      },
      after: {
        order_line_id: 487,
        project_code: 'AH24000082-01',
        order_no: 'SO-2026-001',
        goods_name: '全球眼IPC球机',
        supplier_name: '采购商乙',
        purchase_tax_rate: '13.000000',
      },
    }),
  }),
  '系统管理员修改了项目“AH24000082-01”、订单“SO-2026-001”、货物/服务“全球眼IPC球机”中的采购基础信息“487”的采购厂商：采购商甲 → 采购商乙；采购税率：0 → 13',
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
