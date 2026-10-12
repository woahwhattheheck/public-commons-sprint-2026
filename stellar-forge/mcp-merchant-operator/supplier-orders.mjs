// MIT. Agent operations over the original supplier-order workspace and file store.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { failure, identifier } from './host-files.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { validateSupplierOrderArguments, supplierOrderPlain,
  SUPPLIER_ORDER_REPLY_BYTES, SUPPLIER_ORDER_EXPORT_SCHEMA, SUPPLIER_ORDER_EXPORT_MANIFEST,
  supplierOrderDownloadName, parseSupplierOrderExportManifest } from './supplier-order-contracts.mjs';
import { readSupplierOrderDraftInput, supplierOrderInputSummary } from './supplier-order-connection.mjs';
export { readSupplierOrderWorkspaceConfiguration, initializeSupplierOrderMerchant } from './supplier-order-connection.mjs';

const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
const omit=(value,keys)=>Object.fromEntries(Object.entries(value??{}).filter(([key])=>!keys.includes(key)));
const size=value=>Buffer.byteLength(JSON.stringify(value));
const PREFIX='merchant_supplier_order_';
function fullReply(value,label){
  if(!supplierOrderPlain(value))throw failure('SUPPLIER_ORDER_REPLY_INVALID','The original '+label+' returned no structured record.');
  if(size(value)>SUPPLIER_ORDER_REPLY_BYTES)throw Object.assign(failure('SUPPLIER_ORDER_RECORD_TOO_LARGE',
    'The complete '+label+' exceeds the1 MiB response limit. Use its full paged lines/history or the original XML/customer ZIP export.'),{
      details:{record:pick(value,['id','orderId','draftId','revision','schema']),
        routes:['merchant_supplier_order_order_items','merchant_supplier_order_document_lines','merchant_supplier_order_draft_lines','merchant_supplier_order_export_workspace']}});
  return value;
}
function sourceView(value){return value?omit(value,['path','sourcePath']):value;}
function reviewSummary(value){
  if(!value)return value;
  return{...pick(value,['schema','errors','warnings','valid','net','tax','gross']),findingsCount:value.findings?.length??0,
    ...(value.findings?.length?{fullFindingsRetained:true}:{})};
}
function documentSummary(value){
  return{...pick(value,['id','revision','businessKey','kind','documentId','orderIds','referencedOrderIds','sha256','direction','draftId','draftRevision','createdAt']),
    source:sourceView(value.source),review:reviewSummary(value.review)};
}
function draftSummary(value){
  return{...pick(value,['id','revision','kind','title','orderIds','orderRevisions','orderStateSha256','sourceOrderDocuments','reason','createdAt','updatedAt','sha256']),
    review:reviewSummary(value.review)};
}
function orderSummary(value){
  return{...pick(value,['orderId','revision','stateSha256','status','itemCount','totals']),
    header:pick(value.header,['date','currency','supplierOrderId','supplierId','deliveryDate']),
    findingsCount:value.findings?.length??0,fullOrderRetained:true};
}
function fileView(value){return pick(value,['id','name','bytes','sha256','mimeType','kind','createdAt']);}
function boundedError(error){
  if(!error)return error;
  return{code:String(error.code??'ORDER_OPERATION_FAILED').slice(0,160),
    message:String(error.message??'The original operation failed.').slice(0,8192),
    ...(error.details===undefined?{}:size(error.details)<=32768?{details:error.details}:{detailsRetained:true})};
}
/** A committed write always returns its native identity even when the complete result is large. */
export function projectSupplierOrderOperation(operation,{includeRequest=false}={}){
  if(!supplierOrderPlain(operation))throw failure('SUPPLIER_ORDER_OPERATION_NOT_FOUND','Original supplier-order operation not found.');
  const visible=omit(operation,includeRequest?['owner','context']:['owner','context','request']);
  if(size(visible)<=SUPPLIER_ORDER_REPLY_BYTES)return visible;
  const result=operation.result??{},summary={
    ...pick(result,['documentId','draftId','revision']),
    ...(Array.isArray(result.orderIds)?{orderCount:result.orderIds.length,
      ...(size(result.orderIds)<=65536?{orderIds:result.orderIds}:{})}:{}),
    ...(result.file?{file:fileView(result.file)}:{}),
    ...(result.document?{document:pick(result.document,['id','kind','documentId','revision','sha256'])}:{}),
    ...(result.draft?{draft:pick(result.draft,['id','kind','title','revision','sha256'])}:{})
  };
  const retained={...pick(operation,['id','kind','state','requestSha256','requestContentSha256','createdAt','updatedAt']),
    ...(operation.error?{error:boundedError(operation.error)}:{}),
    result:summary,resultSummary:true,fullResultRetained:true,
    ...(includeRequest?{requestRetained:true}:{}),
    receiving:{tool:'merchant_supplier_order_export_workspace',originalRequestId:operation.id,
      note:'The complete native operation and document history remain in the original workspace and whole customer ZIP.'}};
  return fullReply(retained,'original operation identity');
}
function boundedPage(page,{offset=0,limit=50}={},project=value=>value,extra={}){
  const result={...extra,items:[],total:page.total,offset,limit,nextOffset:null};
  const available=page.items??[];
  for(const value of available){
    const item=project(value),next={...result,items:[...result.items,item],nextOffset:offset+result.items.length+1<page.total?offset+result.items.length+1:null};
    if(size(next)>SUPPLIER_ORDER_REPLY_BYTES){
      if(!result.items.length)throw Object.assign(failure('SUPPLIER_ORDER_RECORD_TOO_LARGE',
        'One complete original record exceeds the1 MiB page limit. Use the original XML or full customer ZIP.'),{
          details:{offset,total:page.total,record:pick(item,['id','lineId','orderId','revision']),fullRecordRetained:true}});
      break;
    }
    result.items.push(item);
  }
  result.nextOffset=offset+result.items.length<page.total?offset+result.items.length:null;
  if(result.nextOffset!==null&&result.nextOffset<=offset)
    throw failure('SUPPLIER_ORDER_PAGE_INVALID','The original page did not advance. Reopen its current selection.');
  return fullReply(result,'original page');
}
function arrayPage(values,args,extra){
  const offset=args.offset??0,limit=args.limit??50;
  return boundedPage({items:values.slice(offset,offset+limit),total:values.length},{offset,limit},value=>value,extra);
}
export class MerchantSupplierOrders {
  #config;#handles=new Map();#pending=new Map();#closingAliases=new Map();#closing=false;#close;
  #files=new RetainedFileReads({errorPrefix:'SUPPLIER_ORDER'});#readExports=new Map();
  constructor(config){this.#config=config;}
  get summary(){
    const aliases=this.#config.supplierOrderWorkspaces?.workspaces??{};
    return{configured:Object.keys(aliases).length>0,count:Object.keys(aliases).length,opened:[...this.#handles.keys()],
      pending:this.#pending.size,closing:this.#closing,...this.#files.summary};
  }
  #entry(alias){
    identifier(alias,'Supplier-order workspace alias');
    const entry=this.#config.supplierOrderWorkspaces?.workspaces?.[alias];
    if(!entry)throw failure('SUPPLIER_ORDER_NOT_CONFIGURED','Choose a configured alias from merchant_supplier_order_status.');
    return entry;
  }
  #input(entry,inputId,kind){
    const input=entry.inputs[inputId];
    if(!input||input.kind!==kind)throw failure('SUPPLIER_ORDER_INPUT_KIND','Select a declared '+kind+' input from merchant_supplier_order_inputs.');
    return input;
  }
  async #status(alias){
    if(alias===undefined)return{...this.summary,workspaces:Object.entries(this.#config.supplierOrderWorkspaces?.workspaces??{}).map(([workspace,entry])=>
      ({workspace,label:entry.label,state:this.#closingAliases.has(workspace)?'CLOSING':this.#handles.has(workspace)?'OPEN':'CLOSED'}))};
    const entry=this.#entry(alias),handle=this.#handles.get(alias);
    if(!handle)return{workspace:alias,label:entry.label,state:'CLOSED'};
    const model=await handle;
    return{workspace:alias,label:entry.label,state:this.#closingAliases.has(alias)?'CLOSING':'OPEN',workspaceId:model.store.id,
      activeOperations:model.active?.size??0,reads:this.#files.status(alias)};
  }
  async #open(alias){
    const entry=this.#entry(alias);
    if(!this.#handles.has(alias)){
      const pending=(async()=>{const {openSupplierOrderWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/workspace.mjs');
        return openSupplierOrderWorkspace({directory:entry.directory});})();
      this.#handles.set(alias,pending);
      try{await pending;}catch(error){if(this.#handles.get(alias)===pending)this.#handles.delete(alias);throw error;}
    }
    return this.#status(alias);
  }
  #closeAlias(alias){
    if(this.#closingAliases.has(alias))return this.#closingAliases.get(alias);
    this.#entry(alias);
    const accepted=[...this.#pending].filter(([,selected])=>selected===alias).map(([task])=>task);
    const task=(async()=>{
      await Promise.allSettled(accepted);await this.#files.closeScope(alias);
      for(const key of this.#readExports.keys())if(key.startsWith(alias+':'))this.#readExports.delete(key);
      const handle=this.#handles.get(alias);
      if(handle){await(await handle).close();if(this.#handles.get(alias)===handle)this.#handles.delete(alias);}
      return{workspace:alias,state:'CLOSED'};
    })().finally(()=>this.#closingAliases.delete(alias));
    this.#closingAliases.set(alias,task);return task;
  }
  async #manifest(model,exportId){
    const native=await model.file({id:exportId}),name=supplierOrderDownloadName(native);
    const manifest={schema:SUPPLIER_ORDER_EXPORT_SCHEMA,exportId:native.id,workspaceId:model.store.id,kind:native.kind,createdAt:native.createdAt,
      files:[{id:native.id,name,originalName:native.name,bytes:native.bytes,sha256:native.sha256,type:native.mimeType}]};
    const body=bytes(manifest);parseSupplierOrderExportManifest(body,exportId);
    return{native,manifest,body,manifestSha256:hash(body),
      manifestFile:{name:SUPPLIER_ORDER_EXPORT_MANIFEST,bytes:body.length,sha256:hash(body)}};
  }
  async #readFile(model,entry,args){
    const selected=await this.#manifest(model,args.exportId);
    if(args.expectedManifestSha256!==selected.manifestSha256)throw failure('SUPPLIER_ORDER_MANIFEST_CHANGED','Use the original retained manifest SHA-256.');
    const original=args.file===SUPPLIER_ORDER_EXPORT_MANIFEST?selected.manifestFile:selected.manifest.files.find(file=>file.name===args.file);
    if(!original||args.expectedSha256!==original.sha256)throw failure('SUPPLIER_ORDER_FILE_CHANGED','Read one complete original manifest member with its exact SHA-256.');
    const load=async()=>{
      if(args.file===SUPPLIER_ORDER_EXPORT_MANIFEST)return{bytes:selected.body,name:SUPPLIER_ORDER_EXPORT_MANIFEST,type:'application/json'};
      const file=await open(selected.native.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      let transferred=false;
      try{
        const info=await file.stat();
        if(!info.isFile()||info.size!==original.bytes)throw failure('SUPPLIER_ORDER_FILE_CHANGED','The original retained file differs from its manifest.');
        transferred=true;return{readonlyFileHandle:file,bytes:original.bytes,sha256:original.sha256,name:original.name,type:original.type};
      }finally{if(!transferred)await file.close();}
    };
    const result=await this.#files.read({scope:args.workspace,key:JSON.stringify({exportId:args.exportId,file:args.file,manifestSha256:selected.manifestSha256}),
      kind:'supplier-order-export',directory:entry.directory,load,...pick(args,['readId','offset','limit','expectedSha256'])});
    if(result.readId){const key=args.workspace+':'+result.readId;if(result.nextOffset===null)this.#readExports.delete(key);else this.#readExports.set(key,args.exportId);}
    return{exportId:args.exportId,manifestSha256:selected.manifestSha256,...result};
  }
  async #execute(name,args){
    const suffix=name.slice(PREFIX.length);
    if(suffix==='status')return this.#status(args.workspace);
    if(suffix==='open')return this.#open(args.workspace);
    const entry=this.#entry(args.workspace);
    if(suffix==='inputs')return fullReply({workspace:args.workspace,inputs:Object.entries(entry.inputs).map(([id,input])=>supplierOrderInputSummary(id,input))},'configured inputs');
    const handle=this.#handles.get(args.workspace);
    if(!handle)throw failure('SUPPLIER_ORDER_CLOSED','Open this original workspace with merchant_supplier_order_open.');
    const model=await handle,selected=omit(args,['workspace']);
    switch(suffix){
      case 'state':{
        const value=await model.state();
        const view={...omit(value,['drafts','operations']),drafts:(value.drafts??[]).map(draftSummary),
          operations:(value.operations??[]).map(operation=>projectSupplierOrderOperation(operation))};
        if(size(view)<=SUPPLIER_ORDER_REPLY_BYTES)return view;
        return fullReply({...pick(value,['schema','workspaceId','profileId','supplierIdentity','counts']),summary:true,
          originalCollectionsRetained:true,collections:{orders:'merchant_supplier_order_orders',drafts:'merchant_supplier_order_drafts',documents:'merchant_supplier_order_documents'},
          operations:(value.operations??[]).map(operation=>pick(operation,['id','kind','state','requestSha256','createdAt','updatedAt']))},'workspace summary');
      }
      case 'orders':return boundedPage(await model.orders(selected),selected,orderSummary);
      case 'order':return fullReply(await model.order(selected),'original order');
      case 'order_items':{
        const value=await model.order({orderId:args.orderId});
        return arrayPage(value.items,selected,{orderId:value.orderId,revision:value.revision,stateSha256:value.stateSha256});
      }
      case 'order_history':{
        const value=await model.order({orderId:args.orderId});
        return arrayPage(value.history??[],selected,{orderId:value.orderId,revision:value.revision,stateSha256:value.stateSha256});
      }
      case 'documents':return boundedPage(await model.documents(selected),selected,documentSummary);
      case 'document':return fullReply(await model.document(selected),'original source document');
      case 'document_lines':{
        const value=await model.document({id:args.id});
        return arrayPage(value.document.items,selected,{id:value.id,revision:value.revision,sha256:value.sha256,source:sourceView(value.source)});
      }
      case 'drafts':return boundedPage(await model.drafts(selected),selected,draftSummary);
      case 'draft':return fullReply(await model.draft(selected),'saved draft');
      case 'draft_lines':{
        const value=await model.draft({draftId:args.draftId});
        return arrayPage(value.document.items,selected,{draftId:value.id,revision:value.revision,sha256:value.sha256});
      }
      case 'new_draft':return fullReply(await model.newDraft(selected),'complete original working document');
      case 'save_draft':return projectSupplierOrderOperation(await model.saveDraft(selected));
      case 'save_draft_input':{
        const input=this.#input(entry,args.inputId,'draft'),request=await readSupplierOrderDraftInput(input);
        if(!supplierOrderPlain(request)||request.requestId!==undefined&&request.requestId!==args.requestId)
          throw failure('SUPPLIER_ORDER_INPUT_REQUEST_DIFFERS','Keep the exact original requestId when receiving a complete native draft.');
        if(Object.hasOwn(request,'workspace'))throw failure('SUPPLIER_ORDER_INPUT_WORKSPACE','The host alias selects this native workspace; remove workspace from the original draft input.');
        const complete=validateSupplierOrderArguments(PREFIX+'save_draft',{...request,requestId:args.requestId,workspace:args.workspace},{maximumBytes:64*1024*1024});
        return projectSupplierOrderOperation(await model.saveDraft(omit(complete,['workspace'])));
      }
      case 'prepare':return projectSupplierOrderOperation(await model.prepareDocument(selected));
      case 'select':return projectSupplierOrderOperation(await model.selectDocument(selected));
      case 'receive':{
        const input=this.#input(entry,args.inputId,'xml');
        return projectSupplierOrderOperation(await model.importDocument({...omit(selected,['inputId']),sourcePath:input.path,name:input.name,
          provenance:clone(input.provenance??{}),expectedBytes:input.bytes,expectedSha256:input.sha256}));
      }
      case 'receive_workspace':{
        const input=this.#input(entry,args.inputId,'workspace');
        return projectSupplierOrderOperation(await model.importWorkspace({...omit(selected,['inputId']),path:input.path,name:input.name,
          expectedBytes:input.bytes,expectedSha256:input.sha256}));
      }
      case 'export_workspace':return projectSupplierOrderOperation(await model.exportWorkspace(selected));
      case 'operation':return projectSupplierOrderOperation(await model.operation({requestId:args.requestId}),{includeRequest:args.includeRequest??false});
      case 'export_manifest':{
        const value=await this.#manifest(model,args.exportId);
        return{state:'MANIFEST_RETAINED',exportId:args.exportId,manifestFile:value.manifestFile,manifestSha256:value.manifestSha256,manifest:value.manifest};
      }
      case 'export_file':return this.#readFile(model,entry,args);
      case 'export_file_release':{
        const key=args.workspace+':'+args.readId,exportId=this.#readExports.get(key);
        if(exportId!==undefined&&exportId!==args.exportId)throw failure('SUPPLIER_ORDER_READ_DIFFERENT_EXPORT','Release the original file read from its selected export.');
        await this.#files.release(args.workspace,args.readId);this.#readExports.delete(key);
        return{exportId:args.exportId,readId:args.readId,released:true};
      }
      default:throw failure('METHOD_NOT_FOUND','Unknown supplier-order tool.');
    }
  }
  call(name,args={}){
    if(this.#closing)return Promise.reject(failure('SUPPLIER_ORDER_CLOSING','The supplier-order provider is closing.'));
    try{
      const selected=validateSupplierOrderArguments(name,args);
      if(selected.workspace!==undefined)this.#entry(selected.workspace);
      if(name!==PREFIX+'close'&&selected.workspace!==undefined&&this.#closingAliases.has(selected.workspace))
        throw failure('SUPPLIER_ORDER_CLOSING','This original workspace handle is closing; reopen after it finishes.');
      const task=name===PREFIX+'close'?this.#closeAlias(selected.workspace):this.#execute(name,selected);
      this.#pending.set(task,selected.workspace);
      void task.finally(()=>this.#pending.delete(task)).catch(()=>{});
      return task;
    }catch(error){return Promise.reject(error);}
  }
  close(){
    if(this.#close)return this.#close;
    this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending.keys()]);await this.#files.close();this.#readExports.clear();
      const results=await Promise.allSettled([...this.#handles].map(async([alias,handle])=>{
        await(await handle).close();if(this.#handles.get(alias)===handle)this.#handles.delete(alias);}));
      const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    })().catch(error=>{this.#close=null;throw error;});
    return this.#close;
  }
}
