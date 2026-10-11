const PREF = 'utsuroi:sound';

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) !== 'off';
  } catch {
    return true;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? 'on' : 'off');
  } catch {
    // Storage blocked (private browsing): the choice lasts for this visit only.
  }
}

/**
 * One audio context for the whole app. Browsers only allow sound after the
 * person has interacted with the page, so the context is created on the
 * first click or key press and resumed after that.
 */
export class AudioEngine {
  private static instance: AudioEngine | null = null;
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private on = readPref();
  private readonly listeners = new Set<(on: boolean) => void>();

  static shared(): AudioEngine {
    AudioEngine.instance ??= new AudioEngine();
    return AudioEngine.instance;
  }

  private constructor() {
    const unlock = () => void this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The context, creating it if needed. It may still be suspended until the first interaction. */
  context(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 1 : 0;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async unlock(): Promise<void> {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Will try again on the next interaction.
      }
    }
  }

  setEnabled(on: boolean): void {
    this.on = on;
    writePref(on);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.15);
    for (const fn of this.listeners) fn(on);
  }

  onChange(fn: (on: boolean) => void): void {
    this.listeners.add(fn);
  }
}

/** Wires a speaker button to the shared sound setting. */
export function bindSoundToggle(button: HTMLButtonElement): void {
  const engine = AudioEngine.shared();
  const show = (on: boolean) => {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on');
    button.classList.toggle('off', !on);
  };
  show(engine.enabled);
  engine.onChange(show);
  button.addEventListener('click', () => engine.setEnabled(!engine.enabled));
}
