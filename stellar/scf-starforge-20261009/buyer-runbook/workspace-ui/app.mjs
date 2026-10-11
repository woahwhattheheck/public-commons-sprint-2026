// MIT. Browser presentation; the original server-side buyer owns execution.
import {createHandoffIntakeUI} from './intake.mjs';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatTime = value => value ? new Date(value).toLocaleString() : '—';
const readable = value => String(value ?? '—').toLowerCase().replaceAll('_',' ');
let state, token, draft = null, rows = [], currentRun = null, view = 'welcome', dirty = false, saving = false, timer;
let navigation = 0, editorVersion = 0, sourceRefresh = 0;
const resourcePreviews = new Map();
const previewToOpen = new Set();
const intakeUI = createHandoffIntakeUI({request,notice,refreshState,
  openPanel(){navigation++;show('requests');},
  async onPrepared(prepared,item){
    await refreshState();
    const saved=draft&&state.drafts.find(value=>value.id===draft.id);
    if(!$('#draft-form').elements['plan-id'].value||saved&&saved.initialization!=='NOT_STARTED')newDraft();
    if(rows.some(row=>sourceName(row.config)===prepared.configName)){
      show('draft');notice('This request is already included in the current plan.');return;
    }
    if(rows.length>=64)throw new Error('This plan already has 64 operations. Create another plan to add this request.');
    let index=rows.length+1;while(rows.some(row=>row.id==='request-'+index))index++;
    rows.push({id:'request-'+index,label:('POST '+new URL(item.summary.url).pathname).slice(0,160),config:prepared.configName,saveAs:''});
    navigation++;currentRun=null;renderEditor();show('draft');setDirty(true);
    notice('Received request added. Save and review this plan, then initialize the acquisition.');
  }});

