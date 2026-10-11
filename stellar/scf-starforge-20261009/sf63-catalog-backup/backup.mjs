/**
 * SF63: offline crash-safe backup and restore for the original SF60 catalog journal.
 * No network, wallet or payment capabilities. Node 22+ / built-in modules only.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const BACKUP_SCHEMA = 'stellar-forge.sf63.catalog-backup/v1';
const JOURNAL_SCHEMA = 'stellar-forge.catalog-transactions/v1';
const JOURNAL_NAME = 'catalog-commits.json';
const MANIFEST_NAME = 'backup-manifest.json';
const MAX_BYTES = 32 * 1024 * 1024;
const ZERO = '0'.repeat(64);
const HEX = /^[a-f0-9]{64}$/;
const regularObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const stable = value => JSON.stringify(Array.isArray(value) ? value.map(sortRecursively) : sortRecursively(value));
function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (regularObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortRecursively(value[key])]));
  return value;
}

// Replicates SF60's public canonical chain algorithm; independent SF60 reopen
// below is the authoritative replay of its REAL trust/lifecycle/catalog gates.
export function inspectJournal(bytes) {
  if (!Buffer.isBuffer(bytes)) fail('JOURNAL_BUFFER_REQUIRED');
  if (bytes.byteLength > MAX_BYTES) fail('JOURNAL_TOO_LARGE');
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); }
  catch { fail('JOURNAL_JSON_INVALID'); }
  if (!regularObject(document) || document.schema !== JOURNAL_SCHEMA ||
      !Array.isArray(document.records) || document.records.length > 10_000 ||
      !HEX.test(document.head ?? '')) fail('JOURNAL_SCHEMA_INVALID');
  let head = ZERO;
  for (let i = 0; i < document.records.length; i++) {
    const row = document.records[i];
    if (!regularObject(row) || row.index !== i + 1 || row.prev !== head ||
        !HEX.test(row.hash ?? '') || !regularObject(row.operation) ||
        !['upsert', 'retire'].includes(row.operation.kind)) fail('JOURNAL_CHAIN_INVALID');
    const opBytes = Buffer.byteLength(JSON.stringify(row.operation));
    if (opBytes > 128 * 1024) fail('JOURNAL_OPERATION_LIMIT');
    const expected = digest(stable({ index: row.index, prev: row.prev, operation: row.operation }));
    if (row.hash !== expected) fail('JOURNAL_DIGEST_MISMATCH');
    head = row.hash;
  }
  if (document.head !== head) fail('JOURNAL_HEAD_MISMATCH');
  return { head, records: document.records.length, bytes: bytes.byteLength, sha256: digest(bytes) };
}

async function regularDirectory(path) {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('DIRECTORY_NOT_REGULAR');
}
async function readBoundedNoFollow(path, allowMissing = false) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.size > MAX_BYTES) fail('SOURCE_NOT_REGULAR_OR_TOO_LARGE');
    const buf = await handle.readFile();
    if (buf.length > MAX_BYTES) fail('SOURCE_TOO_LARGE');
    return buf;
  } finally { await handle.close(); }
}
async function flushDir(path) {
  const dir = await open(path, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
async function writeExclusive(path, bytes) {
  const f = await open(path, 'wx', 0o600);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
}
function emptyJournal() {
  return Buffer.from(JSON.stringify({schema:JOURNAL_SCHEMA,records:[],head:ZERO}) + '\n');
}
async function replayWithOriginalModules(bytes) {
  const sandbox = await mkdtemp(join(tmpdir(), 'sf63-original-replay-'));
  let tx;
  try {
    await writeExclusive(join(sandbox, JOURNAL_NAME), bytes);
    // Absolute original source import. No duplicated validator or mock replaces it.
    const { DurableCatalogTransaction } = await import('../sf60-durable-catalog-transaction/journal.mjs');
    tx = await DurableCatalogTransaction.open(sandbox);
    return {head: tx.head, records: tx.count};
  } finally {
    if (tx) await tx.close();
    await rm(sandbox, { recursive: true, force: true });
  }
}

/** Replay function is injectable only for focused local tests. Production CLI always
 * invokes the original SF60 module and never offers a skip-native flag. */
