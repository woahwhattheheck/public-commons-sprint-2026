// MIT. Operator interface over the original Safe selection, SF88 buyer and analysis workspace.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGES = new Set(['overview','sources','prepare','operations','compare','handover']);
const TOKEN_KEY = 'stellar-forge.safe-buyer.token:' + location.origin;
const POINTER_KEY = 'stellar-forge.safe-buyer.scope:' + location.origin;
const S = {
  scope: null, data: null, draft: null, operation: null, handover: null,
  review: null, reviewText: null, reviewBytes: null,
  links: new Map(), outputs: new Map(), busy: new Set(),
  generation: 0, viewEpoch: 0, operationEpoch: 0, handoverEpoch: 0, reviewEpoch: 0,
  refreshPromise: null, timer: null, online: false, token: '', filter: '',
  storageWarning: false, downloadControllers: new Set()
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty = value => JSON.stringify(value, null, 2);
const sameScope = (a,b) => a?.workspaceId === b?.workspaceId && a?.configurationSha256 === b?.configurationSha256;
const scopedKey = scope => 'stellar-forge.safe-buyer.draft:' + scope.workspaceId + ':' + scope.configurationSha256;
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
const printable = value => value === null || value === undefined ? '—' : typeof value === 'object' ? pretty(value) : String(value);
const count = value => Number(value || 0).toLocaleString('en-US');
function byteLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  return count(value) + ' bytes';
}
function timeLabel(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString().replace('T',' ').replace('.000Z',' UTC') : String(value);
}
function error(code) { const value = new Error(code); value.code = code; return value; }
function fail(code) { throw error(code); }
function notice(message, failed = false) {
  $('#notice-text').textContent = message;
  $('#notice').dataset.error = String(failed);
  $('#notice').hidden = !message;
}
function connection(text) { $('#connection-status').textContent = text; }
function storageRead(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function storageWrite(key,value) {
  try { sessionStorage.setItem(key,value); return true; }
  catch {
    S.storageWarning = true;
    $('#storage-status').textContent = 'This tab could not save its draft. Keep it open while completing the current operation.';
    return false;
  }
}
function storageRemove(key) { try { sessionStorage.removeItem(key); } catch {} }
function uid() { return crypto.randomUUID(); }
function newCapture() {
  return {captureId:uid(),networkId:'',blockNumber:'',transactionIndex:'',from:'',gas:'',value:'0',label:'',submitted:false};
}
function defaults() {
  return {
    page:'overview',selectionId:'',intentId:'',handoverId:'',review:null,pendingExecution:null,
    capture:newCapture(),receiveSelection:{directory:''},
    prepare:{selectionId:'',planFile:'',ticketFile:'',intentId:'safe-simulation-' + uid()},
    importPrepared:{directory:''},
    comparison:{beforeIntentId:'',afterIntentId:'',title:'',notes:''},
    receiveHandover:{directory:''}
  };
}
function restoreDraft(scope) {
  const base = defaults();
  try {
    const saved = JSON.parse(storageRead(scopedKey(scope)) || 'null');
    if (!saved || saved.schema !== 'stellar-forge.safe-buyer-browser.v1' || !sameScope(saved.scope,scope)) return base;
    const value = saved.draft;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    for (const name of ['selectionId','intentId','handoverId']) if (typeof value[name] === 'string') base[name] = value[name];
    if (PAGES.has(value.page)) base.page = value.page;
    for (const name of ['capture','receiveSelection','prepare','importPrepared','comparison','receiveHandover']) {
      if (!value[name] || typeof value[name] !== 'object' || Array.isArray(value[name])) continue;
      for (const key of Object.keys(base[name])) if (typeof value[name][key] === typeof base[name][key]) base[name][key] = value[name][key];
    }
    if (!UUID.test(base.capture.captureId)) base.capture = newCapture();
    if (value.review && typeof value.review.intentId === 'string' && HASH.test(value.review.reviewSha256))
      base.review = {intentId:value.review.intentId,reviewSha256:value.review.reviewSha256};
    if (value.pendingExecution && typeof value.pendingExecution.intentId === 'string' && HASH.test(value.pendingExecution.reviewSha256))
      base.pendingExecution = {intentId:value.pendingExecution.intentId,reviewSha256:value.pendingExecution.reviewSha256};
    return base;
  } catch { return base; }
}
function saveDraft() {
  if (!S.scope || !S.draft) return;
  storageWrite(scopedKey(S.scope),JSON.stringify({schema:'stellar-forge.safe-buyer-browser.v1',scope:S.scope,draft:S.draft}));
}
function bindScope(scope) {
  if (!scope || typeof scope.workspaceId !== 'string' || !UUID.test(scope.workspaceId) || !HASH.test(scope.configurationSha256))
    fail('SAFE_WORKSPACE_RESPONSE_INVALID');
  if (sameScope(S.scope,scope)) return;
  const old = S.scope;
  let prior = null;
  try { prior = JSON.parse(storageRead(POINTER_KEY) || 'null'); } catch {}
  if (old) storageRemove(scopedKey(old));
  if (prior && !sameScope(prior,scope) && typeof prior.workspaceId === 'string' && HASH.test(prior.configurationSha256 || ''))
    storageRemove(scopedKey(prior));
  S.scope = {...scope};
  S.generation++;
  S.viewEpoch++; S.operationEpoch++; S.handoverEpoch++; S.reviewEpoch++;
  S.operation = null; S.handover = null; S.review = null; S.reviewText = null; S.reviewBytes = null;
  S.links.clear(); S.outputs.clear(); S.busy.clear(); S.filter = '';
  for (const controller of S.downloadControllers) controller.abort();
  S.downloadControllers.clear();
  S.draft = restoreDraft(scope);
  storageWrite(POINTER_KEY,JSON.stringify(scope));
  if (old) notice('The workspace or its selected configuration changed. The current workspace is open with its own saved drafts.');
}
function readToken() {
  const previousToken = S.token;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('token')) {
    const value = fragment.get('token');
    history.replaceState(null,'',location.pathname + location.search);
    if (!HASH.test(value || '')) fail('SAFE_WORKSPACE_LAUNCH_TOKEN_INVALID');
    S.token = value; storageWrite(TOKEN_KEY,value);
  } else S.token = storageRead(TOKEN_KEY) || S.token || '';
  if (previousToken && previousToken !== S.token) {
    S.generation++; S.refreshPromise = null; S.busy.clear(); S.links.clear(); S.online = false;
    if (S.timer) clearTimeout(S.timer); S.timer = null;
  }
}
function headers(json = false) {
  if (!HASH.test(S.token)) fail('SAFE_AUTH_REQUIRED');
  return {'Authorization':'Bearer ' + S.token,...(json ? {'Content-Type':'application/json'} : {})};
}
async function api(path,{body,allowScope = false,signal} = {}) {
  const generation = S.generation;
  const requestScope = S.scope ? {...S.scope} : null;
  if (body !== undefined && !requestScope) fail('SAFE_WORKSPACE_NOT_OPEN');
  let response;
  try {
    response = await fetch(path,{method:body === undefined ? 'GET' : 'POST',credentials:'omit',cache:'no-store',
      headers:headers(body !== undefined),...(body === undefined ? {} : {body:JSON.stringify({...body,...requestScope})}),signal});
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    S.online = false; connection('Connection interrupted');
    fail('SAFE_CONNECTION_INTERRUPTED');
  }
  let payload;
  try { payload = await response.json(); } catch { fail('SAFE_WORKSPACE_RESPONSE_INVALID'); }
  if (generation !== S.generation) fail('SAFE_STALE_RESPONSE');
  if (!response.ok) {
    if (response.status === 401) { S.online = false; connection('Launch URL required'); }
    const code = typeof payload?.error === 'string' ? payload.error : 'SAFE_WORKSPACE_HTTP_' + response.status;
    const failure = error(code); failure.status = response.status; throw failure;
  }
  if (!payload || !own(payload,'value') || !payload.scope) fail('SAFE_WORKSPACE_RESPONSE_INVALID');
  if (allowScope) bindScope(payload.scope);
  else if (!sameScope(S.scope,payload.scope)) fail('SAFE_WORKSPACE_SCOPE_CHANGED');
  S.online = true; connection('Connected');
  return payload.value;
}
function explain(errorValue) {
  const code = errorValue?.code || errorValue?.message || 'SAFE_WORKSPACE_OPERATION_FAILED';
  const known = {
    SAFE_AUTH_REQUIRED:'Open the current launch URL printed by the workspace command to reconnect. The saved draft and original request identities remain in this tab.',
    SAFE_CONNECTION_INTERRUPTED:'The connection ended before the reply was received. Refresh the saved workspace or recover the selected original intent to read its actual state.',
    SAFE_WORKSPACE_SCOPE_CHANGED:'The selected workspace configuration changed. Refresh the workspace before continuing.',
    SAFE_WORKSPACE_CLOSING:'The workspace is draining its active operations. Reopen its current launch URL after the command restarts.',
    SAFE_CAPTURE_MODULE_REQUIRED:'This workspace needs its existing caller module to capture a transaction. Receive an original saved selection, or start the workspace with --capture-module.',
    OPERATOR_PROFILE_REQUIRED:'Select the existing operator profile when starting this workspace before purchasing the reviewed simulation.',
    ATTEMPT_ALREADY_RECORDED_USE_RECOVER:'The original buyer already recorded this purchase attempt. Recover that same intent to read its outcome.',
    INTENT_ALREADY_EXISTS_USE_RECOVER:'This intent is already retained. Open its original operation or recover it.',
    SAFE_COMPLETE_RESULT_REQUIRED:'The selected native intent has no complete result to open yet. Read or recover the original operation.',
    SAFE_OPERATION_ACTIVE:'The original operation is still active. Read its progress before taking another action.',
    SAFE_DOWNLOAD_HASH_MISMATCH:'The downloaded bytes did not match the selected retained file. Refresh and reopen that handover before downloading again.',
    SAFE_DOWNLOAD_LENGTH_MISMATCH:'The downloaded length did not match the selected retained file. Refresh and reopen that handover before downloading again.',
    SAFE_CAPTURE_INPUT_LOCKED:'This capture UUID is already bound to its submitted fields. Reopen that capture or choose New capture for another source.',
    SAFE_REVIEW_IDENTITY_MISMATCH:'The returned review does not match the selected original intent.',
    SAFE_ANALYSIS_URL_INVALID:'The analysis link did not identify a local workspace.',
    SAFE_UNSAFE_INTEGER:'Block, transaction index and gas must be whole numbers within the exact integer range.'
  };
  return (known[code] || code.replaceAll('_',' ')) + (known[code] ? ' [' + code + ']' : '');
}
function reportFailure(value) {
  if (value?.code === 'SAFE_STALE_RESPONSE' || value?.name === 'AbortError') return;
  notice(explain(value),true);
}
async function perform(key,fn) {
  if (S.busy.has(key)) return;
  const generation = S.generation;
  S.busy.add(key); syncBusy();
  try { return await fn(); }
  catch (value) { if (generation === S.generation) reportFailure(value); }
  finally { if (generation === S.generation) S.busy.delete(key); syncBusy(); schedulePoll(); }
}
function syncBusy() {
  for (const node of $$('[data-busy]')) {
    node.disabled = node.dataset.disabled === 'true' || S.busy.has(node.dataset.busy);
    node.setAttribute('aria-busy',String(S.busy.has(node.dataset.busy)));
  }
}
function button(action,label,{id='',sha='',page='',primary=false,disabled=false,busy=''} = {}) {
  return '<button type="button" data-action="' + esc(action) + '" data-id="' + esc(id) + '" data-sha="' + esc(sha) +
    '" data-page-target="' + esc(page) + '" data-busy="' + esc(busy) + '" data-disabled="' + disabled + '"' +
    (disabled || S.busy.has(busy) ? ' disabled' : '') + (primary ? ' class="primary"' : '') + '>' + esc(label) + '</button>';
}
function badge(value,strong = false) { return '<span class="badge' + (strong ? ' strong' : '') + '">' + esc(value ?? '—') + '</span>'; }
function pageHead(title,description,actions = '') {
  return '<header class="work-header"><div><p class="eyebrow">SAFE BUYER WORKSPACE</p><h1>' + esc(title) + '</h1><p>' + esc(description) +
    '</p></div>' + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</header>';
}
function panel(title,body,actions = '',className = '') {
  return '<section class="panel ' + esc(className) + '"><div class="panel-head"><h2>' + esc(title) + '</h2>' +
    (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>' + body + '</section>';
}
function context(items) {
  return '<dl class="context-grid">' + items.map(([label,value,wide]) => '<div class="context-item' + (wide ? ' wide' : '') +
    '"><dt>' + esc(label) + '</dt><dd><code>' + esc(printable(value)) + '</code></dd></div>').join('') + '</dl>';
}
function jsonDetail(title,value,text) {
  return '<details><summary>' + esc(title) + '</summary><pre>' + esc(text === undefined ? pretty(value) : text) + '</pre></details>';
}
function empty(message) { return '<div class="table-empty">' + esc(message) + '</div>'; }
function table(headings,rows) {
  return rows.length ? '<div class="table-wrap" tabindex="0" aria-label="Scrollable retained records"><table><thead><tr>' +
    headings.map(value => '<th scope="col">' + esc(value) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : empty('No retained records yet.');
}
function options(rows,selected,placeholder = 'Choose a retained item') {
  return '<option value="">' + esc(placeholder) + '</option>' + rows.map(row =>
    '<option value="' + esc(row.value) + '"' + (row.value === selected ? ' selected' : '') + '>' + esc(row.label) + '</option>').join('');
}
function field(group,name,label,{help='',required=false,type='text',max=4096,pattern='',placeholder='',full=false,mono=false,disabled=false,rows=4,select} = {}) {
  const value = S.draft[group]?.[name] ?? '',id = 'field-' + group + '-' + name;
  const attrs = ' id="' + id + '" name="' + esc(name) + '"' + (required ? ' required' : '') + (disabled ? ' disabled' : '') +
    (max ? ' maxlength="' + max + '"' : '') + (pattern ? ' pattern="' + esc(pattern) + '"' : '') +
    (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + (mono ? ' class="mono"' : '') +
    (help ? ' aria-describedby="' + id + '-help"' : '');
  let control;
  if (select) control = '<select' + attrs + '>' + options(select,value) + '</select>';
  else if (type === 'textarea') control = '<textarea' + attrs + ' rows="' + rows + '">' + esc(value) + '</textarea>';
  else control = '<input' + attrs + ' type="' + esc(type) + '" value="' + esc(value) + '"' +
    (type === 'text' && ['blockNumber','transactionIndex','gas','networkId','value'].includes(name) ? ' inputmode="numeric"' : '') + '>';
  return '<label class="field' + (full ? ' full' : '') + '" for="' + id + '">' + esc(label) + control +
    (help ? '<small id="' + id + '-help">' + esc(help) + '</small>' : '') + '</label>';
}
function form(name,body,label,{disabled=false,extra='',help=''} = {}) {
  return '<form data-form="' + esc(name) + '" data-draft="' + esc(name) + '"><div class="form-grid">' + body +
    '</div><div class="form-actions"><button type="submit" class="primary" data-busy="' + esc(name) + '" data-disabled="' + disabled + '"' +
    (disabled || S.busy.has(name) ? ' disabled' : '') + '>' + esc(label) + '</button>' + extra +
    (help ? '<span class="help">' + esc(help) + '</span>' : '') + '</div></form>';
}
function selectionRows() { return (S.data?.selections || []).filter(row => !row.error && row.id); }
function operationRows() { return S.data?.operations || []; }
function selectedSource() { return selectionRows().find(row => row.id === S.draft.selectionId) || null; }
function selectionName(row) { return row.label || row.safe?.address || row.id; }
function operationName(row) { return row.intentId + ' · ' + (row.state || row.error || 'Retained'); }
function selectedOperation() {
  return S.operation?.intentId === S.draft.intentId ? S.operation : operationRows().find(row => row.intentId === S.draft.intentId) || null;
}
function safeContext(selected) {
  if (!selected) return '';
  const sim = selected.simulation || {};
  return context([
    ['Safe address',selected.safe?.address],['Network',selected.safe?.networkId ?? sim.networkId ?? sim.network_id],
    ['Safe contract version',selected.safe?.contractVersion],['Safe nonce',selected.nonce],
    ['Safe transaction hash',selected.transactionHash,true],['Original selection',selected.id,true],
    ['Inner destination',selected.innerTransaction?.to],['Inner value (wei)',selected.innerTransaction?.value],
    ['Inner operation',selected.innerTransaction?.operation],['Encoded signature bytes',selected.encodedSignaturesBytes],
    ['Execution calldata bytes',selected.encodedExecutionBytes],['Request body SHA-256',selected.bodySha256],
    ['Retained source directory',selected.directory,true]
  ]) + jsonDetail('Exact outer simulation context',sim) + jsonDetail('Selected Safe transaction and origin',selected);
}
function analysisLink(value,label = 'Open full analysis') {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { fail('SAFE_ANALYSIS_URL_INVALID'); }
  if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
      url.username || url.password) fail('SAFE_ANALYSIS_URL_INVALID');
  return '<a class="button" href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
}
function matchingReview(operation) {
  return Boolean(operation && S.review && S.draft.review?.intentId === operation.intentId &&
    S.review.intentId === operation.intentId && S.review.selectionId === operation.safe?.id);
}

function overviewPage() {
  const data = S.data, cfg = data.configuration, active = data.active || [];
  const metrics = [
    ['Source selections',selectionRows().length,'Original Safe SDK captures'],
    ['Buyer intents',operationRows().length,'Retained native operations'],
    ['Recoverable results',operationRows().filter(row => row.resultRecoverable).length,'Original completed responses'],
    ['Handovers',(data.handovers || []).filter(row => row.state === 'SAVED').length,'Saved portable deliveries']
  ];
  const activeRows = active.map(row => '<tr><td><code>' + esc(row.id) + '</code></td><td>' + badge(row.action) +
    '</td><td>' + esc(row.abortRequested ? 'Abort requested; waiting for native cleanup' : 'Native operation active') + '</td><td>' +
    (operationRows().some(op => op.intentId === row.id) ? button('open-operation','Open operation',{id:row.id}) : '') + '</td></tr>');
  return pageHead('Workspace','Operate the selected Safe simulation from its original source through a retained customer result.',
    button('navigate','Receive a source',{page:'sources'}) + button('navigate','Open purchases',{page:'operations',primary:true})) +
    '<div class="metrics">' + metrics.map(([label,value,note]) => '<div class="metric"><span>' + esc(label) +
    '</span><strong>' + count(value) + '</strong><small>' + esc(note) + '</small></div>').join('') + '</div>' +
    panel('Current configuration',context([
      ['Workspace ID',data.workspace.id],['Workspace directory',data.workspace.directory],
      ['Original buyer runtime',cfg.runtimeDirectory],['Original buyer state',cfg.stateDirectory],
      ['Analysis workspace',cfg.analysisWorkspace],['Operator profile',cfg.operatorConfigured ? 'Configured' : 'Not selected'],
      ['Caller capture module',cfg.capture.configured ? cfg.capture.path : 'Not selected'],['Capture source SHA-256',cfg.capture.sha256],
      ['Configuration SHA-256',S.scope.configurationSha256,true]
    ]) + (!cfg.operatorConfigured ? '<p class="finding">Receive selections and prepare offline here. To purchase a simulation, start this workspace with the existing operator profile using <code>--operator-profile</code>.</p>' : '')) +
    (active.length ? panel('Active original operations',table(['Identity','Action','Progress','Open'],activeRows)) : '') +
    panel('Complete a simulation purchase','<div class="empty-steps"><div><strong>1. Select the original source</strong><p>Use the configured caller and actual outer transaction context, or receive a saved selection.</p>' +
      button('navigate','Source selections',{page:'sources'}) + '</div><div><strong>2. Prepare and review</strong><p>Bind the merchant plan and ticket to one intent, then read the original payment review before purchasing.</p>' +
      button('navigate','Prepare purchase',{page:'prepare'}) + '</div><div><strong>3. Receive the result</strong><p>Recover the same intent, examine its original analysis, and download the complete verified handover.</p>' +
      button('navigate','Handovers',{page:'handover'}) + '</div></div>');
}
function sourcesPage() {
  const draft = S.draft.capture, cfg = S.data.configuration;
  const known = (S.data.captures || []).find(row => row.captureId === draft.captureId);
  const locked = draft.submitted || Boolean(known);
  const selection = selectedSource();
  const rows = (S.data.selections || []).map(row => '<tr' + (row.id === S.draft.selectionId ? ' class="selected"' : '') + '><td><strong>' +
    esc(selectionName(row)) + '</strong><code>' + esc(row.id) + '</code>' + (row.error ? '<small>' + esc(row.error) + '</small>' : '') +
    '</td><td class="code-cell"><code>' + esc(row.safe?.address ?? '—') + '</code><small>Network ' + esc(row.safe?.networkId ?? '—') +
    ' · nonce ' + esc(row.nonce ?? '—') + '</small></td><td class="code-cell"><code>' + esc(row.transactionHash ?? '—') +
    '</code></td><td class="action-cell"><div class="actions">' + button('open-selection','Open',{id:row.id,disabled:Boolean(row.error)}) +
    button('prepare-selection','Prepare',{id:row.id,disabled:Boolean(row.error)}) + '</div></td></tr>');
  const captures = (S.data.captures || []).map(row => '<tr><td><code>' + esc(row.captureId) + '</code></td><td>' + badge(row.state || 'Retained') +
    (row.error ? '<small>' + esc(row.error) + '</small>' : '') + '</td><td><code>' + esc(row.selectionId ?? '—') + '</code></td><td>' +
    (row.selectionId ? button('open-selection','Open selection',{id:row.selectionId}) :
      row.captureId === draft.captureId ? button('reopen-capture','Reopen same capture',{disabled:!cfg.capture.configured,busy:'capture'}) : 'Original caller input retained') + '</td></tr>');
  return pageHead('Source selections','Keep the original Safe SDK transaction, signatures and outer simulation context together.') +
    '<div class="grid-two">' + panel('Capture the selected caller transaction',
      '<p class="help">The configured module supplies the selected Safe or Palmera transaction. Enter its exact outer context below.</p>' +
      (!cfg.capture.configured ? '<p class="finding">Select the existing caller module with <code>--capture-module</code> when starting this workspace. The saved-selection receiver is available here.</p>' : '') +
      context([['Capture UUID',draft.captureId,true],['Original capture state',known?.state ?? (draft.submitted ? 'Reply pending; reopen the same capture' : 'Ready for source context')]]) +
      (locked ? '<p class="help">This UUID retains the submitted context. Reopen it to finish receiving that source, or choose New capture to select another transaction.</p>' : '') +
      form('capture',
        field('capture','networkId','Network ID',{required:true,pattern:'[1-9][0-9]{0,19}',max:20,disabled:locked,help:'Exact decimal chain ID.'}) +
        field('capture','blockNumber','Block number',{required:true,pattern:'[0-9]+',max:16,disabled:locked}) +
        field('capture','transactionIndex','Transaction index',{required:true,pattern:'[0-9]+',max:16,disabled:locked}) +
        field('capture','gas','Outer gas limit',{required:true,pattern:'[0-9]+',max:16,disabled:locked,help:'Use the transaction gas limit.'}) +
        field('capture','from','Outer sender',{required:true,pattern:'0[xX][a-fA-F0-9]{40}',max:42,full:true,mono:true,disabled:locked}) +
        field('capture','value','Outer value (wei)',{required:true,pattern:'[0-9]+',max:78,mono:true,disabled:locked,help:'Retained as an exact decimal string.'}) +
        field('capture','label','Selection label',{max:160,disabled:locked}),
        locked ? 'Reopen same capture' : 'Capture selected transaction',
        {disabled:!cfg.capture.configured,extra:button('new-capture','New capture',{busy:'capture'}),help:'The capture action reads the configured original caller.'})) +
      panel('Receive an original saved selection',
        '<p class="help">Use the directory produced by the original Safe capture or receiving command.</p>' +
        form('receiveSelection',field('receiveSelection','directory','Selection directory',{required:true,full:true,mono:true,placeholder:'/absolute/path/to/selection'}),
          'Receive selection')) + '</div>' +
    panel('Retained selections',table(['Selection','Safe','Transaction hash','Actions'],rows)) +
    (selection ? panel('Selected transaction',safeContext(selection),button('prepare-selection','Prepare this selection',{id:selection.id,primary:true})) : '') +
    ((S.data.captures || []).length ? panel('Original capture requests',table(['Capture UUID','State','Selection','Action'],captures)) : '');
}
function preparePage() {
  const choices = selectionRows().map(row => ({value:row.id,label:selectionName(row) + ' · ' + row.id.slice(0,12)}));
  const selected = selectionRows().find(row => row.id === S.draft.prepare.selectionId);
  return pageHead('Prepare purchase','Bind one saved Safe selection to the merchant plan, operation ticket and original buyer intent.') +
    '<div class="grid-two">' +
    panel('Prepare from a saved selection',
      form('prepare',
        field('prepare','selectionId','Original selection',{select:choices,required:true,full:true}) +
        field('prepare','planFile','Merchant plan file',{required:true,full:true,mono:true,placeholder:'/absolute/path/to/plan.json'}) +
        field('prepare','ticketFile','Original operation ticket',{required:true,full:true,mono:true,placeholder:'/absolute/path/to/ticket.json'}) +
        field('prepare','intentId','Buyer intent ID',{required:true,max:160,full:true,mono:true,help:'Keep this identity when reopening this preparation.'}),
        'Prepare and import',
        {disabled:!choices.length,help:'Preparation imports the original buyer configuration offline.'})) +
    panel('Import an original prepared purchase',
      '<p class="help">Open the complete directory produced by the original Safe purchase preparation command. Its plan, selection and ticket bindings are verified on import.</p>' +
      form('importPrepared',field('importPrepared','directory','Prepared purchase directory',{required:true,full:true,mono:true}),
        'Import prepared purchase')) + '</div>' +
    (selected ? panel('Selected source context',safeContext(selected)) : panel('Choose a retained source','<p class="help">Receive or capture an original Safe selection before preparing its simulation purchase.</p>',
      button('navigate','Open source selections',{page:'sources'}))) +
    (!S.data.configuration.operatorConfigured ? panel('Operator profile','<p>The current workspace can prepare and review original inputs. Select the existing buyer operator profile with <code>--operator-profile</code> for execution.</p>') : '');
}
function operationLive(operation) {
  if (!operation) return '<p class="help">Select a retained buyer intent to read its native state.</p>';
  const active = operation.active, pending = S.draft.pendingExecution?.intentId === operation.intentId;
  let body = '<div class="status-line"><h2>Original native operation</h2>' + badge(operation.state || 'Retained',Boolean(operation.resultRecoverable)) +
    (active ? badge(active.action) : '') + '</div>' +
    context([
      ['Intent',operation.intentId,true],['Native result',operation.nativeStatus],['Delivery',operation.deliveryStatus],
      ['Recoverable result',operation.resultRecoverable ? 'Available' : 'Not available'],
      ['Active action',active ? active.action + (active.abortRequested ? ' · abort requested; awaiting cleanup' : '') : 'No active action in this host'],
      ['Native state directory',operation.directory,true]
    ]);
  if (operation.error) body += '<p class="finding">' + esc(operation.error) + '</p>';
  if (active) body += '<p class="help">Progress comes from the original buyer. An abort request remains active until its native operation finishes cleanup.</p>';
  else if (pending) body += '<p class="finding">This tab retained the dispatched intent and review. Recover this same intent to read the completed result or its original attempt state.</p>';
  body += '<div class="actions secondary">' +
    button('read-operation','Read native state',{id:operation.intentId,busy:'read:' + operation.intentId}) +
    button('recover','Recover same intent',{id:operation.intentId,disabled:Boolean(active),busy:'recover:' + operation.intentId}) +
    (active?.action === 'EXECUTE' ? button('abort',active.abortRequested ? 'Abort requested' : 'Request abort',
      {id:operation.intentId,disabled:active.abortRequested,busy:'abort:' + operation.intentId}) : '') + '</div>' +
    jsonDetail('Original transport and recovery detail',operation);
  return body;
}
function paymentReview(operation) {
  const reviews = operation.reviews || [];
  const selected = S.draft.review?.intentId === operation.intentId ? S.draft.review.reviewSha256 : '';
  let body = '<p class="help">Read the original review for this exact Safe selection and merchant. Reopen a retained review after a lost reply.</p>' +
    '<div class="review-selection"><label class="field" for="review-picker">Saved review<select id="review-picker">' +
    options(reviews.map(row => ({value:row.reviewSha256,label:timeLabel(row.reviewedAt) + ' · ' + row.reviewSha256.slice(0,18)})),selected,'Choose a saved review') +
    '</select></label>' + button('review','Create original purchase review',{id:operation.intentId,disabled:Boolean(operation.active),busy:'review:' + operation.intentId}) + '</div>';
  if (matchingReview(operation)) {
    const review = S.review;
    body += '<p class="review-sha">Saved review SHA-256: ' + esc(S.draft.review.reviewSha256) + '</p>' +
      context([
        ['Safe address',review.safe?.safe?.address],['Network',review.safe?.safe?.networkId],
        ['Safe nonce',review.safe?.nonce],['Transaction hash',review.safe?.transactionHash],
        ['Merchant resource',review.merchant?.resource,true],['HTTP method',review.merchant?.method],
        ['Simulation type',review.merchant?.simulationType],['Merchant plan SHA-256',review.merchant?.planSha256,true],
        ['Original configuration SHA-256',review.configSha256],['Original request body SHA-256',review.bodySha256]
      ]) +
      '<h3>Original payment review</h3><p class="help">The native buyer supplies the payment terms and its execution policy below.</p><pre class="compact">' +
      esc(pretty(review.original?.native ?? review.original)) + '</pre>' +
      jsonDetail('Complete original Safe purchase review',null,S.reviewText) +
      '<div class="purchase-footer"><p>Purchase this reviewed simulation using the configured original buyer profile. The same intent owns execution and recovery.</p><div class="actions">' +
      button('execute','Purchase reviewed simulation',{id:operation.intentId,sha:S.draft.review.reviewSha256,primary:true,
        disabled:Boolean(operation.active) || Boolean(operation.resultRecoverable) ||
          Boolean(S.draft.pendingExecution?.intentId === operation.intentId),busy:'execute:' + operation.intentId}) +
      button('download-review','Download saved review',{id:operation.intentId,sha:S.draft.review.reviewSha256,busy:'download-review'}) +
      '</div></div>';
  } else body += '<p class="help">Choose or create the original review to inspect the exact purchase terms.</p>';
  return body;
}
function resultActions(operation) {
  const summary = S.outputs.get('result:' + operation.intentId);
  const link = S.links.get('intent:' + operation.intentId);
  return '<p class="help">The complete original response is recoverable. Open its maintained analysis or retain a portable handover.</p>' +
    '<div class="actions">' +
    button('analyze','Open result analysis',{id:operation.intentId,primary:true,disabled:Boolean(operation.active),busy:'analyze:' + operation.intentId}) +
    button('handover','Prepare portable handover',{id:operation.intentId,disabled:Boolean(operation.active),busy:'handover:' + operation.intentId}) +
    button('compare-with','Compare this result',{id:operation.intentId}) + '</div>' +
    (link ? '<div class="inline-result">' + analysisLink(link,'Open calls, state, assets and logs') + '</div>' : '') +
    (summary ? context([['Native status',summary.nativeStatus],['Original response size',byteLabel(summary.delivery?.bytes)],
      ['Original response SHA-256',summary.delivery?.sha256,true]]) + jsonDetail('Recovered simulation summary',summary.simulation) : '');
}
function operationsPage() {
  const operations = operationRows(),operation = selectedOperation();
  const filtered = S.filter ? operations.filter(row => pretty(row).toLowerCase().includes(S.filter.toLowerCase())) : operations;
  const rows = filtered.map(row => '<tr' + (row.intentId === S.draft.intentId ? ' class="selected"' : '') + '><td><strong><code>' +
    esc(row.intentId) + '</code></strong><small>' + esc(row.safe?.label || row.safe?.safe?.address || '') + '</small></td><td>' +
    badge(row.state || 'Retained',Boolean(row.resultRecoverable)) + (row.error ? '<small>' + esc(row.error) + '</small>' : '') +
    '</td><td>' + esc(row.active?.action || (row.resultRecoverable ? 'Original result available' : 'No host action')) +
    (row.active?.abortRequested ? '<small>Abort requested; awaiting cleanup</small>' : '') + '</td><td>' +
    esc(row.nativeStatus ?? '—') + '</td><td>' + button('open-operation','Open intent',{id:row.intentId}) + '</td></tr>');
  return pageHead('Purchases and results','Review, execute and recover the same original buyer intent.',
      button('navigate','Prepare a purchase',{page:'prepare'})) +
    panel('Retained buyer intents','<div class="table-controls"><label for="operation-filter">Find an intent<input id="operation-filter" type="search" value="' + esc(S.filter) +
      '" placeholder="Intent, Safe, native state"></label><span class="help">' + count(filtered.length) + ' of ' + count(operations.length) + '</span></div>' +
      table(['Intent','Native state','Current action','Result','Open'],rows)) +
    (operation ? '<section class="panel status-panel" id="operation-live">' + operationLive(operation) + '</section>' +
      (operation.safe ? panel('Safe and merchant binding',safeContext(operation.safe) + jsonDetail('Selected merchant',operation.merchant)) : '') +
      '<section class="panel" id="payment-review"><div class="panel-head"><h2>Saved purchase review</h2></div>' + paymentReview(operation) + '</section>' +
      (operation.resultRecoverable ? '<section class="panel" id="result-actions"><div class="panel-head"><h2>Original completed result</h2></div>' +
        resultActions(operation) + '</section>' : '') :
      panel('Open an original intent','<p class="help">Choose a retained buyer above, or prepare and import one from an original Safe selection.</p>'));
}
function comparePage() {
  const completed = operationRows().filter(row => row.resultRecoverable && !row.error);
  const choices = completed.map(row => ({value:row.intentId,label:operationName(row)}));
  const draft = S.draft.comparison;
  const left = completed.find(row => row.intentId === draft.beforeIntentId);
  const right = completed.find(row => row.intentId === draft.afterIntentId);
  const previous = S.outputs.get('comparison'),link = S.links.get('comparison');
  return pageHead('Compare results','Use the original analysis engine to compare two retained simulation outcomes.') +
    panel('Choose before and after',form('comparison',
      field('comparison','beforeIntentId','Before result',{select:choices,required:true}) +
      field('comparison','afterIntentId','After result',{select:choices,required:true}) +
      field('comparison','title','Comparison title',{max:300,full:true}) +
      field('comparison','notes','Analyst notes',{type:'textarea',max:80000,full:true,rows:6}),
      'Compare original results',{disabled:completed.length < 2,help:'The original comparator validates the selected Safe, network and result bindings.'})) +
    (left || right ? '<div class="grid-two">' +
      panel('Before',left ? context([['Intent',left.intentId,true],['Safe',left.safe?.safe?.address],['Network',left.safe?.safe?.networkId],
        ['Native result',left.nativeStatus],['Delivery',left.deliveryStatus]]) : '<p class="help">Select the before result.</p>') +
      panel('After',right ? context([['Intent',right.intentId,true],['Safe',right.safe?.safe?.address],['Network',right.safe?.safe?.networkId],
        ['Native result',right.nativeStatus],['Delivery',right.deliveryStatus]]) : '<p class="help">Select the after result.</p>') + '</div>' : '') +
    (previous ? panel('Retained comparison',(link ? '<div class="actions">' + analysisLink(link,'Open complete comparison and analysis') + '</div>' : '') +
      '<p class="help">Open the original analysis workspace to inspect the compared calls, state, assets, logs and retained report.</p>' +
      jsonDetail('Original comparison result',previous)) : '') +
    (!completed.length ? panel('Receive completed results','<p class="help">Recover the original buyer results before comparing their execution.</p>',
      button('navigate','Open purchases',{page:'operations'})) : '');
}
function handoverDetail(value) {
  const row = value.handover;
  const files = Object.entries(value.files || {}).sort(([a],[b]) => a.localeCompare(b));
  return context([
    ['Handover identity',row.id,true],['Intent',row.intentId,true],
    ['Safe',row.selection?.safe?.address],['Network',row.selection?.safe?.networkId],
    ['Native result',row.nativeStatus],['Original response size',byteLabel(row.response?.bytes)],
    ['Original response SHA-256',row.response?.sha256,true],['Original analysis capture',row.captureId,true],
    ['Retained handover directory',row.directory,true],['Manifest members',files.length]
  ]) + '<div class="download-list">' + files.map(([name,descriptor]) =>
    '<div class="download-item"><div><code>' + esc(name) + '</code><p>' + byteLabel(descriptor.bytes) +
    '</p><p>SHA-256 ' + esc(descriptor.sha256) + '</p></div>' +
    '<button type="button" data-action="download" data-id="' + esc(row.id) + '" data-file="' + esc(name) +
    '" data-busy="' + esc('download:' + name) + '" data-disabled="false">Verify and download</button></div>').join('') +
    '</div><p class="help">Each download is checked against its exact retained length and SHA-256 before saving.</p>' +
    jsonDetail('Original handover and member descriptors',value);
}
function handoverPage() {
  const rows = (S.data.handovers || []).map(row => '<tr' + (row.id === S.draft.handoverId ? ' class="selected"' : '') + '><td><strong><code>' +
    esc(row.intentId || row.id) + '</code></strong><small>' + esc(row.id) + '</small></td><td>' + badge(row.state || 'Retained') +
    (row.error ? '<small>' + esc(row.error) + '</small>' : '') + '</td><td>' + byteLabel(row.response?.bytes) +
    '</td><td>' + esc(row.files ?? '—') + '</td><td>' +
    button('open-handover','Open handover',{id:row.id,disabled:row.state !== 'SAVED' || Boolean(row.error),busy:'open-handover:' + row.id}) +
    '</td></tr>');
  const value = S.handover?.handover?.id === S.draft.handoverId ? S.handover : null;
  const link = value ? S.links.get('handover:' + value.handover.id) : null;
  return pageHead('Handover and receive','Retain the original selected transaction, buyer response and complete analysis together.') +
    panel('Receive an original portable handover',
      '<p class="help">Select the existing handover directory. The original receiver verifies its manifests and source bindings, then opens its retained analysis.</p>' +
      form('receiveHandover',field('receiveHandover','directory','Original handover directory',{required:true,full:true,mono:true}),
        'Receive and reopen')) +
    panel('Retained handovers',table(['Intent and handover','State','Response','Members','Open'],rows),
      button('navigate','Prepare from a result',{page:'operations'})) +
    (value ? panel('Selected verified handover',(link ? '<div class="actions">' + analysisLink(link,'Open received analysis') + '</div>' : '') +
      handoverDetail(value)) : S.draft.handoverId ? panel('Open selected handover','<p class="help">Open the retained item to validate all original members and read its available downloads.</p>',
        button('open-handover','Open saved handover',{id:S.draft.handoverId,busy:'open-handover:' + S.draft.handoverId})) : '');
}
const views = {overview:overviewPage,sources:sourcesPage,prepare:preparePage,operations:operationsPage,compare:comparePage,handover:handoverPage};
function render() {
  if (!S.data || !S.draft) return;
  const page = PAGES.has(S.draft.page) ? S.draft.page : 'overview';
  for (const node of $$('#navigation [data-page]')) {
    if (node.dataset.page === page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
  }
  $('#workspace-id').textContent = S.data.workspace.id;
  $('#workspace-location').textContent = S.data.workspace.directory;
  if (!S.storageWarning) $('#storage-status').textContent = 'Drafts and selected review identities are retained in this tab.';
  $('#main').innerHTML = views[page]();
  $('#main').setAttribute('aria-busy','false');
  syncBusy();
}

function reconcileData(value) {
  if (!value?.workspace || value.workspace.id !== S.scope.workspaceId || !value.configuration ||
      !Array.isArray(value.selections) || !Array.isArray(value.operations) || !Array.isArray(value.handovers))
    fail('SAFE_WORKSPACE_RESPONSE_INVALID');
  S.data = value;
  if (S.draft.selectionId && !value.selections.some(row => row.id === S.draft.selectionId)) S.draft.selectionId = '';
  if (S.draft.intentId && !value.operations.some(row => row.intentId === S.draft.intentId)) {
    S.draft.intentId = ''; S.operation = null; S.review = null; S.reviewText = null; S.reviewBytes = null;
  }
  if (S.draft.handoverId && !value.handovers.some(row => row.id === S.draft.handoverId)) {
    S.draft.handoverId = ''; S.handover = null;
  }
  const captured = (value.captures || []).find(row => row.captureId === S.draft.capture.captureId);
  if (captured) S.draft.capture.submitted = true;
  const operation = value.operations.find(row => row.intentId === S.draft.intentId);
  if (operation) S.operation = operation;
  saveDraft();
}
async function refresh({quiet = false} = {}) {
  if (S.refreshPromise) return S.refreshPromise;
  const pending = (async () => {
    const value = await api('/api/state',{allowScope:true});
    reconcileData(value);
    if (!quiet) render();
    else updateLive();
    schedulePoll();
    return value;
  })();
  S.refreshPromise = pending;
  try { return await pending; }
  finally { if (S.refreshPromise === pending) S.refreshPromise = null; }
}
function updateOperation(value) {
  if (!value || typeof value.intentId !== 'string') fail('SAFE_WORKSPACE_RESPONSE_INVALID');
  if (S.data) {
    const index = S.data.operations.findIndex(row => row.intentId === value.intentId);
    if (index >= 0) S.data.operations[index] = value; else S.data.operations.push(value);
  }
  if (S.draft.intentId === value.intentId) S.operation = value;
  if (S.draft.pendingExecution?.intentId === value.intentId && !value.active && (value.resultRecoverable || value.state === 'PREPARED')) {
    S.draft.pendingExecution = null; saveDraft();
  }
}
function updateLive() {
  if (!S.draft || S.draft.page !== 'operations') return;
  const operation = selectedOperation();
  const host = $('#operation-live');
  if (host) host.innerHTML = operationLive(operation);
  const reviewHost = $('#payment-review');
  if (reviewHost && operation && !reviewHost.contains(document.activeElement)) {
    reviewHost.innerHTML = '<div class="panel-head"><h2>Saved purchase review</h2></div>' + paymentReview(operation);
  }
  const resultHost = $('#result-actions');
  if (resultHost && operation?.resultRecoverable) resultHost.innerHTML =
    '<div class="panel-head"><h2>Original completed result</h2></div>' + resultActions(operation);
  syncBusy();
}
async function loadOperation(id,{paint = true,restore = false} = {}) {
  const epoch = ++S.operationEpoch, view = S.viewEpoch;
  const value = await api('/api/operation?intentId=' + encodeURIComponent(id));
  if (epoch !== S.operationEpoch) return value;
  updateOperation(value);
  if (S.draft.intentId === id && paint && view === S.viewEpoch && S.draft.page === 'operations') render();
  if (restore && S.draft.review?.intentId === id &&
      !matchingReview(value)) await loadReview(id,S.draft.review.reviewSha256,{paint});
  return value;
}
async function loadHandover(id) {
  const epoch = ++S.handoverEpoch, view = S.viewEpoch;
  const value = await api('/api/handover?id=' + encodeURIComponent(id));
  if (epoch !== S.handoverEpoch || S.draft.handoverId !== id) return value;
  if (value?.handover?.id !== id || !value.files || typeof value.files !== 'object') fail('SAFE_WORKSPACE_RESPONSE_INVALID');
  S.handover = value;
  if (view === S.viewEpoch && S.draft.page === 'handover') render();
  return value;
}
async function verifiedFile(path,expected,{limit} = {}) {
  if (!expected || !HASH.test(expected.sha256) ||
      (expected.bytes !== undefined && (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0)))
    fail('SAFE_DOWNLOAD_DESCRIPTOR_INVALID');
  const generation = S.generation, controller = new AbortController();
  S.downloadControllers.add(controller);
  try {
    const response = await fetch(path,{credentials:'omit',cache:'no-store',headers:headers(),signal:controller.signal});
    if (!response.ok) {
      let payload; try { payload = await response.json(); } catch {}
      if (response.status === 401) { S.online = false; connection('Launch URL required'); }
      fail(payload?.error || 'SAFE_DOWNLOAD_HTTP_' + response.status);
    }
    const announcedHash = response.headers.get('X-Content-SHA256');
    if (announcedHash !== expected.sha256) fail('SAFE_DOWNLOAD_HASH_MISMATCH');
    const lengthHeader = response.headers.get('Content-Length');
    const declared = lengthHeader === null ? null : Number(lengthHeader);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) fail('SAFE_DOWNLOAD_LENGTH_MISMATCH');
    if (expected.bytes !== undefined && declared !== null && expected.bytes !== declared) fail('SAFE_DOWNLOAD_LENGTH_MISMATCH');
    const maximum = expected.bytes ?? limit;
    if (!Number.isSafeInteger(maximum) || maximum < 0 || (declared !== null && declared > maximum)) fail('SAFE_DOWNLOAD_LENGTH_MISMATCH');
    let bytes;
    if (response.body) {
      const reader = response.body.getReader(),chunks = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > maximum) { await reader.cancel(); fail('SAFE_DOWNLOAD_LENGTH_MISMATCH'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maximum || (expected.bytes !== undefined && bytes.length !== expected.bytes) ||
        (declared !== null && bytes.length !== declared)) fail('SAFE_DOWNLOAD_LENGTH_MISMATCH');
    const actualHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
    if (actualHash !== expected.sha256) fail('SAFE_DOWNLOAD_HASH_MISMATCH');
    if (generation !== S.generation) fail('SAFE_STALE_RESPONSE');
    return {bytes,type:response.headers.get('Content-Type') || 'application/octet-stream'};
  } finally { S.downloadControllers.delete(controller); }
}
async function loadReview(intentId,sha256,{paint = true} = {}) {
  if (!HASH.test(sha256)) fail('SAFE_REVIEW_IDENTITY_MISMATCH');
  const epoch = ++S.reviewEpoch,view = S.viewEpoch;
  const selected = {intentId,reviewSha256:sha256};
  S.draft.review = selected; saveDraft();
  S.review = null; S.reviewText = null; S.reviewBytes = null;
  const saved = await verifiedFile('/api/review-file?intentId=' + encodeURIComponent(intentId) + '&sha256=' + sha256,
    {sha256},{limit:4*1024*1024});
  let text,review;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(saved.bytes); review = JSON.parse(text); }
  catch { fail('SAFE_REVIEW_IDENTITY_MISMATCH'); }
  if (review.schema !== 'stellar-forge.safe-simulation-purchase-review.v1' || review.intentId !== intentId ||
      !HASH.test(review.selectionId || '') || !HASH.test(review.configSha256 || '') || !HASH.test(review.bodySha256 || ''))
    fail('SAFE_REVIEW_IDENTITY_MISMATCH');
  if (epoch !== S.reviewEpoch || S.draft.intentId !== intentId ||
      S.draft.review?.reviewSha256 !== sha256) return;
  S.review = review; S.reviewText = text; S.reviewBytes = saved.bytes;
  if (paint && view === S.viewEpoch && S.draft.page === 'operations') render();
}
function saveFile(bytes,type,name) {
  const filename = name.split('/').at(-1).replace(/[\u0000-\u001f\u007f]/g,'_') || 'retained-file';
  const url = URL.createObjectURL(new Blob([bytes],{type}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
function schedulePoll() {
  if (S.timer) clearTimeout(S.timer);
  S.timer = null;
  if (!S.online || !S.data) return;
  const selected = selectedOperation();
  const active = selected?.active || (S.data.active || []).length || S.draft.pendingExecution;
  if (!active) return;
  S.timer = setTimeout(poll,document.hidden ? 7000 : 2200);
}
async function poll() {
  S.timer = null;
  if (!S.online || !S.data) return;
  const selected = selectedOperation(),wasActive = Boolean(selected?.active);
  try {
    if (selected && (wasActive || S.draft.pendingExecution?.intentId === selected.intentId)) {
      const value = await loadOperation(selected.intentId,{paint:false});
      updateLive();
      if (!value.active) {
        await refresh({quiet:true});
        if (S.draft.page === 'operations' && S.draft.intentId === value.intentId) render();
      }
    } else {
      await refresh({quiet:true});
      const hasFocusedInput = $('#main').contains(document.activeElement) &&
        ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
      if (!hasFocusedInput) render();
    }
  } catch (value) { reportFailure(value); }
  finally { schedulePoll(); }
}
async function navigate(page,{focus = true} = {}) {
  if (!PAGES.has(page) || !S.draft) return;
  S.viewEpoch++; S.draft.page = page; S.filter = ''; saveDraft(); render();
  if (focus) $('#main').focus({preventScroll:true});
  if (page === 'operations' && S.draft.intentId)
    await perform('read:' + S.draft.intentId,() => loadOperation(S.draft.intentId,{restore:true}));
  if (page === 'handover' && S.draft.handoverId)
    await perform('open-handover:' + S.draft.handoverId,() => loadHandover(S.draft.handoverId));
}
async function chooseOperation(id) {
  if (!operationRows().some(row => row.intentId === id)) await refresh({quiet:true});
  S.operationEpoch++; S.reviewEpoch++; S.operation = null;
  S.review = null; S.reviewText = null; S.reviewBytes = null;
  S.draft.intentId = id;
  if (S.draft.review?.intentId !== id) S.draft.review = null;
  saveDraft(); await navigate('operations');
}
function integer(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) fail('SAFE_UNSAFE_INTEGER');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail('SAFE_UNSAFE_INTEGER');
  return number;
}
function captureInput() {
  const value = S.draft.capture;
  if (!/^[1-9][0-9]{0,19}$/.test(value.networkId) || !/^0x[a-fA-F0-9]{40}$/.test(value.from) ||
      !/^(0|[1-9][0-9]*)$/.test(value.value)) fail('SAFE_CAPTURE_INPUT_INVALID');
  return {captureId:value.captureId,label:value.label,context:{
    networkId:value.networkId,blockNumber:integer(value.blockNumber),transactionIndex:integer(value.transactionIndex),
    from:value.from,gas:integer(value.gas),value:value.value
  }};
}
async function submitCapture() {
  const payload = captureInput(),view = S.viewEpoch;
  S.draft.capture.submitted = true; saveDraft(); render();
  const value = await api('/api/capture',{body:payload});
  await refresh({quiet:true});
  if (S.draft.capture.captureId === payload.captureId && view === S.viewEpoch) {
    S.draft.selectionId = value.selection.id; saveDraft(); render();
  }
  notice('Original capture retained as selection ' + value.selection.id + '.');
}
async function submitForm(name) {
  const view = S.viewEpoch;
  if (name === 'capture') return submitCapture();
  if (name === 'receiveSelection') {
    const value = await api('/api/selections/receive',{body:{directory:S.draft.receiveSelection.directory.trim()}});
    await refresh({quiet:true});
    if (view === S.viewEpoch) { S.draft.selectionId = value.id; saveDraft(); render(); }
    notice('Original selection received: ' + value.id + '.');
  } else if (name === 'prepare' || name === 'importPrepared') {
    let value;
    if (name === 'prepare') {
      const draft = S.draft.prepare;
      value = await api('/api/prepare',{body:{selectionId:draft.selectionId,planFile:draft.planFile.trim(),
        ticketFile:draft.ticketFile.trim(),intentId:draft.intentId.trim()}});
    } else value = await api('/api/import',{body:{directory:S.draft.importPrepared.directory.trim()}});
    await refresh({quiet:true}); updateOperation(value.operation);
    notice('Original buyer intent prepared and imported: ' + value.operation.intentId + '.');
    if (view === S.viewEpoch) await chooseOperation(value.operation.intentId);
  } else if (name === 'comparison') {
    const value = {...S.draft.comparison};
    if (value.beforeIntentId === value.afterIntentId) fail('SAFE_DISTINCT_COMPARISON_RESULTS_REQUIRED');
    const result = await api('/api/compare',{body:value});
    S.outputs.set('comparison',result.comparison); S.links.set('comparison',result.analysisUrl);
    if (view === S.viewEpoch) render();
    notice('The original comparison is ready in the analysis workspace.');
  } else if (name === 'receiveHandover') {
    const value = await api('/api/receive',{body:{directory:S.draft.receiveHandover.directory.trim()}});
    await refresh({quiet:true});
    S.links.set('handover:' + value.handover.id,value.analysisUrl);
    if (view === S.viewEpoch) {
      S.draft.handoverId = value.handover.id; S.handover = value; saveDraft(); render();
    }
    notice('Original handover received and reopened: ' + value.handover.id + '.');
  }
}
async function action(name,node) {
  const id = node.dataset.id || '';
  if (name === 'navigate') return navigate(node.dataset.pageTarget);
  if (name === 'new-capture') {
    if (S.busy.has('capture')) return;
    S.draft.capture = newCapture(); saveDraft(); render(); $('#field-capture-networkId')?.focus(); return;
  }
  if (name === 'reopen-capture') return perform('capture',submitCapture);
  if (name === 'open-selection') {
    S.draft.selectionId = id; saveDraft(); await navigate('sources'); return;
  }
  if (name === 'prepare-selection') {
    S.draft.selectionId = id; S.draft.prepare.selectionId = id; saveDraft(); await navigate('prepare'); return;
  }
  if (name === 'open-operation') return chooseOperation(id);
  if (name === 'read-operation') return perform('read:' + id,() => loadOperation(id,{restore:true}));
  if (name === 'review') return perform('review:' + id,async () => {
    const view = S.viewEpoch;
    const value = await api('/api/review',{body:{intentId:id}});
    await loadOperation(id,{paint:false});
    if (S.draft.intentId === id && view === S.viewEpoch) {
      await loadReview(id,value.reviewSha256); notice('The exact original purchase review is saved.');
    }
  });
  if (name === 'execute') return perform('execute:' + id,async () => {
    const operation = selectedOperation(),sha256 = node.dataset.sha;
    if (S.draft.intentId !== id || !matchingReview(operation) || S.draft.review.reviewSha256 !== sha256)
      fail('SAFE_REVIEW_IDENTITY_MISMATCH');
    S.draft.pendingExecution = {intentId:id,reviewSha256:sha256}; saveDraft(); updateLive();
    const value = await api('/api/execute',{body:{intentId:id,reviewSha256:sha256}});
    if (value.result) S.outputs.set('result:' + id,value.result);
    await loadOperation(id);
    notice(value.state === 'RETAINED' ? 'The same original intent already has a retained result.' :
      'The original buyer is executing this reviewed simulation purchase.');
  });
  if (name === 'recover') return perform('recover:' + id,async () => {
    const value = await api('/api/recover',{body:{intentId:id}});
    updateOperation(value.operation);
    if (value.result) S.outputs.set('result:' + id,value.result);
    if (S.draft.intentId === id) render();
    notice(value.result ? 'The original completed result has been recovered.' :
      'The original intent is open. Its native state is ' + value.operation.state + '.');
    await refresh({quiet:true});
  });
  if (name === 'abort') return perform('abort:' + id,async () => {
    const value = await api('/api/abort',{body:{intentId:id}});
    await loadOperation(id);
    notice(value.abortRequested ? 'Abort requested for the original execution. Its actual cleanup state remains visible.' :
      'The original host has no active execution to abort for this intent.');
  });
  if (name === 'analyze') return perform('analyze:' + id,async () => {
    const value = await api('/api/analyze',{body:{intentId:id}});
    S.links.set('intent:' + id,value.analysisUrl);
    S.outputs.set('analysis:' + id,value);
    if (S.draft.intentId === id && S.draft.page === 'operations') render();
    notice('The original analysis is ready. Open the retained calls, state, assets and logs.');
  });
  if (name === 'compare-with') {
    S.draft.comparison.beforeIntentId = id;
    if (S.draft.comparison.afterIntentId === id) S.draft.comparison.afterIntentId = '';
    saveDraft(); return navigate('compare');
  }
  if (name === 'handover') return perform('handover:' + id,async () => {
    const view = S.viewEpoch,value = await api('/api/handover',{body:{intentId:id}});
    await refresh({quiet:true});
    if (view === S.viewEpoch) {
      S.draft.handoverId = value.handover.id; S.handover = value; saveDraft();
      S.viewEpoch++; S.draft.page = 'handover'; saveDraft(); render(); $('#main').focus({preventScroll:true});
    }
    notice('The original result and analysis are retained in handover ' + value.handover.id + '.');
  });
  if (name === 'open-handover') {
    S.draft.handoverId = id; S.handover = null; saveDraft();
    if (S.draft.page !== 'handover') return navigate('handover');
    return perform('open-handover:' + id,() => loadHandover(id));
  }
  if (name === 'download') {
    const file = node.dataset.file,value = S.handover;
    if (value?.handover?.id !== id || !own(value.files || {},file)) fail('SAFE_HANDOVER_MEMBER_INVALID');
    return perform('download:' + file,async () => {
      const descriptor = {...value.files[file]};
      const saved = await verifiedFile('/api/download?handover=' + id + '&file=' + encodeURIComponent(file),descriptor);
      saveFile(saved.bytes,saved.type,file);
      notice('Verified and saved ' + file + ' · ' + byteLabel(saved.bytes.length) + ' · SHA-256 ' + descriptor.sha256 + '.');
    });
  }
  if (name === 'download-review') return perform('download-review',async () => {
    const sha256 = node.dataset.sha;
    const saved = await verifiedFile('/api/review-file?intentId=' + encodeURIComponent(id) + '&sha256=' + sha256,
      {sha256},{limit:4*1024*1024});
    saveFile(saved.bytes,saved.type,'safe-purchase-review-' + sha256.slice(0,16) + '.json');
    notice('The exact saved purchase review has been verified and downloaded.');
  });
}
$('#notice-dismiss').addEventListener('click',() => notice(''));
$('#source-close').addEventListener('click',() => $('#source-dialog').close());
$('#refresh').addEventListener('click',() => perform('refresh',async () => {
  readToken(); await refresh();
  if (S.draft.page === 'operations' && S.draft.intentId) await loadOperation(S.draft.intentId,{restore:true});
  if (S.draft.page === 'handover' && S.draft.handoverId) await loadHandover(S.draft.handoverId);
}));
$('#navigation').addEventListener('click',event => {
  const node = event.target.closest('[data-page]');
  if (node) navigate(node.dataset.page).catch(reportFailure);
});
$('#main').addEventListener('input',event => {
  const node = event.target;
  if (node.id === 'operation-filter') {
    S.filter = node.value;
    const start = node.selectionStart, end = node.selectionEnd;
    render(); const restored = $('#operation-filter'); restored.focus();
    try { restored.setSelectionRange(start,end); } catch {}
    return;
  }
  const formNode = node.closest('form[data-draft]'),group = formNode?.dataset.draft;
  if (!group || !S.draft || !own(S.draft,group) || !own(S.draft[group],node.name)) return;
  if (group === 'capture' && S.draft.capture.submitted) return;
  S.draft[group][node.name] = node.value; saveDraft();
});
$('#main').addEventListener('change',event => {
  const node = event.target;
  if (node.id === 'review-picker') {
    if (!node.value) {
      S.reviewEpoch++; S.draft.review = null; S.review = null; S.reviewText = null; S.reviewBytes = null; saveDraft(); render(); return;
    }
    perform('read-review',() => loadReview(S.draft.intentId,node.value));
  } else if (node.tagName === 'SELECT') {
    const formNode = node.closest('form[data-draft]'),group = formNode?.dataset.draft;
    if (group && own(S.draft[group] || {},node.name)) {
      S.draft[group][node.name] = node.value; saveDraft();
      if (group === 'prepare' || group === 'comparison') render();
    }
  }
});
$('#main').addEventListener('submit',event => {
  const formNode = event.target.closest('form[data-form]');
  if (!formNode) return;
  event.preventDefault();
  if (!formNode.reportValidity()) return;
  const group = formNode.dataset.form;
  if (!own(S.draft || {},group)) return;
  for (const element of formNode.elements) {
    if (element.name && own(S.draft[group],element.name) && !element.disabled) S.draft[group][element.name] = element.value;
  }
  saveDraft(); perform(group,() => submitForm(group));
});
$('#main').addEventListener('click',event => {
  const node = event.target.closest('[data-action]');
  if (node && !node.disabled) action(node.dataset.action,node).catch(reportFailure);
});
window.addEventListener('hashchange',() => {
  try { readToken(); perform('refresh',async () => { await refresh(); await navigate(S.draft.page,{focus:false}); }); }
  catch (value) { reportFailure(value); }
});
document.addEventListener('visibilitychange',schedulePoll);
window.addEventListener('pagehide',() => {
  saveDraft(); if (S.timer) clearTimeout(S.timer);
  for (const controller of S.downloadControllers) controller.abort();
});
async function start() {
  try {
    readToken(); await refresh();
    if (S.draft.page === 'operations' && S.draft.intentId) await loadOperation(S.draft.intentId,{restore:true});
    if (S.draft.page === 'handover' && S.draft.handoverId) await loadHandover(S.draft.handoverId);
  } catch (value) {
    reportFailure(value); $('#main').setAttribute('aria-busy','false');
    if (!S.data) $('#main').innerHTML = '<section class="empty"><p class="eyebrow">SAVED WORKSPACE</p><h1>Open the current workspace connection</h1>' +
      '<p>Use the launch URL printed by the original Safe buyer workspace command. Refresh this page after a temporary connection interruption.</p>' +
      '<p class="help">The original buyer retains its selections, reviews, attempts and results. A page reconnect reads that same workspace.</p></section>';
  }
}
start();
