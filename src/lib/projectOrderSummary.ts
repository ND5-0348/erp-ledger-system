import { OrderRecord, PurchaseRecord, SalesRecord } from '../types';

export interface ProjectOrderLineSummary {
  id: string;
  orderLineId?: number;
  goodsName: string;
  specModel: string;
  quantity: string;
  supplier: string;
  salesOrderAmount: number;
  purchaseAmount: number;
  deliveryValue: number;
  deliveryCost: number;
  receiptAmount: number;
  paymentAmount: number;
  invoiceAmount: number;
  receivedInvoiceAmount: number;
}

export interface ProjectOrderSummary {
  orderId: string;
  orderDate: string;
  salesOrderAmount: number;
  purchaseAmount: number;
  deliveryValue: number;
  deliveryCost: number;
  receiptAmount: number;
  paymentAmount: number;
  invoiceAmount: number;
  receivedInvoiceAmount: number;
  lines: ProjectOrderLineSummary[];
}

function addToMap<T>(map: Map<number, T[]>, id: number | undefined, item: T) {
  if (id === undefined) return;
  const current = map.get(id) || [];
  current.push(item);
  map.set(id, current);
}

function sumBy<T>(items: T[], getValue: (item: T) => number | undefined) {
  return items.reduce((total, item) => total + Number(getValue(item) || 0), 0);
}

export function buildProjectOrderSummaries(
  orders: OrderRecord[],
  purchases: PurchaseRecord[],
  sales: SalesRecord[],
) {
  const purchasesByLineId = new Map<number, PurchaseRecord[]>();
  const salesByLineId = new Map<number, SalesRecord[]>();
  purchases.forEach((item) => addToMap(purchasesByLineId, item.orderLineId, item));
  sales.forEach((item) => addToMap(salesByLineId, item.orderLineId, item));

  const summaries = new Map<string, ProjectOrderSummary>();

  orders.forEach((order, index) => {
    const relatedPurchases = order.orderLineId === undefined ? [] : purchasesByLineId.get(order.orderLineId) || [];
    const relatedSales = order.orderLineId === undefined ? [] : salesByLineId.get(order.orderLineId) || [];
    const line: ProjectOrderLineSummary = {
      id: String(order.orderLineId ?? `${order.projectId}:${order.orderId}:${index}`),
      orderLineId: order.orderLineId,
      goodsName: order.goodsName || '-',
      specModel: order.specModel || '-',
      quantity: order.quantity || '-',
      supplier: order.supplierName || relatedPurchases.find((item) => item.supplier)?.supplier || '-',
      salesOrderAmount: Number(order.orderValue || 0),
      purchaseAmount: Number(order.purchaseAmount || 0),
      deliveryValue: Number(order.deliveryValue || 0),
      deliveryCost: Number(order.deliveryCost || 0),
      receiptAmount: sumBy(relatedSales, (item) => item.totalReceived),
      paymentAmount: sumBy(relatedPurchases, (item) => item.paymentAmount),
      invoiceAmount: sumBy(relatedSales, (item) => item.invoiceAmount),
      receivedInvoiceAmount: sumBy(relatedPurchases, (item) => item.invoiceAmount),
    };
    const summary = summaries.get(order.orderId) || {
      orderId: order.orderId,
      orderDate: order.orderDate || '-',
      salesOrderAmount: 0,
      purchaseAmount: 0,
      deliveryValue: 0,
      deliveryCost: 0,
      receiptAmount: 0,
      paymentAmount: 0,
      invoiceAmount: 0,
      receivedInvoiceAmount: 0,
      lines: [],
    };

    summary.salesOrderAmount += line.salesOrderAmount;
    summary.purchaseAmount += line.purchaseAmount;
    summary.deliveryValue += line.deliveryValue;
    summary.deliveryCost += line.deliveryCost;
    summary.receiptAmount += line.receiptAmount;
    summary.paymentAmount += line.paymentAmount;
    summary.invoiceAmount += line.invoiceAmount;
    summary.receivedInvoiceAmount += line.receivedInvoiceAmount;
    summary.lines.push(line);
    summaries.set(order.orderId, summary);
  });

  return Array.from(summaries.values());
}
