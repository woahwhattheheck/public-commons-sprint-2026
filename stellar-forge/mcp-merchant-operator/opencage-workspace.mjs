// MIT. Complete agent operation of the original OpenCage merchant/customer workspace.
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { readBytes as hostBytes, privateDirectory, parse } from '../../stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { compileGeocodeSeller, inspectGeocodePackage } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/merchant.mjs';
import { productFor, bindGeocodeQuery, queryParameters, querySchema, exampleQuery, identifier as geocodeId } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/config.mjs';
import { readBundle, readBytes, jsonBytes, digest, relativeFile } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/twelvedata/files.mjs';

export const OPENCAGE_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.opencage-workspace-connection.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.opencage-workspace.v1';
const CAPTURE_SCHEMA = 'stellar-forge.opencage-capture.v1';
const DELIVERY_SCHEMA = 'stellar-forge.opencage-delivery.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };
const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
const sha = { type: 'string', pattern: SHA.source };
const uuid = { type: 'string', pattern: UUID.source };
const selected = { workspace: alias };
const read = { readOnly: true, idempotent: true };
const paging = { offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100 }, expectedIndexSha256: sha };
const query = { ...selected, productId: id, input: { type: 'object',
  additionalProperties: { type: ['string', 'number'] }, required: ['q'] } };
const views = ['status', 'requests', 'request', 'candidates', 'decisions', 'packages', 'package',
  'deliveries', 'delivery', 'release-diff'];
const fileSelection = { ...selected, kind: { type: 'string', enum: ['capture', 'delivery', 'package'] },
  id, file: { type: 'string', minLength: 1, maxLength: 240 } };

