import { codePoints } from '../strokes/input-diff';

export interface TypedInputOptions {
  maxLength: number;
  onChange(text: string): void;
  /** Called when typing would go past the limit. */
  onFull?(): void;
  /** Whether the scene is accepting typing right now. */
  isActive(): boolean;
}

/**
 * A hidden text field that collects typing for a scene. Works with IMEs
 * (Japanese, Chinese, etc.): text is only applied once composition ends.
 * Writing only grows or shrinks at the end, like a pen on paper.
 */
export class TypedInput {
  private text = '';
  private composing = false;

  constructor(
    private readonly field: HTMLTextAreaElement,
    private readonly options: TypedInputOptions,
  ) {
    field.addEventListener('compositionstart', () => (this.composing = true));
    field.addEventListener('compositionend', () => {
      this.composing = false;
      this.apply();
    });
    field.addEventListener('input', () => {
      if (!this.composing) this.apply();
    });
    field.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        e.preventDefault();
      }
    });
    field.addEventListener('select', () => this.pinCaret());

    // If focus wandered off (a click elsewhere, switching windows), the next
    // keystroke brings it back. Focusing during keydown lets that key land here.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!options.isActive() || field.disabled || document.activeElement === field) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Process') this.focus();
      },
      true,
    );
  }

  /** Keeps focus in the field when the scene itself is clicked or touched. */
  holdFocusOn(surface: HTMLElement): void {
    surface.addEventListener('pointerdown', (e) => {
      if (!this.options.isActive()) return;
      // The default would move focus to the page; keep it with the text instead.
      e.preventDefault();
      this.focus();
    });
  }

  get value(): string {
    return this.text;
  }

  focus(): void {
    if (!this.field.disabled) this.field.focus({ preventScroll: true });
  }

  setEnabled(on: boolean): void {
    this.field.disabled = !on;
    if (on) this.focus();
    else this.field.blur();
  }

  /** Replaces the text, for example to undo a change that didn't fit. */
  set(text: string): void {
    this.text = text;
    this.field.value = text;
    this.pinCaret();
  }

  /** Forgets everything typed. */
  clear(): void {
    this.text = '';
    this.field.value = '';
    this.options.onChange('');
  }

  private apply(): void {
    let chars = codePoints(this.field.value);
    if (chars.length > this.options.maxLength) {
      chars = chars.slice(0, this.options.maxLength);
      this.options.onFull?.();
    }
    const next = chars.join('');
    if (this.field.value !== next) this.field.value = next;
    this.pinCaret();
    if (next !== this.text) {
      this.text = next;
      this.options.onChange(next);
    }
  }

  private pinCaret(): void {
    const n = this.field.value.length;
    this.field.setSelectionRange(n, n);
  }
}
