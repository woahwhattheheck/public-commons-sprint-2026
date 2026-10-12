// SPDX-License-Identifier: MIT
const $ = id => document.getElementById(id);
const state = { console: null, selected: null, requestId: null, received: null, receiverId: null,
  gis: null, project: null, sourceLayers: [], page: 0, filePage: 0, job: null,
  pendingJob: null, completedJobs: new Set(), refreshTimer: null, selectedVersion: 0,
  export: null, upload: null, stopped: false };
const initial = location.hash.slice(1);
if (/^[A-Za-z0-9_-]{43}$/.test(initial)) {
  sessionStorage.setItem('qwc-console-token', initial);
  history.replaceState(null, '', location.pathname + location.search);
}
const token = sessionStorage.getItem('qwc-console-token') ?? '';
const running = job => job && ['STARTING', 'RUNNING'].includes(job.phase);
const json = value => JSON.stringify(value, null, 2);
const bytes = value => Number(value).toLocaleString() + ' bytes';
const compact = value => typeof value === 'string' ? value : value == null ? '—' : String(value);
const id = prefix => prefix + '-' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
const messages = {
  prepare: 'Receive source and prepare native map', publish: 'Generate and publish original edition',
  rollback: 'Restore original deployment', verify: 'Verify retained publication',
  export: 'Export complete original handover', receive: 'Receive complete original archive',
  reopen: 'Reopen relocated native QGIS project', 'verify-received': 'Verify received original files',
};

function notice(message = '', error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(error);
}

function element(tag, text = null, className = null) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = compact(text);
  if (className) node.className = className;
  return node;
}

function replace(id, ...nodes) {
  $(id).replaceChildren(...nodes.flat().filter(Boolean));
}

function kv(rows) {
  const dl = element('dl', null, 'key-values');
  for (const [label, value] of rows) {
    dl.append(element('dt', label), value instanceof Node ? (() => {
      const dd = element('dd'); dd.append(value); return dd;
    })() : element('dd', compact(value)));
  }
  return dl;
}

function table(headings, rows) {
  const wrapper = element('div', null, 'table-wrap'), table = element('table');
  const head = element('thead'), tr = element('tr');
  headings.forEach(name => tr.append(element('th', name))); head.append(tr); table.append(head);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    row.forEach(value => {
      const td = element('td');
      if (value instanceof Node) td.append(value); else td.textContent = compact(value);
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body); wrapper.append(table); return wrapper;
}

function button(label, callback, className = null) {
  const item = element('button', label, className); item.type = 'button';
  item.addEventListener('click', () => run(callback)); return item;
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, {
    method, redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok || value.error) {
    const detail = value.error;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message ?? 'The original operation could not complete.');
    error.code = detail?.code; error.details = detail?.details; throw error;
  }
  return value;
}

async function run(callback) {
  try { return await callback(); }
  catch (error) { notice((error.code ? error.code + ': ' : '') + error.message, true); }
}

function panel(name) {
  for (const id of ['empty', 'new', 'edition', 'receive', 'received', 'host']) $(id + '-panel').hidden = id !== name;
  for (const [id, target] of [['show-new', 'new'], ['show-receive', 'receive'], ['show-host', 'host']]) {
    $(id).setAttribute('aria-current', String(name === target));
  }
}

function layerTable(layers) {
  return table(['Layer', 'Native WMS name', 'Source', 'Kind / CRS', 'Visible'], layers.map(row => [
    row.title ?? row.name ?? row.layerId ?? row.id, element('span', row.wmsName ?? '—', 'mono'),
    element('span', row.sourceId, 'mono'), (row.kind ?? '') + (row.crs ? ' · ' + row.crs : ''),
    row.visible === false ? 'No' : 'Yes',
  ]));
}

