// MIT. Exact private operator response files around the original native stream.
// No request, retry or payment is created while inspecting or downloading a file.
import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createResponseStreamParser } from '../../sf31-buyer-client/response-stream.mjs';
import { syncDirectory, fail } from './common.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PREVIEW_BYTES = 65536, PREVIEW_RECORDS = 20;
const stamp = () => new Date().toISOString();
const issueCode = issue => typeof issue?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(issue.code)
  ? issue.code : 'GRPC_STREAM_CAPTURE_FAILED';
function pathFor(directory, id) {
  if (!UUID.test(id)) fail('GRPC_STREAM_CAPTURE_ID_INVALID');
  return join(directory, id + '.ndjson');
}
function binding(id, fingerprint, limits) {
  if (!UUID.test(id) || !HASH.test(fingerprint) || !limits?.stream) fail('GRPC_STREAM_CAPTURE_BINDING_INVALID');
}
function previewCollector() {
  const values = []; let bytes = 0, omitted = 0;
  return {
    add(value, encodedBytes) {
      if (values.length < PREVIEW_RECORDS && bytes + encodedBytes <= PREVIEW_BYTES) {
        values.push(value); bytes += encodedBytes;
      } else omitted++;
    },
    result: () => ({ preview: values, previewOmittedRecords: omitted }),
  };
}

/** The durable attempt exists before this function. A create-only file precedes dispatch. */
export async function captureGrpcStream({ directory, id, fingerprint, limits, openStream }) {
  binding(id, fingerprint, limits);
  const file = await open(pathFor(directory, id), 'wx', 0o600);
  let source, issue, bytes = 0, records = 0, lastCompleteByte = 0, durable = false;
  const hash = createHash('sha256'), preview = previewCollector();
  try {
    await syncDirectory(directory);
    source = openStream();
    for await (const chunk of source.body) {
      if (!(chunk instanceof Uint8Array) || bytes + chunk.length > limits.stream.maxBytes)
        fail('GRPC_STREAM_CAPTURE_LIMIT', 413);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, null);
        if (!bytesWritten) fail('GRPC_STREAM_CAPTURE_WRITE_FAILED', 503);
        hash.update(chunk.subarray(offset, offset + bytesWritten));
        offset += bytesWritten; bytes += bytesWritten;
      }
      // grpcServerStream yields exactly one canonical UTF-8 JSON record plus LF.
      records++; lastCompleteByte = bytes;
      if (chunk.length <= PREVIEW_BYTES) {
        preview.add(JSON.parse(Buffer.from(chunk).toString('utf8')), chunk.length);
      } else preview.add(null, PREVIEW_BYTES + 1);
    }
  } catch (error) { issue = error; }
  finally {
    try { await source?.close(issue); } catch (error) { issue ??= error; }
    try { await file.sync(); durable = true; } catch (error) { issue ??= error; }
    try { await file.close(); } catch (error) { issue ??= error; }
  }
  // Throw only if no original stream was opened. The caller can retain NOT_STARTED.
  if (!source) throw issue ?? Object.assign(new Error('GRPC_STREAM_NOT_STARTED'), { code: 'GRPC_STREAM_NOT_STARTED' });
  const native = source.snapshot();
  return { schema: 'stellar-forge.grpc-stream-capture.v1', type: 'grpc-ndjson',
    id, fingerprint, filename: id + '.ndjson', format: 'ndjson',
    bytes, sha256: hash.digest('hex'), records, lastCompleteByte,
    pendingRecord: bytes !== lastCompleteByte, durable, complete: native.complete && !issue && durable,
    terminalObserved: native.terminalObserved, nativeRecords: native.records,
    ...(native.requestStream ? { requestStream: native.requestStream } : {}),
    ...(native.grpcCode === undefined ? {} : { grpcCode: native.grpcCode, grpcStatus: native.grpcStatus }),
    ...(issue ? { error: issueCode(issue) } : native.error ? { error: native.error } : {}),
    ...preview.result(), finishedAt: stamp() };
}

/**
 * Hash and frame the complete retained bytes using bounded reads. An interrupted
 * producer can leave valid records but never acquires a fabricated OK terminal.
 * With keepOpen the SAME verified descriptor is handed to the download caller.
 */
