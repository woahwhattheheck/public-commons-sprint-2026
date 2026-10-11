const el = id => document.getElementById(id);
let current = null, selectedId = null, loaded = null, handoff = null;
let detailSeq = 0, listSeq = 0, draftSeq = 0, statusSeq = 0;

async function request(path, init) {
  const response = await fetch(path, {cache:'no-store', ...init});
  const data = await response.json();
  if (!response.ok) {
    const failure = Error(data.error || ('HTTP ' + response.status));
    failure.status = response.status;
    throw failure;
  }
  return data;
}
function error(message) { el('error').textContent = message || ''; }
function status(message) { el('label').textContent = message; return ++statusSeq; }
function clearStatus(token) { if (token === statusSeq) el('label').textContent = ''; }
function sourceName(mode) { return mode === 'demo' ? 'Synthetic demonstration' : 'PayPal sandbox'; }
function node(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}
function clearDraft(message = 'No draft requested.', state = 'empty') {
  handoff = null;
  el('download').disabled = true;
  el('proposal').replaceChildren(node('p', message));
  el('proposal').dataset.state = state;
}
function resetSelection(message = 'Select a subscription to read its current details.') {
  detailSeq++; draftSeq++; statusSeq++;
  current = null; selectedId = null;
  error('');
  el('draft').disabled = true;
  el('refresh-detail').disabled = true;
  el('selection-title').textContent = 'Subscription details';
  el('facts').replaceChildren(node('p', message, 'muted'));
  el('facts').dataset.state = 'empty';
  el('label').textContent = '';
  clearDraft();
}
function filterControls(enabled) {
  for (const id of ['search', 'status-filter', 'clear-filters']) el(id).disabled = !enabled;
}
function visibleItems() {
  if (!loaded) return [];
  const query = el('search').value.trim().toLowerCase();
  const filter = el('status-filter').value;
  return loaded.items.filter(item => (filter === 'ALL' || item.status === filter) &&
    (!query || [item.id, item.status, item.plan_id].some(value => String(value).toLowerCase().includes(query))));
}
function renderList() {
  const list = el('list');
  list.replaceChildren();
  if (!loaded) {
    el('list-count').textContent = '';
    list.append(node('li', 'Choose a source and load its subscriptions.', 'empty-list'));
    return;
  }
  const items = visibleItems();
  // A hidden selection must not remain eligible for a draft or download.
  if (selectedId && !items.some(item => item.id === selectedId)) resetSelection();
  el('list-count').textContent = items.length + ' of ' + loaded.items.length + ' loaded subscriptions shown.';
  if (!items.length) {
    list.append(node('li', loaded.items.length ? 'No loaded subscriptions match these filters.' : 'No subscriptions returned by this source.', 'empty-list'));
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'subscription-card';
    button.setAttribute('aria-current', item.id === selectedId ? 'true' : 'false');
    button.append(node('span', item.id, 'subscription-id'),
      node('span', item.status || 'Status not provided', 'subscription-status'),
      node('span', item.plan_id || 'Plan not provided', 'subscription-plan'));
    button.addEventListener('click', () => openItem(item.id, loaded.mode, true));
    li.append(button); list.append(li);
  }
}
function renderFacts(receipt, mode) {
  const facts = el('facts');
  facts.replaceChildren(); facts.dataset.state = 'ready';
  facts.append(node('p', sourceName(mode) + (mode === 'demo'
    ? ' · invented records; no PayPal read.' : ' · current sandbox subscription snapshot.'), 'source-note'));
  facts.append(node('p', receipt.rationale, 'rationale'));
  const grid = document.createElement('dl'); grid.className = 'fact-grid';
  const rows = [
    ['Subscription status', receipt.status], ['Review category', receipt.tier],
    ['Plan', receipt.plan_id || 'Not provided'],
    ['Last reported failed payment', receipt.last_failed_at || 'Not provided'],
    ['Next billing time', receipt.next_billing_at || 'Not provided'],
    ['Status updated', receipt.status_updated_at || 'Not provided'],
    ['Review fingerprint', receipt.fingerprint],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div'); row.className = 'fact-row';
    row.append(node('dt', label), node('dd', value)); grid.append(row);
  }
  facts.append(grid, node('p', 'Dates are shown as supplied. A missing field does not confirm payment success or the absence of a failure.', 'source-note'));
}
async function openItem(id, mode, moveFocus = false) {
  const token = ++detailSeq;
  draftSeq++; current = null; selectedId = id;
  el('draft').disabled = true; el('refresh-detail').disabled = true;
  el('selection-title').textContent = id;
  el('facts').replaceChildren(node('p', 'Reading subscription details…', 'muted'));
  el('facts').dataset.state = 'loading'; clearDraft(); error(''); renderList();
  if (moveFocus) el('selection-title').focus({preventScroll:true});
  const label = status(mode === 'demo' ? 'Reading demonstration record…' : 'Reading current sandbox state…');
  try {
    const data = await request('/api/detail?mode=' + mode + '&id=' + encodeURIComponent(id));
    if (token !== detailSeq || el('mode').value !== mode || selectedId !== id) return;
    if (data.mode !== mode || data.receipt?.subscription_id !== id || !data.receipt.fingerprint)
      throw Error('Subscription details do not match this selection. Refresh to read them again.');
    current = {mode, id, fingerprint:data.receipt.fingerprint};
    renderFacts(data.receipt, mode);
    el('draft').disabled = false;
  } catch (failure) {
    if (token !== detailSeq || el('mode').value !== mode || selectedId !== id) return;
    error(failure.message);
    el('facts').replaceChildren(node('p', 'Details could not be read. Refresh this subscription to try again.', 'muted'));
    el('facts').dataset.state = 'error';
  } finally {
    if (token === detailSeq && selectedId === id) el('refresh-detail').disabled = false;
    clearStatus(label);
  }
}
el('mode').addEventListener('change', () => {
  listSeq++; loaded = null; resetSelection(); error('');
  el('load').disabled = false;
  el('search').value = ''; el('status-filter').replaceChildren(new Option('All statuses', 'ALL'));
  el('coverage').textContent = ''; el('coverage').dataset.partial = 'false';
  filterControls(false); renderList();
});
el('load').addEventListener('click', async () => {
  const token = ++listSeq, mode = el('mode').value;
  loaded = null; resetSelection(); error(''); renderList(); filterControls(false);
  el('coverage').textContent = ''; el('coverage').dataset.partial = 'false';
  const label = status('Loading subscriptions…'); el('load').disabled = true;
  try {
    const data = await request('/api/list?mode=' + mode);
    if (token !== listSeq || el('mode').value !== mode) return;
    if (data.mode !== mode || !Array.isArray(data.items)) throw Error('Subscription list could not be read.');
    loaded = {...data, mode};
    el('coverage').textContent = mode === 'demo'
      ? data.items.length + ' synthetic demonstration records. No PayPal calls are made to load or filter this list.'
      : data.incomplete
        ? 'PARTIAL PayPal sandbox list: ' + data.items.length + ' subscriptions across ' + data.pages_read +
          ' pages (200-record cap). More may exist; this is not a merchant total.'
        : 'PayPal sandbox list: ' + data.items.length + ' subscriptions across ' + data.pages_read + ' page(s).';
    el('coverage').dataset.partial = String(mode === 'sandbox' && data.incomplete);
    const previous = el('status-filter').value;
    const statuses = [...new Set(data.items.map(item => item.status))].sort();
    el('status-filter').replaceChildren(new Option('All statuses', 'ALL'),
      ...statuses.map(value => new Option(value || 'Status not provided', value)));
    el('status-filter').value = statuses.includes(previous) ? previous : 'ALL';
    filterControls(true); renderList();
  } catch (failure) {
    if (token === listSeq && el('mode').value === mode) {
      error(failure.message);
      el('list').replaceChildren(node('li', 'The list could not be loaded. Check the source and load again.', 'empty-list'));
    }
  } finally {
    if (token === listSeq) el('load').disabled = false;
    clearStatus(label);
  }
});
for (const [id, event] of [['search', 'input'], ['status-filter', 'change']])
  el(id).addEventListener(event, renderList);
