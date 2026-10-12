// MIT. Applications composition for the original Safe buyer operator.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from
  '../../../distribution/runtime-workspace/application-provider.mjs';
import {absolute,need,object,intent} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {inspectSafeBuyerConfiguration} from './model.mjs';

const SOURCE='stellar/scf-starforge-20261009/partners/palmera-safe-review/operator/application-provider.mjs';
const STARTUP='stellar-forge.safe-buyer-workspace-startup.v1';
const HASH=/^[a-f0-9]{64}$/;
const COMMAND='safe-review-workspace';
const fields=[
  ['workspaceDirectory','Private Safe review workspace',true,
    'Original or new private operator workspace. Selections, saved reviews and handovers remain here.'],
  ['buyerRuntimeDirectory','Original SF88 buyer runtime',true,
    'Use the complete original sf88-operator-buyer-cli directory from the selected installed source.'],
  ['buyerStateDirectory','Original buyer state',true,
    'Reopen the same private original Buyer state directory to retain operation and payment identity.'],
  ['analysisDirectory','Original analysis workspace',true,
    'Use the same private Tenderly analysis workspace for received simulations and comparisons.'],
  ['operatorProfile','Original buyer operator profile',false,
    'Optional private original SF88 operator profile. The original Buyer requires its signer and payment policy to execute.'],
  ['captureModule','Original caller module',false,
    'Optional local module exporting loadTransaction({context,signal}) for the selected Safe or Palmera SDK instance.'],
];
function optionsFrom(settings) {
  return {directory:settings.workspaceDirectory,runtimeDirectory:settings.buyerRuntimeDirectory,
    stateDirectory:settings.buyerStateDirectory,analysisWorkspace:settings.analysisDirectory,
    ...(settings.operatorProfile?{operatorProfile:settings.operatorProfile}:{}),
    ...(settings.captureModule?{captureModule:settings.captureModule}:{})};
}
function selectedValue(request,name,optional=false) {
  need(Array.isArray(request.args),'APPLICATION_SAFE_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return null;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string',
    'APPLICATION_SAFE_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
function requestSelection(request) {
  const options={directory:absolute(selectedValue(request,'--directory')),
    runtimeDirectory:absolute(selectedValue(request,'--runtime')),
    stateDirectory:absolute(selectedValue(request,'--state')),
    analysisWorkspace:absolute(selectedValue(request,'--analysis'))};
  for(const [name,flag] of [['operatorProfile','--operator-profile'],['captureModule','--capture-module']]) {
    const file=selectedValue(request,flag,true);if(file!==null)options[name]=absolute(file);
  }
  const workspaceSha256=selectedValue(request,'--expected-workspace-sha256');
  const configurationSha256=selectedValue(request,'--expected-configuration-sha256');
  need((workspaceSha256==='new'||HASH.test(workspaceSha256))&&HASH.test(configurationSha256),
    'APPLICATION_SAFE_STARTUP_CHANGED');
  const creationId=selectedValue(request,'--workspace-creation-id');
  intent(creationId);
  return {options,workspaceSha256,configurationSha256,creationId};
}
function verifySelected(current,selection) {
  need(current.configurationSha256===selection.configurationSha256,'APPLICATION_SAFE_CONFIGURATION_CHANGED');
  if(selection.workspaceSha256==='new')
    need(!current.manifest||current.manifest.createdBy===selection.creationId,
      'APPLICATION_SAFE_WORKSPACE_CHANGED');
  else need(current.manifestSha256===selection.workspaceSha256,'APPLICATION_SAFE_WORKSPACE_CHANGED');
}
export async function prepareSafeBuyerApplication(settings,inputPath) {
  const options=optionsFrom(settings);
  const inputs=[
    await inputPath(options.directory,'directory',true,true),
    await inputPath(options.runtimeDirectory,'directory'),
    await inputPath(options.runtimeDirectory+'/cli.mjs','file'),
    await inputPath(options.stateDirectory,'directory',true,true),
    await inputPath(options.analysisWorkspace,'directory',true,true),
  ];
  for(const name of ['operatorProfile','captureModule'])
    if(options[name])inputs.push(await inputPath(options[name],'file'));
  const selected=await inspectSafeBuyerConfiguration(options);
  if(selected.manifest) {
    const file=await inputPath(selected.root+'/workspace.json','file');
    need(file.sha256===selected.manifestSha256,'APPLICATION_SAFE_WORKSPACE_CHANGED');
    inputs.push(file);
  }
  for(const name of ['operatorProfile','captureModule']) {
    const file=selected.configuration[name];
    if(file)need(inputs.some(input=>input.path===file.path&&input.sha256===file.sha256),
      'APPLICATION_SAFE_CONFIGURATION_CHANGED');
  }
  const args=['--directory',selected.root,'--runtime',selected.configuration.runtimeDirectory,
    '--state',selected.configuration.stateDirectory,'--analysis',selected.configuration.analysisWorkspace,
    '--expected-workspace-sha256',selected.manifestSha256??'new',
    '--expected-configuration-sha256',selected.configurationSha256];
  if(options.operatorProfile)args.push('--operator-profile',options.operatorProfile);
  if(options.captureModule)args.push('--capture-module',options.captureModule);
  return {args,inputs,createDirectories:[]};
}
export async function safeBuyerStartup(request,text) {
  if(request.command!==COMMAND||typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!object(value)||value.schema!==STARTUP||value.status!=='SAFE_BUYER_WORKSPACE_READY')return null;
  const selection=requestSelection(request),current=await inspectSafeBuyerConfiguration(selection.options);
  verifySelected(current,selection);
  need(current.manifest&&value.directory===current.root&&value.workspaceId===current.manifest.id&&
    value.workspaceSha256===current.manifestSha256&&value.configurationSha256===current.configurationSha256&&
    value.creationId===(current.manifest.createdBy??null),'APPLICATION_SAFE_STARTUP_CHANGED');
  const port=Number(selectedValue(request,'--port',true)??0);
  let url;try{url=new URL(value.safeBuyerWorkspace);}catch{need(false,'APPLICATION_SAFE_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&
    Number(url.port||80)>=1&&Number(url.port||80)<=65535&&!url.username&&!url.password&&
    !url.search&&url.pathname==='/'&&/^#token=[a-f0-9]{64}$/.test(url.hash)&&
    Number.isInteger(port)&&port>=0&&port<=65535&&(port===0||Number(url.port||80)===port),
    'APPLICATION_SAFE_STARTUP_CHANGED');
  return {url:url.href,workspaceId:current.manifest.id,original:{schema:STARTUP,directory:current.root,
    workspaceId:current.manifest.id,workspaceSha256:current.manifestSha256,
    configurationSha256:current.configurationSha256,creationId:current.manifest.createdBy??null}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'palmera-safe-review',order:1000,
  catalog({common,field}) {
    return [{id:'safe-review',command:COMMAND,title:'Safe simulation buyer',terminal:false,
      requiredSource:SOURCE,
      description:'Capture or receive an original Safe transaction, prepare and review its native simulation purchase, recover the same operation, compare results and receive a complete portable handover.',
      fields:[...fields.map(([name,label,required,description])=>field(name,label,'path',required,description)),...common]}];
  },
  prepare(type,settings,{inputPath}) {return prepareSafeBuyerApplication(settings,inputPath);},
  runArguments({command,args,requestId}) {
    need(command===COMMAND&&!args.includes('--workspace-creation-id'),'APPLICATION_SAFE_STARTUP_CHANGED');
    intent(requestId);return [...args,'--workspace-creation-id',requestId];
  },
  async verifyLaunch(request) {
    const selection=requestSelection(request);
    verifySelected(await inspectSafeBuyerConfiguration(selection.options),selection);
  },
  matchRequest(request) {return !request.pythonCommand&&request.command===COMMAND;},
  createObserver(request,directory) {
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP+'",'))return null;
      return ()=>safeBuyerStartup(request,text);
    });
  },
};
