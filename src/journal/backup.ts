import { nextPlacement } from '../stone/cairn';
import { isKeptEntry, type KeptEntry, type KeptStore, type StoneEntry } from './kept';
import { isRitualMark, type MarkStore, type RitualMark } from './marks';

/**
 * A backup file: everything that's kept (stones, journal entries, and the
 * marks on your days) in one file, locked with a passphrase. Released words
 * are never in it, because they were never stored.
 *
 * The passphrase is stretched with PBKDF2-SHA-256 (WebCrypto has no Argon2)
 * into an AES-256-GCM key. Salt and IV are random per file. The header is
 * bound to the ciphertext as additional data, so it can't be swapped.
 */

export const BACKUP_FORMAT = 'utsuroi-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = '.utsuroi';
/** OWASP's current guidance for PBKDF2-HMAC-SHA-256. */
const ITERATIONS = 600_000;
/** Refuse anything absurd before parsing it. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 200_000;
export const MIN_PASSPHRASE = 8;

export interface BackupContents {
  marks: RitualMark[];
  kept: KeptEntry[];
}

interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

/** Why a backup couldn't be opened, in words for the person restoring it. */
export class BackupError extends Error {
  constructor(
    readonly reason: 'not-a-backup' | 'newer-version' | 'wrong-passphrase' | 'damaged' | 'too-large',
    message: string,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The parts of the header that are authenticated along with the data. */
function headerAad(file: Pick<BackupFile, 'format' | 'version' | 'createdAt' | 'kdf'>): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify([file.format, file.version, file.createdAt, file.kdf.name, file.kdf.hash, file.kdf.iterations, file.kdf.salt]));
}

