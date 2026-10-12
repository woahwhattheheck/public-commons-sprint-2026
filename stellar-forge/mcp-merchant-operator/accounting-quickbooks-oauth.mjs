// MIT. One original reviewed QuickBooks connection for the existing accounting owner.
import { QboHttpClient } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-http.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/host.mjs';
import { readQuickBooksSelection, quickBooksSelectionSummary, listQuickBooksConnections, openQuickBooksOAuthClient } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/quickbooks.mjs';

const fault = (code, message) => Object.assign(new Error(message), { code });
const codeOf = error => /^(?:ACCOUNTING_|QBO_|OAUTH_)[A-Z0-9_]{1,100}$/.test(error?.code ?? '')
  ? error.code : 'ACCOUNTING_QBO_OAUTH_UNAVAILABLE';
const copy = value => structuredClone(value);

/**
 * Read the host's original company selection without acquiring a bearer or
 * making a provider request. A revoked/replaced grant leaves historical native
 * records available; the original OAuth client admits every external operation.
 */
export async function openMerchantQuickBooksConnection(definition, {
  environment = process.env, allowLoopback = false, lookup, fetchImpl = globalThis.fetch,
} = {}) {
  let registry, owner = null;
  const selected = await readQuickBooksSelection(definition.selectionDirectory);
  if (definition.expectedSelectionSha256 !== null &&
      definition.expectedSelectionSha256 !== undefined &&
      definition.expectedSelectionSha256 !== selected.integrity.sha256)
    throw fault('ACCOUNTING_QBO_SELECTION_CHANGED', 'The saved company differs from the selection pinned by this host configuration.');
  const selection = copy(selected), summary = quickBooksSelectionSummary(selection);
  const env = { ...environment }, active = new Set();
  let closed = false, closing = null, opening = null, refreshing = null, current = null,
    bindingMatches = false, ready = false, lastError = null;
  // This native instance supplies only target and endpoint validation. All
  // source reads and journal I/O delegate to openQuickBooksOAuthClient below.
  const target = new QboHttpClient({ realmId: selection.realmId, environment: selection.environment,
    minorVersion: selection.minorVersion, tokenProvider: async () => {
      throw fault('ACCOUNTING_QBO_OAUTH_REQUIRED', 'Use the original reviewed OAuth client for provider operations.');
    } });
  const accepting = () => {
    if (closed) throw fault('ACCOUNTING_QBO_OAUTH_CLOSED', 'The owned QuickBooks connection is closed.');
  };
  const info = () => {
    const provider = owner?.snapshot().provider ?? null;
    return { ...target.info(), available: !closed && ready, tokenEnv: null,
      authorization: { kind: 'oauth-connection', alias: selection.alias,
        profileSha256: selection.profileSha256, grantId: selection.grantId,
        realmId: selection.realmId, environment: selection.environment,
        companyName: summary.companyName, state: closed ? 'closed' : current?.state ?? 'unavailable',
        ready: !closed && ready, bindingMatches, lastError: lastError ?? provider?.lastError ?? null },
      selection: copy(summary),
      connection: current ? { alias: current.alias, profileSha256: current.profileSha256,
        grantId: current.grantId, realmId: current.realmId, environment: current.environment,
        state: current.state, sourceMatches: current.sourceMatches, ready: current.ready,
        refreshExpiresAt: current.refreshExpiresAt, refreshHardExpiresAt: current.refreshHardExpiresAt } : null,
      provider };
  };
  function refresh() {
    accepting();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        current = (await listQuickBooksConnections(registry)).find(value => value.alias === selection.alias) ?? null;
        bindingMatches = Boolean(current && current.sourceMatches &&
          current.directoryEnv === selection.binding.directoryEnv &&
          current.profileSha256 === selection.profileSha256 && current.grantId === selection.grantId &&
          current.realmId === selection.realmId && current.environment === selection.environment);
        ready = Boolean(bindingMatches && current.ready);
        lastError = !bindingMatches ? 'QBO_OAUTH_COMPANY_CHANGED'
          : !ready ? 'QBO_OAUTH_GRANT_REQUIRED' : null;
      } catch (error) {
        current = null; bindingMatches = false; ready = false; lastError = codeOf(error);
      }
      return info();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function assertReady() {
    accepting();
    if (!ready) throw fault(lastError ?? 'QBO_OAUTH_GRANT_REQUIRED',
      bindingMatches ? 'Reconnect the selected reviewed grant in the original OAuth workspace before provider operations.'
        : 'Select the current reviewed QuickBooks company in the original OAuth workspace, then reopen this accounting workspace.');
  }
  async function connected(signal) {
    accepting(); signal?.throwIfAborted();
    await refresh(); accepting(); signal?.throwIfAborted(); assertReady();
    if (!owner && !opening) {
      opening = openQuickBooksOAuthClient({ registry, selection, env, allowLoopback, lookup, fetchImpl })
        .then(value => { owner = value; return value; })
        .catch(error => { ready = false; lastError = codeOf(error); throw error; })
        .finally(() => { opening = null; });
    }
    const selectedOwner = owner ?? await opening;
    accepting(); signal?.throwIfAborted();
    return selectedOwner.client;
  }
  function run(operation, signal) {
    accepting();
    const task = (async () => operation(await connected(signal)))();
    active.add(task);
    task.then(() => active.delete(task), () => active.delete(task));
    return task;
  }
  const client = Object.freeze({
    available: () => !closed && ready,
    info,
    target(value) { assertReady(); target.target(value); return info(); },
    endpoint: (path, options) => target.endpoint(path, options),
    company: (value, options = {}) => run(client => client.company(value, options), options.signal),
    readJournal: (plan, journalId, options = {}) => run(client => client.readJournal(plan, journalId, options), options.signal),
    createJournal: (plan, options = {}) => run(client => client.createJournal(plan, options), options.signal),
    async *searchJournal(plan, options = {}) {
      accepting();
      let release;
      const retained = new Promise(resolve => { release = resolve; });
      active.add(retained);
      try {
        const native = await connected(options.signal);
        yield* native.searchJournal(plan, options);
      } finally { active.delete(retained); release(); }
    },
  });
  const close = () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      // The workspace first aborts/drains its native controller and admitted
      // callers. Finish those original calls before closing their credential owner.
      await Promise.allSettled([...active, ...(refreshing ? [refreshing] : []), ...(opening ? [opening] : [])]);
      const errors = [];
      for (const item of [owner, registry]) {
        if (!item) continue;
        try { await item.close(); } catch (error) { errors.push(error); }
      }
      owner = null; registry = null;
      if (errors.length) throw Object.assign(new AggregateError(errors, 'The original QuickBooks connection did not close cleanly.'),
        { code: 'ACCOUNTING_QBO_OAUTH_CLOSE_FAILED' });
    })();
    return closing;
  };
  try {
    registry = await openOAuthConnectionRegistry({
      connections: await readOAuthHostConnections(definition.connectionsFile), env, allowLoopback, lookup,
    });
    await refresh();
    return Object.freeze({ client, connection: refresh, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
