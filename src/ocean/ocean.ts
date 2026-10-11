import { AudioEngine, bindSoundToggle } from '../audio/engine';
import { OceanSound } from '../audio/ocean-sound';
import { SandField, WATERLINE_Y, ZONE } from '../sand/field';
import { DEFAULT_TIDE, Tide } from '../sand/tide';
import { World } from '../scene/world';
import type { SandWriter } from '../strokes/writer';

const COPY = {
  hint: 'Draw in the sand. Drag the sea or sky to look around.',
  unsupported: 'This browser can’t show the beach. Try a recent Chrome, Edge, Safari or Firefox.',
};

/** The marks are forgotten once nothing deeper than this is left anywhere (m). */
const SAND_CLEAR = 0.0006;
/** Pixels of drag for a full tilt from the sand to the horizon. */
const TILT_PIXELS = 420;
/** Pixels of drag per radian of turning. */
const YAW_PIXELS = 520;

/** Whether a sand position is somewhere you can write: on the beach, above the waterline. */
function writable(p: { x: number; y: number } | null): p is { x: number; y: number } {
  return p !== null && p.x > ZONE.x0 && p.x < ZONE.x1 && p.y > ZONE.y0 && p.y < WATERLINE_Y - 0.15;
}

export interface OceanEvents {
  /** The sea has taken everything that was written: the ritual is complete. */
  released(): void;
  /** The person chose to leave. */
  leave(): void;
}

/**
 * The ocean ritual: draw in the sand, and the sea takes it in its own time.
 * Created once; entering again starts with smooth sand.
 */
