// MIT. Durable operator state for the original OpenSearch seller workspace.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, lstat, open, chmod, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class WorkspaceError extends Error {
  constructor(code, message = code, status = 422) { super(message); this.code = code; this.status = status; }
}
export const clone = value => JSON.parse(JSON.stringify(value));
export function canonical(value, depth = 0) {
  if (depth > 64) throw new WorkspaceError('WORKSPACE_JSON_TOO_DEEP');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(x => canonical(x, depth + 1)).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const now = () => new Date().toISOString();
export function identifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
    throw new WorkspaceError('WORKSPACE_INVALID_IDENTIFIER', 'Invalid ' + label + '.');
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceError('WORKSPACE_OBJECT_REQUIRED', label + ' must be an object.');
  if (Buffer.byteLength(JSON.stringify(value)) > 262144)
    throw new WorkspaceError('WORKSPACE_DRAFT_TOO_LARGE', label + ' exceeds 256 KiB.');
  canonical(value);
  return clone(value);
}
const parsed = row => row ? JSON.parse(row.record_json) : null;
const LIVE_INSTANCES = new Set();
function processStamp(pid) {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19] ?? null;
  } catch { return null; }
}
function ownerEnded(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
  if (owner.pid === process.pid && owner.stamp === processStamp(process.pid))
    return !LIVE_INSTANCES.has(owner.instance);
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  const current = processStamp(owner.pid);
  return Boolean(owner.stamp && current && owner.stamp !== current);
}

export async function openWorkspaceStore(directory, profileHash) {
  if (typeof directory !== 'string' || !directory) throw new WorkspaceError('WORKSPACE_DIRECTORY_REQUIRED');
  const selected = resolve(directory);
  await mkdir(selected, { recursive: true, mode: 0o700 });
  if ((await lstat(selected)).isSymbolicLink()) throw new WorkspaceError('WORKSPACE_DIRECTORY_SYMLINK');
  const root = await realpath(selected);
  await chmod(root, 0o700);
  const filename = join(root, 'workspace.sqlite3');
  try { const file = await open(filename, 'wx', 0o600); await file.close(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(filename)).isFile() || (await lstat(filename)).isSymbolicLink())
    throw new WorkspaceError('WORKSPACE_DATABASE_INVALID');
  await chmod(filename, 0o600);
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS draft_history (draft_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(draft_id,revision));' +
      'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_sha256 TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, record_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL, created_at TEXT NOT NULL, result_sha256 TEXT NOT NULL, result_json TEXT NOT NULL, record_json TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL, created_at TEXT NOT NULL, record_json TEXT NOT NULL);'
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT value FROM meta WHERE key=?').get('source_profile_sha256');
      if (existing && existing.value !== profileHash)
        throw new WorkspaceError('WORKSPACE_SOURCE_PROFILE_CHANGED', 'Use this workspace with its original source connection profile, or select a new workspace directory.', 409);
      db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('source_profile_sha256', profileHash);
      db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('workspace_id', randomUUID());
      db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('schema', 'stellar-forge.opensearch-workspace.v1');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) { db.close(); throw error; }
  return new WorkspaceStore(db, root, profileHash);
}

