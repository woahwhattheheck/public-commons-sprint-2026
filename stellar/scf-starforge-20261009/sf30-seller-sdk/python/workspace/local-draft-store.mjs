// MIT. Retain full local source drafts and exact pending requests in IndexedDB.
// The token stays outside this store. Values are structured clones, never JSON-normalized.
const DATABASE = 'stellar-forge-python-merchant-workspaces';
const VERSION = 1, RECORDS = 'workspace-records';
let connection = null;

function storageError(error, operation) {
  if (error?.name === 'PythonWorkspaceStorageError') return error;
  const original = error?.name ?? 'StorageError';
  let code = 'LOCAL_STORAGE_FAILED';
  let message = 'Could not ' + operation + ' in local browser storage. Your saved server revisions remain available.';
  if (original === 'QuotaExceededError') {
    code = 'LOCAL_STORAGE_FULL';
    message = 'Browser storage is full. Download the current local draft, free storage for this local workspace origin, and retry. Saved server revisions remain available.';
  } else if (['SecurityError', 'NotAllowedError', 'InvalidAccessError'].includes(original)) {
    code = 'LOCAL_STORAGE_UNAVAILABLE';
    message = 'This browser does not allow IndexedDB storage for the local workspace. Enable site storage or reopen the operator URL in a browser profile that allows it; source revisions already saved on the server remain available.';
  } else if (original === 'VersionError') {
    code = 'LOCAL_STORAGE_VERSION';
    message = 'This browser contains local workspace data from a newer editor. Reload the matching current workspace editor to reopen that data.';
  } else if (original === 'DataCloneError') {
    code = 'LOCAL_STORAGE_VALUE';
    message = 'The local draft or pending request contains a value that browser storage cannot retain. Keep its source, declaration and input as ordinary structured data.';
  } else if (original === 'AbortError') {
    code = 'LOCAL_STORAGE_ABORTED';
    message = 'The browser interrupted the local storage transaction before it committed. Retry this action; its write has not been acknowledged.';
  }
  const result = new Error(message, { cause: error });
  result.name = 'PythonWorkspaceStorageError'; result.code = code; result.operation = operation;
  return result;
}

function connect() {
  if (connection) return connection;
  if (!globalThis.indexedDB) {
    return Promise.reject(storageError(Object.assign(new Error('IndexedDB is unavailable.'), { name: 'NotAllowedError' }), 'open the draft store'));
  }
  let resolveOpen, rejectOpen;
  const pending = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  connection = pending;
  let request, settled = false;
  const fail = error => {
    if (settled) return; settled = true;
    if (connection === pending) connection = null;
    rejectOpen(storageError(error, 'open the draft store'));
  };
  try { request = globalThis.indexedDB.open(DATABASE, VERSION); }
  catch (error) { fail(error); return pending; }
  request.onupgradeneeded = () => {
    try {
      if (!request.result.objectStoreNames.contains(RECORDS))
        request.result.createObjectStore(RECORDS, { keyPath: ['workspaceId', 'kind'] });
    } catch (error) { request.transaction?.abort(); fail(error); }
  };
  request.onerror = () => fail(request.error);
  request.onblocked = () => {
    const error = new Error('Another open workspace tab is using an older local storage connection. Close or reload that tab, then retry this operation.');
    error.name = 'PythonWorkspaceStorageError'; error.code = 'LOCAL_STORAGE_BUSY'; error.operation = 'open the draft store';
    fail(error);
  };
  request.onsuccess = () => {
    const database = request.result;
    if (settled) { database.close(); return; }
    if (!database.objectStoreNames.contains(RECORDS)) {
      database.close(); fail(new Error('The local workspace record store is missing.')); return;
    }
    database.onversionchange = () => {
      database.close(); if (connection === pending) connection = null;
    };
    database.onclose = () => { if (connection === pending) connection = null; };
    settled = true; resolveOpen(database);
  };
  return pending;
}

async function transaction(workspaceId, kind, action, value) {
  const operation = (action === 'read' ? 'read ' : action === 'delete' ? 'remove ' : 'retain ') + (kind === 'draft' ? 'the local source draft' : 'the exact pending request');
  let copied;
  if (action === 'write') {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('A structured record is required.'), { name: 'DataCloneError' });
      if (value.workspaceId !== undefined && value.workspaceId !== workspaceId) {
        const error = new Error('This record belongs to another workspace. Refresh the current workspace before retaining it.');
        error.name = 'PythonWorkspaceStorageError'; error.code = 'LOCAL_STORAGE_WORKSPACE_MISMATCH'; error.operation = operation; throw error;
      }
      // Capture the submitted value synchronously, before an editor can modify it again.
      copied = structuredClone(value);
    } catch (error) { throw storageError(error, operation); }
  }
  let database;
  try { database = await connect(); } catch (error) { throw storageError(error, operation); }
  return new Promise((resolve, reject) => {
    let tx, result = null, requestError = null, completed = false;
    const fail = error => {
      if (completed) return; completed = true;
      reject(storageError(error ?? requestError ?? tx?.error ?? new Error('Storage transaction failed.'), operation));
    };
    try {
      const mode = action === 'read' ? 'readonly' : 'readwrite';
      // Strict durability is supported by the operator Chromium; older browsers
      // still resolve only after their native transaction-complete event.
      try { tx = database.transaction(RECORDS, mode, { durability: mode === 'readwrite' ? 'strict' : 'default' }); }
      catch (error) { if (error instanceof TypeError) tx = database.transaction(RECORDS, mode); else throw error; }
      tx.oncomplete = () => { if (completed) return; completed = true; resolve(result); };
      tx.onabort = () => fail(requestError ?? tx.error ?? Object.assign(new Error('Local transaction aborted.'), { name: 'AbortError' }));
      tx.onerror = () => { requestError ??= tx.error; };
      const store = tx.objectStore(RECORDS), key = [workspaceId, kind];
      const request = action === 'read' ? store.get(key) : action === 'delete' ? store.delete(key) :
        store.put({ workspaceId, kind, value: copied, savedAt: new Date().toISOString() });
      request.onsuccess = () => { if (action === 'read') result = request.result?.value ?? null; };
      request.onerror = () => { requestError = request.error; };
    } catch (error) {
      if (tx) { try { tx.abort(); } catch {} }
      fail(error);
    }
  });
}

/** One immutable server workspace ID, independent of the selected revision or current token. */
export function createDraftStore(workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 200 || /[\u0000-\u001f\u007f]/.test(workspaceId))
    throw new TypeError('Use the immutable workspace ID returned by the original workspace server.');
  return Object.freeze({
    readDraft: () => transaction(workspaceId, 'draft', 'read'),
    writeDraft: value => transaction(workspaceId, 'draft', 'write', value),
    readPending: () => transaction(workspaceId, 'pending', 'read'),
    writePending: value => transaction(workspaceId, 'pending', 'write', value),
    deletePending: () => transaction(workspaceId, 'pending', 'delete'),
  });
}
