import React, { useState, useMemo } from 'react';
import { 
  RefreshCw, 
  Database, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  HardDrive,
  FileArchive,
  Terminal,
  Activity,
  UserPlus,
  ShieldCheck,
  Eye,
  EyeOff,
  Plus,
  X,
  Pencil,
  Trash2
} from 'lucide-react';
import { BackendUserRecord } from '../api';
import { Permission, ROLE_LABELS, RoleCode, SYSTEM_PERMISSION_OPTIONS } from '../lib/permissions';
import { OperationLog, BackupInfo } from '../types';

export interface CreateUserPayload {
  username: string;
  password: string;
  display_name: string;
  role_code: string;
  permissions: Permission[];
  department_scope: string[];
  department_can_view: boolean;
  department_can_entry: boolean;
}

export type UpdateUserPermissionsPayload = Omit<CreateUserPayload, 'username' | 'password' | 'display_name'>;

interface SystemScreenProps {
  logs: OperationLog[];
  backups: BackupInfo[];
  onCreateBackup: () => Promise<void>;
  onRestoreBackup: (backupId: number) => Promise<void>;
  onRefresh: () => void;
  users: BackendUserRecord[];
  canManageUsers: boolean;
  departments: string[];
  currentUserId: number;
  onCreateUser: (data: CreateUserPayload) => Promise<void>;
  onUpdateUserPermissions: (userId: number, data: UpdateUserPermissionsPayload) => Promise<void>;
  onDeleteUser: (userId: number) => Promise<void>;
}

const PERMISSION_OPTIONS = SYSTEM_PERMISSION_OPTIONS;
const PERMISSION_LABELS = Object.fromEntries(PERMISSION_OPTIONS.map((item) => [item.value, item.label])) as Record<Permission, string>;

function deriveRoleCode(permissions: Permission[]): RoleCode {
  if (permissions.includes('system_admin')) return 'admin';
  if (permissions.length === 1 && permissions[0] === 'order_entry') return 'order_entry';
  if (permissions.length === 1 && permissions[0] === 'purchase_entry') return 'purchase_entry';
  if (permissions.length === 1 && permissions[0] === 'sales_entry') return 'sales_entry';
  return 'viewer';
}

