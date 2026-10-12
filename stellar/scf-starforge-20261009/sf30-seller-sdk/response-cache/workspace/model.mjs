// MIT. Operating history around the original merchant cache control.
import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { callCacheControl, callCacheControlFile } from '../control.mjs';
import { privateDirectory, operationLease } from '../../../distribution/runtime-workspace/storage.mjs';

const SCHEMA = 'stellar-forge.response-cache-workspace.v1';
const EXPORT_SCHEMA = 'stellar-forge.response-cache-workspace-export.v1';
const RETENTION = Object.freeze({ ttlMs: [1, 3600000], maxEntries: [1, 100000],
  maxBytes: [1, 268435456], maxEntryBytes: [1, 16777216] });
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const need = (value, code, status) => { if (!value) fail(code, status); };
const text = (value, max = 2000) => typeof value === 'string' && value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const parse = value => value === null ? null : JSON.parse(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export const retentionFields = Object.freeze(Object.keys(RETENTION));
export function validateSources(value, { direct = false } = {}) {
  need(Array.isArray(value) && value.length <= 64, 'CACHE_WORKSPACE_SOURCES_INVALID');
  const ids = new Set();
  return value.map(row => {
    need(plain(row) && Object.keys(row).every(key => ['id', 'label', 'socketPath', 'controlFile'].includes(key)) &&
      ID.test(row.id ?? '') && !ids.has(row.id) && text(row.label, 160) && row.label.trim() &&
      (Boolean(row.socketPath) !== Boolean(row.controlFile) || direct && !row.socketPath && !row.controlFile), 'CACHE_WORKSPACE_SOURCE_INVALID');
    const path = row.socketPath ?? row.controlFile;
    if (path !== undefined) need(typeof path === 'string' && path === resolve(path) && !path.includes('\0'), 'CACHE_WORKSPACE_SOURCE_PATH_INVALID');
    ids.add(row.id);
    return Object.freeze({ id: row.id, label: row.label.trim(), ...(path === undefined ? {} : row.socketPath ? { socketPath: path } : { controlFile: path }) });
  });
}
function validateInspection(value) {
  need(plain(value) && typeof value.instanceId === 'string' && value.instanceId.length >= 8 &&
    value.instanceId.length <= 160 && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    plain(value.routes) && Object.keys(value.routes).length <= 64, 'CACHE_WORKSPACE_INSPECTION_INVALID', 502);
  for (const [id, route] of Object.entries(value.routes)) {
    need(typeof id === 'string' && id.length > 0 && id.length <= 128 && plain(route), 'CACHE_WORKSPACE_INSPECTION_INVALID', 502);
  }
  return clone(value);
}
function retentionPatch(input, limits) {
  need(plain(input) && Object.keys(input).length > 0 && Object.keys(input).every(key => key in RETENTION),
    'CACHE_WORKSPACE_RETENTION_INVALID');
  for (const [key, value] of Object.entries(input)) {
    const [min, max] = RETENTION[key];
    need(Number.isSafeInteger(value) && value >= min && value <= max, 'CACHE_WORKSPACE_RETENTION_INVALID');
  }
  const next = { ...limits, ...input };
  need(next.maxEntryBytes <= next.maxBytes && next.maxEntryBytes <= next.maxResponseBytes,
    'CACHE_WORKSPACE_ENTRY_BUDGET_INVALID');
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}
const errorCode = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.code ?? '') ? error.code :
  /^CACHE_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'CACHE_CONTROL_UNAVAILABLE';

