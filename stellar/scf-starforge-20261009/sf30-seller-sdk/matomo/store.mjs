// MIT. Durable source reads and action identities on the original private workspace lease.
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, link, unlink, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWorkspace, privateDirectory, readPrivate as rawReadPrivate, createFile, syncDirectory, identity, digest, bytes, fault, stamp } from '../postgres/publisher/files.mjs';
import { sourceConfig, identifier, safeError } from './contract.mjs';
import { parseNative } from './values.mjs';
import { createMatomoSource } from './provider.mjs';

const SETTINGS = 'stellar-forge.matomo-workspace.v1';
async function recoverPending(path) {
  const pending = path + '.matomo-pending';
  let a, b;
  try { a = await lstat(pending); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!a.isFile() || a.isSymbolicLink() || a.mode & 0o077 || a.nlink > 2) throw fault('MATOMO_STAGING_FILE_INVALID');
  try { b = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (a.dev === b.dev && a.ino === b.ino) { await unlink(pending); await syncDirectory(dirname(path)); }
}
export async function readRetained(path, limit = 16777216) {
  await recoverPending(path);
  return rawReadPrivate(path, limit);
}
export async function readRetainedJson(path, limit = 16777216) {
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readRetained(path, limit)));
}
const readPrivate = readRetained, readJson = readRetainedJson;
export async function writeNew(path, content) {
  const data = Buffer.from(content), pending = path + '.matomo-pending';
  await recoverPending(path);
  try {
    const existing = await readPrivate(path, Math.max(data.length, 1));
    if (!existing.equals(data)) throw fault('MATOMO_FILE_CONFLICT', 'The retained output already contains different bytes.', 409);
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let owned = false;
  try {
    try {
      const stat = await lstat(pending);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077) throw fault('MATOMO_STAGING_FILE_INVALID');
      // This exact pending name belongs to this immutable destination under the
      // original workspace lease. An incomplete prior write is not a result.
      await unlink(pending);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    owned = true; await createFile(pending, data);
    try { await link(pending, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readPrivate(path, Math.max(data.length, 1));
      if (!existing.equals(data)) throw fault('MATOMO_FILE_CONFLICT', 'The retained output already contains different bytes.', 409);
    }
  } finally {
    if (owned) await unlink(pending).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  await syncDirectory(dirname(path));
}
export async function openMatomoStore({directory, create = false, source, environment = process.env, allowLoopback = false, receivingOperationId} = {}) {
  let initializing = create;
  if (create) {
    try {
      await lstat(directory);
      const existing = await readJson(join(directory, 'workspace.json'), 65536);
      if (existing.schema !== SETTINGS || identity(sourceConfig(source, {allowLoopback})) !== existing.sourceSha256)
        throw fault('MATOMO_WORKSPACE_EXISTS', 'Reopen the original workspace with its saved source.', 409);
      create = false; initializing = false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        const names = await readdir(directory);
        if (names.some(name => name !== 'workspace.json.matomo-pending' && name !== 'publisher.lock')) throw fault('MATOMO_WORKSPACE_NOT_EMPTY');
      } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    }
  }
  await privateDirectory(directory, initializing);
  const release = await acquireWorkspace(directory); let db;
  try {
    const settingsPath = join(directory, 'workspace.json');
    if (create) {
      const config = sourceConfig(source, {allowLoopback});
      await writeNew(settingsPath, bytes({schema: SETTINGS, id: randomUUID(), createdAt: stamp(), initializationVersion: 1, source: config, sourceSha256: identity(config)}));
    }
    const settings = await readJson(settingsPath, 65536);
    if (settings.schema !== SETTINGS || identity(settings.source) !== settings.sourceSha256 ||
        source && identity(sourceConfig(source, {allowLoopback})) !== settings.sourceSha256) throw fault('MATOMO_WORKSPACE_SOURCE_CHANGED');
    sourceConfig(settings.source, {allowLoopback});
    let receiving = null, received = null;
    try { receiving = await readJson(join(directory, 'product-receiving.json'), 65536); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receiving) {
      try { received = await readJson(join(directory, 'product-received.json'), 1048576); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (receiving.schema !== 'stellar-forge.matomo-product-receiving.v1' ||
          received && (received.schema !== 'stellar-forge.matomo-product-received.v1' ||
            received.operationId !== receiving.operationId || received.requestSha256 !== receiving.requestSha256 ||
            received.workspaceId !== settings.id))
        throw fault('MATOMO_PRODUCT_RECEIVING_CHANGED');
      if (!received && receiving.operationId !== receivingOperationId)
        throw fault('MATOMO_PRODUCT_RECEIVING_INCOMPLETE', 'Continue the original matomo-product receive command before opening this workspace.', 409);
    }
    const initializedPath = join(directory, 'initialized.json');
    let initialized = null;
    try { initialized = await readJson(initializedPath, 4096); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (initialized && (initialized.schema !== 'stellar-forge.matomo-initialization.v1' ||
        initialized.workspaceId !== settings.id || initialized.sourceSha256 !== settings.sourceSha256)) throw fault('MATOMO_WORKSPACE_INITIALIZATION_CHANGED');
    for (const name of ['requests', 'catalogs', 'captures', 'editions', 'comparisons', 'merchant', 'deliveries']) await privateDirectory(join(directory, name), true);
    const database = join(directory, 'matomo.sqlite');
    let absent = false;
    try {
      const stat = await lstat(database);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077) throw fault('MATOMO_PRIVATE_DATABASE_REQUIRED');
    } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
    if (absent && !create && !(settings.initializationVersion === 1 && initialized === null)) throw fault('MATOMO_WORKSPACE_DATABASE_MISSING');
    db = new DatabaseSync(database); await chmod(database, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    db.exec([
      'CREATE TABLE IF NOT EXISTS state(name TEXT PRIMARY KEY,value TEXT NOT NULL);',
      "INSERT OR IGNORE INTO state(name,value) VALUES('revision','0');",
      'CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_hash TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);',
      'CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,accepted_attempt INTEGER,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS attempts(request_id TEXT NOT NULL REFERENCES requests(id),number INTEGER NOT NULL,state TEXT NOT NULL,request TEXT NOT NULL,result TEXT,body_path TEXT,created_at TEXT NOT NULL,PRIMARY KEY(request_id,number));',
      'CREATE TABLE IF NOT EXISTS catalogs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,selection TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS capture_tables(capture_id TEXT NOT NULL REFERENCES captures(id),id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(capture_id,id));',
      'CREATE TABLE IF NOT EXISTS report_rows(capture_id TEXT NOT NULL REFERENCES captures(id),id TEXT NOT NULL,table_id TEXT NOT NULL,row_index INTEGER NOT NULL,source_request TEXT NOT NULL,source_index INTEGER NOT NULL,data_json TEXT NOT NULL,metadata_json TEXT NOT NULL,context TEXT NOT NULL,PRIMARY KEY(capture_id,id),UNIQUE(capture_id,table_id,row_index));',
      'CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,capture_id TEXT NOT NULL REFERENCES captures(id),state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS history(sequence INTEGER PRIMARY KEY,kind TEXT NOT NULL,subject TEXT,data TEXT NOT NULL,created_at TEXT NOT NULL);',
    ].join('\n'));
    await writeNew(initializedPath, bytes({schema: 'stellar-forge.matomo-initialization.v1',
      workspaceId: settings.id, sourceSha256: settings.sourceSha256}));
    db.prepare("UPDATE actions SET state='INTERRUPTED',error=? WHERE state='RUNNING'").run(JSON.stringify({code:'MATOMO_PROCESS_INTERRUPTED'}));
    db.prepare("UPDATE requests SET state='INTERRUPTED' WHERE state='RUNNING'").run();
    db.prepare("UPDATE attempts SET state='INTERRUPTED' WHERE state='RUNNING'").run();
    db.prepare("UPDATE captures SET state='INTERRUPTED' WHERE state='CAPTURING'").run();
    const sourceClient = () => client ??= createMatomoSource(settings.source, {env: environment, allowLoopback});
    let client, active = null, closed = false, closing;
    let beforeReleaseDone = false, clientClosed = false, databaseClosed = false, leaseReleased = false;
    function transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const revision = () => Number(db.prepare("SELECT value FROM state WHERE name='revision'").get().value);
    const bump = () => { const next = revision() + 1; db.prepare("UPDATE state SET value=? WHERE name='revision'").run(String(next)); return next; };
    function event(kind, subject, data = {}) {
      db.prepare('INSERT INTO history(kind,subject,data,created_at) VALUES(?,?,?,?)').run(kind, subject ?? null, JSON.stringify(data), stamp());
      return bump();
    }
    function action(id) {
      const row = db.prepare('SELECT * FROM actions WHERE id=?').get(id);
      return row ? {...row, input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null} : null;
    }
    async function perform(kind, input, fn) {
      if (closed) throw fault('MATOMO_WORKSPACE_CLOSED');
      const id = identifier(input.operationId), exact = identity({kind, input}), previous = action(id);
      if (previous) {
        if (previous.kind !== kind || previous.input_hash !== exact) throw fault('MATOMO_OPERATION_ID_CONFLICT', 'Use the original immutable request or a new operation ID.', 409);
        if (previous.state === 'COMPLETE') return previous.result;
        if (active?.id === id) return active.promise;
        throw fault('MATOMO_OPERATION_INCOMPLETE', 'Inspect the original action and resume its retained source or edition explicitly.', 409);
      }
      if (active) throw fault('MATOMO_WORKSPACE_BUSY', 'The displayed operation is still running.', 409);
      if (input.expectedRevision !== revision()) throw fault('MATOMO_REVISION_CHANGED', 'Refresh the current workspace before this new action.', 409);
      const controller = new AbortController(), task = {id, kind, controller, promise: null};
      transaction(() => {
        db.prepare('INSERT INTO actions(id,kind,input_hash,input,state,started_at) VALUES(?,?,?,?,?,?)').run(id, kind, exact, JSON.stringify(input), 'RUNNING', stamp());
        event('ACTION_STARTED', id, {kind});
      });
      active = task;
      task.promise = (async () => {
        try {
          const result = await fn({signal: controller.signal, operationId: id});
          return transaction(() => {
            db.prepare("UPDATE actions SET state='COMPLETE',result=?,finished_at=? WHERE id=?").run(JSON.stringify(result), stamp(), id);
            event('ACTION_COMPLETED', id, {kind}); return result;
          });
        } catch (error) {
          transaction(() => {
            const state = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
            db.prepare('UPDATE actions SET state=?,error=?,finished_at=? WHERE id=?').run(state, JSON.stringify(safeError(error)), stamp(), id);
            event('ACTION_STOPPED', id, {kind, code: safeError(error).code});
          });
          throw error;
        } finally { if (active === task) active = null; }
      })();
      return task.promise;
    }
    async function request(owner, kind, input, {signal, retry = false} = {}) {
      const id = identity({source: settings.sourceSha256, owner, kind, input});
      let retained = db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      if (retained?.state === 'COMPLETE') {
        const item = db.prepare('SELECT * FROM attempts WHERE request_id=? AND number=?').get(id, retained.accepted_attempt);
        const result = JSON.parse(item.result), raw = await readPrivate(join(directory, item.body_path), settings.source.maxResponseBytes);
        if (digest(raw) !== result.bodySha256 || raw.length !== result.bodyBytes) throw fault('MATOMO_RETAINED_RESPONSE_CHANGED');
        return {id, result, raw, value: parseNative(raw), reused: true};
      }
      if (retained && retained.state !== 'COMPLETE') {
        const receiptPath = join(directory, 'requests', id + '-' + retained.attempts + '.receipt.json');
        let receipt = null;
        try { receipt = await readJson(receiptPath, 131072); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (receipt) {
          if (receipt.schema !== 'stellar-forge.matomo-read-receipt.v1' || receipt.requestId !== id ||
              receipt.attempt !== retained.attempts || receipt.inputHash !== identity(input) ||
              receipt.sourceSha256 !== settings.sourceSha256) throw fault('MATOMO_RETAINED_READ_CHANGED');
          const metadata = receipt.result;
          let recovered = null;
          if (receipt.bodyPath !== null) {
            if (receipt.bodyPath !== 'requests/' + id + '-' + retained.attempts + '.json') throw fault('MATOMO_RETAINED_READ_CHANGED');
            recovered = await readPrivate(join(directory, receipt.bodyPath), settings.source.maxResponseBytes);
            if (digest(recovered) !== metadata.bodySha256 || recovered.length !== metadata.bodyBytes) throw fault('MATOMO_RETAINED_RESPONSE_CHANGED');
          }
          transaction(() => {
            db.prepare('UPDATE attempts SET state=?,result=?,body_path=? WHERE request_id=? AND number=?')
              .run(metadata.ok ? 'COMPLETE' : 'FAILED', JSON.stringify(metadata), receipt.bodyPath, id, retained.attempts);
            db.prepare('UPDATE requests SET state=?,accepted_attempt=? WHERE id=?').run(metadata.ok ? 'COMPLETE' : 'FAILED', metadata.ok ? retained.attempts : null, id);
            event('SOURCE_READ_RECOVERED', owner, {requestId: id, attempt: retained.attempts, ok: metadata.ok});
          });
          if (metadata.ok) {
            if (!recovered) throw fault('MATOMO_RETAINED_RESPONSE_MISSING');
            return {id, result: metadata, raw: recovered, value: parseNative(recovered), reused: true};
          }
        }
      }
      if (retained && !retry) throw fault('MATOMO_READ_RETRY_REQUIRED', 'Resume the retained read explicitly; its prior outcome remains recorded.', 409);
      const native = sourceClient(), declared = native.describeRequest(kind, input);
      const number = (retained?.attempts ?? 0) + 1;
      transaction(() => {
        if (!retained) db.prepare('INSERT INTO requests(id,owner,kind,input,state,attempts,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(id, owner, kind, JSON.stringify(input), 'RUNNING', number, stamp());
        else db.prepare("UPDATE requests SET state='RUNNING',attempts=? WHERE id=?").run(number, id);
        db.prepare('INSERT INTO attempts(request_id,number,state,request,created_at) VALUES(?,?,?,?,?)')
          .run(id, number, 'RUNNING', JSON.stringify(declared), stamp());
        event('SOURCE_READ_STARTED', owner, {requestId: id, attempt: number, kind});
      });
      let result, raw, bodyPath = null;
      try {
        const response = await native.read(kind, input, {signal}); raw = response.body;
        const {body, ...metadata} = response; result = metadata;
        if (raw) {
          bodyPath = 'requests/' + id + '-' + number + '.json';
          await writeNew(join(directory, bodyPath), raw);
        }
        await writeNew(join(directory, 'requests', id + '-' + number + '.receipt.json'), bytes({
          schema: 'stellar-forge.matomo-read-receipt.v1', requestId: id, attempt: number, inputHash: identity(input),
          sourceSha256: settings.sourceSha256, result, bodyPath}));
        transaction(() => {
          db.prepare('UPDATE attempts SET state=?,result=?,body_path=? WHERE request_id=? AND number=?')
            .run(result.ok ? 'COMPLETE' : 'FAILED', JSON.stringify(result), bodyPath, id, number);
          db.prepare('UPDATE requests SET state=?,accepted_attempt=? WHERE id=?').run(result.ok ? 'COMPLETE' : 'FAILED', result.ok ? number : null, id);
          event('SOURCE_READ_COMPLETED', owner, {requestId: id, attempt: number, status: result.status, bytes: result.bodyBytes, ok: result.ok});
        });
        if (!result.ok) throw fault(result.error ?? 'MATOMO_SOURCE_READ_FAILED', 'The retained native Matomo read did not complete successfully.', result.status >= 400 ? result.status : 502);
        return {id, result, raw, value: parseNative(raw), reused: false};
      } catch (error) {
        if (!result) transaction(() => {
          db.prepare("UPDATE attempts SET state='INTERRUPTED',result=? WHERE request_id=? AND number=?").run(JSON.stringify({error: safeError(error), responseRetained: false}), id, number);
          db.prepare("UPDATE requests SET state='INTERRUPTED' WHERE id=?").run(id); event('SOURCE_READ_INTERRUPTED', owner, {requestId: id, attempt: number, error: safeError(error)});
        });
        throw error;
      }
    }
    function state() {
      const rows = table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid DESC LIMIT 100').all().map(row => ({...row,
        ...(row.data ? {data: JSON.parse(row.data)} : {}), ...(row.scope ? {scope: JSON.parse(row.scope)} : {}),
        ...(row.selection ? {selection: JSON.parse(row.selection)} : {})}));
      return {schema: SETTINGS, workspaceId: settings.id, revision: revision(), source: settings.source, sourceSha256: settings.sourceSha256,
        active: active ? {id: active.id, kind: active.kind} : null,
        catalogs: rows('catalogs'), captures: rows('captures'), editions: rows('editions'), comparisons: rows('comparisons'), deliveries: rows('deliveries'),
        actions: db.prepare('SELECT id FROM actions ORDER BY rowid DESC LIMIT 30').all().map(row => action(row.id)),
        history: db.prepare('SELECT * FROM history ORDER BY sequence DESC LIMIT 50').all().map(row => ({...row, data: JSON.parse(row.data)}))};
    }
    function cancel(id) {
      if (!active || active.id !== id) throw fault('MATOMO_OPERATION_NOT_ACTIVE', 'Read the retained action before another cancellation.', 409);
      active.controller.abort(); return {operationId: id, cancelling: true};
    }
    async function close({beforeRelease} = {}) {
      if (closing) return closing;
      closed = true; active?.controller.abort();
      const pending = (async () => {
        await active?.promise?.catch(() => {});
        // Keep this original lease while its owning model drains merchant
        // processes. Failed cleanup retains the same instance for an explicit retry.
        if (!beforeReleaseDone) { await beforeRelease?.(); beforeReleaseDone = true; }
        if (!clientClosed) { await client?.close(); clientClosed = true; }
        if (!databaseClosed) { db.close(); databaseClosed = true; }
        if (!leaseReleased) { await release(); leaseReleased = true; }
      })();
      closing = pending;
      void pending.catch(() => { if (closing === pending) closing = null; });
      return pending;
    }
    return {directory, settings, db, transaction, revision, bump, event, state, action, perform, request, cancel, close};
  } catch (error) { db?.close(); await release(); throw error; }
}
