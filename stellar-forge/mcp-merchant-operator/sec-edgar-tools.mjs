// MIT. Complete merchant operations over F971's original retained SEC engine.
import { constants } from 'node:fs';
import { open, realpath, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { writeBytes } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import { EDGAR_TRANSFER_SCHEMA, EDGAR_TRANSFER_MANIFEST, EDGAR_MAX_FILE_BYTES,
  edgarTransferPaths, edgarTransferName, parseEdgarTransfer } from './sec-edgar-transfer.mjs';

export const EDGAR_CONNECTION_SCHEMA = 'stellar-forge.sec-edgar-workspace-connection.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const alias = { type: 'string', pattern: ALIAS.source };
const hash = { type: 'string', pattern: HASH.source };
const uuid = { type: 'string', pattern: UUID.source };
const edition = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' };
const revision = { type: 'integer', minimum: 0 };
const object = { type: 'object', additionalProperties: true };
const readonly = { readOnly: true, idempotent: true };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const stamp = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
const copy = value => structuredClone(value);
const count = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw failure('INVALID_PARAMS', label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  return value;
};
const pinnedHash = value => {
  if (typeof value !== 'string' || !HASH.test(value)) throw failure('INVALID_PARAMS', 'Supply the exact selected SHA256.');
  return value;
};
function originalId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_PARAMS', 'Use the returned original instance or operation UUID.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value) || resolve(base, value) === '/')
    throw failure('CONFIGURATION_ERROR', 'Declare the original application path in its private connection file.');
  return resolve(base, value);
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Use the canonical private directory.');
  await privateSupportDirectory(path);
  return path;
}
async function declaredDirectory(value, base) {
  const path = hostPath(value, base); let ancestor = path;
  for (;;) {
    try {
      if (await realpath(ancestor) !== ancestor) throw failure('CONFIGURATION_ERROR', 'Use canonical original workspace paths.');
      await privateSupportDirectory(ancestor);
      return path;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw failure('CONFIGURATION_ERROR', 'Choose an existing private workspace parent.');
      ancestor = parent;
    }
  }
}
async function regularBytes(path, maximum = EDGAR_MAX_FILE_BYTES, privateFile = true) {
  if (await realpath(path) !== resolve(path)) throw failure('EDGAR_FILE_CHANGED', 'The selected original file path changed.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) ||
        privateFile && process.platform !== 'win32' && (before.mode & 0o077n))
      throw failure('EDGAR_FILE_INVALID', 'Use a complete regular original file within its size limit.');
    const bytes = await file.readFile();
    if (bytes.length > maximum || stamp(before) !== stamp(await file.stat({ bigint: true })))
      throw failure('EDGAR_FILE_CHANGED', 'The selected original file changed during reading.');
    return bytes;
  } finally { await file.close(); }
}
async function exactBytes(path, bytes) {
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await regularBytes(path, Math.max(bytes.length, 1))).equals(bytes))
      throw failure('EDGAR_EXPORT_CONFLICT', 'This saved identifier already belongs to another complete output.');
  }
}
function named(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare up to 32 ' + label + '.');
  return Object.entries(value).map(([name, item]) => [identifier(name, label + ' alias'), item]);
}
function selectedRuntime(input = {}) {
  exact(input, ['port', 'operationsPort', 'facilitator', 'allowLocalFacilitator',
    'availabilityDirectory', 'historyDirectory', 'maxInFlight', 'drainGraceMs']);
  const runtime = { port: count(input.port ?? 0, 'Merchant port', 0, 65535),
    maxInFlight: count(input.maxInFlight ?? 64, 'Merchant concurrent requests', 1, 10000),
    drainGraceMs: count(input.drainGraceMs ?? 60000, 'Merchant drain time', 1, 300000) };
  if (input.operationsPort !== undefined) runtime.operationsPort = count(input.operationsPort, 'Operations port', 0, 65535);
  if (input.allowLocalFacilitator !== undefined && typeof input.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  runtime.allowLocalFacilitator = input.allowLocalFacilitator ?? false;
  if (input.facilitator !== undefined) {
    const url = new URL(input.facilitator);
    if (url.username || url.password || url.search || url.hash ||
        url.protocol !== 'https:' && !(runtime.allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
      throw failure('CONFIGURATION_ERROR', 'Use the original HTTPS facilitator or its explicitly configured loopback listener.');
    runtime.facilitator = url.href;
  }
  return runtime;
}

/** Host references are resolved before opening the original workspace or account. */
export async function readEdgarWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regularBytes(path, 1048576)));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== EDGAR_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original SEC EDGAR workspaces.');
  const native = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/config.mjs');
  const base = dirname(path), workspaces = Object.create(null), seen = new Set();
  for (const [name, entry] of Object.entries(raw.workspaces)) {
    identifier(name, 'SEC workspace alias');
    exact(entry, ['label', 'directory', 'storeDirectory', 'browserPort', 'captures',
      'acquisitions', 'merchantProfiles', 'packages', 'runtime'], ['directory']);
    const directory = await declaredDirectory(entry.directory, base);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original SEC workspace one alias.');
    seen.add(directory);
    const storeDirectory = await declaredDirectory(entry.storeDirectory ?? join(directory, 'captures'), base);
    const captures = Object.create(null), acquisitions = Object.create(null);
    const merchantProfiles = Object.create(null), packages = Object.create(null);
    for (const [key, selected] of named(entry.captures, 'retained captures')) {
      exact(selected, ['label', 'file', 'sha256', 'id', 'kind', 'cik', 'sourceUrl', 'capturedAt'],
        ['file', 'sha256', 'id', 'kind', 'cik']);
      const company = native.cik(selected.cik), origin = selected.sourceUrl ?? native.sourceUrl(selected.kind, company);
      native.editionId(selected.id); pinnedHash(selected.sha256);
      if (!['facts', 'filings'].includes(selected.kind)) throw failure('CONFIGURATION_ERROR', 'Choose original SEC facts or filings.');
      captures[key] = { ...copy(selected), label: line(selected.label ?? key),
        file: hostPath(selected.file, base), cik: company, sourceUrl: origin };
    }
    for (const [key, selected] of named(entry.acquisitions, 'source acquisition profiles')) {
      exact(selected, ['label', 'kind', 'cik', 'historyFile', 'quotaDirectory', 'userAgentEnv',
        'requestsPerSecond', 'callsPerDay', 'timeoutMs'], ['kind', 'cik', 'quotaDirectory']);
      const userAgentEnv = selected.userAgentEnv ?? 'SEC_EDGAR_USER_AGENT';
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(userAgentEnv)) throw failure('CONFIGURATION_ERROR', 'Use the host User-Agent environment reference.');
      native.sourceUrl(selected.kind, selected.cik);
      acquisitions[key] = { label: line(selected.label ?? key), kind: selected.kind, cik: native.cik(selected.cik),
        ...(selected.historyFile === undefined ? {} : { historyFile: selected.historyFile }),
        quotaDirectory: await declaredDirectory(selected.quotaDirectory, base), userAgentEnv,
        requestsPerSecond: count(selected.requestsPerSecond ?? 2, 'SEC requests per second', 1, 10),
        callsPerDay: count(selected.callsPerDay ?? 1000, 'SEC daily allowance', 1, 1000000),
        timeoutMs: count(selected.timeoutMs ?? 30000, 'SEC source timeout', 1000, 120000) };
    }
    for (const [key, selected] of named(entry.merchantProfiles, 'merchant profiles')) {
      exact(selected, ['label', 'config'], ['config']);
      merchantProfiles[key] = { label: line(selected.label ?? key), config: native.compileEdgarMerchant(selected.config).config };
    }
    for (const [key, selected] of named(entry.packages, 'original merchant packages')) {
      exact(selected, ['label', 'directory', 'manifestSha256'], ['directory', 'manifestSha256']);
      packages[key] = { label: line(selected.label ?? key), directory: await declaredDirectory(selected.directory, base),
        manifestSha256: pinnedHash(selected.manifestSha256) };
    }
    const runtime = selectedRuntime(entry.runtime);
    for (const field of ['availabilityDirectory', 'historyDirectory'])
      if (entry.runtime?.[field] !== undefined) runtime[field] = await declaredDirectory(entry.runtime[field], base);
    workspaces[name] = { label: line(entry.label ?? name), directory, storeDirectory,
      browserPort: count(entry.browserPort ?? 0, 'Browser port', 0, 65535), captures, acquisitions, merchantProfiles, packages, runtime };
  }
  return { workspaces };
}

