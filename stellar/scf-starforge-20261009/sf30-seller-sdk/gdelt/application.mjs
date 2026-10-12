// MIT. One customer/operator application over the original source and buyer engines.
import { join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readPrivateJson } from '../routescan/quota.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { need, plain, clone, jsonBytes, operationId, projectionPolicy, tableFields, columnMeaning,
  ATTRIBUTION, NOTICE, LIMITS, digest } from './model.mjs';
import { discoverGdelt, inspectGdeltCapture, optionalJson, durableDirectory, exactFile } from './source.mjs';
import { readGdeltWorkspaceLaunch, GDELT_WORKSPACE_STARTUP } from './launch.mjs';
import { readGdeltProject, gdeltProjectView, getGdeltCapture, acquireGdeltCapture, importGdeltCapture,
  selectGdeltCapture, gdeltRows, reviewGdeltCapture, compareGdeltCaptures, publishGdeltReview,
  selectGdeltPublication, abandonGdeltOperation, exportGdeltProject, receiveGdeltProject } from './project.mjs';
import { readGdeltMerchant, startGdeltMerchant, prepareGdeltPurchase, executeGdeltPurchase,
  recoverGdeltPurchase, exportGdeltPurchase } from './merchant.mjs';
import { prepareGdeltDataset, createGdeltDataset, actGdeltDataset, receiveGdeltDataset,
  reopenGdeltSources, exportGdeltDatasetDelivery } from './customer.mjs';

export const ACTION_FIELDS=Object.freeze({
  discover:['history'], capture:['id','expectedRevision','batch','manifest','discoveryId'],
  import:['id','expectedRevision','capture'], select:['id','expectedRevision','captureId'],
  review:['id','expectedRevision','captureIds','policy','note','name'],
  publish:['id','expectedRevision','reviewId','origin','path','payment'],
  abandon:['id','expectedRevision','pendingId','note'],
  'merchant-start':['publicationId'],'merchant-stop':['publicationId'],
  prepare:['publicationId','intentId','query','kind','file','previous','acceptIndex'],
  buy:['publicationId','intentId'],recover:['publicationId','intentId'],
  'dataset-prepare':['publicationId','id','kind','query','maxPages','maxTotalAtomic','maxRows','acceptIndex'],
  'dataset-create':['publicationId','id'],
  'dataset-run':['publicationId','id'],'dataset-inspect':['publicationId','id'],
  'dataset-recover':['publicationId','id'],'dataset-deliver':['publicationId','id'],
  'dataset-accounting':['publicationId','id'],'dataset-finalize':['publicationId','id'],
  'dataset-receive':['publicationId','id'],'customer-reopen':['publicationId','id'],
  'customer-open':['publicationId','id'],
  'project-receive':['bundle']
});
export const QUERY_FIELDS=Object.freeze({
  launch:[],state:[],discovery:['id'],fields:['table'],rows:['captureIds','policy','offset','limit'],
  'source-summary':['captureId'],compare:['before','after'],publication:['publicationId'],
  preview:['publicationId','kind','query']
});
export const DOWNLOAD_FIELDS=Object.freeze({
  source:['captureId'],project:[],comparison:['before','after'],customer:['publicationId','intentId'],
  dataset:['publicationId','id','file']
});
const declared=(fields,kind,input)=>need(Object.hasOwn(fields,kind)&&plain(input)&&
  Object.keys(input).every(key=>fields[kind].includes(key)),'Use the declared application input fields.');
const nativeView=value=>{const {result,...view}=value;return view;};

