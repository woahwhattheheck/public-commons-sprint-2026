#!/usr/bin/env node
// MIT. Installed API-pass customer workspace and its original private launch.
import {readFile,lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openApiPassWorkspace} from './model.mjs';
import {startApiPassWorkspace} from './server.mjs';
import {CONFIG_SCHEMA,LAUNCH_SCHEMA,HASH,absolute,compileConfig,digest,check,fail,now} from './configuration.mjs';
import {readBytes,parseJson,privateDirectory,writeJson,exists} from '../../../sf88-operator-buyer-cli/node/store.mjs';

const ENTRY=fileURLToPath(import.meta.url);
const HELP=[
 'api-pass-workspace configure --directory ABS --out ABS [--buyer-workspace ABS]',
 '  [--runtime ABS --buyer-state ABS --inbox ABS --claim-env NAME --python EXECUTABLE --title TEXT]',
 'api-pass-workspace serve --config ABS [--port 0]',
 '  [--approval-mode auto|browser|terminal --approval-module ABS]',
 '  [--expected-config-sha256 SHA --expected-workspace-sha256 SHA|new]',
 '  [--expected-approval-sha256 SHA]',
 '',
 'The private startup link opens saved passes, exact requests, original purchase',
 'review, same-ID result recovery and verified response downloads.',
].join('\n');

