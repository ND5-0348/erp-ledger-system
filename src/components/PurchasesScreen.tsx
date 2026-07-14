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
  CreditCard,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { api, BackendPurchaseDetail } from '../api';
import { PurchaseRecord } from '../types';
import { applyPurchaseFilters, emptyPurchaseFilters, getDepartmentOptions, submitQueryFilters } from '../lib/queryFilterModel';

interface PurchasesScreenProps {
  purchases: PurchaseRecord[];
  canEnterPurchases: boolean;
  canEditPurchases: boolean;
  canDeletePurchases: boolean;
}

type EntryMode = 'contract' | 'invoice' | 'payment';
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

export default function PurchasesScreen({ purchases, canEnterPurchases, canEditPurchases, canDeletePurchases }: PurchasesScreenProps) {
  const [projectId, setProjectId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [manager, setManager] = useState('');
  const [department, setDepartment] = useState('');
  const [supplier, setSupplier] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [paymentStartDate, setPaymentStartDate] = useState('');
  const [paymentEndDate, setPaymentEndDate] = useState('');
  const [submittedFilters, setSubmittedFilters] = useState(emptyPurchaseFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRecord | null>(null);
  const [detail, setDetail] = useState<BackendPurchaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [editingRecord, setEditingRecord] = useState<EditingRecord>(null);
  const [saving, setSaving] = useState(false);
  const [contractForm, setContractForm] = useState({
    purchase_contract_no: '',
    payment_terms: '',
    performance_period: '',
    signed_amount: '',
    unsigned_amount: '',
  });
  const [invoiceForm, setInvoiceForm] = useState({
    received_invoice_date: '',
    invoice_no: '',
    invoice_amount: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    due_payment_date: '',
    payment_date: '',
    payment_voucher_no: '',
    payment_amount: '',
  });

  const itemsPerPage = 5;

  const filteredPurchases = useMemo(() => {
    return applyPurchaseFilters(purchases, submittedFilters);
  }, [purchases, submittedFilters]);

  const paginatedPurchases = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredPurchases.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredPurchases, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / itemsPerPage));
  const paginationItems = getPaginationItems(totalPages);
  const nextPaymentPhase = (detail?.payments.length || 0) + 1;
  const departmentOptions = useMemo(() => getDepartmentOptions(purchases), [purchases]);

  const handleReset = () => {
    setProjectId('');
    setOrderId('');
    setManager('');
    setDepartment('');
    setSupplier('');
    setContractNo('');
    setPaymentStartDate('');
    setPaymentEndDate('');
    setSubmittedFilters(emptyPurchaseFilters);
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
        paymentStartDate,
        paymentEndDate,
      }),
    );
    setCurrentPage(1);
  };

  const loadDetail = async (item: PurchaseRecord) => {
    if (!item.orderLineId) {
      setDetailError('当前记录缺少订单明细ID，无法打开详情。');
      setSelectedPurchase(item);
      return;
    }
    setSelectedPurchase(item);
    setDetail(null);
    setEntryMode(null);
    setEditingRecord(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const data = await api.purchaseDetail(item.orderLineId);
      setDetail(data);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '采购详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedPurchase(null);
    setDetail(null);
    setEntryMode(null);
    setEditingRecord(null);
    setDetailError('');
  };

  const resetEntryForms = () => {
    setContractForm({ purchase_contract_no: '', payment_terms: '', performance_period: '', signed_amount: '', unsigned_amount: '' });
    setInvoiceForm({ received_invoice_date: '', invoice_no: '', invoice_amount: '' });
    setPaymentForm({ due_payment_date: '', payment_date: '', payment_voucher_no: '', payment_amount: '' });
  };

  const openCreateEntry = (mode: EntryMode) => {
    setEditingRecord(null);
    setEntryMode(mode);
    resetEntryForms();
  };

  const openEditEntry = (mode: EntryMode, item: BackendPurchaseDetail['contracts'][number] | BackendPurchaseDetail['invoices'][number] | BackendPurchaseDetail['payments'][number]) => {
    setEditingRecord({ mode, id: item.id });
    setEntryMode(mode);
    if (mode === 'contract') {
      const contract = item as BackendPurchaseDetail['contracts'][number];
      setContractForm({
        purchase_contract_no: contract.purchase_contract_no || '',
        payment_terms: contract.payment_terms || '',
        performance_period: contract.performance_period || '',
        signed_amount: contract.signed_amount === null || contract.signed_amount === undefined ? '' : String(contract.signed_amount),
        unsigned_amount: contract.unsigned_amount === null || contract.unsigned_amount === undefined ? '' : String(contract.unsigned_amount),
      });
    } else if (mode === 'invoice') {
      const invoice = item as BackendPurchaseDetail['invoices'][number];
      setInvoiceForm({
        received_invoice_date: invoice.received_invoice_date || '',
        invoice_no: invoice.invoice_no || '',
        invoice_amount: invoice.invoice_amount === null || invoice.invoice_amount === undefined ? '' : String(invoice.invoice_amount),
      });
    } else {
      const payment = item as BackendPurchaseDetail['payments'][number];
      setPaymentForm({
        due_payment_date: payment.due_payment_date || '',
        payment_date: payment.payment_date || '',
        payment_voucher_no: payment.payment_voucher_no || '',
        payment_amount: payment.payment_amount === null || payment.payment_amount === undefined ? '' : String(payment.payment_amount),
      });
    }
  };

  const handleDeleteEntry = async (mode: EntryMode, id: number) => {
    const confirmed = window.confirm('确定删除这条采购信息吗？');
    if (!confirmed) return;
    setSaving(true);
    setDetailError('');
    try {
      const updated = mode === 'contract'
        ? await api.deletePurchaseContract(id)
        : mode === 'invoice'
          ? await api.deletePurchaseInvoice(id)
          : await api.deletePurchasePayment(id);
      setDetail(updated);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEntrySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPurchase?.orderLineId || !entryMode) return;
    setSaving(true);
    setDetailError('');
    try {
      let updated: BackendPurchaseDetail;
      if (entryMode === 'contract') {
        const data = {
          purchase_contract_no: contractForm.purchase_contract_no || null,
          payment_terms: contractForm.payment_terms || null,
          performance_period: contractForm.performance_period || null,
          signed_amount: parseAmount(contractForm.signed_amount),
          unsigned_amount: parseAmount(contractForm.unsigned_amount),
        };
        updated = editingRecord
          ? await api.updatePurchaseContract(editingRecord.id, data)
          : await api.addPurchaseContract(selectedPurchase.orderLineId, data);
      } else if (entryMode === 'invoice') {
        const data = {
          received_invoice_date: invoiceForm.received_invoice_date || null,
          invoice_no: invoiceForm.invoice_no || null,
          invoice_amount: parseAmount(invoiceForm.invoice_amount),
        };
        updated = editingRecord
          ? await api.updatePurchaseInvoice(editingRecord.id, data)
          : await api.addPurchaseInvoice(selectedPurchase.orderLineId, data);
      } else {
        const data = {
          due_payment_date: nextPaymentPhase === 1 ? paymentForm.due_payment_date || null : null,
          payment_date: paymentForm.payment_date || null,
          payment_voucher_no: paymentForm.payment_voucher_no || null,
          payment_amount: parseAmount(paymentForm.payment_amount),
        };
        updated = editingRecord
          ? await api.updatePurchasePayment(editingRecord.id, { ...data, due_payment_date: paymentForm.due_payment_date || null })
          : await api.addPurchasePayment(selectedPurchase.orderLineId, data);
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

  const summary = detail?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">采购详情</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">管理采购合同、收票记录及付款计划</p>
        </div>
      </div>

      <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <FilterInput label="项目编号" placeholder="输入项目编号" value={projectId} onChange={setProjectId} />
          <FilterInput label="订单号" placeholder="输入订单号" value={orderId} onChange={setOrderId} />
          <FilterInput label="客户经理" placeholder="输入经理姓名" value={manager} onChange={setManager} />
          <FilterInput label="采购厂家" placeholder="输入采购厂家" value={supplier} onChange={setSupplier} />
          <FilterInput label="公司合同号" placeholder="输入公司合同号" value={contractNo} onChange={setContractNo} />
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-slate-500">回款时间</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                lang="zh-CN"
                value={paymentStartDate}
                onChange={(e) => setPaymentStartDate(e.target.value)}
                className="min-w-0 w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
              <span className="shrink-0 text-xs text-slate-400">至</span>
              <input
                type="date"
                lang="zh-CN"
                value={paymentEndDate}
                onChange={(e) => setPaymentEndDate(e.target.value)}
                className="min-w-0 w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">部门</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
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
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <TableHeader className="w-[140px]">项目编号</TableHeader>
                <TableHeader className="w-[140px]">订单号</TableHeader>
                <TableHeader className="w-[120px]">客户经理</TableHeader>
                <TableHeader className="w-[160px]">公司合同号</TableHeader>
                <TableHeader className="text-right w-[140px]">合同金额</TableHeader>
                <TableHeader className="text-right w-[140px]">收票金额</TableHeader>
                <TableHeader className="text-right w-[140px]">付款金额</TableHeader>
                <TableHeader className="text-center w-[80px]">操作</TableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400 text-sm">暂无符合条件的采购记录</td>
                </tr>
              ) : (
                paginatedPurchases.map((item, index) => (
                  <tr key={`${item.orderLineId || item.contractNo}-${index}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{item.projectId}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{item.orderId}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 font-medium">{item.manager}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-800">{item.contractNo}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-medium text-slate-900">{formatMoney(item.contractAmount)}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono text-slate-600">{formatMoney(item.invoiceAmount)}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-semibold text-slate-800">{formatMoney(item.paymentAmount)}</td>
                    <td className="px-6 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => loadDetail(item)}
                        title="查看采购详情"
                        aria-label={`查看采购 ${item.orderId} 的详情`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-200 transition-colors"
                      >
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
            显示 {filteredPurchases.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} 到 {Math.min(currentPage * itemsPerPage, filteredPurchases.length)} 条，共 {filteredPurchases.length} 条记录
          </span>
          <div className="flex items-center gap-1">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {paginationItems.map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-2 text-xs font-semibold text-slate-400">...</span>
              ) : (
                <button
                  key={item}
                  onClick={() => setCurrentPage(item)}
                  className={`w-8 h-8 rounded text-xs font-bold transition-all ${currentPage === item ? 'bg-blue-600 text-white border border-blue-600 shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {item}
                </button>
              ),
            )}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} className="p-1.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="ml-3 flex items-center gap-1 text-xs text-slate-500">
              <span>跳转至</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={currentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= totalPages) setCurrentPage(val);
                }}
                className="w-12 h-8 border border-slate-200 rounded text-center text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              />
              <span>页</span>
            </div>
          </div>
        </div>
      </section>

      {selectedPurchase && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-blue-600" />
                <span>采购详情</span>
              </h2>
              <button onClick={closeDetail} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {detailError && <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{detailError}</div>}
              {detailLoading ? (
                <div className="py-16 text-center text-sm text-slate-400">正在加载采购详情...</div>
              ) : (
                <>
                  <InfoSection title="当前订单信息" items={[
                    ['项目编号', summary?.project_code ?? selectedPurchase.projectId],
                    ['项目名称', summary?.project_name],
                    ['订单号', summary?.order_no ?? selectedPurchase.orderId],
                    ['订单日期', summary?.order_date],
                    ['客户单位', summary?.customer_unit_name],
                    ['客户经理', summary?.account_manager ?? selectedPurchase.manager],
                    ['部门', summary?.department ?? selectedPurchase.department],
                    ['货物名称', summary?.goods_name],
                    ['规格型号', summary?.specification_model],
                    ['订单金额', formatMoney(Number(summary?.order_value || 0))],
                  ]} />

                  <InfoSection title="采购信息" items={[
                    ['供应商', summary?.supplier_name ?? selectedPurchase.supplier],
                    ['采购金额', formatMoney(Number(summary?.purchase_amount || selectedPurchase.invoiceAmount || 0))],
                    ['不含税成本', formatMoney(Number(summary?.cost_no_tax || 0))],
                    ['付款合计', formatMoney(Number(summary?.total_paid || selectedPurchase.paymentAmount || 0))],
                    ['应付余额', formatMoney(Number(summary?.accounts_payable || 0))],
                    ['毛利润', formatMoney(Number(summary?.gross_profit || 0))],
                  ]} />

                  <DataBlock title="采购合同" emptyText="暂无采购合同记录">
                    {detail?.contracts.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['公司合同号', item.purchase_contract_no],
                        ['付款期限', item.payment_terms],
                        ['履行期限', item.performance_period],
                        ['合同签订金额', formatMoney(item.signed_amount)],
                        ['待签合同金额', formatMoney(item.unsigned_amount)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditPurchases}
                          canDelete={canDeletePurchases}
                          onEdit={() => openEditEntry('contract', item)}
                          onDelete={() => handleDeleteEntry('contract', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  <DataBlock title="收票情况" emptyText="暂无收票记录">
                    {detail?.invoices.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['期次', `第 ${item.phase_no} 期`],
                        ['收票日期', item.received_invoice_date_text || item.received_invoice_date],
                        ['发票号码', item.invoice_no],
                        ['收票金额', formatMoney(item.invoice_amount)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditPurchases}
                          canDelete={canDeletePurchases}
                          onEdit={() => openEditEntry('invoice', item)}
                          onDelete={() => handleDeleteEntry('invoice', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  <DataBlock title="付款情况" emptyText="暂无付款记录">
                    {detail?.payments.map((item) => (
                      <RecordRow key={item.id} values={[
                        ['期次', `第 ${item.phase_no} 期`],
                        ['到期付款日', item.due_payment_date],
                        ['付款日期', item.payment_date_text || item.payment_date],
                        ['付款凭证号', item.payment_voucher_no],
                        ['付款金额', formatMoney(item.payment_amount)],
                      ]} actions={
                        <RecordActions
                          canEdit={canEditPurchases}
                          canDelete={canDeletePurchases}
                          onEdit={() => openEditEntry('payment', item)}
                          onDelete={() => handleDeleteEntry('payment', item.id)}
                        />
                      } />
                    ))}
                  </DataBlock>

                  {canEnterPurchases && <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                    <EntryButton icon={<FileText className="w-4 h-4" />} label="录入采购合同" onClick={() => openCreateEntry('contract')} />
                    <EntryButton icon={<ReceiptText className="w-4 h-4" />} label="录入收票情况" onClick={() => openCreateEntry('invoice')} />
                    <EntryButton icon={<CreditCard className="w-4 h-4" />} label="录入付款情况" onClick={() => openCreateEntry('payment')} />
                  </div>}
                </>
              )}
            </div>
          </div>

          {entryMode && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4">
              <form onSubmit={handleEntrySubmit} className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                  <h3 className="text-sm font-bold text-slate-900">{editingRecord ? '修改采购信息' : entryMode === 'contract' ? '录入采购合同' : entryMode === 'invoice' ? '录入收票情况' : `录入付款情况（第 ${nextPaymentPhase} 期）`}</h3>
                  <button type="button" onClick={() => { setEntryMode(null); setEditingRecord(null); }} className="p-1 text-slate-400 hover:text-slate-700">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {entryMode === 'contract' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormInput label="公司合同号" value={contractForm.purchase_contract_no} onChange={(value) => setContractForm({ ...contractForm, purchase_contract_no: value })} />
                      <FormInput label="付款期限" value={contractForm.payment_terms} onChange={(value) => setContractForm({ ...contractForm, payment_terms: value })} />
                      <FormInput label="履行期限" value={contractForm.performance_period} onChange={(value) => setContractForm({ ...contractForm, performance_period: value })} />
                      <FormInput label="合同签订金额" type="number" value={contractForm.signed_amount} onChange={(value) => setContractForm({ ...contractForm, signed_amount: value })} />
                      <FormInput label="待签合同金额" type="number" value={contractForm.unsigned_amount} onChange={(value) => setContractForm({ ...contractForm, unsigned_amount: value })} className="sm:col-span-2" />
                    </div>
                  )}
                  {entryMode === 'invoice' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormInput label="收票日期" type="date" value={invoiceForm.received_invoice_date} onChange={(value) => setInvoiceForm({ ...invoiceForm, received_invoice_date: value })} />
                      <FormInput label="发票号码" value={invoiceForm.invoice_no} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_no: value })} />
                      <FormInput label="收票金额" type="number" value={invoiceForm.invoice_amount} onChange={(value) => setInvoiceForm({ ...invoiceForm, invoice_amount: value })} className="sm:col-span-2" />
                    </div>
                  )}
                  {entryMode === 'payment' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(nextPaymentPhase === 1 || editingRecord) && <FormInput label="到期付款日" type="date" value={paymentForm.due_payment_date} onChange={(value) => setPaymentForm({ ...paymentForm, due_payment_date: value })} />}
                      <FormInput label="付款日期" type="date" value={paymentForm.payment_date} onChange={(value) => setPaymentForm({ ...paymentForm, payment_date: value })} />
                      <FormInput label="付款凭证号" value={paymentForm.payment_voucher_no} onChange={(value) => setPaymentForm({ ...paymentForm, payment_voucher_no: value })} />
                      <FormInput label="付款金额" type="number" value={paymentForm.payment_amount} onChange={(value) => setPaymentForm({ ...paymentForm, payment_amount: value })} />
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
        <div className="space-y-2">{childArray}</div>
      )}
    </section>
  );
}

const RecordRow: React.FC<{ values: Array<[string, unknown]>; actions?: React.ReactNode }> = ({ values, actions }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_72px] gap-3 rounded-lg border border-slate-200 px-3 py-3">
      {values.map(([label, value]) => (
        <div key={label}>
          <p className="text-[11px] text-slate-400">{label}</p>
          <p className="mt-1 text-xs font-medium text-slate-700 break-words">{textValue(value)}</p>
        </div>
      ))}
      {actions && <div className="flex items-center justify-start sm:justify-end gap-1 lg:col-start-6">{actions}</div>}
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
    <button onClick={onClick} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold">
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
