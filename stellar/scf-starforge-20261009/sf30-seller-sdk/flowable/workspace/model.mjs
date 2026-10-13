// MIT. Complete native Flowable operations, original-request recovery and customer receiving.
import {randomUUID} from 'node:crypto';
import {normalizeFlowableConnection,planFlowableRequest,createFlowableTransport,
  executeFlowableRequest,captureFlowablePortfolio,readFlowableRequestState,reconcileFlowableRequest} from '../native.mjs';
import {FLOWABLE_DMN_COLLECTIONS as DECISION_COLLECTIONS,planFlowableDmnRequest,createFlowableDmnTransport,
  executeFlowableDmnRequest,captureFlowableDmnPortfolio,readFlowableDmnRequestState,reconcileFlowableDmnRequest} from '../dmn-native.mjs';
import {FLOWABLE_CMMN_COLLECTIONS as CASE_COLLECTIONS,FLOWABLE_CMMN_ACTION_GROUPS as CASE_ACTIONS,
  planFlowableCmmnRequest,createFlowableCmmnTransport,executeFlowableCmmnRequest,captureFlowableCmmnPortfolio,
  readFlowableCmmnRequestState,reconcileFlowableCmmnRequest} from '../cmmn-native.mjs';
import {FLOWABLE_OPERATION_KINDS,flowableCaseInstanceId} from './actions.mjs';
import {buildFlowableReview} from './review.mjs';
import {createFlowableProgrammeActions} from './programmes.mjs';
import {openFlowableStore,SCHEMA,KINDS,textHash,field,recordId,requestId,idFor} from './store.mjs';
import {need,digest,now} from '../../../distribution/runtime-workspace/storage.mjs';
import {exportFlowableDelivery,inspectFlowableDelivery,adoptFlowableDelivery,
  stageFlowableDelivery,ensureFlowableDeliveryFile} from './delivery.mjs';

const OPERATION_KINDS=FLOWABLE_OPERATION_KINDS;
const DECISION_KINDS=new Set(['decisionPortfolio','decisionRelease','decisionEvaluation']);
const PROCESS_NATIVE=Object.freeze({plan:planFlowableRequest,transport:createFlowableTransport,execute:executeFlowableRequest,
  capture:captureFlowablePortfolio,read:readFlowableRequestState,reconcile:reconcileFlowableRequest});
const DECISION_NATIVE=Object.freeze({plan:planFlowableDmnRequest,transport:createFlowableDmnTransport,execute:executeFlowableDmnRequest,
  capture:captureFlowableDmnPortfolio,read:readFlowableDmnRequestState,reconcile:reconcileFlowableDmnRequest});
const CASE_KINDS=new Set(['casePortfolio',...Object.keys(CASE_ACTIONS)]);
const CASE_NATIVE=Object.freeze({plan:planFlowableCmmnRequest,transport:createFlowableCmmnTransport,
  execute:executeFlowableCmmnRequest,capture:captureFlowableCmmnPortfolio,
  read:readFlowableCmmnRequestState,reconcile:reconcileFlowableCmmnRequest});
const adapterFor=kind=>CASE_KINDS.has(kind)?CASE_NATIVE:DECISION_KINDS.has(kind)?DECISION_NATIVE:PROCESS_NATIVE;
const COLLECTIONS=['deployments','definitions','processes','tasks','historicProcesses',
  'historicTasks','historicActivities','historicVariables'];
const collectionsFor=kind=>kind==='casePortfolio'?CASE_COLLECTIONS:kind==='decisionPortfolio'?DECISION_COLLECTIONS:COLLECTIONS;
const portfolioMethods={portfolio:'capturePortfolio',decisionPortfolio:'captureDecisionPortfolio',casePortfolio:'captureCasePortfolio'};
const portfolioLabels={portfolio:'Engine portfolio',decisionPortfolio:'Decision portfolio',casePortfolio:'Case portfolio'};
const READABLE=new Set(['view','listRecords','getRecord','readPortfolio','readDefinition','readSource',
  'readReview','readDecisionPortfolio','readDecisionDefinition','readDecisionExecution',
  'readCasePortfolio','readCaseDefinition','readCaseInstance','readProgramme','deliveryFile','sourceFile']);
const EXPECTED_ACTIONS={release:['deploy'],process:['start'],task:['claim','complete','delegate','resolve'],migration:['migrate'],
  decisionRelease:['deploy'],decisionEvaluation:['evaluate'],...CASE_ACTIONS};
