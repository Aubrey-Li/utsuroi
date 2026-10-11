import { openDb, request } from './db';

/**
 * Ritual marks: the only record the journal keeps of released writing.
 *
 * A mark is a date and the ritual, nothing else. No words, no time of day,
 * no length. Stone entries (when they exist) will link to their kept words
 * through `keptId`.
 */
export type Ritual = 'ocean' | 'wind' | 'fire' | 'stone';
export const RITUALS: readonly Ritual[] = ['ocean', 'wind', 'fire', 'stone'];

export interface RitualMark {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  ritual: Ritual;
  keptId?: string;
}

export interface MarkStore {
  /** False when marks only live until the tab closes (private browsing, storage blocked). */
  readonly persistent: boolean;
  add(mark: RitualMark): Promise<void>;
  /** All marks in a month (month is 0-based, like Date). */
  inMonth(year: number, month: number): Promise<RitualMark[]>;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isRitual(value: unknown): value is Ritual {
  return typeof value === 'string' && (RITUALS as readonly string[]).includes(value);
}

/** Validates anything read back from storage before it's shown. */
export function isRitualMark(value: unknown): value is RitualMark {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.date === 'string' &&
    DATE_RE.test(v.date) &&
    isRitual(v.ritual) &&
    (v.keptId === undefined || (typeof v.keptId === 'string' && v.keptId.length <= 64))
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's (or a given day's) local calendar date as "YYYY-MM-DD". */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthPrefix(year: number, month: number): string {
  return `${year}-${pad(month + 1)}-`;
}

/** Keeps only the fields a mark is allowed to have. */
function clean(mark: RitualMark): RitualMark {
  if (!isRitualMark(mark)) throw new Error('Not a valid ritual mark');
  return mark.keptId ? { date: mark.date, ritual: mark.ritual, keptId: mark.keptId } : { date: mark.date, ritual: mark.ritual };
}

export class MemoryMarkStore implements MarkStore {
  readonly persistent: boolean = false;
  private readonly marks: RitualMark[] = [];

  async add(mark: RitualMark): Promise<void> {
    this.marks.push(clean(mark));
  }

  async inMonth(year: number, month: number): Promise<RitualMark[]> {
    const prefix = monthPrefix(year, month);
    return this.marks.filter((m) => m.date.startsWith(prefix));
  }
}

const STORE = 'marks';

export class IdbMarkStore implements MarkStore {
  readonly persistent: boolean = true;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IdbMarkStore> {
    return new IdbMarkStore(await openDb(factory));
  }

  async add(mark: RitualMark): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).add(clean(mark)));
  }

  async inMonth(year: number, month: number): Promise<RitualMark[]> {
    const prefix = monthPrefix(year, month);
    const range = IDBKeyRange.bound(`${prefix}01`, `${prefix}31`);
    const tx = this.db.transaction(STORE, 'readonly');
    const rows: unknown[] = await request(tx.objectStore(STORE).index('date').getAll(range));
    return rows.filter(isRitualMark);
  }
}

/** Opens on-device storage, falling back to memory where the browser blocks it. */
export async function openMarkStore(): Promise<MarkStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
    const store = await IdbMarkStore.open();
    // Ask the browser not to evict marks under storage pressure. Safari may still clear
    // storage for sites that aren't installed; that's noted in the design doc.
    void navigator.storage?.persist?.().catch(() => false);
    return store;
  } catch {
    return new MemoryMarkStore();
  }
}
