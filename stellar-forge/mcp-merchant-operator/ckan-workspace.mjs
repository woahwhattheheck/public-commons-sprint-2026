// MIT. Agent and browser authoring over the one original CKAN workbench.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { ExactCkanNumber } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/capture.mjs';

export const CKAN_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.ckan-workbench-connection.v1';
const NATIVE_SCHEMA = 'stellar-forge.ckan-workbench.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INTENT = /^[A-Za-z0-9._:-]{1,128}$/;
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const uuid = { type: 'string', pattern: UUID.source };
const digest = { type: 'string', pattern: SHA256.source };
const shortText = { type: 'string', minLength: 1, maxLength: 128 };
const field = { type: 'string', minLength: 1, maxLength: 512 };
const columnName = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,47}$' };
const offset = { type: 'integer', minimum: 0 };
const positive = { type: 'integer', minimum: 1 };
const selected = { workspace: alias };
const changing = { ...selected, expectedOperationId: { type: ['string', 'null'], pattern: UUID.source } };
const changed = ['workspace', 'expectedOperationId'];
const read = { readOnly: true, idempotent: true };
const mutation = { idempotent: false };
const fields = { type: 'array', maxItems: 64, uniqueItems: true, items: columnName };
const fileSelection = { ...selected, kind: { type: 'string', enum: ['source', 'merchant', 'buyer'] }, itemId: uuid };
const projection = { type: 'object', minProperties: 1, maxProperties: 64,
  propertyNames: columnName, additionalProperties: { type: 'object', additionalProperties: false,
    properties: { field, type: { type: 'string', enum: ['string', 'integer', 'number', 'boolean'] },
      nullable: { type: 'boolean' }, encoding: { type: 'string', enum: ['native', 'text', 'json'] } },
    required: ['field', 'type', 'nullable', 'encoding'] } };
