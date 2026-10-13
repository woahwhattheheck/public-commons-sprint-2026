// SPDX-License-Identifier: MIT
/** Source-bound Installation desk in the original managed Applications lifecycle. */
import {join,resolve,relative,isAbsolute} from 'node:path';
import {readdir,realpath,lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {APPLICATION_PROVIDER_SCHEMA,applicationField,observeApplicationStartup} from './application-provider.mjs';
import {applicationEnvironment} from './application-environment.mjs';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,need,plain,digest,json,canonical,regular,readJSON} from './storage.mjs';

const INSTALL='stellar/scf_2026/sf49_data_commissioning/installation-workorders/';
const CKAN='stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/';
const ADAPTER='stellar/scf-starforge-20261009/distribution/runtime-workspace/application-dcat-installation.mjs';
const HELPERS=[ADAPTER,
 'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs',
 'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-environment.mjs',
 'stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs',
 'stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs',
 'stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs'];
const REQUIRED=[
 ...['dcat-installation.mjs','dcat-installation-source.mjs','dcat-installation-core.mjs',
 'dcat-catalogues.json','profiles.mjs','prepare-core.mjs','DCAT_INSTALLATION.md',
 'dcat-installation/service.mjs','dcat-installation/server.mjs','dcat-installation/public/app.mjs',
 'dcat-installation/public/index.html','dcat-installation/public/style.css'].map(path=>INSTALL+path),
 ...['archive.mjs','model.mjs','dcat-workspace.mjs'].map(path=>CKAN+path),...HELPERS];
