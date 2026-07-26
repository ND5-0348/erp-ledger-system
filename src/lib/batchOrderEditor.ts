import { BackendBatchEditorColumn, BatchEditorValue } from '../api';

export const BASIC_INFORMATION_END_COLUMN = 'W';

export function createBlankEditorRow(columns: BackendBatchEditorColumn[]): BatchEditorValue[] {
  return columns.map((column) => (column.excel_column === 'A' ? '全额' : null));
}

export function pasteGrid(
  rows: BatchEditorValue[][],
  text: string,
  startRow: number,
  startColumn: number,
  columns: BackendBatchEditorColumn[],
  allowAddRows: boolean,
): BatchEditorValue[][] {
  const pastedRows = text.replace(/\r/g, '').split('\n').filter((row, index, all) => row || index < all.length - 1);
  const next = rows.map((row) => [...row]);
  pastedRows.forEach((line, rowOffset) => {
    const targetRow = startRow + rowOffset;
    while (allowAddRows && targetRow >= next.length) {
      next.push(createBlankEditorRow(columns));
    }
    if (targetRow >= next.length) return;
    line.split('\t').forEach((value, columnOffset) => {
      const targetColumn = startColumn + columnOffset;
      if (targetColumn >= columns.length || !columns[targetColumn].editable) return;
      next[targetRow][targetColumn] = value;
    });
  });
  return next;
}

export function buildBasicInformationPayload(
  columns: BackendBatchEditorColumn[],
  values: BatchEditorValue[],
): Record<string, string | number | null> {
  return buildEditablePayload(columns, values);
}

export function buildPurchaseInformationPayload(
  columns: BackendBatchEditorColumn[],
  values: BatchEditorValue[],
): Record<string, string | number | null> {
  return buildEditablePayload(columns, values);
}

export function buildSalesInformationPayload(
  columns: BackendBatchEditorColumn[],
  values: BatchEditorValue[],
): Record<string, string | number | null> {
  return buildEditablePayload(columns, values);
}

function buildEditablePayload(
  columns: BackendBatchEditorColumn[],
  values: BatchEditorValue[],
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {};
  columns.forEach((column, index) => {
    if (!column.editable || !column.key) return;
    const raw = values[index];
    if (column.required && String(raw ?? '').trim() === '') {
      throw new Error(`${column.excel_column}列“${column.label}”为必填项`);
    }
    payload[column.key] = normalizeEditorValue(column, raw);
  });
  return payload;
}

export function normalizeEditorValue(
  column: BackendBatchEditorColumn,
  value: BatchEditorValue,
): string | number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (column.value_type === 'number' || column.value_type === 'percentage') {
    const normalized = String(value).replace(/[,\s¥￥]/g, '').replace(/%$/, '');
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${column.excel_column}列“${column.label}”必须是有效数字`);
    }
    // Keep the original decimal text so 18-digit amounts do not lose precision
    // when they are serialized through JavaScript.
    return normalized;
  }
  if (column.value_type === 'date') {
    const normalized = String(value).trim().replace(/\//g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) {
      throw new Error(`${column.excel_column}列“${column.label}”日期格式应为 YYYY-MM-DD`);
    }
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return String(value).trim();
}
