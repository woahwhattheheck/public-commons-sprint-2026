// MIT. Resumable original merchant-host registration for an existing customer workspace.
import {mkdir,lstat,readdir,rename,unlink,open} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initReleaseStore,readReleaseState} from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from './host-files.mjs';
import {apiPassHostPath,apiPassPrivateDirectory,readApiPassPrivateFile,readApiPassWorkspaceConfiguration} from './api-pass-connection.mjs';
import {apiPassText,apiPassNeed,apiPassFingerprint,apiPassFailure} from './api-pass-protocol.mjs';
const SCHEMA='stellar-forge.sf101.api-pass-mcp-setup.v1';
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function sync(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function privateDirectory(path){try{await mkdir(path,{mode:0o700});await sync(dirname(path));}catch(error){if(error.code!=='EEXIST')throw error;}return apiPassPrivateDirectory(path);}
async function json(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readApiPassPrivateFile(path,1024*1024)));}
async function atomic(root,name,value){
 const temporary=join(root,'.'+name+'.next');await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await writePrivate(temporary,value);await rename(temporary,join(root,name));await sync(root);
}
async function originalStore(root,target){
 if(await exists(target)){await readReleaseState(target);return;}
 // Preserve incomplete original initializer attempts. A later invocation can
 // publish a complete original stage or complete a fresh original initializer.
 for(const item of await readdir(root,{withFileTypes:true})){
  if(!item.isDirectory()||!/^release-setup-[a-f0-9-]{36}$/.test(item.name))continue;
  const stage=join(root,item.name);let state;
  try{state=await readReleaseState(stage);}catch{continue;}
  apiPassNeed(state.generation===0&&state.active===null&&state.previous===null&&state.history.length===0&&(await readdir(join(stage,'releases'))).length===0,'An unpublished setup stage contains original release activity. Preserve it and select the intended merchant store.','API_PASS_SETUP_STORE_CHANGED');
  await rename(stage,target);await sync(root);return;
 }
 const stage=join(root,'release-setup-'+randomUUID());
 await initReleaseStore(stage);await readReleaseState(stage);await rename(stage,target);await sync(root);
}
/** Existing exact configuration is reopened; interrupted own setup is completed. */
export async function initializeApiPassWorkspaceMerchant({directory,connection,name='API pass workspace',releaseStore}={}){
 const root=apiPassHostPath(directory),apiPassWorkspaceConnection=apiPassHostPath(connection),selectedStore=releaseStore===undefined?join(root,'releases'):apiPassHostPath(releaseStore);
 name=apiPassText(name,160,'merchant name');
 const configured=await readApiPassWorkspaceConfiguration(apiPassWorkspaceConnection);
 await apiPassPrivateDirectory(dirname(root));await privateDirectory(root);let lease;
 try{lease=await acquireStateLease(root);}catch{throw apiPassFailure('API_PASS_SETUP_BUSY','Another process owns this exact merchant setup.');}
 try{
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('./config.mjs'),configuration=join(root,'merchant-mcp.json'),marker=join(root,'api-pass-setup.json');
  const intent={schema:SCHEMA,connection:apiPassWorkspaceConnection,releaseStore:selectedStore,name};
  if(await exists(marker))apiPassNeed(apiPassFingerprint(await json(marker))===apiPassFingerprint(intent),'This private setup directory belongs to another connection, merchant name or release store.','API_PASS_SETUP_CHANGED');
  else{
   const allowed=new Set(['lease.lock','merchant-mcp.json','.api-pass-setup.json.next']);
   const entries=await readdir(root);
   apiPassNeed(entries.every(entry=>allowed.has(entry)),'Select this initializer’s own existing directory or a new private merchant directory.','API_PASS_SETUP_DIRECTORY_IN_USE');
   if(await exists(configuration)){
    const raw=await json(configuration);
    apiPassNeed(raw.schema===CONFIG_SCHEMA&&apiPassHostPath(raw.apiPassWorkspaceConnection,root)===apiPassWorkspaceConnection&&apiPassHostPath(raw.releaseStore,root)===selectedStore,'The existing merchant configuration belongs to another original connection or store.','API_PASS_SETUP_CHANGED');
   }
   lease.assertHeld();await atomic(root,'api-pass-setup.json',intent);
  }
  if(releaseStore===undefined)await originalStore(root,selectedStore);else await readReleaseState(selectedStore);
  await privateDirectory(join(root,'customer-exports'));
  const reopening=Boolean(await exists(configuration));
  if(reopening){
   const raw=await json(configuration);
   apiPassNeed(raw.schema===CONFIG_SCHEMA&&apiPassHostPath(raw.apiPassWorkspaceConnection,root)===apiPassWorkspaceConnection&&apiPassHostPath(raw.releaseStore,root)===selectedStore,'The existing merchant configuration points to different original sources.','API_PASS_SETUP_CHANGED');
  }else{
   lease.assertHeld();await atomic(root,'merchant-mcp.json',{schema:CONFIG_SCHEMA,name,releaseStore:selectedStore,exportsDirectory:'./customer-exports',sources:{},apiPassWorkspaceConnection});
  }
  const current=await readMerchantConfig(configuration);
  apiPassNeed(current.apiPassWorkspaces?.workspaces,'The installed original merchant source must include the API-pass connection reader.','API_PASS_HOST_SOURCE_REQUIRED');
  return {schema:CONFIG_SCHEMA,configuration,state:reopening?'REOPENED':'INITIALIZED',apiPassWorkspacesConfigured:true,
   workspaces:Object.entries(configured.workspaces).map(([workspace,entry])=>({workspace,label:entry.label,workspaceId:entry.workspaceId})),ownership:'ORIGINAL_RUNNING_API_PASS_WORKSPACE'};
 }finally{await lease.close();}
}
