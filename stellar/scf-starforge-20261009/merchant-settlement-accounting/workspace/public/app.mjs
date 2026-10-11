// MIT. Operator UI over the original merchant accounting workspace.
// Monetary and atomic values remain the original strings from the native report.
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shown = value => value === null || value === undefined ? 'Not recorded' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const short = value => typeof value === 'string' && value.length > 22 ? value.slice(0, 12) + '…' + value.slice(-6) : shown(value);
const date = value => value ? new Date(value).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'}) : 'Not recorded';
const network = value => ({'stellar:testnet':'Stellar testnet','stellar:pubnet':'Stellar public network'}[value] || shown(value));
const friendly = value => String(value ?? '').toLowerCase().replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
const classification = value => ({OFFICIAL_TRANSFER_MATCHED:'Official transfer match',NATIVE_SUCCESS_UNVERIFIED:'Awaiting transfer verification',REUSED_TRANSACTION_UNVERIFIED:'Reused transaction',WEBHOOK_ACCEPTED_NOT_FULFILLED:'Webhook acknowledged',DELIVERY_EXHAUSTED:'Delivery exhausted',DELIVERY_RETRY:'Delivery retry',DELIVERY_REQUEUED:'Delivery requeued',NOT_DELIVERED:'Not delivered',RECOVERED_RESPONSE_SAVED:'Original response retained',RECOVERED_RESPONSE_NOT_RETAINED:'Original response absent'}[value] || friendly(value));
const badge = (value, label = friendly(value)) => '<span class="badge" title="' + esc(value) + '">' + esc(label) + '</span>';
const endpoint = value => encodeURIComponent(value);
const LIMIT = 50;
let state = null, selectedRun = '', selectedReport = null, view = 'ledger';
let records = {items:[], total:0, offset:0, limit:LIMIT}, selectedKey = null, recordRequest = 0, runRequest = 0;
let comparison = null, compareRequest = 0, busy = false, pollTimer = null, pendingIntent = null, runLimit = 30;
let recoveryOffset = 0, recoverySelection = '', recoveryJobLimit = 20, recoverySearch = '';
const drafts = new Map();
const fieldLabels = {
  eventId:'Event ID',at:'Event time',routeId:'Route',method:'Method',network:'Network',amountAtomic:'Atomic amount per event',
  assetDigest:'Asset digest',receiptFingerprint:'Receipt fingerprint',transactionFingerprint:'Transaction fingerprint',
  orderReferenceDigest:'Order reference digest',transferEvidenceDigest:'Verification file digest',ledger:'Ledger number',
  matchingEventDigest:'Matching event digest',transfer:'Transfer classification',delivery:'Webhook state',exception:'Exception',
  merchantQuoteUsd:'Merchant quote · USD',merchantVariableCostUsd:'Merchant variable cost · USD',verifiedQuotedValueUsd:'Matched-transfer quoted value · USD',
  recipientDigest:'Recipient digest',termsRecipientDigest:'Terms recipient digest',optionId:'Payment option ID',
  termsMatch:'Terms mapping',termsCandidateCount:'Candidate terms',merchantPriceBasis:'Price basis',verificationScope:'Verification scope',
  configuredOption:'Configured option',nativeSuccessEvents:'Native events',officialTransferMatches:'Official transfer matches',
  missingTransferEvidence:'Awaiting verification',webhookAccepted:'Webhook acknowledgements',legacyRecipientEvents:'Recipient absent in native event',
  unresolvedTermsEvents:'Unresolved terms',nativeAmountAtomic:'Native reported atomic total',officialMatchedAmountAtomic:'Matched atomic total',
  reason:'Native exception',source:'Source',name:'File name',path:'Captured file path',sha256:'SHA-256',bytes:'Bytes',schema:'Original schema',
  verdict:'Original verdict',eligibility:'Original eligibility decision',duplicateOfOriginal:'Identical to original directory file',
  createdAt:'Imported',actor:'Operator',included:'Included in future runs',id:'Retained file ID',
  origin:'Original source type',timeBasis:'Event time basis',recoveryId:'Recovered payment ID',
  recoveredEntryDigest:'Recovered entry digest',recoveredResponseSha256:'Retained response SHA-256',
  recoveredResponseBytes:'Retained response bytes',recoveredSettlements:'Recovered settlements',
  recoveredResponseFiles:'Recovered response files',recoveredAmountAtomic:'Recovered atomic total',
  entrySha256:'Original entry SHA-256',sourceBinding:'Original source binding',requestBody:'Retained request body',
  response:'Original delivered response',verification:'Original transfer verification',sources:'Retained original files',
  payerDigest:'Payer digest',receiptFingerprintEncoding:'Receipt fingerprint encoding',reservation:'Reservation source',
  outbox:'Native outbox source',rpcEndpoint:'Original RPC endpoint',nextOperation:'Original next operation'
};
const label = key => fieldLabels[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
const values = object => '<dl class="record-values">' + Object.entries(object).filter(([key]) => key !== 'review').map(([key, value]) => '<dt>' + esc(label(key)) + '</dt><dd class="' + (/(?:Id|Digest|Fingerprint|Atomic|Sha256)$/.test(key) ? 'mono' : '') + '">' + esc(key === 'network' ? network(value) : shown(value)) + '</dd>').join('') + '</dl>';
const metrics = entries => entries.map(([name, value]) => '<div class="metric"><span>' + esc(name) + '</span><strong>' + esc(shown(value)) + '</strong></div>').join('');

class RequestError extends Error {
  constructor(response, data) { super(data.message || 'The workspace request could not be completed.'); this.status = response.status; this.code = data.error; }
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(body)});
  const data = await response.json().catch(() => ({message:'The workspace returned an unreadable response.'}));
  if (!response.ok) throw new RequestError(response, data);
  return data;
}
function notify(message, error = false) {
  $('message').textContent = message;
  $('message').classList.toggle('error', error);
  $('message').hidden = !message;
}
function attempt(work) { return Promise.resolve().then(work).catch(error => notify(error.message || String(error), true)); }
function operator() {
  const value = $('operator').value.trim();
  if (!value) { $('operator').focus(); throw new Error('Enter the operator or reviewer name before saving.'); }
  return value;
}
function remember(key, value) { try { localStorage.setItem('merchant-accounting.' + key, value); } catch {} }
function remembered(key) { try { return localStorage.getItem('merchant-accounting.' + key) || ''; } catch { return ''; } }
function keyOf(row, kind = view) { return kind === 'exceptions' ? row.id : kind === 'ledger' ? row.eventId : kind === 'options' ? row.optionId : kind === 'recovered' ? row.recoveryId : row.sha256 + ':' + row.source + ':' + row.name; }
function reviewDraftKey(runId, id) { return runId + ':' + id; }
function currentRecord() { return records.items.find(row => keyOf(row) === selectedKey); }
function selectOptions(element, items, preferred) {
  const previous = element.value;
  const content = items.length ? items.map(([value, text]) => '<option value="' + esc(value) + '">' + esc(text) + '</option>').join('') : '<option value="">No completed reconciliations</option>';
  if (element.innerHTML !== content) element.innerHTML = content;
  const wanted = preferred !== undefined ? preferred : previous;
  element.value = items.some(([value]) => value === wanted) ? wanted : items[0]?.[0] ?? '';
}
function updateButtons() {
  for (const button of document.querySelectorAll('button[type="submit"],button[data-write]')) button.disabled = busy || !state;
  $('begin-run').disabled = busy || !state || state.runs.some(run => ['queued','running'].includes(run.status));
  $('export-button').disabled = busy || !state?.runs.some(run => run.status === 'complete');
  $('reapply-conflict').disabled = busy || !pendingIntent?.reloaded;
  $('reload-conflict').disabled = busy;
  const connected = Boolean(state?.recovery?.directory);
  $('recovery-refresh').disabled = $('recovery-disconnect').disabled = busy || !connected;
  $('recovery-import').disabled = busy || !connected || !$('recovery-preview-select').value || recoveryActive();
  for (const button of document.querySelectorAll('[data-recovery-cancel]')) button.disabled = busy || button.dataset.requested === 'true';
  for (const button of document.querySelectorAll('[data-recovery-retry]')) button.disabled = busy || !connected || recoveryActive();
  document.body.classList.toggle('working', busy);
}

