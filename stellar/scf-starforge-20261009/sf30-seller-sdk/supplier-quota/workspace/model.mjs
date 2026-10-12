// MIT. Durable supplier configuration around the original upstream file and quota ledger.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, withPrivateLock } from '../../routescan/quota.mjs';
import { createSupplierQuotaRegistry } from '../application.mjs';
import { readSupplierQuotas } from '../../operations/supplier-quotas.mjs';
import { plain, clone, json, digest, equal, need, fail, parseSource, configurationView,
  retainIdentities, composeProposal, makeReview, restoreProposal, verifyOwnedChange } from './plan.mjs';

export const SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA = 'stellar-forge.supplier-account-workspace.v1';
export const SUPPLIER_ACCOUNT_BACKUP_SCHEMA = 'stellar-forge.supplier-account-backup.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const statuses = ['PREPARED', 'APPLYING', 'APPLIED', 'CONFLICT', 'CANCELLED'];
const iso = () => new Date().toISOString();
const codeOf = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'SUPPLIER_WORKSPACE_OPERATION_FAILED';
const owns = info => process.getuid === undefined || info.uid === process.getuid();
const safeChange = row => ({ id: row.id, revision: row.revision, status: row.status,
  createdAt: row.createdAt, updatedAt: row.updatedAt, reviewSha256: row.reviewSha256,
  review: clone(row.review), outcome: clone(row.outcome) });
const sourceView = source => ({ path: source.path, sha256: source.sha256, bytes: source.bytes,
  device: source.device, inode: source.inode, readAt: source.readAt });
const statSame = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function selectedParent(path) {
  need(typeof path === 'string' && path === resolve(path) && !path.includes('\0'), 'SUPPLIER_SOURCE_PATH_INVALID');
  const parent = dirname(path), info = await lstat(parent);
  need(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) && owns(info) &&
    await realpath(parent) === parent, 'SUPPLIER_SOURCE_PRIVATE_PARENT_REQUIRED');
  return parent;
}

/** Read original bytes and file identity; never resolve credential references. */
export async function inspectSupplierAccountSource(path) {
  await selectedParent(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && owns(first) && first.size <= 1048576,
      'SUPPLIER_SOURCE_FILE_INVALID');
    const bytes = await handle.readFile(), last = await handle.stat(), named = await lstat(path);
    need(bytes.length <= 1048576 && statSame(first, last) && named.dev === first.dev &&
      named.ino === first.ino && !named.isSymbolicLink(), 'SUPPLIER_SOURCE_CHANGED', 409);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { path, sha256: digest(bytes), bytes: bytes.length, text, config: parseSource(text),
      device: String(first.dev), inode: String(first.ino), mode: first.mode & 0o777, readAt: iso() };
  } finally { await handle.close(); }
}

async function finishPending(path, expected, source) {
  const target = Buffer.from(expected), handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && owns(first) && !(first.mode & 0o077) && first.size <= target.length,
      'SUPPLIER_PENDING_FILE_CHANGED', 409);
    const bytes = await handle.readFile(), after = await handle.stat(), named = await lstat(path);
    need(bytes.length === first.size && statSame(first, after) && named.dev === first.dev && named.ino === first.ino && !named.isSymbolicLink() &&
      bytes.equals(target.subarray(0, bytes.length)), 'SUPPLIER_PENDING_FILE_CHANGED', 409);
    const current = await inspectSupplierAccountSource(source.path);
    need(current.sha256 === source.sha256 && current.device === source.device && current.inode === source.inode,
      'SUPPLIER_SOURCE_CHANGED', 409);
    // A terminated write retains a prefix of this exact reviewed output. Finish
    // that same private inode while both original transaction locks are held.
    let position = bytes.length;
    while (position < target.length) {
      const written = await handle.write(target, position, target.length - position, position);
      need(written.bytesWritten > 0, 'SUPPLIER_PENDING_WRITE_INCOMPLETE', 503);
      position += written.bytesWritten;
    }
    await handle.sync();
    const last = await handle.stat(), stillNamed = await lstat(path);
    need(last.size === target.length && last.dev === first.dev && last.ino === first.ino &&
      stillNamed.dev === first.dev && stillNamed.ino === first.ino && !stillNamed.isSymbolicLink(),
    'SUPPLIER_PENDING_FILE_CHANGED', 409);
  } finally { await handle.close(); }
}

