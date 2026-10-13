'use strict';

const $ = id => document.getElementById(id);
const API = '/api/reconciliation';
const LIMIT = 100;
const ID32 = /^[0-9a-f]{32}$/;
const ID64 = /^[0-9a-f]{64}$/;
const STATES = {
  ELIGIBLE:['Available','The earlier decision can be selected for this target revision.'],
  PRIOR_OPEN:['Earlier decision open','The earlier report has no resolved disposition to carry.'],
  POLICY_CHANGED:['Policy changed','A source meaning, scope, mapping or comparison rule requires a new review.'],
  GROUP_MISSING:['Group missing','The original key group is absent from this later run.'],
  VALUES_CHANGED:['Values changed','The complete original values or canonical comparison differ.'],
  ROW_MISSING:['Row missing','The original row is absent from the later run.'],
  ROW_AMBIGUOUS:['Row ambiguous','More than one original row could receive this row decision.'],
  TARGET_REVIEWED:['Already reviewed','The later run already has a decision for this subject.']
};
const emptyPage = key => ({[key]:[],offset:0,limit:LIMIT,total:0,next_offset:null});
const state = {
  workspace:null,identity:null,db:null,storageError:null,busy:false,screen:'choose',
  pair:null,sourceRun:null,sourceReport:null,targetRun:null,review:null,application:null,
  pairs:emptyPage('pairs'),sourceRuns:emptyPage('runs'),targetRuns:emptyPage('runs'),reports:emptyPage('reports'),
  reviews:emptyPage('reviews'),applications:emptyPage('applications'),operations:emptyPage('operations'),
  candidates:emptyPage('candidates'),candidateFilter:{state:'',kind:''},
  selected:new Set(),candidateCache:new Map(),detail:null,original:null,
  scopeBasis:'',actor:'',reason:'',localRequests:[],requestDetail:null,draftTimer:null,storageQueue:Promise.resolve()
};
let capability = location.hash.slice(1);
try {
  if(capability) sessionStorage.setItem('stellar_duckdb_capability',capability);
  else capability = sessionStorage.getItem('stellar_duckdb_capability') || '';
} catch {}
if(location.hash) history.replaceState(null,'',location.pathname+location.search);