function difference(before, after) {
  const counters = ['requests', 'hits', 'misses', 'coalesced', 'sourceReads', 'sourceErrors',
    'sourceTimeouts', 'cancelledConsumers', 'evictions', 'expired', 'bypasses', 'invalidations', 'rejectedAtCapacity'];
  const sameInstance = before.instanceId === after.instanceId;
  const rows = [];
  for (const id of [...new Set([...Object.keys(before.routes), ...Object.keys(after.routes)])].sort()) {
    const a = before.routes[id], b = after.routes[id];
    const aStats = a?.stats?.cache ?? a?.stats ?? a, bStats = b?.stats?.cache ?? b?.stats ?? b;
    const deltas = {};
    const sameGeneration = sameInstance && a && b && a.generation === b.generation && a.cacheGeneration === b.cacheGeneration;
    if (sameGeneration) for (const key of counters) {
      if (Number.isSafeInteger(aStats[key]) && Number.isSafeInteger(bStats[key]) && bStats[key] >= aStats[key]) deltas[key] = bStats[key] - aStats[key];
    }
    rows.push({ id, before: a ?? null, after: b ?? null, sameGeneration: Boolean(sameGeneration), deltas,
      retention: Object.fromEntries(retentionFields.filter(key => a?.limits?.[key] !== b?.limits?.[key])
        .map(key => [key, { before: a?.limits?.[key] ?? null, after: b?.limits?.[key] ?? null }])) });
  }
  return { sameInstance, beforeRevision: before.revision, afterRevision: after.revision, routes: rows };
}