async function publishSource(source, row) {
  const parent = await selectedParent(source.path);
  const temporary = join(parent, '.' + basename(source.path) + '.supplier-' + row.id + '.pending');
  let file, created = false;
  try {
    try {
      file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      await file.writeFile(row.afterText); await file.sync(); await file.close(); file = null;
    } catch (error) {
      await file?.close().catch(() => {}); file = null;
      if (error.code !== 'EEXIST') {
        if (created) await unlink(temporary).catch(() => {});
        throw error;
      }
      await finishPending(temporary, row.afterText, source);
    }
    const current = await inspectSupplierAccountSource(source.path);
    need(current.sha256 === source.sha256 && current.device === source.device && current.inode === source.inode,
      'SUPPLIER_SOURCE_CHANGED', 409);
    await rename(temporary, source.path);
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    const saved = await inspectSupplierAccountSource(source.path);
    need(saved.sha256 === row.review.target.sha256, 'SUPPLIER_SAVED_SOURCE_CHANGED', 409);
    return saved;
  } finally { await file?.close().catch(() => {}); }
}

export async function openSupplierAccountWorkspace({ directory, upstreamsFile, createOnly = false } = {}) {
  await privateDirectory(directory);
  need(owns(await lstat(directory)), 'SUPPLIER_WORKSPACE_OWNER_REQUIRED');
  const databaseFile = join(directory, 'supplier-accounts.sqlite');
  let db, sourcePath, closed = false, closing, pending = Promise.resolve();
  await withPrivateLock(directory, 'workspace.lock', async () => {
    let existed = true;
    try {
      const info = await lstat(databaseFile);
      need(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && !(info.mode & 0o077) && owns(info),
        'SUPPLIER_WORKSPACE_DATABASE_INVALID');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      existed = false;
      need(typeof upstreamsFile === 'string', 'SUPPLIER_UPSTREAM_FILE_REQUIRED');
      const handle = await open(databaseFile, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.close();
    }
    need(!createOnly || !existed, 'SUPPLIER_RESTORE_REQUIRES_NEW_WORKSPACE', 409);
    db = new DatabaseSync(databaseFile);
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; ' +
        'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); ' +
        'CREATE TABLE IF NOT EXISTS changes (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, row TEXT NOT NULL); ' +
        'CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);');
      const existing = db.prepare('SELECT value FROM metadata WHERE key=?').get('workspace');
      if (existing) {
        const meta = JSON.parse(existing.value);
        need(meta.schema === SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA && UUID.test(meta.id ?? '') && typeof meta.sourcePath === 'string',
          'SUPPLIER_WORKSPACE_CHANGED');
        need(upstreamsFile === undefined || upstreamsFile === meta.sourcePath, 'SUPPLIER_WORKSPACE_SOURCE_CHANGED', 409);
        sourcePath = meta.sourcePath;
      } else {
        const original = await inspectSupplierAccountSource(upstreamsFile);
        sourcePath = original.path;
        const meta = { schema: SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA, id: randomUUID(), createdAt: iso(),
          sourcePath, initialSourceSha256: original.sha256, initialSourceText: original.text,
          identities: retainIdentities({}, original.config) };
        db.prepare('INSERT INTO metadata (key,value) VALUES (?,?)').run('workspace', json(meta));
      }
    } catch (error) { db.close(); db = null; throw error; }
  });

  const metadata = () => JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get('workspace').value);
  const saveMetadata = meta => db.prepare('UPDATE metadata SET value=? WHERE key=?').run(json(meta), 'workspace');
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function record(id) {
    need(UUID.test(id ?? ''), 'SUPPLIER_CHANGE_ID_INVALID');
    const row = db.prepare('SELECT row FROM changes WHERE id=?').get(id);
    need(row, 'SUPPLIER_CHANGE_NOT_FOUND', 404);
    return JSON.parse(row.row);
  }
  function save(row, kind, data = {}) {
    db.prepare('UPDATE changes SET row=? WHERE id=?').run(json(row), row.id);
    db.prepare('INSERT INTO events (change_id,at,kind,data) VALUES (?,?,?,?)').run(row.id, iso(), kind, json(data));
  }
  function run(work) {
    if (closed) return Promise.reject(Object.assign(new Error('SUPPLIER_WORKSPACE_CLOSED'), { code: 'SUPPLIER_WORKSPACE_CLOSED' }));
    const result = pending.then(() => withPrivateLock(directory, 'workspace.lock', work));
    pending = result.catch(() => {});
    return result;
  }
  async function current() {
    const source = await inspectSupplierAccountSource(sourcePath);
    retainIdentities(metadata().identities, source.config);
    return source;
  }
  function addReview(source, next, note = '', restores = null, rebases = null, targetText) {
    const id = randomUUID(), at = iso();
    const built = makeReview({ id, createdAt: at, source, before: source.config, after: next, note, restores, rebases, targetText });
    const row = { id, revision: 0, status: 'PREPARED', createdAt: at, updatedAt: at,
      review: built.review, reviewSha256: built.reviewSha256, beforeText: source.text, afterText: built.afterText, outcome: null };
    transaction(() => {
      const meta = metadata();
      meta.identities = retainIdentities(meta.identities, source.config);
      saveMetadata(meta);
      db.prepare('INSERT INTO changes (id,row) VALUES (?,?)').run(id, json(row));
      if (rebases) {
        const previous = record(rebases);
        save({ ...previous, status: 'CANCELLED', revision: previous.revision + 1, updatedAt: at,
          outcome: { state: 'REVIEW_CONTINUED', changeId: id } }, 'REVIEW_CONTINUED', { changeId: id });
      }
      db.prepare('INSERT INTO events (change_id,at,kind,data) VALUES (?,?,?,?)').run(id, at, 'PREPARED', json({ restores, rebases }));
    });
    return safeChange(row);
  }

  async function applyChange({ id, revision, reviewSha256 }, recover) {
    let row = record(id);
    need(HASH.test(reviewSha256 ?? '') && row.reviewSha256 === reviewSha256,
      'SUPPLIER_REVIEW_CHANGED', 409);
    if (row.status === 'APPLIED') return safeChange(row);
    need(Number.isSafeInteger(revision) && revision === row.revision, 'SUPPLIER_CHANGE_REVISION_CHANGED', 409);
    need(recover ? row.status === 'APPLYING' : row.status === 'PREPARED', 'SUPPLIER_CHANGE_STATE_CHANGED', 409);
    const parent = await selectedParent(sourcePath);
    return withPrivateLock(parent, '.supplier-accounts-' + digest(sourcePath) + '.lock', async () => {
      try {
        const source = await current();
        // A previous save may have completed while its caller lost the response.
        if (row.status === 'APPLYING' && source.sha256 === row.review.target.sha256) {
          row = { ...row, status: 'APPLIED', revision: row.revision + 1, updatedAt: iso(),
            outcome: { state: 'SAVED', recovered: true, source: sourceView(source) } };
          transaction(() => {
            const meta = metadata(); meta.identities = retainIdentities(meta.identities, source.config); saveMetadata(meta);
            save(row, 'RECOVERED_SAVED', row.outcome);
          });
          return safeChange(row);
        }
        need(source.sha256 === row.review.source.sha256 && source.device === row.review.source.device &&
          source.inode === row.review.source.inode, 'SUPPLIER_SOURCE_CHANGED', 409);
        const before = parseSource(row.beforeText), after = parseSource(row.afterText);
        verifyOwnedChange(before, after);
        retainIdentities(retainIdentities(metadata().identities, before), after);
        if (row.status === 'PREPARED') {
          row = { ...row, status: 'APPLYING', revision: row.revision + 1, updatedAt: iso(), outcome: { state: 'SAVE_STARTED' } };
          transaction(() => save(row, 'SAVE_STARTED'));
        }
        const saved = await publishSource(source, row);
        row = { ...row, status: 'APPLIED', revision: row.revision + 1, updatedAt: iso(),
          outcome: { state: 'SAVED', recovered: recover, source: sourceView(saved) } };
        transaction(() => {
          const meta = metadata(); meta.identities = retainIdentities(meta.identities, after); saveMetadata(meta);
          save(row, 'SAVED', row.outcome);
        });
        return safeChange(row);
      } catch (error) {
        const code = codeOf(error), conflict = ['SUPPLIER_SOURCE_CHANGED', 'SUPPLIER_SAVED_SOURCE_CHANGED',
          'SUPPLIER_ACCOUNT_IDENTITY_CHANGED', 'SUPPLIER_ACCOUNT_IDENTITY_ALREADY_RETAINED'].includes(code);
        let retained = row;
        try { retained = record(id); } catch {}
        const failed = { ...retained, status: conflict ? 'CONFLICT' : retained.status,
          revision: retained.revision + 1, updatedAt: iso(), outcome: { state: conflict ? 'SOURCE_CONFLICT' : 'SAVE_INTERRUPTED', code } };
        try { transaction(() => save(failed, failed.outcome.state, failed.outcome)); } catch {}
        throw Object.assign(error, { changeId: id });
      }
    });
  }

  const api = {
    directory,
    async view({ offset = 0, limit = 50 } = {}) {
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200,
        'SUPPLIER_HISTORY_PAGE_INVALID');
      return run(async () => {
        const meta = metadata();
        let source = null, configuration = null, sourceError = null;
        try { const selected = await current(); source = sourceView(selected); configuration = configurationView(selected.config); }
        catch (error) { sourceError = codeOf(error); }
        const total = db.prepare('SELECT count(*) AS total FROM changes').get().total;
        const changes = db.prepare('SELECT row FROM changes ORDER BY sequence DESC LIMIT ? OFFSET ?').all(limit, offset)
          .map(value => safeChange(JSON.parse(value.row)));
        return { schema: SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA, id: meta.id, createdAt: meta.createdAt,
          capturedAt: iso(), source, sourceError, configuration, knownAccounts: clone(meta.identities),
          history: { offset, limit, total, changes },
          activation: 'Saved account changes take effect when the original merchant next starts.' };
      });
    },
    read(id) { return run(() => safeChange(record(id))); },
    prepare({ sourceSha256, accounts, assignments, note = '' }) {
      return run(async () => {
        const source = await current();
        need(HASH.test(sourceSha256 ?? '') && source.sha256 === sourceSha256, 'SUPPLIER_SOURCE_CHANGED', 409);
        return addReview(source, composeProposal(source.config, { accounts, assignments }, metadata().identities), note);
      });
    },
    prepareRestore({ id, sourceSha256, note = '' }) {
      return run(async () => {
        const original = record(id);
        need(original.status === 'APPLIED', 'SUPPLIER_RESTORE_REQUIRES_APPLIED_CHANGE', 409);
        const source = await current();
        need(HASH.test(sourceSha256 ?? '') && source.sha256 === sourceSha256, 'SUPPLIER_SOURCE_CHANGED', 409);
        const exact = source.sha256 === original.review.target.sha256;
        const next = exact ? parseSource(original.beforeText) :
          restoreProposal(source.config, parseSource(original.beforeText), parseSource(original.afterText), metadata().identities);
        retainIdentities(retainIdentities(metadata().identities, source.config), next);
        return addReview(source, next, note, id, null, exact ? original.beforeText : undefined);
      });
    },
    prepareRebase({ id, sourceSha256, note = '' }) {
      return run(async () => {
        const original = record(id);
        need(['PREPARED', 'CONFLICT', 'APPLYING'].includes(original.status), 'SUPPLIER_REBASE_REQUIRES_REVIEW', 409);
        const source = await current();
        need(HASH.test(sourceSha256 ?? '') && source.sha256 === sourceSha256, 'SUPPLIER_SOURCE_CHANGED', 409);
        if (original.status === 'APPLYING')
          need(source.sha256 === original.review.source.sha256 &&
            (source.path !== original.review.source.path || source.device !== original.review.source.device ||
              source.inode !== original.review.source.inode),
          'SUPPLIER_RECOVER_ORIGINAL_SAVE_FIRST', 409);
        const next = restoreProposal(source.config, parseSource(original.afterText), parseSource(original.beforeText), metadata().identities);
        return addReview(source, next, note, null, id,
          source.sha256 === original.review.source.sha256 ? original.afterText : undefined);
      });
    },
    apply(input) { return run(() => applyChange(input, false)); },
    recover(input) { return run(() => applyChange(input, true)); },
    cancel({ id, revision }) {
      return run(() => {
        const row = record(id);
        need(row.revision === revision && ['PREPARED', 'CONFLICT'].includes(row.status), 'SUPPLIER_CHANGE_STATE_CHANGED', 409);
        const next = { ...row, status: 'CANCELLED', revision: row.revision + 1, updatedAt: iso() };
        transaction(() => save(next, 'CANCELLED'));
        return safeChange(next);
      });
    },
    inspectQuota() {
      return run(async () => {
        const source = await current(), registry = createSupplierQuotaRegistry(source.config);
        try { return { source: sourceView(source), snapshot: await readSupplierQuotas({ supplierQuotaSnapshot: () => registry.snapshot() }) }; }
        finally { await registry.close(); }
      });
    },
    report() {
      return run(async () => {
        const source = await current(), meta = metadata();
        return { schema: 'stellar-forge.supplier-account-report.v1', workspaceId: meta.id, capturedAt: iso(),
          source: sourceView(source), configuration: configurationView(source.config),
          changes: db.prepare('SELECT row FROM changes ORDER BY sequence').all().map(value => safeChange(JSON.parse(value.row))),
          events: db.prepare('SELECT sequence,change_id AS changeId,at,kind,data FROM events ORDER BY sequence').all()
            .map(event => ({ ...event, data: JSON.parse(event.data) })) };
      });
    },
    backup() {
      return run(async () => {
        const source = await current();
        const data = { metadata: metadata(), source: { ...sourceView(source), text: source.text },
          changes: db.prepare('SELECT row FROM changes ORDER BY sequence').all().map(value => JSON.parse(value.row)),
          events: db.prepare('SELECT change_id AS changeId,at,kind,data FROM events ORDER BY sequence').all()
            .map(event => ({ ...event, data: JSON.parse(event.data) })) };
        const text = json(data);
        need(Buffer.byteLength(text) <= 64 * 1024 * 1024, 'SUPPLIER_BACKUP_TOO_LARGE');
        return { schema: SUPPLIER_ACCOUNT_BACKUP_SCHEMA, createdAt: iso(), sha256: digest(text), data };
      });
    },
    async close() {
      if (closing) return closing;
      closed = true;
      closing = pending.then(() => { db.close(); });
      return closing;
    },
  };
  return Object.freeze(api);
}

