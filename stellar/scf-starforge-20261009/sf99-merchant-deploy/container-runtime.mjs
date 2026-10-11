#!/usr/bin/env node
// MIT. Foreground container owner for the original SF99 merchant process group.
import { spawn } from 'node:child_process';
import { mkdir, lstat, readFile, readlink, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkBundle } from './host.mjs';
import { checkOAuthHostConnections } from '../sf30-seller-sdk/oauth-connections/deployment.mjs';
import { atomicJSON, jsonFile, regular, privateDirectory } from './maintenance-system.mjs';
import { acquireDeliveryLease, inspectDeliveryLease } from '../sf98-merchant-delivery/delivery-lock.mjs';

export const RUNTIME_SCHEMA = 'stellar-forge.merchant-container-runtime.v1';
export const RUNTIME_DIRECTORY = '.container-runtime';
export const MAINTENANCE_MARKER = 'maintenance.json';
export const MAINTENANCE_MARKER_SCHEMA = 'stellar-forge.merchant-container-maintenance.v1';
const STATUS = 'runtime.json';
const START_ORDER = ['receiver', 'discovery', 'delivery', 'seller'];
const STOP_ORDER = ['seller', 'delivery', 'receiver', 'discovery'];
const stamp = () => new Date().toISOString();
const need = (yes, message) => { if (!yes) throw new Error(message); };
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
const codeOf = error => {
  const code = error?.code ?? error?.message;
  return /^[A-Z0-9_]{1,80}$/.test(code ?? '') ? code : 'RUNTIME_OPERATION_FAILED';
};
const whitespace = char => char === ' ' || char === '\t' || char === '\r';

export const runtimePaths = p => {
  const directory = join(p.stateRoot, RUNTIME_DIRECTORY);
  return { directory, status: join(directory, STATUS), maintenance: join(directory, MAINTENANCE_MARKER) };
};

async function checkedBundle(bundle) {
  const p = await checkBundle(bundle);
  // A generated container pins its additional source entries. Verify them from
  // inside the running image/source mount, in this original PID namespace.
  const outer = dirname(p.bundle);
  try { await lstat(join(outer, 'container.json')); }
  catch (error) { if (error.code === 'ENOENT') return p; throw error; }
  const { checkContainer } = await import('./container.mjs');
  const selected = await checkContainer(outer);
  need(selected.host.bundle === p.bundle && selected.host.stateRoot === p.stateRoot,
    'ORIGINAL_CONTAINER_HOST_SELECTION_REQUIRED');
  return p;
}

