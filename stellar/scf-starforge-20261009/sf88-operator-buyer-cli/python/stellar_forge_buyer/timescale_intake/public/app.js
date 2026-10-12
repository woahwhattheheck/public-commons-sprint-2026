'use strict';

const $=id=>document.getElementById(id);
const BASE='/api/timescale-intake',PAIR='/api/reconciliation',PAGE=25,COLUMN_PAGE=40;
const HEX32=/^[0-9a-f]{32}$/,HEX64=/^[0-9a-f]{64}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const catalog=key=>({[key]:[],offset:0,limit:PAGE,total:0,next_offset:null});
const state={
  workspace:null,identity:null,status:null,busy:false,db:null,storageError:null,screen:'reports',
  reports:catalog('reports'),reviews:catalog('reviews'),operations:catalog('operations'),
  report:null,source:null,sourcePage:null,sourceQuery:'',sourceColumnOffset:0,sourceColumnQuery:'',
  draft:null,draftTimer:null,draftVersion:0,review:null,reviewBody:null,edition:null,
  pair:null,pairReview:null,pairReviewBody:null,pairVersion:0,pairTimer:null,savedPair:null,
  editionDetails:new Map(),editionChoices:new Map(),uploadFile:null,
  requests:[],requestDetails:new Map()
};
let capability=location.hash.slice(1);
try{if(capability)sessionStorage.setItem('stellar_duckdb_capability',capability);else capability=sessionStorage.getItem('stellar_duckdb_capability')||'';}catch{}
if(location.hash)history.replaceState(null,'',location.pathname+location.search);

