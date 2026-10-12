#!/usr/bin/env node
// MIT. Service-manager entrypoint for the existing managed fleet workspace.
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFleetBundle } from './deploy.mjs';
import { startFleetWorkspace } from './workspace/server.mjs';

const HOST = '127.0.0.1';
const HEALTH = 'stellar-forge.fleet-host-health.v1';
const HEX = /^[a-f0-9]{64}$/;
const SESSION = /^[A-Za-z0-9_-]{43}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = code => Object.assign(new Error(code), { code });
const USAGE = `Usage: node deploy-runtime.mjs run --bundle DIRECTORY
       node deploy-runtime.mjs health --bundle DIRECTORY

Run keeps the original managed workspace, gateway and seller sessions in one
foreground process. SIGTERM/SIGINT drains the original service before exit.
Health reads that same workspace and returns its currently serving merchants.`;

/** Literal loopback only; no redirects, proxy selection or response-body logging. */
function readWorkspace(port, path, session) {
  return new Promise((done, fail) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? fail(error) : done(value);
    };
    const call = request({ hostname: HOST, port, method: 'GET', path, agent: false,
      headers: { host: HOST + ':' + port, accept: 'application/json',
        ...(session ? { 'x-fleet-workspace': session } : {}) } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        return finish(failure('FLEET_DEPLOYMENT_WORKSPACE_UNAVAILABLE'));
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')) {
        response.destroy();
        return finish(failure('FLEET_DEPLOYMENT_STATUS_INVALID'));
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          response.destroy();
          finish(failure('FLEET_DEPLOYMENT_STATUS_TOO_LARGE'));
        } else chunks.push(chunk);
      });
      response.once('error', () => finish(failure('FLEET_DEPLOYMENT_STATUS_READ_FAILED')));
      response.once('aborted', () => finish(failure('FLEET_DEPLOYMENT_STATUS_READ_FAILED')));
      response.once('end', () => {
        try {
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (!object(value)) throw failure('FLEET_DEPLOYMENT_STATUS_INVALID');
          finish(null, value);
        } catch { finish(failure('FLEET_DEPLOYMENT_STATUS_INVALID')); }
      });
    });
    const timer = setTimeout(() => {
      call.destroy();
      finish(failure('FLEET_DEPLOYMENT_STATUS_TIMEOUT'));
    }, 5000);
    call.once('error', () => finish(failure('FLEET_DEPLOYMENT_WORKSPACE_UNAVAILABLE')));
    call.end();
  });
}

function identity(tenants) {
  if (!Array.isArray(tenants)) throw failure('FLEET_DEPLOYMENT_MERCHANTS_CHANGED');
  return tenants.map(row => {
    if (!object(row) || typeof row.id !== 'string' || typeof row.host !== 'string')
      throw failure('FLEET_DEPLOYMENT_MERCHANTS_CHANGED');
    return row.id + '\n' + row.host;
  }).sort();
}

async function probe(manifest) {
  const session = await readWorkspace(manifest.workspacePort, '/api/session');
  if (session.managed !== true || typeof session.session !== 'string' || !SESSION.test(session.session))
    throw failure('FLEET_DEPLOYMENT_MANAGED_WORKSPACE_REQUIRED');
  const snapshot = await readWorkspace(manifest.workspacePort, '/api/status', session.session);
  const native = snapshot.status, releases = snapshot.releaseStatus;
  if (snapshot.planDigest !== manifest.planDigest || !object(native) || !object(releases) ||
      releases.schema !== 'stellar-forge.fleet-release-status.v1' ||
      native.schema !== 'stellar-forge.merchant-fleet.v1' || native.mode !== 'LIVE_ROLLOUT')
    throw failure('FLEET_DEPLOYMENT_PLAN_CHANGED');
  if (releases.closing !== false || releases.closed !== false || native.closing !== false)
    throw failure('FLEET_DEPLOYMENT_DRAINING');
  if (releases.relationship !== 'LINKED' || !Number.isSafeInteger(native.revision) ||
      native.revision < 1 || typeof native.digest !== 'string' || !HEX.test(native.digest))
    throw failure('FLEET_DEPLOYMENT_RELEASE_NOT_LINKED');
  const expected = JSON.stringify(identity(manifest.plan.tenants));
  if (JSON.stringify(identity(native.merchants)) !== expected ||
      JSON.stringify(identity(releases.tenants)) !== expected)
    throw failure('FLEET_DEPLOYMENT_MERCHANTS_CHANGED');

  const merchants = manifest.plan.tenants.map(tenant => {
    const merchant = native.merchants.find(row => row.id === tenant.id);
    const release = releases.tenants.find(row => row.id === tenant.id);
    const serving = Array.isArray(release.slots) ? release.slots.filter(slot => slot.serving === true) : [];
    const slot = serving[0], configured = slot && tenant.slots[slot.name];
    if (serving.length !== 1 || !configured || configured.port !== slot.port ||
        merchant.upstreamPort !== slot.port || slot.owned !== true || slot.state !== 'RUNNING' ||
        typeof slot.instanceId !== 'string' || !slot.instanceId ||
        typeof slot.runningReleaseId !== 'string' || !slot.runningReleaseId ||
        slot.runningReleaseId !== slot.selectedReleaseId || !HEX.test(slot.runningDigest ?? '') ||
        !['CHALLENGE_ONLY', 'NATIVE_X402'].includes(merchant.mode))
      throw failure('FLEET_DEPLOYMENT_ORIGINAL_SELLER_UNAVAILABLE');
    return { id: tenant.id, host: tenant.host, slot: slot.name,
      releaseId: slot.runningReleaseId, mode: merchant.mode,
      activeRequests: merchant.totalActive };
  });
  return { schema: HEALTH, ready: true, fleet: manifest.fleet,
    planDigest: manifest.planDigest, revision: native.revision,
    workspace: 'http://' + HOST + ':' + manifest.workspacePort,
    merchantIngress: 'http://' + HOST + ':' + manifest.plan.gateway.port,
    merchants, checkedAt: new Date().toISOString() };
}

