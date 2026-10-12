// MIT. Durable original intent and recovery for the existing WebDAV native writer.
import { constants } from 'node:fs';
import { open, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { privateSupportDirectory, writePrivate } from './host-files.mjs';
import {
  WEBDAV_OPERATION_SCHEMA, WEBDAV_MUTATION_TOOLS, validateWebDavRequest,
  webDavHash, webDavCanonical, webDavJson, webDavJsonBytes, webDavUuid, webDavCount, webDavError
} from './webdav-workspace-contracts.mjs';

const FILE = 'operation.json';
const MAXIMUM = 32 * 1024 * 1024;
async function privateBytes(path) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAXIMUM || process.platform !== 'win32' && (stat.mode & 0o077))
      throw webDavError('WEBDAV_CLIENT_PRIVATE_FILE', 'Use the private original operation JSON.');
    const bytes = await file.readFile();
    if (bytes.length > MAXIMUM) throw webDavError('WEBDAV_CLIENT_OPERATION_LIMIT', 'The retained operation exceeds its original file limit.');
    return bytes;
  } finally { await file.close(); }
}
function intentFingerprint(value) {
  return webDavHash(Buffer.from(webDavCanonical({ endpoint: value.endpoint, workspaceId: value.workspaceId,
    tool: value.tool, args: value.args, profileBinding: value.profileBinding })));
}
function validateRecord(value) {
  if (value?.schema !== WEBDAV_OPERATION_SCHEMA || !WEBDAV_MUTATION_TOOLS.includes(value.tool)
      || typeof value.endpoint !== 'string' || !value.endpoint || value.endpoint.length > 4096
      || /[\0\r\n]/.test(value.endpoint) || !Array.isArray(value.observations))
    throw webDavError('WEBDAV_CLIENT_OPERATION_INVALID', 'Open the original complete WebDAV client operation.');
  webDavUuid(value.workspaceId); webDavUuid(value.id);
  const args = validateWebDavRequest(value.tool, value.args);
  const kind = value.tool === 'merchant_webdav_source' ? 'source' : value.tool === 'merchant_webdav_merchant' ? 'merchant' : null;
  const binding = value.profileBinding;
  if (kind ? !binding || binding.kind !== kind || binding.profile !== args.profile
      || webDavHash(Buffer.from(webDavCanonical(binding.value))) !== binding.sha256 : binding !== null)
    throw webDavError('WEBDAV_CLIENT_PROFILE_CHANGED', 'Retain the exact reviewed host profile with this original operation.');
  if (args.operationId !== value.id || args.workspace !== value.workspace
      || intentFingerprint(value) !== value.requestSha256)
    throw webDavError('WEBDAV_CLIENT_OPERATION_CHANGED', 'The original operation ID and reviewed input must stay together.');
  return value;
}
async function readRecord(root) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(join(root, FILE)))); }
  catch (error) {
    if (error.code) throw error;
    throw webDavError('WEBDAV_CLIENT_OPERATION_INVALID', 'The saved operation must be complete UTF-8 JSON.');
  }
  return validateRecord(value);
}
async function syncDirectory(root) {
  const fd = await open(root, constants.O_RDONLY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function saveRecord(root, lease, record) {
  validateRecord(record); lease.assertHeld();
  const bytes = webDavJsonBytes(record);
  if (bytes.length > MAXIMUM) throw webDavError('WEBDAV_CLIENT_OPERATION_LIMIT', 'Retain this original operation before adding more observations.');
  const temporary = join(root, '.operation-' + randomUUID() + '.json');
  try {
    await writePrivate(temporary, bytes); lease.assertHeld();
    await rename(temporary, join(root, FILE)); await syncDirectory(root);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function locked(directory, create, action) {
  if (typeof directory !== 'string' || !directory || resolve(directory) === '/')
    throw webDavError('WEBDAV_CLIENT_OPERATION_DIRECTORY', 'Choose an invocation-owned private directory for this original intent.');
  const root = resolve(directory);
  if (create) await mkdir(root, { mode: 0o700 });
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw webDavError('WEBDAV_CLIENT_OPERATION_DIRECTORY', 'Use the canonical private operation directory.');
  const lease = await acquireStateLease(root);
  let failure;
  try { return await action(root, lease); }
  catch (error) { failure = error; throw error; }
  finally {
    try { await lease.close(); }
    catch (error) {
      if (!failure) throw error;
      failure.localLeaseError = { code: error.code, message: error.message };
    }
  }
}
function observe(record, phase, detail = {}) {
  if (record.observations.length >= 1024)
    throw webDavError('WEBDAV_CLIENT_OPERATION_HISTORY_LIMIT', 'This original operation retains its complete 1024-observation history.');
  record.observations.push({ at: new Date().toISOString(), phase, ...detail });
}
async function profileBinding(client, tool, args, options) {
  if (!['merchant_webdav_source','merchant_webdav_merchant'].includes(tool)) return null;
  const status = await client.status({}, options);
  const workspace = status.workspaces?.find(row => row.workspace === args.workspace);
  const source = tool === 'merchant_webdav_source';
  const selected = workspace?.[source ? 'sourceProfiles' : 'merchantProfiles']?.find(row => row.profile === args.profile);
  if (!selected) throw webDavError('WEBDAV_CLIENT_PROFILE_MISSING', 'Select the original host-declared source or merchant profile.');
  const value = source ? selected.source : { origin: selected.origin, path: selected.path, payment: selected.payment };
  return { kind: source ? 'source' : 'merchant', profile: args.profile,
    sha256: webDavHash(Buffer.from(webDavCanonical(value))), value: webDavJson(value) };
}
export async function prepareWebDavOperation({
  client, directory, tool, args: input
}, options = {}) {
  if (!WEBDAV_MUTATION_TOOLS.includes(tool)) throw webDavError('WEBDAV_CLIENT_OPERATION_TOOL', 'Prepare an original revision-bound WebDAV mutation.');
  const args = webDavJson(input, 1024 * 1024);
  const status = await client.status({ workspace: args.workspace }, options);
  if (status.state !== 'OPEN' || !status.native?.id) throw webDavError('WEBDAV_CLIENT_WORKSPACE_CLOSED', 'Open the original workspace before reviewing a new operation.');
  args.operationId ??= randomUUID(); args.expectedRevision ??= status.native.revision;
  validateWebDavRequest(tool, args);
  if (args.expectedRevision !== status.native.revision)
    throw webDavError('WEBDAV_STALE_REVISION', 'Prepare the operation against the actual displayed native revision.');
  const binding = await profileBinding(client, tool, args, options);
  const record = { schema: WEBDAV_OPERATION_SCHEMA, id: args.operationId, endpoint: client.endpoint,
    workspace: args.workspace, workspaceId: webDavUuid(status.native.id), tool, args,
    profileBinding: binding,
    createdAt: new Date().toISOString(), state: 'PREPARED', observations: [], lastNative: null };
  record.requestSha256 = intentFingerprint(record);
  return locked(directory, true, async (root, lease) => {
    observe(record, 'PREPARED', { nativeRevision: status.native.revision });
    await saveRecord(root, lease, record);
    return { directory: root, ...record };
  });
}
export async function inspectWebDavOperation({ directory } = {}) {
  const root = resolve(directory); await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw webDavError('WEBDAV_CLIENT_OPERATION_DIRECTORY', 'Use the canonical original operation directory.');
  return { directory: root, ...await readRecord(root) };
}
async function inspectNative(client, record, options) {
  if (client.endpoint !== record.endpoint)
    throw webDavError('WEBDAV_CLIENT_ENDPOINT_CHANGED', 'Continue this original operation at its selected merchant endpoint.');
  const status = await client.assertWorkspace({ workspace: record.workspace, workspaceId: record.workspaceId }, options);
  let native = null;
  try { native = await client.operation({ workspace: record.workspace, kind: 'operation', id: record.id }, options); }
  catch (error) { if (error.code !== 'WEBDAV_OPERATION_NOT_FOUND') throw error; }
  return { status, native };
}
function nativePhase(native) {
  if (!native) return 'NOT_RECORDED';
  if (native.operation?.status === 'COMPLETE') return 'COMPLETE';
  if (native.operation?.status === 'FAILED') return 'FAILED';
  if (native.active === true || native.pending === true) return 'PENDING';
  if (native.operation?.action === 'publisher.act') return 'NATIVE_RECONCILE_REQUIRED';
  return 'RESUME_AVAILABLE';
}
export async function reconcileWebDavOperation({ client, directory }, options = {}) {
  return locked(directory, false, async (root, lease) => {
    const record = await readRecord(root), { status, native } = await inspectNative(client, record, options);
    record.state = nativePhase(native); record.lastNative = native;
    observe(record, 'RECONCILED', { nativeRevision: status.native.revision, nativeState: record.state });
    await saveRecord(root, lease, record);
    return { directory: root, ...record };
  });
}
/** An explicit call continues one frozen intent; an uncertain response never creates a new ID. */
export async function runWebDavOperation({
  client, directory, resume = false, reviewedRevision
}, options = {}) {
  return locked(directory, false, async (root, lease) => {
    const record = await readRecord(root), { status, native } = await inspectNative(client, record, options);
    const phase = nativePhase(native);
    if (phase !== 'NOT_RECORDED' && !(phase === 'RESUME_AVAILABLE' && resume)) {
      record.state = phase; record.lastNative = native;
      observe(record, 'RECONCILED', { nativeRevision: status.native.revision, nativeState: phase });
      await saveRecord(root, lease, record);
      return { directory: root, ...record };
    }
    const currentProfile = await profileBinding(client, record.tool, record.args, options);
    if (webDavCanonical(currentProfile) !== webDavCanonical(record.profileBinding))
      throw webDavError('WEBDAV_CLIENT_PROFILE_CHANGED', 'The selected original source or merchant profile changed. Retain this intent and explicitly review the new profile.');
    const args = webDavJson(record.args, 1024 * 1024);
    if (reviewedRevision !== undefined) {
      webDavCount(reviewedRevision, 'Reviewed native revision');
      if (reviewedRevision !== status.native.revision)
        throw webDavError('WEBDAV_STALE_REVISION', 'The explicitly reviewed native revision is no longer current.');
      args.expectedRevision = reviewedRevision;
    }
    record.state = 'SUBMITTING';
    observe(record, 'SUBMITTING', { nativeRevision: status.native.revision, expectedRevision: args.expectedRevision,
      resumedOriginal: phase === 'RESUME_AVAILABLE' });
    await saveRecord(root, lease, record);
    let result;
    try { result = await client.request(record.tool, args, options); }
    catch (error) {
      record.state = error.nativeEnvelope?.operation?.status === 'COMPLETE' ? 'COMPLETE_RESULT_UNREAD'
        : error.applied === false ? 'NOT_APPLIED' : 'RESPONSE_UNCERTAIN';
      if (error.nativeEnvelope) record.lastNative = error.nativeEnvelope;
      observe(record, record.state, { code: error.code ?? 'TRANSPORT_ERROR' });
      try { await saveRecord(root, lease, record); }
      catch (saveError) { error.localSaveError = { code: saveError.code, message: saveError.message }; }
      error.operation = { directory: root, id: record.id, workspace: record.workspace,
        requestSha256: record.requestSha256, state: record.state };
      throw error;
    }
    record.lastNative = result;
    record.state = result.operation?.status === 'COMPLETE' ? 'COMPLETE' : result.pending ? 'PENDING' : 'INSPECT_NATIVE';
    observe(record, 'NATIVE_RESPONSE', { nativeState: record.state, nativeRevision: result.state?.revision });
    try { await saveRecord(root, lease, record); }
    catch (error) {
      // The original remote result is concrete even if local storage fails after it.
      error.operation = { directory: root, id: record.id, workspace: record.workspace, state: record.state };
      error.nativeResult = result; throw error;
    }
    return { directory: root, ...record };
  });
}
