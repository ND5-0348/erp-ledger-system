import assert from 'node:assert/strict';

import { getRolePermissions, hasPermission, SYSTEM_PERMISSION_OPTIONS } from '../src/lib/permissions';

assert.deepEqual(getRolePermissions('admin'), [
  'order_entry',
  'order_edit',
  'order_delete',
  'purchase_entry',
  'purchase_edit',
  'purchase_delete',
  'sales_entry',
  'sales_edit',
  'sales_delete',
  'system_admin',
]);

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
    'purchase_entry',
    'purchase_edit',
    'purchase_delete',
    'sales_entry',
    'sales_edit',
    'sales_delete',
    'system_admin',
  ],
);

console.log('permission tests passed');
