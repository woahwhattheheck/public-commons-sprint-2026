// SPDX-License-Identifier: MIT
import {dirname} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {STARTUP_SCHEMA,need,readLaunchConfiguration,readConnection,ReplicationClient,hash,privateDirectory} from './connection.mjs';
import {managedOptions,inspectOriginalSource} from './managed.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'replication-workbench',order:1280,
  catalog({common,field}){
    return[{id:'replication-workbench',command:'replication-workbench-managed',title:'Replication Workbench',
      terminal:false,requiredSource:'products/replication-workbench/managed.mjs',
      description:'Operate original Airbyte conversion, exact Sling replication, job recovery, typed consumer snapshots, downstream apply/restore, cutover/rollback and complete receiving.',
      fields:[field('configurationFile','Private replication configuration','path',true,
        'Complete host configuration selecting the prepared original application, workspace, actor, runtime receipt and connection record.'),...common]}];
  },
  validateSettings(_type,settings){managedOptions(['--configuration',settings.configurationFile]);},
  async prepare(_type,settings,{inputPath}){
    const{args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
    await path('configurationFile','file',false,true);
    const selected=await readLaunchConfiguration(settings.configurationFile),v=selected.value;
    option('--configuration',selected.path);option('--configuration-sha256',selected.sha256);
    const directory=await inputPath(v.directory,'directory',true,true);inputs.push(directory);
    if(!directory.exists)createDirectories.push(v.directory);
    inputs.push(await inputPath(v.applicationDirectory,'directory',false,false),await inputPath(v.authFile,'file',false,true),await inputPath(v.runtimeReadyFile,'file',false,true),
      await inputPath((await privateDirectory(dirname(v.connectionFile))).path,'directory',false,true));
    inputs.push(await inputPath(v.python,'file',false,false));
    if(v.consumerRoot)inputs.push(await inputPath(v.consumerRoot,'directory',false,false));
    await inspectOriginalSource({directory:v.applicationDirectory});
    const resourceKey=hash(JSON.stringify({family:'replication-workbench',directory:v.directory}));
    return{args,inputs,createDirectories,resourceKey,resourceKeys:[resourceKey,hash(JSON.stringify({family:'replication-connection',file:v.connectionFile}))]};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='replication-workbench-managed';},
  async verifyLaunch(request){
    const o=managedOptions(request.args),selected=await readLaunchConfiguration(o.configuration);
    need(selected.sha256===o.expectedConfigurationSha256,'REPLICATION_CONFIGURATION_CHANGED','The reviewed launch configuration changed.',409);
    await inspectOriginalSource({directory:selected.value.applicationDirectory});
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
      return()=>readReplicationStartup(request,text);
    });
  },
};
export async function readReplicationStartup(request,text){
  if(request.command!=='replication-workbench-managed')return null;
  let line;try{line=JSON.parse(text);}catch{return null;}
  if(line.schema!==STARTUP_SCHEMA||line.status!=='REPLICATION_WORKBENCH_READY')return null;
  const options=managedOptions(request.args),selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(selected.sha256===options.expectedConfigurationSha256&&line.configurationFile===selected.path&&line.configurationSha256===selected.sha256&&
    line.directory===v.directory&&line.applicationDirectory===v.applicationDirectory&&line.connectionFile===v.connectionFile,'REPLICATION_STARTUP_CHANGED','The launch differs from the reviewed application.',409);
  const c=await readConnection(v.connectionFile,{directory:v.directory});
  need(c.value.python===v.python&&c.value.consumerRoot===v.consumerRoot&&c.value.authFile===v.authFile&&c.value.actorId===v.actorId&&c.value.runtimeReadyFile===v.runtimeReadyFile&&c.sha256===line.connectionSha256&&['launchId','instanceId','pid','origin','applicationDirectory','sourceManifestSha256','runtimeSelectionSha256'].every(k=>c.value[k]===line[k])&&
    line.url===c.value.origin+'/'&&(!options.port||Number(new URL(c.value.origin).port)===options.port),
    'REPLICATION_STARTUP_CHANGED','The current listener differs from the retained startup.',409);
  const original=request.inputs?.find(i=>i.path===v.directory&&i.kind==='directory');
  if(original?.exists)need(String(original.dev)===c.value.directoryIdentity.dev&&String(original.ino)===c.value.directoryIdentity.ino,
    'REPLICATION_DIRECTORY_CHANGED','The workspace directory changed after review.',409);
  const client=await ReplicationClient.connect(c.path,{expectedLaunchId:c.value.launchId});try{await client.info();}finally{await client.close();}
  return{url:line.url,workspaceId:c.value.instanceId,connectionFile:c.path,
    original:{schema:STARTUP_SCHEMA,launchId:c.value.launchId,instanceId:c.value.instanceId,directory:v.directory,
      applicationDirectory:v.applicationDirectory,runtimeSelectionSha256:c.value.runtimeSelectionSha256,
      sourceManifestSha256:c.value.sourceManifestSha256,configurationSha256:selected.sha256,connectionSha256:c.sha256}};
}
