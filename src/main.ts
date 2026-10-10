import './style.css';
import './pages/pages.css';
import { isRitual, localDate, openMarkStore, type Ritual } from './journal/marks';
import { OceanScene } from './ocean/ocean';
import { CalendarPage } from './pages/calendar';
import { renderHome } from './pages/home';

type Page = 'home' | 'ocean' | 'calendar';

const TITLES: Record<Page, string> = {
  home: 'Utsuroi',
  ocean: 'Ocean · Utsuroi',
  calendar: 'Your days · Utsuroi',
};

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

/** Hash routes (#/, #/ocean, #/calendar) so static hosting needs no server rules. */
function pageFromHash(): Page {
  const path = location.hash.replace(/^#/, '') || '/';
  if (path === '/ocean') return 'ocean';
  if (path === '/calendar') return 'calendar';
  return 'home';
}

function go(path: string): void {
  location.hash = path;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const store = await openMarkStore();
  const sections: Record<Page, HTMLElement> = { home: $('home'), ocean: $('ocean'), calendar: $('calendar') };

  renderHome(sections.home, (ritual: Ritual) => go(`/${ritual}`));
  const calendar = new CalendarPage(sections.calendar, store);
  const ocean = new OceanScene(
    sections.ocean,
    {
      // The ritual is complete when the sea has taken everything: leave its mark on today.
      released: () => void store.add({ date: localDate(), ritual: 'ocean' }),
      leave: () => go('/'),
    },
    params,
  );

  let current: Page | null = null;
  const route = async () => {
    const page = pageFromHash();
    if (page === current) return;
    if (current === 'ocean') ocean.exit();
    for (const [name, section] of Object.entries(sections)) section.hidden = name !== page;
    current = page;
    document.title = TITLES[page];
    if (page === 'ocean') await ocean.enter();
    if (page === 'calendar') await calendar.show();
    sections[page].querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  };
  window.addEventListener('hashchange', () => void route());
  await route();

  if (params.has('tune')) {
    const { createTuner } = await import('./tune');
    createTuner(ocean.sand, ocean.tideParams);
  }

  // Hooks for automated checks. Adding marks by hand is only possible in development.
  (window as unknown as { __utsuroi?: object }).__utsuroi = {
    get page() {
      return current;
    },
    get ocean() {
      return ocean.debugState();
    },
    ...(import.meta.env.DEV
      ? {
          async addMark(date: string, ritual: string) {
            if (!isRitual(ritual)) throw new Error('Unknown ritual');
            await store.add({ date, ritual });
          },
        }
      : {}),
  };
}

void boot();
