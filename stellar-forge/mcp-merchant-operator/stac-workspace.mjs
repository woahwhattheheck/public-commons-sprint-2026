// MIT. Complete agent workflow on the ORIGINAL STAC imagery/processing host.
import { basename } from 'node:path';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { STAC_PRESCIENT_ACTIONS } from './stac-prescient-contract.mjs';
import { StacWorkspaceClient, StacWorkspaceError, STAC_WORKSPACE_CONNECTION_SCHEMA,
  readStacWorkspaceConfiguration, readStacHostFile, canonicalStacJSON, nativeStacItemId, stacDigest } from './stac-workspace-client.mjs';

export { readStacWorkspaceConfiguration, STAC_WORKSPACE_CONNECTION_SCHEMA };
const fail = (code, message, details) => { throw new StacWorkspaceError(code, message, details); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
import { stacWorkspaceTools, fileSelection } from './catalog/stac-workspace.mjs';
export { stacWorkspaceTools } from './catalog/stac-workspace.mjs';
const definitions = new Map(stacWorkspaceTools((name, _description, properties, required) => ({ name, properties, required })).map(d => [d.name, d]));
function check(value, schema, key) {
  if (schema.type === 'string' && (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength ||
      schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)))
    fail('STAC_MCP_INPUT_INVALID', 'Supply the declared ' + key + '.');
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)))
    fail('STAC_MCP_INPUT_INVALID', 'Supply a supported integer ' + key + '.');
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail('STAC_MCP_INPUT_INVALID', 'Supply a boolean ' + key + '.');
  if (schema.type === 'object' && !plain(value)) fail('STAC_MCP_INPUT_INVALID', 'Supply a JSON object ' + key + '.');
  if (schema.enum && !schema.enum.includes(value)) fail('STAC_MCP_INPUT_INVALID', 'Choose a declared ' + key + '.');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100000) ||
        schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length)
      fail('STAC_MCP_INPUT_INVALID', 'Supply the complete declared ' + key + ' list.');
    value.forEach(v => check(v, schema.items, key));
  }
}
const viewHash = value => stacDigest(Buffer.from(canonicalStacJSON(value)));
function pinView(value, expected) {
  const actual = viewHash(value);
  if (expected && actual !== expected) fail('STAC_MCP_VIEW_CHANGED', 'This original view changed. Start the same collection again at offset 0.', { viewSha256: actual });
  return actual;
}
function slice(values, { offset = 0, limit = 50 } = {}) {
  if (!Array.isArray(values)) fail('STAC_MCP_ARRAY_REQUIRED', 'Choose an actual array in the native view.');
  if (offset > values.length) fail('STAC_MCP_OFFSET_INVALID', 'The offset is past this original view.');
  const items = values.slice(offset, offset + limit);
  return { total: values.length, offset, returned: items.length, nextOffset: offset + items.length < values.length ? offset + items.length : null, items };
}
function small(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    fail('STAC_MCP_VIEW_TOO_LARGE', 'The original view exceeds one tool response. Use a smaller page or the complete corresponding JSON through file_read.');
  return value;
}
const counts = value => Object.fromEntries(Object.entries(value).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,v.length]));
function summarize(value) {
  const out = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (Array.isArray(item)) continue;
    if (key === 'operations') { out.operationCount = Object.keys(item ?? {}).length; continue; }
    if (key === 'catalog') { out.catalog = item ? { id: item.id, type: item.type, title: item.title, stac_version: item.stac_version } : null; continue; }
    out[key] = item;
  }
  return { ...out, counts: counts(value) };
}
function selectArray(value, path) {
  let found = value;
  for (const key of path ?? []) {
    if (!plain(found) || !Object.hasOwn(found, key)) fail('STAC_MCP_PATH_INVALID', 'Choose an own-property array path in the original processing view.');
    found = found[key];
  }
  return found;
}
export class MerchantStacWorkspaces {
  #config; #exports; #clients = new Map(); #reads = new RetainedFileReads({ errorPrefix: 'STAC' }); #closed = false;
  constructor(config, { environment = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.#config = config.stacWorkspaces; this.#exports = config.exportsDirectory;
    this.environment = environment; this.fetchImpl = fetchImpl;
  }
  get summary() { return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}), attachedClients: this.#clients.size, ...this.#reads.summary }; }
  #entry(alias) {
    if (this.#closed) fail('STAC_MCP_CLOSED', 'The STAC client adapter is closing.');
    const entry = this.#config?.workspaces?.[alias];
    if (!entry) fail('STAC_MCP_WORKSPACE_NOT_FOUND', 'Choose an original host-configured STAC workspace alias.');
    return entry;
  }
  #client(alias) {
    const entry = this.#entry(alias);
    if (!this.#clients.has(alias)) this.#clients.set(alias, new StacWorkspaceClient(entry, { environment: this.environment, fetchImpl: this.fetchImpl }));
    return this.#clients.get(alias);
  }
  #inputs(alias) {
    const entry = this.#entry(alias);
    return { workspace: alias, inputs: Object.entries(entry.inputs ?? {}).map(([input, value]) =>
      ({ input, kind: value.kind, label: value.label, ...(value.sha256 ? { configuredSha256: value.sha256 } : {}) })),
      processingProfiles: Object.entries(entry.processingProfiles ?? {}).map(([profile, value]) => ({ profile, label: value.label, sourceInput: value.sourceInput })),
      prescientDeliveries: Object.entries(entry.prescientDeliveries ?? {}).map(([delivery, value]) =>
        ({ delivery, label: value.label, ...(value.manifestSha256 ? { configuredManifestSha256: value.manifestSha256 } : {}) })) };
  }
  async #input(alias, name, expectedSha256) {
    const value = this.#entry(alias).inputs?.[name];
    if (!value) fail('STAC_MCP_INPUT_NOT_FOUND', 'Choose an original host input alias.');
    const bytes = await readStacHostFile(value.path, 128 * 1024 * 1024, { expectedSha256: expectedSha256 ?? value.sha256 });
    const hash = stacDigest(bytes);
    if (value.sha256 && hash !== value.sha256) fail('STAC_MCP_INPUT_CHANGED', 'This input differs from its host-configured source digest.');
    return { definition: value, bytes, sha256: hash };
  }
  async #nativeState(alias, expectedRevision) {
    const result = await this.#client(alias).state();
    if (expectedRevision !== undefined && result.workspace.revision !== expectedRevision)
      fail('STAC_WORKSPACE_REVISION_CHANGED', 'The original workspace revision changed. Start paging from the current revision.', { revision: result.workspace.revision });
    return result;
  }
  async #prescientState(alias, expectedRevision) {
    const value = await this.#client(alias).prescientState();
    if (expectedRevision !== undefined && value.configuration.revision !== expectedRevision)
      fail('PRESCIENT_CONFIGURATION_REVISION_CHANGED', 'The original configuration changed. Start paging from its current configuration revision.',
        { revision: value.configuration.revision });
    return value;
  }
  async #prescientAction(alias, args) {
    const definition = STAC_PRESCIENT_ACTIONS[args.name];
    const input = args.input;
    if (!definition || !plain(input) || Object.keys(input).some(key => key === 'directory' || !definition.fields.includes(key)))
      fail('STAC_MCP_INPUT_INVALID', 'Supply only this native action’s input fields. Directories are selected through a host delivery alias.');
    let selected = { ...input };
    if (definition.delivery) {
      const delivery = this.#entry(alias).prescientDeliveries?.[args.delivery];
      if (!args.delivery || !delivery) fail('STAC_MCP_DELIVERY_NOT_FOUND', 'Choose one original host-configured Prescient delivery alias.');
      if (args.name === 'delivery-open' && delivery.manifestSha256 && delivery.manifestSha256 !== input.manifestSha256)
        fail('STAC_MCP_DELIVERY_CHANGED', 'The requested receiving manifest differs from the host-configured manifest SHA256.');
      selected.directory = delivery.directory;
    } else if (args.delivery !== undefined) {
      fail('STAC_MCP_INPUT_INVALID', 'A delivery alias applies only to delivery-review or delivery-open.');
    }
    return this.#client(alias).prescientAction(args.name, { ...selected,
      actor: args.actor, operationId: args.operationId, expectedRevision: args.expectedRevision });
  }
  async #operation(alias, operationId) {
    const client = this.#client(alias), state = await client.state(); let recentJob = null;
    try { recentJob = await client.job(operationId); } catch (error) { if (error.code !== 'JOB_NOT_FOUND') throw error; }
    let processing = null;
    if (state.capabilities?.processing?.enabled) {
      const view = await client.processingState();
      const matches = Object.entries(view.operations ?? {}).filter(([key]) => key === operationId || key.endsWith(':' + operationId));
      processing = Object.fromEntries(matches);
    }
    let prescient = null;
    if (state.capabilities?.prescient?.enabled) {
      const view = await client.prescientState();
      prescient = { revision: view.configuration.revision, operation: view.configuration.operations?.[operationId] ?? null };
    }
    return { workspaceId: state.workspace.id, operationId, revision: state.workspace.revision,
      operation: state.workspace.operations?.[operationId] ?? null, recentJob, processing, prescient,
      recentJobRetention: 'ORIGINAL_SERVER_MEMORY; durable workspace records remain authoritative after restart' };
  }
  async #call(name, args) {
    if (name === 'merchant_stac_workspaces') return { ...this.summary, workspaces: Object.entries(this.#config?.workspaces ?? {}).map(([workspace, entry]) =>
      ({ workspace, label: entry.label, workspaceId: entry.workspaceId ?? null, ...this.#inputs(workspace) })) };
    const alias = args.workspace, entry = this.#entry(alias);
    if (name === 'merchant_stac_inputs') return this.#inputs(alias);
    if (name === 'merchant_stac_input_inspect') {
      const input = await this.#input(alias, args.input);
      let json = null; try { json = JSON.parse(input.bytes.toString('utf8')); } catch {}
      return { workspace: alias, input: args.input, kind: input.definition.kind, filename: basename(input.definition.path),
        bytes: input.bytes.length, sha256: input.sha256, schema: json?.schema ?? null, nativeDigest: json?.digest ?? null,
        sourceWorkspaceId: json?.sourceWorkspaceId ?? null };
    }
    if (name === 'merchant_stac_file_release') return this.#reads.release(alias, args.readId);
    if (name === 'merchant_stac_disconnect') {
      this.#clients.get(alias)?.close(); this.#clients.delete(alias); await this.#reads.closeScope(alias);
      return { workspace: alias, client: 'DISCONNECTED', originalHost: 'UNCHANGED' };
    }
    const client = this.#client(alias);
    if (name === 'merchant_stac_status') {
      const state = await this.#nativeState(alias);
      return { workspace: alias, native: summarize(state.workspace), capabilities: state.capabilities, jobs: counts({ jobs: state.jobs }),
        client: client.metadata, fileReads: this.#reads.status(alias), ...this.#inputs(alias) };
    }
    if (name === 'merchant_stac_records' || name === 'merchant_stac_record') {
      const { workspace: native } = await this.#nativeState(alias, args.expectedRevision);
      let values = args.kind === 'operations' ? Object.entries(native.operations ?? {}).map(([operationId,value]) => ({ operationId, ...value })) : native[args.kind];
      if (name === 'merchant_stac_records') return { workspaceId: native.id, revision: native.revision, kind: args.kind, ...slice(values, args) };
      if (args.kind !== 'catalog') {
        if (!args.id) fail('STAC_MCP_RECORD_ID_REQUIRED', 'Choose one original record ID.');
        values = values?.find(v => (v.id ?? v.operationId ?? v.directory) === args.id);
      }
      if (values === undefined || values === null) fail('STAC_MCP_RECORD_NOT_FOUND', 'This record is not in the original workspace.');
      return { workspaceId: native.id, revision: native.revision, kind: args.kind, record: values };
    }
    if (['merchant_stac_edition', 'merchant_stac_items', 'merchant_stac_item'].includes(name)) {
      const detail = await client.edition(args.editionId), viewSha256 = pinView(detail, args.expectedViewSha256);
      if (name === 'merchant_stac_edition') return { edition: detail.edition, counts: counts(detail), viewSha256 };
      if (name === 'merchant_stac_items') return { editionId: detail.edition.id, viewSha256, ...slice(detail.items.map(item => ({ itemId: nativeStacItemId(item), item })), args) };
      const item = detail.items.find(item => nativeStacItemId(item) === args.itemId);
      if (!item) fail('STAC_MCP_ITEM_NOT_FOUND', 'The item is not in this original edition.');
      return { editionId: detail.edition.id, itemId: args.itemId, item, viewSha256,
        decisions: detail.decisions.filter(v => v.itemId === args.itemId), assets: detail.assets.filter(v => v.itemId === args.itemId) };
    }
    if (name === 'merchant_stac_compare') {
      const result = await client.compare(args), viewSha256 = pinView(result, args.expectedViewSha256);
      return { ...summarize(result), viewSha256, kind: args.kind, ...slice(result[args.kind], args) };
    }
    if (name === 'merchant_stac_operation') return this.#operation(alias, args.operationId);
    if (name === 'merchant_stac_discover') return client.discover(args);
    if (name === 'merchant_stac_query_save') return client.saveQuery({ ...args.query, expectedRevision: args.expectedRevision });
    if (name === 'merchant_stac_search_review') return client.reviewSearch(args);
    if (name === 'merchant_stac_search_acquire') return client.acquire(args);
    if (name === 'merchant_stac_search_resume') return client.resume(args);
    if (name === 'merchant_stac_search_cancel') return client.cancel(args);
    if (name === 'merchant_stac_asset_review') {
      const { workspace: _workspace, ...input } = args; return client.reviewAsset(input);
    }
    if (name === 'merchant_stac_asset_range') return client.assetRange(args.assetId, args);
    if (name === 'merchant_stac_asset_acquire') return client.acquireAsset(args);
    if (name === 'merchant_stac_decision_save') {
      const { workspace: _workspace, ...input } = args; return client.setDecision(input);
    }
    if (name === 'merchant_stac_input_import') {
      const source = await this.#input(alias, args.input, args.expectedSha256);
      if (source.definition.kind === 'imagery-handover') {
        let bundle; try { bundle = JSON.parse(source.bytes.toString('utf8')); } catch { fail('STAC_MCP_INPUT_INVALID', 'The original imagery handover must contain complete JSON.'); }
        return client.importHandover(bundle);
      }
      if (!args.operationId) fail('STAC_CLIENT_OPERATION_ID_REQUIRED', 'Supply the same original processing operationId.');
      if (source.definition.kind === 'processing-handover')
        return client.processingAction('import-handover', { operationId: args.operationId, input: { bodyBase64: source.bytes.toString('base64') } });
      if (source.definition.kind === 'processing-page') {
        if (!args.editionId || !args.taskId) fail('STAC_MCP_INPUT_INVALID', 'Choose the existing original edition and task for this exact provider page.');
        return client.processingAction('import-page', { operationId: args.operationId, input: { editionId: args.editionId, taskId: args.taskId,
          bodyBase64: source.bytes.toString('base64'), metadata: args.metadata ?? {} } });
      }
      fail('STAC_MCP_INPUT_KIND_INVALID', 'Configure the original processing-source through a host profile.');
    }
    if (name === 'merchant_stac_processing_status') return summarize(await client.processingState());
    if (name === 'merchant_stac_processing_read') {
      if (['source','handover'].includes(args.name)) fail('STAC_MCP_FILE_REQUIRED', 'Read the complete processing-source or processing-handover through file_read.');
      const value = await client.processingRead(args.name, args.query ?? {}), viewSha256 = pinView(value, args.expectedViewSha256);
      if (args.path !== undefined || Array.isArray(value)) return { name: args.name, viewSha256, path: args.path ?? [], ...slice(selectArray(value, args.path), args) };
      if (args.offset !== undefined || args.limit !== undefined) fail('STAC_MCP_ARRAY_REQUIRED', 'Choose path to the original array before paging this object.');
      return { name: args.name, viewSha256, value };
    }
    if (name === 'merchant_stac_processing_configure') {
      const profile = entry.processingProfiles?.[args.profile];
      if (!profile) fail('STAC_MCP_PROFILE_NOT_FOUND', 'Choose an original host-declared processing profile.');
      const source = await this.#input(alias, profile.sourceInput, args.expectedSha256);
      return client.processingAction('configure', { operationId: args.operationId, input: { deployment: profile.deployment,
        sourceBase64: source.bytes.toString('base64'), sourceMetadata: profile.sourceMetadata ?? {}, expectedRevision: args.expectedRevision } });
    }
    if (name === 'merchant_stac_processing_action') {
      if (['configure', 'configure-retained', 'import-handover', 'import-page'].includes(args.name))
        fail('STAC_MCP_HOST_INPUT_REQUIRED', 'Use the host-profile configure or complete input_import tool for this native action.');
      return client.processingAction(args.name, { input: args.input, operationId: args.operationId });
    }
    if (name === 'merchant_stac_prescient_status') {
      const view = await this.#prescientState(alias);
      return { workspaceId: view.workspaceId, configuration: summarize(view.configuration),
        selectedProfileSha256: view.selectedProfileSha256, selectedProfile: view.selectedProfile,
        bindingChoices: view.bindingChoices, connection: view.connection, receivingProgress: view.receivingProgress,
        sdk: view.sdk, actions: Object.keys(STAC_PRESCIENT_ACTIONS), ...this.#inputs(alias) };
    }
    if (name === 'merchant_stac_prescient_records' || name === 'merchant_stac_prescient_record') {
      if (name.endsWith('_records') && (args.offset ?? 0) > 0 && args.expectedRevision === undefined)
        fail('STAC_MCP_REVISION_REQUIRED', 'Continue Prescient records with the configuration revision returned by the first page.');
      const view = await this.#prescientState(alias, args.expectedRevision), native = view.configuration;
      const values = args.kind === 'operations' ? Object.entries(native.operations ?? {}).map(([operationId, value]) =>
        ({ ...value, operationId })) : native[args.kind];
      if (name.endsWith('_records'))
        return { workspaceId: view.workspaceId, revision: native.revision, kind: args.kind, ...slice(values, args) };
      const record = values?.find(value => (value.id ?? value.operationId) === args.id);
      if (!record) fail('STAC_MCP_RECORD_NOT_FOUND', 'This record is not in the original Prescient configuration.');
      return { workspaceId: view.workspaceId, revision: native.revision, kind: args.kind, record };
    }
    if (name === 'merchant_stac_prescient_profile') return client.prescientProfile(args.profileSha256);
    if (name === 'merchant_stac_prescient_action') return this.#prescientAction(alias, args);
    if (name === 'merchant_stac_file_read') {
      const selection = Object.fromEntries(Object.keys(fileSelection).filter(k => args[k] !== undefined).map(k => [k, args[k]]));
      const key = canonicalStacJSON(selection);
      return this.#reads.read({ scope: alias, key, kind: 'stac-' + args.kind, directory: this.#exports,
        load: () => client.file(selection), expectedSha256: args.expectedSha256, readId: args.readId, offset: args.offset, limit: args.limit });
    }
    fail('STAC_MCP_METHOD_UNKNOWN', 'Unknown original STAC tool.');
  }
  async call(name, args = {}) {
    const definition = definitions.get(name);
    if (!definition || !plain(args) || Object.keys(args).some(k => !Object.hasOwn(definition.properties, k)) ||
        definition.required.some(k => !Object.hasOwn(args, k))) fail('STAC_MCP_INPUT_INVALID', 'Supply only the declared fields and all required values.');
    for (const [key, value] of Object.entries(args)) check(value, definition.properties[key], key);
    return small(await this.#call(name, args));
  }
  async close() {
    this.#closed = true;
    for (const client of this.#clients.values()) client.close();
    this.#clients.clear(); await this.#reads.close();
  }
}