/** Receive complete history into a new private workspace. The source and ledger stay in place. */
export async function restoreSupplierAccountWorkspace({ directory, upstreamsFile, backup }) {
  need(plain(backup) && backup.schema === SUPPLIER_ACCOUNT_BACKUP_SCHEMA && HASH.test(backup.sha256 ?? '') &&
    plain(backup.data) && digest(json(backup.data)) === backup.sha256, 'SUPPLIER_BACKUP_INVALID');
  need(Buffer.byteLength(json(backup)) <= 65 * 1024 * 1024, 'SUPPLIER_BACKUP_TOO_LARGE');
  const data = backup.data, meta = data.metadata;
  need(plain(meta) && meta.schema === SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA && UUID.test(meta.id ?? '') &&
    plain(meta.identities) && Array.isArray(data.changes) && Array.isArray(data.events) &&
    plain(data.source) && typeof data.source.text === 'string' && digest(data.source.text) === data.source.sha256,
  'SUPPLIER_BACKUP_INVALID');
  const selected = await inspectSupplierAccountSource(upstreamsFile);
  need(selected.sha256 === data.source.sha256, 'SUPPLIER_RECEIVING_SOURCE_CHANGED', 409);
  retainIdentities(meta.identities, selected.config);
  need(typeof meta.initialSourceText === 'string' && digest(meta.initialSourceText) === meta.initialSourceSha256,
    'SUPPLIER_BACKUP_INVALID');
  parseSource(meta.initialSourceText);
  const ids = new Set();
  for (const row of data.changes) {
    need(plain(row) && UUID.test(row.id ?? '') && !ids.has(row.id) && Number.isSafeInteger(row.revision) && row.revision >= 0 &&
      statuses.includes(row.status) && plain(row.review) && row.review.id === row.id &&
      row.reviewSha256 === digest(json(row.review)) && row.review.source?.sha256 === digest(row.beforeText) &&
      row.review.target?.sha256 === digest(row.afterText), 'SUPPLIER_BACKUP_CHANGE_INVALID');
    ids.add(row.id);
    const before = parseSource(row.beforeText), after = parseSource(row.afterText);
    const rebuilt = makeReview({ id: row.id, createdAt: row.createdAt, source: row.review.source,
      before, after, note: row.review.note, restores: row.review.restores, rebases: row.review.rebases, targetText: row.afterText });
    need(equal(rebuilt.review, row.review), 'SUPPLIER_BACKUP_REVIEW_CHANGED');
  }
  for (const event of data.events) need(plain(event) && ids.has(event.changeId) &&
    typeof event.at === 'string' && typeof event.kind === 'string' && plain(event.data), 'SUPPLIER_BACKUP_EVENT_INVALID');
  const workspace = await openSupplierAccountWorkspace({ directory, upstreamsFile });
  await workspace.close();
  await withPrivateLock(directory, 'workspace.lock', async () => {
    const db = new DatabaseSync(join(directory, 'supplier-accounts.sqlite'));
    try {
      db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      const existing = JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get('workspace').value);
      if (existing.backupSha256 === backup.sha256) { db.exec('COMMIT'); return; }
      need(db.prepare('SELECT count(*) AS n FROM changes').get().n === 0 &&
        db.prepare('SELECT count(*) AS n FROM events').get().n === 0,
      'SUPPLIER_RESTORE_REQUIRES_NEW_WORKSPACE', 409);
      const received = { ...clone(meta), sourcePath: upstreamsFile,
        receivedAt: iso(), receivedFromSource: meta.sourcePath, backupSha256: backup.sha256 };
      db.prepare('UPDATE metadata SET value=? WHERE key=?').run(json(received), 'workspace');
      for (const row of data.changes) db.prepare('INSERT INTO changes (id,row) VALUES (?,?)').run(row.id, json(row));
      for (const event of data.events) db.prepare('INSERT INTO events (change_id,at,kind,data) VALUES (?,?,?,?)')
        .run(event.changeId, event.at, event.kind, json(event.data));
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  });
  return { schema: SUPPLIER_ACCOUNT_WORKSPACE_SCHEMA, status: 'RECEIVED', workspaceId: meta.id,
    directory, upstreamsFile, backupSha256: backup.sha256, changes: data.changes.length, events: data.events.length };
}
