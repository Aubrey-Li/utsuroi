import { RITUALS, type Ritual } from '../journal/marks';
import { el, ritualIcon, RITUAL_INFO } from './icons';

/**
 * The landing page: choose where to write today.
 * Only the ocean is ready; the other rituals are shown as coming.
 */
export function renderHome(root: HTMLElement, choose: (ritual: Ritual) => void): void {
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

  const dialog = supportDialog();
  const supportBtn = el('button', { class: 'linklike', type: 'button' }, 'Need to talk to someone?');
  supportBtn.addEventListener('click', () => dialog.showModal());

  root.replaceChildren(
    el('div', { class: 'painted', 'aria-hidden': 'true' }, el('div', { class: 'sky' }, el('div', { class: 'sun' })), el('div', { class: 'swell' })),
    el(
      'header',
      { class: 'page-brand' },
      el('span', { class: 'brand-name' }, 'utsuroi'),
      el('span', { class: 'brand-jp', lang: 'ja' }, '移ろい'),
    ),
    el(
      'main',
      { class: 'home-main' },
      el('h1', { class: 'home-title', tabindex: '-1' }, 'Where will you write today?'),
      el('p', { class: 'home-sub' }, 'Write what you need to let go of, and let a place take it. Or carve it in stone to keep.'),
      list,
    ),
    el('nav', { class: 'home-links', 'aria-label': 'More' }, el('a', { href: '#/calendar' }, 'Your days'), supportBtn),
    dialog,
  );
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
