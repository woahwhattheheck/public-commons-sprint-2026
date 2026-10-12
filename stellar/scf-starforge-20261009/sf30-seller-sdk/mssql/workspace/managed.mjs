// MIT. Managed Applications opens the same original SQL Server workspace.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/mssql';
const STARTUP='stellar-forge.mssql-workspace-startup.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const need=(value,code,message)=>{if(!value)throw Object.assign(new Error(message??code),{code,status:409});};
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const identity=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function mssqlApplication(common=[]) {
  return {id:'mssql',command:'mssql-workspace',title:'SQL Server data products',terminal:false,
    requiredSource:SOURCE+'/workspace/operator.mjs',
    description:'Operate the original SQL Server catalog, retained query reviews, prepared sellers, merchant and customer transfers, and receiving workspace.',
    fields:[
      field('sourceFile','SQL Server source profile','path',true,'Select the original source JSON. Passwords stay in its named host environment variable.'),
      field('stateDirectory','Initialized SQL Server workspace','path',true,'Select the private directory created by mssql-workspace init. Existing releases and reviews reopen here.'),
      field('releaseStore','Original seller release store','path',false,'Optional initialized SF82 store selected by the same merchant host.'),
      field('sellerPort','Seller port','port',false,'Use 0 to select an available loopback seller port.'),
      field('operationsPort','Seller operations port','port',false,'Use 0 to select an available loopback operations port.'),
      field('facilitator','Facilitator URL','text',false,'Optional original HTTPS payment facilitator.'),
      field('allowLocalFacilitator','Allow the selected local facilitator','boolean',false,'Use only with the original local native receiving configuration.'),
      ...common]};
}
export async function prepareMssqlApplication(settings,{inputPath,applicationEnvironment,runtimeDirectory}={}) {
  need(process.platform==='linux','APPLICATION_MSSQL_LINUX_REQUIRED','Run the original SQL Server authoring owner on Linux with util-linux flock.');
  need(typeof inputPath==='function'&&typeof applicationEnvironment==='function','APPLICATION_MSSQL_CONTEXT_REQUIRED');
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const native=await import(pathToFileURL(join(runtime.sourceRoot,SOURCE,'workspace/operator-store.mjs')).href);
  need(typeof native.inspectMssqlOperatorBinding==='function','APPLICATION_MSSQL_NATIVE_SOURCE_REQUIRED');
  const selected=await native.inspectMssqlOperatorBinding({sourceFile:settings.sourceFile,stateDirectory:settings.stateDirectory});
  const inputs=[await inputPath(selected.stateDirectory,'directory',false,true),
    await inputPath(join(selected.stateDirectory,'operator'),'directory',false,true)];
  const marker=await inputPath(selected.identityFile,'file');
  need(marker.sha256===selected.workspaceIdentitySha256,'APPLICATION_MSSQL_WORKSPACE_CHANGED');
  inputs.push(marker);
  for(const file of selected.files) {
    const observed=await inputPath(file.path,'file');
    need(observed.sha256===file.sha256&&observed.bytes===file.bytes,'APPLICATION_MSSQL_SOURCE_CHANGED');
    inputs.push(observed);
  }
  if(settings.releaseStore) {
    inputs.push(await inputPath(settings.releaseStore,'directory',false,true));
    const releases=await import(pathToFileURL(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).href);
    await releases.readReleaseState(settings.releaseStore);
  }
  const {environment}=await applicationEnvironment(settings.environmentFile);
  if(selected.requiredEnvironment)need(typeof environment[selected.requiredEnvironment]==='string'&&
    environment[selected.requiredEnvironment].length>0,'APPLICATION_MSSQL_ENVIRONMENT_REQUIRED',
    'Set '+selected.requiredEnvironment+' in the selected private environment before starting this workspace.');
  const args=['--source',selected.sourceFile,'--state',selected.stateDirectory,
    '--expected-workspace-id',selected.workspaceId,'--expected-profile-id',selected.profileId,
    '--connection-file',join(selected.stateDirectory,'operator','connection.json'),
    '--seller-port',String(settings.sellerPort??0),'--operations-port',String(settings.operationsPort??0)];
  if(settings.releaseStore)args.push('--release-store',settings.releaseStore);
  if(settings.facilitator)args.push('--facilitator',settings.facilitator);
  if(settings.allowLocalFacilitator)args.push('--allow-local-facilitator');
  return {args,inputs,createDirectories:[],resourceKey:identity({
    family:'mssql',directory:selected.stateDirectory,workspaceId:selected.workspaceId})};
}
function selection(request) {
  need(Array.isArray(request.args),'APPLICATION_MSSQL_STARTUP_CHANGED');
  const options=new Map(),allowed=new Set(['--source','--state','--expected-workspace-id',
    '--expected-profile-id','--connection-file','--seller-port','--operations-port','--release-store','--facilitator','--port']);
  for(let i=0;i<request.args.length;i++) {
    const name=request.args[i];
    need(!options.has(name),'APPLICATION_MSSQL_STARTUP_CHANGED');
    if(name==='--allow-local-facilitator'){options.set(name,true);continue;}
    need(allowed.has(name)&&typeof request.args[i+1]==='string'&&!request.args[i+1].startsWith('--'),
      'APPLICATION_MSSQL_STARTUP_CHANGED');
    options.set(name,request.args[++i]);
  }
  need(['--source','--state','--expected-workspace-id','--expected-profile-id','--connection-file']
    .every(name=>options.has(name))&&UUID.test(options.get('--expected-workspace-id'))&&
    SHA.test(options.get('--expected-profile-id')),'APPLICATION_MSSQL_STARTUP_CHANGED');
  for(const name of ['--port','--seller-port','--operations-port'])if(options.has(name))
    need(/^(0|[1-9]\d{0,4})$/.test(options.get(name))&&Number(options.get(name))<=65535,'APPLICATION_MSSQL_STARTUP_CHANGED');
  return options;
}
async function liveInfo(url,token,workspaceId) {
  const response=await fetch(new URL('/api/info',url),{redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{'x-workspace-token':token,'x-mssql-workspace-id':workspaceId}});
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''),
    'APPLICATION_MSSQL_STARTUP_UNAVAILABLE');
  const chunks=[];let size=0;
  try{
    for await(const chunk of response.body??[]) {
      size+=chunk.length;need(size<=262144,'APPLICATION_MSSQL_STARTUP_UNAVAILABLE');chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
}
export async function mssqlStartup(request,text) {
  if(request.command!=='mssql-workspace'||request.pythonCommand||typeof text!=='string'||text.length>32768||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(value?.schema!==STARTUP)return null;
  const selected=selection(request);
  const native=await import(pathToFileURL(join(request.releaseDirectory,'source',SOURCE,'workspace/operator-store.mjs')).href);
  const binding=await native.inspectMssqlOperatorBinding({
    sourceFile:selected.get('--source'),stateDirectory:selected.get('--state')});
  need(binding.workspaceId===selected.get('--expected-workspace-id')&&binding.profileId===selected.get('--expected-profile-id')&&
    value.workspaceId===binding.workspaceId&&value.workspaceCreatedAt===binding.workspaceCreatedAt&&
    value.workspaceIdentitySha256===binding.workspaceIdentitySha256&&value.profileId===binding.profileId&&
    value.state===binding.stateDirectory&&value.sourceFile===binding.sourceFile&&
    value.connectionFile===selected.get('--connection-file')&&UUID.test(value.instanceId??'')&&
    Number.isSafeInteger(value.pid)&&value.pid>0,'APPLICATION_MSSQL_STARTUP_CHANGED');
  let url;try{url=new URL(value.workspace);}catch{}
  need(url?.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&
    !url.username&&!url.password&&/^#[a-f0-9]{64}$/.test(url.hash)&&Number(url.port)>=1&&Number(url.port)<=65535&&
    (!Number(selected.get('--port')??0)||Number(selected.get('--port'))===Number(url.port)),
    'APPLICATION_MSSQL_STARTUP_CHANGED');
  const connection=await native.readJSON(value.connectionFile,16384);
  need(connection.schema===STARTUP&&connection.instanceId===value.instanceId&&connection.workspace===value.workspace&&
    connection.workspaceId===binding.workspaceId&&connection.profileId===binding.profileId,
    'APPLICATION_MSSQL_STARTUP_CHANGED');
  const state=await liveInfo(url,url.hash.slice(1),binding.workspaceId);
  need(state.schema==='stellar-forge.mssql-workspace.v1'&&state.workspaceId===binding.workspaceId&&
    state.workspaceIdentitySha256===binding.workspaceIdentitySha256&&state.profileId===binding.profileId&&
    state.instanceId===value.instanceId&&state.pid===value.pid&&state.stateDirectory===binding.stateDirectory&&
    state.sourceFile===binding.sourceFile&&state.stageAvailable===Boolean(selected.get('--release-store')),
    'APPLICATION_MSSQL_STARTUP_CHANGED','The live original SQL Server workspace differs from the reviewed application.');
  return {url:url.href,original:value,workspaceId:binding.workspaceId,connectionFile:value.connectionFile};
}
