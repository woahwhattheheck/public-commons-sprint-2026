// MIT. Original input identities may be read at an explicitly received current host.
import {join} from 'node:path';
import {need,readJSON,workspaceReceivingState} from './storage.mjs';
export async function requireApplicationInputWorkspace(root,workspaceId) {
  const config=await readJSON(join(root,'workspace.json'));
  need(config.schema==='stellar-forge.runtime-workspace.v1'&&config.workspaceId===workspaceId,
    'RUNTIME_WORKSPACE_IDENTITY_CHANGED','Reopen the original Runtime workspace.',409);
  if(config.directory===root)return config;
  const receiving=await workspaceReceivingState(root);
  need(receiving?.mode==='new-host'&&receiving.workspaceId===workspaceId&&
    receiving.originalDirectory===config.directory&&receiving.phase==='BINDINGS_REVIEWED',
    'RUNTIME_WORKSPACE_IDENTITY_CHANGED','Open the reviewed current-host binding for this original workspace.',409);
  return config;
}
