// MIT. Resumable registration of the original Buyer application in its merchant host.
import {mkdir,lstat,readdir,rename,unlink,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initReleaseStore,readReleaseState} from '../sf82-seller-pilot/releases.mjs';
import {acquireStateLease} from '../merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from '../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {hostPath,privateDirectory,readPrivate,readBuyerAgentConfiguration,parse,hash,encode} from './agent-connection.mjs';
import {need,fail,plain} from './agent-contract.mjs';
const SCHEMA='stellar-forge.buyer-runbook.agent-setup.v1';
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function sync(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function directory(path){try{await mkdir(path,{mode:0o700});await sync(dirname(path));}catch(error){if(error.code!=='EEXIST')throw error;}return privateDirectory(path);}
async function json(path){return parse(await readPrivate(path,2*1024*1024));}
async function atomic(root,name,value){
 const temporary=join(root,'.'+name+'.next');await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await writePrivate(temporary,value);await rename(temporary,join(root,name));await sync(root);
}
async function originalStore(root,target){
 if(await exists(target)){await readReleaseState(target);return;}
 for(const item of await readdir(root,{withFileTypes:true})){
  if(!item.isDirectory()||!/^release-setup-[a-f0-9-]{36}$/.test(item.name))continue;
  const stage=join(root,item.name);let state;
  try{state=await readReleaseState(stage);}catch{continue;}
  need(state.generation===0&&state.active===null&&state.previous===null&&state.history.length===0&&
   (await readdir(join(stage,'releases'))).length===0,'BUYER_AGENT_SETUP_STORE_CHANGED','Preserve original release activity and select its intended merchant store.');
  await rename(stage,target);await sync(root);return;
 }
 const stage=join(root,'release-setup-'+randomUUID());
 await initReleaseStore(stage);await readReleaseState(stage);await rename(stage,target);await sync(root);
}
export async function initializeBuyerRunbookMerchant(options={}){
 need(plain(options)&&Object.keys(options).every(key=>['directory','connection','name','releaseStore'].includes(key))&&
  Object.hasOwn(options,'directory')&&Object.hasOwn(options,'connection'),'INVALID_PARAMS','Select the original Buyer connection and private merchant setup directory.');
 const root=hostPath(options.directory),buyerRunbookWorkspaceConnection=hostPath(options.connection);
 const selectedStore=options.releaseStore===undefined?join(root,'releases'):hostPath(options.releaseStore),name=options.name??'Buyer receiving workspace';
 need(typeof name==='string'&&name.trim()&&name.length<=160&&!/[\x00-\x1f\x7f]/.test(name),'INVALID_PARAMS','Use a single-line merchant name.');
 const configured=await readBuyerAgentConfiguration(buyerRunbookWorkspaceConnection);
 await privateDirectory(dirname(root));await directory(root);let lease;
 try{lease=await acquireStateLease(root);}catch{throw fail('BUYER_AGENT_SETUP_BUSY','Another process owns this exact original merchant setup.');}
 try{
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('../../../stellar-forge/mcp-merchant-operator/config.mjs');
  const configuration=join(root,'merchant-mcp.json'),marker=join(root,'buyer-agent-setup.json');
  const intent={schema:SCHEMA,connection:buyerRunbookWorkspaceConnection,releaseStore:selectedStore,name};
  if(await exists(marker))need(hash(encode(await json(marker)))===hash(encode(intent)),
   'BUYER_AGENT_SETUP_CHANGED','This setup belongs to a different original connection, merchant name or release store.');
  else{
   const allowed=new Set(['lease.lock','merchant-mcp.json','.buyer-agent-setup.json.next']);
   need((await readdir(root)).every(entry=>allowed.has(entry)),'BUYER_AGENT_SETUP_DIRECTORY_IN_USE','Select this original setup directory or a new private merchant directory.');
   if(await exists(configuration)){const raw=await json(configuration);
    need(raw.schema===CONFIG_SCHEMA&&hostPath(raw.buyerRunbookWorkspaceConnection,root)===buyerRunbookWorkspaceConnection&&
     hostPath(raw.releaseStore,root)===selectedStore,'BUYER_AGENT_SETUP_CHANGED','The existing merchant configuration belongs to another original source.');}
   lease.assertHeld();await atomic(root,'buyer-agent-setup.json',intent);
  }
  if(options.releaseStore===undefined)await originalStore(root,selectedStore);else await readReleaseState(selectedStore);
  await directory(join(root,'customer-exports'));
  const reopening=Boolean(await exists(configuration));
  if(reopening){const raw=await json(configuration);
   need(raw.schema===CONFIG_SCHEMA&&hostPath(raw.buyerRunbookWorkspaceConnection,root)===buyerRunbookWorkspaceConnection&&
    hostPath(raw.releaseStore,root)===selectedStore,'BUYER_AGENT_SETUP_CHANGED','The retained merchant configuration points to different original sources.');}
  else{lease.assertHeld();await atomic(root,'merchant-mcp.json',{schema:CONFIG_SCHEMA,name,releaseStore:selectedStore,
   exportsDirectory:'./customer-exports',sources:{},buyerRunbookWorkspaceConnection});}
  const current=await readMerchantConfig(configuration);
  need(current.buyerRunbookWorkspaces?.workspaces,'BUYER_AGENT_HOST_SOURCE_REQUIRED','Use the original selected merchant source with this provider contribution.');
  return {schema:CONFIG_SCHEMA,configuration,state:reopening?'REOPENED':'INITIALIZED',
   workspaces:Object.entries(configured.workspaces).map(([workspace,binding])=>({workspace,label:binding.label,
    directory:binding.directory,selectionSha256:binding.expectedSelectionSha256})),ownership:'ORIGINAL_RUNNING_BUYER_WORKSPACE'};
 }finally{await lease.close();}
}
