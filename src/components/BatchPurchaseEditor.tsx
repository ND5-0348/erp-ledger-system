import React, { useEffect, useMemo, useState } from 'react';
import { Eye, LoaderCircle, Save, X } from 'lucide-react';
import {
  api,
  BackendBatchEditorColumn,
  BackendBatchEditorRow,
  BatchEditorValue,
} from '../api';
import {
  buildPurchaseInformationPayload,
  buildSalesInformationPayload,
  copyEditorSelection,
  editableEditorRowsMatch,
  pasteGridToEditorSelection,
} from '../lib/batchOrderEditor';
import { useBatchEditorHistory } from '../hooks/useBatchEditorHistory';
import { useEditorColumnWidths } from '../hooks/useEditorColumnWidths';
import {
  EDITOR_ACTIVE_CELL_VISUAL_CLASS,
  EDITOR_SELECTED_CELL_VISUAL_CLASS,
  useEditorCellSelection,
} from '../hooks/useEditorCellSelection';

export interface BatchPurchaseEditorProps {
  selectedOrderLineIds: number[];
  onClose: () => void;
  onSaved: (count: number) => Promise<void> | void;
  mode?: 'purchase' | 'sales';
}

const DEFAULT_FIXED_COLUMNS = ['B', 'C', 'D', 'E', 'F', 'G', 'M', 'N', 'O'];
const ROW_NUMBER_WIDTH = 40;
const DETAIL_BUTTON_WIDTH = 64;
const FIXED_COLUMN_WIDTHS: Record<string, number> = {
  B: 90,
  C: 58,
  D: 62,
  E: 66,
  F: 78,
  G: 78,
  M: 110,
  N: 100,
  O: 100,
};

function getColumnWidth(column: BackendBatchEditorColumn) {
  if (column.value_type === 'date') return 134;
  if (column.value_type === 'text') return 164;
  return 136;
}

