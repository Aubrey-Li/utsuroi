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
