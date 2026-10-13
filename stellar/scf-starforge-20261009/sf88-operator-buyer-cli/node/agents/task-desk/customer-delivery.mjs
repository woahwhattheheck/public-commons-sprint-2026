// MIT. InboxTask desk composition of the original complete customer-delivery model.
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {openCustomerDelivery} from '../../../collections/delivery/model.mjs';
import {createSourceManifest} from '../../../collections/delivery/source.mjs';
import {fileHandle,MAX_PACKAGE} from '../../../collections/delivery/format.mjs';
import {optionalInitializationBytes} from '../../../initialization.mjs';

const ID=/^[A-Za-z0-9._-]{1,100}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function need(value,code,message,status=400){if(!value)throw Object.assign(new Error(message),{code,status});}
function below(a,b){const r=relative(a,b);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);}
export function validateCustomerDirectory(directory,privateRoots=[]){
 need(typeof directory==='string'&&isAbsolute(directory),'DESK_DELIVERY_DIRECTORY','Select an absolute private customer-delivery directory.');
 const result=resolve(directory);
 for(const root of privateRoots.filter(Boolean))need(!below(resolve(root),result)&&!below(result,resolve(root)),
  'DESK_DELIVERY_SEPARATE','Keep the customer-delivery store separate from the original Inbox, saved tasks and response packets.');
 return result;
}
function named(id){need(typeof id==='string'&&ID.test(id)&&id!=='.'&&id!=='..','DESK_DELIVERY_ID','Use a stable delivery ID of 1–100 letters, digits, dots, underscores or hyphens.');return id;}

