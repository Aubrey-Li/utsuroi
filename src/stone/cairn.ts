import type { StonePlacement } from '../journal/kept';
import { createRng } from '../strokes/random';

/** Half-sizes of a stone (m): width, thickness, depth. */
export interface StoneShape {
  rx: number;
  ry: number;
  rz: number;
  /** Seed for the small lumps and the color. */
  seed: number;
}

/** Stones per cairn before a new one is started beside it. */
export const CAIRN_HEIGHT = 8;

/** A flat, smooth beach stone, the same every time for the same seed. */
export function stoneShape(seed: number): StoneShape {
  const r = createRng(seed);
  const rx = 0.17 + r() * 0.08;
  return { rx, rz: rx * (0.72 + r() * 0.18), ry: rx * (0.26 + r() * 0.1), seed };
}

/** Where cairn number n stands on the shore. */
export function cairnBase(n: number): { x: number; z: number } {
  return { x: 1.25 + n * 0.85, z: -2.1 - (n % 2) * 0.45 - n * 0.12 };
}

/**
 * Where a new stone settles: on top of the current cairn, slightly off
 * center and turned, or at the foot of a new cairn once it's tall enough.
 * `existing` lists the stones already placed (with their seeds), in order.
 */
export function nextPlacement(existing: readonly { place: StonePlacement; seed: number }[], seed: number): StonePlacement {
  const r = createRng(seed * 7 + existing.length);
  const lastCairn = existing.reduce((m, e) => Math.max(m, e.place.cairn), 0);
  const onLast = existing.filter((e) => e.place.cairn === lastCairn);
  const cairn = onLast.length >= CAIRN_HEIGHT ? lastCairn + 1 : lastCairn;
  const stack = existing.filter((e) => e.place.cairn === cairn).sort((a, b) => a.place.level - b.place.level);
  const base = cairnBase(cairn);
  const shape = stoneShape(seed);
  const top = stack[stack.length - 1];
  // Stones nest a little into the one below.
  const height = stack.reduce((h, e) => h + stoneShape(e.seed).ry * 2 * 0.86, 0);
  const lean = top ? { x: top.place.x - base.x, z: top.place.z - base.z } : { x: 0, z: 0 };
  return {
    cairn,
    level: stack.length,
    x: base.x + lean.x * 0.7 + (r() - 0.5) * 0.05,
    y: height + shape.ry * 0.86,
    z: base.z + lean.z * 0.7 + (r() - 0.5) * 0.05,
    rotY: r() * Math.PI * 2,
    tiltX: (r() - 0.5) * 0.08,
    tiltZ: (r() - 0.5) * 0.08,
  };
}