const definitions = [
  ['merchant_ckan_workspaces', 'List host-declared original CKAN project aliases, browser ownership, configured inputs and merchant/buyer availability. Does not open a project or read a catalogue.', {}, [], read],
  ['merchant_ckan_open', 'Open one existing CKAN project under its original lease and serve the same browser on loopback. Browser and agent actions share the original model. Reuse the returned current instanceId; close a separately running workbench first.', selected, ['workspace'], { idempotent: true }],
  ['merchant_ckan_close', 'Close this exact owned CKAN browser/model instance, drain pending calls and native operation, close retained file reads, and release its original project lease. Saved editions, publisher state and merchant packages remain available on reopen.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true, idempotent: false }],
  ['merchant_ckan_status', 'Read the original current operation, active operation ID, retained project item pages and current loopback browser. Before a changing tool, use native.operation?.id ?? null as expectedOperationId. A resolved operation may be FAILED or CANCELLED: inspect its state and error. Each collection has its own offset and nextOffset.', {
    ...selected, editionsOffset: offset, sourcesOffset: offset, publicationsOffset: offset,
    exportsOffset: offset, buyerRequestsOffset: offset, limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, ['workspace'], read],
  ['merchant_ckan_search', 'Search the original project catalogue through CKAN package_search and return the original provider receipt and dataset/resource metadata page. Continue with page.next; catalogue reads use only the original configured credential reference.', {
    ...selected, q: { type: 'string', maxLength: 2048 }, start: { type: 'integer', minimum: 0, maximum: 10000000 },
    rows: { type: 'integer', minimum: 1, maximum: 100 },
  }, ['workspace'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_package', 'Read one original CKAN package and its resources through the project catalogue, retaining the provider receipt. Public metadata field names and exact numeric tokens remain visible.', {
    ...selected, packageId: field,
  }, ['workspace', 'packageId'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_inputs', 'List host-declared original capture input aliases, or inspect one complete private capture manifest file and return its exact current bytes and SHA256. The original importer validates its retained sibling metadata and page bytes.', {
    ...selected, input: alias,
  }, ['workspace'], read],
  ['merchant_ckan_import', 'Import the selected host-declared retained CKAN edition through the original importer. The importer checks expectedSha256 before any edition is copied; the original complete manifest and all provider page hashes remain authoritative. On an uncertain reply inspect native.operation and retained editions before another action.', {
    ...changing, input: alias, expectedSha256: digest,
  }, [...changed, 'input', 'expectedSha256'], mutation],
  ['merchant_ckan_capture', 'Read and retain one selected package/resource through the original CKAN Action API capture engine. Choose actual provider filters, query and offset/keyset pagination; keyset with an _id filter requires offset instead. Returns the native operation ID immediately; follow status and resume that edition after interruption.', {
    ...changing, packageId: field, resourceId: field, filters: { type: 'object' },
    q: { type: 'string', maxLength: 2048 }, pagination: { type: 'string', enum: ['offset', 'keyset'] },
    pageSize: { type: 'integer', minimum: 1, maximum: 32000 }, maxRows: positive, maxBytes: positive,
    timeoutMs: { type: 'integer', minimum: 100, maximum: 300000 },
    maxResponseBytes: { type: 'integer', minimum: 1024, maximum: 67108864 },
  }, [...changed, 'packageId', 'resourceId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_capture_resume', 'Resume this original unfinished retained edition and its saved provider selection/cursor. Reuses accepted pages through the native capture engine. It does not allocate another edition.', {
    ...changing, editionId: uuid, maxRows: positive, maxBytes: positive,
  }, [...changed, 'editionId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_edition', 'Inspect one original edition, complete source fields, type/alias suggestions and first twenty source rows, or the retained progress of an unfinished edition. Exact number tokens are presented as strings without changing retained source bytes.', {
    ...selected, editionId: uuid,
  }, ['workspace', 'editionId'], read],
  ['merchant_ckan_compare', 'Compare two complete editions of the same original resource using the selected unique non-null source key. Returns original counts, metadata identities and the first hundred changes. Public column names remain data; exact numeric tokens are strings in this tool presentation.', {
    ...selected, beforeId: uuid, afterId: uuid, key: field,
  }, ['workspace', 'beforeId', 'afterId'], read],
  ['merchant_ckan_source_save', 'Save an explicit public field projection bound to the inspected original capture SHA256. Field names, aliases, nullability and native/text/json encoding are checked by the original typed source engine. Returns a native operation whose result is the saved source and preview.', {
    ...changing, editionId: uuid, title: shortText, query: columnName, projection, expectedCaptureSha256: digest,
  }, [...changed, 'editionId', 'title', 'query', 'projection', 'expectedCaptureSha256'], mutation],
  ['merchant_ckan_publication_create', 'Create a candidate through the original publisher using this saved source title/projection. Select the public filters, ranges, sorts and page limits plus extraction order and budgets. The retained native publication/run IDs own review and recovery.', {
    ...changing, sourceId: uuid, filters: fields, ranges: fields, sorts: fields, defaultLimit: positive, maxLimit: positive,
    order: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', additionalProperties: false,
      properties: { column: columnName, direction: { type: 'string', enum: ['asc', 'desc'] } }, required: ['column', 'direction'] } },
    maxRows: positive, maxBytes: positive, timeoutMs: positive,
  }, [...changed, 'sourceId'], mutation],
  ['merchant_ckan_publication', 'Read one original publication/run and inspect its exact candidate or published dataset, optionally using an original query string. Use native.run.data.candidate.candidateDigest and the original review ID for the next reviewed action.', {
    ...selected, publicationId: uuid, query: { type: 'string', maxLength: 8192 },
  }, ['workspace', 'publicationId'], read],
  ['merchant_ckan_publication_review', 'Record the review of this exact original candidate SHA256 through the original publisher. Read the resulting original run/review ID before publication; a stale candidate cannot be reviewed.', {
    ...changing, publicationId: uuid, expectedCandidateDigest: digest, reviewer: shortText,
    note: { type: 'string', minLength: 1, maxLength: 2000 },
  }, [...changed, 'publicationId', 'expectedCandidateDigest', 'reviewer', 'note'], mutation],
  ['merchant_ckan_publication_recover', 'Recover this original retained publication/run through the original publisher after interruption. Inspect the retained run; recovery does not allocate a replacement publication.', {
    ...changing, publicationId: uuid,
  }, [...changed, 'publicationId'], mutation],
  ['merchant_ckan_publish', 'Publish the exact original reviewed candidate with its original review ID. The original publisher governs recovery and already-published replay; inspect native.operation and the retained publication after an uncertain reply.', {
    ...changing, publicationId: uuid, reviewId: uuid,
  }, [...changed, 'publicationId', 'reviewId'], mutation],
  ['merchant_ckan_merchant_export', 'Create a complete portable original CKAN merchant package for the inspected candidate digest, using this host-declared origin/path/payment offer. The operation returns its original export ID and manifest SHA256. Receive its original files with merchant_ckan_files/file_read.', {
    ...changing, publicationId: uuid, expectedCandidateDigest: digest,
  }, [...changed, 'publicationId', 'expectedCandidateDigest'], mutation],
  ['merchant_ckan_merchant_stage', 'Stage the original complete package in this project seller-releases using the inspected manifest SHA256 and host-declared runtime. Requires releaseStoreMatches so the generic merchant release controls address that same original store. Select/start the resulting release through those original controls.', {
    ...changing, exportId: uuid, expectedManifestSha256: digest, releaseId: alias, label: shortText,
  }, [...changed, 'exportId', 'expectedManifestSha256', 'releaseId'], mutation],
  ['merchant_ckan_buyer_offer', 'Read the actual unpaid offer for one original exported dataset and query from the host-bound seller. Returns the original offer SHA256/options for preparing the same buyer request.', {
    ...selected, exportId: uuid, query: { type: 'string', maxLength: 8192 },
  }, ['workspace', 'exportId'], { readOnly: true, openWorld: true }],
  ['merchant_ckan_buyer_prepare', 'Prepare an original SF88 buyer configuration from the selected current actual seller offer, exact offer SHA256, accepted option index and original SF88 intent ID. The original buyer handoff retains its config; receive that file through merchant_ckan_files/file_read.', {
    ...changing, exportId: uuid, query: { type: 'string', maxLength: 8192 }, offerSha256: digest,
    acceptIndex: offset, intentId: { type: 'string', pattern: INTENT.source },
  }, [...changed, 'exportId', 'offerSha256', 'acceptIndex', 'intentId'], { ...mutation, openWorld: true }],
  ['merchant_ckan_files', 'List exact original source declaration, complete portable merchant package, or prepared buyer configuration files with their byte counts and SHA256. Choose the native source/export/buyer item ID from retained state. Source and buyer files are private handoff artifacts.', fileSelection, ['workspace', 'kind', 'itemId'], read],
  ['merchant_ckan_file_read', 'Read one listed original file in SHA256-pinned base64 chunks through the existing retained-file reader. Reuse readId, expectedSha256 and nextOffset. After expiry/restart omit readId and resume the same item/file/hash/offset; the final chunk releases its snapshot.', {
    ...fileSelection, file: { type: 'string', minLength: 1, maxLength: 512 }, readId: uuid, expectedSha256: digest, offset,
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
  }, ['workspace', 'kind', 'itemId', 'file'], read],
  ['merchant_ckan_file_release', 'Release this alias verified original-file snapshot. Retained source, merchant package and buyer configuration files remain available.', {
    ...selected, readId: uuid,
  }, ['workspace', 'readId'], read],
  ['merchant_ckan_cancel', 'Cancel only this exact currently active original operation. A stale operation ID cannot cancel a successor. Read the resulting native operation state and retained project items before continuing.', {
    ...selected, operationId: uuid,
  }, ['workspace', 'operationId'], { destructive: true, idempotent: false }],
];
const definitionsByName = new Map(definitions.map(definition => [definition[0], definition]));
export function ckanWorkspaceTools(tool) { return definitions.map(definition => tool(...definition)); }

function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
function nativeId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use the original item, operation or instance UUID.');
  return value;
}
function expectedDigest(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw failure('INVALID_PARAMS', 'Use the inspected exact SHA256.');
  return value;
}
function pageInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum)
    throw failure('INVALID_PARAMS', 'Use a nonnegative integer within the declared page limit.');
  return result;
}
function hostOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/' || typeof value !== 'string' ||
      value.replace(/\/$/, '') !== url.origin)
    throw failure('CONFIGURATION_ERROR', 'Use a canonical HTTP(S) origin for ' + label + '.');
  return url.origin;
}
async function privateFile(path, maximum, consume = false) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n || before.size > BigInt(maximum))
      throw failure('CKAN_INPUT_PRIVATE_FILE_REQUIRED', 'Use a private regular original file within its size limit.');
    const hash = createHash('sha256'), blocks = [], buffer = Buffer.alloc(65536);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      if (position > maximum) throw failure('CKAN_INPUT_SIZE_LIMIT', 'The original file exceeds its size limit.');
      const block = buffer.subarray(0, bytesRead); hash.update(block);
      if (consume) blocks.push(Buffer.from(block));
    }
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(position) !== after.size)
      throw failure('CKAN_INPUT_CHANGED', 'The original file changed while being read. Inspect its current identity.');
    return { sha256: hash.digest('hex'), bytes: position, ...(consume ? { content: Buffer.concat(blocks, position) } : {}) };
  } catch (issue) {
    if (/^CKAN_/.test(issue.code ?? '')) throw issue;
    throw failure('CKAN_INPUT_UNAVAILABLE', 'The host-declared private original file is unavailable. Check that same alias on the host.');
  } finally { await handle?.close(); }
}

