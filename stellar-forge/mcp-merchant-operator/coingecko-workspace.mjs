// MIT. CoinGecko research, native purchases and complete handovers on the original browser model.
import { realpath, lstat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { readBytes, privateDirectory, parse } from '../../stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { LIMITS, jsonBytes, base64, safeName } from '../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/common.mjs';

export const COINGECKO_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.coingecko-workspace-connection.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', pattern: ID.source };
const uuid = { type: 'string', pattern: UUID.source };
const digest = { type: 'string', pattern: SHA256.source };
const label = { type: 'string', minLength: 1, maxLength: 240 };
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const version = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const object = { type: 'object' };
const ids = maximum => ({ type: 'array', items: id, minItems: 1, maxItems: maximum, uniqueItems: true });
const selected = { workspace: alias };
const inProject = { ...selected, projectId: id };
const write = { ...inProject, opId: id, revision };
const page = { offset: revision, limit: { type: 'integer', minimum: 1, maximum: LIMITS.pageSize },
  q: { type: 'string', maxLength: 2000 } };
const read = { readOnly: true, idempotent: true };
const change = { idempotent: true };
const recordKinds = ['request', 'collection', 'capture', 'snapshot', 'comparison', 'note', 'provider-plan', 'job', 'export'];
const rowsKinds = ['capture', 'snapshot', 'comparison'];
const fileKinds = ['source', 'collection', 'snapshot', 'comparison', 'provider-plan', 'handover'];
const kindTable = { request: 'requests', collection: 'collections', capture: 'captures',
  snapshot: 'snapshots', comparison: 'comparisons', note: 'notes', 'provider-plan': 'providerPlans',
  job: 'jobs', export: 'exports', handover: 'exports' };

export function coingeckoWorkspaceTools(tool) {
  return [
    tool('merchant_coingecko_workspaces', 'List host-declared private CoinGecko workspaces, owned browser instances and configured input/profile aliases. Opens no workspace or provider connection.', {}, [], read),
    tool('merchant_coingecko_open', 'Open the original CoinGecko browser and research model once. Agent and browser share the same project revisions, source bytes and native jobs. Reopening this owned alias returns the same live instance. Native interrupted purchases remain interrupted.', selected, ['workspace'], change),
    tool('merchant_coingecko_close', 'Drain the exact owned browser/model and native workers, release retained file reads and the original workspace lease. Retained projects and original purchase IDs survive reopening.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_coingecko_status', 'Inspect the current original projects, endpoint contracts, public buyer-profile metadata, runtime and retained download sessions.', selected, ['workspace'], read),
    tool('merchant_coingecko_project', 'Read the original project, current revision, complete collection counts, recent events and native job status.', inProject, ['workspace', 'projectId'], read),
    tool('merchant_coingecko_project_create', 'Create a retained original research project. Supply one stable opId; inspect that same operation after a lost response.', { ...selected, opId: id, name: label }, ['workspace', 'opId', 'name'], change),
    tool('merchant_coingecko_configure', 'Save the project merchant origin, path prefix and host-declared buyer-profile ID against the current project revision. Credentials remain in the original host configuration.', { ...write, config: object }, ['workspace', 'projectId', 'opId', 'revision', 'config'], change),
    tool('merchant_coingecko_records', 'Page the original requests, collections, source files, captures, jobs, snapshots, comparisons, notes, provider plans, handovers or events. Continue until offset plus returned item count reaches total.', { ...inProject, kind: { type: 'string', enum: ['requests', 'collections', 'files', 'captures', 'jobs', 'snapshots', 'comparisons', 'notes', 'providerPlans', 'exports', 'events'] }, ...page }, ['workspace', 'projectId', 'kind'], read),
    tool('merchant_coingecko_inspect', 'Inspect one original project-owned record, including request versions, complete capture/source identities, collection definitions or native purchase review. Large original source and report bytes remain available through file_read.', { ...inProject, kind: { type: 'string', enum: recordKinds }, id }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_rows', 'Page every retained capture, snapshot or comparison row using the original native analysis and exact decimal values. Optional status applies to the native row filter.', { ...inProject, kind: { type: 'string', enum: rowsKinds }, id, ...page, status: { type: 'string', maxLength: 80 }, rowKind: { type: 'string', maxLength: 80 } }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_row', 'Inspect one original capture row and all linked provider entities retained with it. Preserves exact decimal values and original relationship IDs.', { ...inProject, captureId: id, rowId: id }, ['workspace', 'projectId', 'captureId', 'rowId'], read),
    tool('merchant_coingecko_operation', 'Recover the original saved write response by its stable opId and project scope. Omit projectId for project creation or handover restoration. This is a native operation-table read and never repeats a purchase or import.', { ...selected, projectId: id, opId: id }, ['workspace', 'opId'], read),
    tool('merchant_coingecko_request_save', 'Create or update an original endpoint request. Use the contract from status, preserving native path/query values. Updates require requestId and its current version as well as project revision.', { ...write, request: object, requestId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'request'], change),
    tool('merchant_coingecko_collection_save', 'Create or update a saved collection with its complete ordered requestIds. Updates require collectionId and its current version. Requests must belong to this project.', { ...write, collection: object, collectionId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'collection'], change),
    tool('merchant_coingecko_collection_import', 'Import a complete original CoinGecko collection package from a retained source file, preserving its original request definitions and references.', { ...write, fileId: id, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'fileId'], change),
    tool('merchant_coingecko_sources', 'List the host-declared original input aliases and their source or handover purpose. Filesystem paths and buyer credentials are not tool arguments.', selected, ['workspace'], read),
    tool('merchant_coingecko_source_inspect', 'Read a declared original input and return its exact SHA256, byte length, filename and content type before import or restore. Retains no copy and makes no network request.', { ...selected, input: alias }, ['workspace', 'input'], read),
    tool('merchant_coingecko_source_import', 'Retain exact original source bytes through the native uploader. Select a host input alias for full sources up to 15,000,000 bytes, or supply filename plus canonical contentBase64 for up to 65,536 inline bytes. Pin expectedSha256. The original opId recovers a lost response.', { ...write, input: alias, filename: label, contentType: { type: 'string', minLength: 1, maxLength: 200 }, contentBase64: { type: 'string', maxLength: 87384 }, expectedSha256: digest }, ['workspace', 'projectId', 'opId', 'revision', 'expectedSha256'], change),
    tool('merchant_coingecko_response_import', 'Associate retained original response bytes, headers and observation metadata with their saved request. Preserves exact source bytes and native data provenance. A retained response-body file must belong to the same project.', { ...write, requestId: id, fileId: id, headersFileId: id, responseBodyFileId: id, httpStatus: { type: 'integer', minimum: 100, maximum: 599 }, sourceUrl: { type: 'string', minLength: 1, maxLength: 8192 }, observedAt: { type: 'string', minLength: 1, maxLength: 80 }, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'requestId', 'fileId'], change),
    tool('merchant_coingecko_provider_example', 'Retain the example already present in the selected original provider challenge. Its native provider_bazaar_example basis remains explicit in captures, snapshots and handovers.', { ...write, captureId: id, name: label }, ['workspace', 'projectId', 'opId', 'revision', 'captureId'], change),
    tool('merchant_coingecko_probe', 'Create the original asynchronous unsigned GET observation job for exact saved requests and vendor or merchant target. Returns the original job ID; inspect it until terminal. Reuse the opId after an uncertain response.', { ...write, name: label, requestIds: ids(256), target: { type: 'string', enum: ['vendor', 'merchant'] } }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'requestIds', 'target'], { idempotent: true, openWorld: true }),
    tool('merchant_coingecko_snapshot_create', 'Retain one complete native snapshot from selected response captures, with original source bases, exact values and full denominator counts. Select at most one capture per request.', { ...write, name: label, captureIds: ids(1000), collectionId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'captureIds'], change),
    tool('merchant_coingecko_comparison_create', 'Compare two different original project snapshots through the native exact-decimal market comparison engine. Keeps added, removed and changed rows and complete baseline/current source identities.', { ...write, name: label, baselineId: id, currentId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name', 'baselineId', 'currentId'], change),
    tool('merchant_coingecko_note_save', 'Create or update a research, data-quality or follow-up note attached to its original request, capture, row, snapshot or comparison. Preserves source files, assignee, status and original record versions.', { ...write, note: object, noteId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'note'], change),
    tool('merchant_coingecko_provider_plan_preview', 'Compile a provider plan through the original CoinGecko product compiler, returning all selected endpoint routes, native payment alternatives and source configuration. Makes no payment or provider request.', { ...selected, plan: object }, ['workspace', 'plan'], read),
    tool('merchant_coingecko_provider_plan_save', 'Retain the original compiled provider deployment plan. Updates require planId and its current version. Download its complete native deployment document through file_read.', { ...write, plan: object, planId: id, version }, ['workspace', 'projectId', 'opId', 'revision', 'plan'], change),
    tool('merchant_coingecko_checkout_prepare', 'Prepare the original SF88 buyer inbox review for selected current merchant challenges in one collection. Each selection includes requestId, captureId and acceptIndex. Uses host-configured buyer identity and original SF31/SF36 budgets; preparation does not execute payment. Inspect the returned original job before explicit execute.', { ...write, collectionId: id, version, name: label, buyerProfileId: id, selections: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'object', additionalProperties: false, required: ['requestId', 'captureId', 'acceptIndex'], properties: { requestId: id, captureId: id, acceptIndex: { type: 'integer', minimum: 0, maximum: 1000 } } } } }, ['workspace', 'projectId', 'opId', 'revision', 'collectionId', 'version', 'name', 'selections'], change),
    tool('merchant_coingecko_job_control', 'Apply the explicitly selected native execute, cancel, resume or recover action to the original job ID and current job version/project revision. Execute may make the reviewed payment. Recovery reads the original attempt and saved response; it never creates a replacement attempt. Only native canExecute/canCancel/canResume/canRecover determine availability.', { ...write, jobId: id, version, action: { type: 'string', enum: ['execute', 'cancel', 'resume', 'recover'] } }, ['workspace', 'projectId', 'opId', 'revision', 'jobId', 'version', 'action'], { idempotent: true, destructive: true, openWorld: true }),
    tool('merchant_coingecko_handover_create', 'Save a complete native portable project archive, including original files, histories, rows, operations evidence and runnable source closure. Selected snapshot/comparison IDs remain attached. Download the original retained archive in chunks.', { ...write, name: label, snapshotId: id, comparisonId: id }, ['workspace', 'projectId', 'opId', 'revision', 'name'], change),
    tool('merchant_coingecko_restore', 'Restore a complete original handover as a new project using either a host-declared handover input, or sourceWorkspace plus its retained exportId. Pin the original expectedSha256 and reuse opId after a lost reply. Native ID mappings, source bytes and histories are retained; historical purchase jobs remain archived.', { ...selected, opId: id, name: label, input: alias, sourceWorkspace: alias, exportId: id, expectedSha256: digest }, ['workspace', 'opId', 'name', 'expectedSha256'], change),
    tool('merchant_coingecko_file_read', 'Read complete retained source bytes, collection JSON, snapshot/comparison report, provider deployment or portable handover. First read returns file SHA256, size and readId. Continue with the same selection, expectedSha256, readId and nextOffset. After expiry/reopen omit readId while keeping the exact SHA256 and offset.', { ...inProject, kind: { type: 'string', enum: fileKinds }, id, expectedSha256: digest, readId: uuid, offset: revision, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['workspace', 'projectId', 'kind', 'id'], read),
    tool('merchant_coingecko_file_release', 'Release this owned original download session when the caller stops reading before its last chunk. The retained project source remains available.', { ...selected, readId: uuid }, ['workspace', 'readId'], read),
  ];
}
const definitions = new Map(coingeckoWorkspaceTools((name, _description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));

function check(value, schema, name) {
  if (schema.type === 'string' && (typeof value !== 'string' ||
      schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength ||
      schema.pattern && !new RegExp(schema.pattern).test(value)))
    throw failure('INVALID_PARAMS', 'Supply the declared ' + name + '.');
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) ||
      value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)))
    throw failure('INVALID_PARAMS', 'Supply the declared integer ' + name + '.');
  if (schema.enum && !schema.enum.includes(value)) throw failure('INVALID_PARAMS', 'Choose a declared ' + name + '.');
  if (schema.type === 'object') {
    if (!plain(value)) throw failure('INVALID_PARAMS', name + ' must be an object.');
    if (schema.additionalProperties === false) exact(value, Object.keys(schema.properties), schema.required);
    if (schema.properties) for (const [key, item] of Object.entries(value))
      if (schema.properties[key]) check(item, schema.properties[key], name + '.' + key);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Number.MAX_SAFE_INTEGER) ||
        schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length)
      throw failure('INVALID_PARAMS', 'Supply the complete declared ' + name + ' selection.');
    if (schema.items) value.forEach(item => check(item, schema.items, name));
  }
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty original host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
async function privateFilePath(value, base, maximum) {
  const path = hostPath(value, base), info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size > maximum || info.mode & 0o077 ||
      typeof process.getuid === 'function' && info.uid !== process.getuid() || await realpath(path) !== path)
    throw failure('CONFIGURATION_ERROR', 'Declare an original private regular file owned by this host user.');
  return path;
}
export async function readCoinGeckoWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await readBytes(path, { privateFile: true, max: 1024 * 1024 }), 'CoinGecko workspace connection');
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== COINGECKO_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original CoinGecko workspaces.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  for (const [key, input] of Object.entries(raw.workspaces)) {
    identifier(key, 'CoinGecko workspace alias');
    exact(input, ['label', 'directory', 'actor', 'buyerProfiles', 'inputs', 'allowLocal'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateDirectory(directory);
    if (await realpath(directory) !== directory || directories.has(directory))
      throw failure('CONFIGURATION_ERROR', 'Bind each canonical private CoinGecko directory through one alias.');
    directories.add(directory);
    if (input.allowLocal !== undefined && typeof input.allowLocal !== 'boolean')
      throw failure('CONFIGURATION_ERROR', 'Declare allowLocal as an explicit host boolean.');
    const buyerProfiles = [], profileIds = new Set();
    if (input.buyerProfiles !== undefined && (!Array.isArray(input.buyerProfiles) || input.buyerProfiles.length > 32))
      throw failure('CONFIGURATION_ERROR', 'Declare at most 32 original native buyer profiles.');
    for (const profile of input.buyerProfiles ?? []) {
      exact(profile, ['id', 'name', 'network', 'configPath', 'workspacePath'], ['id']);
      check(profile.id, id, 'buyer-profile ID');
      if (profileIds.has(profile.id) || profile.configPath === undefined && profile.workspacePath === undefined)
        throw failure('CONFIGURATION_ERROR', 'Give each original configured buyer profile one unique ID.');
      profileIds.add(profile.id);
      const entry = { id: profile.id, name: line(profile.name ?? profile.id, 'Buyer profile label') };
      if (profile.network !== undefined) entry.network = line(profile.network, 'Original payment network');
      if (profile.configPath !== undefined) entry.configPath = await privateFilePath(profile.configPath, base, 2 * 1024 * 1024);
      if (profile.workspacePath !== undefined) {
        entry.workspacePath = hostPath(profile.workspacePath, base);
        await privateDirectory(entry.workspacePath);
        if (await realpath(entry.workspacePath) !== entry.workspacePath)
          throw failure('CONFIGURATION_ERROR', 'Select the original canonical native buyer workspace.');
      }
      buyerProfiles.push(entry);
    }
    if (input.inputs !== undefined && (!plain(input.inputs) || Object.keys(input.inputs).length > 128))
      throw failure('CONFIGURATION_ERROR', 'Declare at most 128 original input aliases.');
    const inputs = Object.create(null);
    for (const [source, definition] of Object.entries(input.inputs ?? {})) {
      identifier(source, 'Original input alias');
      exact(definition, ['path', 'label', 'contentType', 'kind'], ['path']);
      const kind = definition.kind ?? 'source';
      if (!['source', 'handover'].includes(kind)) throw failure('CONFIGURATION_ERROR', 'Choose source or handover for an input.');
      inputs[source] = { path: await privateFilePath(definition.path, base, kind === 'handover' ? LIMITS.restoreBytes : LIMITS.uploadBytes),
        label: line(definition.label ?? source, 'Input label'),
        contentType: line(definition.contentType ?? (kind === 'handover' ? 'application/gzip' : 'application/octet-stream'), 'Input content type'),
        kind };
    }
    workspaces[key] = { directory, label: line(input.label ?? key, 'CoinGecko workspace label'),
      actor: input.actor === undefined ? null : line(input.actor, 'Original MCP operator name'),
      allowLocal: input.allowLocal === true, buyerProfiles, inputs };
  }
  return { schema: COINGECKO_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}
function safeError(issue) {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code ?? '') ? issue.code : 'COINGECKO_WORKSPACE_OPERATION_FAILED';
  const error = failure(code, 'Original CoinGecko operation: ' + code + '. Read the current project, record or saved operation before continuing.');
  if (Number.isSafeInteger(issue?.currentRevision)) error.message += ' Current project revision: ' + issue.currentRevision + '.';
  if (Number.isInteger(issue?.status)) error.status = issue.status;
  return error;
}

export class MerchantCoinGeckoWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'COINGECKO_FILE' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.coingeckoWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.coingeckoWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null, browserUrl: entry?.service.url ?? null,
          localMerchantOriginsAllowed: definition.allowLocal,
          buyerProfiles: definition.buyerProfiles.map(({ id, name, network }) => ({ id, name, ...(network === undefined ? {} : { network }) })),
          inputs: Object.entries(definition.inputs).map(([input, source]) => ({ input, label: source.label, kind: source.kind })) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'CoinGecko workspace alias');
    const definition = this.#config.coingeckoWorkspaces?.workspaces[alias];
    if (!definition) throw failure('COINGECKO_WORKSPACE_NOT_CONFIGURED', 'Choose an alias from merchant_coingecko_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('COINGECKO_WORKSPACE_NOT_OPEN', 'Open this original CoinGecko workspace first.');
    if (entry.closing) throw failure('COINGECKO_WORKSPACE_CLOSING', 'This owned original workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'coingecko:' + alias + ':' + this.#definition(alias).directory; }
  #state(entry) {
    return { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.url,
      native: entry.model.state(), fileReads: this.#reads.status(this.#scope(entry.alias)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      if (Number(process.versions.node.split('.')[0]) < 24)
        throw failure('COINGECKO_NODE_REQUIRED', 'Open the CoinGecko native SQLite workspace with Node.js 24 or later.');
      const { startMarketWorkspace } = await import('../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/workspace/server.mjs');
      let service;
      try {
        service = await startMarketWorkspace({ directory: definition.directory, buyerProfiles: definition.buyerProfiles, allowLocal: definition.allowLocal, port: 0 });
        if (this.#closing) throw failure('COINGECKO_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, service, model: service.model, instanceId: randomUUID(), pending: new Set(), closing: null };
        this.#entries.set(alias, entry);
        try { return this.#state(entry); } catch (issue) { this.#entries.delete(alias); throw issue; }
      } catch (issue) { await service?.close().catch(() => {}); throw issue; }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      await Promise.allSettled([...entry.pending]);
      try { await this.#reads.closeScope(this.#scope(entry.alias)); }
      finally {
        await entry.service.close();
        if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
      }
      return { workspace: entry.alias, instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  #body(entry, input, keys) {
    const value = { actor: this.#definition(entry.alias).actor ?? this.#config.name, opId: input.opId };
    if (input.revision !== undefined) value.revision = input.revision;
    for (const key of keys) if (input[key] !== undefined) value[key] = input[key];
    return value;
  }
  #owned(entry, kind, recordId, projectId) {
    entry.model.store.project(projectId);
    if (kind === 'source') {
      const file = entry.model.store.fileInfo(recordId);
      if (file.projectId !== projectId) throw failure('WRONG_PROJECT', 'Select a source file in this project.');
      return file;
    }
    return entry.model.store.owned(kindTable[kind], recordId, projectId);
  }
  #updateVersion(input, key) {
    if (input[key] === undefined ? input.version !== undefined : input.version === undefined)
      throw failure('INVALID_PARAMS', 'An update requires the original ' + key + ' and its current version; creation omits both.');
  }
  async #input(alias, name) {
    identifier(name, 'Original input alias');
    const source = this.#definition(alias).inputs[name];
    if (!source) throw failure('COINGECKO_INPUT_NOT_CONFIGURED', 'Choose an original declared input alias.');
    if (await realpath(source.path) !== source.path) throw failure('COINGECKO_INPUT_CHANGED', 'The declared original input path changed.');
    const bytes = await readBytes(source.path, { privateFile: true, max: source.kind === 'handover' ? LIMITS.restoreBytes : LIMITS.uploadBytes });
    return { bytes, name: basename(source.path), type: source.contentType, kind: source.kind, label: source.label, sha256: hash(bytes) };
  }
  async #sourceImport(entry, input) {
    let source;
    if (input.input !== undefined) {
      if (input.contentBase64 !== undefined || input.filename !== undefined || input.contentType !== undefined)
        throw failure('INVALID_PARAMS', 'Choose the original input alias or inline source fields.');
      source = await this.#input(entry.alias, input.input);
      if (source.kind !== 'source') throw failure('INVALID_PARAMS', 'Use a declared source input; complete handovers use restore.');
    } else {
      if (input.contentBase64 === undefined || input.filename === undefined)
        throw failure('INVALID_PARAMS', 'Inline source import requires filename and canonical contentBase64.');
      source = { bytes: base64(input.contentBase64, 65536), name: input.filename, type: input.contentType ?? 'application/octet-stream' };
      source.sha256 = hash(source.bytes);
    }
    if (source.sha256 !== input.expectedSha256) throw failure('COINGECKO_INPUT_HASH_CHANGED', 'Read the original input before importing changed bytes.');
    return entry.model.upload(input.projectId, { ...this.#body(entry, input, []),
      filename: source.name, contentType: source.type, contentBase64: source.bytes.toString('base64') });
  }
  async #restore(entry, input) {
    let bytes;
    if (input.input !== undefined) {
      if (input.sourceWorkspace !== undefined || input.exportId !== undefined)
        throw failure('INVALID_PARAMS', 'Choose a declared handover input or an original retained export.');
      const source = await this.#input(entry.alias, input.input);
      if (source.kind !== 'handover') throw failure('INVALID_PARAMS', 'Select a host-declared handover input.');
      bytes = source.bytes;
    } else {
      if (input.sourceWorkspace === undefined || input.exportId === undefined)
        throw failure('INVALID_PARAMS', 'Select both sourceWorkspace and its original exportId.');
      bytes = this.#entry(input.sourceWorkspace).model.exportBytes(input.exportId).bytes;
    }
    if (hash(bytes) !== input.expectedSha256) throw failure('COINGECKO_INPUT_HASH_CHANGED', 'The original handover does not match expectedSha256.');
    return entry.model.restore({ ...this.#body(entry, input, ['name']), contentBase64: bytes.toString('base64') });
  }
  async #file(entry, input) {
    const selected = this.#owned(entry, input.kind, input.id, input.projectId);
    const load = () => {
      const model = entry.model, name = safeName(selected.name ?? input.kind + '-' + input.id);
      switch (input.kind) {
        case 'source': return { bytes: model.store.fileBytes(input.id), name: selected.name, type: selected.contentType };
        case 'collection': return { bytes: model.collectionBytes(input.id), name: name + '.json', type: 'application/json' };
        case 'snapshot': return { bytes: jsonBytes(model.snapshotDocument(input.id)), name: name + '.json', type: 'application/json' };
        case 'comparison': return { bytes: jsonBytes(model.comparisonDocument(input.id)), name: name + '.json', type: 'application/json' };
        case 'provider-plan': return { bytes: jsonBytes(model.providerDocument(input.id)), name: name + '.json', type: 'application/json' };
        case 'handover': return { bytes: model.exportBytes(input.id).bytes, name: name + '.json.gz', type: 'application/gzip' };
      }
    };
    const result = await this.#reads.read({ scope: this.#scope(entry.alias),
      key: JSON.stringify([input.projectId, input.kind, input.id]), kind: 'coingecko-' + input.kind,
      directory: this.#definition(entry.alias).directory, load, expectedSha256: input.expectedSha256,
      readId: input.readId, offset: input.offset, limit: input.limit });
    return { workspace: entry.alias, projectId: input.projectId, kind: input.kind, id: input.id, ...result };
  }
  async #execute(entry, name, args) {
    const { workspace, ...input } = args, model = entry.model, result = native => ({ workspace, native });
    const body = keys => this.#body(entry, input, keys);
    const jobResult = response => result({ ...response, value: model.jobView(response.value) });
    switch (name) {
      case 'merchant_coingecko_status': return this.#state(entry);
      case 'merchant_coingecko_project': return result(model.project(input.projectId));
      case 'merchant_coingecko_project_create': return result(model.createProject(body(['name'])));
      case 'merchant_coingecko_configure': return result(model.saveConfig(input.projectId, body(['config'])));
      case 'merchant_coingecko_records': return result(model.list(input.projectId, input.kind, input));
      case 'merchant_coingecko_operation': return result(model.operation(input.projectId ?? null, input.opId));
      case 'merchant_coingecko_inspect': {
        this.#owned(entry, input.kind, input.id, input.projectId);
        const method = { 'provider-plan': 'providerPlan', export: null }[input.kind] ?? input.kind;
        if (input.kind === 'export') return result({ export: model.store.get('exports', input.id) });
        return result(model[method](input.id));
      }
      case 'merchant_coingecko_rows':
        this.#owned(entry, input.kind, input.id, input.projectId);
        return result(model[input.kind + 'Rows'](input.id, { offset: input.offset, limit: input.limit, q: input.q, status: input.status, kind: input.rowKind }));
      case 'merchant_coingecko_row':
        this.#owned(entry, 'capture', input.captureId, input.projectId);
        return result(model.captureRow(input.captureId, input.rowId));
      case 'merchant_coingecko_request_save':
        this.#updateVersion(input, 'requestId');
        return result(model.saveRequest(input.projectId, body(['request', 'version']), input.requestId));
      case 'merchant_coingecko_collection_save':
        this.#updateVersion(input, 'collectionId');
        return result(model.saveCollection(input.projectId, body(['collection', 'version']), input.collectionId));
      case 'merchant_coingecko_collection_import':
        return result(model.importCollection(input.projectId, body(['fileId', 'name'])));
      case 'merchant_coingecko_sources':
        return result({ inputs: Object.entries(this.#definition(workspace).inputs).map(([input, source]) =>
          ({ input, label: source.label, kind: source.kind, contentType: source.contentType })) });
      case 'merchant_coingecko_source_inspect': {
        const { bytes, ...metadata } = await this.#input(workspace, input.input);
        return result({ input: input.input, ...metadata, bytes: bytes.length });
      }
      case 'merchant_coingecko_source_import': return result(await this.#sourceImport(entry, input));
      case 'merchant_coingecko_response_import':
        for (const key of ['fileId', 'headersFileId', 'responseBodyFileId'])
          if (input[key] !== undefined) this.#owned(entry, 'source', input[key], input.projectId);
        return result(model.importResponse(input.projectId, body(['requestId', 'fileId', 'headersFileId', 'responseBodyFileId', 'httpStatus', 'sourceUrl', 'observedAt', 'name'])));
      case 'merchant_coingecko_provider_example': return result(model.sample(input.projectId, body(['captureId', 'name'])));
      case 'merchant_coingecko_probe': return jobResult(await model.createProbe(input.projectId, body(['name', 'requestIds', 'target'])));
      case 'merchant_coingecko_snapshot_create': return result(model.createSnapshot(input.projectId, body(['name', 'captureIds', 'collectionId'])));
      case 'merchant_coingecko_comparison_create': return result(model.createComparison(input.projectId, body(['name', 'baselineId', 'currentId'])));
      case 'merchant_coingecko_note_save':
        this.#updateVersion(input, 'noteId');
        return result(model.saveNote(input.projectId, body(['note', 'version']), input.noteId));
      case 'merchant_coingecko_provider_plan_preview': {
        const { prepareCoinGeckoProduct } = await import('../../stellar/scf-starforge-20261009/partners/coingecko-stellar-market/provider.mjs');
        return result(await prepareCoinGeckoProduct(input.plan));
      }
      case 'merchant_coingecko_provider_plan_save':
        this.#updateVersion(input, 'planId');
        return result(await model.saveProviderPlan(input.projectId, body(['plan', 'version']), input.planId));
      case 'merchant_coingecko_checkout_prepare':
        this.#owned(entry, 'collection', input.collectionId, input.projectId);
        return jobResult(await model.createCheckout(input.collectionId, body(['name', 'version', 'buyerProfileId', 'selections'])));
      case 'merchant_coingecko_job_control':
        this.#owned(entry, 'job', input.jobId, input.projectId);
        return jobResult(await model.controlJob(input.jobId, input.action, body(['version'])));
      case 'merchant_coingecko_handover_create': return result(model.exportProject(input.projectId, body(['name', 'snapshotId', 'comparisonId'])));
      case 'merchant_coingecko_restore': return result(await this.#restore(entry, input));
      case 'merchant_coingecko_file_read': return this.#file(entry, input);
      case 'merchant_coingecko_file_release':
        await this.#reads.release(this.#scope(workspace), input.readId);
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown CoinGecko merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('COINGECKO_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown CoinGecko merchant operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) check(value, definition.properties[key], key);
    try {
      if (name === 'merchant_coingecko_workspaces') return this.summary;
      if (name === 'merchant_coingecko_open') return await this.#open(args.workspace);
      if (name === 'merchant_coingecko_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== args.instanceId)
          throw failure('COINGECKO_INSTANCE_CONFLICT', 'Close only the original current instance owned by this MCP process.');
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
        const outcomes = await Promise.allSettled([...this.#entries.values()].map(entry => this.#closeEntry(entry)));
        await this.#reads.close();
        if (outcomes.some(value => value.status === 'rejected'))
          throw failure('COINGECKO_SHUTDOWN_INCOMPLETE', 'An original owned CoinGecko workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
