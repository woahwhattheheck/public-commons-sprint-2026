// MIT. Managed Curriculum workspace borrower; the original Oak API SDK stays in app/.
import {createHash} from 'node:crypto';
import {readConnection} from './binding.mjs';
import {absolute,need,HASH,UUID,SOURCE_SHA256,localUrl,canonical,sha,bytes} from './contract.mjs';
const MAXIMUM=160*1024*1024,WORKSPACE=128*1024*1024,SOURCE_FILE=16*1024*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),clone=v=>JSON.parse(canonical(v));
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>{need(Number.isSafeInteger(v)&&v>=0&&v<=max,'INTEGER');return v;};
function id(value){need(typeof value==='string'&&value.length>0&&value.length<=180,'IDENTITY');return value;}
function expected(value){need(plain(value)&&typeof value.workspaceId==='string'&&Number.isSafeInteger(value.revision)&&value.revision>=0&&HASH.test(value.snapshotSha256??''),'EXPECTED');return{workspaceId:value.workspaceId,revision:value.revision,snapshotSha256:value.snapshotSha256};}
function selected(input){const value=clone(input);value.id=id(value.id);value.expected=expected(value.expected);return value;}
function descriptor(value,maximum=MAXIMUM){if(value===undefined)return null;const v={bytes:value.bytes,sha256:value.sha256};integer(v.bytes,maximum);need(HASH.test(v.sha256??''),'FILE');return v;}
export class CurriculumMigrationError extends Error{
 constructor(code,message,{status=null,result=null,uncertain=false,requestId=null}={}){super(message);this.name='CurriculumMigrationError';Object.assign(this,{code,status,result,uncertain,requestId});}
}
async function responseBytes(response,maximum,onChunk){
 const declared=response.headers.get('content-length');need(declared===null||/^\d+$/.test(declared)&&Number(declared)<=maximum,'RESPONSE_CAPACITY');
 const hash=createHash('sha256'),chunks=[];let count=0;
 try{for await(const chunk of response.body??[]){const raw=Buffer.from(chunk);count+=raw.length;need(count<=maximum,'RESPONSE_CAPACITY');hash.update(raw);if(onChunk)await onChunk(raw);else chunks.push(raw);}}
 catch(error){try{await response.body?.cancel();}catch{}throw error;}
 need(declared===null||count===Number(declared),'RESPONSE_INCOMPLETE');
 return{bytes:count,sha256:hash.digest('hex'),...(onChunk?{}:{data:Buffer.concat(chunks,count)})};
}
export class CurriculumMigrationClient{
 #file;#owner;#timeout;#pending=new Set();#closing=false;
 constructor({connectionFile,storeId,storeDirectory,timeoutMs=300000}){
  need(UUID.test(storeId??''),'STORE');this.#file=absolute(connectionFile);this.#owner={storeId,workspaceDirectory:absolute(storeDirectory)};
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=3600000,'TIMEOUT');this.#timeout=timeoutMs;
 }
 get selectedStore(){return{storeId:this.#owner.storeId,storeDirectory:this.#owner.workspaceDirectory};}
 #track(job){need(!this.#closing,'CLIENT_CLOSED');need(this.#pending.size===0,'CLIENT_BUSY','Await the original call before another managed operation.');const promise=Promise.resolve().then(job);this.#pending.add(promise);promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;}
 async #call(path,{body,query={},mutation=false,binary,onChunk,maximum=MAXIMUM}={}){
  const connection=await readConnection(this.#file,this.#owner),base=localUrl(connection.url),url=new URL(path,base);
  for(const[k,v]of Object.entries(query))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
  const headers={Authorization:'Bearer '+base.hash.slice(1),'X-Curriculum-Store-Id':this.#owner.storeId,'X-Curriculum-Store-Directory':this.#owner.workspaceDirectory};
  let content;if(body!==undefined){content=canonical(body);need(Buffer.byteLength(content)<=MAXIMUM,'REQUEST_CAPACITY');headers['Content-Type']='application/json';headers['Content-Length']=String(Buffer.byteLength(content));}
  let response;try{response=await fetch(url,{method:body===undefined?'GET':'POST',body:content,headers,redirect:'error',signal:AbortSignal.timeout(this.#timeout)});}
  catch(error){throw new CurriculumMigrationError('CURRICULUM_MIGRATION_TRANSPORT','The original local request has no returned outcome. Inspect its original request before repeating a mutation.',{uncertain:mutation,requestId:body?.requestId??null});}
  if(!response.ok){
   let result;try{result=JSON.parse((await responseBytes(response,1024*1024)).data.toString('utf8'));}catch{result={error:{code:'HTTP_'+response.status,message:'The original error body is unavailable.'}};}
   throw new CurriculumMigrationError(result.error?.code??'HTTP_'+response.status,result.error?.message??'Original managed request failed.',{status:response.status,result,uncertain:mutation&&result.notCommitted!==true,requestId:body?.requestId??result.requestId??null});
  }
  try{
   let advertised;
   if(binary){
    const n=response.headers.get('x-curriculum-source-bytes'),hash=response.headers.get('x-curriculum-source-sha256');
    need(/^(0|[1-9][0-9]*)$/.test(n??'')&&Number.isSafeInteger(Number(n))&&Number(n)<=maximum&&HASH.test(hash??''),'FILE_RESPONSE');
    advertised={bytes:Number(n),sha256:hash};
    if(binary.expected)need(advertised.bytes===binary.expected.bytes&&advertised.sha256===binary.expected.sha256,'FILE_CHANGED');
    if(binary.branch)need(response.headers.get('x-curriculum-branch-id')===binary.branch.id&&response.headers.get('x-curriculum-snapshot-sha256')===binary.branch.expected.snapshotSha256,'BRANCH_CHANGED');
   }
   const received=await responseBytes(response,maximum,onChunk);
   if(binary){need(received.bytes===advertised.bytes&&received.sha256===advertised.sha256,'FILE_CHANGED');return{bytes:received.bytes,sha256:received.sha256,mediaType:response.headers.get('content-type')??'application/octet-stream'};}
   const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(received.data));need(envelope.ok===true&&Object.hasOwn(envelope,'result'),'RESPONSE');return envelope.result;
  }catch(error){try{await response.body?.cancel();}catch{}throw new CurriculumMigrationError(error.code??'CURRICULUM_MIGRATION_RESPONSE',error.message,{status:response.status,uncertain:mutation,requestId:body?.requestId??null});}
 }
 state(){return this.#track(async()=>{const state=await this.#call('/api/state');need(state.id===this.#owner.storeId&&state.directory===this.#owner.workspaceDirectory&&state.sourceSha256===SOURCE_SHA256,'STORE_CHANGED');return state;});}
 branches(){return this.#track(()=>this.#call('/api/branches'));}
 branch(value){const selectedId=id(value);return this.#track(()=>this.#call('/api/branches/'+encodeURIComponent(selectedId)));}
 request(requestId){need(typeof requestId==='string'&&requestId.length>0&&requestId.length<=200,'REQUEST');return this.#track(()=>this.#call('/api/requests/'+encodeURIComponent(requestId)));}
 #mutation(path,input){const body=clone(input);need(UUID.test(body.requestId??''),'REQUEST','Supply one original request UUID before dispatch.');return this.#track(()=>this.#call(path,{body,mutation:true}));}
 createBranch(input){const body=clone(input);id(body.id);body.origin??={};return this.#mutation('/api/branches/create',body);}
 command(input){return this.#mutation('/api/branches/command',selected(input));}
 report(input){const body=selected(input);return this.#track(()=>this.#call('/api/report',{body}));}
 historyPage(input){const body=selected(input);body.offset=integer(body.offset??0);body.limit=integer(body.limit??100,200);need(body.limit>0,'LIMIT');return this.#track(()=>this.#call('/api/history',{body}));}
 history(input){return this.#history(selected(input));}
 async *#history(input){
  let offset=0,total=null;do{
   const page=await this.historyPage({...input,offset});
   need(page.id===input.id&&page.offset===offset&&page.workspaceId===input.expected.workspaceId&&page.revision===input.expected.revision&&page.snapshotSha256===input.expected.snapshotSha256&&Number.isSafeInteger(page.total)&&page.total>=0&&Array.isArray(page.items)&&(total===null||page.total===total),'PAGE_CHANGED');
   total=page.total;const next=page.nextOffset;need(page.items.length<=total-offset&&(next===null?offset+page.items.length===total:Number.isSafeInteger(next)&&next===offset+page.items.length&&next>offset&&next<total),'PAGE_CHANGED');
   yield page;offset=next;
  }while(offset!==null);
 }
 exportBranch(input){const body=selected(input);return this.#track(()=>this.#call('/api/branches/export',{body}));}
 download(input,onChunk,want){
  const body=selected(input),frozen=descriptor(want);need(typeof onChunk==='function','CHUNK_CONSUMER');
  return this.#track(()=>this.#call('/api/download',{body,onChunk,binary:{expected:frozen,branch:body}}));
 }
 downloadAsset(input,onChunk,want){
  const value=selected(input),frozen=descriptor(want,WORKSPACE);id(value.assetId);need(typeof onChunk==='function','CHUNK_CONSUMER');
  return this.#track(()=>this.#call('/api/branches/'+encodeURIComponent(value.id)+'/assets/'+encodeURIComponent(value.assetId),{query:value.expected,onChunk,maximum:WORKSPACE,binary:{expected:frozen,branch:value}}));
 }
 downloadApplicationSource(path,onChunk,want){
  need(typeof path==='string'&&path.length>0&&!path.startsWith('/')&&!path.includes('\\')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'SOURCE_PATH');
  const frozen=descriptor(want,SOURCE_FILE);need(typeof onChunk==='function','CHUNK_CONSUMER');
  return this.#track(()=>this.#call('/api/application-source/'+encodeURIComponent(path),{onChunk,maximum:SOURCE_FILE,binary:{expected:frozen}}));
 }
 receiveFile(input,file,want){
  const frozen=clone(input),path=absolute(file),selection=descriptor(want,WORKSPACE);need(selection&&UUID.test(frozen.requestId??''),'FILE');id(frozen.id);
  return this.#track(async()=>{
   const raw=await bytes(path,WORKSPACE);need(raw.length===selection.bytes&&sha(raw)===selection.sha256,'FILE_CHANGED');
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),snapshot=value.format==='curriculum-workspace-export.v1'?value.workspace:value;
   if(value.format==='curriculum-workspace-export.v1')need(value.sha256===sha(canonical(snapshot)),'SNAPSHOT_HASH');
   const body={...frozen,snapshot,origin:{...(frozen.origin??{}),kind:'PORTABLE_RECEIVE',receivedFileSha256:selection.sha256,receivedFileBytes:selection.bytes}};
   return this.#call('/api/branches/create',{body,mutation:true});
  });
 }
 #importFile(input,file,want,kind){
  const frozen=selected(input),path=absolute(file),selection=descriptor(want,WORKSPACE);need(selection&&UUID.test(frozen.requestId??'')&&frozen.command?.kind===kind,'FILE_COMMAND');
  return this.#track(async()=>{
   const raw=await bytes(path,WORKSPACE);need(raw.length===selection.bytes&&sha(raw)===selection.sha256,'FILE_CHANGED');
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),command=frozen.command;let body;
   if(kind==='addAsset'){need(plain(command.body?.asset),'ASSET');body={asset:{...command.body.asset,content:text}};}
   else if(kind==='saveResponse'){need(plain(command.body?.response),'RESPONSE');body={...command.body,response:{...command.body.response,body:JSON.parse(text)}};}
   else body={edition:JSON.parse(text)};
   return this.#call('/api/branches/command',{body:{...frozen,command:{...command,body}},mutation:true});
  });
 }
 importAssetFile(input,file,want){return this.#importFile(input,file,want,'addAsset');}
 importResponseFile(input,file,want){return this.#importFile(input,file,want,'saveResponse');}
 importEditionFile(input,file,want){return this.#importFile(input,file,want,'addEdition');}
 async close(){this.#closing=true;await Promise.allSettled([...this.#pending]);}
}
export const createCurriculumMigrationClient=options=>new CurriculumMigrationClient(options);
