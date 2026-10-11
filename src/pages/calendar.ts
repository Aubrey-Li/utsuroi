import { localDate, type MarkStore, type Ritual } from '../journal/marks';
import { activeMonths, marksByDate, monthGrid, monthLabel, weekdayLabels } from '../journal/month';
import type { KeptStore } from '../journal/kept';
import { el, journalIcon, ritualIcon, RITUAL_INFO } from './icons';

/** How long the pointer can wander between a day and its note before it closes. */
const HOVER_GRACE = 220;

interface DayActivity {
  /** Released rituals, in the order they happened. */
  released: Ritual[];
  stones: number;
  journal: boolean;
}

/**
 * Your days: a quiet calendar of every month you've written in. A day with
 * anything in it is softly marked; hover or tap it to see what happened.
 * Released words are never kept, so those days show only which place took
 * them. Stone and journal days open.
 */
export class CalendarPage {
  private readonly months: HTMLElement;
  private readonly week: HTMLElement;
  private readonly note: HTMLElement;
  private readonly pop: HTMLElement;
  private activity = new Map<string, DayActivity>();
  /** The day whose note is showing, and whether a click pinned it open. */
  private openDay: HTMLElement | null = null;
  private pinned = false;
  private closeTimer = 0;
  private readonly canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  constructor(
    root: HTMLElement,
    private readonly store: MarkStore,
    private readonly kept: KeptStore,
  ) {
    this.week = el('div', { class: 'cal-week', 'aria-hidden': 'true' });
    for (const label of weekdayLabels()) this.week.append(el('span', {}, label));
    this.months = el('div', { class: 'cal-months' });
    this.note = el('p', { class: 'cal-note' });
    this.pop = el('div', { class: 'cal-pop', id: 'cal-pop', role: 'dialog', 'aria-modal': 'false', hidden: '' });
    this.months.append(this.pop);

    root.replaceChildren(el('h2', { class: 'cal-title', id: 'days-title', tabindex: '-1' }, 'Your days'), this.week, this.months);

    this.pop.addEventListener('mouseenter', () => window.clearTimeout(this.closeTimer));
    this.pop.addEventListener('mouseleave', () => this.closeSoon());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openDay) {
        e.stopPropagation();
        const day = this.openDay;
        this.close();
        day.focus();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.openDay && !this.pop.contains(t) && !this.openDay.contains(t)) this.close();
    });
    this.months.addEventListener('scroll', () => this.pinned || this.close(), { passive: true });
  }

  /** Builds the months from what's stored (call when the page opens). */
  async show(): Promise<void> {
    const today = localDate();
    const [marks, stoneDays, journalDays] = await Promise.all([this.store.all(), this.kept.dates('stone'), this.kept.dates('journal')]);
    const byDate = marksByDate(marks);
    const stonesOn = new Map<string, number>();
    for (const m of marks) if (m.ritual === 'stone') stonesOn.set(m.date, (stonesOn.get(m.date) ?? 0) + 1);
    // A stone kept without its mark (shouldn't happen) still opens.
    for (const d of stoneDays) if (!stonesOn.has(d)) stonesOn.set(d, 1);
    const journal = new Set(journalDays);

    this.activity = new Map();
    for (const date of new Set([...byDate.keys(), ...stonesOn.keys(), ...journal])) {
      this.activity.set(date, {
        released: (byDate.get(date) ?? []).filter((r) => r !== 'stone'),
        stones: stonesOn.get(date) ?? 0,
        journal: journal.has(date),
      });
    }

    this.close();
    const blocks = activeMonths(this.activity.keys(), today).map(({ year, month }) => this.monthBlock(year, month, today));
    if (!this.store.persistent) this.note.textContent = 'This browser isn’t saving your days (private browsing or storage turned off), so they’ll be gone when you close the tab.';
    else if (this.activity.size === 0) this.note.textContent = 'When a place takes what you wrote, a mark appears on that day.';
    else this.note.textContent = '';
    this.months.replaceChildren(...blocks, this.note, this.pop);
    // The newest month is at the bottom, like the end of a notebook.
    requestAnimationFrame(() => (this.months.scrollTop = this.months.scrollHeight));
  }

  private monthBlock(year: number, month: number, today: string): HTMLElement {
    const rows: HTMLElement[] = [];
    const cells = monthGrid(year, month, today);
    for (let i = 0; i < cells.length; i += 7) {
      const row = el('div', { class: 'cal-row', role: 'row' });
      for (const cell of cells.slice(i, i + 7)) {
        if (!cell) {
          row.append(el('span', { class: 'cal-day empty', role: 'gridcell' }));
          continue;
        }
        const what = this.activity.get(cell.date);
        const label = new Date(year, month, cell.day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        const cls = `cal-day${cell.isToday ? ' today' : ''}${cell.isFuture ? ' future' : ''}`;
        if (!what) {
          const day = el('span', { class: cls, role: 'gridcell', 'aria-label': label }, String(cell.day));
          if (cell.isToday) day.setAttribute('aria-current', 'date');
          row.append(day);
          continue;
        }
        const day = el(
          'button',
          { type: 'button', class: `${cls} active`, 'aria-label': `${label}: ${describe(what)}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'cal-pop' },
          String(cell.day),
        );
        if (cell.isToday) day.setAttribute('aria-current', 'date');
        day.addEventListener('click', (e) => {
          if (this.openDay === day && this.pinned) return this.close();
          this.open(day, cell.date, label, true);
          // From the keyboard, step into the note so its links can be reached.
          if (e.detail === 0) this.pop.querySelector<HTMLElement>('a')?.focus();
        });
        day.addEventListener('mouseenter', () => {
          if (!this.canHover.matches || (this.pinned && this.openDay !== day)) return;
          window.clearTimeout(this.closeTimer);
          if (this.openDay !== day) this.open(day, cell.date, label, false);
        });
        day.addEventListener('mouseleave', () => this.closeSoon());
        row.append(el('span', { role: 'gridcell' }, day));
      }
      rows.push(row);
    }
    return el(
      'section',
      { class: 'cal-block', 'aria-label': monthLabel(year, month) },
      el('h3', { class: 'cal-month' }, monthLabel(year, month)),
      el('div', { class: 'cal-grid', role: 'grid' }, ...rows),
    );
  }

  /** Shows what happened on a day, just under it. */
  private open(day: HTMLElement, date: string, label: string, pin: boolean): void {
    const what = this.activity.get(date);
    if (!what) return;
    window.clearTimeout(this.closeTimer);
    this.openDay?.setAttribute('aria-expanded', 'false');
    this.openDay = day;
    this.pinned = pin;
    day.setAttribute('aria-expanded', 'true');

    const items: HTMLElement[] = [];
    const counts = new Map<Ritual, number>();
    for (const r of what.released) counts.set(r, (counts.get(r) ?? 0) + 1);
    for (const [r, n] of counts) {
      items.push(el('li', { class: 'cal-pop-item' }, ritualIcon(r), el('span', {}, RITUAL_INFO[r].name), n > 1 ? el('span', { class: 'cal-pop-count' }, `×${n}`) : null));
    }
    if (what.stones > 0) {
      items.push(
        el(
          'li',
          {},
          el('a', { class: 'cal-pop-item cal-pop-open', href: `#/stone/visit/${date}` }, ritualIcon('stone'), el('span', {}, what.stones === 1 ? 'Stone' : `${what.stones} stones`), el('span', { class: 'cal-pop-go' }, 'Open')),
        ),
      );
    }
    if (what.journal) {
      items.push(el('li', {}, el('a', { class: 'cal-pop-item cal-pop-open', href: `#/journal/${date}` }, journalIcon(), el('span', {}, 'Journal'), el('span', { class: 'cal-pop-go' }, 'Open'))));
    }
    this.pop.setAttribute('aria-label', label);
    this.pop.replaceChildren(el('p', { class: 'cal-pop-date' }, label), el('ul', {}, ...items));
    this.pop.hidden = false;

    // Under the day, kept inside the panel.
    const box = this.months.getBoundingClientRect();
    const at = day.getBoundingClientRect();
    const width = this.pop.offsetWidth;
    const left = Math.max(4, Math.min(at.left - box.left + at.width / 2 - width / 2, this.months.clientWidth - width - 4));
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${at.bottom - box.top + this.months.scrollTop + 6}px`;
    // Keep it in view if the day is near the bottom.
    const overflow = at.bottom + 6 + this.pop.offsetHeight - box.bottom;
    if (pin && overflow > 0) this.months.scrollBy({ top: overflow + 8, behavior: 'smooth' });
  }

  private closeSoon(): void {
    if (this.pinned) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => this.close(), HOVER_GRACE);
  }

  private close(): void {
    window.clearTimeout(this.closeTimer);
    this.openDay?.setAttribute('aria-expanded', 'false');
    this.openDay = null;
    this.pinned = false;
    this.pop.hidden = true;
  }
}

/** A day's activity in words, for screen readers. */
function describe(what: DayActivity): string {
  const parts = [...new Set(what.released)].map((r) => RITUAL_INFO[r].name.toLowerCase());
  if (what.stones) parts.push(what.stones === 1 ? 'a stone' : `${what.stones} stones`);
  if (what.journal) parts.push('a journal entry');
  return parts.join(', ');
}
