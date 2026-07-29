import assert from 'node:assert/strict';

import {
  formatOperationLogChangeGroups,
  formatOperationLogDetails,
} from '../src/lib/operationLogDisplay';

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

const batchPurchaseDetail = formatOperationLogDetails({
  user_name: '系统管理员（账号：admin）',
  action_name: 'batch_update_purchases',
  detail: JSON.stringify({
    summary: '在线表格修改订单明细 487 的采购信息',
    before: {
      order_line_id: 487,
      project_code: 'AH24000082-01',
      order_no: 'SO-2026-001',
      goods_name: '测试设备',
      supplier_name: '采购商甲',
      purchase_contract_no: 'HT-001',
    },
    after: {
      order_line_id: 487,
      project_code: 'AH24000082-01',
      order_no: 'SO-2026-001',
      goods_name: '测试设备',
      supplier_name: '采购商乙',
      purchase_contract_no: 'HT-002',
    },
  }),
});

assert.match(batchPurchaseDetail, /采购厂商：采购商甲 → 采购商乙/);
assert.match(batchPurchaseDetail, /采购合同号：HT-001 → HT-002/);

const batchBasicDetail = formatOperationLogDetails({
  user_name: '系统管理员（账号：admin）',
  action_name: 'batch_update_basic_order',
  detail: JSON.stringify({
    summary: '在线表格批量修改订单明细 490 的 A-W 基本信息',
    before: {
      order_line_id: 490,
      project_code: 'AH24000082-01',
      order_no: 'XSDD2026021000233',
      goods_name: '测试设备',
      user_name: '电信',
      amount_type: '全额',
      statistical_category: '非电商贸易',
      net_unit_price: '100.000000',
    },
    after: {
      order_line_id: 490,
      project_code: 'AH24000082-01',
      order_no: 'XSDD2026021000233',
      goods_name: '测试设备',
      user_name: '电信测试',
      amount_type: '全额',
      statistical_category: '非电商贸易',
      net_unit_price: '100.000000',
    },
  }),
});

assert.equal(
  batchBasicDetail,
  '系统管理员（账号：admin）修改了项目“AH24000082-01”、订单“XSDD2026021000233”、货物/服务“测试设备”中的基本信息“490”的用户：电信 → 电信测试',
);

assert.equal(
  formatOperationLogDetails({
    user_name: '系统管理员（账号：admin）',
    action_name: 'batch_update_basic_order',
    detail: JSON.stringify({
      summary: '在线表格批量修改订单明细 490 的 A-W 基本信息',
      before: {
        order_line_id: 490,
        project_code: 'AH24000082-01',
        order_no: 'XSDD2026021000233',
        goods_name: '测试设备',
        user_name: '电信测试',
      },
      after: {
        order_line_id: 490,
        project_code: 'AH24000082-01',
        order_no: 'XSDD2026021000233',
        goods_name: '测试设备',
        user_name: '电信测试',
      },
    }),
  }),
  '系统管理员（账号：admin）对项目“AH24000082-01”、订单“XSDD2026021000233”、货物/服务“测试设备”中的基本信息“490”执行了在线表格批量修改（历史日志未保存具体字段差异）',
);

const mergedBatchLog = {
  user_name: '系统管理员（账号：admin）',
  action_name: 'batch_update_basic_order',
  detail: JSON.stringify({
    summary: '在线表格批量修改 2 条基本信息，共 3 个单元格',
    before: null,
    after: null,
    batch_entries: [
      {
        before: {
          order_line_id: 489,
          project_code: 'AH24000082-01',
          order_no: 'XSDD2026021000233',
          goods_name: '枪机',
          user_name: '电信',
        },
        after: {
          order_line_id: 489,
          project_code: 'AH24000082-01',
          order_no: 'XSDD2026021000233',
          goods_name: '枪机',
          user_name: '电信测试',
        },
      },
      {
        before: {
          order_line_id: 490,
          project_code: 'AH24000082-01',
          order_no: 'XSDD2026021000233',
          goods_name: '球机',
          statistical_category: '非电商贸易',
          user_name: '电信',
        },
        after: {
          order_line_id: 490,
          project_code: 'AH24000082-01',
          order_no: 'XSDD2026021000233',
          goods_name: '球机',
          statistical_category: '商品销售',
          user_name: '电信测试',
        },
      },
    ],
  }),
};

assert.equal(
  formatOperationLogDetails(mergedBatchLog),
  '系统管理员（账号：admin）在线表格批量修改 2 条基本信息，共 3 个单元格',
);
assert.deepEqual(
  formatOperationLogChangeGroups(mergedBatchLog),
  [
    {
      title: '第 1 条 · 项目“AH24000082-01”、订单“XSDD2026021000233”、货物/服务“枪机”中的基本信息“489”',
      changes: ['用户：电信 → 电信测试'],
    },
    {
      title: '第 2 条 · 项目“AH24000082-01”、订单“XSDD2026021000233”、货物/服务“球机”中的基本信息“490”',
      changes: ['统计类别：非电商贸易 → 商品销售', '用户：电信 → 电信测试'],
    },
  ],
);
