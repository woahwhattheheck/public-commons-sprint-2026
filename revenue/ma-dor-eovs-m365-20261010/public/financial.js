/* Original-workspace financial operation UI. No vendor transport or workbook execution. */
'use strict';
const $=id=>document.getElementById(id);
const kinds=['finance.dataset','finance.definition','finance.run','finance.reconciliation','finance.review','finance.control','finance.release'];
let state,selectedRecord,recordOffset=0,rowOffset=0,reviewOffset=0,reviewRows=[],reviewDecisions=new Map(),reviewId=null,reviewParentId=null,busy=false;
let files=[],pending=null,restoring=false,filesLoaded=false;const collections=new Map();
const node=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const say=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('danger',error);};
const json=(v)=>JSON.stringify(v,null,2);
function storageKey(suffix){return 'financial:'+state.workspace.id+':'+suffix;}
function saveDrafts(){
 if(!state||restoring)return;const forms={};
 for(const form of document.querySelectorAll('form:not(#upload-form)'))forms[form.id]=[...form.elements].filter(e=>e.name&&e.type!=='file').map(e=>({name:e.name,value:e.multiple?[...e.selectedOptions].map(o=>o.value):e.value}));
 const review={};for(const id of ['review-reconciliation','previous-review','review-title','review-role','review-note'])review[id]=$(id).value;
 sessionStorage.setItem(storageKey('drafts'),json({actor:$('actor').value,forms,review,tab:document.querySelector('nav button[aria-current=true]')?.dataset.tab}));
}
function restoreDrafts(){
 restoring=true;try{
 const saved=JSON.parse(sessionStorage.getItem(storageKey('drafts'))||'null');if(!saved)return;
 $('actor').value=saved.actor||'';
 for(const [id,fields]of Object.entries(saved.forms||{})){const form=$(id);if(!form)continue;for(const f of fields){const e=form.elements.namedItem(f.name);if(!e)continue;
 if(e.multiple){for(const o of e.options)o.selected=Array.isArray(f.value)&&f.value.includes(o.value);}else if(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===f.value))e.value=f.value;}}
 for(const[id,value]of Object.entries(saved.review||{})){const e=$(id);if(e&&(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===value)))e.value=value;}
 if(saved.tab&&$(saved.tab))tab(saved.tab,false);
 }finally{restoring=false;}
}
let draftDB=null,draftQueue=Promise.resolve(),draftError=null;
const dirtyDecisions=new Map();
function openDraftDB(){
 if(!draftDB){
  const opening=new Promise((resolve,reject)=>{let failed=false;const request=indexedDB.open('financial-review-drafts',1);
   const fail=error=>{failed=true;reject(error);};
   request.onupgradeneeded=()=>{
    const db=request.result,store=db.createObjectStore('decisions-v2',{keyPath:['workspace','reconciliation','parent','id']});
    store.createIndex('review',['workspace','reconciliation','parent']);
    if(db.objectStoreNames.contains('decisions')){
     const old=request.transaction.objectStore('decisions').openCursor();
     old.onsuccess=()=>{const cursor=old.result;if(cursor){store.put({...cursor.value,parent:''});cursor.continue();}};
    }
   };
   request.onerror=()=>fail(request.error||Error('Finding draft storage could not open.'));
   request.onblocked=()=>fail(Error('Close the older draft editor tab before upgrading its storage.'));
   request.onsuccess=()=>{if(failed){request.result.close();return;}request.result.onversionchange=()=>{request.result.close();draftDB=null;};resolve(request.result);};
  });
  draftDB=opening.catch(error=>{draftDB=null;throw error;});
 }
 return draftDB;
}
async function writeDecisionRows(rows){
 const db=await openDraftDB();await new Promise((resolve,reject)=>{const tx=db.transaction('decisions-v2','readwrite');for(const row of rows)tx.objectStore('decisions-v2').put(row);
 tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Finding draft transaction did not commit.'));tx.onerror=()=>{};});
}
function retainDecision(reconciliation,parent,decision){
 const row={workspace:state.workspace.id,reconciliation,parent,id:decision.item_id,value:JSON.parse(JSON.stringify(decision))},id=json([row.workspace,reconciliation,parent,row.id]);
 dirtyDecisions.set(id,row);
 draftQueue=draftQueue.then(async()=>{try{await writeDecisionRows([row]);if(dirtyDecisions.get(id)===row)dirtyDecisions.delete(id);}
 catch(error){draftError=error;say('Finding draft could not be saved: '+error.message+'. Keep this page open; the next action will retry its retained draft.',true);}});
}
async function flushDecisions(){
 await draftQueue;
 if(dirtyDecisions.size){const selected=[...dirtyDecisions];await writeDecisionRows(selected.map(([,row])=>row));for(const[id,row]of selected)if(dirtyDecisions.get(id)===row)dirtyDecisions.delete(id);}
 draftError=null;
}
async function readDecisions(reconciliation,parent){
 const db=await openDraftDB(),rows=await new Promise((resolve,reject)=>{const tx=db.transaction('decisions-v2','readonly'),request=tx.objectStore('decisions-v2').index('review').getAll(IDBKeyRange.only([state.workspace.id,reconciliation,parent]));
 request.onsuccess=()=>resolve(request.result.map(row=>[row.id,row.value]));request.onerror=()=>reject(request.error);});
 if(!parent){
  const legacyKey=storageKey('review:'+reconciliation),legacy=JSON.parse(sessionStorage.getItem(legacyKey)||'null');
  if(legacy){const known=new Map(rows),migrated=[];
   for(const[id,value]of legacy.decisions||[])if(!known.has(id)){known.set(id,value);migrated.push({workspace:state.workspace.id,reconciliation,parent:'',id,value});}
   if(migrated.length)await writeDecisionRows(migrated);
   sessionStorage.removeItem(legacyKey);return [...known];
  }
 }
 return rows;
}
window.addEventListener('beforeunload',event=>{if(dirtyDecisions.size||draftError){event.preventDefault();event.returnValue='';}});
function adoptFiles(extra=[]){
 const known=new Map(files.map(f=>[json([f.sha256,f.filename,f.purpose]),f]));
 const add=(ref,purpose)=>{if(!ref||!ref.sha256||!ref.filename||!Number.isSafeInteger(ref.bytes))return;const k=json([ref.sha256,ref.filename,purpose]);if(!known.has(k))known.set(k,{...ref,purpose,selected:false});};
 for(const rows of collections.values())for(const r of rows){
 if(r.file_sha256)add({sha256:r.file_sha256,filename:r.filename,bytes:r.bytes},'input');
 for(const name of ['evidence_files','acceptance_files'])for(const f of r[name]||[])add(f,'evidence');
 for(const f of r.inventory_files||[])add(f,'evidence');for(const f of r.native_files||[])add(f,'native-definition');if(r.decisions_file)add(r.decisions_file,'decisions');
 }
 for(const ref of extra)add(ref,'evidence');files=[...known.values()];persistFiles();
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
 $('retry-pending').hidden=true;$('return-draft').hidden=true;$('resume-pending').hidden=true;
}
function clearPending(){sessionStorage.removeItem(storageKey('pending'));pending=null;pendingView();}
function retainPending(){sessionStorage.setItem(storageKey('pending'),json(pending));pendingView();}
async function inspectPending(){
 if(!pending)return;const r=await api('operation.get',{id:pending.payload.operation_id});
 if(r.found&&r.operation.status==='SUCCEEDED'){const result=r.operation.result;clearPending();await refresh();say('Original request completed. '+json(result));return result;}
 $('retry-pending').hidden=r.found;$('return-draft').hidden=true;$('resume-pending').hidden=!r.found;
 let disposition=null;if(r.found&&r.operation.status==='INTERRUPTED'&&pending.operation.startsWith('finance.'))disposition=await api('finance.request_status',{operation_id:pending.payload.operation_id});
 const editable=!r.found||disposition?.can_return_to_draft===true;
 $('pending-detail').textContent=json({request:pending,observed:r,disposition});$('return-draft').hidden=!editable;$('resume-pending').hidden=!r.found||editable;
 $('return-draft').textContent=r.found?'Retain rejection and edit draft':'Return unadmitted request to draft';
 say(!r.found?'The original request was not admitted. Retry its exact bytes or retain it and edit a new draft.':editable?'The recorded local validation rejection has no committed financial output. Retain its request and error, then correct the draft.':'The original operation is retained. Review and continue its original recovery.');
}
async function mutate(operation,payload){
 if(pending)throw Error('Reconcile the retained original request before another mutation.');
 const request={operation,payload:{...payload,actor:actor(),operation_id:'finance-'+crypto.randomUUID(),expected_revision:state.workspace.revision}};
 pending=request;sessionStorage.setItem(storageKey('pending'),json(pending));pendingView();
 try{
  const result=await api(request.operation,request.payload,true);
  clearPending();await refresh();
  say('Saved original operation '+result.operation_id+'.');return result.result;
 }catch(e){say(e.message+' The complete original request is retained.',true);await inspectPending().catch(()=>{});throw e;}
}
async function invoke(fn){
 if(busy)return;busy=true;$('work-area').inert=true;document.body.setAttribute('aria-busy','true');
 try{saveDrafts();await flushDecisions();await fn();}catch(e){say(e.message+(e.details?'\n'+json(e.details):''),true);}
 finally{busy=false;$('work-area').inert=false;document.body.removeAttribute('aria-busy');}
}
async function all(operation,payload){
 const rows=[];let offset=0,total;
 while(true){const page=await api(operation,{...payload,offset,limit:500});
 if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total))throw Error('Complete paging metadata is absent.');
 if(total!==undefined&&total!==page.total)throw Error('Population changed during selection. Refresh and reopen the full list.');
 total=page.total;rows.push(...page.rows);if(rows.length===total)return rows;
 if(!page.rows.length||rows.length>total)throw Error('Paging ended outside the declared complete population.');offset+=page.rows.length;}
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
 const next=await getState();if(state&&state.workspace.id!==next.workspace?.id)throw Error('The serving workspace changed. Open a new page for that workspace.');state=next;
 // Current original state identifies its project as workspace.
 if(!state.workspace){state.workspace=state.project||state;}
 if(!state.workspace.id||!Number.isSafeInteger(state.workspace.revision))throw Error('Original workspace identity/revision is missing.');
 if(!filesLoaded){files=JSON.parse(sessionStorage.getItem(storageKey('files'))||'[]');filesLoaded=true;}
 $('workspace').textContent=state.workspace.title+' · '+state.workspace.id+' · revision '+state.workspace.revision;
 for(const kind of kinds)collections.set(kind,await all('finance.list',{kind}));
 for(const select of document.querySelectorAll('select[data-kind]'))populate(select,collections.get(select.dataset.kind));
 populate($('control-records'),[...collections.values()].flat());
 adoptFiles();renderFiles();await renderRecords();renderDeliveries();
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
async function stage(body,filename,purpose,add=true){
 const r=await fetch('/api/files?filename='+encodeURIComponent(filename),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
 const v=await r.json();if(!r.ok||v.error)throw Error(v.error?.message||'File intake failed.');
 if(add&&!files.some(x=>x.sha256===v.sha256&&x.filename===v.filename&&x.purpose===purpose))files.push({...v,purpose,selected:false});
 if(add){persistFiles();renderFiles();}return v;
}
async function upload(){
 const file=$('original-file').files[0];if(!file)throw Error('Select the complete original file.');
 const v=await stage(file,file.name,$('file-purpose').value);say('Complete original file retained: '+v.filename);
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
async function copyDefinition(){
 const id=$('definition-copy').value;if(!id)throw Error('Choose an existing definition to edit.');
 const record=await api('finance.get',{kind:'finance.definition',id}),d=record.definition,f=$('definition-form');
 const set=(name,value)=>{f.elements.namedItem(name).value=value??'';};
 for(const name of ['title','family','company','tool','basis_role','measure','currency_basis','budget_edition','sign'])set(name,d[name]);
 set('rounding',d.rounding.mode);set('scale',d.rounding.scale);set('group_fields',d.group_fields.join('\n'));set('filters',json(d.filters));
 set('parent_id',record.id);set('change_id','');set('note','');
 const native=new Set((record.native_files||[]).map(x=>json([x.sha256,x.filename])));
 for(const file of files)if(file.purpose==='native-definition')file.selected=native.has(json([file.sha256,file.filename]));
 persistFiles();renderFiles();saveDrafts();
 say('Copied the retained definition into a later draft with its native files selected. Review the files, select the actual change authorization and enter the new review note.');
}
async function copyControl(){
 const f=$('control-form'),id=formValue(f,'parent_id');if(!id)throw Error('Select the previous control entry first.');
 const record=await api('finance.get',{kind:'finance.control',id}),set=(name,value)=>{f.elements.namedItem(name).value=value??'';};
 for(const name of ['title','category','owner','external_reference'])set(name,record[name]);
 for(const o of f.elements.namedItem('related_ids').options)o.selected=record.related_ids.includes(o.value);
 set('status','proposed');set('note','');for(const name of ['authority_actor','authority_role','decision_reference'])set(name,'');saveDrafts();
 say('Copied the previous control scope into an editable later entry. Record its actual status, authority, outcome and evidence.');
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
 const next=$('review-reconciliation').value,parent=$('previous-review').value;if(!next)throw Error('Select the original reconciliation.');
 let retained=[];
 if(parent){
  const original=await api('finance.get',{kind:'finance.review',id:parent});
  if(original.reconciliation_id!==next)throw Error('The previous review belongs to another reconciliation. Choose its original reconciliation or select no previous review, then reload.');
  retained=await all('finance.rows',{kind:'finance.review',id:parent,section:'decisions'});
  const count=original.decision_count??original.decisions?.length;
  if(!Number.isSafeInteger(count)||retained.length!==count)throw Error('The complete retained review decision count differs.');
 }
 const found=(await all('finance.rows',{kind:'finance.reconciliation',id:next,section:'items'})).filter(r=>r.status!=='MATCH');
 const allowed=new Set(found.map(r=>r.id)),combined=new Map();
 for(const d of retained){if(!allowed.has(d.item_id)||combined.has(d.item_id))throw Error('Retained decisions differ from the complete original finding population.');combined.set(d.item_id,d);}
 if(parent&&combined.size!==allowed.size)throw Error('The previous review does not cover all original discrepancies.');
 for(const[id,d]of await readDecisions(next,parent))if(allowed.has(id))combined.set(id,d);
 reviewId=next;reviewParentId=parent;reviewRows=found;reviewDecisions=combined;reviewOffset=0;
 adoptFiles([...combined.values()].flatMap(d=>d.evidence_files||[]));renderFiles();renderReview();
 say(parent?'Loaded the complete original review and drafts tied to that exact parent. Saving creates its later review.':'Loaded original findings and unparented review drafts.');
}
function reviewCount(){
 $('review-count').textContent=reviewRows.length+' original discrepancies · '+reviewDecisions.size+' entered decisions · '+(reviewRows.length?reviewOffset+1:0)+'–'+Math.min(reviewOffset+25,reviewRows.length)+' shown';
}
function renderReview(){
 reviewCount();const out=$('review-items');out.replaceChildren();
 for(const row of reviewRows.slice(reviewOffset,reviewOffset+25)){
  const box=node('section',undefined,{class:'decision-row'}),left=node('div'),right=node('div');left.append(node('h4',row.status+' · '+row.id),node('pre',json(row)));
  const d=reviewDecisions.get(row.id)||{item_id:row.id,status:'open',owner:$('actor').value,note:'Not yet reviewed.',evidence_files:[]};
  const status=node('select');for(const v of ['open','accepted_variance','resolved'])option(status,v,v.replaceAll('_',' '));status.value=d.status;
  const owner=node('input');owner.value=d.owner;const note=node('textarea');note.value=d.note;
  const correction=node('select');option(correction,'','No corrected result');for(const r of collections.get('finance.reconciliation')||[])option(correction,r.id,r.title||r.id);correction.value=d.correction_reconciliation_id||'';
  const retained=node('p',(d.evidence_files||[]).length+' evidence files retained for this decision.',{class:'hint'}),attach=node('button','Attach current selected evidence',{type:'button'});
  const save=(useSelected=false)=>{const previous=reviewDecisions.get(row.id)||d,next={item_id:row.id,status:status.value,owner:owner.value,note:note.value,evidence_files:useSelected?evidence('evidence'):previous.evidence_files};
   if(correction.value)next.correction_reconciliation_id=correction.value;
   reviewDecisions.set(row.id,next);retainDecision(reviewId,reviewParentId,next);retained.textContent=next.evidence_files.length+' evidence files retained for this decision.';reviewCount();};
  for(const e of [status,owner,note,correction])e.oninput=()=>save(false);
  attach.onclick=()=>{try{save(true);}catch(error){say(error.message,true);}};
  for(const[label,control]of [['Disposition',status],['Discrepancy owner',owner],['Explanation',note],['Complete corrected result',correction]]){const l=node('label',label);l.append(control);right.append(l);}
  right.append(attach,retained);box.append(left,right);out.append(box);
 }
 $('review-prev').disabled=reviewOffset===0;$('review-next').disabled=reviewOffset+25>=reviewRows.length;
}
async function saveReview(){
 if(!reviewId)throw Error('Load the complete original discrepancy population first.');
 if($('review-reconciliation').value!==reviewId||$('previous-review').value!==reviewParentId)throw Error('Load the selected reconciliation and previous review before saving.');
 const complete=reviewRows.map(r=>reviewDecisions.get(r.id)||{item_id:r.id,status:'open',owner:actor(),note:'Not yet reviewed.',evidence_files:[]});
 const filename='financial-decisions-'+reviewId+'.json',file=await stage(new Blob([JSON.stringify(complete)],{type:'application/json'}),filename,'decisions',false);
 const p={title:$('review-title').value,reconciliation_id:reviewId,decisions_file:{sha256:file.sha256,filename},reviewer_role:$('review-role').value,note:$('review-note').value,evidence_files:evidence('evidence')};optional(p,'parent_id',reviewParentId);
 const result=await mutate('finance.review.create',p);$('previous-review').value=result.id;await loadReview();saveDrafts();say('Saved complete review '+result.id+'. Further edits keep this review as their parent.');
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
 if(recordOffset>=rows.length)recordOffset=Math.max(0,Math.floor(Math.max(0,rows.length-1)/50)*50);
 for(const r of rows.slice(recordOffset,recordOffset+50)){const button=node('button',r.title+' · '+r.id);
  button.addEventListener('click',()=>invoke(()=>openRecord(kind,r.id)));box.append(button);}
 $('records-prev').disabled=recordOffset===0;$('records-next').disabled=recordOffset+50>=rows.length;
}
async function openRecord(kind,id){
 selectedRecord={kind,id};rowOffset=0;
 const r=await api('finance.get',{kind,id});$('record-json').textContent=json(r);
 const box=$('selected-record');box.replaceChildren(node('h3',r.title));
 for(const format of ['ndjson','csv'])box.append(node('a','Download complete '+format.toUpperCase()+' ',{href:'/api/exports?kind='+encodeURIComponent(kind)+'&id='+encodeURIComponent(id)+'&format='+format}));
 const sections=kind==='finance.dataset'?['rows']:kind==='finance.run'?['rows','population','exclusions','issues']:kind==='finance.reconciliation'?['items']:kind==='finance.review'?['decisions']:[];
 $('row-controls').hidden=!sections.length;$('rows').replaceChildren();
 for(const o of $('row-section').options)o.hidden=!sections.includes(o.value);
 if(sections.length){$('row-section').value=sections[0];await renderRows();}
}
async function renderRows(){
 if(!selectedRecord)return;
 const r=await api('finance.rows',{...selectedRecord,section:$('row-section').value,query:$('row-query').value,offset:rowOffset,limit:50});
 const box=$('rows');box.replaceChildren(node('p',r.total+' matching retained rows; showing '+r.offset+'–'+(r.offset+r.rows.length)));
 for(const row of r.rows)box.append(node('pre',json(row)));
 $('rows-prev').disabled=rowOffset===0;$('rows-next').disabled=rowOffset+r.rows.length>=r.total;
}
function renderDeliveries(){
 $('delivery-result').replaceChildren();for(const d of state.deliveries||[]){const p=node('p');p.append(node('a',d.title||d.id,{href:'/api/deliveries/'+encodeURIComponent(d.id)}));$('delivery-result').append(p);}
}
function tab(id,persist=true){for(const section of document.querySelectorAll('.tab'))section.hidden=section.id!==id;
 for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-current',String(button.dataset.tab===id));if(persist)saveDrafts();}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>invoke(async()=>tab(button.dataset.tab)));
$('upload-form').addEventListener('submit',e=>{e.preventDefault();invoke(upload);});
const forms=[['dataset-form','finance.dataset.create',datasetFields],['definition-form','finance.definition.create',definitionFields],
 ['run-form','finance.run.create',runFields],['comparison-form','finance.reconciliation.create',comparisonFields],
 ['control-form','finance.control.create',controlFields],['release-form','finance.release.create',releaseFields]];
for(const [id,operation,build]of forms)$(id).addEventListener('submit',e=>{e.preventDefault();invoke(async()=>mutate(operation,await build()));});
$('copy-definition').onclick=()=>invoke(copyDefinition);$('copy-control').onclick=()=>invoke(copyControl);
$('preview-source').onclick=()=>invoke(()=>previewSource(false));$('refresh').onclick=()=>invoke(refresh);
$('previous-review').onchange=()=>invoke(loadReview);
$('load-review').onclick=()=>invoke(loadReview);$('save-review').onclick=()=>invoke(saveReview);
$('review-prev').onclick=()=>{reviewOffset=Math.max(0,reviewOffset-25);renderReview();};
$('review-next').onclick=()=>{reviewOffset+=25;renderReview();};
$('load-records').onclick=()=>invoke(async()=>{recordOffset=0;await refresh();});
$('records-prev').onclick=()=>{recordOffset=Math.max(0,recordOffset-50);renderRecords();};
$('records-next').onclick=()=>{recordOffset+=50;renderRecords();};
$('row-section').onchange=()=>invoke(async()=>{rowOffset=0;await renderRows();});
$('load-rows').onclick=()=>invoke(async()=>{rowOffset=0;await renderRows();});
$('rows-prev').onclick=()=>invoke(async()=>{rowOffset=Math.max(0,rowOffset-50);await renderRows();});
$('rows-next').onclick=()=>invoke(async()=>{rowOffset+=50;await renderRows();});
$('inspect-pending').onclick=()=>invoke(inspectPending);
$('retry-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;const r=await api('operation.get',{id:pending.payload.operation_id});if(r.found)return inspectPending();
 const result=await api(pending.operation,pending.payload,true);clearPending();await refresh();say(json(result));
});
$('return-draft').onclick=()=>invoke(async()=>{
 if(!pending)return;const original=await api('operation.get',{id:pending.payload.operation_id});let disposition=null;
 if(original.found){
  if(original.operation.status==='SUCCEEDED')return inspectPending();
  if(!pending.operation.startsWith('finance.'))return inspectPending();
  disposition=await api('finance.request_status',{operation_id:pending.payload.operation_id});
  if(disposition.can_return_to_draft!==true)return inspectPending();
 }
 const archived=JSON.parse(sessionStorage.getItem(storageKey('returned-requests'))||'[]');
 archived.push({request:pending,observed:original,disposition,returned_at:new Date().toISOString()});
 sessionStorage.setItem(storageKey('returned-requests'),json(archived));clearPending();await refresh();
 say(original.found?'The original rejected request and error remain in this session and the operation journal. Correct the retained draft and save a new request.':'The original unadmitted request remains in this session history. Review the draft and save a new request at the current revision.');
});
$('resume-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;const found=await api('operation.get',{id:pending.payload.operation_id});if(!found.found||found.operation.status==='SUCCEEDED')return inspectPending();
 if(pending.resume){const prior=await api('operation.get',{id:pending.resume.operation_id});if(prior.found&&prior.operation.status==='SUCCEEDED')return inspectPending();
 if(prior.found)throw Error('The retained continuation did not complete. Inspect its original record and correct it through the workspace operation controls.');}
 else{pending.resume={operation_id:'finance-resume-'+crypto.randomUUID(),actor:actor(),expected_revision:(await getState()).workspace.revision,target_operation_id:pending.payload.operation_id,reason:'Operator explicitly continues the retained financial operation after reviewing its original result.'};retainPending();}
 await api('operation.resume',pending.resume,true);await inspectPending();
});
$('verify').onclick=()=>invoke(async()=>{$('verify-result').textContent=json(await api('finance.verify'));say('Retained financial evidence recomputed.');});
$('prepare-delivery').onclick=()=>invoke(async()=>{
 const result=await mutate('delivery.prepare',{title:'Complete financial reporting handover',note:'Original sources, complete calculations, decisions, native evidence and editable application.'});
 renderDeliveries();say('Complete editable delivery retained: '+result.id);
});
for(const kind of kinds)option($('record-kind'),kind,kind.slice(8));
invoke(async()=>{
 await refresh();
 pending=JSON.parse(sessionStorage.getItem(storageKey('pending'))||'null');renderFiles();pendingView();tab('intake',false);
 restoreDrafts();if($('source-file').value){await previewSource(true).catch(e=>say('Retained source mapping could not reopen: '+e.message,true));}
 for(const event of ['input','change'])document.addEventListener(event,()=>{try{saveDrafts();}catch(error){say('Draft could not be saved: '+error.message,true);}});
 if(pending)await inspectPending();else say('Ready. Retain the original files and review the full population.');
});
