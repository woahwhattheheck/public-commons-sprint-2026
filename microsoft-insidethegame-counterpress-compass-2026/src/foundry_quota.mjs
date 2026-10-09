// A process-local circuit breaker for opt-in paid Foundry narrative drafts.
// Counts admitted attempts, including provider errors, so errors cannot burn an
// unbounded retry budget. This is intentionally not a distributed/global quota.
const HOUR_MS = 60 * 60 * 1000;
export function createFoundryAdmission({maxPerHour = 8, maxInFlight = 1, now = () => Date.now()} = {}) {
  if (!Number.isInteger(maxPerHour) || maxPerHour < 1 || maxPerHour > 24 ||
      !Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 4 ||
      typeof now !== 'function') throw new TypeError('Invalid Foundry admission limits');
  const admittedAt = [];
  let running = 0;
  return {
    reserve() {
      const at = now();
      if (!Number.isFinite(at)) throw new TypeError('Invalid admission clock');
      while (admittedAt.length && admittedAt[0] <= at - HOUR_MS) admittedAt.shift();
      if (running >= maxInFlight) return {ok: false, retryAfterSeconds: 1};
      if (admittedAt.length >= maxPerHour) return {ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((admittedAt[0] + HOUR_MS - at) / 1000))};
      admittedAt.push(at);
      ++running;
      let released = false;
      return {ok: true, release() { if (!released) { released = true; --running; } }};
    },
  };
}