/** Host declarations only. Explicit open validates and leases the original model. */
export async function readCkanWorkspaceConfiguration(path) {
  path = resolve(path);
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode((await privateFile(path, 1048576, true)).content)); }
  catch (issue) {
    if (issue.code) throw issue;
    throw failure('CONFIGURATION_ERROR', 'The CKAN connection must be complete UTF-8 JSON.');
  }
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== CKAN_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 existing original CKAN projects.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    identifier(alias, 'CKAN workspace alias');
    exact(input, ['label', 'directory', 'inputs', 'merchant', 'seller'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateSupportDirectory(directory);
    const canonical = await realpath(directory), state = await lstat(join(directory, 'workbench.json'));
    if (canonical !== directory || directories.has(canonical) || !state.isFile() || state.isSymbolicLink() ||
        state.nlink !== 1 || state.mode & 0o077)
      throw failure('CONFIGURATION_ERROR', 'Bind each existing private original CKAN project through one canonical alias.');
    directories.add(canonical);
    if (input.inputs !== undefined && (!plain(input.inputs) || Object.keys(input.inputs).length > 64))
      throw failure('CONFIGURATION_ERROR', 'Declare at most 64 named original capture inputs.');
    const inputs = Object.create(null);
    for (const [key, item] of Object.entries(input.inputs ?? {})) {
      identifier(key, 'CKAN input alias');
      exact(item, ['file', 'label'], ['file']);
      inputs[key] = { file: hostPath(item.file, base), label: line(item.label ?? key, 'CKAN input label') };
    }
    let merchant = null;
    if (input.merchant !== undefined) {
      exact(input.merchant, ['origin', 'path', 'payment', 'runtime'], ['origin', 'payment']);
      const configuredPath = input.merchant.path ?? '/data';
      if (typeof configuredPath !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(configuredPath) ||
          configuredPath.includes('//') || configuredPath.length > 1024 || !plain(input.merchant.payment))
        throw failure('CONFIGURATION_ERROR', 'Declare the original merchant resource path and public payment offer.');
      if (input.merchant.runtime !== undefined && (!plain(input.merchant.runtime) ||
          ['handlers', 'upstreams', 'allowLoopbackUpstream'].some(key => Object.hasOwn(input.merchant.runtime, key))))
        throw failure('CONFIGURATION_ERROR', 'CKAN owns the original staged handlers; declare only the host runtime options.');
      merchant = { origin: hostOrigin(input.merchant.origin, 'merchant'), path: configuredPath,
        payment: structuredClone(input.merchant.payment), runtime: structuredClone(input.merchant.runtime ?? {}) };
    }
    workspaces[alias] = { directory, label: line(input.label ?? alias, 'CKAN workspace label'), inputs, merchant,
      seller: input.seller === undefined ? null : hostOrigin(input.seller, 'seller') };
  }
  return { schema: CKAN_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}

// Provider/public values may legitimately be called "file", "directory" or
// "authorization". Preserve their full keys; redact only control metadata.
const dataFields = new Set(['package', 'datasets', 'rows', 'changes', 'fields', 'suggestions',
  'sample', 'projection', 'preview', 'columns', 'parameters', 'filters', 'ranges', 'sorts']);
const privateFields = new Set(['directory', 'sourceFile', 'targetDirectory', 'publisherDirectory', 'manifestFile',
  'captureFile', 'oauthDirectory', 'authTokenEnv', 'accessTokenEnv', 'out', 'path', 'file', 'root',
  'packageDirectory', 'configText', 'handlers', 'upstreams', 'authorization', 'privateKey', 'seed', 'mnemonic']);
function publicData(value) {
  if (value instanceof ExactCkanNumber) return value.source;
  if (Array.isArray(value)) return value.map(publicData);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicData(item)]));
  return value;
}
function view(value) {
  if (value instanceof ExactCkanNumber) return value.source;
  if (Array.isArray(value)) return value.map(view);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => {
    if (dataFields.has(key)) return [key, publicData(item)];
    if (key === 'error' && plain(item)) return [key, { code: item.code ?? 'CKAN_OPERATION_FAILED', status: item.status ?? null }];
    return [key, view(item)];
  }));
}
function safeError(issue) {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code ?? '') ? issue.code : 'CKAN_WORKSPACE_OPERATION_FAILED';
  const guidance = code === 'CKAN_RELEASE_STORE_MISMATCH'
    ? 'Initialize the CKAN host with this workspace selected, or bind its original project seller-releases with --release-store.'
    : code === 'CKAN_OPERATION_CHANGED'
      ? 'Read merchant_ckan_status and reconcile its original operation and retained item IDs before another changing action.'
      : code === 'CKAN_INSTANCE_CONFLICT'
        ? 'Use the current owned instanceId from merchant_ckan_status.'
        : 'Read merchant_ckan_status and inspect the retained original operation before continuing.';
  return failure(code, 'Original CKAN operation: ' + code + '. ' + guidance);
}
const collectionNames = ['editions', 'sources', 'publications', 'exports', 'buyerRequests'];

