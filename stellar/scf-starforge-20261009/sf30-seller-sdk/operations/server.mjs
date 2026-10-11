// MIT. Read-only operator listener; separate from the advertised seller origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { observeSellerTraffic, trafficCsv, trafficPrometheus } from './traffic.mjs';
import { createTrafficHistory, historyCsv } from './history.mjs';
import { createDeliveryReader, deliveryCsv, deliveryPrometheus } from './delivery-view.mjs';

const HOST = '127.0.0.1';
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function startSellerOperations(session, { port = 8424, recentLimit = 160, deliveryOutbox = null, navigationOrigin = null,
  historyDirectory, historyRetentionDays = 90, historyCheckpointMs = 5000 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('operations port must be 0–65535');
  if (!Number.isInteger(historyCheckpointMs) || historyCheckpointMs < 1000 || historyCheckpointMs > 60000)
    throw new RangeError('history checkpoint interval must be 1000–60000 ms');
  if (navigationOrigin !== null && (typeof navigationOrigin !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(navigationOrigin) ||
      Number(new URL(navigationOrigin).port)>65535)) throw new TypeError('navigationOrigin must be an explicit loopback workspace origin');
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/fulfillment', 'delivery.html', 'text/html; charset=utf-8'],
    ['/console.mjs', 'console.mjs', 'text/javascript; charset=utf-8'],
    ['/delivery-panel.mjs', 'delivery-panel.mjs', 'text/javascript; charset=utf-8'],
    ['/recent.mjs', 'recent.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([path, file, type]) => [path, { type, bytes: await readFile(new URL(file, import.meta.url)) }])));
  // The SAME outbox used by the merchant's original native settlement decorator.
  const readDelivery = deliveryOutbox ? createDeliveryReader(deliveryOutbox) : null;
  const observer = observeSellerTraffic(session, { recentLimit });
  let history, checkpointTimer, checkpointPending, savedRevision;
  const revision = snapshot => [snapshot.totals.started, snapshot.totals.completed,
    snapshot.observerErrors, snapshot.ignoredMetadata, snapshot.attached,
    snapshot.capturedAt.slice(0, 10)].join(':');
  try {
    if (historyDirectory !== undefined) {
      history = await createTrafficHistory({ directory: historyDirectory, retentionDays: historyRetentionDays });
      const initial = observer.snapshot();
      await history.checkpoint(initial); savedRevision = revision(initial);
    }
  } catch (error) {
    observer.detach();
    await history?.close().catch(() => {});
    throw error;
  }
  function checkpoint() {
    if (!history || checkpointPending) return checkpointPending;
    const current = observer.snapshot(), currentRevision = revision(current);
    // An idle service must not rewrite months of aggregate data every tick.
    // A UTC date change still triggers retention; failed saves keep retrying.
    if (currentRevision === savedRevision) return;
    checkpointPending = history.checkpoint(current).then(() => {
      savedRevision = currentRevision;
    }).catch(() => {
      // History.status exposes the failure. Storage cannot interrupt HTTP work.
    }).finally(() => { checkpointPending = null; });
    return checkpointPending;
  }
  const storage = () => history ? { enabled: true, checkpointIntervalMs: historyCheckpointMs,
    ...history.status() } : { enabled: false };
  const snapshot = () => ({ ...observer.snapshot(), usageHistory: storage(),
    ...(typeof session.upstreamSnapshot === 'function' ? { upstreams: session.upstreamSnapshot() } : {}) });
  let allowedHosts = new Set(), allowedOrigins = new Set();
  const server = createServer((req, res) => {
    const reply = (code, type, data, extra = {}) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      res.writeHead(code, { 'content-type': type, 'content-length': String(bytes.length),
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': POLICY, 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin', ...extra });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      // An explicitly composed workspace may open HTML through a user click.
      // Cross-origin API/export reads retain the original operator-only policy.
      let referringOrigin = null;
      try { if (req.headers.referer) referringOrigin = new URL(req.headers.referer).origin; } catch {}
      const userNavigation = navigationOrigin !== null && referringOrigin === navigationOrigin &&
        req.method === 'GET' && ['/', '/fulfillment'].includes(req.url) &&
        req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' &&
        req.headers['sec-fetch-user'] === '?1';
      // Binding loopback alone does not stop hostile DNS names / browser cross-origin access.
      if (!allowedHosts.has(req.headers.host) ||
          (!userNavigation && ((req.headers.origin && !allowedOrigins.has(req.headers.origin)) ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])))) {
        return reply(403, 'text/plain', 'Operator origin required');
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'text/plain', 'Read only', { allow: 'GET, HEAD' });
      if (req.url === '/api/snapshot' || req.url === '/export.json') {
        return reply(200, 'application/json; charset=utf-8', JSON.stringify(snapshot()),
          req.url === '/export.json' ? { 'content-disposition': 'attachment; filename="seller-traffic.json"' } : {});
      }
      if (req.url === '/api/upstreams') {
        if (typeof session.upstreamSnapshot !== 'function') return reply(404, 'text/plain', 'No upstream adapter attached');
        return reply(200, 'application/json; charset=utf-8', JSON.stringify(session.upstreamSnapshot()));
      }
      if (req.url === '/export.csv') return reply(200, 'text/csv; charset=utf-8', trafficCsv(observer.snapshot()),
        { 'content-disposition': 'attachment; filename="seller-traffic.csv"' });
      if (['/api/delivery', '/delivery.json', '/delivery.csv', '/delivery.metrics'].includes(req.url)) {
        if (!readDelivery) {
          if (req.url !== '/api/delivery') return reply(404, 'text/plain', 'Outbox not attached');
          return reply(200, 'application/json; charset=utf-8',
            JSON.stringify({ schema: 'stellar-forge.sf98.operator-delivery.v1', available: false }));
        }
        // The journal read happens only for explicit operator GET/HEAD requests.
        // Read failures never affect seller HTTP traffic or reveal private paths.
        readDelivery().then(view => {
          if (res.destroyed) return;
          if (req.url === '/delivery.metrics') return reply(200,
            'text/plain; version=0.0.4; charset=utf-8', deliveryPrometheus(view));
          if (req.url === '/delivery.csv') return reply(200, 'text/csv; charset=utf-8', deliveryCsv(view),
            { 'content-disposition': 'attachment; filename="merchant-delivery-recent.csv"' });
          return reply(200, 'application/json; charset=utf-8', JSON.stringify(view),
            req.url === '/delivery.json'
              ? { 'content-disposition': 'attachment; filename="merchant-delivery.json"' } : {});
        }, () => {
          if (!res.destroyed) reply(503, 'application/json; charset=utf-8',
            JSON.stringify({ error: 'DELIVERY_JOURNAL_UNAVAILABLE' }));
        });
        return;
      }
      if (req.url === '/metrics') {
        const http = trafficPrometheus(observer.snapshot());
        if (!readDelivery) return reply(200, 'text/plain; version=0.0.4; charset=utf-8', http);
        readDelivery().then(view => {
          if (!res.destroyed) reply(200, 'text/plain; version=0.0.4; charset=utf-8',
            http + deliveryPrometheus(view));
        }, () => {
          if (!res.destroyed) reply(200, 'text/plain; version=0.0.4; charset=utf-8',
            http + '\n# TYPE sf98_outbox_read_available gauge\nsf98_outbox_read_available 0\n');
        });
        return;
      }
      if (req.url?.startsWith('/api/history') || req.url?.startsWith('/history.csv') || req.url?.startsWith('/history.json')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (!['/api/history', '/history.csv', '/history.json'].includes(url.pathname))
          return reply(404, 'text/plain', 'Not found');
        if (!history) return reply(url.pathname === '/api/history' ? 200 : 409,
          'application/json; charset=utf-8', JSON.stringify({
            schema: 'stellar-forge.seller-usage-history.v1', enabled: false,
            message: 'Start with --history-dir to retain aggregate usage across restarts.' }));
        let report;
        try {
          const keys = [...url.searchParams.keys()];
          if (keys.length > 3 || new Set(keys).size !== keys.length ||
              keys.some(key => !['from', 'to', 'routeId'].includes(key))) throw new TypeError();
          report = { ...history.query(Object.fromEntries(url.searchParams)), enabled: true,
            storage: storage() };
        } catch { return reply(400, 'text/plain', 'Invalid history date range or route filter'); }
        if (url.pathname === '/history.csv') return reply(200, 'text/csv; charset=utf-8', historyCsv(report),
          { 'content-disposition': 'attachment; filename="seller-usage-history.csv"' });
        return reply(200, 'application/json; charset=utf-8', JSON.stringify(report),
          url.pathname === '/history.json' ? { 'content-disposition': 'attachment; filename="seller-usage-history.json"' } : {});
      }
      const asset = assets.get(req.url);
      if (asset) return reply(200, asset.type, asset.bytes);
      return reply(404, 'text/plain', 'Not found');
    } catch { return reply(500, 'text/plain', 'Snapshot unavailable'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 8000; server.keepAliveTimeout = 2000;
  let closing;
  const close = () => {
    if (closing) return closing;
    clearInterval(checkpointTimer);
    observer.detach();
    closing = (async () => {
      try {
        await new Promise((done, fail) => {
          if (!server.listening) { done(); return; }
          server.close(error => error ? fail(error) : done());
          server.closeIdleConnections?.();
        });
      } finally {
        await checkpointPending;
        await history?.close(observer.snapshot());
      }
    })();
    return closing;
  };
  try {
    await new Promise((done, fail) => {
      const onError = error => { server.removeListener('listening', onListen); fail(error); };
      const onListen = () => { server.removeListener('error', onError); done(); };
      server.once('error', onError); server.once('listening', onListen); server.listen(port, HOST);
    });
    const assigned = server.address().port;
    allowedHosts = new Set([`${HOST}:${assigned}`, `localhost:${assigned}`]);
    allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
    if (history) checkpointTimer = setInterval(checkpoint, historyCheckpointMs).unref();
    return { server, url: `http://${HOST}:${assigned}`, observer, history, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}

