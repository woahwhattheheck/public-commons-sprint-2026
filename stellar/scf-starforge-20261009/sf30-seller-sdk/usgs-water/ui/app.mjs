const $ = id => document.getElementById(id);
const make = (tag, text, attrs = {}) => {
  const el = document.createElement(tag);
  if (text !== null && text !== undefined) el.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) el.setAttribute(key, String(value));
  return el;
};
let state = null, selectedCapture = null, analysisResult = null, selectedReview = null, rowPage = 0, pollTimer = null, busy = 0, projectDirty = false;
const shownFailures = new Set(), customerEditions = new Map();
let customerEditionKey = null, customerEdition = null, customerPrepared = null, customerDelivery = null;
const PAGE = 40;
const sourceRanges = new Map(), sourceFilterValues = new Map(), sourceStatisticValues = new Map();
const SOURCE_FILTERS = {
  daily: ['approval_status', 'qualifier', 'last_modified'],
  continuous: ['approval_status', 'qualifier', 'last_modified', 'method_category'],
  'time-series-metadata': ['primary', 'computation_period_identifier', 'computation_identifier', 'begin', 'end', 'last_modified', 'sublocation_identifier'],
  'monitoring-locations': ['agency_code', 'state_code', 'county_code', 'country_code', 'site_type_code', 'hydrologic_unit_code', 'monitoring_location_name', 'national_aquifer_code', 'aquifer_code']
};
let sourceTimeCollection = null, analysisCollection = 'daily';
function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
function timestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && dateOnly(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && Number.isFinite(Date.parse(value)));
}
function timeControl(id, value, collection, analysis = false) {
  const input = $(id), continuous = collection === 'continuous', observation = ['daily', 'continuous'].includes(collection);
  input.type = continuous ? 'text' : 'date';
  input.placeholder = continuous ? '2026-10-01T12:30:00Z' : '';
  input.spellcheck = false; input.autocomplete = 'off';
  input.disabled = !observation; input.required = !analysis && observation;
  // Text controls retain the complete saved timestamp, including its offset and precision.
  input.value = value ?? '';
  const label = $(id + '-label');
  if (label) label.textContent = (id.startsWith('baseline-') ? 'Baseline ' : id.startsWith('analysis-') ? 'Analysis ' : '') + (id.endsWith('end') || id === 'end' ? 'through' : 'from') + (continuous ? ' (UTC timestamp)' : ' (local date)');
}
function timeRange(startId, endId, collection, analysis = false) {
  if (!['daily', 'continuous'].includes(collection)) return null;
  const range = {};
  for (const [name, id] of [['start', startId], ['end', endId]]) {
    const value = $(id).value.trim();
    if (!value) continue;
    const valid = collection === 'daily' ? dateOnly(value) : timestamp(value) || (analysis && dateOnly(value));
    if (!valid) throw new Error(collection === 'daily'
      ? 'Choose valid local calendar dates in YYYY-MM-DD format.'
      : 'Use a full UTC timestamp such as 2026-10-01T12:30:00Z, or include an explicit UTC offset.' + (analysis ? ' A date-only analysis boundary selects that UTC day.' : ''));
    range[name] = value;
  }
  if (!analysis && (!range.start || !range.end)) throw new Error('Enter both source time boundaries before saving.');
  const end = range.end ? Date.parse(range.end) + (collection === 'continuous' && analysis && dateOnly(range.end) ? 86399999 : 0) : Infinity;
  if (range.start && Date.parse(range.start) > end) throw new Error('The time range end must not precede its start.');
  return Object.keys(range).length ? range : null;
}
function updateAnalysisTime(collection, options) {
  const same = analysisCollection === collection;
  const values = options === undefined && same ? {
    window: { start: $('analysis-start').value, end: $('analysis-end').value },
    baselineWindow: { start: $('baseline-start').value, end: $('baseline-end').value }
  } : options ?? {};
  analysisCollection = collection;
  for (const [prefix, window] of [['analysis', values.window], ['baseline', values.baselineWindow]]) {
    timeControl(prefix + '-start', window?.start, collection, true);
    timeControl(prefix + '-end', window?.end, collection, true);
  }
  $('analysis-time-help').textContent = collection === 'continuous'
    ? 'Enter full UTC timestamps ending Z, or include an explicit offset. Saved timestamps retain all digits and offsets. Date-only analysis boundaries select complete UTC days. Leave a boundary blank to use the retained source extent.'
    : collection === 'daily'
      ? 'Daily boundaries are inclusive provider-local calendar dates. Leave a boundary blank to use the retained source extent.'
      : 'Time windows apply to retained daily or continuous observations.';
}
const list = value => String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);
function notice(message, error = false) { $('notice').hidden = !message; $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(path, payload) {
  const options = payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-token': state?.token ?? '' }, body: JSON.stringify(payload) };
  const response = await fetch(path, options), value = await response.json();
  if (!response.ok || value.error) throw new Error(value.error?.message ?? 'The workspace request could not complete.');
  return value;
}
function action(fn) { return async event => { event?.preventDefault(); busy += 1; try { await fn(event); } catch (error) { notice(error.message, true); } finally { busy -= 1; } }; }
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-current', button.dataset.tab === name ? 'page' : 'false'));
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== 'tab-' + name; });
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
function option(select, value, label) { select.append(make('option', label, { value })); }
function jsonView(id, value) { $(id).textContent = JSON.stringify(value, null, 2); $(id).hidden = false; }
function metadataText(capture) {
  const s = capture.summary ?? {};
  const records = s.features ?? s.rows ?? s.uniqueFeatures ?? s.totalFeatures ?? null;
  return capture.pages + ' pages' + (records !== null ? ' · ' + records + ' records' : '') + ' · revision ' + capture.revision;
}
function recordList(id, values, build, empty) {
  const target = $(id); target.replaceChildren();
  if (!values.length) return target.append(make('p', empty, { class: 'empty' }));
  for (const row of values) target.append(build(row));
}
function renderCaptures() {
  const captures = state.captures ?? [];
  $('capture-count').textContent = captures.length;
  recordList('captures', captures, capture => {
    const box = make('div', null, { class: 'record' + (capture.operationId === selectedCapture ? ' selected' : '') });
    const head = make('div', null, { class: 'head' });
    head.append(make('strong', capture.operationId), make('span', capture.status, { class: 'tag' })); box.append(head);
    box.append(make('p', metadataText(capture)));
    if (capture.progress) box.append(make('p', JSON.stringify(capture.progress)));
    const buttons = make('div', null, { class: 'actions' });
    const open = make('button', 'Open', { type: 'button' });
    open.addEventListener('click', action(() => openCapture(capture.operationId))); buttons.append(open);
    if (['RUNNING', 'PREPARING'].includes(capture.status)) {
      const cancel = make('button', 'Cancel', { type: 'button' });
      cancel.addEventListener('click', action(async () => { await api('/api/captures/' + capture.operationId + '/cancel', {}); notice('Cancellation requested. Received pages stay with this capture.'); })); buttons.append(cancel);
    } else if (capture.status !== 'COMPLETE') {
      const resume = make('button', 'Resume same capture', { type: 'button' });
      resume.addEventListener('click', action(async () => {
        await api('/api/captures', { operationId: capture.operationId, expectedRevision: capture.revision });
        notice('Resuming ' + capture.operationId + '.'); schedulePoll(); await refreshStatus();
      })); buttons.append(resume);
    }
    box.append(buttons); return box;
  }, 'Acquired source will appear here.');
  const compared = $('compare-capture').value;
  $('compare-capture').replaceChildren(); option($('compare-capture'), '', 'No capture comparison');
  for (const capture of captures) if (capture.operationId !== selectedCapture) option($('compare-capture'), capture.operationId, capture.operationId + ' · ' + capture.status);
  if ([...$('compare-capture').options].some(x => x.value === compared)) $('compare-capture').value = compared;
}
function renderReviews() {
  const reviews = state.reviews ?? []; $('review-count').textContent = reviews.length;
  recordList('reviews', reviews, review => {
    const box = make('div', null, { class: 'record' });
    box.append(make('strong', review.reviewId), make('p', review.captureId));
    if (review.note) box.append(make('p', review.note.slice(0, 180)));
    const open = make('button', 'Open saved review', { type: 'button' });
    open.addEventListener('click', action(async () => showSavedReview(await api('/api/reviews/' + review.reviewId))));
    box.append(open); return box;
  }, 'Save a review to retain the selected analysis and decision.');
  const prior = $('edition-review').value; $('edition-review').replaceChildren(); option($('edition-review'), '', 'Select a review');
  for (const review of reviews) option($('edition-review'), review.reviewId, review.reviewId + ' · ' + review.captureId);
  $('edition-review').value = selectedReview?.reviewId ?? prior;
}
function renderEditions() {
  const editions = state.editions ?? [];
  recordList('editions', editions, edition => {
    const box = make('div', null, { class: 'record' });
    box.append(make('strong', edition.workspaceEditionId), make('p', edition.editionId ?? edition.status ?? 'Prepared'));
    if (edition.captureSha256) box.append(make('small', 'Source ' + edition.captureSha256));
    const open = make('button', 'Inspect edition', { type: 'button' });
    open.addEventListener('click', action(async () => { $('merchant-edition').value = edition.workspaceEditionId; jsonView('merchant-result', await loadCustomerEdition()); }));
    box.append(open); return box;
  }, 'Prepared merchant editions will appear here.');
  const prior = $('merchant-edition').value; $('merchant-edition').replaceChildren(); option($('merchant-edition'), '', 'Select an edition');
  for (const edition of editions) option($('merchant-edition'), edition.workspaceEditionId, edition.workspaceEditionId);
  if ([...$('merchant-edition').options].some(x => x.value === prior)) $('merchant-edition').value = prior;
  else if (editions.length === 1) $('merchant-edition').value = editions[0].workspaceEditionId;
  renderRuntime();
  loadCustomerEdition().catch(error => notice(error.message, true));
}
function renderRuntime() {
  const runtime = state.runtime ?? {};
  $('merchant-state').textContent = runtime.running ? 'Running · ' + runtime.editionId : 'Stopped';
  $('start-merchant').disabled = Boolean(runtime.running);
  $('stop-merchant').disabled = !runtime.running;
  $('buyer-state').textContent = state.buyerConfigured
    ? 'The connected original buyer retains its own intents, signing authority and budget. Review the prepared terms before executing.'
    : 'Start this workspace with an original buyer configuration to operate purchases here. The prepared edition also provides the native customer handoff.';
  renderCustomerControls();
}
async function loadCustomerEdition() {
  const id = $('merchant-edition').value;
  if (customerEditionKey !== id) {
    customerEditionKey = id; customerEdition = null; customerPrepared = null; customerDelivery = null;
    $('customer-file').replaceChildren(); option($('customer-file'), '', 'Select an original JSON member');
    renderCustomerControls();
  }
  if (!id) return null;
  const edition = customerEditions.get(id) ?? await api('/api/editions/' + id);
  customerEditions.set(id, edition);
  if ($('merchant-edition').value !== id) return null;
  customerEdition = edition;
  const previous = $('customer-file').value;
  $('customer-file').replaceChildren(); option($('customer-file'), '', 'Select an original JSON member');
  for (const file of edition.downloads ?? []) option($('customer-file'), file.path, file.path + ' · ' + file.bytes + ' bytes');
  if ([...$('customer-file').options].some(item => item.value === previous)) $('customer-file').value = previous;
  renderCustomerControls(); return edition;
}
function renderCustomerControls() {
  const kind = $('customer-kind').value, connected = Boolean(state?.buyerConfigured);
  $('customer-query-label').hidden = kind !== 'observations';
  $('customer-query').disabled = kind !== 'observations';
  $('customer-file-label').hidden = kind !== 'source';
  $('customer-file').disabled = kind !== 'source'; $('customer-file').required = kind === 'source';
  $('prepare-purchase').disabled = !connected || !customerEdition;
  $('execute-purchase').disabled = !connected || !customerPrepared;
  $('reopen-purchase').disabled = !connected || !customerEdition;
  const continued = customerDelivery?.kind === 'observations' && customerDelivery.editionId === customerEdition?.editionId && customerDelivery.metadata?.nextCursor != null;
  $('prepare-next-page').disabled = !connected || kind !== 'observations' || !continued || Boolean(customerPrepared?.prepared?.previous);
  $('customer-page-status').textContent = customerDelivery?.kind === 'observations'
    ? 'Received ' + (customerDelivery.rows?.length ?? 0) + ' observations from the saved edition. ' + (continued ? 'Prepare the next page to retain this query and continue from its returned cursor.' : 'This returned page has no next cursor.')
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
  jsonView('customer-result', response); renderCustomerControls();
}

