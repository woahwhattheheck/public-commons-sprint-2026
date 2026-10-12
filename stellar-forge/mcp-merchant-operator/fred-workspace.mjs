// MIT. Complete agent workflow on the original FRED economic-edition host.
import { basename } from 'node:path';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { FredWorkspaceClient, FredWorkspaceError, readFredWorkspaceConfiguration, readFredHostFile,
  canonicalFredJSON, fredDigest, FRED_WORKSPACE_CONNECTION_SCHEMA, FRED_CLIENT_MAX_BYTES } from './fred-workspace-client.mjs';
import { fredWorkspaceTools, fredFileSelection } from './catalog/fred-workspace.mjs';
export { readFredWorkspaceConfiguration, FRED_WORKSPACE_CONNECTION_SCHEMA };
export { fredWorkspaceTools } from './catalog/fred-workspace.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, details) => { throw new FredWorkspaceError(code, message, details); };
const definitions = new Map(fredWorkspaceTools((name, description, properties, required) =>
  ({ name, description, properties, required })).map(value => [value.name, value]));
function check(value, schema, key) {
  if (schema.type === 'string' && (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)))
    fail('FRED_MCP_INPUT_INVALID', 'Supply the declared ' + key + '.');
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)))
    fail('FRED_MCP_INPUT_INVALID', 'Supply a supported integer ' + key + '.');
  if (schema.type === 'object' && !plain(value)) fail('FRED_MCP_INPUT_INVALID', 'Supply a complete JSON object for ' + key + '.');
  if (schema.enum && !schema.enum.includes(value)) fail('FRED_MCP_INPUT_INVALID', 'Choose a declared ' + key + '.');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100000) ||
        schema.uniqueItems && new Set(value.map(canonicalFredJSON)).size !== value.length)
      fail('FRED_MCP_INPUT_INVALID', 'Supply the complete declared ' + key + ' list.');
    value.forEach(item => check(item, schema.items, key));
  }
}
function page(values, { offset = 0, limit = 50 } = {}) {
  if (!Array.isArray(values) || offset > values.length) fail('FRED_MCP_PAGE_INVALID', 'Choose an offset in the original collection.');
  const items = values.slice(offset, offset + limit);
  return { total: values.length, offset, returned: items.length, nextOffset: offset + items.length < values.length ? offset + items.length : null, items };
}
function small(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    fail('FRED_MCP_VIEW_TOO_LARGE', 'Use a smaller original record page or the complete corresponding source/customer/project file.');
  return value;
}
function purchaseView(result) {
  const { page: originalPage, ...rest } = result;
  if (!originalPage) return rest;
  return { ...rest, delivery: { format: 'ORIGINAL_DATASET_PAGE', completeBytes: result.bytes, sha256: result.sha256,
    snapshot: result.metadata?.snapshot ?? originalPage.snapshot ?? null,
    nextCursor: result.metadata?.nextCursor ?? originalPage.nextCursor ?? null,
    originalPageKeys: Object.keys(originalPage),
    download: 'merchant_fred_file_read with kind customer and the same publicationId/intentId' } };
}
function projectSummary(project) {
  const { captures, reviews, publications, operations, ...state } = project;
  return { ...state, counts: { captures: captures.length, reviews: reviews.length, publications: publications.length, operations: operations.length } };
}
const actionMethods = new Map([
  ['merchant_fred_configure', 'configure'], ['merchant_fred_capture', 'capture'], ['merchant_fred_combine', 'combine'],
  ['merchant_fred_select', 'select'], ['merchant_fred_review', 'review'], ['merchant_fred_abandon', 'abandon'],
  ['merchant_fred_merchant_start', 'startMerchant'], ['merchant_fred_merchant_stop', 'stopMerchant'],
  ['merchant_fred_preview', 'preview'], ['merchant_fred_prepare', 'prepare']
]);

