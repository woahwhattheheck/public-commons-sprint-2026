// MIT. The browser calls the original private workspace controller only.
const $ = id => document.getElementById(id);
const encoded = location.hash.slice(1);
let token = encoded || sessionStorage.getItem('tenderly-workspace-token');
if (encoded) {
  sessionStorage.setItem('tenderly-workspace-token', encoded);
  history.replaceState(null, '', location.pathname);
}
let template, selected = null, selectedRequest = null, selectedOperation = null;
let runtime = { state: 'CLOSED', profile: null }, profilesNext = null, requestsNext = null, operationsNext = null, auditNext = null;
let busy = false;
const pretty = value => JSON.stringify(value, null, 2);
const text = (id, value) => { $(id).textContent = String(value ?? '—'); };
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== '')).toString();
const integer = (id, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = $(id).value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum || Number(value) > maximum) throw new Error('Enter a valid whole number for ' + $(id).closest('label').childNodes[0].textContent.trim());
  return Number(value);
};
function notice(message, error = false) {
  text('notice', message); $('notice').dataset.error = String(error);
}
async function api(path, value) {
  const response = await fetch('/api/' + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Workspace request failed');
  return data;
}
async function download(kind, id) {
  if (!selected) throw new Error('Choose a saved profile');
  const response = await fetch('/api/download?' + query({ profile: selected.id, kind, id }), {
    headers: { authorization: 'Bearer ' + token }, cache: 'no-store',
  });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Download failed'); }
  const objectUrl = URL.createObjectURL(await response.blob()), anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = kind === 'plan' ? 'plan.json' : kind === 'request' ? 'tenderly-request.json' : 'response.json';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
function controls() {
  $('open-profile').disabled = busy || !selected;
  $('download-plan').disabled = busy || !selected;
  $('start-merchant').disabled = busy || !selected || runtime.profile !== selected.id || runtime.state !== 'OPEN';
  $('stop-merchant').disabled = busy || runtime.state !== 'RUNNING';
  $('download-request').disabled = busy || !selectedRequest;
  $('download-response').disabled = busy || selectedOperation?.state !== 'COMPLETE';
  $('apply-recovery').disabled = busy || !['UNCERTAIN', 'IN_FLIGHT'].includes(selectedOperation?.state);
}
async function run(operation, success) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button')].map(button => [button, button.disabled]);
  buttons.forEach(([button]) => { button.disabled = true; }); controls();
  try { await operation(); if (success) notice(success); }
  catch (error) { notice(error.message, true); }
  finally { busy = false; buttons.forEach(([button, disabled]) => { button.disabled = disabled; }); controls(); }
}
function values(plan) {
  $('service-name').value = plan.serviceName; $('public-origin').value = plan.publicOrigin;
  $('route-path').value = plan.routePath; $('provider-account').value = plan.provider.account;
  $('provider-project').value = plan.provider.project; $('network-id').value = plan.networkId;
  $('simulation-type').value = plan.simulationType; $('access-key-env').value = plan.provider.accessKeyEnv;
  $('operation-key-env').value = plan.operations.keyEnv; $('payment-network').value = plan.payment.network;
  $('payment-asset').value = plan.payment.asset; $('payment-recipient').value = plan.payment.payTo;
  $('payment-amount').value = plan.payment.amount;
  $('advanced-plan').value = pretty({ operations: plan.operations, limits: plan.limits,
    paymentTimeoutSeconds: plan.payment.maxTimeoutSeconds, ...(plan.payment.extra ? { paymentExtra: plan.payment.extra } : {}) });
  $('request-minutes').value = String(Math.max(1, Math.min(60, Math.floor(plan.operations.maxTicketSeconds / 60))));
}
function formPlan() {
  let advanced;
  try { advanced = JSON.parse($('advanced-plan').value); } catch { throw new Error('Operation settings must be valid JSON'); }
  if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced) ||
      Object.keys(advanced).some(key => !['operations', 'limits', 'paymentTimeoutSeconds', 'paymentExtra'].includes(key)))
    throw new Error('Use the original operation and limit settings');
  return { schema: template.schema, serviceName: $('service-name').value.trim(),
    publicOrigin: $('public-origin').value.trim(), routePath: $('route-path').value.trim(),
    provider: { account: $('provider-account').value.trim(), project: $('provider-project').value.trim(),
      accessKeyEnv: $('access-key-env').value.trim() },
    networkId: $('network-id').value.trim(), simulationType: $('simulation-type').value,
    payment: { scheme: 'exact', network: $('payment-network').value.trim(), asset: $('payment-asset').value.trim(),
      payTo: $('payment-recipient').value.trim(), amount: $('payment-amount').value.trim(),
      maxTimeoutSeconds: advanced.paymentTimeoutSeconds,
      ...(advanced.paymentExtra ? { extra: advanced.paymentExtra } : {}) },
    operations: { ...advanced.operations, keyEnv: $('operation-key-env').value.trim() }, limits: advanced.limits };
}
function clearSelection() {
  selectedRequest = null; selectedOperation = null; requestsNext = null; operationsNext = null; auditNext = null;
  for (const id of ['request-list', 'operation-list', 'result-summary', 'operation-audit', 'operation-totals']) $(id).replaceChildren();
  text('request-detail', 'No request selected.'); text('selected-operation', 'Select an operation above.');
  text('result-preview', 'The complete original response is available as a download.');
  for (const id of ['more-requests', 'more-operations', 'more-audit']) $(id).hidden = true;
  controls();
}
function fillProfile(profile) {
  selected = profile; clearSelection(); values(profile.plan);
  $('profile-label').value = profile.label;
  text('selected-name', profile.label); text('profile-version', profile.id.slice(0, 14));
  $('profile-review').hidden = true;
  for (const row of $('profile-list').querySelectorAll('[data-profile]')) row.classList.toggle('active', row.dataset.profile === profile.id);
  controls();
}
function record(title, details, operation) {
  const element = document.createElement(operation ? 'button' : 'div'); element.className = 'record';
  if (operation) { element.type = 'button'; element.addEventListener('click', () => run(operation)); }
  const heading = document.createElement('strong'); heading.textContent = title; element.append(heading);
  const line = document.createElement('span'); line.className = 'subdued'; line.textContent = details; element.append(line);
  return element;
}
function pairs(element, entries) {
  element.replaceChildren();
  for (const [name, value] of entries) {
    const key = document.createElement('dt'), data = document.createElement('dd');
    key.textContent = name; data.textContent = typeof value === 'object' ? pretty(value) : String(value ?? '—');
    element.append(key, data);
  }
}
function showReview(review) {
  const panel = $('profile-review'), heading = document.createElement('h3'), list = document.createElement('dl');
  panel.replaceChildren(); heading.textContent = 'Saved simulation terms'; list.className = 'key-values';
  pairs(list, [['Merchant', review.serviceName], ['Public request', review.route.method + ' ' + review.route.url],
    ['Provider project', review.provider.account + ' / ' + review.provider.project],
    ['EVM state', 'Network ' + review.networkId + ', explicit block and transaction index'],
    ['Output', review.simulationType], ['Payment', review.payment.network],
    ['Atomic price', review.payment.amount], ['Asset', review.payment.asset], ['Recipient', review.payment.payTo],
    ['Required environment', review.requiredEnvironment.join(', ')], ['Plan SHA-256', review.planSha256]]);
  panel.append(heading, list); panel.hidden = false;
}
async function loadProfiles(append = false) {
  const page = await api('profiles?' + query({ before: append ? profilesNext : '', limit: 25 }));
  if (!append) $('profile-list').replaceChildren();
  for (const profile of page.records) {
    const item = record(profile.label || profile.id, profile.status === 'SAVED' ?
      profile.serviceName + ' · EVM ' + profile.networkId + ' · ' + profile.createdAt : profile.error,
    profile.status === 'SAVED' ? async () => fillProfile(await api('profile?' + query({ profile: profile.id }))) : null);
    item.dataset.profile = profile.id; item.classList.toggle('active', selected?.id === profile.id);
    $('profile-list').append(item);
  }
  profilesNext = page.nextCursor; $('more-profiles').hidden = !profilesNext;
  if (!$('profile-list').childElementCount) $('profile-list').append(record('No saved profiles', 'Complete the merchant form to save the first version.'));
}
async function refreshStatus() {
  runtime = await api('status'); text('runtime-state', runtime.state);
  const holder = $('merchant-address'); holder.replaceChildren();
  if (runtime.merchant?.url) {
    const anchor = document.createElement('a'); anchor.href = runtime.merchant.url;
    anchor.textContent = runtime.merchant.url + ' · ' + runtime.merchant.mode; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; holder.append(anchor);
  } else holder.textContent = runtime.profile ? 'Profile open' : 'Closed';
  controls();
}
const selectedId = () => { if (!selected) throw new Error('Choose a saved merchant profile'); return selected.id; };
function requestBody() {
  return { block_number: integer('block-number'), transaction_index: integer('transaction-index'),
    from: $('request-from').value.trim(), to: $('request-to').value.trim(), input: $('request-input').value.trim(),
    gas: integer('request-gas', 1), value: $('request-value').value.trim() };
}
function setRequest(body) {
  for (const [field, id] of Object.entries({ block_number: 'block-number', transaction_index: 'transaction-index',
    from: 'request-from', to: 'request-to', input: 'request-input', gas: 'request-gas', value: 'request-value' }))
    $(id).value = body[field] ?? '';
}
async function loadRequests(append = false) {
  const page = await api('requests?' + query({ profile: selectedId(), before: append ? requestsNext : '', limit: 25 }));
  if (!append) $('request-list').replaceChildren();
  for (const row of page.records) $('request-list').append(record(row.operationKey.slice(0, 20), row.createdAt, async () => {
    selectedRequest = await api('request?' + query({ id: row.id }));
    setRequest(selectedRequest.packet.body);
    text('request-detail', pretty(selectedRequest.packet)); controls();
  }));
  requestsNext = page.nextCursor; $('more-requests').hidden = !requestsNext;
  if (!$('request-list').childElementCount) $('request-list').append(record('No issued requests', 'Open the profile and issue its first operation ticket.'));
}
async function loadOperations(append = false) {
  const page = await api('operations?' + query({ profile: selectedId(), state: $('state-filter').value,
    cursor: append ? operationsNext : '', limit: 25 }));
  if (!append) $('operation-list').replaceChildren();
  $('operation-totals').replaceChildren();
  for (const [state, count] of Object.entries(page.totals)) {
    const item = document.createElement('span'); item.textContent = state + ' ' + count; $('operation-totals').append(item);
  }
  for (const operation of page.records) {
    const row = document.createElement('tr'), cell = document.createElement('td'), button = document.createElement('button');
    row.dataset.operation = operation.operationKey; button.type = 'button';
    button.textContent = operation.operationKey.slice(0, 18) + '…'; button.title = operation.operationKey;
    button.addEventListener('click', () => run(() => showOperation(operation.operationKey))); cell.append(button); row.append(cell);
    for (const value of [operation.state, operation.attempt, operation.generation, operation.bodyBytes + ' bytes', new Date(operation.updatedAt).toLocaleString()]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    $('operation-list').append(row);
  }
  operationsNext = page.nextCursor; $('more-operations').hidden = !operationsNext;
}
async function loadAudit(append = false) {
  if (!selectedOperation) return;
  const page = await api('audit?' + query({ profile: selectedId(), operationKey: selectedOperation.operationKey, after: append ? auditNext : 0, limit: 25 }));
  if (!append) $('operation-audit').replaceChildren();
  for (const entry of page?.events ?? []) $('operation-audit').append(record(
    entry.state + ' · generation ' + entry.generation, new Date(entry.at).toLocaleString() + (entry.reference ? ' · ' + entry.reference : '')));
  auditNext = page?.nextAfter; $('more-audit').hidden = !auditNext;
}
async function showOperation(operationKey) {
  selectedOperation = await api('operation?' + query({ profile: selectedId(), operationKey }));
  if (!selectedOperation) throw new Error('This operation is no longer available');
  for (const row of $('operation-list').children) row.classList.toggle('selected', row.dataset.operation === operationKey);
  text('selected-operation', operationKey);
  pairs($('result-summary'), Object.entries(selectedOperation));
  text('result-preview', selectedOperation.state === 'COMPLETE' ? 'Reading saved response…' : 'Current operation state: ' + selectedOperation.state);
  if (selectedOperation.state === 'COMPLETE') {
    const result = await api('response?' + query({ profile: selectedId(), operationKey }));
    pairs($('result-summary'), [['HTTP status', result.status], ['Bytes', result.bytes], ['SHA-256', result.sha256], ...Object.entries(result.summary ?? {})]);
    text('result-preview', result.preview + (result.previewTruncated ? '\n\nPreview ends here. Download the complete response above.' : ''));
  }
  text('recovery-selection', 'Selected ' + selectedOperation.state + ' operation, generation ' + selectedOperation.generation);
  await loadAudit(); controls();
}
function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
async function readJsonFile(input) {
  const file = input.files?.[0];
  if (!file || file.size > 1024 * 1024) throw new Error('Select a JSON file up to 1 MiB');
  try { return JSON.parse(await file.text()); } catch { throw new Error('The selected file is not valid JSON'); }
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('[data-tab]')) item.removeAttribute('aria-current');
  button.setAttribute('aria-current', 'page');
  for (const panel of document.querySelectorAll('.tab')) panel.hidden = panel.id !== 'tab-' + button.dataset.tab;
});
$('refresh').addEventListener('click', () => run(async () => { await refreshStatus(); await loadProfiles(); }, 'Workspace refreshed.'));
$('new-profile').addEventListener('click', () => {
  selected = null; clearSelection(); values(template); $('profile-label').value = '';
  text('selected-name', 'New merchant profile'); text('profile-version', ''); $('profile-review').hidden = true; controls();
});
$('profile-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const saved = await api('profiles', { plan: formPlan(), label: $('profile-label').value });
    fillProfile(saved); await loadProfiles(); showReview(saved.review);
  }, 'Merchant profile saved. Its exact plan is ready to prepare and open.');
});
$('review-profile').addEventListener('click', () => run(async () => showReview(await api('review', { plan: formPlan() })), 'Merchant terms reviewed.'));
$('import-plan').addEventListener('change', () => run(async () => {
  const plan = await readJsonFile($('import-plan')); const review = await api('review', { plan });
  selected = null; clearSelection(); values(review.plan); $('profile-label').value = review.serviceName;
  text('selected-name', 'Imported plan · save to retain'); showReview(review);
}, 'Plan imported and reviewed.'));
$('more-profiles').addEventListener('click', () => run(() => loadProfiles(true)));
$('download-plan').addEventListener('click', () => run(() => download('plan')));
$('open-profile').addEventListener('click', () => run(async () => {
  const prepared = await api('prepare', { profile: selectedId() });
  text('prepared-output', 'Original package: ' + prepared.directory);
  runtime = await api('open', { profile: selectedId() }); await refreshStatus(); await loadRequests();
}, 'Saved profile and original operation history opened.'));
$('start-merchant').addEventListener('click', () => run(async () => {
  await api('start', { profile: selectedId(), port: integer('seller-port', 0, 65535), operationsPort: integer('operations-port', 0, 65535) });
  await refreshStatus();
}, 'Merchant started with the selected saved profile.'));
$('stop-merchant').addEventListener('click', () => run(async () => {
  await api('stop', { profile: runtime.profile }); await refreshStatus();
}, 'Merchant drained and stopped. Saved operations remain open.'));
$('request-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const minutes = integer('request-minutes', 1);
    selectedRequest = await api('issue', { profile: selectedId(), body: requestBody(),
      id: $('operation-id').value.trim(), subject: $('request-subject').value.trim(), expiresAt: Date.now() + minutes * 60000 });
    text('request-detail', pretty(selectedRequest.packet)); await loadRequests();
  }, 'Original operation ticket issued and retained.');
});
$('import-request').addEventListener('change', () => run(async () => {
  const source = await readJsonFile($('import-request')); setRequest(source.body ?? source);
}, 'Transaction loaded. Review its pinned state and customer identity before issuing.'));
$('reload-requests').addEventListener('click', () => run(() => loadRequests()));
$('more-requests').addEventListener('click', () => run(() => loadRequests(true)));
$('download-request').addEventListener('click', () => run(() => download('request', selectedRequest.id)));
$('reload-operations').addEventListener('click', () => run(() => loadOperations()));
$('state-filter').addEventListener('change', () => run(() => loadOperations()));
$('more-operations').addEventListener('click', () => run(() => loadOperations(true)));
$('more-audit').addEventListener('click', () => run(() => loadAudit(true)));
$('download-response').addEventListener('click', () => run(() => download('response', selectedOperation.operationKey)));
$('recovery-action').addEventListener('change', () => { $('recovery-response-fields').hidden = $('recovery-action').value !== 'complete'; });
$('recovery-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    if (!selectedOperation) throw new Error('Select the original operation');
    const input = { profile: selectedId(), operationKey: selectedOperation.operationKey,
      expectedGeneration: selectedOperation.generation, requestHash: selectedOperation.requestHash,
      action: $('recovery-action').value, reference: $('recovery-reference').value.trim() };
    if (input.action === 'complete') {
      const file = $('recovery-file').files?.[0];
      if (!file || file.size > selected.plan.limits.maxResponseBytes) throw new Error('Select the complete original response within the saved size limit');
      input.response = { status: integer('recovery-status', 200, 299),
        headers: { 'content-type': 'application/json' }, bodyBase64: base64(new Uint8Array(await file.arrayBuffer())) };
    }
    await api('recover', input); await loadOperations(); await showOperation(input.operationKey);
  }, 'Provider outcome recorded against the original operation generation.');
});

run(async () => {
  if (!token) throw new Error('Open the complete private workspace URL printed by its launch command');
  const initial = await api('bootstrap'); template = initial.template; values(template);
  text('workspace-path', initial.directory);
  await loadProfiles(); await refreshStatus();
  if (initial.initialProfile) fillProfile(initial.initialProfile);
}, 'Choose a saved profile or complete the merchant plan to begin.');
