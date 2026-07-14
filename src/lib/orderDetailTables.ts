export interface OrderDetailColumn {
  key: string;
  label: string;
  align: 'left' | 'right' | 'center';
}

export const ORDER_PURCHASE_DETAIL_COLUMNS: OrderDetailColumn[] = [
  { key: 'supplier', label: '采购厂商', align: 'left' },
  { key: 'netPurchaseUnitPrice', label: '不含税采购单价', align: 'right' },
  { key: 'purchaseUnitPrice', label: '采购单价', align: 'right' },
  { key: 'netCost', label: '不含税成本', align: 'right' },
  { key: 'purchaseAmount', label: '采购金额', align: 'right' },
  { key: 'actions', label: '操作', align: 'center' },
];

export const ORDER_DELIVERY_DETAIL_COLUMNS: OrderDetailColumn[] = [
  { key: 'deliveryDate', label: '交付日期', align: 'left' },
  { key: 'deliveredQty', label: '交付数量', align: 'right' },
  { key: 'deliveredNetRevenue', label: '交付不含税收入', align: 'right' },
  { key: 'deliveryValue', label: '交付价值', align: 'right' },
  { key: 'deliveredNetCost', label: '交付不含税成本', align: 'right' },
  { key: 'deliveryCost', label: '交付成本', align: 'right' },
  { key: 'pendingQty', label: '待交付数量', align: 'right' },
  { key: 'pendingNetAmount', label: '待交付金额（不含税）', align: 'right' },
  { key: 'pendingAmount', label: '待交付金额', align: 'right' },
  { key: 'actions', label: '操作', align: 'center' },
];

export const ORDER_DETAIL_TABLE_WIDTHS = {
  purchase: 880,
  delivery: 1220,
} as const;
