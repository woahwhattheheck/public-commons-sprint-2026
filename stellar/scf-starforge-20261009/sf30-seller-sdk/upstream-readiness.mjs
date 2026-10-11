// MIT. Availability around the ORIGINAL upstream handler; no payment or retry engine.
import { UPSTREAM_ATTEMPT } from './upstream-handler.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const FIELDS = new Set(['failureThreshold', 'resetAfterMs', 'maxResetAfterMs']);
const FAILURES = new Set(['UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_RESPONSE_INCOMPLETE',
  'UPSTREAM_REDIRECT_REFUSED', 'UPSTREAM_PAYMENT_REQUIRED', 'UPSTREAM_AUTH_FAILED',
  'UPSTREAM_STATUS_UNSUPPORTED', 'UPSTREAM_CONTENT_TYPE_UNEXPECTED', 'UPSTREAM_ENCODING_UNSUPPORTED',
  'UPSTREAM_RESPONSE_TOO_LARGE', 'UPSTREAM_JSON_INVALID', 'UPSTREAM_CONFIGURATION_UNAVAILABLE',
  'UPSTREAM_RESPONSE_CONTRACT_STATUS', 'UPSTREAM_RESPONSE_CONTRACT_BODY',
  'UPSTREAM_RESPONSE_CONTRACT_MEDIA_TYPE', 'UPSTREAM_RESPONSE_CONTRACT_SCHEMA']);
const integer = (value, fallback, min, max, name) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new TypeError(`Invalid availability ${name}`);
  return result;
};

/** Undefined preserves the existing unprotected handler. No implicit network probes. */
export function compileAvailabilityPolicy(value) {
  if (value === undefined) return null;
  if (!plain(value) || Object.keys(value).some(key => !FIELDS.has(key)))
    throw new TypeError('availability must contain only failureThreshold, resetAfterMs and maxResetAfterMs');
  const failureThreshold = integer(value.failureThreshold, 3, 1, 100, 'failureThreshold');
  const resetAfterMs = integer(value.resetAfterMs, 30000, 100, 3600000, 'resetAfterMs');
  const maxResetAfterMs = integer(value.maxResetAfterMs, Math.max(300000, resetAfterMs), resetAfterMs, 3600000, 'maxResetAfterMs');
  return Object.freeze({ failureThreshold, resetAfterMs, maxResetAfterMs });
}

function response(status, code, delayMs) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8',
    'retry-after': String(Math.max(1, Math.ceil(delayMs / 1000))) }, body: { error: code } };
}

function outcome(result) {
  const attempt = result?.[UPSTREAM_ATTEMPT];
  if (attempt?.dispatched === false) return 'neutral';
  const status = attempt?.status ?? result?.status, code = attempt?.error ?? result?.body?.error;
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'healthy';
  if (code === 'UPSTREAM_REQUEST_FAILED') {
    // A merchant's ordinary 4xx still proves a responsive backend. Its 429 and
    // 5xx are availability failures; do not hide or rewrite the original result.
    const upstreamStatus = attempt?.upstreamStatus ?? result.body?.upstreamStatus;
    return upstreamStatus === 429 || upstreamStatus >= 500 ? 'failed' : 'healthy';
  }
  if (FAILURES.has(code)) return 'failed';
  // Bad request values and local capacity rejection are not backend outages.
  return 'neutral';
}

/**
 * The admission is an availability check, NOT a paid-request reservation. The
 * original handler stage rechecks capacity and permits only one recovery call.
 * Original native cancellation handles a race after successful verification.
 */
