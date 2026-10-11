// MIT. Offline continuity for the ORIGINAL SF98 native merchant outbox.
// Does not sign, settle, acknowledge, send or replay a payment/webhook.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readdir, realpath, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, dirname, join, parse, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { openOutbox } from '../sf98-merchant-delivery/outbox.mjs';

export const SCHEMA = 'stellar-forge.sf101.outbox-continuity.v1';
const NAMES = ['events.ndjson', 'deliveries.ndjson'];
const MAX_FILE = 32 * 1024 * 1024;
const MAX_LINE = 8192;
const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = reason => { throw new Error('SF101_' + reason); };
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function fullPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value ||
      value === parse(value).root || value.endsWith(sep)) fail('ABSOLUTE_NORMALIZED_PATH_REQUIRED');
  return value;
}
async function unlinkedComponents(path, { missingLast = false } = {}) {
  const root = parse(path).root;
  let part = root;
  const parts = path.slice(root.length).split(sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    part = join(part, parts[i]);
    let item;
    try { item = await lstat(part); }
    catch (e) {
      if (e.code === 'ENOENT' && missingLast && i === parts.length - 1) return;
      throw e;
    }
    if (item.isSymbolicLink() || !item.isDirectory()) fail('SYMLINK_OR_NON_DIRECTORY_COMPONENT');
  }
}
async function privateDirectory(path) {
  fullPath(path);
  await unlinkedComponents(path);
  const meta = await stat(path);
  if (!meta.isDirectory() || (meta.mode & 0o077) !== 0) fail('PRIVATE_DIRECTORY_0700_REQUIRED');
}
async function destinationAbsent(target) {
  fullPath(target);
  await unlinkedComponents(dirname(target));
  try { await lstat(target); fail('DESTINATION_EXISTS'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (resolve(await realpath(dirname(target))) !== dirname(target)) fail('PARENT_RESOLUTION_DRIFT');
}
function assertDisjoint(source, target) {
  if (source === target || source.startsWith(target + sep) || target.startsWith(source + sep))
    fail('SOURCE_TARGET_OVERLAP');
}
async function readOne(dir, name, parseRows = true) {
  const file = join(dir, name);
  let before;
  try { before = await lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; }
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) !== 0)
    fail('PRIVATE_REGULAR_FILE_0600_REQUIRED_' + name);
  if (before.size > MAX_FILE) fail('FILE_TOO_LARGE_' + name);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size) fail('CONCURRENT_FILE_REPLACEMENT_' + name);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(file);
    if (after.size !== bytes.length || after.size !== before.size ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        current.size !== after.size || current.mtimeMs !== opened.mtimeMs ||
        after.mtimeMs !== opened.mtimeMs) fail('CONCURRENT_FILE_CHANGE_' + name);
    if (parseRows) parseJournal(bytes, name);
    return bytes;
  } finally { await handle.close(); }
}
function parseJournal(bytes, name) {
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 10) fail('TRUNCATED_JOURNAL_' + name);
  let decoded;
  try { decoded = strictUtf8.decode(bytes); } catch { fail('INVALID_UTF8_' + name); }
  const lines = decoded.split('\n');
  lines.pop();
  return lines.map((line, i) => {
    if (!line.length || Buffer.byteLength(line) > MAX_LINE) fail('INVALID_RECORD_LENGTH_' + name + '_' + (i + 1));
    try { const row = JSON.parse(line); if (!row || typeof row !== 'object' || Array.isArray(row))
      fail('INVALID_JSON_OBJECT_' + name); return row; }
    catch (e) { if (String(e.message).startsWith('SF101_')) throw e; fail('INVALID_JSON_' + name + '_' + (i + 1)); }
  });
}
function fingerprint(data) {
  return HASH(Buffer.from(SCHEMA + '\n' + NAMES.map(name =>
    name + ':' + data[name].length + ':' + HASH(data[name])).join('\n') + '\n'));
}
async function capture(path) {
  await privateDirectory(path);
  const data = Object.fromEntries(await Promise.all(NAMES.map(async name => [name, await readOne(path, name)])));
  return { data, sha256: fingerprint(data) };
}
async function stableCapture(path) {
  // Optimistic, nonblocking two-pass read; simultaneous writers are never locked or paused.
  // A busy writer is told to retry after quiescing the existing original seller/drain.
  for (let n = 0; n < 3; n++) {
    try {
      const a = await capture(path), b = await capture(path);
      if (a.sha256 === b.sha256) return a;
    } catch (e) {
      if (!String(e.message).includes('SF101_CONCURRENT_')) throw e;
    }
  }
  fail('SOURCE_CHANGING_RETRY_AFTER_QUIESCING_WRITERS');
}
function validateShape(data) {
  const events = parseJournal(data[NAMES[0]], NAMES[0]);
  const deliveries = parseJournal(data[NAMES[1]], NAMES[1]);
  const byId = new Map();
  for (const e of events) {
    if (e.schema !== 'stellar-forge.sf98.delivery-event.v1' || !HEX64(e.id) ||
        typeof e.routeId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(e.routeId) ||
        !['GET', 'HEAD', 'POST'].includes(e.method) || typeof e.network !== 'string' ||
        !/^[0-9]+$/.test(e.amountAtomic) || BigInt(e.amountAtomic) === 0n ||
        !HEX64(e.assetDigest) || !HEX64(e.receiptFingerprint) ||
        !(e.transactionFingerprint === null || HEX64(e.transactionFingerprint)) ||
        e.authority !== 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' ||
        !Number.isFinite(Date.parse(e.at)) ||
        !(e.orderReference === null || (typeof e.orderReference === 'string' &&
          /^[A-Za-z0-9._:-]{1,80}$/.test(e.orderReference)))) fail('INVALID_ORIGINAL_EVENT');
    const existing = byId.get(e.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(e)) fail('CONFLICTING_ORIGINAL_EVENT');
    byId.set(e.id, e);
  }
  const latest = new Map();
  for (const s of deliveries) {
    if (!HEX64(s.id) || !byId.has(s.id) ||
        !['DELIVERED', 'RETRY', 'EXHAUSTED', 'REQUEUE'].includes(s.state) ||
        !Number.isInteger(s.attempt) || s.attempt < 0 || s.attempt > 100 ||
        !Number.isFinite(Date.parse(s.at))) fail('INVALID_OR_ORPHAN_DELIVERY');
    latest.set(s.id, s);
  }
  const summary = {
    nativeEvents: byId.size,
    eventJournalRows: events.length,
    deliveryJournalRows: deliveries.length,
    delivered: [...byId.keys()].filter(id => latest.get(id)?.state === 'DELIVERED').length,
    exhausted: [...byId.keys()].filter(id => latest.get(id)?.state === 'EXHAUSTED').length,
    pending: [...byId.keys()].filter(id => !latest.has(id) || ['RETRY', 'REQUEUE'].includes(latest.get(id).state)).length,
  };
  return { byId, latest, summary };
}
async function nativeReview(path, snapshot) {
  const checks = validateShape(snapshot.data);
  // Invoke the ORIGINAL SF98 module, not a parallel imitation of payment/journal semantics.
  const native = await openOutbox(path);
  const rows = await native.rows(), status = await native.status();
  if (rows.length !== checks.summary.nativeEvents ||
      status.uniqueNativeReceipts !== checks.summary.nativeEvents ||
      status.delivered !== checks.summary.delivered ||
      status.exhausted !== checks.summary.exhausted || status.pending !== checks.summary.pending)
    fail('NATIVE_SF98_STATUS_DISAGREEMENT');
  return checks;
}
async function writePrivate(dir, name, bytes) {
  const h = await open(join(dir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
}
async function syncDir(dir) {
  const h = await open(dir, constants.O_RDONLY);
  try { await h.sync(); } finally { await h.close(); }
}
async function createCopy(target, sourceData, manifest = null) {
  await destinationAbsent(target);
  await mkdir(target, { mode: 0o700 });
  try {
    for (const name of NAMES) await writePrivate(target, name, sourceData[name]);
    const readback = await capture(target);
    if (readback.sha256 !== fingerprint(sourceData)) fail('COPY_READBACK_MISMATCH');
    const reviewed = await nativeReview(target, readback);
    if (manifest) {
      if (JSON.stringify(reviewed.summary) !== JSON.stringify(manifest.summary)) fail('MANIFEST_NATIVE_SUMMARY_MISMATCH');
      await writePrivate(target, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    }
    await syncDir(target);
    await syncDir(dirname(target));
    return { readback, summary: reviewed.summary };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
export async function backupOutbox(source, target) {
  source = fullPath(source); target = fullPath(target);
  assertDisjoint(source, target);
  await destinationAbsent(target);
  const before = await stableCapture(source);
  const checks = validateShape(before.data);
  const manifest = {
    schema: SCHEMA, createdAt: new Date().toISOString(),
    sourceFingerprint: before.sha256,
    files: Object.fromEntries(NAMES.map(name => [name, { bytes: before.data[name].length, sha256: HASH(before.data[name]) }])),
    summary: checks.summary,
  };
  await createCopy(target, before.data, manifest);
  const after = await stableCapture(source);
  if (before.sha256 !== after.sha256) {
    await rm(target, { recursive: true, force: true });
    fail('SOURCE_CHANGED_DURING_BACKUP');
  }
  return { operation: 'backup', sourceFingerprint: before.sha256, summary: manifest.summary, target };
}
export async function verifyBackup(path) {
  path = fullPath(path);
  const snap = await capture(path);
  const entries = (await readdir(path)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...NAMES, 'manifest.json'].sort()))
    fail('UNEXPECTED_BACKUP_FILES');
  const manifestFile = await readOne(path, 'manifest.json', false);
  if (!manifestFile.length || manifestFile.length > 64 * 1024) fail('INVALID_MANIFEST_FILE');
  let manifest;
  try { manifest = JSON.parse(strictUtf8.decode(manifestFile)); }
  catch { fail('INVALID_MANIFEST_JSON'); }
  if (manifest?.schema !== SCHEMA || !HEX64(manifest.sourceFingerprint) ||
      manifest.sourceFingerprint !== snap.sha256) fail('MANIFEST_FINGERPRINT_MISMATCH');
  for (const name of NAMES) {
    const entry = manifest.files?.[name];
    if (entry?.bytes !== snap.data[name].length || entry?.sha256 !== HASH(snap.data[name]))
      fail('MANIFEST_FILE_MISMATCH_' + name);
  }
  const checks = await nativeReview(path, snap);
  if (JSON.stringify(manifest.summary) !== JSON.stringify(checks.summary)) fail('MANIFEST_NATIVE_SUMMARY_MISMATCH');
  return { operation: 'verify', sourceFingerprint: snap.sha256, summary: checks.summary, manifest, data: snap.data };
}
export async function restoreOutbox(backup, destination, expectedFingerprint) {
  backup = fullPath(backup); destination = fullPath(destination);
  assertDisjoint(backup, destination);
  if (!HEX64(expectedFingerprint)) fail('EXPECTED_FINGERPRINT_REQUIRED');
  const verified = await verifyBackup(backup);
  if (verified.sourceFingerprint !== expectedFingerprint) fail('OPERATOR_FINGERPRINT_MISMATCH');
  await createCopy(destination, verified.data);
  const after = await capture(destination);
  if (after.sha256 !== expectedFingerprint) fail('RESTORE_HASH_MISMATCH');
  return { operation: 'restore', sourceFingerprint: after.sha256, summary: verified.summary, destination,
    serviceStarted: false };
}
export async function compareOutbox(backup, live) {
  backup = fullPath(backup); live = fullPath(live);
  assertDisjoint(backup, live);
  const archive = await verifyBackup(backup), current = await stableCapture(live);
  const a = validateShape(archive.data), b = validateShape(current.data);
  const idsA = new Set(a.byId.keys()), idsB = new Set(b.byId.keys());
  const added = [...idsB].filter(id => !idsA.has(id)).length;
  const missing = [...idsA].filter(id => !idsB.has(id)).length;
  let changedEvents = 0, changedDeliveryState = 0;
  for (const id of idsA) if (idsB.has(id)) {
    if (JSON.stringify(a.byId.get(id)) !== JSON.stringify(b.byId.get(id))) changedEvents++;
    if (JSON.stringify(a.latest.get(id) ?? null) !== JSON.stringify(b.latest.get(id) ?? null)) changedDeliveryState++;
  }
  return { operation: 'compare', backupFingerprint: archive.sourceFingerprint,
    liveFingerprint: current.sha256, sameBytes: archive.sourceFingerprint === current.sha256,
    backup: a.summary, live: b.summary, newNativeEvents: added,
    missingNativeEvents: missing, changedNativeEvents: changedEvents,
    changedDeliveryStates: changedDeliveryState,
    safeToReplaceLive: false };
}
