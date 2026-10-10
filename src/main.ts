import './style.css';
import { SandField } from './sand/field';
import { Tide } from './sand/tide';
import { POSES, World } from './scene/world';
import fontData from './strokes/fonts/ems-allure.json';
import { StrokeFont, type StrokeFontData } from './strokes/glyphs';
import { codePoints, diffText } from './strokes/input-diff';
import { DEFAULT_LAYOUT, SandLayout } from './strokes/layout';
import { createRng } from './strokes/random';
import { DEFAULT_WRITER, SandWriter, type WriterParams } from './strokes/writer';

type Phase = 'writing' | 'finishing' | 'turning' | 'tide' | 'after' | 'leaving';
type Mode = 'type' | 'draw';

const COPY = {
  type: 'Type, and the stick writes it in the sand.',
  draw: 'Draw in the sand with your finger or mouse.',
  ready: 'When you’re ready, turn to the sea.',
  full: 'That’s all the sand there is here.',
  unknown: 'The stick only knows Latin letters for now.',
  finishing: 'Finishing the last words…',
  unsupported: 'This browser can’t show the beach. Try a recent Chrome, Edge, Safari or Firefox.',
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

async function boot(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('scene');
  const sink = $<HTMLTextAreaElement>('sink');
  const hint = $('hint');
  const dock = $('dock');
  const releaseBtn = $<HTMLButtonElement>('release');
  const modeType = $<HTMLButtonElement>('mode-type');
  const modeDraw = $<HTMLButtonElement>('mode-draw');
  const leaveBtn = $<HTMLButtonElement>('leave');
  const message = $('message');
  const messageText = $('message-text');
  const againBtn = $<HTMLButtonElement>('again');
  const veil = $('veil');

  const params = new URLSearchParams(location.search);
  const field = new SandField();
  const font = new StrokeFont(fontData as StrokeFontData);
  // Tall, narrow screens get a shorter line so the writing stays large enough to read.
  const narrow = window.innerWidth / window.innerHeight < 0.9;
  const layoutOptions = narrow ? { ...DEFAULT_LAYOUT, left: -1.3, width: 2.6 } : DEFAULT_LAYOUT;
  const layout = new SandLayout(font, layoutOptions, createRng((Math.random() * 2 ** 32) >>> 0));
  const writerParams: WriterParams = structuredClone(DEFAULT_WRITER);
  const writer = new SandWriter(layout, writerParams, field);
  const tide = new Tide((Math.random() * 2 ** 32) >>> 0);
  const world = new World(canvas, field);
  world.fitHalfWidth = layoutOptions.width / 2 + 0.35;

  try {
    await world.init();
  } catch {
    hint.textContent = COPY.unsupported;
    return;
  }

  let phase: Phase = 'writing';
  // A coarse pointer (phone, tablet) starts in drawing mode; either can be switched.
  let mode: Mode = window.matchMedia('(pointer: coarse)').matches ? 'draw' : 'type';
  /** The characters the stick has accepted. Discarded the moment the words are given to the sea. */
  let committed: string[] = [];
  let composing = false;
  let handMarks = false;
  let shownUnknown = false;
  let hintTimer = 0;
  let phaseTime = 0;

  const hand = { x: layoutOptions.left + 1, y: layoutOptions.firstBaseline, lift: 0.06, down: false };
  let drawing: { x: number; y: number; p: number; id: number } | null = null;
  let dragStartY: number | null = null;

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
    if (phase !== 'writing') return;
    setHint(hasMarks() ? COPY.ready : mode === 'type' ? COPY.type : COPY.draw);
  }

  function refreshControls(): void {
    releaseBtn.disabled = phase !== 'writing' || !hasMarks();
    modeType.setAttribute('aria-pressed', String(mode === 'type'));
    modeDraw.setAttribute('aria-pressed', String(mode === 'draw'));
  }

  function focusSink(): void {
    if (mode === 'type' && phase === 'writing') sink.focus({ preventScroll: true });
  }

  function setMode(next: Mode): void {
    mode = next;
    if (mode === 'type') focusSink();
    else sink.blur();
    refreshHint();
    refreshControls();
  }

  // --- Typing -----------------------------------------------------------------

  function applyText(): void {
    if (phase !== 'writing') {
      sink.value = '';
      return;
    }
    const { remove, add } = diffText(committed, codePoints(sink.value));
    for (let i = 0; i < remove; i++) {
      writer.backspace();
      committed.pop();
    }
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
      committed.push(ch);
    }
    const text = committed.join('');
    if (sink.value !== text) sink.value = text;
    sink.setSelectionRange(text.length, text.length);
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

  // --- Drawing and gestures --------------------------------------------------

  const pressureOf = (e: PointerEvent) =>
    e.pointerType === 'mouse' || e.pressure === 0 ? 0.7 : Math.min(1, Math.max(0.25, 0.25 + e.pressure * 0.9));

  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'writing') return;
    if (mode === 'type') {
      focusSink();
      dragStartY = e.clientY;
      return;
    }
    const p = world.pick(e.clientX, e.clientY);
    if (!p) return;
    drawing = { ...p, p: pressureOf(e), id: e.pointerId };
    Object.assign(hand, { x: p.x, y: p.y, lift: 0, down: true });
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (phase !== 'writing') return;
    if (mode === 'type') {
      if (dragStartY !== null && dragStartY - e.clientY > 140) {
        dragStartY = null;
        release();
      }
      return;
    }
    if (drawing && e.pointerId === drawing.id) {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) {
        const p = world.pick(ev.clientX, ev.clientY);
        if (!p) continue;
        const pr = pressureOf(ev);
        field.stamp(drawing.x, drawing.y, drawing.p, p.x, p.y, pr);
        drawing = { ...p, p: pr, id: drawing.id };
        handMarks = true;
      }
      Object.assign(hand, { x: drawing.x, y: drawing.y, lift: 0, down: true });
      refreshControls();
    } else if (e.pointerType !== 'touch') {
      const p = world.pick(e.clientX, e.clientY);
      if (p) Object.assign(hand, { x: p.x, y: p.y });
    }
  });

  const endPointer = () => {
    if (drawing) {
      drawing = null;
      hand.down = false;
      refreshHint();
    }
    dragStartY = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // --- The ritual --------------------------------------------------------------

  function release(): void {
    if (phase !== 'writing' || !hasMarks()) return;
    phase = 'finishing';
    phaseTime = 0;
    sink.blur();
    sink.disabled = true;
    refreshControls();
    if (writer.busy) setHint(COPY.finishing);
  }

  function beginTide(): void {
    // The words now exist only as marks in the sand.
    writer.reset();
    committed = [];
    sink.value = '';
    phase = 'turning';
    phaseTime = 0;
    dock.classList.add('gone');
    setHint('');
    world.setStickAway(true);
    world.setPose(POSES.sea, 3.4);
  }

  function writeAgain(): void {
    message.hidden = true;
    againBtn.hidden = true;
    tide.calm();
    field.clear();
    handMarks = false;
    phase = 'writing';
    sink.disabled = false;
    dock.classList.remove('gone');
    world.setStickAway(false);
    world.setPose(POSES.writing, 2.6);
    refreshHint();
    refreshControls();
    focusSink();
  }

  function leave(): void {
    if (phase === 'leaving') return;
    phase = 'leaving';
    veil.classList.add('shown');
    window.setTimeout(() => {
      writer.reset();
      committed = [];
      sink.value = '';
      drawing = null;
      world.setPose(POSES.writing, 0);
      writeAgain();
      veil.classList.remove('shown');
    }, 650);
  }

  releaseBtn.addEventListener('click', release);
  modeType.addEventListener('click', () => setMode('type'));
  modeDraw.addEventListener('click', () => setMode('draw'));
  leaveBtn.addEventListener('click', leave);
  againBtn.addEventListener('click', writeAgain);

  // --- Frame loop ----------------------------------------------------------------

  const resize = () => world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();

  let wasMarked = false;
  let extraWaves = 0;
  let last = performance.now();
  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    phaseTime += dt;

    tide.update(dt);
    writer.update(dt);
    field.erode(dt, tide);
    field.updateWater(dt, tide);

    if (phase === 'finishing' && !writer.busy) beginTide();
    if (phase === 'turning' && phaseTime > 1.8) {
      tide.release();
      phase = 'tide';
      phaseTime = 0;
    }
    if (phase === 'tide' && tide.pendingReleaseWaves === 0 && tide.mode === 'idle') {
      if (field.maxCarve() > 0.0005 && extraWaves < 4) {
        extraWaves++;
        tide.addWave();
        tide.mode = 'release';
      } else {
        extraWaves = 0;
        phase = 'after';
        phaseTime = 0;
        messageText.textContent = 'The sea has it.';
        message.hidden = false;
      }
    }
    if (phase === 'after') {
      if (phaseTime < 6) field.settle(dt);
      if (phaseTime > 2.6 && againBtn.hidden) againBtn.hidden = false;
    }

    const tool = writer.busy || mode === 'type' ? writer.tool : hand;
    world.placeStick(tool.x, tool.y, tool.lift, dt);
    const marked = hasMarks();
    if (marked !== wasMarked) {
      wasMarked = marked;
      refreshControls();
      if (!hintTimer) refreshHint();
    }

    world.update(dt, field.packCarve());
    world.render();
  });

  setMode(mode);
  refreshHint();

  // --- Development helpers --------------------------------------------------------

  const demo = params.get('demo');
  if (demo) {
    const chars = codePoints(demo.slice(0, 200));
    let i = 0;
    const typeNext = () => {
      if (i >= chars.length) {
        if (params.has('release')) {
          const wait = window.setInterval(() => {
            if (!writer.busy) {
              window.clearInterval(wait);
              release();
            }
          }, 200);
        }
        return;
      }
      sink.value += chars[i++];
      sink.dispatchEvent(new Event('input'));
      window.setTimeout(typeNext, 90 + Math.random() * 90);
    };
    window.setTimeout(typeNext, 800);
  }

  if (params.has('tune')) {
    const { createTuner } = await import('./tune');
    createTuner(writerParams, field, () => {
      sink.value = '';
      applyText();
      sink.value = 'the tide will keep it';
      applyText();
    });
  }

  (window as unknown as { __utsuroi?: object }).__utsuroi = {
    get phase() {
      return phase;
    },
    get webgpu() {
      return world.usingWebGPU;
    },
    get busy() {
      return writer.busy;
    },
  };
}

void boot();
