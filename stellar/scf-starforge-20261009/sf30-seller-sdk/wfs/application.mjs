// MIT. Complete WFS operator and customer workflows over the original native engines.
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readPrivateJson } from '../routescan/quota.mjs';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { startDatasetWorkspace } from '../dataset-workspace.mjs';
import { JsonNumber,parseSource } from '../ogc/source.mjs';
import { features } from '../ogc/project.mjs';
import { need,plain,jsonBytes,hash,operationId,LIMITS } from './model.mjs';
import { readWfsDocument,optionalJson } from './source.mjs';
import { createWfsSourceAuth } from './auth.mjs';
import { readWfsWorkspaceLaunch,WFS_WORKSPACE_STARTUP } from './launch.mjs';
import { readWfsProject,discoverWfsSource,readWfsCatalog,describeWfsType,saveWfsQuery,runWfsOrder,
  getWfsOrder,inspectWfsOrder,pageWfsFeatures,compareWfsOrders,defaultWfsPlan,exportWfsOrder,
  getWfsPublication,abandonWfsOperation } from './project.mjs';
import { exportWfsProject,inspectWfsProjectBundle,receiveWfsProject } from './portable.mjs';
import { stageWfsMerchant,readWfsMerchant,startWfsMerchant,prepareWfsPurchase,
  executeWfsPurchase,recoverWfsPurchase,exportWfsPurchase } from './merchant.mjs';
import { prepareWfsDataset,createWfsDataset,actWfsDataset,receiveWfsDataset,
  reopenWfsSources,exportWfsDatasetDelivery } from './customer.mjs';

const recorded=['id','expectedRevision'];
export const ACTION_FIELDS=Object.freeze({
  discover:[...recorded,'endpoint','name','terms','allowLoopback'],
  describe:[...recorded,'sourceId','typeName'],
  'save-query':[...recorded,'sourceId','schemaId','name','selection'],
  'run-order':[...recorded,'queryId','name','limits'],
  compare:[...recorded,'before','after','keyPointer'],
  'export-order':[...recorded,'orderId','plan','payment','origin','path'],
  abandon:[...recorded,'pendingId','note'],
  'merchant-start':['publicationId'],'merchant-stop':['publicationId'],
  'publication-open':['publicationId'],
  prepare:['publicationId','intentId','query','kind','file','previous','acceptIndex'],
  buy:['publicationId','intentId'],recover:['publicationId','intentId'],
  'dataset-prepare':['publicationId','id','kind','query','maxPages','maxTotalAtomic','maxRows','acceptIndex'],
  'dataset-create':['publicationId','id'],
  'dataset-run':['publicationId','id'],'dataset-inspect':['publicationId','id'],
  'dataset-recover':['publicationId','id'],'dataset-deliver':['publicationId','id'],
  'dataset-accounting':['publicationId','id'],'dataset-finalize':['publicationId','id'],
  'dataset-receive':['publicationId','id'],'customer-reopen':['publicationId','id'],
  'customer-open':['publicationId','id'],'project-receive':['bundle'],'project-open':['bundleSha256']
});
export const QUERY_FIELDS=Object.freeze({
  launch:[],state:[],catalog:['sourceId','offset','limit'],schema:['schemaId'],
  order:['orderId'],features:['orderId','offset','limit'],inspection:['orderId'],plan:['orderId'],
  comparison:['comparisonId','kind','offset','limit'],publication:['publicationId'],
  preview:['publicationId','kind','query']
});
export const DOWNLOAD_FIELDS=Object.freeze({
  capabilities:['sourceId'],schema:['schemaId'],'raw-page':['orderId','index'],
  features:['orderId'],comparison:['comparisonId'],project:[],
  customer:['publicationId','intentId'],dataset:['publicationId','id','file']
});
const declared=(fields,kind,input)=>need(Object.hasOwn(fields,kind)&&plain(input)&&
  Object.keys(input).every(key=>fields[kind].includes(key)),'Use the declared application fields.');