export function opencageWorkspaceTools(tool) {
  return [
    tool('merchant_opencage_workspaces', 'List host-declared OpenCage workspaces and source aliases, process-owned operator/customer browsers and retained file reads. Opens no provider connection.', {}, [], read),
    tool('merchant_opencage_open', 'Open the original saved GeocodeWorkspace and its industrial browser on one process-owned instance. A new workspace uses the host-selected plan and terms. Saved captures, candidate decisions and merchant generations remain original.', selected, ['workspace'], { idempotent: true }),
    tool('merchant_opencage_close', 'Drain the exact owned operator, customer browsers, active original requests and file reads. Retain the workspace identity and reopen the same host alias after close.', {
      ...selected, instanceId: uuid,
    }, ['workspace', 'instanceId'], { destructive: true }),
    tool('merchant_opencage_inspect', 'Inspect original state, requests, ordered candidates, decision history, packages, deliveries or a release diff. id selects request/candidates/decisions/package/delivery. before and after select release-diff. Collections return nextOffset and indexSha256; continue with the same expectedIndexSha256. Complete native files use file_read.', {
      ...selected, view: { type: 'string', enum: views }, id, before: id, after: id, ...paging,
    }, ['workspace', 'view'], read),
    tool('merchant_opencage_query_review', 'Compile a query with the original selected product contract. Returns normalized query, source/terms identity, provider and merchant URLs, parameter descriptions and deterministic reviewSha256. This performs no provider request.', query, ['workspace', 'productId', 'input'], read),
    tool('merchant_opencage_capture', 'Dispatch one explicitly reviewed query through the original OpenCage source, deadline, configured host connection and workspace queue. Keep id/input/reviewSha256 unchanged after a lost reply; inspect that original id before continuing. A completed same-id result reopens without another request.', {
      ...query, id, reviewSha256: sha,
    }, ['workspace', 'productId', 'input', 'id', 'reviewSha256'], { openWorld: true }),
    tool('merchant_opencage_import_response', 'Import the complete response and HTTP observation from one host-declared original source alias. The original importer checks endpoint, normalized query, HTTP status, exact bytes/hash and retained dispatch identity. The alias pins both source files at MCP configuration load.', {
      ...query, id, source: alias,
    }, ['workspace', 'productId', 'input', 'id', 'source'], { idempotent: true }),
    tool('merchant_opencage_adopt_buyer', 'Recover one original retained SF88 Buyer operation from a host-declared client configuration and adopt its exact response. The original delivery verifies purchase configuration, intent, response bytes and selected merchant package/origin. This recovery does not execute a new purchase.', {
      ...selected, id, productId: id, buyer: alias,
      intentId: { type: 'string', minLength: 1, maxLength: 240 }, packageId: id,
    }, ['workspace', 'id', 'productId', 'buyer', 'intentId'], { idempotent: true }),
    tool('merchant_opencage_select', 'Save an explicit candidate index, or null to clear selection, against the original response SHA256 and current decision revision. Confidence describes spatial precision. After a lost reply inspect the same request and current decision before changing it.', {
      ...selected, id, responseSha256: sha, expectedRevision: { type: 'integer', minimum: 0, maximum: 999 },
      index: { type: ['integer', 'null'], minimum: 0, maximum: 99 }, note: { type: 'string', maxLength: 2000 },
    }, ['workspace', 'id', 'responseSha256', 'expectedRevision', 'index'], { destructive: true }),
    tool('merchant_opencage_export', 'Publish or reopen the complete original customer delivery for the reviewed response and decision revision: native response, CSV, GeoJSON, licensing, decision and provenance files. Returns the original export ID and manifest for receiving.', {
      ...selected, id, responseSha256: sha, expectedRevision: { type: 'integer', minimum: 0, maximum: 1000 },
    }, ['workspace', 'id', 'responseSha256', 'expectedRevision'], { idempotent: true }),
    tool('merchant_opencage_package', 'Prepare the original merchant package using current or explicitly supplied payment terms; alternatively import one host-declared existing package alias. Terms and source are mutually exclusive. The package retains original source, offers, SDK entries and release inputs.', {
      ...selected, terms: { type: 'object' }, source: alias,
    }, ['workspace'], { idempotent: true }),
    tool('merchant_opencage_release', 'Operate the SAME SF82 release store. stage selects packageId/id/optional label and the host facilitator. activate selects id/expectedGeneration; rollback selects expectedGeneration; start selects expectedGeneration; stop takes no further fields. Inspect current native state or release-diff before changing a generation and after an interrupted reply.', {
      ...selected, action: { type: 'string', enum: ['stage', 'activate', 'rollback', 'start', 'stop'] },
      id, packageId: id, label: { type: 'string', minLength: 1, maxLength: 120 },
      expectedGeneration: { type: 'integer', minimum: 0 },
      reason: { type: 'string', minLength: 1, maxLength: 240 },
    }, ['workspace', 'action'], { destructive: true, openWorld: true }),
    tool('merchant_opencage_customer', 'Open the original read-only customer browser for a retained export, or close that exact process-owned customer instance. open needs exportId; close also needs its instanceId. The customer browser and complete file reads use the original exported bytes.', {
      ...selected, action: { type: 'string', enum: ['open', 'close'] }, exportId: id, instanceId: uuid,
    }, ['workspace', 'action', 'exportId'], { idempotent: true }),
    tool('merchant_opencage_file_read', 'Receive an exact original capture, merchant-package or delivery file, including manifest.json, in resumable SHA256-pinned base64 chunks. Continue with the same selection/readId/expectedSha256 and nextOffset; after expiry or restart omit readId and resume the original selection/hash/offset.', {
      ...fileSelection, readId: uuid, expectedSha256: sha, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES },
    }, ['workspace', 'kind', 'id', 'file'], read),
    tool('merchant_opencage_file_release', 'Release this workspace-owned temporary verified read. The original capture, customer delivery and merchant package remain available.', {
      ...selected, readId: uuid,
    }, ['workspace', 'readId'], read),
  ];
}
const definitions = new Map(opencageWorkspaceTools((name, description, properties, required) =>
  ({ name, properties, required })).map(item => [item.name, item]));
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw failure('INVALID_PARAMS', 'Use the original ' + label + '.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
    throw failure('CONFIGURATION_ERROR', 'Declare a nonempty canonical private host path.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
async function selectedFile(value, base, maximum) {
  const path = hostPath(value, base);
  if (await realpath(path) !== path)
    throw failure('CONFIGURATION_ERROR', 'Select a canonical original input file.');
  const bytes = await hostBytes(path, { privateFile: true, max: maximum });
  return { path, sha256: digest(bytes), bytes: bytes.length, maximum };
}
async function loadFile(selection, label) {
  const bytes = await hostBytes(selection.path, { privateFile: true, max: selection.maximum });
  if (bytes.length !== selection.bytes || digest(bytes) !== selection.sha256 || await realpath(selection.path) !== selection.path)
    throw failure('OPENCAGE_SOURCE_CHANGED', 'The host-selected ' + label + ' changed. Reload the reviewed host configuration.');
  return bytes;
}
function aliases(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare up to 32 ' + label + ' aliases.');
  return Object.entries(value).map(([name, item]) => [identifier(name, label + ' alias'), item]);
}

/** File paths, source bytes and Buyer state are selected by the host configuration. */
export async function readOpenCageWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = parse(await hostBytes(path, { privateFile: true, max: 1048576 }), 'OpenCage workspace connection');
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== OPENCAGE_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original OpenCage workspaces.');
  const base = dirname(path), roots = new Set(), workspaces = Object.create(null);
  for (const [name, input] of Object.entries(raw.workspaces)) {
    identifier(name, 'OpenCage workspace alias');
    exact(input, ['label', 'directory', 'plan', 'terms', 'facilitator', 'imports', 'packages', 'buyers'], ['directory']);
    const directory = hostPath(input.directory, base);
    await privateDirectory(directory);
    if (await realpath(directory) !== directory || roots.has(directory))
      throw failure('CONFIGURATION_ERROR', 'Bind each canonical original OpenCage directory through one alias.');
    roots.add(directory);
    if ((input.plan === undefined) !== (input.terms === undefined))
      throw failure('CONFIGURATION_ERROR', 'Select both initial plan and terms, or reopen the saved configuration.');
    let configuration;
    if (input.plan !== undefined) {
      const planFile = await selectedFile(input.plan, base, 1048576);
      const termsFile = await selectedFile(input.terms, base, 1048576);
      const built = compileGeocodeSeller(parse(await loadFile(planFile, 'plan'), 'OpenCage plan'),
        parse(await loadFile(termsFile, 'terms'), 'OpenCage terms'));
      configuration = { plan: built.plan, terms: built.terms };
    } else {
      const saved = parse(await hostBytes(join(directory, 'configuration.json'), { privateFile: true, max: 1048576 }), 'Original OpenCage workspace');
      if (saved.schema !== WORKSPACE_SCHEMA) throw failure('CONFIGURATION_ERROR', 'Use the original OpenCage workspace.');
      const built = compileGeocodeSeller(saved.plan, saved.terms);
      if (saved.planSha256 !== built.planSha256 || saved.termsSha256 !== built.termsSha256 ||
          saved.identity !== digest(jsonBytes({ plan: built.plan, terms: built.terms })))
        throw failure('CONFIGURATION_ERROR', 'The original workspace configuration changed.');
      configuration = { plan: built.plan, terms: built.terms };
    }
    let facilitator;
    if (input.facilitator !== undefined) {
      let url; try { url = new URL(input.facilitator); } catch {}
      if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw failure('CONFIGURATION_ERROR', 'Select the original HTTPS payment facilitator.');
      facilitator = url.href.replace(/\/$/, '');
    }
    const imports = Object.create(null), packages = Object.create(null), buyers = Object.create(null);
    for (const [alias, value] of aliases(input.imports, 'HTTP observation')) {
      exact(value, ['observation', 'response'], ['observation', 'response']);
      imports[alias] = { observation: await selectedFile(value.observation, base, 262144),
        response: await selectedFile(value.response, base, configuration.plan.maxResponseBytes) };
    }
    for (const [alias, value] of aliases(input.packages, 'merchant package')) {
      const original = hostPath(value, base);
      await privateDirectory(original);
      if (await realpath(original) !== original) throw failure('CONFIGURATION_ERROR', 'Select the canonical original package.');
      const bundle = await inspectGeocodePackage(original);
      packages[alias] = { directory: original, identity: bundle.manifest.identity };
    }
    for (const [alias, value] of aliases(input.buyers, 'Buyer client')) {
      const file = await selectedFile(value, base, 65536);
      const selected = parse(await loadFile(file, 'Buyer client configuration'), 'Original Buyer client configuration');
      exact(selected, ['runtimeDirectory', 'stateDirectory'], ['runtimeDirectory', 'stateDirectory']);
      for (const key of ['runtimeDirectory', 'stateDirectory']) {
        if (typeof selected[key] !== 'string' || !isAbsolute(selected[key]) || resolve(selected[key]) !== selected[key] ||
            await realpath(selected[key]) !== selected[key])
          throw failure('CONFIGURATION_ERROR', 'Use canonical absolute original Buyer runtime and state directories.');
      }
      buyers[alias] = { file, configuration: selected };
    }
    workspaces[name] = { label: line(input.label ?? name, 'OpenCage workspace label'),
      directory, configuration, facilitator, imports, packages, buyers };
  }
  return { schema: OPENCAGE_WORKSPACE_CONNECTION_SCHEMA, workspaces };
}
function safeError(issue) {
  const code = /^[A-Z][A-Z0-9_]{0,100}$/.test(issue?.code ?? '') ? issue.code : 'OPENCAGE_WORKSPACE_OPERATION_FAILED';
  const error = failure(code, 'Original OpenCage operation: ' + code +
    '. Inspect the same request, decision, release or retained file before continuing.');
  if (Number.isInteger(issue?.status)) error.status = issue.status;
  if (Number.isSafeInteger(issue?.retryAfterMs)) error.retryAfterMs = issue.retryAfterMs;
  return error;
}
function withoutDirectory(value) {
  if (!plain(value)) return value;
  const { directory, ...visible } = value;
  return visible;
}
function requestView(value) {
  const { candidates, decision, ...native } = value;
  return { ...native, candidateCount: candidates.length,
    decision: { revision: decision.revision, current: decision.current, historyLength: decision.history.length } };
}
function deliveryView(delivery) {
  const native = delivery.inspect();
  const { candidates, decision, ...rest } = native;
  return { ...rest, ...(candidates ? { candidateCount: candidates.length } : {}),
    ...(decision ? { decision: { revision: decision.revision, current: decision.current, historyLength: decision.history?.length ?? 0 } } : {}) };
}
function page(items, input) {
  const { offset = 0, limit = 20, expectedIndexSha256 } = input;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      expectedIndexSha256 !== undefined && !SHA.test(expectedIndexSha256))
    throw failure('INVALID_PARAMS', 'Use an in-range offset, 1–100 rows and the original index SHA256.');
  const indexSha256 = digest(jsonBytes(items));
  if ((offset > 0 && expectedIndexSha256 === undefined) ||
      expectedIndexSha256 !== undefined && expectedIndexSha256 !== indexSha256)
    throw failure('OPENCAGE_INDEX_CHANGED', 'Read the first current page, then retain its indexSha256 while continuing.');
  const next = Math.min(offset + limit, items.length);
  return { indexSha256, total: items.length, offset, rows: items.slice(offset, next), nextOffset: next < items.length ? next : null };
}
function reviewQuery(model, productId, input) {
  const configuration = model.configuration, product = productFor(configuration.plan, geocodeId(productId));
  const query = bindGeocodeQuery(product, input), url = new URL(product.path, configuration.terms.publicOrigin);
  url.search = queryParameters(query).toString();
  const review = { workspaceIdentity: configuration.identity, planSha256: configuration.planSha256,
    termsSha256: configuration.termsSha256, productId: product.id, mode: product.mode, query,
    providerEndpoint: 'https://api.opencagedata.com/geocode/v1/json', merchantPreviewUrl: url.href };
  return { ...review, reviewSha256: digest(jsonBytes(review)), parameters: querySchema(product), example: exampleQuery(product) };
}
const contentType = name => name.endsWith('.json') || name.endsWith('.geojson') ? 'application/json'
  : name.endsWith('.csv') ? 'text/csv; charset=utf-8'
  : /\.(?:md|mjs|mts|jsonl|txt)$/.test(name) ? 'text/plain; charset=utf-8' : 'application/octet-stream';

