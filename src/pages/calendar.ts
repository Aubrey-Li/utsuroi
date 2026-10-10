import { localDate, RITUALS, type MarkStore } from '../journal/marks';
import { addMonths, marksByDate, monthGrid, monthLabel, weekdayLabels } from '../journal/month';
import { el, ritualIcon, RITUAL_INFO } from './icons';

/** At most this many icons show on a day; the rest become a count. */
const MAX_ICONS = 3;

/**
 * The calendar: each ritual leaves a small mark on its day, and nothing
 * else. Only days with a stone can be opened (none exist yet).
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
    private readonly root: HTMLElement,
    private readonly store: MarkStore,
  ) {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();

    this.title = el('h2', { class: 'cal-month', 'aria-live': 'polite' });
    this.prev = el('button', { type: 'button', class: 'cal-step', 'aria-label': 'Previous month' }, '‹');
    this.next = el('button', { type: 'button', class: 'cal-step', 'aria-label': 'Next month' }, '›');
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.grid = el('div', { class: 'cal-grid', role: 'grid', 'aria-labelledby': 'cal-month' });
    this.title.id = 'cal-month';
    this.note = el('p', { class: 'cal-note' });

    const legend = el('ul', { class: 'cal-legend', 'aria-label': 'What the marks mean' });
    for (const r of RITUALS) legend.append(el('li', {}, ritualIcon(r), RITUAL_INFO[r].name));

    root.replaceChildren(
      el('div', { class: 'painted calm', 'aria-hidden': 'true' }, el('div', { class: 'sky' }, el('div', { class: 'sun' })), el('div', { class: 'swell' })),
      el(
        'header',
        { class: 'page-brand' },
        el('a', { href: '#/', class: 'back' }, '← Back'),
        el('span', { class: 'brand-name' }, 'utsuroi'),
        el('span', { class: 'brand-jp', lang: 'ja' }, '移ろい'),
      ),
      el(
        'main',
        { class: 'cal-panel' },
        el('h1', { class: 'cal-title', tabindex: '-1' }, 'Your days'),
        el('p', { class: 'cal-sub' }, 'Each ritual leaves a mark on the day it happened. The words themselves are never kept.'),
        el('div', { class: 'cal-head' }, this.prev, this.title, this.next),
        this.grid,
        this.note,
        legend,
      ),
    );
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) this.step(-1);
      if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) this.step(1);
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
        const icons = el('span', { class: 'cal-marks' });
        for (const r of rituals.slice(0, MAX_ICONS)) icons.append(ritualIcon(r));
        if (rituals.length > MAX_ICONS) icons.append(el('span', { class: 'cal-more' }, `+${rituals.length - MAX_ICONS}`));
        const names = rituals.map((r) => RITUAL_INFO[r].name.toLowerCase());
        const label = new Date(this.year, this.month, cell.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
        const day = el(
          'span',
          {
            class: `cal-day${cell.isToday ? ' today' : ''}${cell.isFuture ? ' future' : ''}${rituals.includes('stone') ? ' kept' : ''}`,
            role: 'gridcell',
            'aria-label': rituals.length ? `${label}: ${names.join(', ')}` : label,
          },
          el('span', { class: 'cal-num' }, String(cell.day)),
          icons,
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
      this.note.textContent = 'Nothing here yet this month. When the sea takes what you wrote, its mark appears on that day.';
    } else {
      this.note.textContent = '';
    }
  }
}