export async function openCacheWorkspace({ directory, sources = [], request } = {}) {
  need(typeof directory === 'string' && directory === resolve(directory), 'CACHE_WORKSPACE_DIRECTORY_REQUIRED');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  const configured = validateSources(sources, { direct: typeof request === 'function' }), controls = new Map(configured.map(row => [row.id, row]));
  const lease = await operationLease(join(directory, 'workspace.lock'));
  let db, closed = false;
  const active = new Set();
  try {
    const dbPath = join(directory, 'workspace.sqlite');
    try {
      const info = await lstat(dbPath);
      need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), 'CACHE_WORKSPACE_DATABASE_INVALID');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    db = new DatabaseSync(dbPath);
    await chmod(dbPath, 0o600);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, label TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, label TEXT NOT NULL,' +
      ' captured_at TEXT NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(source_id) REFERENCES sources(id));' +
      'CREATE TABLE IF NOT EXISTS changes(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, inspection_id TEXT NOT NULL,' +
      ' created_at TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,' +
      ' FOREIGN KEY(source_id) REFERENCES sources(id), FOREIGN KEY(inspection_id) REFERENCES inspections(id));');
    if (!db.prepare("SELECT value FROM meta WHERE key='workspace'").get()) {
      db.prepare('INSERT INTO meta VALUES (?,?)').run('workspace', JSON.stringify({ schema: SCHEMA, id: randomUUID(),
        revision: 0, createdAt: now() }));
    }
    const identity = parse(db.prepare("SELECT value FROM meta WHERE key='workspace'").get().value);
    need(identity.schema === SCHEMA && UUID.test(identity.id) && Number.isSafeInteger(identity.revision),
      'CACHE_WORKSPACE_DATABASE_INVALID');
    for (const row of configured) db.prepare('INSERT INTO sources(id,label) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label')
      .run(row.id, row.label);
  } catch (error) { db?.close(); await lease.close(); throw error; }
  const identity = () => parse(db.prepare("SELECT value FROM meta WHERE key='workspace'").get().value);
  function transaction(expected, callback) {
    need(!closed, 'CACHE_WORKSPACE_CLOSED', 503);
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = identity();
      need(expected === undefined || expected === state.revision, 'CACHE_WORKSPACE_REVISION_CONFLICT', 409);
      const result = callback(state);
      need(state.revision < Number.MAX_SAFE_INTEGER, 'CACHE_WORKSPACE_REVISION_EXHAUSTED', 503);
      db.prepare("UPDATE meta SET value=? WHERE key='workspace'").run(JSON.stringify({ ...state, revision: state.revision + 1 }));
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const sourceRows = () => db.prepare('SELECT id,label FROM sources ORDER BY label,id').all()
    .map(row => ({ ...row, configured: controls.has(row.id) }));
  function source(id) {
    need(ID.test(id ?? ''), 'CACHE_WORKSPACE_SOURCE_INVALID');
    const result = controls.get(id);
    need(result, 'CACHE_WORKSPACE_SOURCE_NOT_CONFIGURED', 409);
    return result;
  }
  async function send(id, command) {
    const row = source(id);
    if (request) return request(row, clone(command));
    return row.socketPath ? callCacheControl(row.socketPath, command) : callCacheControlFile(row.controlFile, command);
  }
  const rowInspection = row => row ? { id: row.id, sourceId: row.source_id, label: row.label,
    capturedAt: row.captured_at, inspection: parse(row.payload) } : null;
  const rowChange = row => row ? { ...parse(row.body), status: row.status } : null;
  function inspection(id) {
    need(UUID.test(id ?? ''), 'CACHE_WORKSPACE_RECORD_INVALID');
    const row = rowInspection(db.prepare('SELECT * FROM inspections WHERE id=?').get(id));
    need(row, 'CACHE_WORKSPACE_INSPECTION_NOT_FOUND', 404); return row;
  }
  function change(id) {
    need(UUID.test(id ?? ''), 'CACHE_WORKSPACE_RECORD_INVALID');
    const row = rowChange(db.prepare('SELECT * FROM changes WHERE id=?').get(id));
    need(row, 'CACHE_WORKSPACE_CHANGE_NOT_FOUND', 404); return row;
  }
  function saveChange(row) {
    db.prepare('INSERT INTO changes(id,source_id,inspection_id,created_at,updated_at,body,status) VALUES (?,?,?,?,?,?,?)' +
      ' ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,body=excluded.body,status=excluded.status')
      .run(row.id, row.sourceId, row.inspectionId, row.createdAt, row.updatedAt, JSON.stringify(row), row.status);
  }
  function snapshot({ sourceId, offset = 0, limit = 50 } = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'CACHE_WORKSPACE_PAGE_INVALID');
    need(sourceId === undefined || ID.test(sourceId), 'CACHE_WORKSPACE_SOURCE_INVALID');
    const condition = sourceId === undefined ? '' : ' WHERE source_id=?';
    const params = sourceId === undefined ? [] : [sourceId];
    const inspections = db.prepare('SELECT id,source_id,label,captured_at FROM inspections' + condition +
      ' ORDER BY captured_at DESC,id DESC LIMIT ? OFFSET ?').all(...params, limit, offset)
      .map(row => ({ id: row.id, sourceId: row.source_id, label: row.label, capturedAt: row.captured_at }));
    const changes = db.prepare('SELECT * FROM changes' + condition + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
      .all(...params, limit, offset).map(rowChange);
    return { ...identity(), sources: sourceRows(), inspections, changes, offset, limit,
      inspectionCount: db.prepare('SELECT count(*) AS count FROM inspections' + condition).get(...params).count,
      changeCount: db.prepare('SELECT count(*) AS count FROM changes' + condition).get(...params).count,
      activeChanges: [...active] };
  }
  async function inspect(sourceId) { return validateInspection(await send(sourceId, { op: 'inspect' })); }
  async function capture({ sourceId, expectedRevision, label = '' } = {}) {
    need(Number.isSafeInteger(expectedRevision) && text(label, 160), 'CACHE_WORKSPACE_CAPTURE_INVALID');
    const value = await inspect(sourceId), id = randomUUID(), at = now();
    transaction(expectedRevision, () => db.prepare('INSERT INTO inspections VALUES (?,?,?,?,?)')
      .run(id, sourceId, label.trim() || 'Operating snapshot', at, JSON.stringify(value)));
    return { record: inspection(id), workspace: snapshot({ sourceId }) };
  }
  function prepare({ sourceId, inspectionId, expectedRevision, route, action, policy, note = '', operationId = randomUUID(),
    restoreInspectionId } = {}) {
    source(sourceId);
    need(Number.isSafeInteger(expectedRevision) && UUID.test(operationId) && text(note) &&
      typeof route === 'string' && route.length > 0 && route.length <= 128 &&
      ['invalidate', 'configure'].includes(action), 'CACHE_WORKSPACE_CHANGE_INVALID');
    const original = inspection(inspectionId);
    need(original.sourceId === sourceId && Object.hasOwn(original.inspection.routes, route), 'CACHE_WORKSPACE_ROUTE_INVALID');
    const current = original.inspection, selected = current.routes[route];
    let patch = policy;
    if (restoreInspectionId) {
      const previous = inspection(restoreInspectionId);
      need(previous.sourceId === sourceId && action === 'configure' &&
        plain(previous.inspection.routes[route]?.limits), 'CACHE_WORKSPACE_RESTORE_POLICY_INVALID');
      patch = Object.fromEntries(retentionFields.map(key => [key, previous.inspection.routes[route].limits[key]]));
    }
    if (action === 'configure') patch = retentionPatch(patch, selected.limits ?? {});
    else need(policy === undefined && restoreInspectionId === undefined, 'CACHE_WORKSPACE_CHANGE_INVALID');
    const command = { op: 'change', operationId, expectedInstanceId: current.instanceId,
      expectedRevision: current.revision, route, action, ...(action === 'configure' ? { policy: patch } : {}) };
    const fingerprint = hash(canonical({ command, inspectionId, restoreInspectionId: restoreInspectionId ?? null }));
    const found = db.prepare('SELECT * FROM changes WHERE id=?').get(operationId);
    if (found) {
      const prior = rowChange(found);
      need(prior.fingerprint === fingerprint, 'CACHE_WORKSPACE_OPERATION_CONFLICT', 409);
      return { change: prior, workspace: snapshot({ sourceId }) };
    }
    const at = now(), row = { id: operationId, sourceId, inspectionId, createdAt: at, updatedAt: at,
      status: 'PREPARED', note, command, fingerprint, restoreInspectionId: restoreInspectionId ?? null,
      preview: { route, action, before: clone(selected.limits ?? {}),
        after: action === 'configure' ? { ...selected.limits, ...patch } : clone(selected.limits ?? {}),
        retainedEntries: (selected.stats?.cache ?? selected.stats ?? selected).entries ?? null, retainedBytes: (selected.stats?.cache ?? selected.stats ?? selected).bytes ?? null },
      attempts: 0, receipt: null, error: null };
    transaction(expectedRevision, () => saveChange(row));
    return { change: change(operationId), workspace: snapshot({ sourceId }) };
  }
  function resultRecord(id, status, values) {
    transaction(undefined, () => {
      const row = change(id);
      saveChange({ ...row, ...values, status, updatedAt: now() });
    });
    return { change: change(id), workspace: snapshot({ sourceId: change(id).sourceId }) };
  }
  function checkedReceipt(row, receipt) {
    need(plain(receipt) && receipt.schema === 'stellar-forge.response-cache-operation.v1' &&
      receipt.operationId === row.id && receipt.route === row.command.route && receipt.action === row.command.action &&
      receipt.expectedInstanceId === row.command.expectedInstanceId && receipt.expectedRevision === row.command.expectedRevision,
      'CACHE_WORKSPACE_RECEIPT_INVALID', 502);
    const observed = validateInspection(receipt.inspection);
    need(observed.instanceId === row.command.expectedInstanceId && observed.revision > row.command.expectedRevision,
      'CACHE_WORKSPACE_RECEIPT_INVALID', 502);
    return receipt;
  }
  async function dispatch(row) {
    active.add(row.id);
    try {
      const receipt = await send(row.sourceId, row.command);
      checkedReceipt(row, receipt);
      return resultRecord(row.id, 'APPLIED', { receipt, error: null });
    } catch (error) {
      const code = errorCode(error);
      const rejected = /(?:REVISION|INSTANCE|POLICY|ROUTE|RETENTION|CONFIGURATION|OPERATION_CONFLICT|REVIEW_STALE|REQUEST_INVALID|CLOSED|CONFIGURE_UNSUPPORTED)/.test(code);
      return resultRecord(row.id, rejected ? 'REJECTED' : 'PENDING', { error: code });
    } finally { active.delete(row.id); }
  }
  async function apply({ id, expectedRevision } = {}) {
    need(Number.isSafeInteger(expectedRevision), 'CACHE_WORKSPACE_REVISION_REQUIRED');
    const row = change(id);
    if (row.status === 'APPLIED') return { change: row, workspace: snapshot({ sourceId: row.sourceId }) };
    need(row.status === 'PREPARED', 'CACHE_WORKSPACE_RECOVERY_REQUIRED', 409);
    source(row.sourceId);
    transaction(expectedRevision, () => saveChange({ ...row, status: 'PENDING', updatedAt: now(), attempts: row.attempts + 1 }));
    return dispatch(change(id));
  }
  async function recover({ id, expectedRevision } = {}) {
    need(Number.isSafeInteger(expectedRevision), 'CACHE_WORKSPACE_REVISION_REQUIRED');
    const row = change(id);
    if (row.status === 'APPLIED') return { change: row, workspace: snapshot({ sourceId: row.sourceId }) };
    need(row.status === 'PENDING' && !active.has(id), 'CACHE_WORKSPACE_CHANGE_ACTIVE', 409);
    need(identity().revision === expectedRevision, 'CACHE_WORKSPACE_REVISION_CONFLICT', 409);
    active.add(id);
    try {
      const saved = await send(row.sourceId, { op: 'operation', operationId: row.id });
      if (saved?.found === true) {
        checkedReceipt(row, saved.operation);
        return resultRecord(id, 'APPLIED', { receipt: saved.operation, error: null });
      }
      const current = await inspect(row.sourceId);
      if (current.instanceId !== row.command.expectedInstanceId || current.revision !== row.command.expectedRevision)
        return resultRecord(id, 'REJECTED', { error: 'CACHE_WORKSPACE_ORIGINAL_RUNTIME_CHANGED' });
      transaction(undefined, () => saveChange({ ...change(id), attempts: row.attempts + 1, updatedAt: now() }));
    } catch (error) {
      return resultRecord(id, 'PENDING', { error: errorCode(error) });
    } finally { active.delete(id); }
    return dispatch(change(id));
  }
  function annotate({ id, expectedRevision, note } = {}) {
    need(text(note) && Number.isSafeInteger(expectedRevision), 'CACHE_WORKSPACE_NOTE_INVALID');
    transaction(expectedRevision, () => saveChange({ ...change(id), note, updatedAt: now() }));
    return { change: change(id), workspace: snapshot({ sourceId: change(id).sourceId }) };
  }
  function compare(beforeId, afterId) {
    const before = inspection(beforeId), after = inspection(afterId);
    need(before.sourceId === after.sourceId, 'CACHE_WORKSPACE_COMPARE_SOURCE_MISMATCH');
    return { sourceId: before.sourceId, before, after, comparison: difference(before.inspection, after.inspection) };
  }
  function exportWorkspace() {
    need(active.size === 0, 'CACHE_WORKSPACE_CHANGE_ACTIVE', 409);
    return { schema: EXPORT_SCHEMA, exportedAt: now(), workspace: identity(),
      sources: sourceRows().map(({ id, label }) => ({ id, label })),
      inspections: db.prepare('SELECT * FROM inspections ORDER BY captured_at,id').all().map(rowInspection),
      changes: db.prepare('SELECT * FROM changes ORDER BY created_at,id').all().map(rowChange) };
  }
  function restore(archive) {
    need(plain(archive) && archive.schema === EXPORT_SCHEMA && plain(archive.workspace) &&
      archive.workspace.schema === SCHEMA && UUID.test(archive.workspace.id ?? '') &&
      Number.isSafeInteger(archive.workspace.revision) && archive.workspace.revision >= 0 && Number.isFinite(Date.parse(archive.workspace.createdAt)) &&
      Array.isArray(archive.sources) && archive.sources.length <= 64 && Array.isArray(archive.inspections) &&
      Array.isArray(archive.changes), 'CACHE_WORKSPACE_ARCHIVE_INVALID');
    need(snapshot().inspectionCount === 0 && snapshot().changeCount === 0 && identity().revision === 0,
      'CACHE_WORKSPACE_RESTORE_REQUIRES_EMPTY', 409);
    const sourceIds = new Set(), inspectionIds = new Set(), changeIds = new Set(), reviews = new Map();
    for (const row of archive.sources) {
      need(plain(row) && ID.test(row.id ?? '') && !sourceIds.has(row.id) && text(row.label, 160),
        'CACHE_WORKSPACE_ARCHIVE_INVALID'); sourceIds.add(row.id);
    }
    for (const row of archive.inspections) {
      need(plain(row) && UUID.test(row.id ?? '') && !inspectionIds.has(row.id) && sourceIds.has(row.sourceId) &&
        text(row.label, 160) && Number.isFinite(Date.parse(row.capturedAt)), 'CACHE_WORKSPACE_ARCHIVE_INVALID');
      validateInspection(row.inspection); inspectionIds.add(row.id); reviews.set(row.id, row);
    }
    for (const row of archive.changes) {
      need(plain(row) && UUID.test(row.id ?? '') && !changeIds.has(row.id) && sourceIds.has(row.sourceId) &&
        inspectionIds.has(row.inspectionId) && plain(row.command) && row.id === row.command.operationId &&
        ['PREPARED', 'PENDING', 'APPLIED', 'REJECTED'].includes(row.status) && text(row.note) &&
        Number.isSafeInteger(row.attempts) && row.attempts >= 0 &&
        Number.isFinite(Date.parse(row.createdAt)) && Number.isFinite(Date.parse(row.updatedAt)) &&
        row.command.op === 'change' && ['invalidate', 'configure'].includes(row.command.action) &&
        Object.keys(row.command).every(key => ['op', 'operationId', 'expectedInstanceId', 'expectedRevision', 'route', 'action', 'policy'].includes(key)),
        'CACHE_WORKSPACE_ARCHIVE_INVALID');
      const review = reviews.get(row.inspectionId), selected = review.inspection.routes[row.command.route];
      need(review.sourceId === row.sourceId && selected && row.command.expectedInstanceId === review.inspection.instanceId &&
        row.command.expectedRevision === review.inspection.revision &&
        row.fingerprint === hash(canonical({ command: row.command, inspectionId: row.inspectionId, restoreInspectionId: row.restoreInspectionId ?? null })),
        'CACHE_WORKSPACE_ARCHIVE_INVALID');
      if (row.command.action === 'configure') retentionPatch(row.command.policy, selected.limits ?? {});
      else need(!Object.hasOwn(row.command, 'policy') && !row.restoreInspectionId, 'CACHE_WORKSPACE_ARCHIVE_INVALID');
      if (row.restoreInspectionId) need(reviews.get(row.restoreInspectionId)?.sourceId === row.sourceId &&
        Object.hasOwn(reviews.get(row.restoreInspectionId).inspection.routes, row.command.route), 'CACHE_WORKSPACE_ARCHIVE_INVALID');
      if (row.status === 'APPLIED') checkedReceipt(row, row.receipt);
      changeIds.add(row.id);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of archive.sources) db.prepare('INSERT INTO sources(id,label) VALUES (?,?) ON CONFLICT(id) DO NOTHING')
        .run(row.id, row.label);
      for (const row of archive.inspections) db.prepare('INSERT INTO inspections VALUES (?,?,?,?,?)')
        .run(row.id, row.sourceId, row.label, row.capturedAt, JSON.stringify(row.inspection));
      for (const row of archive.changes) saveChange(clone(row));
      db.prepare("UPDATE meta SET value=? WHERE key='workspace'").run(JSON.stringify(archive.workspace));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return snapshot();
  }
  return Object.freeze({ snapshot, inspect, capture, inspection, prepare, apply, recover, change, annotate,
    compare, exportWorkspace, restore,
    async close() {
      need(active.size === 0, 'CACHE_WORKSPACE_CHANGE_ACTIVE', 409);
      if (!closed) { closed = true; db.close(); await lease.close(); }
    },
  });
}
