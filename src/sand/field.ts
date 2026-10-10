import type { Rect } from '../strokes/types';
import type { WriterSink } from '../strokes/writer';
import type { Tide } from './tide';

/**
 * Sand coordinates: x to the right, y away from the viewer (world z = -y),
 * meters. The waterline runs along y = WATERLINE_Y.
 */
export const WATERLINE_Y = 5;

/** High-resolution grid that holds carved grooves, covering only the writing area. */
export const ZONE = { x0: -3.2, x1: 3.2, y0: -0.4, y1: 2.35, w: 1024, h: 440 } as const;

/** Low-resolution grid for water, wetness and foam, covering the whole visible beach. */
export const BEACH = { x0: -8, x1: 8, y0: -9, y1: 6.6, w: 512, h: 500 } as const;

/** Carve depth that maps to the ends of the 8-bit texture range (m). */
export const CARVE_RANGE = 0.02;

export interface BrushParams {
  /** Radius of the stick's tip (m). */
  radius: number;
  /** Groove depth at full pressure (m). */
  depth: number;
  /** Height of the sand pushed up beside the groove (m). */
  ridge: number;
}

export const DEFAULT_BRUSH: BrushParams = { radius: 0.0135, depth: 0.0105, ridge: 0.0017 };

const ZONE_DX = (ZONE.x1 - ZONE.x0) / ZONE.w;
const ZONE_DY = (ZONE.y1 - ZONE.y0) / ZONE.h;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The sand the stick writes in and the tide washes over.
 *
 * Simulated on the CPU for this prototype: grooves are stamped into a
 * height grid, and waves relax and blur it back to flat. The shader reads
 * the packed bytes and derives normals and shading on the GPU.
 */
export class SandField implements WriterSink {
  readonly carve = new Float32Array(ZONE.w * ZONE.h);
  readonly carveBytes = new Uint8Array(ZONE.w * ZONE.h).fill(128);
  readonly wet = new Float32Array(BEACH.w * BEACH.h);
  readonly foam = new Float32Array(BEACH.w * BEACH.h);
  readonly waterBytes = new Uint8Array(BEACH.w * BEACH.h * 4);
  carveDirty = true;
  brush: BrushParams = { ...DEFAULT_BRUSH };
  private readonly fronts = new Float32Array(Math.max(ZONE.w, BEACH.w));

