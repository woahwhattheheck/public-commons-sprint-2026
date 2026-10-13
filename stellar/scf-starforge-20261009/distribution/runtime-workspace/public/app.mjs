import { initImageWorkspace, imageOperationRecovery } from './image.mjs';
import { createRuntimeTransferView } from './transfer.mjs';
import { createWorkspaceReceivingView } from './workspace-receiving.mjs';
import { createOperatingProceduresView } from './operating-procedures.mjs';
import { createManagedWorkspaceView } from './managed.mjs';
import { createApplicationsWorkspaceView } from './applications.mjs';
import { createPythonWorkspaceView } from './python.mjs';
import { createSourceBuildWorkspaceView } from './source-build.mjs';
// MIT. Industrial operator presentation; original runtime records remain authoritative.
const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const tokenKey = 'starforge-runtime-capability';
let token = location.hash.slice(1) || sessionStorage.getItem(tokenKey) || '';
if (location.hash) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname); }
let state, selectedId = null, profileReview = null, selectedArchive = null, handoff = null;
let loading = false, refreshAgain = false, view = 'runtime', logSelection = null, initial = true;
let archiveSelectionGeneration = 0, logRequestGeneration = 0;
const pendingKey = () => 'starforge-runtime-pending-request-' + state?.workspaceId;
function message(text = '') { $('message').textContent = text; $('message').hidden = !text; }
function error(value) {
  if (!value.workspaceChanged) message((value.code ? value.code + ': ' : '') + value.message +
    (value.flock ? '\nOriginal lock process diagnostics:\n' + JSON.stringify(value.flock, null, 2) : ''));
}
const failureFields = (value, status) => ({ code: value.error, ...(status === undefined ? {} : { status }),
  ...(value.flock && typeof value.flock === 'object' && Array.isArray(value.flock.attempts) ? { flock: value.flock } : {}) });