export async function openTaskDeskDelivery({directory,privateRoots,openTask,outputPath}){
 directory=validateCustomerDirectory(directory,privateRoots);
 const original=await openCustomerDelivery({directory});let closing=false;
 function available(){need(!closing,'DESK_DELIVERY_CLOSING','The desk is closing; reopen the same customer-delivery store.',503);}
 async function task(taskId){return openTask(taskId);}
 async function selected(taskId,input){
  const current=await task(taskId);
  need(input&&typeof input.sourceRoot==='string'&&isAbsolute(input.sourceRoot),
    'DESK_DELIVERY_SOURCE_REQUIRED','Select the absolute complete executing application source root.');
  const selectedSource=resolve(input.sourceRoot);
  for(const root of [directory,...privateRoots].filter(Boolean))need(!below(selectedSource,resolve(root))&&!below(resolve(root),selectedSource),
    'DESK_DELIVERY_SOURCE_SEPARATE','Keep complete source separate from the private operating roots.');
  return {kind:'inbox-task',id:named(input.id),packetDirectory:outputPath(taskId),
   expectedTaskSha256:current.taskSha256,title:input.title,note:input.note,
   intentIds:input.intentIds,sourceRoot:input.sourceRoot,sourceManifest:input.sourceManifest};
 }
 function binding(value,current){
  need(value?.request?.kind==='inbox-task'&&value.request.expectedTaskSha256===current.taskSha256,
   'DESK_DELIVERY_OTHER_TASK','This named customer delivery belongs to another original task.',409);
 }
 async function inspect(taskId,id){const current=await task(taskId),value=await original.inspect(named(id));binding(value,current);return value;}
 async function list(taskId){
  const current=await task(taskId),all=await original.list(),deliveries=[],issues=[];
  for(const row of all.deliveries){
   try{
    // Read the original immutable intent for discovery; opening still verifies the complete package.
    const raw=await optionalInitializationBytes(join(directory,'deliveries',named(row.id),'intent.json'),32*1024*1024);
    const intent=raw?JSON.parse(raw):null;
    if(intent?.request?.kind==='inbox-task'&&intent.request.expectedTaskSha256===current.taskSha256)
     deliveries.push({...row,taskSha256:current.taskSha256});
   }catch(error){issues.push({id:row.id,code:error.code||'DESK_DELIVERY_INTENT_UNAVAILABLE',message:error.message});}
  }
  return {deliveries,issues};
 }
 async function inspectTask(taskId){const current=await task(taskId);return original.inspectTask({packetDirectory:outputPath(taskId),expectedTaskSha256:current.taskSha256});}
 async function preview(taskId,input){available();return original.previewTask(await selected(taskId,input));}
 async function prepare(taskId,input){
  available();need(input&&input.request&&typeof input.expectedPreviewSha256==='string','DESK_DELIVERY_PREVIEW_REQUIRED','Retain the complete reviewed selection and its preview hash.');
  // Capture all submitted bytes synchronously before native reads or session work.
  const request=JSON.parse(JSON.stringify(input.request)),expectedPreviewSha256=input.expectedPreviewSha256;
  const current=await task(taskId);named(request.id);
  need(request.kind==='inbox-task'&&request.expectedTaskSha256===current.taskSha256,
   'DESK_DELIVERY_OTHER_TASK','The reviewed delivery must name this exact original task.',409);
  let retained=null;
  try{retained=await original.inspect(request.id);}
  catch(error){if(!['ENOENT','CUSTOMER_DELIVERY_NOT_FOUND'].includes(error.code))throw error;}
  if(retained){
   binding(retained,current);
   need(same(retained.request,request)&&retained.previewSha256===expectedPreviewSha256,
    'DESK_DELIVERY_REQUEST_CHANGED','This delivery ID retains a different reviewed request. Reopen that exact operation.',409);
  }else{
   const expected=await selected(taskId,request);
   need(same(expected,request),'DESK_DELIVERY_SELECTION_CHANGED','The reviewed packet differs from the desk’s selected original packet. Preview the current selection.',409);
  }
  return original.prepareTask({...request,expectedPreviewSha256});
 }
 async function source(input){
  available();need(input&&typeof input.sourceRoot==='string'&&isAbsolute(input.sourceRoot)&&typeof input.destination==='string'&&isAbsolute(input.destination),
   'DESK_DELIVERY_SOURCE_REQUIRED','Select an absolute executing application root and a private manifest file outside it.');
  const sourceRoot=resolve(input.sourceRoot),destination=resolve(input.destination);
  for(const root of [directory,...privateRoots].filter(Boolean))need(!below(sourceRoot,resolve(root))&&!below(resolve(root),sourceRoot),
   'DESK_DELIVERY_SOURCE_SEPARATE','Keep the complete application source separate from private task, Inbox, response and delivery roots.');
  return createSourceManifest({sourceRoot,destination});
 }
 async function download(taskId,id,response){
  await inspect(taskId,id);const selection=await original.download(named(id)),{file}=await fileHandle(selection.path,selection,MAX_PACKAGE);
  const write=async bytes=>{need(!response.destroyed,'DESK_DELIVERY_DOWNLOAD_CLOSED','The download connection closed.',499);if(!response.write(bytes))await new Promise((done,fail)=>{const clear=()=>{response.off('drain',drain);response.off('close',closed);response.off('error',failed);};const drain=()=>{clear();done();},closed=()=>{clear();fail(new Error('The download connection closed.'));},failed=e=>{clear();fail(e);};response.once('drain',drain);response.once('close',closed);response.once('error',failed);if(response.destroyed)closed();});};
  try{
   const info=await file.stat();need(info.isFile()&&info.size===selection.bytes,'DESK_DELIVERY_FILE_CHANGED','The original complete customer package changed.',409);
   const buffer=Buffer.alloc(64*1024),before=createHash('sha256');let at=0;
   while(at<selection.bytes){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,selection.bytes-at),at);need(bytesRead>0,'DESK_DELIVERY_FILE_CHANGED','The complete package ended early.',409);before.update(buffer.subarray(0,bytesRead));at+=bytesRead;}
   need(before.digest('hex')===selection.sha256,'DESK_DELIVERY_FILE_CHANGED','The complete package differs from its saved identity.',409);
   response.writeHead(200,{'Content-Type':selection.mediaType,'Content-Length':selection.bytes,
    'Content-Disposition':'attachment; filename="'+selection.filename+'"','Cache-Control':'no-store','X-Content-SHA256':selection.sha256});
   at=0;const streamed=createHash('sha256');
   while(at<selection.bytes){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,selection.bytes-at),at);need(bytesRead>0,'DESK_DELIVERY_FILE_CHANGED','The package changed during download.',409);const chunk=Buffer.from(buffer.subarray(0,bytesRead));streamed.update(chunk);await write(chunk);at+=bytesRead;}
   need(streamed.digest('hex')===selection.sha256,'DESK_DELIVERY_FILE_CHANGED','The package changed during download.',409);response.end();
  }finally{await file.close();}
 }
 return {directory,list,inspectTask,preview,prepare,inspect,source,download,async close(){closing=true;await original.close();}};
}
