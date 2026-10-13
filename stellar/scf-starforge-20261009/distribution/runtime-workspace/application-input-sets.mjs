// MIT. Whole companion sets reuse original uploads and the existing Runtime workspace.
import {constants} from 'node:fs';
import {open,readdir,link,unlink,lstat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {initializationDirectory,retainInitializationRecord,syncInitializationDirectory} from '../../sf88-operator-buyer-cli/initialization.mjs';
import {need,plain,operationId,readJSON,json,withWorkspaceWrite,operationLease,absolute} from './storage.mjs';
import {applicationProviderForKind} from './application-providers.mjs';
import {inputManifestJson} from '../../sf88-operator-buyer-cli/collection-composer/input-format.mjs';
import {APPLICATION_INPUT_SET_LIMITS as LIMITS,normalizeApplicationInputSet,applicationInputSetJSON,
  applicationInputSetPath,applicationInputSetUploadManifest} from './public/application-input-set-format.mjs';
export {APPLICATION_INPUT_SET_SCHEMA,APPLICATION_INPUT_SET_LIMITS,normalizeApplicationInputSet} from './public/application-input-set-format.mjs';
const HASH=/^[a-f0-9]{64}$/, SCHEMA='stellar-forge.runtime-application-input-set-selection.v1';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fields=(v,keys)=>need(plain(v)&&Object.keys(v).every(k=>keys.includes(k)),'APPLICATION_INPUT_SET_ARGUMENTS_INVALID');
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function inspectFile(path,expected=null) {
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await fd.stat();
    need(before.isFile()&&!(before.mode&0o077)&&(typeof process.getuid!=='function'||before.uid===process.getuid()),
      'APPLICATION_INPUT_SET_PRIVATE_FILE_REQUIRED');
    const digest=createHash('sha256'),buffer=Buffer.alloc(LIMITS.chunkBytes);let count=0;
    while(count<before.size) {
      const got=await fd.read(buffer,0,Math.min(buffer.length,before.size-count),count);
      need(got.bytesRead>0,'APPLICATION_INPUT_SET_FILE_CHANGED');digest.update(buffer.subarray(0,got.bytesRead));count+=got.bytesRead;
    }
    need(sameStat(before,await fd.stat()),'APPLICATION_INPUT_SET_FILE_CHANGED');
    const result={bytes:count,sha256:digest.digest('hex')};
    if(expected)need(result.bytes===expected.bytes&&result.sha256===expected.sha256,'APPLICATION_INPUT_SET_PREFIX_CHANGED');
    return result;
  } finally {await fd.close();}
}
async function ensureTree(root,directories) {
  await initializationDirectory(root,{create:true});
  for(const relative of directories)await initializationDirectory(join(root,relative),{create:true});
}
async function copyOriginal(inputs,uploadId,file,destination,temporaryRoot) {
  const source=await inputs.applicationInputDownload({uploadId});
  const temporary=join(temporaryRoot,'.input-copy-'+randomUUID());let handle;
  try {
    need(source.bytes===file.bytes&&source.sha256===file.sha256,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
    handle=await open(temporary,'wx',0o600);
    const digest=createHash('sha256');let bytes=0;
    for await(const chunk of source.stream) {
      bytes+=chunk.length;need(bytes<=file.bytes,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
      digest.update(chunk);await handle.writeFile(chunk);
    }
    need(bytes===file.bytes&&digest.digest('hex')===file.sha256,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
    await handle.sync();await handle.close();handle=null;
    try {await link(temporary,destination);}
    catch(error){if(error.code!=='EEXIST')throw error;await inspectFile(destination,file);}
    await syncInitializationDirectory(dirname(destination));
  } finally {
    source.stream.destroy();await source.close();if(handle)await handle.close();
    await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
}
async function checkCompleteTree(root,manifest,{prefix=false}={}) {
  const expected=new Map([...manifest.directories.map(p=>[p,'directory']),...manifest.files.map(f=>[f.path,'file'])]);
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  async function walk(directory,parent='') {
    try{await initializationDirectory(directory);}
    catch(e){if(prefix&&e.code==='ENOENT')return;throw e;}
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=parent+entry.name,kind=expected.get(path);
      need(kind&&!entry.isSymbolicLink(),'APPLICATION_INPUT_SET_PREFIX_CHANGED');
      if(kind==='directory'){need(entry.isDirectory(),'APPLICATION_INPUT_SET_PREFIX_CHANGED');await walk(join(directory,entry.name),path+'/');}
      else {need(entry.isFile(),'APPLICATION_INPUT_SET_PREFIX_CHANGED');await inspectFile(join(directory,entry.name),files.get(path));}
    }
  }
  await walk(root);
  if(!prefix) {
    for(const directory of manifest.directories)await initializationDirectory(join(root,directory));
    for(const file of manifest.files)await inspectFile(join(root,file.path),file);
  }
}
export function createApplicationInputSetsAPI(root,workspaceId,inputs) {
  const directory=join(root,'application-input-sets'),sets=join(directory,'originals'),working=join(directory,'working');
  async function live() {
    const w=await readJSON(join(root,'workspace.json'));
    need(w.workspaceId===workspaceId&&w.directory===root,'RUNTIME_WORKSPACE_IDENTITY_CHANGED',undefined,409);
  }
  async function mutate(fn) {
    return withWorkspaceWrite(root,async()=>{
      await live();await initializationDirectory(directory,{create:true});
      const lease=await operationLease(join(directory,'sets.lock'));
      try{return await fn();}finally{await lease.close();}
    });
  }
  async function optionalDirectory(path) {
    try{await initializationDirectory(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
  }
  async function source(setId) {
    need(HASH.test(setId??''),'APPLICATION_INPUT_SET_ID_INVALID');
    await initializationDirectory(join(sets,setId));
    const value=await readJSON(join(sets,setId,'manifest.json'));
    need(value?.workspaceId===workspaceId&&value.setId===setId&&
      hash(applicationInputSetJSON(value.manifest))===setId,'APPLICATION_INPUT_SET_ORIGINAL_CHANGED');
    return value;
  }
  async function inspect(setId,{requireReady=false}={}) {
    const saved=await source(setId),files=[];
    for(const file of saved.manifest.files) {
      const manifest=applicationInputSetUploadManifest(file),uploadId=hash(inputManifestJson(manifest));
      let state;
      try{state=await inputs.applicationInputInspect({uploadId});}
      catch(e){
        if(e.code!=='COLLECTION_INPUT_NOT_FOUND')throw e;
        state={uploadId,phase:'NOT_STARTED',receivedChunks:[],receivedBytes:0};
      }
      if(state.phase==='READY')need(state.input?.bytes===file.bytes&&state.input?.sha256===file.sha256,
        'APPLICATION_INPUT_SET_ORIGINAL_CHANGED','A completed original differs from this retained set.',409);
      if(requireReady)need(state.phase==='READY','APPLICATION_INPUT_SET_UPLOAD_INCOMPLETE',undefined,409);
      files.push({...file,uploadId:state.uploadId,phase:state.phase,receivedChunks:state.receivedChunks,
        receivedBytes:state.receivedBytes});
    }
    return {...saved,phase:files.every(f=>f.phase==='READY')?'READY':'UPLOADING',files,
      bytes:files.reduce((sum,f)=>sum+f.bytes,0),receivedBytes:files.reduce((sum,f)=>sum+f.receivedBytes,0)};
  }
  async function selection(requestId,{inspectCurrent=false}={}) {
    operationId(requestId);const base=join(working,requestId);
    await initializationDirectory(base);
    const intent=await readJSON(join(base,'selection.json')),completed=await readJSON(join(base,'complete.json'),true);
    need(intent?.schema===SCHEMA&&intent.workspaceId===workspaceId&&intent.requestId===requestId&&
      intent.directory===join(base,'files')&&intent.path===join(intent.directory,intent.memberPath||'')&&
      hash(applicationInputSetJSON(intent.manifest))===intent.setId,'APPLICATION_INPUT_SET_SELECTION_CHANGED');
    if(completed)need(completed.schema===SCHEMA&&completed.requestId===requestId&&completed.selectionSha256===hash(json(intent)),
      'APPLICATION_INPUT_SET_SELECTION_CHANGED');
    let current=null,error=null;
    if(completed&&inspectCurrent) {
      try {
        await initializationDirectory(intent.directory);
        current=[];
        for(const file of intent.manifest.files) {
          try{const value=await inspectFile(join(intent.directory,file.path));current.push({path:file.path,...value,
            changed:value.bytes!==file.bytes||value.sha256!==file.sha256});}
          catch(e){current.push({path:file.path,error:{code:e.code??'APPLICATION_INPUT_SET_UNAVAILABLE',message:e.message}});}
        }
        if(intent.memberPath)await inspectFile(intent.path);else await initializationDirectory(intent.path);
      }catch(e){error={code:e.code??'APPLICATION_INPUT_SET_UNAVAILABLE',message:e.message};}
    }
    return {...intent,phase:completed?'PREPARED':'PREPARING',current,...(error?{error}:{})};
  }
  return {
    async applicationInputSetsState(input={}) {
      fields(input,['query','offset','limit','workingOffset','workingLimit']);await live();
      const query=input.query??'',offset=input.offset??0,limit=input.limit??20,workingOffset=input.workingOffset??0,workingLimit=input.workingLimit??10;
      need(typeof query==='string'&&query.length<=180&&[offset,workingOffset].every(x=>Number.isSafeInteger(x)&&x>=0)&&
        [limit,workingLimit].every(x=>Number.isSafeInteger(x)&&x>=1&&x<=100),'APPLICATION_INPUT_SET_PAGE_INVALID');
      const rows=[];
      if(await optionalDirectory(sets))for(const id of await readdir(sets)) {
        if(!HASH.test(id))continue;const value=await source(id);
        if(value.manifest.name.toLowerCase().includes(query.toLowerCase()))rows.push({
          setId:id,name:value.manifest.name,files:value.manifest.files.length,directories:value.manifest.directories.length,
          bytes:value.manifest.files.reduce((sum,f)=>sum+f.bytes,0),createdAt:value.createdAt});
      }
      rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.setId.localeCompare(b.setId));
      const copies=[];
      if(await optionalDirectory(working))for(const id of await readdir(working)) {
        if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))continue;
        if(await readJSON(join(working,id,'selection.json'),true))copies.push(await selection(id));
      }
      copies.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.requestId.localeCompare(b.requestId));
      return {schema:'stellar-forge.runtime-application-input-sets.v1',workspaceId,limits:LIMITS,
        sets:{items:rows.slice(offset,offset+limit),total:rows.length,offset,limit},
        working:{items:copies.slice(workingOffset,workingOffset+workingLimit),total:copies.length,offset:workingOffset,limit:workingLimit}};
    },
    async applicationInputSetBegin(input) {
      fields(input,['manifest']);const manifest=normalizeApplicationInputSet(input.manifest),setId=hash(applicationInputSetJSON(manifest));
      return mutate(async()=>{
        await initializationDirectory(sets,{create:true});await initializationDirectory(join(sets,setId),{create:true});
        await retainInitializationRecord(join(sets,setId,'manifest.json'),
          {workspaceId,setId,manifest,createdAt:new Date().toISOString()},{resume:true,ignore:['createdAt']});
        for(const file of manifest.files)await inputs.applicationInputBegin({manifest:applicationInputSetUploadManifest(file)});
        return inspect(setId);
      });
    },
    async applicationInputSetInspect(input) {
      fields(input,['setId']);await live();return inspect(input.setId);
    },
    async applicationInputSetComplete(input) {
      fields(input,['setId']);return mutate(async()=>{
        const value=await inspect(input.setId,{requireReady:true});
        await retainInitializationRecord(join(sets,input.setId,'complete.json'),{workspaceId,setId:input.setId,
          files:value.files.map(f=>({path:f.path,uploadId:f.uploadId,bytes:f.bytes,sha256:f.sha256}))},{resume:true});
        return value;
      });
    },
    async applicationInputSetSelection(input) {
      fields(input,['requestId']);await live();return selection(input.requestId,{inspectCurrent:true});
    },
    async applicationInputSetPrepare(input) {
      fields(input,['requestId','setId','kind','field','memberPath']);operationId(input.requestId);
      need(typeof input.kind==='string'&&typeof input.field==='string','APPLICATION_INPUT_SETTING_REQUIRED');
      const memberPath=input.memberPath??'';if(memberPath)applicationInputSetPath(memberPath);
      return mutate(async()=>{
        await initializationDirectory(working,{create:true});
        const base=join(working,input.requestId);await initializationDirectory(base,{create:true});
        const previous=await readJSON(join(base,'selection.json'),true);
        if(previous) {
          need(previous.setId===input.setId&&previous.kind===input.kind&&previous.field===input.field&&previous.memberPath===memberPath,
            'APPLICATION_INPUT_SET_REQUEST_REUSED',undefined,409);
          const value=await selection(input.requestId,{inspectCurrent:true});
          if(value.phase==='PREPARED')return value;
        } else {
          const {entry}=await applicationProviderForKind(input.kind);
          need(entry.fields?.some(f=>f.name===input.field&&f.type==='path'),'APPLICATION_INPUT_SETTING_REQUIRED');
        }
        const original=await inspect(input.setId,{requireReady:true});
        need(!memberPath||original.manifest.files.some(f=>f.path===memberPath),'APPLICATION_INPUT_SET_MEMBER_NOT_FOUND');
        const copyRoot=join(base,'files');
        const intent=await retainInitializationRecord(join(base,'selection.json'),
          {schema:SCHEMA,workspaceId,requestId:input.requestId,setId:input.setId,kind:input.kind,field:input.field,
            memberPath,directory:copyRoot,path:join(copyRoot,memberPath),manifest:original.manifest,
            createdAt:new Date().toISOString()},{resume:true,ignore:['createdAt']});
        await checkCompleteTree(copyRoot,original.manifest,{prefix:true});
        await ensureTree(copyRoot,original.manifest.directories);
        for(const file of original.files)await copyOriginal(inputs,file.uploadId,file,join(copyRoot,file.path),base);
        await checkCompleteTree(copyRoot,original.manifest);
        await retainInitializationRecord(join(base,'complete.json'),
          {schema:SCHEMA,requestId:input.requestId,selectionSha256:hash(json(intent))},{resume:true});
        return selection(input.requestId,{inspectCurrent:true});
      });
    },
    async applicationInputSetExport(input) {
      fields(input,['setId','directory']);const output=absolute(input.directory);
      return mutate(async()=>{
        const original=await inspect(input.setId,{requireReady:true});
        await initializationDirectory(output,{create:true});
        const manifestPath=join(output,'input-set.json'),prior=await readJSON(manifestPath,true);
        if(!prior)need((await readdir(output)).length===0,'APPLICATION_INPUT_SET_EXPORT_NOT_EMPTY');
        const intent=await retainInitializationRecord(manifestPath,
          {schema:'stellar-forge.runtime-application-input-set-export.v1',workspaceId,setId:input.setId,manifest:original.manifest},
          {resume:true});
        const target=join(output,'originals');await checkCompleteTree(target,original.manifest,{prefix:true});
        await ensureTree(target,original.manifest.directories);
        for(const file of original.files)await copyOriginal(inputs,file.uploadId,file,join(target,file.path),output);
        await checkCompleteTree(target,original.manifest);
        await retainInitializationRecord(join(output,'complete.json'),{setId:input.setId,manifestSha256:hash(json(intent))},{resume:true});
        return {directory:output,originalsDirectory:target,setId:input.setId,manifest:original.manifest};
      });
    },
  };
}