async function api(path, value) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST',
    headers: { 'x-runtime-workspace-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? result.error), failureFields(result, response.status));
  return result;
}
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([,v]) => v));
function prefs() {
  if (!state) return;
  try { localStorage.setItem('starforge-runtime-' + state.workspaceId, JSON.stringify({ selectedId, view, logSelection })); } catch {}
}
function switchView(name) {
  view = name;
  document.querySelectorAll('[data-pane]').forEach(node => { node.hidden = node.dataset.pane !== name; });
  document.querySelectorAll('[data-view]').forEach(node => { if (node.dataset.view === name) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  prefs();
  if (name === 'managed') managed.refresh().catch(error);
  if (name === 'applications') applications.refresh().catch(error);
  if (name === 'transfers') transfers.refresh().catch(error);
  if (name === 'workspace-backups') workspaceReceiving.refresh().catch(error);
  if (name === 'operating-procedures') operatingProcedures.refresh().catch(error);
  if (name === 'python') python.refresh().catch(error);
  if (name === 'source-builds') sourceBuilds.refresh().catch(error);
}
document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => switchView(node.dataset.view)));
function facts(container, rows) {
  container.replaceChildren(...rows.map(([label, value]) => { const row = make('div'); row.append(make('dt', label), make('dd', value ?? '—')); return row; }));
}
function table(headers, rows) {
  const wrap = make('div', undefined, 'table-wrap'), node = make('table'), head = make('thead'), hr = make('tr'), body = make('tbody');
  for (const title of headers) hr.append(make('th', title));
  head.append(hr);
  for (const row of rows) { const tr = make('tr'); for (const cell of row) tr.append(make('td', String(cell ?? '—'))); body.append(tr); }
  node.append(head, body); wrap.append(node); return wrap;
}
function setOptions(select, items, empty, preferred) {
  const value = preferred ?? select.value;
  const signature = JSON.stringify(items);
  if (select.dataset.items !== signature) {
    select.replaceChildren(new Option(empty, ''), ...items.map(item => new Option(item.label, item.id)));
    select.dataset.items = signature;
  }
  if (items.some(item => item.id === value)) select.value = value;
}
const selected = () => state?.selected?.id === selectedId ? state.selected : null;
function cacheOptions() {
  const value = { offline: $('offline').checked };
  if ($('npm-cache').value.trim()) value.cache = $('npm-cache').value.trim();
  if ($('node-headers').value.trim()) value.nodeHeaders = $('node-headers').value.trim();
  return value;
}
function busy(runtimeId) {
  return !!state?.operations.some(job => (job.runtimeId === runtimeId || job.targetId === runtimeId) && (job.workerActive || job.workerActive === null || job.commandActive || job.phase === 'QUEUED'));
}
function updateControls() {
  const value = selected(), exists = !!value, active = exists && busy(value.id);
  $('inspect').disabled = !value?.profile;
  $('install').disabled = !exists || active || !value.state;
  $('recover').disabled = !exists || active;
  $('install-log').disabled = !value?.state?.logFile;
  $('compare').disabled = !exists || !$('compare-after').value;
  $('create-handoff').disabled = !exists || value.phase !== 'READY';
  $('review-profile').disabled = !selectedArchive;
  $('prepare').disabled = !profileReview;
  $('upgrade').disabled = !profileReview || !exists || active || !value.profile;
}
function renderInspection() {
  const container = $('inspection'), saved = state.observation;
  const signature = JSON.stringify(saved);
  if (container.dataset.rendered === signature) return;
  container.dataset.rendered = signature;
  container.hidden = !saved;
  if (!saved) return;
  const value = saved.result;
  container.replaceChildren(make('p', (value.ready ? 'Runtime ready' : 'Runtime needs attention') + ' · inspected ' + new Date(saved.observedAt).toLocaleString()));
  if (value.sourceVerified) container.append(make('p', 'Complete original archive, source inventory and file modes matched.', 'note'));
  const dependencies = value.profile?.dependencies ?? [];
  if (dependencies.length) container.append(table(['Dependency', 'Selected', 'Observed version', 'Readiness'], dependencies.map(item =>
    [item.name, item.expectedVersion, [...new Set((item.checks ?? []).map(check => check.version).filter(Boolean))].join(', ') || '—',
      (item.ready ? 'Ready' : 'Needs attention') + ': ' + (item.checks ?? []).map(check =>
        check.group + ' ' + check.state + (check.importState && check.importState !== 'NOT_REQUESTED' ? ' / ' + check.importState : '') +
        (check.native ? ' / native ' + (check.native.state ?? check.native.status ?? 'reported') : '')).join('; ')])));
  const detail = make('details'), summary = make('summary', 'Original inspection detail');
  detail.append(summary, make('pre', JSON.stringify(value, null, 2))); container.append(detail);
}
function renderRuntime() {
  const value = selected();
  $('selected-name').textContent = value?.label ?? 'Open a runtime to begin';
  $('selected-phase').textContent = value?.phase ?? 'EMPTY';
  $('selected-version').textContent = value ? (value.packageVersion ?? 'Original preparation') +
    (value.sourceCommit ? ' · source ' + value.sourceCommit.slice(0, 12) : '') : 'Open an existing installation or prepare a source archive.';
  facts($('runtime-facts'), value ? [['Selected dependencies', value.profile?.dependencies?.length ?? '—'],
    ['npm attempts', value.state?.attempts ?? 0], ['Install step', value.state?.stage ?? value.phase]] : []);
  facts($('runtime-paths'), value ? [['Runtime directory', value.directory], ['Source root', value.sourceRoot],
    ['Dependency root', value.dependencyRoot], ['Archive SHA-256', value.archiveSha256], ['Profile identity', value.profileId],
    ['Dependency lock SHA-256', value.state?.lockSha256]] : []);
  const peers = state.runtimes.filter(item => item.id !== value?.id);
  setOptions($('compare-after'), peers.map(item => ({ id: item.id, label: item.label })), 'Choose a runtime');
  renderInspection(); updateControls();
}
function renderOperations() {
  $('operation-count').textContent = String(state.operations.length);
  const selectedLog = logSelection?.operationId;
  const list = $('operations'), signature = JSON.stringify([state.operations, selectedLog]);
  if (list.dataset.rendered === signature) return;
  list.dataset.rendered = signature;
  const expanded = new Set([...list.querySelectorAll('article[data-operation-id]')]
    .filter(article => article.querySelector('details')?.open).map(article => article.dataset.operationId));
  list.replaceChildren();
  if (!state.operations.length) { list.append(make('p', 'Operations appear here when you inspect, prepare, install, upgrade or recover.', 'empty')); return; }
  for (const job of state.operations) {
    const article = make('article', undefined, 'operation'), title = make('div', undefined, 'section-title');
    article.dataset.operationId = job.id;
    title.append(make('h3', job.operation.charAt(0).toUpperCase() + job.operation.slice(1)), make('span', job.displayPhase, 'status'));
    article.append(title, make('p', (job.createdAt ? new Date(job.createdAt).toLocaleString() + ' · ' : '') + job.id, 'muted'));
    for (const [label, path] of [['Runtime output', job.targetDirectory], ['Image context', job.contextDirectory],
      [job.cacheTransferId ? 'Runtime source transfer' : 'Image transfer', job.transferDirectory], ['Container output', job.containerDirectory], ['Product build', job.sourceBuildOutput]])
      if (path) article.append(make('p', label + ': ' + path));
    if (job.error) article.append(make('p', job.error.code + ': ' + job.error.message));
    if (job.observation?.status === 'UNAVAILABLE') {
      article.append(make('p', 'Current process status is unavailable. Open retained output or refresh this operation.', 'note'));
      const detail = make('details');
      detail.append(make('summary', 'Status check detail'), make('pre', JSON.stringify(job.observation, null, 2)));
      article.append(detail);
    }
    if (job.error?.flock) {
      const receipt = make('details'); receipt.append(make('summary', 'Original lock process diagnostics'),
        make('pre', JSON.stringify(job.error.flock, null, 2))); article.append(receipt);
    }
    if (job.displayPhase === 'INTERRUPTED' && !job.homeId && !job.cacheTransferId && !job.sourceBuildId && !job.operation.startsWith('python-')) article.append(make('p', job.imageId || job.transferId
      ? imageOperationRecovery(job)
      : 'The workspace worker ended. Open its retained runtime and resume installation or recover into a new directory.', 'note'));
    const actions = make('div', undefined, 'actions');
    if (job.applicationId) {
      const openApplication = make('button', 'Open application'); openApplication.type = 'button';
      openApplication.addEventListener('click', () => applications.choose(job.applicationId).catch(error));
      actions.append(openApplication);
    }
    if (job.sourceBuildId) {
      if (job.sourceBuildStage) article.append(make('p', 'Product stage: ' + job.sourceBuildStage));
      const openProduct = make('button', 'Open product build'); openProduct.type = 'button';
      openProduct.addEventListener('click', () => sourceBuilds.choose(job.sourceBuildId).catch(error)); actions.append(openProduct);
      if (['FAILED', 'QUEUED'].includes(job.phase) || job.displayPhase === 'INTERRUPTED') {
        const recover = make('button', 'Continue original product build'); recover.type = 'button';
        recover.addEventListener('click', () => api('/api/source-builds/recover', { operationId: job.id }).then(() => refresh()).catch(error));
        actions.append(recover);
      }
    }
    if (job.operation.startsWith('python-')) {
      if (job.pythonStage) article.append(make('p', 'Python stage: ' + job.pythonStage));
      if (['FAILED', 'QUEUED'].includes(job.phase) || job.displayPhase === 'INTERRUPTED') {
        const recover = make('button', 'Continue original Python operation'); recover.type = 'button';
        recover.addEventListener('click', () => api('/api/python/recover', { operationId: job.id }).then(() => refresh()).catch(error));
        actions.append(recover);
      }
    }
    if (job.homeId) {
      const home = make('button', 'Open managed home'); home.type = 'button';
      home.addEventListener('click', () => managed.choose(job.homeId).catch(error)); actions.append(home);
      if (['FAILED', 'QUEUED'].includes(job.phase) || job.displayPhase === 'INTERRUPTED') {
        const recover = make('button', 'Recover managed operation'); recover.type = 'button';
        recover.addEventListener('click', () => api('/api/managed/recover', { operationId: job.id }).then(() => refresh()).catch(error)); actions.append(recover);
      }
      if (job.operation === 'managed-run' && job.phase === 'RUNNING') {
        const stop = make('button', 'Stop original command'); stop.type = 'button';
        stop.addEventListener('click', () => api('/api/managed/stop', { operationId: job.id }).then(() => refresh()).catch(error)); actions.append(stop);
      }
    }
    if (job.cacheTransferId) {
      const open = make('button', 'Open source transfer'); open.type = 'button';
      open.addEventListener('click', () => transfers.choose(job.cacheTransferId).then(() => switchView('transfers')).catch(error)); actions.append(open);
      if (['FAILED', 'QUEUED'].includes(job.phase) || job.displayPhase === 'INTERRUPTED') {
        const resume = make('button', 'Continue retained transfer operation'); resume.type = 'button';
        resume.addEventListener('click', () => api('/api/transfers/recover-operation', { operationId: job.id }).then(() => refresh()).catch(error)); actions.append(resume);
      }
    }
    if (job.imageId || job.transferId) {
      const open = make('button', 'Open image'); open.type = 'button';
      open.addEventListener('click', () => images.choose({ imageId: job.imageId, transferId: job.transferId }).catch(error)); actions.append(open);
    }
    if (job.runtimeId || job.targetId) {
      const open = make('button', 'Open runtime'); open.type = 'button';
      open.addEventListener('click', () => chooseRuntime(job.targetId ?? job.runtimeId)); actions.append(open);
    }
    const observe = make('button', 'Refresh operation status'); observe.type = 'button';
    observe.addEventListener('click', () => refreshOperation(job.id).catch(error)); actions.append(observe);
    const log = make('button', selectedLog === job.id ? 'Refresh selected worker log' : 'Open worker log'); log.type = 'button';
    log.addEventListener('click', () => openLog({ operationId: job.id }).catch(error)); actions.append(log);
    if (job.phase === 'QUEUED' && !job.sourceBuildId && !job.operation.startsWith('python-')) {
      const resume = make('button', 'Start retained request'); resume.type = 'button';
      resume.addEventListener('click', () => api('/api/resume-queued', { operationId: job.id }).then(() => refresh()).catch(error)); actions.append(resume);
    }
    article.append(actions);
    if (job.result) { const detail = make('details'); detail.open = expanded.has(job.id); detail.append(make('summary', 'Original operation result'), make('pre', JSON.stringify(job.result, null, 2))); article.append(detail); }
    if (job.resultSource) article.append(make('p', 'Original receipt: ' + job.resultSource));
    list.append(article);
  }
}
function connectionStatus() {
  const ids = state.operations.filter(job => job.observation?.status === 'UNAVAILABLE').map(job => job.id);
  const unavailable = ids.length;
  state.operationObservation = { status: unavailable ? 'PARTIAL' : 'CURRENT',
    total: state.operations.length, unavailable, unavailableOperationIds: ids };
  $('connection').textContent = unavailable
    ? 'Connected · ' + unavailable + ' operation status ' + (unavailable === 1 ? 'check' : 'checks') + ' unavailable'
    : state.operations.some(job => job.workerActive || job.commandActive) ? 'Operation in progress' : 'Connected';
}
async function refreshOperation(id) {
  const requestedToken = token, workspaceId = state?.workspaceId;
  const job = await api(query('/api/operation-status', { operationId: id }));
  if (token !== requestedToken || state?.workspaceId !== workspaceId) return;
  const index = state.operations.findIndex(item => item.id === id);
  if (index < 0) state.operations.push(job);
  else if ((state.operations[index].observation?.checkedAt ?? '') <= (job.observation?.checkedAt ?? ''))
    state.operations[index] = job;
  connectionStatus(); renderRuntime(); renderOperations();
  if (view === 'managed') await managed.refresh();
}
async function refresh({ quiet = false } = {}) {
  if (loading) { refreshAgain = true; return; }
  loading = true;
  const requestedId = selectedId, requestedToken = token, requestedView = view;
  try {
    let value = await api(query('/api/state', { runtimeId: selectedId }));
    if (selectedId !== requestedId || token !== requestedToken) { refreshAgain = true; return; }
    if (initial) {
      initial = false;
      try {
        const saved = JSON.parse(localStorage.getItem('starforge-runtime-' + value.workspaceId) ?? 'null');
        if (saved?.selectedId && value.runtimes.some(item => item.id === saved.selectedId)) {
          selectedId = saved.selectedId; value = await api(query('/api/state', { runtimeId: selectedId }));
        }
        if (['runtime', 'profile', 'operations', 'deployment', 'managed', 'images', 'applications', 'transfers', 'python', 'source-builds', 'workspace-backups', 'operating-procedures'].includes(saved?.view) && view === requestedView) view = saved.view;
        logSelection = saved?.logSelection ?? null;
      } catch {}
    }
    if (token !== requestedToken) { refreshAgain = true; return; }
    if (state?.workspaceId === value.workspaceId) {
      // Preserve a newer direct operation refresh while the larger snapshot was loading.
      const current = new Map(state.operations.map(job => [job.id, job]));
      value.operations = value.operations.map(job =>
        (current.get(job.id)?.observation?.checkedAt ?? '') > (job.observation?.checkedAt ?? '') ? current.get(job.id) : job);
    }
    state = value; selectedId = value.selected?.id ?? selectedId;
    connectionStatus();
    $('workspace-location').textContent = value.directory;
    $('runtime-home').textContent = 'New runtime directories: ' + value.runtimeHome;
    $('runtime-count').textContent = String(value.runtimes.length);
    const runtimeList = $('runtime-list'), runtimeSignature = JSON.stringify([value.runtimes, selectedId]);
    if (runtimeList.dataset.rendered !== runtimeSignature) runtimeList.replaceChildren(...value.runtimes.map(item => {
      const node = make('button', undefined, 'runtime-entry' + (item.id === selectedId ? ' selected' : ''));
      node.type = 'button'; node.dataset.runtimeId = item.id;
      node.append(make('strong', item.label), make('small', item.phase + (item.packageVersion ? ' · ' + item.packageVersion : '')));
      node.addEventListener('click', () => chooseRuntime(item.id)); return node;
    }));
    runtimeList.dataset.rendered = runtimeSignature;
    if (!value.runtimes.length) $('attach-details').open = true;
    const previousArchive = $('archive-select').value;
    setOptions($('archive-select'), value.archives.map(item => ({ id: item.id, label: item.label + ' · ' + item.packageVersion })), 'Choose a source archive');
    if (!$('archive-select').value && value.archives.length) {
      const match = value.archives.find(item => item.sourceRoot === value.selected?.sourceRoot) ?? value.archives[0];
      $('archive-select').value = match.id;
    }
    if (previousArchive !== $('archive-select').value) archiveSelectionGeneration++;
    if ($('archive-select').value && (!selectedArchive || previousArchive !== $('archive-select').value)) await loadCatalog();
    renderRuntime(); renderOperations(); switchView(view); await images.render();
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey()) ?? 'null'); } catch { sessionStorage.removeItem(pendingKey()); }
    if (pending && value.operations.some(job => job.id === pending.requestId)) sessionStorage.removeItem(pendingKey());
    $('retry-request').hidden = !sessionStorage.getItem(pendingKey());
    if (logSelection && view === 'operations' && $('log-panel').hidden) await openLog(logSelection);
    prefs();
  } catch (value) {
    if (token !== requestedToken) { refreshAgain = true; return; }
    $('connection').textContent = 'Connection unavailable'; if (!quiet) error(value);
    if (!state) {
      if (view !== 'workspace-backups') switchView('workspace-backups');
      else workspaceReceiving.refresh().catch(error);
    }
  }
  finally { loading = false; if (refreshAgain) { refreshAgain = false; await refresh({ quiet }); } }
}
async function chooseRuntime(id) {
  selectedId = id; handoff = null; $('handoff').hidden = true; $('comparison').hidden = true;
  updateControls();
  switchView('runtime'); prefs(); await refresh();
}
function invalidateReview() {
  profileReview = null; $('profile-review').hidden = true; updateControls();
}
async function loadCatalog() {
  invalidateReview();
  const id = $('archive-select').value, generation = archiveSelectionGeneration,
    requestedToken = token, workspaceId = state?.workspaceId;
  if (!id) { selectedArchive = null; updateControls(); return; }
  const value = await api(query('/api/catalog', { archiveId: id }));
  if ($('archive-select').value !== id || generation !== archiveSelectionGeneration ||
      token !== requestedToken || state?.workspaceId !== workspaceId) return;
  selectedArchive = value.archive;
  $('archive-detail').textContent = value.archive.packageVersion + ' · source ' + value.archive.sourceCommit + ' · SHA-256 ' + value.archive.sha256;
  const original = selected()?.profile?.source?.sourceCommit === value.archive.sourceCommit ? selected().profile.selection : null;
  $('native').checked = original?.native ?? false;
  $('operator').checked = original?.operator ?? true;
  $('pins').value = JSON.stringify(original?.pins ?? {}, null, 2);
  $('features').replaceChildren(...Object.keys(value.catalog.groups).filter(name => name !== 'native').sort().map(name => {
    const label = make('label'), input = make('input'); input.type = 'checkbox'; input.value = name;
    input.checked = original?.features.includes(name) ?? false;
    input.addEventListener('change', invalidateReview); label.append(input, document.createTextNode(name)); return label;
  }));
  updateControls();
}
function selectedProfile() {
  let pins;
  try { pins = JSON.parse($('pins').value); } catch { throw new Error('Enter exact version pins as a JSON object.'); }
  return { native: $('native').checked, operator: $('operator').checked,
    features: [...$('features').querySelectorAll('input:checked')].map(input => input.value), pins };
}
async function reviewProfile() {
  message('');
  const archiveId = $('archive-select').value, selection = selectedProfile();
  const value = await api('/api/review', { archiveId, selection });
  if ($('archive-select').value !== archiveId || JSON.stringify(selectedProfile()) !== JSON.stringify(selection)) {
    invalidateReview(); message('The selection changed during review. Review the current profile.'); return;
  }
  profileReview = { archiveId: $('archive-select').value, profileId: value.profileId, selection: value.selection };
  const output = $('profile-review'); output.hidden = false;
  output.replaceChildren(make('p', 'Reviewed profile · ' + value.dependencies.length + ' selected dependencies'));
  output.append(make('p', 'Node ' + value.host.node + (value.host.python ? ' · Python ' + value.host.python + ' · Linux / flock' : ''), 'note'));
  if (value.dependencies.length) output.append(table(['Dependency', 'Exact version', 'Original declaration'], value.dependencies.map(item => [item.name, item.version, item.requested.join(', ')])));
  else output.append(make('p', 'The base profile uses the original toolkit without optional Node dependencies.', 'note'));
  const detail = make('details'); detail.append(make('summary', 'Full exact profile'), make('pre', JSON.stringify(value, null, 2))); output.append(detail); updateControls();
}
function operationScope() {
  if (!state?.workspaceId) throw new Error('Open the runtime workspace before creating an operation.');
  const requestedToken = token, workspaceId = state.workspaceId, storageKey = pendingKey();
  return { storageKey,
    current: () => token === requestedToken && state?.workspaceId === workspaceId,
    clear: encoded => { if (sessionStorage.getItem(storageKey) === encoded) sessionStorage.removeItem(storageKey); },
  };
}
async function showOperationResult(result, scope) {
  if (!scope.current()) return false;
  if (result.runtimeId) selectedId = result.runtimeId;
  if (result.homeId) await managed.choose(result.homeId);
  if (!scope.current()) return false;
  if (result.cacheTransferId) await transfers.choose(result.cacheTransferId);
  if (!scope.current()) return false;
  switchView('operations'); await refresh();
  return scope.current();
}
async function operation(value) {
  const scope = operationScope();
  message('');
  if (sessionStorage.getItem(scope.storageKey))
    throw new Error('Recover the retained request shown in the sidebar before creating another operation.');
  const input = { requestId: crypto.randomUUID(), ...value }, encoded = JSON.stringify(input);
  sessionStorage.setItem(scope.storageKey, encoded);
  let result;
  try { result = await api('/api/operation', input); }
  catch (value) {
    if (value.status && scope.current()) {
      try {
        const current = await api('/api/state');
        if (scope.current() && current.workspaceId === state.workspaceId &&
            !current.operations.some(job => job.id === input.requestId)) scope.clear(encoded);
      } catch {}
    }
    if (scope.current()) $('retry-request').hidden = !sessionStorage.getItem(scope.storageKey);
    else value.workspaceChanged = true;
    throw value;
  }
  scope.clear(encoded);
  if (await showOperationResult(result, scope))
    message('Operation retained. Progress and the original result appear below.');
  return result;
}
async function openLog(value) {
  const generation = ++logRequestGeneration, requestedToken = token, workspaceId = state?.workspaceId;
  const result = await api(query('/api/log', value));
  if (generation !== logRequestGeneration || requestedToken !== token || state?.workspaceId !== workspaceId) return;
  logSelection = value; $('log-panel').hidden = false;
  $('log-title').textContent = result.name;
  $('log-detail').textContent = result.available === false
    ? result.state === 'NOT_CREATED' ? 'This operation has not created its worker log yet.' : 'The retained worker log is currently unavailable.'
    : result.offset ? 'Showing the final ' + (result.totalBytes - result.offset) + ' of ' + result.totalBytes + ' bytes.' : result.totalBytes + ' retained bytes.';
  $('log-text').textContent = result.available === false
    ? result.error.code + ': ' + result.error.message : result.text || '(The selected log is empty.)';
  switchView('operations'); prefs();
}
const images = initImageWorkspace({ root: $('image-workspace'), api, operation, refresh, openLog, message, error,
  switchView, getState: () => state, getToken: () => token, getView: () => view });
