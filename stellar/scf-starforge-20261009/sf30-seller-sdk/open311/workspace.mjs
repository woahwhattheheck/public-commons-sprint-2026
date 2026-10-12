import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, chmodSync, realpathSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from './client.mjs';
import { normalizeRequests, normalizeServices, compareCaptures, queryRequests } from './domain.mjs';

const WORKSPACE = 'commons.open311.workspace.v1';
const EXPORT = 'commons.open311.workspace-export.v1';
const STATES = new Set(['new', 'assigned', 'in_progress', 'done']);
const KINDS = new Set(['requests', 'request', 'services', 'service', 'token', 'discovery']);
const MAX_BUNDLE = 128 * 1024 * 1024;

export class WorkspaceError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.name = 'WorkspaceError'; this.code = code;
    this.status = status; if (details !== undefined) this.details = details;
  }
}
const fail = (code, message, status = 400, details) => { throw new WorkspaceError(code, message, status, details); };
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return fail('INVALID_JSON', 'Use finite JSON values for workspace input.');
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(canonical(value));
function operationInput(kind, value) {
  if (kind !== 'receive' || !value.bundle?.payload) return value;
  return { ...value, bundle: { schema: value.bundle.schema, payloadSha256: value.bundle.manifest.payloadSha256, payloadBytes: value.bundle.manifest.payloadBytes } };
}
const now = () => new Date().toISOString();
const parse = value => value == null ? null : JSON.parse(value);
const text = (value, name, max = 200, empty = false) => {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || value.includes('\0')) fail('INVALID_FIELD', name + ' must be a valid text value of at most ' + max + ' characters.');
  return value;
};
const id = (value, name = 'ID') => {
  text(value, name, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(value)) fail('INVALID_ID', name + ' contains unsupported characters.');
  return value;
};
function mutation(input) {
  const value = copy(input);
  id(value.requestId, 'requestId');
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) fail('EXPECTED_REVISION_REQUIRED', 'Supply the workspace revision observed before this action.');
  return value;
}
function receiptError(error) {
  return { code: String(error.code || 'SOURCE_ERROR'), message: String(error.message || 'The source request failed.'),
    status: Number.isInteger(error.status) ? error.status : 502,
    ...(error.details === undefined ? {} : { details: copy(error.details) }),
    ...(error.receipt === undefined ? {} : { receipt: copy(error.receipt) }),
    ...(error.raw === undefined ? {} : { raw: copy(error.raw) }) };
}
function throwStored(value) {
  const e = new WorkspaceError(value.code, value.message, value.status || 502, value.details);
  if (value.receipt) e.receipt = value.receipt;
  if (value.raw) e.raw = value.raw;
  throw e;
}
function processStamp(pid) {
  try { return readFileSync('/proc/' + pid + '/stat', 'utf8').replace(/^.*\) /, '').split(' ')[19]; }
  catch { return null; }
}
function activeOwner(owner) {
  if (!owner || !Number.isInteger(owner.pid)) return false;
  try { process.kill(owner.pid, 0); } catch (e) { return e.code === 'EPERM'; }
  return !owner.stamp || processStamp(owner.pid) === owner.stamp;
}
function rawBytes(raw) {
  if (!raw || raw.encoding !== 'base64' || typeof raw.body !== 'string') fail('SOURCE_BYTES_REQUIRED', 'The original source response bytes are missing.');
  if (raw.complete === false) fail('INCOMPLETE_SOURCE_RESPONSE', 'The source response ended before the original body was complete.');
  const body = Buffer.from(raw.body, 'base64');
  if (body.toString('base64') !== raw.body || raw.bytes !== body.length || raw.sha256 !== sha256(body)) fail('SOURCE_HASH_MISMATCH', 'The original response does not match its recorded length and SHA-256.');
  return body;
}
function connectionInput(input, requestId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('CONNECTION_REQUIRED', 'Supply a connection.');
  if (Object.hasOwn(input, 'apiKey')) fail('USE_ENVIRONMENT_REFERENCE', 'Configure the API key in the server environment and supply its variable name in apiKeyEnv.');
  const accepted = ['id', 'name', 'baseUrl', 'jurisdictionId', 'discoveryUrl', 'apiKeyEnv', 'apiKeyParameter', 'allowHttp', 'pagination', 'extendedAttributes', 'responseLimit', 'statusValues', 'queryExtensions', 'timeoutMs', 'maxResponseBytes', 'attribution'];
  const c = Object.fromEntries(accepted.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
  c.id = c.id ? id(c.id, 'connection.id') : 'connection-' + sha256(requestId).slice(0, 20);
  c.name = text(c.name || c.id, 'connection.name', 200);
  c.baseUrl = text(c.baseUrl, 'connection.baseUrl', 2048);
  let url; try { url = new URL(c.baseUrl); } catch { fail('INVALID_ENDPOINT', 'Supply an absolute Open311 API base URL.'); }
  if (url.username || url.password || url.search || url.hash) fail('INVALID_ENDPOINT', 'The API base URL must contain its scheme, host and path only.');
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && c.allowHttp !== true)) fail('INVALID_ENDPOINT', 'Use HTTPS, or explicitly enable HTTP for this connection.');
  c.baseUrl = url.toString().replace(/\/+$/, '');
  if (c.jurisdictionId !== undefined) text(c.jurisdictionId, 'jurisdictionId', 500, true);
  if (c.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.apiKeyEnv)) fail('INVALID_ENVIRONMENT_REFERENCE', 'apiKeyEnv must be an environment variable name.');
  if (c.apiKeyParameter !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.apiKeyParameter)) fail('INVALID_KEY_PARAMETER', 'apiKeyParameter must be a query parameter name.');
  for (const key of ['allowHttp', 'pagination', 'extendedAttributes']) if (c[key] !== undefined && typeof c[key] !== 'boolean') fail('INVALID_CONNECTION', key + ' must be true or false.');
  c.pagination = c.pagination === true; c.extendedAttributes = c.extendedAttributes === true;
  c.responseLimit ??= 1000;
  for (const key of ['responseLimit', 'timeoutMs', 'maxResponseBytes']) if (c[key] !== undefined && (!Number.isSafeInteger(c[key]) || c[key] < 1)) fail('INVALID_CONNECTION', key + ' must be a positive integer.');
  for (const key of ['statusValues', 'queryExtensions']) if (c[key] !== undefined) {
    if (!Array.isArray(c[key]) || c[key].length > 100 || c[key].some(v => typeof v !== 'string' || !v || v.length > 100)) fail('INVALID_CONNECTION', key + ' must be an array of parameter names or values.');
    c[key] = [...new Set(c[key])];
  }
  if (c.attribution !== undefined) {
    if (!c.attribution || typeof c.attribution !== 'object' || Array.isArray(c.attribution)) fail('INVALID_ATTRIBUTION', 'attribution must be an object.');
    c.attribution = Object.fromEntries(['publisher','title','license','licenseUrl','sourceUrl'].filter(key => c.attribution[key] !== undefined).map(key => [key, text(c.attribution[key], key, 2048, true)]));
  }
  return copy(c);
}
function scopeFor(connection, kind, query, resourceId) {
  const fixed = kind !== 'requests' || Boolean(query.service_request_id) || Boolean(query.start_date && query.end_date);
  return { connectionId: connection.id, baseUrl: connection.baseUrl, jurisdictionId: connection.jurisdictionId || '',
    kind, query: copy(query), resourceId: resourceId || null, fixed };
}
function normalized(kind, value, connectionId) {
  if (kind === 'requests' || kind === 'request') return normalizeRequests(value, { connectionId });
  if (kind === 'services') return normalizeServices(value);
  return [];
}

