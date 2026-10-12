// MIT. Reuse the original reviewed Prescient native operation.
// One native client continuation on the existing reviewed Prescient workspace.
// Uses the original host/client/CLI/MCP; never starts a provider SDK or acquires data.
import {readFile,readdir,mkdir,open,rename,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runPrescientCommand} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/cli.mjs';
import {configurationDigest} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/configuration.mjs';
import {prepareStacManagedStartup,createStacManagedStartup} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/stac/managed.mjs';
import {StacWorkspaceClient,readStacWorkspaceConfiguration} from '../stac-workspace-client.mjs';
import {MerchantStacWorkspaces} from '../stac-workspace.mjs';
import {runStacWorkspaceCLI} from '../stac-workspace-cli.mjs';
const now=()=>new Date().toISOString(),clone=value=>structuredClone(value);
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});return value;};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function save(path,value){
 const tmp=path+'.new',fd=await open(tmp,'w',0o600);
 try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 await rename(tmp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
}
async function exactJSON(path,value){
 if(await exists(path))need(configurationDigest(await read(path))===configurationDigest(value),'RETAINED_CLIENT_INPUT_CHANGED');
 else await save(path,value);
}
async function originalReview(directory,native){
 const folder=join(directory,'operator','operator','versions');
 const names=(await readdir(folder)).filter(name=>/^\d{12}\.json$/.test(name)).sort();
 let before=null,first=null;
 for(const name of names){
  const state=await read(join(folder,name));
  if(Object.hasOwn(state.operations,'native-profile-review')){first=state;break;}
  before=state;
 }
 need(first&&before&&first.revision===before.revision+1,'ORIGINAL_PROFILE_REVIEW_PREIMAGE_REQUIRED');
 const record=first.operations['native-profile-review'];
 need(record.kind==='PROFILE_REVIEW'&&record.status==='COMPLETE'&&
  record.result.id===native.stages.profile_review.reviewId&&record.result.sha256===native.stages.profile_review.reviewSha256,
  'ORIGINAL_PROFILE_REVIEW_CHANGED');
 const body={profileSha256:record.result.profileSha256,actor:record.result.actor,
  operationId:'native-profile-review',expectedRevision:before.revision};
 need(configurationDigest({profileSha256:body.profileSha256,actor:body.actor})===record.inputSha256,'ORIGINAL_PROFILE_REVIEW_INPUT_CHANGED');
 return {body,result:record.result,preimageRevision:before.revision,completedRevision:first.revision};
}
export async function runPrescientClientContinuation(input){
 const directory=resolve(input.directory),privateDir=join(directory,'client-continuation');
 await mkdir(privateDir,{recursive:true,mode:0o700});
 const output=join(privateDir,'result.json'),native=await read(join(directory,'result.json'));
 need(native.stages.profile_review&&native.stages.receiver_review,'ORIGINAL_REVIEWED_WORKSPACES_REQUIRED');
 const expectedProfile=native.stages.initialized.profileSha256;
 need(configurationDigest(input.profile)===expectedProfile,'ORIGINAL_CLIENT_PROFILE_CHANGED');
 const result=await exists(output)?await read(output):{schema:'prescient-original-client-journey/v1',
  startedAt:now(),profileSha256:expectedProfile,stages:{},sourceRequests:0};
 need(result.profileSha256===expectedProfile,'ORIGINAL_CLIENT_CASE_CHANGED');
 if(result.status==='COMPLETE')return result;
 if(result.error){
  result.interruptions??=[];
  result.interruptions.push({observedAt:result.closedAt??result.startedAt,error:result.error,closeErrors:result.closeErrors??[]});
  delete result.error;
 }
 const checkpoint=()=>save(output,result),abort=new AbortController(),resources=new Set(),clients=new Set(),adapters=new Set();
 let active=null;
 const stop=()=>{abort.abort(new Error('Original client continuation interrupted'));for(const client of clients)client.close();for(const adapter of adapters)void adapter.close().catch(()=>{});};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const previousMask=process.umask(0o077);
 const startupFile=join(privateDir,'source-startup.json'),connectionFile=join(privateDir,'connection.json');
 async function launch(name){
  abort.signal.throwIfAborted();
  const deploymentFile=join(directory,'managed-deployment.json');await exactJSON(deploymentFile,input.deployment);
  const flags={workspace:join(directory,name),deployment:deploymentFile,port:'0','startup-json':true};
  const selection=await prepareStacManagedStartup({command:'prescient-serve',flags});
  abort.signal.throwIfAborted();
  const host=await runPrescientCommand({command:'prescient-serve',flags});resources.add(host);
  try{
   abort.signal.throwIfAborted();
   const startup=await createStacManagedStartup({selection,result:host.result});
   need(startup.status==='STAC_READY','ORIGINAL_MANAGED_HOST_NOT_READY');
   return {host,startup};
  }catch(error){await host.close();resources.delete(host);throw error;}
 }
 async function closeActive(){
  if(active){const value=active;await value.host.close();resources.delete(value.host);active=null;}
 }
 async function cli(argv){
  let stdout='',stderr='';
  const code=await runStacWorkspaceCLI(argv,{stdout:value=>{stdout+=value;},stderr:value=>{stderr+=value;}});
  need(code===0,'ORIGINAL_CLIENT_CLI_FAILED'+(stderr?':'+stderr.slice(0,500):''));
  return JSON.parse(stdout);
 }
 try{
  abort.signal.throwIfAborted();
  const original=await originalReview(directory,native);
  const args={workspace:'prescient',name:'profile-review',input:{profileSha256:original.body.profileSha256},
   actor:original.body.actor,operationId:original.body.operationId,expectedRevision:original.body.expectedRevision};
  await exactJSON(join(privateDir,'original-review-command.json'),args);
  active=await launch('operator');
  need(active.startup.workspaceId===native.stages.profile_review.workspaceId,'ORIGINAL_SENDER_WORKSPACE_CHANGED');
  await save(startupFile,active.startup);
  const connection={schema:'stellar-forge.stac-workspace-connection.v1',workspaces:{
   prescient:{label:'Original reviewed Prescient operation',consoleUrlFile:'./source-startup.json',
    inputs:{},processingProfiles:{},prescientDeliveries:input.customerDirectory?{original:{label:'Original selected customer directory',
     directory:input.customerDirectory}}:{}}
  }};
  await exactJSON(connectionFile,connection);
  const configuration=await readStacWorkspaceConfiguration(connectionFile);
  const client=new StacWorkspaceClient(configuration.workspaces.prescient);clients.add(client);
  const before=await client.prescientState({signal:abort.signal});
  need(before.connection.approved&&!before.connection.active,'UNEXPECTED_NATIVE_SDK_STATE');
  const portable=await client.prescientProfile(expectedProfile,{signal:abort.signal});
  need(configurationDigest(portable)===configurationDigest(await read(join(directory,'portable-profile.json'))),'ORIGINAL_PORTABLE_PROFILE_CHANGED');
  result.stages.node={at:now(),workspaceId:before.workspaceId,revision:before.configuration.revision,
   profileSha256:expectedProfile,portableProfileSha256:portable.sha256,sdkStarted:false};await checkpoint();

  let postCount=0,bodyMutationAttempted=false;
  const fetchImpl=async(url,options)=>{
   abort.signal.throwIfAborted();
   const parsed=new URL(url);
   need(parsed.protocol==='http:'&&['127.0.0.1','[::1]'].includes(parsed.hostname),'UNEXPECTED_EXTERNAL_CLIENT_REQUEST');
   const isReview=options.method==='POST'&&parsed.pathname==='/api/prescient/profiles/review';
   if(isReview){postCount++;need(configurationDigest(JSON.parse(options.body))===configurationDigest(original.body),'ORIGINAL_CLIENT_COMMAND_CHANGED');}
   const response=await fetch(url,options);
   if(isReview&&!result.stages.lostResponse&&response.ok){
    const observed=await response.json();need(configurationDigest(observed)===configurationDigest(original.result),'ORIGINAL_COMPLETION_CHANGED');
    result.stages.lostResponse={at:now(),operationId:args.operationId,httpStatus:response.status,
     originalBodySha256:configurationDigest(original.body),originalResultSha256:configurationDigest(observed),
     callerMutationAfterDispatch:bodyMutationAttempted};
    await checkpoint();throw new Error('Retained native response deliberately disconnected at the client boundary');
   }
   return response;
  };
  const adapter=new MerchantStacWorkspaces({stacWorkspaces:configuration,exportsDirectory:privateDir},{fetchImpl});adapters.add(adapter);
  const status=await adapter.call('merchant_stac_prescient_status',{workspace:'prescient'});
  need(status.configuration.revision===before.configuration.revision,'CONFIGURATION_REVISION_CHANGED_DURING_JOIN');
  const records=await adapter.call('merchant_stac_prescient_records',{workspace:'prescient',kind:'reviews',expectedRevision:before.configuration.revision,limit:100});
  need(records.items.some(row=>row.id===original.result.id),'ORIGINAL_REVIEW_MISSING_FROM_CLIENT');
  if(!result.stages.replay){
   let uncertain=null;
   if(!result.stages.lostResponse){
    const coldClient=new StacWorkspaceClient(configuration.workspaces.prescient,{fetchImpl});clients.add(coldClient);
    const callerBody=clone(original.body),pending=coldClient.prescientAction('profile-review',callerBody,{signal:abort.signal});
    callerBody.actor='Changed after dispatch';callerBody.operationId='must-not-dispatch-mutated-operation';
    callerBody.expectedRevision+=100;callerBody.profileSha256='0'.repeat(64);bodyMutationAttempted=true;
    try{await pending;}catch(error){uncertain={code:error.code,ambiguous:error.ambiguous,operationId:error.operationId};}
    need(uncertain?.ambiguous===true&&uncertain.operationId===args.operationId&&result.stages.lostResponse?.callerMutationAfterDispatch,
     'ORIGINAL_UNKNOWN_RESPONSE_OR_OWNED_BODY_NOT_PRESERVED');
   }
   const operation=await adapter.call('merchant_stac_operation',{workspace:'prescient',operationId:args.operationId});
   need(operation.prescient?.operation?.status==='COMPLETE'&&
    configurationDigest(operation.prescient.operation.result)===configurationDigest(original.result),'ORIGINAL_OPERATION_NOT_RECONCILED');
   const replay=await adapter.call('merchant_stac_prescient_action',args);
   need(configurationDigest(replay)===configurationDigest(original.result),'ORIGINAL_EXPLICIT_REPLAY_CHANGED');
   let directoryCode=null;const priorPosts=postCount;
   try{await adapter.call('merchant_stac_prescient_action',{...args,name:'delivery-review',input:{directory},operationId:'unused-direct-path'});}
   catch(error){directoryCode=error.code;}
   need(directoryCode==='STAC_MCP_INPUT_INVALID'&&postCount===priorPosts,'MCP_ACCEPTED_UNCONFIGURED_DIRECTORY');
   result.stages.replay={at:now(),operationId:args.operationId,originalBodySha256:configurationDigest(original.body),
    resultSha256:configurationDigest(replay),ambiguous:uncertain??{reconciledFromRetainedEvent:true},
    preimageRevision:original.preimageRevision,completionRevision:original.completedRevision,
    directoryCode,callerBodySnapshot:result.stages.lostResponse.callerMutationAfterDispatch,createdOperations:0};await checkpoint();
  }
  const cliOperation=await cli(['operation','--connection',connectionFile,'--operation-id',args.operationId]);
  need(configurationDigest(cliOperation.prescient.operation.result)===configurationDigest(original.result),'CLI_ORIGINAL_OPERATION_CHANGED');
  const downloaded=join(privateDir,'portable-profile.json');
  let file;
  if(await exists(downloaded)){
   const bytes=await readFile(downloaded);need(configurationDigest(JSON.parse(bytes))===configurationDigest(portable),'RETAINED_CLIENT_DOWNLOAD_CHANGED');
   file={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),reopened:true};
  }else file=await cli(['download','--connection',connectionFile,'--kind','prescient-profile','--profile-sha',expectedProfile,'--out',downloaded]);
  need(configurationDigest(await read(downloaded))===configurationDigest(portable),'CLI_PORTABLE_PROFILE_CHANGED');
  result.stages.cli={at:now(),operationId:args.operationId,downloadBytes:file.bytes,downloadSha256:file.sha256};await checkpoint();
  const after=await client.prescientState({signal:abort.signal});
  need(configurationDigest(after.configuration)===configurationDigest(before.configuration)&&!after.connection.active,'CLIENT_JOIN_CHANGED_SAVED_WORK_OR_STARTED_SDK');
  const oldInstance=active.startup.instanceId;
  await closeActive();active=await launch('operator');await save(startupFile,active.startup);
  const reopened=await client.prescientState({signal:abort.signal});
  need(active.startup.instanceId!==oldInstance&&reopened.workspaceId===before.workspaceId&&
   configurationDigest(reopened.configuration)===configurationDigest(before.configuration),'ORIGINAL_HOST_ROTATION_CHANGED_WORK');
  const sameAdapter=await adapter.call('merchant_stac_operation',{workspace:'prescient',operationId:args.operationId});
  need(configurationDigest(sameAdapter.prescient.operation.result)===configurationDigest(original.result),'ROTATED_CLIENT_LOST_NATIVE_RESULT');
  result.stages.reopen={at:now(),workspaceId:reopened.workspaceId,oldInstance,newInstance:active.startup.instanceId,
   savedConfigurationSha256:configurationDigest(reopened.configuration),sameClient:true,sameConnectionFile:true};await checkpoint();
  await closeActive();active=await launch('receiver');
  const receiver=new StacWorkspaceClient({url:active.startup,workspaceId:native.stages.receiver_review.workspaceId});clients.add(receiver);
  const received=await receiver.prescientState({signal:abort.signal});
  need(received.selectedProfile.bindingId===input.receiverBindingId&&received.connection.approved&&!received.connection.active,'ORIGINAL_RECEIVER_BINDING_CHANGED');
  const receivedProfile=await receiver.prescientProfile(received.selectedProfileSha256,{signal:abort.signal});
  need(configurationDigest(receivedProfile)===configurationDigest(portable),'RECEIVER_PORTABLE_PROFILE_CHANGED');
  result.stages.receiver={at:now(),workspaceId:received.workspaceId,profileSha256:received.selectedProfileSha256,
   bindingId:received.selectedProfile.bindingId,portableProfileSha256:receivedProfile.sha256,sdkStarted:false};
  result.status='COMPLETE';result.completedAt=now();await checkpoint();
 }catch(error){
  result.status='INCOMPLETE';result.error={code:error.code??'NATIVE_CLIENT_CONTINUATION_FAILED',message:String(error.message).slice(0,1200)};
  await checkpoint().catch(()=>{});throw error;
 }finally{
  for(const client of clients)client.close();
  const closed=await Promise.allSettled([...adapters].map(adapter=>adapter.close()));
  const hosts=await Promise.allSettled([...resources].map(host=>host.close()));
  result.closedAt=now();result.closeErrors=[...closed,...hosts].filter(row=>row.status==='rejected').map(row=>String(row.reason?.code??row.reason?.message??row.reason).slice(0,300));
  if(result.closeErrors.length)result.status='INCOMPLETE';
  try{await checkpoint();}finally{
   process.umask(previousMask);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
 }
 need(result.status==='COMPLETE','ORIGINAL_CLIENT_CLOSE_INCOMPLETE');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await runPrescientClientContinuation(await read(resolve(process.argv[2])));process.stdout.write(JSON.stringify(result)+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'NATIVE_CLIENT_CONTINUATION_FAILED',message:String(error.message).slice(0,1200)}})+'\n');process.exitCode=1;}
}