function applyProjectForm(project) {
  projectDirty = false; $('capture').disabled = !project;
  if (!project) return;
  const s = project.selection;
  $('title').value = project.title; $('collection').value = s.collection;
  $('locations').value = (s.locationIds ?? []).join(', '); $('parameters').value = (s.parameterCodes ?? []).join(', ');
  $('limit').value = s.limit ?? 1000;
  $('time-series').value = (s.timeSeriesIds ?? []).join(', '); $('bbox').value = (s.bbox ?? []).join(', ');
  $('exact-selection').open = Boolean(s.timeSeriesIds?.length || s.bbox || Object.keys(s.filters ?? {}).length);
  $('revision').textContent = 'Saved revision ' + project.revision;
  $('project-heading').textContent = project.title + ' · revision ' + project.revision;
  $('capture').disabled = false; updateCollection(s.time ?? {}, s.filters ?? {}, s.statisticIds ?? []);
}
function updateCollection(savedTime, savedFilters, savedStatistics) {
  const collection = $('collection').value;
  if (sourceTimeCollection) {
    sourceRanges.set(sourceTimeCollection, { start: $('start').value, end: $('end').value });
    sourceFilterValues.set(sourceTimeCollection, $('source-filters').value);
    sourceStatisticValues.set(sourceTimeCollection, $('statistics').value);
  }
  const range = savedTime && !(savedTime instanceof Event) ? savedTime : sourceRanges.get(collection) ?? {};
  for (const id of ['start', 'end']) timeControl(id, range[id], collection);
  $('source-filters').value = savedFilters === undefined ? sourceFilterValues.get(collection) ?? '{}' : JSON.stringify(savedFilters, null, 2);
  const statistics = savedStatistics === undefined ? sourceStatisticValues.get(collection) : savedStatistics.join(', ');
  if (statistics !== undefined) $('statistics').value = statistics;
  else if (sourceTimeCollection !== collection) $('statistics').value = collection === 'daily' ? '00003' : '';
  sourceTimeCollection = collection;
  $('parameters').disabled = collection === 'monitoring-locations';
  $('statistics').disabled = collection === 'monitoring-locations';
  $('time-series').disabled = collection === 'monitoring-locations';
  $('source-filter-help').textContent = 'Available original ' + collection + ' fields: ' + SOURCE_FILTERS[collection].join(', ') + '. Use string values. Every filter is sent to its original USGS collection.';
  $('source-time-help').textContent = collection === 'continuous'
    ? 'Enter full UTC timestamps ending Z, for example 2026-10-01T12:30:00Z. Explicit offsets are also accepted and saved exactly. Choose both boundaries for this continuous selection.'
    : collection === 'daily'
      ? 'Daily observations use inclusive provider-local dates. Select continuous observations to query exact timestamps.'
      : 'This metadata collection does not use an observation time range.';
}
function sourceFilters() {
  let value;
  try { value = JSON.parse($('source-filters').value || '{}'); }
  catch { throw new Error('Source filters must be a JSON object, for example {"approval_status":"Provisional"}.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source filters must be a JSON object of original field names and string values.');
  return value;
}
function sourceBounds() {
  const text = $('bbox').value.trim();
  if (!text) return null;
  const parts = text.split(',').map(value => value.trim());
  if (parts.length !== 4 || parts.some(value => !value || !Number.isFinite(Number(value)))) throw new Error('Enter four geographic coordinates: west, south, east, north.');
  return parts.map(Number);
}
async function refresh(reset = false) {
  state = await api('/api/workspace');
  if (reset) applyProjectForm(state.project);
  renderCaptures(); renderReviews(); renderEditions();
  if (state.jobs?.some(job => job.status === 'RUNNING')) schedulePoll();
}
async function refreshStatus() {
  const status = await api('/api/status');
  Object.assign(state, status); renderCaptures(); renderRuntime();
  const failure = status.jobs?.find(row => row.status === 'FAILED' && !shownFailures.has(row.id));
  if (failure) { shownFailures.add(failure.id); notice(failure.error?.message ?? ('Capture ' + failure.id + ' could not complete.'), true); }
  if (status.jobs?.some(row => row.status === 'RUNNING')) schedulePoll();
}
function schedulePoll() {
  if (pollTimer) return;
  pollTimer = setTimeout(async () => { pollTimer = null; try { await refreshStatus(); } catch (error) { notice(error.message, true); } }, 1800);
}
function analysisOptions() {
  return { quality: $('quality').value, window: timeRange('analysis-start', 'analysis-end', analysisCollection, true), baselineWindow: timeRange('baseline-start', 'baseline-end', analysisCollection, true) };
}
async function openCapture(id) {
  selectedCapture = id; selectedReview = null; $('analyze').disabled = false;
  $('analysis-status').textContent = id; $('saved-review').hidden = true;
  const capture = await api('/api/captures/' + id);
  updateAnalysisTime(capture.selection.collection);
  renderSource(capture); renderCaptures();
  analysisResult = await api('/api/analysis', { captureId: id, options: analysisOptions(), comparisonCaptureId: $('compare-capture').value || undefined });
  renderAnalysis(); tab('analysis');
}
function renderSource(capture) {
  $('source-state').textContent = capture.status;
  $('source-details').replaceChildren(make('p', capture.operationId), make('small', capture.captureSha256 ?? 'Capture in progress'));
  const config = make('pre', JSON.stringify(capture.selection, null, 2)); $('source-details').append(config);
  recordList('source-pages', capture.pages ?? [], (page) => {
    const index = capture.pages.indexOf(page), box = make('div', null, { class: 'record' });
    const original = make('a', 'Original USGS request', { href: page.url, target: '_blank', rel: 'noreferrer' });
    box.append(make('strong', 'Response page ' + (index + 1)), make('p', page.receivedAt), make('small', page.sha256 ?? page.bodySha256));
    const links = make('div', null, { class: 'actions' });
    links.append(make('a', 'Download retained GeoJSON', { href: '/api/captures/' + capture.operationId + '/pages/' + index, class: 'download' }), original);
    box.append(links); return box;
  }, 'No complete response page has been retained yet.');
}
function renderAnalysis() {
  const analysis = analysisResult?.analysis;
  $('analysis-empty').hidden = Boolean(analysis); $('analysis-body').hidden = !analysis;
  if (!analysis) return;
  $('analysis-status').textContent = analysis.source.status + ' · ' + analysis.source.operationId;
  $('metric-series').textContent = analysis.counts.series;
  $('metric-rows').textContent = analysis.counts.selectedObservations;
  $('metric-conflicts').textContent = analysis.counts.conflictingFeatures;
  const previous = $('series').value; $('series').replaceChildren();
  for (const series of analysis.series) option($('series'), series.key, series.locationId + ' · ' + series.parameterCode + (series.statisticId ? ' / ' + series.statisticId : '') + ' · ' + series.unit);
  if ([...$('series').options].some(x => x.value === previous)) $('series').value = previous;
  $('method').replaceChildren(...Object.values(analysis.method).map(value => make('li', value)));
  $('conflicts').replaceChildren();
  if (analysis.conflicts.length) $('conflicts').append(make('h3', 'Conflicting retained features'), make('pre', JSON.stringify(analysis.conflicts, null, 2)));
  const comparison = analysisResult.comparison; $('capture-comparison').hidden = !comparison;
  if (comparison) {
    $('capture-comparison').replaceChildren(make('h3', 'Capture comparison'), make('p',
      comparison.counts.added + ' added · ' + comparison.counts.removed + ' absent from newer capture · ' + comparison.counts.changed + ' changed · ' +
      (comparison.sameSelection ? 'Same source selection' : 'Different source selections'), { class: 'caption' }),
      make('p', comparison.meaning, { class: 'caption' }));
    const detail = make('details'), heading = make('summary', 'Inspect original record changes');
    detail.append(heading, make('pre', JSON.stringify({ added: comparison.added, removed: comparison.removed, changed: comparison.changed, unresolved: comparison.unresolved }, null, 2)));
    $('capture-comparison').append(detail);
  }
  rowPage = 0; renderSeries();
}
function currentSeries() { return analysisResult?.analysis.series.find(row => row.key === $('series').value); }
function display(value) { return value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function renderSeries() {
  const series = currentSeries(); $('summary').replaceChildren(); $('observations').replaceChildren(); $('plot').replaceChildren();
  if (!series) { $('plot').append(make('p', 'This capture has no selected numeric time series.', { class: 'empty' })); $('change').textContent = ''; $('quality-summary').textContent = ''; return; }
  for (const [name, period] of [['Selected period', series.current], ['Baseline', series.baseline]]) {
    if (!period) continue;
    const row = make('tr');
    for (const value of [name, period.observations, period.minimum?.value, period.maximum?.value, period.mean?.value, period.median?.value]) row.append(make('td', display(value)));
    $('summary').append(row);
  }
  $('change').textContent = series.change ? 'Mean change: ' + display(series.change.value) + ' ' + series.unit + (series.change.percent !== null ? ' · ' + series.change.percent + '%' : ' · percentage unavailable for zero baseline') : 'Original unit: ' + series.unit + ' · parameter ' + series.parameterCode + ' · statistic ' + (series.statisticId || 'not supplied');
  $('quality-summary').textContent = 'Approval: ' + display(series.current.approvalCounts) + ' · missing or non-numeric: ' + series.current.missingOrNonNumeric + ' · qualifiers: ' + display(series.current.qualifierCounts);
  plot(series);
  renderObservationPage();
}
function plot(series) {
  const observations = series.current.observationsByTime;
  const points = observations.filter(row => row.value !== null && row.value !== '' && Number.isFinite(Number(row.value)) && Number.isFinite(Date.parse(row.time))).map(row => ({ ...row, x: Date.parse(row.time), y: Number(row.value) }));
  if (!points.length) return $('plot').append(make('p', 'No numeric observations in this selected period.', { class: 'empty' }));
  const minX = points.reduce((n, p) => Math.min(n, p.x), Infinity), maxX = points.reduce((n, p) => Math.max(n, p.x), -Infinity);
  const lowY = points.reduce((n, p) => Math.min(n, p.y), Infinity), highY = points.reduce((n, p) => Math.max(n, p.y), -Infinity);
  const pad = (highY - lowY || Math.max(Math.abs(lowY), 1)) * .08, minY = lowY - pad, maxY = highY + pad;
  const width = 840, height = 230, left = 72, right = 18, top = 18, bottom = 38;
  const sx = value => left + (value - minX) / (maxX - minX || 1) * (width - left - right);
  const sy = value => top + (maxY - value) / (maxY - minY || 1) * (height - top - bottom);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', series.locationId + ', returned values in ' + series.unit);
  function element(tag, attrs, content) {
    const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (content !== undefined) el.textContent = String(content); svg.append(el); return el;
  }
  for (let i = 0; i < 5; i++) {
    const value = minY + (maxY - minY) * i / 4, y = sy(value);
    element('line', { x1: left, x2: width - right, y1: y, y2: y, class: 'grid' });
    element('text', { x: left - 9, y: y + 4, 'text-anchor': 'end' }, Number(value.toPrecision(6)));
  }
  const ticks = minX === maxX ? [minX] : [minX, minX + (maxX - minX) / 2, maxX];
  for (const time of ticks) {
    const iso = new Date(time).toISOString();
    const label = series.collection === 'continuous' ? iso.replace('T', ' ').replace('.000Z', 'Z') : iso.slice(0, 10);
    element('text', { x: sx(time), y: height - 14, 'text-anchor': time === maxX && minX !== maxX ? 'end' : time === minX ? 'start' : 'middle' }, label);
  }
  for (const point of points) {
    const circle = element('circle', { cx: sx(point.x), cy: sy(point.y), r: points.length > 500 ? 1.5 : 3 });
    const title = document.createElementNS(ns, 'title'); title.textContent = point.time + ' · ' + point.value + ' ' + series.unit + ' · ' + display(point.approvalStatus) + ' · ' + display(point.qualifier); circle.append(title);
  }
  $('plot').append(svg);
}
function renderObservationPage() {
  const observations = currentSeries()?.current.observationsByTime ?? [];
  rowPage = Math.max(0, Math.min(rowPage, Math.max(0, Math.ceil(observations.length / PAGE) - 1)));
  $('observations').replaceChildren();
  for (const observation of observations.slice(rowPage * PAGE, (rowPage + 1) * PAGE)) {
    const tr = make('tr');
    for (const value of [observation.time, observation.value, observation.approvalStatus, observation.qualifier, observation.sourcePage]) tr.append(make('td', display(value)));
    $('observations').append(tr);
  }
  $('page-label').textContent = observations.length ? (rowPage * PAGE + 1) + '–' + Math.min(observations.length, (rowPage + 1) * PAGE) + ' of ' + observations.length : '0 observations';
  $('previous-page').disabled = rowPage === 0; $('next-page').disabled = (rowPage + 1) * PAGE >= observations.length;
}
function showSavedReview(review) {
  selectedReview = review; selectedCapture = review.captureId; analysisResult = { analysis: review.analysis, comparison: review.comparison };
  $('quality').value = review.analysis.options.quality;
  updateAnalysisTime(review.analysis.source.selection.collection, review.analysis.options);
  $('note').value = review.note; $('analyze').disabled = false;
  $('saved-review').hidden = false; $('saved-review-id').textContent = review.reviewId; $('saved-review-note').textContent = review.note;
  $('review-downloads').replaceChildren();
  for (const [format, label] of [['html', 'Report'], ['json', 'Saved review JSON'], ['csv', 'Observations CSV'], ['geojson', 'Observations GeoJSON']])
    $('review-downloads').append(make('a', label, { href: '/api/reviews/' + review.reviewId + '/' + format, class: 'download' }));
  $('edition-review').value = review.reviewId; renderAnalysis(); renderCaptures();
  $('compare-capture').value = review.comparisonCaptureId ?? review.comparison?.previous.operationId ?? '';
  api('/api/captures/' + review.captureId).then(renderSource).catch(error => notice(error.message, true));
}
$('project-form').addEventListener('input', () => {
  projectDirty = true; $('capture').disabled = true;
  $('revision').textContent = 'Unsaved selection changes. Save before acquiring source.';
});
$('project-form').addEventListener('submit', action(async () => {
  const collection = $('collection').value, observation = ['daily', 'continuous'].includes(collection);
  const selection = { collection, locationIds: list($('locations').value), parameterCodes: $('parameters').disabled ? [] : list($('parameters').value),
    statisticIds: $('statistics').disabled ? [] : list($('statistics').value),
    timeSeriesIds: $('time-series').disabled ? [] : list($('time-series').value), bbox: sourceBounds(), filters: sourceFilters(), limit: Number($('limit').value) };
  if (observation) selection.time = timeRange('start', 'end', collection);
  const saved = await api('/api/project', { title: $('title').value, selection, expectedRevision: state.project?.revision ?? 0 });
  await refresh(true); notice('Saved source selection, revision ' + saved.revision + '.');
}));
$('collection').addEventListener('change', updateCollection);
$('capture').addEventListener('click', action(async () => {
  if (!state.project || projectDirty) throw new Error('Save the source selection before acquiring source.');
  const result = await api('/api/captures', { expectedRevision: state.project.revision });
  notice('Acquiring original source as ' + result.id + '.'); schedulePoll(); await refreshStatus();
}));
$('analysis-form').addEventListener('submit', action(async () => {
  if (!selectedCapture) throw new Error('Select a retained capture.');
  analysisResult = await api('/api/analysis', { captureId: selectedCapture, options: analysisOptions(), comparisonCaptureId: $('compare-capture').value || undefined });
  selectedReview = null; $('saved-review').hidden = true; renderAnalysis(); notice('Analysis updated from the selected retained source.');
}));
$('review-form').addEventListener('submit', action(async () => {
  if (!analysisResult) throw new Error('Open the analysis first.');
  const review = await api('/api/reviews', { captureId: selectedCapture, options: analysisResult.analysis.options,
    note: $('note').value, comparisonCaptureId: analysisResult.comparison?.previous.operationId,
    expectedCaptureSha256: analysisResult.analysis.source.captureSha256 });
  await refresh(); showSavedReview(review); notice('Saved review ' + review.reviewId + '.');
}));
$('edition-form').addEventListener('submit', action(async () => {
  const result = await api('/api/editions', { editionId: $('edition-name').value, reviewId: $('edition-review').value });
  await refresh(); $('merchant-edition').value = $('edition-name').value; jsonView('merchant-result', result); notice('Immutable merchant edition prepared.');
}));
$('stage-form').addEventListener('submit', action(async () => {
  const result = await api('/api/merchant/stage', { editionId: $('merchant-edition').value, origin: $('merchant-origin').value,
    path: $('merchant-path').value, payment: JSON.parse($('payment').value) });
  jsonView('merchant-result', result); await refresh(); notice('Original merchant package prepared with the supplied payment terms.');
}));
$('start-merchant').addEventListener('click', action(async () => { const result = await api('/api/merchant/start', { editionId: $('merchant-edition').value }); jsonView('merchant-result', result); await refresh(); notice('Merchant started.'); }));
$('stop-merchant').addEventListener('click', action(async () => { await api('/api/merchant/stop', {}); await refresh(); notice('Merchant stopped.'); }));
$('customer-form').addEventListener('input', clearCustomerPreparation);
$('customer-kind').addEventListener('change', clearCustomerPreparation);
$('merchant-edition').addEventListener('change', action(async () => { await loadCustomerEdition(); }));
$('customer-form').addEventListener('submit', action(async () => {
  const kind = $('customer-kind').value;
  await prepareCustomer({ editionId: $('merchant-edition').value, intentId: $('intent').value || undefined, kind,
    query: kind === 'observations' ? customerQuery() : {},
    ...(kind === 'source' ? { file: $('customer-file').value } : {}) });
}));
$('execute-purchase').addEventListener('click', action(async () => {
  if (!customerPrepared) throw new Error('Prepare the selected purchase before executing it.');
  const intentId = customerPrepared.intentId; customerPrepared = null; renderCustomerControls();
  showCustomerDelivery(await api('/api/customer/execute', { intentId }));
  notice('Original buyer operation returned.');
}));
$('reopen-purchase').addEventListener('click', action(async () => {
  showCustomerDelivery(await api('/api/customer/reopen', { editionId: $('merchant-edition').value, intentId: $('intent').value }));
  notice('Original customer result reopened.');
}));
$('prepare-next-page').addEventListener('click', action(async () => {
  const previous = customerDelivery;
  if (previous?.kind !== 'observations' || previous.editionId !== customerEdition?.editionId || previous.metadata?.nextCursor == null)
    throw new Error('Open a delivered observation page with a next cursor for this edition.');
  const query = Object.fromEntries(new URL(previous.url).searchParams);
  query.cursor = previous.metadata.nextCursor;
  const intentId = 'water-page-' + crypto.randomUUID();
  $('customer-kind').value = 'observations'; $('customer-query').value = JSON.stringify(query, null, 2);
  await prepareCustomer({ editionId: $('merchant-edition').value, intentId, kind: 'observations', query, previous: previous.metadata });
}));
$('series').addEventListener('change', () => { rowPage = 0; renderSeries(); });
$('previous-page').addEventListener('click', () => { rowPage--; renderObservationPage(); });
$('next-page').addEventListener('click', () => { rowPage++; renderObservationPage(); });
$('refresh').addEventListener('click', action(async () => { await refresh(true); notice('Workspace refreshed.'); }));
const end = new Date(); end.setUTCDate(end.getUTCDate() - 1); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 13);
updateCollection({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
updateAnalysisTime('daily');
refresh(true).catch(error => notice(error.message, true));
