// MIT. Exact complete customer delivery framing; never executes included source.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, link, unlink, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { reviewHtml } from './review.mjs';
import { initializationDirectory, retainInitializationFile } from '../../initialization.mjs';

export const SCHEMA='stellar-forge.sf88.customer-delivery.v1';
export const CHUNK=65536, MAX_FILES=21000, MAX_HEADER=16*1024*1024, MAX_CONTENT=2*1024*1024*1024;
export const MAX_PACKAGE=MAX_CONTENT*2+MAX_HEADER;
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
export const clone=value=>JSON.parse(JSON.stringify(value));
export const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function need(value,code){if(!value)throw Object.assign(new Error(code),{code});}
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';need(value!==undefined,'CUSTOMER_DELIVERY_UNDEFINED');return JSON.stringify(value);}
export const identity=value=>digest(canonical(value));
export function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/'&&!path.includes('\0'),'CUSTOMER_DELIVERY_ABSOLUTE_PATH');return path;}
export function relative(path){need(typeof path==='string'&&path.length>0&&path.length<=2048&&!/[\\\x00-\x1f]/.test(path)&&!path.startsWith('/')&&path.split('/').every(x=>x&&x!=='.'&&x!=='..'),'CUSTOMER_DELIVERY_MEMBER_PATH');return path;}
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export async function fileHandle(path,expected,maximum=MAX_CONTENT){
 absolute(path);need(await realpath(dirname(path))===dirname(path),'CUSTOMER_DELIVERY_PARENT_CHANGED');
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const stat=await file.stat({bigint:true});need(stat.isFile()&&stat.size<=BigInt(maximum),'CUSTOMER_DELIVERY_FILE_INVALID');if(expected)need(stat.size===BigInt(expected.bytes),'CUSTOMER_DELIVERY_FILE_CHANGED');return{file,stat};}catch(error){await file.close();throw error;}
}
export async function measure(path,expected,maximum=MAX_CONTENT){
 const held=await fileHandle(path,expected,maximum);
 try{const sha=createHash('sha256'),buffer=Buffer.alloc(256*1024);let length=0;while(true){const r=await held.file.read(buffer,0,buffer.length,length);if(!r.bytesRead)break;length+=r.bytesRead;need(length<=maximum,'CUSTOMER_DELIVERY_LIMIT');sha.update(buffer.subarray(0,r.bytesRead));}const out={bytes:length,sha256:sha.digest('hex')};need(stamp(held.stat)===stamp(await held.file.stat({bigint:true}))&&length===Number(held.stat.size),'CUSTOMER_DELIVERY_FILE_CHANGED');if(expected)need(out.bytes===expected.bytes&&out.sha256===expected.sha256,'CUSTOMER_DELIVERY_FILE_CHANGED');return out;}finally{await held.file.close();}
}
export async function publish(target,writer,{maximum=MAX_CONTENT}={}){
 absolute(target);await initializationDirectory(dirname(target));
 try{return await measure(target,undefined,maximum);}catch(error){if(error.code!=='ENOENT')throw error;}
 const temp=join(dirname(target),'.delivery-'+randomUUID());const file=await open(temp,'wx',0o600);
 try{await writer(file);await file.sync();await file.close();const selected=await measure(temp,undefined,maximum);
 try{await link(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;await measure(target,selected,maximum);}
 const directory=await open(dirname(target),'r');try{await directory.sync();}finally{await directory.close();}return selected;
 }finally{await file.close().catch(()=>{});await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function copyFile(source,target,expected,{maximum=MAX_CONTENT}={}){
 try{await measure(target,expected,maximum);return expected;}catch(error){if(error.code!=='ENOENT')throw error;}
 await publish(target,async out=>{const held=await fileHandle(source,expected,maximum);try{const buffer=Buffer.alloc(256*1024),sha=createHash('sha256');let offset=0;
 while(offset<expected.bytes){const r=await held.file.read(buffer,0,Math.min(buffer.length,expected.bytes-offset),offset);need(r.bytesRead>0,'CUSTOMER_DELIVERY_FILE_TRUNCATED');const part=buffer.subarray(0,r.bytesRead);await out.writeFile(part);sha.update(part);offset+=r.bytesRead;}
 need(stamp(held.stat)===stamp(await held.file.stat({bigint:true}))&&sha.digest('hex')===expected.sha256,'CUSTOMER_DELIVERY_FILE_CHANGED');
 }finally{await held.file.close();}},{maximum});
 await measure(target,expected,maximum);return expected;
}
const fields=(value,names)=>need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>names.includes(key))&&names.every(key=>Object.hasOwn(value,key)),'CUSTOMER_DELIVERY_UNEXPECTED_FIELD');
export function validateManifest(value){
 const taskOrigin=value!==null&&typeof value==='object'&&Object.hasOwn(value,'task');
 fields(value,['schema','title','note','collection','capture','rows','outputsComplete','source','files',...(taskOrigin?['task']:[])]);
 if(taskOrigin){fields(value.task,['taskSha256','planSha256','system','id','revision']);need(value.collection===null&&hash(value.task.taskSha256)&&hash(value.task.planSha256)&&['system','id','revision'].every(k=>typeof value.task[k]==='string'&&value.task[k].length>0&&value.task[k].length<=256),'CUSTOMER_DELIVERY_TASK_ORIGIN');}
 else fields(value.collection,['id','manifestSha256']);
 fields(value.capture,['sha256','bytes','capturedAt']);fields(value.source,['sha256','files']);
 need(typeof value.capture.capturedAt==='string'&&new Date(value.capture.capturedAt).toISOString()===value.capture.capturedAt,'CUSTOMER_DELIVERY_CAPTURE_TIME');
 need(value&&value.schema===SCHEMA&&typeof value.title==='string'&&value.title.trim()&&value.title.length<=160&&typeof value.note==='string'&&value.note.length<=10000,'CUSTOMER_DELIVERY_MANIFEST');
 need((taskOrigin||hash(value.collection?.manifestSha256)&&typeof value.collection.id==='string')&&hash(value.capture?.sha256)&&Number.isSafeInteger(value.capture.bytes)&&value.capture.bytes>0,'CUSTOMER_DELIVERY_SOURCE');
 need(Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=100&&Array.isArray(value.files)&&value.files.length>0&&value.files.length<=MAX_FILES,'CUSTOMER_DELIVERY_POPULATION');
 const intents=new Set(),paths=new Set(),responsePaths=new Set();let total=0;
 for(const row of value.rows){
 fields(row,['intentId','jobId','configSha256','sourceConfigSha256','sourceRecordSha256','originalCreatedAt','capturedAt','method','nativeState','originalSourceFiles','observation','output',...(taskOrigin?['originalOutcome','recovery']:[])]);
 if(taskOrigin){
  fields(row.originalOutcome,['status','httpStatus','responseStatus','errorCode']);
  for(const k of ['status','responseStatus','errorCode'])need(row.originalOutcome[k]===null||typeof row.originalOutcome[k]==='string'&&row.originalOutcome[k].length<=150,'CUSTOMER_DELIVERY_TASK_OUTCOME');
  need(row.originalOutcome.httpStatus===null||Number.isInteger(row.originalOutcome.httpStatus)&&row.originalOutcome.httpStatus>=100&&row.originalOutcome.httpStatus<=599,'CUSTOMER_DELIVERY_TASK_OUTCOME');
  if(row.recovery!==null){
   const r=row.recovery;fields(r,['kind','state','readId','readSha256','completedSha256','bindingSha256','originalAttemptStartedAt','recoveryReadStartedAt','responseObservedAt','publishedAt','httpStatus','httpStatusSource','transactionHash','ledger','network','asset','amountAtomic']);
   need(r.kind==='SETTLED_RPC_RECOVERY_READ'&&r.state==='SETTLED_RESULT_RECOVERED'&&typeof r.readId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(r.readId)&&['readSha256','completedSha256','bindingSha256','transactionHash'].every(k=>hash(r[k]))&&r.httpStatus===200&&r.httpStatusSource==='ORIGINAL_RPC_RECOVERY_HTTP_200_CONTRACT','CUSTOMER_DELIVERY_TASK_RECOVERY');
   const times=['originalAttemptStartedAt','recoveryReadStartedAt','responseObservedAt','publishedAt'].map(k=>{need(typeof r[k]==='string'&&Number.isFinite(Date.parse(r[k])),'CUSTOMER_DELIVERY_TASK_RECOVERY_TIME');return Date.parse(r[k]);});
   need(times.every((t,i)=>i===0||t>=times[i-1])&&Number.isSafeInteger(r.ledger)&&r.ledger>0&&['network','asset'].every(k=>typeof r[k]==='string'&&r[k].length>0&&r[k].length<=500)&&typeof r.amountAtomic==='string'&&/^[0-9]{1,30}$/.test(r.amountAtomic),'CUSTOMER_DELIVERY_TASK_RECOVERY');
  }
 }else need(!Object.hasOwn(row,'originalOutcome')&&!Object.hasOwn(row,'recovery'),'CUSTOMER_DELIVERY_ORIGIN_REQUIRED');
 fields(row.observation,['attemptStatus','settlementStatus','outputStatus','network','asset','amountAtomic','transactionHash','ledger','issues']);
 fields(row.output,['state','path','bytes','sha256']);
 need(typeof row.method==='string'&&/^[A-Z]{1,20}$/.test(row.method)&&typeof row.nativeState==='string'&&row.nativeState.length<=100&&typeof row.originalCreatedAt==='string'&&typeof row.capturedAt==='string','CUSTOMER_DELIVERY_ORIGINAL_OBSERVATION');
 need(Array.isArray(row.originalSourceFiles)&&row.originalSourceFiles.every(x=>x&&typeof x.name==='string'&&/^[a-z.-]+$/.test(x.name)&&hash(x.sha256)&&Number.isSafeInteger(x.bytes)&&x.bytes>=0),'CUSTOMER_DELIVERY_ORIGINAL_FILE_WITNESS');
 for(const file of row.originalSourceFiles)fields(file,['name','bytes','sha256']);
 for(const key of ['attemptStatus','settlementStatus','outputStatus','network','asset','amountAtomic'])need(typeof row.observation[key]==='string'&&row.observation[key].length<=500,'CUSTOMER_DELIVERY_OBSERVATION');
 need((row.observation.transactionHash===null||hash(row.observation.transactionHash))&&(row.observation.ledger===null||Number.isSafeInteger(row.observation.ledger))&&Array.isArray(row.observation.issues)&&row.observation.issues.every(x=>typeof x==='string'&&/^[A-Z0-9_]{1,150}$/.test(x)),'CUSTOMER_DELIVERY_OBSERVATION');
 need(row&&typeof row.intentId==='string'&&!intents.has(row.intentId)&&hash(row.jobId)&&hash(row.configSha256)&&hash(row.sourceConfigSha256)&&hash(row.sourceRecordSha256),'CUSTOMER_DELIVERY_ROW');intents.add(row.intentId);
 need(row.output&&['VERIFIED','NOT_SAVED','UNAVAILABLE','OVER_LIMIT','NOT_REQUESTED'].includes(row.output.state),'CUSTOMER_DELIVERY_OUTPUT_STATE');
 if(taskOrigin)need(row.output.state==='VERIFIED','CUSTOMER_TASK_COMPLETE_RESPONSE_REQUIRED');
 if(row.output.state==='VERIFIED'){need(hash(row.output.sha256)&&Number.isSafeInteger(row.output.bytes)&&row.output.bytes>=0&&typeof row.output.path==='string','CUSTOMER_DELIVERY_OUTPUT');relative(row.output.path);need(/^responses\/[0-9]{3}\.bin$/.test(row.output.path),'CUSTOMER_DELIVERY_RESPONSE_PATH');need(!responsePaths.has(row.output.path),'CUSTOMER_DELIVERY_OUTPUT_DUPLICATE');responsePaths.add(row.output.path);}
 else need(row.output.path===null&&row.output.bytes===null&&row.output.sha256===null,'CUSTOMER_DELIVERY_UNAVAILABLE_OUTPUT');
 }
 for(const file of value.files){fields(file,['path','role','bytes','sha256']);relative(file.path);need(!paths.has(file.path)&&hash(file.sha256)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&['response','source','review'].includes(file.role),'CUSTOMER_DELIVERY_FILE');paths.add(file.path);total+=file.bytes;
 need(file.role==='response'?responsePaths.has(file.path):file.role==='source'?file.path.startsWith('source/'):['review.json','review.html'].includes(file.path),'CUSTOMER_DELIVERY_MEMBER_ROLE');}
 need(total<=MAX_CONTENT&&value.files.filter(f=>f.role==='response').length===responsePaths.size,'CUSTOMER_DELIVERY_CONTENT_LIMIT');
 for(const row of value.rows)if(row.output.path){const f=value.files.find(f=>f.path===row.output.path);need(f&&f.bytes===row.output.bytes&&f.sha256===row.output.sha256,'CUSTOMER_DELIVERY_RESPONSE_BINDING');}
 need(value.files.some(f=>f.path==='review.json'&&f.role==='review')&&value.files.some(f=>f.path==='review.html'&&f.role==='review'),'CUSTOMER_DELIVERY_REVIEW_MISSING');
 need(value.source&&Array.isArray(value.source.files)&&value.source.files.length>0&&value.source.files.length<=20000,'CUSTOMER_DELIVERY_COMPLETE_SOURCE');
 const source=value.files.filter(f=>f.role==='source');need(source.length===value.source.files.length,'CUSTOMER_DELIVERY_SOURCE_POPULATION');
 for(let i=0;i<source.length;i++){const s=value.source.files[i];fields(s,['path','bytes','sha256']);relative(s.path);need(source[i].path==='source/'+s.path&&source[i].sha256===s.sha256&&source[i].bytes===s.bytes,'CUSTOMER_DELIVERY_SOURCE_BINDING');}
 need(hash(value.source.sha256)&&value.source.sha256===identity({schema:'stellar-forge.sf88.customer-delivery-source.v1',files:value.source.files,bytes:source.reduce((n,row)=>n+row.bytes,0)}),'CUSTOMER_DELIVERY_SOURCE_DIGEST');
 const review={...value,schema:SCHEMA+'.review'};delete review.files;
 for(const [path,raw] of [['review.json',bytes(review)],['review.html',Buffer.from(reviewHtml(review))]]){
  const row=value.files.find(file=>file.path===path);need(row&&row.bytes===raw.length&&row.sha256===digest(raw),'CUSTOMER_DELIVERY_FIXED_REVIEW');
 }
 need(value.outputsComplete===value.rows.every(r=>r.output.state==='VERIFIED'),'CUSTOMER_DELIVERY_COMPLETENESS');
 return{manifest:value,sha256:identity(value),files:value.files.length,bytes:total,outputsComplete:value.outputsComplete};
}
export async function writePackage(path,manifest,resolveFile){
 const selected=validateManifest(manifest);const header=bytes({type:'header',schema:SCHEMA,manifest,manifestSha256:selected.sha256});need(header.length<=MAX_HEADER,'CUSTOMER_DELIVERY_HEADER_LIMIT');
 await publish(path,async out=>{await out.writeFile(header);for(let index=0;index<manifest.files.length;index++){const row=manifest.files[index],held=await fileHandle(resolveFile(row),row);
 try{let offset=0;const sha=createHash('sha256'),buffer=Buffer.alloc(CHUNK);while(offset<row.bytes){const result=await held.file.read(buffer,0,Math.min(CHUNK,row.bytes-offset),offset);need(result.bytesRead>0,'CUSTOMER_DELIVERY_SOURCE_TRUNCATED');const part=buffer.subarray(0,result.bytesRead);sha.update(part);await out.writeFile(bytes({type:'chunk',file:index,offset,base64:part.toString('base64')}));offset+=result.bytesRead;}
 need(stamp(held.stat)===stamp(await held.file.stat({bigint:true}))&&sha.digest('hex')===row.sha256,'CUSTOMER_DELIVERY_SOURCE_CHANGED');
 }finally{await held.file.close();}}
 await out.writeFile(bytes({type:'complete',manifestSha256:selected.sha256,files:selected.files,bytes:selected.bytes}));},{maximum:MAX_PACKAGE});
 const result=await inspectPackage(path);need(result.manifestSha256===selected.sha256,'CUSTOMER_DELIVERY_EXISTING_PACKAGE_CONFLICT');return result;
}
async function* lines(file){
 let rest=Buffer.alloc(0),first=true;
 for await(const raw of file.createReadStream({autoClose:false})){rest=Buffer.concat([rest,raw]);while(true){const end=rest.indexOf(10);if(end<0)break;const row=rest.subarray(0,end);rest=rest.subarray(end+1);need(row.length>0&&row.length<=(first?MAX_HEADER:100000),'CUSTOMER_DELIVERY_LINE_LIMIT');first=false;yield row;}
 need(rest.length<=(first?MAX_HEADER:100000),'CUSTOMER_DELIVERY_LINE_LIMIT');}
 need(rest.length===0,'CUSTOMER_DELIVERY_TRUNCATED_LINE');
}
export async function inspectPackage(path,{onManifest,onChunk,onFile,expected}={}){
 const held=await fileHandle(path,expected,MAX_PACKAGE);let manifest,selected,index=0,offset=0,partHash=createHash('sha256'),complete=false,packageHash=createHash('sha256'),length=0;
 const finishEmpty=async()=>{while(manifest&&index<manifest.files.length&&offset===manifest.files[index].bytes){const row=manifest.files[index];need(partHash.digest('hex')===row.sha256,'CUSTOMER_DELIVERY_MEMBER_DIGEST');await onFile?.(row,index);index++;offset=0;partHash=createHash('sha256');}};
 try{for await(const raw of lines(held.file)){packageHash.update(raw);packageHash.update('\n');length+=raw.length+1;need(length<=MAX_CONTENT*2+MAX_HEADER,'CUSTOMER_DELIVERY_ARCHIVE_LIMIT');let row;try{row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'CUSTOMER_DELIVERY_FRAME_JSON');}
 need(!complete,'CUSTOMER_DELIVERY_TRAILING_DATA');
 if(!manifest){need(row.type==='header'&&row.schema===SCHEMA,'CUSTOMER_DELIVERY_HEADER');selected=validateManifest(row.manifest);need(row.manifestSha256===selected.sha256,'CUSTOMER_DELIVERY_MANIFEST_DIGEST');manifest=row.manifest;await onManifest?.(manifest,selected);await finishEmpty();continue;}
 if(row.type==='complete'){await finishEmpty();need(index===manifest.files.length&&row.manifestSha256===selected.sha256&&row.files===selected.files&&row.bytes===selected.bytes,'CUSTOMER_DELIVERY_INCOMPLETE');complete=true;continue;}
 need(row.type==='chunk'&&index<manifest.files.length&&row.file===index&&row.offset===offset&&typeof row.base64==='string'&&row.base64.length<=Math.ceil(CHUNK/3)*4,'CUSTOMER_DELIVERY_CHUNK_ORDER');
 const body=Buffer.from(row.base64,'base64');need(body.length>0&&body.length<=CHUNK&&body.toString('base64')===row.base64&&offset+body.length<=manifest.files[index].bytes,'CUSTOMER_DELIVERY_CHUNK');
 partHash.update(body);await onChunk?.(manifest.files[index],index,offset,body);offset+=body.length;await finishEmpty();
 }
 need(manifest&&complete&&stamp(held.stat)===stamp(await held.file.stat({bigint:true}))&&length===Number(held.stat.size),'CUSTOMER_DELIVERY_INCOMPLETE');
 const result={schema:SCHEMA+'.inspection',manifest,manifestSha256:selected.sha256,files:selected.files,contentBytes:selected.bytes,bytes:length,sha256:packageHash.digest('hex'),outputsComplete:selected.outputsComplete};
 if(expected)need(result.bytes===expected.bytes&&result.sha256===expected.sha256,'CUSTOMER_DELIVERY_PACKAGE_CHANGED');return result;
 }finally{await held.file.close();}
}
export async function ensureMember(root,path){
 relative(path);let parent=root;await initializationDirectory(parent);const parts=path.split('/');for(const item of parts.slice(0,-1)){parent=join(parent,item);await initializationDirectory(parent,{create:true});}return join(parent,parts.at(-1));
}
export async function receivePackage({file,directory,expectedSha256}){
 absolute(file);absolute(directory);need(hash(expectedSha256),'CUSTOMER_DELIVERY_EXPECTED_SHA_REQUIRED');await initializationDirectory(directory,{create:true});
 const first=await inspectPackage(file);need(first.sha256===expectedSha256,'CUSTOMER_DELIVERY_PACKAGE_CHANGED');
 // The caller retains the original Collections lease around this receiver.
 const intent={schema:SCHEMA+'.receive-intent',sha256:first.sha256,bytes:first.bytes,manifestSha256:first.manifestSha256};
 await retainInitializationFile(join(directory,'receiving.json'),bytes(intent),{resume:true});
 const members=join(directory,'members');await initializationDirectory(members,{create:true});let out=null,current=null,temp=null;
 try{await inspectPackage(file,{expected:first,onManifest:async(m)=>{need(identity(m)===first.manifestSha256,'CUSTOMER_DELIVERY_PACKAGE_CHANGED');},
 onChunk:async(row,index,offset,body)=>{if(!out){current=await ensureMember(members,row.path);temp=join(dirname(current),'.receiving-'+randomUUID());out=await open(temp,'wx',0o600);}await out.writeFile(body);},
 onFile:async(row)=>{if(!out){current=await ensureMember(members,row.path);temp=join(dirname(current),'.receiving-'+randomUUID());out=await open(temp,'wx',0o600);}await out.sync();await out.close();out=null;await measure(temp,row);try{await link(temp,current);}catch(error){if(error.code!=='EEXIST')throw error;await measure(current,row);}const d=await open(dirname(current),'r');try{await d.sync();}finally{await d.close();}await unlink(temp);temp=null;current=null;}});
 }finally{if(out)await out.close().catch(()=>{});if(temp)await unlink(temp).catch(()=>{});}
 for(const row of first.manifest.files)await measure(join(members,row.path),row);
 await copyFile(file,join(directory,'customer-delivery.ndjson'),first,{maximum:MAX_PACKAGE});
 const result={schema:SCHEMA+'.received',...intent,files:first.files,contentBytes:first.contentBytes,outputsComplete:first.outputsComplete,manifest:first.manifest};
 await retainInitializationFile(join(directory,'result.json'),bytes(result),{resume:true});return{...result,directory};
}
