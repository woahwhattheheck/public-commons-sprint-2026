// MIT. Preserve and reframe uncommitted subscription event bytes.
// The caller holds the original capture workspace lease and owns the open
// events.ndjson FileHandle. This helper never changes source rows or timestamps.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fail, identity, now, privateDirectory, optionalJson, readJson,
  atomicJson, writeAll, syncDirectory } from './common.mjs';

const JOURNAL = 'event-recovery.json';
const RAW_DIRECTORY = 'event-recovery';
const SCHEMA = 'stellar-forge.risingwave-event-recovery.v1';
const CHUNK_BYTES = 49152;
const PHASES = new Set(['PREPARED', 'TAIL_SAVED', 'TRUNCATED', 'EMBEDDED', 'COMMITTED', 'DONE']);
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const number = value => Number.isSafeInteger(value) && value >= 0;
const captureIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const timestamp = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const line = value => Buffer.from(JSON.stringify(value) + '\n');
const invalid = message => fail('RISINGWAVE_EVENT_RECOVERY_INVALID', message);
const changed = message => fail('RISINGWAVE_EVENT_RECOVERY_CHANGED', message);

function recoveries(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1024) throw invalid('The retained recovery list is invalid.');
  const ids = new Set();
  for (const item of value) {
    if (!item || !UUID.test(item.id) || ids.has(item.id) || !HEX.test(item.requestHash) ||
        !captureIdentity(item.captureId) || !timestamp(item.createdAt) ||
        !number(item.source?.from) || !number(item.source?.to) ||
        item.source.to <= item.source.from || item.source.bytes !== item.source.to - item.source.from ||
        !HEX.test(item.source.sha256) || !HEX.test(item.source.prefixSha256) ||
        item.source.path !== 'events.ndjson' ||
        item.localRawCopy?.path !== RAW_DIRECTORY + '/' + item.id + '.bin' ||
        item.localRawCopy.bytes !== item.source.bytes || item.localRawCopy.sha256 !== item.source.sha256 ||
        item.embedding?.path !== 'events.ndjson' || item.embedding.from !== item.source.from ||
        !number(item.embedding.bytes) || item.embedding.bytes === 0 || !number(item.embedding.to) ||
        item.embedding.to !== item.embedding.from + item.embedding.bytes ||
        !HEX.test(item.embedding.sha256) || item.embedding.encoding !== 'base64' ||
        item.embedding.chunkBytes !== CHUNK_BYTES ||
        item.embedding.chunks !== Math.ceil(item.source.bytes / CHUNK_BYTES))
      throw invalid('A retained recovery has an invalid identity or byte range.');
    ids.add(item.id);
  }
  return value;
}

function receipt(journal) {
  return { id: journal.id, captureId: journal.captureId, requestHash: journal.requestHash,
    createdAt: journal.createdAt, source: journal.source,
    localRawCopy: journal.localRawCopy, embedding: journal.embedding };
}

function validateJournal(value, intent) {
  if (!value || value.schema !== SCHEMA || !UUID.test(value.id) || !PHASES.has(value.phase) ||
      value.captureId !== intent.id || value.requestHash !== intent.requestHash ||
      !captureIdentity(value.captureId) || !timestamp(value.createdAt) ||
      !number(value.source?.from) || !number(value.source?.to) ||
      value.source.to <= value.source.from || value.source.bytes !== value.source.to - value.source.from ||
      !HEX.test(value.source.sha256) || !HEX.test(value.source.prefixSha256) ||
      value.source.path !== 'events.ndjson' ||
      value.localRawCopy?.path !== RAW_DIRECTORY + '/' + value.id + '.bin' ||
      value.localRawCopy.bytes !== value.source.bytes || value.localRawCopy.sha256 !== value.source.sha256)
    throw invalid('The active journal does not bind this original capture.');
  if (value.phase !== 'PREPARED') recoveries([receipt(value)]);
  return value;
}

