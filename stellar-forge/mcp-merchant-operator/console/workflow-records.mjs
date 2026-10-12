// MIT. Saved workflow editions and original native-call lineage in the console database.
import { randomUUID } from 'node:crypto';
import { canonical, digest, fail } from './records.mjs';

export const WORKFLOW_SCHEMA='stellar-forge.merchant-workflow.v1';
export const WORKFLOW_RUN_SCHEMA='stellar-forge.merchant-workflow-run.v1';
const now=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const need=(test,code,message,status=400)=>{if(!test)throw fail(code,message,status);};
const identifier=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),'CONSOLE_WORKFLOW_ID','Use an original workflow or step identifier.');return value;};
const revision=value=>{need(Number.isSafeInteger(value)&&value>0,'CONSOLE_WORKFLOW_REVISION','Use the current saved revision.');return value;};
const sha=value=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'CONSOLE_WORKFLOW_DIGEST','Use the displayed original digest.');return value;};
const title=value=>{need(typeof value==='string'&&value.trim()&&value.length<=160&&!/[\x00-\x1f]/.test(value),'CONSOLE_WORKFLOW_NAME','Use a workflow or step name from 1 to 160 characters.');return value.trim();};
const date=value=>{need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'CONSOLE_WORKFLOW_DATE','Retain the original UTC workflow timestamp.');return value;};
const fields=(value,names,label)=>{need(plain(value)&&Object.keys(value).every(key=>names.includes(key)),'CONSOLE_WORKFLOW_FIELDS','Use the supported '+label+' fields.');return value;};
const sealed=value=>({...value,contentSha256:digest(canonical(value))});
const same=(a,b)=>canonical(a)===canonical(b);
const key=(id,revision)=>id+':'+revision;
const successful=call=>call.state==='COMPLETE'&&JSON.parse(call.resultJson)?.isError!==true;
export function workflowPointer(value){
  need(typeof value==='string'&&value.length<=2048&&(value===''||value.startsWith('/'))&&!/~(?:[^01]|$)/.test(value),
    'CONSOLE_WORKFLOW_POINTER','Use a complete JSON pointer, with ~0 for a tilde and ~1 for a slash.');
  return value===''?[]:value.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
}
function bindings(value,prior){
  need(Array.isArray(value)&&value.length<=256,'CONSOLE_WORKFLOW_BINDINGS','Use the selected input and earlier-result bindings.');
  const targets=[];
  return value.map(item=>{
    fields(item,['target','from','stepId','pointer'],'binding');
    const target=workflowPointer(item.target);workflowPointer(item.pointer);
    need(['inputs','step','run'].includes(item.from),'CONSOLE_WORKFLOW_BINDING_SOURCE','Select workflow inputs, an earlier step, or this run.');
    if(item.from==='step')need(prior.has(identifier(item.stepId)),'CONSOLE_WORKFLOW_STEP_ORDER','Bind only an earlier step in this saved workflow.');
    else need(item.stepId===undefined,'CONSOLE_WORKFLOW_BINDING_SOURCE','Only an earlier-step binding has a step identifier.');
    need(!targets.some(old=>old.every((part,i)=>target[i]===part)||target.every((part,i)=>old[i]===part)),
      'CONSOLE_WORKFLOW_BINDING_OVERLAP','Choose separate argument targets for each binding.');
    targets.push(target);
    return{target:item.target,from:item.from,...(item.from==='step'?{stepId:item.stepId}:{}),pointer:item.pointer};
  });
}
function expectations(value){
  need(Array.isArray(value)&&value.length<=64,'CONSOLE_WORKFLOW_EXPECTATIONS','Use up to 64 required native result values.');
  return value.map(item=>{
    fields(item,['pointer','equals','oneOf'],'result condition');workflowPointer(item.pointer);
    const equality=Object.hasOwn(item,'equals'),selection=Object.hasOwn(item,'oneOf');
    need(equality!==selection&&(!selection||Array.isArray(item.oneOf)&&item.oneOf.length>0&&item.oneOf.length<=128),
      'CONSOLE_WORKFLOW_EXPECTATIONS','Select one exact JSON value or a nonempty list of accepted values.');
    canonical(equality?item.equals:item.oneOf);
    return clone(item);
  });
}
export function normalizeWorkflowSteps(value,profileId,getDraft){
  need(Array.isArray(value)&&value.length>0&&value.length<=128,'CONSOLE_WORKFLOW_STEPS','Save a sequence from 1 to 128 original native requests.');
  const prior=new Set();
  return value.map(input=>{
    fields(input,['id','name','draftId','draftRevision','bindings','expect'],'step');
    const id=identifier(input.id);need(!prior.has(id),'CONSOLE_WORKFLOW_STEPS','Give each workflow step its own identifier.');
    const draft=getDraft(identifier(input.draftId),revision(input.draftRevision));
    need(draft.profileId===profileId,'CONSOLE_WORKFLOW_PROFILE','Select original requests from this operator profile.');
    const value={id,name:title(input.name),draftId:draft.id,draftRevision:draft.revision,bindings:bindings(input.bindings??[],prior),expect:expectations(input.expect??[])};
    prior.add(id);return value;
  });
}
const runRequest=value=>Object.fromEntries(['id','profileId','workflowId','workflowRevision','workflowSha256','hostFingerprint','inputsJson'].map(name=>[name,value[name]]));
export const workflowCallId=(runId,stepId)=>'workflow-call-'+digest(canonical([runId,stepId])).slice(0,40);
export const workflowDraftId=(runId,stepId)=>'workflow-draft-'+digest(canonical([runId,stepId])).slice(0,40);
export function installWorkflowTables(db){
  db.exec('CREATE TABLE IF NOT EXISTS workflow_definitions(id TEXT NOT NULL,revision INTEGER NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),value TEXT NOT NULL,PRIMARY KEY(id,revision));'+
    'CREATE INDEX IF NOT EXISTS workflow_definitions_profile ON workflow_definitions(profile_id,id,revision);'+
    'CREATE TABLE IF NOT EXISTS workflow_runs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),value TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS workflow_runs_profile ON workflow_runs(profile_id,id);');
}
export function archiveWorkflowRows(db,profileId){
  const definitions=db.prepare('SELECT value FROM workflow_definitions WHERE profile_id=? ORDER BY id,revision').all(profileId).map(row=>JSON.parse(row.value));
  const runs=db.prepare('SELECT value FROM workflow_runs WHERE profile_id=? ORDER BY id').all(profileId).map(row=>JSON.parse(row.value));
  return definitions.length||runs.length?{schema:WORKFLOW_SCHEMA,definitions,runs}:undefined;
}
export function validateWorkflowRows(value,{profile,drafts,calls}){
  if(value===undefined)return undefined;
  fields(value,['schema','definitions','runs'],'workflow archive');
  need(value.schema===WORKFLOW_SCHEMA&&Array.isArray(value.definitions)&&Array.isArray(value.runs)&&value.definitions.length<=10000&&value.runs.length<=10000,
    'CONSOLE_WORKFLOW_ARCHIVE','Receive the complete original workflow definitions and runs.');
  const originalDrafts=new Map(drafts.map(row=>[key(row.id,row.revision),row]));
  const originalCalls=new Map(calls.map(row=>[row.id,row]));
  const definitions=new Map(),runIds=new Set();
  for(const item of value.definitions){
    fields(item,['schema','id','profileId','name','revision','createdAt','updatedAt','steps','contentSha256'],'workflow edition');
    need(item.schema===WORKFLOW_SCHEMA&&item.profileId===profile.id,'CONSOLE_WORKFLOW_ARCHIVE','Keep workflows with their original operator profile.');
    identifier(item.id);revision(item.revision);title(item.name);date(item.createdAt);date(item.updatedAt);
    const {contentSha256,...body}=item;
    need(digest(canonical(body))===sha(contentSha256),'CONSOLE_WORKFLOW_ARCHIVE_CHANGED','The complete original workflow edition changed.');
    const normalized=normalizeWorkflowSteps(item.steps,profile.id,(id,revision)=>{
      const draft=originalDrafts.get(key(id,revision));need(draft,'CONSOLE_WORKFLOW_ARCHIVE','Retain every original request revision used by this workflow.');return draft;
    });
    need(same(normalized,item.steps)&&!definitions.has(key(item.id,item.revision)),'CONSOLE_WORKFLOW_ARCHIVE','Retain unique, normalized workflow editions.');
    definitions.set(key(item.id,item.revision),item);
  }
  for(const run of value.runs){
    fields(run,['schema','id','profileId','workflowId','workflowRevision','workflowSha256','hostFingerprint','inputsJson','requestSha256','workspaceId','ownerWorkspaceId','executionHostFingerprint','handover','revision','createdAt','updatedAt','completedAt','state','pauseRequested','steps','events','error'],'workflow run');
    identifier(run.id);identifier(run.workspaceId);identifier(run.ownerWorkspaceId);sha(run.executionHostFingerprint);
    revision(run.revision);date(run.createdAt);date(run.updatedAt);
    if(run.handover===null)need(run.ownerWorkspaceId===run.workspaceId&&run.executionHostFingerprint===run.hostFingerprint,
      'CONSOLE_WORKFLOW_ARCHIVE','Retain the original execution owner until its explicit handover.');
    else{
      fields(run.handover,['id','fromWorkspaceId','toWorkspaceId','hostFingerprint','note','at','sourceRevision'],'workflow handover');
      const handover=run.handover;identifier(handover.id);identifier(handover.fromWorkspaceId);identifier(handover.toWorkspaceId);sha(handover.hostFingerprint);date(handover.at);revision(handover.sourceRevision);
      need(handover.fromWorkspaceId!==handover.toWorkspaceId&&handover.toWorkspaceId===run.ownerWorkspaceId&&
        handover.hostFingerprint===run.executionHostFingerprint&&typeof handover.note==='string'&&handover.note.trim()&&handover.note.length<=8000,
        'CONSOLE_WORKFLOW_ARCHIVE','Keep the named receiving owner, configured host and handover note.');
    }
    if(run.completedAt!==null)date(run.completedAt);
    const definition=definitions.get(key(run.workflowId,run.workflowRevision));
    need(run.schema===WORKFLOW_RUN_SCHEMA&&run.profileId===profile.id&&definition&&definition.contentSha256===run.workflowSha256&&!runIds.has(run.id),
      'CONSOLE_WORKFLOW_ARCHIVE','Retain each run with its original workflow edition.');
    runIds.add(run.id);sha(run.hostFingerprint);
    let inputs;try{inputs=JSON.parse(run.inputsJson);}catch{}
    need(typeof run.inputsJson==='string'&&plain(inputs)&&digest(canonical(runRequest(run)))===sha(run.requestSha256),
      'CONSOLE_WORKFLOW_ARCHIVE_CHANGED','Retain the complete original run inputs and request.');
    need(['READY','RUNNING','PAUSED','WAITING','COMPLETE'].includes(run.state)&&typeof run.pauseRequested==='boolean'&&
      Array.isArray(run.steps)&&run.steps.length===definition.steps.length&&Array.isArray(run.events)&&run.events.length===run.revision,
      'CONSOLE_WORKFLOW_ARCHIVE','Retain the original run progress and event history.');
    need((run.state==='COMPLETE')===(run.completedAt!==null),'CONSOLE_WORKFLOW_ARCHIVE','Retain the original run completion time.');
    need(run.error===null||plain(run.error)&&typeof run.error.code==='string'&&typeof run.error.message==='string',
      'CONSOLE_WORKFLOW_ARCHIVE','Retain the original workflow issue.');
    let pending=false;
    for(let index=0;index<run.steps.length;index++){
      const step=run.steps[index],original=definition.steps[index];
      fields(step,['id','callId','draftId','draftRevision','state','argumentsSha256','resolvedCallId','resolutionNote','completedAt'],'workflow step progress');
      need(step.id===original.id&&step.callId===workflowCallId(run.id,step.id)&&step.draftId===workflowDraftId(run.id,step.id)&&
        ['PENDING','RESERVED','WAITING','COMPLETE','RECOVERED'].includes(step.state),'CONSOLE_WORKFLOW_ARCHIVE_CHANGED','Keep each step with its original native request identity.');
      const completed=['COMPLETE','RECOVERED'].includes(step.state);
      need(!pending||!completed,'CONSOLE_WORKFLOW_ARCHIVE','Retain the original sequential step order.');
      if(!completed)pending=true;
      if(step.draftRevision===null){
        need(step.state==='PENDING'&&step.argumentsSha256===null&&!originalCalls.has(step.callId),
          'CONSOLE_WORKFLOW_ARCHIVE','An unprepared step has no dispatched native request.');
      }else{
        const draft=originalDrafts.get(key(step.draftId,revision(step.draftRevision)));
        const base=originalDrafts.get(key(original.draftId,original.draftRevision));
        need(draft&&draft.profileId===profile.id&&draft.tool===base.tool&&draft.toolSchemaSha256===base.toolSchemaSha256&&draft.argumentsSha256===sha(step.argumentsSha256),
          'CONSOLE_WORKFLOW_ARCHIVE_CHANGED','Retain the exact prepared native request for this workflow step.');
        const call=originalCalls.get(step.callId);
        need(!call||call.draftId===step.draftId&&call.draftRevision===step.draftRevision&&call.profileId===profile.id,
          'CONSOLE_WORKFLOW_ARCHIVE_CHANGED','Retain the original step call and its prepared request.');
        if(step.state==='COMPLETE')need(call&&successful(call),'CONSOLE_WORKFLOW_ARCHIVE','A complete step retains its successful original native call.');
        if(step.state==='RECOVERED'){
          const recovered=originalCalls.get(step.resolvedCallId);
          const recoveryDraft=recovered&&originalDrafts.get(key(recovered.draftId,recovered.draftRevision));
          need(call&&recovered&&recovered.profileId===profile.id&&successful(recovered)&&recoveryDraft?.recoveryOf===step.callId&&
            typeof step.resolutionNote==='string'&&step.resolutionNote.trim()&&step.resolutionNote.length<=8000,
            'CONSOLE_WORKFLOW_ARCHIVE','Retain the selected completed recovery call and the operator’s resolution.');
        }
      }
      if(completed)date(step.completedAt);
      else need(step.completedAt===null,'CONSOLE_WORKFLOW_ARCHIVE','An unfinished step has no completion timestamp.');
      if(step.state!=='RECOVERED')need(step.resolvedCallId===null&&step.resolutionNote==='','CONSOLE_WORKFLOW_ARCHIVE','Retain recovery references only for a resolved original request.');
    }
    need(run.state!=='COMPLETE'||!pending,'CONSOLE_WORKFLOW_ARCHIVE','Complete all original steps before completing the workflow.');
    let sequence=0;
    for(const event of run.events){
      fields(event,['sequence','at','kind','stepId','callId','detail'],'workflow event');
      need(event.sequence===++sequence&&typeof event.kind==='string'&&event.kind.length<=120&&plain(event.detail),
        'CONSOLE_WORKFLOW_ARCHIVE','Retain the complete ordered workflow event history.');
      date(event.at);
      if(event.stepId!==null)need(run.steps.some(step=>step.id===event.stepId),'CONSOLE_WORKFLOW_ARCHIVE','Keep events attached to their original steps.');
      if(event.callId!==null)identifier(event.callId);
    }
    let owner=run.workspaceId,fingerprint=run.hostFingerprint,lastHandover=null;
    for(const event of run.events.filter(value=>value.kind==='HANDED_OVER')){
      const handover=event.detail;
      need(handover.fromWorkspaceId===owner&&handover.sourceRevision===event.sequence-1&&handover.at===event.at,
        'CONSOLE_WORKFLOW_ARCHIVE','Retain each original owner release in its complete event history.');
      owner=handover.toWorkspaceId;fingerprint=handover.hostFingerprint;lastHandover=handover;
    }
    need(owner===run.ownerWorkspaceId&&fingerprint===run.executionHostFingerprint&&same(lastHandover,run.handover),
      'CONSOLE_WORKFLOW_ARCHIVE','Retain the complete original receiving ownership history.');
  }
  return value;
}
export function importWorkflowRows(db,value){
  if(value===undefined)return;
  for(const item of value.definitions)
    need(!db.prepare('SELECT 1 FROM workflow_definitions WHERE id=? LIMIT 1').get(item.id),'CONSOLE_WORKFLOW_IMPORT_CONFLICT','Receive this workflow into a workspace without a conflicting saved workflow identity.',409);
  for(const run of value.runs)
    need(!db.prepare('SELECT 1 FROM workflow_runs WHERE id=?').get(run.id),'CONSOLE_WORKFLOW_IMPORT_CONFLICT','Receive this original workflow run into a workspace without that run identity.',409);
  for(const item of value.definitions)db.prepare('INSERT INTO workflow_definitions VALUES(?,?,?,?)').run(item.id,item.revision,item.profileId,JSON.stringify(item));
  for(const run of value.runs)db.prepare('INSERT INTO workflow_runs VALUES(?,?,?)').run(run.id,run.profileId,JSON.stringify(run));
}
export class WorkflowRecords{
  constructor(store){this.store=store;this.db=store.db;installWorkflowTables(this.db);}
  definitions(profileId){
    this.store.profile(profileId);
    return this.db.prepare('SELECT value FROM workflow_definitions WHERE profile_id=? ORDER BY id,revision').all(profileId).map(row=>JSON.parse(row.value))
      .reduce((out,row)=>{out.set(row.id,row);return out;},new Map());
  }
  definition(id,selectedRevision){
    identifier(id);
    const row=selectedRevision===undefined?this.db.prepare('SELECT value FROM workflow_definitions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id):
      this.db.prepare('SELECT value FROM workflow_definitions WHERE id=? AND revision=?').get(id,revision(selectedRevision));
    if(!row)throw fail('CONSOLE_WORKFLOW_NOT_FOUND','Select a saved workflow.',404);
    return JSON.parse(row.value);
  }
  save(input){
    fields(input,['id','profileId','name','expectedRevision','steps'],'workflow save');
    const profileId=identifier(input.profileId);this.store.profile(profileId);
    const id=identifier(input.id??randomUUID()),name=title(input.name);
    const steps=normalizeWorkflowSteps(input.steps,profileId,(id,revision)=>this.store.draft(id,revision));
    return this.store.transaction(()=>{
      let old;try{old=this.definition(id);}catch(error){if(error.code!=='CONSOLE_WORKFLOW_NOT_FOUND')throw error;}
      if(old)need(old.profileId===profileId&&old.revision===revision(input.expectedRevision),'CONSOLE_WORKFLOW_REVISION_CONFLICT','Reopen the current saved workflow before changing it.',409);
      else need(input.expectedRevision===undefined,'CONSOLE_WORKFLOW_REVISION_CONFLICT','Create this workflow without an earlier revision.',409);
      if(old&&same(old.steps,steps)&&old.name===name)return{definition:old,unchanged:true};
      const value=sealed({schema:WORKFLOW_SCHEMA,id,profileId,name,revision:(old?.revision??0)+1,createdAt:old?.createdAt??now(),updatedAt:now(),steps});
      this.db.prepare('INSERT INTO workflow_definitions VALUES(?,?,?,?)').run(id,value.revision,profileId,JSON.stringify(value));
      return{definition:value,unchanged:false};
    });
  }
  runs(profileId){this.store.profile(profileId);return this.db.prepare('SELECT value FROM workflow_runs WHERE profile_id=? ORDER BY id').all(profileId).map(row=>JSON.parse(row.value));}
  run(id){const row=this.db.prepare('SELECT value FROM workflow_runs WHERE id=?').get(identifier(id));if(!row)throw fail('CONSOLE_WORKFLOW_RUN_NOT_FOUND','Open an original workflow run.',404);return JSON.parse(row.value);}
  reserve(input,host){
    fields(input,['id','profileId','workflowId','workflowRevision','expectedWorkflowSha256','expectedHostFingerprint','inputs'],'workflow run');
    const definition=this.definition(input.workflowId,revision(input.workflowRevision));
    const profile=this.store.profile(identifier(input.profileId));
    need(definition.profileId===profile.id&&definition.contentSha256===sha(input.expectedWorkflowSha256),'CONSOLE_WORKFLOW_REVIEW','Run the complete selected workflow edition.');
    need(plain(input.inputs),'CONSOLE_WORKFLOW_INPUTS','Supply one complete JSON object of workflow inputs.');
    const request={id:identifier(input.id),profileId:profile.id,workflowId:definition.id,workflowRevision:definition.revision,
      workflowSha256:definition.contentSha256,hostFingerprint:sha(input.expectedHostFingerprint),inputsJson:JSON.stringify(input.inputs)};
    const requestSha256=digest(canonical(request));
    return this.store.transaction(()=>{
      let old;try{old=this.run(input.id);}catch(error){if(error.code!=='CONSOLE_WORKFLOW_RUN_NOT_FOUND')throw error;}
      if(old){need(old.requestSha256===requestSha256,'CONSOLE_WORKFLOW_RUN_CONFLICT','This run identifier belongs to different original inputs.',409);return{run:old,reused:true};}
      need(profile.hostFingerprint===host.configurationFingerprint&&request.hostFingerprint===host.configurationFingerprint,
        'CONSOLE_HOST_CHANGED','Review and bind this profile to the original configured host before starting its workflow.');
      const at=now();
      const value={schema:WORKFLOW_RUN_SCHEMA,...request,requestSha256,workspaceId:this.store.id,ownerWorkspaceId:this.store.id,executionHostFingerprint:request.hostFingerprint,handover:null,revision:1,
        createdAt:at,updatedAt:at,completedAt:null,state:'READY',pauseRequested:false,error:null,
        steps:definition.steps.map(step=>({id:step.id,callId:workflowCallId(request.id,step.id),draftId:workflowDraftId(request.id,step.id),
          draftRevision:null,state:'PENDING',argumentsSha256:null,resolvedCallId:null,resolutionNote:'',completedAt:null})),
        events:[{sequence:1,at,kind:'RUN_SAVED',stepId:null,callId:null,detail:{workflowRevision:definition.revision}}]};
      this.db.prepare('INSERT INTO workflow_runs VALUES(?,?,?)').run(value.id,profile.id,JSON.stringify(value));
      return{run:value,reused:false};
    });
  }
  update(id,kind,mutate,{expectedRevision,stepId=null,callId=null,detail={}}={}){
    return this.store.transaction(()=>{
      const old=this.run(id);
      if(expectedRevision!==undefined)need(old.revision===revision(expectedRevision),'CONSOLE_WORKFLOW_RUN_CHANGED','Reopen the current original workflow run.',409);
      const value=clone(old);mutate(value);
      need(same(runRequest(value),runRequest(old))&&value.workspaceId===old.workspaceId,'CONSOLE_WORKFLOW_RUN_CHANGED','Keep the original saved run request and source workspace.',409);
      if(same(value,old))return old;
      value.revision=old.revision+1;value.updatedAt=kind==='HANDED_OVER'?value.handover.at:now();
      value.events.push({sequence:old.events.length+1,at:value.updatedAt,kind,stepId,callId,detail:clone(detail)});
      this.db.prepare('UPDATE workflow_runs SET value=? WHERE id=?').run(JSON.stringify(value),id);return value;
    });
  }
}
