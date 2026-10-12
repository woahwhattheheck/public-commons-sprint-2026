// MIT. Source-owned Datasette MCP registration and original workspace access.
import {defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {createDatasetteClient, DATASETTE_OPERATIONS} from './client.mjs';
import {datasetteReceivingTools} from '../../../../stellar-forge/mcp-merchant-operator/catalog/datasette-workspace.mjs';

export const DATASETTE_CONNECTION_SCHEMA = 'stellar-forge.datasette-workspace-connection.v1';
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ENVIRONMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), {code});
function exact(value, keys, required = []) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) throw fail('INVALID_PARAMS', 'Supply the declared fields and every required field.');
}
function text(value, label, maximum = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value))
    throw fail('CONFIGURATION_ERROR', label + ' must be nonempty printable text.');
  return value;
}
async function privateText(path, maximum) {
  const [{open}, {constants}] = await Promise.all([import('node:fs/promises'), import('node:fs')]);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum || process.platform !== 'win32' && (info.mode & 0o077))
      throw fail('DATASETTE_PRIVATE_FILE_INVALID', 'Use a private regular file within the declared size limit.');
    const raw = await handle.readFile();
    if (raw.length > maximum) throw fail('DATASETTE_PRIVATE_FILE_INVALID', 'The selected private file grew beyond its size limit.');
    return new TextDecoder('utf-8', {fatal: true}).decode(raw);
  } finally {await handle.close();}
}

/** Host configuration refers to an existing workspace launch file or environment.
 * The merchant caller selects its alias; it does not supply a connection URL. */
export async function readDatasetteWorkspaceConfiguration(file) {
  const {dirname, resolve} = await import('node:path');
  file = resolve(file);
  const raw = JSON.parse(await privateText(file, 1024 * 1024));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== DATASETTE_CONNECTION_SCHEMA || !object(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare 1–32 original Datasette workspaces.');
  const workspaces = Object.create(null);
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    if (!ALIAS.test(alias)) throw fail('CONFIGURATION_ERROR', 'Use a valid workspace alias.');
    exact(value, ['label', 'urlFile', 'urlEnv', 'expectedWorkspaceId', 'timeoutMs'], []);
    if ((value.urlFile === undefined) === (value.urlEnv === undefined))
      throw fail('CONFIGURATION_ERROR', 'Select exactly one original workspace URL file or environment reference.');
    if (value.urlEnv !== undefined && !ENVIRONMENT.test(value.urlEnv))
      throw fail('CONFIGURATION_ERROR', 'Use the existing URL environment variable name.');
    if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3600000))
      throw fail('CONFIGURATION_ERROR', 'Request timeout must be 1–3600000 milliseconds.');
    workspaces[alias] = {
      label: text(value.label ?? alias, 'Workspace label'),
      ...(value.urlFile === undefined ? {urlEnv: value.urlEnv}
        : {urlFile: resolve(dirname(file), text(value.urlFile, 'Workspace URL file', 4096))}),
      ...(value.expectedWorkspaceId === undefined ? {} : {expectedWorkspaceId: text(value.expectedWorkspaceId, 'Workspace identity')}),
      timeoutMs: value.timeoutMs ?? 300000,
    };
  }
  return {schema: DATASETTE_CONNECTION_SCHEMA, workspaces};
}

const aliasSchema = {type: 'string', pattern: ALIAS.source};
const selected = {workspace: aliasSchema};
const read = {readOnly: true, idempotent: true};
export function datasetteWorkspaceTools(tool) {
  return [
    tool('merchant_datasette_workspaces', 'List configured Datasette source workspaces and their original connection references.', {}, [], read),
    tool('merchant_datasette_health', 'Read the original live Datasette workspace identity and local server status.', selected, ['workspace'], read),
    tool('merchant_datasette_status', 'Read saved source captures, immutable editions, active work and publisher state from the original Datasette workspace.', selected, ['workspace'], read),
    tool('merchant_datasette_operations', 'Read the original workspace operation catalog and retained operation state before continuing an interrupted request.', selected, ['workspace'], read),
    tool('merchant_datasette_operation',
      'Run one declared original Datasette capture, review, edition, publisher, buyer, release or complete source receiving action. Preserve the operationId or runId when continuing work and read status after an interrupted response.',
      {...selected, operation: {type: 'string', enum: [...DATASETTE_OPERATIONS]}, input: {type: 'object'}},
      ['workspace', 'operation', 'input'], {}),
  ];
}
const definitions = new Map(datasetteWorkspaceTools((name, description, properties, required) =>
  ({name, properties, required})).map(value => [value.name, value]));

