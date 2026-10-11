import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbKeptStore, MemoryKeptStore } from '../src/journal/kept';
import { IdbMarkStore, MemoryMarkStore } from '../src/journal/marks';
import { activeMonths } from '../src/journal/month';
import { MICRO_SEASON_COUNT, microSeason } from '../src/journal/seasons';

describe('microSeason', () => {
  it('has all seventy-two', () => {
    expect(MICRO_SEASON_COUNT).toBe(72);
  });

  it('finds the season a day falls in', () => {
    expect(microSeason(new Date(2026, 9, 11)).kanji).toBe('鴻雁来');
    expect(microSeason(new Date(2026, 9, 8)).kanji).toBe('鴻雁来');
    expect(microSeason(new Date(2026, 9, 7)).kanji).toBe('水始涸');
    expect(microSeason(new Date(2026, 1, 4)).kanji).toBe('東風解凍');
    expect(microSeason(new Date(2026, 1, 3)).kanji).toBe('鶏始乳');
  });

  it('carries the last season of the year into early January', () => {
    expect(microSeason(new Date(2026, 11, 31)).kanji).toBe('雪下出麦');
    expect(microSeason(new Date(2027, 0, 2)).kanji).toBe('雪下出麦');
    expect(microSeason(new Date(2027, 0, 5)).kanji).toBe('芹乃栄');
  });
});

describe('activeMonths', () => {
  it('lists months with something in them, and this month, oldest first', () => {
    expect(activeMonths(['2026-10-02', '2025-11-30', '2026-06-23', '2026-06-01'], '2026-10-11')).toEqual([
      { year: 2025, month: 10 },
      { year: 2026, month: 5 },
      { year: 2026, month: 9 },
    ]);
  });

  it('always shows the current month', () => {
    expect(activeMonths([], '2026-10-11')).toEqual([{ year: 2026, month: 9 }]);
  });
});

describe('reading every day', () => {
  for (const [name, open] of [
    ['memory', async () => ({ marks: new MemoryMarkStore(), kept: new MemoryKeptStore() })],
    ['indexeddb', async () => ({ marks: await IdbMarkStore.open(new IDBFactory()), kept: await IdbKeptStore.open(new IDBFactory()) })],
  ] as const) {
    it(`${name}: all marks and kept dates, oldest first`, async () => {
      const { marks, kept } = await open();
      await marks.add({ date: '2026-10-09', ritual: 'fire' });
      await marks.add({ date: '2026-06-23', ritual: 'ocean' });
      expect((await marks.all()).map((m) => m.date)).toEqual(['2026-06-23', '2026-10-09']);
      const at = new Date().toISOString();
      await kept.put({ id: 'a', kind: 'journal', date: '2026-10-02', createdAt: at, updatedAt: at, text: 'hi' });
      await kept.put({ id: 'b', kind: 'journal', date: '2026-07-01', createdAt: at, updatedAt: at, text: 'again' });
      await kept.put({ id: 'c', kind: 'journal', date: '2026-10-02', createdAt: at, updatedAt: at, text: 'twice' });
      expect(await kept.dates('journal')).toEqual(['2026-07-01', '2026-10-02']);
      expect(await kept.dates('stone')).toEqual([]);
    });
  }
});
