import EditConflictDialog from './components/EditConflictDialog';
import { editingApi } from './api';
import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  ShoppingBag,
  DollarSign,
  Settings,
  Menu,
  LogOut,
  CircleUserRound,
} from 'lucide-react';
import {
  ProjectLedger,
  OrderRecord,
  PurchaseRecord,
  SalesRecord,
  OperationLog,
  BackupInfo,
  ScreenType,
} from './types';
import {
  api,
  BackendBackupInfo,
  BackendAuthUser,
  BackendOperationLog,
  BackendOrderRecord,
  BackendProjectLedger,
  BackendPurchaseRecord,
  BackendSalesRecord,
  BackendUserRecord,
  UNAUTHORIZED_EVENT,
} from './api';
import { AuthUser, hasPermission, normalizeUser } from './lib/permissions';
import {
  formatOperationLogChangeGroups,
  formatOperationLogDetails,
} from './lib/operationLogDisplay';
import { formatDatabaseUtcTime } from './lib/dateTime';
import { loadAllPages } from './lib/loadAllPages';
import { rawAmount, optionalAmount } from './lib/money';

import DashboardScreen from './components/DashboardScreen';
import LedgerScreen from './components/LedgerScreen';
import OrdersScreen from './components/OrdersScreen';
import PurchasesScreen from './components/PurchasesScreen';
import SalesScreen from './components/SalesScreen';
import SystemScreen, { CreateUserPayload } from './components/SystemScreen';

const fallbackText = '-';
const ztfsIconLogo = new URL('./logo/中通服图标LOGO.png', import.meta.url).href;

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

function optionalNumber(value: number | null | undefined) {
  return value === null || value === undefined ? undefined : Number(value);
}

function mapLedger(item: BackendProjectLedger): ProjectLedger {
  return {
    editContext: item.edit_context,
    orderNumberHistory: item.order_number_history,
    managerHistory: item.manager_history,
    deliveryValue: rawAmount(item.delivery_value),
    deliveryCost: rawAmount(item.delivery_cost),
    totalPaid: rawAmount(item.total_paid),
    salesInvoiceAmount: rawAmount(item.sales_invoice_amount),
    receivedInvoiceAmount: rawAmount(item.received_invoice_amount),
    deliveryAccountsReceivable: optionalAmount(item.delivery_accounts_receivable),
    invoiceAccountsReceivable: optionalAmount(item.invoice_accounts_receivable),
    id: item.project_code,
    clientUnit: item.customer_unit_name || fallbackText,
    projectName: item.project_name || fallbackText,
    orderAmount: rawAmount(item.order_amount),
    purchaseAmount: rawAmount(item.purchase_amount),
    totalReceived: rawAmount(item.total_received),
    department: item.department || fallbackText,
    manager: item.account_manager || fallbackText,
    orderId: `${item.order_count || 0} 个订单`,
    orderStatus: item.computed_close_status || fallbackText,
    orderDate: dateOnly(item.last_order_date || item.first_order_date),
  };
}

