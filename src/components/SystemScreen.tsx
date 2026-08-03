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
  Trash2,
  ChevronDown,
  RotateCcw,
  KeyRound,
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
  inactiveUsers: BackendUserRecord[];
  canManageUsers: boolean;
  departments: string[];
  currentUserId: number;
  onCreateUser: (data: CreateUserPayload) => Promise<void>;
  onUpdateUserPermissions: (userId: number, data: UpdateUserPermissionsPayload) => Promise<void>;
  onDeactivateUser: (userId: number) => Promise<void>;
  onRestoreUser: (userId: number) => Promise<void>;
  onResetUserPassword: (userId: number, password: string) => Promise<void>;
  onPermanentlyDeleteUser: (userId: number) => Promise<void>;
}

const PERMISSION_OPTIONS = SYSTEM_PERMISSION_OPTIONS;
const PERMISSION_LABELS = Object.fromEntries(PERMISSION_OPTIONS.map((item) => [item.value, item.label])) as Record<Permission, string>;
const ENTRY_REQUIRES_VIEW_MESSAGE = '已勾选录入权限，请同时勾选“查看”权限，用于核对录入数据是否有误。';

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

function formatDateTime(value: string | null | undefined) {
  return value ? value.replace('T', ' ').slice(0, 19) : '-';
}

