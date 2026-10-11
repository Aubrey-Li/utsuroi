import { nextPlacement } from '../stone/cairn';
import { isKeptEntry, MAX_TEXT, newId, type JournalEntry, type KeptEntry, type KeptStore, type StoneEntry } from './kept';
import { isRitualMark, localDate, type MarkStore, type RitualMark } from './marks';

/**
 * Everything that's kept, as one readable Markdown file: journal entries
 * and stones under their dates, then the days you wrote. Released words are
 * never in it, because they were never stored.
 *
 * Each entry carries a small HTML comment (hidden when the Markdown is
 * rendered) with what's needed to bring it back exactly: its id, dates, and
 * for a stone its seed and place on the cairn. An entry's words run from its
 * opening comment to a closing comment with the same id, so anything can be
 * written in an entry, headings included, without confusing the file.
 */

export const EXPORT_EXTENSION = '.md';
/** Refuse anything absurd before reading it. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 200_000;

export interface KeptContents {
  marks: RitualMark[];
  kept: KeptEntry[];
}

const OPEN = 'utsuroi:entry';
const CLOSE = 'utsuroi:end';
const DAYS = 'utsuroi:days';

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const dayDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

/** JSON that can't close the HTML comment it sits in. */
const meta = (v: unknown) => JSON.stringify(v).replace(/--/g, '-\\u002d');

function entryBlock(e: KeptEntry): string {
  const { text, ...rest } = e;
  return [`### ${longDate(e.createdAt)}`, `<!-- ${OPEN} ${meta(rest)} -->`, text, `<!-- ${CLOSE} ${e.id} -->`, ''].join('\n');
}

/** Writes what's kept as a Markdown file's text. */
export function toMarkdown(contents: KeptContents, now = new Date()): string {
  const byCreated = (a: KeptEntry, b: KeptEntry) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  const journal = contents.kept.filter((e) => e.kind === 'journal').sort(byCreated);
  const stones = contents.kept.filter((e) => e.kind === 'stone').sort(byCreated);
  const days = [...contents.marks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = [
    '# Utsuroi',
    '',
    `Saved ${longDate(now.toISOString())}: your journal entries, your stones, and the days you wrote. Released words aren't here; they were never kept.`,
    '',
    'To bring these back, open Utsuroi and choose What’s kept, then Add from a file. The small hidden notes beside each entry let it come back exactly as it was.',
    '',
    '## Journal',
    '',
    ...(journal.length ? journal.map(entryBlock) : ['No journal entries.', '']),
    '## Stones',
    '',
    ...(stones.length ? stones.map(entryBlock) : ['No stones.', '']),
    '## Days',
    '',
  ];
  if (days.length) {
    const lines = new Map<string, string[]>();
    for (const m of days) lines.set(m.date, [...(lines.get(m.date) ?? []), m.ritual]);
    for (const [date, rituals] of lines) out.push(`- ${dayDate(date)}: ${rituals.join(', ')}`);
    out.push('', `<!-- ${DAYS} ${meta(days)} -->`, '');
  } else {
    out.push('No days marked.', '');
  }
  return out.join('\n');
}

/** Why a file couldn't be read, in words for the person adding it. */
export class ImportError extends Error {
  constructor(
    readonly reason: 'empty' | 'too-large' | 'damaged',
    message: string,
  ) {
    super(message);
  }
}

/** True for a file this app saved (rather than any other text file). */
export function isUtsuroiExport(text: string): boolean {
  return text.includes(`<!-- ${OPEN} `) || text.includes(`<!-- ${DAYS} `);
}

/**
 * Reads a file this app saved. Every entry is checked before it's used;
 * anything that doesn't look right is left out rather than trusted.
 */
export function fromMarkdown(text: string): KeptContents {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('too-large', 'This file is too large.');
  const kept: KeptEntry[] = [];
  const marks: RitualMark[] = [];
  const opener = /<!-- utsuroi:entry (\{.*?\}) -->\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text)) && kept.length < MAX_ITEMS) {
    let head: Record<string, unknown>;
    try {
      head = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (typeof head.id !== 'string') continue;
    const closer = `\n<!-- ${CLOSE} ${head.id} -->`;
    const start = opener.lastIndex;
    const end = text.indexOf(closer, start);
    if (end < 0) continue;
    const entry = { ...head, text: text.slice(start, end).replace(/\r\n/g, '\n') };
    if (isKeptEntry(entry)) kept.push(entry);
    opener.lastIndex = end + closer.length;
  }
  const days = /<!-- utsuroi:days (\[.*?\]) -->/.exec(text);
  if (days) {
    try {
      const list: unknown = JSON.parse(days[1]!);
      if (Array.isArray(list)) marks.push(...list.slice(0, MAX_ITEMS).filter(isRitualMark));
    } catch {
      throw new ImportError('damaged', 'The list of days in this file is damaged, so nothing was added.');
    }
  }
  return { marks, kept };
}

