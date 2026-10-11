import { describe, expect, it } from 'vitest';
import { CAIRN_HEIGHT, cairnBase, nextPlacement, stoneShape } from '../src/stone/cairn';
import type { StonePlacement } from '../src/journal/kept';

function build(n: number) {
  const placed: { place: StonePlacement; seed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const seed = 100 + i * 13;
    placed.push({ seed, place: nextPlacement(placed, seed) });
  }
  return placed;
}

describe('stones and cairns', () => {
  it('makes the same flat stone from the same seed', () => {
    expect(stoneShape(5)).toEqual(stoneShape(5));
    const s = stoneShape(9);
    expect(s.ry).toBeLessThan(s.rx * 0.4);
    expect(s.rz).toBeLessThanOrEqual(s.rx);
  });

  it('stacks each stone on top of the last', () => {
    const placed = build(5);
    placed.forEach((p, i) => {
      expect(p.place.cairn).toBe(0);
      expect(p.place.level).toBe(i);
      if (i > 0) expect(p.place.y).toBeGreaterThan(placed[i - 1]!.place.y);
    });
  });

  it('keeps a cairn standing: each stone stays close above the one below', () => {
    const placed = build(CAIRN_HEIGHT);
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1]!.place;
      const b = placed[i]!.place;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.06);
    }
  });

  it('starts a new cairn beside the last once it is tall enough', () => {
    const placed = build(CAIRN_HEIGHT + 2);
    expect(placed[CAIRN_HEIGHT]!.place.cairn).toBe(1);
    expect(placed[CAIRN_HEIGHT]!.place.level).toBe(0);
    expect(placed[CAIRN_HEIGHT + 1]!.place.level).toBe(1);
    const base = cairnBase(1);
    expect(Math.abs(placed[CAIRN_HEIGHT]!.place.x - base.x)).toBeLessThan(0.05);
  });
});
