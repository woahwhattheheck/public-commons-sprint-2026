import {createTemplateExchangeClient} from '/template-exchange-client.mjs';
const $=id=>document.getElementById(id),q=new URLSearchParams(location.search),dossierId=q.get('dossierId');
// The original Research host uses its 64-hex fragment capability as a bearer token.
// Keep it in memory and same-origin navigation only; never persist it in workspace data.
const token=new URLSearchParams(location.hash.slice(1)).get('token')??'';
const hasSession=/^[a-f0-9]{64}$/.test(token);
const sessionHeaders=hasSession?{Authorization:'Bearer '+token}:{};
const api=createTemplateExchangeClient({baseUrl:location.origin,dossierId:dossierId??'',headers:sessionHeaders});
let workspaceId=null,instanceId=null,storageKey=null,lastConflict=null,initialized=false;
const researchHome=new URL('/',location.origin);
if(hasSession)researchHome.hash=new URLSearchParams({token,dossier:dossierId??'',view:'study-extraction'}).toString();
$('research-home').href=researchHome.toString();
let revision=null,overview=null,records={},stage=null,publicationRows=[],selectedReturn=null,selectedReview=null,nativeDraft=null,busy=false;
let pending=null;
$('dossier').value=dossierId??'';
async function initialize(){
 const response=await fetch('/api/status',{headers:sessionHeaders,credentials:'same-origin',redirect:'error'});
 let status;try{status=await response.json();}catch{throw Error('The Research session did not return its workspace identity.');}
 if(!response.ok)throw Error(typeof status.error==='string'?status.error:'The original Research session could not be opened.');
 if(!/^research_[a-f0-9]{64}$/.test(status.workspaceId)||typeof status.instanceId!=='string'||!status.instanceId)
   throw Error('The Research workspace identity is unavailable.');
 if(q.has('workspaceId')&&q.get('workspaceId')!==status.workspaceId)throw Error('This link belongs to a different Research workspace.');
 if(q.has('instanceId')&&q.get('instanceId')!==status.instanceId)throw Error('Reopen workbook exchange from the current Research session.');
 if(!status.api?.templateExchange)throw Error('This Research installation does not yet include workbook exchange.');
 workspaceId=status.workspaceId;instanceId=status.instanceId;
 sessionHeaders['X-Research-Workspace-Id']=workspaceId;sessionHeaders['X-Research-Instance-Id']=instanceId;
 storageKey='research-template-exchange:'+workspaceId+':'+dossierId;
 let saved={};const raw=localStorage.getItem(storageKey);
 if(raw){try{saved=JSON.parse(raw);}catch{throw Error('The saved workbook request could not be read; its original local record is preserved.');}
   if(saved.schema!=='sf88-template-browser-request/v1'||saved.workspaceId!==workspaceId||saved.dossierId!==dossierId)
     throw Error('The saved workbook request belongs to a different workspace or dossier.');}
 pending=saved.pending??null;lastConflict=saved.lastConflict??null;
 $('actor-id').value=saved.actor?.id??'';$('actor-name').value=saved.actor?.name??'';
 document.documentElement.dataset.researchWorkspaceId=workspaceId;
 initialized=true;await refresh();
}
const id=()=>crypto.randomUUID();
const value=id=>$(id).value.trim();
const actor=()=>{const result={id:value('actor-id'),name:value('actor-name')};if(!result.id||!result.name)throw Error('Enter the assigned reviewer ID and name.');return result;};
const persist=()=>{
 if(!initialized||!storageKey)throw Error('Open the original Research workspace before saving a request.');
 localStorage.setItem(storageKey,JSON.stringify({schema:'sf88-template-browser-request/v1',workspaceId,dossierId,
  actor:{id:value('actor-id'),name:value('actor-name')},pending,lastConflict}));
};
const message=(text,error=false)=>{$('message').textContent=text;$('message').className=error?'error':'';};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const json=value=>JSON.stringify(value,null,2);
function details(container,value){const text=json(value);container.textContent=text.length>2000000?text.slice(0,2000000)+'\n\nPreview truncated. The complete retained JSON is available from the record download.':text;}
function download(name,body,type='application/json'){
 const url=URL.createObjectURL(new Blob([body],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderPending(){
 $('pending').hidden=!pending&&!lastConflict;
 $('pending-title').textContent=pending?'A saved request needs reconciliation':'Previous uncommitted request';
 $('retry').disabled=busy||!pending;$('reconcile').disabled=busy||!pending;
 $('download-request').disabled=busy||(!pending&&!lastConflict);
 if(pending)$('pending-description').textContent=(pending.kind==='native'?'Original extraction request ':'Template review request ')+
   (pending.request.requestId??pending.request.request?.requestId)+' is retained exactly. Retry it to recover its committed result or finish the native receipt.';
 else if(lastConflict)$('pending-description').textContent='The dossier advanced before the last reviewed action committed. Its unchanged request is available here; prepare a new review against the current revision.';
}
const disabledBeforeWork=new WeakMap();
function setBusy(active){
 busy=active;
 for(const button of document.querySelectorAll('button')){
  if(active){disabledBeforeWork.set(button,button.disabled);button.disabled=true;}
  else if(disabledBeforeWork.has(button)){button.disabled=disabledBeforeWork.get(button);disabledBeforeWork.delete(button);}
 }
 if(!active)renderPending();
}
async function run(fn,{startup=false}={}){
 if(busy)return;
 if(!initialized&&!startup){message('Open workbook exchange from the original Research session.',true);return;}
 setBusy(true);try{await fn();}catch(error){message(error.message||error.code||String(error),true);}finally{setBusy(false);}
}
function panel(name){
 for(const e of document.querySelectorAll('.panel'))e.hidden=e.id!==name;
 for(const e of document.querySelectorAll('nav button'))e.classList.toggle('active',e.dataset.panel===name);
 if(name==='draft'&&$('draft-review').value)$('draft-review').dispatchEvent(new Event('change'));
}
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>panel(button.dataset.panel));
function options(select,rows,{label=r=>r.name??r.filename??r.id,selected=select.value,empty=false}={}){
 select.replaceChildren();if(empty){const op=node('option','New template');op.value='';select.append(op);}
 for(const row of rows){const op=node('option',label(row));op.value=row.id;select.append(op);}
 if([...select.options].some(o=>o.value===selected))select.value=selected;
}
async function all(section){
 let page=await api.page({revision,section,limit:200}),items=page.items;
 while(page.nextOffset!==null){page=await api.page({revision,section,offset:page.nextOffset,limit:200});items.push(...page.items);}
 return items;
}
function recordList(container,rows){
 container.replaceChildren();
 for(const row of rows.slice(-20).reverse()){
  const card=node('div',undefined,'record'),text=node('div');text.append(node('strong',row.name??row.filename??row.id));
  text.append(node('small','Edition '+(row.edition??'')+' · revision '+row.revision+' · '+row.actor.name));card.append(text);
  if(row.workbook){const button=node('button','Download original file');button.onclick=()=>run(async()=>{
    const bytes=await api.blob(row.workbook.sha256,{revision,filename:row.filename});download(row.filename,bytes,
      row.filename.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/plain');});card.append(button);}
  container.append(card);
 }
}
function refreshSelectors(){
 const templates=records.templates??[],editions=records['template-editions']??[],mappings=records.mappings??[],releases=records.releases??[];
 const name=templateId=>templates.find(t=>t.id===templateId)?.name??templateId;
 options($('template-choice'),templates,{empty:true});
 options($('mapping-edition'),editions,{label:r=>name(r.templateId)+' · edition '+r.edition+' · '+r.filename});
 options($('mapping-publication'),overview.publications,{label:r=>r.title+' · '+r.rows+' rows · '+r.status});
 options($('release-mapping'),mappings,{label:r=>name(r.templateId)+' · '+r.bindingCount+' mapped cells · r'+r.revision});
 options($('return-release'),releases,{label:r=>r.filename+' · edition '+r.edition});
 options($('review-return'),records.returns??[],{label:r=>r.filename+' · '+r.counts.changedMapped+' mapped changes'});
 options($('draft-review'),records['return-reviews']??[],{label:r=>r.id.slice(0,15)+' · '+r.counts['propose-correction']+' proposed corrections'});
 recordList($('template-list'),editions);recordList($('release-list'),releases);historyChoices();
}
async function refresh(){
 if(!workspaceId)throw Error('The original Research workspace is still opening.');
 overview=await api.page();revision=overview.revision;$('revision').textContent='Dossier revision '+revision;
 const sections=['templates','template-editions','mappings','releases','returns','return-reviews','drafts','operations'];
 const values=await Promise.all(sections.map(s=>all(s)));records=Object.fromEntries(sections.map((s,i)=>[s,values[i]]));
 refreshSelectors();renderPending();document.documentElement.dataset.templateRevision=String(revision);
}
function showStage(prepared,title,summary){
 stage=prepared;$('stage').hidden=false;$('stage-title').textContent=title;$('stage-summary').replaceChildren(node('p',summary));
 details($('stage-json'),prepared.preview??prepared);$('commit-reason').value='';$('stage').scrollIntoView({behavior:'smooth',block:'start'});
}
function noPending(){
 if(!initialized)throw Error('Open the original Research workspace first.');
 if(pending)throw Error('Reconcile the exact saved request before starting another mutation.');
}
async function bodyFile(input){
 const file=input.files[0];if(!file)throw Error('Choose the complete original file.');
 if(file.size>32*1024*1024)throw Error('This workbook exceeds the 32 MiB intake limit.');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {filename:file.name,bodyBase64:btoa(binary)};
}
async function commitPending(){
 if(!pending)throw Error('No saved request is pending.');
 const current=pending;
 // Persist the original complete request before every first send or replay.
 persist();renderPending();
 let result;
 try{result=current.kind==='native'?await api.acceptExtractionDraft(current.request):await api.review(current.request);}
 catch(error){
  if(current.kind==='review'&&error.code==='REVISION_CONFLICT'){
   lastConflict=current;pending=null;
   try{persist();}catch(storageError){pending=current;throw storageError;}
   renderPending();await refresh();
   throw Error('The dossier advanced before this action committed. Download the unchanged request if needed, then prepare a new review against revision '+revision+'.');
  }
  throw error;
 }
 // The response is authoritative even if browser storage or a later refresh fails.
 window.templateExchangeLastAccepted=result;
 let storageWarning='';
 if(pending===current){
  pending=null;
  try{persist();}catch{pending=current;storageWarning=' The browser could not clear its local request; replaying this exact request recovers the saved result.';}
 }
 stage=null;nativeDraft=null;$('stage').hidden=true;$('native-preview').hidden=true;
 const accepted=current.kind==='native'?'The original extraction draft and its return receipt are saved. Submit and resolve it in the original extraction workflow.':'The reviewed action is saved in the dossier.';
 try{await refresh();message(accepted+storageWarning);}
 catch(error){message(accepted+storageWarning+' The view could not refresh: '+(error.message||error.code)+'. Use Refresh to reopen the saved revision.',true);}
 renderPending();return result;
}
$('commit-stage').onclick=()=>run(async()=>{
 noPending();if(!stage)throw Error('Prepare an action first.');
 const reason=value('commit-reason');if(!reason)throw Error('Record a reason before accepting this action.');
 const request={requestId:'template-'+id(),expectedRevision:stage.expectedRevision,actor:actor(),action:stage.action,data:{...stage.data,reason}};
 pending={kind:'review',request};renderPending();await commitPending();
});
$('discard-stage').onclick=()=>{stage=null;$('stage').hidden=true;};
$('retry').onclick=()=>run(commitPending);
$('download-request').onclick=()=>{
 const retained=pending??lastConflict;if(!retained)return;
 const requestId=retained.request.requestId??retained.request.request?.requestId;
 download('template-request-'+requestId+'.json',json({schema:'sf88-template-browser-request/v1',workspaceId,dossierId,...retained})+'\n');
};
$('reconcile').onclick=()=>run(async()=>{
 if(!pending)return;
 const requestId=pending.kind==='native'?pending.request.receiptRequestId:pending.request.requestId;
 const actual=await api.operation({requestId});
 if(actual.operation){message('The saved operation exists at revision '+actual.operation.revision+'. Retry the exact request to recover its full response.');}
 else message('No completed template operation with this request ID is present. Retry the exact request; the original native request retains its own recovery identity.');
});
$('refresh').onclick=()=>run(refresh);
for(const name of ['actor-id','actor-name'])$(name).addEventListener('change',()=>{try{persist();}catch(error){message(error.message,true);}});
$('template-choice').onchange=()=>{
 const current=records.templates?.find(r=>r.id===$('template-choice').value);$('template-name').value=current?.name??'';$('template-name').disabled=Boolean(current);
};
$('template-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 noPending();const selected=$('template-choice').value,filename=await bodyFile($('template-file')),name=value('template-name');
 const delimiter=$('template-delimiter').value;const edition=await api.stageTemplate({...filename,...(delimiter?{delimiter}:{})});
 const current=(records['template-editions']??[]).filter(r=>r.templateId===selected).at(-1);
 showStage({expectedRevision:revision,action:selected?'revise-template':'retain-template',
   data:selected?{templateId:selected,expectedEditionId:current.id,edition}:{name,edition},preview:edition.summary},
   selected?'Review the next template edition':'Review the original template',
   edition.filename+' · '+edition.summary.sheets.length+' sheets · '+edition.summary.formulaCount+' formulas retained.');
 });};
$('mapping-source-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 const publicationId=$('mapping-publication').value;let page=await api.publication({revision,publicationId,limit:200});publicationRows=page.items;
 while(page.nextOffset!==null){page=await api.publication({revision,publicationId,offset:page.nextOffset,limit:200});publicationRows.push(...page.items);}
 const fields=new Map();for(const row of publicationRows)for(const field of row.result.record.form.definition.fields)fields.set(field.id,field);
 const table=node('table'),head=node('tr');['Field','Destination column','Value representation'].forEach(x=>head.append(node('th',x)));table.append(head);
 let index=3;
 for(const field of fields.values()){
  const row=node('tr'),column=node('input');column.value=col(index++);column.maxLength=3;column.dataset.field=field.id;column.setAttribute('aria-label',field.label+' destination column');
  const mode=node('select');mode.dataset.mode=field.id;for(const name of ['text','number','boolean','json']){const op=node('option',name==='text'?'Exact source text':name);op.value=name;mode.append(op);}
  const cell=node('td');cell.append(column);const style=node('td');style.append(mode);row.append(node('td',field.label),cell,style);table.append(row);
 }
 $('field-map').replaceChildren(table);$('mapping-setup').hidden=false;
 const edition=(records['template-editions']??[]).find(x=>x.id===$('mapping-edition').value);
 const inspected=await api.record({revision,kind:'edition',recordId:edition.id});
 $('mapping-sheet').value=inspected.details.inspection.sheets.find(s=>s.kind==='worksheet')?.name??'Results';
 message('Loaded '+publicationRows.length+' frozen result rows. Select each destination before preparing the mapping.');
 });};
function col(index){let s='';while(index){index--;s=String.fromCharCode(65+index%26)+s;index=Math.floor(index/26);}return s;}
$('generate-mapping').onclick=()=>{
 try{
  const sheet=value('mapping-sheet'),start=Number($('mapping-row').value),identity=value('mapping-identity').toUpperCase(),label=value('mapping-label').toUpperCase();
  if(!Number.isSafeInteger(start)||start<1)throw Error('Choose a valid first row.');
  const bindings=[];let index=0;
  for(const entry of publicationRows){
   const source=entry.result,row=start+index++,base={sheet,resultId:source.resultId,editionId:source.editionId,...(identity?{rowIdentity:{column:identity,value:source.resultId}}:{})};
   if(label)bindings.push({...base,id:'label-'+index,cell:label+row,pointer:'/row/label',mode:'text'});
   for(const input of $('field-map').querySelectorAll('input[data-field]')){
    const column=input.value.trim().toUpperCase();if(!column)continue;
    const fieldId=input.dataset.field,mode=[...$('field-map').querySelectorAll('select[data-mode]')].find(s=>s.dataset.mode===fieldId).value;
    if(source.record.values?.[fieldId])bindings.push({...base,id:'value-'+index+'-'+fieldId,cell:column+row,fieldId,mode});
   }
  }
  $('mapping-json').value=json(bindings);message('Explicit mapping prepared locally. Review it against the original template.');
 }catch(error){message(error.message,true);}
};
$('preview-mapping').onclick=()=>run(async()=>{
 noPending();const bindings=JSON.parse($('mapping-json').value);
 const prepared=await api.stageMapping({revision,templateEditionId:$('mapping-edition').value,publicationId:$('mapping-publication').value,bindings});
 showStage(prepared,'Review the exact cell mapping',prepared.preview.bindingCount+' mapped cells; selected publication status: '+prepared.preview.publicationStatus+'.');
});
$('release-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 noPending();const prepared=await api.stageRelease({revision,mappingId:$('release-mapping').value,filename:value('release-filename'),
  review:{note:value('release-note'),allowHistorical:$('release-historical').checked,acknowledgeNewerSource:$('release-newer').checked}});
 showStage(prepared,'Review the complete client release',prepared.preview.native.changes.length+' value changes. Calculation state: '+prepared.preview.calculation+'.');
 });};
