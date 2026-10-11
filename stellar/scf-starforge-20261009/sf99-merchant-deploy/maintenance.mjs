// MIT. Original merchant quiesce, encrypted recovery, restored-host activation.
import { mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireDeliveryLease } from '../sf98-merchant-delivery/delivery-lock.mjs';
import { run as recover } from '../sf101-merchant-recovery/recover.mjs';
import { checkBundle } from './host.mjs';
import { prepareRestoredHost } from './restore-host.mjs';
import { loadWriterTemplates, prepareRestoredWriters } from './restore-writers.mjs';
import { loadMaintenance, createLinuxHost, atomicJSON, atomicFile, removeOwned, jsonFile,
  regular, digest, inside, absolute, need, privateDirectory, MAINTENANCE_SCHEMA } from './maintenance-system.mjs';

const OPERATION_SCHEMA = 'stellar-forge.merchant-maintenance-operation.v1';
const terminal = state => ['COMPLETE','ROLLED_BACK'].includes(state.phase);
const beforeCommit = state => !['COMMITTED','COMPLETE'].includes(state.phase);
const activeFile = plan => join(plan.operationsRoot, 'active-operation.json');
const markerFile = (plan, id) => join(plan.operationsRoot, id, 'paused');
const stateFile = (plan, id) => join(plan.operationsRoot, id, 'operation.json');
const idOf = id => { need(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id), 'Stable operation ID required'); return id; };
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const stamp = () => new Date().toISOString();

async function save(plan, state, phase = state.phase) {
  state.phase = phase; state.updatedAt = stamp();
  await atomicJSON(stateFile(plan, state.id), state);
}
function summary(state) {
  return { merchant: state.merchant, operationId: state.id, command: state.command, phase: state.phase,
    snapshot: state.snapshot ?? null, restoredHost: state.candidate ? { bundle: state.candidate.bundle,
      planFile: state.candidate.planFile, stateRoot: state.candidate.stateRoot, summary: state.candidate.summary } : null,
    activeBundle: state.phase === 'COMPLETE' ? state.candidate?.bundle ?? state.originalBundle : state.phase === 'ROLLED_BACK' ? state.originalBundle : null,
    nextMaintenancePlan: terminal(state) ? state.phase === 'COMPLETE' ? state.nextPlan ?? state.maintenancePlan : state.maintenancePlan : null,
    createdAt: state.createdAt, updatedAt: state.updatedAt,
    ...(state.lastError ? { lastError: state.lastError } : {}), paidRequestsExecuted: 0 };
}
async function ownedState(plan, id) {
  const state = await jsonFile(stateFile(plan, id));
  need(state.schema === OPERATION_SCHEMA && state.id === id && state.merchant === plan.p.merchant &&
    state.planDigest === plan.planDigest && state.recoveryDigest === plan.recoveryDigest,
    'Resume with this operation\'s unchanged original maintenance and recovery plans');
  return state;
}
async function clearActive(plan, state) {
  const file = activeFile(plan);
  if (await exists(file)) {
    const bytes = await regular(file), current = JSON.parse(bytes);
    need(current.id === state.id, 'Another maintenance operation owns this host');
    await removeOwned(file, digest(bytes));
  }
}

