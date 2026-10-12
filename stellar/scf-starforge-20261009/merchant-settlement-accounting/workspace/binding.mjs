// MIT. Identity of the original private merchant accounting workspace.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {cwCanonical,cwHash} from '../accountant/cryptoworth-csv.mjs';
import {accountingSourceMode,buyerStartupDescriptor} from './buyer-startup.mjs';
const SCHEMA='stellar-forge.merchant-accounting-workspace.v1',SHA=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>Object.assign(new Error(message),{code});
function need(ok,code,message){if(!ok)throw fail(code,message);}
export function accountingWorkspaceBinding(directory,state){
  directory=resolve(directory);
  need(plain(state)&&state.schema===SCHEMA&&typeof state.createdAt==='string'&&Number.isFinite(Date.parse(state.createdAt))&&plain(state.sources),
    'INVALID_ACCOUNTING_BINDING','Select an initialized original accounting workspace.');
  const buyer=accountingSourceMode(state)==='buyer',descriptor=buyer?buyerStartupDescriptor(directory,state):null;
  const sources=buyer?{sourceMode:'buyer',buyerSourceFile:descriptor.path,buyerSourceSha256:descriptor.sha256,buyerSourceBytes:descriptor.bytes}:{};
  for(const field of buyer?[]:['outboxDir','proofDir','termsFile','recoveredDir']){
    const value=state.sources[field];
    if(field==='recoveredDir'&&value===undefined)continue;
    need(typeof value==='string'&&value===resolve(value)&&value!=='/'&&!/[\u0000-\u001f\u007f]/.test(value),
      'INVALID_ACCOUNTING_BINDING','Retain the original absolute accounting source paths.');
    sources[field]=value;
  }
  return {schema:'stellar-forge.accounting-workspace-binding.v1',directory,
    workspaceId:cwHash(cwCanonical({schema:state.schema,createdAt:state.createdAt,directory})),
    sourcesSha256:cwHash(cwCanonical(sources)),sources};
}
/** Called inside the original workspace lease, before any startup recovery write. */
export function assertAccountingWorkspaceBinding(directory,state,{expectedWorkspaceId,expectedSourcesSha256}={}){
  if(expectedWorkspaceId===undefined&&expectedSourcesSha256===undefined)return;
  need(SHA.test(expectedWorkspaceId??'')&&SHA.test(expectedSourcesSha256??''),'ACCOUNTING_BINDING_REQUIRED',
    'Retain both the reviewed workspace ID and original source configuration SHA256.');
  const binding=accountingWorkspaceBinding(directory,state);
  need(binding.workspaceId===expectedWorkspaceId&&binding.sourcesSha256===expectedSourcesSha256,'ACCOUNTING_WORKSPACE_CHANGED',
    'This directory or original source configuration differs from the reviewed accounting workspace. Reopen its current application review.');
  return binding;
}
/** Read-only Applications review; the original writer rechecks after acquiring its lease. */
export async function inspectAccountingWorkspaceBinding(directory){
  directory=resolve(directory);const stat=await lstat(directory);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&(!process.getuid||stat.uid===process.getuid())&&await realpath(directory)===directory,
    'ACCOUNTING_PRIVATE_DIRECTORY','Select the original owner-controlled private accounting directory without symlink ancestors.');
  const handle=await open(join(directory,'workspace.json'),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const file=await handle.stat();
    need(file.isFile()&&file.nlink===1&&file.size>0&&file.size<=32000000&&!(file.mode&0o077)&&(!process.getuid||file.uid===process.getuid()),
      'ACCOUNTING_PRIVATE_FILE','Select the original private workspace state file.');
    const bytes=await handle.readFile();need(bytes.length<=32000000,'ACCOUNTING_PRIVATE_FILE','The original workspace state exceeds its retained size limit.');
    return accountingWorkspaceBinding(directory,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }finally{await handle.close();}
}
