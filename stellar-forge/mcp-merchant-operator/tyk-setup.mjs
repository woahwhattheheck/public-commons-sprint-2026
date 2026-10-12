// MIT. Fresh or resumed original merchant profile for the source-selected Tyk provider.
import { constants } from 'node:fs';
import { mkdir,readdir,link,unlink,open } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CONFIG_SCHEMA,readMerchantConfig } from './config.mjs';
import { line,writePrivate,failure } from './host-files.mjs';
import { readTykWorkspaceConfiguration } from './tyk-workspace.mjs';
import { readTykPrivateFile } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/http-client.mjs';
import { privateDirectory,canonical } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { initReleaseStore } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const selectedPath=(value,label)=>{
  if(typeof value!=='string'||!value.trim()||value.includes('\0'))throw failure('CONFIGURATION_ERROR','Supply '+label+'.');
  return resolve(value);
};
async function originalConfiguration(path){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readTykPrivateFile(path,1024*1024)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function ensureDirectory(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
export async function initializeTykWorkspaceMerchant({directory,connection,name='Starforge Tyk migration and rollout'}={}){
  const root=selectedPath(directory,'the private merchant profile directory');
  const tykWorkspaceConnection=selectedPath(connection,'the original Tyk workspace connection file');
  name=line(name,'Merchant name');
  const configured=await readTykWorkspaceConfiguration(tykWorkspaceConnection);
  const configuration=join(root,'merchant-mcp.json'),expected={schema:CONFIG_SCHEMA,name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},tykWorkspaceConnection};
  await ensureDirectory(root);
  const prior=await originalConfiguration(configuration);
  if(prior&&!same(prior,expected))throw failure('TYK_MERCHANT_PROFILE_EXISTS','This profile retains a different original configuration. Open that profile or select another private directory.');
  if(!prior){
    const allowed=new Set(['releases','customer-exports']);
    const ownTemporary=/^merchant-mcp\.json\.pending-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
    if((await readdir(root)).some(name=>!allowed.has(name)&&!ownTemporary.test(name)))
      throw failure('TYK_MERCHANT_PROFILE_EXISTS','The selected directory contains other retained files. Select the original Tyk profile or a new private directory.');
    await initReleaseStore(join(root,'releases'),{resume:true});
    await ensureDirectory(join(root,'customer-exports'));
    const temporary=configuration+'.pending-'+randomUUID();let owned=false;
    try{
      await writePrivate(temporary,expected);owned=true;
      try{await link(temporary,configuration);}
      catch(error){if(error.code!=='EEXIST')throw error;
        if(!same(await originalConfiguration(configuration),expected))
          throw failure('TYK_MERCHANT_PROFILE_EXISTS','Another original profile was initialized here. Its configuration was preserved.');}
      const handle=await open(root,constants.O_RDONLY|constants.O_DIRECTORY);try{await handle.sync();}finally{await handle.close();}
    }finally{if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',tykWorkspacesConfigured:true,
    workspaces:Object.entries(configured.workspaces).map(([workspace,value])=>({workspace,label:value.label,workspaceId:value.workspaceId})),
    ownership:'ORIGINAL_TYK_WORKSPACE'};
}
export async function runTykAgentSetupCLI(argv=process.argv.slice(2)){
  const args={};
  for(let index=0;index<argv.length;index+=2){
    const name=argv[index],value=argv[index+1],key={'--dir':'directory','--connection':'connection','--name':'name'}[name];
    if(!key||Object.hasOwn(args,key)||typeof value!=='string'||value.startsWith('--'))
      throw failure('CONFIGURATION_ERROR','Use tyk-agent-init --dir PRIVATE_PROFILE --connection ORIGINAL_CONNECTION_FILE [--name NAME].');
    args[key]=value;
  }
  const result=await initializeTykWorkspaceMerchant(args);process.stdout.write(JSON.stringify(result)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runTykAgentSetupCLI().catch(error=>{process.stderr.write((error.code??'TYK_AGENT_SETUP_FAILED')+': '+error.message+'\n');process.exitCode=2;});
}
