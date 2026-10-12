// MIT. Original Applications host setup for source-bound OpenAPI OAuth connections.
// This view handles registration metadata; the original OAuth store owns grants.
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  if (className) result.className = className;
  return result;
};
const button = (label, action) => {
  const result = node('button', label); result.type = 'button';
  result.addEventListener('click', action); return result;
};
const field = (label, input, note) => {
  const result = node('label', label); result.append(input);
  if (note) result.append(node('p', note, 'note'));
  return result;
};
const input = (id, { type = 'text', required = false, maxLength } = {}) => {
  const result = node('input'); result.id = id; result.type = type;
  result.autocomplete = 'off'; result.required = required;
  if (maxLength) result.maxLength = maxLength;
  return result;
};
function facts(rows) {
  const result = node('dl', undefined, 'paths');
  for (const [name, value] of rows) {
    const row = node('div'); row.append(node('dt', name), node('dd', value ?? 'Not selected')); result.append(row);
  }
  return result;
}
const copy = value => JSON.parse(JSON.stringify(value));
const scopeNames = value => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : item.name) :
  value && typeof value === 'object' ? Object.keys(value) : [];
const routeAction = action => ({ 'source.import': 'import-source', 'source.inspect': 'inspect-source' })[action] ?? action;
const selectionKey = selection => JSON.stringify([selection.method, selection.path, selection.serverIndex, selection.securityAlternative]);
const validPort = value => Number.isInteger(Number(value)) && Number(value) >= 1024 && Number(value) <= 65535;
const sameFlow = (a, b) => a.scheme === b.scheme && a.authorizationEndpoint === b.authorizationEndpoint &&
  a.tokenEndpoint === b.tokenEndpoint;
const errorText = issue => (issue?.code ? issue.code + ': ' : '') + (issue?.message ?? String(issue));
function jsonField(value, label, array = false) {
  let result;
  try { result = JSON.parse(value || (array ? '[]' : '{}')); } catch { throw new Error(label + ' must be valid JSON.'); }
  if (array ? !Array.isArray(result) : !result || typeof result !== 'object' || Array.isArray(result))
    throw new Error(label + (array ? ' must be a JSON array.' : ' must be a JSON object.'));
  return result;
}
function profileFacts(entry) {
  const profile = entry.profile ?? {};
  return facts([
    ['Connection', entry.alias ?? entry.retainAlias],
    ['Provider', profile.label ?? entry.label],
    ['Original source SHA-256', profile.source?.sha256],
    ['Security scheme', profile.source?.scheme],
    ['Authorization endpoint', profile.authorizationEndpoint],
    ['Token endpoint', profile.tokenEndpoint],
    ['Client ID', profile.clientId],
    ['Client authentication', profile.authMethod],
    ['Client-secret environment name', profile.clientSecretEnv ?? 'Public client'],
    ['Exact callback to register', entry.callbackUri],
    ['Approved resource origins', profile.resourceOrigins?.join('\n')],
    ['Registered scopes', profile.scopes?.join('\n') || 'No scopes'],
    ['Private directory environment name', entry.directoryEnv],
    ['Profile SHA-256', entry.profileSha256],
  ]);
}

/**
 * Mount outside the Applications configuration form. getContext returns
 * {workspaceId,runtimeId,applicationId,kind,environmentFile,connectionsFile,port,
 * allowLoopbackOAuth}. onPrepared receives only the four reviewed settings.
 */
