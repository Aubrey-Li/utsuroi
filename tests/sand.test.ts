import { describe, expect, it } from 'vitest';
import { SandField, WATERLINE_Y, ZONE } from '../src/sand/field';
import { Tide } from '../src/sand/tide';

const cell = (f: SandField, x: number, y: number) => f.carveAt(x, y);

describe('SandField', () => {
  it('carves a groove under the stick with a low ridge beside it', () => {
    const f = new SandField();
    f.stamp(0, 1, 0.8, 0.3, 1, 0.8);
    expect(cell(f, 0.15, 1)).toBeLessThan(-0.005);
    const r = f.brush.radius;
    let ridge = 0;
    for (let d = r; d < r * 2; d += 0.002) ridge = Math.max(ridge, cell(f, 0.15, 1 + d));
    expect(ridge).toBeGreaterThan(0);
    expect(ridge).toBeLessThan(f.brush.ridge * 1.5);
  });

  it('never carves the outermost cells of the grid', () => {
    const f = new SandField();
    f.stamp(ZONE.x0, ZONE.y1, 1, ZONE.x1, ZONE.y1, 1);
    for (let i = 0; i < ZONE.w; i++) expect(f.carve[(ZONE.h - 1) * ZONE.w + i]).toBe(0);
  });

  it('can be written on anywhere on the beach, not just in the middle', () => {
    const f = new SandField();
    f.stamp(6.5, 4.6, 1, 6.6, 4.6, 1);
    f.stamp(-6.5, -2.5, 1, -6.4, -2.5, 1);
    expect(f.carveAt(6.55, 4.6)).toBeLessThan(-0.005);
    expect(f.carveAt(-6.45, -2.5)).toBeLessThan(-0.005);
    expect(f.maxCarve()).toBeGreaterThan(0.005);
    f.packCarve();
    f.clear();
    f.packCarve();
    expect(f.maxCarve()).toBe(0);
    expect(f.carveBytes.every((b) => b === 128)).toBe(true);
  });

  it('only repacks rows that changed, and keeps earlier rows intact', () => {
    const f = new SandField();
    f.packCarve();
    f.stamp(0, 0, 1, 0.1, 0, 1);
    f.packCarve();
    const row = (y: number) => Math.floor((y - ZONE.y0) / ((ZONE.y1 - ZONE.y0) / ZONE.h));
    const col = Math.floor((0.05 - ZONE.x0) / ((ZONE.x1 - ZONE.x0) / ZONE.w));
    expect(f.carveBytes[row(0) * ZONE.w + col]).toBeLessThan(110);
    f.stamp(0, 3, 1, 0.1, 3, 1);
    f.packCarve();
    expect(f.carveBytes[row(0) * ZONE.w + col]).toBeLessThan(110);
    expect(f.carveBytes[row(3) * ZONE.w + col]).toBeLessThan(110);
  });

  it('wipes a letter back to nearly flat sand', () => {
    const f = new SandField();
    f.stamp(0, 1, 1, 0.1, 1.1, 1);
    const before = f.maxCarve();
    f.wipe({ minX: -0.1, minY: 0.85, maxX: 0.2, maxY: 1.25 }, 0, 1);
    expect(f.maxCarve()).toBeLessThan(before * 0.2);
  });

  it('packs carve depth into bytes centred on 128', () => {
    const f = new SandField();
    expect(f.packCarve()).toBe(true);
    expect(f.carveBytes[0]).toBe(128);
    expect(f.packCarve()).toBe(false); // nothing changed since
    f.stamp(0, 1, 1, 0.05, 1, 1);
    f.packCarve();
    const k = Math.floor((1 - ZONE.y0) / ((ZONE.y1 - ZONE.y0) / ZONE.h)) * ZONE.w + Math.floor((0.02 - ZONE.x0) / ((ZONE.x1 - ZONE.x0) / ZONE.w));
    expect(f.carveBytes[k]).toBeLessThan(110);
  });

  it('the sea washes the words away on its own, given time', () => {
    const f = new SandField();
    for (let line = 0; line < 3; line++) {
      const y = 1.4 - line * 0.64;
      f.stamp(-2.5, y, 0.9, 2.5, y + 0.05, 0.9);
    }
    const before = f.maxCarve();
    const tide = new Tide(3);
    const dt = 1 / 30;
    for (let t = 0; t < 8 * 60; t += dt) {
      tide.update(dt);
      f.erode(dt, tide);
    }
    expect(f.maxCarve()).toBeLessThan(before * 0.1);
  });

  it('finds the deepest mark inside a rectangle only', () => {
    const f = new SandField();
    f.stamp(0, 1, 1, 0.1, 1, 1);
    expect(f.maxCarveIn({ minX: -0.2, maxX: 0.3, minY: 0.8, maxY: 1.2 })).toBeGreaterThan(0.005);
    expect(f.maxCarveIn({ minX: -2, maxX: -1, minY: 0.8, maxY: 1.2 })).toBe(0);
  });
});

