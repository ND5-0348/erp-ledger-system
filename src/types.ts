import type { EditContext } from './api';
import type { MoneyValue } from './lib/money';
export interface RecordHistory {
  editContext?: EditContext;
  orderNumberHistory?: string[];
  managerHistory?: string[];
}
export interface FinancialPhase { date: string | null; amount: MoneyValue | null }
/**
 * Shared types and interfaces for the Enterprise Management System
 */

export interface ProjectLedger extends RecordHistory {
  deliveryAccountsReceivable?: MoneyValue;
  invoiceAccountsReceivable?: MoneyValue;
  deliveryValue?: MoneyValue; // B交付收入
  deliveryCost?: MoneyValue; // B交付成本
  totalPaid?: MoneyValue; // D付款金额（多期合计）
  salesInvoiceAmount?: MoneyValue; // E发票金额（多期合计）
  receivedInvoiceAmount?: MoneyValue; // E收票金额（多期合计）
  id: string; // 项目编号 (e.g. PJ-2023-001)
  clientUnit: string; // 客户单位名称
  projectName: string; // 项目名称
  orderAmount: MoneyValue; // 销售订单金额
  purchaseAmount: MoneyValue; // 采购金额
  totalReceived: MoneyValue; // 回款合计
  department: string; // 部门
  manager: string; // 客户经理
  orderId: string; // 销售订单号
  orderStatus: string; // 订单状态
  orderDate: string; // 销售订单日期
}

export interface OrderRecord extends RecordHistory {
  orderLineId?: number; // 订单明细ID
  amountType?: string; // 全额/净额
  projectId: string; // 项目编号
  department?: string; // 部门
  branchCompany?: string; // 分公司
  manager?: string; // 客户经理
  orderId: string; // 销售订单号
  orderDate: string; // 销售订单日期
  updatedAt?: string; // 订单关联数据最新修改时间
  orderStatus?: string; // 订单状态
  totalReceived?: MoneyValue; // 回款合计
  totalPaid?: MoneyValue; // 付款合计
  deliveryAccountsReceivable?: MoneyValue; // 交付收入减回款合计
  invoiceAccountsReceivable?: MoneyValue; // 全部有效开票减回款合计
  accountsReceivable?: MoneyValue; // 应收账款
  accountsPayable?: MoneyValue; // 应付账款
  grossProfit?: MoneyValue; // 毛利润
  statisticalCategory?: string; // 统计类别
  teamName?: string; // 三级团队名称
  goodsName: string; // 物资/服务名称
  projectName?: string; // 项目名称
  userName?: string; // 用户
  regionalPlatform?: string; // 区域平台
  specModel?: string; // 规格型号
  unitName?: string; // 单位
  quantity: string; // 数量 (e.g. "1 套", "5 节点")
  salesTaxRate?: number; // 销售税率（百分数）
  netUnitPrice?: MoneyValue; // 不含税销售单价
  unitPrice?: MoneyValue; // 销售单价
  netRevenue?: MoneyValue; // 不含税订单金额
  orderValue: MoneyValue; // 销售订单金额
  salesTaxAmount?: MoneyValue; // 销售税金
  deliveredQty: MoneyValue; // 交付数量
  businessType: string; // 业务类型
  clientUnit: string; // 客户单位名称
  supplierName?: string; // 采购厂商
  purchaseTaxRate?: number; // 采购税率（百分数）
  purchaseUnitPriceNoTax?: MoneyValue; // 不含税采购单价
  purchaseUnitPrice?: MoneyValue; // 采购单价
  costNoTax?: MoneyValue; // 不含税采购金额
  purchaseAmount?: MoneyValue; // 采购金额
  purchaseTaxAmount?: MoneyValue; // 采购税金
  laborCost?: MoneyValue; // 人工成本（预留）
  otherCost?: MoneyValue; // 其他成本（预留）
  deliveryDate?: string; // 交付日期
  deliveryRevenueNoTax?: MoneyValue; // 交付不含税收入
  deliveryValue?: MoneyValue; // 交付收入
  deliveryCostNoTax?: MoneyValue; // 交付不含税成本
  deliveryCost?: MoneyValue; // 交付成本
  pendingDeliveryQuantity?: MoneyValue; // 待交付数量
  pendingDeliveryAmountNoTax?: MoneyValue; // 待交付金额（不含税）
  pendingDeliveryAmount?: MoneyValue; // 待交付金额
}

export interface PurchaseRecord extends RecordHistory {
  paymentPhases?: FinancialPhase[];
  orderLineId?: number; // 订单明细ID
  projectId: string; // 项目编号
  orderId: string; // 销售订单号
  manager: string; // 客户经理
  department: string; // 部门
  contractNo: string; // 公司合同号
  contractAmount: MoneyValue; // 合同金额
  invoiceAmount: MoneyValue; // 收票金额（多期合计）
  paymentAmount: MoneyValue; // 付款金额
  supplier: string; // 采购厂商
  paymentDate?: string; // 付款/回款时间
}

export interface SalesRecord extends RecordHistory {
  receiptPhases?: FinancialPhase[];
  orderLineId?: number; // 订单明细ID
  projectId: string; // 项目编号
  orderId: string; // 销售订单号
  manager: string; // 客户经理
  department: string; // 部门
  contractNo: string; // 公司合同号
  contractDate: string; // 合同签订日期
  contractValue: MoneyValue; // 合同金额
  invoiceAmount: MoneyValue; // 开票金额
  totalReceived?: MoneyValue; // 回款合计
  deliveryAccountsReceivable?: MoneyValue; // 交付收入减回款合计
  invoiceAccountsReceivable?: MoneyValue; // 全部有效开票减回款合计
  accountsReceivable?: MoneyValue; // 应收款
  supplierName?: string; // 采购厂商
  receiptDate?: string; // 回款时间
  invoiceDates?: string[]; // 销售开票日期
}

export interface OperationLog {
  id: string;
  user: string; // 操作人/用户 (e.g. "张伟 (管理员)", "李明 (开发)")
  module: string; // 操作模块
  details: string; // 详情
  status: '成功' | '失败' | '进行中'; // 状态
  time: string; // 操作时间 (YYYY-MM-DD HH:mm:ss)
  changeGroups?: Array<{
    title: string;
    changes: string[];
  }>;
}

export interface BackupInfo {
  id: string;
  fileName: string; // 文件名
  size: string; // 大小 (e.g. "124.5 MB")
  backupTime: string; // 备份时间 (YYYY-MM-DD HH:mm:ss)
}

export type ScreenType = 'dashboard' | 'ledger' | 'orders' | 'purchases' | 'sales' | 'system';
