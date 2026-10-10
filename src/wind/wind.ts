import { loadHandFont } from '../text/font';
import { SceneShell, type RitualEvents } from '../ui/scene-shell';
import { TypedInput } from '../ui/typed-input';
import { WindWorld } from './wind-world';

const COPY = {
  hint: 'Type what you want to let go. It will wait here until you’re ready.',
  full: 'That’s as much as the wind can carry at once.',
  gone: 'The wind has it.',
  unsupported: 'This browser can’t show the meadow. Try a recent Chrome, Edge, Safari or Firefox.',
};

/**
 * The wind ritual: typed words float in the air under a tree on a sunny
 * day. Nothing moves until you choose to let the wind take them.
 */
export class WindScene {
  private world: WindWorld | null = null;
  private readonly shell: SceneShell;
  private readonly input: TypedInput;
  private active = false;
  private releasing = false;
  private last = 0;

  constructor(root: HTMLElement, events: RitualEvents) {
    this.shell = new SceneShell(root, events);
    this.input = new TypedInput(this.shell.field, {
      isActive: () => this.active && !this.releasing,
      maxLength: 160,
      onChange: (text) => {
        this.world?.setText(text);
        this.shell.action.disabled = text.trim() === '';
      },
      onFull: () => this.flashHint(COPY.full),
    });
    this.shell.action.addEventListener('click', () => this.release());
    this.input.holdFocusOn(this.shell.canvas);
    window.addEventListener('resize', () => this.active && this.resize());
    this.events = events;
  }

  private readonly events: RitualEvents;
  private hintTimer = 0;

  async enter(): Promise<void> {
    this.shell.cover();
    await loadHandFont();
    if (!this.world) {
      const world = new WindWorld(this.shell.canvas);
      try {
        await world.init();
      } catch {
        this.shell.hint.textContent = COPY.unsupported;
        this.shell.arrive();
        return;
      }
      this.world = world;
    }
    this.world.reset();
    this.input.clear();
    this.releasing = false;
    this.shell.action.hidden = false;
    this.shell.action.disabled = true;
    this.shell.hint.textContent = COPY.hint;
    this.active = true;
    this.resize();
    this.last = performance.now();
    this.world.renderer.setAnimationLoop(() => this.frame());
    this.shell.arrive();
    this.input.setEnabled(true);
  }

  exit(): void {
    this.active = false;
    this.input.setEnabled(false);
    this.world?.renderer.setAnimationLoop(null);
  }

  private resize(): void {
    this.world?.resize(window.innerWidth, window.innerHeight);
  }

  private flashHint(text: string): void {
    this.shell.hint.textContent = text;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (this.shell.hint.textContent = this.releasing ? '' : COPY.hint), 3500);
  }

  /** Only when asked: the wind comes and takes the words. */
  private release(): void {
    if (!this.world || this.releasing || this.input.value.trim() === '') return;
    this.releasing = true;
    this.world.release();
    this.input.setEnabled(false);
    // The words now exist only in the air.
    this.input.clear();
    this.shell.action.hidden = true;
    this.shell.hint.textContent = '';
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const finished = this.world!.update(dt);
    if (finished && this.releasing) {
      this.releasing = false;
      this.shell.showMessage(COPY.gone);
      this.events.released();
      window.setTimeout(() => {
        if (!this.active) return;
        this.shell.action.hidden = false;
        this.shell.action.disabled = true;
        this.shell.hint.textContent = COPY.hint;
        this.input.setEnabled(true);
      }, 2500);
    }
  }

  /** For automated checks in development. */
  debugState() {
    return { webgpu: this.world?.usingWebGPU ?? false, releasing: this.releasing, text: this.input.value.length };
  }
}
