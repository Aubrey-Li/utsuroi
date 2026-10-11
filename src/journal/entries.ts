import type { JournalEntry } from './kept';
import { localDate } from './marks';
import { newId } from './kept';

/** A first-line preview of an entry for the list. */
export function previewOf(text: string, max = 80): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function newJournalEntry(now = new Date()): JournalEntry {
  const iso = now.toISOString();
  return { id: newId(), kind: 'journal', date: localDate(now), createdAt: iso, updatedAt: iso, text: '' };
}

/** Entries newest first, grouped under their month. */
export function groupByMonth(entries: readonly JournalEntry[], locale?: string): { label: string; entries: JournalEntry[] }[] {
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const groups: { key: string; label: string; entries: JournalEntry[] }[] = [];
  for (const e of sorted) {
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const [y, m] = key.split('-').map(Number);
      g = { key, label: fmt.format(new Date(y!, m! - 1, 1)), entries: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups.map(({ label, entries }) => ({ label, entries }));
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
