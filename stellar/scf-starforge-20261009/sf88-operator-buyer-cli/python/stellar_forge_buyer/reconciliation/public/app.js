'use strict';

const $ = id => document.getElementById(id);
const API = '/api/reconciliation';
const PAGE_SIZE = 50;
const ID64 = /^[0-9a-f]{64}$/;
const ID32 = /^[0-9a-f]{32}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const page = key => ({[key]:[],offset:0,limit:PAGE_SIZE,total:0,next_offset:null});
const state = {
  workspace:null,identity:null,busy:false,screen:'pairs',db:null,storageError:null,
  pairs:page('pairs'),runs:page('runs'),reports:page('reports'),operations:page('operations'),
  pair:null,run:null,report:null,export:null,runTab:'groups',runPairFilter:'',
  groups:page('rows'),rows:page('rows'),decisions:page('decisions'),changes:page('rows'),
  filters:{category:'',duplicates:'',side:'',status:'',group_id:''},
  subject:null,rowDetail:null,decisionActor:'',decisionReason:'',decisionOutcome:'REQUIRES_CORRECTION',
  beforeRunId:'',baselines:[],editions:[],editionCursor:null,editionCatalogStarted:false,editionDetails:new Map(),
  draft:null,draftVersion:0,draftTimer:null,preview:null,previewDefinition:null,
  localRequests:[],requestDetails:new Map(),mapPages:new WeakMap(),exportFilePages:new Map(),status:null
};
let capability = location.hash.slice(1);
try {
  if(capability) sessionStorage.setItem('stellar_duckdb_capability',capability);
  else capability = sessionStorage.getItem('stellar_duckdb_capability') || '';
} catch {}
if(location.hash) history.replaceState(null,'',location.pathname+location.search);

