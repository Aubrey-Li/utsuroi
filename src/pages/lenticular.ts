/**
 * Lettering cut into thin vertical strips, like a lenticular print caught
 * mid-turn: alternate strips show the glyph and a copy of it shifted
 * sideways, with a hairline gap between them, so it reads as one state
 * passing into the next. Where the effect is zero the glyph is solid.
 *
 * Drawn on a canvas laid over the real text, which stays in the page (made
 * transparent) for screen readers, selection and layout.
 */

export interface LenticularOptions {
  /** How far along the glyphs (0 = start, 1 = end) the strips open up: 0..1. */
  strength: (t: number) => number;
  /** Strip period in CSS pixels (one strip and its gap). */
  stripe?: number;
  /** Largest sideways shift, as a fraction of the font size. */
  shift?: number;
}

const BANDS = 40;

/** A stable 0..1 value for a strip in a band, so the same strips stay broken from frame to frame. */
function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class LenticularText {
  /** 0..1: scales the whole effect (for hover in and out). */
  amount = 1;
  /** -1..1: which way the copy has slid, like the angle a print is held at. */
  phase = 0.6;
  private readonly canvas = document.createElement('canvas');
  private readonly source = document.createElement('canvas');
  /** The soft glow behind the letters, kept whole: cutting it into strips leaves dark ghost lines. */
  private readonly glow = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d');
  private vertical = false;
  private margin = 0;
  private dpr = 1;
  private ready = false;
  /** The text's own color, read before the real text is made transparent. */
  private readonly ink: string;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: LenticularOptions,
  ) {
    this.ink = getComputedStyle(host).color;
    this.canvas.className = 'lenticular';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.append(this.canvas);
    new ResizeObserver(() => this.layout()).observe(host);
    void document.fonts?.ready.then(() => this.layout());
  }

  /** True once it has drawn at least once (the real text is then hidden). */
  get active(): boolean {
    return this.ready;
  }

  /** Re-measures the text and redraws the source glyphs. */
  layout(): void {
    const ctx = this.ctx;
    const text = this.host.dataset.text ?? '';
    const rect = this.host.getBoundingClientRect();
    if (!ctx || !text || rect.width === 0 || rect.height === 0) return;
    const style = getComputedStyle(this.host);
    const size = parseFloat(style.fontSize);
    this.vertical = style.writingMode.startsWith('vertical');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.margin = Math.ceil(size * (this.options.shift ?? 0.12) + 24);
    const w = rect.width + this.margin * 2;
    const h = rect.height + 24;
    for (const c of [this.canvas, this.source, this.glow]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    Object.assign(this.canvas.style, { width: `${w}px`, height: `${h}px`, left: `${-this.margin}px`, top: '-12px' });

    const chars = Array.from(text);
    const spacing = parseFloat(style.letterSpacing) || 0;
    const letters = (c: CanvasRenderingContext2D, clear = true) => {
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (clear) c.clearRect(0, 0, w, h);
      c.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      c.fillStyle = this.ink;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      // Vertical: one em per character, plus the letter spacing, top to bottom.
      if (this.vertical) chars.forEach((ch, i) => c.fillText(ch, this.margin + rect.width / 2, 12 + (size + spacing) * i + size / 2));
      else c.fillText(text, this.margin + rect.width / 2, 12 + rect.height / 2);
    };
    letters(this.source.getContext('2d')!);

    // The glow alone: letters with their shadow, then the letters themselves cut back out.
    const g = this.glow.getContext('2d')!;
    const shadow = style.getPropertyValue('--glyph-shadow').trim();
    g.save();
    if (shadow) {
      g.shadowColor = shadow;
      g.shadowBlur = size * 0.28 * this.dpr;
      g.shadowOffsetY = 2 * this.dpr;
    }
    letters(g);
    g.restore();
    if (!shadow) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.glow.width, this.glow.height);
    }
    g.save();
    g.globalCompositeOperation = 'destination-out';
    letters(g, false);
    g.restore();
    this.ready = true;
    this.host.classList.add('lenticular-on');
    this.draw();
  }

  /** Composites the strips for the current amount and phase. */
  draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const d = this.dpr;
    ctx.clearRect(0, 0, W, H);
    const size = parseFloat(getComputedStyle(this.host).fontSize) * d;
    const period = Math.max(2, Math.round((this.options.stripe ?? 3) * d));
    const maxShift = size * (this.options.shift ?? 0.12);
    const bands = this.vertical ? BANDS : 1;
    const bandH = Math.ceil(H / bands);
    const inner0 = this.margin * d;
    const innerW = W - inner0 * 2;
    for (let b = 0; b < bands; b++) {
      const y = b * bandH;
      // The glow fades as the letters come apart, so the strips sit on clean sky.
      if (this.vertical) {
        const fade = 1 - Math.min(1, this.options.strength((y + bandH / 2) / H) * this.amount * 1.6);
        if (fade > 0.01) {
          ctx.globalAlpha = fade;
          ctx.drawImage(this.glow, 0, y, W, bandH, 0, y, W, bandH);
          ctx.globalAlpha = 1;
        }
      } else if (this.amount < 0.99) {
        ctx.globalAlpha = 1 - this.amount;
        ctx.drawImage(this.glow, 0, 0);
        ctx.globalAlpha = 1;
      }
      for (let x = 0; x < W; x += period) {
        // Along the glyphs: down the column when vertical, across the line when not.
        const t = this.vertical ? (y + bandH / 2) / H : Math.min(1, Math.max(0, (x - inner0) / innerW));
        const s = this.options.strength(t) * this.amount;
        if (s < 0.02) {
          ctx.drawImage(this.source, x, y, period, bandH, x, y, period, bandH);
          continue;
        }
        // Further along, the gaps widen, the copy slides further, and more strips break away.
        const k = Math.round(x / period);
        if (hash(k, b) < Math.max(0, s - 0.5) * 0.5) continue;
        const fill = Math.max(1, Math.round(period * (1 - (0.06 + 0.36 * s))));
        const odd = k % 2 === 1;
        const shift = odd ? maxShift * s * this.phase : -maxShift * s * this.phase * 0.25;
        const sx = Math.min(W - fill, Math.max(0, x - shift));
        ctx.drawImage(this.source, sx, y, fill, bandH, x, y, fill, bandH);
      }
    }
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The home page's 移ろい: solid at the top, coming apart into lines toward
 * the bottom. The shift drifts slowly and leans toward the pointer.
 */