const pretty = value => JSON.stringify(value,null,2);
const short = value => {const s=String(value??'');return s.length>27?s.slice(0,16)+'…'+s.slice(-8):s;};
const count = value => typeof value==='number'?value.toLocaleString():String(value??'—');
const when = value => {if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString();};
const clone = value => JSON.parse(JSON.stringify(value));
const scalar = value => value&&typeof value==='object'&&Object.hasOwn(value,'type')&&Object.hasOwn(value,'text')?(value.type==='null'?null:value.text):value;
function nativeText(value) {value=scalar(value);return value===null?'NULL':value===undefined?'—':typeof value==='object'?pretty(value):String(value);}
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function requireId(value,label,pattern=ID64) {if(!pattern.test(value||''))throw new Error('Enter the complete '+label+' identifier.');return value;}
function integer(value,label) {value=scalar(value);if(!/^(0|[1-9][0-9]*)$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw new Error('The original '+label+' is not a safe row or sequence index.');return Number(value);}
function requiredText(value,label,maximum) {if(typeof value!=='string'||!value.trim())throw new Error('Enter '+label+'.');if(new TextEncoder().encode(value).length>maximum)throw new Error(label+' exceeds '+maximum.toLocaleString()+' UTF-8 bytes.');return value;}
function node(tag,text,className) {const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(className)n.className=className;return n;}
function disabled(n,value) {n.dataset.disabled=String(Boolean(value));n.disabled=state.busy||Boolean(value);return n;}
function button(label,callback,{primary=false,small=false,off=false}={}) {
  const b=node('button',label,[primary?'primary':'',small?'small':''].filter(Boolean).join(' '));b.type='button';disabled(b,off);
  b.addEventListener('click',()=>action(label,callback));return b;
}
function input(value='',options={}) {const n=node(options.multiline?'textarea':'input');if(!options.multiline)n.type='text';n.value=value;n.autocomplete='off';if(options.placeholder)n.placeholder=options.placeholder;if(options.oninput)n.addEventListener('input',()=>options.oninput(n.value));return disabled(n,options.off);}
let captionNumber=0;
function field(label,control,hint) {
  const wrap=node('div',undefined,'field'),caption=node('label',label,'field-caption'),id='carry-field-'+(++captionNumber);
  control.id=id;caption.htmlFor=id;caption.id=id+'-caption';control.setAttribute('aria-labelledby',caption.id);wrap.append(caption,control);
  if(hint){const h=node('p',hint,'hint');h.id=id+'-hint';control.setAttribute('aria-describedby',h.id);wrap.append(h);}
  return wrap;
}
function toolbar(...children) {const n=node('div',undefined,'toolbar');n.append(...children);return n;}
function panel(title,...children) {const n=node('div',undefined,'panel');n.append(node('h3',title),...children);return n;}
function heading(id,title,text) {const n=node('div',undefined,'heading'),h=node('h2',title);h.id=id+'-title';n.append(h,node('p',text));return n;}
function empty(text) {return node('p',text,'empty');}
function facts(rows) {const dl=node('dl',undefined,'facts');for(const [label,value]of rows){dl.append(node('dt',label),node('dd',value===undefined||value===null?'—':typeof value==='object'?pretty(value):value));}return dl;}
function details(label,value,{open=false}={}) {const d=node('details');d.open=open;d.append(node('summary',label),node('pre',pretty(value)));return d;}
function line(text) {return node('p',text,'identity-line');}
function notice(text,level='info') {const n=$('notice');n.textContent=text||'';n.dataset.level=level;n.hidden=!text;}
function setBusy(value) {state.busy=value;$('main').setAttribute('aria-busy',String(value));document.querySelectorAll('button,input,select,textarea').forEach(n=>{n.disabled=value||n.dataset.disabled==='true';});}
async function action(label,work) {
  if(state.busy)return;setBusy(true);notice(label+'…');
  try {await work();}
  catch(error){notice(error.message||String(error),'error');}
  finally {setBusy(false);}
}
function show(name) {
  state.screen=name;document.querySelectorAll('.screen').forEach(n=>{n.hidden=n.id!=='screen-'+name;});
  document.querySelectorAll('[data-screen]').forEach(n=>{if(n.dataset.screen===name)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
  try{sessionStorage.setItem('stellar_duckdb_carry_screen',name);}catch{}
}
function query(values) {const params=new URLSearchParams();for(const[k,v]of Object.entries(values))if(v!==undefined&&v!==null&&v!=='')params.set(k,String(v));return params.size?'?'+params.toString():'';}
async function api(path,bodyText) {
  const options={method:bodyText===undefined?'GET':'POST',cache:'no-store',headers:{'X-DuckDB-Capability':capability}};
  if(state.workspace)options.headers['X-DuckDB-Workspace-ID']=state.workspace;
  if(bodyText!==undefined){options.headers['Content-Type']='application/json';options.body=bodyText;}
  let response,result;
  try{response=await fetch(path,options);}catch(cause){const e=new Error('The local workspace could not be reached. Open Saved requests to inspect the original request before continuing.');e.transport=true;e.cause=cause;throw e;}
  try{result=await response.json();}catch(cause){const e=new Error('The workspace response could not be read. The original saved request remains available.');e.transport=true;e.status=response.status;e.cause=cause;throw e;}
  if(!response.ok){
    const code=typeof result.error==='string'?result.error:'DUCKDB_REQUEST_FAILED',detail=result.detail||result.message||'';
    const e=new Error(response.status===403?'Reopen this workspace using its original private launch link.':code+(detail?'\n'+(typeof detail==='string'?detail:pretty(detail)):''));
    e.code=code;e.status=response.status;e.result=result;throw e;
  }
  if(state.workspace&&result.workspace_id&&result.workspace_id!==state.workspace)throw new Error('The local listener belongs to another workspace. Reopen the intended project.');
  return result;
}
function saveJson(value,name) {const blob=new Blob([pretty(value)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function table(headers,rows) {const wrap=node('div',undefined,'table-wrap'),t=node('table'),thead=node('thead'),tr=node('tr'),body=node('tbody');for(const h of headers){const th=node('th',h);th.scope='col';tr.append(th);}thead.append(tr);for(const cells of rows){const row=node('tr');for(const c of cells){const td=node('td');td.append(c instanceof Node?c:document.createTextNode(nativeText(c)));row.append(td);}body.append(row);}t.append(thead,body);wrap.append(t);return wrap;}
function pager(record,key,load) {
  const n=node('div',undefined,'pager'),length=(record[key]||[]).length,offset=record.offset||0,limit=record.limit||LIMIT;
  n.append(node('span',record.total?count(offset+1)+'–'+count(offset+length)+' of '+count(record.total):'No records'),
    toolbar(button('Previous',()=>load(Math.max(0,offset-limit)),{small:true,off:offset===0}),button('Next',()=>load(record.next_offset),{small:true,off:record.next_offset===null||record.next_offset===undefined})));
  return n;
}
async function pageAt(path,key,offset=0,filters={}) {
  const result=await api(API+path+query({...filters,offset,limit:LIMIT}));
  if(!Array.isArray(result[key])||!Number.isSafeInteger(result.total)||result.total<0||result.offset!==offset||result[key].length>LIMIT)
    throw new Error('The original '+key+' catalog returned an invalid page.');
  if(result.next_offset!==null&&result.next_offset!==undefined&&(!Number.isSafeInteger(result.next_offset)||result.next_offset<=offset))throw new Error('The original catalog repeated its continuation offset.');
  return {...emptyPage(key),...result};
}
function select(values,current,changed) {
  const n=node('select');for(const [value,label]of values){const o=node('option',label);o.value=String(value);n.append(o);}
  n.value=current||'';disabled(n,false);n.addEventListener('change',()=>action('Opening selected record',()=>changed(n.value)));return n;
}
function selectedOptions(rows,idName,selected,label) {
  const choices=[['','Choose a saved record']],ids=new Set();
  for(const row of rows){choices.push([row[idName],label(row)]);ids.add(row[idName]);}
  if(selected&&!ids.has(selected[idName]))choices.push([selected[idName],label(selected)+' · selected from another page']);
  return choices;
}
function openStorage() {
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('Enable browser storage to retain each original request before sending.'));return;}
    const request=indexedDB.open('stellar_duckdb_reconciliation',1);
    request.onupgradeneeded=()=>{for(const name of ['requests','drafts'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'key'});};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close the older workspace tab so its request storage can open.'));request.onsuccess=()=>resolve(request.result);
  });
}
function readStore(name,key) {
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{const tx=state.db.transaction(name,'readonly'),req=key===undefined?tx.objectStore(name).getAll():tx.objectStore(name).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error||new Error('Browser storage read interrupted.'));});
}
function writeStore(name,value) {
  if(!state.db)return Promise.reject(state.storageError||new Error('Browser request storage is unavailable.'));
  return new Promise((resolve,reject)=>{const tx=state.db.transaction(name,'readwrite');tx.objectStore(name).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Browser storage write interrupted.'));});
}
async function loadLocalRequests() {
  if(!state.db)return;
  const all=await readStore('requests');state.localRequests=all.filter(r=>r.workspace_id===state.workspace&&([API+'/carry-review',API+'/carry-apply'].includes(r.route)||(r.context==='decision-carry'&&[API+'/report',API+'/exports'].includes(r.route)))).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
}
async function keepRequest(record) {
  await writeStore('requests',record);const i=state.localRequests.findIndex(x=>x.request_id===record.request_id);if(i===-1)state.localRequests.unshift(record);else state.localRequests[i]=record;
}
function draftRecord() {return {key:state.workspace+':decision-carry',workspace_id:state.workspace,pair_id:state.pair?.pair_id||null,source_run_id:state.sourceRun?.run_id||null,source_report_id:state.sourceReport?.report_id||null,target_run_id:state.targetRun?.run_id||null,review_id:state.review?.review_id||null,scope_basis:state.scopeBasis,actor:state.actor,reason:state.reason,updated_at:new Date().toISOString()};}
async function persistDraft() {
  if(!state.db||!state.workspace)return;
  clearTimeout(state.draftTimer);const choice=draftRecord(),review=state.review?{key:state.workspace+':decision-carry:'+state.review.review_id,workspace_id:state.workspace,review_id:state.review.review_id,selected_candidate_ids:[...state.selected].sort((a,b)=>a-b),actor:state.actor,reason:state.reason,updated_at:new Date().toISOString()}:null;
  const write=state.storageQueue.catch(()=>{}).then(async()=>{await writeStore('drafts',choice);if(review)await writeStore('drafts',review);});state.storageQueue=write;return write;
}
function editedDraft() {clearTimeout(state.draftTimer);state.draftTimer=setTimeout(()=>persistDraft().catch(e=>notice('The current draft could not be retained: '+e.message,'error')),250);}
function newRequestId() {return Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');}
function requestPath(record) {return (record.family==='export'?'/api':API)+'/requests/'+record.request_id;}
function pendingApply() {return state.review&&state.localRequests.find(r=>r.route===API+'/carry-apply'&&r.state!=='COMPLETE'&&JSON.parse(r.body_text).review_id===state.review.review_id);}
async function inspectRequest(record) {
  const remote=await api(requestPath(record));if(remote.request_id!==record.request_id)throw new Error('The original request identifier changed.');
  const nativeRoute=record.family==='export'?remote.route:API+'/'+remote.kind;
  if(nativeRoute!==record.route||canonical(remote.body)!==canonical(JSON.parse(record.body_text)))throw new Error('The native request body differs from the retained original selection.');
  if(remote.state==='COMPLETE'&&!remote.result)throw new Error('The completed native request did not return its original result.');
  const updated={...record,remote,inspected_at:new Date().toISOString()};
  if(remote.state==='COMPLETE'){updated.state='COMPLETE';updated.result=remote.result;}
  await keepRequest(updated);state.requestDetail=remote;return updated;
}
async function sendSavedRequest(record,path=record.route,body=record.body_text) {
  let result;
  try {result=await api(path,body);}
  catch(error) {
    await keepRequest({...record,state:error.transport?'RESPONSE_UNKNOWN':'RETURNED_ERROR',last_error:{message:error.message,code:error.code||null,status:error.status||null,at:new Date().toISOString()}});
    renderRequests();renderReview();throw error;
  }
  await keepRequest({...record,state:'COMPLETE',result,completed_at:new Date().toISOString()});return result;
}
async function continueRequest(record) {
  let inspected;
  try {inspected=await inspectRequest(record);}
  catch(error){if(error.status!==404)throw error;return sendSavedRequest(record);}
  if(inspected.state==='COMPLETE')return inspected.result;
  return sendSavedRequest(inspected,requestPath(record)+'/resume',JSON.stringify(record.family==='export'?{}:{workspace_id:state.workspace}));
}
async function retained(kind,body) {
  if(!state.db)throw state.storageError||new Error('Browser request storage is unavailable.');
  await persistDraft();const route=API+'/'+kind,meaning=route+':'+canonical(body),prior=state.localRequests.find(r=>r.meaning===meaning&&r.state!=='COMPLETE');
  if(prior)return continueRequest(prior);
  const request_id=newRequestId(),full={...body,request_id},record={key:state.workspace+':'+request_id,workspace_id:state.workspace,request_id,route,family:kind==='exports'?'export':'reconciliation',context:'decision-carry',body_text:JSON.stringify(full),meaning,state:'PREPARED',created_at:new Date().toISOString()};
  await keepRequest(record);return sendSavedRequest(record);
}


function clearReview() {state.review=null;state.application=null;state.selected=new Set();state.candidateCache=new Map();state.detail=null;state.original=null;state.candidates=emptyPage('candidates');state.candidateFilter={state:'',kind:''};}
function pairLabel(p) {return (p.label||p.definition?.label||p.name||p.definition?.name||'Pair')+' · revision '+p.revision+' · '+short(p.pair_id);}
function runLabel(r) {return (r.label||'Run')+' · '+when(r.created_at)+' · decision revision '+r.review_revision+' · '+short(r.run_id);}
function reportLabel(r) {return 'Report · '+when(r.created_at)+' · decision revision '+r.review_revision+' · '+short(r.report_id);}
async function loadPairs(offset=0) {state.pairs=await pageAt('/pairs','pairs',offset);renderChoose();}
async function loadSourceRuns(offset=0) {if(!state.pair)return;state.sourceRuns=await pageAt('/runs','runs',offset,{pair_id:state.pair.pair_id});renderChoose();}
async function loadTargetRuns(offset=0) {if(!state.pair)return;state.targetRuns=await pageAt('/runs','runs',offset,{pair_id:state.pair.pair_id});renderChoose();}
async function loadReports(offset=0) {if(!state.sourceRun)return;state.reports=await pageAt('/reports','reports',offset,{run_id:state.sourceRun.run_id});renderChoose();}
async function choosePair(id) {
  await persistDraft();
  const pair=id?await api(API+'/pairs/'+requireId(id,'pair')):null;
  state.pair=pair;state.sourceRun=null;state.sourceReport=null;state.targetRun=null;clearReview();state.reports=emptyPage('reports');
  if(pair){const runs=await pageAt('/runs','runs',0,{pair_id:pair.pair_id});state.sourceRuns=runs;state.targetRuns=clone(runs);}
  else{state.sourceRuns=emptyPage('runs');state.targetRuns=emptyPage('runs');}
  await persistDraft();renderAll();notice(pair?'Pair opened. Choose the earlier report and the later run.':'Pair selection cleared.');
}
async function chooseSourceRun(id) {
  await persistDraft();
  if(!id){state.sourceRun=null;state.sourceReport=null;state.reports=emptyPage('reports');clearReview();await persistDraft();renderAll();return;}
  const run=await api(API+'/runs/'+requireId(id,'earlier run'));
  if(!state.pair||run.pair_id!==state.pair.pair_id)throw new Error('Choose an earlier run of the selected pair.');
  state.sourceRun=run;state.sourceReport=null;if(state.targetRun?.run_id===run.run_id)state.targetRun=null;clearReview();
  state.reports=await pageAt('/reports','reports',0,{run_id:run.run_id});await persistDraft();renderAll();notice('Earlier run opened. Choose one of its frozen reports.');
}
async function chooseReport(id) {
  await persistDraft();
  if(!id){state.sourceReport=null;clearReview();await persistDraft();renderAll();return;}
  const report=await api(API+'/reports/'+requireId(id,'source report'));
  const run=await api(API+'/runs/'+requireId(report.run_id,'source run'));
  const pair=await api(API+'/pairs/'+requireId(run.pair_id,'pair'));
  if(report.pair_id&&report.pair_id!==pair.pair_id)throw new Error('The frozen report belongs to a different pair.');
  state.pair=pair;state.sourceRun=run;state.sourceReport=report;
  if(state.targetRun&&(state.targetRun.pair_id!==pair.pair_id||state.targetRun.run_id===run.run_id))state.targetRun=null;
  clearReview();
  const [runs,reports]=await Promise.all([pageAt('/runs','runs',0,{pair_id:pair.pair_id}),pageAt('/reports','reports',0,{run_id:run.run_id})]);
  state.sourceRuns=runs;state.targetRuns=clone(runs);state.reports=reports;await persistDraft();renderAll();notice('The complete frozen report is selected at decision revision '+report.review_revision+'.');
}
async function chooseTargetRun(id) {
  await persistDraft();
  if(!id){state.targetRun=null;clearReview();await persistDraft();renderAll();return;}
  const run=await api(API+'/runs/'+requireId(id,'later run'));
  if(!state.pair||run.pair_id!==state.pair.pair_id)throw new Error('Choose a later run of the same selected pair.');
  if(run.run_id===state.sourceRun?.run_id)throw new Error('Choose a different run from the report’s original run.');
  state.targetRun=run;clearReview();await persistDraft();renderAll();notice('Later run selected at decision revision '+run.review_revision+'.');
}
function directId(label,placeholder,open,off=false) {
  const control=input('',{placeholder,off}),wrap=node('div'),go=button('Open '+label,()=>open(control.value.trim()),{small:true,off});
  wrap.append(field('Complete '+label+' identifier',control),toolbar(go));return wrap;
}
function renderChoose() {
  const root=$('screen-choose');root.replaceChildren(heading('choose','Choose a continuing comparison','Use a frozen report as the source of earlier decisions. Choose a different run of the same pair and explain the continuing engineering scope.'));
  const pairControl=select(selectedOptions(state.pairs.pairs,'pair_id',state.pair,pairLabel),state.pair?.pair_id,choosePair);
  const pairPanel=panel('Comparison pair',field('Saved pair',pairControl),pager(state.pairs,'pairs',loadPairs));
  const pairDirect=node('details');pairDirect.append(node('summary','Open a pair by its complete identifier'),directId('pair','64-character pair identifier',choosePair));pairPanel.append(pairDirect);root.append(pairPanel);
  const columns=node('div',undefined,'columns');
  const earlier=panel('1. Earlier frozen report');
  if(!state.pair)earlier.append(empty('Choose the comparison pair first.'));
  else {
    earlier.append(field('Earlier run',select(selectedOptions(state.sourceRuns.runs,'run_id',state.sourceRun,runLabel),state.sourceRun?.run_id,chooseSourceRun)),pager(state.sourceRuns,'runs',loadSourceRuns));
    if(state.sourceRun)earlier.append(field('Frozen report',select(selectedOptions(state.reports.reports,'report_id',state.sourceReport,reportLabel),state.sourceReport?.report_id,chooseReport)),pager(state.reports,'reports',loadReports));
    if(state.sourceReport)earlier.append(node('hr',undefined,'quiet-rule'),facts([['Source report',state.sourceReport.report_id],['Original run',state.sourceReport.run_id],['Frozen decision revision',state.sourceReport.review_revision],['Saved',when(state.sourceReport.created_at)]]),details('Complete earlier report',state.sourceReport));
  }
  const later=panel('2. Later run');
  if(!state.pair)later.append(empty('Choose the comparison pair first.'));
  else {
    const rows=state.targetRuns.runs.filter(r=>r.run_id!==state.sourceRun?.run_id);
    later.append(field('Run receiving the decisions',select(selectedOptions(rows,'run_id',state.targetRun,runLabel),state.targetRun?.run_id,chooseTargetRun),'Only a different run of the same pair can receive a selection.'),pager(state.targetRuns,'runs',loadTargetRuns));
    if(state.targetRun)later.append(node('hr',undefined,'quiet-rule'),facts([['Target run',state.targetRun.run_id],['Current decision revision',state.targetRun.review_revision],['Pair revision',state.targetRun.pair_revision],['Saved',when(state.targetRun.created_at)]]),details('Complete later run',state.targetRun));
    const direct=node('details');direct.append(node('summary','Open a later run by its complete identifier'),directId('later run','64-character run identifier',chooseTargetRun));later.append(direct);
  }
  columns.append(earlier,later);root.append(columns);
  const reportDirect=node('details');reportDirect.append(node('summary','Open a frozen report directly'),directId('source report','64-character report identifier',chooseReport));root.append(reportDirect);
  const scope=input(state.scopeBasis,{multiline:true,oninput:value=>{state.scopeBasis=value;editedDraft();}});
  const create=panel('3. Explain the continuing scope',
    field('Engineering basis',scope,'Describe why these two runs continue the same comparison, including any capture-window changes. This text is retained with the complete review. Source-meaning and value checks still apply.'),
    toolbar(button('Create decision review',createReview,{primary:true,off:!state.sourceReport||!state.targetRun||!state.db}),node('span','Creates a saved review; decisions are applied only after selection.','muted')));
  root.append(create);
}
async function createReview() {
  if(!state.sourceReport||!state.targetRun||!state.pair)throw new Error('Choose the source report and later run.');
  if(state.targetRun.pair_id!==state.pair.pair_id||state.targetRun.run_id===state.sourceReport.run_id)throw new Error('The later run must be a different run of the same pair.');
  const result=await retained('carry-review',{workspace_id:state.workspace,source_report_id:state.sourceReport.report_id,target_run_id:state.targetRun.run_id,expected_revision:state.targetRun.review_revision,scope_basis:requiredText(state.scopeBasis,'the engineering basis',16000)});
  await openReview(result.review_id);notice('The complete decision review is saved. Select the available decisions you intend to carry forward.','success');
}
async function loadCandidates(offset=0) {
  if(!state.review)return;
  const result=await pageAt('/carry-reviews/'+state.review.review_id+'/candidates','candidates',offset,state.candidateFilter);
  if(result.review_id!==state.review.review_id)throw new Error('The candidate catalog belongs to another review.');
  for(const row of result.candidates){integer(row.candidate_id,'prior decision sequence');state.candidateCache.set(row.candidate_id,row);}
  state.candidates=result;renderReview();
}
async function readAllCandidates(filters={}) {
  if(!state.review)throw new Error('Open a decision review.');
  const id=state.review.review_id,rows=[],seen=new Set();let offset=0,total=null;
  while(true){
    const result=await pageAt('/carry-reviews/'+id+'/candidates','candidates',offset,filters);
    if(result.review_id!==id||state.review.review_id!==id)throw new Error('The selected review changed while reading its candidates.');
    if(total===null)total=result.total;else if(total!==result.total)throw new Error('The immutable candidate catalog changed size.');
    for(const row of result.candidates){integer(row.candidate_id,'prior decision sequence');if(seen.has(row.candidate_id))throw new Error('The candidate catalog repeated a prior decision.');seen.add(row.candidate_id);rows.push(row);}
    if(result.next_offset===null||result.next_offset===undefined)break;offset=result.next_offset;
  }
  if(rows.length!==total)throw new Error('The full candidate catalog was not returned. The current selection is unchanged.');
  return rows;
}
async function openReview(id) {
  if(state.review||state.pair)await persistDraft();
  const review=await api(API+'/carry-reviews/'+requireId(id,'review'));
  if(review.review_id!==id||!ID64.test(review.review_sha256||''))throw new Error('The original review identity is incomplete.');
  const [report,sourceRun,targetRun,pair]=await Promise.all([
    api(API+'/reports/'+requireId(review.source_report_id,'source report')),
    api(API+'/runs/'+requireId(review.source_run_id,'source run')),
    api(API+'/runs/'+requireId(review.target_run_id,'target run')),
    api(API+'/pairs/'+requireId(review.pair_id,'pair'))
  ]);
  if(sourceRun.pair_id!==pair.pair_id||targetRun.pair_id!==pair.pair_id||sourceRun.run_id===targetRun.run_id||report.run_id!==sourceRun.run_id||report.review_revision!==review.source_report_revision)
    throw new Error('The saved review does not match its original report and run identities.');
  state.pair=pair;state.sourceRun=sourceRun;state.sourceReport=report;state.targetRun=targetRun;clearReview();state.review=review;state.scopeBasis=review.scope_basis;
  if(state.db){const saved=await readStore('drafts',state.workspace+':decision-carry:'+id);if(saved?.workspace_id===state.workspace&&saved.review_id===id){state.selected=new Set((saved.selected_candidate_ids||[]).filter(v=>Number.isSafeInteger(v)&&v>=1));state.actor=saved.actor||state.actor;state.reason=saved.reason||'';}}
  await loadCandidates(0);await persistDraft();renderAll();show('review');notice('Saved review reopened. The earlier report is frozen at revision '+review.source_report_revision+'.');
}
async function openApplication(id) {
  const app=await api(API+'/carry-applications/'+requireId(id,'application'));
  if(app.application_id!==id)throw new Error('The original application identifier changed.');
  await openReview(app.review_id);if(app.review_sha256!==state.review.review_sha256||app.target_run_id!==state.review.target_run_id||app.source_report_id!==state.review.source_report_id)throw new Error('The application does not match its original saved review.');state.application=app;renderReview();show('review');notice('The original applied selection and complete report lineage are open.','success');
}
function reviewStale() {return Boolean(state.review&&state.targetRun&&state.targetRun.review_revision!==state.review.target_review_revision);}
function canSelect() {return Boolean(state.review&&state.review.policy.compatible&&!state.application&&!reviewStale()&&!pendingApply()&&state.db);}
async function selectAllEligible() {
  if(!canSelect())throw new Error('Open an unapplied review at the current target revision.');
  const rows=await readAllCandidates({state:'ELIGIBLE'});
  if(rows.some(r=>r.state!=='ELIGIBLE'))throw new Error('The available-decision catalog returned another state.');
  const selected=new Set(state.selected);for(const row of rows){selected.add(row.candidate_id);state.candidateCache.set(row.candidate_id,row);}state.selected=selected;
  await persistDraft();renderReview();notice(count(rows.length)+' available decisions selected across the complete catalog. Review the selection and enter the engineer and reason before applying.');
}
async function selectPage() {
  if(!canSelect())throw new Error('Open an unapplied review at the current target revision.');
  for(const row of state.candidates.candidates)if(row.state==='ELIGIBLE')state.selected.add(row.candidate_id);
  await persistDraft();renderReview();notice('Available decisions on this page added to the selection.');
}
async function clearSelection() {state.selected.clear();await persistDraft();renderReview();notice('Selection cleared. The saved review is unchanged.');}
async function inspectCandidate(id) {
  if(!state.review)return;
  const candidate=await api(API+'/carry-reviews/'+state.review.review_id+'/candidates/'+integer(id,'prior decision sequence'));
  if(candidate.candidate_id!==id)throw new Error('The original candidate sequence changed.');
  state.candidateCache.set(id,candidate);state.detail=candidate;state.original=null;renderReview();
  document.getElementById('candidate-inspection')?.scrollIntoView({block:'start',behavior:'smooth'});notice('Complete earlier decision, target subject and checks opened.');
}
function subjectTitle(subject) {if(!subject)return 'Absent';return subject.kind==='group'?'Key group '+nativeText(subject.group_id):subject.kind==='row'?(subject.side==='source'?'Source':'Target')+' row '+nativeText(subject.row):pretty(subject);}
function stateBadge(value) {const n=node('span',STATES[value]?.[0]||value,'state-label');n.dataset.state=value;n.title=value;return n;}
function reasonsList(reasons) {const ul=node('ul',undefined,'reasons');for(const reason of reasons||[])ul.append(node('li',typeof reason==='string'?reason:pretty(reason)));return ul;}
function decisionSummary(record) {if(!record)return 'No target decision';return (record.outcome||'Recorded decision')+(record.actor?' · '+record.actor:'');}
function checkText(value) {return value===true?'Passed':value===false?'Not passed':value===null||value===undefined?'Not applicable':typeof value==='object'?pretty(value):String(value);}
function metrics(review) {
  const n=node('div',undefined,'metrics');
  for(const [label,value]of [['Earlier decisions',review.summary.total],...Object.keys(STATES).filter(k=>review.summary.states?.[k]!==undefined).map(k=>[STATES[k][0],review.summary.states[k]])]){
    const m=node('div',undefined,'metric');m.append(node('strong',count(value)),node('span',label));n.append(m);
  }
  return n;
}


function renderReview() {
  const root=$('screen-review');root.replaceChildren(heading('review','Review earlier decisions','Inspect the complete earlier disposition and the later subject. Available decisions remain unselected until you choose them.'));
  const review=state.review;
  if(!review){root.append(panel('Open a saved review',empty('Create a review from an earlier frozen report and a later run, or open an existing review from Saved applications.'),toolbar(button('Choose comparison',async()=>show('choose')),button('Saved applications',async()=>{await refreshHistory();show('history');}))),panel('Open by identifier',directId('review','64-character review identifier',openReview)));return;}
  const summary=panel('Saved decision review',
    facts([['Review',review.review_id],['Original report',review.source_report_id],['Frozen source decision revision',review.source_report_revision],['Later run',review.target_run_id],['Reviewed target revision',review.target_review_revision],['Current target revision',state.targetRun?.review_revision],['Saved',when(review.created_at)]]),
    metrics(review),node('h4','Engineering basis'),node('p',review.scope_basis),
    toolbar(button('Refresh target revision',async()=>{state.targetRun=await api(API+'/runs/'+review.target_run_id);renderReview();notice('Current target revision reopened. The saved review and selection remain unchanged.');},{small:true}),
      button('Download complete review',async()=>{saveJson(review,'decision-review-'+review.review_id+'.json');notice('Complete saved review download prepared.');},{small:true}),
      button('Download all candidates',async()=>{const candidates=await readAllCandidates();saveJson({review,candidates},'decision-review-'+review.review_id+'-all-candidates.json');notice(count(candidates.length)+' complete candidate records included in the download.');},{small:true})),
    details('Complete immutable review record',review));
  root.append(summary);
  const policy=panel('Source meanings and comparison policy',
    node('p',review.policy.compatible?'Source meaning and comparison policy are compatible.':'The current source meaning or comparison policy requires review.','status-line'));
  if(review.policy.blocking_reasons?.length)policy.append(reasonsList(review.policy.blocking_reasons));
  if(Array.isArray(review.policy.checks))policy.append(table(['Native policy check','Result','Basis'],review.policy.checks.map(check=>[check.name,checkText(check.equal),check.basis])));
  policy.append(details('Capture and scope changes',review.policy.capture_changes),
    details('Complete earlier report source review',review.source_review),details('Complete later run source review',review.target_review));
  root.append(policy);
  if(state.application){root.append(applicationPanel(state.application));}
  else if(reviewStale()){
    root.append(panel('The later run has changed',
      node('p','This review was prepared at target decision revision '+review.target_review_revision+'. The current target revision is '+state.targetRun.review_revision+'. Preserve this review and create a new review before applying another selection.'),
      toolbar(button('Create review at current revision',async()=>{state.targetRun=await api(API+'/runs/'+review.target_run_id);await createReview();},{primary:true,off:!state.db}))));
  }
  const pending=pendingApply();
  if(pending&&!state.application)root.append(panel('Original application request',
    node('p','A selection for this review is already retained as request '+pending.request_id+'. Inspect or continue that original request to recover its actual result.'),
    toolbar(button('Inspect original request',async()=>{await inspectRequest(pending);renderRequests();show('requests');notice('Original request state read without resuming it.');}),
      button('Continue original request',async()=>{const result=await continueRequest(pending);await receiveResult(pending.route,result);},{primary:true}))));
  const catalog=panel('All earlier decisions');
  const stateFilter=select([['','All findings'],...Object.entries(STATES).map(([k,v])=>[k,v[0]])],state.candidateFilter.state,async value=>{state.candidateFilter.state=value;await loadCandidates(0);notice('Candidate state filter applied. The selection is retained across pages.');});
  const kindFilter=select([['','Groups and rows'],['group','Group decisions'],['row','Row decisions']],state.candidateFilter.kind,async value=>{state.candidateFilter.kind=value;await loadCandidates(0);notice('Candidate subject filter applied.');});
  const filters=node('div',undefined,'fields');filters.append(field('Finding',stateFilter),field('Decision subject',kindFilter));catalog.append(filters);
  if(!state.candidates.candidates.length)catalog.append(empty('No earlier decisions match this catalog page and filter.'));
  else{
    const rows=state.candidates.candidates.map(candidate=>{
      const check=node('input');check.type='checkbox';check.checked=state.selected.has(candidate.candidate_id);check.setAttribute('aria-label','Select earlier decision '+candidate.candidate_id+' for '+subjectTitle(candidate.target_subject||candidate.source_subject));disabled(check,candidate.state!=='ELIGIBLE'||!canSelect());
      check.addEventListener('change',()=>{
        if(candidate.state!=='ELIGIBLE'||!canSelect()){check.checked=state.selected.has(candidate.candidate_id);return;}
        if(check.checked)state.selected.add(candidate.candidate_id);else state.selected.delete(candidate.candidate_id);
        check.closest('tr')?.classList.toggle('selected',check.checked);persistDraft().catch(e=>notice('The selection could not be retained: '+e.message,'error'));renderSelection();
      });
      const finding=node('div');finding.append(stateBadge(candidate.state));
      if(candidate.reasons?.length)finding.append(reasonsList(candidate.reasons));else finding.append(node('p',STATES[candidate.state]?.[1]||candidate.state,'hint'));
      const earlier=node('div');earlier.append(node('strong',decisionSummary(candidate.source_decision)),node('p',subjectTitle(candidate.source_subject),'hint'));
      if(candidate.source_decision?.reason)earlier.append(node('p',candidate.source_decision.reason,'hint'));
      const later=node('div');later.append(node('span',subjectTitle(candidate.target_subject)),node('p',decisionSummary(candidate.target_decision),'hint'));
      return [check,String(candidate.candidate_id),earlier,later,finding,button('Inspect',()=>inspectCandidate(candidate.candidate_id),{small:true})];
    });
    const grid=table(['Select','Earlier sequence','Earlier decision','Later subject','Finding','Details'],rows);
    [...grid.querySelectorAll('tbody tr')].forEach((row,i)=>{row.classList.toggle('selected',state.selected.has(state.candidates.candidates[i].candidate_id));row.firstElementChild.className='select-cell';});catalog.append(grid);
  }
  catalog.append(pager(state.candidates,'candidates',loadCandidates),toolbar(
    button('Select available on this page',selectPage,{small:true,off:!canSelect()||!state.candidates.candidates.some(r=>r.state==='ELIGIBLE')}),
    button('Select all available decisions',selectAllEligible,{small:true,off:!canSelect()||!review.summary.eligible}),
    button('Clear selection',clearSelection,{small:true,off:!state.selected.size||!canSelect()})));
  root.append(catalog);
  const selection=node('div');selection.id='selection-panel';root.append(selection);renderSelection();
  if(state.detail)root.append(candidateInspection(state.detail));
}
function renderSelection() {
  const root=$('selection-panel');if(!root||!state.review)return;root.replaceChildren();
  if(state.application)return;
  const form=panel('Apply the selected earlier decisions'),
    fields=node('div',undefined,'fields'),
    actor=input(state.actor,{oninput:v=>{state.actor=v;editedDraft();},off:!canSelect()}),
    reason=input(state.reason,{multiline:true,oninput:v=>{state.reason=v;editedDraft();},off:!canSelect()});
  fields.append(field('Engineer',actor,'Name or operator identity, retained on the new decisions. Up to 240 UTF-8 bytes.'),
    field('Reason for this selection',reason,'Explain why these specific earlier decisions still apply. Up to 16,000 UTF-8 bytes.'));
  form.append(fields);
  if(state.selected.size){
    const chosen=node('details');chosen.append(node('summary',count(state.selected.size)+' selected original decision sequences'),node('pre',[...state.selected].sort((a,b)=>a-b).join(', ')));form.append(chosen);
  }
  const bar=node('div',undefined,'selection-bar'),controls=toolbar(
    node('span',count(state.selected.size)+' decisions selected','count'),
    button('Inspect complete selection',async()=>{
      const selected=await selectedCandidates();for(const row of selected)state.candidateCache.set(row.candidate_id,row);
      const detailsRoot=node('div');for(const candidate of selected)detailsRoot.append(details('Earlier decision '+candidate.candidate_id+' · '+subjectTitle(candidate.target_subject),candidate));
      const current=$('selection-review');current.replaceChildren(detailsRoot);current.hidden=false;notice('Every selected candidate is open below with its complete original decision and checks.');
    },{off:!state.selected.size}),
    button('Apply selected decisions',applySelection,{primary:true,off:!canSelect()||!state.selected.size}));
  bar.append(controls);form.append(bar);
  const selectionReview=node('div');selectionReview.id='selection-review';selectionReview.hidden=true;form.append(selectionReview);
  form.append(node('p','Only the selected available decisions are applied. The operation uses this review’s exact target revision and records the earlier report, subjects and new decision sequences.','hint'));root.append(form);
}
async function selectedCandidates() {
  if(!state.selected.size)throw new Error('Select at least one available earlier decision.');
  const selected=new Set(state.selected),rows=await readAllCandidates({state:'ELIGIBLE'}),chosen=rows.filter(r=>selected.has(r.candidate_id));
  if(chosen.length!==selected.size||chosen.some(r=>r.state!=='ELIGIBLE'||!r.target_subject))throw new Error('The saved selection includes a candidate that is not available in this review. Inspect the complete candidates before continuing.');
  return chosen.sort((a,b)=>a.candidate_id-b.candidate_id);
}
async function applySelection() {
  if(!canSelect())throw new Error('This review cannot accept another selection. Inspect its saved request or create a review at the current target revision.');
  const actor=requiredText(state.actor,'the engineer',240),reason=requiredText(state.reason,'the reason for this selection',16000),selected=await selectedCandidates(),review=state.review;
  const result=await retained('carry-apply',{workspace_id:state.workspace,review_id:review.review_id,review_sha256:review.review_sha256,expected_revision:review.target_review_revision,candidate_ids:selected.map(r=>r.candidate_id),actor,reason});
  await openApplication(result.application_id);await refreshHistory();show('review');notice(count(result.applied.length)+' selected decisions applied. The original application and full report lineage are retained.','success');
}
function applicationPanel(application) {
  const p=panel('Applied selection',
    facts([['Application',application.application_id],['Original review',application.review_id],['Source report',application.source_report_id],['Target run',application.target_run_id],['Prior target revision',application.prior_review_revision],['Resulting target revision',application.review_revision],['Engineer',application.actor],['Reason',application.reason],['Applied',when(application.created_at)]]),
    table(['Earlier sequence','Target subject','New decision sequence','Outcome'],application.applied.map(row=>[row.candidate_id,subjectTitle(row.subject),row.sequence,row.outcome])),
    toolbar(button('Download complete application',async()=>{saveJson(application,'decision-application-'+application.application_id+'.json');notice('Original application download prepared.');}),
      button('Open report lineage',async()=>{state.historyReports=await pageAt('/reports','reports',0,{run_id:application.target_run_id});renderHistory();show('history');notice('Reports for the target run opened. Freeze a report in Reconciliation to include this applied selection in its complete handover.');})),
    details('Complete immutable application',application));
  return p;
}
function candidateInspection(candidate) {
  const p=panel('Earlier decision '+candidate.candidate_id+' · '+subjectTitle(candidate.source_subject));p.id='candidate-inspection';p.classList.add('inspection');
  p.append(stateBadge(candidate.state),reasonsList(candidate.reasons),
    table(['Automatic check','Result'],Object.entries(candidate.checks||{}).map(([k,v])=>[k,checkText(v)])));
  if(candidate.row_occurrences)p.append(facts([['Exact earlier row occurrences',candidate.row_occurrences.source],['Exact later row occurrences',candidate.row_occurrences.target]]));
  if(candidate.row_group)p.append(facts([['Original group',candidate.row_group.source],['Later group',candidate.row_group.target],['Row decision basis',candidate.row_group.basis]]));
  const columns=node('div',undefined,'columns');
  const before=panel('Earlier report decision',facts([['Subject',subjectTitle(candidate.source_subject)],['Outcome',candidate.source_decision?.outcome],['Engineer',candidate.source_decision?.actor],['Reason',candidate.source_decision?.reason]]),details('Complete frozen earlier decision',candidate.source_decision),details('Original earlier subject',candidate.source_subject));
  const after=panel('Later subject',facts([['Subject',subjectTitle(candidate.target_subject)],['Existing decision',candidate.target_decision?.outcome]]),details('Complete current target decision in this review',candidate.target_decision),details('Original target subject',candidate.target_subject));
  before.append(toolbar(button(candidate.source_subject?.kind==='row'?'Inspect original earlier row':'Inspect all earlier group rows',()=>openOriginal(candidate,'source'),{small:true,off:!candidate.source_subject})));
  after.append(toolbar(button(candidate.target_subject?.kind==='row'?'Inspect original later row':'Inspect all later group rows',()=>openOriginal(candidate,'target'),{small:true,off:!candidate.target_subject})));
  columns.append(before,after);p.append(columns,details('Complete candidate record',candidate));
  if(state.original&&state.original.candidate_id===candidate.candidate_id)p.append(originalPanel());
  return p;
}
async function openOriginal(candidate,which,offset=0) {
  const subject=which==='source'?candidate.source_subject:candidate.target_subject,runId=which==='source'?candidate.source_run_id:candidate.target_run_id;
  if(!subject)throw new Error('This candidate has no corresponding original subject.');
  requireId(runId,'original run');let result;
  if(subject.kind==='row'){
    if(!['source','target'].includes(subject.side))throw new Error('The original row side is invalid.');
    result=await api(API+'/runs/'+runId+'/row'+query({side:subject.side,row:integer(subject.row,'row')}));
  }else if(subject.kind==='group'){
    result=await pageAt('/runs/'+runId+'/rows','rows',offset,{group_id:integer(subject.group_id,'group')});
  }else throw new Error('The original decision subject is not a row or group.');
  state.original={candidate_id:candidate.candidate_id,which,subject,run_id:runId,result};renderReview();
}
function originalPanel() {
  const original=state.original,record=original.result,p=panel((original.which==='source'?'Earlier':'Later')+' original '+(original.subject.kind==='row'?'row':'group rows'));
  p.append(line('Run '+original.run_id+' · '+subjectTitle(original.subject)));
  if(original.subject.kind==='row'){
    p.append(facts([['Original edition',record.edition_id],['Original side',record.side],['Original row index',record.row]]),
      node('h4','Every original field'),table(['Field','Original native value'],Object.entries(record.original||{}).map(([k,v])=>[k,nativeText(v)])),
      node('h4','Canonical comparison values'),table(['Field','Canonical native value'],Object.entries(record.canonical||{}).map(([k,v])=>[k,nativeText(v)])),
      details('Complete original row record',record,{open:true}));
  }else{
    if(!record.rows.length)p.append(empty('No original rows were returned for this group.'));
    else for(let i=0;i<record.rows.length;i++)p.append(details('Original group row '+count(record.offset+i+1),record.rows[i]));
    p.append(pager(record,'rows',offset=>openOriginal(state.detail,original.which,offset)),details('Complete original row page and column definitions',record));
  }
  return p;
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
    const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=file.name.split('/').pop();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
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

Object.assign(state,{historyReports:emptyPage('reports'),exportOperations:emptyPage('operations'),handoverReport:null,exportRecord:null,exportOffset:0});
async function loadReviews(offset=0) {if(!state.targetRun)return;state.reviews=await pageAt('/carry-reviews','reviews',offset,{target_run_id:state.targetRun.run_id});renderHistory();}
async function loadApplications(offset=0) {if(!state.targetRun)return;state.applications=await pageAt('/carry-applications','applications',offset,{target_run_id:state.targetRun.run_id});renderHistory();}
async function loadHistoryReports(offset=0) {if(!state.targetRun)return;state.historyReports=await pageAt('/reports','reports',offset,{run_id:state.targetRun.run_id});renderHistory();}
async function refreshHistory() {
  if(state.targetRun)await Promise.all([loadReviews(0),loadApplications(0),loadHistoryReports(0)]);
  else{state.reviews=emptyPage('reviews');state.applications=emptyPage('applications');state.historyReports=emptyPage('reports');}
  renderHistory();
}
async function openHandoverReport(id) {
  const report=await api(API+'/reports/'+requireId(id,'report'));state.handoverReport=report;state.exportRecord=null;state.exportOffset=0;renderHistory();show('history');notice('The complete immutable report and decision lineage are open.');
}
async function freezeTargetReport() {
  if(!state.targetRun)throw new Error('Open the target run first.');
  const body={workspace_id:state.workspace,run_id:state.targetRun.run_id,expected_revision:state.targetRun.review_revision};
  if(state.review?.source_run_id&&state.review.source_run_id!==state.targetRun.run_id)body.before_run_id=state.review.source_run_id;
  const report=await retained('report',body);await openHandoverReport(report.report_id);await loadHistoryReports(0);notice('Target report frozen with its complete decision history, saved queries and original source lineage.','success');
}
async function prepareHandover() {
  if(!state.handoverReport)throw new Error('Open a frozen target report.');
  const record=await retained('exports',{report_id:state.handoverReport.report_id});state.exportRecord=record;state.exportOffset=0;renderHistory();notice('Complete native report, decision lineage and portable workspace handover prepared.','success');
}
function renderHistory() {
  const root=$('screen-history');root.replaceChildren(heading('history','Saved applications and handover','Reopen original reviews and applied selections. Freeze the current target report and prepare the complete native handover with its earlier source records.'));
  root.append(toolbar(button('Refresh saved history',async()=>{await refreshHistory();notice('Saved review, application and report catalogs refreshed.');},{off:!state.targetRun}),
    button('Review current selection',async()=>show('review'),{off:!state.review})));
  if(!state.targetRun)root.append(panel('Choose the target run',empty('Choose a later run on Choose comparison, or open an existing review or application by its complete identifier.')));
  else{
    root.append(panel('Current target run',facts([['Run',state.targetRun.run_id],['Current decision revision',state.targetRun.review_revision],['Pair',state.targetRun.pair_id]]),
      toolbar(button('Refresh current run',async()=>{state.targetRun=await api(API+'/runs/'+state.targetRun.run_id);renderHistory();notice('Target run reopened at decision revision '+state.targetRun.review_revision+'.');}),
        button('Freeze current target report',freezeTargetReport,{primary:true,off:!state.db}))));
    const columns=node('div',undefined,'columns'),reviews=panel('Saved decision reviews'),applications=panel('Applied selections');
    for(const review of state.reviews.reviews){
      const r=node('div',undefined,'record');r.append(node('p','Review '+short(review.review_id),'title'),line('Source report '+short(review.source_report_id)+' · target revision '+review.target_review_revision+' · '+when(review.created_at)),
        toolbar(button('Open review',()=>openReview(review.review_id),{small:true})));reviews.append(r);
    }
    if(!state.reviews.reviews.length)reviews.append(empty('No saved reviews on this page.'));
    reviews.append(pager(state.reviews,'reviews',loadReviews));
    for(const app of state.applications.applications){
      const r=node('div',undefined,'record');r.append(node('p','Application '+short(app.application_id),'title'),line('Revision '+app.prior_review_revision+' → '+app.review_revision+' · '+when(app.created_at)),
        toolbar(button('Open application',()=>openApplication(app.application_id),{small:true})));applications.append(r);
    }
    if(!state.applications.applications.length)applications.append(empty('No applied selections on this page.'));
    applications.append(pager(state.applications,'applications',loadApplications));columns.append(reviews,applications);root.append(columns);
    const reports=panel('Frozen target reports');
    for(const report of state.historyReports.reports){
      const r=node('div',undefined,'record');r.append(node('p',reportLabel(report),'title'),
        toolbar(button('Open report and lineage',()=>openHandoverReport(report.report_id),{small:true})));reports.append(r);
    }
    if(!state.historyReports.reports.length)reports.append(empty('Freeze the target report to include its current decisions in a complete native handover.'));
    reports.append(pager(state.historyReports,'reports',loadHistoryReports));root.append(reports);
  }
  const direct=node('details');direct.append(node('summary','Open an original record directly'));
  const ids=node('div',undefined,'fields');ids.append(directId('review','64-character review identifier',openReview),directId('application','64-character application identifier',openApplication),directId('report','64-character frozen report identifier',openHandoverReport));direct.append(ids);root.append(direct);
  if(state.handoverReport){
    const r=state.handoverReport,p=panel('Complete frozen report',facts([['Report',r.report_id],['Run',r.run_id],['Frozen decision revision',r.review_revision],['Saved',when(r.created_at)]]),
      toolbar(button('Download original report',async()=>{saveJson(r,'reconciliation-'+r.report_id+'.json');notice('Complete frozen report download prepared.');}),
        button('Prepare complete handover',prepareHandover,{primary:true,off:!state.db})));
    if(r.decision_carry_forward){
      p.append(details('Complete decision carry-forward lineage',r.decision_carry_forward,{open:true}));
      const ancestorActions=toolbar();
      for(const ref of r.decision_carry_forward.applications||[])ancestorActions.append(button('Application '+short(ref.application_id),()=>openApplication(ref.application_id),{small:true}));
      for(const ref of r.decision_carry_forward.reports||[])ancestorActions.append(button('Original report '+short(ref.report_id),()=>openHandoverReport(ref.report_id),{small:true}));
      if(ancestorActions.childNodes.length)p.append(ancestorActions);
    }
    p.append(details('Complete immutable report and saved queries',r));root.append(p);
  }
  if(state.exportRecord)root.append(exportPanel(state.exportRecord));
}
function exportPanel(record) {
  const files=reportFiles(record),offset=Math.min(state.exportOffset,Math.max(0,Math.ceil(files.length/LIMIT)-1)*LIMIT),p=panel('Complete portable handover',
    facts([['Export',record.export_id],['Original files',files.length],['Native directory',record.directory],['Saved',when(record.created_at)]]),
    node('p','The full saved decision_carry query includes every candidate and actual selection. The handover retains original reports, reviews, applications, all referenced source files and the portable warehouse.','hint'),
    toolbar(button('Save all files to a folder',()=>saveExportFolder(record),{off:typeof window.showDirectoryPicker!=='function'})));
  p.append(table(['Original file','Bytes','SHA-256','Download'],files.slice(offset,offset+LIMIT).map(file=>[
    file.name,count(file.bytes),node('code',file.sha256),button('Download',()=>downloadFile(record,file),{small:true})])));
  p.append(pager({files:files.slice(offset,offset+LIMIT),offset,limit:LIMIT,total:files.length,next_offset:offset+LIMIT<files.length?offset+LIMIT:null},'files',async next=>{state.exportOffset=next;renderHistory();}),
    details('Complete original export manifest',record));
  return p;
}
async function loadOperations(offset=0) {state.operations=await pageAt('/operations','operations',offset);renderRequests();}
async function loadExportOperations(offset=0) {
  const result=await api('/api/catalog/operations'+query({offset,limit:LIMIT}));
  if(!Array.isArray(result.operations))throw new Error('The original export journal did not return its complete page.');
  state.exportOperations={...emptyPage('operations'),...result};renderRequests();
}
function requestTitle(record) {return ({'carry-review':'Create decision review','carry-apply':'Apply selected decisions',report:'Freeze target report',exports:'Prepare complete handover'})[record.route?.split('/').at(-1)||record.kind]||record.kind||'Original request';}
async function adoptNativeRequest(remote,family='reconciliation') {
  const id=requireId(remote.request_id,'request',ID32),body=remote.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||body.request_id!==id)throw new Error('The native request did not return its complete original body.');
  let route;
  if(family==='export'){
    route=remote.route;if(route!==API+'/exports'||!ID64.test(body.report_id||''))throw new Error('Open this original operation in Dataset workspace.');
  }else{
    if(!['carry-review','carry-apply','report'].includes(remote.kind)||body.workspace_id!==state.workspace)throw new Error('Open this original operation in Reconciliation.');
    route=API+'/'+remote.kind;
  }
  const old=state.localRequests.find(r=>r.request_id===id);
  if(old&&(old.route!==route||canonical(JSON.parse(old.body_text))!==canonical(body)))throw new Error('The original native request differs from the retained browser request.');
  const withoutId={...body};delete withoutId.request_id;
  const record=old||{key:state.workspace+':'+id,workspace_id:state.workspace,request_id:id,route,family,context:'decision-carry',body_text:JSON.stringify(body),meaning:route+':'+canonical(withoutId),state:'REOPENED',created_at:remote.created_at||new Date().toISOString()};
  const updated={...record,remote,inspected_at:new Date().toISOString()};
  if(remote.state==='COMPLETE'&&remote.result){updated.state='COMPLETE';updated.result=remote.result;}
  if(state.db)await keepRequest(updated);state.requestDetail=remote;return updated;
}
async function inspectDirectRequest(id,family='reconciliation') {
  const remote=await api((family==='export'?'/api':API)+'/requests/'+requireId(id,'request',ID32));
  state.requestDetail=remote;
  if(['carry-review','carry-apply','report'].includes(remote.kind)||family==='export')await adoptNativeRequest(remote,family);
  renderRequests();show('requests');notice('Original request read. Reading it does not resume or apply it.');
}
async function receiveResult(route,result) {
  if(route===API+'/carry-review')await openReview(result.review_id);
  else if(route===API+'/carry-apply')await openApplication(result.application_id);
  else if(route===API+'/report')await openHandoverReport(result.report_id);
  else if(route===API+'/exports'){
    const record=state.localRequests.find(r=>r.route===route&&r.result?.export_id===result.export_id),reportId=record?JSON.parse(record.body_text).report_id:null;
    if(reportId)state.handoverReport=await api(API+'/reports/'+reportId);
    state.exportRecord=result;state.exportOffset=0;renderHistory();show('history');
  }
}
function requestCard(record) {
  const remote=record.remote,p=panel(requestTitle(record),facts([['Request',record.request_id],['Browser record',record.state],['Native state',remote?.state],['Created',when(record.created_at)]]));
  p.dataset.requestId=record.request_id;p.dataset.requestState=record.state;
  if(record.last_error)p.append(node('p',record.last_error.message,'request-error'));
  const actions=toolbar(button('Inspect original request',async()=>{
    try{await inspectRequest(record);renderRequests();notice('Original native request read without resuming.');}
    catch(e){if(e.status!==404)throw e;state.requestDetail={request_id:record.request_id,state:'NOT_FOUND'};renderRequests();notice('This original identifier is absent from the native journal. Continue original request will send the retained complete body.');}
  },{small:true}));
  if(record.state==='COMPLETE'&&record.result)actions.append(button('Open saved result',()=>receiveResult(record.route,record.result),{small:true}));
  else actions.append(button('Continue original request',async()=>{const result=await continueRequest(record);await receiveResult(record.route,result);},{primary:true,small:true,off:!state.db}));
  actions.append(button('Download original request',async()=>{saveJson(record,'decision-request-'+record.request_id+'.json');notice('Complete retained request download prepared.');},{small:true}));
  p.append(actions,details('Complete retained request body',JSON.parse(record.body_text)));if(remote)p.append(details('Complete native request record',remote));return p;
}
function nativeRequestRow(record,family) {
  const n=node('div',undefined,'record');n.append(node('p',requestTitle(record)+' · '+record.state,'title'),line(record.request_id+' · '+when(record.created_at)));
  const supported=family==='export'?record.route===API+'/exports':['carry-review','carry-apply','report'].includes(record.kind);
  n.append(toolbar(button('Inspect native record',async()=>{await inspectDirectRequest(record.request_id,family);},{small:true})));
  if(!supported)n.append(node('p','Other reconciliation operations can be reopened in the original workspace.','hint'));
  return n;
}
function renderRequests() {
  const root=$('screen-requests');root.replaceChildren(heading('requests','Saved requests','Inspect the exact request first. Continuing it reuses its original identifier and body; a page refresh only reads saved records.'),
    toolbar(button('Refresh request catalogs',async()=>{await loadLocalRequests();await Promise.all([loadOperations(0),loadExportOperations(0)]);renderRequests();notice('Original local, reconciliation and export request catalogs refreshed.');})));
  if(state.storageError)root.append(panel('Browser storage',node('p',state.storageError.message)));
  if(!state.localRequests.length)root.append(panel('Retained in this browser',empty('New decision reviews, applications, reports and handovers retain their complete request here before the first write.')));
  else for(const record of state.localRequests)root.append(requestCard(record));
  const columns=node('div',undefined,'columns'),journal=panel('Reconciliation journal'),exports=panel('Original export journal');
  for(const record of state.operations.operations)journal.append(nativeRequestRow(record,'reconciliation'));
  for(const record of state.exportOperations.operations)exports.append(nativeRequestRow(record,'export'));
  if(!state.operations.operations.length)journal.append(empty('No reconciliation requests on this page.'));
  if(!state.exportOperations.operations.length)exports.append(empty('No export requests on this page.'));
  journal.append(pager(state.operations,'operations',loadOperations));exports.append(pager(state.exportOperations,'operations',loadExportOperations));columns.append(journal,exports);root.append(columns);
  const direct=panel('Open original request',directId('request','32-character reconciliation request identifier',inspectDirectRequest));root.append(direct);
  if(state.requestDetail)root.append(panel('Last inspected native request',details('Complete original record',state.requestDetail,{open:true})));
}
function renderAll() {renderChoose();renderReview();renderHistory();renderRequests();}
async function identity() {
  const record=await api('/api/identity');requireId(record.workspace_id,'workspace',ID32);
  if(state.workspace&&record.workspace_id!==state.workspace)throw new Error('The original workspace identity changed.');
  state.workspace=record.workspace_id;state.identity=record;$('workspace-name').textContent=record.directory||'Local DuckDB workspace';$('workspace-id').textContent=record.workspace_id;
}
async function refresh() {
  await persistDraft();await identity();await loadLocalRequests();state.pairs=await pageAt('/pairs','pairs',0);
  if(state.pair){const runs=await pageAt('/runs','runs',0,{pair_id:state.pair.pair_id});state.sourceRuns=runs;state.targetRuns=clone(runs);}
  if(state.sourceRun)state.reports=await pageAt('/reports','reports',0,{run_id:state.sourceRun.run_id});
  if(state.targetRun)state.targetRun=await api(API+'/runs/'+state.targetRun.run_id);
  await Promise.all([refreshHistory(),loadOperations(0),loadExportOperations(0)]);
  renderAll();notice('Saved catalogs refreshed. Current explanation, engineer and selection are retained.');
}
async function restoreDraft(saved) {
  if(!saved||saved.workspace_id!==state.workspace)return;
  state.scopeBasis=typeof saved.scope_basis==='string'?saved.scope_basis:'';
  state.actor=typeof saved.actor==='string'?saved.actor:'';state.reason=typeof saved.reason==='string'?saved.reason:'';
  if(saved.review_id&&ID64.test(saved.review_id)){await openReview(saved.review_id);return;}
  if(saved.pair_id&&ID64.test(saved.pair_id))state.pair=await api(API+'/pairs/'+saved.pair_id);
  if(saved.source_run_id&&ID64.test(saved.source_run_id))state.sourceRun=await api(API+'/runs/'+saved.source_run_id);
  if(saved.source_report_id&&ID64.test(saved.source_report_id))state.sourceReport=await api(API+'/reports/'+saved.source_report_id);
  if(saved.target_run_id&&ID64.test(saved.target_run_id))state.targetRun=await api(API+'/runs/'+saved.target_run_id);
  if((state.sourceRun&&state.sourceRun.pair_id!==state.pair?.pair_id)||(state.targetRun&&state.targetRun.pair_id!==state.pair?.pair_id)||(state.sourceReport&&state.sourceReport.run_id!==state.sourceRun?.run_id))
    throw new Error('The saved draft identities no longer form the same comparison. Its original browser record remains retained.');
}
async function start() {
  renderAll();await identity();
  let saved=null;
  try{
    state.db=await openStorage();state.db.onversionchange=()=>{state.db.close();state.db=null;state.storageError=new Error('The request store changed in another tab. Reopen this page to continue.');$('storage-notice').textContent=state.storageError.message;$('storage-notice').hidden=false;renderAll();};
    await loadLocalRequests();saved=await readStore('drafts',state.workspace+':decision-carry');
  }catch(error){state.storageError=error;$('storage-notice').textContent='Browser request storage is unavailable. '+error.message;$('storage-notice').hidden=false;}
  let restoreError=null;
  try{await restoreDraft(saved);}catch(error){restoreError=error;}
  state.pairs=await pageAt('/pairs','pairs',0);
  if(state.pair){const runs=await pageAt('/runs','runs',0,{pair_id:state.pair.pair_id});state.sourceRuns=runs;state.targetRuns=clone(runs);}
  if(state.sourceRun)state.reports=await pageAt('/reports','reports',0,{run_id:state.sourceRun.run_id});
  await Promise.all([refreshHistory(),loadOperations(0),loadExportOperations(0)]);renderAll();
  const params=new URLSearchParams(location.search);
  const selectors=['source_report_id','review_id','application_id','request_id'].filter(key=>params.has(key));
  if(selectors.length>1)throw new Error('Open one original report, review, application or request per workspace link.');
  if(selectors.length){
    await persistDraft();
    const key=selectors[0],value=params.get(key);
    if(key==='source_report_id'){await chooseReport(requireId(value,'source report'));show('choose');}
    else if(key==='review_id')await openReview(requireId(value,'review'));
    else if(key==='application_id')await openApplication(requireId(value,'application'));
    else await inspectDirectRequest(requireId(value,'request',ID32));
    return;
  }
  let screen=state.review?'review':'choose';
  try{const selected=sessionStorage.getItem('stellar_duckdb_carry_screen');if(['choose','review','history','requests'].includes(selected))screen=selected;}catch{}
  show(screen);
  if(restoreError)notice('The saved draft remains retained. '+restoreError.message,'error');else notice('Original workspace opened. Choose a frozen report and a later run, or reopen a saved decision review.');
}
$('reconciliation-home').href='/reconciliation/#'+capability;$('dataset-home').href='/#'+capability;
$('refresh').addEventListener('click',()=>action('Refreshing saved catalogs',refresh));
document.querySelectorAll('[data-screen]').forEach(n=>n.addEventListener('click',()=>{
  if(state.busy)return;const name=n.dataset.screen;
  if(name==='history')action('Opening saved applications',async()=>{await refreshHistory();show(name);notice('Saved application history opened.');});
  else{if(name==='requests')renderRequests();show(name);}
}));
window.addEventListener('pagehide',()=>{clearTimeout(state.draftTimer);persistDraft().catch(()=>{});});
action('Opening original workspace',start);
