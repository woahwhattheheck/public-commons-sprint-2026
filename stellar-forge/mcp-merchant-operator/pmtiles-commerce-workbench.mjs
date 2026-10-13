// MIT. Read the original merchant records; mutations stay on their existing engines.
import {opendir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {readJson,exists} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {operation as originalOperation} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {need,clone,digest,identifier} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/model.mjs';
import {readOutputPackage,outputPackageView} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/package.mjs';
import {fields,normalizeOutputInput,OUTPUT_METADATA_BYTES} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/model.mjs';

export const PMTILES_COMMERCE_WORKBENCH_SCHEMA='starforge.pmtiles-commerce-workbench.v1';
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
const sectionKinds={offers:'offer',purchases:'purchase',operations:'operation',packages:'package'};
function errorView(error){return {code:error.code??'PMTILES_RETAINED_RECORD_UNAVAILABLE',message:String(error.message??error).slice(0,1000)};}
async function originalDirectory(path){
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path,'PMTILES_COMMERCE_RECORD_DIRECTORY_CHANGED');
  return path;
}
/** Keep only the requested page in memory while scanning the existing directory. */
async function directoryPage(root,{after=null,limit=20,signal}={}){
  need(after===null||typeof after==='string','PMTILES_COMMERCE_CURSOR_INVALID');
  if(after!==null)identifier(after);
  need(Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'PMTILES_COMMERCE_PAGE_LIMIT');
  if(!await exists(root))return {ids:[],hasMore:false,nextAfter:null};
  await originalDirectory(root);
  const selected=[];
  for await(const row of await opendir(root)){
    signal?.throwIfAborted();
    if(!row.isDirectory()||row.isSymbolicLink()||after!==null&&row.name<=after)continue;
    try{identifier(row.name);}catch{continue;}
    selected.push(row.name);selected.sort();
    if(selected.length>limit+1)selected.pop();
  }
  const hasMore=selected.length>limit,ids=selected.slice(0,limit);
  return {ids,hasMore,nextAfter:hasMore?ids.at(-1):null};
}
function briefObject(row){
  return pick(row,['id','name','bytes','filename','mode','maxBytes','expectedSha256','snapshot','pricing','product']);
}
function preparedArgs(alias,input){
  return {workspace:alias,...pick(input,['requestId','releaseId','releaseManifestSha256','offerId','title','origin','payment','chunkBytes']),
    objects:input.objects.map(row=>({...pick(row,['id','resourceId','amount','filename']),
      ...(row.package?{packageRequestId:row.package.requestId,archiveSha256:row.package.archiveSha256}:{})}))};
}
/**
 * Host paths and aliases come from the same selected MerchantPMTilesCommerce.
 * The browser receives public terms and stable IDs, never private configuration.
 */
