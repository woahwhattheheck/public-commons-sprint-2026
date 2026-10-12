// MIT. Complete paid Research operations on the original merchant attachment.
import {readdir,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {exact} from './host-files.mjs';
import {RESEARCH_COMMERCE_PREFIX} from './catalog/research-commerce.mjs';
import {COMMERCE_SCHEMA,PUBLICATION_LIMIT,CONTROL_LIMIT,UUID,identifier,hash,copy,same,fingerprint,need,publicPublication}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/contracts.mjs';
import {withCustomerOperation,optionalJson,retainCustomerJson,retainCustomerBytes,
 jsonBytes,digest,exists}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/files.mjs';
import {submitResearchCommerce,replayResearchCommerce,readResearchCommerceOperation,retainResearchCommerceFile}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/operator.mjs';
import {copyCustomerFile}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-updates/files.mjs';
import {readResearchHostFile}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-files.mjs';

export {RESEARCH_COMMERCE_PREFIX} from './catalog/research-commerce.mjs';
const SCHEMA='stellar-forge.research-commerce-merchant-operation.v1';
const nativePrefix='merchant_research_commerce_';
const writes=Object.freeze({
 publication_prepare:'publication-prepare',publication_enroll:'publication-enroll',
 purchase_prepare:'purchase-prepare',purchase_execute:'purchase-execute',
 purchase_retrieve:'purchase-retrieve',purchase_recover:'purchase-recover',
 purchase_finalize:'purchase-finalize',purchase_cancel:'purchase-cancel',
 purchase_reconcile:'purchase-reconcile',purchase_receive_dossier:'purchase-receive-dossier',
});
const selected=(value,removed)=>Object.fromEntries(Object.entries(value).filter(([key])=>!removed.includes(key)));
const partial=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const expectedWorkspace=value=>need(/^research_[a-f0-9]{64}$/.test(value??''),'RESEARCH_COMMERCE_ORIGINAL_WORKSPACE_REQUIRED');
function selectionRecord(selection){
 const value={schema:SCHEMA,selection,selectionSha256:fingerprint(selection)};
 need(jsonBytes(value).length<=CONTROL_LIMIT,'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');return value;
}
function validRecord(value,workspaceId,operationId){
 need(value?.schema===SCHEMA&&value.selectionSha256===fingerprint(value.selection)&&
  value.selection.workspaceId===workspaceId&&value.selection.operationId===operationId&&
  ['WRITE','REPLAY'].includes(value.selection.kind),'RESEARCH_COMMERCE_MERCHANT_OPERATION_CHANGED');
 identifier(operationId);return value;
}
function capturedInput(value,selection){
 need(value?.schema==='stellar-forge.research-commerce-merchant-input.v1'&&
  value.selectionSha256===fingerprint(selection)&&value.inputSha256===fingerprint(value.input),
  'RESEARCH_COMMERCE_MERCHANT_INPUT_CHANGED');
 if(selection.command==='purchase-receive'){
  const input=value.input,source=selection.selector;
  exact(input,['requestId','buyer','filename','base64'],['requestId','buyer','filename','base64']);
  need(input.requestId===source.requestId&&input.buyer===source.buyer&&typeof input.base64==='string'&&
   input.base64.length<=4*Math.ceil(PUBLICATION_LIMIT/3),'RESEARCH_COMMERCE_MERCHANT_INPUT_CHANGED');
  const bytes=Buffer.from(input.base64,'base64');
  need(bytes.length>0&&bytes.length<=PUBLICATION_LIMIT&&bytes.toString('base64')===input.base64&&
   digest(bytes)===source.publicationSha256,'RESEARCH_COMMERCE_MERCHANT_INPUT_CHANGED');
  publicPublication(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 }else need(same(value.input,selection.selector),'RESEARCH_COMMERCE_MERCHANT_INPUT_CHANGED');
 return value.input;
}
function receipt(value,record){
 need(value?.schema==='sf88-research-commerce-operator-result/v1'&&value.workspaceId===record.selection.workspaceId&&
  value.result?.schema===COMMERCE_SCHEMA&&value.resultSha256===fingerprint(value.result),
  'RESEARCH_COMMERCE_MERCHANT_RESULT_CHANGED');
 return {schema:SCHEMA,workspaceId:value.workspaceId,operationId:record.selection.operationId,
  operationSha256:record.selectionSha256,kind:record.selection.kind,
  command:record.selection.command??null,sourceOperationId:record.selection.sourceOperationId??null,
  status:'COMPLETE',requestSha256:value.requestSha256,resultSha256:value.resultSha256,
  completedAt:value.completedAt,reused:value.reused,result:value.result};
}

/**
 * Its client and listener belong to the existing Research attachment. Files live
 * only under that attachment's declared private exports directory. The original
 * commerce operator retains every complete native input and first native reply.
 */
export class ResearchCommerceOperations{
 #client;#directory;#workspaceId;#source;#retainedPublication;#failedOwners=new Set();#pending=new Set();#closed=false;#closing;
 constructor({client,directory,workspaceId,source,retainedPublication}={}){
  expectedWorkspace(workspaceId);
  need(client&&typeof client.customerCommerce==='function'&&typeof directory==='string',
   'RESEARCH_COMMERCE_ORIGINAL_CLIENT_REQUIRED');
  this.#client=client;this.#directory=directory;this.#workspaceId=workspaceId;
  this.#source=source;this.#retainedPublication=retainedPublication;
 }
 #root(id){identifier(id);return join(this.#directory,'operations',id);}
 #owned(work){
  need(!this.#closed,'RESEARCH_COMMERCE_MERCHANT_CLOSED');
  const pending=Promise.resolve().then(work);this.#pending.add(pending);
  return pending.catch(error=>{
   if(typeof error?.close==='function')this.#failedOwners.add(error);throw error;
  }).finally(()=>this.#pending.delete(pending));
 }
 async #read(id){
  const root=this.#root(id);
  need(await exists(root),'RESEARCH_COMMERCE_MERCHANT_OPERATION_NOT_FOUND');
  return withCustomerOperation(root,async directory=>{
   const saved=validRecord(await optionalJson(directory,'agent.json',CONTROL_LIMIT),this.#workspaceId,id);
   const input=await optionalJson(directory,'native-input.json',CONTROL_LIMIT);
   if(input)capturedInput(input,saved.selection);
   return {root:directory,record:saved,input};
  });
 }
 async #prepare(selection,makeInput){
  const root=this.#root(selection.operationId),record=selectionRecord(selection);
  return withCustomerOperation(root,async directory=>{
   const old=await optionalJson(directory,'agent.json',CONTROL_LIMIT);
   if(old){validRecord(old,this.#workspaceId,selection.operationId);
    need(same(old,record),'RESEARCH_COMMERCE_MERCHANT_OPERATION_CHANGED');}
   else await retainCustomerJson(directory,'agent.json',record);
   if(selection.kind==='REPLAY')return {root:directory,record};
   let value=await optionalJson(directory,'native-input.json',CONTROL_LIMIT);
   if(!value){
    const input=await makeInput();
    value={schema:'stellar-forge.research-commerce-merchant-input.v1',
     selectionSha256:record.selectionSha256,inputSha256:fingerprint(input),input};
    capturedInput(value,selection);
    need(jsonBytes(value).length<=CONTROL_LIMIT,'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');
    await retainCustomerJson(directory,'native-input.json',value);
   }
   return {root:directory,record,input:copy(capturedInput(value,selection))};
  });
 }
 async #publicationInput(selector){
  exact(selector,['requestId','buyer','publicationSha256','source','fromWorkspace','exportId'],
   ['requestId','buyer','publicationSha256']);
  identifier(selector.requestId);hash(selector.publicationSha256);
  need((selector.source!==undefined)!==(selector.exportId!==undefined),
   'RESEARCH_COMMERCE_SELECT_ONE_PUBLICATION');
  need(selector.source===undefined||selector.fromWorkspace===undefined,
   'RESEARCH_COMMERCE_SOURCE_WORKSPACE_INVALID');
  const consume=async item=>{
   need(item.sha256===selector.publicationSha256,'RESEARCH_COMMERCE_PUBLICATION_CHANGED');
   const body=await readResearchHostFile(item.file,PUBLICATION_LIMIT,{sha256:selector.publicationSha256});
   need(body.length>0&&body.length<=PUBLICATION_LIMIT&&
    (item.bytes===undefined||item.bytes===body.length),'RESEARCH_COMMERCE_PUBLICATION_CHANGED');
   publicPublication(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));
   return {requestId:selector.requestId,buyer:selector.buyer,
    filename:item.filename??basename(item.file),base64:body.toString('base64')};
  };
  if(selector.source!==undefined){
   need(typeof this.#source==='function','RESEARCH_COMMERCE_SOURCE_REQUIRED');
   return consume(this.#source(selector.source,['commerce-publication']));
  }
  need(typeof this.#retainedPublication==='function'&&selector.exportId===selector.publicationSha256,
   'RESEARCH_COMMERCE_RETAINED_PUBLICATION_REQUIRED');
  return this.#retainedPublication(selector.fromWorkspace,selector.exportId,consume);
 }
 async #write(command,operationId,selector){
  const selection={workspaceId:this.#workspaceId,operationId,kind:'WRITE',command,selector:copy(selector)};
  const saved=await this.#prepare(selection,()=>command==='purchase-receive'?
   this.#publicationInput(selector):copy(selector));
  const result=await submitResearchCommerce({client:this.#client,directory:join(saved.root,'native'),
   command,input:saved.input});
  return receipt(result,saved.record);
 }
 async #replay(operationId,sourceOperationId){
  identifier(operationId);identifier(sourceOperationId);
  need(operationId!==sourceOperationId,'RESEARCH_COMMERCE_REPLAY_DIRECTORY_REQUIRED');
  const selection={workspaceId:this.#workspaceId,operationId,kind:'REPLAY',sourceOperationId};
  const saved=await this.#prepare(selection),native=join(saved.root,'native');
  // The replay owns its full copied request before its first native dispatch.
  // Resume that same retained request even when the older operation moved.
  if(await exists(join(native,'request.json')))
   return receipt(await submitResearchCommerce({client:this.#client,directory:native}),saved.record);
  const source=await this.#read(sourceOperationId),sourceNative=join(source.root,'native');
  // A retained source input can precede native request publication. The distinct
  // replay still owns that exact original request; it must not recapture a donor.
  const result=await exists(join(sourceNative,'request.json'))?
   await replayResearchCommerce({client:this.#client,directory:native,sourceDirectory:sourceNative}):
   (need(source.record.selection.kind==='WRITE'&&source.input,
     'RESEARCH_COMMERCE_REPLAY_SOURCE_NOT_CAPTURED'),
    await submitResearchCommerce({client:this.#client,directory:native,
     command:source.record.selection.command,
     input:copy(capturedInput(source.input,source.record.selection))}));
  return receipt(result,saved.record);
 }
 async #resume(operationId){
  const original=await this.#read(operationId),selected=original.record.selection;
  if(selected.kind==='REPLAY')return this.#replay(operationId,selected.sourceOperationId);
  return this.#write(selected.command,operationId,selected.selector);
 }
 async #inspect(operationId){
  const original=await this.#read(operationId),directory=join(original.root,'native');
  const native=await exists(directory)?await withCustomerOperation(directory,()=>readResearchCommerceOperation(directory)):null;
  if(native?.files['request.json'])
   need(native.files['request.json'].workspaceId===this.#workspaceId,'RESEARCH_COMMERCE_RECEIVING_WORKSPACE_CHANGED');
  const result=native?.files['result.json'];
  if(result){
   const request=native.files['request.json'];
   need(request&&result.requestSha256===request.requestSha256&&result.result?.id===request.selection.id,
    'RESEARCH_COMMERCE_MERCHANT_RESULT_CHANGED');
   if(original.record.selection.kind==='WRITE')need(original.input&&
    request.selection.command===original.record.selection.command&&
    same(request.selection.input,capturedInput(original.input,original.record.selection)),
    'RESEARCH_COMMERCE_MERCHANT_RESULT_CHANGED');
   return {record:original.record,capturedInput:original.input,native,view:receipt({...result,reused:true},original.record)};
  }
  return {record:original.record,capturedInput:original.input,native,view:{schema:SCHEMA,workspaceId:this.#workspaceId,
   operationId,operationSha256:original.record.selectionSha256,kind:original.record.selection.kind,
   command:original.record.selection.command??null,sourceOperationId:original.record.selection.sourceOperationId??null,
   status:original.input?'INPUT_RETAINED':'SELECTION_RETAINED',
   nativeRequest:native?.files['request.json']?partial(native.files['request.json'],
    ['schema','workspaceId','requestSha256','input','createdAt']):null}};
 }
 async #operations({offset=0,limit=30,snapshot}={}){
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
   'RESEARCH_COMMERCE_PAGE_INVALID');
  const directory=join(this.#directory,'operations');
  const names=await exists(directory)?(await readdir(directory)).filter(name=>UUID.test(name)).sort():[];
  need(names.length<=10000,'RESEARCH_COMMERCE_LIBRARY_LIMIT');
  const items=[],errors=[];
  for(const operationId of names)try{
   const root=this.#root(operationId),saved=validRecord(
    await optionalJson(root,'agent.json',CONTROL_LIMIT),this.#workspaceId,operationId);
   const selected=saved.selection,path=join(root,'native','result.json');
   let complete=false;
   if(await exists(path)){const stat=await lstat(path);
    need(stat.isFile()&&!stat.isSymbolicLink(),'RESEARCH_COMMERCE_MERCHANT_RESULT_CHANGED');complete=true;}
   items.push({operationId,kind:selected.kind,command:selected.command??null,
    recordId:selected.selector?.id??selected.selector?.requestId??null,
    sourceOperationId:selected.sourceOperationId??null,
    operationSha256:saved.selectionSha256,status:complete?'COMPLETE':'RETAINED'});
  }catch(error){errors.push({operationId,code:error.code??'RESEARCH_COMMERCE_MERCHANT_OPERATION_UNAVAILABLE'});}
  const current=fingerprint({items,errors});
  need((offset===0||snapshot===current)&&(snapshot===undefined||snapshot===current),'RESEARCH_COMMERCE_INVENTORY_CHANGED');
  need(offset<=items.length,'RESEARCH_COMMERCE_PAGE_INVALID');
  const page=items.slice(offset,offset+limit),nextOffset=offset+page.length;
  return {schema:SCHEMA,workspaceId:this.#workspaceId,snapshot:current,offset,limit,total:items.length,
   items:page,errors,nextOffset:nextOffset<items.length?nextOffset:null};
 }
 call(name,args={}){
  const selectedArgs=copy(args),operation=name.slice(nativePrefix.length);
  return this.#owned(async()=>{
   need(name.startsWith(RESEARCH_COMMERCE_PREFIX),'RESEARCH_COMMERCE_COMMAND_INVALID');
   const a=selected(selectedArgs,['workspace']),api=this.#client.customerCommerce();
   if(operation==='configuration'){exact(a,[],[]);return api.configuration();}
   if(operation==='library'){exact(a,['kind','offset','limit','snapshot'],['kind']);
    need(!(a.offset>0)||a.snapshot!==undefined,'RESEARCH_COMMERCE_INVENTORY_CHANGED');
    return api.list(a.kind,partial(a,['offset','limit','snapshot']));}
   if(operation==='publication'){exact(a,['id'],['id']);return api.publication(a.id);}
   if(operation==='purchase'){exact(a,['id','refresh'],['id']);return api.purchase(a.id,{refresh:a.refresh??false});}
   if(operation==='file'){exact(a,['kind','id','part'],['kind','id','part']);return api.file(a.kind,a.id,a.part);}
   if(operation==='operations'){exact(a,['offset','limit','snapshot'],[]);
    return this.#operations(a);}
   if(operation==='operation'){exact(a,['operationId'],['operationId']);return (await this.#inspect(a.operationId)).view;}
   if(operation==='resume'){exact(a,['operationId'],['operationId']);return this.#resume(a.operationId);}
   if(operation==='replay'){exact(a,['operationId','sourceOperationId'],['operationId','sourceOperationId']);
    return this.#replay(a.operationId,a.sourceOperationId);}
   if(operation==='purchase_receive'){
    const selector=selected(a,['operationId']);
    return this.#write('purchase-receive',a.operationId,selector);
   }
   const command=writes[operation];
   need(command,'RESEARCH_COMMERCE_COMMAND_INVALID');
   return this.#write(command,a.operationId,selected(a,['operationId']));
  });
 }
 export(args,{file}={}){
  const selectedArgs=copy(args);
  return this.#owned(async()=>{
   const a=selected(selectedArgs,['workspace']),kind=a.kind;
   if(kind==='commerce-operation-json'){
    exact(a,['kind','commerceOperationId','expectedSha256'],['kind','commerceOperationId']);
    const inspected=await this.#inspect(a.commerceOperationId);
    const value={schema:SCHEMA,workspaceId:this.#workspaceId,record:inspected.record,
     capturedInput:inspected.capturedInput,native:inspected.native,view:inspected.view},body=jsonBytes(value),sha256=digest(body);
    if(a.expectedSha256!==undefined)need(a.expectedSha256===sha256,'RESEARCH_COMMERCE_EXPORT_CHANGED');
    const root=join(this.#directory,'snapshots',sha256);
    await withCustomerOperation(root,directory=>retainCustomerBytes(directory,'operation.json',body));
    const source=join(root,'operation.json');
    await copyCustomerFile(source,file,{sha256,bytes:body.length});
    return {result:{filename:'research-commerce-operation.json',contentType:'application/json',
     bytes:body.length,sha256},selection:{workspaceId:this.#workspaceId,
      commerceOperationId:a.commerceOperationId,operationSha256:inspected.record.selectionSha256}};
   }
   const parts={'commerce-publication':'publication','commerce-handoff':'handoff',
    'commerce-archive':'archive','commerce-received':'received'},part=parts[kind];
   need(part,'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');
   exact(a,['kind','commerceKind','commerceId','expectedSha256'],
    ['kind','commerceKind','commerceId','expectedSha256']);
   hash(a.expectedSha256);identifier(a.commerceId);
   const selection={kind:a.commerceKind,id:a.commerceId,part,expectedSha256:a.expectedSha256};
   const directory=join(this.#directory,'exports',fingerprint(selection));
   const retained=await retainResearchCommerceFile({client:this.#client,directory,...selection});
   need(retained.workspaceId===this.#workspaceId,'RESEARCH_COMMERCE_RECEIVING_WORKSPACE_CHANGED');
   await copyCustomerFile(retained.file.path,file,{sha256:retained.file.sha256,bytes:retained.file.bytes});
   return {result:{filename:retained.file.name,contentType:retained.file.contentType,
    sha256:retained.file.sha256,bytes:retained.file.bytes},
    selection:{workspaceId:this.#workspaceId,commerceKind:a.commerceKind,
     commerceId:a.commerceId,part}};
  });
 }
 close(){
  if(!this.#closing){
   this.#closed=true;
   this.#closing=(async()=>{
    await Promise.allSettled([...this.#pending]);
    const failures=[];
    for(const owner of [...this.#failedOwners])try{await owner.close();this.#failedOwners.delete(owner);}
    catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,'Original Research commerce owners remain open.',{cause:failures[0]});
    return {state:'CLOSED',workspaceId:this.#workspaceId,listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE'};
   })().catch(error=>{this.#closing=null;throw error;});
  }
  return this.#closing;
 }
}
