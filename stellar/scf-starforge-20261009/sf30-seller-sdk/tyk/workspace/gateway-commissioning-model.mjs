// MIT. Durable two-Gateway course bindings in the existing leased Tyk workspace.
import { createHash } from 'node:crypto';
import { need, now } from '../../../distribution/runtime-workspace/storage.mjs';
import { field, textHash, idFor } from './store.mjs';
import { planTykRequest } from '../native.mjs';
import { commissioningSupportingFile } from './commissioning.mjs';
import { TYK_GATEWAY_COMMISSIONING_SCHEMA, gatewayRecordRef as ref, gatewayEntries, gatewayCheckNames,
  gatewaySteps, gatewayProgress, gatewayReviewContext, gatewayReview, gatewayObservation, gatewayApiId,
  createGatewayPlan, updateGatewayPlan } from './gateway-commissioning.mjs';
const childId=(id,name)=>{const h=textHash({id,name});return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
const title=(label,suffix)=>label.slice(0,297-suffix.length)+' · '+suffix;
export function createTykGatewayCommissioningMethods({store,lookupConnection,replay,initial,getRecord,prepareRollout,reconcileRollout,capture,adaptDefinition}){
  async function target(value,phase){
    const bound=value.targets[phase],selected=await lookupConnection(bound.id);
    need(selected.connection.kind==='gateway'&&selected.record.value.configurationSha256===bound.configurationSha256,
      'TYK_GATEWAY_TARGET_CHANGED','The named Gateway configuration changed; preserve this course and prepare a new source edition.',409);
    return selected;
  }
  async function details(record){
    const value=record.value,rollouts={},observations={staging:null,production:null},captures={};
    for(const [stepId,binding]of Object.entries(value.bindings))rollouts[stepId]=await getRecord({kind:'rollout',id:binding.id});
    const result={rollouts,observations,captures};
    for(const phase of ['staging','production']){
      const reference=value.captures[phase];if(!reference)continue;
      const original=await store.get('capture',reference.id,reference.revision);
      need(original.sha256===reference.sha256,'TYK_GATEWAY_CAPTURE_CHANGED');
      captures[phase]=original;
      const inventory=original.value.inventory?await store.getJSON(original.value.inventory):null;
      observations[phase]=gatewayObservation(value,result,phase,original,inventory);
    }
    return result;
  }
  async function readGatewayCommissioning(input){
    const record=await store.get('gatewayCommissioning',input.id,input.revision),source=await details(record),reviewContexts={};
    for(const phase of ['staging','production'])try{const context=gatewayReviewContext(record.value,source,phase);reviewContexts[phase]={context,sha256:textHash(context)};}catch{}
    return {record,progress:gatewayProgress(record.value,source,{hash:textHash}),...source,reviewContexts,
      source:await store.getJSON(record.value.source),workshare:record.value.workshare??null,plan:await store.getJSON(record.value.manuscript)};
  }
  function supporting(file,id){
    need(file&&typeof file.contentBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64),'TYK_GATEWAY_FILE_INVALID');
    const bytes=Buffer.from(file.contentBase64,'base64');need(bytes.toString('base64')===file.contentBase64,'TYK_GATEWAY_FILE_INVALID');
    return commissioningSupportingFile({id,name:file.name,mediaType:file.mediaType,bytes,note:file.note??''});
  }
  async function completedValue(record,value){
    const source=await details({...record,value}),progress=gatewayProgress(value,source,{hash:textHash});
    const manuscript=updateGatewayPlan(await store.getJSON(value.manuscript),progress,value.reviews,value.supportingFiles,now());
    return {...value,state:progress.state,summary:progress.summary,manuscript:await store.putJSON(manuscript)};
  }
  async function finish(record,value){return store.revise(record,await completedValue(record,value));}
  async function createGatewayCommissioning(input){
    const {prior}=await replay(input,'createGatewayCommissioning',true);if(prior)return prior;
    const staging=await lookupConnection(input.stagingConnectionId),production=await lookupConnection(input.productionConnectionId);
    need(staging.connection.kind==='gateway'&&production.connection.kind==='gateway','TYK_GATEWAY_REQUIRED');
    need(staging.record.id!==production.record.id&&staging.connection.baseUrl!==production.connection.baseUrl,
      'TYK_TWO_GATEWAYS_REQUIRED','Select distinct original staging and production Gateway endpoints.');
    const entries=gatewayEntries(input.entries,staging.connection),checkNames=gatewayCheckNames(input.checkNames),
      label=field(input.label,300,true),customer=field(input.customer??'',300),operator=field(input.operator??'',300);
    const reload=input.reload??{scope:'node',block:true};
    planTykRequest(staging.connection,{operation:'hotReload',...reload});
    planTykRequest(production.connection,{operation:'hotReload',...reload});
    const targets=Object.fromEntries([['staging',staging],['production',production]].map(([phase,t])=>[phase,
      {id:t.record.id,connection:t.connection,configurationSha256:t.record.value.configurationSha256}]));
    const fullSource={schema:TYK_GATEWAY_COMMISSIONING_SCHEMA,label,customer,operator,targets,entries,checkNames,reload};
    const source=await store.putJSON(fullSource),sourceFile=commissioningSupportingFile({id:'selected-source',
      name:'gateway-cohort-complete-source.json',mediaType:'application/json',bytes:Buffer.from(JSON.stringify(fullSource,null,2)+'\n')});
    const workshare=input.workshare?{source:supporting(input.workshare,'workshare-source'),
      sourceSha256:createHash('sha256').update(Buffer.from(input.workshare.contentBase64,'base64')).digest('hex'),targets,cohortSource:source,checkNames:[...checkNames]}:null;
    const manuscript=await store.putJSON(createGatewayPlan({id:'gateway-'+idFor(input.requestId),label,customer,operator,entries,checks:checkNames,sourceFile,workshare,savedAt:now()}));
    return initial('gatewayCommissioning',input,'createGatewayCommissioning',{schema:TYK_GATEWAY_COMMISSIONING_SCHEMA,
      label,customer,operator,connectionId:staging.record.id,targets,entries,checkNames,reload,source,workshare,manuscript,
      bindings:{},captures:{},reviews:{},supportingFiles:{},pending:null,state:'IN_PROGRESS',
      summary:{apis:entries.length,steps:entries.length*2+6,completed:0,checks:entries.length*checkNames.length*2}});
  }
  async function checkpoint(record,input,method,pending){
    const original=await replay(input,method,true);
    need(!original.prior&&!record.value.pending,'TYK_GATEWAY_PENDING','Recover the saved original course request first.',409);
    need(input.expectedRevision===record.revision,'TYK_RECORD_CONFLICT','Refresh the saved Gateway course.',409);
    return store.commit('gatewayCommissioning',record.id,{expectedRevision:record.revision,requestId:original.selected.id,
      requestSha256:original.selected.sha256,value:{...record.value,pending:{...pending,method,requestId:input.requestId}}});
  }
  async function finishPreparation(record,signal){
    const pending=record.value.pending;await target(record.value,pending.phase);
    if(pending.retireRollout){
      const old=await store.get('rollout',pending.retireRollout.id);
      need(!old.value.dispatchedAt,'TYK_GATEWAY_ORIGINAL_REQUEST');
      if(old.value.phase!=='STALE'){
        need(old.value.phase==='PREPARED'&&old.sha256===pending.retireRollout.sha256,'TYK_RECORD_CONFLICT');
        await store.revise(old,{...old.value,phase:'STALE',state:'STALE',failure:{code:'TYK_GATEWAY_SOURCE_SUPERSEDED',
          message:'A newly accepted staging source explicitly replaced this undispatched preparation.',at:now()}});
      }
    }
    let rollout=await prepareRollout(pending.args,signal);
    if(rollout.value.phase==='PREPARED'&&pending.entryKey){
      const plan=await store.getJSON(rollout.value.plan),before=await store.getJSON(rollout.value.before);
      const selected=plan.apiIds.map(id=>before.find(api=>api.apiId===id));
      const correct=plan.operation==='import'||plan.operation==='create'&&selected.length===1&&selected[0]?.found===false||
        plan.operation==='update'&&selected.length===1&&selected[0]?.found===true&&selected[0].kind===plan.kind;
      if(!correct)rollout=await store.revise(rollout,{...rollout.value,phase:'STALE',state:'STALE',
        failure:{code:'TYK_GATEWAY_OPERATION_MISMATCH',message:'Create requires the exact target ID to be absent; update requires the same existing native kind. Preserve this course and select a corrected source edition.',at:now()}});
    }
    const binding={id:record.id,stepId:pending.stepId,sourceContextSha256:pending.sourceContextSha256,acknowledgeUncertain:pending.acknowledgeUncertain===true};
    if(textHash(rollout.value.gatewayCommissioning??null)!==textHash(binding))rollout=await store.revise(rollout,{...rollout.value,gatewayCommissioning:binding});
    return finish(record,{...record.value,pending:null,bindings:{...record.value.bindings,[pending.stepId]:ref(rollout)}});
  }
  async function prepareGatewayCommissioningStep(input,signal){
    const resumed=await replay(input,'prepareGatewayCommissioningStep',true);
    if(resumed.prior)return resumed.prior.value.pending?.requestId===input.requestId?finishPreparation(resumed.prior,signal):resumed.prior;
    let record=await store.get('gatewayCommissioning',input.id);
    const source=await details(record),progress=gatewayProgress(record.value,source,{hash:textHash}),step=progress.steps.find(row=>row.id===input.stepId);
    need(step?.type==='native'&&step.ready,'TYK_GATEWAY_STEP_ORDER','Complete the preceding Gateway course work before preparing this request.',409);
    const selected=await target(record.value,step.phase),old=source.rollouts[step.id];
    const currentContext=step.phase==='production'?textHash(gatewayReviewContext(record.value,source,'staging')):textHash(record.value.source);
    const replace=old?.value.phase==='PREPARED'&&!old.value.dispatchedAt&&old.value.gatewayCommissioning?.sourceContextSha256!==currentContext;
    need(!old||!old.value.dispatchedAt&&(['PREPARE_FAILED','STALE','INTERRUPTED'].includes(old.value.phase)||replace),
      'TYK_GATEWAY_ORIGINAL_REQUEST','Open or reconcile the existing saved request. A dispatched native request is never replaced or resent.',409);
    if(step.uncertainWrites.length)need(input.acknowledgeUncertain===true,'TYK_GATEWAY_UNCERTAIN_WRITES',
      'Review the original uncertain writes and explicitly acknowledge this reload-based readback recovery.',409);
    let selection,sourceDefinition=null,context=null;
    if(step.key){
      const entry=record.value.entries.find(row=>row.key===step.key);
      if(step.phase==='staging')selection=entry.selection;
      else{
        context=gatewayReviewContext(record.value,source,'staging');
        need(record.value.reviews.staging?.accepted===true&&record.value.reviews.staging.contextSha256===textHash(context),
          'TYK_GATEWAY_REVIEW_CHANGED','Accept the current complete staging source and checks.',409);
        const api=context.observation.apis.find(row=>row.key===entry.key),captureRef=context.observation.capture;
        const adapted=await adaptDefinition({captureId:captureRef.id,revision:captureRef.revision,apiId:api.apiId,connectionId:selected.record.id});
        need(adapted.sourceDefinition.sha256===api.sha256&&adapted.apiId===api.apiId,'TYK_GATEWAY_SOURCE_CHANGED');
        selection={operation:entry.productionOperation,kind:adapted.kind,apiId:api.apiId,definitionText:adapted.definitionText,contentType:'application/json'};
        sourceDefinition={captureId:captureRef.id,revision:captureRef.revision,apiId:api.apiId,sha256:api.sha256};
      }
    }else selection={operation:'hotReload',...record.value.reload};
    if(step.phase==='production'&&!context)context=gatewayReviewContext(record.value,source,'staging');
    const args={requestId:childId(input.requestId,'native-prepare'),connectionId:selected.record.id,
      label:title(record.value.label,step.title),note:'Gateway cohort '+record.id+' / '+step.id,selection,...(sourceDefinition?{sourceDefinition}:{})};
    record=await checkpoint(record,input,'prepareGatewayCommissioningStep',{stepId:step.id,phase:step.phase,entryKey:step.key??null,args,
      sourceContextSha256:context?textHash(context):textHash(record.value.source),acknowledgeUncertain:input.acknowledgeUncertain===true,
      ...(replace?{retireRollout:ref(old)}:{})});
    return finishPreparation(record,signal);
  }
  async function finishCapture(record,signal){
    const pending=record.value.pending;await target(record.value,pending.phase);
    for(const entry of record.value.entries){
      const stepId=(pending.phase==='staging'?'stage:':'production:')+entry.key,binding=record.value.bindings[stepId];
      need(binding,'TYK_GATEWAY_ORIGINAL_REQUEST');
      const original=await store.get('rollout',binding.id);
      if(original.value.dispatchedAt)await reconcileRollout({requestId:childId(pending.requestId,'readback:'+entry.key),id:original.id},signal);
    }
    const original=await capture(pending.args,signal);
    return finish(record,{...record.value,pending:null,captures:{...record.value.captures,[pending.phase]:ref(original)}});
  }
  async function refreshGatewayCommissioning(input,signal){
    const resumed=await replay(input,'refreshGatewayCommissioning',true);
    if(resumed.prior)return resumed.prior.value.pending?.requestId===input.requestId?finishCapture(resumed.prior,signal):resumed.prior;
    let record=await store.get('gatewayCommissioning',input.id);
    need(['staging','production'].includes(input.phase),'TYK_GATEWAY_PHASE_INVALID');await target(record.value,input.phase);
    const source=await details(record),reload=source.rollouts[(input.phase==='staging'?'stage':'production')+'-reload'];
    need(reload?.value.dispatchedAt,'TYK_GATEWAY_RELOAD_REQUIRED','Dispatch the original explicit reload before active capture.',409);
    if(input.phase==='staging')need(!Object.entries(source.rollouts).some(([id,r])=>id.startsWith('production')&&r.value.dispatchedAt),
      'TYK_GATEWAY_PRODUCTION_STARTED','The selected staging edition is frozen after production dispatch; retain later work in a new course.',409);
    const args={requestId:childId(input.requestId,'full-native-capture'),connectionId:record.value.targets[input.phase].id,label:title(record.value.label,input.phase+' active portfolio')};
    record=await checkpoint(record,input,'refreshGatewayCommissioning',{phase:input.phase,args});
    return finishCapture(record,signal);
  }
  async function recordGatewayCommissioningReview(input){
    const {prior,selected}=await replay(input,'recordGatewayCommissioningReview',true);if(prior)return prior;
    const record=await store.get('gatewayCommissioning',input.id);
    need(['staging','production'].includes(input.phase),'TYK_GATEWAY_PHASE_INVALID');await target(record.value,input.phase);
    need(record.revision===input.expectedRevision&&!record.value.pending,'TYK_RECORD_CONFLICT','Refresh the saved complete source before acceptance.',409);
    const source=await details(record);
    if(input.phase==='staging')need(!Object.entries(source.rollouts).some(([id,r])=>id.startsWith('production')&&r.value.dispatchedAt),
      'TYK_GATEWAY_PRODUCTION_STARTED','Production has already used this exact accepted staging edition.',409);
    const context=gatewayReviewContext(record.value,source,input.phase);
    need(textHash(context)===input.contextSha256,'TYK_GATEWAY_REVIEW_CHANGED','Review the current complete active definitions.',409);
    const review=gatewayReview(input,record.value,context);
    need(Array.isArray(input.files??[])&&(input.files??[]).length<=50,'TYK_GATEWAY_FILES_INVALID');
    const files=(input.files??[]).map((file,index)=>supporting(file,'support-'+index));
    const value=await completedValue(record,{...record.value,reviews:{...record.value.reviews,[input.phase]:
      {...review,context,contextSha256:input.contextSha256,recordedAt:now()}},supportingFiles:{...record.value.supportingFiles,[input.phase]:files}});
    return store.commit('gatewayCommissioning',record.id,{expectedRevision:record.revision,requestId:selected.id,requestSha256:selected.sha256,value});
  }
  async function validateGatewayCommissioningDispatch(rollout){
    const binding=rollout.value.gatewayCommissioning;if(!binding)return;
    const current=await readGatewayCommissioning({id:binding.id}),step=current.progress.steps.find(row=>row.id===binding.stepId);
    need(step?.ready&&current.record.value.bindings[binding.stepId]?.id===rollout.id,'TYK_GATEWAY_DISPATCH_CHANGED','Reopen the current Gateway course and its original native review.',409);
    await target(current.record.value,step.phase);
    if(step.uncertainWrites.length)need(binding.acknowledgeUncertain===true,'TYK_GATEWAY_UNCERTAIN_WRITES');
    const context=step.phase==='production'?current.reviewContexts.staging?.sha256:textHash(current.record.value.source);
    need(context===binding.sourceContextSha256,'TYK_GATEWAY_SOURCE_CHANGED','The current staging acceptance no longer matches this prepared request.',409);
    if(step.phase==='production')need(current.record.value.reviews.staging?.accepted===true&&
      current.record.value.reviews.staging.contextSha256===context,'TYK_GATEWAY_REVIEW_CHANGED');
  }
  return {createGatewayCommissioning,readGatewayCommissioning,prepareGatewayCommissioningStep,refreshGatewayCommissioning,
    recordGatewayCommissioningReview,validateGatewayCommissioningDispatch};
}
