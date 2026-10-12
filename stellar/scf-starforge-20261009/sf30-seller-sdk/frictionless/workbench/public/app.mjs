// SPDX-License-Identifier: MIT
// Complete source authoring around the original publisher host and native records.
import {publisherHost} from '/app.mjs';
const PREFIX='/api/frictionless-source';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const tabs=[['capture','1 · Source inputs'],['resources','2 · Resources'],['mapping','3 · Source editions'],['review','4 · Review and select'],['publisher','5 · Publication plan'],['compare','Compare captures'],['export','Source receiving'],['requests','Requests']];
const defaults={tab:'capture',input:'current',intakeLabel:'',captureId:'',resource:'',resourceOffset:0,fileOffset:0,
 queryName:'',queriesText:'{}',editionLabel:'',editionId:'',reviewId:'',reviewer:'',reviewNote:'',
 planQuery:'',planText:'',planEditionId:'',before:'',after:'',comparisonLabel:'',comparisonId:'',exportLabel:'',exportId:'',requestId:'',
 capturesOffset:0,editionsOffset:0,operationsOffset:0};
const state={native:null,workspaceId:null,draft:{...defaults},current:null,input:null,capture:null,resource:null,files:null,edition:null,review:null,
 comparison:null,operation:null,history:[],busy:0,loading:0,watch:null,epoch:0,storage:null,error:null,notice:'',saveTimer:null};
