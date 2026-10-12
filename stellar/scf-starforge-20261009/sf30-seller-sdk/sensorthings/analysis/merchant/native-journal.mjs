// SPDX-License-Identifier: MIT
// Caller journal only. Domain changes still use the original workspace writer.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,dirname,basename} from 'node:path';
import {open,link,unlink,readdir,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {privateDirectory,readOwned,syncDir} from '../../../stellar-expert/store.mjs';
import {openPrivateFile,hashHeldFile,inspectRetainedFile} from '../../portable.mjs';
import {json,identity,stable,sha,plain,need,absolute,hash,opId} from './common.mjs';
const MAX=24*1024*1024,PHASE=/^[a-z][a-z0-9-]{0,80}$/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readJSON(path,maximum=MAX){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,maximum)));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
/** Same complete bytes can finish a killed pre-link publication. A conflicting
 * or incomplete unknown request is preserved and is not guessed or dispatched. */
export async function publish(path,raw){
  raw=Buffer.isBuffer(raw)?raw:json(raw);
  need(raw.length<=MAX,'NATIVE_JOURNAL_CAPACITY','The complete caller record exceeds its declared capacity.',413);
  let old;try{old=await readOwned(path,MAX);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old){need(old.equals(raw),'NATIVE_JOURNAL_CHANGED','The original caller record has different bytes.');return;}
  const parent=dirname(path),staging=join(parent,'.'+basename(path)+'.'+sha(raw)+'.pending');
  let handle;
  try{handle=await open(staging,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(raw);await handle.sync();}
  catch(e){if(e.code!=='EEXIST')throw e;
    const prior=await readOwned(staging,MAX);
    need(prior.equals(raw),'NATIVE_STAGING_UNRESOLVED','The original caller staging file is incomplete or different. Preserve it and recover its original complete bytes.');
  }finally{await handle?.close();}
  try{await link(staging,path);}catch(e){if(e.code!=='EEXIST')throw e;
    need((await readOwned(path,MAX)).equals(raw),'NATIVE_JOURNAL_CHANGED','The original caller record changed during publication.');}
  await syncDir(parent);await unlink(staging).catch(e=>{if(e.code!=='ENOENT')throw e;});await syncDir(parent);
}
async function recoverPublished(path,validate){
  let value=await readJSON(path);if(value!==null){validate(value);return value;}
  const prefix='.'+basename(path)+'.',candidates=(await readdir(dirname(path))).filter(n=>n.startsWith(prefix)&&n.endsWith('.pending'));
  if(!candidates.length)return null;
  need(candidates.length===1,'NATIVE_STAGING_UNRESOLVED','Multiple original pending caller records require explicit recovery.');
  const raw=await readOwned(join(dirname(path),candidates[0]),MAX);
  need(candidates[0]===prefix+sha(raw)+'.pending','NATIVE_STAGING_UNRESOLVED','The original pending caller record is incomplete. No request was inferred.');
  value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));validate(value);await publish(path,raw);return value;
}
async function lease(directory){
  await privateDirectory(directory,{create:true});
  const child=spawn('flock',['--exclusive','--nonblock',join(directory,'native-caller.lock'),process.execPath,'-e',
    "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],
    {stdio:['pipe','pipe','pipe'],detached:true});
  let closed=false,error=null;child.on('error',e=>{error=e;});child.stderr.resume();
  const done=once(child,'close').catch(()=>null);
  try{
    const status=await Promise.race([new Promise((resolve,reject)=>{
      let text='';child.stdout.on('data',part=>{text+=part.toString();if(text.includes('LOCKED\n'))resolve(true);});
      child.once('error',reject);child.once('close',()=>resolve(false));
    }),pause(10000).then(()=>false)]);
    need(status&&!error,'NATIVE_CALLER_ACTIVE','The original control directory already has a live caller or its kernel lock is unavailable.');
  }catch(e){child.stdin.end();if(child.exitCode===null)try{process.kill(-child.pid,'SIGTERM');}catch{}await done;throw e;}
  return {assert(){need(!closed&&child.exitCode===null&&!error,'NATIVE_CALLER_LEASE','The original caller no longer holds its kernel lease.');},
    async close(){if(closed)return;closed=true;child.stdin.end();await done;}};
}
export async function openNativeJournal(input,{signal,progress=()=>{}}={}){
  need(plain(input),'NATIVE_INPUT','Use the complete original native continuation input.',422);
  absolute(input.controlDirectory,'original private continuation directory');opId(input.operationId);
  const owned=await lease(input.controlDirectory),root=input.controlDirectory,contextSha256=identity(input);
  try{
    await publish(join(root,'input.json'),input);
    const phaseRoot=join(root,'phases');await privateDirectory(phaseRoot,{create:true});
    const active=()=>{owned.assert();signal?.throwIfAborted();};
    function file(name,suffix){need(PHASE.test(name),'NATIVE_PHASE','Use a declared original caller phase.');return join(phaseRoot,name+'.'+suffix+'.json');}
    function validate(name,kind,value){
      need(value?.schema==='stellar-forge.sensorthings-analysis-merchant-native-phase.v1'&&
        value.operationId===input.operationId&&value.contextSha256===contextSha256&&value.name===name&&value.kind===kind&&
        value.valueSha256===identity(value.value),'NATIVE_PHASE_CHANGED','The original phase has another input or result identity.');
    }
    async function read(name,kind='result'){active();return (await recoverPublished(file(name,kind),v=>validate(name,kind,v)))?.value??null;}
    async function save(name,value,kind='result'){active();await publish(file(name,kind),{
      schema:'stellar-forge.sensorthings-analysis-merchant-native-phase.v1',operationId:input.operationId,
      contextSha256,name,kind,valueSha256:identity(value),value});return value;}
    async function phase(name,build){const old=await read(name);if(old!==null)return old;active();return save(name,await build());}
    async function observe(name,value){const first=await phase(name,async()=>value);need(stable(first)===stable(value),'NATIVE_OBSERVATION_CHANGED','The original caller selection or endpoint changed.');return first;}
    return {root,contextSha256,active,read,save,phase,observe,signal,progress,close:()=>owned.close()};
  }catch(e){await owned.close();throw e;}
}
export async function verifyFile(path,file,maximum=8*1024*1024*1024){
  absolute(path,'original retained file');hash(file.sha256);
  need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=maximum,'NATIVE_FILE_CAPACITY','Retain the complete bounded file.',413);
  return inspectRetainedFile(path,{expectedBytes:file.bytes,expectedSha256:file.sha256,maximum});
}
/** Create-only receiving into an explicitly selected host inbox. */
export async function receiveFile(path,directory,filename,file,{signal}={}){
  absolute(directory,'configured original inbox');need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(filename),'NATIVE_FILENAME','Use an exact portable inbox filename.',422);
  await privateDirectory(directory,{create:false});const target=join(directory,filename);
  try{await lstat(target);await verifyFile(target,file);return {filename,bytes:file.bytes,sha256:file.sha256};}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const held=await openPrivateFile(path,{expectedBytes:file.bytes,maximum:8*1024*1024*1024}),
    temporary=join(directory,'.'+filename+'.'+file.sha256+'.receiving');
  let output;
  try{
    await hashHeldFile(held.handle,{expectedBytes:file.bytes,expectedSha256:file.sha256,maximum:8*1024*1024*1024});
    try{output=await open(temporary,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
    catch(e){if(e.code!=='EEXIST')throw e;
      const st=await lstat(temporary);
      need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&
        (typeof process.getuid!=='function'||st.uid===process.getuid())&&st.size<=file.bytes,'NATIVE_FILE_STAGING','The original staged incoming file is not owned and bounded.');
      output=await open(temporary,constants.O_RDWR|constants.O_NOFOLLOW);
      const actual=await output.stat();need(actual.dev===st.dev&&actual.ino===st.ino,'NATIVE_FILE_STAGING','The staged file changed.');
    }
    const prior=await output.stat(),left=Buffer.alloc(131072),right=Buffer.alloc(131072);
    let offset=0;
    while(offset<prior.size){signal?.throwIfAborted();const n=Math.min(left.length,prior.size-offset),
      a=await held.handle.read(left,0,n,offset),b=await output.read(right,0,n,offset);
      need(a.bytesRead===n&&b.bytesRead===n&&left.subarray(0,n).equals(right.subarray(0,n)),'NATIVE_FILE_STAGING','The retained partial receiving file differs from the exact source.');offset+=n;}
    while(offset<file.bytes){signal?.throwIfAborted();const n=Math.min(left.length,file.bytes-offset),r=await held.handle.read(left,0,n,offset);
      need(r.bytesRead>0,'NATIVE_FILE_CHANGED','The original source ended during receiving.');
      let done=0;while(done<r.bytesRead){const w=await output.write(left,done,r.bytesRead-done,offset+done);need(w.bytesWritten>0,'NATIVE_FILE_WRITE','The original receiving file could not advance.');done+=w.bytesWritten;}offset+=r.bytesRead;}
    await output.sync();await output.close();output=null;await verifyFile(temporary,file);
    await hashHeldFile(held.handle,{expectedBytes:file.bytes,expectedSha256:file.sha256,maximum:8*1024*1024*1024});
    try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;await verifyFile(target,file);}
    await syncDir(directory);await unlink(temporary);await syncDir(directory);await verifyFile(target,file);
    return {filename,bytes:file.bytes,sha256:file.sha256};
  }finally{await output?.close();await held.handle.close();}
}
export async function runBrowserAction(journal,{name,client,page,action,validatePayload,prepare,timeoutMs=300000}){
  journal.active();const scope={workspaceId:client.workspaceId,origin:client.origin,action};
  await journal.observe(name+'-intent',scope);
  const check=saved=>{
    need(stable(saved.scope)===stable(scope)&&saved.rawSha256===sha(saved.raw),'NATIVE_REQUEST_CHANGED','The retained UI request belongs to another original endpoint or phase.');
    const request=JSON.parse(saved.raw);need(request.action===action&&request.operationId===saved.operationId&&
      saved.requestSha256===identity({action:request.action,payload:request.payload}),'NATIVE_REQUEST_CHANGED','The original UI request identity changed.');
    validatePayload(request.payload);return request;
  };
  let saved=await journal.read(name,'request');
  if(saved)check(saved);
  if(!saved){
    let resolveCapture,rejectCapture,handlerError=null;
    const captured=new Promise((resolve,reject)=>{resolveCapture=resolve;rejectCapture=reject;});void captured.catch(()=>{});
    const handler=async route=>{
      const request=route.request();
      if(request.url()!==client.origin+'/api/action'||request.method()!=='POST'){await route.continue();return;}
      try{
        journal.active();need(!saved,'NATIVE_DUPLICATE_CLICK','Only one UI request belongs to this original phase.');
        const raw=request.postData();need(typeof raw==='string','NATIVE_REQUEST','The visible form did not produce original JSON.');
        const body=JSON.parse(raw),headers=await request.allHeaders();
        need(body.action===action&&headers['x-sensorthings-workspace']===client.workspaceId,'NATIVE_UI_SCOPE','The visible form targeted another action or workspace.');
        validatePayload(body.payload);
        saved={scope,operationId:body.operationId,requestSha256:identity({action:body.action,payload:body.payload}),raw,rawSha256:sha(raw)};
        check(saved);await journal.save(name,saved,'request');await route.continue();resolveCapture(saved);
      }catch(e){handlerError=e;await route.abort().catch(()=>{});rejectCapture(e);}
    };
    await page.route('**/api/action',handler);
    try{
      await prepare();await Promise.race([captured,pause(60000).then(()=>{throw new Error('The selected original form did not dispatch; inspect its visible validation before retry.');})]);
      if(handlerError)throw handlerError;
    }finally{await page.unroute('**/api/action',handler);}
  }
  const prior=await journal.read(name);
  async function committed(){
    const original=await client.operation(saved.operationId);
    need(original.operationId===saved.operationId&&original.requestSha256===saved.requestSha256&&original.action===action,
      'NATIVE_OPERATION_CHANGED','The native operation has another original request.');
    if(original.state==='FAILED')throw Object.assign(new Error('The original operation failed. Use its explicit attributed continuation; the native caller will not create a replacement.'),{code:'NATIVE_ORIGINAL_FAILED',operationId:saved.operationId});
    if(original.state!=='COMPLETE')return null;
    need(original.result&&original.resultSha256===sha(json(original.result)),'NATIVE_RESULT_CHANGED','The original operation result is missing or changed.');
    return {operationId:saved.operationId,requestSha256:saved.requestSha256,resultSha256:original.resultSha256,result:original.result};
  }
  const deadline=Date.now()+timeoutMs;let resent=false,lastProgress=0;
  while(true){
    journal.active();let result;
    try{result=await committed();}catch(e){
      if(e.status!==404)throw e;
      if(prior)throw Object.assign(new Error('The previously committed original operation is unavailable.'),{code:'NATIVE_ORIGINAL_UNAVAILABLE',operationId:saved.operationId});
      if(!resent){resent=true;await client.actionRaw(saved.raw).catch(e=>{if(e.code!=='TRANSPORT')throw e;});}
    }
    if(result){if(prior)need(stable(prior)===stable(result),'NATIVE_RESULT_CHANGED','The original completed phase differs.');else await journal.save(name,result);return result;}
    need(Date.now()<deadline,'NATIVE_OPERATION_PENDING','The original operation remains pending; resume this same control directory.');
    if(Date.now()-lastProgress>15000){journal.progress({phase:name,operationId:saved.operationId,state:'WAITING_FOR_ORIGINAL_RESULT'});lastProgress=Date.now();}
    await pause(500);
  }
}
