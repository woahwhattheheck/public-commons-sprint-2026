#!/usr/bin/env node
/** Read-only, retained Bubble Data API capture. Node 24; no provider write methods. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const CONFIG_SCHEMA='bubble.capture-config.v1';
export const CAPTURE_SCHEMA='bubble.capture.v1';
const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,name)=>{ensure(typeof v==='string'&&v.trim()&&v.length<=65536,'Supply '+name+'.');return v;};
const integer=(v,name)=>{ensure(Number.isSafeInteger(v)&&v>=0,'Use an exact nonnegative integer for '+name+'.');return v;};
export function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){ensure(Number.isFinite(value),'Use finite configuration numbers.');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 ensure(record(value)&&Object.getPrototypeOf(value)===Object.prototype,'Use plain JSON configuration objects.');
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const clone=v=>JSON.parse(canonical(v));
const digest=body=>createHash('sha256').update(body).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n','utf8');
const same=(a,b)=>canonical(a)===canonical(b);
const tokenName=/^[A-Z][A-Z0-9_]*$/;
const id=(v,label)=>{text(v,label);ensure(/^[A-Za-z0-9_-]{1,160}$/.test(v),'Use a bounded printable '+label+'.');return v;};
const requireKeys=(value,keys,label)=>{ensure(record(value),'Supply '+label+'.');for(const key of Object.keys(value))ensure(keys.includes(key),'Unsupported '+label+' field: '+key);};
const countEvidence=value=>{
 if(value===null)return;
 requireKeys(value,['value','source','evidence'],'expected count');integer(value.value,'expected count');
 text(value.source,'count source');text(value.evidence,'count evidence');
};
export function validateConfiguration(input){
 canonical(input);
 requireKeys(input,['schema','operationId','endpoint','authEnv','plan','types','consistency'],'capture configuration');
 ensure(input.schema===CONFIG_SCHEMA,'Use '+CONFIG_SCHEMA+'.');id(input.operationId,'capture operation ID');
 requireKeys(input.endpoint,['origin','versionPath'],'endpoint');
 const endpoint=new URL(input.endpoint.origin);
 ensure(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&endpoint.pathname==='/'&&input.endpoint.origin===endpoint.origin,
  'Use the exact HTTPS origin with no path, credentials, query, fragment or trailing slash.');
 ensure(endpoint.hostname.length<=253&&endpoint.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),'Use the exact lowercase HTTPS DNS application host.');
 ensure(!/replace|example\.invalid/i.test(endpoint.hostname),'Replace the template with the actual authorized application origin.');
 ensure(typeof input.endpoint.versionPath==='string'&&(/^(?:|\/[A-Za-z0-9_-]{1,120})$/.test(input.endpoint.versionPath)),
  'Use the exact empty live branch or one explicitly supplied safe branch path.');
 ensure(tokenName.test(input.authEnv),'Supply only the environment variable name holding the existing Bearer token.');
 ensure(['ordinary','enterprise'].includes(input.plan),'Select the actual ordinary or Enterprise plan.');
 const cap=input.plan==='enterprise'?10000000:50000;
 requireKeys(input.consistency,['mode','evidence'],'consistency');
 ensure(['observed-interval','quiesced'].includes(input.consistency.mode),'Declare observed-interval or quiesced consistency.');
 if(input.consistency.mode==='quiesced')text(input.consistency.evidence,'actual quiescence evidence');
 else if(own(input.consistency,'evidence'))text(input.consistency.evidence,'consistency evidence');
 ensure(Array.isArray(input.types)&&input.types.length&&input.types.length<=50,'Select complete explicit data types.');
 const typeIds=new Set(),names=new Set();
 for(const type of input.types){
  requireKeys(type,['id','typeName','scope','partitioning','partitions'],'type');
  id(type.id,'type ID');ensure(!typeIds.has(type.id),'Repeated type ID.');typeIds.add(type.id);
  text(type.typeName,'exact API type name');ensure(type.typeName.length<=240,'API type name exceeds its supported size.');
  ensure(!/[\s/\\?#%\u0000-\u001f]/.test(type.typeName)&&type.typeName===type.typeName.toLowerCase(),'Copy the unique lowercase, space-free typeName from actual Bubble API settings.');
  ensure(!names.has(type.typeName),'The same API type cannot masquerade as two independent types.');names.add(type.typeName);
  requireKeys(type.scope,['population','coverage','inactive','deleted'],'population scope');
  text(type.scope.population,'declared population');text(type.scope.inactive,'explicit inactive-record coverage');
  ensure(['all-live','filtered-live'].includes(type.scope.coverage),'Declare all-live or filtered-live scope.');
  ensure(type.scope.deleted==='not-observed-by-list','List capture cannot establish historical deletion coverage.');
  requireKeys(type.partitioning,['mode','populationCoverage','evidence'],'partitioning');
  ensure(['single','reviewed-disjoint'].includes(type.partitioning.mode),'Declare single or reviewed-disjoint partitioning.');
  ensure(['complete-declared','selected'].includes(type.partitioning.populationCoverage),'Declare partition population coverage.');
  text(type.partitioning.evidence,'reviewed partition and coverage evidence');
  ensure(Array.isArray(type.partitions)&&type.partitions.length&&type.partitions.length<=10000,'Supply at least one explicit partition.');
  ensure(type.partitions.length===1?type.partitioning.mode==='single':type.partitioning.mode==='reviewed-disjoint','Partition count differs from the declared reviewed method.');
  const parts=new Set(),queries=new Set();
  for(const part of type.partitions){
   requireKeys(part,['id','constraints','sort_field','descending','additional_sort_fields','expectedCount'],'partition');
   id(part.id,'partition ID');ensure(!parts.has(part.id),'Repeated partition ID.');parts.add(part.id);
   ensure(Array.isArray(part.constraints),'Retain an explicit constraints array, including [] for unfiltered.');
   for(const constraint of part.constraints){
    requireKeys(constraint,['key','constraint_type','value'],'constraint');text(constraint.key,'constraint field');text(constraint.constraint_type,'constraint type');ensure(own(constraint,'value'),'Retain every complete constraint value (including explicit null where applicable).');
   }
   text(part.sort_field,'explicit primary sorting field');ensure(typeof part.descending==='boolean','Use a boolean descending flag.');
   ensure(Array.isArray(part.additional_sort_fields),'Supply explicit additional_sort_fields, including [].');
   for(const sort of part.additional_sort_fields){
    requireKeys(sort,['sort_field','descending'],'additional sorting field');text(sort.sort_field,'additional sorting field');
    ensure(typeof sort.descending==='boolean','Use boolean sorting directions.');
   }
   ensure(own(part,'expectedCount'),'Supply expectedCount:null or a sourced count.');countEvidence(part.expectedCount);
   if(part.expectedCount)ensure(part.expectedCount.value<=cap,'The configured partition exceeds this plan limit; supply reviewed narrower partitions.');
   const query=canonical({constraints:part.constraints,sort_field:part.sort_field,descending:part.descending,additional_sort_fields:part.additional_sort_fields});
   ensure(!queries.has(query),'Repeated identical partition queries do not define disjoint populations.');queries.add(query);
  }
 }
 return clone(input);
}
export function selectionSha256(configuration,type,partition){
 return digest(canonical({endpoint:configuration.endpoint,type:{id:type.id,typeName:type.typeName,scope:type.scope},partition}));
}
export function buildRequest(configuration,type,partition,cursor){
 integer(cursor,'cursor');
 const url=new URL(configuration.endpoint.origin+configuration.endpoint.versionPath+'/api/1.1/obj/'+encodeURIComponent(type.typeName));
 const params={cursor:String(cursor),limit:'100',exclude_remaining:'false',constraints:JSON.stringify(partition.constraints),
  sort_field:partition.sort_field,descending:String(partition.descending),additional_sort_fields:JSON.stringify(partition.additional_sort_fields)};
 for(const [name,value]of Object.entries(params))url.searchParams.set(name,value);
 return {method:'GET',url:url.href,cursor,limit:100,exclude_remaining:false,selectionSha256:selectionSha256(configuration,type,partition)};
}
/** Parses only pagination and opaque _id values; exact provider text remains authoritative for numbers. */
export function validatePage(envelope,request,{cap=50000,total=null,expectedCount=null}={}){
 ensure(record(envelope)&&same(envelope.request,request),'Response belongs to another complete retained request.');
 ensure(envelope.status===200,'Retained provider response is not HTTP 200.');
 ensure(typeof envelope.body==='string'&&Buffer.byteLength(envelope.body,'utf8')===envelope.bytes&&digest(envelope.body)===envelope.sha256,'Retained raw response bytes differ.');
 let parsed;try{parsed=JSON.parse(envelope.body);}catch{throw Error('Provider response is not complete JSON; original raw text is retained.');}
 const response=parsed.response;ensure(record(response)&&Array.isArray(response.results),'Provider response lacks its complete list envelope.');
 for(const key of ['cursor','count','remaining'])integer(response[key],'response '+key);
 ensure(response.cursor===request.cursor&&response.count===response.results.length&&response.count<=100,'Provider cursor/count differs from this page.');
 const observedTotal=response.cursor+response.count+response.remaining;
 integer(observedTotal,'observed population');
 ensure(observedTotal<=cap,'Provider partition exceeds the declared plan limit; retain it and configure narrower reviewed partitions under a new operation.');
 ensure(response.count>0||response.remaining===0,'Empty page still declares unreceived records.');
 ensure(total===null||total===observedTotal,'Population count changed during this retained capture interval.');
 if(expectedCount)ensure(observedTotal===expectedCount.value,'Provider count differs from the independently configured source count.');
 if(observedTotal===cap)ensure(expectedCount&&expectedCount.value===cap,'A partition at the provider ceiling needs a separately sourced exact count.');
 const ids=response.results.map(row=>{ensure(record(row)&&typeof row._id==='string'&&row._id&&row._id.length<=240,'Every full result needs its original opaque _id.');return row._id;});
 ensure(new Set(ids).size===ids.length,'Provider repeated an ID within one page.');
 return {cursor:response.cursor,count:response.count,remaining:response.remaining,total:observedTotal,ids};
}
async function present(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function read(file){const s=await fs.lstat(file);ensure(s.isFile()&&!s.isSymbolicLink(),'Retained member must be a regular file.');return fs.readFile(file);}
async function syncDirectory(directory){const file=await fs.open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function immutable(file,body){
 body=Buffer.isBuffer(body)?body:Buffer.from(body);
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 if(await present(file)){ensure((await read(file)).equals(body),'An immutable retained source member changed: '+path.basename(file));return;}
 const temp=file+'.'+randomUUID()+'.tmp';
 try{
  const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;ensure((await read(file)).equals(body),'Concurrent retained source differs.');}
  await syncDirectory(path.dirname(file));
 }finally{await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function linuxIdentity(pid){
 try{
  const stat=await fs.readFile('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(/\s+/);
  return {pid,startTicks:fields[19],bootId:(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),pidNamespace:await fs.readlink('/proc/'+pid+'/ns/pid')};
 }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
async function acquire(root,{recoverLockSha256=null}={}){
 const directory=path.join(root,'writer-epochs');await fs.mkdir(directory,{recursive:true,mode:0o700});
 const epochNames=()=>fs.readdir(directory).then(names=>names.filter(name=>/^\d{8}\.json$/.test(name)).sort());
 const names=await epochNames(),last=names.at(-1);
 if(last){
  const priorBytes=await read(path.join(directory,last)),prior=JSON.parse(priorBytes);
  const releasePath=path.join(directory,last.replace('.json','.released.json'));
  if(await present(releasePath)){
   const released=JSON.parse(await read(releasePath));ensure(released.ownerId===prior.id,'Prior writer release names another owner.');
  }else{
   ensure(recoverLockSha256,'The original collector writer remains retained. Inspect its exact owner; use --recover-lock SHA only after its process exits.');
   ensure(digest(priorBytes)===recoverLockSha256&&prior.hostname===os.hostname(),'The requested original writer/host identity changed.');
   ensure(process.platform==='linux'&&prior.process,'Recovery requires the original Linux process identity; other-host writers remain with their owner.');
   const current=await linuxIdentity(prior.pid);
   ensure(!current||!same(current,prior.process),'The original collector process is still alive.');
  }
 }
 const epoch=last?Number(last.slice(0,8))+1:1;ensure(epoch<=99999999,'Writer epoch capacity reached.');
 const filename=String(epoch).padStart(8,'0')+'.json';
 const owner={schema:'bubble.capture-lock.v1',id:randomUUID(),epoch,predecessor:last||null,hostname:os.hostname(),pid:process.pid,
  createdAt:new Date().toISOString(),process:process.platform==='linux'?await linuxIdentity(process.pid):null};
 // Exact immutable publication elects one writer; a competitor cannot replace this epoch.
 await immutable(path.join(directory,filename),json(owner));
 async function assert(){
  const latest=(await epochNames()).at(-1);
  ensure(latest===filename&&JSON.parse(await read(path.join(directory,filename))).id===owner.id,'Original collector writer has been superseded.');
 }
 await assert();
 return {assert,release:async()=>{
  await assert();await immutable(path.join(directory,filename.replace('.json','.released.json')),
   json({schema:'bubble.capture-lock-release.v1',ownerId:owner.id,epoch,at:new Date().toISOString()}));
 }};
}
/** Collect exactly one immutable configuration; resume retained successful responses before any GET. */
export async function collectBubble(input,{
 directory,fetchImpl=globalThis.fetch,env=process.env,signal,clock=()=>new Date().toISOString(),
 expectedStateSha256,recoverLockSha256=null,retryFailed=false,requestTimeoutMs=60000
}={}){
 const configuration=validateConfiguration(input);ensure(typeof directory==='string'&&directory,'Supply a dedicated private capture directory.');
 ensure(typeof fetchImpl==='function','Supply the original HTTP fetch implementation.');
 ensure(Number.isSafeInteger(requestTimeoutMs)&&requestTimeoutMs>=1000&&requestTimeoutMs<=3600000,'Use a finite original request timeout.');
 const root=path.resolve(directory);await fs.mkdir(root,{recursive:true,mode:0o700});
 const rootInfo=await fs.lstat(root);ensure(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink(),'Use a real private capture directory.');
 const writer=await acquire(root,{recoverLockSha256});
 let state,stateHash=null;
 try{
  const configFile=path.join(root,'configuration.json');await immutable(configFile,json(configuration));
  const stateFile=path.join(root,'state.json');
  if(await present(stateFile)){const bytes=await read(stateFile);stateHash=digest(bytes);state=JSON.parse(bytes);}
  if(expectedStateSha256!==undefined)ensure(expectedStateSha256===(stateHash||'absent'),'Original local capture checkpoint changed before this continuation.');
  const configurationSha256=digest(canonical(configuration));
  if(state)ensure(state.configurationSha256===configurationSha256&&state.operationId===configuration.operationId,'The retained capture names another complete configuration.');
  else state={schema:'bubble.capture-state.v1',operationId:configuration.operationId,configurationSha256,startedAt:clock(),revision:0,state:'running',history:[]};
  async function checkpoint(event){
   await writer.assert();
   state.revision++;state.history.push({at:clock(),...event});
   const body=json(state),version=String(state.revision).padStart(8,'0')+'-'+digest(body)+'.json';
   await immutable(path.join(root,'checkpoints',version),body);
   const nowHash=await present(stateFile)?digest(await read(stateFile)):null;ensure(nowHash===stateHash,'The original checkpoint changed outside the owned transaction.');
   const temporary=stateFile+'.'+randomUUID()+'.tmp';await immutable(temporary,body);
   await fs.rename(temporary,stateFile);await syncDirectory(root);stateHash=digest(body);
  }
  async function obtain(step,request){
   const dir=path.join(root,'responses',step);await fs.mkdir(dir,{recursive:true,mode:0o700});
   await immutable(path.join(dir,'request.json'),json(request));
   const names=(await fs.readdir(dir)).filter(name=>/^\d{8}\.attempt\.json$/.test(name)).sort();
   const attempts=[];
   for(const name of names){
    const requestRecord=JSON.parse(await read(path.join(dir,name)));
    ensure(same(requestRecord.request,request),'An original attempt belongs to another request.');
    const resultFile=path.join(dir,name.replace('.attempt.json','.response.json'));
    if(await present(resultFile)){
     const result=JSON.parse(await read(resultFile));
     ensure(same(result.request,request)&&result.attempt===requestRecord.attempt,'A retained provider attempt changed.');
     if(result.body!==undefined)ensure(Buffer.byteLength(result.body,'utf8')===result.bytes&&digest(result.body)===result.sha256,'Retained raw response bytes changed.');
     attempts.push({attempt:requestRecord,response:result});
    }else attempts.push({attempt:requestRecord,response:null});
   }
   const successful=attempts.filter(row=>row.response?.status===200);
   ensure(successful.length<=1,'A step has more than one accepted source response.');
   if(successful.length)return clone(successful[0].response);
   if(attempts.at(-1)?.response&&!retryFailed)throw Error('A retained provider failure needs explicit --retry-failed; its complete response is preserved.');
   await writer.assert();
   const token=env[configuration.authEnv];ensure(typeof token==='string'&&token.trim()&&!/[\r\n]/.test(token),'The configured token environment variable is absent or invalid.');
   if(signal?.aborted)throw Error('The original collection was aborted before another request.');
   const sequence=attempts.length+1,name=String(sequence).padStart(8,'0'),attempt={schema:'bubble.read-attempt.v1',attempt:sequence,request,startedAt:clock(),priorAttempt:sequence>1?sequence-1:null};
   await immutable(path.join(dir,name+'.attempt.json'),json(attempt));await checkpoint({event:'request-retained',step,attempt:sequence});
   let envelope;
   try{
    const timeout=AbortSignal.timeout(requestTimeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await fetchImpl(request.url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:combined});
    const body=await response.text();
    ensure(!body.includes(token),'Provider response repeated the authorization secret; this response cannot enter a retained source capture.');
    envelope={request,status:response.status,receivedAt:clock(),body,bytes:Buffer.byteLength(body,'utf8'),sha256:digest(body),attempt:sequence};
   }catch{
    envelope={request,status:null,receivedAt:clock(),attempt:sequence,transportFailure:true};
   }
   await immutable(path.join(dir,name+'.response.json'),json(envelope));await checkpoint({event:'response-retained',step,attempt:sequence,status:envelope.status});
   ensure(envelope.status===200,'The provider read did not return HTTP 200; its complete response or transport failure is retained.');
   return clone(envelope);
  }
  const types=[],cap=configuration.plan==='enterprise'?10000000:50000;
  for(const type of configuration.types){
   const seen=new Set(),partitions=[];
   for(const partition of type.partitions){
    const prefix=digest(canonical([type.id,partition.id])),request0=buildRequest(configuration,type,partition,0),pages=[];
    const before=await obtain(prefix+'-page-00000000',request0);
    const first=validatePage(before,request0,{cap,expectedCount:partition.expectedCount});
    const countBefore=clone(before);
    let cursor=0,record=before;
    while(true){
     const request=buildRequest(configuration,type,partition,cursor);
     if(cursor!==0)record=await obtain(prefix+'-page-'+String(cursor).padStart(8,'0'),request);
     const info=validatePage(record,request,{cap,total:first.total,expectedCount:partition.expectedCount});
     for(const key of info.ids){ensure(!seen.has(key),'An original record repeats across pages or declared disjoint partitions.');seen.add(key);}
     pages.push(record);
     if(info.remaining===0)break;
     cursor+=info.count;ensure(cursor<cap,'The next cursor would reach the provider ceiling without a complete terminal page.');
    }
    const after=await obtain(prefix+'-count-after',request0);
    const last=validatePage(after,request0,{cap,total:first.total,expectedCount:partition.expectedCount});
    ensure(first.total===last.total,'The provider count changed after collection.');
    const countAfter=clone(after);
    partitions.push({id:partition.id,pages,countBefore,countAfter});
   }
   ensure(seen.size<=1000000,'Retained type exceeds the original native one-million-row capacity.');
   types.push({id:type.id,partitions});
  }
  const capturePath=path.join(root,'capture.json');
  let completedAt=clock();
  if(await present(capturePath))completedAt=JSON.parse(await read(capturePath)).completedAt;
  const capture={schema:CAPTURE_SCHEMA,operationId:configuration.operationId,state:'complete',configuration,
   startedAt:state.startedAt,completedAt,consistency:clone(configuration.consistency),
   observation:'Counts and unique IDs were checked within this retained interval. Equal counts do not prove a transactionally frozen database.',types};
  await immutable(capturePath,json(capture));
  state.state='complete';state.capture={path:'capture.json',bytes:json(capture).length,sha256:digest(json(capture))};
  await checkpoint({event:'complete',capture:state.capture});
  return {capture,path:capturePath,stateSha256:stateHash,bytes:state.capture.bytes,sha256:state.capture.sha256};
 }catch(error){
  // Request/response evidence and the last fsynced checkpoint remain untouched.
  throw error;
 }finally{await writer.release();}
}
async function cli(argv){
 const options={};for(let i=0;i<argv.length;i++){
  const name=argv[i];ensure(['--config','--directory','--expect-state','--recover-lock','--retry-failed','--timeout-ms'].includes(name),'Unknown collector argument: '+name);
  if(name==='--retry-failed')options.retryFailed=true;
  else{ensure(i+1<argv.length,'Missing value for '+name);options[name]=argv[++i];}
 }
 ensure(options['--config']&&options['--directory'],'Use --config complete-config.json --directory private-capture-directory.');
 const result=await collectBubble(JSON.parse(await fs.readFile(options['--config'],'utf8')),{
  directory:options['--directory'],expectedStateSha256:options['--expect-state'],
  recoverLockSha256:options['--recover-lock'],retryFailed:options.retryFailed===true,
  requestTimeoutMs:options['--timeout-ms']?Number(options['--timeout-ms']):60000});
 console.log(JSON.stringify({operationId:result.capture.operationId,state:'complete',file:result.path,bytes:result.bytes,sha256:result.sha256,stateSha256:result.stateSha256}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 cli(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
