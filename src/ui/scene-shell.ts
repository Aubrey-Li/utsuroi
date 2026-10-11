import { bindSoundToggle } from '../audio/engine';

/** Events every ritual scene reports to the app. */
export interface RitualEvents {
  /** The place has taken what was written: the ritual is complete. */
  released(): void;
  /** The person chose to leave. */
  leave(): void;
}

/** The interface around a scene: hint, action button, veil, Leave. */
export class SceneShell {
  readonly canvas: HTMLCanvasElement;
  readonly hint: HTMLElement;
  readonly action: HTMLButtonElement;
  readonly field: HTMLTextAreaElement;
  private readonly veil: HTMLElement;
  private leaving = false;

  constructor(
    readonly root: HTMLElement,
    private readonly events: RitualEvents,
  ) {
    const q = <T extends HTMLElement>(sel: string) => {
      const el = root.querySelector<T>(sel);
      if (!el) throw new Error(`Missing ${sel}`);
      return el;
    };
    this.canvas = q<HTMLCanvasElement>('canvas');
    this.hint = q('[data-hint]');
    this.action = q<HTMLButtonElement>('[data-action]');
    this.field = q<HTMLTextAreaElement>('textarea');
    this.veil = q('[data-veil]');
    q<HTMLButtonElement>('[data-leave]').addEventListener('click', () => this.leave());
    bindSoundToggle(q<HTMLButtonElement>('[data-sound]'));
  }

  get isLeaving(): boolean {
    return this.leaving;
  }

  arrive(): void {
    this.leaving = false;
    requestAnimationFrame(() => this.veil.classList.remove('shown'));
  }

  cover(): void {
    this.veil.classList.add('shown');
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cover();
    window.setTimeout(() => this.events.leave(), 650);
  }
}
