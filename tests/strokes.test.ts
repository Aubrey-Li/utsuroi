import { describe, expect, it } from 'vitest';
import fontData from '../src/strokes/fonts/ems-allure.json';
import { ALLURE_JOINS, StrokeFont, prepareGlyph, type StrokeFontData } from '../src/strokes/glyphs';
import { codePoints, diffText } from '../src/strokes/input-diff';
import { DEFAULT_LAYOUT, SandLayout } from '../src/strokes/layout';
import { createRng } from '../src/strokes/random';
import { catmullRom, pathLength, resample } from '../src/strokes/smooth';
import { curvatures, timeStroke } from '../src/strokes/timing';
import type { Rect, Vec2 } from '../src/strokes/types';
import { DEFAULT_WRITER, SandWriter, type WriterSink } from '../src/strokes/writer';

const data = fontData as StrokeFontData;
const font = new StrokeFont(data);

function near(p: Vec2, x: number, y: number, tol = 1): boolean {
  return Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol;
}

describe('font data', () => {
  it('has every lowercase and uppercase Latin letter and common punctuation', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'"-') {
      expect(font.has(ch), ch).toBe(true);
    }
  });

  it('keeps the font metadata the layout depends on', () => {
    expect(data.unitsPerEm).toBe(1000);
    expect(data.xHeight).toBe(300);
  });
});

describe('prepareGlyph', () => {
  it('reverses "a" so it starts at the top of the bowl and ends on its exit tail', () => {
    const g = prepareGlyph(data.glyphs['a']!, ALLURE_JOINS);
    const s = g.strokes[0]!;
    expect(near(s[0]!, 324, 343)).toBe(true);
    expect(near(s[s.length - 1]!, 495, 183)).toBe(true);
    expect(g.joinsOut).toBe(true);
  });

  it('defers the dot of "i" and the crossbar of "t" to the end of the word', () => {
    const i = prepareGlyph(data.glyphs['i']!, ALLURE_JOINS);
    expect(i.strokes).toHaveLength(1);
    expect(i.deferred).toHaveLength(1);
    expect(i.joinsIn).toBe(true);
    const t = prepareGlyph(data.glyphs['t']!, ALLURE_JOINS);
    expect(t.deferred).toHaveLength(1);
    const bar = t.deferred[0]!;
    expect(bar[bar.length - 1]!.x).toBeGreaterThan(bar[0]!.x); // crossed left to right
  });

  it('writes the exit tail of "o" right after its bowl', () => {
    const o = prepareGlyph(data.glyphs['o']!, ALLURE_JOINS);
    expect(o.strokes).toHaveLength(2);
    expect(o.deferred).toHaveLength(0);
    const tail = o.strokes[1]!;
    expect(near(tail[tail.length - 1]!, 391 - 31.5, 183, 2)).toBe(true);
  });

  it('every joining lowercase letter ends exactly where the next one can start', () => {
    for (const ch of 'acefghilmnoqrtuxyz') {
      const g = prepareGlyph(data.glyphs[ch]!, ALLURE_JOINS);
      const last = g.strokes[g.strokes.length - 1]!;
      const end = last[last.length - 1]!;
      expect(Math.hypot(end.x - (g.advance - 31.5), end.y - 183), ch).toBeLessThan(ALLURE_JOINS.tolerance);
    }
  });

  it('returns independent copies so callers can transform points', () => {
    const a = font.get('e')!;
    a.strokes[0]![0]!.x = 9999;
    expect(font.get('e')!.strokes[0]![0]!.x).not.toBe(9999);
  });
});

describe('smoothing', () => {
  const zigzag: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
    { x: 3, y: 1 },
  ];

  it('passes through every control point', () => {
    const out = catmullRom(zigzag, 6);
    for (const p of zigzag) expect(out.some((q) => near(q, p.x, p.y, 1e-9))).toBe(true);
  });

  it('resamples to even spacing and keeps both ends', () => {
    const out = resample(catmullRom(zigzag, 8), 0.05);
    for (let i = 1; i < out.length - 1; i++) {
      const d = Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y);
      expect(d).toBeLessThanOrEqual(0.0501);
      expect(d).toBeGreaterThan(0.03);
    }
    expect(near(out[0]!, 0, 0, 1e-9)).toBe(true);
    expect(near(out[out.length - 1]!, 3, 1, 1e-9)).toBe(true);
  });
});

