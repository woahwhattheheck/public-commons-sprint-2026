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
  groups:page('rows'),rows:page('rows'),fields:page('rows'),normalizations:page('rows'),decisions:page('decisions'),changes:page('rows'),
  filters:{category:'',duplicates:'',side:'',status:'',group_id:''},
  fieldFilters:{group_id:'',column_name:'',state:''},fieldDetail:null,
  normalizationFilters:{side:'',column_name:'',state:'',group_id:''},normalizationDetail:null,normalizationPreviews:new WeakMap(),
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
  columns.forEach(col=>{const th=el('th',typeof col==='string'?col:(col.label||col.name));if(col.type)th.title=col.type;tr.append(th);});
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
    if(rowActions) { const td=el('td',undefined,'action-cell');td.append(rowActions(object,row));line.append(td); }
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
  state.normalizationPreviews=new WeakMap();
  document.querySelectorAll('[data-normalization-preview]').forEach(node=>{if(node.childNodes.length)node.replaceChildren(el('p','The definition changed. Preview the current conversion.','hint'));});
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
    split.append(panel(p.label||p.name,facts([['Name',p.name],['Pair',p.pair_id],['Revision',p.revision],['Source edition',p.definition.source_edition],['Target edition',p.definition.target_edition],['Saved',when(p.created_at)]]),actions,history,normalizationRulesView(p.definition,p.review?.normalizations),comparisonRulesView(p.definition,p.review?.comparison_rules),details('Complete saved definition',p.definition),details('Original mapping review',p.review)));
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
  },{small:true,disabled:values.length>=10000||Object.hasOwn(row,'normalization')})));
  return section;
}


