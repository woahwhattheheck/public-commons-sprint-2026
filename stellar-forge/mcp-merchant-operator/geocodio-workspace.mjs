// MIT. Agent and browser operation of the original address review workspace and publisher.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory, fileBytes } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const GEOCODIO_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.geocodio-workspace-connection.v1';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const text = { type: 'string', minLength: 1, maxLength: 200 };
const object = { type: 'object', additionalProperties: true };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const read = { readOnly: true, idempotent: true };
const publisherActions = new Set([
  'publisher.status', 'publisher.prepare', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage', 'publisher.release.inspect',
  'publisher.release.activate', 'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session', 'publisher.buyer.run',
  'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export'
]);
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Geocodio host paths belong in the private connection file.');
  return resolve(base, value);
}
function count(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
async function connectionJSON(path) {
  if (await realpath(path) !== resolve(path)) throw failure('CONFIGURATION_ERROR', 'Use the canonical private connection file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || process.platform !== 'win32' &&
        ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Use an owned private Geocodio connection JSON file, at most one MiB.');
    const bytes = await file.readFile();
    if (bytes.length > 1024 * 1024) throw failure('CONFIGURATION_ERROR', 'The connection file exceeds one MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
function entries(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Use up to 32 named ' + label + '.');
  return Object.entries(value).map(([name, entry]) => [identifier(name, label + ' alias'), entry]);
}
function runtime(raw = {}) {
  exact(raw, ['port', 'facilitator', 'allowLocalFacilitator']);
  count(raw.port ?? 0, 'Seller port', 0, 65535);
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  if (raw.facilitator !== undefined) {
    const url = new URL(raw.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(raw.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Use the original configured HTTPS or explicit loopback facilitator.');
  }
  return { ...raw, port: raw.port ?? 0 };
}
async function declaredFile(value, base) {
  const path = hostPath(value, base), actual = await realpath(path), info = await lstat(path);
  if (actual !== path || !info.isFile())
    throw failure('CONFIGURATION_ERROR', 'Declare an original regular import file through its canonical path.');
  return path;
}
/** Resolve original host inputs without opening a workspace or contacting Geocodio. */
export async function readGeocodioWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await connectionJSON(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== GEOCODIO_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original Geocodio workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'Geocodio workspace alias');
    exact(input, ['label', 'directory', 'apiKeyEnv', 'timeoutMs', 'imports', 'merchants', 'buyerWorkspaces', 'runtime'], ['directory']);
    const directory = await realpath(hostPath(input.directory, base));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original address workspace one alias.');
    seen.add(directory);
    if (input.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv))
      throw failure('CONFIGURATION_ERROR', 'Use an existing environment-variable name for the provider key.');
    const timeoutMs = count(input.timeoutMs ?? 900000, 'Provider timeout', 1000, 900000);
    const imports = Object.create(null), merchants = Object.create(null), buyers = Object.create(null);
    for (const [key, item] of entries(input.imports, 'retained imports')) {
      exact(item, ['label', 'kind', 'file', 'format', 'sourceFile', 'sourceURL', 'provenance', 'mapping',
        'requestFile', 'mode', 'queryId', 'queryIds', 'receipt'], ['kind', 'file']);
      if (!['intake', 'response', 'package'].includes(item.kind))
        throw failure('CONFIGURATION_ERROR', 'An import is an original intake, provider response, or portable package.');
      const configured = { label: line(item.label ?? key), kind: item.kind, file: await declaredFile(item.file, base) };
      if (item.kind === 'intake') {
        if (!['intake', 'csv', 'json', 'simplyrets'].includes(item.format ?? 'intake'))
          throw failure('CONFIGURATION_ERROR', 'Choose an original intake, CSV, JSON records, or SimplyRETS input.');
        configured.format = item.format ?? 'intake';
        if (item.sourceFile !== undefined) configured.sourceFile = await declaredFile(item.sourceFile, base);
        if (item.sourceURL !== undefined) configured.sourceURL = line(item.sourceURL);
        if (item.provenance !== undefined) configured.provenance = line(item.provenance);
        if (item.mapping !== undefined) {
          if (!plain(item.mapping)) throw failure('CONFIGURATION_ERROR', 'Use the original explicit address mapping object.');
          configured.mapping = structuredClone(item.mapping);
        }
      } else if (item.kind === 'response') {
        configured.mode = item.mode ?? 'object';
        if (!['object', 'array', 'single'].includes(configured.mode))
          throw failure('CONFIGURATION_ERROR', 'Choose the original object, ordered array, or single response binding.');
        if (configured.mode === 'single') {
          configured.queryId = originalId(item.queryId);
        } else {
          configured.requestFile = await declaredFile(item.requestFile, base);
          if (configured.mode === 'array') {
            if (!Array.isArray(item.queryIds) || !item.queryIds.length || item.queryIds.length > 10000 ||
                new Set(item.queryIds).size !== item.queryIds.length)
              throw failure('CONFIGURATION_ERROR', 'An array response needs its complete ordered original query IDs.');
            configured.queryIds = item.queryIds.map(originalId);
          }
        }
        if (item.receipt !== undefined) {
          if (!plain(item.receipt)) throw failure('CONFIGURATION_ERROR', 'Use the actual public provider receipt object.');
          configured.receipt = structuredClone(item.receipt);
        }
      }
      const allowed = item.kind === 'intake' ? ['label','kind','file','format','sourceFile','sourceURL','provenance','mapping'] :
        item.kind === 'response' ? ['label','kind','file','requestFile','mode','queryId','queryIds','receipt'] : ['label','kind','file'];
      exact(item, allowed);
      imports[key] = configured;
    }
    for (const [key, item] of entries(input.merchants, 'merchant profiles')) {
      exact(item, ['label', 'origin', 'path', 'payment'], ['origin', 'path', 'payment']);
      if (!plain(item.payment) || typeof item.origin !== 'string' || typeof item.path !== 'string')
        throw failure('CONFIGURATION_ERROR', 'Merchant profiles contain the original public origin, route and payment terms.');
      merchants[key] = { label: line(item.label ?? key), origin: item.origin, path: item.path, payment: item.payment };
    }
    for (const [key, item] of entries(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(item, ['label', 'directory'], ['directory']);
      const buyerDirectory = await realpath(hostPath(item.directory, base));
      await privateSupportDirectory(buyerDirectory);
      buyers[key] = { label: line(item.label ?? key), directory: buyerDirectory };
    }
    workspaces[name] = { label: line(input.label ?? name), directory, apiKeyEnv: input.apiKeyEnv ?? 'GEOCODIO_API_KEY',
      timeoutMs, imports, merchants, buyerWorkspaces: buyers, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}
export function geocodioWorkspaceTools(tool) {
  const revision = { type: 'integer', minimum: 0 };
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_geocodio_status', 'List declared address/customer workspaces or read an opened original workspace. Addresses, responses, requests, editions, exports and duplicate groups have explicit history offsets. Provider credentials are represented only by a configured flag.',
      scoped({ offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }), [], read),
    tool('merchant_geocodio_open', 'Open the original host-declared address operator under its existing writer lease. Repeated open reuses this instance; provider requests and the dataset publisher start only through their explicit actions.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_geocodio_close', 'Close this process-owned address operator after its accepted operations and borrowed browser drain. Original sources, requests, review decisions, editions and customer sessions remain retained.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_geocodio_intake', 'Import a host-declared exact CSV, JSON/SimplyRETS response, or retained address intake. The original parser preserves numeric identifier text, all source rows and exact address-query bindings. Optional mapping uses the native source mapping schema.',
      scoped({ sourceImport: alias, expectedRevision: revision, mapping: object, operationId: text }),
      ['workspace', 'sourceImport', 'expectedRevision']),
    tool('merchant_geocodio_provider', 'Prepare, inspect, run or import an original Geocodio request. Prepare requires maximumLookups (1–10000); the saved request retains its exact lookup count and body SHA-256. Run requires id, expectedRequestSha256 and expectedRevision, and contacts the actual provider using the host environment key. Import selects a host-declared original response and request binding. Request reads paginate the original keyed body; merchant_geocodio_file reads its exact bytes. The native operator records SENDING before HTTP and retains uncertain/provider outcomes for reconciliation.',
      scoped({ action: { enum: ['prepare', 'request', 'run', 'import'] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_geocodio_policy', 'Save the original visible match-review thresholds for accuracy, accuracy type, competing candidates, stable keys, country and source-coordinate displacement. Qualification remains separate from an explicit recorded address decision.',
      scoped({ expectedRevision: revision, policy: object }), ['workspace', 'expectedRevision', 'policy']),
    tool('merchant_geocodio_review', 'List or inspect original address candidates and source records, record an explicit candidate/coordinate decision, or apply the exact displayed qualified selection. Mutation payloads require expectedRevision and a reason; the original decision history and original coordinates remain retained.',
      scoped({ action: { enum: ['list', 'query', 'decide', 'acceptQualified'] }, payload: object }), ['workspace', 'action']),
    tool('merchant_geocodio_edition', 'Build a native dataset from all original source rows or reviewed rows and selected source fields, or activate an original retained edition. Both actions require expectedRevision. Uses the maintained SF30 CSV/query engine and source-specific review basis.',
      scoped({ action: { enum: ['build', 'activate'] }, payload: object }), ['workspace', 'action']),
    tool('merchant_geocodio_query', 'Run the selected original native dataset query, projection, sort and snapshot-bound cursor. expectedRevision binds the saved query update to the current address workspace.',
      scoped({ expectedRevision: revision, query: object }), ['workspace', 'expectedRevision', 'query']),
    tool('merchant_geocodio_merchant', 'Prepare the original selected dataset with a host-declared public merchant payment profile using the native seller compiler.',
      scoped({ profile: alias, expectedRevision: revision }), ['workspace', 'profile', 'expectedRevision']),
    tool('merchant_geocodio_export', 'Create the original complete portable workspace and customer-ready native dataset, source/review/query files, exact original raw closure, and configured seller. Uses the original Geocodio source schema and sourceFiles descriptors.',
      scoped({ expectedRevision: revision }), ['workspace', 'expectedRevision']),
    tool('merchant_geocodio_restore', 'Restore a declared complete portable package into an empty original address workspace. The native importer checks retained file bytes and rebuilds every original dataset snapshot before accepting it.',
      scoped({ sourceImport: alias, expectedRevision: revision }), ['workspace', 'sourceImport', 'expectedRevision']),
    tool('merchant_geocodio_file', 'Read an exact source export, prepared provider request, or original publisher customer file in verified retained chunks. Continue with readId, expectedSha256 and nextOffset. EOF releases the cached snapshot; partial reads can be explicitly released.',
      scoped({ kind: { enum: ['source-export', 'provider-request', 'draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'] },
        id: text, filename: { type: 'string', maxLength: 500 }, ...chunk }), ['workspace', 'kind', 'id'], read),
    tool('merchant_geocodio_file_release', 'Release an unfinished process-owned retained file read while keeping the original file available.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_geocodio_publisher', 'Use all 20 original dataset publisher, SF82 release and SF88 customer actions. Prepare chooses this address workspace exportId; staging uses host runtime configuration; buyer session creation chooses a host buyerWorkspace. Native draft/release generations, approvals, original ledger and page attempts remain authoritative. Explicit unpaid continuation passes retryUnpaid and expectedAttemptSha256 through publisher.buyer.run.',
      scoped({ action: { enum: [...publisherActions] }, payload: object }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_geocodio_browser', 'Open or close an industrial browser on this exact original operator and its lazy publisher. The returned private local URL is for this process. Closing a borrowed browser leaves the MCP-owned address workspace open.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }), ['workspace', 'action']),
  ];
}
function pageRows(rows, offset, limit) {
  const values = rows.slice(offset, offset + limit);
  return { values, page: { offset, limit, total: rows.length, nextOffset: offset + values.length < rows.length ? offset + values.length : null } };
}
function sourceView(state, offset = 0, limit = 50) {
  const result = { ...state, pages: {} };
  for (const key of ['addresses', 'duplicates', 'responses', 'requests', 'editions', 'exports']) {
    const { values, page } = pageRows(state[key] ?? [], offset, limit);
    result[key] = key === 'exports' ? values.map(({ directory, packageFile, ...item }) => item) : values;
    result.pages[key] = page;
  }
  return result;
}
async function exactRetainedBytes(path, descriptor) {
  const bytes = await fileBytes(path, 256 * 1024 * 1024);
  if (bytes.length !== descriptor.bytes || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256)
    throw failure('GEOCODIO_RETAINED_CHANGED', 'The original retained file changed before its chunk snapshot was opened.');
  return bytes;
}
function originalId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value))
    throw failure('INVALID_PARAMS', 'Use the exact retained native record ID.');
  return value;
}
function only(raw, keys) { exact(raw, keys); return raw; }
export class MerchantGeocodioWorkspaces {
  #config; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'GEOCODIO' });
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.geocodioWorkspaces),
    opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing, ...this.#reads.summary }; }
  #declared(name) {
    identifier(name, 'Geocodio workspace alias');
    const entry = this.#config.geocodioWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('GEOCODIO_WORKSPACE_NOT_CONFIGURED', 'Choose an alias from merchant_geocodio_status.');
    return entry;
  }
  async #open(name) {
    const configuration = this.#declared(name);
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const apiKey = process.env[configuration.apiKeyEnv];
        const { openGeocodioOperator } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/server.mjs');
        const operator = await openGeocodioOperator({ directory: configuration.directory, apiKey, timeoutMs: configuration.timeoutMs });
        return { configuration, operator, instanceId: randomUUID(), browser: null, tail: Promise.resolve(), closing: false };
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { if (this.#handles.get(name) === opening) this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.geocodioWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
        imports: Object.entries(entry.imports).map(([sourceImport, item]) => ({ sourceImport, label: item.label, kind: item.kind })),
        merchants: Object.entries(entry.merchants).map(([profile, item]) => ({ profile, label: item.label, origin: item.origin, path: item.path, payment: item.payment })),
        buyerWorkspaces: Object.entries(entry.buyerWorkspaces).map(([buyerWorkspace, item]) => ({ buyerWorkspace, label: item.label }))
      })) };
    const configuration = this.#declared(name), pending = this.#handles.get(name);
    if (!pending) return { workspace: name, label: configuration.label, state: 'CLOSED' };
    const handle = await pending;
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      native: sourceView(await handle.operator.state(), offset, limit), browser: { open: Boolean(handle.browser) },
      fileReads: this.#reads.status(name) };
  }
  async #stop(name, handle) {
    handle.closing = true;
    await handle.tail.catch(() => {});
    if (handle.browser) { await handle.browser.close(); handle.browser = null; }
    await this.#reads.closeScope(name);
    await handle.operator.close();
    this.#handles.delete(name);
    return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
  }
  async #file(name, handle, args) {
    originalId(args.id);
    if (args.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.expectedSha256)) throw failure('INVALID_PARAMS', 'Choose the exact original file SHA-256.');
    const key = args.kind + ':' + args.id + ':' + (args.filename ?? '');
    return this.#reads.read({ scope: name, key, kind: args.kind, directory: this.#config.exportsDirectory,
      expectedSha256: args.expectedSha256, readId: args.readId, offset: args.offset, limit: args.limit,
      load: async () => {
        if (args.kind === 'source-export') {
          if (typeof args.filename !== 'string') throw failure('INVALID_PARAMS', 'Choose an original filename from this export.');
          const file = await handle.operator.readExport(args.id, args.filename);
          return { bytes: await exactRetainedBytes(file.path, file), name: args.filename, type: file.contentType };
        }
        if (args.kind === 'provider-request') {
          const { result } = await handle.operator.act('provider.request', { id: args.id });
          return { bytes: await exactRetainedBytes(result.path, result.request.request), name: result.request.id + '.json',
            type: 'application/json; charset=utf-8' };
        }
        if (!['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'].includes(args.kind))
          throw failure('INVALID_PARAMS', 'Choose a supported original publisher file kind.');
        const file = await handle.operator.readPublisherExport(args.kind, args.id);
        return { bytes: file.bytes, name: file.filename, type: file.contentType };
      } });
  }
  async #execute(name, handle, args) {
    const entry = handle.configuration, original = handle.operator;
    const call = async (action, payload = {}) => {
      const result = await original.act(action, payload);
      return { ...result, state: sourceView(result.state) };
    };
    switch (name) {
      case 'merchant_geocodio_intake': {
        const source = entry.imports[identifier(args.sourceImport, 'Source import')];
        if (!source || source.kind !== 'intake') throw failure('GEOCODIO_IMPORT_NOT_CONFIGURED', 'Choose a declared original address intake.');
        return call('intake.import', { expectedRevision: args.expectedRevision, path: source.file, format: source.format,
          ...(source.sourceFile ? { sourcePath: source.sourceFile } : {}),
          ...(source.sourceURL ? { sourceURL: source.sourceURL } : {}),
          ...(source.provenance ? { provenance: source.provenance } : {}),
          ...((args.mapping ?? source.mapping) === undefined ? {} : { mapping: args.mapping ?? source.mapping }),
          ...(args.operationId === undefined ? {} : { operationId: args.operationId }) });
      }
      case 'merchant_geocodio_provider': {
        const payload = { ...(args.payload ?? {}) };
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Use an original provider action payload.');
        if (args.action === 'prepare') {
          only(payload, ['expectedRevision','maximumLookups','queryIds','refresh']);
          return call('provider.prepare', payload);
        }
        if (args.action === 'run') {
          only(payload, ['expectedRevision','id','expectedRequestSha256']);
          return call('provider.run', payload);
        }
        if (args.action === 'request') {
          only(payload, ['id','offset','limit']);
          const offset = count(payload.offset ?? 0, 'Query offset', 0, 10000);
          const limit = count(payload.limit ?? 50, 'Query page size', 1, 500);
          const response = await original.act('provider.request', { id: originalId(payload.id) });
          const { values, page } = pageRows(Object.entries(response.result.body), offset, limit);
          return { result: { request: response.result.request, body: Object.fromEntries(values), page,
            file: { kind: 'provider-request', id: response.result.request.id, ...response.result.request.request } },
            state: sourceView(response.state) };
        }
        if (args.action === 'import') {
          only(payload, ['expectedRevision','sourceImport','requestId']);
          const source = entry.imports[identifier(payload.sourceImport, 'Provider response import')];
          if (!source || source.kind !== 'response') throw failure('GEOCODIO_IMPORT_NOT_CONFIGURED', 'Choose a declared original provider response.');
          return call('provider.import', { expectedRevision: payload.expectedRevision, responsePath: source.file, mode: source.mode,
            ...(source.requestFile ? { requestPath: source.requestFile } : {}),
            ...(source.queryId ? { queryId: source.queryId } : {}),
            ...(source.queryIds ? { queryIds: source.queryIds } : {}),
            ...(source.receipt ? { receipt: source.receipt } : {}),
            ...(payload.requestId === undefined ? {} : { requestId: payload.requestId }) });
        }
        throw failure('INVALID_PARAMS', 'Choose prepare, request, run or import.');
      }
      case 'merchant_geocodio_policy':
        return call('policy.save', { expectedRevision: args.expectedRevision, policy: args.policy });
      case 'merchant_geocodio_review': {
        const payload = { ...(args.payload ?? {}) };
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Use an original review payload.');
        const fields = {
          list: ['status','search','offset','limit'],
          query: ['queryId'],
          decide: ['expectedRevision','queryId','action','candidateId','coordinateChoice','note'],
          acceptQualified: ['expectedRevision','queryIds','coordinateChoice','note']
        };
        if (!Object.hasOwn(fields, args.action)) throw failure('INVALID_PARAMS', 'Choose list, query, decide or acceptQualified.');
        only(payload, fields[args.action]);
        return call('review.' + args.action, payload);
      }
      case 'merchant_geocodio_edition': {
        const payload = { ...(args.payload ?? {}) };
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Use an original edition payload.');
        if (args.action === 'build') {
          only(payload, ['expectedRevision','name','scope','sourceColumns','defaultLimit','maxLimit']);
          return call('edition.build', payload);
        }
        if (args.action === 'activate') {
          only(payload, ['expectedRevision','editionId']); originalId(payload.editionId);
          return call('edition.activate', payload);
        }
        throw failure('INVALID_PARAMS', 'Choose build or activate.');
      }
      case 'merchant_geocodio_query':
        return call('dataset.query', { expectedRevision: args.expectedRevision, query: args.query });
      case 'merchant_geocodio_merchant': {
        const profile = entry.merchants[identifier(args.profile, 'Merchant profile')];
        if (!profile) throw failure('GEOCODIO_MERCHANT_NOT_CONFIGURED', 'Choose a declared public merchant profile.');
        const { label, ...merchant } = profile;
        return call('merchant.configure', { expectedRevision: args.expectedRevision, merchant });
      }
      case 'merchant_geocodio_export':
        return call('package.export', { expectedRevision: args.expectedRevision });
      case 'merchant_geocodio_restore': {
        const source = entry.imports[identifier(args.sourceImport, 'Source import')];
        if (!source || source.kind !== 'package') throw failure('GEOCODIO_IMPORT_NOT_CONFIGURED', 'Choose a declared original portable address package.');
        return call('package.import', { path: source.file, expectedRevision: args.expectedRevision });
      }
      case 'merchant_geocodio_file': return this.#file(args.workspace, handle, args);
      case 'merchant_geocodio_file_release':
        await this.#reads.release(args.workspace, args.readId); return { workspace: args.workspace, readId: args.readId, released: true };
      case 'merchant_geocodio_publisher': {
        if (!publisherActions.has(args.action)) throw failure('INVALID_PARAMS', 'Choose an original publisher action.');
        const payload = { ...(args.payload ?? {}) };
        if (!plain(args.payload ?? {})) throw failure('INVALID_PARAMS', 'Use an object publisher payload.');
        if (args.action === 'publisher.prepare') {
          only(payload, ['exportId']);
          const selected = (await original.state()).exports.find(item => item.id === payload.exportId);
          if (!selected) throw failure('GEOCODIO_EXPORT_NOT_FOUND', 'Choose an original export ID from this source workspace.');
          return call(args.action, { exportDirectory: selected.directory });
        }
        if (args.action === 'publisher.release.stage') {
          only(payload, ['draftId', 'id', 'label']);
          return call(args.action, { ...payload, runtime: entry.runtime });
        }
        if (args.action === 'publisher.buyer.session') {
          only(payload, ['buyerId','buyerWorkspace','maxPages','maxTotalAtomic','maxRows','maxPageBytes']);
          const buyer = entry.buyerWorkspaces[identifier(payload.buyerWorkspace, 'Buyer workspace')];
          if (!buyer) throw failure('GEOCODIO_BUYER_NOT_CONFIGURED', 'Choose a host-declared original buyer workspace.');
          const { buyerWorkspace, ...selected } = payload;
          return call(args.action, { ...selected, workspaceDirectory: buyer.directory });
        }
        // Original action schemas validate all other draft/release/session inputs.
        return call(args.action, payload);
      }
      case 'merchant_geocodio_browser': {
        if (args.action === 'close') {
          if (handle.browser) { await handle.browser.close(); handle.browser = null; }
          return { workspace: args.workspace, browser: 'CLOSED', instanceId: handle.instanceId };
        }
        if (args.action !== 'open') throw failure('INVALID_PARAMS', 'Choose open or close.');
        if (!handle.browser) {
          const { startGeocodioWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/server.mjs');
          handle.browser = await startGeocodioWorkspace({ directory: entry.directory, operator: original,
            port: count(args.port ?? 0, 'Browser port', 0, 65535) });
        }
        return { workspace: args.workspace, instanceId: handle.instanceId, url: handle.browser.url, browser: 'OPEN' };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Geocodio workspace operation.');
    }
  }
  async #dispatch(name, args) {
    if (name === 'merchant_geocodio_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_geocodio_open') return this.#open(args.workspace);
    this.#declared(args.workspace);
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('GEOCODIO_WORKSPACE_CLOSED', 'Open this original workspace with merchant_geocodio_open.');
    const handle = await opening;
    if (handle.closing) throw failure('GEOCODIO_WORKSPACE_CLOSING', 'The original workspace is closing.');
    if (name === 'merchant_geocodio_close') {
      if (args.instanceId !== handle.instanceId) throw failure('INSTANCE_CONFLICT', 'Use this process-owned instance ID from status.');
      return this.#stop(args.workspace, handle);
    }
    const operation = handle.tail.then(() => this.#execute(name, handle, args));
    handle.tail = operation.then(() => {}, () => {});
    return operation;
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The Geocodio adapter is closing.');
    const operation = this.#dispatch(name, args);
    this.#pending.add(operation);
    try { return await operation; } finally { this.#pending.delete(operation); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => this.#stop(name, await pending)));
      await this.#reads.close();
      if (outcomes.some(item => item.status === 'rejected')) throw failure('GEOCODIO_CLOSE_FAILED', 'An original Geocodio operator reported incomplete shutdown.');
    })();
    return this.#close;
  }
}
