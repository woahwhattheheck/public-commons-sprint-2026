// MIT. Portable original NocoDB response bytes, without credential values.
import { join, dirname } from 'node:path';
import { rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, readPrivate, createFile, privateDirectory, syncDirectory, fault } from '../../postgres/publisher/files.mjs';
import { MAX_CAPTURE_BYTES, MAX_PAGE_BYTES, only, readNocoDBSourceFile, compileQueries, sourceSelection } from '../declaration.mjs';
import { readNocoDBCapture, bindNocoDBCapture } from '../capture.mjs';

export const PACKET_SCHEMA = 'stellar-forge.nocodb-source-packet.v1';
export const MAX_PACKET_BYTES = MAX_CAPTURE_BYTES * 2 + 16777216;
const HASH = /^[a-f0-9]{64}$/;
const FILE = /^(?:capture|table-before|table-after|count-before|count-after|page-[0-9]{6})\.json$/;
export function encoded(content) {
  return { encoding: 'base64', bytes: content.length, sha256: digest(content), data: content.toString('base64') };
}
export function decoded(value, maximum = MAX_PAGE_BYTES) {
  only(value, ['encoding','bytes','sha256','data'], 'NOCODB_PACKET_FILE_INVALID');
  if (value.encoding !== 'base64' || typeof value.data !== 'string' ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > maximum ||
      value.data.length !== 4 * Math.ceil(value.bytes / 3) || !HASH.test(value.sha256 ?? '') ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))
    throw fault('NOCODB_PACKET_FILE_INVALID');
  const content = Buffer.from(value.data, 'base64');
  if (content.length !== value.bytes || digest(content) !== value.sha256) throw fault('NOCODB_PACKET_BYTES_CHANGED');
  return content;
}
const parse = value => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { throw fault('NOCODB_PACKET_JSON_INVALID'); } };
export function validatePacket(packet) {
  only(packet, ['schema','createdAt','source','origin','version','capture'], 'NOCODB_PACKET_INVALID');
  if (packet.schema !== PACKET_SCHEMA || typeof packet.createdAt !== 'string' || !Number.isFinite(Date.parse(packet.createdAt)))
    throw fault('NOCODB_PACKET_INVALID');
  only(packet.source, ['schema','server','apiVersion','baseId','tableId','viewId','where','sourceOrder','connection','queries'], 'NOCODB_PACKET_SOURCE_INVALID');
  if (packet.source.schema !== 'stellar-forge.nocodb-source.v1') throw fault('NOCODB_PACKET_SOURCE_INVALID');
  only(packet.source.connection, ['kind','file','sha256'], 'NOCODB_PACKET_SOURCE_INVALID');
  if (packet.source.connection.kind !== 'capture' || packet.source.connection.file !== 'capture/capture.json')
    throw fault('NOCODB_PACKET_SOURCE_INVALID');
  const queries = compileQueries(packet.source.queries), selection = sourceSelection(packet.source, queries);
  only(packet.capture, ['manifest','files'], 'NOCODB_PACKET_CAPTURE_INVALID');
  const manifestBytes = decoded(packet.capture.manifest), manifest = parse(manifestBytes);
  if (packet.source.connection.sha256 !== digest(manifestBytes) ||
      identity(selection) !== manifest.selectionSha256 || !Array.isArray(manifest.pages) ||
      manifest.pages.length > 10000 || !Number.isSafeInteger(manifest.sourceBytes) ||
      manifest.sourceBytes < 1 || manifest.sourceBytes > MAX_CAPTURE_BYTES)
    throw fault('NOCODB_PACKET_SELECTION_CHANGED');
  const descriptors = [manifest.tableBefore, manifest.countBefore, ...manifest.pages, manifest.countAfter, manifest.tableAfter];
  if (!Array.isArray(packet.capture.files) || packet.capture.files.length !== descriptors.length)
    throw fault('NOCODB_PACKET_FILES_INCOMPLETE');
  const expected = new Map();
  for (const row of descriptors) {
    if (!object(row) || !FILE.test(row.file ?? '') || row.file === 'capture.json' || expected.has(row.file) ||
        !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > MAX_PAGE_BYTES || !HASH.test(row.sha256 ?? ''))
      throw fault('NOCODB_PACKET_FILES_INVALID');
    expected.set(row.file, row);
  }
  const files = new Map(); let size = 0;
  for (const row of packet.capture.files) {
    only(row, ['file','content'], 'NOCODB_PACKET_FILES_INVALID');
    const original = expected.get(row.file);
    if (!original || files.has(row.file)) throw fault('NOCODB_PACKET_FILES_INVALID');
    const content = decoded(row.content);
    size += content.length;
    if (size > MAX_CAPTURE_BYTES || original.bytes !== content.length || original.sha256 !== digest(content))
      throw fault('NOCODB_PACKET_BYTES_CHANGED');
    files.set(row.file, content);
  }
  if (size !== manifest.sourceBytes) throw fault('NOCODB_PACKET_BYTES_CHANGED');
  return { manifest, manifestBytes, manifestSha256: digest(manifestBytes), files, source: structuredClone(packet.source) };
}
export async function createOrVerify(path, content, maximum = MAX_PACKET_BYTES) {
  try {
    const existing = await readPrivate(path, maximum);
    if (existing.length !== content.length || digest(existing) !== digest(content)) throw fault('NOCODB_RETAINED_FILE_CHANGED');
    return;
  } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
  // A complete temporary file is durable before it can acquire the final name.
  // An interrupted temporary file never becomes an immutable source member.
  const temporary = join(dirname(path), '.write-' + randomUUID());
  await createFile(temporary, content);
  // Callers hold the original workspace lease or own a newly created package directory.
  // Rename avoids a durable second hard-link name violating readPrivate's nlink=1 rule.
  try { await rename(temporary, path); }
  catch (issue) { await unlink(temporary).catch(() => {}); throw issue; }
  await syncDirectory(dirname(path));
}
export async function retainPacket(packet, directory) {
  const checked = validatePacket(packet);
  await privateDirectory(directory, true);
  for (const [name, content] of checked.files) await createOrVerify(join(directory, name), content, MAX_PAGE_BYTES);
  await createOrVerify(join(directory, 'capture.json'), checked.manifestBytes, MAX_PAGE_BYTES);
  const retained = await readNocoDBCapture(join(directory, 'capture.json'), checked.manifestSha256);
  bindNocoDBCapture(retained, checked.source);
  return retained;
}
export function packetFromCapture(capture, config, { origin = null, version = null } = {}) {
  bindNocoDBCapture(capture, config);
  return { schema: PACKET_SCHEMA, createdAt: capture.manifest.completedAt,
    source: { ...structuredClone(config), connection: { kind: 'capture', file: 'capture/capture.json', sha256: capture.manifestSha256 } },
    origin, version, capture: { manifest: encoded(capture.manifestBytes),
      files: [...capture.resources].map(([file, content]) => ({ file, content: encoded(content) })) } };
}
export async function makeNocoDBSourcePacket(sourceFile) {
  const original = await readNocoDBSourceFile(sourceFile);
  if (!original.captureFile) throw fault('NOCODB_FROZEN_SOURCE_REQUIRED', 'Capture and freeze the original source before importing it; this action performs no provider read.');
  const retained = await readNocoDBCapture(original.captureFile, original.config.connection.sha256);
  return packetFromCapture(retained, original.config, { origin: { sourceSha256: original.hash,
    sourceBytes: original.original.length, captureSha256: retained.manifestSha256 } });
}

