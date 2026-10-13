// MIT. Complete operator setup drafts over the original Applications writer.
export const SETUP_SCHEMA = 'stellar-forge.application-setup.v1';
const MAX_DOCUMENT = 2 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const clone = value => JSON.parse(JSON.stringify(value));
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const timestamp = () => new Date().toISOString();
const text = (value, name, maximum = 4096) => {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0'), 'Invalid setup ' + name);
  return value;
};
const safeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 160 &&
  !['__proto__', 'constructor', 'prototype'].includes(key) && !key.includes('\0');
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const same = (left, right) => canonical(left) === canonical(right);

function settings(value) {
  need(plain(value) && Object.keys(value).length <= 256, 'Invalid setup fields');
  for (const [name, item] of Object.entries(value)) {
    need(safeKey(name), 'Invalid setup field name');
    need(typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number' && Number.isFinite(item),
      'Setup fields must retain text, numbers or boolean values');
    if (typeof item === 'string') text(item, 'field ' + name, 65536);
  }
  return clone(value);
}
function configuration(value) {
  need(plain(value), 'Invalid setup configuration');
  return { kind: text(value.kind ?? '', 'application type', 160),
    runtimeId: text(value.runtimeId ?? '', 'runtime ID', 160),
    label: text(value.label ?? '', 'display name', 120), settings: settings(value.settings ?? {}) };
}
function baseline(value) {
  if (value === null) return null;
  need(plain(value), 'Invalid setup opening application');
  return { applicationId: text(value.applicationId ?? value.id, 'application ID', 160),
    revision: text(value.revision, 'opening revision', 256), ...configuration(value) };
}
function catalogEntry(value) {
  need(plain(value) && safeKey(value.id) && Array.isArray(value.fields) && value.fields.length <= 256, 'Invalid setup application description');
  return { id: value.id, title: text(value.title ?? value.id, 'application title', 512),
    fields: value.fields.map(field => {
      need(plain(field) && safeKey(field.name), 'Invalid setup field description');
      return { name: field.name, type: text(field.type ?? 'text', 'field type', 80),
        label: text(field.label ?? field.name, 'field label', 512), required: field.required === true };
    }) };
}
function runtimeSource(value) {
  if (!value) return null;
  need(plain(value), 'Invalid setup runtime source');
  return Object.fromEntries(['id', 'directory', 'sourceCommit', 'packageVersion', 'sourceManifestSha256']
    .filter(name => typeof value[name] === 'string').map(name => [name, text(value[name], 'runtime ' + name, 4096)]));
}
function currentCatalog(catalog, kind) { return catalog.find(item => item.id === kind); }

