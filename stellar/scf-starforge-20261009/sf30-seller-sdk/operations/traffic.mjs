// MIT. Bounded HTTP observations around the original SF30 server, not payment accounting.
import { randomUUID } from 'node:crypto';
import { selectServiceRoute } from '../route-path.mjs';
import { supportsSellerMethod } from '../http-methods.mjs';

const LIMITS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 15000, Infinity];
const OUTCOMES = ['success', 'challenge', 'clientError', 'serverError', 'other', 'disconnected'];
const MINUTE = 60000;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
const empty = () => ({ started: 0, completed: 0, responses: 0, inFlight: 0,
  success: 0, challenge: 0, clientError: 0, serverError: 0, other: 0,
  disconnected: 0, durationTotalMs: 0, durationMaxMs: 0,
  histogram: LIMITS.map(() => 0), statuses: Object.create(null) });
function complete(row, outcome, duration, status) {
  row.completed++; row[outcome]++;
  if (outcome !== 'disconnected') {
    row.responses++; row.statuses[status] = (row.statuses[status] ?? 0) + 1;
  }
  row.durationTotalMs += duration;
  row.durationMaxMs = Math.max(row.durationMaxMs, duration);
  row.histogram[LIMITS.findIndex(limit => duration <= limit)]++;
}
function view(row) {
  const { durationTotalMs, histogram, statuses, ...rest } = row;
  const target = Math.ceil(row.completed * 0.95);
  let sum = 0, bound = null;
  if (target) for (let i = 0; i < histogram.length; i++) {
    sum += histogram[i];
    if (sum >= target) { bound = Number.isFinite(LIMITS[i]) ? LIMITS[i] : '>15000'; break; }
  }
  return { ...rest, durationMaxMs: Math.round(rest.durationMaxMs * 100) / 100,
    durationMeanMs: row.completed ? Math.round(durationTotalMs / row.completed * 100) / 100 : null,
    latencyP95UpperBoundMs: bound, statuses: { ...statuses },
    // Preserve the existing finish-or-disconnect latency population. JSON bins
    // are noncumulative; the Prometheus adapter accumulates them explicitly.
    durationHistogram: { count: row.completed, sumMs: durationTotalMs,
      buckets: histogram.map((count, i) => ({
        upperBoundMs: Number.isFinite(LIMITS[i]) ? LIMITS[i] : null, count })) },
    httpSuccessPercent: row.responses ? Math.round(row.success / row.responses * 10000) / 100 : null };
}