function parseList(value: string[] | string | null | undefined) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default function SystemScreen({
  logs,
  backups,
  onCreateBackup,
  onRestoreBackup,
  onRefresh,
  users,
  canManageUsers,
  departments,
  currentUserId,
  onCreateUser,
  onUpdateUserPermissions,
  onDeleteUser,
}: SystemScreenProps) {
  // Pagination State for Logs
  const [logPage, setLogPage] = useState(1);
  const itemsPerPage = 5;

  // Pagination State for Backups
  const [backupPage, setBackupPage] = useState(1);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    confirm_password: '',
    display_name: '',
    role_code: 'viewer',
    permissions: [] as Permission[],
    department_scope: [] as string[],
    department_can_view: false,
    department_can_entry: false,
  });
  const [userMessage, setUserMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [departmentInput, setDepartmentInput] = useState('');
  const [editingUser, setEditingUser] = useState<BackendUserRecord | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPermissionsPayload>({
    role_code: 'viewer',
    permissions: [],
    department_scope: [],
    department_can_view: false,
    department_can_entry: false,
  });
  const [editDepartmentInput, setEditDepartmentInput] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  // Filter logs & backups to show only 5 items per page
  const paginatedLogs = useMemo(() => {
    const startIndex = (logPage - 1) * itemsPerPage;
    return logs.slice(startIndex, startIndex + itemsPerPage);
  }, [logs, logPage]);

  const paginatedBackups = useMemo(() => {
    const startIndex = (backupPage - 1) * itemsPerPage;
    return backups.slice(startIndex, startIndex + itemsPerPage);
  }, [backups, backupPage]);

  const totalLogPages = Math.max(1, Math.ceil(logs.length / itemsPerPage));
  const totalBackupPages = Math.max(1, Math.ceil(backups.length / itemsPerPage));
  const availableDepartments = useMemo(() => Array.from(new Set(departments.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [departments]);

  // Trigger Immediate Backup
  const handleImmediateBackup = async () => {
    setBackupBusy(true);
    try {
      await onCreateBackup();
      setBackupPage(1);
      alert('备份文件已创建并校验。');
    } catch (error) {
      alert(error instanceof Error ? error.message : '备份创建失败');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleSystemRestore = async (backupId: number, fileName: string) => {
    const confirm = window.confirm(`您确定要使用备份文件 "${fileName}" 恢复系统数据库吗？此操作不可逆。`);
    if (!confirm) return;
    setBackupBusy(true);
    try {
      await onRestoreBackup(backupId);
      alert('系统业务数据恢复成功。');
    } catch (error) {
      alert(error instanceof Error ? error.message : '系统恢复失败');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleUserSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setUserMessage('');
    if (userForm.password !== userForm.confirm_password) {
      setUserMessage('两次输入的密码不一致');
      return;
    }
    if (userForm.department_scope.length > 0 && !userForm.department_can_view && !userForm.department_can_entry) {
      setUserMessage('选择部门后至少勾选查看或录入权限');
      return;
    }
    try {
      const { confirm_password: _confirmPassword, ...payload } = userForm;
      await onCreateUser({ ...payload, role_code: deriveRoleCode(payload.permissions) });
      setUserForm({
        username: '',
        password: '',
        confirm_password: '',
        display_name: '',
        role_code: 'viewer',
        permissions: [],
        department_scope: [],
        department_can_view: false,
        department_can_entry: false,
      });
      setUserMessage('账号创建成功');
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号创建失败');
    }
  };

  const togglePermission = (permission: Permission) => {
    setUserForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((item) => item !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const toggleDepartment = (department: string) => {
    setUserForm((prev) => ({
      ...prev,
      department_scope: prev.department_scope.includes(department)
        ? prev.department_scope.filter((item) => item !== department)
        : [...prev.department_scope, department],
    }));
  };

  const addDepartment = () => {
    const department = departmentInput.trim();
    if (!department || userForm.department_scope.includes(department)) {
      setDepartmentInput('');
      return;
    }
    setUserForm((prev) => ({
      ...prev,
      department_scope: [...prev.department_scope, department],
    }));
    setDepartmentInput('');
  };

  const toggleEditPermission = (permission: Permission) => {
    setEditForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((item) => item !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const toggleEditDepartment = (department: string) => {
    setEditForm((prev) => ({
      ...prev,
      department_scope: prev.department_scope.includes(department)
        ? prev.department_scope.filter((item) => item !== department)
        : [...prev.department_scope, department],
    }));
  };

  const addEditDepartment = () => {
    const department = editDepartmentInput.trim();
    if (!department || editForm.department_scope.includes(department)) {
      setEditDepartmentInput('');
      return;
    }
    setEditForm((prev) => ({
      ...prev,
      department_scope: [...prev.department_scope, department],
    }));
    setEditDepartmentInput('');
  };

  const openPermissionEditor = (user: BackendUserRecord) => {
    const permissions = parseList(user.permissions_json) as Permission[];
    setEditingUser(user);
    setEditForm({
      role_code: user.role_code,
      permissions,
      department_scope: parseList(user.department_scope_json),
      department_can_view: Boolean(user.department_can_view),
      department_can_entry: Boolean(user.department_can_entry),
    });
    setEditDepartmentInput('');
    setUserMessage('');
  };

  const closePermissionEditor = () => {
    setEditingUser(null);
    setEditDepartmentInput('');
  };

  const handlePermissionSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setUserMessage('');
    if (editForm.department_scope.length > 0 && !editForm.department_can_view && !editForm.department_can_entry) {
      setUserMessage('选择部门后至少勾选查看或录入权限');
      return;
    }
    try {
      await onUpdateUserPermissions(editingUser.id, { ...editForm, role_code: deriveRoleCode(editForm.permissions) });
      setUserMessage('账号权限修改成功');
      closePermissionEditor();
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号权限修改失败');
    }
  };

  const handleDeleteUser = async (user: BackendUserRecord) => {
    const confirmed = window.confirm(`确定删除账号 "${user.username}" 吗？删除后该账号将不能登录。`);
    if (!confirmed) return;
    setUserMessage('');
    try {
      await onDeleteUser(user.id);
      setUserMessage('账号删除成功');
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号删除失败');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">系统信息与维护</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">查看系统运行日志、管理数据备份并进行版本升级。</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button 
            onClick={() => {
              onRefresh();
              alert('视图与系统缓存数据刷新成功！');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold"
          >
            <RefreshCw className="w-4 h-4" />
            <span>刷新视图</span>
          </button>
        </div>
      </div>

      {canManageUsers && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <span>账号与权限管理</span>
            </h3>
            {userMessage && <span className="text-xs font-medium text-blue-600">{userMessage}</span>}
          </div>

          <div className="p-5 grid grid-cols-1 xl:grid-cols-[520px_1fr] gap-5">
            <form onSubmit={handleUserSubmit} className="rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-600">登录账号</span>
                  <input required value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-600">显示名称</span>
                  <input required value={userForm.display_name} onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-600">初始密码</span>
                  <div className="relative">
                    <input required type={showPassword ? 'text' : 'password'} minLength={6} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} title={showPassword ? '隐藏密码' : '显示密码'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-600">确认密码</span>
                  <div className="relative">
                    <input required type={showConfirmPassword ? 'text' : 'password'} minLength={6} value={userForm.confirm_password} onChange={(e) => setUserForm({ ...userForm, confirm_password: e.target.value })} className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} title={showConfirmPassword ? '隐藏密码' : '显示密码'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>功能权限</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PERMISSION_OPTIONS.map((item) => (
                    <label key={item.value} className="flex items-center gap-2 px-2.5 py-2 rounded border border-slate-100 bg-slate-50 text-xs text-slate-700">
                      <input type="checkbox" checked={userForm.permissions.includes(item.value)} onChange={() => togglePermission(item.value)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-700">部门权限</span>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={userForm.department_can_view} onChange={(e) => setUserForm({ ...userForm, department_can_view: e.target.checked })} />
                      <span>查看</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={userForm.department_can_entry} onChange={(e) => setUserForm({ ...userForm, department_can_entry: e.target.checked })} />
                      <span>录入</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    list="department-options"
                    value={departmentInput}
                    onChange={(event) => setDepartmentInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addDepartment();
                      }
                    }}
                    placeholder="选择或输入部门"
                    className="min-w-0 flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                  <datalist id="department-options">
                    {availableDepartments.map((department) => (
                      <option key={department} value={department} />
                    ))}
                  </datalist>
                  <button type="button" onClick={addDepartment} title="添加部门" className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-8">
                  {userForm.department_scope.map((department) => (
                    <span key={department} className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded border border-blue-100 bg-blue-50 text-xs text-blue-700">
                      <span className="truncate">{department}</span>
                      <button type="button" onClick={() => toggleDepartment(department)} title={`移除 ${department}`} className="text-blue-500 hover:text-blue-800">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {userForm.department_scope.length === 0 && <span className="text-xs text-slate-400 py-1">未选择时默认全部部门</span>}
                </div>
              </div>
              <button type="submit" className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">创建账号</button>
            </form>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">账号</th>
                    <th className="px-4 py-2 font-semibold">姓名</th>
                    <th className="px-4 py-2 font-semibold">角色</th>
                    <th className="px-4 py-2 font-semibold">功能权限</th>
                    <th className="px-4 py-2 font-semibold">部门权限</th>
                    <th className="px-4 py-2 font-semibold">状态</th>
                    <th className="px-4 py-2 font-semibold">最后登录</th>
                    <th className="px-4 py-2 font-semibold text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="text-xs text-slate-700">
                      <td className="px-4 py-2 font-mono text-blue-600">{user.username}</td>
                      <td className="px-4 py-2 font-semibold">{user.display_name}</td>
                      <td className="px-4 py-2">{ROLE_LABELS[user.role_code as RoleCode] || user.role_code}</td>
                      <td className="px-4 py-2">
                        {parseList(user.permissions_json).map((permission) => PERMISSION_LABELS[permission as Permission] || permission).join('、') || '无'}
                      </td>
                      <td className="px-4 py-2">
                        {parseList(user.department_scope_json).join('、') || '全部部门'}
                        <span className="ml-2 text-slate-400">
                          {user.department_can_view ? '可看' : ''}
                          {user.department_can_view && user.department_can_entry ? '/' : ''}
                          {user.department_can_entry ? '可录' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2">{user.is_active ? '启用' : '停用'}</td>
                      <td className="px-4 py-2 font-mono text-slate-400">{user.last_login_at || '-'}</td>
                      <td className="px-4 py-2 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={user.id === currentUserId || !user.is_active}
                            onClick={() => openPermissionEditor(user)}
                            title={user.id === currentUserId ? '不能修改当前登录账号权限' : '修改权限'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={user.id === currentUserId || !user.is_active}
                            onClick={() => handleDeleteUser(user)}
                            title={user.id === currentUserId ? '不能删除当前登录账号' : '删除账号'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <form onSubmit={handlePermissionSubmit} className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">修改账号权限：{editingUser.username}</h3>
              <button type="button" onClick={closePermissionEditor} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>功能权限</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {PERMISSION_OPTIONS.map((item) => (
                    <label key={item.value} className="flex items-center gap-2 px-2.5 py-2 rounded border border-slate-100 bg-slate-50 text-xs text-slate-700">
                      <input type="checkbox" checked={editForm.permissions.includes(item.value)} onChange={() => toggleEditPermission(item.value)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-700">部门权限</span>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={editForm.department_can_view} onChange={(e) => setEditForm({ ...editForm, department_can_view: e.target.checked })} />
                      <span>查看</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={editForm.department_can_entry} onChange={(e) => setEditForm({ ...editForm, department_can_entry: e.target.checked })} />
                      <span>录入</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    list="edit-department-options"
                    value={editDepartmentInput}
                    onChange={(event) => setEditDepartmentInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addEditDepartment();
                      }
                    }}
                    placeholder="选择或输入部门"
                    className="min-w-0 flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                  <datalist id="edit-department-options">
                    {availableDepartments.map((department) => (
                      <option key={department} value={department} />
                    ))}
                  </datalist>
                  <button type="button" onClick={addEditDepartment} title="添加部门" className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-8">
                  {editForm.department_scope.map((department) => (
                    <span key={department} className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded border border-blue-100 bg-blue-50 text-xs text-blue-700">
                      <span className="truncate">{department}</span>
                      <button type="button" onClick={() => toggleEditDepartment(department)} title={`移除 ${department}`} className="text-blue-500 hover:text-blue-800">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {editForm.department_scope.length === 0 && <span className="text-xs text-slate-400 py-1">未选择时默认全部部门</span>}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button type="button" onClick={closePermissionEditor} className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium">取消</button>
              <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">保存权限</button>
            </div>
          </form>
        </div>
      )}

      {/* 1. Operation Log Section with 5 per page pagination */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>操作日志</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[180px]">用户</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[140px]">操作模块</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[420px]">详情</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[160px]">操作时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-3.5 text-xs font-medium text-slate-700 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                      {log.user.charAt(0)}
                    </span>
                    <span>{log.user}</span>
                  </td>
                  <td className="px-6 py-3.5 text-xs">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                      {log.module}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-600 truncate" title={log.details}>{log.details}</td>
                  <td className="px-6 py-3.5 text-xs text-center text-slate-400 font-mono">{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination 1 */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            显示 {logs.length === 0 ? 0 : (logPage - 1) * itemsPerPage + 1} 到 {Math.min(logPage * itemsPerPage, logs.length)} 条，共 {logs.length} 条记录
          </span>
          <div className="flex items-center gap-1">
            <button 
              disabled={logPage === 1}
              onClick={() => setLogPage(prev => Math.max(1, prev - 1))}
              className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono px-3 py-1 bg-white border border-slate-200 rounded text-slate-700">
              Page {logPage} / {totalLogPages}
            </span>
            <button 
              disabled={logPage === totalLogPages}
              onClick={() => setLogPage(prev => Math.min(totalLogPages, prev + 1))}
              className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* 2. Backup Info Section with 5 per page pagination */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
          <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
            <Database className="w-4 h-4 text-blue-600" />
            <span>备份信息</span>
          </h3>
          {canManageUsers && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button 
                onClick={handleImmediateBackup}
                disabled={backupBusy}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs font-semibold"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>{backupBusy ? '处理中' : '立即备份'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[360px]">文件名</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-right w-[180px]">大小</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[200px]">备份时间</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[160px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedBackups.map((bk) => (
                <tr key={bk.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-3.5 text-xs font-mono font-medium text-slate-800 flex items-center gap-2">
                    <FileArchive className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{bk.fileName}</span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-right font-mono text-slate-600">{bk.size}</td>
                  <td className="px-6 py-3.5 text-xs text-center font-mono text-slate-400">{bk.backupTime}</td>
                  <td className="px-6 py-3.5 text-center">
                    <button 
                      onClick={() => handleSystemRestore(Number(bk.id), bk.fileName)}
                      disabled={backupBusy}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                    >
                      恢复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination 2 */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            显示 {backups.length === 0 ? 0 : (backupPage - 1) * itemsPerPage + 1} 到 {Math.min(backupPage * itemsPerPage, backups.length)} 条，共 {backups.length} 条记录
          </span>
          <div className="flex items-center gap-1">
            <button 
              disabled={backupPage === 1}
              onClick={() => setBackupPage(prev => Math.max(1, prev - 1))}
              className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono px-3 py-1 bg-white border border-slate-200 rounded text-slate-700">
              Page {backupPage} / {totalBackupPages}
            </span>
            <button 
              disabled={backupPage === totalBackupPages}
              onClick={() => setBackupPage(prev => Math.min(totalBackupPages, prev + 1))}
              className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
