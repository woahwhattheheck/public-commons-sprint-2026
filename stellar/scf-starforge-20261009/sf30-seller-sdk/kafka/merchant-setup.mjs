// MIT. Prepare the original merchant host for an existing Kafka Application.
import { mkdir, lstat, realpath, mkdtemp, rename, rm, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readKafkaWorkspaceConfiguration } from './merchant-tools.mjs';
import { readKafkaHostFile } from './client.mjs';
import { exact, failure } from './client-protocol.mjs';
import { writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { readMerchantConfig } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { initReleaseStore } from '../../sf82-seller-pilot/releases.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';

const SCHEMA='stellar-forge.merchant-mcp.v1';
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
async function privateDirectory(path) {
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||
      process.platform!=='win32'&&((info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()))
    throw failure('KAFKA_SETUP_DIRECTORY','Use the original canonical private directory.');
}
export async function initializeKafkaWorkspaceMerchant(options) {
  exact(options,['directory','connection'],['name']);
  const {directory,connection,name='Kafka merchant workspace'}=options;
  if(typeof directory!=='string'||!directory||typeof connection!=='string'||!connection||
      typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>160||/[\x00-\x1f\x7f]/.test(name))
    throw failure('KAFKA_SETUP_INVALID','Select the merchant directory, host connection file and printable name.');
  const root=resolve(directory),parent=dirname(root),kafkaWorkspaceConnection=resolve(connection);
  if(await realpath(parent)!==parent)
    throw failure('KAFKA_SETUP_DIRECTORY','Use the canonical parent of the merchant directory.');
  const selected=await readKafkaWorkspaceConfiguration(kafkaWorkspaceConnection);
  const raw={schema:SCHEMA,name,releaseStore:'./releases',exportsDirectory:'./customer-exports',sources:{},kafkaWorkspaceConnection};
  const configuration=join(root,'merchant-mcp.json');
  const completed=async reused=>{
    await privateDirectory(root);
    const bytes=await readKafkaHostFile(configuration,131072,{privateFile:true});
    const prior=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(canonical(prior)!==canonical(raw))
      throw failure('KAFKA_SETUP_CONFLICT','The selected merchant directory contains a different original configuration.');
    await readMerchantConfig(configuration);
    return {schema:SCHEMA,configuration,state:'INITIALIZED',reused,kafkaWorkspacesConfigured:true,
      ownership:'ORIGINAL_KAFKA_HTTP_WORKSPACE',
      workspaces:Object.entries(selected.workspaces).map(([workspace,item])=>({workspace,label:item.label}))};
  };
  // One original setup lease prevents concurrent initializers from replacing
  // an empty target directory or racing the same source-owned publication.
  const lockDirectory=join(parent,'.kafka-merchant-setup-'+createHash('sha256').update(root).digest('hex'));
  try{await mkdir(lockDirectory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  await privateDirectory(lockDirectory);
  const lease=await acquireStateLease(lockDirectory);
  let temporary;
  try {
    let exists=false;
    try{await lstat(root);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(exists)return await completed(true);
    temporary=await mkdtemp(join(parent,'.kafka-merchant-'));
    await initReleaseStore(join(temporary,'releases'));
    await mkdir(join(temporary,'customer-exports'),{mode:0o700});
    await writePrivate(join(temporary,'merchant-mcp.json'),raw);
    await readMerchantConfig(join(temporary,'merchant-mcp.json'));
    lease.assertHeld();
    await rename(temporary,root);temporary=null;
    const handle=await open(parent,'r');try{await handle.sync();}finally{await handle.close();}
    return await completed(false);
  } finally {
    if(temporary)await rm(temporary,{recursive:true,force:true});
    await lease.close();
  }
}
