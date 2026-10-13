'use strict';
// Invoke the maintained local coordinator. This adapter does not impersonate
// GitHub tools, hold Gmail credentials, or send mail.
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const KIND='commons.connected-contact-local-state/v1';
const MAX=256*1024*1024;
const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function fault(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function configured(options){
 if(process.platform!=='linux')throw fault('LOCAL_STATE_PLATFORM','Run the original Node controller and coordinator in the same selected Linux or WSL Linux environment. Native Windows is unsupported.');
 const {directory,coordinatorId,authority,python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',
  source=path.join(__dirname,'connected_contact_local_state.py'),timeoutMs=60000}=options||{};
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof coordinatorId!=='string'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(coordinatorId)||
    !authority||typeof authority.scope_id!=='string'||!Array.isArray(authority.accounts)||
    !authority.accounts.length||typeof python!=='string'||!python||
    !path.isAbsolute(source)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)
  throw fault('LOCAL_STATE_CONFIGURATION','Use the original coordinator directory, identity, complete authority and existing Python runtime.');
 const st=fs.lstatSync(source);if(!st.isFile()||st.isSymbolicLink())
  throw fault('LOCAL_STATE_SOURCE','Use the complete selected regular coordinator source.');
 return {directory,coordinatorId,authority:copy(authority),python,source,timeoutMs};
}
function run(config,action,body={}){
 const request={...body,kind:KIND,action,coordinator_id:config.coordinatorId};
 const input=Buffer.from(JSON.stringify(request),'utf8');
 if(input.length>MAX)throw fault('LOCAL_STATE_REQUEST_SIZE','Complete coordinator request exceeds 256 MiB.');
 return new Promise((resolve,reject)=>{
  const child=spawn(config.python,['-B',config.source,'--directory',config.directory],
   {stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  let ended=false,timedOut=false,size=0,overflow=false;
  const output=[];
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},config.timeoutMs);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX){overflow=true;child.kill('SIGKILL');}else output.push(chunk);});
  // Never publish private interpreter or request snippets to an operation log.
  child.stderr.resume();
  child.stdin.on('error',()=>{});
  child.on('error',()=>{if(!ended){ended=true;clearTimeout(timer);reject(fault('LOCAL_STATE_UNAVAILABLE','The selected original coordinator process did not start.',503));}});
  child.on('close',code=>{
   if(ended)return;ended=true;clearTimeout(timer);
   if(timedOut||overflow)return reject(fault('LOCAL_STATE_OUTCOME_UNKNOWN',
    'Retain the same state operation ID; read or repeat that exact state request to receive its result.',503));
   let value;try{value=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{
    return reject(fault('LOCAL_STATE_OUTCOME_UNKNOWN','Original state response is incomplete; retain the same operation ID.',503));}
   if(!value?.ok)return reject(fault(value?.error?.code||'LOCAL_STATE_FAILURE',
    value?.error?.message||'Original state operation did not complete.',Number(value?.error?.status)||500));
   if(code!==0)return reject(fault('LOCAL_STATE_OUTCOME_UNKNOWN','Original state process ended without a confirmed success.',503));
   resolve(value.result);
  });
  child.stdin.end(input);
 });
}
function verifiedSnapshot(config,value){
 if(value===null)return null;
 const r=value?.receipt;
 if(value?.kind!=='commons.connected-contact-local-snapshot/v1'||value.coordinator_id!==config.coordinatorId||
    typeof value.content!=='string'||sha(value.content)!==value.sha256||
    !Number.isSafeInteger(value.revision)||value.revision<1||
    r?.schema!=='commons.connected-contact-local-receipt/v1'||r.coordinator_id!==config.coordinatorId||
    r.namespace!==value.namespace||r.key!==value.key||r.revision!==value.revision||
    r.sha256!==value.sha256||r.bytes!==Buffer.byteLength(value.content,'utf8'))
  throw fault('LOCAL_STATE_RECEIPT','Original local state content or typed receipt changed.');
 return copy(value);
}
function createContactFileState(options){
 const config=configured(options);
 async function verify(){
  const result=await run(config,'verify');
  if(result?.kind!==KIND||result.coordinator_id!==config.coordinatorId||result.directory!==config.directory||
     canonical(result.authority)!==canonical(config.authority))
   throw fault('LOCAL_STATE_AUTHORITY','Original shared coordinator authority changed.');
  return result;
 }
 return Object.freeze({
  kind:KIND,coordinatorId:config.coordinatorId,authority:copy(config.authority),
  verify,
  async read(selection){await verify();const result=verifiedSnapshot(config,await run(config,'read',selection));
   if(result&&(result.namespace!==selection.namespace||result.key!==selection.key))
    throw fault('LOCAL_STATE_IDENTITY','Original state selection changed.');return result;},
  async compareAndSwap(request){await verify();const result=verifiedSnapshot(config,await run(config,'compare-and-swap',request));
   if(!result||result.namespace!==request.namespace||result.key!==request.key||result.content!==request.content||
      result.receipt.operation_id!==request.operation_id||result.receipt.action!=='compareAndSwap')
    throw fault('LOCAL_STATE_IDENTITY','Original state result does not match its exact request.');return result;},
  async history(selection){await verify();const result=await run(config,'history',selection);
   if(!Array.isArray(result?.records))throw fault('LOCAL_STATE_HISTORY','Complete original state history required.');
   return {...result,records:result.records.map(value=>{
    const item=verifiedSnapshot(config,value);
    if(item.namespace!==selection.namespace||item.key!==selection.key)
     throw fault('LOCAL_STATE_IDENTITY','Original history selection changed.');return item;})};},
  async receive(request){await verify();const result=verifiedSnapshot(config,await run(config,'receive',request));
   if(!result||result.namespace!==request.namespace||result.key!==request.key||result.content!==request.content||
      result.receipt.operation_id!==request.operation_id||result.receipt.action!=='receive')
    throw fault('LOCAL_STATE_IDENTITY','Original receiving result does not match its exact request.');return result;},
  async receiveBatch(request){await verify();const result=await run(config,'receive-batch',request);
   if(result?.status!=='ORIGINAL_STATE_RECEIVED'||result.coordinator_id!==config.coordinatorId||
      result.operation_id!==request.operation_id||!Array.isArray(result.records)||!Array.isArray(request.entries)||
      result.records.length!==request.entries.length)throw fault('LOCAL_STATE_ADOPTION','Original batch receiving did not complete.');
   return {...result,records:result.records.map((value,index)=>{
    const item=verifiedSnapshot(config,value),selected=request.entries[index];
    if(!item||item.namespace!==selected.namespace||item.key!==selected.key||item.content!==selected.content||
       item.receipt.operation_id!==request.operation_id+':'+index||item.receipt.action!=='receive')
     throw fault('LOCAL_STATE_IDENTITY','Original batch records differ from the complete original selection.');return item;})};}
 });
}
async function initializeContactCoordinator(options){
 const config=configured(options);
 return run(config,'initialize',{authority:config.authority});
}
module.exports={createContactFileState,initializeContactCoordinator,KIND};
