// MIT. Bind original event workspaces to the maintained Merchant release store.
import {lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {privateDirectory,acquireWorkspace,identity} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import {writeExact} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/edition.mjs';
import {readSorobanEventsConfiguration} from './connection.mjs';
import {need,exact,text,encode} from './contracts.mjs';

/** Repeat the same setup after interruption; every saved binding stays original. */
export async function initializeSorobanEventsMerchant(options={}){
  exact(options,['directory','connection','name'],['directory','connection']);
  const directory=resolve(text(options.directory,'private merchant directory',4096)),
    connection=resolve(text(options.connection,'original event connection',4096)),
    name=text(options.name??'Starforge Soroban event operations','merchant name');
  const selected=await readSorobanEventsConfiguration(connection);
  need(Object.values(selected.workspaces).every(item=>item.directory!==directory),
    'SOROBAN_EVENTS_SETUP_DIRECTORY_CONFLICT','Use a separate directory for the merchant host.');
  await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  const intentName='soroban-events-merchant-setup.json',intentFile=join(directory,intentName),
    configuration=join(directory,'merchant-mcp.json');
  const intent={schema:'stellar-forge.soroban-events-merchant-setup.v1',connection,name,
    connectionSha256:selected.connectionSha256};
  try{
    let exists=true;
    try{await lstat(intentFile);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
    if(!exists){
      const allowed=new Set(['publisher.lock','.census-publish-'+identity({name:intentName})]);
      need((await readdir(directory)).every(item=>allowed.has(item)),
        'SOROBAN_EVENTS_SETUP_DIRECTORY_IN_USE','Use an empty directory or this original Soroban merchant setup.');
    }
    // This is the native immutable publication helper already used by Merchant
    // setup. It resumes only its own exact staged bytes under the existing lease.
    await writeExact(intentFile,encode(intent));
    const {CONFIG_SCHEMA,readMerchantConfig}=await import('../config.mjs');
    const config={schema:CONFIG_SCHEMA,name,releaseStore:'./releases',
      exportsDirectory:'./customer-exports',sources:{},sorobanEventsConnection:connection};
    await writeExact(configuration,encode(config));
    const native=await import('../../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
    await native.initReleaseStore(join(directory,'releases'),{resume:true});
    await privateDirectory(join(directory,'customer-exports'),true);
    await readMerchantConfig(configuration);
    return {schema:CONFIG_SCHEMA,state:'INITIALIZED',configuration,
      source:'original-soroban-events-workspace',
      workspaces:Object.entries(selected.workspaces).map(([workspace,item])=>({
        workspace,label:item.label,captureConfigured:Boolean(item.connection),network:item.connection?.network??null
      })),receivers:{...selected.receivers}};
  }finally{await release();}
}
