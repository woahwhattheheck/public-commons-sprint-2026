// MIT. Native transactional authoring history for the original S3 merchant.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, realpath, lstat, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class S3WorkspaceError extends Error {
  constructor(code, status = 422, message = code) {
    super(message); this.name = 'S3WorkspaceError'; this.code = code; this.status = status;
  }
}
export const encode = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
export const fingerprint = value => sha256(JSON.stringify(normalized(value)));
export function operationId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value))
    throw new S3WorkspaceError('OPERATION_ID_REQUIRED', 422, 'Use an operation ID of 8–80 lowercase letters, digits and hyphens, starting with a letter.');
  return value;
}
export function revisionNumber(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new S3WorkspaceError('INVALID_REVISION');
  return value;
}
const draftRow = row => row ? { revision: row.revision, operationId: row.operation_id,
  savedAt: row.saved_at, sourceSha256: row.source_sha256, paymentSha256: row.payment_sha256,
  origin: row.origin, source: JSON.parse(row.source), payment: JSON.parse(row.payment) } : null;
const operationRow = row => row ? { operationId: row.id, kind: row.kind, inputSha256: row.input_sha256,
  input: JSON.parse(row.input), context: row.context ? JSON.parse(row.context) : null,
  state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
  result: row.result ? JSON.parse(row.result) : null, error: row.error } : null;

