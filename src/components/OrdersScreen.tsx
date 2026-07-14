import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  ShoppingBag,
  Upload,
  Download,
  Eye,
  Pencil,
  Trash2,
  X
} from 'lucide-react';
import { OrderRecord } from '../types';
import {
  ORDER_DETAIL_TABLE_WIDTHS,
} from '../lib/orderDetailTables';
import { ORDER_IMPORT_TEMPLATE_CSV, parseOrderImportCsv } from '../lib/orderImportTemplate';
import { applyOrderFilters, emptyOrderFilters, submitQueryFilters } from '../lib/queryFilterModel';

interface OrderPurchaseEntry {
  id: string;
  supplier: string;
  netPurchaseUnitPrice?: number;
  purchaseUnitPrice?: number;
  netCost?: number;
  purchaseAmount?: number;
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
  onImportOrders: (orders: OrderRecord[]) => Promise<number>;
  onUpdateOrder: (target: OrderRecord, order: OrderRecord) => Promise<void>;
  onDeleteOrder: (target: OrderRecord) => Promise<void>;
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

export default function OrdersScreen({ orders, onAddOrder, onImportOrders, onUpdateOrder, onDeleteOrder, canEnterOrders, canEditOrders, canDeleteOrders }: OrdersScreenProps) {
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
    netUnitPrice: '',
    unitPrice: '',
    netRevenue: '',
    orderValue: '',
    deliveredQty: '0',
    businessType: '咨询服务',
    clientUnit: ''
  });
  const [newPurchase, setNewPurchase] = useState({
    supplier: '',
    netPurchaseUnitPrice: '',
    purchaseUnitPrice: '',
    netCost: '',
    purchaseAmount: '',
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
    selectedOrder.purchaseUnitPriceNoTax ||
    selectedOrder.purchaseUnitPrice ||
    selectedOrder.costNoTax ||
    selectedOrder.purchaseAmount
  )
    ? [{
        id: 'backend-purchase',
        supplier: selectedOrder.supplierName || '',
        netPurchaseUnitPrice: selectedOrder.purchaseUnitPriceNoTax,
        purchaseUnitPrice: selectedOrder.purchaseUnitPrice,
        netCost: selectedOrder.costNoTax,
        purchaseAmount: selectedOrder.purchaseAmount,
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

  const resetNewPurchase = () => {
    setNewPurchase({ supplier: '', netPurchaseUnitPrice: '', purchaseUnitPrice: '', netCost: '', purchaseAmount: '' });
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
    netPurchaseUnitPrice: blank(item.netPurchaseUnitPrice),
    purchaseUnitPrice: blank(item.purchaseUnitPrice),
    netCost: blank(item.netCost),
    purchaseAmount: blank(item.purchaseAmount),
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
      netUnitPrice: '',
      unitPrice: '',
      netRevenue: '',
      orderValue: '',
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
      netUnitPrice: order.netUnitPrice === undefined ? '' : String(order.netUnitPrice),
      unitPrice: order.unitPrice === undefined ? '' : String(order.unitPrice),
      netRevenue: order.netRevenue === undefined ? '' : String(order.netRevenue),
      orderValue: String(order.orderValue || ''),
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
    netUnitPrice: parseFloat(form.netUnitPrice) || 0,
    unitPrice: parseFloat(form.unitPrice) || 0,
    netRevenue: parseFloat(form.netRevenue) || 0,
    orderValue: parseFloat(form.orderValue) || 0,
    deliveredQty: parseFloat(form.deliveredQty) || 0,
    businessType: form.businessType,
    clientUnit: form.clientUnit,
    supplierName: existing?.supplierName,
    purchaseUnitPriceNoTax: existing?.purchaseUnitPriceNoTax,
    purchaseUnitPrice: existing?.purchaseUnitPrice,
    costNoTax: existing?.costNoTax,
    purchaseAmount: existing?.purchaseAmount,
    deliveryDate: existing?.deliveryDate,
    deliveryRevenueNoTax: existing?.deliveryRevenueNoTax,
    deliveryValue: existing?.deliveryValue,
    deliveryCostNoTax: existing?.deliveryCostNoTax,
    deliveryCost: existing?.deliveryCost,
    pendingDeliveryQuantity: existing?.pendingDeliveryQuantity,
    pendingDeliveryAmountNoTax: existing?.pendingDeliveryAmountNoTax,
    pendingDeliveryAmount: existing?.pendingDeliveryAmount,
  });

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

  const handleDeleteOrder = async (order: OrderRecord) => {
    const confirmed = window.confirm(`确定删除订单 "${order.orderId}" 吗？`);
    if (!confirmed) return;
    try {
      await onDeleteOrder(order);
      if (selectedOrder === order) {
        setSelectedOrder(null);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '订单删除失败');
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([`\uFEFF${ORDER_IMPORT_TEMPLATE_CSV}`], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '订单批量导入模板.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleBatchImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    const importedOrders = parseOrderImportCsv(content, new Date().toISOString().split('T')[0]);
    if (importedOrders.length === 0) {
      event.target.value = '';
      alert('导入文件中没有有效订单。');
      return;
    }
    try {
      const created = await onImportOrders(importedOrders);
      setCurrentPage(1);
      alert(`批量导入完成：成功导入 ${created} 条客户订单。`);
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
      netPurchaseUnitPrice: parseFloat(newPurchase.netPurchaseUnitPrice) || 0,
      purchaseUnitPrice: parseFloat(newPurchase.purchaseUnitPrice) || 0,
      netCost: parseFloat(newPurchase.netCost) || 0,
      purchaseAmount: parseFloat(newPurchase.purchaseAmount) || 0,
    };

    if (editingPurchaseId === 'backend-purchase') {
      const updatedOrder: OrderRecord = {
        ...selectedOrder,
        supplierName: entry.supplier,
        purchaseUnitPriceNoTax: entry.netPurchaseUnitPrice,
        purchaseUnitPrice: entry.purchaseUnitPrice,
        costNoTax: entry.netCost,
        purchaseAmount: entry.purchaseAmount,
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">订单详情列表</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">查看和管理全平台的客户订单与项目进度详情</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>下载模板</span>
          </button>
          {canEnterOrders && (
            <>
              <label className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg shadow-sm transition-all text-xs font-semibold cursor-pointer">
                <Upload className="w-4 h-4 text-slate-400" />
                <span>批量导入</span>
                <input type="file" accept=".csv,text/csv" onChange={handleBatchImport} className="hidden" />
              </label>
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
            <label className="text-xs font-medium text-slate-500">订单号</label>
            <input 
              type="text" 
              placeholder="输入订单号"
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
            <label className="text-xs font-medium text-slate-500">客户单位</label>
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
          <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-200">
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[140px]">项目编号</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[160px]">订单号</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[120px]">订单日期</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 w-[240px]">货物名称</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[90px]">数量</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-right w-[140px]">订单价值</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[90px]">交付数量</th>
                <th className="px-6 py-3.5 font-semibold text-xs text-slate-500 text-center w-[132px]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400 text-sm">
                    暂无符合条件的订单记录
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((item, index) => (
                  <tr key={`${item.orderId}-${index}`} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{item.projectId}</td>
                    <td className="px-6 py-4 text-xs font-mono font-semibold text-blue-600">{item.orderId}</td>
                    <td className="px-6 py-4 text-xs text-slate-600 font-mono">{item.orderDate}</td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-900 truncate" title={item.goodsName}>{item.goodsName}</td>
                    <td className="px-6 py-4 text-xs text-center text-slate-700 font-sans">{item.quantity}</td>
                    <td className="px-6 py-4 text-xs text-right font-mono font-medium text-slate-900">
                      ¥{new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2 }).format(item.orderValue)}
                    </td>
                    <td className="px-6 py-4 text-xs text-center font-mono font-semibold text-slate-800">{item.deliveredQty}</td>
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
                        <button type="button" onClick={() => handleDeleteOrder(item)} title="删除订单" aria-label={`删除订单 ${item.orderId}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:border-rose-200 transition-colors">
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
                aria-label="关闭订单详情"
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
                    ['订单号', selectedOrder.orderId],
                    ['项目名称', selectedOrder.projectName || ''],
                    ['货物名称', selectedOrder.goodsName],
                    ['规格型号', selectedOrder.specModel || ''],
                    ['单位', selectedOrder.unitName || selectedOrder.quantity.replace(/^[\d.]+\s*/, '') || ''],
                    ['数量', selectedOrder.quantity],
                    ['不含税单价', formatOptionalMoney(selectedOrder.netUnitPrice)],
                    ['单价', formatOptionalMoney(selectedOrder.unitPrice)],
                    ['不含税收入', formatOptionalMoney(selectedOrder.netRevenue)],
                    ['订单价值', `¥${formatMoney(selectedOrder.orderValue)}`],
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
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">不含税采购单价</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">采购单价</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">不含税成本</th>
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">采购金额</th>
                        {canManageOrderRows && <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">操作</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPurchases.length === 0 ? (
                        <tr>
                          <td colSpan={canManageOrderRows ? 6 : 5} className="px-4 py-6 text-center text-xs text-slate-400">暂无采购信息</td>
                        </tr>
                      ) : (
                        selectedPurchases.map((item) => (
                          <tr key={item.id} className="text-xs text-slate-700">
                            <td className="px-4 py-2 whitespace-nowrap">{item.supplier}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.netPurchaseUnitPrice)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.purchaseUnitPrice)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.netCost)}</td>
                            <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{formatOptionalMoney(item.purchaseAmount)}</td>
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
                  <label className="text-xs font-semibold text-slate-600">不含税采购单价</label>
                  <input type="number" value={newPurchase.netPurchaseUnitPrice} onChange={e => setNewPurchase({...newPurchase, netPurchaseUnitPrice: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购单价</label>
                  <input type="number" value={newPurchase.purchaseUnitPrice} onChange={e => setNewPurchase({...newPurchase, purchaseUnitPrice: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税成本</label>
                  <input type="number" value={newPurchase.netCost} onChange={e => setNewPurchase({...newPurchase, netCost: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">采购金额</label>
                  <input type="number" value={newPurchase.purchaseAmount} onChange={e => setNewPurchase({...newPurchase, purchaseAmount: e.target.value})} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
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
                  <label className="text-xs font-semibold text-slate-600">订单号 *</label>
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
                  <label className="text-xs font-semibold text-slate-600">货物名称 *</label>
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
                      onChange={e => setNewOrder({...newOrder, quantityVal: e.target.value})}
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
                  <label className="text-xs font-semibold text-slate-600">订单价值 (元) *</label>
                  <input 
                    type="number" 
                    required
                    placeholder="0.00"
                    value={newOrder.orderValue}
                    onChange={e => setNewOrder({...newOrder, orderValue: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税单价</label>
                  <input
                    type="number"
                    value={newOrder.netUnitPrice}
                    onChange={e => setNewOrder({...newOrder, netUnitPrice: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">单价</label>
                  <input
                    type="number"
                    value={newOrder.unitPrice}
                    onChange={e => setNewOrder({...newOrder, unitPrice: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">不含税收入</label>
                  <input
                    type="number"
                    value={newOrder.netRevenue}
                    onChange={e => setNewOrder({...newOrder, netRevenue: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
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