export async function verifySnapshot(backupDirectory, replay = replayWithOriginalModules) {
  const dir = resolve(backupDirectory);
  await regularDirectory(dir);
  const raw = await readBoundedNoFollow(join(dir, JOURNAL_NAME));
  const manifestBytes = await readBoundedNoFollow(join(dir, MANIFEST_NAME));
  if (!raw || !manifestBytes) fail('BACKUP_INCOMPLETE');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { fail('MANIFEST_JSON_INVALID'); }
  if (!regularObject(manifest) || manifest.schema !== BACKUP_SCHEMA ||
      manifest.journalFile !== JOURNAL_NAME || manifest.sha256 !== digest(raw) ||
      !HEX.test(manifest.sha256 ?? '')) fail('MANIFEST_INVALID');
  const journal = inspectJournal(raw);
  if (journal.bytes !== manifest.bytes || journal.head !== manifest.head ||
      journal.records !== manifest.records) fail('MANIFEST_JOURNAL_MISMATCH');
  const native = await replay(raw);
  if (native.head !== journal.head || native.records !== journal.records) fail('NATIVE_REPLAY_MISMATCH');
  return {decision:'VERIFIED_NATIVE_REPLAY',sha256:journal.sha256,head:journal.head,
    records:journal.records,bytes:journal.bytes, backupDirectory:dir};
}

export async function createSnapshot(sourceDirectory, backupDirectory, replay = replayWithOriginalModules) {
  const source = resolve(sourceDirectory), target = resolve(backupDirectory);
  if (source === target || target.startsWith(source + '/') || source.startsWith(target + '/')) fail('PATHS_MUST_BE_SEPARATE');
  await regularDirectory(source);
  await regularDirectory(dirname(target));
  const bytes = (await readBoundedNoFollow(join(source,JOURNAL_NAME),true)) ?? emptyJournal();
  const journal = inspectJournal(bytes);
  const native = await replay(bytes);
  if (native.head !== journal.head || native.records !== journal.records) fail('NATIVE_REPLAY_MISMATCH');
  // mkdir without recursive is exclusive: existing backup folders never get overwritten.
  await mkdir(target,{mode:0o700});
  await writeExclusive(join(target,JOURNAL_NAME),bytes);
  const manifest={schema:BACKUP_SCHEMA,journalFile:JOURNAL_NAME,sha256:journal.sha256,
    bytes:journal.bytes,head:journal.head,records:journal.records,createdAt:new Date().toISOString()};
  // Manifest written LAST. A crash before this makes verification reject partial backup.
  await writeExclusive(join(target,MANIFEST_NAME),Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  await flushDir(target);
  return verifySnapshot(target,replay);
}

export async function restoreSnapshot(backupDirectory, newDirectory, replay = replayWithOriginalModules, expectedHead = null) {
  const source = resolve(backupDirectory),target = resolve(newDirectory);
  if (source === target || source.startsWith(target + '/') || target.startsWith(source + '/')) fail('PATHS_MUST_BE_SEPARATE');
  if (expectedHead !== null && !HEX.test(expectedHead)) fail('RESTORE_EXPECTED_HEAD_INVALID');
  const verified = await verifySnapshot(source,replay);
  if (expectedHead !== null && verified.head !== expectedHead) fail('RESTORE_HEAD_MISMATCH');
  await regularDirectory(dirname(target));
  const bytes = await readBoundedNoFollow(join(source,JOURNAL_NAME));
  // Guard an updated backup between our first read and the second verification.
  const rechecked = await verifySnapshot(source,replay);
  if (rechecked.sha256 !== digest(bytes)) fail('BACKUP_CHANGED_DURING_RESTORE');
  if (expectedHead !== null && rechecked.head !== expectedHead) fail('RESTORE_HEAD_MISMATCH');
  await mkdir(target,{mode:0o700});
  await writeExclusive(join(target,JOURNAL_NAME),bytes);
  await flushDir(target);
  const native = await replay(bytes);
  const journal = inspectJournal(bytes);
  if (native.head !== journal.head || native.records !== journal.records) fail('RESTORED_NATIVE_REPLAY_MISMATCH');
  return {decision:'RESTORED_AND_VERIFIED',sha256:journal.sha256,head:journal.head,
    records:journal.records,bytes:journal.bytes, destination:target};
}