export function openWorkspace(directory, { clientFactory = createClient } = {}) {
  if (typeof directory !== 'string' || !directory) fail('WORKSPACE_REQUIRED', 'Supply a private workspace directory.');
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
  const root = realpathSync(resolve(directory));
  const path = join(root, 'open311.sqlite');
  try { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink()) fail('INVALID_DATABASE', 'The workspace database must be a regular file.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS workspace (one INTEGER PRIMARY KEY CHECK(one=1), value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id), kind TEXT NOT NULL, captured_at TEXT NOT NULL, value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS request_rows (capture_id TEXT NOT NULL REFERENCES captures(id), request_id TEXT NOT NULL, connection_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(capture_id,request_id));',
    'CREATE INDEX IF NOT EXISTS request_identity ON request_rows(connection_id,request_id);',
    'CREATE TABLE IF NOT EXISTS reviews (connection_id TEXT NOT NULL, request_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(connection_id,request_id));',
    'CREATE TABLE IF NOT EXISTS operations (request_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, intent TEXT NOT NULL, result TEXT, error TEXT, staged TEXT, owner TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);'
  ].join('\n'));
  db.prepare('INSERT OR IGNORE INTO workspace(one,value) VALUES(1,?)').run(canonical({ schema: WORKSPACE, workspaceId: randomUUID(), revision: 0, createdAt: now() }));
  let closed = false;
  const inflight = new Set();
  const owner = { pid: process.pid, stamp: processStamp(process.pid) };
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const meta = () => parse(get('SELECT value FROM workspace WHERE one=1').value);
  const saveMeta = value => run('UPDATE workspace SET value=? WHERE one=1', canonical(value));
  function transaction(fn, write = true) {
    if (closed) fail('WORKSPACE_CLOSED', 'This workspace is closed.', 409);
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  function originalOperation(requestId) {
    const row = get('SELECT * FROM operations WHERE request_id=?', requestId);
    if (!row) return null;
    return { requestId, payloadHash: row.payload_hash, kind: row.kind, state: row.state,
      intent: parse(row.intent), result: parse(row.result), error: parse(row.error),
      staged: parse(row.staged), owner: parse(row.owner), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function expected(input, metadata = meta()) {
    if (input.expectedRevision !== metadata.revision) fail('REVISION_CONFLICT', 'The workspace changed. Reload it before preparing another action.', 409, { expectedRevision: input.expectedRevision, actualRevision: metadata.revision, workspaceId: metadata.workspaceId });
    return metadata;
  }
  function previous(kind, input) {
    const hash = sha256(canonical({ kind, input: operationInput(kind, input) }));
    const op = originalOperation(input.requestId);
    if (op && (op.payloadHash !== hash || op.kind !== kind)) fail('REQUEST_ID_CONFLICT', 'This request ID belongs to a different saved action.', 409, { requestId: input.requestId });
    return { op, hash };
  }
  function commitOperation(kind, input, hash, value, started = now()) {
    const metadata = meta(); metadata.revision += 1; saveMeta(metadata);
    const result = { workspaceId: metadata.workspaceId, revision: metadata.revision, requestId: input.requestId, ...value };
    run('INSERT INTO operations(request_id,payload_hash,kind,state,intent,result,error,staged,owner,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?,?) ON CONFLICT(request_id) DO UPDATE SET state=excluded.state,result=excluded.result,error=NULL,staged=NULL,owner=NULL,updated_at=excluded.updated_at',
      input.requestId, hash, kind, 'SUCCEEDED', canonical(operationInput(kind, input)), canonical(result), started, now());
    return result;
  }
  function mutate(kind, supplied, action) {
    const input = mutation(supplied);
    return transaction(() => {
      const { op, hash } = previous(kind, input);
      if (op?.state === 'SUCCEEDED') return op.result;
      if (op) fail('OPERATION_PENDING', 'This action has a retained operation. Inspect it before continuing.', 409, { requestId: input.requestId, state: op.state });
      expected(input);
      return commitOperation(kind, input, hash, action(input));
    });
  }
  const connection = connectionId => {
    const found = get('SELECT value FROM connections WHERE id=?', connectionId);
    if (!found) fail('CONNECTION_NOT_FOUND', 'The selected connection was not found.', 404);
    return parse(found.value);
  };
  const captureRecord = captureId => {
    const found = get('SELECT value FROM captures WHERE id=?', captureId);
    if (!found) fail('CAPTURE_NOT_FOUND', 'The selected capture was not found.', 404);
    return parse(found.value);
  };
  const reviewRecord = (connectionId, requestId) => parse(get('SELECT value FROM reviews WHERE connection_id=? AND request_id=?', connectionId, requestId)?.value);
  function attachReview(row) {
    const review = reviewRecord(row.connectionId, row.serviceRequestId);
    return { ...row, review: review ? { ...review, needsReview: review.sourceSha256 !== row.sourceSha256 } : null };
  }
  function state() {
    return transaction(() => {
      const m = meta();
      const captures = all('SELECT value FROM captures ORDER BY captured_at DESC,id DESC').map(row => parse(row.value).capture);
      const reviews = all('SELECT value FROM reviews ORDER BY connection_id,request_id').map(row => parse(row.value));
      return { ...m, connections: all('SELECT value FROM connections ORDER BY id').map(row => parse(row.value)),
        captures, reviews,
        operations: all('SELECT request_id,kind,state,created_at,updated_at FROM operations ORDER BY updated_at DESC,request_id DESC LIMIT 20').map(o => ({
          requestId: o.request_id, kind: o.kind, state: o.state, createdAt: o.created_at, updatedAt: o.updated_at })) };
    }, false);
  }
  function putConnection(supplied) {
    return mutate('connection', supplied, input => {
      const c = connectionInput(input.connection, input.requestId);
      clientFactory(c);
      const old = get('SELECT value FROM connections WHERE id=?', c.id);
      if (old && get('SELECT id FROM captures WHERE connection_id=? LIMIT 1', c.id)) {
        const prior = parse(old.value);
        if (prior.baseUrl !== c.baseUrl || (prior.jurisdictionId || '') !== (c.jurisdictionId || '')) fail('CONNECTION_IDENTITY_IN_USE', 'Create a new connection ID for a different endpoint or jurisdiction. Existing captures keep their original identity.', 409);
      }
      run('INSERT INTO connections(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', c.id, canonical(c));
      return { connection: c };
    });
  }
  function finishCapture(input) {
    return transaction(() => {
      const { op, hash } = previous('capture', input);
      if (op?.state === 'SUCCEEDED') return op.result;
      if (!op || op.state !== 'FETCHED' || !op.staged) fail('CAPTURE_NOT_READY', 'The original source response is not yet saved.', 409);
      const { selected, result } = op.staged;
      rawBytes(result.raw);
      const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(result.raw.body, 'base64')));
      if (canonical(decoded) !== canonical(result.value)) fail('SOURCE_VALUE_MISMATCH', 'The decoded response differs from the original source bytes.');
      const rows = normalized(selected.kind, result.value, selected.connection.id);
      const capturedAt = result.receipt.observedAt || now();
      const captureId = 'capture-' + sha256(input.requestId).slice(0, 24);
      const unique = new Set();
      if (selected.kind === 'requests' || selected.kind === 'request') for (const row of rows) {
        if (unique.has(row.serviceRequestId)) fail('DUPLICATE_SOURCE_ID', 'A response contains multiple rows with the same service request ID.');
        unique.add(row.serviceRequestId);
      }
      const actualQuery = copy(result.receipt.query ?? selected.query);
      const limit = result.receipt.coverage?.documentedLimit ?? Math.min(Number(actualQuery.page_size || selected.connection.responseLimit || 1000), Number(selected.connection.responseLimit || 1000));
      if (!Number.isSafeInteger(limit) || limit < 1) fail('INVALID_SOURCE_LIMIT', 'The retained source limit must be a positive integer.');
      const saturated = (selected.kind === 'requests') && rows.length >= Number(limit);
      const capture = { id: captureId, connectionId: selected.connection.id, kind: selected.kind,
        query: actualQuery, requestedQuery: selected.query, resourceId: selected.resourceId || null, capturedAt, rowCount: rows.length,
        scope: scopeFor(selected.connection, selected.kind, actualQuery, selected.resourceId),
        complete: !saturated, saturated, responseLimit: Number(limit),
        statuses: [...new Set(rows.map(row => row.status).filter(Boolean))].sort(),
        sourceSha256: result.raw.sha256, sourceBytes: result.raw.bytes, receipt: result.receipt,
        connection: selected.connection };
      const record = { capture, value: result.value, raw: result.raw, receipt: result.receipt };
      run('INSERT INTO captures(id,connection_id,kind,captured_at,value) VALUES(?,?,?,?,?)', captureId, selected.connection.id, selected.kind, capturedAt, canonical(record));
      if (selected.kind === 'requests' || selected.kind === 'request') for (const row of rows) {
        run('INSERT INTO request_rows(capture_id,request_id,connection_id,value) VALUES(?,?,?,?)', captureId, row.serviceRequestId, selected.connection.id, canonical(row));
      }
      return commitOperation('capture', input, hash, { capture }, op.createdAt);
    });
  }
  async function capture(supplied) {
    const input = mutation(supplied);
    input.kind ??= 'requests'; input.query ??= {};
    if (!KINDS.has(input.kind)) fail('INVALID_CAPTURE_KIND', 'Choose a supported Open311 source resource.');
    if (!input.query || typeof input.query !== 'object' || Array.isArray(input.query)) fail('INVALID_QUERY', 'A source query must be a JSON object.');
    id(input.connectionId, 'connectionId');
    if (['request', 'service', 'token'].includes(input.kind)) text(input.resourceId, 'resourceId', 500);
    const prepared = transaction(() => {
      const { op, hash } = previous('capture', input);
      if (op?.state === 'SUCCEEDED') return { result: op.result };
      if (op?.state === 'FETCHED') return { fetched: true };
      if (op?.state === 'FAILED') return { error: op.error };
      if (op?.state === 'FETCHING' && (inflight.has(input.requestId) || activeOwner(op.owner))) fail('OPERATION_RUNNING', 'The original source request is still running.', 409, { requestId: input.requestId });
      const selected = op ? op.intent.selected : { connection: copy(connection(input.connectionId)), kind: input.kind, query: copy(input.query), resourceId: input.resourceId || null };
      if (!op) expected(input);
      const intent = { ...input, selected };
      run('INSERT INTO operations(request_id,payload_hash,kind,state,intent,result,error,staged,owner,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?,?) ON CONFLICT(request_id) DO UPDATE SET state=excluded.state,owner=excluded.owner,updated_at=excluded.updated_at',
        input.requestId, hash, 'capture', 'FETCHING', canonical(intent), canonical(owner), op?.createdAt || now(), now());
      return { selected };
    });
    if (prepared.result) return prepared.result;
    if (prepared.error) return throwStored(prepared.error);
    if (prepared.fetched) return finishCapture(input);
    inflight.add(input.requestId);
    try {
      const { selected } = prepared;
      const client = clientFactory(selected.connection);
      let result;
      if (selected.kind === 'requests') result = await client.requests(selected.query);
      else if (selected.kind === 'services') result = await client.services(selected.query);
      else if (selected.kind === 'service') result = await client.service(selected.resourceId, selected.query);
      else if (selected.kind === 'request') result = await client.request(selected.resourceId, selected.query);
      else if (selected.kind === 'token') result = await client.token(selected.resourceId, selected.query);
      else result = await client.discovery();
      transaction(() => run('UPDATE operations SET state=?,staged=?,owner=NULL,updated_at=? WHERE request_id=?',
        'FETCHED', canonical({ selected, result }), now(), input.requestId));
      return finishCapture(input);
    } catch (error) {
      const saved = receiptError(error);
      transaction(() => {
        const op = originalOperation(input.requestId);
        if (op?.staged?.result) {
          saved.raw ??= copy(op.staged.result.raw);
          saved.receipt ??= copy(op.staged.result.receipt);
        }
        if (op?.state !== 'SUCCEEDED') run('UPDATE operations SET state=?,error=?,owner=NULL,updated_at=? WHERE request_id=?',
          'FAILED', canonical(saved), now(), input.requestId);
      });
      throwStored(saved);
    } finally { inflight.delete(input.requestId); }
  }
  function requests(filter = {}) {
    return transaction(() => {
      const captureId = filter.capture;
      if (!captureId) fail('CAPTURE_REQUIRED', 'Select a saved request capture.');
      const saved = captureRecord(captureId);
      if (!['requests', 'request'].includes(saved.capture.kind)) return { items: [], total: 0, offset: 0, limit: Number(filter.limit) || 50 };
      const rows = all('SELECT value FROM request_rows WHERE capture_id=? ORDER BY request_id', captureId).map(row => attachReview(parse(row.value)));
      return queryRequests(rows, filter);
    }, false);
  }
  function request(filter = {}) {
    return transaction(() => {
      text(filter.id, 'service request ID', 500);
      let row, connectionId = filter.connection;
      if (filter.capture) {
        const c = captureRecord(filter.capture); connectionId = c.capture.connectionId;
        row = get('SELECT value FROM request_rows WHERE capture_id=? AND request_id=?', filter.capture, filter.id);
      } else {
        if (!connectionId) fail('CONNECTION_REQUIRED', 'Select a connection or capture.');
        row = get('SELECT r.value FROM request_rows r JOIN captures c ON c.id=r.capture_id WHERE r.connection_id=? AND r.request_id=? ORDER BY c.captured_at DESC,c.id DESC LIMIT 1', connectionId, filter.id);
      }
      if (!row) fail('REQUEST_NOT_FOUND', 'This service request is not present in the selected saved source.', 404);
      const item = attachReview(parse(row.value));
      const history = all('SELECT c.id,c.captured_at,r.value FROM request_rows r JOIN captures c ON c.id=r.capture_id WHERE r.connection_id=? AND r.request_id=? ORDER BY c.captured_at DESC,c.id DESC', connectionId, filter.id)
        .map(entry => ({ captureId: entry.id, capturedAt: entry.captured_at, item: parse(entry.value) }));
      return { item, history, review: item.review };
    }, false);
  }
  function putReview(supplied) {
    return mutate('review', supplied, input => {
      id(input.connectionId, 'connectionId'); text(input.serviceRequestId, 'serviceRequestId', 500);
      const latest = get('SELECT r.value,c.id FROM request_rows r JOIN captures c ON c.id=r.capture_id WHERE r.connection_id=? AND r.request_id=? ORDER BY c.captured_at DESC,c.id DESC LIMIT 1', input.connectionId, input.serviceRequestId);
      if (!latest) fail('REQUEST_NOT_FOUND', 'Capture the service request before assigning its internal review.', 404);
      const row = parse(latest.value), old = reviewRecord(input.connectionId, input.serviceRequestId);
      const review = input.review || {};
      const status = review.status ?? old?.status ?? 'new';
      if (!STATES.has(status)) fail('INVALID_REVIEW_STATUS', 'Choose new, assigned, in_progress or done for the internal review.');
      const assignee = text(review.assignee ?? old?.assignee ?? '', 'assignee', 200, true);
      const note = text(review.note ?? old?.note ?? '', 'note', 8000, true);
      const dueDate = text(review.dueDate ?? old?.dueDate ?? '', 'dueDate', 10, true);
      if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate + 'T00:00:00Z')) || new Date(dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== dueDate)) fail('INVALID_DUE_DATE', 'Use a valid YYYY-MM-DD due date.');
      const entry = { requestId: input.requestId, status, assignee, note, dueDate, updatedAt: now(), sourceSha256: row.sourceSha256, captureId: latest.id };
      const value = { connectionId: input.connectionId, serviceRequestId: input.serviceRequestId, ...entry, history: [...(old?.history || []), entry] };
      run('INSERT INTO reviews(connection_id,request_id,value) VALUES(?,?,?) ON CONFLICT(connection_id,request_id) DO UPDATE SET value=excluded.value', input.connectionId, input.serviceRequestId, canonical(value));
      return { review: value };
    });
  }
  function captureInfo({ id: captureId }) {
    return transaction(() => {
      const record = captureRecord(captureId);
      const items = normalized(record.capture.kind, record.value, record.capture.connectionId).map(row => ['requests', 'request'].includes(record.capture.kind) ? attachReview(row) : row);
      return { ...record, items };
    }, false);
  }
  function services({ connection: connectionId }) {
    return transaction(() => {
      connection(connectionId);
      const row = get('SELECT value FROM captures WHERE connection_id=? AND kind=? ORDER BY captured_at DESC,id DESC LIMIT 1', connectionId, 'services');
      if (!row) return { items: [], capture: null };
      const record = parse(row.value);
      return { items: normalizeServices(record.value), capture: record.capture };
    }, false);
  }
  function diff({ before, after }) {
    return transaction(() => {
      const a = captureRecord(before), b = captureRecord(after);
      if (!['requests', 'request'].includes(a.capture.kind) || !['requests', 'request'].includes(b.capture.kind)) fail('REQUEST_CAPTURES_REQUIRED', 'Choose two service-request captures.');
      if (a.capture.connectionId !== b.capture.connectionId) fail('DIFFERENT_JURISDICTIONS', 'Compare captures from the same connection.');
      const x = { ...a.capture, rows: all('SELECT value FROM request_rows WHERE capture_id=?', before).map(row => parse(row.value)) };
      const y = { ...b.capture, rows: all('SELECT value FROM request_rows WHERE capture_id=?', after).map(row => parse(row.value)) };
      const result = compareCaptures(x, y);
      if (!x.scope.fixed || !y.scope.fixed || !x.complete || !y.complete) { result.scopeComparable = false; result.missingFromCapture = []; }
      return { before: x.id, after: y.id, ...result };
    }, false);
  }
  function operation(requestId) {
    id(requestId, 'requestId');
    return transaction(() => {
      const op = originalOperation(requestId);
      if (!op) fail('OPERATION_NOT_FOUND', 'No saved action has this request ID.', 404);
      const { staged, owner: ignored, intent, ...publicValue } = op;
      return publicValue;
    }, false);
  }
  function exportWorkspace() {
    return transaction(() => {
      const running = get('SELECT request_id FROM operations WHERE state IN (?,?) LIMIT 1', 'FETCHING', 'FETCHED');
      if (running) fail('SOURCE_CAPTURE_IN_PROGRESS', 'Finish or recover the current source capture before exporting the complete workspace.', 409, { requestId: running.request_id });
      const payload = { workspace: meta(),
        connections: all('SELECT value FROM connections ORDER BY id').map(row => parse(row.value)),
        captures: all('SELECT value FROM captures ORDER BY captured_at,id').map(row => parse(row.value)),
        reviews: all('SELECT value FROM reviews ORDER BY connection_id,request_id').map(row => parse(row.value)),
        operations: all('SELECT * FROM operations ORDER BY created_at,request_id').map(row => ({
          requestId: row.request_id, payloadHash: row.payload_hash, kind: row.kind, state: row.state,
          intent: parse(row.intent), result: parse(row.result), error: parse(row.error), createdAt: row.created_at, updatedAt: row.updated_at
        })) };
      const json = canonical(payload);
      if (Buffer.byteLength(json) > MAX_BUNDLE) fail('WORKSPACE_EXPORT_SIZE', 'This workspace exceeds the 128 MiB portable JSON edition. Export its individual captures for this delivery.', 413);
      const editionAt = [payload.workspace.createdAt, ...payload.operations.map(op => op.updatedAt), ...payload.captures.map(c => c.capture.capturedAt)].filter(Boolean).sort().at(-1);
      return { schema: EXPORT, exportedAt: editionAt, payload, manifest: { algorithm: 'sha256', payloadSha256: sha256(json), payloadBytes: Buffer.byteLength(json),
        connectionCount: payload.connections.length, captureCount: payload.captures.length, reviewCount: payload.reviews.length, operationCount: payload.operations.length } };
    }, false);
  }
  function exportValue({ kind = 'workspace', capture: captureId } = {}) {
    if (kind === 'workspace') {
      const bundle = exportWorkspace();
      return { filename: 'open311-workspace-' + bundle.payload.workspace.workspaceId + '.json', contentType: 'application/json; charset=utf-8', body: canonical(bundle) + '\n' };
    }
    const saved = captureInfo({ id: captureId });
    if (kind === 'source') return { filename: 'original-' + captureId + '.json', contentType: saved.raw.contentType || 'application/json; charset=utf-8', body: rawBytes(saved.raw) };
    if (kind === 'json') return { filename: 'open311-' + captureId + '.json', contentType: 'application/json; charset=utf-8', body: JSON.stringify({ schema: 'commons.open311.capture-export.v1', ...saved }, null, 2) + '\n' };
    if (!['csv', 'report'].includes(kind)) fail('INVALID_EXPORT_KIND', 'Choose workspace, source, json, csv or report.');
    const items = saved.items;
    const columns = ['serviceRequestId', 'serviceCode', 'serviceName', 'status', 'requestedAt', 'updatedAt', 'expectedAt', 'agency', 'address', 'description', 'assignee', 'reviewStatus', 'dueDate', 'reviewNote'];
    const csvCell = v => {
      let s = v == null ? '' : String(v);
      if (/^[\u0000-\u0020]*[=+@\-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    if (kind === 'csv') {
      const body = [columns.map(csvCell).join(','), ...items.map(item => columns.map(key => csvCell(({ assignee: item.review?.assignee, reviewStatus: item.review?.status, dueDate: item.review?.dueDate, reviewNote: item.review?.note })[key] ?? item[key])).join(','))].join('\r\n') + '\r\n';
      return { filename: 'open311-' + captureId + '.csv', contentType: 'text/csv; charset=utf-8', body };
    }
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const body = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Open311 service operations report</title><style>body{font:15px/1.5 system-ui;margin:36px;color:#1a1a1a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;word-break:break-word}.meta{color:#555}@media print{body{margin:14mm}thead{display:table-header-group}tr{break-inside:avoid}}</style><h1>Service operations report</h1><p>' + escape(saved.capture.connection.name) + '</p><p>' + escape([saved.capture.connection.attribution?.publisher, saved.capture.connection.attribution?.title, saved.capture.connection.attribution?.license, saved.capture.connection.attribution?.licenseUrl, saved.capture.connection.attribution?.sourceUrl].filter(Boolean).join(' · ')) + '</p><p class="meta">Captured ' + escape(saved.capture.capturedAt) + ' · ' + items.length + ' source rows</p><p>Source: ' + escape(saved.receipt.url) + '</p><p>Response SHA-256: ' + escape(saved.raw.sha256) + '</p><pre>' + escape(JSON.stringify(saved.capture.query, null, 2)) + '</pre><table><thead><tr><th>Request</th><th>Source status</th><th>Service and location</th><th>Internal review</th></tr></thead><tbody>' + items.map(item => '<tr><td>' + escape(item.serviceRequestId || item.serviceCode || item.id) + '<br>' + escape(item.updatedAt) + '</td><td>' + escape(item.status) + '</td><td><strong>' + escape(item.serviceName) + '</strong><br>' + escape(item.address) + '<p>' + escape(item.description) + '</p></td><td>' + escape(item.review?.status || 'new') + '<br>' + escape(item.review?.assignee) + '<br>' + escape(item.review?.dueDate) + '<p>' + escape(item.review?.note) + '</p></td></tr>').join('') + '</tbody></table></html>';
    return { filename: 'open311-' + captureId + '.html', contentType: 'text/html; charset=utf-8', body };
  }
  function receive(supplied) {
    const input = mutation(supplied), bundle = input.bundle;
    if (!bundle || bundle.schema !== EXPORT || !bundle.payload || !bundle.manifest) fail('INVALID_WORKSPACE_EXPORT', 'Select a complete Open311 workspace export.');
    const encoded = canonical(bundle.payload);
    if (Buffer.byteLength(encoded) > MAX_BUNDLE) fail('WORKSPACE_EXPORT_SIZE', 'The portable workspace exceeds 128 MiB.', 413);
    if (sha256(encoded) !== bundle.manifest.payloadSha256 || Buffer.byteLength(encoded) !== bundle.manifest.payloadBytes) fail('WORKSPACE_HASH_MISMATCH', 'The workspace payload differs from its manifest.');
    const payload = copy(bundle.payload);
    if (payload.workspace?.schema !== WORKSPACE || !Number.isSafeInteger(payload.workspace.revision) || payload.workspace.revision < 0) fail('INVALID_WORKSPACE_EXPORT', 'The source workspace metadata is invalid.');
    id(payload.workspace.workspaceId, 'source workspace ID');
    for (const [field, count] of [['connections', 'connectionCount'], ['captures', 'captureCount'], ['reviews', 'reviewCount'], ['operations', 'operationCount']]) {
      if (!Array.isArray(payload[field]) || payload[field].length !== bundle.manifest[count]) fail('WORKSPACE_COUNT_MISMATCH', 'The workspace ' + field + ' inventory differs from its manifest.');
    }
    const connections = new Map(), captureIds = new Set(), reviewIds = new Set(), operationIds = new Set();
    for (const c of payload.connections) {
      const checked = connectionInput(c, c.id);
      if (canonical(c) !== canonical(checked) || connections.has(c.id)) fail('INVALID_SOURCE_CONNECTION', 'An exported connection is invalid or duplicated.');
      connections.set(c.id, c);
    }
    const rowsByCapture = new Map();
    for (const c of payload.captures) {
      const info = c.capture;
      if (!info || !KINDS.has(info.kind) || !connections.has(info.connectionId) || captureIds.has(info.id)) fail('INVALID_SOURCE_CAPTURE', 'An exported capture is invalid or duplicated.');
      id(info.id, 'capture ID'); captureIds.add(info.id);
      const body = rawBytes(c.raw);
      let decoded; try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { fail('INVALID_SOURCE_JSON', 'A source capture does not contain valid JSON.'); }
      if (canonical(decoded) !== canonical(c.value) || info.sourceSha256 !== c.raw.sha256 || info.sourceBytes !== body.length) fail('SOURCE_VALUE_MISMATCH', 'An exported capture differs from its original source.');
      if (canonical(scopeFor(info.connection, info.kind, info.query, info.resourceId)) !== canonical(info.scope)) fail('SOURCE_SCOPE_MISMATCH', 'A capture scope differs from its retained query.');
      const currentConnection = connections.get(info.connectionId);
      if (info.connection?.baseUrl !== currentConnection.baseUrl || (info.connection?.jurisdictionId || '') !== (currentConnection.jurisdictionId || '')) fail('SOURCE_CONNECTION_MISMATCH', 'A capture belongs to a different endpoint or jurisdiction.');
      const rows = normalized(info.kind, c.value, info.connectionId);
      if (info.rowCount !== rows.length) fail('SOURCE_ROW_COUNT_MISMATCH', 'A capture count differs from its original source.');
      const identities = new Set();
      if (['request', 'requests'].includes(info.kind)) for (const row of rows) {
        if (identities.has(row.serviceRequestId)) fail('DUPLICATE_SOURCE_ID', 'An exported response repeats a service request ID.');
        identities.add(row.serviceRequestId);
      }
      rowsByCapture.set(info.id, rows);
    }
    const sourceIdentities = new Set();
    for (const [captureId, rows] of rowsByCapture) for (const row of rows) if (row.serviceRequestId) sourceIdentities.add(canonical([row.connectionId, row.serviceRequestId]));
    for (const review of payload.reviews) {
      const key = canonical([review.connectionId, review.serviceRequestId]);
      if (reviewIds.has(key) || !sourceIdentities.has(key) || !STATES.has(review.status) || !Array.isArray(review.history)) fail('INVALID_SOURCE_REVIEW', 'An exported review has no corresponding source request or contains invalid history.');
      reviewIds.add(key);
      for (const entry of review.history) if (!STATES.has(entry.status) || !captureIds.has(entry.captureId)) fail('INVALID_SOURCE_REVIEW', 'An exported review history refers to an unavailable capture.');
    }
    for (const op of payload.operations) {
      id(op.requestId, 'operation ID');
      if (operationIds.has(op.requestId) || !['SUCCEEDED', 'FAILED'].includes(op.state) || op.requestId === input.requestId) fail('INVALID_SOURCE_OPERATION', 'The workspace contains a duplicate, pending or conflicting operation.');
      if (!op.intent || sha256(canonical({ kind: op.kind, input: operationInput(op.kind, op.kind === 'capture' ? Object.fromEntries(Object.entries(op.intent).filter(([key]) => key !== 'selected')) : op.intent) })) !== op.payloadHash) fail('SOURCE_OPERATION_MISMATCH', 'An exported operation does not match its original request.');
      if (op.state === 'SUCCEEDED' && (!op.result || op.result.workspaceId !== payload.workspace.workspaceId || op.result.requestId !== op.requestId || !Number.isSafeInteger(op.result.revision) || op.result.revision > payload.workspace.revision)) fail('SOURCE_OPERATION_RESULT_MISMATCH', 'An exported result belongs to a different workspace or revision.');
      operationIds.add(op.requestId);
    }
    return mutate('receive', input, () => {
      if (get('SELECT id FROM connections LIMIT 1') || get('SELECT id FROM captures LIMIT 1') || get('SELECT request_id FROM operations LIMIT 1')) fail('DESTINATION_NOT_EMPTY', 'Open a new empty workspace directory to receive this complete customer workspace.', 409);
      saveMeta(payload.workspace);
      for (const c of payload.connections) run('INSERT INTO connections(id,value) VALUES(?,?)', c.id, canonical(c));
      for (const c of payload.captures) {
        const info = c.capture;
        run('INSERT INTO captures(id,connection_id,kind,captured_at,value) VALUES(?,?,?,?,?)', info.id, info.connectionId, info.kind, info.capturedAt, canonical(c));
        if (['request', 'requests'].includes(info.kind)) for (const row of rowsByCapture.get(info.id)) run('INSERT INTO request_rows(capture_id,request_id,connection_id,value) VALUES(?,?,?,?)', info.id, row.serviceRequestId, info.connectionId, canonical(row));
      }
      for (const r of payload.reviews) run('INSERT INTO reviews(connection_id,request_id,value) VALUES(?,?,?)', r.connectionId, r.serviceRequestId, canonical(r));
      for (const op of payload.operations) run('INSERT INTO operations(request_id,payload_hash,kind,state,intent,result,error,staged,owner,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?)',
        op.requestId, op.payloadHash, op.kind, op.state, canonical(op.intent), op.result == null ? null : canonical(op.result), op.error == null ? null : canonical(op.error), op.createdAt, op.updatedAt);
      return { received: { workspaceId: payload.workspace.workspaceId, sourceRevision: payload.workspace.revision, payloadSha256: bundle.manifest.payloadSha256,
        connections: payload.connections.length, captures: payload.captures.length, reviews: payload.reviews.length } };
    });
  }
  function close() {
    if (closed) return;
    if (inflight.size) fail('CAPTURE_IN_PROGRESS', 'Wait for the current source capture before closing this workspace.', 409);
    db.close(); closed = true;
  }
  return { directory: root, state, putConnection, capture, putReview, requests, request, services, captureInfo, diff, operation, export: exportValue, receive, close };
}