export function protectUpstream(handler, policy, { maxInFlight, monotonic = () => performance.now() } = {}) {
  if (typeof handler !== 'function' || typeof handler.snapshot !== 'function' ||
      typeof monotonic !== 'function' || !Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new TypeError('Original upstream handler, capacity and monotonic clock required');
  policy = compileAvailabilityPolicy(policy);
  if (!policy) return handler;
  let generation = 0, failures = 0, openUntil = 0, cooldownMs = policy.resetAfterMs;
  let open = false, trial = null, latestTime = 0, lastStatus = null, lastError = null;
  const totals = { opens: 0, recoveryCalls: 0, recovered: 0, admissionRejected: 0, handlerRejected: 0 };
  function now() {
    const value = monotonic();
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Invalid monotonic clock');
    latestTime = Math.max(latestTime, value);
    return latestTime;
  }
  function condition() {
    const remaining = Math.max(0, Math.ceil(openUntil - now()));
    if (open && remaining) return { code: 'UPSTREAM_CIRCUIT_OPEN', delay: remaining };
    if (trial) return { code: 'UPSTREAM_RECOVERY_IN_PROGRESS', delay: 1000 };
    if (handler.snapshot().inFlight >= maxInFlight)
      return { code: 'UPSTREAM_CAPACITY_EXHAUSTED', delay: 1000 };
    return null;
  }
  function trip(isRecovery) {
    cooldownMs = isRecovery ? Math.min(policy.maxResetAfterMs, cooldownMs * 2) : policy.resetAfterMs;
    open = true; trial = null; openUntil = now() + cooldownMs; generation++; totals.opens++;
  }
  async function protectedHandler(context) {
    const blocked = condition();
    if (blocked) { totals.handlerRejected++; return response(503, blocked.code, blocked.delay); }
    const ticket = { generation, recovery: open };
    if (ticket.recovery) trial = ticket;
    let result;
    try { result = await handler(context); }
    catch { result = response(502, 'UPSTREAM_UNAVAILABLE', 1000); }
    const attempt = result?.[UPSTREAM_ATTEMPT];
    if (ticket.recovery && attempt?.dispatched !== false) totals.recoveryCalls++;
    const complete = observed => {
      const observedAttempt = observed?.[UPSTREAM_ATTEMPT];
      // Results from calls already active when the circuit opened cannot close
      // it or extend it. The one recovery call owns the next decision.
      if (ticket.generation === generation) {
        const state = outcome(observed);
        if (observedAttempt?.dispatched !== false) {
          const status = observedAttempt?.status ?? observed?.status, code = observedAttempt?.error ?? observed?.body?.error;
          lastStatus = Number.isInteger(status) ? status : null;
          lastError = FAILURES.has(code) || code === 'UPSTREAM_REQUEST_FAILED' ? code : null;
        }
        if (state === 'failed') {
          failures++;
          if (ticket.recovery || failures >= policy.failureThreshold) trip(ticket.recovery);
        } else if (state === 'healthy') {
          failures = 0;
          if (ticket.recovery) { open = false; openUntil = 0; cooldownMs = policy.resetAfterMs; generation++; totals.recovered++; }
        }
      }
      // A locally invalid recovery request releases the trial without declaring
      // the backend healthy or starting another network request automatically.
      if (trial === ticket) trial = null;
    };
    // A stream's response headers do not prove the backend finished. Keep its
    // capacity and recovery trial through the original source's terminal result.
    if (attempt?.completion) attempt.completion.then(final => {
      complete({status:final.status,body:final.error ? {error:final.error} : undefined,
        [UPSTREAM_ATTEMPT]:final});
    });
    else complete(result);
    return result;
  }
  protectedHandler.admit = context => {
    const blocked = condition();
    if (!blocked) return typeof handler.admit === 'function' ? handler.admit(context) : true;
    totals.admissionRejected++;
    // Existing SF30 admission explicitly permits nonpayment 4xx only.
    return response(429, blocked.code, blocked.delay);
  };
  protectedHandler.snapshot = () => {
    const remaining = open ? Math.max(0, Math.ceil(openUntil - now())) : 0;
    return Object.freeze({ ...handler.snapshot(), availability: Object.freeze({
      state: !open ? 'CLOSED' : remaining ? 'OPEN' : trial ? 'RECOVERY_IN_FLIGHT' : 'RECOVERY_READY',
      retryAfterMs: remaining, failureStreak: failures, lastStatus, lastError,
      maxInFlight, ...policy, ...totals,
    }) });
  };
  // Keep the original application's durable-operation control interface where
  // present. Availability never replaces its ticket admission or recovery.
  if (handler.idempotency !== undefined) protectedHandler.idempotency = handler.idempotency;
  return protectedHandler;
}
