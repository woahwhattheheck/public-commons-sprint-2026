// MIT. Complete native incident receiving; immutable files resume in the same directory.
import { constants } from 'node:fs';
import { open, readdir, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, sha256, readBytes, canonical, writeNew, syncDirectory, fail } from '../common.mjs';
import { OPERATIONS_MAX_BYTES, UUID, validateOperationsExport, operationsSummary, incidentSummary } from './domain.mjs';
import { createOperationsFiles, OPERATIONS_FILES, operationsExportDescriptor } from './report.mjs';
async function privateBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || before.mode & 0o077) fail('GRPC_OPERATIONS_PRIVATE_FILE_REQUIRED');
    if (process.getuid && before.uid !== process.getuid()) fail('GRPC_OPERATIONS_PRIVATE_FILE_REQUIRED');
    const chunks = []; let total = 0;
    while (total <= maximum) {
      const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break; chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== before.size || total > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      fail('GRPC_OPERATIONS_FILE_CHANGED', 409);
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}
async function publish(path, bytes) {
  try {
    if (sha256(await privateBytes(path, bytes.length)) !== sha256(bytes)) fail('GRPC_OPERATIONS_RECEIVING_CONFLICT', 409);
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeNew(temporary, bytes);
    try { await link(temporary, path); await syncDirectory(dirname(path)); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (sha256(await privateBytes(path, bytes.length)) !== sha256(bytes)) fail('GRPC_OPERATIONS_RECEIVING_CONFLICT', 409);
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function requireReceivingEntries(root) {
  const allowed = new Set([...OPERATIONS_FILES.map(file => file.path), 'operations-received.json']);
  for (const name of await readdir(root)) if (!allowed.has(name) &&
    ![...allowed].some(file => name.startsWith(file + '.') && name.endsWith('.tmp') && UUID.test(name.slice(file.length + 1, -4))))
    fail('GRPC_OPERATIONS_RECEIVING_DIRECTORY_IN_USE', 409);
}
export async function readGrpcOperationsBundle(path) {
  const bytes = await privateBytes(path, OPERATIONS_MAX_BYTES);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { fail('GRPC_OPERATIONS_JSON_INVALID'); }
  return validateOperationsExport(value);
}
export async function receiveGrpcOperations(bundle, directory) {
  validateOperationsExport(bundle);
  const root = await privateDirectory(directory, true), files = createOperationsFiles(bundle);
  await requireReceivingEntries(root);
  for (const file of files) await publish(join(root, file.path), file.bytes);
  const descriptor = operationsExportDescriptor(bundle, files);
  const receipt = { schema:'stellar-forge.grpc-operations-customer-received.v1', ...descriptor };
  await publish(join(root, 'operations-received.json'), Buffer.from(JSON.stringify(receipt) + '\n'));
  return readGrpcOperations(directory);
}
export async function receiveGrpcOperationsDownload(client, descriptor, directory) {
  if (descriptor.schema !== 'stellar-forge.grpc-operations-files.v1' || !Array.isArray(descriptor.files)) fail('GRPC_OPERATIONS_EXPORT_DESCRIPTOR_INVALID');
  const root = await privateDirectory(directory, true), firstDescriptor = descriptor.files.find(file => file.path === 'grpc-operations.json');
  if (!firstDescriptor || !/^[a-f0-9]{64}$/.test(firstDescriptor.sha256 ?? '')) fail('GRPC_OPERATIONS_EXPORT_DESCRIPTOR_INVALID');
  await requireReceivingEntries(root);
  let bytes;
  try { bytes = await privateBytes(join(root, 'grpc-operations.json'), OPERATIONS_MAX_BYTES); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = (await client.download({ exportSha256:descriptor.exportSha256, file:'grpc-operations.json' })).bytes;
  }
  if (bytes.length !== firstDescriptor.bytes || sha256(bytes) !== firstDescriptor.sha256) fail('GRPC_OPERATIONS_RECEIVING_CONFLICT', 409);
  let bundle;
  try { bundle = validateOperationsExport(JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes))); }
  catch (error) { if (error.code) throw error; fail('GRPC_OPERATIONS_JSON_INVALID'); }
  const files = createOperationsFiles(bundle), expected = operationsExportDescriptor(bundle, files);
  if (canonical(expected) !== canonical(descriptor)) fail('GRPC_OPERATIONS_EXPORT_DESCRIPTOR_CHANGED', 409);
  // Receive the original native file once, publishing complete bytes before the
  // next file. A resumed receiving reuses those exact files and export identity.
  await publish(join(root, 'grpc-operations.json'), bytes);
  for (const file of files.slice(1)) {
    let received;
    try { received = await privateBytes(join(root, file.path), file.maximum); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      received = (await client.download({ exportSha256:descriptor.exportSha256, file:file.path })).bytes;
    }
    if (received.length !== file.bytes.length || sha256(received) !== file.sha256) fail('GRPC_OPERATIONS_DOWNLOAD_CHANGED', 409);
    await publish(join(root, file.path), received);
  }
  return receiveGrpcOperations(bundle, directory);
}
export async function readGrpcOperations(directory) {
  const root = await privateDirectory(directory), bundle = await readGrpcOperationsBundle(join(root, 'grpc-operations.json'));
  const files = createOperationsFiles(bundle);
  for (const file of files) {
    const bytes = await privateBytes(join(root, file.path), file.maximum);
    if (bytes.length !== file.bytes.length || sha256(bytes) !== file.sha256) fail('GRPC_OPERATIONS_RECEIVED_FILE_CHANGED', 409);
  }
  return { schema:'stellar-forge.grpc-operations-customer-read.v1', directory:root,
    ...operationsExportDescriptor(bundle, files), capture:operationsSummary(bundle.capture), incident:incidentSummary(bundle.history.at(-1)) };
}
