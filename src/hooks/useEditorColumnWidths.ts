import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 480;

interface ActiveResize {
  columnKey: string;
  startX: number;
  startWidth: number;
}

export function useEditorColumnWidths(resetKey: string) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const activeResizeRef = useRef<ActiveResize | null>(null);

  useEffect(() => {
    setColumnWidths({});
  }, [resetKey]);

  useEffect(() => {
    const resize = (event: PointerEvent) => {
      const activeResize = activeResizeRef.current;
      if (!activeResize) return;
      const width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, activeResize.startWidth + event.clientX - activeResize.startX),
      );
      setColumnWidths((current) => ({
        ...current,
        [activeResize.columnKey]: width,
      }));
      if (event.cancelable) event.preventDefault();
    };
    const finishResize = () => {
      activeResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      finishResize();
    };
  }, []);

  const widthFor = useCallback((
    columnKey: string,
    defaultWidth: number,
  ) => columnWidths[columnKey] ?? defaultWidth, [columnWidths]);

  const startResize = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    columnKey: string,
    currentWidth: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activeResizeRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: currentWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const resetWidth = useCallback((columnKey: string) => {
    setColumnWidths((current) => {
      if (current[columnKey] === undefined) return current;
      const next = { ...current };
      delete next[columnKey];
      return next;
    });
  }, []);

  return {
    resetWidth,
    startResize,
    widthFor,
  };
}