function roleTable(roles) {
  return roles.length ? table(['View', 'Existing role', 'Headers environment', 'Expected native layers'],
    roles.map(row => [row.id, row.role ?? 'Existing anonymous view', row.headersEnvironment ?? 'None',
      row.expectedLayerNames.join(', ') || 'No visible layers'])) : element('p', 'No role views were added to this publication request.', 'muted');
}

function renderNavigation() {
  const current = state.console;
  const publisher = current.mode === 'publisher';
  for (const name of ['show-editions', 'show-new', 'show-receive', 'show-host', 'edition-nav']) $(name).hidden = !publisher;
  if (publisher) {
    const ws = current.workspace;
    $('workspace-title').textContent = ws.host.id + ' · tenant ' + ws.host.tenant + ' · ' + current.directory;
    const items = ws.operations.map(row => {
      const item = button('', () => selectEdition(row.requestId), 'nav-item');
      item.append(element('strong', row.title ?? row.requestId), element('span', row.operation.phase + ' · revision ' + (row.sourceRevision ?? '—')),
        element('span', row.requestId, 'mono'));
      item.setAttribute('aria-current', String(state.requestId === row.requestId)); return item;
    });
    replace('edition-list', items.length ? items : element('p', 'No editions prepared yet.', 'muted'));
    $('previous-page').disabled = state.page === 0;
    $('next-page').disabled = ws.nextOffset == null;
    replace('receiving-list', current.receivings.map(row => button(row.id + (row.complete ? '' : ' · receiving'),
      () => row.complete ? selectReceived(row.id) : continueReceiving(row.id), 'nav-item')));
  } else {
    $('workspace-title').textContent = 'Received publication · ' + current.directory;
    replace('receiving-list', button('Open original received edition', () => selectReceived('original'), 'nav-item'));
  }
}

function renderJob() {
  const job = state.job;
  $('job-panel').hidden = !job;
  if (!job) return;
  $('job-title').textContent = (messages[job.action] ?? job.action) + ' · ' + job.phase;
  const progress = job.progress;
  $('job-progress').textContent = progress ? [progress.phase,
    progress.path ?? progress.family,
    progress.file && progress.files ? 'file ' + progress.file + ' / ' + progress.files : null,
    progress.bytes != null ? bytes(progress.bytes) + (progress.totalBytes != null ? ' / ' + bytes(progress.totalBytes) : '') : null,
  ].filter(Boolean).join(' · ') : job.id;
  $('job-detail').textContent = job.error?.message ?? job.message ??
    (job.cancellationRequested ? 'Cancellation requested; the original native owner is draining.' : '');
  $('cancel-job').hidden = !running(job);
  $('resume-job').hidden = !['ERROR', 'CANCELLED', 'INTERRUPTED', 'RETAINED'].includes(job.phase);
  $('stop').disabled = state.console?.stopping;
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  if (!state.stopped && !document.hidden) state.refreshTimer = setTimeout(() => run(refresh), 1800);
}

async function refresh() {
  if (state.stopped) return;
  try {
    state.console = await api('/api/state?offset=' + state.page);
    state.job = state.console.job;
    renderNavigation(); renderJob(); renderHost();
    if (!state.console.mode) throw new Error('The original console did not return its mode.');
    const job = state.job;
    if (job?.phase === 'COMPLETED' && !state.completedJobs.has(job.id)) {
      state.completedJobs.add(job.id);
      const complete = await api('/api/job?id=' + encodeURIComponent(job.id));
      await completed(complete, state.pendingJob === job.id);
      if (state.pendingJob === job.id) state.pendingJob = null;
    }
    if (state.console.mode === 'received' && state.received === null) await selectReceived('original');
    if (!$('receive-python').value && state.console.python) $('receive-python').value = state.console.python;
  } finally { scheduleRefresh(); }
}

async function action(name, input) {
  if (['verify', 'verify-received', 'reopen'].includes(name) && !input.invocationId) {
    input = { ...input, invocationId: id(name) };
  }
  const job = await api('/api/actions/' + name, input);
  state.job = job; state.pendingJob = job.id; renderJob();
  notice((messages[name] ?? name) + ' is joined to its original operation.');
  if (job.phase === 'COMPLETED') {
    await completed(job, true); state.pendingJob = null; state.completedJobs.add(job.id);
  } else await refresh();
  return job;
}

