import React, { useState, useMemo } from 'react';
import { 
  FileOutput,
  Search, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  Eye,
  X,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle,
  Clock
} from 'lucide-react';
import { OrderRecord, ProjectLedger, PurchaseRecord, SalesRecord } from '../types';
import {
  getLedgerFinanceSummary,
  normalizeLedgerStatusLabel,
} from '../lib/salesDetailModel';
import { buildProjectOrderSummaries } from '../lib/projectOrderSummary';
import { getLedgerStats } from '../lib/ledgerStats';
import OrderOperatingSummarySection from './OrderOperatingSummarySection';
import {
  applyLedgerFilters,
  emptyLedgerFilters,
  ledgerFiltersToQuery,
  submitQueryFilters,
} from '../lib/queryFilterModel';

interface LedgerScreenProps {
  ledgers: ProjectLedger[];
  orders: OrderRecord[];
  purchases: PurchaseRecord[];
  sales: SalesRecord[];
  onAddLedger: (ledger: ProjectLedger) => void;
  onDownloadTemplate: () => Promise<Blob>;
  onExportExcel: (filters: Record<string, string>) => Promise<Blob>;
}

const statusOptions = [
  { value: '', label: '全部' },
  { value: 'open', label: '进行中' },
  { value: 'closed', label: '已关闭' },
];

function getPaginationItems(totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 4) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  return [1, 2, 'ellipsis', totalPages - 1, totalPages];
}

