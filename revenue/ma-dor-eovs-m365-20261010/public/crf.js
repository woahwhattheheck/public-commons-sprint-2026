/* CRF operator interface in the existing retained workspace. */
'use strict';
const $=id=>document.getElementById(id),json=x=>JSON.stringify(x,null,2);
const kinds=['contract','dataset','edition','comparison','review','workbook_binding','workbook_output','workbook_return'].map(x=>'crf.'+x);
const collections=new Map();let state,files=[],deliveries=[],pending=null,busy=false,restoring=false,filesLoaded=false;
let recordOffset=0,rowOffset=0,selectedRecord=null,reviewId=null,reviewParentId=null,reviewRows=[],reviewOffset=0,decisions=new Map();
let schemaInfo=null,template=null,templateCells=[],filteredCells=[],cellOffset=0,pickedCell=null,filteredReview=[];
const node=(tag,value,attrs={})=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const option=(el,value,label)=>el.append(node('option',label,{value}));
const say=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error);};
const key=suffix=>'crf:'+state.project.id+':'+suffix;
const field=(id,name)=>$(id).elements.namedItem(name);
const val=(id,name)=>field(id,name).value;
const chosen=(id,name)=>[...field(id,name).selectedOptions].map(x=>x.value);
const optional=(p,k,v)=>{if(v)p[k]=v;return p;};

