// MIT. Native accounting choices over the original OAuth registry and saved selections.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, privateDirectory, readJson, atomicJson, syncDirectory, identity, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { withOAuthConnectionLock } from '../../sf30-seller-sdk/oauth-connections/store.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from '../../sf30-seller-sdk/oauth-connections/host.mjs';
import { plain, hex, intuitQboProfile, xeroOAuthProfile } from '../../sf30-seller-sdk/oauth-connections/profile.mjs';
import { listQuickBooksConnections, previewQuickBooksSelection, validateQuickBooksSelection,
  readQuickBooksSelection, saveQuickBooksSelection, quickBooksSelectionSummary,
  openQuickBooksOAuthClient } from '../../sf30-seller-sdk/oauth-connections/quickbooks.mjs';
import { listXeroConnections, listXeroTenants, previewXeroSelection, validateXeroSelection,
  readXeroSelection, saveXeroSelection, xeroSelectionSummary, openXeroOAuthClient,
  XERO_SELECTION_BYTES } from '../../sf30-seller-sdk/oauth-connections/xero.mjs';
import { createOAuthWorkspaceAdapter } from '../../sf61-openapi-seller-import/workspace/oauth-http.mjs';
import { QboHttpClient } from '../accountant/qbo-http.mjs';

export const ACCOUNTING_CONNECTION_REQUEST_BYTES = 65536;
export const ACCOUNTING_SELECTION_REVIEW_SCHEMA = 'stellar-forge.accounting-connection-review.v1';
const REQUEST_SCHEMA = 'stellar-forge.accounting-connection-review-request.v1';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = ['quickbooks', 'xero'];
const need = (ok, code, message, status = 409) => { if (!ok) throw fault(code, message, status); };
const exact = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const cloned = value => structuredClone(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const id = value => { need(typeof value === 'string' && ID.test(value),
  'ACCOUNTING_CONNECTION_ID', 'Use the original connection review ID.', 400); return value; };
const kind = value => { need(KINDS.includes(value), 'ACCOUNTING_CONNECTION_KIND',
  'Choose QuickBooks or Xero accounting.', 400); return value; };
const selectedDirectory = (directory, provider) => join(directory, kind(provider));
const reviewDirectory = (directory, reviewId) => join(directory, 'reviews', id(reviewId));
const isNative = profile => intuitQboProfile(profile) || xeroOAuthProfile(profile);
const selectionSummary = (provider, selection) => !selection ? null :
  provider === 'quickbooks' ? quickBooksSelectionSummary(selection) : xeroSelectionSummary(selection);
const validateSelection = (provider, selection) => provider === 'quickbooks' ?
  validateQuickBooksSelection(selection) : validateXeroSelection(selection);
async function maybeRead(file, maximum) {
  try { return await readJson(file, maximum); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function readAccountingSelections(directory) {
  absolute(directory); await privateDirectory(directory);
  const output = {};
  for (const provider of KINDS) {
    try {
      output[provider] = provider === 'quickbooks' ?
        await readQuickBooksSelection(selectedDirectory(directory, provider)) :
        await readXeroSelection(selectedDirectory(directory, provider));
    } catch (error) { if (error.code !== 'ENOENT') throw error; output[provider] = null; }
  }
  return output;
}

function reviewRequest(raw) {
  need(exact(raw, ['id', 'kind', 'createdAt', 'alias', 'profileSha256', 'grantId', 'realmId',
    'environment', 'connectionId', 'tenantId', 'actor', 'reference', 'minorVersion',
    'expectedSelectionSha256']), 'ACCOUNTING_CONNECTION_REQUEST',
  'Use one complete native company or tenant review request.', 400);
  id(raw.id); kind(raw.kind);
  need(timestamp(raw.createdAt) && typeof raw.alias === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(raw.alias) &&
    hex(raw.profileSha256) && typeof raw.grantId === 'string' && raw.grantId.length <= 128 &&
    typeof raw.actor === 'string' && raw.actor.trim() && raw.actor.length <= 160 &&
    typeof raw.reference === 'string' && raw.reference.length <= 2000 &&
    (raw.expectedSelectionSha256 === null || hex(raw.expectedSelectionSha256)),
  'ACCOUNTING_CONNECTION_REQUEST', 'Keep the original review identity, reviewer, grant and saved-selection digest.', 400);
  if (raw.kind === 'quickbooks') {
    need(typeof raw.realmId === 'string' && /^[0-9]{1,64}$/.test(raw.realmId) &&
      ['sandbox', 'production'].includes(raw.environment) &&
      raw.connectionId === undefined && raw.tenantId === undefined &&
      (raw.minorVersion === null || raw.minorVersion === undefined ||
        typeof raw.minorVersion === 'string' && /^[1-9][0-9]{0,3}$/.test(raw.minorVersion)),
    'ACCOUNTING_CONNECTION_REQUEST', 'Choose the exact QuickBooks company and environment from its reviewed grant.', 400);
  } else {
    id(raw.connectionId); id(raw.tenantId);
    need(raw.realmId === undefined && raw.environment === undefined && raw.minorVersion === undefined,
      'ACCOUNTING_CONNECTION_REQUEST', 'A Xero selection uses its explicit connection and tenant IDs.', 400);
  }
  return cloned(raw);
}
function selectionMatches(request, selection) {
  need(selection.id === request.id && selection.createdAt === request.createdAt &&
    selection.alias === request.alias && selection.profileSha256 === request.profileSha256 &&
    selection.grantId === request.grantId && selection.review.actor === request.actor &&
    selection.review.reference === request.reference &&
    (request.kind === 'quickbooks' ? selection.realmId === request.realmId &&
      selection.environment === request.environment && selection.minorVersion === (request.minorVersion ?? null) :
      selection.connectionId === request.connectionId && selection.tenantId === request.tenantId),
  'ACCOUNTING_CONNECTION_REVIEW_CHANGED', 'The saved native source must match its original review request.');
}
function reviewView(request, selection, saved) {
  return {
    schema: ACCOUNTING_SELECTION_REVIEW_SCHEMA, id: request.id, kind: request.kind,
    createdAt: request.createdAt, state: saved ? 'SAVED' : selection ? 'PREVIEWED' : 'PENDING',
    expectedSelectionSha256: request.expectedSelectionSha256,
    target: Object.fromEntries(['alias', 'profileSha256', 'grantId', 'realmId', 'environment',
      'connectionId', 'tenantId', 'actor', 'reference'].filter(name => request[name] !== undefined)
      .map(name => [name, request[name]])),
    previewSha256: selection?.integrity.sha256 ?? null,
    selection: selectionSummary(request.kind, selection),
    files: selection ? ['selection.json', 'request.json'] : ['request.json'],
    savedAt: saved?.savedAt ?? null,
  };
}

/**
 * Host-selected private paths only. Opening this owner reads local state; original
 * grant and company/provider operations remain explicit commands on its routes.
 * Running accounting clients keep the selection captured at this owner's open.
 */
export async function openAccountingConnections({
  connectionsFile, selectionDirectory, env = process.env, allowLoopback = false, lookup, agent,
  fetchImpl = globalThis.fetch, timeoutMs, origin,
} = {}) {
  absolute(selectionDirectory); await privateDirectory(selectionDirectory, true);
  await privateDirectory(join(selectionDirectory, 'reviews'), true);
  need(typeof origin === 'function', 'ACCOUNTING_CONNECTION_ORIGIN',
    'The original accounting listener supplies its callback origin.', 400);
  const environment = { ...env }, stop = new AbortController(), flights = new Map(), active = new Set();
  const registry = await openOAuthConnectionRegistry({
    connections: await readOAuthHostConnections(connectionsFile), env: environment, allowLoopback,
    ...(lookup ? { lookup } : {}), ...(agent ? { agent } : {}),
  });
  let closing = false, closingPromise, qboOwner, xeroOwner, qboOpening, xeroOpening;
  let activeSelections, nativeStatuses = new Map();
  const runtime = { env: environment, allowLoopback, ...(lookup ? { lookup } : {}),
    ...(agent ? { agent } : {}), fetchImpl, ...(timeoutMs ? { timeoutMs } : {}) };
  const authorizeRegistry = {
    async list() {
      const values = (await registry.list()).filter(value => isNative(value.profile));
      for (const value of values) nativeStatuses.set(value.alias, value);
      return values;
    },
    async status(alias, options) {
      const value = await registry.status(alias, options);
      need(isNative(value.profile), 'ACCOUNTING_CONNECTION_ALIAS',
        'Choose a configured native accounting connection.', 400);
      nativeStatuses.set(alias, value); return value;
    },
    // This adapter borrows the registry. The complete accounting owner closes it
    // after its original native clients and connection actions have drained.
    async close() {},
  };
  for (const method of ['begin', 'complete', 'approve', 'discard', 'refresh', 'disconnect', 'revoke']) {
    authorizeRegistry[method] = async (alias, args) => {
      await authorizeRegistry.status(alias);
      const value = await registry[method](alias, args);
      await authorizeRegistry.status(alias);
      return value;
    };
  }
  const oauth = createOAuthWorkspaceAdapter({ registry: authorizeRegistry, origin, allowLoopback });
  const current = () => { need(!closing, 'ACCOUNTING_CONNECTION_CLOSING',
    'The accounting connection workspace is closing.'); stop.signal.throwIfAborted(); };
  async function tracked(work) {
    current(); const task = Promise.resolve().then(work); active.add(task);
    try { return await task; } finally { active.delete(task); }
  }
  async function selected(provider) {
    return (await readAccountingSelections(selectionDirectory))[provider];
  }
  function checkedRequest(wrapper, reviewId) {
    need(exact(wrapper, ['schema', 'request', 'requestSha256']) && wrapper.schema === REQUEST_SCHEMA &&
      hex(wrapper.requestSha256) && identity(wrapper.request) === wrapper.requestSha256,
    'ACCOUNTING_CONNECTION_REVIEW_CHANGED', 'The original review request changed.');
    const request = reviewRequest(wrapper.request);
    need(request.id === reviewId, 'ACCOUNTING_CONNECTION_REVIEW_CHANGED',
      'The review directory and request ID differ.');
    return request;
  }
  async function readReview(reviewId) {
    const directory = reviewDirectory(selectionDirectory, reviewId);
    await privateDirectory(directory);
    const wrapper = await readJson(join(directory, 'request.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
    const request = checkedRequest(wrapper, reviewId);
    const selection = await maybeRead(join(directory, 'selection.json'), XERO_SELECTION_BYTES);
    if (selection) { await validateSelection(request.kind, selection); selectionMatches(request, selection); }
    const saved = await maybeRead(join(directory, 'saved.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
    if (saved) need(exact(saved, ['id', 'previewSha256', 'savedAt']) && saved.id === reviewId &&
      timestamp(saved.savedAt) && selection?.integrity.sha256 === saved.previewSha256,
    'ACCOUNTING_CONNECTION_REVIEW_CHANGED', 'The retained selection completion changed.');
    return { directory, request, selection, saved };
  }
  async function retainView(directory, request, selection, saved) {
    const view = reviewView(request, selection, saved);
    await atomicJson(directory, 'projection.json', { view, sha256: identity(view) });
    return view;
  }
  async function resumeReviewInternal(reviewId) {
    id(reviewId);
    if (flights.has(reviewId)) return flights.get(reviewId);
    const task = Promise.resolve().then(() => withOAuthConnectionLock(reviewDirectory(selectionDirectory, reviewId), async () => {
      const original = await readReview(reviewId);
      if (original.selection) return retainView(original.directory, original.request, original.selection, original.saved);
      const request = original.request;
      const prior = await selected(request.kind);
      need((prior?.integrity.sha256 ?? null) === request.expectedSelectionSha256,
        'ACCOUNTING_CONNECTION_SELECTION_STALE', 'The saved company or tenant changed. Review its current selection.');
      stop.signal.throwIfAborted();
      const { kind: provider, expectedSelectionSha256, ...input } = request;
      const selection = await (provider === 'quickbooks' ? previewQuickBooksSelection : previewXeroSelection)(
        { ...input, registry, ...runtime, signal: stop.signal });
      await validateSelection(provider, selection); selectionMatches(request, selection);
      await atomicJson(original.directory, 'selection.json', selection);
      return retainView(original.directory, request, selection, null);
    })).finally(() => flights.delete(reviewId));
    flights.set(reviewId, task); return task;
  }
  function resumeReview(reviewId) { return tracked(() => resumeReviewInternal(reviewId)); }
  function preview(raw) { return tracked(async () => {
    const request = reviewRequest(raw), directory = reviewDirectory(selectionDirectory, request.id);
    await privateDirectory(directory, true);
    await withOAuthConnectionLock(directory, async () => {
      const existing = await maybeRead(join(directory, 'request.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
      const requestSha256 = identity(request);
      if (existing) {
        need(existing.schema === REQUEST_SCHEMA && existing.requestSha256 === requestSha256 &&
          identity(existing.request) === requestSha256, 'ACCOUNTING_CONNECTION_REQUEST_CHANGED',
        'Continue this review with its exact original request.');
        await syncDirectory(directory);
      } else await atomicJson(directory, 'request.json', { schema: REQUEST_SCHEMA, request, requestSha256 });
    });
    return resumeReviewInternal(request.id);
  }); }
  async function save(reviewId, value) {
    need(exact(value, ['previewSha256', 'selectionConfirmed']) && hex(value.previewSha256) &&
      value.selectionConfirmed === true, 'ACCOUNTING_CONNECTION_REVIEW_REQUIRED',
    'Confirm the exact reviewed company or tenant source before saving it.', 400);
    return tracked(() => withOAuthConnectionLock(reviewDirectory(selectionDirectory, reviewId), async () => {
      const original = await readReview(reviewId);
      need(original.selection && original.selection.integrity.sha256 === value.previewSha256,
        'ACCOUNTING_CONNECTION_REVIEW_REQUIRED', 'Select the exact retained company or tenant preview.');
      const saveSelection = original.request.kind === 'quickbooks' ? saveQuickBooksSelection : saveXeroSelection;
      const result = await saveSelection(selectedDirectory(selectionDirectory, original.request.kind), {
        registry, selection: original.selection, previewSha256: value.previewSha256,
        expectedSelectionSha256: original.request.expectedSelectionSha256,
      });
      const saved = original.saved ?? { id: reviewId, previewSha256: value.previewSha256,
        savedAt: new Date().toISOString() };
      await atomicJson(original.directory, 'saved.json', saved);
      return { ...await retainView(original.directory, original.request, original.selection, saved), duplicate: result.duplicate,
        restartRequired: activeSelections[original.request.kind]?.integrity.sha256 !== value.previewSha256 };
    }));
  }
  async function state() {
    const [quickbooks, xero, selections] = await Promise.all([
      listQuickBooksConnections(registry), listXeroConnections(registry), readAccountingSelections(selectionDirectory),
    ]);
    await authorizeRegistry.list();
    const providers = {};
    for (const provider of KINDS) providers[provider] = {
      selected: selectionSummary(provider, selections[provider]),
      active: selectionSummary(provider, activeSelections[provider]),
      restartRequired: (selections[provider]?.integrity.sha256 ?? null) !==
        (activeSelections[provider]?.integrity.sha256 ?? null),
    };
    return { providers, connections: { quickbooks, xero }, callbackOrigin: origin() };
  }
  async function history({ offset = 0, limit = 25 } = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'ACCOUNTING_CONNECTION_PAGE', 'Use a valid retained-review page.', 400);
    const names = (await readdir(join(selectionDirectory, 'reviews'))).filter(value => ID.test(value));
    const rows = [];
    for (const name of names) {
      const directory = reviewDirectory(selectionDirectory, name);
      await privateDirectory(directory);
      const wrapper = await maybeRead(join(directory, 'request.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
      // A stop between mkdir and the first atomic request write leaves no admitted
      // review. The same ID may complete initialization; other history stays usable.
      if (!wrapper) continue;
      const request = checkedRequest(wrapper, name);
      const projection = await maybeRead(join(directory, 'projection.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
      if (projection) {
        need(exact(projection, ['view', 'sha256']) && hex(projection.sha256) &&
          identity(projection.view) === projection.sha256 &&
          projection.view.schema === ACCOUNTING_SELECTION_REVIEW_SCHEMA &&
          projection.view.id === name && projection.view.kind === request.kind &&
          projection.view.createdAt === request.createdAt &&
          projection.view.expectedSelectionSha256 === request.expectedSelectionSha256,
        'ACCOUNTING_CONNECTION_REVIEW_CHANGED', 'The retained review summary changed.');
        const saved = await maybeRead(join(directory, 'saved.json'), ACCOUNTING_CONNECTION_REQUEST_BYTES);
        if (saved) {
          need(exact(saved, ['id', 'previewSha256', 'savedAt']) && saved.id === name &&
            timestamp(saved.savedAt) && saved.previewSha256 === projection.view.previewSha256,
          'ACCOUNTING_CONNECTION_REVIEW_CHANGED', 'The retained selection completion changed.');
        }
        rows.push(saved ? { ...projection.view, state: 'SAVED', savedAt: saved.savedAt } : projection.view);
      } else {
        const value = await readReview(name);
        rows.push(reviewView(value.request, value.selection, value.saved));
      }
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { reviews: rows.slice(offset, offset + limit), total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  async function accounts(reviewId, { offset = 0, limit = 100, query = '' } = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 &&
      limit <= 250 && typeof query === 'string' && query.length <= 200,
    'ACCOUNTING_CONNECTION_PAGE', 'Choose a valid native-account page.', 400);
    const original = await readReview(reviewId), selection = original.selection;
    need(selection, 'ACCOUNTING_CONNECTION_REVIEW_PENDING', 'Continue the original source capture first.');
    const rows = original.request.kind === 'quickbooks' ? selection.company.accounts : selection.context.accounts;
    const needle = query.trim().toLowerCase();
    const filtered = needle ? rows.filter(row => JSON.stringify(row).toLowerCase().includes(needle)) : rows;
    return { reviewId, previewSha256: selection.integrity.sha256, total: rows.length,
      matched: filtered.length, offset, accounts: cloned(filtered.slice(offset, offset + limit)),
      nextOffset: offset + limit < filtered.length ? offset + limit : null };
  }
  async function download(reviewId, name) {
    need(['request.json', 'selection.json'].includes(name), 'ACCOUNTING_CONNECTION_FILE',
      'Choose an original selection or request file.', 404);
    const original = await readReview(reviewId);
    if (name === 'selection.json') need(original.selection, 'ACCOUNTING_CONNECTION_REVIEW_PENDING',
      'Continue the original source capture before downloading its selection.');
    const bytes = await readFile(join(original.directory, name));
    return { bytes, name: original.request.kind + '-' + reviewId + '-' + name,
      type: 'application/json; charset=utf-8' };
  }
  function nativeState(provider) {
    const selection = activeSelections[provider];
    const status = selection ? nativeStatuses.get(selection.alias) : null;
    return { kind: 'oauth-connection', ...(selectionSummary(provider, selection) ?? {}),
      state: selection ? status?.grant.state ?? 'configured' : 'selection_required',
      selectionRequired: !selection, restartRequired: false };
  }
  async function openQbo() {
    current();
    need(activeSelections.quickbooks, 'ACCOUNTING_CONNECTION_SELECTION_REQUIRED',
      'Save a QuickBooks company in Connections, then reopen this accounting application.');
    if (!qboOpening) qboOpening = openQuickBooksOAuthClient({
      registry, selection: activeSelections.quickbooks, ...runtime,
    }).then(owner => { qboOwner = owner; return owner; }).catch(error => { qboOpening = null; throw error; });
    return qboOpening;
  }
  async function openXero() {
    current();
    need(activeSelections.xero, 'ACCOUNTING_CONNECTION_SELECTION_REQUIRED',
      'Save a Xero tenant in Connections, then reopen this accounting application.');
    if (!xeroOpening) xeroOpening = openXeroOAuthClient({
      registry, selection: activeSelections.xero, ...runtime, signal: stop.signal,
    }).then(owner => { xeroOwner = owner; return owner; }).catch(error => { xeroOpening = null; throw error; });
    return xeroOpening;
  }
  try {
    activeSelections = await readAccountingSelections(selectionDirectory);
    await authorizeRegistry.list();
    const qboSelection = activeSelections.quickbooks;
    const qboClient = new QboHttpClient({
      realmId: qboSelection?.realmId ?? '', environment: qboSelection?.environment ?? 'sandbox',
      minorVersion: qboSelection?.minorVersion ?? null,
      tokenProvider: async () => { throw fault('ACCOUNTING_CONNECTION_SELECTION_REQUIRED',
        'Use the original managed company provider.'); },
    });
    qboClient.available = () => Boolean(qboSelection) && !closing;
    qboClient.info = () => qboOwner ? qboOwner.client.info() : {
      available: qboClient.available(), realmId: qboSelection?.realmId ?? null,
      environment: qboSelection?.environment ?? 'sandbox', tokenEnv: null,
      minorVersion: qboSelection?.minorVersion ?? null, authorization: nativeState('quickbooks'),
    };
    for (const method of ['company', 'readJournal', 'createJournal', 'request']) {
      qboClient[method] = async (...args) => (await openQbo()).client[method](...args);
    }
    qboClient.searchJournal = async function* (...args) { yield* (await openQbo()).client.searchJournal(...args); };
    const xeroClient = {
      tokenEnv: null,
      available: () => Boolean(activeSelections.xero) && !closing,
      info: () => xeroOwner ? xeroOwner.client.info() : {
        available: Boolean(activeSelections.xero) && !closing, tokenEnv: null, authorization: nativeState('xero'),
      },
    };
    for (const method of ['context', 'createDraft', 'readJournal', 'request']) {
      xeroClient[method] = async (...args) => (await openXero()).client[method](...args);
    }
    const api = {
      qboClient: Object.freeze(qboClient), xeroClient: Object.freeze(xeroClient),
      activeSelections: Object.freeze(Object.fromEntries(KINDS.map(provider =>
        [provider, selectionSummary(provider, activeSelections[provider])]))),
      oauth, assertOpen: current, state, history, preview, resumeReview, save, accounts, download,
      async review(reviewId) { const value = await readReview(reviewId); return reviewView(value.request, value.selection, value.saved); },
      tenants(value) {
        need(exact(value, ['alias', 'profileSha256', 'grantId']), 'ACCOUNTING_CONNECTION_REQUEST',
          'Choose the reviewed Xero grant.', 400);
        return tracked(() => listXeroTenants({ ...value, registry, ...runtime, signal: stop.signal }));
      },
      stop() { closing = true; stop.abort(); },
      close() {
        if (!closingPromise) {
          api.stop();
          closingPromise = (async () => {
            await Promise.allSettled([...active, qboOpening, xeroOpening].filter(Boolean));
            const errors = [];
            for (const owner of [qboOwner, xeroOwner, oauth, registry]) {
              try { await owner?.close(); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw Object.assign(new AggregateError(errors,
              'The original accounting connection owners did not all close cleanly.'),
            { code: 'ACCOUNTING_CONNECTION_CLOSE_FAILED' });
          })();
        }
        return closingPromise;
      },
    };
    return Object.freeze(api);
  } catch (error) { await registry.close().catch(() => {}); throw error; }
}

/** Same original accounting HTTP request gates; this function adds only native selection routes. */
export async function handleAccountingConnections(owner, { method, path, value, query = {} }) {
  if (!owner) return null;
  owner.assertOpen();
  if (path === '/api/oauth/connections' && method === 'GET') return { value: await owner.oauth.list() };
  if (path === '/api/oauth/connection' && method === 'GET')
    return { value: await owner.oauth.status(query.alias, query.flowId) };
  if (path === '/api/oauth/command' && method === 'POST') return { value: await owner.oauth.command(value) };
  if (path !== '/api/accounting-connections' && !path.startsWith('/api/accounting-connections/')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2 && method === 'GET') return { value: await owner.state() };
  if (path === '/api/accounting-connections/tenants' && method === 'POST')
    return { value: await owner.tenants(value) };
  if (path === '/api/accounting-connections/reviews' && method === 'GET')
    return { value: await owner.history({ offset: Number(query.offset ?? 0), limit: Number(query.limit ?? 25) }) };
  if (path === '/api/accounting-connections/reviews' && method === 'POST')
    return { value: await owner.preview(value) };
  if (parts[2] === 'reviews' && parts[3]) {
    if (parts.length === 4 && method === 'GET') return { value: await owner.review(parts[3]) };
    if (parts.length === 5 && parts[4] === 'resume' && method === 'POST') {
      need(exact(value, []), 'ACCOUNTING_CONNECTION_REQUEST', 'Continue the exact retained source request.', 400);
      return { value: await owner.resumeReview(parts[3]) };
    }
    if (parts.length === 5 && parts[4] === 'select' && method === 'POST')
      return { value: await owner.save(parts[3], value) };
    if (parts.length === 5 && parts[4] === 'accounts' && method === 'GET')
      return { value: await owner.accounts(parts[3], { offset: Number(query.offset ?? 0),
        limit: Number(query.limit ?? 100), query: query.query ?? '' }) };
    if (parts.length === 6 && parts[4] === 'download' && method === 'GET')
      return { file: await owner.download(parts[3], parts[5]) };
  }
  throw fault('ACCOUNTING_CONNECTION_ROUTE', 'Choose an existing native accounting connection operation.', 404);
}
