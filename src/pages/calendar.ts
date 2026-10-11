import { localDate, RITUALS, type MarkStore } from '../journal/marks';
import { addMonths, marksByDate, monthGrid, monthLabel, weekdayLabels } from '../journal/month';
import type { KeptStore } from '../journal/kept';
import { el, journalIcon, ritualIcon, RITUAL_INFO } from './icons';

/** At most this many icons show on a day; the rest become a count. */
const MAX_ICONS = 3;

/**
 * Your days: each ritual leaves a small mark on its day, and nothing
 * else. Days with a stone or a journal entry can be opened. Lives in the
 * landing page's side panel.
 */
export class CalendarPage {
  private year: number;
  private month: number;
  private readonly title: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly note: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly store: MarkStore,
    private readonly kept: KeptStore,
  ) {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();

    this.title = el('h3', { class: 'cal-month', 'aria-live': 'polite' });
    this.prev = el('button', { type: 'button', class: 'cal-step', 'aria-label': 'Previous month' }, '‹');
    this.next = el('button', { type: 'button', class: 'cal-step', 'aria-label': 'Next month' }, '›');
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.grid = el('div', { class: 'cal-grid', role: 'grid', 'aria-labelledby': 'cal-month' });
    this.title.id = 'cal-month';
    this.note = el('p', { class: 'cal-note' });

    const legend = el('ul', { class: 'cal-legend', 'aria-label': 'What the marks mean' });
    for (const r of RITUALS) legend.append(el('li', {}, ritualIcon(r), RITUAL_INFO[r].name));
    legend.append(el('li', {}, journalIcon(), 'Journal'));

    root.replaceChildren(
      el('h2', { class: 'cal-title', id: 'days-title', tabindex: '-1' }, 'Your days'),
      el('p', { class: 'cal-sub' }, 'Each ritual leaves a mark on its day. Released words are never kept; stones and journal entries open.'),
      el('div', { class: 'cal-head' }, this.prev, this.title, this.next),
      this.grid,
      this.note,
      legend,
    );
    // Arrow keys turn the months while you're in the calendar.
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') void this.step(-1);
      if (e.key === 'ArrowRight') void this.step(1);
    });
  }

  /** Shows the current month (call when the page opens). */
  async show(): Promise<void> {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    await this.render();
  }

  private async step(delta: number): Promise<void> {
    const today = new Date();
    const target = addMonths(this.year, this.month, delta);
    // Nothing to see in the future.
    if (target.year * 12 + target.month > today.getFullYear() * 12 + today.getMonth()) return;
    this.year = target.year;
    this.month = target.month;
    await this.render();
  }

  private async render(): Promise<void> {
    const today = localDate();
    const now = new Date();
    this.title.textContent = monthLabel(this.year, this.month);
    this.next.disabled = this.year === now.getFullYear() && this.month === now.getMonth();

    const marks = await this.store.inMonth(this.year, this.month);
    const byDate = marksByDate(marks);
    const journalDays = new Set(await this.kept.datesInMonth('journal', this.year, this.month));
    const rows: HTMLElement[] = [];
    const header = el('div', { class: 'cal-row', role: 'row' });
    for (const label of weekdayLabels()) header.append(el('span', { class: 'cal-dow', role: 'columnheader' }, label));
    rows.push(header);

    const cells = monthGrid(this.year, this.month, today);
    for (let i = 0; i < cells.length; i += 7) {
      const row = el('div', { class: 'cal-row', role: 'row' });
      for (const cell of cells.slice(i, i + 7)) {
        if (!cell) {
          row.append(el('span', { class: 'cal-day empty', role: 'gridcell' }));
          continue;
        }
        const rituals = byDate.get(cell.date) ?? [];
        const label = new Date(this.year, this.month, cell.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
        const released = rituals.filter((r) => r !== 'stone');
        const stones = rituals.filter((r) => r === 'stone').length;
        const wrote = journalDays.has(cell.date);
        const icons = el('span', { class: 'cal-marks' });
        // Released rituals are only marks; kept writing opens.
        for (const r of released.slice(0, MAX_ICONS)) icons.append(ritualIcon(r));
        if (released.length > MAX_ICONS) icons.append(el('span', { class: 'cal-more' }, `+${released.length - MAX_ICONS}`));
        const opens = el('span', { class: 'cal-opens' });
        if (stones > 0) {
          opens.append(
            el('a', { href: `#/stone/visit/${cell.date}`, class: 'cal-open', 'aria-label': `${label}: open ${stones === 1 ? 'the stone' : `the ${stones} stones`}` }, ritualIcon('stone')),
          );
        }
        if (wrote) opens.append(el('a', { href: `#/journal/${cell.date}`, class: 'cal-open', 'aria-label': `${label}: open the journal` }, journalIcon()));
        const names = released.map((r) => RITUAL_INFO[r].name.toLowerCase());
        const day = el(
          'span',
          {
            class: `cal-day${cell.isToday ? ' today' : ''}${cell.isFuture ? ' future' : ''}${stones || wrote ? ' kept' : ''}`,
            role: 'gridcell',
            'aria-label': names.length ? `${label}: ${names.join(', ')}` : label,
          },
          el('span', { class: 'cal-num' }, String(cell.day)),
          icons,
          opens,
        );
        if (cell.isToday) day.setAttribute('aria-current', 'date');
        row.append(day);
      }
      rows.push(row);
    }
    this.grid.replaceChildren(...rows);

    if (!this.store.persistent) {
      this.note.textContent = 'This browser isn’t saving your days (private browsing or storage turned off), so they’ll be gone when you close the tab.';
    } else if (marks.length === 0) {
      this.note.textContent = journalDays.size ? '' : 'Nothing here yet this month. When a place takes what you wrote, its mark appears on that day.';
    } else {
      this.note.textContent = '';
    }
  }
}
