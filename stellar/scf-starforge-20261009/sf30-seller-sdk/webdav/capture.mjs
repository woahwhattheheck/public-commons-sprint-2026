// MIT. Durable original-byte capture, conditional range continuation, local reopen.
import { constants } from 'node:fs';
import { open, lstat, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateDirectory, readJson, readPrivate, hashPrivate, createFile, atomicJson, syncDirectory } from '../postgres/publisher/files.mjs';
import { fail, WebDavError, ID, validateSelection, identity, jsonBytes, sha256, strongEtag, opaqueEtag, now } from './config.mjs';
import { safeHeaders, httpFailure } from './http.mjs';

const EMPTY = sha256(Buffer.alloc(0));
const CHECKPOINT = 1048576;
const missing = async path => { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const maybeJson = async (path, max = 1048576) => { try { return await readJson(path, max); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
function capturePath(root, id) {
  if (!ID.test(id ?? '')) fail('WEBDAV_CAPTURE_ID', 'Select a retained capture UUID.');
  return join(root, id);
}
async function immutable(path, value) {
  const content = jsonBytes(value);
  try { await createFile(path, content); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readPrivate(path, Math.max(content.length, 1048576))).equals(content))
      fail('WEBDAV_CAPTURE_RECEIPT_CHANGED', 'The original capture receipt has changed.', 409);
  }
}
async function partHandle(path) {
  let handle;
  try { handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077)
      fail('WEBDAV_PARTIAL_FILE', 'The retained partial must remain a private regular file.', 409);
    return { handle, size: stat.size };
  } catch (error) { await handle.close(); throw error; }
}
async function prefixHash(handle, count) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  let offset = 0;
  while (offset < count) {
    const read = await handle.read(buffer, 0, Math.min(buffer.length, count - offset), offset);
    if (!read.bytesRead) fail('WEBDAV_PARTIAL_CHANGED', 'The retained partial is shorter than its durable checkpoint.', 409);
    hash.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead;
  }
  return hash;
}
function totalFrom(headers, offset, status, limit) {
  let contentLength = null;
  if (headers['content-length'] !== undefined) {
    const raw = headers['content-length'];
    if (!/^\d+$/.test(raw) || BigInt(raw) > BigInt(limit)) fail('WEBDAV_RESPONSE_LENGTH', 'The response length is invalid or exceeds the configured limit.', 413);
    contentLength = Number(raw);
  }
  if (status === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
    if (!match) fail('WEBDAV_CONTENT_RANGE', 'The resumed response lacks an exact Content-Range.', 502);
    const [start, end, total] = match.slice(1).map(BigInt);
    if (start !== BigInt(offset) || end < start || end >= total || total > BigInt(limit) ||
        contentLength !== null && BigInt(contentLength) !== end - start + 1n)
      fail('WEBDAV_CONTENT_RANGE', 'The resumed range does not match the original retained partial.', 409);
    return { total: Number(total), responseBytes: Number(end - start + 1n), end: Number(end) };
  }
  return { total: contentLength, responseBytes: contentLength, end: contentLength === null ? null : contentLength - 1 };
}
async function completeFromRecord(directory, intent, completed) {
  if (completed.schema !== 'stellar-forge.webdav-transfer.v1' || completed.intentSha256 !== identity(intent) ||
      completed.id !== intent.id || !Number.isSafeInteger(completed.bytes) || completed.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(completed.sha256))
    fail('WEBDAV_CAPTURE_RECEIPT_CHANGED', 'The retained transfer does not match its original capture intent.', 409);
  const final = join(directory, 'body.bin'), partial = join(directory, 'body.part');
  const selected = await missing(final) ? partial : final;
  const checked = await hashPrivate(selected, intent.source.limits.maxFileBytes);
  if (checked.bytes !== completed.bytes || checked.hash !== completed.sha256 ||
      intent.selection.expectedSha256 && checked.hash !== intent.selection.expectedSha256)
    fail('WEBDAV_COMPLETED_BYTES_CHANGED', 'The retained original file no longer matches its completed transfer.', 409);
  if (selected === partial) { await rename(partial, final); await syncDirectory(directory); }
  const receipt = { ...completed, schema: 'stellar-forge.webdav-capture.v1', sourceHash: intent.sourceHash,
    selection: intent.selection, source: intent.source, file: 'body.bin' };
  await immutable(join(directory, 'receipt.json'), receipt);
  const prior = await maybeJson(join(directory, 'progress.json'));
  if (prior?.state !== 'COMPLETE') await atomicJson(directory, 'progress.json', {
    ...(prior ?? {}), schema: 'stellar-forge.webdav-capture-progress.v1', id: intent.id,
    state: 'COMPLETE', completedAt: receipt.completedAt, bytes: receipt.bytes,
    checkpoint: { bytes: receipt.bytes, sha256: receipt.sha256 }, lastError: null,
  });
  return { ...receipt, path: final };
}
export async function readCapture(root, id, { verify = false } = {}) {
  const directory = capturePath(root, id);
  await privateDirectory(directory);
  const intent = await readJson(join(directory, 'intent.json')), progress = await maybeJson(join(directory, 'progress.json'));
  if (intent.id !== id || intent.schema !== 'stellar-forge.webdav-capture-intent.v1' || intent.sourceHash !== identity(intent.source))
    fail('WEBDAV_CAPTURE_INTENT_CHANGED', 'The retained capture intent has changed.', 409);
  const completed = await maybeJson(join(directory, 'transfer.json'));
  if (completed && verify) return { intent, progress, receipt: await completeFromRecord(directory, intent, completed) };
  const receipt = await maybeJson(join(directory, 'receipt.json'));
  return { intent, progress, receipt: receipt ? { ...receipt, path: join(directory, 'body.bin') } : null };
}
export async function listCaptures(root) {
  await privateDirectory(root, true);
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    let record;
    try { record = await readCapture(root, entry.name); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    rows.push({ id: record.intent.id, createdAt: record.intent.createdAt, sourceHash: record.intent.sourceHash,
      selection: record.intent.selection, state: record.progress?.state ?? 'PREPARED',
      bytes: record.receipt?.bytes ?? record.progress?.checkpoint?.bytes ?? 0,
      sha256: record.receipt?.sha256 ?? null, validator: record.progress?.validator ?? null,
      lastError: record.progress?.lastError ?? null, completedAt: record.receipt?.completedAt ?? null,
      attempts: record.progress?.attempts?.length ?? 0 });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function captureFile(transport, root, selected, { signal, onProgress } = {}) {
  const config = transport.config, selection = validateSelection(config, selected), directory = capturePath(root, selection.id);
  await privateDirectory(root, true); await privateDirectory(directory, true);
  const original = await maybeJson(join(directory, 'intent.json'));
  const intent = original ?? { schema: 'stellar-forge.webdav-capture-intent.v1', id: selection.id, createdAt: now(),
    source: config, sourceHash: identity(config), selection };
  if (intent.sourceHash !== identity(config) || identity(intent.selection) !== identity(selection))
    fail('WEBDAV_CAPTURE_ID_REUSED', 'This capture UUID already belongs to a different original file selection.', 409);
  await immutable(join(directory, 'intent.json'), intent);
  const completed = await maybeJson(join(directory, 'transfer.json'));
  if (completed) return completeFromRecord(directory, intent, completed);
  let progress = await maybeJson(join(directory, 'progress.json')) ?? {
    schema: 'stellar-forge.webdav-capture-progress.v1', id: intent.id, state: 'PREPARED',
    attempts: [], checkpoint: { bytes: 0, sha256: EMPTY }, totalBytes: selection.contentLength,
    validator: strongEtag(selection.etag) ? selection.etag : null,
  };
  if (!Array.isArray(progress.attempts) || !progress.checkpoint || !Number.isSafeInteger(progress.checkpoint.bytes) ||
      progress.checkpoint.bytes < 0 || progress.checkpoint.bytes > config.limits.maxFileBytes ||
      !/^[a-f0-9]{64}$/.test(progress.checkpoint.sha256))
    fail('WEBDAV_CHECKPOINT_CHANGED', 'The original durable checkpoint is invalid.', 409);
  const opened = await partHandle(join(directory, 'body.part')), handle = opened.handle;
  let count = progress.checkpoint.bytes, hash, response, attempt = null, prefixVerified = false;
  const checkpoint = async () => {
    await handle.sync();
    progress.checkpoint = { bytes: count, sha256: hash.copy().digest('hex') }; progress.bytes = count;
    await atomicJson(directory, 'progress.json', progress);
    if (onProgress) await onProgress({ id: intent.id, state: progress.state, bytes: count, totalBytes: progress.totalBytes });
  };
  try {
    if (opened.size < count || opened.size > config.limits.maxFileBytes) fail('WEBDAV_PARTIAL_CHANGED', 'The retained partial does not match its checkpoint.', 409);
    hash = await prefixHash(handle, count);
    if (hash.copy().digest('hex') !== progress.checkpoint.sha256) fail('WEBDAV_PARTIAL_CHANGED', 'The retained partial bytes have changed.', 409);
    prefixVerified = true;
    if (opened.size > count) {
      // A process can end after write/fsync and before committing the checkpoint.
      // Preserve this unacknowledged tail before continuing from verified bytes.
      const tailBytes = opened.size - count;
      if (tailBytes > CHECKPOINT + 131072) fail('WEBDAV_PARTIAL_CHANGED', 'The uncheckpointed tail exceeds one original receive interval.', 409);
      const tail = Buffer.alloc(tailBytes);
      let read = 0;
      while (read < tail.length) {
        const part = await handle.read(tail, read, tail.length - read, count + read);
        if (!part.bytesRead) fail('WEBDAV_PARTIAL_CHANGED', 'The uncheckpointed tail changed during recovery.', 409);
        read += part.bytesRead;
      }
      const filename = 'uncheckpointed-' + randomUUID() + '.bin';
      await createFile(join(directory, filename), tail); await syncDirectory(directory);
      progress.recoveredTails = [...(progress.recoveredTails ?? []), { file: filename, bytes: tail.length, sha256: sha256(tail), at: now() }];
      await handle.truncate(count); await checkpoint();
    }
    const validator = progress.validator ?? (strongEtag(selection.etag) ? selection.etag : null);
    if (count > 0 && !strongEtag(validator))
      fail('WEBDAV_RESTART_REQUIRED', 'This interrupted response has no strong content validator. Start a new capture; its original partial remains retained.', 409);
    if (signal?.aborted) fail('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409);
    const headers = {};
    if (validator) headers['if-match'] = validator;
    if (count > 0) headers.range = 'bytes=' + count + '-';
    attempt = { id: randomUUID(), startedAt: now(), offset: count, condition: validator,
      completedAt: null, bytesReceived: 0, state: 'REQUESTED' };
    progress.attempts.push(attempt); progress.state = 'READING'; progress.lastError = null;
    await checkpoint();
    const received = await transport.request('GET', selection.href, headers, null, { signal });
    response = received.response;
    const observed = safeHeaders(response.headers);
    attempt.http = { status: response.statusCode, href: received.href, redirects: received.redirects, headers: observed };
    if (![200, 206, 416].includes(response.statusCode)) throw httpFailure(response, 'GET');
    if (observed['content-encoding'] && observed['content-encoding'].toLowerCase() !== 'identity')
      fail('WEBDAV_ENCODING', 'The server ignored identity content encoding.', 502);
    const responseEtag = opaqueEtag(observed.etag);
    if (validator && responseEtag !== validator || selection.etag && responseEtag !== selection.etag)
      fail('WEBDAV_SOURCE_CHANGED', 'The response ETag differs from the originally selected file version.', 409);
    if (response.statusCode === 416 && count > 0) {
      const range = /^bytes \*\/(\d+)$/.exec(observed['content-range'] ?? '');
      if (!range || BigInt(range[1]) !== BigInt(count) || progress.totalBytes !== count)
        throw httpFailure(response, 'GET');
      response.destroy();
      attempt.state = 'COMPLETE_RANGE_ALREADY_RETAINED';
    } else {
      if (count > 0 && response.statusCode === 200)
        fail('WEBDAV_RANGE_UNSUPPORTED', 'The server returned a full response to a resume request. Start a new capture; the original partial is preserved.', 409);
      if (count === 0 ? response.statusCode !== 200 : response.statusCode !== 206) throw httpFailure(response, 'GET');
      const bounds = totalFrom(observed, count, response.statusCode, config.limits.maxFileBytes);
      if (bounds.total !== null && selection.contentLength !== null && bounds.total !== selection.contentLength ||
          bounds.total !== null && progress.totalBytes !== null && bounds.total !== progress.totalBytes)
        fail('WEBDAV_SOURCE_CHANGED', 'The response size differs from the originally selected file.', 409);
      progress.totalBytes = bounds.total ?? progress.totalBytes;
      progress.validator = strongEtag(responseEtag) ? responseEtag : null;
      await checkpoint();
      let lastSaved = count;
      for await (const chunk of response) {
        if (signal?.aborted) fail('WEBDAV_CANCELLED', 'The source operation was cancelled.', 409);
        if (count + chunk.length > config.limits.maxFileBytes || progress.totalBytes !== null && count + chunk.length > progress.totalBytes)
          fail('WEBDAV_RESPONSE_LIMIT', 'The original file exceeds its selected or configured length.', 413);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, count + written);
          if (!result.bytesWritten) fail('WEBDAV_WRITE_FAILED', 'The capture could not be written.');
          written += result.bytesWritten;
        }
        hash.update(chunk); count += chunk.length; attempt.bytesReceived += chunk.length;
        if (count - lastSaved >= CHECKPOINT) { await checkpoint(); lastSaved = count; }
      }
      if (!response.complete || bounds.responseBytes !== null && attempt.bytesReceived !== bounds.responseBytes)
        fail('WEBDAV_RESPONSE_INTERRUPTED', 'The original HTTP response did not complete.', 502);
      if (progress.totalBytes !== null && count !== progress.totalBytes)
        fail('WEBDAV_MORE_RANGES', 'The server ended this range before the complete file. Resume the same capture.', 409);
      progress.totalBytes = count;
      attempt.state = 'COMPLETE';
    }
    const digest = hash.copy().digest('hex');
    if (selection.expectedSha256 && digest !== selection.expectedSha256)
      fail('WEBDAV_EXPECTED_HASH', 'The completed file differs from its expected original SHA-256.', 409);
    attempt.completedAt = now(); await checkpoint();
    const transferred = { schema: 'stellar-forge.webdav-transfer.v1', id: intent.id, intentSha256: identity(intent),
      startedAt: intent.createdAt, completedAt: now(), bytes: count, sha256: digest,
      etag: progress.validator ?? responseEtag, contentCondition: progress.validator ? 'strong-etag' : selection.expectedSha256 ? 'expected-sha256' : 'complete-response',
      http: attempt.http, attempts: progress.attempts };
    await immutable(join(directory, 'transfer.json'), transferred); await syncDirectory(directory);
    await handle.close(); opened.closed = true;
    return completeFromRecord(directory, intent, transferred);
  } catch (error) {
    response?.destroy();
    const safe = error instanceof WebDavError ? error : new WebDavError('WEBDAV_CAPTURE_FAILED', 'The original capture could not complete.', 502, { nativeCode: error.code ?? null });
    if (attempt) { attempt.state = 'INTERRUPTED'; attempt.completedAt = now(); }
    progress.state = ['WEBDAV_SOURCE_CHANGED', 'WEBDAV_HTTP_412', 'WEBDAV_EXPECTED_HASH'].includes(safe.code) ? 'SOURCE_CHANGED' : 'INTERRUPTED';
    progress.lastError = { code: safe.code, message: safe.message, at: now() };
    if (hash && prefixVerified) {
      try { await checkpoint(); } catch { /* The last durable checkpoint remains authoritative. */ }
    }
    throw safe;
  } finally { response?.destroy(); if (!opened.closed) await handle.close(); }
}
