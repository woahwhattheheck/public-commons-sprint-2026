// MIT. Maintained Applications lifecycle for the complete Turbolong operating application.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/turbolong-operations';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const TURBOLONG_OPERATIONS_READY_SCHEMA='stellar-forge.turbolong-operations-workspace-startup.v1';
const privateSettings=[['connectionsFile','--connections-file'],['profileFile','--profile-file']];
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const originalFiles=[
 'cli.mjs','server.mjs','operator.mjs','workspace.mjs','common.mjs','worker.mjs','receiving.mjs','archive.mjs','runtime.mjs',
 'native.mjs','catalogue.mjs','period-analysis.mjs','browser-assets.json','source-files.json',
 'web/index.html','web/app.mjs','web/journal.mjs','web/styles.css'
];
function loopback(value='127.0.0.1'){
 need(value==='127.0.0.1'||value==='::1','APPLICATION_TURBOLONG_HOST_INVALID','Select 127.0.0.1 or ::1.');
 return value;
}
export function turbolongOperationsApplication(common=[]){
 return {id:'turbolong-operations',command:'stellar-turbolong-operations',title:'Turbolong operations',terminal:false,
  requiredSource:SOURCE+'/cli.mjs',
  description:'Operate complete vault periods, snapshot and keeper history, original native commands, incident and correction work, reports and independent full-source receiving.',
  fields:[
   field('workspaceDirectory','Private operating workspace','path',true,'Create or reopen complete periods, vaults, native operations, sources, incidents and reports.'),
   field('connectionsFile','Private Turbolong connections','path',false,'Host configuration outside the workspace. Select the actual telemetry, RPC, installed original runtime and private execution custody.'),
   field('profileFile','Workspace profile','path',false,'Optional saved operator profile outside the workspace.'),
   field('runtimeDirectory','Retained Turbolong runtime','path',false,'Select the complete customer source, installed dependency graph, original scripts, compiled artifacts and native tools.'),
   field('expectedManifestSha256','Runtime manifest SHA256','text',false,'Optionally pin the exact selected complete runtime manifest.'),
   field('installationDirectory','Original source installation','path',false,'Optional selected original customer installation. Use runtime-build or runtime-retain to capture its complete runtime.'),
   field('host','Local listen address','text',false,'127.0.0.1 (default) or ::1.'),
   ...(common.some(item=>item.name==='port')?[]:[field('port','Local port','port',false,'8779 keeps the operator origin and browser recovery journal stable. Use 0 only for an explicitly temporary listener.')]),
   ...common.map(item=>item.name==='port'?{...item,description:'8779 keeps the operator origin and recovery journal. Use 0 for an explicitly temporary listener.'}:item)
  ]};
}
export async function prepareTurbolongOperationsApplication(settings,{inputPath,runtimeDirectory}={}){
 need(plain(settings)&&typeof inputPath==='function','APPLICATION_TURBOLONG_INPUT_READER_REQUIRED');
 const directory=absolute(settings.workspaceDirectory),selected=await inputPath(directory,'directory',true,true);
 const inputs=[selected],createDirectories=selected.exists?[]:[directory];
 const release=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false}),sourceDirectory=join(release.sourceRoot,SOURCE);
 for(const file of originalFiles)inputs.push(await inputPath(join(sourceDirectory,file),'file'));
 inputs.push(await inputPath(join(release.sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/inputs/public/sha256.mjs'),'file'));
 const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
 const operator=await import(pathToFileURL(join(sourceDirectory,'operator.mjs')).href);
 const runtime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
 need(typeof native.inspectTurbolongOperationsWorkspace==='function'&&typeof operator.loadTurbolongOperationsConfiguration==='function'&&
  typeof runtime.readTurbolongRuntimeManifest==='function','APPLICATION_TURBOLONG_SOURCE_REQUIRED','Select the complete Turbolong operations application source.');
 const identity=selected.exists?await native.inspectTurbolongOperationsWorkspace({directory,allowMissing:true}):null;
 const host=loopback(settings.host===undefined||settings.host===''?'127.0.0.1':settings.host);
 const port=settings.port===undefined||settings.port===''?8779:Number(settings.port);
 need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'APPLICATION_TURBOLONG_PORT_INVALID','Select a local port from 0 to 65535.');
 const args=['serve','--workspace',directory,'--startup-format','json','--host',host,'--port',String(port)];
 if(identity!==null){
  need(plain(identity)&&UUID.test(identity.workspaceId??'')&&Number.isSafeInteger(identity.revision)&&identity.revision>=0,
   'APPLICATION_TURBOLONG_WORKSPACE_REQUIRED');
  args.push('--expected-workspace-id',identity.workspaceId);
 }
 const configuration={workspaceDirectory:directory};
 for(const[setting,flag]of privateSettings){
  if(settings[setting]===undefined||settings[setting]==='')continue;
  const descriptor=await inputPath(absolute(settings[setting]),'file',false,true);
  inputs.push(descriptor);args.push(flag,descriptor.path);configuration[setting]=descriptor.path;
 }
 if(settings.expectedManifestSha256!==undefined&&settings.expectedManifestSha256!=='')
  need(settings.runtimeDirectory&&/^[a-f0-9]{64}$/.test(settings.expectedManifestSha256),
   'APPLICATION_TURBOLONG_RUNTIME_HASH_INVALID','Select a retained runtime with its exact lowercase manifest hash.');
 if(settings.runtimeDirectory!==undefined&&settings.runtimeDirectory!==''){
  const retained=await inputPath(absolute(settings.runtimeDirectory),'directory',false,true);
  inputs.push(retained,await inputPath(join(retained.path,'manifest.json'),'file',false,true));
  const manifest=await runtime.readTurbolongRuntimeManifest({directory:retained.path,
   ...(settings.expectedManifestSha256?{expectedManifestSha256:settings.expectedManifestSha256}:{})});
  need(manifest.manifest?.version==='f017de605bb020bf3d7f4285aae4c654508e8d86',
   'APPLICATION_TURBOLONG_RUNTIME_REQUIRED','Select the complete retained original Turbolong runtime.');
  args.push('--runtime-directory',retained.path,'--expected-manifest-sha256',manifest.manifestSha256);
  configuration.runtimeDirectory=retained.path;configuration.expectedManifestSha256=manifest.manifestSha256;
 }
 if(settings.installationDirectory!==undefined&&settings.installationDirectory!==''){
  const installation=await inputPath(absolute(settings.installationDirectory),'directory',false,true);
  inputs.push(installation);args.push('--installation-directory',installation.path);configuration.installationDirectory=installation.path;
 }
 await operator.loadTurbolongOperationsConfiguration(configuration);
 return {args,inputs,createDirectories:[...new Set(createDirectories)]};
}
function option(request,name,optional=false){
 need(Array.isArray(request.args),'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 const locations=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&locations.length===0)return undefined;
 need(locations.length===1&&typeof request.args[locations[0]+1]==='string'&&request.args[locations[0]+1]&&
  !request.args[locations[0]+1].startsWith('--'),'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 return request.args[locations[0]+1];
}
export async function turbolongOperationsStartup(request,text){
 if(request.command!=='stellar-turbolong-operations'||request.pythonCommand||request.args?.[0]!=='serve'||typeof text!=='string'||text.length>65536)return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(!plain(value)||value.schema!==TURBOLONG_OPERATIONS_READY_SCHEMA||value.status!=='TURBOLONG_OPERATIONS_READY')return null;
 need(option(request,'--startup-format')==='json','APPLICATION_TURBOLONG_STARTUP_CHANGED');
 const directory=absolute(option(request,'--workspace')),sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
 const expectedId=option(request,'--expected-workspace-id',true),host=loopback(option(request,'--host',true)??'127.0.0.1');
 const port=option(request,'--port',true)??'8779';
 need(/^(?:0|[1-9][0-9]{0,4})$/.test(port)&&Number(port)<=65535,'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 need(value.workspaceDirectory===directory&&value.sourceDirectory===sourceDirectory&&UUID.test(value.workspaceId??'')&&
  (expectedId===undefined||expectedId===value.workspaceId)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&
  Number.isSafeInteger(value.pid)&&value.pid>0&&value.host===host&&Number.isSafeInteger(value.port)&&value.port>=1&&value.port<=65535&&
  (Number(port)===0||Number(port)===value.port),'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 const selectedPrivate={};
 for(const[setting,flag]of privateSettings){
  const argument=option(request,flag,true),path=argument===undefined?null:absolute(argument);
  need((value[setting]??null)===path,'APPLICATION_TURBOLONG_STARTUP_CHANGED');selectedPrivate[setting]=path;
 }
 const selectedRuntime=option(request,'--runtime-directory',true),selectedHash=option(request,'--expected-manifest-sha256',true),
  installation=option(request,'--installation-directory',true);
 if(selectedHash!==undefined)need(selectedRuntime!==undefined&&/^[a-f0-9]{64}$/.test(selectedHash),'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 if(selectedRuntime!==undefined){
  const nativeRuntime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
  const retained=await nativeRuntime.readTurbolongRuntimeManifest({directory:absolute(selectedRuntime),expectedManifestSha256:selectedHash});
  need(Array.isArray(value.runtimes)&&value.runtimes.some(row=>row.id===retained.manifest.id&&row.manifestSha256===retained.manifestSha256&&
   row.version==='f017de605bb020bf3d7f4285aae4c654508e8d86'),'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 }
 const runtimePath=selectedRuntime?absolute(selectedRuntime):null,installationPath=installation?absolute(installation):null;
 need((value.runtimeDirectory??null)===runtimePath&&(value.expectedManifestSha256??null)===(selectedHash??null)&&
  (value.installationDirectory??null)===installationPath,'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 Object.assign(selectedPrivate,{runtimeDirectory:runtimePath,expectedManifestSha256:selectedHash??null,installationDirectory:installationPath});
 let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_TURBOLONG_STARTUP_CHANGED');}
 need(url.protocol==='http:'&&url.hostname===(host==='::1'?'[::1]':'127.0.0.1')&&!url.username&&!url.password&&!url.search&&
  url.pathname==='/'&&/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number(url.port||80)===value.port&&
  value.origin===url.origin,'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
 const identity=await native.inspectTurbolongOperationsWorkspace({directory});
 need(plain(identity)&&identity.workspaceId===value.workspaceId&&Number.isSafeInteger(identity.revision)&&identity.revision>=value.revision,
  'APPLICATION_TURBOLONG_STARTUP_CHANGED');
 return {url:url.href,workspaceId:identity.workspaceId,original:{schema:TURBOLONG_OPERATIONS_READY_SCHEMA,
  workspaceDirectory:directory,workspaceId:identity.workspaceId,revision:value.revision,...selectedPrivate,sourceDirectory,
  host,port:value.port,pid:value.pid,runtimes:value.runtimes}};
}
