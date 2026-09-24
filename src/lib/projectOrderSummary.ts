import { OrderRecord, PurchaseRecord, SalesRecord } from '../types';
import { differenceMoney, moneyString, sumMoney } from './money';

export interface ProjectOrderLineSummary {
  id: string;
  orderLineId?: number;
  goodsName: string;
  specModel: string;
  quantity: string;
  supplier: string;
  salesOrderAmount: string;
  purchaseAmount: string;
  deliveryValue: string;
  deliveryCost: string;
  receiptAmount: string;
  paymentAmount: string;
  invoiceAmount: string;
  receivedInvoiceAmount: string;
  deliveryAccountsReceivable: string;
  invoiceAccountsReceivable: string;
}

export interface ProjectOrderSummary {
  orderId: string;
  orderDate: string;
  salesOrderAmount: string;
  purchaseAmount: string;
  deliveryValue: string;
  deliveryCost: string;
  receiptAmount: string;
  paymentAmount: string;
  invoiceAmount: string;
  receivedInvoiceAmount: string;
  deliveryAccountsReceivable: string;
  invoiceAccountsReceivable: string;
  lines: ProjectOrderLineSummary[];
}

function addToMap<T>(map: Map<number, T[]>, id: number | undefined, item: T) {
  if (id === undefined) return;
  const current = map.get(id) || [];
  current.push(item);
  map.set(id, current);
}

function sumBy<T>(items: T[], getValue: (item: T) => string | number | undefined) {
  return sumMoney(...items.map(getValue));
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
      salesOrderAmount: moneyString(order.orderValue),
      purchaseAmount: moneyString(order.purchaseAmount),
      deliveryValue: moneyString(order.deliveryValue),
      deliveryCost: moneyString(order.deliveryCost),
      receiptAmount: sumBy(relatedSales, (item) => item.totalReceived),
      paymentAmount: sumBy(relatedPurchases, (item) => item.paymentAmount),
      invoiceAmount: sumBy(relatedSales, (item) => item.invoiceAmount),
      receivedInvoiceAmount: sumBy(relatedPurchases, (item) => item.invoiceAmount),
      deliveryAccountsReceivable: moneyString(order.deliveryAccountsReceivable ?? differenceMoney(order.deliveryValue, order.totalReceived)),
      invoiceAccountsReceivable: moneyString(order.invoiceAccountsReceivable ?? sumBy(relatedSales, (item) => item.invoiceAccountsReceivable)),
    };
    const summary = summaries.get(order.orderId) || {
      orderId: order.orderId,
      orderDate: order.orderDate || '-',
      salesOrderAmount: '0.00',
      purchaseAmount: '0.00',
      deliveryValue: '0.00',
      deliveryCost: '0.00',
      receiptAmount: '0.00',
      paymentAmount: '0.00',
      invoiceAmount: '0.00',
      receivedInvoiceAmount: '0.00',
      deliveryAccountsReceivable: '0.00',
      invoiceAccountsReceivable: '0.00',
      lines: [],
    };

    summary.salesOrderAmount = sumMoney(summary.salesOrderAmount, line.salesOrderAmount);
    summary.purchaseAmount = sumMoney(summary.purchaseAmount, line.purchaseAmount);
    summary.deliveryValue = sumMoney(summary.deliveryValue, line.deliveryValue);
    summary.deliveryCost = sumMoney(summary.deliveryCost, line.deliveryCost);
    summary.receiptAmount = sumMoney(summary.receiptAmount, line.receiptAmount);
    summary.paymentAmount = sumMoney(summary.paymentAmount, line.paymentAmount);
    summary.invoiceAmount = sumMoney(summary.invoiceAmount, line.invoiceAmount);
    summary.receivedInvoiceAmount = sumMoney(summary.receivedInvoiceAmount, line.receivedInvoiceAmount);
    summary.deliveryAccountsReceivable = sumMoney(summary.deliveryAccountsReceivable, line.deliveryAccountsReceivable);
    summary.invoiceAccountsReceivable = sumMoney(summary.invoiceAccountsReceivable, line.invoiceAccountsReceivable);
    summary.lines.push(line);
    summaries.set(order.orderId, summary);
  });

  return Array.from(summaries.values());
}