let draftDB=null,draftQueue=Promise.resolve(),draftError=null;
const dirtyDecisions=new Map();
function openDraftDB(){
 if(!draftDB){
  const opening=new Promise((resolve,reject)=>{let failed=false;const request=indexedDB.open('crf-reporting-drafts',1);
   const fail=error=>{failed=true;reject(error);};
   request.onupgradeneeded=()=>{
    const db=request.result,store=db.createObjectStore('decisions',{keyPath:['workspace','edition','parent','check_id']});
    store.createIndex('review',['workspace','edition','parent']);
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
 const db=await openDraftDB();await new Promise((resolve,reject)=>{const tx=db.transaction('decisions','readwrite');for(const row of rows)tx.objectStore('decisions').put(row);
 tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Finding draft transaction did not commit.'));tx.onerror=()=>{};});
}
function retainDecision(edition,parent,decision){
 const row={workspace:state.project.id,edition,parent,check_id:decision.check_id,value:JSON.parse(JSON.stringify(decision))},id=json([row.workspace,edition,parent,row.check_id]);
 dirtyDecisions.set(id,row);
 draftQueue=draftQueue.then(async()=>{try{await writeDecisionRows([row]);if(dirtyDecisions.get(id)===row)dirtyDecisions.delete(id);}
 catch(error){draftError=error;say('Finding draft could not be saved: '+error.message+'. Keep this page open; the next action will retry its retained draft.',true);}});
}
async function flushDecisions(){
 await draftQueue;
 if(dirtyDecisions.size){const selected=[...dirtyDecisions];await writeDecisionRows(selected.map(([,row])=>row));for(const[id,row]of selected)if(dirtyDecisions.get(id)===row)dirtyDecisions.delete(id);}
 draftError=null;
}
async function readDecisions(edition,parent){
 const db=await openDraftDB();return new Promise((resolve,reject)=>{const tx=db.transaction('decisions','readonly'),request=tx.objectStore('decisions').index('review').getAll(IDBKeyRange.only([state.project.id,edition,parent]));
 request.onsuccess=()=>resolve(request.result.map(row=>[row.check_id,row.value]));request.onerror=()=>reject(request.error);});
}
window.addEventListener('beforeunload',event=>{if(dirtyDecisions.size||draftError){event.preventDefault();event.returnValue='';}});
function adoptFiles(extra=[]){
 const known=new Map(files.map(f=>[json([f.sha256,f.filename,f.purpose]),f]));
 const add=(ref,purpose)=>{if(!ref||!ref.sha256||!ref.filename)return;const k=json([ref.sha256,ref.filename,purpose]);if(!known.has(k))known.set(k,{...ref,purpose,selected:false});};
 for(const rows of collections.values())for(const r of rows){
 if(r.file_sha256)add({sha256:r.file_sha256,filename:r.filename,bytes:r.bytes},r.kind==='crf.workbook_binding'?'template':r.kind==='crf.workbook_return'?'return':r.kind==='crf.workbook_output'?'output':'input');
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
 for(const kind of kinds)collections.set(kind,await all('crf.list',{kind}));
 deliveries=await all('delivery.list',{});
 for(const select of document.querySelectorAll('select[data-kind]'))populate(select,collections.get(select.dataset.kind)||[]);
 adoptFiles();renderFiles();renderRecords();renderDeliveries();
}
function pendingView(){
 $('pending').hidden=!pending;$('pending-detail').textContent=pending?json(pending):'';
 $('retry-pending').hidden=true;$('return-draft').hidden=true;$('resume-pending').hidden=true;
}
function clearPending(){sessionStorage.removeItem(key('pending'));pending=null;pendingView();}
function retainPending(){sessionStorage.setItem(key('pending'),json(pending));pendingView();}
async function inspectPending(){
 if(!pending)return;const r=await api('operation.get',{id:pending.payload.operation_id});
 if(r.found&&r.operation.status==='SUCCEEDED'){const result=r.operation.result;clearPending();await refresh();say('Original request completed. '+json(result));return result;}
 $('retry-pending').hidden=r.found;$('return-draft').hidden=true;$('resume-pending').hidden=!r.found;
 let disposition=null;if(r.found&&r.operation.status==='INTERRUPTED'&&pending.operation.startsWith('crf.'))disposition=await api('crf.request_status',{operation_id:pending.payload.operation_id});
 const editable=!r.found||disposition?.can_return_to_draft===true;
 $('pending-detail').textContent=json({request:pending,observed:r,disposition});$('return-draft').hidden=!editable;$('resume-pending').hidden=!r.found||editable;
 $('return-draft').textContent=r.found?'Retain rejection and edit draft':'Return unadmitted request to draft';
 say(!r.found?'The original request was not admitted. Retry its exact bytes or retain it and edit a new draft.':editable?'The recorded local validation rejection has no committed crf output. Retain its request and error, then correct the draft.':'The original operation is retained. Review and continue its original recovery.');
}
async function mutate(operation,payload){
 if(pending)throw Error('Inspect and reconcile the retained original request first.');
 pending={operation,payload:{...payload,operation_id:'crf-'+crypto.randomUUID(),actor:actor(),expected_revision:state.project.revision}};retainPending();
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
 row.append(label,node('a',f.filename+(Number.isSafeInteger(f.bytes)?' · '+f.bytes+' bytes':' · retained evidence'),{href:'/api/files/'+f.sha256+'?filename='+encodeURIComponent(f.filename)}),node('code',f.sha256));out.append(row);}
 for(const select of document.querySelectorAll('select[data-file-purpose]')){
  const old=select.value;select.replaceChildren();option(select,'','Choose retained original');
  for(const f of files.filter(f=>f.purpose===select.dataset.filePurpose))option(select,f.sha256,f.filename+' · '+f.sha256.slice(0,12));
  if([...select.options].some(o=>o.value===old))select.value=old;
 }
}

async function stage(body,filename,purpose,add=true){
 const r=await fetch('/api/files?filename='+encodeURIComponent(filename),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
 const value=await r.json();if(!r.ok||value.error)throw Error(value.error?.message||'Complete file intake failed.');
 if(add&&!files.some(f=>f.sha256===value.sha256&&f.filename===filename&&f.purpose===purpose)){
 files.push({...value,filename,purpose,selected:false});persistFiles();renderFiles();}return value;
}
async function upload(){const file=$('upload-file').files[0];if(!file)throw Error('Select a complete original file.');await stage(file,file.name,$('file-purpose').value);say('Full original retained: '+file.name);}

function reviewFields(form){return {actor:actor(),role:val(form,'role'),note:val(form,'note'),evidence_files:evidence()};}
function parseObject(text,label){const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be a JSON object.');return value;}
function fileFor(form,name,purpose){const sha=val(form,name),file=files.find(f=>f.sha256===sha&&f.purpose===purpose);if(!file)throw Error('Select a retained '+purpose+' file.');return file;}
function mappingValue(){return parseObject(val('dataset-form','mapping'),'Column and value mapping');}
function dialect(){return {encoding:val('dataset-form','encoding'),delimiter:val('dataset-form','delimiter')};}
function loadFamilies(){
 const select=$('dataset-family'),old=select.value;select.replaceChildren();
 for(const family of Object.keys(schemaInfo.fields))option(select,family,family.replaceAll('_',' '));
 if([...select.options].some(o=>o.value===old))select.value=old;
}
async function previewSource(){
 const family=$('dataset-family').value;if(!schemaInfo.fields[family])throw Error('Select a current source family.');
 const mapping=mappingValue(),p=await api('crf.preview',{contract_id:$('dataset-contract').value,family,file_sha256:$('dataset-file').value,format:val('dataset-form','format'),dialect:dialect()});
 $('mapping').replaceChildren();
 for(const[name,type]of Object.entries(schemaInfo.fields[family])){
  const label=node('label',name+' · '+type+(schemaInfo.required[family].includes(name)?' · required':'')),select=node('select',undefined,{'aria-label':'Actual original column for '+name});
  option(select,'','Unmapped / unknown');for(const column of p.columns)option(select,column,column);
  select.value=typeof mapping[name]==='string'?mapping[name]:mapping[name]?.column||'';
  select.onchange=()=>{try{const m=mappingValue();if(select.value)m[name]=typeof m[name]==='object'?{...m[name],column:select.value}:select.value;else delete m[name];field('dataset-form','mapping').value=json(m);saveDrafts();}catch(error){say(error.message,true);}};
  label.append(select);const category=schemaInfo.categories[name];if(category)label.append(node('small','Reviewed categories: '+category.join(', ')));
  $('mapping').append(label);
 }
 $('preview').hidden=false;$('preview').textContent=json(p);say(p.row_count+' original rows. No column or category translation was assumed.');saveDrafts();
}
function contractFields(){
 const id='contract-form',v=n=>val(id,n);
 return optional({title:v('title'),contract:{scope_id:v('scope_id'),authority_name:v('authority_name'),authority_type:v('authority_type'),financial_year:Number(v('financial_year')),recognition_basis:v('recognition_basis'),repeat_count_basis:v('repeat_count_basis'),review:reviewFields(id)}},'parent_id',v('parent_id'));
}
function datasetFields(){
 const id='dataset-form',v=n=>val(id,n),file=fileFor(id,'file_sha256','input');
 return optional({title:v('title'),contract_id:v('contract_id'),family:v('family'),file_sha256:file.sha256,filename:file.filename,format:v('format'),dialect:dialect(),mapping:mappingValue(),context:{coverage:v('coverage'),period_start:v('period_start'),period_end:v('period_end'),captured_at:v('captured_at'),source_system:v('source_system'),extraction_reference:v('extraction_reference'),review:reviewFields(id)}},'parent_id',v('parent_id'));
}
function editionFields(){const id='edition-form',v=n=>val(id,n);return optional({title:v('title'),contract_id:v('contract_id'),period:v('period'),dataset_ids:chosen(id,'dataset_ids'),note:v('note')},'parent_id',v('parent_id'));}
function comparisonFields(){const id='comparison-form',p={};for(const name of ['title','earlier_id','later_id','note'])p[name]=val(id,name);return p;}
async function loadReview(){
 const next=$('review-selection').value,parent=val('review-form','parent_id');if(!next)throw Error('Select a retained reporting edition.');
 let retained=[];
 if(parent){
  const original=await api('crf.get',{kind:'crf.review',id:parent});
  if(original.edition_id!==next)throw Error('The previous review belongs to a different edition. Select its edition or no previous review before loading.');
  retained=await all('crf.rows',{kind:'crf.review',id:parent,section:'decisions'});
  if(retained.length!==original.decision_count)throw Error('The complete original review population differs.');
 }
 const found=await all('crf.rows',{kind:'crf.edition',id:next,section:'checks'});
 const allowed=new Set(found.map(row=>row.id)),combined=new Map();
 if(allowed.size!==found.length)throw Error('Original finding identities are not unique.');
 for(const decision of retained){if(!allowed.has(decision.check_id)||combined.has(decision.check_id))throw Error('Retained decision does not match the original finding population.');combined.set(decision.check_id,decision);}
 if(parent&&combined.size!==allowed.size)throw Error('The original review does not cover every original finding.');
 for(const[id,decision]of await readDecisions(next,parent))if(allowed.has(id))combined.set(id,decision);
 reviewId=next;reviewParentId=parent;reviewRows=found;decisions=combined;reviewOffset=0;
 adoptFiles([...combined.values()].flatMap(d=>d.evidence_files||[]));renderFiles();filterReview();
 say(parent?'Loaded the complete retained review and drafts for that exact parent.':'Loaded every original finding and unparented drafts.');
}
function filterReview(){
 const query=$('review-query').value.trim().toLowerCase();
 filteredReview=query?reviewRows.filter(row=>json(row).toLowerCase().includes(query)):reviewRows;reviewOffset=0;renderReview();
}
function renderReview(){
 const out=$('review-items');out.replaceChildren();
 $('review-count').textContent=reviewRows.length+' original findings · '+filteredReview.length+' match filter · '+decisions.size+' entered decisions · '+(filteredReview.length?reviewOffset+1:0)+'–'+Math.min(reviewOffset+20,filteredReview.length)+' shown';
 for(const record of filteredReview.slice(reviewOffset,reviewOffset+20)){
  const d=decisions.get(record.id)||{check_id:record.id,status:'open',note:'Not yet reviewed.',evidence_files:[]};
  const box=node('div',undefined,{class:'decision-row'}),left=node('div'),right=node('div');
  left.append(node('h3',(record.code||'Finding')+' · '+(record.family||record.id)),node('pre',json(record)));
  const status=node('select',undefined,{'aria-label':'Finding disposition'});for(const v of ['open','explained','corrected'])option(status,v,v);status.value=d.status;
  const note=node('textarea',undefined,{'aria-label':'Finding explanation'});note.value=d.note;
  const correction=node('select',undefined,{'aria-label':'Corrected descendant edition'});option(correction,'','No corrected edition');for(const r of collections.get('crf.edition')||[])option(correction,r.id,r.title+' · '+r.id);correction.value=d.correction_edition_id||'';
  const retained=node('p',(d.evidence_files||[]).length+' evidence files retained for this decision.',{class:'hint'}),freeze=node('button','Attach currently selected evidence',{type:'button'});
  const save=(selected=false)=>{const before=decisions.get(record.id)||d,value={check_id:record.id,status:status.value,note:note.value,evidence_files:selected?evidence():before.evidence_files};
   if(value.status==='corrected'&&correction.value)value.correction_edition_id=correction.value;
   decisions.set(record.id,value);retainDecision(reviewId,reviewParentId,value);retained.textContent=value.evidence_files.length+' evidence files retained for this decision.';
  };
  for(const el of [status,note,correction])el.oninput=()=>save();freeze.onclick=()=>save(true);
  for(const[label,control]of [['Disposition',status],['Reason',note],['Corrected descendant edition',correction]]){const l=node('label',label);l.append(control);right.append(l);}right.append(freeze,retained);box.append(left,right);out.append(box);
 }
 $('review-prev').disabled=reviewOffset===0;$('review-next').disabled=reviewOffset+20>=filteredReview.length;
}
async function saveReview(){
 if(!reviewId||$('review-selection').value!==reviewId||val('review-form','parent_id')!==reviewParentId)throw Error('Load the selected edition and exact previous review before saving.');
 const complete=reviewRows.map(row=>decisions.get(row.id)||{check_id:row.id,status:'open',note:'Not yet reviewed.',evidence_files:[]});
 const filename='crf-decisions-'+reviewId+'.json',retained=await stage(new Blob([JSON.stringify(complete)],{type:'application/json'}),filename,'decisions',false);
 const p=optional({title:val('review-form','title'),edition_id:reviewId,decisions_file:{sha256:retained.sha256,filename},review:reviewFields('review-form')},'parent_id',reviewParentId);
 const result=await mutate('crf.review.create',p);field('review-form','parent_id').value=result.id;await loadReview();saveDrafts();say('Saved complete review '+result.id+'. Later edits use this exact review as parent.');return result;
}
async function inspectTemplate(){
 const sha=$('template-file').value;if(!sha)throw Error('Select an actual retained workbook template.');
 const rows=[];let total,first;
 while(true){
  const page=await api('crf.workbook_preview',{file_sha256:sha,offset:rows.length,limit:500});
  if(page.sha256!==sha||!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||total!==undefined&&page.total!==total)throw Error('Original workbook inspection identity or population changed.');
  if(!first)first=page;total=page.total;rows.push(...page.rows);if(rows.length===total)break;
  if(!page.rows.length||rows.length>total)throw Error('Workbook inspection stopped before its complete cell population.');
 }
 const {rows:ignored,total:count,offset,limit,...metadata}=first;template=metadata;templateCells=rows;pickedCell=null;
 $('template-meta').textContent=json(metadata);const select=$('cell-sheet'),old=select.value;select.replaceChildren();option(select,'','All actual sheets');for(const sheet of metadata.sheets)option(select,sheet.name,sheet.name+' · '+sheet.state);select.value=[...select.options].some(o=>o.value===old)?old:'';
 filterCells();
 let draft;try{draft=parseObject(val('binding-form','bindings'),'Workbook binding');}catch{draft=null;}
 if(draft&&Object.keys(draft).length===0)startBinding();
 else say('Complete original workbook inspected. Existing binding draft is preserved; use Start new binding to replace it explicitly.');
}
function startBinding(){
 if(!template)throw Error('Inspect the original template first.');
 const b={schema:'commons.crf-workbook-bindings/v1',template_sha256:template.sha256,format:template.format,authority_reference:val('binding-form','authority_reference'),macro_policy:val('binding-form','macro_policy'),external_links_policy:val('binding-form','external_links_policy'),inputs:[],checks:[]};
 field('binding-form','bindings').value=json(b);field('binding-form','value_sources').value='{}';field('binding-form','parent_id').value='';saveDrafts();
 say('Started an empty explicit binding for the inspected original. Select actual input and check cells; none were guessed.');
}
function filterCells(){
 const sheet=$('cell-sheet').value,q=$('cell-query').value.trim().toLowerCase(),editable=$('cell-editable').checked;
 filteredCells=templateCells.filter(cell=>(!sheet||cell.sheet===sheet)&&(!editable||cell.editable)&&(!q||[cell.cell,cell.sheet,json(cell.value)].join(' ').toLowerCase().includes(q)));
 cellOffset=0;renderCells();
}
function renderCells(){
 $('cells').replaceChildren();$('cells-count').textContent=templateCells.length+' original cells · '+filteredCells.length+' match filter · '+(filteredCells.length?cellOffset+1:0)+'–'+Math.min(cellOffset+30,filteredCells.length)+' shown';
 for(const cell of filteredCells.slice(cellOffset,cellOffset+30)){
  const card=node('article',undefined,{class:'cell-card'});card.append(node('h3',cell.sheet+'!'+cell.cell),node('p',(cell.formula?'Formula · ':'')+(cell.effective_locked?'Locked on protected sheet':cell.locked?'Locked style, sheet unprotected':'Unlocked style')+(cell.editable?' · editable input':' · inspect only')));
  card.append(node('pre',json(cell.value)));const details=node('details'),summary=node('summary','Original cell and protection evidence');details.append(summary,node('pre',json(cell)));card.append(details);
  const buttons=node('div',undefined,{class:'toolbar'});
  for(const mode of ['input','check']){const b=node('button','Select '+mode,{type:'button'});if(mode==='input')b.disabled=!cell.editable;b.onclick=()=>{pickedCell={mode,cell};$('picked-cell').textContent='Selected '+mode+': '+cell.sheet+'!'+cell.cell+' · original '+cell.sha256;$('binding-type').value=['number','text','boolean','blank'].includes(cell.value.type)?cell.value.type:'text';$('binding-key').focus();};buttons.append(b);}card.append(buttons);$('cells').append(card);
 }
 $('cells-prev').disabled=cellOffset===0;$('cells-next').disabled=cellOffset+30>=filteredCells.length;
}
function addBinding(){
 if(!pickedCell||!template)throw Error('Select an inspected original cell.');
 const bindings=parseObject(val('binding-form','bindings'),'Workbook binding'),sources=parseObject(val('binding-form','value_sources'),'Input value sources');
 if(bindings.template_sha256!==template.sha256||!Array.isArray(bindings.inputs)||!Array.isArray(bindings.checks))throw Error('Use a complete binding for this actual inspected template.');
 const key=$('binding-key').value.trim(),cell=pickedCell.cell;if(!key)throw Error('Enter a unique explicit binding key.');
 if([...bindings.inputs,...bindings.checks].some(x=>x.key===key||x.sheet===cell.sheet&&x.cell===cell.cell))throw Error('This key or cell is already bound. Edit its retained JSON explicitly.');
 const item={key,sheet:cell.sheet,cell:cell.cell,expected_cell_sha256:cell.sha256};
 if(pickedCell.mode==='input'){
  if(!cell.editable)throw Error('This original cell is not an editable input.');
  item.value_type=$('binding-type').value;
  if($('binding-source-kind').value==='metric'){const metric=$('binding-metric').value.trim();if(!metric)throw Error('Select an exact actual metric identity.');sources[key]={metric_id:metric};}
  else{const literal=parseObject($('binding-literal').value,'Reviewed typed literal');if(literal.type!==item.value_type)throw Error('Literal type must match the selected input type.');sources[key]={literal};}
  bindings.inputs.push(item);
 }else{if($('binding-literal').value.trim())item.expected=parseObject($('binding-literal').value,'Expected observed cache');bindings.checks.push(item);}
 field('binding-form','bindings').value=json(bindings);field('binding-form','value_sources').value=json(sources);saveDrafts();say('Added actual '+pickedCell.mode+' cell '+cell.sheet+'!'+cell.cell+'.');
}
async function loadMetrics(){
 const id=$('metric-edition').value;if(!id)throw Error('Select an actual retained reporting edition.');
 const rows=await all('crf.rows',{kind:'crf.edition',id,section:'metrics'});$('metric-ids').replaceChildren();
 for(const row of rows)option($('metric-ids'),row.id,row.id+' · '+row.status+' · '+String(row.value));$('metric-catalogue').hidden=false;$('metric-catalogue').textContent=json(rows);
 say(rows.length+' actual metrics retained. Only complete selected metrics can populate output cells.');
}
function bindingFields(){
 const id='binding-form',v=n=>val(id,n),bindings=parseObject(v('bindings'),'Workbook binding');
 const file=files.find(f=>f.sha256===bindings.template_sha256&&f.purpose==='template');if(!file)throw Error('Retain the complete original template selected in this binding.');
 bindings.authority_reference=v('authority_reference');bindings.macro_policy=v('macro_policy');bindings.external_links_policy=v('external_links_policy');
 field(id,'bindings').value=json(bindings);
 return optional({title:v('title'),contract_id:v('contract_id'),file_sha256:file.sha256,filename:file.filename,bindings,value_sources:parseObject(v('value_sources'),'Input value sources'),review:reviewFields(id)},'parent_id',v('parent_id'));
}
function outputFields(){const p={};for(const name of ['title','binding_id','edition_id'])p[name]=val('output-form',name);return p;}
function returnFields(){const id='return-form',file=fileFor(id,'file_sha256','return');return {title:val(id,'title'),output_id:val(id,'output_id'),file_sha256:file.sha256,filename:file.filename,review:reviewFields(id),observations:parseObject(val(id,'observations'),'Actual native observations')};}
function downloadFile(file,label){return node('a',label||file.filename,{href:'/api/files/'+file.file_sha256+'?filename='+encodeURIComponent(file.filename)});}
function renderRecords(){
 const rows=collections.get($('record-kind').value)||[];if(recordOffset>=rows.length)recordOffset=Math.max(0,Math.floor(Math.max(0,rows.length-1)/50)*50);
 $('record-count').textContent=rows.length+' retained records · '+(rows.length?recordOffset+1:0)+'–'+Math.min(recordOffset+50,rows.length)+' shown';
 $('records-list').replaceChildren();for(const r of rows.slice(recordOffset,recordOffset+50)){const b=node('button',r.title+' · '+r.id);b.onclick=()=>invoke(()=>openRecord($('record-kind').value,r.id));$('records-list').append(b);}
 $('records-prev').disabled=recordOffset===0;$('records-next').disabled=recordOffset+50>=rows.length;
}
async function openRecord(kind,id){
 selectedRecord={kind,id};rowOffset=0;const record=await api('crf.get',{kind,id});$('record-json').textContent=json(record);
 $('selected-record').replaceChildren(node('h3',record.title));for(const format of ['csv','ndjson'])$('selected-record').append(node('a','Complete '+format.toUpperCase()+' export ',{href:'/api/exports?kind='+encodeURIComponent(kind)+'&id='+encodeURIComponent(id)+'&format='+format}));
 if(record.file_sha256&&record.filename)$('selected-record').append(downloadFile(record,'Download complete original '+record.filename));
 const sections=Object.keys(record.sections||{});$('row-section').replaceChildren();for(const section of sections)option($('row-section'),section,section+' · '+record.sections[section].rows+' rows');
 $('row-controls').hidden=sections.length===0;if(sections.length)await renderRows();
}
async function renderRows(){
 if(!selectedRecord)return;const p={...selectedRecord,section:$('row-section').value,offset:rowOffset,limit:50};optional(p,'query',$('row-query').value);optional(p,'status',$('row-status').value);
 const r=await api('crf.rows',p);$('rows').replaceChildren(node('p',r.total+' retained rows · '+(r.total?r.offset+1:0)+'–'+(r.offset+r.rows.length)+' shown'));
 for(const row of r.rows)$('rows').append(node('pre',json(row)));
 $('rows-prev').disabled=rowOffset===0;$('rows-next').disabled=rowOffset+r.rows.length>=r.total;
}
function renderDeliveries(){
 $('deliveries').replaceChildren();for(const d of deliveries){const line=node('p');line.append(node('a',d.title||d.id,{href:'/api/deliveries/'+encodeURIComponent(d.id)}));$('deliveries').append(line);}
}
function tab(id,persist=true){for(const e of document.querySelectorAll('.tab'))e.hidden=e.id!==id;for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-current',String(b.dataset.tab===id));if(persist)saveDrafts();}

for(const b of document.querySelectorAll('nav button'))b.onclick=()=>invoke(async()=>tab(b.dataset.tab));
for(const[id,op,build]of [['contract-form','crf.contract.create',contractFields],['dataset-form','crf.dataset.create',datasetFields],['edition-form','crf.edition.create',editionFields],['comparison-form','crf.comparison.create',comparisonFields],['binding-form','crf.workbook_binding.create',bindingFields],['return-form','crf.workbook_return.create',returnFields]])$(id).onsubmit=e=>{e.preventDefault();invoke(async()=>{const result=await mutate(op,await build());$('record-kind').value=op.slice(0,-7);renderRecords();await openRecord(op.slice(0,-7),result.id);});};
$('output-form').onsubmit=e=>{e.preventDefault();invoke(async()=>{const result=await mutate('crf.workbook_output.create',outputFields());$('workbook-download').replaceChildren(downloadFile(result,'Download prepared workbook '+result.filename),node('p','Open and recalculate in the authorised native application. The retained formula caches are historical.'));});};
$('upload-form').onsubmit=e=>{e.preventDefault();invoke(upload);};$('review-form').onsubmit=e=>{e.preventDefault();invoke(saveReview);};
$('delivery-form').onsubmit=e=>{e.preventDefault();invoke(async()=>{const r=await mutate('delivery.prepare',{title:'Complete CRF reporting handover',note:val('delivery-form','note')});const p=node('p');p.append(node('a','Download complete editable application and workspace',{href:'/api/deliveries/'+encodeURIComponent(r.id)}));$('deliveries').prepend(p);});};
$('refresh').onclick=()=>invoke(refresh);$('preview-source').onclick=()=>invoke(previewSource);
for(const el of [$('dataset-contract'),$('dataset-family'),$('dataset-file')])el.onchange=()=>{$('mapping').replaceChildren();$('preview').hidden=true;saveDrafts();say('Original source selection changed. Inspect its columns and review the retained mapping before saving.');};
$('load-contract').onclick=()=>invoke(async()=>{const r=await api('crf.get',{kind:'crf.contract',id:$('contract-copy').value});for(const name of ['scope_id','authority_name','authority_type','financial_year','recognition_basis','repeat_count_basis'])field('contract-form',name).value=r.contract[name];field('contract-form','title').value=r.title;field('contract-form','parent_id').value=r.id;field('contract-form','role').value=r.contract.review.role;field('contract-form','note').value='';saveDrafts();say('Copied the retained original into a later contract draft. Review its sources before saving.');});
$('load-binding').onclick=()=>invoke(async()=>{
 const r=await api('crf.get',{kind:'crf.workbook_binding',id:$('binding-copy').value});for(const name of ['title','contract_id'])field('binding-form',name).value=r[name];
 for(const name of ['authority_reference','macro_policy','external_links_policy'])field('binding-form',name).value=r.bindings[name];
 field('binding-form','bindings').value=json(r.bindings);field('binding-form','value_sources').value=json(r.value_sources);field('binding-form','parent_id').value=r.id;field('binding-form','role').value=r.review.role;field('binding-form','note').value='';
 $('template-file').value=r.file_sha256;await inspectTemplate();saveDrafts();say('Copied the exact retained binding into a later draft; original input and check identities remain.');
});
$('load-review').onclick=()=>invoke(loadReview);field('review-form','parent_id').onchange=()=>invoke(loadReview);
$('review-selection').onchange=()=>{say('Edition selection changed. Load the selected edition and its exact previous review before editing or saving.');};
$('filter-review').onclick=()=>invoke(async()=>filterReview());
$('review-prev').onclick=()=>invoke(async()=>{reviewOffset=Math.max(0,reviewOffset-20);renderReview();});$('review-next').onclick=()=>invoke(async()=>{reviewOffset+=20;renderReview();});
$('inspect-template').onclick=()=>invoke(inspectTemplate);$('new-binding').onclick=()=>invoke(async()=>startBinding());
$('filter-cells').onclick=()=>invoke(async()=>filterCells());$('cells-prev').onclick=()=>invoke(async()=>{cellOffset=Math.max(0,cellOffset-30);renderCells();});$('cells-next').onclick=()=>invoke(async()=>{cellOffset+=30;renderCells();});
$('add-binding').onclick=()=>invoke(async()=>addBinding());$('load-metrics').onclick=()=>invoke(loadMetrics);
$('record-kind').onchange=()=>{recordOffset=0;renderRecords();};$('records-prev').onclick=()=>{recordOffset=Math.max(0,recordOffset-50);renderRecords();};$('records-next').onclick=()=>{recordOffset+=50;renderRecords();};
$('search-rows').onclick=()=>invoke(async()=>{rowOffset=0;await renderRows();});$('row-section').onchange=()=>invoke(async()=>{rowOffset=0;await renderRows();});$('rows-prev').onclick=()=>invoke(async()=>{rowOffset=Math.max(0,rowOffset-50);await renderRows();});$('rows-next').onclick=()=>invoke(async()=>{rowOffset+=50;await renderRows();});
$('verify').onclick=()=>invoke(async()=>{const result=await api('crf.verify');$('record-json').textContent=json(result);tab('records');say('Full retained CRF record dependency closure verified.');});


$('inspect-pending').onclick=()=>invoke(inspectPending);
$('retry-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;
 const found=await api('operation.get',{id:pending.payload.operation_id});
 if(found.found)return inspectPending();
 const r=await api(pending.operation,pending.payload,true);
 clearPending();await refresh();say('Original unadmitted request completed. '+json(r));
});
$('return-draft').onclick=()=>invoke(async()=>{
 if(!pending)return;
 const original=await api('operation.get',{id:pending.payload.operation_id});let disposition=null;
 if(original.found){
  if(original.operation.status==='SUCCEEDED')return inspectPending();
  if(!pending.operation.startsWith('crf.'))return inspectPending();
  disposition=await api('crf.request_status',{operation_id:pending.payload.operation_id});
  if(disposition.can_return_to_draft!==true)return inspectPending();
 }
 const archived=JSON.parse(sessionStorage.getItem(key('returned-requests'))||'[]');
 archived.push({request:pending,observed:original,disposition,returned_at:new Date().toISOString()});
 sessionStorage.setItem(key('returned-requests'),json(archived));
 clearPending();await refresh();
 say(original.found?'The original rejected request, error and current no-effect disposition remain in session history and the operation journal. Correct the retained draft and save a new request.':'The unadmitted original request remains in session history. Review the retained draft and save a new request at the current revision.');
});
$('resume-pending').onclick=()=>invoke(async()=>{
 if(!pending)return;
 const targetId=pending.payload.operation_id;
 let original=await api('operation.get',{id:targetId});
 if(!original.found||original.operation.status==='SUCCEEDED')return inspectPending();
 if(pending.operation.startsWith('crf.')){
  const disposition=await api('crf.request_status',{operation_id:targetId});
  if(disposition.can_return_to_draft===true)return inspectPending();
 }
 if(original.operation.status!=='INTERRUPTED'){
  await inspectPending();say('The original target has no confirmed interrupted disposition. Its existing request remains retained; no new continuation was dispatched.');return;
 }
 let prior=null,replaceReason=null;
 if(pending.resume){
  prior=await api('operation.get',{id:pending.resume.operation_id});
  if(prior.found&&prior.operation.status==='SUCCEEDED')return inspectPending();
  if(prior.found&&prior.operation.status!=='INTERRUPTED'){
   await inspectPending();say('The original continuation is still running or has an unknown disposition. Its exact identity remains retained; inspect it again when a result is available.');return;
  }
  if(prior.found)replaceReason='The prior continuation control and original target are both confirmed interrupted.';
  else{
   const current=await readState();
   if(pending.resume.expected_revision!==current.project.revision)replaceReason='The unadmitted continuation control has a stale expected workspace revision and cannot be admitted at this revision.';
  }
 }
 // Re-read the original target immediately before preparing any new control.
 original=await api('operation.get',{id:targetId});
 if(!original.found||original.operation.status!=='INTERRUPTED')return inspectPending();
 if(replaceReason&&pending.resume){
  const latest=await api('operation.get',{id:pending.resume.operation_id});
  if(latest.found&&latest.operation.status!=='INTERRUPTED')return inspectPending();
  prior=latest;
 }
 if(!pending.resume||replaceReason){
  const current=await readState(),history=[...(pending.resume_history||[])];
  if(pending.resume)history.push({request:pending.resume,observed:prior,original_target:original,reason:replaceReason,archived_at:new Date().toISOString()});
  const next={...pending,resume_history:history,resume:{operation_id:'crf-resume-'+crypto.randomUUID(),actor:actor(),expected_revision:current.project.revision,target_operation_id:targetId,reason:'Operator explicitly continues the same original CRF target after reviewing its retained interrupted result.'}};
  // Publish history and new control intent durably before changing the live
  // pointer or dispatching. No existing original target/control is overwritten.
  sessionStorage.setItem(key('pending'),json(next));pending=next;pendingView();
 }
 const beforeDispatch=await api('operation.get',{id:targetId});
 if(!beforeDispatch.found||beforeDispatch.operation.status!=='INTERRUPTED')return inspectPending();
 await api('operation.resume',pending.resume,true);await inspectPending();
});

for(const kind of kinds)option($('record-kind'),kind,kind.slice(4).replaceAll('_',' '));
invoke(async()=>{
 schemaInfo=await api('crf.schema');$('schema').textContent=json(schemaInfo);loadFamilies();
 for(const[id,period]of Object.entries(schemaInfo.periods))option($('edition-period'),id,id+' · '+(period.start||period[0]||'')+' to '+(period.end||period[1]||''));
 await refresh();pending=JSON.parse(sessionStorage.getItem(key('pending'))||'null');pendingView();tab('contract',false);restoreDrafts();renderFiles();
 try{const retainedBinding=parseObject(val('binding-form','bindings'),'Binding');if(retainedBinding.template_sha256)$('template-file').value=retainedBinding.template_sha256;}catch{}
 for(const event of ['input','change'])document.addEventListener(event,()=>{try{saveDrafts();}catch(error){say('Draft could not be retained: '+error.message,true);}});
 if(pending)await inspectPending();else say('Workspace open. Begin with the reviewed scope and complete original sources.');
});
