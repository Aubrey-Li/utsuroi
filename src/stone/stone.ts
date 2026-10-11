import { AudioEngine } from '../audio/engine';
import { StoneSound } from '../audio/stone-sound';
import { localDate } from '../journal/marks';
import { newId, type KeptStore, type StoneEntry } from '../journal/kept';
import { loadHandFont } from '../text/font';
import { SceneShell, type RitualEvents } from '../ui/scene-shell';
import { TypedInput } from '../ui/typed-input';
import { nextPlacement } from './cairn';
import { StoneWorld } from './stone-world';

const COPY = {
  hint: 'Carve what you want to keep. It will stay.',
  full: 'That’s all this stone can hold.',
  saveFailed: 'This stone couldn’t be kept. Your browser may be blocking storage.',
  unsupported: 'This browser can’t show the shore. Try a recent Chrome, Edge, Safari or Firefox.',
  set: 'Set it on the cairn',
  putBack: 'Put it back',
  next: 'Next stone',
};

/** Dragging this far turns the view all the way (as on the shore). */
const TILT_PIXELS = 420;
const YAW_PIXELS = 520;
/** A press that moves less than this is a tap, not a drag. */
const TAP_SLOP = 6;

interface Drag {
  id: number;
  x: number;
  y: number;
  tilt: number;
  yaw: number;
  moved: boolean;
}

export interface StoneEvents extends RitualEvents {
  /** Keep a finished stone: its words and its mark on the calendar. */
  keep(entry: StoneEntry): Promise<void>;
  /** Done looking at a kept stone. */
  doneVisiting(): void;
}

/**
 * The stone ritual: carve a few words into a stone and set it on a cairn,
 * where it stays. Kept stones can be visited again from the calendar.
 */
