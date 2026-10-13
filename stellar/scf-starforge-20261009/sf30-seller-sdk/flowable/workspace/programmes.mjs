// MIT. Saved programme intake and step preparation inside the existing workspace owner.
import {randomUUID} from 'node:crypto';
import {validateFlowableProgramme,resolveProgrammeSelection,programmeProgress} from './programme-core.mjs';
import {field,recordId,requestId,idFor,textHash} from './store.mjs';
import {need,digest,now} from '../../../distribution/runtime-workspace/storage.mjs';
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const family=kind=>kind.startsWith('case')?'case':kind.startsWith('decision')?'decision':'process';
const copy=value=>JSON.parse(JSON.stringify(value));
export function createFlowableProgrammeActions({store,lookupConnection,sameConfiguration,prepareOperation,readDocument}){
 function request(input,method){
  requestId(input.requestId);const{signal,...args}=input;
  return{id:input.requestId,sha256:textHash({method,args})};
 }
 async function original(input){
  const record=await store.get('programme',recordId(input.id),input.revision);
  const source=await store.readBlob(record.value.programmeSource);
  const spec=validateFlowableProgramme(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(source)));
  need(digest(source)===record.value.programmeSha256,'FLOWABLE_PROGRAMME_SOURCE_CHANGED');
  return{record,spec};
 }
 async function stateOf(record,spec){
  const records={};
  for(const attempts of Object.values(record.value.attempts))for(const attempt of attempts){
   const head=await store.head(attempt.kind,attempt.operationId);
   if(head)records[attempt.operationId]=await store.get(attempt.kind,attempt.operationId);
  }
  const progress=programmeProgress(spec,record.value.attempts,records);
  return{records,progress,basisSha256:textHash({programmeSha256:record.value.programmeSha256,basis:progress.basis})};
 }
 async function readProgramme(input){
  const{record,spec}=await original(input),state=await stateOf(record,spec),review=record.value.reviews.at(-1)??null;
  return{schema:'stellar-forge.flowable-programme-view.v1',record:ref(record),label:record.value.label,note:spec.note??'',
   connectionId:record.value.connectionId,programmeKey:spec.key,programmeSha256:record.value.programmeSha256,
   source:record.value.programmeSource,sources:record.value.sources,
   progress:state.progress,basisSha256:state.basisSha256,
   review:review?{...review,current:review.basisSha256===state.basisSha256}:null,
   reviewHistory:record.value.reviews,programme:spec};
 }
 async function saveProgramme(input){
  const req=request(input,'saveProgramme'),prior=await store.findRequest(req.id,req.sha256);if(prior)return prior;
  need(typeof input.programmeText==='string'&&Buffer.byteLength(input.programmeText,'utf8')<=16*1024*1024,'FLOWABLE_PROGRAMME_SOURCE_LIMIT');
  const spec=validateFlowableProgramme(JSON.parse(input.programmeText));
  need(new Set(spec.steps.map(step=>family(step.kind))).size===1,'FLOWABLE_PROGRAMME_ENGINE_SCOPE',
   'A programme selects one process, decision or case REST service. Save a separate programme for another service.');
  const selected=await lookupConnection(input.connectionId),sources=[];
  for(const source of spec.sources){
   const bytes=Buffer.from(source.contentBase64,'base64');
   need(bytes.toString('base64')===source.contentBase64&&bytes.length===source.bytes&&digest(bytes)===source.sha256,
    'FLOWABLE_PROGRAMME_MEMBER_CHANGED','The complete programme source differs: '+source.name);
   sources.push({name:source.name,reference:await store.putBlob(bytes,source.mediaType??'application/octet-stream')});
  }
  const bytes=Buffer.from(input.programmeText,'utf8');
  return store.commit('programme',idFor(req.id),{expectedRevision:0,requestId:req.id,requestSha256:req.sha256,value:{
   label:spec.label,programmeKey:spec.key,programmeSha256:digest(bytes),
   programmeSource:await store.putBlob(bytes,'application/json'),sources,connectionId:selected.record.id,
   configurationSha256:selected.record.value.configurationSha256,connection:selected.connection,
   state:'SAVED',phase:'SAVED',attempts:{},commands:{},reviews:[],
   summary:{steps:spec.steps.length,sources:sources.length,engine:family(spec.steps[0].kind)}}});
 }
 async function prepareProgrammeStep(input,signal){
  const req=request(input,'prepareProgrammeStep'),prior=await store.findRequest(req.id,req.sha256);
  let{record,spec}=await original(input),attempt;
  await sameConfiguration(record);
  if(prior){
   need(prior.kind==='programme'&&prior.id===record.id,'FLOWABLE_PROGRAMME_REQUEST_CHANGED');
   const command=record.value.commands[req.id];
   need(command&&command.stepKey===input.stepKey,'FLOWABLE_PROGRAMME_COMMAND_MISSING');
   attempt=Object.hasOwn(record.value.attempts,command.stepKey)?record.value.attempts[command.stepKey][command.attempt]:null;
   need(attempt,'FLOWABLE_PROGRAMME_ATTEMPT_MISSING');
  }else{
   need(record.revision===input.expectedRevision,'FLOWABLE_RECORD_CONFLICT','Reload the current programme.',409);
   const step=spec.steps.find(row=>row.key===input.stepKey);need(step,'FLOWABLE_PROGRAMME_STEP_MISSING');
   const state=await stateOf(record,spec),row=state.progress.rows.find(item=>item.key===step.key);
   need(row.waitingFor.length===0,'FLOWABLE_PROGRAMME_DEPENDENCIES','Complete the original dependencies: '+row.waitingFor.join(', '),409);
   if(row.selected){
    need(input.renew===true&&row.record&&!row.record.dispatchedAt&&
     ['STALE','INVALID','PREPARE_FAILED','INTERRUPTED'].includes(row.state),
     'FLOWABLE_PROGRAMME_ORIGINAL_REQUEST','Resume or reconcile the existing saved step; renew only an undispatched unsuccessful review.',409);
   }else need(input.renew!==true,'FLOWABLE_PROGRAMME_RENEW_INVALID');
   const resolveDocument=async(stepKey,document)=>{
    const dependency=state.progress.rows.find(item=>item.key===stepKey);
    need(dependency?.record?.state==='CONFIRMED','FLOWABLE_PROGRAMME_DEPENDENCY_CHANGED',undefined,409);
    const selected=state.records[dependency.record.id];
    return{record:ref(selected),value:await readDocument(selected,document)};
   };
   const resolved=await resolveProgrammeSelection(step,resolveDocument);
   const prepareId=randomUUID(),command={...input};delete command.signal;
   attempt={index:(Object.hasOwn(record.value.attempts,step.key)?record.value.attempts[step.key]:[]).length,kind:step.kind,
    operationId:idFor(prepareId),createdAt:now(),command,
    evidence:resolved.evidence,
    input:{requestId:prepareId,connectionId:record.value.connectionId,label:(spec.label+' · '+step.label).slice(0,300),
     note:step.note??spec.note??'',selection:resolved.selection}};
   const value=copy(record.value);
   if(!Object.hasOwn(value.attempts,step.key))value.attempts[step.key]=[];
   value.attempts[step.key].push(attempt);
   value.commands[req.id]={stepKey:step.key,attempt:attempt.index};value.state='IN_PROGRESS';value.phase='IN_PROGRESS';
   value.summary={...value.summary,started:Object.keys(value.attempts).length};
   record=await store.commit('programme',record.id,{expectedRevision:record.revision,requestId:req.id,requestSha256:req.sha256,value});
  }
  // The exact child input and ID precede preparation. The original native model owns all transport.
  const operation=await prepareOperation(attempt.kind,attempt.input,signal);
  need(operation.id===attempt.operationId,'FLOWABLE_PROGRAMME_CHILD_CHANGED');
  return{programme:ref(record),stepKey:input.stepKey,attempt:attempt.index,operation};
 }
 async function reviewProgramme(input){
  const req=request(input,'reviewProgramme'),prior=await store.findRequest(req.id,req.sha256);if(prior)return prior;
  const{record,spec}=await original(input),state=await stateOf(record,spec);
  need(record.revision===input.expectedRevision&&input.basisSha256===state.basisSha256,
   'FLOWABLE_PROGRAMME_REVIEW_CHANGED','Reload the exact current programme and native outcomes.',409);
  need(['accepted','changes-requested'].includes(input.decision),'FLOWABLE_PROGRAMME_REVIEW_INVALID');
  need(input.decision!=='accepted'||state.progress.state==='COMPLETED','FLOWABLE_PROGRAMME_INCOMPLETE',
   'Acceptance requires every saved native step to be confirmed.',409);
  const review={decision:input.decision,reviewer:field(input.reviewer,300,true),note:field(input.note??'',20000,true),
   reviewedAt:now(),basisSha256:state.basisSha256,basis:state.progress.basis,programmeSha256:record.value.programmeSha256};
  return store.commit('programme',record.id,{expectedRevision:record.revision,requestId:req.id,requestSha256:req.sha256,
   value:{...record.value,state:state.progress.state,phase:state.progress.state,
    reviews:[...record.value.reviews,review],summary:{...record.value.summary,confirmed:state.progress.confirmed,review:review.decision}}});
 }
 return{saveProgramme,readProgramme,prepareProgrammeStep,reviewProgramme};
}
