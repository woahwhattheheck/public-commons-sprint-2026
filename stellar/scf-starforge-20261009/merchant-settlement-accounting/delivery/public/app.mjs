const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const show = value => value === null || value === undefined || value === '' ? '—' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
const date = value => { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString(); };
const friendly = value => ({prepared:'Prepared',queued:'Queued',running:'Running',complete:'Complete',failed:'Failed',interrupted:'Interrupted'}[value] || show(value));
const endpoint = value => encodeURIComponent(String(value));
const LIMIT = 50;
const PENDING_PREFIX = 'merchant-accounting.delivery-notices.pending.v1:';
let listing = null, detail = null, selectedId = new URLSearchParams(location.hash.slice(1)).get('notice') || '';
let offset = 0, filter = 'all', listSequence = 0, detailSequence = 0, busy = false, loading = false, timer;
let pending = {}, storageKey = '', renderedId = '';
const pendingFor = id => Object.hasOwn(pending,id) ? pending[id] : null;
const captures = value => Array.isArray(value?.captures) ? value.captures : [];
const recordFor = request => captures(detail).find(row => row.requestId === request?.requestId);
function message(text, error = false) {
  $('message').textContent = text; $('message').hidden = !text;
  $('message').classList.toggle('error',error); $('message').setAttribute('role',error ? 'alert' : 'status');
}
class RequestError extends Error {
  constructor(response,data) { super(data.message || 'The accounting workspace could not complete this request.'); this.status=response.status; this.code=data.error; }
}
async function api(path,body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),35000);
  try {
    const response = await fetch(path,body === undefined ? {cache:'no-store',signal:controller.signal} : {
      method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},
      body:JSON.stringify(body),signal:controller.signal
    });
    const data = await response.json().catch(() => ({message:'The workspace returned an unreadable response.'}));
    if (!response.ok) throw new RequestError(response,data);
    return data;
  } finally { clearTimeout(timeout); }
}
function rememberActor(value) { try { localStorage.setItem('merchant-accounting.operator',value); } catch {} }
function savedActor() { try { return localStorage.getItem('merchant-accounting.operator') || ''; } catch { return ''; } }
function validRequest(key,value) {
  return value && value.eventId === key && typeof value.requestId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) &&
    typeof value.actor === 'string' && value.actor.trim() && value.actor.length <= 160 &&
    typeof value.name === 'string' && value.name.trim() && value.name.length <= 160 && Object.hasOwn(value,'revision');
}
function adoptScope(source) {
  const key = PENDING_PREFIX + encodeURIComponent(JSON.stringify([source?.workspaceDir ?? null,source?.outboxDir ?? null]));
  if (key === storageKey) return;
  const changed = Boolean(storageKey); storageKey = key; pending = {};
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '{}');
    pending = Object.fromEntries(Object.entries(value).filter(([id,item]) => validRequest(id,item)));
  } catch { message('Saved browser request references could not be loaded. The accepted capture history remains in the accounting workspace.',true); }
  if (changed) { detail = null; selectedId = ''; renderedId = ''; }
  if (!selectedId) selectedId = Object.keys(pending)[0] || '';
}
function writePending(next) {
  if (!storageKey) throw new Error('Load the connected accounting workspace before capturing sources.');
  const text = JSON.stringify(next);
  try {
    sessionStorage.setItem(storageKey,text);
    if (sessionStorage.getItem(storageKey) !== text) throw new Error('Request retention did not round-trip.');
  } catch { throw new Error('This browser could not retain the capture request for recovery. Allow session storage and try again.'); }
  pending = next; renderPendingList();
}
function retainRequest(request) {
  writePending(Object.fromEntries([...Object.entries(pending).filter(([id]) => id !== request.eventId),[request.eventId,request]]));
}
function clearRequest(id,requestId) {
  if (pendingFor(id)?.requestId !== requestId) return;
  const next = Object.fromEntries(Object.entries(pending).filter(([key]) => key !== id));
  try { writePending(next); } catch { pending = next; renderPendingList(); }
}
function renderPendingList() {
  const rows = Object.values(pending);
  $('retained-requests').hidden = !rows.length;
  $('retained-request-list').innerHTML = rows.map(row => '<button type="button" data-notice="' + esc(row.eventId) + '">' + esc(row.name) + ' · ' + esc(row.eventId) + '</button>').join('');
}
function renderListing() {
  if (!listing) return;
  const summary = listing.summary || {};
  $('count-notices').textContent = show(summary.notices);
  $('count-captured').textContent = show(summary.captured);
  $('count-pending').textContent = show(summary.pending);
  $('workspace-directory').textContent = show(listing.source?.workspaceDir);
  $('source-outbox').textContent = show(listing.source?.outboxDir);
  const signing = listing.signing || {};
  $('signing-state').textContent = signing.available ? 'Available · ' + show(signing.environment) :
    signing.environment ? 'Environment value unavailable · ' + signing.environment : 'No signing environment configured';
  const focused = document.activeElement?.dataset?.notice;
  $('notice-rows').innerHTML = (listing.notices || []).map(row => {
    const latest = captures(row)[0];
    return '<tr' + (row.eventId === selectedId ? ' class="selected"' : '') + '><td><button type="button" class="notice-link" data-notice="' + esc(row.eventId) + '"' + (row.eventId === selectedId ? ' aria-current="true"' : '') + '>' + esc(row.eventId) + '</button><span class="subline">' + esc(show(row.orderReference)) + '</span></td><td>' + esc(date(row.receivedAt)) + '</td><td>' + esc(show(row.routeId)) + '<span class="subline">' + esc(show(row.network)) + ' · ' + esc(show(row.method)) + '</span></td><td class="amount">' + esc(show(row.amountAtomic)) + '</td><td><span class="badge">' + esc(latest ? friendly(latest.status) : 'Not captured') + '</span></td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No accepted notices match this filter.</td></tr>';
  if (focused) for (const button of $('notice-rows').querySelectorAll('[data-notice]')) if (button.dataset.notice === focused) { button.focus({preventScroll:true}); break; }
  const count = listing.notices?.length || 0;
  $('notice-page').textContent = count ? (listing.offset + 1) + '–' + (listing.offset + count) + ' of ' + listing.total : '0 of ' + listing.total;
  $('previous').disabled = loading || listing.offset <= 0;
  $('next').disabled = loading || listing.nextOffset === null || listing.nextOffset === undefined;
  renderPendingList();
}
function captureCard(row) {
  const run = row.runId;
  const recovery = !run ? '<div class="actions"><button type="button" data-review-request="' + esc(row.requestId) + '">Review recovery</button></div>' : '';
  const downloads = run && row.status === 'complete' ? '<a class="button" download href="/api/runs/' + endpoint(run) + '/download/review.html">Offline review</a><a class="button" download href="/api/runs/' + endpoint(run) + '/download/report.json">Original report JSON</a>' : '';
  return '<article class="capture-record"><div class="row"><strong>' + esc(show(row.name)) + '</strong><span class="badge">' + esc(friendly(row.status)) + '</span></div><p>' + esc(show(row.actor)) + ' · ' + esc(date(row.createdAt)) + '</p><p class="mono">Request ' + esc(show(row.requestId)) + '</p>' + (run ? '<p class="mono">Run ' + esc(run) + '</p>' : '') +
    (row.error ? '<p class="error-text">' + esc(show(row.error)) + '</p>' : '') +
    (row.code ? '<p class="hint">' + esc(row.code) + '</p>' : '') +
    (row.preparedRevision !== undefined ? '<p class="hint">Prepared workspace revision ' + esc(row.preparedRevision) + '</p>' : '') +
    (row.sourceSelection ? '<details><summary>Prepared source selection</summary><pre class="mono">' + esc(JSON.stringify(row.sourceSelection,null,2)) + '</pre></details>' : '') +
    (run ? '<div class="actions"><a class="button" href="/" data-open-run="' + esc(run) + '">Open reconciliation</a>' + downloads + '</div>' : recovery) + '</article>';
}
function renderDetail() {
  const notice = detail?.notice;
  $('empty-detail').hidden = Boolean(notice); $('selected-detail').hidden = !notice;
  if (!notice) return;
  $('selected-event').textContent = notice.eventId;
  const fields = [['Accepted at',date(notice.receivedAt)],['Event occurred at',date(notice.occurredAt)],['Route',notice.routeId],['Network',notice.network],['Method',notice.method],['Atomic amount',notice.amountAtomic],['Order reference',notice.orderReference]];
  $('notice-identity').innerHTML = fields.map(([name,value]) => '<dt>' + esc(name) + '</dt><dd>' + esc(show(value)) + '</dd>').join('');
  $('notice-hashes').innerHTML = [['Original event SHA-256',notice.eventSha256],['Accepted body SHA-256',notice.bodySha256]].map(([name,value]) => '<dt>' + esc(name) + '</dt><dd class="mono">' + esc(show(value)) + '</dd>').join('');
  const request = pendingFor(notice.eventId), accepted = recordFor(request);
  const active = captures(detail).some(row => ['queued','running'].includes(row.status));
  if (renderedId !== notice.eventId) {
    $('capture-actor').value = request?.actor || savedActor();
    $('capture-name').value = request?.name || '';
    renderedId = notice.eventId;
  }
  $('capture-actor').disabled = busy || Boolean(request) || active;
  $('capture-name').disabled = busy || Boolean(request) || active;
  $('capture-submit').disabled = busy || Boolean(request) || active;
  $('capture-availability').hidden = !active;
  $('capture-availability').textContent = active ? 'A reconciliation for this notice is already queued or running. Follow its original run below before starting another capture.' : '';
  $('pending-capture').hidden = !request;
  if (request) {
    const changedSelection = accepted?.code === 'DELIVERY_CAPTURE_SELECTION_CHANGED';
    const unacceptedStale = !accepted && request.revision !== detail.revision;
    $('pending-title').textContent = changedSelection ? 'Prepared selection changed' : 'Recover the original capture';
    $('pending-description').textContent = changedSelection ?
      'The selected accounting sources changed after this request was prepared. Review the current sources, then start a new capture. This prepared request remains in history.' :
      unacceptedStale ? 'This request has not been accepted and the workspace revision changed. Review the current sources; retry keeps the same request ID, name and operator with the current revision.' :
      accepted?.code === 'RUN_IN_PROGRESS' ? 'Another original accounting run is active. Once it finishes, recover this same prepared request.' :
      'Recovering keeps the original request ID, name, operator and prepared source selection. It returns the original run when that capture already began.';
    $('pending-request-id').textContent = 'Request ' + request.requestId;
    $('recover-capture').textContent = unacceptedStale ? 'Retry original request with current revision' : 'Recover same request';
    $('recover-capture').disabled = busy || changedSelection;
    $('new-selection').hidden = !changedSelection;
    $('new-selection').disabled = busy;
  }
  $('capture-history').innerHTML = captures(detail).map(captureCard).join('') || '<p class="hint">No capture has been prepared for this accepted delivery.</p>';
  $('refresh-notice').disabled = busy || loading;
}
function schedule() {
  clearTimeout(timer);
  if (document.hidden || !$('live-refresh').checked || busy || loading) return;
  const active = [...captures(detail),...(listing?.notices || []).flatMap(captures)].some(row => ['queued','running'].includes(row.status));
  timer = setTimeout(() => refresh(false).catch(error => message(error.message,true)),active ? 2500 : 15000);
}
async function loadListing() {
  const sequence = ++listSequence;
  const value = await api('/api/delivery-notices?' + new URLSearchParams({offset:String(offset),limit:String(LIMIT),state:filter}));
  if (sequence !== listSequence) return;
  if (!Array.isArray(value.notices)) throw new Error('The workspace returned an unreadable notice list.');
  listing = value; offset = value.offset; adoptScope(value.source); renderListing();
}
async function loadNotice(id) {
  if (!id) { detail = null; renderDetail(); return; }
  const sequence = ++detailSequence;
  const value = await api('/api/delivery-notices/' + endpoint(id));
  if (sequence !== detailSequence || id !== selectedId) return;
  if (!value.notice || value.notice.eventId !== id) throw new Error('The returned notice does not match the selected delivery.');
  detail = {...value,captures:Array.isArray(value.captures) ? value.captures : captures(value.notice)};
  const request = pendingFor(id), accepted = recordFor(request);
  if (request && accepted?.runId) clearRequest(id,request.requestId);
  renderDetail(); return detail;
}
async function refresh(notify = true) {
  if (loading) return;
  loading = true; clearTimeout(timer); $('refresh').disabled = true;
  try {
    await loadListing();
    if (selectedId) await loadNotice(selectedId);
    $('updated-at').textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (notify) message('Loaded the current accepted notices and retained capture state.');
  } finally {
    loading = false; $('refresh').disabled = busy;
    renderListing(); renderDetail(); schedule();
  }
}
async function selectNotice(id) {
  selectedId = id; detail = null; renderDetail(); renderListing();
  history.replaceState(null,'','#notice=' + endpoint(id));
  await loadNotice(id); schedule();
}
function postBody(request) {
  return {revision:request.revision,actor:request.actor,requestId:request.requestId,name:request.name};
}
async function sendCapture(request) {
  if (busy) return;
  busy = true; clearTimeout(timer); renderDetail(); $('refresh').disabled = true;
  try {
    retainRequest(request);
    const value = await api('/api/delivery-notices/' + endpoint(request.eventId) + '/capture',postBody(request));
    if (!value.capture || value.capture.requestId !== request.requestId) throw new Error('The response did not identify this capture. Recover the same retained request.');
    if (value.capture.runId || value.run?.id) clearRequest(request.eventId,request.requestId);
    message(value.capture.runId || value.run?.id ? 'The original accounting capture is retained. Open its reconciliation or follow its current status below.' : 'The prepared request is retained. Review its current status and recover the same request when ready.');
    await refresh(false);
  } catch (error) {
    const suffix = error.code === 'STALE_WORKSPACE' ? ' Refresh has kept the same request ID; review the current state before retrying.' :
      error.code === 'DELIVERY_CAPTURE_SELECTION_CHANGED' ? ' Review the prepared history and the current accounting selections.' :
      error.status === 503 ? ' Open the settlement workspace to review its operating state, then recover this same request.' :
      ' The saved request ID is retained for recovery.';
    message((error.name === 'AbortError' ? 'The capture response did not arrive before the request timed out.' : error.message) + suffix,true);
    try { await refresh(false); } catch {}
  } finally { busy = false; $('refresh').disabled = loading; renderDetail(); schedule(); }
}
async function recoverCapture() {
  const request = pendingFor(selectedId);
  if (!request || busy) return;
  const current = await api('/api/delivery-notices/' + endpoint(request.eventId));
  const accepted = (Array.isArray(current.captures) ? current.captures : captures(current.notice)).find(row => row.requestId === request.requestId);
  if (accepted?.code === 'DELIVERY_CAPTURE_SELECTION_CHANGED') {
    if (selectedId === request.eventId) { detail = {...current,captures:current.captures || captures(current.notice)}; renderDetail(); }
    message('The prepared selection changed. Review the current accounting sources and use the new-capture action; the previous request remains in history.',true); return;
  }
  await sendCapture(accepted ? request : {...request,revision:current.revision});
}
function attempt(work) { Promise.resolve().then(work).catch(error => message(error.message || String(error),true)); }
$('capture-actor').value = savedActor();
$('capture-actor').addEventListener('input',() => rememberActor($('capture-actor').value));
$('refresh').addEventListener('click',() => attempt(() => refresh()));
$('refresh-notice').addEventListener('click',() => attempt(() => loadNotice(selectedId)));
$('live-refresh').addEventListener('change',schedule);
document.addEventListener('visibilitychange',() => { clearTimeout(timer); if (!document.hidden) attempt(() => refresh(false)); });
$('filter-form').addEventListener('submit',event => { event.preventDefault(); filter=$('notice-state').value; offset=0; attempt(() => refresh(false)); });
$('previous').addEventListener('click',() => { offset=Math.max(0,offset-LIMIT); attempt(() => refresh(false)); });
$('next').addEventListener('click',() => { if (listing?.nextOffset !== null && listing?.nextOffset !== undefined) { offset=listing.nextOffset; attempt(() => refresh(false)); } });
document.addEventListener('click',event => {
  const notice = event.target.closest('[data-notice]');
  if (notice) { attempt(() => selectNotice(notice.dataset.notice)); return; }
  const review = event.target.closest('[data-review-request]');
  if (review) {
    attempt(async () => {
      if (busy || !detail?.notice) return;
      const capture = captures(detail).find(row => row.requestId === review.dataset.reviewRequest);
      if (!capture || capture.runId) return;
      const current = pendingFor(selectedId);
      if (current && current.requestId !== capture.requestId && !recordFor(current)) {
        message('Recover the retained browser request shown above before switching to another prepared request.',true); return;
      }
      retainRequest({eventId:selectedId,requestId:capture.requestId,name:capture.name,actor:capture.actor,revision:capture.preparedRevision ?? detail.revision,createdAt:capture.createdAt});
      renderedId = ''; renderDetail();
      $('pending-capture').scrollIntoView({behavior:'smooth',block:'center'});
    });
    return;
  }
  const run = event.target.closest('[data-open-run]');
  if (run) { try { localStorage.setItem('merchant-accounting.selected-run',run.dataset.openRun); } catch { message('Select reconciliation ' + run.dataset.openRun + ' in the accounting workspace.'); } }
});
$('capture-form').addEventListener('submit',event => {
  event.preventDefault();
  attempt(async () => {
    if (!detail?.notice || busy || pendingFor(selectedId)) return;
    const actor=$('capture-actor').value.trim(),name=$('capture-name').value.trim();
    if (!actor || !name) { $('capture-form').reportValidity(); return; }
    if (actor.length > 160 || name.length > 160) throw new Error('Keep the operator and capture name to 160 characters each. Edit the entered value before capturing.');
    if (!crypto.randomUUID) throw new Error('Open the printed loopback accounting address to create a recoverable request ID.');
    rememberActor(actor);
    await sendCapture({eventId:selectedId,requestId:crypto.randomUUID(),actor,name,revision:detail.revision,createdAt:new Date().toISOString()});
  });
});
$('recover-capture').addEventListener('click',() => attempt(recoverCapture));
$('new-selection').addEventListener('click',() => attempt(async () => {
  await loadNotice(selectedId);
  const request=pendingFor(selectedId),accepted=recordFor(request);
  if (!request || accepted?.code !== 'DELIVERY_CAPTURE_SELECTION_CHANGED') return;
  clearRequest(selectedId,request.requestId); renderDetail();
  message('The previous prepared request stays in history. Review the current source selections, then capture them with a new request.');
  $('capture-name').focus();
}));
window.addEventListener('hashchange',() => {
  const id=new URLSearchParams(location.hash.slice(1)).get('notice') || '';
  if (id !== selectedId) attempt(() => selectNotice(id));
});
attempt(() => refresh(false));