async function begin(plan, host, { id, command, destination, sourceRoot }) {
  const active = activeFile(plan);
  if (await exists(active)) {
    const previous = await jsonFile(active);
    const prior = await jsonFile(stateFile(plan, idOf(previous.id)));
    need(prior.schema === OPERATION_SCHEMA && prior.id === previous.id && prior.merchant === plan.p.merchant,
      'Unexpected original operation pointer');
    need(terminal(prior), 'An unfinished operation already owns this host; resume or roll back ' + previous.id);
    await clearActive(plan, prior);
  }
  if (command === 'migrate') {
    destination = absolute(destination, 'new restored host destination');
    need(!await exists(destination), 'Restored host destination must be new');
    for (const directory of [plan.operationsRoot, plan.p.sourceRoot, plan.p.bundle, ...plan.recovery.roots.map(r => r.path)])
      need(!inside(directory, destination) && !inside(destination, directory), 'Restored destination overlaps an original host component');
    if (sourceRoot !== undefined) absolute(sourceRoot, 'selected immutable source release');
  } else need(destination === undefined && sourceRoot === undefined, 'Backup does not select a restored host destination');
  need(typeof process.env[plan.passphraseEnv] === 'string' && Buffer.byteLength(process.env[plan.passphraseEnv]) >= 16,
    'Supply the original SF101 private passphrase environment before starting maintenance');
  const originalStates = await host.validateInstalled();
  const writerTemplates = command === 'migrate' ? await loadWriterTemplates(plan) : null;
  if (writerTemplates?.units.length) await host.validateWriters(writerTemplates, originalStates);
  const directory = join(plan.operationsRoot, id);
  await mkdir(directory, { mode: 0o700 });
  const state = { schema: OPERATION_SCHEMA, id, merchant: plan.p.merchant, command,
    maintenancePlan: plan.file, planDigest: plan.planDigest, recoveryDigest: plan.recoveryDigest,
    originalBundle: plan.p.bundle, originalStates, writerTemplates, destination, sourceRoot: sourceRoot ?? plan.p.sourceRoot,
    phase: 'PREPARED', createdAt: stamp(), updatedAt: stamp(), snapshots: [], restoreAttempts: [] };
  // Retain the exact original inputs for an operator after a machine interruption.
  await atomicFile(join(directory, 'original-host-plan.json'), await regular(plan.p.planFile));
  await atomicFile(join(directory, 'recovery-plan.json'), await regular(plan.recoveryPlan));
  await atomicFile(markerFile(plan, id), id + '\n');
  await save(plan, state);
  await atomicJSON(active, { schema: OPERATION_SCHEMA, merchant: state.merchant, id });
  return state;
}

async function leaseOutbox(directory) {
  if (!await exists(directory)) return null;
  return await acquireDeliveryLease(directory, { purpose: 'drain' });
}
async function requiredOutboxLease(p) {
  const lease = await leaseOutbox(p.outbox);
  need(lease || !p.delivery && p.mode === 'challenge', 'Original native/delivery outbox is missing: ' + p.outbox);
  return lease;
}
async function rollback(plan, host, state) {
  need(beforeCommit(state), 'This operation committed its restored state; resume it or migrate forward from that active state');
  state.rollbackRequested = true; await save(plan, state);
  const marker = markerFile(plan, state.id);
  const fragments = [plan.p.artifacts.Caddyfile];
  if (state.candidate) fragments.push((await checkBundle(state.candidate.bundle)).artifacts.Caddyfile);
  await host.pause(state.id, fragments);
  await host.guards(plan.units, marker, true);
  await host.stop();
  let originalLease, candidateLease;
  try {
    originalLease = await requiredOutboxLease(plan.p);
    if (state.candidate) {
      const candidate = await checkBundle(state.candidate.bundle);
      // A damaged/incomplete candidate must not prevent recovery of the intact
      // original. Any existing candidate queue is still exclusively held.
      if (candidate.outbox !== plan.p.outbox) candidateLease = await leaseOutbox(candidate.outbox);
    }
    await host.install(plan.p.bundle, state.candidate?.bundle);
    if (state.writerTemplates?.units.length) await host.restoreWriters(state.writerTemplates, state.candidate?.writers);
  } finally { await candidateLease?.release(); await originalLease?.release(); }
  await host.startOriginalGroup(state.originalStates, marker);
  await host.smoke(plan.p.bundle);
  await host.expose(plan.p.bundle, state.id);
  await host.smoke(plan.p.bundle, true);
  await removeOwned(marker, digest(state.id + '\n'));
  await save(plan, state, 'ROLLED_BACK'); await clearActive(plan, state);
  return summary(state);
}