function mapOrder(item: BackendOrderRecord): OrderRecord {
  return {
    editContext: item.edit_context,
    orderNumberHistory: item.order_number_history,
    managerHistory: item.manager_history,
    orderLineId: item.order_line_id,
    amountType: item.amount_type || '',
    projectId: item.project_code,
    projectName: item.project_name || '',
    department: item.department || '',
    branchCompany: item.branch_company || '',
    manager: item.account_manager || '',
    orderId: item.order_no,
    orderDate: dateOnly(item.order_date),
    updatedAt: formatDatabaseUtcTime(item.last_modified_at),
    orderStatus: item.close_status || '',
    totalReceived: optionalAmount(item.total_received),
    totalPaid: optionalAmount(item.total_paid),
    deliveryAccountsReceivable: optionalAmount(item.delivery_accounts_receivable),
    invoiceAccountsReceivable: optionalAmount(item.invoice_accounts_receivable),
    accountsReceivable: optionalAmount(item.accounts_receivable),
    accountsPayable: optionalAmount(item.accounts_payable),
    grossProfit: optionalAmount(item.gross_profit),
    statisticalCategory: item.statistical_category || '',
    teamName: item.team_name || '',
    goodsName: item.goods_name || fallbackText,
    userName: item.user_name || '',
    regionalPlatform: item.regional_platform || '',
    specModel: item.spec_model || '',
    unitName: item.unit_name || '',
    quantity: `${item.quantity ?? 0} ${item.unit_name || ''}`.trim(),
    salesTaxRate: optionalNumber(item.sales_tax_rate),
    netUnitPrice: optionalAmount(item.net_unit_price),
    unitPrice: optionalAmount(item.unit_price),
    netRevenue: optionalAmount(item.net_revenue),
    orderValue: rawAmount(item.order_value),
    salesTaxAmount: optionalAmount(item.sales_tax_amount),
    deliveredQty: rawAmount(item.delivery_quantity),
    businessType: item.business_type || fallbackText,
    clientUnit: item.customer_unit_name || fallbackText,
    supplierName: item.supplier_name || '',
    purchaseTaxRate: optionalNumber(item.purchase_tax_rate),
    purchaseUnitPriceNoTax: optionalAmount(item.purchase_unit_price_no_tax),
    purchaseUnitPrice: optionalAmount(item.purchase_unit_price),
    costNoTax: optionalAmount(item.cost_no_tax),
    purchaseAmount: optionalAmount(item.purchase_amount),
    purchaseTaxAmount: optionalAmount(item.purchase_tax_amount),
    laborCost: optionalAmount(item.labor_cost),
    otherCost: optionalAmount(item.other_cost),
    deliveryDate: dateOnly(item.delivery_date),
    deliveryRevenueNoTax: optionalAmount(item.delivery_revenue_no_tax),
    deliveryValue: optionalAmount(item.delivery_value),
    deliveryCostNoTax: optionalAmount(item.delivery_cost_no_tax),
    deliveryCost: optionalAmount(item.delivery_cost),
    pendingDeliveryQuantity: optionalAmount(item.pending_delivery_quantity),
    pendingDeliveryAmountNoTax: optionalAmount(item.pending_delivery_amount_no_tax),
    pendingDeliveryAmount: optionalAmount(item.pending_delivery_amount),
  };
}

function mapPurchase(item: BackendPurchaseRecord): PurchaseRecord {
  return {
    editContext: item.edit_context,
    orderNumberHistory: item.order_number_history,
    managerHistory: item.manager_history,
    orderLineId: item.order_line_id,
    projectId: item.project_code,
    orderId: item.order_no,
    manager: item.account_manager || fallbackText,
    department: item.department || fallbackText,
    contractNo: item.purchase_contract_no || fallbackText,
    contractAmount: rawAmount(item.purchase_contract_signed_amount),
    invoiceAmount: rawAmount(item.received_invoice_amount),
    paymentAmount: rawAmount(item.total_paid),
    supplier: item.supplier_name || fallbackText,
    paymentDate: dateOnly(item.latest_payment_date),
    paymentPhases: item.payment_phases,
  };
}

function mapSale(item: BackendSalesRecord): SalesRecord {
  return {
    editContext: item.edit_context,
    orderNumberHistory: item.order_number_history,
    managerHistory: item.manager_history,
    orderLineId: item.order_line_id,
    projectId: item.project_code,
    orderId: item.order_no,
    manager: item.account_manager || fallbackText,
    department: item.department || fallbackText,
    contractNo: item.sales_contract_no || fallbackText,
    contractDate: dateOnly(item.sales_contract_signed_date),
    contractValue: rawAmount(item.sales_contract_value),
    invoiceAmount: rawAmount(item.sales_invoice_amount),
    totalReceived: rawAmount(item.total_received),
    deliveryAccountsReceivable: optionalAmount(item.delivery_accounts_receivable),
    invoiceAccountsReceivable: optionalAmount(item.invoice_accounts_receivable),
    accountsReceivable: rawAmount(item.accounts_receivable),
    supplierName: item.supplier_name || '',
    receiptDate: dateOnly(item.latest_receipt_date),
    receiptPhases: item.receipt_phases,
    invoiceDates: item.invoice_phases?.map(p => p.date || '').filter(Boolean) || (item.invoice_dates || '').split(',').map((value) => value.trim()).filter(Boolean),
  };
}