const NORMALIZATION_STATES = {
  CONVERTED:['Converted','The original value is represented exactly in the reviewed canonical type.'],
  NULL_PRESERVED:['SQL NULL preserved','The original SQL NULL remains NULL. A NULL matching key retains its original quarantine rule.'],
  NOT_NUMERIC:['Not numeric','The original value is not valid numeric text for this reviewed conversion.'],
  NON_FINITE:['Nonfinite','The original numeric value is not finite.'],
  OUT_OF_RANGE:['Outside type range','The exact converted value is outside the reviewed canonical type or time range.'],
  PRECISION_LOSS:['Precision would be lost','The canonical type cannot represent the exact converted value.'],
  INVALID_TIME:['Invalid timestamp','The original value does not match its reviewed time format.'],
  OFFSET_REQUIRED:['Offset required','The original timestamp is missing an offset required by the reviewed rule.'],
  OFFSET_CONFLICT:['Offset conflict','The original timestamp conflicts with the reviewed embedded or fixed offset.'],
  SUBMICROSECOND:['Submicrosecond remainder','The original timestamp cannot be represented exactly at UTC microsecond precision.'],
  NUMERIC_LIMIT:['Numeric limit','The value exceeds the exact numeric conversion limits.']
};
const NORMALIZATION_COLUMNS = [
  ['side','Side'],['row','Original row'],['column_name','Field'],['original_value_text','Original value'],
  ['original_unit','Original unit'],['canonical_value_text','Canonical value'],['canonical_unit','Canonical unit'],
  ['state','Conversion result'],['reason','Reason']
].map(([name,label])=>({name,label}));
const NORMALIZATION_RUN_COLUMNS = [{name:'group_id',label:'Group'},...NORMALIZATION_COLUMNS];
const NORMALIZATION_FORMATS = [
  ['','Choose the original time representation'],['native','Native date or timestamp'],['iso8601','ISO 8601 text'],
  ['unix-seconds','Unix seconds'],['unix-milliseconds','Unix milliseconds'],
  ['unix-microseconds','Unix microseconds'],['unix-nanoseconds','Unix nanoseconds']
];
const normalizationObject=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exactNumericType=value=>/^(?:BIGINT|HUGEINT|DECIMAL\([0-9]+,\s*[0-9]+\))$/.test(value||'');
const normalizableNumericType=value=>/^(?:VARCHAR|BIGINT|HUGEINT|DOUBLE|DECIMAL\([0-9]+,\s*[0-9]+\))$/.test(value||'');
function hasRecordedNormalizations(run=state.run) { return Boolean(run?.normalizations); }
function normalizationEligible(row,mode) {
  if((row.source_map?.length||0)+(row.target_map?.length||0))return false;
  const types=['source','target'].map(side=>mappingType(side,row[side]));
  if(mode==='numeric-affine')return row.role==='value'&&types.every(normalizableNumericType);
  return ['key','value'].includes(row.role)&&types.every(type=>normalizableNumericType(type)||/^(?:DATE|TIMESTAMP|TIMESTAMPTZ)$/.test(type));
}
function normalizationInput(control,path) { control.dataset.normalizationPath=path;return control; }
function normalizationEditor(row,index) {
  const box=el('details',undefined,'normalization-rule');box.dataset.normalizationColumn=String(index);
  const present=Object.hasOwn(row,'normalization'),policy=row.normalization;
  const known=normalizationObject(policy)&&['numeric-affine','time-utc'].includes(policy.mode);
  const editable=known&&normalizationObject(policy.source)&&normalizationObject(policy.target);
  box.open=present;
  box.append(el('summary','Unit and time normalization · '+(present?(known?policy.mode==='numeric-affine'?'Reviewed numeric conversion':'Reviewed UTC time':'Retained policy needs review'):'Original native values')));
  const choices=[['native','Use original native values'],['numeric-affine','Reviewed numeric scale and offset'],['time-utc','Reviewed UTC timestamp']];
  if(present&&!known)choices.push(['unrecognized','Unrecognized retained normalization']);
  const mode=select(choices,present?(known?policy.mode:'unrecognized'):'native',value=>{
    if(value==='native')delete row.normalization;
    else if(['numeric-affine','time-utc'].includes(value)){
      if(!normalizationEligible(row,value)){notice('Choose compatible original columns and remove their literal value maps before selecting this normalization.','error');renderEditor();return;}
      row.normalization=value==='numeric-affine'?{
        mode:value,canonical_type:'',canonical_unit:'',source:{unit:'',scale:'1',offset:'0'},
        target:{unit:'',scale:'1',offset:'0'},basis:''
      }:{mode:value,canonical_type:'TIMESTAMPTZ',source:{format:'',offset:''},target:{format:'',offset:''},basis:''};
    }else return;
    edited();renderEditor();
  });
  for(const option of mode.options)if(option.value==='unrecognized'||(['numeric-affine','time-utc'].includes(option.value)&&!normalizationEligible(row,option.value)))option.disabled=true;
  box.append(field('Normalization mode',normalizationInput(mode,'mode'),'Choose the conversion explicitly for each side. Original source editions and values remain available.'));
  if(!present)return box;
  if(!editable){
    box.append(el('p','The complete imported policy is retained. Select original native values to remove it, select a compatible new mode, or correct the complete definition before review.','notice'),details('Complete retained normalization',policy));
    return box;
  }
  if(!normalizationEligible(row,policy.mode))box.append(el('p','This retained policy conflicts with the selected column types, role or literal maps. Resolve that conflict explicitly before reviewing the definition.','notice'));
  const set=(target,key,path,{placeholder='',length=240,hint='',label=key}={})=>{
    const control=input(target[key],{placeholder,maxLength:length,onInput:value=>{target[key]=value;edited();}});
    if(['scale','offset'].includes(key)&&policy.mode==='numeric-affine')control.inputMode='decimal';
    return field(label,normalizationInput(control,path),hint);
  };
  const canonical=el('div',undefined,'fields spacer');
  if(policy.mode==='numeric-affine'){
    canonical.append(set(policy,'canonical_type','canonical_type',{label:'Canonical SQL type',length:40,placeholder:'DECIMAL(30,6)',hint:'BIGINT, HUGEINT or DECIMAL(p,s), with at most 38 digits. Every converted value must fit exactly.'}),
      set(policy,'canonical_unit','canonical_unit',{label:'Canonical unit',placeholder:'kWh',hint:'The common unit used for grouping, comparison and any reviewed numeric tolerance.'}));
  }else canonical.append(field('Canonical SQL type',normalizationInput(input(policy.canonical_type,{readOnly:true}),'canonical_type'),'UTC TIMESTAMPTZ at exact microsecond precision.'));
  box.append(canonical);
  const sides=el('div',undefined,'normalization-sides');
  for(const side of ['source','target']){
    const current=policy[side],section=el('section',undefined,'normalization-side');
    section.append(el('h4',side==='source'?'Source conversion':'Target conversion'),el('p',row[side]+' · '+mappingType(side,row[side]),'type-label'));
    const controls=el('div',undefined,'fields');
    if(policy.mode==='numeric-affine'){
      controls.append(set(current,'unit',side+'.unit',{label:'Original '+side+' unit',hint:'Use the unit in this original source.'}),
        set(current,'scale',side+'.scale',{label:side==='source'?'Source scale':'Target scale',length:256,hint:'Nonzero signed decimal text. For example, 0.001 converts Wh to kWh.'}),
        set(current,'offset',side+'.offset',{label:side==='source'?'Source offset':'Target offset',length:256,hint:'Signed decimal text in the canonical unit, added after scaling.'}));
    }else{
      const options=[...NORMALIZATION_FORMATS];
      if(current.format&&!options.some(([value])=>value===current.format))options.push([current.format,String(current.format)+' · retained format']);
      const format=select(options,current.format,value=>{current.format=value;edited();renderEditor();});
      controls.append(field(side==='source'?'Source time format':'Target time format',normalizationInput(format,side+'.format'),'Select the actual native type, ISO text or explicit Unix unit.'),
        set(current,'offset',side+'.offset',{label:side==='source'?'Source time offset':'Target time offset',length:32,placeholder:'embedded, utc, or +01:00',hint:'Use embedded for aware native/ISO values, a fixed ±HH:MM for naive native/ISO values, and utc for Unix values.'}));
    }
    section.append(controls);sides.append(section);
  }
  box.append(sides);
  const basis=textarea(policy.basis,value=>{policy.basis=value;edited();},3);basis.maxLength=4000;
  box.append(field('Normalization review basis',normalizationInput(basis,'basis'),'Record the original units or time contract and the engineering decision behind this conversion.'));
  box.append(el('p',policy.mode==='numeric-affine'?'Canonical value = original value × scale + offset. Exact arithmetic retains decimal text; values that need rounding or exceed the chosen type are quarantined.':'Each side is converted to the same UTC instant. Missing or conflicting offsets, invalid times and submicrosecond remainders remain quarantined.','hint'));
  if(policy.mode==='numeric-affine'&&row.comparison?.mode==='numeric-tolerance'&&row.comparison.unit!==policy.canonical_unit)
    box.append(el('p','The numeric tolerance unit must match the reviewed canonical unit. Update the comparison rule explicitly.','notice'));
  const actions=toolbar();
  for(const side of ['source','target']){
    const preview=button(side==='source'?'Preview source conversions':'Preview target conversions',()=>loadNormalizationPreview(row,index,side,0));
    preview.dataset.normalizationPreviewAction=side;actions.append(preview);
  }
  box.append(actions,el('p','Previews read the complete current definition and page through every original value for this field. Editing the definition invalidates its previews.','hint'));
  for(const side of ['source','target'])box.append(normalizationPreviewView(row,index,side));
  box.append(details('Complete retained normalization',policy));
  return box;
}
async function loadNormalizationPreview(row,index,side,offset=0) {
  if(state.draft?.definition?.columns[index]!==row)throw new Error('Reopen the current field before previewing its conversion.');
  const definition=clone(state.draft.definition),meaning=keyBody(definition),version=state.draftVersion;
  const result=await api(API+'/normalization-preview',{definition,side,column_name:row.name,offset,limit:25});
  if(version!==state.draftVersion||meaning!==keyBody(state.draft.definition))throw new Error('The definition changed during conversion preview. Preview its current revision.');
  if(result.workspace_id!==state.workspace||result.side!==side||result.column_name!==row.name||!ID64.test(result.review_sha256||'')||result.offset!==offset)
    throw new Error('The conversion preview did not retain its original workspace, side, field and review.');
  const saved=state.normalizationPreviews.get(row)||{};saved[side]={...result,definition:meaning,detail:null};
  state.normalizationPreviews.set(row,saved);renderEditor();
  notice('Original '+side+' values and reviewed conversions opened for '+row.name+'.');
}
function normalizationPreviewView(row,index,side) {
  const box=el('section',undefined,'normalization-preview');box.dataset.normalizationPreview=side;
  const result=state.normalizationPreviews.get(row)?.[side];if(!result)return box;
  box.append(el('h4',side==='source'?'Source conversion preview':'Target conversion preview'),
    grid(NORMALIZATION_COLUMNS,nativeGridObjects(result),(visible,original)=>toolbar(button('Inspect conversion',async()=>{
      result.detail=clone(original);renderEditor();
    },{small:true}))),pager(result,offset=>loadNormalizationPreview(row,index,side,offset)));
  if(result.detail)box.append(normalizationInspection(result.detail));
  return box;
}
function normalizationInspection(object) {
  const code=String(scalar(object.state)),meaning=NORMALIZATION_STATES[code],box=el('section',undefined,'normalization-inspection');
  box.append(el('h4',nativeText(object.column_name)+' · '+(meaning?.[0]||code)),el('p',meaning?.[1]||nativeText(object.reason),'hint'),
    facts([['Side',object.side],['Original row',object.row],['Original column',object.original_column],['Role',object.role],
      ['Original SQL type',object.original_sql_type],['Canonical SQL type',object.canonical_sql_type],['Mode',object.mode]]),
    grid(['Quantity','Exact recorded value'],[['Original value',object.original_value_text],['Original unit',object.original_unit],
      ['Canonical value',object.canonical_value_text],['Canonical unit',object.canonical_unit],['Reason',object.reason]]),
    details('Exact conversion numbers',{original:object.original_exact_numeric,canonical:object.canonical_exact_numeric}),
    details('Reviewed normalization policy',scalar(object.policy_json)),details('Complete recorded normalization',object));
  if(!['CONVERTED','NULL_PRESERVED'].includes(code))box.append(el('p','A retained mathematical candidate is diagnostic. A failed conversion has no accepted canonical value and does not enter comparison grouping.','hint'));
  return box;
}
function normalizationRulesView(definition,contract) {
  const columns=contract?.columns||(definition?.columns||[]).flatMap((column,index)=>Object.hasOwn(column,'normalization')?[{index,name:column.name,role:column.role,normalization:column.normalization}]:[]);
  if(!columns.length)return null;
  const box=el('section',undefined,'normalization-summary');box.append(el('h4','Reviewed unit and time normalization'));
  for(const column of columns){
    const policy=column.normalization,known=normalizationObject(policy),entry=el('details',undefined,'normalization-record');
    entry.append(el('summary',column.name+' · '+(known?policy.mode:'Retained policy')),
      facts([['Role',column.role],['Original source type',column.source_type],['Original target type',column.target_type],
        ['Canonical type',column.canonical_type||(known?policy.canonical_type:'')]]));
    if(known&&normalizationObject(policy.source)&&normalizationObject(policy.target)){
      entry.append(grid(['Side','Original unit / format','Scale','Offset','Canonical unit'],
        ['source','target'].map(side=>[side,policy[side].unit??policy[side].format,policy[side].scale??null,policy[side].offset,policy.canonical_unit??'UTC'])),
        el('p',policy.basis||'Review basis is not recorded.','wrap'));
    }
    entry.append(details('Complete normalization policy',policy));box.append(entry);
  }
  box.append(el('p','Every original value and conversion result remains available. Numeric values must fit the reviewed type exactly; time values retain the same UTC instant at microsecond precision.','hint'));
  if(contract)box.append(details('Complete frozen normalizations',contract));
  return box;
}
function normalizationCounts(summary) {
  if(!summary)return null;
  const box=el('section',undefined,'normalization-accounting');box.append(el('h4','Conversion accounting'),
    grid(['Transformed values','Source','Target'],[['Original values',summary.source?.values,summary.target?.values],
      ['Converted exactly',summary.source?.converted,summary.target?.converted],['SQL NULL preserved',summary.source?.nulls,summary.target?.nulls],
      ['Conversion failed',summary.source?.failed,summary.target?.failed]]));
  const source=new Map((summary.source?.states||[]).map(row=>[row.state,row.values])),target=new Map((summary.target?.states||[]).map(row=>[row.state,row.values]));
  const states=[...new Set([...source.keys(),...target.keys()])];
  if(states.length)box.append(grid(['Recorded result','Source values','Target values'],states.map(key=>[NORMALIZATION_STATES[key]?.[0]||key,source.get(key)??0,target.get(key)??0])));
  box.append(el('p','These counts describe transformed field values. Complete row accounting above includes every original row.','hint'));
  return box;
}
async function loadNormalizations(offset=0) {
  if(!hasRecordedNormalizations()){state.normalizations={...page('rows'),unavailable:true};renderRunTable();return;}
  const selected=state.normalizationFilters,group=selected.group_id===''?undefined:indexValue(selected.group_id,'group');
  const result=await api(runPath('normalizations')+query({offset,limit:PAGE_SIZE,side:selected.side,column_name:selected.column_name,state:selected.state,group_id:group}));
  if(result.run_id!==state.run.run_id)throw new Error('The normalization page belongs to another saved run.');
  state.normalizations={...page('rows'),...result};renderRunTable();
}
async function groupNormalizations(object) {
  state.normalizationFilters={side:'',column_name:'',state:'',group_id:String(indexValue(object.group_id,'group'))};
  state.runTab='normalizations';await loadNormalizations(0);renderRunDetail();notice('Every recorded conversion in the original key group opened.');
}
async function chooseNormalization(object) {
  await chooseRow(object);state.normalizationDetail=clone(object);renderSubject();
  notice('The complete conversion and every original field in its source row are open.');
}

