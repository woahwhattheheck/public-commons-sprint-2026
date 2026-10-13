#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile,mkdir,open,rename,unlink,lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {collectCrmCapture,validateCaptureConfiguration} from './collector.mjs';
import {digest,canonical,requireValue as need} from './provider-input.mjs';
const MAX=512*1024*1024,MAX_RESPONSE=32*1024*1024;
const text=value=>JSON.stringify(value,null,2)+'\n';
const keyValid=key=>typeof key==='string'&&/^[A-Za-z0-9_/-]+$/.test(key)&&key.split('/').every(x=>x&&x!=='.'&&x!=='..');
const pinValid=pin=>pin&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&typeof pin.sha256==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256);
const samePin=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
async function ordinary(path){const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink(),'Use an ordinary private file: '+path);return s;}
async function readJson(path){try{await ordinary(path);return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(path,body,{immutable=false}={}){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 if(immutable){const old=await readJson(path);if(old!==null){need(canonical(old)===canonical(JSON.parse(body)),'An existing complete output differs: '+path);return;}}
 const tmp=path+'.pending-'+randomUUID(),h=await open(tmp,'wx',0o600);
 try{await h.writeFile(body,'utf8');await h.sync();await h.close();await rename(tmp,path);}finally{await h.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
}
function verifyOriginal(value){
 let body,pin;
 if(value?.schema==='twenty.original-http-response.v1'){
  need(value.intent&&digest(canonical(value.intent)).sha256===value.intentSha256,'Original request identity changed.');
  need(value.page&&Number.isInteger(value.page.status),'Retain an original HTTP response status.');
  body=value.page.body;pin=value.page;
 }else{
  need(value?.schema==='twenty.original-export.v1'&&typeof value.sourcePath==='string'&&value.spec,'Retain a complete original export.');
  body=value.original?.body;pin=value.original;
 }
 need(typeof body==='string'&&pinValid(pin)&&samePin(digest(body),pin),'Original response or export bytes changed.');
}
export async function captureDirectory(configPath,directory,{fetchImpl=fetch,environment=process.env}={}){
 const input=resolve(configPath),root=resolve(directory);await ordinary(input);const config=validateCaptureConfiguration(JSON.parse(await readFile(input,'utf8')));
 await mkdir(root,{recursive:true,mode:0o700});const rs=await lstat(root);need(rs.isDirectory()&&!rs.isSymbolicLink(),'Use an ordinary private output directory.');
 const lock=join(root,'.collector-lock.json'),owner={host:hostname(),pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()};
 let handle,ownerWritten=false;
 try{handle=await open(lock,'wx',0o600);}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  const recovery=lock+'.recovery',recoveryOwner={...owner,purpose:'stale-lock-recovery'};
  let guard;
  try{guard=await open(recovery,'wx',0o600);}
  catch(guardError){if(guardError.code==='EEXIST')throw Error('Original stale-lock recovery is already owned. Inspect '+recovery+' and its recorded process before continuing.');throw guardError;}
  try{
   await guard.writeFile(text(recoveryOwner));await guard.sync();await guard.close();
   const old=await readJson(lock);
   if(old){
    need(old.host===hostname()&&Number.isSafeInteger(old.pid)&&old.pid>0,'The original collector retains this directory. Inspect its original lock and owner.');
    let alive=true;try{process.kill(old.pid,0);}catch(probe){if(probe.code==='ESRCH')alive=false;else throw probe;}
    need(!alive,'The original collector process is still active.');
    const current=await readJson(lock);need(current&&canonical(current)===canonical(old),'Original collector ownership changed during recovery.');
    await rename(lock,lock+'.interrupted-'+randomUUID());
   }
   handle=await open(lock,'wx',0o600);
   await handle.writeFile(text(owner));await handle.sync();ownerWritten=true;
  }catch(error){if(handle){await handle.close().catch(()=>{});await unlink(lock).catch(()=>{});handle=null;}throw error;}
  finally{await guard.close().catch(()=>{});await unlink(recovery).catch(()=>{});}
 }
 try{if(!ownerWritten){await handle.writeFile(text(owner));await handle.sync();}await handle.close();}
 catch(error){await handle.close().catch(()=>{});await unlink(lock).catch(()=>{});throw error;}
 let primaryError;
 try{
  const ledgerPath=join(root,'HTTP_INDEX.json'),journalPath=join(root,'PAGE_WRITE.json');
  const ledger=await readJson(ledgerPath)||{schema:'twenty.capture-index.v1',files:[]},journal=await readJson(journalPath);
  need(ledger.schema==='twenty.capture-index.v1'&&Array.isArray(ledger.files),'Retain and repair the malformed original HTTP_INDEX.json.');
  const indexed=new Map();
  for(const row of ledger.files){need(keyValid(row.key)&&pinValid(row)&&!indexed.has(row.key),'Malformed or duplicate original index entry.');indexed.set(row.key,row);}
  if(journal){
   need(journal.schema==='twenty.page-write.v1'&&keyValid(journal.key)&&pinValid(journal.next)&&(!journal.previous||pinValid(journal.previous))&&
    (journal.previous?keyValid(journal.attemptKey)&&journal.attemptKey.startsWith(journal.key+'/attempt-'):journal.attemptKey===null),'Retain and repair the malformed original PAGE_WRITE.json.');
  }
  const originals=join(root,'originals'),pathFor=key=>{need(keyValid(key),'Unsafe original response path.');return join(originals,key+'.json');};
  const actual=new Map();
  async function scan(directory,prefix=''){
   let entries;try{const state=await lstat(directory);need(state.isDirectory()&&!state.isSymbolicLink(),'Use ordinary original-response directories.');entries=await readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const entry of entries){
    const path=join(directory,entry.name),key=prefix+entry.name;
    need(!entry.isSymbolicLink(),'Original response tree contains a symbolic link.');
    if(entry.isDirectory()){await scan(path,key+'/');continue;}
    need(entry.isFile(),'Original response tree contains a special file.');
    if(/\.json\.pending-[A-Za-z0-9-]+$/.test(entry.name))continue;
    need(entry.name.endsWith('.json'),'Unexpected file in original response tree.');
    const logical=key.slice(0,-5);need(keyValid(logical)&&!actual.has(logical),'Invalid or duplicate original response path.');
    const raw=await readFile(path),body=raw.toString('utf8');need(Buffer.from(body,'utf8').equals(raw),'Original response file is not valid UTF-8.');
    verifyOriginal(JSON.parse(body));actual.set(logical,{key:logical,...digest(body)});
   }
  }
  await scan(originals);
  for(const [key,pin]of indexed){
   const found=actual.get(key);need(found,'An indexed original response is missing: '+key);
   if(!samePin(found,pin))need(journal&&key===journal.key&&samePin(found,journal.next)&&journal.previous&&samePin(pin,journal.previous),'An indexed original response changed: '+key);
  }
  if(journal){
   const found=actual.get(journal.key);
   if(found&&samePin(found,journal.next)&&journal.previous)need(actual.has(journal.attemptKey)&&samePin(actual.get(journal.attemptKey),journal.previous),'An interrupted retry lost its original response history.');
   if(found)need(samePin(found,journal.next)||journal.previous&&samePin(found,journal.previous),'Interrupted response differs from its durable write intent.');
   if(actual.has(journal.attemptKey))need(samePin(actual.get(journal.attemptKey),journal.previous),'Retained retry history differs from its durable write intent.');
  }
  let total=[...actual.values()].reduce((n,x)=>n+x.bytes,0);
  need(total<=MAX,'Complete retained original collection exceeds 512 MiB.');
  ledger.files=[...actual.values()].sort((a,b)=>a.key.localeCompare(b.key));
  await save(ledgerPath,text(ledger));if(journal)await unlink(journalPath);
  const io={
   now:()=>new Date().toISOString(),wait:ms=>new Promise(r=>setTimeout(r,ms)),
   readSession:()=>readJson(join(root,'CAPTURE_SESSION.json')),
   saveSession:async session=>{const body=text(session);need(Buffer.byteLength(body)<=MAX,'Complete capture exceeds 512 MiB. The original page files remain retained.');await save(join(root,'CAPTURE_SESSION.json'),body);},
   readPage:async key=>{const value=await readJson(pathFor(key));if(value!==null)verifyOriginal(value);return value;},
   savePage:async(key,value)=>{
    verifyOriginal(value);
    const body=text(value),pin=digest(body),prior=ledger.files.find(x=>x.key===key);
    if(prior&&samePin(prior,pin))return;
    const attemptKey=prior?key+'/attempt-'+randomUUID():null;
    need(total+pin.bytes<=MAX,'Complete original response and retry history exceeds 512 MiB.');
    const intent={schema:'twenty.page-write.v1',key,previous:prior?{bytes:prior.bytes,sha256:prior.sha256}:null,next:pin,attemptKey};
    await save(journalPath,text(intent),{immutable:true});
    if(prior){
     const oldBody=await readFile(pathFor(key),'utf8');need(samePin(digest(oldBody),prior),'Original response changed before retry.');
     await save(pathFor(attemptKey),oldBody,{immutable:true});
    }
    await save(pathFor(key),body);
    if(prior){ledger.files.push({key:attemptKey,bytes:prior.bytes,sha256:prior.sha256});Object.assign(prior,pin);}
    else ledger.files.push({key,...pin});
    total+=pin.bytes;ledger.files.sort((a,b)=>a.key.localeCompare(b.key));
    await save(ledgerPath,text(ledger));await unlink(journalPath);
   },
   readOriginal:async path=>{const file=resolve(dirname(input),path),s=await ordinary(file);need(s.size<=MAX,'Original source exceeds the complete 512 MiB capacity.');const raw=await readFile(file),body=raw.toString('utf8');need(Buffer.from(body,'utf8').equals(raw),'Retain a valid UTF-8 original JSON export.');return {body,filename:basename(file)};},
   request:async({url,tokenEnv})=>{
    const token=environment[tokenEnv];need(typeof token==='string'&&token.trim()&&!/[\r\n]/.test(token),'Set the selected private API-key environment variable.');
    const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(45000)});
    need(response.body&&typeof response.body.getReader==='function','Provider returned no readable response body.');
    const chunks=[];let size=0;const reader=response.body.getReader();
    try{
     for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;need(size<=MAX_RESPONSE,'Original response exceeds 32 MiB; narrow the explicit selected population or fields.');chunks.push(r.value);}
     const raw=Buffer.concat(chunks),body=raw.toString('utf8');need(Buffer.from(body,'utf8').equals(raw),'Original provider returned non-UTF-8 JSON.');
     return {status:response.status,body,retryAfter:response.headers.get('retry-after')};
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
   },
   saveResult:async capture=>{await save(join(root,'capture.json'),text(capture),{immutable:true});}
  };
  const capture=await collectCrmCapture(config,io);
  return {operationId:capture.operationId,output:join(root,'capture.json'),...digest(text(capture)),sourceObjects:capture.source.objects.length,targetObjects:capture.target.objects.length,state:capture.state};
 }catch(error){primaryError=error;throw error;}
 finally{
  try{const current=await readJson(lock);if(current?.token===owner.token)await unlink(lock);}
  catch(cleanupError){if(!primaryError)throw cleanupError;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [configuration,directory]=process.argv.slice(2);if(!configuration||!directory||process.argv.length!==4)throw Error('Usage: node capture-twenty.mjs capture-configuration.json PRIVATE_OUTPUT_DIRECTORY');
 console.log(text(await captureDirectory(configuration,directory)));
}
