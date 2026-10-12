// MIT. Private durable operation and edition store; original Linux lease/atomic files.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, chmod, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { atomicFile, boundedFile, canonical, sha256 } from '../../sf46-release/release-core.mjs';
import { fault, integer } from './declaration.mjs';

export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export const json = value => JSON.stringify(value, null, 2) + '\n';
export { canonical, sha256 };
const decode = value => JSON.parse(value);
const now = () => new Date().toISOString();
function uuid(value) {
  if (!UUID.test(value ?? '')) throw fault('SNOWFLAKE_OPERATION_ID_INVALID');
  return value.toLowerCase();
}
function hash(value) {
  if (!HASH.test(value ?? '')) throw fault('SNOWFLAKE_HASH_INVALID');
  return value;
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path || stat.mode & 0o077)
    throw fault('SNOWFLAKE_PRIVATE_DIRECTORY_REQUIRED', 'Choose a canonical private workspace directory with mode 0700.');
}

/** Stable native content identity survives receiving into a fresh workspace.
 * Observation sequences and local validation/receiving facts stay in metadata. */
export function snowflakeEditionId(manifest) {
  return sha256(canonical({
    schema: manifest.schema, sourceId: manifest.sourceId, queryName: manifest.queryName,
    origin: manifest.origin, requestId: manifest.requestId, requestSha256: manifest.requestSha256,
    statementHandle: manifest.statementHandle, metadata: manifest.metadata,
    columns: manifest.columns, keyColumns: manifest.keyColumns,
    rowCount: manifest.rowCount, partitionCount: manifest.partitionCount, resultBytes: manifest.resultBytes,
    encoding: manifest.encoding, outputParameters: manifest.outputParameters ?? null, complete: manifest.complete,
    partitions: manifest.partitions.map(({ index, rows, sha256: digest, bytes }) =>
      ({ index, rows, sha256: digest, bytes }))
  }));
}

