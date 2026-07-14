/**
 * Shared types and interfaces for the Enterprise Management System
 */

export interface ProjectLedger {
  id: string; // 项目编号 (e.g. PJ-2023-001)
  clientUnit: string; // 客户单位
  projectName: string; // 项目名称
  orderAmount: number; // 订单金额
  purchaseAmount: number; // 采购金额
  totalReceived: number; // 回款合计
  department: string; // 部门
  manager: string; // 客户经理
  orderId: string; // 订单号
  orderStatus: string; // 订单状态
  orderDate: string; // 订单日期
}

export interface OrderRecord {
  orderLineId?: number; // 订单明细ID
  amountType?: string; // 全额/净额
  projectId: string; // 项目编号
  department?: string; // 部门
  branchCompany?: string; // 分公司
  manager?: string; // 客户经理
  orderId: string; // 订单号
  orderDate: string; // 订单日期
  statisticalCategory?: string; // 统计类别
  teamName?: string; // 三级团队名称
  goodsName: string; // 货物名称
  projectName?: string; // 项目名称
  userName?: string; // 用户
  regionalPlatform?: string; // 区域平台
  specModel?: string; // 规格型号
  unitName?: string; // 单位
  quantity: string; // 数量 (e.g. "1 套", "5 节点")
  netUnitPrice?: number; // 不含税单价
  unitPrice?: number; // 单价
  netRevenue?: number; // 不含税收入
  orderValue: number; // 订单价值 (订单金额)
  deliveredQty: number; // 交付数量
  businessType: string; // 业务类型
  clientUnit: string; // 客户单位
  supplierName?: string; // 采购厂商
  purchaseUnitPriceNoTax?: number; // 不含税采购单价
  purchaseUnitPrice?: number; // 采购单价
  costNoTax?: number; // 不含税成本
  purchaseAmount?: number; // 采购金额
  deliveryDate?: string; // 交付日期
  deliveryRevenueNoTax?: number; // 交付不含税收入
  deliveryValue?: number; // 交付价值
  deliveryCostNoTax?: number; // 交付不含税成本
  deliveryCost?: number; // 交付成本
  pendingDeliveryQuantity?: number; // 待交付数量
  pendingDeliveryAmountNoTax?: number; // 待交付金额（不含税）
  pendingDeliveryAmount?: number; // 待交付金额
}

export interface PurchaseRecord {
  orderLineId?: number; // 订单明细ID
  projectId: string; // 项目编号
  orderId: string; // 订单号
  manager: string; // 客户经理
  department: string; // 部门
  contractNo: string; // 公司合同号
  contractAmount: number; // 合同金额
  invoiceAmount: number; // 收票金额
  paymentAmount: number; // 付款金额
  supplier: string; // 供应商
  paymentDate?: string; // 付款/回款时间
}

export interface SalesRecord {
  orderLineId?: number; // 订单明细ID
  projectId: string; // 项目编号
  orderId: string; // 订单号
  manager: string; // 客户经理
  department: string; // 部门
  contractNo: string; // 公司合同号
  contractDate: string; // 合同签订日期
  contractValue: number; // 合同价值
  invoiceAmount: number; // 开票金额
  totalReceived?: number; // 回款合计
  accountsReceivable?: number; // 应收款
  supplierName?: string; // 采购厂家
  receiptDate?: string; // 回款时间
}

export interface OperationLog {
  id: string;
  user: string; // 操作人/用户 (e.g. "张伟 (管理员)", "李明 (开发)")
  module: string; // 操作模块
  details: string; // 详情
  status: '成功' | '失败' | '进行中'; // 状态
  time: string; // 操作时间 (YYYY-MM-DD HH:mm:ss)
}

export interface BackupInfo {
  id: string;
  fileName: string; // 文件名
  size: string; // 大小 (e.g. "124.5 MB")
  backupTime: string; // 备份时间 (YYYY-MM-DD HH:mm:ss)
}

export type ScreenType = 'dashboard' | 'ledger' | 'orders' | 'purchases' | 'sales' | 'system';
