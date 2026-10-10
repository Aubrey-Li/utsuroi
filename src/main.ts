import './style.css';
import { SandField, WATERLINE_Y, ZONE } from './sand/field';
import { DEFAULT_TIDE, Tide } from './sand/tide';
import { World } from './scene/world';

const COPY = {
  hint: 'Draw in the sand. Drag the sea or sky to look around.',
  gone: 'The sea has it.',
  unsupported: 'This browser can’t show the beach. Try a recent Chrome, Edge, Safari or Firefox.',
};

/** The marks are forgotten once nothing deeper than this is left anywhere (m). */
const SAND_CLEAR = 0.0006;
/** Pixels of drag for a full tilt from the sand to the horizon. */
const TILT_PIXELS = 420;
/** Pixels of drag per radian of turning. */
const YAW_PIXELS = 520;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Whether a sand position is somewhere you can write: on the beach, above the waterline. */
function writable(p: { x: number; y: number } | null): p is { x: number; y: number } {
  return p !== null && p.x > ZONE.x0 && p.x < ZONE.x1 && p.y > ZONE.y0 && p.y < WATERLINE_Y - 0.15;
}

async function boot(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('scene');
  const hint = $('hint');
  const leaveBtn = $<HTMLButtonElement>('leave');
  const message = $('message');
  const veil = $('veil');

  const params = new URLSearchParams(location.search);
  const field = new SandField();
  const tideParams = { ...DEFAULT_TIDE };
  if (params.get('sea') === 'rough') Object.assign(tideParams, { bigChanceCalm: 0.6, bigChanceSwell: 0.8, writingLull: 1 });
  const tide = new Tide((Math.random() * 2 ** 32) >>> 0, tideParams);
  const world = new World(canvas, field);

  try {
    await world.init();
  } catch {
    hint.textContent = COPY.unsupported;
    return;
  }

  let leaving = false;
  let marks = false;
  let messageTimer = 0;
  let lastInput = -Infinity;
  let clock = 0;
  let nextClearCheck = 0;

  /** Where the stick is: under the pointer, touching the sand while drawing. */
  const hand = { x: 0, y: 1.2, lift: 0.06 };
  let drawing: { x: number; y: number; p: number; id: number } | null = null;
  let looking: { x: number; y: number; tilt: number; yaw: number } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();

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

  // --- Drawing and looking around ----------------------------------------------

  const pressureOf = (e: PointerEvent) =>
    e.pointerType === 'mouse' || e.pressure === 0 ? 0.7 : Math.min(1, Math.max(0.25, 0.25 + e.pressure * 0.9));

  function midpoint(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of pointers.values()) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  }

  function startLooking(x: number, y: number): void {
    drawing = null;
    hand.lift = 0.06;
    looking = { x, y, tilt: world.tilt, yaw: world.yaw };
    canvas.style.cursor = 'grabbing';
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (leaving) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    // A second finger turns a stroke into looking around.
    if (pointers.size >= 2) {
      const m = midpoint();
      startLooking(m.x, m.y);
      return;
    }
    const p = world.pick(e.clientX, e.clientY);
    if (writable(p)) {
      drawing = { ...p, p: pressureOf(e), id: e.pointerId };
      Object.assign(hand, { x: p.x, y: p.y, lift: 0 });
    } else {
      startLooking(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (leaving) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (looking) {
      const m = pointers.size >= 2 ? midpoint() : { x: e.clientX, y: e.clientY };
      // Like turning your head: drag down to look up, drag left to look right.
      world.setView(looking.tilt + (m.y - looking.y) / TILT_PIXELS, looking.yaw - (m.x - looking.x) / YAW_PIXELS, 14);
      return;
    }
    if (drawing && e.pointerId === drawing.id) {
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const p = world.pick(ev.clientX, ev.clientY);
        if (!writable(p)) continue;
        const pr = pressureOf(ev);
        field.stamp(drawing.x, drawing.y, drawing.p, p.x, p.y, pr);
        drawing = { ...p, p: pr, id: drawing.id };
        marks = true;
      }
      Object.assign(hand, { x: drawing.x, y: drawing.y, lift: 0 });
      lastInput = clock;
      return;
    }
    if (e.pointerType !== 'touch') {
      // Hovering: the stick follows the mouse over the sand; elsewhere you can grab the view.
      const p = world.pick(e.clientX, e.clientY);
      if (writable(p)) {
        Object.assign(hand, { x: p.x, y: p.y, lift: 0.06 });
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'grab';
      }
    }
  });

  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (drawing && drawing.id === e.pointerId) {
      drawing = null;
      hand.lift = 0.06;
    }
    if (looking && pointers.size === 0) {
      looking = null;
      canvas.style.cursor = 'grab';
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Scrolling (mouse wheel or two fingers on a trackpad) tilts and turns the view too.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      world.setView(world.tilt - e.deltaY / (TILT_PIXELS * 2), world.yaw + e.deltaX / (YAW_PIXELS * 2), 8);
    },
    { passive: false },
  );

  // --- Leaving -------------------------------------------------------------------

  function leave(): void {
    if (leaving) return;
    leaving = true;
    veil.classList.add('shown');
    window.setTimeout(() => {
      field.clear();
      marks = false;
      drawing = null;
      looking = null;
      pointers.clear();
      demoWriter?.reset();
      message.hidden = true;
      hint.textContent = COPY.hint;
      world.jumpView(1, 0);
      veil.classList.remove('shown');
      world.setView(0, 0, 0.9);
      leaving = false;
    }, 650);
  }

  leaveBtn.addEventListener('click', leave);

  // --- Frame loop ----------------------------------------------------------------

  const resize = () => world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();

  // Arrive looking out to sea, then lower your eyes to the sand.
  world.jumpView(1, 0);
  window.setTimeout(() => world.setView(0, 0, 0.9), 700);

  // A robot hand for development: ?demo=words writes them in cursive.
  const demoWriter = params.get('demo') ? await createDemoWriter(params.get('demo')!, field) : null;

  let last = performance.now();
  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    if (demoWriter?.busy) {
      demoWriter.update(dt);
      marks = true;
      lastInput = clock;
    }
    tide.writing = drawing !== null || clock - lastInput < 5;
    tide.update(dt);
    field.erode(dt, tide);
    field.updateWater(dt, tide);

    // When the sea has smoothed everything, the marks are gone for good.
    if (clock > nextClearCheck) {
      nextClearCheck = clock + 0.5;
      if (marks && !drawing && clock - lastInput > 2 && field.maxCarve() < SAND_CLEAR) {
        marks = false;
        showMessage(COPY.gone);
      }
    }
    if (marks && hint.textContent) hint.textContent = '';

    const tool = demoWriter?.busy ? demoWriter.tool : hand;
    world.placeStick(tool.x, tool.y, tool.lift, dt);
    world.update(dt, field.packCarve());
    world.render();
  });

  if (params.has('tune')) {
    const { createTuner } = await import('./tune');
    createTuner(field, tide.params);
  }

  (window as unknown as { __utsuroi?: object }).__utsuroi = {
    get webgpu() {
      return world.usingWebGPU;
    },
    get waves() {
      return { all: tide.waves, big: tide.bigWaves, swell: tide.swell };
    },
    get marks() {
      return marks;
    },
    look(tilt: number, yaw: number) {
      world.setView(tilt, yaw, 3);
    },
  };
}

/** Writes text in cursive with the stroke engine, as if by hand. Development only. */
async function createDemoWriter(text: string, field: SandField) {
  const [{ default: fontData }, { StrokeFont }, { DEFAULT_LAYOUT, SandLayout }, { createRng }, { DEFAULT_WRITER, SandWriter }] =
    await Promise.all([
      import('./strokes/fonts/ems-allure.json'),
      import('./strokes/glyphs'),
      import('./strokes/layout'),
      import('./strokes/random'),
      import('./strokes/writer'),
    ]);
  const font = new StrokeFont(fontData);
  const writer = new SandWriter(new SandLayout(font, DEFAULT_LAYOUT, createRng(7)), DEFAULT_WRITER, field);
  for (const ch of text.slice(0, 200)) writer.type(ch);
  return writer;
}

void boot();
