// MIT. Original RSS/Atom/OPML console, dataset publisher and customer delivery.
import { constants } from 'node:fs';
import { open, realpath, lstat, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './host-files.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { RetainedSourceFileReads } from './retained-source-files.mjs';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { FEEDS_DELIVERY_SCHEMA, FEEDS_MANIFEST_NAME, MAX_FEEDS_DELIVERY_BYTES, parseFeedsDeliveryManifest } from './feeds-manifest.mjs';

export const FEEDS_CONNECTION_SCHEMA = 'stellar-forge.feeds-workspace-connection.v1';
const MiB = 1024 * 1024;
const MAX_JSON = 32 * MiB, MAX_ACTION = 16 * MiB;
const SHA = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]*$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => hash(json(canonical(value)));
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const checked = (value, regex, label) => {
  if (typeof value !== 'string' || !regex.test(value)) throw failure('INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
};
const integer = (value, low, high, label = 'value') => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw failure('INVALID_PARAMS', 'Invalid ' + label + '.');
  return value;
};
const exists = async path => {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
async function directory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (await realpath(path) !== resolve(path)) throw failure('FEEDS_PRIVATE_DIRECTORY', 'Use a canonical owned private directory.');
  await privateSupportDirectory(path); return path;
}
async function file(path, maximum, privateOnly = false) {
  if (await realpath(path) !== resolve(path)) throw failure('FEEDS_SOURCE_FILE', 'Use the canonical original regular file.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(maximum) || privateOnly && process.platform !== 'win32' &&
        (info.mode & 0o077n || process.getuid && info.uid !== BigInt(process.getuid())))
      throw failure('FEEDS_SOURCE_FILE', 'The selected original file exceeds its type, size or privacy limits.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function hashFile(path, maximum, privateOnly = false) {
  const { handle, info } = await file(path, maximum, privateOnly), digest = createHash('sha256'), buffer = Buffer.alloc(65536);
  let position = 0;
  try {
    while (position < Number(info.size)) {
      const part = await handle.read(buffer, 0, Math.min(buffer.length, Number(info.size) - position), position);
      if (!part.bytesRead) throw failure('FEEDS_FILE_CHANGED', 'The original retained file ended during reading.');
      digest.update(buffer.subarray(0, part.bytesRead)); position += part.bytesRead;
    }
    if (stamp(await handle.stat({ bigint: true })) !== stamp(info)) throw failure('FEEDS_FILE_CHANGED', 'The original file changed during reading.');
    return { handle, info, bytes: position, sha256: digest.digest('hex') };
  } catch (error) { await handle.close(); throw error; }
}
async function bytes(path, maximum = MAX_JSON, privateOnly = true) {
  const selected = await hashFile(path, maximum, privateOnly);
  try {
    const value = Buffer.alloc(selected.bytes); let position = 0;
    while (position < value.length) {
      const part = await selected.handle.read(value, position, value.length - position, position);
      if (!part.bytesRead) throw failure('FEEDS_FILE_CHANGED', 'The retained file ended during reading.');
      position += part.bytesRead;
    }
    if (hash(value) !== selected.sha256 || stamp(await selected.handle.stat({ bigint: true })) !== stamp(selected.info))
      throw failure('FEEDS_FILE_CHANGED', 'The original retained bytes changed.');
    return value;
  } finally { await selected.handle.close(); }
}
async function syncDirectory(path) { const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
async function immutable(path, value) {
  const expected = Buffer.isBuffer(value) ? value : json(value);
  if (await exists(path)) {
    if (!(await bytes(path, Math.max(expected.length, 1))).equals(expected)) throw failure('FEEDS_RETAINED_CONFLICT', 'The retained original selection contains different bytes.');
    return;
  }
  const temporary = join(dirname(path), '.write-' + randomUUID()), handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(expected); await handle.sync();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await bytes(path, Math.max(expected.length, 1))).equals(expected)) throw failure('FEEDS_RETAINED_CONFLICT', 'The retained original selection contains different bytes.');
    }
    await syncDirectory(dirname(path));
  } finally { await handle.close(); await unlink(temporary).catch(() => {}); }
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare paths only in the owned private connection file.');
  return resolve(base, value);
}
function named(value, label, maximum = 32) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > maximum) throw failure('CONFIGURATION_ERROR', 'Too many ' + label + '.');
  return Object.entries(value).map(([key, item]) => [identifier(key, label + ' alias'), item]);
}
/** Resolve host references without opening a feed writer, publisher or account. */
export async function readFeedsWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await bytes(path, MiB));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== FEEDS_CONNECTION_SCHEMA || !plain(raw.workspaces) || !Object.keys(raw.workspaces).length ||
      Object.keys(raw.workspaces).length > 32) throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original feed consoles.');
  const { compileHttpSellerOffer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/seller.mjs');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'Feed workspace alias');
    exact(input, ['label', 'consoleUrlEnv', 'consoleUrlFile', 'files', 'merchantProfiles', 'buyerWorkspaces', 'runtime']);
    if ((input.consoleUrlEnv === undefined) === (input.consoleUrlFile === undefined))
      throw failure('CONFIGURATION_ERROR', 'Declare exactly one private console URL environment or file reference.');
    const files = Object.create(null), merchantProfiles = Object.create(null), buyerWorkspaces = Object.create(null);
    for (const [key, source] of named(input.files, 'input files', 128)) {
      exact(source, ['path', 'kind', 'label', 'sha256'], ['path', 'kind', 'sha256']);
      if (!['feed', 'opml', 'feed-project', 'collection-project'].includes(source.kind))
        throw failure('CONFIGURATION_ERROR', 'Choose a feed, OPML or original project packet kind.');
      files[key] = { path: hostPath(source.path, base), kind: source.kind, label: line(source.label ?? key),
        sha256: checked(source.sha256, SHA, 'source SHA256') };
    }
    for (const [key, profile] of named(input.merchantProfiles, 'merchant profiles')) {
      exact(profile, ['label', 'origin', 'path', 'payment'], ['origin', 'path', 'payment']);
      let origin;
      try { origin = new URL(profile.origin); } catch { throw failure('CONFIGURATION_ERROR', 'Choose the original public HTTPS merchant origin.'); }
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
          typeof profile.path !== 'string' || !profile.path.startsWith('/') || new URL(profile.path, origin).origin !== origin.origin ||
          new URL(profile.path, origin).pathname !== profile.path)
        throw failure('CONFIGURATION_ERROR', 'Declare a canonical public HTTPS merchant origin and route.');
      compileHttpSellerOffer({ method: 'GET', url: origin.origin + profile.path, description: 'Feed dataset', payment: profile.payment });
      merchantProfiles[key] = { label: line(profile.label ?? key), origin: origin.origin, path: profile.path, payment: structuredClone(profile.payment) };
    }
    for (const [key, buyer] of named(input.buyerWorkspaces, 'buyer workspaces')) {
      exact(buyer, ['label', 'directory'], ['directory']);
      buyerWorkspaces[key] = { label: line(buyer.label ?? key), directory: await directory(hostPath(buyer.directory, base)) };
    }
    const runtime = input.runtime ?? { port: 0 };
    exact(runtime, ['port', 'facilitator', 'allowLocalFacilitator']);
    integer(runtime.port ?? 0, 0, 65535, 'merchant port');
    if (runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean')
      throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
    if (runtime.facilitator !== undefined) {
      const endpoint = new URL(runtime.facilitator);
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:' &&
          !(runtime.allowLocalFacilitator === true && endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'))
        throw failure('CONFIGURATION_ERROR', 'Use an original HTTPS or explicitly selected loopback facilitator.');
    }
    workspaces[name] = { label: line(input.label ?? name), files, merchantProfiles, buyerWorkspaces,
      runtime: { ...structuredClone(runtime), port: runtime.port ?? 0 },
      ...(input.consoleUrlEnv === undefined ? { consoleUrlFile: hostPath(input.consoleUrlFile, base) }
        : { consoleUrlEnv: checked(input.consoleUrlEnv, ENV, 'console URL environment name') }) };
  }
  return { schema: FEEDS_CONNECTION_SCHEMA, workspaces };
}

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const sha = { type: 'string', pattern: SHA.source }, nativeId = { type: 'string', pattern: ID.source };
const uuid = { type: 'string', pattern: UUID.source }, object = { type: 'object' };
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 250 }, expectedSnapshot: sha };
const scoped = properties => ({ workspace: alias, ...properties });
const readOnly = { readOnly: true, idempotent: true };
const actionKeys = {
  'collection-save': ['collectionId', 'title', 'members', 'newFeeds', 'expectedRevision', 'operationId'],
  'collection-capture': ['collectionId', 'expectedRevision', 'expectedRevisions', 'operationId', 'pageLimit', 'force'],
  'collection-resume': ['runId'],
  'collection-edition': ['runId', 'name', 'fields', 'expectedRevisions', 'operationId'],
  register: ['feedId', 'config', 'expectedRevision', 'operationId'],
  capture: ['feedId', 'operationId', 'followPages', 'pageLimit', 'force', 'fromCapture'],
  resume: ['captureId'],
  apply: ['captureId', 'expectedRevision', 'operationId', 'decisions', 'acceptIdentity'],
  annotate: ['feedId', 'identity', 'expectedRevision', 'operationId', 'note', 'tags', 'starred'],
  edition: ['feedIds', 'name', 'fields', 'expectedRevisions', 'operationId'],
  query: ['editionId', 'params'], compare: ['beforeId', 'afterId'],
};
const feedConfigSchema = { type: 'object', properties: {
  url: { type: 'string', maxLength: 8192 }, label: { type: 'string', minLength: 1, maxLength: 160 },
  rssIdentity: { type: 'string', enum: ['guid','guid-or-link'] },
  allowedOrigins: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' } }
}, required: ['url'], additionalProperties: false };
const fieldsSchema = { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true,
  items: { type: 'string', enum: ['key','id','title','link','published','updated','summary','content','authors','categories','enclosures','feed_id','source_url','source_sha256'] } };