const FIELD_STATES = {
  EXACT_EQUAL:['Exact equality','The reviewed canonical values are exactly equal under this field’s comparison.'],
  EXACT_DIFFERENT:['Exact difference','The reviewed canonical values differ and this field has no tolerance rule.'],
  NULLS_EQUAL:['Both NULL, accepted','Both values are SQL NULL and the reviewed rule explicitly treats two NULLs as equal.'],
  WITHIN_TOLERANCE:['Within tolerance','The exact absolute difference is within the allowance from this reviewed rule.'],
  OUTSIDE_TOLERANCE:['Outside tolerance','The exact absolute difference exceeds the allowance from this reviewed rule.'],
  NULL_NOT_COMPARABLE:['NULL, not comparable','A value is SQL NULL and the reviewed rule does not establish an accepted comparison.'],
  NON_FINITE_NOT_COMPARABLE:['Nonfinite, not comparable','A native numeric value is nonfinite, so this rule cannot establish a comparison.'],
  DUPLICATE_NOT_PAIRED:['Duplicate group','This group retains exact multiset accounting. Open all group rows to inspect every observation.'],
  ONE_SIDED:['One side only','The known key is present on only one side. No counterpart or numeric difference is inferred.'],
  QUARANTINED:['Quarantined','The original row or group is quarantined. Open the original rows to inspect its recorded reason.']
};
const FIELD_COLUMNS = [
  ['group_id','Group'],['column_name','Field'],['source_value_text','Source value'],
  ['target_value_text','Target value'],['state','Comparison result'],['absolute_difference','Absolute difference'],
  ['allowed_difference','Allowed difference'],['unit','Comparison unit']
].map(([name,label])=>({name,label}));
function hasRecordedFields(run=state.run) { return Boolean(run?.comparison_rules||run?.normalizations); }
function nativeGridObjects(record) {
  const names=(record.columns||[]).map(column=>typeof column==='string'?column:column.name);
  return (record.rows||[]).map(row=>Array.isArray(row)?Object.fromEntries(names.map((name,index)=>[name,row[index]])):row);
}
function numericRuleEligible(row) {
  if(Object.hasOwn(row,'normalization'))return row.role==='value'&&row.normalization?.mode==='numeric-affine'&&exactNumericType(row.normalization.canonical_type);
  const source=mappingType('source',row.source),target=mappingType('target',row.target);
  return row.role==='value'&&source===target&&/^(?:BIGINT|HUGEINT|DOUBLE|DECIMAL(?:\([0-9]+,\s*[0-9]+\))?)$/.test(source);
}
function comparisonEditor(row,index) {
  const section=el('details',undefined,'comparison-rule');
  section.dataset.comparisonColumn=String(index);
  const present=Object.hasOwn(row,'comparison'),rule=row.comparison;
  const known=present&&rule&&typeof rule==='object'&&!Array.isArray(rule)&&rule.mode==='numeric-tolerance';
  section.open=present;
  section.append(el('summary','Comparison rule · '+(present?'Reviewed numeric tolerance':'Exact native values')));
  const eligible=numericRuleEligible(row),options=[['exact','Exact native comparison'],['numeric-tolerance','Reviewed numeric tolerance']];
  if(present&&!known)options.push(['unrecognized','Unrecognized retained rule']);
  const mode=select(options,present?(known?'numeric-tolerance':'unrecognized'):'exact',value=>{
    if(value==='exact')delete row.comparison;
    else if(value==='numeric-tolerance'){
      if(!numericRuleEligible(row))throw new Error('Choose a compared value with identical native numeric types or an explicit exact canonical numeric type before adding its rule.');
      row.comparison={mode:'numeric-tolerance',absolute:'0',relative:'0',unit:'',nulls:'',basis:''};
    }else return;
    edited();renderEditor();
  });
  for(const option of mode.options)if(option.value==='unrecognized'||(option.value==='numeric-tolerance'&&!eligible))option.disabled=true;
  section.append(field('Comparison mode',mode,
    'Matching keys remain exact. Numeric tolerances apply to a common native numeric type or the reviewed exact canonical numeric type.'));
  if(!present)return section;
  if(!known){
    section.append(el('p','The complete imported rule is retained. Choose exact comparison to remove it, or correct the full definition and review it.','hint'),details('Retained comparison object',rule));
    return section;
  }
  if(!eligible)section.append(el('p','This retained rule no longer matches the selected role or native types. Choose compatible compared-value columns, or explicitly change its mode to exact comparison.','notice'));
  const fields=el('div',undefined,'fields three spacer');
  const coefficient=key=>{const control=input(rule[key],{maxLength:256,onInput:value=>{rule[key]=value;edited();}});control.inputMode='decimal';return control;};
  fields.append(
    field('Absolute allowance',coefficient('absolute'),'Nonnegative decimal text, in the reviewed comparison unit.'),
    field('Relative fraction',coefficient('relative'),'A fraction from 0 to 1. For example, 0.005 means 0.5%.'),
    field('Comparison unit',input(rule.unit,{maxLength:240,onInput:value=>{rule.unit=value;edited();}}),row.normalization?.mode==='numeric-affine'?'Use the reviewed canonical unit: '+(row.normalization.canonical_unit||'enter the normalization unit first')+'.':'Record the common unit already used by both native columns.'),
    field('Two SQL NULL values',select([['','Choose the missing-value rule'],['equal','Treat two NULLs as equal'],['uncomparable','Leave two NULLs not comparable']],rule.nulls,value=>{rule.nulls=value;edited();})));
  const basis=textarea(rule.basis,value=>{rule.basis=value;edited();},3);basis.maxLength=4000;
  fields.append(field('Review basis',basis,'Explain the source specification or engineering decision behind this allowance.'));
  section.append(fields,el('p','Accepted when |source − target| ≤ absolute + relative × max(|source|, |target|).','comparison-formula'),
    el('p','The native comparison keeps the original numbers and your literal coefficient text. One NULL or a nonfinite numeric value is not comparable. Duplicate groups use their original exact multiset accounting.','hint'));
  return section;
}
function comparisonRulesView(definition,contract) {
  const columns=definition?.columns||[],rules=contract?.columns||
    columns.flatMap((column,index)=>Object.hasOwn(column,'comparison')?[{index,name:column.name,comparison:column.comparison}]:[]);
  if(!rules.length)return null;
  const box=el('section',undefined,'comparison-summary');
  box.append(el('h4','Reviewed numeric rules'),el('p',
    'Accepted when |source − target| ≤ absolute + relative × max(|source|, |target|). Coefficients below retain their original text.','hint'));
  box.append(grid(['Field','Native type','Absolute allowance','Relative fraction','Comparison unit','Two NULLs','Review basis'],
    rules.map(column=>{const rule=column.comparison||{};return [column.name,column.type||'',rule.absolute,rule.relative,rule.unit,
      rule.nulls==='equal'?'Accepted as equal':rule.nulls==='uncomparable'?'Not comparable':rule.nulls,rule.basis];})));
  box.append(el('p','Matching keys and fields without a rule compare exactly. Duplicate groups retain exact multiplicity; no tolerance-based row pairing is created.','hint'));
  if(contract)box.append(details('Complete frozen comparison rules',contract));
  return box;
}
async function loadFields(offset=0) {
  if(!hasRecordedFields()){state.fields={...page('rows'),unavailable:true};renderRunTable();return;}
  const group=state.fieldFilters.group_id===''?undefined:indexValue(state.fieldFilters.group_id,'group');
  try{
    state.fields={...page('rows'),...await api(runPath('fields')+query({offset,limit:PAGE_SIZE,
      group_id:group,column_name:state.fieldFilters.column_name,state:state.fieldFilters.state}))};
  }catch(error){
    if(error.code!=='FIELDS_NOT_RECORDED')throw error;
    state.fields={...page('rows'),unavailable:true};
  }
  renderRunTable();
}
async function groupFields(object) {
  state.fieldFilters={group_id:String(indexValue(object.group_id,'group')),column_name:'',state:''};
  state.runTab='fields';await loadFields(0);renderRunDetail();notice('Every recorded value field in this key group opened.');
}
async function chooseField(object) {
  state.subject=groupSubject(object);state.rowDetail=null;state.fieldDetail=clone(object);
  renderSubject();renderDecisionEditor();
  notice('The complete recorded field is open. Review decisions apply to its original key group.');
  $('selected-subject')?.scrollIntoView({block:'nearest'});
}
function fieldInspection(object) {
  const result=String(scalar(object.state)),meaning=FIELD_STATES[result],box=el('section',undefined,'field-inspection');
  box.append(el('h4',nativeText(object.column_name)+' · '+(meaning?.[0]||result)),el('p',meaning?.[1]||'Read the complete original field record.','hint'));
  box.append(facts([['Native SQL type',object.sql_type],['Source column',object.source_column],['Target column',object.target_column],
    ['Source observations',object.source_count],['Target observations',object.target_count],['Source row',object.source_row],['Target row',object.target_row]]));
  box.append(el('div',undefined,'spacer'),grid(['Quantity','Exact recorded value'],[
    ['Source value',object.source_value_text],['Target value',object.target_value_text],
    ['Signed difference (target − source)',object.signed_difference],['Absolute difference',object.absolute_difference],
    ['Relative scale: max(|source|, |target|)',object.relative_scale],['Allowed difference',object.allowed_difference],['Comparison unit',object.unit]]));
  if(scalar(object.rule_json)!==null)box.append(details('Reviewed field rule',scalar(object.rule_json)));
  if(hasRecordedNormalizations())box.append(el('p','For normalized fields, the source and target text above retains the original values. Exact numbers, differences and allowances use the reviewed canonical type and unit. Open the group conversions to inspect every transformation.','hint'));
  box.append(details('Exact native numeric representation',{source:object.source_exact_numeric,target:object.target_exact_numeric}),
    details('Complete recorded field',object),toolbar(button('All group rows',()=>groupRows(object),{small:true}),hasRecordedNormalizations()?button('Group conversions',()=>groupNormalizations(object),{small:true}):null));
  return box;
}