  stamp(x0: number, y0: number, p0: number, x1: number, y1: number, p1: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const step = ZONE_DX * 0.4;
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= n; s++) {
      if (s === 0 && len > 0) continue; // the previous segment already stamped this point
      const w = s / n;
      this.dab(x0 + (x1 - x0) * w, y0 + (y1 - y0) * w, p0 + (p1 - p0) * w);
    }
  }

  /** One press of the stick: a rounded groove with sand pushed up on either side. */
  dab(x: number, y: number, p: number): void {
    const b = this.brush;
    const r = b.radius * (0.75 + 0.45 * p);
    const depth = b.depth * (0.45 + 0.75 * p);
    const ridge = b.ridge * (0.4 + 0.8 * p);
    const outer = r * 1.85;
    // The outermost cells stay flat so the edge of the grid never shows and erosion can reach everything.
    const i0 = Math.max(1, Math.floor((x - outer - ZONE.x0) / ZONE_DX));
    const i1 = Math.min(ZONE.w - 2, Math.ceil((x + outer - ZONE.x0) / ZONE_DX));
    const j0 = Math.max(1, Math.floor((y - outer - ZONE.y0) / ZONE_DY));
    const j1 = Math.min(ZONE.h - 2, Math.ceil((y + outer - ZONE.y0) / ZONE_DY));
    if (i0 > i1 || j0 > j1) return;
    const c = this.carve;
    for (let j = j0; j <= j1; j++) {
      const cy = ZONE.y0 + (j + 0.5) * ZONE_DY - y;
      for (let i = i0; i <= i1; i++) {
        const cx = ZONE.x0 + (i + 0.5) * ZONE_DX - x;
        const d = Math.sqrt(cx * cx + cy * cy);
        if (d > outer) continue;
        const k = j * ZONE.w + i;
        if (d < r) {
          const q = d / r;
          const target = -depth * Math.pow(1 - q * q, 0.6);
          if (target < c[k]!) c[k] = target;
        } else if (c[k]! > -depth * 0.2) {
          const bump = ridge * Math.sin((Math.PI * (d - r)) / (outer - r));
          if (c[k]! < bump) c[k] = Math.min(bump, c[k]! + bump * 0.22);
        }
      }
    }
    this.carveDirty = true;
  }

  /** Smooths part of a rectangle (left to right) back toward flat sand, like the flat of a stick. */
  wipe(rect: Rect, fromFrac: number, toFrac: number): void {
    const width = rect.maxX - rect.minX;
    const xa = rect.minX + width * fromFrac - 0.02;
    const xb = rect.minX + width * toFrac;
    const i0 = Math.max(1, Math.floor((xa - ZONE.x0) / ZONE_DX));
    const i1 = Math.min(ZONE.w - 2, Math.ceil((xb - ZONE.x0) / ZONE_DX));
    const j0 = Math.max(1, Math.floor((rect.minY - ZONE.y0) / ZONE_DY));
    const j1 = Math.min(ZONE.h - 2, Math.ceil((rect.maxY - ZONE.y0) / ZONE_DY));
    for (let j = j0; j <= j1; j++) {
      // Soften the top and bottom edges of the swept band.
      const edge = Math.min(j - j0, j1 - j) / 6;
      const keep = 1 - 0.9 * Math.min(1, edge);
      for (let i = i0; i <= i1; i++) this.carve[j * ZONE.w + i]! *= keep;
    }
    this.carveDirty = true;
  }

  /** Waves relax and blur the grooves they cover; foamy water near the front works fastest. */
  erode(dt: number, tide: Tide): void {
    const maxFront = tide.maxFront;
    const strength = tide.erosion;
    const c = this.carve;
    for (let i = 0; i < ZONE.w; i++) this.fronts[i] = tide.frontAt(ZONE.x0 + (i + 0.5) * ZONE_DX);
    let touched = false;
    for (let j = 1; j < ZONE.h - 1; j++) {
      const u = WATERLINE_Y - (ZONE.y0 + (j + 0.5) * ZONE_DY);
      if (u > maxFront) continue;
      const row = j * ZONE.w;
      for (let i = 1; i < ZONE.w - 1; i++) {
        const f = this.fronts[i]!;
        if (u >= f) continue;
        const k = row + i;
        const v = c[k]!;
        if (v === 0) continue;
        const foamy = smoothstep(0.4, 0, f - u);
        const rate = strength * (0.35 + 2.4 * foamy);
        const avg = (c[k - 1]! + c[k + 1]! + c[k - ZONE.w]! + c[k + ZONE.w]!) * 0.25;
        const alpha = Math.min(0.24, rate * dt * 9);
        let next = (v + (avg - v) * alpha) * Math.exp(-rate * dt);
        if (Math.abs(next) < 2e-5) next = 0;
        c[k] = next;
        touched = true;
      }
    }
    if (touched) this.carveDirty = true;
  }

  /** Updates wetness, foam and water depth for the whole beach and packs them for the GPU. */
  updateWater(dt: number, tide: Tide): void {
    const dxB = (BEACH.x1 - BEACH.x0) / BEACH.w;
    const dyB = (BEACH.y1 - BEACH.y0) / BEACH.h;
    for (let i = 0; i < BEACH.w; i++) this.fronts[i] = tide.frontAt(BEACH.x0 + (i + 0.5) * dxB);
    const dry = Math.exp(-dt / 70);
    const foamFade = Math.exp(-dt * 0.9);
    const rushFoam = tide.rushing ? 1 : 0.55;
    const out = this.waterBytes;
    for (let j = 0; j < BEACH.h; j++) {
      const u = WATERLINE_Y - (BEACH.y0 + (j + 0.5) * dyB);
      for (let i = 0; i < BEACH.w; i++) {
        const k = j * BEACH.w + i;
        const f = this.fronts[i]!;
        const depth = Math.max(0, f - u);
        // Soft edges (a few cm) keep the waterline smooth between texels.
        const cover = smoothstep(-0.05, 0.05, f - u);
        let wet = Math.max(this.wet[k]! * dry, cover);
        let foam = this.foam[k]! * foamFade;
        const front = smoothstep(0.3, 0.03, depth) * cover * rushFoam;
        if (front > foam) foam = front;
        if (wet > 1) wet = 1;
        this.wet[k] = wet;
        this.foam[k] = foam;
        const o = k * 4;
        out[o] = wet * 255;
        out[o + 1] = Math.min(1, depth / 0.9) * 255;
        out[o + 2] = Math.min(1, foam) * 255;
        out[o + 3] = 255;
      }
    }
  }

  packCarve(): boolean {
    if (!this.carveDirty) return false;
    const c = this.carve;
    const b = this.carveBytes;
    const scale = 127 / CARVE_RANGE;
    for (let k = 0; k < c.length; k++) {
      const v = 128 + c[k]! * scale;
      b[k] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    this.carveDirty = false;
    return true;
  }

  /** Carve depth at a sand position (m, negative in grooves). */
  carveAt(x: number, y: number): number {
    const i = Math.floor((x - ZONE.x0) / ZONE_DX);
    const j = Math.floor((y - ZONE.y0) / ZONE_DY);
    if (i < 0 || j < 0 || i >= ZONE.w || j >= ZONE.h) return 0;
    return this.carve[j * ZONE.w + i]!;
  }

  /** Deepest groove left anywhere, so we can tell when the sea has taken everything. */
  maxCarve(): number {
    let m = 0;
    const c = this.carve;
    for (let k = 0; k < c.length; k++) {
      const v = c[k]! < 0 ? -c[k]! : c[k]!;
      if (v > m) m = v;
    }
    return m;
  }

  /** Lets faint leftover marks settle into flat sand. */
  settle(dt: number): void {
    const f = Math.exp(-dt * 0.6);
    const c = this.carve;
    for (let k = 0; k < c.length; k++) if (c[k] !== 0) c[k] = Math.abs(c[k]!) < 1e-5 ? 0 : c[k]! * f;
    this.carveDirty = true;
  }

  clear(): void {
    this.carve.fill(0);
    this.carveDirty = true;
  }
}
