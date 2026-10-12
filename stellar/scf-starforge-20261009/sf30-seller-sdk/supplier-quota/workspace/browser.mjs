// MIT. Original supplier account draft, saved review, source recovery and ledger read.
const $ = id => document.getElementById(id);
const copy = value => structuredClone(value);
const labels = { PREPARED: 'Review ready', APPLYING: 'Save needs recovery', APPLIED: 'Saved',
  CONFLICT: 'Source changed', CANCELLED: 'Cancelled' };
const messages = {
  SUPPLIER_SOURCE_CHANGED: 'The upstream file changed after this view or review. Refresh the source, then rebase the retained review or edit the current configuration.',
  SUPPLIER_SAVED_SOURCE_CHANGED: 'The upstream file changed during save completion. Refresh the source and inspect this retained change.',
  SUPPLIER_CHANGE_REVISION_CHANGED: 'This change has a newer revision. Open the current review and continue it.',
  SUPPLIER_REVIEW_CHANGED: 'Open the retained review again before saving.',
  SUPPLIER_ACCOUNT_IDENTITY_CHANGED: 'The original account label, credential reference and quota directory must stay together. Change its call limits or binding assignments.',
  SUPPLIER_ACCOUNT_IDENTITY_ALREADY_RETAINED: 'This identity or quota directory belongs to a retained account alias. Continue that original account.',
  SUPPLIER_CHANGE_EMPTY: 'There are no account or binding changes to review.',
  SUPPLIER_RESTORE_ACCOUNT_CHANGED: 'A later edit changed the same account. Use the saved configuration to review the desired values together.',
  SUPPLIER_RESTORE_BINDING_CHANGED: 'A later edit changed the same binding. Use the saved configuration to review its current assignment.',
  SUPPLIER_BINDING_INVENTORY_CHANGED: 'The original binding inventory changed. Refresh and use the saved configuration before preparing this draft.',
  SUPPLIER_WORKSPACE_TOKEN_REQUIRED: 'Open this workspace using its current private launch link.',
  SUPPLIER_SOURCE_PRIVATE_PARENT_REQUIRED: 'Keep the original upstream file in a private directory owned by this operator.',
  ENOSPC: 'The private host needs writable space. The original review is retained; recover its save after space is available.',
};
let token = location.hash.slice(1);
try {
  if (token) sessionStorage.setItem('starforge-supplier-accounts-token', token);
  else token = sessionStorage.getItem('starforge-supplier-accounts-token') ?? '';
} catch {}
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let view = null, draft = null, selected = null, quota = null, dirty = false, busy = false, offset = 0;
let editing = null;
const safeDate = value => value ? new Date(value).toLocaleString() : '—';
const display = value => value === null || value === undefined ? '—' : String(value);
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = display(value);
  if (className) node.className = className;
  return node;
}
function button(text, action) {
  const node = element('button', text); node.type = 'button'; node.addEventListener('click', action); node.disabled = busy; return node;
}
function cells(row, values) {
  for (const value of values) row.append(element('td', value));
  return row;
}
function download(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function api(path, body) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-workspace-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The local workspace did not return a complete response. Refresh the retained review.'); }
  if (!response.ok) {
    const error = new Error(messages[result.error] ?? result.error ?? 'The local operation could not complete.');
    error.code = result.error; error.changeId = result.changeId; throw error;
  }
  return result;
}
function setBusy(value) {
  busy = value; document.documentElement.classList.toggle('busy', value);
  for (const field of document.querySelectorAll('fieldset')) field.disabled = value;
  for (const item of document.querySelectorAll('#bindings select')) item.disabled = value || item.dataset.unavailable === 'true';
  $('change-note').disabled = value; $('binding-filter').disabled = value;
  for (const item of document.querySelectorAll('button')) item.disabled = value || item.dataset.unavailable === 'true';
}
function available(id, value) {
  const item = $(id); item.dataset.unavailable = String(!value); item.disabled = busy || !value;
}
async function work(action, success) {
  if (busy) return;
  $('error').hidden = true; $('message').textContent = 'Working…'; setBusy(true);
  try { await action(); $('message').textContent = success ?? ''; }
  catch (error) {
    $('error').textContent = error.message; $('error').hidden = false; $('message').textContent = '';
    if (error.changeId) {
      try { selected = await api('change?id=' + encodeURIComponent(error.changeId)); } catch {}
    } else if (selected) {
      try { selected = await api('change?id=' + encodeURIComponent(selected.id)); } catch {}
    }
    if (view) { try { await load(true); } catch {} }
    renderReview();
  } finally { setBusy(false); }
}
function sourceDraft(value) {
  return {
    sourceSha256: value.source.sha256,
    accounts: value.configuration.accounts.map(({ bindings, ...row }) => copy(row)),
    assignments: value.configuration.bindings.map(row => ({ binding: row.name, account: row.supplierAccount })),
    note: '',
  };
}
async function load(keepDraft = true) {
  view = await api('workspace?offset=' + offset + '&limit=25');
  if ((!keepDraft || !draft) && view.source && view.configuration) {
    draft = sourceDraft(view); dirty = false; $('change-note').value = ''; closeEditor();
  }
  if (selected) selected = await api('change?id=' + encodeURIComponent(selected.id));
  render();
}
function changed() { dirty = true; renderDraftStatus(); }
function renderDraftStatus() {
  const stale = Boolean(draft && view?.source && draft.sourceSha256 !== view.source.sha256);
  $('draft-status').textContent = stale ?
    'This draft uses an earlier source revision. Its values are retained; use the saved configuration to begin a fresh review.' :
    dirty ? 'Draft changes are ready to review.' : 'The draft matches the loaded source.';
  available('prepare', Boolean(draft && view?.source && !stale));
  available('download-draft', Boolean(draft));
  available('reset-draft', Boolean(view?.source && view?.configuration));
}
function renderAccounts() {
  $('accounts').replaceChildren();
  const rows = draft?.accounts ?? [];
  $('accounts-empty').hidden = rows.length > 0;
  for (const account of rows) {
    const count = draft.assignments.filter(row => row.account === account.alias).length;
    const tr = cells(element('tr'), [account.alias, account.requestsPerSecond, account.callsPerDay, count || 'Assign a binding']);
    const cell = element('td'), tools = element('div', undefined, 'toolbar');
    tools.append(button('Edit', () => editAccount(account.alias)), button('Retire', () => {
      if (busy) return;
      draft.accounts = draft.accounts.filter(row => row.alias !== account.alias);
      for (const row of draft.assignments) if (row.account === account.alias) row.account = null;
      if (editing === account.alias) closeEditor();
      changed(); renderAccounts(); renderBindings();
    }));
    cell.append(tools); tr.append(cell); $('accounts').append(tr);
  }
}
function renderBindings() {
  const filter = $('binding-filter').value.trim().toLowerCase();
  $('bindings').replaceChildren();
  for (const binding of view?.configuration?.bindings ?? []) {
    if (filter && !binding.name.toLowerCase().includes(filter)) continue;
    const assignment = draft?.assignments.find(row => row.binding === binding.name);
    const tr = cells(element('tr'), [binding.name, binding.method]), td = element('td'), select = element('select');
    select.setAttribute('aria-label', 'Supplier account for ' + binding.name);
    const none = element('option', 'No shared account'); none.value = ''; select.append(none);
    for (const account of draft?.accounts ?? []) {
      const option = element('option', account.alias); option.value = account.alias; select.append(option);
    }
    select.value = assignment?.account ?? '';
    select.dataset.unavailable = String(!assignment); select.disabled = !assignment || busy;
    select.addEventListener('change', () => {
      assignment.account = select.value || null; changed(); renderAccounts();
    });
    td.append(select); tr.append(td); $('bindings').append(tr);
  }
}
function closeEditor() {
  editing = null; $('account-form').hidden = true; $('account-form').reset();
}
function editAccount(name = null) {
  if (busy || !draft) return;
  const form = $('account-form'), row = name ? draft.accounts.find(account => account.alias === name) : {
    alias: '', directory: '', account: '', apiKeyEnv: '', requestsPerSecond: 1, callsPerDay: 1000 };
  editing = name;
  for (const key of ['alias', 'directory', 'account', 'apiKeyEnv', 'requestsPerSecond', 'callsPerDay'])
    form.elements[key].value = row[key] ?? '';
  const retained = name !== null && Object.hasOwn(view.knownAccounts, name);
  form.elements.alias.readOnly = name !== null;
  for (const key of ['directory', 'account', 'apiKeyEnv']) form.elements[key].readOnly = retained;
  $('account-form-title').textContent = name ? 'Edit ' + name : 'Add supplier account';
  $('identity-note').textContent = retained ?
    'This identity keeps the original call history. Only its allowance is edited here.' :
    'Select the supplier account’s original private quota directory. An account needs at least one binding.';
  form.hidden = false; form.elements[name ? 'requestsPerSecond' : 'alias'].focus();
}
$('account-form').elements.alias.addEventListener('change', event => {
  if (editing) return;
  const name = event.target.value, known = view?.knownAccounts;
  const value = known && Object.hasOwn(known, name) ? known[name] : null;
  for (const key of ['directory', 'account', 'apiKeyEnv']) {
    $('account-form').elements[key].readOnly = Boolean(value);
    if (value) $('account-form').elements[key].value = value[key] ?? '';
  }
  $('identity-note').textContent = value ? 'This retained alias reopens its original account identity and call history.' :
    'Select the supplier account’s original private quota directory. An account needs at least one binding.';
});
$('account-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || !draft) return;
  const form = $('account-form'), values = new FormData(form), row = {
    alias: String(values.get('alias')), directory: String(values.get('directory')),
    account: String(values.get('account')), apiKeyEnv: String(values.get('apiKeyEnv')) || null,
    requestsPerSecond: Number(values.get('requestsPerSecond')), callsPerDay: Number(values.get('callsPerDay')),
  };
  if (!editing && draft.accounts.some(account => account.alias === row.alias)) {
    $('error').textContent = 'This alias is already in the draft. Edit its existing row.'; $('error').hidden = false; return;
  }
  if (editing) draft.accounts = draft.accounts.map(account => account.alias === editing ? row : account);
  else draft.accounts.push(row);
  draft.accounts.sort((a, b) => a.alias.localeCompare(b.alias));
  closeEditor(); changed(); renderAccounts(); renderBindings();
});
function renderHistory() {
  $('history').replaceChildren();
  const history = view?.history;
  for (const change of history?.changes ?? []) {
    const tr = cells(element('tr'), [safeDate(change.createdAt), labels[change.status] ?? change.status,
      change.review.note.slice(0, 100) || 'Account configuration']);
    const td = element('td');
    td.append(button('Open', () => work(async () => { selected = await api('change?id=' + encodeURIComponent(change.id)); renderReview(); })));
    tr.append(td); $('history').append(tr);
  }
  $('history-page').textContent = history?.total ? (history.offset + 1) + '–' + Math.min(history.total, history.offset + history.limit) +
    ' of ' + history.total : 'No reviews yet';
  available('previous', Boolean(history && history.offset > 0));
  available('next', Boolean(history && history.offset + history.limit < history.total));
}
function renderReview() {
  $('review-empty').hidden = Boolean(selected); $('review-details').hidden = !selected;
  for (const id of ['apply', 'recover', 'rebase', 'restore-change', 'cancel']) available(id, false);
  if (!selected) return;
  const row = selected, review = row.review;
  $('review-status').textContent = (labels[row.status] ?? row.status) + ' · revision ' + row.revision + ' · ' + safeDate(row.updatedAt);
  $('review-note').textContent = review.note || 'Account configuration';
  $('review-source').textContent = 'From ' + review.source.sha256;
  $('review-target').textContent = 'To   ' + review.target.sha256;
  $('review-relation').textContent = review.restores ? 'Restores change ' + review.restores :
    review.rebases ? 'Rebases review ' + review.rebases : '';
  $('review-accounts').replaceChildren(); $('review-bindings').replaceChildren();
  for (const change of review.accounts)
    $('review-accounts').append(cells(element('tr'), [change.alias, change.kind,
      display(change.before?.requestsPerSecond) + ' → ' + display(change.after?.requestsPerSecond),
      display(change.before?.callsPerDay) + ' → ' + display(change.after?.callsPerDay)]));
  for (const change of review.assignments)
    $('review-bindings').append(cells(element('tr'), [change.binding, change.before ?? 'No shared account', change.after ?? 'No shared account']));
  $('review-outcome').textContent = row.outcome?.state === 'SAVED' ?
    'Saved to the original upstream file at ' + safeDate(row.outcome.source.readAt) + '. The merchant uses it on its next normal start.' :
    row.outcome?.code ? (messages[row.outcome.code] ?? row.outcome.code) :
    'Review the source revision and changes before saving.';
  const current = view?.source?.sha256;
  available('apply', row.status === 'PREPARED' && current === review.source.sha256);
  available('recover', row.status === 'APPLYING');
  const receivingReview = row.status === 'APPLYING' && current === review.source.sha256 &&
    (view.source.path !== review.source.path || view.source.device !== review.source.device || view.source.inode !== review.source.inode);
  $('rebase').textContent = receivingReview ? 'Review on this receiving host' : 'Rebase review on current source';
  available('rebase', receivingReview || Boolean(current && ['PREPARED', 'CONFLICT'].includes(row.status) &&
    (row.status === 'CONFLICT' || current !== review.source.sha256 || view.source.inode !== review.source.inode ||
      view.source.device !== review.source.device || view.source.path !== review.source.path)));
  available('restore-change', Boolean(current && row.status === 'APPLIED'));
  available('cancel', ['PREPARED', 'CONFLICT'].includes(row.status));
}
function renderQuota() {
  $('usage').replaceChildren();
  if (!quota) return;
  $('usage-time').textContent = 'Read ' + safeDate(quota.snapshot.capturedAt) + ' · saved source ' + quota.source.sha256;
  for (const row of quota.snapshot.accounts) {
    const q = row.quota;
    $('usage').append(cells(element('tr'), [row.name, q?.callsInWindow, q?.remainingCalls, q?.totalDispatched,
      q?.retryAt ? safeDate(q.retryAt) : q ? 'Available now' : '—',
      row.status === 'AVAILABLE' ? q.allowed ? 'Accepting calls' : q.providerCooldownUntil > Date.parse(quota.snapshot.capturedAt) ?
        'Supplier cooldown' : q.remainingCalls === 0 ? 'Window allowance used' : 'Rate interval' : row.errorCode]));
  }
}
function render() {
  $('source-path').textContent = view?.source?.path ?? '';
  $('source-revision').textContent = view?.source ? 'SHA256 ' + view.source.sha256 + '\nRead ' + safeDate(view.source.readAt) :
    (messages[view?.sourceError] ?? view?.sourceError ?? 'Load the original source.');
  renderDraftStatus(); renderAccounts(); renderBindings(); renderHistory(); renderReview(); renderQuota();
  available('new-account', Boolean(draft && view?.configuration)); available('inspect-quota', Boolean(view?.source));
  available('report', Boolean(view?.source));
}
$('refresh').addEventListener('click', () => work(() => load(true), 'Loaded the current source. Existing draft edits are retained.'));
$('reset-draft').addEventListener('click', () => work(() => load(false), 'The draft now uses the current saved configuration.'));
$('new-account').addEventListener('click', () => editAccount());
$('close-account').addEventListener('click', closeEditor);
$('binding-filter').addEventListener('input', renderBindings);
$('change-note').addEventListener('input', () => { if (draft) { draft.note = $('change-note').value; changed(); } });
$('prepare').addEventListener('click', () => work(async () => {
  selected = await api('prepare', { ...draft, note: $('change-note').value }); await load(true);
}, 'The complete change is retained for review.'));
$('download-draft').addEventListener('click', () => { if (draft) download('supplier-account-draft.json', { ...draft, note: $('change-note').value }); });
$('apply').addEventListener('click', () => work(async () => {
  selected = await api('apply', { id: selected.id, revision: selected.revision, reviewSha256: selected.reviewSha256 }); await load(false);
}, 'Saved the reviewed change to the original upstream file.'));
$('recover').addEventListener('click', () => work(async () => {
  selected = await api('recover', { id: selected.id, revision: selected.revision, reviewSha256: selected.reviewSha256 }); await load(false);
}, 'Recovered the original save and retained its outcome.'));
$('restore-change').addEventListener('click', () => work(async () => {
  selected = await api('restore-change', { id: selected.id, sourceSha256: view.source.sha256, note: 'Restore selected account change' }); await load(true);
}, 'Prepared a restoration against the current source. Review it before saving.'));
$('rebase').addEventListener('click', () => work(async () => {
  selected = await api('rebase', { id: selected.id, sourceSha256: view.source.sha256, note: selected.review.note }); await load(true);
}, 'Prepared the same edits against the current source. Review them before saving.'));
$('cancel').addEventListener('click', () => work(async () => {
  selected = await api('cancel', { id: selected.id, revision: selected.revision }); await load(true);
}, 'The review is cancelled and remains in history.'));
$('inspect-quota').addEventListener('click', () => work(async () => { quota = await api('inspect-quota', {}); renderQuota(); }, 'Read the original account ledgers.'));
$('report').addEventListener('click', () => work(async () => download('supplier-account-history.json', await api('report')), 'Downloaded the complete account history.'));
$('previous').addEventListener('click', () => work(async () => { offset = Math.max(0, offset - 25); await load(true); }));
$('next').addEventListener('click', () => work(async () => { offset += 25; await load(true); }));
if (!/^[a-f0-9]{64}$/.test(token)) {
  $('error').textContent = messages.SUPPLIER_WORKSPACE_TOKEN_REQUIRED; $('error').hidden = false; render();
} else work(() => load(false), 'Loaded the original merchant configuration.');
