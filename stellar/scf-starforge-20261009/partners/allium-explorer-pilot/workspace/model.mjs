// MIT. Retained Allium operator workspace over the original acquisition and SF30 engines.
import { randomUUID } from 'node:crypto';
import { mkdir, lstat, readdir, rename, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { compileProduct, beginRun, readRun, recoverRun, collectRun, stageResults } from '../explorer.mjs';
import { loadDatasetConfig } from '../../../sf30-seller-sdk/dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../../../sf30-seller-sdk/dataset-cli.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../../../sf30-seller-sdk/dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller } from '../../../sf30-seller-sdk/dataset-refresh/service.mjs';
import { startDatasetPublishingWorkspace } from '../../../sf30-seller-sdk/dataset-refresh/workspace.mjs';
import { absolute, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  acquireWorkspace, bytes, digest, identity, object, fault, stamp } from '../../../sf30-seller-sdk/postgres/publisher/files.mjs';

const SCHEMA = 'stellar-forge.allium-workspace.v1';
const BUNDLE = 'stellar-forge.allium-workspace-export.v1';
const MAX_STATE = 32 * 1024 * 1024, MAX_BUNDLE = 128 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,95}$/, HASH = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const utf8 = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
const safeId = value => { if (!ID.test(value ?? '')) throw fault('ID_REQUIRED', 'Use an explicit stable operation or saved-record ID.'); return value; };
const line = (value, max = 240) => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw fault('TEXT_INVALID', 'Use a single line within ' + max + ' characters.');
  return value;
};
const absent = async path => { try { await lstat(path); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };
function product(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw fault('PRODUCT_SIZE', 'Product JSON must be at most 64 KiB.');
  let value; try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw fault('PRODUCT_JSON', 'Correct the product JSON before saving.'); }
  try { return compileProduct(value); } catch (e) { throw fault('PRODUCT_INVALID', e.message); }
}
function validateState(value) {
  if (!object(value) || value.schema !== SCHEMA || !ID.test(value.id ?? '') ||
      !Array.isArray(value.revisions) || !value.revisions.length || !Array.isArray(value.acquisitions) ||
      !Array.isArray(value.configurations) || !Array.isArray(value.operations)) throw fault('WORKSPACE_INVALID');
  const ids = new Set();
  for (const revision of value.revisions) {
    if (!ID.test(revision.id ?? '') || ids.has(revision.id) || revision.productSha256 !== digest(revision.productText) ||
        identity(product(revision.productText)) !== identity(revision.product)) throw fault('REVISION_INVALID');
    ids.add(revision.id);
  }
  if (!ids.has(value.head)) throw fault('HEAD_INVALID');
  const acquisitionIds = new Set();
  for (const record of value.acquisitions) {
    if (!ID.test(record.id ?? '') || acquisitionIds.has(record.id) || !ids.has(record.revisionId) ||
        !['import', 'query'].includes(record.kind)) throw fault('ACQUISITION_INVALID');
    acquisitionIds.add(record.id);
  }
  const configurationIds = new Set();
  for (const record of value.configurations) {
    if (!ID.test(record.id ?? '') || configurationIds.has(record.id) || !acquisitionIds.has(record.acquisitionId) ||
        identity(record.config) !== record.configSha256) throw fault('CONFIGURATION_INVALID');
    configurationIds.add(record.id);
  }
  if (value.configurationId !== null && !configurationIds.has(value.configurationId)) throw fault('CONFIGURATION_INVALID');
  const operations = new Set();
  for (const operation of value.operations) {
    if (!ID.test(operation.id ?? '') || operations.has(operation.id) || !HASH.test(operation.inputSha256 ?? '')) throw fault('OPERATION_INVALID');
    operations.add(operation.id);
  }
  return value;
}
function revisionRecord(text, parent, operationId, note, restoredFrom = null) {
  return { id: 'r-' + randomUUID(), parent, operationId, createdAt: stamp(), note: line(note ?? ''),
    restoredFrom, productText: text, productSha256: digest(text), product: product(text) };
}

/** Create only. No provider call, seller, key persistence or background process. */
export async function createAlliumWorkspace({ directory, productText, name = 'Allium data workspace' }) {
  absolute(directory); line(name, 128);
  const revision = revisionRecord(productText, null, 'initial-create', 'Initial product');
  const state = { schema: SCHEMA, id: 'allium-' + randomUUID(), name, createdAt: stamp(), updatedAt: stamp(),
    revision: 1, head: revision.id, revisions: [revision], acquisitions: [], configurations: [],
    configurationId: null, operations: [], lastSession: null, imports: [] };
  await mkdir(directory, { mode: 0o700 });
  try { await privateDirectory(directory); await createFile(join(directory, 'workspace.json'), bytes(state)); }
  catch (e) { await rm(directory, { recursive: true, force: true }); throw e; }
  return { directory, id: state.id, head: state.head };
}

