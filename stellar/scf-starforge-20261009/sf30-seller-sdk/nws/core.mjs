// MIT. Site operations compose the retained workspace and original merchant engines.
import {openWorkspaceStore,jsonBytes,stable} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA,workspaceSchema,ACTIONS,SOURCE_CONTRACT,TABLES} from './schema.mjs';
import {normaliseSite,makeQuery,pointPlan,observationUrl,decodeSource,fetchNwsResponse,normaliseBundle,importedResponse,urlKey,text,fault,hashBytes} from './provider.mjs';
import {editionRows,summarizeEdition,compareEditions,exportEdition} from './domain.mjs';
import {prepareWeatherDataset,queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,
  controlNativeRelease,inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
const select=(list,id,label)=>{const v=list.find(x=>x.id===id);if(!v)throw fault('NWS_SELECTION','Choose a saved '+label+'.',404);return v;};
const key=op=>hashBytes(Buffer.from(op)).slice(0,24),now=()=>new Date().toISOString();
function errorInfo(error){
  if(['ENOSPC','EDQUOT'].includes(error.code))return {code:'NWS_STORAGE_FULL',message:'The workspace storage is full. Resume the saved operation after space is available.',status:507,retryable:true};
  if(/^(NWS_|STELLAR_|DATASET_|SOCRATA_|SELLER_|RELEASE_)/.test(error.code??'')||error.code==='INVALID_DATASET_QUERY')
    return {code:error.code,message:error.message,status:error.status??400,retryable:error.retryable??(error.status===429||error.status>=500),retryAt:error.retryAt??null};
  if(error.name==='AbortError'||error.name==='TimeoutError')return {code:'NWS_SOURCE_TIMEOUT',message:'The source request timed out. Its preceding completed responses remain saved.',status:504,retryable:true};
  if(error instanceof TypeError||error instanceof RangeError)return {code:'NWS_INPUT',message:error.message,status:400,retryable:false};
  return {code:'NWS_OPERATION_FAILED',message:'This operation could not complete. Open its saved source and error details, then resume the same selection.',status:503,retryable:true};
}
export async function openNwsWorkspace({directory,inboxDirectory,releaseRuntime={port:0},
  userAgent='StellarForgeNWS/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)',fetchImpl=fetch}={}){
  text(userAgent,'an identifying User-Agent',512);
  const store=await openWorkspaceStore(directory,{schema:WORKSPACE_SCHEMA,initialState:{sites:[],responseCache:{},sourcePolls:{}}}),
    running=new Map(),operations=new Map(),controllers=new Map(),publishers=nativePublishers(store);
  let closing=false,requestTail=Promise.resolve(),lastRequestAt=0;
  async function retainObject(bytes){
    if(bytes.length>256*1024*1024)throw fault('NWS_OUTPUT_CAPACITY','This complete file exceeds the workspace’s 256 MiB object capacity. Select a smaller table or interval, or download the retained source responses individually.',413);
    return store.putObject(bytes);
  }
  if(store.read().captures.some(c=>['RUNNING','QUEUED'].includes(c.state)))
    await store.mutate(s=>{for(const c of s.captures)if(['RUNNING','QUEUED'].includes(c.state))c.state='PAUSED';});
  const releaseCapability=()=>({mode:releaseRuntime.facilitator?'NATIVE_X402':'CHALLENGE_ONLY',
    facilitatorConfigured:Boolean(releaseRuntime.facilitator),port:releaseRuntime.port??0});
  const schema=()=>({...workspaceSchema({workspaceId:store.read().workspaceId,inboxConfigured:Boolean(inboxDirectory),userAgent}),releaseRuntime:releaseCapability()});
  async function editions({offset=0,limit=100,siteId}={}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)
      throw fault('NWS_EDITION_RANGE','Choose a nonnegative offset and one to 500 editions.');
    const all=[];for(const id of store.read().editionIds.slice().reverse()){
      const e=await store.edition(id);if(!siteId||e.site.id===siteId)all.push(e);
    }
    return {editions:all.slice(offset,offset+limit).map(({pages,...e})=>e),total:all.length,offset,limit};
  }
  async function view(){
    const s=store.read(),recent=(await editions({limit:100})).editions,releases=[];
    for(const release of s.releases){
      try{const publisher=await publishers.state(release);releases.push({...release,publisher,selection:publisher.releases.state});}
      catch(error){releases.push({...release,publisherError:errorInfo(error)});}
    }
    return {schema:'stellar-forge.nws-workspace-view.v1',workspaceId:s.workspaceId,revision:s.revision,
      sites:s.sites,captures:s.captures.slice().reverse().map(({pages,...c})=>({...c,pageCount:pages.length,pageReceipts:pages})),
      editions:recent,editionCount:s.editionIds.length,selectedEditionId:s.selectedEditionId,
      selectedEdition:s.selectedEditionId?await store.edition(s.selectedEditionId):null,
      annotations:s.annotations,datasets:s.datasets,releases,receipts:s.receipts,exports:s.exports,
      operations:Object.values(s.operations).slice(-100).reverse().map(({payload,context,materializedResult,...o})=>o),
      capabilities:{inboxConfigured:Boolean(inboxDirectory),releaseRuntime:releaseCapability()}};
  }
  function coverage(c){
    const out={};
    for(const t of c.tasks)out[t.kind]={state:t.state,pages:t.pages.length,records:t.records??0,termination:t.termination??null,
      unusedContinuation:t.unusedNext??null,error:t.error??null};
    if(c.query.products.includes('observations')&&!out.observations)out.observations={state:c.stationRequired?'AWAITING_STATION':'PENDING',pages:0,records:0};
    return out;
  }
  function captureComplete(c){
    const required=['point','stations',...c.query.products.flatMap(product=>product==='alerts'?['active-alerts','alerts']:[product])];
    return required.every(kind=>c.tasks.some(t=>t.kind===kind&&['COMPLETE','UNAVAILABLE'].includes(t.state)))&&
      c.tasks.every(t=>['COMPLETE','UNAVAILABLE'].includes(t.state))&&!c.stationRequired;
  }
  async function sealCapture(id){
    const c=select(store.read().captures,id,'capture');if(!c.pages.length)return null;
    const identity={schema:'stellar-forge.nws-edition.v1',workspaceId:store.read().workspaceId,captureId:c.id,
      site:c.site,query:c.query,mapping:c.mapping,station:c.station,coverage:coverage(c),pages:c.pages,
      sourcePackageSha256:c.sourcePackageSha256??null,
      complete:captureComplete(c)};
    const editionId=hashBytes(Buffer.from(stable(identity)));let edition;
    try{
      edition=await store.edition(editionId);
      if(edition.id!==editionId||stable(Object.fromEntries(Object.keys(identity).map(k=>[k,edition[k]])))!==stable(identity))
        throw fault('NWS_EDITION_CHANGED','The retained edition differs from its original source identity.',409);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    if(!edition){
      edition={...identity,id:editionId,label:c.label,createdAt:c.completedAt??c.updatedAt??c.createdAt,sourceContract:SOURCE_CONTRACT,
        sourceMetadata:c.sourceMetadata??null,pageCount:c.pages.length,sourceSha256:hashBytes(Buffer.from(stable(c.pages.map(p=>({url:p.url,sha256:p.sha256,bytes:p.bytes}))))),
        byteCount:c.byteCount};
      edition.summary=await summarizeEdition(store,edition);await store.saveEdition(edition);
    }
    await store.mutate(s=>{
      const current=select(s.captures,id,'capture');current.editionId=editionId;
      if(!s.editionIds.includes(editionId))s.editionIds.push(editionId);s.selectedEditionId=editionId;
      if(c.importedAnnotations?.length&&!current.annotationsImported){
        for(const a of c.importedAnnotations){
          if(typeof a.subject!=='string'||typeof a.note!=='string'||!['open','reviewed','follow_up'].includes(a.status))continue;
          const aid='import-'+hashBytes(Buffer.from(stable({editionId,a}))).slice(0,24);
          if(!s.annotations.some(x=>x.id===aid))s.annotations.push({id:aid,editionId,subject:a.subject.slice(0,300),note:a.note.slice(0,12000),
            status:a.status,updatedAt:a.updatedAt??c.createdAt,history:a.history??[],importedFrom:{sourceEditionId:a.editionId??null,sourceAnnotationId:a.id??null}});
        }
        current.annotationsImported=true;
      }
    });
    return edition;
  }
  async function queueOriginalRequest(task,c,controller){
    const prior=requestTail;
    let release;requestTail=new Promise(done=>{release=done;});
    try{
      await prior;
      if(closing||controller.signal.aborted)throw new DOMException('Capture paused','AbortError');
      const wait=Math.max(0,lastRequestAt+200-Date.now());if(wait)await new Promise(done=>setTimeout(done,wait));
      if(closing||controller.signal.aborted)throw new DOMException('Capture paused','AbortError');
      const cache=store.read().responseCache[urlKey(task.url)],cached=cache?{...cache,body:await store.object(cache.sha256)}:null;
      if(['alerts','active-alerts'].includes(task.kind)&&task.pages.length===0){
        const poll=store.read().sourcePolls[urlKey(task.url)],remaining=Number(poll??0)+30000-Date.now();
        if(remaining>0)throw fault('NWS_POLL_INTERVAL','This alert collection can be refreshed after its30-second poll interval.',429,{retryAt:new Date(Date.now()+remaining).toISOString(),retryable:true});
        await store.mutate(s=>{s.sourcePolls[urlKey(task.url)]=Date.now();});
      }
      lastRequestAt=Date.now();
      return await fetchNwsResponse(task,{query:c.query,userAgent,fetchImpl,signal:controller.signal,cached});
    }finally{release();}
  }
  async function chooseStation(id,requested){
    let selected;
    await store.mutate(s=>{
      const c=select(s.captures,id,'capture'),catalog=c.stationCatalog??[];
      if(c.tasks.some(t=>t.kind==='observations')){selected=c.station;return;}
      if(!c.query.products.includes('observations'))return;
      const stations=c.tasks.find(t=>t.kind==='stations');
      if(!stations||!['COMPLETE','UNAVAILABLE'].includes(stations.state))return;
      if(!catalog.length){
        c.tasks.push({id:'observations',kind:'observations',url:null,state:'UNAVAILABLE',pages:[],records:0,termination:stations.state==='UNAVAILABLE'?'The current point response exposes no observation station resource.':'The current provider catalog contains no observation stations.'});
        c.stationRequired=false;return;
      }
      const stationId=requested??c.query.stationId??'';
      const item=stationId?catalog.find(x=>x.id===stationId):catalog[0];
      if(!item){c.stationRequired=true;return;}
      selected={...item,selection:stationId?'OPERATOR_SELECTED':'PROVIDER_FIRST',selectedAt:now()};
      c.station=selected;c.stationRequired=false;
      c.tasks.push({id:'observations',kind:'observations',url:observationUrl(c.query,item.id),stationId:item.id,
        state:'PENDING',pages:[],records:0,termination:null});
    });
    return selected;
  }
  async function adoptResponse(id,taskId,page,decoded){
    await store.mutate(s=>{
      const c=select(s.captures,id,'capture'),t=select(c.tasks,taskId,'source task');
      if(t.pages.some(p=>p.url===page.url)){return;}
      if(c.pages.length>=2000||c.byteCount+page.bytes>256*1024*1024)
        throw fault('NWS_CAPTURE_CAPACITY','The capture reached its retained source capacity. Review its completed pages before selecting a narrower interval.',413);
      if(decoded.nextUrl&&c.pages.some(p=>urlKey(p.url)===urlKey(decoded.nextUrl)))
        throw fault('NWS_SOURCE_PAGING','The provider continuation returned to a captured resource.',502);
      const receipt={...page,kind:t.kind,stationId:t.stationId??null,records:decoded.records,
        providerGeneratedAt:decoded.data.properties?.generatedAt??decoded.data.properties?.updateTime??decoded.data.updated??null,
        providerNext:decoded.nextUrl??decoded.unusedNext??null,termination:decoded.termination};
      c.pages.push(receipt);c.byteCount+=page.bytes;c.updatedAt=now();
      t.pages.push({url:page.url,sha256:page.sha256,records:decoded.records});t.records=(t.records??0)+decoded.records;
      t.url=decoded.nextUrl;t.unusedNext=decoded.unusedNext;t.termination=decoded.termination;
      t.state=decoded.nextUrl?'PENDING':'COMPLETE';t.error=null;t.retryAt=null;
      if(page.transport==='native-https')s.responseCache[urlKey(page.url)]={sha256:page.sha256,bytes:page.bytes,etag:page.etag,lastModified:page.lastModified,
        sourceObservedAt:page.sourceObservedAt,finishedAt:page.finishedAt};
      if(t.kind==='point'){
        const planned=pointPlan(decoded.data,c.query);c.mapping=planned.mapping;
        for(const task of planned.tasks)if(!c.tasks.some(x=>x.kind===task.kind))c.tasks.push({id:task.kind,...task,records:0});
      }
      if(t.kind==='stations'){
        for(const feature of decoded.features){
          const p=feature.properties,sid=p.stationIdentifier??String(feature.id??p['@id']??'').split('/').at(-1);
          if(!/^[A-Za-z0-9]{3,12}$/.test(sid??''))continue;
          if(!c.stationCatalog.some(x=>x.id===sid))c.stationCatalog.push({id:sid,name:p.name??sid,timeZone:p.timeZone??null,
            geometry:feature.geometry??null,sourcePageSha256:page.sha256});
        }
      }
    });
    const c=select(store.read().captures,id,'capture'),task=select(c.tasks,taskId,'source task');
    if(task.kind==='stations'&&task.state==='COMPLETE')await chooseStation(id);
  }
  async function captureLoop(id){
    const controller=new AbortController();controllers.set(id,controller);
    try{
      await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state='RUNNING';c.pauseRequested=false;c.error=null;});
      let imported=null;
      const initial=select(store.read().captures,id,'capture');
      if(initial.sourcePackageSha256)imported=normaliseBundle(JSON.parse((await store.object(initial.sourcePackageSha256)).toString('utf8')));
      while(!closing&&!controller.signal.aborted){
        // Reconcile this dependency after a restart between station adoption and task creation.
        await chooseStation(id);
        const c=select(store.read().captures,id,'capture'),task=c.tasks.find(t=>t.state==='PENDING');
        if(!task)break;
        try{
          const checkpoint=await store.response(c.id,task.url);
          let source;
          if(checkpoint&&checkpoint.parseState==='ACCEPTED'){
            source={body:await store.object(checkpoint.sha256),wire:await store.object(checkpoint.responseSha256??checkpoint.sha256),receipt:checkpoint,error:null};
          }else source=imported?importedResponse(imported,task):await queueOriginalRequest(task,c,controller);
          if(closing||controller.signal.aborted)break;
          await retainObject(source.body);await retainObject(source.wire);
          await store.saveResponse(c.id,task.url,source.receipt);
          if(source.error)throw Object.assign(new Error(source.error.message),source.error,{sourceReceipt:source.receipt});
          const decoded=decodeSource(source.body,task.kind,c.query,{...source.receipt,stationId:task.stationId}),
            receipt={...source.receipt,parseState:'ACCEPTED'};
          await store.saveResponse(c.id,task.url,receipt);
          await adoptResponse(c.id,task.id,receipt,decoded);
        }catch(error){
          if(controller.signal.aborted||closing)break;
          const info=errorInfo(error);
          await store.mutate(s=>{
            const current=select(s.captures,id,'capture'),t=select(current.tasks,task.id,'source task');
            t.state='FAILED';t.error=info;t.retryAt=info.retryAt??null;t.attempts=(t.attempts??0)+1;
            current.error=info;current.updatedAt=now();
            if(error.sourceReceipt)current.failedResponses.push(error.sourceReceipt);
          });
        }
      }
      await store.mutate(s=>{
        const c=select(s.captures,id,'capture'),complete=captureComplete(c);
        c.state=complete?'COMPLETE':c.stationRequired?'AWAITING_STATION':closing||controller.signal.aborted?'PAUSED':'PARTIAL';
        c.updatedAt=now();if(complete)c.completedAt=c.updatedAt;
        const retry=c.tasks.map(t=>t.retryAt).filter(Boolean).sort();c.retryAt=retry[0]??null;
      });
      await sealCapture(id);
    }catch(error){
      const info=errorInfo(error);
      await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state='PAUSED';c.error=info;}).catch(()=>{});
    }finally{controllers.delete(id);}
  }
  function launch(id){
    if(running.has(id)||closing)return;
    const task=captureLoop(id);running.set(id,task);void task.finally(()=>running.delete(id)).catch(()=>{});
  }
  async function reserve(request){
    if(!request||typeof request!=='object'||Array.isArray(request)||
      Object.keys(request).some(k=>!['action','payload','operationId','expectedRevision'].includes(k)))
      throw fault('NWS_ACTION','Use action, payload, operationId and expectedRevision.');
    const {action,payload,operationId,expectedRevision}=request;
    if(!Object.hasOwn(ACTIONS,action)||!payload||typeof payload!=='object'||Array.isArray(payload)||
      Object.keys(payload).some(k=>!ACTIONS[action].includes(k)))throw fault('NWS_ACTION','Choose an advertised action and its named fields.');
    if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw fault('NWS_OPERATION_ID','Supply a stable operationId.');
    const requestSha256=hashBytes(Buffer.from(stable({action,payload}))),prior=store.read().operations[operationId];
    if(prior){
      if(prior.requestSha256!==requestSha256)throw fault('NWS_OPERATION_CONFLICT','This operationId belongs to a different action or payload.',409);
      return {...prior,reused:true};
    }
    let imported=null,packageObject=null;
    if(action==='capture.import'){
      imported=normaliseBundle(payload.bundle);packageObject=await retainObject(jsonBytes(payload.bundle));
    }
    let operation;
    await store.mutate(s=>{
      const current=s.operations[operationId];
      if(current){if(current.requestSha256!==requestSha256)throw fault('NWS_OPERATION_CONFLICT','This operationId belongs to a different action or payload.',409);operation={...current,reused:true};return;}
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==s.revision)
        throw fault('NWS_REVISION_CHANGED','The workspace changed. Review the latest saved view and keep your pending form.',409,{currentRevision:s.revision});
      operation={operationId,action,payload:structuredClone(payload),requestSha256,expectedRevision,
        state:'RUNNING',createdAt:now(),attempts:1,error:null};
      if(['capture.start','capture.import'].includes(action)){
        const site=select(s.sites,payload.siteId,'site');
        if(!site.active)throw fault('NWS_SITE_ARCHIVED','Reopen this site before collecting a new edition.',409);
        if(action==='capture.import'){
          if(site.latitude!==imported.site.latitude||site.longitude!==imported.site.longitude)throw fault('NWS_IMPORT_SITE','The source package belongs to different coordinates.',409);
          operation.payload={siteId:payload.siteId,label:payload.label??site.label};
          operation.context={site:structuredClone(site),query:imported.query,sourcePackageSha256:packageObject.sha256,
            sourceMetadata:imported.sourceMetadata,importedAnnotations:imported.annotations};
        }else{
          const active=s.captures.find(c=>c.site.id===site.id&&['RUNNING','QUEUED'].includes(c.state));
          if(active)throw fault('NWS_CAPTURE_ACTIVE','This site already has a running capture. Open that saved capture.',409);
          operation.context={site:structuredClone(site),query:makeQuery(site,payload,operation.createdAt)};
        }
      }
      if(action==='export.create')operation.context={annotations:structuredClone(s.annotations.filter(a=>a.editionId===payload.editionId))};
      if(action==='release.prepare')operation.context={releaseRuntime:structuredClone(releaseRuntime)};
      if(action.startsWith('buyer.'))operation.context={inboxDirectory:inboxDirectory??null};
      s.operations[operationId]=operation;
    });
    return operation;
  }
  async function commitLocal(op,fn){
    let result;await store.mutate(s=>{
      const saved=s.operations[op.operationId];
      if(Object.hasOwn(saved,'materializedResult')){result=structuredClone(saved.materializedResult);return;}
      result=fn(s);saved.materializedResult=structuredClone(result);
    });return result;
  }
  async function execute(op){
    const p=op.payload,id=key(op.operationId);let result,launchId=null;
    switch(op.action){
      case 'site.save':{
        const input=normaliseSite(p);
        result=await commitLocal(op,s=>{
          const prior=p.siteId?select(s.sites,p.siteId,'site'):null,siteId=prior?.id??'site-'+id;
          const next={id:siteId,...input,createdAt:prior?.createdAt??op.createdAt,updatedAt:op.createdAt,
            history:prior?[...(prior.history??[]),{...Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='history')),operationId:op.operationId}]:[]};
          s.sites=s.sites.filter(x=>x.id!==siteId);s.sites.push(next);return next;
        });break;
      }
      case 'site.archive':result=await commitLocal(op,s=>{const site=select(s.sites,p.siteId,'site');site.active=false;site.updatedAt=op.createdAt;return {siteId:site.id,active:false};});break;
      case 'capture.start':
      case 'capture.import':{
        result=await commitLocal(op,s=>{
          if(!s.captures.some(c=>c.id===id))s.captures.push({
            id,label:text(p.label??op.context.site.label,'a capture label'),site:op.context.site,query:op.context.query,
            createdAt:op.createdAt,state:'QUEUED',tasks:[{id:'point',kind:'point',url:op.context.query.pointUrl,state:'PENDING',pages:[],records:0}],
            pages:[],byteCount:0,failedResponses:[],mapping:null,station:null,stationCatalog:[],stationRequired:false,
            sourcePackageSha256:op.context.sourcePackageSha256??null,sourceMetadata:op.context.sourceMetadata??null,
            importedAnnotations:op.context.importedAnnotations??[],editionId:null,error:null
          });
          return {captureId:id,state:select(s.captures,id,'capture').state,source:op.action==='capture.import'?'RETAINED_SOURCE_PACKAGE':'NWS_HTTPS'};
        });launchId=id;break;
      }
      case 'capture.resume':{
        result=await commitLocal(op,s=>{
          const c=select(s.captures,p.captureId,'capture');
          if(c.state==='COMPLETE')return {captureId:c.id,state:c.state,editionId:c.editionId};
          for(const t of c.tasks)if(t.state==='FAILED'&&(!t.retryAt||Date.parse(t.retryAt)<=Date.now())){t.state='PENDING';t.error=null;t.retryAt=null;}
          c.pauseRequested=false;return {captureId:c.id,state:'QUEUED'};
        });if(result.state!=='COMPLETE')launchId=p.captureId;break;
      }
      case 'capture.pause':{
        const c=select(store.read().captures,p.captureId,'capture');controllers.get(c.id)?.abort();
        result=await commitLocal(op,s=>{const current=select(s.captures,c.id,'capture');current.pauseRequested=true;return {captureId:c.id,state:'PAUSING'};});break;
      }
      case 'capture.station':{
        const c=select(store.read().captures,p.captureId,'capture'),stationId=text(p.stationId,'an observation station',12).toUpperCase();
        if(!c.stationCatalog.some(s=>s.id===stationId))throw fault('NWS_STATION','Choose a station from this capture’s original source catalog.');
        if(c.tasks.some(t=>t.kind==='observations')&&c.station?.id!==stationId)throw fault('NWS_STATION_ALREADY_SELECTED','This capture already retains another station. Save that station on the site and collect a new edition.',409);
        result={captureId:c.id,station:await chooseStation(c.id,stationId)};launchId=c.id;break;
      }
      case 'edition.select':{
        const edition=await store.edition(p.editionId);
        result=await commitLocal(op,s=>{if(!s.editionIds.includes(edition.id))throw fault('NWS_EDITION_ID','Select a saved edition.',404);s.selectedEditionId=edition.id;return {editionId:edition.id};});break;
      }
      case 'edition.compare':{
        const full=await compareEditions(store,await store.edition(p.leftId),await store.edition(p.rightId),p.table),saved=await retainObject(jsonBytes(full)),
          item={id:'comparison-'+id,kind:'comparison',editionId:p.rightId,table:p.table,format:'json',name:'nws-comparison-'+id+'.json',
            type:'application/json; charset=utf-8',...saved,createdAt:op.createdAt,downloadUrl:'/api/exports/comparison-'+id};
        await commitLocal(op,s=>{if(!s.exports.some(e=>e.id===item.id))s.exports.push(item);return item;});
        result={...full,added:full.added.slice(0,200),removed:full.removed.slice(0,200),changed:full.changed.slice(0,200),export:item};break;
      }
      case 'annotation.save':{
        await store.edition(p.editionId);const subject=text(p.subject,'a review subject',300),note=text(p.note,'a review note',12000,true);
        if(!['open','reviewed','follow_up'].includes(p.status))throw fault('NWS_ANNOTATION','Choose open, reviewed or follow_up.');
        result=await commitLocal(op,s=>{
          const prior=s.annotations.find(a=>a.editionId===p.editionId&&a.subject===subject),
            annotation={id:prior?.id??id,editionId:p.editionId,subject,note,status:p.status,updatedAt:op.createdAt,
              history:prior?[...(prior.history??[]),{note:prior.note,status:prior.status,updatedAt:prior.updatedAt}]:[]};
          s.annotations=s.annotations.filter(a=>a.id!==annotation.id);s.annotations.push(annotation);return annotation;
        });break;
      }
      case 'dataset.prepare':{
        result=await prepareWeatherDataset(store,{edition:await store.edition(p.editionId),table:p.table,name:p.name,id:'dataset-'+id});
        await commitLocal(op,s=>{if(!s.datasets.some(d=>d.id===result.id))s.datasets.push(result);return result;});break;
      }
      case 'dataset.query':result=await queryNativeDataset(store,select(store.read().datasets,p.datasetId,'dataset'),p.query);break;
      case 'release.prepare':{
        result=await prepareNativeRelease(store,{dataset:select(store.read().datasets,p.datasetId,'dataset'),origin:p.origin,path:p.path??'/weather',
          payment:p.payment,id:'nws-'+id,runtime:op.context?.releaseRuntime??releaseRuntime,publishers});
        await commitLocal(op,s=>{if(!s.releases.some(r=>r.id===result.id))s.releases.push(result);return result;});break;
      }
      case 'release.inspect':result=await inspectNativeRelease(store,select(store.read().releases,p.releaseId,'release'),publishers);break;
      case 'release.activate':
      case 'release.start':
      case 'release.stop':
      case 'release.rollback':result=await controlNativeRelease(store,select(store.read().releases,p.releaseId,'release'),op.action.split('.')[1],p,publishers);break;
      case 'buyer.inspect':result=await inspectBuyer(op.context?.inboxDirectory??inboxDirectory,p.intentIds);break;
      case 'buyer.receive':{
        result=await receiveBuyer(store,op.context?.inboxDirectory??inboxDirectory,p.intentIds,'buyer-'+id);
        await commitLocal(op,s=>{if(!s.receipts.some(r=>r.id===result.id))s.receipts.push(result);return result;});break;
      }
      case 'export.create':{
        const edition=await store.edition(p.editionId),annotations=op.context?.annotations??[],output=await exportEdition(store,edition,annotations,p.table??'forecast',p.format),
          saved=await retainObject(output.bytes);
        result={id:'export-'+id,kind:'edition',editionId:edition.id,table:p.table??'forecast',format:p.format,
          name:'nws-'+edition.site.id+'-'+edition.id.slice(0,12)+'.'+output.extension,type:output.type,...saved,createdAt:op.createdAt,
          note:output.note??null,downloadUrl:'/api/exports/export-'+id};
        await commitLocal(op,s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);return result;});break;
      }
    }
    const saved=await retainObject(jsonBytes(result));
    await store.mutate(s=>{const current=s.operations[op.operationId];current.state='COMPLETE';current.resultSha256=saved.sha256;current.completedAt=now();current.error=null;});
    if(launchId&&!closing)launch(launchId);return result;
  }
  async function action(request){
    let op;
    try{
      op=await reserve(request);
      if(op.state==='COMPLETE')return {operationId:op.operationId,reused:true,result:JSON.parse((await store.object(op.resultSha256)).toString('utf8')),view:await view()};
      if(op.state==='FAILED'&&!op.error?.retryable)throw Object.assign(new Error(op.error.message),op.error);
      if(operations.has(op.operationId))return {operationId:op.operationId,state:'RUNNING',reused:true,view:await view()};
      if(op.state==='FAILED')await store.mutate(s=>{const current=s.operations[op.operationId];current.state='RUNNING';current.attempts++;current.error=null;});
      const task=execute(op);operations.set(op.operationId,task);
      try{return {operationId:op.operationId,reused:Boolean(op.reused),result:await task,view:await view()};}
      finally{operations.delete(op.operationId);}
    }catch(error){
      const info=errorInfo(error);
      if(op)await store.mutate(s=>{const current=s.operations[op.operationId];if(current?.state!=='COMPLETE'){current.state='FAILED';current.error=info;current.failedAt=now();}}).catch(()=>{});
      throw Object.assign(new Error(info.message),info,{operationId:op?.operationId,currentRevision:store.read().revision});
    }
  }
  for(const c of store.read().captures)if(c.pages.length&&!c.editionId)await sealCapture(c.id);
  return {schema,view,action,store,editions,
    edition:async id=>{if(!store.read().editionIds.includes(id))throw fault('NWS_EDITION_ID','Choose a saved edition.',404);return store.edition(id);},
    rows:async(id,options)=>editionRows(store,await store.edition(id),options),
    async raw(id,pageIndex,{wire=false}={}){
      const e=await store.edition(id);
      if(!Number.isSafeInteger(pageIndex)||pageIndex<0||pageIndex>=e.pages.length)throw fault('NWS_SOURCE_PAGE','Choose a retained source page.');
      const receipt=e.pages[pageIndex],sha=wire?receipt.responseSha256??receipt.sha256:receipt.sha256;
      return {bytes:await store.object(sha),receipt,type:'application/geo+json; charset=utf-8'};
    },
    async exported(id){const item=select(store.read().exports,id,'export');return {item,bytes:await store.object(item.sha256)};},
    async received(id,name){return readBuyerOutput(store,select(store.read().receipts,id,'customer receipt'),name);},
    async waitForCaptures(){await Promise.allSettled([...running.values()]);return view();},
    async close(){
      if(closing)return;closing=true;for(const c of controllers.values())c.abort();
      await Promise.allSettled([...running.values(),...operations.values()]);
      try{await publishers.close();}finally{await store.close();}
    }
  };
}