async function regular(file, mutable = false) {
  const stat = await file.stat();
  if (!stat.isFile() || stat.mode & 0o077 || mutable && stat.nlink !== 1 ||
      typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw invalid('Recovery requires an owned private regular file with independent mutable custody.');
  return stat;
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
async function readExact(file, offset, length) {
  const result = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const next = await file.read(result, read, length - read, offset + read);
    if (!next.bytesRead) throw changed('A retained event range was truncated.');
    read += next.bytesRead;
  }
  return result;
}
async function rangeHash(file, from, to) {
  if (!number(from) || !number(to) || to < from) throw invalid('Invalid event byte range.');
  const hash = createHash('sha256');
  for (let at = from; at < to; at += CHUNK_BYTES)
    hash.update(await readExact(file, at, Math.min(CHUNK_BYTES, to - at)));
  return hash.digest('hex');
}
async function verifyPrefix(file, journal) {
  if ((await regular(file, true)).size < journal.source.from ||
      await rangeHash(file, 0, journal.source.from) !== journal.source.prefixSha256)
    throw changed('The committed event prefix differs from the original recovery journal.');
  if (journal.source.from && (await readExact(file, journal.source.from - 1, 1))[0] !== 10)
    throw invalid('The committed event offset does not end at a complete NDJSON frame.');
}
async function saveJournal(directory, journal, changes) {
  const next = { ...journal, ...changes };
  await atomicJson(join(directory, JOURNAL), next);
  return next;
}
async function rawFile(directory, journal, flags) {
  await privateDirectory(join(directory, RAW_DIRECTORY));
  const file = await open(join(directory, journal.localRawCopy.path),
    flags | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await regular(file, true); return file; }
  catch (issue) { await file.close(); throw issue; }
}
async function verifyRaw(directory, journal) {
  const file = await rawFile(directory, journal, constants.O_RDONLY);
  try {
    const before = await regular(file, true);
    if (before.size !== journal.source.bytes ||
        await rangeHash(file, 0, before.size) !== journal.source.sha256 ||
        !sameFile(before, await file.stat()))
      throw changed('The preserved raw recovery payload differs from its exact original bytes.');
  } finally { await file.close(); }
}
async function copyTail(directory, file, journal) {
  const before = await regular(file, true);
  if (before.size !== journal.source.to ||
      await rangeHash(file, journal.source.from, journal.source.to) !== journal.source.sha256)
    throw changed('The uncommitted original tail changed before its durable copy.');
  await privateDirectory(join(directory, RAW_DIRECTORY), true);
  let raw;
  try { raw = await rawFile(directory, journal, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL); }
  catch (issue) {
    if (issue.code !== 'EEXIST') throw issue;
    raw = await rawFile(directory, journal, constants.O_RDWR | constants.O_APPEND);
  }
  try {
    const existing = await regular(raw, true);
    if (existing.size > journal.source.bytes) throw changed('The partial raw recovery copy is too long.');
    for (let at = 0; at < existing.size; at += CHUNK_BYTES) {
      const length = Math.min(CHUNK_BYTES, existing.size - at);
      if (!(await readExact(raw, at, length)).equals(await readExact(file, journal.source.from + at, length)))
        throw changed('The partial recovery copy is not a prefix of the original tail.');
    }
    for (let at = existing.size; at < journal.source.bytes; at += CHUNK_BYTES)
      await writeAll(raw, await readExact(file, journal.source.from + at,
        Math.min(CHUNK_BYTES, journal.source.bytes - at)));
    await raw.sync();
  } finally { await raw.close(); }
  await syncDirectory(join(directory, RAW_DIRECTORY));
  if (!sameFile(before, await file.stat())) throw changed('The source event file changed while preserving its tail.');
  await verifyRaw(directory, journal);
}

// Each frame is independently valid JSON; arbitrary partial UTF-8/JSON is
// retained as exact base64 bytes, never interpreted as a native source event.
async function* frames(directory, journal) {
  yield line({ schema: 'stellar-forge.risingwave-event-recovery-begin.v1',
    recoveryId: journal.id, capture: journal.captureId, requestHash: journal.requestHash,
    original: journal.source, encoding: 'base64', chunkBytes: CHUNK_BYTES,
    chunks: Math.ceil(journal.source.bytes / CHUNK_BYTES) });
  const raw = await rawFile(directory, journal, constants.O_RDONLY);
  const hash = createHash('sha256');
  try {
    const before = await regular(raw, true);
    if (before.size !== journal.source.bytes) throw changed('The preserved recovery length changed.');
    let index = 0;
    for (let at = 0; at < before.size; at += CHUNK_BYTES) {
      const data = await readExact(raw, at, Math.min(CHUNK_BYTES, before.size - at));
      hash.update(data);
      yield line({ schema: 'stellar-forge.risingwave-event-recovery-chunk.v1',
        recoveryId: journal.id, index: index++, offset: at, bytes: data.length, base64: data.toString('base64') });
    }
    if (hash.digest('hex') !== journal.source.sha256 || !sameFile(before, await raw.stat()))
      throw changed('The preserved recovery payload changed while encoding it.');
  } finally { await raw.close(); }
  yield line({ schema: 'stellar-forge.risingwave-event-recovery-end.v1',
    recoveryId: journal.id, bytes: journal.source.bytes, sha256: journal.source.sha256 });
}
async function embedding(directory, journal) {
  const hash = createHash('sha256'); let length = 0;
  for await (const frame of frames(directory, journal)) { hash.update(frame); length += frame.length; }
  return { path: 'events.ndjson', from: journal.source.from, to: journal.source.from + length,
    bytes: length, sha256: hash.digest('hex'), encoding: 'base64',
    chunkBytes: CHUNK_BYTES, chunks: Math.ceil(journal.source.bytes / CHUNK_BYTES) };
}
async function knownSuffix(file, directory, journal) {
  const length = (await regular(file, true)).size - journal.source.from;
  if (length < 0) return false;
  if (length === journal.source.bytes &&
      await rangeHash(file, journal.source.from, journal.source.to) === journal.source.sha256) return true;
  if (length > journal.embedding.bytes) return false;
  let compared = 0;
  for await (const frame of frames(directory, journal)) {
    const count = Math.min(frame.length, length - compared);
    if (count && !(await readExact(file, journal.source.from + compared, count)).equals(frame.subarray(0, count))) return false;
    compared += count;
    if (compared === length) return true;
  }
  return compared === length;
}
async function budget(directory, file, intent, journal, maxBytes) {
  const state = await lstat(join(directory, 'state.sqlite'));
  if (!state.isFile() || state.isSymbolicLink()) throw invalid('The original mirror file is unavailable.');
  const prior = recoveries(intent.eventRecoveries).filter(item => item.id !== journal.id);
  let rawBytes = journal.source.bytes;
  for (const item of prior) {
    const stat = await lstat(join(directory, item.localRawCopy.path));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.source.bytes)
      throw changed('A previous local recovery payload is unavailable.');
    rawBytes += stat.size;
  }
  const eventPeak = Math.max((await regular(file, true)).size, journal.embedding?.to ?? journal.source.to);
  // Include independent raw custody and room for atomic control-file replacement.
  const controls = 16384 + 4 * Buffer.byteLength(JSON.stringify(journal)) +
    2 * Buffer.byteLength(JSON.stringify(intent)) + 2 * Buffer.byteLength(JSON.stringify(receipt(journal)));
  if (!Number.isSafeInteger(eventPeak + state.size + rawBytes + controls) ||
      eventPeak + state.size + rawBytes + controls > maxBytes)
    throw fail('RISINGWAVE_CAPTURE_BYTE_LIMIT',
      'Preserving the complete interrupted event tail and its recovery frames exceeds the reviewed capture byte budget.',
      { maxBytes, requiredBytes: eventPeak + state.size + rawBytes + controls });
}
async function linkIntent(directory, intent, item) {
  const saved = await readJson(join(directory, 'intent.json'));
  if (saved.id !== intent.id || saved.requestHash !== intent.requestHash)
    throw changed('The original capture intent changed during event recovery.');
  const list = recoveries(saved.eventRecoveries), prior = list.find(value => value.id === item.id);
  if (prior && identity(prior) !== identity(item)) throw changed('The recovery intent already binds different bytes.');
  if (!prior) {
    const next = { ...saved, eventRecoveries: recoveries([...list, item]) };
    await atomicJson(join(directory, 'intent.json'), next);
    Object.assign(intent, next);
  } else Object.assign(intent, saved);
}
async function preflightReceipt(directory, mirror, intent, item) {
  const saved = await readJson(join(directory, 'intent.json'));
  if (saved.id !== intent.id || saved.requestHash !== intent.requestHash)
    throw changed('The original capture intent changed before event recovery.');
  for (const list of [recoveries(mirror.get('eventRecoveries')), recoveries(saved.eventRecoveries)]) {
    const prior = list.find(value => value.id === item.id);
    if (prior && identity(prior) !== identity(item))
      throw changed('A recovery already binds a different retained byte range.');
    recoveries(prior ? list : [...list, item]);
  }
}
function committedRecovery(mirror, journal) {
  const rows = recoveries(mirror.get('eventRecoveries'));
  const item = rows.find(value => value.id === journal.id);
  if (item && identity(item) !== identity(receipt(journal))) throw changed('The atomic mirror recovery identity differs.');
  return item;
}
async function finishJournal(directory, file, mirror, intent, journal, maxBytes) {
  journal = validateJournal(journal, intent);
  await verifyPrefix(file, journal);
  let committed = journal.embedding ? committedRecovery(mirror, journal) : null;
  if (!committed) {
    if (mirror.get('eventOffset') !== journal.source.from)
      throw changed('The original mirror offset advanced without this recovery identity.');
    if (journal.phase === 'PREPARED') {
      await budget(directory, file, intent, journal, maxBytes);
      await copyTail(directory, file, journal);
      const selected = await embedding(directory, journal);
      journal = await saveJournal(directory, journal, { phase: 'TAIL_SAVED', embedding: selected });
    }
    await verifyRaw(directory, journal);
    if (identity(await embedding(directory, journal)) !== identity(journal.embedding))
      throw changed('The deterministic recovery frame identity changed.');
    await budget(directory, file, intent, journal, maxBytes);
    await preflightReceipt(directory, mirror, intent, receipt(journal));
    if (!await knownSuffix(file, directory, journal))
      throw changed('The uncommitted bytes are neither the original tail nor this recovery attempt.');
    const stat = await regular(file, true);
    const alreadyEmbedded = stat.size === journal.embedding.to &&
      await rangeHash(file, journal.embedding.from, journal.embedding.to) === journal.embedding.sha256;
    if (!alreadyEmbedded) {
      await file.truncate(journal.source.from);
      await file.sync();
      journal = await saveJournal(directory, journal, { phase: 'TRUNCATED' });
      for await (const frame of frames(directory, journal)) await writeAll(file, frame);
      await file.sync();
      if ((await file.stat()).size !== journal.embedding.to ||
          await rangeHash(file, journal.embedding.from, journal.embedding.to) !== journal.embedding.sha256)
        throw changed('The complete embedded recovery frames did not retain their exact identity.');
    }
    journal = await saveJournal(directory, journal, { phase: 'EMBEDDED' });
    const item = receipt(journal);
    mirror.db.exec('BEGIN IMMEDIATE');
    try {
      if (mirror.get('eventOffset') !== journal.source.from || committedRecovery(mirror, journal))
        throw changed('The original recovery transaction changed before commit.');
      mirror.set('eventRecoveries', recoveries([...recoveries(mirror.get('eventRecoveries')), item]));
      mirror.set('eventOffset', journal.embedding.to);
      mirror.db.exec('COMMIT');
    } catch (issue) { try { mirror.db.exec('ROLLBACK'); } catch {} throw issue; }
    committed = item;
    journal = await saveJournal(directory, journal, { phase: 'COMMITTED' });
  }
  if (!number(mirror.get('eventOffset')) || mirror.get('eventOffset') < journal.embedding.to ||
      (await regular(file, true)).size < journal.embedding.to ||
      await rangeHash(file, journal.embedding.from, journal.embedding.to) !== journal.embedding.sha256)
    throw changed('The committed recovery frames or mirror offset are unavailable.');
  await verifyRaw(directory, journal);
  await linkIntent(directory, intent, committed);
  if (journal.phase !== 'DONE')
    journal = await saveJournal(directory, journal, { phase: 'DONE', completedAt: now() });
  return journal;
}

