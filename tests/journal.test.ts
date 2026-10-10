import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbMarkStore, MemoryMarkStore, isRitualMark, localDate } from '../src/journal/marks';
import { addMonths, marksByDate, monthGrid, weekdayLabels } from '../src/journal/month';

describe('ritual marks', () => {
  it('formats local dates without time zones getting in the way', () => {
    expect(localDate(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
    expect(localDate(new Date(2026, 0, 31, 0, 1))).toBe('2026-01-31');
  });

  it('accepts only a date and a known ritual', () => {
    expect(isRitualMark({ date: '2026-10-10', ritual: 'ocean' })).toBe(true);
    expect(isRitualMark({ date: '2026-10-10', ritual: 'volcano' })).toBe(false);
    expect(isRitualMark({ date: '2026-13-10', ritual: 'ocean' })).toBe(false);
    expect(isRitualMark({ date: '<b>', ritual: 'ocean' })).toBe(false);
    expect(isRitualMark(null)).toBe(false);
  });

  it('never stores anything but the date and the ritual', async () => {
    const store = new MemoryMarkStore();
    await store.add({ date: '2026-10-10', ritual: 'fire', words: 'secret' } as never);
    const [mark] = await store.inMonth(2026, 9);
    expect(mark).toEqual({ date: '2026-10-10', ritual: 'fire' });
  });

  it('keeps marks in IndexedDB and reads back one month at a time', async () => {
    const store = await IdbMarkStore.open();
    await store.add({ date: '2026-09-30', ritual: 'wind' });
    await store.add({ date: '2026-10-01', ritual: 'ocean' });
    await store.add({ date: '2026-10-31', ritual: 'ocean' });
    await store.add({ date: '2026-11-01', ritual: 'fire' });
    const oct = await store.inMonth(2026, 9);
    expect(oct.map((m) => m.date).sort()).toEqual(['2026-10-01', '2026-10-31']);
    const reopened = await IdbMarkStore.open();
    expect(await reopened.inMonth(2026, 10)).toEqual([{ date: '2026-11-01', ritual: 'fire' }]);
  });

  it('rejects invalid marks instead of writing them', async () => {
    const store = await IdbMarkStore.open();
    await expect(store.add({ date: 'today', ritual: 'ocean' })).rejects.toThrow();
  });
});

describe('month grid', () => {
  it('starts weeks on Monday and fills whole weeks', () => {
    // October 2026 starts on a Thursday.
    const cells = monthGrid(2026, 9, '2026-10-10');
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]!.date).toBe('2026-10-01');
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });

  it('marks today and the days after it', () => {
    const cells = monthGrid(2026, 9, '2026-10-10').filter((c) => c !== null);
    expect(cells.find((c) => c.isToday)!.day).toBe(10);
    expect(cells.filter((c) => c.isFuture)).toHaveLength(21);
  });

  it('handles leap years', () => {
    expect(monthGrid(2028, 1, '2028-02-01').filter(Boolean)).toHaveLength(29);
    expect(monthGrid(2027, 1, '2027-02-01').filter(Boolean)).toHaveLength(28);
  });

  it('groups marks by day in the order they were made', () => {
    const byDate = marksByDate([
      { date: '2026-10-08', ritual: 'fire' },
      { date: '2026-10-08', ritual: 'ocean' },
      { date: '2026-10-09', ritual: 'stone' },
    ]);
    expect(byDate.get('2026-10-08')).toEqual(['fire', 'ocean']);
    expect(byDate.get('2026-10-09')).toEqual(['stone']);
  });

  it('steps across year boundaries', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('labels weekdays starting on Monday', () => {
    expect(weekdayLabels('en-US')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});
