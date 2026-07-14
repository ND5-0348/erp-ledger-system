import React, { useMemo, useState } from 'react';
import {
  Search,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Briefcase,
  FileText,
  ReceiptText,
  Banknote,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { api, BackendSalesDetail } from '../api';
import { SalesRecord } from '../types';
import { buildSalesInvoiceDraft, getNextReceiptPhase } from '../lib/salesDetailModel';
import { applySalesFilters, emptySalesFilters, getDepartmentOptions, submitQueryFilters } from '../lib/queryFilterModel';

interface SalesScreenProps {
  sales: SalesRecord[];
  canEnterSales: boolean;
  canEditSales: boolean;
  canDeleteSales: boolean;
}

type EntryMode = 'contract' | 'invoice' | 'receipt';
type EditingRecord = { mode: EntryMode; id: number } | null;

const moneyFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2 });

function getPaginationItems(totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 4) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  return [1, 2, 'ellipsis', totalPages - 1, totalPages];
}

function formatMoney(value?: number | null) {
  return `¥${moneyFormatter.format(Number(value || 0))}`;
}

function textValue(value: unknown) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function parseAmount(value: string) {
  return value === '' ? null : Number(value);
}

function formatRatio(value?: number | null) {
  if (value === null || value === undefined) return '-';
  const numeric = Number(value);
  const percent = numeric > 1 ? numeric : numeric * 100;
  return `${moneyFormatter.format(percent)}%`;
}

