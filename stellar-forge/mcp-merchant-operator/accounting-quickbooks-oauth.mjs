// MIT. One original reviewed QuickBooks connection for the existing accounting owner.
import { join, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeOAuthProfile, oauthProfileIdentity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/profile.mjs';
import { MAX_STATE_BYTES, STATE_SCHEMA } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/store.mjs';
import { QboHttpClient } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/qbo-http.mjs';
import { HOST_CONNECTIONS_SCHEMA, normalizeOAuthHostConnections, readOAuthHostConnections, openOAuthConnectionRegistry } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/host.mjs';
import { QUICKBOOKS_SELECTION_BYTES, validateQuickBooksSelection, readQuickBooksSelection, quickBooksSelectionSummary, listQuickBooksConnections, openQuickBooksOAuthClient } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/quickbooks.mjs';

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


/**
 * Trusted source resolver for the original encrypted accounting recovery owner.
 * The supplied reader is either its checked live source reader or its authenticated
 * staging reader. It must never fall back to live files during cold restoration.
 */
export function merchantQuickBooksRecoverySources(definition, {
  environment = process.env, allowLoopback = false, onPaths = () => {},
} = {}) {
  const env = {...environment}, configured = {...definition};
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const require = (yes, message) => {
    if (!yes) throw Object.assign(new Error(message), {code:'ACCOUNTING_QBO_RECOVERY_SOURCES'});
  };
  const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key));
  const absolute = value => typeof value === 'string' && isAbsolute(value) && value !== '/' &&
    resolve(value) === value && !/[\\\\\x00-\x1f\x7f]/.test(value);
  return async ({readFile}) => {
    require(typeof readFile === 'function', 'Use the original accounting source reader.');
    async function read(path, limit, label) {
      try {
        const bytes = await readFile(path, limit);
        require(bytes.length <= limit, 'An original OAuth recovery source exceeds its supported size.');
        return {value:JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)), sha256:hash(bytes)};
      } catch (error) {
        if (error.code?.startsWith('ACCOUNTING_RECOVERY_')) throw error;
        throw Object.assign(new Error('Cannot read the original ' + label + ' through the selected recovery source map.'),
          {code:'ACCOUNTING_QBO_RECOVERY_SOURCES'});
      }
    }
    const source = await read(configured.connectionsFile, 65536, 'OAuth connections configuration');
    require(fields(source.value, ['schema','connections']) && source.value.schema === HOST_CONNECTIONS_SCHEMA,
      'Use the original OAuth host connections configuration.');
    const connections = normalizeOAuthHostConnections(source.value.connections);
    const selected = await read(join(configured.selectionDirectory, 'selection.json'), QUICKBOOKS_SELECTION_BYTES,
      'reviewed QuickBooks company selection');
    const selection = await validateQuickBooksSelection(selected.value);
    if (configured.expectedSelectionSha256 && configured.expectedSelectionSha256 !== selection.integrity.sha256)
      throw Object.assign(new Error('The retained QuickBooks selection differs from the company pin in this merchant host.'),
        {code:'ACCOUNTING_QBO_SELECTION_CHANGED'});
    require(connections.some(item => item.alias === selection.alias && item.directoryEnv === selection.binding.directoryEnv),
      'Retain the selected company alias and its original directory environment reference.');
    const directories = new Set(), references = new Set(), stores = [];
    for (const item of [...connections].sort((a,b) => a.alias.localeCompare(b.alias))) {
      const directory = env[item.directoryEnv];
      require(Object.hasOwn(env, item.directoryEnv) && absolute(directory) && !directories.has(directory),
        'Provision each configured OAuth directory environment reference at its original private path.');
      directories.add(directory); references.add(item.directoryEnv);
      stores.push({...item,directory});
    }
    const roots = [
      {name:'QuickBooksConnections',path:configured.connectionsFile,kind:'file'},
      {name:'QuickBooksSelection',path:configured.selectionDirectory,kind:'directory'},
      ...stores.map(item => ({name:'OAuth-' + item.alias,path:item.directory,kind:'directory'})),
    ];
    onPaths(roots.map(item => ({...item})));
    const identities = [];
    for (const item of stores) {
      const captured = await read(join(item.directory, 'connection.json'), MAX_STATE_BYTES,
        'authorization state for alias ' + item.alias);
      const state = captured.value;
      require(state && state.schema === STATE_SCHEMA && typeof state.id === 'string',
        'Keep the original private OAuth connection state.');
      const profile = normalizeOAuthProfile(state.profile, {allowLoopback});
      require(state.profileSha256 === oauthProfileIdentity(profile),
        'The retained OAuth profile differs from its native profile identity.');
      if (profile.clientSecretEnv) references.add(profile.clientSecretEnv);
      identities.push({...item,connectionId:state.id,profileSha256:state.profileSha256,
        ...(profile.clientSecretEnv ? {clientSecretEnv:profile.clientSecretEnv} : {})});
      // Tokens, exchange bodies, consent state and secret environment values stay
      // only in their original opaque file bytes inside the encrypted snapshot.
    }
    return {
      schema:'stellar-forge.accounting-host-source-profile.v1',kind:'quickbooks-oauth',
      binding:{
        connectionsFile:configured.connectionsFile,selectionDirectory:configured.selectionDirectory,
        expectedSelectionSha256:configured.expectedSelectionSha256 ?? null,
        connectionsSha256:source.sha256,selectionFileSha256:selected.sha256,
        selection:{id:selection.id,sha256:selection.integrity.sha256,alias:selection.alias,
          directoryEnv:selection.binding.directoryEnv,profileSha256:selection.profileSha256,
          grantId:selection.grantId,realmId:selection.realmId,environment:selection.environment},
        connections:identities,
      },
      roots,requiredEnvironment:[...references].sort(),
    };
  };
}
