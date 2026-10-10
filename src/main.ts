import './style.css';
import { SandField } from './sand/field';
import { DEFAULT_TIDE, Tide } from './sand/tide';
import { POSES, World } from './scene/world';
import fontData from './strokes/fonts/ems-allure.json';
import { StrokeFont, type StrokeFontData } from './strokes/glyphs';
import { codePoints, diffText } from './strokes/input-diff';
import { DEFAULT_LAYOUT, SandLayout } from './strokes/layout';
import { createRng } from './strokes/random';
import { DEFAULT_WRITER, SandWriter, type WriterParams } from './strokes/writer';

type Mode = 'type' | 'draw';

const COPY = {
  type: 'Type, and the stick writes it in the sand.',
  draw: 'Draw in the sand with your finger or mouse.',
  full: 'The sand is full. The sea will make room.',
  unknown: 'The stick only knows Latin letters for now.',
  gone: 'The sea has it.',
  unsupported: 'This browser can’t show the beach. Try a recent Chrome, Edge, Safari or Firefox.',
};

/** A line can be written on again once its deepest mark is shallower than this (m). */
const LINE_CLEAR = 0.0012;
/** The words are forgotten once nothing deeper than this is left anywhere (m). */
const SAND_CLEAR = 0.0006;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

async function boot(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('scene');
  const sink = $<HTMLTextAreaElement>('sink');
  const hint = $('hint');
  const modeType = $<HTMLButtonElement>('mode-type');
  const modeDraw = $<HTMLButtonElement>('mode-draw');
  const leaveBtn = $<HTMLButtonElement>('leave');
  const message = $('message');
  const veil = $('veil');

  const params = new URLSearchParams(location.search);
  const field = new SandField();
  const font = new StrokeFont(fontData as StrokeFontData);
  // Tall, narrow screens get a shorter line so the writing stays large enough to read.
  const narrow = window.innerWidth / window.innerHeight < 0.9;
  const layoutOptions = narrow ? { ...DEFAULT_LAYOUT, left: -1.15, width: 2.5 } : DEFAULT_LAYOUT;
  const layout = new SandLayout(font, layoutOptions, createRng((Math.random() * 2 ** 32) >>> 0));
  const writerParams: WriterParams = structuredClone(DEFAULT_WRITER);
  const writer = new SandWriter(layout, writerParams, field);
  const tideParams = { ...DEFAULT_TIDE };
  if (params.get('sea') === 'rough') Object.assign(tideParams, { bigChanceCalm: 0.6, bigChanceSwell: 0.8, writingLull: 1 });
  const tide = new Tide((Math.random() * 2 ** 32) >>> 0, tideParams);
  const world = new World(canvas, field);
  world.fitHalfWidth = layoutOptions.width / 2 + 0.35;

  // A line is free again once the sea has smoothed it.
  layout.lineIsClear = (line) => {
    const base = layoutOptions.firstBaseline - line * layoutOptions.lineHeight;
    const rect = { minX: layoutOptions.left - 0.3, maxX: layoutOptions.left + layoutOptions.width + 0.3, minY: base - 0.25, maxY: base + 0.55 };
    return field.maxCarveIn(rect) < LINE_CLEAR;
  };

  try {
    await world.init();
  } catch {
    hint.textContent = COPY.unsupported;
    return;
  }

  // A coarse pointer (phone, tablet) starts in drawing mode; either can be switched.
  let mode: Mode = window.matchMedia('(pointer: coarse)').matches ? 'draw' : 'type';
  let leaving = false;
  /** The characters the stick still holds. Words the sea has taken are dropped. */
  let committed: string[] = [];
  let composing = false;
  let handMarks = false;
  let shownUnknown = false;
  let hintTimer = 0;
  let messageTimer = 0;
  let lastInput = -Infinity;
  let clock = 0;
  let nextClearCheck = 0;

  const hand = { x: layoutOptions.left + 1, y: layoutOptions.firstBaseline, lift: 0.06, down: false };
  let drawing: { x: number; y: number; p: number; id: number } | null = null;

  const hasMarks = () => writer.markedLetters > 0 || handMarks;

  function setHint(text: string, seconds = 0): void {
    hint.textContent = text;
    window.clearTimeout(hintTimer);
    hintTimer = 0;
    if (seconds > 0)
      hintTimer = window.setTimeout(() => {
        hintTimer = 0;
        refreshHint();
      }, seconds * 1000);
  }

  function refreshHint(): void {
    if (hintTimer) return;
    // Once there's writing in the sand, the beach speaks for itself.
    hint.textContent = hasMarks() ? '' : mode === 'type' ? COPY.type : COPY.draw;
  }

  function showMessage(text: string): void {
    message.querySelector('p')!.textContent = text;
    message.hidden = false;
    message.classList.remove('fading');
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
      message.classList.add('fading');
      messageTimer = window.setTimeout(() => (message.hidden = true), 1600);
    }, 3200);
  }

  function setMode(next: Mode): void {
    mode = next;
    if (mode === 'type') sink.focus({ preventScroll: true });
    else sink.blur();
    modeType.setAttribute('aria-pressed', String(mode === 'type'));
    modeDraw.setAttribute('aria-pressed', String(mode === 'draw'));
    refreshHint();
  }

  /** The sand is smooth again: let go of everything that was written. */
  function forget(): void {
    writer.reset();
    committed = [];
    sink.value = '';
    handMarks = false;
  }

  // --- Typing -----------------------------------------------------------------

  function applyText(): void {
    if (leaving) {
      sink.value = '';
      return;
    }
    const { remove, add } = diffText(committed, codePoints(sink.value));
    for (let i = 0; i < remove; i++) if (!writer.backspace()) break;
    for (const ch of add) {
      if (ch !== ' ' && ch !== '\n' && !font.has(ch)) {
        if (!shownUnknown) setHint(COPY.unknown, 4);
        shownUnknown = true;
        continue;
      }
      if (!writer.type(ch)) {
        setHint(COPY.full, 4);
        break;
      }
    }
    // The layout may have let go of words the sea already took; keep the field in step.
    committed = layout.chars.map((c) => c.ch);
    const text = committed.join('');
    if (sink.value !== text) sink.value = text;
    sink.setSelectionRange(text.length, text.length);
    lastInput = clock;
  }

  sink.addEventListener('compositionstart', () => (composing = true));
  sink.addEventListener('compositionend', () => {
    composing = false;
    applyText();
  });
  sink.addEventListener('input', () => {
    if (!composing) applyText();
  });
  sink.addEventListener('keydown', (e) => {
    // Writing only grows or shrinks at the end, like a stick in sand.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      e.preventDefault();
    }
  });
  sink.addEventListener('select', () => sink.setSelectionRange(sink.value.length, sink.value.length));

  // --- Drawing -----------------------------------------------------------------

  const pressureOf = (e: PointerEvent) =>
    e.pointerType === 'mouse' || e.pressure === 0 ? 0.7 : Math.min(1, Math.max(0.25, 0.25 + e.pressure * 0.9));

  canvas.addEventListener('pointerdown', (e) => {
    if (leaving) return;
    if (mode === 'type') {
      sink.focus({ preventScroll: true });
      return;
    }
    const p = world.pick(e.clientX, e.clientY);
    if (!p) return;
    drawing = { ...p, p: pressureOf(e), id: e.pointerId };
    Object.assign(hand, { x: p.x, y: p.y, lift: 0, down: true });
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'draw' || leaving) return;
    if (drawing && e.pointerId === drawing.id) {
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const p = world.pick(ev.clientX, ev.clientY);
        if (!p) continue;
        const pr = pressureOf(ev);
        field.stamp(drawing.x, drawing.y, drawing.p, p.x, p.y, pr);
        drawing = { ...p, p: pr, id: drawing.id };
        handMarks = true;
      }
      Object.assign(hand, { x: drawing.x, y: drawing.y, lift: 0, down: true });
      lastInput = clock;
    } else if (e.pointerType !== 'touch') {
      const p = world.pick(e.clientX, e.clientY);
      if (p) Object.assign(hand, { x: p.x, y: p.y, lift: 0.06, down: false });
    }
  });

  const endPointer = () => {
    if (!drawing) return;
    drawing = null;
    Object.assign(hand, { lift: 0.06, down: false });
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // --- Leaving -------------------------------------------------------------------

  function leave(): void {
    if (leaving) return;
    leaving = true;
    sink.blur();
    veil.classList.add('shown');
    window.setTimeout(() => {
      forget();
      field.clear();
      drawing = null;
      message.hidden = true;
      world.setPose(POSES.arrive, 0);
      veil.classList.remove('shown');
      world.setPose(POSES.writing, 3.2);
      leaving = false;
      refreshHint();
      if (mode === 'type') sink.focus({ preventScroll: true });
    }, 650);
  }

  modeType.addEventListener('click', () => setMode('type'));
  modeDraw.addEventListener('click', () => setMode('draw'));
  leaveBtn.addEventListener('click', leave);

  // --- Frame loop ----------------------------------------------------------------

  const resize = () => world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();

  // Arrive looking out to sea, then lower your eyes to the sand.
  world.setPose(POSES.arrive, 0);
  window.setTimeout(() => world.setPose(POSES.writing, 3.6), 700);

  let wasMarked = false;
  let last = performance.now();
  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    tide.writing = writer.busy || drawing !== null || clock - lastInput < 5;
    tide.update(dt);
    writer.update(dt);
    field.erode(dt, tide);
    field.updateWater(dt, tide);

    // When the sea has smoothed everything, the words are gone for good.
    if (clock > nextClearCheck) {
      nextClearCheck = clock + 0.5;
      const idle = !writer.busy && !drawing && clock - lastInput > 2;
      if (hasMarks() && idle && field.maxCarve() < SAND_CLEAR) {
        forget();
        showMessage(COPY.gone);
      }
    }

    const tool = writer.busy || mode === 'type' ? writer.tool : hand;
    world.placeStick(tool.x, tool.y, tool.lift, dt);
    const marked = hasMarks();
    if (marked !== wasMarked) {
      wasMarked = marked;
      refreshHint();
    }

    world.update(dt, field.packCarve());
    world.render();
  });

  setMode(mode);

  // --- Development helpers --------------------------------------------------------

  const demo = params.get('demo');
  if (demo) {
    const chars = codePoints(demo.slice(0, 200));
    let i = 0;
    const typeNext = () => {
      if (i >= chars.length) return;
      sink.value += chars[i++];
      sink.dispatchEvent(new Event('input'));
      window.setTimeout(typeNext, 90 + Math.random() * 90);
    };
    window.setTimeout(typeNext, 800);
  }

  if (params.has('tune')) {
    const { createTuner } = await import('./tune');
    createTuner(writerParams, field, tide.params, () => {
      sink.value = committed.join('') + ' the tide will keep it';
      applyText();
    });
  }

  (window as unknown as { __utsuroi?: object }).__utsuroi = {
    get busy() {
      return writer.busy;
    },
    get webgpu() {
      return world.usingWebGPU;
    },
    get waves() {
      return { all: tide.waves, big: tide.bigWaves, swell: tide.swell };
    },
    get marked() {
      return hasMarks();
    },
  };
}

void boot();