function el(tag,text,className){
  const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);
  if(className)n.className=className;return n;
}
function pretty(value){return JSON.stringify(value,null,2);}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function number(value){return typeof value==='number'?value.toLocaleString():String(value??'—');}
function short(value){const s=String(value||'');return s.length>25?s.slice(0,13)+'…'+s.slice(-8):s;}
function when(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString();}
function scalar(value){return value&&typeof value==='object'&&Object.hasOwn(value,'text')&&Object.hasOwn(value,'type')?(value.type==='null'?null:value.text):value;}
function native(value){const v=scalar(value);return v===null||v===undefined?'NULL':typeof v==='object'?JSON.stringify(v):String(v);}
function query(values){const p=new URLSearchParams();for(const [k,v]of Object.entries(values))if(v!==undefined&&v!==null&&v!=='')p.set(k,String(v));return p.size?'?'+p.toString():'';}
function requestId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}
async function sha256(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');}
function notice(message,level='info'){const n=$('notice');n.textContent=message||'';n.dataset.level=level;n.hidden=!message;}
function busy(value){
  state.busy=value;document.body.dataset.busy=String(value);$('main').setAttribute('aria-busy',String(value));
  document.querySelectorAll('button,input,select,textarea').forEach(n=>{n.disabled=value||n.dataset.disabled==='true';});
}
async function action(label,work){
  if(state.busy)return;busy(true);notice(label+'…');
  try{await work();}catch(error){notice(error.message||String(error),'error');}
  finally{busy(false);}
}
function button(label,work,{primary=false,disabled=false,small=false}={}){
  const n=el('button',label,[primary?'primary':'',small?'small':''].filter(Boolean).join(' '));
  n.type='button';n.dataset.disabled=String(disabled);n.disabled=state.busy||disabled;
  n.addEventListener('click',()=>action(label,work));return n;
}
function input(value='',change,{type='text',placeholder='',readOnly=false,maxLength}={}){
  const n=el('input');n.type=type;n.value=value??'';n.placeholder=placeholder;n.readOnly=readOnly;
  n.autocomplete='off';n.spellcheck=false;n.disabled=state.busy;if(maxLength)n.maxLength=maxLength;
  if(change)n.addEventListener('input',()=>change(n.value));return n;
}
function textArea(value,change,rows=3){
  const n=el('textarea');n.value=value??'';n.rows=rows;n.spellcheck=false;n.disabled=state.busy;
  if(change)n.addEventListener('input',()=>change(n.value));return n;
}
function select(options,value,change){
  const n=el('select');n.disabled=state.busy;
  for(const item of options){const [key,label]=Array.isArray(item)?item:[item,item],o=el('option',label);o.value=String(key);n.append(o);}
  if(value!==undefined&&value!==null)n.value=String(value);
  if(change)n.addEventListener('change',()=>change(n.value));return n;
}
function checkbox(value,change,label){
  const n=el('input');n.type='checkbox';n.checked=Boolean(value);n.disabled=state.busy;
  n.setAttribute('aria-label',label);n.addEventListener('change',()=>change(n.checked));return n;
}
function field(label,control,hint){
  const n=el('label');n.append(el('span',label),control);if(hint)n.append(el('span',hint,'hint'));return n;
}
function toolbar(...items){const n=el('div',undefined,'toolbar');n.append(...items.filter(Boolean));return n;}
function panel(title,...items){const n=el('section',undefined,'panel');if(title)n.append(el('h3',title));n.append(...items.filter(Boolean));return n;}
function empty(message){return el('div',message,'empty');}
function details(label,value){const n=el('details',undefined,'record');n.append(el('summary',label),el('pre',typeof value==='string'?value:pretty(value)));return n;}
function heading(screen,title,description,...actions){
  const n=el('div',undefined,'page-heading'),words=el('div'),h=el('h2',title);h.id='title-'+screen;
  words.append(h,el('p',description));n.append(words);if(actions.length){const a=el('div',undefined,'page-actions');a.append(...actions);n.append(a);}return n;
}
function facts(rows){
  const n=el('dl',undefined,'facts');
  for(const [k,v]of rows)if(v!==undefined&&v!==null&&v!=='')n.append(el('dt',k),el('dd',native(v)));return n;
}
function item(title,meta,work,selected=false){
  const n=button('',work);n.className='item'+(selected?' selected':'');
  n.append(el('span',title,'item-title'),el('span',meta,'item-meta'));return n;
}
function table(columns,rows){
  const wrap=el('div',undefined,'table-scroll'),t=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
  for(const c of columns)tr.append(el('th',typeof c==='string'?c:c.name));head.append(tr);t.append(head,body);wrap.append(t);
  for(const row of rows){
    const line=el('tr');columns.forEach((c,i)=>{
      const value=Array.isArray(row)?row[i]:row[typeof c==='string'?c:c.name],v=scalar(value),td=el('td',undefined,'value');
      if(v===null||v===undefined||v==='')td.append(el('span',v===''?'EMPTY STRING':'NULL','native-marker'));
      else td.textContent=native(v);line.append(td);
    });body.append(line);
  }
  if(!rows.length){const tr=el('tr'),td=el('td','No rows in this selection.','muted');td.colSpan=Math.max(1,columns.length);tr.append(td);body.append(tr);}
  return wrap;
}
function pager(record,load){
  const n=el('div',undefined,'pager'),offset=record.offset||0,limit=record.limit||PAGE;
  const total=record.total??0,last=Math.min(offset+limit,total);
  n.append(el('span',total?number(offset+1)+'–'+number(last)+' of '+number(total):'0 records'),
    toolbar(button('Previous',()=>load(Math.max(0,offset-limit)),{small:true,disabled:offset===0}),
      button('Next',()=>load(record.next_offset),{small:true,disabled:record.next_offset===null||record.next_offset===undefined})));
  return n;
}
function show(screen){
  state.screen=screen;document.querySelectorAll('.screen').forEach(n=>{n.hidden=n.id!=='screen-'+screen;});
  document.querySelectorAll('nav [data-screen]').forEach(n=>{if(n.dataset.screen===screen)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
  try{sessionStorage.setItem('stellar_duckdb_timescale_screen',screen);}catch{}
}
function headers(extra={}){
  const h={'X-DuckDB-Capability':capability,...extra};if(state.workspace)h['X-DuckDB-Workspace-ID']=state.workspace;return h;
}
async function response(path,options={}){
  try{return await fetch(path,{cache:'no-store',...options,headers:headers(options.headers||{})});}
  catch(cause){const e=new Error('The local workspace could not be reached. Reopen the original operation under Saved requests before continuing.');e.transport=true;e.cause=cause;throw e;}
}
async function decode(r){
  let result;try{result=await r.json();}catch(cause){const e=new Error('The local workspace returned an unreadable response. The original request remains retained.');e.transport=true;e.status=r.status;e.cause=cause;throw e;}
  if(!r.ok){const detail=result.detail||result.message||'',e=new Error(r.status===403?'Open this workspace using its original private launch link.':String(result.error||'REQUEST_FAILED')+(detail?'\n'+(typeof detail==='string'?detail:pretty(detail)):''));
    e.status=r.status;e.result=result;e.code=result.error;throw e;}
  if(state.workspace&&result.workspace_id&&result.workspace_id!==state.workspace)throw new Error('The local listener now belongs to another workspace. Reopen the intended project.');
  return result;
}
async function api(path,body){return decode(await response(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
function openStorage(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('Enable browser storage to retain complete report files and original requests.'));return;}
    const req=indexedDB.open('stellar_duckdb_timescale_intake',1);
    req.onupgradeneeded=()=>{
      const db=req.result,requests=db.createObjectStore('requests',{keyPath:'key'});requests.createIndex('meaning','meaning',{unique:true});
      db.createObjectStore('files',{keyPath:'key'});db.createObjectStore('drafts',{keyPath:'key'});
    };
    req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Close an older intake tab so its request storage can open.'));
    req.onsuccess=()=>resolve(req.result);
  });
}
function stored(name,key){
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(name,'readonly'),r=key===undefined?tx.objectStore(name).getAll():tx.objectStore(name).get(key);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.onabort=()=>reject(tx.error||new Error('Browser storage read interrupted.'));
  });
}
function keep(name,value){
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction(name,'readwrite');tx.objectStore(name).put(value);
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('The complete request could not be retained.'));
  });
}
async function loadRequests(){
  if(!state.db)return;
  state.requests=(await stored('requests')).filter(r=>r.workspace_id===state.workspace).sort((a,b)=>b.created_at.localeCompare(a.created_at));renderRequests();
}
async function keepRequest(record){await keep('requests',record);await loadRequests();return record;}
async function claim(kind,body,file){
  if(!state.db)throw state.storageError||new Error('Browser request storage is unavailable.');
  const bodyMeaning=canonical({kind,body}),meaning=state.workspace+':'+await sha256(new TextEncoder().encode(bodyMeaning));
  const id=requestId(),full={...clone(body),request_id:id,workspace_id:state.workspace};
  const candidate={key:state.workspace+':'+id,workspace_id:state.workspace,request_id:id,kind,meaning,state:'PREPARED',created_at:new Date().toISOString(),
    body:full,body_text:JSON.stringify(full),route:kind==='retain'?BASE+'/upload':kind==='pair'?BASE+'/pairs':BASE+'/'+(kind==='review'?'reviews':'imports')};
  if(file){candidate.file_key=state.workspace+':'+body.sha256;candidate.file={filename:body.filename,bytes:body.bytes,sha256:body.sha256};
    candidate.upload_headers={'Content-Type':'application/json','X-DuckDB-Request-ID':id,'X-DuckDB-Source-Sha256':body.sha256,'X-DuckDB-Filename':encodeURIComponent(body.filename)};}
  const record=await new Promise((resolve,reject)=>{
    const tx=state.db.transaction(file?['requests','files']:['requests'],'readwrite'),store=tx.objectStore('requests'),lookup=store.index('meaning').get(meaning);let selected;
    lookup.onsuccess=()=>{
      selected=lookup.result||candidate;
      if(!lookup.result)store.add(selected);
      if(file)tx.objectStore('files').put({key:selected.file_key,blob:file,bytes:body.bytes,sha256:body.sha256});
    };
    tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('The complete file and request could not be retained.'));
  });
  await loadRequests();return record;
}
function remotePath(record){return (record.kind==='pair'?PAIR:BASE)+'/requests/'+record.request_id;}
async function inspect(record){
  const remote=await api(remotePath(record));
  if(remote.request_id!==record.request_id)throw new Error('The returned request identifier differs from the original.');
  const update={...record,remote,inspected_at:new Date().toISOString()};
  if(remote.state==='COMPLETE'){if(!remote.result)throw new Error('The completed request has no retained result.');update.state='COMPLETE';update.result=remote.result;}
  else update.state=remote.state;
  state.requestDetails.set(record.request_id,remote);return keepRequest(update);
}
async function send(record,resume=false){
  if(record.workspace_id!==state.workspace)throw new Error('Select the request from this original workspace.');
  let result;
  await keepRequest({...record,state:'DISPATCHING',last_attempt_at:new Date().toISOString()});
  try{
    if(resume)result=await api(remotePath(record)+'/resume',{workspace_id:state.workspace});
    else if(record.kind==='retain'){
      const original=await stored('files',record.file_key);
      if(!original?.blob||original.bytes!==record.file.bytes||original.sha256!==record.file.sha256||original.blob.size!==record.file.bytes)
        throw new Error('Select the same original report file under Saved requests to continue this upload.');
      result=await decode(await response(record.route,{method:'POST',headers:record.upload_headers,body:original.blob}));
    }else result=await decode(await response(record.route,{method:'POST',headers:{'Content-Type':'application/json'},body:record.body_text}));
  }catch(error){
    await keepRequest({...record,state:error.transport?'RESPONSE_UNKNOWN':'RETURNED_ERROR',last_error:{message:error.message,status:error.status??null,code:error.code??null,at:new Date().toISOString()}});
    throw error;
  }
  await keepRequest({...record,state:'COMPLETE',result,completed_at:new Date().toISOString()});return result;
}
async function continueRequest(record){
  let reopened;
  try{reopened=await inspect(record);}catch(error){
    if(error.status!==404)throw error;
    if(record.state==='COMPLETE')throw new Error('This previously completed request is absent from the current workspace. Reopen its original workspace and retained result.');
    return send(record);
  }
  if(reopened.state==='COMPLETE')return reopened.result;
  return send(reopened,record.kind!=='retain');
}
async function retained(kind,body,file){return continueRequest(await claim(kind,body,file));}
async function recoverFile(record,file){
  if(!file)return;
  if(file.size!==record.file.bytes)throw new Error('Choose the original report with the saved complete byte count.');
  const digest=await sha256(await file.arrayBuffer());
  if(digest!==record.file.sha256)throw new Error('This report differs from the saved original SHA-256.');
  await keep('files',{key:record.file_key,blob:file,bytes:file.size,sha256:digest});notice('The exact original report file is retained. Continue the same saved request.');
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=String(name||'report.json').replace(/[/\\\u0000-\u001f]/g,'_');
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function saveJson(value,name){download(new Blob([pretty(value)+'\n'],{type:'application/json;charset=utf-8'}),name);}
async function downloadReport(report){
  const r=await response(BASE+'/reports/'+report.report_id+'/file');
  if(!r.ok){await decode(r);return;}
  const blob=await r.blob();if(blob.size!==report.bytes)throw new Error('The original report download returned a different complete byte count.');
  download(blob,report.filename);notice('Complete original commissioning report downloaded.');
}


async function loadIdentity(){
  const v=await api('/api/identity');
  if(!HEX32.test(v.workspace_id||''))throw new Error('The original workspace did not return its complete identity.');
  if(state.workspace&&state.workspace!==v.workspace_id)throw new Error('The local listener now belongs to a different workspace.');
  state.identity=v;state.workspace=v.workspace_id;$('workspace-name').textContent=v.directory||'Local DuckDB workspace';$('workspace-id').textContent=v.workspace_id;
}
async function loadStatus(){
  state.status=await api(BASE+'/status');$('workspace-counts').textContent=number(state.status.report_count)+' reports · '+number(state.status.review_count)+' source reviews';
}
async function loadReports(offset=0){state.reports={...catalog('reports'),...await api(BASE+'/reports'+query({offset,limit:PAGE}))};renderReports();}
async function loadReviews(offset=0){
  state.reviews={...catalog('reviews'),...await api(BASE+'/reviews'+query({offset,limit:PAGE}))};
  for(const r of state.reviews.reviews)if(r.edition_id)state.editionChoices.set(r.edition_id,r);
  renderEditions();
}
async function loadOperations(offset=0){state.operations={...catalog('operations'),...await api(BASE+'/operations'+query({offset,limit:PAGE}))};renderRequests();}
async function edition(id){
  if(!HEX64.test(id||''))throw new Error('Choose the complete original edition identifier.');
  if(!state.editionDetails.has(id)){
    const e=await api('/api/editions/'+id);
    if(!e.timescale_source)throw new Error('Select an edition imported from an original Timescale commissioning report.');
    state.editionDetails.set(id,e);state.editionChoices.set(id,{...state.editionChoices.get(id),edition_id:id,row_count:e.row_count,timescale_source:e.timescale_source});
  }
  return state.editionDetails.get(id);
}
async function uploadReport(){
  const file=state.uploadFile;
  if(!file)throw new Error('Choose the complete original commissioning report JSON file.');
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>(state.status?.limits?.report_bytes||256000000))
    throw new Error('The report exceeds this workspace’s complete report limit.');
  notice('Reading and retaining the complete original report…');
  const digest=await sha256(await file.arrayBuffer());
  const result=await retained('retain',{sha256:digest,filename:file.name,bytes:file.size},file);
  if(result.sha256!==digest||result.bytes!==file.size||!HEX64.test(result.report_id||''))throw new Error('The retained report did not return its original full identity.');
  await loadStatus();await loadReports(0);await openReport(result.report_id);notice('Complete original report retained. Choose a native table to inspect.');
}
async function openReport(id){
  if(!HEX64.test(id||''))throw new Error('Select the original complete report SHA-256.');
  await saveDraft();
  const report=await api(BASE+'/reports/'+id);
  if(report.report_id!==id||!Array.isArray(report.sources))throw new Error('The report did not return its complete original source catalog.');
  state.report=report;renderReports();show('reports');
}
function renderReports(){
  const root=$('screen-reports');
  root.replaceChildren(heading('reports','Commissioning reports','Retain the original exported JSON report, including its immutable revision chain and complete native source tables.'));
  const upload=el('div',undefined,'upload-box'),choose=input('',null,{type:'file'});choose.accept='.json,application/json';choose.id='report-file';
  choose.addEventListener('change',()=>{
    state.uploadFile=choose.files?.[0]||null;
    const n=$('selected-report-file');if(n)n.textContent=state.uploadFile?state.uploadFile.name+' · '+number(state.uploadFile.size)+' bytes':'';
  });
  upload.append(field('Original report file',choose),button('Retain report',uploadReport,{primary:true}),
    el('p','Use the complete report downloaded from the Timescale commissioning workspace. Its original file bytes are retained before upload.','hint'));
  const fileLabel=el('p',state.uploadFile?state.uploadFile.name+' · '+number(state.uploadFile.size)+' bytes':'','selected-file');fileLabel.id='selected-report-file';
  root.append(panel('Add a commissioning report',upload,fileLabel));
  const list=el('div',undefined,'item-list');
  for(const row of state.reports.reports){const choice=item(row.title||row.filename,'Revision '+row.revision+' · '+number(row.source_count)+' native tables · '+when(row.created_at),()=>openReport(row.report_id),row.report_id===state.report?.report_id);choice.dataset.reportId=row.report_id;list.append(choice);}
  if(!state.reports.reports.length)list.append(empty('No commissioning reports are present on this page.'));
  const split=el('div',undefined,'split');split.append(panel('Retained reports',list,pager(state.reports,loadReports)));
  if(state.report){
    const r=state.report,sources=el('div',undefined,'item-list');
    for(const s of r.sources){const choice=item(s.title||s.tableName||s.filename,s.role+' · '+number(s.rows)+' rows · '+number(s.columns?.length)+' fields',()=>openSource(r.report_id,s.id),s.id===state.source?.id&&r.report_id===state.draft?.report_id);choice.dataset.sourceId=s.id;choice.dataset.reportId=r.report_id;sources.append(choice);}
    if(!r.sources.length)sources.append(empty('This complete report contains no native source tables.'));
    split.append(panel(r.title||r.filename,facts([['Commissioning',r.commissioning_id],['Workspace',r.commissioning_workspace_id],['Revision',r.revision],['Original file',r.filename],['Bytes',r.bytes],['SHA-256',r.sha256]]),
      toolbar(button('Download original report',()=>downloadReport(r))),el('p',r.scope_note||'The source catalog belongs to this exact retained report.','source-note'),sources,details('Original report metadata',r)));
  }else split.append(panel('Selected report',empty('Open a retained report to choose one of its original native tables.')));
  root.append(split);
}
function draftKey(reportId,sourceId){return state.workspace+':source:'+reportId+':'+sourceId;}
function defaultDraft(report,source,preview){
  if(!Array.isArray(preview.default_columns)||preview.default_columns.length!==source.columns.length)
    throw new Error('The native table did not return a complete default field mapping.');
  const columns=clone(preview.default_columns);
  if(columns.some(c=>c.type!=='VARCHAR')||new Set(columns.map(c=>c.source)).size!==source.columns.length||
     source.columns.some(c=>!columns.some(m=>m.source===c.name)))throw new Error('The default mapping does not preserve every original native field as text.');
  return {key:draftKey(report.report_id,source.id),workspace_id:state.workspace,report_id:report.report_id,source_id:source.id,source_sha256:source.sha256,
    columns,key_sources:[],interpretation:{columns:source.columns.map(c=>({source:c.name,role:'attribute',meaning:'Original PostgreSQL field '+c.name+'.',units:'',timezone:'',precision:''})),
      scope_note:'Review the complete original table in this commissioning report; no preview filter changes the imported rows.',
      null_note:'SQL NULL remains null. An empty native string remains an empty string.',
      time_note:'Native values remain text until an explicit timestamp conversion is reviewed. No time window is applied during intake.',
      allow_approximate:false}};
}
async function saveDraft(){
  clearTimeout(state.draftTimer);
  if(!state.draft||!state.db)return;
  const saved={...clone(state.draft),updated_at:new Date().toISOString()};await keep('drafts',saved);
}
function editedSource(){
  state.draftVersion++;state.review=null;state.reviewBody=null;
  const output=$('source-reviewed');if(output)output.replaceChildren(el('p','Review the current complete field mapping to prepare an edition.','muted'));
  clearTimeout(state.draftTimer);state.draftTimer=setTimeout(()=>saveDraft().catch(e=>notice('The field draft could not be retained: '+e.message,'error')),250);
}
async function openSource(reportId,sourceId){
  await saveDraft();
  if(state.report?.report_id!==reportId){
    const report=await api(BASE+'/reports/'+reportId);
    if(report.report_id!==reportId)throw new Error('The requested report identity changed.');
    state.report=report;
  }
  const source=state.report.sources.find(s=>s.id===sourceId);if(!source)throw new Error('Choose a native source from this original report.');
  const preview=await api(BASE+'/reports/'+reportId+'/sources/'+sourceId+query({offset:0,limit:PAGE}));
  if(preview.report_id!==reportId||preview.source_id!==sourceId)throw new Error('The returned table belongs to another original source.');
  const key=draftKey(reportId,sourceId),saved=state.db?await stored('drafts',key):null;
  if(saved&&(saved.workspace_id!==state.workspace||saved.report_id!==reportId||saved.source_id!==sourceId||saved.source_sha256!==source.sha256))
    throw new Error('The retained field draft belongs to another original source.');
  state.source=source;state.sourcePage=preview;state.sourceQuery='';state.sourceColumnOffset=0;state.sourceColumnQuery='';
  state.draft=saved||defaultDraft(state.report,source,preview);state.draftVersion++;state.review=null;state.reviewBody=null;state.edition=null;
  if(!saved)await saveDraft();renderSource();show('source');notice('Original native source opened. Review its fields and meanings before importing.');
}
async function sourceRows(offset=0){
  if(!state.draft)return;
  const r=await api(BASE+'/reports/'+state.draft.report_id+'/sources/'+state.draft.source_id+query({offset,limit:PAGE,q:state.sourceQuery}));
  if(r.report_id!==state.draft.report_id||r.source_id!==state.draft.source_id)throw new Error('The source preview identity changed.');
  state.sourcePage=r;renderSourcePreview();
}
function renderSourcePreview(){
  const p=$('source-preview');if(!p)return;p.replaceChildren();
  if(!state.sourcePage)return;
  const filters=el('div',undefined,'filters'),q=input(state.sourceQuery,v=>{state.sourceQuery=v;},{placeholder:'Find an original value'});
  filters.append(field('Preview filter',q),button('Apply preview filter',()=>sourceRows(0)),button('Clear filter',async()=>{state.sourceQuery='';await sourceRows(0);}));
  p.append(filters,el('p',number(state.sourcePage.source_rows)+' original rows. This filter changes the displayed preview only. Every row remains in the import.','hint'));
  const t=table(state.sourcePage.columns,state.sourcePage.rows||[]);t.classList.add('source-table');p.append(t,pager(state.sourcePage,sourceRows));
}
function typeControl(column){
  const n=input(column.type,v=>{column.type=v;editedSource();},{placeholder:'VARCHAR'});n.setAttribute('list','timescale-sql-types');n.setAttribute('aria-label','DuckDB type for '+column.source);return n;
}
function renderColumnMapping(){
  const root=$('source-column-mapping');if(!root||!state.draft)return;root.replaceChildren();
  const d=state.draft,queryText=state.sourceColumnQuery.toLocaleLowerCase(),all=d.columns.map((c,i)=>({column:c,index:i})).filter(({column:c})=>!queryText||c.source.toLocaleLowerCase().includes(queryText)||c.name.toLocaleLowerCase().includes(queryText));
  state.sourceColumnOffset=Math.min(state.sourceColumnOffset,Math.max(0,Math.floor((all.length-1)/COLUMN_PAGE)*COLUMN_PAGE));
  const tools=el('div',undefined,'column-tools'),q=input(state.sourceColumnQuery,v=>{state.sourceColumnQuery=v;},{placeholder:'Source or SQL field name'});
  tools.append(field('Find a field',q),button('Apply field filter',async()=>{state.sourceColumnOffset=0;renderColumnMapping();},{small:true}),
    el('p',number(d.columns.length)+' original fields remain in this review.'));root.append(tools);
  const wrap=el('div',undefined,'table-scroll mapping-table'),t=el('table'),head=el('thead'),h=el('tr'),body=el('tbody');
  ['Original PostgreSQL field','SQL name and type','Field role','Meaning and units'].forEach(x=>h.append(el('th',x)));head.append(h);t.append(head,body);wrap.append(t);
  for(const {column:c}of all.slice(state.sourceColumnOffset,state.sourceColumnOffset+COLUMN_PAGE)){
    const meaning=d.interpretation.columns.find(x=>x.source===c.source),nativeColumn=state.source.columns.find(x=>x.name===c.source);
    if(!meaning||!nativeColumn)throw new Error('The field draft no longer covers its original native source.');
    const row=el('tr'),origin=el('td'),sql=el('td'),role=el('td'),notes=el('td');row.dataset.sourceField=c.source;
    origin.append(el('strong',c.source),el('span','PostgreSQL OID '+(nativeColumn.oid??'not declared'),'type-label'));
    sql.append(field('SQL column',input(c.name,v=>{c.name=v;editedSource();},{maxLength:120})),field('DuckDB type',typeControl(c)));
    const nullable=el('label',undefined,'inline-check');nullable.append(checkbox(c.nullable,v=>{c.nullable=v;editedSource();},'Allow NULL for '+c.source),el('span','Allow NULL'));sql.append(nullable);
    role.append(field('Field role',select([['attribute','Attribute'],['tag','Tag / identifier'],['time','Time'],['value','Measured value'],['quality','Quality']],meaning.role,v=>{meaning.role=v;editedSource();})));
    notes.append(field('Meaning',textArea(meaning.meaning,v=>{meaning.meaning=v;editedSource();},2)));
    const meta=el('div',undefined,'meaning-meta');
    meta.append(field('Units',input(meaning.units,v=>{meaning.units=v;editedSource();})),field('Time zone',input(meaning.timezone,v=>{meaning.timezone=v;editedSource();})),field('Precision',input(meaning.precision,v=>{meaning.precision=v;editedSource();})));notes.append(meta);
    row.append(origin,sql,role,notes);body.append(row);
  }
  if(!all.length){const row=el('tr'),td=el('td','No fields match this display filter.','muted');td.colSpan=4;row.append(td);body.append(row);}
  root.append(wrap,pager({offset:state.sourceColumnOffset,limit:COLUMN_PAGE,total:all.length,next_offset:state.sourceColumnOffset+COLUMN_PAGE<all.length?state.sourceColumnOffset+COLUMN_PAGE:null},async offset=>{state.sourceColumnOffset=offset;renderColumnMapping();}));
}
function reviewBody(){
  if(!state.draft)throw new Error('Open an original native source first.');
  const d=state.draft;
  return {report_id:d.report_id,source_id:d.source_id,columns:clone(d.columns),interpretation:clone(d.interpretation),
    keys:d.key_sources.map(source=>{const c=d.columns.find(x=>x.source===source);if(!c)throw new Error('A selected record key is absent from the complete mapping.');return c.name;})};
}
function validateReview(body){
  if(body.keys.length)throw new Error('Clear the retained import-key selection to preserve every original row. Choose matching keys in Pair and compare.');
  if(body.columns.length!==state.source.columns.length||new Set(body.columns.map(c=>c.source)).size!==body.columns.length||
    state.source.columns.some(c=>!body.columns.some(x=>x.source===c.name)))throw new Error('Keep every original source field in the mapping.');
  if(new Set(body.columns.map(c=>c.name)).size!==body.columns.length||body.columns.some(c=>!c.name.trim()||!c.type.trim()))throw new Error('Give every original field a unique SQL name and an explicit type.');
  const meanings=body.interpretation.columns;
  if(!meanings.some(c=>c.role==='tag')||!meanings.some(c=>c.role==='value'))throw new Error('Choose at least one tag or identifier field and one measured value field.');
  if(meanings.some(c=>!c.meaning.trim()))throw new Error('Record the meaning of every original field.');
  if(!body.interpretation.scope_note.trim()||!body.interpretation.null_note.trim()||!body.interpretation.time_note.trim())throw new Error('Record the source scope, null handling and time interpretation.');
}
async function prepareReview(){
  const body=reviewBody();validateReview(body);await saveDraft();
  const version=state.draftVersion,binding=canonical(body),review=await retained('review',body);
  if(version!==state.draftVersion||binding!==canonical(reviewBody()))throw new Error('The mapping changed while its original review completed. Reopen that review under Reviewed editions.');
  if(!HEX64.test(review.review_id||''))throw new Error('The native review did not return a complete review identifier.');
  checkedReview(review,{report_id:body.report_id,source_id:body.source_id});
  await loadReviews(0);await loadStatus();selectReview(review,null,binding);renderSourceReview();notice('Complete source review prepared. Check the reviewed conversion and import the edition.');
}
async function importReview(review,fromEditor=false){
  if(!HEX64.test(review?.review_id||''))throw new Error('Open the original complete import review.');
  if(fromEditor&&(!state.reviewBody||state.reviewBody!==canonical(reviewBody())))throw new Error('Review the current field mapping before importing.');
  const result=await retained('import',{review_id:review.review_id});
  if(!HEX64.test(result.edition_id||'')||!result.timescale_source)throw new Error('The import did not return its original Timescale source binding.');
  checkedEdition(review,result);
  await loadReviews(0);await loadStatus();selectReview(review,result);renderEditions();show('editions');notice('Immutable edition imported with the complete original report, source table and reviewed meanings.');
}
function renderSourceReview(){
  const root=$('source-reviewed');if(!root)return;root.replaceChildren();
  if(!state.review||!state.reviewBody){root.append(el('p','Review the current complete mapping to prepare an immutable edition.','muted'));return;}
  const r=state.review;root.append(facts([['Review',r.review_id],['Rows',r.row_count],['Columns',r.columns?.length]]),details('Complete reviewed conversion and source',r),
    toolbar(button('Import reviewed edition',()=>importReview(r,true),{primary:true,disabled:state.reviewBody!==canonical(reviewBody())})));
}
function renderSource(){
  const root=$('screen-source');root.replaceChildren(heading('source','Source and field review','Inspect the original native values and review every field before creating a DuckDB edition.'));
  if(!state.source||!state.draft){root.append(panel('Original source',empty('Open a commissioning report and choose a native source table.')));return;}
  const s=state.source,d=state.draft;
  root.append(panel(s.title||s.tableName||s.filename,
    facts([['Source role',s.role],['Original table',s.tableName],['Original source',s.id],['Rows',s.rows],['Fields',s.columns.length],['Source SHA-256',s.sha256],['Contract revision',s.contractRevision]]),
    el('p',s.provider_completeness==='DECLARED_COMPLETE'?'The original source declares its provider scope complete. The imported edition retains that declaration.':'The original source does not declare complete provider coverage. The complete retained table is available for comparison within its stated scope.','source-note'),
    details('Complete native source descriptor',s)));
  const preview=panel('Original rows');preview.id='source-preview';root.append(preview);
  const mapping=el('div');mapping.id='source-column-mapping';
  const types=el('datalist');types.id='timescale-sql-types';
  ['VARCHAR','BIGINT','HUGEINT','DECIMAL(38,0)','DECIMAL(38,6)','BOOLEAN','DATE','TIMESTAMP','TIMESTAMPTZ','JSON','DOUBLE'].forEach(value=>{const n=el('option');n.value=value;types.append(n);});
  root.append(panel('Fields and interpretation',el('p','Native PostgreSQL cells start as exact text or NULL. Choose conversions explicitly. Names, roles and notes cover every source field, including fields outside the current page.','muted'),types,mapping));
  root.append(el('p','Every original row is retained, including duplicate identifiers. Choose matching keys later in Pair and compare.','source-note'));
  if(d.key_sources.length){
    const retained=d.key_sources.map(source=>d.columns.find(column=>column.source===source)?.name||source);
    root.append(panel('Retained import-key selection',el('p','This saved draft selected: '+retained.join(', ')+'. Clear that selection before reviewing this complete source. Matching keys belong to the saved comparison pair.'),
      toolbar(button('Clear import-key selection',async()=>{d.key_sources=[];editedSource();await saveDraft();renderSource();notice('The former import-key selection was cleared. All original rows remain in the source review.');}))));
  }
  const notes=el('div',undefined,'stack');
  notes.append(field('Source scope',textArea(d.interpretation.scope_note,v=>{d.interpretation.scope_note=v;editedSource();})),
    field('Null and empty-string handling',textArea(d.interpretation.null_note,v=>{d.interpretation.null_note=v;editedSource();},2)),
    field('Time interpretation',textArea(d.interpretation.time_note,v=>{d.interpretation.time_note=v;editedSource();},2)));
  const approximate=el('label',undefined,'inline-check');approximate.append(checkbox(d.interpretation.allow_approximate,v=>{d.interpretation.allow_approximate=v;editedSource();},'Allow explicitly selected approximate DOUBLE conversions'),el('span','Allow approximate DOUBLE conversion for fields explicitly assigned that type.'));
  const result=el('div');result.id='source-reviewed';
  root.append(panel('Scope and conversion review',notes,approximate,el('p','Exact integer and decimal conversions must fit their selected types. Timestamp conversion must preserve microsecond precision. The native review identifies any source value that cannot be represented.','hint'),
    toolbar(button('Review complete source',prepareReview,{primary:true}),button('Download field mapping',async()=>{saveJson(reviewBody(),'timescale-source-mapping.json');notice('Complete field mapping downloaded.');})),result));
  renderSourcePreview();renderColumnMapping();renderSourceReview();
}
function checkedReview(review,expected={}){
  const source=review?.timescale_source,descriptor=source?.descriptor;
  if(!HEX64.test(review?.review_id||'')||!HEX64.test(review?.manifest_sha256||'')||!Array.isArray(review.columns)||!Array.isArray(review.keys)||
    !Number.isSafeInteger(review.row_count)||review.row_count<0||!source||descriptor?.schema!=='stellar-forge.duckdb-timescale-intake.v1.source'||
    descriptor.workspace_id!==state.workspace||descriptor.report_id!==source.report_id||descriptor.source_id!==source.source_id||
    !HEX64.test(source.report_id||'')||!source.source_id||
    (expected.review_id&&review.review_id!==expected.review_id)||(expected.report_id&&source.report_id!==expected.report_id)||
    (expected.source_id&&source.source_id!==expected.source_id))
    throw new Error('The complete review does not belong to the requested original workspace and native source.');
  return review;
}
function checkedEdition(review,value){
  checkedReview(review);
  if(value?.edition_id!==review.review_id||value.review_id!==review.review_id||value.manifest_sha256!==review.manifest_sha256||
    value.row_count!==review.row_count||!Array.isArray(value.columns)||!Array.isArray(value.keys)||
    canonical(value.columns)!==canonical(review.columns)||canonical(value.keys)!==canonical(review.keys)||
    !value.timescale_source||canonical(value.timescale_source)!==canonical(review.timescale_source))
    throw new Error('The imported edition and complete field review do not describe the same original native source.');
  return value;
}
function selectReview(review,value=null,binding=null){
  checkedReview(review);if(value)checkedEdition(review,value);
  if(value){
    state.editionDetails.set(value.edition_id,value);
    state.editionChoices.set(value.edition_id,{edition_id:value.edition_id,review_id:review.review_id,row_count:value.row_count,timescale_source:value.timescale_source});
  }
  state.review=review;state.edition=value;state.reviewBody=binding;
}
async function openReview(row){
  const review=checkedReview(await api('/api/reviews/'+row.review_id),row);
  const imported=row.edition_id?checkedEdition(review,await edition(row.edition_id)):null;
  selectReview(review,imported);
  renderEditions();show('editions');notice('Original saved source review opened.');
}
function renderEditions(){
  const root=$('screen-editions');root.replaceChildren(heading('editions','Reviewed editions','Reopen the original field review, import its immutable edition and choose the two editions to compare.'));
  const list=el('div',undefined,'item-list');
  for(const row of state.reviews.reviews)list.append(item((row.edition_id?'Imported edition':'Source review')+' · '+short(row.source_id),
    when(row.created_at)+' · '+short(row.report_id),()=>openReview(row),row.review_id===state.review?.review_id));
  if(!state.reviews.reviews.length)list.append(empty('No source reviews are present on this page.'));
  const split=el('div',undefined,'split');split.append(panel('Saved source reviews',list,pager(state.reviews,loadReviews)));
  const r=state.review,e=state.edition;
  if(r){
    const controls=toolbar();
    if(!e)controls.append(button('Import this reviewed edition',()=>importReview(r),{primary:true}));
    const detail=panel('Selected source review',facts([['Review',r.review_id],['Rows',r.row_count],['Fields',r.columns?.length]]),
      table(['Source field','SQL column','Native type','Allow NULL'],(r.columns||[]).map(c=>[c.source,c.name,c.type,c.nullable])),details('Complete retained review',r),controls);
    if(e){
      detail.append(el('h3','Imported edition'),facts([['Edition',e.edition_id],['Rows',e.row_count],['Table',e.table],['Imported',when(e.created_at)]]),
        toolbar(button('Use as baseline',()=>choosePairEdition('source',e.edition_id),{primary:true}),button('Use as observed edition',()=>choosePairEdition('target',e.edition_id))),
        details('Complete immutable edition and original source',e));
    }
    split.append(detail);
  }else split.append(panel('Selected edition',empty('Open an original saved review to inspect or import its edition.')));
  root.append(split);
}