function el(tag,text,className) {
  const node=document.createElement(tag);
  if(text!==undefined && text!==null) node.textContent=String(text);
  if(className) node.className=className;
  return node;
}
function nativeText(value) {
  if(value===null || value===undefined) return 'NULL';
  if(typeof value==='object' && Object.hasOwn(value,'text') && Object.hasOwn(value,'type'))
    return value.type==='null'?'NULL':String(value.text);
  return typeof value==='object'?JSON.stringify(value):String(value);
}
function scalar(value) {
  if(value===null || value===undefined) return null;
  if(typeof value==='object' && Object.hasOwn(value,'text') && Object.hasOwn(value,'type'))
    return value.type==='null'?null:value.text;
  return value;
}
function indexValue(value,label) {
  value=scalar(value);
  const source=String(value);
  if(!/^(0|[1-9][0-9]*)$/.test(source)) throw new Error('The native '+label+' is not a row index.');
  const number=Number(source);
  if(!Number.isSafeInteger(number)) throw new Error('The native '+label+' exceeds browser index precision.');
  return number;
}
function pretty(value) { return JSON.stringify(value,null,2); }
function short(value) { const s=String(value||'');return s.length>24?s.slice(0,14)+'…'+s.slice(-8):s; }
function count(value) { return typeof value==='number'?value.toLocaleString():String(value??'—'); }
function when(value) { if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString(); }
function keyBody(value) {
  if(Array.isArray(value)) return '['+value.map(keyBody).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+keyBody(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function notice(message,level='info') { const node=$('notice');node.textContent=message||'';node.dataset.level=level;node.hidden=!message; }
function setBusy(value) {
  state.busy=value;document.body.dataset.busy=String(value);$('main').setAttribute('aria-busy',String(value));
  document.querySelectorAll('button,input,select,textarea').forEach(node=>{node.disabled=value || node.dataset.disabled==='true';});
}
async function action(label,operation) {
  if(state.busy)return;
  setBusy(true);notice(label+'…');
  try { await operation(); }
  catch(error) { notice(error.message||String(error),'error'); }
  finally { setBusy(false); }
}
function button(label,operation,{primary=false,disabled=false,small=false,quiet=false}={}) {
  const node=el('button',label,[primary?'primary':'',small?'small':'',quiet?'quiet':''].filter(Boolean).join(' '));
  node.type='button';node.dataset.disabled=String(Boolean(disabled));node.disabled=state.busy||disabled;
  node.addEventListener('click',()=>action(label,operation));return node;
}
function input(value='',{type='text',placeholder='',maxLength,required=false,readOnly=false,onInput}={}) {
  const node=el('input');node.type=type;node.value=value??'';node.autocomplete='off';node.spellcheck=false;
  node.placeholder=placeholder;node.required=required;node.readOnly=readOnly;node.disabled=state.busy;
  if(maxLength)node.maxLength=maxLength;
  if(onInput)node.addEventListener('input',()=>onInput(node.value));
  return node;
}
function textarea(value='',onInput,rows=3) {
  const node=el('textarea');node.value=value??'';node.rows=rows;node.spellcheck=false;node.disabled=state.busy;
  if(onInput)node.addEventListener('input',()=>onInput(node.value));
  return node;
}
function select(options,value,onChange) {
  const node=el('select');node.disabled=state.busy;
  for(const entry of options) {
    const [key,label]=Array.isArray(entry)?entry:[entry,entry];
    const opt=el('option',label);opt.value=String(key);node.append(opt);
  }
  if(value!==undefined && value!==null)node.value=String(value);
  if(onChange)node.addEventListener('change',()=>onChange(node.value));
  return node;
}
function field(label,control,hint) {
  const node=el('label');node.append(el('span',label),control);
  if(hint)node.append(el('span',hint,'hint'));
  return node;
}
function toolbar(...children) { const node=el('div',undefined,'toolbar');node.append(...children.filter(Boolean));return node; }
function heading(name,title,description,...actions) {
  const head=el('div',undefined,'page-heading'),words=el('div'),h=el('h2',title);h.id='title-'+name;
  words.append(h,el('p',description));head.append(words);
  if(actions.length){const a=el('div',undefined,'page-actions');a.append(...actions);head.append(a);}
  return head;
}
function panel(title,...children) {
  const p=el('section',undefined,'panel');if(title)p.append(el('h3',title));p.append(...children.filter(Boolean));return p;
}
function empty(message) { return el('div',message,'empty'); }
function details(title,value) {
  const node=el('details',undefined,'record');node.append(el('summary',title),el('pre',typeof value==='string'?value:pretty(value)));
  return node;
}
function facts(pairs) {
  const dl=el('dl',undefined,'facts');
  for(const [name,value] of pairs)if(value!==undefined && value!==null && value!=='')dl.append(el('dt',name),el('dd',nativeText(value)));
  return dl;
}
function listItem(title,meta,operation,selected=false) {
  const node=button('',operation);node.className='item'+(selected?' selected':'');
  node.append(el('span',title,'item-title'),el('span',meta,'item-meta'));return node;
}
function grid(columns,rows,rowActions) {
  const box=el('div',undefined,'table-scroll'),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
  columns.forEach(col=>{const th=el('th',typeof col==='string'?col:col.name);if(col.type)th.title=col.type;tr.append(th);});
  if(rowActions)tr.append(el('th','Review'));
  head.append(tr);table.append(head,body);box.append(table);
  for(const row of rows) {
    const line=el('tr'),object={};
    columns.forEach((col,i)=>{
      const name=typeof col==='string'?col:col.name,value=Array.isArray(row)?row[i]:row[name];
      object[name]=value;
      const isNull=scalar(value)===null,isEmpty=scalar(value)==='';
      const cell=el('td',undefined,'value'+(isNull?' is-null':''));
      if(isNull||isEmpty){const badge=el('span',isNull?'NULL':'EMPTY STRING','native-marker');badge.title=isNull?'Native SQL NULL; no string value':'An original string with zero characters';cell.append(badge);}
      else cell.textContent=nativeText(value);
      if(col.type)cell.title=col.type;
      line.append(cell);
    });
    if(rowActions) { const td=el('td',undefined,'action-cell');td.append(rowActions(object));line.append(td); }
    body.append(line);
  }
  if(!rows.length){const line=el('tr'),td=el('td','No rows in this selection.','muted');td.colSpan=columns.length+(rowActions?1:0);line.append(td);body.append(line);}
  return box;
}
function pager(record,load) {
  const bar=el('div',undefined,'pager'),offset=record.offset||0,limit=record.limit||PAGE_SIZE;
  const rowCount=Array.isArray(record.rows)?record.rows.length:Array.isArray(record.pairs)?record.pairs.length:Array.isArray(record.runs)?record.runs.length:Array.isArray(record.reports)?record.reports.length:Array.isArray(record.decisions)?record.decisions.length:(record.operations||[]).length;
  bar.append(el('span',record.total?count(offset+1)+'–'+count(offset+rowCount)+' of '+count(record.total):'0 records'));
  bar.append(toolbar(button('Previous',()=>load(Math.max(0,offset-limit)),{disabled:offset===0,small:true}),button('Next',()=>load(record.next_offset),{disabled:record.next_offset===null||record.next_offset===undefined,small:true})));
  return bar;
}
function query(values) {
  const p=new URLSearchParams();
  for(const [key,value] of Object.entries(values))if(value!==undefined&&value!==null&&value!=='')p.set(key,String(value));
  return p.toString()?'?'+p.toString():'';
}
async function api(path,body,originalText) {
  const options={method:body===undefined&&originalText===undefined?'GET':'POST',cache:'no-store',headers:{'X-DuckDB-Capability':capability}};
  if(state.workspace)options.headers['X-DuckDB-Workspace-ID']=state.workspace;
  if(options.method==='POST'){options.headers['Content-Type']='application/json';options.body=originalText===undefined?JSON.stringify(body):originalText;}
  let response;
  try{response=await fetch(path,options);}catch(cause){const e=new Error('The local workspace could not be reached. The saved request remains available under Saved requests.');e.transport=true;e.cause=cause;throw e;}
  let result;
  try{result=await response.json();}catch(cause){const e=new Error('The local workspace returned an unreadable response. Inspect the original saved request before continuing.');e.transport=true;e.status=response.status;e.cause=cause;throw e;}
  if(!response.ok){
    const code=typeof result.error==='string'?result.error:'DUCKDB_REQUEST_FAILED';
    const detail=result.detail||result.message||'';
    const message=response.status===403?'Open this workspace using its original private launch link.':code+(detail?'\n'+(typeof detail==='string'?detail:pretty(detail)):'');
    const error=new Error(message);error.code=code;error.status=response.status;error.result=result;throw error;
  }
  if(state.workspace && result.workspace_id && result.workspace_id!==state.workspace)
    throw new Error('The workspace identity changed. Reopen the intended project before continuing; its original requests remain retained.');
  return result;
}
function show(name) {
  state.screen=name;
  document.querySelectorAll('.screen').forEach(node=>{node.hidden=node.id!=='screen-'+name;});
  document.querySelectorAll('nav [data-screen]').forEach(node=>{if(node.dataset.screen===name)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
  try{sessionStorage.setItem('stellar_duckdb_reconciliation_screen',name);}catch{}
}
function requestId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''); }
function requestKey(id) { return state.workspace+':'+id; }
function openStorage() {
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('This browser cannot retain the original request. Enable IndexedDB storage for the local workspace.'));return;}
    const req=indexedDB.open('stellar_duckdb_reconciliation',1);
    req.onupgradeneeded=()=>{for(const name of ['requests','drafts'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:'key'});};
    req.onerror=()=>reject(req.error||new Error('Browser request storage could not be opened.'));
    req.onblocked=()=>reject(new Error('Close the older reconciliation tab so browser request storage can open.'));
    req.onsuccess=()=>resolve(req.result);
  });
}
function dbRead(store,key) {
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(store,'readonly'),req=key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error||new Error('Browser storage read interrupted.'));
  });
}
function dbWrite(store,value,remove=false) {
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(store,'readwrite');
    if(remove)tx.objectStore(store).delete(value);else tx.objectStore(store).put(value);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Browser storage write interrupted.'));
  });
}
async function loadLocalRequests() {
  if(!state.db)return;
  const all=await dbRead('requests');
  state.localRequests=all.filter(row=>row.workspace_id===state.workspace).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
}
async function keepRequest(record) {
  await dbWrite('requests',record);
  const i=state.localRequests.findIndex(x=>x.request_id===record.request_id);
  if(i===-1)state.localRequests.unshift(record);else state.localRequests[i]=record;
}
function remotePath(record) { return (record.family==='export'?'/api':API)+'/requests/'+record.request_id; }
async function inspectRequest(record) {
  const remote=await api(remotePath(record));
  if(remote.request_id && remote.request_id!==record.request_id)throw new Error('The returned request identity differs from the saved request.');
  const updated={...record,remote,inspected_at:new Date().toISOString()};
  if(remote.state==='COMPLETE'){
    if(!remote.result)throw new Error('The completed native request has no retained result. Reopen the original request record.');
    updated.state='COMPLETE';updated.result=remote.result;
  }
  await keepRequest(updated);state.requestDetails.set(record.request_id,remote);
  return updated;
}
async function sendSavedRequest(record,route=record.route,bodyText=record.body_text) {
  let result;
  try{result=await api(route,undefined,bodyText);}
  catch(error){
    const updated={...record,state:error.transport?'RESPONSE_UNKNOWN':'RETURNED_ERROR',last_error:{message:error.message,code:error.code||null,status:error.status||null,at:new Date().toISOString()}};
    await keepRequest(updated);renderRequests();throw error;
  }
  await keepRequest({...record,state:'COMPLETE',result,completed_at:new Date().toISOString()});
  return result;
}
async function continueRequest(record) {
  let inspected;
  try{inspected=await inspectRequest(record);}
  catch(error){
    if(error.status!==404)throw error;
    // This is reached only from an explicit action, never from a list refresh.
    return sendSavedRequest(record);
  }
  if(inspected.state==='COMPLETE')return inspected.result;
  const body=record.family==='export'?{}:{workspace_id:state.workspace};
  return sendSavedRequest(inspected,remotePath(record)+'/resume',JSON.stringify(body));
}
async function retained(route,body) {
  if(!state.workspace)throw new Error('Open the original workspace first.');
  const meaning=route+':'+keyBody(body);
  const previous=state.localRequests.find(row=>row.meaning===meaning&&row.state!=='COMPLETE');
  if(previous){
    notice('Continuing the original saved request '+previous.request_id+'…');
    return continueRequest(previous);
  }
  const request_id=requestId(),full={...body,request_id};
  const record={key:requestKey(request_id),workspace_id:state.workspace,request_id,route,family:route===API+'/exports'?'export':'reconciliation',body_text:JSON.stringify(full),meaning,state:'PREPARED',created_at:new Date().toISOString()};
  await keepRequest(record); // Exact complete body and ID precede the first HTTP write.
  return sendSavedRequest(record);
}
async function receiveResult(route,result) {
  if(route===API+'/pairs'){
    state.pair=result;state.draft=makeDraft(result);state.preview=null;state.previewDefinition=null;
    await saveDraft();await loadPairs(0);renderPairs();renderEditor();show('pairs');
  } else if(route===API+'/run') { await openRun(result.run_id);show('runs'); }
  else if(route===API+'/decision') {
    state.run=result.run;state.decisionReason='';await loadRunTab(0);renderRunDetail();show('runs');
  } else if(route===API+'/report') {
    state.report=result;state.export=null;await loadReports(0);if(result.before_run_id)await loadChanges(0);renderReports();show('reports');
  } else if(route===API+'/exports') {
    state.export=result;renderReports();show('reports');
  }
}
function makeDraft(pairRecord) {
  return {workspace_id:state.workspace,pair_id:pairRecord?.pair_id||null,base_revision:pairRecord?.revision||0,
    definition:pairRecord?clone(pairRecord.definition):{name:'',label:'',source_edition:'',target_edition:'',columns:[],window_column:null,windows:[],notes:''}};
}
async function saveDraft() {
  if(!state.draft || !state.db)return;
  await dbWrite('drafts',{key:state.workspace,...clone(state.draft),updated_at:new Date().toISOString()});
}
function edited() {
  state.draftVersion++;
  state.preview=null;state.previewDefinition=null;
  const review=$('mapping-review');if(review)review.replaceChildren(el('p','Review the current mapping to save this edition.','muted'));
  const save=$('save-pair');if(save){save.dataset.disabled='true';save.disabled=true;}
  clearTimeout(state.draftTimer);
  state.draftTimer=setTimeout(()=>{saveDraft().catch(error=>notice('The draft could not be retained: '+error.message,'error'));},250);
}
async function loadIdentity() {
  const identity=await api('/api/identity');
  if(!ID32.test(identity.workspace_id||''))throw new Error('The original DuckDB workspace did not return a complete identity.');
  if(state.workspace && state.workspace!==identity.workspace_id)throw new Error('The local listener now belongs to another workspace. Reopen the intended project before continuing.');
  state.workspace=identity.workspace_id;state.identity=identity;
  $('workspace-name').textContent=identity.directory||'Local DuckDB workspace';$('workspace-id').textContent=identity.workspace_id;
}
async function loadStatus() {
  state.status=await api(API+'/status');
  $('workspace-counts').textContent=count(state.status.pair_count)+' pairs · '+count(state.status.run_count)+' runs · '+count(state.status.report_count)+' reports';
}
async function loadPairs(offset=0) { state.pairs={...page('pairs'),...await api(API+'/pairs'+query({offset,limit:PAGE_SIZE}))};renderPairs(); }
async function loadRuns(offset=0) { state.runs={...page('runs'),...await api(API+'/runs'+query({offset,limit:PAGE_SIZE,pair_id:state.runPairFilter}))};renderRunList(); }
async function loadReports(offset=0) { state.reports={...page('reports'),...await api(API+'/reports'+query({offset,limit:PAGE_SIZE}))};renderReports(); }
async function loadOperations(offset=0) { state.operations={...page('operations'),...await api(API+'/operations'+query({offset,limit:PAGE_SIZE}))};renderRequests(); }
async function loadEditions(reset=false) {
  if(reset){state.editions=[];state.editionCursor=null;state.editionCatalogStarted=false;}
  if(state.editionCatalogStarted&&state.editionCursor===null)return;
  const response=await api('/api/editions'+query({limit:100,before:state.editionCursor}));
  const rows=Array.isArray(response)?response:response.editions||[],known=new Set(state.editions.map(x=>x.edition_id));
  for(const row of rows)if(!known.has(row.edition_id)){state.editions.push(row);known.add(row.edition_id);}
  const next=Array.isArray(response)?null:response.next_before??null;
  if(next!==null && state.editionCatalogStarted && next===state.editionCursor)throw new Error('The edition catalog returned the same continuation cursor.');
  state.editionCursor=next;state.editionCatalogStarted=true;
}
async function edition(id) {
  if(!ID64.test(id||''))return null;
  if(!state.editionDetails.has(id))state.editionDetails.set(id,await api('/api/editions/'+id));
  return state.editionDetails.get(id);
}
function editionTitle(row) { return (row.label||row.name||'Edition '+(row.sequence||short(row.edition_id)))+' · '+count(row.row_count)+' rows'; }
async function newPair() {
  state.draft=makeDraft();state.preview=null;state.previewDefinition=null;state.draftVersion++;
  await saveDraft();await loadEditions();renderEditor();show('editor');notice('Choose the two original dataset editions and their matching fields.');
}
async function editPair(record) {
  state.draft=makeDraft(record);state.preview=null;state.previewDefinition=null;state.draftVersion++;
  await Promise.all([edition(record.definition.source_edition),edition(record.definition.target_edition)]);
  await saveDraft();await loadEditions();renderEditor();show('editor');notice('Editing '+record.label+' from revision '+record.revision+'.');
}
async function openPair(id,revision) {
  if(!ID64.test(id))throw new Error('Choose a complete saved pair identifier.');
  state.pair=await api(API+'/pairs/'+id+query({revision}));renderPairs();show('pairs');notice('Saved pair revision '+state.pair.revision+' opened.');
}
function renderPairs() {
  const root=$('screen-pairs');root.replaceChildren(heading('pairs','Saved dataset pairs','A pair defines the source editions, matching fields and comparison window. Every saved revision remains available.',button('New pair',newPair,{primary:true})));
  const split=el('div',undefined,'split'),list=el('div',undefined,'item-list');
  for(const row of state.pairs.pairs)list.append(listItem(row.label||row.name,'Revision '+row.revision+' · '+when(row.created_at),()=>openPair(row.pair_id),row.pair_id===state.pair?.pair_id));
  if(!state.pairs.pairs.length)list.append(empty('Create a pair from two imported dataset editions.'));
  split.append(panel('Pair catalog',list,pager(state.pairs,loadPairs)));
  const p=state.pair;
  if(p){
    const revisionInput=input(p.revision,{type:'number'});revisionInput.min='1';
    const latest=state.pairs.pairs.find(row=>row.pair_id===p.pair_id)?.revision;
    if(latest!==undefined)revisionInput.max=String(Math.max(latest,p.revision));
    const history=toolbar(field('Reopen revision',revisionInput),button('Open revision',()=>openPair(p.pair_id,indexValue(revisionInput.value,'revision'))),button('Open latest revision',()=>openPair(p.pair_id)));
    const actions=toolbar(button('Edit this revision',()=>editPair(p)),button('Run reconciliation',async()=>{
      const result=await retained(API+'/run',{workspace_id:state.workspace,pair_id:p.pair_id,expected_revision:p.revision,definition_sha256:p.definition_sha256});
      await receiveResult(API+'/run',result);await loadStatus();notice('Reconciliation completed. Every source row is accounted for.','success');
    },{primary:true}),button('Show runs',async()=>{state.runPairFilter=p.pair_id;await loadRuns(0);show('runs');}));
    split.append(panel(p.label||p.name,facts([['Name',p.name],['Pair',p.pair_id],['Revision',p.revision],['Source edition',p.definition.source_edition],['Target edition',p.definition.target_edition],['Saved',when(p.created_at)]]),actions,history,details('Complete saved definition',p.definition),details('Original mapping review',p.review)));
  }else split.append(panel('Selected pair',empty('Open a saved pair to review its definition, edit a revision or start a run.')));
  root.append(split);
}

