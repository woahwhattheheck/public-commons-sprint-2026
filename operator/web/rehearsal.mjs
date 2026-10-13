/* Upper Savannah operator rehearsal. Uses original retained actions, items and tasks. */
const RH_SCHEMA = 'upstate.operator-rehearsal-browser/v1';
const RH_DB = 'upstate-operator-rehearsal';
const RH_STEPS = ['study','geography','parameters','alternatives','calculation','maps','comparison','delivery','transfer'];
const RH_TABS = [['prepare','Prepare'],['walkthrough','Walkthrough'],['evidence','Evidence'],['history','History'],['export','Handover']];
const RH_SELECTION = [
  ['source_collection_id','Source collection','sources'],
  ['grid_id','Model grid','grids'],
  ['profile_id','Parameter profile','profiles'],
  ['baseline_run_id','Baseline run','runs'],
  ['comparison_id','Physical comparison','comparisons'],
  ['delivery_id','Delivery','deliveries'],
  ['spatial_review_id','Saved geographic view','spatial_reviews'],
  ['backup_task_id','Workspace backup task','tasks'],
  ['restore_task_id','Workspace restore task','tasks']
];
const RH_ACTIONS = new Set(['source-open','profile-new','grid-new','scenario-new','run-prepare','run-compare','delivery-new','backup','restore','inspect','run-log']);
const RH_ID = /^[0-9a-f]{64}$/;
const RH_STATES = new Set(['queued','running','complete','failed','interrupted','cancelled']);
const RH_MEDIA_LIMIT = 256 * 1024 * 1024;
const RH_MEDIA_EXTENSIONS = /\.(png|jpg|jpeg|webp|webm|mp4|mkv|mov)$/i;
const rhEsc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rhCopy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const rhJSON = v => JSON.stringify(v,null,2);
const rhStable = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '['+v.map(rhStable).join(',')+']' : '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+rhStable(v[k])).join(',')+'}';
const rhEqual = (a,b) => rhStable(a) === rhStable(b);
const rhShort = v => v ? String(v).slice(0,12) : 'Unselected';
const rhHuman = v => String(v ?? '').replace(/[_.-]/g,' ');
const rhWhen = v => {if(v===null||v===undefined||v==='')return 'Not recorded';const d=new Date(typeof v==='number'?v*1000:v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString();};
const rhBytes = v => {if(v===null||v===undefined)return 'Not recorded';let n=Number(v),i=0;const u=['B','KiB','MiB','GiB'];if(!Number.isFinite(n))return String(v);while(n>=1024&&i<3){n/=1024;i++;}return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+u[i];};
const rhElapsed = v => v===null||v===undefined ? 'No native timing recorded' : String(v)+' seconds from retained records';
const rhNow = () => new Date().toISOString();
const rhDigest = async value => {if(!globalThis.crypto?.subtle)throw Error('This browser cannot verify the original request identity.');const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rhStable(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');};
const rhSameMedia = (a,b) => !!a&&!!b&&a.filename===b.filename&&a.mime_type===b.mime_type&&a.bytes===b.bytes&&a.sha256===b.sha256;
const rhUUID = () => {if(!globalThis.crypto?.randomUUID)throw Error('This browser cannot create the retained operation identity. Open this operator in a current browser.');return crypto.randomUUID();};
const rhList = v => Array.isArray(v) ? v : [];
const rhText = v => v===null||v===undefined ? '' : typeof v==='string' ? v : Array.isArray(v) ? v.map(rhText).join('\n') : rhJSON(v);
const rhTextBlock = v => '<div class="rh-prose">'+rhEsc(rhText(v)).replace(/\n/g,'<br>')+'</div>';
const rhButton = (action,label,extra='',kind='') => '<button type="button" data-rh="'+rhEsc(action)+'" class="rh-button '+rhEsc(kind)+'" '+extra+'>'+rhEsc(label)+'</button>';
const rhBadge = (value,kind='') => '<span class="rh-badge '+rhEsc(kind)+'">'+rhEsc(value)+'</span>';
const rhEmpty = (title,text) => '<div class="rh-empty"><h3>'+rhEsc(title)+'</h3><p>'+rhEsc(text)+'</p></div>';
const rhField = (name,label,value='',options={}) => '<label class="rh-field '+(options.wide?'rh-wide':'')+'"><span>'+rhEsc(label)+'</span>'+
  (options.area?'<textarea name="'+rhEsc(name)+'" rows="'+(options.rows||3)+'" '+(options.disabled?'disabled':'')+'>'+rhEsc(value)+'</textarea>':
   '<input name="'+rhEsc(name)+'" type="'+rhEsc(options.type||'text')+'" value="'+rhEsc(value)+'" '+(options.required?'required ':'')+(options.disabled?'disabled':'')+'>')+
  (options.note?'<small>'+rhEsc(options.note)+'</small>':'')+'</label>';
const rhTable = (heads,rows) => '<div class="rh-table-wrap"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+rhEsc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const rhDetails = (label,value,open=false) => '<details class="rh-details" '+(open?'open':'')+'><summary>'+rhEsc(label)+'</summary><pre>'+rhEsc(rhJSON(value))+'</pre></details>';
const rhTitle = row => row?.title||row?.name||row?.metadata?.title||row?.spec?.title||row?.selection?.title||(row?.action?rhHuman(row.action):'Retained item');
const rhBlankSelection = () => ({alternative_run_ids:[]});
function rhEnvelope(workspace){
  return {schema:RH_SCHEMA,workspace,drafts:{},stepDrafts:{},pending:null,uploadPending:null,receipts:[],uploadReceipts:[],conflicts:[],selection:{id:null,revision:null,tab:'prepare',step:'study'},updated_at:rhNow()};
}
let rhDBPromise=null;
function rhDatabase(){
  if(!globalThis.indexedDB)return Promise.reject(Error('Browser storage is unavailable. Reading remains available; a request must be retained before it can be sent.'));
  if(!rhDBPromise)rhDBPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(RH_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspaces'))request.result.createObjectStore('workspaces');};
    request.onerror=()=>reject(request.error||Error('Cannot open retained browser storage.'));
    request.onblocked=()=>reject(Error('Another operator window is closing its browser storage. Close that older window, then refresh.'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();rhDBPromise=null;};resolve(db);};
  }).catch(error=>{rhDBPromise=null;throw error;});
  return rhDBPromise;
}
async function rhTransaction(key,workspace,update){
  const db=await rhDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('workspaces',update?'readwrite':'readonly'),store=tx.objectStore('workspaces');
    let result,ownError;
    const request=store.get(key);
    request.onsuccess=()=>{
      try{
        const old=request.result===undefined?rhEnvelope(workspace):request.result;
        if(old?.schema!==RH_SCHEMA||old.workspace!==workspace||!old.drafts||!Array.isArray(old.receipts))throw Error('The retained browser record does not match this workspace. Its original value has been preserved.');
        result=rhCopy(old);
        if(update){update(result);result.serial=(old.serial||0)+1;result.updated_at=rhNow();store.put(result,key);}
      }catch(error){ownError=error;tx.abort();}
    };
    request.onerror=()=>{ownError=request.error;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(ownError||tx.error||Error('The retained browser record could not be saved.'));
    tx.onabort=()=>reject(ownError||tx.error||Error('The retained browser write was interrupted.'));
  });
}

/** Mounts the rehearsal desk. Model operations continue through the original operator. */
export function attachRehearsal({getState,api,endpoint,openItem,showTask,fileList,toast,refreshState,navigate,openControl}){
  let root=null,scope=null,epoch=0,overview=null,opened=null,stored=null,draft=null,stepDraft=null;
  let view={id:null,revision:null,tab:'prepare',step:'study'},loading=false,busy=false,error='',storageError='',notice='',search='';
  let writeChain=Promise.resolve(),refreshPromise=null,refreshAgain=false,poll=null,detached=true;
  let recordGeneration=0,recordIntent=null;
  const taskCache=new Map(),fileSelections=new Map();
  const client=rhUUID();
  const currentWorkspace=()=>getState()?.workspace_key||null;
  const context=()=>scope?{workspace:scope.workspace,key:scope.key,epoch}:null;
  const isCurrent=ctx=>!!ctx&&scope?.key===ctx.key&&currentWorkspace()===ctx.workspace&&ctx.epoch===epoch;
  const newRecordIntent=()=>recordIntent={generation:++recordGeneration,workspace:currentWorkspace()};
  const ownsRecordIntent=(intent,ctx=context())=>!!intent&&recordIntent===intent&&intent.workspace===ctx?.workspace&&isCurrent(ctx);
  const record=()=>opened?.record||null;
  const currentRevision=()=>opened?.current_revision??record()?.revision??null;
  const historical=()=>!!record()&&record().revision!==currentRevision();
  const draftKey=()=>view.id||'new';
  const stepKey=()=>String(view.id||'new')+':'+view.step;
  const pending=()=>stored?.pending||null;
  const uploadPending=()=>stored?.uploadPending||null;
  const taskBusy=()=>!!pending()||busy;
  const notify=text=>{notice=text;if(typeof toast==='function')toast(text);};
  const available=kind=>{
    const primary=rhList(overview?.available?.[kind]);
    if(kind!=='tasks')return primary;
    const map=new Map(primary.map(x=>[x.id,x]));
    for(const row of rhList(getState()?.tasks))if(!map.has(row.id))map.set(row.id,row);
    return [...map.values()];
  };
  const findItem=(kind,id)=>available(kind).find(x=>x.id===id)||null;
  function scopedPath(path,values={},ctx=context()){
    if(!ctx)throw Error('Choose the original workspace first.');
    return endpoint(path,{workspace:ctx.workspace,...values});
  }
  function setError(value){error=value?.message||String(value);paint();}
  function broadcast(ctx){
    try{channel?.postMessage({client,key:ctx.key});}catch{}
  }
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('upstate-rehearsal-updates'):null;
  if(channel)channel.onmessage=event=>{
    if(event.data?.client===client||event.data?.key!==scope?.key||detached)return;
    notice='Another window updated retained rehearsal work. Refresh to read its current request and revision.';
    schedulePoll(500);
    paint();
  };
  async function write(ctx,change){
    if(!ctx)throw Error('Choose the original workspace first.');
    try{
      const value=await rhTransaction(ctx.key,ctx.workspace,change);
      if(isCurrent(ctx)&&(!stored||(value.serial||0)>=(stored.serial||0))){stored=value;}
      broadcast(ctx);return value;
    }catch(cause){if(isCurrent(ctx)){storageError=cause.message||String(cause);paint();}throw cause;}
  }
  function enqueue(ctx,change){
    const next=writeChain.catch(()=>{}).then(()=>write(ctx,change));
    writeChain=next;next.catch(cause=>{if(isCurrent(ctx)){storageError=cause.message||String(cause);paint();}});
    return next;
  }
  async function flush(){
    await writeChain;
    if(storageError)throw Error(storageError);
  }
  function blankDraft(rec=null){
    return {version:0,base_revision:rec?.revision??null,record_sha256:rec?.record_sha256??null,updated_at:rhNow(),
      fields:{title:rec?.title||'',operator:rec?.operator||'',audience:rec?.audience||'',mode:rec?.mode||'recorded',
        selection:rhCopy(rec?.selection||rhBlankSelection()),notes:rec?.notes||'',science_notes:rec?.science_notes||''}};
  }
  function blankStepDraft(){
    return {version:0,note:'',task_ids:[],uploads:[],updated_at:rhNow()};
  }
  async function ensureDraft(ctx=context(),intent=recordIntent){
    if(!ctx||!isCurrent(ctx)||intent!==recordIntent)return;
    const key=draftKey(),skey=stepKey(),source=record(),initial=blankDraft(source);
    const data=await write(ctx,value=>{
      if(!value.drafts[key])value.drafts[key]=initial;
      if(!value.stepDrafts[skey])value.stepDrafts[skey]=blankStepDraft();
    });
    if(isCurrent(ctx)&&intent===recordIntent&&key===draftKey()&&skey===stepKey()){
      draft=rhCopy(data.drafts[key]);stepDraft=rhCopy(data.stepDrafts[skey]);
    }
  }
  function updateDraft(field,value){
    if(!draft||taskBusy()||historical()||record()?.active_step)return;
    const ctx=context(),key=draftKey(),before=draft.version;
    draft=rhCopy(draft);draft.version++;draft.updated_at=rhNow();
    if(field.startsWith('selection.'))draft.fields.selection[field.slice(10)]=value;
    else draft.fields[field]=value;
    const updated=rhCopy(draft);
    enqueue(ctx,data=>{
      const prior=data.drafts[key];
      if(prior&&prior.version!==before)throw Error('This draft changed in another window. Your current text is still visible; retain it below before loading the stored draft.');
      data.drafts[key]=updated;
    });
  }
  function updateStep(field,value){
    if(!stepDraft||taskBusy()||historical())return;
    const ctx=context(),key=stepKey(),before=stepDraft.version;
    stepDraft=rhCopy(stepDraft);stepDraft.version++;stepDraft.updated_at=rhNow();stepDraft[field]=value;
    const updated=rhCopy(stepDraft);
    enqueue(ctx,data=>{
      const prior=data.stepDrafts[key];
      if(prior&&prior.version!==before)throw Error('The step notes changed in another window. Your current notes remain visible; retain them before loading the stored draft.');
      data.stepDrafts[key]=updated;
    });
  }
  async function retainAndReloadDraft(){
    const ctx=context(),local={draftKey:draftKey(),stepKey:stepKey(),draft:rhCopy(draft),stepDraft:rhCopy(stepDraft),saved_at:rhNow()};
    await writeChain.catch(()=>{});
    const data=await write(ctx,value=>{value.conflicts.push(local);});
    if(!isCurrent(ctx))return;
    draft=rhCopy(data.drafts[draftKey()]||blankDraft(record()));
    stepDraft=rhCopy(data.stepDrafts[stepKey()]||blankStepDraft());
    writeChain=Promise.resolve();storageError='';notice='The previous local draft is retained in browser history. The current stored draft is open.';paint();
  }
  function validateSelection(selection){
    if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('Choose the retained case selection.');
    const allowed=new Set(RH_SELECTION.map(x=>x[0]).concat('alternative_run_ids'));
    for(const [key,value] of Object.entries(selection)){
      if(!allowed.has(key))throw Error('The selection contains an unknown field: '+key);
      if(key==='alternative_run_ids'){
        if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!RH_ID.test(x)))throw Error('Choose original retained alternative run IDs.');
        if(new Set(value).size!==value.length)throw Error('Each alternative run can be selected once.');
      }else if(value!==null&&value!==undefined&&value!==''&&(!RH_ID.test(value)||typeof value!=='string'))throw Error('Choose the original '+rhHuman(key)+'.');
    }
  }
  function validateRecord(value,expectedId=null){
    if(!value||typeof value!=='object'||!RH_ID.test(value.id||'')||!Number.isSafeInteger(value.revision)||value.revision<1||
       !RH_ID.test(value.record_sha256||'')||!Array.isArray(value.steps)||!value.selection||
       !['recorded','live'].includes(value.mode))throw Error('The operator returned an incomplete rehearsal record. Its original request remains retained.');
    if(expectedId&&value.id!==expectedId)throw Error('The returned rehearsal is a different retained record.');
    validateSelection(value.selection);
    const ids=value.steps.map(x=>x.id);
    if(ids.length!==RH_STEPS.length||ids.some((id,i)=>id!==RH_STEPS[i]))throw Error('The returned rehearsal does not carry the complete ordered teaching steps.');
    for(const step of value.steps)if(typeof step.ready!=='boolean'||!Array.isArray(step.attempts)||!Array.isArray(step.controls))throw Error('The returned rehearsal step is incomplete.');
    return value;
  }
  function validateCompletion(value,rec){
    if(!value||value.total_steps!==rec.steps.length||!Number.isSafeInteger(value.observed_steps)||!Array.isArray(value.steps)||value.steps.length!==rec.steps.length)throw Error('The native completion evidence for this saved selection is incomplete. Refresh the same record.');
    let observed=0;
    for(let i=0;i<rec.steps.length;i++){
      const step=rec.steps[i],entry=value.steps[i],attempts=step.attempts;
      if(!entry||entry.id!==step.id||!['observed','deferred','unrecorded'].includes(entry.state)||!Array.isArray(entry.attempt_matches)||entry.attempt_matches.length!==attempts.length||entry.attempt_matches.some(v=>typeof v!=='boolean')||!Array.isArray(entry.compatible_attempt_indices))throw Error('The native attempt-selection evidence does not match this saved step.');
      const matching=entry.attempt_matches.flatMap((match,index)=>match?[index]:[]);
      const latest=matching.length?matching[matching.length-1]:null;
      if(!rhEqual(matching,entry.compatible_attempt_indices)||entry.current_attempt_index!==latest||entry.state!==(latest===null?'unrecorded':attempts[latest].outcome))throw Error('The native completion status is not bound to its latest compatible attempt.');
      if(entry.state==='observed')observed++;
    }
    if(value.observed_steps!==observed)throw Error('The native observed-step count differs from its complete selection evidence.');
    return value;
  }
  function completionStep(step){
    const completion=opened?.completion;
    if(!completion||!step)return null;
    return completion.steps.find(entry=>entry.id===step.id)||null;
  }
  function validateTask(task,request,requestSha=null){
    if(!task||task.schema!=='upstate.operator-task/v1'||!RH_ID.test(task.id||'')||!RH_STATES.has(task.state)||
       task.workspace!==request.workspace||task.action!==request.action||!rhEqual(task.payload,request.payload)||
       typeof task.operation_id!=='string'||!RH_ID.test(task.request_sha256||'')||(requestSha&&task.request_sha256!==requestSha)||!Array.isArray(task.attempts)){
      throw Error('The task response does not match the complete frozen action. The original request is still retained for reconciliation.');
    }
    return task;
  }
  function validateFiles(files){
    if(!Array.isArray(files)||!files.length)throw Error('The completed export has no original download tickets yet. Check the same task again.');
    for(const file of files){
      let url;try{url=new URL(file.url,location.href);}catch{throw Error('The original file ticket is unreadable.');}
      if(url.origin!==location.origin||!/^https?:$/.test(url.protocol)||typeof file.filename!=='string'||
         !RH_ID.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw Error('The original export file identity is incomplete.');
    }
    return files;
  }

  function recordFields(rec){
    return {title:rec.title,operator:rec.operator,audience:rec.audience,mode:rec.mode,selection:rhCopy(rec.selection),notes:rec.notes||'',science_notes:rec.science_notes||''};
  }
  const draftDirty=()=>!!draft&&(!record()||!rhEqual(draft.fields,recordFields(record())));
  function selectedStep(){return rhList(record()?.steps).find(x=>x.id===view.step)||null;}
  function liveStep(){
    const list=opened?.live?.steps;
    return (Array.isArray(list)?list.find(x=>x.id===view.step):list?.[view.step])||selectedStep();
  }
  async function changePending(ctx,id,change){
    return write(ctx,data=>{
      if(!data.pending){
        if(data.receipts.some(x=>x.request?.operation_id===id))return;
        throw Error('The original pending request is no longer selected in this workspace.');
      }
      if(data.pending.request.operation_id!==id)throw Error('Another retained request is selected. Its identity has not been changed.');
      change(data.pending,data);
    });
  }
  async function freezeAction(action,payload){
    if(busy)throw Error('Wait for this retained request to finish its current read.');
    const ctx=context(),ui={view:rhCopy(view),draftKey:draftKey(),stepKey:stepKey(),draft:rhCopy(draft),stepDraft:rhCopy(stepDraft)};
    if(!ctx||!isCurrent(ctx))throw Error('Choose the current original workspace.');
    await flush();
    if(!isCurrent(ctx)||view.id!==ui.view.id||view.step!==ui.view.step||draft?.version!==ui.draft?.version||stepDraft?.version!==ui.stepDraft?.version)throw Error('The visible draft or workspace changed while preparing this action. Its current draft is retained; prepare the action again.');
    const request={workspace:ctx.workspace,action,payload:rhCopy(payload),operation_id:'rehearsal_'+rhUUID()};
    const requestSha=await rhDigest({workspace:request.workspace,action:request.action,payload:request.payload});
    if(!isCurrent(ctx))throw Error('The selected workspace changed before this request was retained.');
    if(new TextEncoder().encode(JSON.stringify(request)).byteLength>4*1024*1024)throw Error('The complete action exceeds the original operator’s 4 MiB JSON limit. Keep the draft and reduce its authored notes.');
    const original={request,request_sha256:requestSha,created_at:rhNow(),phase:'prepared',task_id:null,task_operation_id:null,attempts:[],preflight:null,
      ui,last_error:null};
    const data=await write(ctx,value=>{
      if(value.pending)throw Error('An original rehearsal request is still retained. Reconcile that request before creating another.');
      if(value.uploadPending)throw Error('Reconcile the selected media upload before submitting its teaching step.');
      const shared=value.drafts[original.ui.draftKey];
      if(original.ui.draft&&shared?.version!==original.ui.draft.version)throw Error('The browser draft changed in another window. Load the stored draft before sending.');
      value.pending=original;
    });
    if(isCurrent(ctx)){stored=data;paint();}
    return {ctx,original:rhCopy(data.pending)};
  }
  async function perform(action,payload){
    if(historical()&&action!=='rehearsal.export')throw Error('Open the current rehearsal revision before changing it.');
    if(action!=='rehearsal.export'&&record()?.active_step&&action==='rehearsal.save')throw Error('Record or defer the active teaching step before changing the selection.');
    const frozen=await freezeAction(action,payload);
    return sendFrozen(frozen.ctx,frozen.original);
  }
  async function sendFrozen(ctx,original){
    const id=original.request.operation_id;
    if(isCurrent(ctx)){busy=true;error='';paint();}
    try{
      original=await retainInitialCensus(ctx,original);
      if(original.resolvedTask){await receiveTask(ctx,id,original.resolvedTask,{refreshCompleted:true});return;}
      await changePending(ctx,id,p=>{p.phase='sending';p.attempts.push({started_at:rhNow(),route:'/api/actions'});p.last_error=null;});
      const task=await api('/api/actions',{method:'POST',body:rhCopy(original.request)});
      validateTask(task,original.request,original.request_sha256);
      await receiveTask(ctx,id,task,{refreshCompleted:true});
    }catch(cause){
      await changePending(ctx,id,p=>{
        p.phase=p.task_id?p.phase:'unresolved';
        p.last_error={message:cause.message||String(cause),status:cause.status??null,code:cause.code??null,observed_at:rhNow()};
      }).catch(()=>{});
      if(isCurrent(ctx)){error=cause.message||String(cause);notice='The complete original request is retained. Reconcile it here; a new operation identity has not been created.';}
    }finally{if(isCurrent(ctx)){busy=false;paint();schedulePoll();}}
  }
  async function receiveTask(ctx,id,task,{refreshCompleted=false}={}){
    const data=await rhTransaction(ctx.key,ctx.workspace);
    const original=data.pending?.request.operation_id===id?data.pending:data.receipts.find(x=>x.request?.operation_id===id);
    if(!original)throw Error('Cannot bind the returned task to its original retained request.');
    const requestSha=original.request_sha256||await rhDigest({workspace:original.request.workspace,action:original.request.action,payload:original.request.payload});
    validateTask(task,original.request,requestSha);
    if(await rhDigest({workspace:task.workspace,operation_id:task.operation_id})!==task.id)throw Error('The returned task identity does not match its original native operation.');
    if(original.task_id&&task.id!==original.task_id)throw Error('The returned task differs from the task already retained for this request.');
    taskCache.set(ctx.key+':'+task.id,rhCopy(task));
    if(refreshCompleted&&task.state==='complete'){
      await changePending(ctx,id,p=>{p.task_id=task.id;p.task_operation_id=task.operation_id;p.phase='complete-response';p.last_task=task;});
      const complete=await api(scopedPath('/api/task',{id:task.id},ctx));
      return receiveTask(ctx,id,complete);
    }
    if(task.state!=='complete'){
      await changePending(ctx,id,p=>{
        p.task_id=task.id;p.task_operation_id=task.operation_id;p.phase=task.state;p.last_task=rhCopy(task);p.last_error=task.error?{...task.error,observed_at:rhNow()}:null;
      });
      if(isCurrent(ctx)&&task.operation_id!==original.request.operation_id)notice='The original operator joined this identical input to an already-active task. Both submitted and returned operation identities are retained.';
      return task;
    }
    let rec=null;
    if(task.action==='rehearsal.export'){
      if(!task.result||typeof task.result!=='object')throw Error('The complete export descriptor is missing. Check the same retained task again.');
      validateFiles(task._downloads);
    }else rec=validateRecord(task.result,original.request.payload.id||null);
    const completed=await write(ctx,value=>{
      const selected=value.pending;
      if(!selected){
        if(value.receipts.some(x=>x.request.operation_id===id))return;
        throw Error('The completed task has no matching retained request.');
      }
      if(selected.request.operation_id!==id)throw Error('The completed task belongs to another original request.');
      value.receipts.push({...rhCopy(selected),phase:'complete',task_id:task.id,task_operation_id:task.operation_id,task:rhCopy(task),received_at:rhNow()});
      value.pending=null;
      if(rec){
        const key=selected.ui.draftKey,old=value.drafts[key];
        if(old?.version===selected.ui.draft?.version){
          const next=blankDraft(rec);next.version=(value.drafts[rec.id]?.version??old.version)+1;
          value.drafts[rec.id]=next;
          if(key==='new'){const fresh=blankDraft();fresh.version=old.version+1;value.drafts.new=fresh;}
        }
        if(task.action==='rehearsal.record'){
          const skey=selected.ui.stepKey,oldStep=value.stepDrafts[skey];
          if(oldStep?.version===selected.ui.stepDraft?.version){
            const next=blankStepDraft();next.version=oldStep.version+1;value.stepDrafts[skey]=next;
          }
        }
        if(value.selection.id===selected.ui.view.id){
          value.selection={...value.selection,id:rec.id,revision:rec.revision,tab:task.action==='rehearsal.save'?'walkthrough':value.selection.tab};
        }
      }
    });
    if(isCurrent(ctx)){
      stored=completed;error='';
      if(rec&&view.id===original.ui.view.id){
        view={...view,id:rec.id,revision:rec.revision,tab:task.action==='rehearsal.save'?'walkthrough':view.tab};
        opened={record:rec,current_revision:rec.revision,history:opened?.history||[],live:{selection:rec.selection,steps:rec.steps}};
        draft=rhCopy(completed.drafts[rec.id]||blankDraft(rec));
        stepDraft=rhCopy(completed.stepDrafts[stepKey()]||blankStepDraft());
      }
      notify(task.action==='rehearsal.export'?'The original handover export is complete. Open its retained download tickets.':'The teaching record is saved with its original evidence and revision.');
      paint();
      if(typeof refreshState==='function')Promise.resolve(refreshState({force:true})).catch(()=>{});
      schedulePoll(1000);
    }
    return task;
  }
  function possibleCoalescedTask(task,previous){
    if(!previous)return true;
    if(['queued','running'].includes(previous.state))return true;
    if(!['failed','interrupted','cancelled'].includes(previous.state))return false;
    // Original resume first changes a terminal task to queued without changing its attempts.
    if(task.state==='queued')return true;
    // Once its worker starts, the original task appends a numbered, timestamped attempt.
    const earlier=new Set(rhList(previous.attempts).map(a=>rhStable({number:a.number,started_at:a.started_at})));
    return rhList(task.attempts).some(a=>Number.isSafeInteger(a.number)&&a.number>0&&typeof a.started_at==='string'&&a.started_at.length>0&&!earlier.has(rhStable({number:a.number,started_at:a.started_at})));
  }
  async function reconcile(){
    await flush();const ctx=context(),data=await rhTransaction(ctx.key,ctx.workspace),p=data.pending;
    if(!p)return;
    if(p.task_id)return checkTask(ctx,p);
    if(p.attempts.length===0)return sendFrozen(ctx,p);
    if(isCurrent(ctx)){busy=true;error='';paint();}
    try{
      const census=await taskCensus(ctx,p),own=census.matches.filter(t=>t.operation_id===p.request.operation_id);
      if(own.length>1)throw Error('The original task identity has multiple retained records. Preserve this request for native reconciliation.');
      if(own.length===1)return await receiveTask(ctx,p.request.operation_id,own[0],{refreshCompleted:true});
      const before=new Map(rhList(p.preflight?.matches).map(t=>[t.id,t]));
      const candidates=census.matches.filter(t=>possibleCoalescedTask(t,before.get(t.id)));
      await changePending(ctx,p.request.operation_id,value=>{value.last_census=census;value.candidates=candidates;value.phase=candidates.length>1?'task-selection-required':'reconciled-census';});
      if(candidates.length===1)return await receiveTask(ctx,p.request.operation_id,candidates[0],{refreshCompleted:true});
      if(candidates.length>1){if(isCurrent(ctx))notice='Several actual tasks have this complete input. Select the original task below; no action has been resubmitted.';return;}
      return await sendFrozen(ctx,p);
    }finally{if(isCurrent(ctx)){busy=false;paint();schedulePoll();}}
  }

  async function taskCensus(ctx,original){
    const state=await api(scopedPath('/api/state',{},ctx));
    if(state?.workspace_key!==ctx.workspace||!Array.isArray(state.tasks))throw Error('The complete original task census could not be read for this workspace.');
    const requestSha=original.request_sha256||await rhDigest({workspace:original.request.workspace,action:original.request.action,payload:original.request.payload});
    const matches=[];
    for(const task of state.tasks){
      if(task.workspace!==ctx.workspace)throw Error('The returned task census contains a different workspace.');
      if(task.operation_id===original.request.operation_id&&!rhEqual({action:task.action,payload:task.payload},{action:original.request.action,payload:original.request.payload}))throw Error('The original operation identity is bound to different native inputs.');
      if(task.action===original.request.action&&rhEqual(task.payload,original.request.payload)){
        validateTask(task,original.request,requestSha);
        if(await rhDigest({workspace:task.workspace,operation_id:task.operation_id})!==task.id)throw Error('A matching task has a different native identity.');
        matches.push(rhCopy(task));
      }
    }
    return {workspace:ctx.workspace,observed_at:rhNow(),task_count:state.tasks.length,complete_task_list:true,request_sha256:requestSha,matches,closing:!!state.closing};
  }
  async function retainInitialCensus(ctx,original){
    const data=await rhTransaction(ctx.key,ctx.workspace),selected=data.pending;
    if(!selected||selected.request.operation_id!==original.request.operation_id)throw Error('The original action is no longer pending.');
    if(selected.preflight)return selected;
    const census=await taskCensus(ctx,selected);
    const saved=await changePending(ctx,selected.request.operation_id,value=>{value.preflight=census;value.request_sha256=census.request_sha256;});
    const own=census.matches.filter(task=>task.operation_id===selected.request.operation_id);
    if(own.length>1)throw Error('The original operation has multiple native task identities.');
    if(own.length===1)return {...saved.pending,resolvedTask:own[0]};
    if(census.closing)throw Error('The original operator is draining. The frozen request and pre-send task census remain retained.');
    return saved.pending;
  }
  async function adoptActualTask(id){
    const ctx=context(),original=rhCopy(pending());
    if(!original||!rhList(original.candidates).some(task=>task.id===id))throw Error('Choose one of the actual matching tasks in the retained census.');
    const task=await api(scopedPath('/api/task',{id},ctx));
    validateTask(task,original.request,original.request_sha256);
    await changePending(ctx,original.request.operation_id,value=>{value.task_selection={task_id:id,selected_at:rhNow(),basis:'explicit original task selected from full input census'};});
    return receiveTask(ctx,original.request.operation_id,task);
  }

  async function checkTask(ctx=context(),p=pending()){
    if(!p?.task_id)return;
    if(isCurrent(ctx)){busy=true;error='';paint();}
    try{
      const value=await api(scopedPath('/api/task',{id:p.task_id},ctx));
      await receiveTask(ctx,p.request.operation_id,value);
    }catch(cause){
      await changePending(ctx,p.request.operation_id,value=>{value.last_error={message:cause.message||String(cause),status:cause.status??null,code:cause.code??null,observed_at:rhNow()};}).catch(()=>{});
      if(isCurrent(ctx))error=cause.message||String(cause);
    }finally{if(isCurrent(ctx)){busy=false;paint();schedulePoll();}}
  }
  async function resumeTask(){
    await flush();const ctx=context(),p=rhCopy(pending());if(!p?.task_id)throw Error('Reconcile the original task first.');
    const fresh=await api(scopedPath('/api/task',{id:p.task_id},ctx));validateTask(fresh,p.request,p.request_sha256);
    if(fresh.state==='complete'||['queued','running'].includes(fresh.state))return receiveTask(ctx,p.request.operation_id,fresh);
    if(!['failed','interrupted','cancelled'].includes(fresh.state))throw Error('This original task cannot be resumed.');
    if(isCurrent(ctx)){busy=true;paint();}
    try{
      await changePending(ctx,p.request.operation_id,value=>{value.phase='resuming';value.attempts.push({started_at:rhNow(),route:'/api/task/resume',task_id:p.task_id});});
      const result=await api('/api/task/resume',{method:'POST',body:{id:p.task_id}});
      validateTask(result,p.request,p.request_sha256);await receiveTask(ctx,p.request.operation_id,result,{refreshCompleted:true});
    }catch(cause){
      await changePending(ctx,p.request.operation_id,value=>{value.last_error={message:cause.message||String(cause),status:cause.status??null,code:cause.code??null,observed_at:rhNow()};}).catch(()=>{});
      if(isCurrent(ctx))error=cause.message||String(cause);
    }finally{if(isCurrent(ctx)){busy=false;paint();schedulePoll();}}
  }
  function canKeepFailure(p){
    return !!p&&(!!p.task_id&&['failed','interrupted','cancelled'].includes(p.phase)||
      !p.task_id&&[400,413,415,422].includes(p.last_error?.status));
  }
  async function keepFailure(){
    const ctx=context(),original=rhCopy(pending());
    if(!canKeepFailure(original))throw Error('This request still needs its original outcome reconciled.');
    if(original.task_id){
      const fresh=await api(scopedPath('/api/task',{id:original.task_id},ctx));validateTask(fresh,original.request,original.request_sha256);
      if(fresh.state==='complete'||['queued','running'].includes(fresh.state))return receiveTask(ctx,original.request.operation_id,fresh);
      original.last_task=fresh;original.phase=fresh.state;
    }
    await write(ctx,value=>{
      if(value.pending?.request.operation_id!==original.request.operation_id)throw Error('Another original request is now selected.');
      value.receipts.push({...rhCopy(value.pending),phase:original.phase,last_task:original.last_task,retained_without_replay_at:rhNow()});
      value.pending=null;
    });
    if(isCurrent(ctx)){
      notice='The full failed request and any committed native state remain in history. Inspect the current record before preparing a changed action.';
      await refresh({force:true});paint();
    }
  }
  async function reopenReceipt(index){
    const ctx=context(),receipt=stored?.receipts?.[index];
    if(!receipt?.task_id)throw Error('This response has no native task identity. Its exact rejected request remains available in history.');
    const fresh=await api(scopedPath('/api/task',{id:receipt.task_id},ctx));validateTask(fresh,receipt.request,receipt.request_sha256);
    taskCache.set(ctx.key+':'+fresh.id,fresh);
    if(fresh.state==='complete'){if(fresh.action==='rehearsal.export')validateFiles(fresh._downloads);paint();return;}
    await write(ctx,value=>{
      if(value.pending)throw Error('Finish reconciling the selected request first.');
      value.pending={...rhCopy(receipt),phase:fresh.state,last_task:fresh,task_id:fresh.id,task_operation_id:fresh.operation_id};
    });
    if(isCurrent(ctx)){view.tab='history';paint();}
  }
  async function saveDraft(){
    if(!draft)throw Error('Open the preparation form.');
    if(record()&&draft.base_revision!==currentRevision())throw Error('Review the current native revision before adopting it for this draft.');
    const fields=rhCopy(draft.fields);
    if(!fields.title.trim()||!fields.operator.trim()||!String(fields.audience||'').trim())throw Error('Name the walkthrough, the person operating it, and the people being shown the work.');
    validateSelection(fields.selection);
    for(const [key] of RH_SELECTION)if(fields.selection[key]==='')fields.selection[key]=null;
    const payload={...fields};
    if(view.id){payload.id=view.id;payload.expected_revision=draft.base_revision;}
    return perform('rehearsal.save',payload);
  }
  async function adoptRevision(){
    await flush();const ctx=context();if(!view.id)throw Error('Choose an existing rehearsal.');
    const fresh=await readRecord(ctx,view.id);
    if(fresh.record.active_step)throw Error('Record or defer the current active step before revising its selection.');
    const key=draftKey(),retained=rhCopy(draft);
    const data=await write(ctx,value=>{
      if(value.pending)throw Error('Reconcile the original request before adopting a current revision.');
      if(value.drafts[key]?.version!==retained.version)throw Error('This browser draft changed. Load the current stored draft.');
      value.conflicts.push({kind:'revision-adoption',draftKey:key,draft:retained,native_revision:fresh.record.revision,native_record_sha256:fresh.record.record_sha256,saved_at:rhNow()});
      value.drafts[key]={...retained,version:retained.version+1,base_revision:fresh.record.revision,record_sha256:fresh.record.record_sha256,updated_at:rhNow()};
    });
    if(isCurrent(ctx)){opened=fresh;view.revision=fresh.record.revision;draft=rhCopy(data.drafts[key]);notice='Your complete authored draft is retained against the current native revision. Review its selection before saving.';paint();}
  }
  async function beginStep(){
    if(!record()||historical())throw Error('Open the current saved rehearsal.');
    if(draftDirty())throw Error('Save the prepared changes before starting a step from that selection.');
    if(record().active_step)throw Error('Complete or defer the active teaching step first.');
    return perform('rehearsal.begin',{id:record().id,expected_revision:record().revision,step_id:view.step,note:stepDraft?.note||''});
  }
  function transferTasksSelected(){
    if(view.step!=='transfer')return false;
    const selected=rhList(stepDraft?.task_ids).map(id=>available('tasks').find(task=>task.id===id)).filter(Boolean);
    const backups=selected.filter(task=>task.action==='workspace.backup');
    const restores=selected.filter(task=>task.action==='workspace.restore');
    return backups.length===1&&restores.length===1&&backups[0].state==='complete'&&restores[0].state==='complete';
  }
  const canRecordObserved=()=>!!liveStep()?.ready||transferTasksSelected();
  async function recordStep(outcome){
    const rec=record();if(!rec||historical())throw Error('Open the current saved rehearsal.');
    if(rec.active_step?.step_id!==view.step)throw Error('Begin this step before recording its outcome.');
    if(outcome==='observed'&&!canRecordObserved())throw Error('The selected native evidence is not complete for this observation. Open its original controls or defer the step with its missing result.');
    if(outcome==='deferred'&&!String(stepDraft?.note||'').trim())throw Error('Describe why this step is deferred and what remains to be shown.');
    return perform('rehearsal.record',{id:rec.id,expected_revision:rec.revision,step_id:view.step,outcome,
      task_ids:rhCopy(stepDraft?.task_ids||[]),upload_ids:rhList(stepDraft?.uploads).map(x=>x.id),note:stepDraft?.note||''});
  }
  async function exportRecord(){
    if(!record())throw Error('Choose a saved rehearsal revision to export.');
    return perform('rehearsal.export',{id:record().id,revision:record().revision});
  }
  async function fileIdentity(file){
    if(!file||typeof file.arrayBuffer!=='function')throw Error('Choose the original screenshot or recording.');
    if(file.size>RH_MEDIA_LIMIT)throw Error('Each operator-selected screenshot or recording can be at most 256 MiB.');
    const limit=getState()?.limits?.upload_bytes;
    if(Number.isFinite(limit)&&file.size>limit)throw Error('This file exceeds the original operator’s configured upload capacity of '+rhBytes(limit)+'.');
    if(!RH_MEDIA_EXTENSIONS.test(file.name||''))throw Error('The native rehearsal supports PNG, JPG, JPEG, WEBP, WEBM, MP4, MKV and MOV files. Choose one of these original screenshot or recording formats before uploading.');
    if(!globalThis.crypto?.subtle)throw Error('This browser cannot verify the selected media bytes.');
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const sha256=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {filename:file.name,mime_type:file.type||'application/octet-stream',bytes:file.size,sha256,last_modified:file.lastModified};
  }
  async function uploadMedia(file){
    if(!record()||historical())throw Error('Choose the current saved rehearsal before adding media.');
    await flush();const ctx=context(),key=stepKey();if(taskBusy())throw Error('Reconcile the original request before adding media.');
    if(isCurrent(ctx)){busy=true;notice='Checking the original media bytes…';paint();}
    let descriptor;
    try{
      descriptor=await fileIdentity(file);
      const existing=stored?.uploadPending;
      if(existing&&(!rhSameMedia(existing.file,descriptor)||existing.stepKey!==key))throw Error('Reselect the identical original file for the retained upload, or keep its definitive rejection before choosing another.');
      const data=await write(ctx,value=>{
        if(value.pending)throw Error('An original action is still pending.');
        if(value.uploadPending){
          if(!rhSameMedia(value.uploadPending.file,descriptor)||value.uploadPending.stepKey!==key)throw Error('Another original media upload is retained.');
        }else value.uploadPending={file:descriptor,stepKey:key,record_id:view.id,step_id:view.step,created_at:rhNow(),attempts:[],last_error:null};
        value.uploadPending.attempts.push({started_at:rhNow()});value.uploadPending.phase='sending';
      });
      fileSelections.set(ctx.key+':'+key,file);
      if(isCurrent(ctx)){stored=data;notice='Retaining '+descriptor.filename+' in the original workspace…';paint();}
      const result=await api('/api/upload',{method:'POST',raw:file,filename:file.name});
      if(!result||!RH_ID.test(result.id||'')||result.sha256!==descriptor.sha256||result.bytes!==descriptor.bytes||result.filename!==descriptor.filename||result.mime_type!==descriptor.mime_type){
        throw Error('The returned media identity does not match the selected original bytes. The upload remains retained for reconciliation.');
      }
      const finished=await write(ctx,value=>{
        const original=value.uploadPending;
        if(!original||!rhSameMedia(original.file,descriptor)||original.stepKey!==key)throw Error('The returned media belongs to another retained selection.');
        const step=value.stepDrafts[key]||blankStepDraft();
        if(!step.uploads.some(x=>x.id===result.id))step.uploads.push(rhCopy(result));
        step.version++;step.updated_at=rhNow();value.stepDrafts[key]=step;
        value.uploadReceipts.push({...original,phase:'complete',result:rhCopy(result),received_at:rhNow()});value.uploadPending=null;
      });
      fileSelections.delete(ctx.key+':'+key);
      if(isCurrent(ctx)&&key===stepKey()){stepDraft=rhCopy(finished.stepDrafts[key]);notify('The exact original media file is retained for this step.');}
    }catch(cause){
      if(descriptor)await write(ctx,value=>{
        if(value.uploadPending&&rhSameMedia(value.uploadPending.file,descriptor)){
          value.uploadPending.phase='unresolved';value.uploadPending.last_error={message:cause.message||String(cause),status:cause.status??null,code:cause.code??null,observed_at:rhNow()};
        }
      }).catch(()=>{});
      if(isCurrent(ctx))error=cause.message||String(cause);
    }finally{if(isCurrent(ctx)){busy=false;paint();}}
  }
  async function keepUploadRejection(){
    const ctx=context(),original=rhCopy(uploadPending());
    if(!original||![400,413,415,422].includes(original.last_error?.status))throw Error('Reconcile this same-file upload before choosing another.');
    await write(ctx,value=>{
      if(!value.uploadPending||!rhSameMedia(value.uploadPending.file,original.file))throw Error('The retained upload changed.');
      value.uploadReceipts.push({...value.uploadPending,phase:'rejected',retained_at:rhNow()});value.uploadPending=null;
    });
    if(isCurrent(ctx)){notice='The rejected upload and its complete descriptor remain in history. Any original retained bytes have not been removed.';paint();}
  }

  function selectionLabel(kind,id){
    const row=findItem(kind,id);
    return row?rhTitle(row)+' · '+rhShort(id):'Retained ID · '+rhShort(id);
  }
  function itemButton(kind,id,label='Open original'){
    if(!RH_ID.test(id||''))return '';
    return rhButton(kind==='tasks'?'task':'item',label,'data-kind="'+rhEsc(kind)+'" data-id="'+rhEsc(id)+'"','small');
  }
  function selectField(key,label,kind,chosen,disabled){
    const rows=available(kind),id=chosen??'';
    let choices='<option value="">Unselected</option>'+rows.map(row=>'<option value="'+rhEsc(row.id)+'" '+(row.id===id?'selected':'')+'>'+rhEsc(rhTitle(row)+' · '+rhShort(row.id)+(row.state?' · '+row.state:''))+'</option>').join('');
    if(id&&!rows.some(x=>x.id===id))choices+='<option value="'+rhEsc(id)+'" selected>'+rhEsc('Retained selection · '+id)+'</option>';
    return '<div class="rh-select-row"><label class="rh-field"><span>'+rhEsc(label)+'</span><select name="selection.'+rhEsc(key)+'" '+(disabled?'disabled':'')+'>'+choices+'</select></label>'+itemButton(kind,id)+'</div>';
  }
  function selectionSummary(selection,compact=false){
    if(!selection)return rhEmpty('Choose an actual case','Select the source edition, parameters, grid and original outputs to explain.');
    const rows=RH_SELECTION.filter(([key])=>selection[key]).map(([key,label,kind])=>'<tr><th scope="row">'+rhEsc(label)+'</th><td><strong>'+rhEsc(selectionLabel(kind,selection[key]))+'</strong><code>'+rhEsc(selection[key])+'</code></td><td>'+itemButton(kind,selection[key])+'</td></tr>');
    for(const id of rhList(selection.alternative_run_ids))rows.push('<tr><th scope="row">Alternative run</th><td><strong>'+rhEsc(selectionLabel('runs',id))+'</strong><code>'+rhEsc(id)+'</code></td><td>'+itemButton('runs',id)+'</td></tr>');
    return rows.length?'<div class="'+(compact?'rh-compact ':'')+'rh-selection-summary">'+rhTable(['Selection','Original retained identity',''],rows)+'</div>':rhEmpty('No native inputs selected','Keep unselected inputs visible, or choose them in Prepare before the walkthrough.');
  }
  function renderPending(){
    const p=pending(),u=uploadPending();let html='';
    if(p){
      const task=p.last_task,coalesced=p.task_operation_id&&p.task_operation_id!==p.request.operation_id;
      html+='<aside class="rh-pending" role="status" aria-live="polite"><div><p class="rh-eyebrow">RETAINED ORIGINAL ACTION</p><h2>'+rhEsc(rhHuman(p.request.action))+'</h2>'+
        '<p>'+rhEsc(p.task_id?'The original task and its complete input remain selected. Read its current state or resume that same task when it is inactive.':'The complete request is saved before dispatch. Reconciliation uses this same request and operation identity.')+'</p>'+
        '<div class="rh-meta">'+rhBadge(p.phase)+(task?rhBadge(task.state):'')+'</div>'+
        '<code>'+rhEsc(p.request.operation_id)+'</code>'+
        (p.task_id?'<p class="rh-small">Native task <code>'+rhEsc(p.task_id)+'</code></p>':'')+
        (coalesced?'<p class="rh-small">The original queue joined identical inputs to task operation <code>'+rhEsc(p.task_operation_id)+'</code>. The submitted identity above is preserved separately.</p>':'')+
        (p.last_error?'<p class="rh-error-text">'+rhEsc(p.last_error.message)+(p.last_error.status?' · HTTP '+rhEsc(p.last_error.status):'')+'</p>':'')+
        '</div><div class="rh-actions">'+rhButton('reconcile',p.task_id?'Check original task':'Reconcile original request',busy?'disabled':'','primary')+
        (p.task_id?rhButton('task','Open original task','data-id="'+rhEsc(p.task_id)+'"'):'')+
        (p.task_id&&['failed','interrupted','cancelled'].includes(p.phase)?rhButton('resume','Resume this retained task',busy?'disabled':''):'')+
        (canKeepFailure(p)?rhButton('keep-failure','Keep outcome and return to draft',busy?'disabled':''):'')+
        rhButton('download-pending','Save exact request JSON')+'</div>'+
        (rhList(p.candidates).length>1?'<section class="rh-wide"><h3>Select the actual original task</h3><p>These tasks carry the same complete native input. The earlier completed tasks from the pre-send census are kept as history, not selected automatically.</p>'+rhTable(['Native task','State and operation',''],p.candidates.map(t=>'<tr><td><code>'+rhEsc(t.id)+'</code><small>'+rhEsc(rhWhen(t.created_at))+'</small></td><td>'+rhBadge(t.state)+'<code>'+rhEsc(t.operation_id)+'</code></td><td>'+rhButton('adopt-task','Use this actual task','data-id="'+rhEsc(t.id)+'" '+(busy?'disabled':''))+'</td></tr>'))+'</section>':'')+
        rhDetails('Complete frozen request and observed task',p)+'</aside>';
    }
    if(u){
      html+='<aside class="rh-pending"><div><p class="rh-eyebrow">RETAINED MEDIA UPLOAD</p><h2>'+rhEsc(u.file.filename)+'</h2><p>'+
        rhEsc(rhBytes(u.file.bytes))+' · '+rhEsc(u.file.mime_type)+'</p><code>'+rhEsc(u.file.sha256)+'</code><p>Reselect the identical original screenshot or recording in its teaching step to reconcile this upload.</p>'+
        (u.last_error?'<p class="rh-error-text">'+rhEsc(u.last_error.message)+'</p>':'')+'</div><div class="rh-actions">'+
        rhButton('upload-step','Open this teaching step','data-id="'+rhEsc(u.record_id)+'" data-step="'+rhEsc(u.step_id)+'"')+
        ([400,413,415,422].includes(u.last_error?.status)?rhButton('keep-upload-rejection','Keep rejection and choose another file',busy?'disabled':''):'')+'</div></aside>';
    }
    return html;
  }
  function renderInventory(){
    const list=rhList(overview?.records).filter(row=>!search||[row.title,row.operator,row.audience,row.id].join(' ').toLowerCase().includes(search.toLowerCase()));
    return '<section class="rh-panel"><div class="rh-panel-head"><div><h2>Saved walkthroughs</h2><p>Open a retained revision and the actual case it explains.</p></div>'+rhButton('new','Prepare another walkthrough',busy?'disabled':'','primary')+'</div>'+
      '<label class="rh-search"><span>Find a walkthrough</span><input type="search" name="inventory_search" value="'+rhEsc(search)+'" placeholder="Title, operator, audience or retained ID"></label>'+
      (list.length?rhTable(['Walkthrough','Operator and audience','Recorded work',''],list.map(row=>'<tr><td><strong>'+rhEsc(row.title)+'</strong><small>Revision '+rhEsc(row.revision)+' · '+rhEsc(rhWhen(row.updated_at))+'</small><code>'+rhEsc(row.id)+'</code></td><td>'+rhEsc(row.operator)+(row.audience?'<small>'+rhEsc(row.audience)+'</small>':'')+'</td><td>'+rhBadge(row.mode==='live'?'Live mode selected':'Recorded mode selected')+'<small>'+rhEsc(row.observed_steps)+' of '+rhEsc(row.total_steps)+' steps observed for this selection'+(row.active_step?' · active step retained':'')+'</small></td><td>'+rhButton('open','Open','data-id="'+rhEsc(row.id)+'"')+'</td></tr>')):
      rhEmpty('Prepare a walkthrough of the real work','Choose original source, model and delivery records. The operator’s instructions and evidence determine what can actually be demonstrated.'))+'</section>';
  }
  function renderRecordBar(){
    const rec=record();if(!rec)return '';
    const revisions=rhList(opened.history).slice().sort((a,b)=>b.revision-a.revision);
    if(!revisions.some(x=>x.revision===rec.revision))revisions.unshift({revision:rec.revision,record_sha256:rec.record_sha256});
    return '<section class="rh-record-bar"><div><p class="rh-eyebrow">Saved teaching record</p><h2>'+rhEsc(rec.title)+'</h2><p>'+rhEsc(rec.operator)+(rec.audience?' · '+rhEsc(rec.audience):'')+'</p><div class="rh-meta">'+
      rhBadge('Revision '+rec.revision,historical()?'warning':'')+rhBadge(historical()?'Historical selection':'Current saved revision')+
      rhBadge(rec.mode==='live'?'Live mode requested':'Recorded mode requested')+rhBadge(opened?.completion?opened.completion.observed_steps+' of '+opened.completion.total_steps+' steps observed for this selection':'Reading completion for this selection')+(rec.active_step?rhBadge('Active: '+rhHuman(rec.active_step.step_id),'warning'):'')+'</div><code>'+rhEsc(rec.id)+'</code></div>'+
      '<div class="rh-record-tools"><label class="rh-field"><span>Retained revision</span><select name="revision">'+revisions.map(row=>'<option value="'+row.revision+'" '+(row.revision===rec.revision?'selected':'')+'>Revision '+row.revision+(row.revision===currentRevision()?' · current':'')+'</option>').join('')+'</select></label>'+
      (historical()?rhButton('current','Open current revision'):'')+rhButton('export','Export this revision',taskBusy()?'disabled':'')+'</div></section>'+
      '<p class="rh-small">Step status uses the evidence selected in this revision. Earlier demonstrations remain available in the attempt history.</p>'+(historical()?'<p class="rh-notice">This is revision '+rhEsc(rec.revision)+'. The current native record is revision '+rhEsc(currentRevision())+'. Its saved selection and earlier evidence remain visible here; open the current revision to change the teaching record.</p>':'');
  }
  function renderPrepare(){
    if(!draft)return rhEmpty('Loading the retained draft','The original browser draft and case selection will appear here.');
    const rec=record(),fields=historical()?recordFields(rec):draft.fields,disabled=taskBusy()||historical()||!!rec?.active_step,stale=rec&&!historical()&&draft.base_revision!==currentRevision();
    const alternatives=rhList(fields.selection?.alternative_run_ids),runs=available('runs');
    const missing=alternatives.filter(id=>!runs.some(r=>r.id===id)).map(id=>({id,title:'Retained alternative run'}));
    return '<section class="rh-panel"><div class="rh-panel-head"><div><h2>Prepare the explanation</h2><p>Choose the actual study inputs and outputs. Notes stay in the browser draft until this complete selection is saved to the native record.</p></div>'+rhBadge(draftDirty()?'Authored draft':'Matches saved record')+'</div>'+
      (rec?.active_step?'<p class="rh-notice">The active step keeps its exact selection. Record or defer that step before revising the walkthrough.</p>':'')+
      (stale?'<aside class="rh-notice"><h3>The native record has advanced</h3><p>This complete draft was prepared against revision '+rhEsc(draft.base_revision)+'. Current revision '+rhEsc(currentRevision())+' is retained independently. Review both before adopting the current revision for these authored changes.</p>'+rhButton('adopt-revision','Use current revision for this complete draft',taskBusy()?'disabled':'')+rhDetails('Draft and current saved selection',{draft:draft.fields,current:rec?recordFields(rec):null})+'</aside>':'')+
      '<form class="rh-form" data-rh-form="prepare">'+
      rhField('title','Walkthrough title',fields.title,{required:true,wide:true,disabled})+
      rhField('operator','Person operating the case',fields.operator,{required:true,disabled})+
      rhField('audience','People being shown the work',fields.audience,{required:true,disabled})+
      '<fieldset class="rh-mode rh-wide" '+(disabled?'disabled':'')+'><legend>How will you demonstrate the calculation?</legend>'+
      '<label><input type="radio" name="mode" value="recorded" '+(fields.mode==='recorded'?'checked':'')+'><span><strong>Explain recorded work</strong><small>Open the original completed run, maps and timing records.</small></span></label>'+
      '<label><input type="radio" name="mode" value="live" '+(fields.mode==='live'?'checked':'')+'><span><strong>Demonstrate a new calculation</strong><small>Begin the teaching step, then use the original native run controls. Only a newly started model stage can support a live calculation attempt.</small></span></label></fieldset>'+
      '<div class="rh-wide rh-form-heading"><h3>Original scientific selection</h3><p>Keep absent items unselected. Run and comparison IDs retain their actual source editions, model periods and physical units.</p></div>'+
      RH_SELECTION.map(([key,label,kind])=>selectField(key,label,kind,fields.selection?.[key],disabled)).join('')+
      '<fieldset class="rh-wide rh-choice-list" '+(disabled?'disabled':'')+'><legend>Alternative runs</legend><p>Select every original alternative needed for this explanation. There is no fixed scenario-count limit in this teaching selection.</p>'+
      (runs.concat(missing).length?runs.concat(missing).map(row=>'<div class="rh-choice-row"><label><input type="checkbox" name="alternative_run_ids" value="'+rhEsc(row.id)+'" '+(alternatives.includes(row.id)?'checked':'')+'><span><strong>'+rhEsc(rhTitle(row))+'</strong><small>'+rhEsc(row.state||'Retained selection')+' · <code>'+rhEsc(row.id)+'</code></small></span></label>'+itemButton('runs',row.id)+'</div>').join(''):'<p>No original alternative runs are retained yet. Use the model’s native run controls to prepare them when needed.</p>')+'</fieldset>'+
      rhField('notes','Teaching notes',fields.notes,{area:true,rows:5,wide:true,disabled,note:'What should the audience understand or repeat? These notes belong to this saved walkthrough.'})+
      rhField('science_notes','Scientific interpretation and units',fields.science_notes,{area:true,rows:5,wide:true,disabled,note:'Explain the original source vintage, physical units, model period, assumptions and limitations. Keep modeled results distinct from field observations.'})+
      '<div class="rh-wide rh-actions"><button type="submit" class="rh-button primary" '+(disabled||stale||storageError?'disabled':'')+'>'+rhEsc(rec?'Save complete revised walkthrough':'Save walkthrough')+'</button>'+
      rhButton('download-draft','Save current draft JSON')+'</div></form></section>';
  }
  function renderControl(control,index){
    const disabled=busy?'disabled':'';
    if(control?.type==='view'&&typeof control.view==='string')return rhButton('control',control.label||'Open original view','data-control="'+index+'" '+disabled);
    if(control?.type==='item'&&typeof control.kind==='string'&&RH_ID.test(control.id||''))return rhButton('control',control.label||'Open original record','data-control="'+index+'" '+disabled);
    if(control?.type==='action'&&RH_ACTIONS.has(control.action))return rhButton('control',control.label||rhHuman(control.action),'data-control="'+index+'" '+disabled,'primary');
    return '<span class="rh-small">This native control is not available in this browser component: '+rhEsc(control?.label||control?.action||control?.type||'unspecified')+'</span>';
  }
  function evidenceFields(value){
    if(!value||typeof value!=='object')return rhTextBlock(value??'No evidence recorded.');
    return '<dl class="rh-evidence-fields">'+Object.entries(value).map(([key,item])=>'<div><dt>'+rhEsc(rhHuman(key))+'</dt><dd>'+
      (item===null?'<span class="rh-missing">Not supplied</span>':typeof item==='object'?rhDetails('Read complete '+rhHuman(key),item):rhEsc(String(item)))+'</dd></div>').join('')+'</dl>';
  }
  function renderAttempts(step){
    const attempts=rhList(step?.attempts),completion=completionStep(step);
    return attempts.length?'<div class="rh-attempts">'+attempts.map((a,i)=>{
      const matches=completion?completion.attempt_matches[i]:null;
      const latest=matches&&completion.current_attempt_index===i;
      const label=matches===false?'Historical · earlier selection':matches===null?'Selection match not yet read':latest?'Latest attempt for this selection':'Earlier attempt for this selection';
      return '<article class="rh-attempt '+(matches===false?'historical':latest?'current':'')+'"><div class="rh-panel-head"><h4>Attempt '+(i+1)+'</h4><div class="rh-meta">'+
        rhBadge(label,matches===false?'muted':'')+rhBadge('Recorded outcome: '+rhHuman(a.outcome||'retained'))+rhBadge(a.mode==='live'?'New model stage observed':a.mode==='deferred'?'Deferred':'Recorded work')+'</div></div>'+
        (matches===false?'<p>This earlier attempt is retained for history. Its selected evidence does not establish completion for this revision.</p>':'')+
        '<p>'+rhEsc(rhWhen(a.started_at))+' → '+rhEsc(rhWhen(a.ended_at))+'</p><p class="rh-timing">'+rhEsc(rhElapsed(a.elapsed_seconds))+'</p>'+
        (a.note?rhTextBlock(a.note):'')+
        (rhList(a.task_evidence).length?'<div class="rh-actions">'+rhList(a.task_evidence).map(t=>itemButton('tasks',typeof t==='string'?t:t.id||t.task_id,'Open original task')).join('')+'</div>':'')+
        rhDetails('Complete attempt, selection, timing and file evidence',a)+'</article>';
    }).join('')+'</div>':rhEmpty('No teaching attempt recorded','Start this step, use its original controls, then record what the native evidence actually supports.');
  }
  function stepStatus(step){
    if(record()?.active_step?.step_id===step.id)return [historical()?'Active at this revision':'Active','warning'];
    const completion=completionStep(step);
    if(!completion)return ['Reading selection status','muted'];
    if(completion.state==='observed')return ['Observed for this selection','good'];
    if(completion.state==='deferred')return ['Deferred for this selection','warning'];
    return [step.ready?'Evidence ready · unrecorded':'Unrecorded for this selection',step.ready?'':'muted'];
  }
  function renderStepDraft(){
    const rec=record(),active=rec?.active_step?.step_id===view.step,readonly=historical()||taskBusy(),tasks=available('tasks');
    const selected=rhList(stepDraft?.task_ids),all=tasks.concat(selected.filter(id=>!tasks.some(t=>t.id===id)).map(id=>({id,action:'Retained original task',state:'unknown'})));
    return '<section class="rh-panel rh-step-record"><h3>Record what you demonstrated</h3>'+
      '<p>Choose the original tasks and optional screenshots or recordings used for this explanation. The native record determines whether the step can be observed and which timing is supported.</p>'+
      (view.step==='transfer'?'<div class="rh-notice"><strong>Verify this working copy.</strong> Begin the transfer step, create an original Workspace backup, restore that exact backup through the original operator, then select its completed backup and restore tasks below. Recording checks the same project, exact backup bytes, and the active rehearsal revision carried into the receiving workspace. Older backups do not establish this transfer.</div>':'')+
      '<form data-rh-form="step" class="rh-form">'+
      rhField('step_note','What did you show, and what does it mean?',stepDraft?.note||'',{area:true,rows:5,wide:true,disabled:readonly,note:'For a deferred step, describe the missing result and the next action.'})+
      '<fieldset class="rh-wide rh-choice-list rh-task-choices" '+(readonly?'disabled':'')+'><legend>Original task evidence</legend>'+
      (all.length?all.map(task=>'<div class="rh-choice-row"><label><input type="checkbox" name="task_ids" value="'+rhEsc(task.id)+'" '+(selected.includes(task.id)?'checked':'')+'><span><strong>'+rhEsc(rhTitle(task))+'</strong><small>'+rhEsc(task.state||'Retained')+' · '+rhEsc(rhWhen(task.started_at||task.created_at))+'</small><code>'+rhEsc(task.id)+'</code></span></label>'+itemButton('tasks',task.id,'Inspect task')+'</div>').join(''):'<p>No native task is selected in this workspace yet.</p>')+'</fieldset>'+
      '<div class="rh-wide rh-media"><h4>Optional original screenshot or recording</h4><p>Supported formats: PNG, JPG, JPEG, WEBP, WEBM, MP4, MKV and MOV. Each file may be up to 256 MiB, within this operator’s upload capacity. The complete bytes are retained in the workspace.</p>'+
      '<label class="rh-field"><span>Select original media</span><input type="file" name="media_file" accept=".png,.jpg,.jpeg,.webp,.webm,.mp4,.mkv,.mov" '+(readonly?'disabled':'')+'></label>'+
      rhButton('upload-media',uploadPending()?'Reconcile selected original media':'Retain selected media',readonly?'disabled':'')+
      (fileSelections.get(scope.key+':'+stepKey())?'<p class="rh-small">Selected in this browser: '+rhEsc(fileSelections.get(scope.key+':'+stepKey()).name)+'. The original bytes are saved only after Retain selected media succeeds.</p>':'')+
      (rhList(stepDraft?.uploads).length?'<ul class="rh-media-list">'+stepDraft.uploads.map(file=>'<li><div><strong>'+rhEsc(file.filename)+'</strong><small>'+rhEsc(rhBytes(file.bytes))+' · '+rhEsc(file.mime_type)+'</small><code>'+rhEsc(file.sha256)+'</code></div>'+
      rhButton('unselect-media','Remove from this step selection','data-id="'+rhEsc(file.id)+'" '+(readonly?'disabled':''),'small')+'</li>').join('')+'</ul>':'')+'</div>'+
      '<div class="rh-wide rh-actions">'+
      (!active?rhButton('begin','Begin this teaching step',readonly||rec?.active_step||draftDirty()?'disabled':'','primary'):
        rhButton('record-observed','Record observed step',readonly||!canRecordObserved()?'disabled':'','primary')+
        rhButton('record-deferred','Defer with missing evidence',readonly?'disabled':''))+
      rhButton('download-step-draft','Save step notes JSON')+'</div></form>'+
      (!active&&rec?.active_step?'<p class="rh-notice">The active step is '+rhEsc(rhHuman(rec.active_step.step_id))+'. Return to it to record or defer the attempt.</p>':'')+
      (draftDirty()?'<p class="rh-notice">Prepared changes have not been saved to this native selection. Save the complete preparation before beginning another teaching step.</p>':'')+'</section>';
  }
  function renderWalkthrough(){
    const rec=record();if(!rec)return rhEmpty('Save the actual selection first','Prepare a walkthrough so its original source and run IDs are retained before you start teaching.');
    const step=selectedStep(),live=liveStep(),status=stepStatus(step),controls=rhList(step?.controls);
    return '<div class="rh-walkthrough"><nav class="rh-step-nav" aria-label="Teaching steps">'+rec.steps.map((s,i)=>{const state=stepStatus(s);return '<button type="button" data-rh="step" data-step="'+rhEsc(s.id)+'" aria-current="'+(s.id===view.step?'step':'false')+'" class="'+(s.id===view.step?'selected':'')+'"><span class="rh-step-number">'+(i+1)+'</span><span><strong>'+rhEsc(s.title)+'</strong><small>'+rhEsc(state[0])+'</small></span></button>';}).join('')+'</nav>'+
      '<div class="rh-step-main"><section class="rh-panel"><div class="rh-panel-head"><div><p class="rh-eyebrow">STEP '+(RH_STEPS.indexOf(view.step)+1)+' OF '+RH_STEPS.length+'</p><h2>'+rhEsc(step.title)+'</h2></div>'+rhBadge(status[0],status[1])+'</div>'+
      '<div class="rh-instruction-grid">'+[['Do this',step.do],['Expect to see',step.expect],['What it means',step.meaning],['Explain it aloud',step.say]].map(([label,value])=>'<section class="rh-instruction"><h3>'+rhEsc(label)+'</h3>'+rhTextBlock(value)+'</section>').join('')+'</div>'+
      '<div class="rh-native-controls"><h3>Open the actual work</h3><div class="rh-actions">'+controls.map(renderControl).join('')+'</div><p>These controls open the original operator. Starting a model calculation remains an explicit action in its native form.</p></div>'+
      (rec.active_step?.step_id===view.step?'<div class="rh-notice"><strong>This step is active.</strong> It began '+rhEsc(rhWhen(rec.active_step.started_at))+'. Timing will be taken from the retained attempt and native tasks. '+(rec.mode==='live'?'Reopening old output or completing old packaging remains recorded work.':'This walkthrough explains existing recorded work.')+'</div>':'')+
      (!live?.ready?'<section class="rh-missing-box"><h3>Original evidence still needed</h3>'+rhTextBlock(live?.missing||step.missing||[])+'</section>':'<p class="rh-ready">The current original selection supplies the evidence for this step. The recorded outcome still requires your explicit action.</p>')+
      '<details class="rh-details"><summary>Read the exact current evidence and physical units</summary>'+evidenceFields(live?.evidence||step.evidence)+'</details>'+
      (!rhEqual(live?.evidence,step.evidence)?rhDetails('Evidence retained in this saved revision',step.evidence):'')+'</section>'+
      renderStepDraft()+
      '<section class="rh-panel"><div class="rh-panel-head"><h3>Retained attempts</h3>'+rhBadge(String(rhList(step.attempts).length))+'</div>'+renderAttempts(step)+'</section></div></div>';
  }
  function renderEvidence(){
    const rec=record();if(!rec)return rhEmpty('No saved evidence selection','Prepare and save the actual case before collecting teaching evidence.');
    const downloads=rhList(opened?._downloads);
    return '<section class="rh-panel"><div class="rh-panel-head"><div><h2>Original case and physical interpretation</h2><p>Every teaching attempt keeps its selected source and native results. Values below retain their original labels, units and missing entries.</p></div></div>'+
      selectionSummary(rec.selection)+(rec.science_notes?'<section class="rh-science-note"><h3>Operator’s scientific interpretation</h3>'+rhTextBlock(rec.science_notes)+'</section>':'')+
      '<p class="rh-small">Modeled nutrient and sediment outputs, their source vintages and their stated periods belong to the selected native records. This walkthrough does not change their units or establish an independent field measurement.</p></section>'+
      '<section class="rh-panel"><h2>Evidence by teaching step</h2>'+rec.steps.map(step=>'<details class="rh-evidence-step"><summary><span>'+rhEsc(step.title)+'</span>'+rhBadge(stepStatus(step)[0])+'</summary>'+evidenceFields(step.evidence)+
        (rhList(step.missing).length?'<div class="rh-missing-box">'+rhTextBlock(step.missing)+'</div>':'')+renderAttempts(step)+'</details>').join('')+'</section>'+
      '<section class="rh-panel"><h2>Retained original media</h2><p>These authenticated file tickets belong to media already joined to this exact record. Selecting media in the browser draft does not by itself add it to a saved attempt.</p>'+
      (downloads.length?fileList(downloads):rhEmpty('No media in this revision','Screenshots and recordings are optional. The native task and selection evidence remain available without them.'))+'</section>';
  }
  function renderHistory(){
    const rec=record(),history=rhList(opened?.history).slice().sort((a,b)=>b.revision-a.revision);
    const receipts=rhList(stored?.receipts);
    return '<section class="rh-panel"><h2>Native revision history</h2><p>Open an earlier saved selection without replacing the current record or its later attempts.</p>'+
      (history.length?rhTable(['Revision','Saved event','Time and identity',''],history.map(h=>'<tr><td>'+rhEsc(h.revision)+(h.revision===currentRevision()?'<small>Current</small>':'')+'</td><td>'+rhEsc(typeof h.event==='string'?rhHuman(h.event):rhText(h.event))+'</td><td>'+rhEsc(rhWhen(h.updated_at))+'<code>'+rhEsc(h.record_sha256)+'</code></td><td>'+rhButton('revision','Open revision','data-revision="'+h.revision+'"')+'</td></tr>')):
      rhEmpty('No saved revision selected','Open a retained walkthrough to read its native history.'))+'</section>'+
      '<section class="rh-panel"><h2>Original action receipts</h2><p>Submitted requests, actual task identities and definitive failures remain here. A failed task can be reopened with its same original input.</p>'+
      (receipts.length?receipts.map((receipt,index)=>{
        const task=taskCache.get(scope.key+':'+receipt.task_id)||receipt.task||receipt.last_task;
        return '<article class="rh-receipt"><div class="rh-panel-head"><h3>'+rhEsc(rhHuman(receipt.request.action))+'</h3>'+rhBadge(task?.state||receipt.phase)+'</div>'+
          '<p>'+rhEsc(rhWhen(receipt.received_at||receipt.retained_without_replay_at||receipt.created_at))+'</p><code>'+rhEsc(receipt.request.operation_id)+'</code>'+
          (receipt.task_id?'<p class="rh-small">Native task <code>'+rhEsc(receipt.task_id)+'</code></p>':'')+
          (receipt.last_error?'<p class="rh-error-text">'+rhEsc(receipt.last_error.message)+'</p>':'')+
          '<div class="rh-actions">'+(receipt.task_id?rhButton('task','Open original task','data-id="'+rhEsc(receipt.task_id)+'"')+rhButton('refresh-receipt','Read current task and file tickets','data-index="'+index+'" '+(busy?'disabled':'')):'')+
          rhButton('download-receipt','Save full retained receipt','data-index="'+index+'"')+'</div>'+
          (task?.state==='complete'&&task?.action==='rehearsal.export'&&taskCache.has(scope.key+':'+task.id)?fileList(task._downloads||[]):'')+
          rhDetails('Complete frozen input and observed outcome',receipt)+'</article>';
      }).reverse().join(''):rhEmpty('No browser action receipt yet','The complete native request will be retained here before its first dispatch.'))+'</section>'+
      (rhList(stored?.uploadReceipts).length?'<section class="rh-panel"><h2>Original media upload history</h2>'+stored.uploadReceipts.map(u=>'<article class="rh-receipt"><h3>'+rhEsc(u.file.filename)+'</h3>'+rhBadge(u.phase)+'<p>'+rhEsc(rhBytes(u.file.bytes))+'</p><code>'+rhEsc(u.file.sha256)+'</code>'+rhDetails('Complete upload identity and outcome',u)+'</article>').join('')+'</section>':'')+
      (rhList(stored?.conflicts).length?'<section class="rh-panel"><h2>Preserved earlier drafts</h2><p>These complete authored drafts were retained when a current revision or another browser draft was explicitly adopted.</p>'+stored.conflicts.map((item,i)=>rhDetails('Retained draft '+(i+1)+' · '+rhWhen(item.saved_at),item)).join('')+'</section>':'')+
      (rec?rhDetails('Complete immutable native record',rec):'');
  }
  function renderExport(){
    const rec=record(),receipts=rhList(stored?.receipts).map((receipt,index)=>({receipt,index})).filter(x=>x.receipt.request.action==='rehearsal.export'&&(!rec||x.receipt.request.payload.id===rec.id));
    return '<section class="rh-panel rh-handover"><p class="rh-eyebrow">Operator handover</p><h2>Carry the actual walkthrough to the next operator</h2>'+
      '<p>The native export keeps the selected case, teaching guidance, notes, attempt evidence and original timings for the chosen revision. Use the existing scientific Workspace backup and restore controls for the complete model workspace.</p>'+
      (rec?'<div class="rh-handover-summary"><h3>'+rhEsc(rec.title)+'</h3><p>Revision '+rhEsc(rec.revision)+' · '+rhEsc(rec.operator)+'</p><code>'+rhEsc(rec.record_sha256)+'</code></div>':'')+
      '<div class="rh-actions">'+rhButton('export','Build native handover export',!rec||taskBusy()?'disabled':'','primary')+
      rhButton('native-backup','Open Workspace backup')+rhButton('native-restore','Open Workspace restore')+'</div>'+
      '<ol class="rh-handover-steps"><li><strong>Prepare the real case.</strong> Save the exact source, grid, parameter, run and delivery selection in this walkthrough.</li><li><strong>Explain the work.</strong> Open the original controls, read the physical units, and record each actual observation or missing result.</li><li><strong>Reopen what was handed over.</strong> Begin the transfer teaching step, then use the original Workspace backup and restore controls. Select those two completed tasks and record the transfer. The native record verifies that the restored workspace contains the exact active rehearsal revision and retains the matched task identities.</li></ol></section>'+
      '<section class="rh-panel"><h2>Original handover exports</h2>'+
      (receipts.length?receipts.map(({receipt,index})=>{
        const task=taskCache.get(scope.key+':'+receipt.task_id),state=task?.state||receipt.task?.state||receipt.phase;
        return '<article class="rh-receipt"><div class="rh-panel-head"><h3>Revision '+rhEsc(receipt.request.payload.revision)+'</h3>'+rhBadge(state)+'</div><code>'+rhEsc(receipt.task_id||receipt.request.operation_id)+'</code><p>'+rhEsc(rhWhen(receipt.received_at||receipt.created_at))+'</p>'+
          '<div class="rh-actions">'+(receipt.task_id?rhButton('refresh-receipt','Open current authenticated downloads','data-index="'+index+'" '+(busy?'disabled':'')):'')+rhButton('download-receipt','Save original export receipt','data-index="'+index+'"')+'</div>'+
          (task?.state==='complete'?fileList(task._downloads||[]):'')+'</article>';
      }).reverse().join(''):rhEmpty('No handover export yet','Build the original export for this saved revision. The task remains recoverable if the connection is interrupted.'))+'</section>';
  }
  function render(){
    if(scope&&scope.workspace!==currentWorkspace())return '<div class="rh-workspace"><p class="rh-loading" role="status">Reading the selected original workspace…</p></div>';
    const rec=record(),all=rhList(overview?.records);
    return '<div class="rh-workspace" data-rehearsal-root><header class="rh-header"><div><p class="rh-eyebrow">Upper Savannah · Actual case walkthrough</p><h1>Operator rehearsal</h1><p>Use the real study, explain its science, and leave a walkthrough that another operator can repeat.</p></div><div class="rh-actions">'+rhButton('refresh','Refresh original state',loading?'disabled':'')+rhButton('inventory','Saved walkthroughs')+'</div></header>'+
      '<div class="rh-project-line"><strong>'+rhEsc(overview?.project?.title||getState()?.data?.project?.title||'Selected scientific workspace')+'</strong><code>'+rhEsc(scope?.workspace||currentWorkspace()||'No workspace selected')+'</code></div>'+
      (error?'<div class="rh-alert" role="alert"><h2>The original action needs attention</h2><p>'+rhEsc(error)+'</p>'+rhButton('dismiss-error','Close message')+'</div>':'')+
      (storageError?'<div class="rh-alert" role="alert"><h2>The draft has not been durably saved</h2><p>'+rhEsc(storageError)+'</p><div class="rh-actions">'+rhButton('download-draft','Save the visible draft JSON')+rhButton('reload-draft','Keep local draft and load stored draft')+'</div></div>':'')+
      (notice?'<div class="rh-notice" role="status">'+rhEsc(notice)+'</div>':'')+
      renderPending()+
      (loading&&!overview?'<p class="rh-loading" role="status">Reading the original workspace and retained teaching records…</p>':'')+
      (view.tab==='inventory'?renderInventory():renderRecordBar()+
        '<nav class="rh-tabs" aria-label="Walkthrough sections">'+RH_TABS.map(([id,label])=>'<button type="button" data-rh="tab" data-tab="'+id+'" class="'+(view.tab===id?'selected':'')+'" aria-current="'+(view.tab===id?'page':'false')+'">'+label+'</button>').join('')+'</nav>'+
        (view.tab==='walkthrough'?renderWalkthrough():view.tab==='evidence'?renderEvidence():view.tab==='history'?renderHistory():view.tab==='export'?renderExport():renderPrepare()))+
      '<footer class="rh-footer"><span>'+all.length+' saved walkthrough'+(all.length===1?'':'s')+'</span><span>Teaching observations preserve evidence; they do not approve a model, study or publication.</span></footer></div>';
  }

  function rememberView(ctx=context()){
    const selection=rhCopy(view);if(!ctx)return Promise.resolve();
    return enqueue(ctx,value=>{value.selection=selection;});
  }
  async function synchronizeScope(){
    const workspace=currentWorkspace();
    if(!workspace)throw Error('Choose an original scientific workspace.');
    if(scope?.workspace===workspace&&stored)return context();
    epoch++;recordGeneration++;scope={workspace,key:location.origin+'|'+workspace};
    // Preserve only a latest intent already issued for the newly selected workspace.
    if(recordIntent?.workspace!==workspace)recordIntent={generation:recordGeneration,workspace};
    overview=null;opened=null;stored=null;draft=null;stepDraft=null;busy=false;error='';storageError='';notice='';
    view={id:null,revision:null,tab:'inventory',step:'study'};fileSelections.clear();
    const ctx=context();
    try{
      const value=await rhTransaction(ctx.key,ctx.workspace);
      if(isCurrent(ctx)){
        stored=value;
        if(value.selection&&(!value.selection.id||RH_ID.test(value.selection.id))){
          view={...view,...value.selection};
          if(!RH_STEPS.includes(view.step))view.step='study';
          if(!RH_TABS.some(x=>x[0]===view.tab)&&view.tab!=='inventory')view.tab='inventory';
        }
      }
    }catch(cause){
      if(isCurrent(ctx)){stored=rhEnvelope(workspace);storageError=cause.message||String(cause);}
    }
    return ctx;
  }
  async function readRecord(ctx,id,revision=null){
    const result=await api(scopedPath('/api/rehearsals/record',{id,...(revision?{revision}:{})},ctx));
    validateRecord(result.record,id);
    validateCompletion(result.completion,result.record);
    if(!Number.isSafeInteger(result.current_revision)||result.current_revision<result.record.revision||!Array.isArray(result.history)||!result.live)throw Error('The original revision and current-state response is incomplete.');
    return result;
  }
  async function selectRecord(id,revision=null,tab=null,intent=newRecordIntent()){
    if(!RH_ID.test(id||''))throw Error('Select an original rehearsal ID.');
    await flush();if(recordIntent!==intent||currentWorkspace()!==intent.workspace)return;
    const ctx=await synchronizeScope();if(!ownsRecordIntent(intent,ctx))return;
    loading=true;error='';paint();
    try{
      const result=await readRecord(ctx,id,revision);
      if(!ownsRecordIntent(intent,ctx))return;
      opened=result;view={...view,id,revision:result.record.revision,tab:tab||'walkthrough'};
      if(result.record.active_step)view.step=result.record.active_step.step_id;
      await rememberView(ctx);
      if(!ownsRecordIntent(intent,ctx))return;
      await ensureDraft(ctx,intent);
      if(ownsRecordIntent(intent,ctx))paint();
    }catch(cause){if(ownsRecordIntent(intent,ctx))throw cause;}
    finally{if(ownsRecordIntent(intent,ctx)){loading=false;paint();schedulePoll();}}
  }
  async function createDraft(){
    const intent=newRecordIntent();
    await flush();if(recordIntent!==intent||currentWorkspace()!==intent.workspace)return;
    const ctx=await synchronizeScope();if(!ownsRecordIntent(intent,ctx))return;
    opened=null;loading=false;view={id:null,revision:null,tab:'prepare',step:'study'};
    await rememberView(ctx);
    if(!ownsRecordIntent(intent,ctx))return;
    await ensureDraft(ctx,intent);
    if(ownsRecordIntent(intent,ctx))paint();
  }
  async function selectStep(id){
    if(!RH_STEPS.includes(id))throw Error('Choose an original teaching step.');
    await flush();view.step=id;view.tab='walkthrough';await rememberView();await ensureDraft();paint();
  }
  function schedulePoll(delay=null){
    clearTimeout(poll);poll=null;
    if(detached||!root?.isConnected)return;
    const p=pending();
    if(delay===null){
      if(p?.task_id&&['queued','running','sending','resuming','complete-response'].includes(p.phase))delay=2500;
      else if(record()?.active_step)delay=5000;
      else return;
    }
    poll=setTimeout(()=>{
      poll=null;if(detached||!root?.isConnected)return;
      if(document.visibilityState==='hidden'){schedulePoll(12000);return;}
      refresh().catch(setError);
    },delay);
  }
  async function refresh({force=false}={}){
    if(detached&&!force)return overview;
    if(refreshPromise){refreshAgain=true;return refreshPromise;}
    refreshPromise=(async()=>{
      const ctx=await synchronizeScope();if(!isCurrent(ctx))return;
      loading=true;paint();
      try{
        const result=await api(scopedPath('/api/rehearsals/overview',{},ctx));
        if(!result||!Array.isArray(result.records)||!result.available)throw Error('The original rehearsal overview is incomplete.');
        if(!isCurrent(ctx))return;
        overview=result;
        if(view.id){
          const selectedId=view.id,selectedRevision=view.revision,selectedIntent=recordIntent;
          const detail=await readRecord(ctx,selectedId,selectedRevision);
          if(isCurrent(ctx)&&recordIntent===selectedIntent&&view.id===selectedId&&view.revision===selectedRevision)opened=detail;
        }
        const data=await rhTransaction(ctx.key,ctx.workspace);
        if(!isCurrent(ctx))return;
        if(!stored||(data.serial||0)>=(stored.serial||0))stored=data;
        if(!draft||!stepDraft)await ensureDraft(ctx);
        const retained=stored?.pending;
        if(retained?.task_id&&!busy){
          const task=await api(scopedPath('/api/task',{id:retained.task_id},ctx));
          await receiveTask(ctx,retained.request.operation_id,task);
        }else if(retained&&!retained.task_id){
          const matching=available('tasks').find(task=>task.operation_id===retained.request.operation_id);
          if(matching?.id){
            const task=await api(scopedPath('/api/task',{id:matching.id},ctx));
            await receiveTask(ctx,retained.request.operation_id,task);
          }
        }
      }catch(cause){if(isCurrent(ctx)){error=cause.message||String(cause);}}
      finally{if(isCurrent(ctx)){loading=false;paint();schedulePoll();}}
      return overview;
    })();
    try{return await refreshPromise;}
    finally{
      refreshPromise=null;
      if(refreshAgain){refreshAgain=false;if(!detached)schedulePoll(300);}
    }
  }
  function paint(){
    if(!root||detached||!root.isConnected)return;
    const active=root.contains(document.activeElement)?document.activeElement:null;
    const focus=active?{name:active.getAttribute('name'),action:active.dataset.rh,step:active.dataset.step,start:active.selectionStart,end:active.selectionEnd}:null;
    const scroll=root.scrollTop,taskScroll=root.querySelector('.rh-task-choices')?.scrollTop;
    const openedDetails=[...root.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent);
    root.innerHTML=render();
    for(const detail of root.querySelectorAll('details'))if(openedDetails.includes(detail.querySelector('summary')?.textContent))detail.open=true;
    root.scrollTop=scroll;
    const taskList=root.querySelector('.rh-task-choices');if(taskList&&taskScroll!==undefined)taskList.scrollTop=taskScroll;
    if(focus){
      const element=focus.name?[...root.querySelectorAll('[name]')].find(el=>el.name===focus.name):
        [...root.querySelectorAll('[data-rh]')].find(el=>el.dataset.rh===focus.action&&(!focus.step||el.dataset.step===focus.step));
      if(element&&!element.disabled){
        element.focus({preventScroll:true});
        if(focus.start!==null&&focus.start!==undefined&&typeof element.setSelectionRange==='function'){
          try{element.setSelectionRange(focus.start,focus.end);}catch{}
        }
      }
    }
  }
  function downloadJSON(value,name){
    const blob=new Blob([rhJSON(value)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function dispatchControl(index){
    const control=rhList(selectedStep()?.controls)[index];
    if(!control)throw Error('The original control is no longer selected. Refresh the native record.');
    if(control.type==='view'&&typeof control.view==='string')return navigate(control.view);
    if(control.type==='item'&&typeof control.kind==='string'&&RH_ID.test(control.id||''))return control.kind==='tasks'?showTask(control.id):openItem(control.kind,control.id);
    if(control.type==='action'&&RH_ACTIONS.has(control.action)){
      for(const key of ['id','collection'])if(control[key]!==undefined&&control[key]!==null&&!RH_ID.test(control[key]))throw Error('The original control has an invalid retained identity.');
      if(typeof openControl!=='function')throw Error('The existing operator control bridge is unavailable.');
      return openControl(rhCopy(control));
    }
    throw Error('This control is not an original permitted operator action.');
  }
  async function onClick(event){
    const button=event.target.closest('[data-rh]');
    if(!button||!root?.contains(button)||button.disabled)return;
    event.preventDefault();event.stopPropagation();
    const action=button.dataset.rh;
    try{
      if(action==='refresh'){await flush();await refresh({force:true});return;}
      if(action==='dismiss-error'){error='';paint();return;}
      if(action==='inventory'){await flush();view.tab='inventory';await rememberView();paint();return;}
      if(action==='new')return await createDraft();
      if(action==='open')return await selectRecord(button.dataset.id);
      if(action==='current')return await selectRecord(view.id,null,view.tab==='inventory'?'walkthrough':view.tab);
      if(action==='revision')return await selectRecord(view.id,Number(button.dataset.revision),view.tab);
      if(action==='tab'){await flush();view.tab=button.dataset.tab;await rememberView();paint();return;}
      if(action==='step')return await selectStep(button.dataset.step);
      if(action==='item')return await openItem(button.dataset.kind,button.dataset.id);
      if(action==='task')return await showTask(button.dataset.id);
      if(action==='control')return await dispatchControl(Number(button.dataset.control));
      if(action==='native-backup'||action==='native-restore'){
        if(typeof openControl!=='function')throw Error('The original workspace control bridge is unavailable.');
        return await openControl({type:'action',action:action==='native-backup'?'backup':'restore',label:action==='native-backup'?'Workspace backup':'Workspace restore'});
      }
      if(action==='begin')return await beginStep();
      if(action==='record-observed')return await recordStep('observed');
      if(action==='record-deferred')return await recordStep('deferred');
      if(action==='export')return await exportRecord();
      if(action==='reconcile')return await reconcile();
      if(action==='adopt-task')return await adoptActualTask(button.dataset.id);
      if(action==='resume')return await resumeTask();
      if(action==='keep-failure')return await keepFailure();
      if(action==='adopt-revision')return await adoptRevision();
      if(action==='reload-draft')return await retainAndReloadDraft();
      if(action==='refresh-receipt')return await reopenReceipt(Number(button.dataset.index));
      if(action==='upload-step'){
        await selectRecord(button.dataset.id,null,'walkthrough');return await selectStep(button.dataset.step);
      }
      if(action==='upload-media'){
        const key=scope.key+':'+stepKey(),file=root.querySelector('[name="media_file"]')?.files?.[0]||fileSelections.get(key);
        return await uploadMedia(file);
      }
      if(action==='keep-upload-rejection')return await keepUploadRejection();
      if(action==='unselect-media'){updateStep('uploads',rhList(stepDraft?.uploads).filter(file=>file.id!==button.dataset.id));await flush();paint();return;}
      if(action==='download-draft')return downloadJSON({schema:RH_SCHEMA,workspace:currentWorkspace(),view,draft,stepDraft},'upper-savannah-rehearsal-draft.json');
      if(action==='download-step-draft')return downloadJSON({workspace:currentWorkspace(),record_id:view.id,step_id:view.step,stepDraft},'upper-savannah-rehearsal-step-notes.json');
      if(action==='download-pending'&&pending())return downloadJSON(pending().request,'upper-savannah-rehearsal-original-request.json');
      if(action==='download-receipt')return downloadJSON(stored.receipts[Number(button.dataset.index)],'upper-savannah-rehearsal-original-receipt.json');
    }catch(cause){setError(cause);}
  }
  function onInput(event){
    const input=event.target;if(!root?.contains(input)||!input.name)return;
    try{
      if(input.name==='inventory_search'){search=input.value;paint();return;}
      if(['title','operator','audience','notes','science_notes'].includes(input.name)){updateDraft(input.name,input.value);return;}
      if(input.name==='step_note')updateStep('note',input.value);
    }catch(cause){setError(cause);}
  }
  async function onChange(event){
    const input=event.target;if(!root?.contains(input)||!input.name)return;
    try{
      if(input.name==='revision')return await selectRecord(view.id,Number(input.value),view.tab);
      if(input.name==='mode'){updateDraft('mode',input.value);return;}
      if(input.name.startsWith('selection.')){updateDraft(input.name,input.value||null);await flush();paint();return;}
      if(input.name==='alternative_run_ids'){
        const ids=new Set(rhList(draft?.fields.selection.alternative_run_ids));
        if(input.checked)ids.add(input.value);else ids.delete(input.value);
        updateDraft('selection.alternative_run_ids',[...ids]);return;
      }
      if(input.name==='task_ids'){
        const ids=new Set(rhList(stepDraft?.task_ids));
        if(input.checked)ids.add(input.value);else ids.delete(input.value);
        updateStep('task_ids',[...ids]);await flush();paint();return;
      }
      if(input.name==='media_file'){
        const file=input.files?.[0],key=scope.key+':'+stepKey();
        if(file){fileSelections.set(key,file);notice='Selected '+file.name+' ('+rhBytes(file.size)+'). Use “Retain selected media” to save its original bytes.';}
        else fileSelections.delete(key);
      }
    }catch(cause){setError(cause);}
  }
  async function onSubmit(event){
    const form=event.target.closest('[data-rh-form]');
    if(!form||!root?.contains(form))return;
    event.preventDefault();event.stopPropagation();
    if(form.dataset.rhForm!=='prepare')return;
    if(!form.reportValidity())return;
    try{await saveDraft();}catch(cause){setError(cause);}
  }
  function mount(element){
    if(root===element&&!detached){paint();return;}
    if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('submit',onSubmit);}
    root=element;detached=false;
    root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('submit',onSubmit);
    paint();refresh({force:true}).catch(setError);
  }
  function detach(){
    detached=true;recordGeneration++;recordIntent=null;clearTimeout(poll);poll=null;
    if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('submit',onSubmit);}
    root=null;fileSelections.clear();
  }
  async function open(id=null){
    const intent=newRecordIntent();
    if(typeof navigate==='function')await navigate('rehearsal');
    if(recordIntent!==intent||currentWorkspace()!==intent.workspace)return;
    await refresh({force:true});
    if(!ownsRecordIntent(intent))return;
    if(id)return selectRecord(id,null,null,intent);
    view.tab=view.id?'walkthrough':'inventory';await rememberView();
    if(ownsRecordIntent(intent))paint();
  }
  return {mount,render,refresh,detach,open};
}
