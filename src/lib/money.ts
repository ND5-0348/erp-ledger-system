import Decimal from 'decimal.js';

export type MoneyValue = string | number;

const FinancialDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export function rawAmount(value: MoneyValue | null | undefined): string {
  return value === null || value === undefined ? '0' : String(value);
}

export function optionalAmount(value: MoneyValue | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function decimalMoney(value: MoneyValue | null | undefined): Decimal {
  return new FinancialDecimal(value ?? 0);
}

export function moneyString(value: MoneyValue | null | undefined): string {
  return decimalMoney(value).toFixed(2);
}

export function sumMoney(...values: Array<MoneyValue | null | undefined>): string {
  return values.reduce<Decimal>((total, value) => total.plus(decimalMoney(value)), new FinancialDecimal(0)).toFixed(2);
}

export function differenceMoney(value: MoneyValue | null | undefined, ...subtract: Array<MoneyValue | null | undefined>): string {
  return subtract.reduce<Decimal>((total, item) => total.minus(decimalMoney(item)), decimalMoney(value)).toFixed(2);
}

export function compareMoney(left: MoneyValue | null | undefined, right: MoneyValue | null | undefined): number {
  return decimalMoney(left).comparedTo(decimalMoney(right));
}

export function formatMoney(value: MoneyValue | null | undefined, digits = 2): string {
  const fixed = decimalMoney(value).toFixed(digits);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

// Charts and ratios may use approximate positions; monetary labels and writes must not.
export function approximateMoney(value: MoneyValue | null | undefined): number {
  return decimalMoney(value).toNumber();
}