function newPairDefinition(){
  return {key:state.workspace+':pair',workspace_id:state.workspace,expected_revision:0,
    definition:{name:'',label:'',source_edition:'',target_edition:'',columns:[],window_column:null,windows:[],notes:''}};
}
async function savePairDraft(){
  clearTimeout(state.pairTimer);
  if(state.pair&&state.db)await keep('drafts',{...clone(state.pair),updated_at:new Date().toISOString()});
}
function editedPair(){
  state.pairVersion++;state.pairReview=null;state.pairReviewBody=null;state.savedPair=null;
  const n=$('pair-review-result');if(n)n.replaceChildren(el('p','Review the current complete definition before saving the pair.','muted'));
  clearTimeout(state.pairTimer);state.pairTimer=setTimeout(()=>savePairDraft().catch(e=>notice('The pair draft could not be retained: '+e.message,'error')),250);
}
async function choosePairEdition(side,id){
  const selected=await edition(id);
  if(!state.pair)state.pair=newPairDefinition();
  state.pair.definition[side+'_edition']=id;editedPair();await savePairDraft();renderPair();show('pair');
  notice((side==='source'?'Baseline':'Observed')+' edition selected: '+number(selected.row_count)+' original rows.');
}
function editionLabel(row){
  const e=state.editionDetails.get(row.edition_id),s=e?.timescale_source||row.timescale_source||{};
  return (e?.label||e?.name||s.title||s.filename||'Edition '+short(row.edition_id))+' · '+number(e?.row_count??row.row_count)+' rows';
}
function editionOptions(selected){
  const entries=[['','Choose an imported Timescale edition']];
  for(const row of state.editionChoices.values())entries.push([row.edition_id,editionLabel(row)]);
  if(selected&&!entries.some(([id])=>id===selected))entries.push([selected,'Selected edition '+short(selected)]);
  return entries;
}
function pairEdition(side){return state.editionDetails.get(state.pair?.definition[side+'_edition']);}
function pairColumns(side){return pairEdition(side)?.columns||[];}
function originalColumnOptions(side,selected){
  const entries=[['','Choose original column'],...pairColumns(side).map(c=>[c.name,c.name+' · '+c.type])];
  if(selected&&!entries.some(([name])=>name===selected))entries.push([selected,selected+' · absent from current edition']);return entries;
}
function columnMeaning(side,name){
  const e=pairEdition(side),column=e?.columns?.find(c=>c.name===name);
  const m=e?.timescale_source?.interpretation?.columns?.find(c=>c.source===column?.source);
  return m||null;
}
async function matchPairColumns(){
  const d=state.pair.definition,target=new Map(pairColumns('target').map(c=>[c.name,c])),names=new Set(d.columns.map(c=>c.name));let added=0;
  for(const c of pairColumns('source')){
    const other=target.get(c.name);if(!other||other.type!==c.type||names.has(c.name))continue;
    const sourceMeaning=columnMeaning('source',c.name),targetMeaning=columnMeaning('target',c.name);
    const meaning=sourceMeaning?.meaning&&sourceMeaning.meaning===targetMeaning?.meaning?sourceMeaning.meaning:'Baseline: '+(sourceMeaning?.meaning||c.name)+'; observed: '+(targetMeaning?.meaning||other.name)+'.';
    d.columns.push({name:c.name,source:c.name,target:other.name,role:'value',meaning,source_map:[],target_map:[]});names.add(c.name);added++;
  }
  editedPair();await savePairDraft();renderPair();notice(added+' identical names and native types added. Choose matching key fields and review the field meanings and units.');
}
function renderPairMapping(){
  const d=state.pair.definition,wrap=el('div',undefined,'table-scroll pair-columns'),t=el('table'),head=el('thead'),h=el('tr'),body=el('tbody');
  ['Comparison field','Baseline field','Observed field','Comparison role','Meaning',''].forEach(x=>h.append(el('th',x)));head.append(h);t.append(head,body);wrap.append(t);
  d.columns.forEach((c,index)=>{
    const row=el('tr'),name=el('td'),source=el('td'),target=el('td'),role=el('td'),meaning=el('td'),remove=el('td');row.dataset.pairColumn=String(index);
    name.append(input(c.name,v=>{c.name=v;editedPair();},{maxLength:120}));
    for(const side of ['source','target']){
      const cell=side==='source'?source:target;
      cell.append(select(originalColumnOptions(side,c[side]),c[side],v=>{c[side]=v;editedPair();renderPair();}));
      const m=columnMeaning(side,c[side]);if(m)cell.append(el('span',[m.role,m.units?m.units:'No units declared',m.timezone?m.timezone:''].filter(Boolean).join(' · '),'type-label'));
    }
    role.append(select([['key','Matching key'],['value','Compared value']],c.role,v=>{c.role=v;editedPair();}));
    meaning.append(textArea(c.meaning,v=>{c.meaning=v;editedPair();},2));
    remove.append(button('Remove',async()=>{d.columns.splice(index,1);editedPair();await savePairDraft();renderPair();},{small:true}));
    row.append(name,source,target,role,meaning,remove);body.append(row);
  });
  if(!d.columns.length){const row=el('tr'),td=el('td','Add the fields that identify and compare the two native editions.','muted');td.colSpan=6;row.append(td);body.append(row);}
  return wrap;
}
function pairWindows(){
  const d=state.pair.definition,root=el('div',undefined,'stack');
  const options=[['','All original rows'],...d.columns.filter(c=>c.name).map(c=>[c.name,c.name])];
  if(d.window_column&&!options.some(([id])=>id===d.window_column))options.push([d.window_column,d.window_column+' · missing field']);
  root.append(field('Window field',select(options,d.window_column||'',v=>{d.window_column=v||null;editedPair();}), 'An empty window list compares every original row. Each declared window includes its start and excludes its end.'));
  for(const [index,w]of d.windows.entries()){
    const fields=el('div',undefined,'fields');fields.dataset.pairWindow=String(index);
    fields.append(field('Window name',input(w.id,v=>{w.id=v;editedPair();},{maxLength:120})),field('Comparison basis',select([['native','Native type'],['lexical','Exact lexical order for VARCHAR']],w.basis,v=>{w.basis=v;editedPair();})),
      field('Start, included',input(w.start,v=>{w.start=v;editedPair();})),field('End, excluded',input(w.end,v=>{w.end=v;editedPair();})));
    root.append(panel(null,fields,toolbar(button('Remove window',async()=>{d.windows.splice(index,1);editedPair();await savePairDraft();renderPair();},{small:true}))));
  }
  root.append(toolbar(button('Add window',async()=>{d.windows.push({id:'window_'+(d.windows.length+1),start:'',end:'',basis:'native'});editedPair();await savePairDraft();renderPair();},{small:true})));return root;
}
async function reviewPair(){
  const definition=clone(state.pair.definition),version=state.pairVersion,binding=canonical(definition);
  if(!definition.name.trim()||!definition.label.trim())throw new Error('Give this dataset pair a name and display label.');
  if(!HEX64.test(definition.source_edition)||!HEX64.test(definition.target_edition))throw new Error('Select both original imported Timescale editions.');
  if(definition.source_edition===definition.target_edition)throw new Error('Select two different immutable editions for comparison.');
  if(!definition.columns.some(c=>c.role==='key'))throw new Error('Choose at least one matching key field.');
  if(definition.columns.some(c=>!c.meaning.trim()))throw new Error('Record the meaning of every comparison field.');
  await savePairDraft();
  const review=await api(BASE+'/pair-review',{definition});
  if(version!==state.pairVersion||binding!==canonical(state.pair.definition))throw new Error('The pair definition changed during review. Review the current definition.');
  if(!HEX64.test(review.review_sha256||'')||!review.definition)throw new Error('The native pair review did not return its complete reviewed definition.');
  state.pairReview=review;state.pairReviewBody=binding;renderPairReview();notice('Native pair review complete. Check coverage and source meanings before saving.');
}
async function savePair(){
  if(!state.pairReview||state.pairReviewBody!==canonical(state.pair.definition))throw new Error('Review the current complete pair definition before saving.');
  const result=await retained('pair',{expected_revision:state.pair.expected_revision,definition:clone(state.pairReview.definition),review_sha256:state.pairReview.review_sha256});
  if(!HEX64.test(result.pair_id||''))throw new Error('The original paired journal did not return its complete saved pair.');
  state.savedPair=result;state.pair={key:state.workspace+':pair',workspace_id:state.workspace,expected_revision:result.revision,definition:clone(result.definition)};
  state.pairReview=null;state.pairReviewBody=null;await savePairDraft();renderPair();notice('Dataset pair saved. Open reconciliation to run it, review differences and export the complete customer handover.');
}
function pairLink(record){
  const a=el('a','Open saved pair in reconciliation');a.href='/reconciliation/?pair='+encodeURIComponent(record.pair_id)+'#'+capability;return a;
}
function renderPairReview(){
  const root=$('pair-review-result');if(!root)return;root.replaceChildren();
  if(state.savedPair){root.append(facts([['Pair',state.savedPair.pair_id],['Revision',state.savedPair.revision]]),toolbar(pairLink(state.savedPair)),details('Complete saved pair',state.savedPair));return;}
  if(!state.pairReview){root.append(el('p','Review the current complete definition before saving the pair.','muted'));return;}
  root.append(details('Complete native pair review',state.pairReview),
    toolbar(button('Save reviewed pair',savePair,{primary:true,disabled:state.pairReviewBody!==canonical(state.pair.definition)})));
}
function renderPair(){
  const root=$('screen-pair');
  root.replaceChildren(heading('pair','Pair and compare','Select two immutable Timescale editions, review the matching fields and save the original reconciliation definition.',
    button('New pair',async()=>{await savePairDraft();state.pair=newPairDefinition();editedPair();await savePairDraft();renderPair();notice('New pair draft created.');})));
  if(!state.pair)state.pair=newPairDefinition();
  const d=state.pair.definition,basic=el('div',undefined,'fields');
  basic.append(field('Pair name',input(d.name,v=>{d.name=v;editedPair();},{maxLength:120,readOnly:state.pair.expected_revision>0})),
    field('Display label',input(d.label,v=>{d.label=v;editedPair();},{maxLength:240})));
  for(const side of ['source','target'])basic.append(field(side==='source'?'Baseline edition':'Observed edition',
    select(editionOptions(d[side+'_edition']),d[side+'_edition'],id=>action('Opening original edition',async()=>{
      if(!id){d[side+'_edition']='';editedPair();renderPair();return;}await choosePairEdition(side,id);
    }))));
  const exact=input('',null,{placeholder:'Complete 64-character edition ID'}),which=select([['source','Baseline'],['target','Observed']],'target');
  root.append(panel('Original editions',basic,toolbar(field('Open an exact earlier edition',exact),field('Use as',which),button('Open edition',()=>choosePairEdition(which.value,exact.value.trim()))),
    el('p','Choose imported editions from Reviewed editions to extend this list. The complete original report and field meanings remain attached to each edition.','hint')));
  const sources=el('div',undefined,'equal-columns');
  for(const side of ['source','target']){
    const e=pairEdition(side);
    sources.append(panel(side==='source'?'Baseline source':'Observed source',e?
      facts([['Edition',e.edition_id],['Rows',e.row_count],['Fields',e.columns?.length],['Source report',e.timescale_source.report_id],['Original source',e.timescale_source.source_id]]):empty('Choose an original imported edition.'),
      e?details('Retained source and reviewed meanings',e.timescale_source):null));
  }root.append(sources);
  root.append(panel('Matching fields',el('p','Key fields match complete groups of rows. Compared fields retain their native types and original values. Check both sources’ field meanings and units before treating them as equivalent.','muted'),
    renderPairMapping(),toolbar(button('Match identical names and native types',matchPairColumns,{disabled:!pairEdition('source')||!pairEdition('target')}),
      button('Add field',async()=>{d.columns.push({name:'',source:'',target:'',role:'value',meaning:'',source_map:[],target_map:[]});editedPair();await savePairDraft();renderPair();})),
    el('p','This intake form preserves original values with empty value maps. The full reconciliation editor supports explicit value maps after the pair is saved. Any omitted original field appears in the native review.','hint')));
  root.append(panel('Comparison windows',pairWindows()),panel('Operator notes',textArea(d.notes,v=>{d.notes=v;editedPair();},4)));
  const result=el('div');result.id='pair-review-result';
  root.append(panel('Review and open reconciliation',toolbar(button('Review pair definition',reviewPair,{primary:true}),
    button('Download complete definition',async()=>{saveJson(d,(d.name||'timescale-pair')+'.definition.json');notice('Complete original pair definition downloaded.');})),result));
  renderPairReview();
}
async function receiveResult(record,result){
  if(record.kind==='retain'){await loadStatus();await loadReports(0);await openReport(result.report_id);}
  else if(record.kind==='review'){
    const review=checkedReview(await api('/api/reviews/'+result.review_id),{...record.body,review_id:result.review_id});
    await loadReviews(0);selectReview(review);renderEditions();show('editions');
  }else if(record.kind==='import'){
    const reviewId=record.body?.review_id;
    if(!HEX64.test(reviewId||''))throw new Error('The completed import has no original retained review identifier.');
    const review=checkedReview(await api('/api/reviews/'+reviewId),{review_id:reviewId});
    const imported=checkedEdition(review,await edition(result.edition_id));
    await loadReviews(0);selectReview(review,imported);renderEditions();show('editions');
  }else if(record.kind==='pair'){
    state.savedPair=result;state.pair={key:state.workspace+':pair',workspace_id:state.workspace,expected_revision:result.revision,definition:clone(result.definition)};
    state.pairReview=null;state.pairReviewBody=null;await savePairDraft();renderPair();show('pair');
  }
}
function requestSummary(record){
  return {request_id:record.request_id,workspace_id:record.workspace_id,kind:record.kind,state:record.state,created_at:record.created_at,
    body:record.body,file:record.file,upload_headers:record.upload_headers,remote:record.remote,last_error:record.last_error,result:record.result};
}
function renderLocalRequest(record){
  const root=el('section',undefined,'request-record');root.dataset.requestId=record.request_id;root.dataset.requestKind=record.kind;root.dataset.requestState=record.state;
  root.append(facts([['Operation',record.kind==='retain'?'Retain commissioning report':record.kind==='review'?'Review complete native source':record.kind==='import'?'Import reviewed edition':'Save native dataset pair'],
    ['State',record.state],['Request',record.request_id],['Created',when(record.created_at)]]));
  const controls=toolbar(button('Inspect original request',async()=>{
    try{const updated=await inspect(record);notice('Original request reopened: '+updated.state+'.');}
    catch(error){if(error.status===404)notice('This request is absent from the current native journal. Its exact original body remains retained for explicit continuation.');else throw error;}
    renderRequests();
  },{small:true}),button('Continue original request',async()=>{
    const result=await continueRequest(record);await receiveResult(record,result);notice('Original request completed and its retained result reopened.');
  },{small:true,primary:record.state!=='COMPLETE'}),button('Download request details',async()=>saveJson(requestSummary(record),'timescale-request-'+record.request_id+'.json'),{small:true}));
  root.append(controls);
  if(record.kind==='retain'){
    const file=input('',null,{type:'file'});file.accept='.json,application/json';
    file.addEventListener('change',()=>action('Retaining same original report',()=>recoverFile(record,file.files?.[0])));
    root.append(field('Restore the same original report file if needed',file,'The byte count and SHA-256 must match the retained upload. This keeps the original filename and request headers.'));
  }
  if(record.last_error)root.append(el('p',record.last_error.message,'wrap source-note'));
  root.append(details('Complete original request and returned result',requestSummary(record)));return root;
}
async function recoverNativeUpload(remote,file){
  if(!file)return;
  const body=remote.body;
  if(remote.kind!=='retain'||!HEX32.test(remote.request_id||'')||body?.request_id!==remote.request_id||
    body.workspace_id!==state.workspace||!HEX64.test(body.sha256||'')||typeof body.filename!=='string'||!body.filename||
    !Number.isSafeInteger(file.size)||file.size<=0||file.size>(state.status?.limits?.report_bytes||256000000))
    throw new Error('Reopen the complete original upload request in its original workspace.');
  if(await sha256(await file.arrayBuffer())!==body.sha256)throw new Error('The selected report differs from the original upload SHA-256.');
  const latest=await api(BASE+'/requests/'+remote.request_id);
  if(latest.request_id!==remote.request_id||latest.kind!=='retain'||canonical(latest.body)!==canonical(body))
    throw new Error('The original native upload request changed.');
  if(latest.state==='COMPLETE'){await receiveResult({kind:'retain',body},latest.result);notice('The original completed report reopened.');return;}
  if(!state.db)throw state.storageError||new Error('Browser request storage is unavailable.');
  const original={sha256:body.sha256,filename:body.filename,bytes:file.size},full={...original,request_id:remote.request_id,workspace_id:state.workspace};
  const meaning=state.workspace+':'+await sha256(new TextEncoder().encode(canonical({kind:'retain',body:original})));
  const candidate={key:state.workspace+':'+remote.request_id,workspace_id:state.workspace,request_id:remote.request_id,kind:'retain',meaning,
    state:latest.state,created_at:latest.created_at||new Date().toISOString(),body:full,body_text:JSON.stringify(full),route:BASE+'/upload',
    file_key:state.workspace+':'+body.sha256,file:{filename:body.filename,bytes:file.size,sha256:body.sha256},remote:latest,
    upload_headers:{'Content-Type':'application/json','X-DuckDB-Request-ID':remote.request_id,'X-DuckDB-Source-Sha256':body.sha256,'X-DuckDB-Filename':encodeURIComponent(body.filename)}};
  await new Promise((resolve,reject)=>{
    const tx=state.db.transaction(['requests','files'],'readwrite'),requests=tx.objectStore('requests'),lookup=requests.get(candidate.key);let failure=null;
    lookup.onsuccess=()=>{
      const prior=lookup.result;
      if(prior&&(prior.kind!=='retain'||canonical(prior.body)!==canonical(candidate.body)||canonical(prior.upload_headers)!==canonical(candidate.upload_headers))){
        failure=new Error('The retained browser request has another original upload binding.');tx.abort();return;
      }
      if(!prior)requests.add(candidate);
      tx.objectStore('files').put({key:candidate.file_key,blob:file,bytes:file.size,sha256:body.sha256});
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('The exact original upload could not be restored in this browser.'));
  });
  await loadRequests();renderRequests();notice('The exact report is retained with its original native request ID and filename. Continue that original request.');
}
function renderNativeRequest(remote){
  const root=el('section',undefined,'request-record'),id=remote.request_id;root.dataset.nativeRequestId=id;root.dataset.nativeRequestKind=remote.kind;
  root.append(facts([['Kind',remote.kind],['State',remote.state],['Request',id],['Created',when(remote.created_at)]]));
  if(HEX32.test(id||''))root.append(toolbar(button('Reopen native request',async()=>{
    const full=await api(BASE+'/requests/'+id);state.requestDetails.set(id,full);renderRequests();notice('Complete native request reopened.');
  },{small:true})));
  const full=state.requestDetails.get(id);
  if(full){
    root.append(details('Complete original native record',full));
    if(full.state==='COMPLETE'&&full.result)root.append(toolbar(button('Open returned result',()=>receiveResult({kind:full.kind,body:full.body},full.result),{small:true})));
    else if(full.kind!=='retain')root.append(toolbar(button('Continue retained native operation',async()=>{
      const result=await api(BASE+'/requests/'+id+'/resume',{workspace_id:state.workspace});await receiveResult({kind:full.kind,body:full.body},result);await loadOperations(0);notice('Original native operation continued.');
    },{small:true})));
    else{
      const file=input('',null,{type:'file'});file.accept='.json,application/json';
      file.addEventListener('change',()=>action('Restoring original native upload',()=>recoverNativeUpload(full,file.files?.[0])));
      root.append(field('Restore original report for this upload',file,'Select the exact report from this original request. Its SHA-256, request ID and original filename are preserved. Continue the retained request after restoring its bytes.'));
    }
  }
  return root;
}
function renderRequests(){
  const root=$('screen-requests');root.replaceChildren(heading('requests','Saved requests','Reopen a request and its complete result. Resuming or resending the original request requires an explicit action.',
    button('Refresh original requests',async()=>{await loadRequests();await loadOperations(0);notice('Original request catalogs refreshed.');})));
  const local=panel('Retained in this browser');
  if(!state.requests.length)local.append(empty('Uploads, source reviews, edition imports and pair saves retain their complete requests here before sending.'));
  for(const row of state.requests)local.append(renderLocalRequest(row));root.append(local);
  const native=panel('Native intake journal');
  for(const row of state.operations.operations||[])native.append(renderNativeRequest(row));
  if(!(state.operations.operations||[]).length)native.append(empty('No native intake operations are present on this page.'));
  native.append(pager(state.operations,loadOperations));root.append(native);
}
async function refresh(){
  await loadIdentity();await Promise.all([loadStatus(),loadReports(0),loadReviews(0),loadOperations(0),loadRequests()]);
  notice('Saved catalogs refreshed. The complete field and pair drafts remain in their editors.');
}
async function start(){
  renderReports();renderSource();renderEditions();renderPair();renderRequests();await loadIdentity();
  try{
    state.db=await openStorage();
    state.db.onversionchange=()=>{state.db.close();state.db=null;state.storageError=new Error('Browser request storage changed in another tab. Reopen this workspace.');notice(state.storageError.message,'error');};
    state.pair=await stored('drafts',state.workspace+':pair')||newPairDefinition();
    if(state.pair.workspace_id!==state.workspace)throw new Error('The pair draft belongs to another original workspace.');
    await loadRequests();
  }catch(error){
    state.storageError=error;$('storage-notice').textContent='Browser request storage is unavailable. '+error.message;$('storage-notice').hidden=false;
    state.pair=newPairDefinition();
  }
  let draftError=null;
  if(state.pair){
    const ids=[state.pair.definition.source_edition,state.pair.definition.target_edition].filter(Boolean);
    const opened=await Promise.allSettled(ids.map(edition));draftError=opened.find(x=>x.status==='rejected')?.reason||null;
  }
  await Promise.all([loadStatus(),loadReports(0),loadReviews(0),loadOperations(0)]);
  renderPair();let screen='reports';
  try{const saved=sessionStorage.getItem('stellar_duckdb_timescale_screen');if(['reports','source','editions','pair','requests'].includes(saved))screen=saved;}catch{}
  show(screen==='source'?'reports':screen);
  if(draftError)notice('The complete pair draft is retained. An original edition could not be reopened: '+draftError.message,'error');
  else notice('Original workspace opened. Retain a commissioning report or reopen a saved review.');
}
$('dataset-home').href='/#'+capability;$('reconciliation-home').href='/reconciliation/#'+capability;
$('refresh').addEventListener('click',()=>action('Refreshing saved catalogs',refresh));
document.querySelectorAll('nav [data-screen]').forEach(n=>n.addEventListener('click',()=>{
  if(state.busy)return;
  const screen=n.dataset.screen;
  if(screen==='source')renderSource();else if(screen==='editions')renderEditions();else if(screen==='pair')renderPair();else if(screen==='requests')renderRequests();
  show(screen);
}));
window.addEventListener('pagehide',()=>{clearTimeout(state.draftTimer);clearTimeout(state.pairTimer);saveDraft().catch(()=>{});savePairDraft().catch(()=>{});});
action('Opening original workspace',start);
