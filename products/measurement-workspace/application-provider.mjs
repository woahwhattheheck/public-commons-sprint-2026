// SPDX-License-Identifier: MIT
import {dirname} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {applicationEnvironment}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-environment.mjs';
import {STARTUP_SCHEMA,need,hash,canonical,readConfiguration,inspectSource,readConnection,connectionIdentity,directoryIdentity,tokenFor}
  from './connection.mjs';
import {managedOptions} from './managed.mjs';

export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'measurement-workspace',order:1290,
 catalog({common,field}){return [{
  id:'measurement-workspace',command:'measurement-workspace-managed',title:'Measurements and observed benchmarks',
  terminal:false,requiredSource:'products/measurement-workspace/managed.mjs',
  description:'Use the original scientific workspace for raw source intake, explicit mappings, measured-data and discharge studies, observed benchmarks, attributed review and complete independent receiving.',
  fields:[field('configurationFile','Private Measurements launch configuration','path',true,
   'Complete private JSON selecting the original scientific data directory, separate connection record and agent token environment name.'),...common]
 }];},
 validateSettings(_type,settings){managedOptions(['--configuration',settings.configurationFile]);},
 async prepare(_type,settings,{inputPath,applicationEnvironment}){
  const {args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
  await path('configurationFile','file',false,true);
  const selected=await readConfiguration(settings.configurationFile),v=selected.value;
  const source=await inspectSource(),environment=await applicationEnvironment(settings.environmentFile);
  await tokenFor(v,{environment:environment.environment});
  option('--configuration',selected.path);option('--configuration-sha256',selected.sha256);
  option('--source-manifest-sha256',source.manifestSha256);
  const data=await inputPath(v.workspaceDirectory,'directory',true,true);inputs.push(data);
  if(!data.exists)createDirectories.push(v.workspaceDirectory);
  inputs.push(await inputPath(dirname(v.connectionFile),'directory',false,true));
  const resourceKey=hash(canonical({family:'measurement-workspace',directory:v.workspaceDirectory}));
  return {args,inputs,createDirectories,resourceKey,resourceKeys:[resourceKey,
   hash(canonical({family:'measurement-connection',file:v.connectionFile}))]};
 },
 matchRequest(request){return !request.pythonCommand&&request.command==='measurement-workspace-managed';},
 async verifyLaunch(request){
  const options=managedOptions(request.args),selected=await readConfiguration(options.configuration);
  need(options.configurationSha256===selected.sha256,'MEASUREMENTS_CONFIGURATION_CHANGED','Review the changed launch configuration.',409);
  const source=await inspectSource();need(options.sourceManifestSha256===source.manifestSha256,'MEASUREMENTS_SOURCE_CHANGED','Review the changed original source.',409);
  const environment=await applicationEnvironment(request.environmentFile,request.environmentSha256);
  await tokenFor(selected.value,{environment:environment.environment});
 },
 createObserver(request,directory){return observeApplicationStartup(request,directory,text=>{
  if(!text.startsWith('{"schema":"'+STARTUP_SCHEMA+'",'))return null;
  return ()=>readMeasurementsStartup(request,text);
 });}
};
export async function readMeasurementsStartup(request,text){
 if(request.command!=='measurement-workspace-managed')return null;
 let line;try{line=JSON.parse(text);}catch{return null;}
 if(line.schema!==STARTUP_SCHEMA||line.status!=='MEASUREMENTS_READY')return null;
 const options=managedOptions(request.args),selected=await readConfiguration(options.configuration),v=selected.value;
 need(options.configurationSha256===selected.sha256&&line.configurationFile===selected.path&&line.configurationSha256===selected.sha256&&
  line.directory===v.workspaceDirectory&&line.connectionFile===v.connectionFile,'MEASUREMENTS_STARTUP_CHANGED','Startup differs from the reviewed application.',409);
 const source=await inspectSource();
 need(options.sourceManifestSha256===source.manifestSha256&&line.sourceManifestSha256===source.manifestSha256,'MEASUREMENTS_SOURCE_CHANGED');
 const connection=await readConnection(v.connectionFile);
 need(connection.sha256===line.connectionSha256&&
  ['instanceId','workspaceId','workspaceBinding','pid','childPid','origin','configurationSha256','sourceManifestSha256'].every(k=>line[k]===connection.value[k])&&
  line.url===connection.value.origin+'/'&&(!options.port||Number(new URL(connection.value.origin).port)===options.port),
  'MEASUREMENTS_STARTUP_CHANGED','The current listener differs from the exact retained startup.',409);
 const physical=await directoryIdentity(v.workspaceDirectory),prior=request.inputs?.find(x=>x.path===v.workspaceDirectory&&x.kind==='directory');
 if(prior?.exists)need(String(prior.dev)===physical.dev&&String(prior.ino)===physical.ino,'MEASUREMENTS_DIRECTORY_CHANGED','Review the replaced physical workspace.',409);
 const environment=await applicationEnvironment(request.environmentFile,request.environmentSha256);
 await connectionIdentity(connection,await tokenFor(v,{environment:environment.environment}));
 return {url:line.url,workspaceId:connection.value.workspaceId,connectionFile:connection.path,
  original:{schema:STARTUP_SCHEMA,instanceId:connection.value.instanceId,workspaceId:connection.value.workspaceId,
   workspaceBinding:connection.value.workspaceBinding,directory:v.workspaceDirectory,sourceManifestSha256:source.manifestSha256,
   configurationSha256:selected.sha256,connectionSha256:connection.sha256}};
}
