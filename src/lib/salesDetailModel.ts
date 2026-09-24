import { isClosedStatus } from './ledgerStats';
import { compareMoney, decimalMoney, differenceMoney, moneyString, sumMoney, type MoneyValue } from './money';
type ReceiptLike = { phase_no?: number | null };

type SalesDraftSource = {
  contractValue: MoneyValue;
  invoiceAmount: MoneyValue;
};

type SalesOrderRow = Record<string, string | number | null | undefined>;

type LedgerLike = {
  orderAmount: MoneyValue;
  purchaseAmount: MoneyValue;
  totalReceived: MoneyValue;
  deliveryAccountsReceivable?: MoneyValue;
  invoiceAccountsReceivable?: MoneyValue;
  deliveryValue?: MoneyValue;
  salesInvoiceAmount?: MoneyValue;
};

type DetailOrderLike = {
  projectId: string;
  orderId: string;
  goodsName: string;
  orderValue: MoneyValue;
};

type DetailPurchaseLike = {
  orderLineId?: number;
  projectId: string;
  orderId: string;
  contractNo: string;
  supplier: string;
  contractAmount: MoneyValue;
  invoiceAmount: MoneyValue;
  paymentAmount: MoneyValue;
};

type DetailSaleLike = {
  orderLineId?: number;
  projectId: string;
  orderId: string;
  contractNo: string;
  contractDate: string;
  contractValue: MoneyValue;
  totalReceived?: MoneyValue;
  accountsReceivable?: MoneyValue;
  deliveryAccountsReceivable?: MoneyValue;
  invoiceAccountsReceivable?: MoneyValue;
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
  'delivery_accounts_receivable',
  'invoice_accounts_receivable',
  'gross_profit',
];

export function getNextReceiptPhase(receipts: ReceiptLike[]) {
  return receipts.length + 1;
}

export function buildSalesInvoiceDraft(source: SalesDraftSource) {
  const pendingAmount = compareMoney(source.contractValue, source.invoiceAmount) > 0
    ? differenceMoney(source.contractValue, source.invoiceAmount) : '0.00';
  return {
    invoice_doc_no: '',
    invoice_date: '',
    invoice_no: '',
    invoice_amount: moneyString(source.invoiceAmount),
    pending_invoice_amount: pendingAmount,
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
      aggregate[key] = sumMoney(...rows.map(row => row[key]));
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
  if (isClosedStatus(status)) {
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
    accountsPayable: moneyString(ledger.purchaseAmount),
    deliveryAccountsReceivable: moneyString(ledger.deliveryAccountsReceivable ?? differenceMoney(ledger.deliveryValue, ledger.totalReceived)),
    invoiceAccountsReceivable: moneyString(ledger.invoiceAccountsReceivable ?? differenceMoney(ledger.salesInvoiceAmount, ledger.totalReceived)),
    paidAmount: sumMoney(...purchases.map(item => item.paymentAmount)),
    accountsReceivable:
      sales.length > 0
        ? sumMoney(...sales.map(item => item.accountsReceivable))
        : compareMoney(ledger.orderAmount, ledger.totalReceived) > 0 ? differenceMoney(ledger.orderAmount, ledger.totalReceived) : '0.00',
    receivedAmount:
      sales.length > 0
        ? sumMoney(...sales.map(item => item.totalReceived))
        : moneyString(ledger.totalReceived),
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
      purchaseContractAmount: moneyString(purchase?.contractAmount),
      salesContractNo: sale?.contractNo || '-',
      salesContractDate: sale?.contractDate || '-',
      salesContractValue: moneyString(sale?.contractValue),
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
    const purchasePayableBase = moneyString(purchase?.contractAmount || purchase?.invoiceAmount);
    const purchasePaymentAmount = moneyString(purchase?.paymentAmount);
    const receiptAmount = moneyString(sale?.totalReceived);
    const accountsReceivable = moneyString(sale?.accountsReceivable ??
      (compareMoney(order.orderValue, receiptAmount) > 0 ? differenceMoney(order.orderValue, receiptAmount) : '0.00'));
    const grossProfit = differenceMoney(order.orderValue, purchasePayableBase);
    const grossProfitRate = compareMoney(order.orderValue, 0) !== 0 ? decimalMoney(grossProfit).div(order.orderValue).times(100).toNumber() : 0;

    return {
      orderId: order.orderId,
      goodsName: order.goodsName,
      purchasePaymentAmount,
      accountsPayable: compareMoney(purchasePayableBase, purchasePaymentAmount) > 0 ? differenceMoney(purchasePayableBase, purchasePaymentAmount) : '0.00',
      salesReceiptDate: '-',
      receiptAmount,
      receiptRatio: compareMoney(order.orderValue, 0) !== 0 ? decimalMoney(receiptAmount).div(order.orderValue).times(100).toNumber() : 0,
      accountsReceivable,
      grossProfit,
      grossProfitRate,
    };
  });
}
