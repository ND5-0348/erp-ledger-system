import { ProjectLedger, OrderRecord, PurchaseRecord, SalesRecord, OperationLog, BackupInfo } from './types';

// Initial Project Ledgers
export const initialProjectLedgers: ProjectLedger[] = [
  {
    id: 'PJ-2023-001',
    clientUnit: '中核集团有限公司',
    projectName: '企业云存储扩容二期',
    orderAmount: 1250000.00,
    purchaseAmount: 840000.00,
    totalReceived: 1000000.00,
    department: 'IT基础设施部',
    manager: '张伟',
    orderId: 'ORD-2023-9001',
    orderStatus: '已支付',
    orderDate: '2023-11-24'
  },
  {
    id: 'PJ-2023-008',
    clientUnit: '万达商业地产集团',
    projectName: '智慧园区安防系统集成',
    orderAmount: 4800000.00,
    purchaseAmount: 3200000.00,
    totalReceived: 2400000.00,
    department: '安防事业部',
    manager: '李娜',
    orderId: 'ORD-2023-9002',
    orderStatus: '待支付',
    orderDate: '2023-11-25'
  },
  {
    id: 'PJ-2022-156',
    clientUnit: '国家电网研究院',
    projectName: '大数据分析平台升级',
    orderAmount: 820000.00,
    purchaseAmount: 450000.00,
    totalReceived: 820000.00,
    department: '数据研发中心',
    manager: '王强',
    orderId: 'ORD-2023-9003',
    orderStatus: '已完成',
    orderDate: '2023-11-26'
  },
  {
    id: 'PJ-2023-012',
    clientUnit: '顺丰速运华东总部',
    projectName: '自动化仓库控制软件',
    orderAmount: 2150000.00,
    purchaseAmount: 1100000.00,
    totalReceived: 1500000.00,
    department: 'IT基础设施部',
    manager: '赵敏',
    orderId: 'ORD-2023-9004',
    orderStatus: '已发货',
    orderDate: '2023-11-27'
  },
  {
    id: 'PJ-2023-024',
    clientUnit: '中国移动通信分公司',
    projectName: '5G边缘计算试点项目',
    orderAmount: 980000.00,
    purchaseAmount: 720000.00,
    totalReceived: 490000.00,
    department: '数据研发中心',
    manager: '孙磊',
    orderId: 'ORD-2023-9005',
    orderStatus: '已发货',
    orderDate: '2023-11-28'
  },
  // Extra generated records to demonstrate pagination nicely
  {
    id: 'PJ-2023-002',
    clientUnit: '华东区电力集团',
    projectName: '输电线路智检感知系统',
    orderAmount: 1450000.00,
    purchaseAmount: 980000.00,
    totalReceived: 1450000.00,
    department: '安防事业部',
    manager: '张伟',
    orderId: 'ORD-2023-9006',
    orderStatus: '已完成',
    orderDate: '2023-11-20'
  },
  {
    id: 'PJ-2023-003',
    clientUnit: '南方航空信息中心',
    projectName: '云桌面虚拟化资源扩容',
    orderAmount: 750000.00,
    purchaseAmount: 510000.00,
    totalReceived: 600000.00,
    department: 'IT基础设施部',
    manager: '李娜',
    orderId: 'ORD-2023-9007',
    orderStatus: '已发货',
    orderDate: '2023-11-15'
  },
  {
    id: 'PJ-2023-004',
    clientUnit: '招商银行信用卡中心',
    projectName: '核心数仓分流引擎采购',
    orderAmount: 3100000.00,
    purchaseAmount: 2100000.00,
    totalReceived: 3100000.00,
    department: '数据研发中心',
    manager: '王强',
    orderId: 'ORD-2023-9008',
    orderStatus: '已完成',
    orderDate: '2023-11-12'
  },
  {
    id: 'PJ-2023-005',
    clientUnit: '腾讯科技(深圳)有限公司',
    projectName: '微服务网关安全集成开发',
    orderAmount: 620000.00,
    purchaseAmount: 400000.00,
    totalReceived: 300000.00,
    department: 'IT基础设施部',
    manager: '赵敏',
    orderId: 'ORD-2023-9009',
    orderStatus: '待支付',
    orderDate: '2023-11-10'
  },
  {
    id: 'PJ-2023-006',
    clientUnit: '比亚迪汽车工业有限公司',
    projectName: '工厂排产决策仿真引擎',
    orderAmount: 1850000.00,
    purchaseAmount: 1300000.00,
    totalReceived: 1000000.00,
    department: '数据研发中心',
    manager: '孙磊',
    orderId: 'ORD-2023-9010',
    orderStatus: '已支付',
    orderDate: '2023-11-05'
  },
  {
    id: 'PJ-2023-007',
    clientUnit: '中石化集团总部',
    projectName: '高寒管道无人机监控系统',
    orderAmount: 2900000.00,
    purchaseAmount: 1950000.00,
    totalReceived: 1500000.00,
    department: '安防事业部',
    manager: '张伟',
    orderId: 'ORD-2023-9011',
    orderStatus: '已发货',
    orderDate: '2023-11-02'
  },
  {
    id: 'PJ-2023-015',
    clientUnit: '顺丰科技有限公司',
    projectName: '智慧分拣中心AI算力服务器',
    orderAmount: 1550000.00,
    purchaseAmount: 1200000.00,
    totalReceived: 1550000.00,
    department: 'IT基础设施部',
    manager: '孙磊',
    orderId: 'ORD-2023-9012',
    orderStatus: '已完成',
    orderDate: '2023-10-28'
  }
];

