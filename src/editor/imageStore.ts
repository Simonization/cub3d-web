/** Uploaded wall images, kept in the browser and keyed by their pretend path. */

const DB_NAME = 'cub3d-web';
const STORE = 'textures';

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const putImage = (path: string, blob: Blob): Promise<IDBValidKey> =>
  transact('readwrite', (store) => store.put(blob, path));

export const getImage = (path: string): Promise<Blob | undefined> =>
  transact('readonly', (store) => store.get(path) as IDBRequest<Blob | undefined>);

export const listImages = (): Promise<string[]> =>
  transact('readonly', (store) => store.getAllKeys() as IDBRequest<string[]>).then((keys) =>
    keys.map(String),
  );
