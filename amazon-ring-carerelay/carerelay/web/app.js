const $ = id => document.getElementById(id);
const filters = [...document.querySelectorAll('[data-filter]')];
const state = { status: 'pending', page: 1, data: null, selected: null, busy: false, current: false };
const labels = { accessibility_notice: 'Accessibility notice', caretaking_check_in: 'Caretaking check-in', device_health_review: 'Device health review' };
const humanize = value => String(value ?? 'Not provided').replaceAll('_', ' ');
const titleFor = proposal => labels[proposal.action] || humanize(proposal.action);
const append = (parent, tag, text, className) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  parent.append(element);
  return element;
};
const selectedItem = () => state.data?.items.find(item => item.proposal.proposal_id === state.selected);
const dateText = (value, compact = false) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value ?? 'Not provided');
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(date);
};
function announce(text = '') { $('announcement').textContent = text; }
function showError(text = '') { $('error-banner').textContent = text; $('error-banner').hidden = !text; }
function setConnection(text, kind = '') { $('connection').textContent = text; $('connection').className = `connection ${kind}`; }
function setBusy(value) {
  state.busy = value;
  $('inbox').setAttribute('aria-busy', String(value));
  for (const button of filters) button.disabled = value;
  $('refresh').disabled = value;
  const selection = state.data?.selection;
  $('previous').disabled = value || !selection || selection.page <= 1;
  $('next').disabled = value || !selection || selection.page >= selection.pages;
  for (const button of document.querySelectorAll('.proposal-item')) button.disabled = value;
  for (const button of $('decision-form').querySelectorAll('button')) button.disabled = value || !state.current;
  $('reviewer').disabled = value || !state.current;
}
async function request(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The local server returned an unreadable response. Refresh to recover saved state.'); }
  if (!response.ok) {
    const error = new Error(data.error || `The request could not be completed (HTTP ${response.status}).`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
function fact(parent, name, value) {
  const row = append(parent, 'div');
  append(row, 'dt', name);
  append(row, 'dd', value === null || value === undefined || value === '' ? 'Not provided' : value);
}
function renderDetail(focus = false) {
  const item = selectedItem();
  $('empty-detail').hidden = Boolean(item);
  $('detail-content').hidden = !item;
  if (!item) return;
  const { proposal, event, review } = item;
  const status = review?.decision || 'pending';
  $('detail-title').textContent = titleFor(proposal);
  $('detail-status').textContent = status === 'pending' ? 'Awaiting review' : status;
  $('detail-status').className = `status-badge ${status}`;
  $('rationale').textContent = proposal.rationale;
  $('event-time-short').textContent = dateText(event.occurred_at, true);
  $('event-facts').replaceChildren();
  fact($('event-facts'), 'Event', humanize(event.event_type));
  fact($('event-facts'), 'Classification', humanize(event.classification));
  fact($('event-facts'), 'Device', event.device_id);
  fact($('event-facts'), 'Zone', event.zone);
  fact($('event-facts'), 'Occurred at', dateText(event.occurred_at));
  fact($('event-facts'), 'Device health', event.device_health);
  $('decision-form').hidden = Boolean(review);
  $('recorded-decision').hidden = !review;
  if (review) {
    $('recorded-title').textContent = review.decision === 'approved' ? 'Approval recorded.' : 'Rejection recorded.';
    $('recorded-by').textContent = `Reviewed by ${review.approver}`;
  }
  $('record-facts').replaceChildren();
  for (const [name, value] of [['Proposal', proposal.proposal_id], ['Event', event.event_id], ['Revision', state.data.revision], ['Workspace', state.data.workspaceFile]]) {
    append($('record-facts'), 'dt', name);
    append($('record-facts'), 'dd', value);
  }
  setBusy(state.busy);
  if (focus) $('detail-title').focus({ preventScroll: false });
}
function renderList() {
  const { items, selection } = state.data;
  $('proposal-list').replaceChildren();
  if (!items.length) {
    append($('proposal-list'), 'p', selection.status === 'pending'
      ? 'No proposals are waiting for review. Choose another filter to see recorded decisions.'
      : 'No proposals match this filter.', 'list-message');
  }
  for (const item of items) {
    const status = item.review?.decision || 'pending';
    const button = append($('proposal-list'), 'button', undefined, 'proposal-item');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.proposal.proposal_id === state.selected));
    const top = append(button, 'span', undefined, 'item-top');
    append(top, 'span', status, `status-badge ${status}`);
    append(top, 'span', dateText(item.event.occurred_at, true), 'item-date');
    append(button, 'span', titleFor(item.proposal), 'item-title');
    append(button, 'span', [item.event.device_id, item.event.zone].filter(Boolean).join(' · '), 'item-meta');
    button.addEventListener('click', () => {
      if (state.busy) return;
      state.selected = item.proposal.proposal_id;
      for (const sibling of $('proposal-list').children) sibling.setAttribute('aria-pressed', String(sibling === button));
      renderDetail(true);
    });
  }
  $('queue-total').textContent = `${selection.total.toLocaleString()} ${selection.total === 1 ? 'proposal' : 'proposals'}`;
  $('page-label').textContent = selection.total ? `Page ${selection.page} of ${selection.pages}` : 'No results';
}
function render() {
  const { totals, selection, source, workspaceFile } = state.data;
  if (!selectedItem()) state.selected = state.data.items[0]?.proposal.proposal_id ?? null;
  state.page = selection.page;
  $('pending-total').textContent = totals.pending.toLocaleString();
  $('pending-caption').textContent = totals.pending === 1 ? 'One proposal to consider' : totals.pending ? 'Proposals to consider' : 'All current proposals reviewed';
  $('source-label').textContent = source === 'offline-simulator' ? 'OFFLINE SIMULATOR' : source === 'provider-candidate' ? 'PROVIDER CANDIDATE · UNVERIFIED' : String(source);
  const filename = String(workspaceFile).split(/[\\/]/).pop();
  $('workspace-name').textContent = filename;
  $('workspace-name').title = String(workspaceFile);
  $('workspace-counts').textContent = `${totals.events.toLocaleString()} events · ${totals.approved.toLocaleString()} approved · ${totals.rejected.toLocaleString()} rejected · ${totals.quiet.toLocaleString()} quiet`;
  for (const button of filters) button.setAttribute('aria-pressed', String(button.dataset.filter === state.status));
  renderList();
  renderDetail();
}
async function loadInbox({ notice = '', keepError = false } = {}) {
  if (!keepError) showError();
  if (!notice) announce();
  state.current = false;
  setBusy(true);
  setConnection('Refreshing');
  try {
    const params = new URLSearchParams({ status: state.status, page: String(state.page), pageSize: '25' });
    const data = await request(`/api/inbox?${params}`);
    if (!data || !Array.isArray(data.items) || !data.selection || !data.totals || typeof data.revision !== 'string') throw new Error('The server did not return a complete inbox. Refresh to recover saved state.');
    state.data = data;
    state.current = true;
    render();
    setConnection('Saved state loaded', 'ready');
    announce(notice);
    return true;
  } catch (error) {
    setConnection('Connection unavailable', 'error');
    showError(error.message || 'Could not load the local workspace. Check the server and refresh.');
    if (!state.data) $('proposal-list').replaceChildren(append(document.createDocumentFragment(), 'p', 'The workspace could not be loaded. Use Refresh saved state to try again.', 'list-message'));
    return false;
  } finally { setBusy(false); }
}
for (const button of filters) button.addEventListener('click', () => {
  if (state.busy || state.status === button.dataset.filter) return;
  state.status = button.dataset.filter;
  state.page = 1;
  state.selected = null;
  loadInbox();
});
$('previous').addEventListener('click', () => { if (!state.busy && state.page > 1) { state.page--; state.selected = null; loadInbox(); } });
$('next').addEventListener('click', () => { if (!state.busy && state.page < state.data.selection.pages) { state.page++; state.selected = null; loadInbox(); } });
$('refresh').addEventListener('click', () => loadInbox({ notice: 'The inbox now shows the latest saved state.' }));
try { $('reviewer').value = sessionStorage.getItem('carerelay.reviewer') || ''; } catch { /* Attribution can still be entered without browser storage. */ }
$('reviewer').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('decision-form').querySelector('button[value="approved"]').focus();
  }
});
$('decision-form').addEventListener('submit', async event => {
  event.preventDefault();
  const item = selectedItem();
  if (state.busy || !state.current || !item || item.review) return;
  const decision = event.submitter?.value;
  if (decision !== 'approved' && decision !== 'rejected') return;
  const reviewer = $('reviewer').value.trim();
  if (!reviewer || [...reviewer].length > 96 || /[^\p{L}\p{N}_.:-]/u.test(reviewer)) {
    showError('Enter a reviewer ID using letters, numbers, dots, dashes, underscores, or colons.');
    $('reviewer').focus();
    return;
  }
  const proposalId = item.proposal.proposal_id;
  const revision = state.data.revision;
  state.current = false;
  showError();
  announce('Saving your decision…');
  setBusy(true);
  try {
    const result = await request('/api/reviews', { revision, proposalId, reviewer, decision });
    if (result.saved !== true) throw new Error('The server did not confirm the saved decision.');
    try { sessionStorage.setItem('carerelay.reviewer', reviewer); } catch { /* Saving a review does not require browser storage. */ }
    const loaded = await loadInbox({ notice: `${decision === 'approved' ? 'Approval' : 'Rejection'} recorded. The current workspace is ready to download.` });
    if (!loaded) announce('The decision was saved, but the inbox could not refresh. Refresh saved state before recording another decision.');
  } catch (error) {
    const stale = error.status === 409 && error.code === 'stale_revision';
    const explanation = stale
      ? 'The workspace changed before this decision was saved. Current records were refreshed; your decision was not resubmitted.'
      : 'The save could not be confirmed. Current records were refreshed; check the recorded decision before trying again. ' + (error.message || '');
    const loaded = await loadInbox({ notice: explanation });
    if (!loaded) {
      announce();
      showError('The decision could not be confirmed and saved state is unavailable. Refresh before trying another review.');
    }
  } finally { setBusy(false); }
});
loadInbox();
