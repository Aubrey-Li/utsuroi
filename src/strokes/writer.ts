import type { SandLayout, PlacedChar } from './layout';
import { fbm1 } from './random';
import { catmullRom, resample } from './smooth';
import { DEFAULT_TIMING, timeStroke, type TimingParams } from './timing';
import { emptyRect, expandRect, isEmptyRect, type Rect, type TimedPoint, type Vec2 } from './types';

export interface WriterParams {
  timing: TimingParams;
  /** Spacing of the timed points along a stroke (m). */
  sampleSpacing: number;
  /** Hand tremor amplitude (m) and wavelength along the stroke (m). */
  wobble: number;
  wobbleWavelength: number;
  /** The next stroke continues without lifting if it starts this close (m). */
  joinTolerance: number;
  /** Highest the stick lifts when moving between strokes (m). */
  liftHeight: number;
  /** Speed of the stick through the air between strokes (m/s). */
  travelSpeed: number;
  /** Extra playback speed per letter waiting beyond the first two. */
  catchUp: number;
  maxRate: number;
  /** Idle time (s) before dotting i's and crossing t's of an unfinished word. */
  deferDelay: number;
  /** Idle time (s) before the stick lifts off the sand between letters. */
  restLiftDelay: number;
  /** How fast the flat of the stick sweeps a letter away (m/s). */
  wipeSpeed: number;
}

export const DEFAULT_WRITER: WriterParams = {
  timing: DEFAULT_TIMING,
  sampleSpacing: 0.004,
  wobble: 0.0022,
  wobbleWavelength: 0.09,
  joinTolerance: 0.035,
  liftHeight: 0.07,
  travelSpeed: 2.2,
  catchUp: 0.18,
  maxRate: 2.2,
  deferDelay: 0.7,
  restLiftDelay: 1.1,
  wipeSpeed: 1.6,
};

export interface ToolState {
  x: number;
  y: number;
  /** Height of the stick's tip above the sand (m). */
  lift: number;
  /** Whether the tip is touching the sand. */
  down: boolean;
  pressure: number;
}

/** Receives the marks the stick makes. Implemented by the sand field. */
export interface WriterSink {
  stamp(x0: number, y0: number, p0: number, x1: number, y1: number, p1: number): void;
  /** Smooth a fraction (fromFrac..toFrac, left to right) of a rectangle back to flat sand. */
  wipe(rect: Rect, fromFrac: number, toFrac: number): void;
}

type Motion =
  | { kind: 'draw'; pts: TimedPoint[]; next: number; t: number; last: TimedPoint | null; charId: number }
  | { kind: 'travel'; from: Vec2; to: Vec2; fromLift: number; toLift: number; dur: number; t: number; charId: number }
  | { kind: 'wipe'; rect: Rect; dur: number; t: number; charId: number }
  | { kind: 'done'; charId: number };

function endOf(m: Motion): { x: number; y: number; lift: number } | null {
  switch (m.kind) {
    case 'draw': {
      const p = m.pts[m.pts.length - 1]!;
      return { x: p.x, y: p.y, lift: 0 };
    }
    case 'travel':
      return { x: m.to.x, y: m.to.y, lift: m.toLift };
    case 'wipe':
      return { x: m.rect.maxX, y: (m.rect.minY + m.rect.maxY) / 2, lift: 0.006 };
    default:
      return null;
  }
}

type Action = { kind: 'char'; char: PlacedChar } | { kind: 'wipe'; char: PlacedChar; rect: Rect };

const REST_LIFT = 0.018;

/**
 * The stick's brain: turns typed characters into timed strokes and plays them back.
 *
 * Typing only queues work. `update(dt)` advances the stick along its planned
 * motions and reports every mark through the sink, so writing always looks
 * like it's happening by hand, a few letters behind the keyboard.
 */
export class SandWriter {
  readonly tool: ToolState;
  private readonly queue: Action[] = [];
  private readonly motions: Motion[] = [];
  private current: Motion | null = null;
  private readonly deferred: { charId: number; strokes: Vec2[][] }[] = [];
  private readonly bounds = new Map<number, Rect>();
  private planEnd: { x: number; y: number; lift: number };
  private idleTime = 0;

