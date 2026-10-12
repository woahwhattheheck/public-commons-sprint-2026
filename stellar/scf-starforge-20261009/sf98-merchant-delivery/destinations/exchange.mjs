// MIT. Portable complete destination workspaces using original native outbox continuity.
import { mkdir, lstat, readdir, rename, rm, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupOutbox, verifyBackup, restoreOutbox } from '../../sf101-merchant-outbox-continuity/continuity.mjs';
import { openOutbox } from '../outbox.mjs';
import { openDestinationWorkspace, validateEnrollment } from './model.mjs';
import { ROOT_SCHEMA, DESTINATION_SCHEMA, CURSOR_SCHEMA, idPattern, eventPattern,
  absoluteDirectory, privateDirectory, separateDirectories, readJSON, writeJSON,
  eventPrefix, hash, fault } from './storage.mjs';

export const EXCHANGE_SCHEMA = 'stellar-forge.sf98.destinations-exchange.v1';
const RECEIVED_SCHEMA = 'stellar-forge.sf98.destinations-received.v1';
const nativeFiles = ['events.ndjson', 'deliveries.ndjson'];
const exact = value => JSON.stringify(value);
const need = (value, code) => { if (!value) throw fault(code, 409); };
const selected = (event, destination) =>
  (!destination.routeIds.length || destination.routeIds.includes(event.routeId)) &&
  (!destination.networks.length || destination.networks.includes(event.network));