function node(tag,text,attrs={}){
 const n=document.createElement(tag);if(text!==null&&text!==undefined)n.textContent=String(text);
 for(const[k,v]of Object.entries(attrs)){if(v===undefined||v===null)continue;if(k==='class')n.className=v;else if(k==='disabled')n.disabled=Boolean(v);else if(k==='value')n.value=String(v);else n.setAttribute(k,String(v));}
 return n;
}
const mount=node('section',null,{id:'frictionless-source-workbench','aria-label':'Frictionless source workbench'});
mount.innerHTML='<div class="fw-heading"><div><p class="fw-kicker">FRICTIONLESS DATA PACKAGE / SOURCE WORKBENCH</p><h2>Retain a source. Review its meaning. Publish an edition.</h2><p class="fw-lead">The original package, field decisions and review remain attached to each saved source. Publication continues in the existing publisher below.</p></div><div class="fw-heading-actions"><button type="button" data-top="refresh">Refresh source status</button><a href="#configuration">Original publisher</a></div></div><div class="fw-summary"></div><div class="fw-alert" role="status" aria-live="polite" hidden></div><nav class="fw-tabs" aria-label="Source workflow"></nav><div class="fw-body"></div>';
(document.querySelector('main')??document.body).prepend(mount);
const box=selector=>mount.querySelector(selector);
const body=()=>box('.fw-body');
const title=(heading,paragraph)=>{const div=node('div',null,{class:'fw-section-heading'});div.append(node('h3',heading));if(paragraph)div.append(node('p',paragraph));return div;};
const note=text=>node('p',text,{class:'fw-note'});
const actions=(...children)=>{const div=node('div',null,{class:'fw-actions'});div.append(...children);return div;};
const pretty=value=>JSON.stringify(value,null,2);
const human=error=>(error?.code?error.code+' · ':'')+(error?.message??String(error));
const short=value=>value?String(value).slice(0,12)+'…':'—';
const moment=value=>value?new Date(value).toLocaleString():'—';
const metric=(label,value)=>{const n=node('div',null,{class:'fw-metric'});n.append(node('span',label),node('strong',value));return n;};
function button(label,work,{primary=false,disabled=false,id}={}){
 const b=node('button',label,{type:'button',class:primary?'fw-primary':undefined,disabled,id});
 b.addEventListener('click',()=>task(work));return b;
}
function detail(label,value,{open=false}={}){
 const d=node('details');d.open=open;d.append(node('summary',label),node('pre',typeof value==='string'?value:pretty(value),{class:'fw-code'}));return d;
}
function input(label,key,{type='text',maxLength=240,placeholder='',help='',onChange,rows=8}={}){
 const outer=node('label',null,{class:'fw-field'});outer.append(node('span',label));
 const control=node(type==='textarea'?'textarea':'input',null,{type:type==='textarea'?undefined:type,value:state.draft[key]??'',maxlength:maxLength,placeholder,rows:type==='textarea'?rows:undefined,'data-draft':key});
 control.addEventListener('input',()=>{state.draft[key]=control.value;scheduleDraft();onChange?.(control.value);});
 outer.append(control);if(help)outer.append(node('small',help));return outer;
}
function select(label,options,value,onChange,{empty='Choose…',disabled=false}={}){
 const outer=node('label',null,{class:'fw-field'});outer.append(node('span',label));
 const control=node('select',null,{disabled});
 if(empty!==null)control.append(node('option',empty,{value:''}));
 for(const o of options){const [id,text]=Array.isArray(o)?o:[o,o];control.append(node('option',text,{value:id}));}
 control.value=value??'';
 control.addEventListener('change',()=>task(()=>onChange(control.value)));
 outer.append(control);return outer;
}
function grid(...children){const n=node('div',null,{class:'fw-grid'});n.append(...children);return n;}
function table(headers,rows){
 const wrap=node('div',null,{class:'fw-table-wrap'}),t=node('table'),head=node('thead'),tr=node('tr'),tbody=node('tbody');
 headers.forEach(h=>tr.append(node('th',h,{scope:'col'})));head.append(tr);
 for(const values of rows){const row=node('tr');for(const value of values){const cell=node('td');cell.append(value instanceof Node?value:node('span',value??'—'));row.append(cell);}tbody.append(row);}
 if(!rows.length){const row=node('tr');row.append(node('td','No retained records in this page.',{colspan:headers.length,class:'fw-muted'}));tbody.append(row);}
 t.append(head,tbody);wrap.append(t);return wrap;
}
function pager(page,change,label='Records'){
 return actions(node('span',page.total?String(page.offset+1)+'–'+String(Math.min(page.offset+page.items.length,page.total))+' of '+page.total:'No records',{class:'fw-muted'}),
  button('Previous',()=>change(Math.max(0,page.offset-page.limit)),{disabled:page.offset===0}),
  button('Next',()=>change(page.next),{disabled:page.next===null}));
}
function fileLink(kind,id,name,label=name){
 const q=new URLSearchParams({kind,id,name});
 return node('a',label,{href:PREFIX+'/file?'+q,download:'',class:'fw-file'});
}
function alert(message,error=false){state.notice=message;state.error=error?message:null;renderNotice();}
function renderNotice(){
 const target=box('.fw-alert'),text=state.error??state.notice;
 target.hidden=!text;target.textContent=text??'';target.classList.toggle('fw-error',Boolean(state.error));
}
async function api(route,{query,body:payload,signal,exactText}={}){
 const qs=query?new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])):null;
 const headers={accept:'application/json'},options={method:payload===undefined&&exactText===undefined?'GET':'POST',headers,signal,cache:'no-store'};
 if(options.method==='POST'){headers['content-type']='application/json';headers['x-frictionless-source-workspace']=state.workspaceId;options.body=exactText??JSON.stringify(payload);}
 const response=await fetch(PREFIX+route+(qs?'?'+qs:''),options);let value;
 try{value=await response.json();}catch{throw Object.assign(new Error('The original source response could not be read. Inspect the retained request before retrying.'),{status:response.status,code:'FRICTIONLESS_RESPONSE_INVALID'});}
 if(!response.ok)throw Object.assign(new Error(value.message??'The original source action returned an error.'),{status:response.status,code:value.error??'FRICTIONLESS_HTTP_ERROR'});
 return value;
}
async function openStorage(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('starforge-frictionless-source-workbench',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('drafts',{keyPath:'workspaceId'});db.createObjectStore('requests',{keyPath:'key'});
   const history=db.createObjectStore('history',{keyPath:'key'});history.createIndex('workspaceId','workspaceId');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('Private browser request storage is unavailable.'));
 });
}
async function storageRead(store,key){const db=await state.storage;return new Promise((resolve,reject)=>{const r=db.transaction(store,'readonly').objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function saveDraft(){
 if(!state.workspaceId)return;clearTimeout(state.saveTimer);
 const db=await state.storage,value={workspaceId:state.workspaceId,draft:structuredClone(state.draft)};
 await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Source draft was not saved.'));});
}
function scheduleDraft(){clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>saveDraft().catch(e=>alert('Draft storage: '+human(e),true)),160);}
async function saveRequest(id,patch){
 const db=await state.storage,key=state.workspaceId+':'+id;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['requests','history'],'readwrite'),records=tx.objectStore('requests');let result;
  const get=records.get(key);get.onerror=()=>reject(get.error);
  get.onsuccess=()=>{
   const old=get.result??{key,workspaceId:state.workspaceId,id,createdAt:new Date().toISOString()};
   if(old.payloadText&&patch.payloadText&&old.payloadText!==patch.payloadText){tx.abort();return;}
   let next={...old,...patch,key,workspaceId:state.workspaceId,id,updatedAt:new Date().toISOString()};
   // A late failed response never erases a native success observed by another tab.
   if(old.operation?.state==='COMPLETE'&&patch.operation?.state!=='COMPLETE')next={...next,operation:old.operation,phase:'COMPLETE'};
   else if(old.operation?.updatedAt&&patch.operation?.updatedAt&&old.operation.updatedAt>patch.operation.updatedAt)next={...next,operation:old.operation,phase:old.phase};
   records.put(next);
   tx.objectStore('history').put({key,workspaceId:state.workspaceId,id,createdAt:next.createdAt,updatedAt:next.updatedAt,kind:next.kind,phase:next.phase,
    nativeState:next.operation?.state??null,label:next.label??next.kind,lastCheck:next.lastCheck??null});
   result=next;
  };
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The original retained request input differs or could not be saved.'));
 });
}
async function localHistory(){
 const db=await state.storage;return new Promise((resolve,reject)=>{
  const r=db.transaction('history','readonly').objectStore('history').index('workspaceId').getAll(state.workspaceId);
  r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));r.onerror=()=>reject(r.error);
 });
}
const unknown=r=>['PREPARED','SENDING','UNKNOWN','RETURNED_ERROR'].includes(r.phase);
function sourceBusy(){return Boolean(state.native?.active)||state.history.some(r=>unknown(r)||r.nativeState==='RUNNING')||state.busy>0;}
async function task(fn){
 state.busy++;renderChrome();try{await fn();}catch(e){alert(human(e),true);}finally{state.busy--;renderChrome();}
}
async function refresh(){
 const native=await api('/status',{query:{limit:25,capturesOffset:state.draft.capturesOffset,editionsOffset:state.draft.editionsOffset,operationsOffset:state.draft.operationsOffset}});
 if(state.workspaceId&&state.workspaceId!==native.workspaceId)throw new Error('This listener now belongs to another source workspace. Reload to select it explicitly.');
 if(!UUID.test(native.workspaceId??''))throw new Error('The source workbench did not return its persistent identity.');
 state.native=native;state.workspaceId=native.workspaceId;
 state.history=await localHistory();renderChrome();
}
async function setTab(tab){if(!tabs.some(([key])=>key===tab))return;state.draft.tab=tab;await saveDraft();await loadView();render();}
async function loadView(){
 const epoch=++state.epoch,d=state.draft;
 if(d.tab==='resources'&&d.captureId){
  const [capture,files]=await Promise.all([api('/capture',{query:{id:d.captureId,section:'overview',offset:d.resourceOffset,limit:25}}),
   api('/capture',{query:{id:d.captureId,section:'files',offset:d.fileOffset,limit:25}})]);
  if(epoch!==state.epoch)return;state.capture=capture;state.files=files;
  if(d.resource){const resource=await api('/capture',{query:{id:d.captureId,section:'resource',resource:d.resource}});if(epoch===state.epoch)state.resource=resource;}
 }else if(['mapping','review','publisher','export'].includes(d.tab)&&d.editionId){
  const edition=await api('/edition',{query:{id:d.editionId}});if(epoch!==state.epoch)return;state.edition=edition;
  if(d.reviewId&&d.tab==='review'){const review=await api('/review',{query:{id:d.reviewId}});if(epoch===state.epoch)state.review=review;}
 }else if(d.tab==='compare'&&d.comparisonId){const value=await api('/comparison',{query:{id:d.comparisonId}});if(epoch===state.epoch)state.comparison=value;}
 else if(d.tab==='requests'&&d.requestId){const saved=await storageRead('requests',state.workspaceId+':'+d.requestId);if(epoch===state.epoch)state.operation=saved??null;}
 if(d.tab==='export'&&d.exportId){const value=await api('/request',{query:{id:d.exportId}});if(epoch===state.epoch)state.operation={operation:value};}
}
async function openCapture(id,{mapping=false}={}){
 state.draft.captureId=id;state.draft.resource='';state.draft.resourceOffset=0;state.draft.fileOffset=0;state.resource=null;
 if(mapping){const result=await api('/capture',{query:{id,section:'queries'}});
  if(result.queriesText){state.draft.queriesText=result.queriesText;state.draft.queryName=Object.keys(JSON.parse(result.queriesText))[0]??'';}
  else if(result.queries){state.draft.queriesText=pretty(result.queries);state.draft.queryName=Object.keys(result.queries)[0]??'';}
  else{state.draft.queriesText='{}';state.draft.queryName='';alert('The source is retained. Review its original schema and author an explicit query projection.');}
  state.draft.editionId='';state.draft.reviewId='';state.edition=null;state.review=null;
  state.draft.editionLabel=(result.capture?.label??'Source')+' reviewed projection';
 }
 await setTab(mapping?'mapping':'resources');
}
async function openEdition(id,{clone=false}={}){
 const result=await api('/edition',{query:{id}});state.edition=result;state.draft.editionId=id;state.draft.captureId=result.edition.captureId;
 state.draft.reviewId=result.edition.reviews.find(x=>x.ready)?.id??'';state.review=null;
 if(clone){
  if(typeof result.queriesText!=='string')throw new Error('The original source query text is unavailable; download its exact source file instead of reconstructing it.');
  state.draft.queriesText=result.queriesText;state.draft.queryName=Object.keys(JSON.parse(result.queriesText))[0]??'';
  state.draft.editionLabel=result.edition.label+' revision';await setTab('mapping');
 }else await setTab('review');
}
async function adoptOperation(operation){
 if(operation.state!=='COMPLETE')return;
 const result=operation.result;
 if(operation.kind==='intake'){state.draft.captureId=result.captureId;state.draft.resourceOffset=0;state.draft.fileOffset=0;}
 if(operation.kind==='edition'){state.draft.editionId=result.editionId;state.edition=await api('/edition',{query:{id:result.editionId}});}
 if(operation.kind==='review'){state.draft.reviewId=result.reviewId;state.review=await api('/review',{query:{id:result.reviewId}});
  state.edition=await api('/edition',{query:{id:result.editionId}});}
 if(operation.kind==='select')state.current=await api('/current');
 if(operation.kind==='compare'){state.draft.comparisonId=result.comparisonId;state.comparison=await api('/comparison',{query:{id:result.comparisonId}});}
 if(operation.kind==='export')state.draft.exportId=operation.id;
 await saveDraft();if(['select','plan'].includes(operation.kind))await publisherHost.refresh();
}
async function retainOutcome(id,operation){
 const saved=await saveRequest(id,{kind:operation.kind,operation,phase:operation.state,lastCheck:{status:200,at:new Date().toISOString()},error:null});
 state.operation=saved;state.draft.requestId=id;await saveDraft();state.history=await localHistory();renderChrome();return saved;
}
async function watchRequest(id){
 state.watch?.abort();const controller=new AbortController();state.watch=controller;renderChrome();
 try{
  for(;;){
   const operation=await api('/request',{query:{id},signal:controller.signal});await retainOutcome(id,operation);
   if(operation.state!=='RUNNING'){
    await refresh();alert(operation.state==='COMPLETE'?'Original '+operation.kind+' request completed.':operation.state+' · '+(operation.error?.message??'Inspect the original request.'));
    // Native outcome was committed above before any derived view can fail.
    await adoptOperation(operation);render();return;
   }
   renderRequestProgress();
   await new Promise((resolve,reject)=>{const timer=setTimeout(done,650);function done(){controller.signal.removeEventListener('abort',abort);resolve();}
    function abort(){clearTimeout(timer);controller.signal.removeEventListener('abort',abort);reject(controller.signal.reason);}
    controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
  }
 }catch(e){if(!controller.signal.aborted)throw e;}
 finally{if(state.watch===controller)state.watch=null;renderChrome();}
}
async function dispatchSaved(saved){
 await saveRequest(saved.id,{phase:'SENDING'});state.history=await localHistory();renderChrome();
 let reply;
 try{reply=await api('/'+saved.kind,{exactText:saved.payloadText});}
 catch(e){await saveRequest(saved.id,{phase:e.status?'RETURNED_ERROR':'UNKNOWN',error:{code:e.code??'NETWORK',message:e.message,status:e.status??null}});
  state.history=await localHistory();state.draft.requestId=saved.id;await saveDraft();
  alert(human(e)+' The exact request is saved. Inspect it in Requests before retrying.',true);render();return;}
 if(!reply?.operation||reply.operation.id!==saved.id)throw new Error('The source response did not identify this saved request; inspect its original UUID.');
 const retained=await retainOutcome(saved.id,reply.operation);
 if(reply.operation.state==='RUNNING'){await watchRequest(saved.id);return;}
 await refresh();alert('Original '+saved.kind+' request returned '+reply.operation.state+'.');
 await adoptOperation(retained.operation);render();
}
async function mutate(kind,value,{cancel=false}={}){
 for(const key of ['label','reviewer','note'])if(value[key]!==undefined&&(typeof value[key]!=='string'||!value[key].trim()))throw new Error('Enter the '+key+' before submitting this source action.');
 if(kind==='edition')JSON.parse(value.queriesText);
 await saveDraft();state.history=await localHistory();
 if(!cancel&&(state.native.active||state.history.some(r=>unknown(r)||r.nativeState==='RUNNING')))throw new Error('Inspect or finish the existing source request before a new change.');
 const id=crypto.randomUUID(),payload={workspaceId:state.workspaceId,requestId:id,...(cancel?{}:{expectedVersion:state.native.version}),...value};
 const payloadText=JSON.stringify(payload);
 if(new TextEncoder().encode(payloadText).length>8*1024*1024)throw new Error('The complete source request exceeds 8 MiB.');
 const saved=await saveRequest(id,{kind,payloadText,label:value.label??kind,phase:'PREPARED'});
 state.draft.requestId=id;state.operation=saved;await saveDraft();await dispatchSaved(saved);
}
async function inspectRequest(id){
 if(!UUID.test(id??''))throw new Error('Enter the original request UUID.');
 const saved=await storageRead('requests',state.workspaceId+':'+id);
 try{const operation=await api('/request',{query:{id}});await retainOutcome(id,operation);alert('Original request: '+operation.state);await refresh();}
 catch(e){
  if(e.status===404&&saved){state.operation=await saveRequest(id,{phase:'NOT_FOUND',lastCheck:{status:404,at:new Date().toISOString()},error:null});
   state.history=await localHistory();alert('No original request exists at this workspace. The exact saved input can be explicitly retried.');}
  else throw e;
 }
 state.draft.requestId=id;await saveDraft();render();
}
async function resumeRequest(id){
 const saved=await storageRead('requests',state.workspaceId+':'+id);
 // This is an explicit continuation of a retained native ID, never a new body.
 const result=await api('/resume',{body:{workspaceId:state.workspaceId,requestId:id}});
 await retainOutcome(id,result.operation);
 if(result.operation.state==='RUNNING')await watchRequest(id);else{await refresh();await adoptOperation(result.operation);render();}
}
function renderChrome(){
 const target=box('.fw-summary');target.replaceChildren();
 if(!state.native){target.append(note('Opening the original source workbench…'));return;}
 target.append(metric('Source captures',state.native.captures.total),metric('Source editions',state.native.editions.total),
  metric('Current source version',state.native.version),metric('Original source request',state.native.active?state.native.active.kind:'Idle'));
 const identity=node('details',null,{class:'fw-identity'});identity.append(node('summary','Source identity'),
  node('p',state.workspaceId,{class:'fw-mono'}),node('p','Latest original publisher selection: '+(state.native.publisher.sourceSelection?.sourceHash??'initial configured source'),{class:'fw-mono'}));
 target.append(identity);
 box('.fw-tabs').replaceChildren(...tabs.map(([id,label])=>{const b=button(label,()=>setTab(id));b.setAttribute('aria-selected',String(state.draft.tab===id));return b;}));
 renderNotice();
 for(const b of mount.querySelectorAll('[data-mutation]'))b.disabled=sourceBusy();
 renderRequestProgress();
}
function renderRequestProgress(){
 const area=mount.querySelector('.fw-live-request');if(!area)return;area.replaceChildren();
 const op=state.operation?.operation,active=state.native?.active;
 if(op)area.append(node('strong',op.kind+' · '+op.state),node('span',op.stage?.phase??'',{class:'fw-muted'}));
 else if(active)area.append(node('strong',active.kind+' · RUNNING'),node('span',active.stage?.phase??'',{class:'fw-muted'}));
 const id=op?.state==='RUNNING'?op.id:active?.id;
 if(id){area.append(button(state.watch?'Stop observing':'Watch original request',()=>state.watch?(state.watch.abort(),Promise.resolve()):watchRequest(id)));
  area.append(button('Cancel original source work',()=>mutate('cancel',{operationId:id},{cancel:true})));}
}
function mutationButton(label,fn){const b=button(label,fn,{primary:true,disabled:sourceBusy()});b.dataset.mutation='true';return b;}
function render(){if(!state.native)return;body().replaceChildren();renderChrome();
 const live=node('div',null,{class:'fw-live-request',role:'status'});body().append(live);renderRequestProgress();
 const views={capture:renderCapture,resources:renderResources,mapping:renderMapping,review:renderReview,publisher:renderPublisher,compare:renderCompare,export:renderExport,requests:renderRequests};
 views[state.draft.tab]();renderChrome();
}

function capturePicker(onChange,key='captureId'){
 const choices=state.native.captures.items.map(c=>[c.id,c.label+' · '+short(c.captureSha256)]);
 return select('Retained capture',choices,state.draft[key],onChange);
}
function editionPicker(onChange){
 const choices=state.native.editions.items.map(e=>[e.id,e.label+' · '+short(e.sourceHash)]);
 if(state.edition&&!choices.some(([id])=>id===state.edition.edition.id))choices.unshift([state.edition.edition.id,state.edition.edition.label]);
 return select('Immutable source edition',choices,state.draft.editionId,onChange);
}
function catalogCaptures(){
 const page=state.native.captures;
 return [table(['Capture','Original source','Resources / files','Retained','Open'],page.items.map(c=>[
  node('strong',c.label),detail(short(c.captureSha256),c.captureSha256),c.resources+' / '+c.files,moment(c.createdAt),
  actions(button('Resources',()=>openCapture(c.id)),button('New projection',()=>openCapture(c.id,{mapping:true})))
 ])),pager(page,async offset=>{state.draft.capturesOffset=offset;await saveDraft();await refresh();render();})];
}
function catalogEditions(){
 const page=state.native.editions;
 return [table(['Source edition','Queries','Native review','Created','Open'],page.items.map(e=>[
  node('strong',e.label),e.queries.join(', '),e.reviews.some(r=>r.ready)?'Full review passed':'Draft / review required',moment(e.createdAt),
  actions(button('Review',()=>openEdition(e.id)),button('Use as new draft',()=>openEdition(e.id,{clone:true})))
 ])),pager(page,async offset=>{state.draft.editionsOffset=offset;await saveDraft();await refresh();render();})];
}
function renderCapture(){
 body().append(title('Choose the original source','Select a host-declared descriptor or complete source archive. “Current publisher source” retains the currently selected source through the original export and receiving path.'));
 const choices=state.native.inputs.map(v=>[v.input,v.label+' · '+v.kind]);
 body().append(grid(select('Source input',choices,state.draft.input,async value=>{
  state.draft.input=value;state.input=null;await saveDraft();render();},{empty:null}),
  input('Capture label','intakeLabel',{maxLength:160,placeholder:'Monthly observations / edition label'})));
 body().append(actions(button('Inspect selected input',async()=>{
  state.input=await api('/input',{query:{input:state.draft.input}});alert('Input identity read. Review it before starting an intake.');render();
 })));
 if(state.input&&state.input.input===state.draft.input){
  body().append(detail('Inspected source identity',state.input,{open:true}));
  body().append(mutationButton(state.input.kind==='current'?'Retain current original source':state.input.kind==='source-archive'?'Receive original source archive':'Capture declared source package',
   ()=>mutate('intake',{input:state.draft.input,label:state.draft.intakeLabel,...(state.input.expectedSha256Required?{expectedSha256:state.input.sha256}:{})})));
  if(state.input.kind==='descriptor')body().append(note('This explicit action captures a new source edition. Its original files, descriptor, selected references and retrieval metadata remain unchanged after capture.'));
 }
 body().append(title('Retained captures','Open resources to inspect source fields, constraints, missing markers, rights and complete original files.'));
 body().append(...catalogCaptures());
 if(state.draft.captureId)body().append(actions(button('Open selected capture',()=>openCapture(state.draft.captureId))));
}
function renderResources(){
 body().append(title('Inspect complete native resources','The existing Frictionless parser reviews the original resource bytes. A source problem remains visible until an explicit projection or source correction resolves it.'));
 body().append(capturePicker(id=>openCapture(id)));
 if(!state.draft.captureId){body().append(note('Select a retained capture.'));return;}
 const value=state.capture;
 if(!value||value.capture.id!==state.draft.captureId){body().append(button('Load selected capture',()=>openCapture(state.draft.captureId)));return;}
 body().append(grid(metric('Source label',value.capture.label),metric('Captured resources',value.capture.resources),metric('Original files',value.capture.files),
  metric('Captured bytes',value.capture.bytes.toLocaleString())));
 body().append(actions(fileLink('capture',value.capture.id,'capture.json','Original capture manifest'),
  fileLink('capture',value.capture.id,'inspection.json','Complete native resource inspection'),
  button('Start a new projection from suggestions',()=>openCapture(value.capture.id,{mapping:true}))));
 if(value.inspectionError)body().append(detail('Native source finding',value.inspectionError,{open:true}));
 body().append(detail('Original package / rights / references',{package:value.package,references:value.references}));
 body().append(table(['Resource','Format','Native state','Rows reviewed','Inspect'],value.resources.items.map(r=>[
  r.name,r.format??'Declared by original resource',r.state,r.rows===null?(r.rowsRead??0)+' read before finding':r.rows,
  button('Fields and constraints',async()=>{state.draft.resource=r.name;state.resource=await api('/capture',{query:{id:value.capture.id,section:'resource',resource:r.name}});await saveDraft();render();})
 ])),pager(value.resources,async offset=>{state.draft.resourceOffset=offset;await saveDraft();await loadView();render();},'Resources'));
 if(state.resource?.capture.id===value.capture.id){
  const raw=state.resource.resource,native=state.resource.inspection;
  body().append(title(raw.name,'Original native field declarations and review findings'));
  if(native?.error)body().append(detail('Source finding',native.error,{open:true}));
  const fields=Object.entries(native?.fields??Object.fromEntries((raw.schema?.fields??[]).map(f=>[f.name,{declared:f}])));
  body().append(table(['Original field','Declared type / format','Missing markers','Missing / empty','Maximum characters','Constraints / mapping'],fields.map(([name,f])=>[
   name,(f.declared?.type??'any')+(f.declared?.format?' / '+f.declared.format:''),
   pretty(f.missingValues??raw.schema?.missingValues??[]),(f.missing??'—')+' / '+(f.empty??'—'),f.maxChars??'—',
   detail('Original declaration',f.declared)
  ])));
  body().append(detail('Original schema, dialect and physical representation',{schema:raw.schema,dialect:raw.dialect,descriptor:raw.descriptor,
   physical:native?.physical??null,keys:native?.keys??[],review:native?.review??[],licenses:state.resource.licenses,references:state.resource.references}));
 }
 body().append(title('Every retained source file','Downloads are bound to the original capture declaration. The manifest identifies descriptors, schemas, references and resource members.'));
 const files=state.files;if(files?.capture.id===value.capture.id){
  body().append(table(['Original file','Bytes','SHA-256','Download'],files.items.map(f=>[
   f.name,f.bytes.toLocaleString(),detail(short(f.sha256),f.sha256),fileLink('capture',value.capture.id,f.name)
  ])),pager(files,async offset=>{state.draft.fileOffset=offset;await saveDraft();await loadView();render();},'Files'));
 }
}
function parseQueries(){
 const value=JSON.parse(state.draft.queriesText);
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Query declarations must be one JSON object.');
 return value;
}
function safeStructured(value){
 if(typeof value==='number')return Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value));
 if(Array.isArray(value))return value.every(safeStructured);
 return !value||typeof value!=='object'||Object.values(value).every(safeStructured);
}
function replaceQueries(queries){
 state.draft.queriesText=pretty(queries);scheduleDraft();render();
}
function queryChange(change){
 const queries=parseQueries();if(!safeStructured(queries))throw new Error('Keep this original query JSON in text mode; its large numeric constraints must not pass through browser numbers.');
 change(queries);replaceQueries(queries);
}
function moveObject(object,key,delta){const entries=Object.entries(object),from=entries.findIndex(([name])=>name===key),to=from+delta;
 if(from<0||to<0||to>=entries.length)return object;[entries[from],entries[to]]=[entries[to],entries[from]];return Object.fromEntries(entries);}
