// MIT. Saved service-health operations in the original private merchant editor.
const $ = (root, id) => root.querySelector('#' + id);
const short = value => value ? value.slice(0, 12) : 'none';
const pretty = value => JSON.stringify(value, null, 2);
const node = (tag, value, className) => {
  const item = document.createElement(tag); if (value !== undefined) item.textContent = value;
  if (className) item.className = className; return item;
};
const action = (label, run) => {
  const item = node('button', label, 'secondary'); item.type = 'button'; item.addEventListener('click', run); return item;
};
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function mountGrpcHealth({ root, json, work, notice, storageKey, savedCurrent, getRevision }) {
  root.classList.add('grpc-health');
  root.innerHTML = '<div class="columns"><article><h2>Service health</h2>' +
    '<p>Check the saved endpoint’s reported health, list its reported services, or retain a Watch as status changes arrive. The saved TLS and metadata references are used for each connection.</p>' +
    '<p id="health-source" class="hint"></p><div class="form-row">' +
    '<label>Observation<select id="health-kind"><option value="check">Check one service</option><option value="list">List reported services</option><option value="watch">Watch one service</option></select></label>' +
    '<label id="health-service-field">Service · empty means whole server<input id="health-service" list="health-known-services" maxlength="1024" autocomplete="off"><datalist id="health-known-services"></datalist></label></div>' +
    '<label>Native call deadline · milliseconds<input id="health-timeout" type="number" min="1" max="300000" step="1" value="30000" required></label>' +
    '<div id="health-watch-fields" class="form-row" hidden><label>Observation duration · milliseconds<input id="health-duration" type="number" min="1" max="3600000" step="1" value="60000" required></label>' +
    '<label>Maximum native events<input id="health-max-events" type="number" min="1" max="10000" step="1" value="1000" required></label></div>' +
    '<p class="hint">A Watch reconnects inside this original observation window. Silence keeps the last reported value. SERVICE_UNKNOWN remains subscribed for a later change.</p>' +
    '<div class="actions"><button id="health-start" type="button">Start observation</button><button id="health-recover" class="secondary" type="button" hidden>Recover last operation</button></div>' +
    '<p id="health-action-status" role="status" class="hint"></p>' +
    '<h3>Retained observations</h3><div class="actions"><label class="check-label"><input id="health-current-only" type="checkbox">Current saved revision</label><button id="health-history-refresh" class="secondary" type="button">Refresh history</button></div>' +
    '<div id="health-history" class="list"></div><div class="actions"><button id="health-history-previous" type="button" class="secondary">Previous observations</button><span id="health-history-page" class="hint"></span><button id="health-history-next" type="button" class="secondary">Next observations</button></div>' +
    '</article><article><h2>Original observation</h2><p id="health-selected">Choose a retained observation.</p>' +
    '<div id="health-summary" class="health-facts"></div><div class="actions"><button id="health-stop" type="button" class="secondary" disabled>Stop this Watch</button><button id="health-resume" type="button" class="secondary" disabled>Resume original Watch</button><button id="health-export" type="button" class="secondary" disabled>Download complete observation</button></div>' +
    '<p id="health-binding" class="hint"></p><p class="hint">History keeps the endpoint’s native observations and connection outcomes. Channel readiness and service health are shown separately in the original merchant review.</p>' +
    '<h3>Native history</h3><label class="check-label"><input id="health-follow" type="checkbox" checked>Follow latest events</label><div class="health-table"><table><thead><tr><th scope="col">#</th><th scope="col">Observed at</th><th scope="col">Event</th><th scope="col">Details</th></tr></thead><tbody id="health-events"></tbody></table></div>' +
    '<div class="actions"><button id="health-events-previous" class="secondary" type="button">Previous events</button><span id="health-events-page" class="hint"></span><button id="health-events-next" class="secondary" type="button">Next events</button></div>' +
    '<section id="health-services-section" hidden><h3>Reported services</h3><p class="hint">List is a native snapshot and can change while the server gathers it.</p>' +
    '<label>Find a reported service<input id="health-service-filter" type="search" maxlength="512" autocomplete="off"></label><div class="health-table"><table><thead><tr><th scope="col">Service</th><th scope="col">Reported status</th></tr></thead><tbody id="health-services"></tbody></table></div>' +
    '<div class="actions"><button id="health-services-previous" class="secondary" type="button">Previous services</button><span id="health-services-page" class="hint"></span><button id="health-services-next" class="secondary" type="button">Next services</button></div></section>' +
    '<details><summary>Saved observation request and source references</summary><pre id="health-request"></pre></details></article></div>';

  let inventory, selected = null, read = null, page = null, servicesPage = null, listPage = null;
  let historyOffset = 0, historySnapshot, generation = 0, poll = null, polling = false, ticks = 0, pending = null;
  const E = id => $(root, id), call = (name, body) => json('health-' + name, body);
  try { pending = JSON.parse(sessionStorage.getItem(storageKey + ':health-pending') ?? 'null'); } catch {}
  let lastId;
  try { lastId = sessionStorage.getItem(storageKey + ':health-last'); } catch {}
  function savePending(value) {
    pending = value;
    try {
      if (value) sessionStorage.setItem(storageKey + ':health-pending', JSON.stringify(value));
      else sessionStorage.removeItem(storageKey + ':health-pending');
    } catch {}
    E('health-recover').hidden = !pending && !lastId;
  }
  function configure() {
    const kind = E('health-kind').value;
    E('health-watch-fields').hidden = kind !== 'watch'; E('health-service-field').hidden = kind === 'list';
    E('health-start').textContent = kind === 'watch' ? 'Start Watch' : kind === 'list' ? 'List reported services' : 'Check service';
  }
  function inputs() {
    const kind = E('health-kind').value, request = { kind };
    for (const [id, key] of [['health-timeout', 'timeoutMs'], ...(kind === 'watch' ?
      [['health-duration', 'durationMs'], ['health-max-events', 'maxEvents']] : [])]) {
      const control = E(id);
      if (!control.checkValidity()) { control.reportValidity(); throw new Error('Correct the health observation limits.'); }
      request[key] = Number(control.value);
      if (!Number.isSafeInteger(request[key])) throw new Error('Health limits must be whole numbers.');
    }
    if (kind !== 'list') request.service = E('health-service').value;
    return { revision: savedCurrent(), request };
  }
  function showSummary(value) {
    read = value; const o = value.operation;
    E('health-selected').textContent = o.kind.toUpperCase() + ' · ' + (o.kind === 'list' ? 'reported service inventory' : o.service || 'whole server') + ' · ' + o.id;
    E('health-summary').replaceChildren();
    for (const [label, item] of [['Operation', o.phase], ['Reported health', o.reportedStatus ?? (o.kind === 'list' ? o.services + ' services' : 'No status observed')],
      ['Last status', o.lastObservedAt ?? 'No status observed'], ['Native connections', o.connections],
      ['Status updates', o.updates], ['End reason', o.reason]]) {
      const row = node('div'); row.append(node('strong', label), node('span', String(item))); E('health-summary').append(row);
    }
    E('health-binding').textContent = o.target + ' · saved revision ' + short(o.revision) +
      (o.appliesToSelectedRevision ? ' · current selected revision' : ' · a different saved revision') +
      ' · original deadline ' + o.deadlineAt;
    E('health-stop').disabled = !o.runningHere;
    E('health-resume').disabled = o.kind !== 'watch' || !['INTERRUPTED', 'CANCELLED'].includes(o.phase) ||
      !o.appliesToSelectedRevision || Date.parse(o.deadlineAt) <= Date.now();
    E('health-export').disabled = false;
    E('health-services-section').hidden = o.kind !== 'list';
    E('health-request').textContent = pretty({ operationId: o.id, operationSha256: o.operationSha256,
      sourceSha256: o.sourceSha256, protocolSha256: value.protocolSha256, request: value.request, source: value.source });
  }
  function eventDetail(event) {
    const d = event.data;
    if (event.kind !== 'native') return d.phase + ' · ' + d.reason;
    if (d.type === 'status') return Array.isArray(d.statuses) ? d.statuses.length + ' reported services' :
      (d.service || 'whole server') + ' · ' + (d.status?.name ?? 'UNKNOWN');
    if (d.type === 'opening') return 'Native connection ' + d.connection;
    if (d.type === 'retry') return 'Reconnect in ' + d.delayMs + ' ms · ' + (d.grpcStatus ?? d.error ?? '');
    return [d.grpcCode, d.grpcStatus, d.error].filter(value => value !== undefined && value !== null).join(' · ');
  }
  function showEvents(value) {
    page = value.page; E('health-events').replaceChildren();
    for (const event of value.events ?? []) {
      const row = node('tr');
      for (const cell of [event.sequence, event.observedAt, event.kind === 'native' ? event.data.type : event.kind, eventDetail(event)])
        row.append(node('td', String(cell)));
      E('health-events').append(row);
    }
    E('health-events-page').textContent = page.total ? (page.afterSequence + 1) + '–' +
      Math.min(page.throughSequence, page.afterSequence + (value.events?.length ?? 0)) + ' of ' + page.total : 'No events yet';
    E('health-events-previous').disabled = !page.afterSequence;
    E('health-events-next').disabled = page.nextAfterSequence === null;
  }
  async function eventsAt(after, pinned = false) {
    if (!selected) return;
    const ticket = generation, body = { id: selected, afterSequence: after, limit: 50 };
    if (pinned && page) { body.throughSequence = page.throughSequence; body.expectedSnapshot = page.snapshot; }
    const value = await call('read', body);
    if (ticket !== generation) return;
    showSummary(value); showEvents(value);
  }
  async function servicesAt(after = 0, pinned = false) {
    if (!selected || read?.operation.kind !== 'list') return;
    const ticket = generation, body = { id: selected, section: 'services', afterSequence: after,
      limit: 50, serviceFilter: E('health-service-filter').value };
    if (pinned && servicesPage) { body.throughSequence = servicesPage.throughSequence; body.expectedSnapshot = servicesPage.snapshot; }
    const value = await call('read', body);
    if (ticket !== generation) return;
    servicesPage = value.page; E('health-services').replaceChildren();
    for (const service of value.services) {
      const row = node('tr'); row.append(node('td', service.service || 'Whole server'), node('td', service.status.name));
      E('health-services').append(row);
    }
    E('health-services-page').textContent = value.page.total ? (after + 1) + '–' +
      (after + value.services.length) + ' of ' + value.page.total + ' matching · ' + value.sourceServices + ' retained' : 'No matching reported services';
    E('health-services-previous').disabled = !after; E('health-services-next').disabled = value.page.nextAfterSequence === null;
  }
  async function openOriginal(id) {
    selected = id; lastId = id; ++generation; page = null; servicesPage = null;
    try { sessionStorage.setItem(storageKey + ':health-last', id); } catch {}
    const ticket = generation, value = await call('read', { id, section: 'summary' });
    if (ticket !== generation) return;
    showSummary(value);
    await eventsAt(Math.max(0, value.operation.version - 50));
    if (value.operation.kind === 'list') await servicesAt();
    savePending(pending); schedule();
  }
  async function historyAt(offset = 0, pinned = false) {
    const body = { offset, limit: 50 };
    if (E('health-current-only').checked) {
      if (!inventory?.currentRevision) { E('health-history').replaceChildren(node('p', 'No saved revision selected.')); return; }
      body.revision = inventory.currentRevision;
    }
    if (pinned) body.expectedSnapshot = historySnapshot;
    const value = await call('list', body);
    historyOffset = offset; historySnapshot = value.snapshot; listPage = value;
    E('health-history').replaceChildren();
    for (const row of value.items) {
      const item = node('div', undefined, 'item');
      item.append(node('strong', row.kind.toUpperCase() + ' · ' + (row.kind === 'list' ? row.services + ' services' : row.service || 'whole server')),
        node('p', row.phase + ' · ' + (row.reportedStatus ?? row.reason) + ' · ' + row.createdAt),
        action('Open original observation', () => work(() => openOriginal(row.id))));
      E('health-history').append(item);
    }
    if (!value.items.length) E('health-history').append(node('p', 'No observations in this selection.'));
    E('health-history-page').textContent = value.total ? (offset + 1) + '–' + (offset + value.items.length) + ' of ' + value.total : '0 observations';
    E('health-history-previous').disabled = !offset; E('health-history-next').disabled = value.nextOffset === null;
  }
  function schedule() {
    clearTimeout(poll);
    if (read?.operation.runningHere) poll = setTimeout(tick, document.hidden ? 5000 : 1000);
  }
  async function tick() {
    if (polling || !selected) return;
    polling = true; const id = selected, ticket = generation;
    try {
      const value = await call('read', { id, section: 'summary' });
      if (ticket !== generation) return;
      showSummary(value);
      if (E('health-follow').checked && value.operation.version !== page?.throughSequence)
        await eventsAt(Math.max(0, value.operation.version - 50));
      if (++ticks % 5 === 0 || !value.operation.runningHere) await historyAt();
      if (value.operation.kind === 'list' && !value.operation.runningHere) await servicesAt();
    } catch (issue) { E('health-action-status').textContent = issue.message + ' · use Recover last operation when the workspace returns.'; }
    finally { polling = false; schedule(); }
  }
  E('health-kind').addEventListener('change', configure);
  E('health-start').addEventListener('click', () => work(async () => {
    const input = inputs(), key = JSON.stringify(input);
    const id = pending?.key === key ? pending.id : crypto.randomUUID();
    savePending({ id, key, input }); lastId = id;
    E('health-action-status').textContent = 'Opening original operation ' + id;
    const value = await call('start', { id, ...input });
    savePending(null); await openOriginal(value.operation.id); await historyAt();
    E('health-action-status').textContent = 'Observation retained as ' + id;
    notice('Service-health observation opened on the saved endpoint.');
  }));
  E('health-recover').addEventListener('click', () => work(async () => {
    const id = pending?.id ?? lastId;
    if (!id) return;
    await openOriginal(id); savePending(null); await historyAt();
    notice('Original health observations reopened.');
  }));
  E('health-stop').addEventListener('click', () => work(async () => {
    if (!selected) return;
    await call('cancel', { id: selected }); await openOriginal(selected); await historyAt();
    notice('This native health observation is closed; its original history is retained.');
  }));
  E('health-resume').addEventListener('click', () => work(async () => {
    if (!selected || !read) return;
    await call('resume', { id: selected, expectedVersion: read.operation.version });
    await openOriginal(selected); await historyAt();
    notice('Original Watch resumed within its original deadline and event budget.');
  }));
  E('health-export').addEventListener('click', () => work(async () => {
    const value = await call('export', { id: selected });
    download('grpc-health-' + value.operation.id + '-' + value.summary.version + '.json', value);
    notice('Complete health observation downloaded · SHA256 ' + value.snapshotSha256);
  }));
  E('health-history-refresh').addEventListener('click', () => work(() => historyAt()));
  E('health-current-only').addEventListener('change', () => work(() => historyAt()));
  E('health-history-previous').addEventListener('click', () => work(() => historyAt(Math.max(0, historyOffset - 50), true)));
  E('health-history-next').addEventListener('click', () => work(() => historyAt(listPage.nextOffset, true)));
  E('health-events-previous').addEventListener('click', () => work(() => {
    E('health-follow').checked = false; return eventsAt(Math.max(0, page.afterSequence - 50), true);
  }));
  E('health-events-next').addEventListener('click', () => work(() => {
    E('health-follow').checked = false; return eventsAt(page.nextAfterSequence, true);
  }));
  E('health-follow').addEventListener('change', () => { if (E('health-follow').checked) work(() => eventsAt(Math.max(0, (read?.operation.version ?? 0) - 50))); });
  E('health-service-filter').addEventListener('change', () => work(() => servicesAt()));
  E('health-services-previous').addEventListener('click', () => work(() => servicesAt(Math.max(0, servicesPage.afterSequence - 50), true)));
  E('health-services-next').addEventListener('click', () => work(() => servicesAt(servicesPage.nextAfterSequence, true)));
  window.addEventListener('pagehide', () => clearTimeout(poll));
  configure(); savePending(pending);
  let initialized = false, previousRevision;
  return { update(value, editable = true) {
    inventory = value; const saved = getRevision();
    E('health-source').textContent = saved ? saved.source.target + ' · editor revision ' + short(saved.id) +
      (saved.id === value?.currentRevision ? ' · current' : ' · select this saved revision to start') : 'Capture and save a source first.';
    E('health-start').disabled = !saved || saved.id !== value?.currentRevision || !editable;
    if (previousRevision !== saved?.id) {
      previousRevision = saved?.id; E('health-known-services').replaceChildren();
      const services = [...new Set((saved?.methods ?? []).map(method => method.path.split('/')[1]).filter(Boolean))].sort();
      for (const service of services) { const item = node('option'); item.value = service; E('health-known-services').append(item); }
    }
    if (!initialized) {
      initialized = true;
      historyAt().catch(issue => notice(issue.message, 'error'));
      if (pending?.id || lastId) openOriginal(pending?.id ?? lastId).catch(issue => { E('health-action-status').textContent = issue.message; });
    }
  }, open: openOriginal };
}
