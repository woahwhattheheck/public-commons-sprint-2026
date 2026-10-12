// MIT. Agent operation of the original GraphQL workspace, compiler and release console.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { MerchantGraphqlFiles, graphqlFileTools } from './graphql-workspace-files.mjs';

export const GRAPHQL_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.graphql-workspace-connection.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const aliasSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const projectSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };
const uuidSchema = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const shaSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revisionSchema = { type: 'integer', minimum: 1 };
const generationSchema = { type: 'integer', minimum: 0 };
const rangeSchema = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
  expectedSnapshotSha256: shaSchema };
const operationSchema = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' };
const common = { workspace: aliasSchema, project: projectSchema };
const current = { ...common, expectedRevision: revisionSchema };
const deployment = { ...current, deploymentId: uuidSchema };
const textSchema = { type: 'string', minLength: 1, maxLength: 240 };
const MAX_REPLY = 24 * 1024 * 1024;
const sourcePath = '../../stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/workspace/';

function originalProject(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
    throw failure('INVALID_PARAMS', 'Select an original GraphQL project ID.');
  return value;
}
function originalUuid(value) {
  if (typeof value !== 'string' || !new RegExp(uuidSchema.pattern).test(value))
    throw failure('INVALID_PARAMS', 'Retain a version-4 UUID for the original operation.');
  return value;
}
function revision(value, zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1))
    throw failure('INVALID_PARAMS', 'Supply the exact saved project revision.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw failure('INVALID_PARAMS', 'Supply the exact inspected SHA-256.');
  return value;
}
function parse(text, label) {
  try { const value = JSON.parse(text); if (plain(value)) return value; } catch {}
  throw failure('GRAPHQL_JSON_INVALID', label + ' must be a JSON object.');
}
function page(rows, args) {
  const offset = args.offset ?? 0, limit = args.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw failure('INVALID_PARAMS', 'Use a nonnegative offset and a limit from 1 to 50.');
  const snapshotSha256 = hash(json(rows));
  if (args.expectedSnapshotSha256 !== undefined && digest(args.expectedSnapshotSha256) !== snapshotSha256)
    throw failure('GRAPHQL_PAGE_CHANGED', 'The selected list changed. Reopen its first page.');
  return { total: rows.length, offset, snapshotSha256, nextOffset: offset + limit < rows.length ? offset + limit : null,
    items: rows.slice(offset, offset + limit) };
}
function endpoint(input) {
  exact(input, ['schema', 'origin', 'path', 'authorizationEnv', 'timeoutMs', 'maxResponseBytes'], ['schema', 'origin', 'path']);
  let url;
  try { url = new URL(input.origin); } catch {}
  if (input.schema !== 'stellar-forge.subquery-schema-endpoint.v1' || !url || !['http:', 'https:'].includes(url.protocol)
      || url.origin !== input.origin || url.username || url.password || typeof input.path !== 'string'
      || !input.path.startsWith('/') || input.path.length > 2048 || input.path.includes('\\')
      || new URL(input.path, input.origin).origin !== input.origin)
    throw failure('CONFIGURATION_ERROR', 'Declare the original fixed GraphQL schema endpoint.');
  if (input.authorizationEnv !== undefined && (typeof input.authorizationEnv !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(input.authorizationEnv)))
    throw failure('CONFIGURATION_ERROR', 'GraphQL credentials use an original named server environment reference.');
  for (const key of ['timeoutMs', 'maxResponseBytes']) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < 1))
    throw failure('CONFIGURATION_ERROR', 'Use positive original endpoint limits.');
  return structuredClone(input);
}
function runtime(input = {}) {
  exact(input, ['port', 'facilitator', 'allowLocalFacilitator']);
  const value = { port: input.port ?? 0 };
  if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
    throw failure('CONFIGURATION_ERROR', 'The host selects the release listener port.');
  if (input.facilitator !== undefined) {
    let url; try { url = new URL(input.facilitator); } catch {}
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw failure('CONFIGURATION_ERROR', 'Use the original facilitator URL without credentials, query or fragment.');
    value.facilitator = url.href.replace(/\/$/, '');
  }
  if (input.allowLocalFacilitator !== undefined && typeof input.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator is a host boolean.');
  if (input.allowLocalFacilitator === true) value.allowLocalFacilitator = true;
  return value;
}
async function privateJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 * 1024 || process.platform !== 'win32' && (info.mode & 0o077))
      throw failure('CONFIGURATION_ERROR', 'Use a private regular connection JSON within 1 MiB.');
    const bytes = await file.readFile();
    if (bytes.length > 1024 * 1024) throw failure('CONFIGURATION_ERROR', 'The connection grew beyond 1 MiB.');
    return parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'Connection');
  } finally { await file.close(); }
}
export async function readGraphqlWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await privateJson(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== GRAPHQL_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces)
      || !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 16)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–16 original GraphQL workspace directories.');
  const workspaces = Object.create(null), seen = new Set();
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    identifier(alias, 'GraphQL workspace alias');
    exact(input, ['label', 'directory', 'sources', 'runtime', 'hosts'], ['directory', 'sources']);
    if (typeof input.directory !== 'string' || !input.directory || input.directory.includes('\0'))
      throw failure('CONFIGURATION_ERROR', 'Workspace directories are host configuration values.');
    const directory = await realpath(resolve(dirname(path), input.directory));
    await privateSupportDirectory(directory);
    if (seen.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give an original GraphQL directory one alias.');
    seen.add(directory);
    if (!plain(input.sources) || !Object.keys(input.sources).length || Object.keys(input.sources).length > 32)
      throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original GraphQL source aliases per workspace.');
    const sources = Object.create(null);
    for (const [name, source] of Object.entries(input.sources)) {
      identifier(name, 'GraphQL source alias');
      exact(source, ['label', 'endpoint', 'allowLoopback'], ['endpoint']);
      if (source.allowLoopback !== undefined && typeof source.allowLoopback !== 'boolean')
        throw failure('CONFIGURATION_ERROR', 'allowLoopback is a host boolean.');
      sources[name] = { label: line(source.label ?? name, 'Source label'), endpoint: endpoint(source.endpoint),
        allowLoopback: source.allowLoopback === true };
    }
    const hosts = Object.create(null);
    if (input.hosts !== undefined && (!plain(input.hosts) || Object.keys(input.hosts).length > 16))
      throw failure('CONFIGURATION_ERROR', 'Declare at most 16 original host-plan aliases.');
    for (const [name, plan] of Object.entries(input.hosts ?? {})) {
      identifier(name, 'Host alias');
      if (!plain(plan) || Buffer.byteLength(json(plan)) > 131072
          || ['kind', 'config', 'handlers', 'upstreams'].some(key => Object.hasOwn(plan, key)))
        throw failure('CONFIGURATION_ERROR', 'Declare an original GraphQL host plan; selected merchant files supply its handlers.');
      hosts[name] = structuredClone(plan);
    }
    workspaces[alias] = { directory, label: line(input.label ?? alias, 'Workspace label'),
      sources, runtime: runtime(input.runtime), hosts };
  }
  return { workspaces };
}

