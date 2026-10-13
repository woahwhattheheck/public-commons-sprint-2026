// MIT. Original native agent host in the existing reviewed Applications lifecycle.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {absolute,need,plain} from '../../distribution/runtime-workspace/storage.mjs';
import {verifyNativeReviewedInputs,verifyNativeReviewedDirectories} from './application-provider.mjs';
import {createNativeOperatorClient} from './client.mjs';
import {nativeCanonicalJSON,nativeOperatorIdentity,isDigest} from './merchant-export-contract.mjs';

const SOURCE='stellar/scf-starforge-20261009/native-facilitator/workspace';
const COMMAND='native-facilitator-agent';
const BINDING='stellar-forge.native-agent-binding.v1';
const STARTUP='stellar-forge.native-agent-launch.v1';
export function nativeAgentApplication(common,field) {
  return {id:COMMAND,command:COMMAND,title:'Native Stellar agent',terminal:false,
    requiredSource:SOURCE+'/merchant-launcher.mjs',
    description:'Connect agents to the original running native operator, reopen its browser, and retain complete profile/catalog receiving across agent host restarts.',
    fields:[
      field('configurationFile','Merchant configuration','path',true,
        'Select the original private merchant-mcp.json with nativeFacilitatorOperatorConnection and its existing customer-exports directory.'),
      field('operatorAlias','Native operator alias','text',true,
        'Choose the original alias declared in that private connection. Start its native operator Application first.'),
      field('tokenEnv','Agent token environment name','text',false,
        'Defaults to MCP_ACCESS_TOKEN. Its existing value comes from this host or the selected private environment JSON.'),
      field('port','Agent port','port',false,
        'Zero selects an available loopback port for the original merchant MCP host.'),
      ...common.filter(value=>value.name!=='port')]};
}
export async function prepareNativeAgentApplication(settings,{inputPath,runtimeDirectory}={}) {
  const configFile=absolute(settings.configurationFile);
  const inputs=[await inputPath(configFile,'file',false,true)];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const launch=join(runtime.sourceRoot,SOURCE,'merchant-launcher.mjs');
  for(const name of ['merchant-launcher.mjs','merchant-binding.mjs','merchant-runtime.mjs',
    'merchant-connection.mjs','merchant-provider.mjs','merchant-export-contract.mjs','merchant-exports.mjs',
    'merchant-tools.mjs','client.mjs','catalog-receiving.mjs']){
    inputs.push(await inputPath(join(runtime.sourceRoot,SOURCE,name),'file'));
  }
  const original=await import(pathToFileURL(launch).href);
  need(typeof original.inspectNativeAgentBinding==='function','APPLICATION_NATIVE_AGENT_SOURCE_REQUIRED');
  const binding=await original.inspectNativeAgentBinding({configPath:configFile,operator:settings.operatorAlias});
  need(plain(binding)&&binding.schema===BINDING&&binding.configFile===configFile&&
    binding.operator===settings.operatorAlias&&isDigest(binding.bindingSha256)&&
    Array.isArray(binding.configurationFiles)&&binding.configurationFiles.length>=2&&
    binding.configurationFiles.length<=3,'APPLICATION_NATIVE_AGENT_BINDING_CHANGED');
  for(const file of binding.configurationFiles){
    need(plain(file)&&typeof file.path==='string'&&isDigest(file.sha256)&&Number.isSafeInteger(file.bytes),
      'APPLICATION_NATIVE_AGENT_BINDING_CHANGED');
    let selected=inputs.find(input=>input.path===file.path);
    if(!selected){selected=await inputPath(absolute(file.path),'file',false,true);inputs.push(selected);}
    need(selected.sha256===file.sha256&&selected.bytes===file.bytes,'APPLICATION_NATIVE_AGENT_BINDING_CHANGED');
  }
  for(const directory of new Set([binding.releaseStore,binding.exportsDirectory]))
    inputs.push(await inputPath(absolute(directory),'directory',false,true));
  const tokenEnv=settings.tokenEnv??'MCP_ACCESS_TOKEN';
  need(typeof tokenEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv),'APPLICATION_NATIVE_AGENT_TOKEN_ENV');
  return {args:['serve','--config',binding.configFile,'--operator',binding.operator,
    '--expected-binding-sha256',binding.bindingSha256,'--token-env',tokenEnv],inputs,createDirectories:[]};
}
function selectedArguments(request) {
  need(Array.isArray(request.args)&&request.args[0]==='serve','APPLICATION_NATIVE_AGENT_ARGUMENTS_CHANGED');
  const options=new Map(),allowed=new Set(['--config','--operator','--expected-binding-sha256','--token-env','--port']);
  for(let at=1;at<request.args.length;at+=2){
    const flag=request.args[at],value=request.args[at+1];
    need(allowed.has(flag)&&!options.has(flag)&&typeof value==='string'&&value.length>0,
      'APPLICATION_NATIVE_AGENT_ARGUMENTS_CHANGED');options.set(flag,value);
  }
  const configFile=absolute(options.get('--config')),operator=options.get('--operator');
  const bindingSha256=options.get('--expected-binding-sha256'),port=Number(options.get('--port')??0);
  need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(operator??'')&&isDigest(bindingSha256)&&
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(options.get('--token-env')??'')&&
    Number.isSafeInteger(port)&&port>=0&&port<=65535,'APPLICATION_NATIVE_AGENT_ARGUMENTS_CHANGED');
  return {configFile,operator,bindingSha256,port};
}
export async function verifyNativeAgentLaunch(request,directory) {
  if(request.command!==COMMAND||!request.applicationId)return;
  selectedArguments(request);
  const review=await verifyNativeReviewedInputs(request,directory,COMMAND);
  await verifyNativeReviewedDirectories(review,review.command.inputs.filter(input=>input.kind==='directory').map(input=>input.path));
}
export async function nativeAgentStartup(request,text,context={}) {
  if(request.command!==COMMAND||!request.applicationId||typeof text!=='string'||text.length>32768||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let launch;try{launch=JSON.parse(text);}catch{return null;}
  if(!plain(launch)||launch.schema!==STARTUP||launch.state!=='LISTENING')return null;
  const selected=selectedArguments(request);
  need(launch.configFile===selected.configFile&&launch.operator===selected.operator&&
    launch.bindingSha256===selected.bindingSha256&&
    typeof launch.instanceId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(launch.instanceId)&&
    Number.isSafeInteger(context.pid)&&context.pid>0&&Number.isSafeInteger(launch.pid)&&launch.pid>0&&
    Number.isSafeInteger(launch.ppid)&&launch.ppid>=0&&(launch.pid===context.pid||launch.ppid===context.pid)&&
    typeof launch.startedAt==='string'&&Number.isFinite(Date.parse(launch.startedAt)),
  'APPLICATION_NATIVE_AGENT_STARTUP_CHANGED');
  let mcp;try{mcp=new URL(launch.mcpUrl);}catch{need(false,'APPLICATION_NATIVE_AGENT_LISTENER_CHANGED');}
  const port=Number(mcp.port||80);
  need(mcp.protocol==='http:'&&mcp.hostname==='127.0.0.1'&&!mcp.username&&!mcp.password&&!mcp.search&&!mcp.hash&&
    mcp.pathname==='/'&&port>=1&&port<=65535&&(selected.port===0||selected.port===port),
  'APPLICATION_NATIVE_AGENT_LISTENER_CHANGED');
  const client=createNativeOperatorClient({operatorUrl:launch.operatorUrl});
  need(client.origin!==mcp.origin,'APPLICATION_NATIVE_AGENT_LISTENER_CHANGED');
  const live=await client.status({signal:AbortSignal.timeout(5000)});
  const native=nativeOperatorIdentity(live.workspace);
  need(nativeCanonicalJSON(native)===nativeCanonicalJSON(nativeOperatorIdentity(launch.native)),
    'APPLICATION_NATIVE_AGENT_NATIVE_CHANGED','Open the original authenticated native operator selected by this agent host.');
  return {url:launch.operatorUrl,original:{schema:STARTUP,state:'LISTENING',
    instanceId:launch.instanceId,pid:launch.pid,ppid:launch.ppid,startedAt:launch.startedAt,
    configFile:selected.configFile,operator:selected.operator,bindingSha256:selected.bindingSha256,
    releaseStore:absolute(launch.releaseStore),exportsDirectory:absolute(launch.exportsDirectory),
    mcpUrl:mcp.href,native}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:COMMAND,order:176,
  catalog({common,field}){return [nativeAgentApplication(common,field)];},
  prepare(type,settings,context){return prepareNativeAgentApplication(settings,context);},
  resourceKey(type,settings,{hash}){return hash({family:'merchant-mcp',directory:settings.configurationFile});},
  matchRequest(request){return !request.pythonCommand&&request.command===COMMAND;},
  verifyLaunch:verifyNativeAgentLaunch,
  createObserver(request,directory,context){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP+'",'))return null;
      return ()=>nativeAgentStartup(request,text,context);
    },{lineLimit:32768});
  },
};
