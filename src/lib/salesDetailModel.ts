type ReceiptLike = { phase_no?: number | null };

type SalesDraftSource = {
  contractValue: number;
  invoiceAmount: number;
};

type SalesOrderRow = Record<string, string | number | null | undefined>;

type LedgerLike = {
  orderAmount: number;
  purchaseAmount: number;
  totalReceived: number;
};

type DetailOrderLike = {
  projectId: string;
  orderId: string;
  goodsName: string;
  orderValue: number;
};

type DetailPurchaseLike = {
  orderLineId?: number;
  projectId: string;
  orderId: string;
  contractNo: string;
  supplier: string;
  contractAmount: number;
  invoiceAmount: number;
  paymentAmount: number;
};

type DetailSaleLike = {
  orderLineId?: number;
  projectId: string;
  orderId: string;
  contractNo: string;
  contractDate: string;
  contractValue: number;
  totalReceived?: number;
  accountsReceivable?: number;
};

const aggregateAmountKeys = [
  'order_value',
  'purchase_amount',
  'delivery_value',
  'purchase_contract_signed_amount',
  'sales_contract_value',
  'sales_invoice_amount',
  'total_received',
  'accounts_receivable',
  'gross_profit',
];

export function getNextReceiptPhase(receipts: ReceiptLike[]) {
  return receipts.length + 1;
}

export function buildSalesInvoiceDraft(source: SalesDraftSource) {
  const pendingAmount = Math.max(0, Number(source.contractValue || 0) - Number(source.invoiceAmount || 0));
  return {
    invoice_doc_no: '',
    invoice_date: '',
    invoice_no: '',
    invoice_amount: String(Number(source.invoiceAmount || 0)),
    pending_invoice_amount: String(pendingAmount),
    delivered_not_invoiced_amount: '',
  };
}

export function aggregateSalesOrderRows(rows: SalesOrderRow[]) {
  const first = rows[0] || {};
  const aggregate: SalesOrderRow = {};

  Object.entries(first).forEach(([key, value]) => {
    aggregate[key] = value;
  });

  aggregateAmountKeys
    .filter((key) => rows.some((row) => Object.prototype.hasOwnProperty.call(row, key)))
    .forEach((key) => {
      aggregate[key] = rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    });

  rows.forEach((row) => {
    Object.entries(row).forEach(([key, value]) => {
      if ((aggregate[key] === null || aggregate[key] === undefined || aggregate[key] === '') && value !== null && value !== undefined && value !== '') {
        aggregate[key] = value;
      }
    });
  });

  aggregate.matched_line_count = rows.length;
  return aggregate;
}

export function normalizeLedgerStatusLabel(status: string) {
  if (status === 'closed' || status.includes('关') || status.includes('闭') || status.includes('完成')) {
    return '已关闭';
  }
  return '进行中';
}

export function getLedgerFinanceSummary(
  ledger: LedgerLike,
  purchases: DetailPurchaseLike[],
  sales: DetailSaleLike[],
) {
  return {
    accountsPayable: Number(ledger.purchaseAmount || 0),
    paidAmount: purchases.reduce((total, item) => total + Number(item.paymentAmount || 0), 0),
    accountsReceivable:
      sales.length > 0
        ? sales.reduce((total, item) => total + Number(item.accountsReceivable || 0), 0)
        : Math.max(0, Number(ledger.orderAmount || 0) - Number(ledger.totalReceived || 0)),
    receivedAmount:
      sales.length > 0
        ? sales.reduce((total, item) => total + Number(item.totalReceived || 0), 0)
        : Number(ledger.totalReceived || 0),
  };
}

function lineKey(item: { orderLineId?: number; projectId: string; orderId: string }) {
  return item.orderLineId ? `line:${item.orderLineId}` : `order:${item.projectId}:${item.orderId}`;
}

function firstByLine<T extends { orderLineId?: number; projectId: string; orderId: string }>(items: T[]) {
  const map = new Map<string, T>();
  items.forEach((item) => {
    const key = lineKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return map;
}

export function buildLedgerContractRows(
  orders: DetailOrderLike[],
  purchases: DetailPurchaseLike[],
  sales: DetailSaleLike[],
) {
  const purchaseByLine = firstByLine(purchases);
  const saleByLine = firstByLine(sales);

  return orders.map((order) => {
    const matchingPurchase =
      purchases.find((item) => item.projectId === order.projectId && item.orderId === order.orderId) || null;
    const matchingSale = sales.find((item) => item.projectId === order.projectId && item.orderId === order.orderId) || null;
    const purchase = matchingPurchase?.orderLineId ? purchaseByLine.get(lineKey(matchingPurchase)) : matchingPurchase;
    const sale = matchingSale?.orderLineId ? saleByLine.get(lineKey(matchingSale)) : matchingSale;

    return {
      orderId: order.orderId,
      goodsName: order.goodsName,
      purchaseContractNo: purchase?.contractNo || '-',
      supplier: purchase?.supplier || '-',
      purchaseContractAmount: Number(purchase?.contractAmount || 0),
      salesContractNo: sale?.contractNo || '-',
      salesContractDate: sale?.contractDate || '-',
      salesContractValue: Number(sale?.contractValue || 0),
    };
  });
}

export function buildLedgerPaymentRows(
  orders: DetailOrderLike[],
  purchases: DetailPurchaseLike[],
  sales: DetailSaleLike[],
) {
  const purchaseByLine = firstByLine(purchases);
  const saleByLine = firstByLine(sales);

  return orders.map((order) => {
    const matchingPurchase =
      purchases.find((item) => item.projectId === order.projectId && item.orderId === order.orderId) || null;
    const matchingSale = sales.find((item) => item.projectId === order.projectId && item.orderId === order.orderId) || null;
    const purchase = matchingPurchase?.orderLineId ? purchaseByLine.get(lineKey(matchingPurchase)) : matchingPurchase;
    const sale = matchingSale?.orderLineId ? saleByLine.get(lineKey(matchingSale)) : matchingSale;
    const purchasePayableBase = Number(purchase?.contractAmount || purchase?.invoiceAmount || 0);
    const purchasePaymentAmount = Number(purchase?.paymentAmount || 0);
    const receiptAmount = Number(sale?.totalReceived || 0);
    const accountsReceivable = Number(sale?.accountsReceivable ?? Math.max(0, order.orderValue - receiptAmount));
    const grossProfit = Number(order.orderValue || 0) - purchasePayableBase;
    const grossProfitRate = order.orderValue ? (grossProfit / Number(order.orderValue)) * 100 : 0;

    return {
      orderId: order.orderId,
      goodsName: order.goodsName,
      purchasePaymentAmount,
      accountsPayable: Math.max(0, purchasePayableBase - purchasePaymentAmount),
      salesReceiptDate: '-',
      receiptAmount,
      receiptRatio: order.orderValue ? (receiptAmount / Number(order.orderValue)) * 100 : 0,
      accountsReceivable,
      grossProfit,
      grossProfitRate,
    };
  });
}
