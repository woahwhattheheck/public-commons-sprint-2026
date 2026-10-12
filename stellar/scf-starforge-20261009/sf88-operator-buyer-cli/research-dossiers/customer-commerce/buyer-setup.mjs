// MIT. Configure Research through the original Buyer workspace, operator and agent.
import {mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs,isDeepStrictEqual as same} from 'node:util';
import {pathToFileURL} from 'node:url';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {writeBytes,syncDirectory} from '../../node/store.mjs';
import {startRunbookWorkspace} from '../../../buyer-runbook/workspace.mjs';
import {inspectRunbookWorkspaceSelection,matchRunbookWorkspaceLaunch} from '../../../buyer-runbook/launch.mjs';
import {readBuyerOperatorPreset,validateBuyerOperatorPreset} from '../../../buyer-runbook/handoff-intake.mjs';
import {openWorkspace as readOriginalOperator} from '../../workspace.mjs';
import {BuyerRunbookAgent} from '../../../buyer-runbook/agent-client.mjs';
import {readBuyerAgentConfiguration,readPrivate,parse,hash,encode,
 privateDirectory} from '../../../buyer-runbook/agent-connection.mjs';
import {readCommerceConfiguration,commerceConfigurationView,selectedBuyer} from './configuration.mjs';
import {retainCustomerBytes} from './files.mjs';

export const RESEARCH_BUYER_SETUP_SCHEMA='sf88-research-buyer-setup/v1';
export const RESEARCH_BUYER_SETUP_COMMANDS=Object.freeze(['commerce-buyer-serve','commerce-buyer-attach','commerce-buyer-status']);
const RECORD='sf88-research-buyer-setup-record/v1',HOST='sf88-research-customer-commerce-host/v1';
const AGENT='stellar-forge.buyer-runbook.agent-connections.v1';
const ENV=/^[A-Z][A-Z0-9_]{1,64}$/,ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),stamp=()=>new Date().toISOString();
const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const fields=(value,allowed,required=[])=>need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&
 required.every(k=>Object.hasOwn(value,k)),'RESEARCH_BUYER_SETUP_FIELDS');
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
 Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>hash(JSON.stringify(canonical(value)));
