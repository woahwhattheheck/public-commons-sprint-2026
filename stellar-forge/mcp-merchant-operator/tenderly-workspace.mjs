import { tenderlyWorkspaceTools, read, selected, uuid, profile, pageSize, inProfile, requestBody, request, inOperation, digest, generation, reference, alias, UUID, PROFILE, REQUEST, SHA256 } from './catalog/tenderly-workspace.mjs';
export { tenderlyWorkspaceTools } from './catalog/tenderly-workspace.mjs';
// MIT. Agent and browser operation of one original Tenderly merchant workspace.
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { readBytes, privateDirectory, parse } from '../../stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { templatePlan, exampleRequest, inspectPlan } from '../../stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/product.mjs';

export const TENDERLY_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.tenderly-workspace-connection.v1';
const NATIVE_SCHEMA = 'stellar-forge.tenderly-workspace.v1';









const text = { type: 'string', minLength: 1, maxLength: 240 };










const definitions = new Map(tenderlyWorkspaceTools((name, _description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty original host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw failure('INVALID_PARAMS', 'Select the original ' + label + '.');
  return value;
}

/** One host alias owns each existing canonical private directory, including a new empty workspace. */
export async function readTenderlyWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await readBytes(path, { privateFile: true, max: 1024 * 1024 }), 'Tenderly workspace connection');
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== TENDERLY_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original Tenderly workspaces.');
  const base = dirname(path), directories = new Set(), workspaces = Object.create(null);
  for (const [key, input] of Object.entries(raw.workspaces)) {
    identifier(key, 'Tenderly workspace alias');
    exact(input, ['label', 'directory', 'plan', 'facilitator'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateDirectory(directory);
    const canonical = await realpath(directory);
    if (canonical !== directory || directories.has(canonical))
      throw failure('CONFIGURATION_ERROR', 'Bind each original canonical Tenderly workspace through one alias.');
    directories.add(canonical);
    try {
      const saved = parse(await readBytes(join(directory, 'workspace.json'), { privateFile: true, max: 65536 }), 'Tenderly workspace');
      if (saved.schema !== NATIVE_SCHEMA || !UUID.test(saved.id ?? ''))
        throw failure('CONFIGURATION_ERROR', 'Use the original Tenderly operator workspace.');
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    let planPath;
    if (input.plan !== undefined) {
      planPath = hostPath(input.plan, base);
      inspectPlan(parse(await readBytes(planPath, { privateFile: true, max: 1024 * 1024 }), 'Initial Tenderly merchant plan'));
    }
    const merchantOptions = {};
    if (input.facilitator !== undefined) {
      let url; try { url = new URL(input.facilitator); } catch {}
      if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw failure('CONFIGURATION_ERROR', 'Declare the original selected HTTPS payment facilitator.');
      merchantOptions.facilitator = url.href;
    }
    workspaces[key] = { label: line(input.label ?? key, 'Tenderly workspace label'), directory, planPath, merchantOptions };
  }
  return { schema: TENDERLY_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}
function withoutDirectory(value) {
  if (!plain(value)) return value;
  const { directory, ...visible } = value;
  return visible;
}
function safeError(issue) {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code ?? '') ? issue.code
    : issue instanceof TypeError || issue?.status === 400 ? 'TENDERLY_INVALID_INPUT' : 'TENDERLY_WORKSPACE_OPERATION_FAILED';
  const error = failure(code, 'Original Tenderly operation: ' + code +
    '. Read the current profile, operation or provider observation before continuing.');
  if (issue instanceof TypeError && typeof issue.message === 'string' && issue.message.length <= 240 && !/[\x00-\x1f\x7f]/.test(issue.message))
    error.message = issue.message;
  if (Number.isInteger(issue?.status)) error.status = issue.status;
  if (typeof issue?.retryAt === 'string' && Number.isFinite(Date.parse(issue.retryAt))) {
    error.retryAt = issue.retryAt;
    error.message += ' Provider retry at ' + issue.retryAt + '.';
  }
  return error;
}

export class MerchantTenderlyWorkspaces {
  #config; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'TENDERLY_FILE' });
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.tenderlyWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.tenderlyWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, open: Boolean(entry),
          opening: this.#opening.has(workspace), closing: Boolean(entry?.closing),
          instanceId: entry?.instanceId ?? null, browserUrl: entry?.service.url ?? null,
          state: entry?.model.status().state ?? 'CLOSED', profile: entry?.model.status().profile ?? null,
          facilitatorConfigured: Boolean(definition.merchantOptions.facilitator) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'Tenderly workspace alias');
    const definition = this.#config.tenderlyWorkspaces?.workspaces[alias];
    if (!definition) throw failure('TENDERLY_WORKSPACE_NOT_CONFIGURED', 'Choose a host alias from merchant_tenderly_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('TENDERLY_WORKSPACE_NOT_OPEN', 'Open this original Tenderly workspace first.');
    if (entry.closing) throw failure('TENDERLY_WORKSPACE_CLOSING', 'This owned original workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'tenderly:' + alias + ':' + this.#definition(alias).directory; }
  async #state(entry, bootstrap = false) {
    const native = withoutDirectory(entry.model.status());
    const result = { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.url,
      native, fileReads: this.#reads.status(this.#scope(entry.alias)) };
    if (bootstrap) {
      const initial = await entry.model.bootstrap();
      if (initial.schema !== NATIVE_SCHEMA) throw failure('TENDERLY_WORKSPACE_SCHEMA_CHANGED', 'Use the original supported Tenderly workspace.');
      result.workspaceId = initial.id; result.createdAt = initial.createdAt;
      result.template = initial.template; result.exampleRequest = exampleRequest();
      result.initialProfile = withoutDirectory(initial.initialProfile); result.profiles = initial.profiles;
    }
    return result;
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias), true);
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const { startTenderlyWorkspace } = await import('../../stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/workspace/server.mjs');
      let service;
      try {
        service = await startTenderlyWorkspace({ directory: definition.directory, planPath: definition.planPath,
          merchantOptions: definition.merchantOptions, port: 0 });
        if (this.#closing) throw failure('TENDERLY_WORKSPACE_CLOSING', 'The merchant operator is closing.');
        const entry = { alias, service, model: service.model, instanceId: randomUUID(), pending: new Set(), closing: null };
        this.#entries.set(alias, entry);
        try { return await this.#state(entry, true); }
        catch (issue) { this.#entries.delete(alias); throw issue; }
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
      return { workspace: entry.alias, workspaceId: entry.model.manifest.id,
        instanceId: entry.instanceId, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #file(entry, input) {
    checked(input.profile, PROFILE, 'profile');
    const { kind, id, observationId } = input;
    if (kind === 'plan') {
      if (id !== undefined || observationId !== undefined) throw failure('INVALID_PARAMS', 'A plan read selects only its original profile.');
    } else if (kind === 'request') {
      checked(id, REQUEST, 'request');
      if (observationId !== undefined) throw failure('INVALID_PARAMS', 'Only a provider response selects an observation.');
    } else if (kind === 'response' || kind === 'provider-response') {
      checked(id, SHA256, kind === 'response' ? 'operation key' : 'provider lookup');
      if (kind === 'provider-response') checked(observationId, UUID, 'provider observation');
      else if (observationId !== undefined) throw failure('INVALID_PARAMS', 'Only a provider response selects an observation.');
    } else throw failure('INVALID_PARAMS', 'Choose plan, request, response or provider-response.');
    if (input.readId !== undefined) checked(input.readId, UUID, 'file read');
    const key = JSON.stringify([input.profile, kind, id ?? null, observationId ?? null]);
    const result = await this.#reads.read({ scope: this.#scope(entry.alias), key,
      kind: 'tenderly-' + kind, directory: this.#definition(entry.alias).directory,
      readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
      load: async () => {
        const original = await entry.model.download({ profile: input.profile, kind, id, observationId });
        return { bytes: original.bytes, name: original.name, type: original.mime };
      } });
    return { workspace: entry.alias, profile: input.profile, kind, id: id ?? null,
      observationId: observationId ?? null, ...result };
  }
  async #execute(entry, name, args) {
    const original = entry.model, { workspace, ...input } = args;
    const result = native => ({ workspace, native });
    switch (name) {
      case 'merchant_tenderly_status': return this.#state(entry);
      case 'merchant_tenderly_profile_preview': return result(input.plan === undefined
        ? { template: templatePlan(), exampleRequest: exampleRequest() } : original.preview(input.plan));
      case 'merchant_tenderly_profile_save': return result(withoutDirectory(await original.saveProfile(input)));
      case 'merchant_tenderly_profiles': return result(await original.profiles(input));
      case 'merchant_tenderly_profile': return result(withoutDirectory(await original.inspectProfile(input.profile)));
      case 'merchant_tenderly_prepare': {
        const prepared = await original.prepare(input.profile);
        return result({ schema: prepared.schema, profile: prepared.profile, planSha256: prepared.planSha256,
          createdAt: prepared.createdAt, state: 'PREPARED' });
      }
      case 'merchant_tenderly_profile_open': return result(withoutDirectory(await original.openProfile(input.profile)));
      case 'merchant_tenderly_start': return result(withoutDirectory(await original.start({ profile: input.profile, port: 0, operationsPort: 0 })));
      case 'merchant_tenderly_stop': return result(withoutDirectory(await original.stop(input.profile)));
      case 'merchant_tenderly_issue': return result(await original.issue(input));
      case 'merchant_tenderly_requests': return result(await original.requests(input));
      case 'merchant_tenderly_request': {
        const saved = await original.inspectRequest(checked(input.requestId, REQUEST, 'request'));
        if (saved.packet.profile !== checked(input.profile, PROFILE, 'profile'))
          throw failure('TENDERLY_REQUEST_PROFILE_CONFLICT', 'Select the original profile that owns this request.');
        return result(saved);
      }
      case 'merchant_tenderly_operations': return result(await original.operations(input));
      case 'merchant_tenderly_operation': return result(await original.operation(input));
      case 'merchant_tenderly_audit': return result(await original.audit(input));
      case 'merchant_tenderly_result': {
        const response = await original.response(input);
        return result({ status: response.status, headers: response.headers, bytes: response.bytes.length,
          sha256: response.sha256, summary: response.summary, name: response.name });
      }
      case 'merchant_tenderly_recover':
        if (input.action === 'complete' && !plain(input.response) || input.action === 'retry' && input.response !== undefined)
          throw failure('INVALID_PARAMS', 'Complete requires the original response; retry requires only its provider reference.');
        return result(await original.recover(input));
      case 'merchant_tenderly_provider_lookup': return result(await original.lookupProvider(input));
      case 'merchant_tenderly_provider_lookups': return result(await original.providerLookups(input));
      case 'merchant_tenderly_provider_inspect': return result(await original.providerLookup({ profile: input.profile, id: input.lookupId }));
      case 'merchant_tenderly_provider_recover': return result(await original.recoverProvider(input));
      case 'merchant_tenderly_file_read': return this.#file(entry, input);
      case 'merchant_tenderly_file_release':
        await this.#reads.release(this.#scope(workspace), checked(input.readId, UUID, 'file read'));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown Tenderly merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('TENDERLY_WORKSPACE_CLOSING', 'The merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown Tenderly merchant operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    try {
      if (name === 'merchant_tenderly_workspaces') return this.summary;
      if (name === 'merchant_tenderly_open') return await this.#open(args.workspace);
      if (name === 'merchant_tenderly_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== checked(args.instanceId, UUID, 'workspace instance'))
          throw failure('TENDERLY_INSTANCE_CONFLICT', 'Close only the current Tenderly instance owned by this MCP process.');
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
          throw failure('TENDERLY_SHUTDOWN_INCOMPLETE', 'An original owned Tenderly workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
