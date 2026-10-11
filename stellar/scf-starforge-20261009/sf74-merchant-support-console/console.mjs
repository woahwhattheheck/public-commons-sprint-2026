// MIT. Merchant browser support console, no external dependencies, no credential storage.
const $ = id => document.getElementById(id);
const form = $('intake-form');
const status = $('status');
const output = $('output');
const actionList = $('actions');
const raw = $('raw-report');
let latest = null;
let latestBytes = null;

const line = (parent, tag, klass, text) => {
  const el = document.createElement(tag);
  if (klass) el.className = klass;
  el.textContent = String(text ?? '');
  parent.append(el);
  return el;
};
function show(report) {
  latest = report;
  latestBytes = JSON.stringify(report, null, 2) + '\n';
  output.hidden = false;
  raw.textContent = latestBytes;
  $('copy').disabled = false;
  $('copy').textContent = 'Copy original JSON';
  $('download-intake').disabled = false;
  $('outcome').textContent = report.state || 'ORIGINAL_STATE_UNKNOWN';
  $('observed').textContent = report.observedAt || 'Unknown observation time';
  $('source-note').textContent = 'Source: original SF70 merchant intake, ' +
    String(report?.schema || 'schema unknown') + '. Original nested evidence is preserved in the complete JSON below.';
  actionList.replaceChildren();
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (findings.length === 0) {
    line(actionList, 'li', '', 'No original SF70 findings. This does not confirm a paid checkout, merchant sale, or Stellar settlement.');
  }
  for (const item of findings) {
    const li = document.createElement('li');
    line(li, 'strong', 'severity '+(item.severity === 'HIGH' ? 'high' : 'unknown'),
      String(item.severity || 'UNKNOWN') + ' · ' + String(item.code || 'UNSPECIFIED'));
    line(li, 'p', '', item.action || 'Consult the original source evidence.');
    actionList.append(li);
  }
  $('scope').replaceChildren();
  const scope = report.scope || {};
  for (const [label, field] of [
    ['Seller resource', 'resource'], ['Facilitator catalog', 'catalog'],
    ['Browser origin', 'buyerOrigin'], ['Stellar network', 'network'],
    ['Seller recipient', 'payTo'], ['Intended operation', 'intendedRetryMethod'],
  ]) {
    const row = line($('scope'), 'div', 'scope-row', '');
    line(row, 'b', '', label);
    line(row, 'span', '', String(scope[field] || 'Not returned'));
  }
  const credentialRow = line($('scope'), 'div', 'scope-row', '');
  line(credentialRow, 'b', '', 'Browser credentials');
  line(credentialRow, 'span', '', scope.browserCredentialed === true ? 'Required' : scope.browserCredentialed === false ? 'Not required' : 'Unknown');
  const safe = report.safeguards || {};
  $('safeguards').textContent = `Original report: ${safe.paidRequests ?? '?'} paid request(s), ${safe.walletCalls ?? '?'} wallet call(s), settlement confirmed ${safe.settlementConfirmed === true ? 'yes' : 'no'}. This is an unpaid merchant diagnosis.`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('run');
  submit.disabled = true;
  $('copy').disabled = true;
  $('download-intake').disabled = true;
  latest = null;
  latestBytes = null;
  output.hidden = true;
  status.textContent = 'Running exact original SF70 unpaid probes and catalog pagination. No payments are made.';
  status.className = 'status busy';
  const fields = Object.fromEntries(new FormData(form).entries());
  const payload = {
    resource: fields.resource, catalog: fields.catalog, origin: fields.origin,
    network: fields.network, payTo: fields.payTo, method: fields.method,
    permission: $('permission').checked,
    credentialed: $('credentialed').checked,
  };
  try {
    const response = await fetch('/api/intake', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: {'content-type': 'application/json'}, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data.error || 'INTAKE_ERROR') + ': ' + (data.detail || response.status));
    if (!data.report || typeof data.report !== 'object') throw new Error('Original report was not returned');
    show(data.report);
    status.textContent = 'Original intake completed. Review original findings and terms before proposing any paid work.';
    status.className = 'status good';
  } catch (error) {
    status.textContent = 'Intake unavailable: ' + String(error.message).slice(0, 280) + '. No completion or paid checkout is claimed.';
    status.className = 'status error';
  } finally {submit.disabled = false;}
});
$('copy').addEventListener('click', async () => {
  if (!latest) return;
  try {
    await navigator.clipboard.writeText(latestBytes);
    $('copy').textContent = 'Original JSON copied';
  } catch { $('copy').textContent = 'Copy unavailable; select original JSON below'; }
});

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download-intake').addEventListener('click', () => {
  if (latestBytes) download(latestBytes, 'merchant-intake.json');
});

