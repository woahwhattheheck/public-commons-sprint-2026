// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';
import { validateGraviteeAction } from './actions.mjs';
import { openGraviteeStore, idFor, validRequestId } from './store.mjs';
import { createGraviteeClient, deferredAdmission } from './native.mjs';
import { inspectSourceBundle, createProxyDraft, draftReadiness } from './source.mjs';
import { createReceivingPackage, inspectReceivingPackage } from './delivery.mjs';
import { SCHEMA, normalizeConnection, readContract, hashJSON, copy, requireValue, publicError, object } from './contract.mjs';

const ref = record => ({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const summary = record => ({...ref(record),createdAt:record.createdAt,updatedAt:record.updatedAt,label:record.value.label??record.value.operationId??record.id,
  state:record.value.state??'SAVED',connectionId:record.value.connectionId??null});
const childUUID = (parent,suffix) => { const h=hashJSON({parent,suffix}); return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32); };
const originalInput = input => {const {signal,...rest}=input??{};return rest;};
const sourceSelection = record => record.value.sourceRef;
const allPlanStatuses={statuses:['STAGING','PUBLISHED','DEPRECATED','CLOSED']};
const UPDATE_FIELDS=['name','apiVersion','description','definitionVersion','groups','tags','resources','responseTemplates','visibility','categories','labels',
  'lifecycleState','disableMembershipNotifications','properties','type','listeners','endpointGroups','analytics','failover','flowExecution','flows','services',
  'allowedInApiProducts','allowMultiJwtOauth2Subscriptions'];

const VOLATILE_NATIVE_FIELDS=new Set(['createdAt','updatedAt','deployedAt','_links','primaryOwner','originContext','definitionContext','workflowState','deploymentState']);
function nativeSubset(expected,actual) {
  if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((value,i)=>nativeSubset(value,actual[i]));
  if(object(expected))return object(actual)&&Object.entries(expected).filter(([key])=>!VOLATILE_NATIVE_FIELDS.has(key)).every(([key,value])=>value===null?(actual[key]===null||actual[key]===undefined):nativeSubset(value,actual[key]));
  return expected===actual;
}
function observedEffect(operationId,parameters,observation) {
  const api=observation.api?.api,plan=observation.plan?.json;
  if(!api)return false;
  if(operationId==='startApi')return api.state==='STARTED';
  if(operationId==='stopApi')return api.state==='STOPPED';
  const reviews={reviewsAsk:'IN_REVIEW',reviewsAccept:'REVIEW_OK',reviewsReject:'REQUEST_FOR_CHANGES'};
  if(reviews[operationId])return api.workflowState===reviews[operationId];
  const statuses={publishApiPlan:'PUBLISHED',closeApiPlan:'CLOSED',deprecateApiPlan:'DEPRECATED'};
  if(statuses[operationId])return plan?.status===statuses[operationId];
  if(['createApi','updateApi','patchApi'].includes(operationId))return nativeSubset(parameters.body,api);
  if(['createApiPlan','updateApiPlan'].includes(operationId))return plan&&nativeSubset(parameters.body,plan);
  if(['createApiWithImportDefinition','updateApiWithDefinition'].includes(operationId)){
    const current=observation.api.export,wanted=parameters.body;
    if(!current||!nativeSubset(wanted.api,current.api))return false;
    if(Array.isArray(wanted.plans)){
      if(!Array.isArray(current.plans)||current.plans.length!==wanted.plans.length)return false;
      if(!wanted.plans.every(item=>current.plans.some(actual=>((item.id&&actual.id===item.id)||(item.crossId&&actual.crossId===item.crossId)||(!item.id&&!item.crossId&&actual.name===item.name))&&nativeSubset(item,actual))))return false;
    }
    return true;
  }
  return false;
}

export async function openGraviteeWorkspace({directory,environment=process.env,fetch=globalThis.fetch}={}) {
  const store=await openGraviteeStore(directory);
  let closed=false,serial=Promise.resolve();const active=new Set();
  function write(fn) {
    requireValue(!closed,'WORKSPACE_CLOSED');
    const operation=serial.then(()=>store.exclusive(fn));serial=operation.catch(()=>{});active.add(operation);
    operation.then(()=>active.delete(operation),()=>active.delete(operation));return operation;
  }
  async function connection(id) {
    const record=await store.get('connection',id),configured=normalizeConnection(record.value.connection);
    requireValue(hashJSON(configured)===record.value.configurationSha256,'CONNECTION_RECORD_CHANGED');
    return{record,configured};
  }
  async function client(id,journalId) {
    const selected=await connection(id);
    const native=await createGraviteeClient(selected.configured,{environment,fetch,onExchange:async exchange=>{
      const object=await store.putJSON(exchange);if(journalId)await store.append(journalId,{type:'provider-response',exchangeId:exchange.id,reference:object,status:exchange.status??null,complete:exchange.complete===true});
      return object;
    }});
    return{...selected,native};
  }
  async function local(method,input,fn) {
    validRequestId(input.requestId);const id=idFor(input.requestId),requestHash=hashJSON({method,input:originalInput(input)});let request=await store.maybe('request',id);
    if(request){requireValue(request.value.requestHash===requestHash,'REQUEST_INPUT_CHANGED');if(request.value.state==='COMPLETED')return store.getJSON(request.value.result);}
    else request=await store.save('request',{label:method,requestId:input.requestId,requestHash,state:'STARTED'},{id});
    const result=await fn(),object=await store.putJSON(result);
    await store.revise(request,{...request.value,result:object,state:'COMPLETED'});return result;
  }
  async function view() {
    const all=await store.heads(),connections=[];
    for(const item of all.filter(x=>x.kind==='connection')){
      const {record,configured}=await connection(item.id),auth=configured.auth;
      const available=auth.type==='bearer'?Boolean(environment[auth.tokenEnv]):Boolean(environment[auth.usernameEnv]&&environment[auth.passwordEnv]);
      connections.push({...summary(record),connection:configured,contract:record.value.contract,credentialAvailable:available});
    }
    return{schema:SCHEMA,workspaceId:store.identity.workspaceId,directory:store.directory,connections,
      counts:Object.fromEntries([...new Set(all.map(x=>x.kind))].map(kind=>[kind,all.filter(x=>x.kind===kind).length])),
      activeOperations:active.size,capabilities:{nativeVersion:'v4 HTTP proxy',managementAPI:'v2',sourceDialects:['OpenAPI 3.x','Swagger 2.0','RAML 1.0','Gravitee V4'],
        replay:'original request is retained',receiving:'complete editable workspace and application source'}};
  }
  async function list(input={}) {const result=await store.list(input);return{...result,items:result.items.map(summary)};}
  async function get(input) {
    const record=await store.get(input.kind,input.id,input.revision),result={...record};
    if(input.includeJournal)result.journal=await store.journal(record.id);
    return result;
  }
  async function readObject(input) {
    const bytes=await store.getBytes(input.reference);return{reference:input.reference,base64:bytes.toString('base64')};
  }
  async function saveConnection(input) {
    return local('saveConnection',input,async()=>{
      const configuration=normalizeConnection(input.connection),contract=await readContract(configuration.contract);
      const existing=await store.maybe('connection',configuration.id);
      if(existing)return existing;
      return store.save('connection',{label:configuration.label,connection:configuration,configurationSha256:hashJSON(configuration),contract,state:'CONFIGURED'},{id:configuration.id});
    });
  }
  async function importSource(input) {
    return local('importSource',input,async()=>{
      const id=idFor(input.requestId),existing=await store.maybe('source',id);if(existing)return existing;
      const source=await inspectSourceBundle(input),body=await store.putJSON(source);
      return store.save('source',{label:source.label,sourceRef:body,sourceSha256:source.sourceSha256,dialect:source.dialect,entry:source.entry,
        fileCount:source.files.length,routeCount:source.routes.length,findings:source.findings,state:'IMPORTED'},{id});
    });
  }
  async function readSource(input) {const record=await store.get('source',input.id,input.revision);return{record,source:await store.getJSON(sourceSelection(record))};}
  async function saveDraft(input) {
    return local('saveDraft',input,async()=>{
      const id=input.id??idFor(input.requestId),expectedRevision=input.expectedRevision??0,existing=await store.maybe('draft',id);
      if(existing&&existing.revision>expectedRevision){const original=await store.get('draft',id,expectedRevision+1);if(original.value.requestId===input.requestId)return original;}
      const original=await readSource({id:input.sourceId,revision:input.sourceRevision});
      let draft;
      if(input.draft){draft=copy(input.draft);requireValue(draft.sourceSha256===original.source.sourceSha256,'DRAFT_SOURCE_CHANGED');}
      else draft=createProxyDraft(original.source,input.mapping);
      const readiness=draftReadiness(draft),value={label:draft.label,requestId:input.requestId,source:ref(original.record),draft:await store.putJSON(draft),readiness,state:'DRAFTED'};
      return store.save('draft',value,{id,expectedRevision});
    });
  }
  async function readDraft(input) {const record=await store.get('draft',input.id,input.revision),draft=await store.getJSON(record.value.draft),readiness=draftReadiness(draft);return{record,draft,review:{...readiness,mappingSha256:hashJSON({draft:ref(record),readiness})}};}
  async function capture(input) {
    validRequestId(input.requestId);const id=idFor(input.requestId),requestHash=hashJSON({method:'capture',input:originalInput(input)});
    const prior=await store.maybe('capture',id);
    if(prior){requireValue(prior.value.requestHash===requestHash,'REQUEST_INPUT_CHANGED');if(prior.value.state==='CAPTURED')return prior;}
    let record=prior??await store.save('capture',{label:input.label??'API inventory',connectionId:input.connectionId,requestId:input.requestId,requestHash,input:originalInput(input),state:'CAPTURING'},{id});
    try{
      const {native}=await client(input.connectionId,id),inventory=await native.all('listApis'),ids=input.apiIds??inventory.items.filter(x=>x.definitionVersion==='V4'&&x.type==='PROXY').map(x=>x.id);
      requireValue(Array.isArray(ids)&&new Set(ids).size===ids.length,'API_SELECTION_INVALID');const apis=[];
      for(const apiId of ids)apis.push(await native.captureApi(apiId));
      const value=await store.putJSON({schema:'gravitee.capture.v1',inventory,apis});
      record=await store.revise(record,{...record.value,state:apis.every(x=>x.complete)?'CAPTURED':'PARTIAL',captureRef:value,apiCount:apis.length,inventoryCount:inventory.items.length});
    }catch(error){record=await store.revise(record,{...record.value,state:'PARTIAL',error:publicError(error)});}
    return record;
  }
  async function readCapture(input) {const record=await store.get('capture',input.id,input.revision);return{record,capture:record.value.captureRef?await store.getJSON(record.value.captureRef):null,journal:await store.journal(record.id)};}
  async function preimage(native,operationId,parameters) {
    const original={};
    if(parameters.apiId){
      const api=await native.call('getApi',{apiId:parameters.apiId});
      requireValue(api.accepted&&api.complete,'TARGET_API_READ_FAILED','Read the current API before preparing its change.',api.status??502);
      original.api={reference:api.retained,sha256:hashJSON(api.json),etag:api.headers.etag??null,value:api.json};
      if(parameters.planId){
        const plan=await native.call('getApiPlan',{apiId:parameters.apiId,planId:parameters.planId});
        requireValue(plan.accepted&&plan.complete,'TARGET_PLAN_READ_FAILED');original.plan={reference:plan.retained,sha256:hashJSON(plan.json),value:plan.json};
      }
      if(operationId==='rollbackApi'){
        const eventId=parameters.body?.eventId;requireValue(typeof eventId==='string'&&eventId.length>0,'ROLLBACK_EVENT_REQUIRED');
        const event=await native.call('getApiEventById',{apiId:parameters.apiId,eventId});
        requireValue(event.accepted&&event.complete&&event.json?.id===eventId,'ROLLBACK_API_EVENT_READ_FAILED','Select an original event returned by this API’s native event route.');
        original.event={reference:event.retained,id:eventId,sha256:hashJSON(event.json),value:event.json};
      }
      if(operationId==='updateApiWithDefinition'){
        original.fullCapture=await native.captureApi(parameters.apiId);
        const oldPlans=original.fullCapture.collections.plans?.items??[],newPlans=parameters.body?.plans;
        original.definitionImport={plansInCurrent:oldPlans.map(x=>({id:x.id,crossId:x.crossId,name:x.name,status:x.status})),
          plansInPayload:Array.isArray(newPlans)?newPlans.map(x=>({id:x.id,crossId:x.crossId,name:x.name,status:x.status})):null,
          plansAbsentFromPayload:oldPlans.filter(old=>!newPlans?.some(value=>(value.id&&value.id===old.id)||(value.crossId&&value.crossId===old.crossId))).map(x=>({id:x.id,crossId:x.crossId,name:x.name,status:x.status})),
          groupSemantics:'Definition imports use group names; target memberships must be configured in the target environment.'};
      }
    }else if(['createApi','createApiFromSwagger','createApiWithImportDefinition'].includes(operationId)){
      const inventory=await native.all('listApis');original.inventory={ids:inventory.items.map(x=>x.id),capturedAt:new Date().toISOString(),terminal:inventory.terminal};
    }
    return original;
  }
  async function prepareOperation(input) {
    validRequestId(input.requestId);const id=idFor(input.requestId),requestHash=hashJSON({method:'prepareOperation',input:originalInput(input)});
    let record=await store.maybe('operation',id);
    if(record){requireValue(record.value.requestHash===requestHash,'REQUEST_INPUT_CHANGED');if(record.value.state!=='PREPARING')return record;}
    else record=await store.save('operation',{label:input.label??input.operationId,connectionId:input.connectionId,operationId:input.operationId,
      requestId:input.requestId,requestHash,input:originalInput(input),state:'PREPARING'},{id});
    try{
      const {native,record:target}=await client(input.connectionId,id);let plan=native.plan(input.operationId,input.parameters??{});
      const original=plan.changesProvider?await preimage(native,input.operationId,input.parameters??{}):{};
      if(original.api?.etag&&native.contract.operations[input.operationId]?.supportsIfMatch)plan=native.plan(input.operationId,{...(input.parameters??{}),ifMatch:original.api.etag});
      const body=await store.putJSON({plan,preimage:original,target:ref(target)});
      return store.revise(record,{...record.value,state:'PREPARED',preparation:body,planSha256:plan.sha256,preparedAt:new Date().toISOString(),definitionImport:original.definitionImport??null});
    }catch(error){return store.revise(record,{...record.value,state:'PREPARATION_FAILED',error:publicError(error)});}
  }
  async function refreshOperation(input) {
    let record=await store.get('operation',input.id);
    requireValue(['PREPARED','STALE','PREPARATION_FAILED'].includes(record.value.state),'REQUEST_ALREADY_DISPATCHED','Refresh applies to the original request before dispatch.');
    const originalInput=record.value.input,{native,record:target}=await client(record.value.connectionId,record.id);let plan=native.plan(originalInput.operationId,originalInput.parameters??{});
    const original=plan.changesProvider?await preimage(native,originalInput.operationId,originalInput.parameters??{}):{};
    if(original.api?.etag&&native.contract.operations[originalInput.operationId]?.supportsIfMatch)plan=native.plan(originalInput.operationId,{...(originalInput.parameters??{}),ifMatch:original.api.etag});
    const body=await store.putJSON({plan,preimage:original,target:ref(target)});
    return store.revise(record,{...record.value,state:'PREPARED',preparation:body,planSha256:plan.sha256,definitionImport:original.definitionImport??null,refreshedAt:new Date().toISOString()});
  }
  async function executeOperation(input) {
    let record=await store.get('operation',input.id);
    if(record.value.state==='DEFERRED') {
      if(!Number.isFinite(Date.parse(record.value.notBefore))) {
        const originalResponse=await store.getJSON(record.value.response);
        const admission=deferredAdmission(originalResponse,record.value.priorResponses?.length??0);
        record=await store.revise(record,{...record.value,notBefore:admission.notBefore,retryAdmission:admission});
      }
      requireValue(Date.now()>=Date.parse(record.value.notBefore),'PROVIDER_RETRY_TIME_NOT_REACHED','The original request can continue at its saved retry time.',429);
      requireValue(input.planSha256===record.value.planSha256,'PREPARED_REQUEST_CHANGED','Execute the exact displayed request.');
      record=await store.revise(record,{...record.value,state:'PREPARED',priorResponses:[...(record.value.priorResponses??[]),record.value.response],retryAdmittedAt:new Date().toISOString()});
    }
    if(['DISPATCHED','APPLIED','ACCEPTED','REJECTED','OUTCOME_UNKNOWN','RECONCILED'].includes(record.value.state))return record;
    requireValue(record.value.state==='PREPARED','PREPARED_OPERATION_REQUIRED','Open and prepare the complete native request before executing it.');
    const preparation=await store.getJSON(record.value.preparation),{native}=await client(record.value.connectionId,record.id);
    requireValue(input.planSha256===preparation.plan.sha256,'PREPARED_REQUEST_CHANGED','Execute the exact displayed request.');
    if(preparation.plan.changesProvider&&preparation.preimage.api){
      const current=await native.call('getApi',{apiId:preparation.plan.parameters.apiId});
      let changed=!current.complete||!current.accepted||hashJSON(current.json)!==preparation.preimage.api.sha256;
      if(preparation.preimage.plan){const plan=await native.call('getApiPlan',{apiId:preparation.plan.parameters.apiId,planId:preparation.plan.parameters.planId});changed ||= !plan.complete||!plan.accepted||hashJSON(plan.json)!==preparation.preimage.plan.sha256;}
      if(changed)return store.revise(record,{...record.value,state:'STALE',currentApi:current.retained,changedAt:new Date().toISOString()});
    }
    try{
      const exchange=await native.perform(preparation.plan,{beforeDispatch:async outgoing=>{
        await store.append(record.id,{type:'dispatch',requestSha256:preparation.plan.sha256,exchangeId:outgoing.id,startedAt:outgoing.startedAt});
        record=await store.revise(record,{...record.value,state:'DISPATCHED',dispatchedAt:outgoing.startedAt,exchangeId:outgoing.id});
      }});
      const response=exchange.retained??await store.putJSON(exchange);
      let state;
      if(exchange.complete&&exchange.accepted)state=exchange.status===202?'ACCEPTED':'APPLIED';
      else if(exchange.status===429&&exchange.complete)state='DEFERRED';
      else if(exchange.complete&&exchange.status>=400&&exchange.status<500)state='REJECTED';
      else state=preparation.plan.changesProvider?'OUTCOME_UNKNOWN':'REJECTED';
      const admission=state==='DEFERRED'?deferredAdmission(exchange,record.value.priorResponses?.length??0):null;
      record=await store.revise(record,{...record.value,state,response,status:exchange.status,notBefore:admission?.notBefore??exchange.notBefore??null,retryAdmission:admission,
        responseComplete:exchange.complete,providerApiId:exchange.json?.id??null,error:exchange.error??null,completedAt:exchange.completedAt});
    }catch(error){
      const response=error.exchange?await store.putJSON(error.exchange):null;
      record=await store.revise(record,{...record.value,state:record.value.state==='DISPATCHED'?'OUTCOME_UNKNOWN':'PREPARED',
        ...(response?{response}:{}),error:publicError(error)});
    }
    return record;
  }
  async function reconcileOperation(input) {
    let record=await store.get('operation',input.id);
    requireValue(record.value.preparation,'ORIGINAL_PREPARATION_REQUIRED');
    const preparation=await store.getJSON(record.value.preparation),{native}=await client(record.value.connectionId,record.id);
    const originalResponse=record.value.response?await store.getJSON(record.value.response):null;
    let apiId=preparation.plan.parameters.apiId??record.value.resolvedApiId;
    if(!apiId&&['createApi','createApiFromSwagger','createApiWithImportDefinition'].includes(record.value.operationId))apiId=originalResponse?.json?.id??input.apiId;
    const result={schema:'gravitee.reconciliation.v1',operation:ref(record),at:new Date().toISOString(),originalStatus:record.value.status??null};
    if(!apiId){
      const inventory=await native.all('listApis'),prior=new Set(preparation.preimage.inventory?.ids??[]);
      result.newApis=inventory.items.filter(api=>!prior.has(api.id));result.inventory=inventory;result.selectionRequired=true;
    }else{
      if(!preparation.plan.parameters.apiId&&!originalResponse?.json?.id){
        const prior=new Set(preparation.preimage.inventory?.ids??[]);requireValue(!prior.has(apiId),'ORIGINAL_API_ALREADY_EXISTED');
        const candidate=await native.call('getApi',{apiId});requireValue(candidate.accepted&&candidate.complete,'RECONCILIATION_API_READ_FAILED');
        const intended=preparation.plan.parameters.body?.api??preparation.plan.parameters.body;
        requireValue(intended?.name&&candidate.json.name===intended.name&&candidate.json.apiVersion===intended.apiVersion,'CREATED_API_IDENTITY_DIFFERS','Choose the newly created API matching the original native request.');
        const intendedPaths=(intended.listeners??[]).flatMap(x=>x.paths??[]).map(x=>x.path).sort(),actualPaths=(candidate.json.listeners??[]).flatMap(x=>x.paths??[]).map(x=>x.path).sort();
        requireValue(intendedPaths.length&&hashJSON(intendedPaths)===hashJSON(actualPaths),'CREATED_API_PATHS_DIFFER');
      }
      result.api=await native.captureApi(apiId);result.apiId=apiId;
      if(preparation.plan.parameters.planId)result.plan=await native.call('getApiPlan',{apiId,planId:preparation.plan.parameters.planId});
      if(record.value.operationId==='createApiPlan'){
        const planId=originalResponse?.json?.id??input.planId;
        if(planId){result.plan=await native.call('getApiPlan',{apiId,planId});requireValue(result.plan.accepted&&result.plan.complete,'RECONCILIATION_PLAN_READ_FAILED');}
        else result.planSelection=await native.all('listApiPlans',{apiId,query:allPlanStatuses});
      }
    }
    result.effectMatched=observedEffect(record.value.operationId,preparation.plan.parameters,result);
    const originalOutcome=record.value.originalOutcome??record.value.state;
    const nativeReceiptAccepted=originalResponse?.complete===true&&originalResponse?.accepted===true&&preparation.plan.expectedStatuses.includes(originalResponse.status);
    result.nativeReceiptAccepted=nativeReceiptAccepted;
    const resolved=nativeReceiptAccepted||['APPLIED','ACCEPTED'].includes(originalOutcome)||result.effectMatched;
    const object=await store.putJSON(result);
    return store.revise(record,{...record.value,reconciliation:object,reconciledAt:result.at,resolvedApiId:resolved?(result.apiId??record.value.resolvedApiId??null):null,
      resolvedPlanId:resolved?(result.plan?.json?.id??record.value.resolvedPlanId??null):null,effectMatched:result.effectMatched,
      state:resolved?'RECONCILED':record.value.state,originalOutcome,nativeReceiptAccepted});
  }
  async function runNative(parent,suffix,connectionId,operationId,parameters) {
    const requestId=childUUID(parent.value.requestId,suffix);
    let operation=await prepareOperation({requestId,connectionId,operationId,parameters,label:parent.value.label+' · '+suffix});
    if(['PREPARED','DEFERRED'].includes(operation.value.state))operation=await executeOperation({id:operation.id,planSha256:operation.value.planSha256});
    const originalState=operation.value.originalOutcome??operation.value.state;
    const accepted=['APPLIED','ACCEPTED'].includes(originalState)||operation.value.nativeReceiptAccepted===true||(operation.value.state==='RECONCILED'&&operation.value.effectMatched===true);
    return{record:operation,accepted,response:operation.value.response?await store.getJSON(operation.value.response):null};
  }
  async function commission(input) {
    validRequestId(input.requestId);const id=idFor(input.requestId),requestHash=hashJSON({method:'commission',input:originalInput(input)});
    let record=await store.maybe('commissioning',id);
    if(record){requireValue(record.value.requestHash===requestHash,'REQUEST_INPUT_CHANGED');if(['COMMISSIONED','COMMISSIONED_WITH_DIFFERENCES'].includes(record.value.state))return record;}
    const selected=await readDraft({id:input.draftId,revision:input.draftRevision}),draft=selected.draft;
    const readiness=draftReadiness(draft);
    requireValue(input.mappingSha256===hashJSON({draft:ref(selected.record),readiness}),'DRAFT_REVIEW_CHANGED','Use the current draft review hash.');
    requireValue(readiness.unresolved.length===0,'SOURCE_MAPPINGS_REQUIRED','Record the disposition of each source behavior in this draft before commissioning its gateway configuration.');
    record??=await store.save('commissioning',{label:input.label??draft.label,connectionId:input.connectionId,requestId:input.requestId,requestHash,input:originalInput(input),
      draft:ref(selected.record),state:'COMMISSIONING',steps:[],apiId:null,planIds:[]},{id});
    const step=async(suffix,operationId,parameters)=>{
      const completed=await runNative(record,suffix,input.connectionId,operationId,parameters);
      const prior=record.value.steps.filter(x=>x.name!==suffix);
      record=await store.revise(record,{...record.value,steps:[...prior,{name:suffix,operation:ref(completed.record),state:completed.record.value.state}],
        state:completed.accepted?'COMMISSIONING':'AWAITING_RECONCILIATION'});
      return completed;
    };
    try{
      if(!record.value.apiId){
        const result=await step('create-api',draft.operationId,draft.operationId==='createApiFromSwagger'?{body:draft.body}:{body:draft.body});
        if(!result.accepted)return record;
        const apiId=result.response?.json?.id??result.record.value.resolvedApiId;
        requireValue(apiId,'CREATED_API_ID_REQUIRED','Reconcile the original create operation and select its native API identity.');
        record=await store.revise(record,{...record.value,apiId});
      }
      const apiId=record.value.apiId;
      for(let i=0;i<(draft.plans??[]).length;i++){
        let planId=record.value.planIds[i];
        if(!planId){
          const result=await step('create-plan-'+i,'createApiPlan',{apiId,body:draft.plans[i]});if(!result.accepted)return record;
          planId=result.response?.json?.id??result.record.value.resolvedPlanId;requireValue(planId,'CREATED_PLAN_ID_REQUIRED');
          const planIds=[...record.value.planIds];planIds[i]=planId;record=await store.revise(record,{...record.value,planIds});
        }
        if(input.publishPlans){const result=await step('publish-plan-'+i,'publishApiPlan',{apiId,planId});if(!result.accepted)return record;}
      }
      if(input.review?.request){const result=await step('request-review','reviewsAsk',{apiId,body:{message:input.review.message??''}});if(!result.accepted)return record;}
      if(input.review?.accept){const result=await step('accept-review','reviewsAccept',{apiId,body:{message:input.review.message??''}});if(!result.accepted)return record;}
      if(input.publishAPI){
        const {native}=await client(input.connectionId,record.id),current=await native.call('getApi',{apiId});requireValue(current.accepted,'PUBLISH_API_READ_FAILED');
        const body=Object.fromEntries(UPDATE_FIELDS.filter(k=>current.json[k]!==undefined).map(k=>[k,current.json[k]]));body.lifecycleState='PUBLISHED';
        const existing=await store.maybe('operation',idFor(childUUID(record.value.requestId,'publish-api')));
        const retainedBody=existing?.value?.input?.parameters?.body??body;
        const result=await step('publish-api','updateApi',{apiId,body:retainedBody});if(!result.accepted)return record;
      }
      if(input.start){const result=await step('start-api','startApi',{apiId});if(!result.accepted)return record;}
      if(input.deploy){
        const verify=await step('verify-deployment','verifyApiDeployment',{apiId});if(!verify.accepted)return record;
        if(verify.response?.json?.ok!==true)return store.revise(record,{...record.value,state:'DEPLOYMENT_CONFIGURATION_REQUIRED',deploymentVerification:verify.response?.retained??null});
        const result=await step('request-deployment','createApiDeployment',{apiId,body:{deploymentLabel:(input.deploymentLabel??draft.label).slice(0,32)}});if(!result.accepted)return record;
      }
      const {native}=await client(input.connectionId,record.id),observed=await native.captureApi(apiId),probes=[];
      for(const probe of input.probes??[])probes.push(await native.probe(probe));
      const final=await store.putJSON({api:observed,probes,apiId,planIds:record.value.planIds});
      const differences=!observed.complete||probes.some(x=>!x.complete||x.matchesExpectedStatus===false);
      return store.revise(record,{...record.value,state:differences?'COMMISSIONED_WITH_DIFFERENCES':'COMMISSIONED',observation:final,
        deploymentState:input.deploy?'REQUEST_ACCEPTED':'NOT_REQUESTED',completedAt:new Date().toISOString()});
    }catch(error){return store.revise(record,{...record.value,state:'AWAITING_RECONCILIATION',error:publicError(error)});}
  }
  async function probe(input) {
    return local('probe',input,async()=>{const {native}=await client(input.connectionId,idFor(input.requestId)),response=await native.probe(input.probe);return response;});
  }
  async function addNote(input) {
    return local('addNote',input,async()=>{const id=idFor(input.requestId),existing=await store.maybe('note',id);return existing??store.save('note',{label:input.label??'Operator note',record:input.record??null,note:String(input.note??''),state:'SAVED'},{id});});
  }
  async function exportHandover(input) {
    return local('exportHandover',input,async()=>{
      const id=idFor(input.requestId),existing=await store.maybe('handover',id);
      if(existing){const packet=JSON.parse((await store.getBytes(existing.value.reference)).toString('utf8'));return{record:existing,reference:existing.value.reference,inspection:inspectReceivingPackage(packet)};}
      const packet=await createReceivingPackage(store,{includeSoftware:input.includeSoftware!==false}),inspection=inspectReceivingPackage(packet),reference=await store.putExport(Buffer.from(JSON.stringify(packet)));
      const record=await store.save('handover',{label:input.label??'Complete operating handover',state:'EXPORTED',reference,
        workspaceId:packet.workspaceId,artifactStorage:'producing-workspace-exports',totalFiles:inspection.totalFiles,totalBytes:inspection.totalBytes,packageSha256:packet.sha256},{id});
      return{record,reference,inspection};
    });
  }
  const readers={view,list,get,readObject,readSource,readDraft,readCapture};
  const writers={saveConnection,importSource,saveDraft,capture,prepareOperation,refreshOperation,executeOperation,reconcileOperation,commission,probe,addNote,exportHandover};
  async function action(method,input={}) {
    validateGraviteeAction(method,input);
    if(Object.hasOwn(readers,method))return readers[method](input);
    requireValue(Object.hasOwn(writers,method),'ACTION_UNKNOWN');
    return write(()=>writers[method](input));
  }
  async function close(){closed=true;await Promise.allSettled([...active]);store.close();}
  return{schema:SCHEMA,directory,workspaceId:store.identity.workspaceId,action,close,
    methods:{read:Object.keys(readers),write:Object.keys(writers)}};
}
