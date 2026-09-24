export interface ImportTotals {
  line_count: number; project_count: number; order_count: number;
  order_amount: string; delivery_amount: string; invoice_amount: string; receipt_amount: string;
}
export interface SourceImportResult {
  preview: boolean; batch_id: number | null; success_rows: number; source_sha256: string; layout: string;
  summary: ImportTotals; warnings: { row: number; field: string; message: string }[];
  duplicates: { count: number; within_file_rows: number; confirmation_token: string | null;
    rows: { row: number; project_code: string; order_no: string; goods_name: string; order_amount: string; manager: string;
      match_count: number; matches: { order_line_id: number; excel_row_no: number; import_batch_id: number; source_file_name: string; account_manager: string; order_value: string }[] }[] };
}
export interface ImportBatch {
  id: number; source_file_name: string; uploaded_at: string; success_rows: number; status: string;
  imported_by_name: string | null; backup_file: string | null; pre_import_backup_id: number | null;
  summary: ImportTotals; summary_is_current: boolean; layout: string | null;
}
export interface ImportBatchDetail extends ImportBatch {
  warnings: SourceImportResult['warnings'];
  undo: { can_revert: boolean; reasons: string[]; token: string | null; line_count: number; message: string };
}
export function moneyText(value: string | number | null | undefined): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(String(value ?? '0'));
  if (!match) return '—';
  const [, sign, integer, fraction = ''] = match;
  // Round decimal strings using the same half-up rule as imported amounts.
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2)) + (Number(fraction[2] || '0') >= 5 ? 1n : 0n);
  const rounded = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents === 0n ? '' : sign}${rounded}.${(cents % 100n).toString().padStart(2, '0')}`;
}
