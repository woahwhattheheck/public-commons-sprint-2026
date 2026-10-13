// MIT. Receiving and operating setup over the original Applications and mastering owners.
import { realpath, lstat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inspectMerchantRuntime } from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { openRuntimeWorkspace } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import { initReleaseStore } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { readMerchantConfig } from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import { absolute, makePrivate, privateDirectory, regular, readJSON, saveJSON, operationLease,
  operationId, canonical, json, digest, need, plain } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export const PRODUCT_SCHEMA = 'stellar-forge.record-mastering-product.v1';
export const REQUEST_SCHEMA = 'stellar-forge.record-mastering-product-request.v1';
const NATIVE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/';
const FIELDS = ['schema', 'runtimeDirectory', 'runtimeWorkspaceDirectory', 'workspaceDirectory', 'label', 'alias', 'port', 'environmentFile', 'inputs', 'applicationId', 'expectedRevision'];
const hash = value => digest(json(canonical(value)));
const aliasPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const sourceBinding = runtime => Object.fromEntries(
  ['directory', 'installationId', 'profileId', 'profileSha256', 'lockSha256', 'sourceCommit', 'sourceManifestSha256']
    .map(key => [key, runtime[key]]));
const problem = error => ({ code: error.code ?? 'MASTERING_PRODUCT_ERROR', message: String(error.message ?? error).slice(0, 2000) });

