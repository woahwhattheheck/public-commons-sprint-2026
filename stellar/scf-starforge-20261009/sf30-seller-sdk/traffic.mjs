// MIT. Observe the existing SF30 Node server; never wrap its payment lifecycle.
import { performance } from 'node:perf_hooks';
import { selectServiceRoute } from './route-path.mjs';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
export const LATENCY_BUCKETS_MS = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
const ATTACHED = new WeakMap();
const SPECIAL = Object.freeze({
  '@metadata': 'Seller metadata', '@unmatched': 'Unmatched / unsupported method',
  '@invalid': 'Invalid or ambiguous request target',
});
const round = value => Math.round(value * 1000) / 1000;
const label = text => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const summary = () => ({ received: 0, active: 0, completed: 0, aborted: 0,
  statuses: Object.create(null), latencyCount: 0, latencySumMs: 0,
  latencyBins: Array(LATENCY_BUCKETS_MS.length + 1).fill(0) });
function observeLatency(stats, duration) {
  stats.latencyCount++; stats.latencySumMs += duration;
  let index = LATENCY_BUCKETS_MS.findIndex(bound => duration <= bound);
  if (index < 0) index = LATENCY_BUCKETS_MS.length;
  stats.latencyBins[index]++;
}
function percentile(stats, fraction) {
  if (!stats.latencyCount) return null;
  const rank = Math.ceil(stats.latencyCount * fraction);
  let count = 0;
  for (let i = 0; i < stats.latencyBins.length; i++) {
    count += stats.latencyBins[i];
    if (count >= rank) return LATENCY_BUCKETS_MS[i] ?? null;
  }
  return null;
}
function copyStats(stats) {
  return { received: stats.received, active: stats.active, completed: stats.completed,
    aborted: stats.aborted, statuses: { ...stats.statuses },
    latency: { count: stats.latencyCount, sumMs: round(stats.latencySumMs),
      meanMs: stats.latencyCount ? round(stats.latencySumMs / stats.latencyCount) : null,
      p50UpperBoundMs: percentile(stats, 0.50), p95UpperBoundMs: percentile(stats, 0.95),
      overflowAboveMs: LATENCY_BUCKETS_MS.at(-1),
      buckets: stats.latencyBins.map((count, i) => ({ upperBoundMs: LATENCY_BUCKETS_MS[i] ?? null, count })) } };
}

/**
 * Attach to a session returned by startSellerService(). Memory is bounded by
 * configured routes, fixed method/status labels and recentLimit (not URL count).
 * No raw request target, path parameter, IP, body or header is retained.
 */