export default function SystemScreen({
  logs,
  backups,
  onCreateBackup,
  onRestoreBackup,
  onRefresh,
  users,
  inactiveUsers,
  canManageUsers,
  departments,
  currentUserId,
  onCreateUser,
  onUpdateUserPermissions,
  onDeactivateUser,
  onRestoreUser,
  onResetUserPassword,
  onPermanentlyDeleteUser,
}: SystemScreenProps) {
  // Pagination State for Logs
  const [logPage, setLogPage] = useState(1);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(() => new Set());
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
  const [resettingUser, setResettingUser] = useState<BackendUserRecord | null>(null);
  const [resetPasswordForm, setResetPasswordForm] = useState({ password: '', confirmPassword: '' });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
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
    if (userForm.department_can_entry && !userForm.department_can_view) {
      setUserMessage(ENTRY_REQUIRES_VIEW_MESSAGE);
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

  const openPasswordReset = (user: BackendUserRecord) => {
    setResettingUser(user);
    setResetPasswordForm({ password: '', confirmPassword: '' });
    setShowResetPassword(false);
    setShowResetConfirmPassword(false);
    setUserMessage('');
  };

  const closePasswordReset = () => {
    if (resetPasswordBusy) return;
    setResettingUser(null);
    setResetPasswordForm({ password: '', confirmPassword: '' });
    setShowResetPassword(false);
    setShowResetConfirmPassword(false);
    setUserMessage('');
  };

  const handlePasswordResetSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resettingUser) return;
    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      setUserMessage('两次输入的新密码不一致');
      return;
    }
    setResetPasswordBusy(true);
    setUserMessage('');
    try {
      await onResetUserPassword(resettingUser.id, resetPasswordForm.password);
      const username = resettingUser.username;
      setResettingUser(null);
      setResetPasswordForm({ password: '', confirmPassword: '' });
      setUserMessage(`账号 "${username}" 的密码已重置`);
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '密码重置失败');
    } finally {
      setResetPasswordBusy(false);
    }
  };

  const handlePermissionSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setUserMessage('');
    if (editForm.department_can_entry && !editForm.department_can_view) {
      setUserMessage(ENTRY_REQUIRES_VIEW_MESSAGE);
      return;
    }
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

  const handleDeactivateUser = async (user: BackendUserRecord) => {
    const confirmed = window.confirm(
      `确定停用账号 "${user.username}" 吗？停用后该账号将不能登录，并会进入停用账号汇总。`,
    );
    if (!confirmed) return;
    setUserMessage('');
    try {
      await onDeactivateUser(user.id);
      setUserMessage('账号已停用，可在停用账号汇总中查看或永久删除');
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号停用失败');
    }
  };

  const handlePermanentlyDeleteUser = async (user: BackendUserRecord) => {
    const confirmed = window.confirm(
      `确定永久删除已停用账号 "${user.username}" 吗？该操作不可恢复，删除后可以重新创建同名登录账号。`,
    );
    if (!confirmed) return;
    setUserMessage('');
    try {
      await onPermanentlyDeleteUser(user.id);
      setUserMessage(`已永久删除停用账号 "${user.username}"`);
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号永久删除失败');
    }
  };

  const handleRestoreUser = async (user: BackendUserRecord) => {
    const confirmed = window.confirm(
      `确定恢复账号 "${user.username}" 吗？恢复后该账号可使用原密码登录，并保留原有角色和权限。`,
    );
    if (!confirmed) return;
    setUserMessage('');
    try {
      await onRestoreUser(user.id);
      setUserMessage(`已恢复账号 "${user.username}"`);
    } catch (error) {
      setUserMessage(error instanceof Error ? error.message : '账号恢复失败');
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
            <form onSubmit={handleUserSubmit} autoComplete="off" className="rounded-lg border border-slate-200 p-4 space-y-3">
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
                    <input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} title={showPassword ? '隐藏密码' : '显示密码'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-slate-600">确认密码</span>
                  <div className="relative">
                    <input required type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={userForm.confirm_password} onChange={(e) => setUserForm({ ...userForm, confirm_password: e.target.value })} className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
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
                      <input
                        type="checkbox"
                        checked={userForm.department_can_view}
                        onChange={(event) => {
                          const departmentCanView = event.target.checked;
                          setUserForm({ ...userForm, department_can_view: departmentCanView });
                          setUserMessage(
                            !departmentCanView && userForm.department_can_entry
                              ? ENTRY_REQUIRES_VIEW_MESSAGE
                              : '',
                          );
                        }}
                      />
                      <span>查看</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={userForm.department_can_entry}
                        onChange={(event) => {
                          const departmentCanEntry = event.target.checked;
                          setUserForm({ ...userForm, department_can_entry: departmentCanEntry });
                          setUserMessage(
                            departmentCanEntry && !userForm.department_can_view
                              ? ENTRY_REQUIRES_VIEW_MESSAGE
                              : '',
                          );
                        }}
                      />
                      <span>录入</span>
                    </label>
                  </div>
                </div>
                {userForm.department_can_entry && !userForm.department_can_view && (
                  <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {ENTRY_REQUIRES_VIEW_MESSAGE}
                  </div>
                )}
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
                      <td className="px-4 py-2 font-mono text-slate-400">{formatDateTime(user.last_login_at)}</td>
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
                            disabled={!user.is_active}
                            onClick={() => openPasswordReset(user)}
                            title={`重置账号 ${user.username} 的密码`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-violet-100 bg-violet-50 text-violet-600 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={user.id === currentUserId || !user.is_active}
                            onClick={() => handleDeactivateUser(user)}
                            title={user.id === currentUserId ? '不能停用当前登录账号' : '停用账号'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
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

      {canManageUsers && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>停用账号汇总</span>
                <span className="inline-flex min-w-6 h-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">
                  {inactiveUsers.length}
                </span>
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                停用账号可恢复并继续使用原密码和权限；永久删除后可重新使用原登录账号。
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">账号</th>
                  <th className="px-4 py-3 font-semibold">姓名</th>
                  <th className="px-4 py-3 font-semibold">原角色</th>
                  <th className="px-4 py-3 font-semibold">原功能权限</th>
                  <th className="px-4 py-3 font-semibold">停用时间</th>
                  <th className="px-4 py-3 font-semibold">最后登录</th>
                  <th className="px-4 py-3 font-semibold text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inactiveUsers.map((user) => (
                  <tr key={user.id} className="text-xs text-slate-700">
                    <td className="px-4 py-3 font-mono text-slate-600">{user.username}</td>
                    <td className="px-4 py-3 font-semibold">{user.display_name}</td>
                    <td className="px-4 py-3">{ROLE_LABELS[user.role_code as RoleCode] || user.role_code}</td>
                    <td className="px-4 py-3">
                      {parseList(user.permissions_json)
                        .map((permission) => PERMISSION_LABELS[permission as Permission] || permission)
                        .join('、') || '无'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400">{formatDateTime(user.updated_at)}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{formatDateTime(user.last_login_at)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreUser(user)}
                          title={`恢复停用账号 ${user.username}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>恢复</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePermanentlyDeleteUser(user)}
                          title={`永久删除停用账号 ${user.username}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>永久删除</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {inactiveUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">
                      暂无停用账号
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {resettingUser && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handlePasswordResetSubmit}
            autoComplete="off"
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-900">重置密码：{resettingUser.username}</h3>
              <button type="button" onClick={closePasswordReset} disabled={resetPasswordBusy} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs leading-5 text-slate-500">
                重置后原密码立即失效，请将新密码安全地告知账号使用人。操作日志不会记录明文密码。
              </p>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">新密码</span>
                <div className="relative">
                  <input
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPasswordForm.password}
                    onChange={(event) => setResetPasswordForm({ ...resetPasswordForm, password: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((value) => !value)}
                    title={showResetPassword ? '隐藏新密码' : '显示新密码'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">确认新密码</span>
                <div className="relative">
                  <input
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    type={showResetConfirmPassword ? 'text' : 'password'}
                    value={resetPasswordForm.confirmPassword}
                    onChange={(event) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetConfirmPassword((value) => !value)}
                    title={showResetConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showResetConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
              {userMessage && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{userMessage}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button type="button" onClick={closePasswordReset} disabled={resetPasswordBusy} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">取消</button>
              <button type="submit" disabled={resetPasswordBusy} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60">
                {resetPasswordBusy ? '正在重置…' : '确认重置'}
              </button>
            </div>
          </form>
        </div>
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
                      <input
                        type="checkbox"
                        checked={editForm.department_can_view}
                        onChange={(event) => {
                          const departmentCanView = event.target.checked;
                          setEditForm({ ...editForm, department_can_view: departmentCanView });
                          setUserMessage(
                            !departmentCanView && editForm.department_can_entry
                              ? ENTRY_REQUIRES_VIEW_MESSAGE
                              : '',
                          );
                        }}
                      />
                      <span>查看</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={editForm.department_can_entry}
                        onChange={(event) => {
                          const departmentCanEntry = event.target.checked;
                          setEditForm({ ...editForm, department_can_entry: departmentCanEntry });
                          setUserMessage(
                            departmentCanEntry && !editForm.department_can_view
                              ? ENTRY_REQUIRES_VIEW_MESSAGE
                              : '',
                          );
                        }}
                      />
                      <span>录入</span>
                    </label>
                  </div>
                </div>
                {editForm.department_can_entry && !editForm.department_can_view && (
                  <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    {ENTRY_REQUIRES_VIEW_MESSAGE}
                  </div>
                )}
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
          <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[180px]">用户</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[140px]">操作模块</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[500px]">详情</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[90px]">操作结果</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[160px]">操作时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.map((log) => {
                const changeGroups = log.changeGroups || [];
                const expandable = changeGroups.length > 0;
                const expanded = expandable && expandedLogIds.has(log.id);
                const changedCellCount = changeGroups.reduce(
                  (total, group) => total + group.changes.length,
                  0,
                );
                return (
                  <React.Fragment key={log.id}>
                    <tr className="hover:bg-slate-50/80 transition-colors">
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
                      <td className="px-6 py-3.5 text-xs text-slate-600 whitespace-normal break-words leading-5">
                        {expandable ? (
                          <button
                            type="button"
                            onClick={() => setExpandedLogIds((current) => {
                              const next = new Set(current);
                              if (next.has(log.id)) next.delete(log.id);
                              else next.add(log.id);
                              return next;
                            })}
                            className="flex w-full items-start gap-2 rounded-md text-left hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            aria-expanded={expanded}
                            aria-controls={`log-batch-details-${log.id}`}
                          >
                            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            <span className="flex-1">{log.details}</span>
                            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              {changedCellCount} 个单元格
                            </span>
                          </button>
                        ) : (
                          <span title={log.details}>{log.details}</span>
                        )}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          log.status === '成功'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : log.status === '失败'
                              ? 'bg-red-50 text-red-700 border border-red-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-center text-slate-400 font-mono">{log.time}</td>
                    </tr>
                    {expanded && (
                      <tr id={`log-batch-details-${log.id}`} className="bg-blue-50/35">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="space-y-3 border-l-2 border-blue-200 pl-4">
                            {changeGroups.map((group) => (
                              <section key={group.title} className="rounded-lg border border-blue-100 bg-white p-3">
                                <h4 className="text-xs font-semibold text-slate-700">{group.title}</h4>
                                <ol className="mt-2 space-y-1.5">
                                  {group.changes.map((change, changeIndex) => (
                                    <li key={`${change}-${changeIndex}`} className="flex gap-2 text-xs text-slate-600">
                                      <span className="font-mono text-blue-500">{changeIndex + 1}.</span>
                                      <span className="break-words">{change}</span>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
