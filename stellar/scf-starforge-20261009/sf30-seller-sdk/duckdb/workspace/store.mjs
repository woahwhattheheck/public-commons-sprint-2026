// MIT. Private merchant drafts and package operations around the original compiler.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, realpath, lstat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class WorkspaceError extends Error {
  constructor(code, status = 422, message = code) {
    super(message); this.name = 'WorkspaceError'; this.code = code; this.status = status;
  }
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function operationId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value))
    throw new WorkspaceError('OPERATION_ID_REQUIRED');
  return value;
}
export function revisionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new WorkspaceError('INVALID_DRAFT_REVISION');
  return value;
}
export function encodePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new WorkspaceError('MERCHANT_PLAN_REQUIRED');
  const text = json(plan);
  if (Buffer.byteLength(text) > 262144) throw new WorkspaceError('MERCHANT_PLAN_TOO_LARGE');
  return text;
}
export function encodeAuthoring(authoring = []) {
  if (!Array.isArray(authoring) || authoring.length > 32 || Buffer.byteLength(json(authoring)) > 131072)
    throw new WorkspaceError('QUERY_AUTHORING_DRAFT_INVALID');
  return json(authoring);
}
const rowDraft = row => row ? { revision: row.revision, operationId: row.operation_id,
  sourceSha256: row.source_sha256, planSha256: row.plan_sha256,
  savedAt: row.saved_at, plan: JSON.parse(row.plan), authoring: JSON.parse(row.authoring ?? '[]') } : null;
const rowPackage = row => row ? { id: row.id, revision: row.revision, state: row.state,
  sourceSha256: row.source_sha256, reviewId: row.review_id, createdAt: row.created_at,
  completedAt: row.completed_at, error: row.error,
  summary: row.summary ? JSON.parse(row.summary) : null } : null;

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (await realpath(path) !== path || !(await lstat(path)).isDirectory())
    throw new WorkspaceError('PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  await chmod(path, 0o700);
}
async function regularOrMissing(path) {
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink()) throw new WorkspaceError('WORKSPACE_FILE_INVALID');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** Read the retained selection before the normal workspace acquires its ownership lock. */
export async function readSavedWorkspaceSource(directory) {
  const root = resolve(directory), filename = resolve(root, 'workspace.sqlite');
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory())
    throw new WorkspaceError('PRIVATE_WORKSPACE_DIRECTORY_REQUIRED');
  await regularOrMissing(filename);
  let db;
  try {
    db = new DatabaseSync(filename, { readOnly: true });
    const source = db.prepare('SELECT value FROM metadata WHERE key=?').get('sourceFile')?.value;
    if (typeof source !== 'string' || !source || resolve(source) !== source || source.includes('\0'))
      throw new WorkspaceError('SAVED_WORKSPACE_SOURCE_REQUIRED', 404);
    return source;
  } finally { db?.close(); }
}

