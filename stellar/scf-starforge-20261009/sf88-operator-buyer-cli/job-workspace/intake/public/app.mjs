// MIT. Merchant inputs → retained private request → original customer checkout.
const byId = id => document.getElementById(id);
const SESSION = 'sf88-paid-job-customer-session';
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem(SESSION, token); history.replaceState(null, '', location.pathname + location.search); }
else token = sessionStorage.getItem(SESSION) ?? '';
const prefix = '/api/job-intake';
let catalog = null, definition = null, selected = null, epoch = 0, rows = [], offset = 0, total = 0;
let pending = false, refreshing = false, disposed = false, timer;
const controls = new Map();
const requested = new URL(location.href).searchParams.get('request');
let requestedId = /^[a-f0-9]{64}$/.test(requested ?? '') ? requested : null;
const endpoint = (id, action = '') => prefix + '/requests/' + id + (action ? '/' + action : '');
const words = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
function message(value, error = false) { byId('message').textContent = value; byId('message').dataset.error = String(error); }
function problem(error) {
  const explanations = {
    JOB_INTAKE_CATALOG_CHANGED: 'The merchant catalog changed. Load its current functions and save a new request reference.',
    JOB_INTAKE_REFERENCE_EXISTS: 'That reference already identifies different saved inputs. Open the saved request or start another request.',
    JOB_INTAKE_REFERENCE_LABEL_CHANGED: 'This reference has a different merchant label. Open its original saved request.',
    JOB_INTAKE_ACCESS_DENIED: 'The merchant rejected the intake access token. Update it on this saved request and prepare again.',
    JOB_INTAKE_ACCESS_TOKEN_REQUIRED: 'Enter the merchant intake access token, then continue the same request.',
    JOB_INTAKE_REVISION_CONFLICT: 'The saved request changed. Refresh its details before continuing.',
    JOB_CHECKOUT_OPERATOR_REQUIRED: 'The ticket is saved. Reopen this workspace with its operator workspace or profile, then open the retained ticket in Checkout.',
    JOB_CHECKOUT_PREPARED_TICKET_REQUIRED: 'This merchant job has already advanced. Open the original checkout associated with its saved ticket.',
    JOB_WITHDRAWAL_NOT_AVAILABLE: 'The original merchant has already submitted this job. Continue its checkout or result.',
    JOB_INPUT_INVALID: 'The merchant rejected these inputs against its configured schema. Review the displayed fields and prepare a new request.',
    JOB_QUEUE_FULL: 'The merchant queue is full. The saved request can be prepared again when capacity returns.',
    JOB_INTAKE_PROCESS_REOPENED: 'This workspace reopened. Continue the saved request to recover its original ticket.',
    JOB_INTAKE_OPERATION_CANCELLED: 'The local request stopped. Its saved reference and claim remain available for recovery.',
    JOB_INTAKE_PAYMENT_REQUESTED: 'The configured intake endpoint returned a payment challenge. Check the merchant origin.',
  };
  message(explanations[error?.code] ?? words(error?.code ?? error?.message ?? 'REQUEST_FAILED'), true);
}
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, { method, credentials: 'omit',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? 'REQUEST_FAILED'), { code: value.error ?? 'REQUEST_FAILED' });
  return value;
}
function node(tag, content, className) {
  const value = document.createElement(tag);
  if (content !== undefined) value.textContent = content;
  if (className) value.className = className;
  return value;
}
function date(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—'; }
function size(value) { return value < 1024 * 1024 ? Math.ceil(value / 1024) + ' KiB' : (value / (1024 * 1024)).toFixed(1) + ' MiB'; }
for (const [id, path] of [['requestLink','/jobs/request/'],['checkoutLink','/jobs/checkout/'],
  ['jobsLink','/jobs/'],['libraryLink','/'],['collectionsLink','/collections']])
  byId(id).href = path + '#' + token;

function renderFields(input) {
  controls.clear(); byId('fields').replaceChildren();
  const required = new Set(definition.inputSchema.required ?? []);
  for (const [name, schema] of Object.entries(definition.inputSchema.properties)) {
    const field = node('div', undefined, 'schema-field'), heading = node('div', undefined, 'field-heading');
    const label = node('label', name + (required.has(name) ? ' *' : ''));
    const includeLabel = node('label', undefined, 'include'), include = node('input');
    include.type = 'checkbox'; include.checked = required.has(name) || Object.hasOwn(input, name);
    include.disabled = required.has(name); include.setAttribute('aria-label', 'Include ' + name);
    includeLabel.append(include, node('span', required.has(name) ? 'Required' : 'Include'));
    heading.append(label, includeLabel);
    const present = Object.hasOwn(input, name), value = present ? input[name] :
      schema.default ?? (schema.type === 'boolean' ? false : schema.type === 'object' ? {} : schema.type === 'array' ? [] : '');
    let control, type = schema.type;
    if (Array.isArray(schema.enum)) {
      type = 'enum'; control = node('select');
      schema.enum.forEach((option, index) => {
        const item = node('option', typeof option === 'string' ? option : JSON.stringify(option));
        item.value = String(index); control.append(item);
      });
      const selectedIndex = schema.enum.findIndex(option => JSON.stringify(option) === JSON.stringify(value));
      control.value = String(Math.max(0, selectedIndex));
    } else if (type === 'boolean') {
      control = node('input'); control.type = 'checkbox'; control.checked = Boolean(value);
    } else if (type === 'string') {
      control = node(schema.maxLength > 500 || String(value).includes('\n') ? 'textarea' : 'input');
      if (control.tagName === 'INPUT') control.type = 'text'; else control.rows = 4;
      control.value = typeof value === 'string' ? value : '';
      if (Number.isSafeInteger(schema.maxLength)) control.maxLength = schema.maxLength;
      if (Number.isSafeInteger(schema.minLength)) control.minLength = schema.minLength;
    } else if (type === 'number' || type === 'integer') {
      control = node('input'); control.type = 'number'; control.value = value === '' ? '' : String(value);
      control.step = schema.multipleOf ?? (type === 'integer' ? '1' : 'any');
      if (typeof schema.minimum === 'number') control.min = schema.minimum;
      if (typeof schema.maximum === 'number') control.max = schema.maximum;
    } else {
      type = 'json'; control = node('textarea'); control.rows = 5;
      control.value = JSON.stringify(value === '' ? null : value, null, 2);
      control.spellcheck = false;
    }
    const id = 'field-' + controls.size; control.id = id; label.htmlFor = id;
    control.disabled = !include.checked;
    const holder = node('div', undefined, 'field-control' + (type === 'boolean' ? ' boolean' : ''));
    holder.append(control); if (type === 'boolean') holder.append(node('span', 'Enabled'));
    include.addEventListener('change', () => { control.disabled = !include.checked; syncJson(); });
    control.addEventListener('input', syncJson); control.addEventListener('change', syncJson);
    field.append(heading, holder);
    const hints = [];
    if (schema.description) hints.push(String(schema.description));
    for (const [key, label] of [['minLength','Minimum characters'],['maxLength','Maximum characters'],
      ['minimum','Minimum'],['maximum','Maximum'],['minItems','Minimum items'],['maxItems','Maximum items']])
      if (schema[key] !== undefined) hints.push(label + ': ' + schema[key]);
    if (schema.pattern) hints.push('Pattern: ' + schema.pattern);
    if (type === 'json') hints.push('Enter JSON for this field.');
    if (hints.length) field.append(node('p', hints.join(' · '), 'hint'));
    controls.set(name, { schema, include, control, type }); byId('fields').append(field);
  }
  syncJson();
}
function readFields() {
  const input = Object.create(null);
  for (const [name, field] of controls) {
    if (!field.include.checked) continue;
    const { control, type, schema } = field;
    if (type === 'enum') input[name] = structuredClone(schema.enum[Number(control.value)]);
    else if (type === 'boolean') input[name] = control.checked;
    else if (type === 'number' || type === 'integer') {
      if (!control.value.trim() || !Number.isFinite(Number(control.value)) ||
        type === 'integer' && !Number.isInteger(Number(control.value))) throw new Error('Enter a valid ' + type + ' for ' + name + '.');
      input[name] = Number(control.value);
    } else if (type === 'json') {
      try { input[name] = JSON.parse(control.value); } catch { throw new Error('Enter valid JSON for ' + name + '.'); }
    } else input[name] = control.value;
  }
  return input;
}
function syncJson() { try { byId('inputJson').value = JSON.stringify(readFields(), null, 2); } catch { /* Keep the last complete input while a field is being edited. */ } }
function renderFunction() {
  definition = catalog?.functions.find(value => value.id === byId('function').value) ?? null;
  if (!definition) return;
  byId('functionDescription').textContent = definition.description;
  for (const key of ['amount','network','asset','payTo']) byId(key).textContent = definition.payment[key];
  byId('output').textContent = definition.output.filename + ' · ' + definition.output.contentType + ' · up to ' + size(definition.maxOutputBytes);
  byId('timeout').textContent = (definition.timeoutMs / 1000).toLocaleString() + ' seconds';
  byId('accessField').hidden = catalog.authentication !== 'access-token';
  renderFields(definition.example);
}
function setPending(value) {
  pending = value;
  for (const id of ['loadCatalog','prepareNew','saveDraft','newRequest']) byId(id).disabled = value;
  renderDetail();
}
async function saveDraft(prepare) {
  if (!catalog || !definition || pending) return;
  const input = readFields();
  if (!byId('reference').value.trim()) byId('reference').value = 'request_' + crypto.randomUUID();
  setPending(true);
  try {
    const reference = byId('reference').value.trim();
    const result = await api(prefix + '/draft', { method: 'POST', body: { catalog, functionId: definition.id, input,
      reference, label: byId('label').value || reference, accessToken: byId('accessToken').value || null } });
    byId('accessToken').value = ''; await select(result.request.id);
    if (prepare) await startSelected('prepare');
    else message('Draft saved. Its inputs and reference are ready to prepare.');
    await refresh();
  } finally { setPending(false); }
}
function renderList() {
  const body = byId('rows'); body.replaceChildren();
  for (const value of rows) {
    const tr = node('tr'); if (selected?.id === value.id) tr.className = 'selected';
    const identity = node('td'), button = node('button', value.label || value.reference);
    button.type = 'button'; button.addEventListener('click', () => select(value.id).catch(problem));
    identity.append(button, node('span', value.reference, 'small mono'),
      node('span', new URL(value.merchant.origin).host + ' · ' + value.merchant.functionId, 'small'));
    const phase = node('td'); phase.append(node('span', value.phase, 'state'));
    if (['RUNNING','CANCELLING'].includes(value.task?.state)) phase.append(node('span', words(value.task.kind) + ' · ' + words(value.task.state), 'small'));
    const amount = node('td', value.payment.amount, 'money mono');
    amount.append(node('span', value.payment.network, 'small'));
    tr.append(identity, phase, amount); body.append(tr);
  }
  byId('count').textContent = total + (total === 1 ? ' request' : ' requests');
  byId('empty').hidden = rows.length > 0;
  byId('empty').textContent = total ? 'No requests on this page.' : 'No saved requests match this view.';
  byId('page').textContent = total ? offset + 1 + '–' + Math.min(offset + 50, total) + ' of ' + total : '0 requests';
  byId('previous').disabled = offset === 0; byId('next').disabled = offset + 50 >= total;
}
function progress(value) {
  if (value.task?.state === 'CANCELLING') return 'Stopping the current local request and retaining its saved identity.';
  if (value.task?.state === 'RUNNING') return value.task.kind === 'withdraw' ?
    'Withdrawing this same unsubmitted request from the merchant.' : 'Preparing the saved merchant request and retaining its ticket.';
  if (value.phase === 'WITHDRAWN') return 'This request is withdrawn. Start another request when you need a new job.';
  if (value.phase === 'IMPORTED') return value.checkout?.jobEntryId ?
    'The original checkout accepted this job. Open Jobs to follow execution and use its result.' :
    'The ticket is linked to the original Checkout. Open it to review the configured payment and continue.';
  if (value.lastError) return words(value.lastError);
  if (value.phase === 'READY') return 'The merchant ticket is saved. Open it in Checkout to continue.';
  if (value.phase === 'RECOVERABLE') return 'Continue this saved request to recover the same merchant ticket.';
  return 'Your inputs and private request are saved. Prepare checkout when ready.';
}
function renderDetail() {
  byId('unselected').hidden = Boolean(selected); byId('detail').hidden = !selected;
  if (!selected) return;
  const value = selected;
  byId('detailHeading').textContent = value.label; byId('identity').textContent = value.reference;
  byId('requestState').textContent = value.phase; byId('progress').textContent = progress(value);
  byId('selectedMerchant').textContent = value.merchant.origin; byId('selectedFunction').textContent = value.merchant.functionId;
  byId('selectedPrice').textContent = value.payment.amount + ' · ' + value.payment.network;
  byId('updated').textContent = date(value.updatedAt);
  byId('savedInput').textContent = value.input === undefined ? '' : JSON.stringify(value.input, null, 2);
  byId('requestHash').textContent = value.requestSha256; byId('inputHash').textContent = value.inputSha256;
  byId('catalogHash').textContent = value.merchant.catalogSha256;
  byId('attempts').textContent = value.requestAttempts + ' preparation / ' + value.withdrawalAttempts + ' withdrawal';
  byId('prepareButton').disabled = pending || !value.actions.prepare;
  byId('importButton').disabled = pending || !value.actions.import;
  byId('withdrawButton').disabled = pending || !value.actions.withdraw;
  byId('stopButton').hidden = !value.actions.stop; byId('stopButton').disabled = pending;
  byId('downloadTicket').disabled = pending || !value.hasTicket;
  byId('accessUpdate').hidden = value.merchant.authentication !== 'access-token';
  byId('openCheckout').hidden = !value.checkoutId || value.phase === 'WITHDRAWN';
  byId('openCheckout').href = '/jobs/checkout/?checkout=' + (value.checkoutId ?? '') + '#' + token;
  byId('openJob').hidden = !value.checkout?.jobEntryId;
  byId('openJob').href = '/jobs/?entry=' + (value.checkout?.jobEntryId ?? '') + '#' + token;
  const history = byId('history'); history.replaceChildren();
  for (const item of (value.history ?? []).slice(-6).reverse())
    history.append(node('li', date(item.at) + ' · ' + item.action.replaceAll('-', ' ')));
}
async function select(id) {
  const version = ++epoch;
  const value = await api(endpoint(id));
  if (version !== epoch) return;
  selected = value; requestedId = null; renderList(); renderDetail();
  history.replaceState(null, '', location.pathname + '?request=' + id);
}
async function refresh() {
  if (refreshing || disposed) return;
  refreshing = true;
  try {
    const parameters = new URLSearchParams({ q: byId('query').value, phase: byId('phase').value, offset: String(offset), limit: '50' });
    const result = await api(prefix + '/requests?' + parameters);
    rows = result.items; total = result.total;
    if (offset && offset >= total) { offset = Math.max(0, Math.floor((Math.max(1, total) - 1) / 50) * 50); return; }
    renderList();
    if (requestedId) await select(requestedId);
    else if (selected) {
      const id = selected.id, version = epoch, fresh = await api(endpoint(id));
      if (selected?.id === id && version === epoch) { selected = fresh; renderDetail(); }
    }
  } catch (error) { problem(error); }
  finally {
    refreshing = false; clearTimeout(timer);
    if (!disposed) timer = setTimeout(refresh, document.hidden ? 10000 : 3000);
  }
}
async function startSelected(kind, reason) {
  if (!selected) return;
  const result = await api(endpoint(selected.id, 'start'), { method: 'POST',
    body: { kind, expectedRevision: selected.revision, ...(reason ? { reason } : {}) } });
  await select(result.id); message(kind === 'withdraw' ? 'Withdrawal started for the saved request.' : 'Saved request preparation started.');
}
async function action(kind) {
  if (pending || !selected) return;
  setPending(true);
  try { await startSelected(kind); } finally { setPending(false); await refresh(); }
}
byId('catalogForm').addEventListener('submit', event => {
  event.preventDefault();
  if (pending) return;
  setPending(true);
  api(prefix + '/catalog', { method: 'POST', body: { origin: byId('merchantOrigin').value.trim() } }).then(value => {
    catalog = value; byId('catalogSection').hidden = false;
    byId('serviceName').textContent = value.serviceName; byId('catalogOrigin').textContent = value.publicOrigin;
    const select = byId('function'); select.replaceChildren();
    for (const entry of value.functions) { const option = node('option', entry.id); option.value = entry.id; select.append(option); }
    byId('reference').value = ''; renderFunction(); message('Merchant functions loaded. Choose a function and complete its inputs.');
  }).catch(problem).finally(() => setPending(false));
});
byId('function').addEventListener('change', () => { byId('reference').value = ''; renderFunction(); });
byId('draftForm').addEventListener('submit', event => { event.preventDefault(); saveDraft(true).catch(problem); });
byId('saveDraft').addEventListener('click', () => saveDraft(false).catch(problem));
byId('applyJson').addEventListener('click', () => {
  try {
    const value = JSON.parse(byId('inputJson').value);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(definition.inputSchema.properties, key)))
      throw new Error('Input must be an object containing the configured fields.');
    renderFields(value); message('Input JSON applied to the fields.');
  } catch (error) { problem(error); }
});
byId('newRequest').addEventListener('click', () => {
  byId('reference').value = ''; byId('label').value = ''; byId('accessToken').value = '';
  message('Ready to save a new request.'); byId('merchantOrigin').focus();
});
byId('filterForm').addEventListener('submit', event => { event.preventDefault(); offset = 0; refresh(); });
byId('previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); refresh(); });
byId('next').addEventListener('click', () => { offset += 50; refresh(); });
byId('prepareButton').addEventListener('click', () => action('prepare').catch(problem));
byId('importButton').addEventListener('click', () => action('import').catch(problem));
byId('stopButton').addEventListener('click', async () => {
  if (!selected || pending) return;
  setPending(true);
  try { await api(endpoint(selected.id, 'stop'), { method: 'POST', body: {} }); await select(selected.id); }
  catch (error) { problem(error); } finally { setPending(false); }
});
byId('withdrawForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || pending) return; setPending(true);
  try { await startSelected('withdraw', byId('withdrawReason').value); }
  catch (error) { problem(error); } finally { setPending(false); await refresh(); }
});
byId('accessForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || pending) return; setPending(true);
  try {
    await api(endpoint(selected.id, 'access'), { method: 'POST',
      body: { expectedRevision: selected.revision, accessToken: byId('newAccessToken').value || null } });
    byId('newAccessToken').value = ''; await select(selected.id); message('Merchant access updated on the saved request.');
  } catch (error) { problem(error); } finally { setPending(false); }
});
byId('downloadTicket').addEventListener('click', async () => {
  if (!selected || pending) return; setPending(true);
  try {
    const value = await api(endpoint(selected.id, 'ticket'));
    const bytes = Uint8Array.from(atob(value.handoffBase64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = 'job-ticket-' + selected.id.slice(0, 12) + '.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { problem(error); } finally { setPending(false); }
});
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
