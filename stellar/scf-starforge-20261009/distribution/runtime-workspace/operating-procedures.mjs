// MIT. Customer procedures over original Runtime records and Operating Plans.
import { join } from 'node:path';
import { mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { privateDirectory, optionalPrivateEntries, regular, readJSON, saveJSON,
  operationId, recordId, operationLease, withWorkspaceWrite, workspaceReceivingState,
  absolute, plain, need, json, canonical, now } from './storage.mjs';
import { inspectOperatingPlan, createOperatingPlan, createOperatingStep,
  operatingPlanDraft, saveOperatingPlanRevision, summarizeOperatingPlan,
  createOperatingFile, operatingFileBytes, addOperatingFile,
  renderOperatingPlanHTML } from '../discovery/operating-plan.mjs';
import { inspectOperatingPlanReturn, createOperatingPlanReturn, compareOperatingPlanReturn,
  decideOperatingPlanReturn, applyOperatingPlanReturn,
  renderOperatingPlanReturnHTML } from '../discovery/operating-plan-return.mjs';

export const RUNTIME_PROCEDURE_SCHEMA = 'stellar-forge.runtime-operating-procedure.v1';
export const RUNTIME_CAPTURE_SCHEMA = 'stellar-forge.runtime-operating-capture.v1';
export const RUNTIME_PROCEDURE_MAX_BYTES = 256 * 1024 * 1024;
export const RUNTIME_PROCEDURE_BODY_MAX_BYTES = RUNTIME_PROCEDURE_MAX_BYTES + 1024 * 1024;
const PLAN_MAX = 32 * 1024 * 1024, BACKUP_RECORD_MAX = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => json(canonical(a)) === json(canonical(b));
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.from(json(value));
const only = (value, keys) => need(plain(value) && Object.keys(value).every(k=>keys.includes(k)), 'RUNTIME_PROCEDURE_FIELDS');
const text = (value, name, limit=32000) => { need(typeof value==='string' && value.length<=limit && !value.includes('\0'), 'RUNTIME_PROCEDURE_TEXT', name+' must be complete text.'); return value; };
const stamp = value => need(typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value, 'RUNTIME_PROCEDURE_TIME');
const bounded = (value, maximum, code) => { const b=bytes(value); need(b.length<=maximum, code, 'Keep the complete original document; this selected document exceeds its native capacity.', 413); return b; };
function checkedPlan(value) { bounded(value,PLAN_MAX,'RUNTIME_PROCEDURE_PLAN_CAPACITY'); return inspectOperatingPlan(value); }
function selection(value={}) {
  only(value,['runtimeIds','operationIds','archiveIds','backupOperationIds','storageDirectory']);
  const result={};
  for(const key of ['runtimeIds','operationIds','archiveIds','backupOperationIds']) {
    const values=value[key]??[]; need(Array.isArray(values),'RUNTIME_PROCEDURE_SELECTION');
    const check=key==='runtimeIds'||key==='archiveIds'?recordId:operationId;
    result[key]=values.map(check); need(new Set(result[key]).size===result[key].length,'RUNTIME_PROCEDURE_DUPLICATE_SELECTION');
  }
  if(value.storageDirectory!==undefined)result.storageDirectory=absolute(value.storageDirectory);
  return result;
}
function checkedCapture(value) {
  only(value,['id','stepId','fileId','capturedAt','sha256','bytes','selection']);
  operationId(value.id); text(value.stepId,'Step identity',128); text(value.fileId,'File identity',128);
  stamp(value.capturedAt); need(HASH.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)&&value.bytes>0,'RUNTIME_PROCEDURE_CAPTURE_IDENTITY');
  selection(value.selection); return value;
}
/** Validate full history and every original captured file, including removed historical files. */
export function inspectRuntimeProcedure(input) {
  bounded(input,RUNTIME_PROCEDURE_MAX_BYTES,'RUNTIME_PROCEDURE_CAPACITY');
  only(input,['schema','id','workspaceId','createdAt','revision','plan','captures','returnReviews','requests']);
  need(input.schema===RUNTIME_PROCEDURE_SCHEMA,'RUNTIME_PROCEDURE_SCHEMA');
  operationId(input.id); operationId(input.workspaceId); stamp(input.createdAt);
  need(Number.isSafeInteger(input.revision)&&input.revision>0,'RUNTIME_PROCEDURE_REVISION');
  const plan=checkedPlan(input.plan); need(plan.id==='runtime-procedure-'+input.id,'RUNTIME_PROCEDURE_PLAN_IDENTITY');
  need(Array.isArray(input.captures)&&Array.isArray(input.returnReviews)&&Array.isArray(input.requests),'RUNTIME_PROCEDURE_COLLECTIONS');
  const captures=new Set(), files=new Map();
  for(const revision of plan.revisions)for(const step of revision.steps)for(const file of step.files??[]){
    const versions=files.get(file.id)??[];versions.push({file,stepId:step.id});files.set(file.id,versions);
  }
  for(const raw of input.captures) {
    const capture=checkedCapture(raw); need(!captures.has(capture.id),'RUNTIME_PROCEDURE_CAPTURE_DUPLICATE');captures.add(capture.id);
    const versions=files.get(capture.fileId); need(versions?.some(v=>v.stepId===capture.stepId),'RUNTIME_PROCEDURE_CAPTURE_FILE_MISSING');
    const content=operatingFileBytes(versions[0].file);
    for(const version of versions)need(hash(operatingFileBytes(version.file))===capture.sha256,'RUNTIME_PROCEDURE_CAPTURE_FILE_CHANGED');
    need(content.length===capture.bytes&&hash(content)===capture.sha256,'RUNTIME_PROCEDURE_CAPTURE_CHANGED');
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}catch{need(false,'RUNTIME_PROCEDURE_CAPTURE_JSON');}
    need(body.schema===RUNTIME_CAPTURE_SCHEMA&&body.id===capture.id&&body.capturedAt===capture.capturedAt&&same(body.selection,capture.selection),
      'RUNTIME_PROCEDURE_CAPTURE_SOURCE');
    operationId(body.workspaceId); stamp(body.startedAt); stamp(body.capturedAt);
  }
  const historyPrefix = (earlier) => earlier.id === plan.id && earlier.createdAt === plan.createdAt &&
    same(earlier.origin,plan.origin) && earlier.revisions.length <= plan.revisions.length &&
    earlier.revisions.every((revision,index)=>same(revision,plan.revisions[index]));
  const reviews=new Set();
  for(const raw of input.returnReviews) {
    const review=inspectOperatingPlanReturn(raw);
    need(historyPrefix(review.current)&&(!review.completion||historyPrefix(review.completion.plan))&&
      !reviews.has(review.id),'RUNTIME_PROCEDURE_RETURN_IDENTITY');reviews.add(review.id);
  }
  const requests=new Set();let prior=0;
  for(const item of input.requests){
    only(item,['requestId','inputSha256','at','action','revision']);operationId(item.requestId);stamp(item.at);
    need(HASH.test(item.inputSha256??'')&&typeof item.action==='string'&&Number.isSafeInteger(item.revision)&&item.revision===prior+1&&item.revision<=input.revision&&!requests.has(item.requestId),'RUNTIME_PROCEDURE_REQUEST_HISTORY');
    prior=item.revision;requests.add(item.requestId);
  }
  need(input.requests.length>0&&prior===input.revision,'RUNTIME_PROCEDURE_REQUEST_HISTORY');
  return clone(input);
}
async function ensureDirectory(path) {
  try {
    await mkdir(path,{mode:0o700});
    const parent=await open(join(path,'..'),'r');try{await parent.sync();}finally{await parent.close();}
  } catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
async function readComplete(file, optional=false, maximum=RUNTIME_PROCEDURE_MAX_BYTES) {
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await regular(file,maximum)));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
}
function view(record,reused=false) {
  return {recordSha256:hash(bytes(record)),record,reused,
    returnComparisons:record.returnReviews.map(review=>({reviewId:review.id,comparison:compareOperatingPlanReturn(review)}))};
}
const HTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function completeHTML(record) {
  const encoded=bytes(record).toString('base64'), summary=summarizeOperatingPlan(record.plan);
  const frames=record.plan.revisions.map(r=>'<section><h2>Saved plan revision '+r.revision+'</h2><iframe title="Plan revision '+r.revision+'" sandbox="allow-downloads" srcdoc="'+HTML(renderOperatingPlanHTML(record.plan,{revision:r.revision}))+'"></iframe></section>').join('');
  const reviews=record.returnReviews.map(r=>'<section><h2>Returned work '+HTML(r.id)+'</h2><iframe title="Returned plan review" sandbox="allow-downloads" srcdoc="'+HTML(renderOperatingPlanReturnHTML(r))+'"></iframe></section>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+HTML(summary.title)+'</title><style>body{font:16px system-ui;color:#202020;background:#fff;max-width:1100px;margin:2rem auto;padding:0 1rem}h1,h2{line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:1rem}iframe{width:100%;height:48rem;border:1px solid #aaa}a{color:inherit}section{margin:2rem 0}</style><h1>'+HTML(summary.title)+'</h1><p>Complete Runtime operating procedure '+HTML(record.id)+' · saved record '+record.revision+'</p><p><a download="'+record.id+'.json" href="data:application/json;base64,'+encoded+'">Download complete editable procedure and history</a></p><p>Captured source is the actual original Runtime response or saved backup record at the stated observation time. Continue runtime lifecycle work through its original controls.</p>'+frames+reviews+'<details><summary>Complete source captures and request history</summary><pre>'+HTML(json({captures:record.captures,requests:record.requests}))+'</pre></details></html>\n';
}
/** Passive backup inspection: never initialize a store, launch a worker or probe a lease. */
async function savedBackups(root,options={}) {
  const receiving=await workspaceReceivingState(root), storageDirectory=absolute(options.storageDirectory??receiving?.storageDirectory??root+'.backups');
  try{await privateDirectory(storageDirectory);}catch(error){if(error.code==='ENOENT')return {storageDirectory,receiving,operations:[]};throw error;}
  const store=await readComplete(join(storageDirectory,'store.json'),false,BACKUP_RECORD_MAX);
  need(store?.schema==='stellar-forge.runtime-workspace-backup-store.v1'&&store.directory===storageDirectory,'RUNTIME_PROCEDURE_BACKUP_STORE');
  const operations=[];
  for(const id of (await optionalPrivateEntries(join(storageDirectory,'operations'))).filter(n=>UUID.test(n)).sort()){
    const dir=await privateDirectory(join(storageDirectory,'operations',id));
    const operation=await readComplete(join(dir,'operation.json'),true,BACKUP_RECORD_MAX);
    const request=await readComplete(join(dir,'request.json'),true,BACKUP_RECORD_MAX);
    if(!operation&&!request)continue;
    need(!operation||operation.operationId===id,'RUNTIME_PROCEDURE_BACKUP_IDENTITY');
    const reviewId=request?.original?.input?.reviewId;
    let review=null;
    if(reviewId){operationId(reviewId);await privateDirectory(join(storageDirectory,'reviews',reviewId));review=await readComplete(join(storageDirectory,'reviews',reviewId,'review.json'),false,BACKUP_RECORD_MAX);}
    operations.push({operationId:id,operation,request,review});
  }
  return {storageDirectory,receiving,operations};
}
export function createRuntimeProceduresAPI(root,workspaceId,getModel) {
  absolute(root);operationId(workspaceId);
  const home=join(root,'operating-procedures'), path=id=>join(home,operationId(id)+'.json');
  async function read(id,optional=false){try{await privateDirectory(home);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}const value=await readComplete(path(id),optional);return value?inspectRuntimeProcedure(value):null;}
  async function mutate(action,input,keys,callback,{create=false}={}) {
    only(input,['requestId',...(create?[]:['procedureId','expectedSha256']),...keys]);
    const requestId=operationId(input.requestId),id=create?requestId:operationId(input.procedureId);
    const inputSha256=hash(bytes(canonical({action,input})));
    return withWorkspaceWrite(root,async()=>{
      const config=await readJSON(join(root,'workspace.json'));
      need(config?.workspaceId===workspaceId,'RUNTIME_PROCEDURE_WORKSPACE_CHANGED','Reopen this original Runtime workspace.',409);
      await ensureDirectory(home);
      const lock=await operationLease(join(home,id+'.lock'));
      try{
        const current=await read(id,true);
        const accepted=current?.requests.find(r=>r.requestId===requestId);
        if(accepted){need(accepted.inputSha256===inputSha256&&accepted.action===action,'RUNTIME_PROCEDURE_REQUEST_REUSED','This request ID already names different retained work.',409);return view(current,true);}
        if(create)need(!current,'RUNTIME_PROCEDURE_ALREADY_EXISTS','Open this retained procedure before editing.',409);
        else need(current&&HASH.test(input.expectedSha256??'')&&hash(bytes(current))===input.expectedSha256,
          'RUNTIME_PROCEDURE_CHANGED','Reopen the latest saved procedure and keep your complete draft before resolving concurrent edits.',409);
        const at=now(),next=await callback(current,at);
        next.revision=(current?.revision??0)+1;
        next.requests.push({requestId,inputSha256,at,action,revision:next.revision});
        const checked=inspectRuntimeProcedure(next);
        await saveJSON(path(id),checked,Boolean(current));return view(checked);
      }finally{await lock.close();}
    });
  }
  async function capture(id,chosen) {
    const selected=selection(chosen),startedAt=now(),model=getModel(),snapshot=await model.state();
    need(snapshot.workspaceId===workspaceId,'RUNTIME_PROCEDURE_WORKSPACE_CHANGED');
    const runtimes=[];
    for(const runtimeId of selected.runtimeIds){
      const detail=await model.state({runtimeId});need(detail.selected?.id===runtimeId,'RUNTIME_PROCEDURE_RUNTIME_MISSING');
      runtimes.push({runtime:detail.selected,observation:detail.observation,operationObservation:detail.operationObservation});
    }
    const operations=[];for(const operationId of selected.operationIds)operations.push(await model.operationStatus({operationId}));
    const archives=selected.archiveIds.map(id=>{const item=snapshot.archives.find(a=>a.id===id);need(item,'RUNTIME_PROCEDURE_ARCHIVE_MISSING');return item;});
    let backups={storageDirectory:selected.storageDirectory??null,receiving:null,operations:[]};
    if(selected.backupOperationIds.length){
      const current=await savedBackups(root,selected);
      backups={...current,operations:selected.backupOperationIds.map(id=>{const item=current.operations.find(o=>o.operationId===id);need(item,'RUNTIME_PROCEDURE_BACKUP_MISSING');return item;})};
    }
    const content={schema:RUNTIME_CAPTURE_SCHEMA,id,workspaceId,directory:root,startedAt,capturedAt:now(),selection:selected,
      scope:'Complete selected original Runtime views and saved backup records read during this capture interval. Captures do not execute lifecycle work. Full native archive bytes remain at their original named archive identity and download controls.',
      runtimes,operations,archives,backups};
    const raw=bytes(content),file=createOperatingFile({id:'runtime-capture-'+id,name:'Runtime-source-'+id+'.json',mediaType:'application/json',bytes:raw,note:content.scope});
    return {file,meta:{id,stepId:'',fileId:file.id,capturedAt:content.capturedAt,sha256:hash(raw),bytes:raw.length,selection:selected}};
  }
  function appendCapture(record,stepId,captured,draft) {
    captured.meta.stepId=stepId;record.captures.push(captured.meta);
    return addOperatingFile(draft,stepId,captured.file);
  }
  function reviewIndex(record,id){const i=record.returnReviews.findIndex(r=>r.id===id);need(i>=0,'RUNTIME_PROCEDURE_RETURN_MISSING');return i;}
  return {
    async runtimeProceduresState(options={}) {
      only(options,['storageDirectory']);
      const procedures=[];
      for(const name of (await optionalPrivateEntries(home)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).sort()){
        const record=await read(name.slice(0,-5));
        procedures.push({id:record.id,recordSha256:hash(bytes(record)),recordRevision:record.revision,
          plan:summarizeOperatingPlan(record.plan),captureCount:record.captures.length,returnCount:record.returnReviews.length});
      }
      const state=await getModel().state(),backups=await savedBackups(root,options);
      return {workspaceId,procedures,source:{runtimes:state.runtimes,operations:state.operations,archives:state.archives,backups}};
    },
    async runtimeProcedureRead(input={}) {only(input,['procedureId']);return view(await read(input.procedureId));},
    async runtimeProcedureCreate(input) {
      return mutate('create',input,['title','customer','owner','period','purpose','selection'],async(_,at)=>{
        const captured=await capture(input.requestId,input.selection);
        const stepId='review-retained-source';
        const first=createOperatingStep({id:stepId,title:'Review retained Runtime source',instruction:'Read the complete selected runtime, operation, archive and backup records. Record the chosen operating scope and unresolved observations.',expectedResult:'An attributed operating decision tied to the complete captured source.',owner:input.owner??'',files:[captured.file]});
        const steps=[first,
          createOperatingStep({id:'perform-runtime-work',title:'Perform approved Runtime work',instruction:'Use the original Runtime application, installation, backup or receiving controls for the selected work. Record actual outcomes and capture the resulting native operation records.',expectedResult:'Saved native outcomes and an attributed result.',owner:input.owner??''}),
          createOperatingStep({id:'review-receiving',title:'Review received and reopened work',instruction:'Reopen the selected native output through its original receiving workflow. Capture the saved receiving operation and record what the receiving operator observed.',expectedResult:'A retained receiving result with the exact native source identity.',owner:input.owner??''}),
          createOperatingStep({id:'handover',title:'Hand over the complete operating procedure',instruction:'Review saved steps, original files and changes. Export the complete procedure for the receiving operator and review returned plan revisions in this original procedure.',expectedResult:'Complete editable history and explicitly reviewed returned work.',owner:input.owner??''})];
        const plan=createOperatingPlan({id:'runtime-procedure-'+input.requestId,title:input.title,customer:input.customer??'',owner:input.owner??'',period:input.period??'',purpose:input.purpose??'',receiving:'Receive the complete Runtime procedure JSON, continue its original Operating Plan, and return that complete plan for review.',notes:'Original Runtime workspace '+workspaceId+'. Complete observations are carried as original files on the reviewed steps.',steps,savedAt:at});
        captured.meta.stepId=stepId;
        return {schema:RUNTIME_PROCEDURE_SCHEMA,id:input.requestId,workspaceId,createdAt:at,revision:0,plan,captures:[captured.meta],returnReviews:[],requests:[]};
      },{create:true});
    },
    async runtimeProcedureSave(input) {
      return mutate('save',input,['draft'],async(record,at)=>({...record,plan:saveOperatingPlanRevision(record.plan,input.draft,{savedAt:at})}));
    },
    async runtimeProcedureRecord(input) {
      return mutate('record',input,['stepId','status','recordedResult','owner','selection'],async(record,at)=>{
        const draft=operatingPlanDraft(record.plan),step=draft.content.steps.find(s=>s.id===input.stepId);
        need(step,'RUNTIME_PROCEDURE_STEP_MISSING');text(input.recordedResult,'Recorded result');text(input.owner,'Recording owner');
        need(input.owner.trim(),'RUNTIME_PROCEDURE_RECORDING_OWNER','Name the operator recording this result.');
        const captured=await capture(input.requestId,input.selection);
        step.status=input.status;step.recordedResult=input.recordedResult;step.owner=input.owner;
        const next=appendCapture(record,step.id,captured,draft);
        record.plan=saveOperatingPlanRevision(record.plan,next,{savedAt:at});return record;
      });
    },
    async runtimeProcedureReturn(input) {
      return mutate('return',input,['incoming','reviewer','notes'],async(record,at)=>{
        const review=createOperatingPlanReturn(record.plan,checkedPlan(input.incoming),{id:input.requestId,reviewer:input.reviewer??'',notes:input.notes??'',createdAt:at});
        record.returnReviews.push(review);return record;
      });
    },
    async runtimeProcedureDecide(input) {
      return mutate('decide',input,['reviewId','key','decision'],async(record)=>{
        const i=reviewIndex(record,input.reviewId);record.returnReviews[i]=decideOperatingPlanReturn(record.returnReviews[i],input.key,input.decision);return record;
      });
    },
    async runtimeProcedureApply(input) {
      return mutate('apply',input,['reviewId'],async(record,at)=>{
        const i=reviewIndex(record,input.reviewId),applied=applyOperatingPlanReturn(record.returnReviews[i],{current:record.plan,savedAt:at});
        record.plan=applied.plan;record.returnReviews[i]=applied.review;
        const known=new Set(record.captures.map(c=>c.id));
        for(const revision of record.plan.revisions)for(const step of revision.steps)for(const file of step.files??[]) {
          if(!file.id.startsWith('runtime-capture-'))continue;
          const content=operatingFileBytes(file);let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}catch{continue;}
          if(body?.schema!==RUNTIME_CAPTURE_SCHEMA||known.has(body.id))continue;
          operationId(body.id);need(file.id==='runtime-capture-'+body.id,'RUNTIME_PROCEDURE_CAPTURE_IDENTITY');
          record.captures.push({id:body.id,stepId:step.id,fileId:file.id,capturedAt:body.capturedAt,sha256:hash(content),bytes:content.length,selection:selection(body.selection)});known.add(body.id);
        }
        return record;
      });
    },
    async runtimeProcedureReceive(input) {
      only(input,['requestId','document']);operationId(input.requestId);
      const incoming=inspectRuntimeProcedure(input.document);
      return withWorkspaceWrite(root,async()=>{
        const config=await readJSON(join(root,'workspace.json'));need(config?.workspaceId===workspaceId,'RUNTIME_PROCEDURE_WORKSPACE_CHANGED');
        await ensureDirectory(home);const lock=await operationLease(join(home,incoming.id+'.lock'));
        try{
          const current=await read(incoming.id,true),inputSha256=hash(bytes(canonical({action:'receive',input})));
          const accepted=current?.requests.find(r=>r.requestId===input.requestId);
          if(accepted){need(accepted.action==='receive'&&accepted.inputSha256===inputSha256,'RUNTIME_PROCEDURE_REQUEST_REUSED');return view(current,true);}
          if(current)need(same(current,incoming),'RUNTIME_PROCEDURE_RECEIVE_DIVERGED','This original procedure has saved changes. Review the incoming original plan with Returned work.',409);
          need(!incoming.requests.some(r=>r.requestId===input.requestId),'RUNTIME_PROCEDURE_REQUEST_REUSED');
          const received=clone(incoming);received.revision++;
          received.requests.push({requestId:input.requestId,inputSha256,at:now(),action:'receive',revision:received.revision});
          const checked=inspectRuntimeProcedure(received);
          await saveJSON(path(incoming.id),checked,Boolean(current));return view(checked,Boolean(current));
        }finally{await lock.close();}
      });
    },
    async runtimeProcedureExport(input) {
      only(input,['procedureId','format','reviewId']);const record=await read(input.procedureId);
      let content,mediaType='application/json',suffix='.json';
      if(input.format==='json')content=json(record);
      else if(input.format==='plan-json')content=json(record.plan);
      else if(input.format==='html'){content=completeHTML(record);mediaType='text/html; charset=utf-8';suffix='.html';}
      else if(input.format==='plan-html'){content=renderOperatingPlanHTML(record.plan);mediaType='text/html; charset=utf-8';suffix='-plan.html';}
      else need(false,'RUNTIME_PROCEDURE_EXPORT_FORMAT');
      if(input.reviewId){need(input.format==='html','RUNTIME_PROCEDURE_RETURN_EXPORT_FORMAT');content=renderOperatingPlanReturnHTML(record.returnReviews[reviewIndex(record,input.reviewId)]);suffix='-returned-work.html';}
      return {filename:record.id+(input.format==='plan-json'?'-plan.json':suffix),mediaType,content,sha256:hash(content),bytes:Buffer.byteLength(content)};
    }
  };
}
