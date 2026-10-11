// Authenticated peer/job admission over the single retained reconciliation service.
import { join, dirname } from 'node:path';
import { openReconciliationService } from '../service/service.mjs';
import { SHA, JOB, need, privateDirectory, readPrivate, atomic } from './custody.mjs';

const PROVIDER_SCHEMA = 'erp-reconciliation.agx-provider.v1';
const BINDING_SCHEMA = 'erp-reconciliation.agx-binding.v1';
// Retain a few original service handles so their verified report buffers are
// reused across chunks. Admission still checks current private custody below.
const services = new Map();
async function ensure(path) {
  try { await privateDirectory(path, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
}
function identity(peer, jobId) {
  need(typeof peer === 'string' && SHA.test(peer), 'INVALID_PEER');
  if (jobId !== undefined) need(typeof jobId === 'string' && JOB.test(jobId), 'INVALID_JOB_ID');
}
export function peerDirectory(root, peer) { identity(peer); return join(root, 'peers', peer, 'service'); }

async function provider(root) {
  await privateDirectory(root);
  await privateDirectory(join(root, 'peers'));
  const config = JSON.parse(await readPrivate(join(root, 'provider.json'), 4096));
  need(config.schema === PROVIDER_SCHEMA, 'INVALID_PROVIDER_CONFIGURATION');
}

export async function initializePeer(root, peer, limits = {}) {
  identity(peer);
  await ensure(root); await ensure(join(root, 'peers'));
  try { await atomic(join(root, 'provider.json'), { schema: PROVIDER_SCHEMA }, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await provider(root);
  const directory = join(root, 'peers', peer);
  await ensure(directory); await ensure(join(directory, 'bindings'));
  const service = await openReconciliationService({ directory: peerDirectory(root, peer), ...limits });
  return { schema: PROVIDER_SCHEMA, peer, directory: peerDirectory(root, peer), configuration: service.configuration };
}

export async function openPeer(root, peer) {
  identity(peer); await provider(root);
  const directory = join(root, 'peers', peer);
  await privateDirectory(directory); await privateDirectory(join(directory, 'bindings'));
  await privateDirectory(peerDirectory(root, peer));
  await readPrivate(join(peerDirectory(root, peer), 'service.json'), 4096);
  const key = peerDirectory(root, peer);
  let opening = services.get(key);
  if (!opening) {
    opening = openReconciliationService({ directory: key });
    services.set(key, opening);
    opening.catch(() => { if (services.get(key) === opening) services.delete(key); });
  } else { services.delete(key); services.set(key, opening); }
  while (services.size > 4) services.delete(services.keys().next().value);
  const service = await opening;
  return { service, directory, peer };
}

export async function stageForPeer(root, peer, { jobId, source, target, spec, requestOut }) {
  identity(peer, jobId);
  need(typeof jobId === 'string' && JOB.test(jobId), 'INVALID_JOB_ID');
  if (requestOut) await privateDirectory(dirname(requestOut));
  const { service, directory } = await openPeer(root, peer);
  const bundle = await service.stageBundle({ source, target, spec });
  try {
    const existing = await service.getJob(jobId);
    need(existing.bundleId === bundle.bundleId, 'JOB_INPUT_CONFLICT');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const path = join(directory, 'bindings', jobId + '.json');
  const value = { schema: BINDING_SCHEMA, peer, jobId, bundleId: bundle.bundleId, createdAt: new Date().toISOString() };
  let reused = false;
  try { await atomic(path, value, true); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = JSON.parse(await readPrivate(path, 4096));
    need(retained.schema === BINDING_SCHEMA && retained.peer === peer && retained.jobId === jobId && retained.bundleId === bundle.bundleId, 'JOB_INPUT_CONFLICT');
    reused = true;
  }
  const request = { jobId, bundleId: bundle.bundleId };
  if (requestOut) await atomic(requestOut, request, true);
  return { schema: BINDING_SCHEMA, peer, state: 'STAGED', reused, request, directory: peerDirectory(root, peer) };
}

export async function authorizedJob(root, peer, { jobId, bundleId }) {
  identity(peer, jobId); need(typeof jobId === 'string' && JOB.test(jobId), 'INVALID_JOB_ID');
  need(typeof bundleId === 'string' && SHA.test(bundleId), 'INVALID_BUNDLE_ID');
  const selected = await openPeer(root, peer);
  const binding = JSON.parse(await readPrivate(join(selected.directory, 'bindings', jobId + '.json'), 4096));
  need(binding.schema === BINDING_SCHEMA && binding.peer === peer && binding.jobId === jobId && binding.bundleId === bundleId, 'JOB_INPUT_CONFLICT');
  return selected.service;
}