const recordRef=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
function errorInfo(error){
  return{code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,120}$/.test(error.code)?error.code:'FLOWABLE_OPERATION_FAILED',
    message:String(error?.message??'The original operation could not finish.').slice(0,2000),
    outcomeUnknown:error?.outcomeUnknown===true,at:now()};
}
function retainedInput(input){const {signal,...value}=input;return value;}
function request(input,method){
  need(input&&typeof input==='object'&&!Array.isArray(input),'FLOWABLE_INPUT_INVALID');requestId(input.requestId);
  const {signal,...args}=input;
  return{id:input.requestId,sha256:textHash({method,args})};
}
function page(input={}){
  const offset=input.offset??0,limit=input.limit??50;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=500,'FLOWABLE_PAGE_INVALID');
  return{offset,limit};
}
const visible=record=>({schema:SCHEMA,kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256,
  createdAt:record.createdAt,updatedAt:record.updatedAt,label:record.value.label??record.value.connection?.label??record.id,
  state:record.value.state??record.value.phase??'SAVED',phase:record.value.phase,summary:record.value.summary,
  connectionId:record.value.connectionId??record.value.connection?.id});
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
};
function nativeIdentity(state){
  const output={connectionId:state.connectionId,connectionSha256:state.connectionSha256,action:state.action};
  for(const key of ['definitions','deployments','processes','historicProcesses','tasks','historicTasks','activities','historicActivities']){
    output[key]=(state[key]??[]).map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  output.exchanges=(state.exchanges??[]).map(exchange=>({requestSha256:exchange.requestSha256??exchange.request?.requestSha256??null,
    method:exchange.request?.method??null,path:exchange.request?.path??null,status:exchange.status??null,
    bodyBytes:exchange.bodyBytes??null,bodySha256:exchange.bodySha256??null})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  output.resources=(state.resources??[]).map(resource=>({kind:resource.kind??null,definitionId:resource.definitionId??null,
    deploymentId:resource.deploymentId,filename:resource.filename,contentType:resource.contentType??null,
    bytes:resource.bytes??null,sha256:resource.sha256??null})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return output;
}
function operationIdentity(kind,state){
  const native=nativeIdentity(state);
  if(CASE_KINDS.has(kind)){
    for(const key of CASE_COLLECTIONS)if(!Object.hasOwn(native,key))
      native[key]=(state[key]??[]).map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return native;
  }
  if(!DECISION_KINDS.has(kind))return native;
  // The selected definition and its resources own evaluation semantics. Concurrent evaluations
  // may add history without changing that selection; retain them in the original state, not its preimage.
  return {connectionId:native.connectionId,connectionSha256:native.connectionSha256,action:native.action,
    definitions:native.definitions,deployments:native.deployments,
    resources:native.resources.filter(resource=>resource.kind==='dmn-definition-resource')};
}
const SUMMARY_COLLECTIONS=['definitions','deployments','processes','historicProcesses','tasks',
  'historicTasks','activities','historicActivities','historicExecutions','resources'];
const summaryOf=state=>Object.fromEntries([...new Set([...SUMMARY_COLLECTIONS,
  ...CASE_COLLECTIONS.filter(key=>Array.isArray(state?.[key]))])].map(key=>[key,(state?.[key]??[]).length]));

export async function openFlowableWorkspace({directory,connections=[],environment=process.env,fetch=globalThis.fetch,
  signal,timeoutMs=120000,maximumResponseBytes=64*1024*1024}={}){
  need(Array.isArray(connections),'FLOWABLE_CONNECTIONS_INVALID');
  const store=await openFlowableStore(directory),controller=new AbortController(),active=new Set();
  let closing=false,closed=false,closePromise,serial=Promise.resolve();
  const workspaceId=store.identity.workspaceId;
  const combineSignal=extra=>{
    const sources=[controller.signal,signal,extra].filter(Boolean);
    return sources.length===1?sources[0]:AbortSignal.any(sources);
  };
  function run(fn,{write=false,signal:incoming}={}){
    need(!closing&&!closed,'FLOWABLE_WORKSPACE_CLOSING','The workspace is closing.',409);
    const operation=write?serial.then(()=>{
      need(!closing,'FLOWABLE_WORKSPACE_CLOSING',undefined,409);return fn(combineSignal(incoming));
    }):Promise.resolve().then(()=>fn(combineSignal(incoming)));
    if(write)serial=operation.catch(()=>{});
    active.add(operation);operation.then(()=>active.delete(operation),()=>active.delete(operation));return operation;
  }
  async function lookupConnection(id){
    recordId(id);const record=await store.get('connection',id),connection=normalizeFlowableConnection(record.value.connection);
    need(textHash(connection)===record.value.configurationSha256,'FLOWABLE_CONNECTION_RECORD_CHANGED');
    return{record,connection};
  }
  const transport=(connection,operationSignal,kind='process')=>adapterFor(kind).transport(connection,
    {environment,fetch,signal:operationSignal,timeoutMs,maxResponseBytes:maximumResponseBytes});
  async function sinks(id,extra={}){
    return{...extra,retainBodies:false,
      async onExchange(exchange){
        const reference=await store.putJSON(exchange);
        await store.appendJournal(id,{type:'exchange',reference,exchangeId:exchange.id??null,
          connectionId:exchange.connectionId,status:exchange.status??null,bodySha256:exchange.bodySha256??null,
          requestSha256:exchange.requestSha256??exchange.request?.requestSha256??null});
        return reference;
      },
      async onDefinition(definition){
        let originalResource;
        if(typeof definition.contentBase64==='string'){
          const bytes=Buffer.from(definition.contentBase64,'base64');
          need(bytes.toString('base64')===definition.contentBase64&&bytes.length===definition.bytes&&
            digest(bytes)===definition.sha256,'FLOWABLE_NATIVE_RESOURCE_HASH_MISMATCH');
          originalResource=await store.putBlob(bytes,definition.contentType??'application/octet-stream');
        }
        const reference=await store.putJSON({...definition,...(originalResource?{originalResource}:{})});
        await store.appendJournal(id,{type:'definition',reference,definitionId:definition.definitionId??null,
          deploymentId:definition.deploymentId??null,filename:definition.filename??null,
          definitionSha256:definition.sha256??null});return reference;
      },
    };
  }
  async function completeExchange(exchange){
    return exchange?.bodyRef?{...exchange,...await store.getJSON(exchange.bodyRef)}:exchange;
  }
  async function hydrateResource(resource){
    return resource?.definitionRef?{...resource,...await store.getJSON(resource.definitionRef)}:resource;
  }
  async function sameConfiguration(record){
    const selected=await lookupConnection(record.value.connectionId);
    need(selected.record.value.configurationSha256===record.value.configurationSha256,'FLOWABLE_TARGET_CHANGED',
      'The engine configuration changed after preparation. Prepare a new review for its current target.',409);
    return selected.connection;
  }
  async function replay(input,method,latest=false){
    const selected=request(input,method),prior=await store.findRequest(selected.id,selected.sha256);
    return{selected,prior:prior&&(latest?await store.get(prior.kind,prior.id):prior)};
  }
  async function initial(kind,input,method,value,{id,expectedRevision=0}={}){
    const selected=request(input,method);
    return store.commit(kind,id??idFor(selected.id),{expectedRevision,requestId:selected.id,requestSha256:selected.sha256,value});
  }
  async function retainFailure(record,error,phase){
    let journal,partialExchange;
    if(error?.exchange){
      partialExchange=error.exchange.bodyRef??await store.putJSON(error.exchange);
      await store.appendJournal(record.id,{type:'interrupted-exchange',reference:partialExchange,
        planSha256:error.exchange.request?.planSha256??null,status:error.exchange.status??null});
    }
    try{journal=await store.journal(record.id);}catch{}
    return store.revise(record,{...record.value,phase,state:phase,
      failure:{...errorInfo(error),...(partialExchange?{exchange:partialExchange}:{})},
      ...(journal?{journal:journal.original,retainedEvents:journal.events.length}:{})});
  }
  async function view(){
    const heads=await store.heads(),records=[];
    for(const reference of heads.filter(item=>item.kind==='connection')){
      const record=await store.get('connection',reference.id),configured=record.value.connection;
      records.push({...visible(record),connection:configured,configurationSha256:record.value.configurationSha256,
        credentialAvailable:typeof environment[configured.usernameEnv]==='string'&&environment[configured.usernameEnv].length>0&&
          typeof environment[configured.passwordEnv]==='string'&&environment[configured.passwordEnv].length>0});
    }
    return{schema:SCHEMA,workspaceId,directory:store.directory,createdAt:store.identity.createdAt,connections:records,
      counts:Object.fromEntries(KINDS.map(kind=>[kind,heads.filter(item=>item.kind===kind).length])),closing,
      capabilities:{engine:'Flowable REST',deployments:'original-bpmn-or-archive',humanTasks:['claim','complete','delegate','resolve'],
        migration:'native-process-instance-validation',history:'original-engine',delivery:'complete-source-and-history',
        decisions:{engine:'Flowable DMN REST',releases:'original-dmn-resource',evaluation:'native-decision-key-selection',history:'native-execution-audit'},
        cases:{engine:'Flowable CMMN REST',releases:'original-cmmn-resource',operations:CASE_ACTIONS,
          collections:CASE_COLLECTIONS,history:'native-case-and-plan-item-history'}}};
  }
  async function listRecords(input={}){
    const result=await store.list(input);return{...result,items:result.items.map(visible)};
  }
  async function getRecord(input){
    const record=await store.get(input.kind,input.id,input.revision),output={...record};
    if(OPERATION_KINDS.includes(record.kind)){
      if(record.value.plan)output.plan=await store.getJSON(record.value.plan);
      if(record.value.reconciliation)output.reconciliation=await store.getJSON(record.value.reconciliation);
      if(record.value.validation)output.validation=await responseSummary(record.value.validation);
      if(record.value.response)output.response=await responseSummary(record.value.response);
    }
    if(Object.hasOwn(portfolioMethods,record.kind)&&record.value.inventory){
      const inventory=await store.getJSON(record.value.inventory);
      output.portfolio={startedAt:inventory.startedAt,completedAt:inventory.completedAt,
        collections:Object.fromEntries(Object.entries(inventory.collections??{}).map(([key,value])=>[key,
          {total:value.total,retained:(value.items??[]).length,complete:value.complete,pages:(value.pages??[]).length}])),
        resources:(inventory.resources??[]).length};
    }
    return output;
  }
  async function responseSummary(reference){
    const original=await completeExchange(await store.getJSON(reference));
    return{id:original.id,status:original.status,statusText:original.statusText,ok:original.ok,bodyBytes:original.bodyBytes,
      bodySha256:original.bodySha256,reference,
      ...(original.bodyBytes<=1024*1024?{json:original.json,bodyText:original.json==null?original.bodyText:undefined}:{})};
  }
  async function portfolioRecord(id,revision,kind='portfolio'){
    const record=await store.get(kind,recordId(id),revision);
    need(record.value.inventory,'FLOWABLE_PORTFOLIO_INCOMPLETE','This capture has no complete portfolio.',409);
    return{record,inventory:await store.getJSON(record.value.inventory)};
  }
  async function readCapturedPortfolio(kind,input){
    const collections=collectionsFor(kind);
    need(collections.includes(input.collection),'FLOWABLE_COLLECTION_INVALID');
    const{record,inventory}=await portfolioRecord(input.id,input.revision,kind);
    const collection=inventory.collections[input.collection],selected=page(input);
    need(collection&&Array.isArray(collection.items),'FLOWABLE_COLLECTION_ABSENT',undefined,404);
    const items=collection.items.slice(selected.offset,selected.offset+selected.limit);
    return{portfolio:recordRef(record),collection:input.collection,...selected,items,total:collection.items.length,
      nativeTotal:collection.total,complete:collection.complete,pages:collection.pages,exchanges:collection.exchanges,
      nextOffset:selected.offset+items.length<collection.items.length?selected.offset+items.length:null};
  }
  const readPortfolio=input=>readCapturedPortfolio('portfolio',input);
  const readDecisionPortfolio=input=>readCapturedPortfolio('decisionPortfolio',input);
  const readCasePortfolio=input=>readCapturedPortfolio('casePortfolio',input);
  async function readCapturedDefinition(kind,input){
    const{record,inventory}=await portfolioRecord(input.portfolioId,input.revision,kind);
    const definition=inventory.collections.definitions.items.find(item=>item.id===input.definitionId);
    need(definition,'FLOWABLE_DEFINITION_NOT_IN_PORTFOLIO',undefined,404);
    const resources=[],nativeLinks=new Set([definition.resource,definition.diagramResource,definition.resourceName].filter(value=>typeof value==='string'&&value.length));
    for(const item of inventory.resources??[]){
      if(item.deploymentId===definition.deploymentId&&(item.definitionId===definition.id||
        item.definitionIds?.includes(definition.id)||nativeLinks.has(item.native?.url)||nativeLinks.has(item.filename)))
        resources.push(await hydrateResource(item));
    }
    const deployment=inventory.collections.deployments?.items?.find(item=>item.id===definition.deploymentId)??null;
    return{portfolio:recordRef(record),definition,deployment,resources};
  }
  const readDefinition=input=>readCapturedDefinition('portfolio',input);
  const readDecisionDefinition=input=>readCapturedDefinition('decisionPortfolio',input);
  const readCaseDefinition=input=>readCapturedDefinition('casePortfolio',input);
  async function readCaseInstance(input){
    const{record,inventory}=await portfolioRecord(input.portfolioId,input.revision,'casePortfolio');
    const id=field(input.caseInstanceId,2000),caseInstance=inventory.collections.cases?.items?.find(item=>item.id===id)??null,
      historicCase=inventory.collections.historicCases?.items?.find(item=>item.id===id)??null;
    need(caseInstance||historicCase,'FLOWABLE_CASE_NOT_IN_PORTFOLIO',undefined,404);
    const related={};
    for(const key of CASE_COLLECTIONS){
      if(['deployments','definitions','cases','historicCases'].includes(key))continue;
      related[key]=(inventory.collections[key]?.items??[]).filter(item=>flowableCaseInstanceId(item)===id);
    }
    const definitionIds=[...new Set([caseInstance?.caseDefinitionId,historicCase?.caseDefinitionId].filter(Boolean))];
    const definitions=inventory.collections.definitions.items.filter(item=>definitionIds.includes(item.id));
    const resources=[];
    for(const definition of definitions){
      const original=await readCapturedDefinition('casePortfolio',{portfolioId:record.id,revision:record.revision,definitionId:definition.id});
      for(const resource of original.resources)if(!resources.some(item=>item.deploymentId===resource.deploymentId&&item.filename===resource.filename))resources.push(resource);
    }
    for(const item of inventory.resources??[]){
      if(item.kind==='cmmn-variable-data'&&item.caseInstanceId===id)
        resources.push(await hydrateResource(item));
    }
    return{portfolio:recordRef(record),caseInstance,historicCase,definitions,related,resources};
  }
  async function readDecisionExecution(input){
    const{record,inventory}=await portfolioRecord(input.portfolioId,input.revision,'decisionPortfolio');
    const execution=inventory.collections.historicExecutions.items.find(item=>item.id===input.executionId);
    need(execution,'FLOWABLE_DECISION_EXECUTION_NOT_IN_PORTFOLIO',undefined,404);
    const resources=[];
    for(const item of inventory.resources??[])if(item.executionId===execution.id)resources.push(await hydrateResource(item));
    return{portfolio:recordRef(record),execution,resources};
  }
  async function readSource(input){
    const bytes=await store.readBlob(input.reference);
    if(/(?:^application\/json$|\+json$)/.test(input.reference.mediaType??'')){
      return{reference:input.reference,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
    }
    return{reference:input.reference,contentBase64:Buffer.from(bytes).toString('base64'),
      ...(/^(?:text\/|application\/(?:xml|json))/.test(input.reference.mediaType??'')?
        {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}:{})};
  }
  async function saveConnection(input){
    const{prior}=await replay(input,'saveConnection');if(prior)return prior;
    const connection=normalizeFlowableConnection(input.connection),id=input.id?recordId(input.id):idFor('connection:'+connection.id);
    if(input.id){
      const previous=await store.get('connection',id);
      need(previous.value.connection.id===connection.id,'FLOWABLE_CONNECTION_ALIAS_CHANGED','Use a new connection for another engine alias.',409);
    }
    for(const ref of await store.heads('connection')){
      if(ref.id!==id)need((await store.get('connection',ref.id)).value.connection.id!==connection.id,
        'FLOWABLE_CONNECTION_ALIAS_EXISTS',undefined,409);
    }
    return initial('connection',input,'saveConnection',{label:connection.label,connection,configurationSha256:textHash(connection),
      state:'SAVED'},{id,expectedRevision:input.expectedRevision??0});
  }
  async function captureNativePortfolio(kind,input,operationSignal){
    const method=portfolioMethods[kind];
    const native=adapterFor(kind),collections=collectionsFor(kind);
    const{prior}=await replay(input,method,true);
    if(prior&&!['CAPTURING','INTERRUPTED'].includes(prior.value.phase))return prior;
    let record=prior,connection;
    if(prior){
      connection=await sameConfiguration(prior);
      record=await store.revise(prior,{...prior.value,phase:'CAPTURING',state:'CAPTURING',
        captureInput:prior.value.captureInput??await store.putJSON(retainedInput(input)),failure:null,resumedAt:now()});
    }else{
      const selected=await lookupConnection(input.connectionId);connection=selected.connection;
      record=await initial(kind,input,method,{label:field(input.label??portfolioLabels[kind],300,true),
        connectionId:selected.record.id,configurationSha256:selected.record.value.configurationSha256,connection,
        captureInput:await store.putJSON(retainedInput(input)),phase:'CAPTURING',state:'CAPTURING',startedAt:now()});
    }
    try{
      const inventory=await native.capture(transport(connection,operationSignal,kind),await sinks(record.id));
      need(collections.every(key=>inventory.collections?.[key]?.complete===true),
        'FLOWABLE_PORTFOLIO_INCOMPLETE','An original native collection did not complete.');
      const journal=await store.journal(record.id);
      record=await store.revise(record,{...record.value,inventory:await store.putJSON(inventory),journal:journal.original,
        phase:'CAPTURED',state:'CAPTURED',completedAt:inventory.completedAt??now(),
        summary:{...Object.fromEntries(collections.map(key=>[key,inventory.collections[key].items.length])),
          resources:inventory.resources.length}});return record;
    }catch(error){return retainFailure(record,error,'INTERRUPTED');}
  }
  const capturePortfolio=(input,operationSignal)=>captureNativePortfolio('portfolio',input,operationSignal);
  const captureDecisionPortfolio=(input,operationSignal)=>captureNativePortfolio('decisionPortfolio',input,operationSignal);
  const captureCasePortfolio=(input,operationSignal)=>captureNativePortfolio('casePortfolio',input,operationSignal);
  async function prepareOperation(kind,input,operationSignal){
    const method='prepare'+kind[0].toUpperCase()+kind.slice(1),{prior}=await replay(input,method,true);
    const native=adapterFor(kind);let record=prior,connection,selection,plan;
    if(prior){
      if(prior.value.dispatchedAt||!['PREPARING','INTERRUPTED','PREPARE_FAILED'].includes(prior.value.phase))return prior;
      connection=await sameConfiguration(prior);
      selection=await store.getJSON(prior.value.selection);plan=await store.getJSON(prior.value.plan);
      need(textHash(plan)===prior.value.planSha256&&textHash(native.plan(connection,selection))===prior.value.planSha256,
        'FLOWABLE_NATIVE_PLAN_CHANGED');
      record=await store.revise(prior,{...prior.value,phase:'PREPARING',state:'PREPARING',
        preparationInput:prior.value.preparationInput??await store.putJSON(retainedInput(input)),failure:null,resumedAt:now()});
    }else{
      need(EXPECTED_ACTIONS[kind]?.includes(input.selection?.action),'FLOWABLE_OPERATION_SELECTION_INVALID');
      const selected=await lookupConnection(input.connectionId);connection=selected.connection;selection=input.selection;
      plan=native.plan(connection,selection);const planSha256=textHash(plan),requestBody=Buffer.from(plan.bodyBase64??'','base64');
      need(requestBody.toString('base64')===(plan.bodyBase64??''),'FLOWABLE_NATIVE_BODY_INVALID');
      let sourceResource;
      if(selection.resource){
        const bytes=Buffer.from(selection.resource.contentBase64,'base64');
        sourceResource={filename:selection.resource.filename,reference:await store.putBlob(bytes,selection.resource.contentType??'application/octet-stream')};
      }
      record=await initial(kind,input,method,{label:field(input.label??'Flowable '+kind,300,true),note:field(input.note??'',20000),
        phase:'PREPARING',state:'PREPARING',connectionId:selected.record.id,connection,configurationSha256:selected.record.value.configurationSha256,
        preparationInput:await store.putJSON(retainedInput(input)),selection:await store.putJSON(selection),plan:await store.putJSON(plan),planSha256,
        requestBody:await store.putBlob(requestBody,plan.contentType??'application/octet-stream'),
        ...(sourceResource?{sourceResource}:{}),
        summary:{action:plan.action,method:plan.method,path:plan.path,bodyBytes:requestBody.length}});
    }
    try{
      const client=transport(connection,operationSignal,kind),callbacks=await sinks(record.id);
      const before=await native.read(client,plan,callbacks),beforeRef=await store.putJSON(before);
      let validationRef=null,validationPlanRef=null,validation=null,valid=true;
      if(kind==='migration'){
        const validationPlan=planFlowableRequest(connection,{...selection,action:'validateMigration'});
        validationPlanRef=await store.putJSON(validationPlan);
        validation=await completeExchange(await executeFlowableRequest(client,validationPlan,callbacks));
        validationRef=await store.putJSON(validation);
        valid=validation.ok===true&&Array.isArray(validation.json?.validationMessages)&&validation.json.validationMessages.length===0;
      }
      const journal=await store.journal(record.id);
      record=await store.revise(record,{...record.value,before:beforeRef,preimageSha256:textHash(operationIdentity(kind,before)),
        validation:validationRef,validationPlan:validationPlanRef,journal:journal.original,
        phase:valid?'PREPARED':'INVALID',state:valid?'PREPARED':'INVALID',preparedAt:now(),
        summary:{...record.value.summary,preimage:summaryOf(before),
          ...(kind==='migration'?{validationMessages:validation.json?.validationMessages??null,validationStatus:validation.status}:{})}});
      return record;
    }catch(error){return retainFailure(record,error,'PREPARE_FAILED');}
  }
  async function finishReadback(record,client,operationSignal){
    operationSignal.throwIfAborted();
    const native=adapterFor(record.kind),plan=await store.getJSON(record.value.plan),before=await store.getJSON(record.value.before);
    const response=record.value.response?await completeExchange(await store.getJSON(record.value.response)):null;
    const after=await native.read(client,plan,await sinks(record.id,{response}));
    const result=native.reconcile(plan,before,after,response),journal=await store.journal(record.id);
    return store.revise(record,{...record.value,after:await store.putJSON(after),reconciliation:await store.putJSON(result),
      journal:journal.original,phase:'COMPLETED',state:result.state,completedAt:now(),failure:null,
      summary:{...record.value.summary,result:result.state,responseStatus:response?.status??null,
        readback:summaryOf(after),resultSummary:result.summary}});
  }
  async function dispatchOperation(kind,input,operationSignal){
    const method='dispatch'+kind[0].toUpperCase()+kind.slice(1),resumed=await replay(input,method,true);
    if(resumed.prior)return resumed.prior;
    let record=await store.get(kind,recordId(input.id));
    need(input.planSha256===record.value.planSha256,'FLOWABLE_REVIEW_HASH_CHANGED','Execute the exact request shown in this saved review.',409);
    if(record.value.phase!=='PREPARED')return record;
    need(record.revision===input.expectedRevision,'FLOWABLE_RECORD_CONFLICT','Refresh the saved review.',409);
    const native=adapterFor(kind),connection=await sameConfiguration(record),plan=await store.getJSON(record.value.plan),selection=await store.getJSON(record.value.selection);
    need(textHash(native.plan(connection,selection))===record.value.planSha256,'FLOWABLE_NATIVE_PLAN_CHANGED');
    const client=transport(connection,operationSignal,kind);
    try{
      const current=await native.read(client,plan,await sinks(record.id));
      if(textHash(operationIdentity(kind,current))!==record.value.preimageSha256){
        return store.revise(record,{...record.value,phase:'STALE',state:'STALE',preflight:await store.putJSON(current),
          failure:{code:'FLOWABLE_PREIMAGE_CHANGED',message:'The selected native definition, process, case, work item, task or decision changed after preparation. Prepare a new review of its current state.',at:now()}});
      }
      // Migration validation is native and current at dispatch, using the original complete document.
      if(kind==='migration'){
        const validationPlan=await store.getJSON(record.value.validationPlan);
        const validation=await completeExchange(await executeFlowableRequest(client,validationPlan,await sinks(record.id)));
        const validationRef=await store.putJSON(validation);
        if(!validation.ok||!Array.isArray(validation.json?.validationMessages)||validation.json.validationMessages.length){
          return store.revise(record,{...record.value,phase:'INVALID',state:'INVALID',validation:validationRef,
            summary:{...record.value.summary,validationStatus:validation.status,validationMessages:validation.json?.validationMessages??null}});
        }
        record=await store.revise(record,{...record.value,validation:validationRef});
      }
      operationSignal.throwIfAborted();
      record=await store.commit(kind,record.id,{expectedRevision:record.revision,requestId:resumed.selected.id,
        requestSha256:resumed.selected.sha256,value:{...record.value,phase:'DISPATCHED',state:'DISPATCHED',
          dispatchedAt:now(),dispatchRequestId:input.requestId,preflight:await store.putJSON(current)}});
      // The durable dispatch precedes the native mutation. Recovery reads this request's outcome.
      const response=await completeExchange(await native.execute(client,plan,await sinks(record.id)));
      const responseRef=await store.putJSON(response);
      await store.appendJournal(record.id,{type:'dispatch-response',reference:responseRef,planSha256:record.value.planSha256,
        status:response.status,bodySha256:response.bodySha256});
      record=await store.revise(record,{...record.value,response:responseRef,phase:'READBACK',state:'READBACK',responseAt:now()});
      return await finishReadback(record,client,operationSignal);
    }catch(error){
      const latest=await store.get(kind,record.id);
      return retainFailure(latest,error,latest.value.dispatchedAt?'UNKNOWN':'PREPARE_FAILED');
    }
  }
  async function reconcileOperation(input,operationSignal){
    need(OPERATION_KINDS.includes(input.kind),'FLOWABLE_OPERATION_KIND_INVALID');
    const resumed=await replay(input,'reconcileOperation',true);
    if(resumed.prior&&!['UNKNOWN','DISPATCHED','READBACK'].includes(resumed.prior.value.state))return resumed.prior;
    let record=resumed.prior??await store.get(input.kind,recordId(input.id));
    need(record.value.dispatchedAt&&record.value.before,'FLOWABLE_DISPATCH_REQUIRED','This saved request has not been dispatched.',409);
    if(!resumed.prior&&input.expectedRevision!=null)need(record.revision===input.expectedRevision,'FLOWABLE_RECORD_CONFLICT',undefined,409);
    const connection=await sameConfiguration(record);
    const value={...record.value,phase:'READBACK',state:'READBACK',reconcileRequestId:input.requestId};
    // A saved readback may be retried; the original native dispatch remains unchanged.
    record=resumed.prior?await store.revise(record,{...value,resumedAt:now()}):
      await store.commit(input.kind,record.id,{expectedRevision:record.revision,requestId:resumed.selected.id,
        requestSha256:resumed.selected.sha256,value});
    try{
      if(!record.value.response){
        const retained=await store.journal(record.id);
        const responseEvent=[...retained.events].reverse().find(item=>item.type==='dispatch-response'&&
          item.planSha256===record.value.planSha256);
        let selectedResponse=responseEvent?.reference;
        if(!selectedResponse){
          const plan=await store.getJSON(record.value.plan);
          for(const event of [...retained.events].reverse()){
            if(event.type!=='exchange'||event.requestSha256!==plan.requestSha256)continue;
            const exchange=await completeExchange(await store.getJSON(event.reference));
            if((exchange.requestSha256??exchange.request?.requestSha256)===plan.requestSha256&&Number.isInteger(exchange.status)){
              selectedResponse=event.reference;break;
            }
          }
        }
        if(selectedResponse)record=await store.revise(record,{...record.value,response:selectedResponse});
      }
      return await finishReadback(record,transport(connection,operationSignal,input.kind),operationSignal);
    }catch(error){return retainFailure(record,error,'UNKNOWN');}
  }
  async function readReview(input){
    need(OPERATION_KINDS.includes(input.kind),'FLOWABLE_OPERATION_KIND_INVALID');
    const record=await store.get(input.kind,input.id,input.revision);
    const values={record:recordRef(record),value:record.value};
    for(const key of ['plan','selection','before','after','reconciliation']){
      if(record.value[key])values[key]=await store.getJSON(record.value[key]);
    }
    if(record.value.validation)values.validation=await completeExchange(await store.getJSON(record.value.validation));
    if(record.value.response)values.response=await completeExchange(await store.getJSON(record.value.response));
    return buildFlowableReview(values);
  }
  async function exportWorkspace(input){request(input,'exportWorkspace');return exportFlowableDelivery(store,input);}
  async function inspectDelivery(input){request(input,'inspectDelivery');return inspectFlowableDelivery(store,input);}
  async function adoptDelivery(input){request(input,'adoptDelivery');return adoptFlowableDelivery(store,input);}
  async function deliveryFile(input){
    const record=await store.get('delivery',recordId(input.id));
    need(record.value.state==='EXPORTED','FLOWABLE_DELIVERY_INCOMPLETE',undefined,409);
    return{...await ensureFlowableDeliveryFile(store,record),record:recordRef(record)};
  }
  async function sourceFile(input){
    return{path:store.blobPath(input.reference),bytes:input.reference.bytes,sha256:input.reference.sha256,
      mediaType:input.reference.mediaType??'application/octet-stream',filename:'flowable-source-'+input.reference.sha256+'.source'};
  }
  async function programmeDocument(record,document){
    if(document==='response'){
      need(record.value.response,'FLOWABLE_PROGRAMME_DOCUMENT_ABSENT');
      return completeExchange(await store.getJSON(record.value.response));
    }
    need(['before','after','reconciliation','selection'].includes(document)&&record.value[document],
      'FLOWABLE_PROGRAMME_DOCUMENT_ABSENT');
    return store.getJSON(record.value[document]);
  }
  const programmeActions=createFlowableProgrammeActions({store,lookupConnection,sameConfiguration,
    prepareOperation,readDocument:programmeDocument});
  const methods={...programmeActions,view,listRecords,getRecord,readPortfolio,readDefinition,readDecisionPortfolio,readDecisionDefinition,
    readCasePortfolio,readCaseDefinition,readCaseInstance,
    readSource,readReview,readDecisionExecution,saveConnection,capturePortfolio,captureDecisionPortfolio,captureCasePortfolio,
    reconcileOperation,exportWorkspace,inspectDelivery,adoptDelivery,deliveryFile,sourceFile};
  for(const kind of OPERATION_KINDS){
    const name=kind[0].toUpperCase()+kind.slice(1);
    methods['prepare'+name]=(input,operationSignal)=>prepareOperation(kind,input,operationSignal);
    methods['dispatch'+name]=(input,operationSignal)=>dispatchOperation(kind,input,operationSignal);
  }
  async function close(){
    if(closed)return;if(closePromise)return closePromise;
    closing=true;controller.abort(Object.assign(new Error('Workspace close requested.'),{code:'FLOWABLE_WORKSPACE_CLOSING'}));
    closePromise=(async()=>{await Promise.allSettled([...active]);await store.close();closed=true;})()
      .catch(error=>{closePromise=undefined;throw error;});return closePromise;
  }
  try{
    for(const declaration of connections){
      const connection=normalizeFlowableConnection(declaration),id=idFor('connection:'+connection.id);
      if(!(await store.head('connection',id)))await saveConnection({requestId:randomUUID(),connection});
    }
    for(const head of await store.heads('receiving')){
      const received=await store.get('receiving',head.id);
      if(received.value.state==='ADOPTING')await adoptFlowableDelivery(store,{requestId:received.value.adoptRequestId,id:received.id,
        expectedRevision:received.value.adoptExpectedRevision,manifestSha256:received.value.manifestSha256});
    }
    for(const head of await store.heads()){
      if(![...Object.keys(portfolioMethods),...OPERATION_KINDS].includes(head.kind))continue;
      const record=await store.get(head.kind,head.id);
      if(['CAPTURING','PREPARING'].includes(record.value.phase))await retainFailure(record,
        {code:'FLOWABLE_PROCESS_INTERRUPTED',message:'The prior process stopped during native source capture. Its retained originals are available.'},'INTERRUPTED');
    }
    const api={schema:SCHEMA,workspaceId,directory:store.directory,close,
      stageDelivery(readable,input){return run(()=>stageFlowableDelivery(store,readable,input),{write:true});}};
    for(const[name,fn]of Object.entries(methods)){
      api[name]=(input={})=>run(operationSignal=>fn(input,operationSignal),{write:!READABLE.has(name),signal:input.signal});
    }
    return Object.freeze(api);
  }catch(error){await close();throw error;}
}