export async function inspectGrpcStream({ directory, id, fingerprint, limits, expected,
  signal, keepOpen = false }) {
  binding(id, fingerprint, limits);
  if (expected && (expected.type !== 'grpc-ndjson' || expected.id !== id ||
      expected.fingerprint !== fingerprint || expected.filename !== id + '.ndjson' ||
      !HASH.test(expected.sha256))) fail('GRPC_STREAM_CAPTURE_BINDING_CHANGED', 409);
  const handle = await open(pathFor(directory, id), constants.O_RDONLY | constants.O_NOFOLLOW);
  let retained = false, closed = false;
  const close = async () => { if (!closed) { closed = true; await handle.close(); } };
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limits.stream.maxBytes) fail('GRPC_STREAM_CAPTURE_FILE_INVALID', 409);
    const hash = createHash('sha256'), preview = previewCollector();
    const parser = createResponseStreamParser({ format: 'ndjson',
      maxRecordBytes: Math.min(limits.maxJsonResponseBytes + 1, 16777216),
      maxRecords: limits.stream.maxRecords });
    const buffer = Buffer.alloc(65536);
    let bytes = 0, parsingIssue;
    while (bytes < before.size) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - bytes), bytes);
      if (!bytesRead) fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
      const chunk = buffer.subarray(0, bytesRead);
      bytes += bytesRead; hash.update(chunk);
      if (!parsingIssue) {
        try {
          for (const record of parser.push(chunk)) {
            const encoded = JSON.stringify(record.value);
            preview.add(record.value, Buffer.byteLength(encoded) + 1);
          }
        } catch (issue) { parsingIssue = issue; }
      }
    }
    if (!parsingIssue) { try { parser.finish(); } catch (issue) { parsingIssue = issue; } }
    signal?.throwIfAborted();
    const after = await handle.stat(), digest = hash.digest('hex');
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        expected && (expected.bytes !== bytes || expected.sha256 !== digest))
      fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
    const summary = parser.summary();
    if (expected?.complete && (parsingIssue || !summary.complete || summary.records !== expected.records))
      fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
    const capture = expected ? structuredClone(expected) : {
      schema: 'stellar-forge.grpc-stream-capture.v1', type: 'grpc-ndjson',
      id, fingerprint, filename: id + '.ndjson', format: 'ndjson', bytes, sha256: digest,
      records: summary.records, lastCompleteByte: summary.lastCompleteByte,
      pendingRecord: summary.pendingRecord, complete: false, terminalObserved: false,
      durable: false, error: parsingIssue ? issueCode(parsingIssue) : 'GRPC_STREAM_INTERRUPTED',
      ...preview.result(),
      nextAction: 'Inspect the retained prefix and upstream outcome. This file cannot prove an OK native terminal, and reading it sends no new request.',
    };
    const assertUnchanged = async () => {
      const current = await handle.stat();
      if (before.dev !== current.dev || before.ino !== current.ino || before.size !== current.size ||
          before.mtimeMs !== current.mtimeMs || before.ctimeMs !== current.ctimeMs)
        fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
    };
    retained = keepOpen;
    return { capture, ...(keepOpen ? { handle, close, assertUnchanged } : {}) };
  } finally { if (!retained) await close(); }
}

/** Create-only native export, retaining descriptor identity through the whole copy. */
export async function exportGrpcStream(download, destination, { signal } = {}) {
  const target = resolve(destination), temporary = target + '.' + randomUUID() + '.tmp';
  let file, created = false;
  try {
    await download.assertUnchanged();
    file = await open(temporary, 'wx', 0o600); created = true;
    const buffer = Buffer.alloc(65536), hash = createHash('sha256');
    let position = 0;
    while (position < download.capture.bytes) {
      signal?.throwIfAborted();
      const { bytesRead } = await download.handle.read(buffer, 0,
        Math.min(buffer.length, download.capture.bytes - position), position);
      if (!bytesRead) fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
      const chunk = buffer.subarray(0, bytesRead);
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await file.write(chunk, offset, bytesRead - offset, null);
        if (!bytesWritten) fail('GRPC_STREAM_EXPORT_WRITE_FAILED', 503);
        offset += bytesWritten;
      }
      hash.update(chunk); position += bytesRead;
    }
    if (hash.digest('hex') !== download.capture.sha256) fail('GRPC_STREAM_CAPTURE_CHANGED', 409);
    await download.assertUnchanged(); signal?.throwIfAborted();
    await file.sync(); await file.close(); file = undefined;
    await link(temporary, target); await syncDirectory(dirname(target));
    return { path: target, id: download.capture.id, bytes: download.capture.bytes,
      sha256: download.capture.sha256, complete: download.capture.complete,
      records: download.capture.records };
  } finally {
    try { await file?.close(); }
    finally {
      if (created) await unlink(temporary).catch(issue => { if (issue.code !== 'ENOENT') throw issue; });
    }
  }
}
