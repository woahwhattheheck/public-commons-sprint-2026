// MIT. Configure the existing merchant host for original GridFabric operator attachments.
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {exact,line,writePrivate} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {readGridFabricWorkspaceConfiguration} from './workspace.mjs';
import {GridFabricClientError} from '../sdk/contract.mjs';

export async function initializeGridFabricMerchant(options={}){
  exact(options,['directory','connection','name','releaseStore'],['directory','connection']);
  const {directory,connection,name='Starforge GridFabric Plaid operations',releaseStore}=options;
  for(const value of [directory,connection,...(releaseStore===undefined?[]:[releaseStore])])
    if(typeof value!=='string'||!value||/[\0\r\n]/.test(value))
      throw new GridFabricClientError('GRIDFABRIC_CONFIGURATION','Select original host directory and connection references.');
  const root=resolve(directory),gridFabricWorkspaceConnection=resolve(connection);
  const selected=await readGridFabricWorkspaceConfiguration(gridFabricWorkspaceConnection);
  const store=releaseStore===undefined?join(root,'releases'):resolve(releaseStore);
  const releases=await import('../../../sf82-seller-pilot/releases.mjs');
  if(releaseStore!==undefined)await releases.readReleaseState(store);
  await mkdir(root,{mode:0o700});
  if(releaseStore===undefined)await releases.initReleaseStore(store);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration=join(root,'merchant-mcp.json');
  await writePrivate(configuration,{schema:'stellar-forge.merchant-mcp.v1',name:line(name,'Merchant name'),
    releaseStore:store,exportsDirectory:'./customer-exports',sources:{},gridFabricWorkspaceConnection});
  await (await import('../../../../../stellar-forge/mcp-merchant-operator/config.mjs')).readMerchantConfig(configuration);
  return {schema:'stellar-forge.merchant-mcp.v1',state:'INITIALIZED',configuration,
    gridFabricWorkspacesConfigured:true,ownership:'EXISTING_GRIDFABRIC_OPERATOR',
    workspaces:Object.entries(selected.workspaces).map(([workspace,value])=>({workspace,label:value.label}))};
}
