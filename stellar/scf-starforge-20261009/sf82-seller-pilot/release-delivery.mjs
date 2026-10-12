// MIT. Original SF98 destination controls scoped to an existing SF82 store.
import { realpath, lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openOutbox } from '../sf98-merchant-delivery/outbox.mjs';
import { openDestinationWorkspace } from '../sf98-merchant-delivery/destinations/model.mjs';
import { inspectDestinationExchange } from '../sf98-merchant-delivery/destinations/exchange.mjs';
import { privateDirectory, readJSON, readPrivate, hash, fault }
  from '../sf98-merchant-delivery/destinations/storage.mjs';
import { NATIVE_DELIVERY_SCHEMA } from '../sf30-seller-sdk/native-delivery.mjs';

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const fingerprint = /^[a-f0-9]{64}$/;
const present = async path => {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
export async function releaseDeliveryPaths(root, { create = false } = {}) {
  root = await realpath(resolve(root));
  await privateDirectory(root);
  const directory = join(root, 'settlement-delivery'), outboxDirectory = join(directory, 'outbox');
  if (create) { await privateDirectory(directory, true); await privateDirectory(outboxDirectory, true); }
  else if (await present(directory)) await privateDirectory(directory);
  return { root, directory, outboxDirectory, workspaceDirectory: join(directory, 'destinations'),
    producerFile: join(directory, 'producer.json'), bindingFile: join(directory, 'binding.json'),
    transfersDirectory: join(directory, 'transfers') };
}
export async function prepareReleaseDelivery(root) {
  const paths = await releaseDeliveryPaths(root, { create: true });
  return { directory: paths.directory, outboxDirectory: paths.outboxDirectory };
}
export async function verifyReleaseDeliveryStartup(root, reported, { instanceId, releaseId, releaseDigest, mode }) {
  const paths = await releaseDeliveryPaths(root);
  const binding = await readJSON(paths.bindingFile), producer = await readJSON(paths.producerFile);
  if (!reported || reported.schema !== NATIVE_DELIVERY_SCHEMA || reported.instanceId !== instanceId ||
      reported.releaseId !== releaseId || reported.releaseDigest !== releaseDigest ||
      reported.instrumented !== (mode === 'NATIVE_X402') || typeof reported.originalDecoration !== 'boolean' ||
      binding.schema !== NATIVE_DELIVERY_SCHEMA || binding.sourceDirectory !== reported.sourceDirectory ||
      producer.schema !== NATIVE_DELIVERY_SCHEMA || producer.instanceId !== instanceId ||
      producer.releaseId !== releaseId || producer.releaseDigest !== releaseDigest ||
      producer.sourceDirectory !== reported.sourceDirectory || producer.phase !== 'RUNNING' || producer.mode !== mode)
    throw fault('SF98_RELEASE_DELIVERY_IDENTITY_CHANGED', 409);
  await privateDirectory(reported.sourceDirectory);
  return { schema: NATIVE_DELIVERY_SCHEMA, instanceId, releaseId, releaseDigest,
    sourceDirectory: reported.sourceDirectory, instrumented: reported.instrumented,
    originalDecoration: reported.originalDecoration };
}
export async function inspectReleaseDelivery(root) {
  const paths = await releaseDeliveryPaths(root);
  if (!await present(paths.directory)) return { schema: NATIVE_DELIVERY_SCHEMA,
    initialized: false, producer: null, originalSource: null };
  const binding = await readJSON(paths.bindingFile, { optional: true });
  const producer = await readJSON(paths.producerFile, { optional: true });
  if (binding && (binding.schema !== NATIVE_DELIVERY_SCHEMA || typeof binding.sourceDirectory !== 'string') ||
      producer && (producer.schema !== NATIVE_DELIVERY_SCHEMA || typeof producer.instanceId !== 'string' ||
        !fingerprint.test(producer.releaseDigest ?? ''))) throw fault('SF98_DELIVERY_RECORD_INVALID', 409);
  if (!binding) return { schema: NATIVE_DELIVERY_SCHEMA, initialized: false, producer, originalSource: null };
  const sourceDirectory = binding.sourceDirectory;
  await privateDirectory(sourceDirectory);
  const source = await openOutbox(sourceDirectory);
  return { schema: NATIVE_DELIVERY_SCHEMA, initialized: true, producer,
    originalSource: { directory: sourceDirectory, ...await source.status() } };
}
export async function openReleaseDeliveryWorkspace(root, { environment = process.env } = {}) {
  const paths = await releaseDeliveryPaths(root, { create: true });
  const binding = await readJSON(paths.bindingFile, { optional: true });
  if (binding && (binding.schema !== NATIVE_DELIVERY_SCHEMA || typeof binding.sourceDirectory !== 'string'))
    throw fault('SF98_DELIVERY_RECORD_INVALID', 409);
  if (!binding) throw fault('SF98_DELIVERY_NOT_INITIALIZED', 409);
  const sourceDirectory = binding.sourceDirectory;
  await privateDirectory(sourceDirectory);
  return openDestinationWorkspace({ directory: paths.workspaceDirectory, sourceDirectory, environment });
}
function transferId(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw fault('FLEET_DELIVERY_TRANSFER_ID_REQUIRED');
  return id;
}
function transferView(id, inspected) {
  return { id, schema: inspected.schema, fingerprint: inspected.fingerprint,
    createdAt: inspected.createdAt, source: inspected.source,
    destinations: inspected.destinations.map(({ id, label, nativeFingerprint, summary, cursor, destination }) =>
      ({ id, label, nativeFingerprint, summary, cursor, secretEnv: destination.secretEnv })),
    directory: inspected.directory,
    receiving: { module: 'sf98-merchant-delivery/destinations/cli.mjs',
      inspect: ['inspect', '--workspace', inspected.directory],
      receive: ['receive', '--from', inspected.directory, '--workspace', 'NEW_PRIVATE_DIRECTORY',
        '--fingerprint', inspected.fingerprint] },
    serviceStarted: false };
}
export async function inspectReleaseDeliveryTransfer(root, id, expectedFingerprint) {
  const paths = await releaseDeliveryPaths(root);
  const inspected = await inspectDestinationExchange(join(paths.transfersDirectory, transferId(id)));
  if (expectedFingerprint !== undefined && inspected.fingerprint !== expectedFingerprint)
    throw fault('FLEET_DELIVERY_TRANSFER_CHANGED', 409);
  return transferView(id, inspected);
}
export async function listReleaseDeliveryTransfers(root, { after, limit = 25 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || after !== undefined && !idPattern.test(after))
    throw fault('FLEET_DELIVERY_TRANSFER_PAGE_INVALID');
  const paths = await releaseDeliveryPaths(root);
  if (!await present(paths.transfersDirectory)) return { transfers: [], errors: [], next: null };
  await privateDirectory(paths.transfersDirectory);
  const names = (await readdir(paths.transfersDirectory)).filter(name => idPattern.test(name)).sort()
    .filter(name => after === undefined || name > after);
  const selected = names.slice(0, limit), transfers = [], errors = [];
  for (const id of selected) {
    try { transfers.push(await inspectReleaseDeliveryTransfer(root, id)); }
    catch { errors.push({ id, code: 'ORIGINAL_DELIVERY_TRANSFER_UNREADABLE' }); }
  }
  return { transfers, errors, next: names.length > selected.length ? selected.at(-1) : null };
}
export async function createReleaseDeliveryTransfer(root, { id, expectedSourceFingerprint, model, signal } = {}) {
  transferId(id);
  if (!fingerprint.test(expectedSourceFingerprint ?? '')) throw fault('FLEET_DELIVERY_SOURCE_FINGERPRINT_REQUIRED');
  const paths = await releaseDeliveryPaths(root, { create: true });
  await privateDirectory(paths.transfersDirectory, true);
  const target = join(paths.transfersDirectory, id);
  if (await present(target)) {
    const retained = await inspectReleaseDeliveryTransfer(root, id);
    if (retained.source.fingerprint !== expectedSourceFingerprint) throw fault('FLEET_DELIVERY_TRANSFER_CHANGED', 409);
    return { ...retained, retained: true };
  }
  signal?.throwIfAborted();
  const owned = !model, original = model ?? await openReleaseDeliveryWorkspace(root);
  try {
    const state = await original.state();
    if (state.source.fingerprint !== expectedSourceFingerprint) throw fault('FLEET_DELIVERY_SOURCE_CHANGED', 409);
    await original.handoff({ portableTarget: target });
    const result = await inspectReleaseDeliveryTransfer(root, id);
    // Source capture is optimistic in the original exporter. Its retained prefix
    // remains the exact reviewed source even if the seller receives a new event.
    if (result.source.fingerprint !== expectedSourceFingerprint) throw fault('FLEET_DELIVERY_SOURCE_CHANGED', 409);
    return { ...result, retained: false };
  } finally { if (owned) await original.close(); }
}

const nativeFiles = ['manifest.json', 'events.ndjson', 'deliveries.ndjson'];
function transferNames(inspected) {
  return ['manifest.json', ...nativeFiles.map(name => 'source/' + name),
    ...inspected.destinations.flatMap(row => nativeFiles.map(name => 'destinations/' + row.id + '/' + name))];
}
export async function releaseDeliveryTransferCatalog(root, id, expectedFingerprint) {
  const inspected = await inspectReleaseDeliveryTransfer(root, id, expectedFingerprint);
  const files = [];
  for (const name of transferNames(inspected)) {
    const content = await readPrivate(join(inspected.directory, name), { maxBytes: 33554432 });
    files.push({ name, bytes: Buffer.byteLength(content), sha256: hash(content),
      contentType: name.endsWith('.ndjson') ? 'application/x-ndjson' : 'application/json' });
  }
  return { ...inspected, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    directories: ['source', 'destinations', ...inspected.destinations.map(row => 'destinations/' + row.id)] };
}
export async function readReleaseDeliveryTransferFile(root, { id, expectedFingerprint, name, expectedSha256 } = {}) {
  if (!fingerprint.test(expectedFingerprint ?? '') || !fingerprint.test(expectedSha256 ?? '') ||
      typeof name !== 'string') throw fault('FLEET_DELIVERY_FILE_SELECTION_REQUIRED');
  const manifest = await releaseDeliveryTransferCatalog(root, id, expectedFingerprint);
  const selected = manifest.files.find(row => row.name === name);
  if (!selected || selected.sha256 !== expectedSha256) throw fault('FLEET_DELIVERY_TRANSFER_CHANGED', 409);
  const bytes = Buffer.from(await readPrivate(join(manifest.directory, name), { maxBytes: 33554432 }));
  if (bytes.length !== selected.bytes || hash(bytes) !== selected.sha256)
    throw fault('FLEET_DELIVERY_TRANSFER_CHANGED', 409);
  return { bytes, name, type: selected.contentType };
}
