// MIT. Immutable operation-policy editions in the original private merchant workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, link, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { privateParent } from './model.mjs';
import { operationLease } from '../../distribution/runtime-workspace/storage.mjs';
import { POLICY_ID, OPERATION_POLICY_BYTES, normalizeOperationPolicy, operationPolicyText, operationPolicyCanonical } from './operation-policy-model.mjs';

const DIRECTORY='.sf61-operation-policies';
const EDITION_SCHEMA='stellar-forge.api-operation-policy-edition.v1';
const HEAD_SCHEMA='stellar-forge.api-operation-policy-head.v1';
const EDITION_BYTES=OPERATION_POLICY_BYTES+65536;
const SHA=/^[a-f0-9]{64}$/;
const utf8=new TextDecoder('utf-8',{fatal:true});
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const same=(a,b)=>operationPolicyCanonical(a)===operationPolicyCanonical(b);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code,message,status=400,details){throw Object.assign(new Error(message),{code,status,...(details?{details}:{})});}
function need(value,code,message,status=400){if(!value)fail(code,message,status);}
function exact(value,fields,required,label){
  need(plain(value)&&Object.keys(value).every(key=>fields.includes(key))&&required.every(key=>own(value,key)),
    'OPENAPI_OPERATION_POLICY_INVALID','Use the complete declared '+label+' fields.');
}
function idOf(value){
  need(typeof value==='string'&&POLICY_ID.test(value),'OPENAPI_OPERATION_POLICY_INVALID','Choose a valid operation-policy ID.');
  return value;
}
function hashOf(value,label='edition SHA'){
  need(typeof value==='string'&&SHA.test(value),'OPENAPI_OPERATION_POLICY_INVALID','Choose a complete lowercase '+label+'.');return value;
}
function paging(offset=0,limit=50){
  need(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,
    'OPENAPI_OPERATION_POLICY_INVALID','Use an offset of zero or greater and a page size from 1 to 100.');
  return{offset,limit};
}
function json(value){return Buffer.from(JSON.stringify(value)+'\n','utf8');}
async function privateDirectory(path,optional=false){
  let info;try{info=await lstat(path);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
    (process.getuid===undefined||info.uid===process.getuid())&&await realpath(path)===path,
    'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','Keep the policy library in real private directories owned by this operator.',500);
  return info;
}
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}
}
async function ensureDirectory(path){
  if(await privateDirectory(path,true))return;
  await privateDirectory(dirname(path));
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateDirectory(path);await syncDirectory(dirname(path));
}
async function regular(path,maximum,optional=false){
  let handle;
  try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{
    const first=await handle.stat();
    need(first.isFile()&&!first.isSymbolicLink()&&!(first.mode&0o077)&&first.size<=maximum&&
      (process.getuid===undefined||first.uid===process.getuid()),
      'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','A policy record must be a private regular file within its byte limit.',500);
    const bytes=await handle.readFile(),last=await handle.stat();
    need(bytes.length===first.size&&bytes.length<=maximum&&last.size===first.size&&last.mtimeMs===first.mtimeMs&&last.ctimeMs===first.ctimeMs,
      'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The retained policy record changed while it was being read.',500);
    return bytes;
  }finally{await handle.close();}
}
async function readJSON(path,maximum,optional=false){
  const bytes=await regular(path,maximum,optional);if(bytes===null)return null;
  try{return JSON.parse(utf8.decode(bytes));}
  catch{fail('OPENAPI_OPERATION_POLICY_STORAGE_INVALID','A retained policy record is not complete UTF-8 JSON.',500);}
}
async function removeOwnTemporary(path,identity){
  if(!identity)return;
  let current;try{current=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  need(current.isFile()&&!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino,
    'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The owned policy publication temporary changed.',500);
  await unlink(path);
}
async function publish(path,bytes,{replace=false,maximum=EDITION_BYTES}={}){
  need(Buffer.isBuffer(bytes)&&bytes.length<=maximum,'OPENAPI_OPERATION_POLICY_INVALID','The complete policy record exceeds its byte limit.');
  await privateDirectory(dirname(path));
  const temporary=join(dirname(path),'.'+basename(path)+'.pending-'+randomUUID());
  let handle,identity;
  try{
    handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    identity=await handle.stat();await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    if(replace){await rename(temporary,path);identity=null;}
    else{
      try{await link(temporary,path);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const existing=await regular(path,maximum);
        need(existing.equals(bytes),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','An immutable policy publication already contains different bytes.',500);
      }
      await removeOwnTemporary(temporary,identity);identity=null;
    }
    await syncDirectory(dirname(path));
    const readback=await regular(path,maximum);
    need(readback.equals(bytes),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The policy publication readback differs from the complete original bytes.',500);
  }finally{
    if(handle)await handle.close();
    if(identity)await removeOwnTemporary(temporary,identity);
  }
}
function normalizedPolicy(value){
  const policy=normalizeOperationPolicy(value),text=operationPolicyText(policy),bytes=Buffer.from(text,'utf8');
  need(bytes.length<=OPERATION_POLICY_BYTES,'OPENAPI_OPERATION_POLICY_INVALID','The complete canonical policy file exceeds '+OPERATION_POLICY_BYTES+' bytes.');
  return{policy,text,bytes,sha256:digest(bytes)};
}
function edition(value,id,sha256){
  exact(value,['schema','id','sha256','previousSha256','createdAt','policy'],
    ['schema','id','sha256','previousSha256','createdAt','policy'],'retained policy edition');
  need(value.schema===EDITION_SCHEMA&&value.id===id&&value.sha256===sha256&&SHA.test(sha256)&&
    (value.previousSha256===null||typeof value.previousSha256==='string'&&SHA.test(value.previousSha256)&&value.previousSha256!==sha256)&&
    typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&new Date(value.createdAt).toISOString()===value.createdAt,
    'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The retained policy edition identity is invalid.',500);
  const normalized=normalizedPolicy(value.policy);
  need(normalized.policy.id===id&&normalized.sha256===sha256&&same(normalized.policy,value.policy),
    'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The retained policy document differs from its immutable edition hash.',500);
  return value;
}
function metadata(value){
  return{id:value.id,title:value.policy.title,sha256:value.sha256,previousSha256:value.previousSha256,createdAt:value.createdAt,
    methods:[...value.policy.methods],fields:Object.keys(value.policy.settings).sort()};
}

/** Opening or reading the library creates no directories, records or leases. */
export async function openOperationPolicyStore({parent}){
  const selected=await privateParent(parent);await privateDirectory(selected);
  const library=join(selected,DIRECTORY);
  const paths=id=>({folder:join(library,id),editions:join(library,id,'editions'),head:join(library,id,'head.json'),
    pending:join(library,id,'pending.json'),lease:join(library,id,'write.lock')});
  async function existingPaths(id){
    if(!await privateDirectory(library,true))return null;
    const value=paths(id);if(!await privateDirectory(value.folder,true))return null;
    return value;
  }
  async function readEdition(value,id,sha256,optional=false){
    hashOf(sha256);
    if(!await privateDirectory(value.editions,true)){
      if(optional)return null;
      fail('OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The policy edition directory is missing.',500);
    }
    let stored;
    try{stored=await readJSON(join(value.editions,sha256+'.json'),EDITION_BYTES,optional);}
    catch(error){if(error.code==='ENOENT')fail('OPENAPI_OPERATION_POLICY_STORAGE_INVALID','A saved policy history member is missing.',500);throw error;}
    if(stored===null)return null;return edition(stored,id,sha256);
  }
  async function head(value,id){
    const stored=await readJSON(value.head,4096,true);if(stored===null)return null;
    exact(stored,['schema','id','sha256'],['schema','id','sha256'],'policy head');
    need(stored.schema===HEAD_SCHEMA&&stored.id===id&&typeof stored.sha256==='string'&&SHA.test(stored.sha256),
      'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The current policy head is invalid.',500);
    return readEdition(value,id,stored.sha256);
  }
  async function history(value,id,current,{offset=0,limit=25,select}={}){
    const page=paging(offset,limit),items=[],seen=new Set();let entry=current,index=0,found=null;
    while(entry){
      need(!seen.has(entry.sha256),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The retained policy history contains a cycle.',500);seen.add(entry.sha256);
      if(entry.sha256===select)found=entry;
      if(index>=page.offset&&items.length<page.limit)items.push(metadata(entry));index++;
      entry=entry.previousSha256?await readEdition(value,id,entry.previousSha256):null;
    }
    return{found,history:{items,total:index,offset:page.offset,limit:page.limit,nextOffset:page.offset+items.length<index?page.offset+items.length:null}};
  }
  async function view(value,id,current,sha256,historyOffset=0,historyLimit=25){
    const selectedSha=sha256??current.sha256,{found,history:editions}=await history(value,id,current,{offset:historyOffset,limit:historyLimit,select:selectedSha});
    if(!found)fail('OPENAPI_OPERATION_POLICY_NOT_FOUND','This edition is not in the saved policy history.',404);
    return{policy:structuredClone(found.policy),sha256:found.sha256,headSha256:current.sha256,
      previousSha256:found.previousSha256,createdAt:found.createdAt,history:editions};
  }
  async function list({offset=0,limit=50}={}){
    const page=paging(offset,limit);
    if(!await privateDirectory(library,true))return{policies:[],total:0,...page,nextOffset:null};
    const names=(await readdir(library,{withFileTypes:true})).filter(entry=>POLICY_ID.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
    const policies=[];let total=0;
    for(const entry of names){
      need(entry.isDirectory()&&!entry.isSymbolicLink(),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','A policy ID is not a private directory.',500);
      const value=await existingPaths(entry.name);if(!value)continue;
      const current=await head(value,entry.name);if(!current)continue;
      if(total>=page.offset&&policies.length<page.limit)policies.push(metadata(current));total++;
    }
    return{policies,total,...page,nextOffset:page.offset+policies.length<total?page.offset+policies.length:null};
  }
  async function load({id,sha256,historyOffset=0,historyLimit=25}){
    id=idOf(id);if(sha256!==undefined)hashOf(sha256);paging(historyOffset,historyLimit);
    const value=await existingPaths(id),current=value?await head(value,id):null;
    if(!current)fail('OPENAPI_OPERATION_POLICY_NOT_FOUND','The named operation policy has not been saved.',404);
    return view(value,id,current,sha256,historyOffset,historyLimit);
  }
  async function exportPolicy({id,sha256}){
    const loaded=await load({id,sha256,historyOffset:0,historyLimit:1}),normalized=normalizedPolicy(loaded.policy);
    need(normalized.sha256===loaded.sha256,'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The exported policy bytes differ from their saved edition.',500);
    const {history:_history,...record}=loaded;
    return{...record,file:{filename:loaded.policy.id+'-'+loaded.sha256+'.json',bytes:normalized.bytes.length,
      sha256:normalized.sha256,text:normalized.text}};
  }
  async function publishHead(value,id,entry,expectedSha){
    const current=await head(value,id);
    need((current?.sha256??null)===expectedSha,'OPENAPI_OPERATION_POLICY_HEAD_CHANGED','The saved policy head changed. Load its current edition before saving.',409);
    await publish(value.head,json({schema:HEAD_SCHEMA,id,sha256:entry.sha256}),{replace:current!==null,maximum:4096});
    const verified=await head(value,id);
    need(verified?.sha256===entry.sha256,'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The published policy head failed its exact readback.',500);
  }
  async function removePending(value,pending){
    const bytes=await regular(value.pending,EDITION_BYTES);
    need(bytes.equals(json(pending)),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The pending policy edition changed.',500);
    await unlink(value.pending);await syncDirectory(value.folder);
  }
  async function recover(value,id){
    const pending=await readJSON(value.pending,EDITION_BYTES,true);
    let current=await head(value,id);if(pending===null)return current;
    const entry=edition(pending,id,pending.sha256);
    if(current?.sha256===entry.sha256){
      const saved=await readEdition(value,id,entry.sha256);
      need(same(saved,entry),'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','Pending metadata differs from its saved edition.',500);
      await removePending(value,pending);return current;
    }
    need((current?.sha256??null)===entry.previousSha256,'OPENAPI_OPERATION_POLICY_STORAGE_INVALID',
      'The pending policy edition does not follow the current saved head.',500);
    await publish(join(value.editions,entry.sha256+'.json'),json(entry));
    await publishHead(value,id,entry,entry.previousSha256);await removePending(value,pending);
    return head(value,id);
  }
  async function save(input){
    exact(input,['policy','expectedHeadSha256'],['policy','expectedHeadSha256'],'policy save request');
    const normalized=normalizedPolicy(input.policy),id=idOf(normalized.policy.id),expected=input.expectedHeadSha256;
    if(expected!==null)hashOf(expected,'expected head SHA');
    await ensureDirectory(library);const value=paths(id);await ensureDirectory(value.folder);
    let lease,attempted=false;
    try{
      try{lease=await operationLease(value.lease);}
      catch(error){
        if(error.code==='RUNTIME_WORKSPACE_OPERATION_RUNNING')fail('OPENAPI_OPERATION_POLICY_STORE_BUSY','Another writer is saving this policy. Reopen the same edition and retry its original change.',409);
        throw error;
      }
      await privateDirectory(value.folder);await ensureDirectory(value.editions);
      let current=await recover(value,id);
      if(current?.sha256===normalized.sha256){
        need(expected===current.sha256||expected===current.previousSha256,'OPENAPI_OPERATION_POLICY_HEAD_CHANGED',
          'The expected head does not match this current policy or its original save. Reopen the current edition.',409);
        return{...await view(value,id,current,current.sha256),state:'REOPENED'};
      }
      need((current?.sha256??null)===expected,'OPENAPI_OPERATION_POLICY_HEAD_CHANGED',
        'The saved policy head changed. Compare with its current edition before saving this draft.',409);
      let record=await readEdition(value,id,normalized.sha256,true);
      if(record){
        const committed=current?await history(value,id,current,{select:record.sha256,limit:1}):{found:null};
        if(committed.found)fail('OPENAPI_OPERATION_POLICY_HISTORICAL_EDITION',
          'This document is already a historical edition. Open and apply that exact edition, or save a distinct edited document.',409);
        need(record.previousSha256===expected&&same(record.policy,normalized.policy),
          'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The unpublished edition belongs to a different original policy change.',500);
      }else record={schema:EDITION_SCHEMA,id,sha256:normalized.sha256,previousSha256:expected,createdAt:new Date().toISOString(),policy:normalized.policy};
      attempted=true;
      await publish(value.pending,json(record));
      current=await recover(value,id);
      need(current?.sha256===normalized.sha256,'OPENAPI_OPERATION_POLICY_STORAGE_INVALID','The recovered policy head differs from the requested edition.',500);
      return{...await view(value,id,current,current.sha256),state:'SAVED'};
    }catch(error){if(attempted&&error.status!==409)error.outcomeUnknown=true;throw error;}
    finally{if(lease)await lease.close();}
  }
  return Object.freeze({list,load,save,exportPolicy});
}