/** A native SQLite lock is released by the OS after a crash, without PID guessing. */
export async function openWorkspaceStore({ directory, sourceFile }) {
  const root = resolve(directory), canonicalSource = await realpath(resolve(sourceFile)).catch(error => {
    if (error.code === 'ENOENT') return resolve(sourceFile);
    throw error;
  });
  await privateDirectory(root);
  for (const name of ['inputs', 'packages']) await privateDirectory(resolve(root, name));
  const ownerPath = resolve(root, 'runtime-lock.sqlite'), dataPath = resolve(root, 'workspace.sqlite');
  await regularOrMissing(ownerPath); await regularOrMissing(dataPath);
  let owner, db, closed = false;
  try {
    owner = new DatabaseSync(ownerPath);
    owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    await chmod(ownerPath, 0o600);
    db = new DatabaseSync(dataPath);
    await chmod(dataPath, 0o600);
    db.exec(`PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts (
        revision INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
        source_sha256 TEXT NOT NULL, plan_sha256 TEXT NOT NULL, plan TEXT NOT NULL, saved_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL REFERENCES drafts(revision),
        review_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, error TEXT, summary TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK (id=1), body TEXT NOT NULL);`);
    const existing = db.prepare('SELECT value FROM metadata WHERE key=?').get('sourceFile');
    if (existing && existing.value !== canonicalSource) throw new WorkspaceError('WORKSPACE_SOURCE_MISMATCH', 409);
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('sourceFile', canonicalSource);
    db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('workspaceId', randomUUID());
    if (!db.prepare('PRAGMA table_info(drafts)').all().some(column => column.name === 'authoring'))
      db.exec("ALTER TABLE drafts ADD COLUMN authoring TEXT NOT NULL DEFAULT '[]'");
    db.exec("UPDATE packages SET state='INTERRUPTED' WHERE state='PREPARING'");
    const prior = db.prepare('SELECT body FROM runtime WHERE id=1').get();
    if (prior) {
      const value = JSON.parse(prior.body);
      if (['STARTING', 'RUNNING', 'STOPPING'].includes(value.state)) {
        value.state = 'INTERRUPTED'; value.endedAt = new Date().toISOString();
        db.prepare('UPDATE runtime SET body=? WHERE id=1').run(json(value));
      }
    }
  } catch (error) {
    try { db?.close(); } catch {}
    try { owner?.close(); } catch {}
    if (error?.errcode === 5 || /database is locked/i.test(error?.message ?? ''))
      throw new WorkspaceError('WORKSPACE_ALREADY_OPEN', 409, 'This workspace is already open in another process.');
    throw error;
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const latest = () => rowDraft(db.prepare('SELECT * FROM drafts ORDER BY revision DESC LIMIT 1').get());
  const getDraft = revision => rowDraft(db.prepare('SELECT * FROM drafts WHERE revision=?').get(revisionNumber(revision)));
  const getPackage = id => rowPackage(db.prepare('SELECT * FROM packages WHERE id=?').get(operationId(id)));
  return {
    directory: root, latest, getDraft, getPackage,
    get sourceFile() { return db.prepare('SELECT value FROM metadata WHERE key=?').get('sourceFile').value; },
    extension(initialize) { return initialize({ db, transaction }); },
    selectSourceFile(value, expected) {
      if (typeof value !== 'string' || resolve(value) !== value || value.includes('\0'))
        throw new WorkspaceError('CLOUD_SOURCE_PATH_INVALID');
      const current = db.prepare('SELECT value FROM metadata WHERE key=?').get('sourceFile').value;
      if (current !== expected && current !== value) throw new WorkspaceError('SOURCE_CHANGED', 409);
      db.prepare('UPDATE metadata SET value=? WHERE key=?').run(value, 'sourceFile');
      return value;
    },
    workspaceId: db.prepare('SELECT value FROM metadata WHERE key=?').get('workspaceId').value,
    sourceDescription(value) {
      if (value !== undefined) db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run('sourceDescription', json(value));
      const row = db.prepare('SELECT value FROM metadata WHERE key=?').get('sourceDescription');
      return row ? JSON.parse(row.value) : null;
    },
    drafts() {
      return db.prepare('SELECT revision,source_sha256,plan_sha256,saved_at FROM drafts ORDER BY revision DESC LIMIT 100').all()
        .map(row => ({ revision: row.revision, sourceSha256: row.source_sha256,
          planSha256: row.plan_sha256, savedAt: row.saved_at }));
    },
    saveDraft({ expectedRevision, operationId: id, sourceSha256, plan, authoring = [] }) {
      revisionNumber(expectedRevision); operationId(id);
      const bytes = encodePlan(plan), hash = sha256(bytes), authors = encodeAuthoring(authoring);
      if (Buffer.byteLength(bytes) + Buffer.byteLength(authors) > 262144)
        throw new WorkspaceError('MERCHANT_DRAFT_TOO_LARGE');
      return transaction(() => {
        const repeat = rowDraft(db.prepare('SELECT * FROM drafts WHERE operation_id=?').get(id));
        if (repeat) {
          if (repeat.planSha256 !== hash || repeat.sourceSha256 !== sourceSha256 || json(repeat.authoring) !== authors)
            throw new WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          return repeat;
        }
        const current = latest()?.revision ?? 0;
        if (current !== expectedRevision) throw new WorkspaceError('DRAFT_REVISION_CHANGED', 409,
          'Another save changed the current draft. Reopen it before saving your edits.');
        const revision = current + 1;
        db.prepare('INSERT INTO drafts(revision,operation_id,source_sha256,plan_sha256,plan,saved_at,authoring) VALUES (?,?,?,?,?,?,?)')
          .run(revision, id, sourceSha256, hash, bytes, new Date().toISOString(), authors);
        return getDraft(revision);
      });
    },
    beginPackage({ id, revision, reviewId, sourceSha256 }) {
      operationId(id); revisionNumber(revision);
      return transaction(() => {
        const repeat = getPackage(id);
        if (repeat) {
          if (repeat.revision !== revision || repeat.reviewId !== reviewId || repeat.sourceSha256 !== sourceSha256)
            throw new WorkspaceError('OPERATION_CONTENT_CONFLICT', 409);
          return { existing: true, package: repeat };
        }
        db.prepare('INSERT INTO packages(id,revision,review_id,source_sha256,state,created_at) VALUES (?,?,?,?,?,?)')
          .run(id, revision, reviewId, sourceSha256, 'PREPARING', new Date().toISOString());
        return { existing: false, package: getPackage(id) };
      });
    },
    completePackage(id, summary) {
      db.prepare("UPDATE packages SET state='READY', completed_at=?, error=NULL, summary=? WHERE id=?")
        .run(new Date().toISOString(), json(summary), operationId(id));
      return getPackage(id);
    },
    failPackage(id, code) {
      db.prepare("UPDATE packages SET state='INCOMPLETE', error=? WHERE id=?").run(code, operationId(id));
      return getPackage(id);
    },
    packages() { return db.prepare('SELECT * FROM packages ORDER BY created_at DESC LIMIT 100').all().map(rowPackage); },
    runtime() {
      const row = db.prepare('SELECT body FROM runtime WHERE id=1').get();
      return row ? JSON.parse(row.body) : { state: 'STOPPED', instanceId: null, packageId: null };
    },
    setRuntime(value) {
      db.prepare('INSERT INTO runtime(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(json(value));
      return value;
    },
    close() {
      if (closed) return;
      closed = true;
      try { db.close(); } finally { owner.close(); }
    },
  };
}
