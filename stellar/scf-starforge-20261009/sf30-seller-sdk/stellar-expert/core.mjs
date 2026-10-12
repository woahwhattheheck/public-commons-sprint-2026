// MIT. Retained asset investigations over the original merchant and buyer engines.
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openWorkspaceStore,jsonBytes,stable} from './store.mjs';
import {canonicalQuery,normalizeAsset,sourceUrl,fetchSourcePage,decodeSourcePage,hashBytes,fault} from './provider.mjs';
import {workspaceSchema,ACTIONS,SOURCE_CONTRACT,COLUMNS,SOURCE_COLUMNS} from './schema.mjs';
import {editionRows,summarizeEdition,compareEditions,exportEdition} from './domain.mjs';
import {prepareNativeDataset,queryNativeDataset,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,nativePublishers,inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
const cleanText=(v,name,max=200,allowEmpty=false)=>{
  if(typeof v!=='string'||(!allowEmpty&&!v.trim())||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))
    throw fault('STELLAR_WORKSPACE_INPUT','Invalid '+name+'.');return v;
};
const select=(list,id,label)=>{const value=list.find(x=>x.id===id);if(!value)throw fault('STELLAR_SELECTION','Select a retained '+label+'.',404);return value;};
function errorInfo(error) {
  if(['ENOSPC','EDQUOT'].includes(error.code))return {code:'STELLAR_STORAGE_FULL',message:'The private workspace storage is full. Retained source and operations remain selected; free storage and resume the same operation.',status:507,retryable:true};
  if(/^(STELLAR_|DATASET_|SOCRATA_|SELLER_|RELEASE_)/.test(error.code??'')||error.code==='INVALID_DATASET_QUERY')
    return {code:error.code,message:error.message,status:error.status??(/CONFLICT|CHANGED|EXPIRED/.test(error.code)?409:400),retryAt:error.retryAt??null,retryable:error.status===429||error.status>=500};
  if(error instanceof TypeError||error instanceof RangeError)return {code:'STELLAR_WORKSPACE_INPUT',message:error.message,status:400,retryable:false};
  return {code:'STELLAR_WORKSPACE_OPERATION',message:'The selected original operation could not finish. Its source and identity are retained; inspect runtime and storage before resuming.',status:503,retryable:true};
}
export async function openStellarExpertWorkspace({directory,inboxDirectory,releaseRuntime={port:0},fetchImpl=fetch}={}) {
  const store=await openWorkspaceStore(directory),running=new Map(),operations=new Map(),controllers=new Map();
  const publishers=nativePublishers(store);
  let closing=false;
  // A browser disconnect never stops a capture. After process restart an explicit
  // resume uses this same saved query, byte chain and next link.
  if(store.read().captures.some(c=>['RUNNING','QUEUED'].includes(c.state)))
    await store.mutate(s=>{for(const c of s.captures)if(['RUNNING','QUEUED'].includes(c.state))c.state='PAUSED';});
  const releaseCapability=()=>({mode:releaseRuntime.facilitator?'NATIVE_X402':'CHALLENGE_ONLY',port:releaseRuntime.port??0,facilitatorConfigured:Boolean(releaseRuntime.facilitator),allowLocalFacilitator:releaseRuntime.allowLocalFacilitator===true});
  const schema=()=>({...workspaceSchema({inboxConfigured:Boolean(inboxDirectory)}),workspaceId:store.read().workspaceId,releaseRuntime:releaseCapability()});
  async function listEditions({offset=0,limit=100}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)
      throw fault('STELLAR_EDITION_RANGE','Use a nonnegative edition offset and one to 500 editions per page.');
    const ids=store.read().editionIds.slice().reverse(),editions=[];
    for(const id of ids.slice(offset,offset+limit)){
      const edition=await store.edition(id);
      editions.push(Object.fromEntries(Object.entries(edition).filter(([key])=>key!=='pages')));
    }
    return {editions,total:ids.length,offset,limit};
  }
  async function view() {
    const s=store.read(),editions=[];
    for(const id of s.editionIds.slice(-100).reverse()){
      const e=await store.edition(id);editions.push(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='pages')));
    }
    let selectedEdition=null;
    if(s.selectedEditionId){
      const e=await store.edition(s.selectedEditionId),rows=await editionRows(store,e,{limit:100});
      selectedEdition={...e,columns:rows.columns,previewRows:rows.rows};
    }
    const releases=[];
    for(const release of s.releases){
      try{const publisher=await publishers.state(release);releases.push({...release,publisher,selection:publisher.releases.state});}
      catch(error){releases.push({...release,publisherError:errorInfo(error)});}
    }
    return {schema:'stellar-forge.stellar-expert-workspace-view.v1',workspaceId:s.workspaceId,revision:s.revision,
      watchlist:s.watchlist,operations:Object.values(s.operations).slice(-100).reverse().map(({payload,...o})=>o),
      captures:s.captures.slice().reverse().map(c=>({...c,pages:c.pages.length,records:c.recordCount,bytes:c.byteCount,pageReceipts:c.pages})),
      editions,editionCount:s.editionIds.length,selectedEditionId:s.selectedEditionId,selectedEdition,
      datasets:s.datasets,releases,receipts:s.receipts,exports:s.exports,annotations:s.annotations,
      capabilities:{inboxConfigured:Boolean(inboxDirectory),releaseRuntime:releaseCapability()}};
  }
  async function sealCapture(id) {
    const c=select(store.read().captures,id,'capture');
    if(!c.pages.length)return null;
    const identity={schema:'stellar-forge.stellar-expert-edition.v1',query:c.query,pages:c.pages,
      complete:c.nextUrl===null&&c.state==='COMPLETE'};
    const editionId=hashBytes(Buffer.from(stable(identity)));
    const edition={...identity,id:editionId,captureId:c.id,watchId:c.watchId,label:c.label,
      createdAt:c.pages.at(-1).finishedAt,pageCount:c.pages.length,recordCount:c.recordCount,
      sourceSha256:hashBytes(Buffer.from(stable(c.pages.map(p=>({url:p.url,sha256:p.sha256,bytes:p.bytes}))))),
      sourceContract:SOURCE_CONTRACT,columns:[...COLUMNS[c.query.kind],...SOURCE_COLUMNS]};
    edition.summary=await summarizeEdition(store,edition);
    await store.saveEdition(edition);
    await store.mutate(s=>{
      const current=select(s.captures,id,'capture');current.editionId=editionId;
      if(!s.editionIds.includes(editionId))s.editionIds.push(editionId);
      s.selectedEditionId=editionId;
    });
    return edition;
  }
  async function captureLoop(id,budget) {
    const controller=new AbortController();controllers.set(id,controller);
    try{
      await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state='RUNNING';c.error=null;c.retryAt=null;});
      for(let n=0;n<budget;n++){
        if(closing)break;
        const c=select(store.read().captures,id,'capture');
        if(c.nextUrl===null){await store.mutate(s=>{select(s.captures,id,'capture').state='COMPLETE';});break;}
        if(c.pages.some(p=>p.url===c.nextUrl))throw fault('STELLAR_SOURCE_PAGING','The provider repeated an already captured page URL.',502);
        const checkpoint=await store.response(c.id,c.nextUrl);
        const retained=checkpoint?.status>=200&&checkpoint?.status<300?checkpoint:
          c.failedResponses.findLast(r=>r.url===c.nextUrl&&r.status>=200&&r.status<300);
        let page=retained?decodeSourcePage(await store.object(retained.sha256),{...retained},{query:c.query,originalUrl:c.originalUrl}):null;
        // A fully saved successful response is adopted before another provider call.
        // If it still fails decoding, retain its history and allow the provider to recover.
        if(!page||page.error)page=await fetchSourcePage(c.nextUrl,{query:c.query,originalUrl:c.originalUrl,fetchImpl,signal:controller.signal});
        await store.putObject(page.body);
        await store.saveResponse(c.id,c.nextUrl,page.receipt);
        if(page.error){
          await store.mutate(s=>{
            const current=select(s.captures,id,'capture');
            current.failedResponses.push(page.receipt);current.error=page.error;current.retryAt=page.error.retryAt??null;
            current.state=page.error.retryAt?'RATE_LIMITED':'FAILED';
          });break;
        }
        if(c.byteCount+page.body.length>128*1024*1024||c.recordCount+page.records.length>250000)
          throw fault('STELLAR_CAPTURE_LIMIT','This capture has reached its retained byte or row capacity. Select a narrower source query.',413);
        if(page.nextUrl&&[...c.pages.map(p=>p.url),c.nextUrl].includes(page.nextUrl))
          throw fault('STELLAR_SOURCE_PAGING','The provider continuation links form a cycle.',502);
        await store.mutate(s=>{
          const current=select(s.captures,id,'capture');
          current.pages.push({...page.receipt,records:page.records.length});
          current.recordCount+=page.records.length;current.byteCount+=page.body.length;current.nextUrl=page.nextUrl;
          current.state=page.nextUrl===null?'COMPLETE':'RUNNING';current.updatedAt=new Date().toISOString();
        });
        if(page.nextUrl===null)break;
        // At most two requests/second from this capture; provider Retry-After wins.
        await new Promise(done=>setTimeout(done,500));
      }
      await store.mutate(s=>{const c=select(s.captures,id,'capture');if(c.state==='RUNNING')c.state='PAUSED';});
      await sealCapture(id);
    }catch(e){
      const error=closing?{code:'STELLAR_CAPTURE_PAUSED',message:'The original workspace process stopped. Resume this capture from its saved continuation.',status:503,retryable:true}:errorInfo(e);
      try{await store.mutate(s=>{const c=select(s.captures,id,'capture');c.state=closing?'PAUSED':'FAILED';c.error=error;});await sealCapture(id);}
      catch{ /* The last fsynced source cursor remains authoritative during disk loss. */ }
    }finally{controllers.delete(id);}
  }
  function launchCapture(id,budget) {
    if(running.has(id))return;
    const task=captureLoop(id,budget);running.set(id,task);
    void task.finally(()=>running.delete(id)).catch(()=>{});
  }
  async function reserve(request) {
    if(!request||typeof request!=='object'||Array.isArray(request)||
      Object.keys(request).some(key=>!['action','payload','operationId','expectedRevision'].includes(key)))
      throw fault('STELLAR_ACTION_INPUT','Use action, payload, operationId and expectedRevision.');
    const {action,payload,operationId,expectedRevision}=request;
    if(!Object.hasOwn(ACTIONS,action)||!payload||typeof payload!=='object'||Array.isArray(payload)||
      Object.keys(payload).some(k=>!ACTIONS[action].includes(k)))
      throw fault('STELLAR_ACTION_INPUT','Choose an advertised action and its named fields.');
    if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw fault('STELLAR_OPERATION_ID','Supply a stable operationId.');
    const requestSha256=hashBytes(Buffer.from(stable({action,payload})));
    let operation;
    await store.mutate(s=>{
      const prior=s.operations[operationId];
      if(prior){
        if(prior.requestSha256!==requestSha256)throw fault('STELLAR_OPERATION_ID_CONFLICT','This operationId belongs to another action or payload.',409);
        operation={...prior,reused:true};return;
      }
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==s.revision)
        throw fault('STELLAR_REVISION_CHANGED','The workspace changed. Refresh its current view; your pending form can be reviewed and resubmitted.',409,{currentRevision:s.revision});
      operation={operationId,action,payload:structuredClone(payload),requestSha256,expectedRevision,
        state:'RUNNING',createdAt:new Date().toISOString(),attempts:1,resultSha256:null,error:null};
      if(action==='export.create')operation.context={annotations:structuredClone(s.annotations.filter(a=>a.editionId===payload.editionId))};
      if(action==='release.prepare')operation.context={releaseRuntime:structuredClone(releaseRuntime)};
      if(action.startsWith('buyer.'))operation.context={inboxDirectory:inboxDirectory??null};
      s.operations[operationId]=operation;
    });
    return operation;
  }
  async function execute(op) {
    const p=op.payload,id=hashBytes(Buffer.from(op.operationId)).slice(0,24);let result;
    switch(op.action){
      case 'watch.add': {
        const network=p.network??'public';if(!['public','testnet'].includes(network))throw fault('STELLAR_SOURCE_INPUT','Choose public or testnet.');
        const asset=normalizeAsset(p.asset),label=cleanText(p.label??asset,'label'),note=cleanText(p.note??'','note',4000,true);
        await store.mutate(s=>{
          const existing=s.watchlist.find(w=>w.network===network&&w.asset===asset);
          if(existing){result=existing;return;}
          result={id,network,asset,label,note,createdAt:op.createdAt};s.watchlist.push(result);
        });break;
      }
      case 'watch.remove':
        if(typeof p.watchId!=='string'||!/^[a-f0-9]{24}$/.test(p.watchId))throw fault('STELLAR_SELECTION','Choose a retained watch.');
        await store.mutate(s=>{s.watchlist=s.watchlist.filter(w=>w.id!==p.watchId);result={removed:p.watchId};});break;
      case 'capture.start': {
        const query=canonicalQuery(p.query),originalUrl=sourceUrl(query),budget=p.pageBudget??20;
        if(!Number.isInteger(budget)||budget<1||budget>1000)throw fault('STELLAR_CAPTURE_BUDGET','Choose one to1000 pages for this capture pass.');
        if(p.watchId)select(store.read().watchlist,p.watchId,'watch');
        const label=cleanText(p.label??query.kind,'capture label');
        await store.mutate(s=>{
          if(!s.captures.some(c=>c.id===id))s.captures.push({id,label,query,watchId:p.watchId??null,originalUrl,nextUrl:originalUrl,
            state:'QUEUED',createdAt:op.createdAt,pages:[],recordCount:0,byteCount:0,failedResponses:[],retryAt:null,error:null,editionId:null});
        });
        result={captureId:id,state:select(store.read().captures,id,'capture').state,pageBudget:budget};
        // Queue scheduling happens after its accepted operation result is committed.
        result.launchCapture={id,budget};break;
      }
      case 'capture.resume': {
        const c=select(store.read().captures,p.captureId,'capture'),budget=p.pageBudget??20;
        if(!Number.isInteger(budget)||budget<1||budget>1000)throw fault('STELLAR_CAPTURE_BUDGET','Choose one to1000 pages for this capture pass.');
        if(c.retryAt&&Date.parse(c.retryAt)>Date.now())throw fault('STELLAR_SOURCE_RATE_LIMIT','The original provider Retry-After interval is still active.',429,{retryAt:c.retryAt});
        if(c.state==='COMPLETE'){result={captureId:c.id,state:c.state,editionId:c.editionId};break;}
        if(running.has(c.id)){result={captureId:c.id,state:'RUNNING'};break;}
        result={captureId:c.id,state:'QUEUED',pageBudget:budget,launchCapture:{id:c.id,budget}};break;
      }
      case 'edition.select': {
        const edition=await store.edition(p.editionId);
        if(!store.read().editionIds.includes(edition.id))throw fault('STELLAR_EDITION_ID','This edition is not selected in this workspace.',404);
        await store.mutate(s=>{s.selectedEditionId=edition.id;});result={editionId:edition.id};break;
      }
      case 'edition.compare': {
        const full=await compareEditions(store,await store.edition(p.leftId),await store.edition(p.rightId));
        const content=jsonBytes(full),saved=await store.putObject(content),exportId='comparison-'+id;
        const item={id:exportId,editionId:p.rightId,format:'json',name:'stellar-comparison-'+id+'.json',
          type:'application/json; charset=utf-8',sha256:saved.sha256,bytes:saved.bytes,createdAt:op.createdAt,downloadUrl:'/api/exports/'+exportId};
        await store.mutate(s=>{if(!s.exports.some(e=>e.id===exportId))s.exports.push(item);});
        result={...full,added:full.added.slice(0,200),removed:full.removed.slice(0,200),changed:full.changed.slice(0,200),export:item};break;
      }
      case 'annotation.save': {
        await store.edition(p.editionId);
        const subject=cleanText(p.subject,'review subject',300),note=cleanText(p.note,'review note',12000,true);
        if(!['open','reviewed','follow_up'].includes(p.status))throw fault('STELLAR_ANNOTATION_STATUS','Choose open, reviewed or follow_up.');
        await store.mutate(s=>{
          const previous=s.annotations.find(a=>a.editionId===p.editionId&&a.subject===subject);
          if(previous?.updatedAt===op.createdAt&&previous.note===note&&previous.status===p.status){result=previous;return;}
          result={id:previous?.id??id,editionId:p.editionId,subject,note,status:p.status,updatedAt:op.createdAt,
            history:previous?[...(previous.history??[]),{note:previous.note,status:previous.status,updatedAt:previous.updatedAt}]:[]};
          s.annotations=s.annotations.filter(a=>a.id!==result.id);s.annotations.push(result);
        });break;
      }
      case 'dataset.prepare': {
        result=await prepareNativeDataset(store,{edition:await store.edition(p.editionId),name:p.name,id:'dataset-'+id});
        await store.mutate(s=>{if(!s.datasets.some(d=>d.id===result.id))s.datasets.push(result);});break;
      }
      case 'dataset.query':result=await queryNativeDataset(store,select(store.read().datasets,p.datasetId,'dataset'),p.query);break;
      case 'release.prepare': {
        result=await prepareNativeRelease(store,{dataset:select(store.read().datasets,p.datasetId,'dataset'),
          origin:p.origin,path:p.path??'/stellar-data',payment:p.payment,id:'stellar-'+id,runtime:op.context?.releaseRuntime??releaseRuntime,publishers});
        await store.mutate(s=>{if(!s.releases.some(r=>r.id===result.id))s.releases.push(result);});break;
      }
      case 'release.inspect':result=await inspectNativeRelease(store,select(store.read().releases,p.releaseId,'release'),publishers);break;
      case 'release.activate':
      case 'release.start':
      case 'release.stop':
      case 'release.rollback':result=await controlNativeRelease(store,select(store.read().releases,p.releaseId,'release'),op.action.split('.')[1],p,publishers);break;
      case 'buyer.inspect':result=await inspectBuyer(Object.hasOwn(op.context??{},'inboxDirectory')?op.context.inboxDirectory:inboxDirectory,p.intentIds);break;
      case 'buyer.receive': {
        result=await receiveBuyer(store,Object.hasOwn(op.context??{},'inboxDirectory')?op.context.inboxDirectory:inboxDirectory,p.intentIds,'buyer-'+id);
        await store.mutate(s=>{if(!s.receipts.some(r=>r.id===result.id))s.receipts.push(result);});break;
      }
      case 'export.create': {
        const edition=await store.edition(p.editionId),annotations=op.context?.annotations??store.read().annotations.filter(a=>a.editionId===edition.id);
        const exported=await exportEdition(store,edition,annotations,p.format),saved=await store.putObject(exported.bytes);
        result={id:'export-'+id,editionId:edition.id,format:p.format,name:'stellar-'+edition.id.slice(0,12)+'.'+exported.extension,
          type:exported.type,bytes:saved.bytes,sha256:saved.sha256,createdAt:op.createdAt,note:exported.note??null,downloadUrl:'/api/exports/export-'+id};
        await store.mutate(s=>{if(!s.exports.some(e=>e.id===result.id))s.exports.push(result);});break;
      }
    }
    const launch=result?.launchCapture;if(launch)delete result.launchCapture;
    const saved=await store.putObject(jsonBytes(result));
    await store.mutate(s=>{const current=s.operations[op.operationId];current.state='COMPLETE';current.resultSha256=saved.sha256;
      current.completedAt=new Date().toISOString();current.error=null;});
    if(launch&&!closing)launchCapture(launch.id,launch.budget);
    return result;
  }
  async function action(request) {
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
    }catch(e){
      const error=errorInfo(e);
      if(op)await store.mutate(s=>{const current=s.operations[op.operationId];if(current?.state!=='COMPLETE'){
        current.state='FAILED';current.error=error;current.failedAt=new Date().toISOString();}}).catch(()=>{});
      throw Object.assign(new Error(error.message),error,{operationId:op?.operationId,currentRevision:store.read().revision});
    }
  }
  for(const c of store.read().captures){
    if(!c.pages.length)continue;
    const e=c.editionId?await store.edition(c.editionId):null;
    if(!e||e.pageCount!==c.pages.length||e.complete!==(c.state==='COMPLETE'&&c.nextUrl===null))await sealCapture(c.id);
  }
  return {schema,view,action,store,editions:listEditions,
    rows:async(id,options)=>editionRows(store,await store.edition(id),options),
    async raw(id,page){const e=await store.edition(id);if(!Number.isInteger(page)||page<0||page>=e.pages.length)throw fault('STELLAR_SOURCE_PAGE','Choose an original source page.');
      const p=e.pages[page];return {bytes:await store.object(p.sha256),receipt:p,type:e.query.kind==='supply'?'text/plain; charset=utf-8':'application/json; charset=utf-8'};},
    async exported(id){const item=select(store.read().exports,id,'export');return {item,bytes:await store.object(item.sha256)};},
    async received(id,name){return readBuyerOutput(store,select(store.read().receipts,id,'customer receipt'),name);},
    async waitForCaptures(){await Promise.allSettled([...running.values()]);return view();},
    async close(){if(closing)return;closing=true;for(const c of controllers.values())c.abort();
      await Promise.allSettled([...running.values(),...operations.values()]);try{await publishers.close();}finally{await store.close();}}
  };
}
