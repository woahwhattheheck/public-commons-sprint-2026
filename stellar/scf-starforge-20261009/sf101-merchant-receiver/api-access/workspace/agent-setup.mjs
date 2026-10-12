// MIT. Retained local agent setup for the original API customer workspace.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {absolute,UUID,HASH,check,digest,canonical,now} from './configuration.mjs';
import {privateDirectory,writeJson,parseJson} from '../../../sf88-operator-buyer-cli/node/store.mjs';

export const AGENT_SETUP_SCHEMA='stellar-forge.sf101.api-pass-agent-setup.v1';
const CONNECTION_SCHEMA='stellar-forge.sf101.api-pass-mcp-connection.v1';
const MEMBER_NAMES=['setup.json','connection.json','merchant/merchant-mcp.json','client-settings.json'];
const SERVER_NAME='starforge-api-customer';
const MCP_ROOT=fileURLToPath(new URL('../../../../../stellar-forge/mcp-merchant-operator/',import.meta.url));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

async function ownedFile(path,optional=false){
 let handle;
 try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 try{
  const before=await handle.stat();
  check(before.isFile()&&before.nlink===1&&before.size<=1024*1024&&!(before.mode&0o077)&&
   (typeof process.getuid!=='function'||before.uid===process.getuid()),'API_AGENT_PRIVATE_FILE_REQUIRED');
  const bytes=await handle.readFile(),after=await handle.stat();
  check(bytes.length===before.size&&before.size===after.size&&before.dev===after.dev&&before.ino===after.ino&&
   before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&await realpath(path)===path,
   'API_AGENT_SETUP_CHANGED',409);
  return {bytes,value:parseJson(bytes),sha256:digest(bytes)};
 }finally{await handle.close();}
}
async function ownedDirectory(path,optional=false){
 try{
  const info=await lstat(path);
  check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path&&
   (typeof process.getuid!=='function'||info.uid===process.getuid()),'API_AGENT_PRIVATE_DIRECTORY_REQUIRED');
  return true;
 }catch(error){if(optional&&error.code==='ENOENT')return false;throw error;}
}
function selectedPaths(directory){
 return {connectionFile:join(directory,'connection.json'),merchantDirectory:join(directory,'merchant'),
  merchantConfiguration:join(directory,'merchant','merchant-mcp.json'),clientConfiguration:join(directory,'client-settings.json'),
  operationDirectory:join(directory,'operations'),exportDirectory:join(directory,'exports'),snapshotDirectory:join(directory,'reads')};
}
function sameOriginal(value,{directory,workspaceDirectory,workspaceId}){
 check(plain(value)&&value.schema===AGENT_SETUP_SCHEMA&&value.directory===directory&&
  value.workspaceDirectory===workspaceDirectory&&UUID.test(value.workspaceId??'')&&
  (workspaceId===undefined||workspaceId===null||value.workspaceId===workspaceId),
  'API_AGENT_ORIGINAL_WORKSPACE_CHANGED',409);
}
function sameConnection(value,selection,paths){
 const customer=value?.workspaces?.customer;
 check(plain(value)&&value.schema===CONNECTION_SCHEMA&&plain(value.workspaces)&&plain(customer)&&
  UUID.test(customer.workspaceId??'')&&
  (selection.workspaceId===undefined||selection.workspaceId===null||customer.workspaceId===selection.workspaceId)&&
  customer.launchFile===join(selection.workspaceDirectory,'api-pass-workspace-launch.json')&&
  customer.operationDirectory===paths.operationDirectory&&customer.exportDirectory===paths.exportDirectory&&
  customer.snapshotDirectory===paths.snapshotDirectory,'API_AGENT_ORIGINAL_CONNECTION_CHANGED',409);
 return customer;
}

/** Read setup files only. Customer work and MCP operation/download journals stay independent. */
export async function inspectApiPassAgentSetup(directory,{workspaceDirectory,workspaceId}={}){
 directory=absolute(directory);workspaceDirectory=absolute(workspaceDirectory);
 check(directory!==workspaceDirectory&&!workspaceDirectory.startsWith(directory+'/'),
  'API_AGENT_SETUP_DIRECTORY_MUST_BE_SEPARATE');
 check(workspaceId===undefined||workspaceId===null||UUID.test(workspaceId),'API_AGENT_WORKSPACE_ID_REQUIRED');
 const exists=await ownedDirectory(directory,true),paths=selectedPaths(directory),files=[],values={};
 if(exists){
  for(const name of MEMBER_NAMES){
   const path=join(directory,name),item=await ownedFile(path,true);
   if(!item)continue;
   files.push({name,path,bytes:item.bytes.length,sha256:item.sha256});values[name]=item.value;
  }
 }
 const selection={directory,workspaceDirectory,workspaceId};
 if(values['setup.json'])sameOriginal(values['setup.json'],selection);
 if(values['connection.json']){
  const customer=sameConnection(values['connection.json'],selection,paths);
  if(values['setup.json'])check(customer.workspaceId===values['setup.json'].workspaceId,'API_AGENT_ORIGINAL_WORKSPACE_CHANGED',409);
 }
 if(values['merchant/merchant-mcp.json']){
  const merchant=values['merchant/merchant-mcp.json'];
  check(merchant.schema==='stellar-forge.merchant-mcp.v1'&&merchant.apiPassWorkspaceConnection===paths.connectionFile,
   'API_AGENT_MERCHANT_CONNECTION_CHANGED',409);
 }
 if(values['client-settings.json']){
  const client=values['client-settings.json'],server=client?.mcpServers?.[SERVER_NAME];
  check(plain(client)&&plain(client.mcpServers)&&plain(server)&&
   server.env?.MCP_MERCHANT_CONFIG===paths.merchantConfiguration,'API_AGENT_CLIENT_CONNECTION_CHANGED',409);
 }
 return {schema:AGENT_SETUP_SCHEMA,directory,workspaceDirectory,
  workspaceId:values['setup.json']?.workspaceId??values['connection.json']?.workspaces?.customer?.workspaceId??workspaceId??null,
  exists,files,sha256:files.length?digest(JSON.stringify(canonical({directory,workspaceDirectory,files}))):'new',
  initialized:files.length===MEMBER_NAMES.length,...paths};
}

