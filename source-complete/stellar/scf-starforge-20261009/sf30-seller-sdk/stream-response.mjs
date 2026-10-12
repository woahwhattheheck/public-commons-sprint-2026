// MIT. Stream delivery around the original native payment decision.
import { mkdtemp, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { finished } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { createResponseStreamParser } from '../sf31-buyer-client/response-stream.mjs';

export const DEFAULT_MAX_STREAM_BYTES = 64 * 1024 * 1024;
const MAX_BYTES = 1024 * 1024 * 1024;
const fault = code => Object.assign(new Error(code), { code });
const integer = (value, name, maximum) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(name + ' must be an integer from 1 to ' + maximum);
  return value;
};

export function validateMaxStreamBytes(value = DEFAULT_MAX_STREAM_BYTES) {
  return integer(value, 'maxStreamBytes', MAX_BYTES);
}

export function streamPaymentFlow(payment) {
  const supplied = payment?.paymentRequirements?.extra?.paymentFlow;
  const flow = supplied === undefined ? 'authorization' : supplied;
  if (!['authorization', 'upfront'].includes(flow)) throw fault('STREAM_PAYMENT_FLOW_UNSUPPORTED');
  if (flow === 'upfront' && (payment?.beforeHandlerSettlement?.phase !== 'before-handler' ||
      payment.beforeHandlerSettlement.flow !== 'upfront' ||
      payment.beforeHandlerSettlement.result?.success !== true))
    throw fault('STREAM_UPFRONT_RECEIPT_REQUIRED');
  return flow;
}

function contentType(format, headers) {
  const value = String(headers['content-type'] ?? '');
  const type = value.split(';')[0].trim().toLowerCase();
  if (!(format === 'sse' && type === 'text/event-stream' ||
        format === 'ndjson' && ['application/x-ndjson', 'application/ndjson'].includes(type)))
    throw fault('STREAM_CONTENT_TYPE_MISMATCH');
  const charsets = value.toLowerCase().split(';').slice(1).map(part => part.trim())
    .filter(part => /^charset\s*=/.test(part));
  if (charsets.length > 1 || charsets.some(part =>
    !/^charset\s*=\s*(?:utf-8|utf8|"utf-8"|"utf8")$/.test(part))) throw fault('STREAM_UTF8_REQUIRED');
  if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity')
    throw fault('STREAM_BODY_MUST_BE_DECODED');
}

function writableDrain(response, signal) {
  if (response.destroyed || response.writableEnded) return Promise.reject(fault('STREAM_CLIENT_DISCONNECTED'));
  return new Promise((resolve, reject) => {
    let listener;
    const cleanup = () => {
      response.off('drain', done); response.off('error', failed); response.off('close', closed);
      listener?.[Symbol.dispose]();
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(fault('STREAM_WRITE_FAILED')); };
    const closed = () => { cleanup(); reject(fault('STREAM_CLIENT_DISCONNECTED')); };
    response.once('drain', done); response.once('error', failed); response.once('close', closed);
    listener = addAbortListener(signal, () => { cleanup(); reject(signal.reason); });
    if (signal.aborted) { cleanup(); reject(signal.reason); }
  });
}

/** A resource handler may return this object; all payment work stays in SF30. */
export function streamingResponse({ format, body, headers = {}, status = 200, ...policy } = {}) {
  return { status, headers: {
    'content-type': format === 'sse' ? 'text/event-stream; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
    ...headers,
  }, stream: { format, body, ...policy } };
}

/**
 * authorization: generate and validate a private complete spool, then settle.
 * upfront: native settlement already succeeded; prime and deliver live.
 * The source is opened by the original verified handler and is closed once.
 */
