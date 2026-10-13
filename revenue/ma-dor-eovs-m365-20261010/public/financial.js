/* Original-workspace financial operation UI. No vendor transport or workbook execution. */
'use strict';
const $=id=>document.getElementById(id);
const kinds=['finance.dataset','finance.definition','finance.run','finance.reconciliation','finance.review','finance.control','finance.release'];
let state,selectedRecord,recordOffset=0,rowOffset=0,reviewOffset=0,reviewRows=[],reviewDecisions=new Map(),reviewId=null,busy=false;
let files=[],pending=null,restoring=false;const collections=new Map();
const node=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const say=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('danger',error);};
const json=(v)=>JSON.stringify(v,null,2);
function storageKey(suffix){return 'financial:'+state.workspace.id+':'+suffix;}
function saveDrafts(){
 if(!state||restoring)return;const forms={};
 for(const form of document.querySelectorAll('form:not(#upload-form)'))forms[form.id]=[...form.elements].filter(e=>e.name&&e.type!=='file').map(e=>({name:e.name,value:e.multiple?[...e.selectedOptions].map(o=>o.value):e.value}));
 sessionStorage.setItem(storageKey('drafts'),json({actor:$('actor').value,forms}));
}
function restoreDrafts(){
 restoring=true;try{
 const saved=JSON.parse(sessionStorage.getItem(storageKey('drafts'))||'null');if(!saved)return;
 $('actor').value=saved.actor||'';
 for(const [id,fields]of Object.entries(saved.forms||{})){const form=$(id);if(!form)continue;for(const f of fields){const e=form.elements.namedItem(f.name);if(!e)continue;
 if(e.multiple){for(const o of e.options)o.selected=Array.isArray(f.value)&&f.value.includes(o.value);}else if(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===f.value))e.value=f.value;}}
 }finally{restoring=false;}
}
function persistFiles(){sessionStorage.setItem(storageKey('files'),json(files));}
function evidence(purpose){return files.filter(f=>f.selected&&(!purpose||f.purpose===purpose)).map(f=>({sha256:f.sha256,filename:f.filename,purpose:f.purpose}));}
function formValue(form,name){return form.elements.namedItem(name).value;}
function chosen(form,name){return [...form.elements.namedItem(name).selectedOptions].map(o=>o.value);}
function parse(text){const v=JSON.parse(text);return v;}
function optional(o,k,v){if(v)o[k]=v;}
function lines(s){return s.split('\n').map(x=>x.trim()).filter(Boolean);}
async function api(operation,payload={},mutation=false){
 const r=await fetch(mutation?'/api/operations':'/api/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,payload})});
 const value=await r.json();if(!r.ok||value.error){const e=new Error(value.error?.message||r.statusText);e.details=value.error;e.status=r.status;throw e;}return value;
}
async function getState(){const r=await fetch('/api/state');const v=await r.json();if(!r.ok)throw Error(v.error?.message||'Workspace read failed');v.workspace=v.project||v.workspace;return v;}
function actor(){const x=$('actor').value.trim();if(!x)throw Error('Record the actual operator name.');return x;}
function pendingView(){
 $('pending').hidden=!pending;$('pending-detail').textContent=pending?json(pending):'';
 $('retry-pending').hidden=true;$('resume-pending').hidden=true;
}
async function inspectPending(){
 if(!pending)return;
 const r=await api('operation.get',{id:pending.payload.operation_id});
 if(r.found&&r.operation.status==='SUCCEEDED'){
  const result=r.operation.result;pending=null;sessionStorage.removeItem(storageKey('pending'));pendingView();
  await refresh();say('The original operation completed. '+json(result));return result;
 }
 $('pending-detail').textContent=json({request:pending,original:r});
 $('retry-pending').hidden=r.found;
 $('resume-pending').hidden=!r.found;
 say(r.found?'The original local operation is retained. Review its failure before continuing it.':'No admitted operation was returned. Only the exact frozen request can be retried.');
}
async function mutate(operation,payload){
 if(pending)throw Error('Reconcile the retained original request before another mutation.');
 const request={operation,payload:{...payload,actor:actor(),operation_id:'finance-'+crypto.randomUUID(),expected_revision:state.workspace.revision}};
 pending=request;sessionStorage.setItem(storageKey('pending'),json(pending));pendingView();
 try{
  const result=await api(request.operation,request.payload,true);
  pending=null;sessionStorage.removeItem(storageKey('pending'));pendingView();await refresh();
  say('Saved original operation '+result.operation_id+'.');return result.result;
 }catch(e){say(e.message+' The complete original request is retained.',true);await inspectPending().catch(()=>{});throw e;}
}
async function invoke(fn){
 if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');
 try{await fn();}catch(e){say(e.message+(e.details?'\n'+json(e.details):''),true);}
 finally{busy=false;document.body.removeAttribute('aria-busy');}
}
async function all(operation,payload){
 const rows=[];let offset=0;
 while(true){const page=await api(operation,{...payload,offset,limit:500});rows.push(...page.rows);
  if(rows.length>=page.total)return rows;if(!page.rows.length)throw Error('Original paging ended before the declared population.');offset+=page.rows.length;}
}
function option(select,value,label){select.append(node('option',label,{value}));}
function populate(select,rows){
 const previous=[...select.selectedOptions].map(x=>x.value);select.replaceChildren();
 if(select.dataset.blank==='true')option(select,'','None');
 for(const r of rows)option(select,r.id,(r.title||r.id)+' · '+r.id);
 for(const o of select.options)o.selected=previous.includes(o.value);
 if(!select.multiple&&!select.value&&select.options.length)select.selectedIndex=0;
}
async function refresh(){
 state=await getState();
 // Current original state identifies its project as workspace.
 if(!state.workspace){state.workspace=state.project||state;}
 if(!state.workspace.id||!Number.isSafeInteger(state.workspace.revision))throw Error('Original workspace identity/revision is missing.');
 $('workspace').textContent=state.workspace.title+' · '+state.workspace.id+' · revision '+state.workspace.revision;
 for(const kind of kinds)collections.set(kind,await all('finance.list',{kind}));
 for(const select of document.querySelectorAll('select[data-kind]'))populate(select,collections.get(select.dataset.kind));
 populate($('control-records'),[...collections.values()].flat());
 renderFiles();await renderRecords();
}
function renderFiles(){
 const out=$('files');out.replaceChildren();
 for(const f of files){
  const row=node('div',undefined,{class:'file-row'}),label=node('label');
  const check=node('input',undefined,{type:'checkbox'});check.checked=!!f.selected;
  check.addEventListener('change',()=>{f.selected=check.checked;persistFiles();});
  label.append(check,node('span','Use as '+f.purpose));row.append(label);
  const link=node('a',f.filename+' · '+f.bytes+' bytes',{href:'/api/files/'+f.sha256+'?filename='+encodeURIComponent(f.filename)});
  row.append(link,node('code',f.sha256));out.append(row);
 }
 const select=$('source-file'),old=select.value;select.replaceChildren();
 for(const f of files.filter(f=>f.purpose==='input'))option(select,f.sha256,f.filename);
 if([...select.options].some(x=>x.value===old))select.value=old;
}
async function upload(){
 const file=$('original-file').files[0];if(!file)throw Error('Select the complete original file.');
 const r=await fetch('/api/files?filename='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
 const v=await r.json();if(!r.ok)throw Error(v.error?.message||'File intake failed.');
 const purpose=$('file-purpose').value;
 if(!files.some(x=>x.sha256===v.sha256&&x.purpose===purpose))files.push({...v,purpose,selected:false});
 persistFiles();renderFiles();say('Complete original file retained: '+v.filename);
}
function datasetFields(){
 const f=$('dataset-form'),v=n=>formValue(f,n),mapping={keys:chosen(f,'keys'),amount:v('amount'),account:v('account'),
  currency:v('currency_column')?{column:v('currency_column')}:{constant:v('currency_constant')},
  dimensions:parse(v('dimensions'))};
 for(const key of ['posting_date','document_date'])optional(mapping,key,v(key));
 const context={company:v('company'),system:v('system'),source_reference:v('source_reference'),captured_at:v('captured_at'),
  coverage:v('coverage'),role:v('role'),measure:v('measure'),currency_basis:v('currency_basis'),
  window:{start:v('start'),end:v('end')},parameters:parse(v('parameters')),
  review:{actor:actor(),note:v('note'),evidence_files:evidence('evidence')}};
 if(['report_output','opening_balance'].includes(context.role))context.basis_role=v('basis_role');
 optional(context,'budget_edition',v('budget_edition'));if(context.role==='opening_balance')context.opening_as_of=v('opening_as_of');
 const file=files.find(x=>x.sha256===v('file_sha256'));
 if(!file)throw Error('Choose a retained original data file.');
 const payload={title:v('title'),file_sha256:file.sha256,filename:file.filename,format:v('format'),
  dialect:{encoding:v('encoding'),delimiter:v('delimiter')},context,mapping};
 optional(payload,'parent_id',v('parent_id'));return payload;
}
async function previewSource(restoreMapping=false){
 const f=$('dataset-form'),v=n=>formValue(f,n);
 const p=await api('finance.preview',{file_sha256:v('file_sha256'),format:v('format'),dialect:{encoding:v('encoding'),delimiter:v('delimiter')}});
 for(const select of f.querySelectorAll('.column-picker')){
  let old=[...select.selectedOptions].map(x=>x.value);
  if(restoreMapping){const saved=JSON.parse(sessionStorage.getItem(storageKey('drafts'))||'null');const field=saved?.forms?.['dataset-form']?.find(x=>x.name===select.name);if(field)old=Array.isArray(field.value)?field.value:[field.value];}
  select.replaceChildren();
  if(select.dataset.blank)option(select,'','Unmapped');
  for(const column of p.columns)option(select,column,column);
  for(const o of select.options)o.selected=old.includes(o.value);
 }
 $('source-preview').textContent=json(p);say(p.row_count+' complete original rows read; review the exact column mapping.');
}
function definitionFields(){
 const f=$('definition-form'),v=n=>formValue(f,n),d={title:v('title'),family:v('family'),company:v('company'),tool:v('tool'),
  native_files:evidence('native-definition'),basis_role:v('basis_role'),measure:v('measure'),currency_basis:v('currency_basis'),
  group_fields:lines(v('group_fields')),filters:parse(v('filters')),sign:v('sign'),
  rounding:{mode:v('rounding'),scale:Number(v('scale'))},review:{actor:actor(),note:v('note'),evidence_files:evidence('evidence')}};
 for(const k of ['budget_edition','parent_id','change_id'])optional(d,k,v(k));return {definition:d};
}
function runFields(){
 const f=$('run-form'),v=n=>formValue(f,n),p={title:v('title'),definition_id:v('definition_id'),dataset_id:v('dataset_id'),
  period:{label:v('label'),start:v('start'),end:v('end'),date_basis:v('date_basis'),mode:v('mode')},note:v('note')};
 optional(p,'opening_dataset_id',v('opening_dataset_id'));return p;
}
async function comparisonFields(){
 const f=$('comparison-form'),v=n=>formValue(f,n),run=await api('finance.get',{kind:'finance.run',id:v('run_id')});
 return {title:v('title'),run_id:run.id,output_dataset_id:v('output_dataset_id'),note:v('note'),
  native_binding:{definition_sha256:run.definition_sha256,period:run.period,actor:actor(),note:v('note'),evidence_files:evidence('evidence')}};
}
async function loadReview(){
 reviewId=$('review-reconciliation').value;if(!reviewId)throw Error('Select the original reconciliation.');
 reviewRows=(await all('finance.rows',{kind:'finance.reconciliation',id:reviewId,section:'items'})).filter(r=>r.status!=='MATCH');
 const saved=JSON.parse(sessionStorage.getItem(storageKey('review:'+reviewId))||'null');
 const allowed=new Set(reviewRows.map(r=>r.id));reviewDecisions=new Map((saved?.decisions||[]).filter(([id])=>allowed.has(id)));reviewOffset=0;renderReview();
}
function renderReview(){
 $('review-count').textContent=reviewRows.length+' original nonmatching keys; '+reviewDecisions.size+' entered decisions.';
 const table=node('table'),head=node('tr');['Original difference','Disposition','Evidence / correction'].forEach(x=>head.append(node('th',x)));table.append(head);
 for(const row of reviewRows.slice(reviewOffset,reviewOffset+25)){
  const tr=node('tr'),a=node('td'),b=node('td'),c=node('td');a.append(node('pre',json(row)));
  const d=reviewDecisions.get(row.id)||{item_id:row.id,status:'open',owner:$('actor').value,note:'Not yet reviewed.',evidence_files:[]};
  const status=node('select');['open','accepted_variance','resolved'].forEach(v=>option(status,v,v));status.value=d.status;
  const owner=node('input');owner.value=d.owner;owner.setAttribute('aria-label','Discrepancy owner');
  const note=node('textarea');note.value=d.note;note.setAttribute('aria-label','Original discrepancy explanation');
  const correction=node('select');option(correction,'','No corrected result');for(const r of collections.get('finance.reconciliation'))option(correction,r.id,r.title);
  correction.value=d.correction_reconciliation_id||'';
  const save=()=>{const next={item_id:row.id,status:status.value,owner:owner.value,note:note.value,evidence_files:evidence('evidence')};
    if(correction.value)next.correction_reconciliation_id=correction.value;reviewDecisions.set(row.id,next);sessionStorage.setItem(storageKey('review:'+reviewId),json({decisions:[...reviewDecisions]}));$('review-count').textContent=reviewRows.length+' keys; '+reviewDecisions.size+' entered decisions.';};
  [status,owner,note,correction].forEach(e=>e.addEventListener('input',save));
  b.append(status,owner,note);c.append(node('p','Selected evidence files are frozen when this row changes.'),correction);
  tr.append(a,b,c);table.append(tr);
 }
 $('review-items').replaceChildren(table);$('review-prev').disabled=reviewOffset===0;$('review-next').disabled=reviewOffset+25>=reviewRows.length;
}
async function saveReview(){
 if(!reviewId)throw Error('Load the complete original discrepancy population first.');
 const decisions=reviewRows.map(r=>reviewDecisions.get(r.id)||{item_id:r.id,status:'open',owner:actor(),note:'Not yet reviewed.',evidence_files:[]});
 const p={title:$('review-title').value,reconciliation_id:reviewId,decisions,reviewer_role:$('review-role').value,
  note:$('review-note').value,evidence_files:evidence('evidence')};optional(p,'parent_id',$('previous-review').value);
 await mutate('finance.review.create',p);
}
function controlFields(){
 const f=$('control-form'),v=n=>formValue(f,n),p={title:v('title'),category:v('category'),status:v('status'),
  owner:v('owner'),note:v('note'),external_reference:v('external_reference'),related_ids:chosen(f,'related_ids'),evidence_files:evidence('evidence')};
 optional(p,'parent_id',v('parent_id'));if(p.status!=='proposed')p.authority={actor:v('authority_actor'),role:v('authority_role'),decision_reference:v('decision_reference')};
 return p;
}
async function releaseFields(){
 const f=$('release-form'),v=n=>formValue(f,n),reviews=chosen(f,'review_ids'),periods=new Map();
 for(const id of reviews){const review=await api('finance.get',{kind:'finance.review',id});
  const rec=await api('finance.get',{kind:'finance.reconciliation',id:review.reconciliation_id});periods.set(json(rec.period),rec.period);}
 const p={title:v('title'),company:v('company'),families:lines(v('families')),periods:[...periods.values()],
  review_ids:reviews,control_ids:chosen(f,'control_ids'),inventory_files:evidence('evidence'),note:v('note'),
  acceptance:{finance_actor:v('finance_actor'),prime_actor:v('prime_actor'),receiving_actor:v('receiving_actor'),
    reference:v('reference'),evidence_files:evidence('evidence')}};
 optional(p,'parent_id',v('parent_id'));return p;
}
async function renderRecords(){
 const kind=$('record-kind').value||kinds[0],rows=collections.get(kind)||[],box=$('record-list');box.replaceChildren();
 for(const r of rows.slice(recordOffset,recordOffset+50)){const button=node('button',r.title+' · '+r.id);
  button.addEventListener('click',()=>invoke(()=>openRecord(kind,r.id)));box.append(button);}
 $('records-prev').disabled=recordOffset===0;$('records-next').disabled=recordOffset+50>=rows.length;
}
async function openRecord(kind,id){
 selectedRecord={kind,id};rowOffset=0;
 const r=await api('finance.get',{kind,id});$('record-json').textContent=json(r);
 const box=$('selected-record');box.replaceChildren(node('h3',r.title));
 for(const format of ['ndjson','csv'])box.append(node('a','Download complete '+format.toUpperCase()+' ',{href:'/api/exports?kind='+encodeURIComponent(kind)+'&id='+encodeURIComponent(id)+'&format='+format}));
 if(kind==='finance.reconciliation')$('row-section').value='items';else $('row-section').value='rows';
 await renderRows();
}
async function renderRows(){
 if(!selectedRecord)return;
 const r=await api('finance.rows',{...selectedRecord,section:$('row-section').value,query:$('row-query').value,offset:rowOffset,limit:50});
 const box=$('rows');box.replaceChildren(node('p',r.total+' matching retained rows; showing '+r.offset+'–'+(r.offset+r.rows.length)));
 for(const row of r.rows)box.append(node('pre',json(row)));
 $('rows-prev').disabled=rowOffset===0;$('rows-next').disabled=rowOffset+r.rows.length>=r.total;
}
function tab(id){for(const section of document.querySelectorAll('.tab'))section.hidden=section.id!==id;
 for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-current',String(button.dataset.tab===id));}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
$('upload-form').addEventListener('submit',e=>{e.preventDefault();invoke(upload);});
const forms=[['dataset-form','finance.dataset.create',datasetFields],['definition-form','finance.definition.create',definitionFields],
 ['run-form','finance.run.create',runFields],['comparison-form','finance.reconciliation.create',comparisonFields],
 ['control-form','finance.control.create',controlFields],['release-form','finance.release.create',releaseFields]];
for(const [id,operation,build]of forms)$(id).addEventListener('submit',e=>{e.preventDefault();invoke(async()=>mutate(operation,await build()));});
$('preview-source').onclick=()=>invoke(()=>previewSource(false));$('refresh').onclick=()=>invoke(refresh);
$('load-review').onclick=()=>invoke(loadReview);$('save-review').onclick=()=>invoke(saveReview);
$('review-prev').onclick=()=>{reviewOffset=Math.max(0,reviewOffset-25);renderReview();};
$('review-next').onclick=()=>{reviewOffset+=25;renderReview();};
$('load-records').onclick=()=>invoke(async()=>{recordOffset=0;await refresh();});
$('records-prev').onclick=()=>{recordOffset=Math.max(0,recordOffset-50);renderRecords();};
$('records-next').onclick=()=>{recordOffset+=50;renderRecords();};
$('load-rows').onclick=()=>invoke(async()=>{rowOffset=0;await renderRows();});
$('rows-prev').onclick=()=>invoke(async()=>{rowOffset=Math.max(0,rowOffset-50);await renderRows();});
$('rows-next').onclick=()=>invoke(async()=>{rowOffset+=50;await renderRows();});
$('inspect-pending').onclick=()=>invoke(inspectPending);
$('retry-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;const r=await api('operation.get',{id:pending.payload.operation_id});if(r.found)return inspectPending();
 const result=await api(pending.operation,pending.payload,true);pending=null;sessionStorage.removeItem(storageKey('pending'));pendingView();await refresh();say(json(result));
});
$('resume-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;const original=pending;const current=await api('operation.get',{id:original.payload.operation_id});
 if(!current.found||current.operation.status==='SUCCEEDED')return inspectPending();
 const result=await api('operation.resume',{operation_id:'finance-resume-'+crypto.randomUUID(),actor:actor(),
  expected_revision:(await getState()).workspace.revision,target_operation_id:original.payload.operation_id,
  reason:'Explicit operator continuation of the retained financial request.'},true);
 await inspectPending();say(json(result));
});
$('verify').onclick=()=>invoke(async()=>{$('verify-result').textContent=json(await api('finance.verify'));say('Retained financial evidence recomputed.');});
$('prepare-delivery').onclick=()=>invoke(async()=>{
 const result=await mutate('delivery.prepare',{title:'Complete financial reporting handover',note:'Original sources, complete calculations, decisions, native evidence and editable application.'});
 $('delivery-result').replaceChildren(node('a','Download the full editable delivery',{href:'/api/deliveries/'+result.id}));
});
for(const kind of kinds)option($('record-kind'),kind,kind.slice(8));
invoke(async()=>{
 await refresh();files=JSON.parse(sessionStorage.getItem(storageKey('files'))||'[]');
 pending=JSON.parse(sessionStorage.getItem(storageKey('pending'))||'null');renderFiles();pendingView();tab('intake');
 restoreDrafts();if($('source-file').value){await previewSource(true).catch(e=>say('Retained source mapping could not reopen: '+e.message,true));}
 for(const event of ['input','change'])document.addEventListener(event,saveDrafts);
 if(pending)await inspectPending();else say('Ready. Retain the original files and review the full population.');
});
