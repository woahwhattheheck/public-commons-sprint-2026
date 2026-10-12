#!/usr/bin/env node
// MIT. Complete original openTRANS receiving over the maintained supplier-order workspace.
// This program is an operator journey. All business mutations use the original
// workspace journal; retained JSON files are its exact invocation inputs and outputs.
import { constants } from 'node:fs';
import { open, mkdir, mkdtemp, rm, lstat, chmod, link, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openSupplierOrderWorkspace, MAX_SOURCE_BYTES, MAX_PACKAGE_BYTES } from '../workspace.mjs';
import { parseOpenTransDocument, renderOpenTransDocument, semanticXmlTree } from '../opentrans.mjs';
import { canonical, reviewDocument } from '../core.mjs';
import { compare, multiply, divide, subtract, add, rounded, exactText } from '../numbers.mjs';

export const SUPPLIER_ORDERS_NATIVE_SCHEMA='stellar-forge.supplier-orders-native-receiving.v1';
export const DEFAULT_SUPPLIER_ORDERS_NATIVE_OPERATION='supplier-orders-native-2769-20261012';
const PUBLISHER_ARCHIVE_SHA256='baae9ea0e1363f98aa2323570456fdc384423af330ca95fa27e3769075cb521a';
const KIND_ORDER=['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'];
const clone=value=>JSON.parse(JSON.stringify(value));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const seal=value=>sha(Buffer.from(canonical(value)));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const finiteBytes=value=>Number.isSafeInteger(value)&&value>=0;
function requireValue(condition,code,message,details){
  if(condition)return;
  const error=Object.assign(new Error(message),{code,status:409});
  if(details!==undefined)error.details=details;
  throw error;
}
function failure(error){
  return{code:error?.code??'SUPPLIER_ORDERS_NATIVE_FAILED',message:error?.message??String(error),
    ...(error?.details!==undefined?{details:clone(error.details)}:{})};
}
function same(a,b,message,details){requireValue(canonical(a)===canonical(b),'SUPPLIER_ORDERS_NATIVE_DIFFER',message,details);}
function cancelled(signal){if(signal?.aborted)throw signal.reason??Object.assign(new Error('The original receiving operation was interrupted.'),{code:'SUPPLIER_ORDERS_NATIVE_ABORTED'});}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  requireValue(info.isDirectory()&&!info.isSymbolicLink(),'SUPPLIER_ORDERS_NATIVE_DIRECTORY','Use an original private directory.',{path});
  await chmod(path,0o700);
}
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}
}
function stamp(info){
  return[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].map(String).join(':');
}
async function withOriginal(path,limit,action){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat({bigint:true});
    requireValue(before.isFile()&&before.size>=0n&&before.size<=BigInt(limit),
      'SUPPLIER_ORDERS_NATIVE_FILE','The selected source must be a complete regular file within its declared limit.',{path,limit});
    const value=await action(handle,Number(before.size));
    const after=await handle.stat({bigint:true});
    requireValue(stamp(before)===stamp(after),'SUPPLIER_ORDERS_NATIVE_FILE_CHANGED','The original file changed while it was read.',{path});
    return value;
  }finally{await handle.close();}
}
async function scan(handle,expectedBytes,write){
  const buffer=Buffer.allocUnsafe(256*1024),hash=createHash('sha256');let position=0;
  for(;;){
    const {bytesRead}=await handle.read(buffer,0,buffer.length,position);
    if(!bytesRead)break;
    const part=buffer.subarray(0,bytesRead);hash.update(part);
    if(write)await write(part);
    position+=bytesRead;
    requireValue(position<=expectedBytes,'SUPPLIER_ORDERS_NATIVE_FILE_CHANGED','A retained file grew while it was read.');
  }
  requireValue(position===expectedBytes,'SUPPLIER_ORDERS_NATIVE_FILE_CHANGED','A retained file ended before its original length.');
  return{bytes:position,sha256:hash.digest('hex')};
}
function checkIdentity(actual,expected,label){
  if(expected?.bytes!==undefined)requireValue(actual.bytes===expected.bytes,'SUPPLIER_ORDERS_NATIVE_LENGTH',label+' has a different byte count.',{expected,actual});
  if(expected?.sha256!==undefined)requireValue(actual.sha256===expected.sha256,'SUPPLIER_ORDERS_NATIVE_SHA256',label+' has a different SHA-256.',{expected,actual});
}
async function fileIdentity(path,expected,limit=MAX_PACKAGE_BYTES){
  const value=await withOriginal(path,limit,(handle,bytes)=>scan(handle,bytes));
  checkIdentity(value,expected,path);return{path:resolve(path),...value};
}
async function originalBytes(path,expected,limit=MAX_SOURCE_BYTES){
  return withOriginal(path,limit,async(handle,bytes)=>{
    const parts=[],value=await scan(handle,bytes,part=>{parts.push(Buffer.from(part));});
    checkIdentity(value,expected,path);
    return{path:resolve(path),...value,body:Buffer.concat(parts,value.bytes)};
  });
}
async function maybeJSON(path){
  try{return JSON.parse((await originalBytes(path,null,256*1024*1024)).body.toString('utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function immutableBytes(path,body){
  requireValue(body instanceof Uint8Array,'SUPPLIER_ORDERS_NATIVE_BYTES','A complete output requires bytes.');
  const expected={bytes:body.byteLength,sha256:sha(body)};
  try{const existing=await fileIdentity(path,expected,256*1024*1024);await syncDirectory(dirname(path));return existing;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await privateDirectory(dirname(path));
  const temporary=join(dirname(path),'.receiving-'+randomUUID()+'.part');
  const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  try{
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await fileIdentity(path,expected,256*1024*1024);}
    await syncDirectory(dirname(path));
    return await fileIdentity(path,expected,256*1024*1024);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function immutableJSON(path,value){return immutableBytes(path,jsonBytes(value));}
async function copyOriginal(path,selected){
  const sourcePath=selected.path;await privateDirectory(dirname(path));
  return withOriginal(sourcePath,MAX_PACKAGE_BYTES,async(source,sourceBytes)=>{
    const original=await scan(source,sourceBytes);checkIdentity(original,selected,sourcePath);
    try{const present=await fileIdentity(path,original);await syncDirectory(dirname(path));return present;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const temporary=join(dirname(path),'.receiving-'+randomUUID()+'.part');
    const output=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    let written;
    try{written=await scan(source,sourceBytes,part=>output.writeFile(part));checkIdentity(written,original,sourcePath);await output.sync();}
    finally{await output.close();}
    try{
      try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await fileIdentity(path,written);}
      await syncDirectory(dirname(path));return await fileIdentity(path,written);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  });
}

async function originalArchive(mode,source,destination,signal){
  cancelled(signal);
  const executable=process.env.STARFORGE_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
  const entry=fileURLToPath(new URL('../archive.py',import.meta.url));
  return new Promise((resolveResult,reject)=>{
    const child=spawn(executable,[entry,mode,source,destination],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const output=[],errors=[];let outputBytes=0,errorBytes=0,fault=null,killTimer=null;
    const stop=error=>{
      fault??=error;
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');killTimer??=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);}
    };
    const abort=()=>stop(signal.reason??Object.assign(new Error('Original archive operation interrupted.'),{code:'SUPPLIER_ORDERS_NATIVE_ABORTED'}));
    const timer=setTimeout(()=>stop(Object.assign(new Error('The original complete archive operation exceeded its receiving lifetime.'),{code:'SUPPLIER_ORDERS_NATIVE_ARCHIVE_TIMEOUT'})),120000);
    child.on('error',error=>{fault??=error;});
    child.stdout.on('data',part=>{outputBytes+=part.length;if(outputBytes>40*1024*1024)stop(Object.assign(new Error('The original archive result exceeds its retained limit.'),{code:'SUPPLIER_ORDERS_NATIVE_ARCHIVE_OUTPUT'}));else output.push(part);});
    child.stderr.on('data',part=>{if(errorBytes<1024*1024){const value=part.subarray(0,1024*1024-errorBytes);errors.push(value);errorBytes+=value.length;}});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.once('close',code=>{
      clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal?.removeEventListener('abort',abort);
      if(fault){reject(fault);return;}
      if(code!==0){
        let error;try{error=JSON.parse(Buffer.concat(errors).toString('utf8')).error;}catch{}
        reject(Object.assign(new Error(error?.message??'The original archive operation failed.'),{code:error?.code??'SUPPLIER_ORDERS_NATIVE_ARCHIVE_FAILED'}));return;
      }
      try{resolveResult(JSON.parse(Buffer.concat(output).toString('utf8')));}catch(error){reject(error);}
    });
  });
}

function sourceMember(root,name){
  requireValue(typeof name==='string'&&name.length>0&&!isAbsolute(name)&&!name.includes('\\')&&!name.includes('\0'),
    'SUPPLIER_ORDERS_NATIVE_MEMBER','Use the original source index member path.');
  const path=resolve(root,name),rel=relative(root,path);
  requireValue(rel!==''&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel),
    'SUPPLIER_ORDERS_NATIVE_MEMBER','A source member must remain inside its original publisher directory.');
  return path;
}
function kindOfSource(entry){
  return KIND_ORDER.find(kind=>basename(entry.path)==='openTRANS_'+kind+'_1_0_example.xml')??null;
}
function summary(order){
  return{orderId:order.orderId,revision:order.revision,stateSha256:order.stateSha256,status:order.status,
    originalDocumentId:order.document.id,originalDocumentSha256:order.document.sha256,
    items:order.items.map(item=>({lineId:item.lineId,articleId:item.article.supplierId,unit:item.unit,
      ordered:item.ordered,reportedConfirmation:item.reportedConfirmation,confirmed:item.confirmed,
      cancelled:item.cancelled,dispatched:item.dispatched,invoiced:item.invoiced,
      remainingToDispatch:item.remainingToDispatch,remainingToInvoice:item.remainingToInvoice,
      documents:clone(item.documents),packages:clone(item.packages),serials:clone(item.serials)})),
    selectedDocuments:clone(order.selectedDocuments),findings:clone(order.findings),totals:clone(order.totals)};
}
function checkHead(workspace,pin){
  const current=workspace.order({orderId:pin.orderId});
  requireValue(current.revision===pin.revision&&current.stateSha256===pin.stateSha256,
    'SUPPLIER_ORDERS_NATIVE_SOURCE_ADVANCED','The selected original order changed after this receiving phase. Preserve its later edits and inspect the retained operation.',{expected:pin,current:summary(current)});
  return current;
}
function quantities(order,expected){
  for(const [lineId,fields]of Object.entries(expected)){
    const row=order.items.find(item=>item.lineId===lineId);
    requireValue(row,'SUPPLIER_ORDERS_NATIVE_LINE','The original order line is absent.',{lineId});
    for(const [field,value]of Object.entries(fields)){
      requireValue(typeof row[field]==='string'&&compare(row[field],value)===0,
        'SUPPLIER_ORDERS_NATIVE_QUANTITY','The selected current documents produced a different exact quantity.',{lineId,field,expected:value,actual:row[field]});
    }
  }
}
function noErrors(findings,label){
  const errors=(findings??[]).filter(item=>item.severity==='error');
  requireValue(errors.length===0,'SUPPLIER_ORDERS_NATIVE_REVIEW',label+' requires its original field review.',{findings:errors});
}
function notice(document,text){
  document.header.remarks??=[];document.header.remarks.push({type:null,text,sourcePath:null});
}
function originalRequestId(operationId,role,name){return'orders-'+seal([operationId,role,name]).slice(0,48);}
function operationReceipt(role,name,method,operation){
  const resultPresent=own(operation,'result'),errorPresent=own(operation,'error');
  const receipt={role,name,method,requestId:operation.id,kind:operation.kind,requestSha256:operation.requestSha256,
    resultSha256:resultPresent?seal(operation.result):null,state:operation.state};
  // Successful legacy receipts retain their exact original shape. A failed
  // native action can omit result entirely; preserve that distinction and its
  // actual saved error instead of trying to hash an undefined JSON value.
  if(operation.state!=='COMPLETE')Object.assign(receipt,{resultPresent,errorPresent,error:errorPresent?clone(operation.error):null});
  return receipt;
}
async function implementation(){
  const names=['../workspace.mjs','../core.mjs','../numbers.mjs','../portable.mjs','../archive.py',
    '../opentrans.mjs','../opentrans-tree.mjs','../xml-native.py','../../opensearch/workspace/store.mjs'];
  const files=[];
  for(const name of names){const selected=await fileIdentity(fileURLToPath(new URL(name,import.meta.url)),null,256*1024*1024);files.push({name,...selected});}
  const self=await fileIdentity(fileURLToPath(import.meta.url),null,256*1024*1024);
  files.push({name:'receiving/supplier-orders-native.mjs',...self});
  return{schema:'stellar-forge.supplier-orders-native-implementation.v1',node:process.version,files,sha256:seal(files.map(({name,bytes,sha256})=>({name,bytes,sha256})))};
}

/**
 * Continues one original receiving operation. The producer and customer are
 * supplied explicitly so an existing empty/native workspace can be reused.
 * Source input is the captured author package index shipped with this product.
 */
export async function runSupplierOrderNativeReceiving({
  directory,sourceIndexPath=fileURLToPath(new URL('../source/opentrans-source.json',import.meta.url)),
  producerDirectory,customerDirectory,operationId=DEFAULT_SUPPLIER_ORDERS_NATIVE_OPERATION,
  signal,onProgress=()=>{}
}={}){
  for(const [name,value]of Object.entries({directory,producerDirectory,customerDirectory,operationId}))
    requireValue(typeof value==='string'&&value.length>0,'SUPPLIER_ORDERS_NATIVE_ARGUMENT','Supply '+name+' for the original receiving operation.');
  directory=resolve(directory);producerDirectory=resolve(producerDirectory);customerDirectory=resolve(customerDirectory);sourceIndexPath=resolve(sourceIndexPath);
  requireValue(new Set([directory,producerDirectory,customerDirectory]).size===3,'SUPPLIER_ORDERS_NATIVE_DIRECTORIES','Keep the receiving output, original producer and customer in distinct explicit directories.');
  await privateDirectory(directory);
  for(const name of ['requests','phases','originals','documents','packages','implementations','attempts'])await privateDirectory(join(directory,name));
  const indexFile=await originalBytes(sourceIndexPath,null,4*1024*1024),index=JSON.parse(indexFile.body.toString('utf8'));
  requireValue(index.schema==='stellar-forge.opentrans-source.v1'&&index.profileId==='unite-opentrans-1.0'&&
    index.source?.sha256===PUBLISHER_ARCHIVE_SHA256&&Array.isArray(index.files),
    'SUPPLIER_ORDERS_NATIVE_SOURCE_INDEX','Select the retained original openTRANS 1.0 publisher index.');
  const selected=KIND_ORDER.map(kind=>{
    const candidates=index.files.filter(entry=>entry.role==='example'&&kindOfSource(entry)===kind);
    requireValue(candidates.length===1,'SUPPLIER_ORDERS_NATIVE_SOURCE_INDEX','The source index must contain one complete original example for '+kind+'.');
    const entry=candidates[0];
    requireValue(finiteBytes(entry.bytes)&&/^[0-9a-f]{64}$/.test(entry.sha256),'SUPPLIER_ORDERS_NATIVE_SOURCE_INDEX','Retain each original member length and SHA-256.');
    return{...entry,kind,path:sourceMember(dirname(sourceIndexPath),entry.path),member:entry.path,cohort:'fraunhofer-opentrans-1.0-original'};
  });
  const sourceInputs=[];
  for(const entry of selected){
    const checked=await fileIdentity(entry.path,entry,MAX_SOURCE_BYTES);
    sourceInputs.push({...checked,kind:entry.kind,name:basename(entry.path),member:entry.member,gitBlob:entry.gitBlob,cohort:entry.cohort});
  }
  const activeImplementation=await implementation();
  await immutableJSON(join(directory,'implementations',activeImplementation.sha256+'.json'),activeImplementation);
  const selection={schema:SUPPLIER_ORDERS_NATIVE_SCHEMA,operationId,directory,producerDirectory,customerDirectory,
    sourceIndex:{path:sourceIndexPath,bytes:indexFile.bytes,sha256:indexFile.sha256},
    publisher:clone(index.source),sourceInputs};
  const existingInput=await maybeJSON(join(directory,'operation.json'));
  if(existingInput)same(existingInput.selection,selection,'The original receiving selection differs from this invocation.');
  const input=existingInput??{selection,startedAt:new Date().toISOString(),firstImplementation:activeImplementation.sha256};
  await immutableJSON(join(directory,'operation.json'),input);
  let producer=null,customer=null,activePhase=null,closed=false,primaryError=null;
  const phases=[],operations=new Map(),artifactMap=new Map(),observations=[];
  const workspaces=()=>({producer,customer});
  function rememberFile(file){artifactMap.set(file.path,file);if(activePhase)activePhase.artifacts.set(file.path,file);return file;}
  function rememberOperation(receipt){operations.set(receipt.role+'/'+receipt.name,receipt);if(activePhase)activePhase.operations.set(receipt.role+'/'+receipt.name,receipt);}
  async function verifyReceipt(receipt){
    const workspace=workspaces()[receipt.role];requireValue(workspace,'SUPPLIER_ORDERS_NATIVE_WORKSPACE','The original workspace is not open.');
    const current=workspace.operation({requestId:receipt.requestId});
    same(operationReceipt(receipt.role,receipt.name,receipt.method,current),receipt,'The retained original operation outcome changed.');
    rememberOperation(receipt);
  }
  async function phase(name,run){
    cancelled(signal);
    const path=join(directory,'phases',name+'.json'),prior=await maybeJSON(path);
    if(prior){
      requireValue(prior.schema==='stellar-forge.supplier-orders-native-phase.v1'&&prior.operationId===operationId&&prior.name===name,
        'SUPPLIER_ORDERS_NATIVE_PHASE','The retained phase belongs to a different original operation.');
      for(const receipt of prior.operations)await verifyReceipt(receipt);
      for(const file of prior.artifacts){await fileIdentity(file.path,file);rememberFile(file);}
      phases.push(prior);onProgress({phase:name,state:'REOPENED'});return prior.value;
    }
    activePhase={name,operations:new Map(),artifacts:new Map()};
    onProgress({phase:name,state:'RUNNING'});
    const value=await run();
    const record={schema:'stellar-forge.supplier-orders-native-phase.v1',operationId,name,
      completedAt:new Date().toISOString(),implementationSha256:activeImplementation.sha256,
      operations:[...activePhase.operations.values()],artifacts:[...activePhase.artifacts.values()],value};
    await immutableJSON(path,record);
    phases.push(record);activePhase=null;onProgress({phase:name,state:'COMPLETE'});return value;
  }
  async function invoke(role,name,method,build,expectedFailureCode=null){
    cancelled(signal);const workspace=workspaces()[role],requestId=originalRequestId(operationId,role,name);
    const path=join(directory,'requests',role+'-'+name+'.json');
    let retained=await maybeJSON(path);
    if(retained){
      same({schema:retained.schema,operationId:retained.operationId,workspaceId:retained.workspaceId,role:retained.role,method:retained.method},
        {schema:'stellar-forge.supplier-orders-native-request.v1',operationId,workspaceId:workspace.store.id,role,method},
        'The retained request does not match the original workspace and action.');
      requireValue(retained.request?.requestId===requestId,'SUPPLIER_ORDERS_NATIVE_REQUEST','The original request ID differs.');
    }else{
      const request={...await build(),requestId};
      retained={schema:'stellar-forge.supplier-orders-native-request.v1',operationId,workspaceId:workspace.store.id,role,method,request};
      await immutableJSON(path,retained);
    }
    const result=await workspace[method](clone(retained.request));
    requireValue(result?.id===requestId&&(expectedFailureCode?result.state==='FAILED'&&result.error?.code===expectedFailureCode:result.state==='COMPLETE'),'SUPPLIER_ORDERS_NATIVE_OPERATION',
      'The original '+method+' operation has not completed. Its retained terminal attempt remains available.',{requestId,state:result?.state,error:result?.error});
    const current=workspace.operation({requestId});
    same(current,result,'The original native operation did not reopen with the returned result.');
    rememberOperation(operationReceipt(role,name,method,current));return current;
  }
  async function exportedDocument(role,documentId,name){
    const workspace=workspaces()[role],file=await workspace.exportFile({id:documentId});
    const copy=rememberFile(await copyOriginal(join(directory,'documents',role+'-'+name+'.xml'),file));
    return{documentId,fileId:file.id,name:file.name,...copy};
  }
  async function finishDraft(role,name,{base,kind,documentId,priorDraftId=null,edit,reason,roundingPolicy=null}){
    const workspace=workspaces()[role];
    const saved=await invoke(role,name+'-save','saveDraft',()=>{
      const current=checkHead(workspace,base);
      const seed=workspace.newDraft({kind,orderIds:[base.orderId],...(documentId?{documentId}:{}),...(roundingPolicy?{roundingPolicy}:{})});
      const prior=priorDraftId?workspace.draft({draftId:priorDraftId}):null;
      const document=clone(prior?.document??seed.document);
      if(edit)edit(document,current);
      document.summary.totalItems=String(document.items.length);
      notice(document,reason);
      return{kind,orderIds:[base.orderId],document,reason,title:'Original receiving — '+name,
        expectedOrderRevisions:seed.orderRevisions,expectedOrderStateSha256:seed.orderStateSha256,
        ...(prior?{draftId:prior.id,expectedRevision:prior.revision}:{}),...(roundingPolicy?{roundingPolicy}:{})};
    });
    noErrors(saved.result.draft.review.findings,'The saved '+kind+' draft');
    const prepared=await invoke(role,name+'-prepare','prepareDocument',()=>({draftId:saved.result.draftId,expectedRevision:saved.result.revision}));
    noErrors(prepared.result.document.review.findings,'The complete prepared '+kind);
    const selectedOperation=await invoke(role,name+'-select','selectDocument',()=>({
      id:prepared.result.documentId,orderId:base.orderId,
      expectedOrderRevisions:saved.result.draft.orderRevisions,reason
    }));
    const current=workspace.order({orderId:base.orderId});
    requireValue(current.revision===selectedOperation.result.revisions[base.orderId],
      'SUPPLIER_ORDERS_NATIVE_CURRENT_CHANGED','The selected original receiving document is followed by another order change.',{expected:selectedOperation.result.revisions[base.orderId],current:summary(current)});
    const output=await exportedDocument(role,prepared.result.documentId,name);
    return{order:summary(current),draftId:saved.result.draftId,draftRevision:saved.result.revision,
      draftSha256:saved.result.draft.sha256,documentId:prepared.result.documentId,
      documentRevision:prepared.result.document.revision,documentSha256:prepared.result.document.sha256,
      output,review:clone(prepared.result.document.review),
      requests:{save:saved.id,prepare:prepared.id,select:selectedOperation.id}};
  }
  async function packageWorkspace(role,name,base){
    const workspace=workspaces()[role],output=join(directory,'packages',role+'-'+name+'.zip');
    const operation=await invoke(role,name+'-package','exportWorkspace',()=>{checkHead(workspace,base);return{path:output};});
    const file=await workspace.file({id:operation.result.file.id});
    await fileIdentity(output,file);
    const retained=rememberFile(await fileIdentity(file.path,file));
    const selectedOutput=rememberFile(await fileIdentity(output,file));
    return{...selectedOutput,fileId:file.id,retainedPath:retained.path,requestId:operation.id,
      workspaceId:workspace.store.id,package:clone(operation.result.package)};
  }
  async function closeAll(){
    const errors=[];
    for(const role of ['customer','producer']){
      const workspace=workspaces()[role];if(!workspace)continue;
      try{await workspace.close();if(role==='customer')customer=null;else producer=null;}
      catch(error){errors.push({role,...failure(error)});}
    }
    closed=!producer&&!customer;
    requireValue(errors.length===0,'SUPPLIER_ORDERS_NATIVE_CLOSE','The original workspace lifetime has not fully closed.',{errors});
  }
  try{
    cancelled(signal);
    producer=await openSupplierOrderWorkspace({directory:producerDirectory});
    customer=await openSupplierOrderWorkspace({directory:customerDirectory});
    const identities={producer:{directory:producerDirectory,workspaceId:producer.store.id},customer:{directory:customerDirectory,workspaceId:customer.store.id}};
    const originalIdentities=await maybeJSON(join(directory,'workspaces.json'));
    if(originalIdentities)same(originalIdentities,identities,'The original receiving workspace identity changed.');
    await immutableJSON(join(directory,'workspaces.json'),identities);

    const previousReport=await maybeJSON(join(directory,'report.json'));
    if(previousReport){
      requireValue(previousReport.schema===SUPPLIER_ORDERS_NATIVE_SCHEMA&&previousReport.operationId===operationId&&previousReport.status==='PASS'&&previousReport.lifetimes==='CLOSED',
        'SUPPLIER_ORDERS_NATIVE_REPORT','The retained final report is not a completed original receiving operation.');
      same(previousReport.selection,selection,'The retained completed receiving report uses another source selection.');
      for(const receipt of previousReport.operations)await verifyReceipt(receipt);
      for(const file of previousReport.artifactFiles)await fileIdentity(file.path,file);
      for(const record of previousReport.documents){
        const workspace=workspaces()[record.role],actual=workspace.document({id:record.id});
        requireValue(actual.sha256===record.sha256,'SUPPLIER_ORDERS_NATIVE_DOCUMENT','An original immutable received document changed.');
        const file=await workspace.exportFile({id:record.id});await fileIdentity(file.path,record.source);
      }
      const reopened={at:new Date().toISOString(),implementationSha256:activeImplementation.sha256,
        producer:summary(producer.order({orderId:previousReport.workspaces.producer.orderId})),
        customer:summary(customer.order({orderId:previousReport.workspaces.customer.orderId}))};
      await closeAll();reopened.lifetimes='CLOSED';
      await immutableJSON(join(directory,'attempts','reopen-'+randomUUID()+'.json'),reopened);
      return{...previousReport,reused:true,reopened};
    }

    const calibrated=await phase('01-original-native-documents',async()=>{
      const documents=[];
      for(const entry of sourceInputs){
        cancelled(signal);
        const source=await originalBytes(entry.path,entry);
        const provenance={url:index.source.url,archiveSha256:index.source.sha256,member:entry.member,cohort:entry.cohort};
        const document=await parseOpenTransDocument(source.body,{name:entry.name,provenance,signal});
        requireValue(document.kind===entry.kind&&document.version==='1.0','SUPPLIER_ORDERS_NATIVE_KIND','The actual publisher document has another kind or version.');
        const rendered=await renderOpenTransDocument(document,{name:entry.name,provenance,signal});
        same(semanticXmlTree(document.raw.root),semanticXmlTree(rendered.document.raw.root),
          'An untouched original semantic XML tree changed on the native parse/render/parse path.',{kind:entry.kind});
        same(document.findings,rendered.findings,'An untouched original document changed its native findings.',{kind:entry.kind});
        const original=rememberFile(await immutableBytes(join(directory,'originals',entry.name),source.body));
        const roundTrip=rememberFile(await immutableBytes(join(directory,'originals','roundtrip-'+entry.name),rendered.bytes));
        const projected={kind:document.kind,documentId:document.documentId,orderId:document.orderId,
          supplierId:document.header.supplierId,items:document.items.length,
          originalNumericStrings:document.items.map(item=>({lineId:item.lineId,quantity:item.quantity,
            price:item.price?{type:item.price.type,amount:item.price.amount,quantity:item.price.quantity,lineAmount:item.price.lineAmount,tax:item.price.tax,taxAmount:item.price.taxAmount}:null})),
          transportParties:document.header.parties.transport.length,
          itemTransportParties:document.items.map(item=>item.parties.transport.length),
          originalFindings:clone(document.findings),dtd:clone(document.validation),
          deliveryReferences:document.items.flatMap(item=>item.deliveryReferences),
          original,roundTrip,completeSemanticTreeSha256:seal(semanticXmlTree(document.raw.root))};
        documents.push(projected);
      }
      return{publisher:clone(index.source),documents};
    });

    const imported=await phase('02-original-source-intake',async()=>{
      const rows=[];
      for(const entry of sourceInputs){
        const operation=await invoke('producer','publisher-'+entry.kind.toLowerCase(),'importDocument',()=>({
          sourcePath:entry.path,name:entry.name,expectedBytes:entry.bytes,expectedSha256:entry.sha256,
          provenance:{url:index.source.url,archiveSha256:index.source.sha256,member:entry.member,cohort:entry.cohort},
          selection:'history',reason:'Retain the complete unchanged publisher example and its actual review.'
        }));
        const record=producer.document({id:operation.result.documentId});
        const file=await producer.exportFile({id:record.id});await fileIdentity(file.path,entry);
        rows.push({id:record.id,sha256:record.sha256,kind:record.kind,source:clone(record.source),review:clone(record.review)});
      }
      const original=rows.find(row=>row.kind==='ORDER'),record=producer.document({id:original.id});
      requireValue(record.document.orderId==='PO4500002323'&&record.document.header.supplierId==='UEG-FB5-BLI',
        'SUPPLIER_ORDERS_NATIVE_ORIGINAL','The selected author example no longer has its original order and supplier identity.');
      same(record.document.items.map(item=>[item.lineId,item.quantity,item.unit]),[['P100012','20','C62'],['P100028','4','C62']],
        'The retained original publisher line quantities changed.');
      const order=producer.order({orderId:record.document.orderId});
      requireValue(order.document.id===original.id,'SUPPLIER_ORDERS_NATIVE_ORIGINAL','This receiving workspace already selects a different original order.');
      quantities(order,{P100012:{cancelled:'0',dispatched:'0',invoiced:'0'},P100028:{cancelled:'0',dispatched:'0',invoiced:'0'}});
      return{order:summary(order),documents:rows};
    });
    const orderId=imported.order.orderId,first='P100012',second='P100028';
    const originalOrder=producer.document({id:imported.order.originalDocumentId}).document;
    const originalById=new Map(originalOrder.items.map(item=>[item.lineId,item]));
    const firstOrdered=originalById.get(first).quantity,secondOrdered=originalById.get(second).quantity;
    const cancellation=exactText(divide(firstOrdered,'10'));
    const half=exactText(divide(firstOrdered,'2')),revisedDispatch=exactText(divide(multiply(firstOrdered,'3'),'5'));
    const originalAmounts=Object.fromEntries(originalOrder.items.map(item=>[item.lineId,item.price.amount]));
    const policy={scale:2,mode:'half-up',taxBasis:'line'};

    const confirmed=await phase('03-complete-confirmation',async()=>{
      const value=await finishDraft('producer','complete-confirmation',{base:imported.order,kind:'ORDERRESPONSE',
        reason:'Confirm the complete original publisher order through the native supplier workflow.'});
      quantities(producer.order({orderId}),{[first]:{confirmed:firstOrdered,cancelled:'0'},[second]:{confirmed:secondOrdered,cancelled:'0'}});
      return value;
    });
    const cancelledRevision=await phase('04-sparse-cancellation',async()=>{
      const value=await finishDraft('producer','sparse-cancellation',{base:confirmed.order,kind:'ORDERRESPONSE',
        reason:'Record an explicit current cancellation of one tenth of the first ordered line; retain the prior confirmation on omitted lines.',
        edit(document){document.items=document.items.filter(item=>item.lineId===first);document.items[0].quantity='-'+cancellation;document.items[0].price=null;}});
      quantities(producer.order({orderId}),{[first]:{cancelled:cancellation},[second]:{confirmed:secondOrdered,cancelled:'0'}});
      return value;
    });
    const replacedCancellation=await phase('05-cancellation-current-revision',async()=>{
      const value=await finishDraft('producer','cancellation-revision',{base:cancelledRevision.order,kind:'ORDERRESPONSE',priorDraftId:cancelledRevision.draftId,
        reason:'Clarify the same current cancellation as a later confirmation revision, preserving its exact quantity.'});
      quantities(producer.order({orderId}),{[first]:{cancelled:cancellation},[second]:{confirmed:secondOrdered}});
      requireValue(value.documentId!==cancelledRevision.documentId&&value.documentRevision>cancelledRevision.documentRevision,
        'SUPPLIER_ORDERS_NATIVE_REVISION','The replacement confirmation did not retain a distinct native revision.');
      return value;
    });
    const restoredConfirmation=await phase('06-restored-complete-confirmation',async()=>{
      const value=await finishDraft('producer','restored-confirmation',{base:replacedCancellation.order,kind:'ORDERRESPONSE',
        reason:'Restore the complete confirmed quantities from the unchanged source order for the following dispatch.'});
      quantities(producer.order({orderId}),{[first]:{confirmed:firstOrdered,cancelled:'0'},[second]:{confirmed:secondOrdered,cancelled:'0'}});
      return value;
    });
    const dispatchA=await phase('07-first-partial-dispatch',async()=>{
      const value=await finishDraft('producer','dispatch-a',{base:restoredConfirmation.order,kind:'DISPATCHNOTIFICATION',documentId:'NATIVE-2769-DISPATCH-A',
        reason:'Prepare the first partial dispatch from the actual original quantity and source delivery period.',
        edit(document){
          document.items=document.items.filter(item=>item.orderReference.lineId===first);
          document.items[0].quantity=half;document.items[0].lineId='1';
          document.items[0].packages=[{id:'RECEIVING-2769-PARCEL-A',type:'parcel',typeField:'element',attributes:[],extensions:[],sourcePath:null}];
          document.items[0].remarks=[{type:null,text:'NUMBER:[Number][Type]SERIAL[/Type][Value]RECEIVING-2769-SERIAL-A[/Value][/Number]',sourcePath:null}];
        }});
      const current=producer.order({orderId});quantities(current,{[first]:{dispatched:half},[second]:{dispatched:'0'}});
      same(current.items.find(item=>item.lineId===first).serials.map(item=>item.value),['RECEIVING-2769-SERIAL-A'],
        'The actual native REMARK did not produce its retained serial value.');
      return value;
    });
    const dispatchARevision=await phase('08-revised-partial-dispatch',async()=>{
      const value=await finishDraft('producer','dispatch-a-revised',{base:dispatchA.order,kind:'DISPATCHNOTIFICATION',priorDraftId:dispatchA.draftId,
        reason:'Revise the same first dispatch from one half to three fifths of the original ordered quantity.',
        edit(document){document.items[0].quantity=revisedDispatch;}});
      quantities(producer.order({orderId}),{[first]:{dispatched:revisedDispatch},[second]:{dispatched:'0'}});
      requireValue(value.documentRevision===dispatchA.documentRevision+1,'SUPPLIER_ORDERS_NATIVE_REVISION','The first dispatch revision was not retained under its original business document.');
      return value;
    });
    const dispatchB=await phase('09-complete-remaining-dispatch',async()=>{
      const value=await finishDraft('producer','dispatch-b',{base:dispatchARevision.order,kind:'DISPATCHNOTIFICATION',documentId:'NATIVE-2769-DISPATCH-B',
        reason:'Dispatch the exact remaining quantities after the selected first dispatch revision.',
        edit(document){
          for(const item of document.items)item.packages=[{id:'RECEIVING-2769-PARCEL-B-'+item.lineId,type:'parcel',typeField:'element',attributes:[],extensions:[],sourcePath:null}];
        }});
      const current=producer.order({orderId});quantities(current,{[first]:{dispatched:firstOrdered,remainingToDispatch:'0'},[second]:{dispatched:secondOrdered,remainingToDispatch:'0'}});
      const actual=producer.document({id:value.documentId}).document;
      same(actual.items.map(item=>[item.orderReference.lineId,item.quantity]),[[first,exactText(subtract(firstOrdered,revisedDispatch))],[second,secondOrdered]],
        'The second dispatch did not use the current exact remaining quantities.');
      return value;
    });
    const invoice=await phase('10-invoice-native-delivery-references',async()=>{
      const value=await finishDraft('producer','invoice',{base:dispatchB.order,kind:'INVOICE',documentId:'NATIVE-2769-INVOICE',roundingPolicy:policy,
        reason:'Invoice the exact current dispatch portions with their original delivery-note references and explicit line tax rounding.'});
      const document=producer.document({id:value.documentId}).document;
      requireValue(document.items.length===3&&document.items.every(item=>item.deliveryReferences.length===1),
        'SUPPLIER_ORDERS_NATIVE_INVOICE_REFERENCES','The invoice must retain one native delivery reference for each of its three selected dispatch portions.');
      same(document.items.map(item=>[item.orderReference.lineId,item.quantity,item.deliveryReferences[0].documentId,item.deliveryReferences[0].lineId]),
        [[first,revisedDispatch,'NATIVE-2769-DISPATCH-A','1'],[first,exactText(subtract(firstOrdered,revisedDispatch)),'NATIVE-2769-DISPATCH-B','1'],[second,secondOrdered,'NATIVE-2769-DISPATCH-B','2']],
        'The complete invoice changed its actual dispatch contribution identity.');
      requireValue(compare(document.summary.totalAmount,'180')===0&&compare(document.summary.totalTaxAmount,'28.8')===0,
        'SUPPLIER_ORDERS_NATIVE_INVOICE_TOTAL','The full original net and tax totals differ.');
      quantities(producer.order({orderId}),{[first]:{dispatched:firstOrdered,invoiced:firstOrdered},[second]:{dispatched:secondOrdered,invoiced:secondOrdered}});
      return{...value,net:document.summary.totalAmount,tax:document.summary.totalTaxAmount,currency:document.header.currency,
        deliveryReferences:document.items.map(item=>({lineId:item.lineId,orderReference:item.orderReference,deliveryReferences:item.deliveryReferences}))};
    });
    const exponentInvoice=await phase('11-exact-invoice-revision-and-request-replay',async()=>{
      const value=await finishDraft('producer','invoice-exact-revision',{base:invoice.order,kind:'INVOICE',priorDraftId:invoice.draftId,roundingPolicy:policy,
        reason:'Retain equivalent explicit openTRANS NUMBER exponent lexemes in a new revision of the same invoice.',
        edit(document){
          const item=document.items[0];item.quantity='+'+item.quantity+'e0';
          for(const key of ['amount','quantity','lineAmount','tax'])if(item.price[key]!=null)item.price[key]='+'+item.price[key]+'e0';
        }});
      const document=producer.document({id:value.documentId}).document,firstLine=document.items[0];
      for(const value of [firstLine.quantity,firstLine.price.amount,firstLine.price.quantity,firstLine.price.lineAmount,firstLine.price.tax])
        requireValue(typeof value==='string'&&value.startsWith('+')&&value.endsWith('e0'),'SUPPLIER_ORDERS_NATIVE_NUMBER_LEXEME','The original numeric token changed on native XML output.');
      quantities(producer.order({orderId}),{[first]:{invoiced:firstOrdered},[second]:{invoiced:secondOrdered}});
      const before=summary(producer.order({orderId}));
      const oldRequest=await maybeJSON(join(directory,'requests','producer-invoice-prepare.json'));
      const replay=await producer.prepareDocument(clone(oldRequest.request));
      requireValue(replay.id===invoice.requests.prepare&&replay.state==='COMPLETE'&&replay.result.documentId===invoice.documentId,
        'SUPPLIER_ORDERS_NATIVE_REPLAY','The original earlier prepare request did not return its retained document.');
      await fileIdentity((await producer.exportFile({id:invoice.documentId})).path,invoice.output);
      same(summary(producer.order({orderId})),before,'Replaying the earlier preparation changed the current order.');
      return{...value,originalPrepareReopened:replay.id,exactNumericStrings:{quantity:firstLine.quantity,price:clone(firstLine.price)}};
    });

    const invalidCurrent=await phase('12-native-source-review-selection',async()=>{
      const requestPath=join(directory,'requests','native-reviewed-invoice-input.json');
      let selectedInput=await maybeJSON(requestPath);
      if(!selectedInput){
        checkHead(producer,exponentInvoice.order);
        const document=clone(producer.document({id:exponentInvoice.documentId}).document);
        document.header.currency='USD';document.items[0].quantity='+'+exactText(subtract(firstOrdered,'-2'))+'e0';
        for(const item of document.items){
          item.price.lineAmount=exactText(divide(multiply(item.price.amount,item.quantity),item.price.quantity??'1'));
          item.price.taxAmount=null;
        }
        // Recompute declared totals through the original exact arithmetic.
        let net='0',tax='0';
        for(const item of document.items){
          net=exactText(add(net,item.price.lineAmount));
          tax=exactText(add(tax,rounded(multiply(item.price.lineAmount,item.price.tax),policy)));
        }
        document.summary.totalAmount=net;document.summary.totalTaxAmount=tax;
        notice(document,'Receiving example: retain an explicit over-quantity and foreign invoice currency as native source for selected-document review.');
        const output=await renderOpenTransDocument(document,{name:'native-review-invoice.xml',provenance:{kind:'operator-receiving-source',operationId},signal});
        noErrors(output.findings,'The native structural invoice');
        const file=rememberFile(await immutableBytes(join(directory,'originals','native-review-invoice.xml'),output.bytes));
        selectedInput={file,base:exponentInvoice.order,documentId:output.document.documentId,
          expectedFindings:['INVOICE_EXCEEDS_ORDER','SOURCE_CURRENCY_DIFFERS']};
        await immutableJSON(requestPath,selectedInput);
      }else rememberFile(await fileIdentity(selectedInput.file.path,selectedInput.file));
      const received=await invoke('producer','review-invoice-source','importDocument',()=>({
        sourcePath:selectedInput.file.path,name:'native-review-invoice.xml',expectedBytes:selectedInput.file.bytes,expectedSha256:selectedInput.file.sha256,
        provenance:{kind:'operator-receiving-source',operationId,sourceDocumentId:exponentInvoice.documentId},
        selection:'history',reason:'Preserve and review the actual native invoice with explicit quantity and currency errors.'
      }));
      const selectionOperation=await invoke('producer','review-invoice-select','selectDocument',()=>({
        id:received.result.documentId,orderId,expectedOrderRevision:selectedInput.base.revision,
        reason:'Select the full native erroneous revision so the original order desk exposes the actual document findings.'
      }));
      const current=producer.order({orderId});
      requireValue(current.revision===selectionOperation.result.revisions[orderId]&&current.status==='REVIEW',
        'SUPPLIER_ORDERS_NATIVE_SELECTED_REVIEW','The actual selected erroneous invoice did not produce REVIEW.');
      const codes=new Set(current.findings.map(item=>item.code));
      for(const code of selectedInput.expectedFindings)requireValue(codes.has(code),'SUPPLIER_ORDERS_NATIVE_SELECTED_FINDING','A selected original document finding is absent from the order desk.',{expected:code,findings:current.findings});
      return{order:summary(current),documentId:received.result.documentId,source:clone(received.result.source),
        findings:clone(current.findings),selectedRequestId:selectionOperation.id};
    });
    const validCurrent=await phase('13-restore-retained-valid-invoice',async()=>{
      const selectionOperation=await invoke('producer','restore-valid-invoice','selectDocument',()=>({
        id:exponentInvoice.documentId,orderId,expectedOrderRevision:invalidCurrent.order.revision,
        reason:'Restore the previously prepared valid invoice while preserving the complete erroneous native source and selection history.'
      }));
      const current=producer.order({orderId});
      requireValue(current.revision===selectionOperation.result.revisions[orderId]&&current.status==='COMPLETE',
        'SUPPLIER_ORDERS_NATIVE_VALID_SELECTION','The retained valid document did not restore the completed original order.');
      noErrors(current.findings,'The restored original order');
      quantities(current,{[first]:{invoiced:firstOrdered,dispatched:firstOrdered},[second]:{invoiced:secondOrdered,dispatched:secondOrdered}});
      return{order:summary(current),documentId:exponentInvoice.documentId};
    });
    const firstPackage=await phase('14-first-complete-producer-package',async()=>{
      const file=await packageWorkspace('producer','first-delivery',validCurrent.order);
      return{file,order:validCurrent.order};
    });

    const sourceBindingRejection=await phase('14b-portable-original-source-binding',async()=>{
      const retainedPath=join(directory,'requests','changed-normalization-package.json');
      let input=await maybeJSON(retainedPath);
      if(!input){
        const receiving=await mkdtemp(join(directory,'source-binding-'));
        try{
          const unpacked=await originalArchive('unpack',firstPackage.file.path,receiving,signal);
          const original=await originalBytes(join(receiving,'workspace.jsonl'),unpacked.manifest.entries.find(entry=>entry.path==='workspace.jsonl'),256*1024*1024);
          const lines=original.body.toString('utf8').split('\n');requireValue(lines.at(-1)==='','SUPPLIER_ORDERS_NATIVE_SNAPSHOT','The original complete snapshot did not retain its terminal newline.');
          let changed=0,before=null,after=null;
          const changedLines=lines.slice(0,-1).map(line=>{
            const row=JSON.parse(line);
            if(row.table==='supplier_order_documents'&&row.row.id===imported.order.originalDocumentId){
              const record=JSON.parse(row.row.record_json);before={quantity:record.document.items[0].quantity,sha256:record.sha256};
              record.document.items[0].quantity=exactText(subtract(record.document.items[0].quantity,'-1'));
              const {sha256:oldSeal,...body}=record;record.sha256=seal(body);
              after={quantity:record.document.items[0].quantity,sha256:record.sha256};
              row.row.record_json=JSON.stringify(record);changed++;return JSON.stringify(row);
            }
            return line;
          });
          requireValue(changed===1,'SUPPLIER_ORDERS_NATIVE_SNAPSHOT','The original package must contain exactly the selected immutable ORDER record.');
          const changedFile=await immutableBytes(join(receiving,'changed-workspace.jsonl'),Buffer.from(changedLines.join('\n')+'\n'));
          const manifest=clone(unpacked.manifest);
          for(const entry of manifest.entries)if(entry.path==='workspace.jsonl'){entry.bytes=changedFile.bytes;entry.sha256=changedFile.sha256;}
          manifest.totalBytes=manifest.entries.reduce((total,entry)=>total+entry.bytes,0);
          const sources=Object.fromEntries(manifest.entries.map(entry=>[entry.path,entry.path==='workspace.jsonl'?changedFile.path:join(receiving,entry.path)]));
          const descriptor=join(receiving,'descriptor.json');await immutableJSON(descriptor,{manifest,sources});
          const staged=join(receiving,'changed-package.zip');
          const packed=await originalArchive('pack',descriptor,staged,signal);
          const file=rememberFile(await copyOriginal(join(directory,'packages','source-binding-rejected.zip'),{path:staged,bytes:packed.bytes,sha256:packed.sha256}));
          input={file,originalPackage:firstPackage.file,originalDocumentId:imported.order.originalDocumentId,
            change:{path:'/document/items/0/quantity',before,after},manifest,
            rule:'The normalized quantity and record/snapshot/archive hashes were deliberately changed; every original XML byte remains identical.'};
          await immutableJSON(retainedPath,input);
        }finally{await rm(receiving,{recursive:true,force:true});}
      }else rememberFile(await fileIdentity(input.file.path,input.file));
      const before=customer.state();
      const result=await invoke('customer','source-binding-rejection','importWorkspace',()=>({
        path:input.file.path,mode:'merge',expectedBytes:input.file.bytes,expectedSha256:input.file.sha256
      }),'ORDER_PACKAGE_SOURCE_PROJECTION_DIFFERS');
      const after=customer.state();
      same(after.counts,before.counts,'The rejected normalized/source mismatch changed the original customer business rows.');
      same(after.orderStateSha256,before.orderStateSha256,'The rejected normalized/source mismatch changed customer order selections.');
      return{file:input.file,originalPackage:input.originalPackage,change:input.change,
        rejection:clone(result.error),requestId:result.id,businessCounts:after.counts,completeOriginalXmlPreserved:true};
    });

    const received=await phase('15-complete-customer-receiving',async()=>{
      const input=firstPackage.file;
      const inspect=await invoke('customer','first-delivery-inspect','importWorkspace',()=>({path:input.path,mode:'inspect',expectedBytes:input.bytes,expectedSha256:input.sha256}));
      requireValue(inspect.result.canMerge===true&&inspect.result.sourceWorkspaceId===producer.store.id,
        'SUPPLIER_ORDERS_NATIVE_RECEIVING_IDENTITY','The inspected package does not select the original producer.');
      const merge=await invoke('customer','first-delivery-merge','importWorkspace',()=>({path:input.path,mode:'merge',expectedBytes:input.bytes,expectedSha256:input.sha256}));
      const current=customer.order({orderId});
      same(summary(current),validCurrent.order,'The complete first customer receiving changed the original selected order.');
      for(const row of imported.documents){
        const record=customer.document({id:row.id});requireValue(record.sha256===row.sha256,'SUPPLIER_ORDERS_NATIVE_RECEIVED_DOCUMENT','An original received publisher record changed.');
        await fileIdentity((await customer.exportFile({id:row.id})).path,row.source);
      }
      return{order:summary(current),inspect:clone(inspect.result),merge:clone(merge.result)};
    });
    const customerRevision=await phase('16-customer-local-invoice-revision',async()=>{
      const value=await finishDraft('customer','customer-local-invoice',{base:received.order,kind:'INVOICE',priorDraftId:exponentInvoice.draftId,roundingPolicy:policy,
        reason:'Customer receiving: save an independent local revision of the inherited invoice with its reviewed complete source.',
        edit(document){notice(document,'Customer revision retained independently from subsequent producer history.');}});
      quantities(customer.order({orderId}),{[first]:{invoiced:firstOrdered},[second]:{invoiced:secondOrdered}});
      requireValue(value.draftRevision===exponentInvoice.draftRevision+1,'SUPPLIER_ORDERS_NATIVE_CUSTOMER_REVISION','The customer did not continue the original inherited draft revision.');
      return value;
    });
    const producerAhead1=await phase('17-producer-independent-history',async()=>{
      const value=await finishDraft('producer','producer-history-one',{base:validCurrent.order,kind:'INVOICE',priorDraftId:exponentInvoice.draftId,roundingPolicy:policy,
        reason:'Producer delivery: retain a separate revision of the same inherited invoice after the first complete customer handover.'});
      requireValue(value.draftRevision===customerRevision.draftRevision,'SUPPLIER_ORDERS_NATIVE_BRANCH','The independent producer and customer branches did not retain the same original revision number.');
      return value;
    });
    const producerAhead2=await phase('18-producer-ahead-history',async()=>{
      const value=await finishDraft('producer','producer-history-two',{base:producerAhead1.order,kind:'INVOICE',priorDraftId:exponentInvoice.draftId,roundingPolicy:policy,
        reason:'Producer delivery: retain a further full invoice revision for conflict-preserving customer receiving.'});
      requireValue(value.draftRevision>customerRevision.draftRevision&&value.order.revision>customerRevision.order.revision,
        'SUPPLIER_ORDERS_NATIVE_AHEAD_HISTORY','The selected complete producer history is not actually ahead of the customer branch.');
      return value;
    });
    const aheadPackage=await phase('19-complete-ahead-producer-package',async()=>{
      const file=await packageWorkspace('producer','ahead-delivery',producerAhead2.order);
      return{file,order:producerAhead2.order};
    });
    const aheadReceived=await phase('20-ahead-history-customer-merge',async()=>{
      const file=aheadPackage.file;
      const inspected=await invoke('customer','ahead-delivery-inspect','importWorkspace',()=>({path:file.path,mode:'inspect',expectedBytes:file.bytes,expectedSha256:file.sha256}));
      requireValue(inspected.result.canMerge===true,'SUPPLIER_ORDERS_NATIVE_AHEAD_INSPECT','The complete same-supplier ahead history could not be received.');
      const merged=await invoke('customer','ahead-delivery-merge','importWorkspace',()=>({path:file.path,mode:'merge',expectedBytes:file.bytes,expectedSha256:file.sha256}));
      const current=customer.order({orderId}),draft=customer.draft({draftId:customerRevision.draftId});
      same(summary(current),customerRevision.order,'Receiving ahead history replaced the customer current order.');
      requireValue(draft.revision===customerRevision.draftRevision&&draft.sha256===customerRevision.draftSha256,
        'SUPPLIER_ORDERS_NATIVE_CUSTOMER_DRAFT','Receiving ahead history replaced the customer saved draft.');
      requireValue((merged.result.foreign.supplier_order_draft_history??0)>0&&(merged.result.foreign.supplier_order_history??0)>0,
        'SUPPLIER_ORDERS_NATIVE_FOREIGN_HISTORY','The ahead draft and order history did not remain as complete foreign branch records.');
      return{order:summary(current),draftId:draft.id,draftRevision:draft.revision,merge:clone(merged.result)};
    });
    const customerFinal=await phase('21-customer-next-local-revision',async()=>{
      const value=await finishDraft('customer','customer-after-ahead',{base:aheadReceived.order,kind:'INVOICE',priorDraftId:customerRevision.draftId,roundingPolicy:policy,
        reason:'Customer receiving: continue the local draft and order sequence after retaining a producer history with the same upcoming revision numbers.',
        edit(document){notice(document,'Customer continuation after received ahead history.');}});
      requireValue(value.draftRevision===customerRevision.draftRevision+1&&value.draftRevision===producerAhead2.draftRevision,
        'SUPPLIER_ORDERS_NATIVE_LOCAL_CONTINUATION','The customer could not use its next local revision after receiving ahead history.');
      quantities(customer.order({orderId}),{[first]:{invoiced:firstOrdered,dispatched:firstOrdered},[second]:{invoiced:secondOrdered,dispatched:secondOrdered}});
      return value;
    });
    const customerDelivery=await phase('22-older-package-replay-and-customer-delivery',async()=>{
      const firstInput=await maybeJSON(join(directory,'requests','customer-first-delivery-merge.json'));
      const original=await customer.importWorkspace(clone(firstInput.request));
      requireValue(original.state==='COMPLETE'&&original.id===originalRequestId(operationId,'customer','first-delivery-merge'),
        'SUPPLIER_ORDERS_NATIVE_RECEIVING_REPLAY','The original complete customer receive did not reopen its retained outcome.');
      const older=await invoke('customer','older-delivery-receive','importWorkspace',()=>({path:firstPackage.file.path,mode:'merge',
        expectedBytes:firstPackage.file.bytes,expectedSha256:firstPackage.file.sha256}));
      const current=customer.order({orderId}),draft=customer.draft({draftId:customerFinal.draftId});
      same(summary(current),customerFinal.order,'The earlier complete producer package replaced a later customer order.');
      requireValue(draft.revision===customerFinal.draftRevision&&draft.sha256===customerFinal.draftSha256,
        'SUPPLIER_ORDERS_NATIVE_CUSTOMER_DRAFT','The earlier producer package replaced the customer final draft.');
      const file=await packageWorkspace('customer','completed-customer',customerFinal.order);
      return{order:summary(current),file,draftId:draft.id,draftRevision:draft.revision,draftSha256:draft.sha256,
        earlierRequestReopened:original.id,olderReceiving:clone(older.result)};
    });

    const documents=[];
    for(const role of ['producer','customer']){
      const workspace=workspaces()[role];let offset=0;
      for(;;){
        const page=workspace.documents({orderId,offset,limit:100});
        requireValue(page.items.length>0||offset>=page.total,'SUPPLIER_ORDERS_NATIVE_PAGE','The original document history page made no progress.');
        for(const row of page.items){
          const record=workspace.document({id:row.id}),file=await workspace.exportFile({id:record.id});
          await fileIdentity(file.path,record.source);
          documents.push({role,id:record.id,sha256:record.sha256,kind:record.kind,documentId:record.documentId,
            revision:record.revision,source:{bytes:record.source.bytes,sha256:record.source.sha256}});
        }
        offset+=page.items.length;if(offset>=page.total)break;
      }
    }
    const producerFinal=summary(producer.order({orderId})),customerFinalOrder=summary(customer.order({orderId}));
    same(producerFinal,producerAhead2.order,'The original producer changed during the full receiving operation.');
    same(customerFinalOrder,customerFinal.order,'The customer changed during its final portable delivery.');
    await closeAll();

    producer=await openSupplierOrderWorkspace({directory:producerDirectory});
    customer=await openSupplierOrderWorkspace({directory:customerDirectory});closed=false;
    same({producer:{directory:producerDirectory,workspaceId:producer.store.id},customer:{directory:customerDirectory,workspaceId:customer.store.id}},
      identities,'A native workspace identity changed on final reopen.');
    same(summary(producer.order({orderId})),producerFinal,'The original producer state changed after SQLite close/reopen.');
    same(summary(customer.order({orderId})),customerFinalOrder,'The final customer state changed after SQLite close/reopen.');
    const reopenedDraft=customer.draft({draftId:customerFinal.draftId});
    requireValue(reopenedDraft.revision===customerFinal.draftRevision&&reopenedDraft.sha256===customerFinal.draftSha256,
      'SUPPLIER_ORDERS_NATIVE_FINAL_DRAFT','The final customer draft changed after native reopen.');
    for(const receipt of operations.values())await verifyReceipt(receipt);
    for(const record of documents){
      const workspace=workspaces()[record.role],current=workspace.document({id:record.id});
      requireValue(current.sha256===record.sha256,'SUPPLIER_ORDERS_NATIVE_FINAL_DOCUMENT','An immutable original document changed after native reopen.');
      await fileIdentity((await workspace.exportFile({id:record.id})).path,record.source);
    }
    for(const file of artifactMap.values())await fileIdentity(file.path,file);
    observations.push({phase:'23-native-close-reopen',producerWorkspaceId:producer.store.id,customerWorkspaceId:customer.store.id,
      documents:documents.length,operations:operations.size,completeFiles:artifactMap.size,
      producerOrder:producerFinal,customerOrder:customerFinalOrder,customerDraft:{id:reopenedDraft.id,revision:reopenedDraft.revision,sha256:reopenedDraft.sha256}});
    await closeAll();
    const report={schema:SUPPLIER_ORDERS_NATIVE_SCHEMA,operationId,status:'PASS',lifetimes:'CLOSED',
      startedAt:input.startedAt,completedAt:new Date().toISOString(),selection,
      implementation:activeImplementation,firstImplementation:input.firstImplementation,
      sourceInputs:clone(sourceInputs),publisher:clone(index.source),
      workspaces:{producer:{...identities.producer,orderId},customer:{...identities.customer,orderId}},
      artifacts:{producerPackage:aheadPackage.file,customerPackage:customerDelivery.file,firstProducerPackage:firstPackage.file,
        report:{path:join(directory,'report.json')}},
      current:{producerOrderRevision:producerFinal.revision,customerOrderRevision:customerFinalOrder.revision,
        producerOrderStateSha256:producerFinal.stateSha256,customerOrderStateSha256:customerFinalOrder.stateSha256,
        producerDraftId:producerAhead2.draftId,producerDraftRevision:producerAhead2.draftRevision,
        customerDraftId:customerFinal.draftId,customerDraftRevision:customerFinal.draftRevision},
      calibration:calibrated,sourceBindingRejection,phases,observations,operations:[...operations.values()],documents,
      artifactFiles:[...artifactMap.values()],
      outcome:{ordered:{[first]:firstOrdered,[second]:secondOrdered},unit:'C62',currency:originalOrder.header.currency,
        originalPrices:originalAmounts,invoiceNet:invoice.net,invoiceTax:invoice.tax,
        cancellations:'Selected current revisions replace the previous cancellation quantity.',
        dispatches:'The revised first dispatch replaces its earlier contribution; the second dispatch uses exact remaining quantities.',
        invoices:'Current invoice revisions preserve exact numeric lexemes and native delivery-note references.',
        receiving:'Customer current selections and local revision numbers survive ahead-history import and older-package replay.'}};
    await immutableJSON(join(directory,'report.json'),report);
    onProgress({phase:'complete',state:'PASS',lifetimes:'CLOSED',report:join(directory,'report.json')});
    return report;
  }catch(error){primaryError=error;throw error;}
  finally{
    let closeError=null;
    if(!closed){try{await closeAll();}catch(error){closeError=error;}}
    if(primaryError||closeError){
      const record={schema:SUPPLIER_ORDERS_NATIVE_SCHEMA,operationId,status:'INCOMPLETE',
        lifetimes:closed?'CLOSED':'OPEN',at:new Date().toISOString(),phase:activePhase?.name??null,
        implementationSha256:activeImplementation.sha256,error:failure(primaryError??closeError),
        ...(closeError?{closeError:failure(closeError)}:{}),completedPhases:phases.map(value=>value.name)};
      await immutableJSON(join(directory,'attempts','incomplete-'+randomUUID()+'.json'),record).catch(()=>{});
      if(closeError&&!primaryError)throw closeError;
    }
  }
}

export const supplierOrdersNativeHelp='Supplier orders original receiving\n\n'+
  '  node supplier-orders-native.mjs --directory OUTPUT --producer-workspace DIR --customer-workspace DIR\n'+
  '    [--source-index ORIGINAL_INDEX.json] [--operation-id ORIGINAL_OPERATION]\n\n'+
  'Use the same explicit output, producer, customer and operation on continuation.\n'+
  'The original native request journal retains all business writes; completed reports reopen their exact files.\n';
export async function runSupplierOrdersNativeCLI(args=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}){
  const options={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--help'){stdout.write(supplierOrdersNativeHelp);return{help:true};}
    requireValue(['--directory','--producer-workspace','--customer-workspace','--source-index','--operation-id'].includes(arg),
      'SUPPLIER_ORDERS_NATIVE_OPTION','Unknown original receiving option '+arg+'.');
    requireValue(!own(options,arg)&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'),
      'SUPPLIER_ORDERS_NATIVE_OPTION','Supply each complete receiving option once.');
    options[arg]=args[++i];
  }
  const controller=new AbortController(),stop=()=>controller.abort(Object.assign(new Error('The original receiving invocation was interrupted.'),{code:'SUPPLIER_ORDERS_NATIVE_ABORTED'}));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await runSupplierOrderNativeReceiving({directory:options['--directory'],producerDirectory:options['--producer-workspace'],
      customerDirectory:options['--customer-workspace'],...(options['--source-index']?{sourceIndexPath:options['--source-index']}:{}),
      ...(options['--operation-id']?{operationId:options['--operation-id']}:{}),signal:controller.signal,
      onProgress:value=>stderr.write(JSON.stringify(value)+'\n')});
    stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSupplierOrdersNativeCLI().catch(error=>{process.stderr.write(JSON.stringify({error:failure(error)})+'\n');process.exitCode=1;});
}
