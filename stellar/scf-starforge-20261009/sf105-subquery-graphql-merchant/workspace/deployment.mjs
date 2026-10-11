// MIT. Saved operator workflow over the original GraphQL deployment/release APIs.
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, link, rm } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { prepareSubQueryDeployment, inspectSubQueryDeployment,
  stageSubQueryDeployment, prepareSubQueryHost } from '../deployment/compiler.mjs';
import { initReleaseStore, readReleaseState, inspectRelease, releaseStatus } from '../../sf82-seller-pilot/releases.mjs';
import { checkBundle } from '../../sf99-merchant-deploy/host.mjs';
import { readExport, verifyExport, fingerprints, verifyFiles } from './merchant.mjs';
import { digest, plain } from './store.mjs';

const SCHEMA = 'stellar-forge.graphql-workspace-deployment.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const recordPath = (directory, generation) => join(dirname(directory), 'workspace-deployment-' + generation + '.json');
const referenceFor = (record, bytes) => ({ id: record.id, exportId: record.exportId, generation: record.generation,
  createdAt: record.createdAt, updatedAt: record.updatedAt, directory: record.directory, recordSha256: digest(bytes) });
async function privateJson(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.mode & 0o077) fail('Deployment record must remain a bounded private regular file.');
  const bytes = await readFile(path);
  if (bytes.length > 8 * 1024 * 1024) fail('Deployment record exceeds 8 MiB.');
  return { bytes, record: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
}
async function writeRecord(record) {
  const text = json(record), path = recordPath(record.directory, record.generation);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail('Deployment record exceeds 8 MiB.');
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    await link(temporary, path);
    const folder = await open(dirname(path), 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await rm(temporary, { force: true }); }
  return { record, reference: referenceFor(record, text) };
}
export async function readDeployment(reference) {
  if (!plain(reference) || !isAbsolute(reference.directory) || !Number.isSafeInteger(reference.generation) || reference.generation < 1)
    fail('Choose a deployment retained in this project.');
  const { bytes, record } = await privateJson(recordPath(reference.directory, reference.generation));
  if (digest(bytes) !== reference.recordSha256 || record.schema !== SCHEMA || record.id !== reference.id ||
      record.exportId !== reference.exportId || record.generation !== reference.generation || record.directory !== reference.directory ||
      !Array.isArray(record.files) || !Array.isArray(record.hosts)) fail('Deployment record no longer matches this project.');
  return record;
}
async function verifyDeployment(record) {
  await verifyFiles(record.directory, record.files);
  return inspectSubQueryDeployment(record.directory);
}
export function deploymentView(record) {
  return { id: record.id, exportId: record.exportId, generation: record.generation, createdAt: record.createdAt,
    updatedAt: record.updatedAt, draftRevision: record.draftRevision, inputDigest: record.inputDigest,
    directory: record.directory, prepared: record.prepared, files: record.files, source: record.source,
    releaseStore: record.releaseStore, suggestedReleaseId: record.suggestedReleaseId,
    release: record.release ?? null, hosts: record.hosts };
}
async function pendingRecord(reference) {
  let next;
  try { next = await privateJson(recordPath(reference.directory, reference.generation + 1)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const nextReference = referenceFor(next.record, next.bytes), record = await readDeployment(nextReference);
  if (record.previousRecordSha256 !== reference.recordSha256 || record.id !== reference.id || record.exportId !== reference.exportId ||
      record.directory !== reference.directory || record.generation !== reference.generation + 1)
    fail('An interrupted operation does not continue this saved deployment.', 409);
  return { record, reference: nextReference };
}
async function updateDeployment(reference, action, work) {
  const record = await readDeployment(reference);
  const inspection = await verifyDeployment(record);
  const actionDigest = digest(json(action)), pending = await pendingRecord(reference);
  if (pending) {
    if (pending.record.actionDigest !== actionDigest) fail('A finished operation is retained. Recover it before preparing another.', 409);
    await verifyRetainedOperations(pending.record);
    return pending;
  }
  const changes = await work(record, inspection);
  return writeRecord({ ...record, ...changes, generation: record.generation + 1, updatedAt: new Date().toISOString(),
    previousRecordSha256: reference.recordSha256, actionDigest });
}
async function verifyRetainedOperations(record) {
  await verifyDeployment(record);
  if (record.release) {
    const release = await inspectRelease(record.releaseStore, record.release.id);
    if (release.digest !== record.release.digest) fail('The original staged release identity changed.');
  }
  // Generated files must be intact to recover the attachment. Provisioning and
  // source readiness remain visible separately through the original preflight.
  if (record.hosts.length) {
    const host = record.hosts.at(-1);
    await verifyFiles(host.directory, host.files);
  }
}
export async function prepareDeployment(store, saved, exportReference, { allowLoopbackUpstream = false } = {}) {
  if (typeof allowLoopbackUpstream !== 'boolean') fail('Invalid local-backend option.');
  const original = await readExport(exportReference); await verifyExport(original);
  const id = randomUUID(), task = join(store.deployments, saved.id + '-' + id.slice(0, 8));
  await mkdir(task, { mode: 0o700 });
  const directory = join(task, 'packet');
  const prepared = await prepareSubQueryDeployment({ merchantDirectory: original.directory, directory, allowLoopbackUpstream });
  await inspectSubQueryDeployment(directory);
  const now = new Date().toISOString();
  return writeRecord({ schema: SCHEMA, id, exportId: original.id, generation: 1, createdAt: now, updatedAt: now,
    draftRevision: original.draftRevision, inputDigest: original.inputDigest, directory, prepared,
    source: { directory: original.directory, recordSha256: exportReference.recordSha256,
      ...(original.evolution ? { baselineExportId: original.evolution.baselineExportId, revisionDirectory: original.evolution.directory } : {}) },
    files: await fingerprints(directory), releaseStore: join(store.releaseStores, saved.id),
    suggestedReleaseId: saved.id.slice(0, 32) + '-r' + original.draftRevision + '-' + id.slice(0, 8), hosts: [] });
}
export async function ensureDeploymentStore(record) {
  try { await lstat(record.releaseStore); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return initReleaseStore(record.releaseStore); }
  return readReleaseState(record.releaseStore);
}
async function existingStage(record, deployment, options) {
  let release;
  try { release = await inspectRelease(record.releaseStore, options.id); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  // The original stage can finish before the workspace attachment is written.
  // Adopt that exact release only after checking its native inputs and runtime.
  const runtime = { port: options.port ?? 8423, handlers: deployment.handlers };
  if (options.allowLocalFacilitator !== undefined && typeof options.allowLocalFacilitator !== 'boolean') fail('Invalid local facilitator option.');
  if (options.facilitator !== undefined) {
    const url = new URL(options.facilitator), local = options.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) fail('Use a credential-free HTTPS facilitator or explicitly selected loopback HTTP.');
    runtime.facilitator = url.href.replace(/\/$/, '');
  }
  if (options.allowLocalFacilitator) runtime.allowLocalFacilitator = true;
  const fields = [['specSha256', 'release-inputs/openapi.json'], ['selectionsSha256', 'release-inputs/selections.json'],
    ['serviceBindingsSha256', 'release-inputs/bindings.json'], ['serviceConfigSha256', 'release-inputs/service.json']];
  const matches = fields.every(([field, file]) => release.source[field] === deployment.hashes[file]);
  const keys = Object.keys(runtime);
  const label = options.label ?? options.id;
  if (typeof label !== 'string' || release.label !== label.trim() || !matches ||
      release.handlerEntry?.path !== deployment.handlers || release.handlerEntry.sha256 !== deployment.hashes['handlers.mjs'] ||
      Object.keys(release.runtime).length !== keys.length || !keys.every(key => release.runtime[key] === runtime[key]))
    fail('This release ID already belongs to different source or runtime options. Choose another release ID.', 409);
  return release;
}
export async function stageDeployment(reference, options) {
  if (!plain(options) || Object.keys(options).some(key => !['id', 'label', 'port', 'facilitator', 'allowLocalFacilitator'].includes(key)))
    fail('Choose original release ID, label, port and facilitator options.');
  return updateDeployment(reference, { kind: 'stage', options }, async (record, deployment) => {
    if (record.release) fail('This deployment already has a staged release. Open its release console or prepare another deployment.', 409);
    await ensureDeploymentStore(record);
    let release = await existingStage(record, deployment, options), result;
    if (!release) {
      try { result = await stageSubQueryDeployment({ directory: record.directory, store: record.releaseStore, ...options }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        release = await existingStage(record, deployment, options); if (!release) throw error;
      }
      release ??= await inspectRelease(record.releaseStore, options.id);
    }
    result ??= { directory: deployment.directory, identity: deployment.identity, store: record.releaseStore, release, recovered: true };
    return { release, stage: { options, result } };
  });
}
export async function prepareHost(reference, host) {
  if (!plain(host) || Buffer.byteLength(json(host)) > 131072 || ['kind', 'config', 'handlers', 'upstreams'].some(key => Object.hasOwn(host, key)))
    fail('Supply original host settings; merchant files and handlers come from the selected deployment.');
  return updateDeployment(reference, { kind: 'host', host }, async record => {
    // Failed original host preparation may retain its create-only input plan.
    // A corrected attempt gets a new destination without removing that input.
    const id = 'host-' + (record.generation + 1) + '-' + randomUUID().slice(0, 8), directory = join(dirname(record.directory), id);
    const prepared = await prepareSubQueryHost({ directory: record.directory, host, destination: directory });
    const files = await fingerprints(directory), runbooks = files.filter(file => file.name === 'RUNBOOK.md' || file.name.endsWith('/RUNBOOK.md'));
    if (runbooks.length !== 1) fail('The original host generator did not return a unique installation runbook.');
    const runbook = join(directory, runbooks[0].name);
    const native = (await privateJson(join(dirname(runbook), 'deployment.json'))).record;
    if (native.schema !== 'stellar-forge.merchant-host.v1' || native.bundle !== prepared.bundle)
      fail('The original generated host identity does not match its installation directory.');
    const retained = { id, createdAt: new Date().toISOString(), directory, host, prepared, files, runbook,
      identity: { merchant: native.merchant, mode: native.mode, publicOrigin: native.publicOrigin, target: native.target,
        sourceRoot: native.sourceRoot, services: native.services.map(service => service.unit) } };
    retained.readiness = await hostReadiness(retained);
    return { hosts: [...record.hosts, retained] };
  });
}
async function hostReadiness(host) {
  // Generation intentionally precedes provisioning of the private environment
  // file. Keep its runbook accessible and expose the original preflight result.
  try { await checkBundle(dirname(host.runbook)); return { ready: true }; }
  catch (error) { return { ready: false, error: error.message }; }
}
export async function recoverDeployment(reference) {
  const pending = await pendingRecord(reference);
  if (!pending) fail('No finished deployment operation needs recovery.', 404);
  await verifyRetainedOperations(pending.record); return pending;
}
export async function inspectDeployment(reference) {
  const record = await readDeployment(reference), inspection = await verifyDeployment(record);
  let status;
  try { status = await releaseStatus(record.releaseStore); }
  catch (error) { status = error.code === 'ENOENT' ? null : { unavailable: true, error: error.message }; }
  const hosts = await Promise.all(record.hosts.map(async host => {
    try { await verifyFiles(host.directory, host.files); return { ...host, verified: true, readiness: await hostReadiness(host) }; }
    catch (error) { return { ...host, unavailable: true, error: error.message }; }
  }));
  const pending = await pendingRecord(reference);
  return { ...deploymentView(record), hosts, inspection, releaseStatus: status,
    pending: pending ? { generation: pending.record.generation, updatedAt: pending.record.updatedAt,
      releaseId: pending.record.release?.id ?? null, hosts: pending.record.hosts.length } : null };
}
export async function readHostRunbook(reference, hostId) {
  const record = await readDeployment(reference); await verifyDeployment(record);
  const host = record.hosts.find(item => item.id === hostId);
  if (!host) fail('Choose a host packet retained in this deployment.', 404);
  await verifyFiles(host.directory, host.files);
  return { id: host.id, path: host.runbook, text: await readFile(host.runbook, 'utf8'), identity: host.identity,
    readiness: await hostReadiness(host) };
}