export function edgarWorkspaceTools(tool) {
  const scoped = properties => ({ workspace: alias, ...properties });
  const chunk = { expectedSha256: hash, readId: uuid, offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } };
  const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
  const saved = { expectedRevision: revision };
  return [
    tool('merchant_edgar_status', 'List configured original SEC workspaces and retained input aliases, or page the open workspace state and process-owned merchant.', scoped(page), [], readonly),
    tool('merchant_edgar_open', 'Open the original retained SEC workspace and its local browser in one owned instance; reuse the same saved sources and revisions.', scoped({}), ['workspace'], { idempotent: true }),
    tool('merchant_edgar_close', 'Cancel active source acquisition, drain the original merchant and close this exact workspace/browser instance.', scoped({ instanceId: uuid }), ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_edgar_import', 'Import a host-declared original SEC capture with its pinned source digest, original edition identifier and capture time.', scoped({ capture: alias, expectedSha256: hash }), ['workspace', 'capture', 'expectedSha256'], { idempotent: true }),
    tool('merchant_edgar_acquire', 'Acquire a stable edition through the original SEC transport and configured shared supplier quota. Repeat the same edition to recover an already retained capture.', scoped({ profile: alias, editionId: edition, operationId: uuid }), ['workspace', 'profile', 'editionId', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_edgar_cancel', 'Cancel this workspace’s active original acquisition by the operation UUID shown in status.', scoped({ operationId: uuid }), ['workspace', 'operationId'], { idempotent: true }),
    tool('merchant_edgar_edition', 'Inspect a selected original source and page its actual concepts, filing forms or named history files. Concept search retains original taxonomy and unit metadata.', scoped({ editionId: edition, collection: { enum: ['concepts', 'forms', 'history'] }, search: { type: 'string', maxLength: 300 }, ...page }), ['workspace', 'editionId'], readonly),
    tool('merchant_edgar_save', 'Save the full original merchant config or a declared merchant profile with its native expected revision; exact source and payment compilation remain authoritative.', scoped({ ...saved, config: object, profile: alias }), ['workspace', 'expectedRevision']),
    tool('merchant_edgar_product', 'Add, replace or remove one product in the full native merchant draft. Upsert binds kind, company and source SHA directly from the selected original edition.', scoped({ ...saved, action: { enum: ['upsert', 'remove'] }, productId: { type: 'string', maxLength: 64 }, editionId: edition, product: object, title: { type: 'string', maxLength: 120 }, publicOrigin: { type: 'string', maxLength: 2048 } }), ['workspace', 'expectedRevision', 'action', 'productId']),
    tool('merchant_edgar_preview', 'Query the original saved product and exact source-bound continuation cursor; oversized complete results remain downloadable by their returned SHA.', scoped({ productId: { type: 'string', maxLength: 64 }, query: object, config: object, expectedRevision: revision }), ['workspace', 'productId'], readonly),
    tool('merchant_edgar_revisions', 'Inspect the original saved revision history, including native total and hasMore. An exact older revision can be restored directly.', scoped({ limit: { type: 'integer', minimum: 1, maximum: 200 } }), ['workspace'], readonly),
    tool('merchant_edgar_restore', 'Restore an original nonempty merchant revision into a new native revision while preserving the complete existing history.', scoped({ revision, expectedRevision: revision }), ['workspace', 'revision', 'expectedRevision']),
    tool('merchant_edgar_handoff', 'Export the original saved buyer handoff, OpenAPI or merchant configuration from a selected current revision.', scoped({ kind: { enum: ['handoff', 'config', 'openapi'] }, expectedRevision: revision }), ['workspace'], readonly),
    tool('merchant_edgar_export', 'Produce or recover a complete native merchant export: original configuration, generated buyer client, selected raw sources and source metadata. Retain a complete transport manifest for every file.', scoped({ exportId: alias, expectedRevision: revision }), ['workspace', 'exportId', 'expectedRevision'], { idempotent: true }),
    tool('merchant_edgar_exports', 'Page the retained complete merchant exports and any original output awaiting manifest completion.', scoped(page), ['workspace'], readonly),
    tool('merchant_edgar_export_manifest', 'Inspect the exact complete export manifest and page its file inventory; the manifest itself is downloadable in full.', scoped({ exportId: alias, ...page }), ['workspace', 'exportId'], readonly),
    tool('merchant_edgar_export_file', 'Read verified bytes from the complete export, including its original nested client and source files, with resumable retained-file snapshots.', scoped({ exportId: alias, file: { type: 'string', minLength: 1, maxLength: 180 }, expectedManifestSha256: hash, ...chunk }), ['workspace', 'exportId', 'file', 'expectedManifestSha256'], readonly),
    tool('merchant_edgar_export_file_release', 'Release this export’s retained read descriptor after the receiver has saved its bytes.', scoped({ exportId: alias, readId: uuid }), ['workspace', 'exportId', 'readId'], readonly),
    tool('merchant_edgar_source_file', 'Download the unchanged original JSON of a selected edition with its source SHA and resumable byte offset.', scoped({ editionId: edition, ...chunk }), ['workspace', 'editionId'], readonly),
    tool('merchant_edgar_result_file', 'Download a complete retained operator result, including a large preview, config or handoff, after reopen.', scoped({ resultId: hash, ...chunk }), ['workspace', 'resultId'], readonly),
    tool('merchant_edgar_file_release', 'Release an original source or complete-result read descriptor.', scoped({ readId: uuid }), ['workspace', 'readId'], readonly),
    tool('merchant_edgar_receive', 'Inspect or receive a host-declared complete original merchant export. Preserve original edition IDs, timestamps and bytes, then save through the native workspace revision check.', scoped({ package: alias, expectedManifestSha256: hash, action: { enum: ['inspect', 'receive'] }, expectedRevision: revision }), ['workspace', 'package', 'expectedManifestSha256', 'action'], { idempotent: true }),
    tool('merchant_edgar_merchant', 'Start, inspect or stop the original SF30/native Stellar merchant for a saved revision using only the host’s configured runtime and facilitator.', scoped({ action: { enum: ['start', 'status', 'stop'] }, expectedRevision: revision, instanceId: uuid }), ['workspace', 'action'], { openWorld: true }),
  ];
}

function pageRows(rows, offset = 0, limit = 50) {
  count(offset, 'Page offset'); count(limit, 'Page size', 1, 100);
  return { rows: rows.slice(offset, offset + limit), page: { offset, limit, total: rows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null } };
}
const mime = name => name.endsWith('.json') ? 'application/json' : name.endsWith('.md') ? 'text/markdown' :
  name.endsWith('.mjs') || name.endsWith('.mts') ? 'text/javascript' : 'application/octet-stream';

export class MerchantEdgarWorkspaces {
  #config; #handles = new Map(); #files = new RetainedFileReads({ errorPrefix: 'EDGAR' });
  #closing = false; #close; #calls = new Set();
  constructor(config) { this.#config = config; }
  get summary() { return { configured: Boolean(this.#config.edgarWorkspaces),
    workspaces: Object.keys(this.#config.edgarWorkspaces?.workspaces ?? {}).length,
    opened: this.#handles.size, ...this.#files.summary }; }
  #declared(name) {
    identifier(name, 'SEC workspace alias');
    const entry = this.#config.edgarWorkspaces?.workspaces?.[name];
    if (!entry) throw failure('EDGAR_WORKSPACE_NOT_CONFIGURED', 'Choose an original SEC workspace listed by merchant_edgar_status.');
    return entry;
  }
  async #paths(name) {
    this.#declared(name);
    const root = await privateDirectory(join(this.#config.exportsDirectory, 'sec-edgar', name));
    return { root, exports: await privateDirectory(join(root, 'exports')), results: await privateDirectory(join(root, 'results')) };
  }
  async #present(name, value, summary = {}) {
    const bytes = json(value);
    if (bytes.length <= 64000) return value;
    if (bytes.length > EDGAR_MAX_FILE_BYTES) throw failure('EDGAR_RESULT_TOO_LARGE', 'Page this original result before downloading it.');
    const id = digest(bytes), paths = await this.#paths(name);
    await exactBytes(join(paths.results, id + '.json'), bytes);
    return { workspace: name, ...summary, completeResult: { resultId: id, bytes: bytes.length, sha256: id,
      tool: 'merchant_edgar_result_file', contentType: 'application/json' } };
  }
  async #status(name, offset, limit) {
    if (name === undefined) return { schema: EDGAR_CONNECTION_SCHEMA, ...this.summary,
      workspaces: Object.entries(this.#config.edgarWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label, opened: this.#handles.has(workspace),
        captures: Object.entries(entry.captures).map(([capture, value]) => ({ capture, label: value.label, editionId: value.id, kind: value.kind, cik: value.cik, sha256: value.sha256 })),
        acquisitions: Object.entries(entry.acquisitions).map(([profile, value]) => ({ profile, label: value.label, kind: value.kind, cik: value.cik })),
        merchantProfiles: Object.entries(entry.merchantProfiles).map(([profile, value]) => ({ profile, label: value.label })),
        packages: Object.entries(entry.packages).map(([packageName, value]) => ({ package: packageName, label: value.label, manifestSha256: value.manifestSha256 })),
      })) };
    this.#declared(name);
    const opening = this.#handles.get(name);
    if (!opening) return { workspace: name, opened: false };
    const handle = await opening, state = await handle.native.snapshot(), paged = pageRows(state.editions, offset, limit);
    const value = { workspace: name, opened: true, instanceId: handle.instanceId, browserUrl: handle.browser.url,
      busy: handle.busy, closing: handle.closing, activeAcquisitions: [...handle.acquisitions.keys()],
      state: { ...state, editions: paged.rows }, editionsPage: paged.page,
      merchant: handle.merchant ? { instanceId: handle.merchant.instanceId, revision: handle.merchant.revision,
        ...(await handle.merchant.service.snapshot()) } : null, fileReads: this.#files.status(name) };
    return this.#present(name, value, { instanceId: handle.instanceId, revision: state.revision, editionsPage: paged.page });
  }
  async #open(name) {
    const entry = this.#declared(name);
    if (!this.#handles.has(name)) {
      const opening = (async () => {
        const [{ openEdgarWorkspace }, { startEdgarWorkspace }] = await Promise.all([
          import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/workspace.mjs'),
          import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/server.mjs'),
        ]);
        const native = await openEdgarWorkspace(entry.directory, { storeDirectory: entry.storeDirectory, title: entry.label });
        try {
          const browser = await startEdgarWorkspace({ workspace: native, port: entry.browserPort });
          return { entry, native, browser, instanceId: randomUUID(), acquisitions: new Map(), pending: new Set(),
            busy: false, closing: false, merchant: null, close: null };
        } catch (error) { await native.close(); throw error; }
      })();
      this.#handles.set(name, opening);
      try { await opening; } catch (error) { this.#handles.delete(name); throw error; }
    }
    return this.#status(name, 0, 50);
  }
  async #stop(name, handle) {
    if (!handle.close) {
      handle.closing = true;
      for (const controller of handle.acquisitions.values()) controller.abort();
      handle.close = (async () => {
        await Promise.allSettled([...handle.pending]);
        const outcomes = await Promise.allSettled([
          handle.merchant?.service.close(), handle.browser.close(), this.#files.closeScope(name),
        ]);
        try { await handle.native.close(); } finally { this.#handles.delete(name); }
        if (outcomes.some(value => value.status === 'rejected'))
          throw failure('EDGAR_CLOSE_FAILED', 'The original SEC merchant reported an incomplete shutdown.');
        return { workspace: name, instanceId: handle.instanceId, closed: true };
      })();
    }
    return handle.close;
  }
  async #saved(handle, expectedRevision) {
    const state = await handle.native.snapshot();
    if (expectedRevision !== undefined && state.revision !== count(expectedRevision, 'Saved revision'))
      throw Object.assign(failure('EDGAR_REVISION_CHANGED', 'Reload this original merchant revision before applying the operation.'),
        { currentRevision: state.revision });
    return state;
  }
  async #manifest(name, exportId) {
    identifier(exportId, 'Export ID');
    const directory = join((await this.#paths(name)).exports, exportId);
    const bytes = await regularBytes(join(directory, EDGAR_TRANSFER_MANIFEST), 65000);
    return { directory, bytes, manifest: parseEdgarTransfer(bytes, exportId), sha256: digest(bytes) };
  }
  async #manifestView(name, args) {
    const { bytes, manifest, sha256 } = await this.#manifest(name, args.exportId);
    const paged = pageRows(manifest.files, args.offset, args.limit), { files, ...binding } = manifest;
    return { workspace: name, exportId: args.exportId, state: 'MANIFEST_RETAINED', manifestSha256: sha256,
      manifestFile: { name: EDGAR_TRANSFER_MANIFEST, bytes: bytes.length, sha256, contentType: 'application/json' },
      binding, files: paged.rows, page: paged.page };
  }
  async #export(name, handle, args) {
    count(args.expectedRevision, 'Saved revision'); identifier(args.exportId, 'Export ID');
    const state = await this.#saved(handle, args.expectedRevision);
    if (!state.config) throw failure('EDGAR_DRAFT_REQUIRED', 'Save the original merchant before exporting it.');
    const [{ compileEdgarMerchant }, { exportEdgarMerchant }] = await Promise.all([
      import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/config.mjs'),
      import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/cli.mjs'),
    ]);
    const compiled = compileEdgarMerchant(state.config), directory = join((await this.#paths(name)).exports, args.exportId);
    const result = await exportEdgarMerchant(compiled, directory, { storeDirectory: handle.native.storeDirectory });
    const originalBytes = await regularBytes(join(directory, 'manifest.json'), 1048576);
    if (digest(originalBytes) !== result.manifestSha256) throw failure('EDGAR_EXPORT_CHANGED', 'The original export manifest changed.');
    const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes));
    const files = [];
    for (const path of edgarTransferPaths(original.editions)) {
      const bytes = await regularBytes(join(directory, path));
      const sha256 = digest(bytes), expected = original.files[path];
      if (expected && (bytes.length !== expected.bytes || sha256 !== expected.sha256))
        throw failure('EDGAR_EXPORT_CHANGED', 'An original generated export file changed.');
      files.push({ name: edgarTransferName(path), path, bytes: bytes.length, sha256 });
    }
    const manifest = { schema: EDGAR_TRANSFER_SCHEMA, exportId: args.exportId, workspaceId: state.workspaceId,
      revision: state.revision, configSha256: state.configSha256, inputSha256: compiled.inputSha256,
      nativeManifestSha256: result.manifestSha256,
      editions: original.editions.map(value => ({ id: value.id, kind: value.kind, cik: value.cik,
        sourceSha256: value.sourceSha256, sourceBytes: value.sourceBytes })), files };
    const bytes = json(manifest); parseEdgarTransfer(bytes, args.exportId);
    await exactBytes(join(directory, EDGAR_TRANSFER_MANIFEST), bytes);
    return this.#manifestView(name, { exportId: args.exportId });
  }
  async #exportFile(name, args) {
    const selected = await this.#manifest(name, args.exportId);
    if (pinnedHash(args.expectedManifestSha256) !== selected.sha256)
      throw failure('EDGAR_EXPORT_CHANGED', 'Choose the exact retained transfer manifest.');
    const file = args.file === EDGAR_TRANSFER_MANIFEST ?
      { name: EDGAR_TRANSFER_MANIFEST, path: EDGAR_TRANSFER_MANIFEST, bytes: selected.bytes.length, sha256: selected.sha256 } :
      selected.manifest.files.find(value => value.name === args.file);
    if (!file) throw failure('EDGAR_EXPORT_FILE_NOT_FOUND', 'Select a file listed in this original export manifest.');
    if (args.expectedSha256 !== undefined && pinnedHash(args.expectedSha256) !== file.sha256)
      throw failure('EDGAR_FILE_CHANGED', 'The selected file differs from its original manifest digest.');
    const read = await this.#files.read({ scope: name, key: JSON.stringify(['export', args.exportId, file.name]),
      kind: 'edgar-export', directory: this.#config.exportsDirectory, readId: args.readId, offset: args.offset, limit: args.limit,
      expectedSha256: file.sha256, load: async () => {
        const bytes = await regularBytes(join(selected.directory, file.path));
        if (bytes.length !== file.bytes) throw failure('EDGAR_FILE_CHANGED', 'The original export file length changed.');
        return { bytes, name: file.name, type: mime(file.path) };
      } });
    return { workspace: name, exportId: args.exportId, manifestSha256: selected.sha256, ...read };
  }
  async #receive(name, handle, args) {
    const selected = handle.entry.packages[identifier(args.package, 'Original package alias')];
    if (!selected || pinnedHash(args.expectedManifestSha256) !== selected.manifestSha256)
      throw failure('EDGAR_PACKAGE_NOT_CONFIGURED', 'Choose the declared original merchant package and its manifest SHA256.');
    if (!['inspect', 'receive'].includes(args.action)) throw failure('INVALID_PARAMS', 'Choose inspect or receive.');
    if (args.action === 'receive') count(args.expectedRevision, 'Saved revision');
    const originalBytes = await regularBytes(join(selected.directory, 'manifest.json'), 1048576);
    if (digest(originalBytes) !== selected.manifestSha256)
      throw failure('EDGAR_PACKAGE_CHANGED', 'The original merchant package manifest changed.');
    const original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes));
    const [{ readEdgarMerchant, merchantReview }, { openEdgarStore }] = await Promise.all([
      import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/config.mjs'),
      import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/source.mjs'),
    ]);
    const compiled = await readEdgarMerchant(join(selected.directory, 'merchant.json'));
    if (original.schema !== 'stellar-forge.sec-edgar-merchant-export.v1' ||
        original.inputSha256 !== compiled.inputSha256 || original.sourceStore !== 'source-store' ||
        !Array.isArray(original.editions))
      throw failure('EDGAR_PACKAGE_CHANGED', 'The original package does not match its merchant configuration.');
    const sourceDirectory = join(selected.directory, 'source-store');
    if (await realpath(sourceDirectory) !== sourceDirectory) throw failure('EDGAR_PACKAGE_CHANGED', 'Use the original retained source-store.');
    await privateSupportDirectory(sourceDirectory);
    const source = await openEdgarStore(sourceDirectory), records = new Map();
    try {
      for (const product of compiled.products) {
        await source.query(product.editionId, product, product.example);
        records.set(product.editionId, (await source.getEdition(product.editionId)).record);
      }
      if (records.size !== original.editions.length || original.editions.some(row => {
        const record = records.get(row.id);
        return !record || ['kind', 'cik', 'sourceSha256', 'sourceBytes', 'capturedAt', 'sourceUrl'].some(key => row[key] !== record[key]);
      })) throw failure('EDGAR_PACKAGE_CHANGED', 'The source editions differ from the original package manifest.');
      for (const [path, expected] of Object.entries(original.files ?? {})) {
        edgarTransferName(path);
        const bytes = await regularBytes(join(selected.directory, path));
        if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
          throw failure('EDGAR_PACKAGE_CHANGED', 'An original package file differs from its manifest.');
      }
      const sourceEditions = [...records.values()].map(record => ({ id: record.id, kind: record.kind, cik: record.cik,
        sourceSha256: record.sourceSha256, recordCount: record.recordCount, capturedAt: record.capturedAt }));
      if (args.action === 'inspect') return this.#present(name, { workspace: name, package: args.package,
        manifestSha256: selected.manifestSha256, inputSha256: compiled.inputSha256,
        review: merchantReview(compiled), sourceEditions }, { package: args.package, sourceEditions });
      const state = await handle.native.snapshot(), incomingSha = digest(JSON.stringify(compiled.config));
      if (state.revision !== args.expectedRevision) {
        if (state.revision === args.expectedRevision + 1 && state.configSha256 === incomingSha) {
          // The original final save completed before a prior client disconnected.
          await handle.native.exportConfig();
          return { workspace: name, package: args.package, manifestSha256: selected.manifestSha256,
            workspaceId: state.workspaceId, revision: state.revision, configSha256: state.configSha256,
            sourceEditions, recovered: true };
        }
        throw Object.assign(failure('EDGAR_REVISION_CHANGED', 'Reload the receiving workspace before saving this package.'),
          { currentRevision: state.revision });
      }
      for (const record of records.values()) await handle.native.importCapture({ id: record.id, kind: record.kind,
        cik: record.cik, sourceUrl: record.sourceUrl, capturedAt: record.capturedAt, bytes: await source.readRaw(record.id) });
      const saved = await handle.native.saveDraft({ expectedRevision: args.expectedRevision, config: compiled.config });
      return { workspace: name, package: args.package, manifestSha256: selected.manifestSha256,
        workspaceId: saved.workspaceId, revision: saved.revision, configSha256: saved.configSha256,
        sourceEditions, recovered: saved.unchanged };
    } finally { await source.close(); }
  }
  async #resultFile(name, args) {
    const id = pinnedHash(args.resultId), paths = await this.#paths(name);
    if (args.expectedSha256 !== undefined && pinnedHash(args.expectedSha256) !== id)
      throw failure('EDGAR_FILE_CHANGED', 'Choose the original complete result digest.');
    return this.#files.read({ scope: name, key: JSON.stringify(['result', id]), kind: 'edgar-result',
      directory: this.#config.exportsDirectory, expectedSha256: id, readId: args.readId, offset: args.offset, limit: args.limit,
      load: async () => ({ bytes: await regularBytes(join(paths.results, id + '.json')),
        name: 'edgar-result-' + id + '.json', type: 'application/json' }) });
  }
  async #execute(name, handle, args) {
    const native = handle.native, entry = handle.entry;
    switch (name) {
      case 'merchant_edgar_import': {
        const selected = entry.captures[identifier(args.capture, 'Capture alias')];
        if (!selected || pinnedHash(args.expectedSha256) !== selected.sha256)
          throw failure('EDGAR_CAPTURE_NOT_CONFIGURED', 'Select the declared original capture and SHA256.');
        const bytes = await regularBytes(selected.file, EDGAR_MAX_FILE_BYTES, false);
        if (digest(bytes) !== selected.sha256) throw failure('EDGAR_SOURCE_CHANGED', 'The original captured source changed.');
        const { label, file, sha256, ...metadata } = selected;
        return this.#present(args.workspace, { workspace: args.workspace, ...await native.importCapture({ ...metadata, bytes }) });
      }
      case 'merchant_edgar_acquire': {
        const selected = entry.acquisitions[identifier(args.profile, 'Source profile')];
        if (!selected) throw failure('EDGAR_ACQUISITION_NOT_CONFIGURED', 'Select the declared original SEC acquisition profile.');
        const operationId = originalId(args.operationId), controller = new AbortController();
        handle.acquisitions.set(operationId, controller);
        try {
          const { acquireEdgarCapture } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/source.mjs');
          // Close/cancel must reach this operation before the first asynchronous
          // module load; a cancelled selection must not launch an upstream request.
          if (handle.closing) controller.abort();
          controller.signal.throwIfAborted();
          const { label, userAgentEnv, ...profile } = selected;
          const result = await acquireEdgarCapture({ ...profile, store: native.source, id: args.editionId,
            userAgent: process.env[userAgentEnv], signal: controller.signal });
          return this.#present(args.workspace, { workspace: args.workspace, operationId, ...result });
        } finally { handle.acquisitions.delete(operationId); }
      }
      case 'merchant_edgar_edition': {
        const selected = await native.getEdition(args.editionId), collection = args.collection ??
          (selected.record.kind === 'facts' ? 'concepts' : 'forms');
        const source = { concepts: selected.concepts, forms: selected.forms, history: selected.record.historyFiles }[collection];
        if (!Array.isArray(source)) throw failure('INVALID_PARAMS', 'Choose concepts, forms or history.');
        if (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 300))
          throw failure('INVALID_PARAMS', 'Use a concept or filing search of up to 300 characters.');
        const search = (args.search ?? '').toLocaleLowerCase('en-US');
        const filtered = search ? source.filter(value => JSON.stringify(value).toLocaleLowerCase('en-US').includes(search)) : source;
        const { historyFiles, ...record } = selected.record;
        return { workspace: args.workspace, record, collection, ...pageRows(filtered, args.offset, args.limit),
          totals: { concepts: selected.concepts.length, forms: selected.forms.length, history: historyFiles.length } };
      }
      case 'merchant_edgar_save': {
        count(args.expectedRevision, 'Saved revision');
        if ((args.config !== undefined) === (args.profile !== undefined))
          throw failure('INVALID_PARAMS', 'Supply one complete config or one declared merchant profile.');
        const config = args.profile === undefined ? args.config :
          entry.merchantProfiles[identifier(args.profile, 'Merchant profile')]?.config;
        if (!config) throw failure('EDGAR_PROFILE_NOT_CONFIGURED', 'Choose an original configured merchant profile.');
        return this.#present(args.workspace, { workspace: args.workspace,
          ...await native.saveDraft({ expectedRevision: args.expectedRevision, config: copy(config) }) });
      }
      case 'merchant_edgar_product': {
        count(args.expectedRevision, 'Saved revision');
        const state = await this.#saved(handle, args.expectedRevision);
        if (typeof args.productId !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(args.productId))
          throw failure('INVALID_PARAMS', 'Use the original merchant product identifier.');
        if (!state.config && (!args.title || !args.publicOrigin))
          throw failure('INVALID_PARAMS', 'Set the merchant title and public HTTPS origin for its first product.');
        const config = copy(state.config ?? { schema: 'stellar-forge.sec-edgar-merchant.v1',
          title: args.title, publicOrigin: args.publicOrigin, products: [] });
        if (args.title !== undefined) config.title = args.title;
        if (args.publicOrigin !== undefined) config.publicOrigin = args.publicOrigin;
        const index = config.products.findIndex(value => value.id === args.productId);
        if (args.action === 'remove') {
          if (index < 0) throw failure('EDGAR_PRODUCT_NOT_FOUND', 'Choose a saved merchant product.');
          config.products.splice(index, 1);
        } else if (args.action === 'upsert') {
          exact(args.product, ['path', 'description', 'concepts', 'forms', 'maxPageSize', 'paymentOptions', 'example'],
            ['path', 'description', 'paymentOptions']);
          const { record } = await native.getEdition(args.editionId);
          const product = { ...copy(args.product), id: args.productId, editionId: record.id,
            kind: record.kind, cik: record.cik, sourceSha256: record.sourceSha256 };
          if (index < 0) config.products.push(product); else config.products[index] = product;
        } else throw failure('INVALID_PARAMS', 'Choose upsert or remove.');
        return this.#present(args.workspace, { workspace: args.workspace,
          ...await native.saveDraft({ expectedRevision: args.expectedRevision, config }) });
      }
      case 'merchant_edgar_preview': {
        const state = await this.#saved(handle, args.expectedRevision);
        const result = await native.preview({ productId: args.productId, query: args.query ?? {},
          ...(args.config === undefined ? {} : { config: args.config }) });
        return this.#present(args.workspace, { workspace: args.workspace, revision: state.revision,
          productId: args.productId, ...result }, { revision: state.revision, productId: args.productId,
          source: result.source, totalMatched: result.body?.totalMatched, totalReturned: result.body?.totalReturned,
          nextCursor: result.body?.nextCursor });
      }
      case 'merchant_edgar_revisions': return { workspace: args.workspace, ...await native.listRevisions({ limit: args.limit ?? 50 }) };
      case 'merchant_edgar_restore':
        return this.#present(args.workspace, { workspace: args.workspace, ...await native.restoreRevision(args) });
      case 'merchant_edgar_handoff': {
        const state = await this.#saved(handle, args.expectedRevision), kind = args.kind ?? 'handoff';
        const read = { config: () => native.exportConfig(), openapi: () => native.exportOpenApi(), handoff: () => native.buyerHandoff() }[kind];
        if (!read) throw failure('INVALID_PARAMS', 'Choose handoff, config or openapi.');
        return this.#present(args.workspace, { workspace: args.workspace, revision: state.revision, kind, value: await read() },
          { revision: state.revision, kind });
      }
      case 'merchant_edgar_export': return this.#export(args.workspace, handle, args);
      case 'merchant_edgar_receive': return this.#receive(args.workspace, handle, args);
      case 'merchant_edgar_source_file': {
        const { record } = await native.getEdition(args.editionId);
        if (args.expectedSha256 !== undefined && pinnedHash(args.expectedSha256) !== record.sourceSha256)
          throw failure('EDGAR_SOURCE_CHANGED', 'The selected source differs from this edition.');
        return this.#files.read({ scope: args.workspace, key: JSON.stringify(['source', record.id]),
          kind: 'edgar-source', directory: this.#config.exportsDirectory, expectedSha256: record.sourceSha256,
          readId: args.readId, offset: args.offset, limit: args.limit, load: async () => ({
            bytes: await native.readRaw(record.id), name: 'edgar-source-' + record.id + '.json', type: 'application/json',
          }) });
      }
      case 'merchant_edgar_merchant': {
        if (args.action === 'status') return { workspace: args.workspace, merchant: handle.merchant ?
          { instanceId: handle.merchant.instanceId, revision: handle.merchant.revision,
            ...(await handle.merchant.service.snapshot()) } : null };
        if (args.action === 'stop') {
          if (!handle.merchant || originalId(args.instanceId) !== handle.merchant.instanceId)
            throw failure('INSTANCE_CONFLICT', 'Use this original process-owned merchant instance from status.');
          const instanceId = handle.merchant.instanceId, result = await handle.merchant.service.close();
          handle.merchant = null;
          return { workspace: args.workspace, instanceId, stopped: true, result };
        }
        if (args.action !== 'start') throw failure('INVALID_PARAMS', 'Choose start, status or stop.');
        count(args.expectedRevision, 'Saved revision');
        const state = await this.#saved(handle, args.expectedRevision);
        if (handle.merchant) {
          if (handle.merchant.revision !== state.revision)
            throw failure('EDGAR_MERCHANT_ACTIVE', 'Stop the original running instance before starting another saved revision.');
          return { workspace: args.workspace, instanceId: handle.merchant.instanceId, revision: state.revision,
            ...(await handle.merchant.service.snapshot()), recovered: true };
        }
        if (!state.config) throw failure('EDGAR_DRAFT_REQUIRED', 'Save the original merchant first.');
        const [{ compileEdgarMerchant }, { startEdgarMerchant, edgarNativeFactory }] = await Promise.all([
          import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/config.mjs'),
          import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/sec-edgar/merchant.mjs'),
        ]);
        const { facilitator, allowLocalFacilitator, ...runtime } = entry.runtime;
        const nativeFactory = await edgarNativeFactory(facilitator, { allowLocalFacilitator });
        const service = await startEdgarMerchant(compileEdgarMerchant(state.config),
          { ...runtime, storeDirectory: native.storeDirectory, nativeFactory });
        handle.merchant = { instanceId: randomUUID(), revision: state.revision, service };
        return { workspace: args.workspace, instanceId: handle.merchant.instanceId, revision: state.revision,
          ...(await service.snapshot()), recovered: false };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown original SEC workspace operation.');
    }
  }
  async #dispatch(name, args) {
    if (name === 'merchant_edgar_status') return this.#status(args.workspace, args.offset ?? 0, args.limit ?? 50);
    if (name === 'merchant_edgar_open') return this.#open(args.workspace);
    this.#declared(args.workspace);
    // Completed exports and results survive closing or restarting the workspace.
    if (name === 'merchant_edgar_export_manifest') return this.#manifestView(args.workspace, args);
    if (name === 'merchant_edgar_export_file') return this.#exportFile(args.workspace, args);
    if (name === 'merchant_edgar_result_file') return this.#resultFile(args.workspace, args);
    if (name === 'merchant_edgar_exports') {
      const paths = await this.#paths(args.workspace), rows = [];
      const ids = (await readdir(paths.exports)).filter(value => ALIAS.test(value)).sort();
      for (const exportId of ids) {
        try {
          const { manifest, sha256 } = await this.#manifest(args.workspace, exportId);
          rows.push({ exportId, state: 'MANIFEST_RETAINED', workspaceId: manifest.workspaceId, revision: manifest.revision,
            manifestSha256: sha256, files: manifest.files.length, bytes: manifest.files.reduce((sum, value) => sum + value.bytes, 0) });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          rows.push({ exportId, state: 'EXPORT_INCOMPLETE' });
        }
      }
      return { workspace: args.workspace, ...pageRows(rows, args.offset, args.limit) };
    }
    if (['merchant_edgar_file_release', 'merchant_edgar_export_file_release'].includes(name)) {
      if (name === 'merchant_edgar_export_file_release') identifier(args.exportId, 'Export ID');
      await this.#files.release(args.workspace, originalId(args.readId));
      return { workspace: args.workspace, readId: args.readId, released: true };
    }
    const opening = this.#handles.get(args.workspace);
    if (!opening) throw failure('EDGAR_WORKSPACE_CLOSED', 'Open the original workspace with merchant_edgar_open.');
    const handle = await opening;
    if (name === 'merchant_edgar_cancel') {
      const operationId = originalId(args.operationId), controller = handle.acquisitions.get(operationId);
      controller?.abort();
      return { workspace: args.workspace, operationId, cancellationRequested: Boolean(controller) };
    }
    if (name === 'merchant_edgar_close') {
      if (originalId(args.instanceId) !== handle.instanceId)
        throw failure('INSTANCE_CONFLICT', 'Use the original workspace instance returned by merchant_edgar_open.');
      return this.#stop(args.workspace, handle);
    }
    if (handle.closing) throw failure('EDGAR_WORKSPACE_CLOSING', 'The original SEC workspace is closing.');
    const mutate = ['merchant_edgar_import', 'merchant_edgar_acquire', 'merchant_edgar_save', 'merchant_edgar_product',
      'merchant_edgar_restore', 'merchant_edgar_export'].includes(name) ||
      name === 'merchant_edgar_receive' && args.action === 'receive' ||
      name === 'merchant_edgar_merchant' && args.action !== 'status';
    if (mutate && handle.busy) throw failure('EDGAR_WORKSPACE_BUSY', 'Another operation is updating this original workspace; status and cancellation remain available.');
    if (mutate) handle.busy = true;
    const pending = this.#execute(name, handle, args); handle.pending.add(pending);
    try { return await pending; } finally { handle.pending.delete(pending); if (mutate) handle.busy = false; }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('OPERATOR_CLOSING', 'The SEC merchant operator is closing.');
    const definition = edgarWorkspaceTools((name, description, properties, required, annotations) =>
      ({ name, properties, required, annotations })).find(value => value.name === name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown SEC merchant operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    const pending = this.#dispatch(name, args); this.#calls.add(pending);
    try { return await pending; }
    catch (error) {
      if (['ENOENT', 'EACCES', 'ENOSPC', 'EIO', 'ENOTDIR', 'ELOOP'].includes(error.code))
        throw failure('EDGAR_HOST_' + error.code, 'The configured original SEC file or storage could not complete this operation.');
      throw error;
    } finally { this.#calls.delete(pending); }
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        const outcomes = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => this.#stop(name, await pending)));
        await Promise.allSettled([...this.#calls]); await this.#files.close();
        if (outcomes.some(value => value.status === 'rejected'))
          throw failure('EDGAR_CLOSE_FAILED', 'An original SEC workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
