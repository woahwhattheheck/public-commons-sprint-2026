// MIT. Retire only completed catalog receiving stages under the original workspace owner.
import { constants } from 'node:fs';
import { open, lstat, opendir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceError, canonical, clone, digest, identifier, now, workspaceOwnerEnded } from '../workspace/store.mjs';

export const CATALOG_IMPORT_STORAGE_SCHEMA = 'stellar-forge.material-catalog-import-storage.v1';
const RECEIPTS = 'catalog_import_storage';
const FILES = 'catalog_import_storage_files';
const DATABASE = 'catalog.sqlite3';
const DATABASE_FILES = [DATABASE + '-wal', DATABASE + '-shm', DATABASE];
const parse = row => row ? JSON.parse(row.record_json) : null;
const fail = (code, message, status = 409) => { throw new WorkspaceError(code, message, status); };
const sameOwner = (a, b) => Boolean(a && b && a.pid === b.pid && a.stamp === b.stamp && a.instance === b.instance);
const sourceName = name => /^source-([a-f0-9]{64})\.bin$/.exec(name);
const fingerprint = stat => ({ dev: String(stat.dev), ino: String(stat.ino), bytes: Number(stat.size),
  mtimeNs: String(stat.mtimeNs) });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.bytes === b.bytes && a.mtimeNs === b.mtimeNs;
const amount = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail('CATALOG_STORAGE_SIZE_INVALID', 'A retained file has an unsupported size.');
  return result;
};

