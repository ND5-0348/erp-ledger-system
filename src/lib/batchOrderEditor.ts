import { BackendBatchEditorColumn, BatchEditorValue } from '../api';

export const BASIC_INFORMATION_END_COLUMN = 'W';

export interface EditorCellPosition {
  rowIndex: number;
  columnIndex: number;
}

export type CellSelectionMode = 'replace' | 'add' | 'remove';

export function editorCellKey({ rowIndex, columnIndex }: EditorCellPosition): string {
  return `${rowIndex}:${columnIndex}`;
}

export function parseEditorCellKey(key: string): EditorCellPosition | null {
  const [rowIndex, columnIndex] = key.split(':').map(Number);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return null;
  return { rowIndex, columnIndex };
}

export function editorSelectionPositions(
  selection: ReadonlySet<string>,
): EditorCellPosition[] {
  return [...selection]
    .map(parseEditorCellKey)
    .filter((position): position is EditorCellPosition => Boolean(position))
    .sort((left, right) => (
      left.rowIndex - right.rowIndex || left.columnIndex - right.columnIndex
    ));
}

export function selectEditorCellRectangle(
  currentSelection: ReadonlySet<string>,
  start: EditorCellPosition,
  end: EditorCellPosition,
  mode: CellSelectionMode = 'replace',
): Set<string> {
  const next = mode === 'replace' ? new Set<string>() : new Set(currentSelection);
  const firstRow = Math.min(start.rowIndex, end.rowIndex);
  const lastRow = Math.max(start.rowIndex, end.rowIndex);
  const firstColumn = Math.min(start.columnIndex, end.columnIndex);
  const lastColumn = Math.max(start.columnIndex, end.columnIndex);

  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
      const key = editorCellKey({ rowIndex, columnIndex });
      if (mode === 'remove') {
        next.delete(key);
      } else {
        next.add(key);
      }
    }
  }
  return next;
}

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

export function copyEditorSelection(
  rows: BatchEditorValue[][],
  selection: ReadonlySet<string>,
  visibleColumnIndexes: number[],
): string {
  const positions = editorSelectionPositions(selection);
  if (!positions.length) return '';

  const firstRow = Math.min(...positions.map(({ rowIndex }) => rowIndex));
  const lastRow = Math.max(...positions.map(({ rowIndex }) => rowIndex));
  const firstColumn = Math.min(...positions.map(({ columnIndex }) => columnIndex));
  const lastColumn = Math.max(...positions.map(({ columnIndex }) => columnIndex));

  const lines: string[] = [];
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const cells: string[] = [];
    for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex += 1) {
      const selected = selection.has(editorCellKey({ rowIndex, columnIndex }));
      const dataColumnIndex = visibleColumnIndexes[columnIndex];
      const value = selected && dataColumnIndex !== undefined
        ? rows[rowIndex]?.[dataColumnIndex]
        : '';
      cells.push(sanitizeClipboardCell(value));
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

export function pasteGridToEditorSelection(
  rows: BatchEditorValue[][],
  text: string,
  selection: ReadonlySet<string>,
  visibleColumnIndexes: number[],
  columns: BackendBatchEditorColumn[],
  allowAddRows: boolean,
): BatchEditorValue[][] {
  const positions = editorSelectionPositions(selection);
  const clipboardRows = parseClipboardGrid(text);
  if (!positions.length || !clipboardRows.length) return rows;

  if (positions.length === 1) {
    const [{ rowIndex, columnIndex }] = positions;
    const dataColumnIndex = visibleColumnIndexes[columnIndex];
    if (dataColumnIndex === undefined) return rows;
    return pasteVisibleGrid(
      rows,
      clipboardRows,
      rowIndex,
      columnIndex,
      visibleColumnIndexes,
      columns,
      allowAddRows,
    );
  }

  const firstRow = Math.min(...positions.map(({ rowIndex }) => rowIndex));
  const firstColumn = Math.min(...positions.map(({ columnIndex }) => columnIndex));
  const next = rows.map((row) => [...row]);
  let changed = false;

  positions.forEach(({ rowIndex, columnIndex }) => {
    const dataColumnIndex = visibleColumnIndexes[columnIndex];
    const column = dataColumnIndex === undefined ? undefined : columns[dataColumnIndex];
    if (!column?.editable || !next[rowIndex]) return;

    const sourceRow = clipboardRows[(rowIndex - firstRow) % clipboardRows.length];
    const sourceValue = sourceRow[(columnIndex - firstColumn) % sourceRow.length] ?? '';
    if (next[rowIndex][dataColumnIndex] === sourceValue) return;
    next[rowIndex][dataColumnIndex] = sourceValue;
    changed = true;
  });

  return changed ? next : rows;
}

function parseClipboardGrid(text: string): string[][] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((row, index, all) => row || index < all.length - 1)
    .map((row) => row.split('\t'));
}

function pasteVisibleGrid(
  rows: BatchEditorValue[][],
  clipboardRows: string[][],
  startRow: number,
  startVisibleColumn: number,
  visibleColumnIndexes: number[],
  columns: BackendBatchEditorColumn[],
  allowAddRows: boolean,
): BatchEditorValue[][] {
  const next = rows.map((row) => [...row]);
  let changed = false;

  clipboardRows.forEach((clipboardRow, rowOffset) => {
    const targetRow = startRow + rowOffset;
    while (allowAddRows && targetRow >= next.length) {
      next.push(createBlankEditorRow(columns));
      changed = true;
    }
    if (!next[targetRow]) return;

    clipboardRow.forEach((value, columnOffset) => {
      const visibleColumnIndex = startVisibleColumn + columnOffset;
      const dataColumnIndex = visibleColumnIndexes[visibleColumnIndex];
      const column = dataColumnIndex === undefined ? undefined : columns[dataColumnIndex];
      if (!column?.editable || next[targetRow][dataColumnIndex] === value) return;
      next[targetRow][dataColumnIndex] = value;
      changed = true;
    });
  });

  return changed ? next : rows;
}

function sanitizeClipboardCell(value: BatchEditorValue): string {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
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

export function editableEditorRowsMatch(
  columns: BackendBatchEditorColumn[],
  beforeValues: BatchEditorValue[],
  afterValues: BatchEditorValue[],
): boolean {
  return columns.every((column, index) => {
    if (!column.editable || !column.key) return true;
    return comparableEditorValue(column, beforeValues[index]) === comparableEditorValue(column, afterValues[index]);
  });
}

function comparableEditorValue(
  column: BackendBatchEditorColumn,
  value: BatchEditorValue,
): string | number | null {
  try {
    const normalized = normalizeEditorValue(column, value);
    if (
      normalized !== null
      && (column.value_type === 'number' || column.value_type === 'percentage')
    ) {
      const match = String(normalized).match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
      if (match) {
        const integer = match[2].replace(/^0+(?=\d)/, '');
        const fraction = (match[3] || '').replace(/0+$/, '');
        const sign = match[1] === '-' && (integer !== '0' || fraction) ? '-' : '';
        return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
      }
    }
    return normalized;
  } catch {
    return value === null || value === undefined ? null : String(value).trim();
  }
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
