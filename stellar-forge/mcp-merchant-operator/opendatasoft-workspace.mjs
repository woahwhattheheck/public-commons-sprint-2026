// MIT. One agent interface over the maintained Huwise / Opendatasoft workbench.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './host-files.mjs';
import { opendatasoftWorkspaceTools } from './catalog/opendatasoft-workspace.mjs';
import { OpendatasoftRetainedExports } from './opendatasoft-files.mjs';
export { opendatasoftWorkspaceTools } from './catalog/opendatasoft-workspace.mjs';
export const OPENDATASOFT_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.opendatasoft-workspace-connection.v1';
const NATIVE = '../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/';
const ID = /^[a-f0-9-]{36}$/, SHA = /^[a-f0-9]{64}$/;
const fail = (code, message) => failure('OPENDATASOFT_' + code, message);
const originalId = value => { if (!ID.test(value ?? '')) throw fail('ITEM_REQUIRED', 'Use the exact retained original item ID.'); return value; };
const digest = value => { if (!SHA.test(value ?? '')) throw fail('DIGEST_REQUIRED', 'Use the inspected original SHA256.'); return value; };
function count(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure('INVALID_PARAMS', 'Use an integer from ' + min + ' to ' + max + '.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw failure('CONFIGURATION_ERROR', 'Declare original paths in the private host connection.');
  return resolve(base, value);
}
async function connectionJSON(path) {
  if (await realpath(path) !== resolve(path)) throw failure('CONFIGURATION_ERROR', 'Use the canonical private connection file.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024 || process.platform !== 'win32' &&
        ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR', 'Use an owned 0600 Huwise connection JSON file of at most one MiB.');
    const bytes = await handle.readFile();
    if (bytes.length > 1024 * 1024) throw failure('CONFIGURATION_ERROR', 'The host connection file exceeds one MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
function named(value, label) {
  if (value === undefined) return [];
  if (!plain(value) || Object.keys(value).length > 32) throw failure('CONFIGURATION_ERROR', 'Declare at most 32 named ' + label + '.');
  return Object.entries(value).map(([name, entry]) => [identifier(name, label + ' alias'), entry]);
}
function endpoint(value, allowLoopback = false) {
  let url;
  try { url = new URL(value); } catch { throw failure('CONFIGURATION_ERROR', 'Declare an original seller or facilitator URL.'); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' &&
      !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1','[::1]'].includes(url.hostname)))
    throw failure('CONFIGURATION_ERROR', 'Use HTTPS or the explicitly configured original loopback endpoint.');
  return url.href.replace(/\/$/, '');
}
function runtime(value = {}) {
  exact(value, ['port','facilitator','allowLocalFacilitator']);
  if (value.allowLocalFacilitator !== undefined && typeof value.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR', 'allowLocalFacilitator must be a Boolean.');
  return { ...value, port: count(value.port ?? 0, 0, 65535),
    ...(value.facilitator ? { facilitator: endpoint(value.facilitator, value.allowLocalFacilitator === true) } : {}) };
}
/** Reading host configuration never opens a native project, listener or provider request. */
export async function readOpendatasoftWorkspaceConfiguration(path) {
  path = resolve(path);
  const input = await connectionJSON(path);
  exact(input, ['schema','workspaces'], ['schema','workspaces']);
  if (input.schema !== OPENDATASOFT_WORKSPACE_CONNECTION_SCHEMA || !plain(input.workspaces) ||
      Object.keys(input.workspaces).length < 1 || Object.keys(input.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 original Huwise / Opendatasoft workspaces.');
  const { catalogOrigin } = await import(NATIVE + 'capture.mjs');
  const workspaces = Object.create(null), used = new Set(), base = dirname(path);
  for (const [name, item] of named(input.workspaces, 'workspaces')) {
    exact(item, ['label','directory','origin','create','authTokenEnv','automationConnection','imports','merchants','sellers','runtime'], ['directory','origin']);
    const directory = await realpath(hostPath(item.directory, base));
    await privateSupportDirectory(directory);
    if (used.has(directory)) throw failure('CONFIGURATION_ERROR', 'Give each original Huwise project one alias.');
    used.add(directory);
    if (item.create !== undefined && typeof item.create !== 'boolean') throw failure('CONFIGURATION_ERROR', 'The host creation choice must be a Boolean.');
    if (item.authTokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.authTokenEnv))
      throw failure('CONFIGURATION_ERROR', 'Use the original portal credential environment-variable name.');
    const imports = Object.create(null), merchants = Object.create(null), sellers = Object.create(null);
    for (const [key, entry] of named(item.imports, 'capture imports')) {
      exact(entry, ['label','file'], ['file']);
      const file = await realpath(hostPath(entry.file, base)), info = await lstat(file);
      if (!info.isFile()) throw failure('CONFIGURATION_ERROR', 'Declare a regular complete original capture manifest.');
      imports[key] = { label: line(entry.label ?? key), file };
    }
    for (const [key, entry] of named(item.merchants, 'merchant profiles')) {
      exact(entry, ['label','origin','path','payment'], ['origin','path','payment']);
      if (!plain(entry.payment) || typeof entry.origin !== 'string' || typeof entry.path !== 'string')
        throw failure('CONFIGURATION_ERROR', 'A merchant profile contains its original payment, public origin and route.');
      merchants[key] = { label: line(entry.label ?? key), origin: entry.origin, path: entry.path, payment: entry.payment };
    }
    for (const [key, entry] of named(item.sellers, 'seller endpoints')) {
      exact(entry, ['label','url','allowLoopback'], ['url']);
      if (entry.allowLoopback !== undefined && typeof entry.allowLoopback !== 'boolean')
        throw failure('CONFIGURATION_ERROR', 'allowLoopback must be a Boolean.');
      sellers[key] = { label: line(entry.label ?? key), url: endpoint(entry.url, entry.allowLoopback === true) };
    }
    workspaces[name] = { label: line(item.label ?? name), directory, origin: catalogOrigin(item.origin), create: item.create === true,
      authTokenEnv: item.authTokenEnv,
      ...(item.automationConnection ? { automationConnection:await realpath(hostPath(item.automationConnection,base)) }: {}),
      imports, merchants, sellers, runtime: runtime(item.runtime) };
  }
  return { workspaces };
}
const pathKeys = new Set(['directory','file','out','targetDirectory','root','packageDirectory','configPath','sourceFile']);
function nativeView(value) {
  if (Array.isArray(value)) return value.map(nativeView);
  if (!plain(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    !(pathKeys.has(key) && typeof item === 'string' && (/^\//.test(item) || /^[A-Za-z]:/.test(item))))
    .map(([key, item]) => [key, nativeView(item)]));
}
function page(values, offset = 0, limit = 50) {
  count(offset); count(limit, 1, 100);
  const rows = values.slice(offset, offset + limit);
  return { rows, page: { offset, limit, total: values.length, nextOffset: offset + rows.length < values.length ? offset + rows.length : null } };
}
const item = (state, collection, id) => {
  const value = state[collection]?.find(row => row.id === originalId(id));
  if (!value) throw fail('ITEM_NOT_FOUND', 'Select an original item from this workspace.');
  return value;
};
function launched(started) {
  if (!started || typeof started.id !== 'string') throw fail('OPERATION_RESULT', 'Read the original workspace operation before continuing.');
  started.completion?.catch(() => {});
  return { operationId: started.id, ...(started.editionId ? { editionId: started.editionId } : {}) };
}
export class MerchantOpendatasoftWorkspaces {
  #config; #environment; #handles = new Map(); #pending = new Set(); #closing = false; #closed; #files;
  constructor(config, { environment = process.env } = {}) {
    this.#config = config; this.#environment = environment;
    this.#files = new OpendatasoftRetainedExports(config.exportsDirectory, name => this.#declared(name));
  }
  get summary() { return { configured: Boolean(this.#config.opendatasoftWorkspaces),
    opened: [...this.#handles.keys()], pending: this.#pending.size, closing: this.#closing, files: this.#files.summary }; }
  #declared(name) {
    identifier(name, 'Huwise workspace alias');
    const definition = this.#config.opendatasoftWorkspaces?.workspaces[name];
    if (!definition) throw fail('WORKSPACE_NOT_CONFIGURED', 'Choose one of the host-declared Huwise workspaces.');
    return definition;
  }
  async #open(name, browser = false) {
    const definition = this.#declared(name);
    if (typeof browser !== 'boolean') throw failure('INVALID_PARAMS', 'The browser option must be a Boolean.');
    if (!this.#handles.has(name)) {
      const pending = (async () => {
        let exists = true;
        try { await lstat(join(definition.directory, 'workbench.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
        if (!exists && !definition.create) throw fail('WORKSPACE_NOT_FOUND', 'The host must create or explicitly enable creation of this original workspace.');
        if (definition.authTokenEnv && !this.#environment[definition.authTokenEnv])
          throw fail('TOKEN_UNAVAILABLE', 'The original host-declared portal token is unavailable.');
        const { openOpendatasoftWorkbench } = await import(NATIVE + 'engine.mjs');
        const workbench = await openOpendatasoftWorkbench({ directory: definition.directory, create: !exists,
          origin: definition.origin, authTokenEnv: definition.authTokenEnv, automationConnection:definition.automationConnection, environment: this.#environment });
        return { definition, workbench, instanceId: randomUUID(), browser: null, browserPending: null, stopping: null, tail: Promise.resolve(), closing: false };
      })();
      this.#handles.set(name, pending);
      try { await pending; } catch (error) { if (this.#handles.get(name) === pending) this.#handles.delete(name); throw error; }
    }
    const handle = await this.#handles.get(name);
    if (handle.closing) throw fail('WORKSPACE_CLOSING', 'This original workspace is closing.');
    if (browser) await this.#browser(handle);
    return this.#status(name);
  }
  async #browser(handle) {
    if (handle.browser) return handle.browser;
    if (!handle.browserPending) handle.browserPending = (async () => {
      const { startOpendatasoftServer } = await import(NATIVE + 'workspace/server.mjs');
      const browser = await startOpendatasoftServer({ workbench: handle.workbench, port: 0 });
      handle.browser = browser;
      return browser;
    })();
    const pending = handle.browserPending;
    try { return await pending; }
    finally { if (handle.browserPending === pending) handle.browserPending = null; }
  }
  async #status(name, offset = 0, limit = 50) {
    count(offset); count(limit, 1, 100);
    if (name === undefined) return { ...this.summary,
      workspaces: Object.entries(this.#config.opendatasoftWorkspaces?.workspaces ?? {}).map(([workspace, definition]) => ({
        workspace, label: definition.label, origin: definition.origin, state: this.#handles.has(workspace) ? 'OPEN' : 'CLOSED',
        imports: Object.entries(definition.imports).map(([sourceImport, value]) => ({ sourceImport, label: value.label })),
        merchants: Object.entries(definition.merchants).map(([merchant, value]) => ({ merchant, label: value.label, origin: value.origin, path: value.path, payment: value.payment })),
        sellers: Object.entries(definition.sellers).map(([seller, value]) => ({ seller, label: value.label, url: value.url }))
      })) };
    const definition = this.#declared(name), pending = this.#handles.get(name);
    if (!pending) return { workspace: name, label: definition.label, origin: definition.origin, state: 'CLOSED' };
    const handle = await pending, state = handle.workbench.status(), history = {}, pages = {};
    for (const key of ['editions','sources','publications','exports','buyerRequests','tenantPlans','tenantExports']) {
      const result = page(state[key] ?? [], offset, limit); history[key] = nativeView(result.rows); pages[key] = result.page;
    }
    return { workspace: name, instanceId: handle.instanceId, state: handle.closing ? 'CLOSING' : 'OPEN',
      native: { schema: state.schema, catalogOrigin: state.catalogOrigin, createdAt: state.createdAt, updatedAt: state.updatedAt,
        active: state.active, operation: nativeView(state.operation), ...history, pages },
      browser: { open: Boolean(handle.browser), ...(handle.browser ? { url: handle.browser.url } : {}) } };
  }
  async #stop(name, handle) {
    if (handle.stopping) return handle.stopping;
    handle.closing = true;
    const stopping = (async () => {
      await handle.tail.catch(() => {});
      const errors = [];
      if (handle.browserPending) await handle.browserPending.catch(error => errors.push(error));
      if (handle.browser) {
        try { await handle.browser.close(); handle.browser = null; }
        catch (error) { errors.push(error); }
      }
      let nativeClosed = false;
      try { await handle.workbench.close(); nativeClosed = true; }
      catch (error) { errors.push(error); }
      if (nativeClosed && !handle.browser) this.#handles.delete(name);
      if (errors.length) throw new AggregateError(errors, 'An original Huwise resource did not finish closing.');
      return { workspace: name, instanceId: handle.instanceId, state: 'CLOSED' };
    })();
    handle.stopping = stopping;
    try { return await stopping; }
    finally { if (handle.stopping === stopping) handle.stopping = null; }
  }
  async #retain(name, handle, args) {
    digest(args.expectedCaptureSha256); count(args.expectedNotesRevision);
    const editionId = originalId(args.editionId);
    const selection = Object.fromEntries(['geometryField','sourceId','merchantExportId','buyerRequestId','tenantExportId'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    if (args.geometryField !== undefined && (typeof args.geometryField !== 'string' || !args.geometryField)) throw failure('INVALID_PARAMS', 'Choose an original geographic field.');
    let completed;
    try { completed = await this.#files.manifest(args.exportId); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (completed) {
      const retained = completed.manifest;
      if (retained.workspace !== name || retained.source.editionId !== editionId ||
          retained.source.captureSha256 !== args.expectedCaptureSha256 ||
          retained.source.notesRevision !== args.expectedNotesRevision ||
          JSON.stringify(retained.selection) !== JSON.stringify(selection))
        throw fail('EXPORT_CONFLICT', 'This export ID belongs to another source, notes revision or selection. Use its original request.');
      return completed;
    }
    const current = async () => {
      const edition = await handle.workbench.edition(editionId);
      if (edition.state !== 'COMPLETE' || edition.manifestSha256 !== args.expectedCaptureSha256 ||
          edition.notes?.revision !== args.expectedNotesRevision)
        throw fail('EDITION_CHANGED', 'Use the current complete original capture digest and notes revision.');
      return edition;
    };
    const edition = await current(), state = handle.workbench.status();
    const source = { catalogOrigin: state.catalogOrigin, datasetId: edition.datasetId, datasetUid: edition.datasetUid,
      editionId, captureSha256: edition.manifestSha256, notesRevision: edition.notes.revision, rowCount: edition.rowCount };

    if (args.sourceId && item(state, 'sources', args.sourceId).editionId !== editionId)
      throw fail('EXPORT_SELECTION_CHANGED', 'The selected source belongs to another original edition.');
    if (args.merchantExportId) {
      const exported = item(state, 'exports', args.merchantExportId), publication = item(state, 'publications', exported.publicationId);
      if (item(state, 'sources', publication.sourceId).editionId !== editionId)
        throw fail('EXPORT_SELECTION_CHANGED', 'The merchant package belongs to another original edition.');
      source.merchantManifestSha256 = exported.manifestSha256;
    }
    if (args.tenantExportId) {
      const tenant = await handle.workbench.tenantExport(originalId(args.tenantExportId));
      const plan = await handle.workbench.tenantPlan(tenant.planId);
      if (plan.source.editionId !== editionId || plan.source.captureSha256 !== source.captureSha256 ||
          plan.source.notesRevision !== source.notesRevision)
        throw fail('EXPORT_SELECTION_CHANGED','The tenant delivery belongs to another original source edition or notes revision.');
      source.tenantManifestSha256 = tenant.manifestSha256;
    }
    if (args.buyerRequestId) {
      const buyer = item(state, 'buyerRequests', args.buyerRequestId);
      if (!args.merchantExportId || buyer.exportId !== args.merchantExportId)
        throw fail('EXPORT_SELECTION_CHANGED', 'Include the same original merchant package as this buyer request.');
    }
    const prefix = '/api/editions/' + editionId + '/download?format=';
    const files = [
      { name: 'data.json', route: prefix + 'json', contentType: 'application/json' },
      { name: 'data.csv', route: prefix + 'csv', contentType: 'text/csv' },
      { name: 'data.geojson', route: prefix + 'geojson' + (args.geometryField ? '&geometryField=' + encodeURIComponent(args.geometryField) : ''), contentType: 'application/geo+json' },
      { name: 'review.html', route: prefix + 'html', contentType: 'text/html' },
      { name: 'DATASET-RECEIVING.md', contentType: 'text/markdown', content:
        '# Huwise dataset receiving\n\nThis delivery contains all ' + source.rowCount + ' retained rows from ' + source.catalogOrigin + ', dataset ' + source.datasetId +
        '.\n\nThe JSON file contains complete source metadata, original values and analyst notes. CSV cells contain JSON-encoded source values; parse each source cell as JSON to preserve null, empty text, arrays and exact number tokens. GeoJSON retains the selected geographic field and reports unavailable geometries. The HTML review includes every row and the original rights and attribution.\n\n' +
        'Use the maintained merchant opendatasoft download and reopen commands to receive and verify every manifest file. Keep the export manifest with these files. The saved capture SHA256 is ' + source.captureSha256 + ' and the notes revision is ' + source.notesRevision + '.\n\n' +
        (args.merchantExportId ? 'Extract merchant.tar.gz into a new private directory and follow MERCHANT-RECEIVING.md and the package RECEIVING.md. The package contains its original full capture, typed projection, reviewed candidate, dataset, handlers, OpenAPI and route declarations. Keep its selected manifest SHA256: ' + source.merchantManifestSha256 + '.\n\n' : '') +
        (args.sourceId ? 'source-declaration.json is the original host-bound field selection. Its capture path remains the original workspace binding; the portable merchant archive includes its own relative capture binding.\n\n' : '') +
        (args.buyerRequestId ? 'buyer-request.json is the original prepared buyer input for the selected merchant package and actual offer. Use the original buyer CLI and retained intent to continue it.\n' : '') }
    ];
    if (args.sourceId) files.push({ name: 'source-declaration.json', route: '/api/sources/' + args.sourceId + '/download', contentType: 'application/json' });
    if (args.merchantExportId) files.push(
      { name: 'merchant.tar.gz', route: '/api/exports/' + args.merchantExportId + '/download', contentType: 'application/gzip' },
      { name: 'MERCHANT-RECEIVING.md', route: '/api/exports/' + args.merchantExportId + '/guide', contentType: 'text/markdown' });
    if (args.buyerRequestId) files.push({ name: 'buyer-request.json', route: '/api/buyer-requests/' + args.buyerRequestId + '/download', contentType: 'application/json' });
    if (args.tenantExportId) files.push(
      { name:'tenant.tar.gz',route:'/api/tenant-deliveries/' + args.tenantExportId + '/download',contentType:'application/gzip' },
      { name:'TENANT-INGESTION.md',route:'/api/tenant-deliveries/' + args.tenantExportId + '/guide',contentType:'text/markdown' });
    const browser = await this.#browser(handle);
    return this.#files.retain({ exportId: args.exportId, workspace: name, source, selection, files, validate: current,
      receive: async file => {
        const response = await fetch(browser.origin + file.route, { headers: { authorization: 'Bearer ' + browser.token }, redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw failure(typeof result.error === 'string' ? result.error : 'OPENDATASOFT_NATIVE_FILE_FAILED', result.message ?? 'The original application file could not be read.');
        }
        return response;
      } });
  }
  async #execute(name, handle, args) {
    const native = handle.workbench, definition = handle.definition;
    switch (name) {
      case 'search': return native.search(args.query ?? {});
      case 'dataset': return native.dataset(args.datasetId);
      case 'preview': return native.previewRecords(args.datasetId, args.query ?? {});
      case 'capture': {
        exact(args.selection, ['datasetId','where','order_by','refine','exclude','lang','timezone','timeoutMs','maxResponseBytes','maxRows','maxBytes'], ['datasetId']);
        return launched(native.startCapture(args.selection));
      }
      case 'resume': return launched(native.resumeCapture(originalId(args.editionId), args.limits ?? {}));
      case 'import': {
        const input = definition.imports[identifier(args.sourceImport, 'Capture import')];
        if (!input) throw fail('IMPORT_NOT_CONFIGURED', 'Select a host-declared original capture import.');
        return launched(native.importCapture(input.file));
      }
      case 'edition': return nativeView(await native.edition(originalId(args.editionId)));
      case 'rows': return native.editionRows(originalId(args.editionId), { offset: args.offset ?? 0, limit: args.limit ?? 100 });
      case 'facets': return native.editionFacets(originalId(args.editionId), { field: args.field, limit: args.limit ?? 50, mode: args.mode ?? 'value' });
      case 'notes': return launched(native.saveEditionNotes(originalId(args.editionId), {
        expectedCaptureSha256: digest(args.expectedCaptureSha256), expectedRevision: count(args.expectedRevision), text: args.text, rowNotes: args.rowNotes }));
      case 'compare': {
        const result = await native.compare(originalId(args.before), originalId(args.after), args.key);
        const { changes, ...rest } = result, selected = page(changes, args.offset, args.limit);
        return { ...rest, changes: selected.rows, page: selected.page };
      }
      case 'source_save': return launched(native.saveSource(originalId(args.editionId), {
        expectedCaptureSha256: digest(args.expectedCaptureSha256), projection: args.projection, ...(args.query ? { query: args.query } : {}), ...(args.title ? { title: args.title } : {}) }));
      case 'publication_create': return launched(native.createPublication(originalId(args.sourceId), args.plan ?? {}));
      case 'publication': return nativeView(await native.publication(originalId(args.publicationId), args.query ?? ''));
      case 'publication_review': return launched(native.reviewPublication(originalId(args.publicationId), { expectedCandidateDigest: digest(args.expectedCandidateDigest), reviewer: args.reviewer, note: args.note }));
      case 'publication_recover': return launched(native.recoverPublication(originalId(args.publicationId)));
      case 'publication_publish': return launched(native.publishDataset(originalId(args.publicationId), args.reviewId));
      case 'merchant_export': {
        const merchant = definition.merchants[identifier(args.merchant, 'Merchant profile')];
        if (!merchant) throw fail('MERCHANT_NOT_CONFIGURED', 'Select a host-declared original merchant profile.');
        return launched(native.exportMerchant(originalId(args.publicationId), { expectedCandidateDigest: digest(args.expectedCandidateDigest),
          payment: merchant.payment, origin: merchant.origin, path: merchant.path }));
      }
      case 'merchant_stage': {
        if (await realpath(this.#config.releaseStore) !== join(definition.directory, 'seller-releases'))
          throw fail('SELLER_STORE_CHANGED', 'This MCP host controls another seller store. Bind this original workbench with init-opendatasoft-workspaces --workspace.');
        return launched(native.stageMerchant(originalId(args.merchantExportId), {
        expectedManifestSha256: digest(args.expectedManifestSha256), releaseId: identifier(args.releaseId, 'Release ID'),
        label: args.label, runtime: definition.runtime }));
      }
      case 'buyer_offer': case 'buyer_prepare': {
        const seller = definition.sellers[identifier(args.seller, 'Seller endpoint')];
        if (!seller) throw fail('SELLER_NOT_CONFIGURED', 'Select a host-declared original seller endpoint.');
        const input = { seller: seller.url, query: args.query ?? '' };
        if (name === 'buyer_offer') return native.buyerOffer(originalId(args.merchantExportId), input);
        return launched(native.prepareBuyer(originalId(args.merchantExportId), { ...input, intentId: args.intentId,
          acceptIndex: count(args.acceptIndex), offerSha256: digest(args.offerSha256) }));
      }
      case 'tenant_targets': return native.tenantTargets();
      case 'tenant_datasets': return native.tenantDatasets(identifier(args.target,'Tenant alias'),args.query ?? {});
      case 'tenant_prepare': {
        if (Object.hasOwn(args,'plan') === Object.hasOwn(args,'planJson') || (Object.hasOwn(args,'planJson') && typeof args.planJson !== 'string'))
          throw fail('PLAN_INPUT','Supply exactly one complete plan object or planJson string.');
        return launched(native.prepareTenantPlan(args.planJson ?? args.plan));
      }
      case 'tenant_plan': return nativeView(await native.tenantPlan(originalId(args.planId)));
      case 'tenant_inspect': return launched(native.inspectTenantPlan(originalId(args.planId)));
      case 'tenant_review': return launched(native.reviewTenantPlan(originalId(args.planId),{
        planSha256:digest(args.planSha256),configurationSha256:digest(args.configurationSha256),...(args.note ? { note:args.note }: {}) }));
      case 'tenant_apply': return launched(native.applyTenantPlan(originalId(args.planId),{ reviewId:originalId(args.reviewId) }));
      case 'tenant_recover': return launched(native.recoverTenantPlan(originalId(args.planId),args.recovery ?? {}));
      case 'tenant_status': return launched(native.refreshTenantStatus(originalId(args.planId)));
      case 'tenant_receive': return launched(native.receiveTenantPlan(originalId(args.planId),args.limits ?? {}));
      case 'tenant_export': return launched(native.exportTenantPlan(originalId(args.planId)));
      case 'tenant_delivery': return nativeView(await native.tenantExport(originalId(args.tenantExportId)));
      case 'export': return this.#retain(args.workspace, handle, args);
      default: throw failure('TOOL_NOT_FOUND', 'Choose an advertised original Huwise operation.');
    }
  }
  async #dispatch(fullName, args) {
    const name = fullName.replace(/^merchant_opendatasoft_/, '');
    if (name === 'status') return this.#status(args.workspace, args.offset, args.limit);
    if (name === 'manifest') return this.#files.manifest(args.exportId);
    if (name === 'exports') return this.#files.list(args);
    if (name === 'file') return this.#files.file(args);
    if (name === 'file_release') return this.#files.release(args.exportId, args.readId);
    this.#declared(args.workspace);
    if (name === 'open') return this.#open(args.workspace, args.browser ?? false);
    const pending = this.#handles.get(args.workspace);
    if (!pending) throw fail('WORKSPACE_NOT_OPEN', 'Open the declared original Huwise workspace first.');
    const handle = await pending;
    if (handle.closing) throw fail('WORKSPACE_CLOSING', 'This original workspace is closing.');
    if (name === 'close') {
      if (args.instanceId !== handle.instanceId) throw fail('INSTANCE_CONFLICT', 'Use this process-owned workbench instance ID.');
      return this.#stop(args.workspace, handle);
    }
    if (name === 'operation' || name === 'cancel') {
      const operation = handle.workbench.status().operation;
      if (!operation || operation.id !== originalId(args.operationId)) throw fail('OPERATION_CHANGED', 'Inspect the current original workspace operation before continuing.');
      if (name === 'operation') return { workspace: args.workspace, operation: nativeView(operation) };
      return handle.workbench.cancel();
    }
    const execution = handle.tail.then(() => {
      if (handle.closing) throw fail('WORKSPACE_CLOSING', 'This original workspace is closing.');
      return this.#execute(name, handle, args);
    });
    handle.tail = execution.then(() => {}, () => {});
    return execution;
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(fail('WORKSPACE_CLOSING', 'The Huwise merchant provider is closing.'));
    const pending = this.#dispatch(name, args);
    this.#pending.add(pending);
    pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
    return pending;
  }
  close() {
    if (this.#closed) return this.#closed;
    this.#closing = true;
    this.#closed = (async () => {
      await Promise.allSettled([...this.#pending]);
      const results = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => this.#stop(name, await pending)));
      await this.#files.close();
      if (results.some(result => result.status === 'rejected')) throw fail('SHUTDOWN_INCOMPLETE', 'An original Huwise workbench did not finish closing.');
    })();
    return this.#closed;
  }
}