export function setupCatalogImportStorage(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS ' + RECEIPTS + '(request_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,record_json TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS ' + FILES + '(request_id TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(request_id,name));'
  );
}
function savedReceipt(workspace, id) {
  return parse(workspace.db.prepare('SELECT record_json FROM ' + RECEIPTS + ' WHERE request_id=?').get(id));
}
function putReceipt(workspace, receipt) {
  workspace.db.prepare('INSERT INTO ' + RECEIPTS + ' VALUES(?,?,?) ON CONFLICT(request_id) DO UPDATE SET request_sha256=excluded.request_sha256,record_json=excluded.record_json')
    .run(receipt.importRequestId, receipt.requestSha256, JSON.stringify(receipt));
  return receipt;
}
function original(workspace, id, expectedRequestSha256) {
  const row = workspace.db.prepare('SELECT kind,state,request_sha256,record_json FROM operations WHERE id=?').get(identifier(id, 'original import request ID'));
  if (!row) fail('WORKSPACE_OPERATION_NOT_FOUND', 'Original import request not found.', 404);
  const operation = parse(row);
  if (row.kind !== 'catalog-import' || operation.kind !== row.kind || operation.id !== id ||
      operation.request?.requestId !== id || row.request_sha256 !== operation.requestSha256 ||
      digest(operation.request) !== operation.requestSha256)
    fail('CATALOG_STORAGE_IMPORT_IDENTITY_CHANGED', 'The retained original import identity changed.');
  if (expectedRequestSha256 !== undefined && expectedRequestSha256 !== operation.requestSha256)
    fail('CATALOG_STORAGE_REQUEST_CHANGED', 'Reopen the original import before retiring its receiving stage.');
  if (row.state !== operation.state) fail('CATALOG_STORAGE_IMPORT_STATE_CHANGED', 'The original import state is inconsistent.');
  return operation;
}
function completeOriginal(workspace, id, expectedRequestSha256, resultSha256) {
  const operation = original(workspace, id, expectedRequestSha256);
  if (operation.state !== 'COMPLETE') fail('CATALOG_STORAGE_IMPORT_NOT_COMPLETE', 'Only a completed original import can retire its receiving stage.');
  const handover = operation.result?.handover;
  if (!handover || !/^[a-f0-9]{64}$/.test(operation.request.sha256 ?? '') ||
      !Number.isSafeInteger(operation.request.bytes) || operation.request.bytes < 1 || operation.request.bytes > 8 * 1024 * 1024 * 1024 ||
      handover.sha256 !== operation.request.sha256 || handover.bytes !== operation.request.bytes ||
      !operation.result.catalog?.id || !Number.isSafeInteger(operation.result.importedRevision))
    fail('CATALOG_STORAGE_RECEIPT_INVALID', 'The complete original import receipt is required.');
  if (resultSha256 !== undefined && digest(operation.result) !== resultSha256)
    fail('CATALOG_STORAGE_RESULT_CHANGED', 'The original completed import result changed.');
  return operation;
}
function paths(workspace, id) {
  return { parent: join(workspace.root, 'transfers'), directory: join(workspace.root, 'transfers', id + '.stage'),
    bundle: join(workspace.root, 'transfers', id + '.jsonl') };
}
async function directoryIdentity(path, missing = false) {
  let stat;
  try { stat = await lstat(path, { bigint: true }); }
  catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail('CATALOG_STORAGE_DIRECTORY_INVALID', 'Use the original private receiving directory.');
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
async function assertDirectory(path, expected) {
  const actual = await directoryIdentity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino)
    fail('CATALOG_STORAGE_STAGE_CHANGED', 'The original receiving directory was replaced.');
}
async function hashFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) fail('CATALOG_STORAGE_FILE_INVALID', 'Receiving stage members must be regular files.');
    const expected = fingerprint(before), hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(262144); let bytes = 0;
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead; hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (bytes !== expected.bytes || !sameFile(expected, fingerprint(after)))
      fail('CATALOG_STORAGE_FILE_CHANGED', 'A retained file changed while checking its complete bytes.');
    return { ...expected, sha256: hash.digest('hex'), allocatedBytes: amount(after.blocks * 512n),
      links: amount(after.nlink) };
  } finally { await file.close(); }
}
async function verifyPath(path, expected) {
  const actual = await hashFile(path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    fail('CATALOG_STORAGE_CUSTODY_CHANGED', 'A retained original no longer matches its complete bytes and checksum.');
  return actual;
}
async function unchanged(path, expected) {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || !sameFile(fingerprint(stat), expected))
    fail('CATALOG_STORAGE_FILE_CHANGED', 'A verified original or receiving-stage file changed before retirement.');
  return stat;
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
function stageIsClosed(workspace, operation, receipt) {
  if (receipt?.stageClosed === true) return true;
  if (sameOwner(operation.owner, workspace.store.owner) && workspace.importClosedStages?.has(operation.id)) return true;
  return workspaceOwnerEnded(operation.owner);
}
function assertLease(workspace, id, leaseId) {
  const receipt = savedReceipt(workspace, id);
  if (!receipt || receipt.lease?.id !== leaseId || !sameOwner(receipt.lease, workspace.store.owner))
    fail('CATALOG_STORAGE_LEASE_CHANGED', 'Another owner holds this receiving-stage retirement.');
  completeOriginal(workspace, id, receipt.requestSha256, receipt.importResultSha256);
  return receipt;
}
function updateLease(workspace, id, leaseId, update) {
  return workspace.store.transaction(() => {
    const receipt = assertLease(workspace, id, leaseId);
    return putReceipt(workspace, { ...receipt, ...update, updatedAt: now() });
  });
}
function claim(workspace, operation) {
  return workspace.store.transaction(() => {
    const current = completeOriginal(workspace, operation.id, operation.requestSha256);
    const prior = savedReceipt(workspace, current.id);
    if (prior && (prior.requestSha256 !== current.requestSha256 || prior.importResultSha256 !== digest(current.result)))
      fail('CATALOG_STORAGE_RECEIPT_CHANGED', 'The stage receipt belongs to different original work.');
    if (prior?.state === 'COMPLETE') return { receipt: prior, complete: true };
    if (!stageIsClosed(workspace, current, prior))
      fail('CATALOG_STORAGE_IMPORT_OWNER_ACTIVE', 'The original import owner still holds the stage. Let that import finish or close its original workspace.');
    if (prior?.lease && !sameOwner(prior.lease, workspace.store.owner) && !workspaceOwnerEnded(prior.lease))
      fail('CATALOG_STORAGE_RETIREMENT_ACTIVE', 'Another live workspace owner is retiring this original receiving stage.');
    const at = now(), lease = { ...workspace.store.owner, id: randomUUID() };
    const receipt = { ...(prior ?? {}), schema: CATALOG_IMPORT_STORAGE_SCHEMA,
      importRequestId: current.id, requestSha256: current.requestSha256,
      importResultSha256: digest(current.result), stageClosed: true,
      state: prior?.plan ? 'RETIRING' : 'VERIFYING', createdAt: prior?.createdAt ?? at, updatedAt: at,
      attempts: (prior?.attempts ?? 0) + 1, lease, error: null };
    return { receipt: putReceipt(workspace, receipt), complete: false };
  });
}
function putFile(workspace, id, leaseId, file) {
  workspace.store.transaction(() => {
    assertLease(workspace, id, leaseId);
    workspace.db.prepare('INSERT INTO ' + FILES + ' VALUES(?,?,?,?)').run(id, file.name, 'PENDING', JSON.stringify(file));
  });
}
async function knownMembers(workspace, directory, check) {
  const handle = await opendir(directory);
  for await (const item of handle) {
    if (!item.isFile() || !await check(item.name))
      fail('CATALOG_STORAGE_UNKNOWN_MEMBER', 'The receiving stage contains an unexpected member. It was retained for inspection.');
  }
}
function originalSource(workspace, file) {
  const source = workspace.source(file.sourceId);
  if (source.bytes !== file.bytes || source.sha256 !== file.sha256)
    fail('CATALOG_STORAGE_SOURCE_CHANGED', 'The canonical source record no longer matches this imported source.');
  return source;
}
async function validateCanonical(workspace, file) {
  const source = originalSource(workspace, file);
  return verifyPath(workspace.sourcePath(source.id), source);
}
function* fileBatches(workspace, id, where = '', parameters = []) {
  let last = '';
  for (;;) {
    const rows = workspace.db.prepare('SELECT name,status,record_json FROM ' + FILES +
      ' WHERE request_id=? AND name>? ' + where + ' ORDER BY name LIMIT 100').all(id, last, ...parameters);
    if (!rows.length) return;
    yield rows;
    last = rows.at(-1).name;
  }
}
function closeStageInspection(workspace, id) {
  const reader = workspace.importStorageReaders.get(id);
  if (!reader) return;
  reader.db.close();
  workspace.importStorageReaders.delete(id);
}
async function buildPlan(workspace, operation, receipt) {
  const id = operation.id, leaseId = receipt.lease.id, selected = paths(workspace, id);
  await directoryIdentity(workspace.root); await directoryIdentity(selected.parent);
  const directory = await directoryIdentity(selected.directory, true);
  const bundle = await verifyPath(selected.bundle, operation.request);
  if (!directory) {
    return updateLease(workspace, id, leaseId, { state: 'COMPLETE', lease: null, completedAt: now(),
      summary: { outcome: 'ALREADY_ABSENT', plannedFiles: 0, removedFiles: 0, alreadyAbsentFiles: 0,
        removedBytes: 0, removedAllocatedBytes: 0, estimatedReclaimableBytes: 0 },
      originals: { bundle: { name: id + '.jsonl', bytes: bundle.bytes, sha256: bundle.sha256 } } });
  }
  workspace.store.transaction(() => {
    assertLease(workspace, id, leaseId);
    workspace.db.prepare('DELETE FROM ' + FILES + ' WHERE request_id=?').run(id);
  });
  const stagePath = join(selected.directory, DATABASE);
  const stageInfo = await lstat(stagePath, { bigint: true }).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  let db;
  try {
    if (stageInfo) {
      if (!stageInfo.isFile() || stageInfo.isSymbolicLink()) fail('CATALOG_STORAGE_DATABASE_INVALID', 'The original receiving database is not a regular file.');
      const canonicalDatabase = await lstat(join(workspace.store.directory, 'workspace.sqlite3'), { bigint: true });
      if (stageInfo.dev === canonicalDatabase.dev && stageInfo.ino === canonicalDatabase.ino)
        fail('CATALOG_STORAGE_CANONICAL_DATABASE', 'The selected stage points to the canonical workspace database and cannot be retired.');
      db = new DatabaseSync(stagePath, { readOnly: true });
      workspace.importStorageReaders.set(id, { db, leaseId });
      const catalog = parse(db.prepare('SELECT record_json FROM catalog_catalogs').get());
      if (!catalog || catalog.id !== operation.result.catalog.id || catalog.revision !== operation.result.importedRevision ||
          Number(db.prepare('SELECT COUNT(*) n FROM catalog_catalogs').get().n) !== 1)
        fail('CATALOG_STORAGE_DATABASE_IDENTITY_CHANGED', 'The receiving database does not match its completed import.');
      for (const [table, expected] of Object.entries(operation.result.handover.rows ?? {})) {
        if (!/^catalog_[a-z_]+$/.test(table) || !Number.isSafeInteger(expected) || expected < 0 ||
            Number(db.prepare('SELECT COUNT(*) n FROM "' + table + '"').get().n) !== expected)
          fail('CATALOG_STORAGE_DATABASE_COUNTS_CHANGED', 'The receiving database differs from the completed import counts.');
      }
      await knownMembers(workspace, selected.directory, name => {
        const match = sourceName(name);
        return DATABASE_FILES.includes(name) || Boolean(match && db.prepare('SELECT 1 FROM catalog_sources WHERE id=?').get(match[1]));
      });
      for (const row of db.prepare('SELECT id,record_json FROM catalog_sources ORDER BY id').iterate()) {
        const source = parse(row), name = 'source-' + row.id + '.bin';
        if (!sourceName(name) || source?.id !== row.id || !Number.isSafeInteger(source.bytes) || source.bytes < 1 ||
            !/^[a-f0-9]{64}$/.test(source.sha256 ?? '')) fail('CATALOG_STORAGE_SOURCE_INVALID', 'The staged original source identity is invalid.');
        const stageFile = await verifyPath(join(selected.directory, name), source);
        const canonicalFile = await validateCanonical(workspace, { sourceId: source.id, bytes: source.bytes, sha256: source.sha256 });
        await unchanged(join(selected.directory, name), stageFile);
        putFile(workspace, id, leaseId, { name, role: 'source', sourceId: source.id, ...stageFile,
          canonicalFile: { dev: canonicalFile.dev, ino: canonicalFile.ino, bytes: canonicalFile.bytes,
            mtimeNs: canonicalFile.mtimeNs, sha256: canonicalFile.sha256 } });
      }
    } else {
      await knownMembers(workspace, selected.directory, () => false);
    }
  } finally { if (db) closeStageInspection(workspace, id); }
  // The temporary SQLite reader is closed before any stage database or sidecar is hashed or unlinked.
  for (const name of DATABASE_FILES) {
    const path = join(selected.directory, name);
    const stat = await lstat(path, { bigint: true }).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!stat) continue;
    const file = await hashFile(path);
    putFile(workspace, id, leaseId, { name, role: name === DATABASE ? 'database' : 'database-sidecar', ...file });
  }
  await assertDirectory(selected.directory, directory);
  await unchanged(selected.bundle, bundle);
  let files = 0, bytes = 0, allocatedBytes = 0, reclaimableBytes = 0;
  const hash = createHash('sha256');
  for (const batch of fileBatches(workspace, id)) for (const row of batch) {
    const file = parse(row); hash.update(canonical(file) + '\n'); files++; bytes += file.bytes;
    allocatedBytes += file.allocatedBytes; if (file.links === 1) reclaimableBytes += file.allocatedBytes;
  }
  return updateLease(workspace, id, leaseId, { state: 'RETIRING',
    plan: { directory, bundle: { name: id + '.jsonl', ...bundle }, files, bytes, allocatedBytes,
      estimatedReclaimableBytes: reclaimableBytes, filesSha256: hash.digest('hex'), sealedAt: now() } });
}
function retainedFile(row) {
  const file = parse(row), match = sourceName(row.name);
  if (!file || file.name !== row.name || (!match && !DATABASE_FILES.includes(row.name)) ||
      (match ? file.role !== 'source' || file.sourceId !== match[1] :
        file.role !== (row.name === DATABASE ? 'database' : 'database-sidecar')) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      !Number.isSafeInteger(file.allocatedBytes) || file.allocatedBytes < 0 ||
      !['PENDING','REMOVED','ALREADY_ABSENT'].includes(row.status) ||
      ['dev','ino','mtimeNs'].some(key => typeof file[key] !== 'string' || !/^[0-9]+$/.test(file[key])) ||
      (row.status !== 'PENDING' && file.retirement?.state !== row.status))
    fail('CATALOG_STORAGE_PLAN_FILE_INVALID', 'A retained retirement member no longer has its original safe identity.');
  return file;
}
async function validatePlan(workspace, operation, receipt) {
  const id = operation.id, selected = paths(workspace, id), hash = createHash('sha256');
  let files = 0, bytes = 0;
  await directoryIdentity(workspace.root); await directoryIdentity(selected.parent);
  await directoryIdentity(join(workspace.root, 'sources'));
  const bundle = await verifyPath(selected.bundle, operation.request);
  for (const batch of fileBatches(workspace, id)) for (const row of batch) {
    const file = retainedFile(row);
    const { retirement, ...originalFile } = file;
    hash.update(canonical(originalFile) + '\n'); files++; bytes += file.bytes;
    if (file.role === 'source') await validateCanonical(workspace, file);
  }
  if (files !== receipt.plan.files || bytes !== receipt.plan.bytes || hash.digest('hex') !== receipt.plan.filesSha256)
    fail('CATALOG_STORAGE_PLAN_CHANGED', 'The retained stage-retirement plan changed.');
  const current = await directoryIdentity(selected.directory, true);
  if (current) {
    await assertDirectory(selected.directory, receipt.plan.directory);
    await knownMembers(workspace, selected.directory, name =>
      Boolean(workspace.db.prepare('SELECT 1 FROM ' + FILES + ' WHERE request_id=? AND name=?').get(id, name)));
  } else {
    // A prior attempt may have removed the empty directory before its final receipt was durable.
    for (const batch of fileBatches(workspace, id)) for (const row of batch)
      if (row.status === 'PENDING') {
        const file = parse(row);
        workspace.store.transaction(() => {
          assertLease(workspace, id, receipt.lease.id);
          workspace.db.prepare('UPDATE ' + FILES + ' SET status=?,record_json=? WHERE request_id=? AND name=?')
            .run('ALREADY_ABSENT', JSON.stringify({ ...file, retirement: { state: 'ALREADY_ABSENT', at: now() } }), id, file.name);
        });
      }
  }
  return bundle;
}
async function retireFile(workspace, receipt, file) {
  const id = receipt.importRequestId, selected = paths(workspace, id);
  assertLease(workspace, id, receipt.lease.id);
  await assertDirectory(selected.directory, receipt.plan.directory);
  const path = join(selected.directory, file.name);
  let actual;
  try { actual = await hashFile(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let retirement;
  if (!actual) retirement = { state: 'ALREADY_ABSENT', at: now() };
  else {
    if (!sameFile(actual, file) || actual.sha256 !== file.sha256)
      fail('CATALOG_STORAGE_MEMBER_CHANGED', 'A sealed receiving-stage member changed; the remaining stage was retained.');
    if (file.role === 'source') {
      const verified = await validateCanonical(workspace, file);
      await unchanged(workspace.sourcePath(file.sourceId), verified);
    }
    assertLease(workspace, id, receipt.lease.id);
    await assertDirectory(selected.directory, receipt.plan.directory);
    const stat = await unchanged(path, actual);
    await unlink(path);
    await syncDirectory(selected.directory);
    retirement = { state: 'REMOVED', at: now(), bytes: file.bytes,
      allocatedBytes: stat.nlink === 1n ? amount(stat.blocks * 512n) : 0 };
  }
  workspace.store.transaction(() => {
    assertLease(workspace, id, receipt.lease.id);
    workspace.db.prepare('UPDATE ' + FILES + ' SET status=?,record_json=? WHERE request_id=? AND name=?')
      .run(retirement.state, JSON.stringify({ ...file, retirement }), id, file.name);
  });
}
function summary(workspace, receipt) {
  const value = { outcome: 'RETIRED', plannedFiles: receipt.plan.files, removedFiles: 0, alreadyAbsentFiles: 0,
    removedBytes: 0, removedAllocatedBytes: 0, estimatedReclaimableBytes: receipt.plan.estimatedReclaimableBytes };
  for (const batch of fileBatches(workspace, receipt.importRequestId)) for (const row of batch) {
    const retired = parse(row).retirement;
    if (row.status === 'REMOVED') {
      value.removedFiles++; value.removedBytes += retired.bytes; value.removedAllocatedBytes += retired.allocatedBytes;
    } else if (row.status === 'ALREADY_ABSENT') value.alreadyAbsentFiles++;
  }
  return value;
}
async function runRetirement(workspace, request) {
  // Retry a retained failed-close inspection before taking another plan or unlinking.
  closeStageInspection(workspace, request.importRequestId);
  const operation = completeOriginal(workspace, request.importRequestId, request.expectedRequestSha256);
  const claimed = claim(workspace, operation), id = operation.id, selected = paths(workspace, id);
  let receipt = claimed.receipt;
  if (claimed.complete) {
    if (await directoryIdentity(selected.directory, true))
      fail('CATALOG_STORAGE_STAGE_REAPPEARED', 'A new stage appeared after this original retirement completed. It was retained.');
    return { ...clone(receipt), reused: true };
  }
  try {
    if (!receipt.plan) receipt = await buildPlan(workspace, operation, receipt);
    if (receipt.state === 'COMPLETE') return clone(receipt);
    await validatePlan(workspace, operation, receipt);
    if (await directoryIdentity(selected.directory, true)) {
      for (const batch of fileBatches(workspace, id, ' AND status=? AND name NOT IN (?,?,?)', ['PENDING', ...DATABASE_FILES]))
        for (const row of batch) await retireFile(workspace, receipt, parse(row));
      for (const name of DATABASE_FILES) {
        const row = workspace.db.prepare('SELECT status,record_json FROM ' + FILES + ' WHERE request_id=? AND name=?').get(id, name);
        if (row?.status === 'PENDING') await retireFile(workspace, receipt, parse(row));
      }
      await assertDirectory(selected.directory, receipt.plan.directory);
      assertLease(workspace, id, receipt.lease.id);
      await rmdir(selected.directory);
    }
    await syncDirectory(selected.parent);
    return clone(updateLease(workspace, id, receipt.lease.id, { state: 'COMPLETE', lease: null,
      completedAt: now(), summary: summary(workspace, receipt), error: null }));
  } catch (error) {
    try { updateLease(workspace, id, receipt.lease.id, { state: 'RETAINED',
      lease: workspace.importStorageReaders.has(id) ? receipt.lease : null,
      error: workspace.workspace.failure(error) }); } catch { /* The saved owner and sealed plan remain recoverable. */ }
    throw error;
  }
}
export function trackCatalogStorageWork(workspace, action) {
  const key = 'catalog-storage:' + randomUUID();
  const task = Promise.resolve().then(action).finally(() => workspace.workspace.active.delete(key));
  workspace.workspace.active.set(key, task);
  return task;
}
export function retireCatalogImportStage(workspace, request, { automatic = false } = {}) {
  if (!automatic) workspace.open();
  identifier(request?.importRequestId, 'original import request ID');
  if (!/^[a-f0-9]{64}$/.test(request.expectedRequestSha256 ?? ''))
    fail('CATALOG_STORAGE_REQUEST_SHA_REQUIRED', 'Use the original request checksum from the import storage view.', 422);
  workspace.importStorageTasks ??= new Map();
  const key = request.importRequestId, existing = workspace.importStorageTasks.get(key);
  if (existing) {
    if (existing.requestSha256 !== request.expectedRequestSha256) fail('CATALOG_STORAGE_REQUEST_CHANGED', 'The original import request checksum changed.');
    return existing.task;
  }
  const task = trackCatalogStorageWork(workspace, () => runRetirement(workspace, request))
    .finally(() => workspace.importStorageTasks.delete(key));
  workspace.importStorageTasks.set(key, { requestSha256: request.expectedRequestSha256, task });
  return task;
}
export async function retireCompletedCatalogImport(workspace, operation) {
  if (operation?.state !== 'COMPLETE') return;
  try {
    await retireCatalogImportStage(workspace, { importRequestId: operation.id,
      expectedRequestSha256: operation.requestSha256 }, { automatic: true });
    workspace.importStorageWarnings?.delete(operation.id);
  } catch (error) {
    workspace.importStorageWarnings ??= new Map();
    workspace.importStorageWarnings.set(operation.id, workspace.workspace.failure(error));
    while (workspace.importStorageWarnings.size > 25) workspace.importStorageWarnings.delete(workspace.importStorageWarnings.keys().next().value);
  }
}
async function stageInventory(workspace, operation) {
  const selected = paths(workspace, operation.id), receipt = savedReceipt(workspace, operation.id);
  const result = { importRequestId: operation.id, requestSha256: operation.requestSha256,
    importState: operation.state, createdAt: operation.createdAt, catalogId: operation.result?.catalog?.id ?? null,
    importedRevision: operation.result?.importedRevision ?? null,
    bundle: { name: operation.id + '.jsonl', bytes: operation.request.bytes, sha256: operation.request.sha256 },
    stage: { present: false, files: 0, bytes: 0, allocatedBytes: 0, estimatedReclaimableBytes: 0 },
    retirement: receipt ? { state: receipt.state, attempts: receipt.attempts, completedAt: receipt.completedAt ?? null,
      summary: receipt.summary ?? null, error: receipt.error ?? null, planSha256: receipt.plan?.filesSha256 ?? null } : null,
    warning: workspace.importStorageWarnings?.get(operation.id) ?? null };
  try {
    const directory = await directoryIdentity(selected.directory, true);
    if (directory) {
      result.stage.present = true;
      await knownMembers(workspace, selected.directory, async name => {
        if (!DATABASE_FILES.includes(name) && !sourceName(name)) return false;
        const stat = await lstat(join(selected.directory, name), { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        result.stage.files++; result.stage.bytes += amount(stat.size);
        result.stage.allocatedBytes += amount(stat.blocks * 512n);
        if (stat.nlink === 1n) result.stage.estimatedReclaimableBytes += amount(stat.blocks * 512n);
        return true;
      });
    }
    const retainedPlan = Boolean(receipt?.plan && receipt.state !== 'COMPLETE');
    const pending = result.stage.present || retainedPlan;
    result.eligible = operation.state === 'COMPLETE' && pending && stageIsClosed(workspace, operation, receipt) &&
      receipt?.state !== 'COMPLETE' && (!receipt?.lease || sameOwner(receipt.lease, workspace.store.owner) || workspaceOwnerEnded(receipt.lease));
    result.status = !pending ? 'ABSENT' : receipt?.state === 'COMPLETE' ? 'STAGE_REAPPEARED' :
      operation.state !== 'COMPLETE' ? 'IMPORT_RETAINED' : !stageIsClosed(workspace, operation, receipt) ? 'IMPORT_OWNER_ACTIVE' :
      result.eligible ? result.stage.present ? 'READY_TO_VERIFY' : 'READY_TO_RECONCILE' : 'RETIREMENT_ACTIVE';
  } catch (error) {
    result.eligible = false; result.status = 'INSPECTION_REQUIRED'; result.warning = workspace.workspace.failure(error);
  }
  return result;
}
export async function inspectCatalogImportStorage(workspace, { importRequestId, offset = 0, limit = 25 } = {}) {
  workspace.open();
  offset = Number(offset); limit = Number(limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    fail('CATALOG_STORAGE_PAGE_INVALID', 'Choose an offset from zero and a page size from 1 to 100.', 422);
  return trackCatalogStorageWork(workspace, async () => {
    let selected, total;
    if (importRequestId !== undefined) { selected = [original(workspace, importRequestId)]; total = 1; offset = 0; }
    else {
      total = Number(workspace.db.prepare("SELECT COUNT(*) n FROM operations WHERE kind='catalog-import'").get().n);
      selected = workspace.db.prepare("SELECT record_json FROM operations WHERE kind='catalog-import' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?")
        .all(limit, offset).map(parse);
    }
    const rows = [];
    for (const operation of selected) rows.push(await stageInventory(workspace, operation));
    return { schema: CATALOG_IMPORT_STORAGE_SCHEMA, workspaceId: workspace.store.id,
      rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null,
      pageTotals: rows.reduce((sum, row) => ({ stages: sum.stages + Number(row.stage.present),
        bytes: sum.bytes + row.stage.bytes, allocatedBytes: sum.allocatedBytes + row.stage.allocatedBytes,
        estimatedReclaimableBytes: sum.estimatedReclaimableBytes + row.stage.estimatedReclaimableBytes }),
        { stages: 0, bytes: 0, allocatedBytes: 0, estimatedReclaimableBytes: 0 }) };
  });
}
