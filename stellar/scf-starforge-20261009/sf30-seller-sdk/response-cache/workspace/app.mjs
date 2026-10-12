// MIT. Plain operator interface over the original cache workspace API.
const $ = id => document.getElementById(id);
const fields = ['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes'];
const params = new URLSearchParams(location.search), packageName = params.get('name');
const token = location.hash.slice(1);
const base = '/api/cache-operations/';
let state, selected, live, prepared, retainedPolicy, busy = false, offset = 0;
let policyOffset = 0, policyCount = 0;
const node = (tag, value, className) => {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = String(value);
  if (className) result.className = className;
  return result;
};
const format = value => Number.isSafeInteger(value) ? value.toLocaleString() : '—';
const note = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const message = error => ({
  CACHE_WORKSPACE_REVISION_CONFLICT: 'The saved workspace changed. Refresh its history and retain your intended edit.',
  CACHE_CONTROL_REVIEW_STALE: 'The runtime changed after this review. Save a fresh snapshot and prepare the change again.',
  CACHE_WORKSPACE_ORIGINAL_RUNTIME_CHANGED: 'The original runtime changed. Its interrupted change is retained; prepare a new review on the current runtime.',
  CACHE_WORKSPACE_SOURCE_OFFLINE: 'Start this package’s original merchant to inspect or change its cache. Saved history remains available.',
  CACHE_WORKSPACE_SOURCE_NOT_CONFIGURED: 'Configure this source’s existing private control on the operator host.',
  CACHE_CONTROL_UNAVAILABLE: 'The selected merchant control is unavailable. Its saved history remains available.',
  CACHE_WORKSPACE_ENTRY_BUDGET_INVALID: 'The largest retained response must fit both total cache bytes and the source response limit.',
  CACHE_WORKSPACE_RESTORE_REQUIRES_EMPTY: 'Receive this archive in a new, empty workspace.',
})[error.code ?? error.message] ?? error.message;
function url(operation, query = {}) {
  const result = new URL(base + operation, location.origin);
  if (packageName) result.searchParams.set('name', packageName);
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) result.searchParams.set(key, value);
  return result;
}
async function api(operation, body, query) {
  const response = await fetch(url(operation, query), { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-workspace-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Cache request failed'), { code: result.code ?? result.error });
  return result;
}
async function act(work) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button,input,select,textarea')];
  const previous = controls.map(control => [control, control.disabled]);
  controls.forEach(control => { control.disabled = true; });
  try { await work(); } catch (error) { note(message(error), true); }
  finally {
    for (const [control, disabled] of previous) if (control.isConnected) control.disabled = disabled;
    busy = false; available();
  }
}
function available() {
  const hasSource = Boolean($('source').value);
  $('inspect').disabled = busy || !hasSource; $('capture').disabled = busy || !hasSource;
  $('prepare').disabled = busy || !selected || !$('route').value;
  $('restore-policy').disabled = busy || !selected || !$('route').value || !$('restore-target').value;
  $('compare').disabled = busy || !$('compare-before').value || !$('compare-after').value;
  $('previous').disabled = busy || offset === 0;
  $('next').disabled = busy || !state || offset + state.limit >= Math.max(state.inspectionCount, state.changeCount);
  $('policy-fields').hidden = $('action').value !== 'configure';
  for (const field of fields) $(field).required = $('action').value === 'configure';
  $('restore').disabled = busy || !state || state.revision !== 0 || !$('archive').files.length;
  $('policy-review').disabled = busy || !packageName || !selected?.inspection.package ||
    !$('policy-package-name').value.trim() || !$('policy-package-routes').querySelector('input:checked');
  $('policy-save').disabled = busy || !retainedPolicy || retainedPolicy.state === 'SAVED';
  $('policy-open').disabled = busy || !$('policy-review-list').value;
  $('policy-review-previous').disabled = busy || policyOffset === 0;
  $('policy-review-next').disabled = busy || policyOffset + 50 >= policyCount;
}
function table(headers, rows) {
  const result = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
  headers.forEach(value => tr.append(node('th', value))); head.append(tr);
  rows.forEach(values => { const row = node('tr'); values.forEach(value => row.append(node('td', value))); body.append(row); });
  result.append(head, body); return result;
}
function details(value, label = 'Original record') {
  const result = node('details'); result.append(node('summary', label), node('pre', JSON.stringify(value, null, 2))); return result;
}
function routeTable(inspection) {
  $('routes').replaceChildren();
  if (!inspection) return;
  $('live-summary').textContent = 'Runtime ' + inspection.instanceId + ' · Control revision ' + inspection.revision;
  const rows = Object.entries(inspection.routes).map(([id, route]) => {
    const s = route.stats?.cache ?? route.stats ?? route, policy = route.policy ?? route.limits ?? {};
    return [id, format(policy.ttlMs) + ' ms', format(s.entries) + ' / ' + format(policy.maxEntries),
      format(s.bytes) + ' / ' + format(policy.maxBytes), format(s.requests), format(s.sourceReads),
      format(s.hits), format(s.coalesced), format(s.sourceInFlight), format(s.sourceErrors), format(s.sourceTimeouts)];
  });
  $('routes').append(table(['Route', 'Freshness', 'Retained responses', 'Cache bytes', 'Requests', 'Source reads',
    'Hits', 'Coalesced', 'Active source reads', 'Source errors', 'Timeouts'], rows), details(inspection, 'Complete original inspection'));
}
function options(select, values, previous) {
  select.replaceChildren(...values.map(({ id, label }) => { const o = node('option', label); o.value = id; return o; }));
  if (values.some(row => row.id === previous)) select.value = previous;
}
function drawChanges() {
  $('changes').replaceChildren();
  if (!state.changes.length) $('changes').append(node('p', 'No operating changes have been prepared.', 'empty'));
  state.changes.forEach(row => {
    const card = node('article', undefined, 'record'), head = node('div', undefined, 'record-head');
    head.append(node('strong', row.command.route + ' · ' + row.command.action), node('span', row.status, 'badge'));
    card.append(head, node('p', row.createdAt + ' · ' + row.id, 'quiet'));
    if (row.note) card.append(node('p', row.note));
    if (row.error) card.append(node('p', message({ code: row.error, message: row.error }), 'quiet'));
    const view = node('button', 'Review');
    view.addEventListener('click', () => { prepared = row; drawPrepared(); $('prepared').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    card.append(view);
    if (row.status === 'PENDING') {
      const recover = node('button', 'Recover original change');
      recover.addEventListener('click', () => act(async () => {
        const result = await api('recover', { id: row.id, expectedRevision: state.revision });
        prepared = result.change; await refresh(); drawPrepared();
        note(result.change.status === 'APPLIED' ? 'The original completed change is recovered.' : message({ code: result.change.error, message: 'The original change remains pending.' }));
      })); card.append(recover);
    }
    card.append(details(row)); $('changes').append(card);
  });
}
function drawPrepared() {
  $('prepared').replaceChildren();
  if (!prepared) return;
  const row = prepared, card = node('article', undefined, 'record');
  const head = node('div', undefined, 'record-head');
  head.append(node('strong', row.command.action === 'configure' ? 'Reviewed retention change' : 'Reviewed invalidation'), node('span', row.status, 'badge'));
  card.append(head, node('p', row.command.route + ' · Runtime ' + row.command.expectedInstanceId + ' · Revision ' + row.command.expectedRevision, 'quiet'));
  card.append(table(['Setting', 'Reviewed value', 'Requested value'], fields.map(field =>
    [field, format(row.preview.before[field]), format(row.preview.after[field])])));
  card.append(node('p', 'Retained responses at review: ' + format(row.preview.retainedEntries) + ' · ' + format(row.preview.retainedBytes) + ' bytes.', 'quiet'));
  if (row.note) card.append(node('p', row.note));
  if (row.status === 'PREPARED') {
    const apply = node('button', 'Apply this exact change', 'primary');
    apply.addEventListener('click', () => act(async () => {
      const result = await api('apply', { id: row.id, expectedRevision: state.revision });
      prepared = result.change; await refresh(); drawPrepared();
      note(result.change.status === 'APPLIED' ? 'The reviewed change was applied to the original merchant runtime.' :
        message({ code: result.change.error, message: 'The operation is retained for recovery.' }));
    })); card.append(apply);
  }
  const noteLabel = node('label', 'Operating note'), edit = node('textarea'); edit.value = row.note; edit.maxLength = 2000; edit.rows = 3;
  noteLabel.append(edit); const save = node('button', 'Save note');
  save.addEventListener('click', () => act(async () => {
    const result = await api('note', { id: row.id, expectedRevision: state.revision, note: edit.value });
    prepared = result.change; await refresh(); drawPrepared(); note('Operating note saved.');
  }));
  card.append(noteLabel, save, details(row.receipt ?? row.command, row.receipt ? 'Original applied result' : 'Exact control command'));
  $('prepared').append(card);
}
async function selectInspection(id) {
  selected = await api('inspection', undefined, { id });
  const previous = $('route').value;
  options($('route'), Object.keys(selected.inspection.routes).map(id => ({ id, label: id })), previous);
  $('review-source').textContent = selected.label + ' · ' + selected.capturedAt + ' · Runtime revision ' + selected.inspection.revision;
  fillPolicy(); routeTable(selected.inspection); drawSnapshots(); selectPolicySnapshot(); available();
}
function fillPolicy() {
  const route = selected?.inspection.routes[$('route').value];
  for (const field of fields) $(field).value = route?.limits?.[field] ?? route?.policy?.[field] ?? '';
}
function drawSnapshots() {
  $('snapshots').replaceChildren();
  if (!state.inspections.length) $('snapshots').append(node('p', 'Save a current snapshot to review this merchant’s cache policy.', 'empty'));
  state.inspections.forEach(row => {
    const card = node('article', undefined, 'record' + (selected?.id === row.id ? ' selected' : ''));
    card.append(node('strong', row.label), node('p', row.capturedAt, 'quiet'));
    const button = node('button', 'Use for review');
    button.addEventListener('click', () => act(() => selectInspection(row.id))); card.append(button); $('snapshots').append(card);
  });
}
async function refresh() {
  const pinnedChoices = ['compare-before', 'compare-after', 'restore-target'].map(id => {
    const option = $(id).selectedOptions[0];
    return option?.value ? { id: option.value, label: option.textContent } : null;
  }).filter(Boolean);
  const requestedSource = $('source').value;
  state = await api('workspace', undefined, { source: requestedSource || undefined, offset });
  options($('source'), state.sources.map(row => ({ id: row.id, label: row.label + (row.configured ? '' : ' · host mapping required') })), requestedSource);
  if ($('source').value && $('source').value !== requestedSource)
    state = await api('workspace', undefined, { source: $('source').value, offset });
  $('identity').textContent = packageName ? 'API package: ' + packageName : 'Workspace ' + state.id;
  $('revision').textContent = 'Saved revision ' + state.revision;
  $('history-count').textContent = state.inspectionCount + ' snapshots';
  $('change-count').textContent = state.changeCount + ' changes';
  const choices = state.inspections.map(row => ({ id: row.id, label: row.label + ' · ' + row.capturedAt }));
  if (requestedSource === $('source').value) for (const choice of pinnedChoices)
    if (!choices.some(row => row.id === choice.id)) choices.push(choice);
  for (const id of ['compare-before', 'compare-after', 'restore-target']) options($(id), choices, $(id).value);
  if (!$('compare-before').dataset.initialized && choices.length > 1) {
    $('compare-before').value = choices[1].id; $('compare-before').dataset.initialized = 'true';
  }
  drawSnapshots(); drawChanges(); await refreshPolicyReviews(); available();
}
async function download(operation, filename) {
  const response = await fetch(url(operation, { source: $('source').value || undefined }), { headers: { 'x-workspace-token': token } });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
  const blob = await response.blob(), href = URL.createObjectURL(blob), a = node('a'); a.href = href; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}
function selectPolicySnapshot() {
  retainedPolicy = null;
  $('retained-policy-review').replaceChildren(); $('retained-policy-result').replaceChildren();
  $('policy-package-routes').replaceChildren();
  const binding = selected?.inspection.package;
  $('policy-snapshot').textContent = binding ? selected.label + ' · ' + selected.capturedAt +
    ' · Runtime revision ' + selected.inspection.revision :
    'Save and select a current operating snapshot from this package to retain its policy.';
  if (!binding) return;
  for (const id of Object.keys(selected.inspection.routes)) {
    const label = node('label'), input = node('input');
    input.type = 'checkbox'; input.value = id; input.checked = true;
    input.addEventListener('change', clearPolicyReview); label.append(input, document.createTextNode(' ' + id));
    $('policy-package-routes').append(label);
  }
  available();
}
function clearPolicyReview() {
  retainedPolicy = null; $('retained-policy-review').replaceChildren(); $('retained-policy-result').replaceChildren(); available();
}
function drawPolicyReview() {
  $('retained-policy-review').replaceChildren(); $('retained-policy-result').replaceChildren();
  if (!retainedPolicy) return;
  const record = retainedPolicy.record, card = node('article', undefined, 'record');
  card.append(node('h3', record.base.name + ' → ' + record.name));
  card.append(node('p', record.snapshot.label + ' · ' + record.snapshot.capturedAt, 'quiet'));
  for (const route of record.changes) {
    card.append(node('h4', route.routeId));
    card.append(table(['Retention setting', 'Saved package', 'Selected snapshot'],
      fields.map(key => [key, format(route.before[key]), format(route.after[key])])));
  }
  if (record.note) card.append(node('p', record.note));
  card.append(details({ reviewId: record.id, reviewSha256: record.reviewSha256,
    package: record.base, operatingSnapshot: record.snapshot.id }, 'Retained review identity'));
  $('retained-policy-review').append(card);
  if (retainedPolicy.saved) {
    const saved = retainedPolicy.saved, link = node('a', 'Open ' + saved.name + ' in the merchant workspace');
    link.href = '/?package=' + encodeURIComponent(saved.name) + '#' + token;
    $('retained-policy-result').append(node('p', 'Package saved. Open it and use the original seller controls to start its retained policy.'), link,
      details(saved.release, 'Original release staging commands'));
  }
  available();
}
async function refreshPolicyReviews() {
  $('retained-policy').hidden = !packageName;
  if (!packageName) return;
  const result = await api('policy-list', undefined, { offset: policyOffset });
  policyCount = result.count;
  options($('policy-review-list'), result.reviews.map(row => ({
    id: row.id, label: row.name + ' · ' + row.createdAt
  })), retainedPolicy?.record.id ?? $('policy-review-list').value);
  $('policy-review-count').textContent = result.count + ' saved reviews';
}
$('retained-policy-form').addEventListener('submit', event => {
  event.preventDefault(); act(async () => {
    retainedPolicy = await api('policy-review', { inspectionId: selected.id,
      routeIds: [...$('policy-package-routes').querySelectorAll('input:checked')].map(input => input.value),
      name: $('policy-package-name').value.trim(), note: $('policy-package-note').value });
    policyOffset = 0; await refreshPolicyReviews(); drawPolicyReview();
    note('Package revision reviewed and retained. Review the saved settings, then save the package.');
  });
});
for (const id of ['policy-package-name', 'policy-package-note']) $(id).addEventListener('input', clearPolicyReview);
$('policy-save').addEventListener('click', () => act(async () => {
  const record = retainedPolicy.record;
  retainedPolicy = await api('policy-save', { id: record.id, expectedReviewSha256: record.reviewSha256 });
  await refreshPolicyReviews(); drawPolicyReview();
  note(retainedPolicy.recovered ? 'The original completed package was recovered.' : 'The reviewed policy is now saved in a new merchant package.');
}));
$('policy-open').addEventListener('click', () => act(async () => {
  retainedPolicy = await api('policy-show', undefined, { id: $('policy-review-list').value }); drawPolicyReview();
  note('Retained package review reopened.');
}));
$('policy-review-list').addEventListener('change', available);
$('policy-review-previous').addEventListener('click', () => act(async () => { policyOffset = Math.max(0, policyOffset - 50); await refreshPolicyReviews(); }));
$('policy-review-next').addEventListener('click', () => act(async () => { policyOffset += 50; await refreshPolicyReviews(); }));
$('policy-package-name').value = packageName ? packageName.slice(0, 48) + '-policy' : '';

$('source').addEventListener('change', () => act(async () => { offset = 0; selected = null; prepared = null; live = null; routeTable(null); $('route').replaceChildren();
  $('review-source').textContent = 'Select a saved operating snapshot to review changes.';
  $('comparison').replaceChildren();
  for (const id of ['compare-before', 'compare-after', 'restore-target']) $(id).replaceChildren();
  delete $('compare-before').dataset.initialized; drawPrepared(); selectPolicySnapshot(); await refresh(); }));
$('refresh').addEventListener('click', () => act(async () => { await refresh(); note('Operating history refreshed.'); }));
$('inspect').addEventListener('click', () => act(async () => { live = await api('inspect', { sourceId: $('source').value }); routeTable(live); note('Current original runtime inspected. Save a snapshot to prepare an operating change.'); }));
$('capture').addEventListener('click', () => act(async () => {
  const result = await api('capture', { sourceId: $('source').value, expectedRevision: state.revision, label: $('capture-label').value });
  offset = 0; await refresh(); await selectInspection(result.record.id); note('Current operating snapshot saved and selected.');
}));
$('route').addEventListener('change', () => { fillPolicy(); available(); });
$('action').addEventListener('change', available);
$('policy-form').addEventListener('submit', event => { event.preventDefault(); act(async () => {
  const action = $('action').value;
  const result = await api('prepare', { sourceId: $('source').value, inspectionId: selected.id, expectedRevision: state.revision,
    route: $('route').value, action, note: $('note').value, operationId: crypto.randomUUID(),
    ...(action === 'configure' ? { policy: Object.fromEntries(fields.map(field => [field, Number($(field).value)])) } : {}) });
  prepared = result.change; await refresh(); drawPrepared(); note('Exact change prepared. Review its settings and apply when ready.');
}); });
$('restore-policy').addEventListener('click', () => act(async () => {
  const result = await api('prepare', { sourceId: $('source').value, inspectionId: selected.id, expectedRevision: state.revision,
    restoreInspectionId: $('restore-target').value, route: $('route').value, action: 'configure', note: $('note').value, operationId: crypto.randomUUID() });
  prepared = result.change; await refresh(); drawPrepared(); note('Prior retention policy prepared against the selected current review.');
}));
$('compare').addEventListener('click', () => act(async () => {
  const result = await api('compare', undefined, { before: $('compare-before').value, after: $('compare-after').value });
  $('comparison').replaceChildren(node('p', result.comparison.sameInstance ? 'Both snapshots belong to the same original runtime.' :
    'The snapshots belong to different runtimes. Their original totals are shown independently.', 'quiet'));
  result.comparison.routes.forEach(row => {
    const section = node('div'); section.append(node('h3', row.id));
    section.append(table(['Retention setting', 'Earlier', 'Later'], Object.entries(row.retention).map(([key, value]) => [key, format(value.before), format(value.after)])));
    if (!row.sameGeneration) section.append(node('p', 'The cache generation changed; totals are shown independently for this route.', 'quiet'));
    const changes = Object.entries(row.deltas);
    if (changes.length) section.append(table(['Counter', 'Change in this counter window'], changes.map(([key, value]) => [key, format(value)])));
    section.append(details({ before: row.before, after: row.after })); $('comparison').append(section);
  }); note('Saved operating snapshots compared.');
}));
$('previous').addEventListener('click', () => act(async () => { offset = Math.max(0, offset - 50); await refresh(); }));
$('next').addEventListener('click', () => act(async () => { offset += 50; await refresh(); }));
$('report').addEventListener('click', () => act(() => download('report', 'merchant-cache-report.html')));
$('export').addEventListener('click', () => act(() => download('export', 'merchant-cache-workspace.json')));
$('archive').addEventListener('change', available);
$('restore').addEventListener('click', () => act(async () => {
  const file = $('archive').files[0];
  if (!file || file.size > 10 * 1024 * 1024) throw new Error('Choose a complete history file up to 10 MiB. The CLI receives larger histories.');
  const archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  await api('restore', { archive }); await refresh(); note('Complete operating history received. Configure its original controls on this host for live operation.');
}));
$('back').href = (packageName ? '/?package=' + encodeURIComponent(packageName) : '/') + '#' + token;
if (!/^[0-9a-f]{64}$/.test(token)) note('Open the complete private workspace URL printed by the operator.', true);
else act(async () => { await refresh(); note('Ready. Select a source and inspect its original running cache.'); });
