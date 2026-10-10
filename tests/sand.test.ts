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

  it('lets the release waves wash the words away', () => {
    const f = new SandField();
    for (let line = 0; line < 3; line++) {
      const y = 1.45 - line * 0.72;
      f.stamp(-2.5, y, 0.9, 2.5, y + 0.05, 0.9);
    }
    const tide = new Tide(3);
    tide.release();
    const dt = 1 / 30;
    let t = 0;
    while (t < 120 && (tide.pendingReleaseWaves > 0 || tide.mode === 'release')) {
      tide.update(dt);
      f.erode(dt, tide);
      t += dt;
    }
    expect(f.maxCarve()).toBeLessThan(0.0015);
  });
});

describe('Tide', () => {
  it('keeps the waterline wet', () => {
    const tide = new Tide(1);
    for (let i = 0; i < 600; i++) {
      tide.update(1 / 30);
      expect(tide.frontAt((i % 30) - 15)).toBeGreaterThan(0.1);
    }
  });

  it('idle waves stay well below the writing', () => {
    const tide = new Tide(2);
    let highest = 0;
    for (let i = 0; i < 30 * 120; i++) {
      tide.update(1 / 30);
      highest = Math.max(highest, tide.frontAt(0));
    }
    expect(highest).toBeLessThan(WATERLINE_Y - 2.35);
  });

  it('each release wave reaches a little higher, then the tide calms', () => {
    const tide = new Tide(5);
    tide.release();
    const peaks: number[] = [];
    let wave = -1;
    let peak = 0;
    for (let i = 0; i < 30 * 120 && (tide.mode === 'release' || tide.pendingReleaseWaves > 0); i++) {
      tide.update(1 / 30);
      if (tide.releaseWaves !== wave) {
        if (wave > 0) peaks.push(peak);
        wave = tide.releaseWaves;
        peak = 0;
      }
      peak = Math.max(peak, tide.frontAt(0));
    }
    expect(peaks.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeGreaterThan(peaks[i - 1]! - 0.2);
    expect(tide.mode).toBe('idle');
  });
});
