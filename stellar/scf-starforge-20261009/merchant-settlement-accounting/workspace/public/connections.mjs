// MIT. Native company review inside the original accounting and OAuth workspaces.
import { createOAuthConnections } from '/oauth-browser.mjs';

const $ = id => document.getElementById(id);
const PREFIX = 'stellar.accounting.connections.v1';
const SCOPE_HEADER = 'X-Accounting-Connection-Scope';
let ownerScope = null, ownerChanged = false;
const KINDS = { quickbooks: 'QuickBooks Online', xero: 'Xero' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const displayDate = value => value ? new Date(value).toLocaleString() : 'Not supplied';
const clone = value => JSON.parse(JSON.stringify(value));
function stored(key, fallback) {
  if (!ownerScope) return fallback;
  try { return JSON.parse(sessionStorage.getItem(PREFIX + '.' + ownerScope + '.' + key)) ?? fallback; }
  catch { return fallback; }
}
function remember(key, value) {
  if (!ownerScope) return;
  try { sessionStorage.setItem(PREFIX + '.' + ownerScope + '.' + key, JSON.stringify(value)); } catch {}
}
function legacyRequests() {
  const values = [];
  for (const key of [PREFIX + '.request', 'stellar.accounting.oauth.public.v1.pending']) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key));
      if (value) values.push(value.id ?? value.body?.id ?? value.args?.requestId ?? 'Original authorization request');
    } catch {}
  }
  return values;
}
// Only the original workspace's explicit missing-file error confirms absence.
// An unreadable/proxy 404 keeps the exact request and saved review identity.
function reviewMissing(error) {
  return !error.outcomeUnknown && error.code === 'ENOENT' &&
    (error.status === 400 || error.status === 404);
}
function scopeError() {
  return Object.assign(new Error('This page belongs to a different accounting connection workspace. Reopen the original Application to continue its retained request, or reload to open the current workspace.'),
    { code: 'ACCOUNTING_CONNECTION_SCOPE_CHANGED', status: 409, outcomeUnknown: true });
}
function make(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = String(text);
  if (className) value.className = className;
  return value;
}
function field(label, value = '', { multiline = false } = {}) {
  const input = make(multiline ? 'textarea' : 'input'); if (!multiline) input.type = 'text';
  input.value = value; const container = make('label', undefined, 'field');
  container.append(make('span', label), input); return { input, container };
}
function selectField(label, options, value = '') {
  const input = make('select'), container = make('label', undefined, 'field');
  for (const item of options) {
    const option = make('option', typeof item === 'string' ? item : item.label);
    option.value = typeof item === 'string' ? item : item.value;
    option.disabled = typeof item === 'object' && item.disabled === true;
    input.append(option);
  }
  input.value = value; container.append(make('span', label), input); return { input, container };
}
function button(label, action, disabled = false, primary = false) {
  const value = make('button', label, primary ? 'primary' : undefined); value.type = 'button';
  value.disabled = disabled; value.addEventListener('click', () => act(action)); return value;
}
function fact(label, value) { const row = make('div', undefined, 'fact'); row.append(make('strong', label), make('span', value ?? '—')); return row; }
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = 'notice' + (error ? ' error' : ''); }
function table(headers, label) {
  const wrap = make('div', undefined, 'table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label);
  const element = make('table'), head = make('thead'), row = make('tr'), body = make('tbody');
  for (const header of headers) row.append(make('th', header)); head.append(row); element.append(head, body); wrap.append(element);
  return { wrap, body };
}
async function api(path, body) {
  if (ownerChanged || body !== undefined && !ownerScope) throw scopeError();
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Workspace-Request': '1' };
  // The first state read establishes this page's owner. Later API requests
  // retain it through the original HTTP boundary, including exact retries.
  if (ownerScope && (path !== 'accounting-connections' || body !== undefined)) headers[SCOPE_HEADER] = ownerScope;
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value;
  try { value = await response.json(); } catch {
    throw Object.assign(new Error('The original workspace response could not be read. Refresh its status and retry the retained request.'), { status: response.status, outcomeUnknown: true });
  }
  if (!response.ok) {
    const source = value.error && typeof value.error === 'object' ? value.error : value;
    if ((source.code ?? value.error) === 'ACCOUNTING_CONNECTION_SCOPE_CHANGED') {
      ownerChanged = true; snapshot = null; available(); throw scopeError();
    }
    throw Object.assign(new Error(source.message ?? (typeof value.error === 'string' ? value.error : 'The workspace request failed.')),
      { status: response.status, code: source.code ?? (typeof value.error === 'string' ? value.error : undefined), outcomeUnknown: source.outcomeUnknown ?? value.outcomeUnknown, details: source.details });
  }
  return value;
}

const draft = { kind: 'quickbooks', alias: '', actor: '', reference: '',
  minorVersion: '', tenantId: '', connectionId: '' };
let snapshot = null, review = null, accountPage = null, accountQuery = '', accountOffset = 0;
let nativeTenants = null, tenantQuery = '', tenantOffset = 0;
let retained = null, busy = false, authorizationChanged = false;
let historyPage = null, historyOffset = 0, oauth;
const rememberDraft = () => remember('draft', draft);
const grantKey = value => value ? [value.alias, value.profileSha256, value.grantId].join(':') : '';
const choice = () => snapshot?.connections[draft.kind]?.find(value => value.alias === draft.alias);
function available() {
  for (const id of ['selection-form', 'review-controls', 'history-controls']) $(id).disabled = busy || !snapshot;
  $('refresh-all').disabled = busy; $('refresh-history').disabled = busy || !snapshot;
  oauth?.available(busy || !snapshot);
}
async function act(action) {
  if (busy) return;
  busy = true; available();
  try {
    await action();
    if (authorizationChanged) { authorizationChanged = false; await loadState(); }
  } catch (error) { notice(error.message + (error.code ? ' [' + error.code + ']' : ''), true); }
  finally { busy = false; available(); renderRetained(); }
}
function clearReview() {
  review = null; accountPage = null; accountOffset = 0;
  remember('reviewId', null); renderReview();
}
function draftChanged(key, value) {
  if (draft[key] === value) return;
  draft[key] = value; rememberDraft(); clearReview();
}
function targetName(value) { return value?.companyName ?? value?.organizationName ?? value?.tenantName ?? 'No selection saved'; }
function renderTargets() {
  const container = $('targets'); container.replaceChildren();
  if (!snapshot) { container.append(make('p', 'Open the reviewed managed accounting Application with its original OAuth registry to select native targets.', 'empty')); return; }
  const grid = make('div', undefined, 'target-grid');
  for (const [kind, label] of Object.entries(KINDS)) {
    const value = snapshot.providers[kind], card = make('div', undefined, 'target');
    card.append(make('h3', label));
    if (value.active) {
      card.append(fact('Active now', targetName(value.active)),
        fact(kind === 'quickbooks' ? 'Company / environment' : 'Tenant', kind === 'quickbooks' ?
          value.active.realmId + ' · ' + value.active.environment : value.active.tenantId),
        fact('Base currency', value.active.baseCurrency));
      const link = make('a', kind === 'quickbooks' ? 'Open QuickBooks journals' : 'Open Xero journals');
      link.href = kind === 'quickbooks' ? '/qbo.html' : '/xero.html'; card.append(link);
    } else card.append(make('p', 'This start has no active ' + label + ' selection.', 'hint'));
    if (value.selected) {
      card.append(fact(value.restartRequired ? 'Saved for the next start' : 'Saved selection', targetName(value.selected)),
        fact('Reviewed by', value.selected.review.actor + ' · ' + value.selected.review.reference));
      const details = make('details'), facts = make('div', undefined, 'facts');
      details.append(make('summary', 'Saved selection identity'));
      for (const [name, text] of [['Alias', value.selected.alias], ['Selection', value.selected.id],
        ['Selection SHA256', value.selected.integrity.sha256], ['Profile SHA256', value.selected.profileSha256],
        ['Grant', value.selected.grantId], ['Native source captured', displayDate(value.selected.capturedAt)]]) facts.append(fact(name, text));
      details.append(facts); card.append(details);
    }
    if (value.restartRequired) card.append(make('p', 'New selection saved. Stop, review and reopen this application from Applications to activate it.', 'restart'));
    grid.append(card);
  }
  container.append(grid);
}
async function loadState() {
  const result = await api('accounting-connections');
  if (typeof result.scope !== 'string' || !/^[a-f0-9]{64}$/.test(result.scope))
    throw new Error('The current accounting source does not expose a bound connection workspace. Open a compatible reviewed Application.');
  if (ownerScope && ownerScope !== result.scope) {
    ownerChanged = true; snapshot = null; available(); throw scopeError();
  }
  if (!ownerScope) {
    ownerScope = result.scope;
    const savedDraft = stored('draft', {});
    draft.kind = KINDS[savedDraft.kind] ? savedDraft.kind : 'quickbooks';
    for (const key of ['alias', 'actor', 'reference', 'minorVersion', 'tenantId', 'connectionId'])
      draft[key] = typeof savedDraft[key] === 'string' ? savedDraft[key] : '';
    retained = stored('request', null);
    openAuthorization();
    renderRetained();
  }
  const previous = grantKey(choice());
  snapshot = result;
  if (previous && previous !== grantKey(choice())) {
    nativeTenants = null; tenantOffset = 0; clearReview();
  }
  renderTargets(); renderForm(); available();
}
function renderTenantTable(container) {
  container.replaceChildren();
  const selected = choice();
  if (!nativeTenants || nativeTenants.grantKey !== grantKey(selected)) {
    container.append(make('p', 'Read the connected tenants, then choose the exact organization to review.', 'hint')); return;
  }
  const rows = nativeTenants.connections.filter(value => !tenantQuery ||
    [value.tenantName, value.tenantId, value.id].join(' ').toLowerCase().includes(tenantQuery.toLowerCase()));
  if (tenantOffset >= rows.length) tenantOffset = 0;
  container.append(make('p', rows.length + ' matching tenants · captured ' + displayDate(nativeTenants.capturedAt), 'small'));
  const view = table(['Organization', 'Tenant ID', 'Connection ID', 'Type', 'Selection'], 'Connected Xero tenants');
  for (const value of rows.slice(tenantOffset, tenantOffset + 50)) {
    const row = make('tr'), selectedNow = draft.connectionId === value.id && draft.tenantId === value.tenantId;
    if (selectedNow) row.className = 'selected-row';
    row.append(make('td', value.tenantName), make('td', value.tenantId), make('td', value.id), make('td', value.tenantType));
    const action = make('td');
    action.append(button(selectedNow ? 'Selected' : 'Select organization', async () => {
      draft.connectionId = value.id; draft.tenantId = value.tenantId; rememberDraft(); clearReview(); renderTenantTable(container);
    }, !value.selectable || selectedNow));
    row.append(action); view.body.append(row);
  }
  container.append(view.wrap);
  const pager = make('div', undefined, 'pager');
  pager.append(button('Previous tenants', async () => { tenantOffset = Math.max(0, tenantOffset - 50); renderTenantTable(container); }, tenantOffset === 0),
    make('span', rows.length ? (tenantOffset + 1) + '–' + Math.min(tenantOffset + 50, rows.length) + ' of ' + rows.length : 'No matching tenants', 'small'),
    button('More tenants', async () => { tenantOffset += 50; renderTenantTable(container); }, tenantOffset + 50 >= rows.length));
  container.append(pager);
}
function renderForm() {
  const container = $('selection-fields'); container.replaceChildren();
  const kinds = selectField('Accounting provider', Object.entries(KINDS).map(([value, label]) => ({ value, label })), draft.kind);
  kinds.input.id = 'accounting-provider';
  kinds.input.addEventListener('change', () => {
    draftChanged('kind', kinds.input.value); draft.alias = ''; draft.connectionId = ''; draft.tenantId = '';
    nativeTenants = null; tenantOffset = 0; rememberDraft(); renderForm();
  });
  const aliases = selectField('Reviewed authorization grant', [{ value: '', label: 'Choose a connection' },
    ...(snapshot?.connections[draft.kind] ?? []).map(value => ({
      value: value.alias, label: value.label + ' · ' + value.alias + (value.ready ? '' : ' · ' + value.state),
      disabled: !value.ready,
    }))], draft.alias);
  aliases.input.id = 'accounting-grant';
  aliases.input.addEventListener('change', () => {
    draftChanged('alias', aliases.input.value); nativeTenants = null; tenantOffset = 0;
    draft.connectionId = ''; draft.tenantId = ''; rememberDraft(); renderForm();
  });
  const actor = field('Company / tenant reviewer', draft.actor), reference = field('Review reference', draft.reference);
  actor.input.id = 'accounting-review-actor'; actor.input.maxLength = 160;
  reference.input.id = 'accounting-review-reference'; reference.input.maxLength = 2000;
  actor.input.addEventListener('input', () => draftChanged('actor', actor.input.value));
  reference.input.addEventListener('input', () => draftChanged('reference', reference.input.value));
  const fields = make('div', undefined, 'fields'); fields.append(kinds.container, aliases.container, actor.container, reference.container); container.append(fields);
  const selected = choice();
  if (!selected?.ready) container.append(make('p', 'Authorize and review a configured grant in the section above, then select it here.', 'hint'));
  else {
    const facts = make('div', undefined, 'facts');
    facts.append(fact('Reviewed grant', selected.grantId), fact('Profile SHA256', selected.profileSha256));
    if (draft.kind === 'quickbooks') {
      facts.append(fact('Company returned by Intuit', selected.realmId), fact('Configured environment', selected.environment));
      const minor = field('Optional QBO minor version', draft.minorVersion); minor.input.maxLength = 4; minor.input.inputMode = 'numeric';
      minor.input.addEventListener('input', () => draftChanged('minorVersion', minor.input.value)); fields.append(minor.container);
    }
    container.append(facts);
  }
  if (draft.kind === 'xero') {
    const tenants = make('div'), search = field('Find a connected organization', tenantQuery);
    search.input.maxLength = 200; search.input.addEventListener('input', () => { tenantQuery = search.input.value; tenantOffset = 0; renderTenantTable(tenants); });
    const controls = make('div', undefined, 'inline');
    controls.append(button('Read connected Xero tenants', async () => {
      const value = choice(); if (!value?.ready) throw new Error('Choose a reviewed Xero grant.');
      const result = await api('accounting-connections/tenants', { alias: value.alias, profileSha256: value.profileSha256, grantId: value.grantId });
      nativeTenants = { ...result, grantKey: grantKey(value) }; tenantOffset = 0; renderTenantTable(tenants);
      notice('Connected tenants read from the selected Xero grant. Choose an organization for its full account review.');
    }, !selected?.ready), search.container);
    container.append(controls, tenants); renderTenantTable(tenants);
  }
  const capture = button('Capture company and accounts for review', captureReview, !selected?.ready || Boolean(retained), true);
  capture.id = 'accounting-capture-company'; container.append(capture);
}
function setRetained(value) { retained = value ? { ...value, scope: ownerScope } : null; remember('request', retained); renderRetained(); }
function renderRetained() {
  const container = $('request-recovery'); container.replaceChildren();
  const legacy = legacyRequests();
  if (legacy.length) {
    const previous = make('details');
    previous.append(make('summary', 'Earlier browser requests without a workspace binding'),
      make('p', 'These original request IDs remain preserved. Open their original Application and its retained review history; this page will not replay them into the current workspace.', 'hint'));
    for (const id of legacy) previous.append(make('p', id, 'wrap'));
    container.append(previous);
  }
  if (!retained) return;
  container.append(make('h3', 'Retained source or selection request'),
    make('p', (retained.kind === 'select' ? 'Save reviewed selection' : 'Capture native company source') + ' · ' + (retained.id ?? retained.body?.id), 'wrap'),
    make('p', 'This browser kept the original request identity. Inspect its saved state or continue that same request.', 'hint'));
  const controls = make('div', undefined, 'actions');
  controls.append(button('Inspect retained request', async () => {
    const id = retained.id ?? retained.body.id;
    try {
      const value = await api('accounting-connections/reviews/' + encodeURIComponent(id)); await showReview(value);
      if (value.state === 'SAVED' || retained.kind === 'capture' && value.previewSha256) setRetained(null);
      notice('The original retained review has been read.');
    } catch (error) {
      if (reviewMissing(error)) { setRetained(null); notice('The request has no retained review. The draft is available for a new capture.'); return; }
      throw error;
    }
  }, busy || !snapshot), button('Retry exact retained request', dispatchRetained, busy || !snapshot));
  container.append(controls);
}
async function captureReview() {
  if (retained) throw new Error('Inspect or retry the retained request first.');
  const selected = choice();
  if (!selected?.ready || !draft.actor.trim()) throw new Error('Choose a reviewed grant and enter the company reviewer.');
  const request = { id: crypto.randomUUID(), kind: draft.kind, createdAt: new Date().toISOString(),
    alias: selected.alias, profileSha256: selected.profileSha256, grantId: selected.grantId,
    actor: draft.actor.trim(), reference: draft.reference.trim(),
    expectedSelectionSha256: snapshot.providers[draft.kind].selected?.integrity.sha256 ?? null };
  if (draft.kind === 'quickbooks') {
    if (draft.minorVersion && !/^[1-9][0-9]{0,3}$/.test(draft.minorVersion)) throw new Error('Use a positive QBO minor version of up to four digits or leave it blank.');
    Object.assign(request, { realmId: selected.realmId, environment: selected.environment, minorVersion: draft.minorVersion || null });
  } else {
    const tenant = nativeTenants?.grantKey === grantKey(selected) &&
      nativeTenants.connections.find(value => value.id === draft.connectionId && value.tenantId === draft.tenantId && value.selectable);
    if (!tenant) throw new Error('Read the connected tenants and select the exact Xero organization.');
    Object.assign(request, { connectionId: tenant.id, tenantId: tenant.tenantId });
  }
  clearReview(); setRetained({ kind: 'capture', body: request }); await dispatchRetained();
}
async function dispatchRetained() {
  if (!retained) return;
  if (retained.scope !== ownerScope || ownerChanged) throw scopeError();
  const current = clone(retained);
  try {
    const result = await api(current.kind === 'capture' ? 'accounting-connections/reviews' :
      'accounting-connections/reviews/' + encodeURIComponent(current.id) + '/select', current.body);
    setRetained(null); await showReview(result); await loadState(); await loadHistory();
    notice(current.kind === 'select' ?
      'Company selection saved. Review and reopen this application from Applications to use it; the active accounting target remains shown above.' :
      'Native company and accounts captured. Review the retained source and confirm the company before saving.');
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && !error.outcomeUnknown) {
      setRetained(null); await loadHistory().catch(() => {});
    }
    throw error;
  }
}
async function showReview(value) {
  review = value; accountPage = null; accountOffset = 0; accountQuery = '';
  remember('reviewId', value.id); renderReview();
  if (value.previewSha256) await loadAccounts(0);
}
function renderReview() {
  const container = $('review'); container.replaceChildren();
  if (!review) { container.append(make('p', 'Capture a native company or open an existing review from history.', 'empty')); return; }
  const selected = review.selection, facts = make('div', undefined, 'facts');
  container.append(make('h3', selected ? targetName(selected) : KINDS[review.kind] + ' source capture'),
    make('p', review.state + ' · ' + review.id, 'small wrap'));
  for (const [label, value] of [['Provider', KINDS[review.kind]], ['Alias', review.target.alias],
    ['Reviewer', review.target.actor], ['Review reference', review.target.reference],
    ['Requested at', displayDate(review.createdAt)], ['Grant', review.target.grantId],
    ['Profile SHA256', review.target.profileSha256]]) facts.append(fact(label, value));
  if (selected) {
    for (const [label, value] of [['Base currency', selected.baseCurrency],
      ['Accounts captured', selected.accountCount],
      ['Accounts available for mapping', selected.selectableAccountCount ?? selected.eligibleAccountCount],
      [review.kind === 'quickbooks' ? 'Company ID' : 'Tenant ID', selected.realmId ?? selected.tenantId],
      [review.kind === 'quickbooks' ? 'Environment' : 'Organization type', selected.environment ?? (selected.isDemoCompany ? 'Demo company' : 'Live organization')],
      ['Native source captured', displayDate(selected.capturedAt)], ['Reviewed source SHA256', review.previewSha256]])
      facts.append(fact(label, value));
  }
  container.append(facts);
  const downloads = make('div', undefined, 'downloads');
  for (const name of review.files) {
    const link = make('a', name === 'selection.json' ? 'Download complete native company source' : 'Download original source request');
    link.href = '/api/accounting-connections/reviews/' + encodeURIComponent(review.id) + '/download/' + name + '?scope=' + encodeURIComponent(ownerScope);
    link.download = ''; downloads.append(link);
  }
  container.append(downloads);
  if (!selected) {
    container.append(make('p', 'The original source request is retained. Continue it to finish the company and account capture.', 'hint'),
      button('Continue original source capture', async () => {
        const result = await api('accounting-connections/reviews/' + encodeURIComponent(review.id) + '/resume', {});
        await showReview(result); await loadHistory(); notice('Original native company capture completed.');
      }));
    return;
  }
  const accounts = make('div'); accounts.id = 'accounting-accounts';
  const search = field('Find captured accounts', accountQuery);
  search.input.maxLength = 200; search.input.addEventListener('input', () => { accountQuery = search.input.value; });
  const filter = make('div', undefined, 'inline');
  filter.append(search.container, button('Filter accounts', () => loadAccounts(0))); container.append(filter, accounts);
  renderAccounts();
  if (review.state === 'SAVED') {
    container.append(make('p', 'This original selection was saved at ' + displayDate(review.savedAt) + '. Saved and active targets above show whether a later selection replaced it.', 'source-note'));
  } else {
    const confirmation = make('input'); confirmation.type = 'checkbox'; confirmation.id = 'accounting-selection-confirm';
    const label = make('label', undefined, 'check');
    label.append(confirmation, make('span', 'I reviewed this company or tenant, its base currency, chart of accounts, native grant and source. Save it for the next application start.'));
    const save = button('Save reviewed company selection', async () => {
      if (!confirmation.checked) throw new Error('Confirm the retained native company and account review.');
      if (retained) throw new Error('Inspect or retry the original retained request first.');
      setRetained({ kind: 'select', id: review.id, body: { previewSha256: review.previewSha256, selectionConfirmed: true } });
      await dispatchRetained();
    }, Boolean(retained), true);
    save.id = 'accounting-save-selection'; container.append(label, save);
  }
}
async function loadAccounts(offset) {
  if (!review?.previewSha256) return;
  const id = review.id, sha = review.previewSha256;
  const result = await api('accounting-connections/reviews/' + encodeURIComponent(id) +
    '/accounts?offset=' + offset + '&limit=50&query=' + encodeURIComponent(accountQuery));
  if (review?.id !== id) return;
  if (result.previewSha256 !== sha) throw new Error('The retained company source changed. Reopen this review.');
  accountOffset = offset; accountPage = result; renderAccounts();
}
function renderAccounts() {
  const container = $('accounting-accounts'); if (!container) return; container.replaceChildren();
  if (!accountPage) { container.append(make('p', 'Reading captured accounts…', 'hint')); return; }
  container.append(make('p', accountPage.matched + ' matching accounts of ' + accountPage.total + ' captured.', 'small'));
  const view = table(['Account ID / code', 'Account name', 'Type', 'Status / mapping', 'Native details'], 'Captured native accounts');
  for (const value of accountPage.accounts) {
    const row = make('tr'), eligible = value.selectable ?? value.eligible ?? false;
    const status = value.Active === false ? 'Inactive' : value.Active === true ? 'Active' : value.status ?? value.Status ?? '';
    row.append(make('td', [value.value ?? value.accountId ?? value.AccountID ?? value.id, value.code ?? value.Code].filter(Boolean).join(' · ')),
      make('td', value.name ?? value.Name ?? ''), make('td', value.AccountType ?? value.type ?? value.Type ?? ''),
      make('td', [status, eligible ? 'Available for mapping' : 'Review restriction'].filter(Boolean).join(' · ')));
    const details = make('details'), cell = make('td'); details.append(make('summary', 'Original account fields'), make('pre', JSON.stringify(value, null, 2)));
    cell.append(details); row.append(cell); view.body.append(row);
  }
  container.append(view.wrap);
  const pager = make('div', undefined, 'pager'); pager.append(
    button('Previous accounts', () => loadAccounts(Math.max(0, accountOffset - 50)), accountOffset === 0),
    make('span', accountPage.matched ? (accountOffset + 1) + '–' + Math.min(accountOffset + 50, accountPage.matched) : 'No matching accounts', 'small'),
    button('More accounts', () => loadAccounts(accountPage.nextOffset), accountPage.nextOffset === null));
  container.append(pager);
}
async function loadHistory(offset = historyOffset) {
  historyPage = await api('accounting-connections/reviews?offset=' + offset + '&limit=20'); historyOffset = offset; renderHistory();
}
function renderHistory() {
  const container = $('history'); container.replaceChildren();
  if (!historyPage) { container.append(make('p', 'Reading retained reviews…', 'hint')); return; }
  if (!historyPage.total) { container.append(make('p', 'No company reviews have been captured in this workspace.', 'empty')); return; }
  const view = table(['Company / provider', 'Reviewer / captured', 'State', 'Open source'], 'Retained native company reviews');
  for (const value of historyPage.reviews) {
    const row = make('tr');
    row.append(make('td', (value.selection ? targetName(value.selection) : KINDS[value.kind]) + ' · ' + value.target.alias),
      make('td', value.target.actor + ' · ' + displayDate(value.createdAt)), make('td', value.state));
    const action = make('td'); action.append(button('Open review', async () => {
      await showReview(await api('accounting-connections/reviews/' + encodeURIComponent(value.id)));
      $('review-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    })); row.append(action); view.body.append(row);
  }
  container.append(view.wrap);
  const pager = make('div', undefined, 'pager'); pager.append(
    button('Newer reviews', () => loadHistory(Math.max(0, historyOffset - 20)), historyOffset === 0),
    make('span', (historyOffset + 1) + '–' + Math.min(historyOffset + 20, historyPage.total) + ' of ' + historyPage.total, 'small'),
    button('Older reviews', () => loadHistory(historyPage.nextOffset), historyPage.nextOffset === null));
  container.append(pager);
}
function openAuthorization() {
  oauth = createOAuthConnections({
  container: $('authorization'), make, field, selectField, api, act, notice,
  storagePrefix: 'stellar.accounting.oauth.public.v1.' + ownerScope,
  description: 'Authorize the registered accounting provider and review its returned grant on this host. Then capture and review the actual company or tenant in the section below.',
  grantAcceptedMessage: 'Accounting grant reviewed and kept privately. Choose it below to read the native company and chart of accounts.',
  onChanged() { authorizationChanged = true; },
  });
}
$('refresh-all').addEventListener('click', () => act(async () => {
  await loadState(); await oauth.refresh(); await loadHistory();
  if (review) await showReview(await api('accounting-connections/reviews/' + encodeURIComponent(review.id)));
  notice('Original grant, active targets and saved company reviews refreshed.');
}));
$('refresh-history').addEventListener('click', () => act(() => loadHistory()));
renderTargets(); renderForm(); renderReview(); renderRetained(); available();
await act(async () => {
  await loadState(); await oauth.refresh(); await loadHistory();
  const retainedReview = stored('reviewId', null);
  if (typeof retainedReview === 'string' && UUID.test(retainedReview)) {
    try { await showReview(await api('accounting-connections/reviews/' + encodeURIComponent(retainedReview))); }
    catch (error) { if (!reviewMissing(error)) throw error; remember('reviewId', null); }
  }
  notice('Original accounting connections and saved company choices are ready.');
});
