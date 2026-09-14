import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  ShoppingBag,
  FileUp,
  FileSpreadsheet,
  ListChecks,
  Eye,
  Pencil,
  Trash2,
  X
} from 'lucide-react';
import { OrderRecord } from '../types';
import BatchOrderEditor from './BatchOrderEditor';
import {
  ORDER_DETAIL_TABLE_WIDTHS,
} from '../lib/orderDetailTables';
import { calculateTaxAmounts, editableNumber } from '../lib/orderAmounts';
import { applyOrderFilters, emptyOrderFilters, submitQueryFilters } from '../lib/queryFilterModel';

interface OrderPurchaseEntry {
  id: string;
  supplier: string;
  purchaseTaxRate?: number;
  netPurchaseUnitPrice?: number;
  purchaseUnitPrice?: number;
  netCost?: number;
  purchaseAmount?: number;
  purchaseTaxAmount?: number;
  laborCost?: number;
  otherCost?: number;
}

interface OrderDeliveryEntry {
  id: string;
  deliveryDate: string;
  deliveredQty?: number;
  deliveredNetRevenue?: number;
  deliveryValue?: number;
  deliveredNetCost?: number;
  deliveryCost?: number;
  pendingQty?: number;
  pendingNetAmount?: number;
  pendingAmount?: number;
}

interface OrdersScreenProps {
  orders: OrderRecord[];
  onAddOrder: (order: OrderRecord) => Promise<void>;
  onImportExcel: (file: File) => Promise<{ success_rows: number; skipped_rows: number }>;
  onUpdateOrder: (target: OrderRecord, order: OrderRecord) => Promise<void>;
  onDeleteOrder: (target: OrderRecord) => Promise<void>;
  onBatchSaved: () => Promise<void>;
  canEnterOrders: boolean;
  canEditOrders: boolean;
  canDeleteOrders: boolean;
}

function getPaginationItems(totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 4) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  return [1, 2, 'ellipsis', totalPages - 1, totalPages];
}

function optionalFormNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const deleteVerificationAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function createDeleteVerificationCode() {
  const randomValues = new Uint32Array(4);
  window.crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (value) => deleteVerificationAlphabet[value % deleteVerificationAlphabet.length]).join('');
}

