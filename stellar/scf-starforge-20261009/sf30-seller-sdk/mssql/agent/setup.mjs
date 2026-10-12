// MIT. Recoverable source-owned setup for the existing SQL Server browser provider.
import { join, dirname, resolve } from 'node:path';
import { readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initReleaseStore, readReleaseState } from '../../../sf82-seller-pilot/releases.mjs';
import { readMssqlWorkspaceConfiguration } from './client.mjs';
import { absolute, exact, need, digest, canonical, readBytes, readJSON, privateDirectory, operatorLease,
  exists, publish, syncDirectory } from '../workspace/operator-store.mjs';
const SCHEMA='stellar-forge.mssql-agent-setup.v1';
async function originalStore(root,target) {
  if(await exists(target)){await readReleaseState(target);return;}
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(!entry.isDirectory()||!/^release-setup-[a-f0-9-]{36}$/.test(entry.name))continue;
    const stage=join(root,entry.name);let state;
    try{state=await readReleaseState(stage);}catch{continue;}
    need(state.generation===0&&state.active===null&&state.previous===null&&state.history.length===0&&
      (await readdir(join(stage,'releases'))).length===0,'MSSQL_SETUP_STORE_CHANGED');
    await rename(stage,target);await syncDirectory(root);return;
  }
  const stage=join(root,'release-setup-'+randomUUID());
  await initReleaseStore(stage);await readReleaseState(stage);await rename(stage,target);await syncDirectory(root);
}
export async function initializeMssqlWorkspaceMerchant(options={}) {
  exact(options,['directory','connection','name','releaseStore'],['directory','connection']);
  const root=absolute(resolve(options.directory)),connection=absolute(resolve(options.connection));
  const name=options.name??'SQL Server merchant';
  need(typeof name==='string'&&name.trim()&&name.length<=160&&!/[\x00-\x1f\x7f]/.test(name),'MSSQL_SETUP_NAME_INVALID');
  const configured=await readMssqlWorkspaceConfiguration(connection),connectionSha256=digest(await readBytes(connection,1048576));
  const selectedStore=options.releaseStore===undefined?join(root,'releases'):absolute(resolve(options.releaseStore));
  await privateDirectory(dirname(root));await privateDirectory(root,true);
  const lease=await operatorLease(root);
  try {
    const marker=join(root,'mssql-setup.json'),configuration=join(root,'merchant-mcp.json');
    const intent={schema:SCHEMA,connection,connectionSha256,releaseStore:selectedStore,name};
    if(await exists(marker))
      need(canonical(await readJSON(marker))===canonical(intent),'MSSQL_SETUP_CHANGED',undefined,409);
    else {
      need((await readdir(root)).every(name=>name==='lease.lock'||/^\.mssql-[a-f0-9-]+\.next$/.test(name)),
        'MSSQL_SETUP_DIRECTORY_IN_USE');
      lease.assertHeld();await publish(marker,intent);
    }
    if(options.releaseStore===undefined)await originalStore(root,selectedStore);
    else await readReleaseState(selectedStore);
    await privateDirectory(join(root,'customer-exports'),true);
    const record={schema:'stellar-forge.merchant-mcp.v1',name,releaseStore:selectedStore,
      exportsDirectory:'./customer-exports',sources:{},mssqlWorkspaceConnection:connection};
    const reopened=Boolean(await exists(configuration));
    if(reopened)need(canonical(await readJSON(configuration))===canonical(record),'MSSQL_SETUP_CHANGED',undefined,409);
    else {lease.assertHeld();await publish(configuration,record);}
    const {readMerchantConfig}=await import('../../../../../stellar-forge/mcp-merchant-operator/config.mjs');
    const current=await readMerchantConfig(configuration);
    need(current.mssqlWorkspaces?.workspaces,'MSSQL_PROVIDER_SOURCE_REQUIRED');
    return {schema:record.schema,configuration,releaseStore:selectedStore,state:reopened?'REOPENED':'INITIALIZED',
      workspaces:Object.entries(configured.workspaces).map(([workspace,value])=>({workspace,workspaceId:value.workspaceId,label:value.label})),
      ownership:'ORIGINAL_MSSQL_WORKSPACE'};
  } finally {await lease.close();}
}
