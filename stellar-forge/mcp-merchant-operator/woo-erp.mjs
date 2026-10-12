// MIT. Original Woo ERP order journal and transport, exposed through the existing merchant owner.
import { join } from 'node:path';
import { createMerchantClient } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-operator.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { ERP_TOOL_PREFIX, validateWooErpArguments, wooErpTools } from './woo-erp-schema.mjs';
import { erpFailure, erpPlain, erpDigest, pageWooErpValue, loadWooErpInput,
 inspectWooErpExport, retainWooErpExport, wooErpExportView } from './woo-erp-artifacts.mjs';
export { wooErpTools };
const picked=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
function need(value,code,message){if(!value)throw erpFailure(code,message);}
function mappingSummary(value){
 return {mapId:value.id,schema:value.mapping?.schema,createdAt:value.createdAt,createdBy:value.createdBy,
  storeNamespace:value.mapping?.storeNamespace,currency:value.mapping?.currency,reviewOwner:value.mapping?.reviewOwner,
  check:value.check??null,checkHistoryCount:value.checkHistory?.length??0,
  snapshotSha256:erpDigest(JSON.stringify(value)),pointer:''};
}
function orderSummary(value){
 const record=value.record,at=record.editions.findIndex(edition=>edition.id===record.currentEditionId),edition=record.editions[at];
 return {schema:value.schema,...picked(record,['operationId','orderId','storeNamespace','externalReference','revision','state',
  'currentEditionId','approvedEditionId','createdAt','updatedAt','imported','importNeedsReconcile']),
  observedAt:value.observedAt,sourceStatus:value.sourceStatus,recordSha256:erpDigest(JSON.stringify(record)),
  issuesPreview:(record.issues??[]).slice(0,8),issueCount:record.issues?.length??0,
  edition:{...picked(edition,['id','number','mapId','preparedAt','preparedBy','reviewOwner','sourceSha256','admittedWhenPrepared']),
   planReady:erpPlain(edition?.plan),errorsPreview:(edition?.errors??[]).slice(0,8)},
  approval:record.approval?picked(record.approval,['editionId','at','operatorId','reason','targetBaselineSha256','requestSha256']):null,
  pendingWrite:record.pendingWrite?picked(record.pendingWrite,['attemptId','editionId','requestSha256','startedAt','at']):null,
  target:record.target?picked(record.target,['status','key','documentSha256','basisEditionId','receivedEditionId','receivedAt','identifiedAt']):null,
  counts:Object.fromEntries(['editions','attempts','decisions','imports'].map(name=>[name,record[name]?.length??0])),
  pointers:{journal:'',currentEdition:'/editions/'+at,source:'/editions/'+at+'/source',plan:'/editions/'+at+'/plan',
   approval:'/approval',target:'/target',pendingWrite:'/pendingWrite',attempts:'/attempts',decisions:'/decisions',imports:'/imports',issues:'/issues'},
  ...(value.reused===undefined?{}:{reused:value.reused})};
}
function originalResponse(store,value){
 if(value?.httpStatus!==undefined){
  const response=value.response;
  return {store,httpStatus:value.httpStatus,native:value.httpStatus===200?
   response?.record?orderSummary(response):response?.mapping?mappingSummary(response):response:response};
 }
 return {store,native:value?.record?orderSummary(value):value?.mapping?mappingSummary(value):value};
}
/** This class owns pending calls and read snapshots. WordPress retains the only
 * ERP journal, mapping compiler, order lock, approval and native delivery engine.
 */