export class MerchantOpenCageWorkspaces {
  #config; #env; #entries = new Map(); #opening = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'OPENCAGE_FILE' });
  constructor(config, { env = process.env } = {}) {
    if (!plain(env)) throw failure('CONFIGURATION_ERROR', 'Use the private host environment object.');
    this.#config = config; this.#env = { ...env };
  }
  get summary() {
    return { configured: Boolean(this.#config.opencageWorkspaces), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.opencageWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => {
        const entry = this.#entries.get(workspace);
        return { workspace, label: definition.label, open: Boolean(entry), opening: this.#opening.has(workspace),
          closing: Boolean(entry?.closing), instanceId: entry?.instanceId ?? null,
          browserUrl: entry?.service.url ?? null, workspaceIdentity: entry?.model.configuration.identity ?? null,
          imports: Object.entries(definition.imports).map(([source, value]) => ({ source,
            observationSha256: value.observation.sha256, responseSha256: value.response.sha256, responseBytes: value.response.bytes })),
          packages: Object.entries(definition.packages).map(([source, value]) => ({ source, identity: value.identity })),
          buyers: Object.keys(definition.buyers), facilitatorConfigured: Boolean(definition.facilitator),
          customers: [...(entry?.customers.values() ?? [])].map(customer => ({
            exportId: customer.exportId, instanceId: customer.instanceId, identity: customer.identity, browserUrl: customer.service.url })) };
      }) };
  }
  #definition(alias) {
    identifier(alias, 'OpenCage workspace alias');
    const definition = this.#config.opencageWorkspaces?.workspaces[alias];
    if (!definition) throw failure('OPENCAGE_WORKSPACE_NOT_CONFIGURED', 'Choose a host alias from merchant_opencage_workspaces.');
    return definition;
  }
  #entry(alias) {
    this.#definition(alias);
    const entry = this.#entries.get(alias);
    if (!entry) throw failure('OPENCAGE_WORKSPACE_NOT_OPEN', 'Open this original OpenCage workspace first.');
    if (entry.closing) throw failure('OPENCAGE_WORKSPACE_CLOSING', 'This owned original workspace is draining.');
    return entry;
  }
  #scope(alias) { return 'opencage:' + alias + ':' + this.#definition(alias).directory; }
  async #state(entry) {
    const { requests, ...native } = await entry.model.overview();
    return { workspace: entry.alias, instanceId: entry.instanceId, browserUrl: entry.service.url,
      native, fileReads: this.#reads.status(this.#scope(entry.alias)),
      customers: [...entry.customers.values()].map(value => ({ exportId: value.exportId,
        identity: value.identity, instanceId: value.instanceId, browserUrl: value.service.url })) };
  }
  async #open(alias) {
    const definition = this.#definition(alias);
    if (this.#entries.has(alias)) return this.#state(this.#entry(alias));
    if (this.#opening.has(alias)) return this.#opening.get(alias);
    const opening = (async () => {
      const [{ GeocodeWorkspace }, { createGeocodeServer }] = await Promise.all([
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/workspace.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/server.mjs'),
      ]);
      let model, service;
      try {
        model = await GeocodeWorkspace.open(definition.directory, { ...definition.configuration, env: this.#env });
        service = await createGeocodeServer({ workspace: model, port: 0 });
        if (this.#closing) throw failure('OPENCAGE_WORKSPACE_CLOSING', 'The original merchant operator is closing.');
        const entry = { alias, model, service, instanceId: randomUUID(), pending: new Set(),
          customers: new Map(), customerOpening: new Map(), closing: null };
        this.#entries.set(alias, entry);
        try { return await this.#state(entry); }
        catch (error) { this.#entries.delete(alias); throw error; }
      } catch (error) {
        if (service) await service.close().catch(() => {});
        else await model?.close().catch(() => {});
        throw error;
      }
    })();
    this.#opening.set(alias, opening);
    try { return await opening; } finally { this.#opening.delete(alias); }
  }
  #closeEntry(entry) {
    if (!entry.closing) entry.closing = (async () => {
      await Promise.allSettled([...entry.pending]);
      const outcomes = await Promise.allSettled([
        this.#reads.closeScope(this.#scope(entry.alias)),
        ...[...entry.customers.values()].map(customer => customer.service.close()),
      ]);
      try { await entry.service.close(); }
      finally {
        if (this.#entries.get(entry.alias) === entry) this.#entries.delete(entry.alias);
      }
      if (outcomes.some(value => value.status === 'rejected'))
        throw failure('OPENCAGE_SHUTDOWN_INCOMPLETE', 'An original customer browser or retained read did not finish closing.');
      return { workspace: entry.alias, instanceId: entry.instanceId,
        workspaceIdentity: entry.model.configuration.identity, state: 'CLOSED' };
    })();
    return entry.closing;
  }
  async #inspect(entry, input) {
    const { view, id, before, after, ...paging } = input;
    if (!views.includes(view)) throw failure('INVALID_PARAMS', 'Choose a declared OpenCage view.');
    const hasPages = ['requests', 'candidates', 'decisions', 'packages', 'deliveries'].includes(view);
    const needsId = ['request', 'candidates', 'decisions', 'package', 'delivery'].includes(view);
    if (needsId) geocodeId(id); else if (id !== undefined) throw failure('INVALID_PARAMS', 'This view does not select id.');
    if (view === 'release-diff') {
      geocodeId(after); if (before !== undefined) geocodeId(before);
    } else if (before !== undefined || after !== undefined) throw failure('INVALID_PARAMS', 'Only release-diff selects before and after.');
    if (!hasPages && Object.keys(paging).length) throw failure('INVALID_PARAMS', 'Only collection views accept paging.');
    const original = entry.model;
    if (view === 'status') return this.#state(entry);
    if (view === 'requests') return page((await original.overview()).requests, paging);
    if (['request', 'candidates', 'decisions'].includes(view)) {
      const value = await original.get(id), base = requestView(value);
      if (view === 'request') return base;
      return { request: value.request, responseSha256: value.responseSha256,
        decisionRevision: value.decision.revision, semantics: value.semantics,
        ...page(view === 'candidates' ? value.candidates : value.decision.history, paging) };
    }
    if (view === 'packages') return page((await original.listPackages()).map(({ packageId, manifest }) => ({
      packageId, identity: manifest.identity, planSha256: manifest.planSha256,
      termsSha256: manifest.termsSha256, files: manifest.files.length })), paging);
    if (view === 'package') {
      const bundle = await inspectGeocodePackage(join(original.directory, 'merchant-packages', id));
      return { packageId: id, manifest: bundle.manifest, plan: bundle.built.plan, terms: bundle.built.terms };
    }
    if (view === 'deliveries') return page(await original.listDeliveries(), paging);
    if (view === 'delivery') return { exportId: id, ...deliveryView((await original.openExport(id)).delivery) };
    return original.releaseDiff(before, after);
  }
  async #customer(entry, input) {
    const exportId = geocodeId(input.exportId);
    if (input.action === 'close') {
      const customer = entry.customers.get(exportId);
      if (!customer || customer.instanceId !== checked(input.instanceId, UUID, 'customer instance'))
        throw failure('OPENCAGE_CUSTOMER_INSTANCE_CONFLICT', 'Close the exact current customer instance owned by this process.');
      await customer.service.close(); entry.customers.delete(exportId);
      return { exportId, instanceId: customer.instanceId, state: 'CLOSED' };
    }
    if (input.action !== 'open' || input.instanceId !== undefined)
      throw failure('INVALID_PARAMS', 'Choose open without an instanceId, or close with the current instanceId.');
    if (entry.customers.has(exportId)) {
      const customer = entry.customers.get(exportId);
      return { exportId, instanceId: customer.instanceId, identity: customer.identity, browserUrl: customer.service.url };
    }
    if (entry.customerOpening.has(exportId)) return entry.customerOpening.get(exportId);
    const opening = (async () => {
      const { delivery } = await entry.model.openExport(exportId);
      const { createGeocodeServer } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/server.mjs');
      const service = await createGeocodeServer({ delivery, port: 0 });
      const customer = { exportId, service, identity: delivery.identity, instanceId: randomUUID() };
      entry.customers.set(exportId, customer);
      return { exportId, instanceId: customer.instanceId, identity: customer.identity, browserUrl: service.url };
    })();
    entry.customerOpening.set(exportId, opening);
    try { return await opening; } finally { entry.customerOpening.delete(exportId); }
  }
  async #file(entry, input) {
    geocodeId(input.id);
    const file = relativeFile(input.file);
    if (!['capture', 'delivery', 'package'].includes(input.kind))
      throw failure('INVALID_PARAMS', 'Choose an original capture, delivery or package.');
    if (input.readId !== undefined) checked(input.readId, UUID, 'file read');
    const key = JSON.stringify([input.kind, input.id, file]);
    const result = await this.#reads.read({ scope: this.#scope(entry.alias), key,
      kind: 'opencage-' + input.kind, directory: entry.model.directory,
      readId: input.readId, expectedSha256: input.expectedSha256, offset: input.offset, limit: input.limit,
      load: async () => {
        let bundle;
        if (input.kind === 'capture') {
          const value = await entry.model.get(input.id);
          if (!value.captureIdentity) throw failure('OPENCAGE_CAPTURE_PENDING', 'Read the original request state before receiving files.');
          bundle = await readBundle(join(entry.model.directory, 'requests', input.id, 'capture'), { schema: CAPTURE_SCHEMA });
          if (bundle.manifest.identity !== value.captureIdentity)
            throw failure('OPENCAGE_CAPTURE_CHANGED', 'The original capture changed during selection.');
        } else if (input.kind === 'delivery') {
          const original = await entry.model.openExport(input.id);
          bundle = await readBundle(original.directory, { schema: DELIVERY_SCHEMA });
          if (bundle.manifest.identity !== original.delivery.identity)
            throw failure('OPENCAGE_DELIVERY_CHANGED', 'The original delivery changed during selection.');
        } else bundle = await inspectGeocodePackage(join(entry.model.directory, 'merchant-packages', input.id));
        let bytes = file === 'manifest.json' ? await readBytes(join(bundle.directory, file), 1048576) : bundle.files.get(file);
        if (!bytes || file === 'manifest.json' && digest(bytes) !== bundle.manifestSha256)
          throw failure('OPENCAGE_ARTIFACT_CHANGED', 'Select a complete original file from the inspected manifest.');
        return { bytes: Buffer.from(bytes), name: file, type: contentType(file) };
      } });
    return { workspace: entry.alias, kind: input.kind, id: input.id, file, ...result };
  }
  async #execute(entry, name, args) {
    const { workspace, ...input } = args, original = entry.model, definition = this.#definition(workspace);
    const result = native => ({ workspace, native });
    switch (name) {
      case 'merchant_opencage_inspect': return result(await this.#inspect(entry, input));
      case 'merchant_opencage_query_review': return result(reviewQuery(original, input.productId, input.input));
      case 'merchant_opencage_capture': {
        const review = reviewQuery(original, input.productId, input.input);
        if (review.reviewSha256 !== checked(input.reviewSha256, SHA, 'query review'))
          throw failure('OPENCAGE_QUERY_REVIEW_CHANGED', 'Review this exact normalized query and workspace terms before dispatch.');
        return result(requestView(await original.capture({ id: input.id, productId: input.productId, input: review.query })));
      }
      case 'merchant_opencage_import_response': {
        const source = definition.imports[identifier(input.source, 'HTTP observation alias')];
        if (!source) throw failure('OPENCAGE_SOURCE_NOT_CONFIGURED', 'Choose an original HTTP observation alias.');
        const observation = parse(await loadFile(source.observation, 'HTTP observation'), 'Original HTTP observation');
        const bytes = await loadFile(source.response, 'provider response');
        return result(requestView(await original.importResponse({ id: input.id, productId: input.productId,
          input: input.input, observation, bytes })));
      }
      case 'merchant_opencage_adopt_buyer': {
        const selected = definition.buyers[identifier(input.buyer, 'Buyer client alias')];
        if (!selected) throw failure('OPENCAGE_BUYER_NOT_CONFIGURED', 'Choose an original Buyer client alias.');
        const config = parse(await loadFile(selected.file, 'Buyer client configuration'), 'Original Buyer client configuration');
        const { Buyer } = await import('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/client.mjs');
        const buyer = new Buyer(config);
        return result(requestView(await original.adoptBuyer({ id: input.id, productId: input.productId,
          operation: buyer.operation(line(input.intentId, 'Original Buyer intent')), packageId: input.packageId })));
      }
      case 'merchant_opencage_select': return result(requestView(await original.select(input)));
      case 'merchant_opencage_export': {
        const exported = await original.export(input);
        const reopened = await original.openExport(exported.exportId);
        return result({ exportId: exported.exportId, manifest: exported.manifest, delivery: deliveryView(reopened.delivery) });
      }
      case 'merchant_opencage_package': {
        if (input.source !== undefined && input.terms !== undefined)
          throw failure('INVALID_PARAMS', 'Choose either original package import or explicit payment terms.');
        if (input.source !== undefined) {
          const source = definition.packages[identifier(input.source, 'Package alias')];
          if (!source) throw failure('OPENCAGE_PACKAGE_NOT_CONFIGURED', 'Choose a host-declared original merchant package.');
          const bundle = await inspectGeocodePackage(source.directory);
          if (bundle.manifest.identity !== source.identity)
            throw failure('OPENCAGE_SOURCE_CHANGED', 'The host-selected original package changed.');
          return result(withoutDirectory(await original.importPackage(source.directory)));
        }
        return result(withoutDirectory(await original.package(input)));
      }
      case 'merchant_opencage_release': {
        const { action, ...values } = input;
        const rules = {
          stage: [['packageId', 'id', 'label'], ['packageId', 'id']],
          activate: [['id', 'expectedGeneration', 'reason'], ['id', 'expectedGeneration']],
          rollback: [['expectedGeneration', 'reason'], ['expectedGeneration']],
          start: [['expectedGeneration'], ['expectedGeneration']], stop: [[], []],
        };
        if (!Object.hasOwn(rules, action)) throw failure('INVALID_PARAMS', 'Choose an original release action.');
        exact(values, ...rules[action]);
        if (values.expectedGeneration !== undefined && (!Number.isSafeInteger(values.expectedGeneration) || values.expectedGeneration < 0))
          throw failure('INVALID_PARAMS', 'Use the original current release generation.');
        if (values.reason !== undefined) line(values.reason, 'Release reason');
        if (values.label !== undefined) line(values.label, 'Release label');
        if (action === 'stage') return result(await original.stage({ ...values, facilitator: definition.facilitator, port: 0 }));
        return result(await original[action](values));
      }
      case 'merchant_opencage_customer': return result(await this.#customer(entry, input));
      case 'merchant_opencage_file_read': return this.#file(entry, input);
      case 'merchant_opencage_file_release':
        await this.#reads.release(this.#scope(workspace), checked(input.readId, UUID, 'file read'));
        return { workspace, readId: input.readId, state: 'RELEASED' };
      default: throw failure('TOOL_NOT_FOUND', 'Unknown OpenCage merchant operation.');
    }
  }
  async call(name, args = {}) {
    if (this.#closing) throw failure('OPENCAGE_WORKSPACE_CLOSING', 'The original merchant operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Unknown OpenCage merchant operation.');
    exact(args, Object.keys(definition.properties), definition.required);
    try {
      if (name === 'merchant_opencage_workspaces') return this.summary;
      if (name === 'merchant_opencage_open') return await this.#open(args.workspace);
      if (name === 'merchant_opencage_close') {
        const entry = this.#entry(args.workspace);
        if (entry.instanceId !== checked(args.instanceId, UUID, 'workspace instance'))
          throw failure('OPENCAGE_INSTANCE_CONFLICT', 'Close only the exact current workspace instance owned by this process.');
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
          throw failure('OPENCAGE_SHUTDOWN_INCOMPLETE', 'An original OpenCage workspace reported incomplete shutdown.');
      })();
    }
    return this.#close;
  }
}