/** SQLite is only our local journal. Query data stays in complete hashed originals. */
export async function openSnowflakeStore(directory) {
  const root = resolve(directory), objects = join(root, 'objects');
  await privateDirectory(root); await privateDirectory(objects);
  const lease = await acquireStateLease(root);
  let db, closed = false;
  try {
    const path = join(root, 'workspace.sqlite');
    try { const handle = await open(path, 'wx', 0o600); await handle.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(path) !== path)
      throw fault('SNOWFLAKE_PRIVATE_DATABASE_REQUIRED');
    db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), query_name TEXT NOT NULL,
        argument_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL REFERENCES operations(id),
        created_at TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS editions (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id),
        created_at TEXT NOT NULL, manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, edition_id TEXT NOT NULL REFERENCES editions(id),
        created_at TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY, edition_id TEXT NOT NULL REFERENCES editions(id),
        created_at TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS operations_recent ON operations(created_at,id);
      CREATE INDEX IF NOT EXISTS observations_operation ON observations(operation_id,sequence);
      CREATE INDEX IF NOT EXISTS reviews_edition ON reviews(edition_id,sequence);`);
    const schema = db.prepare('SELECT value FROM metadata WHERE key=?').get('schema')?.value;
    if (schema && schema !== 'stellar-forge.snowflake-workspace.v1') throw fault('SNOWFLAKE_WORKSPACE_SCHEMA_INVALID');
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('schema', 'stellar-forge.snowflake-workspace.v1');
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('id', randomUUID());
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('revision', '0');
  } catch (error) { db?.close(); await lease.close(); throw error; }
  const check = () => { if (closed) throw fault('SNOWFLAKE_WORKSPACE_CLOSED', undefined, 503); lease.assertHeld(); };
  const revision = () => Number(db.prepare('SELECT value FROM metadata WHERE key=?').get('revision').value);
  const meta = key => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? null;
  const setMeta = (key, value) => db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  function transaction(task) {
    check(); db.exec('BEGIN IMMEDIATE');
    try { const value = task(); setMeta('revision', revision() + 1); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function operation(id) {
    check(); const row = db.prepare('SELECT * FROM operations WHERE id=?').get(uuid(id));
    if (!row) throw fault('SNOWFLAKE_OPERATION_UNKNOWN', 'The retained operation was not found.', 404);
    return { ...decode(row.detail), id: row.id, sourceId: row.source_id, queryName: row.query_name,
      argumentHash: row.argument_hash, createdAt: row.created_at, updatedAt: row.updated_at,
      version: row.version, status: row.status };
  }
  function updateOperation(id, patch, expectedVersion) {
    return transaction(() => {
      const before = operation(id);
      if (expectedVersion !== undefined && before.version !== expectedVersion)
        throw fault('SNOWFLAKE_OPERATION_CHANGED', 'Reload the current operation.', 409);
      const after = { ...before, ...structuredClone(patch), id: before.id, sourceId: before.sourceId,
        queryName: before.queryName, argumentHash: before.argumentHash, createdAt: before.createdAt,
        updatedAt: now(), version: before.version + 1 };
      db.prepare('UPDATE operations SET updated_at=?, version=?, status=?, detail=? WHERE id=?')
        .run(after.updatedAt, after.version, after.status, json(after), after.id);
      return after;
    });
  }
  function source(id) {
    check(); const selected = id ?? meta('currentSource');
    const row = selected && db.prepare('SELECT * FROM sources WHERE id=?').get(hash(selected));
    if (!row) throw fault('SNOWFLAKE_SOURCE_UNKNOWN', 'Save the selected source configuration first.', 404);
    return { id: row.id, createdAt: row.created_at, config: decode(row.config) };
  }
  function edition(id) {
    check(); const row = db.prepare('SELECT * FROM editions WHERE id=?').get(hash(id));
    if (!row) throw fault('SNOWFLAKE_EDITION_UNKNOWN', 'The retained edition was not found.', 404);
    return { ...decode(row.manifest), id: row.id, createdAt: row.created_at };
  }
  const limit = value => integer(value ?? 50, 1, 200, 'page limit');
  const after = value => integer(value ?? 0, 0, Number.MAX_SAFE_INTEGER, 'page offset');
  async function putObject(bytes) {
    check(); if (!(bytes instanceof Uint8Array) || bytes.length > 67108864) throw fault('SNOWFLAKE_OBJECT_TOO_LARGE');
    const digest = sha256(bytes), path = join(objects, digest);
    try { await atomicFile(path, bytes, 0o600, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await boundedFile(objects, digest, bytes.length);
      if (existing.length !== bytes.length || sha256(existing) !== digest) throw fault('SNOWFLAKE_ORIGINAL_CHANGED');
    }
    return { sha256: digest, bytes: bytes.length };
  }
  async function readObject(descriptor) {
    check(); hash(descriptor?.sha256); integer(descriptor.bytes, 0, 67108864, 'original bytes');
    const bytes = await boundedFile(objects, descriptor.sha256, descriptor.bytes);
    if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256)
      throw fault('SNOWFLAKE_ORIGINAL_CHANGED', 'The retained original differs from its descriptor.');
    return bytes;
  }
  function summary() {
    check();
    return { schema: meta('schema'), id: meta('id'), revision: revision(),
      sourceId: meta('currentSource'), counts: Object.fromEntries(['sources', 'operations', 'editions', 'publications']
        .map(table => [table, db.prepare('SELECT count(*) AS n FROM ' + table).get().n])),
      running: db.prepare("SELECT id,status,query_name AS queryName FROM operations WHERE status NOT IN ('COMPLETE','CANCELLED','FAILED','REJECTED') ORDER BY created_at DESC LIMIT 200").all(),
      cooldownUntil: Number(meta('cooldownUntil') ?? 0) };
  }
  return {
    directory: root, check, summary, revision, source, operation, updateOperation, edition, putObject, readObject,
    derivative(editionId) { edition(editionId); const value = meta('database:' + editionId); return value ? decode(value) : null; },
    saveDerivative(editionId, descriptor) { edition(editionId); hash(descriptor.sha256); return transaction(() => setMeta('database:' + editionId, json(descriptor))); },
    saveSource(config, expectedRevision) {
      const id = sha256(canonical(config));
      return transaction(() => {
        if (expectedRevision !== undefined && revision() !== expectedRevision)
          throw fault('SNOWFLAKE_WORKSPACE_CHANGED', 'Reload before replacing the saved source.', 409);
        db.prepare('INSERT OR IGNORE INTO sources VALUES (?,?,?)').run(id, now(), json(config));
        setMeta('currentSource', id);
        return source(id);
      });
    },
    createOperation({ id = randomUUID(), sourceId, queryName, arguments: input, origin, body }) {
      const requestId = id; id = uuid(id); source(sourceId);
      const argumentHash = sha256(canonical({ sourceId, queryName, arguments: input, origin, body }));
      const found = db.prepare('SELECT id FROM operations WHERE id=?').get(id);
      if (found) {
        const previous = operation(id);
        if (previous.argumentHash !== argumentHash) throw fault('SNOWFLAKE_REQUEST_ID_REUSED', 'This request ID already belongs to another exact read.', 409);
        return previous;
      }
      return transaction(() => {
        const createdAt = now(), detail = { requestId, origin, body: structuredClone(body),
          arguments: structuredClone(input), statementHandle: null, partitions: [],
          metadata: null, editionId: null, nextAttemptAt: 0, attempts: 0 };
        db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, sourceId, queryName, argumentHash, createdAt, createdAt, 1, 'PREPARED', json(detail));
        return operation(id);
      });
    },
    observe(id, observation) {
      id = uuid(id);
      return transaction(() => {
        operation(id);
        const result = db.prepare('INSERT INTO observations(operation_id,created_at,detail) VALUES (?,?,?)')
          .run(id, now(), json(observation));
        return Number(result.lastInsertRowid);
      });
    },
    observations(id, { offset = 0, pageSize = 50 } = {}) {
      id = uuid(id); operation(id); const count = limit(pageSize), start = after(offset);
      const rows = db.prepare('SELECT sequence,created_at,detail FROM observations WHERE operation_id=? ORDER BY sequence LIMIT ? OFFSET ?')
        .all(id, count + 1, start);
      return { items: rows.slice(0, count).map(row => ({ sequence: row.sequence, createdAt: row.created_at, ...decode(row.detail) })),
        nextOffset: rows.length > count ? start + count : null };
    },
    list(kind, { offset = 0, pageSize = 50 } = {}) {
      check(); if (!['sources', 'operations', 'editions', 'publications'].includes(kind)) throw fault('SNOWFLAKE_LIST_INVALID');
      const count = limit(pageSize), start = after(offset);
      const rows = db.prepare('SELECT * FROM ' + kind + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(count + 1, start);
      const items = rows.slice(0, count).map(row => kind === 'sources' ? { id: row.id, createdAt: row.created_at, label: decode(row.config).label } :
        kind === 'operations' ? { id: row.id, sourceId: row.source_id, queryName: row.query_name, createdAt: row.created_at,
          updatedAt: row.updated_at, status: row.status, version: row.version, editionId: decode(row.detail).editionId } :
        kind === 'editions' ? edition(row.id) : { id: row.id, editionId: row.edition_id, createdAt: row.created_at, ...decode(row.detail) });
      return { items, nextOffset: rows.length > count ? start + count : null };
    },
    finishEdition(id, manifest) {
      id = uuid(id);
      return transaction(() => {
        const original = operation(id), editionId = snowflakeEditionId(manifest);
        if (manifest.operationId !== id || manifest.sourceId !== original.sourceId ||
            manifest.queryName !== original.queryName || manifest.origin !== original.origin ||
            manifest.requestId !== original.requestId || manifest.requestSha256 !== sha256(canonical(original.body)) ||
            manifest.statementHandle !== original.statementHandle)
          throw fault('SNOWFLAKE_EDITION_ORIGIN_CHANGED');
        if (original.editionId && original.editionId !== editionId) throw fault('SNOWFLAKE_EDITION_CHANGED');
        db.prepare('INSERT OR IGNORE INTO editions VALUES (?,?,?,?)').run(editionId, id, now(), json(manifest));
        const complete = { ...original, status: 'COMPLETE', editionId, updatedAt: now(), version: original.version + 1 };
        db.prepare('UPDATE operations SET updated_at=?,version=?,status=?,detail=? WHERE id=?')
          .run(complete.updatedAt, complete.version, complete.status, json(complete), id);
        return edition(editionId);
      });
    },
    review(editionId, { decision, actor, note, comparisonId = null }) {
      edition(editionId);
      if (!['ACCEPTED', 'REJECTED'].includes(decision) || typeof actor !== 'string' || !actor.trim() || actor.length > 128 ||
          typeof note !== 'string' || !note.trim() || note.length > 4096)
        throw fault('SNOWFLAKE_REVIEW_REQUIRED', 'Record the reviewer, decision and reason for this exact edition.');
      if (comparisonId !== null) edition(comparisonId);
      return transaction(() => {
        const detail = { decision, actor: actor.trim(), note: note.trim(), comparisonId };
        const result = db.prepare('INSERT INTO reviews(edition_id,created_at,detail) VALUES (?,?,?)').run(editionId, now(), json(detail));
        return { sequence: Number(result.lastInsertRowid), editionId, ...detail };
      });
    },
    latestReview(editionId) {
      edition(editionId); const row = db.prepare('SELECT * FROM reviews WHERE edition_id=? ORDER BY sequence DESC LIMIT 1').get(editionId);
      return row ? { sequence: row.sequence, createdAt: row.created_at, ...decode(row.detail) } : null;
    },
    getPublication(id) {
      check(); const row = db.prepare('SELECT * FROM publications WHERE id=?').get(uuid(id));
      return row ? { id: row.id, editionId: row.edition_id, createdAt: row.created_at, ...decode(row.detail) } : null;
    },
    updatePublication(id, patch) {
      id = uuid(id); return transaction(() => {
        const row = db.prepare('SELECT * FROM publications WHERE id=?').get(id);
        if (!row) throw fault('SNOWFLAKE_PUBLICATION_UNKNOWN');
        const previous = decode(row.detail), detail = { ...previous, ...patch, request: previous.request, requestSha256: previous.requestSha256 };
        db.prepare('UPDATE publications SET detail=? WHERE id=?').run(json(detail), id);
        return { id, editionId: row.edition_id, createdAt: row.created_at, ...detail };
      });
    },
    publication(editionId, detail, id = randomUUID()) {
      edition(editionId); id = uuid(id);
      return transaction(() => {
        const original = db.prepare('SELECT * FROM publications WHERE id=?').get(id);
        if (original) {
          if (original.edition_id !== editionId || canonical(decode(original.detail)) !== canonical(detail))
            throw fault('SNOWFLAKE_PUBLICATION_ID_REUSED', undefined, 409);
          return { id, editionId, ...decode(original.detail) };
        }
        db.prepare('INSERT INTO publications VALUES (?,?,?,?)').run(id, editionId, now(), json(detail));
        return { id, editionId, ...detail };
      });
    },
    cooldown(until) {
      integer(until, 0, Number.MAX_SAFE_INTEGER, 'cooldown');
      return transaction(() => { setMeta('cooldownUntil', Math.max(Number(meta('cooldownUntil') ?? 0), until)); });
    },
    async close() {
      if (closed) return;
      check(); closed = true;
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } finally { await lease.close(); }
    },
  };
}
