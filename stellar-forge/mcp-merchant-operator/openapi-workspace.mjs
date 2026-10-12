// MIT. Merchant authoring through the original SF61 console and SF82 releases.
import { Sf61WorkspaceClient, SF61_ALIAS, SF61_SHA, SF61_MAX_SOURCE_BYTES, sf61Hash,
  sf61Failure as fail, sf61Plain as plain, sf61Exact as exact, sf61Checked as checked } from './sf61-connection.mjs';
export { readSf61WorkspaceConfiguration as readOpenApiWorkspaceConfiguration } from './sf61-connection.mjs';
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const alias = { type: 'string', pattern: SF61_ALIAS.source };
const digest = { type: 'string', pattern: SF61_SHA.source };
const packageName = { type: 'string', pattern: PACKAGE.source };
const uuid = { type: 'string', pattern: UUID.source };
const selection = { workspace: alias };
const selectedPackage = { ...selection, name: packageName };
const source = { specFile: alias, specText: { type: 'string', minLength: 1, maxLength: 131072 }, expectedSourceSha256: digest };
const plan = { plan: { type: 'object' }, planFile: alias };
const page = { after: { type: 'string', maxLength: 64 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const offset = { type: 'integer', minimum: 0 };
const revision = { type: 'integer', minimum: 0 };
const read = { readOnly: true, idempotent: true };
const routeDecisions = { type: 'array', maxItems: 64, items: { type: 'object',
  properties: { routeId: { type: 'string', maxLength: 128 }, action: { type: 'string', enum: ['keep', 'remap', 'drop'] },
    method: { type: 'string', maxLength: 16 }, path: { type: 'string', maxLength: 4096 }, settings: { type: 'object' } },
  required: ['routeId', 'action'], additionalProperties: false } };
const revisionInput = { ...selection, baseName: packageName, ...source, decisions: routeDecisions,
  additions: { type: 'array', maxItems: 64, items: { type: 'object' } } };
const policy = { type: 'object', properties: Object.fromEntries(['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes']
  .map(key => [key, { type: 'integer', minimum: 1 }])), additionalProperties: false };
export function openapiWorkspaceTools(tool) {
  return [
    tool('merchant_openapi_workspaces', 'List original SF61 consoles, declared API/plan file handles and complete receiving directories.', {}, [], read),
    tool('merchant_openapi_status', 'Read the original console-owned merchant runtime and cache state. The console stays shared with its browser and HAR operator.', selection, ['workspace'], read),
    tool('merchant_openapi_packages', 'Page every complete original saved API package. Continue nextCursor until complete; incomplete directories do not consume the page.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_openapi_package_inspect', 'Verify a saved original package, its complete source/compiled identity and retained revision. Reopen here after an interrupted save.', selectedPackage, ['workspace', 'name'], read),
    tool('merchant_openapi_load', 'Read the original editable plan, preview and source identity. includeSource returns complete source up to 128 KiB; complete larger source travels in the package export.', { ...selectedPackage, includeSource: { type: 'boolean' } }, ['workspace', 'name'], read),
    tool('merchant_openapi_inspect', 'Inspect a complete OpenAPI JSON/YAML source through the original compiler. Choose a configured source file or complete small source text.', { ...selection, ...source }, ['workspace'], read),
    tool('merchant_openapi_preview', 'Review original routes, exact atomic payment terms, upstream bindings and current provider authorization before saving.', { ...selection, ...source, ...plan }, ['workspace'], read),
    tool('merchant_openapi_save', 'Save a complete merchant using the original compiler and atomic publisher. Exact retries reopen the same existing source and plan.', { ...selectedPackage, ...source, ...plan }, ['workspace', 'name'], { idempotent: true }),
    tool('merchant_openapi_drafts', 'List original retained source-revision drafts, including work saved in the browser.', selection, ['workspace'], read),
    tool('merchant_openapi_draft_load', 'Reopen a named original draft and recheck its base source and current provider authorization.', { ...selectedPackage, includeSource: { type: 'boolean' } }, ['workspace', 'name'], read),
    tool('merchant_openapi_revision_review', 'Review keep/remap/drop and additions through the original revision engine, preserving existing atomic prices. Returns original review hashes for save.', revisionInput, ['workspace', 'baseName'], read),
    tool('merchant_openapi_revision_draft', 'Retain a complete named source-revision draft in the original console for browser or agent continuation.', { ...revisionInput, name: packageName }, ['workspace', 'baseName', 'name'], {}),
    tool('merchant_openapi_revision_save', 'Save the exact reviewed source revision with original review hashes. A completed retry recovers the same package and source lineage.', {
      ...revisionInput, name: packageName, expectedReviewSha256: digest, expectedRefreshReviewId: digest
    }, ['workspace', 'baseName', 'name', 'expectedReviewSha256', 'expectedRefreshReviewId'], { idempotent: true }),
    tool('merchant_openapi_stage', 'Stage an initial or revised saved package into this operator’s configured original SF82 release store. Continue through merchant_compare, activate and start.', {
      ...selectedPackage, id: alias, expectedPackageManifestSha256: digest
    }, ['workspace', 'name', 'id'], {}),
    tool('merchant_openapi_start', 'Start the selected original console package in challenge mode for native source/cache operation. Its browser shares the same runtime.', selectedPackage, ['workspace', 'name'], { openWorld: true }),
    tool('merchant_openapi_stop', 'Stop the exact console-owned runtime selected by its current runtimeId. Read status after reopening or another operator change.', {
      ...selection, runtimeId: uuid
    }, ['workspace', 'runtimeId'], { destructive: true }),
    tool('merchant_openapi_cache_history', 'Page saved original cache activity, inspect one snapshot/change, or compare two snapshots.', {
      ...selectedPackage, kind: { type: 'string', enum: ['workspace', 'inspection', 'change', 'compare'] }, id: uuid, before: uuid, after: uuid, offset,
      limit: { type: 'integer', minimum: 1, maximum: 100 }
    }, ['workspace', 'name'], read),
    tool('merchant_openapi_cache_capture', 'Capture the selected running package into its original SQLite operating history at the reviewed workspace revision.', {
      ...selectedPackage, expectedRevision: revision, label: { type: 'string', maxLength: 160 }
    }, ['workspace', 'name', 'expectedRevision'], {}),
    tool('merchant_openapi_cache_prepare', 'Prepare one reviewed retention change or invalidation using the original snapshot and runtime-generation checks.', {
      ...selectedPackage, inspectionId: uuid, expectedRevision: revision, route: { type: 'string', minLength: 1, maxLength: 128 },
      action: { type: 'string', enum: ['configure', 'invalidate'] }, policy, note: { type: 'string', maxLength: 2000 }, operationId: uuid, restoreInspectionId: uuid
    }, ['workspace', 'name', 'inspectionId', 'expectedRevision', 'route', 'action', 'operationId'], { idempotent: true }),
    tool('merchant_openapi_cache_apply', 'Apply the original prepared cache operation. An already completed operation returns its same retained result.', {
      ...selectedPackage, id: uuid, expectedRevision: revision
    }, ['workspace', 'name', 'id', 'expectedRevision'], { idempotent: true }),
    tool('merchant_openapi_cache_recover', 'Recover the original interrupted cache operation by reading its retained runtime operation before continuing the same change.', {
      ...selectedPackage, id: uuid, expectedRevision: revision
    }, ['workspace', 'name', 'id', 'expectedRevision'], { idempotent: true }),
    tool('merchant_openapi_policy_reviews', 'Page retained original cache-policy revision reviews after browser, console or MCP restart.', { ...selectedPackage, offset }, ['workspace', 'name'], read),
    tool('merchant_openapi_policy_review', 'Turn selected cached routes from one original operating snapshot into a reviewed new saved-package policy; all other original settings are preserved.', {
      ...selection, baseName: packageName, inspectionId: uuid, routeIds: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', maxLength: 128 } },
      name: packageName, note: { type: 'string', maxLength: 2000 }
    }, ['workspace', 'baseName', 'inspectionId', 'routeIds', 'name'], {}),
    tool('merchant_openapi_policy_show', 'Reopen the original retained cache-policy review, its exact route changes and any completed saved revision.', {
      ...selectedPackage, id: uuid
    }, ['workspace', 'name', 'id'], read),
    tool('merchant_openapi_policy_save', 'Save the retained original cache-policy review through the original revision/compiler and recover its exact completed package after a lost reply.', {
      ...selectedPackage, id: uuid, expectedReviewSha256: digest
    }, ['workspace', 'name', 'id', 'expectedReviewSha256'], { idempotent: true }),
    tool('merchant_openapi_export', 'Retain every original source, compiled and revision file as an immutable complete merchant export for receiving.', {
      ...selectedPackage, expectedPackageManifestSha256: digest
    }, ['workspace', 'name'], { idempotent: true }),
    tool('merchant_openapi_exports', 'Page complete retained original package exports after a lost export response or source/console reopening.', { ...selection, ...page }, ['workspace'], read),
    tool('merchant_openapi_manifest', 'Read an original retained package export manifest and its exact complete file identities.', { ...selection, exportId: digest }, ['workspace', 'exportId'], read),
    tool('merchant_openapi_file', 'Read verified base64 chunks from an immutable original package export, including its completion manifest. Continue readId and nextOffset.', {
      ...selection, exportId: digest, file: { type: 'string', minLength: 1, maxLength: 1024 }, expectedManifestSha256: digest, expectedSha256: digest,
      readId: uuid, offset, limit: { type: 'integer', minimum: 1, maximum: 196608 }
    }, ['workspace', 'exportId', 'file', 'expectedManifestSha256', 'expectedSha256'], read),
    tool('merchant_openapi_file_release', 'Release the selected file-read continuation while preserving the complete original package export.', {
      ...selection, exportId: digest, readId: uuid
    }, ['workspace', 'exportId', 'readId'], { idempotent: true }),
    tool('merchant_openapi_receive', 'Receive a complete verified package from one host-declared download directory using the original atomic publisher. Preserves original package UUID, compiled files and revision lineage.', {
      ...selection, delivery: alias, name: packageName, expectedManifestSha256: digest
    }, ['workspace', 'delivery', 'name', 'expectedManifestSha256'], { idempotent: true })
  ];
}
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
  async #save(client, input, changed) {
    const selected = await this.#source(client, input);
    const body = changed ? { ...input, specText: selected.text } : {
      name: input.name, specText: selected.text, plan: await this.#plan(client, input) };
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
    const { workspace, ...input } = args, client = this.#client(workspace);
    for (const field of ['name', 'baseName']) if (input[field] !== undefined) checked(input[field], PACKAGE, 'package name');
    for (const field of ['expectedSourceSha256','expectedReviewSha256','expectedRefreshReviewId','expectedPackageManifestSha256','expectedManifestSha256','expectedSha256','exportId'])
      if (input[field] !== undefined) checked(input[field], SF61_SHA, field);
    for (const field of ['inspectionId','id','runtimeId','operationId','restoreInspectionId','readId','before'])
      if (input[field] !== undefined && !(name === 'merchant_openapi_stage' && field === 'id')) checked(input[field], UUID, field);
    if (name === 'merchant_openapi_stage') checked(input.id, SF61_ALIAS, 'release ID');
    if (input.expectedRevision !== undefined) integer(input.expectedRevision, 0);
    if (input.offset !== undefined) integer(input.offset, 0);
    if (input.limit !== undefined) integer(input.limit, 1, name === 'merchant_openapi_file' ? 196608 : 200);
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
    const pending = Promise.resolve().then(() => this.#execute(name, args)); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  close() {
    return this.#close ??= (async () => { this.#closing = true; await Promise.allSettled([...this.#pending]); })();
  }
}
