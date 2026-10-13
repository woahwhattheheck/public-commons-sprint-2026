// MIT. Configured loopback transport. The original Measurements service owns all scientific state.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,link,unlink,readdir} from 'node:fs/promises';
import {resolve,dirname,join,sep,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {resolveOperation,OPERATIONS,BASE} from './operations.mjs';
export const CONNECTIONS_SCHEMA='stellar-forge.measurement-workspace-connections.v1';
export const CONNECTION_SCHEMA='stellar-forge.measurement-workspace-connection.v1';
export const REQUEST_SCHEMA='stellar-forge.measurement-native-request.v1';
export const MAX_INPUT=128*1024*1024,MAX_RESPONSE=8*1024*1024*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function need(ok,message,code='MEASUREMENT_CLIENT_INVALID'){if(!ok)throw Object.assign(new Error(message),{code});}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(value,(_,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const stamp=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
const owned=s=>typeof process.getuid!=='function'||s.uid===BigInt(process.getuid());
const within=(parent,child)=>child===parent||child.startsWith(parent+sep);
function parse(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'Choose a complete UTF-8 JSON document.');}}
export async function privateDirectory(directory){
 need(isAbsolute(directory),'Use an absolute private directory.');
 await mkdir(directory,{recursive:true,mode:0o700});
 need(await realpath(directory)===directory,'Private directory must not traverse symlinks.');
 const s=await lstat(directory,{bigint:true});need(s.isDirectory()&&owned(s)&&(s.mode&0o077n)===0n,'Keep client outputs in an owner-only directory.');return directory;
}
async function syncDirectory(directory){const f=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
async function finishPublishedLink(file){
 const target=await lstat(file,{bigint:true});if(target.nlink===1n)return;
 const directory=dirname(file);await privateDirectory(directory);
 need(target.isFile()&&owned(target)&&(target.mode&0o077n)===0n,'Published custody is not an owner-only regular file.');
 for(const name of await readdir(directory)){
  if(!/^\.(?:write|download)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name))continue;
  const path=join(directory,name);let candidate;try{candidate=await lstat(path,{bigint:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(candidate.isFile()&&candidate.dev===target.dev&&candidate.ino===target.ino){await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 await syncDirectory(directory);
}
export async function regularFile(file,{maximum=MAX_INPUT,privateOnly=false,consume=true,published=false}={}){
 need(isAbsolute(file)&&await realpath(file)===file,'Select an absolute regular file without symlinks.');
 if(published)await finishPublishedLink(file);
 const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await f.stat({bigint:true});
  need(before.isFile()&&before.nlink===1n&&before.size<=BigInt(maximum),'Original file is not regular, unique or within the complete byte limit.');
  if(privateOnly)need(owned(before)&&(before.mode&0o077n)===0n,'Keep connection and custody files owner-only.');
  const hash=createHash('sha256'),parts=[];let count=0;
  for await(const b of f.createReadStream({autoClose:false})){count+=b.length;need(count<=maximum,'Original file grew beyond the complete limit.');hash.update(b);if(consume)parts.push(b);}
  const after=await f.stat({bigint:true}),current=await lstat(file,{bigint:true});
  need(count===Number(before.size)&&stamp(before)===stamp(after)&&stamp(before)===stamp(current),'Original file changed while it was read.');
  return {bytes:count,sha256:hash.digest('hex'),...(consume?{body:Buffer.concat(parts)}:{})};
 }finally{await f.close();}
}
async function retained(file,bytes,{exclusive=false}={}){
 const directory=dirname(file);await privateDirectory(directory);const stage=join(directory,'.write-'+randomUUID());
 const f=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 let created=false;
 try{await link(stage,file);created=true;await syncDirectory(directory);}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  if(!exclusive){const old=await regularFile(file,{maximum:Math.max(bytes.length,1),privateOnly:true,published:true});need(old.body.equals(bytes),'Retained original bytes conflict.','MEASUREMENT_RETAINED_CONFLICT');const oldFile=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{await oldFile.sync();}finally{await oldFile.close();}await syncDirectory(directory);}
 }finally{await unlink(stage).catch(()=>{});}
 return created;
}
function origin(value){
 let u;try{u=new URL(value);}catch{need(false,'Choose the configured loopback service origin.');}
 need(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)&&u.port&&u.username===''&&u.password===''&&u.pathname==='/'&&!u.search&&!u.hash,'Measurements service must be a literal loopback HTTP origin with its explicit port.');
 return u.origin;
}
function validateConnection(value){
 need(plain(value)&&value.schema===CONNECTION_SCHEMA&&UUID.test(value.instanceId)&&typeof value.workspaceId==='string'&&value.workspaceId.length>0&&value.workspaceId.length<=200&&HASH.test(value.workspaceBinding)&&HASH.test(value.sourceManifestSha256),'Use a complete managed Measurements connection receipt.');
 need(isAbsolute(value.directory)&&isAbsolute(value.configurationFile)&&HASH.test(value.configurationSha256),'Retain the original physical workspace and reviewed configuration identity.');
 need(typeof value.tokenEnv==='string'&&/^[A-Z_][A-Z0-9_]{0,127}$/.test(value.tokenEnv),'Choose a configured token environment name.');
 need(origin(value.origin)===value.origin,'Use the canonical managed service origin.');return value;
}
export async function readMeasurementConfiguration(file){
 const read=await regularFile(resolve(file),{maximum:1024*1024,privateOnly:true});
 return validateMeasurementConfiguration(parse(read.body),{file:resolve(file),sha256:read.sha256});
}
export async function validateMeasurementConfiguration(value,{file='',sha256:configurationHash=''}={}){
 need(plain(value)&&value.schema===CONNECTIONS_SCHEMA&&plain(value.workspaces)&&Object.keys(value.workspaces).length>0,'Choose a Measurements connection configuration.');
 need(Object.keys(value).every(k=>['schema','workspaces'].includes(k)),'Unknown Measurements configuration field.');
 const workspaces=Object.create(null);
 for(const [id,row] of Object.entries(value.workspaces)){
  need(ALIAS.test(id)&&plain(row)&&Object.keys(row).every(k=>['label','connectionFile','connectionSha256','connectionText','tokenEnv','inputs','files','exportsDirectory','maxResponseBytes'].includes(k)),'Invalid workspace configuration.');
  need(typeof row.label==='string'&&row.label.trim()&&row.label.length<=200&&isAbsolute(row.connectionFile)&&HASH.test(row.connectionSha256),'Name and pin the managed connection file.');
  let bytes;
  if(row.connectionText!==undefined){need(typeof row.connectionText==='string'&&Buffer.byteLength(row.connectionText)<=1024*1024,'Retain the complete bounded original connection JSON text.');const body=Buffer.from(row.connectionText);bytes={body,sha256:sha256(body)};}
  else bytes=await regularFile(row.connectionFile,{maximum:1024*1024,privateOnly:true});
  need(bytes.sha256===row.connectionSha256,'Managed connection file changed; review the new service instance explicitly.','MEASUREMENT_CONNECTION_CHANGED');
  const connection=validateConnection(parse(bytes.body));need(row.tokenEnv===connection.tokenEnv,'Configured token environment differs from the selected service.');
  need(isAbsolute(row.exportsDirectory)&&!within(resolve(connection.directory),resolve(row.exportsDirectory))&&!within(resolve(row.exportsDirectory),resolve(connection.directory)),'Use a separate private client custody directory outside the scientific workspace.');
  await privateDirectory(row.exportsDirectory);need(plain(row.inputs??{})&&plain(row.files??{}),'Inputs and original files must be host-declared aliases.');
  const inputs=Object.create(null);for(const [alias,input] of Object.entries(row.inputs??{})){need(ALIAS.test(alias)&&typeof input==='string'&&isAbsolute(input)&&!within(row.exportsDirectory,input),'Input aliases must identify original absolute files outside client custody.');inputs[alias]=input;}
  const files=Object.create(null);for(const [alias,file] of Object.entries(row.files??{})){need(ALIAS.test(alias)&&typeof file==='string'&&isAbsolute(file)&&!within(row.exportsDirectory,file),'File aliases must identify original absolute files outside client custody.');files[alias]=file;}
  const maximum=row.maxResponseBytes??1024*1024*1024;need(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=MAX_RESPONSE,'Set a complete response bound from 1 byte to 8 GiB.');
  workspaces[id]=Object.freeze({...row,inputs:Object.freeze(inputs),files:Object.freeze(files),maxResponseBytes:maximum,connection:Object.freeze(connection)});
 }
 const rows=Object.values(workspaces);
 for(const current of rows){
  for(const other of rows){
   need(!within(current.exportsDirectory,other.connection.directory)&&!within(other.connection.directory,current.exportsDirectory),'Keep transport custody outside every configured scientific workspace.');
   if(current!==other)need(!within(current.exportsDirectory,other.exportsDirectory)&&!within(other.exportsDirectory,current.exportsDirectory),'Give configured aliases independent transport custody directories.');
   for(const input of [...Object.values(other.inputs),...Object.values(other.files)])need(!within(current.exportsDirectory,input),'Keep original input files outside all transport custody.');
  }
 }
 return Object.freeze({schema:CONNECTIONS_SCHEMA,file,sha256:configurationHash,workspaces:Object.freeze(workspaces)});
}
const identity=c=>({instanceId:c.instanceId,workspaceId:c.workspaceId,workspaceBinding:c.workspaceBinding,origin:c.origin,sourceManifestSha256:c.sourceManifestSha256,configurationSha256:c.configurationSha256});
export class MeasurementClient{
 #config;#fetch;#env;#active=new Set();#closing=false;#close;#pending=new Map();
 constructor(config,{fetcher=globalThis.fetch,environment=process.env}={}){need(config?.schema===CONNECTIONS_SCHEMA,'Read the complete connection configuration first.');this.#config=config;this.#fetch=fetcher;this.#env=environment;}
 configuration(){return {schema:CONNECTIONS_SCHEMA,workspaces:Object.entries(this.#config.workspaces).map(([id,r])=>({id,label:r.label,connection:identity(r.connection),inputs:Object.keys(r.inputs),files:Object.keys(r.files),maxResponseBytes:r.maxResponseBytes})),operations:OPERATIONS};}
 #row(id){const row=this.#config.workspaces[id];need(row,'Select a host-declared workspace.');return row;}
 #root(id,requestId){need(UUID.test(requestId),'Keep the original transport request UUID.');return join(this.#row(id).exportsDirectory,'requests',requestId);}
 async #run(fn){need(!this.#closing,'Measurements client is closing.','MEASUREMENT_CLIENT_CLOSING');let done;const p=new Promise(r=>{done=r;});this.#active.add(p);try{return await fn();}finally{this.#active.delete(p);done();}}
 async #connection(id){
  const row=this.#row(id),receipt=await regularFile(row.connectionFile,{maximum:1024*1024,privateOnly:true});need(receipt.sha256===row.connectionSha256,'Managed instance receipt changed; reconnect explicitly.','MEASUREMENT_CONNECTION_CHANGED');
  const token=this.#env[row.tokenEnv];need(typeof token==='string'&&token.length>=32&&!/[\r\n]/.test(token),'The configured service token is unavailable.');
  const response=await this.#fetch(row.connection.origin+BASE+'/connection',{method:'GET',headers:{'x-measurement-internal-token':token,'X-Measurements-Instance-ID':row.connection.instanceId},redirect:'error',signal:AbortSignal.timeout(15000)});
  need(response.status===200&&response.headers.get('x-measurements-instance-id')===row.connection.instanceId,'Selected managed instance is unavailable or changed.','MEASUREMENT_CONNECTION_CHANGED');
  const chunks=[];let n=0;for await(const b of response.body){n+=b.length;need(n<=1024*1024,'Managed connection response exceeds its complete limit.');chunks.push(b);}
  const actual=validateConnection(parse(Buffer.concat(chunks)));
  need(canonical(identity(actual))===canonical(identity(row.connection))&&actual.directory===row.connection.directory,'Live workspace identity differs from the reviewed managed connection.','MEASUREMENT_CONNECTION_CHANGED');
  return {row,token,connection:identity(actual)};
 }
 async transferRequest(id,{requestId,document,retry=false}={}){return this.#run(async()=>{const op=resolveOperation(document);need(['large-intake-begin','large-intake-chunk','large-intake-prepare','large-intake-commit','large-intake-receive','large-export','large-intake','large-source','large-source-chunk','large-edition','large-edition-chunk'].includes(op.name),'Transfer requests use only the original large-file owner.');return this.#perform(id,requestId,document,json(document),retry);});}
 async verifyConnection(id){return this.#run(async()=>{const live=await this.#connection(id);return live.connection;});}
 async inspectInput(id,alias){return this.#run(async()=>{const row=this.#row(id),file=row.inputs[alias];need(file,'Choose a host-declared input alias.');const original=await regularFile(file,{maximum:MAX_INPUT});const document=parse(original.body),operation=resolveOperation(document);return {workspace:id,input:alias,bytes:original.bytes,sha256:original.sha256,operation:operation.name,method:operation.method,path:operation.path,effect:operation.effect,replay:operation.replay,note:operation.note};});}
 async read(id,{operation,params={},requestId=randomUUID()}={}){return this.#run(async()=>{const document={operation,params},route=resolveOperation(document);need(route.method==='GET','Read tools accept declared GET operations only.');return this.#perform(id,requestId,document,json(document),false);});}
 async execute(id,{input,expectedSha256,requestId,retry=false}={}){
  return this.#run(async()=>{const row=this.#row(id),file=row.inputs[input];need(file&&HASH.test(expectedSha256),'Choose and pin the complete original input alias.');
   const original=await regularFile(file,{maximum:MAX_INPUT});need(original.sha256===expectedSha256,'Original input bytes changed.');return this.#perform(id,requestId,parse(original.body),original.body,retry);
  });
 }
 async #perform(id,requestId,document,inputBytes,retry){
  const row=this.#row(id),root=this.#root(id,requestId),key=id+':'+requestId,route=resolveOperation(document);
  const request={schema:REQUEST_SCHEMA,requestId,workspace:id,connection:identity(row.connection),operation:route.name,method:route.method,path:route.path,replay:route.replay,effect:route.effect,inputSha256:sha256(inputBytes),inputBytes:inputBytes.length,bodySha256:route.body===null?null:sha256(Buffer.from(JSON.stringify(route.body)))};
  await privateDirectory(root);await retained(join(root,'input.json'),inputBytes);await retained(join(root,'request.json'),json(request));
  if(this.#pending.has(key)){await this.#pending.get(key);return this.#status(id,requestId);}
  const old=await this.#status(id,requestId);if(old.phase==='COMPLETED')return old;
  if(old.attempts.length)need(retry&&['read','exact'].includes(route.replay),'An earlier dispatch is unresolved. Read the original native result and retained response; only supported exact replay may be explicitly retried.','MEASUREMENT_REQUEST_UNCERTAIN');
  const pending=(async()=>{
   const live=await this.#connection(id),attempt=randomUUID(),prefix=join(root,'attempt-'+attempt);
   const claimed=await retained(join(root,'dispatch.json'),json({requestId,attempt,at:new Date().toISOString()}),{exclusive:true});
   need(claimed||retry&&['read','exact'].includes(route.replay),'This original transport request already entered dispatch. Reconcile it or explicitly use supported exact replay.','MEASUREMENT_REQUEST_UNCERTAIN');
   await retained(prefix+'.dispatch.json',json({attempt,requestId,connection:live.connection,at:new Date().toISOString()}));
   let response,bodyFile;
   try{
    response=await this.#fetch(row.connection.origin+route.path,{method:route.method,headers:{'x-measurement-internal-token':live.token,'X-Measurements-Instance-ID':row.connection.instanceId,...(route.body!==null?{'Content-Type':'application/json'}:{})},body:route.body===null?undefined:JSON.stringify(route.body),redirect:'error',signal:AbortSignal.timeout(15*60*1000)});
    const headers=Object.fromEntries(['content-type','content-length','content-disposition','x-measurements-instance-id'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>v!==null));
    await retained(prefix+'.headers.json',json({status:response.status,headers,receivedAt:new Date().toISOString()}));
    const part=prefix+'.response.bin';bodyFile=await open(part,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const hash=createHash('sha256');let bytes=0;
    try{for await(const chunk of response.body??[]){bytes+=chunk.length;need(bytes<=row.maxResponseBytes,'Complete response exceeds the configured retained bound; partial original bytes remain preserved.','MEASUREMENT_RESPONSE_LIMIT');hash.update(chunk);await bodyFile.writeFile(chunk);}await bodyFile.sync();}
    finally{await bodyFile.close();bodyFile=null;await syncDirectory(root);}
    const digest=hash.digest('hex'),headerIdentity=headers['x-measurements-instance-id'];
    const received={schema:'stellar-forge.measurement-native-response.v1',requestId,attempt,requestSha256:sha256(json(request)),connection:live.connection,status:response.status,headers,bytes,sha256:digest,filename:'attempt-'+attempt+'.response.bin',receivedAt:new Date().toISOString()};
    await retained(prefix+'.response.json',json(received));
    need(headerIdentity===row.connection.instanceId,'Response belongs to a different service instance; complete bytes remain retained.','MEASUREMENT_CONNECTION_CHANGED');
    const length=headers['content-length'];need(length===undefined||/^\d+$/.test(length)&&Number(length)===bytes,'Response byte count differs; complete observed bytes remain retained.','MEASUREMENT_RESPONSE_INCOMPLETE');
    // The first complete observed HTTP result remains selected, including original 4xx/5xx responses.
    await retained(join(root,'result.json'),json(received),{exclusive:true});
   }catch(error){
    if(bodyFile)await bodyFile.close().catch(()=>{});
    await retained(prefix+'.error.json',json({requestId,attempt,code:typeof error?.code==='string'?error.code:'MEASUREMENT_TRANSPORT_UNKNOWN',message:'The complete accepted outcome is not established. Reconcile this original request and preserved response files.',at:new Date().toISOString()}));
    throw error;
   }
  })();
  this.#pending.set(key,pending);try{await pending;}finally{this.#pending.delete(key);}
  return this.#status(id,requestId);
 }
 async #status(id,requestId){
  const root=this.#root(id,requestId);let request;
  try{request=parse((await regularFile(join(root,'request.json'),{maximum:1024*1024,privateOnly:true,published:true})).body);}
  catch(e){if(e.code==='ENOENT')return {requestId,workspace:id,phase:'ABSENT',attempts:[]};throw e;}
  need(request?.schema===REQUEST_SCHEMA&&request.requestId===requestId&&request.workspace===id&&HASH.test(request.inputSha256)&&Number.isSafeInteger(request.inputBytes)&&request.inputBytes>=0,'Retained request identity differs.');
  const original=await regularFile(join(root,'input.json'),{maximum:MAX_INPUT,privateOnly:true,published:true,consume:false});need(original.sha256===request.inputSha256&&original.bytes===request.inputBytes,'Retained original request bytes changed.');
  const names=await readdir(root),dispatched=names.includes('dispatch.json');
  const attempts=names.filter(n=>/^attempt-[a-f0-9-]+\.dispatch\.json$/.test(n)).map(n=>n.slice(8,-14)).sort();
  let result=null;try{result=parse((await regularFile(join(root,'result.json'),{maximum:1024*1024,privateOnly:true,published:true})).body);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(result){need(result.schema==='stellar-forge.measurement-native-response.v1'&&result.requestId===requestId&&UUID.test(result.attempt)&&result.filename==='attempt-'+result.attempt+'.response.bin'&&HASH.test(result.sha256)&&Number.isSafeInteger(result.bytes)&&result.bytes>=0&&Number.isInteger(result.status)&&result.status>=100&&result.status<=599&&plain(result.headers)&&canonical(result.connection)===canonical(request.connection),'Retained response identity differs.');const body=await regularFile(join(root,result.filename),{maximum:this.#row(id).maxResponseBytes,privateOnly:true,consume:false});need(body.bytes===result.bytes&&body.sha256===result.sha256&&result.requestSha256===sha256(json(request)),'Original received result changed.');}
  return {requestId,workspace:id,phase:result?'COMPLETED':dispatched||attempts.length?'UNKNOWN':'PREPARED',request,attempts,result,successful:result?result.status>=200&&result.status<300:null};
 }
 status(id,requestId){return this.#run(()=>this.#status(id,requestId));}
 async file(id,{requestId,part='response',attempt}={}){
  return this.#run(async()=>{
   const root=this.#root(id,requestId),status=await this.#status(id,requestId);need(status.phase!=='ABSENT','Original client request not found.');
   let name;if(part==='request')name='request.json';else if(part==='input')name='input.json';else if(part==='receipt')name='result.json';
   else if(part==='response'){if(attempt){need(UUID.test(attempt),'Choose an original attempt UUID.');name='attempt-'+attempt+'.response.bin';}else{need(status.result,'No complete selected response; choose a retained original attempt explicitly.');name=status.result.filename;}}
   else if(['headers','error','dispatch','attempt-receipt'].includes(part)){need(UUID.test(attempt),'Choose an original attempt UUID.');name='attempt-'+attempt+'.'+({headers:'headers',error:'error',dispatch:'dispatch','attempt-receipt':'response'}[part])+'.json';}
   else need(false,'Choose an original retained request or response part.');
   let type='application/json';
   if(part==='response'){
    type=status.result?.filename===name?(status.result.headers['content-type']||'application/octet-stream'):'application/octet-stream';
    if(attempt){try{const observed=parse((await regularFile(join(root,'attempt-'+attempt+'.headers.json'),{maximum:1024*1024,privateOnly:true,published:true})).body);type=observed.headers?.['content-type']||type;}catch(e){if(e.code!=='ENOENT')throw e;}}
   }
   const path=join(root,name),file=await regularFile(path,{maximum:part==='response'?this.#row(id).maxResponseBytes:MAX_INPUT,privateOnly:true,published:true,consume:false});
   return {path,name,bytes:file.bytes,sha256:file.sha256,type,directory:this.#row(id).exportsDirectory};
  });
 }
 close(){if(this.#close)return this.#close;this.#closing=true;return this.#close=(async()=>{await Promise.allSettled([...this.#active]);})();}
}
export async function copyClientFile(client,id,selection,out){
 const descriptor=await client.file(id,selection);out=resolve(out);await privateDirectory(dirname(out));
 const original=await open(descriptor.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),stage=join(dirname(out),'.download-'+randomUUID());let dest;
 try{
  const before=await original.stat({bigint:true});need(before.isFile()&&Number(before.size)===descriptor.bytes,'Original response changed.');
  dest=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const hash=createHash('sha256');let bytes=0;
  for await(const part of original.createReadStream({autoClose:false})){bytes+=part.length;need(bytes<=descriptor.bytes,'Original response grew.');hash.update(part);await dest.writeFile(part);}
  need(bytes===descriptor.bytes&&hash.digest('hex')===descriptor.sha256&&stamp(before)===stamp(await original.stat({bigint:true})),'Original response changed during copy.');await dest.sync();await dest.close();dest=null;
  try{await link(stage,out);}catch(e){if(e.code!=='EEXIST')throw e;const old=await regularFile(out,{maximum:descriptor.bytes,privateOnly:true,published:true,consume:false});need(old.bytes===descriptor.bytes&&old.sha256===descriptor.sha256,'Output already contains different bytes.');const f=await open(out,constants.O_RDONLY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
  await syncDirectory(dirname(out));return {path:out,bytes:descriptor.bytes,sha256:descriptor.sha256,contentType:descriptor.type};
 }finally{if(dest)await dest.close();await original.close();await unlink(stage).catch(()=>{});}
}

export async function saveClientJSON(file,value){file=resolve(file);const bytes=json(value);await retained(file,bytes);return{path:file,bytes:bytes.length,sha256:sha256(bytes)};}

// Original publisher reused for immutable transfer descriptors, chunks and receipts.
export async function saveClientBytes(file,bytes){need(bytes instanceof Uint8Array,'Retain exact bytes.');await retained(resolve(file),Buffer.from(bytes));return{path:resolve(file),bytes:bytes.length,sha256:sha256(bytes)};}
