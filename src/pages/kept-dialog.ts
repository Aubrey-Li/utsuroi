import {
  BACKUP_EXTENSION,
  BackupError,
  backupFileName,
  createBackup,
  gatherBackup,
  MAX_BACKUP_BYTES,
  MIN_PASSPHRASE,
  openBackup,
  restoreBackup,
  type RestoreSummary,
} from '../journal/backup';
import type { KeptStore } from '../journal/kept';
import type { MarkStore } from '../journal/marks';
import { el } from './icons';

/** When this browser last saved a backup. A convenience only; nothing depends on it. */
const LAST_BACKUP = 'utsuroi:lastBackup';

function lastBackup(): Date | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function rememberBackup(at: Date): void {
  try {
    localStorage.setItem(LAST_BACKUP, at.toISOString());
  } catch {
    // Private browsing: the reminder just won't remember.
  }
}

const longDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeRestore(s: RestoreSummary): string {
  const parts: string[] = [];
  if (s.stones) parts.push(plural(s.stones, 'stone', 'stones'));
  if (s.entries) parts.push(plural(s.entries, 'journal entry', 'journal entries'));
  if (s.marks) parts.push(plural(s.marks, 'day mark', 'day marks'));
  const added = parts.length ? `Restored ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Everything in this backup was already here.';
  const updated = s.updated ? ` ${plural(s.updated, 'journal entry was', 'journal entries were')} updated to the newer copy in the backup.` : '';
  return added + updated + (parts.length && !s.updated ? ' Nothing already here was changed.' : '');
}

export interface KeptDialog {
  open(): void;
  /** Rechecks whether anything new hasn't been backed up (for the reminder dot). */
  refresh(): Promise<void>;
}

/**
 * "What's kept": what stays on this device and what never does, and the
 * backup file that keeps a copy elsewhere. Opened from a small link at the
 * bottom of the home page.
 */
export function keptDialog(
  marks: MarkStore,
  kept: KeptStore,
  links: HTMLElement[],
  onRestored: () => void,
): KeptDialog {
  const status = el('p', { class: 'kd-status', 'aria-live': 'polite' });
  const since = el('p', { class: 'kd-since' });

  // Main view.
  const saveBtn = el('button', { type: 'button', class: 'kd-primary' }, 'Save a backup');
  const restoreBtn = el('button', { type: 'button', class: 'kd-secondary' }, 'Restore from a backup');
  const closeBtn = el('button', { type: 'button', class: 'dialog-close' }, 'Close');
  const mainView = el(
    'div',
    { class: 'kd-view' },
    el('h2', { id: 'kd-title' }, 'What’s kept'),
    el('p', {}, el('b', {}, 'Kept, only on this device: '), 'stones and journal entries (encrypted), and a mark on each day you wrote, showing only which place.'),
    el('p', {}, el('b', {}, 'Never kept: '), 'anything you give to the sea, the wind or the fire. Those words exist only while the scene is open.'),
    el('p', {}, el('b', {}, 'Never sent: '), 'there’s no account and no server. Nothing you write leaves this device.'),
    el('h3', {}, 'Backup'),
    el('p', {}, 'What’s kept lives in this browser, so clearing its data erases it. A backup file keeps a copy, locked with a passphrase, that you can restore here or on another device.'),
    since,
    el('div', { class: 'kd-actions' }, saveBtn, restoreBtn),
    closeBtn,
  );

  // Save view.
  const pass1 = el('input', { type: 'password', id: 'kd-pass', autocomplete: 'new-password', minlength: String(MIN_PASSPHRASE), required: '' });
  const pass2 = el('input', { type: 'password', id: 'kd-pass2', autocomplete: 'new-password', required: '' });
  const saveGo = el('button', { type: 'submit', class: 'kd-primary' }, 'Save backup file');
  const saveBack = el('button', { type: 'button', class: 'kd-secondary' }, 'Back');
  const saveForm = el(
    'form',
    { class: 'kd-view', hidden: '', novalidate: '' },
    el('h2', {}, 'Save a backup'),
    el('p', {}, 'Your stones, journal entries and day marks, in one file. Choose a passphrase to lock it.'),
    el('label', { for: 'kd-pass' }, 'Passphrase'),
    pass1,
    el('label', { for: 'kd-pass2' }, 'Type it again'),
    pass2,
    el('p', { class: 'kd-warn' }, 'If you forget this passphrase, the backup can’t be opened. No one can recover it for you.'),
    el('div', { class: 'kd-actions' }, saveGo, saveBack),
  );

  // Restore view.
  const file = el('input', { type: 'file', id: 'kd-file', accept: `${BACKUP_EXTENSION},application/json`, required: '' });
  const pass3 = el('input', { type: 'password', id: 'kd-pass3', autocomplete: 'current-password', required: '' });
  const restoreGo = el('button', { type: 'submit', class: 'kd-primary' }, 'Restore');
  const restoreBack = el('button', { type: 'button', class: 'kd-secondary' }, 'Back');
  const restoreForm = el(
    'form',
    { class: 'kd-view', hidden: '', novalidate: '' },
    el('h2', {}, 'Restore from a backup'),
    el('p', {}, 'Adds what’s in the backup to what’s here. Nothing here is removed.'),
    el('label', { for: 'kd-file' }, 'Backup file'),
    file,
    el('label', { for: 'kd-pass3' }, 'Passphrase'),
    pass3,
    el('div', { class: 'kd-actions' }, restoreGo, restoreBack),
  );

  const dialog = el('dialog', { class: 'support kept-dialog', 'aria-labelledby': 'kd-title' }, mainView, saveForm, restoreForm);
  document.body.append(dialog);

  const show = (view: HTMLElement) => {
    for (const v of [mainView, saveForm, restoreForm]) v.hidden = v !== view;
    // Messages sit just above the buttons they answer.
    view.insertBefore(status, view.querySelector('.kd-actions'));
    status.textContent = '';
    view.querySelector<HTMLElement>('input, button')?.focus();
  };
  const busy = (on: boolean, btn: HTMLButtonElement, label: string) => {
    btn.disabled = on;
    btn.textContent = label;
  };

  let unsaved = 0;
  const refresh = async () => {
    const at = lastBackup();
    const all = [...(await kept.all('stone')), ...(await kept.all('journal'))];
    const newer = all.filter((e) => !at || new Date(e.kind === 'journal' ? e.updatedAt : e.createdAt) > at).length;
    unsaved = newer;
    since.textContent = at
      ? `Last backup: ${longDate(at)}.${newer ? ` ${plural(newer, 'stone or entry is', 'stones or entries are')} newer than it.` : ' Nothing new since.'}`
      : all.length
        ? 'No backup yet.'
        : 'Nothing is kept yet, so there’s nothing to back up.';
    saveBtn.disabled = all.length === 0 && (await marks.all()).length === 0;
    for (const link of links) link.classList.toggle('has-unsaved', unsaved > 0 && all.length > 0);
  };

  saveBtn.addEventListener('click', () => {
    pass1.value = pass2.value = '';
    show(saveForm);
  });
  restoreBtn.addEventListener('click', () => {
    file.value = '';
    pass3.value = '';
    show(restoreForm);
  });
  saveBack.addEventListener('click', () => show(mainView));
  restoreBack.addEventListener('click', () => show(mainView));
  closeBtn.addEventListener('click', () => dialog.close());

  saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pass1.value.length < MIN_PASSPHRASE) {
      status.textContent = `Choose a passphrase of at least ${MIN_PASSPHRASE} characters. A few words you’ll remember works well.`;
      pass1.focus();
      return;
    }
    if (pass1.value !== pass2.value) {
      status.textContent = 'The two passphrases don’t match.';
      pass2.focus();
      return;
    }
    busy(true, saveGo, 'Locking…');
    try {
      const now = new Date();
      const text = await createBackup(await gatherBackup(marks, kept), pass1.value, { now });
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = el('a', { href: url, download: backupFileName(now) });
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      rememberBackup(now);
      pass1.value = pass2.value = '';
      await refresh();
      show(mainView);
      status.textContent = `Saved ${backupFileName(now)}. Keep it somewhere safe, like a cloud folder.`;
    } catch {
      status.textContent = 'The backup couldn’t be made. Your browser may be blocking storage.';
    } finally {
      busy(false, saveGo, 'Save backup file');
    }
  });

  restoreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = file.files?.[0];
    if (!f) {
      status.textContent = 'Choose a backup file first.';
      file.focus();
      return;
    }
    if (f.size > MAX_BACKUP_BYTES) {
      status.textContent = 'This file is too large to be a backup.';
      return;
    }
    if (!pass3.value) {
      status.textContent = 'Enter the passphrase the backup was saved with.';
      pass3.focus();
      return;
    }
    busy(true, restoreGo, 'Unlocking…');
    try {
      const contents = await openBackup(await f.text(), pass3.value);
      const summary = await restoreBackup(contents, marks, kept);
      pass3.value = '';
      onRestored();
      await refresh();
      show(mainView);
      status.textContent = describeRestore(summary);
    } catch (err) {
      status.textContent = err instanceof BackupError ? err.message : 'The backup couldn’t be restored. Your browser may be blocking storage.';
      if (err instanceof BackupError && err.reason === 'wrong-passphrase') pass3.select();
    } finally {
      busy(false, restoreGo, 'Restore');
    }
  });

  return {
    open() {
      show(mainView);
      void refresh();
      dialog.showModal();
      closeBtn.focus();
    },
    refresh,
  };
}
