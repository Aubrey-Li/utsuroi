/**
 * The app's one on-device database.
 *
 * - `marks`: a date and a ritual for each completed ritual (no words).
 * - `kept`: words you chose to keep (stones, journal entries), encrypted.
 * - `keys`: the encryption key, which the browser can use but never reveals.
 */
export const DB_NAME = 'utsuroi';
export const DB_VERSION = 2;

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const opened = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  let p = opened.get(factory);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('marks')) db.createObjectStore('marks', { autoIncrement: true }).createIndex('date', 'date');
        if (!db.objectStoreNames.contains('kept')) {
          const kept = db.createObjectStore('kept', { keyPath: 'id' });
          kept.createIndex('kind', 'kind');
          kept.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    opened.set(factory, p);
  }
  return p;
}
