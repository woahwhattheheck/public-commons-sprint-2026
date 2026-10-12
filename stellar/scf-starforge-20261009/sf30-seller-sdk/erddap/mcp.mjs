// MIT. Complete MCP workflow on the existing ERDDAP HTTP owner.
import { basename } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { ErddapClient, readHostFile, readErddapConfiguration, CONNECTION_SCHEMA, MAX_FILE_BYTES, canonical, digest, failure } from './mcp-client.mjs';
import { erddapTools, fileFields } from './mcp-catalog.mjs';
import { ErddapProviderHandoffClient } from './provider-handoff-client.mjs';
export { readErddapConfiguration, CONNECTION_SCHEMA, erddapTools };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const definitions = new Map(erddapTools((name, description, properties, required) => ({ name, description, properties, required })).map(t => [t.name, t]));
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
  if (schema.enum && !schema.enum.includes(value)) throw failure('MCP_INPUT_INVALID', 'Choose a declared ' + key + '.');
}
function small(value, maximum = 1024 * 1024) {
  if (Buffer.byteLength(JSON.stringify(value)) > maximum)
    throw failure('VIEW_TOO_LARGE', 'Use a smaller original record/row page or download the complete source member or customer packet.');
  return value;
}
const pathId = value => encodeURIComponent(value);
const pageQuery = args => new URLSearchParams({ offset: String(args.offset ?? 0), limit: String(args.limit ?? 100) }).toString();
export class MerchantErddapWorkspaces {
  #config; #exports; #clients = new Map(); #closed = false; #closing; #pending = new Set(); #disconnecting = new Set();
  #reads = new RetainedFileReads({ errorPrefix: 'ERDDAP', maxSnapshotBytes: MAX_FILE_BYTES });
  constructor(config, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.#config = config.erddapWorkspaces; this.#exports = config.exportsDirectory;
    this.environment = environment; this.fetchImpl = fetchImpl;
  }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      attachedClients: this.#clients.size, activeCalls: this.#pending.size, ...this.#reads.summary };
  }
  #entry(alias) {
    if (this.#disconnecting.has(alias)) throw failure('CLIENT_CLOSING', 'This original borrowed client is draining.');
    const entry = this.#config?.workspaces?.[alias];
    if (!entry) throw failure('WORKSPACE_NOT_FOUND', 'Choose a host-configured original ERDDAP workspace alias.');
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new ErddapClient(entry, { environment: this.environment, fetchImpl: this.fetchImpl }));
    return this.#clients.get(alias);
  }
  #inputs(alias) {
    return Object.entries(this.#entry(alias).inputs ?? {}).map(([input, value]) => ({
      input, label: value.label, kind: value.kind, sha256: value.sha256, name: basename(value.path) }));
  }
  async #call(name, args) {
    if (name === 'merchant_erddap_workspaces') return { ...this.summary, workspaces: Object.entries(this.#config?.workspaces ?? {}).map(([workspace, entry]) => ({
      workspace, label: entry.label, inputs: this.#inputs(workspace) })) };
    const alias = args.workspace, entry = this.#entry(alias);
    if (name === 'merchant_erddap_inputs') return { workspace: alias, inputs: this.#inputs(alias) };
    if (name === 'merchant_erddap_input_inspect' || name === 'merchant_erddap_import') {
      const input = entry.inputs?.[args.input];
      if (!input) throw failure('INPUT_NOT_FOUND', 'Choose the original host-pinned source or packet alias.');
      if (name === 'merchant_erddap_import') {
        if (args.expectedSha256 !== input.sha256) throw failure('INPUT_CHANGED', 'Use the complete configured source or packet digest.');
        return this.#client(alias).upload(input);
      }
      const bytes = await readHostFile(input.path, input.kind === 'source' ? 256 * 1024 * 1024 : MAX_FILE_BYTES, { expectedSha256: input.sha256 });
      return { workspace: alias, input: args.input, kind: input.kind, name: basename(input.path), bytes: bytes.length, sha256: digest(bytes) };
    }
    if (name === 'merchant_erddap_file_release') {
      await this.#reads.release(alias, args.readId); return { workspace: alias, readId: args.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_erddap_disconnect') {
      this.#disconnecting.add(alias);
      try { await this.#clients.get(alias)?.close(); await this.#reads.closeScope(alias); this.#clients.delete(alias); }
      finally { this.#disconnecting.delete(alias); }
      return { workspace: alias, client: 'DISCONNECTED', operator: 'ORIGINAL_OWNER_RETAINED' };
    }
    const client = this.#client(alias);
    if (name === 'merchant_erddap_status' || name === 'merchant_erddap_records') {
      const state = await client.json('/api/state');
      if (name === 'merchant_erddap_status') return { workspace: alias, schema: state.schema,
        counts: Object.fromEntries(Object.entries(state).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
        client: client.metadata, inputs: this.#inputs(alias), fileReads: this.#reads.status(alias) };
      const values = state[args.collection];
      if (!Array.isArray(values)) throw failure('COLLECTION_INVALID', 'The original collection is unavailable.');
      const viewSha256 = digest(Buffer.from(canonical(values))), offset = args.offset ?? 0, limit = args.limit ?? 50;
      if (offset > values.length || offset > 0 && !args.expectedViewSha256 ||
        args.expectedViewSha256 && args.expectedViewSha256 !== viewSha256)
        throw failure('COLLECTION_CHANGED', 'Continue the original complete collection with its current view SHA256, starting at offset zero after a change.',
          { viewSha256, total: values.length });
      const items = values.slice(offset, offset + limit);
      return { workspace: alias, collection: args.collection, viewSha256, total: values.length, offset,
        returned: items.length, nextOffset: offset + items.length < values.length ? offset + items.length : null, items };
    }
    if (name.startsWith('merchant_erddap_provider_')) {
      const handoffs = new ErddapProviderHandoffClient(client);
      if (name === 'merchant_erddap_provider_status' || name === 'merchant_erddap_provider_records') {
        const state = await handoffs.state();
        if (name === 'merchant_erddap_provider_status') return {workspace: alias, schema: state.schema, limits: state.limits,
          heads: state.heads.length, received: state.received.length, client: client.metadata};
        const values = state[args.collection];
        if (!Array.isArray(values)) throw failure('COLLECTION_INVALID', 'The original provider collection is unavailable.');
        const viewSha256 = digest(Buffer.from(canonical(values))), offset = args.offset ?? 0, limit = args.limit ?? 50;
        if (offset > values.length || offset > 0 && !args.expectedViewSha256 ||
          args.expectedViewSha256 && args.expectedViewSha256 !== viewSha256)
          throw failure('COLLECTION_CHANGED', 'Continue the exact original provider collection with its current view SHA256.',
            {viewSha256, total: values.length});
        const items = values.slice(offset, offset + limit);
        return {workspace: alias, collection: args.collection, viewSha256, total: values.length, offset,
          returned: items.length, nextOffset: offset + items.length < values.length ? offset + items.length : null, items};
      }
      if (name === 'merchant_erddap_provider_draft') return handoffs.draft(args.sourceId);
      if (name === 'merchant_erddap_provider_preview') return handoffs.preview(args.sourceId, args.profile);
      if (name === 'merchant_erddap_provider_save') return handoffs.save(args.sourceId, args.profile, args.expectedHead);
      if (name === 'merchant_erddap_provider_review') return handoffs.review(args.revision);
      if (name === 'merchant_erddap_provider_history') return handoffs.history(args.sourceId, args);
      if (name === 'merchant_erddap_provider_export') return handoffs.export(args.revision, args.mode);
      if (name === 'merchant_erddap_provider_received') return handoffs.received(args.receiptId);
      if (name === 'merchant_erddap_provider_receive') {
        const input = entry.inputs?.[args.input];
        if (input?.kind !== 'handoff' || input.sha256 !== args.expectedSha256)
          throw failure('PROVIDER_INPUT_REQUIRED', 'Choose the complete configured provider handoff and its exact SHA256.');
        return handoffs.receive(input);
      }
    }
    if (name === 'merchant_erddap_search') return client.json('/api/search', { server: args.server, text: args.text ?? '', page: args.page ?? 1, limit: args.limit ?? 50 });
    if (name === 'merchant_erddap_metadata_load') return client.json('/api/metadata', { server: args.server, datasetId: args.datasetId, protocol: args.protocol });
    if (name === 'merchant_erddap_metadata') return client.json('/api/metadata/' + args.id);
    if (name === 'merchant_erddap_query_save') {
      const { workspace: _, ...body } = args; return client.json('/api/queries', body);
    }
    if (name === 'merchant_erddap_query') return client.json('/api/queries/' + args.id);
    if (name === 'merchant_erddap_acquire') return client.json('/api/queries/' + args.queryId + '/acquire',
      { operationId: args.operationId, ...(args.label === undefined ? {} : { label: args.label }) }, { operationId: args.operationId });
    if (name === 'merchant_erddap_operation') return client.json('/api/operations/' + pathId(args.operationId));
    if (name === 'merchant_erddap_source') return client.json('/api/sources/' + args.sourceId);
    if (name === 'merchant_erddap_source_rows') return client.json('/api/sources/' + args.sourceId + '/rows?' + pageQuery(args));
    if (name === 'merchant_erddap_mapping_propose') return client.json('/api/sources/' + args.sourceId + '/mapping', args.name === undefined ? {} : { name: args.name });
    if (name === 'merchant_erddap_mapping_save') return client.json('/api/plans', args.mapping);
    if (name === 'merchant_erddap_mapping') return client.json('/api/plans/' + args.id);
    if (name === 'merchant_erddap_build') return client.json('/api/builds', { sourceId: args.sourceId, planId: args.planId });
    if (name === 'merchant_erddap_build_read') return client.json('/api/builds/' + args.buildId);
    if (name === 'merchant_erddap_native_query') {
      const params = args.params ?? {};
      if (!plain(params) || Object.values(params).some(value => typeof value !== 'string') || Buffer.byteLength(JSON.stringify(params)) > 32768)
        throw failure('QUERY_INVALID', 'Use complete original scalar string dataset query parameters.');
      return client.json('/api/builds/' + args.buildId + '/query?' + new URLSearchParams(params));
    }
    if (name === 'merchant_erddap_compare') return client.json('/api/comparisons', { beforeId: args.beforeId, afterId: args.afterId });
    if (name === 'merchant_erddap_changes') return client.json('/api/comparisons/' + args.comparisonId + '/changes?' + pageQuery(args));
    if (name === 'merchant_erddap_file_read') {
      const selection = Object.fromEntries(Object.keys(fileFields).filter(k => args[k] !== undefined).map(k => [k, args[k]]));
      return this.#reads.read({ scope: alias, key: canonical(selection), kind: 'erddap-' + args.kind, directory: this.#exports,
        load: () => client.file(selection, this.#exports, args.expectedSha256), expectedSha256: args.expectedSha256,
        readId: args.readId, offset: args.offset, limit: args.limit });
    }
    throw failure('METHOD_UNKNOWN', 'Unknown original ERDDAP operator method.');
  }
  call(name, args = {}) {
    if (this.#closed) return Promise.reject(failure('MCP_CLOSING', 'The ERDDAP client family is draining.'));
    const definition = definitions.get(name);
    if (!definition || !plain(args) || Object.keys(args).some(key => !Object.hasOwn(definition.properties, key)) ||
      definition.required.some(key => !Object.hasOwn(args, key)))
      return Promise.reject(failure('MCP_INPUT_INVALID', 'Supply only the declared fields and all required values.'));
    try { for (const [key, value] of Object.entries(args)) check(value, definition.properties[key], key); }
    catch (error) { return Promise.reject(error); }
    const pending = Promise.resolve().then(() => this.#call(name, args)).then(value => small(value,
      name.startsWith('merchant_erddap_provider_') ? 4 * 1024 * 1024 : 1024 * 1024)); this.#pending.add(pending);
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