$('refresh').addEventListener('click', () => refresh());
$('attach-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    message(''); const input = { directory: $('attach-directory').value.trim() };
    if ($('attach-label').value.trim()) input.label = $('attach-label').value.trim();
    const value = await api('/api/attach', input); selectedId = value.runtimeId;
    $('attach-details').open = false; await refresh(); message('Existing runtime opened at its original directory.');
  } catch (value) { error(value); }
});
$('archive-select').addEventListener('change', () => { archiveSelectionGeneration++; loadCatalog().catch(error); });
for (const id of ['native', 'operator', 'pins']) $(id).addEventListener('input', invalidateReview);
$('review-profile').addEventListener('click', () => reviewProfile().catch(error));
$('prepare').addEventListener('click', () => operation({ operation: 'prepare', ...profileReview, name: $('new-name').value.trim() }).catch(error));
$('upgrade').addEventListener('click', () => operation({ operation: 'upgrade', runtimeId: selectedId, ...profileReview,
  name: $('new-name').value.trim(), install: $('upgrade-install').checked, ...cacheOptions() }).catch(error));
$('inspect').addEventListener('click', () => operation({ operation: 'inspect', runtimeId: selectedId, load: $('inspect-load').checked, source: $('inspect-source').checked }).catch(error));
$('install').addEventListener('click', () => operation({ operation: 'install', runtimeId: selectedId, ...cacheOptions() }).catch(error));
$('recover-form').addEventListener('submit', event => { event.preventDefault(); operation({ operation: 'recover', runtimeId: selectedId,
  name: $('recover-name').value.trim(), install: $('recover-install').checked, ...cacheOptions() }).catch(error); });