/**
 * Any other text file becomes one journal entry, dated the day the file was
 * last changed. Too-long files are refused rather than cut.
 */
export function plainEntry(text: string, lastModified: number): JournalEntry {
  const body = text.replace(/\r\n/g, '\n').replace(/^﻿/, '').trim();
  if (!body) throw new ImportError('empty', 'This file is empty.');
  if (body.length > MAX_TEXT) throw new ImportError('too-large', `This file is longer than a journal entry can be (${MAX_TEXT.toLocaleString('en-US')} characters).`);
  const when = new Date(Number.isFinite(lastModified) && lastModified > 0 ? lastModified : Date.now());
  const iso = when.toISOString();
  return { id: newId(), kind: 'journal', date: localDate(when), createdAt: iso, updatedAt: iso, text: body };
}

export interface RestoreSummary {
  stones: number;
  entries: number;
  updated: number;
  marks: number;
}

const markKey = (m: RitualMark) => `${m.date}|${m.ritual}|${m.keptId ?? ''}`;

/**
 * Adds a file's contents to what's here. Nothing is removed. Stones and
 * entries already here are left alone, except a journal entry the file has
 * a newer edit of. Stones that would land where another stone already sits
 * are set on the cairns in the order they were carved. Marks are counted per
 * day and place, so adding the same file twice adds nothing.
 */
export async function restoreKept(contents: KeptContents, marks: MarkStore, kept: KeptStore): Promise<RestoreSummary> {
  const summary: RestoreSummary = { stones: 0, entries: 0, updated: 0, marks: 0 };
  const [stonesHere, journalHere, marksHere] = await Promise.all([kept.all('stone'), kept.all('journal'), marks.all()]);
  const known = new Map<string, KeptEntry>([...stonesHere, ...journalHere].map((e) => [e.id, e]));

  for (const e of contents.kept) {
    if (e.kind !== 'journal') continue;
    const here = known.get(e.id);
    if (!here) {
      await kept.put(e);
      known.set(e.id, e);
      summary.entries++;
    } else if (here.kind === 'journal' && e.updatedAt > here.updatedAt) {
      await kept.put(e);
      summary.updated++;
    }
  }

  const placed: StoneEntry[] = [...stonesHere];
  const taken = new Set(placed.map((s) => `${s.place.cairn}:${s.place.level}`));
  const incoming = contents.kept
    .filter((e): e is StoneEntry => e.kind === 'stone' && !known.has(e.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const s of incoming) {
    let stone = s;
    if (taken.has(`${s.place.cairn}:${s.place.level}`)) {
      const order = [...placed].sort((a, b) => a.place.cairn - b.place.cairn || a.place.level - b.place.level);
      stone = { ...s, place: nextPlacement(order.map((p) => ({ place: p.place, seed: p.seed })), s.seed) };
    }
    await kept.put(stone);
    placed.push(stone);
    taken.add(`${stone.place.cairn}:${stone.place.level}`);
    known.set(stone.id, stone);
    summary.stones++;
  }

  const have = new Map<string, number>();
  for (const m of marksHere) have.set(markKey(m), (have.get(markKey(m)) ?? 0) + 1);
  for (const m of contents.marks) {
    const k = markKey(m);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    await marks.add(m);
    summary.marks++;
  }
  return summary;
}

/** Everything kept on this device. */
export async function gatherKept(marks: MarkStore, kept: KeptStore): Promise<KeptContents> {
  const [m, stones, journal] = await Promise.all([marks.all(), kept.all('stone'), kept.all('journal')]);
  return { marks: m, kept: [...stones, ...journal] };
}

export function exportFileName(now = new Date()): string {
  return `utsuroi-${localDate(now)}${EXPORT_EXTENSION}`;
}