export async function readMaintenanceMarker(p) {
  let marker;
  try { marker = JSON.parse(await regular(runtimePaths(p).maintenance, 16384)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  need(marker?.schema === MAINTENANCE_MARKER_SCHEMA && marker.merchant === p.merchant &&
    typeof marker.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(marker.operationId),
    'ORIGINAL_MERCHANT_MAINTENANCE_MARKER_REQUIRED');
  return marker;
}

/** EnvironmentFile assignments use systemd.exec quoting, with no shell expansion.
 * https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#EnvironmentFile=
 * Values are read only in the running service and never enter status or logs. */
export function parseEnvironmentFile(text) {
  need(typeof text === 'string', 'ENVIRONMENT_FILE_UTF8_REQUIRED');
  for (const char of text) {
    const point = char.codePointAt(0);
    need(point !== 0 && point !== 0xfeff && !(point >= 0xfdd0 && point <= 0xfdef) &&
      (point & 0xffff) !== 0xfffe && (point & 0xffff) !== 0xffff &&
      !(point >= 0xd800 && point <= 0xdfff), 'ENVIRONMENT_FILE_INVALID_CHARACTER');
  }
  const result = Object.create(null);
  let index = 0;
  while (index < text.length) {
    while (index < text.length && (whitespace(text[index]) || text[index] === '\n')) index++;
    if (index === text.length) break;
    if (text[index] === '#' || text[index] === ';') {
      while (index < text.length && text[index++] !== '\n') { /* comment */ }
      continue;
    }
    let name = '';
    while (index < text.length && text[index] !== '=' && text[index] !== '\n') name += text[index++];
    if (text[index] !== '=') { if (index < text.length) index++; continue; }
    index++; name = name.replace(/^[ \t\r]+|[ \t\r]+$/g, '');
    need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name), 'ENVIRONMENT_FILE_INVALID_VARIABLE_NAME');
    let mode = 'before', value = '', trimAt = -1, finished = false;
    while (index < text.length && !finished) {
      const char = text[index++];
      if (mode === 'single') {
        if (char === "'") mode = 'before';
        else value += char;
      } else if (mode === 'double') {
        if (char === '"') mode = 'before';
        else if (char === '\\') {
          need(index < text.length, 'ENVIRONMENT_FILE_UNFINISHED_ESCAPE');
          const next = text[index++];
          if (next === '\n') continue;
          value += ['"', '\\', '`', '$'].includes(next) ? next : '\\' + next;
        } else value += char;
      } else if (char === '\n') {
        if (trimAt >= 0) value = value.slice(0, trimAt);
        finished = true;
      } else if (mode === 'before' && whitespace(char)) {
        // Whitespace outside an initial/complete quoted fragment is discarded.
      } else if (mode === 'before' && (char === "'" || char === '"')) {
        mode = char === "'" ? 'single' : 'double'; trimAt = -1;
      } else if (char === '\\') {
        need(index < text.length, 'ENVIRONMENT_FILE_UNFINISHED_ESCAPE');
        const next = text[index++];
        trimAt = -1; mode = 'value';
        if (next !== '\n') value += next;
      } else {
        mode = 'value';
        if (whitespace(char)) { if (trimAt < 0) trimAt = value.length; }
        else trimAt = -1;
        value += char;
      }
    }
    need(mode !== 'single' && mode !== 'double', 'ENVIRONMENT_FILE_UNCLOSED_QUOTE');
    if (!finished && trimAt >= 0) value = value.slice(0, trimAt);
    result[name] = value;
  }
  return result;
}

async function environment(p) {
  const selected = p.environmentFile ? parseEnvironmentFile(new TextDecoder('utf-8', { fatal: true })
    .decode(await regular(p.environmentFile, 1024 * 1024))) : {};
  return { ...process.env, ...selected, PYTHONDONTWRITEBYTECODE: '1' };
}

function selectedServices(p, readersOnly) {
  need(Array.isArray(p.services) && p.services.length > 0 &&
    p.services.every(service => START_ORDER.includes(service.role) && Array.isArray(service.args) &&
      service.args.length >= 2 && service.args.every(arg => typeof arg === 'string') &&
      Number.isInteger(service.stopSeconds) && service.stopSeconds >= 1 && service.stopSeconds <= 600) &&
    new Set(p.services.map(service => service.role)).size === p.services.length &&
    p.services.some(service => service.role === 'seller'), 'ORIGINAL_MERCHANT_SERVICE_GROUP_REQUIRED');
  return p.services.filter(service => !readersOnly || service.role !== 'delivery')
    .sort((a, b) => START_ORDER.indexOf(a.role) - START_ORDER.indexOf(b.role));
}

async function reservePorts(p) {
  const ports = [p.sellerPort, p.operationsPort, p.receiverPort, p.discoveryPort].filter(Boolean);
  const reservations = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((done, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
          server.removeListener('error', reject); done();
        });
      });
      reservations.push(server);
    }
  } catch (error) {
    const result = new Error('ORIGINAL_MERCHANT_LISTENER_UNAVAILABLE'); result.code = error.code; throw result;
  } finally {
    await Promise.all(reservations.map(server => new Promise(done => server.close(done))));
  }
}

async function httpReady(port, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    await response.body?.cancel(); return response.status === 200;
  } catch { return false; }
}

