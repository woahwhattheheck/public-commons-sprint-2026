// MIT. The original running seller owns every availability decision.
const $ = id => document.getElementById(id);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const labels = { selling: 'Selling', paused: 'Paused', pausing: 'Finishing work', storage_unavailable: 'Storage unavailable' };
const messages = {
  AVAILABILITY_REVISION_CHANGED: 'Another operator changed availability. The current revision has been loaded. Review it and submit your selection again.',
  AVAILABILITY_CONTROL_TOKEN_REQUIRED: 'Open the complete private availability URL printed by this running seller. Its capability changes after restart.',
  AVAILABILITY_ROUTE_UNKNOWN: 'A selected product no longer belongs to this seller. Refresh the products before making another change.',
  AVAILABILITY_SAVE_FAILED: 'The seller could not finish saving this decision. Refresh the current revision and check its private storage before continuing.',
  AVAILABILITY_CHANGE_INVALID: 'Select 1–100 products and use a note of at most 160 characters without line breaks.',
  AVAILABILITY_NOT_CONFIGURED: 'Start this seller with an absolute private --availability-dir.',
  AVAILABILITY_STATE_UNAVAILABLE: 'The seller availability store is unavailable. Check the running seller and refresh this view.',
  AVAILABILITY_LEASE_LOST: 'The running seller lost its private availability-store lease. Restart it with its original private directory.',
};
let token = '', view = null, busy = false, refreshPending = false, selected = new Set(), draftRevision = null, timer;
function adoptToken() {
  if (!location.hash) return;
  token = /^[a-f0-9]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : '';
  history.replaceState(null, '', location.pathname + location.search);
}
adoptToken();
const date = value => value ? new Date(value).toLocaleString() : '—';
const notice = (text, failure = false) => { $('notice').textContent = text; $('notice').dataset.error = String(failure); };
async function api(body) {
  const response = await fetch('/api/availability' + (body === undefined ? '' : '/change'), {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-merchant-availability-token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The local seller returned an unreadable response. Refresh its current state before another decision.'); }
  if (!response.ok) throw Object.assign(new Error(messages[result.error] ?? 'The seller could not accept this change (' + (result.error ?? response.status) + ').'), { code: result.error });
  return result;
}
function visibleRoutes() {
  const term = $('filter').value.trim().toLowerCase(), state = $('state-filter').value;
  return (view?.routes ?? []).filter(route => (!state || route.state === state) &&
    (!term || [route.id, route.path, route.method, route.description, route.reason].join(' ').toLowerCase().includes(term)));
}
function toggle(id, value) {
  if (value) { if (!selected.size) draftRevision = view.revision; selected.add(id); }
  else selected.delete(id);
  if (!selected.size) draftRevision = null;
  renderProducts(); renderSelection();
}
function renderProducts() {
  const focusedRoute = document.activeElement?.dataset?.route;
  const rows = visibleRoutes();
  $('products').replaceChildren(...rows.map(route => {
    const row = element('tr'); row.dataset.selected = String(selected.has(route.id));
    const checkCell = element('td'), check = element('input'); check.type = 'checkbox';
    check.checked = selected.has(route.id); check.disabled = busy; check.dataset.route = route.id;
    check.setAttribute('aria-label', 'Select ' + route.id); check.addEventListener('change', () => toggle(route.id, check.checked));
    checkCell.append(check); row.append(checkCell);
    const name = element('th', route.id); name.scope = 'row';
    name.append(element('span', route.method + ' ' + route.path, 'product-route'));
    if (route.description) name.append(element('span', route.description, 'product-description'));
    row.append(name);
    const stateCell = element('td'), state = element('span', labels[route.state] ?? route.state, 'state');
    state.dataset.state = route.state; stateCell.append(state); row.append(stateCell);
    row.append(element('td', String(route.inFlight ?? 0)), element('td', route.reason || '—', 'reason'), element('td', date(route.changedAt), 'date'));
    return row;
  }));
  $('products-empty').hidden = rows.length !== 0;
  const chosen = rows.filter(row => selected.has(row.id)).length;
  $('select-visible').checked = rows.length > 0 && chosen === rows.length;
  $('select-visible').indeterminate = chosen > 0 && chosen < rows.length;
  $('select-visible').disabled = busy || !rows.length;
  $('retired-panel').hidden = !(view?.retiredPauses?.length);
  $('retired-products').replaceChildren(...(view?.retiredPauses ?? []).map(route => {
    const label = element('label'), check = element('input'); check.type = 'checkbox'; check.checked = selected.has(route.id); check.disabled = busy; check.dataset.route = route.id;
    check.addEventListener('change', () => toggle(route.id, check.checked));
    label.append(check, element('span', route.id + (route.reason ? ' · ' + route.reason : ''))); return label;
  }));
  if (focusedRoute) [...document.querySelectorAll('input[data-route]')].find(input => input.dataset.route === focusedRoute)?.focus({ preventScroll: true });
}
function renderSelection() {
  const enabled = Boolean(view?.controlsEnabled && token), available = Boolean(view?.available);
  $('control-mode').textContent = enabled ? 'Controls enabled' : 'Read only';
  $('access-help').textContent = enabled ? 'Changes are saved by this running seller and survive a restart with the same private directory.' :
    'Open the complete private availability URL printed at startup to enable changes in this tab.';
  $('selection-summary').textContent = selected.size ? `${selected.size} selected · Decision based on revision ${draftRevision}` : 'Select one or more products above.';
  const pause = $('action').value === 'pause';
  const retiredSelected = (view?.retiredPauses ?? []).some(row => selected.has(row.id));
  $('change-fields').disabled = busy || !enabled || !available;
  $('apply').disabled = busy || refreshPending || !enabled || !selected.size || selected.size > 100 || (pause && retiredSelected);
  $('apply').textContent = pause ? 'Pause selected' : 'Resume selected';
  $('change-effect').textContent = pause && retiredSelected ? 'Removed products can only have their saved pause cleared. Choose Resume for this selection.' :
    selected.size > 100 ? 'A single decision can change up to 100 products. Reduce the selection.' : pause ?
      'Selected products stop accepting new requests. Admitted work continues until its original request finishes.' :
      'Selected products accept new requests again. Any saved pauses for removed product IDs are cleared.';
  $('selected-products').replaceChildren(...[...selected].sort().map(id => element('li', id)));
  $('clear-selection').disabled = busy || !selected.size; $('refresh').disabled = busy || refreshPending;
}
function render(next) {
  view = next; $('setup').hidden = next.available; $('workspace').hidden = !next.available;
  if (!next.available) { renderSelection(); return; }
  const ids = new Set([...next.routes, ...next.retiredPauses].map(row => row.id));
  selected = new Set([...selected].filter(id => ids.has(id))); if (!selected.size) draftRevision = null;
  $('selling-count').textContent = next.routes.filter(row => row.state === 'selling').length;
  $('paused-count').textContent = next.routes.filter(row => row.state === 'paused').length;
  $('draining-count').textContent = next.routes.filter(row => row.state === 'pausing').length;
  $('revision').textContent = next.revision; $('service-origin').textContent = next.serviceOrigin;
  $('saved-at').textContent = 'Last saved ' + date(next.savedAt);
  $('changes').replaceChildren(...next.recentChanges.map(change => {
    const row = element('tr'); row.append(element('th', String(change.revision)), element('td', change.action === 'pause' ? 'Pause' : 'Resume'),
      element('td', change.routeIds.join(', '), 'changes-products'), element('td', change.reason || '—', 'reason'), element('td', date(change.at), 'date')); return row;
  }));
  $('changes-empty').hidden = next.recentChanges.length !== 0;
  renderProducts(); renderSelection();
}
async function refresh(manual = false) {
  if (refreshPending || busy) return;
  refreshPending = true; renderSelection();
  try {
    const previous = view?.revision, next = await api(); render(next);
    if (manual) { if (selected.size) draftRevision = next.revision; renderSelection(); notice('Loaded the current seller availability.'); }
    else if (previous !== undefined && next.revision !== previous) notice('Availability changed in another operator session. Your selected decision still uses its original revision; refresh to review the current state.');
    else if (previous === undefined) notice(next.available ? 'Loaded the running seller and its saved availability.' : next.message);
  } catch (failure) { notice(failure.message, true); }
  finally { refreshPending = false; renderSelection(); }
}
$('filter').addEventListener('input', renderProducts); $('state-filter').addEventListener('change', renderProducts);
$('select-visible').addEventListener('change', () => {
  if (!selected.size) draftRevision = view.revision;
  for (const route of visibleRoutes()) { if ($('select-visible').checked) selected.add(route.id); else selected.delete(route.id); }
  if (!selected.size) draftRevision = null;
  renderProducts(); renderSelection();
});
$('clear-selection').addEventListener('click', () => { selected.clear(); draftRevision = null; renderProducts(); renderSelection(); });
$('action').addEventListener('change', renderSelection); $('refresh').addEventListener('click', () => refresh(true));
$('change-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || refreshPending || $('apply').disabled) return;
  const input = { expectedRevision: draftRevision, action: $('action').value, routeIds: [...selected].sort(), reason: $('reason').value };
  busy = true; renderProducts(); renderSelection();
  try {
    const next = await api(input); selected.clear(); draftRevision = null; $('reason').value = ''; render(next);
    notice(`${input.action === 'pause' ? 'Paused' : 'Resumed'} ${input.routeIds.length} product${input.routeIds.length === 1 ? '' : 's'}. Saved revision ${next.revision}.`);
  } catch (failure) {
    try { const next = await api(); render(next); if (selected.size) draftRevision = next.revision; } catch {}
    notice(failure.message, true);
  } finally { busy = false; renderProducts(); renderSelection(); }
});
addEventListener('hashchange', () => { adoptToken(); renderSelection(); });
addEventListener('pagehide', () => clearInterval(timer));
await refresh();
timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
