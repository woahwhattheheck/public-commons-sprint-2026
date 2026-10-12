// MIT. Invoke the installed Python operator with trusted host profiles.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { fault, identifier } from '../../odata/state.mjs';

const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeText=(value,label,max=2048)=>{
  if(typeof value!=='string'||!value||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw fault('CENTRAL_WAREHOUSE_PROFILE','Use a complete '+label+'.');
  return value;
};
export function normalizeWarehouseProfiles(values=[]) {
  if(!Array.isArray(values)||values.length>64)throw fault('CENTRAL_WAREHOUSE_PROFILE','Supply the existing host warehouse profiles.');
  const ids=new Set();
  return values.map(value=>{
    if(!plain(value))throw fault('CENTRAL_WAREHOUSE_PROFILE','Use a host profile object.');
    const allowed=new Set(['id','name','workspace','connectionEnv','schema','expectedWarehouse','python','timeoutSeconds']);
    if(Object.keys(value).some(key=>!allowed.has(key)))throw fault('CENTRAL_WAREHOUSE_PROFILE','Use host credential references and the original operator fields.');
    const id=identifier(value.id,'warehouse profile ID');
    if(ids.has(id))throw fault('CENTRAL_WAREHOUSE_PROFILE','Give every host profile its own ID.');
    ids.add(id);
    safeText(value.workspace,'private PostgreSQL operator workspace');
    if(!isAbsolute(value.workspace))throw fault('CENTRAL_WAREHOUSE_PROFILE','Use the current absolute private PostgreSQL operator directory.');
    const connectionEnv=value.connectionEnv??'SF_BUYER_POSTGRES_DSN',schema=value.schema??'sf_received';
    if(!/^[A-Z_][A-Z0-9_]{0,127}$/.test(connectionEnv)||!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      throw fault('CENTRAL_WAREHOUSE_PROFILE','Use the original environment-variable alias and dedicated SQL schema.');
    const expectedWarehouse=value.expectedWarehouse??null;
    if(expectedWarehouse!==null)safeText(expectedWarehouse,'original warehouse identity',160);
    const timeoutSeconds=value.timeoutSeconds??3600;
    if(!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>86400)
      throw fault('CENTRAL_WAREHOUSE_PROFILE','Use a 1–86,400 second original command lifetime.');
    return Object.freeze({id,name:safeText(value.name??id,'warehouse name',160),
      workspace:resolve(value.workspace),connectionEnv,schema,expectedWarehouse,
      python:safeText(value.python??'python3','installed Python executable'),timeoutSeconds});
  });
}

/**
 * The Python helper delegates command lifetime to the original run_owned.
 * Its inherited descriptor 3 closes when this Node owner exits, causing the
 * same command tree to unwind. No Python HTTP listener or database is created.
 */
export function createPostgresBridge({store,profiles=[]}={}) {
  if(!store?.retainStream||!store?.raw)throw fault('CENTRAL_WAREHOUSE_STORE','Use the held native Central Store.');
  const configured=normalizeWarehouseProfiles(profiles),byId=new Map(configured.map(p=>[p.id,p]));
  const get=id=>{identifier(id,'warehouse profile ID');const p=byId.get(id);
    if(!p)throw fault('CENTRAL_WAREHOUSE_PROFILE','Select a configured original warehouse profile.',404);return p;};
  const publicProfiles=()=>configured.map(({python,...profile})=>profile);
  async function invoke({profileId,warehouseId,arguments:args}={}) {
    const profile=get(profileId);
    if(!Array.isArray(args)||!args.length||args.some(x=>typeof x!=='string'||x.includes('\0')))
      throw fault('CENTRAL_WAREHOUSE_ARGUMENTS','Use original structured PostgreSQL command arguments.');
    if(warehouseId!==undefined&&warehouseId!==null)safeText(warehouseId,'original warehouse identity',160);
    if(profile.expectedWarehouse&&warehouseId&&profile.expectedWarehouse!==warehouseId)
      throw fault('CENTRAL_WAREHOUSE_PROFILE_CHANGED','The retained warehouse identity differs from this host profile.',409);
    const expected=warehouseId??profile.expectedWarehouse;
    const command=['--connection-env',profile.connectionEnv,'--schema',profile.schema,
      ...(expected?['--expect-warehouse',expected]:[]),...args];
    const payload=Buffer.from(JSON.stringify({arguments:command,timeout_seconds:profile.timeoutSeconds}));
    if(payload.length>65536)throw fault('CENTRAL_WAREHOUSE_ARGUMENTS','The complete command selection exceeds 64 KiB.');
    const child=spawn(profile.python,['-B',fileURLToPath(new URL('./invoke.py',import.meta.url))],
      {stdio:['pipe','pipe','pipe','pipe'],windowsHide:true});
    let spawnError=null;
    const completed=new Promise(resolveDone=>{
      child.once('error',error=>{spawnError=error;});
      child.once('close',(code,signal)=>resolveDone({code,signal}));
    });
    child.stdin.on('error',()=>{});child.stdio[3].on('error',()=>{});
    const retainOutput=stream=>store.retainStream(stream).catch(error=>{
      // A failed full-output writer must not leave the original helper blocked
      // on its pipe. EOF on the lifetime descriptor invokes its native owner.
      child.stdio[3].destroy();stream.resume();throw error;
    });
    const stdout=retainOutput(child.stdout),stderr=retainOutput(child.stderr);
    child.stdin.end(payload);
    const [exit,outputs]=await Promise.all([completed,Promise.allSettled([stdout,stderr])]);
    child.stdio[3].destroy();
    if(outputs.some(x=>x.status==='rejected')) {
      const e=fault('CENTRAL_WAREHOUSE_OUTPUT_STORAGE','The original command closed, but a full output could not be retained. Reopen this same request.',507);
      e.commandClosed=true;e.cause=outputs.find(x=>x.status==='rejected').reason;throw e;
    }
    const result={...exit,stdout:outputs[0].value,stderr:outputs[1].value,output:null};
    if(spawnError)result.error={code:'CENTRAL_WAREHOUSE_PYTHON_START',message:'The installed original Python operator did not start.'};
    if(result.code===0&&!result.signal) {
      if(result.stdout.bytes>16*1024*1024)result.error={code:'CENTRAL_WAREHOUSE_JSON_LIMIT',message:'Download the complete retained command output; its JSON exceeds the operator view.'};
      else try {result.output=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await store.raw(result.stdout.sha256)));}
      catch {result.error={code:'CENTRAL_WAREHOUSE_RESULT_JSON',message:'The original command did not return one complete JSON result.'};}
      if(result.output===null||!plain(result.output))result.error??={code:'CENTRAL_WAREHOUSE_RESULT_JSON',message:'The original command result is not an object.'};
    } else if(!result.error) {
      let native=null;
      if(result.stderr.bytes<=1024*1024) {
        const text=new TextDecoder('utf-8',{fatal:false}).decode(await store.raw(result.stderr.sha256));
        for(const line of text.trim().split('\n').reverse())try {const item=JSON.parse(line);if(plain(item)&&item.error){native=item;break;}}catch{}
      }
      result.error={code:typeof native?.error==='string'?native.error:'CENTRAL_WAREHOUSE_COMMAND_INTERRUPTED',
        message:result.code===124?'The original command timed out after closing its owned processes. Resume the same request.':
          'The original PostgreSQL command needs attention. Its complete output is retained.',
        native:native??null};
    }
    for(const output of [result.stdout,result.stderr])
      if(!HASH.test(output.sha256)||!Number.isSafeInteger(output.bytes))throw fault('CENTRAL_WAREHOUSE_OUTPUT_RECEIPT','Retain complete native command output receipts.');
    return result;
  }
  return Object.freeze({profiles:publicProfiles,get,invoke});
}
