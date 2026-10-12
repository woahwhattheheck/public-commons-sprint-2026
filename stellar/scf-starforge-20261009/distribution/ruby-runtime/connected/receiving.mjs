// MIT. Complete original file receiving and customer continuation for either client.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { absolute, directory, once, json, readJSON, hashObject, fingerprint,
  operationId, operationLease, saveJSON, syncParent, MAX_BYTES } from '../files.mjs';
import { need, connectedError, MAX_CHUNK_BYTES } from './protocol.mjs';

const DOWNLOAD_SCHEMA = 'stellar-forge.ruby-connected-download.v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => ({ dev: String(value.dev), ino: String(value.ino) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function aborted(signal) { signal?.throwIfAborted(); }
function fileOK(stat) {
  need(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'RUBY_RECEIVING_PRIVATE_FILE', 'Use the original private customer receiving file.', 409);
}
async function readExactly(handle, length, offset) {
  const bytes = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const result = await handle.read(bytes, done, length - done, offset + done);
    need(result.bytesRead > 0, 'RUBY_RECEIVING_FILE_CHANGED', 'The complete original file ended early.', 409);
    done += result.bytesRead;
  }
  return bytes;
}
async function writeExactly(handle, bytes, offset) {
  let done = 0;
  while (done < bytes.length) {
    const result = await handle.write(bytes, done, bytes.length - done, offset + done);
    need(result.bytesWritten > 0, 'RUBY_RECEIVING_WRITE', 'The original customer receiving file could not be written.', 500);
    done += result.bytesWritten;
  }
}
async function available(path) {
  try { return await fingerprint(path, { maximum: MAX_BYTES, privateOnly: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function sameFile(actual, expected) {
  need(actual && actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
    'RUBY_RECEIVING_FILE_CHANGED', 'The complete received file differs from its original selection.', 409);
}
function callOptions(signal) { return signal ? { signal } : undefined; }

/**
 * Each complete file gets its own private receiving directory. download.json,
 * cursor.json and the original transfer ID survive a disconnected client.
 */
export async function downloadRubyFile(client, {
  transferId, directory: output, source, expectedSha256, signal,
} = {}) {
  operationId(transferId); absolute(output); aborted(signal);
  let selected;
  if (source) selected = await client.openTransfer({ transferId, source,
    ...(expectedSha256 ? { expectedSha256 } : {}) }, callOptions(signal));
  else selected = await client.transfer({ transferId }, callOptions(signal));
  need(selected.transferId === transferId && Number.isSafeInteger(selected.bytes) &&
    selected.bytes >= 0 && selected.bytes <= MAX_BYTES && /^[a-f0-9]{64}$/.test(selected.sha256),
    'RUBY_RECEIVING_SELECTION', 'Read the complete original file selection before receiving.');
  if (expectedSha256) need(expectedSha256 === selected.sha256,
    'RUBY_RECEIVING_SHA', 'The complete original file differs from the selected SHA.', 409);
  let root;
  try { root = await directory(output, true); }
  catch (error) { await client.closeTransfer({ transferId }).catch(() => {}); throw error; }
  let lease = null, file = null;
  const name = selected.type === 'application/x-tar' ? 'payload.tar' :
    selected.type === 'application/json' ? 'payload.json' : 'payload';
  const destination = join(root, name), partial = join(root, 'payload.part');
  const request = { schema: DOWNLOAD_SCHEMA, transferId, name: selected.name,
    bytes: selected.bytes, sha256: selected.sha256, type: selected.type,
    source: selected.source, selectionSha256: selected.selectionSha256, filename: name };
  async function complete(actual) {
    sameFile(actual, request);
    const receipt = { ...request, state: 'COMPLETE', directory: root, path: destination };
    await once(join(root, 'received.json'), json(receipt));
    return receipt;
  }
  try {
    lease = await operationLease(join(root, 'receiver.lock'));
    await once(join(root, 'download.json'), json(request));
    const retained = await available(destination);
    if (retained) {
      const result = await complete(retained);
      try { await unlink(partial); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await syncParent(partial);
      return result;
    }
    try { file = await open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      file = await open(partial, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    const initial = await file.stat(); fileOK(initial);
    let cursor = await readJSON(join(root, 'cursor.json'), true);
    if (!cursor) {
      need(initial.size === 0, 'RUBY_RECEIVING_UNTRACKED_BYTES', 'The original receiving file has no durable byte cursor.', 409);
      await file.sync(); await syncParent(partial);
      cursor = { schema: DOWNLOAD_SCHEMA, requestSha256: hashObject(request),
        committedBytes: 0, file: identity(initial) };
      await once(join(root, 'cursor.json'), json(cursor));
    }
    need(cursor.schema === DOWNLOAD_SCHEMA && cursor.requestSha256 === hashObject(request) &&
      Number.isSafeInteger(cursor.committedBytes) && cursor.committedBytes >= 0 &&
      cursor.committedBytes <= request.bytes && same(cursor.file, identity(initial)) &&
      initial.size >= cursor.committedBytes,
      'RUBY_RECEIVING_CURSOR_CHANGED', 'Reopen the original receiving directory and complete-file selection.', 409);
    if (initial.size > cursor.committedBytes) { await file.truncate(cursor.committedBytes); await file.sync(); }
    while (cursor.committedBytes < request.bytes) {
      aborted(signal);
      const offset = cursor.committedBytes, limit = Math.min(MAX_CHUNK_BYTES, request.bytes - offset);
      const part = await client.readTransfer({ transferId, offset, limit }, callOptions(signal));
      need(typeof part.data === 'string', 'RUBY_RECEIVING_CHUNK', 'The original server did not return complete file bytes.', 502);
      const bytes = Buffer.from(part.data, 'base64');
      need(part.transferId === transferId && part.encoding === 'base64' &&
        bytes.toString('base64') === part.data && bytes.length > 0 && bytes.length <= limit &&
        part.offset === offset && part.bytes === bytes.length && part.nextOffset === offset + bytes.length &&
        part.totalBytes === request.bytes && part.fileSha256 === request.sha256 &&
        digest(bytes) === part.sha256 && part.eof === (part.nextOffset === request.bytes),
        'RUBY_RECEIVING_CHUNK_CHANGED', 'The original selected file chunk does not match its complete bytes.', 502);
      await writeExactly(file, bytes, offset); await file.sync();
      cursor = { ...cursor, committedBytes: offset + bytes.length };
      await saveJSON(join(root, 'cursor.json'), cursor, true);
    }
    aborted(signal);
    await file.sync(); await file.close(); file = null;
    sameFile(await available(partial), request);
    try { await link(partial, destination); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await syncParent(destination);
    const result = await complete(await available(destination));
    await unlink(partial); await syncParent(partial);
    return result;
  } finally {
    try { if (file) await file.close(); }
    finally {
      try { if (lease) await lease.close(); }
      finally { await client.closeTransfer({ transferId }).catch(() => {}); }
    }
  }
}

/** Send one full original TAR, continuing the same saved server cursor on every invocation. */
export async function uploadRubyArchive(client, {
  archive, operationId: key, id, title, ruby, bundlerVersion, expectedSha256, bytes: expectedBytes, signal,
} = {}) {
  absolute(archive); operationId(key); aborted(signal);
  const original = await fingerprint(archive, { maximum: MAX_BYTES });
  if (expectedSha256 !== undefined) need(original.sha256 === expectedSha256,
    'RUBY_RECEIVING_SHA', 'The original complete archive has a different SHA.', 409);
  if (expectedBytes !== undefined) need(original.bytes === expectedBytes,
    'RUBY_RECEIVING_SIZE', 'The original complete archive has a different byte length.', 409);
  const selection = { operationId: key, id, title, ruby,
    ...(bundlerVersion === undefined ? {} : { bundlerVersion }),
    expectedSha256: original.sha256, bytes: original.bytes };
  let status = await client.prepareUpload(selection, callOptions(signal));
  const file = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.size === BigInt(original.bytes),
      'RUBY_RECEIVING_ARCHIVE_CHANGED', 'Re-select the complete original runtime archive.', 409);
    while (status.phase !== 'RECEIVED' && status.committedBytes < original.bytes) {
      aborted(signal);
      const offset = status.committedBytes;
      need(Number.isSafeInteger(offset) && offset >= 0 && offset <= original.bytes,
        'RUBY_RECEIVING_UPLOAD_CURSOR', 'The original receiving server returned an invalid saved offset.', 502);
      const part = await readExactly(file, Math.min(MAX_CHUNK_BYTES, original.bytes - offset), offset);
      try {
        status = await client.writeUpload({ operationId: key, offset,
          data: part.toString('base64'), sha256: digest(part) }, callOptions(signal));
      } catch (error) {
        // A status read can adopt an accepted original chunk after its response
        // was lost. No replacement operation or blind archive resend is made.
        aborted(signal);
        let observed;
        try { observed = await client.upload({ operationId: key }, callOptions(signal)); }
        catch { throw error; }
        if (observed.committedBytes <= offset) throw error;
        status = observed;
      }
      need(status.operationId === key && Number.isSafeInteger(status.committedBytes) &&
        status.committedBytes > offset && status.committedBytes <= original.bytes,
        'RUBY_RECEIVING_UPLOAD_CURSOR', 'The original receiving server did not retain the complete selected chunk.', 502);
    }
    const after = await file.stat({ bigint: true });
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(name => before[name] === after[name]),
      'RUBY_RECEIVING_ARCHIVE_CHANGED', 'The original archive changed while it was being transferred.', 409);
    aborted(signal);
    return await client.finishUpload({ operationId: key }, callOptions(signal));
  } finally { await file.close(); }
}

function timing({ intervalMs = 1000, timeoutMs = 30 * 60 * 1000 } = {}) {
  need(Number.isSafeInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 30000 &&
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 24 * 60 * 60 * 1000,
    'RUBY_RECEIVING_WAIT', 'Use a polling interval of 250 ms to 30 seconds and a timeout of one second to one day.');
  return { intervalMs, timeoutMs, started: Date.now() };
}
function timedOut(clock, details) {
  if (Date.now() - clock.started >= clock.timeoutMs) throw connectedError('RUBY_RECEIVING_WAIT_TIMEOUT',
    'The original native operation is still saved. Read or continue the same ID.', 408, details);
}
export async function waitForRubyOperation(client, { operationId: key, signal, ...options } = {}) {
  operationId(key);
  const clock = timing(options);
  while (true) {
    aborted(signal);
    const operation = await client.operation({ operationId: key }, callOptions(signal));
    need(operation?.id === key, 'RUBY_RECEIVING_OPERATION_CHANGED', 'Read the original selected operation UUID.', 409);
    if (!operation.active && operation.phase === 'SUCCEEDED') return operation;
    if (!operation.active && ['FAILED','CANCELLED','INTERRUPTED'].includes(operation.phase)) {
      throw connectedError('RUBY_RECEIVING_OPERATION_FAILED',
        operation.error?.message ?? 'Read the original worker log and resume this saved operation after correcting its failure.',
        409, { operationId: key, operation });
    }
    timedOut(clock, { operationId: key, operation });
    await delay(clock.intervalMs, undefined, signal ? { signal } : {});
  }
}
export async function waitForRubyCustomer(client, {
  id, expectedSelectionSha256, signal, ...options
} = {}) {
  need(typeof id === 'string' && /^[a-f0-9]{64}$/.test(expectedSelectionSha256),
    'RUBY_RECEIVING_CUSTOMER', 'Select the original saved customer and its complete selection digest.');
  const clock = timing(options);
  while (true) {
    aborted(signal);
    let customer = await client.customer({ id }, callOptions(signal));
    need(customer.id === id && customer.selectionSha256 === expectedSelectionSha256,
      'RUBY_RECEIVING_CUSTOMER_CHANGED', 'Continue the original retained customer selection.', 409);
    if (customer.phase === 'READY' && customer.result) return customer;
    if (['CUSTOMER_NEEDS_RESUME','REGISTRATION_NEEDS_RESUME'].includes(customer.phase))
      throw connectedError('RUBY_RECEIVING_CUSTOMER_FAILED',
        'Read the original customer phase and native log, then resume that same selected operation.', 409, { customer });
    const queued = [customer.customerOperation, customer.registrationOperation]
      .some(operation => operation?.phase === 'QUEUED' && !operation.active);
    if (['SELECTED','CUSTOMER_COMPLETE','FINALIZING'].includes(customer.phase) || queued) {
      customer = await client.advanceCustomer({ id, expectedSelectionSha256 }, callOptions(signal));
      if (customer.phase === 'READY' && customer.result) return customer;
    }
    timedOut(clock, { customer });
    await delay(clock.intervalMs, undefined, signal ? { signal } : {});
  }
}