export function graphqlWorkspaceTools(tool) {
  const read = { readOnly: true, idempotent: true };
  return [
    tool('merchant_graphql_status', 'List host-declared original GraphQL workspaces/source aliases or inspect one open workspace and its native runtime. Browser URLs are private operator capabilities.',
      { workspace: aliasSchema }, [], read),
    tool('merchant_graphql_open', 'Open the original GraphQL workspace server and its single kernel-owned writer. Browser and MCP share that same project, preview and release state.',
      { workspace: aliasSchema }, ['workspace'], { idempotent: true }),
    tool('merchant_graphql_close', 'Cancel and drain this owned workspace connection, previews and native release consoles; preserve every saved project/result and original file.',
      { workspace: aliasSchema, instanceId: uuidSchema }, ['workspace', 'instanceId'], { idempotent: true }),
    tool('merchant_graphql_projects', 'Page original saved projects. Repeat expectedSnapshotSha256 when paging a changing list.',
      { workspace: aliasSchema, ...rangeSchema }, ['workspace'], read),
    tool('merchant_graphql_project', 'Inspect an exact saved project revision, optional full raw draft, or a page of its original merchant exports/deployments/previews. Raw unfinished drafts remain available.',
      { ...common, revision: revisionSchema, includeInput: { type: 'boolean' },
        collection: { enum: ['exports', 'deployments', 'previews'] }, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_history', 'Read the original most-recent 100-revision history window with its native more flag. Open any older retained revision explicitly with merchant_graphql_project.',
      { ...common, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_schema', 'Page actual captured/supplied schema roots, types, or a selected type’s fields and enum values from an immutable saved revision. The original GraphQL reference compiler validates the source.',
      { ...common, revision: revisionSchema, collection: { enum: ['roots', 'types'] }, type: operationSchema, ...rangeSchema },
      ['workspace', 'project', 'revision'], read),
    tool('merchant_graphql_capture', 'Make one deliberate original introspection request to a host-declared source. Optionally save that exact schema into the selected project at its expected revision; includeSchema controls the full text in the reply. Existing queries, plan and title remain intact.',
      { workspace: aliasSchema, source: aliasSchema, project: projectSchema, expectedRevision: revisionSchema,
        includeSchema: { type: 'boolean' } }, ['workspace', 'source'], { openWorld: true }),
    tool('merchant_graphql_operation', 'Open an existing fixed query as the original field/argument/bounded-variable model, or compile a proposed model without saving. Use merchant_graphql_schema for paged field discovery.',
      { ...common, revision: revisionSchema, operation: operationSchema, model: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'revision', 'operation'], read),
    tool('merchant_graphql_apply_operation', 'Compile one original field selection, then atomically save its query and matching plan route name/samples at the expected revision. Keeps price, payment and public-path fields; an invalid raw plan stays intact for repair.',
      { ...current, operation: operationSchema, model: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'expectedRevision', 'operation', 'model']),
    tool('merchant_graphql_save', 'Save raw draft field changes through the original immutable revision/CAS store. For a new project use expectedRevision 0 and all four fields; unfinished raw query/plan text is preserved.',
      { ...common, expectedRevision: generationSchema, input: { type: 'object', properties: {
        title: { type: 'string', maxLength: 160 }, schemaText: { type: 'string', maxLength: 1048576 },
        queriesText: { type: 'string', maxLength: 1048576 }, planText: { type: 'string', maxLength: 262144 } }, additionalProperties: false } },
      ['workspace', 'project', 'expectedRevision', 'input']),
    tool('merchant_graphql_review', 'Validate a saved schema/query/merchant plan with the original compiler and inspect its actual routes, variables and payment terms. No source request or seller start.',
      { ...common, revision: revisionSchema }, ['workspace', 'project', 'revision'], read),
    tool('merchant_graphql_preview_start', 'Start one original read-only GraphQL operation against the saved project with a retained preview UUID. Returns immediately; status/result/recover use that same native record, and a started unknown request is never resent automatically.',
      { ...current, source: aliasSchema, previewId: uuidSchema, operation: operationSchema,
        variables: { type: 'object', additionalProperties: true } },
      ['workspace', 'project', 'expectedRevision', 'source', 'previewId', 'operation', 'variables'], { idempotent: true, openWorld: true }),
    tool('merchant_graphql_preview_status', 'Inspect or page original completed/started preview records, their request/response identities and attachment state. Does not repeat a source request.',
      { ...common, previewId: uuidSchema, ...rangeSchema }, ['workspace', 'project'], read),
    tool('merchant_graphql_preview_cancel', 'Request cancellation only of this process-owned preview transport. The original handler retains any returned or cancelled outcome; inspect its same native record afterward.',
      { ...common, previewId: uuidSchema }, ['workspace', 'project', 'previewId'], { idempotent: true }),
    tool('merchant_graphql_preview_recover', 'Attach an already completed native preview to the current project without another provider request. Its original source revision/digest remain explicit even after later draft edits.',
      { ...current, previewId: uuidSchema }, ['workspace', 'project', 'expectedRevision', 'previewId'], { idempotent: true }),
    tool('merchant_graphql_preview_result', 'Page a selected JSON pointer in the actual retained response, preserving the exact response hash. Download original response bytes with the retained-file tools; this structured view never reruns the query.',
      { ...common, previewId: uuidSchema, pointer: { type: 'string', maxLength: 2048 }, ...rangeSchema },
      ['workspace', 'project', 'previewId'], read),
    tool('merchant_graphql_prepare', 'Prepare the original complete merchant and generated buyer package from the current reviewed saved project. On a lost reply inspect project/history before another preparation.',
      { ...current, source: aliasSchema }, ['workspace', 'project', 'expectedRevision', 'source']),
    tool('merchant_graphql_evolution', 'Compare a saved candidate with its retained baseline merchant or read an already prepared original revision report. Comparison returns the exact digest required by prepare_revision.',
      { ...current, baselineExportId: uuidSchema, reportExportId: uuidSchema },
      ['workspace', 'project', 'expectedRevision'], read),
    tool('merchant_graphql_prepare_revision', 'Prepare the original revised merchant, exact baseline copy and buyer handoff using the current saved draft and inspected comparison digest.',
      { ...current, source: aliasSchema, baselineExportId: uuidSchema, comparisonDigest: shaSchema },
      ['workspace', 'project', 'expectedRevision', 'source', 'baselineExportId', 'comparisonDigest']),
    tool('merchant_graphql_deployment', 'Prepare or continue the original deployment: prepare a merchant export, stage a native release with host runtime settings, generate a host-declared installation packet, or recover its finished attachment.',
      { ...current, action: { enum: ['prepare', 'stage', 'host', 'recover'] }, source: aliasSchema,
        exportId: uuidSchema, deploymentId: uuidSchema, releaseId: aliasSchema, label: textSchema, host: aliasSchema },
      ['workspace', 'project', 'expectedRevision', 'action']),
    tool('merchant_graphql_deployment_status', 'Inspect the original deployment generation, source identity, staged release, host readiness and any finished unattached continuation.',
      { ...common, deploymentId: uuidSchema }, ['workspace', 'project', 'deploymentId'], read),
    tool('merchant_graphql_release_status', 'Inspect the original project release console or compare two retained native releases. Browser handover uses that same console and seller owner.',
      { ...deployment, to: aliasSchema, from: aliasSchema }, ['workspace', 'project', 'expectedRevision', 'deploymentId'], read),
    tool('merchant_graphql_release_change', 'Activate, roll back, start, stop or restart through the original release console. Changes bind the inspected immutable digest/current generation; stop/restart require that console’s exact instance ID.',
      { ...deployment, action: { enum: ['activate', 'rollback', 'start', 'stop', 'restart'] },
        releaseId: aliasSchema, expectedDigest: shaSchema, expectedGeneration: generationSchema,
        reason: textSchema, instanceId: { type: 'string', minLength: 1, maxLength: 64 } },
      ['workspace', 'project', 'expectedRevision', 'deploymentId', 'action']),
    ...graphqlFileTools(tool),
  ];
}

function exportView(row) {
  return { id: row.id, createdAt: row.createdAt, draftRevision: row.draftRevision, inputDigest: row.inputDigest,
    files: row.files?.length ?? 0, unavailable: Boolean(row.unavailable), error: row.error,
    ...(row.evolution ? { evolution: { baselineExportId: row.evolution.baselineExportId,
      comparisonDigest: row.evolution.comparisonDigest, files: row.evolution.files?.length ?? 0 } } : {}) };
}
function deploymentView(row) {
  return { id: row.id, exportId: row.exportId, generation: row.generation, createdAt: row.createdAt,
    updatedAt: row.updatedAt, draftRevision: row.draftRevision, inputDigest: row.inputDigest,
    files: row.files?.length ?? 0, release: row.release ? { id: row.release.id, digest: row.release.digest } : null,
    suggestedReleaseId: row.suggestedReleaseId, unavailable: Boolean(row.unavailable), error: row.error,
    hosts: (row.hosts ?? []).map(host => ({ id: host.id, createdAt: host.createdAt, files: host.files?.length ?? 0,
      identity: host.identity ? { merchant: host.identity.merchant, mode: host.identity.mode, publicOrigin: host.identity.publicOrigin,
        services: host.identity.services } : null, readiness: host.readiness, unavailable: Boolean(host.unavailable) })) };
}
function previewView(row) {
  return Object.fromEntries(['id', 'project', 'draftRevision', 'inputDigest', 'operation', 'createdAt', 'completedAt',
    'source', 'requestSha256', 'responseSha256', 'responseBytes', 'responseType', 'status', 'state', 'retained', 'current', 'error']
    .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}
function projectView(value, args = {}) {
  const result = { id: value.id, title: value.input.title, revision: value.revision, currentRevision: value.currentRevision,
    createdAt: value.createdAt, updatedAt: value.updatedAt, inputDigest: value.inputDigest,
    counts: { exports: value.exports.length, deployments: value.deployments?.length ?? 0, previews: value.previews?.length ?? 0 } };
  if (args.includeInput === true) result.input = value.input;
  if (args.collection) {
    const mapping = { exports: exportView, deployments: deploymentView, previews: previewView }[args.collection];
    if (!mapping) throw failure('INVALID_PARAMS', 'Choose an original project collection.');
    result.collection = args.collection; result.records = page((value[args.collection] ?? []).map(mapping), args);
  }
  return result;
}
function releaseView(value) {
  if (Array.isArray(value)) return value.map(releaseView);
  if (!plain(value)) return value;
  const excluded = new Set(['root', 'directory', 'releaseStore', 'sourceRoot', 'handlerEntry', 'handlers', 'configuration',
    'recordPath', 'planFile', 'runtimeDirectory', 'pidFile']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)).map(([key, item]) => [key, releaseView(item)]));
}

export class MerchantGraphqlWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #ended = new Map(); #closing = false; #close;
  #files;
  constructor(config) { this.#config = config; this.#files = new MerchantGraphqlFiles(config); }
  get summary() {
    return { configured: Boolean(this.#config.graphqlWorkspaces), closing: this.#closing, files: this.#files.summary,
      workspaces: Object.entries(this.#config.graphqlWorkspaces?.workspaces ?? {}).map(([workspace, item]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: item.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null, browserUrl: entry?.service.url ?? null,
          sources: Object.entries(item.sources).map(([source, value]) => ({ source, label: value.label,
            origin: value.endpoint.origin, path: value.endpoint.path, credentialRequired: Boolean(value.endpoint.authorizationEnv),
            localDevelopment: value.allowLoopback })), hosts: Object.keys(item.hosts) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'GraphQL workspace alias');
    const value = this.#config.graphqlWorkspaces?.workspaces[alias];
    if (!value) throw failure('GRAPHQL_WORKSPACE_NOT_CONFIGURED', 'Choose a host-declared GraphQL workspace alias.');
    return value;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry || entry.closing) throw failure('GRAPHQL_WORKSPACE_NOT_OPEN', 'Open this original GraphQL workspace first.');
    return entry;
  }
  #source(alias, name) {
    const value = this.#definition(alias).sources[identifier(name, 'Source alias')];
    if (!value) throw failure('GRAPHQL_SOURCE_NOT_CONFIGURED', 'Choose an original host-declared GraphQL source.');
    return value;
  }
  #sourceForQueries(alias, name, queries) {
    const selected = this.#source(alias, name), expected = selected.endpoint;
    if (queries.origin !== expected.origin || queries.path !== expected.path
        || (queries.authorizationEnv ?? null) !== (expected.authorizationEnv ?? null))
      throw failure('GRAPHQL_SOURCE_CHANGED', 'The saved query connection differs from the selected host source alias.');
    return selected;
  }
  async #request(entry, path, body, { signal, release, bytes = false } = {}) {
    if (this.#closing || entry.closing) throw failure('GRAPHQL_CLOSING', 'The original GraphQL workspace is closing.');
    const target = release ?? { origin: entry.service.origin, token: entry.service.token, tokenHeader: 'x-workspace-token' };
    const url = new URL(path, target.origin);
    if (url.origin !== target.origin || !url.pathname.startsWith('/api/'))
      throw failure('GRAPHQL_API_TARGET', 'Use the original private API operation.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    entry.controllers.add(controller);
    try {
      const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { [target.tokenHeader]: target.token, Origin: target.origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const parts = []; let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > MAX_REPLY) { controller.abort(); throw failure('GRAPHQL_REPLY_TOO_LARGE', 'The original API response exceeded its bounded transfer limit.'); }
        parts.push(part);
      }
      const raw = Buffer.concat(parts);
      if (!response.ok) {
        let message = 'The original workspace rejected the operation.';
        try { message = JSON.parse(raw).error ?? message; } catch {}
        throw Object.assign(failure('GRAPHQL_NATIVE_' + response.status, message), { status: response.status });
      }
      return bytes ? raw : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } finally { entry.controllers.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  async #project(entry, args, useCurrent = false) {
    const query = new URLSearchParams({ id: originalProject(args.project) });
    if (!useCurrent && args.revision !== undefined) query.set('revision', String(revision(args.revision)));
    const saved = await this.#request(entry, '/api/project?' + query);
    if (useCurrent && saved.revision !== revision(args.expectedRevision))
      throw failure('GRAPHQL_REVISION_CONFLICT', 'The original saved project changed. Reopen its current revision.');
    return saved;
  }
  async #status(alias) {
    if (alias === undefined) return this.summary;
    const item = this.summary.workspaces.find(row => row.workspace === alias);
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry || entry.closing) return item;
    const native = await this.#request(entry, '/api/projects');
    return { ...item, projects: native.projects.length, runtime: native.runtime,
      previews: [...entry.jobs.values()].map(job => this.#jobView(job)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#closing) throw failure('GRAPHQL_CLOSING', 'The merchant operator is closing.');
    if (this.#entries.has(alias)) return this.#status(alias);
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const { startWorkspace } = await import(sourcePath + 'server.mjs');
      const service = await startWorkspace({ workspace: definition.directory, port: 0, noSignals: true });
      if (this.#closing) { await service.close(); throw failure('GRAPHQL_CLOSING', 'The operator closed during workspace startup.'); }
      const entry = { alias, definition, service, instanceId: randomUUID(), controllers: new Set(),
        jobs: new Map(), pending: new Set(), consoles: new Map(), closing: null };
      this.#entries.set(alias, entry);
      try { return await this.#status(alias); }
      catch (error) { await this.#closeEntry(entry); throw error; }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  #jobView(job) {
    return { previewId: job.id, project: job.project, expectedRevision: job.expectedRevision,
      state: job.state, startedAt: job.startedAt, completedAt: job.completedAt,
      error: job.error, cancellationRequested: Boolean(job.cancellationRequested) };
  }
  async #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      for (const controller of entry.controllers) controller.abort();
      for (const job of entry.jobs.values()) job.controller.abort();
      await Promise.allSettled([...entry.pending]);
      await entry.service.close();
      this.#entries.delete(entry.alias); this.#ended.set(entry.alias, entry.instanceId);
      return { workspace: entry.alias, instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #console(entry, args) {
    await this.#project(entry, args, true);
    const saved = await this.#request(entry, '/api/deployment/console', { id: args.project,
      expectedRevision: args.expectedRevision, deploymentId: originalUuid(args.deploymentId) });
    let url;
    try { url = new URL(saved.operatorUrl); } catch {}
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^#[a-f0-9]{64}$/.test(url.hash)
        || url.pathname !== '/' || url.search) throw failure('GRAPHQL_CONSOLE_UNAVAILABLE', 'The original release console did not return its private local capability.');
    const selected = { origin: url.origin, token: url.hash.slice(1), tokenHeader: 'x-release-token', operatorUrl: saved.operatorUrl };
    entry.consoles.set(args.project, selected);
    return selected;
  }
  async #previewStatus(entry, args) {
    if (!args.previewId) {
      const result = await this.#request(entry, '/api/authoring/previews?' + new URLSearchParams({ id: originalProject(args.project) }));
      return page(result.operations, args);
    }
    const id = originalUuid(args.previewId), job = entry.jobs.get(id);
    if (job && job.project !== args.project) throw failure('GRAPHQL_PREVIEW_CONFLICT', 'The preview belongs to a different project.');
    try {
      const value = await this.#request(entry, '/api/authoring/preview?' + new URLSearchParams({ id: originalProject(args.project), previewId: id }));
      return { preview: previewView(value), transport: job ? this.#jobView(job) : null };
    } catch (error) {
      if (error.status !== 404) throw error;
      const native = await this.#request(entry, '/api/authoring/previews?' + new URLSearchParams({ id: args.project }));
      const found = native.operations.find(item => item.id === id);
      return { preview: found ?? null, transport: job ? this.#jobView(job) : null,
        state: found?.state ?? job?.state ?? 'NOT_RETAINED', retry: 'Inspect this original UUID; an unknown started request is not replayed automatically.' };
    }
  }
  async #previewStart(entry, args) {
    const id = originalUuid(args.previewId), previous = entry.jobs.get(id);
    const intent = json({ project: args.project, expectedRevision: args.expectedRevision, source: args.source,
      operation: args.operation, variables: args.variables });
    if (previous) {
      if (previous.intent !== intent) throw failure('GRAPHQL_PREVIEW_CONFLICT', 'This preview UUID belongs to a different invocation.');
      return this.#previewStatus(entry, args);
    }
    if (!plain(args.variables)) throw failure('INVALID_PARAMS', 'Supply native variable values as an object.');
    // Reserve this exact caller identity before the first asynchronous lookup.
    // A second same-ID call observes this owner; cancellation cannot lose its
    // controller to another concurrent admission.
    const controller = new AbortController(), job = { id, project: originalProject(args.project),
      expectedRevision: revision(args.expectedRevision), intent, controller,
      state: 'VALIDATING', startedAt: new Date().toISOString() };
    entry.jobs.set(id, job);
    try {
      const saved = await this.#project(entry, args, true);
      const source = this.#sourceForQueries(entry.alias, args.source, parse(saved.input.queriesText, 'Approved queries'));
      if (controller.signal.aborted) throw failure('GRAPHQL_PREVIEW_CANCELLED', 'The selected preview was cancelled before its source request.');
      if (this.#closing || entry.closing) throw failure('GRAPHQL_CLOSING', 'The original GraphQL workspace is closing.');
      job.state = 'REQUESTING';
      const pending = this.#request(entry, '/api/authoring/preview', { id: saved.id, expectedRevision: saved.revision,
        previewId: id, operation: args.operation, variables: args.variables, allowLoopback: source.allowLoopback },
      { signal: controller.signal }).then(value => { job.state = 'RETURNED'; job.completedAt = new Date().toISOString(); job.result = value; },
      error => { job.state = controller.signal.aborted ? 'CANCELLATION_REQUESTED' : 'RESPONSE_UNAVAILABLE';
        job.error = { code: error.code ?? 'GRAPHQL_TRANSPORT_ENDED', message: error.message }; });
      entry.pending.add(pending); pending.finally(() => entry.pending.delete(pending));
      return { previewId: id, project: saved.id, expectedRevision: saved.revision, state: job.state,
        next: 'Inspect merchant_graphql_preview_status using this same previewId.' };
    } catch (error) {
      job.state = 'NOT_STARTED'; job.error = { code: error.code ?? 'GRAPHQL_PREVIEW_ADMISSION_FAILED', message: error.message };
      throw error;
    }
  }
  async #result(entry, args) {
    const value = await this.#request(entry, '/api/authoring/preview?' + new URLSearchParams({
      id: originalProject(args.project), previewId: originalUuid(args.previewId) }));
    const bytes = Buffer.from(value.responseBase64, 'base64');
    let selected;
    try { selected = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return { preview: previewView(value), structured: false, message: 'Read the original response bytes through its retained file set.' }; }
    const pointer = args.pointer ?? '';
    if (typeof pointer !== 'string' || pointer.length > 2048 || pointer && !pointer.startsWith('/') || /~(?![01])/u.test(pointer))
      throw failure('INVALID_PARAMS', 'Use a valid JSON pointer into the retained response.');
    for (const encoded of pointer ? pointer.slice(1).split('/') : []) {
      const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
      if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key))
        throw failure('GRAPHQL_RESULT_POINTER', 'That pointer is absent from the exact retained response.');
      selected = selected[key];
    }
    const result = Array.isArray(selected) ? { type: 'array', ...page(selected, args) }
      : plain(selected) ? { type: 'object', ...page(Object.entries(selected).map(([key, value]) => ({ key, value })), args) }
        : { type: selected === null ? 'null' : typeof selected, value: selected };
    if (Buffer.byteLength(json(result)) > 196608)
      throw failure('GRAPHQL_RESULT_VIEW_TOO_LARGE', 'Select a deeper JSON pointer or fewer rows; the exact retained response remains downloadable.');
    return { preview: previewView(value), pointer, structured: true, result };
  }
  async #savedSource(entry, args, saved, exportId) {
    const native = await entry.service.files.manifest({ project: saved.id, revision: saved.revision,
      kind: 'merchant', exportId: originalUuid(exportId) });
    const content = await entry.service.files.read(native.manifest.selection, 'queries.json', native.manifestFile.sha256);
    return this.#sourceForQueries(entry.alias, args.source, parse(content.bytes.toString('utf8'), 'Prepared queries'));
  }
  async #execute(name, args) {
    if (name.startsWith('merchant_graphql_export_')) return this.#files.call(name, args);
    if (name === 'merchant_graphql_status') return this.#status(args.workspace);
    if (name === 'merchant_graphql_open') return this.#open(args.workspace);
    if (name === 'merchant_graphql_close') {
      originalUuid(args.instanceId);
      const entry = this.#entries.get(args.workspace); this.#definition(args.workspace);
      if (!entry && this.#ended.get(args.workspace) === args.instanceId)
        return { workspace: args.workspace, instanceId: args.instanceId, state: 'CLOSED', reused: true };
      if (!entry || entry.instanceId !== args.instanceId)
        throw failure('GRAPHQL_INSTANCE_CONFLICT', 'Close only the currently owned GraphQL workspace instance.');
      return this.#closeEntry(entry);
    }
    const entry = this.#entry(args.workspace);
    switch (name) {
      case 'merchant_graphql_projects': return page((await this.#request(entry, '/api/projects')).projects, args);
      case 'merchant_graphql_project': return projectView(await this.#project(entry, args), args);
      case 'merchant_graphql_history': {
        const result = await this.#request(entry, '/api/history?' + new URLSearchParams({ id: originalProject(args.project) }));
        return { project: result.id, currentRevision: result.currentRevision, moreBeforeNativeWindow: result.more,
          oldestRevisionInWindow: result.items.at(-1)?.revision ?? null, ...page(result.items, args) };
      }
      case 'merchant_graphql_schema': {
        const saved = await this.#project(entry, args);
        const catalog = await this.#request(entry, '/api/authoring/catalog', { schemaText: saved.input.schemaText });
        const selected = args.type ? catalog.types[args.type] : null;
        if (args.type && !selected) throw failure('GRAPHQL_TYPE_NOT_FOUND', 'Select an actual type from this saved schema.');
        const rows = selected ? [...selected.fields.map(field => ({ kind: 'field', ...field })),
          ...selected.values.map(value => ({ kind: 'enum', ...value }))]
          : args.collection === 'types' ? Object.values(catalog.types).map(type => ({ name: type.name, kind: type.kind,
            description: type.description, fields: type.fields.length, values: type.values.length, composite: type.composite })) : catalog.roots;
        return { project: saved.id, revision: saved.revision, sourceSha256: catalog.sourceSha256,
          schemaSha256: catalog.schemaSha256, ...(selected ? { type: { name: selected.name, kind: selected.kind,
            description: selected.description } } : {}), ...page(rows, args) };
      }
      case 'merchant_graphql_capture': {
        if ((args.project === undefined) !== (args.expectedRevision === undefined)
            || args.includeSchema !== undefined && typeof args.includeSchema !== 'boolean')
          throw failure('INVALID_PARAMS', 'Supply project and expectedRevision together; includeSchema is a boolean.');
        const source = this.#source(entry.alias, args.source), saved = args.project === undefined ? null : await this.#project(entry, args, true);
        const result = await this.#request(entry, '/api/authoring/capture', { endpoint: source.endpoint, allowLoopback: source.allowLoopback });
        const project = saved ? await this.#request(entry, '/api/save', { id: saved.id, expectedRevision: saved.revision,
          input: { ...saved.input, schemaText: result.schemaText } }) : null;
        return { source: args.source, sourceIdentity: result.source, capturedAt: result.capturedAt,
          ...(project ? { project: projectView(project) } : {}),
          ...((args.includeSchema ?? !project) ? { schemaText: result.schemaText } : {}),
          sourceSha256: result.catalog.sourceSha256, schemaSha256: result.catalog.schemaSha256,
          queryRoots: result.catalog.roots.length, types: Object.keys(result.catalog.types).length };
      }
      case 'merchant_graphql_operation': {
        const saved = await this.#project(entry, args);
        const value = await this.#request(entry, args.model ? '/api/authoring/compile' : '/api/authoring/open',
          { input: saved.input, operation: args.operation, ...(args.model ? { model: args.model } : {}) });
        if (args.model) return value;
        const { catalog, ...rest } = value;
        return { ...rest, sourceSha256: catalog.sourceSha256, schemaSha256: catalog.schemaSha256 };
      }
      case 'merchant_graphql_apply_operation': {
        const saved = await this.#project(entry, args, true);
        const compiled = await this.#request(entry, '/api/authoring/compile',
          { input: saved.input, operation: args.operation, model: args.model });
        let planText = saved.input.planText, planUpdated = false;
        try {
          const plan = parse(planText, 'Merchant plan');
          if (Array.isArray(plan.routes)) {
            const routes = plan.routes.filter(route => plain(route) && route.operation === args.operation);
            for (const route of routes) { route.operation = compiled.operation.name; route.variables = compiled.samples; }
            if (routes.length) { planText = json(plan); planUpdated = true; }
          }
        } catch {}
        const value = await this.#request(entry, '/api/save', { id: saved.id, expectedRevision: saved.revision,
          input: { ...saved.input, queriesText: compiled.queriesText, planText } });
        return { project: projectView(value), operation: compiled.operation, samples: compiled.samples, review: compiled.review,
          planUpdated, ...(planUpdated ? {} : { note: 'The unfinished or unbound raw plan was preserved; update its matching route before merchant preparation.' }) };
      }
      case 'merchant_graphql_save': {
        originalProject(args.project); revision(args.expectedRevision, true);
        exact(args.input, ['title', 'schemaText', 'queriesText', 'planText']);
        const previous = args.expectedRevision === 0 ? {} : (await this.#project(entry, args, true)).input;
        return projectView(await this.#request(entry, '/api/save',
          { id: args.project, expectedRevision: args.expectedRevision, input: { ...previous, ...args.input } }));
      }
      case 'merchant_graphql_review': {
        const saved = await this.#project(entry, args);
        return { project: saved.id, revision: saved.revision, ...await this.#request(entry, '/api/review', { input: saved.input }) };
      }
      case 'merchant_graphql_preview_start': return this.#previewStart(entry, args);
      case 'merchant_graphql_preview_status': return this.#previewStatus(entry, args);
      case 'merchant_graphql_preview_cancel': {
        const job = entry.jobs.get(originalUuid(args.previewId));
        if (!job || job.project !== args.project) {
          const status = await this.#previewStatus(entry, args);
          if (status.preview?.state === 'COMPLETED') return { ...status, cancellationRequested: false };
          throw failure('GRAPHQL_PREVIEW_NOT_OWNED', 'This MCP process does not own that unfinished preview. Inspect its original retained state.');
        }
        if (job.state === 'REQUESTING') { job.cancellationRequested = true; job.controller.abort(); }
        return { ...this.#jobView(job), cancellationRequested: Boolean(job.cancellationRequested) };
      }
      case 'merchant_graphql_preview_recover': {
        await this.#project(entry, args, true);
        const value = await this.#request(entry, '/api/authoring/recover',
          { id: args.project, expectedRevision: args.expectedRevision, previewId: originalUuid(args.previewId) });
        return { project: projectView(value.project), preview: previewView(value.preview), recovered: value.recovered };
      }
      case 'merchant_graphql_preview_result': return this.#result(entry, args);
      case 'merchant_graphql_prepare': case 'merchant_graphql_prepare_revision': {
        const saved = await this.#project(entry, args, true);
        this.#sourceForQueries(entry.alias, args.source, parse(saved.input.queriesText, 'Approved queries'));
        const evolving = name === 'merchant_graphql_prepare_revision';
        const value = await this.#request(entry, evolving ? '/api/evolution/prepare' : '/api/export',
          { id: saved.id, expectedRevision: saved.revision, ...(evolving ? {
            baselineExportId: originalUuid(args.baselineExportId), comparisonDigest: digest(args.comparisonDigest) } : {}) });
        return { project: projectView(value.project), exported: exportView(value.exported) };
      }
      case 'merchant_graphql_evolution': {
        const saved = await this.#project(entry, args, true);
        if (args.reportExportId) return this.#request(entry, '/api/evolution/report?' +
          new URLSearchParams({ id: saved.id, exportId: originalUuid(args.reportExportId) }));
        const value = await this.#request(entry, '/api/evolution/compare', { id: saved.id, expectedRevision: saved.revision,
          input: saved.input, baselineExportId: originalUuid(args.baselineExportId) });
        return { inputDigest: value.inputDigest, baseline: { id: value.baseline.id, draftRevision: value.baseline.draftRevision },
          comparisonDigest: value.comparisonDigest, review: value.review, merchant: value.merchant };
      }
      case 'merchant_graphql_deployment': {
        const saved = await this.#project(entry, args, true);
        const body = { id: saved.id, expectedRevision: saved.revision };
        let path;
        if (args.action === 'prepare') {
          const source = await this.#savedSource(entry, args, saved, args.exportId);
          Object.assign(body, { exportId: args.exportId, allowLoopbackUpstream: source.allowLoopback });
          path = '/api/deployment/prepare';
        } else {
          body.deploymentId = originalUuid(args.deploymentId);
          const record = saved.deployments.find(row => row.id === body.deploymentId);
          if (!record) throw failure('GRAPHQL_DEPLOYMENT_NOT_FOUND', 'Select an original deployment from this project.');
          if (args.action === 'stage') {
            await this.#savedSource(entry, args, saved, record.exportId);
            body.options = { id: identifier(args.releaseId, 'Release ID'), ...entry.definition.runtime,
              ...(args.label === undefined ? {} : { label: line(args.label, 'Release label') }) };
            path = '/api/deployment/stage';
          } else if (args.action === 'host') {
            const host = entry.definition.hosts[identifier(args.host, 'Host alias')];
            if (!host) throw failure('GRAPHQL_HOST_NOT_CONFIGURED', 'Select an original host-plan alias from the connection.');
            body.host = host; path = '/api/deployment/host';
          } else if (args.action === 'recover') path = '/api/deployment/recover';
          else throw failure('INVALID_PARAMS', 'Choose prepare, stage, host or recover.');
        }
        const value = await this.#request(entry, path, body);
        return { project: projectView(value.project), deployment: deploymentView(value.deployment) };
      }
      case 'merchant_graphql_deployment_status': {
        const value = await this.#request(entry, '/api/deployment?' + new URLSearchParams({
          id: originalProject(args.project), deploymentId: originalUuid(args.deploymentId) }));
        return { deployment: deploymentView(value), pending: value.pending, releaseStatus: releaseView(value.releaseStatus) };
      }
      case 'merchant_graphql_release_status': {
        const selected = await this.#console(entry, args);
        const value = await this.#request(entry, args.to ? '/api/diff?' + new URLSearchParams({
          to: identifier(args.to), ...(args.from === undefined ? {} : { from: identifier(args.from) }) }) : '/api/status',
        undefined, { release: selected });
        return { browserUrl: selected.operatorUrl, native: releaseView(value) };
      }
      case 'merchant_graphql_release_change': {
        const selected = await this.#console(entry, args), status = await this.#request(entry, '/api/status', undefined, { release: selected });
        const action = args.action;
        if (!['activate', 'rollback', 'start', 'stop', 'restart'].includes(action))
          throw failure('INVALID_PARAMS', 'Choose an original release lifecycle action.');
        const body = {};
        if (action !== 'stop') {
          const expectedGeneration = revision(args.expectedGeneration, true);
          if (status.state.generation !== expectedGeneration) throw failure('GRAPHQL_RELEASE_CHANGED', 'The original release selection changed.');
          const target = ['activate', 'rollback'].includes(action) ? identifier(args.releaseId) : status.state.active;
          const release = status.releases.find(item => item.id === target);
          if (!release || release.digest !== digest(args.expectedDigest))
            throw failure('GRAPHQL_RELEASE_CHANGED', 'The selected original release differs from its inspected digest.');
          body.expectedGeneration = expectedGeneration;
          if (action === 'activate') body.id = target;
          if (action === 'rollback') body.to = target;
          if (['activate', 'rollback'].includes(action)) body.reason = line(args.reason, 'Change reason');
        }
        if (action === 'stop' || action === 'restart') {
          if (typeof args.instanceId !== 'string' || !args.instanceId || status.console.instanceId !== args.instanceId)
            throw failure('GRAPHQL_RELEASE_INSTANCE_CONFLICT', 'Use the current instance owned by this original release console.');
          body.instanceId = args.instanceId;
        }
        const path = '/api/' + (action === 'start' ? 'run' : action);
        return { browserUrl: selected.operatorUrl, native: releaseView(await this.#request(entry, path, body, { release: selected })) };
      }
      default: throw failure('TOOL_NOT_FOUND', 'Unknown original GraphQL workspace operation.');
    }
  }
  async call(name, args) {
    if (this.#closing) throw failure('GRAPHQL_CLOSING', 'The original GraphQL operator is closing.');
    try { return await this.#execute(name, args); }
    catch (error) {
      if (/^(?:GRAPHQL_|INVALID_PARAMS|CONFIGURATION_ERROR|TOOL_NOT_FOUND)/.test(error.code ?? '')) throw error;
      throw failure('GRAPHQL_NATIVE_ERROR', error.message ?? 'The original GraphQL operation failed.');
    }
  }
  beginClose() {
    this.#closing = true;
    for (const entry of this.#entries.values()) {
      for (const controller of entry.controllers) controller.abort();
      for (const job of entry.jobs.values()) job.controller.abort();
    }
  }
  close() {
    if (!this.#close) {
      this.beginClose();
      this.#close = (async () => {
        await Promise.allSettled([...this.#opening.values()]);
        const outcomes = await Promise.allSettled([...this.#entries.values()].map(entry => this.#closeEntry(entry)));
        await this.#files.close();
        if (outcomes.some(value => value.status === 'rejected'))
          throw failure('GRAPHQL_SHUTDOWN_INCOMPLETE', 'An original owned GraphQL workspace did not finish shutdown.');
      })();
    }
    return this.#close;
  }
}