export async function readPMTilesCommerceWorkbench({alias,entry,controller,output,directory,packagesDirectory,
  packageSelection,readBuyerConfiguration,input={},signal}){
  input=clone(input);
  fields(input,['workspace','section','kind','requestId','after','limit'],['workspace']);
  need(input.workspace===alias,'PMTILES_COMMERCE_WORKSPACE_ALIAS_CHANGED');
  const workspace=controller.workspace,workspaceId=workspace.state().id;
  need(workspaceId===entry.expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
  const section=input.section??'summary',base={schema:PMTILES_COMMERCE_WORKBENCH_SCHEMA,workspace:alias,workspaceId,section};
  const envelope=(tool,args)=>({tool,args:{workspace:alias,...args}});
  async function offer(id,details){
    const root=await originalDirectory(output.packageDirectory(id));
    const request=normalizeOutputInput(await readJson(join(root,'request.json'),OUTPUT_METADATA_BYTES));
    need(request.requestId===id&&request.expectedWorkspaceId===workspaceId,'PMTILES_COMMERCE_OFFER_REQUEST_CHANGED');
    let prepared=null;
    if(await exists(join(root,'package.json'))){
      // The same original reader checks the complete metadata and derived catalog.
      // Original execution checks the retained bodies before staging or purchasing.
      prepared=outputPackageView(await readOutputPackage(root,{verify:false,signal}));
    }
    const row={kind:'offer',requestId:id,state:prepared?'COMPLETE':'PREPARING',title:request.title,
      offerId:request.offerId,releaseId:request.releaseId,releaseManifestSha256:request.releaseManifestSha256,
      objectCount:request.objects.length,...(prepared?{manifestSha256:prepared.manifestSha256,
        catalogSha256:prepared.catalogSha256,objects:prepared.objects.map(briefObject)}:{})};
    return details?{...row,request:preparedArgs(alias,request),prepared,
      resume:envelope('merchant_pmtiles_output_prepare',preparedArgs(alias,request))}:row;
  }
  async function purchase(id,details){
    const root=await originalDirectory(join(directory,'purchases',id));
    const request=await readJson(join(root,'merchant-request.json'),OUTPUT_METADATA_BYTES);
    need(request.schema==='starforge.pmtiles-mcp-purchase-request.v1'&&request.workspace===alias&&
      request.workspaceId===workspaceId&&request.args?.requestId===id&&request.args.workspace===alias&&
      request.buyer===request.args.buyer,'PMTILES_COMMERCE_PURCHASE_REQUEST_CHANGED');
    const current=entry.commerce?.buyers?.[request.buyer];
    const available=!!current&&digest(current)===digest(request.buyerConnection);
    let saved=null,delivery=null;
    const nativeRoot=join(root,'native-purchase');
    if(await exists(join(nativeRoot,'purchase.json'))){
      const selected=await readJson(join(root,'merchant-input.json'),OUTPUT_METADATA_BYTES);
      need(selected.commandSha256===digest(request),'PMTILES_COMMERCE_PURCHASE_INPUT_CHANGED');
      saved=await readJson(join(nativeRoot,'purchase.json'),OUTPUT_METADATA_BYTES);
      need(saved.schema==='starforge.pmtiles-output-purchase.v1'&&saved.requestId===id&&
        saved.requestSha256===digest(selected.input)&&saved.object.id===request.args.objectId&&
        saved.catalogSha256===selected.input.catalogSha256,'PMTILES_COMMERCE_PURCHASE_SELECTION_CHANGED');
      if(await exists(join(nativeRoot,'delivery.json'))){
        delivery=await readJson(join(nativeRoot,'delivery.json'),OUTPUT_METADATA_BYTES);
        need(delivery.schema==='starforge.pmtiles-output-delivery.v1'&&delivery.requestId===id&&
          delivery.requestSha256===saved.requestSha256&&delivery.objectId===saved.object.id&&
          delivery.catalogSha256===saved.catalogSha256&&delivery.assembly?.bytes===saved.object.bytes&&
          delivery.assembly.sha256===saved.object.expectedSha256&&delivery.assembly.snapshot===saved.object.snapshot,
          'PMTILES_COMMERCE_PURCHASE_DELIVERY_CHANGED');
      }
    }
    const row={kind:'purchase',requestId:id,buyer:request.buyer,buyerAvailable:available,
      state:delivery?'DELIVERED':saved?'PREPARED':'PREPARING',objectId:request.args.objectId,
      maxTotalAtomic:request.args.maxTotalAtomic,
      ...(saved?{catalogSha256:saved.catalogSha256,object:briefObject(saved.object)}:{})};
    return details?{...row,request:clone(request.args),
      delivery:delivery?pick(delivery.assembly,['id','assemblyId','sessionId','snapshot','bytes','sha256']):null,
      resume:envelope('merchant_pmtiles_purchase_prepare',request.args)}:row;
  }
  async function operation(id,details){
    const record=await output.execute('request',{expectedWorkspaceId:workspaceId,requestId:id},{signal});
    const selected=record.request;
    need(selected.input.requestId===id&&['stage','activate','start','stop'].includes(selected.action),
      'PMTILES_COMMERCE_OPERATION_CHANGED');
    const args=clone(selected.input);delete args.expectedWorkspaceId;
    if(selected.action==='stage'){args.runtime=args.runtimeName;delete args.runtimeName;}
    const row={kind:'operation',requestId:id,action:selected.action,state:record.complete?'COMPLETE':'PREPARING',
      ...pick(args,['releaseId','outputRequestId','manifestSha256','releaseDigest','expectedGeneration','runtime','instanceId'])};
    return details?{...row,request:args,complete:record.complete,
      resume:envelope('merchant_pmtiles_output_'+selected.action,args)}:row;
  }
  async function operationsPackage(id,details){
    const root=await originalDirectory(join(packagesDirectory,id));
    const request=await readJson(join(root,'staging','package-request.json'),OUTPUT_METADATA_BYTES);
    need(request.schema==='starforge.pmtiles-package-request.v1'&&request.requestId===id&&request.workspaceId===workspaceId,
      'PMTILES_COMMERCE_PACKAGE_REQUEST_CHANGED');
    let selected=null;
    if(await exists(join(root,'staging','package-complete.json')))selected=await packageSelection(id);
    const row={kind:'package',requestId:id,state:selected?'COMPLETE':'PREPARING',
      ...(selected?{packageId:selected.result.packageId,archiveSha256:selected.result.archive.sha256,
        bytes:selected.result.archive.bytes,releaseId:selected.result.workspace.currentRelease,
        workspaceRevision:selected.result.workspace.revision,runtimeSha256:selected.result.runtimeSha256}:{})};
    return details?{...row,resume:envelope('merchant_pmtiles_package',{requestId:id})}:row;
  }
  const readers={offer,purchase,operation,package:operationsPackage};
  if(section==='summary'){
    fields(input,['workspace','section'],['workspace']);
    const current=workspace.state(),release=current.currentRelease?workspace.getRelease(current.currentRelease):null;
    const buyers=[];
    for(const [name,connection]of Object.entries(entry.commerce?.buyers??{})){
      signal?.throwIfAborted();
      try{
        const config=await readBuyerConfiguration(connection.configuration),op=originalOperation(config.operation);
        buyers.push({name,available:op.method==='GET',origin:new URL(op.url).origin,
          payment:pick(op.expect,['scheme','network','asset','payTo','maxTimeoutSeconds']),
          maxAtomic:op.expect.maxAtomic,accounting:!!connection.operatorWorkspace});
      }catch(error){buyers.push({name,available:false,accounting:!!connection.operatorWorkspace,error:errorView(error)});}
    }
    const status=await output.execute('status',{expectedWorkspaceId:workspaceId},{signal});
    return {...base,title:entry.label,currentRelease:release?pick(release,
      ['id','manifestSha256','editionId','editionVersion','runtimeSha256','createdAt']):null,
      sourceCount:release?.resourceIds.length??0,
      sources:(release?.resourceIds??[]).slice(0,200).map(id=>pick(workspace.getResource(id),['id','name','kind','bytes','sha256','rights'])),
      sourceNextAfter:(release?.resourceIds.length??0)>200?200:null,
      buyers,receivingTargets:Object.keys(entry.receivingTargets??{}),output:status};
  }
  if(section==='sources'){
    fields(input,['workspace','section','after','limit'],['workspace']);
    const state=workspace.state(),release=state.currentRelease?workspace.getRelease(state.currentRelease):null;
    const offset=input.after===undefined?0:Number(input.after),limit=input.limit??50;
    need(Number.isSafeInteger(offset)&&offset>=0&&String(offset)===(input.after??'0')&&
      Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'PMTILES_COMMERCE_SOURCE_PAGE_INVALID');
    const ids=release?.resourceIds??[],next=offset+Math.min(limit,Math.max(0,ids.length-offset));
    return {...base,releaseId:release?.id??null,releaseManifestSha256:release?.manifestSha256??null,
      items:ids.slice(offset,offset+limit).map(id=>pick(workspace.getResource(id),['id','name','kind','bytes','sha256','rights'])),
      hasMore:next<ids.length,nextAfter:next<ids.length?String(next):null};
  }
  if(section==='request'){
    fields(input,['workspace','section','kind','requestId'],['workspace','section','kind','requestId']);
    need(Object.hasOwn(readers,input.kind),'PMTILES_COMMERCE_RECORD_KIND_INVALID');
    const result=await readers[input.kind](identifier(input.requestId),true);return {...base,record:result};
  }
  need(Object.hasOwn(sectionKinds,section),'PMTILES_COMMERCE_SECTION_INVALID');
  fields(input,['workspace','section','after','limit'],['workspace']);
  const roots={offers:join(output.directory,'packages'),purchases:join(directory,'purchases'),
    operations:join(output.directory,'operations'),packages:packagesDirectory};
  const page=await directoryPage(roots[section],{after:input.after??null,limit:input.limit??20,signal}),items=[];
  for(const id of page.ids){
    signal?.throwIfAborted();
    try{items.push(await readers[sectionKinds[section]](id,false));}
    catch(error){items.push({kind:sectionKinds[section],requestId:id,state:'UNAVAILABLE',error:errorView(error)});}
  }
  return {...base,items,hasMore:page.hasMore,nextAfter:page.nextAfter};
}
