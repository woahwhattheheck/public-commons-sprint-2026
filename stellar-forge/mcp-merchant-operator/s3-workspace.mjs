import { s3WorkspaceTools, aliasSchema, revisionSchema, operationSchema, jsonSchema, digestSchema } from './catalog/s3-workspace.mjs';
export { s3WorkspaceTools } from './catalog/s3-workspace.mjs';
// MIT. Merchant MCP authoring over the original S3 workspace and SF82 releases.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';

export const S3_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.s3-workspace-connection.v1';





const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));

function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'S3 workspace paths are selected in the host connection file.');
  return resolve(base, value);
}
function positive(value, label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', `${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
function operation(value, label = 'Operation ID') {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value))
    throw failure('INVALID_PARAMS', label + ' must use 8–80 lowercase letters, digits or hyphens, starting with a letter.');
  return value;
}
function originalRecord(value, label) {
  if (typeof value !== 'string' || !value || value.length > 160 || /[\x00-\x1f\x7f/\\]/.test(value))
    throw failure('INVALID_PARAMS', 'Use the original retained ' + label + '.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw failure('INVALID_PARAMS', 'Use the complete SHA-256 from the original customer file listing.');
  return value;
}
function runtimeOptions(raw = {}) {
  exact(raw, ['port', 'facilitator', 'allowLocalFacilitator']);
  const runtime = { port: positive(raw.port ?? 0, 'Seller port', 0, 65535) };
  if (raw.facilitator !== undefined) {
    let url;
    try { url = new URL(raw.facilitator); } catch { throw failure('CONFIGURATION_ERROR', 'Use a complete facilitator URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw failure('CONFIGURATION_ERROR', 'Use an HTTP(S) facilitator URL without credentials, query or fragment.');
    runtime.facilitator = url.href.replace(/\/$/, '');
  }
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a boolean.');
  if (raw.allowLocalFacilitator === true) runtime.allowLocalFacilitator = true;
  return runtime;
}
async function connectionJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024 || process.platform !== 'win32' &&
        ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Use an owned private S3 connection JSON file, at most one MiB.');
    const bytes = await handle.readFile();
    if (bytes.length > 1024 * 1024) throw failure('CONFIGURATION_ERROR', 'The S3 connection file exceeds one MiB.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw failure('CONFIGURATION_ERROR', 'The S3 connection file must contain valid UTF-8 JSON.'); }
  } finally { await handle.close(); }
}

/** Resolve host-owned directories only. Opening the configuration performs no S3 operation. */
export async function readS3WorkspaceConfiguration(path, { releaseStore } = {}) {
  path = resolve(path);
  const raw = await connectionJson(path);
  exact(raw, ['schema', 'releaseStore', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== S3_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 S3 workspaces in the original S3 connection schema.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  const selectedStore = raw.releaseStore === undefined ? null : await realpath(hostPath(raw.releaseStore, base));
  if (selectedStore && releaseStore && selectedStore !== await realpath(releaseStore))
    throw failure('CONFIGURATION_ERROR', 'The S3 workspaces and merchant operator must use the same original release store.');
  for (const [alias, item] of Object.entries(raw.workspaces)) {
    identifier(alias, 'S3 workspace alias');
    exact(item, ['label', 'directory', 'runtime'], ['directory']);
    const directory = await realpath(hostPath(item.directory, base));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original S3 workspace directory one alias.');
    seen.add(directory);
    workspaces[alias] = { label: line(item.label ?? alias, 'S3 workspace label'), directory,
      runtime: runtimeOptions(item.runtime) };
  }
  return { releaseStore: selectedStore ?? (releaseStore ? await realpath(releaseStore) : null), workspaces };
}



function revisionView(value, includeSource = false) {
  if (!value) return null;
  return { ...pick(value, ['revision', 'operationId', 'savedAt', 'sourceSha256', 'paymentSha256', 'origin', 'payment']),
    sourceAvailable: Boolean(value.source), ...(includeSource ? { source: value.source } : {}) };
}
function packageView(value) {
  return pick(value, ['packageId', 'revision', 'reviewId', 'state', 'files', 'sourceConfigSha256',
    'objectsSha256', 'offersSha256', 'serviceConfigSha256']);
}
function releaseView(value) {
  return value ? pick(value, ['id', 'label', 'digest', 'createdAt', 'schema', 'sourceType', 'sourceDigests']) : null;
}
function operationView(value) {
  return pick(value, ['operationId', 'id', 'kind', 'state', 'revision', 'reviewId', 'packageId', 'releaseId',
    'startedAt', 'completedAt', 'updatedAt', 'inputSha256', 'error']);
}
function statusView(value) {
  return { workspaceId: value.workspaceId, draft: revisionView(value.draft), history: value.history,
    reviews: value.reviews, packages: (value.packages ?? []).map(packageView),
    operations: (value.operations ?? []).map(operationView), busy: value.busy,
    releases: value.releases ? { state: value.releases.state, releases: (value.releases.releases ?? []).map(releaseView) } : null };
}

export class MerchantS3Workspaces {
  #config; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  constructor(config) { this.#config = config; }
  get summary() {
    const workspaces = this.#config.s3Workspaces?.workspaces ?? {};
    return { configured: Object.keys(workspaces).length > 0, count: Object.keys(workspaces).length,
      opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing };
  }
  #entry(alias) {
    identifier(alias, 'S3 workspace alias');
    const entry = this.#config.s3Workspaces?.workspaces?.[alias];
    if (!entry) throw failure('S3_WORKSPACE_NOT_CONFIGURED', 'Choose a configured S3 workspace from merchant_s3_status.');
    return entry;
  }
  async #status(alias) {
    if (alias === undefined) return { ...this.summary, workspaces: Object.entries(this.#config.s3Workspaces?.workspaces ?? {})
      .map(([workspace, entry]) => ({ workspace, label: entry.label, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED' })) };
    const entry = this.#entry(alias), handle = this.#handles.get(alias);
    return { workspace: alias, label: entry.label, state: handle ? 'OPEN' : 'CLOSED',
      ...(handle ? { authoring: statusView(await (await handle).status()) } : {}) };
  }
  async #open(alias) {
    const entry = this.#entry(alias);
    if (!this.#handles.has(alias)) {
      const promise = (async () => {
        const { openS3MerchantWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/s3/workspace/controller.mjs');
        return openS3MerchantWorkspace({ directory: entry.directory, releaseStore: this.#config.releaseStore });
      })();
      this.#handles.set(alias, promise);
      try { await promise; } catch (error) { if (this.#handles.get(alias) === promise) this.#handles.delete(alias); throw error; }
    }
    return this.#status(alias);
  }
  async #execute(name, args) {
    if (name === 'merchant_s3_status') return this.#status(args.workspace);
    const entry = this.#entry(args.workspace);
    if (name === 'merchant_s3_open') return this.#open(args.workspace);
    if (name === 'merchant_s3_close') {
      const promise = this.#handles.get(args.workspace);
      if (promise) { await (await promise).close(); this.#handles.delete(args.workspace); }
      return { workspace: args.workspace, state: 'CLOSED' };
    }
    const promise = this.#handles.get(args.workspace);
    if (!promise) throw failure('S3_WORKSPACE_CLOSED', 'Open this saved workspace with merchant_s3_open.');
    const model = await promise;
    switch (name) {
      case 'merchant_s3_history': return model.history({
        ...(args.beforeRevision === undefined ? {} : { beforeRevision: positive(args.beforeRevision, 'Before revision') }),
        ...(args.limit === undefined ? {} : { limit: positive(args.limit, 'Page limit', 1, 100) }) });
      case 'merchant_s3_revision': {
        if (args.includeSource !== undefined && typeof args.includeSource !== 'boolean')
          throw failure('INVALID_PARAMS', 'includeSource must be a boolean.');
        return revisionView(await model.revision({ revision: positive(args.revision, 'Revision') }), args.includeSource === true);
      }
      case 'merchant_s3_save': {
        if (!plain(args.source) || !plain(args.payment) || typeof args.origin !== 'string')
          throw failure('INVALID_PARAMS', 'Supply the original source/payment objects and public origin text.');
        return revisionView(await model.save({ expectedRevision: positive(args.expectedRevision, 'Expected revision', 0),
          operationId: operation(args.operationId), source: args.source, payment: args.payment, origin: args.origin }));
      }
      case 'merchant_s3_review': return model.review({ revision: positive(args.revision, 'Revision'), operationId: operation(args.operationId) });
      case 'merchant_s3_review_status': return model.getReview({ reviewId: originalRecord(args.reviewId, 'review ID') });
      case 'merchant_s3_prepare': return packageView(await model.prepare({ revision: positive(args.revision, 'Revision'),
        reviewId: originalRecord(args.reviewId, 'review ID'), operationId: operation(args.operationId) }));
      case 'merchant_s3_package': return packageView(await model.getPackage({ packageId: originalRecord(args.packageId, 'package ID') }));
      case 'merchant_s3_stage': {
        const value = await model.stage({ packageId: originalRecord(args.packageId, 'package ID'),
          releaseId: identifier(args.releaseId, 'Release ID'), operationId: operation(args.operationId), runtime: entry.runtime });
        return { workspace: args.workspace, operationId: value.operationId, packageId: value.packageId,
          release: releaseView(value.release), lifecycle: 'merchant_compare → merchant_activate → merchant_start' };
      }
      case 'merchant_s3_customer': return model.exportCustomer({ releaseId: identifier(args.releaseId, 'Release ID') });
      case 'merchant_s3_customer_file': {
        if (!['objects.json', 'offers.json'].includes(args.file)) throw failure('INVALID_PARAMS', 'Choose an original objects.json or offers.json file.');
        return model.readCustomerFile({ releaseId: identifier(args.releaseId, 'Release ID'), file: args.file,
          expectedSha256: digest(args.expectedSha256), offset: positive(args.offset ?? 0, 'Byte offset', 0),
          limit: positive(args.limit ?? 49152, 'Chunk size', 1, 65536) });
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown S3 authoring operation.');
    }
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The S3 authoring operator is closing.');
    const promise = this.#execute(name, args);
    this.#pending.add(promise);
    try { return await promise; } finally { this.#pending.delete(promise); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const results = await Promise.allSettled([...this.#handles.values()].map(async value => (await value).close()));
      this.#handles.clear();
      if (results.some(value => value.status === 'rejected'))
        throw failure('S3_WORKSPACE_CLOSE_FAILED', 'An original S3 workspace reported an incomplete shutdown.');
    })();
    return this.#close;
  }
}
