// MIT. Revision-checked, workspace-bound working copies for the follow-up desk.
const DATABASE = "commons.openlineage.quality-followup.drafts.v1";
const STORE = "drafts";
const copy = value => structuredClone(value);
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: "key"});
    request.onerror = () => { failed = true; reject(request.error ?? new Error("Could not open saved working copies")); };
    request.onblocked = () => { failed = true; reject(new Error("Close another workspace tab to open saved working copies")); };
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
  });
}
export async function listQualityDrafts(workspaceId) {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly"), request = transaction.objectStore(STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result.filter(row => row.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }); } finally { db.close(); }
}
export async function saveQualityDraft(workspaceId, id, expectedVersion, value) {
  const db = await open(), key = workspaceId + "|" + id;
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite"), store = transaction.objectStore(STORE);
    let result, failure;
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Working-copy save was interrupted"));
    transaction.oncomplete = () => resolve(result);
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result;
      if ((current?.version ?? 0) !== expectedVersion) {
        failure = new Error("Another tab saved this working copy. Your entered fields remain here; save a separate copy or reopen the current saved version.");
        failure.code = "QUALITY_DRAFT_CONFLICT";
        transaction.abort(); return;
      }
      result = {schema: "commons.openlineage.quality-working-copy.v1", key, workspaceId, id,
        version: expectedVersion + 1, updatedAt: new Date().toISOString(), value: copy(value)};
      store.put(result);
    };
  }); } finally { db.close(); }
}
export function validateQualityDraft(value, workspaceId) {
  const record = item => item !== null && typeof item === "object" && !Array.isArray(item);
  const string = item => typeof item === "string";
  const strings = items => Array.isArray(items) && items.every(string);
  const pairs = (items, left, right) => Array.isArray(items) && items.every(item =>
    record(item) && string(item[left]) && string(item[right]) && Object.keys(item).every(key => [left, right].includes(key)));
  const basis = item => record(item) && item.workspaceId === workspaceId &&
    Number.isSafeInteger(item.revision) && item.revision >= 0 &&
    (item.id === null || string(item.id)) && (item.version === null || Number.isSafeInteger(item.version) && item.version > 0);
  const entered = item => record(item) && ["open", "investigating", "accepted", "resolved"].includes(item.decision) &&
    string(item.reason) && string(item.owner) && (item.dueDate === null || string(item.dueDate)) &&
    strings(item.evidenceResultIds) && (item.sourceDisposition === null || record(item.sourceDisposition) &&
      string(item.sourceDisposition.evaluationId) && string(item.sourceDisposition.findingId) &&
      Number.isSafeInteger(item.sourceDisposition.version) && item.sourceDisposition.version > 0);
  const draft = item => record(item) && entered(item.values) && entered(item.opened) && basis(item.basis);
  const safeKey = key => !["__proto__", "constructor", "prototype"].includes(key);
  const controls = item => record(item) && string(item.beforeRunKey) && string(item.afterRunKey) &&
    record(item.findingChoices) && Object.entries(item.findingChoices).every(([key, choice]) => safeKey(key) && string(choice)) &&
    ["html", "json", "csv"].includes(item.reportFormat) &&
    (item.tab === undefined || ["compare", "followup"].includes(item.tab)) &&
    (item.search === undefined || string(item.search)) &&
    (item.page === undefined || Number.isSafeInteger(item.page) && item.page >= 0);
  const pending = item => record(item) && item.workspaceId === workspaceId &&
    ["quality.followup.comparison.save", "quality.followup.save"].includes(item.action) &&
    record(item.args) && string(item.args.operationId) && Boolean(item.args.operationId.trim()) &&
    Number.isSafeInteger(item.args.expectedRevision) && item.args.expectedRevision >= 0;
  const work = value?.value, selection = work?.selection;
  if (!record(value) || value.schema !== "commons.openlineage.quality-working-copy.v1" || value.workspaceId !== workspaceId ||
    !record(work) || !record(selection) || !string(selection.beforeEvaluationId) || !string(selection.afterEvaluationId) ||
    !string(selection.title) || !pairs(selection.runPairs, "beforeRunKey", "afterRunKey") ||
    !pairs(selection.findingPairs, "beforeFindingId", "afterFindingId") || !string(work.selectedComparisonId) ||
    !string(work.selectedRowId) || (work.controls !== undefined && !controls(work.controls)) ||
    (value.originalPendingRequest !== undefined && !pending(value.originalPendingRequest)) ||
    (work.originalPendingRequest !== undefined && !pending(work.originalPendingRequest)) ||
    !record(work.followups) || Object.entries(work.followups).some(([key, item]) =>
      ["__proto__", "constructor", "prototype"].includes(key) || !draft(item) || item.previous !== undefined && !draft(item.previous)))
    throw new Error("Choose a complete working copy belonging to this original workspace");
  if (JSON.stringify(value).length > 10000000) throw new Error("Working copy exceeds the 10 MB authoring limit");
  return copy(work);
}