class WorkspaceStore {
  constructor(db, directory, profileHash) {
    this.db = db; this.directory = directory; this.profileHash = profileHash;
    this.owner = { pid: process.pid, stamp: processStamp(process.pid), instance: randomUUID() };
    LIVE_INSTANCES.add(this.owner.instance);
    this.id = db.prepare('SELECT value FROM meta WHERE key=?').get('workspace_id').value;
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  draft(id, revision) {
    const value = parsed(this.db.prepare('SELECT record_json FROM drafts WHERE id=?').get(identifier(id)));
    if (!value) throw new WorkspaceError('WORKSPACE_DRAFT_NOT_FOUND', 'Draft not found.', 404);
    if (revision !== undefined && revision !== value.revision)
      throw new WorkspaceError('WORKSPACE_DRAFT_CHANGED', 'The saved draft changed. Reopen it before applying this action.', 409);
    return value;
  }
  operation(id) {
    this.recoverInterrupted();
    const value = parsed(this.db.prepare('SELECT record_json FROM operations WHERE id=?').get(identifier(id, 'request ID')));
    if (!value) throw new WorkspaceError('WORKSPACE_OPERATION_NOT_FOUND', 'Request not found.', 404);
    return value;
  }
  recoverInterrupted() {
    for (const row of this.db.prepare("SELECT record_json FROM operations WHERE state='RUNNING'").all()) {
      const operation = JSON.parse(row.record_json);
      if (!ownerEnded(operation.owner)) continue;
      const changed = { ...operation, state: 'INTERRUPTED', updatedAt: now(),
        error: { code: 'WORKSPACE_OPERATION_INTERRUPTED',
          message: 'The original operator process ended before saving this result. Its exact request and any prepared files are retained. Start a new explicit operation when ready.' } };
      this.db.prepare("UPDATE operations SET state='INTERRUPTED',updated_at=?,record_json=? WHERE id=? AND state='RUNNING'")
        .run(changed.updatedAt, JSON.stringify(changed), changed.id);
    }
  }
  writeOperation(record) {
    this.db.prepare('UPDATE operations SET state=?,updated_at=?,record_json=? WHERE id=?')
      .run(record.state, record.updatedAt, JSON.stringify(record), record.id);
    return clone(record);
  }
  reserve(kind, request) {
    identifier(request.requestId, 'request ID');
    const requestHash = digest(request);
    const previous = this.db.prepare('SELECT request_sha256,record_json FROM operations WHERE id=?').get(request.requestId);
    if (previous) {
      if (previous.request_sha256 !== requestHash || JSON.parse(previous.record_json).kind !== kind)
        throw new WorkspaceError('WORKSPACE_REQUEST_REUSED', 'This request ID already belongs to different saved input.', 409);
      return { existing: true, operation: JSON.parse(previous.record_json) };
    }
    const at = now();
    const record = { id: request.requestId, kind, state: 'RUNNING', createdAt: at, updatedAt: at,
      requestSha256: requestHash, request: clone(request), owner: this.owner };
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)')
      .run(record.id, kind, requestHash, record.state, at, at, JSON.stringify(record));
    return { existing: false, operation: record };
  }
  saveDraft(request) {
    return this.transaction(() => {
      const reserved = this.reserve('save-draft', request);
      if (reserved.existing) return reserved.operation;
      const title = typeof request.title === 'string' ? request.title.trim() : '';
      if (!title || title.length > 120) throw new WorkspaceError('WORKSPACE_TITLE_REQUIRED', 'Use a title of 1–120 characters.');
      if (typeof request.queryName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(request.queryName) ||
          ['__proto__', 'constructor', 'prototype'].includes(request.queryName))
        throw new WorkspaceError('WORKSPACE_QUERY_NAME_INVALID', 'Use an original source query name: a letter or underscore, followed by up to 63 letters, digits or underscores.');
      const prior = request.draftId ? this.draft(request.draftId, request.expectedRevision) : null;
      if (prior && !Number.isInteger(request.expectedRevision))
        throw new WorkspaceError('WORKSPACE_REVISION_REQUIRED');
      const at = now();
      const draft = { schema: 'stellar-forge.opensearch-draft.v1', id: prior?.id ?? randomUUID(),
        revision: (prior?.revision ?? 0) + 1, title, queryName: request.queryName,
        query: object(request.query, 'Query declaration'), input: object(request.input ?? {}, 'Search input'),
        plan: object(request.plan, 'Merchant plan'), createdAt: prior?.createdAt ?? at, updatedAt: at };
      this.db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,title=excluded.title,updated_at=excluded.updated_at,record_json=excluded.record_json')
        .run(draft.id, draft.revision, draft.title, at, JSON.stringify(draft));
      this.db.prepare('INSERT INTO draft_history VALUES(?,?,?)').run(draft.id, draft.revision, JSON.stringify(draft));
      return this.writeOperation({ ...reserved.operation, state: 'COMPLETE', updatedAt: at,
        result: { draftId: draft.id, revision: draft.revision, draft } });
    });
  }
  begin(kind, request) {
    return this.transaction(() => {
      const reserved = this.reserve(kind, request);
      if (reserved.existing) return reserved;
      const draft = this.draft(request.draftId, request.expectedRevision);
      if (!Number.isInteger(request.expectedRevision)) throw new WorkspaceError('WORKSPACE_REVISION_REQUIRED');
      reserved.operation.draft = draft;
      this.writeOperation(reserved.operation);
      return reserved;
    });
  }
  finish(id, result, failure) {
    return this.transaction(() => {
      const operation = this.operation(id);
      if (operation.state !== 'RUNNING') return operation;
      return this.writeOperation({ ...operation, state: failure ? 'FAILED' : 'COMPLETE', updatedAt: now(),
        ...(failure ? { error: failure } : { result: clone(result) }) });
    });
  }
  capture(id, result, context) {
    return this.transaction(() => {
      const operation = this.operation(id);
      if (operation.state !== 'RUNNING') return operation;
      if (!Array.isArray(result?.hits)) throw new WorkspaceError('WORKSPACE_RESULT_INVALID', 'The original adapter returned no hit collection.');
      const resultJson = JSON.stringify(result, null, 2) + '\n';
      const editionId = digest('edition:' + id).slice(0, 32), at = now();
      const edition = { schema: 'stellar-forge.opensearch-edition.v1', id: editionId, requestId: id,
        draftId: operation.draft.id, draftRevision: operation.draft.revision, title: operation.draft.title,
        queryName: operation.draft.queryName, query: operation.draft.query, input: operation.draft.input,
        capturedAt: result.capturedAt ?? at, createdAt: at, sourceProfileSha256: this.profileHash,
        resultSha256: digest(resultJson), resultBytes: Buffer.byteLength(resultJson), hitCount: result.hits.length,
        total: result.total ?? null, truncated: Boolean(result.truncated), pages: result.pages,
        numberEncoding: result.numberEncoding ?? null, source: clone(result.source ?? null), ...clone(context) };
      this.db.prepare('INSERT INTO editions VALUES(?,?,?,?,?,?,?,?)').run(editionId, id, edition.draftId,
        edition.draftRevision, at, edition.resultSha256, resultJson, JSON.stringify(edition));
      return this.writeOperation({ ...operation, state: 'COMPLETE', updatedAt: at, result: { editionId, edition } });
    });
  }
  edition(id, includeResult = false) {
    const row = this.db.prepare('SELECT record_json,result_json,result_sha256 FROM editions WHERE id=?').get(identifier(id));
    if (!row) throw new WorkspaceError('WORKSPACE_EDITION_NOT_FOUND', 'Edition not found.', 404);
    if (digest(row.result_json) !== row.result_sha256) throw new WorkspaceError('WORKSPACE_EDITION_CORRUPT', 'The retained result checksum does not match.', 500);
    return { ...JSON.parse(row.record_json), ...(includeResult ? { result: JSON.parse(row.result_json) } : {}) };
  }
  resultText(id) {
    this.edition(id);
    return this.db.prepare('SELECT result_json FROM editions WHERE id=?').get(id).result_json;
  }
  registerPackage(id, manifest) {
    return this.transaction(() => {
      const operation = this.operation(id);
      if (operation.state !== 'RUNNING') return operation;
      const record = { schema: 'stellar-forge.opensearch-package.v1', id: digest('package:' + id).slice(0, 32),
        requestId: id, draftId: operation.draft.id, draftRevision: operation.draft.revision,
        title: operation.draft.title, createdAt: now(), ...clone(manifest) };
      this.db.prepare('INSERT INTO packages VALUES(?,?,?,?,?,?)')
        .run(record.id, id, record.draftId, record.draftRevision, record.createdAt, JSON.stringify(record));
      return this.writeOperation({ ...operation, state: 'COMPLETE', updatedAt: now(), result: { packageId: record.id, package: record } });
    });
  }
  package(id) {
    const value = parsed(this.db.prepare('SELECT record_json FROM packages WHERE id=?').get(identifier(id)));
    if (!value) throw new WorkspaceError('WORKSPACE_PACKAGE_NOT_FOUND', 'Package not found.', 404);
    return value;
  }
  state() {
    this.recoverInterrupted();
    const list = (table, order) => this.db.prepare('SELECT record_json FROM ' + table + ' ORDER BY ' + order).all().map(parsed);
    return { workspaceId: this.id, sourceProfileSha256: this.profileHash,
      drafts: list('drafts', 'updated_at DESC').map(({ query, input, plan, ...draft }) => draft),
      editions: list('editions', 'created_at DESC'), packages: list('packages', 'created_at DESC'),
      operations: list('operations', 'created_at DESC').slice(0, 30).map(({ draft, request, ...operation }) => operation) };
  }
  history(id) {
    this.draft(id);
    return this.db.prepare('SELECT record_json FROM draft_history WHERE draft_id=? ORDER BY revision DESC').all(id).map(parsed);
  }
  close() { LIVE_INSTANCES.delete(this.owner.instance); this.db.close(); }
}

