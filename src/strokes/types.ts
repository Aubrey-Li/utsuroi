/** A point in sand space: x to the right, y away from the viewer (world -z), in meters. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A point along a written stroke with pen pressure (0..1) and time in seconds from the stroke's start. */
export interface TimedPoint extends Vec2 {
  p: number;
  t: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyRect(): Rect {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function expandRect(r: Rect, x: number, y: number, pad = 0): void {
  if (x - pad < r.minX) r.minX = x - pad;
  if (y - pad < r.minY) r.minY = y - pad;
  if (x + pad > r.maxX) r.maxX = x + pad;
  if (y + pad > r.maxY) r.maxY = y + pad;
}

export function isEmptyRect(r: Rect): boolean {
  return r.maxX < r.minX || r.maxY < r.minY;
}
