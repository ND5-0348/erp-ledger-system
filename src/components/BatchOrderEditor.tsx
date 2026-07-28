import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react';
import {
  api,
  BackendBatchEditorColumn,
  BackendBatchEditorRow,
  BatchEditorValue,
} from '../api';
import {
  BASIC_INFORMATION_END_COLUMN,
  buildBasicInformationPayload,
  createBlankEditorRow,
  pasteGrid,
} from '../lib/batchOrderEditor';
import {
  EDITOR_ACTIVE_CELL_VISUAL_CLASS,
  EDITOR_SELECTED_CELL_VISUAL_CLASS,
  useEditorCellSelection,
} from '../hooks/useEditorCellSelection';

interface BatchOrderEditorProps {
  mode: 'create' | 'update';
  selectedOrderLineIds?: number[];
  onClose: () => void;
  onSaved: (count: number) => Promise<void> | void;
}

export default function BatchOrderEditor({
  mode,
  selectedOrderLineIds = [],
  onClose,
  onSaved,
}: BatchOrderEditorProps) {
  const [columns, setColumns] = useState<BackendBatchEditorColumn[]>([]);
  const [rows, setRows] = useState<BackendBatchEditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedKey = selectedOrderLineIds.join(',');
  const {
    clearCellSelection,
    handleCellPointerDown,
    handleCellPointerEnter,
    isActiveCell,
    isCellSelected,
    isSelectingCells,
    selectedCellCount,
  } = useEditorCellSelection(`${mode}:${selectedKey}`);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const result = mode === 'update'
          ? await api.batchOrderEditorRows(selectedOrderLineIds)
          : await api.batchOrderEditorSchema();
        if (cancelled) return;
        setColumns(result.columns);
        setRows(
          mode === 'update'
            ? (result.rows || [])
            : [{ order_line_id: 0, values: createBlankEditorRow(result.columns) }],
        );
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '在线表格加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedKey]);

  const visibleColumns = useMemo(
    () => columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => mode === 'update' || column.editable),
    [columns, mode],
  );

  const changeCell = (rowIndex: number, columnIndex: number, value: BatchEditorValue) => {
    if (!columns[columnIndex]?.editable) return;
    setRows((current) => current.map((row, index) => (
      index === rowIndex
        ? { ...row, values: row.values.map((cell, cellIndex) => (cellIndex === columnIndex ? value : cell)) }
        : row
    )));
  };

  const handlePaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    setRows((current) => {
      const values = pasteGrid(
        current.map((row) => row.values),
        text,
        rowIndex,
        columnIndex,
        columns,
        mode === 'create',
      );
      return values.map((rowValues, index) => ({
        order_line_id: current[index]?.order_line_id || 0,
        values: rowValues,
      }));
    });
  };

  const addRows = (count = 1) => {
    setRows((current) => [
      ...current,
      ...Array.from({ length: count }, () => ({ order_line_id: 0, values: createBlankEditorRow(columns) })),
    ]);
  };

  const removeRow = (rowIndex: number) => {
    setRows((current) => current.filter((_, index) => index !== rowIndex));
    clearCellSelection();
  };

  const submit = async () => {
    setError('');
    try {
      const submittedRows = mode === 'create'
        ? rows.filter((row) => row.values.slice(1, 23).some((value) => String(value ?? '').trim() !== ''))
        : rows;
      if (!submittedRows.length) {
        throw new Error('请至少填写一行基本信息');
      }
      const items = submittedRows.map((row) => {
        const payload = buildBasicInformationPayload(columns, row.values);
        return mode === 'update' ? { order_line_id: row.order_line_id, ...payload } : payload;
      });
      setSaving(true);
      let count: number;
      if (mode === 'update') {
        const result = await api.updateBasicOrdersBatch(items);
        count = result.updated;
      } else {
        const result = await api.createBasicOrdersBatch(items);
        count = result.created;
      }
      await onSaved(count);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '在线表格保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-slate-900/65 backdrop-blur-sm p-2 sm:p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {mode === 'create' ? '批量新增基本信息' : `批量修改基本信息（${rows.length} 条）`}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {mode === 'create'
                ? `仅录入台账 A–${BASIC_INFORMATION_END_COLUMN} 列；可从 Excel 复制多行后粘贴。`
                : `A–${BASIC_INFORMATION_END_COLUMN} 列可编辑，X 列及以后仅展示、不可修改。`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'create' && (
              <>
                <button
                  type="button"
                  onClick={() => addRows(1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-4 w-4 text-blue-600" />
                  添加一行
                </button>
                <button
                  type="button"
                  onClick={() => addRows(5)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <ClipboardPaste className="h-4 w-4 text-blue-600" />
                  添加五行
                </button>
              </>
            )}
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? '保存中' : '保存到数据库'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
              aria-label="关闭批量编辑"
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

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
              正在加载字段和订单数据...
            </div>
          ) : (
            <table
              className={`border-separate border-spacing-0 text-left text-xs ${
                isSelectingCells ? 'select-none' : ''
              }`}
              onDragStart={(event) => event.preventDefault()}
            >
              <thead className="sticky top-0 z-30">
                <tr>
                  <th className="sticky left-0 z-40 min-w-[52px] border-b border-r border-slate-300 bg-slate-200 px-2 py-2 text-center font-bold text-slate-600">
                    行
                  </th>
                  {visibleColumns.map(({ column }) => (
                    <th
                      key={column.excel_column}
                      className={`border-b border-r border-slate-300 px-2 py-2 text-center font-semibold ${
                        column.editable ? 'bg-blue-50 text-blue-800' : 'bg-slate-200 text-slate-500'
                      }`}
                      style={{ minWidth: column.value_type === 'text' ? 156 : 126 }}
                      title={column.editable ? '可编辑字段' : '只读字段'}
                    >
                      <span className="block font-mono text-[10px]">{column.excel_column}</span>
                      <span className="mt-0.5 block whitespace-nowrap">
                        {column.label}
                        {column.required && <span className="ml-0.5 text-rose-500">*</span>}
                      </span>
                    </th>
                  ))}
                  {mode === 'create' && (
                    <th className="sticky right-0 z-40 min-w-[68px] border-b border-l border-slate-300 bg-slate-200 px-2 py-2 text-center font-semibold text-slate-600">
                      操作
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.order_line_id || `new-${rowIndex}`}>
                    <td className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-100 px-2 py-2 text-center font-mono text-slate-500">
                      {rowIndex + 1}
                    </td>
                    {visibleColumns.map(({ column, index: columnIndex }, visibleColumnIndex) => {
                      const value = row.values[columnIndex] ?? '';
                      const isSelected = isCellSelected(rowIndex, visibleColumnIndex);
                      const isActive = isActiveCell(rowIndex, visibleColumnIndex);
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
                          aria-selected={isSelected}
                          data-editor-cell={`${rowIndex}:${visibleColumnIndex}`}
                          onPointerDown={(event) => handleCellPointerDown(event, rowIndex, visibleColumnIndex)}
                          onPointerEnter={(event) => handleCellPointerEnter(event, rowIndex, visibleColumnIndex)}
                        >
                          {column.editable ? (
                            <input
                              type={column.value_type === 'date' ? 'date' : 'text'}
                              value={String(value)}
                              onChange={(event) => changeCell(rowIndex, columnIndex, event.target.value)}
                              onPaste={(event) => handlePaste(event, rowIndex, columnIndex)}
                              className={`h-10 w-full min-w-0 px-2 font-mono text-xs text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                                isSelected ? 'bg-blue-100' : 'bg-transparent focus:bg-blue-50'
                              }`}
                              aria-label={`${rowIndex + 1}行 ${column.excel_column}列 ${column.label}`}
                            />
                          ) : (
                            <div className="h-10 overflow-hidden text-ellipsis whitespace-nowrap px-2 py-3 font-mono text-[11px] text-slate-500" title={String(value)}>
                              {String(value)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {mode === 'create' && (
                      <td className="sticky right-0 z-20 border-b border-l border-slate-300 bg-slate-100 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(rowIndex)}
                          disabled={rows.length === 1}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`删除第 ${rowIndex + 1} 行`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>
            蓝色表头为可编辑字段；单击或拖拽选择单元格，Ctrl/⌘ 可多选，Shift 可扩展选区。
          </span>
          <span>
            已选 {selectedCellCount} 个单元格；{mode === 'update' ? `${selectedOrderLineIds.length} 条明细` : `当前 ${rows.length} 行`}
          </span>
        </footer>
      </div>
    </div>
  );
}
