import assert from 'node:assert/strict';

import {
  getRolePermissions,
  hasPermission,
  permissionRoleLabel,
  standardRoleFor,
  SYSTEM_PERMISSION_OPTIONS,
} from '../src/lib/permissions';

assert.deepEqual(getRolePermissions('admin'), [
  'order_entry',
  'order_edit',
  'order_delete',
  'sales_entry',
  'sales_edit',
  'sales_delete',
  'purchase_entry',
  'purchase_edit',
  'purchase_delete',
  'system_admin',
  'ledger_import',
]);

// 整表导入是独立权限点：管理员默认获得，录入角色默认不获得。
assert.equal(getRolePermissions('order_entry').includes('ledger_import'), false);
assert.equal(getRolePermissions('purchase_entry').includes('ledger_import'), false);
assert.equal(getRolePermissions('sales_entry').includes('ledger_import'), false);
assert.equal(getRolePermissions('viewer').includes('ledger_import'), false);
assert.equal(hasPermission({ roleCode: 'order_entry', permissions: ['order_entry'] }, 'ledger_import'), false);
assert.equal(hasPermission({ roleCode: 'admin', permissions: ['ledger_import'] }, 'ledger_import'), true);

assert.equal(hasPermission({ roleCode: 'order_entry', permissions: ['order_entry'] }, 'order_entry'), true);
assert.equal(hasPermission({ roleCode: 'order_entry', permissions: ['order_entry'] }, 'purchase_entry'), false);
assert.equal(hasPermission({ roleCode: 'order_entry', permissions: ['order_entry'] }, 'order_edit'), false);
assert.equal(hasPermission({ roleCode: 'order_entry', permissions: ['order_entry'] }, 'order_delete'), false);
assert.equal(hasPermission({ roleCode: 'order_entry', permissions: [] }, 'order_entry'), false);

assert.equal(hasPermission({ roleCode: 'purchase_entry', permissions: ['purchase_entry'] }, 'purchase_entry'), true);
assert.equal(hasPermission({ roleCode: 'purchase_entry', permissions: ['purchase_entry'] }, 'sales_entry'), false);
assert.equal(hasPermission({ roleCode: 'purchase_entry', permissions: ['purchase_entry'] }, 'purchase_edit'), false);
assert.equal(hasPermission({ roleCode: 'purchase_entry', permissions: ['purchase_entry'] }, 'purchase_delete'), false);

assert.equal(hasPermission({ roleCode: 'sales_entry', permissions: ['sales_entry'] }, 'sales_entry'), true);
assert.equal(hasPermission({ roleCode: 'sales_entry', permissions: ['sales_entry'] }, 'order_entry'), false);
assert.equal(hasPermission({ roleCode: 'sales_entry', permissions: ['sales_entry'] }, 'sales_edit'), false);
assert.equal(hasPermission({ roleCode: 'sales_entry', permissions: ['sales_entry'] }, 'sales_delete'), false);

assert.equal(hasPermission({ roleCode: 'viewer', permissions: [] }, 'order_entry'), false);

assert.deepEqual(
  SYSTEM_PERMISSION_OPTIONS.map((item) => item.value),
  [
    'order_entry',
    'order_edit',
    'order_delete',
    'sales_entry',
    'sales_edit',
    'sales_delete',
    'purchase_entry',
    'purchase_edit',
    'purchase_delete',
    'system_admin',
    'ledger_import',
  ],
);

assert.equal(
  SYSTEM_PERMISSION_OPTIONS.find((item) => item.value === 'ledger_import')?.label,
  '整表导入（含采购及销售财务数据）',
);

// 角色标签按实际生效权限显示：标准组合显示角色名，非标准组合显示“自定义权限”。
assert.equal(permissionRoleLabel(['order_entry']), '订单录入员');
assert.equal(permissionRoleLabel([]), '查看员');
assert.equal(permissionRoleLabel([...getRolePermissions('admin')]), '管理员');
assert.equal(permissionRoleLabel(['order_entry', 'ledger_import']), '自定义权限');
assert.equal(permissionRoleLabel(['system_admin']), '自定义权限');
assert.equal(permissionRoleLabel(['ledger_import']), '自定义权限');

assert.equal(standardRoleFor(['order_entry']), 'order_entry');
assert.equal(standardRoleFor(['order_entry', 'ledger_import']), null);
assert.equal(standardRoleFor([...getRolePermissions('admin')]), 'admin');

console.log('permission tests passed');
