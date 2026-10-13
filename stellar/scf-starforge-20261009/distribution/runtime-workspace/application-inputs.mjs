// MIT. Runtime file intake reuses the original resumable Collection input engine.
import { constants } from 'node:fs';
import { open, readdir, link, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openCollectionInputLibrary } from '../../sf88-operator-buyer-cli/collection-composer/input-library.mjs';
import { INPUT_UPLOAD_SCHEMA, INPUT_CHUNK_BYTES, INPUT_LIMITS, validateInputManifest }
  from '../../sf88-operator-buyer-cli/collection-composer/input-format.mjs';
import { initializationDirectory, retainInitializationRecord, syncInitializationDirectory }
  from '../../sf88-operator-buyer-cli/initialization.mjs';
import { need, plain, operationId, operationLease, readJSON, canonical, json,
  withWorkspaceWrite } from './storage.mjs';
import { applicationProviderForKind } from './application-providers.mjs';

export const APPLICATION_INPUT_MAX_BYTES = INPUT_LIMITS.body;
export const APPLICATION_INPUT_CHUNK_BYTES = INPUT_CHUNK_BYTES;
const SCHEMA = 'stellar-forge.runtime-application-input-selection.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
  a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs;
const safeName = value => {
  const name=basename(value).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,150);
  return name && !['.','..'].includes(name) ? name : 'input.bin';
};
const fields = (value,allowed) => need(plain(value) && Object.keys(value).every(k=>allowed.includes(k)),
  'APPLICATION_INPUT_ARGUMENTS_INVALID');
