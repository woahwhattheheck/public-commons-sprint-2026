// MIT. Original Applications lifecycle for the complete Pollar partner application.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/pollar-partner';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const POLLAR_PARTNER_READY_SCHEMA='stellar-forge.pollar-partner-workspace-startup.v1';
const privateSettings=[['connectionsFile','--connections-file'],['profileFile','--profile-file']];
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const originalFiles=[
 'cli.mjs','server.mjs','operator.mjs','workspace.mjs','common.mjs','receiving.mjs','archive.mjs','runtime.mjs',
 'native.mjs','catalogue.mjs','browser-bridge.mjs','browser-assets.json','source-files.json',
 'source/contracts.json','source/pollar-sdk-source.json','source/pollar-docs-source.json',
 'web/index.html','web/app.mjs','web/portal.html','web/portal.mjs','web/journal.mjs','web/styles.css'
];
function loopback(value='127.0.0.1'){
 need(value==='127.0.0.1'||value==='::1','APPLICATION_POLLAR_HOST_INVALID','Select 127.0.0.1 or ::1.');
 return value;
}
export function pollarPartnerApplication(common=[]){
 return {id:'pollar-partner',command:'stellar-pollar-partner',title:'Pollar partner',terminal:false,
  requiredSource:SOURCE+'/cli.mjs',
  description:'Run the partner operator and customer wallet with saved applications, verified sessions, payments, activity, complete reports and independent receiving.',
  fields:[
   field('workspaceDirectory','Private partner workspace','path',true,'Create or reopen the complete application, participant, operation, source and reporting history.'),
   field('connectionsFile','Private Pollar connections','path',false,'Host configuration outside the workspace. Select the existing Pollar application, server key, scoped MCP token and retained browser runtime.'),
   field('profileFile','Workspace profile','path',false,'Optional saved operator profile outside the workspace.'),
   field('runtimeDirectory','Retained Pollar browser runtime','path',false,'Select a complete runtime built from the pinned original Pollar core, React and Accesly source.'),
   field('expectedManifestSha256','Runtime manifest SHA256','text',false,'Optionally pin the exact selected complete runtime manifest.'),
   field('installationDirectory','Original built SDK installation','path',false,'Optional completed source-build project for native runtime resolution. The runtime-build command prepares it.'),
   field('host','Local listen address','text',false,'127.0.0.1 (default) or ::1.'),
   ...(common.some(item=>item.name==='port')?[]:[field('port','Local port','port',false,'8778 keeps the customer origin and browser recovery journal stable. Use 0 only for an explicitly temporary listener.')]),
   ...common.map(item=>item.name==='port'?{...item,description:'8778 keeps the original customer origin and recovery journal. Use 0 for an explicitly temporary listener.'}:item)
  ]};
}
export async function preparePollarPartnerApplication(settings,{inputPath,runtimeDirectory}={}){
 need(plain(settings)&&typeof inputPath==='function','APPLICATION_POLLAR_INPUT_READER_REQUIRED');
 const directory=absolute(settings.workspaceDirectory),selected=await inputPath(directory,'directory',true,true);
 const inputs=[selected],createDirectories=selected.exists?[]:[directory];
 const release=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false}),sourceDirectory=join(release.sourceRoot,SOURCE);
 for(const file of originalFiles)inputs.push(await inputPath(join(sourceDirectory,file),'file'));
 inputs.push(await inputPath(join(release.sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/inputs/public/sha256.mjs'),'file'));
 const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
 const operator=await import(pathToFileURL(join(sourceDirectory,'operator.mjs')).href);
 const runtime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
 need(typeof native.inspectPollarPartnerWorkspace==='function'&&typeof operator.loadPollarPartnerConfiguration==='function'&&
  typeof runtime.readPollarRuntimeManifest==='function','APPLICATION_POLLAR_SOURCE_REQUIRED','Select the complete Pollar partner application source.');
 const identity=selected.exists?await native.inspectPollarPartnerWorkspace({directory,allowMissing:true}):null;
 const host=loopback(settings.host===undefined||settings.host===''?'127.0.0.1':settings.host);
 const port=settings.port===undefined||settings.port===''?8778:Number(settings.port);
 need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'APPLICATION_POLLAR_PORT_INVALID','Select a local port from 0 to 65535.');
 const args=['serve','--workspace',directory,'--startup-format','json','--host',host,'--port',String(port)];
 if(identity!==null){
  need(plain(identity)&&UUID.test(identity.workspaceId??'')&&Number.isSafeInteger(identity.revision)&&identity.revision>=0,
   'APPLICATION_POLLAR_WORKSPACE_REQUIRED');
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
   'APPLICATION_POLLAR_RUNTIME_HASH_INVALID','Select a retained runtime with its exact lowercase manifest hash.');
 if(settings.runtimeDirectory!==undefined&&settings.runtimeDirectory!==''){
  const retained=await inputPath(absolute(settings.runtimeDirectory),'directory',false,true);
  inputs.push(retained,await inputPath(join(retained.path,'manifest.json'),'file',false,true));
  const manifest=await runtime.readPollarRuntimeManifest({directory:retained.path,
   ...(settings.expectedManifestSha256?{expectedManifestSha256:settings.expectedManifestSha256}:{})});
  need(manifest.manifest?.versions?.['@pollar/core']==='0.12.0-rc.1'&&manifest.manifest?.versions?.['@pollar/react']==='0.12.0-rc.1',
   'APPLICATION_POLLAR_RUNTIME_REQUIRED','Select the complete original Pollar browser runtime.');
  args.push('--runtime-directory',retained.path,'--expected-manifest-sha256',manifest.manifestSha256);
  configuration.runtimeDirectory=retained.path;configuration.expectedManifestSha256=manifest.manifestSha256;
 }
 if(settings.installationDirectory!==undefined&&settings.installationDirectory!==''){
  const installation=await inputPath(absolute(settings.installationDirectory),'directory',false,true);
  inputs.push(installation);args.push('--installation-directory',installation.path);configuration.installationDirectory=installation.path;
 }
 await operator.loadPollarPartnerConfiguration(configuration);
 return {args,inputs,createDirectories:[...new Set(createDirectories)]};
}
function option(request,name,optional=false){
 need(Array.isArray(request.args),'APPLICATION_POLLAR_STARTUP_CHANGED');
 const locations=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&locations.length===0)return undefined;
 need(locations.length===1&&typeof request.args[locations[0]+1]==='string'&&request.args[locations[0]+1]&&
  !request.args[locations[0]+1].startsWith('--'),'APPLICATION_POLLAR_STARTUP_CHANGED');
 return request.args[locations[0]+1];
}
export async function pollarPartnerStartup(request,text){
 if(request.command!=='stellar-pollar-partner'||request.pythonCommand||request.args?.[0]!=='serve'||typeof text!=='string'||text.length>65536)return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(!plain(value)||value.schema!==POLLAR_PARTNER_READY_SCHEMA||value.status!=='POLLAR_PARTNER_READY')return null;
 need(option(request,'--startup-format')==='json','APPLICATION_POLLAR_STARTUP_CHANGED');
 const directory=absolute(option(request,'--workspace')),sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
 const expectedId=option(request,'--expected-workspace-id',true),host=loopback(option(request,'--host',true)??'127.0.0.1');
 const port=option(request,'--port',true)??'8778';
 need(/^(?:0|[1-9][0-9]{0,4})$/.test(port)&&Number(port)<=65535,'APPLICATION_POLLAR_STARTUP_CHANGED');
 need(value.workspaceDirectory===directory&&value.sourceDirectory===sourceDirectory&&UUID.test(value.workspaceId??'')&&
  (expectedId===undefined||expectedId===value.workspaceId)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&
  Number.isSafeInteger(value.pid)&&value.pid>0&&value.host===host&&Number.isSafeInteger(value.port)&&value.port>=1&&value.port<=65535&&
  (Number(port)===0||Number(port)===value.port),'APPLICATION_POLLAR_STARTUP_CHANGED');
 const selectedPrivate={};
 for(const[setting,flag]of privateSettings){
  const argument=option(request,flag,true),path=argument===undefined?null:absolute(argument);
  need((value[setting]??null)===path,'APPLICATION_POLLAR_STARTUP_CHANGED');selectedPrivate[setting]=path;
 }
 const selectedRuntime=option(request,'--runtime-directory',true),selectedHash=option(request,'--expected-manifest-sha256',true),
  installation=option(request,'--installation-directory',true);
 if(selectedHash!==undefined)need(selectedRuntime!==undefined&&/^[a-f0-9]{64}$/.test(selectedHash),'APPLICATION_POLLAR_STARTUP_CHANGED');
 if(selectedRuntime!==undefined){
  const nativeRuntime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
  const retained=await nativeRuntime.readPollarRuntimeManifest({directory:absolute(selectedRuntime),expectedManifestSha256:selectedHash});
  need(Array.isArray(value.runtimes)&&value.runtimes.some(row=>row.id===retained.manifest.id&&row.manifestSha256===retained.manifestSha256&&
   row.versions?.['@pollar/core']==='0.12.0-rc.1'),'APPLICATION_POLLAR_STARTUP_CHANGED');
 }
 Object.assign(selectedPrivate,{runtimeDirectory:selectedRuntime?absolute(selectedRuntime):null,expectedManifestSha256:selectedHash??null,
  installationDirectory:installation?absolute(installation):null});
 let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_POLLAR_STARTUP_CHANGED');}
 need(url.protocol==='http:'&&url.hostname===(host==='::1'?'[::1]':'127.0.0.1')&&!url.username&&!url.password&&!url.search&&
  url.pathname==='/'&&/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number(url.port||80)===value.port&&
  value.origin===url.origin&&value.portalUrl===url.origin+'/portal','APPLICATION_POLLAR_STARTUP_CHANGED');
 const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
 const identity=await native.inspectPollarPartnerWorkspace({directory});
 need(plain(identity)&&identity.workspaceId===value.workspaceId&&Number.isSafeInteger(identity.revision)&&identity.revision>=value.revision,
  'APPLICATION_POLLAR_STARTUP_CHANGED');
 return {url:url.href,workspaceId:identity.workspaceId,original:{schema:POLLAR_PARTNER_READY_SCHEMA,
  workspaceDirectory:directory,workspaceId:identity.workspaceId,revision:value.revision,...selectedPrivate,sourceDirectory,
  host,port:value.port,pid:value.pid,portalUrl:value.portalUrl,runtimes:value.runtimes}};
}
