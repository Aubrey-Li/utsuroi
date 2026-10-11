import { describe, expect, it } from 'vitest';
import { BackupError, backupDate, createBackup, openBackup, restoreBackup, type BackupContents } from '../src/journal/backup';
import { MemoryKeptStore, type JournalEntry, type StoneEntry } from '../src/journal/kept';
import { MemoryMarkStore } from '../src/journal/marks';
import { nextPlacement } from '../src/stone/cairn';

const FAST = { iterations: 1000 };

function stone(id: string, createdAt: string, existing: StoneEntry[] = []): StoneEntry {
  const seed = id.length * 97 + 13;
  return { id, kind: 'stone', date: createdAt.slice(0, 10), createdAt, text: `stone ${id}`, seed, place: nextPlacement(existing, seed) };
}

function entry(id: string, updatedAt: string, text = 'words'): JournalEntry {
  return { id, kind: 'journal', date: updatedAt.slice(0, 10), createdAt: updatedAt, updatedAt, text };
}

const sample = (): BackupContents => {
  const a = stone('a', '2026-10-01T10:00:00.000Z');
  return {
    marks: [
      { date: '2026-10-01', ritual: 'stone', keptId: 'a' },
      { date: '2026-10-02', ritual: 'ocean' },
      { date: '2026-10-02', ritual: 'ocean' },
    ],
    kept: [a, entry('j1', '2026-10-03T09:00:00.000Z')],
  };
};

describe('backup file', () => {
  it('opens with the passphrase it was saved with', async () => {
    const text = await createBackup(sample(), 'quiet harbor at dusk', FAST);
    expect(text).not.toContain('stone a');
    expect(text).not.toContain('words');
    expect(await openBackup(text, 'quiet harbor at dusk')).toEqual(sample());
    expect(backupDate(text)).toBeInstanceOf(Date);
  });

  it('refuses a wrong passphrase', async () => {
    const text = await createBackup(sample(), 'quiet harbor at dusk', FAST);
    await expect(openBackup(text, 'quiet harbor at dawn')).rejects.toMatchObject({ reason: 'wrong-passphrase' });
  });

  it('notices a changed header', async () => {
    const file = JSON.parse(await createBackup(sample(), 'quiet harbor at dusk', FAST));
    file.createdAt = '2020-01-01T00:00:00.000Z';
    await expect(openBackup(JSON.stringify(file), 'quiet harbor at dusk')).rejects.toBeInstanceOf(BackupError);
  });

  it('says plainly when a file is not a backup', async () => {
    await expect(openBackup('{"hello":1}', 'x')).rejects.toMatchObject({ reason: 'not-a-backup' });
    await expect(openBackup('not json', 'x')).rejects.toMatchObject({ reason: 'not-a-backup' });
    const file = JSON.parse(await createBackup(sample(), 'quiet harbor at dusk', FAST));
    file.version = 99;
    await expect(openBackup(JSON.stringify(file), 'quiet harbor at dusk')).rejects.toMatchObject({ reason: 'newer-version' });
  });

  it('needs a passphrase of reasonable length', async () => {
    await expect(createBackup(sample(), 'short', FAST)).rejects.toThrow();
  });
});

describe('restoring', () => {
  it('adds what is missing, and restoring twice adds nothing', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    const first = await restoreBackup(sample(), marks, kept);
    expect(first).toEqual({ stones: 1, entries: 1, updated: 0, marks: 3 });
    const again = await restoreBackup(sample(), marks, kept);
    expect(again).toEqual({ stones: 0, entries: 0, updated: 0, marks: 0 });
    expect((await marks.all()).length).toBe(3);
  });

  it('keeps the newer copy of a journal entry', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    await kept.put(entry('j1', '2026-10-05T09:00:00.000Z', 'edited here'));
    const s = await restoreBackup(sample(), marks, kept);
    expect(s.updated).toBe(0);
    expect((await kept.get('j1'))?.text).toBe('edited here');
    await restoreBackup({ marks: [], kept: [entry('j1', '2026-10-09T09:00:00.000Z', 'edited later elsewhere')] }, marks, kept);
    expect((await kept.get('j1'))?.text).toBe('edited later elsewhere');
  });

  it('finds a new place for a stone whose spot is taken', async () => {
    const marks = new MemoryMarkStore();
    const kept = new MemoryKeptStore();
    const here = stone('here', '2026-09-01T10:00:00.000Z');
    await kept.put(here);
    await restoreBackup(sample(), marks, kept);
    const stones = await kept.all('stone');
    const spots = new Set(stones.map((s) => `${s.place.cairn}:${s.place.level}`));
    expect(stones.length).toBe(2);
    expect(spots.size).toBe(2);
    // The stone already here never moves.
    expect((await kept.get('here')) as StoneEntry).toEqual(here);
  });

  it('leaves out anything malformed', async () => {
    const text = await createBackup(
      { marks: [{ date: 'yesterday', ritual: 'ocean' } as never, { date: '2026-10-02', ritual: 'wind' }], kept: [{ id: 'x', kind: 'stone' } as never] },
      'quiet harbor at dusk',
      FAST,
    );
    const opened = await openBackup(text, 'quiet harbor at dusk');
    expect(opened.marks).toEqual([{ date: '2026-10-02', ritual: 'wind' }]);
    expect(opened.kept).toEqual([]);
  });
});