async function completed(job, requested) {
  const result = job.result;
  if (!result) return;
  if (['prepare', 'publish', 'rollback', 'verify'].includes(job.action)) {
    const requestId = job.input?.requestId ?? job.input?.request?.requestId ?? result.review?.requestId ??
      result.publication?.requestId ?? result.rollback?.requestId;
    if (requestId && (requested || state.requestId === requestId)) await selectEdition(requestId);
  }
  if (job.action === 'export') {
    if (requested || state.requestId === job.input?.requestId) {
      state.export = result; renderExport();
    }
  }
  if (job.action === 'receive' && requested) await selectReceived(job.input.receiverId);
  if (job.action === 'reopen' && (requested || state.receiverId === (job.input?.receiverId ?? 'original'))) {
    renderReopen(result);
  }
  if (job.action === 'verify-received' && requested) {
    notice('Verified all ' + result.files + ' original received files.');
  } else if (requested) notice((messages[job.action] ?? job.action) + ' completed.');
}

async function selectEdition(requestId) {
  const version = ++state.selectedVersion;
  const result = await api('/api/operation?requestId=' + encodeURIComponent(requestId));
  if (version !== state.selectedVersion) return;
  state.requestId = requestId; state.selected = result.operations[0];
  state.filePage = 0; state.export = null;
  renderEdition(); renderNavigation(); panel('edition');
}

function renderEdition() {
  const row = state.selected, review = row.review, publication = row.publication;
  const selected = publication ?? review;
  $('edition-phase').textContent = row.operation.phase;
  $('edition-title').textContent = selected?.theme?.title ?? row.requestId;
  $('edition-identity').textContent = row.requestId + (selected?.publicationId ? ' · ' + selected.publicationId : '');
  const viewer = $('viewer-link');
  viewer.hidden = !publication;
  if (publication) { viewer.href = publication.service.viewerUrl; viewer.textContent = "Open host's selected theme"; }
  replace('edition-summary', selected ? kv([
    ['Original project', selected.qgis.projectId], ['Source revision', selected.qgis.revision],
    ['Original workspace', selected.qgis.workspaceId], ['Native map service', selected.theme.mapName],
    ['QWC theme', selected.theme.id], ['Complete GIS archive', bytes(selected.qgis.package.bytes)],
    ['Archive SHA-256', element('span', selected.qgis.package.sha256, 'mono')],
  ]) : element('p', row.operation.lastError?.message ?? 'Continue the original source preparation to finish its review.'));
  replace('edition-layers', selected ? layerTable(selected.theme.layers) : []);
  replace('edition-layouts', selected?.theme.layouts?.length
    ? table(['Native layout', 'Map items'], selected.theme.layouts.map(layout => [layout.name, layout.maps.map(map => map.id).join(', ')]))
    : element('p', 'The selected saved map has no print layouts.', 'muted'));
  replace('edition-roles', selected ? roleTable(selected.roleViews ?? []) : []);
  $('review-section').hidden = !review;
  replace('publication-sequence', (review?.sequence ?? []).map(step => element('li', step)));
  replace('host-change-summary', review ? kv([
    ['Host / tenant', review.host.id + ' / ' + review.host.tenant],
    ['Existing permission default', String(review.host.permissionsDefaultAllow)],
    ['Previous native project', review.host.previousProject ?? 'No prior managed release'],
    ['Selected native project', review.host.nextProject],
    ['Retained input files', review.host.beforeFiles.input.length],
    ['Retained viewer files', review.host.beforeFiles.viewer.length],
    ['Retained generated files', review.host.beforeFiles.generated.length],
    ['Native reload', review.host.reloadCommand?.join(' ') ?? 'Selected host reads the published files directly'],
  ]) : []);
  $('review-sha').textContent = review ? 'Exact review SHA-256: ' + row.reviewSha256 : '';
  $('publish-edition').hidden = !review || ['PUBLISHED', 'ROLLED_BACK'].includes(row.operation.phase);
  $('rollback-edition').hidden = !publication || row.operation.phase === 'ROLLED_BACK';
  $('verify-edition').hidden = !publication;
  $('download-review').hidden = !review;
  $('download-publication').hidden = !publication;
  $('deployment-section').hidden = !row.deployment;
  replace('deployment-summary', row.deployment ? kv([
    ['Completed action', row.deployment.phase], ['Completed at', row.deployment.completedAt],
    ['Prior project', row.deployment.previousProject ?? 'None'],
    ['Selected project', row.deployment.currentProject ?? 'None'],
    ['Original native reload', row.deployment.reload?.exitCode != null ? 'Exit ' + row.deployment.reload.exitCode : 'No reload command selected'],
  ]) : []);
  replace('deployment-files', row.deployment ? table(['Host tree', 'File', 'Before', 'After'],
    row.deployment.files.map(file => [file.family, element('span', file.path, 'file-path'),
      file.before ? bytes(file.before.bytes) : 'Absent', file.after ? bytes(file.after.bytes) : 'Absent'])) : []);
  $('export-section').hidden = !publication;
  $('export-id').value = row.requestId.slice(0, 100) + '-handover';
  $('file-details').hidden = !publication;
  $('edition-json').textContent = json({ operation: row.operation,
    review: review ? { ...review, projectFiles: '[' + review.projectFiles.length + ' original members]',
      nativeSourceBindings: Object.fromEntries(Object.entries(review.nativeSourceBindings).map(([k, v]) => [k, v.length + ' source files'])) } : null,
    deployment: row.deployment, rollback: row.rollback });
  renderFiles(); renderExport();
}