/** Observe a running startSellerService() result. Never reads bodies or payment headers. */
export function observeSellerTraffic(session, { now = Date.now, monotonic = () => performance.now(),
  recentLimit = 160 } = {}) {
  if (!session?.server || !Array.isArray(session.compiled?.routes) ||
      session.compiled.routes.length < 1 || session.compiled.routes.length > 100 ||
      typeof session.server.prependListener !== 'function' || typeof now !== 'function' ||
      typeof monotonic !== 'function') throw new TypeError('Running SF30 seller session required');
  if (!Number.isInteger(recentLimit) || recentLimit < 0 || recentLimit > 2000)
    throw new RangeError('recentLimit must be 0–2000');
  const routes = session.compiled.routes;
  const stats = new Map();
  for (const route of routes) {
    if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(route.id) ||
        stats.has(route.id) || typeof route.path !== 'string' || route.path.length > 2048 ||
        !supportsSellerMethod(route.method) || !route.binding) {
      throw new TypeError('Original compiled seller routes required');
    }
    stats.set(route.id, { id: route.id, method: route.method, path: route.path, ...empty() });
  }
  for (const [id, path] of [['@unmatched', 'Unmatched resources'],
    ['@method', 'Unsupported methods'], ['@invalid', 'Invalid request targets']]) {
    stats.set(id, { id, method: '-', path, ...empty() });
  }
  const totals = empty(), buckets = new Map(), days = new Map();
  const startedAt = new Date(now()).toISOString(), sessionId = randomUUID();
  let attached = true, observerErrors = 0, ignoredMetadata = 0;
  const recent = Array(recentLimit);
  let sequence = 0, recentCount = 0, recentNext = 0;
  // Clamp wall-clock regressions for the rolling ring, not request latency.
  let latestMinute = Math.floor(now() / MINUTE);
  function minute() {
    latestMinute = Math.max(latestMinute, Math.floor(now() / MINUTE));
    for (const key of buckets.keys()) if (key < latestMinute - 59) buckets.delete(key);
    if (!buckets.has(latestMinute)) buckets.set(latestMinute, empty());
    return buckets.get(latestMinute);
  }
  // Use the same start/terminal events as the original observer. Daily starts
  // and completions have their own UTC event dates; no lifetime-delta estimates.
  function dayRow(id) {
    const key = new Date(now()).toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { totals: empty(), routes: new Map() });
    const day = days.get(key);
    if (!day.routes.has(id)) {
      const { method, path } = stats.get(id);
      day.routes.set(id, { id, method, path, ...empty() });
    }
    // Disk history checkpoints merge these day rows by session and date. Keep
    // the observer bounded even when persistence is disabled or unavailable.
    if (days.size > 32) days.delete([...days.keys()].sort()[0]);
    return [day.totals, day.routes.get(id)];
  }
  function identify(req) {
    const target = req.url;
    if (typeof target !== 'string' || target.length > 8192 ||
        !target.startsWith('/') || target.startsWith('//') || target.includes('#')) return '@invalid';
    const path = target.split('?', 1)[0];
    if (path.startsWith('/_seller/')) return null;
    try {
      const selected = selectServiceRoute(routes, path, req.method);
      return !selected ? '@unmatched' : selected.route ? selected.route.id : '@method';
    } catch { return '@invalid'; }
  }
  function request(req, res) {
    // A failed observer must not interfere with the original payment/request path.
    try {
      const id = identify(req);
      if (id === null) { ignoredMetadata++; return; }
      const row = stats.get(id), start = monotonic();
      if (!row) { observerErrors++; return; }
      for (const item of [row, totals]) { item.started++; item.inFlight++; }
      minute().started++;
      for (const item of dayRow(id)) item.started++;
      const requestId = ++sequence, method = METHODS.has(req.method) ? req.method : 'OTHER';
      let done = false;
      function terminal(disconnected) {
        if (done) return;
        done = true;
        res.removeListener('finish', finish); res.removeListener('close', closed);
        try {
          const duration = Math.max(0, monotonic() - start);
          const code = res.statusCode;
          const outcome = disconnected ? 'disconnected' : code === 402 ? 'challenge' :
            code >= 200 && code < 300 ? 'success' : code >= 400 && code < 500 ? 'clientError' :
            code >= 500 && code < 600 ? 'serverError' : 'other';
          for (const item of [row, totals]) { item.inFlight--; complete(item, outcome, duration, code); }
          complete(minute(), outcome, duration, code);
          for (const item of dayRow(id)) complete(item, outcome, duration, code);
          if (recentLimit) {
            recent[recentNext] = { requestId, at: new Date(now()).toISOString(), routeId: id,
              method, outcome, status: disconnected && !res.headersSent ? null : code,
              durationMs: Math.round(duration * 100) / 100 };
            recentNext = (recentNext + 1) % recentLimit;
            recentCount = Math.min(recentLimit, recentCount + 1);
          }
        } catch { observerErrors++; }
      }
      const finish = () => terminal(false);
      const closed = () => terminal(!res.writableFinished);
      res.once('finish', finish); res.once('close', closed);
    } catch { observerErrors++; }
  }
  session.server.prependListener('request', request);
  function detach() {
    if (!attached) return;
    attached = false;
    session.server.removeListener('request', request);
    session.server.removeListener('close', detach);
  }
  session.server.once('close', detach);
  return {
    detach,
    snapshot() {
      minute();
      return { schema: 'stellar-forge.seller-traffic.v1', sessionId, startedAt,
        capturedAt: new Date(now()).toISOString(), attached,
        mode: ['NATIVE_X402', 'CHALLENGE_ONLY'].includes(session.mode) ? session.mode : 'UNKNOWN',
        observerErrors, ignoredMetadata, totals: view(totals),
        routes: [...stats.values()].map(view),
        days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => {
          const dailyView = row => { const { inFlight, ...result } = view(row); return result; };
          return { day, totals: dailyView(rows.totals), routes: [...rows.routes.values()].map(dailyView) };
        }),
        recentLimit, recent: Array.from({ length: recentCount }, (_, i) =>
          ({ ...recent[(recentNext - 1 - i + recentLimit) % recentLimit] })),
        minutes: Array.from({ length: 60 }, (_, i) => {
          const key = latestMinute - 59 + i;
          // In-flight applies to the session; a completion bucket may have started earlier.
          const { inFlight, ...values } = view(buckets.get(key) ?? empty());
          return { minute: new Date(key * MINUTE).toISOString(), ...values };
        }),
        semantics: { requests: 'HTTP attempts, not unique buyers or payment transactions',
          success: 'HTTP 2xx response finished at server; not verified settlement, revenue or client receipt',
          latency: 'Arrival to response finish/disconnect, including cancelled responses',
          p95: 'Upper bound of fixed histogram bin, not an exact percentile',
          persistence: 'Process memory only; restart begins a new session',
          retention: 'Cumulative route totals, 60 minute buckets, 32 UTC day aggregates, and a bounded ring of metadata-only outcomes; no request contents',
          days: 'Starts and finishes/disconnects use their own UTC event dates; day rows have no in-flight gauge' } };
    },
  };
}

