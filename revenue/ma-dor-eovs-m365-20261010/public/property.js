/* Property operator interface in the existing retained workspace. */
'use strict';
const $=id=>document.getElementById(id),json=x=>JSON.stringify(x,null,2);
const kinds=['contract','dataset','edition','reconciliation','review','control','release'].map(x=>'property.'+x);
const collections=new Map();let state,files=[],pending=null,busy=false,restoring=false,filesLoaded=false;
let recordOffset=0,rowOffset=0,selectedRecord=null,reviewId=null,reviewParentId=null,reviewRows=[],reviewOffset=0,decisions=new Map();
const node=(tag,value,attrs={})=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const option=(el,value,label)=>el.append(node('option',label,{value}));
const say=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error);};
const key=suffix=>'property:'+state.project.id+':'+suffix;
const field=(id,name)=>$(id).elements.namedItem(name);
const val=(id,name)=>field(id,name).value;
const chosen=(id,name)=>[...field(id,name).selectedOptions].map(x=>x.value);
const optional=(p,k,v)=>{if(v)p[k]=v;return p;};

let draftDB=null,draftQueue=Promise.resolve(),draftError=null;
const dirtyDecisions=new Map();
function openDraftDB(){
 if(!draftDB){
  const opening=new Promise((resolve,reject)=>{let failed=false;const request=indexedDB.open('property-continuity-drafts',2);
   const fail=error=>{failed=true;reject(error);};
   request.onupgradeneeded=()=>{
    const db=request.result,store=db.createObjectStore('decisions-v2',{keyPath:['workspace','reconciliation','parent','subject','id']});
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
 const row={workspace:state.project.id,reconciliation,parent,subject:decision.subject,id:decision.id,value:JSON.parse(JSON.stringify(decision))},id=json([row.workspace,reconciliation,parent,row.subject,row.id]);
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
 const db=await openDraftDB();return new Promise((resolve,reject)=>{const tx=db.transaction('decisions-v2','readonly'),request=tx.objectStore('decisions-v2').index('review').getAll(IDBKeyRange.only([state.project.id,reconciliation,parent]));
 request.onsuccess=()=>resolve(request.result.map(row=>[row.subject+':'+row.id,row.value]));request.onerror=()=>reject(request.error);});
}
window.addEventListener('beforeunload',event=>{if(dirtyDecisions.size||draftError){event.preventDefault();event.returnValue='';}});
function adoptFiles(extra=[]){
 const known=new Map(files.map(f=>[json([f.sha256,f.filename,f.purpose]),f]));
 const add=(ref,purpose)=>{if(!ref||!ref.sha256||!ref.filename||!Number.isSafeInteger(ref.bytes))return;const k=json([ref.sha256,ref.filename,purpose]);if(!known.has(k))known.set(k,{...ref,purpose,selected:false});};
 for(const rows of collections.values())for(const r of rows){
 if(r.file_sha256)add({sha256:r.file_sha256,filename:r.filename,bytes:r.bytes},'input');
 for(const name of ['evidence_files','acceptance_files'])for(const f of r[name]||[])add(f,'evidence');
 for(const f of r.inventory_files||[])add(f,'inventory');if(r.decisions_file)add(r.decisions_file,'decisions');
 }
 for(const ref of extra)add(ref,'evidence');files=[...known.values()];persistFiles();
}

const actor=()=>{const x=$('actor').value.trim();if(!x)throw Error('Enter the actual recorded operator.');return x;};
function saveDrafts(){
 if(!state||restoring)return;const forms={};
 for(const form of document.querySelectorAll('form'))forms[form.id]=[...form.elements].filter(x=>x.name&&x.type!=='file').map(x=>({name:x.name,value:x.multiple?[...x.selectedOptions].map(o=>o.value):x.value}));
 sessionStorage.setItem(key('drafts'),json({actor:$('actor').value,forms,tab:document.querySelector('nav button[aria-current=true]')?.dataset.tab}));
}
function restoreDrafts(){
 restoring=true;try{const saved=JSON.parse(sessionStorage.getItem(key('drafts'))||'null');if(!saved)return;
 $('actor').value=saved.actor||'';
 for(const[id,fields]of Object.entries(saved.forms||{})){if(!$(id))continue;for(const f of fields){const e=field(id,f.name);if(!e)continue;
 if(e.multiple){for(const o of e.options)o.selected=Array.isArray(f.value)&&f.value.includes(o.value);}
 else if(e.tagName!=='SELECT'||[...e.options].some(o=>o.value===f.value))e.value=f.value;}}
 if(saved.tab&&$(saved.tab))tab(saved.tab,false);
 }finally{restoring=false;}
}
function persistFiles(){sessionStorage.setItem(key('files'),json(files));}
function evidence(purpose='evidence'){return files.filter(f=>f.selected&&f.purpose===purpose).map(f=>({sha256:f.sha256,filename:f.filename,purpose:f.purpose}));}
async function api(operation,payload={},mutation=false){
 const response=await fetch(mutation?'/api/operations':'/api/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,payload})});
 const body=await response.json();if(!response.ok||body.error){const error=Error(body.error?.message||response.statusText);error.details=body.error;throw error;}return body;
}
async function readState(){const r=await fetch('/api/state'),v=await r.json();if(!r.ok)throw Error(v.error?.message||'Workspace read failed.');if(!v.project?.id||!Number.isSafeInteger(v.project.revision))throw Error('Workspace identity or revision is absent.');return v;}
async function all(operation,payload){
 const rows=[];let offset=0,total;
 while(true){const page=await api(operation,{...payload,offset,limit:500});
 if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total))throw Error('Complete paging metadata is absent.');
 if(total!==undefined&&total!==page.total)throw Error('Population changed during selection. Refresh and reopen the full list.');
 total=page.total;rows.push(...page.rows);if(rows.length===total)return rows;
 if(!page.rows.length||rows.length>total)throw Error('Paging ended outside the declared complete population.');offset+=page.rows.length;}
}
function populate(select,rows){
 const prior=[...select.selectedOptions].map(x=>x.value);select.replaceChildren();
 if(select.hasAttribute('data-blank'))option(select,'','None');
 for(const r of rows)option(select,r.id,(r.title||r.id)+' · '+r.id);
 for(const o of select.options)o.selected=prior.includes(o.value);
 if(!select.multiple&&!select.value&&select.options.length)select.selectedIndex=0;
}
async function refresh(){
 const next=await readState();if(state&&state.project.id!==next.project.id)throw Error('The serving workspace changed. Open a new page for that workspace.');
 state=next;if(!filesLoaded){files=JSON.parse(sessionStorage.getItem(key('files'))||'[]');filesLoaded=true;}$('workspace').textContent=state.project.title+' · revision '+state.project.revision+' · '+state.project.id;
 for(const kind of kinds)collections.set(kind,await all('property.list',{kind}));
 for(const select of document.querySelectorAll('select[data-kind]'))populate(select,collections.get(select.dataset.kind)||[]);
 populate($('control-records'),[...collections.values()].flat());adoptFiles();renderFiles();renderRecords();renderDeliveries();
}
function pendingView(){
 $('pending').hidden=!pending;$('pending-detail').textContent=pending?json(pending):'';
 $('retry-pending').hidden=true;$('return-draft').hidden=true;$('resume-pending').hidden=true;
}
function clearPending(){pending=null;sessionStorage.removeItem(key('pending'));pendingView();}
function retainPending(){sessionStorage.setItem(key('pending'),json(pending));pendingView();}
async function inspectPending(){
 if(!pending)return;const r=await api('operation.get',{id:pending.payload.operation_id});
 if(r.found&&r.operation.status==='SUCCEEDED'){const result=r.operation.result;clearPending();await refresh();say('Original request completed. '+json(result));return result;}
 $('retry-pending').hidden=r.found;$('return-draft').hidden=true;$('resume-pending').hidden=!r.found;
 let disposition=null;if(r.found&&r.operation.status==='INTERRUPTED'&&pending.operation.startsWith('property.'))disposition=await api('property.request_status',{operation_id:pending.payload.operation_id});
 const editable=!r.found||disposition?.can_return_to_draft===true;
 $('pending-detail').textContent=json({request:pending,observed:r,disposition});$('return-draft').hidden=!editable;$('resume-pending').hidden=!r.found||editable;
 $('return-draft').textContent=r.found?'Retain rejection and edit draft':'Return unadmitted request to draft';
 say(!r.found?'The original request was not admitted. Retry its exact bytes or retain it and edit a new draft.':editable?'The recorded local validation rejection has no committed property output. Retain its request and error, then correct the draft.':'The original operation is retained. Review and continue its original recovery.');
}
async function mutate(operation,payload){
 if(pending)throw Error('Inspect and reconcile the retained original request first.');
 pending={operation,payload:{...payload,operation_id:'property-'+crypto.randomUUID(),actor:actor(),expected_revision:state.project.revision}};retainPending();
 try{const result=await api(operation,pending.payload,true);clearPending();await refresh();say('Saved '+operation+'.');return result.result;}
 catch(error){await inspectPending().catch(()=>{});throw error;}
}
async function invoke(fn){
 if(busy)return;busy=true;$('work-area').inert=true;document.body.setAttribute('aria-busy','true');
 try{saveDrafts();await flushDecisions();await fn();}catch(error){say(error.message+(error.details?'\n'+json(error.details):''),true);}
 finally{busy=false;$('work-area').inert=false;document.body.removeAttribute('aria-busy');}
}
function renderFiles(){
 const out=$('files');out.replaceChildren();for(const f of files){
 const row=node('div',undefined,{class:'file-row'}),label=node('label'),check=node('input',undefined,{type:'checkbox'});
 check.checked=!!f.selected;check.onchange=()=>{f.selected=check.checked;persistFiles();};label.append(check,node('span','Select '+f.purpose+' evidence'));
 row.append(label,node('a',f.filename+' · '+f.bytes+' bytes',{href:'/api/files/'+f.sha256+'?filename='+encodeURIComponent(f.filename)}),node('code',f.sha256));out.append(row);}
 const select=$('dataset-file'),old=select.value;select.replaceChildren();for(const f of files.filter(f=>f.purpose==='input'))option(select,f.sha256,f.filename);
 if([...select.options].some(o=>o.value===old))select.value=old;
}
async function stage(body,filename,purpose,add=true){
 const r=await fetch('/api/files?filename='+encodeURIComponent(filename),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
 const value=await r.json();if(!r.ok||value.error)throw Error(value.error?.message||'Complete file intake failed.');
 if(add&&!files.some(f=>f.sha256===value.sha256&&f.filename===filename&&f.purpose===purpose)){
 files.push({...value,filename,purpose,selected:false});persistFiles();renderFiles();}return value;
}
async function upload(){const file=$('upload-file').files[0];if(!file)throw Error('Select a complete original file.');await stage(file,file.name,$('file-purpose').value);say('Full original retained: '+file.name);}
async function getContract(id){const r=await api('property.get',{kind:'property.contract',id});if(!r.contract)throw Error('Selected contract definition is absent.');return r.contract;}
async function loadFamilies(){
 const id=$('dataset-contract').value;if(!id)return;const contract=await getContract(id),select=$('dataset-family'),old=select.value;select.replaceChildren();
 for(const family of contract.families)option(select,family.id,family.id+' · '+family.platform);if([...select.options].some(o=>o.value===old))select.value=old;return contract;
}
function mappingValue(){const p=JSON.parse(val('dataset-form','mapping'));if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Use a field-to-original-column mapping object.');return p;}
function dialect(){return {encoding:val('dataset-form','encoding'),delimiter:val('dataset-form','delimiter')};}
async function previewSource(){
 const contract=await loadFamilies(),family=contract?.families.find(f=>f.id===$('dataset-family').value);if(!family)throw Error('Select an actual contract family.');
 const mapping=mappingValue(),p=await api('property.preview',{contract_id:$('dataset-contract').value,family:family.id,file_sha256:$('dataset-file').value,format:val('dataset-form','format'),dialect:dialect(),mapping});
 $('mapping').replaceChildren();
 for(const[name,spec]of Object.entries(family.fields)){
 const line=node('div',undefined,{class:'mapping-row'}),label=node('label',name+' · '+spec.type+(spec.required?' · required':'')),select=node('select',undefined,{'aria-label':'Original column for '+name});
 option(select,'','Choose an original column');for(const c of p.columns)option(select,c,c);select.value=mapping[name]||'';
 select.onchange=()=>{const m=mappingValue();if(select.value)m[name]=select.value;else delete m[name];field('dataset-form','mapping').value=json(m);saveDrafts();};
 label.append(select);line.append(node('span',name),label);$('mapping').append(line);}
 $('preview').hidden=false;$('preview').textContent=json(p);say(p.row_count+' original rows read. Review every mapped field.');saveDrafts();
}
function contractFields(){
 const id='contract-form',contract={title:val(id,'title'),scope_id:val(id,'scope_id'),platforms:JSON.parse(val(id,'platforms')),families:JSON.parse(val(id,'families')),lease_rule:JSON.parse(val(id,'lease_rule')),review:{actor:actor(),note:val(id,'note'),evidence_files:evidence()}};
 optional(contract,'parent_id',val(id,'parent_id'));optional(contract,'change_reference',val(id,'change_reference'));
 return {contract};
}
async function datasetFields(){
 const id='dataset-form',v=n=>val(id,n),contract=await getContract(v('contract_id')),file=files.find(f=>f.sha256===v('file_sha256')&&f.purpose==='input');
 if(!file)throw Error('Select a retained complete original file.');
 const context={scope_id:contract.scope_id,family:v('family'),role:v('role'),system:v('system'),source_reference:v('source_reference'),captured_at:v('captured_at'),cutoff:v('cutoff'),coverage:v('coverage'),authority:v('authority'),extraction_reference:v('extraction_reference'),independent:v('independent')==='true',parameters:JSON.parse(v('parameters')),review:{actor:actor(),note:v('note'),evidence_files:evidence()}};
 const p={title:v('title'),contract_id:v('contract_id'),family:v('family'),file_sha256:file.sha256,filename:file.filename,format:v('format'),dialect:dialect(),mapping:mappingValue(),context};
 return optional(p,'parent_id',v('parent_id'));
}
function editionFields(){const id='edition-form',v=n=>val(id,n);return optional({title:v('title'),contract_id:v('contract_id'),role:v('role'),cutoff:v('cutoff'),dataset_ids:chosen(id,'dataset_ids'),note:v('note')},'parent_id',v('parent_id'));}
function comparisonFields(){const id='comparison-form',p={};for(const n of ['title','source_edition_id','target_edition_id','note'])p[n]=val(id,n);return p;}
async function loadReview(){
 const next=$('review-selection').value,parent=val('review-form','parent_id');if(!next)throw Error('Choose a retained reconciliation.');
 let retained=[];
 if(parent){
  const original=await api('property.get',{kind:'property.review',id:parent});
  if(original.reconciliation_id!==next)throw Error('The selected previous review belongs to another reconciliation. Select that reconciliation or choose no previous review, then load the findings.');
  retained=await all('property.rows',{kind:'property.review',id:parent,section:'decisions'});
  if(retained.length!==original.decision_count)throw Error('The complete retained review decision count differs.');
 }
 const items=await all('property.rows',{kind:'property.reconciliation',id:next,section:'items'});
 const checks=await all('property.rows',{kind:'property.reconciliation',id:next,section:'checks'});
 const found=[...items.filter(x=>x.status!=='MATCH').map(x=>({subject:'item',record:x})),...checks.filter(x=>x.status!=='PASS').map(x=>({subject:'check',record:x}))];
 const allowed=new Set(found.map(x=>x.subject+':'+x.record.id)),combined=new Map();
 for(const decision of retained){const id=decision.subject+':'+decision.id;if(!allowed.has(id)||combined.has(id))throw Error('Retained decisions do not match the original complete finding population.');combined.set(id,decision);}
 if(parent&&combined.size!==allowed.size)throw Error('The retained review does not cover every original finding.');
 const saved=await readDecisions(next,parent);
 for(const[id,decision]of saved)if(allowed.has(id))combined.set(id,decision);
 reviewId=next;reviewParentId=parent;reviewRows=found;decisions=combined;reviewOffset=0;
 adoptFiles([...combined.values()].flatMap(d=>d.evidence_files||[]));renderFiles();renderReview();
 say(parent?'Loaded the complete retained review and drafts for that exact previous review. Saving creates a later review.':'Loaded the original findings and unparented review drafts.');
}
function updateCount(){$('review-count').textContent=reviewRows.length+' findings · '+decisions.size+' entered decisions · '+(reviewRows.length?Math.min(reviewOffset+1,reviewRows.length):0)+'–'+Math.min(reviewOffset+20,reviewRows.length)+' shown';}
function renderReview(){
 updateCount();const out=$('review-items');out.replaceChildren();
 for(const {subject,record}of reviewRows.slice(reviewOffset,reviewOffset+20)){
 const id=subject+':'+record.id,d=decisions.get(id)||{subject,id:record.id,status:'open',owner:$('actor').value,note:'Not yet reviewed.',evidence_files:[]};
 const box=node('div',undefined,{class:'decision-row'}),left=node('div'),right=node('div');
 left.append(node('h3',(record.family||subject)+' · '+record.status),node('pre',json(record)));
 const status=node('select',undefined,{'aria-label':'Finding disposition'});for(const s of ['open',...(subject==='item'&&record.status==='DIFFERENT'?['accepted_variance']:[]),'resolved'])option(status,s,s.replaceAll('_',' '));status.value=d.status;
 const owner=node('input',undefined,{'aria-label':'Finding owner'});owner.value=d.owner;const note=node('textarea',undefined,{'aria-label':'Finding explanation'});note.value=d.note;
 const correction=node('select',undefined,{'aria-label':'Complete corrected assessment'});option(correction,'','No corrected assessment');for(const r of collections.get('property.reconciliation')||[])option(correction,r.id,r.title||r.id);correction.value=d.correction_reconciliation_id||'';
 const retained=node('p',(d.evidence_files||[]).length+' evidence files frozen for this decision.',{class:'hint'}),freeze=node('button','Attach current selected evidence',{type:'button'});
 function save(useSelected=false){const previous=decisions.get(id)||d,next={subject,id:record.id,status:status.value,owner:owner.value,note:note.value,evidence_files:useSelected?evidence():previous.evidence_files};
 if(correction.value)next.correction_reconciliation_id=correction.value;decisions.set(id,next);
 retainDecision(reviewId,reviewParentId,next);retained.textContent=next.evidence_files.length+' evidence files frozen for this decision.';updateCount();}
 for(const e of [status,owner,note,correction])e.oninput=()=>save(false);freeze.onclick=()=>{try{save(true);}catch(e){say(e.message,true);}};
 for(const [label,control]of [['Disposition',status],['Owner',owner],['Reason',note],['Corrected complete assessment',correction]]){const l=node('label',label);l.append(control);right.append(l);}right.append(freeze,retained);box.append(left,right);out.append(box);}
 $('review-prev').disabled=reviewOffset===0;$('review-next').disabled=reviewOffset+20>=reviewRows.length;
}
async function saveReview(){
 if(!reviewId)throw Error('Load the complete finding population first.');
 if($('review-selection').value!==reviewId||val('review-form','parent_id')!==reviewParentId)throw Error('Load the selected reconciliation and previous review before saving.');
 const complete=reviewRows.map(({subject,record})=>decisions.get(subject+':'+record.id)||{subject,id:record.id,status:'open',owner:actor(),note:'Not yet reviewed.',evidence_files:[]});
 const retained=await stage(new Blob([JSON.stringify(complete)],{type:'application/json'}),'property-decisions-'+reviewId+'.json','decisions',false);
 const id='review-form',p={title:val(id,'title'),reconciliation_id:reviewId,decisions_file:{sha256:retained.sha256,filename:'property-decisions-'+reviewId+'.json'},reviewer_role:val(id,'reviewer_role'),note:val(id,'note'),evidence_files:evidence()};
 optional(p,'parent_id',reviewParentId);const result=await mutate('property.review.create',p);field(id,'parent_id').value=result.id;await loadReview();saveDrafts();say('Saved complete review '+result.id+'. Further edits will retain this review as their parent.');return result;
}
function controlFields(){
 const id='control-form',v=n=>val(id,n),p={title:v('title'),contract_id:v('contract_id'),category:v('category'),status:v('status'),owner:v('owner'),external_reference:v('external_reference'),related_ids:chosen(id,'related_ids'),note:v('note'),evidence_files:evidence()};
 optional(p,'parent_id',v('parent_id'));if(p.status!=='proposed')p.authority={actor:v('authority_actor'),role:v('authority_role'),decision_reference:v('decision_reference')};return p;
}
function releaseFields(){
 const id='release-form',v=n=>val(id,n),p={title:v('title'),contract_id:v('contract_id'),review_ids:chosen(id,'review_ids'),control_ids:chosen(id,'control_ids'),inventory_files:evidence('inventory'),note:v('note'),acceptance:{actor:v('acceptance_actor'),role:v('acceptance_role'),reference:v('acceptance_reference'),evidence_files:evidence()}};
 return optional(p,'parent_id',v('parent_id'));
}
function renderRecords(){
 const rows=collections.get($('record-kind').value)||[];if(recordOffset>=rows.length)recordOffset=Math.max(0,Math.floor(Math.max(0,rows.length-1)/50)*50);
 $('records-list').replaceChildren();for(const r of rows.slice(recordOffset,recordOffset+50)){const b=node('button',r.title+' · '+r.id);b.onclick=()=>invoke(()=>openRecord($('record-kind').value,r.id));$('records-list').append(b);}
 $('records-prev').disabled=recordOffset===0;$('records-next').disabled=recordOffset+50>=rows.length;
}
async function openRecord(kind,id){
 selectedRecord={kind,id};rowOffset=0;const record=await api('property.get',{kind,id});$('record-json').hidden=false;$('record-json').textContent=json(record);
 $('selected-record').replaceChildren(node('h3',record.title));for(const f of ['csv','ndjson'])$('selected-record').append(node('a','Complete '+f.toUpperCase()+' export ',{href:'/api/exports?kind='+encodeURIComponent(kind)+'&id='+encodeURIComponent(id)+'&format='+f}));
 const withRows=['property.dataset','property.reconciliation','property.review'].includes(kind);$('row-controls').hidden=!withRows;
 $('row-section').value=kind==='property.reconciliation'?'items':kind==='property.review'?'decisions':'rows';
 for(const o of $('row-section').options)o.hidden=kind==='property.reconciliation'?!['items','checks'].includes(o.value):o.value!==(kind==='property.review'?'decisions':'rows');
 if(withRows)await renderRows();
}
async function renderRows(){
 if(!selectedRecord)return;const r=await api('property.rows',{...selectedRecord,section:$('row-section').value,query:$('row-query').value,offset:rowOffset,limit:50});
 $('rows').replaceChildren(node('p',r.total+' retained rows · '+r.offset+'–'+(r.offset+r.rows.length)+' shown'));for(const row of r.rows)$('rows').append(node('pre',json(row)));
 $('rows-prev').disabled=rowOffset===0;$('rows-next').disabled=rowOffset+r.rows.length>=r.total;
}
function renderDeliveries(){
 $('deliveries').replaceChildren(); // Downloads bind the original complete delivery identity.
 for(const d of state.deliveries||[]){const line=node('p');line.append(node('a',d.title||d.id,{href:'/api/deliveries/'+encodeURIComponent(d.id)}));$('deliveries').append(line);}
}
function tab(id,persist=true){for(const e of document.querySelectorAll('.tab'))e.hidden=e.id!==id;for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-current',String(b.dataset.tab===id));if(persist)saveDrafts();}
for(const b of document.querySelectorAll('nav button'))b.onclick=()=>invoke(async()=>tab(b.dataset.tab));
for(const[id,op,build]of [['contract-form','property.contract.create',contractFields],['dataset-form','property.dataset.create',datasetFields],['edition-form','property.edition.create',editionFields],['comparison-form','property.reconciliation.create',comparisonFields],['control-form','property.control.create',controlFields],['release-form','property.release.create',releaseFields]])$(id).onsubmit=e=>{e.preventDefault();invoke(async()=>mutate(op,await build()));};
$('upload-form').onsubmit=e=>{e.preventDefault();invoke(upload);};$('review-form').onsubmit=e=>{e.preventDefault();invoke(saveReview);};
$('delivery-form').onsubmit=e=>{e.preventDefault();invoke(async()=>{const r=await mutate('delivery.prepare',{title:'Complete property continuity handover',note:val('delivery-form','note')});const p=node('p');p.append(node('a','Download complete editable application and workspace',{href:'/api/deliveries/'+encodeURIComponent(r.id)}));$('deliveries').prepend(p);});};
$('refresh').onclick=()=>invoke(refresh);$('preview-source').onclick=()=>invoke(previewSource);
$('dataset-contract').onchange=()=>invoke(async()=>{$('mapping').replaceChildren();field('dataset-form','mapping').value='{}';await loadFamilies();saveDrafts();});
$('dataset-family').onchange=()=>{$('mapping').replaceChildren();field('dataset-form','mapping').value='{}';saveDrafts();};
$('load-contract').onclick=()=>invoke(async()=>{const c=await getContract($('contract-copy').value);for(const n of ['title','scope_id','change_reference'])field('contract-form',n).value=c[n]||'';for(const n of ['platforms','families','lease_rule'])field('contract-form',n).value=json(c[n]);field('contract-form','parent_id').value=$('contract-copy').value;field('contract-form','note').value='';saveDrafts();say('Copied into an editable later contract draft. Original retained contract is unchanged.');});
field('review-form','parent_id').onchange=()=>invoke(loadReview);
$('load-review').onclick=()=>invoke(loadReview);$('review-prev').onclick=()=>{reviewOffset=Math.max(0,reviewOffset-20);renderReview();};$('review-next').onclick=()=>{reviewOffset+=20;renderReview();};
$('record-kind').onchange=()=>{recordOffset=0;renderRecords();};$('records-prev').onclick=()=>{recordOffset=Math.max(0,recordOffset-50);renderRecords();};$('records-next').onclick=()=>{recordOffset+=50;renderRecords();};
$('search-rows').onclick=()=>invoke(async()=>{rowOffset=0;await renderRows();});$('row-section').onchange=()=>invoke(async()=>{rowOffset=0;await renderRows();});
$('rows-prev').onclick=()=>invoke(async()=>{rowOffset=Math.max(0,rowOffset-50);await renderRows();});$('rows-next').onclick=()=>invoke(async()=>{rowOffset+=50;await renderRows();});
$('inspect-pending').onclick=()=>invoke(inspectPending);
$('retry-pending').onclick=()=>invoke(async()=>{if(!pending)return;const found=await api('operation.get',{id:pending.payload.operation_id});if(found.found)return inspectPending();const r=await api(pending.operation,pending.payload,true);clearPending();await refresh();say(json(r));});
$('return-draft').onclick=()=>invoke(async()=>{
 if(!pending)return;const original=await api('operation.get',{id:pending.payload.operation_id});let disposition=null;
 if(original.found){
  if(original.operation.status==='SUCCEEDED')return inspectPending();
  if(!pending.operation.startsWith('property.'))return inspectPending();
  disposition=await api('property.request_status',{operation_id:pending.payload.operation_id});
  if(disposition.can_return_to_draft!==true)return inspectPending();
 }
 const archived=JSON.parse(sessionStorage.getItem(key('returned-requests'))||'[]');
 archived.push({request:pending,observed:original,disposition,returned_at:new Date().toISOString()});
 sessionStorage.setItem(key('returned-requests'),json(archived));clearPending();await refresh();
 say(original.found?'The original rejected request and error remain in this session and the operation journal. Correct the retained draft and save a new request.':'The original unadmitted request remains in this session history. Review the draft and save a new request at the current revision.');
});
$('resume-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;const found=await api('operation.get',{id:pending.payload.operation_id});if(!found.found||found.operation.status==='SUCCEEDED')return inspectPending();
 if(pending.resume){const prior=await api('operation.get',{id:pending.resume.operation_id});if(prior.found&&prior.operation.status==='SUCCEEDED')return inspectPending();
 if(prior.found)throw Error('The retained continuation did not complete. Inspect its original record and correct it through the workspace operation controls.');}
 else{pending.resume={operation_id:'property-resume-'+crypto.randomUUID(),actor:actor(),expected_revision:(await readState()).project.revision,target_operation_id:pending.payload.operation_id,reason:'Operator explicitly continues the retained property operation after reviewing its original result.'};retainPending();}
 await api('operation.resume',pending.resume,true);await inspectPending();
});
$('verify').onclick=()=>invoke(async()=>{const v=await api('property.verify');$('record-json').hidden=false;$('record-json').textContent=json(v);say('Retained property results recomputed.');});
for(const kind of kinds)option($('record-kind'),kind,kind.slice(9));
invoke(async()=>{
 await refresh();pending=JSON.parse(sessionStorage.getItem(key('pending'))||'null');renderFiles();pendingView();tab('contract',false);restoreDrafts();
 if($('dataset-contract').value){await loadFamilies();restoreDrafts();}
 for(const e of ['input','change'])document.addEventListener(e,()=>{try{saveDrafts();}catch(error){say('Draft could not be saved: '+error.message,true);}});
 if(pending)await inspectPending();else say('Workspace open. Retain complete originals and select the reviewed contract.');
});
