// SPDX-License-Identifier: MIT
// Prepare a private original Merchant host; never start a second application.
import {mkdir,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {acquirePrivateDirectoryWriter} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/operations/history.mjs';
import {initReleaseStore,readReleaseState} from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import {readMigrationAcceptanceConfiguration} from './mcp.mjs';
import {exact,need,absolute,privateDirectory,readJson,writeJson,inside} from './connection.mjs';

const SCHEMA='stellar-forge.merchant-mcp.v1';
async function directory(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}

/**
 * options.connection selects the complete private migration-acceptance-host.v1
 * alias configuration. It is not a live connection or an authentication token.
 * The existing listener may be stopped while this host configuration is created.
 */
export async function initializeMigrationAcceptanceMerchant(options){
  exact(options,['directory','connection','name'],['directory','connection']);
  need(typeof options.directory==='string'&&options.directory.length>0&&
    typeof options.connection==='string'&&options.connection.length>0,
    'MIGRATION_SETUP_INPUT','Select the Merchant directory and original workspace-alias configuration.');
  const root=absolute(resolve(options.directory)),connection=absolute(resolve(options.connection));
  const name=options.name??'Starforge Migration Acceptance operator';
  need(typeof name==='string'&&name.trim()===name&&name.length>0&&name.length<=240&&!/[\x00-\x1f\x7f]/.test(name),
    'MIGRATION_SETUP_NAME','Use a readable Merchant host name.');
  const selected=await readMigrationAcceptanceConfiguration(connection);
  need(Object.values(selected.workspaces).every(item=>!inside(item.directory,root)&&!inside(root,item.directory)),
    'MIGRATION_SETUP_LAYOUT','Keep the Merchant host in its own private directory beside every customer workspace.');
  await privateDirectory(dirname(root));
  await directory(root);
  const lease=await acquirePrivateDirectoryWriter(root);
  try{
    const configuration=join(root,'merchant-mcp.json');
    const value={schema:SCHEMA,name,releaseStore:'./releases',exportsDirectory:'./customer-exports',
      sources:{},migrationAcceptanceConnection:connection};
    let prior;
    try{prior=await readJson(configuration,1024*1024);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(prior)need(JSON.stringify(prior.value)===JSON.stringify(value),
      'MIGRATION_SETUP_CHANGED','This Merchant directory retains another original configuration.',409);
    const releases=join(root,'releases');
    let existing;
    try{existing=await lstat(releases);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){await privateDirectory(releases);await readReleaseState(releases);}
    else await initReleaseStore(releases);
    await directory(join(root,'customer-exports'));
    if(!prior)await writeJson(configuration,value);
    await(await import('../../stellar-forge/mcp-merchant-operator/config.mjs')).readMerchantConfig(configuration);
    return{schema:SCHEMA,configuration,state:'INITIALIZED',reused:Boolean(prior),
      migrationAcceptanceConfigured:true,connectionSha256:selected.sha256,
      workspaces:Object.entries(selected.workspaces).map(([workspace,item])=>({workspace,label:item.label})),
      authoring:'ORIGINAL_APPLICATION_LISTENER'};
  }finally{await lease.release();}
}
