import { DatabaseSync } from 'node:sqlite';
import { mkdir, lstat, chmod, realpath, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonical, digest, id, now, parse, requireThat, text, sha, WorkspaceError } from './common.mjs';

export async function openStore(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  requireThat(info.isDirectory() && !info.isSymbolicLink() && await realpath(root) === root, 'PRIVATE_DIRECTORY', 'Use a real private workspace directory');
  requireThat((info.mode & 0o077) === 0, 'PRIVATE_DIRECTORY', 'Workspace directory must have mode 0700');
  const file = join(root, 'workspace.sqlite');
  try { const s = await lstat(file); requireThat(s.isFile() && !s.isSymbolicLink() && (s.mode & 0o077) === 0, 'PRIVATE_DATABASE', 'Existing database must be a private regular file'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const db = new DatabaseSync(file); await chmod(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS objects_project_kind ON objects(project_id,kind,created_at DESC);
    CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY,bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (snapshot_id TEXT NOT NULL,deal_id TEXT NOT NULL,pipeline TEXT NOT NULL,owner TEXT NOT NULL,sha256 TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(snapshot_id,deal_id));
    CREATE INDEX IF NOT EXISTS records_scope ON records(snapshot_id,pipeline,owner);
    CREATE TABLE IF NOT EXISTS reviews (project_id TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(project_id,fingerprint));
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,object_id TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (scope TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key));
  `);
  const schema = db.prepare("SELECT value FROM meta WHERE key='schema'").get();
  if (schema) requireThat(schema.value === '1', 'SCHEMA_VERSION', 'Unsupported workspace database version');
  else db.prepare("INSERT INTO meta(key,value) VALUES('schema','1')").run();
  const processStart = async pid => { try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; } catch { return null; } };
  const lease = db.prepare("SELECT value FROM meta WHERE key='owner'").get();
  if (lease) {
    const owner = JSON.parse(lease.value); let alive = false;
    try { process.kill(owner.pid, 0); alive = true; } catch (e) { if (e.code === 'EPERM') alive = true; }
    if (alive && owner.processStart && await processStart(owner.pid) !== owner.processStart) alive = false;
    if (alive) { db.close(); throw new WorkspaceError('WORKSPACE_RUNNING', 'Another process owns this workspace; stop it before reopening', 409); }
  }
  const owner = { pid: process.pid, processStart: await processStart(process.pid), token: id(), startedAt: now() };
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare("SELECT value FROM meta WHERE key='owner'").get();
    if (current && current.value !== lease?.value) throw new WorkspaceError('WORKSPACE_RUNNING', 'Workspace ownership changed', 409);
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('owner',?)").run(JSON.stringify(owner)); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  let closed = false;
  const store = {
    directory: root, db,
    get(objectId, kind) {
      const row = db.prepare('SELECT kind,value FROM objects WHERE id=?').get(objectId);
      requireThat(row && (!kind || row.kind === kind), 'NOT_FOUND', 'Saved item was not found', 404); return JSON.parse(row.value);
    },
    put(kind, value) {
      db.prepare('INSERT INTO objects(id,project_id,kind,created_at,value) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, value.projectId ?? value.id, kind, value.createdAt ?? now(), JSON.stringify(value)); return value;
    },
    list(projectId, kind, { offset = 0, limit = 100 } = {}) {
      return db.prepare('SELECT value FROM objects WHERE project_id=? AND kind=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(projectId, kind, limit, offset).map(x => JSON.parse(x.value));
    },
    all(kind) { return db.prepare('SELECT value FROM objects WHERE kind=? ORDER BY created_at DESC,id DESC').all(kind).map(x => JSON.parse(x.value)); },
    event(projectId, objectId, kind, value) { db.prepare('INSERT INTO events(project_id,object_id,kind,at,value) VALUES(?,?,?,?,?)').run(projectId, objectId, kind, now(), JSON.stringify(value)); },
    events(projectId, objectId = null, limit = 100) {
      return (objectId ? db.prepare('SELECT * FROM events WHERE project_id=? AND object_id=? ORDER BY seq DESC LIMIT ?').all(projectId, objectId, limit) : db.prepare('SELECT * FROM events WHERE project_id=? ORDER BY seq DESC LIMIT ?').all(projectId, limit)).map(x => ({ seq: x.seq, objectId: x.object_id, kind: x.kind, at: x.at, ...JSON.parse(x.value) }));
    },
    file(projectId, name, bytes) {
      const hash = sha(bytes); db.prepare('INSERT OR IGNORE INTO blobs(id,bytes) VALUES(?,?)').run(hash, bytes);
      const file = { id: id(), projectId, name: text(name, 'filename', 240), sha256: hash, bytes: bytes.length, createdAt: now() };
      db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?)').run(file.id, projectId, file.name, hash, bytes.length, file.createdAt); return file;
    },
    readFile(fileId) {
      const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId); requireThat(file, 'NOT_FOUND', 'Original file was not found', 404);
      const row = db.prepare('SELECT bytes FROM blobs WHERE id=?').get(file.sha256); requireThat(row, 'SOURCE_MISSING', 'Original source bytes are missing');
      const bytes = Buffer.from(row.bytes); requireThat(bytes.length === file.size && sha(bytes) === file.sha256, 'SOURCE_CHANGED', 'Original source bytes changed');
      return { id: file.id, projectId: file.project_id, name: file.name, sha256: file.sha256, bytes: bytes.length, createdAt: file.created_at, data: bytes };
    },
    transaction(work) { db.exec('BEGIN IMMEDIATE'); try { const value = work(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    mutation(scope, input, work) {
      text(input.requestId, 'requestId', 120); text(input.actor, 'actor');
      const fingerprint = digest(input), previous = db.prepare('SELECT * FROM requests WHERE scope=? AND key=?').get(scope, input.requestId);
      if (previous) { requireThat(previous.fingerprint === fingerprint, 'REQUEST_CONFLICT', 'This request ID was already used for different inputs', 409); return JSON.parse(previous.value); }
      return store.transaction(() => {
        const result = work(); db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(scope, input.requestId, fingerprint, JSON.stringify(result)); return result;
      });
    },
    project(projectId, revision) {
      const project = store.get(projectId, 'project');
      if (revision !== undefined) requireThat(revision === project.revision, 'STALE_REVISION', `Project is now revision ${project.revision}; refresh and reapply your changes`, 409);
      return project;
    },
    bump(project, actor, kind, details = {}) {
      project = { ...project, revision: project.revision + 1, updatedAt: now() }; store.put('project', project); store.event(project.id, project.id, kind, { actor, ...details }); return project;
    },
    close() {
      if (closed) return; closed = true;
      const current = db.prepare("SELECT value FROM meta WHERE key='owner'").get();
      if (current && JSON.parse(current.value).token === owner.token) db.prepare("DELETE FROM meta WHERE key='owner'").run();
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();
    }
  };
  return store;
}