export function createOpenApiConnectionSetupView({ root, api, getContext, onPrepared, message, error }) {
  let generation = 0, active = null, signature = '', catalog = null, loading = false, busy = false;
  let desired = [], dirty = false, stale = false, inspection = null, editing = null, reviewed = null;
  let prepared = null, pending = null, operationStatus, selectedEdition = null;
  let inspectionGeneration = 0, sourceReadGeneration = 0, loadedSourceText = null;
  const sourceCache = new Map();
  const panel = node('details', undefined, 'panel'); panel.id = 'openapi-connection-setup';
  panel.append(node('summary', 'Set up provider connections'));
  const intro = node('p', 'Import the provider’s original OpenAPI definition, review its declared authorization flow, and create a connection edition for this application.', 'note');
  const status = node('p', '', 'note'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const available = node('div'), unavailable = node('p', '', 'note');
  const toolbar = node('div', undefined, 'actions');
  const reload = button('Reload saved configuration', () => run(() => loadCatalog({ resetEntries: true })));
  const refreshStatus = button('Refresh connection status', () => run(() => refresh({ force: true })));
  toolbar.append(reload, refreshStatus);
  const callbackPort = input('openapi-setup-port', { type: 'number', required: true });
  callbackPort.min = '1024'; callbackPort.max = '65535';
  const portField = field('Application callback port', callbackPort,
    'Use a fixed local port. Every exact callback address is shown before connections are created; this port is applied with the reviewed settings.');
  const counts = node('p', '', 'note');
  const pendingPanel = node('section', undefined, 'result'); pendingPanel.hidden = true;
  const controls = node('fieldset'); controls.append(node('legend', 'Connection configuration'));
  const sourceSection = node('details'); sourceSection.open = true; sourceSection.append(node('summary', '1. Import the original provider definition'));
  const sourceForm = node('form');
  const sourceFile = input('openapi-setup-source-file', { type: 'file' });
  sourceFile.accept = '.json,.yaml,.yml,application/json,application/yaml,text/yaml';
  const sourceLabel = input('openapi-setup-source-label', { required: true, maxLength: 160 });
  const sourceText = node('textarea'); sourceText.id = 'openapi-setup-source-text'; sourceText.rows = 8; sourceText.spellcheck = false;
  const importButton = node('button', 'Import and inspect source'); importButton.type = 'submit';
  const sourceNote = node('p', 'Choose the original UTF-8 file or paste its complete contents. Imported definitions remain available by their original byte hash.', 'note');
  sourceForm.append(field('OpenAPI file', sourceFile), field('Source name', sourceLabel),
    field('Complete source text', sourceText), sourceNote, importButton);
  sourceSection.append(sourceForm);

  const editor = node('details'); editor.open = true; editor.append(node('summary', '2. Add or replace a connection'));
  const editorForm = node('form');
  const alias = input('openapi-setup-alias', { required: true, maxLength: 128 }); alias.pattern = '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}';
  const label = input('openapi-setup-label', { required: true, maxLength: 160 });
  const directoryEnv = input('openapi-setup-directory-env', { required: true, maxLength: 128 }); directoryEnv.pattern = '[A-Za-z_][A-Za-z0-9_]{0,127}';
  const sourceSelect = node('select'); sourceSelect.id = 'openapi-setup-source'; sourceSelect.required = true;
  const sourceIdentity = node('p', '', 'note'), operationChoices = node('div');
  const sourceProblems = node('div'), flowFacts = node('div'), scopeChoices = node('div');
  const clientId = input('openapi-setup-client-id', { required: true, maxLength: 4096 });
  const authMethod = node('select'); authMethod.id = 'openapi-setup-auth-method';
  authMethod.append(new Option('Public client with PKCE', 'none'), new Option('Client secret in Basic authentication', 'client_secret_basic'),
    new Option('Client secret in token request body', 'client_secret_post'));
  const secretEnv = node('select'); secretEnv.id = 'openapi-setup-secret-env';
  const secretField = field('Client-secret environment name', secretEnv,
    'Select an existing host environment reference. The secret value stays in the receiving host’s private environment.');
  const advanced = node('details'); advanced.append(node('summary', 'Additional registered provider settings'));
  const revocationEndpoint = input('openapi-setup-revocation', { maxLength: 2048 });
  const issuer = input('openapi-setup-issuer', { maxLength: 2048 });
  const authorizationParameters = node('textarea'); authorizationParameters.id = 'openapi-setup-authorization-parameters'; authorizationParameters.rows = 3;
  const resourceParameters = node('textarea'); resourceParameters.id = 'openapi-setup-resource-parameters'; resourceParameters.rows = 3;
  authorizationParameters.value = '{}'; resourceParameters.value = '[]';
  advanced.append(field('Revocation endpoint', revocationEndpoint), field('Expected issuer', issuer),
    field('Additional authorization parameters (JSON object)', authorizationParameters),
    field('Resource parameters (JSON array)', resourceParameters));
  const editNote = node('p', '', 'note');
  const addButton = node('button', 'Add connection to review'); addButton.type = 'submit';
  const cancelEdit = button('Clear connection form', () => clearEditor());
  const editorActions = node('div', undefined, 'actions'); editorActions.append(addButton, cancelEdit);
  const identityFields = node('div', undefined, 'columns');
  identityFields.append(field('Connection alias', alias), field('Display name', label));
  const clientFields = node('div', undefined, 'columns');
  clientFields.append(field('Registered client ID', clientId), field('Token endpoint authentication', authMethod));
  editorForm.append(editNote, identityFields, field('Private directory environment name', directoryEnv),
    field('Imported original source', sourceSelect), sourceIdentity, sourceProblems, operationChoices,
    flowFacts, node('h4', 'Source-declared scopes'), scopeChoices, clientFields, secretField, advanced, editorActions);
  editor.append(editorForm);

  const entriesSection = node('section'); entriesSection.append(node('h3', '3. Review the complete connection edition'));
  const entryRows = node('div'), changesNote = node('p', '', 'note');
  const reviewButton = button('Review connection edition', () => run(reviewEdition));
  const reviewPanel = node('div', undefined, 'result'); reviewPanel.hidden = true;
  entriesSection.append(node('p', 'The list includes every connection that will be present in the new edition. Changes are applied only after the complete registration review.', 'note'),
    entryRows, changesNote, reviewButton, reviewPanel);
  controls.append(sourceSection, editor, entriesSection);
  const preparedPanel = node('section', undefined, 'result'); preparedPanel.hidden = true;
  const historySection = node('details'); historySection.append(node('summary', 'Reopen a previous connection edition'));
  const editionSelect = node('select'); editionSelect.id = 'openapi-setup-edition';
  const inspectEdition = button('Review saved edition', () => run(async () => {
    if (!editionSelect.value) throw new Error('Choose a saved connection edition.');
    const own = generation, result = await call('status', { editionId: editionSelect.value });
    if (own !== generation) return;
    selectedEdition = result; renderEdition();
  }));
  const editionPanel = node('div', undefined, 'result'); editionPanel.hidden = true;
  historySection.append(node('p', 'A previous edition reuses its original stores and current grant history. Select its settings, then use the application’s ordinary review and start controls.', 'note'),
    field('Saved edition', editionSelect), inspectEdition, editionPanel);
  available.append(toolbar, portField, counts, pendingPanel, controls, preparedPanel, historySection);
  panel.append(intro, status, unavailable, available); root.replaceChildren(panel); root.hidden = true;

  function current() {
    const raw = getContext() ?? {};
    return { workspaceId: String(raw.workspaceId ?? ''), runtimeId: String(raw.runtimeId ?? ''),
      applicationId: raw.applicationId ?? null, kind: raw.kind ?? '',
      context: { environmentFile: raw.environmentFile || null,
        connectionsFile: raw.connectionsFile ?? raw.oauthConnectionsFile ?? null,
        port: Number(raw.port ?? 0), allowLoopbackOAuth: raw.allowLoopbackOAuth === true } };
  }
  function storageKey(value = active) {
    return 'starforge-openapi-setup-' + [value?.workspaceId, value?.runtimeId, value?.applicationId ?? 'new'].map(encodeURIComponent).join('-');
  }
  function readPending() {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null');
      return value?.version === 1 && typeof value.requestId === 'string' && value.requestId.length <= 160 &&
        ['import-source', 'source.import', 'commit', 'activate'].includes(value.action) ? value : null;
    } catch { return null; }
  }
  function savePending(value, key = storageKey()) {
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch {}
  }
  function requestContext() {
    if (!active?.runtimeId || !validPort(callbackPort.value)) throw new Error('Choose a ready runtime and a fixed callback port from 1024 through 65535.');
    return { ...active.context, port: Number(callbackPort.value) };
  }
  function call(action, value = {}, snapshot = active, context = requestContext()) {
    return api('/api/applications/openapi-setup/' + action, { runtimeId: snapshot.runtimeId, context, input: value });
  }
  function invalidate() {
    reviewed = null; reviewPanel.hidden = true; reviewPanel.replaceChildren();
    prepared = null; preparedPanel.hidden = true;
  }
  function renderBusy() {
    controls.disabled = busy || Boolean(pending) || !catalog?.enabled || stale;
    callbackPort.disabled = busy || Boolean(pending);
    reload.disabled = busy || Boolean(pending) || loading;
    refreshStatus.disabled = busy || loading;
    inspectEdition.disabled = busy || Boolean(pending) || !editionSelect.value;
    reviewButton.disabled = busy || Boolean(pending) || stale || !catalog?.enabled;
    panel.setAttribute('aria-busy', String(busy || loading));
  }
  async function run(action) {
    if (busy) return;
    const own = generation;
    try { await action(); } catch (issue) {
      if (own === generation) { status.textContent = errorText(issue); error(issue); }
    } finally { if (own === generation) renderBusy(); }
  }
  async function mutation(action, value) {
    if (pending) throw new Error('Reconcile the retained setup request before starting another change.');
    const own = generation, snapshot = copy(active), context = requestContext(), key = storageKey(snapshot);
    const record = { version: 1, action, requestId: crypto.randomUUID(), createdAt: new Date().toISOString() };
    const body = { ...value, requestId: record.requestId };
    pending = record; operationStatus = undefined; savePending(record, key); busy = true; renderPending(); renderBusy();
    try {
      const result = await call(action, body, snapshot, context);
      savePending(null, key);
      if (own !== generation) return null;
      pending = null; operationStatus = undefined; renderPending(); return result;
    } finally { if (own === generation) { busy = false; renderBusy(); } }
  }
  async function reconcile({ recover = false } = {}) {
    if (!pending) return;
    const own = generation, record = { ...pending }; busy = true; renderBusy();
    try {
      let result;
      if (recover) {
        result = await call('recover', { requestId: record.requestId });
        if (own !== generation) return;
        savePending(null); pending = null; operationStatus = undefined;
        await acceptResult(routeAction(record.action), result);
      } else {
        const value = await call('status', { requestId: record.requestId });
        if (own !== generation) return;
        operationStatus = value.operation ?? null;
        if (operationStatus?.state === 'completed') {
          const completed = operationStatus.result;
          if (!completed) throw new Error('The completed original request did not return its retained result.');
          savePending(null); pending = null; operationStatus = undefined;
          await acceptResult(routeAction(record.action), completed);
        } else if (operationStatus === null) {
          status.textContent = 'The host has no durable operation for this request. Return to setup to submit the original input again.';
        }
      }
    } finally { if (own === generation) { busy = false; renderPending(); renderBusy(); } }
  }
  function renderPending() {
    pendingPanel.replaceChildren(); pendingPanel.hidden = !pending;
    if (!pending) return;
    pendingPanel.append(node('h3', 'Continue the original setup request'),
      facts([['Action', routeAction(pending.action)], ['Request', pending.requestId], ['State', operationStatus?.state ?? 'Awaiting reconciliation']]),
      node('p', 'Read the retained result or continue this exact request. The original private operation contains its selected source and registration plan.', 'note'));
    const actions = node('div', undefined, 'actions');
    actions.append(button('Read retained request', () => run(() => reconcile())));
    if (operationStatus?.state === 'pending')
      actions.append(button('Continue original request', () => run(() => reconcile({ recover: true }))));
    if (operationStatus === null)
      actions.append(button('Return to setup', () => { savePending(null); pending = null; operationStatus = undefined; renderPending(); renderBusy(); }));
    pendingPanel.append(actions);
  }
  async function acceptResult(action, result) {
    if (!result) return;
    if (action === 'import-source') {
      invalidate(); sourceReadGeneration++; loadedSourceText = null;
      sourceText.value = ''; sourceFile.value = '';
      const own = generation;
      await loadCatalog({ resetEntries: false, expectedRevision: result.revision });
      if (own !== generation) return;
      sourceCache.set(result.source.id, result);
      sourceSelect.value = result.source.id;
      if (!label.value) label.value = result.source.title || result.source.label;
      await inspectSelected();
      status.textContent = 'Original source imported. Select its operations and registered client below.';
    } else {
      prepared = result.prepared ?? null;
      if (!prepared?.settings) throw new Error('The completed edition did not return prepared application settings.');
      const completed = prepared, own = generation;
      await loadCatalog({ resetEntries: true });
      if (own !== generation) return;
      prepared = completed; renderPrepared();
      status.textContent = 'Connection edition is ready. Use its reviewed settings in this application.';
      message(status.textContent);
    }
  }
  function renderSources() {
    const previous = sourceSelect.value;
    sourceSelect.replaceChildren(new Option('Choose an imported definition', ''),
      ...(catalog?.sources ?? []).map(item => new Option((item.title || item.label) + ' · ' + item.sha256.slice(0, 12), item.id)));
    sourceSelect.value = (catalog?.sources ?? []).some(item => item.id === previous) ? previous : '';
    const selectedSecret = secretEnv.value;
    secretEnv.replaceChildren(new Option('Choose an available environment name', ''),
      ...(catalog?.clientSecretEnvs ?? []).map(name => new Option(name, name)));
    if (selectedSecret && [...secretEnv.options].some(item => item.value === selectedSecret)) secretEnv.value = selectedSecret;
    updateAuthentication();
    const previousEdition = editionSelect.value;
    editionSelect.replaceChildren(new Option('Choose a saved edition', ''),
      ...(catalog?.editions ?? []).map(item => new Option('Edition ' + item.sequence + ' · ' + item.createdAt + ' · ' + item.entryCount + ' connections', item.id)));
    editionSelect.value = (catalog?.editions ?? []).some(item => item.id === previousEdition) ? previousEdition : catalog?.currentEditionId ?? '';
  }
  async function loadCatalog({ resetEntries = false, expectedRevision } = {}) {
    if (loading) return;
    const own = generation; loading = true; renderBusy();
    try {
      const value = await call('catalog');
      if (own !== generation) return;
      if (!value.enabled) {
        catalog = value; unavailable.hidden = false; unavailable.textContent = value.reason || 'This selected runtime does not include connection setup.';
        available.hidden = true; return;
      }
      unavailable.hidden = true; available.hidden = false;
      if (!resetEntries && dirty && catalog && value.revision !== (expectedRevision ?? catalog.revision)) {
        stale = true; status.textContent = 'The saved configuration changed while this draft was open. Reload the saved configuration before preparing another edition.';
      } else stale = false;
      catalog = value;
      if (value.contextError) {
        stale = true; status.textContent = errorText(value.contextError) + ' Correct the application settings, or continue its retained request below.';
      }
      if (resetEntries || !dirty) {
        desired = (value.baseEntries ?? []).map(item => ({ entry: copy(item.entry ?? { retainAlias: item.alias, expectedProfileSha256: item.profileSha256 }), summary: copy(item) }));
        dirty = false; invalidate();
        if (resetEntries) clearEditor();
      }
      pending = pending ?? readPending();
      if (!pending && value.pending) {
        pending = { version: 1, action: routeAction(value.pending.action), requestId: value.pending.requestId, createdAt: null };
        savePending(pending);
      }
      renderSources(); renderEntries(); renderPending();
      counts.textContent = (value.sources?.length ?? 0) + ' retained sources · ' + (value.editions?.length ?? 0) +
        ' saved editions · configuration revision ' + value.revision;
    } finally { if (own === generation) { loading = false; renderBusy(); } }
  }
  function selectedChoices() {
    const ids = new Set([...operationChoices.querySelectorAll('input[type=checkbox]:checked')].map(item => item.value));
    return (inspection?.choices ?? []).filter(item => ids.has(item.id));
  }
  function selectedScopes() {
    return [...scopeChoices.querySelectorAll('input[type=checkbox]:checked')].map(item => item.value);
  }
  function renderScopes(preselected = selectedScopes()) {
    const choices = selectedChoices(), required = new Set(choices.flatMap(item => scopeNames(item.requiredScopes)));
    const declared = new Set(choices.flatMap(item => scopeNames(item.declaredScopes)));
    for (const name of required) declared.add(name);
    const wanted = new Set([...preselected, ...required]); scopeChoices.replaceChildren();
    if (!choices.length) scopeChoices.append(node('p', 'Select the operations this connection will support.', 'note'));
    else if (!declared.size) scopeChoices.append(node('p', 'The selected source flow declares no scopes.', 'note'));
    for (const name of [...declared].sort()) {
      const check = input('openapi-setup-scope-' + scopeChoices.childElementCount, { type: 'checkbox' });
      check.value = name; check.checked = wanted.has(name); check.disabled = required.has(name);
      const row = field(name + (required.has(name) ? ' · required by selected operations' : ''), check); row.className = 'check';
      scopeChoices.append(row);
    }
    flowFacts.replaceChildren();
    if (choices.length) {
      const first = choices[0];
      flowFacts.append(facts([['Security scheme', first.scheme], ['Authorization endpoint', first.authorizationEndpoint],
        ['Token endpoint', first.tokenEndpoint], ['Resource origins', [...new Set(choices.map(item => item.resourceOrigin))].join('\n')]]));
      if (!choices.every(item => sameFlow(first, item)))
        flowFacts.append(node('p', 'These operations use different authorization flows. Create a separate connection for each flow.', 'note'));
    }
  }
  async function inspectSelected({ selections = [], scopes = [] } = {}) {
    const sourceId = sourceSelect.value, own = generation, selectedInspection = ++inspectionGeneration;
    inspection = null; operationChoices.replaceChildren(); scopeChoices.replaceChildren(); flowFacts.replaceChildren(); sourceProblems.replaceChildren();
    sourceIdentity.textContent = '';
    if (!sourceId) return;
    const value = sourceCache.get(sourceId) ?? await call('inspect-source', { sourceId });
    if (own !== generation || selectedInspection !== inspectionGeneration || sourceSelect.value !== sourceId) return;
    sourceCache.set(sourceId, value); inspection = value;
    sourceIdentity.textContent = value.source.sha256 + ' · ' + value.source.bytes + ' original bytes';
    const selected = new Set(selections.map(selectionKey));
    if (!value.choices?.length) {
      sourceProblems.append(node('p', 'This definition has no supported authorization-code operation. Choose another retained definition or import the provider’s current definition.', 'note'));
    } else {
      const set = node('fieldset'); set.append(node('legend', 'Operations using this registered connection'));
      for (const item of value.choices) {
        const check = input('openapi-setup-operation-' + set.childElementCount, { type: 'checkbox' });
        check.value = item.id; check.checked = selected.has(selectionKey(item.selection));
        check.addEventListener('change', () => renderScopes());
        const row = field(item.label || item.selection.method.toUpperCase() + ' ' + item.selection.path + ' · ' + item.scheme, check); row.className = 'check';
        set.append(row);
      }
      operationChoices.append(set);
    }
    const warnings = value.inspection?.warnings ?? [];
    for (const warning of warnings) sourceProblems.append(node('p', typeof warning === 'string' ? warning : warning.message ?? JSON.stringify(warning), 'note'));
    renderScopes(scopes);
  }
  function updateAuthentication() {
    secretField.hidden = authMethod.value === 'none'; secretEnv.required = authMethod.value !== 'none';
  }
  function clearEditor() {
    inspectionGeneration++;
    editing = null; alias.value = ''; alias.readOnly = false; label.value = ''; directoryEnv.value = '';
    clientId.value = ''; authMethod.value = 'none'; secretEnv.value = '';
    revocationEndpoint.value = ''; issuer.value = ''; authorizationParameters.value = '{}'; resourceParameters.value = '[]';
    sourceSelect.value = ''; inspection = null; sourceIdentity.textContent = '';
    operationChoices.replaceChildren(); scopeChoices.replaceChildren(); flowFacts.replaceChildren(); sourceProblems.replaceChildren();
    editNote.textContent = ''; addButton.textContent = 'Add connection to review'; updateAuthentication();
  }
  async function editEntry(index) {
    const item = desired[index]; if (!item) return;
    clearEditor(); editing = { index, alias: item.summary.alias ?? item.entry.alias ?? item.entry.retainAlias,
      originalProfileSha256: item.entry.expectedProfileSha256 ?? item.entry.replacesProfileSha256 ?? null };
    const definition = item.entry.retainAlias ? item.summary.definition : item.entry;
    const profile = item.summary.profile ?? {};
    alias.value = editing.alias; alias.readOnly = true;
    label.value = definition?.label ?? profile.label ?? item.summary.label ?? editing.alias;
    directoryEnv.value = definition?.directoryEnv ?? item.summary.directoryEnv ?? '';
    clientId.value = definition?.clientId ?? profile.clientId ?? '';
    authMethod.value = definition?.authMethod ?? profile.authMethod ?? 'none';
    secretEnv.value = definition?.clientSecretEnv ?? profile.clientSecretEnv ?? '';
    revocationEndpoint.value = definition?.revocationEndpoint ?? profile.revocationEndpoint ?? '';
    issuer.value = definition?.issuer ?? profile.issuer ?? '';
    authorizationParameters.value = JSON.stringify(definition?.authorizationParameters ?? profile.authorizationParameters ?? {}, null, 2);
    resourceParameters.value = JSON.stringify(definition?.resourceParameters ?? profile.resourceParameters ?? [], null, 2);
    if (definition?.sourceId) sourceSelect.value = definition.sourceId;
    editNote.textContent = item.entry.retainAlias ?
      'Replacing this connection creates a new source-bound store. The reviewed edition retains the previous store and grant history for reopening.' :
      'Update this connection in the current review list.';
    if (profile.provider) editNote.textContent += ' Its current native provider dialect remains visible in the full registration review.';
    addButton.textContent = 'Update connection in review'; updateAuthentication();
    await inspectSelected({ selections: definition?.selections ?? [], scopes: definition?.scopes ?? profile.scopes ?? [] });
    editor.open = true; editor.scrollIntoView({ block: 'nearest' }); sourceSelect.focus();
  }
  function addEntry() {
    const choices = selectedChoices();
    if (!choices.length) throw new Error('Select at least one source-declared operation.');
    if (choices.length > (catalog?.limits?.maxSelectionsPerEntry ?? 64)) throw new Error('This connection has too many selected operations.');
    if (!choices.every(item => sameFlow(choices[0], item))) throw new Error('Select operations with the same declared authorization flow.');
    const entry = { alias: alias.value.trim(), directoryEnv: directoryEnv.value.trim(), sourceId: sourceSelect.value,
      selections: choices.map(item => copy(item.selection)), label: label.value.trim(), clientId: clientId.value.trim(),
      authMethod: authMethod.value, scopes: selectedScopes().sort() };
    if (entry.authMethod !== 'none') entry.clientSecretEnv = secretEnv.value;
    if (revocationEndpoint.value.trim()) entry.revocationEndpoint = revocationEndpoint.value.trim();
    if (issuer.value.trim()) entry.issuer = issuer.value.trim();
    const parameters = jsonField(authorizationParameters.value, 'Authorization parameters');
    const resources = jsonField(resourceParameters.value, 'Resource parameters', true);
    if (Object.keys(parameters).length) entry.authorizationParameters = parameters;
    if (resources.length) entry.resourceParameters = resources;
    if (editing?.originalProfileSha256) entry.replacesProfileSha256 = editing.originalProfileSha256;
    if (desired.some((item, index) => index !== editing?.index && (item.entry.alias ?? item.entry.retainAlias) === entry.alias))
      throw new Error('Each connection needs a distinct alias.');
    if (desired.some((item, index) => index !== editing?.index && (item.entry.directoryEnv ?? item.summary.directoryEnv) === entry.directoryEnv))
      throw new Error('Each connection needs a distinct private directory environment name.');
    const summary = { alias: entry.alias, directoryEnv: entry.directoryEnv, label: entry.label,
      source: inspection.source, selections: choices, replacement: Boolean(entry.replacesProfileSha256) };
    if (editing) desired[editing.index] = { entry, summary };
    else {
      if (desired.length >= (catalog?.limits?.maxEntries ?? 64)) throw new Error('The connection edition has reached its supported entry limit.');
      desired.push({ entry, summary });
    }
    dirty = true; invalidate(); clearEditor(); renderEntries();
    status.textContent = 'Connection added to the complete edition review. Review the registration before creating its private store.';
  }
  function renderEntries() {
    entryRows.replaceChildren();
    if (!desired.length) entryRows.append(node('p', 'This edition will have no registered OAuth connections.', 'note'));
    for (const [index, item] of desired.entries()) {
      const detail = node('details');
      const retained = Boolean(item.entry.retainAlias), name = item.entry.alias ?? item.entry.retainAlias;
      detail.append(node('summary', name + ' · ' + (retained ? 'Retain original connection' : item.summary.replacement ? 'Replace with new registration' : 'New connection')));
      if (retained) detail.append(profileFacts(item.summary),
        node('p', 'Current grant: ' + (item.summary.grant?.state ?? item.summary.existingGrant?.state ?? 'Not authorized'), 'note'));
      else detail.append(facts([['Provider', item.entry.label], ['Source', item.summary.source?.label ?? item.entry.sourceId],
        ['Original source SHA-256', item.summary.source?.sha256], ['Selected operations', item.entry.selections.map(value => value.method.toUpperCase() + ' ' + value.path).join('\n')],
        ['Client ID', item.entry.clientId], ['Registered scopes', item.entry.scopes.join('\n') || 'No scopes'],
        ['Directory environment name', item.entry.directoryEnv]]));
      const actions = node('div', undefined, 'actions');
      actions.append(button(retained ? 'Replace source or client' : 'Edit connection', () => run(() => editEntry(index))),
        button('Remove from this edition', () => {
          desired.splice(index, 1); dirty = true; invalidate(); clearEditor(); renderEntries();
          status.textContent = 'Connection removed from the proposed edition. The registration review shows every removal before creation.';
        }));
      detail.append(actions); entryRows.append(detail);
    }
    changesNote.textContent = dirty ? 'This draft has changes. Existing stores and completed editions remain retained.' : 'The current saved connections are carried into this review.';
    renderBusy();
  }
  async function reviewEdition() {
    if (stale) throw new Error('Reload the saved configuration before reviewing a changed base.');
    const own = generation; busy = true; renderBusy();
    try {
      const value = await call('review', { expectedRevision: catalog.revision, baseEditionId: catalog.currentEditionId ?? null,
        entries: desired.map(item => copy(item.entry)) });
      if (own !== generation) return;
      reviewed = value; renderReview(); reviewPanel.scrollIntoView({ block: 'nearest' });
    } finally { if (own === generation) { busy = false; renderBusy(); } }
  }
  function renderReview() {
    reviewPanel.replaceChildren(); reviewPanel.hidden = !reviewed;
    if (!reviewed) return;
    const thisReview = reviewed;
    reviewPanel.append(node('h3', 'Register these exact callback addresses'),
      node('p', 'Review the original provider console registration against the client, scopes and callback addresses below.', 'note'));
    for (const entry of reviewed.entries ?? []) {
      const detail = node('details'); detail.open = true;
      detail.append(node('summary', entry.alias + ' · ' + (entry.kind === 'retained' ? 'Existing connection' : 'Initialize connection')), profileFacts(entry));
      reviewPanel.append(detail);
    }
    const changed = node('details'); changed.append(node('summary', 'Complete edition changes'));
    changed.append(node('pre', JSON.stringify(reviewed.changes, null, 2))); reviewPanel.append(changed);
    reviewPanel.append(facts([['Environment names retained or added', reviewed.environmentNames?.join('\n')],
      ['Application listener', '127.0.0.1:' + callbackPort.value], ['Reviewed revision', reviewed.revision]]));
    const confirmation = node('form'), actor = input('openapi-setup-actor', { required: true, maxLength: 160 });
    const reference = input('openapi-setup-reference', { required: true, maxLength: 2000 });
    const registered = input('openapi-setup-callbacks-registered', { type: 'checkbox', required: true });
    const check = field('These client registrations contain the exact callback addresses and scopes shown above.', registered); check.className = 'check';
    const commit = node('button', 'Create reviewed connection edition'); commit.type = 'submit';
    confirmation.append(field('Registration reviewed by', actor), field('Provider registration reference', reference,
      'Use a registration name or internal reference; keep secrets in the host environment.'), check, commit);
    confirmation.addEventListener('submit', event => {
      event.preventDefault();
      run(async () => {
        if (reviewed !== thisReview) throw new Error('Review the current connection edition again.');
        const result = await mutation('commit', { expectedRevision: thisReview.revision, reviewId: thisReview.reviewId,
          actor: actor.value.trim(), reference: reference.value.trim(), callbacksRegistered: registered.checked });
        await acceptResult('commit', result);
      });
    });
    reviewPanel.append(confirmation);
  }
  function addDownloads(container, editionId) {
    const actions = node('div', undefined, 'actions');
    for (const [kind, label] of [['profile-review', 'Download registration review'], ['registry', 'Download registry'],
      ['source-manifest', 'Download source manifest'], ['operator-plan', 'Download operator plan']]) {
      actions.append(button(label, () => run(async () => {
        const own = generation, result = await call('download', { editionId, kind });
        if (own !== generation) return;
        if (typeof result.content !== 'string') throw new Error('The original download did not contain a complete text file.');
        const url = URL.createObjectURL(new Blob([result.content], { type: result.mime || 'application/json' }));
        const link = node('a'); link.href = url;
        link.download = String(result.filename || kind + '.json').split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, '');
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })));
    }
    container.append(actions);
  }
  function renderPrepared() {
    preparedPanel.replaceChildren(); preparedPanel.hidden = !prepared;
    if (!prepared) return;
    const value = copy(prepared), own = generation;
    preparedPanel.append(node('h3', 'Connection edition ready'),
      node('p', 'Apply these reviewed settings, then use Review application, Save application and Review start in the Applications console.', 'note'),
      facts([['Edition', value.editionId], ['Host registry', value.settings.oauthConnectionsFile],
        ['Private environment edition', value.settings.environmentFile], ['Local callback port', value.settings.port],
        ['Registry SHA-256', value.registrySha256], ['Environment SHA-256', value.environmentSha256]]),
      button('Use these connections in this application', () => run(async () => {
        if (own !== generation || prepared?.editionId !== value.editionId) return;
        await onPrepared(copy(value.settings));
        message('Reviewed connection settings are in the application form. Review and save the application to continue.');
      })));
    addDownloads(preparedPanel, value.editionId);
  }
  function renderEdition() {
    editionPanel.replaceChildren(); editionPanel.hidden = !selectedEdition?.edition;
    if (!selectedEdition?.edition) return;
    const value = selectedEdition;
    editionPanel.append(facts([['Edition', value.edition.id], ['Created', value.edition.createdAt],
      ['Connections', value.edition.entryCount], ['Registry SHA-256', value.prepared?.registrySha256],
      ['Environment SHA-256', value.prepared?.environmentSha256]]));
    for (const entry of value.connections ?? []) {
      const detail = node('details'); detail.append(node('summary', entry.alias), profileFacts(entry)); editionPanel.append(detail);
    }
    editionPanel.append(button('Select this saved edition', () => run(async () => {
      if (selectedEdition !== value) throw new Error('Review the saved edition again.');
      const result = await mutation('activate', { expectedRevision: value.revision, editionId: value.edition.id });
      await acceptResult('activate', result);
    })));
    addDownloads(editionPanel, value.edition.id);
  }
  sourceFile.addEventListener('change', () => run(async () => {
    const file = sourceFile.files?.[0], own = generation, read = ++sourceReadGeneration;
    loadedSourceText = null;
    if (!file) return;
    if (file.size > (catalog?.limits?.maxSourceBytes ?? 4194304)) throw new Error('The original source exceeds the receiving host’s source size limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const encoded = new TextEncoder().encode(text);
    if (encoded.length !== bytes.length || encoded.some((value, index) => value !== bytes[index]))
      throw new Error('Use the original UTF-8 source without a character-encoding conversion.');
    if (own !== generation || read !== sourceReadGeneration || sourceFile.files?.[0] !== file) return;
    // A textarea normalizes line endings. Keep the actual decoded source for import.
    sourceText.value = text; loadedSourceText = text;
    if (!sourceLabel.value) sourceLabel.value = file.name;
    sourceNote.textContent = file.name + ' · ' + bytes.length + ' original UTF-8 bytes';
  }));
  sourceText.addEventListener('input', () => {
    sourceReadGeneration++; loadedSourceText = null; sourceFile.value = '';
    sourceNote.textContent = 'The edited text will be retained as a new source with its own byte hash.';
  });
  sourceForm.addEventListener('submit', event => {
    event.preventDefault(); run(async () => {
      const originalSource = loadedSourceText ?? sourceText.value;
      if (!originalSource) throw new Error('Choose or paste the complete original OpenAPI definition.');
      if (new TextEncoder().encode(originalSource).byteLength > (catalog?.limits?.maxSourceBytes ?? 4194304))
        throw new Error('The original source exceeds the receiving host’s source size limit.');
      const result = await mutation('import-source', { expectedRevision: catalog.revision, label: sourceLabel.value.trim(), sourceText: originalSource });
      await acceptResult('import-source', result);
    });
  });
  editorForm.addEventListener('submit', event => { event.preventDefault(); run(async () => addEntry()); });
  sourceSelect.addEventListener('change', () => run(() => inspectSelected()));
  authMethod.addEventListener('change', updateAuthentication);
  alias.addEventListener('change', () => {
    if (!directoryEnv.value) directoryEnv.value = alias.value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&').toUpperCase().slice(0, 112) + '_OAUTH_DIRECTORY';
    if (!label.value) label.value = alias.value;
  });
  callbackPort.addEventListener('change', () => run(async () => {
    invalidate(); selectedEdition = null; editionPanel.hidden = true;
    if (!validPort(callbackPort.value)) throw new Error('Use a callback port from 1024 through 65535.');
    await loadCatalog({ resetEntries: false });
  }));
  editionSelect.addEventListener('change', () => { selectedEdition = null; editionPanel.hidden = true; renderBusy(); });

  async function refresh({ force = false } = {}) {
    const next = current(), nextSignature = JSON.stringify(next);
    if (nextSignature !== signature) {
      generation++; signature = nextSignature; active = next; catalog = null; loading = false; busy = false;
      desired = []; dirty = false; stale = false; inspection = null; sourceCache.clear();
      reviewed = null; prepared = null; selectedEdition = null; pending = null; operationStatus = undefined;
      sourceReadGeneration++; loadedSourceText = null;
      clearEditor(); reviewPanel.hidden = preparedPanel.hidden = editionPanel.hidden = true;
      sourceText.value = ''; sourceFile.value = ''; sourceLabel.value = '';
      callbackPort.value = String(validPort(next.context.port) ? next.context.port : 8787);
      status.textContent = ''; available.hidden = true; unavailable.hidden = false;
      root.hidden = next.kind !== 'openapi';
      if (root.hidden) return;
      if (!next.workspaceId || !next.runtimeId) { unavailable.textContent = 'Choose a ready runtime to set up its provider connections.'; return; }
      pending = readPending(); force = true;
    }
    if (root.hidden || !active?.runtimeId || !active.workspaceId) return;
    if (!catalog || force) await loadCatalog({ resetEntries: !catalog });
    renderBusy();
  }
  return {
    refresh,
    setContext: () => refresh(),
    reset() {
      generation++; signature = ''; active = null; catalog = null; busy = loading = false;
      desired = []; dirty = stale = false; pending = reviewed = prepared = selectedEdition = null; operationStatus = undefined;
      sourceReadGeneration++; loadedSourceText = null;
      sourceCache.clear(); clearEditor(); sourceText.value = ''; sourceFile.value = ''; sourceLabel.value = '';
      root.hidden = true; reviewPanel.hidden = preparedPanel.hidden = editionPanel.hidden = pendingPanel.hidden = true;
    },
  };
}
