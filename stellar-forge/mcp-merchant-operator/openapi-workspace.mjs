import { openapiWorkspaceTools, read, selection, page, selectedPackage, source, plan, revisionInput, packageName, digest, alias, uuid, offset, revision, policy, routeDecisions, PACKAGE, UUID } from './catalog/openapi-workspace.mjs';
export { openapiWorkspaceTools } from './catalog/openapi-workspace.mjs';
// MIT. Merchant authoring through the original SF61 console and SF82 releases.
import { isRouteWorksheetTool, executeRouteWorksheet } from './openapi-route-worksheet.mjs';
import { isOperationPolicyTool, executeOperationPolicies } from './openapi-operation-policies.mjs';
import { Sf61WorkspaceClient, SF61_ALIAS, SF61_SHA, SF61_MAX_SOURCE_BYTES, sf61Hash,
  sf61Failure as fail, sf61Plain as plain, sf61Exact as exact, sf61Checked as checked } from './sf61-connection.mjs';
export { readSf61WorkspaceConfiguration as readOpenApiWorkspaceConfiguration } from './sf61-connection.mjs';


const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
















const definitions = new Map(openapiWorkspaceTools((name, description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));
function integer(value, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('INVALID_PARAMS', 'Use an integer within the declared range.');
  return value;
}
function query(route, values) {
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, String(value)]));
  return route + (params.size ? '?' + params : '');
}
function compact(value) {
  if (!plain(value)) return value;
  const { folder, command, release, output, directory, path, ...rest } = value;
  return rest;
}
function loaded(value, includeSource) {
  if (includeSource !== undefined && typeof includeSource !== 'boolean') throw fail('INVALID_PARAMS', 'includeSource must be boolean.');
  const { specText, ...rest } = compact(value), bytes = Buffer.byteLength(specText);
  return { ...rest, source: { sha256: sf61Hash(specText), bytes,
    ...(includeSource && bytes <= 131072 ? { text: specText, complete: true }
      : { complete: false, exportAvailable: true }) } };
}
function runtime(value) {
  return Object.fromEntries(['state', 'name', 'mode', 'seller', 'runtimeId', 'caches', 'credentials']
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
export class MerchantOpenApiWorkspaces {
  #config; #environment; #clients = new Map(); #pending = new Set(); #closing = false; #close;
  constructor(config, { environment = process.env } = {}) { this.#config = config; this.#environment = environment; }
  get summary() {
    return { configured: Boolean(this.#config.openapiWorkspaces), ownership: 'ORIGINAL_SF61_CONSOLE',
      workspaces: Object.entries(this.#config.openapiWorkspaces?.workspaces ?? {}).map(([workspace, entry]) => ({
        workspace, label: entry.label,
        files: Object.entries(entry.files).map(([file, value]) => ({ file, kind: value.kind, sha256: value.sha256 ?? null })),
        deliveries: Object.entries(entry.deliveries).map(([delivery, value]) => ({ delivery, label: value.label ?? delivery, manifestSha256: value.manifestSha256 ?? null }))
      })) };
  }
  #client(workspace) {
    checked(workspace, SF61_ALIAS, 'workspace alias');
    const definition = this.#config.openapiWorkspaces?.workspaces[workspace];
    if (!definition) throw fail('OPENAPI_WORKSPACE_NOT_CONFIGURED', 'Choose an original workspace from merchant_openapi_workspaces.');
    if (!this.#clients.has(workspace)) this.#clients.set(workspace, new Sf61WorkspaceClient(definition, { environment: this.#environment }));
    return this.#clients.get(workspace);
  }
  async #source(client, input) {
    if ((input.specText === undefined) === (input.specFile === undefined))
      throw fail('INVALID_PARAMS', 'Choose exactly one complete source text or host-declared source file.');
    let selected;
    if (input.specFile !== undefined) selected = await client.source(input.specFile);
    else {
      if (typeof input.specText !== 'string' || !input.specText.length || Buffer.byteLength(input.specText) > 131072)
        throw fail('INVALID_PARAMS', 'Supply up to 128 KiB of complete OpenAPI text or select a host file.');
      selected = { text: input.specText, bytes: Buffer.byteLength(input.specText), sha256: sf61Hash(input.specText) };
    }
    if (selected.bytes > SF61_MAX_SOURCE_BYTES) throw fail('INVALID_PARAMS', 'Original OpenAPI sources are limited to 4 MiB.');
    if (input.expectedSourceSha256 !== undefined && selected.sha256 !== checked(input.expectedSourceSha256, SF61_SHA, 'source SHA256'))
      throw fail('OPENAPI_SOURCE_CHANGED', 'The selected complete source differs from the reviewed SHA256.');
    return selected;
  }
  async #plan(client, input) {
    if ((input.plan === undefined) === (input.planFile === undefined))
      throw fail('INVALID_PARAMS', 'Choose exactly one complete merchant plan or host-declared plan file.');
    const result = input.planFile === undefined ? input.plan : JSON.parse((await client.source(input.planFile, 'plan')).text);
    if (!plain(result) || Buffer.byteLength(JSON.stringify(result)) > SF61_MAX_SOURCE_BYTES)
      throw fail('INVALID_PARAMS', 'Supply a complete original merchant plan within 4 MiB.');
    return result;
  }
  async #existing(client, name, matches) {
    let inspected;
    try { inspected = await client.json(query('/api/package-transfer/inspect', { name })); }
    catch (error) { if (error.status === 404) return null; throw error; }
    const original = await client.json(query('/api/load', { name }));
    if (!await matches(original)) throw fail('OPENAPI_PACKAGE_CONFLICT', 'This name already identifies different original source, settings or revision. Reopen it or choose a new name.');
    return { recovered: true, package: inspected, saved: loaded(original, false) };
  }
  async #save(client, input, changed, prepared) {
    const selected = prepared?.source ?? await this.#source(client, input);
    const body = changed ? { ...input, specText: selected.text } : {
      name: input.name, specText: selected.text, plan: prepared?.plan ?? await this.#plan(client, input),
      ...(prepared?.capturedSource === undefined ? {} : { capturedSource: prepared.capturedSource }) };
    for (const key of ['specFile', 'expectedSourceSha256']) delete body[key];
    const matches = async original => {
      if (original.specText !== selected.text) return false;
      if (!changed) return !original.sourceRevision && canonical(original.plan) === canonical(body.plan);
      if (original.sourceRevision?.reviewSha256 !== input.expectedReviewSha256 ||
          original.sourceRevision?.refreshReviewId !== input.expectedRefreshReviewId ||
          original.sourceRevision?.base?.name !== input.baseName) return false;
      // Reuse the original matcher so a retry with altered decisions cannot
      // borrow an earlier completed review. Current grant readiness does not
      // change the identity of an already saved original package.
      const review = await client.json('/api/revisions/review', { baseName: input.baseName, specText: selected.text,
        decisions: input.decisions, additions: input.additions });
      return review.reviewSha256 === input.expectedReviewSha256 && review.refreshReviewId === input.expectedRefreshReviewId;
    };
    const prior = await this.#existing(client, input.name, matches);
    if (prior) return prior;
    try {
      const saved = await client.json(changed ? '/api/revisions/save' : '/api/save', body);
      const inspected = await client.json(query('/api/package-transfer/inspect', { name: input.name }));
      return { recovered: false, package: inspected, saved: compact(saved) };
    } catch (error) {
      if (error.code === 'EEXIST' || error.status === 409 || error.outcomeUnknown) {
        const recovered = await this.#existing(client, input.name, matches).catch(recovery => {
          if (recovery.code === 'OPENAPI_PACKAGE_CONFLICT') throw recovery;
          return null;
        });
        if (recovered) return recovered;
      }
      throw error;
    }
  }
  async #execute(name, args) {
    if (name === 'merchant_openapi_workspaces') return this.summary;
    const { workspace, ...input } = args, declared = this.#client(workspace);
    // Keep one selected console through each operation's dependent reads and
    // writes. A managed URL refresh takes effect at the next operation.
    const selected = await declared.connection(), definition = { ...declared.definition };
    delete definition.consoleUrlFile;
    definition.consoleUrlEnv = 'OPENAPI_SELECTED_CONSOLE_URL';
    const client = new Sf61WorkspaceClient(definition, { environment: {
      OPENAPI_SELECTED_CONSOLE_URL: selected.origin + '/#' + selected.token } });
    for (const field of ['name', 'baseName']) if (input[field] !== undefined) checked(input[field], PACKAGE, 'package name');
    for (const field of ['expectedSourceSha256','expectedReviewSha256','expectedRefreshReviewId','expectedPackageManifestSha256','expectedManifestSha256','expectedSha256','exportId'])
      if (input[field] !== undefined) checked(input[field], SF61_SHA, field);
    for (const field of ['inspectionId','id','runtimeId','operationId','restoreInspectionId','readId','before'])
      if (input[field] !== undefined && !(name === 'merchant_openapi_stage' && field === 'id')) checked(input[field], UUID, field);
    if (name === 'merchant_openapi_stage') checked(input.id, SF61_ALIAS, 'release ID');
    if (input.expectedRevision !== undefined) integer(input.expectedRevision, 0);
    if (input.offset !== undefined) integer(input.offset, 0);
    if (input.limit !== undefined) integer(input.limit, 1, name === 'merchant_openapi_file' ? 196608 : 200);
    if (isOperationPolicyTool(name)) return executeOperationPolicies({ name, input, workspace, client,
      readSource: value => this.#source(client, value), readPlan: value => this.#plan(client, value) });
    if (isRouteWorksheetTool(name)) return executeRouteWorksheet({ name, input, workspace, client,
      readSource: value => this.#source(client, value), readPlan: value => this.#plan(client, value),
      save: (value, prepared) => this.#save(client, value, false, prepared) });
    const result = native => ({ workspace, native: compact(native) });
    const cache = (operation, body, more = {}) => client.json(query('/api/cache-operations/' + operation, { name: input.name, ...more }), body);
    switch (name) {
      case 'merchant_openapi_status': return result(runtime(await client.json('/api/status')));
      case 'merchant_openapi_packages': return result(await client.json(query('/api/package-transfer/packages', input)));
      case 'merchant_openapi_package_inspect': return result(await client.json(query('/api/package-transfer/inspect', input)));
      case 'merchant_openapi_load': return result(loaded(await client.json(query('/api/load', { name: input.name })), input.includeSource));
      case 'merchant_openapi_inspect': return result(await client.json('/api/inspect', { specText: (await this.#source(client, input)).text }));
      case 'merchant_openapi_preview': return result(await client.json('/api/preview', {
        specText: (await this.#source(client, input)).text, plan: await this.#plan(client, input) }));
      case 'merchant_openapi_save': return result(await this.#save(client, input, false));
      case 'merchant_openapi_drafts': return result(await client.json('/api/revisions/drafts'));
      case 'merchant_openapi_draft_load': return result(loaded(await client.json(query('/api/revisions/load', { name: input.name })), input.includeSource));
      case 'merchant_openapi_revision_review':
      case 'merchant_openapi_revision_draft': {
        const { specFile, expectedSourceSha256, ...body } = input;
        body.specText = (await this.#source(client, input)).text;
        return result(await client.json(name.endsWith('_review') ? '/api/revisions/review' : '/api/revisions/draft', body));
      }
      case 'merchant_openapi_revision_save': return result(await this.#save(client, input, true));
      case 'merchant_openapi_stage': return result(await client.json('/api/package-transfer/stage', {
        ...input, store: this.#config.releaseStore, createStore: false }));
      case 'merchant_openapi_start': return result(runtime(await client.json('/api/start', input)));
      case 'merchant_openapi_stop': return result(runtime(await client.json('/api/stop', input)));
      case 'merchant_openapi_cache_history': {
        if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))
          throw fail('INVALID_PARAMS', 'Choose a cache history limit from 1 to 100.');
        const kind = input.kind ?? 'workspace';
        if (!['workspace', 'inspection', 'change', 'compare'].includes(kind)) throw fail('INVALID_PARAMS', 'Select workspace, inspection, change or compare.');
        if (kind === 'inspection' || kind === 'change') checked(input.id, UUID, 'saved cache identity');
        if (kind === 'compare') { checked(input.before, UUID, 'before snapshot'); checked(input.after, UUID, 'after snapshot'); }
        return result(await cache(kind, undefined, Object.fromEntries(['id','before','after','offset','limit']
          .filter(key => input[key] !== undefined).map(key => [key,input[key]]))));
      }
      case 'merchant_openapi_cache_capture': {
        const { name: ignored, ...body } = input; return result(await cache('capture', { ...body, sourceId: 'merchant' }));
      }
      case 'merchant_openapi_cache_prepare': {
        const { name: ignored, ...body } = input; return result(await cache('prepare', { ...body, sourceId: 'merchant' }));
      }
      case 'merchant_openapi_cache_apply': case 'merchant_openapi_cache_recover': {
        const { name: ignored, ...body } = input; return result(await cache(name.endsWith('_apply') ? 'apply' : 'recover', body));
      }
      case 'merchant_openapi_policy_reviews': return result(await cache('policy-list', undefined, { offset: input.offset }));
      case 'merchant_openapi_policy_show': return result(await cache('policy-show', undefined, { id: input.id }));
      case 'merchant_openapi_policy_review': {
        const { baseName, ...body } = input;
        return result(await client.json(query('/api/cache-operations/policy-review', { name: baseName }), body));
      }
      case 'merchant_openapi_policy_save': return result(await cache('policy-save', { id: input.id, expectedReviewSha256: input.expectedReviewSha256 }));
      case 'merchant_openapi_export': return { workspace, ...await client.json('/api/package-transfer/export', input) };
      case 'merchant_openapi_exports': return { workspace, ...await client.json(query('/api/package-transfer/exports', input)) };
      case 'merchant_openapi_manifest': return { workspace, ...await client.json(query('/api/package-transfer/manifest', input)) };
      case 'merchant_openapi_file': return { workspace, ...await client.json(query('/api/package-transfer/file', input)) };
      case 'merchant_openapi_file_release': return { workspace, ...await client.json('/api/package-transfer/file-release', input) };
      case 'merchant_openapi_receive': {
        const delivery = client.delivery(input.delivery);
        if (delivery.manifestSha256 !== undefined && delivery.manifestSha256 !== input.expectedManifestSha256)
          throw fail('OPENAPI_DELIVERY_CHANGED', 'The receiving directory has a different host-selected manifest SHA256.');
        return result(await client.json('/api/package-transfer/receive', { name: input.name,
          directory: delivery.directory, expectedManifestSha256: input.expectedManifestSha256 }));
      }
      default: throw fail('TOOL_NOT_FOUND', 'Unknown original OpenAPI merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw fail('OPENAPI_WORKSPACE_CLOSING', 'Original merchant access is closing.');
    const definition = definitions.get(name);
    if (!definition) throw fail('TOOL_NOT_FOUND', 'Unknown original OpenAPI merchant operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    const selected = structuredClone(args);
    const pending = Promise.resolve().then(() => this.#execute(name, selected)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    return this.#close ??= (async () => { this.#closing = true; await Promise.allSettled([...this.#pending]); })();
  }
}
