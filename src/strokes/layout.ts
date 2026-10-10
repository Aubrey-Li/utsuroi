import type { PreparedGlyph, StrokeFont } from './glyphs';
import { fbm1, gaussian } from './random';

export interface LayoutOptions {
  /** Left edge of the writing area (m). */
  left: number;
  width: number;
  /** Baseline of the first line, in sand y (m). Later lines are closer to the viewer. */
  firstBaseline: number;
  lineHeight: number;
  maxLines: number;
  /** Height of a lowercase x in meters; sets the scale of the font. */
  xHeight: number;
  /**
   * Vertical stretch of every letter. Sand is seen at a low angle, which
   * squashes writing; people writing on a beach make letters taller to
   * compensate, and so do we.
   */
  stretch: number;
  /** Extra width of a space between words, as a multiple of the font's space. */
  wordSpacing: number;
  /** How far the baseline wanders along a line (m). */
  baselineDrift: number;
  /** Standard deviations for per-letter variation. */
  variation: { size: number; slant: number; rotation: number };
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  left: -2.9,
  width: 5.8,
  firstBaseline: 1.4,
  lineHeight: 0.64,
  maxLines: 3,
  xHeight: 0.17,
  stretch: 1.15,
  wordSpacing: 1.35,
  baselineDrift: 0.02,
  variation: { size: 0.045, slant: 0.05, rotation: 0.025 },
};

export interface GlyphVariation {
  scale: number;
  slant: number;
  rotation: number;
  /** Seed for this letter's wobble noise. */
  seed: number;
}

export type CharState = 'queued' | 'writing' | 'written';

export interface PlacedChar {
  id: number;
  ch: string;
  /** Null for spaces, line breaks, and characters the font doesn't have. */
  glyph: PreparedGlyph | null;
  x: number;
  y: number;
  line: number;
  advance: number;
  variation: GlyphVariation;
  state: CharState;
  /** Pen position before this character, restored on backspace. */
  penBefore: { x: number; line: number };
}

/**
 * Places typed characters on the sand one at a time, as they're typed.
 *
 * Positions are fixed once a letter has been written. A word that hasn't
 * been started yet moves to the next line if it runs out of room; a word
 * already being written breaks where it is.
 *
 * Lines are reused once the sea has washed them smooth, so writing can go
 * on as long as the tide keeps taking it. Moving back to a reused line
 * seals everything written before: it can no longer be backspaced, and the
 * characters are dropped from memory.
 */
export class SandLayout {
  readonly chars: PlacedChar[] = [];
  /** Optional check that a line's sand is smooth enough to write on again. */
  lineIsClear: ((line: number) => boolean) | null = null;
  readonly unit: number;
  private penX: number;
  private line = 0;
  private nextId = 1;
  private readonly lineSeed: number;

  constructor(
    private readonly font: StrokeFont,
    readonly options: LayoutOptions,
    private readonly rng: () => number,
  ) {
    this.unit = options.xHeight / font.xHeight;
    this.penX = options.left;
    this.lineSeed = Math.floor(rng() * 1e6);
  }

  get isEmpty(): boolean {
    return this.chars.length === 0;
  }

  get currentLine(): number {
    return this.line;
  }

  baselineY(line: number, x: number): number {
    const o = this.options;
    return o.firstBaseline - line * o.lineHeight + o.baselineDrift * fbm1(x * 0.7, this.lineSeed + line * 7919);
  }

  /** Places a character. Returns null when there's no room left. */
  add(ch: string): PlacedChar | null {
    const o = this.options;
    const right = o.left + o.width;

    if (ch === '\n') {
      const next = this.nextLine();
      if (next === null) return null;
      const c = this.makeChar(ch, null, 0);
      this.chars.push(c);
      this.moveToLine(next, []);
      return c;
    }

    const glyph = ch === ' ' ? null : (this.font.get(ch) ?? null);
    const variation = this.makeVariation();
    const advance = (glyph ? glyph.advance * variation.scale : this.font.spaceAdvance * this.options.wordSpacing) * this.unit;

    if (ch !== ' ' && this.penX + advance > right + 1e-9) {
      const next = this.nextLine();
      if (next === null) return null;
      const word = this.currentWord();
      const canMove = word.length > 0 && word[0]!.x > o.left + 1e-6 && word.every((c) => c.state === 'queued');
      this.moveToLine(next, canMove ? word : []);
      if (canMove) {
        for (const c of word) {
          if (c !== word[0]) c.penBefore = { x: this.penX, line: this.line };
          c.x = this.penX;
          c.line = this.line;
          c.y = this.baselineY(this.line, c.x);
          this.penX += c.advance;
        }
      }
    }

    const c = this.makeChar(ch, glyph, advance, variation);
    this.chars.push(c);
    this.penX += advance;
    return c;
  }

  removeLast(): PlacedChar | undefined {
    const c = this.chars.pop();
    if (c) {
      this.penX = c.penBefore.x;
      this.line = c.penBefore.line;
    }
    return c;
  }

  reset(): void {
    this.chars.length = 0;
    this.penX = this.options.left;
    this.line = 0;
  }

  /** The next line with room: below the current one, else back around to any the sea has cleared. */
  nextLine(): number | null {
    const n = this.options.maxLines;
    for (let step = 1; step < n; step++) {
      const k = (this.line + step) % n;
      if (this.isFree(k)) return k;
    }
    return null;
  }

  private isFree(line: number): boolean {
    let has = false;
    for (const c of this.chars) {
      if (c.line !== line) continue;
      if (c.state !== 'written') return false;
      has = true;
    }
    return this.lineIsClear ? this.lineIsClear(line) : !has;
  }

  private moveToLine(line: number, keep: PlacedChar[]): void {
    const wrapped = line <= this.line;
    this.line = line;
    this.penX = this.options.left;
    if (wrapped) this.seal(keep);
  }

  /** Forgets every written character before the ones still in play. */
  private seal(keep: PlacedChar[]): void {
    let i = 0;
    while (i < this.chars.length && this.chars[i]!.state === 'written' && !keep.includes(this.chars[i]!)) i++;
    if (i > 0) this.chars.splice(0, i);
  }

  private currentWord(): PlacedChar[] {
    let i = this.chars.length;
    while (i > 0 && this.chars[i - 1]!.ch !== ' ' && this.chars[i - 1]!.ch !== '\n') i--;
    return this.chars.slice(i);
  }

  private makeVariation(): GlyphVariation {
    const v = this.options.variation;
    return {
      scale: 1 + gaussian(this.rng) * v.size,
      slant: gaussian(this.rng) * v.slant,
      rotation: gaussian(this.rng) * v.rotation,
      seed: Math.floor(this.rng() * 1e6),
    };
  }

  private makeChar(ch: string, glyph: PreparedGlyph | null, advance: number, variation = this.makeVariation()): PlacedChar {
    return {
      id: this.nextId++,
      ch,
      glyph,
      x: this.penX,
      y: this.baselineY(this.line, this.penX),
      line: this.line,
      advance,
      variation,
      state: 'queued',
      penBefore: { x: this.penX, line: this.line },
    };
  }
}
