import assert from 'node:assert/strict';

import {
  ORDER_IMPORT_TEMPLATE_CSV,
  ORDER_IMPORT_TEMPLATE_HEADERS,
  parseOrderImportCsv,
} from '../src/lib/orderImportTemplate';

assert.deepEqual(ORDER_IMPORT_TEMPLATE_HEADERS.slice(0, 2), ['项目编号', '订单号']);
assert.ok(ORDER_IMPORT_TEMPLATE_CSV.includes('项目编号,订单号'));
assert.ok(ORDER_IMPORT_TEMPLATE_CSV.includes('AH24000001-01,XSDD202606290001'));

const importedOrders = parseOrderImportCsv(
  [
    ORDER_IMPORT_TEMPLATE_HEADERS.join(','),
    'AH24000001-01,XSDD202606290001,,,,,,,,,,,,,,,,,,,',
    ',XSDD202606290002,,,,,,,,,,,,,,,,,,,,',
    'AH24000002-01,,,,,,,,,,,,,,,,,,,,',
  ].join('\n'),
  '2026-06-29',
);

assert.equal(importedOrders.length, 1);
assert.deepEqual(importedOrders[0], {
  amountType: '全额',
  projectId: 'AH24000001-01',
  department: '',
  branchCompany: '',
  manager: '',
  orderId: 'XSDD202606290001',
  orderDate: '2026-06-29',
  businessType: '',
  statisticalCategory: '',
  teamName: '',
  clientUnit: '',
  userName: '',
  regionalPlatform: '',
  projectName: '',
  goodsName: '',
  specModel: '',
  unitName: '',
  quantity: '0',
  netUnitPrice: 0,
  unitPrice: 0,
  netRevenue: 0,
  orderValue: 0,
  deliveredQty: 0,
});

console.log('order import template tests passed');