export default function BatchPurchaseEditor({
  selectedOrderLineIds,
  onClose,
  onSaved,
  mode = 'purchase',
}: BatchPurchaseEditorProps) {
  const [columns, setColumns] = useState<BackendBatchEditorColumn[]>([]);
  const [rows, setRows] = useState<BackendBatchEditorRow[]>([]);
  const [initialRows, setInitialRows] = useState<BackendBatchEditorRow[]>([]);
  const [fixedColumnLetters, setFixedColumnLetters] = useState(DEFAULT_FIXED_COLUMNS);
  const [showFixedColumns, setShowFixedColumns] = useState(true);
  const [detailRowIndex, setDetailRowIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedKey = selectedOrderLineIds.join(',');
  const {
    selectedCells,
    handleCellPointerDown,
    handleCellPointerEnter,
    isActiveCell,
    isCellSelected,
    isSelectingCells,
    selectedCellCount,
  } = useEditorCellSelection(`${mode}:${selectedKey}:${showFixedColumns ? 'fixed' : 'hidden'}`);
  const {
    finishCellEdit,
    resetHistory,
    undo,
    updateRows,
  } = useBatchEditorHistory(rows, setRows);
  const {
    resetWidth,
    startResize,
    widthFor,
  } = useEditorColumnWidths(`${mode}:${selectedKey}`);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const result = mode === 'sales'
          ? await api.batchSalesEditorRows(selectedOrderLineIds)
          : await api.batchPurchaseEditorRows(selectedOrderLineIds);
        if (cancelled) return;
        const loadedRows = (result.rows || []).map((row) => ({ ...row, values: [...row.values] }));
        resetHistory();
        setColumns(result.columns);
        setRows(loadedRows);
        setInitialRows(loadedRows.map((row) => ({ ...row, values: [...row.values] })));
        setFixedColumnLetters(result.fixed_columns?.length ? result.fixed_columns : DEFAULT_FIXED_COLUMNS);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error
            ? loadError.message
            : `${mode === 'sales' ? '销售' : '采购'}批量修改表格加载失败`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, resetHistory, selectedKey]);

  const indexedColumns = useMemo(
    () => columns.map((column, index) => ({ column, index })),
    [columns],
  );
  const fixedColumns = useMemo(
    () => fixedColumnLetters
      .map((letter) => indexedColumns.find(({ column }) => column.excel_column === letter))
      .filter((entry): entry is { column: BackendBatchEditorColumn; index: number } => Boolean(entry)),
    [fixedColumnLetters, indexedColumns],
  );
  const financialColumns = useMemo(
    () => indexedColumns.filter(({ index }) => (
      mode === 'sales'
        ? index >= 67 && index <= 90
        : index >= 23 && index <= 66
    )),
    [indexedColumns, mode],
  );
  const selectionColumns = useMemo(
    () => showFixedColumns ? [...fixedColumns, ...financialColumns] : financialColumns,
    [financialColumns, fixedColumns, showFixedColumns],
  );
  const visibleColumnIndexes = useMemo(
    () => selectionColumns.map(({ index }) => index),
    [selectionColumns],
  );
  const basicDetailColumns = useMemo(
    () => indexedColumns.filter(({ index }) => index <= 22),
    [indexedColumns],
  );
  const fixedOffsets = useMemo(() => {
    let offset = ROW_NUMBER_WIDTH + DETAIL_BUTTON_WIDTH;
    return new Map(fixedColumns.map(({ column }) => {
      const currentOffset = offset;
      offset += widthFor(
        column.excel_column,
        FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
      );
      return [column.excel_column, currentOffset];
    }));
  }, [fixedColumns, widthFor]);
  const tableWidth = useMemo(
    () => ROW_NUMBER_WIDTH
      + DETAIL_BUTTON_WIDTH
      + (showFixedColumns
        ? fixedColumns.reduce(
            (total, { column }) => total + widthFor(
              column.excel_column,
              FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
            ),
            0,
          )
        : 0)
      + financialColumns.reduce(
        (total, { column }) => total + widthFor(
          column.excel_column,
          getColumnWidth(column),
        ),
        0,
      ),
    [financialColumns, fixedColumns, showFixedColumns, widthFor],
  );
  const initialRowsById = useMemo(
    () => new Map(initialRows.map((row) => [row.order_line_id, row])),
    [initialRows],
  );
  const dirtyRows = useMemo(
    () => rows.filter((row) => {
      const initial = initialRowsById.get(row.order_line_id);
      return !initial || !editableEditorRowsMatch(columns, initial.values, row.values);
    }),
    [columns, initialRowsById, rows],
  );
  const dirtyRowCount = dirtyRows.length;

  const changeCell = (rowIndex: number, columnIndex: number, value: BatchEditorValue) => {
    if (!columns[columnIndex]?.editable) return;
    updateRows((current) => {
      if (current[rowIndex]?.values[columnIndex] === value) return current;
      return current.map((row, index) => (
        index === rowIndex
          ? {
              ...row,
              values: row.values.map((cell, cellIndex) => (
                cellIndex === columnIndex ? value : cell
              )),
            }
          : row
      ));
    }, `${rowIndex}:${columnIndex}`);
  };

  const handleCopy = (event: React.ClipboardEvent<HTMLTableElement>) => {
    const text = copyEditorSelection(
      rows.map((row) => row.values),
      selectedCells,
      visibleColumnIndexes,
    );
    if (!text && selectedCellCount === 0) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTableElement>) => {
    if (!selectedCellCount) return;
    const text = event.clipboardData.getData('text/plain');
    event.preventDefault();
    finishCellEdit();
    updateRows((current) => {
      const currentValues = current.map((row) => row.values);
      const pasted = pasteGridToEditorSelection(
        currentValues,
        text,
        selectedCells,
        visibleColumnIndexes,
        columns,
        false,
      );
      if (pasted === currentValues) return current;
      return current.map((row, index) => ({ ...row, values: pasted[index] }));
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
  };

  const submit = async () => {
    setError('');
    setSaving(true);
    try {
      if (!dirtyRows.length) {
        throw new Error('没有需要保存的更改');
      }
      const items = dirtyRows.map((row) => {
        const rowIndex = rows.findIndex((candidate) => candidate.order_line_id === row.order_line_id);
        try {
          return {
            order_line_id: row.order_line_id,
            ...(mode === 'sales'
              ? buildSalesInformationPayload(columns, row.values)
              : buildPurchaseInformationPayload(columns, row.values)),
          };
        } catch (rowError) {
          const message = rowError instanceof Error ? rowError.message : '字段格式错误';
          throw new Error(`第 ${rowIndex + 1} 行：${message}`);
        }
      });
      const result = mode === 'sales'
        ? await api.updateSalesBatch(items)
        : await api.updatePurchasesBatch(items);
      await onSaved(result.updated);
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : `${mode === 'sales' ? '销售' : '采购'}信息批量保存失败`);
    } finally {
      setSaving(false);
    }
  };

  const detailRow = detailRowIndex === null ? null : rows[detailRowIndex];

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-slate-900/65 p-2 backdrop-blur-sm sm:p-4">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              批量修改{mode === 'sales' ? '销售' : '采购'}信息（{rows.length} 条）
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {mode === 'sales'
                ? 'BP–CM 列按上传台账顺序展示；蓝色字段可编辑，CI–CJ 自动汇总列只读。'
                : 'X–BO 列按上传台账顺序展示；蓝色字段可编辑，自动汇总与利润列只读。'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFixedColumns((current) => !current)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {showFixedColumns ? '隐藏固定关联列' : '显示固定关联列'}
            </button>
            <button
              type="button"
              disabled={saving || loading || rows.length === 0 || dirtyRowCount === 0}
              onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? '保存中' : dirtyRowCount > 0 ? `保存 ${dirtyRowCount} 条更改` : '没有更改'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
              aria-label={`关闭${mode === 'sales' ? '销售' : '采购'}批量修改`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <div
          className="min-h-0 flex-1 overflow-auto"
          data-testid={`${mode}-batch-scroller`}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-slate-500">
              <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
              正在加载{mode === 'sales' ? '销售' : '采购'}字段和订单关联数据...
            </div>
          ) : (
            <table
              className={`border-separate border-spacing-0 text-left text-xs outline-none ${
                isSelectingCells ? 'select-none' : ''
              }`}
              style={{ tableLayout: 'fixed', width: tableWidth, minWidth: tableWidth }}
              tabIndex={0}
              onCopy={handleCopy}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              onDragStart={(event) => event.preventDefault()}
            >
              <colgroup>
                <col style={{ width: ROW_NUMBER_WIDTH }} />
                <col style={{ width: DETAIL_BUTTON_WIDTH }} />
                {showFixedColumns && fixedColumns.map(({ column }) => (
                  <col
                    key={`fixed-col-${column.excel_column}`}
                    style={{
                      width: widthFor(
                        column.excel_column,
                        FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                      ),
                    }}
                  />
                ))}
                {financialColumns.map(({ column }) => (
                  <col
                    key={`financial-col-${column.excel_column}`}
                    style={{ width: widthFor(column.excel_column, getColumnWidth(column)) }}
                  />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30">
                <tr>
                  <th
                    className="sticky left-0 z-50 border-b border-r border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-600"
                    style={{ minWidth: ROW_NUMBER_WIDTH, width: ROW_NUMBER_WIDTH }}
                  >
                    行
                  </th>
                  <th
                    className="sticky z-50 border-b border-r border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-600"
                    style={{ left: ROW_NUMBER_WIDTH, minWidth: DETAIL_BUTTON_WIDTH, width: DETAIL_BUTTON_WIDTH }}
                  >
                    基本信息
                  </th>
                  {showFixedColumns && fixedColumns.map(({ column }, fixedColumnIndex) => (
                    <th
                      key={`fixed-${column.excel_column}`}
                      className={`sticky z-50 overflow-hidden border-b border-r border-slate-300 bg-amber-50 px-1.5 py-2 text-center font-semibold text-amber-900 ${
                        fixedColumnIndex === fixedColumns.length - 1
                          ? 'border-r-2 border-r-slate-400 shadow-[5px_0_8px_-5px_rgba(15,23,42,0.55)]'
                          : ''
                      }`}
                      style={{
                        left: fixedOffsets.get(column.excel_column),
                        minWidth: widthFor(
                          column.excel_column,
                          FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                        ),
                        width: widthFor(
                          column.excel_column,
                          FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                        ),
                      }}
                      title="订单关联字段（固定、只读）；拖动右侧边缘调整列宽"
                    >
                      <span className="block font-mono text-[10px]">{column.excel_column}</span>
                      <span className="mt-0.5 block truncate">{column.label}</span>
                      <span
                        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-blue-400/50"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`调整${column.label}列宽`}
                        onPointerDown={(event) => startResize(
                          event,
                          column.excel_column,
                          widthFor(
                            column.excel_column,
                            FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                          ),
                        )}
                        onDoubleClick={() => resetWidth(column.excel_column)}
                      />
                    </th>
                  ))}
                  {financialColumns.map(({ column }) => (
                    <th
                      key={column.excel_column}
                      className={`relative border-b border-r border-slate-300 px-2 py-2 text-center font-semibold ${
                        column.editable ? 'bg-blue-50 text-blue-800' : 'bg-slate-200 text-slate-500'
                      }`}
                      style={{
                        minWidth: widthFor(column.excel_column, getColumnWidth(column)),
                        width: widthFor(column.excel_column, getColumnWidth(column)),
                      }}
                      title={column.editable
                        ? `可编辑${mode === 'sales' ? '销售' : '采购'}字段；拖动右侧边缘调整列宽`
                        : '数据库自动计算，只读；拖动右侧边缘调整列宽'}
                    >
                      <span className="block font-mono text-[10px]">{column.excel_column}</span>
                      <span className="mt-0.5 block whitespace-nowrap">{column.label}</span>
                      <span
                        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-blue-400/50"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`调整${column.label}列宽`}
                        onPointerDown={(event) => startResize(
                          event,
                          column.excel_column,
                          widthFor(column.excel_column, getColumnWidth(column)),
                        )}
                        onDoubleClick={() => resetWidth(column.excel_column)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.order_line_id}>
                    <td
                      className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-100 px-2 py-2 text-center font-mono text-slate-500"
                      style={{ minWidth: ROW_NUMBER_WIDTH, width: ROW_NUMBER_WIDTH }}
                    >
                      {rowIndex + 1}
                    </td>
                    <td
                      className="sticky z-20 border-b border-r border-slate-300 bg-slate-100 px-2 text-center"
                      style={{ left: ROW_NUMBER_WIDTH, minWidth: DETAIL_BUTTON_WIDTH, width: DETAIL_BUTTON_WIDTH }}
                    >
                      <button
                        type="button"
                        onClick={() => setDetailRowIndex(rowIndex)}
                        className="inline-flex items-center gap-0.5 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                        aria-label={`显示第 ${rowIndex + 1} 行 A 到 W 列详情`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        详情
                      </button>
                    </td>
                    {showFixedColumns && fixedColumns.map(({ column, index: columnIndex }, fixedColumnIndex) => {
                      const value = row.values[columnIndex] ?? '';
                      const isSelected = isCellSelected(rowIndex, fixedColumnIndex);
                      const isActive = isActiveCell(rowIndex, fixedColumnIndex);
                      return (
                        <td
                          key={`fixed-${row.order_line_id}-${column.excel_column}`}
                          className={`sticky border-b border-r border-slate-300 px-2 py-3 font-mono text-[11px] text-slate-700 ${
                            isSelected
                              ? `z-30 ${EDITOR_SELECTED_CELL_VISUAL_CLASS} ${
                                  isActive ? EDITOR_ACTIVE_CELL_VISUAL_CLASS : ''
                                }`
                              : 'z-20 bg-amber-50'
                          } ${
                            !isSelected && fixedColumnIndex === fixedColumns.length - 1
                              ? 'border-r-2 border-r-slate-400 shadow-[5px_0_8px_-5px_rgba(15,23,42,0.55)]'
                              : ''
                          }`}
                          style={{
                            left: fixedOffsets.get(column.excel_column),
                            minWidth: widthFor(
                              column.excel_column,
                              FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                            ),
                            width: widthFor(
                              column.excel_column,
                              FIXED_COLUMN_WIDTHS[column.excel_column] || 120,
                            ),
                          }}
                          aria-selected={isSelected}
                          data-editor-cell={`${rowIndex}:${fixedColumnIndex}`}
                          onPointerDown={(event) => handleCellPointerDown(event, rowIndex, fixedColumnIndex)}
                          onPointerEnter={(event) => handleCellPointerEnter(event, rowIndex, fixedColumnIndex)}
                        >
                          <div className="overflow-hidden text-ellipsis whitespace-nowrap" title={String(value)}>
                            {String(value)}
                          </div>
                        </td>
                      );
                    })}
                    {financialColumns.map(({ column, index: columnIndex }, financialColumnIndex) => {
                      const value = row.values[columnIndex] ?? '';
                      const selectionColumnIndex = (
                        showFixedColumns ? fixedColumns.length : 0
                      ) + financialColumnIndex;
                      const isSelected = isCellSelected(rowIndex, selectionColumnIndex);
                      const isActive = isActiveCell(rowIndex, selectionColumnIndex);
                      return (
                        <td
                          key={`${row.order_line_id}-${column.excel_column}`}
                          className={`border-b border-r border-slate-200 p-0 ${
                            isSelected
                              ? `relative z-10 ${EDITOR_SELECTED_CELL_VISUAL_CLASS} ${
                                  isActive ? EDITOR_ACTIVE_CELL_VISUAL_CLASS : ''
                                }`
                              : column.editable ? 'bg-white' : 'bg-slate-50'
                          }`}
                          style={{
                            minWidth: widthFor(column.excel_column, getColumnWidth(column)),
                            width: widthFor(column.excel_column, getColumnWidth(column)),
                          }}
                          aria-selected={isSelected}
                          data-editor-cell={`${rowIndex}:${selectionColumnIndex}`}
                          onPointerDown={(event) => handleCellPointerDown(event, rowIndex, selectionColumnIndex)}
                          onPointerEnter={(event) => handleCellPointerEnter(event, rowIndex, selectionColumnIndex)}
                        >
                          {column.editable ? (
                            <input
                              type={column.value_type === 'date' ? 'date' : 'text'}
                              value={String(value)}
                              onChange={(event) => changeCell(rowIndex, columnIndex, event.target.value)}
                              onBlur={finishCellEdit}
                              className={`h-10 w-full min-w-0 px-2 font-mono text-xs text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                                isSelected ? 'bg-blue-100' : 'bg-transparent focus:bg-blue-50'
                              }`}
                              aria-label={`${rowIndex + 1}行 ${column.excel_column}列 ${column.label}`}
                            />
                          ) : (
                            <div
                              className="h-10 overflow-hidden text-ellipsis whitespace-nowrap px-2 py-3 font-mono text-[11px] text-slate-500"
                              title={String(value)}
                            >
                              {String(value)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>
            固定列：B–G、M–O；Ctrl+C/V 复制粘贴，Ctrl+Z 撤回；拖动表头右侧边缘调整列宽。
          </span>
          <span>已选 {selectedCellCount} 个单元格；{dirtyRowCount} 条已更改 / {selectedOrderLineIds.length} 条订单明细</span>
        </footer>

        {detailRow && (
          <div className="absolute inset-0 z-[160] flex justify-end bg-slate-900/35">
            <aside className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
              <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">A–W 基本信息详情</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    第 {(detailRowIndex ?? 0) + 1} 行，订单明细 ID：{detailRow.order_line_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailRowIndex(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="关闭基本信息详情"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
                {basicDetailColumns.map(({ column, index }) => (
                  <div key={column.excel_column} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <span className="font-mono text-blue-600">{column.excel_column}</span>
                      <span>{column.label}</span>
                    </div>
                    <div className="mt-1 break-words text-sm text-slate-800">
                      {String(detailRow.values[index] ?? '') || '-'}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