/** Locks what's kept into a backup file's text. */
export async function createBackup(contents: BackupContents, passphrase: string, options: { iterations?: number; now?: Date } = {}): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`A passphrase needs at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (options.now ?? new Date()).toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: options.iterations ?? ITERATIONS, salt: toBase64(salt) },
  } as const;
  const key = await deriveKey(passphrase, salt, header.kdf.iterations);
  const plain = enc.encode(JSON.stringify({ marks: contents.marks, kept: contents.kept }));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: headerAad(header) }, key, plain));
  const file: BackupFile = { ...header, cipher: { name: 'AES-GCM', iv: toBase64(iv) }, data: toBase64(data) };
  return JSON.stringify(file);
}

const isB64 = (v: unknown, max = MAX_BACKUP_BYTES * 2): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9+/]*={0,2}$/.test(v);

/** Reads the header without the passphrase, so a wrong file is caught early. */
function parseFile(text: string): BackupFile {
  if (text.length > MAX_BACKUP_BYTES * 2) throw new BackupError('too-large', 'This file is too large to be a backup.');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new BackupError('not-a-backup', 'This isn’t an Utsuroi backup file.');
  }
  const f = v as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object' || f.format !== BACKUP_FORMAT) throw new BackupError('not-a-backup', 'This isn’t an Utsuroi backup file.');
  if (typeof f.version !== 'number' || f.version > BACKUP_VERSION) throw new BackupError('newer-version', 'This backup was made by a newer version of Utsuroi. Update the app, then try again.');
  const k = f.kdf;
  const c = f.cipher;
  const ok =
    typeof f.createdAt === 'string' &&
    k?.name === 'PBKDF2' &&
    k.hash === 'SHA-256' &&
    Number.isInteger(k.iterations) &&
    k.iterations >= 1 &&
    k.iterations <= 10_000_000 &&
    isB64(k.salt, 64) &&
    c?.name === 'AES-GCM' &&
    isB64(c.iv, 32) &&
    isB64(f.data);
  if (!ok) throw new BackupError('damaged', 'This backup file is damaged and can’t be read.');
  return f as BackupFile;
}

/** When a backup was made, read from its header (no passphrase needed). */
export function backupDate(text: string): Date {
  return new Date(parseFile(text).createdAt);
}

/** Unlocks a backup file and checks everything in it before it's used. */
export async function openBackup(text: string, passphrase: string): Promise<BackupContents> {
  const file = parseFile(text);
  const key = await deriveKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.cipher.iv), additionalData: headerAad(file) }, key, fromBase64(file.data));
  } catch {
    // GCM can't tell a wrong passphrase from tampering; the first is far more likely.
    throw new BackupError('wrong-passphrase', 'That passphrase doesn’t open this backup.');
  }
  let v: unknown;
  try {
    v = JSON.parse(dec.decode(plain));
  } catch {
    throw new BackupError('damaged', 'This backup file is damaged and can’t be read.');
  }
  const body = v as Partial<BackupContents> | null;
  if (!body || !Array.isArray(body.marks) || !Array.isArray(body.kept) || body.marks.length > MAX_ITEMS || body.kept.length > MAX_ITEMS) {
    throw new BackupError('damaged', 'This backup file is damaged and can’t be read.');
  }
  // Anything that doesn't look right is left out rather than trusted.
  return { marks: body.marks.filter(isRitualMark), kept: body.kept.filter(isKeptEntry) };
}

export interface RestoreSummary {
  stones: number;
  entries: number;
  updated: number;
  marks: number;
}

const markKey = (m: RitualMark) => `${m.date}|${m.ritual}|${m.keptId ?? ''}`;

/**
 * Adds a backup's contents to what's here. Nothing is removed. Stones and
 * entries already here are left alone, except a journal entry the backup
 * has a newer edit of. Restored stones that would land where another stone
 * already sits are set on the cairns in the order they were carved. Marks
 * are counted per day and place, so restoring twice adds nothing.
 */
export async function restoreBackup(contents: BackupContents, marks: MarkStore, kept: KeptStore): Promise<RestoreSummary> {
  const summary: RestoreSummary = { stones: 0, entries: 0, updated: 0, marks: 0 };
  const [stonesHere, journalHere, marksHere] = await Promise.all([kept.all('stone'), kept.all('journal'), marks.all()]);
  const known = new Map<string, KeptEntry>([...stonesHere, ...journalHere].map((e) => [e.id, e]));

  for (const e of contents.kept) {
    if (e.kind !== 'journal') continue;
    const here = known.get(e.id);
    if (!here) {
      await kept.put(e);
      known.set(e.id, e);
      summary.entries++;
    } else if (here.kind === 'journal' && e.updatedAt > here.updatedAt) {
      await kept.put(e);
      summary.updated++;
    }
  }

  const placed: StoneEntry[] = [...stonesHere];
  const taken = new Set(placed.map((s) => `${s.place.cairn}:${s.place.level}`));
  const incoming = contents.kept
    .filter((e): e is StoneEntry => e.kind === 'stone' && !known.has(e.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const s of incoming) {
    let stone = s;
    if (taken.has(`${s.place.cairn}:${s.place.level}`)) {
      const order = [...placed].sort((a, b) => a.place.cairn - b.place.cairn || a.place.level - b.place.level);
      stone = { ...s, place: nextPlacement(order.map((p) => ({ place: p.place, seed: p.seed })), s.seed) };
    }
    await kept.put(stone);
    placed.push(stone);
    taken.add(`${stone.place.cairn}:${stone.place.level}`);
    known.set(stone.id, stone);
    summary.stones++;
  }

  const have = new Map<string, number>();
  for (const m of marksHere) have.set(markKey(m), (have.get(markKey(m)) ?? 0) + 1);
  for (const m of contents.marks) {
    const k = markKey(m);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    await marks.add(m);
    summary.marks++;
  }
  return summary;
}

/** Everything kept on this device, ready to be backed up. */
export async function gatherBackup(marks: MarkStore, kept: KeptStore): Promise<BackupContents> {
  const [m, stones, journal] = await Promise.all([marks.all(), kept.all('stone'), kept.all('journal')]);
  return { marks: m, kept: [...stones, ...journal] };
}

export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `utsuroi-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${BACKUP_EXTENSION}`;
}