function projectionBuilder(queries){
 const area=node('section',null,{class:'fw-inset'}),keys=Object.keys(queries),selected=state.draft.queryName;
 area.append(title('Ordered query projection','Aliases follow the original query-name rule. Physical text and literal missing markers preserve the source representation; any conversion is reviewed by the native parser.'));
 if(!safeStructured(queries)){
  area.append(note('This source includes numeric constraints outside the browser exact-integer range. Keep its exact query text below; visual remapping is disabled to preserve the original tokens.'));return area;
 }
 area.append(select('Query',keys,selected,async name=>{state.draft.queryName=name;await saveDraft();render();}));
 const query=queries[selected];
 if(!query){area.append(note('Choose a query or add a declaration in the full JSON editor.'));return area;}
 const nameInput=node('input',null,{value:selected,maxlength:48,'aria-label':'Query name'});
 const resourceInput=node('input',null,{value:query.resource??'','aria-label':'Captured resource name'});
 area.append(grid(fieldElement('Query name',nameInput),fieldElement('Captured resource',resourceInput)));
 area.append(actions(button('Apply query name / resource',()=>queryChange(all=>{
  const next=nameInput.value;
  if(!NAME.test(next)||['constructor','prototype','__proto__'].includes(next)||next!==selected&&Object.hasOwn(all,next))throw new Error('Use a distinct query name matching the original name rule.');
  const entries=Object.entries(all).map(([key,value])=>[key===selected?next:key,key===selected?{...value,resource:resourceInput.value}:value]);
  for(const key of Object.keys(all))delete all[key];for(const[key,value]of entries)all[key]=value;state.draft.queryName=next;
 })),
 button('Move query up',()=>queryChange(all=>{const moved=moveObject(all,selected,-1);for(const key of Object.keys(all))delete all[key];Object.assign(all,moved);})),
 button('Move query down',()=>queryChange(all=>{const moved=moveObject(all,selected,1);for(const key of Object.keys(all))delete all[key];Object.assign(all,moved);}))));
 const projection=query.projection??{},rows=[];
 for(const [alias,spec]of Object.entries(projection)){
  const aliasInput=node('input',null,{value:alias,maxlength:48,'aria-label':'Public alias '+alias});
  const originalInput=node('input',null,{value:spec.field??'','aria-label':'Original field '+alias});
  const type=node('select',null,{'aria-label':'Type '+alias}),missing=node('select',null,{'aria-label':'Missing values '+alias}),representation=node('select',null,{'aria-label':'Representation '+alias});
  for(const value of ['string','integer','number','boolean'])type.append(node('option',value,{value}));type.value=spec.type??'string';
  for(const value of ['literal','null','reject'])missing.append(node('option',value,{value}));missing.value=spec.missing??'literal';
  for(const value of ['physical','logical'])representation.append(node('option',value,{value}));representation.value=spec.representation??'physical';
  const apply=()=>queryChange(all=>{
   const next=aliasInput.value;if(!NAME.test(next)||['constructor','prototype','__proto__'].includes(next)||next!==alias&&Object.hasOwn(all[selected].projection,next))throw new Error('Use a distinct original-rule public alias.');
   all[selected].projection=Object.fromEntries(Object.entries(all[selected].projection).map(([key,value])=>key===alias?[next,{...value,field:originalInput.value,type:type.value,missing:missing.value,representation:representation.value}]:[key,value]));
  });
  rows.push([aliasInput,originalInput,type,missing,representation,actions(button('Apply',apply),
   button('↑',()=>queryChange(all=>{all[selected].projection=moveObject(all[selected].projection,alias,-1);})),
   button('↓',()=>queryChange(all=>{all[selected].projection=moveObject(all[selected].projection,alias,1);})),
   button('Remove',()=>queryChange(all=>{delete all[selected].projection[alias];})))]);
 }
 area.append(table(['Public alias','Original field','Native type','Missing values','Representation','Order / apply'],rows));
 const newAlias=node('input',null,{placeholder:'FieldName',maxlength:48,'aria-label':'New public alias'}),newField=node('input',null,{placeholder:'Exact original field','aria-label':'New original field'});
 area.append(grid(fieldElement('New public alias',newAlias),fieldElement('Original field name',newField)),
  button('Add physical text field',()=>queryChange(all=>{
   const alias=newAlias.value;if(!NAME.test(alias)||Object.hasOwn(all[selected].projection??{},alias)||['constructor','prototype','__proto__'].includes(alias)||!newField.value)throw new Error('Choose a distinct alias and an original captured field name.');
   all[selected].projection={...(all[selected].projection??{}),[alias]:{field:newField.value,type:'string',missing:'literal',representation:'physical'}};
  })));
 area.append(detail('Current original query metadata',{resource:query.resource,dialect:query.dialect??null,schemaOverride:query.schemaOverride??null,schemaReview:query.schemaReview??null}));
 area.append(note('A schema override requires schemaReview.reason and exact URLs already retained in capture.references. Edit those original fields in the complete JSON text below. CSV dialect overrides remain the original parser contract; they do not apply to Parquet.'));
 return area;
}
function fieldElement(label,control){const outer=node('label',null,{class:'fw-field'});outer.append(node('span',label),control);return outer;}
function renderMapping(){
 body().append(title('Author an immutable source edition','A saved edition binds the exact original capture and ordered query declarations. Draft edits create a new edition; they do not alter an earlier source.'));
 body().append(capturePicker(id=>openCapture(id,{mapping:true})));
 if(!state.draft.captureId){body().append(note('Retain a source capture, then start from its original suggested or imported query declarations.'));return;}
 body().append(input('Source edition label','editionLabel',{maxLength:160,placeholder:'Reviewed monthly source'}));
 let queries,error;try{queries=parseQueries();}catch(e){error=e;}
 if(queries)body().append(projectionBuilder(queries));else body().append(note('The query text is not yet valid JSON: '+error.message));
 const editor=input('Complete original query JSON','queriesText',{type:'textarea',rows:18,maxLength:8*1024*1024,
  help:'The exact text, including numeric tokens and property order, is submitted as queriesText. Existing Python JSON decimal semantics remain unchanged.'});
 editor.querySelector('textarea').spellcheck=false;editor.querySelector('textarea').classList.add('fw-code-editor');body().append(editor);
 body().append(actions(button('Read draft into visual builder',async()=>{const q=parseQueries();state.draft.queryName=Object.hasOwn(q,state.draft.queryName)?state.draft.queryName:Object.keys(q)[0]??'';await saveDraft();render();}),
  button('Add query draft',()=>queryChange(all=>{
   let n=1;while(Object.hasOwn(all,'Resource'+n))n++;const name='Resource'+n;all[name]={resource:state.draft.resource||'',projection:{}};state.draft.queryName=name;
  })),mutationButton('Save immutable source edition',()=>mutate('edition',{captureId:state.draft.captureId,label:state.draft.editionLabel,queriesText:state.draft.queriesText}))));
 body().append(title('Saved source editions','Each entry keeps the original full query text and exact capture digest. Use an earlier edition as a new draft, or reopen its review.'));
 body().append(...catalogEditions());
}
function selectedEdition(){
 const e=state.edition;if(!e||e.edition.id!==state.draft.editionId)return null;return e.edition;
}
function reviewedChoice(edition){
 return select('Original completed review',edition.reviews.filter(r=>r.ready).map(r=>[r.id,r.reviewer+' · '+moment(r.createdAt)]),state.draft.reviewId,
  async id=>{state.draft.reviewId=id;state.review=id?await api('/review',{query:{id}}):null;await saveDraft();render();});
}
function renderReview(){
 body().append(title('Review the complete source, then select it','The native review checks every selected original row, field conversion, constraint and key. A successful review is attached to this exact source hash.'));
 body().append(editionPicker(id=>openEdition(id)));
 const e=selectedEdition();if(!e){body().append(note('Open a saved immutable edition.'));return;}
 body().append(grid(metric('Edition',e.label),metric('Queries',e.queries.length),metric('Retained reviews',e.reviews.length)));
 body().append(detail('Exact source identity',{editionId:e.id,captureId:e.captureId,captureSha256:e.captureSha256,sourceHash:e.sourceHash}),
  actions(fileLink('edition',e.id,'source.json','Original source-edition JSON'),button('Create a new draft from this edition',()=>openEdition(e.id,{clone:true}))));
 body().append(grid(input('Reviewer','reviewer',{maxLength:80}),input('Review note','reviewNote',{type:'textarea',rows:3,maxLength:2000,help:'State the source meaning, missing-value and projection decisions being reviewed.'})),
  mutationButton('Run and retain complete native review',()=>mutate('review',{editionId:e.id,reviewer:state.draft.reviewer,note:state.draft.reviewNote})));
 body().append(table(['Reviewer / retained time','Native review','Queries','Open'],e.reviews.map(r=>[
  r.reviewer+' / '+moment(r.createdAt),r.ready?'Passed every selected resource':'Source review required',r.resources.length,
  button('Open exact review',async()=>{state.draft.reviewId=r.id;state.review=await api('/review',{query:{id:r.id}});await saveDraft();render();})
 ])));
 const r=state.review;
 if(r&&r.editionId===e.id){
  body().append(title(r.ready?'Full native review passed':'Source findings require review',r.note));
  body().append(table(['Query','Resource','Native state','Rows','Finding'],r.inspection.resources.map(resource=>[
   resource.selection,resource.name,resource.state,resource.rows??('Read '+resource.rowsRead),
   resource.error?detail(resource.error.code,resource.error):'None'
  ])),actions(fileLink('review',r.id,'review.json','Download complete original review')),detail('Full original resource / field review',r.inspection));
 }
 body().append(title('Select this reviewed edition','Selection uses the original publisher writer and the exact currently observed source hash. Existing publication plans, candidates and schedules keep their original records.'));
 body().append(reviewedChoice(e),actions(button('Inspect current publisher source',async()=>{state.current=await api('/current');render();})));
 if(state.current){
  body().append(detail('Currently observed publisher source',{sourceHash:state.current.sourceHash,captureSha256:state.current.captureSha256,selection:state.current.selection,observedAt:state.current.observedAt}));
  if(state.current.sourceHash===e.sourceHash)body().append(note('This exact source edition is currently selected. You can now save its reviewed publication plan.'));
  else body().append(mutationButton('Select this fully reviewed source',()=>{
   if(!state.draft.reviewId)throw new Error('Select a completed native review for this exact edition.');
   return mutate('select',{editionId:e.id,reviewId:state.draft.reviewId,expectedSourceHash:state.current.sourceHash});
  }));
 }
 body().append(actions(button('Publication plan',()=>setTab('publisher'))));
}
function renderPublisher(){
 body().append(title('Save an original publication plan','The workbench supplies the existing Frictionless plan template. The original publisher owns extraction, candidate review, publication, scheduling, release and customer receiving.'));
 body().append(editionPicker(id=>openEdition(id)),button('Load current source identity',async()=>{state.current=await api('/current');render();}));
 const e=selectedEdition();if(!e){body().append(note('Choose a reviewed source edition.'));return;}
 body().append(reviewedChoice(e),select('Original query',e.queries,state.draft.planQuery,async name=>{state.draft.planQuery=name;await saveDraft();}));
 body().append(button('Load original plan template',async()=>{
  if(!state.draft.planQuery)throw new Error('Choose an original query.');
  const result=await api('/plan-input',{query:{editionId:e.id,query:state.draft.planQuery}});
  state.draft.planText=pretty(result.plan);state.draft.planEditionId=e.id;await saveDraft();render();
 }));
 body().append(input('Complete original publication plan','planText',{type:'textarea',rows:18,maxLength:8*1024*1024,
  help:'Review dataset column types, nullability, extraction order and all row/page/byte limits. Exact identifiers, timestamps and decimals can remain text.'}));
 if(state.current?.sourceHash!==e.sourceHash)body().append(note('Select this exact reviewed source under Review and select, then inspect the current identity here before saving its plan.'));
 const save=mutationButton('Save through original publisher',()=>{
  if(state.draft.planEditionId!==e.id||state.current?.sourceHash!==e.sourceHash||!state.draft.reviewId)throw new Error('Load the plan for this selected edition and choose its completed native review.');
  return mutate('plan',{editionId:e.id,reviewId:state.draft.reviewId,plan:JSON.parse(state.draft.planText)});
 });body().append(save);
 const op=state.operation?.operation;
 if(op?.kind==='plan'&&op.state==='COMPLETE'){
  body().append(detail('Saved original plan',op.result,{open:true}),button('Open this saved plan in original publisher',()=>publisherHost.openPlan(op.result.planId),{primary:true}));
 }
 body().append(actions(button('Open original current-source plan form',()=>publisherHost.newPlan()),
  node('a','Original extraction and candidate review',{href:'#configuration'}),node('a','Original published dataset',{href:'#candidate'})));
}
function renderCompare(){
 body().append(title('Compare original captures','This native comparison shows file, schema, descriptor and dialect changes. It does not claim a row-level difference or a measured environmental outcome.'));
 const ids=state.native.captures.items.map(c=>[c.id,c.label+' · '+short(c.captureSha256)]);
 body().append(grid(select('Before capture',ids,state.draft.before,async id=>{state.draft.before=id;await saveDraft();}),
  select('After capture',ids,state.draft.after,async id=>{state.draft.after=id;await saveDraft();})),
  grid(input('Before capture UUID','before',{maxLength:36,help:'A retained capture from another catalog page can be selected by its original UUID.'}),
   input('After capture UUID','after',{maxLength:36})),
  input('Comparison label','comparisonLabel',{maxLength:160}),
  mutationButton('Retain original capture comparison',()=>mutate('compare',{before:state.draft.before,after:state.draft.after,label:state.draft.comparisonLabel})));
 const comparison=state.comparison;
 if(comparison){
  body().append(title(comparison.label,'Package metadata changed: '+String(comparison.native.packageMetadataChanged)),
   table(['Resource','Data file changed','Schema / dialect','Added / removed fields','Original changes'],comparison.native.resources.map(r=>[
    r.resource,r.change??String(r.dataChanged),(r.schemaChanged??'—')+' / '+(r.dialectChanged??'—'),(r.addedFields??[]).join(', ')+' / '+(r.removedFields??[]).join(', '),
    detail('Complete resource comparison',r)
   ])),actions(fileLink('comparison',comparison.id,'comparison.json','Complete original comparison JSON')));
 }
 body().append(input('Open original comparison UUID','comparisonId',{maxLength:36}),button('Open retained comparison',async()=>{
  state.comparison=await api('/comparison',{query:{id:state.draft.comparisonId}});render();
 }));
}
function exportResult(){const op=state.operation?.operation;return op?.kind==='export'&&op.state==='COMPLETE'?op:null;}
function renderExport(){
 body().append(title('Complete source receiving','Export the original portable source archive with a frozen edition, selection and review history. Publisher datasets and customer warehouses use their existing separate complete handoff tools.'));
 body().append(editionPicker(id=>openEdition(id)));
 const e=selectedEdition();
 if(e){
  body().append(input('Source export label','exportLabel',{maxLength:160,placeholder:e.label+' receiving'}),reviewedChoice(e),
   note('The selected successful review is optional for source transfer. A draft export remains a draft and needs native review before selecting it at a receiving publisher.'),
   mutationButton('Create complete original source export',()=>mutate('export',{editionId:e.id,label:state.draft.exportLabel,...(state.draft.reviewId?{reviewId:state.draft.reviewId}:{})})));
 }
 body().append(grid(input('Completed export request UUID','exportId',{maxLength:36}),button('Open original export',async()=>{
  const operation=await api('/request',{query:{id:state.draft.exportId}});state.operation={operation};await saveDraft();render();
 })));
 const op=exportResult();
 if(!op){body().append(note('Open a completed export to see every original file and its receiving instructions.'));return;}
 const result=op.result;
 body().append(grid(metric('Declared source files',result.files.length),metric('Retained bytes',result.totalBytes.toLocaleString()),metric('Original source',short(result.sourceHash))));
 body().append(detail('Source export identity',{exportId:op.id,workspaceId:result.workspaceId,editionId:result.editionId,sourceHash:result.sourceHash,captureSha256:result.captureSha256,
  manifestSha256:result.manifestFile.sha256}),actions(fileLink('export',op.id,'manifest.json','Complete original file manifest'),
  fileLink('export',op.id,'RECEIVING.md','Start with the receiving guide'),fileLink('export',op.id,'source.tar.gz','Original complete source archive')));
 body().append(table(['Original declared file','Bytes','SHA-256','Download'],[result.manifestFile,...result.files].map(f=>[
  f.name,f.bytes.toLocaleString(),detail(short(f.sha256),f.sha256),fileLink('export',op.id,f.name)
 ])));
 body().append(note('For a complete restartable transfer, use frictionless workbench download with this workspace UUID and export request. The maintained reader retains byte offsets, rechecks every digest, and continues the same files after interruption or owner reopen.'));
}
function renderRequests(){
 body().append(title('Original request recovery','The browser saves the exact input and UUID before dispatch. A page reload never replays a mutation. Inspect a retained request, then explicitly watch, resume or retry it.'));
 body().append(grid(input('Original request UUID','requestId',{maxLength:36}),button('Inspect original request',()=>inspectRequest(state.draft.requestId))));
 if(state.history.some(unknown))body().append(note('An input has an uncertain outcome. Its original request must be inspected before another source change.'));
 body().append(table(['Action / label','Browser state','Native state','Original request','Open'],state.history.map(r=>[
  r.label,r.phase,r.nativeState??'Unobserved',detail(short(r.id),r.id),
  button('Open saved input / result',async()=>{state.operation=await storageRead('requests',r.key);state.draft.requestId=r.id;await saveDraft();render();})
 ])));
 const saved=state.operation,op=saved?.operation;
 if(saved&&saved.id===state.draft.requestId||op?.id===state.draft.requestId){
  const id=saved.id??op.id;
  body().append(title('Selected original request',(saved.kind??op.kind)+' · '+(op?.state??saved.phase)));
  if(saved.payloadText)body().append(detail('Exact original submitted JSON',saved.payloadText));
  if(saved.error)body().append(detail('Original returned / transport error',saved.error,{open:true}));
  if(op)body().append(detail('Complete retained native request and result',op,{open:true}));
  body().append(actions(button('Inspect original request',()=>inspectRequest(id))));
  if(op?.state==='RUNNING')body().append(actions(button('Watch original result',()=>watchRequest(id)),
   button('Cancel original source work',()=>mutate('cancel',{operationId:id},{cancel:true}))));
  if(op&&['PREPARED','INTERRUPTED','FAILED','CANCELLED'].includes(op.state))body().append(button('Resume exact retained native request',()=>resumeRequest(id),{primary:true}));
  if(saved.lastCheck?.status===404&&saved.payloadText)body().append(button('Retry exact saved input / UUID',()=>dispatchSaved(saved),{primary:true}));
  if(op?.state==='COMPLETE'){
   if(op.kind==='intake')body().append(button('Open retained capture',()=>openCapture(op.result.captureId)));
   if(op.kind==='edition'||op.kind==='review'||op.kind==='select')body().append(button('Open exact source edition',()=>openEdition(op.result.editionId)));
   if(op.kind==='plan')body().append(button('Open original saved publication plan',()=>publisherHost.openPlan(op.result.planId)));
   if(op.kind==='export')body().append(button('Open complete source export',async()=>{state.draft.exportId=op.id;await setTab('export');}));
   if(op.kind==='compare')body().append(button('Open original capture comparison',async()=>{state.draft.comparisonId=op.result.comparisonId;await setTab('compare');}));
  }
 }
 body().append(title('Native source request history','This catalog also includes requests created by an agent or another browser. Opening a record is read-only.'));
 const page=state.native.operations;
 body().append(table(['Native action','State','Updated','Request','Inspect'],page.items.map(r=>[
  r.kind,r.state,moment(r.updatedAt),detail(short(r.id),r.id),button('Inspect',()=>inspectRequest(r.id))
 ])),pager(page,async offset=>{state.draft.operationsOffset=offset;await saveDraft();await refresh();render();}));
}
mount.querySelector('[data-top="refresh"]').addEventListener('click',()=>task(async()=>{await refresh();await loadView();render();}));
window.addEventListener('beforeunload',()=>{state.watch?.abort();});
state.storage=openStorage();
await task(async()=>{
 const native=await api('/status');if(!UUID.test(native.workspaceId??''))throw new Error('Missing persistent source-workbench identity.');
 state.workspaceId=native.workspaceId;state.native=native;
 const saved=await storageRead('drafts',state.workspaceId);
 if(saved?.draft)state.draft={...defaults,...saved.draft};
 if(!tabs.some(([id])=>id===state.draft.tab))state.draft.tab='capture';
 await refresh();await loadView();render();
 if(state.history.some(unknown))alert('An exact source input has an unknown response. Open Requests to inspect it; nothing has been replayed.');
 else if(state.native.active)alert('The original source request is still running. Use Watch original request to observe it.');
});