function argumentsOf(argv){
 const result={command:argv.shift(),values:new Map()};
 if(!result.command||['help','--help','-h'].includes(result.command))return {command:'help',values:new Map()};
 const repeat=new Set(['claim-env']);
 while(argv.length){
  const raw=argv.shift();check(raw.startsWith('--')&&raw.length>2,'WORKSPACE_OPTION_REQUIRED');
  const equal=raw.indexOf('='),key=raw.slice(2,equal<0?undefined:equal);
  const value=equal<0?argv.shift():raw.slice(equal+1);
  check(typeof value==='string'&&value.length>0,'WORKSPACE_OPTION_VALUE_REQUIRED');
  check(repeat.has(key)||!result.values.has(key),'WORKSPACE_OPTION_REPEATED');
  result.values.set(key,[...(result.values.get(key)??[]),value]);
 }
 return result;
}
const selected=(values,key,fallback)=>values.get(key)?.[0]??fallback;
function only(values,allowed){check([...values.keys()].every(key=>allowed.includes(key)),'UNKNOWN_WORKSPACE_OPTION');}
async function codeFile(path){
 path=absolute(path);const info=await lstat(path);
 check(info.isFile()&&!info.isSymbolicLink()&&info.size<=4*1024*1024&&await realpath(path)===path,'ORIGINAL_APPROVAL_MODULE_REQUIRED');
 const bytes=await readFile(path);check(bytes.length<=4*1024*1024,'ORIGINAL_APPROVAL_MODULE_TOO_LARGE');return {path,sha256:digest(bytes)};
}
async function originalApprovals(config,{mode='auto',moduleFile,expectedSha256}={}){
 check(['auto','browser','terminal'].includes(mode),'INVALID_APPROVAL_MODE');
 check(expectedSha256===undefined||HASH.test(expectedSha256),'INVALID_EXPECTED_APPROVAL_SHA256');
 const terminal=capability=>({broker:null,source:null,mode:'ORIGINAL_TERMINAL',capability:capability??null});
 if(mode==='terminal'){
  check(moduleFile===undefined&&expectedSha256===undefined,'TERMINAL_APPROVAL_MODULE_NOT_APPLICABLE');return terminal();
 }
 if(config.buyerWorkspace===null){check(mode==='auto'&&moduleFile===undefined,'ORIGINAL_BUYER_WORKSPACE_REQUIRED',409);return terminal();}
 const originalRoot=dirname(config.runtimeDirectory),bridgePath=join(originalRoot,'sf81-buyer-operator-bridge','bridge.mjs');
 let bridgeSource;
 try{bridgeSource=await codeFile(bridgePath);}catch(error){
  if(error.code==='ENOENT'&&mode==='auto'&&moduleFile===undefined)return terminal({supported:false,code:'ORIGINAL_APPROVAL_BRIDGE_UNAVAILABLE'});throw error;
 }
 const bridge=await import(pathToFileURL(bridgeSource.path).href);
 check((await codeFile(bridgeSource.path)).sha256===bridgeSource.sha256,'REVIEWED_APPROVAL_BRIDGE_CHANGED',409);
 if(typeof bridge.probeOperatorApprovalCapabilities!=='function'){
  check(mode==='auto'&&moduleFile===undefined,'ORIGINAL_BROWSER_APPROVAL_CAPABILITY_REQUIRED',409);
  return terminal({supported:false,code:'OPERATOR_CAPABILITIES_UNSUPPORTED',bridge:bridgeSource});
 }
 const configSource=await codeFile(join(config.runtimeDirectory,'config.mjs'));
 const nativeConfig=await import(pathToFileURL(configSource.path).href);
 const operatorFile=join(config.buyerWorkspace,'operator.json');
 const originalBytes=await readBytes(operatorFile,1048576),originalSha256=digest(originalBytes);
 const selected=await nativeConfig.config(operatorFile);
 check(digest(await readBytes(operatorFile,1048576))===originalSha256&&
  (await codeFile(configSource.path)).sha256===configSource.sha256,'ORIGINAL_OPERATOR_CONFIGURATION_CHANGED',409);
 const capability=await bridge.probeOperatorApprovalCapabilities(selected.operator,{timeoutMs:3000});
 check(capability&&typeof capability.supported==='boolean','ORIGINAL_APPROVAL_CAPABILITY_INVALID',409);
 if(!capability.supported){
  check(mode==='auto'&&moduleFile===undefined,'ORIGINAL_BROWSER_APPROVAL_UNAVAILABLE',409);
  return terminal({...capability,bridge:bridgeSource,operatorFile,operatorSha256:originalSha256});
 }
 const source=await codeFile(moduleFile??join(originalRoot,'sf81-buyer-operator-bridge','browser-approval.mjs'));
 check(expectedSha256===undefined||source.sha256===expectedSha256,'REVIEWED_APPROVAL_MODULE_CHANGED',409);
 const original=await import(pathToFileURL(source.path).href);
 check((await codeFile(source.path)).sha256===source.sha256,'REVIEWED_APPROVAL_MODULE_CHANGED',409);
 check(typeof original.createBrowserApprovalBroker==='function','ORIGINAL_BROWSER_APPROVAL_EXPORT_REQUIRED',409);
 const broker=await original.createBrowserApprovalBroker({});
 try{
  check(broker&&typeof broker.snapshot==='function'&&typeof broker.decide==='function'&&
   typeof broker.revoke==='function'&&typeof broker.close==='function'&&broker.environment&&
   typeof broker.environment.SF81_APPROVAL_SOCKET==='string'&&typeof broker.environment.SF81_APPROVAL_TOKEN==='string',
   'ORIGINAL_BROWSER_APPROVAL_CONTRACT_CHANGED',409);
 }catch(error){await Promise.resolve(broker?.close?.()).catch(()=>{});throw error;}
 return {broker,source,mode:'ORIGINAL_BROWSER_BROKER',
  capability:{...capability,bridge:bridgeSource,operatorFile,operatorSha256:originalSha256}};
}