async function folder(path, create = false) {
  path = absolute(path);
  if (create) try { await makePrivate(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
async function locked(directory, create, work) {
  const root = await folder(directory, create), lease = await operationLease(join(root, 'product.lock'));
  try { return await work(root); } finally { await lease.close(); }
}
async function retain(path, value) {
  const previous = await readJSON(path, true);
  if (previous) { need(hash(previous) === hash(value), 'MASTERING_PRODUCT_FILE_CHANGED'); return previous; }
  await saveJSON(path, value); return value;
}
async function record(root) {
  const value = await readJSON(join(root, 'product.json'));
  need(value.schema === PRODUCT_SCHEMA && value.directory === root &&
    digestPattern.test(value.requestSha256) && hash(value.request) === value.requestSha256,
    'MASTERING_PRODUCT_RECORD_CHANGED');
  operationId(value.saveRequestId); return value;
}
function request(value) {
  need(plain(value) && value.schema === REQUEST_SCHEMA &&
    Object.keys(value).every(key => FIELDS.includes(key)), 'MASTERING_PRODUCT_REQUEST_INVALID');
  const result = { ...value };
  for (const field of ['runtimeDirectory', 'runtimeWorkspaceDirectory', 'workspaceDirectory'])
    result[field] = absolute(value[field]);
  need(typeof value.label === 'string' && value.label.trim() && value.label.length <= 120,
    'MASTERING_PRODUCT_LABEL_REQUIRED');
  need(typeof value.alias === 'string' && aliasPattern.test(value.alias), 'MASTERING_PRODUCT_ALIAS_REQUIRED');
  result.label = value.label.trim();
  result.port = value.port ?? 0;
  need(Number.isSafeInteger(result.port) && result.port >= 0 && result.port <= 65535, 'MASTERING_PRODUCT_PORT_INVALID');
  if (value.environmentFile !== undefined) result.environmentFile = absolute(value.environmentFile);
  result.inputs = value.inputs ?? {};
  need(plain(result.inputs) && Object.keys(result.inputs).length <= 128, 'MASTERING_PRODUCT_INPUTS_INVALID');
  for (const [name, input] of Object.entries(result.inputs)) {
    need(aliasPattern.test(name) && plain(input) &&
      Object.keys(input).every(key => ['path', 'sha256'].includes(key)) &&
      (input.sha256 === undefined || digestPattern.test(input.sha256)), 'MASTERING_PRODUCT_INPUT_INVALID');
    absolute(input.path);
  }
  need((value.applicationId === undefined) === (value.expectedRevision === undefined),
    'MASTERING_PRODUCT_APPLICATION_REVISION_REQUIRED');
  if (value.applicationId !== undefined)
    need(/^[a-f0-9]{24}$/.test(value.applicationId) && digestPattern.test(value.expectedRevision),
      'MASTERING_PRODUCT_APPLICATION_INVALID');
  return result;
}
async function native(value) {
  const runtime = await inspectMerchantRuntime(value.request.runtimeDirectory, { load: false, source: false });
  need(await realpath(fileURLToPath(new URL('../../', import.meta.url))) === runtime.sourceRoot,
    'MASTERING_PRODUCT_SELECTED_RUNTIME_REQUIRED', 'Run this product command from the selected original installed runtime.');
  if (value.runtime) need(hash(sourceBinding(runtime)) === hash(value.runtime), 'MASTERING_PRODUCT_RUNTIME_CHANGED',
    'Receive this setup with the selected runtime or prepare a new setup for the changed installation.');
  const source = join(runtime.sourceRoot, NATIVE);
  const [clientModule, portable, merchant] = await Promise.all([
    import(pathToFileURL(join(source, 'client.mjs')).href),
    import(pathToFileURL(join(source, 'portable.mjs')).href),
    import(pathToFileURL(join(source, 'mcp.mjs')).href),
  ]);
  const original = new clientModule.RecordMasteringClient({ directory: value.request.workspaceDirectory });
  let binding, status;
  try { binding = original.invoke('binding'); status = original.invoke('status'); }
  finally { original.close(); }
  need(binding.directory === value.request.workspaceDirectory &&
    (!value.workspace || binding.workspaceId === value.workspace.workspaceId && binding.sha256 === value.workspace.sha256),
    'MASTERING_PRODUCT_WORKSPACE_CHANGED', 'Select the original saved or independently received workspace.');
  return { runtime, source, binding, status, clientModule, portable, merchant };
}
async function report(root, saved = null) {
  saved ??= await record(root);
  const model = await openRuntimeWorkspace({ directory: saved.request.runtimeWorkspaceDirectory });
  try {
    const state = await model.applicationsState({ historyLimit: 10 });
    const application = saved.saved ? state.applications.find(item => item.id === saved.saved.applicationId) ?? null : null;
    let originals = null, originalError = null;
    if (saved.workspace) try { originals = await native(saved); } catch (error) { originalError = problem(error); }
    const paths = { connection: join(root, 'record-mastering.json'), merchantConfiguration: join(root, 'merchant.json'),
      prepareRequest: join(root, 'request.json'), source: join(root, 'source.json'), exports: join(root, 'exports'),
      receiveRoot: join(root, 'received'), merchantReleases: join(root, 'merchant-releases'), merchantExports: join(root, 'merchant-exports'), operatorGuide: 'products/record-mastering/OPERATING.md' };
    return { schema: PRODUCT_SCHEMA + '.status', directory: root, phase: saved.phase,
      requestSha256: saved.requestSha256, runtime: saved.runtime ?? null,
      originalWorkspace: originals ? { binding: originals.binding, status: originals.status } : null, originalError,
      review: saved.review ?? null, saved: saved.saved ?? null, application,
      superseded: Boolean(application && application.revision !== saved.saved?.revision),
      paths, lastError: saved.lastError ?? null };
  } finally { await model.close(); }
}
export async function prepareMasteringProduct({ directory, requestFile = null, requestId = null }) {
  let selected = null, source = null;
  if (requestFile) {
    const raw = await regular(absolute(requestFile), 256 * 1024);
    selected = request(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    source = { filename: requestFile, bytes: raw.length, sha256: digest(raw), text: raw.toString('utf8') };
  }
  if (requestId !== null) operationId(requestId);
  return locked(directory, true, async root => {
    let saved = await readJSON(join(root, 'product.json'), true);
    if (saved) {
      saved = await record(root);
      if (selected) need(hash(selected) === saved.requestSha256, 'MASTERING_PRODUCT_REQUEST_CHANGED');
      if (requestId) need(requestId === saved.saveRequestId, 'MASTERING_PRODUCT_REQUEST_ID_CHANGED');
      if (source) need(source.sha256 === saved.source.sha256, 'MASTERING_PRODUCT_SOURCE_CHANGED');
    } else {
      need(selected && source, 'MASTERING_PRODUCT_REQUEST_REQUIRED');
      const names = await readdir(root);
      need(names.every(name => name === 'product.lock'), 'MASTERING_PRODUCT_DIRECTORY_OCCUPIED',
        'Choose a new private setup directory.');
      saved = { schema: PRODUCT_SCHEMA, directory: root, phase: 'PREPARING', createdAt: new Date().toISOString(),
        request: selected, requestSha256: hash(selected), source,
        saveRequestId: requestId ?? randomUUID() };
      // The complete original request is durable before attaching or reviewing an application.
      await saveJSON(join(root, 'product.json'), saved);
    }
    try {
      await retain(join(root, 'request.json'), saved.request);
      await retain(join(root, 'source.json'), saved.source);
      if (saved.phase !== 'PREPARING') return report(root, saved);
      const selectedNative = await native(saved), originalInputs = {};
      for (const [name, input] of Object.entries(saved.request.inputs)) {
        const path = await realpath(input.path), info = await lstat(path);
        need(info.isFile(), 'MASTERING_PRODUCT_INPUT_FILE_REQUIRED');
        const identity = selectedNative.portable.hashFile(path);
        need(!input.sha256 || identity.sha256 === input.sha256, 'MASTERING_PRODUCT_INPUT_CHANGED');
        originalInputs[name] = { path, sha256: identity.sha256 };
      }
      for (const name of ['exports', 'received', 'starts', 'merchant-exports']) await folder(join(root, name), true);
      const connection = { schema: 'stellar-forge.record-mastering.v1.connection',
        workspaces: { [saved.request.alias]: { directory: saved.request.workspaceDirectory,
          label: saved.request.label, inputs: originalInputs, exportsDirectory: join(root, 'exports'), receiveRoot: join(root, 'received') } } };
      await retain(join(root, 'record-mastering.json'), connection);
      selectedNative.merchant.readMasteringConfiguration(join(root, 'record-mastering.json'));
      // Resume only this setup's original SF82 store; its complete existing history remains unchanged.
      await initReleaseStore(join(root, 'merchant-releases'), { resume: true });
      const merchantConfiguration = { schema: 'stellar-forge.merchant-mcp.v1', name: saved.request.label,
        sources: {}, releaseStore: join(root, 'merchant-releases'), exportsDirectory: join(root, 'merchant-exports'),
        recordMasteringConnection: join(root, 'record-mastering.json') };
      await retain(join(root, 'merchant.json'), merchantConfiguration);
      await readMerchantConfig(join(root, 'merchant.json'));
      const model = await openRuntimeWorkspace({ directory: saved.request.runtimeWorkspaceDirectory });
      try {
        const attached = await model.attach({ directory: saved.request.runtimeDirectory, label: (saved.request.label + ' runtime').slice(0, 120) });
        const current = await model.state({ runtimeId: attached.runtimeId });
        need(current.selected?.phase === 'READY', 'MASTERING_PRODUCT_RUNTIME_NOT_READY');
        saved.runtime = sourceBinding(selectedNative.runtime); saved.workspace = selectedNative.binding;
        saved.runtimeId = attached.runtimeId; saved.runtimeWorkspaceId = current.workspaceId;
        saved.connectionSha256 = digest(await regular(join(root, 'record-mastering.json')));
        saved.merchantConfigurationSha256 = digest(await regular(join(root, 'merchant.json')));
        const settings = { workspaceDirectory: saved.request.workspaceDirectory, port: saved.request.port };
        if (saved.request.environmentFile) settings.environmentFile = saved.request.environmentFile;
        saved.reviewRequest = { runtimeId: attached.runtimeId, kind: 'record-mastering', providerId: 'record-mastering',
          label: saved.request.label, settings,
          applicationId: saved.request.applicationId ?? null, expectedRevision: saved.request.expectedRevision ?? null };
        await saveJSON(join(root, 'product.json'), saved, true);
        saved.review = await model.applicationsReview(saved.reviewRequest);
        saved.saveRequest = { requestId: saved.saveRequestId, reviewId: saved.review.id,
          applicationId: saved.request.applicationId ?? null };
        saved.phase = 'REVIEWED'; delete saved.lastError; saved.updatedAt = new Date().toISOString();
        await saveJSON(join(root, 'product.json'), saved, true);
      } finally { await model.close(); }
      return report(root, saved);
    } catch (error) {
      saved.lastError = problem(error); saved.updatedAt = new Date().toISOString();
      await saveJSON(join(root, 'product.json'), saved, true); throw error;
    }
  });
}
async function withSaved(directory, work, { inspect = true } = {}) {
  return locked(directory, false, async root => {
    const saved = await record(root);
    need(saved.phase === 'SAVED', 'MASTERING_PRODUCT_SAVE_REQUIRED', 'Review and save this setup first.');
    const selected = inspect ? await native(saved) : null;
    if (inspect) need(digest(await regular(join(root, 'record-mastering.json'))) === saved.connectionSha256 &&
      digest(await regular(join(root, 'merchant.json'))) === saved.merchantConfigurationSha256,
      'MASTERING_PRODUCT_CONFIGURATION_CHANGED');
    const model = await openRuntimeWorkspace({ directory: saved.request.runtimeWorkspaceDirectory });
    try {
      need((await model.state()).workspaceId === saved.runtimeWorkspaceId, 'MASTERING_PRODUCT_OPERATOR_CHANGED');
      return await work({ root, saved, selected, model });
    } finally { await model.close(); }
  });
}
export async function saveMasteringProduct({ directory }) {
  return locked(directory, false, async root => {
    const saved = await record(root);
    need(saved.phase === 'REVIEWED' || saved.phase === 'SAVED', 'MASTERING_PRODUCT_REVIEW_REQUIRED');
    if (saved.phase === 'SAVED') return report(root, saved);
    await native(saved);
    need(digest(await regular(join(root, 'record-mastering.json'))) === saved.connectionSha256 &&
      digest(await regular(join(root, 'merchant.json'))) === saved.merchantConfigurationSha256,
      'MASTERING_PRODUCT_CONFIGURATION_CHANGED');
    const model = await openRuntimeWorkspace({ directory: saved.request.runtimeWorkspaceDirectory });
    try {
      need((await model.state()).workspaceId === saved.runtimeWorkspaceId, 'MASTERING_PRODUCT_OPERATOR_CHANGED');
      // applicationsSave retains and replays this exact original save request.
      saved.saved = await model.applicationsSave(saved.saveRequest);
      need(saved.saved.saved === true, 'MASTERING_PRODUCT_SAVE_INCOMPLETE');
      saved.phase = 'SAVED'; delete saved.lastError; saved.updatedAt = new Date().toISOString();
      await saveJSON(join(root, 'product.json'), saved, true);
    } catch (error) {
      saved.lastError = problem(error); await saveJSON(join(root, 'product.json'), saved, true); throw error;
    } finally { await model.close(); }
    return report(root, saved);
  });
}
export async function masteringProductStatus({ directory }) { return report(await folder(directory)); }
export async function connectMasteringProduct({ directory }) {
  return withSaved(directory, async ({ saved, model }) => model.applicationsConnect({ applicationId: saved.saved.applicationId }), { inspect: false });
}
export async function startMasteringProduct({ directory, requestId }) {
  operationId(requestId);
  return withSaved(directory, async ({ root, saved, model }) => {
    const path = join(root, 'starts', requestId + '.json');
    let started = await readJSON(path, true);
    if (!started) {
      const state = await model.applicationsState({ historyLimit: 1 }), app = state.applications.find(a => a.id === saved.saved.applicationId);
      need(app?.revision === saved.saved.revision, 'MASTERING_PRODUCT_APPLICATION_CHANGED',
        'Review the current saved application before creating another product setup.');
      const review = await model.applicationsStartReview({ applicationId: app.id });
      started = { schema: PRODUCT_SCHEMA + '.start', request: { applicationId: app.id, requestId, reviewId: review.id }, review, dispatch: 'selected' };
      await saveJSON(path, started);
    }
    need(started.schema === PRODUCT_SCHEMA + '.start' && started.request.requestId === requestId &&
      started.request.applicationId === saved.saved.applicationId, 'MASTERING_PRODUCT_START_CHANGED');
    if (started.result) return { ...started.result, replayed: true };
    started.dispatch = 'dispatching'; await saveJSON(path, started, true);
    const result = await model.applicationsStart(started.request);
    started.result = result; started.dispatch = 'entered'; started.dispatchedAt = new Date().toISOString();
    await saveJSON(path, started, true); return result;
  });
}
export async function recoverMasteringProduct({ directory, operationId: id }) {
  operationId(id);
  return withSaved(directory, async ({ saved, model }) => model.applicationsRecover({ applicationId: saved.saved.applicationId, operationId: id }), { inspect: false });
}
export async function stopMasteringProduct({ directory, operationId: id }) {
  operationId(id);
  return withSaved(directory, async ({ saved, model }) => model.applicationsStop({ applicationId: saved.saved.applicationId, operationId: id }), { inspect: false });
}
export async function exportMasteringProduct({ directory, kind, expectedRevision, requestId, deliveryId }) {
  operationId(requestId);
  need(['workspace', 'delivery'].includes(kind) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
    'MASTERING_PRODUCT_EXPORT_SELECTION_REQUIRED');
  need(kind === 'delivery' ? typeof deliveryId === 'string' && /^[a-f0-9-]{36}$/.test(deliveryId) : deliveryId === undefined,
    'MASTERING_PRODUCT_DELIVERY_SELECTION_INVALID');
  return withSaved(directory, async ({ root, saved, selected }) => {
    const config = selected.merchant.readMasteringConfiguration(join(root, 'record-mastering.json'));
    const provider = new selected.merchant.MerchantRecordMastering({ recordMastering: config });
    try {
      const result = await provider.call('merchant_mastering_export', { workspace: saved.request.alias, kind, expectedRevision, requestId,
        ...(deliveryId === undefined ? {} : { deliveryId }) });
      const path = join(root, 'exports', result.sha256 + '.bin'), actual = selected.portable.hashFile(path);
      need(actual.sha256 === result.sha256 && actual.bytes === result.bytes, 'MASTERING_PRODUCT_EXPORT_CHANGED');
      return { ...result, path, suggestedFilename: kind === 'workspace' ? 'workspace.mastering.gz' : 'master-delivery.gz' };
    } finally { await provider.close(); }
  });
}
