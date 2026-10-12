// MIT. Selected workflow reports over the original Console archive and receiving merge.
import { canonical, digest, fail } from './records.mjs';
import { validateConsoleArchive } from './archive-contract.mjs';
import { WorkflowRecords, WORKFLOW_SCHEMA, workflowPointer } from './workflow-records.mjs';

export const WORKFLOW_REPORT_SCHEMA='stellar-forge.merchant-workflow-report.v1';
export const MAX_WORKFLOW_REPORT_BYTES=128*1024*1024;
export const MAX_WORKFLOW_REPORT_REQUEST_BYTES=MAX_WORKFLOW_REPORT_BYTES+8192;
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const same=(a,b)=>canonical(a)===canonical(b);
const need=(condition,code,message,status=400)=>{if(!condition)throw fail(code,message,status);};
const seal=value=>({...value,contentSha256:digest(canonical(value))});
const key=(id,revision)=>id+':'+revision;
const identifier=value=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),
    'CONSOLE_REPORT_ID','Select an original saved workflow run.');
  return value;
};
const absent=()=>({present:false});
const present=value=>({present:true,value});
const pointerPart=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
const parsed=value=>value===null?absent():present(JSON.parse(value));
const elapsed=(start,end)=>end===null?null:Date.parse(end)-Date.parse(start);
function at(value,pointer) {
  for(const part of workflowPointer(pointer)) {
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return absent();
    value=value[part];
  }
  return present(value);
}
function selectionFor(archive,input) {
  need(plain(input)&&Object.keys(input).every(name=>['runId','baselineRunId'].includes(name)),
    'CONSOLE_REPORT_SELECTION','Select one run and an optional baseline from the same workflow.');
  const selection={runId:identifier(input.runId),baselineRunId:input.baselineRunId==null?null:identifier(input.baselineRunId)};
  const runs=archive.workflowData?.runs;
  need(Array.isArray(runs),'CONSOLE_REPORT_SELECTION','The profile must retain the selected workflow history.');
  const current=runs.find(run=>run.id===selection.runId);
  const baseline=selection.baselineRunId===null?null:runs.find(run=>run.id===selection.baselineRunId);
  need(current&&current.profileId===archive.profile.id&&(!selection.baselineRunId||baseline),
    'CONSOLE_REPORT_SELECTION','Retain both selected runs in their original profile.',404);
  need(!baseline||baseline.id!==current.id&&baseline.profileId===current.profileId&&baseline.workflowId===current.workflowId,
    'CONSOLE_REPORT_BASELINE','Choose a different run of the same saved workflow.');
  return {selection,current,baseline};
}

/** Preserve the selected runs, workflow editions, installed recipe and complete call/recovery closure. */
export function selectWorkflowReportArchive(archive,input) {
  const {selection,current,baseline}=selectionFor(archive,input);
  const runs=baseline?[current,baseline]:[current];
  const definitionKeys=new Set(runs.map(run=>key(run.workflowId,run.workflowRevision)));
  const installations=(archive.workflowRecipeData?.installations??[]).filter(row=>row.definitionId===current.workflowId);
  for(const row of installations)definitionKeys.add(key(row.definitionId,row.definitionRevision));
  const definitions=archive.workflowData.definitions.filter(row=>definitionKeys.has(key(row.id,row.revision)));
  const drafts=new Map(archive.drafts.map(row=>[key(row.id,row.revision),row]));
  const calls=new Map(archive.calls.map(row=>[row.id,row]));
  const draftKeys=new Set(),callIds=new Set(),queue=[];
  const addDraft=(id,revision)=>{
    const k=key(id,revision);if(draftKeys.has(k))return;
    need(drafts.has(k),'CONSOLE_REPORT_SOURCE','Keep each selected original request revision.');
    draftKeys.add(k);queue.push({kind:'draft',value:drafts.get(k)});
  };
  const addCall=id=>{
    if(!id||callIds.has(id))return;
    need(calls.has(id),'CONSOLE_REPORT_SOURCE','Keep the original native call and its recovery source.');
    callIds.add(id);queue.push({kind:'call',value:calls.get(id)});
  };
  const recoveryDrafts=new Map(),draftCalls=new Map();
  for(const draft of archive.drafts)if(draft.recoveryOf){
    if(!recoveryDrafts.has(draft.recoveryOf))recoveryDrafts.set(draft.recoveryOf,[]);
    recoveryDrafts.get(draft.recoveryOf).push(draft);
  }
  for(const call of archive.calls){
    const k=key(call.draftId,call.draftRevision);
    if(!draftCalls.has(k))draftCalls.set(k,[]);
    draftCalls.get(k).push(call);
  }
  for(const definition of definitions)for(const step of definition.steps)addDraft(step.draftId,step.draftRevision);
  for(const row of installations)for(const draft of row.drafts)addDraft(draft.id,draft.revision);
  for(const run of runs)for(const step of run.steps){
    if(step.draftRevision!==null)addDraft(step.draftId,step.draftRevision);
    if(calls.has(step.callId))addCall(step.callId);
    if(step.resolvedCallId)addCall(step.resolvedCallId);
  }
  for(const run of runs)for(const event of run.events)if(event.callId&&calls.has(event.callId))addCall(event.callId);
  for(let cursor=0;cursor<queue.length;cursor++){
    const item=queue[cursor],value=item.value;
    if(item.kind==='call'){
      addDraft(value.draftId,value.draftRevision);
      for(const draft of recoveryDrafts.get(value.id)??[]){
        addDraft(draft.id,draft.revision);
        for(const recovery of draftCalls.get(key(draft.id,draft.revision))??[])addCall(recovery.id);
      }
    }else if(value.recoveryOf)addCall(value.recoveryOf);
  }
  const body={
    schema:archive.schema,sourceWorkspaceId:archive.sourceWorkspaceId,profile:archive.profile,
    drafts:archive.drafts.filter(row=>draftKeys.has(key(row.id,row.revision))),
    calls:archive.calls.filter(row=>callIds.has(row.id)),deliveries:[],
    ...(archive.bindings?.length?{bindings:archive.bindings}:{}),
    workflowData:{schema:WORKFLOW_SCHEMA,definitions,runs},
    ...(installations.length?{workflowRecipeData:{schema:archive.workflowRecipeData.schema,installations}}:{})
  };
  const selected=seal(body);
  validateConsoleArchive(selected);
  return {selection,archive:selected};
}

