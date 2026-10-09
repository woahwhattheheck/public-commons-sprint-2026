/**
 * In-process admission and de-duplication for the public competition demo.
 * This is deliberately conservative: each distinct LIVE audit can invoke Qloo
 * three times, and a public deployment must not turn one browser into an
 * unbounded upstream request amplifier. No queries or results are persisted.
 */
export class TrafficError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrafficError';
    this.status = 429;
  }
}

export function createAuditTraffic({
  maxConcurrent = 3,
  maxLivePerHour = 12,
  cacheTtlMs = 300_000,
  cacheSize = 48,
  now = () => Date.now(),
} = {}) {
  const active = new Map();
  const cache = new Map();
  let starts = [];
  const hourMs = 3_600_000;

  const refreshWindow = () => {
    const cutoff = now() - hourMs;
    starts = starts.filter(ts => ts > cutoff);
  };
  const pruneCache = () => {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now()) cache.delete(key);
    }
  };
  const stats = () => {
    refreshWindow();
    return {
      activeDistinctAudits: active.size,
      maxConcurrent,
      maxLiveAuditsPerHour: maxLivePerHour,
      liveAuditsRemaining: Math.max(0, maxLivePerHour - starts.length),
      cacheTtlSeconds: Math.floor(cacheTtlMs / 1000),
    };
  };

  async function run({ mode, seed, seedType, target, execute }) {
    if (!['live', 'demo'].includes(mode) || typeof execute !== 'function')
      throw new Error('Invalid audit request');
    // All four fields are local inputs; no API credential is part of the key.
    const key = JSON.stringify([mode, seed.trim().toLocaleLowerCase('en'), seedType, target]);
    pruneCache();
    const cached = cache.get(key);
    if (cached) return { result: cached.result, delivery: 'cache' };
    const running = active.get(key);
    if (running) return { result: await running, delivery: 'coalesced' };
    if (active.size >= maxConcurrent)
      throw new TrafficError(`At most ${maxConcurrent} independent audits may run concurrently`);
    if (mode === 'live') {
      refreshWindow();
      if (starts.length >= maxLivePerHour)
        throw new TrafficError('Public live Qloo hourly request budget reached; retry after the window clears');
      starts.push(now());
    }

    // Set the promise before any await so simultaneous matching requests share it.
    const task = Promise.resolve().then(execute);
    active.set(key, task);
    try {
      const result = await task;
      const complete = result?.status === 'complete' &&
        result?.segments?.low?.status === 'ok' && result?.segments?.high?.status === 'ok';
      if (complete && cacheTtlMs > 0) {
        cache.set(key, { result, expiresAt: now() + cacheTtlMs });
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      }
      return { result, delivery: 'fresh' };
    } finally {
      active.delete(key);
    }
  }
  return { run, stats };
}