async function continueOperation(plan, host, state) {
  if (terminal(state)) { await clearActive(plan, state); return summary(state); }
  if (state.rollbackRequested) return rollback(plan, host, state);
  const marker = markerFile(plan, state.id), directory = join(plan.operationsRoot, state.id);
  let originalLease = null, restoredLease = null;
  const release = async () => {
    await restoredLease?.release(); restoredLease = null;
    await originalLease?.release(); originalLease = null;
  };
  try {
    if (beforeCommit(state)) {
      // Resume reasserts the actual paused surface and kernel/process state. A
      // journal phase alone is never substituted for stopping the owned writers.
      await host.pause(state.id, [plan.p.artifacts.Caddyfile]);
      await host.guards(plan.units, marker, true);
      await host.stop();
      originalLease = await requiredOutboxLease(plan.p);
      await host.assertStopped();
      if (state.phase === 'PREPARED') await save(plan, state, 'QUIESCED');
    }
    if (state.phase === 'QUIESCED') {
      const out = join(directory, 'snapshot-' + (state.snapshots.length + 1));
      state.snapshots.push(out); await save(plan, state);
      const snapshot = await recover(['snapshot','--plan',join(directory,'recovery-plan.json'),'--out',out,
        '--pass-env',plan.passphraseEnv,'--quiesced']);
      const verified = await recover(['verify','--bundle',out,'--pass-env',plan.passphraseEnv]);
      need(snapshot.status === 'SNAPSHOT_CREATED' && verified.status === 'SNAPSHOT_VERIFIED', 'Original encrypted snapshot was not verified');
      await host.assertStopped();
      state.snapshot = { ...snapshot, verified: true }; await save(plan, state, 'SNAPSHOT');
    }
    if (state.phase === 'SNAPSHOT' && state.command === 'migrate') {
      const attempt = state.restoreAttempts.length;
      const destination = attempt === 0 ? state.destination : state.destination + '.resume-' + attempt;
      need(attempt < 32, 'Review retained interrupted destination attempts before another recovery');
      state.restoreAttempts.push(destination); await save(plan, state);
      state.candidate = await prepareRestoredHost({ previousBundle: plan.p.bundle,
        recoveryPlan: join(directory,'recovery-plan.json'), snapshot: state.snapshot.bundle,
        passphraseEnv: plan.passphraseEnv, destination, sourceRoot: state.sourceRoot });
      for (const field of ['bundle','planFile','stateRoot']) need(inside(destination, absolute(state.candidate[field])),
        'Restored host result leaves its new destination: ' + field);
      if (state.writerTemplates?.units.length) state.candidate.writers = await prepareRestoredWriters({
        templates: state.writerTemplates, mappings: state.candidate.mappings, destination });
      state.activeDestination = destination; await save(plan, state, 'RESTORED');
    }
    if (state.phase === 'RESTORED') {
      await host.grantRestoredAccess(state.activeDestination, state.candidate);
      await host.install(state.candidate.bundle);
      if (state.candidate.writers) await host.installWriters(state.candidate.writers, state.candidate.bundle);
      await save(plan, state, 'INSTALLED');
    }
    if (state.phase === 'INSTALLED') {
      const next = await checkBundle(state.candidate.bundle);
      restoredLease = await requiredOutboxLease(next);
      await host.startReaders(state.candidate.bundle, marker);
      state.readiness = await host.smoke(state.candidate.bundle);
      await save(plan, state, 'READY');
    } else if (state.phase === 'READY') {
      const next = await checkBundle(state.candidate.bundle);
      restoredLease = await requiredOutboxLease(next);
      await host.startReaders(state.candidate.bundle, marker);
      state.readiness = await host.smoke(state.candidate.bundle);
    }
    if (state.phase === 'READY' || state.phase === 'SNAPSHOT' && state.command === 'backup') {
      // External delivery may resume immediately after this durable transition.
      // From here every retry repairs forward against the chosen active state.
      if (state.candidate) {
        state.nextPlan = join(state.activeDestination, 'maintenance.json');
        const roots = state.candidate.mappings.map(mapping => ({ name: mapping.name, path: mapping.to }));
        const distinct = roots.filter((root, index) => !roots.some((other, otherIndex) => otherIndex !== index &&
          inside(other.path, root.path) && (other.path !== root.path || otherIndex < index)));
        const recoveryPlan = join(state.activeDestination, 'recovery-plan.json');
        await atomicJSON(recoveryPlan, { schema: 'stellar-forge.merchant-recovery-plan.v1', roots: distinct });
        const next = { ...plan.raw, bundle: state.candidate.bundle, recoveryPlan,
          ...(state.candidate.writers ? { writerTemplates: state.candidate.writers.nextTemplates } : {}) };
        await atomicJSON(state.nextPlan, next);
      }
      await save(plan, state, 'COMMITTED');
    }
    if (state.phase === 'COMMITTED') {
      const bundle = state.candidate?.bundle ?? plan.p.bundle;
      await release();
      await host.startOriginalGroup(state.originalStates, marker);
      await host.smoke(bundle);
      await host.expose(bundle, state.id);
      state.publicReadiness = await host.smoke(bundle, true);
      await removeOwned(marker, digest(state.id + '\n'));
      delete state.lastError;
      await save(plan, state, 'COMPLETE'); await clearActive(plan, state);
    }
    need(terminal(state), 'Unknown merchant operation phase');
    return summary(state);
  } catch (error) {
    await release();
    state.lastError = { at: stamp(), message: String(error.message).slice(0, 600) };
    await save(plan, state);
    if (beforeCommit(state)) {
      try { await rollback(plan, host, state); }
      catch (rollbackError) { state.rollbackError = { at: stamp(), message: String(rollbackError.message).slice(0, 600) }; await save(plan, state); }
    }
    const result = new Error('MAINTENANCE_' + state.phase + ': ' + error.message);
    result.operation = summary(state); throw result;
  } finally { await release(); }
}