async function regularOrMissing(path) {
  try { if (!(await lstat(path)).isFile()) throw new S3WorkspaceError('WORKSPACE_FILE_INVALID'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export const S3_WORKSPACE_INSPECTION_SCHEMA = 'stellar-forge.s3-workspace-inspection.v1';
const WORKSPACE_UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const browserPort = value => value === null || value === undefined ? null :
  typeof value === 'string' && /^(?:[1-9][0-9]*)$/.test(value) && Number(value) <= 65535 ? Number(value) :
    (() => { throw new S3WorkspaceError('WORKSPACE_BROWSER_PORT_INVALID'); })();

/** Read the original identity and current revision without taking its writer lease. */
export async function inspectS3WorkspaceStore(directory, { allowMissing = false } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      typeof allowMissing !== 'boolean') throw new S3WorkspaceError('WORKSPACE_DIRECTORY_REQUIRED');
  const root = resolve(directory), filename = join(root, 'workspace.sqlite');
  const empty = { schema: S3_WORKSPACE_INSPECTION_SCHEMA, state: 'NEW', directory: root,
    workspaceId: null, releaseStore: null, authoringPort: null, revision: 0, latest: null, database: null };
  let folder, before;
  try { folder = await lstat(root); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return empty; throw error; }
  if (!folder.isDirectory() || folder.isSymbolicLink() || await realpath(root) !== root)
    throw new S3WorkspaceError('WORKSPACE_DIRECTORY_INVALID');
  try { before = await lstat(filename); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return empty; throw error; }
  if (!before.isFile() || before.isSymbolicLink() || await realpath(filename) !== filename)
    throw new S3WorkspaceError('WORKSPACE_FILE_INVALID');
  let db, result;
  try {
    db = new DatabaseSync(filename, { readOnly: true });
    db.exec('PRAGMA busy_timeout=1000; BEGIN');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    if (!['metadata', 'revisions', 'reviews', 'operations'].every(name => tables.includes(name)))
      throw new S3WorkspaceError('WORKSPACE_STORE_INVALID');
    const value = key => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? null;
    const workspaceId = value('workspaceId'), releaseStore = value('releaseStore'),
      authoringPort = browserPort(value('authoringPort'));
    if (!WORKSPACE_UUID.test(workspaceId ?? '') ||
        releaseStore !== null && (typeof releaseStore !== 'string' || !releaseStore ||
          releaseStore.includes('\0') || resolve(releaseStore) !== releaseStore))
      throw new S3WorkspaceError('WORKSPACE_STORE_INVALID');
    const row = db.prepare('SELECT revision,source_sha256,payment_sha256,origin,saved_at FROM revisions ORDER BY revision DESC LIMIT 1').get();
    if (row && (!Number.isSafeInteger(row.revision) || row.revision < 1 ||
        !CONTENT_HASH.test(row.source_sha256) || !CONTENT_HASH.test(row.payment_sha256) ||
        typeof row.origin !== 'string' || typeof row.saved_at !== 'string'))
      throw new S3WorkspaceError('WORKSPACE_STORE_INVALID');
    result = { schema: S3_WORKSPACE_INSPECTION_SCHEMA, state: 'READY', directory: root,
      workspaceId, releaseStore, authoringPort, revision: row?.revision ?? 0,
      latest: row ? { revision: row.revision, sourceSha256: row.source_sha256,
        paymentSha256: row.payment_sha256, origin: row.origin, savedAt: row.saved_at } : null,
      database: { path: filename, kind: 's3-workspace-store', exists: true, dev: before.dev, ino: before.ino } };
    db.exec('COMMIT');
  } catch (error) {
    if (error instanceof S3WorkspaceError) throw error;
    throw new S3WorkspaceError('WORKSPACE_STORE_INVALID', 409, 'Select an original S3 merchant workspace or a new private directory.');
  } finally { db?.close(); }
  const after = await lstat(filename);
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino)
    throw new S3WorkspaceError('WORKSPACE_IDENTITY_CHANGED', 409);
  return result;
}

/** SQLite supplies the revision compare-and-swap and crash-released operation lock. */
export async function openS3WorkspaceStore(directory, { expectedWorkspaceId } = {}) {
  if (expectedWorkspaceId !== undefined && expectedWorkspaceId !== 'new' &&
      !WORKSPACE_UUID.test(expectedWorkspaceId ?? ''))
    throw new S3WorkspaceError('EXPECTED_WORKSPACE_ID_INVALID');
  if (expectedWorkspaceId && expectedWorkspaceId !== 'new') {
    const original = await lstat(join(resolve(directory), 'workspace.sqlite'));
    if (!original.isFile() || original.isSymbolicLink()) throw new S3WorkspaceError('WORKSPACE_FILE_INVALID');
  }
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const root = await realpath(resolve(directory)); await chmod(root, 0o700);
  const filename = join(root, 'workspace.sqlite'), lockfile = join(root, 'operations.sqlite');
  await regularOrMissing(filename); await regularOrMissing(lockfile);
  const db = new DatabaseSync(filename);
  try {
    await chmod(filename, 0o600);
    db.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions (
      revision INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,input_sha256 TEXT NOT NULL,
      source TEXT NOT NULL,payment TEXT NOT NULL,origin TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,payment_sha256 TEXT NOT NULL,saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,revision INTEGER NOT NULL REFERENCES revisions(revision),
      selected_source TEXT NOT NULL,description TEXT NOT NULL,service TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,selection_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_sha256 TEXT NOT NULL,input TEXT NOT NULL,context TEXT,
      state TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    const priorId = db.prepare('SELECT value FROM metadata WHERE key=?').get('workspaceId')?.value;
    if (priorId !== undefined && !WORKSPACE_UUID.test(priorId))
      throw new S3WorkspaceError('WORKSPACE_STORE_INVALID');
    if (expectedWorkspaceId === 'new' && priorId !== undefined ||
        expectedWorkspaceId && expectedWorkspaceId !== 'new' && priorId !== expectedWorkspaceId)
      throw new S3WorkspaceError('WORKSPACE_IDENTITY_CHANGED', 409,
        'The original S3 workspace changed after review. Reopen its current identity before starting.');
    if (priorId === undefined)
      db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('workspaceId', randomUUID());
    db.exec('COMMIT');
  } catch (error) {
    try { if (db.isTransaction) db.exec('ROLLBACK'); }
    finally { db.close(); }
    throw error;
  }
  let closed = false;
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const latest = () => draftRow(db.prepare('SELECT * FROM revisions ORDER BY revision DESC LIMIT 1').get());
  const getOperation = id => operationRow(db.prepare('SELECT * FROM operations WHERE id=?').get(operationId(id)));
  const review = id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new S3WorkspaceError('INVALID_REVIEW_ID');
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
    if (!row) throw new S3WorkspaceError('REVIEW_NOT_FOUND', 404);
    return { reviewId: row.id, revision: row.revision, createdAt: row.created_at,
      sourceSha256: row.source_sha256, selectionSha256: row.selection_sha256,
      selectedSource: JSON.parse(row.selected_source), description: JSON.parse(row.description), service: JSON.parse(row.service) };
  };
  const store = {
    directory: root, workspaceId: db.prepare('SELECT value FROM metadata WHERE key=?').get('workspaceId').value,
    latest, getOperation, review,
    authoringPort() {
      return browserPort(db.prepare('SELECT value FROM metadata WHERE key=?').get('authoringPort')?.value);
    },
    retainAuthoringPort({ port, expectedPort }) {
      if (!Number.isInteger(port) || port < 1 || port > 65535 ||
          expectedPort !== null && (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535))
        throw new S3WorkspaceError('WORKSPACE_BROWSER_PORT_INVALID');
      return transaction(() => {
        const current = store.authoringPort();
        if (current !== expectedPort) throw new S3WorkspaceError('WORKSPACE_BROWSER_PORT_CHANGED', 409,
          'The workspace browser listener changed. Reopen its current launch review.');
        if (current !== port)
          db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
            .run('authoringPort', String(port));
        return port;
      });
    },
    metadata(key, value) {
      return transaction(() => {
        const prior = db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
        if (value !== undefined && prior !== undefined && prior !== value)
          throw new S3WorkspaceError('WORKSPACE_CONFIGURATION_CONFLICT', 409, 'Reopen this workspace with its original release store.');
        if (value !== undefined) db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run(key, value);
        return prior ?? value;
      });
    },
    revision(value) {
      const result = draftRow(db.prepare('SELECT * FROM revisions WHERE revision=?').get(revisionNumber(value)));
      if (!result) throw new S3WorkspaceError('REVISION_NOT_FOUND', 404);
      return result;
    },
    history({ beforeRevision, limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new S3WorkspaceError('INVALID_PAGE_SIZE');
      if (beforeRevision !== undefined) revisionNumber(beforeRevision);
      const rows = db.prepare('SELECT * FROM revisions WHERE revision<? ORDER BY revision DESC LIMIT ?')
        .all(beforeRevision ?? Number.MAX_SAFE_INTEGER, limit + 1);
      return { revisions: rows.slice(0, limit).map(row => {
        const { source, payment, ...summary } = draftRow(row); return summary;
      }), nextBeforeRevision: rows.length > limit ? rows[limit - 1].revision : null };
    },
    save({ expectedRevision, operationId: id, source, payment, origin }) {
      revisionNumber(expectedRevision, true); operationId(id);
      const inputSha = fingerprint({ source, payment, origin });
      return transaction(() => {
        const prior = db.prepare('SELECT * FROM revisions WHERE operation_id=?').get(id);
        if (prior) {
          if (prior.input_sha256 !== inputSha) throw new S3WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          return draftRow(prior);
        }
        const head = latest()?.revision ?? 0;
        if (head !== expectedRevision) throw new S3WorkspaceError('REVISION_CONFLICT', 409, 'Another editor saved this workspace. Reopen the current revision and reconcile your draft.');
        const sourceText = encode(source), paymentText = encode(payment);
        db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?)').run(head + 1, id, inputSha,
          sourceText, paymentText, origin, sha256(sourceText), sha256(paymentText), new Date().toISOString());
        return latest();
      });
    },
    saveReview({ revision, selectedSource, description, service, sourceSha256, operationId: actionId }) {
      const selectionSha256 = sha256(encode(selectedSource));
      const id = fingerprint({ revision, selectionSha256, description, service });
      operationId(actionId);
      return transaction(() => {
        const operation = getOperation(actionId);
        if (!operation || operation.kind !== 'REVIEW' || operation.input.revision !== revision)
          throw new S3WorkspaceError('REVIEW_OPERATION_CONFLICT', 409);
        db.prepare('INSERT OR IGNORE INTO reviews VALUES (?,?,?,?,?,?,?,?)').run(id, revision,
          encode(selectedSource), encode(description), encode(service), sourceSha256, selectionSha256, new Date().toISOString());
        store.finishOperation(actionId, { reviewId: id, revision });
        return review(id);
      });
    },
    reviews() {
      return db.prepare('SELECT id,revision,source_sha256,selection_sha256,created_at FROM reviews ORDER BY created_at DESC').all()
        .map(row => ({ reviewId: row.id, revision: row.revision, sourceSha256: row.source_sha256,
          selectionSha256: row.selection_sha256, createdAt: row.created_at }));
    },
    beginOperation(id, kind, input, context = null) {
      operationId(id); const digest = fingerprint(input);
      return transaction(() => {
        const existing = getOperation(id);
        if (existing) {
          if (existing.kind !== kind || existing.inputSha256 !== digest)
            throw new S3WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          return existing;
        }
        const now = new Date().toISOString();
        db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, kind, digest,
          encode(input), context ? encode(context) : null, 'RUNNING', null, null, now, now);
        return getOperation(id);
      });
    },
    finishOperation(id, result) {
      db.prepare('UPDATE operations SET state=?,result=?,error=NULL,updated_at=? WHERE id=?')
        .run('COMPLETE', encode(result), new Date().toISOString(), operationId(id));
      return result;
    },
    failOperation(id, error) {
      db.prepare('UPDATE operations SET state=?,error=?,updated_at=? WHERE id=? AND state<>?')
        .run('INTERRUPTED', String(error.code ?? 'WORKSPACE_OPERATION_FAILED'), new Date().toISOString(), operationId(id), 'COMPLETE');
    },
    operations() {
      return db.prepare('SELECT * FROM operations ORDER BY created_at DESC').all().map(row => {
        const { input, context, inputSha256, ...summary } = operationRow(row); return summary;
      });
    },
    async lockOperation(fn) {
      await regularOrMissing(lockfile);
      const lock = new DatabaseSync(lockfile);
      try {
        await chmod(lockfile, 0o600);
        try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
        catch (cause) { throw new S3WorkspaceError('WORKSPACE_BUSY', 409, 'Another native S3 authoring operation is running. Refresh its saved result.'); }
        return await fn();
      } finally { lock.close(); }
    },
    close() { if (!closed) { closed = true; db.close(); } },
  };
  return store;
}
