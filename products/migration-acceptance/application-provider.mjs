// SPDX-License-Identifier: MIT
import {dirname} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {STARTUP_SCHEMA,need,readLaunchConfiguration,readConnection,MigrationClient,hash,privateDirectory} from './connection.mjs';
import {managedOptions,inspectOriginalSource} from './managed.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'migration-acceptance',order:1260,
  catalog({common,field}){
    return[{id:'migration-acceptance-workbench',command:'migration-acceptance-managed',title:'Migration Acceptance Workbench',
      terminal:false,requiredSource:'products/migration-acceptance/managed.mjs',
      description:'Operate original dlt data migrations, typed parity, business rules, reviewed cutover and rollback, and complete editable customer handback.',
      fields:[field('configurationFile','Private migration configuration','path',true,
        'Complete host configuration selecting the original workspace, auth file, runtime and connection record.'),...common]}];
  },
  validateSettings(_type,settings){managedOptions(['--configuration',settings.configurationFile]);},
  async prepare(_type,settings,{inputPath,selectedExecutable}){
    const{args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
    await path('configurationFile','file',false,true);
    const selected=await readLaunchConfiguration(settings.configurationFile),v=selected.value;
    option('--configuration',selected.path);option('--configuration-sha256',selected.sha256);
    const directory=await inputPath(v.directory,'directory',true,true);inputs.push(directory);
    if(!directory.exists)createDirectories.push(v.directory);
    inputs.push(await inputPath(v.authFile,'file',false,true),await inputPath(v.runtimeReadyFile,'file',false,true),
      await inputPath((await privateDirectory(dirname(v.connectionFile))).path,'directory',false,true));
    if(v.python!=='python3'){const executable=await selectedExecutable(v.python);inputs.push(...executable.inputs);}
    await inspectOriginalSource();
    const resourceKey=hash(JSON.stringify({family:'migration-acceptance',directory:v.directory}));
    return{args,inputs,createDirectories,resourceKey,resourceKeys:[resourceKey,hash(JSON.stringify({family:'migration-connection',file:v.connectionFile}))]};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='migration-acceptance-managed';},
  async verifyLaunch(request){
    const o=managedOptions(request.args),selected=await readLaunchConfiguration(o.configuration);
    need(selected.sha256===o.expectedConfigurationSha256,'MIGRATION_CONFIGURATION_CHANGED','The reviewed launch configuration changed.',409);
    await inspectOriginalSource();
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
      return()=>readMigrationStartup(request,text);
    });
  },
};
export async function readMigrationStartup(request,text){
  if(request.command!=='migration-acceptance-managed')return null;
  let line;try{line=JSON.parse(text);}catch{return null;}
  if(line.schema!==STARTUP_SCHEMA||line.status!=='MIGRATION_ACCEPTANCE_READY')return null;
  const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(selected.sha256===options.expectedConfigurationSha256&&line.configurationFile===selected.path&&line.configurationSha256===selected.sha256&&
    line.directory===v.directory&&line.connectionFile===v.connectionFile,'MIGRATION_STARTUP_CHANGED','The launch differs from the reviewed application.',409);
  const c=await readConnection(v.connectionFile,{directory:v.directory});
  need(c.sha256===line.connectionSha256&&['launchId','instanceId','pid','origin','sourceManifestSha256'].every(k=>c.value[k]===line[k])&&
    line.url===c.value.origin+'/'&&(!options.port||Number(new URL(c.value.origin).port)===options.port),
    'MIGRATION_STARTUP_CHANGED','The current listener differs from the retained startup.',409);
  const original=request.inputs?.find(i=>i.path===v.directory&&i.kind==='directory');
  if(original?.exists)need(String(original.dev)===c.value.directoryIdentity.dev&&String(original.ino)===c.value.directoryIdentity.ino,
    'MIGRATION_DIRECTORY_CHANGED','The workspace directory changed after review.',409);
  const client=await MigrationClient.connect(c.path,{expectedLaunchId:c.value.launchId});try{await client.info();}finally{await client.close();}
  return{url:line.url,workspaceId:c.value.instanceId,connectionFile:c.path,
    original:{schema:STARTUP_SCHEMA,launchId:c.value.launchId,instanceId:c.value.instanceId,directory:v.directory,
      sourceManifestSha256:c.value.sourceManifestSha256,configurationSha256:selected.sha256,connectionSha256:c.sha256}};
}
