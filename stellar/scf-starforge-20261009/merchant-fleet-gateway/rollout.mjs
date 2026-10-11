// MIT. Live configuration changes for the original gateway, never payment replay.
import { randomUUID } from 'node:crypto';

const rejected = (code, status = 409) => Object.assign(new Error(code), { status });
const summary = tenant => ({ id: tenant.id, host: tenant.host, mode: tenant.mode,
  upstreamPort: tenant.upstreamPort, routes: tenant.compiled.routes.length,
  active: tenant.active, maxInFlight: tenant.maxInFlight, accepted: tenant.accepted,
  completed: tenant.completed, refused: tenant.refused, errors: tenant.errors });
const PUBLIC_ROUTE_BUDGET = 256 * 1024;
const CONTROL_RESPONSE_LIMIT = 1024 * 1024;

function publicRouteDetails(status, merchants) {
  // Budget the added public projection against the existing client's response
  // limit. Each merchant is complete or explicitly omitted, never half a quote.
  let remaining = Math.max(0, Math.min(PUBLIC_ROUTE_BUDGET,
    CONTROL_RESPONSE_LIMIT - Buffer.byteLength(JSON.stringify(status)) - 1024));
  for (const { view, tenant } of merchants.sort((a, b) => a.priority - b.priority)) {
    if (!remaining) break;
    const routeDetails = tenant.compiled.routes.map(route => ({ id: route.id,
      method: route.method, url: route.offer.resource.url,
      ...(route.binding.dynamic ? { routeTemplate: route.path } : {}),
      ...(route.offer.resource.mimeType ? { mimeType: route.offer.resource.mimeType } : {}),
      paymentChoices: route.offer.accepts }));
    const complete = { ...view, routeDetailsState: 'COMPLETE', routeDetails };
    const bytes = Buffer.byteLength(JSON.stringify(complete)) - Buffer.byteLength(JSON.stringify(view));
    if (bytes <= remaining) {
      Object.assign(view, complete, { routeDetails: structuredClone(routeDetails) });
      remaining -= bytes;
    }
  }
  return status;
}