describe('timing', () => {
  const circle = (r: number): Vec2[] =>
    resample(
      Array.from({ length: 200 }, (_, i) => ({ x: r * Math.cos((i / 199) * Math.PI * 2), y: r * Math.sin((i / 199) * Math.PI * 2) })),
      0.004,
    );
  const line: Vec2[] = resample(
    [
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
    ],
    0.004,
  );

  it('measures curvature as 1/radius', () => {
    const k = curvatures(circle(0.05));
    const mid = k[Math.floor(k.length / 2)]!;
    expect(mid).toBeGreaterThan(17);
    expect(mid).toBeLessThan(23);
  });

  it('moves slower around tight curves than along straight lines (two-thirds power law)', () => {
    const c = circle(0.03);
    const tc = timeStroke(c);
    const tl = timeStroke(line);
    const speedCurve = pathLength(c) / tc[tc.length - 1]!.t;
    const speedLine = pathLength(line) / tl[tl.length - 1]!.t;
    expect(speedLine).toBeGreaterThan(speedCurve * 1.5);
  });

  it('produces increasing time and pressure within 0..1', () => {
    const t = timeStroke(circle(0.08));
    for (let i = 1; i < t.length; i++) expect(t[i]!.t).toBeGreaterThan(t[i - 1]!.t);
    for (const p of t) {
      expect(p.p).toBeGreaterThanOrEqual(0);
      expect(p.p).toBeLessThanOrEqual(1);
    }
    expect(t[0]!.p).toBeGreaterThan(t[t.length - 1]!.p); // lands firmly, trails off
  });
});

describe('SandLayout', () => {
  const narrow = { ...DEFAULT_LAYOUT, width: 1.4, maxLines: 2 };

  it('moves an unstarted word to the next line when it runs out of room', () => {
    const layout = new SandLayout(font, narrow, createRng(1));
    for (const ch of 'hi ') layout.add(ch);
    const word = 'there'.split('').map((ch) => layout.add(ch)!);
    expect(word.every((c) => c.line === 1)).toBe(true);
    expect(word[0]!.x).toBeCloseTo(narrow.left);
  });

  it('breaks a word that is already being written where it is', () => {
    const layout = new SandLayout(font, narrow, createRng(1));
    for (const ch of 'hi ') layout.add(ch);
    const t = layout.add('t')!;
    t.state = 'written';
    const rest = 'here'.split('').map((ch) => layout.add(ch)!);
    expect(t.line).toBe(0);
    expect(rest.some((c) => c.line === 1)).toBe(true);
  });

  it('refuses characters once the last line is full', () => {
    const layout = new SandLayout(font, { ...narrow, maxLines: 1 }, createRng(2));
    let accepted = 0;
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') if (layout.add(ch)) accepted++;
    expect(accepted).toBeGreaterThan(2);
    expect(accepted).toBeLessThan(26);
    expect(layout.add('\n')).toBeNull();
  });

  it('restores the pen position on backspace', () => {
    const layout = new SandLayout(font, DEFAULT_LAYOUT, createRng(3));
    layout.add('a');
    const b = layout.add('b')!;
    layout.removeLast();
    const again = layout.add('c')!;
    expect(again.x).toBeCloseTo(b.x);
  });
});

class RecordingSink implements WriterSink {
  stamps: { x0: number; y0: number; x1: number; y1: number }[] = [];
  wipes: { rect: Rect; to: number }[] = [];
  stamp(x0: number, y0: number, _p0: number, x1: number, y1: number): void {
    this.stamps.push({ x0, y0, x1, y1 });
  }
  wipe(rect: Rect, _from: number, to: number): void {
    this.wipes.push({ rect, to });
  }
}