el('clear-filters').addEventListener('click', () => {
  el('search').value = ''; el('status-filter').value = 'ALL'; renderList(); el('search').focus();
});
el('refresh-detail').addEventListener('click', () => {
  if (selectedId && loaded) openItem(selectedId, loaded.mode);
});
el('draft').addEventListener('click', async () => {
  if (!current) return;
  const selected = {...current}, token = ++draftSeq;
  el('draft').disabled = true; error('');
  clearDraft('Preparing an unsent review draft…', 'loading');
  const stillCurrent = () => token === draftSeq && current &&
    current.mode === selected.mode && current.id === selected.id &&
    current.fingerprint === selected.fingerprint && el('mode').value === selected.mode;
  try {
    const response = await request('/api/draft', {method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(selected)});
    if (!stillCurrent()) return;
    if (response.mode !== selected.mode || response.receipt?.subscription_id !== selected.id ||
        response.receipt.fingerprint !== selected.fingerprint || response.sent !== false ||
        response.modified_subscription !== false || typeof response.proposal?.text !== 'string') {
      const failure = Error('The draft does not match this review. Refresh the subscription before continuing.');
      failure.requiresRefresh = true;
      throw failure;
    }
    const kind = response.proposal.available && response.proposal.kind === 'AI_GENERATED_UNSENT'
      ? 'AI-generated · unsent' : 'Rule-based preview · not AI-generated';
    el('proposal').replaceChildren(node('p', kind, 'draft-kind'),
      node('p', response.proposal.text, 'draft-text'),
      node('p', 'Not sent. Subscription unchanged. Review the wording before using it elsewhere.', 'draft-boundary'));
    el('proposal').dataset.state = 'ready';
    handoff = {mode:selected.mode, receipt:response.receipt, proposal:response.proposal, sent:false, modified_subscription:false};
    el('download').disabled = false;
  } catch (failure) {
    if (stillCurrent()) {
      error(failure.message);
      if (failure.status === 409 || failure.requiresRefresh) {
        current = null;
        el('facts').dataset.state = 'stale';
        el('facts').prepend(node('p', 'Refresh this subscription before requesting another draft; its review snapshot is no longer confirmed.', 'stale-note'));
        clearDraft('No draft saved. Refresh the subscription details to continue.', 'stale');
      } else clearDraft('No draft saved. You can refresh the subscription or explicitly request another draft.', 'error');
    }
  } finally { if (token === draftSeq) el('draft').disabled = !current; }
});
el('download').addEventListener('click', () => {
  if (!handoff || !current || handoff.mode !== current.mode ||
      handoff.receipt.subscription_id !== current.id || handoff.receipt.fingerprint !== current.fingerprint) return;
  const text = ['RenewalGuard — unsent review note',
    'Source: ' + sourceName(handoff.mode),
    'Subscription: ' + handoff.receipt.subscription_id,
    'Review fingerprint: ' + handoff.receipt.fingerprint,
    'Draft kind: ' + handoff.proposal.kind,
    'Sent: NO. Subscription modified: NO.', '', handoff.proposal.text, '',
    'Subscription facts supplied to this review:', JSON.stringify(handoff.receipt, null, 2), '',
    'This saved snapshot can become stale. Reopen RenewalGuard and refresh the record before a later review.'].join('\n');
  const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url;
  link.download = 'renewalguard-' + current.id + '-unsent.txt';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
filterControls(false);
resetSelection();
renderList();
