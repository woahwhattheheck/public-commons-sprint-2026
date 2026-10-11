// MIT. Capacity and shutdown controls for the original SF30 HTTP seller.
// This observes Node response completion; it does not infer payment settlement.

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
 * A request occupies capacity from dispatch until finish/disconnect, including
 * native verification, handler execution and settlement. No payment is retried.
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
  let closePromise;

  function handle(req, res, run) {
    if (typeof run !== 'function') throw new TypeError('Resource handler required');
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
    let settled = false;
    function finish() { terminal(false); }
    function closeResponse() { terminal(!res.writableFinished); }
    function terminal(wasDisconnected) {
      if (settled) return;
      settled = true;
      active--;
      completed++;
      if (wasDisconnected) disconnected++;
      if (state === 'DRAINING' && active === 0) server.closeIdleConnections?.();
      res.removeListener('finish', finish);
      res.removeListener('close', closeResponse);
    }
    res.once('finish', finish);
    res.once('close', closeResponse);
    // The original outer HTTP error handler owns exceptions and response status.
    return run();
  }

  function snapshot() {
    return {
      state, accepting: state === 'ACCEPTING', maxInFlight, drainGraceMs,
      inFlight: active, admitted, completed, disconnected,
      capacityRejected: overloaded, drainingRejected, forcedClose: forced,
      semantics: 'In-flight HTTP resource attempts, including challenge-only 402; not payment or revenue totals',
    };
  }

  function close() {
    if (closePromise) return closePromise;
    state = 'DRAINING';
    closePromise = new Promise((resolve, reject) => {
      // Call close BEFORE the deadline. Node waits for active HTTP responses.
      let finished = false;
      let timer;
      const complete = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        state = 'CLOSED';
        if (error) reject(error);
        else if (forced) reject(new Error('SELLER_DRAIN_DEADLINE_EXCEEDED'));
        else resolve(snapshot());
      };
      try {
        server.close(complete);
        server.closeIdleConnections?.();
        timer = setTimeout(() => {
          if (finished) return;
          forced = true;
          // Explicit operator-defined deadline. Never retry uncertain payments.
          server.closeAllConnections();
        }, drainGraceMs);
        timer.unref?.();
      } catch (error) { complete(error); }
    });
    return closePromise;
  }

  return Object.freeze({ handle, snapshot, close });
}
