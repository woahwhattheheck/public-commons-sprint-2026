// MIT. Merchant browser support console, no external dependencies, no credential storage.
const $ = id => document.getElementById(id);
const form = $('intake-form');
const status = $('status');
const output = $('output');
const actionList = $('actions');
const raw = $('raw-report');
let latest = null;

const line = (parent, tag, klass, text) => {
  const el = document.createElement(tag);
  if (klass) el.className = klass;
  el.textContent = String(text ?? '');
  parent.append(el);
  return el;
};
function show(report) {
  latest = report;
  output.hidden = false;
  raw.textContent = JSON.stringify(report, null, 2);
  $('copy').disabled = false;
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
  const safe = report.safeguards || {};
  $('safeguards').textContent = `Original report: ${safe.paidRequests ?? '?'} paid request(s), ${safe.walletCalls ?? '?'} wallet call(s), settlement confirmed ${safe.settlementConfirmed === true ? 'yes' : 'no'}. This is an unpaid merchant diagnosis.`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('run');
  submit.disabled = true;
  $('copy').disabled = true;
  latest = null;
  output.hidden = true;
  status.textContent = 'Running exact original SF70 unpaid probes and catalog pagination. No payments are made.';
  status.className = 'status busy';
  const fields = Object.fromEntries(new FormData(form).entries());
  const payload = {
    resource: fields.resource, catalog: fields.catalog, origin: fields.origin,
    network: fields.network, payTo: fields.payTo, method: fields.method,
    permission: $('permission').checked,
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
    await navigator.clipboard.writeText(JSON.stringify(latest, null, 2));
    $('copy').textContent = 'Original JSON copied';
  } catch { $('copy').textContent = 'Copy unavailable; select original JSON below'; }
});
