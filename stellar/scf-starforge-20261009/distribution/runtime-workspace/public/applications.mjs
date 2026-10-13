// MIT. Applications presentation over the original runtime and managed-command APIs.
import { renderOpenApiApplicationReview } from './openapi-application.mjs';
import { renderApplicationReview } from './application-review.mjs';
import { renderAccountingApplicationReview } from './accounting-application.mjs';
import { createOpenApiConnectionSetupView } from './openapi-connection-setup.mjs';
import { createApplicationOutputReader } from './application-output.mjs';
import { createApplicationLibrary } from './application-library.mjs';
import { createApplicationInputsView } from './application-inputs.mjs';
import { createApplicationDrafts } from './application-drafts.mjs';
import { createWorkbookResultsView, renderWorkbookReview, workbookFormFromDescriptor, isWorkbookApplication } from './workbook-results.mjs';
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action) => {
  const node = element('button', text); node.type = 'button';
  node.addEventListener('click', action); return node;
};
const query = (path, value) => path + '?' + new URLSearchParams(value);
const readable = text => String(text ?? '').replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
function outcomeText(result, source = null) {
  if (!result) return source ? 'Original outcome is null · Receipt: ' + source : 'Original operation retained.';
  const label = result.state ?? result.operation ?? 'Retained result';
  const exit = result.exitCode !== null && result.exitCode !== undefined ? ', exit ' + result.exitCode : '';
  const recovered = result.operation === 'original-command' &&
    ['RECONCILED', 'OUTCOME_UNAVAILABLE'].includes(result.state) ? ' · Original exit outcome is unavailable.' : '';
  return 'Original outcome: ' + label + exit + recovered + (source ? ' · Receipt: ' + source : '');
}
function facts(rows) {
  const node = element('dl', undefined, 'paths');
  for (const [label, value] of rows) {
    const row = element('div'); row.append(element('dt', label), element('dd', value ?? '—')); node.append(row);
  }
  return node;
}
function providerReviewRows(value) {
  if (!value) return [];
  return [
    ['Selected provider', value.id + ' · ' + value.kind],
    ['Provider source', value.path],
    ['Reviewed provider SHA-256', value.sha256],
  ];
}
function mppReviewRows(command) {
  const workspace = command?.mppBinding;
  if (!workspace) return [];
  const roles = Object.entries(workspace.profiles).filter(([, profile]) => profile).map(([role]) => role);
  return [
    ['MPP workspace', workspace.workspace],
    ['Workspace created', workspace.createdAt],
    ['Saved profile revision', workspace.revision],
    ['Configured roles', roles.join(', ') || 'Ready for merchant or customer configuration'],
  ];
}
function wooReviewRows(command) {
  const woo = command?.woo;
  if (!woo) return [];
  return [
    ['WordPress store', woo.storeOrigin], ['Original outbox', woo.outbox],
    ['Notice destination', woo.deliveryUrl], ['Shared secret environment name', woo.secretEnv],
    ['Retained native routes / catalogs', woo.routes.length + ' / ' + woo.catalogs.length],
    ['Store binding', woo.originalOutboxBinding ?? 'Created under the original worker lease at first start'],
  ];
}
async function textHash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createApplicationsWorkspaceView({ root, api, getState, getToken, refreshWorkspace, switchView, message, error }) {
  let data = null, selectedId = null, selectedRun = null, editingId = null, configurationReview = null, startReview = null;
  let loading = false, sending = false, scope = 0, settingsScope = 0, initial = true, navigationVersion = 0;
  let historyData = null, historyApplicationId = null, historyCursor = null, historyTrail = [], historyScope = 0, historyLoading = false;
  const key = (name, workspaceId = getState()?.workspaceId) => 'starforge-applications-' + workspaceId + '-' + name;
  const readSaved = (name, workspaceId) => { try { return JSON.parse(sessionStorage.getItem(key(name, workspaceId)) ?? 'null'); } catch { return null; } };
  const saveSaved = (name, value, workspaceId) => {
    try {
      if (value === null) sessionStorage.removeItem(key(name, workspaceId));
      else sessionStorage.setItem(key(name, workspaceId), JSON.stringify(value));
      return true;
    } catch { return false; }
  };
  const selected = () => data?.applications.find(item => item.id === selectedId) ?? null;
  const currentType = () => data?.catalog.find(item => item.id === kind.value);
  const header = element('div', undefined, 'section-title');
  header.append(element('h2', 'Applications'), button('Refresh applications', () => refresh().catch(error)),
    button('New application', () => edit(null)));
  const intro = element('p', 'Open the original merchant and buyer tools using an installed runtime. Application data, private URLs and process history stay with this workspace.', 'note');
  const libraryRoot = element('div'); libraryRoot.id = 'application-library';
  const inputRoot=element('div');
  const inputLibrary=createApplicationInputsView({root:inputRoot,api,getToken,
    getWorkspaceId:()=>getState()?.workspaceId,onError:error,onMessage:message,readSaved,saveSaved});
  const draftRoot = element('div'); draftRoot.id = 'application-setup-drafts';
  const configuration = element('details'); configuration.open = true;
  configuration.append(element('summary', 'Configure application'));
  const form = element('form'), grid = element('div', undefined, 'columns');
  const field = (labelText, node) => { const label = element('label', labelText); label.append(node); return label; };
  const label = element('input'); label.required = true; label.maxLength = 120; label.id = 'application-label';
  const runtime = element('select'); runtime.required = true; runtime.id = 'application-runtime';
  const kind = element('select'); kind.required = true; kind.id = 'application-kind';
  grid.append(field('Display name', label), field('Ready runtime', runtime));
  const description = element('p', '', 'note'), settings = element('div', undefined, 'columns');
  const reviewButton = element('button', 'Review application'); reviewButton.type = 'submit';
  const reviewResult = element('div', undefined, 'result'); reviewResult.hidden = true;
  form.append(grid, field('Original application', kind), description, settings, reviewButton, reviewResult);
  configuration.append(draftRoot, form);
  const openapiSetupRoot = element('div'); configuration.append(openapiSetupRoot);
  const openapiSetup = createOpenApiConnectionSetupView({
    root: openapiSetupRoot, api, message, error,
    applicationKinds: ['openapi', 'merchant-accounting'],
    getContext() {
      const value = configurationValue();
      return { workspaceId: getState()?.workspaceId, runtimeId: value.runtimeId,
        applicationId: value.applicationId, kind: value.kind,
        environmentFile: value.settings.environmentFile ?? null,
        connectionsFile: value.settings.oauthConnectionsFile ?? null,
        port: value.settings.port ?? 0, allowLoopbackOAuth: value.settings.allowLoopbackOAuth === true };
    },
    onPrepared(prepared) {
      const value = configurationValue();
      if (!['openapi', 'merchant-accounting'].includes(value.kind)) return;
      drafts.mergeSettings(prepared);
      configuration.open = true; reviewButton.focus();
    },
  });
  const openapiContextField = target => ['environmentFile', 'oauthConnectionsFile', 'port', 'allowLoopbackOAuth'].includes(target?.name);
  const selectedPanel = element('section', undefined, 'panel'); selectedPanel.hidden = true;
  const selectedTitle = element('div', undefined, 'section-title'), title = element('h3'), phase = element('span', '', 'status');
  selectedTitle.append(title, phase);
  const details = element('div'), actions = element('div', undefined, 'actions'), operationReview = element('div', undefined, 'result');
  operationReview.hidden = true;
  const open = element('a', 'Open application'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer'; open.hidden = true;
  const wordpress = element('a', 'WordPress order console'); wordpress.target = '_blank';
  wordpress.rel = 'noopener noreferrer'; wordpress.referrerPolicy = 'no-referrer'; wordpress.hidden = true;
  const urlNote = element('p', '', 'note');
  const navigationRecovery = element('div', undefined, 'result'); navigationRecovery.hidden = true;
  function savedAddress(label, value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        Number(url.port || 80) < 1 || Number(url.port || 80) > 65535 ||
        url.username || url.password) return null;
    const row = element('div'), address = element('input');
    address.type = 'text'; address.value = value; address.readOnly = true;
    address.setAttribute('aria-label', label + ' saved address');
    address.addEventListener('focus', () => address.select());
    const copy = button('Copy ' + label.toLowerCase() + ' address', async () => {
      address.focus(); address.select();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        message(label + ' address copied. Paste it into a new tab’s address bar.');
      } catch {
        message(label + ' address selected. Copy it and paste it into a new tab’s address bar.');
      }
    });
    row.append(field(label, address), copy); return row;
  }
  const relatedApplications = element('div', undefined, 'actions');
  relatedApplications.hidden = true;
  const reviewStart = button('Review start', () => act(async () => {
    const app = selected(); if (!canStartApplication(app)) return;
    startReview = await api('/api/applications/start-review', { applicationId: app.id });
    renderStartReview();
  }));
  const stop = button('Stop application', () => act(async () => {
    const app = selected(); if (!app?.current) return;
    await api('/api/applications/stop', { applicationId: app.id, operationId: app.current.id });
    startReview = null; await refresh(); await refreshWorkspace();
    message('Stop requested for the original application. Its own shutdown retains accepted work and closes its resources.');
  }));
  const reconnect = button('Continue runtime connection', () => act(async () => {
    const app = selected(); await api('/api/applications/connect', { applicationId: app.id }); await refresh(); await refreshWorkspace();
  }));
  const continueRun = button('Continue original start', () => act(async () => {
    const app = selected();
    await api('/api/applications/recover', { applicationId: app.id, operationId: app.current.id });
    followOperation(app.id, app.current.id);
    await refresh(); await refreshWorkspace();
  }));
  const editButton = button('Edit settings', () => edit(selected()));
  actions.append(open, wordpress, reviewStart, stop, reconnect, continueRun, editButton);
  selectedPanel.append(selectedTitle, details, actions, relatedApplications, navigationRecovery, urlNote, operationReview);
  const history = element('section', undefined, 'panel'); history.hidden = true;
  history.append(element('h3', 'Original operations'));
  const historyRows = element('div'), historyControls = element('div', undefined, 'actions');
  const historyStatus = element('p', '', 'note'); historyStatus.setAttribute('aria-live', 'polite');
  const newerHistory = button('Newer operations', () => act(() => pageHistory('newer')));
  const olderHistory = button('Older operations', () => act(() => pageHistory('older')));
  const latestHistory = button('Latest operations', () => act(() => pageHistory('latest')));
  historyControls.append(newerHistory, olderHistory, latestHistory);
  history.append(historyRows, historyControls, historyStatus);
  const outputPanel = element('section', undefined, 'panel'); outputPanel.hidden = true;
  outputPanel.append(element('h3', 'Application output'));
  const outputDescription = element('p', '', 'note'), output = element('pre'), inputStatus = element('div');
  output.id = 'application-output'; output.setAttribute('aria-label', 'Original application output');
  const inputForm = element('form'), input = element('input'); input.autocomplete = 'off'; input.spellcheck = false;
  input.id = 'application-terminal-input'; input.maxLength = 4095; input.required = true;
  const send = element('button', 'Send line to original terminal'); send.type = 'submit';
  const terminalActions = element('div', undefined, 'actions');
  const interrupt = button('Send Ctrl-C', () => terminalSend('\u0003').catch(error));
  const eof = button('Send Ctrl-D', () => terminalSend('\u0004').catch(error));
  terminalActions.append(send, interrupt, eof);
  inputForm.append(element('p', 'This is the original application terminal. Review its current prompt, then enter the response yourself. Opening or refreshing this page sends no input.', 'note'),
    field('Terminal response', input), terminalActions, inputStatus);
  const workbookResults = createWorkbookResultsView({ api, message, error });
  const outputReaderRoot = element('div');
  outputPanel.append(outputDescription, outputReaderRoot, inputForm, workbookResults.root);
  const outputReader = createApplicationOutputReader({ root: outputReaderRoot, api,
    getWorkspaceId: () => getState()?.workspaceId, error, output });
  root.replaceChildren(header, intro, libraryRoot, inputRoot, configuration, selectedPanel, history, outputPanel);
  const drafts = createApplicationDrafts({
    root: draftRoot, controls: { label, runtime, kind, settings }, reviewButton,
    getWorkspaceId: () => getState()?.workspaceId,
    getCatalog: () => data?.catalog ?? [], getApplications: () => data?.applications ?? [],
    getRuntimes: () => getState()?.runtimes ?? [],
    selectedRuntime: () => getState()?.selected?.phase === 'READY' ? getState().selected.id : null,
    renderSettings,
    onContext(id, { select = true } = {}) {
      editingId = id;
      if (select && id && selectedId !== id) {
        navigationVersion++; selectedId = id; selectedRun = null; startReview = null; resetHistory(id);
        outputPanel.hidden = true; output.textContent = ''; inputForm.hidden = true;
        library.select(id); renderSelected(); saveSelection();
        act(async () => {
          if (!await refreshHistory() || selectedId !== id) return;
          renderSelected(); await refreshOutput(); saveSelection();
        });
      }
    },
    onChange() { configurationReview = null; reviewResult.hidden = true; },
    onNotice: message,
  });
  const library = createApplicationLibrary({
    root: libraryRoot, readSaved, saveSaved, getWorkspaceId: () => getState()?.workspaceId,
    openApplication: id => act(() => selectApplication(id)),
    configureApplication: kind => edit(null, { kind }),
  });

  const visibleRuns = () => historyData?.applicationId === selectedId ? historyData.runs : selected()?.runs ?? [];
  const saveSelection = () => saveSaved('selected', { selectedId, selectedRun, historyCursor, historyTrail });
  function resetHistory(applicationId = selectedId) {
    historyScope++; historyLoading = false; historyApplicationId = applicationId;
    historyData = null; historyCursor = null; historyTrail = [];
    delete historyRows.dataset.signature;
  }
  function followOperation(applicationId, operationId) {
    if (selectedId !== applicationId) return;
    resetHistory(applicationId); selectedRun = operationId ?? null;
  }
  function renderHistoryNavigation() {
    const page = historyData?.applicationId === selectedId ? historyData : null;
    newerHistory.disabled = historyLoading || !historyTrail.length;
    olderHistory.disabled = historyLoading || !page?.nextCursor;
    latestHistory.disabled = historyLoading || !historyCursor;
    historyStatus.textContent = historyLoading ? 'Loading operations…' : page ?
      page.runs.length + ' of ' + page.totalRuns + ' retained operations' : '';
  }
  async function refreshHistory() {
    const app = selected();
    if (!app || app.error) { historyData = null; return false; }
    if (historyApplicationId !== app.id) resetHistory(app.id);
    const own = scope, generation = ++historyScope, requestedCursor = historyCursor;
    historyLoading = true; renderHistoryNavigation();
    try {
      const value = await api(query('/api/applications/history', {
        applicationId: app.id, limit: 30, ...(requestedCursor ? { cursor: requestedCursor } : {}),
      }));
      if (own !== scope || generation !== historyScope || app.id !== selectedId) return false;
      historyData = value; return true;
    } finally {
      if (own === scope && generation === historyScope) { historyLoading = false; renderHistoryNavigation(); }
    }
  }
  async function pageHistory(direction) {
    if (historyLoading || !selected()) return;
    const applicationId = selectedId, own = scope;
    const previous = { cursor: historyCursor, trail: [...historyTrail] };
    if (direction === 'older') {
      if (!historyData?.nextCursor) return;
      historyTrail.push(historyCursor); historyCursor = historyData.nextCursor;
    } else if (direction === 'newer') {
      if (!historyTrail.length) return;
      historyCursor = historyTrail.pop();
    } else { historyCursor = null; historyTrail = []; }
    navigationVersion++;
    let received = false;
    try {
      if (await refreshHistory()) {
        received = true; selectedRun = null; renderSelected(); saveSelection(); await refreshOutput();
      }
    } catch (issue) {
      if (!received && own === scope && applicationId === selectedId) {
        historyCursor = previous.cursor; historyTrail = previous.trail; renderHistoryNavigation();
      }
      throw issue;
    }
  }
  async function selectApplication(id) {
    navigationVersion++; selectedId = id; selectedRun = null; startReview = null; resetHistory(id);
    library.select(id); renderSelected();
    await refreshHistory(); renderSelected(); await refreshOutput(); saveSelection();
  }

  async function retainedRequest(route, body, setupTicket = null) {
    const existing = readSaved('pending');
    const same = existing?.route === route && existing.body.reviewId === body.reviewId &&
      existing.body.applicationId === body.applicationId;
    if (existing && !same) throw new Error('Recover the retained application request before starting a different request.');
    const pending = same ? existing : { route, workspaceId: getState()?.workspaceId,
      body: { ...body, requestId: crypto.randomUUID() }, ...(setupTicket ? { setupTicket } : {}) };
    if (!saveSaved('pending', pending))
      throw new Error('The browser could not retain this application request. Restore tab storage, then retry this reviewed action.');
    return completeRetainedRequest(pending);
  }
  function clearRetainedRequest(pending, workspaceId) {
    const current = readSaved('pending', workspaceId);
    if (!current || current.route !== pending.route ||
        JSON.stringify(current.body) !== JSON.stringify(pending.body)) return false;
    return saveSaved('pending', null, workspaceId);
  }
  async function completeRetainedRequest(pending) {
    const workspaceId = pending.workspaceId ?? pending.setupTicket?.workspaceId ?? getState()?.workspaceId;
    try {
      const result = await api(pending.route, pending.body);
      clearRetainedRequest(pending, workspaceId); return result;
    } catch (issue) {
      // These original save guards precede the application record write.
      const rejectedSave = pending.route === '/api/applications/save' &&
        [400, 409].includes(issue.status) &&
        ['APPLICATION_REVIEW_CHANGED', 'APPLICATION_RUNNING', 'APPLICATION_INPUTS_CHANGED'].includes(issue.code);
      if (rejectedSave) {
        saveSaved('rejected-save', { ...pending, error: { code: issue.code, status: issue.status },
          observedAt: new Date().toISOString() }, workspaceId);
        clearRetainedRequest(pending, workspaceId);
        if (workspaceId === getState()?.workspaceId && configurationReview?.id === pending.body.reviewId) {
          configurationReview = null; reviewResult.hidden = true; drafts.refresh();
        }
      }
      throw issue;
    }
  }
  async function act(action) {
    const own = scope;
    try { await action(); } catch (issue) { if (own === scope) error(issue); }
  }
  function renderSettings(values = {}) {
    const type = currentType(), generation = ++settingsScope; settings.replaceChildren();
    description.textContent = type?.description ?? '';
    for (const item of type?.fields ?? []) {
      const isInstallation = item.name === 'installationId' && type.python;
      const node = element(isInstallation ? 'select' : item.type === 'json' ? 'textarea' : 'input');
      node.name = item.name; node.id = 'application-setting-' + item.name;
      if (!isInstallation && item.type !== 'json')
        node.type = item.type === 'boolean' ? 'checkbox' : item.type === 'port' ? 'number' : 'text';
      if (item.type === 'json') { node.rows = 5; node.spellcheck = false; }
      node.required = item.required; node.autocomplete = 'off';
      if (item.type === 'boolean') node.checked = values[item.name] === true;
      else if (!isInstallation) node.value = values[item.name] ?? (item.type === 'port' ? '0' : '');
      if (item.type === 'port') { node.min = '0'; node.max = '65535'; }
      const row = field(item.label, node);
      if (item.description) row.append(element('p', item.description, 'note'));
      settings.append(row);
      if(item.type==='path') row.append(button('Use saved file',()=>{
        const original=node.value,selectedKind=kind.value,selectedRuntime=runtime.value,workspaceId=getState()?.workspaceId;
        const current=()=>generation===settingsScope && node.isConnected && kind.value===selectedKind &&
          runtime.value===selectedRuntime && getState()?.workspaceId===workspaceId && node.value===original;
        inputLibrary.choose({kind:selectedKind,field:item.name,label:item.label,current,
          apply(path){if(!current())return;node.value=path;node.dispatchEvent(new Event('input',{bubbles:true}));
            configuration.open=true;reviewButton.focus();}});
      }));
      if (isInstallation) {
        node.replaceChildren(new Option('Loading installed environments', ''));
        const selectedRuntime = runtime.value;
        api(query('/api/python/state', { runtimeId: selectedRuntime })).then(value => {
          if (generation !== settingsScope || selectedRuntime !== runtime.value || !node.isConnected) return;
          const entries = value.installations ?? [];
          node.replaceChildren(new Option(entries.length ? 'Choose an installed environment' : 'Install or inspect an environment in Python first', ''),
            ...entries.map(entry => new Option(entry.source.name + ' ' + entry.source.version + ' · ' +
              (entry.extras.join(', ') || 'base') + ' · ' + entry.id.slice(0, 12), entry.id)));
          node.value = entries.some(entry => entry.id === values[item.name]) ? values[item.name] :
            entries.some(entry => entry.id === value.active?.installation) ? value.active.installation : '';
          drafts.settingsReady(node);
        }).catch(issue => {
          if (generation !== settingsScope || selectedRuntime !== runtime.value || !node.isConnected) return;
          node.replaceChildren(new Option('Python inventory unavailable', ''));
          drafts.settingsReady(node); error(issue);
        });
      }
    }
    configurationReview = null; reviewResult.hidden = true;
    openapiSetup.setContext().catch(error);
  }
  function configurationValue() {
    const values = {};
    for (const item of currentType()?.fields ?? []) {
      const node = settings.querySelector('[name="' + item.name + '"]');
      if (item.type === 'boolean') { if (node.checked) values[item.name] = true; }
      else if (node.value !== '') values[item.name] = item.type === 'port' ? Number(node.value) : node.value.trim();
    }
    return { runtimeId: runtime.value, kind: kind.value, label: label.value.trim(), settings: values,
      ...(currentType()?.providerId ? { providerId: currentType().providerId } : {}),
      applicationId: editingId, expectedRevision: drafts.baseRevision() };
  }
  function edit(app, options = {}) {
    drafts.edit(app, options);
    configuration.open = true; configuration.scrollIntoView({ block: 'nearest' });
    label.focus(); library.select(selectedId); renderSelected();
  }
  kind.addEventListener('change', () => drafts.changeKind(kind.value));
  form.addEventListener('input', event => {
    configurationReview = null; reviewResult.hidden = true;
    // Hide the previous registration review immediately while a bound field changes.
    // The change event reads the new context once, after the field edit.
    if (openapiContextField(event.target)) openapiSetup.reset();
    drafts.capture();
  });
  form.addEventListener('change', event => {
    drafts.capture();
    if (openapiContextField(event.target)) openapiSetup.setContext().catch(error);
  });
  runtime.addEventListener('change', () => {
    const values = configurationValue().settings;
    configurationReview = null; reviewResult.hidden = true;
    if (currentType()?.python) renderSettings({ ...values, installationId: undefined });
    else openapiSetup.setContext().catch(error);
    drafts.capture();
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); act(async () => {
      drafts.expectedRevision();
      const setupTicket = drafts.snapshot(), request = configurationValue();
      const received = await api('/api/applications/review', request);
      if (!drafts.matches(setupTicket)) {
        message('The setup changed while review was running. Review the current retained fields.');
        return;
      }
      configurationReview = received;
      const reviewed = configurationReview;
      const rows = facts([
        ['Original command', reviewed.command.pythonCommand ? reviewed.command.pythonCommand.executable + ' ' +
          reviewed.command.pythonCommand.argv.map(value => JSON.stringify(value)).join(' ') :
          'starforge ' + reviewed.command.command + ' ' + reviewed.command.args.map(value => JSON.stringify(value)).join(' ')],
        ['Runtime', reviewed.runtime.directory], ['Source commit', reviewed.runtime.sourceCommit],
        ...providerReviewRows(reviewed.applicationProvider),
        ['Managed home', reviewed.homeDirectory], ['Connection', reviewed.releaseId ? 'Existing original release ' + reviewed.releaseId : 'Adopt this original ready runtime'],
        ['Input', reviewed.command.terminal ? 'Connected original terminal, explicit operator responses' : 'Original application output'],
        ['Environment file', reviewed.settings.environmentFile ?? 'Inherited operator environment'],
        ...mppReviewRows(reviewed.command),
        ...wooReviewRows(reviewed.command),
      ]);
      const save = button(editingId ? 'Save reviewed settings' : 'Save application', () => act(async () => {
        if (configurationReview !== reviewed) return;
        const submitted = { scope, navigationVersion };
        save.disabled = true;
        let result;
        try { result = await retainedRequest('/api/applications/save', { reviewId: reviewed.id, applicationId: reviewed.applicationId }, setupTicket); }
        finally { save.disabled = false; }
        const completedSetup = drafts.saved(setupTicket, result);
        if (submitted.scope !== scope) return;
        if (submitted.navigationVersion === navigationVersion && completedSetup) selectedId = result.applicationId;
        configuration.open = !completedSetup; configurationReview = null; reviewResult.hidden = true;
        await refresh(); await refreshWorkspace();
        message(result.connectionError?.message ?? (completedSetup ?
          'Application saved with its original runtime and data locations.' :
          'Application saved. Your newer setup draft remains open.'));
      }));
      reviewResult.replaceChildren(element('h3', 'Reviewed application'), rows,
        renderOpenApiApplicationReview(reviewed.command), renderApplicationReview(reviewed.command), renderAccountingApplicationReview(reviewed.command), renderWorkbookReview(reviewed), save);
      if (reviewed.command.createDirectories.length) reviewResult.append(element('p', 'Creates private folder: ' + reviewed.command.createDirectories.join(', '), 'note'));
      reviewResult.hidden = false;
    });
  });
  function canStartApplication(app = selected()) {
    return Boolean(app && (app.connectionReady ?? Boolean(app.release))) && !app.error &&
      app.adoption?.active !== null && app.current?.active !== null && !app.current?.active &&
      !['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED', 'OBSERVATION_UNAVAILABLE'].includes(app.current?.phase);
  }
  function renderStartReview() {
    if (!startReview || selected()?.id !== startReview.applicationId) { operationReview.hidden = true; return; }
    const reviewed = startReview;
    const start = button('Start reviewed application', () => act(async () => {
      if (startReview !== reviewed || selected()?.id !== reviewed.applicationId || !canStartApplication()) return;
      const submitted = { scope, navigationVersion };
      start.disabled = true;
      let result;
      try { result = await retainedRequest('/api/applications/start', { applicationId: reviewed.applicationId, reviewId: reviewed.id }); }
      finally { start.disabled = !canStartApplication(); }
      if (submitted.scope !== scope) return;
      if (submitted.navigationVersion === navigationVersion) followOperation(reviewed.applicationId, result.operationId);
      if (startReview === reviewed) startReview = null;
      await refresh(); await refreshWorkspace(); message(reviewed.command.pythonCommand && !reviewed.command.pythonCommand.ready ?
        'The original workbook command is starting. Its operating result and output appear below.' :
        'The original application is starting. Its private URL will appear when its CLI prints it.');
    }));
    start.disabled = !canStartApplication();
    operationReview.replaceChildren(element('h3', 'Start review'), facts([
      ['Original command', reviewed.command.pythonCommand ? reviewed.command.pythonCommand.executable + ' ' +
        reviewed.command.pythonCommand.argv.map(value => JSON.stringify(value)).join(' ') :
        reviewed.command.command + ' ' + reviewed.command.args.map(value => JSON.stringify(value)).join(' ')],
      ['Release', reviewed.releaseId], ['Source', reviewed.runtime.sourceCommit],
      ...providerReviewRows(reviewed.applicationProvider),
      ['Inputs', reviewed.command.inputs.map(item => item.path).join('\n')],
      ['Terminal', reviewed.command.terminal ? 'Explicit operator input through the original controlling terminal' : 'Retained original output'],
      ...mppReviewRows(reviewed.command),
      ...wooReviewRows(reviewed.command),
    ]), renderOpenApiApplicationReview(reviewed.command), renderApplicationReview(reviewed.command), renderAccountingApplicationReview(reviewed.command), renderWorkbookReview(reviewed), start); operationReview.hidden = false;
  }
  function renderSelected() {
    const app = selected(); selectedPanel.hidden = !app; history.hidden = !app;
    if (!app) { outputPanel.hidden = true; return; }
    title.textContent = app.label; phase.textContent = app.phase;
    actions.hidden = Boolean(app.error);
    if (app.error) {
      details.replaceChildren(element('p', app.error.message));
      if (app.error.flock) details.append(element('pre', JSON.stringify(app.error.flock, null, 2)));
      outputPanel.hidden = true; historyRows.replaceChildren();
      relatedApplications.hidden = navigationRecovery.hidden = true; urlNote.textContent = ''; return;
    }
    const connected = app.connectionReady ?? Boolean(app.release);
    details.replaceChildren(facts([
      ['Application', data.catalog.find(item => item.id === app.kind)?.title ?? app.kind],
      ['Runtime', app.runtime.directory], ['Source commit', app.runtime.sourceCommit],
      ['Release', app.release?.id ?? 'Original runtime connection pending'], ['Managed home', app.homeDirectory],
      ['Runtime connection', connected ? 'CONNECTED' : app.adoption?.phase ?? 'PENDING'],
      ['Application revision', app.revision], ['Current operation', app.current?.id ?? 'No launch yet'],
      ...(app.current?.applicationProvider ? [['Run provider', app.current.applicationProvider.id + ' · ' + app.current.applicationProvider.sha256]] : []),
    ]));
    if (!connected && app.adoption?.state?.error?.message)
      details.append(element('p', app.adoption.state.error.message, 'note'));
    if (app.adoption?.state?.error?.flock)
      details.append(element('pre', JSON.stringify(app.adoption.state.error.flock, null, 2)));
    const current = app.current, active = Boolean(current?.active), unknown = current?.active === null,
      unsettled = ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED', 'OBSERVATION_UNAVAILABLE'].includes(current?.phase);
    for (const observed of [app.adoption, current]) {
      if (observed?.observation?.status !== 'UNAVAILABLE') continue;
      details.append(element('p', 'Process status is unavailable for ' + observed.id + '. Its saved configuration and output remain accessible.', 'note'));
      if (observed.observation.error) details.append(element('p', observed.observation.error.code + ': ' + observed.observation.error.message, 'note'));
      if (observed.observation.error?.flock)
        details.append(element('pre', JSON.stringify(observed.observation.error.flock, null, 2)));
    }
    reviewStart.disabled = !canStartApplication(app);
    stop.disabled = !current || !active && !unsettled;
    stop.textContent = current?.phase === 'PENDING' || current?.phase === 'QUEUED' ? 'Cancel pending start' : 'Stop application';
    reconnect.hidden = connected;
    reconnect.disabled = Boolean(app.adoption?.active) || app.adoption?.active === null;
    reconnect.textContent = app.adoption?.active ? 'Connecting runtime…' :
      app.adoption?.phase === 'FAILED' ? 'Retry runtime connection' :
        ['QUEUED', 'INTERRUPTED'].includes(app.adoption?.phase) ? 'Resume runtime connection' : 'Continue runtime connection';
    continueRun.hidden = !current || active || unknown || !unsettled;
    continueRun.textContent = current?.phase === 'INTERRUPTED' ? 'Reconcile original operation' : 'Continue original start';
    editButton.disabled = active || unknown || app.adoption?.active === null || unsettled;
    const woo = app.kind === 'woo-merchant';
    open.rel = woo ? 'noopener' : 'noopener noreferrer';
    open.referrerPolicy = woo ? 'origin' : 'no-referrer';
    wordpress.hidden = true; wordpress.removeAttribute('href');
    const wooRun = current?.url?.original;
    if (woo && wooRun?.schema === 'stellar-forge.sf104.managed-startup.v1') {
      try {
        const admin = new URL(wooRun.adminUrl), store = new URL(wooRun.storeOrigin);
        if (admin.protocol === 'https:' && admin.origin === store.origin && !admin.username && !admin.password &&
            admin.pathname.endsWith('/wp-admin/admin.php') && admin.search === '?page=sf98-woocommerce' && !admin.hash) {
          wordpress.href = admin.href; wordpress.hidden = false;
        }
      } catch { /* Original startup remains visible in its retained output. */ }
    }
    const navigationChanged = woo && Boolean(current?.privateUrl) &&
      (wooRun?.schema !== 'stellar-forge.sf104.managed-startup.v1' || wooRun.navigationOrigin !== location.origin);
    open.hidden = !current?.privateUrl || navigationChanged;
    if (current?.privateUrl && !navigationChanged) open.href = current.privateUrl; else open.removeAttribute('href');
    open.textContent = app.kind === 'mercury-feed' ? 'Open event feed' : 'Open application';
    const related = (current?.privateLinks ?? []).flatMap(link => {
      let url;
      try { url = new URL(link.url); } catch { return []; }
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
          Number(url.port || 80) < 1 || Number(url.port || 80) > 65535 ||
          url.username || url.password || typeof link.label !== 'string') return [];
      return [{ label: link.label, url: link.url }];
    });
    relatedApplications.replaceChildren(...(navigationChanged ? [] : related.map(link => {
      const anchor = element('a', link.label); anchor.href = link.url; anchor.target = '_blank';
      anchor.rel = woo ? 'noopener' : 'noopener noreferrer';
      anchor.referrerPolicy = woo ? 'origin' : 'no-referrer'; return anchor;
    })));
    relatedApplications.hidden = !relatedApplications.childElementCount;
    navigationRecovery.hidden = !navigationChanged;
    if (navigationChanged) {
      const signature = JSON.stringify([app.id, current.id, wooRun?.navigationOrigin, location.origin, current.privateUrl, related]);
      if (navigationRecovery.dataset.signature !== signature) {
        navigationRecovery.dataset.signature = signature;
        navigationRecovery.replaceChildren(
          element('h4', 'Open the running merchant'),
          element('p', 'This Applications address differs from the one recorded at merchant startup. Copy a saved address and paste it into a new tab’s address bar. The running service keeps its original access settings.', 'note'),
          ...[savedAddress('Operations', current.privateUrl), ...related.map(link => savedAddress(link.label, link.url))].filter(Boolean));
      }
    } else {
      navigationRecovery.replaceChildren(); delete navigationRecovery.dataset.signature;
    }
    const workbookCommand = isWorkbookApplication(app, current);
    urlNote.textContent = unknown ? 'Current process status is unavailable. Any address shown is the original saved address; refresh status to observe the current process. Retained output remains accessible.' : workbookCommand ? (active ? 'The original workbook command is running. Its output is retained below.' :
      current ? 'The original workbook command has ended. Open its retained outcome and complete output below.' :
      'Review a start to run this original workbook command.') : navigationChanged ?
      'The original process and saved addresses are still attached to this operation. To restore direct Open buttons here, stop it and review a new start from this Applications address.' :
      current?.privateUrl ? 'The link above is the original private application URL. It remains attached to this operation across runtime-console restarts at the same address.' :
      active ? current.stop ? 'The original application is draining its work and stopping.' : 'Waiting for the original application to print its local session URL.' :
        current?.url ? 'This operation has ended. Its retained URL is historical; review a new start to open the same saved application data.' :
          'Save and review a start to receive the original application URL.';
    const pageRuns = visibleRuns();
    const signature = JSON.stringify([app.id, pageRuns]);
    if (historyRows.dataset.signature !== signature) {
      historyRows.dataset.signature = signature;
      historyRows.replaceChildren(...pageRuns.map(run => {
        const row = element('article', undefined, 'operation');
        const actions = element('div', undefined, 'actions');
        actions.append(button('Open output', () => { navigationVersion++; selectedRun = run.id; saveSelection(); refreshOutput().catch(error); }));
        row.append(element('h3', run.command + ' · ' + run.phase),
          element('p', run.id + ' · ' + run.createdAt),
          element('p', run.result || run.resultSource ? outcomeText(run.result, run.resultSource) :
            run.active === null ? 'Current process status is unavailable. Original operation retained.' :
              run.active ? 'The original worker or command is active.' : 'Original operation retained.'),
          actions);
        if (run.result || run.resultSource) {
          const receipt = element('details'); receipt.append(element('summary', 'Complete retained outcome'),
            element('pre', JSON.stringify({ result: run.result, resultSource: run.resultSource ?? null,
              commandResult: run.commandResult ?? null }, null, 2)));
          row.append(receipt);
        }
        if (run.observation?.error) row.append(element('p', run.observation.error.code + ': ' + run.observation.error.message, 'note'));
        if (run.observation?.error?.flock || run.state?.error?.flock || run.result?.error?.flock) {
          const diagnostic = element('details'); diagnostic.append(element('summary', 'Original lock process diagnostics'),
            element('pre', JSON.stringify(run.observation?.error?.flock ?? run.state?.error?.flock ?? run.result.error.flock, null, 2)));
          row.append(diagnostic);
        }
        return row;
      }));
    }
    if (!selectedRun || !pageRuns.some(run => run.id === selectedRun)) selectedRun = pageRuns[0]?.id ?? null;
    renderHistoryNavigation(); renderStartReview();
  }
  async function refreshOutput() {
    const app = selected(), id = selectedRun, own = scope;
    if (!app || !id) { outputPanel.hidden = true; workbookResults.reset(); return; }
    const run = visibleRuns().find(item => item.id === id);
    if (!run) { outputPanel.hidden = true; workbookResults.reset(); return; }
    const response = await api(query(run.terminal ? '/api/applications/terminal' : '/api/applications/output', { applicationId: app.id, operationId: id }));
    if (scope !== own || app.id !== selectedId || id !== selectedRun) return;
    outputPanel.hidden = false;
    await outputReader.update({ applicationId: app.id, operationId: id });
    if (scope !== own || app.id !== selectedId || id !== selectedRun) return;
    outputDescription.textContent = id;
    if (response.observation?.status === 'UNAVAILABLE')
      outputDescription.textContent += ' · Current process status is unavailable; retained output and results remain attached.';
    const outcome = run.terminal ? response.managedOutcome : response;
    if (outcome?.result || outcome?.resultSource) outputDescription.textContent += ' · ' + outcomeText(outcome.result, outcome.resultSource);
    await workbookResults.update(app, run, response);
    if (scope !== own || app.id !== selectedId || id !== selectedRun) return;
    inputForm.hidden = !run.terminal;
    input.disabled = send.disabled = interrupt.disabled = eof.disabled = !response.ready || sending;
    if (run.terminal) {
      inputStatus.replaceChildren(...response.inputs.slice(0, 8).map(receipt =>
        element('p', 'Input ' + receipt.sequence + ' · ' + receipt.state + ' · ' + receipt.bytes + ' bytes · ' + receipt.inputId, 'note')));
      const pending = readSaved('terminal-input');
      const receipt = pending && response.inputs.find(item => item.inputId === pending.inputId);
      if (receipt && receipt.state !== 'QUEUED') saveSaved('terminal-input', null);
      if (response.result) inputStatus.prepend(element('p', 'This terminal has ended. Its input and output belong to this original operation.', 'note'));
      else if (!response.active && (response.managedOutcome?.result || response.managedOutcome?.resultSource))
        inputStatus.prepend(element('p', outcomeText(response.managedOutcome.result, response.managedOutcome.resultSource), 'note'));
    }
  }
  async function terminalSend(text) {
    if (sending) return;
    const app = selected(), id = selectedRun, own = scope;
    if (!app || !id || app.current?.id !== id || !app.current.active) throw new Error('Open the running original terminal');
    sending = true; send.disabled = true;
    try {
      const sha256 = await textHash(text), previous = readSaved('terminal-input');
      const pending = previous?.operationId === id && previous.sha256 === sha256 ? previous :
        { applicationId: app.id, operationId: id, inputId: crypto.randomUUID(), sha256 };
      saveSaved('terminal-input', pending);
      const result = await api('/api/applications/input', { applicationId: app.id, operationId: id, inputId: pending.inputId, text });
      if (scope !== own) return;
      saveSaved('terminal-input', null);
      input.value = '';
      message('Terminal input ' + result.inputId + ' is ' + result.state.toLowerCase() + '. This records delivery to the original terminal; application decisions remain in its own output.');
      await refreshOutput();
    } finally { sending = false; if (scope === own) await refreshOutput(); }
  }
  inputForm.addEventListener('submit', event => { event.preventDefault(); terminalSend(input.value + '\n').catch(error); });
  const recoverRequest = button('Recover last application request', () => act(async () => {
    const pending = readSaved('pending'); if (!pending) return;
    const submitted = { scope, navigationVersion };
    const result = await completeRetainedRequest(pending);
    const completedSetup = pending.route === '/api/applications/save' && pending.setupTicket ? drafts.saved(pending.setupTicket, result) : false;
    if (submitted.scope !== scope) return;
    if (submitted.navigationVersion === navigationVersion && (!pending.setupTicket || completedSetup)) {
      selectedId = result.applicationId ?? selectedId;
      followOperation(selectedId, result.operationId);
    }
    if (completedSetup) configuration.open = false;
    await refresh(); await refreshWorkspace();
  }));
  header.append(recoverRequest);
  async function refresh() {
    if (loading) return;
    loading = true; const own = scope;
    try {
      const value = await api('/api/applications/state?historyLimit=1');
      if (own !== scope) return;
      data = value;
      if (initial) {
        initial = false; const saved = readSaved('selected');
        if (saved) {
          selectedId = saved.selectedId; selectedRun = saved.selectedRun; historyApplicationId = selectedId;
          historyCursor = typeof saved.historyCursor === 'string' ? saved.historyCursor : null;
          historyTrail = Array.isArray(saved.historyTrail) ? saved.historyTrail.filter(value => value === null || typeof value === 'string') : [];
        }
      }
      drafts.refresh();
      if (!data.applications.some(item => item.id === selectedId)) { selectedId = data.applications[0]?.id ?? null; resetHistory(selectedId); }
      library.update(data, selectedId); inputLibrary.update();
      recoverRequest.hidden = !readSaved('pending');
      if (data.applications.length && editingId === null && !configurationReview && !label.value && !drafts.hasDraft())
        configuration.open = false;
      if (!historyLoading) await refreshHistory();
      renderSelected(); await refreshOutput();
      await openapiSetup.refresh().catch(error);
      saveSelection();
    } finally { loading = false; }
  }
  return {
    refresh,
    async beginPython(descriptor) {
      data = await api('/api/applications/state?historyLimit=1');
      let workbookSetup = workbookFormFromDescriptor(descriptor);
      const namedWorkbook = workbookSetup ? data.catalog.find(item => item.id === workbookSetup.kind) : null;
      if (!namedWorkbook) workbookSetup = null;
      const type = namedWorkbook ??
        data.catalog.find(item => item.id === (descriptor.command === 'workbooks' ? 'python-workbooks' : descriptor.command === 'workbookDelivery' ? 'python-workbook-delivery' : '')) ??
        data.catalog.find(item => item.python && item.command === descriptor.command);
      if (!type) throw new Error('This Applications revision does not include the selected original Python command.');
      const value = name => descriptor.args[descriptor.args.indexOf(name) + 1];
      kind.replaceChildren(...data.catalog.map(item => new Option(item.title, item.id)));
      const savedRuntime = getState()?.runtimes.find(item => item.id === descriptor.runtime.runtimeId);
      if (![...runtime.options].some(item => item.value === descriptor.runtime.runtimeId))
        runtime.append(new Option(savedRuntime?.label ?? descriptor.runtime.directory, descriptor.runtime.runtimeId));
      configurationReview = startReview = null;
      const values = { installationId: descriptor.installationId };
      if (workbookSetup) {
        Object.assign(values, workbookSetup.values);
      } else if (descriptor.command === 'postgres') {
        if (!descriptor.args.includes('serve')) throw new Error('Prepare the PostgreSQL serve command with its private operator directory.');
        const option = (name, fallback) => {
          const index = descriptor.args.indexOf(name);
          return index >= 0 ? descriptor.args[index + 1] :
            descriptor.args.find(item => item.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
        };
        values.workspaceDirectory = option('--workspace');
        values.connectionEnvironment = option('--connection-env', 'SF_BUYER_POSTGRES_DSN');
        values.databaseSchema = option('--schema', 'sf_received');
        values.port = Number(option('--port', '0'));
      } else if (descriptor.command === 'duckdb') {
        values.workspaceDirectory = value('--workspace');
        values.port = descriptor.args.includes('--port') ? Number(value('--port')) : 0;
        if (descriptor.args.includes('--export-root')) values.exportRoot = value('--export-root');
        if (descriptor.args.includes('--handoff-root')) values.handoffRoot = value('--handoff-root');
      } else if (descriptor.command === 'analysis') {
        values.databaseDirectory = value('--database');
        if (descriptor.args.includes('--node')) values.nodeExecutable = value('--node');
        values.port = descriptor.args.includes('--port') ? Number(value('--port')) : 0;
      } else values.argumentsJSON = JSON.stringify(descriptor.args, null, 2);
      drafts.edit(null, { kind: type.id, label: type.title, runtimeId: descriptor.runtime.runtimeId, values });
      configuration.open = true;
      switchView('applications'); configuration.scrollIntoView({ block: 'nearest' });
      label.focus();
    },
    async choose(id) { navigationVersion++; selectedId = id; selectedRun = null; resetHistory(id); switchView('applications'); await refresh(); },
    reset() {
      scope++; navigationVersion++; data = null; selectedId = selectedRun = editingId = null; configurationReview = startReview = null;
      resetHistory(null); outputReader.reset(); initial = true; drafts.reset(); library.reset(); label.value = ''; kind.replaceChildren(); runtime.replaceChildren();
      selectedPanel.hidden = history.hidden = outputPanel.hidden = reviewResult.hidden = true; configuration.open = true;
      openapiSetup.reset(); inputLibrary.reset(); workbookResults.reset();
    },
  };
}
