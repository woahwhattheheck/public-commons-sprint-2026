// MIT. Agent and browser operation of the original Redis merchant workspace.
import { lstat, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, fileBytes, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

export const REDIS_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.redis-workspace-connection.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_INLINE_BYTES = 32768;
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const digest = { type: 'string', pattern: SHA256.source };
const request = { type: 'string', pattern: REQUEST.source };
const uuid = { type: 'string', pattern: UUID.source };
const selected = { workspace: alias };
const inRevision = { ...selected, revisionId: digest };
const inOperation = { ...selected, requestId: request };
const read = { readOnly: true, idempotent: true };
const note = { type: 'string', maxLength: 2000 };
const pageSize = { type: 'integer', minimum: 1, maximum: 100 };
const revisionInput = { ...selected, requestId: request, expectedHead: digest,
  queries: { type: 'object' }, plan: { type: 'object' }, note };

export function redisWorkspaceTools(tool) {
  return [
    tool('merchant_redis_workspaces', 'List configured original Redis workspace aliases, immutable workspace/profile identities, owned browser sessions and the workspace bound to merchant release controls. Opens no source connection.', {}, [], read),
    tool('merchant_redis_open', 'Open the existing original Redis authoring model and its browser on one process-owned writer lease. Reopening this alias returns the same browser and instance. Uses the imported host environment references.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_redis_close', 'Drain this exact owned Redis workspace instance, its original browser and retained file reads. Saved revisions, original operations, packages and releases stay available for reopening.', { ...selected, instanceId: uuid }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_redis_status', 'Inspect the original saved head, source profile, paged revision and operation summaries, browser URL and owned file reads. Large current revisions are available through the returned complete-record descriptor.', selected, ['workspace'], read),
    tool('merchant_redis_review', 'Compile proposed queries and merchant plan with the original Redis product compiler. Returns every normalized route and payment offer. The imported source connection stays fixed.', { ...selected, queries: { type: 'object' }, plan: { type: 'object' } }, ['workspace', 'queries', 'plan'], read),
    tool('merchant_redis_save', 'Save reviewed queries and plan to the original revision history using requestId and expectedHead. Repeating the same request reopens its retained result. Read status and reconcile browser edits when the head changes.', revisionInput, ['workspace', 'requestId', 'expectedHead', 'queries', 'plan'], { idempotent: true }),
    tool('merchant_redis_restore', 'Restore a saved revision as a new original revision using the current expectedHead. Keeps all intervening saved revisions and records this exact request.', { ...inRevision, requestId: request, expectedHead: digest, note }, ['workspace', 'requestId', 'expectedHead', 'revisionId'], { idempotent: true }),
    tool('merchant_redis_revisions', 'Page original saved revision summaries. Pass nextCursor unchanged as after. Read a revision for the complete saved source and merchant plan.', { ...selected, after: digest, limit: pageSize }, ['workspace'], read),
    tool('merchant_redis_revision', 'Read a complete original saved source revision and merchant plan. Large records return their exact byte count, SHA256 and resumable file-read selection.', inRevision, ['workspace', 'revisionId'], read),
    tool('merchant_redis_preview', 'Execute a saved declared query through the original Redis or Upstash source and retain the complete result. Supply a new requestId for each new observation. Continue a paginated result with its exact native nextInput and a new requestId.', { ...inRevision, requestId: request, query: { type: 'string', minLength: 1, maxLength: 80 }, input: { type: 'object' } }, ['workspace', 'requestId', 'revisionId', 'query', 'input'], { idempotent: true, openWorld: true }),
    tool('merchant_redis_prepare', 'Prepare or recover the original merchant package and generated customer files for one saved revision. Repeating the same request preserves its original package and retained outcome.', { ...inRevision, requestId: request }, ['workspace', 'requestId', 'revisionId'], { idempotent: true }),
    tool('merchant_redis_stage', 'Stage a completed original Redis package into this MCP merchant same release store. Use merchant_inspect, merchant_activate and the maintained merchant lifecycle for that release. runtime is selected by the host connection.', { ...selected, requestId: request, packageId: request, releaseId: alias, label: { type: 'string', maxLength: 240 } }, ['workspace', 'requestId', 'packageId', 'releaseId'], { idempotent: true }),
    tool('merchant_redis_operations', 'Page retained original operation summaries and recovery state. Pass nextCursor unchanged as after; read any original operation for its complete input, outcome and source observation.', { ...selected, after: request, limit: pageSize }, ['workspace'], read),
    tool('merchant_redis_operation', 'Read the retained original request and result after completion, interruption or a lost tool reply. Large records keep all result rows and native nextInput in the SHA256-pinned complete-record download.', inOperation, ['workspace', 'requestId'], read),
    tool('merchant_redis_resume', 'Resume this original request only when the native model marks it INTERRUPTED. Reopens other retained states without redispatch. Input and operation identity come from the original saved request.', inOperation, ['workspace', 'requestId'], { idempotent: true, openWorld: true }),
    tool('merchant_redis_file_read', 'Read complete saved revision/operation JSON or a verified original public customer file as resumable SHA256-pinned base64 chunks. revision uses revisionId; operation uses requestId; customer uses packageId and the exact original public filename. Continue with readId, expectedSha256 and nextOffset. After expiry/close/restart omit readId and resume the same selection, SHA256 and offset.', {
      ...selected, kind: { type: 'string', enum: ['revision', 'operation', 'customer'] }, revisionId: digest,
      requestId: request, packageId: request, name: { type: 'string', minLength: 1, maxLength: 240 },
      readId: uuid, expectedSha256: digest, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind'], read),
    tool('merchant_redis_file_release', 'Release one owned temporary verified read snapshot. The original saved record or public customer file remains available.', { ...selected, readId: uuid }, ['workspace', 'readId'], read),
  ];
}
const definitions = new Map(redisWorkspaceTools((name, _description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw failure('INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw failure('CONFIGURATION_ERROR', 'Declare an original host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
async function privateDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' &&
      ((info.mode & 0o077) || typeof process.getuid === 'function' && info.uid !== process.getuid()))
    throw failure('CONFIGURATION_ERROR', 'Use an existing original private Redis workspace directory.');
}
function sameBinding(expected, actual) {
  if (actual.workspaceId !== expected.workspaceId || actual.profileSha256 !== expected.profileSha256)
    throw failure('REDIS_WORKSPACE_BINDING_CHANGED', 'The host alias now selects a different original workspace or source profile. Restore the configured workspace or update the host connection.');
}
async function inspectBinding(directory) {
  const { inspectRedisWorkspaceBinding } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/model.mjs');
  return inspectRedisWorkspaceBinding(directory);
}

/** Inspect immutable original identities without taking the native writer lease. */
export async function readRedisWorkspaceConfiguration(path, { releaseStore } = {}) {
  path = resolve(path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
    throw failure('CONFIGURATION_ERROR', 'Keep the host Redis connection in a private regular file (0600).');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1024 * 1024)));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== REDIS_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original Redis workspace aliases.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  const canonicalStore = releaseStore === undefined ? null : await realpath(releaseStore);
  let releaseWorkspace = null;
  for (const [key, input] of Object.entries(raw.workspaces)) {
    identifier(key, 'Redis workspace alias');
    exact(input, ['label', 'directory', 'workspaceId', 'profileSha256', 'runtime'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateDirectory(directory);
    if (await realpath(directory) !== directory || directories.has(directory))
      throw failure('CONFIGURATION_ERROR', 'Bind each canonical original Redis workspace through one host alias.');
    directories.add(directory);
    const binding = await inspectBinding(directory);
    if (input.workspaceId !== undefined && input.workspaceId !== binding.workspaceId ||
        input.profileSha256 !== undefined && checked(input.profileSha256, SHA256, 'source profile SHA256') !== binding.profileSha256)
      throw failure('REDIS_WORKSPACE_BINDING_CHANGED', 'The saved Redis host connection differs from the selected original workspace.');
    const { normalizeReleaseRuntime } = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
    if (input.runtime !== undefined) exact(input.runtime, ['port', 'facilitator', 'allowLocalFacilitator']);
    const runtime = normalizeReleaseRuntime(input.runtime ?? { port: 0 });
    const releaseBound = canonicalStore === join(directory, 'releases');
    if (releaseBound) releaseWorkspace = key;
    workspaces[key] = { directory, label: line(input.label ?? binding.label ?? key, 'Redis workspace label'),
      workspaceId: binding.workspaceId, profileSha256: binding.profileSha256, runtime, releaseBound };
  }
  if (canonicalStore && releaseWorkspace === null)
    throw failure('REDIS_RELEASE_STORE_CONFLICT', 'Bind merchant release controls to the selected original Redis workspace releases directory; use init-redis-workspaces.');
  return { schema: REDIS_WORKSPACE_CONNECTION_SCHEMA, workspaces, releaseWorkspace };
}
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function publicPackage(value) {
  if (!plain(value)) return value;
  const { directory, ...visible } = value;
  return visible;
}
function safeError(issue) {
  if (typeof issue?.code === 'string' && /^(REDIS_|INVALID_PARAMS|CONFIGURATION_ERROR|TOOL_NOT_FOUND)/.test(issue.code)) return issue;
  const error = failure('REDIS_WORKSPACE_OPERATION_FAILED', 'The original Redis workspace operation failed. Read its saved request and current state before continuing.');
  if (issue instanceof TypeError && typeof issue.message === 'string' && issue.message.length <= 240 && !/[\x00-\x1f\x7f]/.test(issue.message)) error.message = issue.message;
  return error;
}

export class MerchantRedisWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'REDIS_FILE' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.redisWorkspaces), releaseWorkspace: this.#config.redisWorkspaces?.releaseWorkspace ?? null,
      ...this.#reads.summary,
      workspaces: Object.entries(this.#config.redisWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, workspaceId: definition.workspaceId, profileSha256: definition.profileSha256,
          releaseBound: definition.releaseBound, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null, browserUrl: entry?.service.operatorUrl ?? null };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'Redis workspace alias');
    const definition = this.#config.redisWorkspaces?.workspaces[alias];
    if (!definition) throw failure('REDIS_WORKSPACE_NOT_CONFIGURED', 'Choose a host alias from merchant_redis_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('REDIS_WORKSPACE_NOT_OPEN', 'Open this original Redis workspace first.');
    if (entry.closing) throw failure('REDIS_WORKSPACE_CLOSING', 'This owned original workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'redis:' + alias + ':' + this.#definition(alias).workspaceId; }
  #operationSummary(entry, value) {
    const summary = entry.model.operationSummary(value);
    if (summary.package) {
      summary.package = publicPackage(summary.package);
      summary.customerFiles = ['openapi.json', ...Object.keys(value.result?.files ?? {}).filter(name => name.startsWith('client/'))];
    }
    if (value.kind === 'preview' && value.result) {
      const data = value.result.data;
      summary.observation = { query: value.result.query, observedAt: value.result.observedAt,
        columns: data.columns, rowCount: data.rowCount, truncated: data.truncated, nextInput: data.nextInput ?? null };
    }
    return summary;
  }
  #record(entry, kind, id, native) {
    const bytes = jsonBytes(native), sha256 = createHash('sha256').update(bytes).digest('hex');
    const selection = { workspace: entry.alias, kind, ...(kind === 'revision' ? { revisionId: id } : { requestId: id }) };
    return { workspace: entry.alias, kind, id,
      summary: kind === 'revision' ? entry.model.summary(native) : this.#operationSummary(entry, native),
      inline: bytes.length <= MAX_INLINE_BYTES, ...(bytes.length <= MAX_INLINE_BYTES ? { native } : {}),
      record: { bytes: bytes.length, sha256, fileRead: { tool: 'merchant_redis_file_read', arguments: { ...selection, expectedSha256: sha256 } } } };
  }
  #state(entry) {
    const state = entry.model.state(), current = this.#record(entry, 'revision', state.current.id, state.current);
    return { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.operatorUrl,
      workspaceId: this.#definition(entry.alias).workspaceId, profileSha256: this.#definition(entry.alias).profileSha256,
      releaseBound: this.#definition(entry.alias).releaseBound, native: { ...state, current },
      fileReads: this.#reads.status(this.#scope(entry.alias)) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const { openRedisAuthoringWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/model.mjs');
      const { startRedisAuthoringServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/server.mjs');
      sameBinding(definition, await inspectBinding(definition.directory));
      let model, service;
      try {
        model = await openRedisAuthoringWorkspace(definition.directory, { expectedWorkspaceId: definition.workspaceId, expectedProfileSha256: definition.profileSha256 });
        sameBinding(definition, await inspectBinding(definition.directory));
        service = await startRedisAuthoringServer({ workspace: model, port: 0 });
        if (this.#closing) throw failure('REDIS_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, model, service, instanceId: randomUUID(), pending: new Set(), closing: null };
        this.#entries.set(alias, entry);
        try { return this.#state(entry); }
        catch (issue) { this.#entries.delete(alias); throw issue; }
      } catch (issue) { if (service) await service.close().catch(() => {}); else await model?.close().catch(() => {}); throw issue; }
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
      return { workspace: entry.alias, workspaceId: this.#definition(entry.alias).workspaceId,
        instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #file(entry, input) {
    let key, load;
    if (input.kind === 'revision') {
      checked(input.revisionId, SHA256, 'revision');
      if (input.requestId !== undefined || input.packageId !== undefined || input.name !== undefined) throw failure('INVALID_PARAMS', 'Select only revisionId for a saved revision.');
      key = ['revision', input.revisionId];
      load = async () => ({ bytes: jsonBytes(entry.model.revision(input.revisionId)), name: input.revisionId + '.json', type: 'application/json' });
    } else if (input.kind === 'operation') {
      checked(input.requestId, REQUEST, 'request');
      if (input.revisionId !== undefined || input.packageId !== undefined || input.name !== undefined) throw failure('INVALID_PARAMS', 'Select only requestId for a retained operation.');
      key = ['operation', input.requestId];
      load = async () => ({ bytes: jsonBytes(entry.model.operation(input.requestId)), name: input.requestId + '.json', type: 'application/json' });
    } else if (input.kind === 'customer') {
      checked(input.packageId, REQUEST, 'prepared package request');
      if (input.revisionId !== undefined || input.requestId !== undefined || typeof input.name !== 'string' || !input.name || input.name.length > 240) throw failure('INVALID_PARAMS', 'Select packageId and the exact original public customer filename.');
      key = ['customer', input.packageId, input.name];
      load = () => entry.model.file(input.packageId, input.name);
    } else throw failure('INVALID_PARAMS', 'Choose revision, operation or customer.');
    if (input.readId !== undefined) checked(input.readId, UUID, 'file read');
    const result = await this.#reads.read({ scope: this.#scope(entry.alias), key: JSON.stringify(key), kind: 'redis-' + input.kind,
      directory: this.#definition(entry.alias).directory, readId: input.readId, expectedSha256: input.expectedSha256,
      offset: input.offset, limit: input.limit, load });
    return { workspace: entry.alias, kind: input.kind, ...result };
  }
  async #execute(entry, name, args) {
    const original = entry.model, { workspace, ...input } = args;
    const operation = native => this.#record(entry, 'operation', native.id, native);
    switch (name) {
      case 'merchant_redis_status': return this.#state(entry);
      case 'merchant_redis_review': return { workspace, native: original.review(input) };
      case 'merchant_redis_save': return operation(await original.save(input));
      case 'merchant_redis_restore': return operation(await original.restore(input));
      case 'merchant_redis_revisions': {
        const page = original.page('revisions', input);
        return { workspace, ...page, items: page.items.map(value => original.summary(value)) };
      }
      case 'merchant_redis_revision': return this.#record(entry, 'revision', input.revisionId, original.revision(input.revisionId));
      case 'merchant_redis_preview': return operation(await original.preview(input));
      case 'merchant_redis_prepare': return operation(await original.prepare(input));
      case 'merchant_redis_stage': {
        const definition = this.#definition(workspace);
        if (!definition.releaseBound) throw failure('REDIS_RELEASE_STORE_CONFLICT', 'Use the Redis workspace bound to this merchant release store, shown by merchant_redis_workspaces.');
        return operation(await original.stage({ ...input, runtime: definition.runtime }));
      }
      case 'merchant_redis_operations': {
        const page = original.page('operations', input);
        return { workspace, ...page, items: page.items.map(value => this.#operationSummary(entry, value)) };
      }
      case 'merchant_redis_operation': return operation(original.operation(input.requestId));
      case 'merchant_redis_resume': {
        const saved = original.operation(input.requestId);
        if (saved.kind === 'stage' && saved.status === 'INTERRUPTED' && !this.#definition(workspace).releaseBound)
          throw failure('REDIS_RELEASE_STORE_CONFLICT', 'Resume staging through the merchant bound to this original Redis release store.');
        return operation(await original.resume(input.requestId));
      }
      case 'merchant_redis_file_read': return this.#file(entry, input);
      case 'merchant_redis_file_release':
        checked(input.readId, UUID, 'file read');
        await this.#reads.release(this.#scope(workspace), input.readId);
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Redis workspace operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('REDIS_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown Redis workspace operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    try {
      if (name === 'merchant_redis_workspaces') return this.summary;
      if (name === 'merchant_redis_open') return await this.#open(args.workspace);
      const entry = this.#entry(args.workspace);
      if (name === 'merchant_redis_close') {
        if (checked(args.instanceId, UUID, 'owned workspace instance') !== entry.instanceId)
          throw failure('REDIS_WORKSPACE_INSTANCE_CONFLICT', 'Close the exact workspace instance reported by merchant_redis_status.');
        return await this.#closeEntry(entry);
      }
      const pending = this.#execute(entry, name, args);
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
        if (results.some(result => result.status === 'rejected')) throw failure('REDIS_WORKSPACE_SHUTDOWN_INCOMPLETE', 'An owned original Redis workspace reported an incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
