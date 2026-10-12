// MIT. Capacity and shutdown controls for the original SF30 HTTP seller.
// Observe HTTP AND original dispatch lifetime; do not infer payment settlement.

const LIMIT = 1024;
const MAX_GRACE_MS = 300000;

function positiveInteger(value, name, max, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

function unavailable(req, res, code) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify({ error: code });
  res.writeHead(503, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'retry-after': '1',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * Wrap only resource requests; health/docs/offers are outside the admission cap.
 * Retain a slot until BOTH the response terminates and original dispatch returns.
 * A disconnected client must not hide pending verification/cancellation/settlement.
 */
export function createSellerLifecycle(server, {
  maxInFlight = 64, drainGraceMs = 60000,
} = {}) {
  if (!server || typeof server.close !== 'function' ||
      typeof server.closeAllConnections !== 'function') {
    throw new TypeError('Node 22+ HTTP server required');
  }
  positiveInteger(maxInFlight, 'maxInFlight', LIMIT);
  positiveInteger(drainGraceMs, 'drainGraceMs', MAX_GRACE_MS, 1000);
  let state = 'ACCEPTING';
  let active = 0, admitted = 0, completed = 0, disconnected = 0;
  let overloaded = 0, drainingRejected = 0, forced = false;
  let closePromise, closeProgress;
  const idleWaiters = new Set();

  function handle(req, res, run) {
    if (typeof run !== 'function') throw new TypeError('Resource handler required');
    if (res.destroyed || res.writableEnded) return;
    if (state !== 'ACCEPTING') {
      drainingRejected++;
      return unavailable(req, res, 'SELLER_DRAINING');
    }
    if (active >= maxInFlight) {
      overloaded++;
      return unavailable(req, res, 'SELLER_AT_CAPACITY');
    }
    active++;
    admitted++;
    let httpDone = false, executionDone = false, released = false;
    function release() {
      if (released || !httpDone || !executionDone) return;
      released = true;
      active--;
      completed++;
      if (active === 0) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); }
      if (state === 'DRAINING' && active === 0) server.closeIdleConnections?.();
      closeProgress?.();
    }
    function finish() { terminal(false); }
    function closeResponse() { terminal(!res.writableFinished); }
    function terminal(wasDisconnected) {
      if (httpDone) return;
      httpDone = true;
      if (wasDisconnected) disconnected++;
      res.removeListener('finish', finish);
      res.removeListener('close', closeResponse);
      release();
    }
    res.once('finish', finish);
    res.once('close', closeResponse);
    // Preserve the original outer HTTP exception handling. Rejection ends
    // execution, while its eventual error response still owns HTTP completion.
    return Promise.resolve().then(run).finally(() => { executionDone = true; release(); });
  }

  function snapshot() {
    return {
      state, accepting: state === 'ACCEPTING', maxInFlight, drainGraceMs,
      inFlight: active, admitted, completed, disconnected,
      capacityRejected: overloaded, drainingRejected, forcedClose: forced,
      semantics: 'Resource attempts held until HTTP and dispatch finish, including challenge-only 402; not payment or revenue totals',
    };
  }

  function close() {
    if (closePromise) return closePromise;
    state = 'DRAINING';
    closePromise = new Promise((resolve, reject) => {
      let finished = false, serverClosed = false, serverError, timer;
      const complete = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        state = 'CLOSED';
        if (error) reject(error);
        else resolve(snapshot());
      };
      closeProgress = () => {
        if (serverError) complete(serverError);
        else if (serverClosed && active === 0) complete();
      };
      try {
        server.close(error => { serverClosed = true; serverError = error; closeProgress(); });
        server.closeIdleConnections?.();
        if (!finished) timer = setTimeout(() => {
          if (finished) return;
          forced = true;
          // Socket closure is not proof that native work stopped. Surface a
          // deadline failure even if all clients disconnected before draining.
          try { server.closeAllConnections(); }
          finally { complete(Object.assign(new Error('SELLER_DRAIN_DEADLINE_EXCEEDED'),
            { code: 'SELLER_DRAIN_DEADLINE_EXCEEDED' })); }
        }, drainGraceMs);
        // Retain the timer even when only an unresolved native promise remains.
      } catch (error) { complete(error); }
    });
    return closePromise;
  }

  // A forced socket drain can end close() before native dispatch finishes.
  // Resource owners may await actual quiescence without changing that deadline.
  const whenIdle = () => active === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.add(resolve));
  return Object.freeze({ handle, snapshot, close, whenIdle });
}
