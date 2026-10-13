// SPDX-License-Identifier: MIT
import {dirname} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {STARTUP_SCHEMA,need,readLaunchConfiguration,readConnection,PipelineDeliveryClient,hash,privateDirectory} from './connection.mjs';
import {managedOptions,inspectOriginalSource} from './managed.mjs';
import {inspectPipelineDeliveryRuntime} from './prepare.mjs';

async function originalSelection(v){
  const source=await inspectOriginalSource({directory:v.applicationDirectory,programmeDirectory:v.programmeDirectory});
  const runtime=await inspectPipelineDeliveryRuntime({runtimeReadyFile:v.runtimeReadyFile,applicationDirectory:v.applicationDirectory,python:v.python});
  need(runtime.programmeDirectory===v.programmeDirectory,'PIPELINE_DELIVERY_PROGRAMME_CHANGED','Select the complete original prepared operator programme.',409);
  return{source,runtime};
}
export default{
  schema:APPLICATION_PROVIDER_SCHEMA,id:'pipeline-delivery-workbench',order:1400,
  catalog({common,field}){
    return[{id:'pipeline-delivery-workbench',command:'pipeline-delivery-workbench-managed',title:'Pipeline Delivery Workbench',
      terminal:false,requiredSource:'products/pipeline-delivery-workbench/managed.mjs',
      description:'Operate full dbt project source, original Dagster runs, accountable review and complete client releases through the original Staff application.',
      fields:[field('configurationFile','Private pipeline delivery configuration','path',true,
        'Complete configuration selecting the prepared original source/runtime, workspace, Staff control directory and generated connection.'),...common]}];
  },
  validateSettings(_type,settings){managedOptions(['--configuration',settings.configurationFile]);},
  async prepare(_type,settings,{inputPath,selectedExecutable}){
    const{args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
    await path('configurationFile','file',false,true);
    const selected=await readLaunchConfiguration(settings.configurationFile),v=selected.value;
    option('--configuration',selected.path);option('--configuration-sha256',selected.sha256);
    for(const key of['directory','controlDirectory']){
      const directory=await inputPath(v[key],'directory',true,false);inputs.push(directory);
      if(!directory.exists)createDirectories.push(v[key]);
    }
    inputs.push(await inputPath(v.applicationDirectory,'directory',false,false),
      await inputPath(v.programmeDirectory,'directory',false,false),
      await inputPath(v.runtimeReadyFile,'file',false,true),
      await inputPath((await privateDirectory(dirname(v.connectionFile))).path,'directory',false,true));
    const python=await selectedExecutable(v.python);inputs.push(...python.inputs);
    need(python.executable===v.python,'PIPELINE_DELIVERY_RUNTIME_CHANGED','Preserve the selected virtual-environment invocation path.',409);
    await originalSelection(v);
    const keys=[['pipeline-delivery-workbench',v.directory],['pipeline-delivery-staff',v.controlDirectory],['pipeline-delivery-connection',v.connectionFile]]
      .map(([family,path])=>hash(JSON.stringify({family,path})));
    return{args,inputs,createDirectories,resourceKey:keys[0],resourceKeys:keys};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='pipeline-delivery-workbench-managed';},
  async verifyLaunch(request){
    const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration);
    need(selected.sha256===options.expectedConfigurationSha256,'PIPELINE_DELIVERY_CONFIGURATION_CHANGED','The reviewed original launch configuration changed.',409);
    await originalSelection(selected.value);
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
      return()=>readPipelineDeliveryStartup(request,text);
    });
  },
};
export async function readPipelineDeliveryStartup(request,text){
  if(request.command!=='pipeline-delivery-workbench-managed')return null;
  let line;try{line=JSON.parse(text);}catch{return null;}
  if(line.schema!==STARTUP_SCHEMA||line.status!=='PIPELINE_DELIVERY_WORKBENCH_READY')return null;
  const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(selected.sha256===options.expectedConfigurationSha256&&line.configurationFile===selected.path&&line.configurationSha256===selected.sha256&&
    ['directory','controlDirectory','applicationDirectory','programmeDirectory','connectionFile'].every(k=>line[k]===v[k]),
    'PIPELINE_DELIVERY_STARTUP_CHANGED','The launch differs from the complete reviewed application.',409);
  const c=await readConnection(v.connectionFile,{directory:v.directory,controlDirectory:v.controlDirectory});
  need(c.value.python===v.python&&c.value.runtimeReadyFile===v.runtimeReadyFile&&c.sha256===line.connectionSha256&&
    ['launchId','instanceId','pid','origin','applicationDirectory','programmeDirectory','sourceManifestSha256','runtimeId','runtimeSelectionSha256'].every(k=>c.value[k]===line[k])&&
    line.url===c.value.origin+'/'&&(!options.port||Number(new URL(c.value.origin).port)===options.port),
    'PIPELINE_DELIVERY_STARTUP_CHANGED','The current original Staff listener differs from its retained startup.',409);
  for(const[key,identity]of[['directory','directoryIdentity'],['controlDirectory','controlIdentity']]){
    const original=request.inputs?.find(i=>i.path===v[key]&&i.kind==='directory');
    if(original?.exists)need(String(original.dev)===c.value[identity].dev&&String(original.ino)===c.value[identity].ino,
      'PIPELINE_DELIVERY_DIRECTORY_CHANGED','The selected original workspace/control directory changed after Review.',409);
  }
  const client=await PipelineDeliveryClient.connect(c.path,{directory:v.directory,controlDirectory:v.controlDirectory,expectedLaunchId:c.value.launchId});
  try{await client.info();}finally{await client.close();}
  return{url:line.url,workspaceId:c.value.instanceId,connectionFile:c.path,
    original:{schema:STARTUP_SCHEMA,launchId:c.value.launchId,instanceId:c.value.instanceId,directory:v.directory,
      controlDirectory:v.controlDirectory,applicationDirectory:v.applicationDirectory,programmeDirectory:v.programmeDirectory,
      runtimeId:c.value.runtimeId,runtimeSelectionSha256:c.value.runtimeSelectionSha256,
      sourceManifestSha256:c.value.sourceManifestSha256,configurationSha256:selected.sha256,connectionSha256:c.sha256}};
}
