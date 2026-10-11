import { RITUALS, type Ritual } from '../journal/marks';
import { microSeason } from '../journal/seasons';
import { el, RITUAL_INFO } from './icons';

/** The landing page's controls. */
export interface Home {
  /** Where the calendar of your days goes. */
  days: HTMLElement;
  /** The "What's kept" links, which carry a dot when something new isn't backed up. */
  keptLinks: HTMLElement[];
  /** Opens or closes the days panel (on small screens it's a drawer; on large ones it's always there). */
  showDays(open: boolean): void;
}

/** Wide enough for the days to sit beside the rituals instead of in a drawer. */
const SIDE_BY_SIDE = '(min-width: 900px)';

/**
 * The landing page: choose where to write today, with your days beside it.
 */
export function renderHome(root: HTMLElement, choose: (ritual: Ritual) => void, openJournal: () => void, openKept: () => void): Home {
  // The places, as ink characters. A short line about each shows as you point at it.
  const caption = el('p', { class: 'ink-caption', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'rituals', 'aria-label': 'Where to write' });
  const place = (seal: string, name: string, line: string, cls: string, onChoose: () => void) => {
    const btn = el(
      'button',
      { type: 'button', class: `ink ${cls}` },
      el('span', { class: 'ink-seal', lang: 'ja', 'aria-hidden': 'true' }, seal),
      el('span', { class: 'ink-name' }, name),
      el('span', { class: 'visually-hidden' }, `. ${line}`),
    );
    const say = () => (caption.textContent = line);
    btn.addEventListener('mouseenter', say);
    btn.addEventListener('focus', say);
    btn.addEventListener('mouseleave', () => (caption.textContent = ''));
    btn.addEventListener('blur', () => (caption.textContent = ''));
    btn.addEventListener('click', onChoose);
    list.append(el('li', {}, btn));
  };
  for (const r of RITUALS) {
    const info = RITUAL_INFO[r];
    place(info.seal, info.name, info.line, `ritual-${r}`, () => choose(r));
  }
  // Not a ritual: a plain journal for writing you want to keep and reread.
  place('記', 'Journal', 'Or just write, and keep it. Private, on this device.', 'ink-journal', openJournal);

  const season = microSeason();
  const hero = el(
    'div',
    { class: 'hero' },
    el('h1', { class: 'hero-word', lang: 'ja', tabindex: '-1', 'aria-label': 'Utsuroi, 移ろい' }, '移ろい'),
    el(
      'div',
      { class: 'hero-gloss' },
      el('p', { class: 'gloss-word' }, 'utsuroi'),
      el('p', { class: 'gloss' }, 'the quiet passing of things: a color fading, a season turning, a feeling changing.'),
      el(
        'p',
        { class: 'season', title: 'One of the seventy-two seasons of the old Japanese calendar, each about five days long.' },
        el('span', { class: 'season-kanji', lang: 'ja' }, season.kanji),
        el('span', { class: 'season-name' }, season.english.toLowerCase()),
      ),
    ),
  );

  const dialog = supportDialog();
  // Support and what's kept are always in reach: at the foot of the days panel, and at the end of the page on phones.
  const keptLinks: HTMLElement[] = [];
  const footLinks = () => {
    const support = el('button', { class: 'linklike', type: 'button' }, 'Need to talk to someone?');
    support.addEventListener('click', () => dialog.showModal());
    const keptBtn = el('button', { class: 'linklike kept-link', type: 'button' }, 'What’s kept');
    keptBtn.addEventListener('click', openKept);
    keptLinks.push(keptBtn);
    return [support, keptBtn];
  };

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
    el('div', { class: 'days-foot' }, ...footLinks()),
  );
  const scrim = el('div', { class: 'days-scrim', 'aria-hidden': 'true' });
  const content = el(
    'div',
    { class: 'home-content' },
    el('header', { class: 'page-brand home-brand' }, menu, brand()),
    el(
      'main',
      { class: 'home-main' },
      el('div', { class: 'home-sky' }, hero),
      el('p', { class: 'home-invite' }, 'Set it down. Let it change.'),
      list,
      caption,
    ),
    el('nav', { class: 'home-links', 'aria-label': 'More' }, ...footLinks()),
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
  return { days, keptLinks, showDays };
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
