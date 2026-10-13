// MIT. Case-linked planning drafts use the original native plan and amendment writers.
import {GRANT_MAX_BUNDLE_BYTES} from './agent-contracts.mjs';

export const CASE_PLANNING_SCHEMA='stellar-forge.sf47-case-planning-draft.v1';
export const CASE_PLANNING_MAX_BYTES=4*GRANT_MAX_BUNDLE_BYTES;
const DATABASE='sf47-case-planning-drafts-v1',STORE='drafts',MAX_BYTES=CASE_PLANNING_MAX_BYTES;
const PLAN=/^plan-[a-f0-9]{32}$/,CASE=/^operation-[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const TABS=new Set(['overview','source-tables','work','milestones','staffing','payments','delivery','history','comparison','operations','agenda']);
const copy=value=>structuredClone(value),stamp=()=>new Date().toISOString();
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(ok,message,code='CASE_PLANNING')=>{if(!ok)throw Object.assign(new Error(message),{code});};
const encode=value=>JSON.stringify(value,null,2)+'\n';
const identity=value=>({id:value.id,revision:value.revision,contentSha256:value.contentSha256});
let database;

export function casePlanningOwner(principal){
  need(principal&&['owner','lead'].includes(principal.role)&&typeof principal.id==='string'&&principal.id,
    'A signed-in lead opens the case planning workspace.','CASE_PLANNING_ROLE');
  return principal.id;
}
export function casePlanningBasis(current){
  need(CASE.test(current?.program?.id)&&PLAN.test(current.program.planId)&&
    Number.isSafeInteger(current.program.version)&&current.program.version>0&&
    current.plan?.id===current.program.planId&&Number.isSafeInteger(current.plan.revision)&&
    current.plan.revision>0&&HASH.test(current.plan.contentSha256),
    'Open the complete original operating case and its selected native plan.');
  return {id:current.program.id,name:current.program.name,version:current.program.version,
    planId:current.program.planId,planRevision:current.plan.revision,
    planContentSha256:current.plan.contentSha256,mode:current.program.mode,
    calendarStart:current.program.calendarStart??null};
}
function validPlan(value,planId){
  need(isObject(value)&&value.id===planId&&PLAN.test(value.id)&&
    Number.isSafeInteger(value.revision)&&value.revision>0&&
    Number.isSafeInteger(value.currentRevision??value.revision)&&
    (value.currentRevision??value.revision)>=value.revision&&HASH.test(value.contentSha256)&&
    isObject(value.scenario)&&isObject(value.planning)&&isObject(value.report),
    'Retain the complete original native planning revision.');
  return value;
}
export function readCasePlanningDraft(input){
  let value;
  try{value=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):copy(input);}
  catch{throw new Error('Open a complete case planning draft.');}
  need(isObject(value)&&value.schema===CASE_PLANNING_SCHEMA&&
    /^case-plan-[a-f0-9-]{36}$/.test(value.id??'')&&
    typeof value.ownerId==='string'&&value.ownerId&&
    Number.isSafeInteger(value.sequence)&&value.sequence>0,
    'Use the complete original case planning draft.');
  const basis=value.caseBasis;
  need(isObject(basis)&&CASE.test(basis.id)&&PLAN.test(basis.planId)&&
    Number.isSafeInteger(basis.version)&&basis.version>0&&
    Number.isSafeInteger(basis.planRevision)&&basis.planRevision>0&&HASH.test(basis.planContentSha256),
    'Retain this draft’s original case and selected planning baseline.');
  validPlan(value.plan,basis.planId);
  need(isObject(value.draft)&&isObject(value.draft.scenario)&&isObject(value.draft.planning)&&
    isObject(value.draft.report)&&typeof value.dirty==='boolean'&&typeof value.stale==='boolean'&&
    typeof value.note==='string'&&value.note.length<=12000&&TABS.has(value.tab)&&
    typeof value.createdAt==='string'&&typeof value.updatedAt==='string'&&
    Array.isArray(value.receipts)&&Array.isArray(value.basisHistory)&&
    typeof value.asOfDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate),
    'Retain the complete working inputs, source project and comparison date.');
  if(value.savedSelection)need(value.savedSelection.id===basis.planId&&
    Number.isSafeInteger(value.savedSelection.revision)&&value.savedSelection.revision>0&&
    HASH.test(value.savedSelection.contentSha256),'Keep the exact saved planning selection.');
  if(value.pending){
    const pending=value.pending,body=pending.body;
    need(pending.ownerId===value.ownerId&&pending.planId===basis.planId&&isObject(body)&&
      Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>0&&
      typeof body.requestId==='string'&&body.requestId.length>0&&
      isObject(body.scenarioPatch)&&isObject(body.planning)&&typeof body.note==='string',
      'Retain the complete original save request and its signed-in operator.');
  }
  if(value.returnSelection)need(value.returnSelection.caseId===basis.id&&
    value.returnSelection.planId===basis.planId&&typeof value.returnSelection.id==='string'&&
    Number.isSafeInteger(value.returnSelection.revision)&&value.returnSelection.revision>0&&
    HASH.test(value.returnSelection.contentSha256),'Keep the original amendment return selection.');
  need(new TextEncoder().encode(JSON.stringify(value)).length<=MAX_BYTES,
    'Keep the complete case draft within the original plan, working inputs and retained-request capacity.','CASE_PLANNING_CAPACITY');
  return value;
}
function metadata(value){
  return {id:value.id,sequence:value.sequence,ownerId:value.ownerId,caseId:value.caseBasis.id,
    caseName:value.caseBasis.name,planId:value.caseBasis.planId,planName:value.plan.name,
    planRevision:value.plan.revision,updatedAt:value.updatedAt,dirty:value.dirty,
    pending:Boolean(value.pending),savedSelection:copy(value.savedSelection),tab:value.tab};
}
async function openDatabase(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>{
      const store=request.result.createObjectStore(STORE,{keyPath:'id'});
      store.createIndex('owner','ownerId');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('The browser could not open the retained planning drafts.'));
    request.onblocked=()=>reject(new Error('Close the earlier planning-draft reader before opening this edition.'));
  });
  return database;
}
export const casePlanningBrowserStore={
  async read(id){
    const db=await openDatabase();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE),request=tx.objectStore(STORE).get(id);
      request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
    });
  },
  async list(ownerId){
    const db=await openDatabase(),rows=[];
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE),request=tx.objectStore(STORE).index('owner').openCursor(IDBKeyRange.only(ownerId));
      request.onsuccess=()=>{const cursor=request.result;if(cursor){rows.push(metadata(cursor.value));cursor.continue();}
        else resolve(rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));};
      request.onerror=()=>reject(request.error);
    });
  },
  async write(value,expected){
    readCasePlanningDraft(value);
    const db=await openDatabase();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(value.id);
      let failure;
      request.onsuccess=()=>{
        const previous=request.result;
        if((previous?.sequence??0)!==expected||(previous&&
          (previous.ownerId!==value.ownerId||previous.caseBasis.id!==value.caseBasis.id||
           previous.caseBasis.planId!==value.caseBasis.planId))){
          failure=Object.assign(new Error('Another tab changed this retained planning draft. Download the current work and reopen its saved local edition.'),{code:'CASE_PLANNING_LOCAL_CONFLICT'});
          tx.abort();return;
        }
        store.put(value);
      };
      tx.oncomplete=()=>resolve(value);
      tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('The browser did not finish saving the complete planning draft.'));
    });
  }
};
export function createCasePlanningController({api,principal,getSnapshot,onChange=()=>{},onError=()=>{},store=casePlanningBrowserStore,remember=()=>{},confirmWorkingDraftReplacement=()=>false}){
  let active=null,serial=Promise.resolve(),latestSnapshot=null,localFault=null,persisting=false,saving=false;
  const owner=()=>casePlanningOwner(principal());
  const notify=()=>onChange();
  const activeRequired=()=>{need(active,'Open the retained case planning draft first.');need(active.ownerId===owner(),
    'Sign in as the original operator to continue this retained planning draft.');return active;};
  function summary(){
    if(!active)return null;
    return {...metadata(active),caseBasis:copy(active.caseBasis),asOfDate:active.asOfDate,
      pending:active.pending?{requestId:active.pending.body.requestId,expectedRevision:active.pending.body.expectedRevision,
        error:copy(active.pending.error),ownerId:active.pending.ownerId}:null,
      saving,persisting,localFault:localFault?.message??null,returnSelection:copy(active.returnSelection),
      amendmentDraftId:active.amendmentDraftId??null,appliedCase:copy(active.appliedCase??null),
      earlierBasisCount:active.basisHistory.length};
  }
  function enqueue(action){
    const task=serial.then(action);
    serial=task.catch(error=>{localFault=error;onError(error);notify();});
    return task;
  }
  async function write(next){
    const previous=activeRequired();
    need(next.id===previous.id,'Keep the same original local planning draft.');
    next.sequence=previous.sequence+1;next.updatedAt=stamp();
    await store.write(readCasePlanningDraft(next),previous.sequence);
    active=next;localFault=null;remember(active.id);notify();return active;
  }
  function capture(snapshot){
    need(snapshot?.current?.id===active.caseBasis.planId,
      'Save the current planning draft before opening a different case’s plan.');
    validPlan(snapshot.current,active.caseBasis.planId);
    return {plan:copy(snapshot.current),draft:copy(snapshot.draft),
      dirty:Boolean(snapshot.dirty),stale:Boolean(snapshot.stale),note:String(snapshot.note??''),
      tab:TABS.has(snapshot.tab)?snapshot.tab:'source-tables'};
  }
  function schedule(){
    if(!active||saving||active.pending||active.ownerId!==principal()?.id)return;
    latestSnapshot=getSnapshot;
    if(persisting){notify();return;}
    persisting=true;notify();
    enqueue(async()=>{
      try{
        while(latestSnapshot){
          const reader=latestSnapshot;latestSnapshot=null;
          const fields=capture(reader());
          await write({...copy(active),...fields});
        }
      }finally{persisting=false;notify();}
    }).catch(()=>{});
  }
  async function flush(){
    await serial;
    if(latestSnapshot&&!persisting){schedule();await serial;}
    if(localFault)throw localFault;
    return active;
  }
  function snapshot(){
    const value=activeRequired();
    return {current:copy(value.plan),draft:copy(value.draft),dirty:value.dirty,stale:value.stale,
      note:value.note,tab:value.tab,returnSelection:copy(value.returnSelection)};
  }
  async function checkOriginal(value){
    need(value.ownerId===owner(),'Sign in as the original operator to receive this retained planning work.');
    const [current,selected]=await Promise.all([
      api('/api/operations/'+value.caseBasis.id),
      api('/api/plans/'+value.caseBasis.planId+'/revision/'+value.plan.revision)]);
    const basis=casePlanningBasis(current);
    need(basis.id===value.caseBasis.id&&basis.planId===value.caseBasis.planId,
      'Receive this complete draft in its original case and plan.');
    need(selected.id===value.plan.id&&selected.revision===value.plan.revision&&
      selected.contentSha256===value.plan.contentSha256,'Keep the original saved planning revision for this working draft.');
    return current;
  }
  async function allowWorkingDraftTransition(){
    if(!active&&getSnapshot()?.dirty)need(await confirmWorkingDraftReplacement(),
      'The current unsaved planning draft remains open.','CASE_PLANNING_WORKING_DRAFT');
  }
  async function open(id,{recoverLocal=false}={}){
    need(!active?.pending||active.id===id,'Receive the original retained save before switching planning drafts.');
    need(!saving,'Receive the current native save before switching planning drafts.');
    await allowWorkingDraftTransition();
    if(recoverLocal)await serial;else await flush();
    const value=readCasePlanningDraft(await store.read(id));
    await checkOriginal(value);
    active=value;latestSnapshot=null;localFault=null;remember(value.id);notify();return snapshot();
  }
  async function start(current,{asOfDate=new Date().toISOString().slice(0,10),amendmentDraftId=null}={}){
    need(!saving,'Receive the current native save before switching planning drafts.');
    await flush();
    const basis=casePlanningBasis(current),ownerId=owner(),working=getSnapshot();
    if(active?.caseBasis.id===basis.id&&active.ownerId===ownerId){
      await enqueue(async()=>write({...copy(active),tab:'source-tables'}));return snapshot();
    }
    need(!active?.pending,'Receive the original retained save before opening another case’s planning work.');
    need(!working?.dirty||working.current?.id===basis.planId,
      'Keep the current unsaved plan open. Save it before choosing another case’s planning work.');
    const [actual,latest]=await Promise.all([api('/api/operations/'+basis.id),api('/api/plans/'+basis.planId)]);
    const checked=casePlanningBasis(actual);
    need(checked.planId===basis.planId,'Reopen the case’s original planning selection.');
    validPlan(latest,basis.planId);
    const fields=working?.dirty&&working.current?.id===basis.planId?
      {plan:copy(working.current),draft:copy(working.draft),dirty:true,stale:Boolean(working.stale),note:String(working.note??'')}:
      {plan:copy(latest),draft:{scenario:copy(latest.scenario),planning:copy(latest.planning),report:copy(latest.report)},dirty:false,stale:false,note:''};
    const value={schema:CASE_PLANNING_SCHEMA,id:'case-plan-'+crypto.randomUUID(),sequence:1,ownerId,
      createdAt:stamp(),updatedAt:stamp(),caseBasis:checked,asOfDate,originAmendmentDraftId:amendmentDraftId,
      ...fields,tab:'source-tables',savedSelection:fields.dirty?null:identity(fields.plan),pending:null,
      receipts:[],basisHistory:[],returnSelection:null,amendmentDraftId:null};
    readCasePlanningDraft(value);await store.write(value,0);
    active=value;localFault=null;latestSnapshot=null;remember(value.id);notify();return snapshot();
  }
  async function importDraft(input){
    need(!active?.pending,'Receive the original retained save before opening another draft file.');
    need(!saving,'Receive the original save before opening another draft.');
    await flush();
    const source=readCasePlanningDraft(input);
    need(!source.pending||source.ownerId===owner(),'Sign in as the original operator to receive the retained save.');
    const value={...source,ownerId:owner()};
    await checkOriginal(value);
    const existing=await store.read(source.id);
    if(existing){
      const checked=readCasePlanningDraft(existing);
      need(checked.ownerId===owner()&&checked.caseBasis.id===source.caseBasis.id&&
        checked.caseBasis.planId===source.caseBasis.planId,'This local draft identity belongs to another retained operator or case.');
      if(JSON.stringify(checked)===JSON.stringify(source))return open(source.id);
      need(!source.pending,'Recover the existing local draft’s original request before importing another edition.');
      value.id='case-plan-'+crypto.randomUUID();
    }else if(source.ownerId!==owner())value.id='case-plan-'+crypto.randomUUID();
    await allowWorkingDraftTransition();
    value.sequence=1;value.updatedAt=stamp();
    value.receivedFrom={id:source.id,sequence:source.sequence,ownerId:source.ownerId,receivedAt:stamp()};
    await store.write(readCasePlanningDraft(value),0);
    active=value;localFault=null;latestSnapshot=null;remember(value.id);notify();return snapshot();
  }
  async function savePending(){
    await flush();const value=activeRequired();
    need(value.pending,'Receive the original retained save request.');need(!saving,'The original save is already running.');
    const pending=copy(value.pending),draftId=value.id;
    need(pending.ownerId===owner()&&pending.planId===value.caseBasis.planId,
      'Sign in as the same operator for the retained native save.');
    saving=true;notify();
    try{
      let result;
      try{result=await api('/api/plans/'+pending.planId+'/save',copy(pending.body));}
      catch(error){
        const rejected=[409,413,422].includes(error.status)&&Boolean(error.code)&&error.code!=='REQUEST_CONFLICT';
        await enqueue(async()=>{
          need(active?.id===draftId&&active.pending?.body.requestId===pending.body.requestId,'Keep the original pending save.');
          await write({...copy(active),pending:{...copy(active.pending),
            error:{message:error.message,code:error.code??null,status:error.status??null,rejected}}});
        });
        throw error;
      }
      validPlan(result,pending.planId);
      need(result.revision===pending.body.expectedRevision+(result.unchanged?0:1),
        'Receive the original selected native save result.','CASE_PLANNING_SAVE_RESULT');
      await enqueue(async()=>{
        need(active?.id===draftId&&active.pending?.body.requestId===pending.body.requestId,
          'Retain the original draft while receiving its save.');
        const next=copy(active);
        next.receipts.push({requestId:pending.body.requestId,expectedRevision:pending.body.expectedRevision,
          result:{...identity(result),savedAt:result.savedAt??null,unchanged:Boolean(result.unchanged)},receivedAt:stamp()});
        next.receipts=next.receipts.slice(-40);next.plan=copy(result);
        next.draft={scenario:copy(result.scenario),planning:copy(result.planning),report:copy(result.report)};
        next.dirty=false;next.stale=false;next.note='';next.pending=null;next.savedSelection=identity(result);
        next.returnSelection=null;next.amendmentDraftId=null;next.appliedCase=null;
        await write(next);
      });
      return {result:copy(result),snapshot:snapshot()};
    }finally{saving=false;notify();}
  }
  async function save(body){
    await flush();const value=activeRequired();
    if(value.pending)return savePending();
    need(body?.expectedRevision===(value.plan.currentRevision??value.plan.revision)&&
      typeof body.requestId==='string'&&body.requestId&&isObject(body.scenarioPatch)&&isObject(body.planning),
      'Save the complete current native draft with its original revision and request.');
    await enqueue(async()=>write({...copy(active),pending:{ownerId:owner(),planId:active.caseBasis.planId,
      body:copy(body),startedAt:stamp(),error:null}}));
    return savePending();
  }
  async function resolveRejected(){
    await flush();activeRequired();
    need(active.pending?.error?.rejected,'Receive a confirmed native rejection before changing its retained request.');
    await enqueue(async()=>{
      const next=copy(active),pending=next.pending;
      next.receipts.push({requestId:pending.body.requestId,expectedRevision:pending.body.expectedRevision,
        error:copy(pending.error),resolvedAt:stamp()});next.receipts=next.receipts.slice(-40);
      next.pending=null;await write(next);
    });
    return snapshot();
  }
  async function refreshPlanningBasis(){
    await flush();const value=activeRequired();
    need(!value.pending,'Receive the original native save before selecting a newer planning basis.');
    const latest=await api('/api/plans/'+value.caseBasis.planId);validPlan(latest,value.caseBasis.planId);
    await enqueue(async()=>{
      const next=copy(active);
      if(next.plan.contentSha256!==latest.contentSha256||next.plan.revision!==latest.revision){
        next.basisHistory.push({...identity(next.plan),selectedAt:stamp()});
        next.basisHistory=next.basisHistory.slice(-100);
      }
      next.plan=copy(latest);next.stale=true;next.dirty=true;
      next.returnSelection=null;next.amendmentDraftId=null;await write(next);
    });
    return snapshot();
  }
  async function prepareReturn(){
    await flush();const value=activeRequired();
    need(!value.pending,'Receive the original native save before opening its amendment.');
    need(!value.dirty&&value.savedSelection,'Save the complete reviewed working plan before returning to amendment review.');
    const selected=value.savedSelection;
    const [current,saved]=await Promise.all([api('/api/operations/'+value.caseBasis.id),
      api('/api/plans/'+value.caseBasis.planId+'/revision/'+selected.revision)]);
    const basis=casePlanningBasis(current);
    need(basis.id===value.caseBasis.id&&basis.planId===value.caseBasis.planId&&
      saved.id===selected.id&&saved.revision===selected.revision&&saved.contentSha256===selected.contentSha256,
      'Keep the same case and exact saved planning revision for amendment review.');
    const selection={id:value.id+':'+selected.contentSha256,draftId:value.id,caseId:basis.id,planId:basis.planId,
      revision:selected.revision,contentSha256:selected.contentSha256,asOfDate:value.asOfDate,
      reason:saved.note||'Review the saved workbook and planning changes.',caseBasis:copy(value.caseBasis)};
    await enqueue(async()=>write({...copy(active),tab:'operations',returnSelection:copy(selection)}));
    return {caseId:basis.id,tab:'amendments',planningReturn:selection};
  }
  async function acknowledgeReturn(selection,localDraftId){
    await flush();if(!active||selection?.draftId!==active.id)return;
    need(selection.caseId===active.caseBasis.id&&selection.planId===active.caseBasis.planId&&
      active.returnSelection?.id===selection.id,'Keep the original returned planning selection.');
    if(active.amendmentDraftId===localDraftId)return;
    await enqueue(async()=>write({...copy(active),amendmentDraftId:localDraftId??null}));
  }
  async function observeCase(current){
    if(!active||!active.returnSelection||current?.program?.id!==active.caseBasis.id)return;
    const basis=casePlanningBasis(current),selected=active.returnSelection;
    if(basis.planId!==selected.planId||basis.planRevision!==selected.revision||basis.planContentSha256!==selected.contentSha256)return;
    if(active.appliedCase?.version===basis.version)return;
    await flush();await enqueue(async()=>write({...copy(active),appliedCase:basis}));
  }
  async function exportDraft(){
    try{await flush();}catch{}
    const value=activeRequired(),visible=getSnapshot();
    const exported=copy(value);
    if(!value.pending&&visible?.current?.id===value.caseBasis.planId)Object.assign(exported,capture(visible));
    return encode(readCasePlanningDraft(exported));
  }
  async function detach(){
    need(!saving&&!active?.pending,'Receive the original native save before changing planning work.');
    await flush();active=null;latestSnapshot=null;localFault=null;remember(null);notify();
  }
  function forgetVisible(){active=null;latestSnapshot=null;localFault=null;notify();}
  return {summary,snapshot,start,open,importDraft,schedule,flush,save,savePending,resolveRejected,
    refreshPlanningBasis,prepareReturn,acknowledgeReturn,observeCase,exportDraft,detach,forgetVisible,
    recoverLocal:()=>open(activeRequired().id,{recoverLocal:true}),list:()=>store.list(owner())};
}

