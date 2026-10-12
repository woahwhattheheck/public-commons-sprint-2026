// MIT. Native grpc-js response records into the ORIGINAL SF30 byte-stream contract.
import { streamingResponse } from '../stream-response.mjs';

const failure = code => Object.assign(new Error(code), { code, status: 502 });
const clean = issue => typeof issue?.code === 'string' && /^GRPC_[A-Z0-9_]+$/.test(issue.code)
  ? issue : failure('GRPC_STREAM_RESPONSE_INVALID');

/**
 * The caller owns the original grpc-js channel and capacity slot. This adapter
 * holds that slot until the native status, pending read and actual close settle.
 * Raw metadata/status details never cross into the public response or snapshots.
 */
export function grpcServerStream({ nativeCall, normalize, limits, signal, mapError, onClose = () => {} }) {
  const policy = limits.stream;
  if (!policy) throw failure('GRPC_STREAM_LIMITS_REQUIRED');
  const iterator = nativeCall[Symbol.asyncIterator]();
  let nativeStatus = null, rawFailure = null, failureCause = null;
  let resolveTerminal;
  const terminal = new Promise(resolve => { resolveTerminal = resolve; });
  let consumed = false, complete = false, closing = false, closePromise, pending;
  let bytes = 0, records = 0, idleTimer, durationTimer, finishedAt = null;
  const maximumRecord = Math.min(limits.maxJsonResponseBytes + 1, 16777216);
  function snapshot() {
    return { format: 'ndjson', complete, records, bytes,
      terminalObserved: nativeStatus !== null,
      ...(nativeStatus ? { grpcCode: nativeStatus.code, grpcStatus: nativeStatus.name } : {}),
      ...(failureCause ? { error: failureCause.code } : {}),
      ...(finishedAt ? { finishedAt } : {}) };
  }
  const nativeError = issue => { rawFailure ??= issue; };
  const status = value => {
    nativeStatus = { code: value.code, name: value.code === 0 ? 'OK' :
      (mapError({ code: value.code }).grpcCode ?? 'UNKNOWN') };
    resolveTerminal();
  };
  nativeCall.on('error', nativeError);
  nativeCall.once('status', status);
  function close(reason) {
    if (closePromise) return closePromise;
    closing = true;
    if (!complete) failureCause ??= clean(reason ?? failure('GRPC_STREAM_CANCELLED'));
    clearTimeout(durationTimer); clearTimeout(idleTimer);
    signal?.removeEventListener('abort', abort);
    // cancel targets the native RPC, while destroy also releases an outstanding
    // Node readable read. The native terminal callback is still awaited below.
    if (!complete) nativeCall.cancel();
    nativeCall.destroy();
    closePromise = (async () => {
      try { await pending; } catch {}
      try { await iterator.return?.(); } catch {}
      await terminal;
      finishedAt ??= new Date().toISOString();
      nativeCall.off('error', nativeError);
      onClose(snapshot());
    })();
    return closePromise;
  }
  const abort = () => { void close(failure('GRPC_STREAM_CANCELLED')); };
  signal?.addEventListener('abort', abort, { once: true });
  durationTimer = setTimeout(() => { void close(failure('GRPC_STREAM_DURATION_EXCEEDED')); }, limits.timeoutMs);
  if (signal?.aborted) abort();
  async function nextRecord() {
    if (closing) throw failureCause ?? failure('GRPC_STREAM_CLOSED');
    idleTimer = setTimeout(() => { void close(failure('GRPC_STREAM_IDLE_TIMEOUT')); }, policy.idleTimeoutMs);
    try {
      const part = await iterator.next();
      if (closing) throw failureCause ?? failure('GRPC_STREAM_CLOSED');
      if (part.done) {
        await terminal;
        if (rawFailure || nativeStatus.code !== 0) throw mapError(rawFailure ?? { code: nativeStatus.code });
        complete = true; finishedAt = new Date().toISOString();
        return { done: true, value: undefined };
      }
      const normalized = normalize(part.value);
      const chunk = Buffer.from(JSON.stringify(normalized) + '\n', 'utf8');
      if (chunk.length > maximumRecord) throw failure('GRPC_STREAM_RECORD_TOO_LARGE');
      if (bytes + chunk.length > policy.maxBytes) throw failure('GRPC_STREAM_BYTE_LIMIT_EXCEEDED');
      if (records >= policy.maxRecords) throw failure('GRPC_STREAM_RECORD_LIMIT_EXCEEDED');
      records++; bytes += chunk.length;
      return { done: false, value: chunk };
    } catch (issue) {
      failureCause ??= typeof issue?.code === 'number' ? mapError(issue) : clean(issue);
      void close(failureCause);
      throw failureCause;
    } finally { clearTimeout(idleTimer); }
  }
  const body = {
    [Symbol.asyncIterator]() {
      if (consumed) throw failure('GRPC_STREAM_ALREADY_CONSUMED');
      consumed = true;
      return {
        next() {
          if (pending) return Promise.reject(failure('GRPC_STREAM_CONCURRENT_READ'));
          if (complete) return Promise.resolve({ done: true, value: undefined });
          pending = nextRecord();
          return pending.finally(() => { pending = undefined; });
        },
        async return() { await close(); return { done: true, value: undefined }; },
        [Symbol.asyncIterator]() { return this; },
      };
    },
  };
  const response = streamingResponse({ format: 'ndjson', body,
    maxBytes: policy.maxBytes, maxRecords: policy.maxRecords,
    maxRecordBytes: maximumRecord, maxChunkBytes: maximumRecord,
    maxDurationMs: limits.timeoutMs, idleTimeoutMs: policy.idleTimeoutMs, close });
  return Object.freeze({ response, body, snapshot, close });
}