function makeWriter(seed = 4) {
  const sink = new RecordingSink();
  const layout = new SandLayout(font, DEFAULT_LAYOUT, createRng(seed));
  const writer = new SandWriter(layout, DEFAULT_WRITER, sink);
  return { sink, layout, writer };
}

function run(writer: SandWriter, seconds: number, dt = 1 / 60): number {
  let t = 0;
  while (t < seconds) {
    writer.update(dt);
    t += dt;
    if (!writer.busy) break;
  }
  return t;
}

describe('SandWriter', () => {
  it('writes typed letters into the sand and finishes', () => {
    const { sink, writer, layout } = makeWriter();
    for (const ch of 'hello') writer.type(ch);
    expect(sink.stamps).toHaveLength(0); // typing alone draws nothing
    run(writer, 20);
    expect(writer.busy).toBe(false);
    expect(sink.stamps.length).toBeGreaterThan(100);
    expect(layout.chars.every((c) => c.state === 'written')).toBe(true);
    expect(writer.markedLetters).toBe(5);
  });

  it('writes at a natural handwriting pace', () => {
    const { writer } = makeWriter();
    for (const ch of 'remember') writer.type(ch);
    const seconds = run(writer, 30);
    const lettersPerSecond = 8 / seconds;
    expect(lettersPerSecond).toBeGreaterThan(1.5);
    expect(lettersPerSecond).toBeLessThan(6);
  });

  it('dots the i after the rest of the word', () => {
    const { sink, writer, layout } = makeWriter();
    for (const ch of 'hi ') writer.type(ch);
    run(writer, 20);
    const i = layout.chars[1]!;
    const dotY = i.y + 438 * layout.unit; // the dot sits well above the x-height
    const last = sink.stamps[sink.stamps.length - 1]!;
    expect(last.y1).toBeGreaterThan(dotY - 0.05);
  });

  it('never draws a letter that was deleted before the stick reached it', () => {
    const { sink, writer } = makeWriter();
    writer.type('l');
    writer.type('W');
    writer.backspace();
    run(writer, 20);
    const maxX = Math.max(...sink.stamps.map((s) => Math.max(s.x0, s.x1)));
    expect(maxX).toBeLessThan(DEFAULT_LAYOUT.left + 0.3);
    expect(sink.wipes).toHaveLength(0);
  });

  it('sweeps away a letter that was already written', () => {
    const { sink, writer } = makeWriter();
    writer.type('o');
    run(writer, 20);
    writer.backspace();
    run(writer, 20);
    expect(sink.wipes.length).toBeGreaterThan(0);
    expect(sink.wipes[sink.wipes.length - 1]!.to).toBe(1);
    expect(writer.markedLetters).toBe(0);
  });

  it('cancels a letter mid-stroke', () => {
    const { sink, writer } = makeWriter();
    writer.type('m');
    writer.update(0.25); // partway through
    writer.backspace();
    run(writer, 20);
    expect(writer.busy).toBe(false);
    expect(sink.wipes.length).toBeGreaterThan(0);
  });

  it('speeds up when the typist gets ahead', () => {
    const slow = makeWriter(5);
    const fast = makeWriter(5);
    slow.writer.type('a');
    const tSlow = run(slow.writer, 10);
    for (const ch of 'aaaaaaaaaa') fast.writer.type(ch);
    const tFast = run(fast.writer, 30);
    expect(tFast / 10).toBeLessThan(tSlow);
  });
});

describe('diffText', () => {
  it('detects appends and backspaces at the end', () => {
    expect(diffText(codePoints('hel'), codePoints('hell'))).toEqual({ remove: 0, add: ['l'] });
    expect(diffText(codePoints('hell'), codePoints('hel'))).toEqual({ remove: 1, add: [] });
  });

  it('treats an edit in the middle as deleting back to it', () => {
    expect(diffText(codePoints('abcd'), codePoints('abXd'))).toEqual({ remove: 2, add: ['X', 'd'] });
  });

  it('counts emoji as single characters and normalizes line endings', () => {
    expect(codePoints('a🌊b')).toEqual(['a', '🌊', 'b']);
    expect(codePoints('a\r\nb')).toEqual(['a', '\n', 'b']);
  });
});