const SELECTION='stellar-forge.dcat-installation-managed-selection.v1';
const STARTUP='stellar-forge.dcat-installation-startup.v1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=value=>digest(json(canonical(value)));
const same=(a,b)=>hash(a)===hash(b);
function sourcePath(root,path){
 need(typeof path==='string'&&!isAbsolute(path)&&!path.includes('\\')&&
  path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'APPLICATION_DCAT_INSTALLATION_SOURCE_PATH');
 return join(root,path);
}
function selectedFiles(files){
 need(Array.isArray(files)&&files.length>0&&files.length<=100000,'APPLICATION_DCAT_INSTALLATION_SOURCE_SELECTION');
 const seen=new Set();
 const result=files.map(file=>{
  need(plain(file)&&!seen.has(file.path)&&Number.isSafeInteger(file.bytes)&&
   file.bytes>=0&&file.bytes<=128*1024*1024&&HASH.test(file.sha256??''),'APPLICATION_DCAT_INSTALLATION_SOURCE_SELECTION');
  sourcePath('/',file.path);seen.add(file.path);return{path:file.path,bytes:file.bytes,sha256:file.sha256};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 for(const path of REQUIRED)need(seen.has(path),'APPLICATION_DCAT_INSTALLATION_SOURCE_INCOMPLETE',
  'Select the complete original Installation product including '+path);
 return result;
}
async function verifySource(root,files){
 root=absolute(root);need(await realpath(root)===root,'APPLICATION_DCAT_INSTALLATION_SOURCE_LOCATION');
 for(const file of files){
  const path=sourcePath(root,file.path);need(await realpath(path)===path,'APPLICATION_DCAT_INSTALLATION_SOURCE_LOCATION');
  const bytes=await regular(path,Math.max(file.bytes,4*1024*1024));
  need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'APPLICATION_DCAT_INSTALLATION_SOURCE_CHANGED',file.path);
 }
 return{root,files:files.length,sha256:hash(files)};
}
/** Actual source checkout/installed files; contains no customer source or listener secret. */
export async function inspectDcatInstallationSourceSelection(root){
 root=await realpath(absolute(root));const paths=[];
 // Root prefixes end in a slash; sourcePath checks actual member paths below.
 for(const prefix of [INSTALL,CKAN]){
  async function collect(folder){
   const absoluteFolder=join(root,folder);
   need(await realpath(absoluteFolder)===absoluteFolder,'APPLICATION_DCAT_INSTALLATION_SOURCE_LOCATION');
   for(const entry of await readdir(absoluteFolder,{withFileTypes:true})){
    const path=folder+entry.name;
    need(!entry.isSymbolicLink(),'APPLICATION_DCAT_INSTALLATION_SOURCE_LOCATION');
    if(entry.isDirectory())await collect(path+'/');else if(entry.isFile())paths.push(path);
   }
  }
  await collect(prefix);
 }
 paths.push(...HELPERS);const files=[];
 for(const path of [...new Set(paths)].sort()){
  const raw=await regular(sourcePath(root,path),128*1024*1024);
  files.push({path,bytes:raw.length,sha256:digest(raw)});
 }
 return{...await verifySource(root,selectedFiles(files)),scope:'installation-and-catalogue-checkout-files'};
}
const runtimeIdentity=value=>Object.fromEntries(['directory','installationId','profileId','profileSha256',
 'lockSha256','sourceCommit','sourceManifestSha256','dependencyCount'].map(key=>[key,value[key]]));
async function directoryIdentity(directory){
 directory=absolute(directory);need(await realpath(directory)===directory,'APPLICATION_DCAT_INSTALLATION_DIRECTORY_CHANGED');
 const info=await lstat(directory);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
  (process.getuid===undefined||info.uid===process.getuid()),'APPLICATION_DCAT_INSTALLATION_PRIVATE_DIRECTORY');
 return{directory,dev:info.dev,ino:info.ino};
}
async function verifyExecutable(selected,executable){
 need(plain(selected)&&Array.isArray(selected.inputs)&&selected.inputs.length>0,
  'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_SELECTION');
 need(await realpath(absolute(executable))===await realpath(absolute(selected.executable)),
  'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_CHANGED');
 for(const input of selected.inputs){
  const path=absolute(input.path),info=await lstat(path);
  need(input.exists===true&&info.dev===input.dev&&info.ino===input.ino&&
   info.mtimeMs===input.mtimeMs&&info.ctimeMs===input.ctimeMs,'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_CHANGED');
  if(input.kind==='executable-link')need(info.isSymbolicLink()&&await realpath(path)===input.target,
   'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_CHANGED');
  else{
   need(input.kind==='file'&&info.isFile()&&!info.isSymbolicLink()&&info.size===input.bytes,
    'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_CHANGED');
   if(input.sha256)need(digest(await regular(path,Math.max(input.bytes,4*1024*1024)))===input.sha256,
    'APPLICATION_DCAT_INSTALLATION_EXECUTABLE_CHANGED');
  }
 }
 await access(selected.executable,constants.X_OK);return realpath(selected.executable);
}
export async function prepareDcatInstallationApplication(settings,{inputPath,selectedExecutable,runtimeDirectory}={}){
 need(typeof inputPath==='function'&&typeof selectedExecutable==='function',
  'APPLICATION_DCAT_INSTALLATION_INPUT_READER');
 const directory=absolute(settings.preparationDirectory),selectedDirectory=await inputPath(directory,'directory',false,true);
 const identity=await directoryIdentity(directory);
 const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
 const rel=relative(runtime.directory,directory);
 need(isAbsolute(rel)||rel==='..'||rel.startsWith('../'),'APPLICATION_DCAT_INSTALLATION_DIRECTORY_OUTSIDE_RUNTIME');
 const manifestPath=join(runtime.directory,'package','manifest.json'),manifest=await readJSON(manifestPath);
 need(Array.isArray(manifest.files),'APPLICATION_DCAT_INSTALLATION_SOURCE_MANIFEST');
 const files=selectedFiles(manifest.files);
 const executable=await selectedExecutable(process.execPath);
 const inputs=[selectedDirectory,...executable.inputs,await inputPath(manifestPath,'file'),
  await inputPath(join(runtime.directory,'runtime-profile.json'),'file')];
 await verifySource(runtime.sourceRoot,files);
 const body={schema:SELECTION,preparation:identity,runtime:runtimeIdentity(runtime),
  executable,source:{root:runtime.sourceRoot,scope:'complete-installed-manifest',files:files.length,
   manifestSha256:runtime.sourceManifestSha256,sha256:hash(files)}};
 const selection={...body,sha256:hash(body)};
 return{args:['serve','--directory',directory,'--managed-selection',JSON.stringify(selection)],
  inputs,createDirectories:[],resourceKey:hash({family:'dcat-installation',directory})};
}
export async function verifyDcatInstallationManagedSelection(selection,{directory,sourceRoot,executable=process.execPath}={}){
 need(plain(selection)&&selection.schema===SELECTION&&plain(selection.source)&&HASH.test(selection.sha256??''),
  'APPLICATION_DCAT_INSTALLATION_SELECTION_INVALID');
 const {sha256,...body}=selection;need(hash(body)===sha256,'APPLICATION_DCAT_INSTALLATION_SELECTION_CHANGED');
 need(same(await directoryIdentity(directory),selection.preparation),'APPLICATION_DCAT_INSTALLATION_DIRECTORY_CHANGED');
 const selectedExecutable=await verifyExecutable(selection.executable,executable);
 const runtime=await inspectMerchantRuntime(absolute(selection.runtime.directory),{load:false});
 need(same(runtimeIdentity(runtime),selection.runtime),'APPLICATION_DCAT_INSTALLATION_RUNTIME_CHANGED');
 const manifestRaw=await regular(join(runtime.directory,'package','manifest.json'),4*1024*1024);
 need(selection.source.scope==='complete-installed-manifest'&&
  digest(manifestRaw)===selection.source.manifestSha256&&selection.source.manifestSha256===runtime.sourceManifestSha256,
  'APPLICATION_DCAT_INSTALLATION_SOURCE_CHANGED');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestRaw));
 const files=selectedFiles(manifest.files);
 need(files.length===selection.source.files&&hash(files)===selection.source.sha256,
  'APPLICATION_DCAT_INSTALLATION_SOURCE_CHANGED');
 const source=await verifySource(sourceRoot??selection.source.root,files);
 return{preparation:selection.preparation,runtime:runtimeIdentity(runtime),source,selectedExecutable,selectionSha256:sha256};
}
function option(request,name,optional=false){
 const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
 if(optional&&!positions.length)return undefined;
 need(positions.length===1&&typeof request.args[positions[0]+1]==='string',
  'APPLICATION_DCAT_INSTALLATION_STARTUP_CHANGED');return request.args[positions[0]+1];
}
export async function dcatInstallationStartup(request,text,context={}){
 if(request.command!=='dcat-installation'||request.args?.[0]!=='serve'||typeof text!=='string'||
  !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
 need(text.length<=16384,'APPLICATION_DCAT_INSTALLATION_STARTUP_CHANGED');
 const startup=JSON.parse(text),selection=JSON.parse(option(request,'--managed-selection'));
 const directory=absolute(option(request,'--directory')),sourceRoot=join(absolute(request.releaseDirectory),'source');
 // The original provider loads and verifies exactly the same private environment as the child.
 await applicationEnvironment(request.environmentFile,request.environmentSha256);
 const verified=await verifyDcatInstallationManagedSelection(selection,{directory,sourceRoot});
 need(startup.schema===STARTUP&&startup.status==='READY'&&UUID.test(startup.instanceId??'')&&
  Number.isSafeInteger(startup.pid)&&startup.pid>0&&(context.pid===undefined||startup.pid===context.pid)&&
  startup.directory===directory&&startup.sourceRoot===sourceRoot&&
  startup.sourceSha256===verified.source.sha256&&startup.selectedExecutable===verified.selectedExecutable,
  'APPLICATION_DCAT_INSTALLATION_STARTUP_CHANGED');
 const url=new URL(startup.url),fragment=new URLSearchParams(url.hash.slice(1)),token=fragment.get('token');
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&
  !url.username&&!url.password&&startup.origin===url.origin&&fragment.size===1&&
  typeof token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(token),
  'APPLICATION_DCAT_INSTALLATION_URL_CHANGED');
 const selectedPort=option(request,'--port',true)??'0';
 need(/^(0|[1-9][0-9]*)$/.test(selectedPort)&&Number(selectedPort)<=65535&&
  (Number(selectedPort)===0||Number(selectedPort)===Number(url.port)),
  'APPLICATION_DCAT_INSTALLATION_PORT_CHANGED');
 const response=await fetch(url.origin+'/api/launch',{headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(10000)});
 need(response.ok,'APPLICATION_DCAT_INSTALLATION_STARTUP_UNAVAILABLE');
 const raw=await response.text();need(Buffer.byteLength(raw)<=16384,'APPLICATION_DCAT_INSTALLATION_STARTUP_CHANGED');
 const actual=JSON.parse(raw);need(actual.schema==='stellar-forge.dcat-installation-listener.v1'&&
  actual.instanceId===startup.instanceId&&actual.pid===startup.pid&&actual.directory===directory,
  'APPLICATION_DCAT_INSTALLATION_STARTUP_CHANGED');
 return{url:url.href,original:{schema:STARTUP,instanceId:actual.instanceId,pid:actual.pid,
  preparation:verified.preparation,sourceSha256:verified.source.sha256,
  selectionSha256:verified.selectionSha256,runtime:verified.runtime,selectedExecutable:verified.selectedExecutable}};
}
export default{
 schema:APPLICATION_PROVIDER_SCHEMA,id:'dcat-installation',order:1010,
 catalog({common}){return[{id:'dcat-installation',command:'dcat-installation',
  title:'DCAT catalogue Installation',terminal:false,requiredSource:INSTALL+'dcat-installation.mjs',
  description:'Retain a complete catalogue workspace, select commissioned work and prepare the original Workshare Installation with every source attachment.',
  fields:[applicationField('preparationDirectory','Private preparation directory','path',true,
   'Create an owner-only directory outside catalogue projects and installed source. Original input files, requests and complete preparation outputs remain here.'),...common]}];},
 prepare(_type,settings,context){return prepareDcatInstallationApplication(settings,context);},
 matchRequest(request){return!request.pythonCommand&&request.command==='dcat-installation'&&request.args?.[0]==='serve';},
 createObserver(request,directory,context){return observeApplicationStartup(request,directory,text=>{
  if(!text.startsWith('{"schema":"'+STARTUP+'",'))return null;return()=>dcatInstallationStartup(request,text,context);
 });}
};
