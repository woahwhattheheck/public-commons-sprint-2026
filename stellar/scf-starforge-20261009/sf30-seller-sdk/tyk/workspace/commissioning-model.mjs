// MIT. Native cohort bindings owned by the original leased Tyk workspace.
import { createHash } from 'node:crypto';
import { need, now } from '../../../distribution/runtime-workspace/storage.mjs';
import { textHash, field, requestId, idFor } from './store.mjs';
import { TYK_COMMISSIONING_SCHEMA, createTykCommissioningPlan, commissioningRecordRef as ref,
  commissioningProgress, commissioningReviewContext, commissioningObservation, commissioningChecks,
  validateCommissioningReview, updateCommissioningPlan, commissioningSupportingFile } from './commissioning.mjs';
const titled=(label,suffix)=>label.slice(0,297-suffix.length)+' · '+suffix;
const childId=(id,name)=>{const h=textHash({id,name});return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export function createTykCommissioningMethods({store,lookupConnection,replay,initial,getRecord,prepareRollout,capture}) {
  async function details(record){
    const value=record.value,cohort=await store.get('cohort',value.cohort.id,value.cohort.revision);
    need(cohort.sha256===value.cohort.sha256,'TYK_COMMISSIONING_SOURCE_CHANGED');
    const output={cohort};
    for(const [step,key] of [['conversion','conversion'],['staging','staging'],['promotion','promotion']]){
      const selected=value.bindings?.[step];output[key]=selected?await getRecord({kind:'rollout',id:selected.id}):null;
      if(output[key]?.value.review){
        const report=await store.getJSON(output[key].value.review);
        output[key].definitionCoverage={planSha256:report.planSha256,apis:report.sources.map(row=>({
          apiId:row.apiId,before:row.before.state,after:row.after.state}))};
      }
    }
    for(const [key,phase]of [['observation','staged'],['finalObservation','final']]){
      const selected=value[key];if(!selected){output[key]=null;continue;}
      const original=await store.get('capture',selected.id,selected.revision);
      need(original.sha256===selected.sha256,'TYK_COMMISSIONING_CAPTURE_CHANGED');
      const inventory=original.value.inventory?await store.getJSON(original.value.inventory):null;
      output[key]=commissioningObservation({...output,capture:original,inventory,phase});
    }
    return output;
  }
  async function readCommissioning(input){
    const record=await store.get('commissioning',input.id,input.revision),source=await details(record);
    const progress=commissioningProgress(record.value,source,{hash:textHash});
    const reviewContexts={};
    for(const stepId of ['conversion-review','production-review']){
      try{const context=commissioningReviewContext(record.value,source,stepId);reviewContexts[stepId]={context,sha256:textHash(context)};}catch{}
    }
    return {record,progress,cohort:source.cohort,rollouts:Object.fromEntries(['conversion','staging','promotion'].map(key=>[key,source[key]])),
      observation:source.observation,finalObservation:source.finalObservation,reviewContexts,
      workshare:record.value.workshare??null,plan:await store.getJSON(record.value.manuscript)};
  }
  async function completedValue(record,value){
    const current={...record,value},source=await details(current),progress=commissioningProgress(value,source,{hash:textHash});
    const original=await store.getJSON(value.manuscript);
    const plan=updateCommissioningPlan(original,progress,value.reviews,value.supportingFiles,now());
    return {...value,state:progress.state,summary:progress.summary,manuscript:await store.putJSON(plan)};
  }
  async function finish(record,value){return store.revise(record,await completedValue(record,value));}
  async function target(value){
    const selected=await lookupConnection(value.connectionId);
    need(selected.connection.kind==='dashboard'&&selected.record.value.configurationSha256===value.configurationSha256,
      'TYK_COMMISSIONING_TARGET_CHANGED','Reopen and review the current original Dashboard target.',409);return selected;
  }
  function sourceFile(file,id){
    need(file&&typeof file.contentBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64),
      'TYK_COMMISSIONING_FILE_INVALID');
    const bytes=Buffer.from(file.contentBase64,'base64');
    need(bytes.toString('base64')===file.contentBase64,'TYK_COMMISSIONING_FILE_INVALID');
    return commissioningSupportingFile({id,name:file.name,mediaType:file.mediaType,bytes,note:file.note??''});
  }
  async function createCommissioning(input){
    const {prior}=await replay(input,'createCommissioning',true);if(prior)return prior;
    const cohort=await store.get('cohort',input.cohortId,input.cohortRevision);
    need(cohort.value.apiIds.length>0&&cohort.value.apis.every(item=>item.kind==='classic'&&item.found!==false),
      'TYK_CLASSIC_COHORT_REQUIRED','Select a complete saved Classic API cohort.',409);
    const selected=await lookupConnection(cohort.value.connectionId);
    need(selected.connection.kind==='dashboard','TYK_DASHBOARD_REQUIRED','Native cohort migration uses the original Dashboard.',409);
    const captureRecord=await store.get('capture',cohort.value.capture.id,cohort.value.capture.revision);
    need(captureRecord.sha256===cohort.value.capture.sha256&&captureRecord.value.configurationSha256===selected.record.value.configurationSha256,
      'TYK_COMMISSIONING_TARGET_CHANGED','The saved capture must match this Dashboard configuration.',409);
    const checkNames=commissioningChecks(input.checkNames),label=field(input.label,300,true),
      customer=field(input.customer??'',300),operator=field(input.operator??'',300);
    const workshare=input.workshare?{source:sourceFile(input.workshare,'workshare-source'),
      sourceSha256:createHash('sha256').update(Buffer.from(input.workshare.contentBase64,'base64')).digest('hex'),cohort:ref(cohort),
      connectionId:selected.record.id,configurationSha256:selected.record.value.configurationSha256,checkNames:[...checkNames]}:null;
    const manuscript=await store.putJSON(createTykCommissioningPlan({id:'tyk-'+idFor(input.requestId),label,customer,operator,
      apiIds:cohort.value.apiIds,checks:checkNames,workshare,savedAt:now()}));
    return initial('commissioning',input,'createCommissioning',{schema:TYK_COMMISSIONING_SCHEMA,label,customer,operator,
      cohort:ref(cohort),connectionId:selected.record.id,configurationSha256:selected.record.value.configurationSha256,
      checkNames,abortOnFailure:input.abortOnFailure??true,overrideStaged:input.overrideStaged??false,
      manuscript,workshare,bindings:{},reviews:{},supportingFiles:{},observation:null,finalObservation:null,pending:null,
      state:'IN_PROGRESS',summary:{apis:cohort.value.apiIds.length,steps:7,completed:0,checks:cohort.value.apiIds.length*checkNames.length}});
  }
  async function checkpoint(record,input,method,pending){
    const result=await replay(input,method,true);
    need(!result.prior,'TYK_COMMISSIONING_REQUEST_CHANGED');
    need(!record.value.pending,'TYK_COMMISSIONING_PENDING','Recover the same original commissioning request first.',409);
    need(input.expectedRevision===record.revision,'TYK_RECORD_CONFLICT','Refresh the saved commissioning record.',409);
    return store.commit('commissioning',record.id,{expectedRevision:record.revision,requestId:result.selected.id,
      requestSha256:result.selected.sha256,value:{...record.value,pending:{...pending,requestId:input.requestId,method}}});
  }
  async function finishPreparation(record,signal){
    const pending=record.value.pending;await target(record.value);
    if(pending.retireRollout){
      const previous=await store.get('rollout',pending.retireRollout.id);
      need(!previous.value.dispatchedAt,'TYK_COMMISSIONING_ORIGINAL_REQUEST','Read back the dispatched original promotion.',409);
      if(previous.value.phase!=='STALE'){
        need(previous.value.phase==='PREPARED'&&previous.sha256===pending.retireRollout.sha256,
          'TYK_RECORD_CONFLICT','Refresh the original undispatched promotion.',409);
        await store.revise(previous,{...previous.value,phase:'STALE',state:'STALE',failure:{
          code:'TYK_COMMISSIONING_REVIEW_SUPERSEDED',message:'A later accepted staged source edition replaced this undispatched review.',at:now()}});
      }
    }
    let rollout=await prepareRollout(pending.args,signal);
    if(pending.stepId==='promotion'&&rollout.value.phase==='PREPARED'){
      const source=await details(record),context=commissioningReviewContext(record.value,source,'production-review');
      need(textHash(context)===pending.reviewContextSha256,'TYK_COMMISSIONING_REVIEW_CHANGED','Reopen the current staged review.',409);
      const before=await store.getJSON(rollout.value.before);
      const matches=context.observation.apis.every(row=>before.some(api=>api.apiId===row.stagedApiId&&api.found!==false&&api.kind==='oas'&&api.sha256===row.sha256));
      if(!matches)rollout=await store.revise(rollout,{...rollout.value,phase:'STALE',state:'STALE',
        failure:{code:'TYK_STAGED_REVIEW_CHANGED',message:'A staged definition changed after production acceptance. Capture its current source and repeat the affected operational review.',at:now()}});
    }
    const binding={id:record.id,stepId:pending.stepId,reviewContextSha256:pending.reviewContextSha256};
    if(textHash(rollout.value.commissioning??null)!==textHash(binding))rollout=await store.revise(rollout,{...rollout.value,commissioning:binding});
    return finish(record,{...record.value,pending:null,bindings:{...record.value.bindings,[pending.stepId]:ref(rollout)}});
  }
  async function prepareCommissioningStep(input,signal){
    const resumed=await replay(input,'prepareCommissioningStep',true);
    if(resumed.prior)return resumed.prior.value.pending?.requestId===input.requestId?finishPreparation(resumed.prior,signal):resumed.prior;
    let record=await store.get('commissioning',input.id);await target(record.value);
    const source=await details(record),progress=commissioningProgress(record.value,source,{hash:textHash});
    need(['conversion','staging','promotion'].includes(input.stepId),'TYK_COMMISSIONING_STEP_INVALID');
    const row=progress.steps.find(step=>step.id===input.stepId);
    need(row.ready,'TYK_COMMISSIONING_ORDER','Complete the preceding cohort steps before preparing this native request.',409);
    const prior=source[input.stepId];
    const currentReview=input.stepId==='promotion'?textHash(commissioningReviewContext(record.value,source,'production-review')):null;
    const replaceUndispatched=input.stepId==='promotion'&&prior?.value.phase==='PREPARED'&&!prior.value.dispatchedAt&&
      prior.value.commissioning?.reviewContextSha256!==currentReview;
    need(!prior||['PREPARE_FAILED','STALE','INTERRUPTED'].includes(prior.value.phase)||replaceUndispatched,
      'TYK_COMMISSIONING_ORIGINAL_REQUEST','Open or reconcile the saved original rollout before preparing a replacement.',409);
    const mode={conversion:'dryRun',staging:'stage',promotion:'promote'}[input.stepId];
    const args={requestId:childId(input.requestId,'native-prepare'),connectionId:record.value.connectionId,
      cohortId:source.cohort.id,cohortRevision:source.cohort.revision,label:titled(record.value.label,input.stepId),
      note:'Complete cohort commissioning '+record.id,selection:{operation:'migrate',mode,apiIds:source.cohort.value.apiIds,
        abortOnFailure:record.value.abortOnFailure,overrideStaged:mode==='stage'&&record.value.overrideStaged}};
    const reviewContextSha256=currentReview;
    record=await checkpoint(record,input,'prepareCommissioningStep',{stepId:input.stepId,args,reviewContextSha256,...(replaceUndispatched?{retireRollout:ref(prior)}:{})});
    return finishPreparation(record,signal);
  }
  async function finishCapture(record,signal){
    await target(record.value);const pending=record.value.pending;
    const original=await capture(pending.args,signal);
    const key=pending.phase==='staged'?'observation':'finalObservation';
    return finish(record,{...record.value,pending:null,[key]:ref(original)});
  }
  async function refreshCommissioning(input,signal){
    const resumed=await replay(input,'refreshCommissioning',true);
    if(resumed.prior)return resumed.prior.value.pending?.requestId===input.requestId?finishCapture(resumed.prior,signal):resumed.prior;
    let record=await store.get('commissioning',input.id);await target(record.value);
    const source=await details(record),progress=commissioningProgress(record.value,source,{hash:textHash});
    const phase=input.phase,required=phase==='staged'?'staging':phase==='final'?'promotion':null;
    need(required&&progress.steps.find(step=>step.id===required).complete,'TYK_COMMISSIONING_CAPTURE_ORDER',
      'Complete the original staging or promotion request before capturing its current definitions.',409);
    need(phase!=='staged'||!source.promotion?.value.dispatchedAt,'TYK_COMMISSIONING_PROMOTION_STARTED',
      'Read back the original promotion after it has been dispatched.',409);
    const args={requestId:childId(input.requestId,'native-capture'),connectionId:record.value.connectionId,
      label:titled(record.value.label,phase+' portfolio')};
    record=await checkpoint(record,input,'refreshCommissioning',{phase,args});return finishCapture(record,signal);
  }
  async function recordCommissioningReview(input){
    const {prior}=await replay(input,'recordCommissioningReview',true);if(prior)return prior;
    let record=await store.get('commissioning',input.id);await target(record.value);
    need(!record.value.pending&&record.revision===input.expectedRevision,'TYK_RECORD_CONFLICT','Refresh the original commissioning record.',409);
    const source=await details(record),progress=commissioningProgress(record.value,source,{hash:textHash});
    need(['conversion-review','production-review'].includes(input.stepId),'TYK_COMMISSIONING_REVIEW_INVALID');
    const nextNative=input.stepId==='conversion-review'?source.staging:source.promotion;
    need(!nextNative?.value.dispatchedAt,'TYK_COMMISSIONING_REVIEW_CLOSED','The following native request has already been dispatched.',409);
    const row=progress.steps.find(step=>step.id===input.stepId);
    need(row.ready||row.complete,'TYK_COMMISSIONING_ORDER','Complete the preceding cohort steps before accepting this review.',409);
    const context=commissioningReviewContext(record.value,source,input.stepId),contextSha256=textHash(context);
    need(contextSha256===input.contextSha256,'TYK_COMMISSIONING_REVIEW_CHANGED','Review the current complete original sources.',409);
    const review=validateCommissioningReview(input,record.value,context);
    const files=(input.files??[]).map((file,index)=>sourceFile(file,'source-'+index));
    const original=await replay(input,'recordCommissioningReview',true);
    const value=await completedValue(record,{...record.value,reviews:{...record.value.reviews,
      [input.stepId]:{...review,contextSha256,context,recordedAt:now()}},
      supportingFiles:{...record.value.supportingFiles,[input.stepId]:files}});
    return store.commit('commissioning',record.id,{expectedRevision:record.revision,requestId:original.selected.id,
      requestSha256:original.selected.sha256,value});
  }
  async function validateCommissioningDispatch(rollout){
    const binding=rollout.value.commissioning;if(!binding)return;
    const original=await readCommissioning({id:binding.id}),row=original.progress.steps.find(step=>step.id===binding.stepId);
    need(original.record.value.bindings[binding.stepId]?.id===rollout.id&&row?.ready,
      'TYK_COMMISSIONING_DISPATCH_CHANGED','Reopen the current cohort and its original native review.',409);
    if(binding.stepId==='promotion')need(original.reviewContexts['production-review']?.sha256===binding.reviewContextSha256&&
      original.record.value.reviews['production-review']?.accepted===true,
      'TYK_COMMISSIONING_REVIEW_CHANGED','Use the current accepted production review.',409);
  }
  return {createCommissioning,readCommissioning,prepareCommissioningStep,refreshCommissioning,recordCommissioningReview,validateCommissioningDispatch};
}