// Initial Order Records
export const initialOrderRecords: OrderRecord[] = [
  {
    projectId: 'PJ-2023-001',
    orderId: 'ORD-2023-9001',
    orderDate: '2023-11-24',
    goodsName: '企业云架构规划',
    quantity: '1 套',
    orderValue: 128000.00,
    deliveredQty: 1,
    businessType: '咨询服务',
    clientUnit: '中核集团有限公司'
  },
  {
    projectId: 'PJ-2023-002',
    orderId: 'ORD-2023-9002',
    orderDate: '2023-11-25',
    goodsName: 'ERP系统升级',
    quantity: '5 节点',
    orderValue: 45500.00,
    deliveredQty: 3,
    businessType: '软件开发',
    clientUnit: '华东区电力集团'
  },
  {
    projectId: 'PJ-2023-003',
    orderId: 'ORD-2023-9003',
    orderDate: '2023-11-26',
    goodsName: '数据安全审计服务',
    quantity: '1 项',
    orderValue: 32000.00,
    deliveredQty: 0,
    businessType: '审计服务',
    clientUnit: '南方航空信息中心'
  },
  {
    projectId: 'PJ-2023-004',
    orderId: 'ORD-2023-9004',
    orderDate: '2023-11-27',
    goodsName: '智能客服系统部署',
    quantity: '1 套',
    orderValue: 88000.00,
    deliveredQty: 1,
    businessType: '系统集成',
    clientUnit: '招商银行信用卡中心'
  },
  {
    projectId: 'PJ-2023-005',
    orderId: 'ORD-2023-9005',
    orderDate: '2023-11-28',
    goodsName: '云原生架构咨询',
    quantity: '3 人月',
    orderValue: 150000.00,
    deliveredQty: 2,
    businessType: '咨询服务',
    clientUnit: '腾讯科技(深圳)有限公司'
  },
  {
    projectId: 'PJ-2023-006',
    orderId: 'ORD-2023-9006',
    orderDate: '2023-11-29',
    goodsName: '工厂仿真模型验证',
    quantity: '2 套',
    orderValue: 95000.00,
    deliveredQty: 2,
    businessType: '软件开发',
    clientUnit: '比亚源汽车'
  },
  {
    projectId: 'PJ-2023-007',
    orderId: 'ORD-2023-9007',
    orderDate: '2023-11-30',
    goodsName: '管道监测雷达备件',
    quantity: '12 个',
    orderValue: 240000.00,
    deliveredQty: 10,
    businessType: '系统集成',
    clientUnit: '中石化集团总部'
  },
  {
    projectId: 'PJ-2023-015',
    orderId: 'ORD-2023-9012',
    orderDate: '2023-10-28',
    goodsName: 'AI算力GPU主机',
    quantity: '4 台',
    orderValue: 640000.00,
    deliveredQty: 4,
    businessType: '系统集成',
    clientUnit: '顺丰科技有限公司'
  }
];