export class OceanScene {
  private world: World | null = null;
  private sound: OceanSound | null = null;
  private soundReady: Promise<OceanSound | null> | null = null;
  /** How fast the stick is moving through the sand (m/s), for its sound. */
  private drawSpeed = 0;
  private lastDrawAt = 0;
  private readonly field = new SandField();
  private readonly tide: Tide;
  private readonly canvas: HTMLCanvasElement;
  private readonly hint: HTMLElement;
  private readonly veil: HTMLElement;
  private active = false;
  private leaving = false;
  private marks = false;
  private lastInput = -Infinity;
  private clock = 0;
  private nextClearCheck = 0;
  private nextSeek = 0;
  private last = 0;
  private readonly hand = { x: 0, y: 1.2, lift: 0.06 };
  private drawing: { x: number; y: number; p: number; id: number } | null = null;
  private looking: { x: number; y: number; tilt: number; yaw: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private demoWriter: SandWriter | null = null;
  private glideTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly events: OceanEvents,
    private readonly params: URLSearchParams,
  ) {
    const q = <T extends HTMLElement>(sel: string) => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`Missing ${sel}`);
      return el;
    };
    this.canvas = q<HTMLCanvasElement>('canvas');
    this.hint = q('[data-hint]');
    this.veil = q('[data-veil]');
    const tideParams = { ...DEFAULT_TIDE };
    if (params.get('sea') === 'rough') Object.assign(tideParams, { bigChanceCalm: 0.6, bigChanceSwell: 0.8, writingLull: 1 });
    this.tide = new Tide((Math.random() * 2 ** 32) >>> 0, tideParams);
    q<HTMLButtonElement>('[data-leave]').addEventListener('click', () => this.leave());
    bindSoundToggle(q<HTMLButtonElement>('[data-sound]'));
    this.bindPointer();
    window.addEventListener('resize', () => this.active && this.resize());
  }

  get hasMarks(): boolean {
    return this.marks;
  }

  get tideParams() {
    return this.tide.params;
  }

  get sand(): SandField {
    return this.field;
  }

  /** Shows the scene, starting from smooth sand and a view out to sea. */
  async enter(): Promise<void> {
    this.veil.classList.add('shown');
    this.leaving = false;
    if (!this.world) {
      const world = new World(this.canvas, this.field);
      try {
        await world.init();
      } catch {
        this.hint.textContent = COPY.unsupported;
        this.veil.classList.remove('shown');
        return;
      }
      this.world = world;
    }
    this.reset();
    this.active = true;
    this.resize();
    const world = this.world;
    // Arrive looking out to sea, then lower your eyes to the sand.
    world.jumpView(1, 0);
    this.last = performance.now();
    world.renderer.setAnimationLoop(() => this.frame());
    const engine = AudioEngine.shared();
    const ctx = engine.context();
    if (ctx && engine.master) {
      const master = engine.master;
      this.soundReady ??= OceanSound.create(ctx, master).catch(() => null);
      void this.soundReady.then((s) => {
        this.sound = s;
        if (this.active) s?.start();
      });
    }
    requestAnimationFrame(() => this.veil.classList.remove('shown'));
    window.clearTimeout(this.glideTimer);
    this.glideTimer = window.setTimeout(() => world.setView(0, 0, 0.9), 700);

    const demo = this.params.get('demo');
    if (demo) this.demoWriter = await createDemoWriter(demo, this.field);
  }

  /** Stops rendering. The sand is cleared on the next enter. */
  exit(): void {
    this.active = false;
    window.clearTimeout(this.glideTimer);
    this.world?.renderer.setAnimationLoop(null);
    this.sound?.stop();
  }

  private reset(): void {
    this.field.clear();
    this.marks = false;
    this.drawing = null;
    this.looking = null;
    this.pointers.clear();
    this.demoWriter = null;
    this.hint.textContent = COPY.hint;
    this.lastInput = -Infinity;
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.veil.classList.add('shown');
    window.setTimeout(() => this.events.leave(), 650);
  }

  private resize(): void {
    this.world?.resize(window.innerWidth, window.innerHeight);
  }

  private frame(): void {
    const world = this.world!;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;

    if (this.demoWriter?.busy) {
      this.demoWriter.update(dt);
      this.marks = true;
      this.lastInput = this.clock;
    }
    this.tide.writing = this.drawing !== null || this.clock - this.lastInput < 5;
    if (this.clock > this.nextSeek) {
      this.nextSeek = this.clock + 0.5;
      this.tide.seek = this.marks ? this.field.farthestMark() : null;
    }
    this.tide.update(dt);
    this.field.erode(dt, this.tide);
    this.field.updateWater(dt, this.tide);

    // When the sea has smoothed everything, the marks are gone for good.
    if (this.clock > this.nextClearCheck) {
      this.nextClearCheck = this.clock + 0.5;
      const idle = !this.drawing && !this.demoWriter?.busy && this.clock - this.lastInput > 2;
      if (this.marks && idle && this.field.maxCarve() < SAND_CLEAR) {
        this.marks = false;
        this.events.released();
      }
    }
    if (this.marks && this.hint.textContent) this.hint.textContent = '';

    this.drawSpeed *= Math.exp(-dt * 10);
    this.sound?.update(this.tide.waves, this.tide.reach, this.drawing || this.demoWriter?.busy ? this.drawSpeed : 0);
    const tool = this.demoWriter?.busy ? this.demoWriter.tool : this.hand;
    world.placeStick(tool.x, tool.y, tool.lift, dt);
    world.update(dt, this.field.packCarve());
    world.render();
  }

  // --- Drawing and looking around ----------------------------------------------

  private bindPointer(): void {
    const canvas = this.canvas;
    const pressureOf = (e: PointerEvent) =>
      e.pointerType === 'mouse' || e.pressure === 0 ? 0.7 : Math.min(1, Math.max(0.25, 0.25 + e.pressure * 0.9));

    const midpoint = () => {
      let x = 0;
      let y = 0;
      for (const p of this.pointers.values()) {
        x += p.x;
        y += p.y;
      }
      return { x: x / this.pointers.size, y: y / this.pointers.size };
    };

    const startLooking = (x: number, y: number) => {
      this.drawing = null;
      this.hand.lift = 0.06;
      this.looking = { x, y, tilt: this.world!.tilt, yaw: this.world!.yaw };
      canvas.style.cursor = 'grabbing';
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.world || this.leaving) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      // A second finger turns a stroke into looking around.
      if (this.pointers.size >= 2) {
        const m = midpoint();
        startLooking(m.x, m.y);
        return;
      }
      const p = this.world.pick(e.clientX, e.clientY);
      if (writable(p)) {
        this.drawing = { ...p, p: pressureOf(e), id: e.pointerId };
        Object.assign(this.hand, { x: p.x, y: p.y, lift: 0 });
      } else {
        startLooking(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const world = this.world;
      if (!world || this.leaving) return;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.looking) {
        const m = this.pointers.size >= 2 ? midpoint() : { x: e.clientX, y: e.clientY };
        // Like turning your head: drag down to look up, drag left to look right.
        world.setView(
          this.looking.tilt + (m.y - this.looking.y) / TILT_PIXELS,
          this.looking.yaw - (m.x - this.looking.x) / YAW_PIXELS,
          14,
        );
        return;
      }
      if (this.drawing && e.pointerId === this.drawing.id) {
        const coalesced = e.getCoalescedEvents?.() ?? [];
        for (const ev of coalesced.length ? coalesced : [e]) {
          const p = world.pick(ev.clientX, ev.clientY);
          if (!writable(p)) continue;
          const pr = pressureOf(ev);
          const moved = Math.hypot(p.x - this.drawing.x, p.y - this.drawing.y);
          const elapsed = Math.max(0.004, (ev.timeStamp - this.lastDrawAt) / 1000);
          this.lastDrawAt = ev.timeStamp;
          this.drawSpeed = Math.min(4, this.drawSpeed * 0.6 + (moved / elapsed) * 0.4);
          this.field.stamp(this.drawing.x, this.drawing.y, this.drawing.p, p.x, p.y, pr);
          this.drawing = { ...p, p: pr, id: this.drawing.id };
          this.marks = true;
        }
        Object.assign(this.hand, { x: this.drawing.x, y: this.drawing.y, lift: 0 });
        this.lastInput = this.clock;
        return;
      }
      if (e.pointerType !== 'touch') {
        // Hovering: the stick follows the mouse over the sand; elsewhere you can grab the view.
        const p = world.pick(e.clientX, e.clientY);
        if (writable(p)) {
          Object.assign(this.hand, { x: p.x, y: p.y, lift: 0.06 });
          canvas.style.cursor = 'crosshair';
        } else {
          canvas.style.cursor = 'grab';
        }
      }
    });

    const endPointer = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.drawing && this.drawing.id === e.pointerId) {
        this.drawing = null;
        this.hand.lift = 0.06;
      }
      if (this.looking && this.pointers.size === 0) {
        this.looking = null;
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
        const world = this.world;
        if (!world) return;
        world.setView(world.tilt - e.deltaY / (TILT_PIXELS * 2), world.yaw + e.deltaX / (YAW_PIXELS * 2), 8);
      },
      { passive: false },
    );
  }

  /** For automated checks in development. */
  debugState() {
    return {
      webgpu: this.world?.usingWebGPU ?? false,
      marks: this.marks,
      waves: { all: this.tide.waves, big: this.tide.bigWaves, swell: this.tide.swell },
    };
  }
}

/** Writes text in cursive with the stroke engine, as if by hand. Development only (?demo=words). */
async function createDemoWriter(text: string, field: SandField): Promise<SandWriter> {
  const [{ default: fontData }, { StrokeFont }, { DEFAULT_LAYOUT, SandLayout }, { createRng }, { DEFAULT_WRITER, SandWriter }] =
    await Promise.all([
      import('../strokes/fonts/ems-allure.json'),
      import('../strokes/glyphs'),
      import('../strokes/layout'),
      import('../strokes/random'),
      import('../strokes/writer'),
    ]);
  const writer = new SandWriter(new SandLayout(new StrokeFont(fontData), DEFAULT_LAYOUT, createRng(7)), DEFAULT_WRITER, field);
  for (const ch of text.slice(0, 200)) writer.type(ch);
  return writer;
}
