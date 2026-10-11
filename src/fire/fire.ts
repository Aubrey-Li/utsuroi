import { AudioEngine } from '../audio/engine';
import { FireSound } from '../audio/fire-sound';
import { loadHandFont } from '../text/font';
import { SceneShell, type RitualEvents } from '../ui/scene-shell';
import { TypedInput } from '../ui/typed-input';
import { FireWorld } from './fire-world';

const COPY = {
  hint: 'Write your letter. When it’s done, light it.',
  full: 'The page is full.',
  unsupported: 'This browser can’t show the room. Try a recent Chrome, Edge, Safari or Firefox.',
};

/**
 * The fire ritual: a letter on a blank page by candlelight, burned when
 * you decide it's done.
 */
export class FireScene {
  private world: FireWorld | null = null;
  private sound: FireSound | null = null;
  private readonly shell: SceneShell;
  private readonly input: TypedInput;
  private active = false;
  private burning = false;
  private last = 0;
  private hintTimer = 0;
  private fitted = '';

  constructor(
    root: HTMLElement,
    private readonly events: RitualEvents,
  ) {
    this.shell = new SceneShell(root, events);
    this.input = new TypedInput(this.shell.field, {
      isActive: () => this.active && !this.burning,
      maxLength: 2400,
      onChange: (text) => {
        if (this.world && !this.world.setText(text)) {
          this.input.set(this.fitted);
          this.flashHint(COPY.full);
          return;
        }
        // A pen stroke for each new character (a few at most, for pasted text).
        const added = Math.min(3, Array.from(text).length - Array.from(this.fitted).length);
        for (let i = 0; i < added; i++) window.setTimeout(() => this.sound?.penStroke(), i * 40);
        this.fitted = text;
        this.shell.action.disabled = text.trim() === '';
      },
    });
    this.shell.action.addEventListener('click', () => this.light());
    this.input.holdFocusOn(this.shell.canvas);
    window.addEventListener('resize', () => this.active && this.resize());
  }

  async enter(): Promise<void> {
    this.shell.cover();
    await loadHandFont();
    if (!this.world) {
      const world = new FireWorld(this.shell.canvas);
      try {
        await world.init();
      } catch {
        this.shell.hint.textContent = COPY.unsupported;
        this.shell.arrive();
        return;
      }
      world.onIgnite = () => this.sound?.ignite();
      this.world = world;
    }
    this.world.reset();
    this.input.clear();
    this.fitted = '';
    this.burning = false;
    this.shell.action.hidden = false;
    this.shell.action.disabled = true;
    this.shell.hint.textContent = COPY.hint;
    this.active = true;
    this.resize();
    this.last = performance.now();
    this.world.renderer.setAnimationLoop(() => this.frame());
    this.startSound();
    this.shell.arrive();
    this.input.setEnabled(true);
  }

  exit(): void {
    this.active = false;
    this.input.setEnabled(false);
    this.world?.renderer.setAnimationLoop(null);
    this.sound?.stop();
  }

  private startSound(): void {
    const engine = AudioEngine.shared();
    const ctx = engine.context();
    if (!ctx || !engine.master) return;
    this.sound ??= new FireSound(ctx, engine.master);
    this.sound.start();
  }

  private resize(): void {
    this.world?.resize(window.innerWidth, window.innerHeight);
  }

  private flashHint(text: string): void {
    this.shell.hint.textContent = text;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (this.shell.hint.textContent = this.burning ? '' : COPY.hint), 3000);
  }

  private light(): void {
    if (!this.world || this.burning || this.input.value.trim() === '') return;
    this.burning = true;
    this.world.light();
    this.input.setEnabled(false);
    // The words now exist only on the page that's about to burn.
    this.input.clear();
    this.fitted = '';
    this.shell.action.hidden = true;
    this.shell.hint.textContent = '';
  }

  private frame(): void {
    const world = this.world!;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const burntOut = world.update(dt);
    this.sound?.update(dt, world.intensity, world.flickerLevel);
    if (burntOut) {
      this.events.released();
    }
    // A fresh page has settled: ready for another letter.
    if (this.burning && world.canWrite) {
      this.burning = false;
      this.shell.action.hidden = false;
      this.shell.action.disabled = true;
      this.shell.hint.textContent = COPY.hint;
      this.input.setEnabled(true);
    }
  }

  /** For automated checks in development. */
  debugState() {
    return { webgpu: this.world?.usingWebGPU ?? false, burning: this.burning, text: this.input.value.length };
  }
}
