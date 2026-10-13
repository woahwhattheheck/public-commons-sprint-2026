// Complete delivery risk and mitigation desk on the original Operations case.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
import {createDeliveryRiskComparison} from './operations_risk_comparison.mjs';
const SCHEMA='stellar-forge.sf47-delivery-risks.v1';
const DESK='stellar-forge.sf47-delivery-risk-desk.v1';
const clone=value=>structuredClone(value);
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const enc=encodeURIComponent;
const today=()=>new Date().toISOString().slice(0,10);
const id=prefix=>prefix+'-'+crypto.randomUUID().replaceAll('-','');
const hex=/^[0-9a-f]{64}$/;
const optionValues=values=>values.map(v=>[v,words(v)]);
const ENUMS={
  kind:['RISK','ISSUE'],category:['DELIVERY','STAFFING','CUSTOMER','FUNDING','TECHNICAL','SECURITY','EXTERNAL','OTHER'],
  status:['OPEN','MONITORING','MITIGATING','RESOLVED','CLOSED'],
  likelihood:['UNASSESSED','UNLIKELY','POSSIBLE','LIKELY','NOT_APPLICABLE'],
  impact:['UNASSESSED','MINOR','MODERATE','MAJOR'],priority:['UNASSESSED','LOW','MEDIUM','HIGH'],
  actionStatus:['PLANNED','IN_PROGRESS','DONE','CANCELLED']
};
const properties=values=>Object.entries(values).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('');
const button=(label,action,values={},disabled=false)=>'<button type="button" data-risk-action="'+action+'"'+properties(values)+(disabled?' disabled data-risk-fixed="true"':'')+'>'+esc(label)+'</button>';
const empty=message=>'<p class="risk-empty">'+esc(message)+'</p>';
const badge=value=>'<span class="risk-badge">'+esc(words(value))+'</span>';
const details=(label,value)=>'<details><summary>'+esc(label)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
function table(headers,rows){return '<div class="risk-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function field(label,value,config={}){
  const p={...config.attrs};
  if(config.required)p.required='required';
  if(config.disabled){p.disabled='disabled';p['data-risk-fixed']='true';}
  let control;
  if(config.options)control='<select'+properties(p)+(config.multiple?' multiple size="5"':'')+'>'+config.options.map(([key,text,disabled])=>'<option value="'+esc(key)+'"'+((config.multiple?(value||[]).includes(key):String(value??'')===String(key))?' selected':'')+(disabled?' disabled':'')+'>'+esc(text)+'</option>').join('')+'</select>';
  else if(config.area)control='<textarea rows="'+(config.rows||3)+'"'+properties(p)+'>'+esc(value)+'</textarea>';
  else control='<input type="'+(config.type||'text')+'" value="'+esc(value)+'"'+properties(p)+'>';
  return '<label'+(config.wide?' class="risk-wide"':'')+'>'+esc(label)+control+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';
}
function download(blob,name){
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function documentShape(value){
  need(plain(value)&&value.schema===SCHEMA&&Array.isArray(value.risks)&&value.risks.length<=200,'Select one complete native delivery risk document with at most 200 entries.');
  for(const risk of value.risks)need(plain(risk)&&typeof risk.id==='string'&&Array.isArray(risk.actions)&&risk.actions.length<=100&&Array.isArray(risk.sourceIds)&&Array.isArray(risk.costIds)&&plain(risk.review)&&plain(risk.resolution)&&risk.actions.every(a=>plain(a)&&Array.isArray(a.sourceIds)),'Keep every complete risk, dated review, resolution and mitigation action.');
  return value;
}

function reportShape(value){
  need(plain(value)&&plain(value.counts)&&Array.isArray(value.entries)&&value.entries.every(row=>plain(row)&&typeof row.id==='string'&&Array.isArray(row.actions)&&Array.isArray(row.costs)&&Array.isArray(row.findings)&&Array.isArray(row.sourceIds)),'Keep the complete native risk report and every entry finding.');
  return value;
}

export function mountDeliveryRisks({container,current,saveApi,session={},mutationId,recordingActor,
  staffContext=currentStaffContext(),canSave=false,onCase=()=>{},onSources=()=>{}}){
  need(container&&current?.program?.id&&typeof saveApi==='function','Open the original Operations case.');
  const programId=current.program.id,prefix='/api/operations/'+enc(programId);
  const context=staffContext?{...staffContext}:null;
  const storageKey=staffDeskStorageKey('sf47.delivery-risks.v1:'+programId,context);
  const root=document.createElement('section');root.className='delivery-risk-desk';root.setAttribute('aria-label','Delivery risks and mitigations');container.replaceChildren(root);
  if(!document.querySelector('link[data-delivery-risk-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_risks.css';style.dataset.deliveryRiskStyle='true';document.head.append(style);
  }
  const defaults={tab:'register',draft:null,draftVersion:null,seed:null,preview:null,previewInput:null,previewVersion:null,
    selectedRisk:'',book:null,history:null,listing:null,search:'',statusFilter:'',kindFilter:'',ownerFilter:'',
    pending:null,accepted:null,receipts:[],copies:[],saveNote:'',notice:'',error:'',storageError:'',storageBlocked:false};
  const savedKeys=Object.keys(defaults).filter(k=>!['error','storageError','notice','storageBlocked'].includes(k));
  if(!session.initialized){
    for(const [key,value] of Object.entries(defaults))session[key]=clone(value);
    try{
      const raw=sessionStorage.getItem(storageKey);
      if(raw){
        const retained=JSON.parse(raw);
        need(retained?.schema===DESK&&retained.programId===programId&&canonical(retained.staffContext??null)===canonical(context),'The retained risk desk belongs to another case or recording operator.');
        for(const key of savedKeys)if(Object.hasOwn(retained,key))session[key]=retained[key];
        if(session.draft)documentShape(session.draft);
        if(session.pending)need(session.pending.command?.action==='risk-register.save'&&typeof session.pending.command.requestId==='string','The original pending request is incomplete.');
        if(session.accepted)need(session.accepted.command?.action==='risk-register.save'&&plain(session.accepted.result),'The original accepted request is incomplete.');
        need(Array.isArray(session.receipts)&&session.receipts.every(row=>plain(row)&&row.command?.action==='risk-register.save'&&typeof row.command.requestId==='string'&&(row.result===null||plain(row.result))),'Keep the retained risk request receipts.');
        need(['register','draft','editions','request','copies'].includes(session.tab)&&['selectedRisk','search','statusFilter','kindFilter','ownerFilter','saveNote'].every(key=>typeof session[key]==='string'),'The retained desk view is incomplete.');
        need(Array.isArray(session.copies)&&session.copies.length<=16&&session.copies.every(row=>plain(row)&&hex.test(row.id||'')&&typeof row.label==='string'&&typeof row.at==='string'&&plain(row.desk)),'The retained working-copy inventory is incomplete.');
        if(session.book)verifyBook(session.book,session.book.review?.id);
        if(session.seed){documentShape(session.seed.document);need(['contributors','packages','sources'].every(key=>Array.isArray(session.seed[key])),'The original seed choices are incomplete.');}
        if(session.listing)need(Array.isArray(session.listing.editions)&&session.listing.editions.every(row=>plain(row)&&typeof row.id==='string'),'The retained edition list is incomplete.');
        if(session.history)need(Array.isArray(session.history.entries)&&session.history.entries.every(row=>plain(row.edition)&&plain(row.risk)&&Array.isArray(row.risk.actions)),'The retained history is incomplete.');
        if(session.preview){documentShape(session.preview.document);need(hex.test(session.preview.previewSha256||''),'The retained preview is incomplete.');reportShape(session.preview.report);}
      }
    }catch(error){
      // Keep unreadable bytes in their original storage key for download. A
      // partial parse must not become a live draft or prevent recovery controls.
      for(const [key,value] of Object.entries(defaults))session[key]=clone(value);
      session.storageBlocked=true;session.storageError='The original local desk could not reopen: '+error.message;
    }
    session.initialized=true;
  }
  for(const [key,value] of Object.entries(defaults))if(!Object.hasOwn(session,key))session[key]=clone(value);
  let active=true,hostBusy=false,caseValue=current,initializing=true;
  const available=()=>active&&root.isConnected;
  const comparison=createDeliveryRiskComparison({programId,saveApi,session:session.comparisonView||(session.comparisonView={}),
    editions:()=>session.listing?.editions||[],download,sourceMetadata:id=>(caseValue.sources||[]).find(row=>row.id===id),available});
  const $=selector=>root.querySelector(selector);
  const busy=()=>initializing||hostBusy||!!session.inflight;
  const locked=()=>!!session.pending||!!session.accepted||session.storageBlocked;
  const writable=()=>!busy()&&!locked()&&caseValue.program.state==='OPEN';
  const draftRisk=()=>session.draft?.risks.find(row=>row.id===session.selectedRisk)||null;
    function setError(error){
    session.error=error?.message||String(error);
    if(error?.code)session.error+=' ['+error.code+']';
  }
  function persist(required=false){
    if(session.storageBlocked){if(required)throw new Error(session.storageError);return false;}
    const value={schema:DESK,programId,staffContext:context};
    for(const key of savedKeys)value[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(value));session.storageError='';return true;}
    catch(error){
      session.storageError='The local risk draft or known result could not be saved. Keep this desk open and export its complete state: '+error.message;
      if(required)throw new Error(session.storageError);
      return false;
    }
  }
  function changed(){
    session.preview=null;session.previewInput=null;session.previewVersion=null;session.error='';
    persist();updateControls();
    const preview=$('[data-risk-preview]');if(preview)preview.innerHTML=empty('Review the current draft to see native findings and save this edition.');
  }
  function optionsWithRetained(rows,selected,label){
    const pairs=rows.map(row=>[row.id,label(row)]),known=new Set(pairs.map(([key])=>key));
    for(const key of selected||[])if(key&&!known.has(key)){pairs.push([key,key+' · retained original link']);known.add(key);}
    return pairs;
  }
  function contributors(selected=[]){
    return [['','Unassigned'],...optionsWithRetained(caseValue.records?.contributors||session.seed?.contributors||[],selected,row=>row.name+' · '+words(row.kind)+(row.state&&row.state!=='ACTIVE'?' · '+words(row.state):''))];
  }
  function packages(selected=[]){
    return optionsWithRetained(caseValue.plan?.scenario?.future_costs||session.seed?.packages||[],selected,row=>(row.name||row.label||row.description||row.id)+' · '+row.id);
  }
  function sources(selected=[]){
    return optionsWithRetained(caseValue.sources||session.seed?.sources||[],selected,row=>row.filename+' · '+String(row.sha256).slice(0,12));
  }
  const hasPreview=()=>!!session.preview&&session.previewVersion===caseValue.program.version&&session.previewInput===canonical(session.draft);
  async function refresh(){
    const value=await saveApi(prefix);
    need(value.program?.id===programId,'The original case identity changed.');
    caseValue=value;
    const listing=await saveApi(prefix+'/risk-register');
    need(Array.isArray(listing.editions)&&Object.hasOwn(listing,'current'),'The native register list is incomplete.');
    session.listing=listing;
    if(session.previewVersion!==caseValue.program.version){session.preview=null;session.previewInput=null;session.previewVersion=null;}
    persist();
  }
  function verifyBook(value,reviewId){
    need(value?.review?.id===reviewId&&value.review.purpose==='DELIVERY_RISK_REGISTER'&&hex.test(value.review.sha256||''),'The selected original risk review is incomplete.');
    documentShape(value.document);
    need(value.source&&hex.test(value.previewSha256||''),'Keep the complete native document, report and source.');reportShape(value.report);
    return value;
  }
  async function openBook(reviewId){
    session.book=verifyBook(await saveApi(prefix+'/risk-register/'+enc(reviewId)),reviewId);
    session.tab='register';session.history=null;persist();
  }
  async function makeDraft(reviewId=null){
    need(!locked(),'Resolve the retained original request before changing its draft.');
    if(session.draft&&!window.confirm('Replace this local draft with the selected native seed? Download the current draft first if you need to keep it.'))return;
    const body={expectedVersion:caseValue.program.version};if(reviewId)body.reviewId=reviewId;
    const value=await saveApi(prefix+'/risk-register-seed',body);
    documentShape(value.document);
    need(value.source&&Array.isArray(value.contributors)&&Array.isArray(value.packages)&&Array.isArray(value.sources),'Keep the complete native seed and source choices.');
    session.seed=clone(value);session.draft=clone(value.document);session.draftVersion=caseValue.program.version;
    session.selectedRisk=session.draft.risks[0]?.id||'';session.tab='draft';session.saveNote='';changed();persist(true);
    session.notice='The native seed is retained. Set the assessment date and record any review of changed entries before saving.';
  }
  async function previewDraft(){
    need(session.draft&&!locked(),'Open the complete original risk draft first.');
    documentShape(session.draft);
    persist(true);
    const input=clone(session.draft),version=caseValue.program.version;
    const value=await saveApi(prefix+'/risk-register-preview',{expectedVersion:version,document:input});
    need(value.engineVersion===1&&hex.test(value.previewSha256||'')&&value.source&&value.report,'The native preview is incomplete.');
    documentShape(value.document);reportShape(value.report);
    need(canonical(session.draft)===canonical(input),'The draft changed while its preview was pending.');
    session.draft=clone(value.document);session.preview=clone(value);session.previewInput=canonical(session.draft);session.previewVersion=version;
    persist(true);session.notice='Review the native findings, dates, links and full source below. Saving creates one immutable edition.';
  }
  function receipt(result,command){
    need(result?.id===programId&&result.action==='risk-register.save'&&result.kind==='review'&&typeof result.recordId==='string'&&hex.test(result.reviewSha256||'')&&Number.isInteger(result.version),'The original risk save returned an incomplete receipt. Keep its exact request for reconciliation.');
    need(command.action==='risk-register.save','The retained command belongs to another action.');
    return result;
  }
  function rememberAccepted(command,result){
    receipt(result,command);
    if(session.accepted)need(canonical(session.accepted.command)===canonical(command)&&canonical(session.accepted.result)===canonical(result),'Conflicting results were returned for one original request.');
    session.accepted={command:clone(command),result:clone(result)};
    session.pending=null;
    // Known native success is held in memory before local publication; a storage
    // failure retains this same object and never authorizes a second save.
    persist(true);
  }
  async function finishAccepted(){
    const accepted=session.accepted;if(!accepted)return;
    persist(true);
    const book=verifyBook(await saveApi(prefix+'/risk-register/'+enc(accepted.result.recordId)),accepted.result.recordId);
    need(book.review.sha256===accepted.result.reviewSha256&&book.previewSha256===accepted.command.data.expectedPreviewSha256,'The saved native risk edition differs from the retained preview receipt.');
    await refresh();
    need(caseValue.program.version>=accepted.result.version,'The original case has not reopened at its saved risk version.');
    if(!session.receipts.some(row=>row.command.requestId===accepted.command.requestId))session.receipts.push(clone(accepted));
    else need(canonical(session.receipts.find(row=>row.command.requestId===accepted.command.requestId))===canonical(accepted),'The retained request receipt changed.');
    session.book=book;session.tab='register';session.preview=null;session.previewInput=null;session.previewVersion=null;
    session.notice='Saved and reopened the complete risk edition. Its source, original request and review are retained.';
    // Publish the recovered book and receipt while the accepted owner is still
    // retained. Clearing it is a separate durable step, restored on failure.
    persist(true);session.accepted=null;
    try{persist(true);}catch(error){session.accepted=accepted;throw error;}
    if(available())await onCase(caseValue,accepted.result);
  }
  async function reconcilePending(allowReplay=false){
    if(session.accepted)return finishAccepted();
    need(session.pending,'There is no retained original risk request to recover.');
    const command=clone(session.pending.command);persist(true);
    const response=await saveApi(prefix+'/risk-register-request',{command});
    need(typeof response.found==='boolean'&&response.requestId===command.requestId,'The original request lookup is incomplete.');
    if(response.found){
      rememberAccepted(command,response.result);return finishAccepted();
    }
    session.pending.absentObserved=true;persist(true);
    if(!allowReplay){session.notice='The native table has no accepted result for this exact request. You may send the same retained command once.';return;}
    need(canSave,'This staff role can inspect requests but cannot save a risk edition.');
    // A prior explicit rejection cannot classify a later uncertain attempt.
    session.pending.definitelyRejected=false;session.pending.absentObserved=false;session.pending.lastError=null;persist(true);
    let result;
    try{result=await saveApi(prefix+'/command',command);}
    catch(error){
      // A transport error is not evidence that the original writer rejected it.
      // Keep the exact request even for version/auth errors until a read proves
      // absence; the operator may then explicitly return to the retained draft.
      session.pending.lastError={code:error.code||null,status:error.status||null,message:error.message||String(error)};
      session.pending.definitelyRejected=[409,422].includes(error.status)&&["INVALID_RISK_REGISTER","RISK_HEAD_CHANGED","RISK_PREVIEW_CHANGED","INVALID_OPERATIONS","OPERATIONS_CONFLICT","OPERATIONS_CLOSED"].includes(error.code);
      persist();throw error;
    }
    rememberAccepted(command,result);return finishAccepted();
  }
  async function saveDraft(){
    need(canSave&&caseValue.program.state==='OPEN'&&hasPreview()&&!locked(),'Review the current complete draft with a permitted recording operator before saving.');
    const note=session.saveNote.trim();need(note,'Enter the reason for saving this edition.');
    const actor=recordingActor();need(typeof actor==='string'&&actor.trim(),'Enter the original recording operator.');
    const command={expectedVersion:session.previewVersion,actor,action:'risk-register.save',data:{document:clone(session.draft),expectedPreviewSha256:session.preview.previewSha256},note};
    command.requestId=await mutationId('operations:risk-register.save',command);
    need(typeof command.requestId==='string'&&command.requestId,'The original request identity is unavailable.');
    session.pending={command,absentObserved:false,lastError:null};persist(true);
    await reconcilePending(true);
  }
  async function returnToDraft(){
    need(session.pending?.definitelyRejected&&!session.accepted,'Only an explicit native save rejection permits returning to the draft; an uncertain outcome stays with its original request.');
    const command=clone(session.pending.command),response=await saveApi(prefix+'/risk-register-request',{command});
    need(response.requestId===command.requestId&&typeof response.found==='boolean','The original request lookup is incomplete.');
    if(response.found){rememberAccepted(command,response.result);return finishAccepted();}
    if(!window.confirm('The native table has no accepted result for this exact request. Retain the command in this desk’s history and return to the draft for a new preview?'))return;
    const original=session.pending;
    session.receipts.push({command,result:null,observedAbsent:true});
    session.pending=null;session.preview=null;session.previewVersion=null;session.previewInput=null;session.tab='draft';
    try{persist(true);}catch(error){session.pending=original;throw error;}
    session.notice='The original unaccepted request is retained. Refresh the case and review the draft before selecting a new request.';
    await refresh();
  }
  async function downloadSource(sourceId){
    const metadata=(caseValue.sources||[]).find(row=>row.id===sourceId);
    need(metadata&&hex.test(metadata.sha256||''),'The original source metadata is unavailable.');
    const response=await saveApi(prefix+'/sources/'+enc(sourceId),undefined,{download:true});
    const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    need(hash===metadata.sha256&&(metadata.bytes==null||metadata.bytes===bytes.byteLength),'The downloaded source differs from its original complete byte identity.');
    if(available())download(new Blob([bytes],{type:metadata.mediaType||'application/octet-stream'}),metadata.filename);
  }
  async function downloadEdition(reviewId){
    const book=verifyBook(await saveApi(prefix+'/risk-register/'+enc(reviewId)),reviewId);
    const response=await saveApi(prefix+'/risk-register/'+enc(reviewId)+'/export.zip',undefined,{download:true});
    const bytes=await response.arrayBuffer();
    need(bytes.byteLength>0,'The original case export was empty.');
    session.notice='Received the original case ZIP with risk edition '+book.review.id+'.';
    if(available())download(new Blob([bytes],{type:'application/zip'}),programId+'-risks-'+reviewId+'.zip');
  }
  async function importDraft(file){
    need(file&&file.size<=8*1024*1024,'Choose a complete risk document JSON file of at most 8 MiB.');
    const raw=await file.arrayBuffer(),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));documentShape(value);
    if(session.draft&&!window.confirm('Replace this local draft with the complete selected document? Its native preview must validate the current case and exact predecessor.'))return;
    session.draft=clone(value);session.draftVersion=caseValue.program.version;session.selectedRisk=value.risks[0]?.id||'';session.tab='draft';changed();persist(true);
    session.notice='The complete document is retained as a draft. Native preview will check every current source, link and predecessor.';
  }


  // Working copies carry the complete desk. Imported bytes remain observations
  // until the original native request table and selected reviews are reopened.
  const COPY='stellar-forge.sf47-delivery-risk-working-copy.v1';
  const COPY_LIMIT=32*1024*1024, COPY_COUNT=16;
  const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const hashValue=value=>hashBytes(new TextEncoder().encode(canonical(value)));
  function snapshot(withCopies=true){
    const value={schema:DESK,programId,staffContext:clone(context)};
    for(const key of savedKeys)if(withCopies||key!=='copies')value[key]=clone(session[key]);
    return value;
  }
  function commandShape(command){
    need(plain(command)&&command.action==='risk-register.save'&&typeof command.requestId==='string'&&command.requestId.length>0&&command.requestId.length<=300&&
      Number.isInteger(command.expectedVersion)&&command.expectedVersion>=0&&typeof command.actor==='string'&&command.actor.trim()&&
      typeof command.note==='string'&&command.note.trim()&&plain(command.data)&&hex.test(command.data.expectedPreviewSha256||''),
      'Keep the complete original risk save command, actor, note, version and preview identity.');
    documentShape(command.data.document);return command;
  }
  function copyDeskShape(value,allowCopies=true){
    need(plain(value)&&value.schema===DESK&&value.programId===programId&&canonical(value.staffContext??null)===canonical(context),
      'Open this working copy in its original Operations case and signed-in staff scope. To share only an editable document, use the existing draft document export.');
    if(value.draft)documentShape(value.draft);
    need(value.draftVersion===null||Number.isInteger(value.draftVersion),'The working copy draft version is incomplete.');
    need(['register','draft','editions','request','copies'].includes(value.tab)&&
      ['selectedRisk','search','statusFilter','kindFilter','ownerFilter','saveNote'].every(key=>typeof value[key]==='string'),
      'Keep the complete working-copy view and save note.');
    need(!(value.pending&&value.accepted),'A working copy cannot have two unresolved original commands.');
    if(value.pending){need(plain(value.pending),'The pending request is incomplete.');commandShape(value.pending.command);}
    if(value.accepted){commandShape(value.accepted.command);receipt(value.accepted.result,value.accepted.command);}
    const command=value.accepted?.command||value.pending?.command;
    if(command)need(value.draft&&canonical(command.data.document)===canonical(value.draft),'The unfinished original command and its locked draft differ.');
    need(Array.isArray(value.receipts)&&value.receipts.length<=1000&&value.receipts.every(row=>plain(row)&&
      row.command?.action==='risk-register.save'&&typeof row.command.requestId==='string'&&(row.result===null||plain(row.result))),
      'Keep the complete retained request history (at most 1,000 rows).');
    const seen=new Map();
    for(const row of value.receipts){
      commandShape(row.command);if(row.result)receipt(row.result,row.command);
      const prior=seen.get(row.command.requestId);
      need(!prior||canonical(prior)===canonical(row),'Two different receipt observations use one request ID.');
      seen.set(row.command.requestId,row);
    }
    if(value.book)verifyBook(value.book,value.book.review?.id);
    if(value.seed){documentShape(value.seed.document);need(value.seed.source&&['contributors','packages','sources'].every(key=>Array.isArray(value.seed[key])),'Keep all original seed choices and source identity.');}
    if(value.listing)need(Array.isArray(value.listing.editions)&&value.listing.editions.every(row=>plain(row)&&typeof row.id==='string'),'The working-copy edition list is incomplete.');
    if(value.history)need(Array.isArray(value.history.entries)&&value.history.entries.every(row=>plain(row.edition)&&plain(row.risk)&&Array.isArray(row.risk.actions)),'The working-copy history is incomplete.');
    if(value.preview){documentShape(value.preview.document);reportShape(value.preview.report);need(hex.test(value.preview.previewSha256||''),'The stored preview identity is incomplete.');}
    const copies=value.copies??[];
    need(Array.isArray(copies)&&copies.length<=COPY_COUNT&&(allowCopies||copies.length===0),'Keep at most 16 complete, unnested working-copy checkpoints.');
    const ids=new Set();
    for(const row of copies){
      need(plain(row)&&hex.test(row.id||'')&&typeof row.label==='string'&&typeof row.at==='string'&&!ids.has(row.id)&&plain(row.desk),'The retained checkpoint inventory is incomplete.');
      ids.add(row.id);copyDeskShape(row.desk,false);
    }
    return value;
  }
  async function checkCopyHashes(value){
    for(const row of value.copies??[])need(await hashValue(row.desk)===row.id,'A retained working-copy checkpoint changed.');
  }
  async function exportCopy(value=snapshot(),label=programId+'-risk-working-copy.json'){
    copyDeskShape(value);await checkCopyHashes(value);
    const payload=clone(value),envelope={schema:COPY,exportedAt:new Date().toISOString(),payloadSha256:await hashValue(payload),payload};
    const raw=JSON.stringify(envelope,null,2)+'\n';
    need(new TextEncoder().encode(raw).byteLength<=COPY_LIMIT,'This working copy exceeds 32 MiB. Download individual checkpoints before removing them from this desk.');
    if(available())download(new Blob([raw],{type:'application/json'}),label);
  }
  async function stageCopy(file){
    need(file&&file.size>0&&file.size<=COPY_LIMIT,'Choose a complete risk working copy or legacy desk JSON of at most 32 MiB.');
    const raw=await file.arrayBuffer(),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    let payload=value;
    if(value?.schema===COPY){
      need(hex.test(value.payloadSha256||'')&&plain(value.payload),'The working-copy envelope is incomplete.');
      need(await hashValue(value.payload)===value.payloadSha256,'The working-copy checksum does not match its complete payload.');
      payload=value.payload;
    }
    copyDeskShape(payload);await checkCopyHashes(payload);
    need(!Object.hasOwn(payload,'unreadableOriginal'),'This export also contains unreadable original storage. Keep those bytes separately and resolve their original desk before reopening a replacement.');
    session.copyReview={desk:clone(payload),source:{filename:file.name,bytes:raw.byteLength,sha256:await hashBytes(raw)},payloadSha256:await hashValue(payload)};
    session.tab='copies';session.notice='The complete copy is ready for review. No draft, native request or saved edition has been changed.';
  }
  async function stageCheckpoint(copyId){
    const row=session.copies.find(value=>value.id===copyId);
    need(row,'Choose an existing complete checkpoint.');copyDeskShape(row.desk,false);
    need(await hashValue(row.desk)===row.id,'The retained checkpoint bytes changed.');
    session.copyReview={desk:clone(row.desk),source:{filename:row.label,sha256:row.id,bytes:new TextEncoder().encode(canonical(row.desk)).byteLength},payloadSha256:row.id};
    session.tab='copies';
  }
  async function adoptCopy(){
    const staged=session.copyReview;need(staged&&!session.storageBlocked,'Review the complete selected copy and resolve any unreadable original storage first.');
    copyDeskShape(staged.desk);await checkCopyHashes(staged.desk);
    need(await hashValue(staged.desk)===staged.payloadSha256,'The reviewed working copy changed.');
    const imported=staged.desk,held=session.accepted?.command||session.pending?.command;
    const command=imported.accepted?.command||imported.pending?.command;
    need(!held||(command&&canonical(held)===canonical(command)),'This desk owns a different unfinished request. Resolve it before reopening another working copy.');
    if(session.accepted&&imported.accepted)need(canonical(session.accepted.result)===canonical(imported.accepted.result),'The working copy conflicts with this desk’s known native success.');
    if(!window.confirm('Reopen this complete working copy? The current full desk will be retained as a checkpoint. Any unfinished save is read from the original native table; this action does not save an edition.'))return;
    // Finish every native read before replacing any editable state. No imported
    // absence/rejection flag can authorize a new request or unlock the old one.
    const nativeCase=await saveApi(prefix);
    need(nativeCase.program?.id===programId,'The original case identity changed.');
    const listing=await saveApi(prefix+'/risk-register');
    need(Array.isArray(listing.editions)&&Object.hasOwn(listing,'current'),'The current native register list is incomplete.');
    let accepted=null,pending=null,book=null,seed=null;
    if(command){
      const found=await saveApi(prefix+'/risk-register-request',{command:clone(command)});
      need(found.requestId===command.requestId&&typeof found.found==='boolean','The original request lookup is incomplete.');
      if(found.found){
        receipt(found.result,command);
        if(imported.accepted)need(canonical(imported.accepted.result)===canonical(found.result),'The imported acceptance differs from the original native result.');
        if(session.accepted)need(canonical(session.accepted.result)===canonical(found.result),'The native result differs from this desk’s known success.');
        accepted={command:clone(command),result:clone(found.result)};
        book=verifyBook(await saveApi(prefix+'/risk-register/'+enc(found.result.recordId)),found.result.recordId);
        need(book.review.sha256===found.result.reviewSha256&&book.previewSha256===command.data.expectedPreviewSha256,'The original accepted edition differs from the imported command.');
      }else{
        need(!imported.accepted&&!session.accepted,'A known accepted request is missing from this native case. Keep the original copy and recover its source case.');
        pending={command:clone(command),absentObserved:true,definitelyRejected:false,lastError:null};
      }
    }
    if(!book&&imported.book){
      book=verifyBook(await saveApi(prefix+'/risk-register/'+enc(imported.book.review.id)),imported.book.review.id);
      need(book.review.sha256===imported.book.review.sha256,'The original saved edition differs from the working copy.');
    }
    if(imported.draft){
      const body={expectedVersion:nativeCase.program.version};
      if(imported.draft.supersedes?.reviewId)body.reviewId=imported.draft.supersedes.reviewId;
      seed=await saveApi(prefix+'/risk-register-seed',body);documentShape(seed.document);
      need(seed.source&&['contributors','packages','sources'].every(key=>Array.isArray(seed[key])),'The original native seed choices are incomplete.');
      if(imported.draft.supersedes)need(seed.previous?.id===imported.draft.supersedes.reviewId&&seed.previous?.sha256===imported.draft.supersedes.reviewSha256,'The imported predecessor differs from its native saved edition.');
    }
    const prior=snapshot(false),priorId=await hashValue(prior);
    const originalCopy=clone(imported);delete originalCopy.copies;
    const originalId=await hashValue(originalCopy),copies=new Map();
    for(const row of [...session.copies,...(imported.copies??[])]){
      const previous=copies.get(row.id);need(!previous||canonical(previous.desk)===canonical(row.desk),'Two checkpoints conflict.');
      copies.set(row.id,clone(row));
    }
    if(!copies.has(priorId))copies.set(priorId,{id:priorId,label:'Desk before '+staged.source.filename,at:new Date().toISOString(),desk:prior});
    if(!copies.has(originalId))copies.set(originalId,{id:originalId,label:staged.source.filename,at:new Date().toISOString(),source:clone(staged.source),desk:originalCopy});
    need(copies.size<=COPY_COUNT,'Reopening would exceed 16 complete checkpoints. Download and explicitly remove older checkpoints first.');
    // Imported receipt history stays verbatim in the complete checkpoint. Only
    // original native lookup results enter this desk's live accepted state.
    const next={...snapshot(),draft:clone(imported.draft??null),draftVersion:imported.draftVersion,seed:clone(seed),
      preview:null,previewInput:null,previewVersion:null,selectedRisk:imported.selectedRisk,
      book:clone(book),history:null,listing:clone(listing),search:imported.search,statusFilter:imported.statusFilter,
      kindFilter:imported.kindFilter,ownerFilter:imported.ownerFilter,saveNote:imported.saveNote,
      accepted,pending,copies:[...copies.values()],tab:command?'request':imported.draft?'draft':'copies'};
    const before={};for(const key of savedKeys)before[key]=session[key];
    for(const key of savedKeys)session[key]=next[key];
    try{persist(true);}catch(error){for(const key of savedKeys)session[key]=before[key];throw error;}
    caseValue=nativeCase;session.copyReview=null;
    session.notice=accepted?'The original saved request was found. Reopen its known saved edition in Request recovery.':
      pending?'The exact original command is retained. The native read found no acceptance; Request recovery can reconcile and explicitly send that same command.':
      'The complete draft is reopened. Its original copy and previous desk are retained as checkpoints. Review it again with the current native engine before saving.';
  }
  async function removeCheckpoint(copyId){
    const row=session.copies.find(value=>value.id===copyId);need(row,'Choose an existing complete checkpoint.');
    if(!window.confirm('Remove this local checkpoint from future working-copy exports? Download it first if it is still needed. The active draft, original request and native editions remain unchanged.'))return;
    const prior=session.copies;session.copies=prior.filter(value=>value.id!==copyId);
    try{persist(true);}catch(error){session.copies=prior;throw error;}
  }
  function copiesView(){
    const staged=session.copyReview,value=staged?.desk,command=value?.accepted?.command||value?.pending?.command;
    return '<p>Carry the full editable desk between sessions for this same case and signed-in staff scope. A checksum detects changed bytes; it does not make imported claims authoritative. Native reads reconcile unfinished saves before reopening. A fresh native preview is required before saving a reopened draft.</p>'+
      '<div class="risk-actions">'+button('Download complete working copy','export-copy')+button('Download legacy full desk','download-desk')+'</div>'+
      field('Complete working-copy or legacy desk JSON','',{type:'file',wide:true,attrs:{accept:'.json,application/json','data-risk-copy-import':'true'},help:'Maximum 32 MiB. Reading a file only stages it for review.'})+
      button('Review selected working copy','review-copy')+
      (staged?'<section class="risk-panel"><h4>Review selected copy</h4>'+table(['File / identity','Editable document','Retained request','History'],[[
        esc(staged.source.filename)+'<small>'+esc(staged.source.bytes)+' bytes · '+esc(staged.source.sha256)+'</small>',
        esc(value.draft?.name||'No draft')+'<small>'+esc(value.draft?.risks.length??0)+' entries · opened at case version '+esc(value.draftVersion)+'</small>',
        esc(command?.requestId||'None')+'<small>'+esc(value.accepted?'Claims accepted; native lookup required':value.pending?'Unfinished original command':'A later native preview creates no request')+'</small>',
        esc(value.receipts.length)+' receipt observations<small>'+esc((value.copies??[]).length)+' complete checkpoints</small>'
      ]])+'<div class="risk-actions">'+button('Reopen reviewed working copy','adopt-copy',{},session.storageBlocked)+button('Download reviewed copy','export-reviewed-copy')+button('Cancel copy review','cancel-copy')+'</div>'+details('Complete selected desk and original history',value)+'</section>':'')+
      '<h4>Complete retained checkpoints</h4><p>These are full local observations. Their saved receipts and previews are rechecked when reopened; they do not grant permission or create an edition. Up to 16 are included in each portable copy.</p>'+
      (session.copies.length?table(['Checkpoint','Draft / request','Actions'],session.copies.map(row=>[
        esc(row.label)+'<small>'+esc(row.at)+' · '+esc(row.id)+'</small>',
        esc(row.desk.draft?.name||'No draft')+'<small>'+esc(row.desk.accepted?.command.requestId||row.desk.pending?.command.requestId||'No unfinished request')+'</small>',
        '<div class="risk-actions">'+button('Review checkpoint','review-checkpoint',{'data-copy-id':row.id})+button('Download checkpoint','export-checkpoint',{'data-copy-id':row.id})+button('Remove local checkpoint','remove-checkpoint',{'data-copy-id':row.id})+'</div>'
      ])):empty('Reopening a working copy retains its complete original and the preceding desk here.'));
  }

  function sourceLinks(ids){
    return (ids||[]).map(sourceId=>{const row=(caseValue.sources||[]).find(s=>s.id===sourceId);return '<div class="risk-source">'+button(row?.filename||sourceId,'source',{'data-source-id':sourceId},!row)+'<small>'+esc(row?.sha256||'Original source unavailable in current case')+'</small></div>';}).join('')||'<small>No source selected</small>';
  }
  function reportView(report,documentValue){
    if(!report)return empty('Open a saved edition or preview the complete draft.');
    const entries=(report.entries||[]).filter(row=>{
      const query=session.search.trim().toLocaleLowerCase();
      return (!session.statusFilter||row.status===session.statusFilter)&&(!session.kindFilter||row.kind===session.kindFilter)&&
        (!session.ownerFilter||(session.ownerFilter==='unassigned'?!row.owner:row.owner?.id===session.ownerFilter))&&
        (!query||[row.id,row.title,row.category,row.owner?.name,documentValue?.risks.find(r=>r.id===row.id)?.description].join(' ').toLocaleLowerCase().includes(query));
    });
    const counts=report.counts||{};
    return '<p class="risk-notice">'+esc(report.notice||'Native assessment from the selected original case and register date.')+'</p>'+
      '<div class="risk-metrics">'+[['total','Entries'],['risks','Risks'],['issues','Issues'],['unassigned','Unassigned'],['overdueReviews','Overdue reviews'],['overdueActions','Overdue actions']].map(([key,label])=>'<div><strong>'+esc(counts[key]??'—')+'</strong><small>'+label+'</small></div>').join('')+'</div>'+
      '<p>'+esc(report.name)+' · as of '+esc(report.asOfDate)+' · '+esc(words(report.mode))+'</p>'+
      (entries.length?table(['Risk / issue','Assessment','Owner / packages','Next review','Mitigation / findings'],entries.map(row=>{
        const actions=row.actions||[],findings=row.findings||[];
        return [
          '<strong>'+esc(row.title)+'</strong><small>'+esc(row.id)+'</small>'+badge(row.kind)+' '+badge(row.status)+
            '<div class="risk-actions">'+button('Inspect entry',session.tab==='draft'?'choose-risk':'inspect-risk',{'data-risk-id':row.id})+
            button('Edition history','history',{'data-risk-id':row.id})+'</div>',
          badge(row.priority)+'<small>'+esc(words(row.likelihood))+' likelihood · '+esc(words(row.impact))+' impact</small>'+esc(words(row.category)),
          esc(row.owner?.name||'Unassigned')+'<small>'+esc(row.owner?.kind||'')+'</small>'+(row.costs||[]).map(cost=>'<small>'+esc(cost.label||cost.id)+(cost.current?'':' · retained historical package')+'</small>').join(''),
          esc(row.nextReviewOn||'Not scheduled')+(row.reviewOverdue?'<strong class="risk-due">Overdue at register date</strong>':''),
          actions.map(a=>'<div class="risk-action-summary"><strong>'+esc(a.title)+'</strong> '+badge(a.status)+'<small>'+esc(a.owner?.name||'Unassigned')+' · due '+esc(a.dueOn||'unstated')+(a.completedOn?' · completed '+esc(a.completedOn):'')+'</small>'+(a.overdue?'<strong class="risk-due">Overdue at register date</strong>':'')+'</div>').join('')+
          (findings.length?'<ul>'+findings.map(f=>'<li>'+esc(f.message)+(f.actionId?'<small>'+esc(f.actionId)+'</small>':'')+'</li>').join(''):'<small>No native findings for this entry</small>')
        ];
      })):empty('No entries match this view. The full native counts above remain unchanged.'));
  }
  function filters(){
    return '<div class="risk-filters">'+field('Find entry',session.search,{attrs:{'data-risk-filter':'search'},help:'Title, original ID, description, category or owner.'})+
      field('State',session.statusFilter,{options:[['','All states'],...optionValues(ENUMS.status)],attrs:{'data-risk-filter':'statusFilter'}})+
      field('Kind',session.kindFilter,{options:[['','Risks and issues'],...optionValues(ENUMS.kind)],attrs:{'data-risk-filter':'kindFilter'}})+
      field('Owner',session.ownerFilter,{options:[['','All owners'],['unassigned','Unassigned'],...contributors().filter(([key])=>key)],attrs:{'data-risk-filter':'ownerFilter'}})+'</div>';
  }
  function entryReadOnly(row){
    if(!row)return '';
    return '<section class="risk-panel" data-risk-entry-id="'+esc(row.id)+'"><h4>'+esc(row.title)+'</h4><p>'+esc(row.description)+'</p>'+
      table(['Field','Original recorded value'],[
        ['Entry',esc(row.id)+' · '+esc(words(row.kind))],['Identified',esc(row.identifiedOn)],['State',badge(row.status)],
        ['Assessment',esc(row.assessmentNote)],['Trigger',esc(row.trigger)],['Owner context',esc(row.ownerNote)],
        ['Next review',esc(row.nextReviewOn||'Not scheduled')],
        ['Dated review',esc([row.review?.on,row.review?.by,row.review?.note].filter(Boolean).join(' · '))],
        ['Resolution',esc([row.resolution?.on,row.resolution?.note].filter(Boolean).join(' · '))],
        ['Source context',esc(row.sourceNote)]
      ])+sourceLinks(row.sourceIds)+
      '<h4>Mitigation actions</h4>'+((row.actions||[]).length?(row.actions||[]).map(action=>'<article class="risk-panel"><h5>'+esc(action.title)+'</h5><p>'+esc(action.description)+'</p>'+badge(action.status)+
      '<p>'+esc(action.progress)+'</p><p>Due: '+esc(action.dueOn||'Not scheduled')+' · Completed: '+esc(action.completedOn||'Not recorded')+'</p><p>'+esc(action.ownerNote)+'</p>'+
      sourceLinks(action.sourceIds)+'<p>'+esc(action.sourceNote)+'</p><small>'+esc(action.id)+'</small></article>').join(''):empty('No mitigation actions recorded.'))+
      details('Complete original entry and source basis',row)+'</section>';
  }
  function registerView(){
    const book=session.book,currentHead=session.listing?.current;
    return '<div class="risk-actions">'+button('Refresh original case','refresh')+
      button(session.draft?'Replace draft from current edition':'Prepare current draft','seed',{},locked()||caseValue.program.state!=='OPEN')+
      (session.draft?button('Continue retained draft','tab',{'data-risk-tab':'draft'}):'')+
      (currentHead?button('Open current edition','open',{'data-review-id':currentHead.id}):'')+
      button('Open supporting sources','sources')+'</div>'+
      (!canSave?'<p class="risk-notice">Your assigned staff role can inspect and preview this register. Saving an edition requires an owner or lead.</p>':'')+
      (!book?empty(currentHead?'Open the current saved edition.':'No risk edition is saved. The first book may be empty; entries are supplied by its recording operator.'):
        '<div class="risk-edition"><h4>'+esc(book.document.name)+'</h4><p>As of '+esc(book.document.asOfDate)+' · review '+esc(book.review.id)+' · '+esc(book.review.createdAt)+' · '+esc(book.review.actor)+'</p>'+
        '<p>'+esc(book.review.note)+'</p><small>'+esc(book.review.sha256)+'</small>'+
        (book.current?.sourceChanged?'<p class="risk-notice">The current case differs from this retained edition: '+esc(book.current.reason||'Original source changed.')+' Its recorded assessment remains unchanged.</p>':'')+
        (currentHead&&currentHead.id!==book.review.id?'<p class="risk-notice">This is a historical edition. Current head: '+esc(currentHead.id)+'. Native save requires the exact current predecessor.</p>':'')+
        '<div class="risk-actions">'+button('Prepare draft from this edition','seed',{'data-review-id':book.review.id},locked()||caseValue.program.state!=='OPEN')+
        button('Export complete case and this edition','export-edition',{'data-review-id':book.review.id})+
        button('Download edition JSON','download-book')+'</div></div>'+filters()+reportView(book.report,book.document)+
        entryReadOnly(book.document.risks.find(row=>row.id===session.selectedRisk))+details('Original preview source and full report',{source:book.source,previewSha256:book.previewSha256,report:book.report,current:book.current}));
  }
  function editField(label,value,key,scope='risk',config={}){
    return field(label,value,{...config,attrs:{...config.attrs,'data-risk-field':key,'data-risk-scope':scope}});
  }
  function sourceFields(row,scope,item=null){
    const attrs=item?{'data-risk-item':item}:{};
    return editField('Supporting sources',row.sourceIds,'sourceIds',scope,{wide:true,multiple:true,options:sources(row.sourceIds),attrs,help:'Choose the retained original files. Their byte identities and native source basis are kept in the edition.'})+
      editField('Source context',row.sourceNote,'sourceNote',scope,{area:true,wide:true,attrs});
  }
  function mitigationEditor(action){
    const f=(label,value,key,config={})=>editField(label,value,key,'action',{...config,attrs:{...config.attrs,'data-risk-item':action.id}});
    return '<details open class="risk-mitigation" data-risk-mitigation="'+esc(action.id)+'"><summary>'+esc(action.title||'Untitled mitigation action')+'</summary>'+
      '<small>'+esc(action.id)+'</small><div class="risk-fields">'+
      f('Action title',action.title,'title',{required:true,wide:true})+
      f('Mitigation scope',action.description,'description',{area:true,wide:true})+
      f('Action owner',action.ownerId,'ownerId',{options:contributors([action.ownerId]),help:'Unassigned is explicit and allowed.'})+
      f('Action state',action.status,'status',{options:optionValues(ENUMS.actionStatus)})+
      f('Owner context',action.ownerNote,'ownerNote',{area:true,wide:true})+
      f('Due on',action.dueOn,'dueOn',{type:'date'})+
      f('Completed / cancelled on',action.completedOn,'completedOn',{type:'date',help:'Required for done or cancelled actions; no later than the assessment date.'})+
      f('Progress / completion evidence',action.progress,'progress',{area:true,wide:true,help:'Required when done or cancelled. Record the actual outcome.'})+
      sourceFields(action,'action',action.id)+'</div></details>';
  }
  function riskEditor(row){
    if(!row)return empty('Add a risk or issue, or select a retained entry.');
    const f=(label,value,key,config={})=>editField(label,value,key,'risk',config);
    const wasIssue=session.seed?.document.risks.find(r=>r.id===row.id)?.kind==='ISSUE';
    return '<section class="risk-panel" data-risk-editing="'+esc(row.id)+'"><h4>'+esc(row.title||'New risk or issue')+'</h4><small>'+esc(row.id)+'</small><div class="risk-fields">'+
      f('Title',row.title,'title',{wide:true,required:true})+
      f('Kind',row.kind,'kind',{options:optionValues(ENUMS.kind).map(([key,label])=>[key,label,wasIssue&&key==='RISK']),help:'An existing risk may become an issue. An issue remains an issue.'})+
      f('Category',row.category,'category',{options:optionValues(ENUMS.category)})+
      f('Description',row.description,'description',{area:true,wide:true})+
      f('Identified on',row.identifiedOn,'identifiedOn',{type:'date',required:true,disabled:!!session.seed?.document.risks.some(r=>r.id===row.id),help:'The original identification date is retained in every successor.'})+
      f('State',row.status,'status',{options:optionValues(ENUMS.status)})+
      f('Owner',row.ownerId,'ownerId',{options:contributors([row.ownerId]),help:'A native contributor, or explicitly unassigned.'})+
      f('Next review on',row.nextReviewOn,'nextReviewOn',{type:'date'})+
      f('Owner context',row.ownerNote,'ownerNote',{area:true,wide:true})+
      f('Likelihood',row.likelihood,'likelihood',{options:optionValues(row.kind==='ISSUE'?['NOT_APPLICABLE']:ENUMS.likelihood.filter(x=>x!=='NOT_APPLICABLE')),help:'Issues have already occurred. Likelihood is not applicable.'})+
      f('Impact',row.impact,'impact',{options:optionValues(ENUMS.impact)})+
      f('Recorded priority',row.priority,'priority',{options:optionValues(ENUMS.priority),help:'An explicit assessment. The desk does not derive a score or money exposure.'})+
      f('Trigger / early indication',row.trigger,'trigger',{area:true})+
      f('Assessment reasoning',row.assessmentNote,'assessmentNote',{area:true,wide:true})+
      f('Original work packages',row.costIds,'costIds',{multiple:true,wide:true,options:packages(row.costIds),help:'New links use the current plan. Existing retired links remain visible and are checked by native preview.'})+
      sourceFields(row,'risk')+'</div>'+
      '<fieldset><legend>Dated assessment review</legend><p>Review every changed existing entry. Resolved or closed entries also need a dated resolution.</p><div class="risk-fields">'+
      f('Reviewed on',row.review.on,'review.on',{type:'date'})+
      f('Reviewed by',row.review.by,'review.by')+
      f('Review note',row.review.note,'review.note',{area:true,wide:true})+'</div></fieldset>'+
      '<fieldset><legend>Resolution or closure</legend><div class="risk-fields">'+
      f('Resolved / closed on',row.resolution.on,'resolution.on',{type:'date'})+
      f('Resolution evidence',row.resolution.note,'resolution.note',{area:true})+'</div></fieldset>'+
      '<h4>Mitigation actions</h4><p>Actions retain their original IDs. Complete or cancel an action instead of deleting its history.</p>'+
      (row.actions.length?row.actions.map(mitigationEditor).join(''):empty('No mitigation action is recorded.'))+
      '<div class="risk-actions">'+button('Add mitigation action','add-action',{},row.actions.length>=100)+'</div></section>';
  }
  function draftView(){
    if(!session.draft)return empty('Prepare a native seed from the current register, or import a complete risk document.')+
      '<div class="risk-actions">'+button('Prepare current draft','seed',{},locked()||caseValue.program.state!=='OPEN')+'</div>'+importControl();
    const doc=session.draft;
    const selected=draftRisk();
    return '<div class="risk-actions">'+button('Download complete draft','download-draft')+button('Open supporting sources','sources')+
      button('Refresh current case','refresh')+button('Replace from current edition','seed',{},locked()||caseValue.program.state!=='OPEN')+'</div>'+
      '<p class="risk-notice">This edition will retain every existing risk and action identity. Close entries or cancel actions to preserve their history. A native preview checks the exact predecessor before any save.</p>'+
      (session.draftVersion!==caseValue.program.version?'<p class="risk-notice">The case is now version '+esc(caseValue.program.version)+'. The draft was opened at version '+esc(session.draftVersion)+'. Preview against the current source before saving.</p>':'')+
      (doc.supersedes?'<p>Retained predecessor: <code>'+esc(doc.supersedes.reviewId)+'</code> · '+esc(doc.supersedes.reviewSha256)+'</p>':'<p>First edition: no predecessor selected.</p>')+
      '<div class="risk-fields">'+editField('Register name',doc.name,'name','document',{required:true})+
      editField('Assessment as of',doc.asOfDate,'asOfDate','document',{type:'date',required:true,help:'Native overdue flags are evaluated at this date.'})+
      editField('Register note',doc.note,'note','document',{area:true,wide:true})+'</div>'+
      '<div class="risk-workbench"><aside><h4>Entries ('+doc.risks.length+'/200)</h4><div class="risk-actions">'+button('Add risk','add-risk',{},doc.risks.length>=200)+button('Add issue','add-issue',{},doc.risks.length>=200)+'</div>'+
      '<nav aria-label="Draft risk entries">'+doc.risks.map(row=>'<button type="button" data-risk-action="choose-risk" data-risk-id="'+esc(row.id)+'"'+(row.id===session.selectedRisk?' aria-current="true"':'')+'><strong>'+esc(row.title||'Untitled '+words(row.kind))+'</strong><small>'+esc(words(row.status))+' · '+esc(row.id)+'</small></button>').join('')+'</nav></aside><div>'+riskEditor(selected)+'</div></div>'+
      '<div class="risk-save-bar">'+button('Review complete draft','preview',{},locked()||caseValue.program.state!=='OPEN')+
      field('Reason for saving this edition',session.saveNote,{area:true,attrs:{'data-risk-save-note':'true'},help:'Recorded with the original operator and request.'})+
      button('Save reviewed edition','save',{},!canSave||!hasPreview()||locked()||caseValue.program.state!=='OPEN')+'</div>'+
      '<section data-risk-preview aria-label="Native risk assessment">'+(session.preview?filters()+reportView(session.preview.report,session.preview.document)+details('Complete normalized document, source and preview identity',session.preview):empty('Review the current draft to see native findings and save this edition.'))+'</section>'+
      '<details><summary>Import a complete risk document</summary>'+importControl()+'</details>';
  }
  function importControl(){return '<div class="risk-fields">'+field('Risk document JSON','',{type:'file',wide:true,attrs:{accept:'.json,application/json','data-risk-import':'true'},help:'Only the complete native risk document is read. Native preview validates every link and predecessor.'})+'</div>'+button('Use selected complete document','import',{},locked()||caseValue.program.state!=='OPEN');}
  function editionsView(){
    const rows=session.listing?.editions||[];
    return '<div class="risk-actions">'+button('Refresh editions','refresh')+button('Compare saved editions','comparison-open')+'</div>'+
      (rows.length?table(['Edition','Assessment date / operator','Recorded totals','Original predecessor','Open'],rows.map(row=>[
        '<strong>'+esc(row.name||row.id)+'</strong><small>'+esc(row.id)+'</small>'+esc(row.sha256),
        esc(row.asOfDate)+'<small>'+esc(row.actor)+' · '+esc(row.createdAt)+'</small>'+esc(row.note),
        esc(row.counts?.total??'—')+' entries<small>'+esc(row.counts?.issues??'—')+' issues · '+esc(row.counts?.overdueActions??'—')+' overdue actions</small>',
        esc(row.supersedes?.reviewId||'First edition'),
        '<div class="risk-actions">'+button('Open edition','open',{'data-review-id':row.id})+button('Export case','export-edition',{'data-review-id':row.id})+'</div>'
      ])):empty('No immutable register editions have been saved.'))+
      (session.history?'<section class="risk-panel"><h4>Entry history · '+esc(session.history.riskId)+'</h4>'+
        table(['Edition','State / priority','Review / resolution','Mitigation','Open'],session.history.entries.map(({edition,risk})=>[
          esc(edition.name||edition.id)+'<small>'+esc(edition.asOfDate)+' · '+esc(edition.id)+'</small>',
          badge(risk.kind)+' '+badge(risk.status)+' '+badge(risk.priority),
          esc([risk.review?.on,risk.review?.by,risk.review?.note].filter(Boolean).join(' · '))+'<small>'+esc([risk.resolution?.on,risk.resolution?.note].filter(Boolean).join(' · '))+'</small>',
          (risk.actions||[]).map(a=>esc(a.title)+' · '+esc(words(a.status))+'<small>'+esc(a.progress)+'</small>').join(''),
          button('Open edition','open',{'data-review-id':edition.id})
        ]))+details('Complete original lineage',session.history)+'</section>':'');
  }
  function requestView(){
    const pending=session.pending,accepted=session.accepted;
    return '<p>Each save uses its original complete command and stable request ID. Reading a receipt never runs the writer. An uncertain response keeps the same request until the original native table reconciles it.</p>'+
      (pending?'<section class="risk-pending"><h4>Retained original request</h4><p>'+esc(pending.command.requestId)+'</p>'+
        (pending.lastError?'<p>'+esc(pending.lastError.message)+'</p>':'')+
        '<div class="risk-actions">'+button('Read original outcome','reconcile')+button('Reconcile and send the same request','retry',{},!canSave)+
        button('Return rejected request to draft','return-draft',{},!pending.definitelyRejected)+'</div>'+details('Exact retained command',pending.command)+'</section>':'')+
      (accepted?'<section class="risk-pending"><h4>Known native success</h4><p>The original result is retained. Reopen and save its full local receipt before continuing.</p>'+
        button('Reopen known saved edition','finish')+details('Original accepted request and result',accepted)+'</section>':'')+
      (!pending&&!accepted?empty('No request is awaiting reconciliation.'):'')+
      '<div class="risk-actions">'+button('Download full desk and receipts','download-desk')+button('Retry local storage publication','persist')+'</div>'+
      (session.receipts.length?table(['Original request','Outcome','Case version / review'],session.receipts.map(row=>[
        esc(row.command.requestId),row.result?'Saved native edition':'Native absence after explicit rejection',
        row.result?esc(row.result.version)+' · '+esc(row.result.recordId):'Original command retained'
      ]))+details('Complete request history',session.receipts):'');
  }
  function updateControls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy()));
    root.querySelectorAll('input,select,textarea,button').forEach(el=>{
      const action=el.dataset.riskAction;
      const editing=el.hasAttribute('data-risk-field')||el.hasAttribute('data-risk-save-note')||el.hasAttribute('data-risk-import')||
        ['add-risk','add-issue','add-action','seed','import','preview'].includes(action);
      el.disabled=busy()||el.dataset.riskFixed==='true'||(editing&&(locked()||caseValue.program.state!=='OPEN'));
      if(action==='save')el.disabled=busy()||!canSave||!hasPreview()||locked()||caseValue.program.state!=='OPEN';
    });
  }
  function render(){
    if(!available())return;
    const previous=document.activeElement;
    const focus=previous&&root.contains(previous)?{filter:previous.dataset.riskFilter,comparison:previous.dataset.riskComparison,start:previous.selectionStart,end:previous.selectionEnd}:null;
    root.innerHTML='<header class="risk-heading"><div><h3>Delivery risks and mitigations</h3><p>A dated register of delivery risks, current issues, responsible contributors and mitigation evidence.</p></div>'+badge(caseValue.program.mode)+'</header>'+
      '<p role="status" aria-live="polite" data-risk-notice>'+esc(session.notice)+'</p>'+
      (session.error?'<p role="alert">'+esc(session.error)+'</p>':'')+
      (session.storageError?'<section class="risk-pending" role="alert"><p>'+esc(session.storageError)+'</p>'+button('Download complete desk','download-desk')+'</section>':'')+
      (locked()?'<div class="risk-pending">A retained request or local storage problem needs attention. '+button('Open original request','tab',{'data-risk-tab':'request'})+'</div>':'')+
      '<nav class="risk-tabs" aria-label="Risk register views">'+[['register','Register'],['draft','Draft edition'],['editions','Editions and history'],['request','Request recovery'],['copies','Working copies']].map(([key,label])=>'<button type="button" data-risk-action="tab" data-risk-tab="'+key+'"'+(session.tab===key?' aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav>'+
      '<div data-risk-panel tabindex="-1">'+(session.tab==='editions'&&comparison.visible?comparison.render():({register:registerView,draft:draftView,editions:editionsView,request:requestView,copies:copiesView}[session.tab]||registerView)())+'</div>';
    updateControls();
    if(focus?.filter||focus?.comparison){
      const next=root.querySelector(focus.comparison?'[data-risk-comparison="'+focus.comparison+'"]':'[data-risk-filter="'+focus.filter+'"]');next?.focus();
      if(next?.setSelectionRange&&typeof focus.start==='number')try{next.setSelectionRange(focus.start,focus.end);}catch{}
    }
  }

  function newRisk(kind){
    need(session.draft&&session.draft.risks.length<200,'A register may contain at most 200 entries.');
    const row={id:id('risk'),kind,title:'',description:'',category:'DELIVERY',identifiedOn:session.draft.asOfDate||today(),
      ownerId:null,ownerNote:'',status:'OPEN',likelihood:kind==='ISSUE'?'NOT_APPLICABLE':'UNASSESSED',impact:'UNASSESSED',
      priority:'UNASSESSED',assessmentNote:'',trigger:'',nextReviewOn:null,costIds:[],sourceIds:[],sourceNote:'',
      review:{on:null,by:'',note:''},resolution:{on:null,note:''},actions:[]};
    session.draft.risks.push(row);session.selectedRisk=row.id;changed();
  }
  function addAction(){
    const row=draftRisk();need(row&&row.actions.length<100,'Select a risk with fewer than 100 mitigation actions.');
    row.actions.push({id:id('action'),title:'',description:'',ownerId:null,ownerNote:'',status:'PLANNED',
      dueOn:null,completedOn:null,progress:'',sourceIds:[],sourceNote:''});changed();
  }
  const riskKeys=new Set(['title','kind','description','category','identifiedOn','ownerId','ownerNote','status','likelihood','impact','priority','assessmentNote','trigger','nextReviewOn','costIds','sourceIds','sourceNote','review.on','review.by','review.note','resolution.on','resolution.note']);
  const actionKeys=new Set(['title','description','ownerId','ownerNote','status','dueOn','completedOn','progress','sourceIds','sourceNote']);
  const docKeys=new Set(['name','asOfDate','note']);
  function input(event){
    const target=event.target;
    if(target.dataset.riskComparison!==undefined){
      if(busy())return;
      try{if(comparison.change(target))render();}catch(error){setError(error);render();}
      return;
    }
    if(target.dataset.riskFilter!==undefined){
      if(busy())return;
      const key=target.dataset.riskFilter;
      if(['search','statusFilter','kindFilter','ownerFilter'].includes(key)){session[key]=target.value;persist();render();}
      return;
    }
    if(target.hasAttribute('data-risk-save-note')){
      if(writable()){session.saveNote=target.value;persist();}
      return;
    }
    const key=target.dataset.riskField,scope=target.dataset.riskScope;
    if(!key||!session.draft||!writable())return;
    let row;
    if(scope==='document'){if(!docKeys.has(key))return;row=session.draft;}
    else if(scope==='risk'){if(!riskKeys.has(key))return;row=draftRisk();}
    else if(scope==='action'){if(!actionKeys.has(key))return;row=draftRisk()?.actions.find(a=>a.id===target.dataset.riskItem);}
    if(!row)return;
    let value=target.multiple?[...target.selectedOptions].map(o=>o.value):target.value;
    if(['ownerId','nextReviewOn','dueOn','completedOn','review.on','resolution.on'].includes(key)&&value==='')value=null;
    if(scope==='risk'&&key==='identifiedOn'&&session.seed?.document.risks.some(r=>r.id===row.id))return;
    if(scope==='risk'&&key==='kind'&&value==='RISK'&&session.seed?.document.risks.find(r=>r.id===row.id)?.kind==='ISSUE')return;
    if(key.includes('.')){const [parent,leaf]=key.split('.');row[parent][leaf]=value;}else row[key]=value;
    if(key==='sourceIds'||key==='sourceNote')delete row.sourceBasis;
    if(scope==='risk'&&key==='kind')row.likelihood=value==='ISSUE'?'NOT_APPLICABLE':row.likelihood==='NOT_APPLICABLE'?'UNASSESSED':row.likelihood;
    changed();
    if(key==='kind')render();
  }
  const editingActions=new Set(['seed','import','add-risk','add-issue','add-action','preview','save']);
  async function dispatch(action,target){
    if(action==='comparison-open'){
      if(!session.listing)await refresh();
      comparison.open({afterReviewId:session.book?.review?.id});session.tab='editions';persist();return;
    }
    if(action.startsWith('comparison-')){await comparison.action(action.slice('comparison-'.length),target);return;}
    if(editingActions.has(action))need(!locked()&&caseValue.program.state==='OPEN','Resolve the original request or reopen the original case before editing.');
    if(action==='export-copy'){await exportCopy();return;}
    if(action==='review-copy'){await stageCopy($('[data-risk-copy-import]')?.files[0]);return;}
    if(action==='adopt-copy'){await adoptCopy();return;}
    if(action==='cancel-copy'){session.copyReview=null;return;}
    if(action==='export-reviewed-copy'){need(session.copyReview,'Review a complete copy first.');await exportCopy(session.copyReview.desk);return;}
    if(action==='review-checkpoint'){await stageCheckpoint(target.dataset.copyId);return;}
    if(action==='export-checkpoint'){const row=session.copies.find(value=>value.id===target.dataset.copyId);need(row,'Choose an existing checkpoint.');await exportCopy(row.desk,programId+'-risk-checkpoint-'+row.id.slice(0,12)+'.json');return;}
    if(action==='remove-checkpoint'){await removeCheckpoint(target.dataset.copyId);return;}
    if(action==='tab'){session.tab=target.dataset.riskTab;persist();return;}
    if(action==='refresh'){await refresh();return;}
    if(action==='seed'){await makeDraft(target.dataset.reviewId||null);return;}
    if(action==='open'){await openBook(target.dataset.reviewId);return;}
    if(action==='add-risk'||action==='add-issue'){newRisk(action==='add-risk'?'RISK':'ISSUE');return;}
    if(action==='add-action'){addAction();return;}
    if(action==='choose-risk'){need(session.draft?.risks.some(r=>r.id===target.dataset.riskId),'The selected draft entry is unavailable.');session.selectedRisk=target.dataset.riskId;session.tab='draft';persist();return;}
    if(action==='inspect-risk'){need(session.book?.document.risks.some(r=>r.id===target.dataset.riskId),'The selected saved entry is unavailable.');session.selectedRisk=target.dataset.riskId;persist();return;}
    if(action==='preview'){await previewDraft();return;}
    if(action==='save'){await saveDraft();return;}
    if(action==='reconcile'){await reconcilePending(false);return;}
    if(action==='retry'){await reconcilePending(true);return;}
    if(action==='finish'){await finishAccepted();return;}
    if(action==='return-draft'){await returnToDraft();return;}
    if(action==='persist'){persist(true);session.notice='The complete local draft and retained request state are saved.';return;}
    if(action==='sources'){persist(true);if(available())await onSources();return;}
    if(action==='source'){await downloadSource(target.dataset.sourceId);return;}
    if(action==='export-edition'){await downloadEdition(target.dataset.reviewId);return;}
    if(action==='download-draft'){need(session.draft,'No local draft is available.');download(new Blob([JSON.stringify(session.draft,null,2)+'\n'],{type:'application/json'}),programId+'-risk-draft.json');return;}
    if(action==='download-book'){need(session.book,'Open an original edition first.');download(new Blob([JSON.stringify(session.book.document,null,2)+'\n'],{type:'application/json'}),session.book.review.id+'-risks.json');return;}
    if(action==='download-desk'){
      const value={schema:DESK,programId,staffContext:context};for(const key of savedKeys)value[key]=session[key];
      if(session.storageBlocked)try{value.unreadableOriginal=sessionStorage.getItem(storageKey);}catch{}
      download(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),programId+'-risk-desk.json');return;
    }
    if(action==='import'){await importDraft($('[data-risk-import]')?.files[0]);return;}
    if(action==='history'){
      const riskId=target.dataset.riskId,value=await saveApi(prefix+'/risk-register-history/'+enc(riskId));
      need(value.riskId===riskId&&Array.isArray(value.entries),'The original entry lineage is incomplete.');
      session.history=value;session.tab='editions';persist();return;
    }
  }
  async function run(work){
    if(!available()||busy())return;
    session.error='';
    const pending=Promise.resolve().then(work);session.inflight=pending;updateControls();
    try{return await pending;}catch(error){setError(error);}
    finally{if(session.inflight===pending)session.inflight=null;persist();render();}
  }
  function click(event){
    const target=event.target.closest('[data-risk-action]');if(!target||!root.contains(target)||target.disabled)return;
    event.preventDefault();
    void run(()=>dispatch(target.dataset.riskAction,target));
  }
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',input);
  function setHostBusy(value){hostBusy=Boolean(value);updateControls();}
  function dispose(){
    active=false;root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',input);
    persist();
    // Accepted transport/body owners remain in the retained per-staff case
    // session. Navigation never cancels a dispatched command or drops its result.
    return session.inflight||Promise.resolve();
  }
  const ready=(async()=>{
    render();
    while(session.inflight)try{await session.inflight;}catch{}
    if(!available()){initializing=false;return;}
    const work=(async()=>{
      await refresh();
      const accepted=!!session.accepted;
      if(accepted)await finishAccepted();
      if(session.requestedComparison){
        const selected=session.requestedComparison;
        await comparison.openReceived(selected);session.tab='editions';
        if(session.requestedComparison===selected)delete session.requestedComparison;
      }else if(!accepted){
        if(session.requestedReview){const selected=session.requestedReview;await openBook(selected);if(session.requestedReview===selected)delete session.requestedReview;}
        else if(session.listing.current&&!session.book)await openBook(session.listing.current.id);
      }
    })();
    session.inflight=work;
    try{await work;}catch(error){setError(error);}
    finally{if(session.inflight===work)session.inflight=null;initializing=false;persist();render();}
    if(available()&&caseValue.program.version>current.program.version)await onCase(caseValue,null);
  })();
  return {root,ready,setHostBusy,dispose};
}
