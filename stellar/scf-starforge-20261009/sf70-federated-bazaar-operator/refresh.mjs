// MIT. SF70 native-provider GET capture coordination for one local operator process.
// No background polling, seller-resource requests, payment APIs, persistence or tracking.
const LIVE = 'LIVE_NATIVE_CAPTURE';
const JOIN = 'SHARED_LIVE_CAPTURE';
const REUSE = 'RECENT_COMPLETE_CAPTURE';

/**
 * Coalesce simultaneous reads of the *same* native network and reuse only an
 * explicitly complete observation for a few seconds. Every returned report
 * retains its original source observation times and never claims that a cached
 * response was fetched again. Partial failures are never cached as complete.
 */
export function createRefreshCoordinator(capture, { maxAgeMs = 8000, now = () => Date.now() } = {}) {
  if (typeof capture !== 'function' || typeof now !== 'function' ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 60000) {
    throw new TypeError('Invalid native refresh configuration');
  }
  const slots = new Map();
  const decorate = (value, kind, completedAt) => {
    const current = now();
    const age = Number.isFinite(current) && Number.isFinite(completedAt)
      ? Math.max(0, current - completedAt) : null;
    return {
      ...value,
      operatorDelivery: {
        mode: kind,
        servedAt: new Date(Number.isFinite(current) ? current : Date.now()).toISOString(),
        completedCaptureAgeMs: age,
        maxReuseMs: maxAgeMs,
      },
    };
  };
  return async function getNativeCapture(network, { force = false } = {}) {
    if (network !== 'stellar:testnet' && network !== 'stellar:pubnet') {
      throw new Error('UNSUPPORTED_STELLAR_NETWORK');
    }
    let slot = slots.get(network);
    if (!slot) {
      slot = { inFlight: null, completed: null, completedAt: null };
      slots.set(network, slot);
    }
    if (slot.inFlight) {
      const captured = await slot.inFlight;
      return decorate(captured, JOIN, slot.completedAt);
    }
    const current = now();
    const age = current - slot.completedAt;
    if (!force && slot.completed && Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
      return decorate(slot.completed, REUSE, slot.completedAt);
    }
    // A real source refresh, not a fabricated result; exactly one in-flight
    // native two-provider read per scope, even with simultaneous browser tabs.
    const task = Promise.resolve().then(() => capture(network));
    slot.inFlight = task;
    try {
      const value = await task;
      const complete = value && value.network === network &&
        value.state === 'BOTH_SOURCES_COMPLETE' &&
        Array.isArray(value.sources) && value.sources.length === 2 &&
        value.sources.every(source => source.status === 'COMPLETE_GET_CAPTURE');
      if (complete) {
        slot.completed = value;
        slot.completedAt = now();
      } else {
        slot.completed = null;
        slot.completedAt = null;
      }
      return decorate(value, LIVE, slot.completedAt);
    } catch (error) {
      slot.completed = null;
      slot.completedAt = null;
      throw error;
    } finally {
      if (slot.inFlight === task) slot.inFlight = null;
    }
  };
}
