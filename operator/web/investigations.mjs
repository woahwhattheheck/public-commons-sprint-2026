
/** Investigations in the original authenticated Upper Savannah operator. */
const json = value => JSON.stringify(value);
const clone = value => value == null ? value : JSON.parse(json(value));
const workspaceId = state => state?.workspace_key || null;
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' :
  value && typeof value==='object' ? '{'+Object.keys(value).sort().map(k=>json(k)+':'+stable(value[k])).join(',')+'}' : json(value);
const originalId = value => typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
const actionNames = {
 'intelligence.session.create':'Create investigation','intelligence.diagnostic.open':'Open saved analysis','intelligence.inspect':'Analyze original source',
 'intelligence.prepare':'Prepare guided action','intelligence.execute':'Execute guided action',
 'intelligence.continue':'Continue original submission',
 'intelligence.ask':'Investigate question','intelligence.export':'Export investigation',
 'intelligence.collection.export':'Export selected original files'
};
export function createInvestigationClient(options) {
 const {api,getWorkspace,onChange=()=>{},onNotice=()=>{}}=options;
 const storage=options.storage || globalThis.sessionStorage;
 const contexts=new Map(),refreshes=new Map(),diagnosticFlights=new Map();
 const key=w=>'upstate-intelligence:'+w;
 const makeId=()=> 'intelligence_'+(options.randomUUID?.() || globalThis.crypto?.randomUUID?.() ||
   Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2)).replaceAll('-','');
 const context=w=>{
  if(!w)throw Error('Select an available workspace in the original workbench.');
  if(!contexts.has(w)){
   let saved={};try{saved=JSON.parse(storage?.getItem(key(w))||'{}');}catch{}
   contexts.set(w,{workspace:w,catalog:null,session:null,sessionId:saved.sessionId||null,
    evidence:null,exported:null,sourceCatalog:null,collection:null,collectionId:saved.collectionId||null,
    sourceSelection:Array.isArray(saved.sourceSelection)?saved.sourceSelection:[],
    experiment:null,experimentId:saved.experimentId||null,experimentOffset:saved.experimentOffset||0,experimentRead:0,
    nativeTask:null,nativeTaskRead:0,experimentSubmission:saved.experimentSubmission||null,
    diagnosticReport:null,diagnosticIntake:saved.diagnosticIntake||null,diagnosticRead:0,
    lastResult:saved.lastResult||null,pending:saved.pending||null,draft:saved.draft||{},sessionRead:0,collectionRead:0,lastTask:null,loading:false,error:null,readErrors:{}});
  }return contexts.get(w);
 };
 const persist=c=>{try{storage?.setItem(key(c.workspace),json({sessionId:c.sessionId,pending:c.pending,lastResult:c.lastResult,draft:c.draft,diagnosticIntake:c.diagnosticIntake,collectionId:c.collectionId,sourceSelection:c.sourceSelection,experimentId:c.experimentId,experimentOffset:c.experimentOffset,experimentSubmission:c.experimentSubmission}));}
  catch{onNotice('Browser recovery storage is unavailable. Keep the original operation ID shown here.');}};
 const changed=c=>{persist(c);if(c.workspace===getWorkspace())onChange(snapshot());};
 const path=(name,w,values={})=>'/api/intelligence/'+name+'?'+new URLSearchParams({workspace:w,...values});
 const read=async(name,w,values={})=>api(path(name,w,values));
 const snapshot=(w=getWorkspace())=>clone(context(w));
 async function catalog(w=getWorkspace()){
  const c=context(w),value=await read('catalog',w);c.catalog=value;changed(c);return value;
 }
 async function session(id,w=getWorkspace()){
  const c=context(w),request=++c.sessionRead;
  if(c.sessionId!==id){c.sessionId=id||null;c.session=null;c.evidence=null;c.exported=null;c.collection=null;c.collectionId=null;++c.collectionRead;changed(c);}
  if(!id){c.session=null;c.sessionId=null;c.evidence=null;c.exported=null;c.collection=null;c.collectionId=null;changed(c);return null;}
  const value=await read('session',w,{session_id:id});
  if(request===c.sessionRead && c.sessionId===id){c.session=value;changed(c);}return value;
 }
 async function evidence(id,w=getWorkspace(),sid=context(w).sessionId){
  if(!sid)throw Error('Create or reopen an investigation first.');
  const c=context(w),value=await read('evidence',w,{session_id:sid,evidence_id:id});
  if(c.sessionId===sid)c.evidence=value;changed(c);return value;
 }
 async function exported(id,w=getWorkspace(),sid=context(w).sessionId){
  const c=context(w),value=await read('export',w,{session_id:sid,export_id:id});
  if(c.sessionId===sid)c.exported=value;changed(c);return value;
 }
 async function collectionSources(w=getWorkspace()){
  const c=context(w),value=await read('collection_sources',w);c.sourceCatalog=value;changed(c);return value;
 }
 async function collection(id,w=getWorkspace(),sid=context(w).sessionId){
  if(!sid)throw Error('Create or reopen an investigation first.');
  const c=context(w),request=++c.collectionRead;
  if(c.sessionId===sid){c.collectionId=id;changed(c);}
  const value=await read('collection',w,{session_id:sid,collection_id:id});
  if(request===c.collectionRead && c.sessionId===sid && c.collectionId===id){c.collection=value;changed(c);}
  return value;
 }
 async function experiment(id,offset=0,w=getWorkspace()){
  if(!originalId(id)||!Number.isSafeInteger(offset)||offset<0)throw Error('Choose an original saved programme and page.');
  const c=context(w),request=++c.experimentRead;
  if(c.experimentId!==id||c.experimentOffset!==offset)c.experiment=null;
  c.experimentId=id;c.experimentOffset=offset;changed(c);
  const value=await read('experiment',w,{experiment_id:id,offset,limit:100});
  if(request===c.experimentRead&&c.experimentId===id){c.experiment=value;changed(c);}
  return value;
 }
 async function nativeTask(id,w=getWorkspace()){
  if(!originalId(id))throw Error('Choose an original native task.');
  const c=context(w),request=++c.nativeTaskRead,value=await read('native-task',w,{task_id:id});
  if(request===c.nativeTaskRead){c.nativeTask=value;changed(c);}
  return value;
 }
 async function acceptExperimentSubmission(task,c,submission,hydrate=true){
  if(task.workspace!==c.workspace || task.action!==submission.body.action ||
     task.operation_id!==submission.body.operation_id || !originalId(task.id) ||
     task.id!==submission.taskId || stable(task.payload)!==stable(submission.body.payload))
   throw Error('The native programme task does not match its original design submission.');
  submission.taskState=task.state;submission.error=null;
  if(task.state==='complete'){
   const id=task.result?.id;
   if(!originalId(id))throw Error('The completed original task did not return its saved programme ID.');
   submission.experimentId=id;
   changed(c);
   if(hydrate)await reconcileReads(c,[['catalog','Saved investigation catalog',()=>catalog(c.workspace)],
    ['programme-return','Original programme return',()=>c.sessionId===submission.sessionId&&!submission.selected?selectSubmittedExperiment(c.workspace):null]]);
  }else if(['failed','interrupted','canceled','cancelled'].includes(task.state)){
   submission.error=task.error?.message||'The original native task '+task.state+'. Open its retained task to continue.';
  }
  changed(c);return task;
 }
 async function trackExperimentSubmission(task,sid,w=getWorkspace()){
  const c=context(w);
  if(!sid||!originalId(task?.id)||task.workspace!==w||
     !['experiment.save','experiment.run'].includes(task.action)||
     typeof task.operation_id!=='string'||!task.payload?.selection)
   throw Error('The original designer did not return this workspace’s exact native task.');
  const current=c.experimentSubmission;
  if(current&&!['complete','failed','interrupted','canceled','cancelled'].includes(current.taskState)&&current.taskId!==task.id)
   throw Error('The earlier original programme submission is still retained.');
  const submission={body:{workspace:w,action:task.action,operation_id:task.operation_id,payload:clone(task.payload)},
   taskId:task.id,taskState:task.state,sessionId:sid,experimentId:null,error:null,selected:false};
  c.experimentSubmission=submission;changed(c);
  return acceptExperimentSubmission(task,c,submission);
 }
 async function pollExperimentSubmission(w=getWorkspace(),hydrate=true){
  const c=context(w),submission=c.experimentSubmission;if(!submission)return null;
  const task=await api('/api/task?'+new URLSearchParams({id:submission.taskId,workspace:w}));
  if(c.experimentSubmission===submission)return acceptExperimentSubmission(task,c,submission,hydrate);
  return task;
 }
 async function selectSubmittedExperiment(w=getWorkspace(),readProgramme=true){
  const c=context(w),submission=c.experimentSubmission;
  if(!submission?.experimentId)throw Error('The original programme is still being prepared.');
  if(c.sessionId!==submission.sessionId)await session(submission.sessionId,w);
  if(c.experimentSubmission!==submission||c.sessionId!==submission.sessionId)return null;
  c.draft.fields||={};Object.assign(c.draft.fields,{
   actionKind:'ensemble',ensembleMode:'saved',nativeProgramme:submission.experimentId});
  c.draft.panel='actions';c.draft.selected={kind:'ensemble',id:submission.experimentId};submission.selected=true;
  if(c.experimentId!==submission.experimentId)c.experiment=null;
  c.experimentId=submission.experimentId;c.experimentOffset=0;
  changed(c);
  if(readProgramme)await experiment(submission.experimentId,0,w);
  return submission.experimentId;
 }
 function clearExperimentSubmission(){
  const c=context(getWorkspace()),submission=c.experimentSubmission;
  if(submission&&!['complete','failed','interrupted','canceled','cancelled'].includes(submission.taskState))
   throw Error('Keep the original programme operation until its status is known.');
  c.experimentSubmission=null;changed(c);
 }
 function selectSources(refs,selected=true){
  if(!Array.isArray(refs))throw Error('Choose original source references.');
  const c=context(getWorkspace()),items=new Map(c.sourceSelection.map(ref=>[stable(ref),ref]));
  for(const ref of refs){
   if(!ref || !['dataset','artifact'].includes(ref.kind) || typeof ref.id!=='string' || !ref.id)throw Error('Choose original source references.');
   if(selected)items.set(stable(ref),clone(ref));else items.delete(stable(ref));
  }
  c.sourceSelection=[...items.values()];changed(c);
 }
 function clearSourceSelection(){const c=context(getWorkspace());c.sourceSelection=[];changed(c);}
 async function exportCollection(title=''){
  const c=context(getWorkspace()),sid=c.sessionId;
  if(!sid)throw Error('Create or reopen an investigation first.');
  if(!c.sourceSelection.length)throw Error('Select original files for this collection.');
  return queue('intelligence.collection.export',{session_id:sid,title:title.trim(),refs:clone(c.sourceSelection)});
 }
 async function reconcileReads(c,readers){
  return Promise.all(readers.map(async([key,label,read])=>{
   try{
    const value=await read();delete c.readErrors[key];return {key,status:'fulfilled',value};
   }catch(error){
    c.readErrors[key]={label,message:error?.message||String(error)};
    return {key,status:'rejected',reason:error};
   }finally{
    c.error=Object.values(c.readErrors).map(row=>row.label+': '+row.message).join('\n')||null;changed(c);
   }
  }));
 }
 function refresh(w=getWorkspace()){
  if(refreshes.has(w))return refreshes.get(w);
  const c=context(w);c.loading=true;c.error=null;c.readErrors={};changed(c);
  const operation=(async()=>{
   try{
    // Catalog, source inventory and retained operation status are independent.
    await reconcileReads(c,[
     ['catalog','Saved investigation catalog',()=>catalog(w)],
     ['sources','Registered source collections',()=>collectionSources(w)],
     ['operation','Original investigation task',()=>c.pending?.taskId?poll(w,false):null],
     ['programme-task','Original programme task',()=>c.experimentSubmission&&c.experimentSubmission.taskState!=='complete'?pollExperimentSubmission(w,false):null]
    ]);
    const submitted=c.experimentSubmission;
    if(submitted?.experimentId&&!submitted.selected&&c.sessionId===submitted.sessionId)
     await reconcileReads(c,[['programme-return','Original programme return',()=>selectSubmittedExperiment(w,false)]]);
    await reconcileReads(c,[
     ['session','Retained investigation',()=>c.sessionId?session(c.sessionId,w):null],
     ['evidence','Retained analysis evidence',()=>c.lastResult?.evidence_id&&c.sessionId===c.lastResult.session_id?evidence(c.lastResult.evidence_id,w,c.sessionId):null],
     ['export','Retained investigation export',()=>c.lastResult?.export_id&&c.sessionId===c.lastResult.session_id?exported(c.lastResult.export_id,w,c.sessionId):null],
     ['collection','Retained file collection',()=>c.collectionId&&c.sessionId?collection(c.collectionId,w,c.sessionId):null],
     ['programme','Original programme results',()=>c.experimentId?experiment(c.experimentId,c.experimentOffset,w):null]
    ]);
    if(c.diagnosticIntake)await reconcileReads(c,[['diagnostic','Saved scientific interpretation',()=>resumeDiagnostic(w)]]);
   }finally{c.loading=false;refreshes.delete(w);changed(c);}
   return clone(c);
  })();
  refreshes.set(w,operation);return operation;
 }
 async function accept(task,c,p,hydrate=true){
  // Original Operator.submit may return an identical active task already admitted
  // under another operation ID. Retain that exact admission, then poll only it.
  const expectedOperation=p.acceptedOperationId||p.body.operation_id;
  const joinedActive=!p.taskId&&!p.acceptedOperationId&&task.operation_id!==p.body.operation_id&&
   ['queued','running'].includes(task.state);
  if(task.workspace!==c.workspace || task.action!==p.body.action ||
      typeof task.operation_id!=='string'||!task.operation_id||
      (!joinedActive&&task.operation_id!==expectedOperation) ||
      (p.taskId&&p.taskId!==task.id) ||
      stable(task.payload)!==stable(p.body.payload) || !originalId(task.id))
   throw Error('The returned operation does not match this original workspace request.');
  p.acceptedOperationId=task.operation_id;p.joinedExistingTask=p.joinedExistingTask||joinedActive;
  c.lastTask=task;p.taskId=task.id;p.taskState=task.state;p.error=null;
  if(task.state==='complete'){
   const r=task.result||{};c.lastResult=clone(r);c.pending=null;
   const intake=c.diagnosticIntake;
   if(p.body.action==='intelligence.diagnostic.open' && intake?.operation_id===p.body.operation_id){
    if(r.diagnostic_id!==intake.diagnostic_id || r.dataset_id!==intake.dataset_id ||
       !r.session_id || !r.evidence_id || !originalId(r.source_sha256) ||
       (r.report_dataset_id && r.report_dataset_id!=='es26:'+intake.diagnostic_id+':report_revision_'+r.source_sha256)){
     intake.phase='error';intake.error='The original diagnostic operation returned a different saved report.';changed(c);throw Error(intake.error);
    }
    Object.assign(intake,{session_id:r.session_id,evidence_id:r.evidence_id,report_dataset_id:r.report_dataset_id||r.dataset_id,completed_operation_id:p.body.operation_id,
     operation_id:null,phase:'received',error:null});
    if(intake.source_sha256 && intake.source_sha256!==r.source_sha256){
     intake.phase='error';intake.error='The saved diagnostic changed while its original operation was running.';changed(c);throw Error(intake.error);
    }
    intake.source_sha256=r.source_sha256;
   }
   if(r.session_id && ((['intelligence.session.create','intelligence.diagnostic.open'].includes(p.body.action) &&
       (p.selectedSessionId===undefined||c.sessionId===p.selectedSessionId))||!c.sessionId||c.sessionId===r.session_id)){
    if(c.sessionId!==r.session_id){c.sessionId=r.session_id;c.session=null;c.evidence=null;c.exported=null;c.collection=null;c.collectionId=null;++c.sessionRead;++c.collectionRead;}
   }
   if(r.collection_id && c.sessionId===r.session_id)c.collectionId=r.collection_id;
   changed(c);
   if(hydrate)await reconcileReads(c,[
    ['catalog','Saved investigation catalog',()=>catalog(c.workspace)],
    ['session','Retained investigation',()=>c.sessionId?session(c.sessionId,c.workspace):null],
    ['evidence','Retained analysis evidence',()=>r.evidence_id&&c.sessionId===r.session_id?evidence(r.evidence_id,c.workspace,r.session_id):null],
    ['export','Retained investigation export',()=>r.export_id&&c.sessionId===r.session_id?exported(r.export_id,c.workspace,r.session_id):null],
    ['collection','Retained file collection',()=>r.collection_id&&c.sessionId===r.session_id?collection(r.collection_id,c.workspace,r.session_id):null]
   ]);
   return task;
  }
  if(['failed','interrupted','canceled','cancelled'].includes(task.state)){
   p.error=task.error?.message || 'The original operation '+task.state+'. Open its retained task for recovery.';
  }
  changed(c);return task;
 }
 async function send(c,p){
  p.error=null;changed(c);
  try{
   const task=await api('/api/actions',{method:'POST',body:clone(p.body)});
   if(c.pending===p)await accept(task,c,p);
   return task;
  }catch(error){
   if(c.pending===p){p.error=error.message;changed(c);}
   throw error;
  }
 }
 async function queue(action,payload={},w=getWorkspace()){
  if(!Object.hasOwn(actionNames,action))throw Error('Choose a registered investigation operation.');
  const c=context(w);
  if(c.pending)throw Error('Reopen or finish the existing investigation operation first.');
  const p={body:{workspace:w,action,payload:clone(payload),operation_id:makeId()},selectedSessionId:c.sessionId,taskId:null,taskState:null,error:null};
  c.pending=p;
  if(action==='intelligence.diagnostic.open' && c.diagnosticIntake?.diagnostic_id===payload.diagnostic_id){
   c.diagnosticIntake.operation_id=p.body.operation_id;c.diagnosticIntake.phase='submitted';
  }
  changed(c);return send(c,p);
 }
 async function retry(){
  const c=context(getWorkspace()),p=c.pending;if(!p)return null;
  if(p.taskId)return poll(c.workspace);
  return send(c,p);
 }
 async function poll(w=getWorkspace(),hydrate=true){
  const c=context(w),p=c.pending;if(!p?.taskId)return null;
  const task=await api('/api/task?'+new URLSearchParams({id:p.taskId,workspace:w}));
  if(c.pending===p)return accept(task,c,p,hydrate);
  return task;
 }

 function diagnosticSelection(value){
  const w=value?.workspace_key,id=value?.diagnostic_id;
  if(typeof w!=='string'||!w||!originalId(id)||value.dataset_id!=='es26:'+id+':report_json'||
     (value.report_sha256!=null&&!originalId(value.report_sha256)))
   throw Error('Open an original saved scientific diagnostic from its current workspace.');
  return {workspace_key:w,diagnostic_id:id,dataset_id:value.dataset_id,
   ...(value.report_sha256?{report_sha256:value.report_sha256}:{}),title:typeof value.title==='string'&&value.title.trim()?value.title.trim():'Scientific interpretation'};
 }
 async function diagnostic(id,w=getWorkspace(),reportSha=null){
  if(!originalId(id)||(reportSha!=null&&!originalId(reportSha)))throw Error('Choose an original saved diagnostic and report revision.');
  const c=context(w),revision=++c.diagnosticRead,value=await read('diagnostic',w,{diagnostic_id:id,...(reportSha?{report_sha256:reportSha}:{})}),m=value?._investigation;
  if(m?.workspace_key!==w||m.diagnostic_id!==id||m.dataset_id!=='es26:'+id+':report_json'||!originalId(m.source_sha256)||
     (reportSha&&m.source_sha256!==reportSha)||
     (m.report_dataset_id && m.report_dataset_id!=='es26:'+id+':report_revision_'+m.source_sha256))
   throw Error('The saved report does not match this diagnostic and workspace.');
  if(revision===c.diagnosticRead && c.diagnosticIntake?.diagnostic_id===id){c.diagnosticReport=value;changed(c);}
  return value;
 }
 function matchesDiagnosticEvidence(value,intake){
  return value?.id===intake.evidence_id && (value.sources||[]).some(source=>
   source.sha256===intake.source_sha256 && stable(source.ref)===stable({kind:'dataset',id:intake.report_dataset_id||intake.dataset_id}));
 }
 async function resumeDiagnostic(w=getWorkspace()){
  const c=context(w),intake=c.diagnosticIntake;if(!intake)return snapshot(w);
  const selection=diagnosticSelection(intake);
  if(selection.workspace_key!==w)throw Error('This diagnostic belongs to its original workspace.');
  const existing=diagnosticFlights.get(w);if(existing?.intake===intake)return existing.promise;
  const run=async()=>{
   try{
    intake.error=null;
    if(c.pending){
     if(c.pending.body.operation_id!==intake.operation_id){intake.phase='waiting';changed(c);return snapshot(w);}
     if(['failed','interrupted','canceled','cancelled'].includes(c.pending.taskState)){
      intake.phase='waiting';changed(c);return snapshot(w);
     }
     intake.phase='submitted';changed(c);
     if(c.pending.taskId)await poll(w);else await send(c,c.pending);
     if(c.pending || c.diagnosticIntake!==intake)return snapshot(w);
    }
    if(intake.operation_id && !c.pending){
     intake.phase='error';intake.error='Reopen the retained original task to resolve its returned diagnostic result.';changed(c);return snapshot(w);
    }
    intake.phase='receiving';changed(c);
    const pinned=intake.session_id&&intake.evidence_id&&intake.report_dataset_id&&intake.report_dataset_id!==intake.dataset_id?intake.source_sha256:null;
    const report=await diagnostic(intake.diagnostic_id,w,pinned);
    if(c.diagnosticIntake!==intake)return snapshot(w);
    const source=report._investigation.source_sha256;
    if((intake.report_sha256 && source!==intake.report_sha256)||(intake.source_sha256 && source!==intake.source_sha256))
     throw Error('The saved report has a different source edition from this investigation request.');
    intake.source_sha256=source;
    if(!intake.session_id || !intake.evidence_id){
     await queue('intelligence.diagnostic.open',{diagnostic_id:intake.diagnostic_id,dataset_id:intake.dataset_id,title:intake.title,report_sha256:source},w);
     if(c.pending || c.diagnosticIntake!==intake)return snapshot(w);
     if(!intake.session_id || !intake.evidence_id)throw Error('The original task has not returned its saved investigation and evidence.');
    }
    const currentSelection=c.sessionId;
    if(currentSelection && currentSelection!==intake.origin_session_id && currentSelection!==intake.session_id){
     intake.phase='ready';changed(c);return snapshot(w);
    }
    if(c.sessionId!==intake.session_id || !c.session)await session(intake.session_id,w);
    if(c.diagnosticIntake!==intake)return snapshot(w);
    const item=c.evidence?.id===intake.evidence_id?c.evidence:await evidence(intake.evidence_id,w,intake.session_id);
    if(!matchesDiagnosticEvidence(item,intake))throw Error('The retained evidence does not match this complete saved report.');
    intake.phase='ready';changed(c);return snapshot(w);
   }catch(error){
    if(c.diagnosticIntake===intake){intake.phase='error';intake.error=error.message;changed(c);}
    throw error;
   }
  };
  const row={intake,promise:null};row.promise=run().finally(()=>{if(diagnosticFlights.get(w)===row)diagnosticFlights.delete(w);});
  diagnosticFlights.set(w,row);return row.promise;
 }
 async function openForDiagnostic(value){
  const selection=diagnosticSelection(value),w=selection.workspace_key;
  if(w!==getWorkspace())throw Error('Reopen this diagnostic in its original selected workspace.');
  const c=context(w),prior=c.diagnosticIntake;
  const same=prior?.diagnostic_id===selection.diagnostic_id && prior.dataset_id===selection.dataset_id &&
   (!selection.report_sha256 || selection.report_sha256===(prior.report_sha256||prior.source_sha256));
  if(!same && prior?.operation_id && c.pending?.body.operation_id===prior.operation_id)
   throw Error('The earlier saved diagnostic is still opening. Its original operation is retained below.');
  c.diagnosticIntake=same?Object.assign(prior,selection,{origin_session_id:c.sessionId,error:null}):
   {...selection,origin_session_id:c.sessionId,phase:'staged',error:null};
  changed(c);return resumeDiagnostic(w);
 }

 function clearFinished(){
  const c=context(getWorkspace()),p=c.pending;
  if(!p || !['failed','interrupted','canceled','cancelled'].includes(p.taskState))
   throw Error('Keep the current original operation until its status is known.');
  if(c.diagnosticIntake?.operation_id===p.body.operation_id){Object.assign(c.diagnosticIntake,{operation_id:null,phase:'staged',error:null});}
  c.pending=null;changed(c);
 }
 return {snapshot,catalog,session,evidence,exported,collectionSources,collection,experiment,nativeTask,trackExperimentSubmission,pollExperimentSubmission,selectSubmittedExperiment,clearExperimentSubmission,selectSources,clearSourceSelection,exportCollection,refresh,queue,retry,poll,clearFinished,openForDiagnostic,resumeDiagnostic,diagnostic,
  saveDraft(draft,w=getWorkspace()){const c=context(w);c.draft=clone(draft);persist(c);},
  async acceptState(state){
   const c=context(workspaceId(state));
   if(c.pending?.taskId){const t=state.tasks?.find(x=>x.id===c.pending.taskId);
    if(t && t.state!==c.pending.taskState)await poll(c.workspace);}
   if(c.diagnosticIntake && !c.pending && ['staged','waiting','submitted','received','receiving'].includes(c.diagnosticIntake.phase))await resumeDiagnostic(c.workspace);
   const submission=c.experimentSubmission;
   if(submission){const task=state.tasks?.find(x=>x.id===submission.taskId);
    if(task&&task.state!==submission.taskState)await pollExperimentSubmission(c.workspace);}
  },
  requireSession(){const id=context(getWorkspace()).sessionId;if(!id)throw Error('Create or reopen an investigation first.');return id;}
 };
}


