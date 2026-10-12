// MIT. Complete agent workflow on the ORIGINAL STAC imagery/processing host.
import { basename } from 'node:path';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { StacWorkspaceClient, StacWorkspaceError, STAC_WORKSPACE_CONNECTION_SCHEMA,
  readStacWorkspaceConfiguration, readStacHostFile, canonicalStacJSON, nativeStacItemId, stacDigest } from './stac-workspace-client.mjs';

export { readStacWorkspaceConfiguration, STAC_WORKSPACE_CONNECTION_SCHEMA };
const fail = (code, message, details) => { throw new StacWorkspaceError(code, message, details); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', minLength: 1, maxLength: 2048 };
const operation = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const number = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const object = { type: 'object' }, boolean = { type: 'boolean' };
const workspace = { workspace: alias };
const page = { offset: number, limit: { type: 'integer', minimum: 1, maximum: 100 },
  expectedViewSha256: digest };
const read = { readOnly: true, idempotent: true };
const localWrite = { idempotent: false };
const records = ['collections', 'catalogSources', 'queries', 'reviews', 'editions', 'assetReviews', 'assets', 'decisions', 'imports', 'operations'];
const kinds = ['state', 'edition', 'comparison', 'report', 'asset', 'handover', 'processing-state', 'processing-read', 'processing-source', 'processing-handover'];
const fileSelection = {
  kind: { type: 'string', enum: kinds }, editionId: id, assetId: id, leftEditionId: id, rightEditionId: id,
  editionIds: { type: 'array', items: id, minItems: 1, uniqueItems: true },
  format: { type: 'string', enum: ['json', 'csv', 'html'] }, includeAssets: boolean,
  name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9-]{0,63}$' }, query: object, deploymentKey: id, exportId: id
};
const sourceInput = { ...workspace, input: alias, expectedSha256: digest };
const selectionDescription = 'Use the original edition/asset IDs. Full byte reads preserve complete records and native report/handover bytes.';
export function stacWorkspaceTools(tool) {
  return [
    tool('merchant_stac_workspaces', 'List configured original imagery/processing host aliases and input/profile names. Does not open a session or expose its private URL.', {}, [], read),
    tool('merchant_stac_status', 'Read original workspace identity, current revision, collection counts, recent job counts and declared processing capabilities. No provider acquisition.', workspace, ['workspace'], read),
    tool('merchant_stac_records', 'Page an original saved collection. Continue with nextOffset and expectedRevision to prevent mixed revisions. Operations are durable native records; recent server jobs are separate.', { ...workspace, kind: { type: 'string', enum: records }, offset: number, limit: page.limit, expectedRevision: number }, ['workspace', 'kind'], read),
    tool('merchant_stac_record', 'Inspect one original saved query, review, edition, asset, decision, import, operation or catalog source. Includes complete native review values; large files use file_read.', { ...workspace, kind: { type: 'string', enum: ['catalog', ...records] }, id, expectedRevision: number }, ['workspace', 'kind'], read),
    tool('merchant_stac_edition', 'Inspect one original edition and its exact coverage, original page sources, asset/decision counts and full-item view digest. No provider request.', { ...workspace, editionId: id }, ['workspace', 'editionId'], read),
    tool('merchant_stac_items', 'Page every original STAC item in one saved edition, including full geometry/properties/assets. Pin expectedViewSha256 after the first page; it changes if an active capture adds pages or decisions.', { ...workspace, editionId: id, ...page }, ['workspace', 'editionId'], read),
    tool('merchant_stac_item', 'Inspect one original collection-qualified item with complete properties/geometry/assets plus its saved analyst decision and captures.', { ...workspace, editionId: id, itemId: id, expectedViewSha256: digest }, ['workspace', 'editionId', 'itemId'], read),
    tool('merchant_stac_compare', 'Use the native comparison for two editions, preserving coverage and comparableQuery. Choose added/removed/changed/unchanged and page all original rows with the same view digest.', { ...workspace, leftEditionId: id, rightEditionId: id, kind: { type: 'string', enum: ['added', 'removed', 'changed', 'unchanged'] }, ...page }, ['workspace', 'leftEditionId', 'rightEditionId', 'kind'], read),
    tool('merchant_stac_operation', 'Read the same stable operation ID from the durable workspace plus its recent original host job if retained. A missing recent job after host restart does not repeat the action.', { ...workspace, operationId: operation }, ['workspace', 'operationId'], read),
    tool('merchant_stac_discover', 'Discover the configured catalog and all collection pages through the original provider. Supply the current revision and one stable operationId; inspect that operation after an uncertain response.', { ...workspace, operationId: operation, expectedRevision: number }, ['workspace', 'operationId', 'expectedRevision'], { idempotent: true, openWorld: true }),
    tool('merchant_stac_query_save', 'Save or update an original spatial/date/cloud-filter query with current expectedRevision. query uses native collections, exactly one bbox/intersects, datetime, optional cloudCoverMax, pageSize/maxPages; id updates the same query.', { ...workspace, query: object, expectedRevision: number }, ['workspace', 'query', 'expectedRevision'], localWrite),
    tool('merchant_stac_search_review', 'Retain the exact original catalog/query/source review before capture. The native review binds query digest, collection contracts and page budget; no imagery acquisition yet.', { ...workspace, queryId: id }, ['workspace', 'queryId'], localWrite),
    tool('merchant_stac_search_acquire', 'Start acquisition of the saved native review under one stable operationId. Returns the original recent job; native edition/page progress survives interrupted client polling.', { ...workspace, reviewId: id, operationId: operation }, ['workspace', 'reviewId', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_stac_search_resume', 'Continue this original saved edition using the existing native page/capture state. Supply a stable host operationId for the explicit continuation; never create a replacement edition.', { ...workspace, editionId: id, operationId: operation }, ['workspace', 'editionId', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_stac_search_cancel', 'Request cancellation of the original edition. Client disconnect alone does not cancel a native capture. Inspect edition and operation state to see the saved outcome.', { ...workspace, editionId: id }, ['workspace', 'editionId'], { idempotent: true, destructive: true }),
    tool('merchant_stac_asset_review', 'Retain an original item-asset review with its exact source/item digest and explicit maximum bytes. The native provider controls eligibility and acquisition.', { ...workspace, editionId: id, itemId: id, assetKey: id, maxBytes: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, ['workspace', 'editionId', 'itemId', 'assetKey', 'maxBytes'], localWrite),
    tool('merchant_stac_asset_range', 'Read a bounded original asset range without a whole-file snapshot. The native SHA256, ETag and content range bind every chunk; use expectedSha256 after the first range and verify the complete digest after assembly. Supports native saved assets up to 2GiB.', { ...workspace, assetId: id, expectedSha256: digest, offset: number, limit: { type: 'integer', minimum: 1, maximum: 196608 } }, ['workspace', 'assetId'], read),
    tool('merchant_stac_asset_acquire', 'Acquire exactly the selected native asset review under its stable original operationId. Download completed bytes separately through file_read.', { ...workspace, reviewId: id, operationId: operation }, ['workspace', 'reviewId', 'operationId'], { idempotent: true, openWorld: true }),
    tool('merchant_stac_decision_save', 'Save a complete SELECTED/REJECTED/REVIEW analyst decision against the current revision, original edition and collection-qualified item ID. Native asset keys, actor and note remain in the handover.', { ...workspace, editionId: id, itemId: id, status: { type: 'string', enum: ['SELECTED', 'REJECTED', 'REVIEW'] }, actor: { type: 'string', minLength: 1, maxLength: 240 }, note: { type: 'string', maxLength: 10000 }, assetKeys: { type: 'array', items: id, uniqueItems: true }, expectedRevision: number }, ['workspace', 'editionId', 'itemId', 'status', 'actor', 'expectedRevision'], localWrite),
    tool('merchant_stac_inputs', 'List original host-declared imagery/processing handover and source aliases. File paths and credential values are not agent arguments.', workspace, ['workspace'], read),
    tool('merchant_stac_input_inspect', 'Inspect exact bytes, SHA256 and original schema/digest of a host input before import; does not acquire provider data or import the file.', { ...workspace, input: alias }, ['workspace', 'input'], read),
    tool('merchant_stac_input_import', 'Import the complete reviewed original imagery or processing handover, or retained processing-page body from its host alias. Pin expectedSha256; processing imports require stable operationId. Original endpoint/file/digest conflicts are native errors.', { ...sourceInput, operationId: operation, editionId: id, taskId: id, metadata: object }, ['workspace', 'input', 'expectedSha256'], localWrite),
    tool('merchant_stac_processing_status', 'Read the original configured Cirrus processing workspace, saved deployments, operations, edition/review/import/export counts and revision. Credentials remain with the original host.', workspace, ['workspace'], read),
    tool('merchant_stac_processing_read', 'Read an enabled native processing view: inventory, statistics, edition, runs, run or associations. Optionally page a named array using path, offset and expectedViewSha256. Original source and handover bytes use file_read.', { ...workspace, name: fileSelection.name, query: object, path: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 }, maxItems: 12 }, ...page }, ['workspace', 'name'], read),
    tool('merchant_stac_processing_configure', 'Configure processing through a host-declared exact deployment profile and reviewed original source input. Native auth/env selections stay in the private host profile. Supply the current processing revision and one stable operationId.', { ...workspace, profile: alias, expectedSha256: digest, expectedRevision: number, operationId: operation }, ['workspace', 'profile', 'expectedSha256', 'expectedRevision', 'operationId'], localWrite),
    tool('merchant_stac_processing_action', 'Apply an enabled original processing discover/review/capture/prepare/resume/cancel/continue/associate/export action under one stable operationId. Uses native input exactly. Configuration and full file imports have dedicated alias-based tools.', { ...workspace, name: fileSelection.name, input: object, operationId: operation }, ['workspace', 'name', 'input', 'operationId'], { idempotent: false, openWorld: true }),
    tool('merchant_stac_file_read', 'Read a complete original asset/report/handover, or full JSON view, in bounded chunks. ' + selectionDescription + ' First read returns readId, SHA256 and bytes; continue with the same selection, readId, expectedSha256 and nextOffset. Native exports run once per retained read.', { ...workspace, ...fileSelection, readId: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, expectedSha256: digest, offset: number, limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } }, ['workspace', 'kind'], read),
    tool('merchant_stac_file_release', 'Close an incomplete retained file read. Original assets and source files remain in their native workspace.', { ...workspace, readId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } }, ['workspace', 'readId'], { idempotent: true }),
    tool('merchant_stac_disconnect', 'Drop this client session and retained reads only. The original host, saved workspace and any active native capture remain under their original operator.', workspace, ['workspace'], { idempotent: true }),
  ];
}
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
      processingProfiles: Object.entries(entry.processingProfiles ?? {}).map(([profile, value]) => ({ profile, label: value.label, sourceInput: value.sourceInput })) };
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
  async #operation(alias, operationId) {
    const client = this.#client(alias), state = await client.state(); let recentJob = null;
    try { recentJob = await client.job(operationId); } catch (error) { if (error.code !== 'JOB_NOT_FOUND') throw error; }
    let processing = null;
    if (state.capabilities?.processing?.enabled) {
      const view = await client.processingState();
      const matches = Object.entries(view.operations ?? {}).filter(([key]) => key === operationId || key.endsWith(':' + operationId));
      processing = Object.fromEntries(matches);
    }
    return { workspaceId: state.workspace.id, operationId, revision: state.workspace.revision,
      operation: state.workspace.operations?.[operationId] ?? null, recentJob, processing,
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
