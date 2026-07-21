export interface TaxAmountInput {
  quantity: number | string | null | undefined;
  taxRate: number | string | null | undefined;
  unitPriceNoTax: number | string | null | undefined;
  unitPrice?: number | string | null | undefined;
}

export interface TaxAmountResult {
  taxRate?: number;
  unitPriceNoTax?: number;
  unitPrice?: number;
  amountNoTax?: number;
  amount?: number;
  taxAmount?: number;
}

function optionalNumber(value: TaxAmountInput[keyof TaxAmountInput]) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateTaxAmounts(input: TaxAmountInput): TaxAmountResult {
  const quantity = optionalNumber(input.quantity);
  const taxRate = optionalNumber(input.taxRate);
  const unitPriceNoTax = optionalNumber(input.unitPriceNoTax);
  let unitPrice = optionalNumber(input.unitPrice);

  if (unitPriceNoTax !== undefined && taxRate !== undefined) {
    unitPrice = round(unitPriceNoTax * (1 + taxRate / 100), 6);
  }
  const amountNoTax = quantity === undefined || unitPriceNoTax === undefined
    ? undefined
    : round(quantity * unitPriceNoTax, 2);
  const amount = quantity === undefined || unitPrice === undefined
    ? undefined
    : round(quantity * unitPrice, 2);

  return {
    taxRate,
    unitPriceNoTax,
    unitPrice,
    amountNoTax,
    amount,
    taxAmount: amount === undefined || amountNoTax === undefined ? undefined : round(amount - amountNoTax, 2),
  };
}

export function editableNumber(value: number | undefined, digits = 6) {
  if (value === undefined) return '';
  return String(Number(value.toFixed(digits)));
}