  constructor(
    private readonly layout: SandLayout,
    public params: WriterParams = DEFAULT_WRITER,
    private readonly sink: WriterSink,
  ) {
    const o = layout.options;
    this.tool = { x: o.left, y: o.firstBaseline, lift: REST_LIFT * 2, down: false, pressure: 0 };
    this.planEnd = { x: this.tool.x, y: this.tool.y, lift: this.tool.lift };
  }

  /** True while there's anything left to write or wipe. */
  get busy(): boolean {
    return this.current !== null || this.motions.length > 0 || this.queue.length > 0 || this.deferred.length > 0;
  }

  /** Number of letters that have left marks in the sand. */
  get markedLetters(): number {
    return this.bounds.size;
  }

  /** Queues a typed character. Returns false if the sand is full. */
  type(ch: string): boolean {
    const c = this.layout.add(ch);
    if (!c) return false;
    this.queue.push({ kind: 'char', char: c });
    return true;
  }

  /** Removes the last character. Returns false if there's nothing left that can be taken back. */
  backspace(): boolean {
    const c = this.layout.removeLast();
    if (!c) return false;
    if (c.state === 'queued') {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const a = this.queue[i]!;
        if (a.kind === 'char' && a.char === c) {
          this.queue.splice(i, 1);
          break;
        }
      }
      return true;
    }
    // Already started: cancel whatever is left of it, then sweep it away.
    this.dropMotionsFor(c.id);
    const d = this.deferred.findIndex((x) => x.charId === c.id);
    if (d >= 0) this.deferred.splice(d, 1);
    const rect = this.bounds.get(c.id);
    this.bounds.delete(c.id);
    if (rect && !isEmptyRect(rect)) this.queue.push({ kind: 'wipe', char: c, rect });
    return true;
  }

  reset(): void {
    this.queue.length = 0;
    this.motions.length = 0;
    this.deferred.length = 0;
    this.bounds.clear();
    this.current = null;
    this.idleTime = 0;
    this.layout.reset();
    const o = this.layout.options;
    Object.assign(this.tool, { x: o.left, y: o.firstBaseline, lift: REST_LIFT * 2, down: false, pressure: 0 });
    this.planEnd = { x: this.tool.x, y: this.tool.y, lift: this.tool.lift };
  }

  update(dt: number): void {
    const waiting = this.queue.filter((a) => a.kind === 'char' && a.char.glyph).length;
    const rate = Math.min(this.params.maxRate, 1 + this.params.catchUp * Math.max(0, waiting - 2));
    let budget = dt * rate;
    while (budget > 1e-7) {
      if (!this.current) this.current = this.motions.shift() ?? this.pull();
      if (!this.current) {
        this.rest(dt);
        return;
      }
      this.idleTime = 0;
      budget = this.advance(this.current, budget);
    }
  }

  // ---------------------------------------------------------------------------

  private pull(): Motion | null {
    while (this.queue.length > 0) {
      const a = this.queue.shift()!;
      if (a.kind === 'wipe') this.planWipe(a.rect, a.char.id);
      else if (a.char.glyph) this.planChar(a.char);
      else {
        // A space or line break finishes the word: dot the i's now.
        a.char.state = 'written';
        this.planDeferred();
      }
      const m = this.motions.shift();
      if (m) return m;
    }
    return null;
  }

  private rest(dt: number): void {
    this.idleTime += dt;
    if (this.idleTime > this.params.deferDelay && this.deferred.length > 0) {
      this.planDeferred();
      return;
    }
    if (this.idleTime > this.params.restLiftDelay || !this.tool.down) {
      this.tool.down = false;
      this.tool.pressure = 0;
      this.tool.lift += (REST_LIFT - this.tool.lift) * Math.min(1, dt * 3);
    }
    this.planEnd = { x: this.tool.x, y: this.tool.y, lift: this.tool.lift };
  }

  private planChar(c: PlacedChar): void {
    const g = c.glyph!;
    c.state = 'writing';
    g.strokes.forEach((s, i) => this.planStroke(this.toWorld(s, c), c.id, c.variation.seed + i * 31));
    if (g.deferred.length > 0) {
      this.deferred.push({ charId: c.id, strokes: g.deferred.map((s) => this.toWorld(s, c)) });
    }
    this.motions.push({ kind: 'done', charId: c.id });
    // Letters that don't join (capitals, punctuation) end their word's run of joins.
    if (!g.joinsOut && this.deferred.length > 0) this.planDeferred();
  }

  private planDeferred(): void {
    const items = this.deferred.splice(0);
    for (const item of items) {
      item.strokes.forEach((s, i) => this.planStroke(s, item.charId, item.charId * 13 + i));
    }
  }

  private toWorld(stroke: readonly Vec2[], c: PlacedChar): Vec2[] {
    const v = c.variation;
    const u = this.layout.unit * v.scale;
    const stretch = this.layout.options.stretch;
    const cos = Math.cos(v.rotation);
    const sin = Math.sin(v.rotation);
    return stroke.map((p) => {
      const sx = p.x + v.slant * p.y;
      return { x: c.x + (sx * cos - p.y * sin) * u, y: c.y + (sx * sin + p.y * cos) * u * stretch };
    });
  }

  private planStroke(worldPts: Vec2[], charId: number, seed: number): void {
    if (worldPts.length < 2) return;
    const start = worldPts[0]!;
    const gap = Math.hypot(start.x - this.planEnd.x, start.y - this.planEnd.y);
    const joined = this.planEnd.lift < 1e-4 && gap < this.params.joinTolerance;
    const control = joined ? [{ x: this.planEnd.x, y: this.planEnd.y }, ...worldPts] : worldPts;
    if (!joined) {
      const dist = Math.max(gap, 1e-6);
      this.motions.push({
        kind: 'travel',
        from: { x: this.planEnd.x, y: this.planEnd.y },
        to: { ...start },
        fromLift: this.planEnd.lift,
        toLift: 0,
        dur: 0.07 + dist / this.params.travelSpeed,
        t: 0,
        charId,
      });
    }
    const pts = resample(catmullRom(control, 5), this.params.sampleSpacing);
    this.applyWobble(pts, seed, joined);
    const timed = timeStroke(pts, this.params.timing);
    if (joined) for (const p of timed) p.p = Math.max(p.p, this.params.timing.pressureBase * 0.8);
    this.motions.push({ kind: 'draw', pts: timed, next: 0, t: 0, last: null, charId });
    const end = timed[timed.length - 1]!;
    this.planEnd = { x: end.x, y: end.y, lift: 0 };
  }

  private applyWobble(pts: Vec2[], seed: number, keepStart: boolean): void {
    const amp = this.params.wobble;
    if (amp <= 0) return;
    const freq = 1 / this.params.wobbleWavelength;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      // Fade the wobble in when continuing a joined stroke so the join stays seamless.
      const fade = keepStart ? Math.min(1, s / 0.03) : 1;
      pts[i]!.x += amp * fade * fbm1(s * freq, seed);
      pts[i]!.y += amp * fade * fbm1(s * freq, seed + 977);
    }
  }

  private planWipe(rect: Rect, charId: number): void {
    const midY = (rect.minY + rect.maxY) / 2;
    const from = { x: this.planEnd.x, y: this.planEnd.y };
    const to = { x: rect.minX, y: midY };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.motions.push({
      kind: 'travel',
      from,
      to,
      fromLift: this.planEnd.lift,
      toLift: 0.006,
      dur: 0.07 + dist / this.params.travelSpeed,
      t: 0,
      charId,
    });
    const width = rect.maxX - rect.minX;
    this.motions.push({ kind: 'wipe', rect, dur: 0.25 + width / this.params.wipeSpeed, t: 0, charId });
    this.planEnd = { x: rect.maxX, y: midY, lift: 0.006 };
  }

  private dropMotionsFor(charId: number): void {
    for (let i = this.motions.length - 1; i >= 0; i--) {
      if (this.motions[i]!.charId === charId) this.motions.splice(i, 1);
    }
    if (this.current && this.current.charId === charId) this.current = null;
    // Plans after this point assumed the stick would finish this letter.
    const last = this.motions[this.motions.length - 1] ?? this.current;
    this.planEnd = (last && endOf(last)) ?? { x: this.tool.x, y: this.tool.y, lift: Math.max(this.tool.lift, 0.01) };
  }

  /** Advances a motion by `budget` seconds. Returns unused time (and clears `current` when finished). */
  private advance(m: Motion, budget: number): number {
    const tool = this.tool;
    switch (m.kind) {
      case 'done': {
        const c = this.layout.chars.find((x) => x.id === m.charId);
        if (c) c.state = 'written';
        this.current = null;
        return budget;
      }
      case 'travel': {
        m.t += budget;
        const u = Math.min(1, m.t / m.dur);
        const e = u * u * (3 - 2 * u);
        const dist = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
        const arc = Math.min(this.params.liftHeight, 0.015 + dist * 0.22);
        tool.x = m.from.x + (m.to.x - m.from.x) * e;
        tool.y = m.from.y + (m.to.y - m.from.y) * e;
        tool.lift = m.fromLift + (m.toLift - m.fromLift) * e + arc * Math.sin(Math.PI * u);
        tool.down = false;
        tool.pressure = 0;
        if (u >= 1) {
          this.current = null;
          return m.t - m.dur;
        }
        return 0;
      }
      case 'wipe': {
        const before = Math.min(1, m.t / m.dur);
        m.t += budget;
        const u = Math.min(1, m.t / m.dur);
        const r = m.rect;
        const h = r.maxY - r.minY;
        tool.x = r.minX + (r.maxX - r.minX) * u;
        tool.y = (r.minY + r.maxY) / 2 + h * 0.4 * Math.sin(u * Math.PI * 7);
        tool.lift = 0.004;
        tool.down = false;
        tool.pressure = 0;
        this.sink.wipe(r, before, u);
        if (u >= 1) {
          this.current = null;
          return m.t - m.dur;
        }
        return 0;
      }
      case 'draw': {
        const pts = m.pts;
        const endT = pts[pts.length - 1]!.t;
        m.t += budget;
        const t = Math.min(m.t, endT);
        // Stamp through every sample passed this frame so fast strokes keep their curves.
        let prev = m.last ?? pts[0]!;
        while (m.next < pts.length && pts[m.next]!.t <= t) {
          const q = pts[m.next++]!;
          this.mark(m.charId, prev, q);
          prev = q;
        }
        let here: TimedPoint = prev;
        if (m.next < pts.length) {
          const b = pts[m.next]!;
          const w = b.t > prev.t ? (t - prev.t) / (b.t - prev.t) : 1;
          here = { x: prev.x + (b.x - prev.x) * w, y: prev.y + (b.y - prev.y) * w, p: prev.p + (b.p - prev.p) * w, t };
          this.mark(m.charId, prev, here);
        }
        m.last = here;
        tool.x = here.x;
        tool.y = here.y;
        tool.lift = 0;
        tool.down = true;
        tool.pressure = here.p;
        if (m.t >= endT) {
          this.current = null;
          return m.t - endT;
        }
        return 0;
      }
    }
  }

  private mark(charId: number, a: { x: number; y: number; p: number }, b: { x: number; y: number; p: number }): void {
    if (a.x === b.x && a.y === b.y) return;
    this.sink.stamp(a.x, a.y, a.p, b.x, b.y, b.p);
    let r = this.bounds.get(charId);
    if (!r) {
      r = emptyRect();
      this.bounds.set(charId, r);
    }
    expandRect(r, a.x, a.y, 0.05);
    expandRect(r, b.x, b.y, 0.05);
  }
}