function editionOptions(selectedId) {
  const rows=[['','Choose an imported edition']];
  for(const e of state.editions)rows.push([e.edition_id,editionTitle(e)]);
  if(selectedId&&!state.editions.some(e=>e.edition_id===selectedId)){
    const retained=state.editionDetails.get(selectedId);
    rows.push([selectedId,retained?editionTitle(retained):'Saved edition '+short(selectedId)]);
  }
  return rows;
}
function editionColumns(side) {
  const id=state.draft?.definition?.[side+'_edition'];
  return state.editionDetails.get(id)?.columns||[];
}
function columnOptions(side,selectedName) {
  const cols=editionColumns(side),options=[['','Choose original column'],...cols.map(c=>[c.name,c.name+' · '+c.type])];
  if(selectedName&&!cols.some(c=>c.name===selectedName))options.push([selectedName,selectedName+' · not in selected edition']);
  return options;
}
function mappingType(side,name) { return editionColumns(side).find(c=>c.name===name)?.type||'Select a native column'; }
function renderEditionFacts(side) {
  const id=state.draft.definition[side+'_edition'],record=state.editionDetails.get(id);
  if(!record)return panel(side==='source'?'Source edition':'Target edition',empty('Choose an imported edition to see its exact columns.'));
  const rows=(record.columns||[]).map(c=>[c.name,c.type,c.source??c.source_name??'']);
  return panel(side==='source'?'Source edition':'Target edition',
    facts([['Edition',id],['Rows',record.row_count],['Saved',when(record.created_at)],['Table',record.table]]),
    el('div',undefined,'spacer'),grid(['Original column','Native SQL type','Source field'],rows),
    details('Full source scope and meanings',{source_scope:record.source_scope,source_meanings:record.source_meanings,semantics:record.semantics}),
    details('Complete imported edition',record));
}
function renderValueMap(row,side) {
  const key=side+'_map',values=row[key],section=el('section');
  const positions=state.mapPages.get(row)||{source:0,target:0};
  const last=Math.max(0,Math.ceil(values.length/PAGE_SIZE)-1)*PAGE_SIZE;
  const offset=Math.min(positions[side],last);positions[side]=offset;state.mapPages.set(row,positions);
  section.append(el('h4',side==='source'?'Source value map':'Target value map'));
  const table=el('table'),head=el('thead'),header=el('tr'),body=el('tbody');
  header.append(el('th','Original exact string'),el('th','Canonical exact string'),el('th',''));head.append(header);table.append(head,body);
  values.slice(offset,offset+PAGE_SIZE).forEach((entry,index)=>{
    const i=offset+index,tr=el('tr'),a=el('td'),b=el('td'),c=el('td');
    a.append(textarea(entry.original,v=>{entry.original=v;edited();},2));
    b.append(textarea(entry.canonical,v=>{entry.canonical=v;edited();},2));
    c.append(button('Remove',async()=>{values.splice(i,1);edited();renderEditor();},{small:true}));
    tr.append(a,b,c);body.append(tr);
  });
  if(values.length){
    const scroll=el('div',undefined,'table-scroll');scroll.append(table);section.append(scroll);
    if(values.length>PAGE_SIZE)section.append(toolbar(
      el('span',count(offset+1)+'–'+count(Math.min(offset+PAGE_SIZE,values.length))+' of '+count(values.length)+' exact mappings','small-text'),
      button('Previous values',async()=>{positions[side]=Math.max(0,offset-PAGE_SIZE);renderEditor();},{small:true,disabled:offset===0}),
      button('Next values',async()=>{positions[side]=offset+PAGE_SIZE;renderEditor();},{small:true,disabled:offset>=last})));
  }else section.append(el('p','No value map: compare original native values.','hint'));
  section.append(toolbar(button('Add exact value',async()=>{
    values.push({original:'',canonical:''});positions[side]=Math.floor((values.length-1)/PAGE_SIZE)*PAGE_SIZE;
    edited();renderEditor();
  },{small:true,disabled:values.length>=10000})));
  return section;
}
function mappingTable() {
  const box=el('div',undefined,'table-scroll'),table=el('table'),head=el('thead'),header=el('tr'),body=el('tbody');
  ['Canonical field','Source column','Target column','Role','Meaning',''].forEach(name=>header.append(el('th',name)));
  head.append(header);table.append(head,body);box.append(table);
  state.draft.definition.columns.forEach((row,index)=>{
    const tr=el('tr'),name=el('td'),source=el('td'),target=el('td'),role=el('td'),meaning=el('td'),actions=el('td');
    name.append(input(row.name,{maxLength:120,required:true,onInput:v=>{row.name=v;edited();}}));
    const sourceType=el('span',mappingType('source',row.source),'type-label');
    source.append(select(columnOptions('source',row.source),row.source,v=>{row.source=v;sourceType.textContent=mappingType('source',v);edited();}),sourceType);
    const targetType=el('span',mappingType('target',row.target),'type-label');
    target.append(select(columnOptions('target',row.target),row.target,v=>{row.target=v;targetType.textContent=mappingType('target',v);edited();}),targetType);
    role.append(select([['key','Matching key'],['value','Compared value']],row.role,v=>{row.role=v;edited();}));
    meaning.append(textarea(row.meaning,v=>{row.meaning=v;edited();},2));
    actions.append(button('Remove',async()=>{state.draft.definition.columns.splice(index,1);edited();renderEditor();},{small:true}));
    tr.append(name,source,target,role,meaning,actions);body.append(tr);
    const detailRow=el('tr',undefined,'mapping-row-detail'),cell=el('td');cell.colSpan=6;
    const d=el('details'),summary=el('summary','Exact value maps · '+(row.source_map.length+row.target_map.length)+' entries');
    d.open=row.source_map.length+row.target_map.length>0;
    const maps=el('div',undefined,'equal-columns spacer');maps.append(renderValueMap(row,'source'),renderValueMap(row,'target'));
    d.append(summary,el('p','Value maps apply only to VARCHAR fields. With a map, every non-null original string needs an explicit entry; missing values are quarantined. Spaces, case and empty strings are preserved. Native NULL stays NULL.','hint'),maps);
    cell.append(d);detailRow.append(cell);body.append(detailRow);
  });
  if(!state.draft.definition.columns.length){const tr=el('tr'),td=el('td','Add the fields to compare. Choose at least one matching key.','muted');td.colSpan=6;tr.append(td);body.append(tr);}
  return box;
}
function windowsEditor() {
  const definition=state.draft.definition,box=el('div',undefined,'stack');
  const options=[['','All rows / no window column'],...definition.columns.filter(c=>c.name).map(c=>[c.name,c.name])];
  if(definition.window_column&&!options.some(([key])=>key===definition.window_column))options.push([definition.window_column,definition.window_column+' · missing canonical field']);
  box.append(field('Window field',select(options,definition.window_column||'',v=>{definition.window_column=v||null;edited();}),
    'No windows includes all rows. Each declared window includes its start and excludes its end.'));
  definition.windows.forEach((window,index)=>{
    const p=el('div',undefined,'panel subtle'),fields=el('div',undefined,'fields');
    fields.append(field('Window identifier',input(window.id,{maxLength:120,onInput:v=>{window.id=v;edited();}})),
      field('Comparison basis',select([['native','Native type'],['lexical','Exact lexical order (VARCHAR)']],window.basis,v=>{window.basis=v;edited();})),
      field('Start (included)',input(window.start,{onInput:v=>{window.start=v;edited();}})),
      field('End (excluded)',input(window.end,{onInput:v=>{window.end=v;edited();}})));
    p.append(fields,toolbar(button('Remove window',async()=>{definition.windows.splice(index,1);edited();renderEditor();},{small:true})));box.append(p);
  });
  box.append(toolbar(button('Add window',async()=>{definition.windows.push({id:'window_'+(definition.windows.length+1),start:'',end:'',basis:'native'});edited();renderEditor();})));
  return box;
}
function saveJson(value,filename) {
  const blob=new Blob([pretty(value)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function filename(value) { return String(value||'reconciliation').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120)||'reconciliation'; }
async function importDefinition(file) {
  if(!file)return;
  const raw=new Uint8Array(await file.arrayBuffer()),text=new TextDecoder('utf-8',{fatal:true}).decode(raw),parsed=JSON.parse(text);
  const definition=parsed.definition||parsed;
  if(!definition||typeof definition!=='object'||Array.isArray(definition)||!Array.isArray(definition.columns)||!Array.isArray(definition.windows))
    throw new Error('Choose a complete definition JSON file containing columns and windows arrays.');
  for(const column of definition.columns){
    if(!Array.isArray(column.source_map)||!Array.isArray(column.target_map))throw new Error('Every field needs its original source_map and target_map arrays.');
  }
  state.draft=makeDraft();state.draft.definition=clone(definition);edited();
  await Promise.all([edition(definition.source_edition),edition(definition.target_edition)]);await saveDraft();renderEditor();
  notice('The complete definition is loaded as a new pair. Review it against the original imported editions before saving.');
}
async function reviewDefinition() {
  const definition=clone(state.draft.definition),version=state.draftVersion,meaning=keyBody(definition);
  const review=await api(API+'/review',{definition});
  if(version!==state.draftVersion||meaning!==keyBody(state.draft.definition))throw new Error('The mapping changed during review. Review the current definition.');
  if(!ID64.test(review.review_sha256||'')||!review.definition)throw new Error('The native mapping review did not return its full reviewed definition.');
  state.preview=review;state.previewDefinition=meaning;renderMappingReview();
  const save=$('save-pair');if(save){save.dataset.disabled='false';save.disabled=state.busy;}
  notice('Mapping reviewed. Check the omitted fields and source meanings, then save this revision.');
}
function renderMappingReview() {
  const root=$('mapping-review');if(!root)return;
  root.replaceChildren();const review=state.preview;
  if(!review){root.append(el('p','Review the current mapping to see its exact native types, row scope and omitted fields.','muted'));return;}
  root.append(facts([['Source rows',review.source?.row_count],['Target rows',review.target?.row_count],['Reviewed fields',review.comparison_columns?.length]]));
  root.append(el('div',undefined,'spacer'),grid(['Canonical field','Native SQL type','Role'],(review.comparison_columns||[]).map(c=>[c.name,c.type,c.role])));
  const omitted=el('div',undefined,'equal-columns spacer');
  for(const side of ['source','target']) {
    const rows=review.omitted?.[side]||[],box=panel(side==='source'?'Omitted source fields':'Omitted target fields');
    box.append(rows.length?el('pre',rows.map(nativeText).join('\n')):el('p','Every original field is represented.','muted'));omitted.append(box);
  }
  root.append(omitted,details('Source scope and meanings',{source:review.source,target:review.target}),details('Complete native mapping review',review));
}
async function savePair() {
  if(!state.preview||state.previewDefinition!==keyBody(state.draft.definition))throw new Error('Review the current complete mapping before saving.');
  const result=await retained(API+'/pairs',{workspace_id:state.workspace,expected_revision:state.draft.base_revision,
    definition:clone(state.preview.definition),review_sha256:state.preview.review_sha256});
  await receiveResult(API+'/pairs',result);await loadStatus();notice('Pair revision '+result.revision+' saved.','success');
}
function renderEditor() {
  const root=$('screen-editor');
  root.replaceChildren(heading('editor','Pair definition','Choose the exact source fields and their meanings. Values are compared using their native types; any conversion must already be explicit in the source editions.',button('New pair',newPair)));
  if(!state.draft){root.append(panel('Pair editor',empty('Create a new pair or open a saved pair for editing.'),toolbar(button('Create a pair',newPair,{primary:true}))));return;}
  const d=state.draft.definition,base=state.draft.base_revision;
  const basic=el('div',undefined,'fields');
  basic.append(field('Pair name',input(d.name,{maxLength:120,required:true,readOnly:base>0,onInput:v=>{d.name=v;edited();}}),''),
    field('Display label',input(d.label,{maxLength:240,required:true,onInput:v=>{d.label=v;edited();}})));
  for(const side of ['source','target']){
    const control=select(editionOptions(d[side+'_edition']),d[side+'_edition'],value=>action('Opening original '+side+' edition',async()=>{
      d[side+'_edition']=value;edited();await edition(value);renderEditor();notice('Original '+side+' edition opened. Review existing mappings against its fields.');
    }));
    basic.append(field(side==='source'?'Source edition':'Target edition',control));
  }
  const file=input('',{type:'file'});file.accept='.json,application/json';file.addEventListener('change',()=>action('Reading complete definition',()=>importDefinition(file.files?.[0])));
  const identity=panel(base?'Edit saved pair revision '+base:'New dataset pair',basic,
    toolbar(button('Load earlier editions',async()=>{await loadEditions();renderEditor();notice('Edition catalog extended.');},{disabled:state.editionCatalogStarted&&state.editionCursor===null}),
      button('Export definition JSON',async()=>{saveJson(d,filename(d.name)+'.definition.json');notice('Complete definition download prepared.');})),
    details('Definition file import', 'Importing a definition creates a new draft. The original source and target editions must already exist in this workspace.'),
    field('Import complete definition JSON',file),
    el('p','The current draft is retained in this browser for this workspace.','hint'));
  root.append(identity);
  const editions=el('div',undefined,'equal-columns');editions.append(renderEditionFacts('source'),renderEditionFacts('target'));root.append(editions);
  const add=()=>{d.columns.push({name:'',source:'',target:'',role:'value',meaning:'',source_map:[],target_map:[]});edited();renderEditor();};
  const matched=async()=>{
    const targets=new Map(editionColumns('target').map(c=>[c.name,c])),known=new Set(d.columns.map(c=>c.name));
    let added=0;
    for(const source of editionColumns('source')){
      const target=targets.get(source.name);
      if(target&&source.type===target.type&&!known.has(source.name)){
        d.columns.push({name:source.name,source:source.name,target:target.name,role:'value',meaning:'',source_map:[],target_map:[]});known.add(source.name);added++;
      }
    }
    edited();renderEditor();notice(added+' fields with identical names and native types were added. Choose the matching key fields and record their meanings.');
  };
  root.append(panel('Field mapping',el('p','At least one field must be a matching key. Duplicate keys are compared as complete groups, preserving all original rows and their counts.','muted'),mappingTable(),
    toolbar(button('Add field',async()=>add()),button('Match identical columns',matched)),
    el('p','Any omitted original field is listed in the native review. Empty value maps preserve original typed values.','hint')));
  root.append(panel('Comparison windows',windowsEditor()),
    panel('Operator notes',textarea(d.notes,v=>{d.notes=v;edited();},5)));
  const preview=el('div');preview.id='mapping-review';
  const save=button('Save reviewed pair',savePair,{primary:true,disabled:!state.preview||state.previewDefinition!==keyBody(d)});save.id='save-pair';
  root.append(panel('Review and save',preview,toolbar(button('Review mapping',reviewDefinition),save)));
  renderMappingReview();
}

async function openRun(id) {
  if(!ID64.test(id||''))throw new Error('Choose a complete saved run identifier.');
  state.run=await api(API+'/runs/'+id);state.subject=null;state.rowDetail=null;state.decisionReason='';
  state.groups=page('rows');state.rows=page('rows');state.decisions=page('decisions');
  await loadRunTab(0);renderRuns();show('runs');notice('Complete saved reconciliation run opened.');
}
async function reloadRun() {
  if(!state.run)return;
  state.run=await api(API+'/runs/'+state.run.run_id);
  await loadRunTab(0);renderRunDetail();notice('Current saved run and decision revision reopened.');
}
function runPath(suffix) { if(!state.run)throw new Error('Open a saved reconciliation run.');return API+'/runs/'+state.run.run_id+(suffix?'/'+suffix:''); }
async function loadGroups(offset=0) {
  state.groups={...page('rows'),...await api(runPath('groups')+query({offset,limit:PAGE_SIZE,category:state.filters.category,duplicates:state.filters.duplicates}))};
  renderRunTable();
}
async function loadRows(offset=0) {
  const group=state.filters.group_id===''?undefined:indexValue(state.filters.group_id,'group');
  state.rows={...page('rows'),...await api(runPath('rows')+query({offset,limit:PAGE_SIZE,side:state.filters.side,status:state.filters.status,group_id:group}))};
  renderRunTable();
}
async function loadDecisions(offset=0) {
  state.decisions={...page('decisions'),...await api(runPath('decisions')+query({offset,limit:PAGE_SIZE}))};
  renderRunTable();
}
async function loadRunTab(offset=0) {
  if(!state.run)return;
  if(state.runTab==='groups')await loadGroups(offset);
  else if(state.runTab==='rows')await loadRows(offset);
  else await loadDecisions(offset);
}
function summaryView(summary) {
  const wrapper=el('div'),rows=[];
  for(const key of ['total','included','quarantined','excluded','matched','unmatched'])
    rows.push([({total:'Original rows',included:'Included in comparison',quarantined:'Quarantined',excluded:'Outside declared windows',matched:'Matched rows',unmatched:'Unmatched included rows'})[key],summary?.source?.[key],summary?.target?.[key]]);
  const table=grid(['Row accounting','Source','Target'],rows);table.classList.add('summary-table');wrapper.append(table);
  const groups=summary?.groups||{},metrics=el('div',undefined,'metric-line');
  for(const name of ['MATCHED','SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE'])
    if(groups[name]!==undefined)metrics.append(el('span',name.replaceAll('_',' ')+' '+count(groups[name]),'tag'));
  if(groups.duplicate_groups!==undefined)metrics.append(el('span','DUPLICATE KEY GROUPS '+count(groups.duplicate_groups),'tag'));
  wrapper.append(metrics);
  wrapper.append(el('p',summary?.accounting_balanced===true?'Native row accounting is balanced. Quarantined and excluded rows remain available for review.':'Read the complete native accounting result before interpreting the comparison.','hint'));
  if(summary?.scope_note)wrapper.append(el('p',summary.scope_note,'hint'));
  if(summary?.decisions)wrapper.append(details('Decision counts',summary.decisions));
  return wrapper;
}
function renderRuns() {
  const root=$('screen-runs');
  root.replaceChildren(heading('runs','Reconciliation runs','Review complete key groups, every original row and the decisions made against this exact saved comparison.',
    button('Reopen current run',reloadRun,{disabled:!state.run})));
  const split=el('div',undefined,'split'),catalog=el('section',undefined,'panel'),detail=el('div');
  catalog.append(el('h3','Run catalog'));
  const filter=input(state.runPairFilter,{placeholder:'All pairs, or complete pair ID'});
  catalog.append(field('Pair filter',filter),toolbar(button('Apply filter',async()=>{
    const value=filter.value.trim();if(value&&!ID64.test(value))throw new Error('Use the full saved pair identifier or leave the filter empty.');
    state.runPairFilter=value;await loadRuns(0);notice('Run catalog updated.');
  }),button('All pairs',async()=>{state.runPairFilter='';await loadRuns(0);renderRuns();})));
  const list=el('div',undefined,'item-list spacer');list.id='run-list';const paging=el('div');paging.id='run-pager';
  catalog.append(list,paging);detail.id='run-detail';split.append(catalog,detail);root.append(split);
  renderRunList();renderRunDetail();
}
function renderRunList() {
  const list=$('run-list');if(!list){renderRuns();return;}
  list.replaceChildren();
  for(const row of state.runs.runs) {
    const label=row.label||row.name||'Run '+short(row.run_id);
    list.append(listItem(label,'Pair revision '+row.pair_revision+' · '+when(row.created_at),()=>openRun(row.run_id),row.run_id===state.run?.run_id));
  }
  if(!state.runs.runs.length)list.append(empty('Run a saved pair to create a complete native comparison.'));
  $('run-pager').replaceChildren(pager(state.runs,loadRuns));
}
function renderRunDetail() {
  const root=$('run-detail');if(!root)return;
  root.replaceChildren();
  const run=state.run;if(!run){root.append(panel('Selected run',empty('Open a run to inspect row accounting, differences and decisions.')));return;}
  const summary=panel('Saved comparison',facts([['Run',run.run_id],['Pair',run.pair_id],['Pair revision',run.pair_revision],['Decision revision',run.review_revision],['Saved',when(run.created_at)]]),
    el('div',undefined,'spacer'),summaryView(run.summary),
    toolbar(button('Open pair definition',()=>openPair(run.pair_id,run.pair_revision))),
    details('Complete run record',run));
  root.append(summary);
  const review=panel('Review groups and rows'),tabs=el('div',undefined,'tabs');tabs.setAttribute('role','tablist');
  for(const [key,label] of [['groups','Key groups'],['rows','Original rows'],['decisions','Decision history']]){
    const b=button(label,async()=>{state.runTab=key;await loadRunTab(0);renderRunDetail();notice(label+' opened.');});
    b.setAttribute('role','tab');b.setAttribute('aria-selected',String(state.runTab===key));tabs.append(b);
  }
  review.append(tabs);
  const filters=el('div',undefined,'filters');
  if(state.runTab==='groups'){
    const category=select([['','All categories'],...['MATCHED','SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE'].map(v=>[v,v.replaceAll('_',' ')])],state.filters.category);
    const duplicates=select([['','All key groups'],['true','Duplicate keys'],['false','Without duplicate keys']],state.filters.duplicates);
    filters.append(field('Category',category),field('Key multiplicity',duplicates),button('Apply group filters',async()=>{
      state.filters.category=category.value;state.filters.duplicates=duplicates.value;await loadGroups(0);notice('Key group selection updated.');
    }));
  }else if(state.runTab==='rows'){
    const side=select([['','Both sides'],['source','Source'],['target','Target']],state.filters.side);
    const status=select([['','All original rows'],['INCLUDED','Included'],['QUARANTINED','Quarantined'],['EXCLUDED_WINDOW','Outside window']],state.filters.status);
    const group=input(state.filters.group_id,{placeholder:'All groups'});
    filters.append(field('Side',side),field('Row status',status),field('Group identifier',group),button('Apply row filters',async()=>{
      if(group.value.trim())indexValue(group.value.trim(),'group');
      state.filters.side=side.value;state.filters.status=status.value;state.filters.group_id=group.value.trim();await loadRows(0);notice('Original row selection updated.');
    }),button('All original rows',async()=>{state.filters.side='';state.filters.status='';state.filters.group_id='';await loadRows(0);renderRunDetail();}));
  }
  review.append(filters);const table=el('div');table.id='run-grid';const paging=el('div');paging.id='run-grid-pager';review.append(table,paging);root.append(review);
  const selected=el('div');selected.id='selected-subject';root.append(selected);
  const decision=el('div');decision.id='decision-editor';root.append(decision);
  const report=el('div');report.id='run-report-editor';root.append(report);
  renderRunTable();renderSubject();renderDecisionEditor();renderReportEditor();
}
function groupSubject(object) {
  return {kind:'group',group_id:indexValue(object.group_id,'group')};
}
function rowSubject(object) {
  const side=scalar(object.side);
  if(!['source','target'].includes(side))throw new Error('The native row did not retain its source or target side.');
  return {kind:'row',side,row:indexValue(object.row,'row')};
}
async function chooseGroup(object) {
  state.subject=groupSubject(object);state.rowDetail=null;renderSubject();renderDecisionEditor();
  notice('Key group '+state.subject.group_id+' selected for an explicit review decision.');
  $('selected-subject')?.scrollIntoView({block:'nearest'});
}
async function groupRows(object) {
  const group=indexValue(object.group_id,'group');
  state.filters.group_id=String(group);state.filters.side='';state.filters.status='';state.runTab='rows';
  await loadRows(0);renderRunDetail();notice('All original rows in key group '+group+' opened.');
}
async function chooseRow(object) {
  const subject=rowSubject(object);
  const detail=await api(runPath('row')+query({side:subject.side,row:subject.row}));
  if(detail.side!==subject.side||indexValue(detail.row,'row')!==subject.row)throw new Error('The returned original row differs from the selected side and row index.');
  state.subject=subject;state.rowDetail=detail;renderSubject();renderDecisionEditor();
  notice('Complete '+subject.side+' row '+subject.row+' opened.');$('selected-subject')?.scrollIntoView({block:'nearest'});
}
function renderRunTable() {
  const root=$('run-grid'),paging=$('run-grid-pager');if(!root||!paging||!state.run)return;
  root.replaceChildren();paging.replaceChildren();
  if(state.runTab==='groups'){
    root.append(grid(state.groups.columns||[],state.groups.rows||[],object=>toolbar(
      button('Review group',()=>chooseGroup(object),{small:true}),button('All group rows',()=>groupRows(object),{small:true}))));
    paging.append(pager(state.groups,loadGroups));
  }else if(state.runTab==='rows'){
    root.append(grid(state.rows.columns||[],state.rows.rows||[],object=>toolbar(button('Open full row',()=>chooseRow(object),{small:true}))));
    paging.append(pager(state.rows,loadRows));
  }else {
    const list=el('div',undefined,'item-list');
    for(const decision of state.decisions.decisions||[]){
      const p=panel(decision.outcome||'Decision',
        facts([['Actor',decision.actor],['Subject',decision.subject],['Decision sequence',decision.sequence??decision.revision??decision.review_revision],['Saved',when(decision.created_at)]]),
        el('p',decision.reason||'','wrap'),details('Complete saved decision',decision));
      const subject=decision.subject;
      if(subject)p.append(toolbar(button('Review this subject',async()=>{
        state.subject=clone(subject);state.rowDetail=null;
        if(subject.kind==='row')state.rowDetail=await api(runPath('row')+query({side:subject.side,row:subject.row}));
        renderSubject();renderDecisionEditor();notice('Original decision subject selected.');
      },{small:true})));
      list.append(p);
    }
    if(!(state.decisions.decisions||[]).length)list.append(empty('No review decisions have been recorded for this run.'));
    root.append(list);paging.append(pager(state.decisions,loadDecisions));
  }
}
function renderSubject() {
  const root=$('selected-subject');if(!root)return;
  root.replaceChildren();if(!state.subject)return;
  const subject=state.subject,selected=panel(subject.kind==='group'?'Selected key group '+subject.group_id:'Selected '+subject.side+' row '+subject.row);
  if(state.rowDetail){
    selected.append(facts([['Original edition',state.rowDetail.edition_id],['Side',state.rowDetail.side],['Row index',state.rowDetail.row]]));
    const original=state.rowDetail.original||{},canonical=state.rowDetail.canonical||{};
    selected.append(el('h4','Every original field','spacer'),grid(['Original field','Native value'],Object.entries(original)),
      el('h4','Canonical comparison values','spacer'),grid(['Canonical field','Native value'],Object.entries(canonical)),
      details('Complete original and canonical row',state.rowDetail));
  }else selected.append(el('p','The decision applies to this complete key group. Open All group rows to inspect both sides and every duplicate.','muted'));
  selected.append(toolbar(button('Clear selection',async()=>{state.subject=null;state.rowDetail=null;renderSubject();renderDecisionEditor();notice('Review selection cleared.');},{small:true})));
  root.append(selected);
}
function renderDecisionEditor() {
  const root=$('decision-editor');if(!root)return;
  root.replaceChildren();if(!state.run||!state.subject)return;
  const subject=clone(state.subject),runId=state.run.run_id,revision=state.run.review_revision;
  const fields=el('div',undefined,'fields');
  const actor=input(state.decisionActor,{maxLength:240,required:true,onInput:v=>{state.decisionActor=v;}});
  const outcome=select([['OPEN','Open'],['ACCEPTED_DIFFERENCE','Accepted difference'],['REQUIRES_CORRECTION','Requires correction'],['DEFERRED','Deferred']],state.decisionOutcome,v=>{state.decisionOutcome=v;});
  const reason=textarea(state.decisionReason,v=>{state.decisionReason=v;},4);reason.required=true;
  fields.append(field('Reviewer',actor),field('Decision',outcome));
  const form=el('form',undefined,'stack');form.append(fields,field('Reason',reason,'Record why this exact group or original row has this outcome.'));
  const save=button('Save review decision',async()=>{
    if(!form.reportValidity())return;
    if(state.run.run_id!==runId||state.run.review_revision!==revision)throw new Error('The selected run changed. Reopen its current review revision before saving.');
    const result=await retained(API+'/decision',{workspace_id:state.workspace,run_id:runId,expected_revision:revision,subject,
      outcome:outcome.value,actor:actor.value,reason:reason.value});
    await receiveResult(API+'/decision',result);notice('Review decision saved at revision '+result.run.review_revision+'. Source rows and comparison counts are unchanged.','success');
  },{primary:true});
  form.append(toolbar(save));form.addEventListener('submit',event=>{event.preventDefault();save.click();});
  root.append(panel('Record a decision',el('p','This decision is retained separately from the original source rows and comparison result.','muted'),form));
}
async function loadBaselines() {
  const rows=[],seen=new Set();let offset=0;
  for(;;){
    const p=await api(API+'/runs'+query({offset,limit:100}));
    for(const r of p.runs||[])if(!seen.has(r.run_id)){rows.push(r);seen.add(r.run_id);}
    if(p.next_offset===null||p.next_offset===undefined)break;
    if(!Number.isSafeInteger(p.next_offset)||p.next_offset<=offset)throw new Error('The native run catalog returned a non-advancing continuation.');
    offset=p.next_offset;
  }
  state.baselines=rows;renderReportEditor();notice('All '+count(rows.length)+' saved runs are available as report baselines.');
}
function renderReportEditor() {
  const root=$('run-report-editor');if(!root)return;
  root.replaceChildren();if(!state.run)return;
  const run=state.run,known=new Map([...state.runs.runs,...state.baselines].map(row=>[row.run_id,row]));
  const options=[['','No previous run comparison']];
  for(const row of known.values())if(row.run_id!==run.run_id)options.push([row.run_id,(row.label||row.name||short(row.run_id))+' · '+when(row.created_at)]);
  if(state.beforeRunId&&!options.some(([id])=>id===state.beforeRunId))options.push([state.beforeRunId,short(state.beforeRunId)]);
  const baseline=select(options,state.beforeRunId,v=>{state.beforeRunId=v;});
  const direct=input(state.beforeRunId,{placeholder:'Optional complete original run ID',onInput:v=>{state.beforeRunId=v;}});
  baseline.addEventListener('change',()=>{direct.value=baseline.value;});
  const fields=el('div',undefined,'fields');fields.append(field('Previous saved run',baseline),field('Or enter its complete identifier',direct));
  const create=button('Create complete report',async()=>{
    const before=state.beforeRunId.trim();
    if(before&&!ID64.test(before))throw new Error('Use the full previous run identifier or leave it empty.');
    if(before===run.run_id)throw new Error('Choose a distinct previous saved run.');
    const body={workspace_id:state.workspace,run_id:run.run_id,expected_revision:run.review_revision};
    if(before)body.before_run_id=before;
    const result=await retained(API+'/report',body);await receiveResult(API+'/report',result);await loadStatus();
    notice('Immutable report created with the full definition, row accounting, saved queries and review history.','success');
  },{primary:true});
  root.append(panel('Report and handover',el('p','Freeze this run at decision revision '+run.review_revision+'. An optional previous run adds the complete native category and count changes, including groups absent from either run.','muted'),
    fields,toolbar(button('Load all saved baselines',loadBaselines),create),
    el('p','Decisions remain attached to their original run. A later run starts a separate review.','hint')));
}

async function openReport(id) {
  if(!ID64.test(id||''))throw new Error('Choose a complete saved report identifier.');
  state.report=await api(API+'/reports/'+id);state.export=null;state.changes=page('rows');
  if(state.report.before_run_id)await loadChanges(0);
  renderReports();show('reports');notice('The complete immutable report is open.');
}
async function loadChanges(offset=0) {
  if(!state.report?.before_run_id)return;
  state.changes={...page('rows'),...await api(API+'/reports/'+state.report.report_id+'/changes'+query({offset,limit:PAGE_SIZE}))};
  renderReportChanges();
}
function reportFiles(record) {
  const files=Array.isArray(record.files)?record.files:Object.entries(record.files||{}).map(([name,value])=>({...value,name}));
  for(const file of files) {
    if(typeof file.name!=='string'||!file.name||!Number.isSafeInteger(file.bytes)||file.bytes<0||!ID64.test(file.sha256||''))
      throw new Error('The original export must provide every complete filename, size and content hash.');
  }
  return files;
}
async function fileResponse(record,file) {
  if(!ID64.test(record.export_id||''))throw new Error('Open the original retained export before downloading.');
  const response=await fetch('/api/exports/'+record.export_id+'/file'+query({name:file.name}),
    {headers:{'X-DuckDB-Capability':capability,'X-DuckDB-Workspace-ID':state.workspace},cache:'no-store'});
  if(!response.ok){let result={};try{result=await response.json();}catch{}throw new Error(result.detail||result.error||'The original saved file could not be opened.');}
  const declared=response.headers.get('Content-Length');
  if(declared!==null && declared!==String(file.bytes))throw new Error('The download length differs from the original file manifest.');
  return response;
}
async function streamFile(record,file,handle) {
  const response=await fileResponse(record,file);
  if(!response.body)throw new Error('The local file stream is unavailable.');
  const writer=await handle.createWritable(),reader=response.body.getReader();let bytes=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>file.bytes)throw new Error('The original file stream exceeds its manifest.');await writer.write(value);}
    if(bytes!==file.bytes)throw new Error('The original file stream ended before its declared length.');
    await writer.close();
  }catch(error){await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}