function renderRuns() {
  const search = $('run-search').value.trim().toLowerCase();
  const all = state.runs.filter(run => !search || [run.name,run.actor,run.id].some(value => value.toLowerCase().includes(search)));
  $('run-list').innerHTML = all.slice(0, runLimit).map(run => '<button type="button" data-run="' + esc(run.id) + '" class="' + (run.id === selectedRun ? 'selected' : '') + '"' + (run.id === selectedRun ? ' aria-current="true"' : '') + '><strong>' + esc(run.name) + '</strong><span>' + esc(date(run.createdAt)) + '</span><span>' + esc(friendly(run.status)) + (run.status === 'complete' ? ' · ' + esc(run.totals.nativeSuccessEvents) + ' native' + (run.totals.recoveredSettlements === undefined ? '' : ' · ' + esc(run.totals.recoveredSettlements) + ' recovered') : '') + '</span></button>').join('') || '<p class="hint">' + (search ? 'No matching reconciliations.' : 'Your retained reconciliations will appear here.') + '</p>';
  $('run-more').hidden = all.length <= runLimit;
  $('run-more').textContent = 'Show more (' + Math.max(0, all.length - runLimit) + ' remaining)';
  $('state-version').textContent = 'Saved revision ' + state.revision + ' · ' + state.runs.length + ' retained runs';
}
function renderSources() {
  const names = {outboxDir:'Native merchant journal',proofDir:'Original verification files',termsFile:'Original accounting terms',recoveredDir:'Recovered payment collection'};
  $('source-paths').innerHTML = Object.entries(state.sources).map(([key,value]) => '<dt>' + esc(names[key] || key) + '</dt><dd class="mono">' + esc(value) + '</dd>').join('');
  const terms = [['source','Original source terms'],...state.termsImports.map(item => [item.id,item.name + ' · ' + item.options + ' options · ' + date(item.createdAt)])];
  selectOptions($('terms-selection'), terms, $('terms-selection').dataset.dirty === 'true' ? $('terms-selection').value : state.termsSelection);
  const selected = state.termsImports.find(item => item.id === state.termsSelection);
  $('terms-saved').textContent = 'Saved selection: ' + (selected ? selected.name : 'Original source terms');
  $('proof-imports').innerHTML = state.proofs.map(proof => '<tr><td><strong>' + esc(proof.name) + '</strong><span class="subtle mono" title="' + esc(proof.sha256) + '">' + esc(short(proof.sha256)) + '</span><span class="subtle">' + esc(date(proof.createdAt)) + '</span></td><td>' + esc(shown(proof.verdict)) + '</td><td>' + esc(friendly(proof.eligibility)) + '</td><td><button type="button" data-write data-proof-selection="' + esc(proof.id) + '" data-included="' + (!proof.included) + '" aria-pressed="' + proof.included + '">' + (proof.included ? 'Included · exclude' : 'Excluded · include') + '</button></td></tr>').join('') || '<tr><td colspan="4" class="empty">No imported verification files. The configured original directory is included when a run is captured.</td></tr>';
}
function renderSelectors() {
  const runs = state.runs.filter(run => run.status === 'complete').map(run => [run.id,run.name + ' · ' + date(run.createdAt)]);
  selectOptions($('compare-current'), runs);
  selectOptions($('compare-baseline'), runs);
  if (runs.length > 1 && $('compare-baseline').value === $('compare-current').value && !$('compare-baseline').dataset.chosen) $('compare-baseline').value = runs.find(([id]) => id !== $('compare-current').value)[0];
  selectOptions($('export-run'), runs);
  renderDownloads();
}
function renderExports() {
  $('exports').innerHTML = state.exports.map(item => '<tr><td><strong>' + esc(item.name) + '</strong><span class="subtle">' + esc(date(item.createdAt)) + '</span></td><td>' + esc(item.actor) + '</td><td>' + (item.includeSources ? 'Included' : 'Omitted') + '</td><td><a class="button" download href="/api/exports/' + endpoint(item.id) + '/download">Download archive</a><span class="subtle">' + esc(item.bytes) + ' bytes</span><details class="history-detail"><summary>Archive SHA-256</summary><code class="mono">' + esc(item.sha256) + '</code></details></td></tr>').join('') || '<tr><td colspan="4" class="empty">Completed review exports will remain available here.</td></tr>';
  $('history').innerHTML = state.history.map(entry => {
    const {at,actor,action,...details} = entry;
    return '<tr><td>' + esc(date(at)) + '</td><td>' + esc(actor) + '</td><td>' + esc(friendly(action)) + '</td><td><details class="history-detail"><summary>View saved details</summary><pre>' + esc(JSON.stringify(details,null,2)) + '</pre></details></td></tr>';
  }).join('') || '<tr><td colspan="4" class="empty">Operator actions will appear here.</td></tr>';
}
function adopt(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  if (!state.runs.some(run => run.id === selectedRun)) selectedRun = state.runs[0]?.id || '';
  renderRuns(); renderSources(); renderSelectors(); renderExports(); renderRecovery(); updateButtons();
  schedulePoll();
}
function renderRun() {
  const run = selectedReport?.run;
  $('empty-run').hidden = Boolean(run);
  $('selected-run').hidden = !run;
  if (!run) return;
  $('run-title').textContent = run.name;
  $('run-description').textContent = 'Captured ' + date(run.createdAt) + ' · ' + run.actor + ' · source revision ' + run.sourceRevision;
  $('run-status').textContent = friendly(run.status);
  $('progress').hidden = !['queued','running'].includes(run.status);
  $('run-error').hidden = !run.error;
  $('run-error').textContent = run.error || '';
  const complete = run.status === 'complete';
  $('data-panel').hidden = !complete;
  $('run-metrics').hidden = !complete;
  $('run-review-summary').hidden = !complete;
  if (!complete) return;
  const total = selectedReport.totals, reviews = selectedReport.reviewCounts;
  const totals = [['Native events',total.nativeSuccessEvents],['Official transfer matches',total.officialTransferMatches],['Need reconciliation',total.requiringReconciliation],['Webhook acknowledgements',total.webhookAccepted]];
  if (total.recoveredSettlements !== undefined) totals.splice(1,0,['Recovered settlements',total.recoveredSettlements]);
  if (total.recoveredResponseFiles !== undefined) totals.push(['Recovered response files',total.recoveredResponseFiles]);
  $('run-metrics').innerHTML = metrics(totals);
  $('run-review-summary').textContent = run.exceptionCount + ' exceptions · ' + reviews.open + ' open · ' + reviews.investigating + ' investigating · ' + reviews.reviewed + ' reviewed. ' + total.publicNetworkPending + ' public-network events awaiting verification; ' + total.exhaustedDelivery + ' exhausted deliveries.';
}
async function loadRun(id, {reset = false} = {}) {
  const request = ++runRequest;
  selectedRun = id;
  remember('selected-run', id);
  renderRuns();
  if (reset) { records = {items:[],total:0,offset:0,limit:LIMIT}; selectedKey = null; }
  if (!id) { selectedReport = null; renderRun(); return; }
  const result = await api('/api/runs/' + endpoint(id));
  if (request !== runRequest || selectedRun !== id) return;
  selectedReport = result; renderRun();
  if (result.run.status === 'complete') await loadRecords(reset ? 0 : records.offset);
}
async function refreshState() {
  const result = await api('/api/state'); adopt(result);
  await loadRun(selectedRun);
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!state?.runs.some(run => ['queued','running'].includes(run.status)) && !recoveryActive()) return;
  pollTimer = setTimeout(() => attempt(async () => {
    const before = state.runs.find(run => run.id === selectedRun)?.status;
    adopt(await api('/api/state'));
    const after = state.runs.find(run => run.id === selectedRun)?.status;
    if (before !== after || ['queued','running'].includes(after)) await loadRun(selectedRun);
  }), 1000);
}
function openArea(area) {
  for (const button of document.querySelectorAll('[data-area]')) { const active = button.dataset.area === area; button.classList.toggle('active',active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
  for (const section of document.querySelectorAll('.area')) section.hidden = section.id !== 'area-' + area;
}

const columns = {
  ledger:['Event','Route / network','Transfer','Atomic amount','Webhook'],
  options:['Payment option','Native / recovered / matched','Atomic amount per event','Matched atomic total'],
  exceptions:['Native exception','Event / route','Review'],
  proofs:['Verification file','Original verdict','Eligibility'],
  recovered:['Original recovered source','Atomic amount','Original verification','Retained response']
};
function inspectButton(index, title, subtitle = '') { return '<button class="inspect" type="button" data-inspect="' + index + '">' + esc(title) + '</button>' + (subtitle ? '<span class="subtle">' + esc(subtitle) + '</span>' : ''); }
function recordCells(row, index) {
  if (view === 'ledger') return [inspectButton(index,short(row.eventId),date(row.at)) + (row.origin ? '<span class="subtle">' + esc(friendly(row.origin)) + '</span>' : ''),esc(row.method + ' ' + row.routeId) + '<span class="subtle">' + esc(network(row.network)) + '</span>',badge(row.transfer,classification(row.transfer)), '<span class="exact">' + esc(row.amountAtomic) + '</span>',badge(row.delivery,classification(row.delivery))];
  if (view === 'options') return [inspectButton(index,row.method + ' ' + row.routeId,network(row.network)) + '<span class="subtle mono">' + esc(short(row.optionId)) + '</span>',esc(row.nativeSuccessEvents) + ' / ' + esc(row.recoveredSettlements ?? '—') + ' / ' + esc(row.officialTransferMatches),'<span class="exact">' + esc(row.amountAtomic) + '</span>','<span class="exact">' + esc(row.officialMatchedAmountAtomic) + '</span>'];
  if (view === 'exceptions') return [inspectButton(index,friendly(row.reason),network(row.network)),esc(row.method + ' ' + row.routeId) + '<span class="subtle mono" title="' + esc(row.eventId) + '">' + esc(short(row.eventId)) + '</span>',badge(row.review.status) + (row.review.assignee ? '<span class="subtle">' + esc(row.review.assignee) + '</span>' : '')];
  if (view === 'recovered') return [inspectButton(index,row.method + ' ' + row.routeId,network(row.network)) + '<span class="subtle">' + esc(row.origin) + '</span>','<span class="exact">' + esc(row.amountAtomic) + '</span>',badge(row.verification?.verdict,shown(row.verification?.verdict)),row.response ? esc(row.response.bytes) + ' bytes' : 'Not retained'];
  return [inspectButton(index,row.name,row.source) + (row.duplicateOfOriginal ? '<span class="subtle">Already present in original directory</span>' : ''),esc(shown(row.verdict)),esc(friendly(row.eligibility))];
}
function renderRecords() {
  $('record-head').innerHTML = '<tr>' + columns[view].map(name => '<th scope="col">' + esc(name) + '</th>').join('') + '</tr>';
  $('record-body').innerHTML = records.items.map((row,index) => '<tr' + (keyOf(row) === selectedKey ? ' class="selected"' : '') + '>' + recordCells(row,index).map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') || '<tr><td colspan="' + columns[view].length + '" class="empty">No records match this view.</td></tr>';
  $('table-caption').textContent = friendly(view) + ' from ' + (selectedReport?.run.name || 'selected reconciliation');
  $('record-page').textContent = records.total ? (records.offset + 1) + '–' + Math.min(records.offset + records.items.length, records.total) + ' of ' + records.total + ' records' : '0 records';
  $('previous').disabled = records.offset === 0;
  $('next').disabled = records.offset + records.items.length >= records.total;
  $('filter-review').hidden = $('review-filter-label').hidden = view !== 'exceptions';
  $('filter-network').hidden = $('network-filter-label').hidden = view === 'proofs';
  renderDetail();
}
async function loadRecords(offset = 0) {
  if (!selectedRun || selectedReport?.run.status !== 'complete') return;
  const request = ++recordRequest, id = selectedRun, kind = view;
  const query = new URLSearchParams({offset:String(offset),limit:String(LIMIT),search:$('filter-search').value.trim()});
  if (kind !== 'proofs' && $('filter-network').value) query.set('network',$('filter-network').value);
  if (kind === 'exceptions' && $('filter-review').value) query.set('review',$('filter-review').value);
  const result = await api('/api/runs/' + endpoint(id) + '/' + kind + '?' + query);
  if (request !== recordRequest || id !== selectedRun || kind !== view) return;
  if (result.total && offset >= result.total) return loadRecords(Math.floor((result.total - 1) / LIMIT) * LIMIT);
  records = result;
  if (!records.items.some(row => keyOf(row) === selectedKey)) selectedKey = null;
  renderRecords();
}
function renderDetail(row = currentRecord()) {
  if (!row) { $('record-detail').innerHTML = '<p class="empty">Select a record to inspect its complete values.</p>'; return; }
  const title = view === 'exceptions' ? friendly(row.reason) : view === 'proofs' ? row.name : row.method + ' ' + row.routeId;
  let html = '<h3>' + esc(title) + '</h3>' + values(row);
  if (view === 'recovered' && row.response) html += '<div class="actions"><a class="button" download href="/api/runs/' + endpoint(selectedRun) + '/recovered/' + endpoint(row.recoveryId) + '/response">Download retained response</a></div><p class="hint">This response comes from the selected run’s immutable source capture.</p>';
  if (view === 'exceptions') {
    const key = reviewDraftKey(selectedRun,row.id), saved = row.review, draft = drafts.get(key) || saved;
    html += '<form id="review-form" data-run="' + esc(selectedRun) + '" data-id="' + esc(row.id) + '" data-event="' + esc(row.eventId) + '" data-version="' + draft.version + '"><h3>Exception review</h3><p class="hint">Your review is retained alongside the original transfer classification.</p><label for="review-status">Review status</label><select id="review-status">' + ['open','investigating','reviewed'].map(status => '<option value="' + status + '"' + (status === draft.status ? ' selected' : '') + '>' + friendly(status) + '</option>').join('') + '</select><label for="review-assignee">Assigned to</label><input id="review-assignee" maxlength="160" value="' + esc(draft.assignee) + '" placeholder="Person or team"><label for="review-note">Review note</label><textarea id="review-note" required rows="5" maxlength="4000" placeholder="Record the finding and the action taken.">' + esc(draft.note) + '</textarea><div class="actions"><button class="primary" type="submit">Save review</button><span id="draft-status" class="hint">' + (drafts.has(key) ? 'Unsaved draft retained in this tab' : 'Original classification retained') + '</span></div></form>';
    if (saved.version) html += '<div class="review-by">Saved review ' + saved.version + ' · ' + esc(saved.actor) + ' · ' + esc(date(saved.updatedAt)) + '<details><summary>Current saved note</summary><p>' + esc(saved.note) + '</p></details></div>';
  }
  $('record-detail').innerHTML = html;
  updateButtons();
}
function retainReviewDraft() {
  const form = $('review-form');
  if (!form) return;
  drafts.set(reviewDraftKey(form.dataset.run,form.dataset.id), {version:Number(form.dataset.version),status:$('review-status').value,assignee:$('review-assignee').value,note:$('review-note').value});
  if (pendingIntent?.review?.runId === form.dataset.run && pendingIntent.review.id === form.dataset.id) pendingIntent.body = {...pendingIntent.body,status:$('review-status').value,assignee:$('review-assignee').value,note:$('review-note').value};
  $('draft-status').textContent = 'Unsaved draft retained in this tab';
}

async function perform(intent) {
  if (busy) return;
  if (pendingIntent && pendingIntent !== intent) { notify('Resolve or dismiss the saved-state conflict before making another change. Your form draft is retained.',true); return; }
  busy = true; updateButtons();
  try {
    const result = await api(intent.path,intent.body);
    if (pendingIntent === intent) pendingIntent = null;
    $('conflict').hidden = true;
    const next = result.state || (result.revision !== undefined ? result : null);
    if (next) adopt(next);
    if (intent.success) await intent.success(result);
    notify(typeof intent.message === 'function' ? intent.message(result) : intent.message || 'Saved.');
  } catch (error) {
    if (error.status === 409 && ['STALE_WORKSPACE','STALE_REVIEW'].includes(error.code)) {
      intent.reloaded = false; pendingIntent = intent;
      $('conflict-text').textContent = error.message + ' Your submitted changes remain in this tab. Load the saved version, inspect it, then explicitly reapply your changes.';
      $('conflict').hidden = false; notify('The saved version changed. Your submitted draft is retained.',true);
    } else notify(error.message || String(error),true);
  } finally { busy = false; updateButtons(); }
}
async function reloadConflict() {
  if (!pendingIntent || busy) return;
  const intent = pendingIntent;
  await refreshState();
  if (intent.review) {
    const result = await api('/api/runs/' + endpoint(intent.review.runId) + '/exceptions?' + new URLSearchParams({search:intent.review.eventId,limit:'200'}));
    const row = result.items.find(item => item.id === intent.review.id);
    if (!row) throw new Error('The exception is no longer available in this retained run. Your draft is still retained.');
    intent.savedVersion = row.review.version;
    if (selectedRun === intent.review.runId && view === 'exceptions') { selectedKey = row.id; renderDetail(row); }
    $('conflict-text').textContent = 'Loaded saved review ' + row.review.version + ' by ' + (row.review.actor || 'no previous reviewer') + '. Your draft remains in the form. Reapply will save your submitted status, assignee, and note over that saved review.';
  } else $('conflict-text').textContent = 'Loaded workspace revision ' + state.revision + '. Your ' + intent.description + ' draft remains in this tab. Reapply will use ' + (intent.currentBody ? 'the current edited form' : 'the submitted values') + ' against this saved revision.';
  if (pendingIntent === intent) { intent.reloaded = true; updateButtons(); }
}
async function reapplyConflict() {
  const intent = pendingIntent;
  if (!intent?.reloaded || busy) return;
  if (intent.currentBody) intent.body = {...intent.body,...intent.currentBody()};
  intent.body = {...intent.body,...(intent.review ? {version:intent.savedVersion} : {revision:state.revision})};
  await perform(intent);
}

function renderDownloads() {
  const id = $('export-run').value, run = state?.runs.find(item => item.id === id);
  $('download-run-label').textContent = run ? run.name + ' · original captured report files' : 'Choose a completed run above.';
  const files = [['review.html','Offline review'],['ledger.csv','Event ledger CSV'],['options.csv','Payment options CSV'],['exceptions.csv','Exceptions CSV'],['report.json','Full report JSON'],['manifest.json','Source manifest']];
  $('original-downloads').innerHTML = run ? files.map(([name,text]) => '<a class="button" download href="/api/runs/' + endpoint(id) + '/download/' + name + '">' + text + '</a>').join('') : '';
}
function comparisonValues(row, fields) {
  if (!row) return '<span class="subtle">Absent from this run</span>';
  return '<dl class="changes">' + fields.map(field => '<dt>' + esc(label(field)) + '</dt><dd>' + esc(shown(row[field])) + '</dd>').join('') + '</dl>';
}
function renderComparison() {
  $('comparison').hidden = !comparison;
  if (!comparison) return;
  const summary = comparison.summary;
  $('compare-metrics').innerHTML = metrics([['Added events',summary.addedEvents],['Changed events',summary.changedEvents],['Removed events',summary.removedEvents],['New exceptions',summary.newExceptions],['Resolved exceptions',summary.resolvedExceptions]]);
  const kind = comparison.view;
  if (kind === 'changed' || kind === 'options') {
    $('compare-head').innerHTML = '<tr><th scope="col">' + (kind === 'changed' ? 'Event / route' : 'Payment option') + '</th><th scope="col">Baseline: ' + esc(comparison.baseline.name) + '</th><th scope="col">Current: ' + esc(comparison.current.name) + '</th></tr>';
    $('compare-body').innerHTML = comparison.items.map(row => {
      const fields = kind === 'changed' ? row.fields : ['nativeSuccessEvents','recoveredSettlements','officialTransferMatches','nativeAmountAtomic','recoveredAmountAtomic','officialMatchedAmountAtomic','merchantQuoteUsd','merchantVariableCostUsd','verifiedQuotedValueUsd'];
      const original = row.after || row.before;
      const identity = kind === 'changed' ? row.eventId : row.optionId;
      return '<tr><td><strong>' + esc(original.method + ' ' + original.routeId) + '</strong><span class="subtle">' + esc(network(original.network)) + '</span><span class="mono" title="' + esc(identity) + '">' + esc(short(identity)) + '</span></td><td class="change-values">' + comparisonValues(row.before,fields) + '</td><td class="change-values">' + comparisonValues(row.after,fields) + '</td></tr>';
    }).join('');
  } else {
    $('compare-head').innerHTML = '<tr><th scope="col">Event</th><th scope="col">Route / network</th><th scope="col">Transfer</th><th scope="col">Atomic amount</th><th scope="col">Webhook</th></tr>';
    $('compare-body').innerHTML = comparison.items.map(row => '<tr><td class="mono">' + esc(row.eventId) + '</td><td>' + esc(row.method + ' ' + row.routeId) + '<span class="subtle">' + esc(network(row.network)) + '</span></td><td>' + esc(classification(row.transfer)) + '</td><td class="exact">' + esc(row.amountAtomic) + '</td><td>' + esc(classification(row.delivery)) + '</td></tr>').join('');
  }
  if (!comparison.items.length) $('compare-body').innerHTML = '<tr><td colspan="5" class="empty">No ' + esc(kind === 'options' ? 'payment options' : kind + ' events') + ' in this comparison.</td></tr>';
  $('compare-page').textContent = comparison.total ? (comparison.offset + 1) + '–' + Math.min(comparison.offset + comparison.items.length,comparison.total) + ' of ' + comparison.total : '0 changes';
  $('compare-previous').disabled = comparison.offset === 0;
  $('compare-next').disabled = comparison.offset + comparison.items.length >= comparison.total;
}
async function compareRuns(offset = 0) {
  const current = $('compare-current').value, baseline = $('compare-baseline').value, kind = $('compare-view').value;
  if (!current || !baseline || current === baseline) throw new Error('Choose two different completed reconciliations.');
  const request = ++compareRequest;
  const query = new URLSearchParams({baseline,view:kind,offset:String(offset),limit:String(LIMIT)});
  const result = await api('/api/runs/' + endpoint(current) + '/compare?' + query);
  if (request !== compareRequest) return;
  comparison = result; renderComparison();
}

function recoveryActive() {
  return (state?.recoveryJobs || []).some(job => ['queued','running'].includes(job.status));
}
function selectedRecoveryPreview() {
  return state?.recoveryPreviews?.find(item => item.id === $('recovery-preview-select').value);
}
function renderRecoveryPreview() {
  const preview = selectedRecoveryPreview();
  $('recovery-preview-detail').innerHTML = preview
    ? '<p class="hint">Reviewed by ' + esc(preview.actor) + ' · ' + esc(date(preview.createdAt)) + '</p>' + values(preview.review) +
      '<details class="history-detail"><summary>Retained review identity</summary>' + values({id:preview.id,configSha256:preview.configSha256}) + '</details>'
    : '<p class="empty">Review an original recovery request to inspect its retained inputs.</p>';
  updateButtons();
}
function renderRecoveryEntries() {
  const collection = state?.recovery?.entries || [];
  const found = collection.filter(row => !recoverySearch || JSON.stringify(row).toLowerCase().includes(recoverySearch));
  recoveryOffset = Math.min(recoveryOffset, Math.max(0,Math.floor((found.length - 1) / LIMIT) * LIMIT));
  const entries = found.slice(recoveryOffset,recoveryOffset + LIMIT);
  $('recovery-entries').innerHTML = entries.map(row =>
    '<tr' + (row.recoveryId === recoverySelection ? ' class="selected"' : '') + '><td><button class="inspect" type="button" data-recovery-entry="' + esc(row.recoveryId) + '">' + esc(row.method + ' ' + row.routeId) + '</button><span class="subtle">' + esc(network(row.network)) + '</span></td><td class="exact">' + esc(row.amountAtomic) + '</td><td>' + esc(shown(row.verification?.verdict)) + '</td><td>' +
    (row.response ? '<a download href="/api/recovered/' + endpoint(row.recoveryId) + '/response">Download response</a><span class="subtle">' + esc(row.response.bytes) + ' bytes</span>' : 'Not retained') + '</td></tr>'
  ).join('') || '<tr><td colspan="4" class="empty">' + (state?.recovery?.directory ? 'No recovered payments match this view.' : 'Connect an original recovered payment collection to inspect its entries.') + '</td></tr>';
  $('recovery-entry-count').textContent = found.length ? (recoveryOffset + 1) + '–' + Math.min(recoveryOffset + LIMIT,found.length) + ' of ' + found.length + ' recovered payments' : '0 recovered payments';
  $('recovery-previous').disabled = recoveryOffset === 0;
  $('recovery-next').disabled = recoveryOffset + LIMIT >= found.length;
  const row = collection.find(item => item.recoveryId === recoverySelection);
  $('recovery-entry-detail').innerHTML = row
    ? '<h3>' + esc(row.method + ' ' + row.routeId) + '</h3>' + (row.response ? '<div class="actions"><a class="button" download href="/api/recovered/' + endpoint(row.recoveryId) + '/response">Download original response</a></div>' : '') + values(row)
    : '<p class="empty">Select a recovered payment to inspect its full original values.</p>';
}
function renderRecovery() {
  const recovery = state.recovery || {directory:null,capturedAt:null,entries:[]};
  const previews = state.recoveryPreviews || [], jobs = state.recoveryJobs || [];
  if (!$('recovery-directory').dataset.dirty) $('recovery-directory').value = recovery.directory || '';
  $('recovery-source-saved').textContent = recovery.directory ? 'Connected: ' + recovery.directory : 'No recovered payment collection is connected.';
  $('recovery-captured').textContent = recovery.capturedAt ? 'Last collection refresh: ' + date(recovery.capturedAt) : 'The collection is refreshed when you request it.';
  $('recovery-metrics').innerHTML = metrics([['Retained recovered entries',recovery.entries.length],['Original response files',recovery.entries.filter(row => row.response).length],['Saved input reviews',previews.length],['Active imports',jobs.filter(job => ['queued','running'].includes(job.status)).length]]);
  if (previews.length) selectOptions($('recovery-preview-select'),previews.map(item => [item.id,item.name + ' · ' + date(item.createdAt)]));
  else $('recovery-preview-select').innerHTML = '<option value="">Review original inputs first</option>';
  renderRecoveryPreview();
  const active = jobs.find(job => ['queued','running'].includes(job.status));
  $('recovery-progress').hidden = !active;
  $('recovery-progress-text').textContent = active ? active.name + ' · ' + friendly(active.status) + (active.cancelRequested ? ' · stop requested' : ' · original transfer verification and retained-source import') : '';
  $('recovery-jobs').innerHTML = jobs.slice(0,recoveryJobLimit).map(job => {
    const ongoing = ['queued','running'].includes(job.status);
    const retryable = ['failed','interrupted','cancelled'].includes(job.status);
    const result = job.result ? shown(job.result) : job.error || 'Original verifier result will appear here.';
    return '<tr><td><strong>' + esc(job.name) + '</strong><span class="subtle">' + esc(job.actor) + ' · ' + esc(date(job.createdAt)) + '</span><details class="history-detail"><summary>Saved attempt</summary>' + values({id:job.id,previewId:job.previewId,recoveredDir:job.recoveredDir,startedAt:job.startedAt,completedAt:job.completedAt}) + '</details></td><td>' + badge(job.status) + '</td><td><div class="recovery-native-result">' + esc(result) + '</div></td><td><div class="actions"><button type="button" data-recovery-preview="' + esc(job.previewId) + '">Inspect inputs</button>' +
      (ongoing ? '<button type="button" data-write data-recovery-cancel="' + esc(job.id) + '" data-requested="' + Boolean(job.cancelRequested) + '">' + (job.cancelRequested ? 'Stop requested' : 'Stop attempt') + '</button>' : '') +
      (retryable ? '<button type="button" data-write data-recovery-retry="' + esc(job.previewId) + '">Retry original import</button>' : '') + '</div></td></tr>';
  }).join('') || '<tr><td colspan="4" class="empty">Original transfer verification attempts will be retained here.</td></tr>';
  $('recovery-job-count').textContent = Math.min(jobs.length,recoveryJobLimit) + ' of ' + jobs.length + ' saved attempts';
  $('recovery-job-more').hidden = jobs.length <= recoveryJobLimit;
  renderRecoveryEntries();
}
function recoveryConfigBody() {
  const name = $('recovery-config-name').value.trim(), content = $('recovery-config-content').value;
  if (!name) throw new Error('Name this original input review.');
  if (!content.trim() || new TextEncoder().encode(content).length > 200_000) throw new Error('Use an original recovery request JSON up to 200 KB.');
  try { JSON.parse(content); } catch { throw new Error('The original recovery request must be valid JSON.'); }
  return {name,content};
}
async function importRecovery(previewId) {
  if (!previewId) throw new Error('Choose a saved original input review.');
  await perform({path:'/api/recovered/import',body:{revision:state.revision,previewId,actor:operator()},description:'original recovered-payment import',message:'Original transfer verification started. Its result and any retained import are shown in the saved attempts.',success:() => openArea('recovery')});
}

document.querySelectorAll('[data-area]').forEach(button => button.addEventListener('click',() => openArea(button.dataset.area)));
document.querySelectorAll('[data-open-sources]').forEach(button => button.addEventListener('click',() => openArea('sources')));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => attempt(async () => {
  retainReviewDraft(); view = button.dataset.view; selectedKey = null; records.offset = 0;
  document.querySelectorAll('[data-view]').forEach(item => { item.classList.toggle('active',item === button); item.setAttribute('aria-pressed',String(item === button)); });
  await loadRecords(0);
})));
$('operator').value = remembered('operator');
$('operator').addEventListener('input',() => remember('operator',$('operator').value));
$('refresh').addEventListener('click',() => attempt(async () => { retainReviewDraft(); await refreshState(); notify('Loaded saved workspace revision ' + state.revision + '. Form drafts are retained.'); }));
$('run-search').addEventListener('input',() => { runLimit = 30; if (state) renderRuns(); });
$('run-more').addEventListener('click',() => { runLimit += 30; renderRuns(); });
$('run-list').addEventListener('click',event => {
  const button = event.target.closest('[data-run]');
  if (button) attempt(async () => { retainReviewDraft(); await loadRun(button.dataset.run,{reset:true}); if (selectedReport?.run.status === 'complete') { $('export-run').value = selectedRun; $('compare-current').value = selectedRun; renderDownloads(); } openArea('reconcile'); });
});
$('run-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
  const name = $('run-name').value.trim(); if (!name) return;
  const body = {revision:state.revision,name,actor:operator()};
  await perform({path:'/api/runs',body,description:'reconciliation request',message:'Reconciliation captured. The original accounting engine is processing the retained sources.',success:async result => { if ($('run-name').value.trim() === name) $('run-name').value = ''; await loadRun(result.run.id,{reset:true}); openArea('reconcile'); }});
}); });
$('filter-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => { retainReviewDraft(); selectedKey = null; await loadRecords(0); }); });
$('previous').addEventListener('click',() => attempt(async () => { retainReviewDraft(); await loadRecords(Math.max(0,records.offset - LIMIT)); }));
$('next').addEventListener('click',() => attempt(async () => { retainReviewDraft(); await loadRecords(records.offset + LIMIT); }));
$('record-body').addEventListener('click',event => {
  const button = event.target.closest('[data-inspect]'); if (!button) return;
  retainReviewDraft(); const row = records.items[Number(button.dataset.inspect)]; if (!row) return;
  selectedKey = keyOf(row); renderRecords();
  $('record-detail').focus({preventScroll:true});
  if (matchMedia('(max-width:1150px)').matches) $('record-detail').scrollIntoView({block:'start',behavior:'smooth'});
});
$('record-detail').addEventListener('input',event => { if (event.target.closest('#review-form')) retainReviewDraft(); });
$('record-detail').addEventListener('change',event => { if (event.target.closest('#review-form')) retainReviewDraft(); });
$('record-detail').addEventListener('submit',event => {
  if (event.target.id !== 'review-form') return;
  event.preventDefault(); attempt(async () => {
    const form = event.target; retainReviewDraft();
    const key = reviewDraftKey(form.dataset.run,form.dataset.id), draft = drafts.get(key);
    const body = {...draft,actor:operator()};
    const review = {runId:form.dataset.run,id:form.dataset.id,eventId:form.dataset.event};
    await perform({path:'/api/runs/' + endpoint(review.runId) + '/exceptions/' + endpoint(review.id) + '/review',body,review,description:'exception review',message:'Named exception review saved.',success:async () => { drafts.delete(key); if (selectedRun === review.runId) await loadRun(selectedRun); }});
  });
});
$('terms-selection').addEventListener('change',() => { $('terms-selection').dataset.dirty = 'true'; });
$('terms-selection-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
  const body = {revision:state.revision,selection:$('terms-selection').value,actor:operator()};
  await perform({path:'/api/terms/selection',body,description:'accounting terms selection',message:'Terms selection saved for the next reconciliation.',success:() => { delete $('terms-selection').dataset.dirty; renderSources(); }});
}); });
async function importFile(kind) {
  const input = $(kind === 'terms' ? 'terms-file' : 'proof-file'), file = input.files[0], max = kind === 'terms' ? 200_000 : 80_000;
  if (!file) throw new Error('Choose a JSON file to import.');
  if (file.size > max) throw new Error('Choose a file up to ' + (max / 1000) + ' KB.');
  const actor = operator(), revision = state.revision, content = await file.text();
  const body = {revision,name:file.name,content,actor};
  await perform({path:'/api/' + kind,body,description:kind === 'terms' ? 'accounting terms import' : 'verification file import',message:result => result.duplicate ? 'These exact verification bytes are already retained. Their existing selection is preserved.' : kind === 'terms' ? 'Accounting terms imported and selected for the next reconciliation.' : 'Original verification file imported. Its native verdict and eligibility are visible below.',success:() => { if (input.files[0] === file) input.value = ''; if (kind === 'terms') { delete $('terms-selection').dataset.dirty; renderSources(); } }});
}
$('terms-import-form').addEventListener('submit',event => { event.preventDefault(); attempt(() => importFile('terms')); });
$('proof-form').addEventListener('submit',event => { event.preventDefault(); attempt(() => importFile('proofs')); });
$('proof-imports').addEventListener('click',event => {
  const button = event.target.closest('[data-proof-selection]'); if (!button) return;
  attempt(() => perform({path:'/api/proofs/' + endpoint(button.dataset.proofSelection) + '/selection',body:{revision:state.revision,included:button.dataset.included === 'true',actor:operator()},description:'verification file selection',message:'Verification selection saved for the next reconciliation.'}));
});
$('recovery-directory').addEventListener('input',() => { $('recovery-directory').dataset.dirty = 'true'; });
$('recovery-source-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
  const currentBody = () => {
    const directory = $('recovery-directory').value.trim();
    if (!directory) throw new Error('Enter the private original recovered collection directory.');
    return {directory};
  };
  await perform({path:'/api/recovered/source',body:{revision:state.revision,actor:operator(),...currentBody()},currentBody,description:'recovered source connection',message:'Original recovered collection connected for future reconciliations.',success:() => {
    if ($('recovery-directory').value.trim() === state.recovery.directory) delete $('recovery-directory').dataset.dirty;
    renderRecovery();
  }});
}); });
$('recovery-refresh').addEventListener('click',() => attempt(() => perform({path:'/api/recovered/refresh',body:{revision:state.revision,actor:operator()},description:'recovered collection refresh',message:'Original recovered collection refreshed. Saved reconciliations retain their existing source captures.'})));
$('recovery-disconnect').addEventListener('click',() => attempt(() => perform({path:'/api/recovered/source',body:{revision:state.revision,actor:operator(),directory:null},description:'recovered source disconnection',message:'Recovered collection disconnected from future runs. Existing entries and saved runs remain in their original storage.',success:() => { delete $('recovery-directory').dataset.dirty; renderRecovery(); }})));
$('recovery-config-file').addEventListener('change',() => attempt(async () => {
  const file = $('recovery-config-file').files[0];
  if (!file) return;
  if (file.size > 200_000) throw new Error('Choose an original recovery request JSON up to 200 KB.');
  const content = await file.text();
  if ($('recovery-config-file').files[0] !== file) return;
  $('recovery-config-content').value = content;
  $('recovery-config-name').value = file.name;
  notify('Original recovery request loaded. Review the retained inputs to inspect their binding.');
}));
$('recovery-config-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
  await perform({path:'/api/recovered/review',body:{revision:state.revision,actor:operator(),...recoveryConfigBody()},currentBody:recoveryConfigBody,description:'original recovery input review',message:'Original source files reviewed locally. Their exact request, receipt, terms, and response identities are retained below.',success:result => {
    $('recovery-preview-select').value = result.preview.id;
    renderRecoveryPreview();
    $('recovery-preview-select').scrollIntoView({block:'center',behavior:'smooth'});
  }});
}); });
$('recovery-preview-select').addEventListener('change',renderRecoveryPreview);
$('recovery-import').addEventListener('click',() => attempt(() => importRecovery($('recovery-preview-select').value)));
$('recovery-jobs').addEventListener('click',event => {
  const inspect = event.target.closest('[data-recovery-preview]');
  if (inspect) { $('recovery-preview-select').value = inspect.dataset.recoveryPreview; renderRecoveryPreview(); $('recovery-preview-select').scrollIntoView({block:'center',behavior:'smooth'}); }
  const cancel = event.target.closest('[data-recovery-cancel]');
  if (cancel) attempt(() => perform({path:'/api/recovered/jobs/' + endpoint(cancel.dataset.recoveryCancel) + '/cancel',body:{actor:operator()},description:'original import stop request',message:'Stop requested. A completed native import remains retained; retry reuses that original entry.'}));
  const retry = event.target.closest('[data-recovery-retry]');
  if (retry) attempt(() => importRecovery(retry.dataset.recoveryRetry));
});
$('recovery-job-more').addEventListener('click',() => { recoveryJobLimit += 20; renderRecovery(); updateButtons(); });
$('recovery-filter-form').addEventListener('submit',event => { event.preventDefault(); recoverySearch = $('recovery-search').value.trim().toLowerCase(); recoveryOffset = 0; renderRecoveryEntries(); });
$('recovery-previous').addEventListener('click',() => { recoveryOffset = Math.max(0,recoveryOffset - LIMIT); renderRecoveryEntries(); });
$('recovery-next').addEventListener('click',() => { recoveryOffset += LIMIT; renderRecoveryEntries(); });
$('recovery-entries').addEventListener('click',event => {
  const button = event.target.closest('[data-recovery-entry]');
  if (!button) return;
  recoverySelection = button.dataset.recoveryEntry; renderRecoveryEntries();
  $('recovery-entry-detail').focus({preventScroll:true});
  if (matchMedia('(max-width:1150px)').matches) $('recovery-entry-detail').scrollIntoView({block:'start',behavior:'smooth'});
});
$('reload-conflict').addEventListener('click',() => attempt(reloadConflict));
$('reapply-conflict').addEventListener('click',() => attempt(reapplyConflict));
$('dismiss-conflict').addEventListener('click',() => { if (busy) return; pendingIntent = null; $('conflict').hidden = true; updateButtons(); notify('Saved-state conflict dismissed. Unsaved form drafts remain in this tab.'); });
$('compare-form').addEventListener('submit',event => { event.preventDefault(); attempt(() => compareRuns(0)); });
for (const id of ['compare-current','compare-baseline','compare-view']) $(id).addEventListener('change',() => { $(id).dataset.chosen = 'true'; comparison = null; ++compareRequest; renderComparison(); });
$('compare-previous').addEventListener('click',() => attempt(() => compareRuns(Math.max(0,comparison.offset - LIMIT))));
$('compare-next').addEventListener('click',() => attempt(() => compareRuns(comparison.offset + LIMIT)));
$('export-run').addEventListener('change',renderDownloads);
$('export-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
  const id = $('export-run').value; if (!id) throw new Error('Choose a completed reconciliation.');
  await perform({path:'/api/runs/' + endpoint(id) + '/exports',body:{revision:state.revision,actor:operator(),includeSources:$('include-sources').checked},description:'review archive request',message:'Review archive created. Use Download archive in the retained exports below.'});
}); });

selectedRun = remembered('selected-run');
attempt(async () => { adopt(await api('/api/state')); await loadRun(selectedRun); });
