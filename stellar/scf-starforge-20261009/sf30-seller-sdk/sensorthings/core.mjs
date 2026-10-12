// MIT. Original workspace writer with SensorThings source and operating actions.
import {join} from 'node:path';
import {open,link,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {openWorkspaceStore,readOwned,privateDirectory,syncDir} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA,EDITION_SCHEMA,SOURCE_CONTRACT,ACTIONS,workspaceSchema,sourceConfig,sourceURL,queryURL,sourceDocument,
  serviceCatalog,collection,selectedStream,streamMeaning,linksFromEntity,pointer,entityId,valueCell,plain,fields,integer,text,
  identity,stable,json,sha,now,fault} from './contract.mjs';
import {retainedGet,decodeResponse,requestReceipt} from './provider.mjs';
import {rowsPage,summarize,comparison} from './domain.mjs';
import {prepareSensorThingsDataset,queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,
  inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
const find=(items,id,label)=>{const item=items.find(x=>x.id===id);if(!item)throw fault('SELECTION','Select an existing '+label+'.',404);return item;};
const errorInfo=e=>({code:e.code??'SENSORTHINGS_OPERATION_FAILED',message:e.message??'The original operation failed.',
  status:e.status??503,details:e.details??{},retryable:e.code==='SENSORTHINGS_REQUEST_INTERRUPTED'||(e.status??503)>=500});
const short=(label,op)=>label+'-'+identity({operationId:op.operationId,requestSha256:op.requestSha256}).slice(0,24);
export async function openSensorThingsWorkspace({directory,inboxDirectory=null,buyerWorkspaceDirectory=null,releaseRuntime={port:0},
  fetchImpl=fetch,environment=process.env,transport=null,onProgress=()=>{}}={}){
  const store=await openWorkspaceStore(directory,{schema:WORKSPACE_SCHEMA,initialState:{sources:[],catalogs:[],plans:[],reviews:[],comparisons:[]}}),
    publishers=nativePublishers(store),running=new Map(),controllers=new Map(),operations=new Map();
  let closing=false;
  const schema=()=>workspaceSchema(store.read().workspaceId);
  async function view(){
    const s=store.read();
    return {schema:'stellar-forge.sensorthings-view.v1',workspaceId:s.workspaceId,revision:s.revision,sourceContract:SOURCE_CONTRACT,
      sources:s.sources.map(({authorizationEnv,...v})=>({...v,authorization:authorizationEnv?'HOST_ENVIRONMENT':'NONE'})),
      catalogs:s.catalogs.map(({service,...v})=>({...v,service:{entries:service.entries,snapshot:service.snapshot}})),
      plans:s.plans.map(p=>({id:p.id,label:p.label,sourceId:p.sourceId,streams:p.streams.map(({selectedJson,...v})=>v),
        observationQuery:p.observationQuery,includeHistoricalLocations:p.includeHistoricalLocations,maxRequests:p.maxRequests,maxBytes:p.maxBytes})),
      captures:s.captures.map(c=>({id:c.id,planId:c.planId,state:c.state,createdAt:c.createdAt,updatedAt:c.updatedAt,
        requests:c.tasks.reduce((n,t)=>n+t.attempts.length,0),pages:c.pages.length,bytes:c.totalBytes,
        tasks:c.tasks.length,remaining:c.tasks.filter(t=>t.state!=='COMPLETE').length,editionIds:c.editionIds,
        issues:c.issues,pauseReason:c.pauseReason??null,running:running.has(c.id)})),
      editions:s.editionIds,selectedEditionId:s.selectedEditionId,reviews:s.reviews,datasets:s.datasets,releases:s.releases,
      receipts:s.receipts,comparisons:s.comparisons,exports:s.exports,
      operations:Object.values(s.operations).slice(-100).map(({payload,context,...v})=>v),running:[...running.keys()]};
  }
  async function catalogRows(id,{offset=0,limit=100}={}){
    const c=find(store.read().catalogs,id,'catalogue');integer(offset,'offset',0,1000000);integer(limit,'limit',1,500);
    const doc=sourceDocument(await store.object(c.receipt.sha256)),page=collection(doc,find(store.read().sources,c.sourceId,'source'),c.url);
    return {id,sourceId:c.sourceId,kind:c.kind,count:page.count,next:page.next,rows:page.rows.slice(offset,offset+limit).map((record,i)=>({
      pointer:'/value/'+(offset+i),id:valueCell(record['@iot.id']),name:valueCell(record.name),description:valueCell(record.description),
      unit:valueCell(record.unitOfMeasurement??record.unitOfMeasurements),observationType:valueCell(record.observationType??record.multiObservationDataTypes),
      selfLink:valueCell(record['@iot.selfLink']),entityJson:JSON.stringify(record),
      sourceRef:{sha256:c.receipt.sha256,bytes:c.receipt.bytes,jsonPointer:'/value/'+(offset+i),url:c.url,requestId:c.receipt.requestId}
    })),total:page.rows.length};
  }
  async function complete(op,result,change=()=>{}){
    const saved=await store.putObject(json(result));
    await store.mutate(s=>{
      const current=s.operations[op.operationId];if(current.state==='COMPLETE')return;
      change(s);
      current.state='COMPLETE';current.resultSha256=saved.sha256;current.completedAt=now();current.error=null;
    });return result;
  }
  async function reserve(request){
    fields(request,['action','payload','operationId','expectedRevision'],['action','payload','operationId','expectedRevision']);
    const {action,payload,operationId,expectedRevision}=request;
    if(!Object.hasOwn(ACTIONS,action))throw fault('ACTION','Choose an advertised SensorThings action.');
    fields(payload,ACTIONS[action]);if(!/^[A-Za-z0-9_-]{8,100}$/.test(operationId??''))throw fault('OPERATION_ID','Supply a stable operationId of 8–100 letters, digits, underscores or hyphens.');
    const requestSha256=identity({action,payload});let op;
    await store.mutate(s=>{
      const previous=s.operations[operationId];
      if(previous){if(previous.requestSha256!==requestSha256)throw fault('OPERATION_CONFLICT','The operationId belongs to a different exact request.',409);op=structuredClone(previous);op.reused=true;return;}
      if(!Number.isSafeInteger(expectedRevision)||s.revision!==expectedRevision)throw fault('REVISION_CHANGED','Review the latest workspace revision and keep the pending request.',409,{currentRevision:s.revision});
      op={operationId,requestSha256,action,payload:structuredClone(payload),expectedRevision,state:'RUNNING',createdAt:now(),error:null,context:{}};
      if(action==='catalog.capture')op.context.source=structuredClone(find(s.sources,payload.sourceId,'source'));
      if(action==='capture.start')op.context.plan=structuredClone(find(s.plans,payload.planId,'plan'));
      if(action==='dataset.prepare'||action==='release.prepare'){
        const editionId=action==='dataset.prepare'?payload.editionId:find(s.datasets,payload.datasetId,'dataset').editionId;
        const review=s.reviews.filter(r=>r.editionId===editionId).at(-1);
        if(review?.decision!=='accept')throw fault('REVIEW_REQUIRED','Accept this exact source edition and its retained issues before publication.',409);
        op.context.review=structuredClone(review);
      }
      if(action==='release.prepare')op.context.releaseRuntime=structuredClone(releaseRuntime);
      if(action.startsWith('buyer.')||action.startsWith('publisher.buyer.'))op.context.buyerWorkspaceDirectory=buyerWorkspaceDirectory??inboxDirectory;
      s.operations[operationId]=structuredClone(op);
    });return op;
  }
  function queue(c,input){
    const id=identity({phase:input.phase,kind:input.kind,url:input.url,streamKey:input.streamKey??null,collection:input.collection});
    let current=c.tasks.find(t=>t.id===id);
    if(current){if(input.parent&&!current.parents.some(p=>stable(p)===stable(input.parent)))current.parents.push(input.parent);return current;}
    if(c.tasks.length>=c.plan.maxRequests){c.issues.push({code:'TASK_LIMIT',message:'The selected request capacity cannot include another original relationship.',
      url:input.url,kind:input.kind,severity:'warning'});c.limitReached=true;return null;}
    current={...input,id,originUrl:input.originUrl??input.url,parents:input.parent?[input.parent]:[],state:'QUEUED',attempts:[],error:null};
    delete current.parent;c.tasks.push(current);return current;
  }
  async function adopt(captureId,taskId,response){
    const doc=decodeResponse(response);
    await store.mutate(s=>{
      const c=find(s.captures,captureId,'capture'),task=find(c.tasks,taskId,'source request');
      if(task.state==='COMPLETE')return;
      let page,records;
      if(task.collection){page=collection(doc,c.source,task.url);records=page.rows;}
      else{if(!plain(doc))throw fault('ENTITY_RESPONSE','The original entity response is not an object.',422);page={next:null,count:{state:'missing',type:'missing',value:''}};records=[doc];}
      if(task.kind==='Observations'&&records.some(r=>Array.isArray(r.dataArray)))throw fault('REPRESENTATION','The provider returned dataArray instead of the selected entity representation.',422);
      const savedPage={taskId:task.id,kind:task.kind,phase:task.phase,streamKey:task.streamKey??null,url:task.url,originUrl:task.originUrl,
        collection:task.collection,count:page.count,next:page.next,receipt:response.receipt,rows:records.length};
      c.pages.push(savedPage);c.totalBytes+=response.receipt.bytes;task.state='COMPLETE';task.receipt=response.receipt;task.error=null;
      if(task.phase==='stream-start'||task.phase==='stream-end'){
        const selected=c.plan.streams.find(x=>x.key===task.streamKey),actual=entityId(doc['@iot.id']);
        if(!selected||actual.key!==selected.id.key)throw fault('STREAM_IDENTITY','The returned stream differs from the original selected identity.',409);
        if(task.phase==='stream-end'){
          const before=c.streamMetadata.find(x=>x.key===task.streamKey);
          if(before&&stable(before.meaning)!==stable(streamMeaning(doc,selected.kind)))c.issues.push({code:'STREAM_METADATA_CHANGED',
            message:'Stream meaning differs between its beginning and ending reads; both original versions remain retained.',streamKey:task.streamKey,severity:'warning'});
        }else{
          c.streamMetadata.push({key:task.streamKey,meaning:streamMeaning(doc,selected.kind),receipt:response.receipt});
          const observations=doc['Observations@iot.navigationLink'];
          if(typeof observations!=='string')throw fault('OBSERVATION_LINK','The selected stream no longer advertises its observations.',422);
          const url=queryURL(sourceURL(observations,c.source,typeof doc['@iot.selfLink']==='string'?sourceURL(doc['@iot.selfLink'],c.source,task.url):task.url),c.plan.observationQuery,c.source);
          for(const relation of linksFromEntity(doc,task.kind,c.source,task.url,{history:c.plan.includeHistoricalLocations}))
            queue(c,{...relation,phase:'graph',parent:{taskId:task.id,jsonPointer:'',relationship:relation.name}});
          queue(c,{kind:'Observations',phase:'observations',url,streamKey:task.streamKey,collection:true,
            parent:{taskId:task.id,jsonPointer:'',relationship:'Observations'}});
        }
      }else{
        for(let i=0;i<records.length;i++)for(const relation of linksFromEntity(records[i],task.kind,c.source,task.url,{history:c.plan.includeHistoricalLocations}))
          queue(c,{...relation,phase:'graph',parent:{taskId:task.id,jsonPointer:task.collection?'/value/'+i:'',relationship:relation.name}});
      }
      if(page.next){
        const loop=c.tasks.some(t=>t.originUrl===task.originUrl&&t.url===page.next&&t.id!==task.id);
        if(page.next===task.url||loop){c.issues.push({code:'CONTINUATION_CYCLE',message:'A provider continuation revisits an already retained page.',url:page.next,severity:'warning'});c.limitReached=true;}
        else queue(c,{kind:task.kind,phase:task.phase,url:page.next,originUrl:task.originUrl,streamKey:task.streamKey??null,collection:true,
          parent:{taskId:task.id,jsonPointer:'/@iot.nextLink',relationship:'nextLink'}});
      }
      c.updatedAt=now();
    });
  }
  async function retainedClosure(c){
    const files=new Map(),put=async(bytes,role,mediaType='application/json')=>{const info=await store.putObject(bytes);files.set(info.sha256,{...info,role,mediaType});};
    const addReceipt=async r=>{if(!r)return;files.set(r.sha256,{sha256:r.sha256,bytes:r.bytes,role:r.complete?'provider-response':'incomplete-provider-response',mediaType:r.headers?.['content-type']??'application/octet-stream'});
      for(const suffix of ['request','response']){
        const p=join(store.root,'receipts','sensorthings-'+r.requestId+'-'+suffix+'.json');
        await put(await readOwned(p,1024*1024),'original-'+suffix+'-receipt');
      }};
    for(const id of [...new Set(c.plan.streams.map(x=>x.catalogId))]){
      const catalogue=find(store.read().catalogs,id,'original catalogue');
      await addReceipt(catalogue.service.receipt);await addReceipt(catalogue.receipt);
      await put(json(catalogue),'selected-catalogue');
    }
    for(const task of c.tasks)for(const attempt of task.attempts){
      const rp=join(store.root,'receipts','sensorthings-'+attempt.requestId+'-request.json');
      try{await put(await readOwned(rp,1024*1024),'original-request-receipt');}catch(e){if(e.code!=='ENOENT')throw e;}
      try{const found=await requestReceipt(store,attempt.requestId);await addReceipt(found.receipt);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    await put(json(c.source),'source-configuration');await put(json(c.plan),'reviewed-source-plan');
    return [...files.values()];
  }
  async function seal(captureId,{allowPartial=false,reason=''}={}){
    const c=structuredClone(find(store.read().captures,captureId,'capture'));
    if(running.has(c.id)&&c.state==='RUNNING')throw fault('CAPTURE_RUNNING','Pause this original capture before sealing a partial source edition.',409);
    const traversalCompleted=c.state==='COMPLETE'&&!c.limitReached&&c.tasks.every(t=>t.state==='COMPLETE');
    if(!traversalCompleted&&(!allowPartial||!reason.trim()))throw fault('PARTIAL_REVIEW','A partial source edition requires an explicit reason and allowPartial=true.',409);
    const sourceFiles=await retainedClosure(c),scope={traversalCompleted,selectedQuery:c.plan.observationQuery,
      status:traversalCompleted?'SELECTED_QUERY_TRAVERSED':'PARTIAL_SOURCE',snapshot:'not_established',
      partialReason:traversalCompleted?null:reason,pages:c.pages.length,receivedBytes:c.totalBytes,
      requests:c.tasks.reduce((n,t)=>n+t.attempts.length,0),remaining:c.tasks.filter(t=>t.state!=='COMPLETE').map(t=>({id:t.id,url:t.url,kind:t.kind,state:t.state,error:t.error})),
      captureStartedAt:c.createdAt,captureLastResponseAt:c.pages.at(-1)?.receipt.completedAt??null};
    const body={schema:EDITION_SCHEMA,captureId:c.id,createdAt:c.createdAt,source:c.source,plan:c.plan,pages:c.pages,
      streamMetadata:c.streamMetadata,issues:[{code:'PROVIDER_SNAPSHOT_NOT_ESTABLISHED',severity:'notice',
        message:'These are original sequential HTTP observations and metadata reads, not an atomic provider snapshot.'},
        ...c.issues,...(!traversalCompleted?[{code:'PARTIAL_SOURCE',severity:'warning',message:reason}]:[])],scope,sourceFiles};
    const id=identity(body),edition={...body,id};await store.saveEdition(edition);
    const summary=await summarize(store,edition),summaryObject=await store.putObject(json(summary));
    await store.mutate(s=>{const current=find(s.captures,c.id,'capture');
      if(!s.editionIds.includes(id))s.editionIds.push(id);
      if(!current.editionIds.includes(id))current.editionIds.push(id);
      current.summarySha256=summaryObject.sha256;s.selectedEditionId=id;});
    return {editionId:id,summary,scope};
  }
  async function captureLoop(captureId,budget){
    let consumed=0;
    try{
      while(!closing&&consumed<budget){
        let c=find(store.read().captures,captureId,'capture');if(c.state!=='RUNNING')break;
        if(c.limitReached){
          await store.mutate(s=>{const x=find(s.captures,captureId,'capture');x.state='PAUSED_LIMIT';x.pauseReason='Selected source capacity reached; the original partial source remains retained.';});break;
        }
        let task=c.tasks.find(t=>t.state==='RUNNING')??c.tasks.find(t=>t.state==='QUEUED');
        if(!task){
          if(c.tasks.some(t=>t.state==='FAILED')){await store.mutate(s=>{find(s.captures,captureId,'capture').state='FAILED';});break;}
          if(!c.endQueued){await store.mutate(s=>{const x=find(s.captures,captureId,'capture');x.endQueued=true;
            for(const stream of x.plan.streams)queue(x,{kind:stream.kind,phase:'stream-end',url:stream.url,streamKey:stream.key,collection:false});});continue;}
          await store.mutate(s=>{const x=find(s.captures,captureId,'capture');x.state='COMPLETE';x.completedAt=now();});break;
        }
        if(task.state==='QUEUED'&&(c.totalBytes>=c.plan.maxBytes||c.tasks.reduce((n,t)=>n+t.attempts.length,0)>=c.plan.maxRequests)){
          await store.mutate(s=>{const x=find(s.captures,captureId,'capture');x.state='PAUSED_LIMIT';x.pauseReason='Selected source capacity reached; the original partial source remains retained.';});break;
        }
        if(task.retryNotBefore&&Date.now()<Date.parse(task.retryNotBefore)){
          await store.mutate(s=>{const x=find(s.captures,captureId,'capture');x.state='PAUSED_RETRY_AFTER';x.pauseReason=task.retryNotBefore;});break;
        }
        if(task.state==='RUNNING'){
          const original=task.attempts.at(-1);
          try{const received=await requestReceipt(store,original.requestId);await adopt(captureId,task.id,received);continue;}
          catch(e){
            const info=e.code==='ENOENT'?{code:'SENSORTHINGS_REQUEST_INTERRUPTED',message:'The previous process did not retain a complete response for this original request.',status:409,retryable:true}:errorInfo(e);
            await store.mutate(s=>{const x=find(s.captures,captureId,'capture'),t=find(x.tasks,task.id,'request');t.state='FAILED';t.error=info;x.state='FAILED';});
            break;
          }
        }
        const requestId=identity({captureId,taskId:task.id,attempt:task.attempts.length+1}),attempt={requestId,startedAt:now()};
        await store.mutate(s=>{const x=find(s.captures,captureId,'capture'),t=find(x.tasks,task.id,'request');t.state='RUNNING';t.attempts.push(attempt);});
        consumed++;
        try{
          const response=await retainedGet(store,c.source,{requestId,url:task.url,cause:{captureId,taskId:task.id},
            signal:controllers.get(captureId)?.signal,fetchImpl,environment,transport});
          await adopt(captureId,task.id,response);onProgress({captureId,requestId,status:response.receipt.status,bytes:response.receipt.bytes});
        }catch(e){
          const info=errorInfo(e);
          await store.mutate(s=>{const x=find(s.captures,captureId,'capture'),t=find(x.tasks,task.id,'request');
            t.state='FAILED';t.error=info;t.retryNotBefore=info.details?.retryNotBefore??null;
            if(x.state==='RUNNING')x.state=controllers.get(captureId)?.signal.aborted?'PAUSED':'FAILED';
            x.issues.push({code:info.code,message:info.message,requestId,severity:'warning'});});break;
        }
      }
      await store.mutate(s=>{const c=find(s.captures,captureId,'capture');if(c.state==='RUNNING'){if(c.endQueued&&!c.limitReached&&c.tasks.every(t=>t.state==='COMPLETE')){c.state='COMPLETE';c.completedAt=now();}else{c.state='PAUSED_BUDGET';c.pauseReason='This invocation used its selected request budget.';}}});
      const c=find(store.read().captures,captureId,'capture');if(c.state==='COMPLETE')await seal(captureId);
    }finally{controllers.delete(captureId);}
  }
  function launch(captureId,budget){
    if(running.has(captureId))return;
    const controller=new AbortController();controllers.set(captureId,controller);
    const job=captureLoop(captureId,budget).catch(async e=>{await store.mutate(s=>{const c=find(s.captures,captureId,'capture');c.state='FAILED';c.issues.push({code:e.code??'SENSORTHINGS_CAPTURE',message:e.message,severity:'warning'});}).catch(()=>{});})
      .finally(()=>running.delete(captureId));running.set(captureId,job);
  }

  async function edition(id){
    if(!store.read().editionIds.includes(id))throw fault('EDITION','Select an original retained edition.',404);
    const value=await store.edition(id),{id:declared,...body}=value;
    if(declared!==id||identity(body)!==id)throw fault('EDITION_CHANGED','The retained edition differs from its original identity.',409);
    return value;
  }
  async function assertReview(editionId,review){
    const selected=store.read().reviews.filter(r=>r.editionId===editionId).at(-1);
    if(selected?.decision!=='accept'||identity(selected)!==identity(review))throw fault('REVIEW_CHANGED','The retained source review changed during this operation.',409);
  }
  async function compareOperation(op){
    const p=op.payload,left=await edition(p.leftId),right=await edition(p.rightId),id=short('comparison',op),
      directory=join(store.root,'exports',id);
    await privateDirectory(directory,{create:true});
    const result=await comparison(store,left,right),path=join(directory,'changes.jsonl'),temp=path+'.'+randomUUID()+'.tmp',
      file=await open(temp,'wx',0o600),digest=createHash('sha256');let bytes=0;
    try{for await(const row of result.changes){const data=json(row);bytes+=data.length;if(bytes>256*1024*1024)throw fault('COMPARISON_CAPACITY','The complete change file exceeds the selected native export capacity.',413);
        // JSON Lines are compact and retain one source-linked change per line.
        const line=Buffer.from(JSON.stringify(row)+'\n');await file.writeFile(line);digest.update(line);}
      await file.sync();
    }catch(e){await file.close();await unlink(temp).catch(()=>{});throw e;}
    await file.close();
    // bytes above is only a conservative limit; inspect the actual compact file.
    const {hashPrivate}=await import('../postgres/publisher/files.mjs'),info=await hashPrivate(temp,256*1024*1024);
    try{await link(temp,path);await syncDir(directory);}catch(e){if(e.code!=='EEXIST')throw e;
      const prior=await hashPrivate(path,256*1024*1024);if(prior.hash!==info.hash||prior.bytes!==info.bytes)throw fault('COMPARISON_CHANGED','The original comparison output differs.',409);}
    finally{await unlink(temp).catch(()=>{});}
    const report={schema:'stellar-forge.sensorthings-comparison.v1',id,createdAt:op.createdAt,...result.report,
      file:{filename:'changes.jsonl',relativePath:'exports/'+id+'/changes.jsonl',bytes:info.bytes,sha256:info.hash,type:'application/x-ndjson'}};
    await store.immutable(join(directory,'comparison.json'),json(report));
    return complete(op,report,s=>{if(!s.comparisons.some(c=>c.id===id))s.comparisons.push(report);});
  }
  async function execute(op){
    const p=op.payload,s=store.read();
    if(op.action==='source.add'){
      const config=sourceConfig(p),id='source-'+identity(config).slice(0,24),record={...config,id,createdAt:op.createdAt};
      return complete(op,s.sources.find(x=>x.id===id)??record,state=>{if(!state.sources.some(x=>x.id===id))state.sources.push(record);});
    }
    if(op.action==='catalog.capture'){
      const source=op.context.source,previous=p.previousCatalogId?find(s.catalogs,p.previousCatalogId,'previous catalogue'):null,
        kind=p.kind??'Datastreams';
      if(!['Datastreams','MultiDatastreams'].includes(kind))throw fault('CATALOGUE_KIND','Choose Datastreams or MultiDatastreams.');
      let service,url;
      if(previous){
        if(previous.sourceId!==source.id||previous.kind!==kind||p.query!==undefined||!previous.next)throw fault('CATALOGUE_CONTINUATION','Continue the exact saved nextLink without changing the source, collection or query.',409);
        service=previous.service;url=previous.next;
      }else{
        const root=await retainedGet(store,source,{requestId:identity({operationId:op.operationId,role:'service-root'}),url:source.serviceUrl,
          cause:{operationId:op.operationId,role:'service-root'},fetchImpl,environment,transport});
        service=serviceCatalog(decodeResponse(root),source,root.receipt);
        if(!service.entries[kind])throw fault('COLLECTION_NOT_ADVERTISED','This original service does not advertise '+kind+'.',422);
        url=queryURL(service.entries[kind],p.query??{},source,{catalog:true});
      }
      const received=await retainedGet(store,source,{requestId:identity({operationId:op.operationId,role:'catalogue-page'}),url,
        cause:{operationId:op.operationId,role:'catalogue-page'},fetchImpl,environment,transport});
      const page=collection(decodeResponse(received),source,url),body={schema:'stellar-forge.sensorthings-catalogue.v1',
        sourceId:source.id,kind,url,service,receipt:received.receipt,query:p.query??previous?.query??{},previousCatalogId:previous?.id??null,
        rows:page.rows.length,count:page.count,next:page.next,continuationLiteral:page.continuationLiteral,createdAt:op.createdAt,
        scope:'Original catalogue page; available nextLink is not silently discarded.'},
        id=identity(body),record={...body,id};
      return complete(op,record,state=>{if(!state.catalogs.some(x=>x.id===id))state.catalogs.push(record);});
    }
    if(op.action==='plan.create'){
      const source=find(s.sources,p.sourceId,'source');text(p.label,'a plan label');
      if(!Array.isArray(p.streams)||!p.streams.length||p.streams.length>64)throw fault('STREAM_SELECTION','Choose 1–64 original stream catalogue records.');
      const streams=[];
      for(const item of p.streams){
        fields(item,['catalogId','pointer'],['catalogId','pointer']);
        if(!/^\/value\/(?:0|[1-9]\d*)$/.test(item.pointer??''))throw fault('STREAM_POINTER','Choose an actual catalogue member pointer.');
        const catalog=find(s.catalogs,item.catalogId,'catalogue');
        if(catalog.sourceId!==source.id)throw fault('STREAM_SOURCE','Every selected stream must belong to this original source.',409);
        const doc=sourceDocument(await store.object(catalog.receipt.sha256)),record=pointer(doc,item.pointer);
        const selected=selectedStream(record,catalog.kind,source,{sha256:catalog.receipt.sha256,bytes:catalog.receipt.bytes,
          jsonPointer:item.pointer,url:catalog.url,requestId:catalog.receipt.requestId});
        streams.push({...selected,catalogId:catalog.id});
      }
      if(new Set(streams.map(x=>x.key)).size!==streams.length)throw fault('STREAM_DUPLICATE','Each selected original stream must occur once.');
      const observationQuery={expandFeatureOfInterest:true,...(p.observationQuery??{})};queryURL(streams[0].observationsUrl,observationQuery,source);
      if(p.includeHistoricalLocations!==undefined&&typeof p.includeHistoricalLocations!=='boolean')throw fault('HISTORY','Choose whether to retain historical location relationships.');
      const body={sourceId:source.id,label:p.label,streams,observationQuery:structuredClone(observationQuery),
        includeHistoricalLocations:p.includeHistoricalLocations??true,
        maxRequests:integer(p.maxRequests??2000,'whole capture request limit',4,20000),
        maxBytes:integer(p.maxBytes??128*1024*1024,'whole capture byte limit',source.maxPageBytes,1024*1024*1024),
        sourceContract:SOURCE_CONTRACT},id=identity(body),record={...body,id,createdAt:op.createdAt};
      return complete(op,record,state=>{if(!state.plans.some(x=>x.id===id))state.plans.push(record);});
    }
    if(op.action==='capture.start'){
      const plan=op.context.plan,budget=integer(p.budget??25,'request budget',1,1000),id=identity({operationId:op.operationId,planId:plan.id}).slice(0,24);
      let capture=s.captures.find(c=>c.id===id);
      if(!capture){
        if(s.captures.some(c=>c.state==='RUNNING'||running.has(c.id)))throw fault('CAPTURE_ACTIVE','Resume or pause the original active capture before starting another.',409);
        capture={id,planId:plan.id,plan:structuredClone(plan),source:structuredClone(find(s.sources,plan.sourceId,'source')),
          createdAt:op.createdAt,state:'RUNNING',tasks:[],pages:[],streamMetadata:[],issues:[],totalBytes:0,editionIds:[],endQueued:false,limitReached:false};
        for(const stream of plan.streams)queue(capture,{kind:stream.kind,phase:'stream-start',url:stream.url,streamKey:stream.key,collection:false});
      }
      const result=await complete(op,{captureId:id,planId:plan.id,state:capture.state},state=>{if(!state.captures.some(c=>c.id===id))state.captures.push(capture);});
      if(find(store.read().captures,id,'capture').state==='RUNNING')launch(id,budget);return result;
    }
    if(op.action==='capture.resume'){
      const c=find(s.captures,p.captureId,'capture'),budget=integer(p.budget??25,'request budget',1,1000);
      if(running.has(c.id))return complete(op,{captureId:c.id,state:'RUNNING',reused:true});
      if(c.state==='COMPLETE')return complete(op,{captureId:c.id,state:'COMPLETE',editionIds:c.editionIds,reused:true});
      if(s.captures.some(x=>x.id!==c.id&&(x.state==='RUNNING'||running.has(x.id))))throw fault('CAPTURE_ACTIVE','Another original capture is active.',409);
      if(p.retryFailed!==undefined&&typeof p.retryFailed!=='boolean')throw fault('RETRY','retryFailed must be explicit boolean.');
      await store.mutate(state=>{
        const x=find(state.captures,c.id,'capture');
        if(x.limitReached)throw fault('CAPTURE_LIMIT','The immutable source selection reached its declared capacity. Seal and review the partial source, or prepare a new explicit scope.',409);
        if(x.tasks.some(t=>t.state==='FAILED')&&!p.retryFailed)throw fault('RETRY_REQUIRED','Inspect the retained request error and explicitly choose retryFailed to make another original GET attempt.',409);
        for(const t of x.tasks)if(t.state==='FAILED'&&p.retryFailed){t.state='QUEUED';t.error=null;}
        x.state='RUNNING';x.pauseReason=null;
      });
      const result=await complete(op,{captureId:c.id,state:'RUNNING'});launch(c.id,budget);return result;
    }
    if(op.action==='capture.pause'){
      const c=find(s.captures,p.captureId,'capture');controllers.get(c.id)?.abort();
      await store.mutate(state=>{const x=find(state.captures,c.id,'capture');if(x.state!=='COMPLETE')x.state='PAUSED';});
      await running.get(c.id);
      return complete(op,{captureId:c.id,state:find(store.read().captures,c.id,'capture').state});
    }
    if(op.action==='capture.seal'){
      if(typeof p.allowPartial!=='boolean'&&p.allowPartial!==undefined)throw fault('PARTIAL','allowPartial must be boolean.');
      const result=await seal(p.captureId,{allowPartial:p.allowPartial??false,reason:p.reason??''});return complete(op,result);
    }
    if(op.action==='edition.review'){
      const selected=await edition(p.editionId);
      if(!['accept','reject','follow_up'].includes(p.decision))throw fault('REVIEW','Choose accept, reject or follow_up.');
      text(p.actor,'the responsible reviewer',240);if(typeof p.note!=='string'||!p.note.trim()||p.note.length>12000)throw fault('REVIEW_NOTE','Retain the reviewer’s substantive source interpretation.');
      if(!Array.isArray(p.acknowledgeIssues)||p.acknowledgeIssues.some(x=>typeof x!=='string')||new Set(p.acknowledgeIssues).size!==p.acknowledgeIssues.length)
        throw fault('REVIEW_ISSUES','Supply the explicit acknowledged source issue codes.');
      const observed=await summarize(store,selected);
      const required=[...new Set([...selected.issues.filter(x=>x.severity!=='notice').map(x=>x.code),...Object.keys(observed.rowIssueCounts),
        ...(observed.duplicateOccurrences?['DUPLICATE_OBSERVATION_IDS']:[]),...(observed.changedDuplicates?['CONFLICTING_DUPLICATE_OBSERVATIONS']:[]),...(observed.unkeyed?['UNKEYED_OBSERVATIONS']:[])])];
      if(p.decision==='accept'&&required.some(x=>!p.acknowledgeIssues.includes(x)))throw fault('REVIEW_ISSUES','Acknowledge every retained source warning before accepting this edition.',409,{required});
      const review={id:short('review',op),editionId:selected.id,decision:p.decision,actor:p.actor,note:p.note,
        acknowledgeIssues:p.acknowledgeIssues,createdAt:op.createdAt,scope:selected.scope,summarySha256:identity(observed),requiredIssueCodes:required,
        meaning:'An operator acceptance for this source edition; it is not provider quality approval.'};
      return complete(op,review,state=>{if(!state.reviews.some(x=>x.id===review.id))state.reviews.push(review);});
    }
    if(op.action==='edition.compare')return compareOperation(op);
    if(op.action==='dataset.prepare'){
      const selected=await edition(p.editionId);await assertReview(selected.id,op.context.review);
      const id=short('dataset',op),record=await prepareSensorThingsDataset(store,{edition:selected,review:op.context.review,name:p.name??selected.plan.label,table:p.table??'observations',id});
      await assertReview(selected.id,op.context.review);
      return complete(op,record,state=>{if(!state.datasets.some(x=>x.id===id))state.datasets.push(record);});
    }
    if(op.action==='dataset.query'){
      const dataset=find(s.datasets,p.datasetId,'dataset');return complete(op,await queryNativeDataset(store,dataset,p.query??''));
    }
    if(op.action==='release.prepare'){
      const dataset=find(s.datasets,p.datasetId,'dataset');await assertReview(dataset.editionId,op.context.review);
      const id=short('sensorthings',op),record=await prepareNativeRelease(store,{dataset,origin:p.origin,path:p.path??'/observations',payment:p.payment,id,
        runtime:op.context.releaseRuntime,publishers});
      await assertReview(dataset.editionId,op.context.review);
      return complete(op,record,state=>{if(!state.releases.some(x=>x.id===id))state.releases.push(record);});
    }
    if(op.action.startsWith('release.')){
      const release=find(s.releases,p.releaseId,'release'),action=op.action.slice(8);
      const result=await controlNativeRelease(store,release,action,{expectedGeneration:p.expectedGeneration},publishers);
      return complete(op,result);
    }
    if(op.action==='buyer.inspect')return complete(op,await inspectBuyer(op.context.buyerWorkspaceDirectory,p.intentIds));
    if(op.action==='buyer.receive'){
      const id=short('buyer',op),record=await receiveBuyer(store,op.context.buyerWorkspaceDirectory,p.intentIds,id);
      return complete(op,record,state=>{if(!state.receipts.some(x=>x.id===id))state.receipts.push(record);});
    }
    if(op.action.startsWith('publisher.buyer.')){
      const dataset=find(s.datasets,p.datasetId,'dataset'),publisher=await publishers.get(dataset),{datasetId,...input}=p;
      if(op.action==='publisher.buyer.session'){
        if(!op.context.buyerWorkspaceDirectory)throw fault('BUYER_NOT_BOUND','The host must bind the original SF88 buyer workspace before opening a customer acquisition.',409);
        input.workspaceDirectory=op.context.buyerWorkspaceDirectory;
      }
      const result=await publisher.act(op.action,input);return complete(op,result);
    }
    throw fault('ACTION','Unknown SensorThings action.');
  }
  async function action(request){
    if(closing)throw fault('CLOSING','The original workspace is closing.',503);
    let op;
    try{
      op=await reserve(request);
      if(op.state==='COMPLETE')return {operationId:op.operationId,reused:true,result:JSON.parse((await store.object(op.resultSha256)).toString('utf8')),view:await view()};
      if(operations.has(op.operationId))return {operationId:op.operationId,state:'RUNNING',reused:true,view:await view()};
      if(op.state==='FAILED')throw Object.assign(new Error(op.error.message),op.error);
      const pending=execute(op);operations.set(op.operationId,pending);
      try{return {operationId:op.operationId,reused:Boolean(op.reused),result:await pending,view:await view()};}
      finally{operations.delete(op.operationId);}
    }catch(e){
      const info=errorInfo(e);
      if(op)await store.mutate(s=>{const current=s.operations[op.operationId];if(current?.state!=='COMPLETE'){current.state='FAILED';current.error=info;current.failedAt=now();}}).catch(()=>{});
      throw Object.assign(new Error(info.message),info,{operationId:op?.operationId,currentRevision:store.read().revision});
    }
  }
  // Holding the existing kernel lease establishes that no earlier workspace
  // writer is alive. Preserve every pending request for explicit reconciliation.
  await store.mutate(s=>{for(const c of s.captures)if(c.state==='RUNNING'){c.state='INTERRUPTED';c.pauseReason='Reopened after the original process ended; resume this same capture.';}});
  async function close(){
    if(closing)return;closing=true;for(const controller of controllers.values())controller.abort();
    await Promise.allSettled([...running.values(),...operations.values()]);await publishers.close();await store.close();
  }
  return {store,directory:store.root,schema,view,action,catalogRows,edition,
    capture:id=>structuredClone(find(store.read().captures,id,'capture')),
    rows:async(id,options)=>rowsPage(store,await edition(id),options),
    summary:async id=>summarize(store,await edition(id)),
    release:async id=>inspectNativeRelease(store,find(store.read().releases,id,'release'),publishers),
    publisher:async datasetId=>(await publishers.get(find(store.read().datasets,datasetId,'dataset'))).state(),
    publisherFile:async(datasetId,kind,id)=>(await publishers.get(find(store.read().datasets,datasetId,'dataset'))).readExport(kind,id),
    buyerFile:async(id,name)=>readBuyerOutput(store,find(store.read().receipts,id,'customer receipt'),name),
    waitCapture:async id=>{await running.get(id);return structuredClone(find(store.read().captures,id,'capture'));},
    async sourceFile(sha256){if(!/^[a-f0-9]{64}$/.test(sha256??''))throw fault('SOURCE_FILE','Choose a retained source object.');return store.object(sha256);},
    close};
}