async function downloadFile(record,file) {
  if(typeof window.showSaveFilePicker==='function'){
    let handle;
    try{handle=await window.showSaveFilePicker({suggestedName:file.name.split('/').pop()});}
    catch(error){if(error.name==='AbortError'){notice('Download cancelled.');return;}throw error;}
    await streamFile(record,file,handle);
  }else{
    const response=await fileResponse(record,file),blob=await response.blob();
    if(blob.size!==file.bytes)throw new Error('The complete downloaded bytes differ from the original file manifest.');
    const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=file.name.split('/').pop();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  notice('Complete original file prepared: '+file.name,'success');
}
async function saveExportFolder(record) {
  if(typeof window.showDirectoryPicker!=='function')throw new Error('This browser provides individual downloads. Download each listed original file, including the receiving guide and manifest.');
  const files=reportFiles(record);let parent;
  try{parent=await window.showDirectoryPicker({mode:'readwrite'});}
  catch(error){if(error.name==='AbortError'){notice('Folder save cancelled.');return;}throw error;}
  const root=await parent.getDirectoryHandle('reconciliation-'+record.export_id,{create:true});
  for(let i=0;i<files.length;i++){
    const file=files[i],parts=file.name.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||/[\\\u0000-\u001f]/.test(p)))throw new Error('The original export contains an invalid relative filename.');
    let directory=root;for(const component of parts.slice(0,-1))directory=await directory.getDirectoryHandle(component,{create:true});
    const handle=await directory.getFileHandle(parts.at(-1),{create:true});
    notice('Saving original file '+(i+1)+' of '+files.length+': '+file.name+'…');
    await streamFile(record,file,handle);
  }
  notice('All '+files.length+' complete original files were saved under reconciliation-'+record.export_id+'.','success');
}
function renderExport(record) {
  const files=reportFiles(record),list=el('div',undefined,'file-list');
  const last=Math.max(0,Math.ceil(files.length/PAGE_SIZE)-1)*PAGE_SIZE;
  const offset=Math.min(state.exportFilePages.get(record.export_id)||0,last);
  const paging=el('div',undefined,'pager');
  if(files.length>PAGE_SIZE)paging.append(el('span','Files '+count(offset+1)+'–'+count(Math.min(offset+PAGE_SIZE,files.length))+' of '+count(files.length)),toolbar(
    button('Previous files',async()=>{state.exportFilePages.set(record.export_id,Math.max(0,offset-PAGE_SIZE));renderReports();},{small:true,disabled:offset===0}),
    button('Next files',async()=>{state.exportFilePages.set(record.export_id,offset+PAGE_SIZE);renderReports();},{small:true,disabled:offset>=last})));
  for(const file of files.slice(offset,offset+PAGE_SIZE)) {
    const row=el('div',undefined,'file-row'),description=el('div');
    description.append(el('div',file.name,'file-name'),el('div',file.sha256,'file-hash mono'));
    row.append(description,el('div',count(file.bytes)+' bytes','file-size small-text'),button('Download',()=>downloadFile(record,file),{small:true}));
    list.append(row);
  }
  return panel('Complete portable handover',facts([['Export',record.export_id],['Native directory',record.directory],['Original files',files.length],['Saved',when(record.created_at)]]),
    toolbar(button('Save all files to a folder',()=>saveExportFolder(record),{disabled:typeof window.showDirectoryPicker!=='function'})),
    typeof window.showDirectoryPicker!=='function'?el('p','Download the complete files below. Their original names, byte lengths and hashes are retained in the native manifest.','hint'):null,
    list,paging,details('Complete original export record',record));
}
function renderReports() {
  const root=$('screen-reports');
  root.replaceChildren(heading('reports','Reports and handover','Reopen frozen reports, inspect changes against a previous run, and download the full native project with every original source file.'));
  const split=el('div',undefined,'split'),list=el('div',undefined,'item-list');
  for(const report of state.reports.reports)list.append(listItem('Report '+short(report.report_id),'Run '+short(report.run_id)+' · decision revision '+report.review_revision+' · '+when(report.created_at),()=>openReport(report.report_id),report.report_id===state.report?.report_id));
  if(!state.reports.reports.length)list.append(empty('Create a report from a saved reconciliation run.'));
  split.append(panel('Report catalog',list,pager(state.reports,loadReports)));
  const right=el('div'),report=state.report;
  if(!report)right.append(panel('Selected report',empty('Open an immutable report to review its complete scope and prepare the portable handover.')));
  else{
    right.append(panel('Frozen report',facts([['Report',report.report_id],['Run',report.run_id],['Decision revision',report.review_revision],['Source edition',report.source_edition],['Target edition',report.target_edition],['Previous run',report.before_run_id],['Saved',when(report.created_at)]]),
      el('div',undefined,'spacer'),summaryView(report.summary),
      toolbar(button('Open original run',()=>openRun(report.run_id)),button('Download report JSON',async()=>{
        saveJson(report,'reconciliation-'+report.report_id+'.json');notice('Complete report JSON download prepared.');
      }),button('Prepare complete handover',async()=>{
        const result=await retained(API+'/exports',{report_id:report.report_id});await receiveResult(API+'/exports',result);notice('Full native report export and warehouse handover prepared.','success');
      },{primary:true})),
      details('Complete frozen definition',report.definition),details('Complete immutable report',report)));
    if(report.before_run_id){
      const changes=panel('Changes from the previous run',
        el('p','These are the complete native group comparisons. Absence remains explicit, and decisions stay attached to the run where they were made.','muted'),
        report.scope_comparison?details('Full comparison scope',report.scope_comparison):null);
      const table=el('div');table.id='report-changes-grid';const paging=el('div');paging.id='report-changes-pager';changes.append(table,paging);right.append(changes);
    }
    const queries=panel('Original saved query recipes');
    for(const q of report.queries||[]){
      queries.append(panel(q.kind||q.name,facts([['Query name',q.name],['Query',q.query_id],['Revision',q.revision]]),
        details('Complete saved SQL and parameters',{sql:q.sql,parameters_text:q.parameters_text}),details('Full native query record',q)));
    }
    right.append(queries);
    if(state.export)right.append(renderExport(state.export));
  }
  split.append(right);root.append(split);renderReportChanges();
}
function renderReportChanges() {
  const gridRoot=$('report-changes-grid'),paging=$('report-changes-pager');
  if(!gridRoot||!paging)return;
  gridRoot.replaceChildren(grid(state.changes.columns||[],state.changes.rows||[]));
  paging.replaceChildren(pager(state.changes,loadChanges));
}
state.exportOperations=page('operations');
async function loadExportOperations(offset=0) {
  state.exportOperations={...page('operations'),...await api('/api/catalog/operations'+query({offset,limit:PAGE_SIZE}))};renderRequests();
}
function requestName(record) {
  const kind=record.route?.split('/').at(-1)||record.kind;
  return ({pairs:'Save pair revision',run:'Run reconciliation',decision:'Save review decision',report:'Create immutable report',exports:'Prepare complete handover'})[kind]||kind||'Saved native request';
}
function nativeRequestId(remote) {
  const id=remote.request_id;if(!ID32.test(id||''))throw new Error('The native request did not retain its original complete identifier.');return id;
}
async function receiveNativeRequest(remote,family) {
  const request_id=nativeRequestId(remote),body=remote.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||body.request_id!==request_id)throw new Error('The native request must include its complete original body and identifier.');
  let route;
  if(family==='export'){
    route=remote.route;
    if(route!==API+'/exports'||!ID64.test(body.report_id||''))throw new Error('Open this original dataset operation in Dataset workspace.');
  }else{
    if(!['pairs','run','decision','report'].includes(remote.kind)||body.workspace_id!==state.workspace)throw new Error('The native request belongs to another operation or workspace.');
    route=API+'/'+remote.kind;
  }
  const old=state.localRequests.find(x=>x.request_id===request_id);
  if(old&&(old.route!==route||keyBody(JSON.parse(old.body_text))!==keyBody(body)))throw new Error('The native request body differs from the retained original browser request.');
  const withoutId={...body};delete withoutId.request_id;
  const record=old||{key:requestKey(request_id),workspace_id:state.workspace,request_id,route,family,body_text:JSON.stringify(body),meaning:route+':'+keyBody(withoutId),created_at:remote.created_at||new Date().toISOString(),state:'REOPENED'};
  const merged={...record,remote,inspected_at:new Date().toISOString()};
  if(remote.state==='COMPLETE'&&remote.result){merged.state='COMPLETE';merged.result=remote.result;}
  await keepRequest(merged);state.requestDetails.set(request_id,remote);renderRequests();return merged;
}
async function openSavedResult(record,result) {
  const body=JSON.parse(record.body_text);
  if(record.route===API+'/exports'&&body.report_id!==state.report?.report_id){
    state.report=await api(API+'/reports/'+body.report_id);state.export=null;state.changes=page('rows');
    if(state.report.before_run_id)await loadChanges(0);
  }
  await receiveResult(record.route,result);notice('The result of the original saved request is open.');
}
function renderLocalRequest(record) {
  const remote=state.requestDetails.get(record.request_id)||record.remote;
  const p=panel(requestName(record),facts([['Request',record.request_id],['Browser record',record.state],['Native state',remote?.state],['Created',when(record.created_at)]]));
  p.dataset.requestId=record.request_id;p.dataset.requestRoute=record.route;p.dataset.requestState=record.state;
  if(record.last_error)p.append(el('p',record.last_error.message,'wrap small-text'));
  const actions=toolbar(button('Inspect original request',async()=>{
    try{await inspectRequest(record);renderRequests();notice('Original native request inspected.');}
    catch(error){if(error.status===404){state.requestDetails.set(record.request_id,{state:'NOT_FOUND',request_id:record.request_id});renderRequests();notice('The native journal has no record for this original identifier. Continue original request will send the retained body.');}else throw error;}
  },{small:true}));
  if(record.state==='COMPLETE'&&record.result)actions.append(button('Open saved result',()=>openSavedResult(record,record.result),{small:true}));
  else actions.append(button('Continue original request',async()=>{
    const result=await continueRequest(record);await openSavedResult(record,result);await loadStatus();
  },{small:true,primary:true}));
  p.append(actions,details('Complete original request body',record.body_text));
  if(remote)p.append(details('Complete native request record',remote));
  return p;
}
function renderNativeRequest(remote,family) {
  const id=remote.request_id,route=remote.route||API+'/'+remote.kind;
  const item=el('div',undefined,'panel subtle');item.dataset.nativeRequestId=id;item.dataset.nativeRequestFamily=family;
  item.append(facts([['Operation',requestName({...remote,route})],['Request',id],['Native state',remote.state],['Created',when(remote.created_at)]]));
  if(ID32.test(id||'')&&(family==='reconciliation'||route===API+'/exports')){
    item.append(toolbar(button('Reopen original request',async()=>{
      const full=await api((family==='export'?'/api':API)+'/requests/'+id);
      await receiveNativeRequest(full,family);notice('Complete original request and result reopened.');
    },{small:true})));
  }else{
    const a=el('a','Open Dataset workspace');a.href='/#'+capability;item.append(a);
  }
  return item;
}
function renderRequests() {
  const root=$('screen-requests');
  root.replaceChildren(heading('requests','Saved requests','Inspect the original request and reopen its result. Continuing a request uses its retained identifier and complete body.',
    button('Refresh request catalogs',async()=>{await loadLocalRequests();await loadOperations(0);await loadExportOperations(0);renderRequests();notice('Both original request catalogs refreshed.');})));
  const local=panel('Retained in this browser');
  if(state.storageError)local.append(el('p',state.storageError.message,'wrap'));
  if(!state.localRequests.length)local.append(empty('Pair, run, decision, report and handover actions retain their complete request here before sending.'));
  else for(const record of state.localRequests)local.append(renderLocalRequest(record));
  root.append(local);
  const native=panel('Reconciliation journal');
  for(const remote of state.operations.operations||[])native.append(renderNativeRequest(remote,'reconciliation'));
  if(!(state.operations.operations||[]).length)native.append(empty('No reconciliation requests are present on this catalog page.'));
  native.append(pager(state.operations,loadOperations));
  const exports=panel('Original dataset export journal',el('p','The same workspace journal owns report exports, source-file exports and portable warehouse handovers.','muted'));
  for(const remote of state.exportOperations.operations||[])exports.append(renderNativeRequest(remote,'export'));
  if(!(state.exportOperations.operations||[]).length)exports.append(empty('No original export requests are present on this catalog page.'));
  exports.append(pager(state.exportOperations,loadExportOperations));
  root.append(native,exports);
}
async function refreshLists() {
  await loadIdentity();
  await Promise.all([loadStatus(),loadPairs(0),loadRuns(0),loadReports(0),loadOperations(0),loadExportOperations(0)]);
  await loadLocalRequests();renderRequests();
  notice('Saved catalogs refreshed. The current definition and decision text remain in the editor.');
}
async function start() {
  renderPairs();renderEditor();renderRuns();renderReports();renderRequests();
  await loadIdentity();
  try {
    state.db=await openStorage();state.db.onversionchange=()=>{state.db.close();state.db=null;state.storageError=new Error('Browser request storage changed in another tab. Reopen this page to continue.');notice(state.storageError.message,'error');};
    await loadLocalRequests();
    const draft=await dbRead('drafts',state.workspace);
    if(draft?.workspace_id===state.workspace&&draft.definition)state.draft=draft;
  }catch(error){
    state.storageError=error;$('storage-notice').textContent='Browser request storage is unavailable. '+error.message;$('storage-notice').hidden=false;
  }
  let draftSourceError=null;
  if(state.draft){
    const opened=await Promise.allSettled([edition(state.draft.definition.source_edition),edition(state.draft.definition.target_edition)]);
    draftSourceError=opened.find(result=>result.status==='rejected')?.reason||null;
  }
  await Promise.all([loadStatus(),loadPairs(0),loadRuns(0),loadReports(0),loadOperations(0),loadExportOperations(0),loadEditions()]);
  renderEditor();renderRuns();renderReports();renderRequests();
  let screen='pairs';try{const saved=sessionStorage.getItem('stellar_duckdb_reconciliation_screen');if(['pairs','editor','runs','reports','requests'].includes(saved))screen=saved;}catch{}
  show(screen);
  const selectedPair=new URLSearchParams(location.search).get('pair');
  if(selectedPair!==null){
    if(!ID64.test(selectedPair))throw new Error('Choose a complete saved pair identifier in the workspace link.');
    await openPair(selectedPair);
    return;
  }
  if(draftSourceError)notice('The complete saved draft is retained. Its original edition could not be opened: '+(draftSourceError.message||String(draftSourceError)),'error');
  else notice('Original DuckDB workspace opened. Choose a saved pair or create a complete definition.');
}
$('dataset-home').href='/#'+capability;
$('timescale-intake-home').href='/timescale-intake/#'+capability;
$('refresh').addEventListener('click',()=>action('Refreshing saved catalogs',refreshLists));
document.querySelectorAll('nav [data-screen]').forEach(node=>node.addEventListener('click',()=>{
  if(state.busy)return;
  const name=node.dataset.screen;
  if(name==='editor')renderEditor();
  if(name==='runs')renderRuns();
  if(name==='reports')renderReports();
  if(name==='requests')renderRequests();
  show(name);
}));
window.addEventListener('pagehide',()=>{clearTimeout(state.draftTimer);if(state.draft&&state.db)saveDraft().catch(()=>{});});
action('Opening original workspace',start);