function mappingTable() {
  const box=el('div',undefined,'table-scroll'),table=el('table'),head=el('thead'),header=el('tr'),body=el('tbody');
  ['Canonical field','Source column','Target column','Role','Meaning',''].forEach(name=>header.append(el('th',name)));
  head.append(header);table.append(head,body);box.append(table);
  state.draft.definition.columns.forEach((row,index)=>{
    const tr=el('tr'),name=el('td'),source=el('td'),target=el('td'),role=el('td'),meaning=el('td'),actions=el('td');
    name.append(input(row.name,{maxLength:120,required:true,onInput:v=>{row.name=v;edited();}}));
    const sourceType=el('span',mappingType('source',row.source),'type-label');
    source.append(select(columnOptions('source',row.source),row.source,v=>{row.source=v;sourceType.textContent=mappingType('source',v);edited();renderEditor();}),sourceType);
    const targetType=el('span',mappingType('target',row.target),'type-label');
    target.append(select(columnOptions('target',row.target),row.target,v=>{row.target=v;targetType.textContent=mappingType('target',v);edited();renderEditor();}),targetType);
    role.append(select([['key','Matching key'],['value','Compared value']],row.role,v=>{row.role=v;edited();renderEditor();}));
    meaning.append(textarea(row.meaning,v=>{row.meaning=v;edited();},2));
    actions.append(button('Remove',async()=>{state.draft.definition.columns.splice(index,1);edited();renderEditor();},{small:true}));
    tr.append(name,source,target,role,meaning,actions);body.append(tr);
    const detailRow=el('tr',undefined,'mapping-row-detail'),cell=el('td');cell.colSpan=6;
    const d=el('details'),summary=el('summary','Exact value maps · '+(row.source_map.length+row.target_map.length)+' entries');
    d.open=row.source_map.length+row.target_map.length>0;
    const maps=el('div',undefined,'equal-columns spacer');maps.append(renderValueMap(row,'source'),renderValueMap(row,'target'));
    d.append(summary,el('p','Value maps apply only to VARCHAR fields and cannot coexist with unit or time normalization. With a map, every non-null original string needs an explicit entry; missing values are quarantined. Spaces, case and empty strings are preserved. Native NULL stays NULL.','hint'),maps);
    cell.append(normalizationEditor(row,index),comparisonEditor(row,index),d);detailRow.append(cell);body.append(detailRow);
  });
  if(!state.draft.definition.columns.length){const tr=el('tr'),td=el('td','Add the fields to compare. Choose at least one matching key.','muted');td.colSpan=6;tr.append(td);body.append(tr);}
  return box;
}
function windowsEditor() {
  const definition=state.draft.definition,box=el('div',undefined,'stack');
  const options=[['','All rows / no window column'],...definition.columns.filter(c=>c.name).map(c=>[c.name,c.name])];
  if(definition.window_column&&!options.some(([key])=>key===definition.window_column))options.push([definition.window_column,definition.window_column+' · missing canonical field']);
  box.append(field('Window field',select(options,definition.window_column||'',v=>{definition.window_column=v||null;edited();}),
    'Windows use the reviewed canonical value, with bounds that fit its SQL type exactly. Each window includes its start and excludes its end; no windows includes all rows.'));
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
  const normalization=normalizationRulesView(review.definition,review.normalizations);if(normalization)root.append(normalization);
  const rules=comparisonRulesView(review.definition,review.comparison_rules);if(rules)root.append(rules);
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
  root.replaceChildren(heading('editor','Pair definition','Choose the exact source fields and their meanings. Keep the native values or review explicit unit and time conversions before grouping and comparison.',button('New pair',newPair)));
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
  state.run=await api(API+'/runs/'+id);state.subject=null;state.rowDetail=null;state.fieldDetail=null;state.normalizationDetail=null;state.decisionReason='';
  state.fields=page('rows');state.fieldFilters={group_id:'',column_name:'',state:''};
  state.normalizations=page('rows');state.normalizationFilters={side:'',column_name:'',state:'',group_id:''};
  if(!hasRecordedNormalizations()&&state.runTab==='normalizations')state.runTab='groups';
  if(!hasRecordedFields()){if(state.runTab==='fields')state.runTab='groups';if(state.filters.category==='TOLERANCE_MATCHED')state.filters.category='';}
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
  else if(state.runTab==='fields')await loadFields(offset);
  else if(state.runTab==='normalizations')await loadNormalizations(offset);
  else await loadDecisions(offset);
}
function summaryView(summary) {
  const wrapper=el('div'),rows=[];
  const labels={total:'Original rows',included:'Included in comparison',quarantined:'Quarantined',excluded:'Outside declared windows',
    canonical_matched:'Canonical exact matches',exact_matched:'Accepted exact matches',tolerance_matched:'Accepted tolerance matches',
    matched:'Matched rows',unmatched:'Unmatched included rows'};
  for(const key of ['total','included','quarantined','excluded','canonical_matched','exact_matched','tolerance_matched','matched','unmatched']){
    if(['canonical_matched','exact_matched','tolerance_matched'].includes(key)&&summary?.source?.[key]===undefined&&summary?.target?.[key]===undefined)continue;
    rows.push([labels[key],summary?.source?.[key],summary?.target?.[key]]);
  }
  const table=grid(['Row accounting','Source','Target'],rows);table.classList.add('summary-table');wrapper.append(table);
  const groups=summary?.groups||{},metrics=el('div',undefined,'metric-line');
  for(const name of ['MATCHED','TOLERANCE_MATCHED','SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE'])
    if(groups[name]!==undefined)metrics.append(el('span',name.replaceAll('_',' ')+' '+count(groups[name]),'tag'));
  if(groups.duplicate_groups!==undefined)metrics.append(el('span','DUPLICATE KEY GROUPS '+count(groups.duplicate_groups),'tag'));
  wrapper.append(metrics);
  if(summary?.source?.tolerance_matched!==undefined||summary?.target?.tolerance_matched!==undefined)
    wrapper.append(el('p','Matched rows = accepted exact matches + accepted tolerance matches. Canonical exact matches retain the original value multiplicities before the reviewed numeric and NULL rules.','hint'));
  wrapper.append(el('p',summary?.accounting_balanced===true?'Native row accounting is balanced. Quarantined and excluded rows remain available for review.':'Read the complete native accounting result before interpreting the comparison.','hint'));
  if(summary?.scope_note)wrapper.append(el('p',summary.scope_note,'hint'));
  const conversions=normalizationCounts(summary?.normalizations);if(conversions)wrapper.append(conversions);
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
    normalizationRulesView(null,run.normalizations),comparisonRulesView(null,run.comparison_rules),details('Complete run record',run));
  root.append(summary);
  const review=panel('Review groups and rows'),tabs=el('div',undefined,'tabs');tabs.setAttribute('role','tablist');
  for(const [key,label] of [['groups','Key groups'],...(hasRecordedFields()?[['fields','Field differences']]:[]),...(hasRecordedNormalizations()?[['normalizations','Normalizations']]:[]),['rows','Original rows'],['decisions','Decision history']]){
    const b=button(label,async()=>{state.runTab=key;await loadRunTab(0);renderRunDetail();notice(label+' opened.');});
    b.setAttribute('role','tab');b.setAttribute('aria-selected',String(state.runTab===key));tabs.append(b);
  }
  review.append(tabs);
  if(!hasRecordedFields())review.append(el('p','Per-field differences were not recorded for this run. Its complete key groups and original rows remain available.','hint'));
  const filters=el('div',undefined,'filters');
  if(state.runTab==='groups'){
    const category=select([['','All categories'],...['MATCHED',...(hasRecordedFields()?['TOLERANCE_MATCHED']:[]),'SOURCE_ONLY','TARGET_ONLY','VALUE_DIFFERENCE','MULTISET_DIFFERENCE','NOT_COMPARABLE'].map(v=>[v,v.replaceAll('_',' ')])],state.filters.category);
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
  }else if(state.runTab==='fields'){
    const group=input(state.fieldFilters.group_id,{placeholder:'All groups'});
    const column=input(state.fieldFilters.column_name,{placeholder:'Every compared value field'});
    const result=select([['','All recorded states'],...Object.entries(FIELD_STATES).map(([key,value])=>[key,value[0]])],state.fieldFilters.state);
    filters.append(field('Field group identifier',group),field('Canonical value field',column),field('Field result',result),
      button('Apply field filters',async()=>{
        if(group.value.trim())indexValue(group.value.trim(),'group');
        state.fieldFilters={group_id:group.value.trim(),column_name:column.value,state:result.value};
        await loadFields(0);notice('Recorded field selection updated.');
      }),button('All recorded fields',async()=>{
        state.fieldFilters={group_id:'',column_name:'',state:''};await loadFields(0);renderRunDetail();notice('All recorded fields opened.');
      }));
  }
  if(state.runTab==='normalizations'){
    const chosen=state.normalizationFilters,side=select([['','Both sides'],['source','Source'],['target','Target']],chosen.side);
    const column=input(chosen.column_name,{placeholder:'Every normalized field'}),group=input(chosen.group_id,{placeholder:'All groups'});
    const result=select([['','All conversion results'],...Object.entries(NORMALIZATION_STATES).map(([key,value])=>[key,value[0]])],chosen.state);
    filters.append(field('Normalization side',side),field('Normalized field',column),field('Conversion result',result),field('Normalization group identifier',group),
      button('Apply normalization filters',async()=>{
        if(group.value.trim())indexValue(group.value.trim(),'group');
        state.normalizationFilters={side:side.value,column_name:column.value,state:result.value,group_id:group.value.trim()};
        await loadNormalizations(0);notice('Recorded conversion selection updated.');
      }),button('All recorded conversions',async()=>{
        state.normalizationFilters={side:'',column_name:'',state:'',group_id:''};await loadNormalizations(0);renderRunDetail();
      }));
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
  state.subject=groupSubject(object);state.rowDetail=null;state.fieldDetail=null;state.normalizationDetail=null;renderSubject();renderDecisionEditor();
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
  state.subject=subject;state.rowDetail=detail;state.fieldDetail=null;state.normalizationDetail=null;renderSubject();renderDecisionEditor();
  notice('Complete '+subject.side+' row '+subject.row+' opened.');$('selected-subject')?.scrollIntoView({block:'nearest'});
}
function renderRunTable() {
  const root=$('run-grid'),paging=$('run-grid-pager');if(!root||!paging||!state.run)return;
  root.replaceChildren();paging.replaceChildren();
  if(state.runTab==='groups'){
    root.append(grid(state.groups.columns||[],state.groups.rows||[],object=>toolbar(
      button('Review group',()=>chooseGroup(object),{small:true}),button('All group rows',()=>groupRows(object),{small:true}),
      hasRecordedFields()?button('Field differences',()=>groupFields(object),{small:true}):null,
      hasRecordedNormalizations()?button('Group conversions',()=>groupNormalizations(object),{small:true}):null)));
    paging.append(pager(state.groups,loadGroups));
  }else if(state.runTab==='rows'){
    root.append(grid(state.rows.columns||[],state.rows.rows||[],object=>toolbar(button('Open full row',()=>chooseRow(object),{small:true}))));
    paging.append(pager(state.rows,loadRows));
  }else if(state.runTab==='fields'){
    if(state.fields.unavailable){root.append(empty('Per-field differences were not recorded for this original run. Reopen its key groups or original rows.'));return;}
    root.append(el('p','Inspect a field for its full rule, exact numeric representations and signed difference. Duplicate groups retain all original observations without a chosen row pairing.','hint'),
      grid(FIELD_COLUMNS,nativeGridObjects(state.fields),(visible,original)=>toolbar(
        button('Inspect field',()=>chooseField(original),{small:true}),
        button('Review group',()=>chooseGroup(original),{small:true}),button('All group rows',()=>groupRows(original),{small:true}))));
    paging.append(pager(state.fields,loadFields));
  }else if(state.runTab==='normalizations'){
    if(state.normalizations.unavailable){root.append(empty('This original run has no recorded normalization. Its original rows and key groups remain available.'));return;}
    root.append(el('p','Every transformed field retains its original value, exact candidate, accepted canonical value and result. Inspect a conversion to open all fields in its original row.','hint'),
      grid(NORMALIZATION_RUN_COLUMNS,nativeGridObjects(state.normalizations),(visible,original)=>toolbar(
        button('Inspect conversion',()=>chooseNormalization(original),{small:true}))));
    paging.append(pager(state.normalizations,loadNormalizations));
  }else {
    const list=el('div',undefined,'item-list');
    for(const decision of state.decisions.decisions||[]){
      const p=panel(decision.outcome||'Decision',
        facts([['Actor',decision.actor],['Subject',decision.subject],['Decision sequence',decision.sequence??decision.revision??decision.review_revision],['Saved',when(decision.created_at)]]),
        el('p',decision.reason||'','wrap'),details('Complete saved decision',decision));
      const subject=decision.subject;
      if(subject)p.append(toolbar(button('Review this subject',async()=>{
        state.subject=clone(subject);state.rowDetail=null;state.fieldDetail=null;state.normalizationDetail=null;
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
  if(state.fieldDetail&&subject.kind==='group'&&indexValue(state.fieldDetail.group_id,'group')===subject.group_id)selected.append(fieldInspection(state.fieldDetail));
  if(state.normalizationDetail&&subject.kind==='row'&&scalar(state.normalizationDetail.side)===subject.side&&indexValue(state.normalizationDetail.row,'row')===subject.row)selected.append(normalizationInspection(state.normalizationDetail));
  if(state.rowDetail){
    selected.append(facts([['Original edition',state.rowDetail.edition_id],['Side',state.rowDetail.side],['Row index',state.rowDetail.row]]));
    const original=state.rowDetail.original||{},canonical=state.rowDetail.canonical||{};
    selected.append(el('h4','Every original field','spacer'),grid(['Original field','Native value'],Object.entries(original)),
      el('h4','Canonical comparison values','spacer'),grid(['Canonical field','Native value'],Object.entries(canonical)),
      details('Complete original and canonical row',state.rowDetail));
  }else selected.append(el('p','The decision applies to this complete key group. Open All group rows to inspect both sides and every duplicate.','muted'));
  selected.append(toolbar(button('Clear selection',async()=>{state.subject=null;state.rowDetail=null;state.fieldDetail=null;state.normalizationDetail=null;renderSubject();renderDecisionEditor();notice('Review selection cleared.');},{small:true})));
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
      normalizationRulesView(report.definition,report.review?.normalizations),comparisonRulesView(report.definition,report.review?.comparison_rules),details('Complete frozen definition',report.definition),details('Complete immutable report',report)));
    if(report.before_run_id){
      const changes=panel('Changes from the previous run',
        el('p','These are the complete native group comparisons. Absence remains explicit, and decisions stay attached to the run where they were made.','muted'),
        report.scope_comparison&&Object.hasOwn(report.scope_comparison,'normalizations_equal')?facts([['Normalization policy',report.scope_comparison.normalizations_equal?'Unchanged':'Changed']]):null,
        report.scope_comparison?details('Full comparison scope',report.scope_comparison):null);
      const table=el('div');table.id='report-changes-grid';const paging=el('div');paging.id='report-changes-pager';changes.append(table,paging);right.append(changes);
    }
    const queries=panel('Original saved query recipes');
    for(const q of report.queries||[]){
      queries.append(panel(q.kind==='fields'?'Complete field differences':q.kind==='normalizations'?'Complete normalization records':q.kind||q.name,
        q.kind==='fields'?el('p','The complete handover includes every recorded field, original value, exact difference, allowance and rule in the original CSV and Parquet query exports.','hint'):q.kind==='normalizations'?el('p','The complete CSV and Parquet exports retain every original value, exact conversion candidate, canonical value, policy, result and failure reason.','hint'):null,
        facts([['Query name',q.name],['Query',q.query_id],['Revision',q.revision]]),
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
