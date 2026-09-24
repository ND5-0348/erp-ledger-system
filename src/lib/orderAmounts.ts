import Decimal from 'decimal.js';
import type { MoneyValue } from './money';

export interface TaxAmountInput {
  quantity: number | string | null | undefined;
  taxRate: number | string | null | undefined;
  unitPriceNoTax: number | string | null | undefined;
  unitPrice?: number | string | null | undefined;
}

export interface TaxAmountResult {
  taxRate?: number;
  unitPriceNoTax?: MoneyValue;
  unitPrice?: MoneyValue;
  amountNoTax?: MoneyValue;
  amount?: MoneyValue;
  taxAmount?: MoneyValue;
}

const FinancialDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

function optionalDecimal(value: TaxAmountInput[keyof TaxAmountInput]) {
  if (value === null || value === undefined || value === '') return undefined;
  try {
    const parsed = new FinancialDecimal(value);
    return parsed.isFinite() ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function round(value: Decimal, digits: number) {
  return value.toDecimalPlaces(digits, FinancialDecimal.ROUND_HALF_UP);
}

function safeResult(value: Decimal | undefined, digits: number): MoneyValue | undefined {
  if (value === undefined) return undefined;
  // Numeric output remains convenient for ordinary values. Above this bound,
  // keep the decimal text so JSON and input controls retain every digit.
  return value.abs().lt(digits === 6 ? '1000000000' : '1000000000000')
    ? value.toNumber() : value.toFixed(digits);
}

export function calculateTaxAmounts(input: TaxAmountInput): TaxAmountResult {
  const quantity = optionalDecimal(input.quantity);
  const taxRate = optionalDecimal(input.taxRate);
  let unitPriceNoTax = optionalDecimal(input.unitPriceNoTax);
  let unitPrice = optionalDecimal(input.unitPrice);

  if (unitPriceNoTax === undefined && unitPrice !== undefined && taxRate !== undefined) {
    unitPriceNoTax = round(unitPrice.div(taxRate.div(100).plus(1)), 6);
  }
  if (unitPriceNoTax !== undefined && taxRate !== undefined && (input.unitPriceNoTax !== '' && input.unitPriceNoTax != null)) {
    unitPrice = round(unitPriceNoTax.times(taxRate.div(100).plus(1)), 6);
  }
  const amountNoTax = quantity === undefined || unitPriceNoTax === undefined
    ? undefined
    : round(quantity.times(unitPriceNoTax), 2);
  const amount = quantity === undefined || unitPrice === undefined
    ? undefined
    : round(quantity.times(unitPrice), 2);

  return {
    taxRate: taxRate?.toNumber(),
    unitPriceNoTax: safeResult(unitPriceNoTax, 6),
    unitPrice: safeResult(unitPrice, 6),
    amountNoTax: safeResult(amountNoTax, 2),
    amount: safeResult(amount, 2),
    taxAmount: safeResult(amount === undefined || amountNoTax === undefined ? undefined : round(amount.minus(amountNoTax), 2), 2),
  };
}

export function editableNumber(value: MoneyValue | undefined, digits = 6) {
  if (value === undefined) return '';
  return new FinancialDecimal(value).toDecimalPlaces(digits, FinancialDecimal.ROUND_HALF_UP).toString();
}
