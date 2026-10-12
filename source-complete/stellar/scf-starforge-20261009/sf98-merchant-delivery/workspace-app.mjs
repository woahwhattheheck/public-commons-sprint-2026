// MIT. Browser client for the original SF98 delivery workspace controller.
const byId = id => document.getElementById(id);
const base = new URL('.', window.location.href);
const pages = new Set(['overview', 'receivers', 'events', 'maintenance']);
const profileFields = ['name', 'url', 'allowedHost', 'secretEnv', 'limit', 'concurrency', 'pollMs', 'timeoutMs'];
const numericFields = new Set(['limit', 'concurrency', 'pollMs', 'timeoutMs']);
const defaults = {name:'', url:'', allowedHost:'', secretEnv:'', limit:20, concurrency:1, pollMs:5000, timeoutMs:7000};
const profileCache = new Map(), pendingProfiles = new Map(), requests = new Map();
const selectedEvents = new Map();
const receiverChoice = {worker:'', repair:''};
let snapshot = null, token = '', connected = false, mutating = false;
let page = 'overview', navigation = 0, editorGeneration = 0;
let editor = {record:null, dirty:false, loading:false};
let eventPage = null, eventRow = null, selectedEventId = null, selectedJobId = null, jobDetail = null;
let eventQuery = {state:'ALL', query:'', offset:0, limit:25};
let eventSignature = '', jobSignature = '', profileSignature = '', basketSignature = '';
let polling = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function text(id, value) { byId(id).textContent = value === undefined || value === null ? '—' : String(value); }
function display(value) { return value === undefined || value === null || value === '' ? '—' : String(value); }
function time(value) { return value ? String(value).replace('T', ' ').replace(/Z$/, ' UTC') : '—'; }
function key(record) { return record ? `${record.id}:${record.revision}:${record.sha256}` : ''; }
function short(value, length = 14) { return value ? `${String(value).slice(0, length)}…` : '—'; }
function button(label, handler, className = '') {
  const node = el('button', label, className); node.type = 'button';
  node.addEventListener('click', handler); return node;
}
function definition(id, entries) {
  byId(id).replaceChildren(...entries.flatMap(([label, value, mono]) => [
    el('dt', label), el('dd', display(value), mono ? 'mono' : '')
  ]));
}
function message(value, error = false) {
  const node = byId('message'); node.textContent = value; node.hidden = !value;
  node.className = error ? 'notice error' : 'notice';
}
function lane(name) {
  requests.get(name)?.abort();
  const controller = new AbortController(); requests.set(name, controller);
  return {signal:controller.signal, current:() => requests.get(name) === controller && !controller.signal.aborted};
}
function cancel(name) { requests.get(name)?.abort(); requests.delete(name); }
function currentProfile(which) { return profileCache.get(receiverChoice[which]); }
function latestProfile(id) { return snapshot?.profiles.find(record => record.id === id); }
function profileLabel(reference) {
  if (!reference) return 'No receiver selected';
  const record = profileCache.get(key(reference));
  return `${record?.profile.name ?? reference.id} · revision ${reference.revision}`;
}
function remember(record) {
  if (record?.profile && record.id && record.sha256) profileCache.set(key(record), record);
  return record;
}
function refInput(record) {
  return {profileId:record.id, profileRevision:record.revision, profileSha256:record.sha256};
}
async function api(path, {body, signal} = {}) {
  const response = await fetch(new URL(path, base), {
    method:body === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
    signal, headers:body === undefined ? {accept:'application/json'} : {
      accept:'application/json', 'content-type':'application/json', 'x-sf98-session':token
    }, ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error('The workspace returned an unreadable response. Refresh its current state.'), {code:'UNREADABLE_RESPONSE'}); }
  if (!response.ok) throw Object.assign(new Error(data.message ?? 'Workspace request failed.'), {code:data.code, status:response.status});
  return data;
}
function errorText(error, write = false) {
  if (error.code === 'WORKSPACE_CHANGED_RELOAD') return 'The workspace changed before this action applied. Current state has been refreshed; review its receiver and run intent before trying again.';
  if (error.code === 'RECEIVER_PROFILE_CHANGED_RELOAD') return 'This receiver has a newer revision. Your form values are retained. Review the latest revision before saving or applying another change.';
  if (error.code === 'DELIVERY_EVENT_CHANGED_RELOAD') return 'A selected event changed. The owned worker has been paused by the repair request. Review each selected event’s current record and select it again before repairing.';
  if (error.code === 'SF98_DELIVERY_BUSY') return 'The original outbox has an active delivery owner. Inspect Original outbox owner on Overview; coordinate its existing process before retrying.';
  if (error.code === 'WORKSPACE_SESSION_REQUIRED') return 'The workspace process restarted or its session changed. Refresh, review its current state, and apply the action again.';
  if (error instanceof TypeError || error.code === 'UNREADABLE_RESPONSE') return write
    ? 'The action response was interrupted. Refresh and inspect the current worker, saved profile, and maintenance record before repeating the action.'
    : 'Cannot read the workspace. Check that its local process is running, then refresh.';
  return `${error.message || 'Workspace request failed.'}${error.code ? ` (${error.code})` : ''}`;
}
function hydrate(reference) {
  if (!reference || profileCache.has(key(reference))) return;
  const identity = key(reference);
  if (pendingProfiles.has(identity)) return;
  const session = token;
  const pending = api(`api/profiles/${encodeURIComponent(reference.id)}/${reference.revision}`)
    .then(record => {
      if (token !== session || key(record) !== identity) return;
      remember(record); renderReceiverOptions(); renderOverview(); renderEditorStatus(); renderControls();
    }).catch(() => { /* Exact unresolved references remain visible and unavailable for sends. */ })
    .finally(() => { if (pendingProfiles.get(identity) === pending) pendingProfiles.delete(identity); });
  pendingProfiles.set(identity, pending);
}
function acceptState(data) {
  if (data.token) {
    if (token && token !== data.token) { profileCache.clear(); pendingProfiles.clear(); }
    token = data.token;
  }
  const {token:ignored, ...state} = data;
  snapshot = state; connected = true;
  for (const record of state.profiles) remember(record);
  if (!receiverChoice.worker && state.selectedProfile) receiverChoice.worker = key(state.selectedProfile);
  if (!receiverChoice.repair && state.selectedProfile) receiverChoice.repair = key(state.selectedProfile);
  for (const reference of [state.selectedProfile, state.worker.owned?.profile, editor.record]) hydrate(reference);
  for (const choice of Object.values(receiverChoice)) {
    if (!choice || profileCache.has(choice)) continue;
    const [id, revision, sha256] = choice.split(':'); hydrate({id, revision:Number(revision), sha256});
  }
  renderState();
}
async function refreshState({quiet = false} = {}) {
  const request = lane('state');
  byId('connection').setAttribute('aria-busy', 'true');
  try {
    const data = await api('api/state', {signal:request.signal});
    if (!request.current()) return false;
    acceptState(data); return true;
  } catch (error) {
    if (!request.current()) return false;
    connected = false; text('connection', 'Disconnected'); renderControls();
    if (!quiet) message(errorText(error), true);
    return false;
  } finally {
    if (request.current()) byId('connection').removeAttribute('aria-busy');
  }
}
async function mutate(path, input, {success, accepted} = {}) {
  if (mutating || !connected || !snapshot) return;
  mutating = true; cancel('state'); renderControls();
  text('connection', 'Applying action…');
  try {
    const result = await api(path, {body:input});
    if (result.worker && result.profiles) acceptState(result);
    if (accepted) accepted(result);
    message(success ?? 'Action accepted.');
    return result;
  } catch (error) {
    if (error.code === 'DELIVERY_EVENT_CHANGED_RELOAD') {
      for (const selection of selectedEvents.values()) selection.needsReview = true;
      renderSelection(); renderEventTable(); renderEventDetail();
    }
    message(errorText(error, true), true);
    return null;
  } finally {
    await refreshState({quiet:true});
    mutating = false; renderControls();
    if (connected) text('connection', 'Connected');
    await refreshVisible({quiet:true});
  }
}
function renderState() {
  text('state-revision', `Revision ${snapshot.revision}`);
  text('connection', mutating ? 'Applying action…' : 'Connected');
  const warning = snapshot.persistenceWarning;
  byId('persistence-warning').hidden = !warning;
  text('persistence-warning', warning ? `Workspace revision ${warning.revision} is visible, but directory durability acknowledgment failed (${warning.code}, ${time(warning.observedAt)}). Keep the process running while checking its private filesystem. Your current form is retained.` : '');
  byId('onboarding').hidden = snapshot.profiles.length > 0;
  renderReceiverOptions(); renderOverview(); renderProfiles(); renderEditorStatus(); renderJobs(); renderControls();
}
function renderOverview() {
  if (!snapshot) return;
  const native = snapshot.worker.native, owned = snapshot.worker.owned, counts = native.outbox ?? {};
  for (const [id, field] of [['receipts','uniqueNativeReceipts'], ['pending','pending'], ['delivered','delivered'], ['exhausted','exhausted']]) text(`metric-${id}`, counts[field]);
  text('owned-status', owned?.status ?? 'PAUSED');
  text('desired-mode', `Restart intent: ${snapshot.desiredMode}`);
  definition('worker-details', [
    ['Operation', owned?.kind ?? 'No owned operation'], ['Operation ID', owned?.id, true],
    ['Receiver', profileLabel(owned?.profile)], ['Receiver hash', owned?.profile?.sha256, true],
    ['Started', time(owned?.startedAt)], ['Finished', time(owned?.finishedAt)],
    ['Last cycle', time(owned?.cycle?.updatedAt)], ['Cycles', owned?.cycle?.totals?.cycles],
    ['Attempts', owned?.cycle?.totals?.attempted], ['Operation fault', owned?.error]
  ]);
  const lease = native.deliveryOwner, owner = lease?.owner;
  definition('native-details', [
    ['Delivery lease', lease?.active ? 'Active native owner' : 'Available'],
    ['Owner record', owner ? (lease.active ? 'Current owner' : 'Last recorded owner') : 'No owner recorded'],
    ['Owner ID', owner?.id, true], ['Purpose', owner?.purpose], ['Host / PID', owner ? `${display(owner.host)} / ${display(owner.pid)}` : null],
    ['Acquired', time(owner?.acquiredAt)], ['Observed', time(native.observedAt)],
    ['Last native run', native.lastRun?.state], ['Next wake', time(native.lastRun?.nextWakeAt)]
  ]);
  text('restart-summary', `${snapshot.desiredMode === 'WORKER' ? 'Restart continues delivery with' : 'Restart stays paused with'} ${profileLabel(snapshot.selectedProfile)}.${snapshot.resumeAfterJob ? ` Worker resumption follows completed repair ${snapshot.resumeAfterJob}.` : ''}`);
  byId('workspace-paths').replaceChildren(el('div', `Workspace: ${snapshot.directory}`), el('div', `Original outbox: ${snapshot.outboxDirectory}`));
}
function renderReceiverOptions() {
  if (!snapshot) return;
  const records = [...profileCache.values()].sort((a,b) => a.profile.name.localeCompare(b.profile.name) || a.id.localeCompare(b.id) || b.revision - a.revision);
  for (const [which, id] of [['worker','worker-receiver'], ['repair','repair-receiver']]) {
    const select = byId(id), choices = [['', 'Select a receiver']];
    for (const record of records) {
      const labels = [];
      if (latestProfile(record.id)?.revision === record.revision) labels.push('latest');
      if (key(snapshot.worker.owned?.profile) === key(record) && !snapshot.worker.owned.finishedAt) labels.push('running');
      if (key(snapshot.selectedProfile) === key(record)) labels.push('saved intent');
      choices.push([key(record), `${profileLabel(record)}${labels.length ? ` · ${labels.join(', ')}` : ''}`]);
    }
    if (receiverChoice[which] && !choices.some(([value]) => value === receiverChoice[which])) {
      const [id, revision] = receiverChoice[which].split(':');
      choices.push([receiverChoice[which], `${id} · revision ${revision} · loading saved profile`]);
    }
    const signature = JSON.stringify(choices);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...choices.map(([value, label]) => { const option = el('option', label); option.value = value; return option; }));
      select.dataset.options = signature;
    }
    select.value = receiverChoice[which];
  }
}
function renderProfiles() {
  if (!snapshot) return;
  const signature = JSON.stringify([snapshot.profiles, editor.record?.id]);
  if (signature === profileSignature) return;
  profileSignature = signature;
  byId('profile-list').replaceChildren(...snapshot.profiles.map(record => {
    const node = button('', () => openProfile(record.id), 'profile-choice');
    node.append(el('strong', record.profile.name), el('span', `Revision ${record.revision} · ${record.secretAvailable ? 'environment available' : 'environment unavailable'}`, 'small muted'), el('span', record.profile.allowedHost, 'small mono'));
    node.setAttribute('aria-current', String(editor.record?.id === record.id)); return node;
  }));
  if (!snapshot.profiles.length) byId('profile-list').append(el('div', 'No saved receivers.', 'empty'));
}
function isHistorical() {
  return editor.record && (latestProfile(editor.record.id)?.revision ?? editor.record.revision) > editor.record.revision;
}
function renderEditorStatus() {
  const record = editor.record, latest = record && latestProfile(record.id), historical = isHistorical();
  text('profile-heading', record ? record.profile.name : 'New receiver');
  text('profile-identity', record ? `${record.id} · revision ${record.revision} · ${record.sha256}` : 'A new receiver gets its own immutable revision history.');
  byId('profile-history-tools').hidden = !record;
  byId('latest-profile').hidden = !historical;
  if (record) {
    const revisions = [...new Set([...(latest?.revisions ?? []), ...(record.revisions ?? []), record.revision])].sort((a,b) => b - a);
    const select = byId('profile-history'), signature = JSON.stringify([record.id, revisions]);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...revisions.map(revision => { const option = el('option', `Revision ${revision}${revision === latest?.revision ? ' · latest' : ''}`); option.value = revision; return option; }));
      select.dataset.options = signature;
    }
    select.value = record.revision;
  }
  text('profile-edit-state', editor.loading ? 'Loading saved revision…' : editor.dirty
    ? historical ? `Your edits are retained. Revision ${latest.revision} was saved elsewhere; review that revision before replacing this draft.` : 'Unsaved changes. Background refreshes preserve this draft.'
    : historical ? 'Historical revision. You can use this exact receiver or open its latest revision to edit.'
    : record ? `Saved ${time(record.savedAt)}. Changes create a new revision; they apply when you run or repair with it.` : 'Enter the receiver used by this merchant.');
  const saved = record && (profileCache.get(key(record)) ?? record);
  text('profile-env', saved ? `${saved.profile.secretEnv}: ${saved.secretAvailable ? 'available to the workspace process' : 'unavailable; provide its signing secret to the process before delivery'}.` : 'The profile stores only the environment variable name.');
  renderControls();
}
function mayReplaceEditor() {
  if (mutating) { message('Wait for the current action to finish before changing the editor.'); return false; }
  if (editor.dirty) { message('Save or discard the current receiver edits before opening another revision. Your draft is retained.'); return false; }
  return true;
}
function fillEditor(record) {
  editor = {record:record ? remember(record) : null, dirty:false, loading:false};
  const profile = record?.profile ?? defaults;
  for (const field of profileFields) byId('profile-form').elements.namedItem(field).value = profile[field];
  profileSignature = ''; renderProfiles(); renderEditorStatus(); renderReceiverOptions();
}
async function openProfile(id, revision, {force = false} = {}) {
  if (!force && !mayReplaceEditor()) { renderEditorStatus(); return; }
  const generation = ++editorGeneration, route = navigation;
  const request = lane('profile'); editor.loading = true; renderEditorStatus();
  try {
    const record = await api(`api/profiles/${encodeURIComponent(id)}${revision ? `/${revision}` : ''}`, {signal:request.signal});
    if (!request.current() || generation !== editorGeneration || route !== navigation || page !== 'receivers') return;
    fillEditor(record);
  } catch (error) {
    if (request.current() && generation === editorGeneration && route === navigation) message(errorText(error), true);
  } finally {
    if (generation === editorGeneration) { editor.loading = false; renderEditorStatus(); }
  }
}
function newProfile() {
  if (!mayReplaceEditor()) return;
  ++editorGeneration; cancel('profile'); fillEditor(null); navigate('receivers');
  byId('profile-form').elements.namedItem('name').focus();
}
async function saveProfile(event) {
  event.preventDefault();
  if (!byId('profile-form').reportValidity() || editor.loading || mutating || (isHistorical() && !editor.dirty)) return;
  const generation = editorGeneration, record = editor.record;
  const profile = Object.fromEntries(profileFields.map(field => {
    const value = byId('profile-form').elements.namedItem(field).value;
    return [field, numericFields.has(field) ? Number(value) : value.trim()];
  }));
  await mutate('api/profiles/save', {profile, expectedRevision:record?.revision ?? 0, ...(record ? {id:record.id} : {})}, {
    success:'Receiver revision saved. Use this revision to select it for a worker action or repair.',
    accepted:saved => { remember(saved); if (editorGeneration === generation) fillEditor(saved); }
  });
}
function useReceiver() {
  if (!editor.record || editor.dirty || editor.loading) return;
  receiverChoice.worker = key(editor.record); receiverChoice.repair = key(editor.record);
  renderReceiverOptions(); renderControls(); navigate('overview');
  message(`${profileLabel(editor.record)} selected for the next worker action and repair. Apply it with the corresponding action.`);
}
function reconcileSelection(rows) {
  for (const row of rows) {
    const selected = selectedEvents.get(row.event.id);
    if (selected && (selected.row.sha256 !== row.sha256 || row.deliveryState !== 'EXHAUSTED')) selected.needsReview = true;
  }
}
function chooseEvent(row, selected) {
  if (mutating) return;
  if (!selected) selectedEvents.delete(row.event.id);
  else if (row.deliveryState !== 'EXHAUSTED') { message('Only an exhausted event can be selected for repair.'); return; }
  else if (!selectedEvents.has(row.event.id) && selectedEvents.size >= 100) { message('A repair can contain at most 100 distinct events. Remove an event before adding another.'); return; }
  else selectedEvents.set(row.event.id, {row, needsReview:false});
  eventSignature = ''; renderEventTable(); renderSelection(); renderEventDetail(); renderControls();
}
function renderEventTable() {
  if (!eventPage) return;
  const signature = JSON.stringify([eventPage, [...selectedEvents].map(([id, value]) => [id, value.needsReview]), mutating]);
  if (signature === eventSignature) return;
  eventSignature = signature;
  text('event-count', `${eventPage.total} matching event${eventPage.total === 1 ? '' : 's'} · ${eventPage.rows.length ? eventPage.offset + 1 : 0}–${eventPage.offset + eventPage.rows.length}`);
  const rows = eventPage.rows.map(row => {
    const tr = el('tr'), selection = el('td'), check = el('input');
    check.type = 'checkbox'; check.checked = selectedEvents.has(row.event.id);
    check.disabled = mutating || row.deliveryState !== 'EXHAUSTED';
    check.setAttribute('aria-label', `Select event ${row.event.id} for repair`);
    check.addEventListener('change', () => { chooseEvent(row, check.checked); check.checked = selectedEvents.has(row.event.id); });
    selection.append(check);
    const identity = el('td'), open = button(short(row.event.id, 20), () => showEvent(row.event.id), 'link mono record-button');
    open.title = row.event.id; identity.append(open, el('span', display(row.event.orderReference), 'event-order small'));
    if (selectedEvents.get(row.event.id)?.needsReview) identity.append(el('span', 'Selection changed; review detail', 'event-order small'));
    tr.append(selection, identity, el('td', row.event.routeId, 'mono'), el('td', row.deliveryState),
      el('td', `${display(row.state?.attempt)} / ${display(row.state?.httpStatus)}`), el('td', time(row.state?.nextAt)));
    return tr;
  });
  if (!rows.length) { const tr = el('tr'), td = el('td', 'No events match this view.', 'empty'); td.colSpan = 6; tr.append(td); rows.push(tr); }
  byId('event-rows').replaceChildren(...rows); renderControls();
}
async function loadEvents({quiet = false} = {}) {
  if (page !== 'events' || !connected) return;
  const request = lane('events'), route = navigation;
  const query = new URLSearchParams(Object.entries(eventQuery).map(([name,value]) => [name,String(value)]));
  try {
    const data = await api(`api/events?${query}`, {signal:request.signal});
    if (!request.current() || route !== navigation || page !== 'events') return;
    if (!data.rows.length && data.offset > 0 && data.total <= data.offset) {
      eventQuery.offset = Math.max(0, Math.floor((data.total - 1) / data.limit) * data.limit);
      return loadEvents({quiet});
    }
    eventPage = data; reconcileSelection(data.rows); renderEventTable(); renderSelection(); renderEventDetail();
  } catch (error) { if (request.current() && !quiet) message(errorText(error), true); }
}
async function showEvent(id, {quiet = false, focus = true} = {}) {
  if (page !== 'events') navigate('events');
  if (selectedEventId !== id) { eventRow = null; byId('event-detail').hidden = true; }
  selectedEventId = id;
  const request = lane('event'), route = navigation;
  try {
    const row = await api(`api/events/${encodeURIComponent(id)}`, {signal:request.signal});
    if (!request.current() || selectedEventId !== id || route !== navigation || page !== 'events') return;
    eventRow = row; reconcileSelection([row]); renderEventDetail(); renderSelection(); renderEventTable();
    if (focus) byId('event-detail').scrollIntoView({block:'start', behavior:'auto'});
  } catch (error) { if (request.current() && !quiet) message(errorText(error), true); }
}
function renderEventDetail() {
  byId('event-detail').hidden = !eventRow;
  if (!eventRow) return;
  const {event, state, deliveryState, sha256} = eventRow;
  text('event-observed', `Current ${deliveryState.toLowerCase()} state · record hash ${sha256}`);
  definition('event-details', [
    ['Event ID', event.id, true], ['Order reference', event.orderReference, true], ['Route', event.routeId, true],
    ['Occurred', time(event.at)], ['Network', event.network], ['Method', event.method],
    ['Amount · atomic', event.amountAtomic, true], ['Asset digest', event.assetDigest, true],
    ['Recipient digest', event.recipientDigest, true], ['Delivery state', deliveryState],
    ['Attempt', state?.attempt], ['Receiver HTTP', state?.httpStatus], ['Attempt time', time(state?.at)],
    ['Next delivery', time(state?.nextAt)], ['Observed record hash', sha256, true]
  ]);
  text('event-raw', JSON.stringify(eventRow, null, 2));
  const selected = selectedEvents.get(event.id), changed = selected && (selected.needsReview || selected.row.sha256 !== sha256);
  text('select-detail', selected ? changed && deliveryState === 'EXHAUSTED' ? 'Use this reviewed state' : 'Remove from repair' : 'Select for repair');
  byId('select-detail').disabled = mutating || (!selected && selectedEvents.size >= 100) || (deliveryState !== 'EXHAUSTED' && !selected);
}
function renderSelection() {
  const stale = [...selectedEvents.values()].filter(value => value.needsReview).length;
  text('selected-count', `${selectedEvents.size} selected for repair${stale ? ` · ${stale} need current-state review` : ''}`);
  byId('selection-list-wrap').hidden = selectedEvents.size === 0;
  const signature = JSON.stringify([...selectedEvents].map(([id,value]) => [id, value.row.sha256, value.needsReview, mutating]));
  if (signature !== basketSignature) {
    basketSignature = signature;
    byId('selection-list').replaceChildren(...[...selectedEvents.values()].map(({row, needsReview}) => {
      const entry = el('div', null, 'selection-row'), detail = el('div');
      detail.append(button(row.event.id, () => showEvent(row.event.id), 'link mono record-button'),
        el('div', `${display(row.event.orderReference)} · captured ${row.sha256}`, 'mono small'),
        el('div', needsReview ? 'Current state changed. Open the event and review its latest record.' : 'Exact exhausted event selected.', 'small muted'));
      const remove = button('Remove', () => chooseEvent(row, false)); remove.disabled = mutating;
      entry.append(detail, remove); return entry;
    }));
  }
  renderControls();
}
function renderJobs() {
  if (!snapshot) return;
  const signature = JSON.stringify([snapshot.jobs, snapshot.worker.owned?.id, snapshot.worker.owned?.finishedAt, mutating]);
  if (signature !== jobSignature) {
    jobSignature = signature;
    const rows = snapshot.jobs.map(job => {
      const tr = el('tr'), identity = el('td'), actions = el('td', null, 'table-actions');
      identity.append(el('div', time(job.createdAt)), el('div', short(job.id, 18), 'mono'));
      actions.append(button('Inspect', () => showJob(job.id)));
      if (canContinue(job)) {
        const resume = button('Continue repair', () => continueRepair(job)); resume.disabled = mutating || !connected; actions.append(resume);
      }
      const receiver = el('td', profileLabel(job.profile)); receiver.append(el('div', job.profile.sha256, 'mono small'));
      tr.append(identity, el('td', job.kind), receiver, el('td', job.status),
        el('td', job.kind === 'REQUEUE' ? `${job.completed.length} / ${job.events.length} recorded` : job.result ? 'Batch recorded' : 'Batch in progress'), actions);
      return tr;
    });
    if (!rows.length) { const tr = el('tr'), td = el('td', 'No maintenance operations yet.', 'empty'); td.colSpan = 6; tr.append(td); rows.push(tr); }
    byId('job-rows').replaceChildren(...rows);
  }
  if (selectedJobId) {
    const current = snapshot.jobs.find(job => job.id === selectedJobId);
    if (current) { jobDetail = current; renderJobDetail(); }
  }
}
function canContinue(job) {
  return job.kind === 'REQUEUE' && !job.result && !(snapshot?.worker.owned?.id === job.id && !snapshot.worker.owned.finishedAt);
}
async function showJob(id, {quiet = false, focus = true} = {}) {
  if (page !== 'maintenance') navigate('maintenance');
  if (selectedJobId !== id) { jobDetail = null; byId('job-detail').hidden = true; }
  selectedJobId = id;
  const request = lane('job'), route = navigation;
  try {
    const job = await api(`api/jobs/${encodeURIComponent(id)}`, {signal:request.signal});
    if (!request.current() || selectedJobId !== id || route !== navigation || page !== 'maintenance') return;
    jobDetail = job; hydrate(job.profile); renderJobDetail();
    if (focus) byId('job-detail').scrollIntoView({block:'start', behavior:'auto'});
  } catch (error) { if (request.current() && !quiet) message(errorText(error), true); }
}
function renderJobDetail() {
  byId('job-detail').hidden = !jobDetail;
  if (!jobDetail) return;
  const job = jobDetail, result = job.result?.result;
  definition('job-details', [
    ['Operation ID', job.id, true], ['Kind / state', `${job.kind} / ${job.status}`], ['Created', time(job.createdAt)],
    ['Receiver', profileLabel(job.profile)], ['Profile ID', job.profile.id, true], ['Profile hash', job.profile.sha256, true],
    ['Resume policy', job.kind === 'REQUEUE' ? job.resumeWorker ? 'Run selected receiver after successful repair' : 'Keep delivery paused' : 'Drain one batch; keep paused'],
    ['Recorded events', job.kind === 'REQUEUE' ? `${job.completed.length} of ${job.events.length}` : null],
    ['Completed', time(job.result?.completedAt)], ['Worker resume result', result && job.kind === 'REQUEUE' ? result.resumeWorker ? 'Eligible to resume saved worker' : 'Keep paused' : null],
    ['Batch attempts', result?.attemptThisRun], ['Batch delivered', result?.deliveredThisRun], ['Batch exhausted', result?.exhaustedThisRun]
  ]);
  const rows = (job.events ?? []).map(selection => {
    const receipt = job.completed.find(row => row.id === selection.id), tr = el('tr'), identity = el('td');
    identity.append(button(selection.id, () => showEvent(selection.id), 'link mono record-button'));
    tr.append(identity, el('td', receipt?.outcome ?? 'Awaiting continuation'), el('td', receipt?.observed?.deliveryState ?? '—')); return tr;
  });
  if (!rows.length) { const tr = el('tr'), td = el('td', 'Batch totals are retained in the original operation below.', 'empty'); td.colSpan = 3; tr.append(td); rows.push(tr); }
  byId('job-outcomes').replaceChildren(...rows);
  text('job-raw', JSON.stringify(job, null, 2));
  byId('continue-job').hidden = !canContinue(job);
  byId('continue-job').disabled = mutating || !connected;
}
async function continueRepair(job) {
  if (!canContinue(job)) return;
  const route = navigation;
  await mutate('api/maintenance/resume', {expectedRevision:snapshot.revision, jobId:job.id}, {
    success:`Repair ${job.id} continued with its retained receiver, event list, and resume policy.`,
    accepted:() => { if (navigation === route) showJob(job.id, {focus:false}); }
  });
}
async function workerAction(action) {
  const record = currentProfile('worker');
  if (action !== 'pause' && !record) return;
  const route = navigation;
  await mutate(`api/worker/${action}`, {expectedRevision:snapshot.revision, ...(action === 'pause' ? {} : refInput(record))}, {
    success:action === 'pause' ? 'Pause intent saved; owned work has stopped.' : action === 'drain'
      ? `One native batch accepted for ${profileLabel(record)}. Its operation is retained in Maintenance.`
      : `Continuous delivery accepted for ${profileLabel(record)}.`,
    accepted:result => { if (action === 'drain' && result.lastJob && route === navigation) showJob(result.lastJob); }
  });
}
async function repairSelected() {
  const record = currentProfile('repair');
  if (!record || !selectedEvents.size || [...selectedEvents.values()].some(value => value.needsReview)) return;
  const selection = [...selectedEvents.values()].map(({row}) => ({id:row.event.id, sha256:row.sha256}));
  const route = navigation;
  await mutate('api/maintenance/requeue', {expectedRevision:snapshot.revision, ...refInput(record), events:selection, resumeWorker:byId('repair-resume').checked}, {
    success:`Repair accepted for ${selection.length} exact event${selection.length === 1 ? '' : 's'}. The retained operation records each outcome.`,
    accepted:result => {
      for (const row of selection) if (selectedEvents.get(row.id)?.row.sha256 === row.sha256) selectedEvents.delete(row.id);
      renderSelection(); renderEventTable();
      if (result.lastJob && route === navigation) showJob(result.lastJob);
    }
  });
}
function renderControls() {
  const unavailable = mutating || !connected || !snapshot;
  const worker = currentProfile('worker'), repair = currentProfile('repair');
  byId('refresh').disabled = mutating;
  byId('worker-receiver').disabled = unavailable; byId('repair-receiver').disabled = unavailable;
  byId('start-worker').disabled = unavailable || !worker?.secretAvailable;
  byId('drain-once').disabled = unavailable || !worker?.secretAvailable;
  byId('pause-worker').disabled = unavailable || !(snapshot?.desiredMode === 'WORKER' || snapshot?.resumeAfterJob || (snapshot?.worker.owned && !snapshot.worker.owned.finishedAt));
  text('receiver-readiness', worker ? `${profileLabel(worker)} · ${worker.profile.secretEnv} ${worker.secretAvailable ? 'available' : 'unavailable in this process'} · ${worker.profile.allowedHost}` : 'Select a saved receiver revision to run delivery.');
  const resume = byId('repair-resume').checked;
  text('repair-readiness', repair ? `${profileLabel(repair)}. ${resume ? `${repair.profile.secretEnv} must be available to resume delivery${repair.secretAvailable ? ' and is available' : '; it is unavailable'}.` : 'Repair records the requeue and leaves delivery paused.'}` : 'Select the saved receiver that should own this repair.');
  byId('repair-resume').disabled = unavailable;
  byId('repair-selected').disabled = unavailable || !repair || !selectedEvents.size || (resume && !repair.secretAvailable) || [...selectedEvents.values()].some(value => value.needsReview);
  byId('clear-selection').disabled = mutating || !selectedEvents.size;
  byId('select-exhausted').disabled = unavailable || !eventPage?.rows.some(row => row.deliveryState === 'EXHAUSTED');
  byId('events-back').disabled = unavailable || !eventPage || eventQuery.offset === 0;
  byId('events-next').disabled = unavailable || eventPage?.nextOffset == null;
  byId('refresh-event').disabled = unavailable || !selectedEventId;
  byId('continue-job').disabled = unavailable;
  byId('profile-fields').disabled = unavailable || editor.loading || (isHistorical() && !editor.dirty);
  byId('save-profile').disabled = unavailable || editor.loading || (!editor.dirty && !!editor.record) || (isHistorical() && !editor.dirty);
  byId('use-receiver').disabled = unavailable || editor.loading || !editor.record || editor.dirty;
  byId('discard-profile').disabled = mutating || editor.loading || !editor.dirty;
  byId('new-receiver').disabled = unavailable; byId('onboarding-add').disabled = unavailable;
  byId('profile-history').disabled = mutating || editor.loading;
  byId('latest-profile').disabled = mutating || editor.loading;
  for (const node of byId('profile-list').querySelectorAll('button')) node.disabled = unavailable;
}
function navigate(next) {
  if (!pages.has(next) || next === page) return;
  page = next; ++navigation;
  for (const request of ['profile','events','event','job']) cancel(request);
  editor.loading = false;
  for (const name of pages) byId(name).hidden = name !== page;
  for (const node of document.querySelectorAll('[data-page]')) {
    if (node.dataset.page === page) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  }
  window.history.replaceState(null, '', `#${page}`);
  renderEditorStatus(); refreshVisible();
}
async function refreshVisible({quiet = false} = {}) {
  if (!connected) return;
  if (page === 'events') {
    const reads = [loadEvents({quiet})];
    if (selectedEventId) reads.push(showEvent(selectedEventId, {quiet, focus:false}));
    await Promise.all(reads);
  } else if (page === 'maintenance' && selectedJobId) await showJob(selectedJobId, {quiet, focus:false});
}
async function refreshAll() {
  if (mutating) return;
  if (await refreshState()) await refreshVisible();
}
for (const node of document.querySelectorAll('[data-page],[data-go]')) node.addEventListener('click', () => navigate(node.dataset.page ?? node.dataset.go));
byId('refresh').addEventListener('click', refreshAll);
byId('new-receiver').addEventListener('click', newProfile);
byId('onboarding-add').addEventListener('click', newProfile);
byId('profile-form').addEventListener('submit', saveProfile);
byId('profile-form').addEventListener('input', () => { editor.dirty = true; renderEditorStatus(); });
byId('use-receiver').addEventListener('click', useReceiver);
byId('discard-profile').addEventListener('click', () => { ++editorGeneration; fillEditor(editor.record); message('Receiver edits discarded. The saved revision is open.'); });
byId('profile-history').addEventListener('change', event => { if (editor.record) openProfile(editor.record.id, Number(event.target.value)); });
byId('latest-profile').addEventListener('click', () => { if (editor.record) openProfile(editor.record.id); });
for (const [which,id] of [['worker','worker-receiver'], ['repair','repair-receiver']]) byId(id).addEventListener('change', event => { receiverChoice[which] = event.target.value; renderControls(); });
for (const [id,action] of [['start-worker','start'], ['pause-worker','pause'], ['drain-once','drain']]) byId(id).addEventListener('click', () => workerAction(action));
byId('repair-resume').addEventListener('change', renderControls);
byId('repair-selected').addEventListener('click', repairSelected);
byId('continue-job').addEventListener('click', () => { if (jobDetail) continueRepair(jobDetail); });
byId('clear-selection').addEventListener('click', () => { if (!mutating) { selectedEvents.clear(); renderSelection(); renderEventTable(); renderEventDetail(); } });
byId('event-search').addEventListener('submit', event => {
  event.preventDefault(); eventQuery = {...eventQuery, state:byId('event-filter').value, query:byId('event-query').value.trim(), offset:0}; loadEvents();
});
byId('events-back').addEventListener('click', () => { eventQuery.offset = Math.max(0, eventQuery.offset - eventQuery.limit); loadEvents(); });
byId('events-next').addEventListener('click', () => { if (eventPage?.nextOffset != null) { eventQuery.offset = eventPage.nextOffset; loadEvents(); } });
byId('select-exhausted').addEventListener('click', () => {
  if (mutating) return;
  let added = 0;
  for (const row of eventPage?.rows ?? []) {
    if (row.deliveryState !== 'EXHAUSTED' || selectedEvents.has(row.event.id) || selectedEvents.size >= 100) continue;
    selectedEvents.set(row.event.id, {row, needsReview:false}); ++added;
  }
  renderSelection(); renderEventTable(); renderEventDetail();
  message(`${added} exhausted event${added === 1 ? '' : 's'} added from this page. ${selectedEvents.size} selected${selectedEvents.size === 100 ? '; the repair limit is 100' : ''}.`);
});
byId('refresh-event').addEventListener('click', () => { if (selectedEventId) showEvent(selectedEventId, {focus:false}); });
byId('select-detail').addEventListener('click', () => {
  if (!eventRow) return;
  const selected = selectedEvents.get(eventRow.event.id);
  chooseEvent(eventRow, eventRow.deliveryState === 'EXHAUSTED' && (!selected || selected.needsReview || selected.row.sha256 !== eventRow.sha256));
});
window.addEventListener('hashchange', () => navigate(window.location.hash.slice(1)));
document.addEventListener('visibilitychange', () => { if (!document.hidden && !mutating) refreshAll(); });
window.addEventListener('beforeunload', event => { if (editor.dirty || mutating) { event.preventDefault(); event.returnValue = ''; } });
fillEditor(null); renderControls();
const initialPage = window.location.hash.slice(1);
if (pages.has(initialPage)) navigate(initialPage);
await refreshAll();
setInterval(async () => {
  if (polling || mutating || document.hidden) return;
  polling = true;
  try { if (await refreshState({quiet:true})) await refreshVisible({quiet:true}); }
  finally { polling = false; }
}, 5000);
