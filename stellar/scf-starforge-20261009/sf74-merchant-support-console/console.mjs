// MIT. Local merchant workspace. Original modules own all diagnostic and workorder decisions.
import {mountTermsEditor} from './terms-editor.mjs';

const $ = id => document.getElementById(id);
const form = $('intake-form');
const files = [
  ['before', 'before-source'], ['after', 'after-source'],
  ['postBefore', 'post-before-source'], ['postAfter', 'post-after-source'],
];
const retained = new Map();
let latest = null, latestBytes = null, intakeRevision = 0;
let postBytes = null, postRevision = 0, postAbort = null;
let comparisonBytes = null, comparisonRevision = 0, comparisonAbort = null;
let workorder = null, workorderRevision = 0, workorderAbort = null;
let termsImportRevision = 0, termsImportPending = false;

const titles = {
  REMEDIATION_REQUIRED: 'Issues need attention',
  INCONCLUSIVE: 'More information is needed',
  UNPAID_DISCOVERY_AND_BROWSER_READY: 'Discovery and browser access are ready',
  PREFLIGHT_REMEDIATION: 'Browser access needs a change',
  POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN: 'POST browser access is ready; checkout is unchecked',
  REMEDIATION_STILL_REQUIRED: 'The repair still needs attention',
  CATALOG_COVERAGE_INCOMPLETE: 'The catalog review is incomplete',
  BROWSER_CREDENTIAL_MODE_UNCONFIRMED: 'The buyer’s credential policy is unconfirmed',
  GET_UNPAID_DISCOVERY_AND_BROWSER_READY: 'Discovery and browser access are ready',
  POST_OPTIONS_READY_CHALLENGE_UNCHECKED: 'POST browser access is ready; checkout is unchecked',
  INCOMPLETE_EVIDENCE: 'More information is needed to review the repair',
};
const titleFor = code => titles[code] || 'Review the source result';
const modeLabel = value => value === true ? 'Required' : value === false ? 'Not required' : 'Unconfirmed';
const dateLabel = value => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'medium'}) : 'Time not recorded';
const findingTitle = item => (item.severity === 'HIGH' ? 'Needs attention' : 'Needs review') + ' · ' +
  String(item.code || 'Source finding').toLowerCase().replaceAll('_', ' ');
