export const GAP = 10;
export const MAX_SPAN = 4;
/** Below this the widgets get unusable; the grid scrolls instead. */
export const MIN_CELL = 72;

export interface WidgetInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface Workspace {
  version: 2;
  /** Grid size in squares (chosen in edit mode). */
  cols: number;
  rows: number;
  /** Squares keep a comfortable size and the page scrolls down for more rows. */
  scroll: boolean;
  widgets: WidgetInstance[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const spanPx = (cells: number, cell: number) => cells * cell + Math.max(0, cells - 1) * GAP;

export const fits = (r: Rect, cols: number, rows: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows;

export function isFree(r: Rect, widgets: WidgetInstance[], ignore?: string) {
  return !widgets.some((w) => w.id !== ignore && overlaps(r, w));
}

/** First free position for a w x h widget inside the grid, or null. */
export function findSpot(w: number, h: number, widgets: WidgetInstance[], cols: number, rows: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (isFree({ x, y, w, h }, widgets)) return { x, y };
    }
  }
  return null;
}

/**
 * Square size for the area: as big as possible while the whole grid fits, or (scrolling)
 * filling the width and growing downwards.
 */
export function cellSize(width: number, height: number, cols: number, rows: number, scroll: boolean): number {
  const byWidth = (width - (cols - 1) * GAP) / cols;
  if (scroll) return Math.max(MIN_CELL, Math.floor(byWidth));
  const byHeight = (height - (rows - 1) * GAP) / rows;
  return Math.max(MIN_CELL, Math.floor(Math.min(byWidth, byHeight)));
}

/** Older layouts (fixed 140 px squares) get a grid just big enough for their widgets. */
export function upgrade(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Workspace).widgets)) return null;
  const ws = raw as Partial<Workspace> & { widgets: WidgetInstance[] };
  const needCols = Math.max(4, ...ws.widgets.map((w) => w.x + w.w));
  const needRows = Math.max(3, ...ws.widgets.map((w) => w.y + w.h));
  return {
    version: 2,
    cols: typeof ws.cols === "number" ? ws.cols : needCols,
    rows: typeof ws.rows === "number" ? ws.rows : needRows,
    scroll: !!ws.scroll,
    widgets: ws.widgets,
  };
}