export function animateHeading(host: HTMLElement): void {
  const lens = new LenticularText(host, {
    // Barely open at the top of 移, more and more broken toward the bottom of い.
    strength: (t) => {
      const u = Math.min(1, Math.max(0, (t - 0.1) / 0.86));
      return 0.88 * u ** 1.7;
    },
    stripe: 4,
    shift: 0.11,
  });
  let lean = 0;
  let leanTo = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') leanTo = (e.clientX / window.innerWidth) * 2 - 1;
  });
  const start = performance.now();
  const tick = (now: number) => {
    if (host.offsetParent === null || document.hidden) {
      window.setTimeout(() => requestAnimationFrame(tick), 400);
      return;
    }
    if (reducedMotion()) {
      lens.phase = 0.6;
    } else {
      lean += (leanTo - lean) * 0.04;
      const drift = Math.sin((now - start) / 4200) * 0.35;
      lens.phase = Math.max(-1, Math.min(1, 0.55 + drift + lean * 0.35));
    }
    lens.draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A place's ink character: solid at rest, sliding into lines while you point at it. */
export function hoverLines(host: HTMLElement, trigger: HTMLElement): void {
  const lens = new LenticularText(host, {
    strength: (t) => Math.min(0.75, 0.1 + t * 0.9),
    stripe: 3.4,
    shift: 0.1,
  });
  lens.amount = 0;
  let target = 0;
  let running = false;
  const step = () => {
    const speed = reducedMotion() ? 1 : 0.12;
    lens.amount += (target - lens.amount) * speed;
    if (Math.abs(target - lens.amount) < 0.01) lens.amount = target;
    lens.phase = 0.4 + lens.amount * 0.6;
    lens.draw();
    if (lens.amount !== target) requestAnimationFrame(step);
    else running = false;
  };
  const go = (on: boolean) => {
    target = on ? 1 : 0;
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  };
  trigger.addEventListener('mouseenter', () => go(true));
  trigger.addEventListener('mouseleave', () => go(false));
  trigger.addEventListener('focus', () => go(true));
  trigger.addEventListener('blur', () => go(false));
}
