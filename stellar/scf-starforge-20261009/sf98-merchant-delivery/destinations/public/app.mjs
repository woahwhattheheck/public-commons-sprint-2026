const byId = id => document.getElementById(id);
const number = value => Number(value ?? 0).toLocaleString();
let snapshot = null, selectedId = null, page = null, offset = 0, busy = false;
const cell = (row, value, className) => { const item = document.createElement('td'); item.textContent = value ?? '—'; if (className) item.className = className; row.append(item); return item; };
const button = (text, action, className = '') => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.className = className; node.addEventListener('click', action); return node; };
const notice = (text, error = false) => { byId('notice').textContent = text; byId('notice').className = error ? 'error' : ''; };
const selected = () => snapshot?.destinations.find(item => item.id === selectedId && !item.error);
function summaryResult(result) {
  if (result?.results) return result.results.map(item => item.id + ': ' + (item.ok === false ? item.code :
    item.paused ? 'paused' : item.delivery ? item.delivery.deliveredThisRun + ' accepted, ' + item.delivery.pending + ' pending' :
    item.copied + ' copied, ' + item.alreadyCopied + ' already retained')).join(' · ') || 'No destinations selected.';
  return result?.eventId ? 'Original notice requeued for ' + result.destinationId + '.' : result?.state ? 'Worker: ' + result.state : result?.id ? 'Saved destination ' + result.id + '.' : 'Operation completed.';
}
async function api(path, input) {
  const response = await fetch('./api/' + path, input === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-sf98-session': snapshot.session }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? data.code ?? 'Operation failed.');
  return data;
}
async function action(name, data, callback) {
  if (busy) return;
  busy = true; notice('Working…'); renderDisabled();
  try { const result = await api(name, data); if (callback) callback(result); await refresh(false); notice(summaryResult(result), result?.results?.some(item => !item.ok)); }
  catch (error) { notice(error.message, true); }
  finally { busy = false; renderDisabled(); }
}
function renderDisabled() {
  document.querySelectorAll('button').forEach(node => { node.disabled = busy; });
  const value = selected();
  byId('start-worker').disabled = busy || snapshot?.worker.owner.active || !snapshot?.destinations.some(item => !item.error && !item.paused);
  byId('stop-worker').disabled = busy || !snapshot?.worker.owner.active;
  byId('drain-one').disabled = busy || !value || value.paused || !value.secretAvailable || value.continuity !== 'CURRENT' || value.deliveryOwner.active;
  byId('sync-one').disabled = busy || !value || value.continuity !== 'CURRENT' || value.deliveryOwner.active;
  byId('toggle-pause').disabled = busy || !value || value.deliveryOwner.active;
  byId('previous').disabled = busy || offset === 0 || !page;
  byId('next').disabled = busy || page?.nextOffset == null;
  document.querySelectorAll('[data-requeue]').forEach(node => { node.disabled = busy || !value || value.deliveryOwner.active; });
}
function renderDestinations() {
  const body = byId('destinations'); body.replaceChildren();
  byId('empty').hidden = snapshot.destinations.length > 0;
  for (const item of snapshot.destinations) {
    const row = document.createElement('tr'); if (item.id === selectedId) row.className = 'selected';
    const title = document.createElement('td');
    title.append(button(item.label ?? item.id, async () => { selectedId = item.id; offset = 0; renderDestinations(); renderSelected(); await loadEvents(); }, 'text-button'));
    const detail = document.createElement('span'); detail.className = 'sub'; detail.textContent = item.url ?? item.error; title.append(detail); row.append(title);
    cell(row, item.error ? 'ERROR' : item.paused ? 'PAUSED' : 'ACTIVE');
    cell(row, item.outbox?.delivered); cell(row, item.outbox?.pending); cell(row, item.outbox?.exhausted);
    cell(row, item.continuity === 'SOURCE_CHANGED' ? 'Source changed' : item.sourceEventsRemaining);
    cell(row, item.secretAvailable ? 'Available' : 'Unavailable'); body.append(row);
  }
}
function renderSelected() {
  const item = selected(); byId('selected').hidden = !item; byId('selected-empty').hidden = Boolean(item);
  if (!item) { renderDisabled(); return; }
  byId('selected-label').textContent = item.label;
  byId('selected-meta').replaceChildren();
  const values = { Endpoint: item.url, ID: item.id, Revision: item.revision,
    Routes: item.routeIds.join(', ') || 'Every route', Networks: item.networks.join(', ') || 'Every network',
    Enrollment: item.history === 'all' ? 'Includes matching earlier events' : 'Starts after original event ' + number(item.enrollment.count),
    'Source checkpoint': number(item.cursor.count) + ' original events',
    'Signing reference': item.secretEnv, 'Delivery owner': item.deliveryOwner.active ? 'Active operation' : 'Available',
    Continuity: item.continuity === 'CURRENT' ? 'Original source prefix matches' : 'Original source changed' };
  for (const [key, value] of Object.entries(values)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value;
    byId('selected-meta').append(dt, dd);
  }
  byId('toggle-pause').textContent = item.paused ? 'Resume receiver' : 'Pause receiver'; renderDisabled();
}
function renderWorker() {
  const value = snapshot.worker, run = value.run;
  byId('worker-state').textContent = value.owner.active ? 'Running' : value.previousRunNeedsReopen ? 'Interrupted' : run?.state === 'FAILED' ? 'Failed' : 'Stopped';
  byId('worker-detail').textContent = value.previousRunNeedsReopen ?
    'The previous process ended during its run. Start the worker to continue from each destination’s saved native state.' :
    run ? 'Run ' + run.id + ' · ' + number(run.cycles) + ' completed cycles · updated ' + run.updatedAt : 'Start a worker after enrolling the intended receivers.';
  byId('cycle-summary').hidden = !run?.lastCycle;
  if (run?.lastCycle) byId('cycle-summary').textContent = summaryResult(run.lastCycle);
}
async function loadEvents() {
  const item = selected(), body = byId('events'); body.replaceChildren();
  if (!item) { page = null; byId('page-detail').textContent = 'Select a destination.'; renderDisabled(); return; }
  try {
    page = await api('destinations/' + item.id + '/events?state=' + byId('event-filter').value + '&offset=' + offset + '&limit=50');
    for (const entry of page.rows) {
      const row = document.createElement('tr'), event = entry.event, delivery = entry.delivery;
      const inspect = document.createElement('td'); inspect.append(button(event.id.slice(0, 14) + '…', () => {
        byId('event-detail').textContent = JSON.stringify(entry, null, 2); byId('event-inspector').open = true;
      }, 'text-button')); row.append(inspect); cell(row, event.method + ' ' + event.routeId); cell(row, event.orderReference);
      cell(row, delivery?.state ?? 'PENDING'); cell(row, delivery?.attempt ?? 0); cell(row, delivery?.nextAt);
      const controls = document.createElement('td');
      if (delivery?.state === 'EXHAUSTED') {
        const requeue = button('Requeue', () => action('requeue', { id: item.id, eventId: event.id,
          expectedRevision: item.revision, expectedDeliveryRevision: entry.deliveryRevision }));
        requeue.dataset.requeue = event.id; controls.append(requeue);
      }
      row.append(controls); body.append(row);
    }
    byId('page-detail').textContent = page.total ? number(offset + 1) + '–' + number(offset + page.rows.length) + ' of ' + number(page.total) : 'No matching notices.';
  } catch (error) { page = null; notice(error.message, true); }
  renderDisabled();
}
async function refresh(showNotice = true) {
  snapshot = await api('state');
  if (selectedId && !snapshot.destinations.some(item => item.id === selectedId)) selectedId = null;
  if (!selectedId) selectedId = snapshot.destinations.find(item => !item.error)?.id ?? null;
  byId('source-count').textContent = number(snapshot.source.events); byId('destination-count').textContent = number(snapshot.destinations.length);
  byId('pending-count').textContent = number(snapshot.destinations.reduce((sum, item) => sum + (item.outbox?.pending ?? 0), 0));
  byId('observed').textContent = 'Observed ' + snapshot.observedAt; byId('source-path').textContent = 'Original outbox: ' + snapshot.sourceDirectory;
  renderDestinations(); renderSelected(); renderWorker(); await loadEvents();
  if (showNotice) notice('Current original source and receiver histories loaded.');
}
byId('refresh').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
byId('sync-all').addEventListener('click', () => action('sync', {}));
byId('sync-one').addEventListener('click', () => action('sync', { id: selectedId }));
byId('drain-one').addEventListener('click', () => action('drain', { id: selectedId }));
byId('toggle-pause').addEventListener('click', () => { const item = selected(); if (item) action('pause', { id: item.id, paused: !item.paused, expectedRevision: item.revision }); });
byId('stop-worker').addEventListener('click', () => action('stop', {}));
byId('worker-form').addEventListener('submit', event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); action('start', Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Number(value)]))); });
byId('enroll-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  for (const key of ['routeIds', 'networks']) data[key] = data[key].split(',').map(item => item.trim()).filter(Boolean);
  action('enroll', data, result => { selectedId = result.id; offset = 0; form.reset(); });
});
byId('event-filter').addEventListener('change', () => { offset = 0; loadEvents(); });
byId('previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); loadEvents(); });
byId('next').addEventListener('click', () => { if (page?.nextOffset != null) { offset = page.nextOffset; loadEvents(); } });
refresh().catch(error => notice(error.message, true));
setInterval(() => { if (!busy && !document.hidden && snapshot?.worker.owner.active) refresh(false).catch(error => notice(error.message, true)); }, 5000);
