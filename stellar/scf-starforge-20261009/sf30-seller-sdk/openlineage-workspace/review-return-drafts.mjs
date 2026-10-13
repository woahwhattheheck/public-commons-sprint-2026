// MIT. One immutable pending mutation and explicit working-copy CAS per workspace.
const DATABASE = "commons.openlineage.recipient-return-desk.v1", STORE = "workspaces";
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1); let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "workspaceId" });
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new Error("Close another review desk tab to open retained work")); };
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
  });
}
export async function readReturnDesk(workspaceId) {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"), request = tx.objectStore(STORE).get(workspaceId);
    let value; request.onsuccess = () => value = request.result ?? null;
    tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function saveReturnDesk(workspaceId, expectedVersion, value) {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE); let result, failure;
    const request = store.get(workspaceId);
    request.onsuccess = () => {
      if ((request.result?.version ?? 0) !== expectedVersion) {
        failure = new Error("Another tab saved this workspace's return desk. Download your current entries and reopen the saved working copy.");
        tx.abort(); return;
      }
      result = { schema: "commons.openlineage.return-desk.v1", workspaceId, version: expectedVersion + 1,
        updatedAt: new Date().toISOString(), value: structuredClone(value) };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error); tx.onabort = () => reject(failure ?? tx.error);
  }); } finally { db.close(); }
}
