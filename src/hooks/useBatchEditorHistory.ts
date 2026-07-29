import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { BackendBatchEditorRow } from '../api';

const MAX_UNDO_STEPS = 100;

function cloneRows(rows: BackendBatchEditorRow[]): BackendBatchEditorRow[] {
  return rows.map((row) => ({ ...row, values: [...row.values] }));
}

export function useBatchEditorHistory(
  rows: BackendBatchEditorRow[],
  setRows: Dispatch<SetStateAction<BackendBatchEditorRow[]>>,
) {
  const rowsRef = useRef(rows);
  const undoStackRef = useRef<BackendBatchEditorRow[][]>([]);
  const activeEditKeyRef = useRef<string | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    activeEditKeyRef.current = null;
  }, []);

  const finishCellEdit = useCallback(() => {
    activeEditKeyRef.current = null;
  }, []);

  const updateRows = useCallback((
    updater: (current: BackendBatchEditorRow[]) => BackendBatchEditorRow[],
    coalesceKey?: string,
  ) => {
    const current = rowsRef.current;
    const next = updater(current);
    if (next === current) return;

    if (!coalesceKey || activeEditKeyRef.current !== coalesceKey) {
      undoStackRef.current.push(cloneRows(current));
      if (undoStackRef.current.length > MAX_UNDO_STEPS) {
        undoStackRef.current.shift();
      }
    }
    activeEditKeyRef.current = coalesceKey ?? null;
    rowsRef.current = next;
    setRows(next);
  }, [setRows]);

  const undo = useCallback(() => {
    activeEditKeyRef.current = null;
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    const restored = cloneRows(previous);
    rowsRef.current = restored;
    setRows(restored);
  }, [setRows]);

  return {
    finishCellEdit,
    resetHistory,
    undo,
    updateRows,
  };
}
