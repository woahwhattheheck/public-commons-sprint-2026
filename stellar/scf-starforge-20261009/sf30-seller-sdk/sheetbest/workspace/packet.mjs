// MIT. Private portable Sheet Best source bytes and explicit public projection.
import { join, dirname } from 'node:path';
import { rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { bytes, digest, identity, readPrivate, createFile, privateDirectory, syncDirectory, fault } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, only, readSheetBestSourceFile, compileQueries, binding } from '../declaration.mjs';
import { recordsFromBytes, readSheetBestCapture, bindSheetBestCapture } from '../capture.mjs';
import { projectionOrders, initialOrders } from './projection.mjs';

export const PACKET_SCHEMA = 'stellar-forge.sheetbest-source-packet.v1';
export const MAX_PACKET_BYTES = MAX_CAPTURE_BYTES * 2 + 1048576;
const HASH = /^[a-f0-9]{64}$/;
export function encoded(content) {
  return { encoding: 'base64', bytes: content.length, sha256: digest(content), data: content.toString('base64') };
}
export function decoded(value, maximum = MAX_CAPTURE_BYTES) {
  only(value, ['encoding','bytes','sha256','data'], 'SHEETBEST_PACKET_FILE_INVALID');
  if (value.encoding !== 'base64' || typeof value.data !== 'string' ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > maximum ||
      value.data.length !== 4 * Math.ceil(value.bytes / 3) || !HASH.test(value.sha256 ?? '') ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    throw fault('SHEETBEST_PACKET_FILE_INVALID');
  const content = Buffer.from(value.data, 'base64');
  if (content.length !== value.bytes || digest(content) !== value.sha256) throw fault('SHEETBEST_PACKET_BYTES_CHANGED');
  return content;
}
const parse = value => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw fault('SHEETBEST_PACKET_JSON_INVALID'); } };
export function validatePacket(packet) {
  only(packet, ['schema','createdAt','source','orders','origin','version','capture'], 'SHEETBEST_PACKET_INVALID');
  if (packet.schema !== PACKET_SCHEMA || typeof packet.createdAt !== 'string' || !Number.isFinite(Date.parse(packet.createdAt)))
    throw fault('SHEETBEST_PACKET_INVALID');
  only(packet.source, ['schema','connectionId','tab','valueMode','connection','queries'], 'SHEETBEST_PACKET_SOURCE_INVALID');
  if (packet.source.schema !== 'stellar-forge.sheetbest-source.v1') throw fault('SHEETBEST_PACKET_SOURCE_INVALID');
  only(packet.source.connection, ['kind','file','sha256'], 'SHEETBEST_PACKET_SOURCE_INVALID');
  if (packet.source.connection.kind !== 'capture' || packet.source.connection.file !== 'capture/capture.json')
    throw fault('SHEETBEST_PACKET_SOURCE_INVALID');
  const selected = binding(packet.source);
  const orders = projectionOrders(packet.source.queries, packet.orders, { allowEmpty: true });
  only(packet.capture, ['manifest','records'], 'SHEETBEST_PACKET_CAPTURE_INVALID');
  const manifestBytes = decoded(packet.capture.manifest, 16384), manifest = parse(manifestBytes);
  const resourceBytes = decoded(packet.capture.records);
  const records = recordsFromBytes(resourceBytes);
  if (manifest.schema !== 'stellar-forge.sheetbest-capture.v1' || manifest.provider !== 'sheetbest' ||
      manifest.readOnly !== true || manifest.responseKind !== 'SINGLE_RECORDS_RESPONSE' || manifest.format !== 'records' ||
      manifest.resourceFile !== 'records.json' || !['sheetbest-rest','operator-import'].includes(manifest.transport) ||
      manifest.method !== (manifest.transport === 'sheetbest-rest' ? 'GET' : 'IMPORT') ||
      manifest.sourceBytes !== resourceBytes.length || manifest.sourceSha256 !== digest(resourceBytes) ||
      manifest.rowCount !== records.length || packet.createdAt !== manifest.receivedAt ||
      packet.source.connection.sha256 !== digest(manifestBytes) || identity(binding(manifest)) !== identity(selected))
    throw fault('SHEETBEST_PACKET_CAPTURE_CHANGED');
  return { manifest, manifestBytes, manifestSha256: digest(manifestBytes), resourceBytes, records,
    source: structuredClone(packet.source), orders };
}
export async function createOrVerify(path, content, maximum = MAX_PACKET_BYTES) {
  try {
    const prior = await readPrivate(path, maximum);
    if (prior.length !== content.length || digest(prior) !== digest(content)) throw fault('SHEETBEST_RETAINED_FILE_CHANGED');
    return;
  } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  const temporary = join(dirname(path), '.write-' + randomUUID());
  await createFile(temporary, content);
  try { await rename(temporary, path); }
  catch (issue) { await unlink(temporary).catch(() => {}); throw issue; }
  await syncDirectory(dirname(path));
}
export async function retainPacket(packet, directory) {
  const checked = validatePacket(packet);
  await privateDirectory(directory, true);
  await createOrVerify(join(directory, 'records.json'), checked.resourceBytes, MAX_CAPTURE_BYTES);
  await createOrVerify(join(directory, 'capture.json'), checked.manifestBytes, 16384);
  const retained = await readSheetBestCapture(join(directory, 'capture.json'), checked.manifestSha256);
  bindSheetBestCapture(retained, checked.source);
  return retained;
}
export function packetFromCapture(capture, config, { origin = null, version = null, orders = {} } = {}) {
  bindSheetBestCapture(capture, config);
  return { schema: PACKET_SCHEMA, createdAt: capture.manifest.receivedAt,
    source: { ...structuredClone(config), connection: { kind: 'capture', file: 'capture/capture.json', sha256: capture.manifestSha256 } },
    orders: projectionOrders(config.queries, orders, { allowEmpty: true }), origin, version,
    capture: { manifest: encoded(capture.manifestBytes), records: encoded(capture.resourceBytes) } };
}
export async function makeSheetBestSourcePacket(sourceFile, { orders } = {}) {
  const original = await readSheetBestSourceFile(sourceFile);
  if (!original.captureFile) throw fault('SHEETBEST_FROZEN_SOURCE_REQUIRED',
    'Use the existing frozen source declaration. This import performs no provider read.');
  const retained = await readSheetBestCapture(original.captureFile, original.config.connection.sha256);
  return packetFromCapture(retained, original.config, {
    orders: orders ?? initialOrders(original.config.queries),
    origin: { sourceSha256: original.hash, sourceBytes: original.original.length, captureSha256: retained.manifestSha256,
      orderOrigin: orders === undefined ? 'PROPOSED_FIRST_COLUMN_ASCENDING' : 'OPERATOR_SUPPLIED' } });
}
