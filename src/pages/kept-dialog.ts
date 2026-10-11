import {
  exportFileName,
  fromMarkdown,
  gatherKept,
  ImportError,
  isUtsuroiExport,
  MAX_IMPORT_BYTES,
  plainEntry,
  restoreKept,
  toMarkdown,
  type KeptContents,
  type RestoreSummary,
} from '../journal/export';
import type { KeptStore } from '../journal/kept';
import type { MarkStore } from '../journal/marks';
import { el } from './icons';

/** When this browser last saved a copy. A convenience only; nothing depends on it. */
const LAST_SAVED = 'utsuroi:lastBackup';

function lastSaved(): Date | null {
  try {
    const v = localStorage.getItem(LAST_SAVED);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function rememberSaved(at: Date): void {
  try {
    localStorage.setItem(LAST_SAVED, at.toISOString());
  } catch {
    // Private browsing: the reminder just won't remember.
  }
}

const longDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function list(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function describe(s: RestoreSummary, skipped: string[]): string {
  const parts: string[] = [];
  if (s.entries) parts.push(plural(s.entries, 'journal entry', 'journal entries'));
  if (s.stones) parts.push(plural(s.stones, 'stone', 'stones'));
  if (s.marks) parts.push(plural(s.marks, 'day', 'days'));
  let msg = parts.length ? `Added ${list(parts)}.` : 'Everything in this file was already here.';
  if (s.updated) msg += ` ${plural(s.updated, 'journal entry was', 'journal entries were')} updated to the newer copy.`;
  if (skipped.length) msg += ` ${skipped.join(' ')}`;
  return msg;
}

export interface KeptDialog {
  open(): void;
  /** Rechecks whether anything new hasn't been saved (for the reminder dot). */
  refresh(): Promise<void>;
}

/**
 * "What's kept": what stays on this device and what never does, and a way
 * to take it with you as a readable file, or bring entries in from one.
 * Opened from a small link at the bottom of the home page.
 */
export function keptDialog(marks: MarkStore, kept: KeptStore, links: HTMLElement[], onAdded: () => void): KeptDialog {
  const status = el('p', { class: 'kd-status', 'aria-live': 'polite' });
  const since = el('p', { class: 'kd-since' });

  const saveBtn = el('button', { type: 'button', class: 'kd-primary' }, 'Download everything');
  const addBtn = el('button', { type: 'button', class: 'kd-secondary' }, 'Add from a file');
  const closeBtn = el('button', { type: 'button', class: 'dialog-close' }, 'Close');
  const file = el('input', { type: 'file', id: 'kd-file', class: 'visually-hidden', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: '' });
  const view = el(
    'div',
    { class: 'kd-view' },
    el('h2', { id: 'kd-title' }, 'What’s kept'),
    el('p', {}, el('b', {}, 'Kept, only on this device: '), 'stones and journal entries (encrypted), and a mark on each day you wrote, showing only which place.'),
    el('p', {}, el('b', {}, 'Never kept: '), 'anything you give to the sea, the wind or the fire. Those words exist only while the scene is open.'),
    el('p', {}, el('b', {}, 'Never sent: '), 'there’s no account and no server. Nothing you write leaves this device.'),
    el('h3', {}, 'Take it with you'),
    el(
      'p',
      {},
      'What’s kept lives in this browser, so clearing its data erases it. Download everything as a readable Markdown file to keep a copy; it isn’t locked, so keep it somewhere private. Add from a file brings one back, or turns any text file into a journal entry.',
    ),
    since,
    status,
    el('div', { class: 'kd-actions' }, saveBtn, addBtn),
    file,
    closeBtn,
  );
  const dialog = el('dialog', { class: 'support kept-dialog', 'aria-labelledby': 'kd-title' }, view);
  document.body.append(dialog);

  let total = 0;
  const refresh = async () => {
    const at = lastSaved();
    const all = [...(await kept.all('stone')), ...(await kept.all('journal'))];
    const days = (await marks.all()).length;
    total = all.length + days;
    const newer = all.filter((e) => !at || new Date(e.kind === 'journal' ? e.updatedAt : e.createdAt) > at).length;
    since.textContent = at
      ? `Last downloaded ${longDate(at)}.${newer ? ` ${plural(newer, 'stone or entry is', 'stones or entries are')} newer than that.` : ' Nothing new since.'}`
      : all.length
        ? 'Not downloaded yet.'
        : 'Nothing is kept yet.';
    saveBtn.disabled = total === 0;
    for (const link of links) link.classList.toggle('has-unsaved', newer > 0 && all.length > 0);
  };

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const now = new Date();
      const text = toMarkdown(await gatherKept(marks, kept), now);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      const a = el('a', { href: url, download: exportFileName(now) });
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      rememberSaved(now);
      await refresh();
      status.textContent = `Downloaded ${exportFileName(now)}.`;
    } catch {
      status.textContent = 'Couldn’t read what’s kept. Your browser may be blocking storage.';
    } finally {
      saveBtn.disabled = total === 0;
    }
  });

  addBtn.addEventListener('click', () => {
    file.value = '';
    file.click();
  });

  file.addEventListener('change', async () => {
    const files = [...(file.files ?? [])];
    if (files.length === 0) return;
    addBtn.disabled = true;
    status.textContent = 'Adding…';
    const contents: KeptContents = { marks: [], kept: [] };
    const skipped: string[] = [];
    for (const f of files) {
      try {
        if (f.size > MAX_IMPORT_BYTES) throw new ImportError('too-large', 'This file is too large.');
        const text = await f.text();
        if (isUtsuroiExport(text)) {
          const got = fromMarkdown(text);
          contents.kept.push(...got.kept);
          contents.marks.push(...got.marks);
        } else {
          contents.kept.push(plainEntry(text, f.lastModified));
        }
      } catch (err) {
        const why = err instanceof ImportError ? err.message : 'It couldn’t be read.';
        skipped.push(`${f.name} wasn’t added: ${why.charAt(0).toLowerCase()}${why.slice(1)}`);
      }
    }
    try {
      const summary = await restoreKept(contents, marks, kept);
      onAdded();
      await refresh();
      status.textContent = describe(summary, skipped);
    } catch {
      status.textContent = 'Couldn’t add these. Your browser may be blocking storage.';
    } finally {
      addBtn.disabled = false;
    }
  });

  closeBtn.addEventListener('click', () => dialog.close());

  return {
    open() {
      status.textContent = '';
      void refresh();
      dialog.showModal();
      closeBtn.focus();
    },
    refresh,
  };
}
