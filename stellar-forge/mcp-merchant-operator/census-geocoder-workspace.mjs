// MIT. Agent and browser access to the original Census geocoder workspace.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory, fileBytes } from './config.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { UUID, HASH, publisherFields, publisherFileKinds } from './catalog/census-geocoder-workspace.mjs';
export { censusGeocoderWorkspaceTools } from './catalog/census-geocoder-workspace.mjs';

export const CENSUS_GEOCODER_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.census-geocoder-workspace-connection.v1';
const NATIVE = '../../stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/';










function count(value, label, low = 0, high = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < low || value > high)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + low + ' through ' + high + '.');
  return value;
}
function nativeId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use the exact original workspace record UUID.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare original host paths in the private Census geocoder connection.');
  return resolve(base, value);
}
async function declaredPath(value, base, kind) {
  const path = hostPath(value, base), actual = await realpath(path), info = await lstat(path);
  if (actual !== path || kind === 'file' && !info.isFile() || kind === 'directory' && !info.isDirectory())
    throw failure('CONFIGURATION_ERROR', 'Use a canonical original ' + kind + ' path.');
  if (kind === 'directory') await privateSupportDirectory(path);
  return path;
}
async function connectionJSON(path) {
  if (await realpath(path) !== resolve(path)) throw failure('CONFIGURATION_ERROR', 'Use the canonical private connection file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 1024 * 1024 || process.platform !== 'win32' &&
        ((before.mode & 0o077) || process.getuid && before.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Use an owned private connection JSON file, at most one MiB.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw failure('CONFIGURATION_ERROR', 'The original connection changed while being read.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
function entries(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32) throw failure('CONFIGURATION_ERROR', 'Declare at most 32 named ' + label + '.');
  return Object.entries(value).map(([name, item]) => [identifier(name, label + ' alias'), item]);
}
function runtime(raw = {}) {
  exact(raw, ['port', 'facilitator', 'allowLocalFacilitator']);
  count(raw.port ?? 0, 'Merchant port', 0, 65535);
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be Boolean.');
  if (raw.facilitator !== undefined) {
    const url = new URL(raw.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(raw.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Use the configured HTTPS or explicitly allowed loopback facilitator.');
  }
  return { ...raw, port: raw.port ?? 0 };
}
/** Resolve host declarations without opening a workspace or issuing Census HTTP. */
export async function readCensusGeocoderWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await connectionJSON(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== CENSUS_GEOCODER_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original Census geocoder workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'Census geocoder workspace alias');
    exact(input, ['label', 'directory', 'imports', 'merchants', 'buyerWorkspaces', 'runtime'], ['directory']);
    const directory = await declaredPath(input.directory, base, 'directory');
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original geocoder workspace one alias.');
    seen.add(directory);
    const imports = Object.create(null), merchants = Object.create(null), buyerWorkspaces = Object.create(null);
    for (const [key, item] of entries(input.imports, 'imports')) {
      if (!plain(item)) throw failure('CONFIGURATION_ERROR', 'Declare an original address CSV or native captured-response directory.');
      if (['addresses', 'customer-addresses'].includes(item.kind)) {
        exact(item, ['kind', 'label', 'file', 'header'], ['kind', 'file']);
        if (item.header !== undefined && typeof item.header !== 'boolean') throw failure('CONFIGURATION_ERROR', 'CSV header must be Boolean.');
        imports[key] = { kind: item.kind, label: line(item.label ?? key), file: await declaredPath(item.file, base, 'file'), header: item.header ?? (item.kind === 'customer-addresses') };
      } else if (item.kind === 'recording') {
        exact(item, ['kind', 'label', 'directory'], ['kind', 'directory']);
        imports[key] = { kind: 'recording', label: line(item.label ?? key), directory: await declaredPath(item.directory, base, 'directory') };
      } else throw failure('CONFIGURATION_ERROR', 'Import kind is addresses, customer-addresses or recording.');
    }
    for (const [key, item] of entries(input.merchants, 'merchant profiles')) {
      exact(item, ['label', 'origin', 'path', 'payment'], ['origin', 'path', 'payment']);
      if (!plain(item.payment) || typeof item.origin !== 'string' || typeof item.path !== 'string')
        throw failure('CONFIGURATION_ERROR', 'Use the original merchant origin, route and complete public payment terms.');
      merchants[key] = { label: line(item.label ?? key), origin: item.origin, path: item.path, payment: structuredClone(item.payment) };
    }
    for (const [key, item] of entries(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(item, ['label', 'directory'], ['directory']);
      buyerWorkspaces[key] = { label: line(item.label ?? key), directory: await declaredPath(item.directory, base, 'directory') };
    }
    workspaces[name] = { label: line(input.label ?? name), directory, imports, merchants, buyerWorkspaces, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}

function page(rows, offset, limit) {
  return { values: rows.slice(offset, offset + limit), offset, limit, total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null };
}
function history(state, offset = 0, limit = 50) {
  const result = { ...state, pages: {} };
  for (const name of ['metadata', 'batches', 'reviews', 'editions', 'imports', 'customerSources', 'customerMappings', 'customerBindings', 'customerBatchOperations']) {
    const selected = page(state[name] ?? [], offset, limit);
    result[name] = selected.values.map(item => name === 'batches' ? { ...item,
      attempts: item.attempts.slice(-20), attemptsTotal: item.attempts.length,
      attemptsHistory: 'merchant_census_geocoder_batch history' } : name === 'customerSources' ? { ...item,
        columns: item.columns.slice(0, 8), columnCount: item.columns.length,
        columnInspection: 'merchant_census_geocoder_customer inspect' } : item);
    const { values, ...info } = selected; result.pages[name] = info;
  }
  return result;
}
function payload(value, allowed) {
  if (!plain(value ?? {})) throw failure('INVALID_PARAMS', 'Use the original action payload object.');
  const result = { ...(value ?? {}) }; exact(result, allowed); return result;
}
export class MerchantCensusGeocoderWorkspaces {
  #config; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'CENSUS_GEOCODER' });
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.censusGeocoderWorkspaces),
    opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing, ...this.#reads.summary }; }
  #declared(name) {
    identifier(name, 'Census geocoder workspace alias');
    const entry = this.#config.censusGeocoderWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('CENSUS_GEOCODER_WORKSPACE_NOT_CONFIGURED', 'Choose a host alias from merchant_census_geocoder_status.');
    return entry;
  }
  async #open(name, create = false) {
    const configuration = this.#declared(name);
    if (typeof create !== 'boolean') throw failure('INVALID_PARAMS', 'create must be Boolean.');
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const { openGeocoderWorkspace } = await import(NATIVE + 'workspace.mjs');
        const operator = await openGeocoderWorkspace({ directory: configuration.directory, create });
        return { configuration, operator, instanceId: randomUUID(), browser: null,
          pending: new Set(), browserTail: Promise.resolve(), closing: false, close: null };
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { if (this.#handles.get(name) === opening) this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.censusGeocoderWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
        imports: Object.entries(entry.imports).map(([sourceImport, item]) => ({ sourceImport, label: item.label, kind: item.kind, ...(['addresses', 'customer-addresses'].includes(item.kind) ? { header: item.header } : {}) })),
        merchants: Object.entries(entry.merchants).map(([profile, item]) => ({ profile, ...item })),
        buyerWorkspaces: Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace, item]) => ({ buyerWorkspace, label: item.label }))
      })) };
    const entry = this.#declared(name), opening = this.#handles.get(name);
    if (!opening) return { workspace: name, label: entry.label, state: 'CLOSED' };
    const handle = await opening;
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      native: handle.closing ? null : history(await handle.operator.status(), offset, limit),
      ...(handle.closeError ? { closeError: handle.closeError } : {}), browser: { open: Boolean(handle.browser) },
      fileReads: this.#reads.status(name) };
  }
  async #cancelCapture(handle) {
    try { await handle.operator.act('operation.cancel', {}); }
    catch (error) {
      if (!['GEOCODER_CAPTURE_NOT_ACTIVE', 'GEOCODER_WORKSPACE_CLOSED'].includes(error.code)) throw error;
    }
  }
  #stop(name, handle) {
    if (handle.close) return handle.close;
    handle.closing = true;
    const browser = handle.browser;
    const browserClosing = browser ? browser.close() : Promise.resolve();
    // Observe this rejection immediately while original accepted actions drain.
    void browserClosing.catch(() => {});
    const stopping = (async () => {
      const cancellation = await Promise.allSettled([this.#cancelCapture(handle)]);
      await Promise.allSettled([...handle.pending]);
      const lateBrowserClosing = handle.browser && handle.browser !== browser ? handle.browser.close() : Promise.resolve();
      const outcomes = [...cancellation, ...await Promise.allSettled([browserClosing, lateBrowserClosing, this.#reads.closeScope(name), handle.operator.close()])];
      const failed = outcomes.filter(item => item.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(item => item.reason), 'Original Census geocoder shutdown is incomplete.');
      handle.browser = null; this.#handles.delete(name);
      return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
    })();
    handle.close = stopping;
    void stopping.catch(error => {
      if (handle.close === stopping) handle.close = null;
      handle.closeError = { code: error.code ?? 'CENSUS_GEOCODER_SHUTDOWN_INCOMPLETE', message: error.message };
    });
    return stopping;
  }
  async #file(name, handle, args) {
    nativeId(args.id);
    if (args.expectedSha256 !== undefined && !HASH.test(args.expectedSha256))
      throw failure('INVALID_PARAMS', 'Use the exact retained file SHA-256.');
    return this.#reads.read({ scope: name, key: args.kind + ':' + args.id + ':' + (args.filename ?? ''),
      kind: args.kind, directory: this.#config.exportsDirectory, expectedSha256: args.expectedSha256,
      readId: args.readId, offset: args.offset, limit: args.limit,
      load: async () => {
        if (args.kind === 'edition-file') {
          const { reopenEdition } = await import(NATIVE + 'edition.mjs');
          const current = await handle.operator.status({ includePublisher: false });
          if (!current.editions.some(item => item.id === args.id)) throw failure('CENSUS_GEOCODER_EDITION_UNKNOWN', 'Choose an original retained edition.');
          const edition = await reopenEdition(join(handle.configuration.directory, 'editions', args.id));
          const descriptor = edition.files.find(item => item.path === args.filename);
          if (!descriptor && args.filename !== 'edition.json')
            throw failure('CENSUS_GEOCODER_EDITION_FILE_UNKNOWN', 'Choose an exact filename from the original edition manifest.');
          const bytes = await fileBytes(join(edition.directory, args.filename), 64 * 1024 * 1024);
          if (descriptor && (bytes.length !== descriptor.bytes || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256))
            throw failure('CENSUS_GEOCODER_EDITION_CHANGED', 'The original edition member changed before reading.');
          return { bytes, name: args.filename, type: args.filename.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8' };
        }
        const kind = publisherFileKinds.includes(args.kind) ? 'publisher:' + args.kind : args.kind;
        if (!['input', 'response', 'dataset', 'provenance', 'seller', 'manifest', 'customer-input', 'customer-mapping', 'customer-submitted', 'customer-results', 'customer-results-json'].includes(args.kind) && !publisherFileKinds.includes(args.kind))
          throw failure('INVALID_PARAMS', 'Choose an original Census or publisher file kind.');
        const file = await handle.operator.download(kind, args.id);
        return { bytes: file.bytes, name: file.filename, type: file.contentType };
      } });
  }
  async #execute(name, handle, args) {
    const original = handle.operator, entry = handle.configuration;
    const call = async (action, selected = {}) => {
      if ((this.#closing || handle.closing) && ['discovery.benchmarks', 'discovery.vintages', 'batch.capture'].includes(action))
        throw failure('CENSUS_GEOCODER_CAPTURE_CANCELLED', 'Workspace shutdown cancelled this source request before dispatch.');
      const result = await original.act(action, selected);
      return { workspace: args.workspace, instanceId: handle.instanceId, result, state: history(await original.status()) };
    };
    switch (name) {
      case 'merchant_census_geocoder_discovery': {
        if (!['benchmarks', 'vintages'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose benchmarks or vintages.');
        return call('discovery.' + args.action, payload(args.payload, args.action === 'benchmarks' ? [] : ['discoveryId', 'benchmark']));
      }
      case 'merchant_census_geocoder_batch': {
        if (args.action === 'create') {
          const value = payload(args.payload, ['sourceImport', 'label', 'discoveryId', 'vintagesId', 'benchmark', 'vintage', 'returnType']);
          const source = entry.imports[identifier(value.sourceImport, 'Address import')];
          if (source?.kind !== 'addresses') throw failure('CENSUS_GEOCODER_IMPORT_NOT_CONFIGURED', 'Choose a declared address CSV.');
          const bytes = await fileBytes(source.file, 5_000_000);
          const inputText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const { sourceImport, ...selected } = value;
          return call('batch.create', { ...selected, label: selected.label ?? source.label, inputText, header: source.header });
        }
        if (args.action === 'capture') return call('batch.capture', payload(args.payload, ['batchId', 'retry', 'timeoutMs']));
        if (args.action === 'inspect') {
          const value = payload(args.payload, ['id', 'attemptId', 'status', 'offset', 'limit']);
          const { id, ...options } = value;
          const result = await original.inspectBatch(nativeId(id), options);
          const batch = { ...result.batch, attempts: result.batch.attempts.slice(-20), attemptsTotal: result.batch.attempts.length };
          return { workspace: args.workspace, instanceId: handle.instanceId, ...result, batch };
        }
        if (args.action === 'history') {
          const value = payload(args.payload, ['id', 'offset', 'limit']);
          const state = await original.status({ includePublisher: false });
          const batch = state.batches.find(item => item.id === nativeId(value.id));
          if (!batch) throw failure('CENSUS_GEOCODER_BATCH_UNKNOWN', 'Choose an original batch.');
          return { workspace: args.workspace, batchId: batch.id, currentAttempt: batch.currentAttempt,
            attempts: page(batch.attempts, count(value.offset ?? 0, 'Attempt offset'), count(value.limit ?? 50, 'Attempt limit', 1, 100)) };
        }
        throw failure('INVALID_PARAMS', 'Choose create, inspect, history or capture.');
      }
      case 'merchant_census_geocoder_customer': {
        if (args.action === 'source') {
          const value = payload(args.payload, ['sourceImport', 'label']);
          const source = entry.imports[identifier(value.sourceImport, 'Customer CSV import')];
          if (source?.kind !== 'customer-addresses') throw failure('CENSUS_GEOCODER_IMPORT_NOT_CONFIGURED', 'Choose a declared original customer CSV.');
          const bytes = await fileBytes(source.file, 5_000_000);
          const inputText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          return call('customer.source', { label: value.label ?? source.label, inputText, header: source.header });
        }
        const fields = {
          preview: ['sourceId', 'plan', 'offset', 'limit', 'filter'],
          mapping: ['sourceId', 'plan', 'expectedReviewSha256'],
          inspect: ['sourceId', 'mappingId', 'offset', 'limit', 'filter'],
          batch: ['mappingId', 'expectedReviewSha256', 'label', 'discoveryId', 'vintagesId', 'benchmark', 'vintage', 'returnType'],
          bind: ['mappingId', 'expectedReviewSha256', 'batchId']
        };
        if (!Object.hasOwn(fields, args.action)) throw failure('INVALID_PARAMS', 'Choose source, preview, mapping, inspect, batch or bind.');
        return call('customer.' + args.action, payload(args.payload, fields[args.action]));
      }
      case 'merchant_census_geocoder_import': {
        const source = entry.imports[identifier(args.sourceImport, 'Capture import')];
        if (source?.kind !== 'recording') throw failure('CENSUS_GEOCODER_IMPORT_NOT_CONFIGURED', 'Choose a declared original capture directory.');
        return call('capture.import', { directory: source.directory });
      }
      case 'merchant_census_geocoder_review':
        return call('batch.review', { batchId: args.batchId, attemptId: args.attemptId, responseSha256: args.responseSha256, plan: args.plan });
      case 'merchant_census_geocoder_edition': {
        const profile = args.profile === undefined ? null : entry.merchants[identifier(args.profile, 'Merchant profile')];
        if (args.profile !== undefined && !profile) throw failure('CENSUS_GEOCODER_MERCHANT_NOT_CONFIGURED', 'Choose a declared visible merchant profile.');
        const selected = profile ? { origin: profile.origin, path: profile.path, payment: profile.payment } : {};
        return call('edition.build', { reviewId: args.reviewId, ...selected, ...(args.mappingId === undefined ? {} : { mappingId: nativeId(args.mappingId) }) });
      }
      case 'merchant_census_geocoder_query': return call('edition.query', { id: args.id, query: args.query });
      case 'merchant_census_geocoder_export':
        return call('edition.export', { id: nativeId(args.id), directory: join(this.#config.exportsDirectory, 'census-geocoder-' + args.workspace + '-' + args.id) });
      case 'merchant_census_geocoder_file': return this.#file(args.workspace, handle, args);
      case 'merchant_census_geocoder_file_release':
        await this.#reads.release(args.workspace, args.readId);
        return { workspace: args.workspace, readId: args.readId, released: true };
      case 'merchant_census_geocoder_publisher': {
        if (!Object.hasOwn(publisherFields, args.action)) throw failure('INVALID_PARAMS', 'Choose an original publisher operation.');
        const value = payload(args.payload, publisherFields[args.action]);
        if (args.action === 'publisher.release.stage') return call(args.action, { ...value, runtime: entry.runtime });
        if (args.action === 'publisher.buyer.session') {
          const buyer = entry.buyerWorkspaces[identifier(value.buyerWorkspace, 'Buyer workspace')];
          if (!buyer) throw failure('CENSUS_GEOCODER_BUYER_NOT_CONFIGURED', 'Choose a declared original SF88 buyer workspace.');
          const { buyerWorkspace, ...selected } = value;
          return call(args.action, { ...selected, workspaceDirectory: buyer.directory });
        }
        return call(args.action, value);
      }
      case 'merchant_census_geocoder_cancel': return call('operation.cancel');
      case 'merchant_census_geocoder_browser': return this.#browser(handle, args);
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Census geocoder workspace operation.');
    }
  }
  #browser(handle, args) {
    const task = handle.browserTail.then(async () => {
        if (args.action === 'close') {
          if (handle.browser) { await handle.browser.close(); handle.browser = null; }
          return { workspace: args.workspace, instanceId: handle.instanceId, browser: 'CLOSED' };
        }
        if (args.action !== 'open') throw failure('INVALID_PARAMS', 'Choose open or close.');
        if (!handle.browser) {
          const { startGeocoderServer } = await import(NATIVE + 'server.mjs');
          handle.browser = await startGeocoderServer({ workspace: handle.operator, port: count(args.port ?? 0, 'Browser port', 0, 65535), closeWorkspace: false });
        }
        return { workspace: args.workspace, instanceId: handle.instanceId, browser: 'OPEN',
          url: handle.browser.operatorUrl, origin: handle.browser.url };
    });
    handle.browserTail = task.then(() => {}, () => {});
    return task;
  }
  async #dispatch(name, args) {
    if (name === 'merchant_census_geocoder_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_census_geocoder_open') return this.#open(args.workspace, args.create ?? false);
    this.#declared(args.workspace);
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('CENSUS_GEOCODER_WORKSPACE_CLOSED', 'Open the original workspace first.');
    const handle = await opening;
    if (name === 'merchant_census_geocoder_close') {
      if (args.instanceId !== handle.instanceId) throw failure('INSTANCE_CONFLICT', 'Use the current process-owned instanceId from status.');
      return this.#stop(args.workspace, handle);
    }
    if (handle.closing) throw failure('CENSUS_GEOCODER_WORKSPACE_CLOSING', 'The original workspace is draining. Retry its exact-instance close.');
    const task = this.#execute(name, handle, args);
    handle.pending.add(task);
    try { return await task; } finally { handle.pending.delete(task); }
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The Census geocoder owner is closing.');
    const task = this.#dispatch(name, args);
    this.#pending.add(task);
    try { return await task; } finally { this.#pending.delete(task); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    const closing = (async () => {
      // Stop browser admission immediately while original accepted work drains.
      const stopping = Promise.allSettled([...this.#handles].map(async ([name, opening]) => this.#stop(name, await opening)));
      await Promise.allSettled([...this.#pending]);
      const outcomes = await stopping;
      await this.#reads.close();
      const failed = outcomes.filter(item => item.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(item => item.reason), 'Original Census workspace shutdown is incomplete.');
    })();
    this.#close = closing;
    void closing.catch(() => { if (this.#close === closing) this.#close = null; });
    return closing;
  }
}