export function createFleetRollout(fleet, { store = null, record = null,
  load, check, ports = () => [] } = {}) {
  let current = { ...(record ?? { revision: 1 }), fleet,
    byHost: new Map(fleet.tenants.map(tenant => [tenant.host, tenant])) };
  let prepared = null, busy = false, closing = false, retired = [];
  let operationDone = Promise.resolve();
  let storage = null;
  const activeByHost = new Map();
  const requireRevision = revision => {
    if (!Number.isSafeInteger(revision) || revision !== current.revision)
      throw rejected('FLEET_REVISION_CHANGED');
  };
  const exclusive = async work => {
    if (!store) throw rejected('FLEET_LIVE_CONTROL_DISABLED', 404);
    if (closing) throw rejected('FLEET_CLOSING', 503);
    if (busy) throw rejected('FLEET_OPERATION_IN_PROGRESS');
    store.assertHeld();
    busy = true;
    let finish;
    operationDone = new Promise(done => { finish = done; });
    try { return await work(); } finally { busy = false; finish(); }
  };
  const changes = next => ({
    added: next.tenants.filter(t => !current.byHost.has(t.host)).map(t => t.host),
    changed: next.tenants.filter(t => current.byHost.has(t.host) &&
      t.fingerprint !== current.byHost.get(t.host).fingerprint).map(t => t.host),
    removed: current.fleet.tenants.filter(t => !next.tenants.some(n => n.host === t.host)).map(t => t.host),
  });
  const verify = async next => {
    const checks = [];
    for (const tenant of next.tenants) {
      if (ports().includes(tenant.upstreamPort)) throw rejected('FLEET_INGRESS_PORT_COLLISION', 422);
      const serving = [current, ...retired.filter(g => g.fleet.tenants.some(t => t.active))];
      if (serving.some(g => g.fleet.tenants.some(t => t.upstreamPort === tenant.upstreamPort &&
          t.nativeFingerprint !== tenant.nativeFingerprint)))
        throw rejected('FLEET_CHANGED_SELLER_REQUIRES_NEW_PORT', 422);
      const original = current.byHost.get(tenant.host);
      if (original?.fingerprint === tenant.fingerprint) tenant.mode = original.mode;
      else checks.push(tenant);
    }
    await Promise.all(checks.map(check));
  };
  const prune = () => {
    retired = retired.filter((generation, index) => index >= retired.length - 16 ||
      generation.fleet.tenants.some(tenant => tenant.active > 0));
  };
  const collect = () => {
    if (!store) return;
    try {
      storage = store.collect([prepared?.record,
        ...retired.filter(g => g.fleet.tenants.some(t => t.active))].filter(Boolean));
    } catch { storage = { state: 'CLEANUP_REQUIRED', error: 'FLEET_SNAPSHOT_COLLECTION_FAILED' }; }
  };
  collect();
  const status = () => {
    prune();
    const selection = store?.read();
    const merchants = [];
    const view = (tenant, priority = 0) => {
      const result = { ...summary(tenant), routeDetailsState: 'STATUS_LIMIT' };
      merchants.push({ view: result, tenant, priority });
      return result;
    };
    const result = { schema: fleet.schema, mode: store ? 'LIVE_ROLLOUT' : 'STATIC',
      revision: current.revision, snapshotId: current.snapshotId ?? null,
      digest: current.digest ?? null, at: current.at ?? null, closing, busy,
      storage,
      merchants: current.fleet.tenants.map(t => Object.assign(view(t), {
        totalActive: activeByHost.get(t.host) ?? 0 })),
      candidate: prepared ? { id: prepared.id, baseRevision: prepared.baseRevision,
        expiresAt: new Date(prepared.expiresAt).toISOString(), changes: prepared.changes,
        merchants: prepared.fleet.tenants.map(t => view(t)), digest: prepared.record.digest } : null,
      retired: retired.map(g => ({ revision: g.revision, snapshotId: g.snapshotId ?? null,
        state: g.fleet.tenants.some(t => t.active) ? 'DRAINING' : 'DRAINED',
        merchants: g.fleet.tenants.map(t => view(t, g.fleet.tenants.some(t => t.active) ? 1 : 2)) })),
      history: selection?.history ?? [],
    };
    return publicRouteDetails(result, merchants);
  };
  const promote = (next, saved, expectedRevision) => {
    requireRevision(expectedRevision);
    if (closing) throw rejected('FLEET_CLOSING', 503);
    // All fallible preparation happens before this durable commit. The in-memory
    // route table changes synchronously, with no request admission between them.
    const nextRecord = store.activate(saved, expectedRevision);
    retired.push(current);
    current = { ...nextRecord, fleet: next,
      byHost: new Map(next.tenants.map(t => [t.host, t])) };
    prepared = null;
    collect();
    return status();
  };
  return {
    status,
    tenant: host => closing ? null : current.byHost.get(host),
    admit(tenant) {
      const active = activeByHost.get(tenant.host) ?? 0;
      if (closing || active >= tenant.maxInFlight) return null;
      activeByHost.set(tenant.host, active + 1);
      tenant.active++; tenant.accepted++;
      const generation = current;
      let released = false;
      return () => {
        if (released) return; released = true;
        tenant.active--;
        const remaining = activeByHost.get(tenant.host) - 1;
        if (remaining) activeByHost.set(tenant.host, remaining); else activeByHost.delete(tenant.host);
        if (generation !== current && !generation.fleet.tenants.some(t => t.active)) collect();
        prune();
      };
    },
    prepare(manifestPath, expectedRevision) {
      return exclusive(async () => {
        requireRevision(expectedRevision);
        const next = await load(manifestPath);
        await verify(next);
        if (closing) throw rejected('FLEET_CLOSING', 503);
        const record = store.snapshot(next);
        prepared = { id: randomUUID(), baseRevision: current.revision,
          expiresAt: Date.now() + 15 * 60 * 1000, changes: changes(next), fleet: next, record };
        collect();
        return status();
      });
    },
    activate(candidateId, expectedRevision) {
      return exclusive(async () => {
        requireRevision(expectedRevision);
        if (!prepared || candidateId !== prepared.id || prepared.baseRevision !== expectedRevision)
          throw rejected('FLEET_CANDIDATE_CHANGED');
        if (Date.now() >= prepared.expiresAt) throw rejected('FLEET_CANDIDATE_EXPIRED');
        // Reopen and hash-check the retained source, then verify the changed
        // original seller endpoints again immediately before activation.
        const record = prepared.record;
        const next = await load(store.manifest(record));
        await verify(next);
        return promote(next, record, expectedRevision);
      });
    },
    rollback(expectedRevision, targetRevision) {
      return exclusive(async () => {
        requireRevision(expectedRevision);
        const history = store.read().history;
        const saved = targetRevision === undefined ? history[0] :
          history.find(row => row.revision === targetRevision);
        if (!saved) throw rejected('FLEET_ROLLBACK_NOT_RETAINED', 404);
        const next = await load(store.manifest(saved));
        await verify(next);
        return promote(next, { snapshotId: saved.snapshotId, digest: saved.digest }, expectedRevision);
      });
    },
    withServingMerchant({ tenant, host, port, expectedRevision, expectedDigest } = {}, useOwnedSession) {
      return exclusive(async () => {
        requireRevision(expectedRevision);
        if (typeof useOwnedSession !== 'function')
          throw rejected('FLEET_SERVING_CALLBACK_REQUIRED', 400);
        const serving = current.fleet.tenants.find(row => row.id === tenant);
        if (typeof expectedDigest !== 'string' || expectedDigest !== current.digest ||
            !serving || serving.host !== host || serving.upstreamPort !== port)
          throw rejected('FLEET_SERVING_MERCHANT_CHANGED');
        // Sign against this exact active mapping while the existing activation,
        // rollback and retirement guard remains held. Requests keep their normal
        // admission path; shutdown awaits the original operationDone promise.
        return useOwnedSession();
      });
    },
    withRetiredPort(port, expectedRevision, closeOwnedSession) {
      return exclusive(async () => {
        requireRevision(expectedRevision);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
          throw rejected('FLEET_RETIRED_PORT_REQUIRED', 400);
        if (typeof closeOwnedSession !== 'function')
          throw rejected('FLEET_CLOSE_CALLBACK_REQUIRED', 400);
        if (current.fleet.tenants.some(t => t.upstreamPort === port) ||
            prepared?.fleet.tenants.some(t => t.upstreamPort === port) ||
            retired.some(g => g.fleet.tenants.some(t => t.upstreamPort === port && t.active > 0)))
          throw rejected('FLEET_PORT_STILL_REFERENCED');
        // A native caller retains its own original session handle. Holding the
        // same mutation guard closes the status-to-stop race with activation.
        await closeOwnedSession();
        return status();
      });
    },
    shutdown() { closing = true; return operationDone; },
  };
}
