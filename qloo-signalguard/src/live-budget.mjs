/**
 * Admission-only Qloo usage budget: every accepted audit can issue at most
 * three upstream calls (search + baseline + two independent probes = four).
 * This process-local budget supplements, not replaces, an edge limiter.
 * Untrusted X-Forwarded-For headers are deliberately ignored by the caller.
 */
const HOUR_MS = 60 * 60 * 1000;
const CLIENT_WINDOW_MS = 10 * 60 * 1000;

export function createLiveBudget({ maxPerHour = 24, maxPerClientWindow = 4, clock = Date.now } = {}) {
  if (!Number.isSafeInteger(maxPerHour) || maxPerHour < 1 ||
      !Number.isSafeInteger(maxPerClientWindow) || maxPerClientWindow < 1 ||
      typeof clock !== 'function') throw new TypeError('Invalid live audit budget');

  let hourStart = clock();
  let admitted = 0;
  const clients = new Map();
  const reject = (reason, ms) => ({ allowed: false, reason, retryAfter: Math.max(1, Math.ceil(ms / 1000)) });

  return {
    admit(remoteAddress) {
      const now = clock();
      if (!Number.isFinite(now) || now < hourStart) return reject('Clock unavailable; live Qloo admission paused', 60000);
      if (now - hourStart >= HOUR_MS) {
        hourStart = now;
        admitted = 0;
        clients.clear(); // All previous 10-minute windows expired along with the hour.
      }
      const client = typeof remoteAddress === 'string' && remoteAddress ? remoteAddress : 'unknown-client';
      const row = clients.get(client);
      const recent = row && now < row.until ? row : { count: 0, until: now + CLIENT_WINDOW_MS };
      if (admitted >= maxPerHour)
        return reject('Server live Qloo hourly audit budget reached', HOUR_MS - (now - hourStart));
      if (recent.count >= maxPerClientWindow)
        return reject('Client live Qloo audit budget reached', recent.until - now);
      admitted++;
      clients.set(client, { count: recent.count + 1, until: recent.until });
      return { allowed: true, remainingHourlyAudits: maxPerHour - admitted };
    },
  };
}