// Initial Purchase Records
export const initialPurchaseRecords: PurchaseRecord[] = [
  {
    projectId: 'PJ-2023-001',
    orderId: 'ORD-88291',
    manager: '张伟',
    department: 'IT基础设施部',
    contractNo: 'CON-9920',
    contractAmount: 150000.00,
    invoiceAmount: 120000.00,
    paymentAmount: 80000.00,
    supplier: '联想服务'
  },
  {
    projectId: 'PJ-2023-002',
    orderId: 'ORD-88292',
    manager: '李娜',
    department: '安防事业部',
    contractNo: 'CON-9921',
    contractAmount: 210000.00,
    invoiceAmount: 180000.00,
    paymentAmount: 150000.00,
    supplier: '微软中国'
  },
  {
    projectId: 'PJ-2023-003',
    orderId: 'ORD-88293',
    manager: '王强',
    department: '数据研发中心',
    contractNo: 'CON-9922',
    contractAmount: 45000.00,
    invoiceAmount: 45000.00,
    paymentAmount: 45000.00,
    supplier: '顺丰速递'
  },
  {
    projectId: 'PJ-2023-004',
    orderId: 'ORD-88294',
    manager: '赵敏',
    department: 'IT基础设施部',
    contractNo: 'CON-9923',
    contractAmount: 320000.00,
    invoiceAmount: 100000.00,
    paymentAmount: 0.00,
    supplier: '神州数码'
  },
  {
    projectId: 'PJ-2023-005',
    orderId: 'ORD-88295',
    manager: '孙磊',
    department: '数据研发中心',
    contractNo: 'CON-9924',
    contractAmount: 88000.00,
    invoiceAmount: 88000.00,
    paymentAmount: 88000.00,
    supplier: '阿里云'
  }
];

// Initial Sales Records
export const initialSalesRecords: SalesRecord[] = [
  {
    projectId: 'PJ-2023-001',
    orderId: 'SO-20231024-001',
    manager: '张伟',
    department: 'IT基础设施部',
    contractNo: 'CONT-A-102',
    contractDate: '2023-10-15',
    contractValue: 1200000.00,
    invoiceAmount: 800000.00
  },
  {
    projectId: 'PJ-2023-005',
    orderId: 'SO-20231102-045',
    manager: '李娜',
    department: '安防事业部',
    contractNo: 'CONT-B-405',
    contractDate: '2023-11-01',
    contractValue: 450000.00,
    invoiceAmount: 0.00
  },
  {
    projectId: 'PJ-2023-012',
    orderId: 'SO-20231115-088',
    manager: '王强',
    department: '数据研发中心',
    contractNo: 'CONT-C-990',
    contractDate: '2023-11-10',
    contractValue: 3500000.00,
    invoiceAmount: 3500000.00
  },
  {
    projectId: 'PJ-2023-018',
    orderId: 'SO-20231201-112',
    manager: '赵敏',
    department: 'IT基础设施部',
    contractNo: 'CONT-D-154',
    contractDate: '2023-11-28',
    contractValue: 880000.00,
    invoiceAmount: 400000.00
  },
  {
    projectId: 'PJ-2024-002',
    orderId: 'SO-20240105-003',
    manager: '孙亮',
    department: '数据研发中心',
    contractNo: 'CONT-E-321',
    contractDate: '2024-01-02',
    contractValue: 2100000.00,
    invoiceAmount: 0.00
  }
];

