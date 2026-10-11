import type { Ritual, RitualMark } from './marks';
import { localDate } from './marks';

export interface DayCell {
  date: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * The days of a month laid out in weeks, Monday first. Blank cells before
 * the first and after the last day are null, so every row has seven cells.
 */
export function monthGrid(year: number, month: number, today: string, weekStartsOn = 1): (DayCell | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (DayCell | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    const date = localDate(new Date(year, month, d));
    cells.push({ date, day: d, isToday: date === today, isFuture: date > today });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Marks grouped by date, in the order they were made. */
export function marksByDate(marks: readonly RitualMark[]): Map<string, Ritual[]> {
  const out = new Map<string, Ritual[]>();
  for (const m of marks) {
    const list = out.get(m.date);
    if (list) list.push(m.ritual);
    else out.set(m.date, [m.ritual]);
  }
  return out;
}

export function weekdayLabels(locale?: string, weekStartsOn = 1): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + ((i + weekStartsOn - 1 + 7) % 7))));
}

export function monthLabel(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

/** Steps a (year, month) pair by some number of months. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * The months worth showing: every month with something in it, and the
 * current month, oldest first.
 */
export function activeMonths(dates: Iterable<string>, today: string): { year: number; month: number }[] {
  const keys = new Set<string>([today.slice(0, 7)]);
  for (const d of dates) if (d <= today) keys.add(d.slice(0, 7));
  return [...keys].sort().map((k) => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) - 1 }));
}
