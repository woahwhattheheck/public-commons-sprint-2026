// MIT. Agents and people continue the same original OData source and customer workspace.
import { constants } from 'node:fs';
import { open, realpath, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { normalizeSourceUrl, compileQuery, getEntitySet } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/source.mjs';
import { digest, stable, formatted, writeNew, identifier as nativeId } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/state.mjs';
import { readReleaseState, inspectRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

export const ODATA_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.odata-workspace-connection.v1';
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const recordId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' };
const text = { type: 'string', minLength: 1, maxLength: 240 };
const object = { type: 'object', additionalProperties: true };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const read = { readOnly: true, idempotent: true };
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const artifactNames = { transfer: 'odata-workspace.json', comparison: 'comparison.json' };
function count(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare original OData host paths in the private connection file.');
  return resolve(base, value);
}
async function ownedBytes(path, maximum, privateFile = false) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum || privateFile && process.platform !== 'win32' &&
        ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
      throw failure('ODATA_INPUT_FILE', 'Use the declared regular source file within its size limit and private configuration permissions.');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw failure('ODATA_INPUT_SIZE', 'The original input exceeds its file size limit.');
    return bytes;
  } finally { await file.close(); }
}
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function entries(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare up to 32 named ' + label + '.');
  return Object.entries(value).map(([name, entry]) => [identifier(name, label + ' alias'), entry]);
}
function runtime(input = {}) {
  exact(input, ['port', 'facilitator', 'allowLocalFacilitator']);
  const result = { ...input, port: count(input.port ?? 0, 'Seller port', 0, 65535) };
  if (input.allowLocalFacilitator !== undefined && typeof input.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  if (input.facilitator !== undefined) {
    const url = new URL(input.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(input.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Declare the original HTTPS or explicit local facilitator URL.');
  }
  return result;
}
/** Resolve host-declared workspaces, provider services and original files; open no source connection. */
export async function readODataWorkspaceConfiguration(path) {
  path = resolve(path);
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Use the canonical private OData connection file.');
  const raw = json(await ownedBytes(path, 1024 * 1024, true));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== ODATA_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original OData workspaces.');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'OData workspace alias');
    exact(input, ['label', 'directory', 'services', 'imports', 'responses', 'merchants', 'runtime'], ['directory']);
    const directory = await realpath(hostPath(input.directory, base));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original OData directory one workspace alias.');
    seen.add(directory);
    const services = Object.create(null), imports = Object.create(null), responses = Object.create(null), merchants = Object.create(null);
    for (const [key, item] of entries(input.services, 'provider services')) {
      exact(item, ['label', 'url', 'authEnv', 'allowLoopback'], ['url']);
      if (item.allowLoopback !== undefined && typeof item.allowLoopback !== 'boolean')
        throw failure('CONFIGURATION_ERROR', 'allowLoopback must be a Boolean.');
      if (item.authEnv !== undefined && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(item.authEnv))
        throw failure('CONFIGURATION_ERROR', 'authEnv is the original Authorization environment-variable name.');
      services[key] = { label: line(item.label ?? key), url: normalizeSourceUrl(item.url, { allowLoopback: item.allowLoopback === true }),
        authEnv: item.authEnv ?? null, allowLoopback: item.allowLoopback === true };
    }
    for (const [kind, target] of [['imports', imports], ['responses', responses]]) {
      for (const [key, item] of entries(input[kind], kind)) {
        exact(item, ['label', 'file', 'sha256'], ['file']);
        const file = await realpath(hostPath(item.file, base));
        if (!(await lstat(file)).isFile()) throw failure('CONFIGURATION_ERROR', 'Declare a regular original input file.');
        if (item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256))
          throw failure('CONFIGURATION_ERROR', 'A retained input SHA-256 has 64 lowercase hexadecimal characters.');
        target[key] = { label: line(item.label ?? key), file, sha256: item.sha256 ?? null };
      }
    }
    for (const [key, item] of entries(input.merchants, 'merchant profiles')) {
      exact(item, ['label', 'origin', 'path', 'payment', 'amount', 'maxPageRows', 'maxTotalRows', 'port', 'operationsPort', 'facilitator'],
        ['origin', 'path', 'payment', 'amount']);
      const origin = new URL(item.origin);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
        throw failure('CONFIGURATION_ERROR', 'Declare the public HTTPS merchant origin.');
      if (typeof item.path !== 'string' || !/^\/[^?#\x00-\x20]*$/.test(item.path))
        throw failure('CONFIGURATION_ERROR', 'Declare the original public merchant route path.');
      exact(item.payment, ['network', 'asset', 'payTo', 'maxTimeoutSeconds'], ['network', 'asset', 'payTo']);
      for (const field of ['network', 'asset', 'payTo']) line(item.payment[field], 'Payment ' + field);
      if (typeof item.amount !== 'string' || !/^[1-9]\d{0,29}$/.test(item.amount))
        throw failure('CONFIGURATION_ERROR', 'Declare the positive exact atomic price as text.');
      const payment = { ...item.payment, maxTimeoutSeconds: count(item.payment.maxTimeoutSeconds ?? 60, 'Payment timeout', 1, 86400) };
      const selected = { label: line(item.label ?? key), origin: origin.origin, path: item.path, payment, amount: item.amount,
        port: count(item.port ?? 0, 'Live merchant port', 0, 65535), operationsPort: count(item.operationsPort ?? 0, 'Live operations port', 0, 65535) };
      for (const field of ['maxPageRows', 'maxTotalRows']) if (item[field] !== undefined)
        selected[field] = count(item[field], field, 1, 1000000000);
      if (item.facilitator !== undefined) {
        const url = new URL(item.facilitator);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
          throw failure('CONFIGURATION_ERROR', 'Declare the original live HTTPS facilitator URL.');
        selected.facilitator = url.href;
      }
      merchants[key] = selected;
    }
    workspaces[name] = { label: line(input.label ?? name), directory, services, imports, responses, merchants, runtime: runtime(input.runtime) };
  }
  return { workspaces };
}

export function odataWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunks = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  return [
    tool('merchant_odata_status', 'List host-declared source/customer workspaces or page an open original workspace: connections, saved queries, editions, reviews, exports, live products and owned imports. Each history returns its own nextOffset.',
      scoped(paging), [], read),
    tool('merchant_odata_open', 'Open a declared original OData workspace and reuse the same process instance on repeat. Provider requests, merchant runtimes and the browser open only through their selected operations.',
      scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_odata_close', 'Drain accepted operations, pause owned imports and close this exact process-owned workspace, merchant runtimes and borrowed browser. Retained source editions and customer files remain available on reopen.',
      scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_odata_source', 'Connect a host-declared OData service under a stable connectionId or refresh the original catalog of an existing connection. Uses the actual service document and CSDL metadata; credential values remain in the original host environment.',
      scoped({ action: { enum: ['connect', 'refresh'] }, service: alias, connectionId: recordId, name: text }),
      ['workspace', 'action', 'connectionId'], { openWorld: true }),
    tool('merchant_odata_catalog', 'Page advertised original entity sets or the exact structural properties of one entity set. Returns retained metadata/source hashes, entity keys, types, nullable and collection details.',
      scoped({ connectionId: recordId, entitySet: text, ...paging }), ['workspace', 'connectionId'], read),
    tool('merchant_odata_plan', 'Save, inspect or review a native structured OData query. Save uses a stable planId, complete select/filter/order/count/pageSize/top input and the original compiler. Repeating the same saved query returns its original ID.',
      scoped({ action: { enum: ['save', 'inspect', 'review'] }, planId: recordId, connectionId: recordId, name: text, query: object,
        note: { type: 'string', minLength: 1, maxLength: 4000 } }), ['workspace', 'action', 'planId']),
    tool('merchant_odata_capture', 'Start, resume or pause an original source edition. Start requires a stable editionId and reviewed planId. Each provider page and nextLink is committed before the following request. The default returns immediately so status and pause remain usable; wait:true awaits this native capture step.',
      scoped({ action: { enum: ['start', 'resume', 'pause'] }, editionId: recordId, planId: recordId, label: text,
        pageBudget: { type: 'integer', minimum: 1, maximum: 100000 }, wait: { type: 'boolean' } }),
      ['workspace', 'action', 'editionId'], { openWorld: true }),
    tool('merchant_odata_edition', 'Inspect an original edition with paged source receipts and receiving decisions, or accept/request work on a complete edition. Acceptance selects the existing edition for dataset export.',
      scoped({ action: { enum: ['inspect', 'review'] }, editionId: recordId, decision: { enum: ['accept', 'needs-work'] },
        note: { type: 'string', minLength: 1, maxLength: 4000 }, ...paging }), ['workspace', 'action', 'editionId']),
    tool('merchant_odata_rows', 'Read a page of retained native entity rows by editionId. Reads only overlapping original normalized pages, verifies their hashes and keeps Decimal/Int64 text and null/missing distinctions.',
      scoped({ editionId: recordId, ...paging }), ['workspace', 'editionId'], read),
    tool('merchant_odata_compare', 'Compute the original keyed difference between two complete editions, retain that whole comparison once, and page added/removed/changed records. Its comparisonId downloads the complete unchanged comparison.',
      scoped({ beforeId: recordId, afterId: recordId, ...paging }), ['workspace', 'beforeId', 'afterId'], { idempotent: true }),
    tool('merchant_odata_export', 'Export an accepted edition through the original typed dataset projection. An optional declared merchant profile adds its public payment terms. Returns the original immutable exportId and CSV/JSON/source/seller filenames.',
      scoped({ editionId: recordId, name: text, fields: { type: 'array', minItems: 1, maxItems: 32, items: text }, profile: alias,
        defaultLimit: { type: 'integer', minimum: 1, maximum: 10000 }, maxLimit: { type: 'integer', minimum: 1, maximum: 10000 } }),
      ['workspace', 'editionId'], { idempotent: true }),
    tool('merchant_odata_query', 'Query an original dataset export using its native query string, projection, sorting and cursor. The dataset engine returns the original status and body.',
      scoped({ exportId: recordId, query: { type: 'string', maxLength: 32768 } }), ['workspace', 'exportId'], read),
    tool('merchant_odata_publisher', 'Operate this workspace’s original SF82 dataset release store: inspect/status, prepare, activate/rollback, start or stop. Selection changes use the observed generation; startup also checks the inspected digest. Original child lifecycle and configured host runtime govern execution.',
      scoped({ action: { enum: ['status', 'prepare', 'inspect', 'activate', 'rollback', 'start', 'stop'] }, exportId: recordId,
        releaseId: recordId, label: text, expectedGeneration: { type: 'integer', minimum: 0 }, expectedDigest: hash,
        reason: text, instanceId: uuid }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_odata_live', 'Prepare a live product from a reviewed saved query and a declared public merchant profile, inspect/page its original buyer and receiving histories, or start/stop the same native merchant and private operations listener.',
      scoped({ action: { enum: ['status', 'prepare', 'detail', 'start', 'stop'] }, liveServiceId: recordId, planId: recordId,
        profile: alias, name: text, operation: recordId, ...paging }), ['workspace', 'action'], { openWorld: true }),
    tool('merchant_odata_buyer', 'Prepare or reopen the original SF88 request/offers/buyer handoff for a stable purchase intent. Supply receivedId to continue that original paid-page cursor. The existing SF88 buyer executes the returned configuration with its configured signer and purchase policy.',
      scoped({ liveServiceId: recordId, intentId: text, receivedId: hash }), ['workspace', 'liveServiceId', 'intentId'], { idempotent: true }),
    tool('merchant_odata_receive', 'Receive the exact saved merchant response from a host-declared response alias or this live product’s original buyer response file. The existing validator retains its original bytes, normalized rows and unchanged next-page request; duplicate bytes reuse the same receivedId.',
      scoped({ liveServiceId: recordId, response: alias, buyerId: hash }), ['workspace', 'liveServiceId'], { idempotent: true }),
    tool('merchant_odata_transfer', 'Create/list a complete retained workspace transfer, or restore a declared original transfer file or another declared workspace’s transfer into the empty destination. Create keeps the stable transferId on repeat; restore reconciles the original committed transfer identity.',
      scoped({ action: { enum: ['create', 'list', 'restore'] }, transferId: recordId, sourceImport: alias, sourceWorkspace: alias, ...paging }),
      ['workspace', 'action'], { idempotent: true }),
    tool('merchant_odata_file', 'Read a complete original source, dataset, live package, SF88 handoff, received page, transfer or comparison through the shared retained-file reader. Continue with readId, expectedSha256 and nextOffset; the original file is loaded once and released at EOF.',
      scoped({ kind: { enum: ['source', 'dataset', 'live-package', 'buyer', 'receiving', 'transfer', 'comparison'] },
        id: recordId, recordId, filename: { type: 'string', maxLength: 160 }, ...chunks }), ['workspace', 'kind', 'id'], read),
    tool('merchant_odata_file_release', 'Release an unfinished retained-file read while keeping its original file.',
      scoped({ readId: uuid }), ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_odata_browser', 'Open or close the industrial browser over the same original workspace and live operations object. Closing this borrowed browser leaves the agent-owned source imports and merchant services open.',
      scoped({ action: { enum: ['open', 'close'] }, port: { type: 'integer', minimum: 0, maximum: 65535 } }),
      ['workspace', 'action'], { idempotent: true }),
  ];
}
function pageRows(rows, offset = 0, limit = 50) {
  count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
  const values = rows.slice(offset, offset + limit);
  return { values, page: { offset, limit, total: rows.length, nextOffset: offset + values.length < rows.length ? offset + values.length : null } };
}
function planView(record) {
  const { query, ...rest } = record;
  return { ...rest, entitySet: query.entitySet, queryUrl: query.url, queryFingerprint: query.fingerprint,
    keyFields: query.keyFields, fieldCount: query.fields.length };
}
function connectionView(record) {
  const { catalog, ...rest } = record;
  return { ...rest, catalog: { schema: catalog.schema, version: catalog.version, entitySets: catalog.entitySets.length,
    receipts: catalog.receipts } };
}
function editionView(record, offset = 0, limit = 50) {
  const { catalog, pages, query, decisions, ...rest } = record;
  const sourcePages = pageRows(pages, offset, limit), reviews = pageRows(decisions ?? [], offset, limit);
  return { ...rest, entitySet: query.entitySet, query: query.plan, queryUrl: query.url, queryFingerprint: query.fingerprint,
    keyFields: query.keyFields, pageCount: pages.length, pages: sourcePages.values, decisions: reviews.values,
    pagination: { pages: sourcePages.page, decisions: reviews.page } };
}
function sourceView(state, offset = 0, limit = 50) {
  const result = { ...state, pagination: {} };
  for (const key of ['connections', 'plans', 'editions', 'reviews', 'exports', 'liveProducts']) {
    const { values, page } = pageRows(state[key] ?? [], offset, limit);
    result[key] = values.map(record => key === 'connections' ? connectionView(record) : key === 'plans' ? planView(record) :
      key === 'exports' ? (({ directory, ...rest }) => rest)(record) : record);
    result.pagination[key] = page;
  }
  return result;
}
function only(args, fields, required = []) {
  exact(args, ['workspace', 'action', ...fields], ['workspace', 'action', ...required]); return args;
}
function publicRecord(record) { const { directory, ...rest } = record; return rest; }

export class MerchantODataWorkspaces {
  #config; #handles = new Map(); #pending = new Set(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'ODATA' });
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.odataWorkspaces),
    opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing, ...this.#reads.summary }; }
  #declared(name) {
    identifier(name, 'OData workspace alias');
    const entry = this.#config.odataWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('ODATA_WORKSPACE_NOT_CONFIGURED', 'Choose a workspace alias from merchant_odata_status.');
    return entry;
  }
  #service(entry, connection) {
    const found = Object.values(entry.services).find(item => item.url === connection.url &&
      item.authEnv === (connection.authEnv || null) && item.allowLoopback === (connection.allowLoopback === true));
    if (!found) throw failure('ODATA_SERVICE_NOT_CONFIGURED', 'This original provider connection needs its matching service declaration in the host connection file.');
    return found;
  }
  #find(rows, id, label) {
    nativeId(id, label + ' ID');
    const selected = rows.find(item => item.id === id);
    if (!selected) throw failure('ODATA_RECORD_NOT_FOUND', 'Choose an original ' + label + ' ID from workspace status.');
    return selected;
  }
  #profile(entry, name) {
    const selected = entry.merchants[identifier(name, 'Merchant profile')];
    if (!selected) throw failure('ODATA_MERCHANT_NOT_CONFIGURED', 'Choose a host-declared merchant profile.');
    return selected;
  }
  async #planSource(handle, planId) {
    const state = await handle.workspace.state(), plan = this.#find(state.plans, planId, 'plan');
    this.#service(handle.configuration, this.#find(state.connections, plan.connectionId, 'connection'));
    return plan;
  }
  async #live(handle) {
    if (!handle.live) {
      const { openODataLiveOperations } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live-operations.mjs');
      handle.live = await openODataLiveOperations({ workspace: handle.workspace });
    }
    return handle.live;
  }
  async #publisher(handle) {
    if (!handle.publisher) {
      const { openODataPublisher } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/publisher.mjs');
      handle.publisher = await openODataPublisher({ workspace: handle.workspace });
    }
    return handle.publisher;
  }
  async #open(name) {
    const configuration = this.#declared(name);
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const { openODataWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/workspace.mjs');
        const workspace = await openODataWorkspace({ directory: configuration.directory });
        return { configuration, workspace, instanceId: randomUUID(), browser: null, live: null, publisher: null,
          publisherRun: null, captures: new Map(), tail: Promise.resolve(), closing: false };
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { if (this.#handles.get(name) === opening) this.#handles.delete(name); throw error; }
    }
    return this.#status(name);
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset, 'History offset'); count(limit, 'History page size', 1, 100);
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.odataWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
        services: Object.entries(entry.services).map(([service, item]) => ({ service, label: item.label, url: item.url,
          authentication: item.authEnv ? 'HOST_ENVIRONMENT' : 'PUBLIC' })),
        imports: Object.entries(entry.imports).map(([sourceImport, item]) => ({ sourceImport, label: item.label, sha256: item.sha256 })),
        responses: Object.entries(entry.responses).map(([response, item]) => ({ response, label: item.label, sha256: item.sha256 })),
        merchants: Object.entries(entry.merchants).map(([profile, item]) => ({ profile, ...item }))
      })) };
    const configuration = this.#declared(name), opening = this.#handles.get(name);
    if (!opening) return { workspace: name, label: configuration.label, state: 'CLOSED' };
    const handle = await opening;
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      native: sourceView(await handle.workspace.state(), offset, limit), browser: { open: Boolean(handle.browser) },
      publisher: this.#runView(handle.publisherRun), fileReads: this.#reads.status(name) };
  }
  #runView(run) {
    return run ? { instanceId: run.observation.instanceId, releaseId: run.release.id, digest: run.release.digest,
      state: run.observation.phase, url: run.url, mode: run.mode, operations: run.operations?.url ?? null } : null;
  }
  async #stop(name, handle) {
    handle.closing = true;
    await handle.tail.catch(() => {});
    const results = [];
    if (handle.browser) {
      results.push(...await Promise.allSettled([handle.browser.close()]));
      if (results.at(-1).status === 'fulfilled') handle.browser = null;
    }
    results.push(...await Promise.allSettled([handle.live?.close(), handle.publisherRun?.close(),
      handle.workspace.close(), this.#reads.closeScope(name)]));
    if (results.some(item => item.status === 'rejected')) {
      handle.closing = false;
      throw failure('ODATA_CLOSE_FAILED', 'An owned original OData runtime reported an incomplete shutdown.');
    }
    this.#handles.delete(name);
    return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
  }
  #artifactDirectory(workspace, kind, id) {
    this.#declared(workspace);
    if (!Object.hasOwn(artifactNames, kind)) throw failure('INVALID_PARAMS', 'Choose an original transfer or comparison.');
    return join(this.#config.exportsDirectory, 'odata-workspaces', workspace, kind, nativeId(id));
  }
  async #artifact(workspace, kind, id, includeBytes = false) {
    const directory = this.#artifactDirectory(workspace, kind, id), record = json(await ownedBytes(join(directory, 'manifest.json'), 65536, true));
    if (record.schema !== 'stellar-forge.odata-mcp-file.v1' || record.kind !== kind || record.id !== id ||
        record.workspaceSha256 !== digest(this.#declared(workspace).directory) || record.name !== artifactNames[kind] ||
        !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > 256_000_000)
      throw failure('ODATA_FILE_CHANGED', 'The retained original OData file manifest differs.');
    const result = { record };
    if (includeBytes) {
      result.bytes = await ownedBytes(join(directory, record.name), 256_000_000);
      if (result.bytes.length !== record.bytes || digest(result.bytes) !== record.sha256)
        throw failure('ODATA_FILE_CHANGED', 'The original OData file differs from its retained manifest.');
    }
    return result;
  }
  async #retain(workspace, kind, id, make, source = null) {
    const existing = await this.#artifact(workspace, kind, id).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing) {
      if (source && stable(existing.record.source) !== stable(source))
        throw failure('ODATA_FILE_EXISTS', 'This retained file ID belongs to a different original operation.');
      return existing.record;
    }
    const bytes = Buffer.from(await make());
    if (bytes.length > 256_000_000) throw failure('ODATA_FILE_SIZE', 'The complete original file exceeds the retained download limit.');
    const directory = this.#artifactDirectory(workspace, kind, id), parent = dirname(directory);
    await mkdir(parent, { recursive: true, mode: 0o700 }); await privateSupportDirectory(parent);
    const stage = join(parent, '.stage-' + randomUUID());
    await mkdir(stage, { mode: 0o700 });
    const record = { schema: 'stellar-forge.odata-mcp-file.v1', workspaceSha256: digest(this.#declared(workspace).directory),
      kind, id, name: artifactNames[kind], contentType: 'application/json; charset=utf-8', bytes: bytes.length,
      sha256: digest(bytes), createdAt: new Date().toISOString(), source };
    try {
      await writeNew(join(stage, record.name), bytes); await writeNew(join(stage, 'manifest.json'), formatted(record));
      const folder = await open(stage, 'r'); try { await folder.sync(); } finally { await folder.close(); }
      try { await rename(stage, directory); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        const retained = await this.#artifact(workspace, kind, id);
        if (source && stable(retained.record.source) !== stable(source)) throw failure('ODATA_FILE_EXISTS', 'A different original operation owns this file ID.');
        return retained.record;
      }
      const parentFolder = await open(parent, 'r'); try { await parentFolder.sync(); } finally { await parentFolder.close(); }
      return record;
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async #listArtifacts(workspace, kind, offset, limit) {
    const parent = dirname(this.#artifactDirectory(workspace, kind, 'entry'));
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return pageRows([], offset, limit); throw error; }
    const records = [];
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.'))
      records.push((await this.#artifact(workspace, kind, entry.name)).record);
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return pageRows(records, offset, limit);
  }
  async #declaredInput(collection, name, maximum) {
    const source = collection[identifier(name, 'Input alias')];
    if (!source) throw failure('ODATA_INPUT_NOT_CONFIGURED', 'Choose a declared original input alias.');
    const bytes = await ownedBytes(source.file, maximum);
    if (source.sha256 && digest(bytes) !== source.sha256) throw failure('ODATA_INPUT_CHANGED', 'The original declared input SHA-256 differs.');
    return bytes;
  }
  async #file(name, handle, args) {
    nativeId(args.id);
    return this.#reads.read({ scope: name, key: [args.kind, args.id, args.recordId ?? '', args.filename ?? ''].join(':'),
      kind: args.kind, directory: this.#config.exportsDirectory, expectedSha256: args.expectedSha256,
      readId: args.readId, offset: args.offset, limit: args.limit, load: async () => {
        if (args.kind === 'source') return { bytes: await handle.workspace.raw(args.id), name: args.id + '.source',
          type: 'application/octet-stream' };
        if (args.kind === 'dataset') {
          const record = this.#find((await handle.workspace.state()).exports, args.id, 'export');
          if (!record.files.includes(args.filename)) throw failure('ODATA_FILE_NOT_FOUND', 'Choose an original filename from this dataset export.');
          return { bytes: await ownedBytes(join(handle.workspace.directory, 'exports', record.id, args.filename), 256_000_000),
            name: args.filename, type: args.filename.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8' };
        }
        if (['live-package', 'buyer', 'receiving'].includes(args.kind)) {
          const file = await (await this.#live(handle)).file({ id: args.id, kind: args.kind === 'live-package' ? 'package' : args.kind,
            recordId: args.recordId, name: args.filename });
          return { bytes: file.bytes, name: file.name, type: file.name.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json; charset=utf-8' };
        }
        const file = await this.#artifact(name, args.kind, args.id, true);
        return { bytes: file.bytes, name: file.record.name, type: file.record.contentType };
      } });
  }
  async #rows(handle, args) {
    const record = await handle.workspace.edition(nativeId(args.editionId)), offset = count(args.offset ?? 0, 'Row offset'),
      limit = count(args.limit ?? 50, 'Row page size', 1, 100), rows = [];
    let position = 0;
    for (const page of record.pages) {
      if (position >= offset + limit) break;
      if (position + page.rowCount > offset) {
        const values = json(await handle.workspace.raw(page.rowsSha256));
        if (!Array.isArray(values) || values.length !== page.rowCount) throw failure('ODATA_ROWS_CHANGED', 'The retained original normalized page differs.');
        rows.push(...values.slice(Math.max(0, offset - position), Math.min(page.rowCount, offset + limit - position)));
      }
      position += page.rowCount;
    }
    return { editionId: record.id, status: record.status, contentHash: record.contentHash ?? null,
      queryFingerprint: record.query.fingerprint, keyFields: record.query.keyFields, rows,
      page: { offset, limit, total: record.rowCount, nextOffset: offset + rows.length < record.rowCount ? offset + rows.length : null } };
  }

  async #execute(name, handle, args) {
    const entry = handle.configuration, original = handle.workspace;
    switch (name) {
      case 'merchant_odata_source': {
        if (args.action === 'connect') {
          only(args, ['service', 'connectionId', 'name'], ['service', 'connectionId']);
          const service = entry.services[identifier(args.service, 'Service alias')];
          if (!service) throw failure('ODATA_SERVICE_NOT_CONFIGURED', 'Choose a declared provider service.');
          const id = nativeId(args.connectionId), existing = (await original.state()).connections.find(row => row.id === id);
          if (existing) {
            if (existing.url !== service.url || (existing.authEnv || null) !== service.authEnv || existing.allowLoopback !== service.allowLoopback ||
                args.name !== undefined && existing.name !== args.name)
              throw failure('ODATA_CONNECTION_EXISTS', 'That connection ID belongs to a different source or name.');
            return connectionView(existing);
          }
          return connectionView(await original.connect({ id, name: args.name ?? service.label,
            url: service.url, authEnv: service.authEnv, allowLoopback: service.allowLoopback }));
        }
        if (args.action !== 'refresh') throw failure('INVALID_PARAMS', 'Choose connect or refresh.');
        only(args, ['connectionId'], ['connectionId']);
        this.#service(entry, this.#find((await original.state()).connections, args.connectionId, 'connection'));
        return connectionView(await original.refreshConnection(args.connectionId));
      }
      case 'merchant_odata_catalog': {
        const connection = this.#find((await original.state()).connections, args.connectionId, 'connection'),
          catalog = connection.catalog, offset = args.offset ?? 0, limit = args.limit ?? 50;
        if (args.entitySet !== undefined) {
          const entity = getEntitySet(catalog, args.entitySet), fields = pageRows(entity.fields, offset, limit);
          const { fields: allFields, ...description } = entity;
          return { connectionId: connection.id, catalogHash: connection.catalogHash, entitySet: description,
            metadata: catalog.receipts.metadata, fields: fields.values, page: fields.page };
        }
        const entities = pageRows(catalog.entitySets, offset, limit);
        return { connectionId: connection.id, catalogHash: connection.catalogHash, serviceUrl: catalog.serviceUrl,
          version: catalog.version, receipts: catalog.receipts,
          entitySets: entities.values.map(({ fields, ...set }) => ({ ...set, fieldCount: fields.length })), page: entities.page };
      }
      case 'merchant_odata_plan': {
        const state = await original.state();
        if (args.action === 'inspect') {
          only(args, ['planId'], ['planId']); return this.#find(state.plans, args.planId, 'plan');
        }
        if (args.action === 'review') {
          only(args, ['planId', 'note'], ['planId', 'note']);
          return original.reviewPlan({ id: nativeId(args.planId), note: args.note });
        }
        if (args.action !== 'save') throw failure('INVALID_PARAMS', 'Choose save, inspect or review.');
        only(args, ['planId', 'connectionId', 'name', 'query'], ['planId', 'connectionId', 'query']);
        const id = nativeId(args.planId), connection = this.#find(state.connections, args.connectionId, 'connection'),
          compiled = compileQuery(connection.catalog, args.query), existing = state.plans.find(row => row.id === id);
        if (existing) {
          if (existing.connectionId !== connection.id || existing.query.fingerprint !== compiled.fingerprint ||
              existing.catalogHash !== connection.catalogHash || args.name !== undefined && existing.name !== args.name)
            throw failure('ODATA_PLAN_EXISTS', 'This saved query ID already has different source, scope or name.');
          return existing;
        }
        return original.plan({ id, connectionId: connection.id, name: args.name, query: args.query });
      }
      case 'merchant_odata_capture': {
        if (args.action === 'pause') {
          only(args, ['editionId'], ['editionId']);
          await original.pause(nativeId(args.editionId));
          await handle.captures.get(args.editionId)?.catch(() => {});
          return editionView(await original.edition(args.editionId));
        }
        if (!['start', 'resume'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose start, resume or pause.');
        only(args, args.action === 'start' ? ['editionId', 'planId', 'label', 'pageBudget', 'wait'] :
          ['editionId', 'pageBudget', 'wait'], args.action === 'start' ? ['editionId', 'planId'] : ['editionId']);
        const id = nativeId(args.editionId), pageBudget = count(args.pageBudget ?? 10000, 'Import page budget', 1, 100000);
        if (args.wait !== undefined && typeof args.wait !== 'boolean') throw failure('INVALID_PARAMS', 'wait must be a Boolean.');
        if (args.action === 'start') {
          await this.#planSource(handle, args.planId);
          await original.startCapture({ id, planId: nativeId(args.planId), label: args.label });
        }
        const record = await original.edition(id);
        this.#service(entry, this.#find((await original.state()).connections, record.connectionId, 'connection'));
        if (record.status === 'COMPLETE') return editionView(record);
        let operation = handle.captures.get(id);
        if (!operation && !(await original.state()).running.includes(id)) {
          operation = original.capture(id, { pageBudget });
          handle.captures.set(id, operation);
          void operation.then(() => { if (handle.captures.get(id) === operation) handle.captures.delete(id); },
            () => { if (handle.captures.get(id) === operation) handle.captures.delete(id); });
        }
        if (args.wait === true && operation) await operation;
        return { ...editionView(await original.edition(id)), importing: (await original.state()).running.includes(id) };
      }
      case 'merchant_odata_edition':
        if (args.action === 'inspect') {
          only(args, ['editionId', 'offset', 'limit'], ['editionId']);
          return editionView(await original.edition(nativeId(args.editionId)), args.offset ?? 0, args.limit ?? 50);
        }
        if (args.action !== 'review') throw failure('INVALID_PARAMS', 'Choose inspect or review.');
        only(args, ['editionId', 'decision', 'note'], ['editionId', 'decision', 'note']);
        return original.reviewEdition({ id: nativeId(args.editionId), decision: args.decision, note: args.note });
      case 'merchant_odata_rows': return this.#rows(handle, args);
      case 'merchant_odata_compare': {
        const before = await original.edition(nativeId(args.beforeId)), after = await original.edition(nativeId(args.afterId));
        if (before.status !== 'COMPLETE' || after.status !== 'COMPLETE') throw failure('ODATA_COMPARE_INCOMPLETE', 'Compare two complete source editions.');
        const source = { beforeId: before.id, afterId: after.id, beforeHash: before.contentHash, afterHash: after.contentHash,
          beforeQuery: before.query.fingerprint, afterQuery: after.query.fingerprint }, id = digest(stable(source));
        const record = await this.#retain(args.workspace, 'comparison', id, async () => formatted(await original.compare(before.id, after.id)), source);
        const comparison = json((await this.#artifact(args.workspace, 'comparison', id, true)).bytes);
        const result = { ...comparison, comparisonId: id, file: record, pagination: {} };
        for (const key of ['added', 'removed', 'changed']) {
          const page = pageRows(comparison[key], args.offset ?? 0, args.limit ?? 50);
          result[key] = page.values; result.pagination[key] = page.page;
        }
        return result;
      }
      case 'merchant_odata_export': {
        const terms = args.profile === undefined ? null : this.#profile(entry, args.profile);
        const result = await original.exportEdition({ id: nativeId(args.editionId), name: args.name, fields: args.fields,
          ...(terms ? { origin: terms.origin, path: terms.path, payment: { scheme: 'exact', ...terms.payment, amount: terms.amount } } : {}),
          ...(args.defaultLimit === undefined ? {} : { defaultLimit: count(args.defaultLimit, 'Default dataset rows', 1, 10000) }),
          ...(args.maxLimit === undefined ? {} : { maxLimit: count(args.maxLimit, 'Maximum dataset rows', 1, 10000) }) });
        return publicRecord(result);
      }
      case 'merchant_odata_query':
        if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 32768))
          throw failure('INVALID_PARAMS', 'Use the original dataset query string, at most 32768 characters.');
        return original.queryExport({ id: nativeId(args.exportId), query: args.query ?? '' });
      case 'merchant_odata_publisher': return this.#publish(handle, args);
      case 'merchant_odata_live': {
        const live = await this.#live(handle);
        if (args.action === 'status') {
          only(args, ['offset', 'limit']);
          const page = pageRows((await live.status()).products, args.offset ?? 0, args.limit ?? 50);
          return { products: page.values, page: page.page };
        }
        if (args.action === 'prepare') {
          only(args, ['liveServiceId', 'planId', 'profile', 'name', 'operation'], ['liveServiceId', 'planId', 'profile']);
          await this.#planSource(handle, args.planId);
          const { label, ...profile } = this.#profile(entry, args.profile);
          return live.prepare({ id: nativeId(args.liveServiceId), planId: nativeId(args.planId), name: args.name,
            operation: args.operation, ...profile });
        }
        if (args.action === 'detail') {
          only(args, ['liveServiceId', 'offset', 'limit'], ['liveServiceId']);
          const detail = await live.detail(nativeId(args.liveServiceId)), result = { ...detail, pagination: {} };
          for (const key of ['buyers', 'received']) {
            const page = pageRows(detail[key], args.offset ?? 0, args.limit ?? 50);
            result[key] = page.values.map(publicRecord); result.pagination[key] = page.page;
          }
          return result;
        }
        if (!['start', 'stop'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose a live service operation.');
        only(args, ['liveServiceId'], ['liveServiceId']);
        const id = nativeId(args.liveServiceId);
        if (args.action === 'start') await this.#planSource(handle, (await live.detail(id)).planId);
        return live[args.action]({ id });
      }
      case 'merchant_odata_buyer':
        return publicRecord(await (await this.#live(handle)).buyer({ id: nativeId(args.liveServiceId),
          intentId: line(args.intentId, 'Original purchase intent'), receivedId: args.receivedId }));
      case 'merchant_odata_receive': {
        if ((args.response === undefined) === (args.buyerId === undefined))
          throw failure('INVALID_PARAMS', 'Choose exactly one declared response alias or original buyerId.');
        const live = await this.#live(handle), id = nativeId(args.liveServiceId);
        const bytes = args.response !== undefined ? await this.#declaredInput(entry.responses, args.response, 16 * 1024 * 1024) :
          (await live.file({ id, kind: 'buyer', recordId: nativeId(args.buyerId), name: 'response.json' })).bytes;
        return publicRecord(await live.receive({ id, bodyBase64: bytes.toString('base64') }));
      }
      case 'merchant_odata_transfer': {
        if (args.action === 'list') {
          only(args, ['offset', 'limit']);
          const page = await this.#listArtifacts(args.workspace, 'transfer', args.offset ?? 0, args.limit ?? 50);
          return { transfers: page.values, page: page.page };
        }
        if (args.action === 'create') {
          only(args, ['transferId'], ['transferId']);
          return this.#retain(args.workspace, 'transfer', nativeId(args.transferId), async () => formatted(await original.backup()));
        }
        if (args.action !== 'restore') throw failure('INVALID_PARAMS', 'Choose create, list or restore.');
        only(args, ['sourceImport', 'sourceWorkspace', 'transferId']);
        if ((args.sourceImport !== undefined) === (args.transferId !== undefined) ||
            args.sourceImport !== undefined && args.sourceWorkspace !== undefined)
          throw failure('INVALID_PARAMS', 'Choose a declared sourceImport or a retained transferId with its sourceWorkspace.');
        const bytes = args.sourceImport !== undefined ? await this.#declaredInput(entry.imports, args.sourceImport, 256_000_000) :
          (await this.#artifact(args.sourceWorkspace ?? args.workspace, 'transfer', nativeId(args.transferId), true)).bytes;
        const bundle = json(bytes), result = await original.restore(bundle);
        return { workspace: args.workspace, sourceFileSha256: digest(bytes), transferSha256: digest(formatted(bundle)), ...result };
      }
      case 'merchant_odata_file': return this.#file(args.workspace, handle, args);
      case 'merchant_odata_file_release':
        await this.#reads.release(args.workspace, args.readId); return { workspace: args.workspace, readId: args.readId, released: true };
      case 'merchant_odata_browser': {
        if (args.action === 'close') {
          only(args, []);
          if (handle.browser) { await handle.browser.close(); handle.browser = null; }
          return { workspace: args.workspace, browser: 'CLOSED', instanceId: handle.instanceId };
        }
        if (args.action !== 'open') throw failure('INVALID_PARAMS', 'Choose open or close.');
        only(args, ['port']);
        if (!handle.browser) {
          const { startODataServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/server.mjs');
          handle.browser = await startODataServer({ workspace: original, liveOperations: await this.#live(handle),
            closeWorkspace: false, port: count(args.port ?? 0, 'Browser port', 0, 65535) });
        }
        return { workspace: args.workspace, instanceId: handle.instanceId, url: handle.browser.url, browser: 'OPEN' };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown OData workspace operation.');
    }
  }

  async #publish(handle, args) {
    const publisher = await this.#publisher(handle);
    if (args.action === 'status') {
      only(args, []);
      return { ...await publisher.status(), owned: this.#runView(handle.publisherRun) };
    }
    if (args.action === 'prepare') {
      only(args, ['exportId', 'releaseId', 'label'], ['exportId', 'releaseId']);
      return publisher.prepare({ exportId: nativeId(args.exportId), releaseId: nativeId(args.releaseId),
        label: args.label, runtime: handle.configuration.runtime });
    }
    if (args.action === 'inspect') {
      only(args, ['releaseId'], ['releaseId']);
      return inspectRelease(publisher.releases, nativeId(args.releaseId));
    }
    if (['activate', 'rollback'].includes(args.action)) {
      only(args, ['releaseId', 'expectedGeneration', 'reason'], ['releaseId', 'expectedGeneration', 'reason']);
      const common = { expectedGeneration: count(args.expectedGeneration, 'Release generation'), reason: line(args.reason, 'Selection reason') };
      return args.action === 'activate' ? publisher.activate({ id: nativeId(args.releaseId), ...common }) :
        publisher.rollback({ to: nativeId(args.releaseId), ...common });
    }
    if (args.action === 'stop') {
      only(args, ['instanceId'], ['instanceId']);
      if (!handle.publisherRun || handle.publisherRun.observation.instanceId !== args.instanceId)
        throw failure('INSTANCE_CONFLICT', 'Use the dataset merchant instance owned by this workspace.');
      const running = handle.publisherRun;
      await running.close();
      if (handle.publisherRun === running) handle.publisherRun = null;
      return { instanceId: args.instanceId, state: 'STOPPED' };
    }
    if (args.action !== 'start') throw failure('INVALID_PARAMS', 'Choose an original dataset publisher operation.');
    only(args, ['expectedGeneration', 'expectedDigest'], ['expectedGeneration', 'expectedDigest']);
    const selected = await readReleaseState(publisher.releases);
    if (selected.generation !== count(args.expectedGeneration, 'Release generation') || !selected.active)
      throw failure('RELEASE_CONFLICT', 'Read the original publisher state and use its active release generation.');
    const release = await inspectRelease(publisher.releases, selected.active);
    if (release.digest !== args.expectedDigest) throw failure('RELEASE_CONFLICT', 'Use the inspected digest of the selected original release.');
    if (handle.publisherRun) {
      if (handle.publisherRun.release.digest !== release.digest || handle.publisherRun.release.id !== release.id)
        throw failure('RELEASE_BUSY', 'Stop this workspace’s existing dataset merchant before starting another release.');
      return this.#runView(handle.publisherRun);
    }
    const running = await publisher.run({ expectedGeneration: args.expectedGeneration, handleSignals: false,
      ...(handle.browser ? { operationsNavigationOrigin: handle.browser.url } : {}) });
    handle.publisherRun = running;
    void running.completion.then(() => { if (handle.publisherRun === running) handle.publisherRun = null; },
      () => { if (handle.publisherRun === running) handle.publisherRun = null; });
    return this.#runView(running);
  }
  async #dispatch(name, args) {
    if (name === 'merchant_odata_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_odata_open') return this.#open(args.workspace);
    this.#declared(args.workspace);
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('ODATA_WORKSPACE_CLOSED', 'Open the original workspace with merchant_odata_open.');
    const handle = await opening;
    if (name === 'merchant_odata_close') {
      if (args.instanceId !== handle.instanceId) throw failure('INSTANCE_CONFLICT', 'Use the process-owned workspace instanceId from status.');
      return this.#stop(args.workspace, handle);
    }
    if (handle.closing) throw failure('ODATA_WORKSPACE_CLOSING', 'This original workspace is closing.');
    const operation = handle.tail.then(() => this.#execute(name, handle, args));
    handle.tail = operation.then(() => {}, () => {});
    return operation;
  }
  async call(name, args) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The OData adapter is closing.');
    const operation = this.#dispatch(name, args);
    this.#pending.add(operation);
    try { return await operation; } finally { this.#pending.delete(operation); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#handles].map(async ([name, opening]) => this.#stop(name, await opening)));
      await this.#reads.close();
      if (outcomes.some(item => item.status === 'rejected')) throw failure('ODATA_CLOSE_FAILED', 'An original OData workspace reported an incomplete shutdown.');
    })();
    return this.#close;
  }
}
