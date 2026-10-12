// MIT. One Node HTTP attempt's lifetime; no payment, retry or refund implementation.
import { addAbortListener } from 'node:events';
import { performance } from 'node:perf_hooks';
export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

export function validateRequestTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3600000)
    throw new TypeError('requestTimeoutMs must be an integer from 1 to 3600000');
  return value;
}

export class RequestRetired extends Error {
  constructor(code) {
    super(code);
    this.name = 'RequestRetired';
    this.code = code;
    this.status = code === 'REQUEST_DEADLINE_EXCEEDED' ? 504 : 499;
  }
}

/** A complete IncomingMessage closing is normal. Only an unfinished response or
 * incomplete request is a disconnect. Handlers share this signal after admission. */
export function createRequestLifetime(req, res, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  onRetire = () => {}, onIdle = () => {} } = {}) {
  validateRequestTimeout(timeoutMs);
  const controller = new AbortController();
  const deadlineEpochMillis = Date.now() + timeoutMs;
  const monotonicDeadline = performance.now() + timeoutMs;
  let closed = false, pending = 0, released = false, markSettled;
  const settled = new Promise(resolve => { markSettled = resolve; });
  const release = () => {
    if (released || !closed || pending !== 0) return;
    released = true;
    markSettled();
    try { onIdle(); } catch { /* Capacity observation cannot change delivery. */ }
  };
  // Keep an attempt's capacity until even uncancellable native I/O and cleanup
  // actually resolve. Sending a timeout does not create a free compute slot.
  const track = operation => {
    pending++;
    return Promise.resolve().then(operation).finally(() => { pending--; release(); });
  };
  const retire = code => {
    if (closed || controller.signal.aborted) return;
    const reason = new RequestRetired(code);
    controller.abort(reason);
    try { onRetire(reason); } catch { /* Observability must not change delivery. */ }
  };
  const requestClosed = () => { if (!req.complete) retire('CLIENT_DISCONNECTED'); };
  const responseClosed = () => { if (!res.writableFinished) retire('CLIENT_DISCONNECTED'); };
  req.once('close', requestClosed);
  res.once('close', responseClosed);
  const timer = setTimeout(() => retire('REQUEST_DEADLINE_EXCEEDED'), timeoutMs);
  timer.unref?.();

  const assertOpen = () => {
    if (res.destroyed || res.writableEnded || (req.destroyed && !req.complete))
      retire('CLIENT_DISCONNECTED');
    if (performance.now() >= monotonicDeadline) retire('REQUEST_DEADLINE_EXCEEDED');
    controller.signal.throwIfAborted();
    if (closed) throw new RequestRetired('REQUEST_COMPLETED');
  };

  /** Observe an existing operation without replaying or claiming to abort it.
   * A value that arrives after retirement is disposed through onLateValue exactly
   * once. Both late rejection and asynchronous disposal are always observed. */
  const run = (operation, { onLateValue } = {}) => {
    assertOpen();
    return new Promise((resolve, reject) => {
      let returned = false, listener;
      const detach = () => listener?.[Symbol.dispose]();
      const interrupted = () => {
        if (returned) return;
        returned = true;
        detach();
        reject(controller.signal.reason);
      };
      listener = addAbortListener(controller.signal, interrupted);
      if (controller.signal.aborted) interrupted();
      track(async () => {
        try {
          assertOpen();
          const value = await operation();
          if (returned || controller.signal.aborted) {
            if (!returned) interrupted();
            if (onLateValue) {
              try { await onLateValue(value); } catch { /* Cleanup is observed by its owner. */ }
            }
            return;
          }
          returned = true;
          detach();
          resolve(value);
        } catch (error) {
          if (returned) return;
          returned = true;
          detach();
          reject(error);
        }
      }).catch(() => {});
    });
  };

  return Object.freeze({ signal: controller.signal, deadlineEpochMillis, assertOpen, run, track,
    settled: () => settled,
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      req.removeListener('close', requestClosed);
      res.removeListener('close', responseClosed);
      release();
    },
  });
}