/** Called while the original customer model holds its state lease. */
export async function configureApiPassAgentSetup({directory,workspaceDirectory,workspaceId,
 expectedSetupSha256,label='API customer',nodePath=process.execPath}={}){
 directory=absolute(directory);workspaceDirectory=absolute(workspaceDirectory);
 check(UUID.test(workspaceId),'API_AGENT_WORKSPACE_ID_REQUIRED');
 check(expectedSetupSha256===undefined||expectedSetupSha256==='new'||HASH.test(expectedSetupSha256),
  'API_AGENT_EXPECTED_SETUP_INVALID');
 const selection={directory,workspaceDirectory,workspaceId};
 const before=await inspectApiPassAgentSetup(directory,selection);
 check(expectedSetupSha256===undefined||before.sha256===expectedSetupSha256,'API_AGENT_REVIEWED_SETUP_CHANGED',409);
 await privateDirectory(directory);await ownedDirectory(directory);
 const paths=selectedPaths(directory),markerFile=join(directory,'setup.json');
 let marker=await ownedFile(markerFile,true);
 if(marker)sameOriginal(marker.value,selection);
 else{
  await writeJson(markerFile,{schema:AGENT_SETUP_SCHEMA,...selection,createdAt:now()},{exclusive:true});
  marker=await ownedFile(markerFile);
 }
 for(const path of [paths.operationDirectory,paths.exportDirectory,paths.snapshotDirectory]){
  await privateDirectory(path);await ownedDirectory(path);
 }
 let connection=await ownedFile(paths.connectionFile,true);
 if(!connection){
  await writeJson(paths.connectionFile,{schema:CONNECTION_SCHEMA,workspaces:{customer:{
   label,workspaceId,launchFile:join(workspaceDirectory,'api-pass-workspace-launch.json'),
   operationDirectory:paths.operationDirectory,exportDirectory:paths.exportDirectory,snapshotDirectory:paths.snapshotDirectory,
   files:{},purchases:{},
  }}},{exclusive:true});
  connection=await ownedFile(paths.connectionFile);
 }
 sameConnection(connection.value,selection,paths);
 const setup=await import(pathToFileURL(join(MCP_ROOT,'api-pass-setup.mjs')).href);
 check(typeof setup.initializeApiPassWorkspaceMerchant==='function','API_AGENT_INSTALLED_SETUP_REQUIRED');
 const originalMerchant=await ownedFile(paths.merchantConfiguration,true);
 const merchant=await setup.initializeApiPassWorkspaceMerchant({
  directory:paths.merchantDirectory,connection:paths.connectionFile,name:originalMerchant?.value?.name??label,
 });
 check(merchant.configuration===paths.merchantConfiguration,'API_AGENT_MERCHANT_CONFIGURATION_CHANGED',409);
 const client=await import(pathToFileURL(join(MCP_ROOT,'client-config.mjs')).href);
 check(typeof client.createMerchantMcpClientConfiguration==='function','API_AGENT_INSTALLED_CLIENT_REQUIRED');
 const retained=await ownedFile(paths.clientConfiguration,true);
 let existingConfiguration=retained?structuredClone(retained.value):{};
 if(retained){
  const selected=existingConfiguration.mcpServers?.[SERVER_NAME];
  check(plain(selected)&&selected.env?.MCP_MERCHANT_CONFIG===paths.merchantConfiguration,
   'API_AGENT_CLIENT_CONNECTION_CHANGED',409);
  delete existingConfiguration.mcpServers[SERVER_NAME];
 }
 const settings=client.createMerchantMcpClientConfiguration({
  configPath:paths.merchantConfiguration,name:SERVER_NAME,nodePath:absolute(nodePath),
  entryPath:join(MCP_ROOT,'stdio.mjs'),existingConfiguration,
 });
 if(!retained)await writeJson(paths.clientConfiguration,settings,{exclusive:true});
 else if(!equal(retained.value,settings)){
  check((await ownedFile(paths.clientConfiguration)).sha256===retained.sha256,'API_AGENT_CLIENT_SETTINGS_CHANGED',409);
  await writeJson(paths.clientConfiguration,settings);
 }
 check((await ownedFile(paths.connectionFile)).sha256===connection.sha256&&
  (await ownedFile(markerFile)).sha256===marker.sha256,'API_AGENT_SETUP_CHANGED',409);
 const complete=await inspectApiPassAgentSetup(directory,selection);
 check(complete.initialized,'API_AGENT_SETUP_INCOMPLETE',409);
 return {schema:AGENT_SETUP_SCHEMA,directory,workspaceId,workspace:'customer',server:SERVER_NAME,
  connectionFile:paths.connectionFile,merchantConfiguration:paths.merchantConfiguration,
  clientConfiguration:paths.clientConfiguration,operationDirectory:paths.operationDirectory,
  exportDirectory:paths.exportDirectory,snapshotDirectory:paths.snapshotDirectory,
  setupSha256:complete.sha256,files:complete.files};
}
