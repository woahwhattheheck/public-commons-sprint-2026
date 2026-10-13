// MIT. Complete MCP workflow on the existing EDR HTTP owner.
import { basename } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { EdrClient, readHostFile, readEdrConfiguration, CONNECTION_SCHEMA, MAX_FILE_BYTES, canonical, digest, failure } from './mcp-client.mjs';
import { edrTools, fileFields } from './mcp-catalog.mjs';
export { readEdrConfiguration, CONNECTION_SCHEMA, edrTools };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const definitions = new Map(edrTools((name, description, properties, required) => ({ name, description, properties, required })).map(t => [t.name, t]));
function check(value, schema, key) {
  if (schema.anyOf) {
    for (const variant of schema.anyOf) { try { check(value, variant, key); return; } catch {} }
    throw failure('MCP_INPUT_INVALID', 'Supply the declared ' + key + ', including explicit null only where allowed.');
  }
  if (schema.type === 'null' && value !== null) throw failure('MCP_INPUT_INVALID', 'Use explicit null for ' + key + '.');
  if (schema.type === 'string' && (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength ||
    schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)))
    throw failure('MCP_INPUT_INVALID', 'Supply the declared ' + key + '.');
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)))
    throw failure('MCP_INPUT_INVALID', 'Supply a supported integer ' + key + '.');
  if (schema.type === 'object' && !plain(value)) throw failure('MCP_INPUT_INVALID', 'Supply a complete JSON object for ' + key + '.');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 100000) || value.length < (schema.minItems ?? 0))
      throw failure('MCP_INPUT_INVALID', 'Supply the declared bounded array ' + key + '.');
    if (schema.items) value.forEach((item, index) => check(item, schema.items, key + '[' + index + ']'));
  }
  if (schema.type === 'object' && schema.properties) {
    if ((schema.required ?? []).some(name => !Object.hasOwn(value, name)) ||
      schema.additionalProperties === false && Object.keys(value).some(name => !Object.hasOwn(schema.properties, name)))
      throw failure('MCP_INPUT_INVALID', 'Use exactly the declared object fields for ' + key + '.');
    for (const [name, item] of Object.entries(value)) if (schema.properties[name]) check(item, schema.properties[name], key + '.' + name);
  }
  if (schema.enum && !schema.enum.includes(value)) throw failure('MCP_INPUT_INVALID', 'Choose a declared ' + key + '.');
}
function small(value, maximum = 1024 * 1024) {
  if (Buffer.byteLength(JSON.stringify(value)) > maximum)
    throw failure('VIEW_TOO_LARGE', 'Use a smaller original record/row page or download the complete source member or customer packet.');
  return value;
}
const pathId = value => encodeURIComponent(value);
const pageQuery = args => new URLSearchParams({ offset: String(args.offset ?? 0), limit: String(args.limit ?? 100) }).toString();
export class MerchantEdrWorkspaces {
  #config; #exports; #clients = new Map(); #closed = false; #closing; #pending = new Set(); #disconnecting = new Set();
  #reads = new RetainedFileReads({ errorPrefix: 'EDR', maxSnapshotBytes: MAX_FILE_BYTES });
  constructor(config, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.#config = config.edrWorkspaces; this.#exports = config.exportsDirectory;
    this.environment = environment; this.fetchImpl = fetchImpl;
  }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      attachedClients: this.#clients.size, activeCalls: this.#pending.size, ...this.#reads.summary };
  }
  #entry(alias) {
    if (this.#disconnecting.has(alias)) throw failure('CLIENT_CLOSING', 'This original borrowed client is draining.');
    const entry = this.#config?.workspaces?.[alias];
    if (!entry) throw failure('WORKSPACE_NOT_FOUND', 'Choose a host-configured original EDR workspace alias.');
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new EdrClient(entry, { environment: this.environment, fetchImpl: this.fetchImpl }));
    return this.#clients.get(alias);
  }
  #inputs(alias) {
    return Object.entries(this.#entry(alias).inputs ?? {}).map(([input, value]) => ({
      input, label: value.label, kind: value.kind, sha256: value.sha256, name: basename(value.path) }));
  }
  async #call(name, args) {
    if (name === 'merchant_edr_workspaces') return { ...this.summary, workspaces: Object.entries(this.#config?.workspaces ?? {}).map(([workspace, entry]) => ({
      workspace, label: entry.label, inputs: this.#inputs(workspace) })) };
    const alias = args.workspace, entry = this.#entry(alias);
    if (name === 'merchant_edr_inputs') return { workspace: alias, inputs: this.#inputs(alias) };
    if (name === 'merchant_edr_input_inspect' || name === 'merchant_edr_import') {
      const input = entry.inputs?.[args.input];
      if (!input) throw failure('INPUT_NOT_FOUND', 'Choose the original host-pinned source or packet alias.');
      if (name === 'merchant_edr_import') {
        if (args.expectedSha256 !== input.sha256) throw failure('INPUT_CHANGED', 'Use the complete configured source or packet digest.');
        return this.#client(alias).upload(input);
      }
      const bytes = await readHostFile(input.path, input.kind === 'source' ? 256 * 1024 * 1024 : MAX_FILE_BYTES, { expectedSha256: input.sha256 });
      return { workspace: alias, input: args.input, kind: input.kind, name: basename(input.path), bytes: bytes.length, sha256: digest(bytes) };
    }
    if (name === 'merchant_edr_file_release') {
      await this.#reads.release(alias, args.readId); return { workspace: alias, readId: args.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_edr_disconnect') {
      this.#disconnecting.add(alias);
      try { await this.#clients.get(alias)?.close(); await this.#reads.closeScope(alias); this.#clients.delete(alias); }
      finally { this.#disconnecting.delete(alias); }
      return { workspace: alias, client: 'DISCONNECTED', operator: 'ORIGINAL_OWNER_RETAINED' };
    }
    const client = this.#client(alias);
    if (name === 'merchant_edr_status' || name === 'merchant_edr_records') {
      if (name === 'merchant_edr_status') { const state = await client.json('/api/state'); return { workspace: alias, schema: state.schema,
        counts: Object.fromEntries(Object.entries(state).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
        documentCount: state.documentCount, operationCount: state.operationCount, listCoverage: state.listCoverage,
        client: client.metadata, inputs: this.#inputs(alias), fileReads: this.#reads.status(alias) }; }
      const query = new URLSearchParams({ offset: String(args.offset ?? 0), limit: String(args.limit ?? 100),
        ...(args.expectedViewSha256 ? { expectedViewSha256: args.expectedViewSha256 } : {}) });
      return client.json('/api/records/' + pathId(args.collection) + '?' + query);
    }
    if (name === 'merchant_edr_connection_save') return client.json('/api/connections', args.connection);
    if (name === 'merchant_edr_connection') return client.json('/api/connections/' + args.id);
    if (name === 'merchant_edr_browse') return client.json('/api/browse', {
      connectionId: args.connectionId, resource: args.resource, params: args.params ?? [], operationId: args.operationId
    }, { operationId: args.operationId });
    if (name === 'merchant_edr_document') return client.json('/api/documents/' + args.id);
    if (name === 'merchant_edr_query_save') return client.json('/api/queries', args.query);
    if (name === 'merchant_edr_query') return client.json('/api/queries/' + args.id);
    if (name === 'merchant_edr_acquire') return client.json('/api/acquisitions', {
      queryId: args.queryId, operationId: args.operationId, ...(args.label === undefined ? {} : { label: args.label })
    }, { operationId: args.operationId });
    if (name === 'merchant_edr_operation') return client.json('/api/operations/' + pathId(args.operationId));
    if (name === 'merchant_edr_source') return client.json('/api/sources/' + args.sourceId);
    if (name === 'merchant_edr_source_files') return client.json('/api/sources/' + args.sourceId + '/files');
    if (name === 'merchant_edr_source_rows') return client.json('/api/sources/' + args.sourceId + '/rows?' + pageQuery(args));
    if (name === 'merchant_edr_mapping_propose') return client.json('/api/sources/' + args.sourceId + '/mapping', args.name === undefined ? {} : { name: args.name });
    if (name === 'merchant_edr_mapping_save') return client.json('/api/plans', args.mapping);
    if (name === 'merchant_edr_mapping') return client.json('/api/plans/' + args.id);
    if (name === 'merchant_edr_build') return client.json('/api/builds', { sourceId: args.sourceId, planId: args.planId });
    if (name === 'merchant_edr_build_read') return client.json('/api/builds/' + args.buildId);
    if (name === 'merchant_edr_native_query') {
      const params = args.params ?? {};
      if (!plain(params) || Object.values(params).some(value => typeof value !== 'string') || Buffer.byteLength(JSON.stringify(params)) > 32768)
        throw failure('QUERY_INVALID', 'Use complete original scalar string dataset query parameters.');
      return client.json('/api/builds/' + args.buildId + '/query?' + new URLSearchParams(params));
    }
    if (name === 'merchant_edr_compare') return client.json('/api/comparisons', { beforeId: args.beforeId, afterId: args.afterId });
    if (name === 'merchant_edr_changes') return client.json('/api/comparisons/' + args.comparisonId + '/changes?' + pageQuery(args));
    if (name === 'merchant_edr_file_read') {
      const selection = Object.fromEntries(Object.keys(fileFields).filter(k => args[k] !== undefined).map(k => [k, args[k]]));
      return this.#reads.read({ scope: alias, key: canonical(selection), kind: 'edr-' + args.kind, directory: this.#exports,
        load: () => client.file(selection, this.#exports, args.expectedSha256), expectedSha256: args.expectedSha256,
        readId: args.readId, offset: args.offset, limit: args.limit });
    }
    throw failure('METHOD_UNKNOWN', 'Unknown original EDR operator method.');
  }
  call(name, args = {}) {
    if (this.#closed) return Promise.reject(failure('MCP_CLOSING', 'The EDR client family is draining.'));
    const definition = definitions.get(name);
    if (!definition || !plain(args) || Object.keys(args).some(key => !Object.hasOwn(definition.properties, key)) ||
      definition.required.some(key => !Object.hasOwn(args, key)))
      return Promise.reject(failure('MCP_INPUT_INVALID', 'Supply only the declared fields and all required values.'));
    try { for (const [key, value] of Object.entries(args)) check(value, definition.properties[key], key); }
    catch (error) { return Promise.reject(error); }
    const pending = Promise.resolve().then(() => this.#call(name, args)).then(value => small(value)); this.#pending.add(pending);
    pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending)); return pending;
  }
  close() {
    if (!this.#closing) {
      this.#closed = true;
      this.#closing = (async () => { await Promise.allSettled([...this.#pending]); await Promise.all([...this.#clients.values()].map(client => client.close()));
        await this.#reads.close(); this.#clients.clear(); })().catch(error => { this.#closing = null; throw error; });
    }
    return this.#closing;
  }
}