/** Read current original state without loading credentials or starting a service. */
export async function fleetDeploymentHealth(bundle) {
  return probe(await checkFleetBundle(bundle));
}

/** Own signals around the existing native close; stdin lifetime has no effect. */
export async function runFleetDeployment({ bundle, handleSignals = true } = {}) {
  if (typeof handleSignals !== 'boolean') throw failure('FLEET_DEPLOYMENT_SIGNAL_OPTION_INVALID');
  let service, manifest, requestedClose = false, closingPromise;
  let resolveCompletion, rejectCompletion;
  const completion = new Promise((done, fail) => { resolveCompletion = done; rejectCompletion = fail; });
  // The caller may use close() alone. It still receives that same close failure.
  completion.catch(() => {});
  const signals = ['SIGTERM', 'SIGINT'];
  const detach = () => { if (handleSignals) for (const signal of signals) process.off(signal, onSignal); };
  const close = () => {
    requestedClose = true;
    if (!service) return null;
    if (!closingPromise) closingPromise = Promise.resolve().then(() => service.close()).then(() => {
      const result = { closed: true, fleet: manifest.fleet };
      resolveCompletion(result);
      return result;
    }, error => { rejectCompletion(error); throw error; }).finally(detach);
    return closingPromise;
  };
  const onSignal = () => { close()?.catch(() => { process.exitCode = 1; }); };
  // Install before any original seller can start. Repeated signals request the
  // same drain instead of terminating a still-admitted request or native stage.
  if (handleSignals) for (const signal of signals) process.on(signal, onSignal);
  try {
    manifest = await checkFleetBundle(bundle);
    if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function' ||
        process.getuid() !== manifest.serviceUid || process.getgid() !== manifest.serviceGid)
      throw failure('FLEET_DEPLOYMENT_SERVICE_IDENTITY_REQUIRED');
    if (requestedClose) {
      detach(); resolveCompletion({ closed: true, fleet: manifest.fleet });
      return { fleet: manifest.fleet, ready: null, close: () => completion, completion };
    }
    if (manifest.environmentFile !== null && manifest.environmentFile !== undefined) {
      if (typeof process.loadEnvFile !== 'function') throw failure('FLEET_DEPLOYMENT_NODE_ENV_SUPPORT_REQUIRED');
      process.loadEnvFile(manifest.environmentFile);
    }
    service = await startFleetWorkspace({ releasePlan: manifest.planFile,
      releaseDirectory: manifest.releaseDirectory, stateDirectory: manifest.gatewayStateDirectory,
      port: manifest.workspacePort, expectedPlanDigest: manifest.planDigest });
    if (requestedClose) {
      await close();
      return { fleet: manifest.fleet, ready: null, close, completion };
    }
    const ready = await probe(manifest);
    if (requestedClose) {
      await close();
      return { fleet: manifest.fleet, ready: null, close, completion };
    }
    return { fleet: manifest.fleet, workspace: service.url,
      merchantIngress: service.publicURL, ready, close, completion };
  } catch (error) {
    const interrupted = requestedClose;
    try { await close(); } catch (cleanup) { error.cleanupError = cleanup.code ?? cleanup.message; }
    detach();
    if (interrupted && !error.cleanupError) {
      resolveCompletion({ closed: true, fleet: manifest?.fleet ?? null });
      return { fleet: manifest?.fleet ?? null, ready: null, close: () => completion, completion };
    }
    rejectCompletion(error);
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return; }
  if (args.length !== 3 || !['run', 'health'].includes(args[0]) || args[1] !== '--bundle' ||
      !args[2] || args[2].startsWith('--')) throw new TypeError(USAGE);
  if (args[0] === 'health') {
    const health = await fleetDeploymentHealth(resolve(args[2]));
    process.stdout.write(JSON.stringify(health) + '\n');
    return health;
  }
  const runtime = await runFleetDeployment({ bundle: resolve(args[2]) });
  if (runtime.ready) process.stdout.write(JSON.stringify({ event: 'READY', ...runtime.ready }) + '\n');
  await runtime.completion;
  process.stdout.write(JSON.stringify({ schema: HEALTH, event: 'STOPPED',
    fleet: runtime.fleet, ready: false, checkedAt: new Date().toISOString() }) + '\n');
  return runtime;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code :
      /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'FLEET_DEPLOYMENT_FAILED';
    process.stderr.write(JSON.stringify({ schema: HEALTH, ready: false, error: code }) + '\n');
    process.exitCode = 1;
  });
}