$('compare-after').addEventListener('change', updateControls);
$('compare').addEventListener('click', async () => {
  try {
    const value = await api('/api/compare', { before: selectedId, after: $('compare-after').value });
    const result = $('comparison'); result.hidden = false;
    result.replaceChildren(make('p', (value.sourceChanged ? 'Source changed' : 'Same original source') + ' · ' + (value.profileChanged ? 'Profile changed' : 'Same exact profile')));
    result.append(value.dependencies.length ? table(['Dependency', 'Selected', 'Compared'], value.dependencies.map(item => [item.name, item.before, item.after])) : make('p', 'All selected dependency versions match.', 'note'));
  } catch (value) { error(value); }
});
$('install-log').addEventListener('click', () => openLog({ runtimeId: selectedId }).catch(error));
$('refresh-log').addEventListener('click', () => logSelection && openLog(logSelection).catch(error));
$('retry-request').addEventListener('click', async () => {
  let scope;
  try {
    scope = operationScope();
    const encoded = sessionStorage.getItem(scope.storageKey), pending = JSON.parse(encoded);
    if (!pending) return;
    const result = await api('/api/operation', pending);
    scope.clear(encoded);
    await showOperationResult(result, scope);
  } catch (value) { if (scope && !scope.current()) value.workspaceChanged = true; error(value); }
});
$('archive-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    message('Receiving the original archive.');
    const file = $('archive-file').files[0], path = $('archive-path').value.trim(), sha256 = $('archive-sha').value.trim();
    if ((!file && !path) || file && path) throw new Error('Choose an archive file or an existing operator path.');
    const label = $('archive-label').value.trim() || file?.name || path.split('/').at(-1);
    if (file) {
      if (file.size > 64 * 1024 * 1024) throw new Error('Archive exceeds 64 MiB.');
      const response = await fetch(query('/api/archive-upload', { requestId: crypto.randomUUID(), sha256, label }),
        { method: 'POST', headers: { 'x-runtime-workspace-token': token, 'content-type': 'application/octet-stream' }, body: file });
      const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.message ?? value.error), failureFields(value));
      switchView('operations'); await refresh(); message('Original archive received. Its source catalog is being prepared.');
    } else await operation({ operation: 'import', archive: path, sha256, label });
  } catch (value) { error(value); }
  finally { button.disabled = false; }
});
$('create-handoff').addEventListener('click', async () => {
  try {
    handoff = await api(query('/api/handoff', { runtimeId: selectedId }));
    $('handoff').hidden = false;
    facts($('handoff-facts'), [['Runtime directory', handoff.directory], ['Source root', handoff.sourceRoot],
      ['Dependency root', handoff.dependencyRoot], ['Original source commit', handoff.sourceCommit],
      ['Source manifest SHA-256', handoff.sourceManifestSha256], ['Profile identity', handoff.profileId], ['Dependency lock SHA-256', handoff.lockSha256]]);
    $('managed-command').textContent = 'starforge ' + handoff.managedRelease.commandArguments
      .map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ') + ' --home /absolute/private/merchant-home';
    $('handoff-json').textContent = JSON.stringify(handoff, null, 2);
  } catch (value) { error(value); }
});
$('download-handoff').addEventListener('click', () => {
  if (!handoff) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(handoff, null, 2) + '\n'], { type: 'application/json' }));
  const link = make('a'); link.href = url; link.download = 'starforge-runtime-handoff.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('copy-handoff').addEventListener('click', () => handoff && navigator.clipboard.writeText(JSON.stringify(handoff, null, 2)).then(() => message('Deployment handoff copied.')).catch(error));