/** The original broker is created before Buyer/NativeRuntime captures its environment. */
export async function serveConfiguredWorkspace({configFile,port=0,environment=process.env,
 expectedConfigSha256,expectedWorkspaceSha256,approvalMode='auto',approvalModule,expectedApprovalSha256}={}){
 configFile=absolute(configFile);const raw=await readBytes(configFile,65536),configSha256=digest(raw),config=compileConfig(parseJson(raw));
 check(expectedConfigSha256===undefined||HASH.test(expectedConfigSha256)&&expectedConfigSha256===configSha256,'REVIEWED_CONFIGURATION_CHANGED',409);
 check(expectedWorkspaceSha256===undefined||expectedWorkspaceSha256==='new'||HASH.test(expectedWorkspaceSha256),'INVALID_EXPECTED_WORKSPACE_SHA256');
 await privateDirectory(config.directory);
 let model,app,approval,launch,closingPromise;
 const recordFile=join(config.directory,'api-pass-workspace-launch.json');
 try{
  approval=await originalApprovals(config,{mode:approvalMode,moduleFile:approvalModule,expectedSha256:expectedApprovalSha256});
  model=await openApiPassWorkspace({config,environment,approvals:approval.broker,expectedWorkspaceSha256});
  check(digest(await readBytes(configFile,65536))===configSha256,'REVIEWED_CONFIGURATION_CHANGED',409);
  app=await startApiPassWorkspace({model,port});
  const source=await codeFile(ENTRY);
  launch={schema:LAUNCH_SCHEMA,status:'LISTENING',instanceId:randomUUID(),workspaceId:model.state.id,
   directory:config.directory,configFile,configSha256,expectedWorkspaceSha256:expectedWorkspaceSha256??null,
   processId:process.pid,startedAt:now(),url:app.url,
   source:{entry:source.path,sha256:source.sha256,runtimeDirectory:config.runtimeDirectory},
   approval:{mode:approval.mode,module:approval.source?.path??null,sha256:approval.source?.sha256??null,capability:approval.capability??null}};
  await writeJson(recordFile,launch);
  const close=()=>{
   if(closingPromise)return closingPromise;
   closingPromise=(async()=>{
    // Publish STOPPING while the original state lease is still held. A later
    // process may publish its own launch only after this model drains/releases.
    try{await writeJson(recordFile,{...launch,status:'STOPPING',stoppingAt:now()});}
    finally{await app.close();}
   })();return closingPromise;
  };
  return {...app,close,launch,launchFile:recordFile};
 }catch(error){
  if(app)await app.close().catch(()=>{});else if(model)await model.close().catch(()=>{});
  else if(approval?.broker)await Promise.resolve(approval.broker.close()).catch(()=>{});
  throw error;
 }
}

export async function main(argv=process.argv.slice(2)){
 const {command,values}=argumentsOf([...argv]);
 if(command==='help'){process.stdout.write(HELP+'\n');return;}
 if(command==='configure'){
  only(values,['directory','out','runtime','buyer-state','inbox','buyer-workspace','claim-env','python','title']);
  const input={schema:CONFIG_SCHEMA,directory:absolute(selected(values,'directory'))};
  for(const [flag,key]of [['runtime','runtimeDirectory'],['buyer-state','buyerStateDirectory'],['inbox','inboxDirectory'],
   ['buyer-workspace','buyerWorkspace'],['python','python'],['title','title']])
   if(values.has(flag))input[key]=selected(values,flag);
  if(values.has('claim-env'))input.claimEnvs=values.get('claim-env');
  const config=compileConfig(input),out=absolute(selected(values,'out'));
  await privateDirectory(dirname(out));await writeJson(out,config,{exclusive:true});
  const raw=await readBytes(out,65536);process.stdout.write(JSON.stringify({schema:CONFIG_SCHEMA,file:out,sha256:digest(raw),directory:config.directory})+'\n');return;
 }
 check(command==='serve','WORKSPACE_COMMAND_REQUIRED');
 only(values,['config','port','approval-mode','approval-module','expected-config-sha256','expected-workspace-sha256','expected-approval-sha256']);
 const port=Number(selected(values,'port','0'));check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT');
 const app=await serveConfiguredWorkspace({configFile:selected(values,'config'),port,
  expectedConfigSha256:selected(values,'expected-config-sha256'),expectedWorkspaceSha256:selected(values,'expected-workspace-sha256'),
  approvalMode:selected(values,'approval-mode','auto'),approvalModule:selected(values,'approval-module'),
  expectedApprovalSha256:selected(values,'expected-approval-sha256')});
 process.stdout.write(JSON.stringify({schema:LAUNCH_SCHEMA,status:'LISTENING',workspaceId:app.workspaceId,
  launchFile:app.launchFile,url:app.url,processId:process.pid,instanceId:app.launch.instanceId})+'\n');
 let stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;app.close().catch(error=>{
  process.stderr.write(JSON.stringify({error:error.code??'WORKSPACE_SHUTDOWN_FAILED'})+'\n');process.exitCode=1;
 });};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await new Promise(resolve=>app.server.once('close',resolve));
 await app.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:typeof error?.code==='string'?error.code:'API_PASS_WORKSPACE_FAILED'})+'\n');process.exitCode=1;});