function notice(message, error = false) {
  const element = $('#notice'); element.textContent = message; element.className = error ? 'error' : ''; element.hidden = !message;
}
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {cache:'no-store'} : {method:'POST',
    headers:{'content-type':'application/json','x-runbook-session':token}, body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? readable(result.code));
  return result;
}
const handle = action => async event => { if (event?.type === 'submit') event.preventDefault(); try { await action(event); } catch (error) { notice(error.message,true); } };
function show(name) {
  view = name;
  for (const target of ['welcome','draft-panel','run-panel','requests-panel']) $('#' + target).hidden = target !== (name === 'welcome' ? name : name + '-panel');
  renderNavigation();
}
async function refreshState() {
  const generation = ++sourceRefresh, result = await request('/api/state');
  if (generation !== sourceRefresh) return;
  state = result; token = state.token; renderNavigation();
  intakeUI.update(state.intake);
  $('#terminal-state').textContent = state.terminalAvailable ? 'Operator terminal available' : 'Open in a terminal to execute';
  const valid = state.configurations.filter(item => item.valid).length;
  $('#source-summary').innerHTML = `<strong>${valid} ready buyer configuration${valid === 1 ? '' : 's'}</strong><p class="wrap">${escape(state.configsDirectory)}</p>`;
  if (state.errors.length) notice(`${state.errors.length} saved item${state.errors.length === 1 ? '' : 's'} need local attention: ${state.errors.map(item => item.id + ' · ' + readable(item.code)).join('; ')}`,true);
}
function renderNavigation() {
  if (!state) return;
  $('#run-list').innerHTML = state.acquisitions.length ? state.acquisitions.map(item =>
    `<button class="nav-item ${view === 'run' && currentRun?.id === item.id ? 'selected' : ''}" data-run="${escape(item.id)}"><span>${escape(item.title)}</span><small>${escape(item.planId)}${item.imported ? ' · existing run' : ''}</small></button>`).join('') : '<span class="empty-nav">No saved acquisitions</span>';
  $('#draft-list').innerHTML = state.drafts.length ? state.drafts.map(item =>
    `<button class="nav-item ${view === 'draft' && draft?.id === item.id ? 'selected' : ''}" data-draft="${escape(item.id)}"><span>${escape(item.title)}</span><small>Revision ${item.revision} · ${item.operations} operations${item.initialized ? ' · initialized' : item.initialization === 'INCOMPLETE' ? ' · resume initialization' : ''}</small></button>`).join('') : '<span class="empty-nav">Your saved plans appear here</span>';
}
function sourceName(value) {
  const prefix = state.configsDirectory + '/';
  return value.startsWith(prefix) ? value.slice(prefix.length) : value.replace(/^\.\//,'');
}
function setDirty(value) {
  if (value) editorVersion++;
  dirty = value;
  const saved = draft && state.drafts.find(item => item.id === draft.id), ready = saved?.initialized;
  const incomplete = saved?.initialization === 'INCOMPLETE';
  if (ready || incomplete) for (const element of $('#draft-form').elements) element.disabled = true;
  $('#dirty-badge').textContent = dirty ? 'Unsaved changes' : ready ? 'Initialized' : incomplete ? 'Initialization interrupted' : 'Saved revision';
  $('#initialize-run').textContent = ready ? 'Open acquisition' : incomplete ? 'Resume initialization' : 'Initialize acquisition';
  $('#initialize-run').disabled = !draft || (!ready && (dirty || draft.revision !== draft.revisions[0]));
  $('#draft-save-status').textContent = ready ? 'This acquisition keeps its initialized request snapshots.' : incomplete ? 'The reviewed revision is retained. Resume to finish writing its original snapshots.' : '';
}
function configurationOptions(selected) {
  const valid = state.configurations.filter(item => item.valid);
  let result = valid.map(item => `<option value="${escape(item.name)}" ${item.name === selected ? 'selected' : ''}>${escape(item.name)} · ${escape(item.method)} ${escape(item.url)}</option>`).join('');
  if (selected && !valid.some(item => item.name === selected)) result = `<option value="${escape(selected)}" selected>${escape(selected)} · source unavailable</option>` + result;
  return '<option value="">Select an original buyer configuration</option>' + result;
}
function sourceHint(name) {
  const item = state.configurations.find(item => item.name === name);
  return item?.valid ? `${item.intentId} · ${item.acceptedCaps.network} · ceiling ${item.acceptedCaps.maxAtomic} atomic` : 'Select a complete original buyer configuration.';
}
function renderEditor() {
  $('#operation-count').textContent = `${rows.length} / 64`;
  $('#add-operation').disabled = rows.length >= 64;
  $('#operation-editor').innerHTML = rows.map((row,index) => `<div class="operation-edit" data-index="${index}">
    <div class="row-top"><strong>Operation ${index + 1}</strong><div class="toolbar"><button type="button" class="small-button quiet" data-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move operation ${index + 1} up">↑</button><button type="button" class="small-button quiet" data-move="1" ${index === rows.length - 1 ? 'disabled' : ''} aria-label="Move operation ${index + 1} down">↓</button><button type="button" class="small-button quiet" data-remove aria-label="Remove operation ${index + 1}">Remove</button></div></div>
    <div class="fields"><label>Operation ID<input required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" data-field="id" value="${escape(row.id)}"></label><label>Label<input maxlength="160" data-field="label" value="${escape(row.label)}"></label></div>
    <label class="configuration">Original configuration<select required data-field="config">${configurationOptions(row.config)}</select></label>
    <p class="source-hint">${escape(sourceHint(row.config))}</p>
    <label>Save resource as <span class="muted">Optional filename inside this acquisition</span><input maxlength="128" data-field="saveAs" value="${escape(row.saveAs)}" placeholder="Keep configured output destination"></label>
  </div>`).join('');
  if (!rows.length) $('#operation-editor').innerHTML = '<div class="panel muted">Add a configuration to start arranging this acquisition.</div>';
}
function newDraft() {
  navigation++;
  draft = null; currentRun = null; rows = [];
  $('#draft-heading').textContent = 'New acquisition plan';
  $('#draft-version').textContent = 'Choose the original buyer configurations to include.';
  $('#draft-form').elements['plan-id'].value = 'acquisition-' + new Date().toISOString().slice(0,10).replaceAll('-','');
  $('#draft-form').elements['plan-title'].value = 'Resource acquisition';
  for (const element of $('#draft-form').elements) element.disabled = false;
  $('#draft-review').hidden = true; $('#import-panel').hidden = true; $('#draft-save-status').textContent = '';
  renderEditor(); show('draft'); setDirty(true); notice('');
}
async function openDraft(id, revision) {
  const generation = ++navigation;
  const result = await request('/api/drafts/' + id + (revision ? '/' + revision : ''));
  if (generation !== navigation) return;
  draft = result;
  rows = draft.manifest.operations.map(row => ({...row, config:sourceName(row.config)}));
  $('#draft-heading').textContent = draft.plan.title;
  $('#draft-version').textContent = `Revision ${draft.revision} · saved ${formatTime(draft.savedAt)}`;
  $('#draft-form').elements['plan-id'].value = draft.manifest.id;
  $('#draft-form').elements['plan-title'].value = draft.manifest.title ?? draft.manifest.id;
  for (const element of $('#draft-form').elements) element.disabled = false;
  renderEditor(); show('draft'); renderReview();
  setDirty(false);
}
function budgetTable(plan) {
  return `<div class="table-wrap"><table><thead><tr><th>Network</th><th>Asset</th><th>Operations</th><th>Maximum atomic</th></tr></thead><tbody>${plan.plannedMaximums.map(row =>
    `<tr><td>${escape(row.network)}</td><td><code>${escape(row.asset)}</code></td><td>${row.operations}</td><td class="amount">${escape(row.plannedMaximumAtomic)}</td></tr>`).join('')}</tbody></table></div>`;
}
function terms(row) {
  const cap = row.acceptedCaps;
  return `<dl class="detail-grid"><div><dt>Stable intent</dt><dd><code>${escape(row.intentId)}</code></dd></div><div><dt>Actor / service</dt><dd>${escape(row.actor)} / ${escape(row.service)}</dd></div><div><dt>Recipient</dt><dd><code>${escape(cap.payTo)}</code></dd></div><div><dt>Request ceiling</dt><dd class="amount">${escape(cap.maxAtomic)} atomic · ${escape(cap.network)}</dd></div><div><dt>Exact asset</dt><dd><code>${escape(cap.asset)}</code></dd></div><div><dt>Timeout / payment flow</dt><dd>${cap.maxTimeoutSeconds === undefined ? 'Native default' : escape(cap.maxTimeoutSeconds) + ' seconds'} / ${escape(cap.paymentFlow ?? 'original exact')}</dd></div><div><dt>Response destination</dt><dd><code>${escape(row.responseFile?.destination ?? 'Original buyer output')}</code></dd></div><div><dt>Request body</dt><dd>${row.body ? `${row.body.bytes} bytes · <code>${escape(row.body.sha256)}</code>` : 'No body'}</dd></div><div><dt>Config snapshot</dt><dd><code>${escape(row.config.sha256)}</code></dd></div></dl>`;
}
function renderReview() {
  $('#draft-review').hidden = false;
  $('#revision-picker').innerHTML = draft.revisions.map(revision => `<option value="${revision}" ${revision === draft.revision ? 'selected' : ''}>${revision}</option>`).join('');
  $('#draft-review-content').innerHTML = budgetTable(draft.plan) + '<p class="review-note">These are the selected request ceilings. The original buyer reviews live terms and requests approval in the operator terminal.</p>' + draft.plan.operations.map(row =>
    `<article class="review-operation"><h3>${escape(row.label)}</h3><p class="operation-url">${escape(row.method)} ${escape(row.url)}</p>${terms(row)}</article>`).join('');
}
function manifestFromEditor() {
  return {schema:'stellar-forge.buyer-runbook.v1',id:$('#draft-form').elements['plan-id'].value,
    title:$('#draft-form').elements['plan-title'].value,operations:rows.map(row => ({id:row.id,config:row.config,
      ...(row.label ? {label:row.label} : {}),...(row.saveAs ? {saveAs:row.saveAs} : {})}))};
}
async function saveDraft() {
  if (saving) return;
  saving = true; $('#save-draft').disabled = true;
  const generation = navigation, edited = editorVersion, originalId = draft?.id;
  try {
    const result = await request('/api/drafts/save',{id:draft?.id,expectedRevision:draft?.revisions[0] ?? 0,manifest:manifestFromEditor()});
    await refreshState();
    if (generation === navigation && view === 'draft' && draft?.id === originalId) {
      if (edited === editorVersion) {
        await openDraft(result.id); notice('Draft saved. Review the exact requests below, then initialize the acquisition.');
      } else {
        draft = result; renderReview(); setDirty(true);
        notice(`Revision ${result.revision} saved. Your newer edits remain in the editor.`);
      }
    } else notice(`Saved ${result.plan.title}, revision ${result.revision}. It is available in Drafts.`);
  } finally {
    saving = false;
    const saved = draft && state.drafts.find(item => item.id === draft.id);
    $('#save-draft').disabled = Boolean(saved?.initialized || saved?.initialization === 'INCOMPLETE');
  }
}
async function openRun(id) {
  const generation = ++navigation, result = await request('/api/runs/' + id);
  if (generation !== navigation) return;
  currentRun = result; show('run'); renderRun();
}
function renderRun() {
  const {id, state:run, active, terminalAvailable} = currentRun;
  const running = Boolean(active && !active.finishedAt), lock = run.executionLock;
  const rows = run.operations, untouched = rows.filter(row => row.state === 'UNATTEMPTED');
  const saved = rows.filter(row => row.result?.summary?.responseFile?.status === 'SAVED');
  const attention = rows.filter(row => row.lastError || row.result?.summary?.error || row.integrity !== 'UNCHANGED' ||
    row.state === 'INTERRUPTED_NO_RESULT' && !lock?.ownerRunning);
  $('#run-title').textContent = run.plan.title;
  $('#run-subtitle').textContent = `${run.plan.id} · initialized ${formatTime(run.plan.createdAt)}`;
  $('#run-status').textContent = running ? readable(active.status) : lock ? 'Execution owner present' : untouched.length ? 'Ready' : 'Results retained';
  $('#run-metrics').innerHTML = [[rows.length,'Selected operations'],[untouched.length,'Untouched'],[saved.length,'Resources saved'],[attention.length,'Need attention']]
    .map(([value,label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#execution-message').textContent = running ? active.cancelRequested ? 'Cancellation requested' : 'Original buyer execution is active' : terminalAvailable ? 'Continue through the operator terminal' : 'Operator terminal required';
  $('#execution-detail').textContent = running ? 'Progress and results update here while the original buyer finishes its current operation.' : terminalAvailable ? 'Each untouched operation receives its original live-term review and terminal approval.' : 'Start this workspace in a controlling terminal to execute these saved requests.';
  $('#execute-run').disabled = running || Boolean(lock) || !terminalAvailable || !untouched.length;
  $('#cancel-run').hidden = !running;
  $('#cancel-run').disabled = Boolean(active?.cancelRequested);
  $('#recover-run').disabled = running || Boolean(lock);
  $('#lease-panel').hidden = !lock;
  if (lock) {
    $('#lease-description').textContent = `PID ${lock.pid} · ${lock.host} · generation ${lock.generation} · started ${formatTime(lock.startedAt)} · ${lock.ownerRunning === true ? 'running' : lock.ownerRunning === false ? 'owner process has ended' : 'host liveness unavailable'}`;
    $('#unlock-run').disabled = lock.ownerRunning !== false;
  }
  $('#run-budgets').innerHTML = budgetTable(run.plan);
  $('#download-json').href = `/files/${id}/report.json`;
  $('#download-report').href = `/files/${id}/report.html`;
  const opened = new Set([...$('#run-operations').querySelectorAll('details[open]')].map(element => element.dataset.detail));
  $('#run-operations').innerHTML = rows.map(row => {
    const summary = row.result?.summary, resource = summary?.responseFile;
    const status = row.state === 'INTERRUPTED_NO_RESULT' && lock?.ownerRunning ? 'IN_PROGRESS' : row.lastError ? 'LOCAL_SETUP_NEEDED' : row.state;
    const available = resource?.status === 'SAVED' && row.downloadName;
    const preview = resourcePreviews.get(id + ':' + row.id);
    const requestedPreview = previewToOpen.delete(id + ':' + row.id);
    const previewOpen = opened.has(row.id + '-resource') || requestedPreview;
    const only = row.state === 'UNATTEMPTED' && row.integrity === 'UNCHANGED' && !running && !lock && terminalAvailable;
    return `<article class="result-operation"><div class="operation-title"><div><h3>${escape(row.label)}</h3><span class="muted">${escape(row.id)}</span></div><span class="badge">${escape(readable(status))}</span></div>
      <p class="operation-url">${escape(row.method)} ${escape(row.url)}</p>
      <dl class="detail-grid"><div><dt>Original buyer status</dt><dd>${escape(summary?.status ?? summary?.error?.code ?? row.lastError?.code ?? 'Awaiting execution')}</dd></div><div><dt>Saved resource</dt><dd>${escape(resource?.status ?? 'Awaiting original response')}${resource?.bytes !== undefined ? ' · ' + escape(resource.bytes) + ' bytes' : ''}</dd></div><div><dt>Input snapshot</dt><dd>${escape(readable(row.integrity))}${row.integrityError ? ' · ' + escape(row.integrityError) : ''}</dd></div><div><dt>Original evidence</dt><dd><code>${escape(summary?.evidencePath ?? row.evidenceDirectory)}</code></dd></div></dl>
      <div class="result-actions">${available ? `<button data-preview="${escape(row.id)}">Preview resource</button><a class="button" href="/files/${id}/resources/${escape(row.id)}">Download ${escape(row.downloadName)}</a>` : ''}${only ? `<button data-only="${escape(row.id)}">Execute this operation</button>` : ''}</div>
      ${preview ? `<details data-detail="${escape(row.id)}-resource" ${previewOpen ? 'open' : ''}><summary>${escape(preview.name)} · ${preview.bytes} bytes${preview.truncated ? ' · first 64 KiB shown' : ''}</summary>${preview.text === null ? '<p class="muted">Download this binary resource to open it in its original format.</p>' : `<pre>${escape(preview.text)}</pre>`}</details>` : ''}
      <details data-detail="${escape(row.id)}-terms" ${opened.has(row.id + '-terms') ? 'open' : ''}><summary>Exact request and snapshot</summary>${terms(row)}</details>
      ${row.result || row.lastError ? `<details data-detail="${escape(row.id)}-result" ${opened.has(row.id + '-result') ? 'open' : ''}><summary>Original retained result</summary><pre>${escape(JSON.stringify(row.result ?? row.lastError,null,2))}</pre></details>` : ''}</article>`;
  }).join('');
  $('#progress-events').innerHTML = active?.events?.length ? active.events.map(event => `<div class="event"><span>${escape(new Date(event.at).toLocaleTimeString())}</span><code>${escape(event.id)} · ${escape(readable(event.status))}${event.code ? ' · ' + escape(event.code) : ''}</code></div>`).join('') : '<p class="muted">Execution events appear here while this workspace owns a run.</p>';
}
async function action(path, extra = {}) {
  const id = currentRun.id, generation = navigation;
  await request('/api/runs/' + path,{id,...extra});
  if (generation === navigation && view === 'run' && currentRun?.id === id) await openRun(id);
}
async function poll() {
  clearTimeout(timer);
  try { if (view === 'run' && currentRun) {
    const id = currentRun.id, generation = navigation, result = await request('/api/runs/' + id);
    if (generation === navigation && view === 'run' && currentRun?.id === id) { currentRun = result; renderRun(); }
  } }
  catch (error) { notice(error.message,true); }
  timer = setTimeout(poll,currentRun?.active && !currentRun.active.finishedAt ? 1500 : 6000);
}

$('#new-draft').addEventListener('click',handle(newDraft));
$('#welcome-new').addEventListener('click',handle(newDraft));
$('#refresh').addEventListener('click',handle(async () => { await refreshState(); if (view === 'run') await openRun(currentRun.id); if(view==='requests')await intakeUI.refresh(); notice('Local sources refreshed.'); }));
$('.sidebar').addEventListener('click',handle(async event => {
  const run = event.target.closest('[data-run]'), plan = event.target.closest('[data-draft]');
  if (run) { notice(''); await openRun(run.dataset.run); }
  if (plan) { notice(''); await openDraft(plan.dataset.draft); }
}));
$('#draft-form').addEventListener('input',event => {
  const row = event.target.closest('[data-index]');
  if (row && event.target.dataset.field) rows[Number(row.dataset.index)][event.target.dataset.field] = event.target.value;
  setDirty(true);
});
$('#operation-editor').addEventListener('change',event => {
  if (event.target.dataset.field === 'config') event.target.closest('[data-index]').querySelector('.source-hint').textContent = sourceHint(event.target.value);
});
$('#operation-editor').addEventListener('click',handle(event => {
  const button = event.target.closest('button'), row = button?.closest('[data-index]'); if (!row) return;
  const index = Number(row.dataset.index);
  if (button.hasAttribute('data-remove')) rows.splice(index,1);
  if (button.dataset.move) { const next = index + Number(button.dataset.move); if (next >= 0 && next < rows.length) [rows[index],rows[next]] = [rows[next],rows[index]]; }
  renderEditor(); setDirty(true);
}));
$('#add-operation').addEventListener('click',handle(() => {
  if (rows.length >= 64) return;
  const config = state.configurations.find(item => item.valid && !rows.some(row => row.config === item.name));
  let index = rows.length + 1; while (rows.some(row => row.id === 'resource-' + index)) index++;
  rows.push({id:'resource-' + index,label:'',config:config?.name ?? '',saveAs:''}); renderEditor(); setDirty(true);
}));
$('#import-toggle').addEventListener('click',() => { $('#import-panel').hidden = !$('#import-panel').hidden; });
$('#import-manifest').addEventListener('click',handle(() => {
  const value = JSON.parse($('#manifest-input').value);
  if (value.schema !== 'stellar-forge.buyer-runbook.v1' || !Array.isArray(value.operations) || value.operations.length > 64) throw new Error('Paste a complete original buyer runbook manifest.');
  rows = value.operations.map(row => ({...row,config:sourceName(row.config)}));
  $('#draft-form').elements['plan-id'].value = value.id ?? '';
  $('#draft-form').elements['plan-title'].value = value.title ?? value.id ?? '';
  renderEditor(); setDirty(true); $('#import-panel').hidden = true; notice('Manifest loaded into the editor. Save it to review the original inputs.');
}));
$('#draft-form').addEventListener('submit',handle(saveDraft));
$('#initialize-run').addEventListener('click',handle(async () => {
  if (state.drafts.find(item => item.id === draft.id)?.initialized) return openRun(draft.id);
  if (dirty) throw new Error('Save this revision before initializing the acquisition.');
  const generation = navigation, id = draft.id;
  $('#initialize-run').disabled = true;
  try {
    const result = await request('/api/drafts/initialize',{id,expectedRevision:draft.revision,reviewSha256:draft.reviewSha256});
    await refreshState();
    if (generation === navigation && view === 'draft' && draft?.id === id) await openRun(result.id);
    notice('Acquisition initialized with the reviewed request snapshots.');
  } finally {
    if (generation === navigation && view === 'draft') {
      await refreshState().catch(() => {});
      setDirty(dirty);
    }
  }
}));
$('#revision-picker').addEventListener('change',handle(event => openDraft(draft.id,Number(event.target.value))));
$('#execute-run').addEventListener('click',handle(async () => { await action('execute'); notice('The original buyer is running. Continue its approval in the operator terminal.'); }));
$('#cancel-run').addEventListener('click',handle(async () => { await action('cancel',{executionId:currentRun.active.executionId}); notice('Cancellation requested for this execution. Waiting for the original buyer to finish cleanup.'); }));
$('#recover-run').addEventListener('click',handle(async () => { await action('recover'); notice('Retained original output inspected for recovery.'); }));
$('#unlock-run').addEventListener('click',handle(async () => { await action('unlock',{ownerPid:currentRun.state.executionLock.pid}); notice('The selected dead owner lease has been released.'); }));
$('#run-operations').addEventListener('click',handle(async event => {
  const button = event.target.closest('[data-only]'); if (button) await action('execute',{only:button.dataset.only});
  const preview = event.target.closest('[data-preview]');
  if (preview) {
    const id = currentRun.id, generation = navigation, operation = preview.dataset.preview;
    const result = await request(`/api/runs/${id}/resources/${operation}`);
    resourcePreviews.set(id + ':' + operation,result);
    previewToOpen.add(id + ':' + operation);
    if (generation === navigation && view === 'run' && currentRun?.id === id) renderRun();
  }
}));
await refreshState().catch(error => notice(error.message,true));
timer = setTimeout(poll,1500);
