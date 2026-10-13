// Complete original statement, account-period comparison and immutable reconciliation editions.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
const DESK_SCHEMA='stellar-forge.sf47-account-reconciliation-desk.v1';
const REPORT_SCHEMA='stellar-forge.sf47-account-reconciliation.v1';
const PAGE_SIZE=50,MAX_DESK_BYTES=64*1024*1024;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const pretty=value=>JSON.stringify(value,null,2);
const title=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
const day=()=>new Date().toISOString().slice(0,10);
const date=value=>{if(!value)return '—';const onlyDay=/^\d{4}-\d{2}-\d{2}$/.test(value),parsed=new Date(onlyDay?value+'T00:00:00Z':value);return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat(undefined,{dateStyle:'medium',...(onlyDay?{timeZone:'UTC'}:{timeStyle:'short'})}).format(parsed);};
const decimal=value=>{if(value===null||value===undefined)return '—';const text=String(value),match=/^([+-]?)(\d+)(\.\d+)?$/.exec(text);return match?match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(match[3]||''):text;};
const amount=(value,currency='')=>'<span class="ar-number">'+esc(decimal(value))+(value===null||value===undefined||!currency?'':' '+esc(currency))+'</span>';
const badge=value=>'<span class="ar-tag">'+esc(title(value))+'</span>';
const button=(text,action,id='',fixed=false,extra='')=>'<button type="button" data-ar-action="'+esc(action)+'"'+(id!==''?' data-id="'+esc(id)+'"':'')+(fixed?' disabled data-ar-fixed="true"':'')+(extra?' '+extra:'')+'>'+esc(text)+'</button>';
const table=(headers,rows)=>'<div class="ar-table"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+(!rows.length?'<tr><td colspan="'+headers.length+'">No records in this view.</td></tr>':'')+'</tbody></table></div>';
const pairs=entries=>'<dl class="ar-details">'+entries.map(([name,value])=>'<div><dt>'+esc(name)+'</dt><dd>'+esc(value??'—')+'</dd></div>').join('')+'</dl>';
const details=(name,value)=>'<details><summary>'+esc(name)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
const empty=text=>'<p class="ar-empty">'+esc(text)+'</p>';
function field(text,key,value='',{options,multiple=false,area=false,type='text',required=false,wide=false,help=''}={}){
  const attributes=' data-ar-field="'+esc(key)+'"'+(required?' required':'');
  const input=options?'<select'+attributes+(multiple?' multiple size="4"':'')+'>'+options.map(([id,name])=>'<option value="'+esc(id)+'"'+((multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>':area?'<textarea'+attributes+' rows="3">'+esc(value)+'</textarea>':'<input'+attributes+' type="'+type+'" value="'+esc(value??'')+'">';
  return '<label'+(wide?' class="ar-wide"':'')+'>'+esc(text)+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const RECONCILIATION_DATABASE='sf47-account-reconciliation',databases=new Map();
function database(name=RECONCILIATION_DATABASE){
  if(!databases.has(name)){
    const opening=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error('Browser draft storage is unavailable.'));return;}
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('desks'))request.result.createObjectStore('desks');};
      request.onerror=()=>reject(request.error||new Error('The reconciliation desk could not be opened.'));
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();databases.delete(name);};resolve(request.result);};
    }).catch(problem=>{databases.delete(name);throw problem;});
    databases.set(name,opening);
  }
  return databases.get(name);
}
async function stored(key,value,expectedRevision,name=RECONCILIATION_DATABASE){
  const db=await database(name);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('desks',value===undefined?'readonly':'readwrite'),store=tx.objectStore('desks'),request=store.get(key);
    let result,conflict;
    request.onsuccess=()=>{
      const previous=request.result;
      if(value===undefined){result=previous;return;}
      const revision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
      if(revision!==expectedRevision){conflict=Object.assign(new Error('Another tab saved a newer reconciliation desk.'),{code:'RECONCILIATION_DRAFT_CONFLICT'});tx.abort();return;}
      store.put({...value,_storedRevision:revision+1},key);result=revision+1;
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(conflict||tx.error||request.error||new Error('The reconciliation desk could not be saved.'));
  });
}
export function mountAccountReconciliation({container,current,api,saveApi=api,session,mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext()}){
  const root=document.createElement('section');root.className='account-reconciliation-desk';root.setAttribute('aria-label','Account reconciliation');container.replaceChildren(root);
  if(!document.querySelector('link[data-account-reconciliation-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_account_reconciliation.css';style.dataset.accountReconciliationStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId;
  const deskContext=staffContext?clone(staffContext):null,databaseName=staffDeskStorageKey(RECONCILIATION_DATABASE,deskContext),boundStaff=databaseName!==RECONCILIATION_DATABASE;
  const ownStored=(key,value,expectedRevision)=>stored(key,value,expectedRevision,databaseName);
  let legacyCopy=null,legacySearched=false;
  function pendingActorProblem(body) {
    if(!boundStaff||deskContext.role==='owner'||!body)return null;
    if(typeof body.actor==='string'&&body.actor.trim()===deskContext.actor)return null;
    const original=typeof body.actor==='string'&&body.actor.trim()?body.actor.trim():'an unrecorded operator';
    return Object.assign(new Error('This original request belongs to '+original+'. Sign in as that operator to resume it. The complete original copy remains available to download.'),{code:'STAFF_REQUEST_ACTOR_CHANGED',status:403});
  }

  let active=true,busy=false,hostBusy=false,report=null,error='',notice='',storageNote='',saveTimer,loadSequence=0;
  session.storageWrites||=Promise.resolve();session.selection||={reconciliationId:null,revision:null};
  session.tab||='compare';session.view||='current';session.page||=0;session.filter||={query:'',status:''};
  session.selectedRows||=[];session.selectedCash||=[];
  session.editor||={linkReason:'',excludedReason:'',outstandingReason:'',expectedClearDate:'',sourceIds:[]};
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  const editable=()=>current.program.state==='OPEN';
  const sourceName=id=>current.sources.find(row=>row.id===id)?.filename||id;
  const cashRecord=id=>current.records.cash.find(row=>row.id===id);
  const cashName=id=>{const row=cashRecord(id);return row?date(row.date)+' · '+(row.externalRef||title(row.category))+' · '+decimal(row.amount)+' '+row.currency:id;};
  const sourceButton=(id,text)=>button(text||sourceName(id),'source',id);
  const accountName=statement=>statement.accountLabel||statement.accountId||'Account';
  const editing=()=>!!session.draft&&session.editing!==false;
  const currentPreview=()=>editing()?(session.reviewed?.preview||null):(session.view==='saved'?report?.selected?.record?.preview:report?.current||report?.selected?.record?.preview)||null;
  const changedInput=()=>{session.reviewed=null;session.confirmed=false;session.detail=null;session.page=0;const node=$('.ar-preview');if(node)node.innerHTML=previewArea();controls();schedule();};
  function state(){
    return {schema:DESK_SCHEMA,caseId,caseVersion:current.program.version,selection:clone(session.selection),tab:session.tab,view:session.view,editing:session.editing!==false,
      filter:clone(session.filter),selectedRows:clone(session.selectedRows),selectedCash:clone(session.selectedCash),
      editor:clone(session.editor),draft:session.draft?clone(session.draft):null,
      pending:session.pending?clone(session.pending):null,previousRequest:session.previousRequest?clone(session.previousRequest):null,
      result:session.result?clone(session.result):null};
  }
  function validateDesk(value){
    if(!value||value.schema!==DESK_SCHEMA||value.caseId!==caseId)throw new Error('Open this desk in its original operating case to retain its source and request identities.');
    if(value.draft&&(!value.draft.document||typeof value.draft.document!=='object'||!Array.isArray(value.draft.document.links)||!Array.isArray(value.draft.document.exclusions)||!Array.isArray(value.draft.document.outstanding)))throw new Error('This recovery desk needs its complete original reconciliation document.');
    if(value.pending&&(value.pending.caseId!==caseId||value.pending.kind!=='account-reconciliation'||!value.pending.body||!value.pending.body.requestId||!value.pending.body.document||!Number.isInteger(value.pending.body.expectedVersion)))throw new Error('The recovery desk needs its complete original reconciliation request.');
  }
  function restore(value){
    validateDesk(value);
    for(const key of ['selection','tab','view','editing','filter','selectedRows','selectedCash','editor','draft','pending','previousRequest','result'])session[key]=clone(value[key]??null);
    session.selection||={reconciliationId:null,revision:null};session.tab||='compare';session.view||='current';session.filter||={query:'',status:''};
    session.selectedRows||=[];session.selectedCash||=[];session.editor||={linkReason:'',excludedReason:'',outstandingReason:'',expectedClearDate:'',sourceIds:[]};
    session.page=0;session.detail=null;session.reviewed=null;session.confirmed=false;
    session.storageRevision=Number.isSafeInteger(value._storedRevision)?value._storedRevision:0;session.storageConflict=false;
  }
  async function persist(){
    const snapshot=state(),write=session.storageWrites.catch(()=>{}).then(async()=>{
      session.storageRevision=await ownStored(caseId,snapshot,session.storageRevision??0);session.storageConflict=false;
    });
    session.storageWrites=write;
    try{await write;storageNote='';if(available())status();return true;}
    catch(problem){
      session.storageConflict=problem.code==='RECONCILIATION_DRAFT_CONFLICT'||session.storageConflict;
      storageNote=session.storageConflict?'Another tab saved a newer desk. This tab retains its complete draft and original request. Download this desk or open the saved version.':'Browser storage could not save the desk. Download the complete recovery copy to retain its draft and original request.';
      if(available())status();return false;
    }
  }
  function schedule(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist();},180);}
  function status(){
    const e=$('[data-ar-error]'),n=$('[data-ar-status]'),s=$('[data-ar-storage]');
    if(e)e.textContent=error;if(n)n.textContent=notice;if(s)s.textContent=storageNote;
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const node of root.querySelectorAll('button,input,select,textarea'))node.disabled=node.dataset.arFixed==='true'||(node.dataset.arAlways!=='true'&&(busy||hostBusy||!!session.pending));
    for(const node of root.querySelectorAll('[data-ar-action="retry"],[data-ar-action="reopen-request"]'))node.disabled=busy||hostBusy||node.dataset.arFixed==='true'||!!pendingActorProblem(session.pending?.body);
    const save=$('[data-ar-action="save"]');if(save)save.disabled=busy||hostBusy||!!session.pending||!editable()||!session.confirmed||!session.reviewed?.preview?.canApply;
  }
  async function run(action){
    if(busy||hostBusy||!available())return;
    busy=true;error='';controls();status();
    try{await action();}
    catch(problem){if(available()){error=problem?.message||String(problem);status();}}
    finally{busy=false;if(available()){controls();status();}}
  }
  function accountQuery(exporting=false){
    const query=new URLSearchParams();
    if(session.selection.reconciliationId)query.set('reconciliationId',session.selection.reconciliationId);
    if(session.selection.revision!==null&&session.selection.revision!==undefined)query.set('revision',String(session.selection.revision));
    query.set('expectedVersion',String(exporting?report.case.version:current.program.version));
    if(exporting)query.set('expectedReportSha256',report.reportSha256);
    return query.toString();
  }
  async function loadReport(){
    const token=++loadSequence,value=await api(prefix+'/account-reconciliation?'+accountQuery());
    if(!available()||token!==loadSequence)return;
    if(value.schema!==REPORT_SCHEMA||value.case.id!==caseId)throw new Error('The returned reconciliation account does not match this operating case.');
    report=value;session.selection=clone(value.selection||session.selection);
    if(session.draft&&session.reviewed?.body.expectedVersion!==value.case.version){session.reviewed=null;session.confirmed=false;}
    if(!session.newStatementId&&report.statements?.length)session.newStatementId=report.statements[0].sourceId;
    schedule();
  }
  function previewBody(){
    if(!session.draft)throw new Error('Open a statement or saved edition to prepare a reconciliation.');
    return {expectedVersion:current.program.version,reconciliationId:session.draft.reconciliationId||null,
      expectedRevision:session.draft.expectedRevision||0,state:session.draft.state,document:clone(session.draft.document)};
  }
  async function review(){
    const body=previewBody(),preview=await api(prefix+'/account-reconciliation-preview',body);
    if(!available())return;
    if(pretty(body)!==pretty(previewBody()))throw new Error('The reconciliation inputs changed while the review was loading. Preview the current input.');
    session.reviewed={body,preview};session.confirmed=false;session.detail=null;session.page=0;
    notice=preview.canApply?'The complete statement, account and retained resolution plan are ready for review.':'The review shows the remaining source or account differences.';
    render();
  }
  async function inspectLegacy(){
    const value=await stored(caseId);if(!available())return;
    if(value)validateDesk(value);
    legacyCopy=value?clone(value):null;legacySearched=true;render();
  }
  async function openLegacy(){
    if(!legacyCopy)throw new Error('Choose an earlier browser copy first.');
    if(session.pending)throw new Error('Keep the current original request until its result is available.');
    const problem=pendingActorProblem(legacyCopy.pending?.body);if(problem)throw problem;
    clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});if(!available())return;
    const revision=session.storageRevision??0;
    download(state(),caseId+'-reconciliation-before-earlier-copy-'+Date.now()+'.json');
    restore(legacyCopy);session.storageRevision=revision;legacyCopy=null;legacySearched=false;report=null;render();
    await persist();if(!available())return;await loadReport();
    notice='Opened the selected earlier copy in this sign-in. Its original browser copy remains available.';render();
  }
  function legacyView(){
    if(!legacySearched)return '';
    if(!legacyCopy)return '<section class="ar-block"><h4>Earlier browser copies</h4><p>No earlier reconciliation desk is saved for this case.</p>'+button('Close','legacy-close')+'</section>';
    const pending=legacyCopy.pending,problem=pendingActorProblem(pending?.body);
    return '<section class="ar-block"><h4>Earlier browser copy</h4>'+
      pairs([['Original case',legacyCopy.caseId],['Original request',pending?.body?.requestId||'No pending request'],['Original operator',pending?.body?.actor||'No pending request']])+
      '<p>'+esc(problem?.message||'Open this selected copy in the current sign-in. This desk is retained as a complete download first.')+'</p><div class="ar-actions">'+
      button('Open selected earlier copy','legacy-open','',!!problem||!!session.pending)+button('Download earlier copy','legacy-download','',false,'data-ar-always="true"')+button('Close','legacy-close')+'</div></section>';
  }
  function preserveDraft(){
    if(session.draft)download(state(),caseId+'-reconciliation-draft-before-opening.json');
  }
  function startDraft(statement){
    if(session.pending)throw new Error('Resume or reconcile the retained original request before opening another draft.');
    if(!statement)throw new Error('Choose an original retained account statement.');
    preserveDraft();
    session.draft={reconciliationId:null,expectedRevision:0,state:'DRAFT',document:{
      name:accountName(statement)+' · '+date(statement.firstDate||day())+' reconciliation',statementSourceId:statement.sourceId,
      periodStart:statement.firstDate||day(),periodEnd:statement.lastDate||day(),links:[],exclusions:[],outstanding:[],note:''}};
    session.editing=true;session.selectedRows=[];session.selectedCash=[];session.tab='compare';changedInput();notice='The movement dates prefill the period. Set the original statement’s actual opening and closing dates, then preview.';render();
  }
  function editEdition(){
    const saved=report?.selected?.record;if(!saved)throw new Error('Open a saved reconciliation edition.');
    if(session.pending)throw new Error('Resume or reconcile the retained original request before opening another draft.');
    preserveDraft();
    const latest=report.reconciliations.find(row=>row.id===saved.id);
    session.draft={reconciliationId:saved.id,expectedRevision:latest?.revision??saved.revision,state:'DRAFT',document:clone(saved.document)};
    session.editing=true;session.selectedRows=[];session.selectedCash=[];session.tab='compare';changedInput();
    notice='Opened edition '+saved.revision+' as editable input for the next original edition. Its saved statement and account remain retained.';render();
  }
  async function dispatch(){
    const pending=session.pending;if(!pending)return;
    let receipt;
    try{
      const problem=pendingActorProblem(pending.body);if(problem)throw problem;
      receipt=await saveApi(prefix+'/account-reconciliation',clone(pending.body));
    }
    catch(problem){
      pending.rejected=[400,409,413,415,422].includes(problem?.status)&&typeof problem?.code==='string';
      pending.error={message:problem?.message||String(problem),code:problem?.code||null,status:problem?.status||null};await persist();throw problem;
    }
    if(!receipt||receipt.id!==caseId||receipt.requestId!==pending.body.requestId||!receipt.selection||!Number.isInteger(receipt.version))throw new Error('The original request is retained until its complete server receipt is received.');
    session.previousRequest={...clone(pending),receipt:clone(receipt)};session.result=clone(receipt);
    session.pending=null;session.draft=null;session.reviewed=null;session.confirmed=false;session.selection=clone(receipt.selection);
    session.selectedRows=[];session.selectedCash=[];session.tab='compare';await persist();
    if(available()){const next=await api(prefix);await onCase(next,receipt);}
  }
  async function save(){
    if(!session.reviewed?.preview?.canApply||!session.confirmed)throw new Error('Review the complete current source and account before saving this edition.');
    if(pretty(previewBody())!==pretty(session.reviewed.body))throw new Error('The reconciliation changed. Preview its current input.');
    const actor=await recordingActor();if(!actor)throw new Error('Enter the recording operator before saving this reconciliation.');
    const body={...clone(session.reviewed.body),expectedPreviewSha256:session.reviewed.preview.previewSha256,actor};
    body.requestId=await mutationId('operations:'+caseId+':account-reconciliation',body);
    session.pending={caseId,kind:'account-reconciliation',createdAt:new Date().toISOString(),body,rejected:false};
    if(!await persist())download(state(),caseId+'-reconciliation-original-request.json');
    render();await dispatch();
  }
  async function reopenRejected(){
    if(!session.pending?.rejected)throw new Error('Resume the exact original request to reconcile its server result.');
    const next=await api(prefix),pending=clone(session.pending);
    const latest=await api(prefix+'/account-reconciliation?expectedVersion='+encodeURIComponent(next.program.version));
    const previousId=pending.body.reconciliationId||null,head=previousId?latest.reconciliations.find(row=>row.id===previousId):null;
    if(previousId&&!head)throw new Error('The original reconciliation is absent from this case. Retain the original request and open its complete source case.');
    session.previousRequest=pending;session.pending=null;
    session.editing=true;session.draft={reconciliationId:previousId,expectedRevision:head?.revision||0,state:pending.body.state,document:clone(pending.body.document)};
    session.reviewed=null;session.confirmed=false;await persist();
    await onCase(next,{version:next.program.version,action:'refresh'});
  }
  async function openDesk(file){
    if(!file)return;
    if(file.size>MAX_DESK_BYTES)throw new Error('Choose a complete reconciliation desk up to 64 MiB.');
    const value=JSON.parse(await file.text());validateDesk(value);if(!available())return;
    const problem=pendingActorProblem(value.pending?.body);if(problem)throw problem;
    if(session.pending)throw new Error('Resume or reconcile this desk’s original request before opening another recovery copy.');
    const revision=session.storageRevision??0;download(state(),caseId+'-reconciliation-before-recovery.json');restore(value);session.storageRevision=revision;report=null;render();
    await persist();await loadReport();notice='Opened the complete original desk. Resume its retained request or preview the editable input against the current case.';render();
  }

  function selectedStatement(){return report?.statements?.find(row=>row.sourceId===session.draft?.document.statementSourceId)||null;}
  function selectionSummary(){
    return '<div class="ar-select-summary" data-ar-selection-summary>'+esc(session.selectedRows.length)+' statement rows and '+esc(session.selectedCash.length)+' cash entries selected for an explicit resolution.</div>';
  }
  function chooser(){
    const statements=report?.statements||[],reconciliations=report?.reconciliations||[];
    const choices=[['','Choose a saved reconciliation'],...reconciliations.map(row=>[pretty({reconciliationId:row.id,revision:row.revision}),row.name+' · edition '+row.revision+' · '+title(row.state)])];
    const selected=report?.selected?.record;
    if(selected&&!reconciliations.some(row=>row.id===selected.id&&row.revision===selected.revision))choices.push([pretty({reconciliationId:selected.id,revision:selected.revision}),selected.document.name+' · edition '+selected.revision+' · '+title(selected.state)]);
    return '<section class="ar-block"><h4>Open an original statement or saved account</h4><div class="ar-toolbar">'+
      field('Retained statement','newStatementId',session.newStatementId||'',{options:[['','Choose a retained statement'],...statements.map(row=>[row.sourceId,accountName(row)+' · '+row.source.filename+' · '+row.currency])]})+
      field('Saved reconciliation','savedSelection',selected?pretty({reconciliationId:selected.id,revision:selected.revision}):'',{options:choices})+
      '<div class="ar-actions">'+button('Start reconciliation','new','',!statements.length||!editable())+button('Open account statements','open-statements')+'</div></div>'+
      (!statements.length?'<p>Receive an original account statement to compare its retained source with the native cash account.</p>':'')+'</section>';
  }
  function requestPanel(){
    if(!session.pending)return '';
    const pending=session.pending;
    return '<section class="ar-block ar-soft"><h4>Retained original request</h4>'+pairs([['Prepared',date(pending.createdAt)],['Operator',pending.body.actor],['Expected case version',pending.body.expectedVersion],['Requested state',title(pending.body.state)],['Request',pending.body.requestId]])+
      '<p>'+esc(pendingActorProblem(pending.body)?.message||(pending.rejected?'The server rejected this request. Its complete original input remains available for correction.':'Resume this exact request to receive its original result, including a result saved before a connection interruption.'))+'</p>'+
      (pending.error?'<p>'+esc(pending.error.message)+'</p>':'')+'<div class="ar-actions">'+button('Resume original request','retry')+
      button('Return rejected input to draft','reopen-request','',!pending.rejected)+button('Download complete desk','desk-export','',false,'data-ar-always="true"')+'</div></section>';
  }
  function draftForm(){
    if(!editing())return session.draft?'<section class="ar-block ar-soft"><h4>Retained editable draft</h4><p>'+esc(session.draft.document.name)+' remains available while you view saved editions.</p><div class="ar-actions">'+button('Return to draft','return-draft')+button('Download complete desk','desk-export','',false,'data-ar-always="true"')+'</div></section>':'';
    const draft=session.draft,document=draft.document,statement=selectedStatement();
    return '<section class="ar-block"><h4>'+esc(draft.reconciliationId?'Prepare the next reconciliation edition':'Prepare account reconciliation')+'</h4>'+
      (statement?pairs([['Account',accountName(statement)],['Original file',statement.source.filename],['Currency',statement.currency],['Network',statement.network||'Unspecified'],['Asset',statement.asset||'Unspecified'],['Original statement source',statement.sourceId]]):'')+
      '<form data-ar-document><div class="ar-form">'+
      field('Reconciliation name','document.name',document.name,{required:true,wide:true})+
      field('Period opens','document.periodStart',document.periodStart,{type:'date',required:true,help:'Set the original statement period. First and last movement dates are suggestions.'})+
      field('Period closes','document.periodEnd',document.periodEnd,{type:'date',required:true})+
      field('Save as','draft.state',draft.state,{options:[['DRAFT','Draft reconciliation'],['CLOSED','Closed period']],help:'A closed period preserves this complete reconciliation. Later native activity remains visible in a new comparison.'})+
      field('Account note','document.note',document.note,{area:true,wide:true})+
      '</div><div class="ar-actions">'+button('Preview complete reconciliation','preview','',!editable(),'class="ar-primary"')+
      button('Download editable inputs','inputs-export')+button('Download complete desk','desk-export','',false,'data-ar-always="true"')+
      button('Browse saved account','browse-saved','',!report?.selected)+'</div></form></section>';
  }
  function editionHeading(){
    const saved=report?.selected?.record;
    if(!saved||editing())return '';
    const comparison=report.comparison;
    return '<section class="ar-block"><div class="ar-split-actions"><div><h4>'+esc(saved.document.name)+'</h4><p>Edition '+saved.revision+' · '+badge(saved.state)+' · '+esc(date(saved.recordedAt))+' · '+esc(saved.recordedBy)+'</p></div><div class="ar-actions">'+
      button('Open as next draft','edit-edition','',!editable())+button('Download complete account','account-export')+'</div></div>'+
      pairs([['Original period',date(saved.document.periodStart)+' – '+date(saved.document.periodEnd)],['Saved case version',saved.fromVersion],['Recorded case version',saved.version],['Source file',sourceName(report.selected.source.id)]])+
      '<div class="ar-actions">'+button('Current account comparison','show-current','',session.view==='current')+button('Original saved comparison','show-saved','',session.view==='saved')+'</div>'+
      (comparison?'<p>'+esc(comparison.cashChanged?'The native account changed after this edition. Current and saved values are shown separately.':'The current native cash facts match this saved edition.')+'</p>':'')+
      (comparison?.changed?table(['Comparison','Saved edition','Current account'],[
        ['Source-anchored difference',amount(comparison.savedSourceDifference,saved.preview.selection.currency),amount(comparison.currentSourceDifference,saved.preview.selection.currency)],
        ['Difference after outstanding items',amount(comparison.savedRemainingDifference,saved.preview.selection.currency),amount(comparison.currentRemainingDifference,saved.preview.selection.currency)],
        ['Ready to close',esc(comparison.savedCanClose?'Yes':'No'),esc(comparison.currentCanClose?'Yes':'No')]
      ]):'')+
      (comparison?.cashChanged?'<div class="ar-actions">'+[...(comparison.addedCashIds||[]),...(comparison.changedCashIds||[])].map(id=>button(cashName(id),'open-cash',id)).join('')+'</div>':'')+'</section>';
  }
  function metrics(entries){
    return '<div class="ar-metrics">'+entries.map(([name,value])=>'<div class="ar-metric"><span>'+esc(name)+'</span><strong>'+value+'</strong></div>').join('')+'</div>';
  }
  function comparisonPanel(preview){
    const totals=preview.totals,currency=preview.selection.currency,counts=preview.counts;
    return '<section class="ar-block"><h4>Original statement and complete native account</h4>'+
      pairs([['Account',preview.statement.accountLabel||preview.statement.accountId],['Period',date(preview.selection.startDate)+' – '+date(preview.selection.endDate)],['Case version',preview.expectedVersion],['Network',preview.selection.network||'Unspecified'],['Asset',preview.selection.asset||'Unspecified'],['Source balance',title(totals.statement.balanceStatus)]])+
      metrics([['Original statement opening',amount(totals.statement.openingBalance,currency)],['Original statement closing',amount(totals.statement.closingBalance,currency)],['Complete native period movement',amount(totals.ledger.net,currency)],['Source-anchored native closing',amount(totals.reconciliation.sourceAnchoredLedgerClosing,currency)],['Difference against statement',amount(totals.reconciliation.sourceDifference,currency)],['Explicit outstanding movement',amount(totals.outstanding.net,currency)],['Closing after outstanding items',amount(totals.reconciliation.sourceAnchoredClearedClosing,currency)],['Remaining difference',amount(totals.reconciliation.remainingDifference,currency)]])+
      '<p>The original statement opening anchors this comparison. The account includes every eligible native movement in the selected period. Explicit outstanding items remain individually recorded in the resolution plan.</p>'+
      table(['Population','Rows','Matched','Outstanding / unresolved'],[
        ['Original statement',esc(counts.sourceRows),esc(counts.matchedSourceRows),esc(preview.sourceRows.filter(row=>['SOURCE_ONLY','CHANGED','EXCLUDED'].includes(row.status)).length)+' need source or cash resolution'],
        ['Eligible native account',esc(counts.ledgerRows),esc(counts.matchedLedgerRows),esc(counts.outstandingRows)+' outstanding; '+esc(counts.ledgerOnlyRows)+' without a statement match']
      ])+
      '<div class="ar-actions">'+sourceButton(preview.statement.source.id,'Download original statement')+sourceButton(preview.statement.reviewSource.id,'Download original intake review')+
      button('Open original statement inputs','open-original-statement',preview.selection.statementSourceId)+button('Open cash account','open-cash')+'</div>'+
      details('Original statement balances and source summary',{balance:preview.statement.originalBalance,summary:preview.statement.originalSummary})+'</section>'+
      findingsPanel(preview)+reviewPanel(preview);
  }
  function findingsPanel(preview){
    const findings=preview.findings||[];
    return '<section class="ar-block"><h4>'+esc(findings.length?'Reconciliation findings':'Account comparison reviewed')+'</h4>'+
      (findings.length?'<ul class="ar-list">'+findings.map(item=>'<li><strong>'+esc(title(item.severity))+' · '+esc(item.message)+'</strong>'+
        (item.rowNumbers?.length?'<small>Statement rows '+item.rowNumbers.map(esc).join(', ')+'</small>':'')+
        (item.cashIds?.length?'<div class="ar-actions">'+item.cashIds.map(id=>button(cashName(id),'open-cash',id)).join('')+'</div>':'')+'</li>').join('')+'</ul>':'<p>The source and native account comparison has no remaining findings.</p>')+'</section>';
  }
  function reviewPanel(preview){
    if(!editing())return '';
    return '<section class="ar-block ar-close-summary"><h4>'+esc(preview.requestedState==='CLOSED'?'Review period close':'Review draft reconciliation')+'</h4>'+
      '<p>'+esc(preview.canClose?'Every meaningful source row and eligible native movement is resolved, and the source-anchored closing difference is zero.':'A draft can retain unresolved work. Closing requires the original statement period and balances, all meaningful source movements resolved, each native movement matched or explicitly outstanding, and a zero closing difference.')+'</p>'+
      '<label class="ar-check"><input type="checkbox" data-ar-confirm'+(session.confirmed?' checked':'')+'>I reviewed the original statement period, complete native account, explicit matches and outstanding items shown in this comparison.</label>'+
      '<div class="ar-actions">'+button(preview.requestedState==='CLOSED'?'Save closed period':'Save draft edition','save','',!preview.canApply,'class="ar-primary"')+
      (preview.requestedState==='CLOSED'&&!preview.canClose?button('Review as draft','review-as-draft'):'')+button('Download complete review','review-export')+'</div></section>';
  }
  function filterPanel(rows){
    const statuses=[...new Set(rows.map(row=>row.status).filter(Boolean))].sort();
    return '<div class="ar-toolbar">'+field('Find original rows or references','filter.query',session.filter.query)+
      field('Review status','filter.status',session.filter.status,{options:[['','All statuses'],...statuses.map(value=>[value,title(value)])]})+
      '<div class="ar-actions">'+button('Apply filter','filter')+button('Clear filter','filter-clear')+'</div></div>';
  }
  function pageRows(rows){
    const query=session.filter.query.trim().toLowerCase();
    const filtered=rows.filter(row=>(!session.filter.status||row.status===session.filter.status)&&(!query||pretty(row).toLowerCase().includes(query)));
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));session.page=Math.min(session.page,pages-1);
    return {rows:filtered.slice(session.page*PAGE_SIZE,(session.page+1)*PAGE_SIZE),navigation:'<div class="ar-page">'+button('Previous','previous','',session.page===0)+'<span>Page '+(session.page+1)+' of '+pages+' · '+filtered.length+' records</span>'+button('Next','next','',session.page+1>=pages)+'</div>'};
  }
  function sourceRowsPanel(preview){
    const all=preview.sourceRows,page=pageRows(all),currency=preview.selection.currency;
    return '<section class="ar-block"><h4>Original statement movements</h4>'+filterPanel(all)+(editing()?selectionSummary():'')+
      table(['Select','Source row','Date','Reference / description','Movement','Resolution','Current cash','Details'],page.rows.map(row=>[
        editing()?'<input type="checkbox" data-ar-row="'+row.rowNumber+'" aria-label="Select statement row '+row.rowNumber+'"'+(session.selectedRows.includes(row.rowNumber)?' checked':'')+'>':'',
        esc(row.rowNumber),esc(date(row.date)),esc(row.reference||'')+'<small>'+esc(row.description||'')+'</small>',amount(row.signedAmount,currency),badge(row.status)+(row.reason?'<small>'+esc(row.reason)+'</small>':''),
        '<div class="ar-actions">'+row.cashIds.map(id=>button(cashName(id),'open-cash',id)).join('')+'</div>',
        button('Original row','inspect-row',row.rowNumber)
      ]))+page.navigation+'</section>';
  }
  function cashRowsPanel(preview){
    const all=preview.transactions,page=pageRows(all),currency=preview.selection.currency;
    return '<section class="ar-block"><h4>Complete native account population</h4><p>Current account movements and original excluded, void, testnet, other-account and outside-period records retain their own status.</p>'+
      filterPanel(all)+(editing()?selectionSummary():'')+
      table(['Select','Date / reference','Movement','Native state','Resolution','Original source rows','Open'],page.rows.map(row=>[
        editing()?'<input type="checkbox" data-ar-cash="'+esc(row.id)+'" aria-label="'+esc('Select '+cashName(row.id))+'"'+(session.selectedCash.includes(row.id)?' checked':'')+(!row.eligible?' disabled data-ar-fixed="true"':'')+'>':'',
        esc(date(row.date))+'<small>'+esc(row.externalRef||title(row.category))+'</small>',amount(row.signedAmount,row.currency||currency),badge(row.state),badge(row.status)+(row.reason?'<small>'+esc(row.reason)+'</small>':''),
        row.sourceRowNumbers.map(esc).join(', ')||'—',button('Details','inspect-cash',row.id)+' '+button('Cash workflow','open-cash',row.id)
      ]))+page.navigation+'</section>';
  }
  function matchesPanel(preview){
    const all=preview.matches,page=pageRows(all),currency=preview.selection.currency;
    return '<section class="ar-block"><h4>Source-to-cash matches</h4><p>Each group contains whole original statement rows and complete native cash records. The signed source and native totals remain visible together.</p>'+filterPanel(all)+
      table(['Match','Source rows','Current cash','Source net','Cash net','Difference','Reason'],page.rows.map(row=>[
        badge(row.kind)+'<small>'+esc(title(row.status))+'</small>',row.rowNumbers.map(esc).join(', '),
        '<div class="ar-actions">'+row.cashIds.map(id=>button(cashName(id),'open-cash',id)).join('')+'</div>',amount(row.sourceNet,currency),amount(row.ledgerNet,currency),amount(row.difference,currency),esc(row.reason||'')
      ]))+page.navigation+'</section>';
  }
  function resolutionSlice(key,rows){
    session.resolutionPages||={};const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    const index=Math.min(session.resolutionPages[key]||0,pages-1);session.resolutionPages[key]=index;
    return {rows:rows.slice(index*PAGE_SIZE,(index+1)*PAGE_SIZE),offset:index*PAGE_SIZE,navigation:'<div class="ar-page">'+button('Previous','resolution-previous',key,index===0)+'<span>Page '+(index+1)+' of '+pages+' · '+rows.length+' entries</span>'+button('Next','resolution-next',key,index+1>=pages)+'</div>'};
  }
  function resolutionPanel(preview){
    const document=editing()?session.draft.document:preview.document,editor=session.editor;
    const links=resolutionSlice('links',document.links),exclusions=resolutionSlice('exclusions',document.exclusions),outstanding=resolutionSlice('outstanding',document.outstanding);
    return '<section class="ar-block"><h4>Explicit matches and outstanding items</h4>'+
      (editing()?'<p>Select original statement rows and native cash entries in their tables, then retain an explicit whole-record resolution below.</p>'+selectionSummary()+
        '<div class="ar-form">'+field('Reason for linking the selected rows and cash','editor.linkReason',editor.linkReason,{area:true,wide:true})+'</div><div class="ar-actions">'+button('Link selected source and cash','add-link','',!session.selectedRows.length||!session.selectedCash.length)+'</div>':'')+
      '<h5>Explicit source-to-cash groups</h5>'+table(['Original source rows','Native cash entries','Reason','Edit'],links.rows.map((row,index)=>[
        row.rowNumbers.map(esc).join(', '),row.cashIds.map(id=>esc(cashName(id))).join('<br>'),esc(row.reason),editing()?button('Remove group','remove-link',index+links.offset):''
      ]))+links.navigation+'</section>'+
      '<section class="ar-block"><h4>Outstanding native movements</h4>'+
      (editing()?'<p>Retain an individual explanation for each current native movement expected to clear outside this statement. Its full signed amount remains in the original account and is shown separately in the source-anchored comparison.</p><div class="ar-form">'+
        field('Outstanding reason','editor.outstandingReason',editor.outstandingReason,{area:true,wide:true})+
        field('Expected clearing date','editor.expectedClearDate',editor.expectedClearDate,{type:'date'})+
        field('Supporting original sources','editor.sourceIds',editor.sourceIds,{options:current.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+
        '</div><div class="ar-actions">'+button('Record selected cash as outstanding','add-outstanding','',!session.selectedCash.length)+'</div>':'')+
      table(['Native cash entry','Reason','Expected clearing','Original sources','Edit'],outstanding.rows.map((row,index)=>[
        esc(cashName(row.cashId)),esc(row.reason),esc(date(row.expectedClearDate)),row.sourceIds.map(id=>sourceButton(id)).join(' '),editing()?button('Remove outstanding item','remove-outstanding',index+outstanding.offset):''
      ]))+outstanding.navigation+'</section>'+
      '<section class="ar-block"><h4>Excluded statement rows</h4>'+
      (editing()?'<p>Retain the reason for setting aside an original source row. Nonzero statement movements still require an actual cash resolution before period close.</p><div class="ar-form">'+field('Original row exclusion reason','editor.excludedReason',editor.excludedReason,{area:true,wide:true})+
        '</div><div class="ar-actions">'+button('Record selected source-row exclusions','add-exclusion','',!session.selectedRows.length)+'</div>':'')+
      table(['Original row','Reason','Edit'],exclusions.rows.map((row,index)=>[esc(row.rowNumber),esc(row.reason),editing()?button('Remove exclusion','remove-exclusion',index+exclusions.offset):'']))+exclusions.navigation+'</section>';
  }
  function historyPanel(){
    const rows=report?.history||[];
    return '<section class="ar-block"><h4>Original reconciliation editions</h4>'+table(['Edition','State','Recorded','Operator','Period','Difference','Open'],rows.map(item=>{
      const row=item.record;return [esc(row.revision),badge(row.state),esc(date(row.recordedAt)),esc(row.recordedBy),esc(date(row.document.periodStart)+' – '+date(row.document.periodEnd)),amount(row.preview.totals.reconciliation.remainingDifference,row.preview.selection.currency),
        button('Open edition','open-edition',pretty({reconciliationId:row.id,revision:row.revision}))+' '+sourceButton(item.source.id,'Original source')];
    }))+'</section>';
  }
  function sourcesPanel(preview){
    const ids=new Set([preview.statement.source.id,preview.statement.reviewSource.id,report?.selected?.source?.id]);
    for(const row of [...preview.matches,...preview.sourceRows,...preview.transactions])for(const id of row.correctionSourceIds||[])ids.add(id);
    for(const row of preview.document.outstanding)for(const id of row.sourceIds)ids.add(id);
    ids.delete(undefined);ids.delete(null);
    const sources=[...ids].map(id=>current.sources.find(row=>row.id===id)||{id,filename:id});
    return '<section class="ar-block"><h4>Retained original sources</h4>'+table(['Original file','Bytes','SHA-256','Open'],sources.map(row=>[
      esc(row.filename),esc(row.bytes??row.size??'—'),'<span class="ar-identity">'+esc(row.sha256||'')+'</span>',sourceButton(row.id,'Download original')
    ]))+'<div class="ar-actions">'+button('Open original statement inputs','open-original-statement',preview.selection.statementSourceId)+button('Download complete review','review-export')+(report?.selected&&!editing()?button('Download complete account','account-export'):'')+'</div>'+
      details('Original account selection and source binding',{selection:preview.selection,inputSha256:preview.inputSha256,cashBasisSha256:preview.cashBasisSha256,previewSha256:preview.previewSha256})+'</section>';
  }
  function detailPanel(preview){
    if(!session.detail)return '';
    const value=session.detail.kind==='row'?preview.sourceRows.find(row=>row.rowNumber===Number(session.detail.id)):preview.transactions.find(row=>row.id===session.detail.id);
    if(!value)return '';
    return '<section class="ar-block"><div class="ar-split-actions"><h4>'+esc(session.detail.kind==='row'?'Original statement row '+value.rowNumber:'Native cash movement')+'</h4>'+button('Close detail','close-detail')+'</div>'+
      (session.detail.kind==='row'?pairs([['Reference',value.reference],['Date',date(value.date)],['Description',value.description],['Resolution',title(value.status)],['Original cash',value.originalCashId||'—']])+details('Every original source cell',value.original):
        pairs([['Reference',value.externalRef],['Date',date(value.date)],['Currency',value.currency],['Network',value.network||'Unspecified'],['Asset',value.asset||'Unspecified'],['Recorded state',title(value.state)]])+
        '<div class="ar-actions">'+button('Open original cash workflow','open-cash',value.id)+'</div>')+
      details('Complete original record and resolution',value)+'</section>';
  }
  function previewArea(){
    const preview=currentPreview();
    if(!preview)return empty(editing()?'Preview the current reconciliation inputs to compare the complete statement and native account. The retained resolution plan remains editable below.':'Choose an original retained statement or open a saved reconciliation.')+(editing()?resolutionPanel(null):'');
    session.selectedRows=session.selectedRows.filter(number=>preview.sourceRows.some(row=>row.rowNumber===number));
    session.selectedCash=session.selectedCash.filter(id=>preview.transactions.some(row=>row.id===id&&row.eligible));
    const tabs=[['compare','Account comparison'],['source','Statement rows'],['cash','Cash entries'],['matches','Matches'],['resolutions','Resolution plan'],['history','Saved editions'],['sources','Original files']];
    if(!tabs.some(([id])=>id===session.tab))session.tab='compare';
    return '<nav class="ar-tabs" aria-label="Account reconciliation views">'+tabs.map(([id,text])=>'<button type="button" data-ar-tab="'+id+'"'+(session.tab===id?' aria-current="page"':'')+'>'+esc(text)+'</button>').join('')+'</nav>'+
      ({compare:comparisonPanel,source:sourceRowsPanel,cash:cashRowsPanel,matches:matchesPanel,resolutions:resolutionPanel,history:historyPanel,sources:sourcesPanel}[session.tab])(preview)+detailPanel(preview);
  }
  function render(){
    if(!available())return;
    root.innerHTML='<header class="ar-heading"><div><h3>Account reconciliation</h3><p>Compare a complete original statement with its native account, retain explicit resolutions and reopen every saved period.</p><small>'+esc(current.program.name)+' · case version '+esc(current.program.version)+' · '+esc(title(current.program.state))+'</small></div><div class="ar-actions">'+
      button('Refresh case','refresh')+button('Download complete desk','desk-export','',false,'data-ar-always="true"')+button('Open recovery copy','desk-import','',!!session.pending)+
      (session.storageConflict?button('Open saved browser desk','load-stored','',!!session.pending):'')+(boundStaff?button('Find earlier browser copy','legacy-inspect','',!!session.pending):'')+'</div></header>'+
      '<p class="ar-error" data-ar-error role="alert"></p><p class="ar-notice" data-ar-status role="status" aria-live="polite"></p><p class="ar-storage" data-ar-storage></p>'+
      legacyView()+requestPanel()+chooser()+draftForm()+editionHeading()+'<div class="ar-preview">'+previewArea()+'</div>'+
      (session.result?'<section class="ar-block"><h4>Last recorded reconciliation</h4>'+pairs([['Recorded',title(session.result.state)],['Edition',session.result.revision],['Case version',session.result.version],['Original request',session.result.requestId]])+
        '<div class="ar-actions">'+button('Download original result','result-export','',false,'data-ar-always="true"')+'</div></section>':'')+
      '<input type="file" data-ar-file accept=".json,application/json" hidden>';
    status();controls();
  }

  function requireDraft(){
    if(!editing())throw new Error('Open a new reconciliation or the next editable edition to retain a resolution.');
    return session.draft.document;
  }
  function openSelection(selection){
    return run(async()=>{
      const previous=clone(session.selection),wasEditing=session.editing;
      session.selection=clone(selection);session.editing=false;session.detail=null;session.page=0;
      try{await loadReport();render();}
      catch(problem){session.selection=previous;session.editing=wasEditing;throw problem;}
    });
  }
  function captureField(node){
    const key=node.dataset.arField;if(!key)return;
    const value=node.multiple?[...node.selectedOptions].map(option=>option.value):node.value;
    if(key.startsWith('document.')){requireDraft()[key.slice(9)]=value;changedInput();}
    else if(key==='draft.state'){requireDraft();session.draft.state=value;changedInput();}
    else if(key.startsWith('editor.')){session.editor[key.slice(7)]=value;schedule();}
    else if(key.startsWith('filter.')){session.filter[key.slice(7)]=value;schedule();}
    else if(key==='newStatementId'){session.newStatementId=value;schedule();}
  }
  function addLink(){
    const document=requireDraft(),rowNumbers=[...session.selectedRows],cashIds=[...session.selectedCash],reason=session.editor.linkReason.trim();
    if(!rowNumbers.length||!cashIds.length||!reason)throw new Error('Select complete source rows and cash entries, and retain the reason for their explicit match.');
    if(document.links.some(link=>link.rowNumbers.some(row=>rowNumbers.includes(row))||link.cashIds.some(id=>cashIds.includes(id))))throw new Error('Remove the earlier explicit group before assigning one of its rows or cash entries to another group.');
    if(document.exclusions.some(row=>rowNumbers.includes(row.rowNumber))||document.outstanding.some(row=>cashIds.includes(row.cashId)))throw new Error('Remove the selected row exclusion or outstanding item before linking those same original records.');
    document.links.push({rowNumbers,cashIds,reason});session.selectedRows=[];session.selectedCash=[];session.editor.linkReason='';changedInput();render();
  }
  function addOutstanding(){
    const document=requireDraft(),reason=session.editor.outstandingReason.trim();
    if(!session.selectedCash.length||!reason)throw new Error('Select the native cash movements and retain their outstanding-item reason.');
    if(document.links.some(link=>link.cashIds.some(id=>session.selectedCash.includes(id))))throw new Error('Remove the selected cash entry from its explicit match before recording it as outstanding.');
    for(const cashId of session.selectedCash){
      const entry={cashId,reason,expectedClearDate:session.editor.expectedClearDate||null,sourceIds:clone(session.editor.sourceIds)};
      const index=document.outstanding.findIndex(row=>row.cashId===cashId);if(index<0)document.outstanding.push(entry);else document.outstanding[index]=entry;
    }
    session.selectedCash=[];changedInput();render();
  }
  function addExclusion(){
    const document=requireDraft(),reason=session.editor.excludedReason.trim();
    if(!session.selectedRows.length||!reason)throw new Error('Select the original statement rows and retain their exclusion reason.');
    if(document.links.some(link=>link.rowNumbers.some(number=>session.selectedRows.includes(number))))throw new Error('Remove the selected source row from its explicit match before recording an exclusion.');
    for(const rowNumber of session.selectedRows){
      const entry={rowNumber,reason},index=document.exclusions.findIndex(row=>row.rowNumber===rowNumber);
      if(index<0)document.exclusions.push(entry);else document.exclusions[index]=entry;
    }
    session.selectedRows=[];changedInput();render();
  }
  async function openOriginalStatement(sourceId){
    if(!sourceId){await persist();await onOpen('statements');return;}
    const value=await api(prefix+'/account-reconciliation-statements/'+encodeURIComponent(sourceId)+'/inputs');
    if(value.caseId!==caseId||!value.inputs?.source?.contentBase64)throw new Error('The original statement input must include its complete source bytes and mapping.');
    await persist();await onOpen('statements',{inputs:clone(value.inputs),statementSourceId:value.statementSourceId,reviewSourceId:value.reviewSourceId,expectedVersion:value.expectedVersion});
  }
  root.addEventListener('input',event=>{
    if(!available()||busy||hostBusy||session.pending||!event.target.matches('[data-ar-field]'))return;
    try{captureField(event.target);}catch(problem){error=problem.message;status();}
  });
  root.addEventListener('change',event=>{
    if(!available()||busy||hostBusy||session.pending)return;
    const target=event.target;
    if(target.matches('[data-ar-file]')){const file=target.files?.[0];target.value='';run(()=>openDesk(file));return;}
    if(target.matches('[data-ar-confirm]')){session.confirmed=target.checked;controls();return;}
    if(target.matches('[data-ar-row]')){
      const id=Number(target.dataset.arRow);session.selectedRows=target.checked?[...new Set([...session.selectedRows,id])]:session.selectedRows.filter(value=>value!==id);
      const node=$('[data-ar-selection-summary]');if(node)node.outerHTML=selectionSummary();schedule();return;
    }
    if(target.matches('[data-ar-cash]')){
      const id=target.dataset.arCash;session.selectedCash=target.checked?[...new Set([...session.selectedCash,id])]:session.selectedCash.filter(value=>value!==id);
      const node=$('[data-ar-selection-summary]');if(node)node.outerHTML=selectionSummary();schedule();return;
    }
    if(target.dataset.arField==='savedSelection'){
      if(target.value){try{openSelection(JSON.parse(target.value));}catch(problem){error=problem.message;status();}}
      return;
    }
    if(target.matches('[data-ar-field]')){
      try{captureField(target);}catch(problem){error=problem.message;status();}
    }
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-ar-document]'))return;
    event.preventDefault();if(!session.pending)run(review);
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.dataset.arField==='filter.query'){
      event.preventDefault();session.page=0;render();
    }
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-ar-action],[data-ar-tab]');
    if(!target||!root.contains(target)||target.disabled||!available())return;
    if(target.dataset.arTab){
      if(busy||hostBusy||session.pending)return;
      session.tab=target.dataset.arTab;session.page=0;session.filter.status='';session.detail=null;schedule();render();return;
    }
    const action=target.dataset.arAction,id=target.dataset.id||'';
    if(action==='desk-export'){download(state(),caseId+'-account-reconciliation-desk.json');return;}
    if(action==='result-export'){download(session.result,caseId+'-account-reconciliation-result.json');return;}
    if(action==='legacy-download'&&legacyCopy){download(legacyCopy,caseId+'-earlier-reconciliation-desk.json');return;}
    if(busy||hostBusy)return;
    if(session.pending&&!['retry','reopen-request'].includes(action))return;
    if(action==='retry'){run(dispatch);return;}
    if(action==='reopen-request'){run(reopenRejected);return;}
    if(action==='legacy-inspect'){run(inspectLegacy);return;}
    if(action==='legacy-open'){run(openLegacy);return;}
    if(action==='legacy-close'){legacyCopy=null;legacySearched=false;render();return;}
    if(action==='new'){run(async()=>{startDraft(report?.statements?.find(row=>row.sourceId===session.newStatementId));await persist();});return;}
    if(action==='edit-edition'){run(async()=>{editEdition();await persist();});return;}
    if(action==='return-draft'){session.editing=true;session.tab='compare';session.detail=null;render();schedule();return;}
    if(action==='browse-saved'){session.editing=false;session.tab='compare';session.detail=null;render();schedule();return;}
    if(action==='preview'){run(review);return;}
    if(action==='review-as-draft'){run(async()=>{requireDraft();session.draft.state='DRAFT';changedInput();await review();});return;}
    if(action==='save'){run(save);return;}
    if(action==='refresh'){run(async()=>{const next=await api(prefix);await onCase(next,{version:next.program.version,action:'refresh'});});return;}
    if(action==='desk-import'){$('[data-ar-file]').click();return;}
    if(action==='load-stored'){
      run(async()=>{
        await session.storageWrites.catch(()=>{});const value=await ownStored(caseId);if(!available())return;if(!value)throw new Error('No saved reconciliation desk is available in this browser.');
        validateDesk(value);download(state(),caseId+'-reconciliation-before-saved-browser-copy.json');restore(value);report=null;render();await loadReport();render();
      });return;
    }
    if(action==='source'){run(async()=>{const response=await api(prefix+'/sources/'+encodeURIComponent(id),undefined,{download:true});download(await response.blob(),sourceName(id));});return;}
    if(action==='inputs-export'){run(async()=>download(previewBody(),caseId+'-account-reconciliation-inputs.json'));return;}
    if(action==='review-export'){run(async()=>{const value=currentPreview();if(!value)throw new Error('Preview or open a saved account comparison first.');download(value,caseId+'-account-reconciliation-review.json');});return;}
    if(action==='account-export'){
      run(async()=>{
        if(editing()||!report?.selected)throw new Error('Open the saved reconciliation edition to download its complete original account.');
        const response=await api(prefix+'/account-reconciliation/export.zip?'+accountQuery(true),undefined,{download:true});
        download(await response.blob(),caseId+'-account-reconciliation-edition-'+report.selected.record.revision+'.zip');
      });return;
    }
    if(action==='open-statements'){run(()=>openOriginalStatement(null));return;}
    if(action==='open-original-statement'){run(()=>openOriginalStatement(id));return;}
    if(action==='open-cash'){run(async()=>{await persist();const selected=currentPreview()?.selection;await onOpen('cash',id?{cashId:id}:selected?{selection:{network:selected.network,currency:selected.currency,asset:selected.asset,startDate:selected.startDate,endDate:selected.endDate}}:undefined);});return;}
    if(action==='open-edition'){try{openSelection(JSON.parse(id));}catch(problem){error=problem.message;status();}return;}
    if(action==='show-current'||action==='show-saved'){session.view=action==='show-current'?'current':'saved';session.detail=null;session.page=0;render();schedule();return;}
    if(action==='inspect-row'||action==='inspect-cash'){session.detail={kind:action==='inspect-row'?'row':'cash',id};render();root.querySelector('.ar-preview>.ar-block:last-child')?.scrollIntoView({block:'nearest'});return;}
    if(action==='close-detail'){session.detail=null;render();return;}
    if(action==='filter'){session.page=0;render();schedule();return;}
    if(action==='filter-clear'){session.filter={query:'',status:''};session.page=0;render();schedule();return;}
    if(action==='previous'||action==='next'){session.page=Math.max(0,session.page+(action==='previous'?-1:1));session.detail=null;render();return;}
    if(action==='resolution-previous'||action==='resolution-next'){
      session.resolutionPages||={};session.resolutionPages[id]=Math.max(0,(session.resolutionPages[id]||0)+(action==='resolution-previous'?-1:1));render();return;
    }
    if(action==='add-link'){run(async()=>addLink());return;}
    if(action==='add-outstanding'){run(async()=>addOutstanding());return;}
    if(action==='add-exclusion'){run(async()=>addExclusion());return;}
    if(['remove-link','remove-outstanding','remove-exclusion'].includes(action)){
      run(async()=>{
        const document=requireDraft(),key={'remove-link':'links','remove-outstanding':'outstanding','remove-exclusion':'exclusions'}[action],index=Number(id);
        if(!Number.isInteger(index)||index<0||index>=document[key].length)throw new Error('Open the current retained resolution entry before editing it.');
        document[key].splice(index,1);changedInput();render();
      });
    }
  });
  async function initialize(){
    if(!session.initialized){
      session.initializing||=(async()=>{
        try{
          const previous=await ownStored(caseId);session.storageRevision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
          if(previous?.schema===DESK_SCHEMA&&previous.caseId===caseId)restore(previous);
          else{
            const origin=current.origin?.accountReconciliation||current.program.origin?.accountReconciliation;
            if(origin?.reconciliationId)session.selection={reconciliationId:origin.reconciliationId,revision:origin.revision};
          }
        }catch{storageNote='Browser draft storage is unavailable. Download a complete recovery copy to retain the original input.';}
        session.initialized=true;
      })();
      await session.initializing;
    }
    await session.storageWrites.catch(()=>{});
    if(!available())return;
    if(session.incomingSelection){session.selection=clone(session.incomingSelection);session.editing=false;delete session.incomingSelection;}
    render();await loadReport();render();
  }
  function currentSavedWorkflow(){
    const record=report?.selected?.record;
    if(!available()||!record)return null;
    return {caseId:report.case.id,expectedVersion:report.case.version,kind:'account-reconciliation',
      reconciliationId:record.id,revision:record.revision};
  }
  const ready=initialize().catch(problem=>{if(available()){error=problem?.message||String(problem);render();}});
  return {ready,currentSavedWorkflow,setHostBusy(value){hostBusy=!!value;controls();},dispose(){active=false;loadSequence++;clearTimeout(saveTimer);if(session.initialized)persist();}};
}