async function roleReady(p, record) {
  if (record.exited || !alive(record.pid)) return false;
  if (record.role === 'receiver') return httpReady(p.receiverPort, '/health');
  if (record.role === 'discovery') return httpReady(p.discoveryPort, '/healthz');
  if (record.role === 'seller') return await httpReady(p.sellerPort, '/_seller/ready') &&
    (!p.operationsPort || await httpReady(p.operationsPort, '/api/snapshot'));
  try {
    const lease = await inspectDeliveryLease(p.outbox);
    return lease.active && lease.owner?.pid === record.pid && lease.owner?.purpose === 'worker';
  } catch { return false; }
}

function groupAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function signalGroup(record, signal) {
  if (!record.pid) return;
  try { process.kill(-record.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function processIdentity(pid, procPid = pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const path = `/proc/${procPid}`, text = await readFile(path + '/stat', 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    const viewedPid = Number(text.slice(0, text.indexOf(' ')));
    const status = await readFile(path + '/status', 'utf8');
    const chain = status.split('\n').find(line => line.startsWith('NSpid:'))?.trim().split(/\s+/).slice(1).map(Number);
    const namespace = await readlink(path + '/ns/pid');
    if (chain?.at(-1) !== pid || namespace !== await readlink('/proc/self/ns/pid')) return null;
    return { pid, procPid: viewedPid, parentProcPid: Number(fields[1]),
      group: Number(fields[2]) === viewedPid ? pid : null, started: fields[19], namespace };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}

async function ownedChildIdentity(parent, pid) {
  const direct = await processIdentity(pid);
  if (direct?.parentProcPid === parent.procPid) return direct;
  // Some Linux runners expose an ancestor's procfs mount inside a nested PID
  // namespace. Resolve only this known parent's child, retaining NSpid, namespace
  // and start-time checks. Docker's normal private procfs takes the direct path.
  const candidates = (await readdir('/proc')).filter(name => /^[1-9][0-9]*$/.test(name))
    .map(Number).sort((a, b) => b - a);
  for (const candidate of candidates) {
    if (candidate === pid) continue;
    let text;
    try { text = await readFile(`/proc/${candidate}/stat`, 'utf8'); }
    catch (error) { if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) continue; throw error; }
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    if (Number(fields[1]) !== parent.procPid) continue;
    const identity = await processIdentity(pid, candidate);
    if (identity?.parentProcPid === parent.procPid) return identity;
  }
  return null;
}

async function rememberRetainedWorker(p, record) {
  if (!p.release || record.role !== 'seller' || record.stage !== 'run') return;
  let observed;
  try { observed = await jsonFile(join(p.release.store, 'runtime.json')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  // SF82 deliberately owns a second, detached worker group. Its original record
  // ties that group to this exact manager and immutable release, even if the
  // manager exits before the supervisor can ask it to drain.
  if (observed.managerPid !== record.pid || observed.releaseId !== p.release.id ||
      observed.releaseDigest !== p.release.digest || observed.host !== hostname()) return;
  const own = await processIdentity(process.pid, 'self');
  const manager = own && await ownedChildIdentity(own, record.pid);
  const identity = manager && await ownedChildIdentity(manager, observed.pid);
  if (identity && identity.group === identity.pid) record.workerGroup = identity;
}

async function retainedGroupAlive(record) {
  if (!record.workerGroup) return false;
  const current = await processIdentity(record.workerGroup.pid, record.workerGroup.procPid);
  if (current && current.started !== record.workerGroup.started) return false;
  // A leader alive under this namespace PID after its original proc entry is
  // gone is a reused process number, rather than an orphaned owned group.
  if (!current && alive(record.workerGroup.pid)) return false;
  return groupAlive(record.workerGroup.pid);
}

async function signalRetainedGroup(record, signal) {
  if (await retainedGroupAlive(record)) signalGroup(record.workerGroup, signal);
}

async function until(promise, milliseconds) {
  const controller = new AbortController();
  try { await Promise.race([promise, delay(milliseconds, undefined, { signal: controller.signal })]); }
  finally { controller.abort(); }
}

async function stopProcess(record, seconds) {
  const deadline = Date.now() + seconds * 1000;
  if (!record.exited) {
    record.phase = 'DRAINING';
    try { record.child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await until(record.closed, Math.max(0, deadline - Date.now()));
  }
  // Each original entry owns its own drain. Only orphaned descendants receive
  // a group signal after that parent has closed or spent its original grace.
  if (record.exited && groupAlive(record.pid)) {
    signalGroup(record, 'SIGTERM');
    while (groupAlive(record.pid) && Date.now() < deadline) await delay(50);
  }
  if (record.exited && await retainedGroupAlive(record)) {
    // The original worker leader still owns its application/query workers.
    try { process.kill(record.workerGroup.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    while (await retainedGroupAlive(record) && Date.now() < deadline) await delay(50);
  }
  if (groupAlive(record.pid)) { record.forced = true; signalGroup(record, 'SIGKILL'); }
  if (await retainedGroupAlive(record)) { record.forced = true; await signalRetainedGroup(record, 'SIGKILL'); }
  if (!record.exited) await until(record.closed, 5000);
  need(record.exited, 'ORIGINAL_MERCHANT_CHILD_DID_NOT_STOP');
}

/** Start the unchanged original services and retain their single foreground owner. */
export async function startContainer(bundle, { readersOnly = false, startupTimeoutSeconds = 90, signals = true } = {}) {
  need(process.platform === 'linux', 'MERCHANT_CONTAINER_REQUIRES_LINUX');
  need(typeof readersOnly === 'boolean' && Number.isInteger(startupTimeoutSeconds) &&
    startupTimeoutSeconds >= 1 && startupTimeoutSeconds <= 600, 'INVALID_CONTAINER_RUNTIME_OPTIONS');
  const p = await checkedBundle(bundle), services = selectedServices(p, readersOnly);
  await privateDirectory(p.stateRoot);
  need((await lstat(p.stateRoot)).uid === process.getuid(), 'MERCHANT_STATE_REQUIRES_ITS_ORIGINAL_OWNER');
  const directory = runtimePaths(p).directory;
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory);
  need((await lstat(directory)).uid === process.getuid(), 'MERCHANT_RUNTIME_REQUIRES_ITS_ORIGINAL_OWNER');
  const supervisor = await processIdentity(process.pid, 'self');
  need(supervisor, 'ORIGINAL_CONTAINER_PROCESS_NAMESPACE_REQUIRED');
  const lease = await acquireDeliveryLease(directory, { purpose: 'drain' });
  const runtimeId = randomUUID(), records = new Map(), controller = new AbortController();
  const startedAt = stamp();
  let phase = 'STARTING', stopping = false, failure = null, stopPromise = null, updatedAt = startedAt;
  let maintenance = null;
  let persistQueue = Promise.resolve(), closedResolve;
  const closed = new Promise(done => { closedResolve = done; });
  const snapshot = () => ({ schema: RUNTIME_SCHEMA, runtimeId, merchant: p.merchant, bundle: p.bundle,
    sourceRoot: p.sourceRoot, stateRoot: p.stateRoot, kind: p.kind, mode: readersOnly ? 'readers' : 'all',
    phase, ready: phase === 'RUNNING', host: hostname(), pidNamespace: supervisor.namespace,
    supervisorPid: process.pid, supervisorProcPid: supervisor.procPid,
    supervisorStarted: supervisor.started, leaseId: lease.owner.id,
    startedAt, updatedAt, failure, maintenance,
    children: services.map(service => {
      const record = records.get(service.role);
      return { role: service.role, unit: service.unit, stopSeconds: service.stopSeconds,
        ...(record ? { pid: record.pid ?? null, stage: record.stage, phase: record.phase,
          workerPid: record.workerGroup?.pid ?? null,
          ready: record.ready, startedAt: record.startedAt, exitedAt: record.exitedAt ?? null,
          exited: record.exited, exitCode: record.exitCode ?? null, signal: record.signal ?? null,
          forced: record.forced ?? false } : { pid: null, phase: 'PENDING', ready: false }) };
    }) });
  const persist = () => {
    updatedAt = stamp();
    persistQueue = persistQueue.catch(() => {}).then(() => atomicJSON(join(directory, STATUS), snapshot()));
    return persistQueue;
  };
  const stop = (reason = 'STOP_REQUESTED', error = null) => {
    if (stopPromise) return stopPromise;
    stopping = true; controller.abort(); phase = 'DRAINING';
    if (error) failure ??= { code: codeOf(error), reason, at: stamp() };
    stopPromise = (async () => {
      try {
        const retain = async () => { try { await persist(); }
          catch (error) { failure ??= { code: codeOf(error), reason: 'RUNTIME_STATUS_WRITE_FAILED', at: stamp() }; } };
        await retain();
        for (const role of STOP_ORDER) {
          const record = records.get(role), service = services.find(item => item.role === role);
          if (!record || !service) continue;
          try { await rememberRetainedWorker(p, record); }
          catch (error) { failure ??= { code: codeOf(error), reason: 'WORKER_OBSERVATION_FAILED', role, at: stamp() }; }
          try { await stopProcess(record, service.stopSeconds);
            if (record.forced) failure ??= { code: 'ORIGINAL_MERCHANT_DRAIN_TIMEOUT', role, at: stamp() }; }
          catch (error) { failure ??= { code: codeOf(error), reason: 'CHILD_STOP_FAILED', role, at: stamp() }; }
          await retain();
        }
      } catch (error) {
        failure ??= { code: codeOf(error), reason: 'RUNTIME_STATUS_WRITE_FAILED', at: stamp() };
        for (const record of records.values()) {
          try { signalGroup(record, 'SIGKILL'); } catch { /* Continue closing every owned group. */ }
          try { await signalRetainedGroup(record, 'SIGKILL'); } catch { /* Continue closing every owned group. */ }
        }
      } finally {
        phase = failure ? 'FAILED' : 'STOPPED';
        await persist().catch(() => {});
        await lease.release();
        if (signals) { process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal); }
        const result = snapshot(); closedResolve(result); return result;
      }
    })();
    return stopPromise;
  };
  const onSignal = () => { void stop('SIGNAL'); };
  if (signals) { process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal); }

  async function launch(service, args, stage, env) {
    need(!stopping, 'CONTAINER_STOP_REQUESTED');
    need(Array.isArray(args) && args.length >= 2 && args.every(arg => typeof arg === 'string'),
      'ORIGINAL_MERCHANT_COMMAND_REQUIRED');
    let finish;
    const record = { role: service.role, stage, phase: stage === 'initialize' ? 'INITIALIZING' : 'STARTING',
      ready: false, startedAt: stamp(), exited: false, closed: new Promise(done => { finish = done; }) };
    // A distinct process group gives this owner systemd KillMode=mixed semantics:
    // TERM the original manager first, KILL its remaining group only on timeout.
    const child = spawn(args[0], args.slice(1), {
      cwd: p.sourceRoot, env, shell: false, detached: true, stdio: ['ignore', 'inherit', 'inherit'],
    });
    record.child = child; record.pid = child.pid; records.set(service.role, record);
    child.once('error', error => {
      record.exited = true; record.phase = 'FAILED'; record.exitedAt = stamp(); record.spawnError = error;
      finish();
      if (!stopping) void stop('CHILD_START_FAILED', error);
    });
    child.once('exit', (exitCode, signal) => {
      record.exited = true; record.ready = false; record.exitedAt = stamp();
      record.exitCode = exitCode; record.signal = signal; record.phase = exitCode === 0 ? 'STOPPED' : 'FAILED';
      finish();
      if (stage === 'run' && !stopping) {
        const error = new Error('ORIGINAL_MERCHANT_CHILD_EXITED');
        error.code = exitCode === 75 ? 'SF98_DELIVERY_BUSY' : 'ORIGINAL_MERCHANT_CHILD_EXITED';
        failure = { code: error.code, reason: 'CHILD_EXITED', role: service.role, exitCode, signal, at: stamp() };
        void stop('CHILD_EXITED', error);
      }
    });
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    await persist(); return record;
  }

  try {
    await persist();
    maintenance = await readMaintenanceMarker(p);
    need(readersOnly || !maintenance, 'MERCHANT_MAINTENANCE_ACTIVE');
    const env = await environment(p);
    if (services.some(service => service.role === 'seller')) await checkOAuthHostConnections(p, { env });
    await reservePorts(p);
    const deadline = Date.now() + startupTimeoutSeconds * 1000;
    for (const service of services) {
      need(!stopping, 'CONTAINER_STOP_REQUESTED');
      maintenance = await readMaintenanceMarker(p);
      need(readersOnly || !maintenance, 'MERCHANT_MAINTENANCE_ACTIVE');
      if (service.initialize) {
        const initialized = await launch(service, service.initialize, 'initialize', env);
        await until(initialized.closed, Math.max(0, deadline - Date.now()));
        need(initialized.exited && initialized.exitCode === 0 && !stopping, 'ORIGINAL_MERCHANT_INITIALIZATION_FAILED');
      }
      const record = await launch(service, service.args, 'run', env);
      while (!stopping && Date.now() < deadline && !await roleReady(p, record))
        await delay(150, undefined, { signal: controller.signal });
      need(!stopping && !record.exited && await roleReady(p, record), 'ORIGINAL_MERCHANT_STARTUP_FAILED');
      await rememberRetainedWorker(p, record);
      record.ready = true; record.phase = 'RUNNING'; await persist();
    }
    const { smoke } = await import('./cli.mjs');
    const readiness = await smoke(p.bundle);
    // The retained listener can open before SF82 publishes its own runtime
    // observation. The original smoke includes that manager/worker readback;
    // capture the detached worker only after this final native readiness seam.
    for (const record of records.values()) await rememberRetainedWorker(p, record);
    need(!p.release || records.get('seller')?.workerGroup, 'ORIGINAL_RETAINED_WORKER_REQUIRED');
    maintenance = await readMaintenanceMarker(p);
    need(readersOnly || !maintenance, 'MERCHANT_MAINTENANCE_ACTIVE');
    need(readiness.passed && !stopping, 'ORIGINAL_MERCHANT_READINESS_FAILED');
    phase = 'RUNNING'; await persist();
    return { runtimeId, merchant: p.merchant, mode: readersOnly ? 'readers' : 'all',
      readiness, closed, stop, status: snapshot };
  } catch (error) {
    const signalStop = stopping && !failure;
    await stop(signalStop ? 'SIGNAL_DURING_STARTUP' : 'STARTUP_FAILED', signalStop ? null : error);
    if (signalStop) return { runtimeId, merchant: p.merchant, mode: readersOnly ? 'readers' : 'all',
      readiness: null, closed, stop, status: snapshot };
    error.runtime = snapshot(); throw error;
  }
}

/** Block as the container foreground command until the original group closes. */
export async function runContainer(bundle, options = {}) {
  const session = await startContainer(bundle, options);
  return session.closed;
}

/** Observe from the running container's PID and hostname namespace. */
export async function containerStatus(bundle, { probe = true } = {}) {
  const p = await checkedBundle(bundle), directory = runtimePaths(p).directory;
  const maintenance = await readMaintenanceMarker(p);
  let saved, lease;
  try {
    saved = await jsonFile(join(directory, STATUS));
    lease = await inspectDeliveryLease(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schema: RUNTIME_SCHEMA, merchant: p.merchant, bundle: p.bundle,
      runtimeId: null, phase: 'STOPPED', ready: false, active: false, children: [], maintenance };
  }
  need(saved.schema === RUNTIME_SCHEMA && saved.merchant === p.merchant && Array.isArray(saved.children),
    'ORIGINAL_MERCHANT_RUNTIME_STATUS_REQUIRED');
  const sameNamespace = saved.host === hostname() && saved.pidNamespace === await readlink('/proc/self/ns/pid');
  const supervisor = sameNamespace && await processIdentity(saved.supervisorPid, saved.supervisorProcPid);
  const active = lease.active && lease.owner?.id === saved.leaseId &&
    lease.owner?.pid === saved.supervisorPid && sameNamespace && supervisor?.started === saved.supervisorStarted && alive(saved.supervisorPid);
  const children = saved.children.map(child => ({ ...child,
    alive: active && child.stage === 'run' && !child.exited && alive(child.pid) }));
  const currentBundle = saved.bundle === p.bundle;
  let readiness = null;
  let ready = active && currentBundle && saved.phase === 'RUNNING' &&
    (saved.mode === 'readers' || !maintenance) && children.every(child => child.alive && child.ready);
  if (probe && ready) {
    const { smoke } = await import('./cli.mjs');
    readiness = await smoke(p.bundle);
    for (const child of children) if (child.role === 'delivery' && !await roleReady(p, child)) ready = false;
    ready &&= readiness.passed;
  }
  return { ...saved, bundle: p.bundle, active, sameNamespace, currentBundle, ready, children, maintenance,
    observedAt: stamp(), ...(readiness ? { readiness } : {}) };
}

const HELP = `Merchant container runtime\n\n  run --bundle ORIGINAL_HOST_BUNDLE [--readers-only] [--startup-timeout-seconds 90]\n  status --bundle ORIGINAL_HOST_BUNDLE\n  health --bundle ORIGINAL_HOST_BUNDLE\n\nRun status and health inside the original container's process and hostname namespace.\nTERM/INT drains the original seller, then delivery and receiver/discovery services.\n`;
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP); return 0; }
  const [command, ...rest] = args;
  need(['run', 'status', 'health'].includes(command), HELP);
  const values = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    need(['--bundle', '--readers-only', '--startup-timeout-seconds'].includes(key) && !Object.hasOwn(values, key), HELP);
    if (key === '--readers-only') values[key] = true;
    else { need(rest[index + 1] && !rest[index + 1].startsWith('--'), HELP); values[key] = rest[++index]; }
  }
  need(values['--bundle'] && (command === 'run' || Object.keys(values).length === 1), HELP);
  if (command === 'run') {
    const raw = values['--startup-timeout-seconds'] ?? '90';
    need(/^[1-9][0-9]{0,2}$/.test(raw), 'INVALID_CONTAINER_STARTUP_TIMEOUT');
    const result = await runContainer(resolve(values['--bundle']), {
      readersOnly: !!values['--readers-only'], startupTimeoutSeconds: Number(raw),
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.failure?.code === 'SF98_DELIVERY_BUSY' ? 75 : result.phase === 'FAILED' ? 1 : 0;
  }
  const result = await containerStatus(resolve(values['--bundle']));
  process.stdout.write(JSON.stringify(result) + '\n');
  return command === 'health' && !result.ready ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ error: codeOf(error),
      ...(error.runtime ? { runtimeId: error.runtime.runtimeId, phase: error.runtime.phase,
        failure: error.runtime.failure } : {}) }) + '\n');
    process.exitCode = error.code === 'SF98_DELIVERY_BUSY' || error.runtime?.failure?.code === 'SF98_DELIVERY_BUSY' ? 75 : 1;
  });