// Operation Logs (Initial set for dashboards + system settings log list)
export const initialOperationLogs: OperationLog[] = [
  {
    id: 'log-1',
    user: '张伟 (管理员)',
    module: '系统设置',
    details: '修改了全局SMTP服务器配置',
    status: '成功',
    time: '2023-11-24 14:20:05'
  },
  {
    id: 'log-2',
    user: '李明 (开发)',
    module: '项目管理',
    details: '批量导入了 150 条新客户数据',
    status: '成功',
    time: '2023-11-24 11:45:12'
  },
  {
    id: 'log-3',
    user: '王芳 (管理员)',
    module: '安全审计',
    details: '导出了上周登录异常报告',
    status: '成功',
    time: '2023-11-24 10:15:30'
  },
  {
    id: 'log-4',
    user: '赵强 (开发)',
    module: '数据库',
    details: '优化了订单查询索引',
    status: '成功',
    time: '2023-11-24 09:30:00'
  },
  {
    id: 'log-5',
    user: '张伟 (管理员)',
    module: '系统设置',
    details: '更新了系统维护公告内容',
    status: '成功',
    time: '2023-11-24 08:45:12'
  },
  {
    id: 'log-6',
    user: '李娜 (运营)',
    module: '合同管理',
    details: '审核通过了 "PJ-2023-012" 的销售合同',
    status: '成功',
    time: '2023-11-23 17:15:00'
  },
  {
    id: 'log-7',
    user: '张伟 (管理员)',
    module: '安全管理',
    details: '重置了用户 "ID_8829" 的访问权限',
    status: '成功',
    time: '2023-11-23 16:05:33'
  },
  {
    id: 'log-8',
    user: '王芳 (运维)',
    module: '系统维护',
    details: '执行了数据库手动冷备份',
    status: '成功',
    time: '2023-11-23 23:10:44'
  },
  {
    id: 'log-9',
    user: '赵强 (开发)',
    module: '报表系统',
    details: '生成了10月份企业收益台账总表',
    status: '成功',
    time: '2023-11-22 11:00:22'
  },
  {
    id: 'log-10',
    user: '李明 (开发)',
    module: '权限系统',
    details: '移除了离职人员的账号授权',
    status: '成功',
    time: '2023-11-21 09:20:15'
  }
];

// Backup info for System management
export const initialBackups: BackupInfo[] = [
  {
    id: 'bk-1',
    fileName: 'db_backup_20231124_0200.sql.gz',
    size: '124.5 MB',
    backupTime: '2023-11-24 02:00:00'
  },
  {
    id: 'bk-2',
    fileName: 'db_backup_manual_231123.sql.gz',
    size: '122.1 MB',
    backupTime: '2023-11-23 23:10:44'
  },
  {
    id: 'bk-3',
    fileName: 'db_backup_auto_231122_0200.sql.gz',
    size: '121.8 MB',
    backupTime: '2023-11-23 02:00:00'
  },
  {
    id: 'bk-4',
    fileName: 'db_backup_auto_231121_0200.sql.gz',
    size: '120.5 MB',
    backupTime: '2023-11-22 02:00:00'
  },
  {
    id: 'bk-5',
    fileName: 'db_backup_manual_231121.sql.gz',
    size: '119.2 MB',
    backupTime: '2023-11-21 15:40:22'
  },
  {
    id: 'bk-6',
    fileName: 'db_backup_auto_231120_0200.sql.gz',
    size: '118.9 MB',
    backupTime: '2023-11-20 02:00:00'
  },
  {
    id: 'bk-7',
    fileName: 'db_backup_auto_231119_0200.sql.gz',
    size: '118.0 MB',
    backupTime: '2023-11-19 02:00:00'
  }
];
