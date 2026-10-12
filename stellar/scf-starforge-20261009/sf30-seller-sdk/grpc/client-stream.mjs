// MIT. One finite protobuf request stream on the original grpc-js call.
const failure = code => Object.assign(new Error(code), { code, status: 502 });
const clean = (issue, mapError) => typeof issue?.code === 'number' ? mapError(issue)
  : typeof issue?.code === 'string' && /^GRPC_[A-Z0-9_]+$/.test(issue.code)
    ? issue : failure('GRPC_REQUEST_STREAM_WRITE_FAILED');

/**
 * The source owns the native call/channel and its capacity slot. This writer
 * waits for actual Writable backpressure, finishes the input half, and retains
 * its listeners until the native terminal status is observed.
 */
export function writeGrpcRequestSeries({ nativeCall, messages, signal, mapError }) {
  if (!Array.isArray(messages)) throw failure('GRPC_REQUEST_SERIES_REQUIRED');
  let queued = 0, written = 0, backpressureWaits = 0, halfCloseRequested = false, halfClosed = false;
  let nativeStatus = null, problem = null, finishedAt = null, closePromise;
  let resolveTerminal;
  const terminal = new Promise(resolve => { resolveTerminal = resolve; });
  const waiters = new Set();
  const notify = () => { for (const waiter of [...waiters]) waiter(); };
  const snapshot = () => ({ schema: 'stellar-forge.grpc-request-stream.v1',
    messages: messages.length, queuedMessages: queued, writtenMessages: written, backpressureWaits,
    halfCloseRequested, halfClosed, complete: halfClosed && written === messages.length && !problem,
    terminalObserved: nativeStatus !== null,
    ...(nativeStatus ? { grpcCode: nativeStatus.code, grpcStatus: nativeStatus.name } : {}),
    ...(problem ? { error: problem.code } : {}), ...(finishedAt ? { finishedAt } : {}) });
  function stop(issue) {
    problem ??= clean(issue, mapError);
    notify();
    nativeCall.cancel();
  }
  const nativeError = issue => stop(issue);
  const status = value => {
    nativeStatus = { code: value.code, name: value.code === 0 ? 'OK'
      : (mapError({ code: value.code }).grpcCode ?? 'UNKNOWN') };
    if (value.code !== 0) problem ??= mapError({ code: value.code });
    else if (!halfCloseRequested) problem ??= failure('GRPC_REQUEST_STREAM_ENDED_EARLY');
    resolveTerminal(); notify();
  };
  const finish = () => { halfClosed = true; notify(); };
  const prematureClose = () => {
    if (!halfClosed) problem ??= failure('GRPC_REQUEST_STREAM_CLOSED_EARLY');
    notify();
  };
  const abort = () => stop(failure('GRPC_REQUEST_STREAM_CANCELLED'));
  nativeCall.on('error', nativeError);
  nativeCall.once('status', status);
  nativeCall.on('drain', notify);
  nativeCall.once('finish', finish);
  nativeCall.once('close', prematureClose);
  signal?.addEventListener('abort', abort, { once: true });
  function waitFor(predicate) {
    if (problem) return Promise.reject(problem);
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const changed = () => {
        if (!problem && !predicate()) return;
        waiters.delete(changed);
        if (problem) reject(problem); else resolve();
      };
      waiters.add(changed); changed();
    });
  }
  const finished = Promise.resolve().then(async () => {
    if (signal?.aborted) abort();
    try {
      for (const value of messages) {
        if (problem) throw problem;
        const available = nativeCall.write(value, issue => {
          if (issue) stop(issue); else { written++; notify(); }
        });
        queued++;
        if (!available) { backpressureWaits++; await waitFor(() => !nativeCall.writableNeedDrain); }
      }
      if (problem) throw problem;
      halfCloseRequested = true;
      nativeCall.end();
      await waitFor(() => halfClosed);
      if (written !== messages.length) throw failure('GRPC_REQUEST_STREAM_INCOMPLETE');
      finishedAt = new Date().toISOString();
      return snapshot();
    } catch (issue) {
      stop(issue); finishedAt = new Date().toISOString(); throw problem;
    }
  });
  // Receiving may start after the native response becomes available; retain the
  // failure for that original await without an unhandled rejection in between.
  finished.catch(() => {});
  function cancel() { stop(failure('GRPC_REQUEST_STREAM_CANCELLED')); }
  function close() {
    if (!closePromise) closePromise = (async () => {
      try { await finished; } catch {}
      await terminal;
      signal?.removeEventListener('abort', abort);
      nativeCall.off('error', nativeError);
      nativeCall.off('status', status);
      nativeCall.off('drain', notify);
      nativeCall.off('finish', finish);
      nativeCall.off('close', prematureClose);
      return snapshot();
    })();
    return closePromise;
  }
  return Object.freeze({ finished, snapshot, cancel, close });
}