export default function LedgerScreen({
  ledgers,
  orders,
  purchases,
  sales,
  onAddLedger,
  onDownloadTemplate,
  onExportExcel,
}: LedgerScreenProps) {
  // Filter States
  const [projectId, setProjectId] = useState('');
  const [department, setDepartment] = useState('');
  const [manager, setManager] = useState('');
  const [clientUnit, setClientUnit] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [invoiceStartDate, setInvoiceStartDate] = useState('');
  const [invoiceEndDate, setInvoiceEndDate] = useState('');
  const [submittedFilters, setSubmittedFilters] = useState(emptyLedgerFilters);
  const [selectedLedger, setSelectedLedger] = useState<ProjectLedger | null>(null);
  const [expandedOrderRows, setExpandedOrderRows] = useState<Set<string>>(() => new Set());

  const openLedgerDetail = (ledger: ProjectLedger) => {
    setExpandedOrderRows(new Set());
    setSelectedLedger(ledger);
  };

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Form State for Adding New Item
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLedger, setNewLedger] = useState({
    id: '',
    clientUnit: '',
    projectName: '',
    orderAmount: '',
    purchaseAmount: '',
    totalReceived: '',
    department: '',
    manager: '',
    orderId: '',
    orderStatus: 'open',
    orderDate: new Date().toISOString().split('T')[0]
  });

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(ledgers.map((item) => item.department).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
  }, [ledgers]);

  // Reset Filters
  const handleReset = () => {
    setProjectId('');
    setDepartment('');
    setManager('');
    setClientUnit('');
    setOrderId('');
    setOrderStatus('');
    setSupplierName('');
    setStartDate('');
    setEndDate('');
    setInvoiceStartDate('');
    setInvoiceEndDate('');
    setSubmittedFilters(emptyLedgerFilters);
    setCurrentPage(1);
  };

  const handleSearch = () => {
    if (startDate && endDate && startDate > endDate) {
      alert('订单日期的开始日期不能晚于结束日期。');
      return;
    }
    if (invoiceStartDate && invoiceEndDate && invoiceStartDate > invoiceEndDate) {
      alert('开票日期的开始日期不能晚于结束日期。');
      return;
    }
    setSubmittedFilters(
      submitQueryFilters({
        projectId,
        department,
        manager,
        clientUnit,
        orderId,
        orderStatus,
        supplierName,
        startDate,
        endDate,
        invoiceStartDate,
        invoiceEndDate,
      }),
    );
    setCurrentPage(1);
  };

  // Filtered Ledgers
  const filteredLedgers = useMemo(() => {
    return applyLedgerFilters(ledgers, submittedFilters, { orders, purchases, sales });
  }, [ledgers, orders, purchases, sales, submittedFilters]);

  // Paginated Ledgers
  const paginatedLedgers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLedgers.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLedgers, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredLedgers.length / itemsPerPage));
  const paginationItems = getPaginationItems(totalPages);
  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async () => {
    try {
      downloadBlob(await onDownloadTemplate(), '市场部业务台账模板.xlsx');
    } catch (error) {
      alert(error instanceof Error ? error.message : '模板下载失败');
    }
  };

  const handleExportExcel = async () => {
    try {
      downloadBlob(
        await onExportExcel(ledgerFiltersToQuery(submittedFilters)),
        '市场部业务台账.xlsx',
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : '台账导出失败');
    }
  };
  const selectedOrders = useMemo(
    () => (selectedLedger ? orders.filter((item) => item.projectId === selectedLedger.id) : []),
    [orders, selectedLedger],
  );
  const selectedPurchases = useMemo(
    () => (selectedLedger ? purchases.filter((item) => item.projectId === selectedLedger.id) : []),
    [purchases, selectedLedger],
  );
  const selectedSales = useMemo(
    () => (selectedLedger ? sales.filter((item) => item.projectId === selectedLedger.id) : []),
    [sales, selectedLedger],
  );
  const selectedFinanceSummary = useMemo(
    () => (selectedLedger ? getLedgerFinanceSummary(selectedLedger, selectedPurchases, selectedSales) : null),
    [selectedLedger, selectedPurchases, selectedSales],
  );
  const selectedOrderSummaries = useMemo(
    () => buildProjectOrderSummaries(selectedOrders, selectedPurchases, selectedSales),
    [selectedOrders, selectedPurchases, selectedSales],
  );
  const toggleOrderRow = (sectionId: string, orderId: string) => {
    const key = `${sectionId}:${orderId}`;
    setExpandedOrderRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 汇总全部筛选结果，不受当前显示页影响。
  const stats = useMemo(() => getLedgerStats(filteredLedgers, {
    orders, sales, filters: submittedFilters,
  }), [filteredLedgers, orders, sales, submittedFilters]);

  // Add Item Handler
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLedger.id || !newLedger.clientUnit || !newLedger.projectName) {
      alert('请填写必要的信息：项目编号、客户单位名称和项目名称。');
      return;
    }

    onAddLedger({
      id: newLedger.id,
      clientUnit: newLedger.clientUnit,
      projectName: newLedger.projectName,
      orderAmount: parseFloat(newLedger.orderAmount) || 0,
      purchaseAmount: parseFloat(newLedger.purchaseAmount) || 0,
      totalReceived: parseFloat(newLedger.totalReceived) || 0,
      department: newLedger.department || '未登记部门',
      manager: newLedger.manager || '未指定',
      orderId: newLedger.orderId || `ORD-2023-${Math.floor(1000 + Math.random() * 9000)}`,
      orderStatus: newLedger.orderStatus || 'open',
      orderDate: newLedger.orderDate
    });

    // Reset Form
    setNewLedger({
      id: '',
      clientUnit: '',
      projectName: '',
      orderAmount: '',
      purchaseAmount: '',
      totalReceived: '',
      department: '',
      manager: '',
      orderId: '',
      orderStatus: 'open',
      orderDate: new Date().toISOString().split('T')[0]
    });
    setShowAddModal(false);
    setCurrentPage(1);
  };

  // Format currency
  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">项目台账总览</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">查看项目销售订单、含税采购金额、回款与应收应付汇总。</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>下载模板</span>
          </button>
          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold"
          >
            <FileOutput className="w-4 h-4 text-blue-600" />
            <span>导出台账</span>
          </button>
        </div>
      </div>

      {/* Combined Search Filters Area */}
      <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Project ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">项目编号</label>
            <input 
              type="text" 
              placeholder="输入项目编号"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Department */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">部门</label>
            <select 
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white text-xs text-slate-700"
            >
              <option value="">全部部门</option>
              {departmentOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {/* Account Manager */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">客户经理</label>
            <input 
              type="text" 
              placeholder="输入经理姓名"
              value={manager}
              onChange={e => setManager(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Client Unit */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">客户单位名称</label>
            <input 
              type="text" 
              placeholder="输入客户单位名称"
              value={clientUnit}
              onChange={e => setClientUnit(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Order ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">销售订单号</label>
            <input 
              type="text" 
              placeholder="输入销售订单号"
              value={orderId}
              onChange={e => setOrderId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Order Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">订单状态</label>
            <select 
              value={orderStatus}
              onChange={e => setOrderStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white text-xs text-slate-700"
            >
              {statusOptions.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-slate-500">采购厂商</label>
            <input
              type="text"
              placeholder="输入采购厂商名称"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Date range selection */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-slate-500">订单日期</label>
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                lang="zh-CN"
                max="2099-12-31"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
              <span className="text-slate-400 text-xs">至</span>
              <input 
                type="date" 
                lang="zh-CN"
                max="2099-12-31"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
            </div>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-slate-500">开票日期</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                lang="zh-CN"
                max="2099-12-31"
                value={invoiceStartDate}
                onChange={e => setInvoiceStartDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
              <span className="text-slate-400 text-xs">至</span>
              <input
                type="date"
                lang="zh-CN"
                max="2099-12-31"
                value={invoiceEndDate}
                onChange={e => setInvoiceEndDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button 
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-medium"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
          <button 
            onClick={handleSearch}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold"
          >
            <Search className="w-3.5 h-3.5" />
            <span>查询</span>
          </button>
        </div>
      </section>

      {/* Main Data Table */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[2260px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 w-[140px]">项目编号</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 w-[200px]">客户单位名称</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 w-[240px]">项目名称</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[180px]">A销售订单金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[180px]">A含税采购金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">B交付价值</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">B交付成本</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">D回款金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">D付款金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">E发票金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-right w-[160px]">E收票金额</th>
                <th className="px-6 py-3 font-semibold text-xs text-slate-500 text-center w-[132px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLedgers.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-slate-400 text-sm">
                    没有符合条件的台账记录
                  </td>
                </tr>
              ) : (
                paginatedLedgers.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 text-xs font-mono font-medium text-blue-600">{item.id}</td>
                      <td className="px-6 py-4 text-xs text-slate-600 truncate" title={item.clientUnit}>{item.clientUnit}</td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-900 truncate" title={item.projectName}>{item.projectName}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-950 font-medium">¥{formatMoney(item.orderAmount)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.purchaseAmount)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.deliveryValue || 0)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.deliveryCost || 0)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.totalReceived)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.totalPaid || 0)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.salesInvoiceAmount || 0)}</td>
                      <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">¥{formatMoney(item.receivedInvoiceAmount || 0)}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => openLedgerDetail(item)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-200 transition-colors"
                            title="查看项目全部信息"
                            aria-label={`查看项目 ${item.id} 的全部信息`}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Pagination Controls */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <span className="text-xs text-slate-500">
            显示 {filteredLedgers.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} 到 {Math.min(currentPage * itemsPerPage, filteredLedgers.length)} 条，共 {filteredLedgers.length} 条记录
          </span>
          <div className="flex items-center gap-1">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            {paginationItems.map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-2 text-xs font-semibold text-slate-400">
                  ...
                </span>
              ) : (
                <button
                  key={item}
                  onClick={() => setCurrentPage(item)}
                  className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                    currentPage === item 
                      ? 'bg-blue-600 text-white border border-blue-600 shadow-sm' 
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {item}
                </button>
              ),
            )}

            <button 
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="ml-3 flex items-center gap-1 text-xs text-slate-500">
              <span>跳转至</span>
              <input 
                type="number" 
                min={1} 
                max={totalPages}
                value={currentPage}
                onChange={e => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= totalPages) {
                    setCurrentPage(val);
                  }
                }}
                className="w-12 h-8 border border-slate-200 rounded text-center text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              />
              <span>页</span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Metric Summary Card Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400" title="按所选订单日期和开票日期匹配明细，销售订单金额每条明细只计一次">销售订单金额合计</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{formatMoney(stats.totalOrderVal)} 元</p>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-4">
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">已完工项目</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{stats.completedCount} 个</p>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-50 text-blue-700">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">进行中项目</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{stats.inProgressCount} 个</p>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-4">
          <div className="p-3 rounded-lg bg-rose-50 text-rose-600">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400" title="待增加项目关闭时间后启用">延期预警</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">—（占位）</p>
            <p className="text-xs text-slate-400 mt-1">待增加项目关闭时间后启用</p>
          </div>
        </div>
      </div>

      {selectedLedger && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-600 mb-1">{selectedLedger.id}</p>
                <h2 className="text-base font-bold text-slate-900 truncate">{selectedLedger.projectName}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedLedger(null);
                  setExpandedOrderRows(new Set());
                }}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="关闭项目详情"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-73px)]">
              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">项目信息</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    ['客户单位名称', selectedLedger.clientUnit],
                    ['负责部门', selectedLedger.department],
                    ['客户经理', selectedLedger.manager],
                    ['订单状态', normalizeLedgerStatusLabel(selectedLedger.orderStatus)],
                    ['订单数量', selectedLedger.orderId],
                    ['最近订单日期', selectedLedger.orderDate || '-'],
                    ['销售订单金额', `¥${formatMoney(selectedLedger.orderAmount)}`],
                    ['毛利润', `¥${formatMoney(selectedLedger.orderAmount - selectedLedger.purchaseAmount)}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-medium text-slate-400">{label}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-800 truncate" title={value}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                {selectedFinanceSummary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                    {[
                      ['应付账款', selectedFinanceSummary.accountsPayable, 'text-slate-900'],
                      ['已付账款', selectedFinanceSummary.paidAmount, 'text-slate-900'],
                      ['应收账款', selectedFinanceSummary.accountsReceivable, 'text-rose-600'],
                      ['已收账款', selectedFinanceSummary.receivedAmount, 'text-emerald-600'],
                    ].map(([label, value, color]) => (
                      <div key={label as string} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-[11px] font-medium text-slate-400">{label as string}</p>
                        <p className={`mt-1 text-xs font-bold font-mono ${color as string}`}>
                          ¥{formatMoney(value as number)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <OrderOperatingSummarySection
                title="销售信息"
                sectionId="sales"
                variant="sales"
                rows={selectedOrderSummaries}
                expandedRows={expandedOrderRows}
                onToggle={toggleOrderRow}
              />
              <OrderOperatingSummarySection
                title="采购信息"
                sectionId="purchase"
                variant="purchase"
                rows={selectedOrderSummaries}
                expandedRows={expandedOrderRows}
                onToggle={toggleOrderRow}
              />
            </div>
          </div>
        </div>
      )}

      {/* Add New Ledger Entry Form Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900">新增项目台账</h2>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-semibold"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">项目编号 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="例如: PJ-2023-099"
                    value={newLedger.id}
                    onChange={e => setNewLedger({...newLedger, id: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">客户单位名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="例如: 某某控股集团"
                    value={newLedger.clientUnit}
                    onChange={e => setNewLedger({...newLedger, clientUnit: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">项目名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="例如: 大数据安全智能分析软件研发项目"
                    value={newLedger.projectName}
                    onChange={e => setNewLedger({...newLedger, projectName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">销售订单金额 (元) *</label>
                  <input 
                    type="number" 
                    required
                    placeholder="0.00"
                    value={newLedger.orderAmount}
                    onChange={e => setNewLedger({...newLedger, orderAmount: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">含税采购金额 (元)</label>
                  <input 
                    type="number" 
                    placeholder="0.00"
                    value={newLedger.purchaseAmount}
                    onChange={e => setNewLedger({...newLedger, purchaseAmount: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">回款合计 (元)</label>
                  <input 
                    type="number" 
                    placeholder="0.00"
                    value={newLedger.totalReceived}
                    onChange={e => setNewLedger({...newLedger, totalReceived: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">负责部门</label>
                  <select 
                    value={newLedger.department}
                    onChange={e => setNewLedger({...newLedger, department: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">请选择部门</option>
                    {departmentOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">客户经理</label>
                  <input 
                    type="text" 
                    placeholder="负责人姓名"
                    value={newLedger.manager}
                    onChange={e => setNewLedger({...newLedger, manager: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">订单状态</label>
                  <select 
                    value={newLedger.orderStatus}
                    onChange={e => setNewLedger({...newLedger, orderStatus: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 bg-white"
                  >
                    {statusOptions
                      .filter((option) => option.value)
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  保存台账
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