async function fileIdentity(handle) {
  const before=await handle.stat();
  need(before.isFile(),'APPLICATION_INPUT_REGULAR_FILE_REQUIRED');
  const buffer=Buffer.alloc(INPUT_CHUNK_BYTES), digest=createHash('sha256'); let offset=0;
  while(offset<before.size) {
    const part=await handle.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);
    need(part.bytesRead>0,'APPLICATION_INPUT_FILE_CHANGED',undefined,409);
    digest.update(buffer.subarray(0,part.bytesRead)); offset+=part.bytesRead;
  }
  need(same(before,await handle.stat()),'APPLICATION_INPUT_FILE_CHANGED',undefined,409);
  return {bytes:offset,sha256:digest.digest('hex'),info:before};
}
async function openVerified(path,expected=null) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const value=await fileIdentity(handle);
    need((value.info.mode&0o077)===0 && (typeof process.getuid!=='function'||value.info.uid===process.getuid()),
      'APPLICATION_INPUT_PRIVATE_FILE_REQUIRED');
    if(expected) need(value.bytes===expected.bytes && value.sha256===expected.sha256,
      'APPLICATION_INPUT_ORIGINAL_CHANGED',undefined,409);
    return {handle,...value};
  } catch(error) { await handle.close(); throw error; }
}
export function createApplicationInputsAPI(root,workspaceId) {
  const directory=join(root,'application-inputs'), copies=join(directory,'working');
  async function live() {
    const config=await readJSON(join(root,'workspace.json'));
    need(config.workspaceId===workspaceId && config.directory===root,
      'RUNTIME_WORKSPACE_IDENTITY_CHANGED','Reopen the original Runtime workspace.',409);
  }
  async function exists(path) {
    try { await initializationDirectory(path); return true; }
    catch(error) { if(error.code==='ENOENT')return false; throw error; }
  }
  async function mutate(callback) {
    return withWorkspaceWrite(root,async()=>{
      await live();
      await initializationDirectory(directory,{create:true});
      const lease=await operationLease(join(directory,'input-library.lock'));
      try { return await callback(); } finally { await lease.close(); }
    });
  }
  // The wrapper's every public entry verifies the original workspace. The
  // unchanged engine keeps its own immutable upload and chunk identities.
  const library=openCollectionInputLibrary({directory,mutate,live:()=>{},
    inspectCatalog:async()=>{throw new Error('APPLICATION_INPUT_BODY_REQUIRED');}});
  async function selection(requestId) {
    operationId(requestId);
    const base=join(copies,requestId);
    if(!await exists(base))return null;
    const intent=await readJSON(join(base,'selection.json'),true);
    if(!intent)return null;
    need(intent.schema===SCHEMA && intent.workspaceId===workspaceId && intent.requestId===requestId &&
      intent.path===join(base,safeName(intent.original.name)),
      'APPLICATION_INPUT_SELECTION_CHANGED');
    const completed=await readJSON(join(base,'complete.json'),true);
    if(completed) need(completed.schema===SCHEMA && completed.requestId===requestId &&
      completed.selectionSha256===hash(json(intent)),'APPLICATION_INPUT_SELECTION_CHANGED');
    let current=null,error=null;
    if(completed) {
      try {
        const held=await openVerified(intent.path);
        try { current={bytes:held.bytes,sha256:held.sha256,
          changed:held.sha256!==intent.original.sha256||held.bytes!==intent.original.bytes}; }
        finally { await held.handle.close(); }
      } catch(caught) {error={code:caught.code??'APPLICATION_INPUT_UNAVAILABLE',message:String(caught.message)};}
    }
    return { ...intent,phase:completed?'PREPARED':'PREPARING',current,...(error?{error}:{}) };
  }
  async function workingList({offset=0,limit=30}={}) {
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
      'APPLICATION_INPUT_PAGE_INVALID');
    if(!await exists(copies))return {items:[],total:0,offset,limit};
    const names=(await readdir(copies)).filter(n=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(n));
    const records=[];
    for(const id of names) {
      const raw=await readJSON(join(copies,id,'selection.json'),true);
      if(raw)records.push(raw);
    }
    records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.requestId.localeCompare(b.requestId));
    const items=[];for(const row of records.slice(offset,offset+limit))items.push(await selection(row.requestId));
    return {items,total:records.length,offset,limit};
  }
  const api={
    async applicationInputsState(input={}) {
      fields(input,['query','offset','limit','workingOffset','workingLimit']); await live();
      return {schema:'stellar-forge.runtime-application-inputs.v1',workspaceId,
        files:await library.list({kind:'body',query:input.query??'',offset:input.offset??0,limit:input.limit??30}),
        working:await workingList({offset:input.workingOffset??0,limit:input.workingLimit??30}),
        maximumBytes:INPUT_LIMITS.body,chunkBytes:INPUT_CHUNK_BYTES};
    },
    async applicationInputBegin(input) {
      fields(input,['manifest']); await live();
      const manifest=validateInputManifest(input.manifest);
      need(manifest.kind==='body','APPLICATION_INPUT_BODY_REQUIRED');
      return library.begin({manifest});
    },
    async applicationInputInspect(input) {
      fields(input,['uploadId']); await live(); return library.inspect(input);
    },
    async applicationInputChunk(input) {
      fields(input,['uploadId','index','body']); await live();
      return library.receiveChunk({uploadId:input.uploadId,index:input.index,source:input.body});
    },
    async applicationInputComplete(input) {
      fields(input,['uploadId']); await live(); return library.complete(input);
    },
    async applicationInputSelection(input) {
      fields(input,['requestId']); await live();
      const value=await selection(input.requestId);
      need(value,'APPLICATION_INPUT_SELECTION_NOT_FOUND',undefined,404); return value;
    },
    async applicationInputPrepare(input) {
      fields(input,['requestId','uploadId','kind','field']); operationId(input.requestId);
      need(typeof input.kind==='string' && typeof input.field==='string','APPLICATION_INPUT_SETTING_REQUIRED');
      return mutate(async()=>{
        await initializationDirectory(copies,{create:true});
        const base=join(copies,input.requestId);
        await initializationDirectory(base,{create:true});
        const previous=await readJSON(join(base,'selection.json'),true);
        if(previous) {
          need(previous.uploadId===input.uploadId&&previous.kind===input.kind&&previous.field===input.field&&
            previous.workspaceId===workspaceId,'APPLICATION_INPUT_REQUEST_REUSED',undefined,409);
          const state=await selection(input.requestId);
          if(state.phase==='PREPARED')return state;
        } else {
          const {entry}=await applicationProviderForKind(input.kind);
          need(entry.fields?.some(field=>field.name===input.field&&field.type==='path'),
            'APPLICATION_INPUT_SETTING_REQUIRED','Choose an existing file path setting and retain the normal application review.');
        }
        const original=await library.file({uploadId:input.uploadId});
        const intent=await retainInitializationRecord(join(base,'selection.json'),
          {schema:SCHEMA,workspaceId,requestId:input.requestId,uploadId:input.uploadId,
            kind:input.kind,field:input.field,original:{name:original.name,bytes:original.bytes,sha256:original.sha256},
            path:join(base,safeName(original.name)),createdAt:new Date().toISOString()},
          {resume:true,ignore:['createdAt']});
        // Full intention precedes publication. Work is published once under a
        // separate path; later edits never overwrite the retained upload.
        const held=await openVerified(original.path,original);
        const temporary=join(base,'.copy-'+randomUUID());
        let output;
        try {
          output=await open(temporary,'wx',0o600);
          try {
            const buffer=Buffer.alloc(INPUT_CHUNK_BYTES);let offset=0;
            while(offset<held.bytes) {
              const part=await held.handle.read(buffer,0,Math.min(buffer.length,held.bytes-offset),offset);
              need(part.bytesRead>0,'APPLICATION_INPUT_ORIGINAL_CHANGED');
              await output.writeFile(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;
            }
            need(same(held.info,await held.handle.stat()),'APPLICATION_INPUT_ORIGINAL_CHANGED');
            await output.sync();
          } finally {await output.close();output=null;}
          try {await link(temporary,intent.path);}
          catch(error) {
            if(error.code!=='EEXIST')throw error;
            const prior=await openVerified(intent.path,original);await prior.handle.close();
          }
          await syncInitializationDirectory(base);
          await retainInitializationRecord(join(base,'complete.json'),
            {schema:SCHEMA,requestId:input.requestId,selectionSha256:hash(json(intent))},{resume:true});
          return selection(input.requestId);
        } finally {
          await held.handle.close();
          if(output)await output.close();
          await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
      });
    },
    async applicationInputDownload(input) {
      fields(input,['uploadId']);await live();
      const original=await library.file(input),held=await openVerified(original.path,original);
      return {name:original.name,filename:original.name,bytes:held.bytes,sha256:held.sha256,
        contentType:'application/octet-stream',stream:held.handle.createReadStream({start:0,autoClose:false}),
        close:()=>held.handle.close()};
    },
  };
  return api;
}
/** A local CLI file follows the exact same begin/chunk/complete protocol. */
export async function retainApplicationInputFile(model,{path,name}={}) {
  const source=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await source.stat();
    need(before.isFile()&&before.size<=APPLICATION_INPUT_MAX_BYTES,'APPLICATION_INPUT_SIZE_INVALID');
    const buffer=Buffer.alloc(INPUT_CHUNK_BYTES),chunks=[];let offset=0;
    while(offset<before.size) {
      let length=0,target=Math.min(buffer.length,before.size-offset);
      while(length<target) {
        const row=await source.read(buffer,length,target-length,offset+length);
        need(row.bytesRead>0,'APPLICATION_INPUT_FILE_CHANGED');length+=row.bytesRead;
      }
      chunks.push(hash(buffer.subarray(0,length)));offset+=length;
    }
    need(same(before,await source.stat()),'APPLICATION_INPUT_FILE_CHANGED');
    const manifest={schema:INPUT_UPLOAD_SCHEMA,kind:'body',name:name??basename(path),bytes:before.size,chunkSha256:chunks};
    let result=await model.applicationInputBegin({manifest});
    const received=new Set(result.receivedChunks);
    if(result.phase!=='READY') {
      for(let index=0;index<chunks.length;index++) {
        if(received.has(index))continue;
        let length=0,target=Math.min(buffer.length,before.size-index*INPUT_CHUNK_BYTES);
        while(length<target) {
          const row=await source.read(buffer,length,target-length,index*INPUT_CHUNK_BYTES+length);
          need(row.bytesRead>0,'APPLICATION_INPUT_FILE_CHANGED');length+=row.bytesRead;
        }
        need(hash(buffer.subarray(0,length))===chunks[index],'APPLICATION_INPUT_FILE_CHANGED');
        await model.applicationInputChunk({uploadId:result.uploadId,index,body:buffer.subarray(0,length)});
      }
      need(same(before,await source.stat()),'APPLICATION_INPUT_FILE_CHANGED');
      result=await model.applicationInputComplete({uploadId:result.uploadId});
    }
    return result;
  } finally {await source.close();}
}