export class MerchantCkanWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'CKAN_FILE' });
  constructor(config) { this.#config = config; }
  #storeMatches(definition) {
    return typeof this.#config.releaseStore === 'string' &&
      resolve(this.#config.releaseStore) === join(definition.directory, 'seller-releases');
  }
  get summary() {
    return { configured: Boolean(this.#config.ckanWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.ckanWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null,
          browserUrl: entry?.service.url ?? null, inputAliases: Object.keys(definition.inputs),
          merchantConfigured: Boolean(definition.merchant), buyerConfigured: Boolean(definition.seller),
          releaseStoreMatches: this.#storeMatches(definition) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'CKAN workspace alias');
    const definition = this.#config.ckanWorkspaces?.workspaces[alias];
    if (!definition) throw failure('CKAN_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared alias from merchant_ckan_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('CKAN_WORKSPACE_NOT_OPEN', 'Explicitly open this original CKAN workbench first.');
    if (entry.closing) throw failure('CKAN_WORKSPACE_CLOSING', 'This original owned CKAN workbench is draining.');
    return entry;
  }
  #scope(alias) { return 'ckan:' + alias + ':' + this.#definition(alias).directory; }
  #native(entry) {
    const native = entry.model.status();
    if (native.schema !== NATIVE_SCHEMA) throw failure('CKAN_WORKSPACE_SCHEMA_CHANGED', 'Use the supported original CKAN workbench.');
    return native;
  }
  #state(entry, options = {}) {
    const native = this.#native(entry), limit = pageInteger(options.limit, 25, 100);
    if (limit < 1) throw failure('INVALID_PARAMS', 'Use a collection page limit between 1 and 100.');
    const paging = {};
    for (const collection of collectionNames) {
      const start = pageInteger(options[collection + 'Offset'], 0), all = native[collection];
      if (!Array.isArray(all)) throw failure('CKAN_WORKSPACE_SCHEMA_CHANGED', 'The original collection shape changed.');
      native[collection] = all.slice(start, start + limit);
      paging[collection] = { offset: start, limit, total: all.length,
        nextOffset: start + native[collection].length < all.length ? start + native[collection].length : null };
    }
    return { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.url,
      releaseStoreMatches: this.#storeMatches(this.#definition(entry.alias)), native: view(native), paging,
      fileReads: this.#reads.status(this.#scope(entry.alias)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const { openCkanWorkbench } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/model.mjs');
      const { startCkanServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/server.mjs');
      let model, service;
      try {
        model = await openCkanWorkbench({ directory: definition.directory });
        service = await startCkanServer({ workbench: model, port: 0 });
        if (this.#closing) throw failure('CKAN_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, model, service, instanceId: randomUUID(), pending: new Set(), packageFiles: new Map(), closing: null };
        this.#entries.set(alias, entry);
        try { return this.#state(entry); }
        catch (issue) { this.#entries.delete(alias); throw issue; }
      } catch (issue) {
        await Promise.allSettled([service?.close(), model?.close()]);
        throw issue;
      }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  async #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      // Stop new browser connections first; previously accepted MCP calls drain.
      const browserClosing = entry.service.close();
      await Promise.allSettled([...entry.pending]);
      const drained = await Promise.allSettled([entry.model.close(), browserClosing, this.#reads.closeScope(this.#scope(entry.alias))]);
      if (drained.some(result => result.status === 'rejected'))
        throw failure('CKAN_SHUTDOWN_INCOMPLETE', 'An original owned CKAN workbench reported incomplete shutdown.');
      if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
      return { workspace: entry.alias, instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  #launch(entry, expectedOperationId, start) {
    if (entry.closing || this.#closing) throw failure('CKAN_WORKSPACE_CLOSING', 'This original owned CKAN workbench is draining.');
    if (expectedOperationId !== null) nativeId(expectedOperationId);
    const before = this.#native(entry);
    if ((before.operation?.id ?? null) !== expectedOperationId)
      throw failure('CKAN_OPERATION_CHANGED', 'Reconcile the retained native operation and original item IDs.');
    // No await between the guard and original launch: concurrent changing calls
    // cannot both consume the same original operation baseline.
    const started = start(), native = this.#native(entry);
    return { workspace: entry.alias, instanceId: entry.instanceId, operationId: started.id,
      ...(started.editionId ? { editionId: started.editionId } : {}),
      native: view({ operation: native.operation, active: native.active }) };
  }
  #input(alias, input) {
    identifier(input, 'CKAN input alias');
    const definition = this.#definition(alias).inputs[input];
    if (!definition) throw failure('CKAN_INPUT_NOT_CONFIGURED', 'Choose an original input declared by this host.');
    return definition;
  }
  async #inputs(alias, selectedInput) {
    const configured = this.#definition(alias).inputs;
    if (selectedInput === undefined) return { workspace: alias,
      inputs: Object.entries(configured).map(([input, item]) => ({ input, label: item.label })) };
    const input = this.#input(alias, selectedInput), current = await privateFile(input.file, 16777216);
    return { workspace: alias, input: selectedInput, label: input.label,
      file: { name: basename(input.file), bytes: current.bytes, sha256: current.sha256 } };
  }
  #item(entry, kind, itemId) {
    nativeId(itemId);
    const collections = { source: 'sources', merchant: 'exports', buyer: 'buyerRequests' };
    const collection = Object.hasOwn(collections, kind) ? collections[kind] : null;
    if (!collection) throw failure('INVALID_PARAMS', 'Choose an original source, merchant package or buyer configuration.');
    const item = this.#native(entry)[collection].find(item => item.id === itemId);
    if (!item) throw failure('CKAN_ITEM_NOT_FOUND', 'Choose an original retained item from merchant_ckan_status.');
    return item;
  }
  async #fileSet(entry, kind, itemId) {
    const item = this.#item(entry, kind, itemId);
    if (kind === 'merchant') {
      const key = item.id + ':' + item.manifestSha256;
      if (entry.packageFiles.has(key)) return entry.packageFiles.get(key);
      // Original whole-package inspection happens once per retained export in
      // this owned instance. Every delivered member still checks its exact
      // manifest SHA. This avoids rereading N provider pages for each of N files.
      const inspected = (async () => {
        const { inspectCkanMerchantPackage } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/publisher/release.mjs');
        const retained = await inspectCkanMerchantPackage(item.directory, item.manifestSha256);
        return { directory: retained.directory, manifestSha256: retained.manifestSha256,
          files: [...retained.manifest.files,
            { file: 'merchant-manifest.json', bytes: retained.manifestBytes.length, sha256: retained.manifestSha256 },
            { file: 'handlers.mjs', bytes: retained.handlerBytes.length, sha256: retained.handlerSha256 }],
          special: new Map([['merchant-manifest.json', retained.manifestBytes], ['handlers.mjs', retained.handlerBytes]]) };
      })();
      entry.packageFiles.set(key, inspected);
      try {
        const retained = await inspected;
        // Keep only a small descriptor/manifest cache; page and CSV bytes are
        // retained solely by the existing bounded chunk-reader snapshots.
        for (const oldest of entry.packageFiles.keys()) {
          if (entry.packageFiles.size <= 8) break;
          if (oldest !== key) entry.packageFiles.delete(oldest);
        }
        return retained;
      } catch (issue) {
        if (entry.packageFiles.get(key) === inspected) entry.packageFiles.delete(key);
        throw issue;
      }
    }
    const path = kind === 'source' ? item.file : item.out;
    const original = await privateFile(path, 1048576, true);
    if (kind === 'source' && original.sha256 !== item.sha256)
      throw failure('CKAN_SOURCE_CHANGED', 'The original source declaration no longer matches its saved SHA256.');
    if (kind === 'buyer' && (typeof item.configText !== 'string' ||
        original.sha256 !== createHash('sha256').update(item.configText).digest('hex')))
      throw failure('CKAN_BUYER_FILE_CHANGED', 'The original buyer file no longer matches its retained native handoff.');
    const file = kind === 'source' ? 'source.json' : 'buyer.json';
    return { files: [{ file, bytes: original.bytes, sha256: original.sha256 }], special: new Map([[file, original.content]]) };
  }
  async #execute(entry, name, args) {
    const original = entry.model, { workspace, expectedOperationId, ...input } = args;
    const launch = start => this.#launch(entry, expectedOperationId, start);
    switch (name) {
      case 'merchant_ckan_status': return this.#state(entry, input);
      case 'merchant_ckan_search': return { workspace, native: view(await original.search(input)) };
      case 'merchant_ckan_package': return { workspace, native: view(await original.package(input.packageId)) };
      case 'merchant_ckan_inputs': return this.#inputs(workspace, input.input);
      case 'merchant_ckan_import': {
        const configured = this.#input(workspace, input.input), expected = expectedDigest(input.expectedSha256);
        // The original importer rechecks the exact digest after its own read.
        const current = await privateFile(configured.file, 16777216);
        if (current.sha256 !== expected) throw failure('CKAN_INPUT_CHANGED', 'Inspect the current original capture manifest before importing it.');
        return { ...launch(() => original.importCapture(configured.file, { expectedManifestSha256: expected })),
          input: input.input, expectedSha256: expected };
      }
      case 'merchant_ckan_capture': return launch(() => original.startCapture(input));
      case 'merchant_ckan_capture_resume': {
        const { editionId, ...limits } = input;
        nativeId(editionId);
        return launch(() => original.resumeCapture(editionId, limits));
      }
      case 'merchant_ckan_edition': return { workspace, native: view(await original.edition(nativeId(input.editionId))) };
      case 'merchant_ckan_compare': return { workspace, native: view(await original.compare(nativeId(input.beforeId), nativeId(input.afterId), input.key ?? '_id')) };
      case 'merchant_ckan_source_save': {
        const { editionId, ...selection } = input;
        nativeId(editionId); expectedDigest(selection.expectedCaptureSha256);
        return launch(() => original.saveSource(editionId, selection));
      }
      case 'merchant_ckan_publication_create': {
        const { sourceId, ...options } = input;
        nativeId(sourceId);
        return launch(() => original.createPublication(sourceId, options));
      }
      case 'merchant_ckan_publication':
        return { workspace, native: view(await original.publication(nativeId(input.publicationId), input.query ?? '')) };
      case 'merchant_ckan_publication_review': {
        const { publicationId, ...review } = input;
        nativeId(publicationId); expectedDigest(review.expectedCandidateDigest);
        return launch(() => original.reviewPublication(publicationId, review));
      }
      case 'merchant_ckan_publication_recover':
        nativeId(input.publicationId);
        return launch(() => original.recoverPublication(input.publicationId));
      case 'merchant_ckan_publish':
        nativeId(input.publicationId); nativeId(input.reviewId);
        return launch(() => original.publishDataset(input.publicationId, input.reviewId));
      case 'merchant_ckan_merchant_export': {
        const merchant = this.#definition(workspace).merchant;
        if (!merchant) throw failure('CKAN_MERCHANT_NOT_CONFIGURED', 'The host must declare this project merchant origin, resource path and public payment offer.');
        nativeId(input.publicationId); expectedDigest(input.expectedCandidateDigest);
        return launch(() => original.exportMerchant(input.publicationId, { expectedCandidateDigest: input.expectedCandidateDigest,
          origin: merchant.origin, path: merchant.path, payment: merchant.payment }));
      }
      case 'merchant_ckan_merchant_stage': {
        const definition = this.#definition(workspace);
        if (!this.#storeMatches(definition)) throw failure('CKAN_RELEASE_STORE_MISMATCH', 'Select this project original seller-releases in the merchant host.');
        nativeId(input.exportId); expectedDigest(input.expectedManifestSha256); identifier(input.releaseId, 'original release ID');
        return launch(() => original.stageMerchant(input.exportId, { expectedManifestSha256: input.expectedManifestSha256,
          releaseId: input.releaseId, label: input.label, runtime: definition.merchant?.runtime ?? {} }));
      }
      case 'merchant_ckan_buyer_offer': {
        const seller = this.#definition(workspace).seller;
        if (!seller) throw failure('CKAN_BUYER_NOT_CONFIGURED', 'The host must declare the original seller address.');
        return { workspace, native: view(await original.buyerOffer(nativeId(input.exportId), { seller, query: input.query ?? '' })) };
      }
      case 'merchant_ckan_buyer_prepare': {
        const seller = this.#definition(workspace).seller;
        if (!seller) throw failure('CKAN_BUYER_NOT_CONFIGURED', 'The host must declare the original seller address.');
        nativeId(input.exportId); expectedDigest(input.offerSha256);
        if (typeof input.intentId !== 'string' || !INTENT.test(input.intentId))
          throw failure('INVALID_PARAMS', 'Use the original SF88 intent ID: 1–128 letters, digits, dots, underscores, colons or hyphens.');
        return launch(() => original.prepareBuyer(input.exportId, { seller, query: input.query ?? '',
          intentId: input.intentId, acceptIndex: input.acceptIndex, offerSha256: input.offerSha256 }));
      }
      case 'merchant_ckan_files': {
        const retained = await this.#fileSet(entry, input.kind, input.itemId);
        return { workspace, kind: input.kind, itemId: input.itemId,
          ...(retained.manifestSha256 ? { manifestSha256: retained.manifestSha256 } : {}), files: retained.files };
      }
      case 'merchant_ckan_file_read': {
        this.#item(entry, input.kind, input.itemId);
        if (typeof input.file !== 'string' || !input.file || input.file.length > 512)
          throw failure('INVALID_PARAMS', 'Select one original listed file.');
        const chunk = await this.#reads.read({ scope: this.#scope(workspace), key: input.kind + ':' + input.itemId + ':' + input.file,
          kind: 'ckan-' + input.kind, directory: this.#definition(workspace).directory,
          readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
          load: async () => {
            const retained = await this.#fileSet(entry, input.kind, input.itemId);
            const selected = retained.files.find(file => file.file === input.file);
            if (!selected) throw failure('CKAN_FILE_NOT_FOUND', 'Choose an exact original filename returned by merchant_ckan_files.');
            const bytes = retained.special.get(input.file) ??
              (await privateFile(join(retained.directory, input.file), selected.bytes, true)).content;
            if (bytes.length !== selected.bytes || createHash('sha256').update(bytes).digest('hex') !== selected.sha256)
              throw failure('CKAN_FILE_CHANGED', 'The original file no longer matches its retained manifest.');
            return { name: input.file, type: input.file.endsWith('.json') ? 'application/json' :
              input.file.endsWith('.csv') ? 'text/csv' : 'text/javascript', bytes };
          } });
        return { workspace, kind: input.kind, itemId: input.itemId, ...chunk };
      }
      case 'merchant_ckan_file_release':
        await this.#reads.release(this.#scope(workspace), nativeId(input.readId));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      case 'merchant_ckan_cancel': {
        const active = this.#native(entry).active;
        if (active !== nativeId(input.operationId))
          throw failure('CKAN_OPERATION_CHANGED', 'Cancel only the current original active operation.');
        return { workspace, instanceId: entry.instanceId, native: original.cancel() };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown CKAN authoring operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('CKAN_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    try {
      const definition = definitionsByName.get(name);
      if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown CKAN authoring operation.');
      if (!plain(args) || Object.keys(args).some(key => !Object.hasOwn(definition[2], key)) ||
          definition[3].some(key => !Object.hasOwn(args, key)))
        throw failure('INVALID_PARAMS', 'Use the declared CKAN tool arguments.');
      if (name === 'merchant_ckan_workspaces') return this.summary;
      if (name === 'merchant_ckan_open') return await this.#open(args.workspace);
      if (name === 'merchant_ckan_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== nativeId(args.instanceId))
          throw failure('CKAN_INSTANCE_CONFLICT', 'Close only the current owned CKAN workbench instance.');
        return await this.#closeEntry(entry);
      }
      const entry = this.#entry(args.workspace), pending = Promise.resolve().then(() => this.#execute(entry, name, args));
      entry.pending.add(pending);
      try { return await pending; } finally { entry.pending.delete(pending); }
    } catch (issue) { throw safeError(issue); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        await Promise.allSettled([...this.#opening.values()]);
        const results = await Promise.allSettled([...this.#entries.values()].map(entry => this.#closeEntry(entry)));
        await this.#reads.close();
        if (results.some(result => result.status === 'rejected'))
          throw failure('CKAN_SHUTDOWN_INCOMPLETE', 'An original owned CKAN workbench reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
