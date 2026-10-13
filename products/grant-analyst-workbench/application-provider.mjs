// SPDX-License-Identifier: MIT
import {dirname} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {STARTUP_SCHEMA,need,readLaunchConfiguration,readConnection,GrantAnalystClient,hash,privateDirectory} from './connection.mjs';
import {managedOptions,inspectOriginalSource} from './managed.mjs';

const sourceOf=v=>inspectOriginalSource({directory:v.applicationDirectory,sourceManifestFile:v.sourceManifestFile,sourceManifestSha256:v.sourceManifestSha256});
export default{
  schema:APPLICATION_PROVIDER_SCHEMA,id:'grant-analyst-workbench',order:1520,
  catalog({common,field}){
    return[{id:'grant-analyst-workbench',command:'grant-analyst-workbench-managed',title:'Grant Analyst Workbench',terminal:false,
      requiredSource:'products/grant-analyst-workbench/managed.mjs',
      description:'Operate complete original grant analysis, source classification, learning cycles and commissioned studies.',
      fields:[field('configurationFile','Private grant analyst configuration','path',true,
        'Reviewed complete private source, original workspace, Python, operator and generated private console connection.'),...common]}];
  },
  validateSettings(_type,settings){managedOptions(['--configuration',settings.configurationFile]);},
  async prepare(_type,settings,{inputPath,selectedExecutable}){
    const{args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
    await path('configurationFile','file',false,true);
    const selected=await readLaunchConfiguration(settings.configurationFile),v=selected.value;
    option('--configuration',selected.path);option('--configuration-sha256',selected.sha256);
    const directory=await inputPath(v.directory,'directory',true,false);inputs.push(directory);
    if(!directory.exists)createDirectories.push(v.directory);
    inputs.push(await inputPath(v.applicationDirectory,'directory',false,true),
      await inputPath(v.sourceManifestFile,'file',false,true),
      await inputPath((await privateDirectory(dirname(v.connectionFile))).path,'directory',false,true));
    const python=await selectedExecutable(v.python);inputs.push(...python.inputs);
    need(python.executable===v.python,'GRANT_ANALYST_RUNTIME_CHANGED','Preserve the selected interpreter invocation path.',409);
    await sourceOf(v);
    const keys=[['grant-analyst-workbench',v.directory],['grant-analyst-connection',v.connectionFile]]
      .map(([family,path])=>hash(JSON.stringify({family,path})));
    return{args,inputs,createDirectories,resourceKey:keys[0],resourceKeys:keys};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='grant-analyst-workbench-managed';},
  async verifyLaunch(request){
    const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration);
    need(selected.sha256===options.expectedConfigurationSha256,'GRANT_ANALYST_CONFIGURATION_CHANGED','The reviewed launch configuration changed.',409);
    await sourceOf(selected.value);
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
      return()=>readGrantAnalystStartup(request,text);
    });
  },
};
export async function readGrantAnalystStartup(request,text){
  if(request.command!=='grant-analyst-workbench-managed')return null;
  let line;try{line=JSON.parse(text);}catch{return null;}
  if(line.schema!==STARTUP_SCHEMA||line.status!=='GRANT_ANALYST_WORKBENCH_READY')return null;
  const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(selected.sha256===options.expectedConfigurationSha256&&line.configurationFile===selected.path&&
    line.configurationSha256===selected.sha256&&['directory','applicationDirectory','connectionFile','sourceManifestFile','sourceManifestSha256','python']
      .every(k=>line[k]===v[k]),'GRANT_ANALYST_STARTUP_CHANGED','The listener differs from the complete reviewed application.',409);
  const c=await readConnection(v.connectionFile,{directory:v.directory,applicationDirectory:v.applicationDirectory,sourceManifestSha256:v.sourceManifestSha256});
  need(c.sha256===line.connectionSha256&&['launchId','instanceId','workspaceId','workspaceName','pid','origin','python','sourceManifestFile'].every(k=>c.value[k]===line[k])&&
    c.value.actor===v.actor&&(v.workspaceName===null||c.value.workspaceName===v.workspaceName)&&c.value.configurationFile===selected.path&&
    c.value.configurationSha256===selected.sha256&&
    line.url===c.value.origin+'/#'+c.token&&(!(options.port??v.port)||Number(new URL(c.value.origin).port)===(options.port??v.port)),
    'GRANT_ANALYST_STARTUP_CHANGED','The authenticated original listener differs from its retained startup.',409);
  const original=request.inputs?.find(i=>i.path===v.directory&&i.kind==='directory');
  if(original?.exists)need(String(original.dev)===c.value.directoryIdentity.dev&&String(original.ino)===c.value.directoryIdentity.ino,
    'GRANT_ANALYST_DIRECTORY_CHANGED','The selected original workspace directory changed after Review.',409);
  const client=await GrantAnalystClient.connect(c.path,{directory:v.directory,applicationDirectory:v.applicationDirectory,
    sourceManifestSha256:v.sourceManifestSha256,expectedLaunchId:c.value.launchId});
  try{await client.info();}finally{await client.close();}
  return{url:line.url,workspaceId:c.value.workspaceId,connectionFile:c.path,original:{schema:STARTUP_SCHEMA,
    launchId:c.value.launchId,instanceId:c.value.instanceId,workspaceId:c.value.workspaceId,directory:v.directory,applicationDirectory:v.applicationDirectory,
    python:v.python,sourceManifestSha256:c.value.sourceManifestSha256,configurationSha256:selected.sha256,connectionSha256:c.sha256}};
}
