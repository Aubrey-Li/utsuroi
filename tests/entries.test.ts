import { describe, expect, it } from 'vitest';
import { groupByMonth, newJournalEntry, previewOf, wordCount } from '../src/journal/entries';

describe('journal entries', () => {
  it('previews the first line with words in it', () => {
    expect(previewOf('\n\n  Dear diary,\nToday was long')).toBe('Dear diary,');
    expect(previewOf('')).toBe('');
    expect(previewOf('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
  });

  it('starts a new entry dated today, empty', () => {
    const e = newJournalEntry(new Date(2026, 9, 11, 9, 30));
    expect(e.date).toBe('2026-10-11');
    expect(e.text).toBe('');
    expect(e.kind).toBe('journal');
  });

  it('groups entries by month, newest first', () => {
    const mk = (date: string, createdAt: string) => ({ ...newJournalEntry(), date, createdAt });
    const groups = groupByMonth([mk('2026-09-30', '2026-09-30T10:00:00Z'), mk('2026-10-11', '2026-10-11T08:00:00Z'), mk('2026-10-02', '2026-10-02T08:00:00Z')], 'en-US');
    expect(groups.map((g) => g.label)).toEqual(['October 2026', 'September 2026']);
    expect(groups[0]!.entries.map((e) => e.date)).toEqual(['2026-10-11', '2026-10-02']);
  });

  it('counts words', () => {
    expect(wordCount('  one two\nthree ')).toBe(3);
    expect(wordCount('   ')).toBe(0);
  });
});