export class StoneScene {
  private world: StoneWorld | null = null;
  private sound: StoneSound | null = null;
  private soundReady: Promise<StoneSound | null> | null = null;
  private readonly shell: SceneShell;
  private readonly input: TypedInput;
  private active = false;
  private last = 0;
  private hintTimer = 0;
  private fitted = '';
  private visitQueue: StoneEntry[] = [];
  private mode: 'carve' | 'visit' = 'carve';
  /** A kept stone is held up to read (while carving). */
  private holding = false;
  private drag: Drag | null = null;
  private readonly held: HTMLElement;
  private readonly heldWords: HTMLElement;
  private readonly heldDate: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly events: StoneEvents,
    private readonly store: KeptStore,
  ) {
    this.shell = new SceneShell(root, events);
    this.input = new TypedInput(this.shell.field, {
      isActive: () => this.active && this.mode === 'carve' && this.world?.stage === 'carving',
      maxLength: 80,
      onChange: (text) => {
        // Typing while a stone is held (or on its way) doesn't carve.
        const stage = this.world?.stage;
        if (stage === 'visiting' || stage === 'returning') {
          if (text !== this.fitted) this.input.set(this.fitted);
          return;
        }
        if (this.world && !this.world.setText(text)) {
          this.input.set(this.fitted);
          this.flashHint(COPY.full);
          return;
        }
        this.fitted = text;
        this.shell.action.disabled = text.trim() === '';
      },
    });
    const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
    this.held = q('[data-held]');
    this.heldWords = q('[data-held-words]');
    this.heldDate = q('[data-held-date]');
    this.bindLooking(this.shell.canvas);
    this.shell.action.addEventListener('click', () => void this.act());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active && this.world?.stage === 'visiting') void this.act();
    });
    window.addEventListener('resize', () => this.active && this.resize());
  }

  /** Opens the shore. With `visitDate`, lifts that day's stones off the cairn to read. */
  async enter(visitDate?: string): Promise<void> {
    this.shell.cover();
    await loadHandFont();
    if (!this.world) {
      const world = new StoneWorld(this.shell.canvas);
      try {
        await world.init();
      } catch {
        this.shell.hint.textContent = COPY.unsupported;
        this.shell.arrive();
        return;
      }
      world.onTap = () => this.sound?.tap();
      world.onSettle = () => this.sound?.set();
      this.world = world;
    }
    const kept = (await this.store.all('stone')).sort((a, b) => a.place.cairn - b.place.cairn || a.place.level - b.place.level);
    this.world.setKept(kept);
    this.world.reset();
    this.holding = false;
    this.showHeld(null);
    this.input.clear();
    this.fitted = '';
    this.active = true;
    this.resize();
    this.last = performance.now();
    this.world.renderer.setAnimationLoop(() => this.frame());
    this.startSound();
    this.shell.arrive();

    this.visitQueue = visitDate ? kept.filter((s) => s.date === visitDate) : [];
    if (this.visitQueue.length > 0) {
      this.mode = 'visit';
      this.input.setEnabled(false);
      this.showVisit();
    } else {
      this.mode = 'carve';
      this.showCarving();
      this.input.setEnabled(true);
    }
  }

  exit(): void {
    this.active = false;
    this.drag = null;
    this.input.setEnabled(false);
    this.world?.renderer.setAnimationLoop(null);
    this.sound?.stop();
  }

  private startSound(): void {
    const engine = AudioEngine.shared();
    const ctx = engine.context();
    if (!ctx || !engine.master) return;
    this.soundReady ??= StoneSound.create(ctx, engine.master).catch(() => null);
    void this.soundReady.then((s) => {
      this.sound = s;
      if (this.active) s?.start();
    });
  }

  private showCarving(): void {
    this.shell.action.textContent = COPY.set;
    this.shell.action.hidden = false;
    this.shell.action.disabled = this.input.value.trim() === '';
    this.shell.hint.textContent = COPY.hint;
  }

  private showVisit(): void {
    const stone = this.visitQueue[0]!;
    this.world!.visit(stone.id);
    this.showHeld(stone);
    this.shell.hint.textContent = '';
    this.shell.action.textContent = this.visitQueue.length > 1 ? COPY.next : COPY.putBack;
    this.shell.action.hidden = false;
    this.shell.action.disabled = false;
  }

  /** Takes a kept stone off its cairn and holds it up to read. */
  private hold(stone: StoneEntry): void {
    if (!this.world?.visit(stone.id)) return;
    this.holding = true;
    window.clearTimeout(this.hintTimer);
    this.showHeld(stone);
    this.shell.hint.textContent = '';
    this.shell.action.textContent = COPY.putBack;
    this.shell.action.hidden = false;
    this.shell.action.disabled = false;
  }

  private showHeld(stone: StoneEntry | null): void {
    if (stone) {
      const when = new Date(stone.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      this.heldWords.textContent = stone.text;
      this.heldDate.textContent = `Carved ${when}`;
    }
    this.held.classList.toggle('shown', stone !== null);
  }

  /**
   * Drag (or scroll) to look around the shore, as at the sea. A tap on a
   * kept stone picks it up; a tap anywhere while one is held puts it back.
   */
  private bindLooking(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.world || this.drag) return;
      // The default would move focus to the page; keep it with the words being carved.
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tilt: this.world.tilt, yaw: this.world.yaw, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      const world = this.world;
      if (!this.active || !world) return;
      const d = this.drag;
      if (!d) {
        canvas.classList.toggle('over-stone', e.pointerType === 'mouse' && world.stage === 'carving' && world.stoneAt(e.clientX, e.clientY) !== null);
        return;
      }
      if (e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) {
        d.moved = true;
        canvas.classList.add('dragging');
      }
      if (d.moved && world.stage === 'carving') world.setView(d.tilt + (e.clientY - d.y) / TILT_PIXELS, d.yaw - (e.clientX - d.x) / YAW_PIXELS, 14);
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      canvas.classList.remove('dragging');
      if (!cancelled && !d.moved) this.tap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', (e) => end(e, false));
    canvas.addEventListener('pointercancel', (e) => end(e, true));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.world?.stage !== 'carving') return;
        e.preventDefault();
        this.world.setView(this.world.tilt - e.deltaY / (TILT_PIXELS * 2), this.world.yaw + e.deltaX / (YAW_PIXELS * 2), 8);
      },
      { passive: false },
    );
  }

  private tap(x: number, y: number): void {
    const world = this.world;
    if (!world) return;
    if (world.stage === 'visiting') {
      void this.act();
      return;
    }
    if (world.stage !== 'carving' || this.mode !== 'carve') return;
    const stone = world.stoneAt(x, y);
    if (stone) {
      this.shell.canvas.classList.remove('over-stone');
      this.hold(stone);
    } else if (this.mode === 'carve') this.input.focus();
  }

  private async act(): Promise<void> {
    const world = this.world;
    if (!world) return;
    if (this.mode === 'visit' || this.holding) {
      if (world.stage !== 'visiting') return;
      world.putBack();
      this.showHeld(null);
      this.shell.action.disabled = true;
      return;
    }
    if (world.stage !== 'carving' || world.carved.trim() === '') return;
    const existing = world.stones.map((s) => ({ place: s.place, seed: s.seed }));
    const entry: StoneEntry = {
      id: newId(),
      kind: 'stone',
      date: localDate(),
      createdAt: new Date().toISOString(),
      text: world.carved,
      seed: world.currentSeed,
      place: nextPlacement(existing, world.currentSeed),
    };
    try {
      await this.events.keep(entry);
    } catch {
      this.flashHint(COPY.saveFailed);
      return;
    }
    world.setOnCairn(entry);
    this.input.setEnabled(false);
    this.input.clear();
    this.fitted = '';
    this.shell.action.hidden = true;
    this.shell.hint.textContent = '';
  }

  private flashHint(text: string): void {
    this.shell.hint.textContent = text;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      if (this.mode === 'carve' && this.world?.stage === 'carving') this.shell.hint.textContent = COPY.hint;
    }, 3500);
  }

  private resize(): void {
    this.world?.resize(window.innerWidth, window.innerHeight);
  }

  private wasCarving = true;

  private frame(): void {
    const world = this.world!;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    world.update(dt);
    const carving = world.stage === 'carving';
    if (carving && !this.wasCarving) {
      if (this.holding) {
        // Back on its cairn; carry on carving.
        this.holding = false;
        this.showCarving();
      } else if (this.mode === 'visit') {
        // That stone is back on its cairn: on to the next, or back to the calendar.
        this.visitQueue.shift();
        if (this.visitQueue.length > 0) this.showVisit();
        else this.events.doneVisiting();
      } else {
        this.events.released();
        this.showCarving();
        this.input.setEnabled(true);
      }
    }
    this.wasCarving = carving;
  }

  /** For automated checks in development. */
  debugState() {
    return {
      webgpu: this.world?.usingWebGPU ?? false,
      stage: this.world?.stage ?? 'none',
      stones: this.world?.stones.length ?? 0,
      mode: this.mode,
      holding: this.holding,
      view: { tilt: this.world?.tilt ?? 0, yaw: this.world?.yaw ?? 0 },
      onScreen: this.world?.onScreen() ?? [],
    };
  }
}