export default function SalesScreen({ sales, canEnterSales, canEditSales, canDeleteSales }: SalesScreenProps) {
  const [projectId, setProjectId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [manager, setManager] = useState('');
  const [department, setDepartment] = useState('');
  const [supplier, setSupplier] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [receiptStartDate, setReceiptStartDate] = useState('');
  const [receiptEndDate, setReceiptEndDate] = useState('');
  const [submittedFilters, setSubmittedFilters] = useState(emptySalesFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<SalesRecord | null>(null);
  const [detail, setDetail] = useState<BackendSalesDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [editingRecord, setEditingRecord] = useState<EditingRecord>(null);
  const [saving, setSaving] = useState(false);
  const [contractForm, setContractForm] = useState({
    contract_signed_date: '',
    sales_contract_no: '',
    contract_value: '',
    performance_period: '',
    unsigned_contract_amount: '',
  });
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_doc_no: '',
    invoice_date: '',
    invoice_no: '',
    invoice_amount: '',
    pending_invoice_amount: '',
    delivered_not_invoiced_amount: '',
  });
  const [receiptForm, setReceiptForm] = useState({
    receipt_date: '',
    payment_notice_no: '',
    receipt_amount: '',
    receipt_ratio: '',
  });

  const itemsPerPage = 5;

  const filteredSales = useMemo(() => {
    return applySalesFilters(sales, submittedFilters);
  }, [sales, submittedFilters]);

  const paginatedSales = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredSales.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredSales, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / itemsPerPage));
  const paginationItems = getPaginationItems(totalPages);
  const nextReceiptPhase = getNextReceiptPhase(detail?.receipts || []);
  const summary = detail?.summary;
  const activeOrderLineId = selectedSale?.orderLineId || Number(summary?.primary_order_line_id || 0);
  const departmentOptions = useMemo(() => getDepartmentOptions(sales), [sales]);

  const handleReset = () => {
    setProjectId('');
    setOrderId('');
    setManager('');
    setDepartment('');
    setSupplier('');
    setContractNo('');
    setReceiptStartDate('');
    setReceiptEndDate('');
    setSubmittedFilters(emptySalesFilters);
    setCurrentPage(1);
  };

  const handleSearch = () => {
    setSubmittedFilters(
      submitQueryFilters({
        projectId,
        orderId,
        manager,
        department,
        supplier,
        contractNo,
        receiptStartDate,
        receiptEndDate,
      }),
    );
    setCurrentPage(1);
  };

  const loadDetail = async (item: SalesRecord) => {
    setSelectedSale(item);
    setDetail(null);
    setEntryMode(null);
    setEditingRecord(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const data = item.orderLineId
        ? await api.salesDetail(item.orderLineId)
        : await api.salesDetailByOrder(item.projectId, item.orderId);
      setDetail(data);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '销售详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedSale(null);
    setDetail(null);
    setEntryMode(null);
    setEditingRecord(null);
    setDetailError('');
  };

  const resetEntryForms = () => {
    setContractForm({ contract_signed_date: '', sales_contract_no: '', contract_value: '', performance_period: '', unsigned_contract_amount: '' });
    setInvoiceForm({ invoice_doc_no: '', invoice_date: '', invoice_no: '', invoice_amount: '', pending_invoice_amount: '', delivered_not_invoiced_amount: '' });
    setReceiptForm({ receipt_date: '', payment_notice_no: '', receipt_amount: '', receipt_ratio: '' });
  };

  const openEntry = (mode: EntryMode) => {
    setEditingRecord(null);
    setEntryMode(mode);
    if (mode === 'contract' && selectedSale) {
      setContractForm({
        contract_signed_date: selectedSale.contractDate || '',
        sales_contract_no: selectedSale.contractNo === '-' ? '' : selectedSale.contractNo,
        contract_value: selectedSale.contractValue ? String(selectedSale.contractValue) : '',
        performance_period: '',
        unsigned_contract_amount: '',
      });
    }
    if (mode === 'invoice' && selectedSale) {
      setInvoiceForm(buildSalesInvoiceDraft(selectedSale));
    }
  };

  const openEditEntry = (mode: EntryMode, item: BackendSalesDetail['contracts'][number] | BackendSalesDetail['invoices'][number] | BackendSalesDetail['receipts'][number]) => {
    setEditingRecord({ mode, id: item.id });
    setEntryMode(mode);
    if (mode === 'contract') {
      const contract = item as BackendSalesDetail['contracts'][number];
      setContractForm({
        contract_signed_date: contract.contract_signed_date || '',
        sales_contract_no: contract.sales_contract_no || '',
        contract_value: contract.contract_value === null || contract.contract_value === undefined ? '' : String(contract.contract_value),
        performance_period: contract.performance_period || '',
        unsigned_contract_amount: contract.unsigned_contract_amount === null || contract.unsigned_contract_amount === undefined ? '' : String(contract.unsigned_contract_amount),
      });
    } else if (mode === 'invoice') {
      const invoice = item as BackendSalesDetail['invoices'][number];
      setInvoiceForm({
        invoice_doc_no: invoice.invoice_doc_no || '',
        invoice_date: invoice.invoice_date || '',
        invoice_no: invoice.invoice_no || '',
        invoice_amount: invoice.invoice_amount === null || invoice.invoice_amount === undefined ? '' : String(invoice.invoice_amount),
        pending_invoice_amount: invoice.pending_invoice_amount === null || invoice.pending_invoice_amount === undefined ? '' : String(invoice.pending_invoice_amount),
        delivered_not_invoiced_amount: invoice.delivered_not_invoiced_amount === null || invoice.delivered_not_invoiced_amount === undefined ? '' : String(invoice.delivered_not_invoiced_amount),
      });
    } else {
      const receipt = item as BackendSalesDetail['receipts'][number];
      setReceiptForm({
        receipt_date: receipt.receipt_date || '',
        payment_notice_no: receipt.payment_notice_no || '',
        receipt_amount: receipt.receipt_amount === null || receipt.receipt_amount === undefined ? '' : String(receipt.receipt_amount),
        receipt_ratio: receipt.receipt_ratio === null || receipt.receipt_ratio === undefined ? '' : String(receipt.receipt_ratio),
      });
    }
  };

  const handleDeleteEntry = async (mode: EntryMode, id: number) => {
    const confirmed = window.confirm('确定删除这条销售信息吗？');
    if (!confirmed) return;
    setSaving(true);
    setDetailError('');
    try {
      const updated = mode === 'contract'
        ? await api.deleteSalesContract(id)
        : mode === 'invoice'
          ? await api.deleteSalesInvoice(id)
          : await api.deleteSalesReceipt(id);
      setDetail(updated);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEntrySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeOrderLineId || !entryMode) return;
    setSaving(true);
    setDetailError('');
    try {
      let updated: BackendSalesDetail;
      if (entryMode === 'contract') {
        const data = {
          contract_signed_date: contractForm.contract_signed_date || null,
          sales_contract_no: contractForm.sales_contract_no || null,
          contract_value: parseAmount(contractForm.contract_value),
          performance_period: contractForm.performance_period || null,
          unsigned_contract_amount: parseAmount(contractForm.unsigned_contract_amount),
        };
        updated = editingRecord
          ? await api.updateSalesContract(editingRecord.id, data)
          : await api.addSalesContract(activeOrderLineId, data);
      } else if (entryMode === 'invoice') {
        const data = {
          invoice_doc_no: invoiceForm.invoice_doc_no || null,
          invoice_date: invoiceForm.invoice_date || null,
          invoice_no: invoiceForm.invoice_no || null,
          invoice_amount: parseAmount(invoiceForm.invoice_amount),
          pending_invoice_amount: parseAmount(invoiceForm.pending_invoice_amount),
          delivered_not_invoiced_amount: parseAmount(invoiceForm.delivered_not_invoiced_amount),
        };
        updated = editingRecord
          ? await api.updateSalesInvoice(editingRecord.id, data)
          : await api.addSalesInvoice(activeOrderLineId, data);
      } else {
        const data = {
          receipt_date: receiptForm.receipt_date || null,
          payment_notice_no: receiptForm.payment_notice_no || null,
          receipt_amount: parseAmount(receiptForm.receipt_amount),
          receipt_ratio: parseAmount(receiptForm.receipt_ratio),
        };
        updated = editingRecord
          ? await api.updateSalesReceipt(editingRecord.id, data)
          : await api.addSalesReceipt(activeOrderLineId, data);
      }
      setDetail(updated);
      setEntryMode(null);
      setEditingRecord(null);
      resetEntryForms();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">销售详情</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">核算与监控销售收入、合同账期与开票情况</p>
        </div>
      </div>

      <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <FilterInput label="项目编号" placeholder="输入项目编号" value={projectId} onChange={setProjectId} />
          <FilterInput label="订单号" placeholder="输入订单号" value={orderId} onChange={setOrderId} />
          <FilterInput label="客户经理" placeholder="请输入客户经理姓名" value={manager} onChange={setManager} />
          <FilterInput label="采购厂家" placeholder="输入采购厂家" value={supplier} onChange={setSupplier} />
          <FilterInput label="公司合同号" placeholder="输入公司合同号" value={contractNo} onChange={setContractNo} />
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-slate-500">回款时间</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                lang="zh-CN"
                value={receiptStartDate}
                onChange={(e) => setReceiptStartDate(e.target.value)}
                className="min-w-0 w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
              <span className="shrink-0 text-xs text-slate-400">至</span>
              <input
                type="date"
                lang="zh-CN"
                value={receiptEndDate}
                onChange={(e) => setReceiptEndDate(e.target.value)}
                className="min-w-0 w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">部门</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white text-xs text-slate-700">
              <option value="">全部部门</option>
              {departmentOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={handleReset} className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-medium">
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
          <button onClick={handleSearch} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold">
            <Search className="w-3.5 h-3.5" />
            <span>查询</span>
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
            <ReceiptText className="w-4 h-4 text-blue-600" />
            <span>销售列表</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <TableHeader className="w-[140px]">项目编号</TableHeader>
                <TableHeader className="w-[160px]">订单号</TableHeader>
                <TableHeader className="w-[120px]">客户经理</TableHeader>
                <TableHeader className="w-[140px]">公司合同号</TableHeader>
                <TableHeader className="w-[120px]">合同签订日期</TableHeader>
                <TableHeader className="text-right w-[140px]">合同价值</TableHeader>
                <TableHeader className="text-right w-[140px]">开票金额</TableHeader>
                <TableHeader className="text-center w-[80px]">操作</TableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedSales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400 text-sm">暂无符合条件的销售记录</td>
                </tr>
              ) : (
                paginatedSales.map((item, index) => (
                  <tr key={`${item.orderLineId || item.contractNo}-${index}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{item.projectId}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500 truncate" title={item.orderId}>{item.orderId}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 font-medium">{item.manager}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-800">{item.contractNo}</td>
                    <td className="px-6 py-4 text-xs text-slate-600 font-mono">{item.contractDate || '-'}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-medium text-slate-900">{formatMoney(item.contractValue)}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono text-emerald-600 font-medium">{formatMoney(item.invoiceAmount)}</td>
                    <td className="px-6 py-4 text-center">
                      <button type="button" onClick={() => loadDetail(item)} title="查看销售详情" aria-label={`查看销售 ${item.orderId} 的详情`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-200 transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between overflow-x-auto">
          <span className="text-xs text-slate-500">
            显示 {filteredSales.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} 到 {Math.min(currentPage * itemsPerPage, filteredSales.length)} 条，共 {filteredSales.length} 条记录
          </span>
          <div className="flex items-center gap-1">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {paginationItems.map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-2 text-xs font-semibold text-slate-400">...</span>
              ) : (
                <button key={item} onClick={() => setCurrentPage(item)} className={`w-8 h-8 rounded text-xs font-bold transition-all ${currentPage === item ? 'bg-blue-600 text-white border border-blue-600 shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {item}
                </button>
              ),
            )}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="ml-3 flex items-center gap-1 text-xs text-slate-500">
              <span>跳转至</span>
              <input type="number" min={1} max={totalPages} value={currentPage} onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val >= 1 && val <= totalPages) setCurrentPage(val);
              }} className="w-12 h-8 border border-slate-200 rounded text-center text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" />
              <span>页</span>
            </div>
          </div>
        </div>
      </section>

      {selectedSale && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-blue-600" />
                <span>销售详情</span>
              </h2>
              <button onClick={closeDetail} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {detailError && <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{detailError}</div>}
              {detailLoading ? (
                <div className="py-16 text-center text-sm text-slate-400">正在加载销售详情...</div>
              ) : (
                <>
                  <InfoSection title="当前订单信息" items={[
                    ['项目编号', summary?.project_code ?? selectedSale.projectId],
                    ['项目名称', summary?.project_name],
                    ['订单号', summary?.order_no ?? selectedSale.orderId],
                    ['订单日期', summary?.order_date],
                    ['客户单位', summary?.customer_unit_name],
                    ['客户经理', summary?.account_manager ?? selectedSale.manager],
                    ['部门', summary?.department ?? selectedSale.department],
                    ['货物名称', summary?.goods_name],
                    ['规格型号', summary?.specification_model],
                    ['订单金额', formatMoney(Number(summary?.order_value || 0))],
                    ['明细行数', summary?.matched_line_count],
                  ]} />

                  <InfoSection title="采购信息" items={[
                    ['供应商', summary?.supplier_name],
                    ['采购合同号', summary?.purchase_contract_no],
                    ['采购合同金额', formatMoney(Number(summary?.purchase_contract_signed_amount || 0))],
                    ['采购金额', formatMoney(Number(summary?.purchase_amount || 0))],
                    ['交付数量', summary?.delivery_quantity],
                    ['交付价值', formatMoney(Number(summary?.delivery_value || 0))],
                    ['毛利润', formatMoney(Number(summary?.gross_profit || 0))],
                  ]} />

                  <DataBlock title="销售合同" emptyText="暂无销售合同记录">
                    {detail?.contracts.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['合同签订日期', item.contract_signed_date_text || item.contract_signed_date],
                        ['公司合同号', item.sales_contract_no],
                        ['合同价值', formatMoney(item.contract_value)],
                        ['履行期限', item.performance_period],
                        ['待签合同金额', formatMoney(item.unsigned_contract_amount)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditSales}
                          canDelete={canDeleteSales}
                          onEdit={() => openEditEntry('contract', item)}
                          onDelete={() => handleDeleteEntry('contract', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  <DataBlock title="开票情况" emptyText="暂无开票记录">
                    {detail?.invoices.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['期次', `第 ${item.phase_no} 期`],
                        ['开票单据号', item.invoice_doc_no],
                        ['开票日期', item.invoice_date_text || item.invoice_date],
                        ['发票号', item.invoice_no],
                        ['发票金额', formatMoney(item.invoice_amount)],
                        ['待开发票金额', formatMoney(item.pending_invoice_amount)],
                        ['已交付未开票', formatMoney(item.delivered_not_invoiced_amount)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditSales}
                          canDelete={canDeleteSales}
                          onEdit={() => openEditEntry('invoice', item)}
                          onDelete={() => handleDeleteEntry('invoice', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  <DataBlock title="回款情况" emptyText="暂无回款记录">
                    {detail?.receipts.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['期次', `第 ${item.phase_no} 期`],
                        ['回款日期', item.receipt_date_text || item.receipt_date],
                        ['缴款单号', item.payment_notice_no],
                        ['回款金额', formatMoney(item.receipt_amount)],
                        ['回款占比', formatRatio(item.receipt_ratio)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditSales}
                          canDelete={canDeleteSales}
                          onEdit={() => openEditEntry('receipt', item)}
                          onDelete={() => handleDeleteEntry('receipt', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  {canEnterSales && <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                    <EntryButton icon={<FileText className="w-4 h-4" />} label="录入销售合同" onClick={() => openEntry('contract')} />
                    <EntryButton icon={<ReceiptText className="w-4 h-4" />} label="录入开票情况" onClick={() => openEntry('invoice')} />
                    <EntryButton icon={<Banknote className="w-4 h-4" />} label="录入回款情况" onClick={() => openEntry('receipt')} />
                  </div>}
                </>
              )}
            </div>
          </div>

          {entryMode && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4">
              <form onSubmit={handleEntrySubmit} className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                  <h3 className="text-sm font-bold text-slate-900">{editingRecord ? '修改销售信息' : entryMode === 'contract' ? '录入销售合同' : entryMode === 'invoice' ? '录入开票情况' : `录入回款情况（第 ${nextReceiptPhase} 期）`}</h3>
                  <button type="button" onClick={() => { setEntryMode(null); setEditingRecord(null); }} className="p-1 text-slate-400 hover:text-slate-700">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {entryMode === 'contract' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormInput label="合同签订日期" type="date" value={contractForm.contract_signed_date} onChange={(value) => setContractForm({ ...contractForm, contract_signed_date: value })} />
                      <FormInput label="公司合同号" value={contractForm.sales_contract_no} onChange={(value) => setContractForm({ ...contractForm, sales_contract_no: value })} />
                      <FormInput label="合同价值" type="number" value={contractForm.contract_value} onChange={(value) => setContractForm({ ...contractForm, contract_value: value })} />
                      <FormInput label="履行期限" value={contractForm.performance_period} onChange={(value) => setContractForm({ ...contractForm, performance_period: value })} />
                      <FormInput label="待签合同金额" type="number" value={contractForm.unsigned_contract_amount} onChange={(value) => setContractForm({ ...contractForm, unsigned_contract_amount: value })} className="sm:col-span-2" />
                    </div>
                  )}
                  {entryMode === 'invoice' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormInput label="开票单据号" value={invoiceForm.invoice_doc_no} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_doc_no: value })} />
                      <FormInput label="开票日期" type="date" value={invoiceForm.invoice_date} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_date: value })} />
                      <FormInput label="发票号" value={invoiceForm.invoice_no} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_no: value })} />
                      <FormInput label="发票金额" type="number" value={invoiceForm.invoice_amount} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_amount: value })} />
                      <FormInput label="待开发票金额" type="number" value={invoiceForm.pending_invoice_amount} onChange={(value) => setInvoiceForm({ ...invoiceForm, pending_invoice_amount: value })} />
                      <FormInput label="已交付未开票" type="number" value={invoiceForm.delivered_not_invoiced_amount} onChange={(value) => setInvoiceForm({ ...invoiceForm, delivered_not_invoiced_amount: value })} />
                    </div>
                  )}
                  {entryMode === 'receipt' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormInput label="回款日期" type="date" value={receiptForm.receipt_date} onChange={(value) => setReceiptForm({ ...receiptForm, receipt_date: value })} />
                      <FormInput label="缴款单号" value={receiptForm.payment_notice_no} onChange={(value) => setReceiptForm({ ...receiptForm, payment_notice_no: value })} />
                      <FormInput label="回款金额" type="number" value={receiptForm.receipt_amount} onChange={(value) => setReceiptForm({ ...receiptForm, receipt_amount: value })} />
                      <FormInput label="回款占比" type="number" value={receiptForm.receipt_ratio} onChange={(value) => setReceiptForm({ ...receiptForm, receipt_ratio: value })} />
                    </div>
                  )}
                </div>
                <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                  <button type="button" onClick={() => { setEntryMode(null); setEditingRecord(null); }} className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium">取消</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700" />
    </div>
  );
}

function TableHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-6 py-3.5 font-semibold text-xs text-slate-500 ${className}`}>{children}</th>;
}

function InfoSection({ title, items }: { title: string; items: Array<[string, unknown]> }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-slate-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-400">{label}</p>
            <p className="mt-1 text-xs font-semibold text-slate-800 break-words">{textValue(value)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataBlock({ title, emptyText, children }: { title: string; emptyText: string; children: React.ReactNode }) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  return (
    <section>
      <h3 className="text-sm font-bold text-slate-900 mb-3">{title}</h3>
      {childArray.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-400">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="space-y-2 min-w-max">{childArray}</div>
        </div>
      )}
    </section>
  );
}

const RecordRow: React.FC<{ values: Array<[string, unknown]>; actions?: React.ReactNode }> = ({ values, actions }) => {
  return (
    <div
      className="grid gap-3 rounded-lg border border-slate-200 px-3 py-3"
      style={{
        gridTemplateColumns: `repeat(${values.length}, minmax(180px, 1fr)) ${actions ? '72px' : ''}`,
        minWidth: `${values.length * 180 + (actions ? 72 : 0) + values.length * 12}px`,
      }}
    >
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="text-[11px] text-slate-400">{label}</p>
          <p className="mt-1 text-xs font-medium text-slate-700 whitespace-nowrap">{textValue(value)}</p>
        </div>
      ))}
      {actions && <div className="flex items-center justify-end gap-1">{actions}</div>}
    </div>
  );
};

function RecordActions({ canEdit, canDelete, onEdit, onDelete }: { canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void }) {
  if (!canEdit && !canDelete) return null;
  return (
    <>
      {canEdit && (
        <button type="button" onClick={onEdit} title="修改" className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {canDelete && (
        <button type="button" onClick={onDelete} title="删除" className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

function EntryButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FormInput({ label, value, onChange, type = 'text', className = '' }: { label: string; value: string; onChange: (value: string) => void; type?: string; className?: string }) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="block text-xs font-semibold text-slate-600">{label}</span>
      <input type={type} lang={type === 'date' ? 'zh-CN' : undefined} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
    </label>
  );
}
