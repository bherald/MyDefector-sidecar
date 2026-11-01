const NAME = 'MyDefector-sidecar';
let connection;
export function openDatabase() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('values');
        request.result.createObjectStore('inbox', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return connection;
}
export async function get(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = db.transaction('values').objectStore('values').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function put(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('values', 'readwrite');
    tx.objectStore('values').put(value, key);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Local storage write failed.'));
  });
}
export async function archives() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction('values')
      .objectStore('values')
      .getAll(IDBKeyRange.bound('archive:', 'archive:\uffff'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function enqueueCapture(capture) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inbox', 'readwrite');
    tx.objectStore('inbox').add(capture);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export async function inbox() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = db.transaction('inbox').objectStore('inbox').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function acceptInbox(draft, ids) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['values', 'inbox'], 'readwrite');
    tx.objectStore('values').put(draft, 'draft');
    for (const id of ids) tx.objectStore('inbox').delete(id);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
