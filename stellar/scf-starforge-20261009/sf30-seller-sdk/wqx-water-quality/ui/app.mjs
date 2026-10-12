import { mountOpenWaters } from '/openwaters.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, attrs = {}) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  return element;
};
const list = value => String(value ?? '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const names = value => String(value ?? '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const display = value => value === null || value === undefined ? '—' : value === '' ? '(empty)' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const number = value => value?.display ?? value?.decimal ?? (value === null || value === undefined ? '—' : String(value));
const rawResultCache = new Map();
const PAGE = 40, customerEditions = new Map(), shownFailures = new Set();
let state = null, editingRevision = 0, selectedCapture = null, selectedSource = null, selectedReview = null;
let analysisResult = null, analysisComparisonId = null, projectDirty = false, analysisDirty = false, rowPage = 0, pollTimer = null;
let customerEditionKey = null, customerEdition = null, customerPrepared = null, customerDelivery = null;
function notice(message, error = false) { $('notice').hidden = !message; $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function action(fn) { return async event => { event?.preventDefault(); try { await fn(event); } catch (error) { notice(error.message, true); } }; }
async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-token': state?.token ?? '' }, body: JSON.stringify(payload) });
  const value = await response.json();
  if (!response.ok || value.error) throw new Error(value.error?.message ?? 'The workspace request could not complete.');
  return value;
}
function option(select, value, label) { select.append(make('option', label, { value })); }
function tab(name) {
  const openWaters = mountOpenWaters({ api, notice, refresh });

document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-current', button.dataset.tab === name ? 'page' : 'false'));
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== 'tab-' + name; });
}
function jsonView(id, value) { $(id).textContent = JSON.stringify(value, null, 2); $(id).hidden = false; }
function recordList(id, rows, build, empty) {
  const target = $(id); target.replaceChildren();
  if (!rows.length) { target.append(make('p', empty, { class: 'empty' })); return; }
  for (const row of rows) target.append(build(row));
}
function fromSourceDate(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value ?? '');
  return match ? match[3] + '-' + match[1] + '-' + match[2] : value ?? '';
}
function toSourceDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? match[2] + '-' + match[3] + '-' + match[1] : value;
}
const PROFILES = [['Station', 'profile-station'], ['Activity', 'profile-activity'], ['Result', 'profile-result'], ['ResultDetectionQuantitationLimit', 'profile-limits']];
function applyProjectForm(project) {
  projectDirty = false; editingRevision = project?.revision ?? 0; $('capture').disabled = !project;
  $('project-heading').textContent = project ? project.title + ' · revision ' + project.revision : 'Retain original WQX source, review comparable results, and deliver a complete edition.';
  if (!project) return;
  const selection = project.selection, filters = { ...selection.filters };
  $('title').value = project.title; $('locations').value = (filters.siteid ?? []).join('\n');
  $('source-characteristics').value = (filters.characteristicName ?? []).join('\n');
  $('start').value = fromSourceDate(filters.startDateLo); $('end').value = fromSourceDate(filters.startDateHi);
  for (const key of ['siteid', 'characteristicName', 'startDateLo', 'startDateHi']) delete filters[key];
  $('source-filters').value = JSON.stringify(filters, null, 2);
  $('partition').value = selection.partition ?? 'none';
  for (const [profile, id] of PROFILES) $(id).checked = (selection.profiles ?? ['Station', 'Activity', 'Result']).includes(profile);
  $('exact-selection').open = Object.keys(filters).length > 0 || selection.partition !== 'none' || $('profile-limits').checked;
  $('revision').textContent = 'Saved revision ' + project.revision;
}
function sourceSelection() {
  let filters;
  try { filters = JSON.parse($('source-filters').value || '{}'); } catch { throw new Error('Use a JSON object for additional native source filters.'); }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Use a JSON object for additional native source filters.');
  for (const key of ['siteid', 'characteristicName', 'startDateLo', 'startDateHi']) if (Object.hasOwn(filters, key))
    throw new Error('Set ' + key + ' in the monitoring-location, characteristic, or date controls above.');
  const locations = list($('locations').value), characteristics = names($('source-characteristics').value);
  if (locations.length) filters.siteid = locations;
  if (characteristics.length) filters.characteristicName = characteristics;
  if ($('start').value) filters.startDateLo = toSourceDate($('start').value);
  if ($('end').value) filters.startDateHi = toSourceDate($('end').value);
  if ($('start').value && $('end').value && $('start').value > $('end').value) throw new Error('The final sample date must follow the first date.');
  return { filters, profiles: PROFILES.filter(([, id]) => $(id).checked).map(([profile]) => profile), partition: $('partition').value };
}
function renderCaptures() {
  const captures = state.captures ?? []; $('capture-count').textContent = captures.length;
  recordList('captures', captures, capture => {
    const box = make('div', null, { class: 'record' + (selectedCapture === capture.operationId ? ' selected' : '') });
    const head = make('div', null, { class: 'head' }); head.append(make('strong', capture.operationId), make('span', capture.status, { class: 'tag' })); box.append(head);
    const counts = capture.summary?.rowsByProfile;
    box.append(make('p', counts ? Object.entries(counts).map(([profile, count]) => profile + ' ' + count).join(' · ') : (capture.resources?.length ?? capture.pages ?? 0) + ' source resources'));
    box.append(make('small', 'Original project revision ' + capture.revision));
    const controls = make('div', null, { class: 'actions' }), open = make('button', 'Open', { type: 'button' });
    open.addEventListener('click', action(() => openCapture(capture.operationId))); controls.append(open);
    if (['RUNNING', 'PREPARING'].includes(capture.status)) {
      const cancel = make('button', 'Cancel', { type: 'button' });
      cancel.addEventListener('click', action(async () => { await api('/api/captures/' + capture.operationId + '/cancel', {}); notice('Cancellation requested. Received files remain with this capture.'); })); controls.append(cancel);
    } else if (capture.status !== 'COMPLETE') {
      const resume = make('button', 'Resume original capture', { type: 'button' });
      resume.addEventListener('click', action(async () => { await api('/api/captures', { operationId: capture.operationId, expectedRevision: capture.revision }); await refreshStatus(); schedulePoll(); notice('Resuming the original source capture.'); })); controls.append(resume);
    }
    box.append(controls); return box;
  }, 'Retained source captures will appear here.');
  const prior = $('compare-capture').value; $('compare-capture').replaceChildren(); option($('compare-capture'), '', 'No prior capture comparison');
  for (const capture of captures) if (capture.operationId !== selectedCapture) option($('compare-capture'), capture.operationId, capture.operationId + ' · ' + capture.status);
  if ([...$('compare-capture').options].some(x => x.value === prior)) $('compare-capture').value = prior;
}
function renderReviews() {
  recordList('reviews', state.reviews ?? [], review => {
    const box = make('div', null, { class: 'record' }); box.append(make('strong', review.reviewId), make('p', review.captureId));
    if (review.note) box.append(make('p', review.note.slice(0, 140)));
    const open = make('button', 'Open saved review', { type: 'button' });
    open.addEventListener('click', action(async () => { await showSavedReview(await api('/api/reviews/' + review.reviewId)); tab('analysis'); }));
    box.append(open); return box;
  }, 'Saved analysis and decision notes will appear here.');
  const prior = $('edition-review').value; $('edition-review').replaceChildren(); option($('edition-review'), '', 'Select a saved review');
  for (const review of state.reviews ?? []) option($('edition-review'), review.reviewId, review.reviewId);
  if ([...$('edition-review').options].some(x => x.value === prior)) $('edition-review').value = prior;
  else if (state.reviews?.length === 1) $('edition-review').value = state.reviews[0].reviewId;
}
function renderEditions() {
  recordList('editions', state.editions ?? [], edition => {
    const box = make('div', null, { class: 'record' }); box.append(make('strong', edition.workspaceEditionId), make('p', edition.editionId ?? edition.status));
    if (edition.rowCount !== undefined) box.append(make('small', edition.rowCount + ' original result records'));
    const open = make('button', 'Inspect edition', { type: 'button' });
    open.addEventListener('click', action(async () => { $('merchant-edition').value = edition.workspaceEditionId; jsonView('merchant-result', await loadCustomerEdition()); })); box.append(open); return box;
  }, 'Prepared merchant editions will appear here.');
  const previous = $('merchant-edition').value; $('merchant-edition').replaceChildren(); option($('merchant-edition'), '', 'Select an edition');
  for (const edition of state.editions ?? []) if (edition.status === 'READY') option($('merchant-edition'), edition.workspaceEditionId, edition.workspaceEditionId);
  if ([...$('merchant-edition').options].some(x => x.value === previous)) $('merchant-edition').value = previous;
  else if ($('merchant-edition').options.length === 2) $('merchant-edition').selectedIndex = 1;
  renderRuntime(); loadCustomerEdition().catch(error => notice(error.message, true));
}
function renderRuntime() {
  const runtime = state.runtime ?? {};
  $('merchant-state').textContent = runtime.running ? 'Running · ' + runtime.editionId : 'Stopped';
  $('start-merchant').disabled = Boolean(runtime.running) || !$('merchant-edition').value;
  $('stop-merchant').disabled = !runtime.running;
  $('buyer-state').textContent = state.buyerConfigured
    ? 'The connected original buyer retains its intents, signing authority, and budget. Review the prepared terms before executing.'
    : 'Prepare the original offers here. Start this workspace with an original buyer configuration to execute or reopen customer deliveries.';
  renderCustomerControls();
}
async function refresh(reset = false) {
  state = await api('/api/workspace');
  if (reset) applyProjectForm(state.project);
  renderCaptures(); renderReviews(); renderEditions();
  openWaters.update(state);
  if (state.jobs?.some(x => x.status === 'RUNNING')) schedulePoll();
}
async function refreshStatus() {
  const status = await api('/api/status'); Object.assign(state, status); renderCaptures(); renderRuntime();
  const failure = status.jobs?.find(row => row.status === 'FAILED' && !shownFailures.has(row.id));
  if (failure) { shownFailures.add(failure.id); notice(failure.error?.message ?? ('Capture ' + failure.id + ' could not complete.'), true); }
  if (status.jobs?.some(x => x.status === 'RUNNING')) schedulePoll();
}
function schedulePoll() {
  if (pollTimer) return;
  pollTimer = setTimeout(async () => { pollTimer = null; try { await refreshStatus(); } catch (error) { notice(error.message, true); } }, 1800);
}
function analysisOptions() {
  function window(prefix) {
    const start = $(prefix + '-start').value, end = $(prefix + '-end').value;
    if (start && end && start > end) throw new Error('An analysis period starts after its final date.');
    return start || end ? { start: start || null, end: end || null } : null;
  }
  return { window: window('analysis'), baselineWindow: window('baseline'), includeEstimated: $('include-estimated').checked,
    characteristics: names($('analysis-characteristics').value), siteIds: list($('analysis-locations').value), allowedQualifiers: list($('allowed-qualifiers').value) };
}
function applyAnalysisOptions(options = {}) {
  for (const [prefix, value] of [['analysis', options.window], ['baseline', options.baselineWindow]]) {
    $(prefix + '-start').value = value?.start ?? ''; $(prefix + '-end').value = value?.end ?? '';
  }
  $('include-estimated').checked = options.includeEstimated === true;
  $('analysis-characteristics').value = (options.characteristics ?? []).join('\n'); $('analysis-locations').value = (options.siteIds ?? []).join('\n');
  $('allowed-qualifiers').value = (options.allowedQualifiers ?? []).join(', '); analysisDirty = false;
}
async function openCapture(id) {
  selectedCapture = id; selectedReview = null; $('saved-review').hidden = true; $('analyze').disabled = false;
  const source = await api('/api/captures/' + id); renderSource(source); renderCaptures();
  analysisComparisonId = $('compare-capture').value || null;
  analysisResult = await api('/api/analysis', { captureId: id, options: analysisOptions(), comparisonCaptureId: analysisComparisonId });
  renderAnalysis(); tab('analysis');
}
function renderSource(capture) {
  selectedSource = capture; $('source-state').textContent = capture.status;
  $('source-details').replaceChildren(make('p', capture.operationId), make('small', capture.captureSha256), make('pre', JSON.stringify(capture.selection, null, 2)));
  $('source-profiles').replaceChildren(); const grid = make('div', null, { class: 'profile-grid' });
  for (const resource of capture.resources ?? []) {
    const box = make('div', null, { class: 'record' });
    box.append(make('strong', resource.profile), make('p', resource.status + ' · HTTP ' + (resource.responseStatus ?? 'pending')),
      make('p', (resource.rowCount ?? 0) + ' original records'), make('small', resource.receivedAt ?? ''));
    const sourceFileIndex = (capture.sourceFiles ?? []).findIndex(file => file.path === resource.bodyFile);
    if (sourceFileIndex >= 0) box.append(make('a', 'Download original response', { class: 'download', href: '/api/captures/' + capture.operationId + '/files/' + sourceFileIndex }));
    if (resource.url) box.append(make('p', null)); if (resource.url) box.lastChild.append(make('a', 'Original service request', { href: resource.url, target: '_blank', rel: 'noreferrer' }));
    const detail = make('details'); detail.append(make('summary', 'Profile and native status receipt'), make('pre', JSON.stringify({ window: resource.window, dataProfile: resource.dataProfile, issues: resource.issues, providerReceipt: resource.providerReceipt?.value ?? resource.providerReceipt?.parsed ?? null, sha256: resource.sha256 }, null, 2))); box.append(detail); grid.append(box);
  }
  $('source-profiles').append(grid);
  recordList('source-files', capture.sourceFiles ?? [], file => {
    const index = capture.sourceFiles.indexOf(file), box = make('div', null, { class: 'record file-row' }), info = make('div');
    info.append(make('strong', file.path), make('p', (file.profile ?? file.role ?? 'Retained file') + ' · ' + file.bytes + ' bytes · ' + (file.contentType ?? 'application/json')), make('small', file.sha256));
    box.append(info, make('a', 'Download', { class: 'download', href: '/api/captures/' + capture.operationId + '/files/' + index })); return box;
  }, 'Original files will appear as each source response is retained.');
}
function renderAnalysis() {
  const report = analysisResult?.analysis;
  $('analysis-empty').hidden = Boolean(report); $('analysis-body').hidden = !report; $('save-review').disabled = !report;
  $('record-detail').hidden = true; analysisDirty = false;
  if (!report) return;
  $('analysis-status').textContent = selectedCapture + ' · ' + (report.capture?.status ?? selectedSource?.status ?? 'Retained');
  $('metrics').replaceChildren();
  for (const [key, label] of [['selectedRows', 'Selected results'], ['arithmeticRows', 'Numeric use'], ['censored', 'Censored results'], ['qualified', 'Qualified results'], ['activities', 'Sample activities'], ['groups', 'Measurement groups']]) {
    const cell = make('div'); cell.append(make('span', label), make('strong', report.inventory[key])); $('metrics').append(cell);
  }
  $('source-notes').replaceChildren(...(report.sourceNotes ?? []).map(note => make('li', note)));
  $('inventory-details').textContent = JSON.stringify(report.inventory, null, 2);
  const previous = $('group').value; $('group').replaceChildren(); option($('group'), '', 'All selected results · choose a group for numeric summaries');
  for (const group of report.groups) option($('group'), group.id, group.label + ' · ' + group.counts.rows + ' rows');
  if ([...$('group').options].some(x => x.value === previous)) $('group').value = previous;
  const comparison = analysisResult.comparison; $('capture-comparison').hidden = !comparison;
  if (comparison) {
    const count = comparison.counts, detail = make('details'); detail.append(make('summary', 'Inspect capture changes'), make('pre', JSON.stringify({
      currentCaptureSha256: comparison.currentCaptureSha256, previousCaptureSha256: comparison.previousCaptureSha256,
      selectionEquivalent: comparison.selectionEquivalent, added: comparison.added?.map(x => x.resultKey), removed: comparison.removed?.map(x => x.resultKey),
      changed: comparison.changed?.map(x => ({ resultKey: x.resultKey, changedParts: x.changedParts })), ambiguous: comparison.ambiguous
    }, null, 2)));
    $('capture-comparison').replaceChildren(make('h3', 'Capture comparison'), make('p', count.added + ' added · ' + count.removed + ' absent from current capture · ' + count.changed + ' changed · ' + count.ambiguous + ' ambiguous'), detail);
  }
  rowPage = 0; renderGroup();
}
function currentGroup() { return analysisResult?.analysis.groups.find(x => x.id === $('group').value); }
function groupRows() {
  const all = analysisResult?.analysis.observations ?? [], group = currentGroup();
  if (!group) return all;
  const ids = new Set(group.observationIds); return all.filter(row => ids.has(row.id));
}
function basisTable(values) {
  const table = make('table', null, { class: 'basis' }), body = make('tbody');
  for (const [name, value] of values) { const tr = make('tr'); tr.append(make('td', name), make('td', display(value), { class: 'wrap' })); body.append(tr); }
  table.append(body); return table;
}
function renderGroup() {
  const group = currentGroup(), target = $('group-summary'); target.replaceChildren(); $('plot').hidden = !group; $('plot-note').hidden = !group;
  if (!group) target.append(make('p', 'Select one measurement group to compare results with the same sample context, method, fraction, and unit.', { class: 'caption' }));
  else {
    const table = make('table'), head = make('thead'), tr = make('tr');
    for (const title of ['Numeric basis', 'Count', 'Minimum', 'Maximum', 'Mean', 'Median']) tr.append(make('th', title));
    head.append(tr); table.append(head); const body = make('tbody');
    const baseline = analysisResult.analysis.baseline?.groups.find(x => x.key === group.key);
    for (const [title, value] of [['Selected summary', group.summary], ['Uncensored detected', group.detectedSummary], ['Reported estimates', group.reportedEstimateSummary], ['Baseline selected', baseline?.summary]]) {
      if (!value) continue; const row = make('tr'); row.append(make('td', title), make('td', value.count));
      for (const metric of [value.min, value.max, value.mean, value.median]) row.append(make('td', number(metric), { title: metric ? 'Exact ratio: ' + metric.numerator + '/' + metric.denominator : '' }));
      body.append(row);
    }
    table.append(body); const wrap = make('div', null, { class: 'table-wrap' }); wrap.append(table); target.append(wrap);
    target.append(make('p', group.counts.censored + ' censored · ' + group.counts.qualified + ' qualified · ' + group.counts.duplicates + ' duplicate · ' + group.counts.conflicts + ' conflicting rows', { class: 'caption' }));
    const change = analysisResult.analysis.comparison?.find(x => x.groupId === group.id);
    if (change?.relativeChangeReason) target.append(make('p', change.relativeChangeReason, { class: 'caption' }));
    if (change) target.append(make('p', change.comparable ? 'Selected mean change ' + number(change.change) + ' ' + display(change.changeUnit ?? group.dimensions.unit) + (change.percentChange ? ' · ' + number(change.percentChange) + '%' : '') : change.reason, { class: 'caption' }));
    const detail = make('details'); detail.append(make('summary', 'Exact group dimensions and reported limit inventory'),
      basisTable(Object.entries(group.dimensions)), make('pre', JSON.stringify({ limits: group.limits, qualifiers: group.qualifierCounts, conditions: group.conditionCounts, statuses: group.statusCounts }, null, 2))); target.append(detail);
    plot(group, groupRows());
  }
  $('record-detail').hidden = true; renderObservationPage();
}
function plot(group, rows) {
  const target = $('plot'); target.replaceChildren();
  const points = rows.filter(row => row.analysis.included && row.analysis.numeric && /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? ''))
    .map(row => ({ row, x: Date.parse(row.date + 'T00:00:00Z'), y: Number(row.value) })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) { target.append(make('p', 'This group has no included numeric results to plot.', { class: 'empty' })); return; }
  const minX = points.reduce((n, p) => Math.min(n, p.x), Infinity), maxX = points.reduce((n, p) => Math.max(n, p.x), -Infinity);
  let minY = points.reduce((n, p) => Math.min(n, p.y), Infinity), maxY = points.reduce((n, p) => Math.max(n, p.y), -Infinity);
  const padding = minY === maxY ? Math.max(1, Math.abs(minY) * 0.06) : (maxY - minY) * 0.08; minY -= padding; maxY += padding;
  const width = 780, height = 245, left = 72, right = 20, top = 20, bottom = 35;
  const sx = x => minX === maxX ? width / 2 : left + (x - minX) / (maxX - minX) * (width - left - right);
  const sy = y => height - bottom - (y - minY) / (maxY - minY) * (height - top - bottom);
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', group.label);
  function add(tag, attrs, value) { const el = document.createElementNS(ns, tag); for (const [key, content] of Object.entries(attrs)) el.setAttribute(key, String(content)); if (value !== undefined) el.textContent = String(value); svg.append(el); return el; }
  for (let i = 0; i < 5; i++) { const value = minY + (maxY - minY) * i / 4, y = sy(value);
    add('line', { x1: left, x2: width - right, y1: y, y2: y, class: 'grid' }); add('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, Number(value.toPrecision(6))); }
  for (const x of minX === maxX ? [minX] : [minX, minX + (maxX - minX) / 2, maxX]) add('text', { x: sx(x), y: height - 12, 'text-anchor': x === minX ? 'start' : x === maxX ? 'end' : 'middle' }, new Date(x).toISOString().slice(0, 10));
  for (const point of points) { const circle = add('circle', { cx: sx(point.x), cy: sy(point.y), r: 3.5, class: point.row.analysis.estimated ? 'estimated' : '' }), title = document.createElementNS(ns, 'title');
    title.textContent = point.row.date + ' ' + display(point.row.time) + ' ' + display(point.row.timeZone) + ' · ' + point.row.value + ' ' + display(point.row.unit) + ' · ' + point.row.analysis.classification; circle.append(title); }
  target.append(svg);
}
function tableRows() {
  const filter = $('row-filter').value;
  return groupRows().filter(row => filter === 'all' || (filter === 'included' && row.analysis.included) || (filter === 'excluded' && !row.analysis.included) || (filter === 'censored' && row.analysis.censoring !== 'none') || (filter === 'qualified' && row.analysis.qualified));
}
function renderObservationPage() {
  const rows = tableRows(); rowPage = Math.max(0, Math.min(rowPage, Math.max(0, Math.ceil(rows.length / PAGE) - 1))); $('observations').replaceChildren();
  for (const row of rows.slice(rowPage * PAGE, (rowPage + 1) * PAGE)) {
    const tr = make('tr'); tr.append(make('td', display(row.date)));
    const name = make('td', row.characteristic, { class: 'wrap' }); name.append(make('small', row.locationId)); tr.append(name);
    const value = make('td', display(row.value)); value.append(make('small', display(row.unit) + ' · ' + row.valueState)); tr.append(value);
    tr.append(make('td', display(row.detectionCondition), { class: 'wrap' }));
    const quality = make('td', display(row.qualifier), { class: 'wrap' }); quality.append(make('small', display(row.status))); tr.append(quality);
    tr.append(make('td', row.analysis.included ? 'Included' : row.analysis.exclusion, { class: 'wrap' }));
    const cell = make('td'), view = make('button', 'Inspect', { type: 'button', class: 'row-view', 'aria-label': 'Inspect ' + row.characteristic + ' ' + row.date });
    view.addEventListener('click', action(() => renderRecord(row))); cell.append(view); tr.append(cell); $('observations').append(tr);
  }
  $('page-label').textContent = rows.length ? (rowPage * PAGE + 1) + '–' + Math.min(rows.length, (rowPage + 1) * PAGE) + ' of ' + rows.length : '0 records';
  $('previous-page').disabled = rowPage === 0; $('next-page').disabled = (rowPage + 1) * PAGE >= rows.length;
}
function sourceLink(source) {
  const fragment = make('div'), index = selectedSource?.sourceFiles?.findIndex(file => file.path === source?.bodyFile) ?? -1;
  if (index >= 0) fragment.append(make('a', 'Original ' + (source.profile ?? 'source') + ' file', { href: '/api/captures/' + selectedCapture + '/files/' + index, class: 'download' }));
  fragment.append(make('small', 'Row ' + display(source?.index) + ' · lines ' + display(source?.lineStart) + '–' + display(source?.lineEnd)), make('small', source?.sha256 ?? ''));
  return fragment;
}
function rawRecordTable(record) {
  const wrapper = make('div'), input = make('input', null, { type: 'search', placeholder: 'Find an original field or value', 'aria-label': 'Find an original result field or value' });
  const table = make('table', null, { class: 'raw-fields' }), body = make('tbody'); table.append(body);
  function fill() { body.replaceChildren(); const query = input.value.toLowerCase();
    for (const [name, value] of Object.entries(record ?? {})) if (!query || (name + ' ' + value).toLowerCase().includes(query)) {
      const row = make('tr'); row.append(make('td', name), make('td', display(value))); body.append(row);
    }
  }
  input.addEventListener('input', fill); wrapper.append(input, table); fill(); return wrapper;
}
async function renderRecord(row) {
  const captureId = selectedCapture, captureSha256 = analysisResult.captureSha256;
  const key = JSON.stringify([captureSha256, row.id, row.source?.sha256, row.source?.index]);
  let original = rawResultCache.get(key);
  if (!original) {
    const query = new URLSearchParams({ id: row.id, sourceSha256: row.source.sha256, sourceIndex: String(row.source.index), captureSha256 });
    original = await api('/api/captures/' + captureId + '/result?' + query);
    if (rawResultCache.size >= 40) rawResultCache.delete(rawResultCache.keys().next().value);
    rawResultCache.set(key, original);
  }
  if (captureId !== selectedCapture || captureSha256 !== analysisResult.captureSha256) return;
  renderRecordBody({ ...row, ...original, analysis: row.analysis });
}
function renderRecordBody(row) {
  $('record-detail').hidden = false; $('record-heading').textContent = row.characteristic + ' · ' + display(row.date);
  const target = $('record-content'); target.replaceChildren(basisTable([
    ['Original value', display(row.value) + ' ' + display(row.unit)], ['Value state / type', row.valueState + ' / ' + display(row.valueType)],
    ['Detection condition', row.detectionCondition], ['Qualifier / status', display(row.qualifier) + ' / ' + display(row.status)],
    ['Numeric use', row.analysis.included ? 'Included' : row.analysis.exclusion], ['Classification', row.analysis.classification],
    ['Fraction / speciation', display(row.sampleFraction) + ' / ' + display(row.methodSpeciation)],
    ['Analytical method', display(row.methodContext) + ' / ' + display(row.methodIdentifier) + ' / ' + display(row.methodName)],
    ['Organization / location', display(row.organizationId) + ' / ' + display(row.locationId)], ['Sample activity', row.activityId],
    ['Original time / zone', display(row.time) + ' / ' + display(row.timeZone)], ['Result identifier', row.resultId]
  ]), sourceLink(row.source));
  const issues = [...(row.issues ?? []), ...(row.analysis.issues ?? [])];
  if (issues.length) target.append(make('h3', 'Retained result issues'), make('pre', JSON.stringify(issues, null, 2)));
  target.append(make('h3', 'Every reported detection limit'));
  if (!(row.limits ?? []).length) target.append(make('p', 'This original result has no returned detection-limit record.', { class: 'caption' }));
  for (const limit of row.limits ?? []) {
    const section = make('div', null, { class: 'record' }); section.append(basisTable([
      ['Type', limit.type], ['Original limit', display(limit.value) + ' ' + display(limit.unit)], ['Origin', limit.origin],
      ['Comment', limit.comment], ['Duplicate / conflict', Boolean(limit.duplicate) + ' / ' + Boolean(limit.conflictingDuplicate)]
    ]), sourceLink(limit.source));
    const original = make('details'); original.append(make('summary', 'Original limit record'), rawRecordTable(limit.record)); section.append(original); target.append(section);
  }
  const raw = make('details'); raw.append(make('summary', 'All original result fields'), rawRecordTable(row.record)); target.append(raw);
  for (const [name, records] of [['Joined original activity records', row.activityRecords], ['Joined original station records', row.stationRecords]]) {
    const detail = make('details'); detail.append(make('summary', name + ' · ' + (records?.length ?? 0)));
    for (const record of records ?? []) detail.append(sourceLink(record.source), rawRecordTable(record.record ?? record)); target.append(detail);
  }
  $('record-detail').scrollIntoView({ block: 'nearest' });
}
async function showSavedReview(review) {
  selectedReview = review; selectedCapture = review.captureId; analysisComparisonId = review.comparisonCaptureId;
  analysisResult = { captureSha256: review.captureSha256, analysis: review.analysis, comparison: review.comparison };
  applyAnalysisOptions(review.requestedOptions ?? review.analysis.options);
  $('note').value = review.note; $('review-id').value = ''; $('analyze').disabled = false; $('saved-review').hidden = false;
  $('saved-review-id').textContent = review.reviewId; $('saved-review-note').textContent = review.note; $('review-downloads').replaceChildren();
  for (const [format, label] of [['html', 'Report'], ['json', 'Saved review JSON'], ['csv', 'Selected results CSV'], ['geojson', 'Selected results GeoJSON'], ['bundle', 'Complete review bundle']])
    $('review-downloads').append(make('a', label, { href: '/api/reviews/' + review.reviewId + '/' + format, class: 'download' }));
  $('edition-review').value = review.reviewId; renderCaptures(); $('compare-capture').value = review.comparisonCaptureId ?? '';
  renderSource(await api('/api/captures/' + review.captureId)); renderAnalysis();
}

async function loadCustomerEdition() {
  const id = $('merchant-edition').value;
  if (customerEditionKey !== id) {
    customerEditionKey = id; customerEdition = null; customerPrepared = null; customerDelivery = null;
    $('customer-file').replaceChildren(); option($('customer-file'), '', 'Select an original file');
    $('customer-result').hidden = true; $('customer-download').hidden = true;
    renderCustomerControls();
  }
  if (!id) return null;
  const edition = customerEditions.get(id) ?? await api('/api/editions/' + id);
  customerEditions.set(id, edition);
  if ($('merchant-edition').value !== id) return null;
  customerEdition = edition;
  const previous = $('customer-file').value;
  $('customer-file').replaceChildren(); option($('customer-file'), '', 'Select an original file');
  for (const file of edition.downloads ?? []) option($('customer-file'), file.path, file.path + ' · ' + file.bytes + ' bytes · ' + file.contentType);
  if ([...$('customer-file').options].some(item => item.value === previous)) $('customer-file').value = previous;
  renderCustomerControls(); return edition;
}
function renderCustomerControls() {
  const kind = $('customer-kind').value, connected = Boolean(state?.buyerConfigured);
  $('customer-query-label').hidden = kind !== 'observations';
  $('customer-query').disabled = kind !== 'observations';
  $('customer-file-label').hidden = kind !== 'source';
  $('customer-file').disabled = kind !== 'source'; $('customer-file').required = kind === 'source';
  $('prepare-purchase').disabled = !customerEdition;
  $('execute-purchase').disabled = !connected || !customerPrepared;
  $('reopen-purchase').disabled = !connected || !customerEdition;
  const continued = customerDelivery?.kind === 'observations' && customerDelivery.editionId === customerEdition?.editionId && customerDelivery.metadata?.nextCursor != null;
  $('prepare-next-page').disabled = kind !== 'observations' || !continued || Boolean(customerPrepared?.prepared?.previous);
  $('customer-page-status').textContent = customerDelivery?.kind === 'observations'
    ? 'Received ' + (customerDelivery.rows?.length ?? 0) + ' result records from the saved edition. ' + (continued ? 'Prepare the next page to retain this query and continue from its returned cursor.' : 'This returned page has no next cursor.')
    : customerDelivery?.metadata ? 'Received ' + customerDelivery.metadata.path + ' · ' + customerDelivery.metadata.bytes + ' bytes.' : '';
}
function clearCustomerPreparation() { customerPrepared = null; renderCustomerControls(); }
function customerQuery() {
  let value;
  try { value = JSON.parse($('customer-query').value || '{}'); }
  catch { throw new Error('Use a JSON object of dataset query parameters and string values.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object of dataset query parameters and string values.');
  return value;
}
async function prepareCustomer(payload) {
  const result = await api('/api/customer/prepare', payload);
  customerPrepared = result; $('intent').value = result.intentId;
  jsonView('customer-result', result); renderCustomerControls();
  notice('Original buyer intent prepared. Review the terms shown.');
  return result;
}
function showCustomerDelivery(response) {
  const delivery = response?.result?.metadata ? response.result : response;
  customerDelivery = delivery?.metadata ? delivery : null; customerPrepared = null;
  if (delivery?.intentId) $('intent').value = delivery.intentId;
  if (['observations', 'source', 'edition'].includes(delivery?.kind)) $('customer-kind').value = delivery.kind;
  if (delivery?.kind === 'observations') $('customer-query').value = JSON.stringify(Object.fromEntries(new URL(delivery.url).searchParams), null, 2);
  if (delivery?.kind === 'source') $('customer-file').value = delivery.file;
  $('customer-download').hidden = !customerDelivery;
  if (customerDelivery) $('customer-download').href = '/api/customer/files/' + encodeURIComponent($('merchant-edition').value) + '/' + encodeURIComponent(delivery.intentId);
  jsonView('customer-result', response); renderCustomerControls();
}


document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
$('project-form').addEventListener('input', () => { projectDirty = true; $('capture').disabled = true; $('revision').textContent = 'Unsaved selection changes. Save before acquiring source.'; });
$('project-form').addEventListener('submit', action(async () => {
  const saved = await api('/api/project', { title: $('title').value, selection: sourceSelection(), expectedRevision: editingRevision });
  await refresh(true); notice('Saved original WQX selection, revision ' + saved.revision + '.');
}));
$('capture').addEventListener('click', action(async () => {
  if (!state.project || projectDirty) throw new Error('Save the original source selection before acquiring.');
  const result = await api('/api/captures', { expectedRevision: state.project.revision }); await refreshStatus(); schedulePoll(); notice('Acquiring the original WQX profiles as ' + result.id + '.');
}));
$('import-form').addEventListener('submit', action(async () => {
  if (state.project && projectDirty) throw new Error('Save the original source selection before importing into this project.');
  const result = await api('/api/import-capture', { sourceDirectory: $('import-directory').value, title: $('title').value, expectedRevision: state.project?.revision ?? 0 });
  await refresh(true); await openCapture(result.operationId); notice('Original capture imported with its retained source files.');
}));
$('receive-form').addEventListener('submit', action(async () => {
  const file = $('receive-file').files[0]; if (!file) throw new Error('Select a complete private review bundle.');
  if (file.size > 96 * 1024 * 1024) throw new Error('This private review bundle exceeds the receiving limit.');
  const bundle = JSON.parse(await file.text()), result = await api('/api/receive', { bundle });
  await refresh(true); await showSavedReview(result.review); tab('analysis'); notice('Complete review opened with ' + result.files + ' retained members.');
}));
$('analysis-form').addEventListener('input', () => { analysisDirty = true; $('save-review').disabled = true; });
$('analysis-form').addEventListener('submit', action(async () => {
  if (!selectedCapture) throw new Error('Select a retained source capture.');
  analysisComparisonId = $('compare-capture').value || null;
  analysisResult = await api('/api/analysis', { captureId: selectedCapture, options: analysisOptions(), comparisonCaptureId: analysisComparisonId });
  selectedReview = null; $('saved-review').hidden = true; renderAnalysis(); notice('Review analysis updated from the retained original results.');
}));
$('review-form').addEventListener('submit', action(async () => {
  if (!analysisResult || analysisDirty) throw new Error('Update the analysis before saving the review.');
  const review = await api('/api/reviews', { reviewId: $('review-id').value || undefined, captureId: selectedCapture,
    options: analysisResult.analysis.options, note: $('note').value, comparisonCaptureId: analysisComparisonId,
    expectedCaptureSha256: analysisResult.captureSha256 });
  await refresh(); await showSavedReview(review); notice('Saved complete review ' + review.reviewId + '.');
}));
$('group').addEventListener('change', () => { rowPage = 0; renderGroup(); });
$('row-filter').addEventListener('change', () => { rowPage = 0; renderObservationPage(); });
$('previous-page').addEventListener('click', () => { rowPage--; renderObservationPage(); });
$('next-page').addEventListener('click', () => { rowPage++; renderObservationPage(); });
$('close-record').addEventListener('click', () => { $('record-detail').hidden = true; });
$('edition-form').addEventListener('submit', action(async () => {
  const name = $('edition-name').value, result = await api('/api/editions', { editionId: name, reviewId: $('edition-review').value });
  await refresh(); $('merchant-edition').value = name; await loadCustomerEdition(); jsonView('merchant-result', result); notice('Original WQX merchant edition prepared.');
}));
$('stage-form').addEventListener('submit', action(async () => {
  const result = await api('/api/merchant/stage', { editionId: $('merchant-edition').value, origin: $('merchant-origin').value, path: $('merchant-path').value, payment: JSON.parse($('payment').value) });
  jsonView('merchant-result', result); await refresh(); notice('Original native merchant offers prepared with the supplied terms.');
}));
$('start-merchant').addEventListener('click', action(async () => {
  const result = await api('/api/merchant/start', { editionId: $('merchant-edition').value }); jsonView('merchant-result', result); await refresh(); notice('Water-quality merchant started.');
}));
$('stop-merchant').addEventListener('click', action(async () => { await api('/api/merchant/stop', {}); await refresh(); notice('Merchant stopped.'); }));
$('customer-form').addEventListener('input', clearCustomerPreparation);
$('customer-kind').addEventListener('change', clearCustomerPreparation);
$('merchant-edition').addEventListener('change', action(async () => { await loadCustomerEdition(); renderRuntime(); }));
$('customer-form').addEventListener('submit', action(async () => {
  const kind = $('customer-kind').value;
  await prepareCustomer({ editionId: $('merchant-edition').value, intentId: $('intent').value || undefined, kind,
    query: kind === 'observations' ? customerQuery() : {}, ...(kind === 'source' ? { file: $('customer-file').value } : {}) });
}));
$('execute-purchase').addEventListener('click', action(async () => {
  if (!customerPrepared) throw new Error('Prepare the selected purchase before executing.');
  const intentId = customerPrepared.intentId; customerPrepared = null; renderCustomerControls();
  showCustomerDelivery(await api('/api/customer/execute', { intentId })); notice('Original buyer operation returned.');
}));
$('reopen-purchase').addEventListener('click', action(async () => {
  showCustomerDelivery(await api('/api/customer/reopen', { editionId: $('merchant-edition').value, intentId: $('intent').value })); notice('Original customer delivery reopened.');
}));
$('prepare-next-page').addEventListener('click', action(async () => {
  const previous = customerDelivery;
  if (previous?.kind !== 'observations' || previous.editionId !== customerEdition?.editionId || previous.metadata?.nextCursor == null)
    throw new Error('Open a delivered result page with a next cursor for this edition.');
  const query = Object.fromEntries(new URL(previous.url).searchParams); query.cursor = previous.metadata.nextCursor;
  const intentId = 'wqx-page-' + crypto.randomUUID(); $('customer-kind').value = 'observations'; $('customer-query').value = JSON.stringify(query, null, 2);
  await prepareCustomer({ editionId: $('merchant-edition').value, intentId, kind: 'observations', query, previous: previous.metadata });
}));
$('refresh').addEventListener('click', action(async () => { await refresh(true); notice('Workspace refreshed from its saved records.'); }));
refresh(true).catch(error => notice(error.message, true));