/**
 * Recover only the bytes after the original durable eventOffset.
 * Return offset for the caller's next append and all capture-local recovery
 * receipts for its manifest. Raw copies remain local; every raw byte is also
 * embedded in the existing events.ndjson file for seven-file receiving.
 */
export async function recoverEventLog({ directory, file, mirror, intent, maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !intent ||
      !captureIdentity(intent.id) || !HEX.test(intent.requestHash) ||
      !file || !mirror?.db || mirror.get('captureBinding') !== intent.requestHash)
    throw invalid('Use the original owned event file, mirror, capture intent and byte budget.');
  await privateDirectory(directory);
  const opened = await regular(file, true), pathStat = await lstat(join(directory, 'events.ndjson'));
  if (!pathStat.isFile() || pathStat.isSymbolicLink() ||
      opened.dev !== pathStat.dev || opened.ino !== pathStat.ino)
    throw changed('The open event handle is not this capture events.ndjson.');
  let journal = await optionalJson(join(directory, JOURNAL));
  if (journal) await finishJournal(directory, file, mirror, intent, journal, maxBytes);
  const committed = mirror.get('eventOffset') ?? 0, stat = await regular(file, true);
  if (!number(committed) || committed > stat.size) throw changed('The committed event offset exceeds the retained file.');
  if (committed && (await readExact(file, committed - 1, 1))[0] !== 10)
    throw invalid('The durable event prefix does not end at a complete frame.');
  if (stat.size === committed) return { offset: committed, recoveries: recoveries(intent.eventRecoveries) };
  const id = randomUUID();
  const source = { path: 'events.ndjson', from: committed, to: stat.size, bytes: stat.size - committed,
    sha256: await rangeHash(file, committed, stat.size), prefixSha256: await rangeHash(file, 0, committed) };
  if (!sameFile(stat, await file.stat())) throw changed('The original tail changed before the recovery intent was saved.');
  journal = { schema: SCHEMA, id, captureId: intent.id, requestHash: intent.requestHash,
    phase: 'PREPARED', createdAt: now(), source,
    localRawCopy: { path: RAW_DIRECTORY + '/' + id + '.bin', bytes: source.bytes, sha256: source.sha256 } };
  await budget(directory, file, intent, journal, maxBytes);
  await atomicJson(join(directory, JOURNAL), journal);
  await finishJournal(directory, file, mirror, intent, journal, maxBytes);
  const offset = mirror.get('eventOffset');
  if ((await regular(file, true)).size !== offset) throw changed('The recovered event file and original mirror disagree.');
  return { offset, recoveries: recoveries(intent.eventRecoveries) };
}