const sourceBuilds = createSourceBuildWorkspaceView({ root: $('source-build-workspace'), api, getState: () => state,
  operation, refreshWorkspace: refresh, openLog, switchView, chooseRuntime, message, error,
  chooseArchive: async id => {
    const requestedToken = token, workspaceId = state?.workspaceId, generation = ++archiveSelectionGeneration;
    const currentSelection = () => token === requestedToken && state?.workspaceId === workspaceId &&
      archiveSelectionGeneration === generation;
    const current = await api(query('/api/catalog', { archiveId: id }));
    if (!currentSelection()) return;
    setOptions($('archive-select'), [...state.archives.filter(item => item.id !== id), current.archive]
      .map(item => ({ id: item.id, label: item.label + ' · ' + item.packageVersion })), 'Choose a source archive', id);
    $('archive-select').value = id;
    await loadCatalog();
    if (!currentSelection() || $('archive-select').value !== id) return;
    switchView('profile');
  },
});
const transfers = createRuntimeTransferView({ root: $('transfer-workspace'), api, getState: () => state,
  getToken: () => token, getView: () => view, operation, refreshWorkspace: refresh, openLog, switchView, message, error });
const workspaceReceiving = createWorkspaceReceivingView({ root: $('workspace-receiving'), api,
  getState: () => state, getToken: () => token, getView: () => view, message, error });