function renderFiles() {
  const publication = state.selected?.publication;
  if (!publication) return;
  const rows = publication.files.slice(state.filePage, state.filePage + 50);
  replace('publication-files', table(['Original file', 'Bytes', 'SHA-256', 'Download'], rows.map(row => [
    element('span', row.path, 'file-path'), row.bytes.toLocaleString(),
    element('span', row.sha256, 'mono'),
    button('Save', () => download({ kind: 'publication-file', requestId: state.requestId, path: row.path })),
  ])));
  $('files-previous').disabled = state.filePage === 0;
  $('files-next').disabled = state.filePage + 50 >= publication.files.length;
}

function renderExport() {
  const result = state.export;
  $('download-export').hidden = !result;
  replace('export-result', result ? kv([
    ['Original export', result.exportId], ['Complete archive', bytes(result.bytes)],
    ['Archive SHA-256', element('span', result.sha256, 'mono')],
    ['Original members', result.files], ['Decoded source', bytes(result.totalDecodedBytes)],
    ['Completed', result.completedAt],
  ]) : element('p', 'An existing export identity reopens its original archive. Use a new identity to capture later deployment history.', 'muted'));
}

async function download(input) {
  const ticket = await api('/api/download', input);
  const anchor = element('a');
  anchor.href = ticket.url; anchor.download = ticket.filename; anchor.rel = 'noreferrer';
  document.body.append(anchor); anchor.click(); anchor.remove();
  notice('Downloading ' + ticket.filename + ' · ' + bytes(ticket.bytes) + '\nSHA-256 ' + ticket.sha256);
}