export class MerchantFredWorkspaces {
  #config; #exports; #clients = new Map(); #closed = false;
  #reads = new RetainedFileReads({ errorPrefix: 'FRED', maxSnapshotBytes: FRED_CLIENT_MAX_BYTES });
  constructor(config, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.#config = config.fredWorkspaces; this.#exports = config.exportsDirectory;
    this.environment = environment; this.fetchImpl = fetchImpl;
  }
  get summary() {
    return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}),
      attachedClients: this.#clients.size, ...this.#reads.summary };
  }
  #entry(alias) {
    if (this.#closed) fail('FRED_MCP_CLOSED', 'The original FRED adapter is closing.');
    const entry = this.#config?.workspaces?.[alias];
    if (!entry) fail('FRED_MCP_WORKSPACE_NOT_FOUND', 'Choose an original host-configured economic workspace alias.');
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new FredWorkspaceClient(entry, { environment: this.environment, fetchImpl: this.fetchImpl }));
    return this.#clients.get(alias);
  }
  #inputs(alias) {
    const entry = this.#entry(alias);
    return { workspace: alias,
      inputs: Object.entries(entry.inputs ?? {}).map(([input, value]) => ({ input, label: value.label, kind: value.kind,
        ...(value.sha256 ? { configuredSha256: value.sha256 } : {}) })),
      merchantProfiles: Object.entries(entry.merchantProfiles ?? {}).map(([profile, value]) => ({ profile, ...value })) };
  }
  async #input(alias, name, expectedSha256) {
    const input = this.#entry(alias).inputs?.[name];
    if (!input) fail('FRED_MCP_INPUT_NOT_FOUND', 'Choose an original host input alias.');
    const bytes = await readFredHostFile(input.path, 64 * 1024 * 1024, { expectedSha256: expectedSha256 ?? input.sha256 });
    const sha256 = fredDigest(bytes);
    if (input.sha256 && input.sha256 !== sha256) fail('FRED_MCP_INPUT_CHANGED', 'The original source differs from its configured SHA256.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('FRED_MCP_INPUT_INVALID', 'The original source input must contain complete JSON.'); }
    if (input.kind === 'public-table' && !['commons.retained-public-table.v1', 'commons.retained-public-table-set.v1'].includes(value?.version) ||
        input.kind === 'capture' && !['stellar-forge.fred-capture.v1', 'stellar-forge.fred-public-table-capture.v1',
          'stellar-forge.fred-public-table-set-capture.v1'].includes(value?.schema))
      fail('FRED_MCP_INPUT_INVALID', 'The complete input does not have its declared original source format.');
    return { input, bytes, sha256, value };
  }
  async #state(alias, expectedRevision) {
    const value = await this.#client(alias).state();
    if (expectedRevision !== undefined && value.project.revision !== expectedRevision)
      fail('FRED_MCP_REVISION_CHANGED', 'The original project changed. Continue from its current revision.', { revision: value.project.revision });
    return value;
  }
  async #call(name, args) {
    if (name === 'merchant_fred_workspaces') return { ...this.summary,
      workspaces: Object.entries(this.#config?.workspaces ?? {}).map(([workspace, value]) => ({
        workspace, label: value.label, projectId: value.projectId ?? null, ...this.#inputs(workspace) })) };
    const alias = args.workspace;
    this.#entry(alias);
    if (name === 'merchant_fred_inputs') return this.#inputs(alias);
    if (name === 'merchant_fred_input_inspect') {
      const source = await this.#input(alias, args.input), original = source.value;
      return { workspace: alias, input: args.input, kind: source.input.kind, name: basename(source.input.path),
        bytes: source.bytes.length, sha256: source.sha256, schema: original.schema ?? original.version,
        sourceUrl: original.source_url ?? null, retrievedAt: original.retrieved_at ?? null,
        seriesId: original.series_id ?? null, observationCount: original.observation_count ?? null,
        originalTableBytes: original.bytes ?? null, originalTableSha256: original.sha256 ?? null,
        captureSha256: original.captureSha256 ?? null, selection: original.selection ?? null,
        tables: Array.isArray(original.tables) ? original.tables.map(table => ({ seriesId: table.series_id,
          sourceUrl: table.source_url, retrievedAt: table.retrieved_at, bytes: table.bytes, sha256: table.sha256 })) : undefined };
    }
    if (name === 'merchant_fred_file_release') {
      await this.#reads.release(alias, args.readId); return { workspace: alias, readId: args.readId, state: 'RELEASED' };
    }
    if (name === 'merchant_fred_disconnect') {
      this.#clients.get(alias)?.close(); this.#clients.delete(alias); await this.#reads.closeScope(alias);
      return { workspace: alias, client: 'DISCONNECTED' };
    }
    const client = this.#client(alias);
    if (name === 'merchant_fred_status') {
      const result = await this.#state(alias);
      return { workspace: alias, project: projectSummary(result.project), merchant: result.merchant,
        busy: result.busy, buyerConfigured: result.buyerConfigured, client: client.metadata,
        fileReads: this.#reads.status(alias), ...this.#inputs(alias) };
    }
    if (name === 'merchant_fred_records' || name === 'merchant_fred_record') {
      const { project } = await this.#state(alias, args.expectedRevision);
      const values = project[args.kind];
      if (name === 'merchant_fred_records') return { projectId: project.id, revision: project.revision, kind: args.kind, ...page(values, args) };
      const record = values.find(item => item.id === args.id);
      if (!record) fail('FRED_MCP_RECORD_NOT_FOUND', 'The selected record does not belong to this original project.');
      return { projectId: project.id, revision: project.revision, kind: args.kind, record };
    }
    if (name === 'merchant_fred_operation') return client.operation(args.id);
    if (name === 'merchant_fred_observations') return client.observations(args);
    if (name === 'merchant_fred_compare') return client.compare(args);
    if (name === 'merchant_fred_import') {
      const source = await this.#input(alias, args.input, args.expectedSha256);
      return client.importCapture({ id: args.id, expectedRevision: args.expectedRevision, capture: source.value });
    }
    if (name === 'merchant_fred_publish') {
      const profile = this.#entry(alias).merchantProfiles?.[args.profile];
      if (!profile) fail('FRED_MCP_PROFILE_NOT_FOUND', 'Choose a configured original merchant/payment profile.');
      return client.publish({ id: args.id, expectedRevision: args.expectedRevision, reviewId: args.reviewId,
        origin: profile.origin, path: profile.path, payment: profile.payment });
    }
    if (name === 'merchant_fred_publication' || name === 'merchant_fred_requests') {
      const result = await client.publication(args.publicationId);
      if (name === 'merchant_fred_publication') {
        const { requests, ...publication } = result; return { ...publication, preparedRequests: requests.length };
      }
      const viewSha256 = fredDigest(Buffer.from(canonicalFredJSON(result.requests)));
      if (args.expectedViewSha256 && args.expectedViewSha256 !== viewSha256)
        fail('FRED_MCP_VIEW_CHANGED', 'The original request inventory changed. Read it again from offset zero.', { viewSha256 });
      return { publicationId: args.publicationId, viewSha256, ...page(result.requests, args) };
    }
    if (name === 'merchant_fred_buy') return purchaseView(await client.buy(args));
    if (name === 'merchant_fred_recover') return purchaseView(await client.recover(args));
    if (name === 'merchant_fred_file_read') {
      const selection = Object.fromEntries(Object.keys(fredFileSelection).filter(key => args[key] !== undefined).map(key => [key, args[key]]));
      return this.#reads.read({ scope: alias, key: canonicalFredJSON(selection), kind: 'fred-' + args.kind, directory: this.#exports,
        load: () => client.file(selection, { expectedSha256: args.expectedSha256 }), expectedSha256: args.expectedSha256,
        readId: args.readId, offset: args.offset, limit: args.limit });
    }
    if (actionMethods.has(name)) {
      const { workspace: _, ...input } = args;
      return client[actionMethods.get(name)](input);
    }
    fail('FRED_MCP_METHOD_UNKNOWN', 'Unknown original economic-workspace method.');
  }
  async call(name, args = {}) {
    const definition = definitions.get(name);
    if (!definition || !plain(args) || Object.keys(args).some(key => !Object.hasOwn(definition.properties, key)) ||
        definition.required.some(key => !Object.hasOwn(args, key)))
      fail('FRED_MCP_INPUT_INVALID', 'Supply the declared fields and all required values.');
    for (const [key, value] of Object.entries(args)) check(value, definition.properties[key], key);
    return small(await this.#call(name, args));
  }
  async close() {
    this.#closed = true;
    for (const client of this.#clients.values()) client.close();
    this.#clients.clear(); await this.#reads.close();
  }
}