export function parseSetupDocument(input) {
  need(typeof input === 'string' && input.length <= MAX_DOCUMENT && new TextEncoder().encode(input).byteLength <= MAX_DOCUMENT, 'Setup document exceeds 2 MiB');
  const value = JSON.parse(input);
  need(plain(value) && value.schema === SETUP_SCHEMA, 'Choose a complete Starforge application setup document');
  text(value.id, 'draft ID', 160); text(value.workspaceId, 'workspace ID', 256);
  text(value.createdAt, 'creation time', 80); text(value.updatedAt, 'update time', 80);
  if (value.title !== undefined) text(value.title, 'snapshot name', 160);
  if (value.baselineComplete !== undefined) need(typeof value.baselineComplete === 'boolean', 'Invalid opening settings completeness');
  value.configuration = configuration(value.configuration);
  value.baseline = baseline(value.baseline);
  need(plain(value.variants) && Object.keys(value.variants).length <= 512, 'Invalid setup type history');
  for (const [kind, fields] of Object.entries(value.variants)) { need(safeKey(kind), 'Invalid retained application type'); settings(fields); }
  need(plain(value.catalog) && Object.keys(value.catalog).length <= 512, 'Invalid setup source catalog');
  for (const [kind, entry] of Object.entries(value.catalog)) { need(safeKey(kind) && entry.id === kind, 'Invalid setup source type'); catalogEntry(entry); }
  value.runtimeSource = runtimeSource(value.runtimeSource);
  need(Array.isArray(value.receivedFrom) && Array.isArray(value.reconciliations), 'Invalid setup history');
  // Histories are retained documentary JSON. They are never used as API arguments.
  need(value.receivedFrom.length <= 512 && value.reconciliations.length <= 512, 'Setup history exceeds the document limit');
  need(value.configuration.kind === '' || safeKey(value.configuration.kind), 'Invalid selected application type');
  return clone(value);
}
export function serializeSetupDocument(draft) {
  const output = JSON.stringify(draft, null, 2) + '\n';
  parseSetupDocument(output);
  return output;
}
export function createSetupDraft({ workspaceId, application = null, configuration: input = {},
  catalog = [], runtime = null, id = globalThis.crypto.randomUUID(), now = timestamp() }) {
  const value = configuration(application ?? input), entry = currentCatalog(catalog, value.kind);
  return parseSetupDocument(JSON.stringify({ schema: SETUP_SCHEMA, id, workspaceId, createdAt: now, updatedAt: now,
    configuration: value, baseline: application ? baseline(application) : null,
    variants: value.kind ? { [value.kind]: value.settings } : {},
    catalog: entry ? { [entry.id]: catalogEntry(entry) } : {},
    runtimeSource: runtimeSource(runtime), receivedFrom: [], reconciliations: [] }));
}
export function updateSetupDraft(draft, input, { catalog = [], runtime = null, now = timestamp() } = {}) {
  const next = parseSetupDocument(JSON.stringify(draft)), value = configuration(input);
  next.configuration = value; next.updatedAt = now;
  if (value.kind) next.variants[value.kind] = clone(value.settings);
  const entry = currentCatalog(catalog, value.kind);
  if (entry && !next.catalog[value.kind]) next.catalog[value.kind] = catalogEntry(entry);
  next.runtimeSource = runtimeSource(runtime);
  return parseSetupDocument(JSON.stringify(next));
}
export function receiveSetupDraft(draft, { workspaceId, id = globalThis.crypto.randomUUID(), now = timestamp() }) {
  const next = parseSetupDocument(JSON.stringify(draft));
  next.receivedFrom.push({ workspaceId: next.workspaceId, draftId: next.id, createdAt: next.createdAt,
    updatedAt: next.updatedAt, configuration: clone(next.configuration), baseline: clone(next.baseline),
    runtimeSource: clone(next.runtimeSource) });
  next.id = id; next.workspaceId = workspaceId; next.createdAt = next.updatedAt = now;
  next.baseline = null; next.configuration.runtimeId = ''; next.runtimeSource = null;
  return parseSetupDocument(JSON.stringify(next));
}
function normalizedField(name, source, catalog) {
  const type = currentCatalog(catalog, source.kind)?.fields.find(field => field.name === name)?.type;
  const value = source.settings[name];
  if (type === 'boolean') return value === true;
  if (value === undefined || value === '') return type === 'port' ? '0' : '';
  return String(value);
}
function normalizedSettings(source, catalog) {
  const names = new Set([...Object.keys(source.settings), ...(currentCatalog(catalog, source.kind)?.fields ?? []).map(field => field.name)]);
  return Object.fromEntries([...names].map(name => [name, normalizedField(name, source, catalog)]));
}
export function reviewSetupReconciliation(draft, application, catalog = []) {
  const source = parseSetupDocument(JSON.stringify(draft));
  need(source.baseline && application?.id === source.baseline.applicationId, 'Select the original saved application to reconcile');
  const before = source.baseline, mine = source.configuration, current = baseline(application), rows = [];
  const add = (key, label, original, changed, latest) => {
    const conflict = !same(changed, original) && !same(latest, original) && !same(changed, latest);
    rows.push({ key, label, original, draft: changed, current: latest, conflict,
      selection: conflict ? null : same(changed, original) ? 'current' : 'draft' });
  };
  add('label', 'Display name', before.label, mine.label, current.label);
  add('runtimeId', 'Runtime', before.runtimeId, mine.runtimeId, current.runtimeId);
  if (source.baselineComplete === false || before.kind !== mine.kind || before.kind !== current.kind) {
    add('application', 'Application type and complete settings',
      { kind: before.kind, settings: normalizedSettings(before, catalog) }, { kind: mine.kind, settings: normalizedSettings(mine, catalog) },
      { kind: current.kind, settings: normalizedSettings(current, catalog) });
    if (source.baselineComplete === false) {
      const row = rows.at(-1); row.conflict = true; row.selection = null; row.originalUnavailable = true;
    }
  } else {
    const fields = [...new Set([...Object.keys(before.settings), ...Object.keys(mine.settings), ...Object.keys(current.settings),
      ...(currentCatalog(catalog, mine.kind)?.fields ?? []).map(field => field.name)])].sort();
    for (const name of fields) add('field:' + name,
      currentCatalog(catalog, mine.kind)?.fields.find(field => field.name === name)?.label ?? name,
      normalizedField(name, before, catalog), normalizedField(name, mine, catalog), normalizedField(name, current, catalog));
  }
  return { draftId: source.id, original: canonical(source), application: current,
    rows, configuration: clone(mine), conflicts: rows.filter(row => row.conflict).length };
}
export function applySetupReconciliation(draft, review, choices = {}, { catalog = [], runtime = null, now = timestamp() } = {}) {
  need(review?.draftId === draft.id && review.original === canonical(draft), 'Setup changed; compare current settings again');
  const input = clone(review.configuration);
  for (const row of review.rows) {
    const selected = row.conflict ? choices[row.key] : row.selection;
    need(selected === 'draft' || selected === 'current', 'Choose the value for ' + row.label);
    const value = clone(row[selected]);
    if (row.key === 'application') { input.kind = value.kind; input.settings = value.settings; }
    else if (row.key.startsWith('field:')) input.settings[row.key.slice(6)] = value;
    else input[row.key] = value;
  }
  const next = updateSetupDraft(draft, input, { catalog, runtime, now });
  next.reconciliations.push({ at: now, applicationId: review.application.applicationId,
    fromRevision: draft.baseline.revision, toRevision: review.application.revision,
    previousBaseline: clone(draft.baseline),
    decisions: review.rows.map(row => ({ field: row.key, selected: row.conflict ? choices[row.key] : row.selection })) });
  next.baseline = clone(review.application); next.baselineComplete = true;
  return parseSetupDocument(JSON.stringify(next));
}
// IndexedDB performs the draft-version comparison and write in one transaction.
// The product's original server remains the only saved-application writer.
export function openApplicationSetupStore(indexedDB = globalThis.indexedDB) {
  need(indexedDB && typeof indexedDB.open === 'function', 'Browser draft storage is unavailable; download the complete setup file');
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('starforge-application-setup-v1', 1);
    request.onupgradeneeded = () => {
      const table = request.result.createObjectStore('drafts', { keyPath: 'key' });
      table.createIndex('workspace', 'workspaceId', { unique: false });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close the older setup editor so this browser can open its saved drafts'));
  });
  const tableKey = (workspaceId, id) => JSON.stringify([workspaceId, id]);
  async function transact(mode, work) {
    const database = await opened;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('drafts', mode), table = transaction.objectStore('drafts');
      let result, failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => { failure ??= transaction.error; };
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Setup draft transaction was interrupted'));
      const set = value => { result = value; };
      const abort = error => { failure = error; transaction.abort(); };
      try { work(table, set, abort); } catch (error) { abort(error); }
    });
  }
  return {
    async list(workspaceId) {
      return transact('readonly', (table, set) => {
        const request = table.index('workspace').getAll(workspaceId);
        request.onsuccess = () => set(request.result.sort((a, b) =>
          b.document.updatedAt.localeCompare(a.document.updatedAt)).map(record => clone(record)));
      });
    },
    async get(workspaceId, id) {
      return transact('readonly', (table, set) => {
        const request = table.get(tableKey(workspaceId, id));
        request.onsuccess = () => set(request.result ? clone(request.result) : null);
      });
    },
    async put(document, expectedVersion = 0) {
      const draft = parseSetupDocument(JSON.stringify(document));
      return transact('readwrite', (table, set, abort) => {
        const key = tableKey(draft.workspaceId, draft.id), request = table.get(key);
        request.onsuccess = () => {
          if ((request.result?.version ?? 0) !== expectedVersion) {
            abort(new Error('This setup draft changed in another tab. Save a receiving copy or reopen the saved draft.')); return;
          }
          const record = { key, workspaceId: draft.workspaceId, version: expectedVersion + 1, document: draft };
          table.put(record); set(clone(record));
        };
      });
    },
    async remove(workspaceId, id, expectedVersion) {
      return transact('readwrite', (table, set, abort) => {
        const key = tableKey(workspaceId, id), request = table.get(key);
        request.onsuccess = () => {
          if (!request.result || request.result.version !== expectedVersion) {
            abort(new Error('This setup draft changed. Reopen it before removing its browser copy.')); return;
          }
          table.delete(key); set({ id, removed: true });
        };
      });
    },
  };
}