function hitMap(edition) {
  const rows = new Map();
  for (const hit of edition.result.hits) {
    if (typeof hit?._index !== 'string' || typeof hit?._id !== 'string')
      throw new WorkspaceError('WORKSPACE_HIT_IDENTITY_INVALID');
    const key = JSON.stringify([hit._index, hit._id]);
    if (rows.has(key)) throw new WorkspaceError('WORKSPACE_DUPLICATE_HIT_IDENTITY', 'A retained result contains repeated original index/document identity.');
    rows.set(key, hit);
  }
  return rows;
}
function integerPaths(hit, accept) {
  return (Array.isArray(hit.exactIntegerPaths) ? hit.exactIntegerPaths : []).filter(accept).sort();
}
function contentView(hit) {
  return { source: hit._source, exactIntegerPaths: integerPaths(hit,
    path => path === '/_source' || path.startsWith('/_source/')) };
}
function rankingView(edition, hit) {
  const count = Array.isArray(edition.query?.sort) ? edition.query.sort.length : 0;
  return { score: hit._score ?? null, sort: (hit.sort ?? []).slice(0, count),
    exactIntegerPaths: integerPaths(hit, path => {
      if (path === '/_score') return true;
      const match = /^\/sort\/(\d+)(?:\/|$)/.exec(path);
      return Boolean(match && Number(match[1]) < count);
    }) };
}
export function compareEditions(before, after) {
  const left = hitMap(before), right = hitMap(after), added = [], removed = [], changed = [], rankingChanged = [];
  let matched = 0;
  for (const [key, hit] of right) {
    if (!left.has(key)) { added.push(hit); continue; }
    matched++;
    const prior = left.get(key), identity = [hit._index, hit._id];
    if (canonical(contentView(prior)) !== canonical(contentView(hit)))
      changed.push({ identity, before: prior, after: hit });
    if (canonical(rankingView(before, prior)) !== canonical(rankingView(after, hit)))
      rankingChanged.push({ identity, before: rankingView(before, prior), after: rankingView(after, hit) });
  }
  for (const [key, hit] of left) if (!right.has(key)) removed.push(hit);
  const summary = edition => ({ id: edition.id, capturedAt: edition.capturedAt,
    queryName: edition.queryName, query: edition.query, input: edition.input,
    fields: edition.result.fields, draftRevision: edition.draftRevision, resultSha256: edition.resultSha256,
    sourceProfileSha256: edition.sourceProfileSha256, source: edition.source ?? edition.result.source ?? null,
    numberEncoding: edition.numberEncoding,
    hitCount: edition.hitCount, total: edition.total, truncated: edition.truncated });
  const scope = edition => ({ query: edition.query, input: edition.input, fields: edition.result.fields });
  return { schema: 'stellar-forge.opensearch-comparison.v1', comparedAt: now(), identity: ['_index', '_id'],
    semantics: { added: 'Entered the retained result set', removed: 'Left the retained result set',
      changed: 'Projected source content or original source numeric type changed',
      rankingChanged: 'Score or declared business sort changed',
      ordering: 'PIT snapshot tie breakers are excluded from content and ranking changes' },
    scope: { sameSourceProfile: before.sourceProfileSha256 === after.sourceProfileSha256,
      sameNativeCluster: before.result.source?.clusterFingerprint && after.result.source?.clusterFingerprint ?
        before.result.source.clusterFingerprint === after.result.source.clusterFingerprint : null,
      sameQueryInputAndProjection: canonical(scope(before)) === canonical(scope(after)),
      eitherTruncated: Boolean(before.truncated || after.truncated) },
    before: summary(before), after: summary(after),
    counts: { added: added.length, removed: removed.length, changed: changed.length,
      rankingChanged: rankingChanged.length, unchanged: matched - changed.length },
    added, removed, changed, rankingChanged };
}

function field(source, path) {
  if (source && Object.hasOwn(source, path)) return source[path];
  let value = source;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[=+\-@\t\r]/.test(text) || /^0\d/.test(text) || /^-?\d{16,}$/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function editionCsv(edition) {
  const result = edition.result, fields = Array.isArray(result.fields) ? result.fields : [];
  const header = ['_index', '_id', '_score', ...fields, '_source_json', '_sort_json', '_exact_integer_paths_json'];
  const rows = result.hits.map(hit => [hit._index, hit._id, hit._score, ...fields.map(name => field(hit._source, name)),
    hit._source, hit.sort, hit.exactIntegerPaths]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
