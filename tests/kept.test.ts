import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbMarkStore } from '../src/journal/marks';
import { IdbKeptStore, MemoryKeptStore, isKeptEntry, newId, type StoneEntry } from '../src/journal/kept';

const place = { cairn: 0, level: 0, x: 1, y: 0.05, z: -2, rotY: 0.3, tiltX: 0.01, tiltZ: -0.02 };
const stone = (text: string, date = '2026-10-11'): StoneEntry => ({
  id: newId(),
  kind: 'stone',
  date,
  createdAt: new Date().toISOString(),
  text,
  seed: 42,
  place,
});

describe('kept entries', () => {
  it('keeps a stone and reads it back', async () => {
    const store = await IdbKeptStore.open();
    const s = stone('I will remember the plum tree');
    await store.put(s);
    expect(await store.get(s.id)).toEqual(s);
    expect((await store.all('stone')).some((e) => e.id === s.id)).toBe(true);
    expect((await store.onDate('2026-10-11')).some((e) => e.id === s.id)).toBe(true);
  });

  it('stores the words encrypted, never in the clear', async () => {
    const store = await IdbKeptStore.open();
    const s = stone('a secret only for me');
    await store.put(s);
    const raw = await new Promise<Record<string, unknown>>((resolve) => {
      const req = indexedDB.open('utsuroi');
      req.onsuccess = () => {
        const get = req.result.transaction('kept').objectStore('kept').get(s.id);
        get.onsuccess = () => resolve(get.result);
      };
    });
    expect(JSON.stringify(Object.keys(raw).sort())).toBe(JSON.stringify(['data', 'date', 'id', 'iv', 'kind']));
    const bytes = new Uint8Array(raw.data as ArrayBuffer);
    expect(new TextDecoder().decode(bytes)).not.toContain('secret');
  });

  it('won’t remove a stone, but will remove a journal entry', async () => {
    const store = await IdbKeptStore.open();
    const s = stone('here to stay');
    await store.put(s);
    await expect(store.remove(s.id)).rejects.toThrow();
    expect(await store.get(s.id)).not.toBeNull();
    const j = { id: newId(), kind: 'journal' as const, date: '2026-10-11', createdAt: 'x', updatedAt: 'x', text: 'today' };
    await store.put(j);
    await store.remove(j.id);
    expect(await store.get(j.id)).toBeNull();
  });

  it('rejects malformed entries', async () => {
    expect(isKeptEntry({ ...stone('x'), date: 'yesterday' })).toBe(false);
    expect(isKeptEntry({ ...stone('x'), place: { cairn: 0 } })).toBe(false);
    expect(isKeptEntry({ ...stone('x'), kind: 'scroll' })).toBe(false);
    await expect(new MemoryKeptStore().put({ ...stone('x'), seed: NaN })).rejects.toThrow();
  });

  it('shares the database with ritual marks', async () => {
    const marks = await IdbMarkStore.open();
    await marks.add({ date: '2026-10-11', ritual: 'stone', keptId: 'abc' });
    expect((await marks.inMonth(2026, 9)).some((m) => m.keptId === 'abc')).toBe(true);
  });
});