/** Route aggregates only. Formula-like cells are neutralized for spreadsheet import. */
export function trafficCsv(snapshot) {
  const fields = ['id', 'method', 'path', 'started', 'completed', 'responses', 'inFlight',
    ...OUTCOMES, 'durationMeanMs', 'durationMaxMs', 'latencyP95UpperBoundMs', 'httpSuccessPercent'];
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [fields, ...snapshot.routes.map(route => fields.map(field => route[field]))]
    .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Classic Prometheus text from the SAME observer snapshot, not another collector. */
export function trafficPrometheus(snapshot) {
  if (snapshot?.schema !== 'stellar-forge.seller-traffic.v1' || !Array.isArray(snapshot.routes))
    throw new TypeError('Original seller traffic snapshot required');
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  const output = [
    '# HELP sf30_http_requests_total HTTP attempts, not buyers or payments.',
    '# TYPE sf30_http_requests_total counter',
    '# HELP sf30_http_active_requests Observed in-flight HTTP requests.',
    '# TYPE sf30_http_active_requests gauge',
    '# HELP sf30_http_responses_total Finished HTTP responses, not settlement receipts.',
    '# TYPE sf30_http_responses_total counter',
    '# HELP sf30_http_aborted_total Requests disconnected before response finish.',
    '# TYPE sf30_http_aborted_total counter',
    '# HELP sf30_http_request_duration_seconds Arrival to finish or disconnect; includes cancelled requests.',
    '# TYPE sf30_http_request_duration_seconds histogram',
  ];
  for (const row of snapshot.routes) {
    const tags = `route_id="${escape(row.id)}",method="${escape(row.method)}"`;
    output.push(`sf30_http_requests_total{${tags}} ${row.started}`,
      `sf30_http_active_requests{${tags}} ${row.inFlight}`,
      `sf30_http_aborted_total{${tags}} ${row.disconnected}`);
    for (const [code, count] of Object.entries(row.statuses))
      output.push(`sf30_http_responses_total{${tags},status="${code}"} ${count}`);
    let cumulative = 0;
    for (const bin of row.durationHistogram.buckets) {
      cumulative += bin.count;
      const upper = bin.upperBoundMs === null ? '+Inf' : bin.upperBoundMs / 1000;
      output.push(`sf30_http_request_duration_seconds_bucket{${tags},le="${upper}"} ${cumulative}`);
    }
    output.push(`sf30_http_request_duration_seconds_sum{${tags}} ${row.durationHistogram.sumMs / 1000}`,
      `sf30_http_request_duration_seconds_count{${tags}} ${row.durationHistogram.count}`);
  }
  return output.join('\n') + '\n';
}

