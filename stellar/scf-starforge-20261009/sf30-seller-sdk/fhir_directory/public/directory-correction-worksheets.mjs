// MIT. Whole original-row worksheets and explicit returned-file review.
const KINDS=['correctionWorksheets','correctionWorksheetImports','correctionWorksheetReturns','correctionWorksheetReviews'];
const SHA=/^[0-9a-f]{64}$/,WORKING='stellar-forge.directory-correction-worksheet-working-operator.v1';
const refKeys=['sourceId','recordId','rowSha256','resourceSha256','memberSha256'];
const clone=x=>JSON.parse(JSON.stringify(x)),enc=encodeURIComponent;
function need(v,m){if(!v)throw new Error(m);}
function obj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function el(tag,attrs={},children=[]){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){
 if(v===null||v===undefined)continue;if(k==='text')n.textContent=String(v);else if(k==='class')n.className=v;
 else if(['disabled','checked','readOnly'].includes(k))n[k]=!!v;else n.setAttribute(k,String(v));}
 for(const x of [].concat(children))if(x!==null&&x!==undefined)n.append(x instanceof Node?x:document.createTextNode(String(x)));return n;}
function json(x){return JSON.stringify(x,null,2);}
function saveJSON(x,name){const u=URL.createObjectURL(new Blob([json(x)+'\n'],{type:'application/json'}));const a=el('a',{href:u,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function refOf(row){const ref={};for(const key of refKeys){need(SHA.test(row[key]||''),'Keep the exact original '+key);ref[key]=row[key];}return ref;}
function validateWorking(v,workspaceId){
 need(obj(v)&&v.schema===WORKING&&v.workspaceId===workspaceId,'Choose the complete working worksheet for this workspace.');
 for(const k of ['editionId','label','actor','note','query','table','worksheetId','intakeNote','reviewLabel','reviewNote'])
  need(typeof v[k]==='string','Keep complete working text '+k+'.');
 for(const k of ['editionId','worksheetId'])need(v[k]===''||SHA.test(v[k]),'Keep the original '+k+'.');
 need(v.predecessorId===null||SHA.test(v.predecessorId||''),'Keep the original accepted predecessor or null.');
 need(Array.isArray(v.rows)&&v.rows.length<=10000,'Keep the complete selected row list.');
 const seen=new Set();for(const row of v.rows){refOf(row);const k=row.sourceId+'/'+row.recordId;need(!seen.has(k),'Keep unique original rows.');seen.add(k);}
 need(obj(v.choices),'Keep complete explicit review choices.');
 for(const[k,x]of Object.entries(v.choices))need(SHA.test(k)&&obj(x)&&['','accept','keep-original'].includes(x.decision)&&typeof x.reason==='string','Keep each exact choice and reason.');
 need((v.openKind===null&&v.openId===null)||(KINDS.includes(v.openKind)&&SHA.test(v.openId||'')),'Keep one complete original record selection.');
 if(v.pending!==null){need(obj(v.pending)&&['prepare','export','import','receive','review'].includes(v.pending.action)&&obj(v.pending.body),'Keep the complete pending original request.');
  if(v.pending.action==='receive')need(SHA.test(v.pending.body.importId||'')&&SHA.test(v.pending.body.sha256||'')&&Number.isSafeInteger(v.pending.body.bytes),'Keep the original upload binding.');}
 need(new TextEncoder().encode(JSON.stringify(v)).length<=33554432,'Working worksheet exceeds32MiB.');
 return v;
}
export function mountDirectoryCorrectionWorksheets({root,api,download,readCompleteFile,getState,notify=()=>{},openCorrection=()=>{},openReconciliation=()=>{}}){
 need(root&&api&&download&&readCompleteFile&&getState,'Use the original Directory operator and complete-file transport.');
 const S={workspaceId:null,busy:false,disposed:false,dirty:false,error:'',message:'',storageError:'',
  editionId:'',edition:null,label:'',actor:'',note:'',predecessorId:null,rows:[],query:'',table:'',
  rowPage:null,rowOffset:0,worksheetId:'',intakeNote:'',upload:null,uploadIdentity:null,
  reviewLabel:'',reviewNote:'',choices:{},openKind:null,openId:null,record:null,changePage:null,changeOffset:0,
  completeRows:null,completeFile:null,pending:null,lastResponse:null,view:'prepare',libraryKind:'correctionWorksheets',libraryPage:null};
 let generation=0;
 const originalApi=api,originalDownload=download,originalRead=readCompleteFile;
 function current(g=generation){if(S.disposed||g!==generation){const e=new Error('Worksheet view closed; reopen its retained original request.');e.name='AbortError';throw e;}}
 async function observed(fn){const g=generation;current(g);const v=await fn();current(g);return v;}
 api=(...a)=>observed(()=>originalApi(...a));download=(...a)=>observed(()=>originalDownload(...a));readCompleteFile=(...a)=>observed(()=>originalRead(...a));
 const path=(...parts)=>'/api/directory/'+parts.map(enc).join('/');
 const key=()=> 'directory.worksheet.working.'+S.workspaceId;
 function working(){return {schema:WORKING,workspaceId:S.workspaceId,...Object.fromEntries(
  ['editionId','label','actor','note','predecessorId','rows','query','table','worksheetId','intakeNote','reviewLabel','reviewNote','choices','openKind','openId','pending'].map(k=>[k,clone(S[k])]))};}
 function persist(){if(S.disposed||!S.workspaceId)return;try{sessionStorage.setItem(key(),JSON.stringify(working()));S.storageError='';}catch{S.storageError='Browser storage is full. Download the complete working JSON before leaving.';}}
 function changed(){current();S.dirty=true;persist();}
 function freeze(){root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=true);}
 async function task(fn){if(S.busy||S.disposed)return;const g=generation;S.busy=true;S.error='';freeze();
  try{return await fn();}catch(e){if(!S.disposed&&g===generation&&e.name!=='AbortError'){S.error=e.message;notify(e.message,'error');}}
  finally{if(!S.disposed&&g===generation){S.busy=false;persist();render();}}}
 function button(text,fn,test){const n=el('button',{type:'button','data-testid':test,disabled:S.busy},text);n.onclick=()=>task(fn);return n;}
 function field(label,value,set,{test,multiline=false,readonly=false}={}){
  const n=el(multiline?'textarea':'input',{'data-testid':test,value:multiline?undefined:value,readOnly:readonly,rows:multiline?4:undefined});
  if(multiline)n.value=value;n.oninput=()=>{if(S.busy||S.disposed)return;set(n.value);changed();};
  return el('label',{class:'dws-field'},[el('span',{},label),n]);}
 function select(label,value,options,set,test){const n=el('select',{'data-testid':test});
  for(const [v,t]of options)n.append(el('option',{value:v},t));n.value=value;n.onchange=()=>{if(S.busy||S.disposed)return;set(n.value);changed();};
  return el('label',{class:'dws-field'},[el('span',{},label),n]);}
 function panel(title,children=[]){return el('section',{class:'dws-panel'},[el('h2',{},title),...children]);}
 function metadata(value){const d=el('dl',{class:'dws-metadata'});for(const[k,v]of Object.entries(value))d.append(el('dt',{},k),el('dd',{},v===null?'None':typeof v==='object'?json(v):String(v??'')));return d;}
 function table(columns,rows){return el('div',{class:'dws-scroll'},el('table',{},[
  el('thead',{},el('tr',{},columns.map(x=>el('th',{scope:'col'},x[0])))),
  el('tbody',{},rows.map(r=>el('tr',{},columns.map(x=>el('td',{},x[1](r))))))]));}
 function details(label,value){return el('details',{},[el('summary',{},label),el('pre',{},typeof value==='string'?value:json(value))]);}
 function pager(p,load){if(!p)return el('div');return el('div',{class:'dws-actions'},[
  el('span',{},p.total+' complete rows · '+p.offset+'–'+(p.offset+p.rows.length)),
  ...(p.offset>0?[button('Previous',()=>load(Math.max(0,p.offset-p.limit)))]:[]),
  ...(p.nextOffset!==null?[button('Next',()=>load(p.nextOffset))]:[])]);}
 async function page(url,check=()=>{}){const p=await api(url);need(Array.isArray(p.rows)&&Number.isSafeInteger(p.total)&&p.total>=0&&
  Number.isSafeInteger(p.offset)&&Number.isSafeInteger(p.limit)&&p.limit>=1&&p.rows.length<=p.limit,'Invalid original page.');
  const next=p.offset+p.rows.length;need(next<=p.total&&(p.nextOffset===null?next===p.total:p.rows.length>0&&p.nextOffset===next&&next<p.total),'Original page omitted rows.');check(p);return p;}
 async function loadEdition(id){
  need(SHA.test(id),'Select an exact source edition.');need(!S.rows.length||id===S.edition?.id,'Keep the selected worksheet basis; remove its rows before changing editions.');
  const edition=await api(path('editions',id));need(edition.id===id&&Array.isArray(edition.sourceIds),'Original edition identity changed.');
  S.editionId=id;S.edition=edition;S.rowPage=null;S.rowOffset=0;
 }
 async function loadRows(offset=0){
  need(S.edition?.id===S.editionId,'Open the exact worksheet edition.');
  const q=new URLSearchParams({offset:String(offset),limit:'25',query:S.query});if(S.table)q.set('table',S.table);
  S.rowPage=await page(path('editions',S.editionId,'rows')+'?'+q);S.rowOffset=offset;
 }
 async function chooseRow(row){
  need(S.edition?.id===S.editionId,'Open the exact worksheet edition.');
  const full=await api(path('editions',S.editionId,'rows',row.sourceId,row.recordId));
  need(full.protocol==='hsds','Select an original HSDS row, including HSDS rows in a derived capture.');
  const ref=refOf(full);need(!S.rows.some(x=>x.sourceId===ref.sourceId&&x.recordId===ref.recordId),'This exact row is already selected.');
  need(S.rows.length<10000,'A worksheet retains at most10,000 complete rows.');S.rows.push(ref);changed();
 }
 function prepareInput(){need(S.edition?.id===S.editionId&&S.label.trim()&&S.actor.trim()&&S.rows.length,'Open an edition, select complete rows, and supply label and actor.');
  return {label:S.label,editionId:S.editionId,actor:S.actor,note:S.note,predecessorId:S.predecessorId,rows:clone(S.rows)};}
 async function openRecord(kind,id,{replaceChoices=true}={}){
  need(KINDS.includes(kind)&&SHA.test(id),'Select an exact worksheet record.');
  const r=await api(path(kind,id));need(r.id===id&&r.workspaceId===S.workspaceId,'Original worksheet record identity changed.');
  S.openKind=kind;S.openId=id;S.record=r;S.changePage=null;S.completeRows=null;S.completeFile=null;S.changeOffset=0;
  if(replaceChoices)S.choices={};S.view='review';
  if(kind==='correctionWorksheets')S.worksheetId=id;else if(r.worksheetId)S.worksheetId=r.worksheetId;
  if(kind!=='correctionWorksheetImports')await readChanges(0);
 }
 async function readChanges(offset=0){
  need(S.openKind&&S.openId,'Open an original worksheet record.');
  if(S.completeRows){const rows=S.completeRows.slice(offset,offset+25);S.changePage={kind:S.openKind,recordId:S.openId,rows,total:S.completeRows.length,offset,limit:25,nextOffset:offset+rows.length<S.completeRows.length?offset+rows.length:null};}
  else S.changePage=await page(path(S.openKind,S.openId,'rows')+'?offset='+offset+'&limit=25',
   p=>need(p.kind===S.openKind&&p.recordId===S.openId,'Original worksheet page identity changed.'));
  S.changeOffset=offset;
 }
 async function loadFullRows(){
  need(S.record,'Open an original record.');const fileKind={correctionWorksheets:'rows',correctionWorksheetReturns:'changes',correctionWorksheetReviews:'decisions'}[S.openKind];
  need(fileKind&&S.record.files?.[fileKind],'This record has no complete row file.');
  const descriptor=S.record.files[fileKind],received=await readCompleteFile(path(S.openKind,S.openId,'files',fileKind),descriptor);
  const text=await observed(()=>received.blob.text()),lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
  need(lines.every(x=>x.length>0),'Complete original JSONL contains an empty row.');const rows=lines.map(x=>JSON.parse(x));
  const total=fileKind==='rows'?S.record.summary.rows:S.record.summary.changes;
  need(rows.length===total,'Complete original row count differs from the native record.');
  if(fileKind!=='rows'){const seen=new Set();for(const r of rows){need(SHA.test(r.changeId||'')&&!seen.has(r.changeId),'Complete change IDs are invalid or duplicated.');seen.add(r.changeId);}}
  S.completeRows=rows;S.completeFile={fileKind,...descriptor};await readChanges(0);S.message='Complete original '+fileKind+' received and verified; every row is available.';
 }
 async function perform(action,body,file=null){
  const wanted={action,body:clone(body)};
  if(S.pending)need(JSON.stringify(S.pending)===JSON.stringify(wanted),'Reconcile the original pending request before another write.');
  else{S.pending=wanted;persist();}
  let result;
  if(action==='receive'){
   need(file&&file.size===body.bytes,'Reselect the complete original returned file.');
   const receivedHash=await observed(()=>digest(file));need(receivedHash===body.sha256,'Selected file differs from the original pending upload.');
   result=await api(path('correction-worksheets','imports',body.importId,'content'),{method:'PUT',body:file,headers:{'Content-Type':'application/json'}});
  }else{
   const suffix=action==='import'?'imports':action;
   result=await api(path('correction-worksheets',suffix),{method:'POST',body});
  }
  need(obj(result)&&SHA.test(result.id||''),'Native worksheet operation returned no immutable identity.');
  S.lastResponse={action,body:clone(body),recordId:result.id};S.pending=null;persist();
  const kind={prepare:'correctionWorksheets',import:'correctionWorksheetImports',receive:'correctionWorksheetReturns',review:'correctionWorksheetReviews'}[action];
  if(action==='export'){S.message='Complete portable customer package retained.';await download(path('exports',result.id,'file'));}
  else{await openRecord(kind,result.id);S.message=action==='review'?(result.planId?'Explicit decisions prepared the original correction plan. Open it to review its separate preview and acceptance.':'Every proposed change was kept original. No correction plan was created.'):'Complete native '+action+' saved.';}
  if(action==='prepare'||action==='review')S.dirty=false;persist();return result;
 }
 async function digest(file){const raw=await file.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function selectFile(file){
  need(file&&file.size>=2&&file.size<=33554432,'Choose the entire returned JSON file within32MiB.');
  const sha256=await observed(()=>digest(file));S.upload=file;S.uploadIdentity={filename:file.name,bytes:file.size,sha256};S.message='Original returned file selected; its raw bytes will be retained.';changed();
 }
 async function importUpload(){
  need(SHA.test(S.worksheetId)&&S.actor.trim()&&S.upload&&S.uploadIdentity,'Choose a worksheet, actor and complete returned file.');
  const identity=clone(S.uploadIdentity),file=S.upload;
  const record=await perform('import',{worksheetId:S.worksheetId,actor:S.actor,filename:identity.filename,
   expectedSha256:identity.sha256,expectedBytes:identity.bytes,note:S.intakeNote});
  return perform('receive',{importId:record.id,bytes:identity.bytes,sha256:identity.sha256},file);
 }
 function reviewInput(){
  need(S.openKind==='correctionWorksheetReturns'&&S.record,'Open an original returned file comparison.');
  const choices=Object.entries(S.choices).map(([changeId,v])=>({changeId,...clone(v)}));
  need(choices.length===S.record.summary.changes&&choices.every(v=>['accept','keep-original'].includes(v.decision)&&v.reason.trim()),
   'Give every proposed change exactly one explicit decision and reason.');
  need(S.reviewLabel.trim()&&S.actor.trim(),'Supply the review label and actor.');
  return {returnId:S.openId,label:S.reviewLabel,actor:S.actor,note:S.reviewNote,choices};
 }
 async function restoreWorking(value){
  const v=clone(validateWorking(value,S.workspaceId));if(S.dirty&&!confirm('Replace the current working worksheet with this complete validated working file?'))return;
  const edition=v.editionId?await api(path('editions',v.editionId)):null;
  need(!edition||edition.id===v.editionId,'Restored edition differs.');
  const record=v.openId?await api(path(v.openKind,v.openId)):null;
  need(!record||record.id===v.openId&&record.workspaceId===S.workspaceId,'Restored original record differs.');
  for(const[k,x]of Object.entries(v))if(k!=='schema'&&k!=='workspaceId')S[k]=x;
  S.edition=edition;S.record=record;S.rowPage=null;S.changePage=null;S.completeRows=null;S.upload=null;S.uploadIdentity=null;
  S.view=record?'review':'prepare';S.dirty=true;persist();
  if(record&&v.openKind!=='correctionWorksheetImports')await readChanges(0);
 }
 async function library(kind=S.libraryKind,offset=0){S.libraryPage=await page(path(kind)+'?offset='+offset+'&limit=25');S.libraryKind=kind;S.view='history';}
 function filesPanel(){
  if(!S.record)return el('div');const r=S.record,k=S.openKind;
  const keys=Object.keys(r.files||{});if(k==='correctionWorksheets')keys.push('worksheet');
  return panel('Complete original files',[
   el('div',{class:'dws-actions'},keys.map(f=>button('Download '+f,()=>download(path(k,r.id,'files',f)),'dws-file-'+f))),
   ...(['correctionWorksheets','correctionWorksheetReturns','correctionWorksheetReviews'].includes(k)?[
    button('Receive complete row file',loadFullRows,'dws-full-rows'),
    el('p',{},'Use this complete byte-verified JSONL when an individual original value exceeds the 4MiB page budget. No fields are shortened.')]:[]),
   details('Complete immutable native record',r)]);
 }
 function prepareView(){
  const box=panel('Choose original rows',[
   field('Frozen edition ID',S.editionId,v=>{S.editionId=v;S.edition=null;},{test:'dws-edition',readonly:!!S.rows.length}),
   button('Open edition',async()=>{await loadEdition(S.editionId);await loadRows(0);},'dws-open-edition'),
   button('Browse saved editions',()=>library('editions',0)),
   ...(S.edition?[metadata({Label:S.edition.label,Edition:S.edition.id,Sources:S.edition.sourceIds.length}),
    el('div',{class:'dws-grid'},[field('Table',S.table,v=>S.table=v,{test:'dws-table'}),field('Original row search',S.query,v=>S.query=v,{test:'dws-query'})]),
    button('Read original rows',()=>loadRows(0),'dws-read-rows')]:[])]);
  if(S.rowPage)box.append(table([['Table',r=>r.table],['Original location',r=>r.memberName+' '+(r.pointer||'')],
   ['Native ID',r=>r.nativeId??''],['Select',r=>button('Add whole row',()=>chooseRow(r),'dws-row-'+r.recordId)]],S.rowPage.rows),pager(S.rowPage,loadRows));
  const selected=panel('Complete selected rows',[el('p',{},S.rows.length+' rows selected. Each row keeps its exact source, record and three original hashes.'),
   table([['Source',r=>el('code',{},r.sourceId)],['Record',r=>el('code',{},r.recordId)],['Selection',r=>button('Remove',()=>{S.rows=S.rows.filter(x=>x!==r);changed();})]],S.rows),
   el('div',{class:'dws-grid'},[field('Worksheet label',S.label,v=>S.label=v,{test:'dws-label'}),field('Actor',S.actor,v=>S.actor=v,{test:'dws-actor'})]),
   field('Note',S.note,v=>S.note=v,{test:'dws-note',multiline:true}),
   field('Accepted correction predecessor (optional)',S.predecessorId||'',v=>S.predecessorId=v||null,{test:'dws-predecessor'}),
   button('Prepare complete worksheet',()=>perform('prepare',prepareInput()),'dws-prepare')]);
  return [box,selected];
 }
 function intakeView(){
  const input=el('input',{type:'file',accept:'.json,application/json','data-testid':'dws-return-file'});
  input.onchange=()=>task(()=>selectFile(input.files[0]));
  return [panel('Receive original returned file',[
   field('Worksheet ID',S.worksheetId,v=>S.worksheetId=v,{test:'dws-worksheet-id'}),
   field('Intake actor',S.actor,v=>S.actor=v,{test:'dws-intake-actor'}),
   field('Intake note',S.intakeNote,v=>S.intakeNote=v,{test:'dws-intake-note',multiline:true}),
   el('label',{class:'dws-field'},[el('span',{},'Complete customer returned JSON'),input]),
   ...(S.uploadIdentity?[metadata(S.uploadIdentity)]:[]),
   button('Save intake and receive original file',importUpload,'dws-receive'),
   el('p',{},'The exact uploaded bytes remain retained. The customer’s authorship and timestamp are recorded as supplied. Intake creates a comparison; it does not accept any change.')])];
 }
 function presence(x){return el('div',{class:'dws-value'},[
  el('strong',{},x.present?'Present · '+(x.type||'value'):'Absent'),
  ...(x.present?[details('Complete original value',x.valueJson??'')]:[])]);}
 function decision(row){
  const value=S.choices[row.changeId]??{decision:'',reason:''};
  const update=(k,v)=>{S.choices[row.changeId]={...(S.choices[row.changeId]??{decision:'',reason:''}),[k]:v};};
  return el('div',{class:'dws-decision'},[
   select('Explicit decision',value.decision,[['','Choose for this change'],['accept','Accept proposed value'],['keep-original','Keep original value']],v=>update('decision',v),'dws-decision-'+row.changeId),
   field('Operator reason',value.reason,v=>update('reason',v),{test:'dws-reason-'+row.changeId,multiline:true})]);
 }
 function reviewView(){
  if(!S.record)return [panel('Open a saved worksheet',[button('Browse saved records',()=>library())])];
  const r=S.record,k=S.openKind,box=panel('Original '+k,[metadata({ID:r.id,Edition:r.editionId,Worksheet:r.worksheetId??r.id,Actor:r.actor,Summary:r.summary})]);
  if(k==='correctionWorksheets')box.append(
   button('Download portable customer package',()=>perform('export',{worksheetId:r.id,actor:S.actor||r.actor}),'dws-export'),
   button('Receive a returned file',()=>{S.worksheetId=r.id;S.view='intake';},'dws-open-intake'));
  if(k==='correctionWorksheetImports')box.append(el('p',{},'Reselect the original file and continue this saved intake.'),
   button('Use this saved intake',()=>{const wanted={action:'receive',body:{importId:r.id,bytes:r.expectedBytes,sha256:r.expectedSha256}};need(!S.pending||JSON.stringify(S.pending)===JSON.stringify(wanted),'Reconcile the exact original pending request before selecting another saved intake.');need(SHA.test(r.expectedSha256||'')&&Number.isSafeInteger(r.expectedBytes),'Choose a byte-bound intake, or select the complete file and save exact intake metadata.');S.pending=wanted;S.worksheetId=r.worksheetId;S.view='intake';persist();},'dws-use-import'));
  if(k==='correctionWorksheetReturns')box.append(button('Review against current edition',()=>openReconciliation(r.id),'dws-three-way-review'),metadata({ReturnedBy:r.returnedBy,ReturnedAt:r.returnedAt,CustomerNote:r.note}),
   field('Review label',S.reviewLabel,v=>S.reviewLabel=v,{test:'dws-review-label'}),
   field('Review actor',S.actor,v=>S.actor=v,{test:'dws-review-actor'}),
   field('Review note',S.reviewNote,v=>S.reviewNote=v,{test:'dws-review-note',multiline:true}),
   el('p',{},Object.values(S.choices).filter(x=>x.decision&&x.reason.trim()).length+' / '+r.summary.changes+' complete explicit decisions'),
   button('Save explicit decisions and prepare plan',()=>perform('review',reviewInput()),'dws-review'));
  if(k==='correctionWorksheetReviews')box.append(el('p',{},r.planId?'The reviewed plan is prepared. Preview and acceptance remain separate explicit actions.':'No edits selected; the complete original edition is retained.'),
   ...(r.planId?[button('Open prepared correction plan',()=>openCorrection(r.planId),'dws-open-plan')]:[]));
  if(S.changePage){const rows=S.changePage.rows;
   if(k==='correctionWorksheets')box.append(table([['Table',x=>x.table],['Original location',x=>x.memberName+' '+x.pointer],
    ['Exact row key',x=>el('code',{},x.rowKey)],['Complete original',x=>details('Read original whole row',x)]],rows));
   else box.append(table([['Original row',x=>el('div',{},[el('code',{},x.rowKey),el('p',{},x.table+' · '+x.memberName),el('p',{},x.pointer!==undefined?'JSON '+x.pointer:x.column!==undefined?'Physical column '+x.column:x.action),details('Exact original reference',x.ref)])],
    ['Before',x=>presence(x.before)],['Proposed after',x=>presence(x.after)],
    ['Reason',x=>el('div',{},[el('p',{},x.reason),details('Complete change',x)])],
    ['Decision',x=>k==='correctionWorksheetReturns'?decision(x):x.decision]],rows));
   box.append(pager(S.changePage,readChanges));
  }
  return [box,filesPanel()];
 }
 function historyView(){
  const box=panel('Retained worksheet history',[select('Collection',S.libraryKind,KINDS.map(k=>[k,k]),v=>S.libraryKind=v,'dws-library-kind'),
   button('Read records',()=>library(S.libraryKind,0),'dws-read-library')]);
  if(S.libraryPage)box.append(table([['Label / kind',r=>r.label||r.schema||S.libraryKind],['ID',r=>el('code',{},r.id)],
   ['Open',r=>button(S.libraryKind==='editions'?'Select edition':'Open record',async()=>{
    if(S.libraryKind==='editions'){need(!S.rows.length,'Remove selected rows before changing the original edition.');await loadEdition(r.id);await loadRows(0);S.view='prepare';}
    else{if(Object.keys(S.choices).length&&!confirm('Leave the working decisions and open another record? Save working JSON first to keep them.'))return;await openRecord(S.libraryKind,r.id);changed();}
   },'dws-record-'+r.id)]],S.libraryPage.rows),pager(S.libraryPage,n=>library(S.libraryKind,n)));
  return [box];
 }
 function render(){
  if(S.disposed)return;root.className='dws';root.dataset.worksheetOperatorReady='true';if(S.openId)root.dataset.worksheetRecordId=S.openId;else delete root.dataset.worksheetRecordId;
  const input=el('input',{type:'file',accept:'.json,application/json','data-testid':'dws-open-working'});
  input.onchange=()=>task(async()=>{const file=input.files[0];need(file&&file.size<=33554432,'Choose complete working JSON within32MiB.');const text=await observed(()=>file.text());await restoreWorking(JSON.parse(text));});
  const nav=el('nav',{class:'dws-actions','aria-label':'Worksheet views'},[
   button('Select rows',()=>{S.view='prepare';},'dws-view-prepare'),button('Returned-file intake',()=>{S.view='intake';},'dws-view-intake'),
   button('Current record',()=>{S.view='review';},'dws-view-review'),button('History',()=>library(),'dws-view-history'),
   button('Save working JSON',()=>{persist();saveJSON(working(),'Directory_Worksheet_Working.json');},'dws-save-working'),
   el('label',{class:'dws-file-label'},['Open working JSON',input])]);
  const nodes=[el('header',{},[el('p',{class:'dws-kicker'},'Directory / Customer correction round'),el('h1',{},'Correction worksheets'),
   el('p',{},'Send selected whole original rows to a customer. Receive their complete proposed values, then review every typed change before preparing a correction plan.')]),nav];
  if(S.error)nodes.push(el('div',{class:'dws-notice',role:'alert'},['Needs attention: '+S.error]));
  if(S.message)nodes.push(el('div',{class:'dws-notice',role:'status'},S.message));
  if(S.storageError)nodes.push(el('div',{class:'dws-notice',role:'alert'},S.storageError));
  if(S.pending)nodes.push(panel('Original pending request',[details('Complete retained request',S.pending),
   el('p',{},S.pending.action==='receive'?'Reselect exactly the same original returned file to resume this saved intake.':'Replay the exact saved request to reconcile its immutable native result.'),
   button('Resume exact pending request',()=>perform(S.pending.action,S.pending.body,S.upload),'dws-resume')]));
  nodes.push(...(S.view==='prepare'?prepareView():S.view==='intake'?intakeView():S.view==='history'?historyView():reviewView()));
  root.replaceChildren(...nodes);if(S.busy)freeze();
 }
 const unload=e=>{persist();if(S.dirty||S.pending||S.busy){e.preventDefault();e.returnValue='';}};
 window.addEventListener('beforeunload',unload);
 return {
  async open(){return task(async()=>{
   const state=await observed(getState);need(state.directory?.workspaceId,'Open the original Directory workspace.');
   S.workspaceId=state.directory.workspaceId;S.actor=state.operatingActor||'';
   const saved=sessionStorage.getItem(key());if(saved){try{await restoreWorking(JSON.parse(saved));}catch(e){S.error='Saved working input needs attention: '+e.message;}}
   render();
  });},
  busy:()=>S.busy,dirty:()=>S.dirty||!!S.pending,
  dispose(){persist();S.disposed=true;generation++;window.removeEventListener('beforeunload',unload);},
  working:()=>clone(working())
 };
}