function mapLog(item: BackendOperationLog): OperationLog {
  return {
    id: String(item.id),
    user: item.user_name || 'system',
    module: item.module_name,
    details: formatOperationLogDetails(item),
    changeGroups: formatOperationLogChangeGroups(item),
    status: item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '进行中',
    time: formatDatabaseUtcTime(item.created_at),
  };
}

function mapBackup(item: BackendBackupInfo): BackupInfo {
  return {
    id: String(item.id),
    fileName: item.file_name,
    size: item.file_size_label || fallbackText,
    backupTime: dateOnly(item.backup_time),
  };
}

function mapAuthUser(item: BackendAuthUser): AuthUser {
  return normalizeUser(item);
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [ledgers, setLedgers] = useState<ProjectLedger[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [sales, setSales] = useState<SalesRecord[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [users, setUsers] = useState<BackendUserRecord[]>([]);
  const [inactiveUsers, setInactiveUsers] = useState<BackendUserRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');

  const clearSession = () => {
    window.localStorage.removeItem('erp_auth_token');
    api.setToken('');
    setCurrentUser(null);
    setCurrentScreen('dashboard');
    setUsers([]);
    setInactiveUsers([]);
    setLedgers([]);
    setOrders([]);
    setPurchases([]);
    setSales([]);
    setLogs([]);
    setBackups([]);
    setLastUpdated('');
  };

  async function loadBackendData(user = currentUser) {
    setError('');
    try {
      const [, ledgerData, orderData, purchaseData, salesData] = await Promise.all([
        api.health(),
        loadAllPages(api.ledgers),
        loadAllPages(api.orders),
        loadAllPages(api.purchases),
        loadAllPages(api.sales),
      ]);

      setLedgers(ledgerData.items.map(mapLedger));
      setOrders(orderData.items.map(mapOrder));
      setPurchases(purchaseData.items.map(mapPurchase));
      setSales(salesData.items.map(mapSale));
      setLastUpdated(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      if (user && hasPermission(user, 'system_admin')) {
        const [userData, inactiveUserData, logData, backupData] = await Promise.all([
          api.users(),
          api.users('inactive'),
          api.logs(),
          api.backups(),
        ]);
        setUsers(userData.items);
        setInactiveUsers(inactiveUserData.items);
        setLogs(logData.items.map(mapLog));
        setBackups(backupData.items.map(mapBackup));
      } else {
        setUsers([]);
        setInactiveUsers([]);
        setLogs([]);
        setBackups([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '后端数据加载失败');
    }
  }

  useEffect(() => {
    const token = window.localStorage.getItem('erp_auth_token');
    if (!token) {
      setAuthLoading(false);
      return;
    }
    api.setToken(token);
    api.me()
      .then(({ user }) => {
        const mappedUser = mapAuthUser(user);
        setCurrentUser(mappedUser);
        void loadBackendData(mappedUser);
      })
      .catch(() => {
        window.localStorage.removeItem('erp_auth_token');
        api.setToken('');
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearSession();
      setLoginError('登录已过期，请重新登录');
      setAuthLoading(false);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 767px)');
    const collapseOnMobile = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setSidebarCollapsed(true);
    };
    collapseOnMobile(mobileViewport);
    mobileViewport.addEventListener('change', collapseOnMobile);
    return () => mobileViewport.removeEventListener('change', collapseOnMobile);
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setLoginError('');
    try {
      const result = await api.login({ username, password });
      api.setToken(result.access_token);
      window.localStorage.setItem('erp_auth_token', result.access_token);
      const mappedUser = mapAuthUser(result.user);
      setCurrentUser(mappedUser);
      setAuthLoading(false);
      await loadBackendData(mappedUser);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败');
    }
  };

  const handleLogout = () => {
    clearSession();
    setLoginError('');
  };

  const handleCreateUser = async (data: CreateUserPayload) => {
    const result = await api.createUser(data);
    setUsers(result.items);
  };

  const handleDeactivateUser = async (userId: number) => {
    const result = await api.deactivateUser(userId);
    setUsers(result.items);
    const inactiveResult = await api.users('inactive');
    setInactiveUsers(inactiveResult.items);
  };

  const handleRestoreUser = async (userId: number) => {
    const result = await api.restoreUser(userId);
    setUsers(result.items);
    const inactiveResult = await api.users('inactive');
    setInactiveUsers(inactiveResult.items);
  };

  const handleResetUserPassword = async (userId: number, password: string) => {
    await api.resetUserPassword(userId, password);
  };

  const handlePermanentlyDeleteUser = async (userId: number) => {
    const result = await api.permanentlyDeleteUser(userId);
    setInactiveUsers(result.items);
  };

  const handleUpdateUserPermissions = async (userId: number, data: Omit<CreateUserPayload, 'username' | 'password' | 'display_name'>) => {
    const result = await api.updateUserPermissions(userId, data);
    setUsers(result.items);
  };

  const addLog = (module: string, details: string) => {
    const now = new Date();
    const newLog: OperationLog = {
      id: `local-${Date.now()}`,
      user: currentUser ? `${currentUser.displayName} (${currentUser.roleLabel})` : '当前用户',
      module,
      details,
      status: '成功',
      time: now.toLocaleString('zh-CN', { hour12: false }),
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  const handleAddLedger = (newItem: ProjectLedger) => {
    setLedgers((prev) => [newItem, ...prev]);
    addLog('台账管理', `本地新增项目台账 "${newItem.projectName}" (${newItem.id})`);
  };

  const handleAddOrder = async (newItem: OrderRecord) => {
    await api.createOrder(orderToPayload(newItem));
    await loadBackendData();
  };

  const handleImportExcel = async (file: File) => {
    const result = await api.importOrdersExcel(file);
    await loadBackendData();
    return result;
  };

  const handleUpdateOrder = async (target: OrderRecord, updatedItem: OrderRecord) => {
    if (target.orderLineId) {
      await editingApi(target.editContext).updateOrder(target.orderLineId, orderToPayload(updatedItem));
      await loadBackendData();
    } else {
      setOrders((prev) => prev.map((item) => (item === target ? updatedItem : item)));
      addLog('订单管理', `修改本地订单 "${updatedItem.orderId}"`);
    }
  };

  const handleDeleteOrder = async (target: OrderRecord) => {
    if (target.orderLineId) {
      await editingApi(target.editContext).deleteOrder(target.orderLineId);
      await loadBackendData();
    } else {
      setOrders((prev) => prev.filter((item) => item !== target));
      addLog('订单管理', `删除本地订单 "${target.orderId}"`);
    }
  };

  const handleAddSales = (newItem: SalesRecord) => {
    setSales((prev) => [newItem, ...prev]);
    addLog('销售管理', `本地登记销售合同 ${newItem.contractNo}`);
  };

  const handleCreateBackup = async () => {
    await api.createBackup();
    await loadBackendData();
  };

  const handleRestoreBackup = async (backupId: number) => {
    await api.restoreBackup(backupId);
    await loadBackendData();
  };

  const handleRefreshAll = () => {
    void loadBackendData();
  };

  const getSidebarLinkClass = (screen: ScreenType) => {
    const baseClass = 'flex items-center gap-3 px-6 py-2.5 transition-all duration-150 text-[13px] font-medium ';
    if (currentScreen === screen) {
      return baseClass + 'bg-blue-600/10 text-blue-400 border-l-2 border-blue-500';
    }
    return baseClass + 'text-slate-300 hover:bg-slate-800 hover:text-white';
  };

  const navigateFromSidebar = (screen: ScreenType) => {
    setCurrentScreen(screen);
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarCollapsed(true);
  };

  const screenNameMap: Record<ScreenType, string> = {
    dashboard: '首页仪表盘',
    ledger: '台账管理',
    orders: '基本信息',
    purchases: '采购信息',
    sales: '销售信息',
    system: '系统管理',
  };

  if (authLoading) {
    return <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center text-sm">正在检查登录状态...</div>;
  }

  if (!currentUser) {
    return <LoginScreen error={loginError} onLogin={handleLogin} />;
  }

  const canEnterOrders = hasPermission(currentUser, 'order_entry');
  const canEditOrders = hasPermission(currentUser, 'order_edit');
  const canDeleteOrders = hasPermission(currentUser, 'order_delete');
  const canEnterPurchases = hasPermission(currentUser, 'purchase_entry');
  const canEditPurchases = hasPermission(currentUser, 'purchase_edit');
  const canDeletePurchases = hasPermission(currentUser, 'purchase_delete');
  const canEnterSales = hasPermission(currentUser, 'sales_entry');
  const canEditSales = hasPermission(currentUser, 'sales_edit');
  const canDeleteSales = hasPermission(currentUser, 'sales_delete');
  const canManageSystem = hasPermission(currentUser, 'system_admin');
  const canImportLedger = hasPermission(currentUser, 'ledger_import');

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex font-sans text-slate-900 select-none overflow-hidden">
      <EditConflictDialog />
      <aside
        id="sidebar"
        className={`fixed left-0 top-0 h-full bg-[#0F172A] text-slate-300 border-r border-slate-800 z-[60] flex flex-col overflow-hidden transition-all duration-300 ${
          sidebarCollapsed ? 'w-0 md:w-[72px]' : 'w-56'
        }`}
      >
        <div className="h-14 flex items-center px-4 gap-2.5 border-b border-slate-800 overflow-hidden shrink-0">
          <div className="min-w-[32px] h-8 w-8 rounded bg-white flex items-center justify-center shrink-0 overflow-hidden">
            <img src={ztfsIconLogo} alt="中通服图标LOGO" className="h-full w-full object-contain" />
          </div>
          {!sidebarCollapsed && (
            <span className="font-bold text-white text-[12px] tracking-tight whitespace-nowrap">中通服供应链安徽分公司</span>
          )}
        </div>

        <nav className="flex-1 py-4 text-[13px] space-y-0.5 overflow-y-auto">
          {!sidebarCollapsed && (
            <div className="px-6 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">核心业务</div>
          )}
          {[
            ['dashboard', '首页仪表盘', <LayoutDashboard className="w-4 h-4 shrink-0 mr-1" />],
            ['ledger', '台账管理', <BookOpen className="w-4 h-4 shrink-0 mr-1" />],
            ['orders', '基本信息', <FileText className="w-4 h-4 shrink-0 mr-1" />],
            ['sales', '销售信息', <DollarSign className="w-4 h-4 shrink-0 mr-1" />],
            ['purchases', '采购信息', <ShoppingBag className="w-4 h-4 shrink-0 mr-1" />],
          ].map(([key, label, icon]) => (
            <a
              key={key as string}
              href={`#${key}`}
              onClick={(event) => {
                event.preventDefault();
                navigateFromSidebar(key as ScreenType);
              }}
              className={getSidebarLinkClass(key as ScreenType)}
            >
              {icon}
              {!sidebarCollapsed && <span className="sidebar-text whitespace-nowrap">{label}</span>}
            </a>
          ))}

          {!sidebarCollapsed && (
            <div className="mt-4 px-6 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">设置</div>
          )}
          {canManageSystem && (
            <a
              id="nav-system"
              href="#system"
              onClick={(event) => {
                event.preventDefault();
                navigateFromSidebar('system');
              }}
              className={getSidebarLinkClass('system')}
            >
              <Settings className="w-4 h-4 shrink-0 mr-1" />
              {!sidebarCollapsed && <span className="sidebar-text whitespace-nowrap">系统管理</span>}
            </a>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 flex items-center space-x-3 shrink-0 overflow-hidden">
          <div className="w-8 h-8 rounded-full bg-slate-700 shrink-0 flex items-center justify-center font-bold text-slate-300 text-xs">
            {currentUser.displayName.charAt(0) || currentUser.username.charAt(0)}
          </div>
          {!sidebarCollapsed && (
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-white leading-tight">{currentUser.displayName}</p>
              <p className="text-[10px] text-slate-500 truncate">{currentUser.roleLabel}</p>
            </div>
          )}
        </div>
      </aside>

      <div
        id="main-content"
        className={`flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-300 ${
          sidebarCollapsed ? 'ml-0 md:ml-[72px]' : 'ml-0 md:ml-56'
        }`}
      >
        <header
          id="top-nav"
          className={`fixed top-0 right-0 z-50 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between h-14 shrink-0 shadow-sm transition-all duration-300 ${
            sidebarCollapsed ? 'left-0 md:left-[72px]' : 'left-0 md:left-56'
          }`}
        >
          <div className="flex items-center space-x-4">
            <button
              id="toggle-sidebar"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav className="text-sm text-slate-400 font-medium hidden md:block">
              <ol className="flex space-x-2">
                <li>系统核心</li>
                <li className="text-slate-300">/</li>
                <li className="text-blue-600 font-semibold">{screenNameMap[currentScreen]}</li>
              </ol>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs min-w-0">
            <div
              className="inline-flex items-center gap-1.5 min-w-0 text-sm font-semibold text-slate-800"
              title={`当前登录用户：${currentUser.username}（${currentUser.displayName}）`}
            >
              <CircleUserRound className="w-[18px] h-[18px] text-blue-600 shrink-0" />
              <span className="max-w-[88px] sm:max-w-[128px] truncate">{currentUser.username}</span>
              <span className="hidden xl:inline text-xs font-medium text-slate-400">{currentUser.displayName}</span>
            </div>
            <span className="text-slate-500 font-mono hidden sm:inline">最后更新: {lastUpdated || '--:--:--'}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>退出</span>
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-3 sm:p-6 space-y-6 mt-14 overflow-y-auto overflow-x-hidden w-full max-w-[1600px] mx-auto bg-[#F3F4F6]">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium">
              {error}
            </div>
          )}
          {currentScreen === 'dashboard' && (
            <DashboardScreen logs={logs} ledgers={ledgers} orders={orders} onNavigate={setCurrentScreen} />
          )}
          {currentScreen === 'ledger' && (
            <LedgerScreen
              ledgers={ledgers}
              orders={orders}
              purchases={purchases}
              sales={sales}
              onAddLedger={handleAddLedger}
              onDownloadTemplate={api.downloadOrderTemplate}
              onExportExcel={api.exportOrdersExcel}
            />
          )}
          {currentScreen === 'orders' && (
            <OrdersScreen
              orders={orders}
              onAddOrder={handleAddOrder}
              onImportExcel={handleImportExcel}
              onUpdateOrder={handleUpdateOrder}
              onDeleteOrder={handleDeleteOrder}
              onBatchSaved={() => loadBackendData()}
              canEnterOrders={canEnterOrders}
              canEditOrders={canEditOrders}
              canDeleteOrders={canDeleteOrders}
              canImportLedger={canImportLedger}
            />
          )}
          {currentScreen === 'purchases' && <PurchasesScreen purchases={purchases} orders={orders} canEnterPurchases={canEnterPurchases} canEditPurchases={canEditPurchases} canDeletePurchases={canDeletePurchases} onRefresh={loadBackendData} />}
          {currentScreen === 'sales' && <SalesScreen sales={sales} orders={orders} canEnterSales={canEnterSales} canEditSales={canEditSales} canDeleteSales={canDeleteSales} onRefresh={loadBackendData} />}
          {currentScreen === 'system' && (
            <SystemScreen
              logs={logs}
              backups={backups}
              users={users}
              inactiveUsers={inactiveUsers}
              canManageUsers={canManageSystem}
              departments={ledgers.map((item) => item.department).filter((department) => department && department !== fallbackText)}
              currentUserId={currentUser.id}
              onCreateBackup={handleCreateBackup}
              onRestoreBackup={handleRestoreBackup}
              onRefresh={handleRefreshAll}
              onCreateUser={handleCreateUser}
              onUpdateUserPermissions={handleUpdateUserPermissions}
              onDeactivateUser={handleDeactivateUser}
              onRestoreUser={handleRestoreUser}
              onResetUserPassword={handleResetUserPassword}
              onPermanentlyDeleteUser={handlePermanentlyDeleteUser}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function numericQuantity(value: string) {
  const match = String(value || '').match(/[\d.]+/);
  return match ? match[0] : '0';
}

function orderToPayload(item: OrderRecord) {
  return {
    amount_type: item.amountType || null,
    project_code: item.projectId,
    project_name: item.projectName || null,
    department: item.department || null,
    branch_company: item.branchCompany || null,
    account_manager: item.manager || null,
    order_no: item.orderId,
    order_date: item.orderDate || null,
    business_type: item.businessType || null,
    statistical_category: item.statisticalCategory || null,
    team_name: item.teamName || null,
    customer_unit_name: item.clientUnit || null,
    user_name: item.userName || null,
    regional_platform: item.regionalPlatform || null,
    goods_name: item.goodsName || null,
    specification_model: item.specModel || null,
    unit_name: item.unitName || item.quantity.replace(/^[\d.]+\s*/, '') || null,
    quantity: numericQuantity(item.quantity),
    sales_tax_rate: item.salesTaxRate ?? null,
    net_unit_price: item.netUnitPrice ?? null,
    unit_price: item.unitPrice ?? null,
    net_revenue: item.netRevenue ?? null,
    order_value: item.orderValue,
    supplier_name: item.supplierName || null,
    purchase_tax_rate: item.purchaseTaxRate ?? null,
    purchase_unit_price_no_tax: item.purchaseUnitPriceNoTax ?? null,
    purchase_unit_price: item.purchaseUnitPrice ?? null,
    cost_no_tax: item.costNoTax ?? null,
    purchase_amount: item.purchaseAmount ?? null,
    labor_cost: item.laborCost ?? null,
    other_cost: item.otherCost ?? null,
    delivery_date: item.deliveryDate || null,
    delivery_quantity: item.deliveredQty ?? null,
    delivery_revenue_no_tax: item.deliveryRevenueNoTax ?? null,
    delivery_value: item.deliveryValue ?? null,
    delivery_cost_no_tax: item.deliveryCostNoTax ?? null,
    delivery_cost: item.deliveryCost ?? null,
    pending_delivery_quantity: item.pendingDeliveryQuantity ?? null,
    pending_delivery_amount_no_tax: item.pendingDeliveryAmountNoTax ?? null,
    pending_delivery_amount: item.pendingDeliveryAmount ?? null,
  };
}

function LoginScreen({ error, onLogin }: { error: string; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      return;
    }
    setSubmitting(true);
    try {
      await onLogin(normalizedUsername, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="h-10 w-10 rounded bg-white border border-slate-200 flex items-center justify-center overflow-hidden mb-3">
            <img src={ztfsIconLogo} alt="中通服图标LOGO" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">ERP 台账系统登录</h1>
          <p className="text-xs text-slate-500 mt-1">使用后端数据库账号登录</p>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-600">{error}</div>}
          <label className="space-y-1.5 block">
            <span className="text-xs font-semibold text-slate-600">账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-xs font-semibold text-slate-600">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {submitting ? '登录中...' : '登录'}
          </button>
        </div>
      </form>
    </div>
  );
}