/** One owner holds the existing native flock; independent readers use its HTTP API. */
export async function openAlliumWorkspace({ directory, env = process.env, allowLoopback = false } = {}) {
  absolute(directory); await privateDirectory(directory);
  const unlock = await acquireWorkspace(directory);
  try { return new AlliumWorkspace(directory, validateState(await readJson(join(directory, 'workspace.json'), MAX_STATE)),
    { env, allowLoopback, unlock }); }
  catch (e) { await unlock(); throw e; }
}

class AlliumWorkspace {
  constructor(directory, state, options) {
    this.directory = directory; this.current = state; this.options = options;
    this.tail = Promise.resolve(); this.closed = false; this.closing = false;
    this.service = null; this.publisher = null; this.session = null;
    this.descriptions = new Map();
  }
  _serial(operation) {
    if (this.closed || this.closing) return Promise.reject(fault('WORKSPACE_CLOSED', 'Reopen the workspace to continue.', 409));
    const pending = this.tail.then(operation); this.tail = pending.catch(() => {}); return pending;
  }
  async _save(next) {
    next = { ...next, revision: this.current.revision + 1, updatedAt: stamp() };
    const encoded = bytes(next);
    if (encoded.length > MAX_STATE) throw fault('WORKSPACE_CAPACITY', 'Export this workspace before retaining further revisions.', 413);
    await atomicJson(this.directory, 'workspace.json', next); this.current = next;
  }
  _revision(id = this.current.head) {
    const result = this.current.revisions.find(r => r.id === safeId(id));
    if (!result) throw fault('REVISION_NOT_FOUND', 'Choose an existing saved product revision.', 404); return result;
  }
  _acquisition(id) {
    const result = this.current.acquisitions.find(r => r.id === safeId(id));
    if (!result) throw fault('ACQUISITION_NOT_FOUND', 'Choose a retained acquisition.', 404); return result;
  }
  _configuration() {
    const result = this.current.configurations.find(r => r.id === this.current.configurationId);
    if (!result) throw fault('MERCHANT_NOT_CONFIGURED', 'Configure the merchant from a completed acquisition.'); return result;
  }
  _head(expected) { if (expected !== this.current.head) throw fault('HEAD_CHANGED', 'A newer product revision exists. Reload it before saving.', 409); }
  _operation(id, kind, input) {
    safeId(id); const inputSha256 = identity(input), found = this.current.operations.find(v => v.id === id);
    if (found && (found.kind !== kind || found.inputSha256 !== inputSha256))
      throw fault('OPERATION_CONFLICT', 'This operation ID belongs to different inputs. Restore the original request or start a new operation.', 409);
    return { found, record: { id, kind, inputSha256, createdAt: stamp() } };
  }
  async _remember(record, result, next = this.current) {
    const operations = next.operations.filter(v => v.id !== record.id);
    operations.push({ ...record, completedAt: stamp(), result });
    await this._save({ ...next, operations }); return result;
  }
  _acquisitionPath(id) { return join(this.directory, 'acquisitions', safeId(id)); }
  _datasetPath(record) { return join(this._acquisitionPath(record.id), record.kind === 'query' ? 'provider/dataset' : 'dataset', 'dataset.json'); }
  _versionDirectory() { return join(this.directory, 'merchant', 'versions'); }
  _publisherDirectory() { return join(this.directory, 'publisher'); }
  async _native(record) {
    const native = await loadDatasetConfig(this._datasetPath(record));
    const source = await readJson(join(dirname(this._datasetPath(record)), 'source.json'), 131072);
    const revision = this._revision(record.revisionId);
    if (source.configSha256 !== digest(JSON.stringify(revision.product)) || source.snapshot !== native.describe().snapshot)
      throw fault('SOURCE_IDENTITY_CHANGED', 'The saved result, projection and original dataset no longer agree.', 409);
    const originalResult = join(this._acquisitionPath(record.id), record.kind === 'query' ? 'provider/result.json' : 'result.json');
    const [resultBytes, csvBytes] = await Promise.all([readPrivate(originalResult, revision.product.maxResponseBytes),
      readPrivate(join(dirname(this._datasetPath(record)), 'dataset.csv'), 2 * 1024 * 1024)]);
    if (source.resultSha256 !== digest(resultBytes) || source.csvSha256 !== digest(csvBytes)) throw fault('SOURCE_IDENTITY_CHANGED');
    return { native, source };
  }
  async _runView(record) {
    let run = null, source = null, dataset = null;
    if (record.kind === 'query') {
      try { run = await readRun(join(this._acquisitionPath(record.id), 'provider')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (!(await absent(this._datasetPath(record)))) {
      const root = dirname(this._datasetPath(record));
      const signatures = await Promise.all(['dataset.json', 'dataset.csv', 'source.json'].map(async name => {
        const info = await lstat(join(root, name)); return [info.size, info.mtimeMs, info.ctimeMs];
      }));
      const signature = JSON.stringify(signatures), cached = this.descriptions.get(record.id);
      if (cached?.signature === signature) { source = clone(cached.source); dataset = clone(cached.dataset); }
      else {
        const loaded = await this._native(record); source = loaded.source; dataset = loaded.native.describe();
        // Cache descriptors only. Original parsed rows remain owned by the selected
        // query or the native seller's bounded resident-version cache.
        this.descriptions.set(record.id, { signature, source: clone(source), dataset: clone(dataset) });
      }
    }
    return { ...clone(record), status: dataset ? 'STAGED' : run?.status ?? record.status,
      runId: run?.runId ?? null, nativeRun: run, source, dataset,
      canResumeSubmission: record.kind === 'query' && !run && await absent(join(this._acquisitionPath(record.id), 'provider')) };
  }
  async _view() {
    let versions = null, publisher = null;
    if (this.service) versions = this.service.versions.status();
    else try { versions = await readJson(join(this._versionDirectory(), 'state.json'), 1048576); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    try {
      const original = await readJson(join(this._publisherDirectory(), 'workspace.json'), 4 * 1024 * 1024);
      publisher = { revision: original.revision, candidates: original.candidates, buyers: original.buyers,
        recovery: original.recovery ?? null };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const head = this._revision();
    const acquisitions = [];
    for (const record of this.current.acquisitions) acquisitions.push(await this._runView(record));
    return { schema: SCHEMA, id: this.current.id, name: this.current.name, directory: this.directory,
      createdAt: this.current.createdAt, updatedAt: this.current.updatedAt, revision: this.current.revision,
      head: this.current.head, current: clone(head),
      revisions: this.current.revisions.map(({ productText, product: config, ...r }) => ({ ...r, name: config.name, queryId: config.queryId,
        columnCount: Object.keys(config.columns).length })),
      acquisitions,
      configurations: clone(this.current.configurations), configurationId: this.current.configurationId,
      versions, runtime: this.service ? { status: 'RUNNING', ...this.session } : { status: 'STOPPED', lastSession: clone(this.current.lastSession) },
      publisher: { ...(publisher ?? {}), running: !!this.publisher, url: this.publisher?.url ?? null },
      operations: clone(this.current.operations), imports: clone(this.current.imports),
      credentials: { apiKeyEnv: head.product.apiKeyEnv, available: typeof this.options.env[head.product.apiKeyEnv] === 'string' &&
        this.options.env[head.product.apiKeyEnv].length > 0 },
      limits: { productBytes: 65536, resultBytes: head.product.maxResponseBytes, bundleBytes: MAX_BUNDLE } };
  }
  state() { return this._serial(() => this._view()); }
  revision(id) { return this._serial(() => clone(this._revision(id))); }
  saveProduct({ operationId, expectedHead, productText, note = '' }) {
    return this._serial(async () => {
      const op = this._operation(operationId, 'save-product', { expectedHead, productText, note });
      if (op.found) return clone(op.found.result);
      this._head(expectedHead);
      const revision = revisionRecord(productText, expectedHead, operationId, note);
      return this._remember(op.record, { revisionId: revision.id }, { ...this.current,
        head: revision.id, revisions: [...this.current.revisions, revision] });
    });
  }
  restoreProduct({ operationId, expectedHead, revisionId, note = '' }) {
    return this._serial(async () => {
      const op = this._operation(operationId, 'restore-product', { expectedHead, revisionId, note });
      if (op.found) return clone(op.found.result);
      this._head(expectedHead);
      const source = this._revision(revisionId), revision = revisionRecord(source.productText, expectedHead, operationId,
        note || 'Restore ' + revisionId, revisionId);
      return this._remember(op.record, { revisionId: revision.id }, { ...this.current,
        head: revision.id, revisions: [...this.current.revisions, revision] });
    });
  }
  async _markAcquisition(id, patch) {
    await this._save({ ...this.current, acquisitions: this.current.acquisitions.map(v => v.id === id ? { ...v, ...patch, updatedAt: stamp() } : v) });
  }
  async _import(record, data) {
    const directory = this._acquisitionPath(record.id), path = join(directory, 'result.json');
    await privateDirectory(directory, true);
    if (await absent(path)) await createFile(path, data);
    const retained = await readPrivate(path, this._revision(record.revisionId).product.maxResponseBytes);
    if (digest(retained) !== record.resultSha256) throw fault('SOURCE_IDENTITY_CHANGED');
    try {
      if (await absent(this._datasetPath(record))) await stageResults(this._revision(record.revisionId).product,
        retained, join(directory, 'dataset'), { acquisition: 'operator-import' });
      const native = await this._native(record);
      if (native.source.resultSha256 !== record.resultSha256) throw fault('SOURCE_IDENTITY_CHANGED');
      await this._markAcquisition(record.id, { status: 'STAGED', error: null });
      return this._runView(this._acquisition(record.id));
    } catch (e) {
      await this._markAcquisition(record.id, { status: 'REJECTED', error: { code: e.code ?? 'IMPORT_REJECTED', message: e.message } }); throw e;
    }
  }
  importResult({ operationId, revisionId, resultBase64, filename = 'allium-results.json', note = '' }) {
    return this._serial(async () => {
      if (typeof resultBase64 !== 'string') throw fault('RESULT_REQUIRED');
      const data = Buffer.from(resultBase64, 'base64'), revision = this._revision(revisionId);
      if (data.toString('base64') !== resultBase64 || data.length > revision.product.maxResponseBytes)
        throw fault('RESULT_SIZE', 'Import the complete original JSON result within this saved product’s byte limit.', 413);
      line(filename); line(note, 1024);
      const input = { revisionId, resultSha256: digest(data), filename, note };
      const op = this._operation(operationId, 'import', input);
      let record;
      if (op.found) record = this._acquisition(op.found.result.acquisitionId);
      else {
        record = { id: 'a-' + randomUUID(), operationId, kind: 'import', revisionId, createdAt: stamp(),
          status: 'PREPARED', filename, note, resultSha256: input.resultSha256, resultBytes: data.length };
        await this._remember(op.record, { acquisitionId: record.id }, { ...this.current, acquisitions: [...this.current.acquisitions, record] });
      }
      return this._import(record, data);
    });
  }
  startQuery({ operationId, revisionId, note = '' }) {
    return this._serial(async () => {
      const revision = this._revision(revisionId); line(note, 1024);
      const op = this._operation(operationId, 'start-query', { revisionId, note });
      if (op.found) return this._runView(this._acquisition(op.found.result.acquisitionId));
      const record = { id: 'a-' + randomUUID(), operationId, kind: 'query', revisionId, createdAt: stamp(), status: 'PREPARED', note };
      await this._remember(op.record, { acquisitionId: record.id }, { ...this.current, acquisitions: [...this.current.acquisitions, record] });
      await privateDirectory(this._acquisitionPath(record.id), true);
      return this._submit(record, revision);
    });
  }
  async _submit(record, revision = this._revision(record.revisionId)) {
    try {
      await beginRun(revision.product, join(this._acquisitionPath(record.id), 'provider'), this.options);
      await this._markAcquisition(record.id, { status: 'submitted', error: null });
    } catch (e) {
      await this._markAcquisition(record.id, { error: { code: e.code ?? 'ALLIUM_SUBMISSION_FAILED', message: e.message } }); throw e;
    }
    return this._runView(this._acquisition(record.id));
  }
  resumePrepared({ acquisitionId }) {
    return this._serial(async () => {
      const record = this._acquisition(acquisitionId), view = await this._runView(record);
      if (!view.canResumeSubmission) throw fault('RUN_ALREADY_STARTED', 'Use the retained native run or recover its actual ID; this action cannot resubmit a query.', 409);
      await privateDirectory(this._acquisitionPath(record.id), true); return this._submit(record);
    });
  }
  collect({ acquisitionId }) {
    return this._serial(async () => {
      const record = this._acquisition(acquisitionId);
      if (record.kind !== 'query') throw fault('QUERY_REQUIRED');
      try {
        const output = await collectRun(join(this._acquisitionPath(record.id), 'provider'), this.options);
        await this._markAcquisition(record.id, { status: output.status, error: null });
        return this._runView(this._acquisition(record.id));
      } catch (e) {
        await this._markAcquisition(record.id, { error: { code: e.code ?? 'COLLECTION_FAILED', message: e.message } }); throw e;
      }
    });
  }
  recover({ acquisitionId, runId }) {
    return this._serial(async () => {
      const record = this._acquisition(acquisitionId);
      if (record.kind !== 'query') throw fault('QUERY_REQUIRED');
      await recoverRun(join(this._acquisitionPath(record.id), 'provider'), runId);
      await this._markAcquisition(record.id, { status: 'submitted', error: null });
      return this._runView(this._acquisition(record.id));
    });
  }
  acquisition(id) { return this._serial(() => this._runView(this._acquisition(id))); }
  query({ acquisitionId, query = '' }) {
    return this._serial(async () => {
      if (typeof query !== 'string' || query.length > 8192) throw fault('QUERY_INVALID');
      const { native, source } = await this._native(this._acquisition(acquisitionId));
      const context = { method: 'GET', query: new URLSearchParams(query), headers: {}, pathParams: {}, url: new URL('https://operator.invalid/data?' + query) };
      const admitted = await native.admit(context), result = admitted === true ? await native.handle(context) : admitted;
      return { mode: 'LOCAL_OPERATOR_PREVIEW', source, dataset: native.describe(), ...result };
    });
  }
  download({ acquisitionId, kind }) {
    return this._serial(async () => {
      const record = this._acquisition(acquisitionId), directory = this._acquisitionPath(record.id);
      const paths = { result: join(directory, record.kind === 'query' ? 'provider/result.json' : 'result.json'),
        source: join(dirname(this._datasetPath(record)), 'source.json'),
        csv: join(dirname(this._datasetPath(record)), 'dataset.csv'),
        dataset: this._datasetPath(record), run: join(directory, 'provider/run.json') };
      if (!Object.hasOwn(paths, kind) || kind === 'run' && record.kind !== 'query') throw fault('DOWNLOAD_NOT_FOUND', 'Choose a retained native file.', 404);
      const data = await readPrivate(paths[kind], 2 * 1024 * 1024);
      return { data, filename: record.id + '-' + basename(paths[kind]), sha256: digest(data), contentType: kind === 'csv' ? 'text/csv; charset=utf-8' : 'application/json' };
    });
  }
  async _versions(operation, initialConfig, settings = {}) {
    if (this.service) return operation(this.service.versions);
    const directory = this._versionDirectory(), exists = !(await absent(join(directory, 'state.json')));
    if (!exists && !initialConfig) throw fault('MERCHANT_NOT_INITIALIZED', 'Configure the merchant from a staged source first.');
    await privateDirectory(join(this.directory, 'merchant'), true);
    const versions = await openDatasetVersions({ directory, ...(exists ? {} : { initialConfig, ...settings }) });
    try { return await operation(versions); } finally { await versions.close(); }
  }
  configure({ operationId, acquisitionId, expectedConfigurationId, origin, path = '/data', payment, settings = {} }) {
    return this._serial(async () => {
      const op = this._operation(operationId, 'configure', { acquisitionId, expectedConfigurationId, origin, path, payment, settings });
      if (op.found) return clone(op.found.result);
      if (this.service) throw fault('MERCHANT_RUNNING', 'Stop this workspace’s merchant before changing its advertised terms.', 409);
      if (expectedConfigurationId !== this.current.configurationId) throw fault('CONFIGURATION_CHANGED', 'Reload the current merchant configuration.', 409);
      if (!object(settings) || Object.keys(settings).some(k => !['retentionMs', 'maxVersions', 'maxRetainedBytes'].includes(k))) throw fault('SETTINGS_INVALID');
      const record = this._acquisition(acquisitionId), { native } = await this._native(record);
      const config = await buildDatasetSellerConfig(native, { payment, origin, path });
      const parameters = config.routes[0].definition.queryParameters;
      if (parameters.length >= 32) throw fault('SNAPSHOT_PARAMETER_CAPACITY', 'Free one of the original 32 query slots for the buyer snapshot selector.');
      parameters.push({ ...DATASET_SNAPSHOT_PARAMETER });
      const versionState = await this._versions(async versions => {
        if (versions.status().current !== native.describe().snapshot) throw fault('PUBLISH_SOURCE_FIRST', 'Publish this completed source into the existing version store before changing its merchant terms.', 409);
        return versions.status();
      }, this._datasetPath(record), settings);
      const configuration = { id: 'm-' + randomUUID(), createdAt: stamp(), operationId, acquisitionId,
        origin, path, payment: clone(payment), config, configSha256: identity(config), initialSnapshot: versionState.current };
      return this._remember(op.record, { configurationId: configuration.id, versions: versionState }, { ...this.current,
        configurationId: configuration.id, configurations: [...this.current.configurations, configuration] });
    });
  }
  refresh({ acquisitionId, expectedSnapshot, expectedRevision }) {
    return this._serial(async () => {
      const record = this._acquisition(acquisitionId); await this._native(record);
      return this._versions(versions => versions.refresh({ configPath: this._datasetPath(record), expectedSnapshot, expectedRevision }));
    });
  }
  activate({ snapshot, expectedSnapshot, expectedRevision }) {
    return this._serial(() => this._versions(versions => versions.activate({ snapshot, expectedSnapshot, expectedRevision })));
  }
  collectVersions() { return this._serial(() => this._versions(async versions => ({ removed: await versions.collect(), ...versions.status() }))); }
  startMerchant({ expectedConfigurationId, port = 0, facilitator = null, allowLocalFacilitator = false } = {}) {
    return this._serial(async () => {
      const configuration = this._configuration();
      if (configuration.id !== expectedConfigurationId) throw fault('CONFIGURATION_CHANGED', 'Select the current advertised merchant terms.', 409);
      if (this.service) return clone(this.session);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('PORT_INVALID');
      let nativeFactory = null;
      if (facilitator !== null) {
        let url; try { url = new URL(facilitator); } catch { throw fault('FACILITATOR_URL_INVALID'); }
        if (url.username || url.password || url.search || url.hash ||
            url.protocol !== 'https:' && !(allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
          throw fault('FACILITATOR_URL_INVALID', 'Use the original HTTPS facilitator, or explicitly enable a local 127.0.0.1 facilitator.');
        const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
          import('@x402/core/server'), import('../../../sf30-seller-sdk/native-factory.mjs')]);
        nativeFactory = compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: facilitator }) });
      }
      const versions = await openDatasetVersions({ directory: this._versionDirectory() });
      let service;
      try {
        service = await startVersionedDatasetSeller({ versions, config: configuration.config, port, nativeFactory,
          controlTransport: 'loopback' });
        const session = { id: 's-' + randomUUID(), configurationId: configuration.id, startedAt: stamp(), url: service.url,
          resource: new URL(configuration.path, configuration.origin).href, mode: service.mode, facilitator };
        await this._save({ ...this.current, lastSession: session }); this.service = service; this.session = session;
        return clone(session);
      } catch (e) { if (service) await service.close(); else await versions.close(); throw e; }
    });
  }
  async _stop() {
    if (this.publisher) { await this.publisher.close(); this.publisher = null; }
    if (this.service) {
      await this.service.close(); this.service = null;
      const lastSession = { ...this.session, stoppedAt: stamp() }; this.session = null;
      await this._save({ ...this.current, lastSession });
    }
    return { status: 'STOPPED', lastSession: clone(this.current.lastSession) };
  }
  stopMerchant({ expectedSessionId } = {}) {
    return this._serial(async () => {
      if (this.session && this.session.id !== expectedSessionId) throw fault('SESSION_CHANGED', 'Reload the owned running merchant before stopping it.', 409);
      return this._stop();
    });
  }
  openPublisher() {
    return this._serial(async () => {
      await this._openPublisher();
      return { url: this.publisher.url, original: 'SF30 dataset publishing workspace', sessionId: this.session.id };
    });
  }
  async _openPublisher() {
    if (!this.service) throw fault('MERCHANT_STOPPED', 'Start this workspace’s merchant to open its original publishing and buyer interface.', 409);
    if (!this.publisher) this.publisher = await startDatasetPublishingWorkspace({ directory: this._versionDirectory(), port: 0,
      workspaceDirectory: this._publisherDirectory(), seller: this.session.url, resource: this.session.resource });
  }
  async _publisherRequest(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(this.publisher.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { authorization: 'Bearer ' + this.publisher.token, ...headers }, body });
    const value = await response.json();
    if (!response.ok) throw fault(value.error ?? 'ORIGINAL_PUBLISHER_REJECTED', value.message ?? value.error, response.status);
    return value;
  }
  stageForPublisher({ operationId, acquisitionId }) {
    return this._serial(async () => {
      const op = this._operation(operationId, 'publisher-stage', { acquisitionId });
      await this._openPublisher();
      if (op.found) return { ...clone(op.found.result), url: this.publisher.url };
      const record = this._acquisition(acquisitionId), { source } = await this._native(record);
      const filename = 'allium-' + record.id + '-' + operationId + '.csv';
      let status = await this._publisherRequest('/api/status');
      let candidate = status.workspace.candidates.find(c => c.filename === filename);
      if (!candidate) {
        const csv = await readPrivate(join(dirname(this._datasetPath(record)), 'dataset.csv'), 2 * 1024 * 1024);
        status = await this._publisherRequest('/api/draft', { method: 'PUT', body: csv,
          headers: { 'content-type': 'text/csv', 'x-upload-name': encodeURIComponent(filename) } });
        candidate = status.workspace.candidates.find(c => c.filename === filename);
      } else await this._publisherRequest('/api/draft/select', { method: 'POST', body: JSON.stringify({ id: candidate.id }), headers: { 'content-type': 'application/json' } });
      if (!candidate || candidate.csvHash !== source.csvSha256 || candidate.dataset.snapshot !== source.snapshot)
        throw fault('PUBLISHER_SOURCE_MISMATCH', 'The selected acquisition does not match the current merchant’s original typed contract.', 409);
      const notes = ['Allium acquisition ' + record.id, 'Product revision ' + record.revisionId,
        'Original result SHA-256 ' + source.resultSha256, 'Native snapshot ' + source.snapshot,
        'Provider run ' + (source.runId ?? 'operator import'), record.note ?? ''].join('\n');
      const name = this._revision(record.revisionId).product.name;
      if (candidate.name !== name || candidate.notes !== notes)
        await this._publisherRequest('/api/draft/metadata', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: candidate.id, name, notes, expectedDraftRevision: candidate.revision }) });
      const result = { acquisitionId, candidateId: candidate.id, snapshot: source.snapshot };
      await this._remember(op.record, result);
      return { ...result, url: this.publisher.url };
    });
  }
  exportBundle() {
    return this._serial(async () => {
      await this._stop();
      let versions = null, publisherUnlock = null;
      try {
        if (!(await absent(join(this._versionDirectory(), 'state.json')))) versions = await openDatasetVersions({ directory: this._versionDirectory() });
        if (!(await absent(this._publisherDirectory()))) publisherUnlock = await acquireWorkspace(this._publisherDirectory());
        const files = await portableFiles(this.directory);
        return { schema: BUNDLE, id: 'export-' + randomUUID(), workspaceId: this.current.id, createdAt: stamp(),
          sourceDirectory: this.directory, runtime: 'STOPPED', files,
          manifestSha256: identity(files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))) };
      } finally { await publisherUnlock?.(); await versions?.close(); }
    });
  }
  async close() {
    if (this.closed || this.closing) return this.tail;
    this.closing = true; await this.tail;
    try { await this._stop(); } finally { this.closed = true; await this.options.unlock(); }
  }
}