const compareForm = $('compare-form');
const compareStatus = $('compare-status');
const comparisonOutput = $('comparison-output');
const files = [
  ['before', 'before-source'], ['after', 'after-source'],
  ['postBefore', 'post-before-source'], ['postAfter', 'post-after-source'],
];
let comparisonBytes = null, comparisonRevision = 0, comparisonAbort = null;
function clearComparison() {
  comparisonBytes = null;
  comparisonOutput.hidden = true;
  $('download-comparison').disabled = true;
}
compareForm.addEventListener('change', () => {
  comparisonRevision++;
  comparisonAbort?.abort();
  clearComparison();
  compareStatus.textContent = 'Files changed. Compare these captures to see their result.';
  compareStatus.className = 'status';
});
async function encodedFile(file) {
  if (!file || !file.size || file.size > 2_000_000)
    throw new Error('Each source must contain 1..2,000,000 bytes');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function showComparison(report) {
  comparisonBytes = JSON.stringify(report, null, 2) + '\n';
  $('raw-comparison').textContent = comparisonBytes;
  $('comparison-outcome').textContent = report.classification;
  $('comparison-summary').textContent = report.technicalMilestoneObserved
    ? 'The original comparator observed the method-specific unpaid technical milestone. Review the remaining limits before accepting the repair.'
    : 'The original comparator has not established the technical milestone. Review remaining findings and source coverage.';
  $('comparison-scope').replaceChildren();
  for (const [label, value] of [
    ['Seller resource', report.scope.resource], ['Operation', report.scope.intendedRetryMethod],
    ['Browser credentials', report.scope.browserCredentialed === true ? 'Required' : report.scope.browserCredentialed === false ? 'Not required' : 'Unknown'],
    ['Before capture', report.source.before.observedAt], ['After capture', report.source.after.observedAt],
    ['Before file SHA-256', report.source.before.sha256], ['After file SHA-256', report.source.after.sha256],
  ]) {
    const row = line($('comparison-scope'), 'div', 'scope-row', '');
    line(row, 'b', '', label); line(row, 'span', '', value);
  }
  const changes = $('comparison-changes');
  changes.replaceChildren();
  for (const [key, label] of [
    ['notReobservedWithCompleteAfterCatalog', 'No longer observed · after catalog complete'],
    ['notReobservedButAfterCatalogIncomplete', 'Not reobserved · after coverage incomplete'],
    ['notReobservedButCredentialModeUnknown', 'Not reobserved · browser credential mode unknown'],
    ['newlyObserved', 'New findings'], ['stillObserved', 'Still observed'],
    ['severityChanged', 'Changed severity'],
  ]) {
    const findings = report.changes[key] || [];
    line(changes, 'h3', '', label + ' (' + findings.length + ')');
    const list = line(changes, 'ul', 'findings', '');
    if (!findings.length) line(list, 'li', '', 'None reported.');
    for (const finding of findings) {
      const item = line(list, 'li', '', '');
      line(item, 'strong', '', finding.severity + ' · ' + finding.code);
      line(item, 'p', '', finding.action);
    }
  }
  $('comparison-boundaries').textContent = report.boundaries.note;
  comparisonOutput.hidden = false;
  $('download-comparison').disabled = false;
}
compareForm.addEventListener('submit', async event => {
  event.preventDefault();
  comparisonAbort?.abort();
  const revision = ++comparisonRevision;
  const controller = new AbortController();
  comparisonAbort = controller;
  const button = $('compare-run');
  button.disabled = true;
  clearComparison();
  compareStatus.textContent = 'Reading selected files and comparing their original observations locally…';
  compareStatus.className = 'status busy';
  try {
    const selected = files.map(([field, id]) => [field, $(id).files[0]]);
    if (!selected[0][1] || !selected[1][1]) throw new Error('Choose both SF70 captures');
    if (Boolean(selected[2][1]) !== Boolean(selected[3][1])) throw new Error('Choose both SF72 reports or neither');
    const entries = await Promise.all(selected.filter(([, file]) => file).map(async ([field, file]) => [field, await encodedFile(file)]));
    if (revision !== comparisonRevision) return;
    const response = await fetch('/api/compare', {
      method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: {'content-type': 'application/json'}, body: JSON.stringify(Object.fromEntries(entries)),
    });
    const data = await response.json();
    if (revision !== comparisonRevision) return;
    if (!response.ok) throw new Error(data.detail || data.error || 'Comparison unavailable');
    if (data.report?.schema !== 'stellar-forge.merchant-repair-delta.v1') throw new Error('Original comparison was not returned');
    showComparison(data.report);
    compareStatus.textContent = 'Comparison complete. File hashes identify the exact uploaded captures; no network diagnosis or payment was performed.';
    compareStatus.className = 'status good';
  } catch (error) {
    if (revision !== comparisonRevision) return;
    compareStatus.textContent = 'Comparison unavailable: ' + String(error.message).slice(0, 280);
    compareStatus.className = 'status error';
  } finally {
    // Only this submission owns the button; changing files invalidates its result.
    if (comparisonAbort === controller) { comparisonAbort = null; button.disabled = false; }
  }
});
$('download-comparison').addEventListener('click', () => {
  if (comparisonBytes) download(comparisonBytes, 'merchant-repair-comparison.json');
});
