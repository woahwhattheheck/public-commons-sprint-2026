// SPDX-License-Identifier: MIT
// Durable adapter files. Scientific, payment and Operations state remain in their original engines.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,readdir,link,unlink} from 'node:fs/promises';
import {resolve,isAbsolute,join,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {fileURLToPath} from 'node:url';

export const SCHEMA='stellar-forge.groundwater-report-desk.v1';
export const MAX_FILE=16*1024*1024, MAX_JSON=16*1024*1024;
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export const now=()=>new Date().toISOString();
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function fail(code,message,status=409,detail){return Object.assign(new Error(message),{code,status,...(detail?{detail}:{})});}
export function need(ok,code,message,status=409){if(!ok)throw fail(code,message,status);}
export function text(value,label,max=500,required=true){
  need(typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&(!required||value.trim()),'INVALID_INPUT','Use the explicit '+label+'.',422);
  return value;
}
export function ident(value,label='operation ID'){text(value,label,120);need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value),'INVALID_ID','Use a stable '+label+'.',422);return value;}
export function digest(value,label='SHA-256'){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'INVALID_DIGEST','Use the exact '+label+'.',422);return value;}
export function absolute(value,label='path'){text(value,label,4096);need(isAbsolute(value)&&resolve(value)===value,'ABSOLUTE_PATH_REQUIRED','Select an absolute normalized '+label+'.',422);return value;}
export function fields(value,allowed,label){
  need(object(value)&&Object.keys(value).every(k=>allowed.includes(k)),'INVALID_FIELDS','Use the declared '+label+'.',422);return value;
}
export function plainName(value){text(value,'filename',180);need(!/[\/\\]/.test(value)&&!['.','..'].includes(value),'INVALID_FILENAME','Use a plain filename.',422);return value;}
export function relative(value){
  text(value,'relative path',2000);need(!isAbsolute(value)&&!value.includes('\\')&&value.split('/').every(x=>x&&!['.','..'].includes(x)),'INVALID_PATH','Retain a contained relative path.',422);return value;
}
export const identity=raw=>({bytes:raw.length,sha256:sha(raw)});
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
export async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function directory(path,{create=false,privateOnly=true}={}){
  absolute(path);
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path,'DIRECTORY_IDENTITY','Select the original unlinked directory.');
  if(privateOnly&&process.platform!=='win32')need((s.mode&0o077)===0&&s.uid===process.getuid(),'PRIVATE_DIRECTORY_REQUIRED','Use a private directory owned by this operator.');
  return path;
}
export async function read(path,limit=MAX_JSON){
  absolute(path);let h;
  try{h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));}
  catch(e){if(e.code==='ENOENT')throw fail('ORIGINAL_FILE_UNAVAILABLE','The original retained file is unavailable.',404,{filename:basename(path)});throw e;}
  try{
    const before=await h.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(limit),'FILE_BOUND','Select a regular file within the declared byte bound.',413);
    const data=Buffer.alloc(Number(before.size)+1);let length=0;
    while(length<data.length){const n=await h.read(data,length,data.length-length,length);if(!n.bytesRead)break;length+=n.bytesRead;}
    const after=await h.stat({bigint:true}),named=await lstat(path,{bigint:true});
    need(length===Number(before.size)&&same(before,after)&&same(after,named)&&!named.isSymbolicLink()&&await realpath(path)===path,'FILE_CHANGED','The selected original file changed during its read.');
    return data.subarray(0,length);
  }finally{await h.close();}
}
export async function readJSON(path,limit=MAX_JSON){
  const raw=await read(path,limit);let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fail('INVALID_JSON','Use complete original UTF-8 JSON.',422);}
  return {raw,value,...identity(raw)};
}
export async function syncDir(path){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
export async function put(path,data){
  absolute(path);const raw=Buffer.isBuffer(data)?data:json(data);
  await directory(dirname(path),{create:true});
  if(await exists(path)){const old=await read(path,Math.max(raw.length,1));need(old.equals(raw),'RETAINED_FILE_CONFLICT','The original saved file has different bytes.');return {path,...identity(old),reused:true};}
  const temp=join(dirname(path),'.pending-'+basename(path)+'-'+sha(raw)+'-'+randomUUID());
  const h=await open(temp,'wx',0o600);
  try{
    await h.writeFile(raw);await h.sync();await h.close();
    try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(path,Math.max(raw.length,1));need(old.equals(raw),'RETAINED_FILE_CONFLICT','A different original file already occupies this path.');}
    await syncDir(dirname(path));
  }finally{await h.close().catch(()=>{});await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return {path,...identity(raw),reused:false};
}
export async function checkFile(path,expected,limit=MAX_FILE){
  need(object(expected)&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0,'FILE_IDENTITY','Retain the original file byte count.');
  digest(expected.sha256);const raw=await read(path,limit);
  need(raw.length===expected.bytes&&sha(raw)===expected.sha256,'FILE_IDENTITY','The original retained bytes differ from their frozen identity.');
  return raw;
}
export async function recoverPendingJSON(path,validate){
  const prefix='.pending-'+basename(path)+'-',candidates=(await readdir(dirname(path))).filter(x=>x.startsWith(prefix));
  if(!candidates.length)return null;
  const rows=[];
  for(const name of candidates){const file=join(dirname(path),name),row=await readJSON(file);need(validate(row.value),'PENDING_IDENTITY','The retained original publication has different fields.');rows.push({...row,file});}
  need(rows.every(x=>x.raw.equals(rows[0].raw)),'PENDING_AMBIGUOUS','Resolve the distinct original pending publications before continuing.');
  await put(path,rows[0].raw);
  for(const row of rows)await unlink(row.file);
  await syncDir(dirname(path));return rows[0].value;
}
export async function openDesk(path,{create=false}={}){
  absolute(path);if(!await exists(path)){need(create,'DESK_MISSING','The report desk does not exist.',404);await directory(path,{create:true});}
  await directory(path);const marker=join(path,'desk.json');
  if(!await exists(marker)){
    need(create,'DESK_MISSING','The original report desk marker is unavailable.',404);
    const recovered=await recoverPendingJSON(marker,value=>value.schema===SCHEMA&&typeof value.id==='string'&&typeof value.createdAt==='string');
    if(!recovered){
      const entries=await readdir(path);
      need(entries.length===0,'DESK_OCCUPIED','Create a report desk in a new empty directory.');
      await put(marker,{schema:SCHEMA,id:randomUUID(),createdAt:now()});
    }
  }
  const meta=(await readJSON(marker)).value;
  need(meta.schema===SCHEMA&&typeof meta.id==='string','DESK_IDENTITY','This directory is not the original report desk.');
  await directory(join(path,'operations'),{create:true});return {directory:path,meta};
}
export async function begin(desk,operationId,action,actor,input){
  ident(operationId);text(actor,'recording operator',300);text(action,'action',80);
  const root=join(desk.directory,'operations',sha(operationId));await directory(root,{create:true});
  const body={operationId,action,actor,input},bodySha256=sha(canonical(body)),path=join(root,'request.json');
  let request;
  if(await exists(path)){request=(await readJSON(path)).value;need(request.bodySha256===bodySha256&&canonical(request.body)===canonical(body),'OPERATION_CONFLICT','Continue this operation with its exact original fields.');}
  else{
    const recovered=await recoverPendingJSON(path,value=>value.schema===SCHEMA+'.operation'&&value.deskId===desk.meta.id&&
      value.bodySha256===bodySha256&&canonical(value.body)===canonical(body));
    need(recovered||(await readdir(root)).length===0,'OPERATION_OCCUPIED','The operation directory lacks its original request publication.');
    const made=recovered??{schema:SCHEMA+'.operation',deskId:desk.meta.id,body,bodySha256,createdAt:now()};
    try{await put(path,made);request=made;}catch(e){if(e.code!=='RETAINED_FILE_CONFLICT')throw e;request=(await readJSON(path)).value;need(request.bodySha256===bodySha256&&canonical(request.body)===canonical(body),'OPERATION_CONFLICT','The operation ID belongs to different original fields.');}
  }
  need(request.deskId===desk.meta.id&&sha(canonical(request.body))===request.bodySha256,'OPERATION_IDENTITY','The retained operation identity differs.');
  return {root,request};
}
export async function operation(desk,id){
  ident(id);const root=join(desk.directory,'operations',sha(id));const request=(await readJSON(join(root,'request.json'))).value;
  need(request.deskId===desk.meta.id&&request.body.operationId===id&&sha(canonical(request.body))===request.bodySha256,'OPERATION_IDENTITY','The original operation binding differs.');
  const result=await exists(join(root,'result.json'))?(await readJSON(join(root,'result.json'))).value:null;
  const phases=[];
  for(const name of await readdir(root))if(name.endsWith('.phase.json'))phases.push((await readJSON(join(root,name))).value);
  return {root,request,result,phases};
}
export async function phase(op,name,build){
  need(/^[a-z][a-z0-9-]{0,70}$/.test(name),'PHASE_IDENTITY','Use the original named phase.');
  const path=join(op.root,name+'.phase.json');
  if(await exists(path)){const old=(await readJSON(path)).value;need(old.operationSha256===op.request.bodySha256&&old.name===name,'PHASE_IDENTITY','The phase belongs to another original operation.');return old;}
  const value={schema:SCHEMA+'.phase',name,operationSha256:op.request.bodySha256,value:await build()};
  try{await put(path,value);}catch(e){if(e.code!=='RETAINED_FILE_CONFLICT')throw e;return phase(op,name,build);}
  return value;
}
export async function finish(op,result){
  const value={schema:SCHEMA+'.result',operationId:op.request.body.operationId,operationSha256:op.request.bodySha256,completedAt:now(),result};
  const path=join(op.root,'result.json');
  if(await exists(path)){const old=(await readJSON(path)).value;need(old.operationSha256===value.operationSha256,'RESULT_IDENTITY','The completion belongs to another original request.');return old;}
  await put(path,value);return value;
}
export async function inventory(root){
  const rows=[];
  async function walk(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      if(entry.name.startsWith('.pending-')||entry.name.endsWith('.lock'))continue;
      const name=prefix+entry.name,path=join(dir,entry.name);
      need(!entry.isSymbolicLink(),'LINKED_MEMBER','A retained desk member is linked.');
      if(entry.isDirectory())await walk(path,name+'/');
      else{need(entry.isFile(),'SPECIAL_MEMBER','A retained desk member is not a regular file.');const raw=await read(path,256*1024*1024);rows.push({path:name,...identity(raw)});}
    }
  }
  await walk(root);return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function child(executable,args,{input,signal,limit=MAX_JSON,env={},timeoutMs=120000}={}){
  need(!signal?.aborted,'CANCELLED','The original operation was interrupted.');
  return new Promise((done,reject)=>{
    const c=spawn(executable,args,{shell:false,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    const out=[],err=[];let outBytes=0,errBytes=0,problem;
    const stop=()=>{problem??=fail('CHILD_INTERRUPTED','The original child was interrupted; reopen this same operation.');c.kill('SIGTERM');};
    const timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
    c.stdout.on('data',b=>{outBytes+=b.length;if(outBytes>limit){problem??=fail('CHILD_OUTPUT_BOUND','The original reader exceeded its output bound.',413);c.kill('SIGTERM');}else out.push(b);});
    c.stderr.on('data',b=>{if(errBytes<1048576){err.push(b);errBytes+=b.length;}});
    c.once('error',e=>{problem=e;});
    c.once('close',(code,sig)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(problem)return reject(problem);
      const stdout=Buffer.concat(out),stderr=Buffer.concat(err).toString('utf8');
      if(code!==0)return reject(fail('ORIGINAL_CHILD_FAILED','The original child did not complete.',409,{code,signal:sig,stdout:stdout.toString('utf8').slice(0,10000),stderr:stderr.slice(-10000)}));
      done(stdout);
    });
    c.stdin.on('error',()=>{});c.stdin.end(input??'');
  });
}
export const defaultApplication=resolve(fileURLToPath(new URL('../groundwater/',import.meta.url)));
export async function core(action,payload,{application=defaultApplication,python='python3',signal}={}){
  absolute(application,'installed application directory');
  const raw=await child(python,['-B',fileURLToPath(new URL('./bridge.py',import.meta.url)),'--application',application],
    {input:json({action,payload}),signal,env:{PYTHONDONTWRITEBYTECODE:'1'}});
  let result;try{result=JSON.parse(raw);}catch{throw fail('CORE_RESULT','The original groundwater reader returned incomplete JSON.',503);}
  if(result.error)throw fail(result.error.code??'CORE_REJECTED',result.error.message??'The original groundwater reader rejected this operation.',result.error.status??409,result.error);
  return result;
}

export async function ownedOperation(desk,id,action,actor,input,run){
  const lease=await acquireStateLease(desk.directory);
  try{lease.assertHeld();const op=await begin(desk,id,action,actor,input);return await run(op,lease);}finally{await lease.close();}
}