export function renderCasePlanningBar(container,controller,onAction){
  container.replaceChildren();const value=controller.summary();container.hidden=!value;
  if(!value)return;
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  container.className='case-planning-route panel';container.setAttribute('aria-label','Case planning draft');
  container.append(element('h2','Planning changes for '+value.caseBasis.name),
    element('p','Case baseline revision '+value.caseBasis.planRevision+' · planning draft from revision '+value.planRevision+
      (value.savedSelection?' · saved candidate revision '+value.savedSelection.revision:'')),
    element('p','Comparison date '+value.asOfDate+' · '+(value.persisting?'Saving complete local draft…':
      value.localFault?'Current fields are available for download.': 'Complete local draft saved at '+value.updatedAt)));
  const status=element('p',value.localFault||value.pending?.error?.message||
    (value.pending?'Original save '+value.pending.requestId+' is retained. Receive its result to continue.':
      value.appliedCase?'The original case now selects this saved planning revision.':
      'Use Source tables to receive the returned workbook, review the complete plan and save a named revision.'));
  status.setAttribute('role',value.localFault?'alert':'status');container.append(status);
  const actions=element('div');actions.className='button-row';
  const add=(label,action,disabled=false)=>{
    const button=element('button',label);button.type='button';button.dataset.casePlanningAction=action;
    button.dataset.fixedDisabled=String(disabled||value.saving);
    button.disabled=disabled||value.saving;button.addEventListener('click',()=>onAction(action));actions.append(button);
  };
  if(value.pending)add('Receive original save','receive');
  if(value.pending?.error?.rejected)add('Keep draft and resolve rejected save','resolve-rejected');
  add('Open planning work','planning',Boolean(value.pending));
  add('Review saved revision in this case','amendments',Boolean(value.pending)||value.dirty||!value.savedSelection);
  add('Download complete working draft','export');
  if(value.localFault)add('Download work and reopen saved local draft','recover-local');
  add('Open complete draft file','import',Boolean(value.pending));
  add('Saved local drafts','list',Boolean(value.pending));
  add('Use current saved revision as write basis','refresh-basis',Boolean(value.pending));
  add('Leave case planning','detach',Boolean(value.pending));
  container.append(actions);
  if(value.earlierBasisCount)container.append(element('p','Earlier saved revision selections remain in the plan history.'));
}
