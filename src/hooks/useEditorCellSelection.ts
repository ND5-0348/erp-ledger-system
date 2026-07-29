import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  editorCellKey,
  EditorCellPosition,
  selectEditorCellRectangle,
} from '../lib/batchOrderEditor';

interface DragSelection {
  origin: EditorCellPosition;
  baseSelection: Set<string>;
  mode: 'add' | 'remove';
  lastCellKey: string;
}

export const EDITOR_SELECTED_CELL_VISUAL_CLASS =
  'bg-blue-100';
export const EDITOR_ACTIVE_CELL_VISUAL_CLASS =
  'shadow-[inset_0_0_0_2px_rgb(37_99_235)]';

export function useEditorCellSelection(resetKey: string) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set());
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  const [isSelectingCells, setIsSelectingCells] = useState(false);
  const selectionAnchorRef = useRef<EditorCellPosition | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);

  const clearCellSelection = useCallback(() => {
    setSelectedCells(new Set());
    setActiveCellKey(null);
    selectionAnchorRef.current = null;
    dragSelectionRef.current = null;
    setIsSelectingCells(false);
  }, []);

  useEffect(() => {
    clearCellSelection();
  }, [clearCellSelection, resetKey]);

  useEffect(() => {
    const updateSelectionFromPointer = (event: PointerEvent) => {
      const dragSelection = dragSelectionRef.current;
      if (!dragSelection || (event.buttons & 1) !== 1) return;

      const target = document.elementFromPoint(event.clientX, event.clientY);
      const cellElement = target?.closest<HTMLElement>('[data-editor-cell]');
      const coordinate = cellElement?.dataset.editorCell;
      if (!coordinate || coordinate === dragSelection.lastCellKey) return;

      const [rowIndex, columnIndex] = coordinate.split(':').map(Number);
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;

      dragSelection.lastCellKey = coordinate;
      setSelectedCells(selectEditorCellRectangle(
        dragSelection.baseSelection,
        dragSelection.origin,
        { rowIndex, columnIndex },
        dragSelection.mode,
      ));
      if (event.cancelable) event.preventDefault();
    };
    const finishSelection = () => {
      dragSelectionRef.current = null;
      setIsSelectingCells(false);
    };

    window.addEventListener('pointermove', updateSelectionFromPointer);
    window.addEventListener('pointerup', finishSelection);
    window.addEventListener('pointercancel', finishSelection);
    return () => {
      window.removeEventListener('pointermove', updateSelectionFromPointer);
      window.removeEventListener('pointerup', finishSelection);
      window.removeEventListener('pointercancel', finishSelection);
    };
  }, []);

  const handleCellPointerDown = (
    event: ReactPointerEvent<HTMLTableCellElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    if (event.button !== 0) return;

    const cell = { rowIndex, columnIndex };
    const additive = event.ctrlKey || event.metaKey;
    const anchor = event.shiftKey && selectionAnchorRef.current
      ? selectionAnchorRef.current
      : cell;
    const baseSelection: Set<string> = additive
      ? new Set<string>(selectedCells)
      : new Set<string>();
    const key = editorCellKey(cell);
    const selectionMode = additive && selectedCells.has(key) ? 'remove' : 'add';

    const nextSelection = selectEditorCellRectangle(
      baseSelection,
      anchor,
      cell,
      selectionMode,
    );
    setSelectedCells(nextSelection);
    if (!additive || !activeCellKey) {
      setActiveCellKey(editorCellKey(anchor));
    } else if (!nextSelection.has(activeCellKey)) {
      setActiveCellKey(nextSelection.values().next().value ?? null);
    }
    selectionAnchorRef.current = anchor;
    dragSelectionRef.current = {
      origin: anchor,
      baseSelection,
      mode: selectionMode,
      lastCellKey: key,
    };
    setIsSelectingCells(true);

    if (additive || event.shiftKey) {
      event.preventDefault();
    }
  };

  const handleCellPointerEnter = (
    event: ReactPointerEvent<HTMLTableCellElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    const dragSelection = dragSelectionRef.current;
    if (!dragSelection || event.buttons === 0) return;

    const key = editorCellKey({ rowIndex, columnIndex });
    if (key === dragSelection.lastCellKey) return;
    dragSelection.lastCellKey = key;
    setSelectedCells(selectEditorCellRectangle(
      dragSelection.baseSelection,
      dragSelection.origin,
      { rowIndex, columnIndex },
      dragSelection.mode,
    ));
  };

  const isCellSelected = (rowIndex: number, columnIndex: number) => (
    selectedCells.has(editorCellKey({ rowIndex, columnIndex }))
  );
  const isActiveCell = (rowIndex: number, columnIndex: number) => (
    activeCellKey === editorCellKey({ rowIndex, columnIndex })
  );

  return {
    activeCellKey,
    clearCellSelection,
    handleCellPointerDown,
    handleCellPointerEnter,
    isActiveCell,
    isCellSelected,
    isSelectingCells,
    selectedCells,
    selectedCellCount: selectedCells.size,
  };
}