const resourceLabel=row=>row?.label||row?.title||row?.name||row?.id||'Original resource';
const displayNumber=value=>value==null?'—':typeof value==='number'?new Intl.NumberFormat('en-US',{maximumSignificantDigits:8}).format(value):String(value);
const displayTime=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?String(value):d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};
export function attachInvestigations(host) {
 const doc=host.document||globalThis.document;
 let root=null,epoch=0,workspace=null,panel='analyze',selected=null,files=[],latest=null,draft={fields:{}},lastSession='',lastCatalog='',lastPending='',lastEvidence='',lastFiles='',lastSources='',lastDiagnostic='',lastProgramme='',lastNativeTask='',lastSubmission='',refreshInFlight=null;
 const nodes={};
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const clear=n=>n.replaceChildren();
 const button=(label,fn,cls='')=>{const b=el('button',label,cls);b.type='button';b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();
  const generation=epoch,owner=workspace;Promise.resolve().then(()=>{if(root&&epoch===generation&&workspace===owner)return fn();})
   .catch(error=>{if(root&&epoch===generation&&workspace===owner)failure(error);});});return b;};
 const notice=message=>{if(nodes.notice)nodes.notice.textContent=message;host.toast?.(message);};
 const failure=error=>notice(error?.message||String(error));
 const client=createInvestigationClient({api:host.api,getWorkspace:()=>workspaceId(host.getState()),storage:host.storage,
  randomUUID:host.randomUUID,onNotice:notice,onChange:state=>{latest=state;if(root && state.workspace===workspace)renderData(state);}});
 const field=(label,id,type='input',value='')=>{const wrap=el('label',label),n=el(type);nodes[id]=n;n.dataset.intelligenceField=id;
  if(type==='input')n.type='text';if(type==='textarea')n.rows=4;n.value=draft.fields?.[id]??value;wrap.append(n);return wrap;};
 const section=(name,title)=>{const node=el('section',null,'intelligence-panel');node.id='intelligence-panel-'+name;node.dataset.panel=name;
  node.setAttribute('role','tabpanel');node.append(el('h2',title));nodes[name]=node;return node;};
 function selectOptions(select,items,value){
  const wanted=value??draft.fields?.[select.dataset.intelligenceField]??select.value;select.replaceChildren();
  for(const row of items){const o=el('option',row.label);o.value=row.value;select.append(o);}
  if(items.some(row=>row.value===wanted))select.value=wanted;
 }
 function remember(){
  if(!workspace)return;draft.panel=panel;draft.selected=clone(selected);client.saveDraft(draft,workspace);
 }
 function rememberField(event){
  const target=event.target,id=target?.dataset?.intelligenceField;
  if(id && id!=='sessions'){draft.fields||={};draft.fields[id]=target.value;}
  if(target?.type==='checkbox' && nodes.collection.contains(target))draft.collection=[...nodes.collection.querySelectorAll('input')].filter(n=>n.checked).map(n=>n.value);
  remember();
 }
 function show(name){
  panel=['analyze','assistant','actions','sources','history'].includes(name)?name:'analyze';
  for(const n of ['analyze','assistant','actions','sources','history']){nodes[n].hidden=n!==panel;nodes['tab-'+n].setAttribute('aria-selected',String(n===panel));}
  remember();
 }
 function details(label,value){
  const d=el('details'),p=el('pre',JSON.stringify(value,null,2));d.append(el('summary',label),p);return d;
 }
 function dataTable(headers,rows){
  const scroll=el('div',null,'intelligence-table-scroll'),table=el('table'),thead=el('thead'),tr=el('tr');
  for(const h of headers)tr.append(el('th',h));thead.append(tr);table.append(thead);
  const tbody=el('tbody');for(const row of rows){const tr=el('tr');for(const v of row)tr.append(el('td',displayNumber(v)));tbody.append(tr);}
  table.append(tbody);scroll.append(table);return scroll;
 }
 function metrics(values){
  const list=el('dl',null,'intelligence-metrics');for(const [label,value]of values){const item=el('div');item.append(el('dt',label),el('dd',displayNumber(value)));list.append(item);}return list;
 }
 function fileRef(value){try{return JSON.parse(value);}catch{throw Error('Choose an original registered file.');}}
 function rebuildFiles(state){
  const m=new Map();for(const source of state.sourceCatalog?.sources||[])m.set(json(source.ref),{ref:source.ref,label:source.label});
  for(const d of state.catalog?.inventory?.datasets||[])m.set(json({kind:'dataset',id:d.id}),{ref:{kind:'dataset',id:d.id},label:resourceLabel(d)});
  for(const evidence of state.session?.evidence||[]){const result=evidence.result||{};
   if(result.job)for(const f of result.files||[]){const ref={kind:'artifact',id:f.id||result.job.id,member:f.member};m.set(json(ref),{ref,label:resourceLabel(result.job)+' / '+f.member});}}
  files=[...m.values()];
  const stamp=stable(files);if(stamp!==lastFiles){
   lastFiles=stamp;const checked=new Set(draft.collection||[]);clear(nodes.collection);
   for(const f of files){const label=el('label'),input=el('input');input.type='checkbox';input.value=json(f.ref);input.checked=checked.has(input.value);
    label.append(input,el('span',f.label));nodes.collection.append(label);}
  }
  for(const name of ['baseline','candidate','observed','predicted']){
   if(nodes[name])selectOptions(nodes[name],[{value:'',label:'Choose a registered file'},...files.map(f=>({value:json(f.ref),label:f.label}))]);
  }
 }
 function renderResources(state){
  clear(nodes.resources);const term=(nodes.filter.value||'').toLowerCase(),inventory=state.catalog?.inventory||{};
  for(const [kind,name]of [['dataset','datasets'],['job','jobs'],['ensemble','ensembles']]){
   nodes.resources.append(el('h3',kind==='dataset'?'Original data':kind==='job'?'Native model runs':'Saved ensembles'));
   const rows=inventory[name]||[];let count=0;
   for(const row of rows){if(term&&!json(row).toLowerCase().includes(term))continue;count++;
    const b=button('',()=>{selected={kind,id:row.id};nodes.selection.textContent=resourceLabel(row);remember();renderResources(state);});
    b.className='intelligence-resource';b.setAttribute('aria-pressed',String(selected?.kind===kind&&selected?.id===row.id));
    b.append(el('strong',resourceLabel(row)),el('small',[row.model||row.kind, row.status||row.state].filter(Boolean).join(' · ')||row.id));
    nodes.resources.append(b);
   }
   if(!count)nodes.resources.append(el('p',term?'No matching resources.':'No registered '+name+'.','intelligence-muted'));
  }
  if(selected){const name={dataset:'datasets',job:'jobs',ensemble:'ensembles'}[selected.kind],row=(inventory[name]||[]).find(x=>x.id===selected.id);
   if(row)nodes.selection.textContent=resourceLabel(row);
   else if(state.catalog){selected=null;nodes.selection.textContent='Choose a registered resource';remember();}
  }
 }
 function renderEvidence(evidence){
  clear(nodes.result);if(!evidence){nodes.result.append(el('p','Select an original resource, then inspect it.','intelligence-muted'));return;}
  const r=evidence.result||evidence;
  if(evidence.id)nodes.result.append(el('p',evidence.id,'intelligence-id'));
  if(r.format==='table'){
   nodes.result.append(metrics([['Rows analyzed',r.rows],['Columns',Object.keys(r.columns||{}).length],['Population',r.population]]));
   nodes.result.append(dataTable(['Column','Finite values','Missing','Other values','Minimum','Mean','Maximum'],
    Object.entries(r.columns||{}).map(([k,v])=>[k,v.numeric?.count,v.missing,v.non_numeric_or_nonfinite,v.numeric?.min,v.numeric?.mean,v.numeric?.max])));
  }else if(r.format==='raster'){
   nodes.result.append(metrics([['Width',r.width],['Height',r.height],['Coordinate system',r.crs]]));
   nodes.result.append(dataTable(['Band','Valid cells','Excluded cells','Minimum','Mean','Maximum','Unit'],
    (r.bands||[]).map(b=>[b.band,b.valid,b.excluded_masked_or_nonfinite,b.statistics?.min,b.statistics?.mean,b.statistics?.max,b.unit])));
  }else if(r.format==='raster_comparison'){
   nodes.result.append(metrics([['Paired cells',r.paired_cells],['Mean candidate − baseline',r.candidate_minus_baseline?.mean],
    ['Cell sum change (%)',r.relative_sum_change_percent],['Increased cells',r.increased],['Decreased cells',r.decreased],['Unchanged cells',r.unchanged]]));
  }else if(r.coverage){
   nodes.result.append(metrics([['Paired finite rows',r.coverage.paired_finite],['RMSE',r.rmse],['MAE',r.mae],['Nash–Sutcliffe efficiency',r.nse],['Predicted − observed bias (%)',r.pbias_percent]]));
   nodes.result.append(dataTable(['Coverage','Count'],Object.entries(r.coverage).map(([k,v])=>[k.replaceAll('_',' '),v])));
  }else if(r.job){
   nodes.result.append(metrics([['Native status',r.job.status||r.job.state],['Model',r.job.model],['Registered outputs',(r.files||[]).length]]));
   if(originalId(r.job.id))nodes.result.append(button('Open original model run',()=>host.openItem('runs',r.job.id)));
   for(const f of r.files||[]){const ref={kind:'artifact',id:f.id||r.job.id,member:f.member};
    nodes.result.append(button(f.member+' · '+displayNumber(f.bytes)+' bytes',()=>inspect({operation:'profile',ref}),'intelligence-resource'));}
  }else if(r.counts)nodes.result.append(metrics(Object.entries(r.counts)));
  if(r.interpretation||r.unit_note)nodes.result.append(el('p',r.interpretation||r.unit_note,'intelligence-muted'));
  const provenance=evidence.sources||[];if(provenance.length)nodes.result.append(details('Original sources and full content identities',provenance));
  nodes.result.append(details('Complete retained result',evidence));
 }
 function diagnosticContext(state){
  if(state.pending?.body.action==='intelligence.diagnostic.open')return null;
  const events=state.session?.events||[];
  const context=events.find(event=>event.kind==='diagnostic_context')?.body;
  if(!context || !originalId(context.diagnostic_id) || !originalId(context.source_sha256) ||
      context.report_dataset_id!=='es26:'+context.diagnostic_id+':report_revision_'+context.source_sha256)return null;
  const evidence=(state.session?.evidence||[]).find(row=>row.id===context.evidence_id);
  if(!evidence || !(evidence.sources||[]).some(source=>source.ref?.id===context.report_dataset_id &&
      source.sha256===context.source_sha256))return null;
  return {...context,session_id:state.sessionId};
 }
 function renderDiagnosticContext(state){
  const target=nodes.diagnosticContext;if(!target)return;
  clear(target);const context=diagnosticContext(state);
  if(context){
   target.hidden=false;target.append(el('h3','Attached scientific analysis'),el('p',context.title||'Saved analysis'));
   target.append(el('p','The question uses this retained report revision and its saved evidence.','intelligence-muted'),
    details('Analysis source and revision',{diagnostic_id:context.diagnostic_id,dataset_id:context.dataset_id,
     report_dataset_id:context.report_dataset_id,report_sha256:context.source_sha256,evidence_id:context.evidence_id,session_id:context.session_id}));
  }else if(state.pending?.body.action==='intelligence.diagnostic.open'){
   target.hidden=false;target.append(el('h3','Opening saved scientific analysis'),
    el('p',state.pending.body.payload.title||'Saved analysis','intelligence-muted'));
  }else target.hidden=true;
 }
 async function openForDiagnostic(selection){
  const owner=workspaceId(host.getState());
  if(!owner||selection?.workspace_key!==owner)throw Error('Open this diagnostic in its original selected workspace.');
  if(typeof host.navigate!=='function')throw Error('The registered original workbench navigation is required.');
  await host.navigate('investigations');
  if(workspaceId(host.getState())!==owner)throw Error('The selected workspace changed while opening the diagnostic.');
  const opening=client.openForDiagnostic(selection);
  if(root&&workspace===owner){
   selected={kind:'dataset',id:selection.dataset_id};draft.selected=clone(selected);show('analyze');remember();
  }
  const result=await opening;
  if(root&&workspace===owner){renderData(client.snapshot(owner));show('analyze');}
  return result;
 }

 async function inspect(request){
  const sid=client.requireSession();show('analyze');
  await client.queue('intelligence.inspect',{session_id:sid,request});
 }
 function renderActionFields(state){
  const methods=state.catalog?.native_methods||{},actions=state.catalog?.actions||['analyze_collection'];
  selectOptions(nodes.actionKind,actions.map(value=>({value,label:{
   analyze_collection:'Profile a selected original collection',run_job:'Run an existing prepared native job',
   ensemble:state.catalog?.native_experiments?'Run a saved native programme':'Run a parameter ensemble',calibration:methods.calibration||'Paired calibration'}[value]||value})));
  const kind=nodes.actionKind.value;
  nodes.collectionFields.hidden=kind!=='analyze_collection';
  const native=!!state.catalog?.native_experiments;
  nodes.ensembleSource.hidden=kind!=='ensemble'||!native;
  const saved=kind==='ensemble'&&native;
  if(native)selectOptions(nodes.ensembleMode,[{value:'saved',label:'Saved native programme'}],'saved');
  nodes.nativeProgrammeFields.hidden=!saved;
  nodes.jobFields.hidden=!['run_job','ensemble'].includes(kind)||saved;
  nodes.calibrationFields.hidden=kind!=='calibration';
  nodes.ensembleFields.hidden=kind!=='ensemble'||saved;
  const programmes=(state.catalog?.inventory?.ensembles||[]).filter(row=>row.metadata?.native_kind==='scenario_experiment');
  selectOptions(nodes.nativeProgramme,[{value:'',label:'Choose a saved native programme'},
   ...programmes.map(row=>({value:row.id,label:(row.title||row.label||row.id)+' · '+(row.status||'retained')+' · '+displayNumber(row.counts?.cases??row.metadata?.resolved_native_plan?.counts?.cases)+' cases'}))]);
  nodes.method.textContent=kind==='analyze_collection'?'Each selected registered file is analyzed in full.':methods[kind]||'Uses the connected original service.';
  selectOptions(nodes.job,[{value:'',label:'Choose a retained native job'},...(state.catalog?.inventory?.jobs||[]).map(j=>({value:j.id,label:resourceLabel(j)+' · '+(j.status||j.state)}))]);
 }
 async function designNativeProgramme(){
  const owner=workspaceId(host.getState()),sid=client.requireSession(),state=client.snapshot();
  if(!state.catalog?.native_experiments)throw Error('The original native programme designer is unavailable in this workspace.');
  const openProgramme=typeof host.openNativeProgramme==='function'?host.openNativeProgramme:
   typeof host.openExtension==='function'?options=>host.openExtension('experiments','openForInvestigation',options):null;
  if(!openProgramme)throw Error('Install the maintained original programme designer.');
  const prior=state.experimentSubmission;
  if(prior&&!['complete','failed','interrupted','canceled','cancelled'].includes(prior.taskState))
   throw Error('The retained programme task is still active. Open its original task before starting another from this panel.');
  remember();
  await openProgramme({workspace_key:owner,onSubmitted:async task=>{
   const generation=epoch;
   const current=()=>epoch===generation&&workspaceId(host.getState())===owner&&client.snapshot().sessionId===sid;
   await client.trackExperimentSubmission(task,sid,owner);
   if(!['complete','failed','interrupted','canceled','cancelled'].includes(task.state))await client.pollExperimentSubmission(owner);
   if(current()){
    await host.navigate('investigations');
    if(root&&workspace===owner&&client.snapshot().sessionId===sid){draft=clone(client.snapshot().draft||{fields:{}});show('actions');}
   }
  }});
 }
 async function prepare(){
  const sid=client.requireSession(),kind=nodes.actionKind.value,action={kind};
  if(kind==='analyze_collection'){
   const checked=[...nodes.collection.querySelectorAll('input')].filter(n=>n.checked);
   if(!checked.length)throw Error('Select at least one registered file.');
   action.refs=checked.map(n=>fileRef(n.value));
  }else if(kind==='calibration'){
   Object.assign(action,{observed:fileRef(nodes.observed.value),predicted:fileRef(nodes.predicted.value),time_column:nodes.time.value.trim(),
    observed_column:nodes.observedColumn.value.trim(),predicted_column:nodes.predictedColumn.value.trim(),
    observed_unit:nodes.unit.value.trim(),predicted_unit:nodes.unit.value.trim(),holdout_fraction:Number(nodes.holdout.value)});
  }else if(kind==='ensemble'&&latest?.catalog?.native_experiments){
   if(!originalId(nodes.nativeProgramme.value))throw Error('Choose a saved original native programme.');
   action.native_experiment_id=nodes.nativeProgramme.value;
   action.retain_member_rasters=true;
  }else {if(!nodes.job.value)throw Error('Choose an original native job.');action.job_id=nodes.job.value;
   if(kind==='ensemble'){action.parameter_grid=JSON.parse(nodes.grid.value);action.max_members=Number(nodes.members.value);}}
  await client.queue('intelligence.prepare',{session_id:sid,action});
 }
 function renderPlans(state){
  clear(nodes.plans);const plans=state.session?.plans||[];
  if(!plans.length)nodes.plans.append(el('p','Prepared actions appear here with their original inputs.','intelligence-muted'));
  for(const p of plans){
   const article=el('article',null,'intelligence-plan');
   article.append(el('h3',(p.body?.action?.kind||'Guided action').replaceAll('_',' ')),el('p',p.status==='complete'?'Result retained':p.status,'intelligence-status'));
   if(p.body?.context?.method)article.append(el('p',p.body.context.method));
   article.append(el('p',p.id,'intelligence-id'),details('Complete prepared selection and source identities',p.body));
   const links=p._native_tasks||[];
   for(const task of links){const group=el('div',null,'intelligence-inline');
    group.append(el('span',(task.action||'Original task')+' · '+task.state),button('Inspect retained task',()=>client.nativeTask(task.id)));
    if(task.open_task===true || (task.open_task===undefined&&!task._intelligence_origin))group.append(button('Open live operator task',()=>host.showTask(task.id)));
    if(task.experiment_id)group.append(button('Open saved programme',()=>client.experiment(task.experiment_id)));
    if(task.run_id)group.append(button('Open native outputs',()=>host.openItem('runs',task.run_id)));article.append(group);}
   if(p.status==='ready')article.append(button('Execute original action',()=>client.queue('intelligence.execute',{plan_id:p.id})));
   else if(p._can_continue_submission)article.append(button('Continue original submission',()=>client.queue('intelligence.continue',{plan_id:p.id})));
   if(p.result)article.append(details('Retained action result',p.result));nodes.plans.append(article);
  }
 }
 function renderDesignerSubmission(state){
  const target=nodes.designerSubmission,submission=state.experimentSubmission;clear(target);target.hidden=!submission;
  if(!submission)return;
  target.append(el('h3',submission.body.payload.selection.title||'Original programme submission'),
   el('p',submission.taskState||'Retained','intelligence-status'));
  target.append(el('p',submission.experimentId?'The original task retained this saved programme.':'The original operator is preparing the selected native programme.','intelligence-muted'));
  const controls=el('div',null,'intelligence-inline');
  controls.append(button('Open original task',()=>host.showTask(submission.taskId)),
   button('Refresh task status',()=>client.pollExperimentSubmission()));
  if(submission.experimentId)controls.append(button(state.sessionId===submission.sessionId?'Select this programme':'Use in its original investigation',async()=>{
   await client.selectSubmittedExperiment();draft=clone(client.snapshot().draft||{fields:{}});
   selected=clone(draft.selected||null);if(latest){renderActionFields(latest);renderResources(latest);}show('actions');
  }));
  if(['complete','failed','interrupted','canceled','cancelled'].includes(submission.taskState))
   controls.append(button('Clear task display',()=>client.clearExperimentSubmission()));
  target.append(controls);
  if(submission.error)target.append(el('p',submission.error,'intelligence-notice'));
  target.append(details('Original design submission and task identity',{
   task_id:submission.taskId,session_id:submission.sessionId,experiment_id:submission.experimentId,
   operation_id:submission.body.operation_id,action:submission.body.action,selection:submission.body.payload.selection
  }));
 }
 function renderProgramme(state){
  const target=nodes.programmeResults;clear(target);target.hidden=!state.experimentId;
  if(!state.experimentId)return;
  const value=state.experiment;
  if(!value){target.append(el('h3','Reading saved programme'),el('p',state.experimentId,'intelligence-id'));return;}
  target.append(el('h3',value.title||'Saved native programme'),
   el('p',(typeof value.state==='string'?value.state:value.state?.state)||'Retained','intelligence-status'));
  const counts=value.counts_exact||value.counts||{},progress=value.progress_exact||value.progress||{};
  target.append(metrics([['Cases',value.total_cases_exact??value.total_cases??counts.cases],
   ['Complete',progress.complete],['Failed',progress.failed],['Pending',progress.pending],
   ['Native models',(value.models||[]).join(', ')||'Declared in the original plan']]));
  const controls=el('div',null,'intelligence-inline');
  controls.append(button('Refresh programme',()=>client.experiment(state.experimentId,state.experimentOffset)),
   button('Analyze programme in this investigation',()=>inspect({operation:'ensemble',object_id:state.experimentId})));
  const offset=value.offset??state.experimentOffset,limit=value.limit??100;
  if(Number.isSafeInteger(offset)&&offset>0)controls.append(button('Previous cases',()=>client.experiment(state.experimentId,Math.max(0,offset-limit))));
  if(Number.isSafeInteger(value.next_offset))controls.append(button('Next cases',()=>client.experiment(state.experimentId,value.next_offset)));
  target.append(controls,el('p','Case offset '+displayNumber(value.offset_exact??offset)+' · '+displayNumber((value.cases||[]).length)+' cases on this page','intelligence-muted'));
  if(value.study_report)target.append(el('p','Programme summary: '+value.study_report.state+' · '+displayTime(value.study_report.generated_at),'intelligence-muted'));
  for(const item of value.cases||[]){
   const card=el('article',null,'intelligence-plan'),execution=value.native_execution_by_case?.[item.id];
   card.append(el('h4',(item.profile_title||item.profile_id||'Profile')+' / '+(item.scenario_title||item.scenario_id||'Scenario')),
    el('p',[item.kind,item.state,execution?.state].filter(Boolean).join(' · '),'intelligence-status'));
   const results=Object.entries(item.metrics||{});
   if(results.length)card.append(dataTable(['Output','Annual unit','Baseline','Alternative','Alternative − baseline','Reduction','Change (%)','Paired cells','Coverage'],
    results.map(([name,m])=>[name,m.units,m.baseline_total,m.alternative_total,m.delta,m.reduction,m.relative_change_pct,m.paired_cells,m.coverage_fraction])));
   else card.append(el('p','No retained metrics for this case on the original programme record.','intelligence-muted'));
   if(originalId(item.run_id)&&execution?.state!=='unprepared')
    card.append(button('Open native run',()=>host.openItem('runs',item.run_id)));
   if((execution?.stages||[]).length)card.append(dataTable(['Native model','Execution','Source run'],
    execution.stages.map(stage=>[stage.model,stage.mode,stage.source_run_id||'This run'])));
   card.append(details('Original case and native execution',{case:item,native_execution:execution||null}));target.append(card);
  }
  if(!(value.cases||[]).length)target.append(el('p','No cases are retained on this page.','intelligence-muted'));
  for(const file of Array.isArray(value._downloads)?value._downloads:[]){
   const link=downloadLink(file);if(link)target.append(link);
  }
  target.append(el('p','Reduction is baseline minus alternative. Displayed rows retain each output’s units and common-support coverage. Only the selected native model outputs are shown.','intelligence-muted'),
   details('Complete retained programme page',value));
 }
 function renderNativeTask(state){
  const target=nodes.nativeTask;clear(target);target.hidden=!state.nativeTask;
  if(!state.nativeTask)return;
  const value=state.nativeTask,task=value.task||{};
  target.append(el('h3','Original native task'),el('p',(task.action||'Native operation')+' · '+(task.state||'Retained'),'intelligence-status'),
   metrics([['Created',displayTime(task.created_at)],['Started',displayTime(task.started_at)],['Completed',displayTime(task.completed_at)]]));
  if(value.origin==='retained_snapshot')target.append(el('p','This task was retained with the original project and reopened from its saved receipt.','intelligence-muted'));
  else if(originalId(task.id))target.append(button('Open live operator task',()=>host.showTask(task.id)));
  if(originalId(value.run_id))target.append(button('Open native outputs',()=>host.openItem('runs',value.run_id)));
  if(originalId(value.experiment_id))target.append(button('Open saved programme',()=>client.experiment(value.experiment_id)));
  if(task.error)target.append(el('p',task.error.message||String(task.error),'intelligence-notice'));
  target.append(details('Complete retained task',value));
 }
 function renderSession(state){
  const s=state.session;clear(nodes.evidence);clear(nodes.conversation);clear(nodes.history);clear(nodes.exports);
  nodes.current.textContent=s?.title||'Choose or create an investigation';
  nodes.sessionMeta.textContent=s?'Created '+displayTime(s.created)+' · '+s.id:'Saved investigations remain with this scientific workspace.';
  for(const e of s?.evidence||[]){
   const b=button('',async()=>{const owner=workspace,sid=state.sessionId;await client.evidence(e.id,owner,sid);if(root&&workspace===owner)show('analyze');},'intelligence-resource');
   b.append(el('strong',(e.operation?.operation||e.operation?.kind||'Analysis').replaceAll('_',' ')),el('small',displayTime(e.created)),el('small',e.id));
   nodes.evidence.append(b);
  }
  for(const e of s?.events||[]){
   if(['question','answer','request_error'].includes(e.kind)){
    const article=el('article',null,'intelligence-message');article.append(el('h3',e.kind==='question'?'Question':e.kind==='answer'?'Answer':'Provider result'));
    article.append(el('p',e.body?.text||e.body?.error||'', 'intelligence-prose'));nodes.conversation.append(article);
   }
   const item=el('li');item.append(el('strong',e.kind.replaceAll('_',' ')),el('span',displayTime(e.created)),details('Original event',e.body));nodes.history.append(item);
  }
  renderPlans(state);
  const exports=state.exported?[state.exported]:(s?._exports||[]);
  for(const record of exports){
   const article=el('article',null,'intelligence-export');article.append(el('h3',record.title||'Investigation export'),el('p',displayTime(record.created_at)));
   if(record.files)for(const f of record.files){
    if(!/^\/api\/file\/[0-9a-f]{64}(?:\?.*)?$/.test(f.url||''))continue;
    const a=el('a',f.label||f.filename||f.format);a.href=f.url+(f.url.includes('?')?'&':'?')+'download=1';a.setAttribute('download','');
    article.append(a,el('small',displayNumber(f.bytes)+' bytes · SHA-256 '+f.sha256));
   }
   else article.append(button('Reopen verified download links',()=>client.exported(record.id)));
   nodes.exports.append(article);
  }
 }
 function downloadLink(file,label){
  if(!/^\/api\/file\/[0-9a-f]{64}(?:\?.*)?$/.test(file?.url||''))return null;
  const link=el('a',label||file.label||file.filename);link.href=file.url+(file.url.includes('?')?'&':'?')+'download=1';link.setAttribute('download','');
  return link;
 }
 function renderSourceChoices(state){
  const owner=workspace,generation=epoch;
  const term=(nodes.sourceFilter.value||'').toLowerCase(),chosen=new Set((state.sourceSelection||[]).map(stable));
  const sources=state.sourceCatalog?.sources||[],known=new Set(sources.map(row=>stable(row.ref)));
  clear(nodes.sourceChoices);
  let shown=0;
  for(const source of sources){
   if(term&&!json([source.label,source.filename,source.ref,source.units]).toLowerCase().includes(term))continue;
   shown++;
   const label=el('label',null,'intelligence-source-choice'),input=el('input'),body=el('span');
   input.type='checkbox';input.value=json(source.ref);input.checked=chosen.has(stable(source.ref));
   input.addEventListener('change',()=>{if(!root||workspace!==owner||epoch!==generation)return;const focus=doc.activeElement===input;client.selectSources([source.ref],input.checked);if(focus)[...nodes.sourceChoices.querySelectorAll('input')].find(node=>node.value===input.value)?.focus({preventScroll:true});});
   body.append(el('strong',source.label),el('small',[source.ref.kind==='artifact'?'Native output':'Original data',source.units==null?'Units not declared':String(source.units),source.bytes==null?null:displayNumber(source.bytes)+' bytes'].filter(Boolean).join(' · ')));
   label.append(input,body);nodes.sourceChoices.append(label);
  }
  for(const ref of state.sourceSelection||[]){
   if(known.has(stable(ref)))continue;
   const label=el('label',null,'intelligence-source-choice'),input=el('input');input.type='checkbox';input.checked=true;
   input.addEventListener('change',()=>{if(root&&workspace===owner&&epoch===generation)client.selectSources([ref],false);});
   label.append(input,el('span','Selected file is no longer registered: '+ref.id+(ref.member?' / '+ref.member:'')));
   nodes.sourceChoices.append(label);
  }
  if(!shown)nodes.sourceChoices.append(el('p',state.sourceCatalog?(term?'No original files match this filter.':'No source files are registered in this workspace.'):'Reading the registered original files…','intelligence-muted'));
  const missing=(state.sourceSelection||[]).filter(ref=>!known.has(stable(ref))).length;
  nodes.sourceCount.textContent=chosen.size+' selected · '+sources.length+' registered files'+(missing?' · '+missing+' selected files need review':'');
 }
 function renderCollections(state){
  clear(nodes.sourceExports);
  const rows=[...(state.session?._source_collections||[])];
  if(state.collection){const at=rows.findIndex(row=>row.id===state.collection.id);if(at>=0)rows[at]=state.collection;else rows.push(state.collection);}
  if(!rows.length)nodes.sourceExports.append(el('p','Exported source collections remain with this investigation and can be reopened here.','intelligence-muted'));
  for(const record of rows){
   const article=el('article',null,'intelligence-export');article.append(el('h3',record.title),el('p',displayTime(record.created_at)));
   article.append(metrics([['Selected records',record.selected_records],['Files with companions',record.copied_files],['Original bytes',record.copied_bytes]]));
   if(record.files){
    for(const file of record.files){const link=downloadLink(file);if(link)article.append(link,el('small',displayNumber(file.bytes)+' bytes · SHA-256 '+file.sha256));}
    const list=el('div',null,'intelligence-retained-sources');
    for(const source of record.sources||[]){
     const row=el('div',null,'intelligence-retained-source'),link=downloadLink(source.download,source.filename);
     row.append(el('strong',source.label));if(link)row.append(link);
     row.append(el('small',(source.units==null?'Units not declared':String(source.units))+' · '+displayNumber(source.bytes)+' bytes'),el('small','SHA-256 '+source.sha256));
     list.append(row);
    }article.append(list);
   }else article.append(button('Reopen source collection',()=>client.collection(record.id)));
   article.append(el('small','Catalog SHA-256 '+record.catalog_sha256));nodes.sourceExports.append(article);
  }
 }
 function renderPending(state){
  clear(nodes.pending);const p=state.pending;
  if(!p){if(state.lastTask)nodes.pending.append(button('Open last original operation',()=>host.showTask(state.lastTask.id)));return;}
  nodes.pending.append(el('strong',actionNames[p.body.action]||p.body.action),el('p',p.taskState||'Sending original request'),
   el('p',p.body.operation_id,'intelligence-id'));
  if(p.joinedExistingTask)nodes.pending.append(el('p','Joined original task operation: '+p.acceptedOperationId,'intelligence-id'));
  if(p.error)nodes.pending.append(el('p',p.error,'intelligence-error'));
  if(p.taskId)nodes.pending.append(button('Open original operation',()=>host.showTask(p.taskId)),button('Refresh retained status',()=>client.poll()));
  else nodes.pending.append(button('Retry this original request',()=>client.retry()));
  if(['failed','interrupted','canceled','cancelled'].includes(p.taskState))nodes.pending.append(button('Keep result and start another operation',()=>client.clearFinished()));
 }
 function renderDiagnostic(state){
  clear(nodes.diagnostic);const intake=state.diagnosticIntake;nodes.diagnostic.hidden=!intake;if(!intake)return;
  const phases={staged:'Ready to open saved diagnostic',receiving:'Reading saved scientific interpretation',
   submitted:'Opening through the original investigation queue',waiting:'The current investigation operation is retained below',
   received:'Opening retained evidence',ready:'Saved diagnostic linked to its investigation',error:'Saved diagnostic needs attention'};
  nodes.diagnostic.append(el('h2',intake.title||'Saved scientific interpretation'),
   el('p',phases[intake.phase]||'Saved scientific interpretation','intelligence-status'));
  if(intake.error)nodes.diagnostic.append(el('p',intake.error,'intelligence-error'));
  const actions=el('div',null,'intelligence-inline');
  if(intake.session_id&&intake.evidence_id)actions.append(button('Open saved investigation',()=>openForDiagnostic(intake)));
  else actions.append(button('Continue opening this diagnostic',()=>client.resumeDiagnostic(intake.workspace_key)));
  nodes.diagnostic.append(actions);
  const report=state.diagnosticReport;
  if(report){
   nodes.diagnostic.append(details('Complete saved scientific report',report));
   const downloads=el('div',null,'intelligence-export');
   for(const file of report._downloads||[]){
    if(!/^\/api\/file\/[0-9a-f]{64}(?:\?.*)?$/.test(file.url||''))continue;
    const link=el('a',file.label||file.filename||file.artifact_key||'Original report');
    link.href=file.url+(file.url.includes('?')?'&':'?')+'download=1';link.setAttribute('download','');
    downloads.append(link,el('small',displayNumber(file.bytes)+' bytes · SHA-256 '+file.sha256));
   }
   nodes.diagnostic.append(downloads);
  }
  nodes.diagnostic.append(details('Original report and investigation identity',{
   workspace_key:intake.workspace_key,diagnostic_id:intake.diagnostic_id,dataset_id:intake.dataset_id,
   source_sha256:intake.source_sha256,report_dataset_id:intake.report_dataset_id,session_id:intake.session_id,evidence_id:intake.evidence_id,
   original_operation_id:intake.operation_id||intake.completed_operation_id
  }));
 }

 function renderData(state){
  if(!root)return;
  nodes.notice.textContent=state.error||'';
  nodes.workspace.textContent=host.getState()?.data?.project?.title||state.catalog?.project?.title||'Selected workspace';
  const cstamp=stable({inventory:state.catalog?.inventory,methods:state.catalog?.native_methods,actions:state.catalog?.actions,nativeExperiments:state.catalog?.native_experiments,sources:state.sourceCatalog});
  const sstamp=stable({session:state.session,exported:state.exported,collection:state.collection});
  if(cstamp!==lastCatalog){lastCatalog=cstamp;renderResources(state);rebuildFiles(state);renderActionFields(state);}
  selectOptions(nodes.sessions,[{value:'',label:'Choose a saved investigation'},...(state.catalog?.sessions||[]).map(s=>({value:s.id,label:s.title+' · '+displayTime(s.created)}))],state.sessionId);
  renderDiagnosticContext(state);
  const diagnosticStamp=stable({intake:state.diagnosticIntake,report:state.diagnosticReport});
  if(diagnosticStamp!==lastDiagnostic){lastDiagnostic=diagnosticStamp;renderDiagnostic(state);}
  nodes.provider.textContent=state.catalog?.provider_configured?'Configured model: '+state.catalog.provider_model:'Local analysis ready; configure an assistant model on the server to ask questions.';
  if(sstamp!==lastSession){lastSession=sstamp;renderSession(state);renderCollections(state);rebuildFiles(state);}
  const sourceStamp=stable({catalog:state.sourceCatalog,selection:state.sourceSelection});if(sourceStamp!==lastSources){lastSources=sourceStamp;renderSourceChoices(state);}
  const submissionStamp=stable(state.experimentSubmission);
  if(submissionStamp!==lastSubmission){
   lastSubmission=submissionStamp;
   const submission=state.experimentSubmission;
   if(submission?.experimentId&&state.sessionId===submission.sessionId&&state.draft?.fields?.nativeProgramme===submission.experimentId){
    draft=clone(state.draft);selected=clone(draft.selected||null);renderActionFields(state);renderResources(state);
   }
   renderDesignerSubmission(state);
  }
  const programmeStamp=stable({id:state.experimentId,offset:state.experimentOffset,value:state.experiment});
  if(programmeStamp!==lastProgramme){lastProgramme=programmeStamp;renderProgramme(state);}
  const nativeTaskStamp=stable(state.nativeTask);
  if(nativeTaskStamp!==lastNativeTask){lastNativeTask=nativeTaskStamp;renderNativeTask(state);}
  const estamp=stable(state.evidence);if(estamp!==lastEvidence){lastEvidence=estamp;renderEvidence(state.evidence);}
  const pstamp=stable(state.pending);if(pstamp!==lastPending){lastPending=pstamp;renderPending(state);}
  for(const n of root.querySelectorAll('[data-submit]'))n.disabled=!!state.pending||state.loading;
 }
 function build(){
  const desk=el('div',null,'intelligence-desk'),header=el('header',null,'intelligence-heading'),titles=el('div');
  desk.addEventListener('input',rememberField);desk.addEventListener('change',rememberField);
  nodes.workspace=el('p',null,'intelligence-eyebrow');nodes.current=el('h1','Investigations');nodes.sessionMeta=el('p',null,'intelligence-muted');
  titles.append(nodes.workspace,nodes.current,nodes.sessionMeta);header.append(titles,button('Refresh originals',()=>client.refresh()));desk.append(header);
  const controls=el('div',null,'intelligence-controls');controls.append(field('Saved investigation','sessions','select'));
  nodes.sessions.addEventListener('change',()=>client.session(nodes.sessions.value).catch(failure));
  controls.append(field('New investigation title','title','input',''));
  const create=button('Create investigation',()=>client.queue('intelligence.session.create',{title:nodes.title.value.trim()||'Watershed investigation'}));create.dataset.submit='true';controls.append(create);desk.append(controls);
  nodes.notice=el('p',null,'intelligence-notice');nodes.notice.setAttribute('role','status');nodes.notice.setAttribute('aria-live','polite');desk.append(nodes.notice);
  nodes.pending=el('section',null,'intelligence-pending');nodes.pending.setAttribute('aria-label','Current original operation');desk.append(nodes.pending);
  nodes.diagnostic=el('section',null,'intelligence-panel');nodes.diagnostic.setAttribute('aria-label','Saved scientific interpretation');desk.append(nodes.diagnostic);
  const layout=el('div',null,'intelligence-layout'),aside=el('aside'),main=el('div',null,'intelligence-main');
  aside.append(el('h2','Registered resources'),field('Find a resource','filter'));
  nodes.filter.addEventListener('input',()=>latest&&renderResources(latest));nodes.resources=el('div',null,'intelligence-resources');aside.append(nodes.resources,el('h2','Saved analyses'));nodes.evidence=el('div');aside.append(nodes.evidence);
  const tabs=el('div',null,'intelligence-tabs');tabs.setAttribute('role','tablist');
  for(const [id,title]of [['analyze','Data analysis'],['assistant','Assistant'],['actions','Guided actions'],['sources','Source collections'],['history','History and export']]){
   const b=button(title,()=>show(id));b.setAttribute('role','tab');b.setAttribute('aria-controls','intelligence-panel-'+id);nodes['tab-'+id]=b;tabs.append(b);}
  main.append(tabs);
  const analyze=section('analyze','Original data and native outputs');nodes.selection=el('h3','Choose a registered resource');
  const selectedRow=el('div',null,'intelligence-inline');const inspectButton=button('Inspect selected',()=>{
   if(!selected)throw Error('Choose a registered resource.');return inspect(selected.kind==='dataset'?{operation:'profile',ref:selected}:{operation:selected.kind,object_id:selected.id});});inspectButton.dataset.submit='true';
  const addSources=button('Add resource files to collection',()=>{
   if(!selected)throw Error('Choose an original dataset or native run.');
   const refs=(latest?.sourceCatalog?.sources||[]).filter(source=>selected.kind==='dataset'?source.ref.kind==='dataset'&&source.ref.id===selected.id:selected.kind==='job'&&source.ref.kind==='artifact'&&source.ref.id===selected.id).map(source=>source.ref);
   if(!refs.length)throw Error('This resource has no registered source files. Refresh the originals.');
   client.selectSources(refs);show('sources');
  });
  selectedRow.append(nodes.selection,inspectButton,addSources);analyze.append(selectedRow,el('p','Analysis covers the complete original file and retains its source identity, coverage and units.','intelligence-muted'));
  nodes.result=el('div');analyze.append(nodes.result);
  const compare=el('form',null,'intelligence-form');compare.append(el('h3','Compare original files'),field('Baseline / observed file','baseline','select'),field('Candidate / predicted file','candidate','select'),field('Comparison','comparison','select'));
  selectOptions(nodes.comparison,[{value:'raster_compare',label:'Aligned raster cells'},{value:'table_compare',label:'Exact-key observed / predicted rows'}]);
  nodes.tableFields=el('div',null,'intelligence-form-group');nodes.tableFields.append(field('Pairing columns, separated by commas','keys','input','date'),field('Observed column','compareObserved','input','observed_sediment'),field('Predicted column','comparePredicted','input','predicted_sediment'));
  compare.append(nodes.tableFields);nodes.comparison.addEventListener('change',()=>nodes.tableFields.hidden=nodes.comparison.value!=='table_compare');nodes.tableFields.hidden=nodes.comparison.value!=='table_compare';
  const runCompare=el('button','Compute full comparison');runCompare.type='submit';runCompare.dataset.submit='true';compare.append(runCompare);
  compare.addEventListener('submit',e=>{e.preventDefault();Promise.resolve().then(()=>{const request={operation:nodes.comparison.value,ref:fileRef(nodes.baseline.value),other:fileRef(nodes.candidate.value)};
   if(request.operation==='table_compare')Object.assign(request,{keys:nodes.keys.value.split(',').map(s=>s.trim()).filter(Boolean),observed_column:nodes.compareObserved.value.trim(),predicted_column:nodes.comparePredicted.value.trim()});
   return inspect(request);}).catch(failure);});analyze.append(compare);
  const assistant=section('assistant','Investigate the retained sources');nodes.provider=el('p',null,'intelligence-muted');nodes.diagnosticContext=el('section',null,'intelligence-diagnostic-context');nodes.diagnosticContext.hidden=true;nodes.conversation=el('div');assistant.append(nodes.provider,nodes.diagnosticContext,nodes.conversation);
  const ask=el('form',null,'intelligence-form');ask.append(field('Question','question','textarea'));const askButton=el('button','Investigate');askButton.type='submit';askButton.dataset.submit='true';ask.append(askButton);
  ask.addEventListener('submit',e=>{e.preventDefault();try{const sid=client.requireSession();let question=nodes.question.value.trim();if(!question)throw Error('Enter a question.');
   if(question.length>24000)throw Error('Shorten the question to fit the original investigation request.');
   client.queue('intelligence.ask',{session_id:sid,question}).catch(failure);}catch(error){failure(error);}});assistant.append(ask);
  const actions=section('actions','Guided original operations');actions.append(field('Operation','actionKind','select'));nodes.actionKind.addEventListener('change',()=>{rememberField({target:nodes.actionKind});if(latest)renderActionFields(latest);});
  nodes.method=el('p',null,'intelligence-muted');actions.append(nodes.method);
  nodes.collectionFields=el('div');nodes.collectionFields.append(el('h3','Files in this collection'));nodes.collection=el('div',null,'intelligence-checks');nodes.collectionFields.append(nodes.collection);
  nodes.jobFields=el('div',null,'intelligence-form-group');nodes.jobFields.append(field('Original prepared run','job','select'));
  nodes.calibrationFields=el('div',null,'intelligence-form-group');nodes.calibrationFields.append(field('Observed file','observed','select'),field('Predicted file','predicted','select'),
   field('ISO date / timestamp column','time','input','date'),field('Observed value column','observedColumn','input','observed_sediment'),field('Predicted value column','predictedColumn','input','predicted_sediment'),
   field('Same declared unit for both files','unit'),field('Chronological holdout fraction','holdout','input','0.25'));
  nodes.ensembleFields=el('div',null,'intelligence-form-group');nodes.ensembleFields.append(field('Native parameter grid (JSON)','grid','textarea','{}'),field('Requested member limit','members','input','64'));
  nodes.ensembleSource=el('div',null,'intelligence-form-group');
  nodes.ensembleSource.append(field('Ensemble source','ensembleMode','select','saved'));
  selectOptions(nodes.ensembleMode,[{value:'saved',label:'Saved native programme'},{value:'parameters',label:'Explicit parameter grid'}]);
  nodes.ensembleMode.addEventListener('change',()=>{rememberField({target:nodes.ensembleMode});if(latest)renderActionFields(latest);});
  nodes.nativeProgrammeFields=el('div',null,'intelligence-form-group');
  nodes.nativeProgrammeFields.append(field('Saved native programme','nativeProgramme','select'),
   el('p','Uses the original retained baseline, scenarios, profile choices and complete case design.','intelligence-muted'),
   button('Design native programme',designNativeProgramme),
   button('Read programme results',()=>client.experiment(nodes.nativeProgramme.value)),
   button('Analyze programme in this investigation',()=>{if(!originalId(nodes.nativeProgramme.value))throw Error('Choose a saved original native programme.');return inspect({operation:'ensemble',object_id:nodes.nativeProgramme.value});}));
  actions.append(nodes.collectionFields,nodes.ensembleSource,nodes.nativeProgrammeFields,nodes.jobFields,nodes.calibrationFields,nodes.ensembleFields);
  const prepareButton=button('Prepare selected action',prepare);prepareButton.dataset.submit='true';actions.append(prepareButton);
  nodes.designerSubmission=el('section',null,'intelligence-plan');nodes.designerSubmission.hidden=true;
  nodes.plans=el('div');nodes.programmeResults=el('section',null,'intelligence-plan');nodes.programmeResults.hidden=true;
  nodes.nativeTask=el('section',null,'intelligence-plan');nodes.nativeTask.hidden=true;
  actions.append(nodes.designerSubmission,nodes.plans,nodes.programmeResults,nodes.nativeTask);
  const sources=section('sources','Export original scientific files');
  sources.append(el('p','Select source data and native outputs. The collection includes the original file bytes, required companions, scientific inventory and portable catalog.','intelligence-muted'));
  sources.append(field('Collection title','collectionTitle','input',''),field('Find an original file','sourceFilter'));
  nodes.sourceFilter.addEventListener('input',()=>latest&&renderSourceChoices(latest));
  const sourceControls=el('div',null,'intelligence-inline');nodes.sourceCount=el('p',null,'intelligence-muted');
  sourceControls.append(nodes.sourceCount,button('Select visible files',()=>{
   const term=(nodes.sourceFilter.value||'').toLowerCase(),refs=(latest?.sourceCatalog?.sources||[]).filter(source=>!term||json([source.label,source.filename,source.ref,source.units]).toLowerCase().includes(term)).map(source=>source.ref);
   client.selectSources(refs);
  }),button('Clear selection',()=>client.clearSourceSelection()),button('Refresh file list',()=>client.collectionSources()));
  nodes.sourceChoices=el('div',null,'intelligence-checks intelligence-source-choices');
  sources.append(sourceControls,nodes.sourceChoices);
  const exportSources=button('Export selected original files',()=>client.exportCollection(nodes.collectionTitle.value));exportSources.dataset.submit='true';sources.append(exportSources);
  sources.append(el('p','After downloading, extract the ZIP and open START.html to browse the collection and its original files. Reopen a saved collection below to download it again.','intelligence-muted'));
  nodes.sourceExports=el('div');sources.append(nodes.sourceExports);
  const history=section('history','Complete retained investigation');
  const exportButton=button('Create complete JSON and readable HTML',()=>client.queue('intelligence.export',{session_id:client.requireSession()}));exportButton.dataset.submit='true';history.append(exportButton);
  nodes.exports=el('div');nodes.history=el('ol',null,'intelligence-history');history.append(nodes.exports,nodes.history);
  main.append(analyze,assistant,actions,sources,history);layout.append(aside,main);desk.append(layout);root.replaceChildren(desk);show(panel);
 }
 async function mount(node,state=host.getState()){
  detach();root=node;workspace=workspaceId(state);epoch++;lastSession=lastCatalog=lastPending=lastEvidence=lastFiles=lastSources=lastDiagnostic=lastProgramme=lastNativeTask=lastSubmission='';
  latest=client.snapshot();draft=clone(latest.draft||{fields:{}});panel=draft.panel||'analyze';selected=clone(draft.selected||null);
  build();renderData(latest);await client.refresh(workspace);
 }
 function update(state=host.getState()){
  if(!root || workspace!==workspaceId(state))return;
  if(!refreshInFlight){refreshInFlight=client.acceptState(state).catch(failure).finally(()=>refreshInFlight=null);}
 }
 function detach(){if(root&&workspace)remember();epoch++;root=null;workspace=null;selected=null;lastSession=lastCatalog=lastPending=lastEvidence=lastFiles=lastSources=lastDiagnostic=lastProgramme=lastNativeTask=lastSubmission='';for(const key of Object.keys(nodes))delete nodes[key];}
 return {mount,update,detach,client,openForDiagnostic};
}