const selected=(rows,id)=>{need(/^[a-f0-9]{64}$/.test(id??''),'Select an original record.');const item=rows.find(x=>x.id===id);need(item,'The selected record is unavailable.');return item;};
const nativeView=value=>{const{result,...view}=value;return view;};
function displayValue(value) {
  if(value instanceof JsonNumber)return value.text;
  if(Array.isArray(value))return value.map(displayValue);
  if(plain(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,displayValue(item)]));
  return value;
}
function pageRange(input,maximum=1000) {
  const offset=input.offset??0,limit=input.limit??100;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=maximum,'Choose a supported original row page.');
  return{offset,limit};
}
export async function openWfsApplication(options={}) {
  const launch=await readWfsWorkspaceLaunch(options),{binding,buyerSettings,sourceSettings}=launch;
  const directory=binding.directory,instanceId=randomUUID(),startedAt=new Date().toISOString();
  const buyer=options.buyer??(buyerSettings?await new Buyer(buyerSettings).ready():null);
  const sourceAuth=options.sourceAuth??(sourceSettings?createWfsSourceAuth(sourceSettings):null);
  const lifetime=new AbortController(),tasks=new Set(),windows=new Map();
  let merchant=null,runningPublication=null,pending=null,closing=false,closingPromise;
  const publication=async id=>(await getWfsPublication(directory,id)).directory;
  const merchantView=()=>merchant?{publicationId:runningPublication,url:merchant.url,mode:merchant.mode,
    editionId:merchant.editionId,snapshot:merchant.snapshot,sourceSnapshot:merchant.sourceSnapshot,
    resource:merchant.resource,sourceResource:merchant.sourceResource}:null;
  const ownCustomer=(publicationId,id)=>{
    need(/^[a-f0-9]{64}$/.test(publicationId??''),'Select the original publication.');operationId(id);
    return join(directory,'customer-intake',publicationId,id);
  };
  async function assertCurrent(){
    need(!closing,'The application is closing.','WFS_APPLICATION_CLOSING',503);
    need((await readWfsProject(directory)).id===binding.projectId,'The selected project identity changed.','WFS_WORKSPACE_BINDING_CHANGED',409);
  }
  const startup=()=>({schema:WFS_WORKSPACE_STARTUP,state:'LISTENING',binding,instanceId,startedAt,
    buyerConfigured:Boolean(buyer),sourceAuthConfigured:Boolean(sourceAuth)});
  function requireBuyer(){need(buyer,'Select the existing private Buyer configuration for customer acquisition.','WFS_BUYER_REQUIRED',409);return buyer;}
  async function customerRecords(root){
    const result=[];
    for(const[kind,file]of[['customer-requests','prepared.json'],['customer-datasets','plan.json']]){
      let entries;try{entries=await readdir(join(root,kind),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
      for(const entry of entries){
        if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(entry.name))continue;
        const record=await optionalJson(join(root,kind,entry.name,file),131072);
        if(record)result.push({id:entry.name,kind:kind==='customer-requests'?'request':'dataset',
          product:record.kind??'rows',url:record.url,snapshot:record.snapshot,limits:record.limits??null,
          planSha256:record.planSha256??record.purchaseSha256});
      }
    }
    return result;
  }
  async function query(kind,input={}){
    await assertCurrent();declared(QUERY_FIELDS,kind,input);
    switch(kind){
      case'launch':return startup();
      case'state':return{project:await readWfsProject(directory),merchant:merchantView(),
        busy:pending?{action:pending.action,id:pending.id,startedAt:pending.startedAt}:null,
        buyerConfigured:Boolean(buyer),sourceAuthConfigured:Boolean(sourceAuth)};
      case'catalog':{
        const{source,record,model}=await readWfsCatalog(directory,input.sourceId),{offset,limit}=pageRange(input);
        const{featureTypes,...service}=model;
        return{source,record,service,featureTypes:featureTypes.slice(offset,offset+limit),total:featureTypes.length,
          offset,nextOffset:offset+limit<featureTypes.length?offset+limit:null};
      }
      case'schema':{
        const project=await readWfsProject(directory),schema=selected(project.schemas,input.schemaId);
        const{record,model}=await readWfsDocument(join(directory,schema.directory));
        need(record.id===schema.id,'The selected feature schema changed.');return{schema,record,model};
      }
      case'order':{
        const{order,capture}=await getWfsOrder(directory,input.orderId);
        return{order,sourceId:capture.sourceId,selection:capture.config.wfs,collection:capture.config.collection,
          coordinates:capture.config.coordinateDescription,responseCrs:[...new Set(capture.pages.map(x=>x.contentCrs).filter(Boolean))],
          rows:capture.rows,pages:capture.pageCount,bytes:capture.totalBytes,next:capture.next,complete:capture.complete,
          firstReceivedAt:capture.pages[0]?.fetchedAt??null,lastReceivedAt:capture.pages.at(-1)?.fetchedAt??null};
      }
      case'features':{
        const result=await pageWfsFeatures({...input,directory});
        return{...result,representation:'Original numeric lexemes are displayed as text; featureJson retains original JSON number tokens.',
          features:result.features.map(feature=>({...displayValue(feature),featureJson:JSON.stringify(feature)}))};
      }
      case'inspection':return inspectWfsOrder(directory,input.orderId);
      case'plan':return defaultWfsPlan(directory,input.orderId);
      case'comparison':{
        const project=await readWfsProject(directory),entry=selected(project.comparisons,input.comparisonId);
        const raw=await readPrivate(join(directory,entry.path),256*1024*1024);
        need(hash(raw)===entry.id,'The original comparison changed.');
        const value=displayValue(parseSource(raw)),{offset,limit}=pageRange(input);
        const group=input.kind??'changed';need(['added','removed','changed','ambiguous','missingBefore','missingAfter'].includes(group),'Choose a comparison group.');
        const rows=group==='missingBefore'?value.missingKeys.before:group==='missingAfter'?value.missingKeys.after:value[group];
        return{entry,counts:value.counts,keyPointer:value.keyPointer,sourceSelectionsEqual:value.sourceSelectionsEqual,
          retrievalWindows:value.retrievalWindows,group,total:rows.length,offset,rows:rows.slice(offset,offset+limit),
          nextOffset:offset+limit<rows.length?offset+limit:null};
      }
      case'publication':{
        const selected=await getWfsPublication(directory,input.publicationId);
        let terms=null,customers=[];
        if(await optionalJson(join(selected.directory,'commerce','merchant-plan.json'))){
          const current=await readWfsMerchant(selected.directory);
          terms={edition:current.edition,plan:current.plan,offers:current.offers};customers=await customerRecords(current.edition.directory);
        }
        return{publication:selected.publication,edition:selected.edition,merchant:terms,customers};
      }
      case'preview':{
        const selected=await getWfsPublication(directory,input.publicationId),kind=input.kind??'rows';
        need(['rows','sources'].includes(kind),'Choose feature rows or complete source files.');
        const original=kind==='sources'?await readWfsMerchant(selected.directory):null;
        const dataset=await loadDatasetConfig(kind==='sources'?join(original.edition.directory,'source-dataset.json'):join(selected.directory,'dataset.json'));
        const snapshot=kind==='sources'?original.edition.sourceSnapshot:selected.edition.dataset.snapshot;
        const params=new URLSearchParams(input.query??'');
        need(!params.has('snapshot')||params.get('snapshot')===snapshot,'Keep the selected immutable snapshot.');params.delete('snapshot');
        const context={query:params},admitted=dataset.admit(context),result=admitted===true?dataset.handle(context):admitted;
        return{mode:'ORIGINAL_DATASET_PREVIEW',status:result.status,...result.body};
      }
    }
  }
  async function execute(request,signal){
    const common={directory,id:request.id,expectedRevision:request.expectedRevision};
    const source={sourceAuth,transport:options.transport,python:options.python,fetchImpl:options.fetchImpl,
      metadataRecordSource:options.metadataRecordSource,featureRecordSource:options.featureRecordSource,signal};
    switch(request.action){
      case'discover':return discoverWfsSource({...common,...source,endpoint:request.endpoint,name:request.name,
        terms:request.terms??'',allowLoopback:request.allowLoopback===true});
      case'describe':return describeWfsType({...common,...source,sourceId:request.sourceId,typeName:request.typeName});
      case'save-query':return saveWfsQuery({...common,sourceId:request.sourceId,schemaId:request.schemaId,name:request.name,selection:request.selection});
      case'run-order':return runWfsOrder({...common,...source,queryId:request.queryId,name:request.name,
        limits:request.limits??{},onPage:options.onProgress});
      case'compare':return compareWfsOrders({...common,before:request.before,after:request.after,keyPointer:request.keyPointer});
      case'export-order':return exportWfsOrder({...common,orderId:request.orderId,plan:request.plan,
        payment:request.payment,origin:request.origin,path:request.path});
      case'abandon':return abandonWfsOperation({...common,pendingId:request.pendingId,note:request.note});
      case'merchant-start':{
        if(merchant){need(runningPublication===request.publicationId,'Another selected edition is already served.','WFS_MERCHANT_RUNNING',409);return{...merchantView(),reused:true};}
        await stageWfsMerchant({directory,publicationId:request.publicationId});
        merchant=await startWfsMerchant({directory:await publication(request.publicationId),port:binding.merchantPort,
          facilitator:binding.facilitator??undefined,allowLocalFacilitator:binding.allowLocalFacilitator,nativeFactory:options.nativeFactory});
        runningPublication=request.publicationId;return merchantView();
      }
      case'merchant-stop':{
        need(!merchant||runningPublication===request.publicationId,'Select the current merchant.');
        if(merchant)await merchant.close();merchant=null;runningPublication=null;return{state:'STOPPED'};
      }
      case'publication-open':{
        const selected=await getWfsPublication(directory,request.publicationId),key='dataset:'+request.publicationId;
        let browser=windows.get(key);
        if(!browser){browser=await startDatasetWorkspace({datasetPath:join(selected.directory,'dataset.json'),
          port:0});windows.set(key,browser);}
        return{url:browser.url??browser.origin+'/#'+browser.token,snapshot:selected.publication.snapshot};
      }
      case'prepare':return prepareWfsPurchase({directory:await publication(request.publicationId),intentId:request.intentId,
        query:new URLSearchParams(request.query??''),kind:request.kind,file:request.file,previous:request.previous,acceptIndex:request.acceptIndex});
      case'buy':{
        const location=await publication(request.publicationId),{edition}=await readWfsMerchant(location);operationId(request.intentId);
        const purchase=await readPrivateJson(join(edition.directory,'customer-requests',request.intentId,'prepared.json'),131072);
        return nativeView(await executeWfsPurchase({directory:location,buyer:requireBuyer(),purchase,signal}));
      }
      case'recover':return nativeView(await recoverWfsPurchase({directory:await publication(request.publicationId),buyer:requireBuyer(),intentId:request.intentId}));
      case'dataset-prepare':return prepareWfsDataset({directory:await publication(request.publicationId),id:request.id,kind:request.kind,
        query:request.query,maxPages:request.maxPages,maxTotalAtomic:request.maxTotalAtomic,maxRows:request.maxRows,acceptIndex:request.acceptIndex});
      case'dataset-create':{const{dataset,...result}=await createWfsDataset({directory:await publication(request.publicationId),buyer:requireBuyer(),id:request.id});return result;}
      case'dataset-run':case'dataset-inspect':case'dataset-recover':case'dataset-deliver':case'dataset-accounting':case'dataset-finalize':
        return actWfsDataset({directory:await publication(request.publicationId),buyer:requireBuyer(),id:request.id,action:request.action.slice(8),signal});
      case'dataset-receive':return receiveWfsDataset({directory:await publication(request.publicationId),buyer:requireBuyer(),id:request.id,
        target:join(ownCustomer(request.publicationId,request.id),'sources'),python:options.python,signal});
      case'customer-reopen':return reopenWfsSources({sourceDirectory:join(ownCustomer(request.publicationId,request.id),'sources'),
        projectDirectory:join(ownCustomer(request.publicationId,request.id),'project'),python:options.python,signal});
      case'customer-open':{
        await publication(request.publicationId);
        return openProjectWindow(join(ownCustomer(request.publicationId,request.id),'project'));
      }
      case'project-receive':{
        await inspectWfsProjectBundle(request.bundle);
        need(/^[a-f0-9]{64}$/.test(request.bundle.bundleSha256??''),'Select the complete original project bundle.');
        return receiveWfsProject({directory:join(directory,'received-projects',request.bundle.bundleSha256),bundle:request.bundle,signal,python:options.python});
      }
      case'project-open':{
        need(/^[a-f0-9]{64}$/.test(request.bundleSha256??''),'Select an original received project.');return openProjectWindow(join(directory,'received-projects',request.bundleSha256));
      }
    }
  }
  async function openProjectWindow(target){
    await readWfsProject(target);let browser=windows.get(target);
    if(!browser){const{startWfsWorkspace}=await import('./workspace.mjs');browser=await startWfsWorkspace({directory:target,python:options.python});windows.set(target,browser);}
    return{url:browser.url,projectId:browser.startup.binding.projectId,instanceId:browser.startup.instanceId};
  }
  async function action(request){
    await assertCurrent();need(plain(request)&&Object.hasOwn(ACTION_FIELDS,request.action)&&
      Object.keys(request).every(k=>k==='action'||ACTION_FIELDS[request.action].includes(k)),'Use the declared application action.');
    need(!pending,'Inspect or cancel the current application action before starting another.','WFS_APPLICATION_BUSY',409);
    const control=new AbortController(),signal=AbortSignal.any([lifetime.signal,control.signal]);
    const task=Promise.resolve().then(()=>execute(request,signal));
    pending={action:request.action,id:request.id??request.intentId??request.publicationId??request.action,
      startedAt:new Date().toISOString(),control,task};
    try{return await task;}finally{if(pending?.task===task)pending=null;}
  }
  async function download(kind,input={}){
    await assertCurrent();declared(DOWNLOAD_FIELDS,kind,input);
    if(kind==='project')return{name:'wfs-feature-project.json',type:'application/json',bytes:jsonBytes(await exportWfsProject({directory}))};
    if(kind==='capabilities'){const{raw}=await readWfsCatalog(directory,input.sourceId);return{name:'GetCapabilities.xml',type:'application/xml',bytes:raw};}
    if(kind==='schema'){
      const project=await readWfsProject(directory),schema=selected(project.schemas,input.schemaId);
      const{raw}=await readWfsDocument(join(directory,schema.directory));return{name:'DescribeFeatureType.xsd',type:'application/xml',bytes:raw};
    }
    if(kind==='raw-page'){
      const selected=await getWfsOrder(directory,input.orderId);need(Number.isSafeInteger(input.index)&&input.index>=0&&input.index<selected.capture.pages.length,'Select an original captured page.');
      const page=selected.capture.pages[input.index],bytes=await readPrivate(join(selected.directory,'pages',page.file),selected.capture.config.pageBytes);
      need(hash(bytes)===page.sha256,'The original page changed.');return{name:page.file,type:page.contentType,bytes};
    }
    if(kind==='features'){
      const selected=await getWfsOrder(directory,input.orderId),rows=[];let size=0;
      for await(const{feature}of features(selected.directory,selected.capture)){
        size+=Buffer.byteLength(JSON.stringify(feature));need(size<=LIMITS.projectBytes,'The complete feature export exceeds the configured download capacity.');rows.push(feature);
      }
      return{name:'wfs-features-'+input.orderId+'.geojson',type:'application/geo+json',
        bytes:jsonBytes({type:'FeatureCollection',features:rows,sourceId:selected.capture.sourceId,
          coordinateDescription:selected.capture.config.coordinateDescription})};
    }
    if(kind==='comparison'){
      const project=await readWfsProject(directory),item=selected(project.comparisons,input.comparisonId);
      const bytes=await readPrivate(join(directory,item.path),256*1024*1024);need(hash(bytes)===item.id,'The original comparison changed.');
      return{name:'wfs-comparison-'+item.id+'.json',type:'application/json',bytes};
    }
    if(kind==='customer'){
      const file=await exportWfsPurchase({directory:await publication(input.publicationId),buyer:requireBuyer(),intentId:input.intentId});
      return{name:file.filename,type:file.contentType,bytes:file.bytes};
    }
    if(kind==='dataset')return exportWfsDatasetDelivery({directory:await publication(input.publicationId),id:input.id,file:input.file,signal:lifetime.signal});
  }
  function track(work){const task=Promise.resolve().then(work);tasks.add(task);task.finally(()=>tasks.delete(task)).catch(()=>{});return task;}
  return{directory,binding,instanceId,startup,query:(...args)=>track(()=>query(...args)),
    action:(...args)=>track(()=>action(...args)),download:(...args)=>track(()=>download(...args)),
    cancel(id){need(pending?.id===id,'Select the running action.','WFS_OPERATION_NOT_RUNNING',409);pending.control.abort();return{id,state:'CANCELLING'};},
    close(){return closingPromise??=(async()=>{
      closing=true;lifetime.abort();await Promise.allSettled([...tasks]);
      const attempts=[...windows.values()].map(window=>Promise.resolve().then(()=>window.close()));
      if(merchant)attempts.push(Promise.resolve().then(()=>merchant.close()));
      if(!options.sourceAuth&&sourceAuth)attempts.push(Promise.resolve().then(()=>sourceAuth.close()));
      const outcomes=await Promise.allSettled(attempts);
      windows.clear();merchant=null;runningPublication=null;
      const failed=outcomes.find(outcome=>outcome.status==='rejected');if(failed)throw failed.reason;
    })();}
  };
}
