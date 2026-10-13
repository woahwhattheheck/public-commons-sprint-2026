// MIT. Authenticated borrower of the original Python HTTP application.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {readConnection} from './binding.mjs';
import {absolute,branch,plain,need,HASH,UUID,SOURCE_SHA256,MAX_BLOB,MAX_ARCHIVE,localUrl,canonical,sha} from './contract.mjs';
export class HighwayFieldError extends Error{
 constructor(code,message,{status=null,result=null,uncertain=false,operation=null}={}){
  super(message);this.name='HighwayFieldError';Object.assign(this,{code,status,result,uncertain,operation});
 }
}
const integer=(n,max=Number.MAX_SAFE_INTEGER)=>{need(Number.isSafeInteger(n)&&n>=0&&n<=max,'INTEGER');return n;};
const id=value=>{need(UUID.test(value??''),'ID');return value;};
const hash=value=>{need(HASH.test(value??''),'HASH');return value;};
const signature=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
async function readResponse(response,maximum,onChunk){
 const declared=response.headers.get('content-length');if(declared!==null)need(/^\d+$/.test(declared)&&Number(declared)<=maximum,'RESPONSE_CAPACITY');
 const parts=[],h=createHash('sha256');let size=0;
 try{for await(const value of response.body??[]){
  const part=Buffer.from(value);size+=part.length;need(size<=maximum,'RESPONSE_CAPACITY');h.update(part);
  if(onChunk)await onChunk(part);else parts.push(part);
 }}catch(error){try{await response.body?.cancel();}catch{}throw error;}
 need(declared===null||size===Number(declared),'RESPONSE_INCOMPLETE');
 return {bytes:size,sha256:h.digest('hex'),...(onChunk?{}:{data:Buffer.concat(parts,size)})};
}
export class HighwayFieldClient{
 #file;#owner;#branch;#timeout;#closed=false;#pending=new Set();
 constructor({connectionFile,workspaceId,workspaceDirectory,timeoutMs=300000}){
  this.#file=absolute(connectionFile);this.#owner={workspaceId:id(workspaceId),workspaceDirectory:absolute(workspaceDirectory)};
  this.#branch=branch({id:workspaceId,directory:workspaceDirectory});
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=3600000,'TIMEOUT');this.#timeout=timeoutMs;
 }
 get selectedBranch(){return {...this.#branch};}
 get connectionFile(){return this.#file;}
 async #perform(path,{method='GET',query={},body,raw,onChunk,maximum=MAX_ARCHIVE,operation=null,selected=true}={}){
  need(!this.#closed,'CLIENT_CLOSED');
  const saved=await readConnection(this.#file,this.#owner),url=localUrl(saved.url);
  const target=new URL(path,url);for(const [key,value]of Object.entries(query))if(value!==undefined&&value!==null)target.searchParams.set(key,String(value));
  const headers={'Authorization':'Bearer '+url.hash.slice(1)};
  if(selected){headers['X-Workspace-Id']=this.#branch.id;headers['X-Workspace-Directory']=this.#branch.directory;}
  let payload;if(body!==undefined){payload=canonical(body);headers['Content-Type']='application/json';headers['Content-Length']=String(Buffer.byteLength(payload));need(Buffer.byteLength(payload)<=24*1024*1024,'REQUEST_CAPACITY');}
  if(raw){payload=raw.body;headers['Content-Type']='application/octet-stream';headers['Content-Length']=String(raw.bytes);headers['X-Content-SHA256']=raw.sha256;}
  let response;
  try{
   response=await fetch(target,{method,headers,body:payload,...(raw?.stream?{duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(this.#timeout)});
  }catch(error){throw new HighwayFieldError('HIGHWAY_FIELD_TRANSPORT','The original local request did not return. Reconcile its retained identity before repeating effects.',{uncertain:method!=='GET',operation});}
  if(!response.ok){
   let result;try{const received=await readResponse(response,1024*1024);result=JSON.parse(received.data.toString('utf8'));}catch{result={error:{code:'HTTP_'+response.status,message:'The original error body was unavailable.'}};}
   throw new HighwayFieldError(result?.error?.code??'HTTP_'+response.status,result?.error?.message??'Original request failed.',
    {status:response.status,result,operation,uncertain:method!=='GET'&&result?.notCommitted!==true});
  }
  try{
   const received=await readResponse(response,maximum,onChunk);
   if(onChunk)return {...received,mediaType:response.headers.get('content-type')??'application/octet-stream'};
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(received.data));
  }catch(error){
   throw new HighwayFieldError(error.code??'HIGHWAY_FIELD_RESPONSE',error.message,{status:response.status,operation,uncertain:method!=='GET'});
  }
 }
 #track(job){need(!this.#closed,'CLIENT_CLOSED');need(this.#pending.size===0,'CLIENT_BUSY','Await the original call before another branch operation.');const pending=Promise.resolve().then(job);this.#pending.add(pending);pending.then(()=>this.#pending.delete(pending),()=>this.#pending.delete(pending));return pending;}
 #selectedBody(value){return {...value,workspaceId:this.#branch.id,workspaceDirectory:this.#branch.directory};}
 async #state(){
  const value=await this.#perform('/api/state',{selected:false});
  need(value.sourceSha256===SOURCE_SHA256&&value.state?.id===this.#branch.id&&value.directory===this.#branch.directory,'BRANCH_CHANGED','Explicitly open the intended physical branch; no request is rerouted automatically.');
  return value;
 }
 state(){return this.#track(()=>this.#state());}
 history({offset=0,limit=100}={}){return this.#track(()=>this.#perform('/api/history',{query:{offset:integer(offset),limit:integer(limit,100)}}));}
 request(requestId){id(requestId);return this.#track(()=>this.#perform('/api/request',{query:{id:requestId}}));}
 records(captureId,layerId,{offset=0,limit=100}={}){id(captureId);integer(layerId);integer(offset);integer(limit,250);return this.#track(()=>this.#perform('/api/records',{query:{capture:captureId,layer:layerId,offset,limit}}));}
 inspection(inspectionId){id(inspectionId);return this.#track(()=>this.#perform('/api/inspection',{query:{id:inspectionId}}));}
 fieldIssue(request,expectedRevision){
  need(plain(request),'FIELD_ISSUE');integer(expectedRevision);id(request.id);
  const body=JSON.parse(canonical(this.#selectedBody({request,expectedRevision})));
  return this.#track(()=>this.#perform('/api/field-issue',{method:'POST',body,operation:{kind:'field.issue',requestId:body.request.id,expectedRevision}}));
 }
 fieldComparison(returnId,editionId,adoptionId){
  id(returnId);if(editionId!==undefined)need(typeof editionId==='string'&&editionId.length>0&&editionId.length<=180,'FIELD_EDITION');
  if(adoptionId!==undefined)id(adoptionId);const query={id:returnId,edition:editionId,adoption:adoptionId};
  return this.#track(()=>this.#perform('/api/field-compare',{query}));
 }
 fieldDocument(kind,recordId){
  need(['issues','returns'].includes(kind),'FIELD_KIND');id(recordId);const query={kind,id:recordId};
  return this.#track(()=>this.#perform('/api/field-document',{query}));
 }
 nativeRequest(operationId){id(operationId);return this.#track(()=>this.#perform('/api/native-request',{query:{id:operationId}}));}
 prepareDataset(operationId,selection){
  id(operationId);need(plain(selection),'SELECTION');const body=JSON.parse(canonical(this.#selectedBody({operationId,selection})));
  return this.#track(()=>this.#perform('/api/dataset',{method:'POST',body,operation:{kind:'dataset',operationId}}));
 }
 native(operationId,operation,input){
  id(operationId);need(['status','inspect-delivery','review-import','import','review-pair','save-pair','run','decision','report','request','resume','read','page','row','export','receive'].includes(operation),'NATIVE_OPERATION');
  need(plain(input),'NATIVE_INPUT');const body=JSON.parse(canonical(this.#selectedBody({operationId,operation,body:input})));
  return this.#track(()=>this.#perform('/api/native',{method:'POST',body,operation:{kind:'native',operationId,operation}}));
 }
 restoreNative(recordId,operationId){
  id(recordId);id(operationId);const body=this.#selectedBody({recordId,operationId});
  return this.#track(()=>this.#perform('/api/native-restore',{method:'POST',body,operation:{kind:'native-restore',recordId,operationId}}));
 }
 /** Pages remain original complete envelopes. A changing source/total stops traversal. */
 pages(kind,selection={},options={}){return this.#pages(kind,JSON.parse(canonical(selection)),JSON.parse(canonical(options)),canonical(this.#branch));}
 async *#pages(kind,selection,options,selected){
  need(['history','records'].includes(kind),'PAGE_KIND');
  let offset=0,basis=null;do{
   need(canonical(this.#branch)===selected,'BRANCH_CHANGED');
   const page=kind==='history'?await this.history({...options,offset}):await this.records(selection.captureId,selection.layerId,{...options,offset});
   need(page.offset===offset&&Number.isSafeInteger(page.total),'PAGE_CHANGED');
   const identity=canonical({total:page.total,captureId:page.captureId??null,layerId:page.layerId??null,sourceSha256:page.sourceSha256??null});
   if(basis!==null)need(identity===basis,'PAGE_CHANGED','Retain earlier returned pages and select a stable original report.');else basis=identity;
   yield page;const next=page.nextOffset;need(next===null||Number.isSafeInteger(next)&&next>offset&&next<page.total,'PAGE_CHANGED');offset=next;
  }while(offset!==null);
 }
 command(command,expectedRevision){
  need(plain(command)&&UUID.test(command.requestId??''),'COMMAND');integer(expectedRevision);
  // Freeze the complete original envelope before dispatch; the server remains its memoization authority.
  const body=JSON.parse(canonical(this.#selectedBody({command,expectedRevision})));
  return this.#track(()=>this.#perform('/api/command',{method:'POST',body,operation:{kind:'command',requestId:body.command.requestId,expectedRevision}}));
 }
 exportWorkspace(publicationId,revision){
  id(publicationId);integer(revision);const body=this.#selectedBody({publicationId,revision});
  return this.#track(()=>this.#perform('/api/export',{method:'POST',body,operation:{kind:'export',publicationId,revision}}));
 }
 receive({operationId,sha256,bytes}){
  id(operationId);hash(sha256);integer(bytes,MAX_ARCHIVE);
  const body=this.#selectedBody({operationId,sha256,bytes});
  return this.#track(()=>this.#perform('/api/receive',{method:'POST',body,operation:{kind:'receive',operationId,sha256,bytes}}));
 }
 uploadBytes(kind,data,expected){
  expected={bytes:expected.bytes,sha256:expected.sha256};
  need(['blob','archive','field-file'].includes(kind)&&Buffer.isBuffer(data),'UPLOAD');hash(expected.sha256);integer(expected.bytes,kind==='archive'?MAX_ARCHIVE:MAX_BLOB);
  need(data.length===expected.bytes&&sha(data)===expected.sha256,'FILE_CHANGED');const frozen=Buffer.from(data);
  return this.#track(async()=>{
   const result=await this.#perform('/api/'+kind,{method:'POST',raw:{body:frozen,bytes:frozen.length,sha256:expected.sha256},operation:{kind:'upload-'+kind,...expected}});
   need(result.sha256===expected.sha256&&result.bytes===expected.bytes,'UPLOAD_CHANGED');return result;
  });
 }
 uploadFile(kind,file,expected){expected={bytes:expected.bytes,sha256:expected.sha256};return this.#track(async()=>{
  need(['blob','archive','field-file'].includes(kind),'UPLOAD');absolute(file);hash(expected.sha256);integer(expected.bytes,kind==='archive'?MAX_ARCHIVE:MAX_BLOB);
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const before=await handle.stat({bigint:true});need(before.isFile()&&before.size===BigInt(expected.bytes),'FILE_CHANGED');
   const h=createHash('sha256'),buffer=Buffer.alloc(262144);let position=0;
   while(position<expected.bytes){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected.bytes-position),position);need(bytesRead>0,'FILE_CHANGED');h.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
   need(h.digest('hex')===expected.sha256&&signature(before)===signature(await handle.stat({bigint:true})),'FILE_CHANGED');
   async function* content(){
    let at=0;while(at<expected.bytes){const b=Buffer.alloc(Math.min(262144,expected.bytes-at)),r=await handle.read(b,0,b.length,at);need(r.bytesRead===b.length,'FILE_CHANGED');at+=b.length;yield b;}
   }
   const result=await this.#perform('/api/'+kind,{method:'POST',raw:{body:content(),stream:true,bytes:expected.bytes,sha256:expected.sha256},operation:{kind:'upload-'+kind,...expected}});
   need(result.sha256===expected.sha256&&result.bytes===expected.bytes,'UPLOAD_CHANGED');return result;
  }finally{await handle.close();}
 });}
 download({kind,id:recordId,expectedSha256,expectedBytes},onChunk){
  need(typeof onChunk==='function','DOWNLOAD','Consume and retain the complete streamed file.');
  let path,query={};if(kind==='blob'){hash(recordId);path='/api/blob';query={sha256:recordId};expectedSha256=recordId;}
  else if(kind==='archive'){path='/api/export';query={id:id(recordId)};hash(expectedSha256);integer(expectedBytes,MAX_ARCHIVE);}
  else if(['field-issue-json','field-issue-html','field-return'].includes(kind)){
   path='/api/field-file';query={kind:kind==='field-return'?'returns':'issues',id:id(recordId),format:kind==='field-return'?'original':kind==='field-issue-html'?'html':'json'};
   hash(expectedSha256);integer(expectedBytes,MAX_BLOB);
  }
  else{need(kind==='dispatch-report','DOWNLOAD_KIND');path='/api/dispatch-report';query={id:id(recordId)};}
  return this.#track(async()=>{
   const result=await this.#perform(path,{query,onChunk,maximum:kind==='archive'?MAX_ARCHIVE:MAX_BLOB});
   need(expectedSha256===undefined||result.sha256===expectedSha256,'DOWNLOAD_CHANGED');
   need(expectedBytes===undefined||result.bytes===expectedBytes,'DOWNLOAD_CHANGED');return result;
  });
 }
 async close(){this.#closed=true;await Promise.allSettled([...this.#pending]);}
}
export const createHighwayFieldClient=options=>new HighwayFieldClient(options);