function simulate(tide: Tide, seconds: number, each: (front: number) => void) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    tide.update(dt);
    each(tide.frontAt(0));
  }
}

/** Lets the sea run against writing until it's gone, the way the ocean scene does. */
function washUntilClear(f: SandField, tide: Tide, maxSeconds = 120) {
  const before = f.maxCarve();
  const dt = 1 / 30;
  let t = 0;
  let nextSeek = 0;
  let wavesBefore = tide.waves;
  let bigBefore = tide.bigWaves;
  while (t < maxSeconds) {
    if (t >= nextSeek) {
      nextSeek = t + 0.5;
      tide.seek = f.farthestMark();
    }
    tide.update(dt);
    f.erode(dt, tide);
    t += dt;
    if (Math.round(t / dt) % 15 === 0) {
      f.packCarve();
      if (f.maxCarve() < before * 0.08) break;
    }
  }
  return { seconds: t, waves: tide.waves - wavesBefore, big: tide.bigWaves - bigBefore, left: f.maxCarve() / before };
}

describe('the sea coming for the writing', () => {
  it('finds how far up the beach the farthest mark is', () => {
    const f = new SandField();
    expect(f.farthestMark()).toBeNull();
    f.stamp(0, 1, 1, 0.2, 1, 1);
    f.stamp(1, -2, 1, 1.2, -2, 1);
    f.packCarve();
    expect(f.farthestMark()!).toBeGreaterThan(WATERLINE_Y + 2 - 0.1);
    expect(f.farthestMark()!).toBeLessThan(WATERLINE_Y + 2 + 0.1);
  });

  for (const [where, y] of [
    ['near the water', 3.2],
    ['in the middle of the beach', 0.8],
    ['at the bottom of a phone screen', -2.6],
  ] as const) {
    it(`washes writing ${where} away within about three big waves`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const f = new SandField();
        for (let k = 0; k < 4; k++) f.stamp(-2 + k, y, 0.9, -1.5 + k, y + 0.3, 0.9);
        f.packCarve();
        const r = washUntilClear(f, new Tide(seed * 37));
        expect(r.left, `seed ${seed}`).toBeLessThan(0.08);
        expect(r.big, `seed ${seed}`).toBeLessThanOrEqual(4);
        expect(r.seconds, `seed ${seed}`).toBeLessThan(75);
      }
    });
  }

  it('leaves writing alone while someone is still writing', () => {
    const f = new SandField();
    f.stamp(-1, -2.6, 0.9, 1, -2.6, 0.9);
    f.packCarve();
    const tide = new Tide(8);
    tide.writing = true;
    const before = f.maxCarve();
    for (let t = 0; t < 30; t += 1 / 30) {
      tide.seek = f.farthestMark();
      tide.update(1 / 30);
      f.erode(1 / 30, tide);
    }
    expect(f.maxCarve()).toBeGreaterThan(before * 0.9);
  });
});

describe('Tide', () => {
  it('keeps the waterline wet', () => {
    const tide = new Tide(1);
    simulate(tide, 60, (f) => expect(f).toBeGreaterThan(0.1));
  });

  it('mostly laps at the waterline, but now and then runs up into the writing', () => {
    const tide = new Tide(2);
    const peaks: number[] = [];
    let wave = tide.waves;
    let peak = 0;
    simulate(tide, 10 * 60, (f) => {
      if (tide.waves !== wave) {
        peaks.push(peak);
        wave = tide.waves;
        peak = 0;
      }
      peak = Math.max(peak, f);
    });
    const intoWriting = peaks.filter((p) => p > WATERLINE_Y - 1.5).length;
    const small = peaks.filter((p) => p < 2).length;
    expect(peaks.length).toBeGreaterThan(60);
    expect(small / peaks.length).toBeGreaterThan(0.6);
    expect(intoWriting).toBeGreaterThan(2);
  });

  it('eases off the big waves while someone is writing', () => {
    const calm = new Tide(4);
    const busy = new Tide(4);
    busy.writing = true;
    simulate(calm, 15 * 60, () => {});
    simulate(busy, 15 * 60, () => {});
    expect(busy.bigWaves).toBeLessThan(calm.bigWaves);
  });

  it('varies how far waves reach and how often they come', () => {
    const tide = new Tide(9);
    const gaps: number[] = [];
    let lastWaveAt = 0;
    let wave = tide.waves;
    let t = 0;
    simulate(tide, 5 * 60, () => {
      t += 1 / 30;
      if (tide.waves !== wave) {
        gaps.push(t - lastWaveAt);
        lastWaveAt = t;
        wave = tide.waves;
      }
    });
    const min = Math.min(...gaps.slice(1));
    const max = Math.max(...gaps.slice(1));
    expect(max - min).toBeGreaterThan(2);
  });
});