const operatingProcedures = createOperatingProceduresView({ root: $('operating-procedures-workspace'), api,
  getState: () => state, getToken: () => token, getView: () => view, message, error,
  openLog, chooseRuntime, switchView, openApplication: id => applications.choose(id) });
const managed = createManagedWorkspaceView({ api, getState: () => state, operation, refreshWorkspace: refresh,
  refreshOperation, openLog, switchView, message, error });
const applications = createApplicationsWorkspaceView({ root: $('applications-workspace'), api, getState: () => state, getToken: () => token,
  refreshWorkspace: refresh, switchView, message, error });
const python = createPythonWorkspaceView({ api, getState: () => state, operation, refreshWorkspace: refresh,
  openLog, switchView, message, error,
  openApplication: descriptor => applications.beginPython(descriptor),
  upload: async (file, sha256) => {
    const response = await fetch('/api/python/upload?' + new URLSearchParams({ sha256 }), {
      method: 'POST', headers: { 'x-runtime-workspace-token': token, 'content-type': 'application/octet-stream' }, body: file,
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message ?? value.error), failureFields(value, response.status));
    return value;
  },
});
window.addEventListener('hashchange', () => {
  if (!location.hash) return;
  token = location.hash.slice(1); sessionStorage.setItem(tokenKey, token);
  history.replaceState(null, '', location.pathname);
  images.reset();
  managed.reset();
  applications.reset();
  transfers.reset();
  workspaceReceiving.reset();
  operatingProcedures.reset();
  python.reset();
  sourceBuilds.reset();
  archiveSelectionGeneration++; logRequestGeneration++;
  initial = true; state = undefined; selectedId = null; selectedArchive = null;
  profileReview = null; handoff = null; logSelection = null; view = 'runtime';
  $('handoff').hidden = true; $('comparison').hidden = true; $('profile-review').hidden = true;
  $('log-panel').hidden = true; message(''); updateControls();
  refresh().catch(error);
});
await refresh();
setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 2500);