export async function openGdeltApplication(options={}) {
  const launch=await readGdeltWorkspaceLaunch(options),{binding,buyerSettings}=launch;
  const directory=binding.directory,instanceId=randomUUID(),startedAt=new Date().toISOString();
  const buyer=options.buyer??(buyerSettings?await new Buyer(buyerSettings).ready():null);
  const lifetime=new AbortController(),tasks=new Set(),receivedWindows=new Map();
  let merchant=null,runningPublication=null,pending=null,closing=false,closingPromise;
  const merchantView=()=>merchant?{publicationId:runningPublication,url:merchant.url,mode:merchant.mode,
    editionId:merchant.editionId,snapshot:merchant.snapshot,resource:merchant.resource}:null;
  const selected=id=>selectGdeltPublication(directory,id);
  const ownCustomer=(publicationId,id)=>{
    need(/^[a-f0-9]{64}$/.test(publicationId),'Select the original publication.');operationId(id);
    return join(directory,'customer-intake',publicationId,id);
  };
  async function assertCurrent() {
    need(!closing,'The original application is closing.','GDELT_APPLICATION_CLOSING',503);
    need((await readGdeltProject(directory)).id===binding.projectId,'The original project changed.','GDELT_WORKSPACE_BINDING_CHANGED',409);
  }
  function requireBuyer() {need(buyer,'Start this application with the existing private SF88 buyer configuration.','GDELT_BUYER_REQUIRED',409);return buyer;}
  const startup=()=>({schema:GDELT_WORKSPACE_STARTUP,state:'LISTENING',binding,instanceId,startedAt,buyerConfigured:Boolean(buyer)});
  async function listCustomer(directory) {
    const result=[];
    for(const kind of ['customer-requests','customer-datasets']){
      let entries;
      try{entries=await readdir(join(directory,kind),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
      for(const entry of entries){
        if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(entry.name))continue;
        const record=await optionalJson(join(directory,kind,entry.name,kind==='customer-requests'?'prepared.json':'plan.json'),131072);
        if(record)result.push({id:entry.name,kind:kind==='customer-requests'?'request':'dataset',
          product:record.kind??(record.file?'file':'rows'),url:record.url,snapshot:record.snapshot??null,
          limits:record.limits??null,planSha256:record.planSha256??record.purchaseSha256});
      }
    }
    return result;
  }
  async function query(kind,input={}) {
    await assertCurrent();declared(QUERY_FIELDS,kind,input);
    switch(kind){
      case 'launch':return startup();
      case 'state':return{project:await gdeltProjectView(directory),merchant:merchantView(),
        busy:pending?{action:pending.action,id:pending.id,startedAt:pending.startedAt}:null,buyerConfigured:Boolean(buyer)};
      case 'discovery':{
        need(/^[a-f0-9]{64}$/.test(input.id??''),'Select the retained discovery ID.');
        const found=await readPrivateJson(join(directory,'discoveries',input.id+'.json'),2*1024*1024);
        need(digest(found.manifest)===input.id,'The retained source manifest changed.');return found;
      }
      case 'fields':return{table:input.table??'events',fields:tableFields(input.table??'events').map(name=>({name,...columnMeaning(name)})),notice:NOTICE,attribution:ATTRIBUTION};
      case 'rows':return gdeltRows({...input,directory});
      case 'source-summary':{
        const capture=await getGdeltCapture(directory,input.captureId),model=inspectGdeltCapture(capture);
        const{events,mentions,...summary}=model;return summary;
      }
      case 'compare':return compareGdeltCaptures({directory,before:input.before,after:input.after});
      case 'publication':{
        const location=await selected(input.publicationId),{edition,plan,offers}=await readGdeltMerchant(location);
        const{directory:unused,...publicEdition}=edition;
        return{edition:publicEdition,plan,offers,customers:await listCustomer(location)};
      }
      case 'preview':{
        const location=await selected(input.publicationId),{edition}=await readGdeltMerchant(location);
        const kind=input.kind??'rows';need(['rows','sources'].includes(kind),'Choose rows or sources.');
        const dataset=await loadDatasetConfig(join(location,kind==='sources'?'source-dataset.json':'dataset.json'));
        const query=new URLSearchParams(input.query??''),snapshot=kind==='sources'?edition.sourceSnapshot:edition.snapshot;
        need(!query.has('snapshot')||query.get('snapshot')===snapshot,'Keep the selected original edition snapshot.');
        query.delete('snapshot');const context={query};
        const admitted=dataset.admit(context),result=admitted===true?dataset.handle(context):admitted;
        return{mode:'ORIGINAL_DATASET_PREVIEW',status:result.status,...result.body};
      }
      default:need(false,'Unknown GDELT application read.');
    }
  }
  async function execute(request,signal) {
    const common={directory,id:request.id,expectedRevision:request.expectedRevision};
    switch(request.action){
      case'discover':{
        const found=await discoverGdelt({history:request.history??false,signal,fetchImpl:options.fetchImpl});
        const discoveryId=digest(found.manifest),location=await durableDirectory(join(directory,'discoveries'));
        await exactFile(location,discoveryId+'.json',jsonBytes(found));return {...found,discoveryId};
      }
      case'capture':{
        need(!(request.manifest&&request.discoveryId),'Select one original source manifest.');
        let manifest=request.manifest;
        if(request.discoveryId)manifest=(await query('discovery',{id:request.discoveryId})).manifest;
        return acquireGdeltCapture({...common,batch:request.batch,manifest,signal,
          fetchImpl:options.fetchImpl,python:options.python,onProgress:options.onProgress});
      }
      case'import':return importGdeltCapture({...common,capture:request.capture,signal,python:options.python});
      case'select':return selectGdeltCapture({...common,captureId:request.captureId});
      case'review':return reviewGdeltCapture({...common,captureIds:request.captureIds,policy:request.policy,
        note:request.note,name:request.name});
      case'publish':return publishGdeltReview({...common,reviewId:request.reviewId,origin:request.origin,
        path:request.path,payment:request.payment});
      case'abandon':return abandonGdeltOperation({...common,pendingId:request.pendingId,note:request.note});
      case'merchant-start':{
        if(merchant){need(runningPublication===request.publicationId,'The original merchant already serves another edition.','GDELT_MERCHANT_RUNNING',409);return{...merchantView(),reused:true};}
        merchant=await startGdeltMerchant({directory:await selected(request.publicationId),port:binding.merchantPort,
          facilitator:binding.facilitator??undefined,allowLocalFacilitator:binding.allowLocalFacilitator,
          nativeFactory:options.nativeFactory});
        runningPublication=request.publicationId;return merchantView();
      }
      case'merchant-stop':{
        need(!merchant||runningPublication===request.publicationId,'Choose the current merchant edition.','GDELT_MERCHANT_CHANGED',409);
        if(merchant)await merchant.close();merchant=null;runningPublication=null;return{state:'STOPPED'};
      }
      case'prepare':return prepareGdeltPurchase({directory:await selected(request.publicationId),
        intentId:request.intentId,query:new URLSearchParams(request.query??''),kind:request.kind,file:request.file,
        previous:request.previous,acceptIndex:request.acceptIndex});
      case'buy':{
        const location=await selected(request.publicationId);operationId(request.intentId);
        const purchase=await readPrivateJson(join(location,'customer-requests',request.intentId,'prepared.json'),131072);
        return nativeView(await executeGdeltPurchase({directory:location,buyer:requireBuyer(),purchase,signal}));
      }
      case'recover':return nativeView(await recoverGdeltPurchase({directory:await selected(request.publicationId),
        buyer:requireBuyer(),intentId:request.intentId}));
      case'dataset-prepare':return prepareGdeltDataset({directory:await selected(request.publicationId),id:request.id,
        kind:request.kind,query:request.query,maxPages:request.maxPages,maxTotalAtomic:request.maxTotalAtomic,
        maxRows:request.maxRows,acceptIndex:request.acceptIndex});
      case'dataset-create':{
        const{dataset,...result}=await createGdeltDataset({directory:await selected(request.publicationId),buyer:requireBuyer(),id:request.id});
        return result;
      }
      case'dataset-run':case'dataset-inspect':case'dataset-recover':case'dataset-deliver':case'dataset-accounting':case'dataset-finalize':
        return actGdeltDataset({directory:await selected(request.publicationId),buyer:requireBuyer(),id:request.id,
          action:request.action.slice(8),signal});
      case'dataset-receive':return receiveGdeltDataset({directory:await selected(request.publicationId),buyer:requireBuyer(),
        id:request.id,target:join(ownCustomer(request.publicationId,request.id),'sources'),python:options.python,signal});
      case'customer-reopen':{
        await selected(request.publicationId);
        const root=ownCustomer(request.publicationId,request.id);
        return reopenGdeltSources({sourceDirectory:join(root,'sources'),projectDirectory:join(root,'project'),
          python:options.python,signal});
      }
      case'customer-open':{
        await selected(request.publicationId);
        const target=join(ownCustomer(request.publicationId,request.id),'project');
        await readGdeltProject(target);
        let browser=receivedWindows.get(target);
        if(!browser){
          const {startGdeltWorkspace}=await import('./workspace.mjs');
          browser=await startGdeltWorkspace({directory:target,python:options.python});
          receivedWindows.set(target,browser);
        }
        return {schema:'stellar-forge.gdelt-customer-window.v1',url:browser.url,
          projectId:browser.startup.binding.projectId,instanceId:browser.startup.instanceId};
      }
      case'project-receive':{
        const bundle=request.bundle;
        need(/^[a-f0-9]{64}$/.test(bundle?.bundleSha256??''),'Select a complete project bundle.');
        return receiveGdeltProject({directory:join(directory,'received-projects',bundle.bundleSha256),bundle,python:options.python,signal});
      }
      default:need(false,'Unknown GDELT application action.');
    }
  }
  async function action(request) {
    await assertCurrent();
    need(plain(request)&&Object.hasOwn(ACTION_FIELDS,request.action)&&
      Object.keys(request).every(name=>name==='action'||ACTION_FIELDS[request.action].includes(name)),'Use the declared original application fields.');
    need(!pending,'An original application action is still running; inspect or cancel that same action.','GDELT_APPLICATION_BUSY',409);
    const control=new AbortController(),signal=AbortSignal.any([lifetime.signal,control.signal]);
    const task=Promise.resolve().then(()=>execute(request,signal));
    pending={action:request.action,id:request.id??request.intentId??request.publicationId??request.action,
      startedAt:new Date().toISOString(),control,task};
    try{return await task;}finally{if(pending?.task===task)pending=null;}
  }
  async function download(kind,input={}) {
    await assertCurrent();declared(DOWNLOAD_FIELDS,kind,input);
    if(kind==='source')return{name:'gdelt-'+input.captureId+'.json',type:'application/json',bytes:jsonBytes(await getGdeltCapture(directory,input.captureId))};
    if(kind==='project')return{name:'gdelt-event-desk.json',type:'application/json',bytes:jsonBytes(await exportGdeltProject({directory}))};
    if(kind==='comparison')return{name:'gdelt-batch-comparison.json',type:'application/json',bytes:jsonBytes(await compareGdeltCaptures({directory,before:input.before,after:input.after}))};
    if(kind==='customer'){
      const value=await exportGdeltPurchase({directory:await selected(input.publicationId),buyer:requireBuyer(),intentId:input.intentId});
      return{name:value.filename,type:value.contentType,bytes:value.bytes};
    }
    if(kind==='dataset')return exportGdeltDatasetDelivery({directory:await selected(input.publicationId),
      id:input.id,file:input.file,signal:lifetime.signal});
    need(false,'Choose an original complete source, project, comparison or customer file.');
  }
  function track(work) {
    const task=Promise.resolve().then(work);tasks.add(task);task.finally(()=>tasks.delete(task)).catch(()=>{});return task;
  }
  return{directory,binding,instanceId,startup,
    query:(...args)=>track(()=>query(...args)),action:(...args)=>track(()=>action(...args)),
    download:(...args)=>track(()=>download(...args)),
    cancel(id){need(pending&&pending.id===id,'Select the exact running action.','GDELT_OPERATION_NOT_RUNNING',409);pending.control.abort();return{id,state:'CANCELLING'};},
    close(){return closingPromise??=(async()=>{
      closing=true;lifetime.abort();
      await Promise.allSettled([...tasks]);
      await Promise.all([...receivedWindows.values()].map(browser=>browser.close()));receivedWindows.clear();
      if(merchant)await merchant.close();
      merchant=null;runningPublication=null;
    })();}
  };
}
