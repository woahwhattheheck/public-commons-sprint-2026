/**
 * Conservative, per-process admission for optional paid Foundry drafts.
 * Synthetic replay never uses this module. A reservation counts as an attempt
 * even if upstream fails, because the provider may charge an ambiguous request.
 * This is NOT a distributed quota or a monetary/currency spend guarantee.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function boundedInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be an integer in 0..10000`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 10000) {
    throw new Error(`${label} must be an integer in 0..10000`);
  }
  return parsed;
}

export function quotaConfig(env = process.env) {
  return Object.freeze({
    concurrent: boundedInteger(env.FOUNDRY_MAX_CONCURRENT, 1, 'FOUNDRY_MAX_CONCURRENT'),
    hourly: boundedInteger(env.FOUNDRY_MAX_PER_HOUR, 12, 'FOUNDRY_MAX_PER_HOUR'),
    daily: boundedInteger(env.FOUNDRY_MAX_PER_DAY, 30, 'FOUNDRY_MAX_PER_DAY'),
  });
}

export function createFoundryQuota(config = quotaConfig(), clock = Date.now) {
  const {concurrent, hourly, daily} = config;
  if (![concurrent, hourly, daily].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10000)) {
    throw new RangeError('Quota values must be integers in 0..10000');
  }
  if (typeof clock !== 'function') throw new TypeError('A time source is required');

  let active = 0;
  let lastTime = 0;
  const attempts = [];
  const reject = (reason, retryAfterSeconds) => ({
    allowed: false, reason, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  });

  return Object.freeze({
    reserve() {
      const rawNow = clock();
      if (!Number.isFinite(rawNow) || rawNow < 0) return reject('CLOCK_UNAVAILABLE', 60);
      // Avoid unexpected clock rollbacks resetting the admitted request budget.
      const now = Math.max(rawNow, lastTime);
      lastTime = now;
      while (attempts.length && attempts[0] <= now - DAY_MS) attempts.shift();
      if (!concurrent || !hourly || !daily) return reject('DISABLED', 60);
      if (active >= concurrent) return reject('IN_FLIGHT_LIMIT', 1);
      if (attempts.length >= daily) {
        return reject('DAILY_LIMIT', (attempts[0] + DAY_MS - now) / 1000);
      }
      const firstThisHour = attempts.find(t => t > now - HOUR_MS);
      const hourCount = attempts.filter(t => t > now - HOUR_MS).length;
      if (hourCount >= hourly) {
        return reject('HOURLY_LIMIT', (firstThisHour + HOUR_MS - now) / 1000);
      }
      attempts.push(now);
      active++;
      let released = false;
      return {
        allowed: true,
        release() {
          if (released) return;
          released = true;
          active--;
        },
      };
    },
    snapshot() {
      const now = Math.max(Number(clock()) || 0, lastTime);
      return Object.freeze({
        active,
        last24h: attempts.filter(t => t > now - DAY_MS).length,
        lastHour: attempts.filter(t => t > now - HOUR_MS).length,
        limits: {...config},
      });
    },
  });
}