const revisionSchema = { type: 'integer', minimum: 0 };
const revisionsSchema = { type: 'object', additionalProperties: revisionSchema };
const actionInputSchema = { type: 'object', additionalProperties: false, properties: {
  operationId: nativeId, feedId: nativeId, config: feedConfigSchema, expectedRevision: revisionSchema,
  collectionId: nativeId, title: { type: 'string', minLength: 1, maxLength: 160 },
  members: { type: 'array', minItems: 1, maxItems: 10000, items: { type: 'object', properties: {
    sourceId: { anyOf: [sha, {type:'null'}] }, entryId: { anyOf: [{type:'string'}, {type:'null'}] },
    feedId: { anyOf: [nativeId, {type:'null'}] }, enabled: { type: 'boolean' }
  }, required: ['sourceId','entryId','feedId','enabled'], additionalProperties: false } },
  newFeeds: { type: 'object', additionalProperties: feedConfigSchema }, expectedRevisions: revisionsSchema,
  pageLimit: { type: 'integer', minimum: 1, maximum: 1000 }, followPages: { type: 'boolean' }, force: { type: 'boolean' },
  fromCapture: sha, captureId: sha, runId: sha,
  decisions: { type: 'object', additionalProperties: { anyOf: [sha, {const:'keep'}] } }, acceptIdentity: { type: 'boolean' },
  identity: sha, note: { type: 'string', maxLength: 20000 }, tags: { type: 'array', maxItems: 32, items: {type:'string',minLength:1,maxLength:80} },
  starred: { type: 'boolean' }, feedIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: nativeId },
  name: { type: 'string', minLength: 1, maxLength: 128 }, fields: fieldsSchema,
  editionId: sha, params: { type: 'object', additionalProperties: { type:'string' } }, beforeId: sha, afterId: sha,
} };
const actionRequired = {
  'collection-save':['collectionId','title','members','expectedRevision','operationId'],
  'collection-capture':['collectionId','expectedRevision','expectedRevisions','operationId'],
  'collection-resume':['runId'], 'collection-edition':['runId','name','fields','expectedRevisions','operationId'],
  register:['feedId','config','expectedRevision','operationId'], capture:['feedId','operationId'], resume:['captureId'],
  apply:['captureId','expectedRevision','operationId'], annotate:['feedId','identity','expectedRevision','operationId'],
  edition:['feedIds','name','fields','expectedRevisions','operationId'], query:['editionId'], compare:['beforeId','afterId'],
};
const publisherActions = [
  'publisher.status', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect', 'publisher.release.stage', 'publisher.release.inspect',
  'publisher.release.activate', 'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session',
  'publisher.buyer.run', 'publisher.buyer.recover', 'publisher.buyer.account', 'publisher.buyer.export',
];
export function feedsWorkspaceTools(tool) {
  return [
    tool('merchant_feeds_workspaces', 'List host-declared original feed consoles, source/packet handles, merchant profiles and existing buyer workspaces. Opens no second writer or browser.', {}, [], readOnly),
    tool('merchant_feeds_status', 'Read original asynchronous activity and saved feed/subscription counts. RUNNING describes the actual console worker; RESULT_RETAINED is available by original operation ID after restart.', scoped({}), ['workspace'], readOnly),
    tool('merchant_feeds_inventory', 'Page registered feeds, immutable editions, OPML sources or saved collections. Continue the same inventory with expectedSnapshot.', scoped({ kind: { type: 'string', enum: ['feeds', 'editions', 'subscription-sources', 'collections'] }, ...page }), ['workspace', 'kind'], readOnly),
    tool('merchant_feeds_read', 'Read the original operation, subscription plan, collection, collection run, capture/review/requests/records, edition or comparison. Large complete responses remain downloadable. array selects a saved response array for exact snapshot pagination.', scoped({
      kind: { type: 'string', enum: ['operation', 'subscription-plan', 'collection', 'collection-run', 'captures', 'review', 'requests', 'records', 'edition', 'changes'] },
      id: nativeId, family: { type: 'string', enum: ['feed', 'collection'] }, revision: { type: 'integer', minimum: 1 },
      query: { type: 'string', maxLength: 1000 }, state: { type: 'string', enum: ['active', 'deleted', 'all'] },
      array: { type: 'string', enum: ['entries', 'items', 'requests', 'collection.members', 'feeds', 'registrations', 'runs', 'editions', 'revisions'] }, ...page }), ['workspace', 'kind', 'id'], readOnly),
    tool('merchant_feeds_action', 'Submit an original feed action. HTTP202 is an accepted worker, not completed work. Preserve operationId and poll status/read; resume captures and collections by their original IDs. The original source validates complete configs, member choices, revisions, conflicts and scalar-string query parameters.', scoped({
      action: { type: 'string', enum: Object.keys(actionKeys) }, input: actionInputSchema }), ['workspace', 'action', 'input'], { openWorld: true }),
    tool('merchant_feeds_intake', 'Import a host-declared exact feed XML or OPML source through the existing console. The original server checks the selected full SHA256 before starting its retained operation.', scoped({
      file: alias, operationId: nativeId, feedId: nativeId, sourceUrl: { type: 'string', maxLength: 8192 } }), ['workspace', 'file', 'operationId']),
    tool('merchant_feeds_cancel', 'Request cancellation only for the exact currently running console job. The original operation retains its progress; inspect it before resuming.', scoped({ jobId: sha }), ['workspace', 'jobId'], { idempotent: true }),
    tool('merchant_feeds_export', 'Retain a complete original feed/collection project, native dataset, OPML selection/source, HTTP body, XML source or changes file. The same operationId recovers its first complete export after restart.', scoped({
      operationId: nativeId, kind: { type: 'string', enum: ['feed-project', 'collection-project', 'dataset', 'opml', 'opml-source', 'source', 'http-body', 'changes'] },
      id: nativeId, revision: { type: 'integer', minimum: 1 } }), ['workspace', 'operationId', 'kind', 'id'], { idempotent: true }),
    tool('merchant_feeds_exports', 'Page complete retained deliveries and unfinished preparation intents. Saved complete files remain usable without a console or publisher process.', scoped(page), ['workspace'], readOnly),
    tool('merchant_feeds_receive', 'Receive one exact original feed or collection project through the existing destination console. Select a host packet or a complete retained export from a configured source workspace; native reconstruction retains sources, operations and editions.', scoped({
      operationId: nativeId, file: alias, fromWorkspace: alias, exportId: sha }), ['workspace', 'operationId']),
    tool('merchant_feeds_publisher_prepare', 'Materialize the original selected feed dataset/lineage, prepare its native merchant source package and adopt it into the existing dataset publisher. The same productId retains draft/review, release, buyer and source history.', scoped({
      productId: uuid, editionId: sha, profile: alias }), ['workspace', 'productId', 'editionId', 'profile'], { idempotent: true }),
    tool('merchant_feeds_publishers', 'List retained original publisher product IDs, or read one complete native draft/release/customer state after reopen. Publisher IDs are durable; release ownership remains the original native lifecycle.', scoped({ productId: uuid }), ['workspace'], readOnly),
    tool('merchant_feeds_publisher', 'Operate the original dataset publisher: preview/review/publish, SF82 stage/activate/rollback/start/drain, and reviewed SF88/SF100 buyer session/run/recover/account/export. Stage uses host runtime. buyer.session uses a named buyerWorkspace; signer and approval settings remain in that original workspace.', scoped({
      productId: uuid, action: { type: 'string', enum: publisherActions }, input: object }), ['workspace', 'productId', 'action', 'input']),
    tool('merchant_feeds_publisher_export', 'Retain original publisher CSV/review/config, or the complete completed customer result (acquisition manifest, CSV, JSONL and review). Reads actual native saved outputs; no new purchase.', scoped({
      productId: uuid, operationId: nativeId, id: uuid,
      kind: { type: 'string', enum: ['draft-csv', 'draft-review', 'buyer-config', 'customer'] } }), ['workspace', 'productId', 'operationId', 'id', 'kind'], { idempotent: true }),
    tool('merchant_feeds_download_manifest', 'Inspect the exact retained delivery manifest before downloading its complete files.', scoped({ exportId: sha }), ['workspace', 'exportId'], readOnly),
    tool('merchant_feeds_download_file', 'Read one original retained file in bounded verified chunks. Continue with readId, nextOffset and the same manifest/file SHA256; an expired read can reopen the same immutable file without regenerating an export.', scoped({
      exportId: sha, file: { type: 'string', minLength: 1, maxLength: 160 }, expectedManifestSha256: sha, expectedSha256: sha,
      readId: uuid, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES }
    }), ['workspace', 'exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], readOnly),
    tool('merchant_feeds_download_file_release', 'Release this transport read while preserving its complete retained original delivery.', scoped({ exportId: sha, readId: uuid }), ['workspace', 'exportId', 'readId'], { idempotent: true }),
  ];
}
const definitions = new Map(feedsWorkspaceTools((name, description, properties, required) => ({ name, properties, required })).map(t => [t.name, t]));
function paged(items, input) {
  if (!Array.isArray(items)) throw failure('INVALID_PARAMS', 'Select an array in this original response.');
  const offset = integer(input.offset ?? 0, 0, items.length, 'inventory offset'), limit = integer(input.limit ?? 50, 1, 250, 'page size');
  const snapshot = fingerprint(items);
  if (input.expectedSnapshot !== undefined && checked(input.expectedSnapshot, SHA, 'inventory snapshot') !== snapshot)
    throw failure('FEEDS_INVENTORY_CHANGED', 'The original inventory changed. Read page zero to select its current snapshot.');
  if (offset && !input.expectedSnapshot) throw failure('FEEDS_SNAPSHOT_REQUIRED', 'Continue the original returned inventory snapshot.');
  return { snapshot, total: items.length, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}
async function responseBytes(response, maximum) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > maximum) throw failure('FEEDS_RESPONSE_SIZE', 'The complete original response exceeds this interactive JSON limit; use its native project/source export.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

export class MerchantFeedWorkspaces {
  #config; #environment; #pending = new Set(); #requests = new Set(); #publishers = new Map();
  #tails = new Map(); #closing = false; #close; #reads = new RetainedSourceFileReads({ errorPrefix: 'FEEDS' });
  constructor(config, { environment = process.env } = {}) { this.#config = config; this.#environment = environment; }
  get summary() { return { configured: Boolean(this.#config.feedsWorkspaces), ownership: 'EXISTING_FEED_CONSOLE',
    pending: this.#pending.size, openedPublishers: this.#publishers.size, fileReads: this.#reads.summary().length, closing: this.#closing }; }
  #declared(workspace) {
    identifier(workspace, 'Feed workspace alias');
    const selected = this.#config.feedsWorkspaces?.workspaces?.[workspace];
    if (!selected) throw failure('FEEDS_WORKSPACE_NOT_CONFIGURED', 'Choose a workspace from merchant_feeds_workspaces.');
    return selected;
  }
  #workspaces() {
    return { ...this.summary, workspaces: Object.entries(this.#config.feedsWorkspaces?.workspaces ?? {}).map(([workspace, item]) => ({
      workspace, label: item.label,
      inputs: Object.entries(item.files).map(([file, source]) => ({ file, kind: source.kind, label: source.label, sha256: source.sha256 })),
      merchantProfiles: Object.entries(item.merchantProfiles).map(([profile, value]) => ({ profile, ...value })),
      buyerWorkspaces: Object.entries(item.buyerWorkspaces).map(([buyerWorkspace, value]) => ({ buyerWorkspace, label: value.label })),
      fileReads: this.#reads.summary(workspace),
    })) };
  }
  async #root(workspace) {
    this.#declared(workspace);
    await directory(this.#config.exportsDirectory);
    const parent = await directory(join(this.#config.exportsDirectory, 'feeds'), true);
    return directory(join(parent, workspace), true);
  }
  async #folder(workspace, name) { return directory(join(await this.#root(workspace), name), true); }
  async #exclusive(key, run) {
    const previous = this.#tails.get(key) ?? Promise.resolve(), pending = previous.catch(() => {}).then(run);
    this.#tails.set(key, pending);
    try { return await pending; } finally { if (this.#tails.get(key) === pending) this.#tails.delete(key); }
  }
  async #connection(entry) {
    let raw = entry.consoleUrlEnv === undefined
      ? new TextDecoder('utf-8', { fatal: true }).decode(await bytes(entry.consoleUrlFile, 65536)).trim()
      : this.#environment[entry.consoleUrlEnv]?.trim();
    let launch;
    if (typeof raw === 'string' && raw.startsWith('{')) {
      try { launch = JSON.parse(raw); } catch { throw failure('FEEDS_CONSOLE_REFERENCE', 'The private native launch record is not valid JSON.'); }
      if (launch.schema !== 'stellar-forge.feed-workspace-launch.v1' || launch.status !== 'FEED_WORKSPACE_READY' ||
          !SHA.test(launch.bindingSha256 ?? '') || typeof launch.workspace !== 'string' ||
          !Number.isSafeInteger(launch.pid) || launch.pid < 1 || typeof launch.feeds !== 'string')
        throw failure('FEEDS_CONSOLE_REFERENCE', 'Select the original complete feed workspace launch record.');
      raw = launch.feeds;
    }
    let url;
    try { url = new URL(raw); } catch { throw failure('FEEDS_CONSOLE_REFERENCE', 'Start the declared original feed console and refresh its private URL reference.'); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '0' || url.username || url.password ||
        url.pathname !== '/' || url.search || !/^[A-Za-z0-9_-]{32,256}$/.test(url.hash.slice(1)))
      throw failure('FEEDS_CONSOLE_REFERENCE', 'Use the original loopback feed URL and private capability fragment.');
    return { origin: url.origin, token: url.hash.slice(1), launch };
  }
  async #request(entry, route, options, consume) {
    const connection = await this.#connection(entry), controller = new AbortController();
    if (this.#closing) throw failure('FEEDS_CLOSING', 'The original feed transport is closing.');
    this.#requests.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]);
    try {
      signal.throwIfAborted();
      const headers = { authorization: 'Bearer ' + connection.token, ...options.headers };
      if (connection.launch) {
        const observed = await fetch(connection.origin + '/api/launch', { redirect: 'error', signal,
          headers: { authorization: headers.authorization, accept: 'application/json' } });
        if (observed.status !== 200) { await observed.body?.cancel(); throw failure('FEEDS_LAUNCH_CHANGED', 'The selected managed feed process is no longer available. Refresh its original launch record.'); }
        const live = parse(await responseBytes(observed, 65536)), selected = connection.launch;
        if (live.schema !== selected.schema || live.status !== selected.status || live.bindingSha256 !== selected.bindingSha256 ||
            live.workspace !== selected.workspace || live.pid !== selected.pid || live.feeds !== selected.feeds ||
            live.sourceRoot !== selected.sourceRoot || fingerprint(live) !== fingerprint(selected))
          throw failure('FEEDS_LAUNCH_CHANGED', 'This capability belongs to a different original workspace, source binding or process. Refresh the managed launch record.');
      }
      const response = await fetch(connection.origin + route, { method: options.body === undefined ? 'GET' : 'POST',
        redirect: 'error', signal, headers, ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.stream ? { duplex: 'half' } : {}) });
      if (!response.ok) {
        const raw = await responseBytes(response, MiB);
        let reason = 'The original console returned HTTP ' + response.status + '.', native;
        try { native = parse(raw); if (typeof native.error === 'string') reason = native.error; } catch {}
        const error = failure('FEEDS_CONSOLE_HTTP_' + response.status, reason);
        error.activity = native?.activity; throw error;
      }
      return await consume(response);
    } catch (error) {
      if (typeof error.code === 'string' && /^(FEEDS_|INVALID_PARAMS|CONFIGURATION_ERROR|EACCES|ENOSPC|EDQUOT|EIO)/.test(error.code)) throw error;
      throw failure('FEEDS_CONSOLE_REPLY_UNAVAILABLE', 'The original console reply was interrupted. Read its activity and exact original operation before another mutation.');
    } finally { this.#requests.delete(controller); }
  }
  async #json(entry, route, body) {
    const data = body === undefined ? undefined : json(body);
    if (data && data.length > MAX_ACTION) throw failure('INVALID_PARAMS', 'The original action exceeds 16 MiB.');
    return this.#request(entry, route, { body: data, headers: { accept: 'application/json',
      ...(data === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(data.length) }) } },
      async response => parse(await responseBytes(response, MAX_JSON)));
  }
  async #copyResponse(entry, route, path, maximum, expected) {
    if (await exists(path)) {
      const retained = await hashFile(path, maximum, true);
      try {
        if (expected && (retained.sha256 !== expected.sha256 || retained.bytes !== expected.bytes))
          throw failure('FEEDS_FILE_CHANGED', 'The retained original export differs from its selected native manifest.');
        return { bytes: retained.bytes, sha256: retained.sha256 };
      } finally { await retained.handle.close(); }
    }
    return this.#request(entry, route, { headers: { accept: 'application/octet-stream' } }, async response => {
      const declared = response.headers.get('content-length');
      if (!declared || !/^(0|[1-9][0-9]*)$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)
        throw failure('FEEDS_FILE_SIZE', 'The original console did not declare a supported complete file size.');
      const temporary = join(dirname(path), '.download-' + randomUUID()), handle = await open(temporary, 'wx', 0o600), digest = createHash('sha256');
      let length = 0;
      try {
        for await (const chunk of response.body ?? []) {
          length += chunk.length;
          if (length > maximum || length > Number(declared)) throw failure('FEEDS_FILE_SIZE', 'The original console exceeded its declared file size.');
          digest.update(chunk); await handle.writeFile(chunk);
        }
        const sha256 = digest.digest('hex');
        if (length !== Number(declared) || expected && (length !== expected.bytes || sha256 !== expected.sha256))
          throw failure('FEEDS_FILE_CHANGED', 'The complete original response differs from its retained file identity.');
        await handle.sync(); await link(temporary, path); await syncDirectory(dirname(path));
        return { bytes: length, sha256 };
      } finally { await handle.close(); await unlink(temporary).catch(() => {}); }
    });
  }
  async #manifest(workspace, exportId) {
    this.#declared(workspace); checked(exportId, SHA, 'delivery ID');
    const root = await directory(join(await this.#folder(workspace, 'deliveries'), exportId));
    const raw = await bytes(join(root, FEEDS_MANIFEST_NAME), 65000);
    const manifest = parseFeedsDeliveryManifest(raw, exportId);
    if (manifest.workspace !== workspace) throw failure('FEEDS_EXPORT_CONFLICT', 'This delivery belongs to another original workspace.');
    return { root, manifest, raw, manifestSha256: hash(raw) };
  }
  #manifestInfo(saved) {
    return { state: 'MANIFEST_RETAINED', exportId: saved.manifest.exportId, workspace: saved.manifest.workspace,
      kind: saved.manifest.kind, selection: saved.manifest.selection, files: saved.manifest.files,
      manifestFile: { name: FEEDS_MANIFEST_NAME, bytes: saved.raw.length, sha256: saved.manifestSha256 },
      manifestSha256: saved.manifestSha256 };
  }
  async #delivery(workspace, intent, generate) {
    const exportId = fingerprint({ workspace, ...intent }), parent = await this.#folder(workspace, 'deliveries');
    return this.#exclusive('delivery:' + workspace + ':' + exportId, async () => {
      const root = await directory(join(parent, exportId), true), lease = await acquireStateLease(root);
      try {
        lease.assertHeld(); await immutable(join(root, 'request.json'), { workspace, ...intent, exportId });
        if (await exists(join(root, FEEDS_MANIFEST_NAME))) return this.#manifestInfo(await this.#manifest(workspace, exportId));
        const files = await generate(root);
        lease.assertHeld();
        const manifest = { schema: FEEDS_DELIVERY_SCHEMA, exportId, workspace, kind: intent.kind,
          selection: intent.selection, files, createdAt: new Date().toISOString() };
        parseFeedsDeliveryManifest(json(manifest), exportId);
        await immutable(join(root, FEEDS_MANIFEST_NAME), manifest);
        return this.#manifestInfo(await this.#manifest(workspace, exportId));
      } finally { await lease.close(); }
    });
  }
  async #present(workspace, native, selection) {
    const raw = json(native);
    if (raw.length <= 65536) return { workspace, native };
    const resultFile = await this.#delivery(workspace, { kind: 'result', selection, contentSha256: hash(raw) }, async root => {
      await immutable(join(root, 'result.json'), raw);
      return [{ name: 'result.json', bytes: raw.length, sha256: hash(raw), contentType: 'application/json' }];
    });
    const summary = Object.fromEntries(['schema','state','id','operationId','action','sourceId','editionId','rowCount','nextOffset','total']
      .filter(key => native[key] !== undefined && (native[key] === null || typeof native[key] !== 'object')).map(key => [key, native[key]]));
    if (plain(native.activity)) summary.activity = Object.fromEntries(['id','operationId','action','state','startedAt','completedAt']
      .filter(key => native.activity[key] !== undefined).map(key => [key, native.activity[key]]));
    if (plain(native.counts)) summary.counts = native.counts;
    if (plain(native.result)) for (const key of ['sourceId','id','editionId','rowCount'])
      if (typeof native.result[key] === 'string' || typeof native.result[key] === 'number') summary['result' + key[0].toUpperCase() + key.slice(1)] = native.result[key];
    return { workspace, nativeSummary: summary, completeResult: resultFile };
  }
  async #upload(entry, selected, route, maximum) {
    const original = await hashFile(selected.path, maximum, false);
    let stream;
    try {
      if (original.sha256 !== selected.sha256) throw failure('FEEDS_INPUT_CHANGED', 'This source differs from the exact host-selected SHA256.');
      stream = original.handle.createReadStream({ start: 0, autoClose: false });
      return await this.#request(entry, route + '&sha256=' + original.sha256, {
        body: stream, stream: true, headers: { 'content-type': 'application/octet-stream', 'content-length': String(original.bytes) } },
        async response => parse(await responseBytes(response, MAX_JSON)));
    } finally { stream?.destroy(); await original.handle.close(); }
  }
  async #nativeDataset(workspace, entry, editionId) {
    const native = await this.#json(entry, '/api/export/manifest?edition=' + editionId);
    if (native.schema !== 'stellar-forge.feed-dataset-export.v1' || native.editionId !== editionId || !SHA.test(native.manifestSha256 ?? '') ||
        !plain(native.files) || Object.keys(native.files).sort().join(',') !== 'data.csv,dataset.json,feed-lineage.json,xml-lineage.json')
      throw failure('FEEDS_DATASET_MANIFEST', 'Use the complete original feed dataset export manifest.');
    const originalManifest = { schema: native.schema, editionId: native.editionId, files: native.files };
    if (hash(Buffer.from(JSON.stringify(canonical(originalManifest)) + '\n')) !== native.manifestSha256)
      throw failure('FEEDS_DATASET_MANIFEST', 'The original dataset manifest SHA256 differs from its complete file inventory.');
    for (const [name, info] of Object.entries(native.files)) {
      if (!plain(info) || !SHA.test(info.sha256 ?? '') || !Number.isSafeInteger(info.bytes) || info.bytes < 0 || info.bytes > 256 * MiB)
        throw failure('FEEDS_DATASET_MANIFEST', 'The original dataset member exceeds its exact declared identity or native limit.');
    }
    const parent = await this.#folder(workspace, 'datasets'), root = await directory(join(parent, native.manifestSha256), true);
    return this.#exclusive('dataset:' + workspace + ':' + native.manifestSha256, async () => {
      const lease = await acquireStateLease(root);
      try {
        await immutable(join(root, 'native-export.json'), native);
        for (const [name, info] of Object.entries(native.files)) {
          lease.assertHeld();
          await this.#copyResponse(entry, '/api/export/file?edition=' + editionId + '&manifest=' + native.manifestSha256 + '&file=' + encodeURIComponent(name),
            join(root, name), 256 * MiB, info);
        }
        return root;
      } finally { await lease.close(); }
    });
  }
  async #publisher(workspace, productId, create = false) {
    this.#declared(workspace); checked(productId, UUID, 'publisher product UUID');
    const key = workspace + ':' + productId;
    if (!this.#publishers.has(key)) {
      const opening = (async () => {
        const parent = await this.#folder(workspace, 'products');
        if (!create && !await exists(join(parent, productId))) throw failure('FEEDS_PRODUCT_NOT_FOUND', 'Prepare or select a retained original publisher product.');
        const root = await directory(join(parent, productId), create);
        const { openSocrataPublisher } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/publisher.mjs');
        const native = await openSocrataPublisher({ directory: join(root, 'publisher') });
        return { root, native };
      })();
      this.#publishers.set(key, opening);
      try { await opening; } catch (error) { if (this.#publishers.get(key) === opening) this.#publishers.delete(key); throw error; }
    }
    return this.#publishers.get(key);
  }
  async #read(workspace, entry, args) {
    const id = checked(args.id, ID, 'retained feed item ID'), q = new URLSearchParams();
    const directPages = ['captures', 'review', 'records', 'changes'].includes(args.kind);
    if (directPages && args.array) throw failure('INVALID_PARAMS', 'The original route already returns its native page; omit array.');
    if (directPages && args.expectedSnapshot) throw failure('INVALID_PARAMS', 'This original live page uses its native nextOffset and revision checks. Select a retained edition for immutable query results.');
    if (directPages) { q.set('offset', String(integer(args.offset ?? 0, 0, Number.MAX_SAFE_INTEGER))); q.set('limit', String(integer(args.limit ?? 50, 1, 250))); }
    let route;
    switch (args.kind) {
      case 'operation':
        if (!['feed', 'collection'].includes(args.family ?? 'feed')) throw failure('INVALID_PARAMS', 'Choose the original feed or collection operation family.');
        route = '/api/operation'; q.set('id', id); q.set('family', args.family ?? 'feed'); break;
      case 'subscription-plan': route = '/api/subscriptions/plan'; q.set('source', checked(id, SHA, 'OPML source SHA256')); break;
      case 'collection':
        route = '/api/subscriptions/collection'; q.set('id', id);
        if (args.revision !== undefined) q.set('revision', String(integer(args.revision, 1, Number.MAX_SAFE_INTEGER)));
        break;
      case 'collection-run': route = '/api/subscriptions/run'; q.set('id', checked(id, SHA, 'collection run ID')); break;
      case 'captures': route = '/api/captures'; q.set('feed', id); break;
      case 'review': route = '/api/review'; q.set('capture', checked(id, SHA, 'capture ID')); break;
      case 'requests': route = '/api/requests'; q.set('capture', checked(id, SHA, 'capture ID')); break;
      case 'records':
        route = '/api/records'; q.set('feed', id);
        if (args.query !== undefined) { if (typeof args.query !== 'string' || args.query.length > 1000) throw failure('INVALID_PARAMS', 'Use a native record search up to 1000 characters.'); q.set('query', args.query); }
        if (args.state !== undefined) { if (!['active','deleted','all'].includes(args.state)) throw failure('INVALID_PARAMS', 'Choose active, deleted or all.'); q.set('state', args.state); }
        break;
      case 'edition': route = '/api/edition'; q.set('id', checked(id, SHA, 'edition ID')); break;
      case 'changes': route = '/api/changes'; q.set('id', checked(id, SHA, 'comparison ID')); break;
      default: throw failure('INVALID_PARAMS', 'Choose an original feed read operation.');
    }
    const native = await this.#json(entry, route + '?' + q), selection = { kind: args.kind, id, ...(args.family ? { family: args.family } : {}) };
    if (args.array || args.kind === 'requests') {
      const name = args.array ?? 'requests';
      if (!['entries','items','requests','collection.members','feeds','registrations','runs','editions','revisions'].includes(name))
        throw failure('INVALID_PARAMS', 'Choose a declared original response array.');
      let selected = native;
      if (!Array.isArray(native)) {
        for (const key of name.split('.')) {
          if (!plain(selected) || !Object.hasOwn(selected, key)) throw failure('INVALID_PARAMS', 'The selected original response has no such array.');
          selected = selected[key];
        }
      }
      return this.#present(workspace, { selection, array: name, ...paged(selected, args) }, { ...selection, array: name, offset: args.offset ?? 0 });
    }
    return this.#present(workspace, native, selection);
  }
  async #export(workspace, entry, args) {
    const operationId = checked(args.operationId, ID, 'export operation ID'), id = checked(args.id, ID, 'original selection');
    let route, name, contentType, maximum = MAX_FEEDS_DELIVERY_BYTES;
    const selection = { id };
    switch (args.kind) {
      case 'feed-project': checked(id, SHA, 'edition ID'); route = '/api/project?edition=' + id; name = 'feed-project.zip'; contentType = 'application/zip'; maximum = 1024 * MiB; break;
      case 'collection-project': checked(id, SHA, 'collection binding ID'); route = '/api/subscriptions/project?binding=' + id; name = 'feed-collection.zip'; contentType = 'application/zip'; break;
      case 'dataset': checked(id, SHA, 'edition ID'); route = '/api/export?edition=' + id; name = 'feed-dataset.zip'; contentType = 'application/zip'; break;
      case 'opml':
        route = '/api/subscriptions/opml?collection=' + encodeURIComponent(id); name = 'subscriptions.opml'; contentType = 'text/x-opml'; maximum = 16 * MiB;
        if (args.revision !== undefined) { selection.revision = integer(args.revision, 1, Number.MAX_SAFE_INTEGER); route += '&revision=' + selection.revision; }
        break;
      case 'opml-source': checked(id, SHA, 'OPML source ID'); route = '/api/subscriptions/original?source=' + id; name = 'original-subscriptions.opml'; contentType = 'text/x-opml'; maximum = 16 * MiB; break;
      case 'source': checked(id, SHA, 'XML source ID'); route = '/api/source?sha256=' + id; name = 'feed-source.xml'; contentType = 'application/xml'; maximum = 32 * MiB; break;
      case 'http-body': checked(id, SHA, 'original HTTP body ID'); route = '/api/http-body?sha256=' + id; name = 'feed-http.body'; contentType = 'application/octet-stream'; maximum = 32 * MiB; break;
      case 'changes': checked(id, SHA, 'comparison ID'); route = '/api/changes/download?id=' + id; name = 'feed-changes.jsonl'; contentType = 'application/x-ndjson'; maximum = 1024 * MiB; break;
      default: throw failure('INVALID_PARAMS', 'Choose a complete original feed export.');
    }
    if (args.revision !== undefined && args.kind !== 'opml') throw failure('INVALID_PARAMS', 'Only a selected OPML collection export takes revision.');
    return this.#delivery(workspace, { kind: args.kind, operationId, selection }, async root => {
      const selected = await this.#copyResponse(entry, route, join(root, name), maximum);
      return [{ name, ...selected, contentType }];
    });
  }
  async #exports(workspace, args) {
    const root = await this.#folder(workspace, 'deliveries'), rows = [];
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (!item.isDirectory() || !SHA.test(item.name)) continue;
      try { rows.push(this.#manifestInfo(await this.#manifest(workspace, item.name))); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        let request;
        try { request = parse(await bytes(join(root, item.name, 'request.json'), 65000)); }
        catch (missing) {
          if (missing.code !== 'ENOENT') throw missing;
          rows.push({ state: 'PREPARATION_UNBOUND', exportId: item.name, recovery: 'No complete original intent was saved; repeat only the original caller selection.' }); continue;
        }
        rows.push({ state: 'PREPARING', exportId: item.name, kind: request.kind, operationId: request.operationId,
          selection: request.selection, recovery: 'Repeat the original export selection and operationId.' });
      }
    }
    return { workspace, ...paged(rows.sort((a,b) => a.exportId.localeCompare(b.exportId)), args) };
  }
  async #receive(workspace, entry, args) {
    checked(args.operationId, ID, 'receiving operation ID');
    let selected;
    if (args.file !== undefined) {
      if (args.exportId !== undefined || args.fromWorkspace !== undefined) throw failure('INVALID_PARAMS', 'Select exactly one host packet or original retained export.');
      selected = entry.files[identifier(args.file, 'packet handle')];
      if (!selected || !['feed-project', 'collection-project'].includes(selected.kind))
        throw failure('INVALID_PARAMS', 'Select a host-declared original feed or collection project packet.');
    } else {
      const from = args.fromWorkspace ?? workspace, saved = await this.#manifest(from, args.exportId);
      if (!['feed-project', 'collection-project'].includes(saved.manifest.kind) || saved.manifest.files.length !== 1)
        throw failure('INVALID_PARAMS', 'Select one complete original project delivery.');
      const source = saved.manifest.files[0];
      selected = { path: join(saved.root, source.name), kind: saved.manifest.kind, sha256: source.sha256 };
    }
    const route = selected.kind === 'collection-project' ? '/api/subscriptions/receive' : '/api/receive';
    return this.#present(workspace, await this.#upload(entry, selected, route + '?operation=' + encodeURIComponent(args.operationId),
      selected.kind === 'collection-project' ? 1536 * MiB : 1024 * MiB), { kind: 'receive', operationId: args.operationId });
  }
  async #preparePublisher(workspace, entry, args) {
    checked(args.productId, UUID, 'publisher product UUID'); checked(args.editionId, SHA, 'retained feed edition');
    const profile = entry.merchantProfiles[identifier(args.profile, 'merchant profile')];
    if (!profile) throw failure('FEEDS_MERCHANT_PROFILE', 'Choose the original host-declared public merchant terms.');
    return this.#exclusive('publisher:' + workspace + ':' + args.productId, async () => {
      const product = await this.#publisher(workspace, args.productId, true);
      const datasetExport = await this.#nativeDataset(workspace, entry, args.editionId);
      const packageKey = fingerprint({ editionId: args.editionId, profile }), parent = await directory(join(product.root, 'source-packages'), true);
      const { prepareFeedPublisherPackage } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/feeds/merchant.mjs');
      const prepared = await prepareFeedPublisherPackage({ datasetExport, packageDirectory: join(parent, packageKey),
        payment: profile.payment, origin: profile.origin, path: profile.path });
      const adopted = await product.native.act('publisher.prepare', { exportDirectory: prepared.packageDirectory });
      return this.#present(workspace, { productId: args.productId, source: prepared, ...adopted },
        { kind: 'publisher-preparation', productId: args.productId, editionId: args.editionId, profile: args.profile });
    });
  }
  async #publisherAction(workspace, entry, args) {
    if (!publisherActions.includes(args.action) || !plain(args.input)) throw failure('INVALID_PARAMS', 'Choose a declared original publisher action and its complete input.');
    const input = structuredClone(args.input);
    if (args.action === 'publisher.release.stage') {
      exact(input, ['draftId','id','label']); input.runtime = structuredClone(entry.runtime);
    }
    if (args.action === 'publisher.buyer.session') {
      exact(input, ['buyerId','buyerWorkspace','maxPages','maxTotalAtomic','maxRows','maxPageBytes'], ['buyerId','buyerWorkspace','maxPages','maxTotalAtomic']);
      const buyer = entry.buyerWorkspaces[identifier(input.buyerWorkspace, 'buyer workspace')];
      if (!buyer) throw failure('FEEDS_BUYER_WORKSPACE', 'Choose a host-declared original buyer workspace.');
      delete input.buyerWorkspace; input.workspaceDirectory = buyer.directory;
    }
    const product = await this.#publisher(workspace, args.productId);
    return this.#present(workspace, { productId: args.productId, ...await product.native.act(args.action, input) },
      { kind: 'publisher-action', productId: args.productId, action: args.action });
  }
  async #publisherExport(workspace, args) {
    checked(args.operationId, ID, 'publisher export operation ID'); checked(args.id, UUID, 'native draft or customer ID');
    const kinds = args.kind === 'customer' ? ['session-manifest','session-csv','session-jsonl','session-review'] : [args.kind];
    if (kinds.some(kind => !['draft-csv','draft-review','buyer-config','session-manifest','session-csv','session-jsonl','session-review'].includes(kind)))
      throw failure('INVALID_PARAMS', 'Choose the original publisher output.');
    return this.#delivery(workspace, { kind: 'publisher-' + args.kind, operationId: args.operationId,
      selection: { productId: checked(args.productId, UUID, 'publisher product UUID'), id: args.id } }, async root => {
      const product = await this.#publisher(workspace, args.productId), files = [];
      for (const kind of kinds) {
        const selected = await product.native.readExport(kind, args.id);
        if (typeof selected.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(selected.filename))
          throw failure('FEEDS_OUTPUT_NAME', 'The original publisher returned an unsupported retained filename.');
        await immutable(join(root, selected.filename), selected.bytes);
        files.push({ name: selected.filename, bytes: selected.bytes.length, sha256: hash(selected.bytes), contentType: selected.contentType });
      }
      return files;
    });
  }
  async #download(workspace, args) {
    const saved = await this.#manifest(workspace, args.exportId);
    if (saved.manifestSha256 !== checked(args.expectedManifestSha256, SHA, 'original manifest SHA256'))
      throw failure('FEEDS_EXPORT_CHANGED', 'The retained completion manifest differs from the selected original.');
    const selected = args.file === FEEDS_MANIFEST_NAME
      ? { name: FEEDS_MANIFEST_NAME, bytes: saved.raw.length, sha256: saved.manifestSha256, contentType: 'application/json' }
      : saved.manifest.files.find(item => item.name === args.file);
    if (!selected || selected.sha256 !== checked(args.expectedSha256, SHA, 'original file SHA256'))
      throw failure('FEEDS_FILE_CHANGED', 'Select a file and digest from this exact completion manifest.');
    const chunk = await this.#reads.read({ scope: workspace, key: args.exportId + ':' + selected.name,
      readId: args.readId, expectedSha256: selected.sha256, offset: args.offset ?? 0, limit: args.limit ?? 65536,
      load: async () => {
        const original = await hashFile(join(saved.root, selected.name), selected.bytes, true);
        if (original.bytes !== selected.bytes || original.sha256 !== selected.sha256) {
          await original.handle.close(); throw failure('FEEDS_FILE_CHANGED', 'The retained original file differs from its manifest.');
        }
        return { handle: original.handle, size: original.bytes, sha256: original.sha256,
          filename: selected.name, contentType: selected.contentType };
      } });
    return { workspace, exportId: args.exportId, manifestSha256: saved.manifestSha256, ...chunk };
  }
  async #execute(name, args) {
    if (name === 'merchant_feeds_workspaces') return this.#workspaces();
    const { workspace } = args, entry = this.#declared(workspace);
    switch (name) {
      case 'merchant_feeds_status': {
        const activity = await this.#json(entry, '/api/activity');
        if (activity.state === 'RUNNING') return this.#present(workspace, { ownership: 'EXISTING_FEED_CONSOLE', activity }, { kind: 'activity', jobId: activity.id });
        const feed = await this.#json(entry, '/api/state'), subscriptions = await this.#json(entry, '/api/subscriptions');
        if (feed.schema !== 'stellar-forge.feed-workspace.v1' || subscriptions.schema !== 'stellar-forge.feed-subscription-collection.v1')
          throw failure('FEEDS_WORKSPACE_SCHEMA', 'Connect the original feed/collection console.');
        return this.#present(workspace, { ownership: 'EXISTING_FEED_CONSOLE', activity,
          counts: { feeds: feed.feeds.length, editions: feed.editions.length, subscriptionSources: subscriptions.sources.length, collections: subscriptions.collections.length },
          fields: feed.fields, defaultFields: feed.defaultFields, fileReads: this.#reads.summary(workspace) }, { kind: 'status' });
      }
      case 'merchant_feeds_inventory': {
        if (!['feeds','editions','subscription-sources','collections'].includes(args.kind)) throw failure('INVALID_PARAMS', 'Choose an original feed inventory.');
        const subscriptions = ['subscription-sources','collections'].includes(args.kind), native = await this.#json(entry, subscriptions ? '/api/subscriptions' : '/api/state');
        return this.#present(workspace, { kind: args.kind, ...paged(native[args.kind === 'subscription-sources' ? 'sources' : args.kind], args) }, { kind: 'inventory', inventory: args.kind, offset: args.offset ?? 0 });
      }
      case 'merchant_feeds_read': return this.#read(workspace, entry, args);
      case 'merchant_feeds_action': {
        if (!Object.hasOwn(actionKeys, args.action)) throw failure('INVALID_PARAMS', 'Choose an original source action.');
        exact(args.input, actionKeys[args.action], actionRequired[args.action]);
        if (args.input.operationId !== undefined) checked(args.input.operationId, ID, 'original operation ID');
        return this.#present(workspace, await this.#json(entry, '/api/action', { action: args.action, ...args.input }),
          { kind: 'action', action: args.action, ...(args.input.operationId ? { operationId: args.input.operationId } : {}) });
      }
      case 'merchant_feeds_intake': {
        const selected = entry.files[identifier(args.file, 'source handle')];
        checked(args.operationId, ID, 'source operation ID');
        if (!selected || !['feed','opml'].includes(selected.kind)) throw failure('INVALID_PARAMS', 'Select a host-declared complete feed or OPML source.');
        let route = selected.kind === 'opml' ? '/api/subscriptions/import' : '/api/import';
        route += '?operation=' + encodeURIComponent(args.operationId);
        if (selected.kind === 'feed') {
          route += '&feed=' + encodeURIComponent(checked(args.feedId, ID, 'registered feed ID'));
          if (args.sourceUrl !== undefined) {
            if (typeof args.sourceUrl !== 'string' || args.sourceUrl.length > 8192) throw failure('INVALID_PARAMS', 'Use the retained original source URL.');
            route += '&url=' + encodeURIComponent(args.sourceUrl);
          }
        } else if (args.feedId !== undefined || args.sourceUrl !== undefined) throw failure('INVALID_PARAMS', 'OPML intake takes the complete source handle and operation ID.');
        return this.#present(workspace, await this.#upload(entry, selected, route, selected.kind === 'opml' ? 16 * MiB : 32 * MiB),
          { kind: 'intake', operationId: args.operationId, sourceSha256: selected.sha256 });
      }
      case 'merchant_feeds_cancel':
        return this.#present(workspace, await this.#json(entry, '/api/cancel', { expectedJobId: checked(args.jobId, SHA, 'running console job ID') }),
          { kind: 'cancel', jobId: args.jobId });
      case 'merchant_feeds_export': return this.#export(workspace, entry, args);
      case 'merchant_feeds_exports': return this.#exports(workspace, args);
      case 'merchant_feeds_receive': return this.#receive(workspace, entry, args);
      case 'merchant_feeds_publisher_prepare': return this.#preparePublisher(workspace, entry, args);
      case 'merchant_feeds_publishers':
        if (args.productId !== undefined) return this.#present(workspace, { productId: args.productId, ...await (await this.#publisher(workspace, args.productId)).native.state() },
          { kind: 'publisher-state', productId: args.productId });
        return { workspace, products: (await readdir(await this.#folder(workspace, 'products'), { withFileTypes: true }))
          .filter(item => item.isDirectory() && UUID.test(item.name)).map(item => ({ productId: item.name, opened: this.#publishers.has(workspace + ':' + item.name) })) };
      case 'merchant_feeds_publisher': return this.#publisherAction(workspace, entry, args);
      case 'merchant_feeds_publisher_export': return this.#publisherExport(workspace, args);
      case 'merchant_feeds_download_manifest': return this.#manifestInfo(await this.#manifest(workspace, args.exportId));
      case 'merchant_feeds_download_file': return this.#download(workspace, args);
      case 'merchant_feeds_download_file_release':
        checked(args.exportId, SHA, 'delivery ID'); checked(args.readId, UUID, 'read session UUID');
        await this.#reads.release(workspace, args.readId); return { workspace, exportId: args.exportId, readId: args.readId, released: true };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown original feed workspace operation.');
    }
  }
  async call(name, input = {}) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'Feed connections are closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown original feed operation.');
    exact(input, Object.keys(definition.properties), definition.required);
    const pending = this.#execute(name, structuredClone(input)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    // Feed acquisition belongs to the existing console. Only our transport
    // requests close here; original operation IDs retain any dispatched work.
    for (const request of this.#requests) request.abort();
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const outcomes = await Promise.allSettled([...this.#publishers.values()].map(async pending => (await pending).native.close()));
      await this.#reads.close();
      if (outcomes.some(row => row.status === 'rejected')) throw failure('FEEDS_PUBLISHER_CLOSE', 'An original native publisher reported incomplete shutdown.');
      this.#publishers.clear();
    })(); return this.#close;
  }
}
