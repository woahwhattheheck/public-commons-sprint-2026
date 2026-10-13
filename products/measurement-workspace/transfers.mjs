// MIT. Full original files over the existing Measurements chunk/edition receiver.
// Files here are private transport custody; the original native engine owns all scientific state.
import {constants} from 'node:fs';
import {open,lstat,link,unlink,readdir} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withDirectoryLock} from '../../opportunities/upstate_forever_2026/measurement_workspace/engine/large_io.mjs';
import {need,canonical,sha256,regularFile,privateDirectory,saveClientJSON,saveClientBytes,copyClientFile,MAX_RESPONSE} from './client.mjs';
export const TRANSFER_SCHEMA='stellar-forge.measurement-file-transfer.v1';
export const CHUNK_BYTES=262144,MAX_TRANSFER_BYTES=8*1024*1024*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const identity=c=>({instanceId:c.instanceId,workspaceId:c.workspaceId,workspaceBinding:c.workspaceBinding,origin:c.origin,sourceManifestSha256:c.sourceManifestSha256,configurationSha256:c.configurationSha256});
const bytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const uuid=text=>{const h=sha256(Buffer.from(text));return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);};
const exactKeys=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const stamp=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
async function readJSON(file,maximum=32*1024*1024){return parse((await regularFile(file,{maximum,privateOnly:true,published:true})).body);}
async function optional(file){try{return await readJSON(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncDirectory(dir){const f=await open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function publish(stage,target,expected){
 try{await link(stage,target);}catch(e){if(e.code!=='EEXIST')throw e;const old=await regularFile(target,{maximum:expected.bytes,privateOnly:true,published:true,consume:false});need(old.bytes===expected.bytes&&old.sha256===expected.sha256,'Existing complete transfer file differs.');const f=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
 await syncDirectory(dirname(target));
}
async function copyOriginal(source,target,expected){
 await privateDirectory(dirname(target));const old=await optional(target+'.identity.json');
 if(old){need(canonical(old)===canonical(expected),'Original copy descriptor differs.');const found=await regularFile(target,{maximum:MAX_TRANSFER_BYTES,privateOnly:true,published:true,consume:false});need(found.bytes===expected.bytes&&found.sha256===expected.sha256,'Retained original file changed.');return;}
 const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),stage=join(dirname(target),'.download-'+randomUUID());let output;
 try{
  const before=await input.stat({bigint:true});need(before.isFile()&&before.nlink===1n&&Number(before.size)===expected.bytes,'Select the unchanged complete original regular file.');
  output=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const digest=createHash('sha256');let size=0;
  for await(const b of input.createReadStream({autoClose:false})){size+=b.length;need(size<=expected.bytes,'Original file grew during capture.');digest.update(b);await output.writeFile(b);}
  need(size===expected.bytes&&digest.digest('hex')===expected.sha256&&stamp(before)===stamp(await input.stat({bigint:true}))&&stamp(before)===stamp(await lstat(source,{bigint:true})),'Original file changed during capture.');
  await output.sync();await output.close();output=null;await publish(stage,target,expected);await saveClientJSON(target+'.identity.json',expected);
 }finally{await output?.close();await input.close();await unlink(stage).catch(()=>{});}
}
export function validateTransferInput(value){
 need(object(value)&&['upload','edition','source'].includes(value.kind),'Choose upload, edition or source transfer.');
 if(value.kind==='upload'){
  need(exactKeys(value,['kind','file','fileSha256','native'])&&typeof value.file==='string'&&HASH.test(value.fileSha256)&&exactKeys(value.native,['id','kind','label','mapping','origin']),'Pin a configured original file and exact native intake definition.');
  need(['wqp','stations','portable'].includes(value.native.kind)&&typeof value.native.label==='string'&&value.native.label.trim()&&value.native.label.length<=1000,'Name the original wqp, stations or complete portable source.');
  need(value.native.id===undefined||HASH.test(value.native.id),'Use the original native intake SHA identifier.');
  need(value.native.mapping===undefined||object(value.native.mapping),'Retain the native column mapping object.');
  need(value.native.origin===undefined||object(value.native.origin),'Retain the native source provenance object.');
 }else if(value.kind==='edition'){
  need(exactKeys(value,['kind','id','create','filters'])&&HASH.test(value.id)&&typeof value.create==='boolean'&&(value.filters===undefined||object(value.filters)),'Select an exact native edition ID and explicit create choice.');
  need(value.create||value.filters===undefined,'An existing edition retains its original filters.');
 }else need(exactKeys(value,['kind','id'])&&HASH.test(value.id),'Select an exact retained native source ID.');
 return value;
}
export function validateFileSet(value,kind,id){
 need(object(value)&&value.id===id&&value.format===(kind==='source'?'upper-savannah-original-source-files/v1':'upper-savannah-measurements-edition/v1')&&value.chunkBytes===CHUNK_BYTES&&Array.isArray(value.files)&&value.files.length>0&&value.files.length<=1000,'Choose a complete original file-set descriptor.');
 const names=new Set();let total=0;
 for(const f of value.files){
  need(object(f)&&typeof f.path==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(f.path)&&f.path!=='.'&&f.path!=='..'&&!names.has(f.path.toLowerCase()),'Original member names must be distinct regular native filenames.');names.add(f.path.toLowerCase());
  need(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&HASH.test(f.sha256)&&Array.isArray(f.chunks)&&f.chunks.length===Math.ceil(f.bytes/CHUNK_BYTES)&&f.chunks.every(x=>HASH.test(x)),'Original member byte/chunk descriptor is incomplete.');
  total+=f.bytes;need(Number.isSafeInteger(total)&&total<=MAX_TRANSFER_BYTES,'Complete selected edition exceeds this configured 8 GiB transfer capacity; no member is omitted.');
 }
 if(kind==='edition')need(names.has('project.zip'),'This saved population has no complete project.zip. Create a NEW native export edition in its receiving workspace; do not call population-only history a complete project.');
 return value;
}
function chunkBody(value,descriptor,member,index){
 const size=Math.min(CHUNK_BYTES,member.bytes-index*CHUNK_BYTES);
 need(object(value)&&value.id===descriptor.id&&value.name===member.path&&value.index===index&&value.bytes===size&&value.sha256===member.chunks[index]&&typeof value.base64==='string'&&value.base64.length<=Math.ceil(CHUNK_BYTES/3)*4+4,'Native file chunk identity differs.');
 const b=Buffer.from(value.base64,'base64');need(b.length===size&&b.toString('base64')===value.base64&&sha256(b)===member.chunks[index],'Native file chunk bytes differ.');return b;
}
export class MeasurementTransfers{
 #config;#client;#active=new Set();#closing=false;
 constructor(config,client){this.#config=config;this.#client=client;}
 #row(id){const row=this.#config.workspaces[id];need(row,'Choose a configured Measurements workspace.');return row;}
 #root(id,transferId){need(UUID.test(transferId),'Keep the original transfer UUID.');return join(this.#row(id).exportsDirectory,'transfers',transferId);}
 async #run(id,transferId,fn){
  need(!this.#closing,'File transfer client is closing.');const root=this.#root(id,transferId);await privateDirectory(root);
  let done;const pending=new Promise(r=>done=r);this.#active.add(pending);
  try{return await withDirectoryLock(root,()=>fn(root));}finally{this.#active.delete(pending);done();}
 }
 async inspect(id,file){
  const source=this.#row(id).files?.[file];need(source,'Choose a host-declared original file alias.');
  const actual=await regularFile(source,{maximum:MAX_TRANSFER_BYTES,consume:false});need(actual.bytes>0,'Original upload must be nonempty.');
  return {workspace:id,file,...actual,chunkBytes:CHUNK_BYTES,chunks:Math.ceil(actual.bytes/CHUNK_BYTES)};
 }
 async start(id,{transferId,input,expectedSha256}){
  return this.#run(id,transferId,async root=>{
   const row=this.#row(id),file=row.inputs[input];need(file&&HASH.test(expectedSha256),'Select and pin a host-declared transfer request JSON.');
   const raw=await regularFile(file,{maximum:1024*1024});need(raw.sha256===expectedSha256,'Transfer request bytes changed.');
   const document=validateTransferInput(parse(raw.body));let source=null;
   if(document.kind==='upload'){source=await this.inspect(id,document.file);need(source.sha256===document.fileSha256,'Original file differs from the reviewed whole-file SHA.');}
   const nativeId=document.kind==='upload'?(document.native.id||sha256(Buffer.from('measurement-transfer\0'+transferId))):document.id;
   const request={schema:TRANSFER_SCHEMA,transferId,workspace:id,input,inputSha256:raw.sha256,document,nativeId,connection:identity(row.connection),source};
   const prior=await optional(join(root,'request.json'));
   if(prior)need(canonical(prior)===canonical(request),'Transfer UUID already retains different complete inputs. Use its original status/continuation.');
   await saveClientBytes(join(root,'input.json'),raw.body);await saveClientJSON(join(root,'request.json'),request);
   if(source)await copyOriginal(row.files[document.file],join(root,'original.bin'),{bytes:source.bytes,sha256:source.sha256});
   return this.#status(id,transferId,root);
  });
 }
 async #request(id,transferId,root){
  const request=await readJSON(join(root,'request.json'),2*1024*1024);
  need(request.schema===TRANSFER_SCHEMA&&request.transferId===transferId&&request.workspace===id&&HASH.test(request.nativeId),'Retained transfer identity differs.');
  const original=await regularFile(join(root,'input.json'),{maximum:1024*1024,privateOnly:true,published:true});need(original.sha256===request.inputSha256&&canonical(parse(original.body))===canonical(request.document),'Retained complete transfer input changed.');validateTransferInput(request.document);
  return request;
 }
 async #binding(id,request,root){
  const current=identity(this.#row(id).connection);
  if(canonical(current)!==canonical(request.connection)){
   const saved=await optional(join(root,'bindings',sha256(bytes(current))+'.json'));
   need(saved&&canonical(saved.current)===canonical(current)&&canonical(saved.original)===canonical(request.connection),'Explicitly rebind this original transfer before using a restarted managed instance.','MEASUREMENT_TRANSFER_REBIND');
  }
  return current;
 }
 async rebind(id,{transferId,expectedOriginalInstanceId,expectedConnectionSha256}){
  return this.#run(id,transferId,async root=>{
   const request=await this.#request(id,transferId,root),row=this.#row(id),current=identity(row.connection);
   need(request.connection.instanceId===expectedOriginalInstanceId&&row.connectionSha256===expectedConnectionSha256,'Review exact original and new managed connection identities.');
   need(current.workspaceBinding===request.connection.workspaceBinding,'Transfer receiving must stay on the same original physical workspace.');
   const receiving=request.document.kind==='upload'&&request.document.native.kind==='portable';
   need(current.workspaceId===request.connection.workspaceId||receiving,'Only original complete-project receiving may change the native workspace UUID.');
   if(current.workspaceId!==request.connection.workspaceId){
    let names=[];try{names=await readdir(join(root,'actions'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const retained=await Promise.all(names.filter(x=>x.endsWith('.request.json')).map(x=>readJSON(join(root,'actions',x))));
    need(retained.some(x=>x.action==='receive'),'A changed native UUID requires this original transfer\'s retained receive request.');
   }
   await this.#client.verifyConnection(id);
   await saveClientJSON(join(root,'bindings',sha256(bytes(current))+'.json'),{schema:'stellar-forge.measurement-transfer-binding.v1',transferId,original:request.connection,current,connectionSha256:row.connectionSha256});
   return this.#status(id,transferId,root);
  });
 }
 async #call(id,root,runId,key,document){
  const transfer=await readJSON(join(root,'request.json'),2*1024*1024),connection=await this.#binding(id,transfer,root);
  const requestId=uuid(transfer.transferId+'\0'+runId+'\0'+key+'\0'+canonical(connection));
  const step={runId,key,requestId,document,connection};await saveClientJSON(join(root,'calls',requestId+'.json'),step);
  const status=await this.#client.transferRequest(id,{requestId,document,retry:true});
  const receipt={requestId,status:status.result?.status,phase:status.phase};
  await saveClientJSON(join(root,'observed',requestId+'.json'),receipt);
  need(status.phase==='COMPLETED','Original native transfer outcome remains uncertain.','MEASUREMENT_TRANSFER_UNKNOWN');
  const response=await this.#client.file(id,{requestId,part:'response'});
  const body=await regularFile(response.path,{maximum:32*1024*1024,privateOnly:true});
  need(status.successful,'The original native operation returned HTTP '+status.result.status+'; inspect retained request '+requestId+' before continuing with a new run UUID.','MEASUREMENT_TRANSFER_HTTP');
  return {value:parse(body.body),requestId};
 }
 async advance(id,{transferId,runId,maxChunks=64}){
  need(UUID.test(runId)&&Number.isSafeInteger(maxChunks)&&maxChunks>=1&&maxChunks<=32768,'Keep the original run UUID and choose 1..32768 complete chunks.');
  return this.#run(id,transferId,async root=>{
   const request=await this.#request(id,transferId,root);await this.#binding(id,request,root);
   const run={schema:'stellar-forge.measurement-transfer-run.v1',transferId,runId,maxChunks};
   await saveClientJSON(join(root,'runs',runId+'.json'),run);
   const complete=await optional(join(root,'complete.json'));if(complete||await optional(join(root,'progress',runId+'.json')))return this.#status(id,transferId,root);
   if(request.document.kind==='upload')await this.#upload(id,root,request,runId,maxChunks);
   else await this.#download(id,root,request,runId,maxChunks);
   return this.#status(id,transferId,root);
  });
 }
 async #upload(id,root,request,runId,budget){
  const original={bytes:request.source.bytes,sha256:request.source.sha256};
  let stat=await lstat(join(root,'original.bin'),{bigint:true});
  if(stat.nlink!==1n){const repaired=await regularFile(join(root,'original.bin'),{maximum:MAX_TRANSFER_BYTES,privateOnly:true,published:true,consume:false});need(repaired.bytes===original.bytes&&repaired.sha256===original.sha256,'Interrupted original publication differs.');stat=await lstat(join(root,'original.bin'),{bigint:true});}
  need(stat.isFile()&&stat.nlink===1n&&Number(stat.size)===original.bytes,'Retained original file identity changed.');
  await saveClientJSON(join(root,'captured-file.json'),{stamp:stamp(stat),bytes:original.bytes,sha256:original.sha256});
  const n=request.document.native,definition={...n,id:request.nativeId,bytes:original.bytes,mapping:n.mapping||{},origin:n.origin||{type:'file'}};
  const begun=await this.#call(id,root,runId,'begin',{operation:'large-intake-begin',body:definition});
  const live=await this.#call(id,root,runId,'prefix-status:'+randomUUID(),{operation:'large-intake',params:{id:request.nativeId}});
  const value=live.value;need(value.id===request.nativeId&&value.bytes===original.bytes&&value.kind===n.kind&&value.label===n.label.trim()&&canonical(value.mapping)===canonical(definition.mapping)&&canonical(value.origin)===canonical(definition.origin),'Existing native intake differs from the retained full source definition.');
  need(Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=original.bytes&&(value.offset===original.bytes||value.offset%CHUNK_BYTES===0),'Native contiguous upload offset is invalid.');
  const binding=await this.#binding(id,request,root),ackRoot=join(root,'acknowledged',sha256(bytes(binding)));await privateDirectory(ackRoot);
  const file=await open(join(root,'original.bin'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let completed=0,offset=0;
  try{
   // Verify every already-acknowledged byte prefix against this exact original.
   for(;offset<original.bytes;offset+=CHUNK_BYTES){
    const acknowledged=await optional(join(ackRoot,String(offset)+'.json'));
    if(acknowledged){need(acknowledged.offset===offset&&HASH.test(acknowledged.sha256)&&acknowledged.bytes===Math.min(CHUNK_BYTES,original.bytes-offset)&&value.offset>=offset+acknowledged.bytes,'Native acknowledged source prefix regressed or differs.');continue;}
    const b=Buffer.alloc(Math.min(CHUNK_BYTES,original.bytes-offset));let read=0;
    while(read<b.length){const r=await file.read(b,read,b.length-read,offset+read);need(r.bytesRead>0,'Retained original is truncated.');read+=r.bytesRead;}
    const digest=sha256(b),checked=offset<value.offset;
    if(!checked&&completed>=budget)break;
    const response=await this.#call(id,root,runId,(checked?'check:':'chunk:')+offset,{operation:'large-intake-chunk',params:{id:request.nativeId},body:{offset,sha256:digest,...(checked?{check:true}:{base64:b.toString('base64')})}});
    need(response.value.id===request.nativeId&&Number.isSafeInteger(response.value.offset)&&response.value.offset>=offset+b.length&&response.value.offset<=original.bytes,'Native source chunk was not acknowledged exactly.');
    if(checked)need(response.value.reused===true,'Native prefix verification did not identify retained original bytes.');
    else completed++;
    await saveClientJSON(join(ackRoot,String(offset)+'.json'),{offset,bytes:b.length,sha256:digest,nativeId:request.nativeId});
   }
   need(stamp(stat)===stamp(await file.stat({bigint:true})),'Retained source changed during upload.');
  }finally{await file.close();}
  const finished=await this.#call(id,root,runId,'status:'+randomUUID(),{operation:'large-intake',params:{id:request.nativeId}});
  await saveClientJSON(join(root,'progress',runId+'.json'),{runId,kind:'upload',nativeId:request.nativeId,offset:finished.value.offset,bytes:original.bytes,chunksSent:completed,native:finished.value,requestId:finished.requestId});
  if(offset>=original.bytes&&finished.value.offset===original.bytes){const verified=await regularFile(join(root,'original.bin'),{maximum:MAX_TRANSFER_BYTES,privateOnly:true,published:true,consume:false});need(verified.bytes===original.bytes&&verified.sha256===original.sha256,'Complete retained source differs after transfer.');await saveClientJSON(join(root,'complete.json'),{schema:'stellar-forge.measurement-transfer-complete.v1',transferId:request.transferId,kind:'upload',nativeId:request.nativeId,source:{bytes:original.bytes,sha256:original.sha256},meaning:'Complete original uploaded; scientific preparation/commit or project receiving is still explicit.'});}
 }
 async #download(id,root,request,runId,budget){
  const kind=request.document.kind,metadata=join(root,'files.json');let descriptor=await optional(metadata);
  if(!descriptor){
   const d=request.document;const read=await this.#call(id,root,runId,'descriptor',d.kind==='edition'&&d.create?{operation:'large-export',body:{id:d.id,filters:d.filters||{}}}:{operation:d.kind==='source'?'large-source':'large-edition',params:{id:d.id}});
   descriptor=validateFileSet(read.value,kind,request.nativeId);await saveClientJSON(metadata,descriptor);
  }else validateFileSet(descriptor,kind,request.nativeId);
  let count=0,done=0;
  for(const member of descriptor.files){
   const target=join(root,'files',member.path),found=await optional(target+'.identity.json');
   if(found){need(canonical(found)===canonical(member),'Saved member identity differs.');const actual=await regularFile(target,{maximum:MAX_TRANSFER_BYTES,privateOnly:true,published:true,consume:false});need(actual.bytes===member.bytes&&actual.sha256===member.sha256,'Complete downloaded original changed.');done++;continue;}
   const chunkRoot=join(root,'chunks',member.path);await privateDirectory(chunkRoot);let all=true;
   for(let index=0;index<member.chunks.length;index++){
    const saved=join(chunkRoot,String(index)+'.bin');let existing;
    try{existing=await regularFile(saved,{maximum:CHUNK_BYTES,privateOnly:true,published:true,consume:false});}catch(e){if(e.code!=='ENOENT')throw e;}
    if(existing){need(existing.bytes===Math.min(CHUNK_BYTES,member.bytes-index*CHUNK_BYTES)&&existing.sha256===member.chunks[index],'Retained original download chunk differs.');continue;}
    if(count>=budget){all=false;break;}
    const response=await this.#call(id,root,runId,'file:'+member.path+':'+index,{operation:kind==='source'?'large-source-chunk':'large-edition-chunk',params:{id:request.nativeId,file:member.path,offset:index}});
    await saveClientBytes(saved,chunkBody(response.value,descriptor,member,index));count++;
   }
   if(!all)break;
   await privateDirectory(dirname(target));const stage=join(dirname(target),'.download-'+randomUUID());let f;
   try{
    f=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const hash=createHash('sha256');let total=0;
    for(let index=0;index<member.chunks.length;index++){const read=await regularFile(join(chunkRoot,String(index)+'.bin'),{maximum:CHUNK_BYTES,privateOnly:true,published:true});need(read.sha256===member.chunks[index],'Chunk changed during assembly.');total+=read.bytes;hash.update(read.body);await f.writeFile(read.body);}
    need(total===member.bytes&&hash.digest('hex')===member.sha256,'Complete original member does not match the native descriptor.');await f.sync();await f.close();f=null;
    await publish(stage,target,member);await saveClientJSON(target+'.identity.json',member);
   }finally{await f?.close();await unlink(stage).catch(()=>{});}
   done++;
  }
  await saveClientJSON(join(root,'progress',runId+'.json'),{runId,kind,nativeId:request.nativeId,membersComplete:done,members:descriptor.files.length,chunksReceived:count});
  if(done===descriptor.files.length)await saveClientJSON(join(root,'complete.json'),{schema:'stellar-forge.measurement-transfer-complete.v1',transferId:request.transferId,kind,nativeId:request.nativeId,descriptorSha256:sha256(bytes(descriptor)),files:descriptor.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),meaning:'All original native members verified; complete project receiving uses project.zip through the existing empty-workspace receiver.'});
 }
 async apply(id,{transferId,actionId,input,expectedSha256}){
  need(UUID.test(actionId),'Keep the original attributed receiving/commit action UUID.');
  return this.#run(id,transferId,async root=>{
   const request=await this.#request(id,transferId,root);
   need(request.document.kind==='upload'&&await optional(join(root,'complete.json')),'Finish the complete original upload first.');
   const file=this.#row(id).inputs[input];need(file&&HASH.test(expectedSha256),'Choose and pin the complete reviewed action input.');
   const raw=await regularFile(file,{maximum:1024*1024});need(raw.sha256===expectedSha256,'Reviewed transfer action changed.');
   const value=parse(raw.body);need(exactKeys(value,['action','expectedRevision','expectedSourceSha256','expectedNormalizerPin'])&&['prepare','commit','receive'].includes(value.action),'Choose original prepare, commit or complete receive.');
   const portable=request.document.native.kind==='portable';need(portable?value.action==='receive':value.action!=='receive','Choose the original operation for this source kind.');
   let body={};if(value.action==='commit'){
    need(Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0&&value.expectedSourceSha256===request.source.sha256&&HASH.test(value.expectedNormalizerPin),'Commit the exact reviewed source, revision and original normalizer.');
    body={expectedRevision:value.expectedRevision,expectedSourceSha256:value.expectedSourceSha256,expectedNormalizerPin:value.expectedNormalizerPin};
   }else need(Object.keys(value).length===1,'Preparation and receiving use their original immutable source only.');
   await saveClientBytes(join(root,'actions',actionId+'.input.json'),raw.body);
   await saveClientJSON(join(root,'actions',actionId+'.request.json'),{transferId,actionId,input,sha256:raw.sha256,action:value.action});
   const accepted=await optional(join(root,'actions',actionId+'.result.json'));if(accepted)return accepted;
   await this.#binding(id,request,root);
   const response=await this.#call(id,root,actionId,'action:'+value.action,{operation:'large-intake-'+value.action,params:{id:request.nativeId},body});
   if(value.action==='prepare')need(response.value.sourceSha256===request.source.sha256&&response.value.bytes===request.source.bytes,'Native preview belongs to a different retained source.');
   if(value.action==='receive')need(response.value.id===request.source.sha256,'Native complete-receive archive identity differs.');
   const result={transferId,actionId,action:value.action,requestId:response.requestId,value:response.value};await saveClientJSON(join(root,'actions',actionId+'.result.json'),result);return result;
  });
 }
 async #status(id,transferId,root,{offset=0,limit=25}={}){
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Read 1..100 retained progress/action entries at the original offset.');
  const request=await this.#request(id,transferId,root),complete=await optional(join(root,'complete.json'));
  if(complete){need(complete.schema==='stellar-forge.measurement-transfer-complete.v1'&&complete.transferId===transferId&&complete.kind===request.document.kind&&complete.nativeId===request.nativeId,'Retained completion identity differs.');if(complete.kind==='upload')need(complete.source.bytes===request.source.bytes&&complete.source.sha256===request.source.sha256,'Retained source completion differs.');else{const d=validateFileSet(await readJSON(join(root,'files.json')),request.document.kind,request.nativeId);need(complete.descriptorSha256===sha256(bytes(d))&&canonical(complete.files)===canonical(d.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))),'Retained full file-set completion differs.');}}
  const list=async(directory,suffix)=>{try{return (await readdir(join(root,directory))).filter(x=>x.endsWith(suffix)).sort();}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  const callNames=await list('calls','.json'),calls=callNames.slice(offset,offset+limit);const runs=await list('runs','.json'),progressAll=await list('progress','.json'),actionsAll=await list('actions','.request.json'),progress=progressAll.slice(offset,offset+limit),actions=actionsAll.slice(offset,offset+limit);
  return {schema:TRANSFER_SCHEMA,transferId,workspace:id,kind:request.document.kind,nativeId:request.nativeId,connection:request.connection,source:request.source,phase:complete?'FILES_COMPLETE':'RETAINED',complete,runCount:runs.length,progressCount:progressAll.length,actionCount:actionsAll.length,offset,limit,nextOffset:offset+limit<Math.max(progressAll.length,actionsAll.length,callNames.length)?offset+limit:null,callCount:callNames.length,calls:await Promise.all(calls.map(async n=>{const c=await readJSON(join(root,'calls',n));return{runId:c.runId,key:c.key,requestId:c.requestId,operation:c.document.operation,observed:await optional(join(root,'observed',n))};})),progress:await Promise.all(progress.map(x=>readJSON(join(root,'progress',x)))),actions:await Promise.all(actions.map(async x=>{const id=x.slice(0,-13);return {request:await readJSON(join(root,'actions',x)),result:await optional(join(root,'actions',id+'.result.json'))};})),inputSha256:request.inputSha256};
 }
 status(id,transferId,page={}){return this.#run(id,transferId,root=>this.#status(id,transferId,root,page));}
 async file(id,{transferId,part='request',name}){
  return this.#run(id,transferId,async root=>{
   const request=await this.#request(id,transferId,root);let file,type='application/json',expected;
   if(part==='request')file=join(root,'request.json');else if(part==='input')file=join(root,'input.json');else if(part==='complete')file=join(root,'complete.json');else if(part==='descriptor')file=join(root,'files.json');else if(part==='original'){need(request.document.kind==='upload','This transfer has no uploaded original.');file=join(root,'original.bin');type='application/octet-stream';expected=request.source;}
   else if(part==='member'){const descriptor=validateFileSet(await readJSON(join(root,'files.json')),request.document.kind,request.nativeId),member=descriptor.files.find(x=>x.path===name);need(member,'Select an exact complete original member.');file=join(root,'files',member.path);expected=member;type=name.endsWith('.zip')?'application/zip':name.endsWith('.csv')?'text/csv':name.endsWith('.json')?'application/json':'application/octet-stream';need(await optional(file+'.identity.json'),'Original member is still incomplete.');}
   else if(part==='action'){need(UUID.test(name),'Choose the exact original action UUID.');file=join(root,'actions',name+'.result.json');}
   else need(false,'Choose a retained complete transfer part.');
   const info=await regularFile(file,{maximum:MAX_TRANSFER_BYTES,privateOnly:true,published:true,consume:false});if(expected)need(info.bytes===expected.bytes&&info.sha256===expected.sha256,'Complete original transfer file changed.');return{path:file,name:part==='member'?name:basename(file),type,bytes:info.bytes,sha256:info.sha256,directory:this.#row(id).exportsDirectory};
  });
 }
 async close(){this.#closing=true;await Promise.allSettled([...this.#active]);}
}
export async function copyTransferFile(transfers,id,selection,out){return copyClientFile({file:(_id,choice)=>transfers.file(_id,choice)},id,selection,out);}

/** Publish every complete member, original descriptor and receipt without replacing any file. */
export async function exportTransfer(transfers,id,{transferId,out}){
 out=resolve(out);await privateDirectory(out);const status=await transfers.status(id,transferId);
 need(status.complete,'Finish the complete transfer before exporting its files.');
 const files=[];
 const parts=status.kind==='upload'?[{part:'original',name:'original.bin'}]:status.complete.files.map(f=>({part:'member',name:f.path}));
 for(const selection of parts)files.push(await copyTransferFile(transfers,id,{transferId,...selection},join(out,selection.name)));
 if(status.kind!=='upload')files.push(await copyTransferFile(transfers,id,{transferId,part:'descriptor'},join(out,status.kind==='edition'?'edition.json':'files.json')));
 files.push(await copyTransferFile(transfers,id,{transferId,part:'request'},join(out,'transfer-request.json')));
 files.push(await copyTransferFile(transfers,id,{transferId,part:'complete'},join(out,'transfer-complete.json')));
 return {transferId,path:out,files};
}
