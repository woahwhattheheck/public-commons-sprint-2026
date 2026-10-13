// MIT. Independent, replayable receiving through the original native constructors.
import {lstat,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {operationLease} from '../../distribution/runtime-workspace/storage.mjs';
import {jsonIdentity} from '../cfce-givecredit-statements/native-json.mjs';
import {need,same,identity,privateDirectory,readJSON,optionalJSON,writeOnce,hash,fileDigest,MAX_FILE_BYTES} from './files.mjs';

export async function receiveCarbonWorkspace({kind,destination,source,requestId,originWorkspaceId,journalDirectory}){
 const parent=await privateDirectory(destination.parent);
 need(same(identity(await lstat(parent)),destination.identity),'CARBON_DESTINATION_CHANGED','The original receiving parent changed.');
 const key=hash(destination.path),intentPath=join(journalDirectory,key+'.receive.json');
 const lease=await operationLease(join(journalDirectory,key+'.receive-lease'));
 try{
  const intent={schema:'stellar-forge.carbon-agent-receive.v1',kind,destination:destination.path,source:{bytes:source.bytes,sha256:source.sha256},
   requestId,originWorkspaceId};
  const existing=await optionalJSON(intentPath);
  if(existing)need(same(existing,intent),'CARBON_RECEIVE_CHANGED','Continue the original independent receiving operation and complete original handover.');
  else{
   try{await lstat(destination.path);throw Object.assign(new Error('Choose a new private destination; the existing original was preserved.'),{code:'CARBON_DESTINATION_EXISTS'});}
   catch(error){if(error.code!=='ENOENT')throw error;}
   await writeOnce(intentPath,intent);
  }
  // Reservation is durable before directory creation. Only this exact intent may
  // continue the directory after a pre-process or unknown native return.
  try{await mkdir(destination.path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateDirectory(destination.path);
  const bindingPath=join(journalDirectory,key+'.received.json'),binding=await optionalJSON(bindingPath);
  const module=kind==='stellarcarbon'?await import('../stellarcarbon-statements/store.mjs'):await import('../cfce-givecredit-statements/store.mjs');
  if(binding){
   const current=await module.inspectBinding(destination.path);
   need(current.workspaceId===binding.workspaceId&&same(identity(await lstat(destination.path)),binding.identity),'CARBON_RECEIVER_CHANGED','The independent receiver identity changed.');
   return binding;
  }
  const original=await fileDigest(source.path);need(original.bytes===source.bytes&&original.sha256===source.sha256,'CARBON_HANDOVER_CHANGED','Restore the exact retained original handover.');
  const handover=await readJSON(source.path,MAX_FILE_BYTES);
  need(handover.schema===(kind==='stellarcarbon'?'stellar-forge.stellarcarbon-handover.v1':'stellar-forge.givecredit-handover.v1'),
   'CARBON_HANDOVER_KIND','Receive the complete handover for the selected original application.');
  let workspace;
  try{
   let present=false;try{await lstat(join(destination.path,'workspace.json'));present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(present){
    const Class=kind==='stellarcarbon'?module.StellarcarbonWorkspace:module.GiveCreditWorkspace;
    workspace=await Class.open(destination.path);
    const state=kind==='givecredit'?await workspace.readonlySnapshot():workspace.state;
    let expected=handover.workspace;
    if(kind==='givecredit'){
     need(state.receivedFrom?.workspaceId===handover.workspace.workspaceId&&state.receivedFrom?.exportedAt===handover.exportedAt,
      'CARBON_RECEIVE_CHANGED','The unacknowledged receiver belongs to another original handover.');
     expected={...handover.workspace,workspaceId:state.workspaceId,receivedFrom:state.receivedFrom};
    }
    need(jsonIdentity(state,{canonical:true}).sha256===jsonIdentity(expected,{canonical:true}).sha256,
     'CARBON_RECEIVE_CHANGED','The unacknowledged receiver differs from its full original handover. Preserve it for review before adopting.');
   }else{
    const Class=kind==='stellarcarbon'?module.StellarcarbonWorkspace:module.GiveCreditWorkspace;
    workspace=await Class.create(destination.path,{handover});
   }
   const result={schema:'stellar-forge.carbon-agent-received.v1',kind,directory:destination.path,workspaceId:workspace.state.workspaceId,
    identity:identity(await lstat(destination.path)),source:intent.source,requestId,originWorkspaceId,receivedAt:new Date().toISOString()};
   await writeOnce(bindingPath,result);return result;
  }finally{await workspace?.close();}
 }finally{await lease.close();}
}
export async function receivedBinding(journalDirectory,destination){
 return optionalJSON(join(journalDirectory,hash(destination.path)+'.received.json'));
}