export function attachSellerTraffic(session, { recentLimit = 160 } = {}) {
  const server = session?.server, routes = session?.compiled?.routes;
  if (!server || typeof server.prependListener !== 'function' || !Array.isArray(routes) ||
      !routes.length || routes.length > 100) throw new TypeError('A running SF30 seller session is required');
  if (ATTACHED.has(server)) throw new TypeError('This seller already has a traffic observer');
  if (!Number.isInteger(recentLimit) || recentLimit < 0 || recentLimit > 2000)
    throw new RangeError('recentLimit must be 0–2000');
  const known = new Map();
  for (const route of routes) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(route.id ?? '') || known.has(route.id) ||
        !METHODS.has(route.method) || typeof route.path !== 'string' || route.path.length > 2048 ||
        !route.binding) throw new TypeError('Use the original compiled SF30 routes');
    known.set(route.id, { id: route.id, method: route.method, path: route.path });
  }
  const startedAt = new Date().toISOString(), started = performance.now();
  const total = summary(), groups = new Map(), recent = Array(recentLimit), pending = new Set();
  const seconds = Array.from({ length: 60 }, () => ({ tick: -1, count: 0 }));
  let serial = 0, recentCount = 0, recentNext = 0, attached = true;
  function group(id, method) {
    const key = `${id}\0${method}`;
    if (!groups.has(key)) groups.set(key, { id, method, ...summary() });
    return groups.get(key);
  }
  for (const route of known.values()) group(route.id, route.method);
  function classify(req) {
    const method = METHODS.has(req.method) ? req.method : 'OTHER';
    try {
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') ||
          req.url.length > 8192 || req.url.includes('#')) return { id: '@invalid', method };
      const path = req.url.split('?', 1)[0];
      if (path.startsWith('/_seller/')) return { id: '@metadata', method };
      const selected = selectServiceRoute(routes, path, req.method);
      return { id: selected?.route && known.has(selected.route.id) ? selected.route.id : '@unmatched', method };
    } catch { return { id: '@invalid', method }; }
  }
  function onRequest(req, res) {
    const { id, method } = classify(req), row = group(id, method);
    const began = performance.now(), requestId = ++serial;
    const tick = Math.floor(began / 1000), slot = seconds[tick % 60];
    if (slot.tick !== tick) { slot.tick = tick; slot.count = 0; }
    slot.count++;
    for (const stats of [total, row]) { stats.received++; stats.active++; }
    let done = false;
    const cleanup = () => {
      res.removeListener('finish', finish); res.removeListener('close', closed); pending.delete(cleanup);
    };
    function complete(outcome) {
      if (done) return;
      done = true; cleanup();
      if (!attached && pending.size === 0) ATTACHED.delete(server);
      const durationMs = Math.max(0, performance.now() - began);
      const finished = outcome === 'completed';
      const status = finished || res.headersSent ? res.statusCode : null;
      for (const stats of [total, row]) {
        stats.active--;
        if (finished) {
          stats.completed++;
          stats.statuses[status] = (stats.statuses[status] ?? 0) + 1;
          observeLatency(stats, durationMs);
        } else stats.aborted++;
      }
      if (recentLimit) {
        recent[recentNext] = { requestId, at: new Date().toISOString(), routeId: id,
          method, outcome, status, durationMs: round(durationMs) };
        recentNext = (recentNext + 1) % recentLimit;
        recentCount = Math.min(recentLimit, recentCount + 1);
      }
    }
    function finish() { complete('completed'); }
    function closed() { complete(res.writableFinished ? 'completed' : 'aborted'); }
    res.once('finish', finish); res.once('close', closed); pending.add(cleanup);
  }
  // Run before the application listener, including synchronous res.end(). Do not
  // consume the body, patch write/end, set headers, or change dispatch arguments.
  server.prependListener('request', onRequest);
  function snapshot() {
    const now = performance.now(), tick = Math.floor(now / 1000);
    return {
      schema: 'stellar-forge.seller-traffic.v1', startedAt, capturedAt: new Date().toISOString(),
      uptimeSeconds: round((now - started) / 1000), observing: attached,
      mode: session.mode === 'NATIVE_X402' ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      semantics: 'HTTP finish means handed to the operating system, not client receipt or settlement. Latencies include completed responses only; percentiles are histogram upper bounds.',
      receivedInLast60SecondBuckets: seconds.reduce((n, slot) => n +
        (slot.tick <= tick && slot.tick > tick - 60 ? slot.count : 0), 0),
      totals: copyStats(total),
      routes: [...groups.values()].map(row => ({ routeId: row.id, method: row.method,
        path: known.get(row.id)?.path ?? SPECIAL[row.id], ...copyStats(row) })),
      recentLimit, recent: Array.from({ length: recentCount }, (_, i) =>
        ({ ...recent[(recentNext - 1 - i + recentLimit) % recentLimit] })),
    };
  }
  function prometheus() {
    const output = [
      '# HELP sf30_http_requests_total Requests observed after HTTP parsing.',
      '# TYPE sf30_http_requests_total counter',
      '# HELP sf30_http_active_requests Currently observed in-flight requests.',
      '# TYPE sf30_http_active_requests gauge',
      '# HELP sf30_http_responses_total Completed HTTP responses; not payment receipts.',
      '# TYPE sf30_http_responses_total counter',
      '# HELP sf30_http_aborted_total Connections closed before response finish.',
      '# TYPE sf30_http_aborted_total counter',
      '# HELP sf30_http_response_duration_seconds Completed response duration.',
      '# TYPE sf30_http_response_duration_seconds histogram',
    ];
    for (const row of groups.values()) {
      const tags = `route_id="${label(row.id)}",method="${label(row.method)}"`;
      output.push(`sf30_http_requests_total{${tags}} ${row.received}`,
        `sf30_http_active_requests{${tags}} ${row.active}`,
        `sf30_http_aborted_total{${tags}} ${row.aborted}`);
      for (const [status, count] of Object.entries(row.statuses))
        output.push(`sf30_http_responses_total{${tags},status="${status}"} ${count}`);
      let cumulative = 0;
      for (let i = 0; i < row.latencyBins.length; i++) {
        cumulative += row.latencyBins[i];
        output.push(`sf30_http_response_duration_seconds_bucket{${tags},le="${i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] / 1000 : '+Inf'}"} ${cumulative}`);
      }
      output.push(`sf30_http_response_duration_seconds_sum{${tags}} ${row.latencySumMs / 1000}`,
        `sf30_http_response_duration_seconds_count{${tags}} ${row.latencyCount}`);
    }
    return output.join('\n') + '\n';
  }
  const observer = { snapshot, prometheus, detach() {
    if (!attached) return;
    attached = false; server.removeListener('request', onRequest);
    // Let already-observed requests finish. Reattachment is disallowed until
    // those response listeners are gone, avoiding ambiguous overlapping totals.
    if (pending.size === 0) ATTACHED.delete(server);
  } };
  ATTACHED.set(server, observer);
  return observer;
}