export class MerchantWooErp {
 #config;#stores;#environment;#fetchImpl;#files;#pending=new Set();#closing=false;#close;
 constructor(config,{environment=process.env,fetchImpl}={}){
  need(environment&&typeof environment==='object'&&!Array.isArray(environment)&&(fetchImpl===undefined||typeof fetchImpl==='function'),
   'HOST_TRANSPORT_INVALID','Use the existing merchant host environment and its optional trusted transport.');
  this.#config=config;this.#stores=config.woocommerce?.stores??{};this.#environment=environment;this.#fetchImpl=fetchImpl;
  this.#files=new RetainedFileReads({errorPrefix:'WOO_ERP',maxSnapshotBytes:64*1024*1024});
 }
 get summary(){return {configured:Object.keys(this.#stores).length>0,pendingOperations:this.#pending.size,...this.#files.summary};}
 #store(name){
  const store=this.#stores[name];
  need(store,'STORE_NOT_FOUND','Select an original Woo store configured by the merchant host.');
  return store;
 }
 #client(store){
  const client=createMerchantClient(store.operator,{env:this.#environment,fetchImpl:this.#fetchImpl});
  need(typeof client.erpStatus==='function','NATIVE_SOURCE_REQUIRED','Install the complete original Woo ERP merchant source with its maintained client.');
  return client;
 }
 #selection(args){
  const store=this.#store(args.store);
  return {store:args.store,siteUrl:store.operator.siteUrl,kind:args.kind,id:args.id,exportId:args.exportId};
 }
 #scope(args){return [args.store,args.kind,args.id,args.exportId].join(':');}
 async #execute(name,args){
  const store=this.#store(args.store),suffix=name.slice(ERP_TOOL_PREFIX.length);
  if(suffix==='inputs')return {store:args.store,inputs:Object.entries(store.erpInputs??{}).map(([input,entry])=>({input,label:entry.label,kind:entry.kind}))};
  if(suffix==='input'){
   const selected=await loadWooErpInput(store,args.input,args.expectedSnapshotSha256);
   return {store:args.store,input:args.input,label:selected.selected.label,kind:selected.selected.kind,
    file:{bytes:selected.bytes.length,sha256:selected.sha256},
    ...(selected.selected.kind==='project'?{operationId:selected.original.operation.operationId,revision:selected.original.operation.revision,nativeSha256:selected.original.sha256}:{}),
    value:pageWooErpValue(selected.value,args,selected.sha256)};
  }
  if(suffix==='export'){
   const selection=this.#selection(args);
   const result=await retainWooErpExport(this.#config.exportsDirectory,selection,args.expectedRevision,
    ()=>args.kind==='project'?this.#client(store).erpExport(args.id):this.#client(store).erpMap(args.id));
   return wooErpExportView(result);
  }
  if(suffix==='export_manifest'){
   return wooErpExportView(await inspectWooErpExport(this.#config.exportsDirectory,this.#selection(args)));
  }
  if(suffix==='export_file'){
   const result=await inspectWooErpExport(this.#config.exportsDirectory,this.#selection(args),{verify:false});
   need(result.manifestSha256===args.expectedManifestSha256,'EXPORT_CHANGED','Use the reviewed original completion manifest.');
   const selected=args.file==='manifest.json'?{name:'manifest.json',bytes:result.bytes.length,sha256:result.manifestSha256}:result.manifest.files.find(file=>file.name===args.file);
   need(selected,'FILE_NOT_FOUND','Select a file from this complete original ERP export.');
   need(args.expectedSha256===undefined||args.expectedSha256===selected.sha256,'FILE_CHANGED','Use the original file SHA256 from this manifest.');
   need(!(args.readId||args.offset>0)||args.expectedSha256,'READ_DIGEST_REQUIRED','Repeat the file SHA256 when continuing or resuming.');
   const resultChunk=await this.#files.read({scope:this.#scope(args),key:[result.manifestSha256,args.file].join(':'),
    kind:'woo-erp-'+args.kind,directory:this.#config.exportsDirectory,readId:args.readId,expectedSha256:selected.sha256,
    offset:args.offset,limit:args.limit,
    loadFile:async()=>({path:join(result.directory,args.file),name:args.file,bytes:selected.bytes})});
   return {store:args.store,kind:args.kind,id:args.id,exportId:args.exportId,manifestSha256:result.manifestSha256,...resultChunk};
  }
  if(suffix==='export_file_release'){
   await this.#files.release(this.#scope(args),args.readId);
   return {store:args.store,kind:args.kind,id:args.id,exportId:args.exportId,released:args.readId};
  }
  if(suffix==='import_export'){
   const sourceArgs={store:args.fromStore,kind:'project',id:args.id,exportId:args.exportId};
   const source=await inspectWooErpExport(this.#config.exportsDirectory,this.#selection(sourceArgs));
   need(source.manifestSha256===args.expectedManifestSha256,'EXPORT_CHANGED','Select the reviewed original project manifest for receiving.');
   return originalResponse(args.store,await this.#client(store).erpImport(source.value));
  }
  if(suffix==='import'||suffix==='mapping_save'){
   const source=await loadWooErpInput(store,args.input,args.expectedSha256),kind=suffix==='import'?'project':'mapping';
   need(source.selected.kind===kind,'INPUT_KIND_INVALID','Select an original '+kind+' input for this operation.');
   const client=this.#client(store);
   return originalResponse(args.store,await (kind==='project'?client.erpImport(source.original):client.erpSaveMap(source.original,args.expectedCurrentMapId)));
  }
  const client=this.#client(store);
  switch(suffix){
   case 'status':{
    const status=await client.erpStatus(),{maps,selectedMap,...metadata}=status;
    return {store:args.store,native:metadata,selectedMap:selectedMap?mappingSummary(selectedMap):null,
     maps:pageWooErpValue(maps,args)};
   }
   case 'mapping':{
    const mapping=await client.erpMap(args.mapId);
    return {store:args.store,native:mappingSummary(mapping),value:pageWooErpValue(mapping,args)};
   }
   case 'mapping_select':{
    const original=await client.erpMap(args.mapId);
    return originalResponse(args.store,await client.erpSaveMap(original.mapping,args.expectedCurrentMapId));
   }
   case 'mapping_check':return originalResponse(args.store,await client.erpCheckMap(args.mapId));
   case 'orders':{
    const {store:_store,...selection}=args;
    return {store:args.store,native:await client.erpOrders(selection)};
   }
   case 'inspect':return originalResponse(args.store,await client.erpInspect(args.operationId));
   case 'read':{
    const original=await client.erpInspect(args.operationId),record=original.record;
    return {store:args.store,operationId:args.operationId,revision:record.revision,observedAt:original.observedAt,
     sourceStatus:original.sourceStatus,value:pageWooErpValue(record,args)};
   }
   case 'prepare':{
    const {store:_store,...body}=args;
    return originalResponse(args.store,await client.erpPrepare(body));
   }
   default:{
    const methods={approve:'erpApprove',deliver:'erpDeliver',reconcile:'erpReconcile',identify_target:'erpIdentifyTarget',
     authorize_retry:'erpAuthorizeRetry',bind_import:'erpBindImport'};
    const method=methods[suffix];
    need(method,'TOOL_NOT_FOUND','Select an original Woo ERP operation.');
    const {store:_store,operationId,confirmOperationEnded,...body}=args;
    if(suffix==='identify_target'&&confirmOperationEnded!==undefined)body.confirmOperationEnded=confirmOperationEnded;
    return originalResponse(args.store,await client[method](operationId,body));
   }
  }
 }
 async call(name,args={}){
  need(!this.#closing,'CLOSING','The original Woo ERP connection is closing.');
  validateWooErpArguments(name,args);
  const pending=this.#execute(name,args);this.#pending.add(pending);
  try{return await pending;}
  catch(error){
   if(typeof error?.code==='string'&&/^WOO_ERP_[A-Z0-9_]+$/.test(error.code))throw error;
   throw erpFailure('OPERATION_FAILED','The original ERP operation did not return a complete result. Inspect the same native order, input or export before repeating a change.');
  }finally{this.#pending.delete(pending);}
 }
 close(){
  if(!this.#close){
   this.#closing=true;
   this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#files.close();})();
  }
  return this.#close;
 }
}