function portablePath(path) {
  if (path === 'workspace.json') return true;
  if (/^acquisitions\/[A-Za-z0-9_-]+\/(?:result\.json|provider\/(?:run|result)\.json|(?:provider\/)?dataset\/(?:dataset\.json|dataset\.csv|source\.json))$/.test(path)) return true;
  if (/^merchant\/versions\/(?:state\.json|versions\/[a-f0-9]{64}\/(?:manifest\.json|dataset\.json|data\.csv))$/.test(path)) return true;
  if (/^publisher\/(?:workspace\.json|candidates\/[A-Za-z0-9_-]+\/(?:candidate\.json|dataset\.json|data\.csv)|buyers\/[A-Za-z0-9_-]+(?:\.metadata)?\.json)$/.test(path)) return true;
  return false;
}
async function portableFiles(directory) {
  const files = []; let total = 0;
  const walk = async (root, prefix = '') => {
    for (const item of await readdir(root, { withFileTypes: true })) {
      const path = prefix + item.name, absolutePath = join(root, item.name);
      if (item.isSymbolicLink()) throw fault('PORTABLE_SYMLINK', 'Retained workspace files cannot be symbolic links.');
      if (item.isDirectory()) {
        if (item.name.startsWith('.') || /^dataset\.staging-[a-f0-9-]+$/.test(item.name) || ['staging', 'writer.lock', 'run.lock'].includes(item.name)) continue;
        await walk(absolutePath, path + '/'); continue;
      }
      if (!portablePath(path)) {
        if (['publisher.lock', 'writer.lock', 'control.json', 'control.sock'].includes(item.name) || item.name.startsWith('.pending-') || item.name.startsWith('.state-')) continue;
        throw fault('PORTABLE_FILE_UNKNOWN', 'A retained file has no portable mapping: ' + path);
      }
      const data = await readPrivate(absolutePath, MAX_STATE); total += data.length;
      if (total > MAX_BUNDLE || files.length >= 10000) throw fault('PORTABLE_CAPACITY', 'The full retained workspace exceeds the 128 MiB portable-data limit.', 413);
      files.push({ path, bytes: data.length, sha256: digest(data), base64: data.toString('base64') });
    }
  };
  await walk(directory); return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Create-only portable reopen. Retains original content and deliberately starts no process. */
export async function importAlliumWorkspace({ directory, bundle }) {
  absolute(directory);
  if (!object(bundle) || bundle.schema !== BUNDLE || !Array.isArray(bundle.files) || bundle.files.length > 10000 ||
      bundle.runtime !== 'STOPPED' || !ID.test(bundle.workspaceId ?? '')) throw fault('BUNDLE_INVALID');
  absolute(bundle.sourceDirectory, 'export source directory');
  if (!(await absent(directory))) throw fault('IMPORT_DESTINATION_EXISTS', 'Choose a new directory for this portable workspace.', 409);
  const seen = new Set(), decoded = []; let total = 0;
  for (const file of bundle.files) {
    if (!object(file) || !portablePath(file.path) || seen.has(file.path) || !HASH.test(file.sha256 ?? '') || typeof file.base64 !== 'string') throw fault('BUNDLE_FILE_INVALID');
    seen.add(file.path); const data = Buffer.from(file.base64, 'base64'); total += data.length;
    if (total > MAX_BUNDLE || data.length !== file.bytes || data.toString('base64') !== file.base64 || digest(data) !== file.sha256) throw fault('BUNDLE_IDENTITY_INVALID');
    decoded.push({ path: file.path, data });
  }
  if (identity(bundle.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))) !== bundle.manifestSha256 || !seen.has('workspace.json')) throw fault('BUNDLE_MANIFEST_INVALID');
  const workspace = decoded.find(f => f.path === 'workspace.json'), state = validateState(JSON.parse(utf8(workspace.data)));
  if (state.id !== bundle.workspaceId) throw fault('BUNDLE_WORKSPACE_MISMATCH');
  const originalPublisher = decoded.find(f => f.path === 'publisher/workspace.json');
  if (originalPublisher) {
    const publisher = JSON.parse(utf8(originalPublisher.data));
    if (publisher.schema !== 'stellar-forge.dataset-publisher-workspace.v1' || publisher.datasetDirectory !== join(bundle.sourceDirectory, 'merchant', 'versions')) throw fault('PUBLISHER_BINDING_INVALID');
    publisher.datasetDirectory = join(directory, 'merchant', 'versions'); originalPublisher.data = bytes(publisher);
  }
  state.imports = [...(state.imports ?? []), { createdAt: stamp(), exportId: bundle.id, manifestSha256: bundle.manifestSha256,
    originalDirectory: bundle.sourceDirectory, directory, publisherBindingRebased: !!originalPublisher,
    originalWorkspaceSha256: digest(workspace.data) }]; workspace.data = bytes(state);
  // Reserve the destination with mkdir, whose EEXIST is atomic. Keep workspace.json
  // absent until all dependent files have been checked, so an incomplete import cannot open.
  await mkdir(directory, { mode: 0o700 });
  const temporary = directory;
  try {
    for (const file of decoded.filter(file => file.path !== 'workspace.json')) {
      const path = join(temporary, file.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await createFile(path, file.data);
    }
    // Validate the retained acquisitions using their original typed loader before exposing the destination.
    for (const record of state.acquisitions) {
      const path = join(temporary, 'acquisitions', record.id, record.kind === 'query' ? 'provider/dataset' : 'dataset', 'dataset.json');
      if (!(await absent(path))) {
        const native = await loadDatasetConfig(path), source = await readJson(join(dirname(path), 'source.json'), 131072);
        if (native.describe().snapshot !== source.snapshot) throw fault('BUNDLE_DATASET_INVALID');
      }
    }
    await createFile(join(directory, 'workspace.json'), workspace.data);
    return { directory, id: state.id, head: state.head, runtime: 'STOPPED', manifestSha256: bundle.manifestSha256 };
  } catch (e) { await rm(temporary, { recursive: true, force: true }); throw e; }
}
