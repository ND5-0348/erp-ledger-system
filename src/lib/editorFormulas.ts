import Decimal from 'decimal.js';
import { BackendBatchEditorRow, BatchEditorValue } from '../api';
import { calculateTaxAmounts } from './orderAmounts';

const FinancialDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

// Column positions are shared by the 92-column workbook and all three editors.
export function recalculateEditorRows(previous: BackendBatchEditorRow[], next: BackendBatchEditorRow[]) {
  return next.map((row, index) => {
    const old = previous.find((item) => row.order_line_id && item.order_line_id === row.order_line_id)?.values
      ?? previous[index]?.values ?? [];
    if (row.values === old) return row;
    const values = [...row.values];
    const changed = (cols: number[]) => cols.some((col) => String(values[col - 1] ?? '') !== String(old[col - 1] ?? ''));
    const set = (col: number, value: BatchEditorValue) => { values[col - 1] = value; };
    const d = (col: number, source = values) => new FinancialDecimal(source[col - 1] || 0);
    const money = (value: Decimal.Value): number | string => {
      const rounded = new FinancialDecimal(value).toDecimalPlaces(2, FinancialDecimal.ROUND_HALF_UP);
      return rounded.abs().lt('1000000000000') ? rounded.toNumber() : rounded.toFixed(2);
    };
    const quantity = (value: Decimal.Value): number | string => {
      const rounded = new FinancialDecimal(value).toDecimalPlaces(6, FinancialDecimal.ROUND_HALF_UP);
      return rounded.abs().lt('1000000000') ? rounded.toNumber() : rounded.toFixed(6);
    };
    const ratio = (part: Decimal.Value, whole: Decimal.Value) => {
      const rounded = new FinancialDecimal(part).div(whole).times(100).toDecimalPlaces(6, FinancialDecimal.ROUND_HALF_UP);
      return rounded.abs().lt('1000000000') ? rounded.toNumber() : rounded.toFixed(6);
    };
    const updatePrice = (rate: number, net: number, gross: number, netAmount: number, amount: number) => {
      if (!changed([18, rate, net, gross])) return;
      const grossDrives = changed([gross]) && !changed([net]) && values[rate - 1] != null && values[rate - 1] !== '';
      const result = calculateTaxAmounts({ quantity: values[17], taxRate: values[rate - 1],
        unitPriceNoTax: grossDrives ? null : values[net - 1], unitPrice: values[gross - 1] });
      set(net, result.unitPriceNoTax ?? null);
      set(gross, result.unitPrice ?? null);
      set(netAmount, result.amountNoTax ?? null);
      set(amount, result.amount ?? null);
    };
    updatePrice(19, 20, 21, 22, 23);
    updatePrice(25, 26, 27, 28, 29);
    if (changed([18, 20, 21, 26, 27, 31])) {
      if (values[30] != null && values[30] !== '') {
        for (const [amount, unit] of [[32, 20], [33, 21], [34, 26], [35, 27]]) {
          set(amount, values[unit - 1] == null || values[unit - 1] === '' ? null : money(d(31).times(d(unit))));
        }
        set(36, quantity(d(18).minus(d(31))));
        set(37, money(d(22).minus(d(32))));
        set(38, money(d(23).minus(d(33))));
      }
    }
    if (changed([29, 42])) {
      const signedTotal = d(29, old).minus(d(43, old)).plus(d(42)).minus(d(42, old));
      set(43, money(d(29).minus(signedTotal)));
    }
    if (changed([23, 33, 76, 81, 85])) {
      // Reconstruct cumulative invoice totals from the authoritative balance;
      // phases beyond those visible in the workbook remain in the denominator.
      const invoiced = money(d(23, old).minus(d(77, old)).plus(d(76)).minus(d(76, old)));
      set(77, money(d(23).minus(invoiced)));
      set(78, money(d(33).minus(invoiced)));
      set(82, new FinancialDecimal(invoiced).isZero() ? null : ratio(d(81), invoiced));
      set(86, new FinancialDecimal(invoiced).isZero() ? null : ratio(d(85), invoiced));
      set(87, money(d(87, old).plus(d(81)).minus(d(81, old)).plus(d(85)).minus(d(85, old))));
      set(88, money(d(33).minus(d(87))));
      set(89, money(new FinancialDecimal(invoiced).minus(d(87))));
    }
    return { ...row, values };
  });
}
