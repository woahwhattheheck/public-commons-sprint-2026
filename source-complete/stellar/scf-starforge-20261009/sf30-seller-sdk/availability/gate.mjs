// MIT. Route-specific availability before the original SF30 request/payment path.
import { selectServiceRoute } from '../route-path.mjs';
import { openAvailabilityPolicy } from './store.mjs';

export async function createSellerAvailability(compiled, directory) {
  const definitions = compiled.routes.map(route => ({ id: route.id, method: route.method, path: route.path,
    description: route.offer.resource.description ?? '' }));
  const ids = new Set(definitions.map(row => row.id));
  const policy = await openAvailabilityPolicy({ directory, routeIds: ids,
    origin: new URL(compiled.routes[0].offer.resource.url).origin });
  const counts = new Map(definitions.map(row => [row.id, { inFlight: 0, admitted: 0, rejected: 0 }]));
  function snapshot() {
    const saved = policy.snapshot(), paused = new Map(saved.paused.map(row => [row.id, row]));
    return { schema: 'stellar-forge.seller-availability.v1', available: true,
      revision: saved.revision, savedAt: saved.savedAt, storageState: saved.storageState,
      serviceOrigin: saved.serviceOrigin,
      routes: definitions.map(route => {
        const hold = paused.get(route.id), count = counts.get(route.id), unavailable = policy.paused(route.id);
        return { ...route, ...count, paused: Boolean(hold), reason: hold?.reason ?? '', changedAt: hold?.changedAt ?? null,
          state: saved.storageState !== 'ready' ? 'storage_unavailable' : unavailable ? count.inFlight ? 'pausing' : 'paused' : 'selling' };
      }),
      retiredPauses: saved.paused.filter(row => !ids.has(row.id)), recentChanges: saved.changes.slice().reverse(),
    };
  }
  function handle(req, res, run) {
    let route;
    try {
      if (typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//')) {
        const rawPath = req.url.split('?')[0];
        route = selectServiceRoute(compiled.routes, rawPath, req.method)?.route;
        if (route) {
          const target = new URL(req.url, route.offer.resource.url);
          if (target.hash || target.pathname !== rawPath || target.href.length > 2048) route = null;
        }
      }
    } catch { route = null; }
    // The unchanged original router owns invalid targets and methods.
    if (!route) return run();
    if (res.destroyed || res.writableEnded) return;
    const count = counts.get(route.id);
    if (policy.paused(route.id)) {
      count.rejected++;
      const body = Buffer.from('{"error":"SELLER_ROUTE_PAUSED"}');
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.length), 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'retry-after': '30',
        ...(!req.complete ? { connection: 'close' } : {}) });
      if (!req.complete) res.once('finish', () => { if (!req.complete) req.destroy(); });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    count.inFlight++; count.admitted++;
    let httpDone = false, workDone = false, released = false;
    const release = () => {
      if (!released && httpDone && workDone) { released = true; count.inFlight--; }
    };
    const terminal = () => {
      httpDone = true; res.removeListener('finish', terminal); res.removeListener('close', terminal); release();
    };
    res.once('finish', terminal); res.once('close', terminal);
    // Capture admission synchronously; later pause changes cannot cancel work
    // already admitted. Count it until BOTH the response and native work finish.
    try { return Promise.resolve(run()).finally(() => { workDone = true; release(); }); }
    catch (error) { workDone = true; release(); throw error; }
  }
  return Object.freeze({ snapshot, handle, close: policy.close,
    async update(input) { await policy.update(input); return snapshot(); } });
}