/** Every changed JSON leaf is retained; missing members and JSON null stay distinct. */
export function workflowReportDifferences(before,after) {
  const result=[],queue=[{pointer:'',before,after}];
  for(let cursor=0;cursor<queue.length;cursor++){
    const item=queue[cursor],left=item.before,right=item.after;
    if(left.present===right.present&&(!left.present||same(left.value,right.value)))continue;
    const a=left.value,b=right.value;
    if(left.present&&right.present&&a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
      const names=[...new Set([...Object.keys(a),...Object.keys(b)])].sort((x,y)=>
        Array.isArray(a)?Number(x)-Number(y):x<y?-1:x>y?1:0);
      // An empty object and empty array have different types and are handled as a replacement.
      for(const name of names)queue.push({pointer:item.pointer+'/'+pointerPart(name),
        before:Object.hasOwn(a,name)?present(a[name]):absent(),after:Object.hasOwn(b,name)?present(b[name]):absent()});
    }else result.push({...item,kind:!left.present?'ADDED':!right.present?'REMOVED':'CHANGED'});
  }
  return result;
}
function nativeOutcome(call){
  if(!call)return 'NOT_DISPATCHED';
  if(call.state==='RUNNING')return 'PENDING';
  if(call.state==='FAILED')return 'FAILED';
  return JSON.parse(call.resultJson)?.isError===true?'NATIVE_ERROR':'RETURNED';
}
function reportIndex(archive){
  const calls=new Map(archive.calls.map(call=>[call.id,call]));
  const drafts=new Map(archive.drafts.map(draft=>[key(draft.id,draft.revision),draft]));
  const recoveries=new Map(),contracts=new Map();
  for(const call of archive.calls){
    const source=drafts.get(key(call.draftId,call.draftRevision))?.recoveryOf;
    if(source){if(!recoveries.has(source))recoveries.set(source,[]);recoveries.get(source).push(call);}
  }
  for(const installation of archive.workflowRecipeData?.installations??[]){
    const definitions=[...installation.recipe.steps.map(step=>step.definition),...installation.review.tools.map(tool=>tool.currentDefinition)];
    for(const definition of definitions)contracts.set(definition.name+':'+digest(canonical(definition)),definition);
  }
  return {calls,drafts,recoveries,contracts};
}
function summarizeRun(run,definition,index){
  const stepIds=new Set(run.steps.flatMap(step=>[step.callId,step.resolvedCallId].filter(Boolean)));
  const queue=[...stepIds];
  for(let cursor=0;cursor<queue.length;cursor++)for(const call of index.recoveries.get(queue[cursor])??[]){
    if(!stepIds.has(call.id)){stepIds.add(call.id);queue.push(call.id);}
  }
  const retained=[...stepIds].map(id=>index.calls.get(id)).filter(Boolean);
  const terminal=retained.filter(call=>call.completedAt!==null);
  return {
    id:run.id,name:definition.name,profileId:run.profileId,workflowId:run.workflowId,
    workflowRevision:run.workflowRevision,workflowSha256:run.workflowSha256,revision:run.revision,
    state:run.state,error:run.error,createdAt:run.createdAt,updatedAt:run.updatedAt,completedAt:run.completedAt,
    recordedThrough:run.completedAt??run.updatedAt,recordedDurationMs:elapsed(run.createdAt,run.completedAt??run.updatedAt),
    completedSteps:run.steps.filter(step=>['COMPLETE','RECOVERED'].includes(step.state)).length,
    recoveredSteps:run.steps.filter(step=>step.state==='RECOVERED').length,stepCount:run.steps.length,
    nativeCalls:retained.length,completedNativeCalls:terminal.length,
    pendingNativeCalls:retained.filter(call=>call.state==='RUNNING').length,
    failedNativeCalls:retained.filter(call=>['FAILED','NATIVE_ERROR'].includes(nativeOutcome(call))).length,
    recordedNativeDurationMs:terminal.reduce((sum,call)=>sum+elapsed(call.startedAt,call.completedAt),0),
    workspaceId:run.workspaceId,ownerWorkspaceId:run.ownerWorkspaceId,
    hostFingerprint:run.hostFingerprint,executionHostFingerprint:run.executionHostFingerprint,
    handover:run.handover,eventCount:run.events.length,inputsSha256:digest(run.inputsJson)
  };
}
function stepSnapshot(run,definition,position,index) {
  const step=run.steps[position],source=definition.steps[position];
  const draft=index.drafts.get(key(source.draftId,source.draftRevision));
  const prepared=step.draftRevision===null?null:index.drafts.get(key(step.draftId,step.draftRevision));
  const call=index.calls.get(step.callId)??null;
  const effective=step.resolvedCallId?index.calls.get(step.resolvedCallId):call;
  const contract=index.contracts.get(draft.tool+':'+draft.toolSchemaSha256);
  const result=effective?.state==='COMPLETE'?parsed(effective.resultJson):absent();
  const expectationResults=source.expect.map(condition=>{
    const actual=result.present?at(result.value,condition.pointer):absent();
    return {condition,actual,status:!result.present?'UNAVAILABLE':!actual.present?'MISSING':
      (Object.hasOwn(condition,'equals')?same(actual.value,condition.equals):condition.oneOf.some(value=>same(actual.value,value)))?'PASS':'FAIL'};
  });
  const recoveries=index.recoveries.get(step.callId)??[];
  return {
    id:step.id,name:source.name,position:position+1,state:step.state,
    tool:draft.tool,toolSchemaSha256:draft.toolSchemaSha256,contractDefinitionAvailable:Boolean(contract),
    resultSha256:effective?.resultSha256??null,argumentsSha256:prepared?.argumentsSha256??null,
    draftId:draft.id,draftRevision:draft.revision,bindings:source.bindings,expect:source.expect,pauseAfter:source.pauseAfter,
    callId:call?.id??null,effectiveCallId:effective?.id??null,resolvedCallId:step.resolvedCallId,
    originalOutcome:nativeOutcome(call),outcome:nativeOutcome(effective),resolutionNote:step.resolutionNote,
    startedAt:call?.startedAt??null,completedAt:step.completedAt,
    originalCallDurationMs:call?elapsed(call.startedAt,call.completedAt):null,
    effectiveCallDurationMs:effective?elapsed(effective.startedAt,effective.completedAt):null,
    error:effective?.error??null,expectationResults,
    recoveries:recoveries.map(row=>({id:row.id,state:row.state,outcome:nativeOutcome(row),selected:row.id===step.resolvedCallId,
      startedAt:row.startedAt,completedAt:row.completedAt,durationMs:elapsed(row.startedAt,row.completedAt)})),
    values:{
      nativeContract:contract?present(contract):absent(),
      baseArguments:parsed(draft.argumentsJson),
      arguments:prepared?parsed(prepared.argumentsJson):absent(),
      effectiveArguments:effective?parsed(effective.argumentsJson):absent(),
      result
    }
  };
}
const comparableDefinition=step=>step?present({
  name:step.name,position:step.position,tool:step.tool,toolSchemaSha256:step.toolSchemaSha256,
  bindings:step.bindings,expect:step.expect,pauseAfter:step.pauseAfter
}):absent();
function stepReport(current,baseline,comparing) {
  const differences={
    nativeContract:comparing?workflowReportDifferences(baseline?.values.nativeContract??absent(),current?.values.nativeContract??absent()):[],
    execution:comparing?workflowReportDifferences(baseline?present({state:baseline.state,outcome:baseline.outcome,originalOutcome:baseline.originalOutcome,error:baseline.error,resolutionNote:baseline.resolutionNote,recoveries:baseline.recoveries.map(row=>({outcome:row.outcome,selected:row.selected}))}):absent(),current?present({state:current.state,outcome:current.outcome,originalOutcome:current.originalOutcome,error:current.error,resolutionNote:current.resolutionNote,recoveries:current.recoveries.map(row=>({outcome:row.outcome,selected:row.selected}))}):absent()):[],
    definition:comparing?workflowReportDifferences(comparableDefinition(baseline),comparableDefinition(current)):[],
    baseArguments:comparing?workflowReportDifferences(baseline?.values.baseArguments??absent(),current?.values.baseArguments??absent()):[],
    arguments:comparing?workflowReportDifferences(baseline?.values.arguments??absent(),current?.values.arguments??absent()):[],
    effectiveArguments:comparing?workflowReportDifferences(baseline?.values.effectiveArguments??absent(),current?.values.effectiveArguments??absent()):[],
    result:comparing?workflowReportDifferences(baseline?.values.result??absent(),current?.values.result??absent()):[]
  };
  const flags=[];
  if(comparing){
    for(const field of ['state','outcome','originalOutcome','resolutionNote'])
      if((current?.[field]??null)!==(baseline?.[field]??null))flags.push(field);
    for(const [field,changes] of Object.entries(differences))if(changes.length)flags.push(field);
  }
  // Values are already retained once in the archive; differences retain full changed leaf values.
  const metadata=value=>{
    if(!value)return null;
    const {values,...rest}=value;
    return rest;
  };
  const a=current?.effectiveCallDurationMs,b=baseline?.effectiveCallDurationMs;
  return {id:current?.id??baseline.id,
    change:!comparing?'CURRENT':!baseline?'ADDED':!current?'REMOVED':flags.length?'CHANGED':'UNCHANGED',
    flags,current:metadata(current),baseline:metadata(baseline),differences,
    effectiveCallDurationDeltaMs:typeof a==='number'&&typeof b==='number'?a-b:null};
}
export function buildWorkflowReport(archive,input) {
  const {selection,current,baseline}=selectionFor(archive,input);
  const edition=run=>archive.workflowData.definitions.find(row=>row.id===run.workflowId&&row.revision===run.workflowRevision);
  const currentDefinition=edition(current),baselineDefinition=baseline?edition(baseline):null;
  need(currentDefinition&&(!baseline||baselineDefinition),'CONSOLE_REPORT_SOURCE','Retain each selected workflow edition.');
  const index=reportIndex(archive);
  const after=current.steps.map((_,position)=>stepSnapshot(current,currentDefinition,position,index));
  const before=baseline?baseline.steps.map((_,position)=>stepSnapshot(baseline,baselineDefinition,position,index)):[];
  const beforeById=new Map(before.map(step=>[step.id,step])),afterById=new Map(after.map(step=>[step.id,step]));
  const order=[...after.map(step=>step.id),...before.filter(step=>!afterById.has(step.id)).map(step=>step.id)];
  const steps=order.map(id=>stepReport(afterById.get(id)??null,beforeById.get(id)??null,Boolean(baseline)));
  const currentSummary=summarizeRun(current,currentDefinition,index);
  const baselineSummary=baseline?summarizeRun(baseline,baselineDefinition,index):null;
  return {
    selection,profile:{id:archive.profile.id,name:archive.profile.name},
    current:currentSummary,baseline:baselineSummary,
    inputs:baseline?workflowReportDifferences(parsed(baseline.inputsJson),parsed(current.inputsJson)):[],
    context:baseline?workflowReportDifferences(present({
      hostFingerprint:baseline.hostFingerprint,executionHostFingerprint:baseline.executionHostFingerprint,
      workspaceId:baseline.workspaceId,ownerWorkspaceId:baseline.ownerWorkspaceId
    }),present({
      hostFingerprint:current.hostFingerprint,executionHostFingerprint:current.executionHostFingerprint,
      workspaceId:current.workspaceId,ownerWorkspaceId:current.ownerWorkspaceId
    })):[],
    steps,
    changes:baseline?{
      added:steps.filter(row=>row.change==='ADDED').length,removed:steps.filter(row=>row.change==='REMOVED').length,
      changed:steps.filter(row=>row.change==='CHANGED').length,unchanged:steps.filter(row=>row.change==='UNCHANGED').length,
      recordedDurationDeltaMs:currentSummary.recordedDurationMs-baselineSummary.recordedDurationMs,
      recordedNativeDurationDeltaMs:currentSummary.recordedNativeDurationMs-baselineSummary.recordedNativeDurationMs
    }:null,
    source:{workspaceId:archive.sourceWorkspaceId,archiveSha256:archive.contentSha256,
      drafts:archive.drafts.length,calls:archive.calls.length,hostBindings:archive.bindings?.length??0,definitions:archive.workflowData.definitions.length,
      runs:archive.workflowData.runs.length,recipeInstallations:archive.workflowRecipeData?.installations.length??0}
  };
}
export function createWorkflowReportPacket(archive,input) {
  const selected=selectWorkflowReportArchive(archive,input);
  const packet=seal({schema:WORKFLOW_REPORT_SCHEMA,...selected,report:buildWorkflowReport(selected.archive,selected.selection)});
  need(Buffer.byteLength(JSON.stringify(packet))<=MAX_WORKFLOW_REPORT_BYTES,
    'CONSOLE_REPORT_TOO_LARGE','The complete selected report exceeds 128 MiB. Export a single run or use the original profile archive.',413);
  return packet;
}
export function validateWorkflowReportPacket(packet) {
  need(plain(packet)&&Object.keys(packet).length===5&&
    ['schema','selection','archive','report','contentSha256'].every(name=>Object.hasOwn(packet,name))&&
    packet.schema===WORKFLOW_REPORT_SCHEMA,'CONSOLE_REPORT_SCHEMA','Receive a complete original workflow report.');
  need(Buffer.byteLength(JSON.stringify(packet))<=MAX_WORKFLOW_REPORT_BYTES,
    'CONSOLE_REPORT_TOO_LARGE','Receive a complete report up to 128 MiB.',413);
  const {contentSha256,...body}=packet;
  need(typeof contentSha256==='string'&&/^[a-f0-9]{64}$/.test(contentSha256)&&digest(canonical(body))===contentSha256,
    'CONSOLE_REPORT_CHANGED','The selected workflow report differs from its saved digest.');
  validateConsoleArchive(packet.archive);
  const selected=selectWorkflowReportArchive(packet.archive,packet.selection);
  need(same(selected.selection,packet.selection)&&same(selected.archive,packet.archive),
    'CONSOLE_REPORT_SELECTION','Keep the report limited to its selected original runs and required source history.');
  const report=buildWorkflowReport(packet.archive,packet.selection);
  need(same(report,packet.report),'CONSOLE_REPORT_CHANGED','The report must describe its complete retained workflow records.');
  return packet;
}
export function createMerchantWorkflowReports({store,requireTool,requireOpen=()=>{},isActiveCall=()=>false}) {
  const records=new WorkflowRecords(store);
  async function authorize(packet,context){
    for(const row of [...packet.archive.drafts,...packet.archive.calls])
      await requireTool(context,row.tool,JSON.parse(row.argumentsJson));
  }
  return {
    async view(input,context){
      requireOpen();
      const run=records.run(identifier(input?.runId));
      const packet=createWorkflowReportPacket(store.archive(run.profileId),input);
      await authorize(packet,context);requireOpen();
      return {packet};
    },
    async review(input,context){
      const packet=validateWorkflowReportPacket(input?.packet);
      await authorize(packet,context);requireOpen();
      return {report:packet.report,contentSha256:packet.contentSha256,profile:packet.archive.profile,
        sourceWorkspaceId:packet.archive.sourceWorkspaceId,
        currentWorkspaceId:store.id,archiveSha256:packet.archive.contentSha256};
    },
    async receive(input,context){
      const packet=validateWorkflowReportPacket(input?.packet);
      need(input.expectedContentSha256===packet.contentSha256,'CONSOLE_REPORT_REVIEW',
        'Use the digest from the selected report review.');
      await authorize(packet,context);requireOpen();
      const received=store.import(packet.archive,{isActiveCall});
      const run=records.run(packet.selection.runId);
      const baseline=packet.selection.baselineRunId?records.run(packet.selection.baselineRunId):null;
      return {...received,reportSha256:packet.contentSha256,selection:packet.selection,
        run:{id:run.id,revision:run.revision,state:run.state,ownerWorkspaceId:run.ownerWorkspaceId},
        baseline:baseline?{id:baseline.id,revision:baseline.revision,state:baseline.state}:null};
    }
  };
}