$('return-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 noPending();const file=await bodyFile($('return-file')),release=(records.releases??[]).find(r=>r.id===$('return-release').value);
 const prepared=await api.stageReturn({revision,releaseId:release.id,...file,...(release.delimiter?{delimiter:release.delimiter}:{})});
 showStage(prepared,'Review the complete client return',prepared.preview.counts.changedMapped+' mapped changes; '+prepared.preview.counts.unmappedCellChanges+' other cell changes retained.');
 });};
$('return-select-form').onsubmit=e=>{e.preventDefault();run(()=>openReturn($('review-return').value));};
async function openReturn(returnId){
 const result=await api.record({revision,kind:'return',recordId:returnId});selectedReturn=result;const comparison=result.details.comparison;
 const changes=comparison.mapped.filter(m=>m.changed),table=node('table'),head=node('tr');
 ['Source field / location','Released value','Client value','Disposition','Review note'].forEach(x=>head.append(node('th',x)));table.append(head);
 for(const change of changes){
  const tr=node('tr');tr.dataset.bindingId=change.bindingId;
  const where=node('td',(change.fieldId??change.source.pointer)+'\n'+change.released.sheet+'!'+change.released.cell+(change.moved?' → '+change.returned.cell:''));
  const before=node('td',json(change.released.value.value),'value'),after=node('td',change.error??json(change.returned.value.value),'value');
  const select=node('select');select.dataset.decision=change.bindingId;
  for(const [value,label] of [['keep-release','Keep the released evidence'],['propose-correction','Propose a reviewer correction'],['client-only','Retain as client-only material']]){
   if(value==='propose-correction'&&!change.correctionEligible)continue;const option=node('option',label);option.value=value;select.append(option);
  }
  const choice=node('td');choice.append(select);
  if(change.identity==='fixed-cell'){
   const label=node('label','I checked this fixed cell still belongs to the original result.','check'),check=node('input');check.type='checkbox';check.dataset.fixed=change.bindingId;label.prepend(check);choice.append(label);
  }
  const note=node('textarea');note.rows=3;note.dataset.note=change.bindingId;const noteCell=node('td');noteCell.append(note);
  tr.append(where,before,after,choice,noteCell);table.append(tr);
 }
 const scroll=node('div',undefined,'table-scroll');scroll.append(table);
 $('return-review').replaceChildren(node('p',changes.length+' mapped changes. '+comparison.counts.unmappedCellChanges+' other cell changes remain in the exact retained client file.'),scroll);
 if(!changes.length)$('return-review').prepend(node('p','No mapped evidence values changed. An explicit empty review can still record receipt.'));
 $('save-return-review').hidden=false;$('adopt-return-form').hidden=false;
}
$('save-return-review').onclick=()=>run(async()=>{
 noPending();if(!selectedReturn)throw Error('Open a retained return first.');
 const decisions=[...$('return-review').querySelectorAll('select[data-decision]')].map(select=>{
  const id=select.dataset.decision;return {bindingId:id,disposition:select.value,
   note:[...$('return-review').querySelectorAll('textarea[data-note]')].find(x=>x.dataset.note===id).value.trim(),
   fixedCellConfirmed:[...$('return-review').querySelectorAll('input[data-fixed]')].find(x=>x.dataset.fixed===id)?.checked??false};
 });
 const prepared=await api.stageReturnReview({revision,returnId:selectedReturn.record.id,decisions});
 showStage(prepared,'Review all returned mapped cells',decisions.filter(d=>d.disposition==='propose-correction').length+' corrections will be available to the assigned extraction reviewer.');
});
$('adopt-return-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 noPending();if(!selectedReturn)throw Error('Open the client return first.');
 const r=selectedReturn.record,current=(records['template-editions']??[]).filter(x=>x.templateId===r.templateId).at(-1);
 showStage({expectedRevision:revision,action:'revise-template',data:{templateId:r.templateId,expectedEditionId:current.id,
   sourceReturnId:r.id,edition:{filename:r.filename,format:r.format,...(r.delimiter?{delimiter:r.delimiter}:{}),workbook:r.workbook,inspection:r.inspection}}},
   'Retain the client file as the next template','Every client-only edit stays in this new edition. Prepare its new mapping before releasing another file.');
 });};
