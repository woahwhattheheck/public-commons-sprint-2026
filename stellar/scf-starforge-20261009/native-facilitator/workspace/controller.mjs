// MIT. The original native facilitator/server owns all payment and drain behavior.
import { randomUUID } from 'node:crypto';
import { createNativeFacilitator } from '../runtime.mjs';
import { startFacilitatorServer } from '../server.mjs';
import { createRpcReadiness } from '../readiness.mjs';
import { requireValue, fail } from './store.mjs';

export function createFacilitatorController(store, {environment = process.env} = {}) {
  let active = null, busy = null, closing = false, actionDone = Promise.resolve();
  async function exclusive(label, action) {
    requireValue(!closing, 'FACILITATOR_WORKSPACE_CLOSING', 503);
    requireValue(!busy, 'FACILITATOR_WORKSPACE_OPERATION_IN_PROGRESS', 409);
    busy = label;
    let done; actionDone = new Promise(resolve => {done = resolve;});
    try { return await action(); } finally { busy = null; done(); }
  }
  const view = () => ({operation:busy, closing, runtime:active ? {
    id:active.id, name:active.name, sha256:active.sha256, startedAt:active.startedAt,
    url:active.transport.url, stopping:active.stopping,
    status:active.native.status(), supported:active.supported,
  } : null});
  async function selected(name, sha256) {
    const profile = await store.read(name);
    requireValue(profile.sha256 === sha256, 'FACILITATOR_SELECTED_PROFILE_CHANGED', 409);
    return profile;
  }
  function sameRuntime(id) {
    requireValue(active && active.id === id, 'FACILITATOR_RUNTIME_CHANGED', 409);
    return active;
  }
  const start = ({name, sha256, port}) => exclusive('STARTING', async () => {
    requireValue(Number.isInteger(port) && port >= 0 && port <= 65535, 'PORT_INVALID');
    if (active) {
      if (active.name === name && active.sha256 === sha256 && active.requestedPort === port && !active.stopping)
        return {...view(), reused:true};
      fail('FACILITATOR_DRAIN_CURRENT_RUNTIME_FIRST', 409);
    }
    const profile = await selected(name, sha256);
    const native = await createNativeFacilitator(profile.config, {environment});
    let transport;
    try {
      transport = await startFacilitatorServer({facilitator:native, port});
      const supported = await native.getSupported();
      active = {id:randomUUID(), name, sha256, requestedPort:port, startedAt:new Date().toISOString(),
        native, transport, supported, stopping:false, idle:null};
      return {...view(), reused:false};
    } catch (error) { await transport?.close(); await native.drain(); throw error; }
  });
  async function stopCurrent(current) {
    current.stopping = true;
    const result = await current.transport.close();
    if (result.drained || current.native.status().activeVerify + current.native.status().activeSettle === 0) {
      await current.native.waitForIdle();
      if (active === current) active = null;
    } else if (!current.idle) {
      // Keep this actual runtime and its descriptors alive until its SDK calls end.
      const keepAlive = setInterval(() => {}, 1000);
      current.idle = current.native.waitForIdle().then(() => {
        if (active === current) active = null;
      }).finally(() => clearInterval(keepAlive));
      current.idle.catch(() => {});
    }
    return {...view(), drain:result};
  }
  const stop = ({runtimeId}) => exclusive('DRAINING', () => stopCurrent(sameRuntime(runtimeId)));
  const probe = ({runtimeId, name, sha256}) => exclusive('PROBING', async () => {
    if (runtimeId !== undefined) {
      const current = sameRuntime(runtimeId);
      requireValue(!current.stopping, 'FACILITATOR_DRAINING', 409);
      return {observation:await current.native.probeReadiness(), ...view()};
    }
    const profile = await selected(name, sha256);
    const readiness = createRpcReadiness(profile.config);
    try { return {observation:await readiness.probe(), ...view()}; }
    finally { await readiness.close(); }
  });
  async function close() {
    closing = true;
    await actionDone;
    const current = active;
    if (current) {
      await stopCurrent(current);
      await current.idle;
    }
  }
  return Object.freeze({view, start, stop, probe, close});
}