export class MerchantDatasetteWorkspaces {
  #config; #fetch; #pending = new Set(); #closing = false; #close; #identities = new Map();
  constructor(config, {fetchImpl = globalThis.fetch} = {}) {this.#config = config; this.#fetch = fetchImpl;}
  get summary() {
    return {configured: Boolean(this.#config.datasetteWorkspaces),
      workspaces: Object.entries(this.#config.datasetteWorkspaces?.workspaces ?? {}).map(([workspace, value]) => ({
        workspace, label: value.label, connection: value.urlFile ? 'ORIGINAL_URL_FILE' : 'ORIGINAL_URL_ENV',
        expectedWorkspaceId: value.expectedWorkspaceId ?? this.#identities.get(workspace) ?? null,
      }))};
  }
  async #client(workspace) {
    if (typeof workspace !== 'string' || !ALIAS.test(workspace)) throw fail('INVALID_PARAMS', 'Use a configured workspace alias.');
    const selected = this.#config.datasetteWorkspaces?.workspaces[workspace];
    if (!selected) throw fail('DATASETTE_WORKSPACE_NOT_CONFIGURED', 'Choose a workspace from merchant_datasette_workspaces.');
    let raw;
    try {raw = selected.urlFile ? (await privateText(selected.urlFile, 16384)).trim() : process.env[selected.urlEnv];}
    catch (cause) {throw fail('DATASETTE_WORKSPACE_CONNECTION_UNAVAILABLE', 'Reopen the original workspace and its declared private launch file.');}
    let url = raw, launchIdentity = null;
    if (typeof raw === 'string' && raw.startsWith('{')) {
      let record; try {record = JSON.parse(raw);} catch {throw fail('DATASETTE_LAUNCH_INVALID', 'The original workspace launch file is incomplete.');}
      if (!object(record) || record.schema !== 'stellar-forge.datasette-server.v1' ||
          typeof record.workspaceId !== 'string' || typeof record.url !== 'string')
        throw fail('DATASETTE_LAUNCH_INVALID', 'Use the original Datasette server launch file.');
      url = record.url; launchIdentity = record.workspaceId;
    }
    const expectedWorkspaceId = selected.expectedWorkspaceId ?? this.#identities.get(workspace) ?? launchIdentity ?? undefined;
    if (launchIdentity && expectedWorkspaceId && launchIdentity !== expectedWorkspaceId)
      throw fail('DATASETTE_WORKSPACE_CHANGED', 'The launch file now selects a different workspace.');
    const client = createDatasetteClient({url, expectedWorkspaceId, fetchImpl: this.#fetch, timeoutMs: selected.timeoutMs});
    const health = await client.health();
    const latched = selected.expectedWorkspaceId ?? this.#identities.get(workspace);
    if (latched && health.workspaceId !== latched)
      throw fail('DATASETTE_WORKSPACE_CHANGED', 'The workspace identity changed while its original connection was opening.');
    this.#identities.set(workspace, health.workspaceId);
    return {client, health};
  }
  async #execute(name, args) {
    if (name === 'merchant_datasette_workspaces') return this.summary;
    const {client, health} = await this.#client(args.workspace);
    if (name === 'merchant_datasette_health') return {workspace: args.workspace, native: health};
    if (name === 'merchant_datasette_status') return {workspace: args.workspace, native: await client.status()};
    if (name === 'merchant_datasette_operations') return {workspace: args.workspace, native: await client.operations()};
    if (!DATASETTE_OPERATIONS.includes(args.operation) || !object(args.input))
      throw fail('INVALID_PARAMS', 'Select one declared operation and its complete input object.');
    return {workspace: args.workspace, operation: args.operation,
      native: await client.dispatch(args.operation, args.input)};
  }
  #track(action) {
    if (this.#closing) throw fail('DATASETTE_WORKSPACES_CLOSING', 'Datasette workspace access is closing.');
    const pending = Promise.resolve().then(action); this.#pending.add(pending);
    return pending.finally(() => {this.#pending.delete(pending);});
  }
  /** Trusted source-owned extensions use this same identity-bound connection.
   * Completion, including the callback's file receiving, is drained by close(). */
  async withWorkspace(workspace, callback) {
    if (typeof callback !== 'function') throw new TypeError('A trusted workspace callback is required.');
    return this.#track(async () => callback(await this.#client(workspace)));
  }
  async call(name, args = {}) {
    const definition = definitions.get(name);
    if (!definition) throw fail('TOOL_NOT_FOUND', 'Unknown Datasette workspace tool.');
    exact(args, Object.keys(definition.properties), definition.required);
    return this.#track(() => this.#execute(name, args));
  }
  close() {
    this.#closing = true;
    this.#close ??= Promise.allSettled([...this.#pending]).then(() => undefined);
    return this.#close;
  }
}

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'datasette-workspaces', family: 'datasetteWorkspaces',
  title: 'Datasette source editions', order: 1110, catalogOrder: 1110,
  configKey: 'datasetteWorkspaces', summary: true, dependencies: [],
  concurrency: 'provider',
  maxRequestBytes: 12 * 1024 * 1024,
  configuration: {input: 'datasetteWorkspaceConnection', privateExports: true,
    read: async (value, {hostPath}) => readDatasetteWorkspaceConfiguration(hostPath(value))},
  tools: tool => [...datasetteWorkspaceTools(tool), ...datasetteReceivingTools(tool)],
  instructions: [{order: 1110, prefix: 'merchant_datasette_',
    text: 'Use one configured original Datasette workspace. Read its operation catalog and state before continuing an interrupted request. Keep capture operationId, publisher runId, selected edition and review identities. Source captures and editions use the saved native rows and metadata; publisher, buyer and release actions use their original retained stores.'}],
  load: () => import('../../../../stellar-forge/mcp-merchant-operator/datasette-workspace.mjs'),
  create: (module, config, options) => new module.MerchantDatasetteWorkspaces(config, options),
});
