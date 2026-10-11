const DATABASE = 'stellar-forge-merchant-drafts';
const STORE = 'drafts';

export class DraftConflictError extends Error {
  constructor() {
    super('A newer version of this draft was saved in another tab. Reopen it, or save your current work as a new draft.');
    this.name = 'DraftConflictError';
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Draft storage is unavailable in this browser. Download a draft JSON to keep your work.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close another Stellar Forge tab, then reopen saved drafts.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    let failure;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure || tx.error || new Error('Draft storage could not finish. Download your draft JSON.')); };
    operation(tx.objectStore(STORE), value => { result = value; }, error => { failure = error; tx.abort(); });
  });
}

export function listDrafts() {
  return transaction('readonly', (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result.map(({ input, ...metadata }) => metadata).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });
}

export function loadDraft(id) {
  return transaction('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result || null);
  });
}

export function saveDraft({ id, revision = 0, input }) {
  const key = id || crypto.randomUUID();
  return transaction('readwrite', (store, done, fail) => {
    const read = store.get(key);
    read.onsuccess = () => {
      const previous = read.result;
      if ((previous?.revision || 0) !== revision) return fail(new DraftConflictError());
      const record = {
        id: key, revision: revision + 1, name: input.folder || 'Untitled merchant',
        resources: Array.isArray(input.resources) ? input.resources.length : 0,
        updatedAt: new Date().toISOString(), input: structuredClone(input),
      };
      store.put(record);
      done(record);
    };
  });
}

export function deleteDraft(id, revision) {
  return transaction('readwrite', (store, done, fail) => {
    const read = store.get(id);
    read.onsuccess = () => {
      if (read.result && read.result.revision !== revision) return fail(new DraftConflictError());
      store.delete(id);
      done(true);
    };
  });
}