const descriptorFields = ['id', 'label', 'url', 'allowedHost', 'secretEnv', 'routeIds', 'networks', 'history'];
async function absent(path) {
  absoluteDirectory(path); await privateDirectory(dirname(path));
  try { await lstat(path); throw fault('PORTABLE_DESTINATION_EXISTS', 409); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function stageFor(target) {
  await absent(target);
  const stage = join(dirname(target), '.sf98-portable-' + randomUUID());
  await mkdir(stage, { mode: 0o700 });
  return stage;
}
async function publishNew(stage, target) {
  // Reserve the final name with exclusive mkdir. The only directory replaced is
  // this process's own empty reservation; existing operator data is never replaced.
  await mkdir(target, { mode: 0o700 });
  const reserved = await lstat(target);
  try {
    const current = await lstat(target);
    need(current.dev === reserved.dev && current.ino === reserved.ino &&
      current.isDirectory() && !current.isSymbolicLink() &&
      (await readdir(target)).length === 0, 'PORTABLE_DESTINATION_CHANGED');
    await rename(stage, target); await syncDirectory(dirname(target));
  } catch (error) {
    const current = await lstat(target).catch(() => null);
    if (current && current.dev === reserved.dev && current.ino === reserved.ino &&
        current.isDirectory() && (await readdir(target)).length === 0)
      await rm(target, { recursive: true });
    throw error;
  }
}
async function exactEntries(path, names) {
  await privateDirectory(path);
  const entries = await readdir(path);
  need(exact(entries.sort()) === exact([...names].sort()), 'UNEXPECTED_PORTABLE_FILES');
}
async function eventsAt(path) {
  return (await (await openOutbox(path)).rows()).map(row => row.event);
}
function validateMetadata(row, events) {
  const destination = row?.destination, cursor = row?.cursor;
  need(destination?.schema === DESTINATION_SCHEMA && idPattern.test(destination.id ?? '') &&
    Number.isSafeInteger(destination.revision) && destination.revision >= 1 &&
    typeof destination.paused === 'boolean' &&
    typeof destination.createdAt === 'string' && typeof destination.updatedAt === 'string',
    'INVALID_PORTABLE_DESTINATION');
  const normalized = validateEnrollment(Object.fromEntries(descriptorFields.map(key => [key, destination[key]])));
  need(descriptorFields.every(key => exact(normalized[key]) === exact(destination[key])),
    'NONCANONICAL_PORTABLE_DESTINATION');
  for (const prefix of [destination.enrollment, cursor]) {
    need(prefix && Number.isSafeInteger(prefix.count) && prefix.count >= 0 &&
      prefix.count <= events.length && eventPattern.test(prefix.fingerprint ?? '') &&
      eventPrefix(events, prefix.count) === prefix.fingerprint, 'PORTABLE_SOURCE_CONTINUITY_CHANGED');
  }
  need(cursor.schema === CURSOR_SCHEMA && cursor.count >= destination.enrollment.count &&
    typeof cursor.updatedAt === 'string' &&
    (destination.history !== 'all' || destination.enrollment.count === 0),
    'INVALID_PORTABLE_CURSOR');
}
async function validateSelected(row, sourceEvents, path) {
  validateMetadata(row, sourceEvents);
  const destination = row.destination;
  const originals = new Map(sourceEvents.map((event, index) => [event.id, { event, index }]));
  const copied = new Set();
  for (const event of await eventsAt(path)) {
    const original = originals.get(event.id);
    need(original && original.index >= destination.enrollment.count &&
      selected(event, destination) && exact(event) === exact(original.event),
      'PORTABLE_DESTINATION_EVENT_CHANGED');
    copied.add(event.id);
  }
  for (let index = destination.enrollment.count; index < row.cursor.count; index++)
    need(!selected(sourceEvents[index], destination) || copied.has(sourceEvents[index].id),
      'PORTABLE_DESTINATION_CHECKPOINT_INCOMPLETE');
}
function manifestCore(manifest) {
  const { fingerprint, ...core } = manifest;
  return core;
}
export async function inspectDestinationExchange(directory) {
  absoluteDirectory(directory);
  await exactEntries(directory, ['manifest.json', 'source', 'destinations']);
  const manifest = await readJSON(join(directory, 'manifest.json'), { maxBytes: 1048576 });
  need(manifest?.schema === EXCHANGE_SCHEMA && eventPattern.test(manifest.fingerprint ?? '') &&
    hash(exact(manifestCore(manifest))) === manifest.fingerprint,
    'INVALID_PORTABLE_MANIFEST');
  need(manifest.workspace?.schema === ROOT_SCHEMA &&
    typeof manifest.workspace.createdAt === 'string' &&
    Array.isArray(manifest.destinations) && manifest.destinations.length <= 128,
    'INVALID_PORTABLE_WORKSPACE');
  absoluteDirectory(manifest.workspace.sourceDirectory);
  const ids = manifest.destinations.map(row => row?.destination?.id);
  need(ids.every(id => idPattern.test(id ?? '')) && new Set(ids).size === ids.length,
    'INVALID_PORTABLE_DESTINATION_IDS');
  need(new Set(manifest.destinations.map(row => row.destination.url)).size === ids.length,
    'DUPLICATE_PORTABLE_ENDPOINT');
  await exactEntries(join(directory, 'destinations'), ids);
  const source = await verifyBackup(join(directory, 'source'));
  need(source.sourceFingerprint === manifest.source?.nativeFingerprint,
    'PORTABLE_SOURCE_FINGERPRINT_CHANGED');
  const events = await eventsAt(join(directory, 'source'));
  need(events.length === manifest.source.events &&
    eventPrefix(events) === manifest.source.fingerprint, 'PORTABLE_SOURCE_CONTINUITY_CHANGED');
  const destinations = [];
  for (const row of manifest.destinations) {
    const path = join(directory, 'destinations', row.destination.id);
    const native = await verifyBackup(path);
    need(native.sourceFingerprint === row.nativeFingerprint, 'PORTABLE_JOURNAL_FINGERPRINT_CHANGED');
    for (const name of nativeFiles)
      need(row.files?.[name]?.bytes === native.data[name].length &&
        row.files[name].sha256 === hash(native.data[name]), 'PORTABLE_JOURNAL_BYTES_CHANGED');
    await validateSelected(row, events, path);
    destinations.push({ id: row.destination.id, label: row.destination.label,
      nativeFingerprint: native.sourceFingerprint, summary: native.summary,
      cursor: row.cursor, destination: row.destination });
  }
  return { schema: EXCHANGE_SCHEMA, directory, fingerprint: manifest.fingerprint,
    createdAt: manifest.createdAt, source: { ...manifest.source, summary: source.summary },
    destinations, manifest, serviceStarted: false };
}

// Called while the original model holds the registration lease and every selected
// destination lease. The source seller remains independent and is read optimistically.
export async function exportDestinationSnapshot(snapshot, directory, target) {
  absoluteDirectory(directory); absoluteDirectory(target);
  separateDirectories(directory, target);
  separateDirectories(snapshot.workspace.sourceDirectory, target);
  const stage = await stageFor(target);
  try {
    await mkdir(join(stage, 'destinations'), { mode: 0o700 });
    const source = await backupOutbox(snapshot.workspace.sourceDirectory, join(stage, 'source'));
    const originalEvents = await eventsAt(join(stage, 'source'));
    need(originalEvents.length === snapshot.source.events &&
      eventPrefix(originalEvents) === snapshot.source.fingerprint,
      'SOURCE_CHANGED_DURING_PORTABLE_EXPORT');
    const destinations = [];
    for (const row of snapshot.destinations) {
      const id = row.destination.id;
      need(idPattern.test(id ?? ''), 'INVALID_PORTABLE_DESTINATION_ID');
      const result = await backupOutbox(join(directory, 'destinations', id), join(stage, 'destinations', id));
      const verified = await verifyBackup(join(stage, 'destinations', id));
      for (const name of nativeFiles)
        need(row.files[name].bytes === verified.data[name].length &&
          row.files[name].sha256 === hash(verified.data[name]), 'DESTINATION_CHANGED_DURING_PORTABLE_EXPORT');
      await validateSelected(row, originalEvents, join(stage, 'destinations', id));
      destinations.push({ destination: row.destination, cursor: row.cursor,
        nativeFingerprint: result.sourceFingerprint,
        files: Object.fromEntries(nativeFiles.map(name => [name, {
          bytes: verified.data[name].length, sha256: hash(verified.data[name]) }])),
      });
    }
    const core = { schema: EXCHANGE_SCHEMA, createdAt: new Date().toISOString(),
      workspace: snapshot.workspace,
      source: { ...snapshot.source, nativeFingerprint: source.sourceFingerprint },
      destinations };
    const manifest = { ...core, fingerprint: hash(exact(core)) };
    await writeJSON(join(stage, 'manifest.json'), manifest, { createOnly: true });
    await inspectDestinationExchange(stage);
    await syncDirectory(stage); await publishNew(stage, target);
    return { operation: 'export', directory: target, fingerprint: manifest.fingerprint,
      source: manifest.source, destinations: destinations.length, serviceStarted: false };
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}
export async function exportDestinationWorkspace(directory, target) {
  const workspace = await openDestinationWorkspace({ directory });
  try { return await workspace.handoff({ portableTarget: target }); }
  finally { await workspace.close(); }
}
export async function receiveDestinationExchange(archive, target, expectedFingerprint) {
  absoluteDirectory(archive); absoluteDirectory(target); separateDirectories(archive, target);
  need(eventPattern.test(expectedFingerprint ?? ''), 'PORTABLE_FINGERPRINT_REQUIRED');
  const inspected = await inspectDestinationExchange(archive);
  need(inspected.fingerprint === expectedFingerprint, 'PORTABLE_OPERATOR_FINGERPRINT_MISMATCH');
  const stage = await stageFor(target);
  try {
    const sourceDirectory = join(target, 'source');
    const workspaceDirectory = join(target, 'workspace');
    await restoreOutbox(join(archive, 'source'), join(stage, 'source'), inspected.source.nativeFingerprint);
    await mkdir(join(stage, 'workspace'), { mode: 0o700 });
    await mkdir(join(stage, 'workspace', 'destinations'), { mode: 0o700 });
    for (const row of inspected.destinations) {
      const destination = join(stage, 'workspace', 'destinations', row.id);
      await restoreOutbox(join(archive, 'destinations', row.id), destination, row.nativeFingerprint);
      const original = inspected.manifest.destinations.find(item => item.destination.id === row.id);
      await writeJSON(join(destination, 'destination.json'), original.destination, { createOnly: true });
      await writeJSON(join(destination, 'cursor.json'), original.cursor, { createOnly: true });
    }
    await writeJSON(join(stage, 'workspace', 'workspace.json'), {
      ...inspected.manifest.workspace, sourceDirectory }, { createOnly: true });
    const receipt = { schema: RECEIVED_SCHEMA, receivedAt: new Date().toISOString(),
      fingerprint: inspected.fingerprint,
      originalSourceDirectory: inspected.manifest.workspace.sourceDirectory,
      sourceDirectory, workspaceDirectory,
      sourceNativeFingerprint: inspected.source.nativeFingerprint,
      destinations: inspected.destinations.map(row => ({ id: row.id, nativeFingerprint: row.nativeFingerprint })),
      serviceStarted: false };
    await writeJSON(join(stage, 'received.json'), receipt, { createOnly: true });
    await syncDirectory(join(stage, 'workspace', 'destinations'));
    await syncDirectory(join(stage, 'workspace')); await syncDirectory(stage);
    await publishNew(stage, target);
    return { operation: 'receive', ...receipt };
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}
