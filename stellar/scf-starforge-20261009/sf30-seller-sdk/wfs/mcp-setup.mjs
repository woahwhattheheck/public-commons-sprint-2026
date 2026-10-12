// MIT. Replayable native-host setup, retaining the original release store initializer.
import { mkdir,readdir,lstat,rename } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_SCHEMA,readMerchantConfig } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { initReleaseStore,readReleaseState } from '../../sf82-seller-pilot/releases.mjs';
import { withPrivateLock,atomicJson } from '../routescan/quota.mjs';
import { need,canonical,jsonBytes } from './model.mjs';
import { durableDirectory,exactFile,optionalJson } from './source.mjs';
import { readWfsWorkspaceConfiguration } from './mcp-client.mjs';

export async function initializeWfsMerchantWorkspace({directory,connection,name='Starforge WFS feature workspaces',releaseStore}={}) {
  need(typeof directory==='string'&&directory&&typeof connection==='string'&&connection,
    'Supply the new native merchant directory and original private connection configuration.');
  need(typeof name==='string'&&name.trim()&&name.length<=240&&!/[\x00-\x1f\x7f]/.test(name),'Use a plain native merchant name.');
  const root=resolve(directory),selectedConnection=resolve(connection),selected=await readWfsWorkspaceConfiguration(selectedConnection);
  const binding={schema:'stellar-forge.wfs-native-setup.v1',name,connection:selectedConnection,
    releaseStore:releaseStore?resolve(releaseStore):null};
  await durableDirectory(root);
  return withPrivateLock(root,'wfs-setup.lock',async()=>{
    let intent=await optionalJson(join(root,'wfs-setup.json'),65536);
    if(intent)need(canonical(intent.binding)===canonical(binding),'This original setup belongs to another host configuration.','WFS_SETUP_CONFLICT',409);
    else{
      need((await readdir(root)).every(name=>name==='wfs-setup.lock'),'Initialize an empty native merchant directory.','WFS_SETUP_CONFLICT',409);
      intent={binding,attempts:[]};await atomicJson(root,'wfs-setup.json',intent);
    }
    const store=binding.releaseStore??join(root,'releases');
    if(binding.releaseStore)await readReleaseState(store);
    else{
      let exists;try{exists=await lstat(store);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(exists){need(exists.isDirectory()&&!exists.isSymbolicLink(),'Keep the original release store.');await readReleaseState(store);}
      else{
        let stage=intent.attempts.at(-1)?.directory,ready=false;
        if(stage){
          try{await readReleaseState(stage);ready=true;}
          catch(error){intent.attempts.at(-1).interrupted=true;await atomicJson(root,'wfs-setup.json',intent);}
        }
        if(!ready){
          need(intent.attempts.length<32,'Inspect the retained setup attempts before creating another original release store.');
          stage=join(root,'release-store-preparing-'+randomUUID());
          intent.attempts.push({directory:stage,startedAt:new Date().toISOString()});
          await atomicJson(root,'wfs-setup.json',intent);
          await initReleaseStore(stage);
        }
        await durableDirectory(join(stage,'releases'));await rename(stage,store);await durableDirectory(root);
        await readReleaseState(store);
      }
    }
    await durableDirectory(join(root,'customer-exports'));
    const configuration=join(root,'merchant-mcp.json'),config={schema:CONFIG_SCHEMA,name,
      releaseStore:binding.releaseStore??'./releases',exportsDirectory:'./customer-exports',sources:{},
      wfsWorkspaceConnection:selectedConnection};
    await exactFile(join(root,'merchant-mcp.json'),jsonBytes(config));
    await readMerchantConfig(configuration);
    const result={schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',wfsWorkspacesConfigured:true,
      workspaces:Object.entries(selected.workspaces).map(([workspace,item])=>({workspace,label:item.label,projectId:item.projectId})),
      hostOwnership:'ORIGINAL_WFS_WORKSPACE'};
    await atomicJson(root,'wfs-setup-result.json',result);return result;
  });
}