export default function OrdersScreen({ orders, onAddOrder, onImportExcel, onUpdateOrder, onDeleteOrder, onBatchSaved, canEnterOrders, canEditOrders, canDeleteOrders }: OrdersScreenProps) {
  // Query Filters State
  const [projectId, setProjectId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [clientUnit, setClientUnit] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submittedFilters, setSubmittedFilters] = useState(emptyOrderFilters);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [activeEntryModal, setActiveEntryModal] = useState<'purchase' | 'delivery' | null>(null);
  const [orderPurchases, setOrderPurchases] = useState<Record<string, OrderPurchaseEntry[]>>({});
  const [orderDeliveries, setOrderDeliveries] = useState<Record<string, OrderDeliveryEntry[]>>({});
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [batchEditorMode, setBatchEditorMode] = useState<'create' | 'update' | null>(null);
  const [selectedBatchOrderIds, setSelectedBatchOrderIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<OrderRecord | null>(null);
  const [deleteVerificationCode, setDeleteVerificationCode] = useState('');
  const [deleteVerificationInput, setDeleteVerificationInput] = useState('');
  const [deleteVerificationError, setDeleteVerificationError] = useState('');
  const [deletingOrder, setDeletingOrder] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // New Order Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [newOrder, setNewOrder] = useState({
    amountType: '全额',
    projectId: '',
    department: '',
    branchCompany: '',
    manager: '',
    orderId: '',
    orderDate: new Date().toISOString().split('T')[0],
    statisticalCategory: '',
    teamName: '',
    projectName: '',
    userName: '',
    regionalPlatform: '',
    goodsName: '',
    specModel: '',
    quantityVal: '',
    quantityUnit: '套',
    salesTaxRate: '',
    netUnitPrice: '',
    unitPrice: '',
    netRevenue: '',
    orderValue: '',
    salesTaxAmount: '',
    deliveredQty: '0',
    businessType: '咨询服务',
    clientUnit: ''
  });
  const [newPurchase, setNewPurchase] = useState({
    supplier: '',
    purchaseTaxRate: '',
    netPurchaseUnitPrice: '',
    purchaseUnitPrice: '',
    netCost: '',
    purchaseAmount: '',
    purchaseTaxAmount: '',
    laborCost: '',
    otherCost: '',
  });
  const [newDelivery, setNewDelivery] = useState({
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveredQty: '',
    deliveredNetRevenue: '',
    deliveryValue: '',
    deliveredNetCost: '',
    deliveryCost: '',
    pendingQty: '',
    pendingNetAmount: '',
    pendingAmount: '',
  });

  // Reset Filters
  const handleReset = () => {
    setProjectId('');
    setOrderId('');
    setOrderDate('');
    setBusinessType('');
    setClientUnit('');
    setSupplierName('');
    setStartDate('');
    setEndDate('');
    setSubmittedFilters(emptyOrderFilters);
    setCurrentPage(1);
  };

  const handleSearch = () => {
    setSubmittedFilters(
      submitQueryFilters({
        projectId,
        orderId,
        orderDate,
        businessType,
        clientUnit,
        supplierName,
        startDate,
        endDate,
      }),
    );
    setCurrentPage(1);
  };

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return applyOrderFilters(orders, submittedFilters);
  }, [orders, submittedFilters]);
  const filteredOrderLineIds = useMemo(
    () => filteredOrders
      .map((order) => order.orderLineId)
      .filter((orderLineId): orderLineId is number => typeof orderLineId === 'number'),
    [filteredOrders],
  );

  // Paginated Orders
  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredOrders.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredOrders, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage));
  const paginationItems = getPaginationItems(totalPages);
  const selectedOrderKey = selectedOrder ? `${selectedOrder.projectId}-${selectedOrder.orderId}` : '';
  const backendPurchase = selectedOrder && (
    selectedOrder.supplierName ||
    selectedOrder.purchaseTaxRate ||
    selectedOrder.purchaseUnitPriceNoTax ||
    selectedOrder.purchaseUnitPrice ||
    selectedOrder.costNoTax ||
    selectedOrder.purchaseAmount ||
    selectedOrder.laborCost ||
    selectedOrder.otherCost
  )
    ? [{
        id: 'backend-purchase',
        supplier: selectedOrder.supplierName || '',
        purchaseTaxRate: selectedOrder.purchaseTaxRate,
        netPurchaseUnitPrice: selectedOrder.purchaseUnitPriceNoTax,
        purchaseUnitPrice: selectedOrder.purchaseUnitPrice,
        netCost: selectedOrder.costNoTax,
        purchaseAmount: selectedOrder.purchaseAmount,
        purchaseTaxAmount: selectedOrder.purchaseTaxAmount,
        laborCost: selectedOrder.laborCost,
        otherCost: selectedOrder.otherCost,
      }]
    : [];
  const backendDelivery = selectedOrder && (
    selectedOrder.deliveryDate ||
    selectedOrder.deliveredQty ||
    selectedOrder.deliveryRevenueNoTax ||
    selectedOrder.deliveryValue ||
    selectedOrder.deliveryCostNoTax ||
    selectedOrder.deliveryCost ||
    selectedOrder.pendingDeliveryQuantity ||
    selectedOrder.pendingDeliveryAmountNoTax ||
    selectedOrder.pendingDeliveryAmount
  )
    ? [{
        id: 'backend-delivery',
        deliveryDate: selectedOrder.deliveryDate || '',
        deliveredQty: selectedOrder.deliveredQty,
        deliveredNetRevenue: selectedOrder.deliveryRevenueNoTax,
        deliveryValue: selectedOrder.deliveryValue,
        deliveredNetCost: selectedOrder.deliveryCostNoTax,
        deliveryCost: selectedOrder.deliveryCost,
        pendingQty: selectedOrder.pendingDeliveryQuantity,
        pendingNetAmount: selectedOrder.pendingDeliveryAmountNoTax,
        pendingAmount: selectedOrder.pendingDeliveryAmount,
      }]
    : [];
  const selectedPurchases = selectedOrderKey ? [...backendPurchase, ...(orderPurchases[selectedOrderKey] || [])] : [];
  const selectedDeliveries = selectedOrderKey ? [...backendDelivery, ...(orderDeliveries[selectedOrderKey] || [])] : [];

  const formatMoney = (value: number) =>
    new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const formatOptionalMoney = (value: number | undefined) =>
    value === undefined ? '' : `¥${formatMoney(value)}`;
  const blank = (value: string | number | undefined | null) => value === undefined || value === null ? '' : String(value);
  const canManageOrderRows = canEditOrders || canDeleteOrders;
  const allFilteredSelected = filteredOrderLineIds.length > 0
    && filteredOrderLineIds.every((orderLineId) => selectedBatchOrderIds.has(orderLineId));

  React.useEffect(() => {
    const available = new Set(filteredOrderLineIds);
    setSelectedBatchOrderIds((current) => {
      const next = new Set([...current].filter((orderLineId) => available.has(orderLineId)));
      const unchanged = next.size === current.size && [...next].every((orderLineId) => current.has(orderLineId));
      return unchanged ? current : next;
    });
  }, [filteredOrderLineIds]);

  const toggleOrderSelection = (orderLineId: number) => {
    setSelectedBatchOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderLineId)) next.delete(orderLineId);
      else next.add(orderLineId);
      return next;
    });
  };

  const toggleAllFilteredOrders = () => {
    setSelectedBatchOrderIds(allFilteredSelected ? new Set() : new Set(filteredOrderLineIds));
  };

  const openBatchUpdateEditor = () => {
    if (selectedBatchOrderIds.size > 0) {
      setBatchEditorMode('update');
      return;
    }

    if (filteredOrderLineIds.length === 0) {
      alert('当前查询结果中没有可修改的订单明细。');
      return;
    }

    setSelectedBatchOrderIds(new Set(filteredOrderLineIds));
    setBatchEditorMode('update');
  };

  const handleBatchSaved = async (count: number) => {
    await onBatchSaved();
    setBatchEditorMode(null);
    setSelectedBatchOrderIds(new Set());
    setCurrentPage(1);
    alert(`${batchEditorMode === 'update' ? '批量修改' : '批量新增'}完成：共保存 ${count} 条基本信息明细。`);
  };

  const resetNewPurchase = () => {
    setNewPurchase({
      supplier: '',
      purchaseTaxRate: '',
      netPurchaseUnitPrice: '',
      purchaseUnitPrice: '',
      netCost: '',
      purchaseAmount: '',
      purchaseTaxAmount: '',
      laborCost: '',
      otherCost: '',
    });
  };

  const resetNewDelivery = () => {
    setNewDelivery({
      deliveryDate: new Date().toISOString().split('T')[0],
      deliveredQty: '',
      deliveredNetRevenue: '',
      deliveryValue: '',
      deliveredNetCost: '',
      deliveryCost: '',
      pendingQty: '',
      pendingNetAmount: '',
      pendingAmount: '',
    });
  };

  const purchaseEntryToForm = (item: OrderPurchaseEntry) => ({
    supplier: item.supplier || '',
    purchaseTaxRate: blank(item.purchaseTaxRate),
    netPurchaseUnitPrice: blank(item.netPurchaseUnitPrice),
    purchaseUnitPrice: blank(item.purchaseUnitPrice),
    netCost: blank(item.netCost),
    purchaseAmount: blank(item.purchaseAmount),
    purchaseTaxAmount: blank(item.purchaseTaxAmount),
    laborCost: blank(item.laborCost),
    otherCost: blank(item.otherCost),
  });

  const deliveryEntryToForm = (item: OrderDeliveryEntry) => ({
    deliveryDate: item.deliveryDate || new Date().toISOString().split('T')[0],
    deliveredQty: blank(item.deliveredQty),
    deliveredNetRevenue: blank(item.deliveredNetRevenue),
    deliveryValue: blank(item.deliveryValue),
    deliveredNetCost: blank(item.deliveredNetCost),
    deliveryCost: blank(item.deliveryCost),
    pendingQty: blank(item.pendingQty),
    pendingNetAmount: blank(item.pendingNetAmount),
    pendingAmount: blank(item.pendingAmount),
  });

  const closeEntryModal = () => {
    setActiveEntryModal(null);
    setEditingPurchaseId(null);
    setEditingDeliveryId(null);
    resetNewPurchase();
    resetNewDelivery();
  };

  const resetNewOrder = () => {
    setNewOrder({
      amountType: '全额',
      projectId: '',
      department: '',
      branchCompany: '',
      manager: '',
      orderId: '',
      orderDate: new Date().toISOString().split('T')[0],
      statisticalCategory: '',
      teamName: '',
      projectName: '',
      userName: '',
      regionalPlatform: '',
      goodsName: '',
      specModel: '',
      quantityVal: '',
      quantityUnit: '套',
      salesTaxRate: '',
      netUnitPrice: '',
      unitPrice: '',
      netRevenue: '',
      orderValue: '',
      salesTaxAmount: '',
      deliveredQty: '0',
      businessType: '咨询服务',
      clientUnit: '',
    });
  };

  const orderToForm = (order: OrderRecord) => {
    const quantityMatch = String(order.quantity || '').match(/[\d.]+/);
    const unit = order.unitName || String(order.quantity || '').replace(/^[\d.]+\s*/, '') || '套';
    return {
      amountType: order.amountType || '全额',
      projectId: order.projectId,
      department: order.department || '',
      branchCompany: order.branchCompany || '',
      manager: order.manager || '',
      orderId: order.orderId,
      orderDate: order.orderDate,
      statisticalCategory: order.statisticalCategory || '',
      teamName: order.teamName || '',
      projectName: order.projectName || '',
      userName: order.userName || '',
      regionalPlatform: order.regionalPlatform || '',
      goodsName: order.goodsName,
      specModel: order.specModel || '',
      quantityVal: quantityMatch ? quantityMatch[0] : '',
      quantityUnit: unit,
      salesTaxRate: order.salesTaxRate === undefined ? '' : String(order.salesTaxRate),
      netUnitPrice: order.netUnitPrice === undefined ? '' : String(order.netUnitPrice),
      unitPrice: order.unitPrice === undefined ? '' : String(order.unitPrice),
      netRevenue: order.netRevenue === undefined ? '' : String(order.netRevenue),
      orderValue: String(order.orderValue || ''),
      salesTaxAmount: order.salesTaxAmount === undefined ? '' : String(order.salesTaxAmount),
      deliveredQty: String(order.deliveredQty || 0),
      businessType: order.businessType,
      clientUnit: order.clientUnit,
    };
  };

  const formToOrder = (form: typeof newOrder, existing?: OrderRecord): OrderRecord => ({
    orderLineId: existing?.orderLineId,
    amountType: form.amountType,
    projectId: form.projectId,
    department: form.department,
    branchCompany: form.branchCompany,
    manager: form.manager,
    orderId: form.orderId,
    orderDate: form.orderDate,
    statisticalCategory: form.statisticalCategory,
    teamName: form.teamName,
    projectName: form.projectName,
    userName: form.userName,
    regionalPlatform: form.regionalPlatform,
    goodsName: form.goodsName,
    specModel: form.specModel,
    unitName: form.quantityUnit,
    quantity: `${form.quantityVal} ${form.quantityUnit}`,
    salesTaxRate: optionalFormNumber(form.salesTaxRate),
    netUnitPrice: optionalFormNumber(form.netUnitPrice),
    unitPrice: optionalFormNumber(form.unitPrice),
    netRevenue: optionalFormNumber(form.netRevenue),
    orderValue: parseFloat(form.orderValue) || 0,
    salesTaxAmount: optionalFormNumber(form.salesTaxAmount),
    deliveredQty: parseFloat(form.deliveredQty) || 0,
    businessType: form.businessType,
    clientUnit: form.clientUnit,
    supplierName: existing?.supplierName,
    purchaseTaxRate: existing?.purchaseTaxRate,
    purchaseUnitPriceNoTax: existing?.purchaseUnitPriceNoTax,
    purchaseUnitPrice: existing?.purchaseUnitPrice,
    costNoTax: existing?.costNoTax,
    purchaseAmount: existing?.purchaseAmount,
    purchaseTaxAmount: existing?.purchaseTaxAmount,
    laborCost: existing?.laborCost,
    otherCost: existing?.otherCost,
    deliveryDate: existing?.deliveryDate,
    deliveryRevenueNoTax: existing?.deliveryRevenueNoTax,
    deliveryValue: existing?.deliveryValue,
    deliveryCostNoTax: existing?.deliveryCostNoTax,
    deliveryCost: existing?.deliveryCost,
    pendingDeliveryQuantity: existing?.pendingDeliveryQuantity,
    pendingDeliveryAmountNoTax: existing?.pendingDeliveryAmountNoTax,
    pendingDeliveryAmount: existing?.pendingDeliveryAmount,
  });

  const updateSalesCalculation = (updates: Partial<typeof newOrder>) => {
    const next = { ...newOrder, ...updates };
    const calculated = calculateTaxAmounts({
      quantity: next.quantityVal,
      taxRate: next.salesTaxRate,
      unitPriceNoTax: next.netUnitPrice,
      unitPrice: next.unitPrice,
    });
    setNewOrder({
      ...next,
      unitPrice: editableNumber(calculated.unitPrice),
      netRevenue: editableNumber(calculated.amountNoTax, 2),
      orderValue: editableNumber(calculated.amount, 2),
      salesTaxAmount: editableNumber(calculated.taxAmount, 2),
    });
  };

  const updatePurchaseCalculation = (updates: Partial<typeof newPurchase>) => {
    const next = { ...newPurchase, ...updates };
    const quantity = Number(String(selectedOrder?.quantity || '').match(/[\d.]+/)?.[0] || 0);
    const calculated = calculateTaxAmounts({
      quantity,
      taxRate: next.purchaseTaxRate,
      unitPriceNoTax: next.netPurchaseUnitPrice,
      unitPrice: next.purchaseUnitPrice,
    });
    setNewPurchase({
      ...next,
      purchaseUnitPrice: editableNumber(calculated.unitPrice),
      netCost: editableNumber(calculated.amountNoTax, 2),
      purchaseAmount: editableNumber(calculated.amount, 2),
      purchaseTaxAmount: editableNumber(calculated.taxAmount, 2),
    });
  };

  // Form submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.projectId || !newOrder.orderId || !newOrder.goodsName || !newOrder.clientUnit) {
      alert('请填写所有必填字段（* 标记）。');
      return;
    }

    setSavingOrder(true);
    try {
      await onAddOrder(formToOrder(newOrder));
      resetNewOrder();
      setShowAddModal(false);
      setCurrentPage(1);
    } catch (error) {
      alert(error instanceof Error ? error.message : '订单新增失败');
    } finally {
      setSavingOrder(false);
    }
  };

  const openEditOrder = (order: OrderRecord) => {
    setEditingOrder(order);
    setNewOrder(orderToForm(order));
    setShowAddModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    if (!newOrder.projectId || !newOrder.orderId || !newOrder.goodsName || !newOrder.clientUnit) {
      alert('请填写所有必填字段（* 标记）。');
      return;
    }
    setSavingOrder(true);
    try {
      const updatedOrder = formToOrder(newOrder, editingOrder);
      await onUpdateOrder(editingOrder, updatedOrder);
      setSelectedOrder((current) => (current === editingOrder ? updatedOrder : current));
      setEditingOrder(null);
      resetNewOrder();
      setShowAddModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : '订单修改失败');
    } finally {
      setSavingOrder(false);
    }
  };

  const openDeleteVerification = (order: OrderRecord) => {
    setDeleteTarget(order);
    setDeleteVerificationCode(createDeleteVerificationCode());
    setDeleteVerificationInput('');
    setDeleteVerificationError('');
  };

  const closeDeleteVerification = () => {
    if (deletingOrder) return;
    setDeleteTarget(null);
    setDeleteVerificationInput('');
    setDeleteVerificationError('');
  };

  const refreshDeleteVerificationCode = () => {
    setDeleteVerificationCode(createDeleteVerificationCode());
    setDeleteVerificationInput('');
    setDeleteVerificationError('');
  };

  const handleDeleteOrder = async () => {
    if (!deleteTarget) return;
    if (deleteVerificationInput.trim().toUpperCase() !== deleteVerificationCode) {
      setDeleteVerificationError('验证码不正确，请重新输入。');
      return;
    }
    setDeletingOrder(true);
    try {
      await onDeleteOrder(deleteTarget);
      if (selectedOrder?.orderLineId === deleteTarget.orderLineId) {
        setSelectedOrder(null);
      }
      setDeleteTarget(null);
      setDeleteVerificationInput('');
      setDeleteVerificationError('');
    } catch (error) {
      alert(error instanceof Error ? error.message : '订单删除失败');
      refreshDeleteVerificationCode();
    } finally {
      setDeletingOrder(false);
    }
  };

  const handleBatchImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await onImportExcel(file);
      setCurrentPage(1);
      const skipped = result.skipped_rows
        ? `，跳过 ${result.skipped_rows} 行非业务数据（如表格末尾的 AIGC 标识行）`
        : '';
      alert(`批量导入完成：成功导入 ${result.success_rows} 条业务台账明细${skipped}。`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '批量导入失败，未写入任何数据');
    } finally {
      event.target.value = '';
    }
  };

  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !newPurchase.supplier) {
      alert('请填写采购厂商。');
      return;
    }
    const entry: OrderPurchaseEntry = {
      id: `purchase-${Date.now()}`,
      supplier: newPurchase.supplier,
      purchaseTaxRate: optionalFormNumber(newPurchase.purchaseTaxRate),
      netPurchaseUnitPrice: optionalFormNumber(newPurchase.netPurchaseUnitPrice),
      purchaseUnitPrice: optionalFormNumber(newPurchase.purchaseUnitPrice),
      netCost: optionalFormNumber(newPurchase.netCost),
      purchaseAmount: optionalFormNumber(newPurchase.purchaseAmount),
      purchaseTaxAmount: optionalFormNumber(newPurchase.purchaseTaxAmount),
      laborCost: optionalFormNumber(newPurchase.laborCost),
      otherCost: optionalFormNumber(newPurchase.otherCost),
    };

    if (editingPurchaseId === 'backend-purchase') {
      const updatedOrder: OrderRecord = {
        ...selectedOrder,
        supplierName: entry.supplier,
        purchaseTaxRate: entry.purchaseTaxRate,
        purchaseUnitPriceNoTax: entry.netPurchaseUnitPrice,
        purchaseUnitPrice: entry.purchaseUnitPrice,
        costNoTax: entry.netCost,
        purchaseAmount: entry.purchaseAmount,
        purchaseTaxAmount: entry.purchaseTaxAmount,
        laborCost: entry.laborCost,
        otherCost: entry.otherCost,
      };
      try {
        await onUpdateOrder(selectedOrder, updatedOrder);
        setSelectedOrder(updatedOrder);
        closeEntryModal();
      } catch (error) {
        alert(error instanceof Error ? error.message : '采购信息修改失败');
      }
      return;
    }

    if (editingPurchaseId) {
      setOrderPurchases((prev) => ({
        ...prev,
        [selectedOrderKey]: (prev[selectedOrderKey] || []).map((item) =>
          item.id === editingPurchaseId ? { ...entry, id: editingPurchaseId } : item,
        ),
      }));
    } else {
      setOrderPurchases((prev) => ({
        ...prev,
        [selectedOrderKey]: [entry, ...(prev[selectedOrderKey] || [])],
      }));
    }
    closeEntryModal();
  };

  const handleDeliverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    const entry: OrderDeliveryEntry = {
      id: `delivery-${Date.now()}`,
      deliveryDate: newDelivery.deliveryDate,
      deliveredQty: parseFloat(newDelivery.deliveredQty) || 0,
      deliveredNetRevenue: parseFloat(newDelivery.deliveredNetRevenue) || 0,
      deliveryValue: parseFloat(newDelivery.deliveryValue) || 0,
      deliveredNetCost: parseFloat(newDelivery.deliveredNetCost) || 0,
      deliveryCost: parseFloat(newDelivery.deliveryCost) || 0,
      pendingQty: parseFloat(newDelivery.pendingQty) || 0,
      pendingNetAmount: parseFloat(newDelivery.pendingNetAmount) || 0,
      pendingAmount: parseFloat(newDelivery.pendingAmount) || 0,
    };

    if (editingDeliveryId === 'backend-delivery') {
      const updatedOrder: OrderRecord = {
        ...selectedOrder,
        deliveredQty: entry.deliveredQty || 0,
        deliveryDate: entry.deliveryDate,
        deliveryRevenueNoTax: entry.deliveredNetRevenue,
        deliveryValue: entry.deliveryValue,
        deliveryCostNoTax: entry.deliveredNetCost,
        deliveryCost: entry.deliveryCost,
        pendingDeliveryQuantity: entry.pendingQty,
        pendingDeliveryAmountNoTax: entry.pendingNetAmount,
        pendingDeliveryAmount: entry.pendingAmount,
      };
      try {
        await onUpdateOrder(selectedOrder, updatedOrder);
        setSelectedOrder(updatedOrder);
        closeEntryModal();
      } catch (error) {
        alert(error instanceof Error ? error.message : '交付信息修改失败');
      }
      return;
    }

    if (editingDeliveryId) {
      setOrderDeliveries((prev) => ({
        ...prev,
        [selectedOrderKey]: (prev[selectedOrderKey] || []).map((item) =>
          item.id === editingDeliveryId ? { ...entry, id: editingDeliveryId } : item,
        ),
      }));
    } else {
      setOrderDeliveries((prev) => ({
        ...prev,
        [selectedOrderKey]: [entry, ...(prev[selectedOrderKey] || [])],
      }));
    }
    closeEntryModal();
  };

  const openCreatePurchase = () => {
    setEditingPurchaseId(null);
    resetNewPurchase();
    setActiveEntryModal('purchase');
  };

  const openEditPurchase = (item: OrderPurchaseEntry) => {
    setEditingPurchaseId(item.id);
    setNewPurchase(purchaseEntryToForm(item));
    setActiveEntryModal('purchase');
  };

  const openCreateDelivery = () => {
    setEditingDeliveryId(null);
    resetNewDelivery();
    setActiveEntryModal('delivery');
  };

  const openEditDelivery = (item: OrderDeliveryEntry) => {
    setEditingDeliveryId(item.id);
    setNewDelivery(deliveryEntryToForm(item));
    setActiveEntryModal('delivery');
  };

  const handleDeletePurchase = async (item: OrderPurchaseEntry) => {
    if (!selectedOrder) return;
    const confirmed = window.confirm('确定删除这条采购信息吗？');
    if (!confirmed) return;

    if (item.id === 'backend-purchase') {
      const updatedOrder: OrderRecord = {
        ...selectedOrder,
        supplierName: undefined,
        purchaseUnitPriceNoTax: undefined,
        purchaseUnitPrice: undefined,
        costNoTax: undefined,
        purchaseAmount: undefined,
      };
      try {
        await onUpdateOrder(selectedOrder, updatedOrder);
        setSelectedOrder(updatedOrder);
      } catch (error) {
        alert(error instanceof Error ? error.message : '采购信息删除失败');
      }
      return;
    }

    setOrderPurchases((prev) => ({
      ...prev,
      [selectedOrderKey]: (prev[selectedOrderKey] || []).filter((entry) => entry.id !== item.id),
    }));
  };

  const handleDeleteDelivery = async (item: OrderDeliveryEntry) => {
    if (!selectedOrder) return;
    const confirmed = window.confirm('确定删除这条交付信息吗？');
    if (!confirmed) return;

    if (item.id === 'backend-delivery') {
      const updatedOrder: OrderRecord = {
        ...selectedOrder,
        deliveredQty: 0,
        deliveryDate: undefined,
        deliveryRevenueNoTax: undefined,
        deliveryValue: undefined,
        deliveryCostNoTax: undefined,
        deliveryCost: undefined,
        pendingDeliveryQuantity: undefined,
        pendingDeliveryAmountNoTax: undefined,
        pendingDeliveryAmount: undefined,
      };
      try {
        await onUpdateOrder(selectedOrder, updatedOrder);
        setSelectedOrder(updatedOrder);
      } catch (error) {
        alert(error instanceof Error ? error.message : '交付信息删除失败');
      }
      return;
    }

    setOrderDeliveries((prev) => ({
      ...prev,
      [selectedOrderKey]: (prev[selectedOrderKey] || []).filter((entry) => entry.id !== item.id),
    }));
  };

  return (
    <div className="space-y-6 min-w-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">基本信息列表</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">查看和管理客户订单的基础业务信息</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 self-start sm:self-center">
          {canEnterOrders && (
            <>
              <label className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold cursor-pointer">
                <FileUp className="w-4 h-4 text-blue-600" />
                <span>导入Excel</span>
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleBatchImport} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => setBatchEditorMode('create')}
                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold"
              >
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span>批量新增</span>
              </button>
              <button 
                onClick={() => {
                  setEditingOrder(null);
                  resetNewOrder();
                  setShowAddModal(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all text-xs font-semibold"
              >
                <Plus className="w-4 h-4" />
                <span>新增订单</span>
              </button>
            </>
          )}
          {canEditOrders && (
            <button
              type="button"
              disabled={filteredOrderLineIds.length === 0}
              onClick={openBatchUpdateEditor}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              title={selectedBatchOrderIds.size
                ? `修改已选 ${selectedBatchOrderIds.size} 条订单明细`
                : filteredOrderLineIds.length
                  ? `未勾选时修改当前查询结果，共 ${filteredOrderLineIds.length} 条订单明细`
                  : '当前查询结果中没有可修改的订单明细'}
            >
              <ListChecks className="w-4 h-4 text-blue-600" />
              <span>
                批量修改
                {selectedBatchOrderIds.size
                  ? `（已选 ${selectedBatchOrderIds.size}）`
                  : `（查询 ${filteredOrderLineIds.length}）`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Query Bar */}
      <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 overflow-x-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end min-w-0">
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

          {/* Order Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">订单日期</label>
            <input 
              type="date" 
              lang="zh-CN"
              value={orderDate}
              onChange={e => setOrderDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Business Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">业务类型</label>
            <input
              type="text"
              placeholder="输入业务类型"
              value={businessType}
              onChange={e => setBusinessType(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Client Unit */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">客户单位名称</label>
            <input 
              type="text" 
              placeholder="输入客户名称"
              value={clientUnit}
              onChange={e => setClientUnit(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500">采购厂商</label>
            <input
              type="text"
              placeholder="输入采购厂商"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
            />
          </div>

          {/* Date range selection */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-slate-500">订单日期范围</label>
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                lang="zh-CN"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs text-slate-700"
              />
              <span className="text-slate-400 text-xs">至</span>
              <input 
                type="date" 
                lang="zh-CN"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
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

      {/* Table Section */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-w-0">
        <div className="overflow-x-auto max-w-full">
          <table className="w-full text-left border-collapse table-fixed min-w-[1960px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-4 py-3.5 text-center w-[56px]">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFilteredOrders}
                    disabled={!canEditOrders || filteredOrderLineIds.length === 0}
                    title="全选当前查询结果"
                    aria-label="全选当前查询结果"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                  />
                </th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[140px]">项目编号</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[160px]">销售订单号</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[120px]">客户经理</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[140px]">用户</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[220px]">项目名称</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[120px]">订单日期</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[240px]">物资/服务名称</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[90px]">数量</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-right w-[140px]">销售订单金额</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[90px]">交付数量</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-right w-[140px]">交付金额</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[132px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-6 py-10 text-center text-slate-400 text-sm">
                    暂无符合条件的订单记录
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((item, index) => (
                  <tr key={item.orderLineId || `${item.orderId}-${index}`} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(item.orderLineId && selectedBatchOrderIds.has(item.orderLineId))}
                        onChange={() => item.orderLineId && toggleOrderSelection(item.orderLineId)}
                        disabled={!canEditOrders || !item.orderLineId}
                        aria-label={`选择订单明细 ${item.orderId} ${item.goodsName}`}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                      />
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{item.projectId}</td>
                    <td className="px-6 py-4 text-xs font-mono font-semibold text-blue-600">{item.orderId}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 truncate" title={item.manager || '-'}>{item.manager || '-'}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 truncate" title={item.userName || '-'}>{item.userName || '-'}</td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-900 truncate" title={item.projectName || '-'}>{item.projectName || '-'}</td>
                    <td className="px-6 py-4 text-xs text-slate-600 font-mono">{item.orderDate}</td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-900 truncate" title={item.goodsName}>{item.goodsName}</td>
                    <td className="px-6 py-4 text-xs text-center text-slate-700 font-sans">{item.quantity}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-medium text-slate-900">
                      ¥{new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2 }).format(item.orderValue)}
                    </td>
                    <td className="px-6 py-4 text-xs text-center font-mono font-semibold text-slate-800">{item.deliveredQty}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-medium text-slate-900">¥{formatMoney(item.deliveryValue || 0)}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(item)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-200 transition-colors"
                        title="查看订单相关信息"
                        aria-label={`查看订单 ${item.orderId} 的相关信息`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {canEditOrders && (
                        <button type="button" onClick={() => openEditOrder(item)} title="修改订单" aria-label={`修改订单 ${item.orderId}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-200 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canDeleteOrders && (
                        <button type="button" onClick={() => openDeleteVerification(item)} title="删除订单" aria-label={`删除订单 ${item.orderId}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:border-rose-200 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between overflow-x-auto">
          <span className="text-xs text-slate-500">
            显示 {filteredOrders.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} 到 {Math.min(currentPage * itemsPerPage, filteredOrders.length)} 条，共 {filteredOrders.length} 条记录
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

      {batchEditorMode && (
        <BatchOrderEditor
          mode={batchEditorMode}
          selectedOrderLineIds={[...selectedBatchOrderIds]}
          onClose={() => setBatchEditorMode(null)}
          onSaved={handleBatchSaved}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteOrder();
            }}
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-verification-title"
          >
            <div className="flex items-start justify-between border-b border-slate-200 bg-rose-50 px-6 py-4">
              <div>
                <h2 id="delete-verification-title" className="text-base font-bold text-slate-900">删除基本信息</h2>
                <p className="mt-1 text-xs text-rose-600">删除后无法恢复，请完成验证码验证。</p>
              </div>
              <button
                type="button"
                onClick={closeDeleteVerification}
                disabled={deletingOrder}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="关闭删除验证"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <p>订单号：<span className="font-mono font-semibold text-slate-900">{deleteTarget.orderId}</span></p>
                <p className="mt-1 truncate" title={deleteTarget.goodsName}>物资/服务：<span className="font-medium text-slate-900">{deleteTarget.goodsName}</span></p>
              </div>

              <div>
                <label htmlFor="delete-verification-input" className="mb-2 block text-xs font-semibold text-slate-700">
                  请输入下方验证码
                </label>
                <div className="flex items-stretch gap-2">
                  <div
                    className="flex min-w-0 flex-1 select-none items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-4 font-mono text-xl font-bold tracking-[0.35em] text-slate-800"
                    aria-label={`验证码 ${deleteVerificationCode}`}
                  >
                    {deleteVerificationCode}
                  </div>
                  <button
                    type="button"
                    onClick={refreshDeleteVerificationCode}
                    disabled={deletingOrder}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="更换验证码"
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    换一张
                  </button>
                </div>
                <input
                  id="delete-verification-input"
                  type="text"
                  value={deleteVerificationInput}
                  onChange={(event) => {
                    setDeleteVerificationInput(event.target.value.toUpperCase());
                    setDeleteVerificationError('');
                  }}
                  maxLength={4}
                  autoComplete="off"
                  autoFocus
                  disabled={deletingOrder}
                  placeholder="输入 4 位验证码"
                  className={`mt-3 w-full rounded-lg border px-3 py-2.5 text-sm uppercase outline-none transition-colors ${
                    deleteVerificationError
                      ? 'border-rose-300 bg-rose-50 focus:border-rose-500'
                      : 'border-slate-200 focus:border-blue-500'
                  }`}
                  aria-invalid={Boolean(deleteVerificationError)}
                  aria-describedby={deleteVerificationError ? 'delete-verification-error' : undefined}
                />
                {deleteVerificationError && (
                  <p id="delete-verification-error" className="mt-2 text-xs text-rose-600">
                    {deleteVerificationError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={closeDeleteVerification}
                disabled={deletingOrder}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={deletingOrder || deleteVerificationInput.trim().length !== 4}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingOrder ? '正在删除...' : '验证并删除'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[88vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-600 mb-1">{selectedOrder.orderId}</p>
                <h2 className="text-base font-bold text-slate-900 truncate">{selectedOrder.goodsName}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedOrder(null);
                  setActiveEntryModal(null);
                }}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="关闭基本信息"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-73px)]">
              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">当前订单信息</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    ['全额/净额', selectedOrder.amountType || ''],
                    ['项目编号', selectedOrder.projectId],
                    ['部门', selectedOrder.department || ''],
                    ['分公司', selectedOrder.branchCompany || ''],
                    ['客户经理', selectedOrder.manager || ''],
                    ['订单日期', selectedOrder.orderDate],
                    ['业务类型', selectedOrder.businessType],
                    ['统计类别', selectedOrder.statisticalCategory || ''],
                    ['三级团队名称', selectedOrder.teamName || ''],
                    ['客户单位名称', selectedOrder.clientUnit],
                    ['用户', selectedOrder.userName || ''],
                    ['区域平台', selectedOrder.regionalPlatform || ''],
                    ['销售订单号', selectedOrder.orderId],
                    ['项目名称', selectedOrder.projectName || ''],
                    ['物资/服务名称', selectedOrder.goodsName],
                    ['规格型号', selectedOrder.specModel || ''],
                    ['单位', selectedOrder.unitName || selectedOrder.quantity.replace(/^[\d.]+\s*/, '') || ''],
                    ['数量', selectedOrder.quantity],
                    ['销售税率', selectedOrder.salesTaxRate === undefined ? '' : `${selectedOrder.salesTaxRate}%`],
                    ['不含税销售单价', formatOptionalMoney(selectedOrder.netUnitPrice)],
                    ['销售单价', formatOptionalMoney(selectedOrder.unitPrice)],
                    ['不含税订单金额', formatOptionalMoney(selectedOrder.netRevenue)],
                    ['销售税金', formatOptionalMoney(selectedOrder.salesTaxAmount)],
                    ['销售订单金额', `¥${formatMoney(selectedOrder.orderValue)}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-medium text-slate-400">{label}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-800 truncate min-h-[16px]" title={blank(value)}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">采购信息</h3>
                <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left" style={{ minWidth: ORDER_DETAIL_TABLE_WIDTHS.purchase }}>
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold whitespace-nowrap">采购厂商</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">采购税率</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">不含税采购单价</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">采购单价</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">不含税采购金额</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">含税采购金额</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">采购税金</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">人工成本</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">其他成本</th>
                        {canManageOrderRows && <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">操作</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPurchases.length === 0 ? (
                        <tr>
                          <td colSpan={canManageOrderRows ? 11 : 10} className="px-4 py-6 text-center text-xs text-slate-400">暂无采购信息</td>
                        </tr>
                      ) : (
                        selectedPurchases.map((item) => (
                          <tr key={item.id} className="text-xs text-slate-700">
                            <td className="px-4 py-2 whitespace-nowrap">{item.supplier}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{item.purchaseTaxRate === undefined ? '' : `${item.purchaseTaxRate}%`}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.netPurchaseUnitPrice)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.purchaseUnitPrice)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.netCost)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.purchaseAmount)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.purchaseTaxAmount)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.laborCost)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.otherCost)}</td>
                            {canManageOrderRows && (
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  {canEditOrders && (
                                    <button
                                      type="button"
                                      onClick={() => openEditPurchase(item)}
                                      title="修改采购信息"
                                      className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {canDeleteOrders && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePurchase(item)}
                                      title="删除采购信息"
                                      className="p-1.5 rounded-md text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-bold text-slate-900 mb-3">交付信息</h3>
                <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left" style={{ minWidth: ORDER_DETAIL_TABLE_WIDTHS.delivery }}>
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold whitespace-nowrap">交付日期</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">交付数量</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">交付不含税收入</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">交付价值</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">交付不含税成本</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">交付成本</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">待交付数量</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">待交付金额（不含税）</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">待交付金额</th>
                        {canManageOrderRows && <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">操作</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDeliveries.length === 0 ? (
                        <tr>
                          <td colSpan={canManageOrderRows ? 10 : 9} className="px-4 py-6 text-center text-xs text-slate-400">暂无交付信息</td>
                        </tr>
                      ) : (
                        selectedDeliveries.map((item) => (
                          <tr key={item.id} className="text-xs text-slate-700">
                            <td className="px-4 py-2 whitespace-nowrap">{item.deliveryDate}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{blank(item.deliveredQty)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.deliveredNetRevenue)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.deliveryValue)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.deliveredNetCost)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.deliveryCost)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{blank(item.pendingQty)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.pendingNetAmount)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.pendingAmount)}</td>
                            {canManageOrderRows && (
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  {canEditOrders && (
                                    <button
                                      type="button"
                                      onClick={() => openEditDelivery(item)}
                                      title="修改交付信息"
                                      className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {canDeleteOrders && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDelivery(item)}
                                      title="删除交付信息"
                                      className="p-1.5 rounded-md text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {canEnterOrders && <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={openCreatePurchase}
                  className="px-4 py-2 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold"
                >
                  录入采购信息
                </button>
                <button
                  type="button"
                  onClick={openCreateDelivery}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  录入交付信息
                </button>
              </div>}
            </div>
          </div>
        </div>
      )}

      {selectedOrder && activeEntryModal === 'purchase' && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900">{editingPurchaseId ? '修改采购信息' : '录入采购信息'}</h2>
              <button type="button" onClick={closeEntryModal} className="text-slate-400 hover:text-slate-600 text-lg font-semibold">
                &times;
              </button>
            </div>
            <form onSubmit={handlePurchaseSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购厂商 *</label>
                  <input required value={newPurchase.supplier} onChange={e => setNewPurchase({...newPurchase, supplier: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购税率 (%)</label>
                  <input type="number" min="0" max="100" step="0.000001" value={newPurchase.purchaseTaxRate} onChange={e => updatePurchaseCalculation({ purchaseTaxRate: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税采购单价</label>
                  <input type="number" min="0" step="0.000001" value={newPurchase.netPurchaseUnitPrice} onChange={e => updatePurchaseCalculation({ netPurchaseUnitPrice: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购单价</label>
                  <input type="number" readOnly value={newPurchase.purchaseUnitPrice} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税采购金额</label>
                  <input type="number" readOnly value={newPurchase.netCost} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">含税采购金额</label>
                  <input type="number" readOnly value={newPurchase.purchaseAmount} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购税金</label>
                  <input type="number" readOnly value={newPurchase.purchaseTaxAmount} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">人工成本</label>
                  <input type="number" min="0" value={newPurchase.laborCost} onChange={e => setNewPurchase({...newPurchase, laborCost: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">其他成本</label>
                  <input type="number" min="0" value={newPurchase.otherCost} onChange={e => setNewPurchase({...newPurchase, otherCost: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button type="button" onClick={closeEntryModal} className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium">取消</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">{editingPurchaseId ? '保存修改' : '保存采购信息'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedOrder && activeEntryModal === 'delivery' && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900">{editingDeliveryId ? '修改交付信息' : '录入交付信息'}</h2>
              <button type="button" onClick={closeEntryModal} className="text-slate-400 hover:text-slate-600 text-lg font-semibold">
                &times;
              </button>
            </div>
            <form onSubmit={handleDeliverySubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">交付日期</label>
                  <input type="date" lang="zh-CN" value={newDelivery.deliveryDate} onChange={e => setNewDelivery({...newDelivery, deliveryDate: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                {[
                  ['交付数量', 'deliveredQty'],
                  ['交付不含税收入', 'deliveredNetRevenue'],
                  ['交付价值', 'deliveryValue'],
                  ['交付不含税成本', 'deliveredNetCost'],
                  ['交付成本', 'deliveryCost'],
                  ['待交付数量', 'pendingQty'],
                  ['待交付金额（不含税）', 'pendingNetAmount'],
                  ['待交付金额', 'pendingAmount'],
                ].map(([label, key]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600">{label}</label>
                    <input
                      type="number"
                      value={newDelivery[key as keyof typeof newDelivery]}
                      onChange={e => setNewDelivery({...newDelivery, [key]: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button type="button" onClick={closeEntryModal} className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium">取消</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">{editingDeliveryId ? '保存修改' : '保存交付信息'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[88vh] overflow-hidden transform transition-all scale-100 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-blue-600" />
                <span>{editingOrder ? '修改客户订单' : '新增客户订单'}</span>
              </h2>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  setEditingOrder(null);
                  resetNewOrder();
                }}
                className="text-slate-400 hover:text-slate-600 text-lg font-semibold"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={editingOrder ? handleEditSubmit : handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[calc(88vh-73px)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">全额/净额</label>
                  <select
                    value={newOrder.amountType}
                    onChange={e => setNewOrder({...newOrder, amountType: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="全额">全额</option>
                    <option value="净额">净额</option>
                  </select>
                </div>

                {/* Project Id */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">项目编号 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="如: PRJ-2023-001"
                    value={newOrder.projectId}
                    onChange={e => setNewOrder({...newOrder, projectId: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Order Id */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">销售订单号 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="如: ORD-2023-9009"
                    value={newOrder.orderId}
                    onChange={e => setNewOrder({...newOrder, orderId: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">部门</label>
                  <input
                    type="text"
                    value={newOrder.department}
                    onChange={e => setNewOrder({...newOrder, department: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">分公司</label>
                  <input
                    type="text"
                    value={newOrder.branchCompany}
                    onChange={e => setNewOrder({...newOrder, branchCompany: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">客户经理</label>
                  <input
                    type="text"
                    value={newOrder.manager}
                    onChange={e => setNewOrder({...newOrder, manager: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                {/* Order Date */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">订单日期 *</label>
                  <input 
                    type="date" 
                    lang="zh-CN"
                    required
                    value={newOrder.orderDate}
                    onChange={e => setNewOrder({...newOrder, orderDate: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Business Type */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">业务类型 *</label>
                  <input
                    type="text"
                    required
                    placeholder="输入业务类型"
                    value={newOrder.businessType}
                    onChange={e => setNewOrder({...newOrder, businessType: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">统计类别</label>
                  <input
                    type="text"
                    value={newOrder.statisticalCategory}
                    onChange={e => setNewOrder({...newOrder, statisticalCategory: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">三级团队名称</label>
                  <input
                    type="text"
                    value={newOrder.teamName}
                    onChange={e => setNewOrder({...newOrder, teamName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                {/* Client Unit */}
                <div className="lg:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-600">客户单位名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="如: 中国航天科技集团"
                    value={newOrder.clientUnit}
                    onChange={e => setNewOrder({...newOrder, clientUnit: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">用户</label>
                  <input
                    type="text"
                    value={newOrder.userName}
                    onChange={e => setNewOrder({...newOrder, userName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">区域平台</label>
                  <input
                    type="text"
                    value={newOrder.regionalPlatform}
                    onChange={e => setNewOrder({...newOrder, regionalPlatform: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="lg:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-600">项目名称</label>
                  <input
                    type="text"
                    value={newOrder.projectName}
                    onChange={e => setNewOrder({...newOrder, projectName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                {/* Goods Name */}
                <div className="lg:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-600">物资/服务名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="如: 网络安全态势感知平台软件"
                    value={newOrder.goodsName}
                    onChange={e => setNewOrder({...newOrder, goodsName: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="lg:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-600">规格型号</label>
                  <input
                    type="text"
                    value={newOrder.specModel}
                    onChange={e => setNewOrder({...newOrder, specModel: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                {/* Quantity */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">数量 *</label>
                  <div className="flex gap-1.5">
                    <input 
                      type="number" 
                      required
                      placeholder="1"
                      value={newOrder.quantityVal}
                      onChange={e => updateSalesCalculation({ quantityVal: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                    />
                    <select 
                      value={newOrder.quantityUnit}
                      onChange={e => setNewOrder({...newOrder, quantityUnit: e.target.value})}
                      className="px-2 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 bg-white w-20"
                    >
                      <option value="套">套</option>
                      <option value="节点">节点</option>
                      <option value="台">台</option>
                      <option value="人月">人月</option>
                      <option value="项">项</option>
                    </select>
                  </div>
                </div>

                {/* Order Value */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">销售订单金额 (元) *</label>
                  <input 
                    type="number" 
                    required
                    readOnly
                    placeholder="0.00"
                    value={newOrder.orderValue}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">销售税率 (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={newOrder.salesTaxRate}
                    onChange={e => updateSalesCalculation({ salesTaxRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税销售单价</label>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={newOrder.netUnitPrice}
                    onChange={e => updateSalesCalculation({ netUnitPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">销售单价</label>
                  <input
                    type="number"
                    readOnly
                    value={newOrder.unitPrice}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税订单金额</label>
                  <input
                    type="number"
                    readOnly
                    value={newOrder.netRevenue}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">销售税金</label>
                  <input
                    type="number"
                    readOnly
                    value={newOrder.salesTaxAmount}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600"
                  />
                </div>

                {/* Delivered quantity */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">交付数量</label>
                  <input 
                    type="number" 
                    placeholder="0"
                    value={newOrder.deliveredQty}
                    onChange={e => setNewOrder({...newOrder, deliveredQty: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingOrder(null);
                    resetNewOrder();
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  {savingOrder ? '保存中...' : '确认保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