export async function prepareResponseStream(stream, { headers, signal, payment,
  maxBytes = DEFAULT_MAX_STREAM_BYTES, spoolDirectory = tmpdir(),
  track = operation => Promise.resolve().then(operation) } = {}) {
  let iterator, state, closePromise, sourceClosePromise, folder, file, sourcePending;
  let parentListener, timer, idleTimer, stopped = false;
  const controller = new AbortController();
  const reason = value => value instanceof Error ? value : fault('STREAM_CANCELLED');
  const sourceClose = cause => sourceClosePromise ??= track(() => stream?.close?.(cause));
  const close = cause => closePromise ??= track(async () => {
    stopped = true;
    clearTimeout(timer); clearTimeout(idleTimer);
    parentListener?.[Symbol.dispose]();
    if (!controller.signal.aborted) controller.abort(reason(cause));
    let closeError;
    try { await sourceClose(cause); } catch (error) { closeError = error; }
    // Closing the actual upstream precedes iterator.return so a pending read can finish.
    try { await iterator?.return?.(); } catch (error) { closeError ??= error; }
    try { await sourcePending; } catch { /* Its error is already observed by next(). */ }
    try { await file?.close(); } catch (error) { closeError ??= error; }
    file = undefined;
    if (folder) await rm(folder, { recursive: true, force: true });
    if (closeError) throw closeError;
  });
  const interrupt = cause => {
    if (controller.signal.aborted || stopped) return;
    controller.abort(reason(cause));
    // Release a real socket/read even when the original iterator ignores signals.
    sourceClose(controller.signal.reason).catch(() => {});
  };
  try {
    if (!stream || typeof stream !== 'object' || Array.isArray(stream) ||
        !['sse', 'ndjson'].includes(stream.format) ||
        typeof stream.body?.[Symbol.asyncIterator] !== 'function' ||
        stream.close !== undefined && typeof stream.close !== 'function')
      throw fault('INVALID_RESPONSE_STREAM');
    if (!(signal instanceof AbortSignal)) throw new TypeError('Request signal required');
    contentType(stream.format, headers);
    const flow = streamPaymentFlow(payment);
    const limit = Math.min(validateMaxStreamBytes(maxBytes),
      integer(stream.maxBytes ?? maxBytes, 'stream.maxBytes', MAX_BYTES));
    const maxDurationMs = integer(stream.maxDurationMs ?? 120000, 'stream.maxDurationMs', 3600000);
    const idleTimeoutMs = integer(stream.idleTimeoutMs ?? 30000, 'stream.idleTimeoutMs', 300000);
    const chunkLimit = integer(stream.maxChunkBytes ?? 1024 * 1024, 'stream.maxChunkBytes', 16 * 1024 * 1024);
    const parser = createResponseStreamParser({ format: stream.format,
      maxRecordBytes: integer(stream.maxRecordBytes ?? 1024 * 1024, 'stream.maxRecordBytes', 16 * 1024 * 1024),
      maxRecords: integer(stream.maxRecords ?? 100000, 'stream.maxRecords', 1000000) });
    const digest = createHash('sha256'), started = performance.now();
    let bytes = 0, deliveredBytes = 0, sourceDone = false, sent = false, hash = null;
    const first = [];
    iterator = stream.body[Symbol.asyncIterator]();
    if (!iterator || typeof iterator.next !== 'function') throw fault('INVALID_RESPONSE_STREAM');
    parentListener = addAbortListener(signal, () => interrupt(signal.reason));
    if (signal.aborted) interrupt(signal.reason);
    timer = setTimeout(() => interrupt(fault('STREAM_DURATION_EXCEEDED')), maxDurationMs);
    const assertOpen = () => {
      if (performance.now() - started >= maxDurationMs) interrupt(fault('STREAM_DURATION_EXCEEDED'));
      controller.signal.throwIfAborted();
    };
    const next = async () => {
      assertOpen();
      let abortListener;
      const interrupted = new Promise((_resolve, reject) => {
        abortListener = addAbortListener(controller.signal, () => reject(controller.signal.reason));
      });
      idleTimer = setTimeout(() => interrupt(fault('STREAM_IDLE_TIMEOUT')), idleTimeoutMs);
      try {
        sourcePending = track(() => { assertOpen(); return iterator.next(); });
        const result = await Promise.race([sourcePending, interrupted]);
        assertOpen();
        if (!result || typeof result !== 'object' || typeof result.done !== 'boolean')
          throw fault('INVALID_RESPONSE_STREAM_ITERATOR');
        if (result.done) {
          const finalRecords = parser.finish();
          const summary = parser.summary();
          if (summary.pendingRecord) throw fault('STREAM_INCOMPLETE_RECORD');
          sourceDone = true; hash = digest.digest('hex');
          return { done: true, records: finalRecords.length };
        }
        if (!(result.value instanceof Uint8Array)) throw fault('STREAM_BYTE_CHUNK_REQUIRED');
        if (result.value.byteLength > chunkLimit) throw fault('STREAM_CHUNK_LIMIT_EXCEEDED');
        const chunk = Buffer.from(result.value);
        if (bytes + chunk.length > limit) throw fault('STREAM_BYTE_LIMIT_EXCEEDED');
        const records = parser.push(chunk);
        bytes += chunk.length; digest.update(chunk);
        return { done: false, chunk, records: records.length };
      } finally {
        clearTimeout(idleTimer); abortListener?.[Symbol.dispose]();
      }
    };
    if (flow === 'authorization') {
      folder = await mkdtemp(join(spoolDirectory, 'stellar-forge-stream-'));
      file = await open(join(folder, 'response.bin'), 'wx', 0o600);
      while (!sourceDone) {
        const part = await next();
        if (!part.done && part.chunk.length) await file.writeFile(part.chunk);
      }
      await file.sync(); await file.close(); file = undefined;
    } else {
      // Native upfront payment already completed. Prime one bounded nonempty
      // chunk; heartbeat-only SSE never accumulates until a first data event.
      while (!sourceDone && !first.length) {
        const part = await next();
        if (!part.done && part.chunk.length) first.push(part.chunk);
      }
    }
    state = {
      flow, format: stream.format, signal: controller.signal,
      snapshot: () => ({ format: stream.format, flow, generatedBytes: bytes, deliveredBytes,
        sha256: hash, complete: sourceDone, ...parser.summary() }),
      async send(req, res, response) {
        if (sent) throw fault('STREAM_ALREADY_SENT');
        sent = true; assertOpen();
        if (req.method === 'HEAD' || response.status !== 200) throw fault('STREAM_REQUIRES_200_BODY');
        res.writeHead(200, { ...response.headers, 'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' });
        res.flushHeaders();
        const write = async chunk => {
          assertOpen();
          if (res.destroyed || res.writableEnded) throw fault('STREAM_CLIENT_DISCONNECTED');
          if (!res.write(chunk)) await writableDrain(res, controller.signal);
          deliveredBytes += chunk.length;
        };
        if (flow === 'authorization') {
          const reader = createReadStream(join(folder, 'response.bin'), { highWaterMark: 65536,
            signal: controller.signal });
          try { for await (const chunk of reader) await write(chunk); }
          finally { reader.destroy(); }
        } else {
          for (const chunk of first) await write(chunk);
          first.length = 0;
          while (!sourceDone) {
            const part = await next();
            if (!part.done && part.chunk.length) await write(part.chunk);
          }
        }
        assertOpen();
        const completion = finished(res, { cleanup: true });
        res.end();
        await completion;
        return state.snapshot();
      },
      close,
    };
    return state;
  } catch (error) {
    // The caller's original lifetime tracks real cleanup and source work, while
    // the HTTP failure may be returned promptly even for an uncooperative source.
    close(error).catch(() => {});
    throw error;
  }
}

