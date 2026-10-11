// MIT. Live configuration changes for the original gateway, never payment replay.
import { randomUUID } from 'node:crypto';

const rejected = (code, status = 409) => Object.assign(new Error(code), { status });
const summary = tenant => ({ id: tenant.id, host: tenant.host, mode: tenant.mode,
  upstreamPort: tenant.upstreamPort, routes: tenant.compiled.routes.length,
  active: tenant.active, maxInFlight: tenant.maxInFlight, accepted: tenant.accepted,
  completed: tenant.completed, refused: tenant.refused, errors: tenant.errors });

export function createFleetRollout(fleet, { store = null, record = null,
  load, check, ports = () => [] } = {}) {
  let current = { ...(record ?? { revision: 1 }), fleet,
    byHost: new Map(fleet.tenants.map(tenant => [tenant.host, tenant])) };
  let prepared = null, busy = false, closing = false, retired = [];
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
    busy = true;
    try { return await work(); } finally { busy = false; }
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
    return { schema: fleet.schema, mode: store ? 'LIVE_ROLLOUT' : 'STATIC',
      revision: current.revision, snapshotId: current.snapshotId ?? null,
      digest: current.digest ?? null, at: current.at ?? null, closing, busy,
      storage,
      merchants: current.fleet.tenants.map(t => ({ ...summary(t),
        totalActive: activeByHost.get(t.host) ?? 0 })),
      candidate: prepared ? { id: prepared.id, baseRevision: prepared.baseRevision,
        expiresAt: new Date(prepared.expiresAt).toISOString(), changes: prepared.changes,
        merchants: prepared.fleet.tenants.map(summary), digest: prepared.record.digest } : null,
      retired: retired.map(g => ({ revision: g.revision, snapshotId: g.snapshotId ?? null,
        state: g.fleet.tenants.some(t => t.active) ? 'DRAINING' : 'DRAINED',
        merchants: g.fleet.tenants.map(summary) })),
      history: selection?.history ?? [],
    };
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
    shutdown() { closing = true; },
  };
}
