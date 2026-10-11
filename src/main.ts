import './style.css';
import './pages/pages.css';
import { AudioEngine } from './audio/engine';
import { openKeptStore } from './journal/kept';
import { isRitual, localDate, openMarkStore, type Ritual } from './journal/marks';
import { FireScene } from './fire/fire';
import { OceanScene } from './ocean/ocean';
import { CalendarPage } from './pages/calendar';
import { JournalPage } from './pages/journal';
import { renderHome } from './pages/home';
import { StoneScene } from './stone/stone';
import { WindScene } from './wind/wind';

type Page = 'home' | 'ocean' | 'wind' | 'fire' | 'stone' | 'calendar' | 'journal';

const TITLES: Record<Page, string> = {
  home: 'Utsuroi',
  ocean: 'Ocean · Utsuroi',
  wind: 'Wind · Utsuroi',
  fire: 'Fire · Utsuroi',
  stone: 'Stone · Utsuroi',
  calendar: 'Your days · Utsuroi',
  journal: 'Journal · Utsuroi',
};

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

/** Hash routes (#/, #/ocean, #/stone/visit/2026-10-11, ...) so static hosting needs no server rules. */
function route(): { page: Page; visit?: string; day?: string } {
  const path = location.hash.replace(/^#/, '') || '/';
  const visit = path.match(/^\/stone\/visit\/(\d{4}-\d{2}-\d{2})$/);
  if (visit) return { page: 'stone', visit: visit[1] };
  const day = path.match(/^\/journal\/(\d{4}-\d{2}-\d{2})$/);
  if (day) return { page: 'journal', day: day[1] };
  if (path === '/journal') return { page: 'journal' };
  if (path === '/ocean') return { page: 'ocean' };
  if (path === '/wind') return { page: 'wind' };
  if (path === '/fire') return { page: 'fire' };
  if (path === '/stone') return { page: 'stone' };
  if (path === '/calendar') return { page: 'calendar' };
  return { page: 'home' };
}

function go(path: string): void {
  location.hash = path;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  AudioEngine.shared();
  const store = await openMarkStore();
  const keptStore = await openKeptStore();
  const sections: Record<Page, HTMLElement> = {
    home: $('home'),
    ocean: $('ocean'),
    wind: $('wind'),
    fire: $('fire'),
    stone: $('stone'),
    calendar: $('calendar'),
    journal: $('journal'),
  };

  renderHome(
    sections.home,
    (ritual: Ritual) => go(`/${ritual}`),
    () => go('/journal'),
  );
  const calendar = new CalendarPage(sections.calendar, store, keptStore);
  const journal = new JournalPage(sections.journal, keptStore);
  const ocean = new OceanScene(
    sections.ocean,
    {
      // The ritual is complete when the sea has taken everything: leave its mark on today.
      released: () => void store.add({ date: localDate(), ritual: 'ocean' }),
      leave: () => go('/'),
    },
    params,
  );

  const markToday = (ritual: Ritual) => () => void store.add({ date: localDate(), ritual });
  const wind = new WindScene(sections.wind, { released: markToday('wind'), leave: () => go('/') });
  const fire = new FireScene(sections.fire, { released: markToday('fire'), leave: () => go('/') });
  const stone = new StoneScene(
    sections.stone,
    {
      // A stone is kept the moment it's set on the cairn: its words, and its mark on the day.
      keep: async (entry) => {
        await keptStore.put(entry);
        await store.add({ date: entry.date, ritual: 'stone', keptId: entry.id });
      },
      released: () => {},
      leave: () => go('/'),
      doneVisiting: () => go('/calendar'),
    },
    keptStore,
  );

  let current: Page | null = null;
  let currentKey = '';
  const show = async () => {
    const { page, visit, day } = route();
    const key = `${page}:${visit ?? day ?? ''}`;
    if (key === currentKey) return;
    currentKey = key;
    if (current === 'ocean') ocean.exit();
    if (current === 'wind') wind.exit();
    if (current === 'fire') fire.exit();
    if (current === 'stone') stone.exit();
    if (current === 'journal') await journal.hide();
    for (const [name, section] of Object.entries(sections)) section.hidden = name !== page;
    current = page;
    document.title = TITLES[page];
    if (page === 'ocean') await ocean.enter();
    if (page === 'wind') await wind.enter();
    if (page === 'fire') await fire.enter();
    if (page === 'stone') await stone.enter(visit);
    if (page === 'calendar') await calendar.show();
    if (page === 'journal') await journal.show(day);
    if (page === 'home' || page === 'calendar' || (page === 'journal' && !day)) sections[page].querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  };
  window.addEventListener('hashchange', () => void show());
  await show();

  if (params.has('tune')) {
    const { createTuner } = await import('./tune');
    createTuner(ocean.sand, ocean.tideParams);
  }

  // Hooks for automated checks. Adding marks by hand is only possible in development.
  (window as unknown as { __utsuroi?: object }).__utsuroi = {
    get page() {
      return current;
    },
    get audio() {
      const engine = AudioEngine.shared();
      return { state: engine.ctx?.state ?? 'none', enabled: engine.enabled };
    },
    get ocean() {
      return ocean.debugState();
    },
    get wind() {
      return wind.debugState();
    },
    get fire() {
      return fire.debugState();
    },
    get stone() {
      return stone.debugState();
    },
    get journal() {
      return journal.debugState();
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
