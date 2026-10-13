// MIT. Local operator controls; all business/source values render as text.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
history.replaceState(null, '', location.pathname);
let state, eventAfter = 0, preview = null, busy = false;
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.addEventListener('click', () => run(action)); return node; };
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error + (result.field ? ': ' + result.field : '')); error.status = response.status; error.result = result; throw error; }
  return result;
}
async function run(action) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  const disabled = [...document.querySelectorAll('button,input,select,textarea')].map(node => [node,node.disabled]);
  for (const [node] of disabled) node.disabled = true;
  try { await action(); }
  catch (error) { notice(error.message, true); }
  finally { for (const [node,value] of disabled) if (node.isConnected) node.disabled=value; busy=false; document.body.classList.remove('busy'); updateWorking(); }
}
function download(name, body, type = 'application/json') {
  const url = URL.createObjectURL(body instanceof Blob ? body : new Blob([body], { type }));
  const anchor = element('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
function fillSelect(node, entries, { all = false } = {}) {
  const selected = new Set([...node.selectedOptions].map(option => option.value)); node.replaceChildren();
  if (all) { const option = element('option', 'All sources'); option.value = ''; node.append(option); }
  for (const entry of entries) {
    const option = element('option', entry.label + (entry.enabled ? '' : ' (paused)')); option.value = entry.id; option.selected = selected.has(entry.id); node.append(option);
  }
}
function clean(value) { const { revision, updatedAt, ...definition } = value; return definition; }
function formValue(form, name) { return form.elements.namedItem(name).value; }
function itemRow(value, info, actions) {
  const row = element('div', undefined, 'item'), left = element('div'), title = element('strong', value.label ?? value.name);
  if (value.enabled !== undefined) title.append(element('span', value.enabled ? 'Active' : 'Paused', 'badge'));
  left.append(title, element('span', info)); row.append(left, actions); return row;
}
async function refresh() {
  const next = await api('/api/status');
  if (working && next.storeId !== working.storeId) throw new Error('STORE_CHANGED: export the current working copy and reopen the original workspace.');
  state = next;
  $('accepted').textContent = state.acceptedEvents.toLocaleString(); $('retained').textContent = state.retainedEvents.toLocaleString();
  $('retries').textContent = state.duplicateDeliveries.toLocaleString(); $('watermark').textContent = state.highWatermark.toLocaleString();
  $('store-id').textContent = state.storeId;
  $('retention-summary').textContent = 'Bodies currently removed through sequence ' + state.purgedThroughSequence + '.';
  $('source-list').replaceChildren(...state.sources.map(source => itemRow(source, '/webhooks/' + source.id,
    button('Edit', () => loadSource(source)))));
  if (!state.sources.length) $('source-list').append(element('p', 'Add an event source to begin.'));
  $('feed-list').replaceChildren(...state.feeds.map(feed => itemRow(feed, '/feeds/' + feed.id + ' · ' + feed.projection.length + ' selected fields',
    button('Edit', () => loadFeed(feed)))));
  if (!state.feeds.length) $('feed-list').append(element('p', 'Create a feed after adding a source.'));
  fillSelect($('feed-sources'), state.sources); fillSelect($('events-source'), state.sources, { all: true });
  fillSelect($('preview-feed'), state.feeds); fillSelect($('plan-feeds'), state.feeds);
  $('snapshot-list').replaceChildren(...state.snapshots.map(snapshot => {
    const actions = element('div', undefined, 'item-actions');
    for (const file of ['snapshot.json', 'events.sqlite']) actions.append(button(file === 'snapshot.json' ? 'Manifest' : 'Database', async () => {
      const response = await fetch('/api/snapshot-file?' + new URLSearchParams({ name: snapshot.name, file }), { headers: { authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('SNAPSHOT_DOWNLOAD_FAILED');
      download(file, await response.blob());
    }));
    return itemRow(snapshot, snapshot.retainedEvents + ' events · sequence ' + snapshot.highWatermark, actions);
  }));
  $('plan-summary').textContent = state.merchant.plan ? 'Saved ' + state.merchant.plan.feeds.length + ' feeds. Revision ' + state.merchant.revision.slice(0, 12) + '.' : 'Save payment terms for the feeds you want to publish.';
  $('plan-output').textContent = JSON.stringify(state.merchant.plan ?? {}, null, 2);
  if (working) { renderCurrent('source'); renderCurrent('feed'); renderCurrent('plan'); }
  notice('Store reopened. ' + state.retainedEvents + ' event bodies available; draft revisions are preserved.');
}
function renderSource(source = null) {
  const form = $('source-form'); form.reset(); form.dataset.revision = source?.revision ?? '';
  form.elements.id.readOnly = Boolean(source);
  if (source) for (const [key, value] of Object.entries(clean(source))) {
    const field = form.elements.namedItem(key); if (!field) continue; if (field.type === 'checkbox') field.checked = value; else field.value = value ?? '';
  }
  $('source-title').textContent = source ? 'Edit ' + source.label : 'Configure source';
  $('source-revision').textContent = source ? 'Revision ' + source.revision.slice(0, 16) : '';
}
function projectionRow(field = { name: '', pointer: '' }) {
  const row = element('tr'), name = element('input'), pointer = element('input');
  name.value = field.name; name.required = true; name.placeholder = 'sku'; name.setAttribute('aria-label', 'Output field name');
  pointer.value = field.pointer; pointer.required = true; pointer.placeholder = '/data/sku'; pointer.setAttribute('aria-label', 'Source JSON pointer');
  const a = element('td'), b = element('td'), c = element('td'); a.append(name); b.append(pointer); c.append(button('Remove', () => { row.remove(); capture('feed'); }));
  row.append(a, b, c); $('projection-fields').append(row);
}
function renderFeed(feed = null) {
  const form = $('feed-form'); form.reset(); form.dataset.revision = feed?.revision ?? '';
  form.elements.id.readOnly = Boolean(feed);
  if (feed) {
    for (const name of ['id', 'label', 'description', 'defaultPageSize', 'maxPageSize']) form.elements.namedItem(name).value = feed[name];
    form.elements.enabled.checked = feed.enabled; form.elements.types.value = feed.types.join(', ');
    for (const option of $('feed-sources').options) option.selected = feed.sourceIds.includes(option.value);
  }
  $('projection-fields').replaceChildren();
  for (const field of feed?.projection ?? [{ name: 'objectId', pointer: '/data/id' }]) projectionRow(field);
  form.dataset.maxPageBytes = String(feed?.maxPageBytes ?? 1048576);
  $('feed-revision').textContent = feed ? 'Revision ' + feed.revision.slice(0, 16) : '';
}
async function readEvents(reset = false) {
  if (reset) eventAfter = 0;
  const rows = await api('/api/events?' + new URLSearchParams({ after: String(eventAfter), limit: '50', ...($('events-source').value ? { sourceId: $('events-source').value } : {}) }));
  $('events-rows').replaceChildren(...rows.map(event => {
    const row = element('tr');
    for (const text of [event.sequence, event.sourceId + ' / ' + event.eventId, event.type ?? 'Body removed', event.acceptedAt, event.attempts]) row.append(element('td', String(text)));
    const action = element('td'); const inspect = button('Inspect', async () => {
      const result = await api('/api/event?sequence=' + event.sequence);
      $('event-output').textContent = JSON.stringify(result, null, 2);
    }); inspect.disabled = !event.retained; action.append(inspect); row.append(action); return row;
  }));
  if (rows.length) eventAfter = rows.at(-1).sequence;
  $('event-summary').textContent = rows.length ? rows.length + ' events shown; last sequence ' + eventAfter + '.' : 'No further events in this view.';
}
async function readPreview(first) {
  const feedId = $('preview-feed').value; if (!feedId) throw new Error('SELECT_A_FEED');
  const cursor = first || preview?.feedId !== feedId ? null : preview.page.nextCursor ?? preview.page.resumeCursor;
  preview = await api('/api/preview?' + new URLSearchParams({ feedId, ...(cursor ? { cursor } : {}) }));
  $('preview-summary').textContent = preview.items.length + ' events · snapshot through ' + preview.page.throughSequence + ' · revision ' + preview.feedRevision.slice(0, 12) + '.';
  $('preview-output').textContent = JSON.stringify(preview.items, null, 2);
  $('preview-next').disabled = false; $('preview-next').textContent = preview.page.hasMore ? 'Next page' : 'Read new events'; $('preview-export').disabled = false;
}

// A browser working copy retains authored inputs and native save attempts. Native
// definitions, validation, payments and snapshots remain in the existing store.
const WORKING_SCHEMA='stellar-forge.webhook-publisher-working-copy.v1';
const WORKING_PREFIX='starforge:webhook-publisher:';
const MAX_WORKING_BYTES=8*1024*1024;
let working=null, receivedWorking=null, storageIssue='', reviewSelection=null;
const clone=value=>JSON.parse(JSON.stringify(value));
const uid=()=>crypto.randomUUID();
const stamp=()=>new Date().toISOString();
const isObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function need(value,message){if(!value)throw new Error(message);}
function stable(value){return JSON.stringify(value,(_key,item)=>isObject(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
function equal(a,b){return stable(a)===stable(b);}
function size(value){return new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;}
function nativeValue(kind,id){
  if(kind==='plan')return {value:clone(state.merchant.plan),revision:state.merchant.revision};
  const found=state[kind==='source'?'sources':'feeds'].find(value=>value.id===id);
  return found?{value:clean(found),revision:found.revision}:{value:null,revision:null};
}
function compareValue(kind,value){
  if(value===null)return null;
  const result=clone(value);
  if(kind==='feed'){if(Array.isArray(result.sourceIds))result.sourceIds.sort();if(Array.isArray(result.types))result.types.sort();}
  return result;
}
function validateWorking(value){
  need(isObject(value)&&value.schema===WORKING_SCHEMA,'Open a complete publisher working-copy file.');
  for(const name of ['id','storeId','createdAt','updatedAt','title'])need(typeof value[name]==='string'&&value[name].length>0,'Working copy is missing '+name+'.');
  need(Array.isArray(value.drafts)&&Array.isArray(value.history)&&isObject(value.selected),'Retain drafts, selection and complete history.');
  need(new Set(value.drafts.map(d=>d.key)).size===value.drafts.length,'Draft identities must be unique.');
  for(const draft of value.drafts){
    need(isObject(draft)&&['source','feed','plan'].includes(draft.kind)&&typeof draft.key==='string'&&typeof draft.id==='string'&&isObject(draft.fields),'Retain the complete draft identity and fields.');
    need(draft.expectedRevision===null||typeof draft.expectedRevision==='string','Retain the original revision.');
    need(draft.base===null||isObject(draft.base),'Retain the original definition.');
    need(Array.isArray(draft.attempts),'Retain native attempts.');
    if(draft.kind==='plan')need(typeof draft.fields.text==='string','Retain complete plan text.');
    else {
      const required=draft.kind==='source'?['id','label','secretEnv','typePointer','occurredAtPointer','maxEventBytes','toleranceSeconds']:['id','label','description','types','defaultPageSize','maxPageSize','maxPageBytes'];
      for(const name of required)need(typeof draft.fields[name]==='string','Retain original '+name+' input.');
      need(typeof draft.fields.enabled==='boolean','Retain the enabled selection.');
      if(draft.kind==='feed'){
        need(Array.isArray(draft.fields.sourceIds)&&draft.fields.sourceIds.every(x=>typeof x==='string'),'Retain selected sources.');
        need(Array.isArray(draft.fields.projection)&&draft.fields.projection.every(x=>isObject(x)&&typeof x.name==='string'&&typeof x.pointer==='string'),'Retain every projection row.');
      }
    }
    for(const attempt of draft.attempts){
      need(isObject(attempt)&&typeof attempt.id==='string'&&typeof attempt.at==='string'&&['PENDING','SAVED','REJECTED','SUPERSEDED'].includes(attempt.status)&&isObject(attempt.body),'Retain the complete native save attempt.');
      need(attempt.body.expectedRevision===null||typeof attempt.body.expectedRevision==='string','Retain the attempted revision.');
      const selected=draft.kind==='plan'?attempt.body.plan:attempt.body.definition;
      need(isObject(selected),'Retain the complete original native payload.');
      if(draft.kind!=='plan')need(typeof selected.id==='string'&&selected.id===draft.id,'The native attempt must belong to its original definition.');
    }
  }
  for(const kind of ['source','feed','plan'])need(value.selected[kind]===null||value.drafts.some(d=>d.key===value.selected[kind]&&d.kind===kind),'Retain the selected original draft.');
  need(size(value)<=MAX_WORKING_BYTES,'Working copy exceeds 8 MiB. Keep its complete exported file and begin a new copy.');
  return value;
}
function currentDraft(kind){return working?.drafts.find(d=>d.key===working.selected[kind])??null;}
function persist(){
  if(!working)return;
  working.updatedAt=stamp();
  const text=JSON.stringify(validateWorking(working));
  try{localStorage.setItem(WORKING_PREFIX+working.storeId+':'+working.id,text);storageIssue='';}
  catch(error){storageIssue='Browser storage is unavailable or full. Download the complete working copy before closing. Native saves require retained local state.';updateWorking();throw new Error(storageIssue);}
  updateWorking();
}
function checkpoint(label){
  working.history.push({id:uid(),at:stamp(),label,drafts:clone(working.drafts),selected:clone(working.selected)});
}
function adoptWorking(candidate){
  candidate.updatedAt=stamp();
  const text=JSON.stringify(validateWorking(candidate));
  try{localStorage.setItem(WORKING_PREFIX+candidate.storeId+':'+candidate.id,text);}
  catch(error){storageIssue='Browser storage is unavailable or full. Download the current complete working copy before closing. The received copy remains unchanged.';updateWorking();throw new Error(storageIssue);}
  working=candidate;storageIssue='';updateWorking();
}
function startWorking(original=null){
  if(original){validateWorking(original);need(original.storeId===state.storeId,'This working copy belongs to another event store. Open that store before receiving it.');}
  const candidate=original?clone(original):{schema:WORKING_SCHEMA,id:uid(),storeId:state.storeId,title:'Publisher commissioning',createdAt:stamp(),updatedAt:stamp(),drafts:[],selected:{source:null,feed:null,plan:null},history:[]};
  if(original){candidate.origin={id:original.id,updatedAt:original.updatedAt};candidate.id=uid();candidate.history.push({id:uid(),at:stamp(),label:'Opened complete prior working copy',origin:clone(candidate.origin)});}
  adoptWorking(candidate);renderWorkingList();
}
function captureFields(kind){
  if(kind==='plan')return {text:$('plan-json').value};
  const form=$(kind+'-form'),fields={};
  for(const field of form.elements){
    if(!field.name||field.type==='submit')continue;
    fields[field.name]=field.type==='checkbox'?field.checked:field.multiple?[...field.selectedOptions].map(x=>x.value):field.value;
  }
  if(kind==='feed'){
    fields.projection=[...$('projection-fields').children].map(row=>({name:row.children[0].firstElementChild.value,pointer:row.children[1].firstElementChild.value}));
    fields.maxPageBytes=$('feed-page-bytes').value;
  }
  return fields;
}
function capture(kind){
  if(!working||!currentDraft(kind))return;
  currentDraft(kind).fields=captureFields(kind);
  // Synchronous retained write finishes before a selection or native dispatch.
  persist();
}
function renderFields(form,fields){
  for(const [name,value] of Object.entries(fields)){
    const field=form.elements.namedItem(name);if(!field)continue;
    if(field.type==='checkbox')field.checked=value;
    else if(field.multiple){
      for(const wanted of value)if(![...field.options].some(x=>x.value===wanted)){const option=element('option',wanted+' (not in current store)');option.value=wanted;field.append(option);}
      for(const option of field.options)option.selected=value.includes(option.value);
    }else field.value=value;
  }
}
function renderCurrent(kind){
  const draft=currentDraft(kind);if(!draft)return;
  if(kind==='source'){renderSource(draft.base?{...draft.base,revision:draft.expectedRevision}:null);renderFields($('source-form'),draft.fields);$('source-form').elements.id.readOnly=Boolean(draft.base)||draft.attempts.length>0;}
  if(kind==='feed'){renderFeed(draft.base?{...draft.base,revision:draft.expectedRevision}:null);renderFields($('feed-form'),draft.fields);$('feed-form').elements.id.readOnly=Boolean(draft.base)||draft.attempts.length>0;$('projection-fields').replaceChildren();for(const row of draft.fields.projection)projectionRow(row);}
  if(kind==='plan')$('plan-json').value=draft.fields.text;
  $(kind+'-draft-state').textContent=(draft.expectedRevision?'Editing native revision '+draft.expectedRevision.slice(0,16):'New native definition')+' · '+draft.attempts.length+' retained save attempts';
  updateWorking();
}
function initialFields(kind,value){
  if(kind==='plan')return {text:JSON.stringify(value??{schema:'stellar-forge.webhook-feed-merchant.v1',publicOrigin:'',feeds:[]},null,2)};
  if(kind==='source'){
    const source=value??{id:'',label:'',secretEnv:'EVENTS_WEBHOOK_SECRET',typePointer:'/type',occurredAtPointer:null,maxEventBytes:65536,toleranceSeconds:300,enabled:true};
    return {id:source.id,label:source.label,secretEnv:source.secretEnv,typePointer:source.typePointer,occurredAtPointer:source.occurredAtPointer??'',maxEventBytes:String(source.maxEventBytes),toleranceSeconds:String(source.toleranceSeconds),enabled:source.enabled};
  }
  const feed=value??{id:'',label:'',description:'',sourceIds:[],types:[],projection:[{name:'objectId',pointer:'/data/id'}],enabled:true,defaultPageSize:50,maxPageSize:100,maxPageBytes:1048576};
  return {id:feed.id,label:feed.label,description:feed.description,sourceIds:clone(feed.sourceIds),types:feed.types.join(', '),projection:clone(feed.projection),enabled:feed.enabled,defaultPageSize:String(feed.defaultPageSize),maxPageSize:String(feed.maxPageSize),maxPageBytes:String(feed.maxPageBytes)};
}
function selectDraft(kind,value=null){
  capture(kind);
  const candidate=clone(working),id=kind==='plan'?'merchant':value?.id??'';
  let draft=value||kind==='plan'?candidate.drafts.find(d=>d.kind===kind&&d.id===id):null;
  if(!draft){
    const base=kind==='plan'?clone(state.merchant.plan):value?clean(value):null;
    draft={key:uid(),kind,id,expectedRevision:kind==='plan'?state.merchant.revision:value?.revision??null,base,fields:initialFields(kind,base),attempts:[]};
    candidate.drafts.push(draft);
  }
  candidate.selected[kind]=draft.key;adoptWorking(candidate);renderCurrent(kind);
}
function loadSource(value=null){selectDraft('source',value);}
function loadFeed(value=null){selectDraft('feed',value);}
function loadPlan(){selectDraft('plan');}
function draftBody(kind,draft){
  if(kind==='plan'){
    const plan=JSON.parse(draft.fields.text);
    need(isObject(plan)&&plan.schema==='stellar-forge.webhook-feed-merchant.v1','Review a complete original merchant plan.');
    return {plan,expectedRevision:draft.expectedRevision};
  }
  const definition=clone(draft.fields);
  for(const field of kind==='source'?['maxEventBytes','toleranceSeconds']:['defaultPageSize','maxPageSize','maxPageBytes'])definition[field]=Number(definition[field]);
  if(kind==='source')definition.occurredAtPointer=definition.occurredAtPointer||null;
  else definition.types=definition.types.split(',').map(x=>x.trim()).filter(Boolean);
  need(!draft.id||draft.id===definition.id,'The draft belongs to its original definition.');
  return {definition,expectedRevision:draft.expectedRevision};
}
function pending(draft){return [...draft.attempts].reverse().find(a=>a.status==='PENDING');}
async function dispatch(kind,draft,attempt){
  // Exact retained body only. The original endpoint is already idempotent for
  // an identical current definition, and rejects a different stale revision.
  persist();
  try{
    const result=await api('/api/'+kind,attempt.body);
    attempt.status='SAVED';attempt.result=clone(result);attempt.completedAt=stamp();
    draft.base=kind==='plan'?clone(result.plan):clean(result);draft.expectedRevision=result.revision;
    persist(); await refresh();renderCurrent(kind);
    notice('Saved '+kind+' in its original store; full request and receipt retained.');
  }catch(error){
    if(attempt.status==='PENDING'&&error.status&&error.status<500){attempt.status='REJECTED';attempt.error=clone(error.result);attempt.completedAt=stamp();persist();}
    throw error;
  }
}
async function saveDraft(kind){
  capture(kind);const draft=currentDraft(kind);
  need(!pending(draft),'Inspect and reconcile the original pending save before another native request.');
  const body=draftBody(kind,draft);if(kind!=='plan')draft.id=body.definition.id;
  const attempt={id:uid(),at:stamp(),status:'PENDING',body:clone(body)};
  draft.attempts.push(attempt);persist();await dispatch(kind,draft,attempt);
}
async function inspectDraft(kind){
  capture(kind);await refresh();const draft=currentDraft(kind),identity=kind==='plan'?'merchant':draft.id||draft.fields.id,native=nativeValue(kind,identity),attempt=pending(draft);
  let message='Review current native content, the retained baseline and your draft.';
  if(attempt){
    const sent=kind==='plan'?attempt.body.plan:attempt.body.definition;
    if(equal(compareValue(kind,sent),compareValue(kind,native.value))){
      attempt.status='SAVED';attempt.result={revision:native.revision,...(kind==='plan'?{plan:clone(native.value)}:{...clone(native.value)})};attempt.completedAt=stamp();attempt.reconciled=true;
      draft.base=clone(native.value);draft.expectedRevision=native.revision;persist();renderCurrent(kind);
      message='The original requested content is currently saved. Its native revision is retained.';
    }else if(native.revision===attempt.body.expectedRevision)message='Original revision still selected. Retry submits only the exact retained request, with the original native revision check.';
    else message='Native content changed. Review the complete conflict before adopting its current revision. The previous request remains retained.';
  }
  reviewSelection={kind,key:draft.key,id:identity,native:clone(native),attemptId:attempt?.id??null};
  $('draft-review').hidden=false;$('draft-review-summary').textContent=message;
  $('draft-review-output').textContent=JSON.stringify({kind,id:draft.id,currentNative:native,originalBaseline:{revision:draft.expectedRevision,definition:draft.base},workingInput:draft.fields,attempts:draft.attempts},null,2);
  $('retry-original').disabled=!pending(draft)||native.revision!==pending(draft).body.expectedRevision;
  $('adopt-revision').disabled=false;updateWorking();
}
function selectedReview(){
  need(reviewSelection,'Inspect a selected draft first.');const draft=currentDraft(reviewSelection.kind);
  need(draft?.key===reviewSelection.key,'The inspected draft changed. Inspect this selection again.');
  need(draft.kind==='plan'||(draft.id||draft.fields.id)===reviewSelection.id,'The definition identity changed. Inspect this selection again.');
  return draft;
}
function updateWorking(){
  if(!working)return;
  $('working-status').textContent=storageIssue||working.drafts.length+' drafts retained for store '+working.storeId+'. Working copy '+working.id.slice(0,8)+'.';
  $('working-title').value=working.title;
  const history=$('working-history'),chosen=history.value;history.replaceChildren();for(const entry of working.history.filter(x=>Array.isArray(x.drafts)&&isObject(x.selected))){const option=element('option',entry.at+' · '+entry.label);option.value=entry.id;option.selected=entry.id===chosen;history.append(option);}
  $('working-restore').disabled=busy||!history.options.length;
  for(const kind of ['source','feed','plan']){
    const draft=currentDraft(kind),node=$(kind+'-save');if(node)node.disabled=busy||!draft||Boolean(pending(draft))||Boolean(storageIssue);
    if(kind!=='plan') { const select=$(kind+'-draft-list');select.replaceChildren();for(const item of working.drafts.filter(x=>x.kind===kind)){const option=element('option',(item.fields.id||'New '+kind)+' · '+(item.fields.label||'Untitled')+' · '+item.key.slice(0,8));option.value=item.key;option.selected=item.key===working.selected[kind];select.append(option);} }
  }
  if(reviewSelection){
    const draft=currentDraft(reviewSelection.kind);
    $('retry-original').disabled=busy||draft?.key!==reviewSelection.key||!pending(draft)||reviewSelection.native.revision!==pending(draft).body.expectedRevision;
    $('adopt-revision').disabled=busy||draft?.key!==reviewSelection.key;
  }
}
function renderWorkingList(){
  const list=$('working-list');list.replaceChildren();
  try{
    const values=[];
    for(let n=0;n<localStorage.length;n++){
      const key=localStorage.key(n);if(!key?.startsWith(WORKING_PREFIX+state.storeId+':'))continue;
      try{const value=validateWorking(JSON.parse(localStorage.getItem(key)));values.push(value);}catch{list.append(element('p','An unreadable retained copy remains in browser storage; it has not been replaced.'));}
    }
    values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    for(const value of values){
      const row=element('div',undefined,'item'),label=element('div');
      label.append(element('strong',value.title),element('span',value.updatedAt+' · '+value.drafts.length+' drafts · '+value.id.slice(0,8)));
      row.append(label,button('Review copy',()=>reviewWorking(value)));list.append(row);
    }
  }catch(error){notice(error.message,true);}
}
function reviewWorking(value){
  validateWorking(value);need(value.storeId===state.storeId,'This working copy belongs to another event store.');
  receivedWorking=clone(value);$('working-import-review').hidden=false;
  $('working-import-summary').textContent=value.title+' · '+value.drafts.length+' complete drafts · '+value.history.length+' saved checkpoints. Opening retains the preceding copy and creates a separate editable copy.';
  $('working-import-output').textContent=JSON.stringify(value,null,2);
}
function exportWorking(){
  for(const kind of ['source','feed','plan'])if(currentDraft(kind))currentDraft(kind).fields=captureFields(kind);
  // A storage quota failure must not prevent rescuing the complete in-memory work.
  const oversized=size(working)>MAX_WORKING_BYTES;
  download('webhook-publisher-'+working.id+(oversized?'-oversized-rescue':'')+'.json',JSON.stringify(working,null,2)+'\n');
  notice(oversized?'Oversized rescue file downloaded with all current work. Ordinary import accepts up to 8 MiB of logical content; preserve this file for source-assisted recovery.':'Complete private working copy downloaded. It contains definition drafts and request history; the source store backup remains a separate transfer.',oversized);
}
for(const kind of ['source','feed'])$(kind+'-draft-list').addEventListener('change',event=>run(()=>{
  const key=event.target.value;capture(kind);need(working.drafts.some(d=>d.kind===kind&&d.key===key),'Select a retained draft.');
  const candidate=clone(working);candidate.selected[kind]=key;adoptWorking(candidate);renderCurrent(kind);
}));
for(const kind of ['source','feed','plan']){
  $(kind+'-form').addEventListener('input',()=>{if(!busy)try{capture(kind);}catch(error){notice(error.message,true);}});
  $(kind+'-form').addEventListener('change',()=>{if(!busy)try{capture(kind);}catch(error){notice(error.message,true);}});
  $(kind+'-inspect').addEventListener('click',()=>run(()=>inspectDraft(kind)));
}
$('working-title').addEventListener('input',()=>{if(!busy&&working){working.title=$('working-title').value||'Publisher commissioning';try{persist();}catch(error){notice(error.message,true);}}});
$('working-export').addEventListener('click',exportWorking);
$('working-restore').addEventListener('click',()=>run(()=>{
  for(const kind of ['source','feed','plan'])capture(kind);
  const entry=working.history.find(x=>x.id===$('working-history').value);need(entry&&Array.isArray(entry.drafts)&&isObject(entry.selected),'Select a complete retained checkpoint.');
  const candidate=clone(working);candidate.history.push({id:uid(),at:stamp(),label:'Before restoring '+entry.label,drafts:clone(candidate.drafts),selected:clone(candidate.selected)});
  candidate.drafts=clone(entry.drafts);candidate.selected=clone(entry.selected);adoptWorking(candidate);
  for(const kind of ['source','feed','plan']){if(currentDraft(kind))renderCurrent(kind);else selectDraft(kind);}
  reviewSelection=null;$('draft-review').hidden=true;notice('Complete checkpoint reopened. Inspect current native revisions before saving.');
}));
$('working-new').addEventListener('click',()=>run(()=>{
  for(const kind of ['source','feed','plan'])capture(kind);checkpoint('Before beginning a new working copy');persist();
  startWorking();loadSource();loadFeed();loadPlan();reviewSelection=null;$('draft-review').hidden=true;
  notice('New working copy opened. All preceding drafts and requests remain in the saved original copy.');
}));
$('working-refresh').addEventListener('click',()=>run(renderWorkingList));
$('working-file').addEventListener('change',()=>run(async()=>{
  const file=$('working-file').files[0];need(file&&file.size<=MAX_WORKING_BYTES*2,'Choose a complete working-copy JSON file up to 16 MiB.');
  reviewWorking(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())));
}));
$('working-import').addEventListener('click',()=>run(()=>{
  need(receivedWorking,'Review a complete working copy first.');for(const kind of ['source','feed','plan'])capture(kind);
  checkpoint('Before opening another complete working copy');persist();
  const selected=clone(receivedWorking);startWorking(selected);
  for(const kind of ['source','feed','plan']){if(currentDraft(kind))renderCurrent(kind);else selectDraft(kind);}
  receivedWorking=null;reviewSelection=null;$('working-import-review').hidden=true;$('draft-review').hidden=true;
  notice('Original complete working copy opened as a separate editable copy. Inspect native revisions before any save.');
}));
$('retry-original').addEventListener('click',()=>run(async()=>{
  const draft=selectedReview(),kind=draft.kind;capture(kind);
  const attempt=pending(draft);need(attempt,'The original save is already reconciled.');
  const latest=await api('/api/status');need(latest.storeId===working.storeId,'STORE_CHANGED');state=latest;
  const native=nativeValue(kind,draft.id);need(native.revision===attempt.body.expectedRevision,'Native revision changed. Inspect the original request again.');
  await dispatch(kind,draft,attempt);
}));
$('adopt-revision').addEventListener('click',()=>run(async()=>{
  const draft=selectedReview(),kind=draft.kind;capture(kind);
  const latest=await api('/api/status');need(latest.storeId===working.storeId,'STORE_CHANGED');state=latest;
  const native=nativeValue(kind,reviewSelection.id);need(equal(native,reviewSelection.native),'Native content changed since inspection. Inspect again.');
  checkpoint('Before adopting the reviewed native '+kind+' revision');
  const attempt=pending(draft);if(attempt){attempt.status='SUPERSEDED';attempt.reviewedAt=stamp();attempt.currentNative=clone(native);}
  draft.id=reviewSelection.id;draft.base=clone(native.value);draft.expectedRevision=native.revision;persist();renderCurrent(kind);reviewSelection=null;$('draft-review').hidden=true;
  notice('Reviewed current revision adopted; your complete working input is preserved. Save explicitly after composing it.');
}));
window.addEventListener('beforeunload',event=>{if(storageIssue){event.preventDefault();event.returnValue='';}});

for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
  for (const panel of document.querySelectorAll('.tab')) panel.hidden = panel.id !== tab.dataset.tab;
  for (const other of document.querySelectorAll('[data-tab]')) other.classList.toggle('active', other === tab);
  if (tab.dataset.tab === 'events') run(() => readEvents(true));
});
$('refresh').addEventListener('click', () => run(refresh));
$('new-source').addEventListener('click', () => run(() => loadSource())); $('new-feed').addEventListener('click', () => run(() => loadFeed()));
$('add-field').addEventListener('click', () => { if (busy) return; projectionRow(); try { capture('feed'); } catch(error) { notice(error.message,true); } });
$('source-form').addEventListener('submit', event => { event.preventDefault(); run(() => saveDraft('source')); });
$('feed-form').addEventListener('submit', event => { event.preventDefault(); run(() => saveDraft('feed')); });
$('events-first').addEventListener('click', () => run(() => readEvents(true))); $('events-next').addEventListener('click', () => run(() => readEvents()));
$('events-source').addEventListener('change', () => run(() => readEvents(true)));
$('preview-start').addEventListener('click', () => run(() => readPreview(true))); $('preview-next').addEventListener('click', () => run(() => readPreview(false)));
$('preview-export').addEventListener('click', () => { if (preview) download(preview.feedId + '-page.json', JSON.stringify(preview, null, 2) + '\n'); });
$('plan-form').addEventListener('submit', event => { event.preventDefault(); run(() => saveDraft('plan')); });
$('plan-terms-form').addEventListener('submit', event => { event.preventDefault(); run(() => {
  const form=event.currentTarget, payment={scheme:'exact',network:formValue(form,'network'),amount:formValue(form,'amount'),asset:formValue(form,'asset'),payTo:formValue(form,'payTo'),maxTimeoutSeconds:Number(formValue(form,'maxTimeoutSeconds'))};
  capture('plan'); checkpoint('Before replacing plan draft with common terms');
  currentDraft('plan').fields={text:JSON.stringify({schema:'stellar-forge.webhook-feed-merchant.v1',publicOrigin:formValue(form,'publicOrigin').replace(/\/$/,''),feeds:[...$('plan-feeds').selectedOptions].map(option=>({feedId:option.value,payment}))},null,2)};
  persist(); renderCurrent('plan'); notice('Common terms prepared in the full plan draft. Review before saving.');
}); });
$('release-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api('/api/release', { name: formValue(event.currentTarget, 'name') });
  const output = $('release-output'); output.replaceChildren(element('p', 'Prepared: ' + result.directory, 'mono'));
  const actions = element('div', undefined, 'item-actions');
  for (const [name, content] of Object.entries(result.downloads)) actions.append(button('Download ' + name, () => download(name, content, name.endsWith('.mjs') ? 'text/javascript' : 'application/json')));
  output.append(actions); notice('Deployment files prepared with the selected feed revisions.');
}); });
$('snapshot-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api('/api/snapshot', { name: formValue(event.currentTarget, 'name') }); await refresh();
  notice('Snapshot saved through sequence ' + result.highWatermark + '. Download both files to keep a portable copy.');
}); });
$('retention-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const form = event.currentTarget;
  if (!form.elements.confirmed.checked) throw new Error('RETENTION_REVIEW_REQUIRED');
  const result = await api('/api/retention', { throughSequence: Number(formValue(form, 'throughSequence')), expectedHighWatermark: state.highWatermark });
  await refresh(); form.reset(); notice('Removed ' + result.deleted + ' event bodies. Delivery identities are retained.');
}); });
if (!token) notice('Open the complete private workspace URL printed by the merchant command.', true);
else run(async () => { await refresh(); startWorking(); loadSource(); loadFeed(); loadPlan(); renderWorkingList(); });