const line = (parent, tag, klass, text) => {
  const el = document.createElement(tag);
  if (klass) el.className = klass;
  el.textContent = String(text ?? '');
  parent.append(el);
  return el;
};
function rows(parent, entries) {
  parent.replaceChildren();
  for (const [label, value] of entries) {
    const row = line(parent, 'div', 'scope-row', '');
    line(row, 'b', '', label); line(row, 'span', '', value);
  }
}
function findingList(parent, findings, empty) {
  parent.replaceChildren();
  if (!findings.length) line(parent, 'li', 'empty-note', empty);
  for (const finding of findings) {
    const item = line(parent, 'li', '', '');
    line(item, 'strong', 'severity ' + (finding.severity === 'HIGH' ? 'high' : 'unknown'), findingTitle(finding));
    line(item, 'p', '', finding.action || 'Review the original observation.');
  }
}
function message(id, text, kind = '') {
  $(id).textContent = text;
  $(id).className = 'status' + (kind ? ' ' + kind : '');
}
function download(bytes, name, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function encodeBytes(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
async function encodedFile(file) {
  if (!file || !file.size || file.size > 2_000_000)
    throw new Error('Each file must contain 1 to 2,000,000 bytes');
  return encodeBytes(new Uint8Array(await file.arrayBuffer()));
}
async function request(path, payload, signal) {
  const response = await fetch(path, {method: 'POST', credentials: 'omit', cache: 'no-store', signal,
    headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || 'The request could not be completed');
  return data;
}

function showIntake(report) {
  latest = report;
  latestBytes = JSON.stringify(report, null, 2) + '\n';
  $('output').hidden = false;
  $('raw-report').textContent = latestBytes;
  $('copy').disabled = false;
  $('copy').textContent = 'Copy JSON';
  for (const id of ['download-intake', 'use-before', 'use-after']) $(id).disabled = false;
  $('outcome').textContent = titleFor(report.state);
  $('observed').textContent = 'Captured ' + dateLabel(report.observedAt);
  $('source-note').textContent = 'Original SF70 · ' + report.schema + ' · ' + report.state;
  const scope = report.scope || {};
  rows($('scope'), [
    ['Seller resource', scope.resource], ['Facilitator catalog', scope.catalog],
    ['Buyer origin', scope.buyerOrigin], ['Stellar network', scope.network],
    ['Public payment recipient', scope.payTo], ['Buyer operation', scope.intendedRetryMethod],
    ['Browser credentials', modeLabel(scope.browserCredentialed)],
  ]);
  findingList($('actions'), report.findings || [], 'No diagnostic findings were returned.');
  const safe = report.safeguards || {};
  $('safeguards').textContent = 'Original report: ' + safe.paidRequests + ' paid requests, ' +
    safe.walletCalls + ' wallet calls; settlement confirmed: ' + (safe.settlementConfirmed === true ? 'yes' : 'no') + '.';
  $('capture-selection-status').textContent = 'Choose where this capture belongs, or save it for later.';
  preparePreflight(report);
}
form.addEventListener('input', () => {
  intakeRevision++;
  clearPreflight();
  $('post-run').disabled = true;
  $('use-before').disabled = true;
  $('use-after').disabled = true;
  message('post-status', 'Route settings changed. Run the diagnosis again before checking browser access.');
  message('status', 'Route settings changed. Run the diagnosis to capture the updated route.');
  if (latestBytes) $('capture-selection-status').textContent = 'This is the previous diagnosis. Run again to use the updated route.';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const revision = ++intakeRevision;
  clearPreflight();
  $('run').disabled = true;
  for (const id of ['copy', 'download-intake', 'use-before', 'use-after']) $(id).disabled = true;
  latest = null; latestBytes = null;
  $('output').hidden = true;
  message('status', 'Checking the catalog and the route’s unpaid browser behavior…', 'busy');
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await request('/api/intake', {
      resource: values.resource, catalog: values.catalog, origin: values.origin,
      network: values.network, payTo: values.payTo, method: values.method,
      permission: $('permission').checked, credentialed: $('credentialed').checked,
    });
    if (revision !== intakeRevision) return;
    if (data.report?.schema !== 'stellar-forge.merchant-intake.v1') throw new Error('The original diagnosis was not returned');
    showIntake(data.report);
    message('status', 'Diagnosis captured. Review the findings, then choose it as your before or after capture.', 'good');
  } catch (error) {
    if (revision !== intakeRevision) return;
    message('status', 'Diagnosis unavailable: ' + String(error.message).slice(0, 280), 'error');
  } finally { $('run').disabled = false; }
});
$('copy').addEventListener('click', async () => {
  if (!latestBytes) return;
  try { await navigator.clipboard.writeText(latestBytes); $('copy').textContent = 'JSON copied'; }
  catch { $('copy').textContent = 'Select the JSON below to copy it'; }
});
$('download-intake').addEventListener('click', () => {
  if (latestBytes) download(latestBytes, 'merchant-intake.json');
});

function clearPreflight() {
  postRevision++;
  postAbort?.abort(); postAbort = null;
  postBytes = null;
  $('post-output').hidden = true;
  $('download-post').disabled = true;
  $('post-permission').checked = false;
}
function preparePreflight(report) {
  clearPreflight();
  $('post-preflight').hidden = report.scope?.intendedRetryMethod !== 'POST';
  $('post-run').disabled = false;
  $('post-target').textContent = 'OPTIONS ' + report.scope.resource + ' · Buyer origin: ' +
    report.scope.buyerOrigin + ' · Browser credentials: ' + modeLabel(report.scope.browserCredentialed);
  message('post-status', 'Review the captured target and authorize its separate OPTIONS-only check.');
}
$('post-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!latestBytes || !$('post-permission').checked || $('post-run').disabled) return;
  const source = latestBytes;
  const revision = ++postRevision;
  postAbort?.abort();
  const controller = new AbortController(); postAbort = controller;
  postBytes = null;
  $('post-output').hidden = true;
  $('download-post').disabled = true;
  $('post-run').disabled = true;
  message('post-status', 'Checking eligibility, then sending at most one authorized OPTIONS request…', 'busy');
  try {
    const data = await request('/api/post-preflight', {
      intake: encodeBytes(new TextEncoder().encode(source)), permission: true,
    }, controller.signal);
    if (revision !== postRevision || source !== latestBytes) return;
    const report = data.report;
    if (report?.schema !== 'stellar-forge.post-only-browser-preflight.v1') throw new Error('The original browser check was not returned');
    postBytes = JSON.stringify(report, null, 2) + '\n';
    $('raw-post').textContent = postBytes;
    $('post-outcome').textContent = titleFor(report.status);
    findingList($('post-findings'), report.findings, report.eligibility.ok
      ? 'No browser-policy findings. The POST payment challenge remains unchecked.' : report.eligibility.reason);
    $('post-limits').textContent = report.limitations;
    $('post-output').hidden = false;
    $('download-post').disabled = false;
    message('post-status', 'Browser check complete · ' + report.operations.OPTIONS +
      ' OPTIONS request(s). Use this capture as before or after to include the check.', 'good');
  } catch (error) {
    if (revision !== postRevision || source !== latestBytes) return;
    message('post-status', 'Browser check unavailable: ' + String(error.message).slice(0, 280), 'error');
  } finally {
    if (postAbort === controller) { postAbort = null; $('post-run').disabled = false; $('post-permission').checked = false; }
  }
});
$('download-post').addEventListener('click', () => {
  if (postBytes) download(postBytes, 'merchant-post-preflight.json');
});

function selectedSource(field) {
  const id = files.find(([key]) => key === field)[1];
  return $(id).files[0] || retained.get(field)?.file || null;
}
function clearSource(field) {
  const id = files.find(([key]) => key === field)[1];
  $(id).value = '';
  retained.delete(field);
}
function syncSources() {
  for (const [field] of files) {
    const file = selectedSource(field), memory = retained.get(field);
    $(field + '-selected').textContent = file
      ? file.name + ' · ' + Math.ceil(file.size / 1000) + ' KB' + (memory ? ' · captured ' + dateLabel(memory.observedAt) + ' · in this tab' : ' · saved file')
      : (field.startsWith('post') ? 'No browser check selected' : 'No capture selected');
    const button = document.querySelector('[data-clear-source="' + field + '"]');
    button.disabled = !file;
    document.querySelector('[data-save-source="' + field + '"]').disabled = !file;
    const id = files.find(([key]) => key === field)[1];
    $(id).closest('.source-slot')?.classList.toggle('is-selected', Boolean(file));
  }
  const before = selectedSource('before'), after = selectedSource('after');
  const baselineOnly = $('workorder-baseline-only').checked || !after;
  $('compare-run').disabled = !before || !after || Boolean(comparisonAbort);
  $('workorder-run').disabled = !before || termsImportPending || Boolean(workorderAbort);
  $('workorder-sources').textContent = !before ? 'Select a before capture in Review changes to get started.'
    : baselineOnly ? 'Baseline only · ' + before.name + '. No after capture or browser comparison will be included.'
    : 'Before: ' + before.name + ' → After: ' + after.name + '. The same selected browser checks are included when supplied.';
}
function invalidateComparison() {
  comparisonRevision++;
  comparisonAbort?.abort(); comparisonAbort = null;
  comparisonBytes = null;
  $('comparison-output').hidden = true;
  $('raw-comparison').textContent = '';
  $('download-comparison').disabled = true;
  message('compare-status', 'Choose Compare changes to review the selected captures.');
}
function invalidateWorkorder(text = 'Sources or terms changed. Create a new workorder to use these selections.') {
  workorderRevision++;
  workorderAbort?.abort(); workorderAbort = null;
  workorder = null;
  $('workorder-output').hidden = true;
  $('raw-workorder').textContent = '';
  for (const id of ['html', 'checklist', 'json']) $('download-workorder-' + id).disabled = true;
  message('workorder-status', text);
  syncSources();
}
function sourcesChanged() {
  invalidateComparison();
  invalidateWorkorder();
}
for (const [field, id] of files) $(id).addEventListener('change', () => {
  retained.delete(field);
  if (field === 'before') clearSource('postBefore');
  if (field === 'after') clearSource('postAfter');
  sourcesChanged();
});
for (const button of document.querySelectorAll('[data-clear-source]')) button.addEventListener('click', () => {
  const field = button.dataset.clearSource;
  clearSource(field);
  if (field === 'before') clearSource('postBefore');
  if (field === 'after') clearSource('postAfter');
  sourcesChanged();
});
for (const button of document.querySelectorAll('[data-save-source]')) button.addEventListener('click', () => {
  const source = selectedSource(button.dataset.saveSource);
  if (source) download(source, source.name);
});
function retainCurrent(side) {
  if (!latestBytes || $('use-' + side).disabled) return;
  clearSource(side);
  retained.set(side, {file: new File([latestBytes], 'merchant-' + side + '.json', {type: 'application/json'}),
    observedAt: latest.observedAt});
  const postSide = side === 'before' ? 'postBefore' : 'postAfter';
  clearSource(postSide);
  if (postBytes) retained.set(postSide, {file: new File([postBytes], 'merchant-' + side + '-browser.json', {type: 'application/json'}),
    observedAt: latest.observedAt});
  sourcesChanged();
  $('capture-selection-status').textContent = 'Selected as ' + side + (postBytes ? ' with its browser check' : '') +
    '. It stays selected while you capture the next diagnosis.';
}
$('use-before').addEventListener('click', () => retainCurrent('before'));
$('use-after').addEventListener('click', () => retainCurrent('after'));

async function encodedSelection(includeAfter = true) {
  const fields = includeAfter ? files : [files[0]];
  const selected = fields.map(([field]) => [field, selectedSource(field)]);
  if (!selected[0][1]) throw new Error('Select a before diagnosis');
  if (includeAfter && !selected[1][1]) throw new Error('Select an after diagnosis');
  if (includeAfter && Boolean(selected[2][1]) !== Boolean(selected[3][1]))
    throw new Error('Choose both browser checks or clear the unpaired check');
  return Object.fromEntries(await Promise.all(selected.filter(([, file]) => file)
    .map(async ([field, file]) => [field, await encodedFile(file)])));
}
function showComparison(report) {
  comparisonBytes = JSON.stringify(report, null, 2) + '\n';
  $('raw-comparison').textContent = comparisonBytes;
  $('comparison-outcome').textContent = titleFor(report.classification);
  $('comparison-summary').textContent = report.technicalMilestoneObserved
    ? 'The selected captures meet the unpaid technical milestone for this method. Review remaining findings and arrange owner review.'
    : 'The selected captures do not yet establish the technical milestone. Review the outstanding findings and missing coverage.';
  rows($('comparison-scope'), [
    ['Seller resource', report.scope.resource], ['Buyer operation', report.scope.intendedRetryMethod],
    ['Browser credentials', modeLabel(report.scope.browserCredentialed)],
    ['Before capture', dateLabel(report.source.before.observedAt)], ['After capture', dateLabel(report.source.after.observedAt)],
  ]);
  const changes = $('comparison-changes'); changes.replaceChildren();
  let populated = 0;
  for (const [key, label] of [
    ['notReobservedWithCompleteAfterCatalog', 'No longer observed · catalog complete'],
    ['notReobservedButAfterCatalogIncomplete', 'Not reobserved · coverage is incomplete'],
    ['notReobservedButCredentialModeUnknown', 'Not reobserved · credential policy is unconfirmed'],
    ['newlyObserved', 'New findings'], ['stillObserved', 'Still observed'], ['severityChanged', 'Changed severity'],
  ]) {
    const findings = report.changes[key] || [];
    if (!findings.length) continue;
    populated++;
    const section = line(changes, 'section', 'change-group', '');
    line(section, 'h3', '', label + ' (' + findings.length + ')');
    findingList(line(section, 'ul', 'findings', ''), findings, '');
  }
  if (!populated) line(changes, 'p', 'empty-note', 'No finding changes were recorded between these captures.');
  $('comparison-boundaries').textContent = 'This review describes unpaid technical observations. Source coverage, exact file hashes and all original limits are in Source details.';
  $('comparison-output').hidden = false;
  $('download-comparison').disabled = false;
}
$('compare-form').addEventListener('submit', async event => {
  event.preventDefault();
  invalidateComparison();
  const revision = comparisonRevision, controller = new AbortController();
  comparisonAbort = controller; syncSources();
  message('compare-status', 'Comparing the selected original captures…', 'busy');
  try {
    const payload = await encodedSelection();
    if (revision !== comparisonRevision) return;
    const data = await request('/api/compare', payload, controller.signal);
    if (revision !== comparisonRevision) return;
    if (data.report?.schema !== 'stellar-forge.merchant-repair-delta.v1') throw new Error('The original comparison was not returned');
    showComparison(data.report);
    message('compare-status', 'Comparison complete. These same sources are ready for the workorder below.', 'good');
  } catch (error) {
    if (revision !== comparisonRevision) return;
    message('compare-status', 'Comparison unavailable: ' + String(error.message).slice(0, 280), 'error');
  } finally {
    if (comparisonAbort === controller) { comparisonAbort = null; syncSources(); }
  }
});
$('download-comparison').addEventListener('click', () => {
  if (comparisonBytes) download(comparisonBytes, 'merchant-repair-comparison.json');
});

const termsEditor = mountTermsEditor($('terms-editor'), {onChange: () => {
  termsImportRevision++;
  termsImportPending = false;
  invalidateWorkorder('Owner terms changed. Create a new workorder when the terms are ready.');
}});
$('workorder-baseline-only').addEventListener('change', () => invalidateWorkorder());
$('terms-file').addEventListener('change', async () => {
  const revision = ++termsImportRevision;
  termsImportPending = true;
  invalidateWorkorder('Owner terms selection changed. Review the imported form before creating a workorder.');
  const file = $('terms-file').files[0];
  try {
    if (!file) { $('terms-file-status').textContent = 'No file selected. Existing form values are unchanged.'; return; }
    if (!file.size || file.size > 2_000_000) throw new Error('Choose a JSON file of 1 to 2,000,000 bytes');
    const bytes = await file.arrayBuffer();
    if (revision !== termsImportRevision) return;
    const terms = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes));
    termsEditor.load(terms);
    $('terms-file-status').textContent = 'Loaded ' + file.name + '. Review the owner’s fields before creating the workorder.';
  } catch (error) {
    if (revision !== termsImportRevision) return;
    $('terms-file-status').textContent = 'Import unavailable: ' + String(error.message).slice(0, 220) + '. Existing form values are unchanged.';
  } finally {
    // load() invokes onChange and retires this import; a newer import retains ownership of its pending state.
    if (revision === termsImportRevision) termsImportPending = false;
    syncSources();
  }
});
$('download-terms').addEventListener('click', () => {
  try { download(JSON.stringify(termsEditor.read(), null, 2) + '\n', 'merchant-owner-terms.json'); }
  catch (error) { $('terms-file-status').textContent = String(error.message).slice(0, 240); }
});
function showWorkorder(result) {
  workorder = result;
  const packet = result.packet;
  $('workorder-title').textContent = packet.readiness === 'READY_FOR_OWNER_TO_REVIEW_UNSENT_OFFER'
    ? 'Workorder ready for owner review' : 'Internal workorder prepared';
  $('workorder-summary').textContent = packet.seller.displayName + ' · ' + packet.workOrderRef +
    '. Download the readable workorder for review, and keep the checklist and JSON with your original captures.';
  const fee = packet.commercial.approvedFeeUsd;
  rows($('workorder-facts'), [
    ['Relationship owner', packet.seller.relationshipOwner], ['Seller route', packet.scope.resource],
    ['Capture review', packet.repairReview ? titleFor(packet.repairReview.classification) : 'Baseline only · repair not yet reviewed'],
    ['Seller permission', packet.seller.consentStatus === 'CONFIRMED' ? 'Existing record supplied' : 'Not recorded'],
    ['Approved proposal fee', fee === null ? 'Withheld · not approved' : new Intl.NumberFormat(undefined, {style: 'currency', currency: 'USD'}).format(fee)],
    ['Proposed delivery window', packet.commercial.proposedWindow === 'UNSCHEDULED' ? 'Not scheduled' : packet.commercial.proposedWindow],
  ]);
  $('raw-workorder').textContent = JSON.stringify(packet, null, 2) + '\n';
  $('workorder-output').hidden = false;
  for (const id of ['html', 'checklist', 'json']) $('download-workorder-' + id).disabled = false;
}
$('workorder-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (termsImportPending) return;
  invalidateWorkorder();
  const revision = workorderRevision, controller = new AbortController();
  workorderAbort = controller; syncSources();
  message('workorder-status', 'Preparing the workorder from your selected captures and owner terms…', 'busy');
  try {
    const terms = termsEditor.read();
    const includeAfter = !$('workorder-baseline-only').checked && Boolean(selectedSource('after'));
    const payload = await encodedSelection(includeAfter);
    payload.terms = encodeBytes(new TextEncoder().encode(JSON.stringify(terms) + '\n'));
    if (revision !== workorderRevision) return;
    const result = await request('/api/workorder', payload, controller.signal);
    if (revision !== workorderRevision) return;
    if (result.packet?.schema !== 'SCF-SF77/merchant-workorder-v1' ||
        typeof result.html !== 'string' || typeof result.checklist !== 'string') throw new Error('The original workorder was not returned');
    showWorkorder(result);
    message('workorder-status', 'Workorder prepared. Review and save the documents below; nothing has been sent.', 'good');
  } catch (error) {
    if (revision !== workorderRevision) return;
    message('workorder-status', 'Workorder unavailable: ' + String(error.message).slice(0, 280), 'error');
  } finally {
    if (workorderAbort === controller) { workorderAbort = null; syncSources(); }
  }
});
$('download-workorder-html').addEventListener('click', () => {
  if (workorder) download(workorder.html, 'merchant-workorder.html', 'text/html;charset=utf-8');
});
$('download-workorder-checklist').addEventListener('click', () => {
  if (workorder) download(workorder.checklist, 'merchant-handoff-checklist.md', 'text/markdown;charset=utf-8');
});
$('download-workorder-json').addEventListener('click', () => {
  if (workorder) download(JSON.stringify(workorder.packet, null, 2) + '\n', 'merchant-workorder.json');
});
syncSources();
