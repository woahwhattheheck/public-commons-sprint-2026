// MIT. Configure the existing Merchant host for original webhook operating sessions.
import {resolve,join} from 'node:path';
import {mkdir,readdir} from 'node:fs/promises';
import {initReleaseStore} from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import {operationLease,privateDirectory} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {readWebhookFeedConfiguration,privateJson} from './connection.mjs';
import {writeOriginal} from './receiving.mjs';
import {exact,encode,digest,need} from './contracts.mjs';
export async function initializeWebhookFeedMerchant(options={}){
 exact(options,['directory','connection','name'],['directory','connection']);
 const directory=resolve(options.directory),connection=resolve(options.connection),name=options.name??'Webhook event operations';
 need(typeof name==='string'&&name.length>0&&name.length<=240,'WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 const selected=await readWebhookFeedConfiguration(connection);
 need(Object.values(selected.workspaces).every(item=>item.directory!==directory)&&Object.values(selected.receivers).every(item=>item.directory!==directory),'WEBHOOK_OPERATIONS_SETUP_DIRECTORY_CONFLICT');
 await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await privateDirectory(directory);
 const lease=await operationLease(join(directory,'.webhook-setup.lock')),intentFile=join(directory,'webhook-setup.json');
 const intent={schema:'stellar-forge.webhook-feed-merchant-setup.v1',connection,name,configurationSha256:digest(encode(selected))};
 try{
  let previous;try{previous=await privateJson(intentFile,65536);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous)need(digest(encode(previous))===digest(encode(intent)),'WEBHOOK_OPERATIONS_SETUP_CONFLICT');
  else need((await readdir(directory)).every(name=>name==='.webhook-setup.lock'),'WEBHOOK_OPERATIONS_SETUP_DIRECTORY_IN_USE');
  await writeOriginal(intentFile,intent);
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('../../stellar-forge/mcp-merchant-operator/config.mjs');
  const configuration=join(directory,'merchant-mcp.json');
  await writeOriginal(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:'./releases',exportsDirectory:'./customer-exports',sources:{},webhookFeedConnection:connection});
  await initReleaseStore(join(directory,'releases'),{resume:true});
  await mkdir(join(directory,'customer-exports'),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await readMerchantConfig(configuration);
  return {state:'INITIALIZED',configuration,workspaces:Object.keys(selected.workspaces),receivers:Object.keys(selected.receivers)};
 }finally{await lease.close();}
}
