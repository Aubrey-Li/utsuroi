import { groupByMonth, newJournalEntry, previewOf, wordCount } from '../journal/entries';
import type { JournalEntry, KeptStore } from '../journal/kept';
import { loadHandFont } from '../text/font';
import { el } from './icons';

const SAVE_DELAY = 700;

/**
 * A plain journal: entries you keep, edit and reread. Stored on the device,
 * encrypted. Saves as you type; empty entries aren't kept.
 */
export class JournalPage {
  private entries: JournalEntry[] = [];
  private current: JournalEntry | null = null;
  /** Whether the current entry has been written to storage yet. */
  private stored = false;
  private saveTimer = 0;
  private saving: Promise<void> = Promise.resolve();
  private readonly list: HTMLElement;
  private readonly editor: HTMLElement;
  private readonly date: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly note: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: KeptStore,
  ) {
    const newBtn = el('button', { type: 'button', class: 'jr-new' }, 'New entry');
    newBtn.addEventListener('click', () => void this.open(newJournalEntry(), false));
    this.list = el('nav', { class: 'jr-entries', 'aria-label': 'Entries' });
    this.note = el('p', { class: 'jr-note' });

    this.date = el('h2', { class: 'jr-date' });
    this.text = el('textarea', { class: 'jr-text', 'aria-label': 'Journal entry', placeholder: 'What’s on your mind?', spellcheck: 'true' });
    this.text.addEventListener('input', () => this.changed());
    this.status = el('span', { class: 'jr-status', 'aria-live': 'polite' });
    this.count = el('span', { class: 'jr-count' });
    const del = el('button', { type: 'button', class: 'linklike jr-delete' }, 'Delete');
    const back = el('button', { type: 'button', class: 'linklike jr-back' }, '← Entries');
    back.addEventListener('click', () => void this.closeEditor());

    const yes = el('button', { type: 'button', class: 'jr-confirm-yes' }, 'Delete');
    const no = el('button', { type: 'button', class: 'jr-confirm-no' }, 'Keep it');
    this.confirm = el('div', { class: 'jr-confirm', hidden: '' }, el('span', {}, 'Delete this entry? It can’t be undone.'), yes, no);
    del.addEventListener('click', () => {
      this.confirm.hidden = false;
      no.focus();
    });
    no.addEventListener('click', () => (this.confirm.hidden = true));
    yes.addEventListener('click', () => void this.deleteCurrent());

    this.editor = el(
      'article',
      { class: 'jr-editor', hidden: '' },
      el('div', { class: 'jr-editor-top' }, back, this.date),
      this.text,
      el('footer', { class: 'jr-foot' }, this.count, this.status, del),
      this.confirm,
    );
    this.empty = el(
      'div',
      { class: 'jr-empty' },
      el('p', { class: 'jr-empty-title' }, 'A page for you.'),
      el('p', {}, 'Write whatever you like. Entries stay on this device, encrypted, and only you can read them here.'),
    );
    const start = el('button', { type: 'button', class: 'jr-start' }, 'Start today’s entry');
    start.addEventListener('click', () => void this.open(newJournalEntry(), false));
    this.empty.append(start);

    root.replaceChildren(
      el(
        'header',
        { class: 'page-brand jr-brand' },
        el('a', { href: '#/', class: 'back' }, '← Back'),
        el('span', { class: 'brand-name' }, 'utsuroi'),
        el('span', { class: 'brand-jp', lang: 'ja' }, '移ろい'),
      ),
      el(
        'main',
        { class: 'jr-book' },
        el('aside', { class: 'jr-side' }, el('h1', { class: 'jr-title', tabindex: '-1' }, 'Journal'), newBtn, this.list, this.note),
        el('section', { class: 'jr-page' }, this.empty, this.editor),
      ),
    );
    // Don't lose words if the tab is closed mid-sentence.
    window.addEventListener('pagehide', () => void this.flush());
  }

  /** Opens the journal; with `date`, opens the first entry from that day. */
  async show(date?: string): Promise<void> {
    void loadHandFont();
    this.entries = await this.store.all('journal');
    this.note.textContent = this.store.persistent ? '' : 'This browser isn’t saving entries (private browsing or storage turned off). They’ll be gone when you close the tab.';
    this.renderList();
    const onDay = date ? this.sorted().find((e) => e.date === date) : undefined;
    if (onDay) await this.open(onDay, true);
    else this.showEmpty();
  }

  /** Called when leaving the page: save what's there. */
  async hide(): Promise<void> {
    await this.flush();
  }

  private sorted(): JournalEntry[] {
    return [...this.entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  private renderList(): void {
    const groups = groupByMonth(this.entries);
    if (groups.length === 0) {
      this.list.replaceChildren(el('p', { class: 'jr-none' }, 'No entries yet.'));
      return;
    }
    const items: HTMLElement[] = [];
    for (const g of groups) {
      items.push(el('h3', { class: 'jr-month' }, g.label));
      const ul = el('ul', {});
      for (const e of g.entries) {
        const when = new Date(e.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const btn = el(
          'button',
          { type: 'button', class: `jr-item${this.current?.id === e.id ? ' current' : ''}` },
          el('span', { class: 'jr-item-date' }, when),
          el('span', { class: 'jr-item-text' }, previewOf(e.text) || 'Untitled'),
        );
        if (this.current?.id === e.id) btn.setAttribute('aria-current', 'true');
        btn.addEventListener('click', () => void this.open(e, true));
        ul.append(el('li', {}, btn));
      }
      items.push(ul);
    }
    this.list.replaceChildren(...items);
  }

  private showEmpty(): void {
    this.current = null;
    this.editor.hidden = true;
    this.empty.hidden = false;
    this.root.classList.remove('editing');
    this.renderList();
  }

  private async open(entry: JournalEntry, stored: boolean): Promise<void> {
    await this.flush();
    this.current = { ...entry };
    this.stored = stored;
    this.confirm.hidden = true;
    this.empty.hidden = true;
    this.editor.hidden = false;
    this.root.classList.add('editing');
    this.date.textContent = new Date(entry.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    this.text.value = entry.text;
    this.count.textContent = this.countLabel(entry.text);
    this.status.textContent = stored ? 'Saved' : '';
    this.renderList();
    this.text.focus({ preventScroll: true });
    const end = this.text.value.length;
    this.text.setSelectionRange(end, end);
  }

  private async closeEditor(): Promise<void> {
    await this.flush();
    this.showEmpty();
  }

  private countLabel(text: string): string {
    const n = wordCount(text);
    return n === 1 ? '1 word' : `${n} words`;
  }

  private changed(): void {
    if (!this.current) return;
    this.current.text = this.text.value;
    this.current.updatedAt = new Date().toISOString();
    this.count.textContent = this.countLabel(this.current.text);
    this.status.textContent = 'Saving…';
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** Saves the current entry now (or removes it if it's been emptied). */
  private flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const entry = this.current;
    if (!entry) return this.saving;
    const snapshot = { ...entry };
    this.saving = this.saving.then(async () => {
      try {
        if (snapshot.text.trim() === '') {
          if (this.stored) await this.store.remove(snapshot.id);
          this.stored = false;
          this.entries = this.entries.filter((e) => e.id !== snapshot.id);
          if (this.current?.id === snapshot.id) this.status.textContent = '';
        } else {
          await this.store.put(snapshot);
          this.stored = true;
          const i = this.entries.findIndex((e) => e.id === snapshot.id);
          if (i >= 0) this.entries[i] = snapshot;
          else this.entries.push(snapshot);
          if (this.current?.id === snapshot.id) this.status.textContent = 'Saved';
        }
        this.renderList();
      } catch {
        if (this.current?.id === snapshot.id) this.status.textContent = 'Couldn’t save. Your browser may be blocking storage.';
      }
    });
    return this.saving;
  }

  private async deleteCurrent(): Promise<void> {
    const entry = this.current;
    if (!entry) return;
    window.clearTimeout(this.saveTimer);
    await this.saving;
    try {
      if (this.stored) await this.store.remove(entry.id);
    } catch {
      this.status.textContent = 'Couldn’t delete.';
      return;
    }
    this.entries = this.entries.filter((e) => e.id !== entry.id);
    this.stored = false;
    this.current = null;
    this.showEmpty();
  }

  /** For automated checks in development. */
  debugState() {
    return { entries: this.entries.length, open: this.current?.id ?? null, stored: this.stored, status: this.status.textContent };
  }
}