/** The host adapter is injectable for an original-process container journey. */
export async function runMaintenance(planFile, options, { host: suppliedHost } = {}) {
  const command = options.command;
  need(['inspect','status','backup','migrate','resume','rollback'].includes(command), 'Unknown maintenance command');
  if (command === 'status') {
    // Status remains readable when an installed component needs repair. It does
    // not load services, re-read merchant credentials, or require decryption.
    const file = absolute(planFile, 'maintenance plan'), raw = await jsonFile(file);
    need(raw.schema === MAINTENANCE_SCHEMA, 'Original merchant maintenance plan required');
    await privateDirectory(absolute(raw.operationsRoot, 'operationsRoot'));
    const state = await jsonFile(join(raw.operationsRoot, idOf(options.id), 'operation.json'));
    need(state.schema === OPERATION_SCHEMA && state.id === options.id && state.maintenancePlan === file, 'Original operation does not belong to this plan');
    return summary(state);
  }
  const plan = await loadMaintenance(planFile);
  const host = suppliedHost ?? createLinuxHost(plan);
  if (command === 'inspect') return { merchant: plan.p.merchant, bundle: plan.p.bundle,
    operationsRoot: plan.operationsRoot, units: plan.units, recoveryRoots: plan.recovery.roots,
    installed: await host.validateInstalled(), environmentValuesRead: false };
  const id = idOf(options.id);
  // Reuse the original Linux flock primitive in a SEPARATE operation directory.
  // Original outbox ownership is acquired only after its actual services stop.
  const operationLease = await acquireDeliveryLease(plan.operationsRoot, { purpose: 'drain' });
  try {
    let state;
    if (['backup','migrate'].includes(command)) state = await begin(plan, host, { ...options, id });
    else {
      state = await ownedState(plan, id);
      if (await exists(activeFile(plan))) need((await jsonFile(activeFile(plan))).id === id, 'Another operation owns this merchant');
      else if (!terminal(state)) await atomicJSON(activeFile(plan), { schema: OPERATION_SCHEMA, merchant: state.merchant, id });
    }
    if (command === 'rollback') return terminal(state) ? summary(state) : await rollback(plan, host, state);
    return await continueOperation(plan, host, state);
  } finally { await operationLease.release(); }
}
