// MIT. Retained files and checkpoints for one original RIS customer operation.
import {open,lstat,mkdir,rename,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {need,privateDirectory,jsonBytes} from '../../node/store.mjs';

export const nativeSha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const nativeJson=value=>jsonBytes(value);
export const nativeSame=(a,b)=>{
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
};
export const nativeStamp=()=>new Date().toISOString();
export function nativePath(root,name){
  need(typeof name==='string'&&name.length>0&&!isAbsolute(name)&&!name.includes('\\')&&!name.includes('\0')&&
    name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'RIS_NATIVE_RELATIVE_FILE_REQUIRED');
  const path=resolve(root,name);need(relative(root,path)!=='..'&&!relative(root,path).startsWith('..'+sep),
    'RIS_NATIVE_FILE_OUTSIDE_OPERATION');return path;
}
export async function nativeRead(path,{maximum=256*1024*1024,optional=false,ordinarySource=false}={}){
  let handle;try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{
    const before=await handle.stat();
    // Ordinary source is allowed only at the caller's exact hash-selected engine/input boundary.
    // Journals, selections, candidates and operation outputs keep the private-file default.
    need(before.isFile()&&(before.nlink===1||(!ordinarySource&&before.nlink===2))&&before.size<=maximum&&
      (ordinarySource?(before.mode&0o022)===0:(before.mode&0o077)===0)&&before.uid===process.getuid(),
      ordinarySource?'RIS_NATIVE_SOURCE_FILE_REQUIRED':'RIS_NATIVE_PRIVATE_FILE_REQUIRED');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&bytes.length===before.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&before.nlink===after.nlink,'RIS_NATIVE_FILE_CHANGED');
    if(before.nlink===2){
      const candidate=await lstat(path+'.write-'+nativeSha(bytes));
      need(candidate.isFile()&&candidate.dev===before.dev&&candidate.ino===before.ino&&candidate.nlink===2&&
        candidate.uid===process.getuid()&&(candidate.mode&0o077)===0,'RIS_NATIVE_PUBLICATION_LINK_CHANGED');
    }
    return bytes;
  }finally{await handle.close();}
}
async function syncParent(path){
  const handle=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}
}
export async function nativeWrite(path,input,{replace=false}={}){
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input),digest=nativeSha(bytes);
  await privateDirectory(dirname(path));
  const old=await nativeRead(path,{optional:true});
  if(old&&old.equals(bytes)){
    const alias=path+'.write-'+digest;let info;try{info=await lstat(alias);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(info){
      const current=await lstat(path);need(info.isFile()&&info.uid===process.getuid()&&(info.mode&0o077)===0&&
        info.dev===current.dev&&info.ino===current.ino&&info.nlink===2,'RIS_NATIVE_PUBLICATION_LINK_CHANGED');
      await unlink(alias);await syncParent(path);
    }
    return;
  }
  need(replace||!old,'RIS_NATIVE_RETAINED_BYTES_CHANGED');
  const candidate=path+'.write-'+digest;let handle;
  try{handle=await open(candidate,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;handle=await open(candidate,constants.O_RDWR|constants.O_NOFOLLOW);}
  try{
    const info=await handle.stat();need(info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&
      (info.mode&0o077)===0&&info.size<=bytes.length,'RIS_NATIVE_WRITE_CANDIDATE_CHANGED');
    const prefix=await handle.readFile();need(bytes.subarray(0,prefix.length).equals(prefix),'RIS_NATIVE_WRITE_PREFIX_CHANGED');
    let offset=prefix.length;while(offset<bytes.length){
      const result=await handle.write(bytes,offset,bytes.length-offset,offset);
      need(result.bytesWritten>0,'RIS_NATIVE_WRITE_STOPPED');offset+=result.bytesWritten;
    }
    await handle.sync();
  }finally{await handle.close();}
  if(replace)await rename(candidate,path);
  else{
    try{await link(candidate,path);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const current=await nativeRead(path);need(current.equals(bytes),'RIS_NATIVE_RETAINED_BYTES_CHANGED');
    }
    await unlink(candidate);
  }
  await syncParent(path);
}
export async function openRisNativeJournal(directory,selection,{secrets=[]}={}){
  need(isAbsolute(directory)&&resolve(directory)===directory,'RIS_NATIVE_ABSOLUTE_DIRECTORY_REQUIRED');
  await privateDirectory(directory);
  const selectionPath=join(directory,'selection.json'),statePath=join(directory,'journal.json');
  await nativeWrite(selectionPath,nativeJson(selection));
  const old=await nativeRead(statePath,{optional:true}),state=old?JSON.parse(old.toString('utf8')):{
    schema:'sf88-research-ris-native-journal-v1',selectionSha256:nativeSha(nativeJson(selection)),
    startedAt:nativeStamp(),stage:'PREPARED',attempts:[],preparedArtifacts:{},artifacts:{},values:{}};
  need(state.schema==='sf88-research-ris-native-journal-v1'&&
    state.selectionSha256===nativeSha(nativeJson(selection)),'RIS_NATIVE_SELECTION_CHANGED');
  const clean=bytes=>{
    for(const secret of secrets)if(secret)need(!bytes.includes(Buffer.from(secret)),'RIS_NATIVE_PRIVATE_SESSION_IN_ARTIFACT');
    return bytes;
  };
  const save=async()=>nativeWrite(statePath,clean(nativeJson(state)),{replace:true});
  const artifactPath=name=>nativePath(directory,name);
  const recover=async name=>{
    const bytes=await nativeRead(artifactPath(name),{optional:true}),selected=state.artifacts[name]??state.preparedArtifacts[name];
    if(!bytes){need(!state.artifacts[name],'RIS_NATIVE_ARTIFACT_MISSING');return null;}
    need(selected&&selected.file===name&&selected.bytes===bytes.length&&selected.sha256===nativeSha(bytes),
      'RIS_NATIVE_ARTIFACT_CHANGED');clean(bytes);await nativeWrite(artifactPath(name),bytes);
    if(!state.artifacts[name]){state.artifacts[name]=selected;await save();}
    return bytes;
  };
  const retain=async(name,input)=>{
    const bytes=clean(Buffer.isBuffer(input)?input:Buffer.from(input)),descriptor={file:name,bytes:bytes.length,sha256:nativeSha(bytes)};
    const old=await recover(name);if(old){need(old.equals(bytes),'RIS_NATIVE_ARTIFACT_CHANGED');return state.artifacts[name];}
    const prior=state.preparedArtifacts[name];
    if(prior&&!nativeSame(prior,descriptor)){
      state.unpublishedArtifacts??=[];state.unpublishedArtifacts.push({...prior,observedAbsentAt:nativeStamp()});
    }
    state.preparedArtifacts[name]=descriptor;await save();await nativeWrite(artifactPath(name),bytes);
    state.artifacts[name]=descriptor;await save();return descriptor;
  };
  const captureFile=async(name,selected,create,validate)=>{
    state.fileSelections??={};
    if(state.fileSelections[name])need(nativeSame(state.fileSelections[name],selected),'RIS_NATIVE_EXPORT_SELECTION_CHANGED');
    else{state.fileSelections[name]=structuredClone(selected);await save();}
    const retained=await recover(name);if(retained)return state.artifacts[name];
    // The original client owns this candidate's transfer and final publication.
    // A completed candidate is validated against the selected engine before reuse.
    const candidate=artifactPath(name)+'.download';
    await privateDirectory(dirname(candidate));
    let bytes=await nativeRead(candidate,{optional:true});
    if(!bytes){await create(candidate);bytes=await nativeRead(candidate);}
    await validate(bytes);const result=await retain(name,bytes);
    await unlink(candidate);await syncParent(candidate);return result;
  };
  const verify=async()=>{
    for(const name of Object.keys(state.artifacts))await recover(name);
    return Object.values(state.artifacts).map(row=>({...row,path:artifactPath(row.file)}));
  };
  const attempt=state.stage==='COMPLETE'?null:{startedAt:nativeStamp(),stage:state.stage};
  if(attempt){state.attempts.push(attempt);await save();}
  return {directory,selection,state,save,retain,recover,captureFile,verify,path:artifactPath,
    async finish(result){
      if(!attempt){need(nativeSame(state.result,result),'RIS_NATIVE_COMPLETED_RESULT_CHANGED');return {...state.result,nativeOutputs:await verify()};}
      state.result=structuredClone(result);state.stage='COMPLETE';attempt.endedAt=nativeStamp();attempt.outcome='COMPLETE';await save();return {...result,nativeOutputs:await verify()};
    },
    async failed(error){if(!attempt)return;attempt.endedAt=nativeStamp();attempt.outcome='INTERRUPTED_OR_FAILED';
      let message=String(error.message??error);for(const secret of secrets)if(secret)message=message.split(secret).join('[session]');
      state.lastError={code:error.code??'RIS_NATIVE_FAILED',message};await save().catch(()=>{});}
  };
}