function renderHost() {
  if (state.console.mode !== 'publisher') return;
  const p = state.console.profile;
  replace('host-profile', kv([
    ['Host / tenant', p.id + ' / ' + p.tenant], ['Selected QWC version', p.qwcVersion],
    ['Theme ID / native namespace', p.themeId + ' / ' + p.mapPrefix],
    ['Native input', p.inputRoot], ['Existing viewer', p.viewerRoot],
    ['Native GIS resources', p.qgisResourcesRoot], ['Generated tenant configuration', p.generatedConfigRoot + '/' + p.tenant],
    ['Existing tenant configuration', p.tenantConfig], ['Selected theme file', p.themeInput + ' · ' + p.themePointer],
    ['Existing permission default', String(p.permissionsDefaultAllow)],
    ['Original QGIS Python', p.qgisPython], ['Original generator Python', p.generatorPython],
    ['Original ConfigGenerator source', p.generatorSource],
  ]));
  $('host-json').textContent = json(p);
}

async function readGis() {
  const source = await api('/api/gis?directory=' + encodeURIComponent($('gis-directory').value.trim()));
  state.gis = source;
  replace('project-id', source.projects.map(project => {
    const option = element('option', project.id + ' · ' + (project.at ?? '') + ' · ' + project.layers.length + ' layers');
    option.value = project.id; return option;
  }));
  $('edition-form').hidden = !source.projects.length;
  replace('gis-summary', kv([['Original source', source.title], ['Workspace', source.workspaceId],
    ['Retained revision', source.revision], ['Saved maps', source.projects.length]]));
  if (!source.projects.length) {
    notice('Save a native map in the original QGIS workspace before preparing its publication.'); return;
  }
  if (!$('theme-title').value) $('theme-title').value = source.title;
  await selectProject();
}

async function selectProject() {
  const project = state.gis.projects.find(row => row.id === $('project-id').value);
  if (!project) return;
  state.project = project;
  state.sourceLayers = await Promise.all(project.layers.map(async row => {
    const sha = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.id));
    const short = [...new Uint8Array(sha)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
    return { ...row, layerId: row.id, title: row.name ?? row.title ?? row.id, wmsName: 'sf_' + short };
  }));
  replace('source-layers', layerTable(state.sourceLayers));
}

function addRole() {
  const row = element('div', null, 'role-row');
  const grid = element('div', null, 'form-grid');
  for (const [key, label, placeholder] of [
    ['id', 'View ID', 'customer-editor'], ['role', 'Existing ConfigDB role', 'editor'],
    ['headersEnvironment', 'Private headers environment name', 'CUSTOMER_EDITOR_HEADERS'],
    ['expectedLayerNames', 'Expected native layer names', 'sf_… , sf_…'],
  ]) {
    const lab = element('label', label), input = element('input'); input.dataset.field = key;
    input.placeholder = placeholder; input.spellcheck = false;
    if (key === 'id') { input.required = true; input.pattern = '[A-Za-z0-9][A-Za-z0-9._-]{0,119}'; }
    if (key === 'headersEnvironment') input.pattern = '[A-Za-z_][A-Za-z0-9_]*';
    lab.append(input); grid.append(lab);
  }
  const controls = element('div', null, 'actions');
  controls.append(button('Use selected layer names', () => {
    row.querySelector('[data-field="expectedLayerNames"]').value = state.sourceLayers.map(x => x.wmsName).join(', ');
  }), button('Remove view', () => row.remove()));
  row.append(grid, controls); $('role-rows').append(row);
}

function requestFromForm() {
  const theme = JSON.parse($('theme-options').value);
  if (!theme || Array.isArray(theme) || typeof theme !== 'object') throw new Error('Native theme options must be a JSON object.');
  const roles = [...$('role-rows').children].map(row => {
    const get = field => row.querySelector('[data-field="' + field + '"]').value.trim();
    return { id: get('id'), ...(get('role') ? { role: get('role') } : {}),
      ...(get('headersEnvironment') ? { headersEnvironment: get('headersEnvironment') } : {}),
      expectedLayerNames: get('expectedLayerNames').split(/[\s,]+/).filter(Boolean) };
  });
  const printMode = $('print-mode').value;
  const print = printMode === 'none' ? undefined : {
    mode: printMode, name: $('print-name').value.trim(),
    ...(printMode === 'map-page' ? { paper: $('print-paper').value, orientation: $('print-orientation').value } : {}),
  };
  return { schema: 'starforge.stac-qwc-request.v1',
    operationId: $('operation-id').value.trim(), requestId: $('request-id').value.trim(),
    actor: $('actor').value.trim(),
    qgis: { directory: state.gis.directory, revision: state.gis.revision, projectId: state.project.id },
    theme: { ...theme, title: $('theme-title').value.trim() }, ...(print ? { print } : {}), roleViews: roles };
}

