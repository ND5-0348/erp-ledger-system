export type Permission =
  | 'order_entry'
  | 'order_edit'
  | 'order_delete'
  | 'purchase_entry'
  | 'purchase_edit'
  | 'purchase_delete'
  | 'sales_entry'
  | 'sales_edit'
  | 'sales_delete'
  | 'system_admin';

export type RoleCode = 'admin' | 'order_entry' | 'purchase_entry' | 'sales_entry' | 'viewer';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  roleCode: RoleCode | string;
  roleLabel: string;
  permissions: Permission[];
  departmentScope: string[];
  departmentCanView: boolean;
  departmentCanEntry: boolean;
}

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  admin: [
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
  order_entry: ['order_entry'],
  purchase_entry: ['purchase_entry'],
  sales_entry: ['sales_entry'],
  viewer: [],
};

export const SYSTEM_PERMISSION_OPTIONS: Array<{ value: Permission; label: string }> = [
  { value: 'order_entry', label: '订单详情录入' },
  { value: 'order_edit', label: '订单详情修改' },
  { value: 'order_delete', label: '订单详情删除' },
  { value: 'purchase_entry', label: '采购详情录入' },
  { value: 'purchase_edit', label: '采购详情修改' },
  { value: 'purchase_delete', label: '采购详情删除' },
  { value: 'sales_entry', label: '销售详情录入' },
  { value: 'sales_edit', label: '销售详情修改' },
  { value: 'sales_delete', label: '销售详情删除' },
  { value: 'system_admin', label: '系统权限' },
];

export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: '管理员',
  order_entry: '订单录入员',
  purchase_entry: '采购录入员',
  sales_entry: '销售录入员',
  viewer: '查看员',
};

export function getRolePermissions(roleCode: string): Permission[] {
  return [...(ROLE_PERMISSIONS[roleCode as RoleCode] || [])];
}

export function hasPermission(user: Pick<AuthUser, 'roleCode' | 'permissions'> | null, permission: Permission) {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function normalizeUser(raw: {
  id: number;
  username: string;
  display_name: string;
  role_code: string;
  role_label?: string;
  permissions?: string[];
  department_scope?: string[];
  department_can_view?: boolean;
  department_can_entry?: boolean;
}): AuthUser {
  const roleCode = raw.role_code as RoleCode;
  return {
    id: raw.id,
    username: raw.username,
    displayName: raw.display_name,
    roleCode,
    roleLabel: raw.role_label || ROLE_LABELS[roleCode] || raw.role_code,
    permissions: (raw.permissions || getRolePermissions(raw.role_code)) as Permission[],
    departmentScope: raw.department_scope || [],
    departmentCanView: Boolean(raw.department_can_view),
    departmentCanEntry: Boolean(raw.department_can_entry),
  };
}