const code=error=>/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'RESEARCH_BUYER_SETUP_FAILED';
function absolute(value){
 need(typeof value==='string'&&value===resolve(value)&&isAbsolute(value)&&value!=='/'&&!/[\0\r\n]/.test(value),
  'RESEARCH_BUYER_SETUP_ABSOLUTE_PATH');return value;
}
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function directory(path){
 absolute(path);await privateDirectory(dirname(path));
 try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}catch(error){if(error.code!=='EEXIST')throw error;}
 await privateDirectory(path);return path;
}
async function record(root,name){try{return parse(await readPrivate(join(root,name),2*1024*1024));}
 catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function retain(root,name,value){
 const bytes=value instanceof Uint8Array?Buffer.from(value):encode(value);
 try{return await retainCustomerBytes(root,name,bytes);}
 catch(error){
  // A directory fsync may fail after the original exclusive publication. Read the
  // named original bytes before admitting another action; failed reads stay failed.
  let saved;try{saved=await readPrivate(join(root,name),Math.max(1,bytes.length));}catch{throw error;}
  if(!saved.equals(bytes))throw error;
  return {path:join(root,name),name,bytes:bytes.length,sha256:hash(bytes)};
 }
}
async function replace(root,name,value,lease){
 lease.assertHeld();const bytes=encode(value);
 try{await writeBytes(join(root,name),bytes);}
 catch(error){let saved;try{saved=await readPrivate(join(root,name),bytes.length);}catch{throw error;}
  if(!saved.equals(bytes))throw error;}
 lease.assertHeld();
 const saved=await readPrivate(join(root,name),bytes.length);need(saved.equals(bytes),'RESEARCH_BUYER_SETUP_RECORD_CHANGED');
 return {path:join(root,name),name,bytes:bytes.length,sha256:hash(bytes)};
}
function requestId(requestSha256,action){
 const a=createHash('sha256').update(requestSha256+'\0'+action).digest().subarray(0,16);
 a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=a.toString('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function validate(input,mode){
 fields(input,['schema','buyer','label','operatorSettings','operator','operators','paidFileClaimEnvs','commerceConfigurationFile',
  'replaceBuyer','maximumFileBytes','maximumExportBytes','maximumExports','port','approvalMode','launchFile'],
  ['schema','buyer','operators']);
 need(input.schema===RESEARCH_BUYER_SETUP_SCHEMA&&ALIAS.test(input.buyer),'RESEARCH_BUYER_SETUP_SCHEMA');
 need((input.operatorSettings!==undefined)!==(input.operator!==undefined),'RESEARCH_BUYER_SETUP_SELECT_OPERATOR_SOURCE');
 if(input.operatorSettings!==undefined)absolute(input.operatorSettings);
 need(input.label===undefined||typeof input.label==='string'&&input.label.length>=1&&input.label.length<=160&&
  !/[\0\r\n]/.test(input.label),'RESEARCH_BUYER_SETUP_LABEL');
 need(plain(input.operators)&&Object.keys(input.operators).length>=1&&Object.keys(input.operators).length<=32&&
  Object.keys(input.operators).every(x=>ALIAS.test(x)),'RESEARCH_BUYER_SETUP_OPERATORS');
 for(const value of Object.values(input.operators))absolute(value);
 if(input.operator!==undefined)need(ALIAS.test(input.operator)&&Object.hasOwn(input.operators,input.operator),
  'RESEARCH_BUYER_SETUP_OPERATOR_NOT_DECLARED');
 if(input.commerceConfigurationFile!==undefined)absolute(input.commerceConfigurationFile);
 need(input.replaceBuyer===undefined||typeof input.replaceBuyer==='boolean','RESEARCH_BUYER_SETUP_REPLACEMENT');
 for(const [key,min,max]of [['maximumFileBytes',32*1024*1024,8*1024*1024*1024],
  ['maximumExportBytes',32*1024*1024,32*1024*1024*1024],['maximumExports',1,10000]])
  need(input[key]===undefined||Number.isSafeInteger(input[key])&&input[key]>=min&&input[key]<=max,'RESEARCH_BUYER_SETUP_EXPORT_LIMIT');
 if(mode==='serve'){
  need(input.launchFile===undefined,'RESEARCH_BUYER_SETUP_SELECT_ONE_OWNER');
  need(Array.isArray(input.paidFileClaimEnvs)&&input.paidFileClaimEnvs.length>=1&&input.paidFileClaimEnvs.length<=32&&
   new Set(input.paidFileClaimEnvs).size===input.paidFileClaimEnvs.length&&input.paidFileClaimEnvs.every(x=>ENV.test(x)),
   'RESEARCH_BUYER_SETUP_CLAIM_NAMES');
  need(input.port===undefined||Number.isInteger(input.port)&&input.port>=0&&input.port<=65535,'RESEARCH_BUYER_SETUP_PORT');
  need(input.approvalMode===undefined||['BROWSER','TERMINAL'].includes(input.approvalMode),'RESEARCH_BUYER_SETUP_APPROVAL_MODE');
 }else{
  absolute(input.launchFile);
  need(input.port===undefined&&input.approvalMode===undefined&&input.paidFileClaimEnvs===undefined,
   'RESEARCH_BUYER_SETUP_EXISTING_LAUNCH');
 }
 return structuredClone(input);
}
/** Derive a preset from the original read-only SF88 workspace; never read journal keys. */
export async function deriveResearchBuyerOperator(operatorDirectory){
 absolute(operatorDirectory);await privateDirectory(operatorDirectory);
 const names=['workspace.json','operator.json','policy.json'],before={};
 for(const name of names)before[name]=await readPrivate(join(operatorDirectory,name),131072);
 const native=await readOriginalOperator(['--dir',operatorDirectory],{execute:false,accounting:false});
 for(const name of names)need((await readPrivate(join(operatorDirectory,name),131072)).equals(before[name]),
  'RESEARCH_BUYER_SETUP_ORIGINAL_OPERATOR_CHANGED');
 const policy=parse(before['policy.json']),terms=native.config.operation.expect;
 need(policy.schema==='stellar-spend-governor/v1'&&Array.isArray(policy.assets),'RESEARCH_BUYER_SETUP_POLICY_INVALID');
 const assets=policy.assets.filter(x=>x.network===terms.network&&x.asset===terms.asset);
 need(assets.length===1,'RESEARCH_BUYER_SETUP_POLICY_ASSET');
 const row=assets[0],limits=['max_total','max_per_utc_day','max_per_actor_utc_day','max_per_service_utc_day'];
 for(const key of limits)need(typeof row[key]==='string'&&/^[1-9][0-9]{0,18}$/.test(row[key])&&
  BigInt(row[key])<=9223372036854775807n,'RESEARCH_BUYER_SETUP_POLICY_LIMIT');
 const daily=limits.slice(1).reduce((a,key)=>BigInt(row[key])<a?BigInt(row[key]):a,BigInt(row.max_total));
 const signer=native.manifest.signer,transport=native.manifest.buyerTransport??null;
 need(transport===null||transport.mode==='explicit-connect'&&typeof transport.proxyEnv==='string'&&transport.proxyUrl===undefined,
  'RESEARCH_BUYER_SETUP_PROXY_ENVIRONMENT_REQUIRED');
 const value={schema:'stellar-forge.buyer-runbook-operator.v1',actor:native.config.operator.actor,
  service:native.config.operator.service,payer:native.manifest.payer,python:native.config.operator.python,
  maxTotalAtomic:row.max_total,maxDailyAtomic:daily.toString(),
  ...(signer.signerProvider?{signerProvider:signer.signerProvider}:{secretEnv:signer.secretEnv??'STELLAR_SECRET'}),
  ...(signer.rpcUrl?{rpc:signer.rpcUrl}:{}),...(transport?{httpsProxyEnv:transport.proxyEnv}:{})};
 validateBuyerOperatorPreset(value,{directory:operatorDirectory});
 return {value,source:{mode:'ORIGINAL_SF88_READ_ONLY_WORKSPACE',directory:operatorDirectory,
  files:names.map(name=>({name,sha256:hash(before[name]),bytes:before[name].length})),
  network:terms.network,asset:terms.asset,payer:native.manifest.payer,
  policyLimits:{maxTotalAtomic:row.max_total,maxDailyAtomic:daily.toString()}}};
}
async function originalInputs(root,input,request){
 const presetPath=join(root,'operator-settings.json');
 if(!await exists(presetPath)){
  let selected,source;
  if(input.operatorSettings!==undefined){
   const checked=await readPrivate(input.operatorSettings,16384);
   selected=await readBuyerOperatorPreset(input.operatorSettings,{directory:root});
   need(selected.raw.equals(checked),'RESEARCH_BUYER_SETUP_PRESET_CHANGED');
   source={mode:'ORIGINAL_PRESET_FILE',path:input.operatorSettings};
  }else{
   const original=await deriveResearchBuyerOperator(input.operators[input.operator]),raw=encode(original.value);
   selected={value:original.value,raw,sha256:hash(raw)};source=original.source;
  }
  await retain(root,'operator-source.json',{...source,sha256:selected.sha256,bytes:selected.raw.length});
  await retain(root,'operator-settings.json',selected.raw);
 }
 await readPrivate(presetPath,16384);
 const preset=await readBuyerOperatorPreset(presetPath,{directory:root}),original=await record(root,'operator-source.json');
 need(original&&preset.sha256===original.sha256&&preset.raw.length===original.bytes,'RESEARCH_BUYER_SETUP_PRESET_CHANGED');
 const operators={};
 for(const [alias,path]of Object.entries(input.operators)){
  await privateDirectory(path);const info=await lstat(path);
  operators[alias]={path,device:String(info.dev),inode:String(info.ino)};
 }
 const prior=await record(root,'operators.json');
 if(prior)need(same(prior,operators),'RESEARCH_BUYER_SETUP_OPERATOR_DIRECTORY_CHANGED');
 else await retain(root,'operators.json',operators);
 let base=await record(root,'commerce-base.json');
 if(!base){
  if(input.commerceConfigurationFile){
   const bytes=await readPrivate(input.commerceConfigurationFile,2*1024*1024),raw=parse(bytes);
   // Resolve old relative paths before writing the complete derived host beside
   // this operation. Other merchant and buyer aliases keep their original owners.
   await readCommerceConfiguration(input.commerceConfigurationFile);
   base={schema:HOST,merchants:{},buyers:{}};
   for(const [name,value]of Object.entries(raw.merchants??{}))
    base.merchants[name]={...value,checkoutFile:resolve(dirname(input.commerceConfigurationFile),value.checkoutFile)};
   for(const [name,value]of Object.entries(raw.buyers??{}))
    base.buyers[name]={...value,agentFile:resolve(dirname(input.commerceConfigurationFile),value.agentFile)};
   await retain(root,'commerce-source.json',{path:input.commerceConfigurationFile,bytes:bytes.length,sha256:hash(bytes)});
   await retain(root,'commerce-source-original.json',bytes);
  }else base={schema:HOST,merchants:{},buyers:{}};
  await retain(root,'commerce-base.json',base);
 }
 need(base.schema===HOST&&plain(base.merchants)&&plain(base.buyers),'RESEARCH_BUYER_SETUP_COMMERCE_CHANGED');
 return {preset,base,operators,request};
}
async function leaseRoot(root,inputFile,mode){
 absolute(root);await directory(root);let lease;
 try{lease=await acquireStateLease(root);}catch(error){throw Object.assign(error,{code:'RESEARCH_BUYER_SETUP_OWNED'});}
 try{
  let request=await record(root,'request.json');
  if(request){
   need(request.schema===RECORD&&request.mode===mode&&request.directory===root&&request.requestSha256===digest(request.input),
    'RESEARCH_BUYER_SETUP_REQUEST_CHANGED');
   if(inputFile){const input=parse(await readPrivate(absolute(inputFile),65536));
    need(digest(input)===request.requestSha256,'RESEARCH_BUYER_SETUP_REQUEST_CHANGED');}
  }else{
   need(inputFile,'RESEARCH_BUYER_SETUP_INPUT_REQUIRED');
   const input=validate(parse(await readPrivate(absolute(inputFile),65536)),mode);
   const allowed=/^(\.write-[a-f0-9-]{36}|lease\.lock)$/;
   need((await readdir(root)).every(x=>allowed.test(x)),'RESEARCH_BUYER_SETUP_DIRECTORY_IN_USE');
   request={schema:RECORD,directory:root,mode,input,requestSha256:digest(input)};
   await retain(root,'request.json',request);
  }
  validate(request.input,mode);lease.assertHeld();
  return {root,lease,request,...await originalInputs(root,request.input,request)};
 }catch(error){try{await lease.close();}catch(cleanup){
   Object.defineProperty(error,'close',{value:()=>Promise.reject(cleanup),configurable:true});
   error.closeCode=code(cleanup);
  }throw error;}
}
async function checkedSelection(launch){
 matchRunbookWorkspaceLaunch(launch,launch);
 need(hash(JSON.stringify({selection:launch.selection,sourceFiles:launch.sourceFiles}))===launch.selectionSha256,
  'RESEARCH_BUYER_SETUP_LAUNCH_CHANGED');
 const selected=await inspectRunbookWorkspaceSelection({directory:launch.directory,
  configsDirectory:launch.selection.configsDirectory,operatorSettings:launch.selection.operatorSettings??undefined,
  paidFileClaimEnvs:launch.selection.paidFileClaimEnvs??undefined,runs:launch.selection.initialRuns,
  approvalMode:launch.approvalMode});
 need(selected.selectionSha256===launch.selectionSha256&&same(selected.selection,launch.selection)&&
  same(selected.sourceFiles,launch.sourceFiles),'RESEARCH_BUYER_SETUP_SELECTED_SOURCE_CHANGED');
 return selected;
}
async function bindSetup(context,launch,launchFile,{signal}={}){
 const {root,lease,request,preset,base}=context,input=request.input;
 signal?.throwIfAborted();lease.assertHeld();await checkedSelection(launch);
 if(request.mode==='attach')need(launch.selection.effectiveOperatorSettings,
  'RESEARCH_BUYER_SETUP_EXISTING_OPERATOR_REQUIRED');
 await directory(join(root,'agent-files'));
 const definition={label:input.label??input.buyer,directory:launch.directory,launchFile,
  expectedSelectionSha256:launch.selectionSha256,storageDirectory:join(root,'agent-files'),
  files:{operator_settings:{path:join(root,'operator-settings.json'),kind:'settings',sha256:preset.sha256}},
  operators:structuredClone(input.operators),
  maximumFileBytes:input.maximumFileBytes??256*1024*1024,
  maximumExportBytes:input.maximumExportBytes??1024*1024*1024,maximumExports:input.maximumExports??128};
 const connection={schema:AGENT,workspaces:{[input.buyer]:definition}},connectionFile=join(root,'agent-connections.json');
 await retain(root,'selection.json',{selection:launch.selection,selectionSha256:launch.selectionSha256,sourceFiles:launch.sourceFiles});
 await retain(root,'agent-connections.json',connection);
 const normalized=await readBuyerAgentConfiguration(connectionFile);
 const agent=new BuyerRunbookAgent(normalized);context.agent=agent;
 const opened=await agent.call('open',{workspace:input.buyer},{signal});
 need(opened.connection.instanceId===launch.instanceId&&opened.connection.pid===launch.pid&&
  opened.connection.selectionSha256===launch.selectionSha256,'RESEARCH_BUYER_SETUP_LISTENER_CHANGED');
 const adoptionFile='operator-adoption.json';
 let operator=(await agent.call('operator',{workspace:input.buyer},{signal})).native;
 const saved=await record(root,adoptionFile);
 need(operator.configured&&operator.settingsSha256===preset.sha256&&same(operator.settings,preset.value),
  'RESEARCH_BUYER_SETUP_OPERATOR_DIFFERENT');
 if(saved){
  need(saved.requestSha256===request.requestSha256&&saved.settingsSha256===preset.sha256,
   'RESEARCH_BUYER_SETUP_ADOPTION_CHANGED');
  if(saved.revision){
   const retained=(await agent.call('operator_revision',{workspace:input.buyer,id:saved.revision},{signal})).native;
   need(retained.settingsSha256===preset.sha256,'RESEARCH_BUYER_SETUP_ADOPTION_CHANGED');
  }
 }else{
  let save=await record(root,'operator-save.json');
  if(save||operator.mode!=='WORKSPACE'){
   if(!save){
    let proposal=await record(root,'operator-proposal.json');
    if(!proposal){
     proposal={workspace:input.buyer,settings:'operator_settings',expectedSettingsSha256:preset.sha256,
      expectedStateSha256:operator.stateSha256,note:'Adopt the original operator settings for Research receiving'};
     await retain(root,'operator-proposal.json',proposal);
    }
    const review=await agent.call('operator_review',proposal,{signal});
    save={...proposal,requestId:requestId(request.requestSha256,'operator-save'),
     expectedReviewSha256:review.native.reviewSha256};
    await retain(root,'operator-save.json',save);
   }
   operator=(await agent.call('operator_save',save,{signal})).native;
   need(operator.settingsSha256===preset.sha256&&same(operator.settings,preset.value),
    'RESEARCH_BUYER_SETUP_ADOPTION_CHANGED');
  }
  await retain(root,adoptionFile,{requestSha256:request.requestSha256,settingsSha256:preset.sha256,
   revision:operator.revision,revisionNumber:operator.revisionNumber});
 }
 const buyer={label:input.label??input.buyer,agentFile:connectionFile,workspace:input.buyer};
 need(!Object.hasOwn(base.buyers,input.buyer)||same(base.buyers[input.buyer],buyer)||input.replaceBuyer===true,
  'RESEARCH_BUYER_SETUP_BUYER_ALIAS_EXISTS');
 const commerce={...base,buyers:{...base.buyers,[input.buyer]:buyer}};
 await retain(root,'research-commerce.json',commerce);
 const configured=await readCommerceConfiguration(join(root,'research-commerce.json'));
 const selected=(await selectedBuyer(configured,input.buyer)).binding;
 need(selected.agentFile===connectionFile&&selected.workspace===input.buyer&&
  selected.expectedSelectionSha256===launch.selectionSha256,'RESEARCH_BUYER_SETUP_RESEARCH_BINDING_CHANGED');
 const view=await commerceConfigurationView(configured),final=await agent.call('open',{workspace:input.buyer},{signal});
 need(final.connection.instanceId===launch.instanceId&&final.connection.launchSha256===opened.connection.launchSha256,
  'RESEARCH_BUYER_SETUP_LISTENER_CHANGED');
 lease.assertHeld();
 return {schema:RECORD,directory:root,mode:request.mode,requestSha256:request.requestSha256,
  state:'READY',buyer:input.buyer,agentFile:connectionFile,commerceHostFile:join(root,'research-commerce.json'),
  launchFile,directoryBuyer:launch.directory,selectionSha256:launch.selectionSha256,
  instanceId:launch.instanceId,pid:launch.pid,url:launch.url,approvalMode:launch.approvalMode,
  approvalAvailable:launch.approvalAvailable,operator:{revision:operator.revision,settingsSha256:operator.settingsSha256,
   availability:operator.availability},configuration:view,completedAt:stamp()};
}
function owner(context){
 let active,done=false,agentClosed=false,appClosed=false,leasePromise,leaseRetired=false;
 const close=()=>{
  if(done)return Promise.resolve();
  if(active)return active;
  active=(async()=>{
   if(!agentClosed){await context.agent?.close();agentClosed=true;}
   if(!appClosed){await context.app?.close();appClosed=true;}
   if(!leaseRetired){
    if(!leasePromise){
     context.lease.assertHeld();
     const current=await record(context.root,'service.json');
     need(!current||current.requestSha256===context.request.requestSha256,'RESEARCH_BUYER_SETUP_RECORD_CHANGED');
     await replace(context.root,'service.json',{...current,schema:RECORD,requestSha256:context.request.requestSha256,
      mode:context.request.mode,state:context.request.mode==='attach'&&current?.state==='READY'?'ATTACHED':'STOPPED',
      setupClosedAt:stamp()},context.lease);
     // This original raw lease has a one-shot close; preserve its actual promise.
     leasePromise=Promise.resolve().then(()=>context.lease.close());
    }
    await leasePromise;leaseRetired=true;
   }
   done=true;
  })().catch(error=>{
   error.closeCode=code(error);
   Object.defineProperty(error,'close',{value:close,configurable:true});
   throw error;
  }).finally(()=>{active=null;});
  return active;
 };
 return {close,get retired(){return done;}};
}
async function start({directory:root,inputFile,mode,signal}){
 need(signal===undefined||signal instanceof AbortSignal,'RESEARCH_BUYER_SETUP_SIGNAL');
 signal?.throwIfAborted();
 const context=await leaseRoot(root,inputFile,mode),lifetime=owner(context);
 try{
  const input=context.request.input;
  await replace(root,'service.json',{schema:RECORD,requestSha256:context.request.requestSha256,
   mode,state:'STARTING',pid:process.pid,startedAt:stamp()},context.lease);
  let launch,launchFile;
  if(mode==='serve'){
   const buyer=join(root,'buyer');await directory(buyer);
   const selected=await inspectRunbookWorkspaceSelection({directory:buyer,
    operatorSettings:join(root,'operator-settings.json'),paidFileClaimEnvs:input.paidFileClaimEnvs,
    approvalMode:input.approvalMode??'BROWSER'});
   await retain(root,'selection.json',selected.selection?{selection:selected.selection,
    selectionSha256:selected.selectionSha256,sourceFiles:selected.sourceFiles}:selected);
   signal?.throwIfAborted();context.lease.assertHeld();
   try{context.app=await startRunbookWorkspace({directory:buyer,operatorSettings:join(root,'operator-settings.json'),
    paidFileClaimEnvs:input.paidFileClaimEnvs,approvalMode:input.approvalMode??'BROWSER',
    port:input.port??0,expectedSelectionSha256:selected.selectionSha256,signal});}
   catch(error){if(typeof error.close==='function')context.app={close:error.close.bind(error)};throw error;}
   launch=context.app.launch;launchFile=join(root,'launch.json');
   await replace(root,'launch.json',launch,context.lease);
  }else{
   launchFile=input.launchFile;launch=parse(await readPrivate(launchFile,262144));
  }
  await checkedSelection(launch);
  await retain(root,'launch-'+launch.instanceId+'.json',launch);
  const announcement=await bindSetup(context,launch,launchFile,{signal});
  await replace(root,'service.json',announcement,context.lease);
  return {...announcement,announcement,close:lifetime.close};
 }catch(error){
  try{await lifetime.close();}
  catch(cleanup){error.closeCode=code(cleanup);Object.defineProperty(error,'close',{value:lifetime.close,configurable:true});}
  throw error;
 }
}
/** Serve the original foreground Buyer. Its close handle owns this setup's lease. */
export function serveResearchBuyerWorkspace(options={}){return start({...options,mode:'serve'});}
/** Attach an existing original Applications launch; its external owner keeps running. */
export async function attachResearchBuyerWorkspace(options={}){
 const app=await start({...options,mode:'attach'});
 try{return app.announcement;}finally{await app.close();}
}
/** Read the retained setup; live=true verifies this same current Buyer listener. */
export async function readResearchBuyerSetup({directory:root,live=false,signal}={}){
 absolute(root);await privateDirectory(root);
 const request=await record(root,'request.json'),service=await record(root,'service.json'),
  selection=await record(root,'selection.json'),adoption=await record(root,'operator-adoption.json');
 need(request?.schema===RECORD&&request.directory===root&&request.requestSha256===digest(request.input),
  'RESEARCH_BUYER_SETUP_REQUEST_CHANGED');
 need(service?.requestSha256===request.requestSha256,'RESEARCH_BUYER_SETUP_RECORD_CHANGED');
 const result={schema:RECORD,directory:root,requestSha256:request.requestSha256,mode:request.mode,
  buyer:request.input.buyer,state:service.state,service,selection,adoption,
  agentFile:join(root,'agent-connections.json'),commerceHostFile:join(root,'research-commerce.json')};
 if(live){
  const configuration=await readBuyerAgentConfiguration(result.agentFile),agent=new BuyerRunbookAgent(configuration);
  try{result.live={launch:await agent.call('open',{workspace:request.input.buyer},{signal}),
   operator:await agent.call('operator',{workspace:request.input.buyer},{signal})};}
  finally{await agent.close();}
 }
 return result;
}

export const RESEARCH_BUYER_SETUP_USAGE=String.raw`Research Buyer setup

Start the original Buyer application and generate its complete Research connection:
  commerce-buyer-serve --input /private/buyer-setup-input.json
      --run-directory /private/research-buyer
  commerce-buyer-serve --run-directory /private/research-buyer

Attach an existing original Applications launch:
  commerce-buyer-attach --input /private/buyer-attach-input.json
      --run-directory /private/research-buyer-attachment
  commerce-buyer-attach --run-directory /private/research-buyer-attachment

Read the saved setup and optionally verify its actual current listener:
  commerce-buyer-status --run-directory /private/research-buyer [--live]

The first input names an existing operator preset or one declared original SF88
operator from which to derive it, plus the original accounting operator aliases.
Serve also declares the existing paid-file claim environment names. Attach instead
names the actual original launchFile. This setup generates agent-connections.json
and research-commerce.json; pass the latter to the original Research server's
--customer-commerce-host. The full native launch and actual selection digest are
retained automatically. Same-directory reopens preserve the original files and
operator adoption. Serve remains in the foreground until its original Buyer drains.
Attach leaves the external Applications owner running. BUYER_SETUP.md has complete
input examples, original operator derivation and Research receiving commands.
`;
async function output(stream,value){
 await new Promise((accept,reject)=>{
  const fail=error=>{stream.off?.('error',fail);reject(error);};
  stream.once?.('error',fail);
  stream.write(value,error=>{
   // Node invokes a failed write callback before its corresponding error event.
   // Keep the once-listener until that event while the original owner drains.
   if(error){reject(error);return;}
   stream.off?.('error',fail);accept();
  });
 });
}
export async function mainResearchBuyerSetup(argv,{stdout=process.stdout,stderr=process.stderr}={}){
 const command=argv[0];
 need(RESEARCH_BUYER_SETUP_COMMANDS.includes(command),'RESEARCH_BUYER_SETUP_COMMAND');
 if(argv.includes('--help')){await output(stdout,RESEARCH_BUYER_SETUP_USAGE+'\n');return 0;}
 const status=command==='commerce-buyer-status',serve=command==='commerce-buyer-serve';
 const {values}=parseArgs({args:argv.slice(1),allowPositionals:false,strict:true,
  options:{'run-directory':{type:'string'},...(status?{live:{type:'boolean',default:false}}:{input:{type:'string'}})}});
 need(values['run-directory'],'RESEARCH_BUYER_SETUP_DIRECTORY_REQUIRED');
 const root=resolve(values['run-directory']),controller=new AbortController();
 let app,originalClose,closing,stopping=false,finished=false,primary,exitCode=0,resolveDone;
 const done=new Promise(resolve=>{resolveDone=resolve;});
 const keepAlive=setInterval(()=>{},1000);
 const publicError=async error=>{
  try{await output(stderr,JSON.stringify({error:code(error),directory:root,
   ...(typeof error.outcomeUnknown==='boolean'?{outcomeUnknown:error.outcomeUnknown}:{}),
   ...(error.closeCode?{closeError:error.closeCode}:{})})+'\n');}catch{}
 };
 const close=()=>{
  stopping=true;if(closing)return closing;
  closing=(async()=>{
   if(originalClose)await originalClose();
   finished=true;clearInterval(keepAlive);resolveDone();
  })().catch(async error=>{
   primary??=error;exitCode||=1;await publicError(error);
   // Preserve the same acquired owner and wait for a later explicit signal.
  }).finally(()=>{closing=null;});
  return closing;
 };
 const interrupt=signal=>{
  exitCode||=signal==='SIGINT'?130:143;stopping=true;
  if(!controller.signal.aborted)controller.abort(Object.assign(new Error('RESEARCH_BUYER_SETUP_INTERRUPTED'),
   {code:'RESEARCH_BUYER_SETUP_INTERRUPTED'}));
  if(originalClose)void close();
 };
 const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
 try{
  const options={directory:root,signal:controller.signal,
   ...(values.input?{inputFile:resolve(values.input)}:{})};
  if(status){app=await readResearchBuyerSetup({...options,live:values.live});await output(stdout,JSON.stringify(app,null,2)+'\n');await close();}
  else if(!serve){app=await attachResearchBuyerWorkspace(options);await output(stdout,JSON.stringify(app,null,2)+'\n');await close();}
  else{
   app=await serveResearchBuyerWorkspace(options);originalClose=app.close;
   if(stopping)await close();
   else await output(stdout,JSON.stringify(app.announcement)+'\n');
  }
 }catch(error){
  primary=error;exitCode||=1;
  if(!originalClose&&typeof error.close==='function')originalClose=error.close.bind(error);
  await publicError(error);await close();
 }
 // The original listener supplies its foreground lifetime; the small retained
 // timer also keeps a failed close owner available after its listener has stopped.
 await done;
 if(finished){process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
 return exitCode;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 process.exitCode=await mainResearchBuyerSetup(process.argv.slice(2));