async function upload(file, sha) {
  $('upload-progress').hidden = false; $('upload-progress').value = 0;
  $('upload-status').textContent = 'Sending the original archive…';
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); state.upload = xhr;
    xhr.open('POST', '/api/upload'); xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('X-QWC-SHA256', sha);
    xhr.setRequestHeader('Content-Type', 'application/zip');
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) $('upload-progress').value = event.loaded / event.total;
      $('upload-status').textContent = bytes(event.loaded) + (event.lengthComputable ? ' / ' + bytes(event.total) : '');
    };
    xhr.onerror = () => reject(new Error('The upload connection closed. Send the same original archive to continue.'));
    xhr.onabort = () => reject(new Error('The original archive upload was cancelled.'));
    xhr.onload = () => {
      state.upload = null;
      let result;
      try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('The original receiver returned an unreadable response.')); return; }
      if (xhr.status < 200 || xhr.status >= 300 || result.error) reject(new Error(result.error?.message ?? 'The archive could not be received.'));
      else { $('upload-status').textContent = 'Original archive received and SHA-256 verified.'; resolve(result); }
    };
    xhr.send(file);
  });
}

async function selectReceived(receiverId) {
  const version = ++state.selectedVersion;
  const selected = await api('/api/received?receiverId=' + encodeURIComponent(receiverId));
  if (version !== state.selectedVersion) return;
  state.received = selected; state.receiverId = receiverId;
  $('received-title').textContent = selected.publication.theme.title;
  replace('received-summary', kv([
    ['Original customer operation', selected.receipt.operationId],
    ['Publication identity', element('span', selected.receipt.publicationId, 'mono')],
    ['Original archive SHA-256', element('span', selected.receipt.archiveSha256, 'mono')],
    ['Original members', selected.files], ['Receiving directory', selected.directory],
    ['Native project', selected.publication.qgis.projectId],
    ['Source revision', selected.publication.qgis.revision], ['Received at', selected.receipt.receivedAt],
  ]));
  replace('received-layers', layerTable(selected.publication.theme.layers));
  $('reopen-python').value = $('receive-python').value || state.console.python || '';
  $('received-json').textContent = json(selected.receipt);
  replace('reopen-result');
  panel('received');
}

function renderReopen(result) {
  replace('reopen-result', kv(Object.entries(result).filter(([key]) =>
    ['schema', 'invocationId', 'publicationId', 'publicationSha256', 'reopenedAt', 'projectId', 'revision'].includes(key)).map(([key, value]) =>
    [key, element('span', compact(value), key.endsWith('Sha256') || key === 'publicationId' ? 'mono' : null)])),
    (() => { const detail = element('details'), summary = element('summary', 'Actual native QGIS reopening'); detail.append(summary, element('pre', json(result))); return detail; })());
}

async function continueReceiving(receiverId) {
  const job = state.job ? await api('/api/job?id=' + encodeURIComponent(state.job.id)) : null;
  if (job?.action === 'receive' && job.input?.receiverId === receiverId) {
    await action(job.action, job.input); return;
  }
  $('receiver-id').value = receiverId; panel('receive');
  notice('Select the same original archive and SHA-256 to continue this receiving directory.');
}

$('source-form').addEventListener('submit', event => { event.preventDefault(); run(readGis); });
$('edition-form').addEventListener('submit', event => { event.preventDefault(); run(() => action('prepare', { request: requestFromForm() })); });
$('export-form').addEventListener('submit', event => { event.preventDefault(); run(() =>
  action('export', { requestId: state.requestId, exportId: $('export-id').value.trim() })); });
