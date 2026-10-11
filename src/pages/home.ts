import { RITUALS, type Ritual } from '../journal/marks';
import { el, journalIcon, ritualIcon, RITUAL_INFO } from './icons';

/** The landing page's controls. */
export interface Home {
  /** Where the calendar of your days goes. */
  days: HTMLElement;
  /** Opens or closes the days panel (on small screens it's a drawer; on large ones it's always there). */
  showDays(open: boolean): void;
}

/** Wide enough for the days to sit beside the rituals instead of in a drawer. */
const SIDE_BY_SIDE = '(min-width: 900px)';

/**
 * The landing page: choose where to write today, with your days beside it.
 */
export function renderHome(root: HTMLElement, choose: (ritual: Ritual) => void, openJournal: () => void): Home {
  const list = el('ul', { class: 'rituals' });
  for (const r of RITUALS) {
    const info = RITUAL_INFO[r];
    const card = el(
      'button',
      { class: `ritual ritual-${r}`, type: 'button', 'data-ritual': r },
      el('span', { class: 'ritual-seal', lang: 'ja', 'aria-hidden': 'true' }, info.seal),
      el('span', { class: 'ritual-name' }, ritualIcon(r, 'ritual-icon'), info.name),
      el('span', { class: 'ritual-line' }, info.line),
      info.ready ? null : el('span', { class: 'ritual-soon' }, 'Coming soon'),
    );
    if (info.ready) card.addEventListener('click', () => choose(r));
    else card.setAttribute('aria-disabled', 'true');
    list.append(el('li', {}, card));
  }

  // Not a ritual: a plain journal for writing you want to keep and reread.
  const journal = el(
    'button',
    { type: 'button', class: 'journal-card' },
    el('span', { class: 'ritual-seal', lang: 'ja', 'aria-hidden': 'true' }, '記'),
    el(
      'span',
      { class: 'journal-card-text' },
      el('span', { class: 'ritual-name' }, journalIcon('ritual-icon'), 'Journal'),
      el('span', { class: 'ritual-line' }, 'Or just write, and keep it. Entries stay on this device, private.'),
    ),
  );
  journal.addEventListener('click', openJournal);

  const dialog = supportDialog();
  const supportBtn = el('button', { class: 'linklike', type: 'button' }, 'Need to talk to someone?');
  supportBtn.addEventListener('click', () => dialog.showModal());

  const brand = () => el('span', { class: 'brand-mark' }, el('span', { class: 'brand-name' }, 'utsuroi'), el('span', { class: 'brand-jp', lang: 'ja' }, '移ろい'));
  const menu = el(
    'button',
    { type: 'button', class: 'days-menu', 'aria-controls': 'home-days', 'aria-expanded': 'false', 'aria-label': 'Your days' },
    menuIcon(),
  );
  const close = el('button', { type: 'button', class: 'days-close', 'aria-label': 'Close' }, '×');
  const days = el('div', { class: 'days-body' });
  const panel = el(
    'aside',
    { class: 'home-days', id: 'home-days', 'aria-labelledby': 'days-title' },
    el('div', { class: 'days-top' }, el('span', { class: 'page-brand days-brand' }, brand()), close),
    days,
  );
  const scrim = el('div', { class: 'days-scrim', 'aria-hidden': 'true' });
  const content = el(
    'div',
    { class: 'home-content' },
    el('header', { class: 'page-brand home-brand' }, menu, brand()),
    el(
      'main',
      { class: 'home-main' },
      el('h1', { class: 'home-title', tabindex: '-1' }, 'Where will you write today?'),
      el('p', { class: 'home-sub' }, 'Write what you need to let go of, and let a place take it. Or carve it in stone to keep.'),
      list,
      journal,
    ),
    el('nav', { class: 'home-links', 'aria-label': 'More' }, supportBtn),
  );

  root.replaceChildren(
    el('div', { class: 'painted', 'aria-hidden': 'true' }, el('div', { class: 'sky' }, el('div', { class: 'sun' })), el('div', { class: 'swell' })),
    panel,
    scrim,
    content,
    dialog,
  );

  const wide = window.matchMedia(SIDE_BY_SIDE);
  const showDays = (open: boolean) => {
    const drawer = open && !wide.matches;
    root.classList.toggle('days-open', drawer);
    menu.setAttribute('aria-expanded', String(drawer));
    // While the drawer covers the page, only the drawer can be used.
    content.inert = drawer;
    if (open) panel.querySelector<HTMLElement>('.cal-title')?.focus({ preventScroll: true });
    else if (document.activeElement && panel.contains(document.activeElement)) menu.focus();
    // Closing the drawer that #/calendar opened leaves you on the landing page.
    if (!open && location.hash === '#/calendar') history.replaceState(null, '', '#/');
  };
  menu.addEventListener('click', () => showDays(true));
  close.addEventListener('click', () => showDays(false));
  scrim.addEventListener('click', () => showDays(false));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('days-open')) showDays(false);
  });
  // Opening a day (a stone, a journal entry) leaves the drawer closed for when you come back.
  panel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) {
      root.classList.remove('days-open');
      content.inert = false;
      menu.setAttribute('aria-expanded', 'false');
    }
  });
  wide.addEventListener('change', () => {
    if (wide.matches) {
      root.classList.remove('days-open');
      content.inert = false;
      menu.setAttribute('aria-expanded', 'false');
    }
  });
  return { days, showDays };
}

/** Three lines, for the days menu. */
function menuIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M4 7h16', 'M4 12h16', 'M4 17h16']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Always reachable, never triggered by anything written. */
function supportDialog(): HTMLDialogElement {
  const close = el('button', { type: 'button', class: 'dialog-close' }, 'Close');
  const dialog = el(
    'dialog',
    { class: 'support', 'aria-labelledby': 'support-title' },
    el('h2', { id: 'support-title' }, 'You don’t have to carry it alone'),
    el('p', {}, 'If you’re struggling or thinking about ending your life, please reach out to someone now.'),
    el(
      'ul',
      {},
      el('li', {}, el('strong', {}, 'In the US: '), 'call or text 988 (Suicide & Crisis Lifeline).'),
      el(
        'li',
        {},
        el('strong', {}, 'Anywhere else: '),
        'find a free, confidential line near you at ',
        el('a', { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer' }, 'findahelpline.com'),
        '.',
      ),
      el('li', {}, el('strong', {}, 'In an emergency: '), 'call your local emergency number.'),
    ),
    close,
  );
  close.addEventListener('click', () => dialog.close());
  return dialog;
}
