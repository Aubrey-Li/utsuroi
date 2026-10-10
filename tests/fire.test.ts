import { describe, expect, it } from 'vitest';
import { burnAt, frontSpeed, isBurntOut, makeBurnMap, packBurnMap, sampleFront } from '../src/fire/burn';
import { createRng } from '../src/strokes/random';

const ignition = { u: 0.02, v: 0.98 };

describe('burn map', () => {
  const map = makeBurnMap(4, ignition);

  it('starts at the ignition point and reaches the far corner last', () => {
    expect(burnAt(map, 0.02, 0.98)).toBeLessThan(0.05);
    expect(burnAt(map, 0.98, 0.02)).toBeGreaterThan(0.85);
    expect(burnAt(map, 0.5, 0.5)).toBeGreaterThan(burnAt(map, 0.2, 0.8));
  });

  it('spans the whole range 0..1', () => {
    let min = 1;
    let max = 0;
    for (const v of map) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeCloseTo(0, 6);
    expect(max).toBeCloseTo(1, 6);
  });

  it('is uneven: points the same distance away burn at different times', () => {
    const along = [0.3, 0.4, 0.5, 0.6].map((t) => burnAt(map, ignition.u + t * 0.6, ignition.v - t * 0.4));
    const ring: number[] = [];
    for (let a = 0.05; a < 1.5; a += 0.1) ring.push(burnAt(map, ignition.u + Math.cos(a) * 0.5 * 1.4, ignition.v - Math.sin(a) * 0.5));
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.03);
    expect(along[3]!).toBeGreaterThan(along[0]!);
  });

  it('finds points on the burning edge', () => {
    const rng = createRng(1);
    const p = sampleFront(map, 0.4, rng, 200)!;
    expect(p).not.toBeNull();
    expect(Math.abs(burnAt(map, p.u, p.v) - 0.4)).toBeLessThan(0.012);
  });

  it('burns the whole page in about ten to fifteen seconds', () => {
    let front = 0;
    let t = 0;
    while (!isBurntOut(front)) {
      front += frontSpeed(front) / 60;
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(9);
    expect(t).toBeLessThan(16);
  });

  it('packs into bytes for the GPU', () => {
    const bytes = packBurnMap(map);
    expect(bytes.length).toBe(map.length);
    expect(bytes.reduce((m, b) => Math.max(m, b), 0)).toBe(255);
  });
});