$('receive-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const file = $('receive-file').files[0], sha = $('receive-sha').value.trim();
    if (!file || !/^[a-f0-9]{64}$/.test(sha)) throw new Error('Select the complete original archive and export SHA-256.');
    if (file.size > state.console.limits.archiveBytes) throw new Error('The archive exceeds this operator’s declared receiving capacity.');
    const received = await upload(file, sha);
    await action('receive', { archiveSha256: received.archiveSha256, receiverId: $('receiver-id').value.trim() });
  });
});
$('project-id').addEventListener('change', () => run(selectProject));
$('add-role').addEventListener('click', addRole);
$('show-new').addEventListener('click', () => panel('new'));
$('show-receive').addEventListener('click', () => panel('receive'));
$('show-host').addEventListener('click', () => panel('host'));
$('show-editions').addEventListener('click', () => panel(state.selected ? 'edition' : 'empty'));
$('refresh').addEventListener('click', () => run(async () => {
  await refresh(); if (state.requestId && !$('edition-panel').hidden) await selectEdition(state.requestId);
}));
$('previous-page').addEventListener('click', () => run(async () => { state.page = Math.max(0, state.page - 50); await refresh(); }));
$('next-page').addEventListener('click', () => run(async () => { state.page = state.console.workspace.nextOffset ?? state.page; await refresh(); }));
$('files-previous').addEventListener('click', () => { state.filePage = Math.max(0, state.filePage - 50); renderFiles(); });
$('files-next').addEventListener('click', () => { state.filePage += 50; renderFiles(); });
$('publish-edition').addEventListener('click', () => run(() => action('publish', {
  requestId: state.requestId, reviewSha256: state.selected.reviewSha256,
})));
$('rollback-edition').addEventListener('click', () => run(() => action('rollback', {
  requestId: state.requestId, publicationSha256: state.selected.publicationSha256,
})));
$('verify-edition').addEventListener('click', () => run(() => action('verify', { requestId: state.requestId })));
$('download-review').addEventListener('click', () => run(() => download({ kind: 'publication-file', requestId: state.requestId, path: 'review.json' })));
$('download-publication').addEventListener('click', () => run(() => download({ kind: 'publication-file', requestId: state.requestId, path: 'publication.json' })));
$('download-export').addEventListener('click', () => run(() => download({ kind: 'export', exportId: state.export.exportId })));
$('download-received-publication').addEventListener('click', () => run(() => download({ kind: 'received-file', receiverId: state.receiverId, path: 'publication.json' })));
$('reopen-received').addEventListener('click', () => run(() => action('reopen', { receiverId: state.receiverId, qgisPython: $('reopen-python').value.trim() })));
$('verify-received').addEventListener('click', () => run(() => action('verify-received', { receiverId: state.receiverId })));
$('cancel-job').addEventListener('click', () => run(async () => { state.job = (await api('/api/cancel', {})).job; renderJob(); }));
$('resume-job').addEventListener('click', () => run(async () => {
  const job = await api('/api/job?id=' + encodeURIComponent(state.job.id));
  await action(job.action, job.input);
}));
$('stop').addEventListener('click', () => run(async () => {
  if (state.upload) state.upload.abort();
  await api('/api/stop', {}); state.stopped = true; clearTimeout(state.refreshTimer);
  $('stop').disabled = true; notice('The original console is stopping after its native operation drains.');
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(state.refreshTimer); else run(refresh); });
window.addEventListener('pageshow', () => { if (!state.stopped) run(refresh); });
window.addEventListener('pagehide', () => clearTimeout(state.refreshTimer));
$('operation-id').value = id('qwc-customer');
$('request-id').value = id('edition');
$('receiver-id').value = id('receiving');
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notice('Open the original private console link printed by this running operator.', true);
else run(refresh);
