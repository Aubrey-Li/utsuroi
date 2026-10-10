import { describe, expect, it } from 'vitest';
import { allGone, liftDelays, makeFlier, stepFliers } from '../src/wind/flight';

const bounds = { maxX: 7, maxY: 7, maxAge: 9 };

describe('wind flight', () => {
  it('lifts words roughly in reading order', () => {
    const d = liftDelays(20, 3);
    expect(d[19]!).toBeGreaterThan(d[0]!);
    expect(d.every((x) => x >= 0)).toBe(true);
  });

  it('carries every character out of view within a few seconds', () => {
    const delays = liftDelays(40, 5);
    const fliers = delays.map((delay, i) => makeFlier(-3 + (i % 10) * 0.6, 2 - Math.floor(i / 10) * 0.6, 0, delay, i * 31 + 1));
    let t = 0;
    while (!allGone(fliers) && t < 20) {
      stepFliers(fliers, 1 / 60, 1, t, bounds);
      t += 1 / 60;
    }
    expect(allGone(fliers)).toBe(true);
    expect(t).toBeLessThan(12);
  });

  it('nothing moves without wind beyond a gentle drift', () => {
    const f = makeFlier(0, 2, 0, 0, 9);
    for (let i = 0; i < 60; i++) stepFliers([f], 1 / 60, 0, i / 60, bounds);
    expect(Math.abs(f.x)).toBeLessThan(1.5);
  });

  it('blows downwind, to the right and upward', () => {
    const f = makeFlier(0, 2, 0, 0, 4);
    for (let i = 0; i < 120; i++) stepFliers([f], 1 / 60, 1, i / 60, bounds);
    expect(f.x).toBeGreaterThan(1);
    expect(f.y).toBeGreaterThan(2);
  });
});