$('draft-review').onchange=()=>run(async()=>{
 const r=(records['return-reviews']??[]).find(x=>x.id===$('draft-review').value);if(!r)return;
 const result=await api.record({revision,kind:'return',recordId:r.returnId}),sets=[...new Set(result.details.comparison.mapped.filter(m=>m.correctionEligible).map(m=>m.resultSetId))];
 $('draft-sets').textContent='Original result sets in this return: '+sets.join(', ');if(sets.length===1)$('draft-result-set').value=sets[0];
});
$('draft-form').onsubmit=e=>{e.preventDefault();run(async()=>{
 noPending();nativeDraft=await api.prepareExtractionDraft({revision,reviewId:$('draft-review').value,actor:actor(),requestId:'client-draft-'+id(),
  resultSetId:value('draft-result-set'),reason:value('draft-reason')});
 $('native-preview').hidden=false;$('native-summary').textContent=nativeDraft.request.data.answers.length+' complete answers for '+nativeDraft.request.actor.name+
  ', source revision '+nativeDraft.revision+'. Proposed corrections remain uncertain until the original workflow resolves them.';details($('native-json'),nativeDraft);
 });};
$('native-accept').onclick=()=>run(async()=>{
 noPending();if(!nativeDraft)throw Error('Prepare an original request first.');
 pending={kind:'native',request:{reviewId:nativeDraft.reviewId,request:nativeDraft.request,requestBlob:nativeDraft.blob,
  receiptRequestId:nativeDraft.request.requestId+'-receipt',reason:'Recorded client-return draft through the original assigned extraction reviewer.'}};
 renderPending();await commitPending();
});
function historyChoices(){
 const kind=$('history-kind').value,key={edition:'template-editions',mapping:'mappings',release:'releases',return:'returns',review:'return-reviews',draft:'drafts'}[kind];
 options($('history-record'),records[key]??[],{label:r=>(r.filename??r.id.slice(0,20))+' · r'+r.revision});
}
$('history-kind').onchange=historyChoices;
$('history-open').onclick=()=>run(async()=>{
 const result=await api.record({revision,kind:$('history-kind').value,recordId:$('history-record').value});
 details($('history-json'),result);const button=node('button','Download complete record JSON');button.onclick=()=>download('template-record-'+result.record.id+'.json',json(result)+'\n');
 $('history-summary').replaceChildren(node('p','Original actor: '+result.record.actor.name+' · revision '+result.record.revision),button);
 if(result.record.workbook){const get=node('button','Download original workbook');get.onclick=()=>run(async()=>{
  const bytes=await api.blob(result.record.workbook.sha256,{revision,filename:result.record.filename});download(result.record.filename,bytes);});$('history-summary').append(get);}
});
window.templateExchangeApp={api,refresh,selectPanel:panel,get revision(){return revision;},get records(){return records;},
 get workspaceId(){return workspaceId;},get instanceId(){return instanceId;}};
window.addEventListener('beforeunload',event=>{
 if(stage||nativeDraft){event.preventDefault();event.returnValue='';}
});
renderPending();
if(!dossierId)message('Open this page from a selected Research dossier.',true);
else if(!hasSession)message('Open workbook exchange from your original Research session.',true);
else window.templateExchangeApp.ready=run(initialize,{startup:true});
