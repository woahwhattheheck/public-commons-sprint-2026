// MIT. Complete native Flowable operations, original-request recovery and customer receiving.
import {randomUUID} from 'node:crypto';
import {normalizeFlowableConnection,planFlowableRequest,createFlowableTransport,
  executeFlowableRequest,captureFlowablePortfolio,readFlowableRequestState,reconcileFlowableRequest} from '../native.mjs';
import {buildFlowableReview} from './review.mjs';
import {openFlowableStore,SCHEMA,KINDS,textHash,field,recordId,requestId,idFor} from './store.mjs';
import {need,digest,now} from '../../../distribution/runtime-workspace/storage.mjs';
import {exportFlowableDelivery,inspectFlowableDelivery,adoptFlowableDelivery,
  stageFlowableDelivery,ensureFlowableDeliveryFile} from './delivery.mjs';

const OPERATION_KINDS=['release','process','task','migration'];
const COLLECTIONS=['deployments','definitions','processes','tasks','historicProcesses',
  'historicTasks','historicActivities','historicVariables'];
const READABLE=new Set(['view','listRecords','getRecord','readPortfolio','readDefinition','readSource',
  'readReview','deliveryFile','sourceFile']);
const EXPECTED_ACTIONS={release:['deploy'],process:['start'],task:['claim','complete','delegate','resolve'],migration:['migrate']};
const recordRef=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
function errorInfo(error){
  return{code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,120}$/.test(error.code)?error.code:'FLOWABLE_OPERATION_FAILED',
    message:String(error?.message??'The original operation could not finish.').slice(0,2000),
    outcomeUnknown:error?.outcomeUnknown===true,at:now()};
}
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
const summaryOf=state=>Object.fromEntries(['definitions','deployments','processes','historicProcesses','tasks',
  'historicTasks','activities','historicActivities','resources'].map(key=>[key,(state?.[key]??[]).length]));

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
  const transport=(connection,operationSignal)=>createFlowableTransport(connection,
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
        migration:'native-process-instance-validation',history:'original-engine',delivery:'complete-source-and-history'}};
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
    if(record.kind==='portfolio'&&record.value.inventory){
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
  async function portfolioRecord(id,revision){
    const record=await store.get('portfolio',recordId(id),revision);
    need(record.value.inventory,'FLOWABLE_PORTFOLIO_INCOMPLETE','This capture has no complete portfolio.',409);
    return{record,inventory:await store.getJSON(record.value.inventory)};
  }
  async function readPortfolio(input){
    need(COLLECTIONS.includes(input.collection),'FLOWABLE_COLLECTION_INVALID');
    const{record,inventory}=await portfolioRecord(input.id,input.revision);
    const collection=inventory.collections[input.collection],selected=page(input);
    need(collection&&Array.isArray(collection.items),'FLOWABLE_COLLECTION_ABSENT',undefined,404);
    const items=collection.items.slice(selected.offset,selected.offset+selected.limit);
    return{portfolio:recordRef(record),collection:input.collection,...selected,items,total:collection.items.length,
      nativeTotal:collection.total,complete:collection.complete,pages:collection.pages,exchanges:collection.exchanges,
      nextOffset:selected.offset+items.length<collection.items.length?selected.offset+items.length:null};
  }
  async function readDefinition(input){
    const{record,inventory}=await portfolioRecord(input.portfolioId,input.revision);
    const definition=inventory.collections.definitions.items.find(item=>item.id===input.definitionId);
    need(definition,'FLOWABLE_DEFINITION_NOT_IN_PORTFOLIO',undefined,404);
    const resources=[],nativeLinks=new Set([definition.resource,definition.diagramResource].filter(value=>typeof value==='string'&&value.length));
    for(const item of inventory.resources??[]){
      if(item.deploymentId===definition.deploymentId&&(item.definitionId===definition.id||
        item.definitionIds?.includes(definition.id)||nativeLinks.has(item.native?.url)||nativeLinks.has(item.filename)))
        resources.push(await hydrateResource(item));
    }
    return{portfolio:recordRef(record),definition,resources};
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
  async function capturePortfolio(input,operationSignal){
    const{prior}=await replay(input,'capturePortfolio',true);if(prior)return prior;
    const{connection,record:target}=await lookupConnection(input.connectionId);
    let record=await initial('portfolio',input,'capturePortfolio',{label:field(input.label??'Engine portfolio',300,true),
      connectionId:target.id,configurationSha256:target.value.configurationSha256,connection,
      phase:'CAPTURING',state:'CAPTURING',startedAt:now()});
    try{
      const inventory=await captureFlowablePortfolio(transport(connection,operationSignal),await sinks(record.id));
      need(COLLECTIONS.every(key=>inventory.collections?.[key]?.complete===true),
        'FLOWABLE_PORTFOLIO_INCOMPLETE','An original native collection did not complete.');
      const journal=await store.journal(record.id);
      record=await store.revise(record,{...record.value,inventory:await store.putJSON(inventory),journal:journal.original,
        phase:'CAPTURED',state:'CAPTURED',completedAt:inventory.completedAt??now(),
        summary:{...Object.fromEntries(COLLECTIONS.map(key=>[key,inventory.collections[key].items.length])),
          resources:inventory.resources.length}});return record;
    }catch(error){return retainFailure(record,error,'INTERRUPTED');}
  }
  async function prepareOperation(kind,input,operationSignal){
    const method='prepare'+kind[0].toUpperCase()+kind.slice(1),{prior}=await replay(input,method,true);if(prior)return prior;
    need(EXPECTED_ACTIONS[kind]?.includes(input.selection?.action),'FLOWABLE_OPERATION_SELECTION_INVALID');
    const{record:target,connection}=await lookupConnection(input.connectionId),selection=input.selection;
    const plan=planFlowableRequest(connection,selection),planSha256=textHash(plan);
    const requestBody=Buffer.from(plan.bodyBase64??'','base64');
    need(requestBody.toString('base64')===(plan.bodyBase64??''),'FLOWABLE_NATIVE_BODY_INVALID');
    let sourceResource;
    if(selection.resource){
      const bytes=Buffer.from(selection.resource.contentBase64,'base64');
      sourceResource={filename:selection.resource.filename,reference:await store.putBlob(bytes,selection.resource.contentType??'application/octet-stream')};
    }
    let record=await initial(kind,input,method,{label:field(input.label??'Flowable '+kind,300,true),note:field(input.note??'',20000),
      phase:'PREPARING',state:'PREPARING',connectionId:target.id,connection,configurationSha256:target.value.configurationSha256,
      selection:await store.putJSON(selection),plan:await store.putJSON(plan),planSha256,
      requestBody:await store.putBlob(requestBody,plan.contentType??'application/octet-stream'),
      ...(sourceResource?{sourceResource}:{}),
      summary:{action:plan.action,method:plan.method,path:plan.path,bodyBytes:requestBody.length}});
    try{
      const client=transport(connection,operationSignal),callbacks=await sinks(record.id);
      const before=await readFlowableRequestState(client,plan,callbacks),beforeRef=await store.putJSON(before);
      let validationRef=null,validationPlanRef=null,validation=null,valid=true;
      if(kind==='migration'){
        const validationPlan=planFlowableRequest(connection,{...selection,action:'validateMigration'});
        validationPlanRef=await store.putJSON(validationPlan);
        validation=await completeExchange(await executeFlowableRequest(client,validationPlan,callbacks));
        validationRef=await store.putJSON(validation);
        valid=validation.ok===true&&Array.isArray(validation.json?.validationMessages)&&validation.json.validationMessages.length===0;
      }
      const journal=await store.journal(record.id);
      record=await store.revise(record,{...record.value,before:beforeRef,preimageSha256:textHash(nativeIdentity(before)),
        validation:validationRef,validationPlan:validationPlanRef,journal:journal.original,
        phase:valid?'PREPARED':'INVALID',state:valid?'PREPARED':'INVALID',preparedAt:now(),
        summary:{...record.value.summary,preimage:summaryOf(before),
          ...(kind==='migration'?{validationMessages:validation.json?.validationMessages??null,validationStatus:validation.status}:{})}});
      return record;
    }catch(error){return retainFailure(record,error,'PREPARE_FAILED');}
  }
  async function finishReadback(record,client,operationSignal){
    operationSignal.throwIfAborted();
    const plan=await store.getJSON(record.value.plan),before=await store.getJSON(record.value.before);
    const response=record.value.response?await completeExchange(await store.getJSON(record.value.response)):null;
    const after=await readFlowableRequestState(client,plan,await sinks(record.id,{response}));
    const result=reconcileFlowableRequest(plan,before,after,response),journal=await store.journal(record.id);
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
    const connection=await sameConfiguration(record),plan=await store.getJSON(record.value.plan),selection=await store.getJSON(record.value.selection);
    need(textHash(planFlowableRequest(connection,selection))===record.value.planSha256,'FLOWABLE_NATIVE_PLAN_CHANGED');
    const client=transport(connection,operationSignal);
    try{
      const current=await readFlowableRequestState(client,plan,await sinks(record.id));
      if(textHash(nativeIdentity(current))!==record.value.preimageSha256){
        return store.revise(record,{...record.value,phase:'STALE',state:'STALE',preflight:await store.putJSON(current),
          failure:{code:'FLOWABLE_PREIMAGE_CHANGED',message:'The native definition, process or task changed after preparation. Prepare a new review of its current state.',at:now()}});
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
      const response=await completeExchange(await executeFlowableRequest(client,plan,await sinks(record.id)));
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
    const resumed=await replay(input,'reconcileOperation',true);if(resumed.prior)return resumed.prior;
    let record=await store.get(input.kind,recordId(input.id));
    need(record.value.dispatchedAt&&record.value.before,'FLOWABLE_DISPATCH_REQUIRED','This saved request has not been dispatched.',409);
    if(input.expectedRevision!=null)need(record.revision===input.expectedRevision,'FLOWABLE_RECORD_CONFLICT',undefined,409);
    const connection=await sameConfiguration(record);
    record=await store.commit(input.kind,record.id,{expectedRevision:record.revision,requestId:resumed.selected.id,
      requestSha256:resumed.selected.sha256,value:{...record.value,phase:'READBACK',state:'READBACK',reconcileRequestId:input.requestId}});
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
      return await finishReadback(record,transport(connection,operationSignal),operationSignal);
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
  const methods={view,listRecords,getRecord,readPortfolio,readDefinition,readSource,readReview,saveConnection,capturePortfolio,
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
      if(!['portfolio',...OPERATION_KINDS].includes(head.kind))continue;
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
