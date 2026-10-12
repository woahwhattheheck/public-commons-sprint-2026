// MIT. Complete native facilitator review and receiving in the original Huwise workbench.
const capabilityKey = 'opendatasoft-workbench-capability';
const token = location.hash.slice(1) || sessionStorage.getItem(capabilityKey) || '';
if (location.hash) {
  sessionStorage.setItem(capabilityKey,token);
  history.replaceState(null,'',location.pathname + location.search);
}
const root = document.querySelector('#selected'), notice = document.querySelector('#notice');
const form = document.querySelector('#review-form');
const state = {project:null,facilitators:null,reviews:[],next:null,total:0,selected:null,busy:false,disposed:false,
  selectionGeneration:0,selectionId:null,historyGeneration:0,historyLoading:null,refreshGeneration:0};
const lifecycle = new AbortController();
const HASH = /^[a-f0-9]{64}$/;
const byId = id => document.getElementById(id);
function element(tag,text,attributes = {}) {
  const value = document.createElement(tag);
  if (text !== undefined && text !== null) value.textContent = String(text);
  for (const [name,item] of Object.entries(attributes)) value.setAttribute(name,String(item));
  return value;
}
function message(text,error = false) { notice.textContent = text; notice.dataset.error = String(error); }
function details(label,value) {
  const node = element('details');node.append(element('summary',label),element('pre',typeof value === 'string' ? value:JSON.stringify(value,null,2)));return node;
}
function describe(items) {
  const list = element('dl');
  for (const [name,value] of items) list.append(element('dt',name),element('dd',value ?? '—'));
  return list;
}
function button(label,action,disabled = false) {
  const value = element('button',label,{type:'button'});value.disabled = disabled;
  value.addEventListener('click',() => Promise.resolve().then(action).catch(error => message(error.message,true)));
  return value;
}
function badge(value) { return element('span',value,{class:'badge'}); }
function readable(value) { return value === undefined ? '[absent]':typeof value === 'string' ? value:JSON.stringify(value); }
function table(headers,rows,className = '') {
  const outer = element('div',null,{class:'table-scroll',tabindex:'0'});
  const value = element('table',null,{class:className}), head = element('thead'), line = element('tr');
  for (const text of headers) line.append(element('th',text,{scope:'col'}));
  head.append(line);const body = element('tbody');
  for (const row of rows) {
    const line = element('tr');
    for (const cell of row) {
      const item = element('td');if (cell instanceof Node) item.append(cell);else item.textContent = String(cell ?? '—');
      line.append(item);
    }
    body.append(line);
  }
  value.append(head,body);outer.append(value);return outer;
}
async function request(path,body) {
  const response = await fetch('/api/' + path,{method:body === undefined ? 'GET':'POST',
    headers:{authorization:'Bearer ' + token,...(body === undefined ? {}:{'content-type':'application/json'})},
    ...(body === undefined ? {}:{body:JSON.stringify(body)}),signal:lifecycle.signal});
  let value;
  try { value = await response.json(); }
  catch { throw new Error('The response was incomplete. Reopen the original saved request before continuing.'); }
  if (!response.ok) throw new Error(value.message || value.error || 'The native request did not complete.');
  return value;
}
function key() {
  if (!state.project) throw new Error('Read the original workbench first.');
  return 'opendatasoft-facilitator-request:' + state.project.createdAt + ':' + state.project.catalogOrigin;
}
function pending() {
  const value = sessionStorage.getItem(key());
  if (!value) return null;
  let record;try {record = JSON.parse(value);}catch {throw new Error('The retained browser request is unreadable. Keep its original session data for recovery.');}
  if (record.schema !== 'stellar-forge.opendatasoft-facilitator-browser-request.v1' ||
      !['review','stage'].includes(record.action) || !record.input || typeof record.input !== 'object')
    throw new Error('The retained browser request does not have its original shape.');
  return record;
}
function savePending(record) {
  // A browser-storage failure stops dispatch. This is only a receiving aid; the
  // original workbench and SF82 release store remain the operation authorities.
  sessionStorage.setItem(key(),JSON.stringify(record));
}
function finishPending(record,result) {
  const completed = {...record,completedAt:new Date().toISOString(),received:result};
  sessionStorage.setItem(key() + ':retained:' + record.preparedAt,JSON.stringify(completed));
  sessionStorage.setItem(key() + ':last-received',JSON.stringify(completed));
  sessionStorage.removeItem(key());
}
function matching(record,result) {
  if (record.action === 'stage') return result?.reviewId === record.input.reviewId &&
    result?.release?.derivedFrom?.reviewId === record.input.reviewId;
  const review = result?.review,source = result?.source;
  return review && source && source.merchantExportId === record.input.merchantExportId &&
    review.source.releaseId === record.input.releaseId && review.proposed.id === record.input.id &&
    review.proposed.provider.alias === record.input.provider &&
    review.proposed.label === (record.input.label ?? record.input.id).trim();
}
function setBusy(value) {
  state.busy = value;
  form.querySelector('fieldset').disabled = value || Boolean(state.project?.active) ||
    !state.facilitators?.configured || !(state.facilitators?.store?.releases ?? []).some(item => item.merchantExportId);
  for (const value of document.querySelectorAll('[data-stage]'))
    value.disabled = state.busy || Boolean(state.project?.active) || value.dataset.allowed !== 'true';
}
function drawOperation() {
  const area = byId('operation'),operation = state.project?.operation;area.replaceChildren();
  if (operation) {
    area.append(element('p',operation.kind + ' · ' + operation.state),
      element('p',operation.id,{class:'code'}));
    if (operation.error) area.append(element('p',operation.error.message ?? operation.error.code ?? readable(operation.error)));
  }
  const original = pending();
  if (original) {
    area.append(element('p','An original ' + original.action + ' request is retained in this browser. Read its outcome before another dispatch.'));
    area.append(details('Original request',original));
    area.append(button('Recover this saved request',recover,state.busy));
    area.append(button('Retain unresolved request and prepare a new review',async () => {
      await refresh(false);
      if (state.busy || state.project.active) throw new Error('The workbench still has an active operation.');
      const saved = pending();if (!saved) return;
      finishPending(saved,{state:'UNRESOLVED',observedOperation:state.project.operation,
        note:'Local request retained without redispatch or a claimed native outcome.'});
      message('The unresolved request is retained in this browser. Its native review and release remain in the original store. A new review must use a distinct proposed release ID.');
      form.elements.id.value = '';drawOperation();
    },state.busy || Boolean(state.project?.active)));
  }
}
function fill(select,items,label,selected) {
  select.replaceChildren();
  if (!items.length) {select.append(element('option','No eligible selection',{value:''}));return;}
  for (const item of items) select.append(element('option',label(item),{value:item.id ?? item.alias}));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
function drawSourceChoice() {
  const release = state.facilitators?.store.releases.find(item => item.id === form.elements.releaseId.value);
  const destination = byId('release-source');destination.replaceChildren();
  if (release) {
    const exported = state.project.exports.find(item => item.id === release.merchantExportId);
    destination.append(element('p',release.publicOrigin),
      element('p','Merchant package: ' + release.merchantExportId),
      element('p','Original capture: ' + (exported?.capture?.manifestSha256 ?? 'Unavailable')));
  }
  const provider = state.facilitators?.providers.find(item => item.alias === form.elements.provider.value);
  byId('provider-detail').textContent = provider ? provider.url + ' · native read timeout ' + provider.timeoutMs + ' ms':'';
}
function drawState() {
  const current = state.facilitators,store = current.store;
  byId('project').replaceChildren(...describe([
    ['Portal',state.project.catalogOrigin],['Original project',state.project.createdAt],
    ['Retained merchant packages',state.project.exports.length],['Store initialized',store.initialized ? 'Yes':'Stage the original merchant package first'],
    ['Selection generation',store.generation],['Selected release',store.active],['Previous selection',store.previous]
  ]).childNodes);
  const release = form.elements.releaseId.value,provider = form.elements.provider.value;
  fill(form.elements.releaseId,store.releases.filter(item => item.merchantExportId),item => item.label + ' · ' + item.id,release);
  fill(form.elements.provider,current.providers,item => item.label + ' · ' + item.alias,provider);
  byId('configuration').textContent = current.configured
    ? 'Choose an alias from this host’s provider file. The source release supplies its complete route, request, asset, recipient and atomic amount.'
    : 'This workspace has no facilitator profile file. The host can reopen it with --facilitators FILE. Retained reviews remain readable without that file.';
  drawSourceChoice();
  const rows = store.releases.map(item => [
    item.id,item.label,item.id === store.active ? 'Selected':item.derivedFrom?.kind === 'FACILITATOR' ? 'Retained provider change':'Retained source',
    item.runtime.facilitator ?? 'Challenge only',item.merchantExportId ?? 'Unlinked source',
    item.derivedFrom?.reviewId ? button('Open original review',() => select(item.derivedFrom.reviewId)): '—'
  ]);
  const area = byId('releases');area.replaceChildren();
  if (rows.length) area.append(table(['Release','Label','Selection','Facilitator','Huwise package','Original review'],rows,'release-table'));
  else area.append(element('p','No seller release is retained in this workbench yet.',{class:'empty'}));
  const errors = byId('release-errors');errors.replaceChildren();
  for (const item of [...store.errors,...store.releases.filter(value => value.sourceError).map(value => ({id:value.id,...value.sourceError}))])
    errors.append(element('p',item.id + ': ' + item.message,{class:'issue'}));
  drawOperation();setBusy(state.busy);
}
function drawHistory() {
  const area = byId('history');area.replaceChildren();
  const filter = byId('history-filter').value.trim().toLowerCase();
  const shown = state.reviews.filter(item =>
    [item.id,item.releaseId,item.proposedReleaseId,item.label,item.provider?.alias,item.provider?.label].some(value => String(value ?? '').toLowerCase().includes(filter)));
  for (const item of shown) {
    const value = button('',() => select(item.id));value.className = 'review-choice';
    value.setAttribute('aria-pressed',String(state.selected?.review.id === item.id));
    value.append(element('strong',item.label || item.proposedReleaseId),
      element('small',item.provider.label + ' · ' + item.releaseId + ' → ' + item.proposedReleaseId),
      element('small',item.observedAt),element('small',item.id),badge(item.compatible ? 'Compatible at review':'Native review not compatible'));
    area.append(value);
  }
  if (!shown.length) area.append(element('p',filter ? 'No loaded review matches this filter.':'No native provider review is retained yet.',{class:'empty'}));
  byId('history-count').textContent = state.reviews.length + ' of ' + state.total + ' original reviews loaded; ' + shown.length + ' shown.';
  byId('history-more').hidden = !state.next;
  byId('history-more').disabled = state.historyLoading !== null;
}
async function loadHistory(reset = false) {
  if (!reset && state.historyLoading !== null) return;
  const after = reset ? null:state.next;
  if (!reset && !after && state.reviews.length) return;
  const generation = ++state.historyGeneration,items = reset ? []:[...state.reviews];
  state.historyLoading = generation;byId('history-more').disabled = true;
  try {
    const response = await request('facilitator-reviews?limit=25' + (after ? '&after=' + encodeURIComponent(after):''));
    if (state.disposed || generation !== state.historyGeneration) return;
    const seen = new Set(items.map(item => item.id));
    for (const item of response.items) if (!seen.has(item.id)) {items.push(item);seen.add(item.id);}
    state.reviews = items;state.next = response.nextCursor;state.total = response.total;drawHistory();
  } catch (error) {
    if (generation === state.historyGeneration && !state.disposed) throw error;
  } finally {
    if (state.historyLoading === generation) {state.historyLoading = null;byId('history-more').disabled = false;}
  }
}
function drawSelected() {
  const value = state.selected;root.replaceChildren();
  if (!value) {root.append(element('p','Choose a retained native review.',{class:'empty'}));return;}
  const {review,source,staged} = value,heading = element('div',null,{class:'status-line'});
  heading.append(element('h2',review.proposed.label),badge(review.compatible ? 'Compatible at review':'Not compatible'));
  root.append(element('p','3 / INSPECT AND STAGE',{class:'eyebrow'}),heading);
  root.append(describe([
    ['Native review',review.id],['Observed at',review.observedAt],['Provider',review.proposed.provider.label + ' · ' + review.proposed.provider.url],
    ['Source release',review.source.releaseId],['Proposed release',review.proposed.id],['Reviewed generation',review.generation],
    ['Huwise merchant package',source.merchantExportId],['Merchant manifest SHA256',source.merchantManifestSha256],
    ['Original capture SHA256',source.capture.manifestSha256],['Retained rows',source.capture.rowCount],
    ['Dataset snapshot',source.dataset.snapshot],['Original native SDK',review.nativeSdk]
  ]));
  if (review.error) root.append(element('p',review.error.code + ': ' + review.error.message,{class:'issue'}));
  const actions = element('div',null,{class:'actions'});
  const stage = button(staged.state === 'STAGED' ? 'Reopen original staged result':'Stage this saved review',
    () => dispatch('stage',{reviewId:review.id}),state.busy || !review.compatible || !state.facilitators.configured || staged.state === 'CONFLICT');
  stage.dataset.stage = 'true';
  stage.dataset.allowed = String(review.compatible && state.facilitators.configured && staged.state !== 'CONFLICT');
  actions.append(stage,button('Refresh this review',() => select(review.id)),
    button('Download native review',() => download(review.id,'download','facilitator-review-' + review.id + '.json')),
    button('Download source binding',() => download(review.id,'source','facilitator-source-' + review.id + '.json')),
    button('Download operating guide',() => download(review.id,'guide','HUWISE-FACILITATORS.md')));
  root.append(actions);
  root.append(element('p',staged.state === 'STAGED'
    ? 'The original staged release is retained. Selecting or running it uses the existing merchant release controls.'
    : staged.state === 'CONFLICT'
      ? 'The proposed release ID is already occupied by another retained source. Keep this review and choose a new ID for a new review.'
      : 'This review has no matching staged release. Staging verifies current native requirements and retains the new release under its original ID.',
    {class:staged.state === 'CONFLICT' ? 'issue':'muted'}));
  root.append(element('h3','Complete native payment alternatives'));
  if (!review.nativePayments.length) root.append(element('p','The native SDK did not return a complete compatible requirement set. Keep the recorded error and provider response.',{class:'empty'}));
  for (const route of review.nativePayments) {
    root.append(element('h3',route.method + ' ' + route.path),element('p',route.url,{class:'source-note'}));
    root.append(table(['Option','Scheme','Network','Asset','Atomic amount','Recipient','Authorization timeout','Complete option'],
      route.nativePayment.map((payment,index) => [
        index,readable(payment.scheme),readable(payment.network),readable(payment.asset),readable(payment.amount),
        readable(payment.payTo),readable(payment.maxTimeoutSeconds),details('All native fields',payment)
      ]),'payment-table'));
    if (route.changes.length) root.append(table(['Alternative','Changed field','Stored value','Native value'],
      route.changes.map(change => [change.option,change.field,details('Before',readable(change.before)),details('After',readable(change.after))])));
    else root.append(element('p','No payment-alternative fields changed from the stored offer.',{class:'muted'}));
    root.append(details('Complete stored payment alternatives',route.storedPayment));
  }
  root.append(details('Complete provider supported response',review.supported),
    details('Complete native review',review),details('Original Huwise source binding',source),
    details('Observed staged release',staged));
  setBusy(state.busy);
}
async function select(id,{expectedGeneration} = {}) {
  if (!HASH.test(id)) throw new Error('Choose an original saved review ID.');
  if (expectedGeneration !== undefined && expectedGeneration !== state.selectionGeneration) return null;
  const generation = ++state.selectionGeneration;state.selectionId = id;
  let value;
  try {value = await request('facilitator-reviews/' + id);}
  catch (error) {
    if (generation !== state.selectionGeneration || state.disposed) return null;
    throw error;
  }
  if (generation !== state.selectionGeneration || state.selectionId !== id || state.disposed) return null;
  if (value.review.id !== id || value.source.reviewId !== id) throw new Error('The received review differs from its selected identity.');
  state.selected = value;
  const url = new URL(location.href);url.searchParams.set('review',id);history.replaceState(null,'',url.pathname + url.search);
  drawHistory();drawSelected();return value;
}
async function refresh(reopen = true) {
  const generation = ++state.refreshGeneration,selectionGeneration = state.selectionGeneration;
  const selectedId = state.selectionId ?? state.selected?.review.id;
  const [project,facilitators] = await Promise.all([request('status'),request('facilitators')]);
  if (!state.disposed && generation === state.refreshGeneration) {
    state.project = project;state.facilitators = facilitators;drawState();
    if (reopen && selectedId) await select(selectedId,{expectedGeneration:selectionGeneration});
  }
  return {project,facilitators};
}
async function download(id,action,name) {
  if (!HASH.test(id)) throw new Error('Choose the displayed original review.');
  const response = await fetch('/api/facilitator-reviews/' + id + '/' + action,{
    headers:{authorization:'Bearer ' + token},signal:lifecycle.signal});
  if (!response.ok) {const error = await response.json();throw new Error(error.message || 'The original file could not be downloaded.');}
  const bytes = await response.arrayBuffer();
  if (action !== 'guide') {
    const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if ((action === 'download' ? value.id:value.reviewId) !== id)
      throw new Error('The complete original file belongs to another review.');
  }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
  const url = URL.createObjectURL(new Blob([bytes],{type:response.headers.get('content-type') || 'application/octet-stream'}));
  const link = element('a',null,{href:url,download:name});document.body.append(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(url),10000);
  message('Received ' + name + ' · ' + bytes.byteLength + ' bytes · SHA256 ' + digest);
}
async function received(record,result,selectionGeneration = state.selectionGeneration) {
  if (!matching(record,result)) throw new Error('The current native result belongs to another request. Keep the saved request and inspect its exact review or proposed release.');
  const id = record.action === 'review' ? result.review.id:record.input.reviewId;
  await select(id,{expectedGeneration:selectionGeneration});finishPending(record,{reviewId:id,operationId:record.operationId ?? null,
    ...(record.action === 'stage' ? {releaseId:result.release.id,releaseDigest:result.release.digest}:{})});
  await refresh(false);await loadHistory(true);
  message(record.action === 'review' ? 'Complete native review retained. Inspect its original payment alternatives before staging.':'The original reviewed release is retained. Use the existing merchant lifecycle to select and run it.');
}
async function waitFor(record,selectionGeneration = state.selectionGeneration) {
  while (!state.disposed) {
    const observation = await refresh(false);
    const operation = observation.project.operation;
    if (!operation || operation.id !== record.operationId)
      throw new Error('The workbench has moved to another operation. Inspect the retained review and original staged release; do not repeat an uncertain request blindly.');
    if (operation.state !== 'RUNNING') {
      if (operation.state !== 'COMPLETE') {
        if (record.action === 'stage') {
          const observed = await request('facilitator-reviews/' + record.input.reviewId);
          if (observed.staged.state === 'STAGED') return await received(record,{
            reviewId:record.input.reviewId,release:observed.staged.release,source:observed.source},selectionGeneration);
        }
        finishPending(record,{state:operation.state,operationId:operation.id,error:operation.error ?? null});
        drawOperation();
        throw new Error(operation.error?.message || ('The original operation ended ' + operation.state + '. Its request and native result are retained.'));
      }
      await received(record,operation.result,selectionGeneration);return;
    }
    await new Promise(resolve => setTimeout(resolve,900));
  }
}
async function dispatch(action,input) {
  if (state.busy || state.project?.active) throw new Error('Wait for the original workbench operation to finish.');
  if (pending()) throw new Error('Recover the saved browser request before another dispatch.');
  const record = {schema:'stellar-forge.opendatasoft-facilitator-browser-request.v1',
    action,input:structuredClone(input),preparedAt:new Date().toISOString(),operationId:null};
  const selectionGeneration = state.selectionGeneration;
  savePending(record);setBusy(true);drawOperation();
  try {
    const started = await request(action === 'review' ? 'facilitator-reviews':'facilitator-reviews/' + input.reviewId + '/stage',action === 'review' ? input:{});
    if (typeof started.operationId !== 'string') throw new Error('The native start response did not contain its original operation ID.');
    record.operationId = started.operationId;savePending(record);await waitFor(record,selectionGeneration);
  } finally {setBusy(false);drawOperation();}
}
async function recover() {
  if (state.busy) return;
  const record = pending();if (!record) return;
  const selectionGeneration = state.selectionGeneration;
  setBusy(true);
  try {
    const observation = await refresh(false);
    if (record.operationId && observation.project.operation?.id === record.operationId) return await waitFor(record,selectionGeneration);
    const current = observation.project.operation;
    if (current?.state === 'COMPLETE' && matching(record,current.result)) {
      record.operationId = current.id;savePending(record);return await received(record,current.result,selectionGeneration);
    }
    if (record.action === 'stage') {
      const selected = await request('facilitator-reviews/' + record.input.reviewId);
      if (selected.staged.state === 'STAGED') return await received(record,{
        reviewId:record.input.reviewId,release:selected.staged.release,source:selected.source},selectionGeneration);
    } else {
      if (state.selected && matching(record,state.selected)) return await received(record,state.selected,selectionGeneration);
      await loadHistory(true);
    }
    throw new Error('No matching completed result has been observed. Wait for the original operation, or open its matching saved review from history and recover again. The retained request has not been resent.');
  } finally {setBusy(false);drawOperation();}
}
form.addEventListener('submit',event => {
  event.preventDefault();
  Promise.resolve().then(async () => {
    const data = new FormData(form),release = state.facilitators.store.releases.find(item => item.id === data.get('releaseId'));
    if (!release?.merchantExportId) throw new Error('Choose an original Huwise seller release.');
    const id = String(data.get('id')),label = String(data.get('label')).trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !label || label.length > 240)
      throw new Error('Enter a valid new release ID and label.');
    if (state.facilitators.store.releases.some(item => item.id === id))
      throw new Error('That release ID is already retained. Open its original review, or choose a new ID.');
    await dispatch('review',{merchantExportId:release.merchantExportId,releaseId:release.id,
      provider:String(data.get('provider')),id,label});
  }).catch(error => message(error.message,true));
});
form.elements.releaseId.addEventListener('change',drawSourceChoice);
form.elements.provider.addEventListener('change',drawSourceChoice);
byId('history-filter').addEventListener('input',drawHistory);
byId('refresh').addEventListener('click',() => refresh().then(() => loadHistory(true)).catch(error => message(error.message,true)));
byId('history-refresh').addEventListener('click',() => loadHistory(true).catch(error => message(error.message,true)));
byId('history-more').addEventListener('click',() => loadHistory(false).catch(error => message(error.message,true)));
window.addEventListener('pagehide',() => {state.disposed = true;lifecycle.abort();},{once:true});
(async () => {
  setBusy(true);
  try {
    if (!token) throw new Error('Open the complete private workbench link printed by the host command, then choose Facilitators.');
    await refresh(false);await loadHistory(true);
    const selected = new URL(location.href).searchParams.get('review');
    if (selected) await select(selected);
    if (pending()) message('A saved request is waiting for its original native result. Choose Recover this saved request.');
  } catch (error) {message(error.message,true);}
  finally {setBusy(false);}
})();
