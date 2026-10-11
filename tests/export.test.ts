import { describe, expect, it } from 'vitest';
import { fromMarkdown, ImportError, isUtsuroiExport, plainEntry, restoreKept, toMarkdown, type KeptContents } from '../src/journal/export';
import { MAX_TEXT, MemoryKeptStore, type JournalEntry, type StoneEntry } from '../src/journal/kept';
import { MemoryMarkStore } from '../src/journal/marks';
import { nextPlacement } from '../src/stone/cairn';

function stone(id: string, createdAt: string, existing: StoneEntry[] = []): StoneEntry {
  const seed = id.length * 97 + 13;
  return { id, kind: 'stone', date: createdAt.slice(0, 10), createdAt, text: `stone ${id}`, seed, place: nextPlacement(existing, seed) };
}

function entry(id: string, updatedAt: string, text = 'words'): JournalEntry {
  return { id, kind: 'journal', date: updatedAt.slice(0, 10), createdAt: updatedAt, updatedAt, text };
}

const sample = (): KeptContents => ({
  marks: [
    { date: '2026-10-01', ritual: 'stone', keptId: 'a' },
    { date: '2026-10-02', ritual: 'ocean' },
    { date: '2026-10-02', ritual: 'ocean' },
  ],
  kept: [stone('a', '2026-10-01T10:00:00.000Z'), entry('j1', '2026-10-03T09:00:00.000Z')],
});

describe('the downloaded file', () => {
  it('is readable, and comes back exactly', () => {
    const md = toMarkdown(sample(), new Date('2026-10-11T12:00:00Z'));
    expect(md).toContain('## Journal');
    expect(md).toContain('\nwords\n');
    expect(md).toContain('\nstone a\n');
    expect(md).toContain('ocean, ocean');
    expect(isUtsuroiExport(md)).toBe(true);
    const back = fromMarkdown(md);
    expect(back.kept.sort((x, y) => x.id.localeCompare(y.id))).toEqual(sample().kept.sort((x, y) => x.id.localeCompare(y.id)));
    expect(back.marks).toEqual(sample().marks);
  });

  it('keeps any words intact, headings and comment-like text included', () => {
    const tricky = [
      '## Stones',
      '<!-- utsuroi:end j1 -->',
      '<!-- utsuroi:entry {"id":"zz"} -->',
      'a -- b --> c',
      '',
      '  indented, with trailing space  ',
      '',
    ].join('\n');
    const contents: KeptContents = { marks: [], kept: [entry('j-tricky-0001', '2026-10-03T09:00:00.000Z', tricky)] };
    const back = fromMarkdown(toMarkdown(contents));
    expect(back.kept).toEqual(contents.kept);
  });

  it('leaves out anything that was edited into nonsense', () => {
    let md = toMarkdown(sample());
    md = md.replace('"seed":', '"seed":"x","was":');
    const back = fromMarkdown(md);
    expect(back.kept.map((e) => e.id)).toEqual(['j1']);
  });

  it('says plainly when the days list is broken', () => {
    const md = toMarkdown(sample()).replace(/<!-- utsuroi:days \[/, '<!-- utsuroi:days [oops');
    expect(() => fromMarkdown(md)).toThrow(ImportError);
  });
});

describe('any other text file', () => {
  it('becomes a journal entry dated when the file was last changed', () => {
    const e = plainEntry('﻿Dear future me,\r\nhello.\r\n', new Date(2026, 8, 14, 9).getTime());
    expect(e.kind).toBe('journal');
    expect(e.date).toBe('2026-09-14');
    expect(e.text).toBe('Dear future me,\nhello.');
    expect(isUtsuroiExport('Dear future me')).toBe(false);
  });

  it('refuses empty and overlong files', () => {
    expect(() => plainEntry('  \n ', Date.now())).toThrow(ImportError);
    expect(() => plainEntry('x'.repeat(MAX_TEXT + 1), Date.now())).toThrow(ImportError);
  });
});

describe('adding from a file', () => {
  it('adds what is missing, and adding twice adds nothing', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    expect(await restoreKept(sample(), marks, kept)).toEqual({ stones: 1, entries: 1, updated: 0, marks: 3 });
    expect(await restoreKept(sample(), marks, kept)).toEqual({ stones: 0, entries: 0, updated: 0, marks: 0 });
    expect((await marks.all()).length).toBe(3);
  });

  it('keeps the newer copy of a journal entry', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    await kept.put(entry('j1', '2026-10-05T09:00:00.000Z', 'edited here'));
    expect((await restoreKept(sample(), marks, kept)).updated).toBe(0);
    expect((await kept.get('j1'))?.text).toBe('edited here');
    await restoreKept({ marks: [], kept: [entry('j1', '2026-10-09T09:00:00.000Z', 'edited later elsewhere')] }, marks, kept);
    expect((await kept.get('j1'))?.text).toBe('edited later elsewhere');
  });

  it('finds a new place for a stone whose spot is taken, and never moves the one here', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    const here = stone('here', '2026-09-01T10:00:00.000Z');
    await kept.put(here);
    await restoreKept(sample(), marks, kept);
    const stones = await kept.all('stone');
    expect(new Set(stones.map((s) => `${s.place.cairn}:${s.place.level}`)).size).toBe(2);
    expect(await kept.get('here')).toEqual(here);
  });
});
