import type { Vec2 } from './types';

/** Raw data produced by scripts/build-stroke-font.mjs. Coordinates are font units, y up. */
export interface StrokeFontData {
  name: string;
  license?: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  glyphs: Record<string, { a: number; s: number[][] }>;
}

/**
 * A glyph ready to be written: strokes in pen order and direction.
 *
 * `strokes` are written immediately and end at the exit point, so the next
 * letter can join without lifting. `deferred` strokes (i dots, t crossbars)
 * are written when the word is finished, the way people dot their i's.
 */
export interface PreparedGlyph {
  advance: number;
  strokes: Vec2[][];
  deferred: Vec2[][];
  joinsIn: boolean;
  joinsOut: boolean;
}

export interface JoinConvention {
  /** Height (font units) where cursive letters connect. */
  joinY: number;
  /** Entry x relative to the glyph origin; the exit is at advance + joinDX. */
  joinDX: number;
  /** How close (font units) an endpoint must be to count as an entry or exit. */
  tolerance: number;
}

// EMS Allure connects lowercase letters at y = 183, 31.5 units left of each
// glyph's origin (and of the next glyph's origin, for the exit).
export const ALLURE_JOINS: JoinConvention = { joinY: 183, joinDX: -31.5, tolerance: 45 };

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPoints(flat: number[]): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i]!, y: flat[i + 1]! });
  return pts;
}

/**
 * Puts a raw glyph's strokes into a believable pen order and direction.
 *
 * Single-line fonts are traced, not written, so stroke direction is often
 * arbitrary. EMS Allure's "a", for example, starts at its exit tail. We fix
 * that with the font's join convention: the stroke touching the exit point
 * must end there, the stroke touching the entry point must start there, and
 * strokes after the exit stroke are deferred to the end of the word.
 */
export function prepareGlyph(raw: { a: number; s: number[][] }, joins: JoinConvention): PreparedGlyph {
  const entry: Vec2 = { x: joins.joinDX, y: joins.joinY };
  const exit: Vec2 = { x: raw.a + joins.joinDX, y: joins.joinY };
  const strokes = raw.s.map(toPoints).filter((s) => s.length >= 2);

  let exitIndex = -1;
  let joinsIn = false;
  strokes.forEach((s, i) => {
    const start = s[0]!;
    const end = s[s.length - 1]!;
    if (exitIndex < 0 && Math.min(dist(start, exit), dist(end, exit)) < joins.tolerance) {
      exitIndex = i;
      if (dist(start, exit) < dist(end, exit)) s.reverse();
    }
  });
  strokes.forEach((s, i) => {
    const start = s[0]!;
    const end = s[s.length - 1]!;
    if (i === exitIndex) {
      // A stroke can both enter and exit (like "i"); the exit check already set its direction.
      if (dist(start, entry) < joins.tolerance) joinsIn = true;
      return;
    }
    if (Math.min(dist(start, entry), dist(end, entry)) < joins.tolerance) {
      joinsIn = true;
      if (dist(end, entry) < dist(start, entry)) s.reverse();
    }
  });

  if (exitIndex < 0) {
    return { advance: raw.a, strokes, deferred: [], joinsIn, joinsOut: false };
  }
  const before = strokes.slice(0, exitIndex);
  const exitStroke = strokes[exitIndex]!;
  const after = strokes.slice(exitIndex + 1);
  return { advance: raw.a, strokes: [...before, exitStroke], deferred: after, joinsIn, joinsOut: true };
}

export class StrokeFont {
  readonly xHeight: number;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly spaceAdvance: number;
  private readonly cache = new Map<string, PreparedGlyph>();

  constructor(
    private readonly data: StrokeFontData,
    private readonly joins: JoinConvention = ALLURE_JOINS,
  ) {
    this.xHeight = data.xHeight;
    this.unitsPerEm = data.unitsPerEm;
    this.ascent = data.ascent;
    this.descent = data.descent;
    this.spaceAdvance = data.glyphs[' ']?.a ?? data.unitsPerEm * 0.35;
  }

  has(ch: string): boolean {
    return ch in this.data.glyphs;
  }

  /** Returns a fresh copy each call so callers can transform points freely. */
  get(ch: string): PreparedGlyph | undefined {
    let g = this.cache.get(ch);
    if (!g) {
      const raw = this.data.glyphs[ch];
      if (!raw) return undefined;
      g = prepareGlyph(raw, this.joins);
      this.cache.set(ch, g);
    }
    const copy = (ss: Vec2[][]) => ss.map((s) => s.map((p) => ({ x: p.x, y: p.y })));
    return { ...g, strokes: copy(g.strokes), deferred: copy(g.deferred) };
  }
}
