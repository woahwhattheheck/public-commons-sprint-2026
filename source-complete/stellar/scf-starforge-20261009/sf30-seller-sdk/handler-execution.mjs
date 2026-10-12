// MIT. Application lifetime and native cancellation latch; optional enclosing request signal.
import { addAbortListener } from 'node:events';
import { performance } from 'node:perf_hooks';

export function validateHandlerTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw new TypeError('handlerTimeoutMs must be 1–300000');
  return timeoutMs;
}

/** One incoming request, one application attempt, one native terminal decision. */
export function createHandlerExecution(req, res, { timeoutMs = 30000, signal } = {}) {
  validateHandlerTimeout(timeoutMs);
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new TypeError('Parent request signal must be an AbortSignal');
  const controller = new AbortController();
  let phase = 'idle', interruption = null, timer, deadline = null, cancellation, operation;
  const stop = (reason, cause) => {
    if (controller.signal.aborted || phase === 'disposed') return;
    interruption = reason;
    controller.abort(cause ?? Object.assign(new Error(reason), {
      name: reason === 'handler_timeout' ? 'TimeoutError' : 'AbortError',
      code: reason === 'handler_timeout' ? 'APPLICATION_TIMEOUT' : 'CLIENT_DISCONNECTED',
    }));
  };
  const disconnected = () => stop('client_disconnected');
  let parentListener;
  if (signal) {
    const parentStopped = () => stop(signal.reason?.code === 'REQUEST_DEADLINE_EXCEEDED' ?
      'request_deadline' : 'client_disconnected', signal.reason);
    parentListener = addAbortListener(signal, parentStopped);
    if (signal.aborted) parentStopped();
  } else {
    req.once('aborted', disconnected);
    res.once('close', disconnected);
  }
  const check = () => {
    if (req.aborted || res.destroyed || res.writableEnded) disconnected();
    if (deadline !== null && performance.now() >= deadline &&
        phase !== 'settling' && phase !== 'cancelled') stop('handler_timeout');
    controller.signal.throwIfAborted();
  };
  return {
    signal: controller.signal,
    get interruption() { return interruption; },
    check,
    async run(handler, context) {
      if (phase !== 'idle') throw new Error('Application already started');
      check();
      phase = 'running';
      deadline = performance.now() + timeoutMs;
      timer = setTimeout(() => stop('handler_timeout'), timeoutMs);
      // Keep the timer referenced: it must also finish standalone embeddings.
      let listener;
      const interrupted = new Promise((_resolve, reject) => {
        listener = addAbortListener(controller.signal, () => reject(controller.signal.reason));
      });
      try {
        operation = Promise.resolve().then(() => {
          check();
          return handler({ ...context, signal: controller.signal });
        });
        // Promise.race consumes late rejection as well as late success. Neither
        // can resume this request or start another native payment operation.
        const result = await Promise.race([operation, interrupted]);
        check();
        return result;
      } finally {
        clearTimeout(timer);
        listener?.[Symbol.dispose]();
        if (phase === 'running') phase = 'finished';
      }
    },
    cancel(payment, details) {
      if (phase === 'settling' || phase === 'disposed')
        throw new Error('Cannot cancel a started settlement or disposed execution');
      if (!cancellation) {
        phase = 'cancelled';
        clearTimeout(timer);
        cancellation = Promise.resolve().then(() => payment.cancellationDispatcher.cancel(details));
      }
      return cancellation;
    },
    beginSettlement() {
      if (phase !== 'finished') throw new Error('Application must finish before settlement');
      check();
      // No await between this transition and the caller's native settlement.
      phase = 'settling';
      clearTimeout(timer);
    },
    // An abort signal cannot forcibly terminate a noncooperative handler. Keep
    // the original dispatch pending until its real work ends, even after a 504.
    settled() { return operation ? operation.then(() => {}, () => {}) : Promise.resolve(); },
    dispose() {
      clearTimeout(timer);
      parentListener?.[Symbol.dispose]();
      req.removeListener('aborted', disconnected);
      res.removeListener('close', disconnected);
      phase = 'disposed';
    },
  };
}
