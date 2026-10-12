// MIT. Original API-pass workspace inside the retained Applications lifecycle.
import {constants} from 'node:fs';
import {lstat,realpath,readdir,readlink,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request as httpRequest} from 'node:http';
import {inspectMerchantRuntime} from '../../../sf46-release/runtime-package.mjs';
import {absolute,plain,need,digest,canonical,json,readJSON,recordId,regular}
 from '../../../distribution/runtime-workspace/storage.mjs';

const PRODUCT='stellar/scf-starforge-20261009/sf101-merchant-receiver/api-access/workspace/';
const KIND='api-pass-customer',COMMAND='api-pass-workspace';
const SCHEMA='stellar-forge.sf101.api-pass-application.v1';
const START='stellar-forge.sf101.api-pass-workspace-launch.v1';
const STATE='stellar-forge.sf101.api-pass-workspace.v1';
const SOURCE_FILES=['browser-assets.json','configuration.mjs','model.mjs','server.mjs','cli.mjs','public/index.html','public/style.css','public/app.mjs'];
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const same=(a,b)=>digest(json(canonical(a)))===digest(json(canonical(b)));
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
export function apiPassWorkspaceApplication(common){
 return {id:KIND,command:COMMAND,title:'API-pass customer',terminal:true,requiredSource:PRODUCT+'cli.mjs',
  description:'Purchase or reopen original API access, retain exact requests, recover the same response and read authenticated buyer history.',
  fields:[
   field('configurationFile','Customer workspace configuration','path',true,'Select the private configuration created by api-pass-workspace configure.'),
   field('workspaceDirectory','Private customer workspace','path',true,'Use the directory recorded in that configuration; existing passes and requests reopen here.'),
   field('approvalMode','Purchase approval channel','text',false,'auto uses the selected original browser capability when available; terminal keeps its original terminal channel; browser requires that capability.'),
   field('approvalModule','Selected original approval broker','path',false,'Optional explicit source from the selected original runtime. The native bridge and Python helper remain that runtime’s own.'),
   field('terminalPython','Terminal Python executable','path',false,'Defaults to /usr/bin/python3; keeps the original terminal approval channel available beside browser approval.'),
   ...common,
  ]};
}
async function stateAt(directory){
 try{
  const bytes=await regular(join(directory,'workspace.json'),32*1024*1024),value=JSON.parse(bytes.toString('utf8'));
  need(plain(value)&&value.schema===STATE&&UUID.test(value.id??''),'API_PASS_APPLICATION_STATE_INVALID');
  return {id:value.id,sha256:digest(bytes)};
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function privateFile(path){
 const info=await lstat(path);
 need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&info.nlink===1&&
  (typeof process.getuid!=='function'||info.uid===process.getuid()),'API_PASS_APPLICATION_PRIVATE_FILE_REQUIRED');
}
function flag(request,name,optional=false){
 const matches=request.args?.flatMap((value,index)=>value===name?[index]:[])??[];
 if(optional&&!matches.length)return null;
 need(matches.length===1&&typeof request.args[matches[0]+1]==='string','API_PASS_APPLICATION_REQUEST_CHANGED');
 return request.args[matches[0]+1];
}
/** Use the selected installation's own compiler and original runtime paths. */
export async function prepareApiPassWorkspaceApplication(settings,{runtimeDirectory,inputPath,selectedExecutable}={}){
 need(typeof inputPath==='function'&&typeof selectedExecutable==='function','API_PASS_APPLICATION_CONTEXT_REQUIRED');
 const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
 const product=join(runtime.sourceRoot,PRODUCT),module=join(product,'configuration.mjs');
 const inputs=[],createDirectories=[];
 const configPath=absolute(settings.configurationFile);
 await privateFile(configPath);
 inputs.push(await inputPath(configPath,'file'),await inputPath(module,'file'));
 const raw=await regular(configPath,65536),configHash=digest(raw);
 need(inputs[0].sha256===configHash,'API_PASS_APPLICATION_CONFIGURATION_CHANGED');
 const original=await import(pathToFileURL(module).href);
 const config=original.compileConfig(JSON.parse(raw.toString('utf8')));
 need(config.directory===absolute(settings.workspaceDirectory),'API_PASS_APPLICATION_DIRECTORY_CHANGED');
 const workspace=await inputPath(config.directory,'directory',true,true);
 inputs.push(workspace);if(!workspace.exists)createDirectories.push(workspace.path);
 const retained=await stateAt(config.directory);
 if(retained)inputs.push(await inputPath(join(config.directory,'workspace.json'),'file'));
 const entry=await inputPath(join(product,'cli.mjs'),'file');inputs.push(entry);
 const sourceFiles=[];
 for(const path of SOURCE_FILES){
  const full=join(product,path),item=inputs.find(input=>input.path===full)??await inputPath(full,'file');
  need(HASH.test(item.sha256??'')&&Number.isSafeInteger(item.bytes),'API_PASS_APPLICATION_SOURCE_REQUIRED');
  if(!inputs.includes(item))inputs.push(item);
  sourceFiles.push({path,bytes:item.bytes,sha256:item.sha256});
 }
 inputs.push(await inputPath(config.runtimeDirectory,'directory'));
 // Separate existing native state is retained as directories. Its original
 // accounting and request writers remain free to advance their own journals.
 for(const directory of new Set([config.buyerStateDirectory,config.inboxDirectory])){
  if(directory.startsWith(config.directory+'/'))continue;
  const selected=await inputPath(directory,'directory',true,true);inputs.push(selected);
  if(!selected.exists)createDirectories.push(selected.path);
 }
 if(config.buyerWorkspace){
  inputs.push(await inputPath(config.buyerWorkspace,'directory',false,true));
  for(const name of ['workspace.json','operator.json'])inputs.push(await inputPath(join(config.buyerWorkspace,name),'file'));
 }
 const mode=settings.approvalMode??'auto';
 need(['auto','browser','terminal'].includes(mode),'API_PASS_APPLICATION_APPROVAL_MODE_INVALID');
 const args=['serve','--config',configPath,'--expected-config-sha256',configHash,
  '--expected-workspace-sha256',retained?.sha256??'new','--approval-mode',mode];
 let approval=null;
 if(settings.approvalModule){
  need(mode!=='terminal','API_PASS_APPLICATION_APPROVAL_MODULE_UNUSED');
  const path=absolute(settings.approvalModule);approval=await inputPath(path,'file');inputs.push(approval);
  args.push('--approval-module',path,'--expected-approval-sha256',approval.sha256);
 }
 // An absolute Python selection is retained by the common launcher. Ordinary
 // CLI use also accepts a host-resolved executable name in its configuration.
 if(config.python.startsWith('/')){const selected=await selectedExecutable(config.python);inputs.push(...selected.inputs);}
 return {args,inputs,createDirectories,identity:{schema:SCHEMA,kind:KIND,command:COMMAND,
  configurationFile:configPath,configurationSha256:configHash,directory:config.directory,
  workspaceId:retained?.id??null,workspaceSha256:retained?.sha256??'new',
  entry:entry.path,entrySha256:entry.sha256,configurationModule:module,
  configurationModuleSha256:inputs[1].sha256,sourceRoot:runtime.sourceRoot,sourceFiles,runtimeDirectory:config.runtimeDirectory,
  buyerStateDirectory:config.buyerStateDirectory,inboxDirectory:config.inboxDirectory,buyerWorkspace:config.buyerWorkspace,
  approvalMode:mode,approvalModule:approval?.path??null,approvalSha256:approval?.sha256??null,port:settings.port??0}};
}
async function retainedLaunch(request,operationDirectory){
 need(request.applicationId&&request.command===COMMAND,'API_PASS_APPLICATION_REQUEST_REQUIRED');
 const root=dirname(dirname(operationDirectory)),id=operationDirectory.split('/').at(-1);
 const run=await readJSON(join(root,'applications',recordId(request.applicationId),'runs',id+'.json'));
 need(run.id===id&&run.applicationId===request.applicationId&&
  Object.entries(run.request).every(([name,value])=>Object.hasOwn(request,name)&&same(value,request[name])),
 'API_PASS_APPLICATION_RETAINED_RUN_CHANGED');
 const review=await readJSON(join(root,'application-reviews',recordId(run.reviewId)+'.json'));
 const identity=review.command?.apiPassWorkspace;
 need(review.schema==='stellar-forge.application-start-review.v1'&&review.applicationId===request.applicationId&&
  identity?.schema===SCHEMA&&identity.command===COMMAND&&review.command.command===COMMAND&&
  same(review.command.args,request.args),'API_PASS_APPLICATION_REVIEW_CHANGED');
 need(flag(request,'--config')===identity.configurationFile&&flag(request,'--expected-config-sha256')===identity.configurationSha256&&
  flag(request,'--expected-workspace-sha256')===identity.workspaceSha256&&flag(request,'--approval-mode')===identity.approvalMode&&
  flag(request,'--approval-module',true)===identity.approvalModule&&
  flag(request,'--expected-approval-sha256',true)===identity.approvalSha256,'API_PASS_APPLICATION_REQUEST_CHANGED');
 return {identity,review};
}
async function productSources(sourceRoot,identity){
 need(Array.isArray(identity.sourceFiles)&&identity.sourceFiles.length===SOURCE_FILES.length&&
  identity.sourceFiles.every((file,index)=>file.path===SOURCE_FILES[index]&&HASH.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)),
  'API_PASS_APPLICATION_SOURCE_SELECTION_CHANGED');
 for(const file of identity.sourceFiles){
  const bytes=await regular(join(absolute(sourceRoot),PRODUCT,file.path),4*1024*1024);
  need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'API_PASS_APPLICATION_SOURCE_BYTES_CHANGED');
 }
 return {sourceRoot,entry:join(sourceRoot,PRODUCT,'cli.mjs'),sourceFiles:identity.sourceFiles};
}
async function executedSources(request,identity){
 return productSources(join(absolute(request.releaseDirectory),'source'),identity);
}
async function exactSources(identity){
 await productSources(identity.sourceRoot,identity);
 for(const [path,sha]of [[identity.configurationFile,identity.configurationSha256],[identity.entry,identity.entrySha256],
  [identity.configurationModule,identity.configurationModuleSha256],...(identity.approvalModule?[[identity.approvalModule,identity.approvalSha256]]:[])]){
  need(HASH.test(sha)&&digest(await regular(absolute(path),4*1024*1024))===sha,'API_PASS_APPLICATION_REVIEWED_SOURCE_CHANGED');
 }
}
/** The CLI repeats the state preimage check after taking its original state lease. */
export async function verifyApiPassWorkspaceLaunch(request,operationDirectory){
 if(request.command!==COMMAND||!request.applicationId)return;
 const {identity}=await retainedLaunch(request,operationDirectory);await exactSources(identity);await executedSources(request,identity);
 const state=await stateAt(identity.directory);
 need((state?.sha256??'new')===identity.workspaceSha256&&(state?.id??null)===identity.workspaceId,
  'API_PASS_APPLICATION_REVIEWED_STATE_CHANGED');
}
async function processInfo(pid){
 need(Number.isSafeInteger(pid)&&pid>1,'API_PASS_APPLICATION_PROCESS_REQUIRED');
 const value=await readFile('/proc/'+pid+'/stat','utf8'),end=value.lastIndexOf(')');
 const fields=value.slice(end+2).split(' ');
 need(end>0&&fields.length>=20,'API_PASS_APPLICATION_PROCESS_CHANGED');
 return {pid,parent:Number(fields[1]),started:fields[19]};
}
async function belongsTo(pid,parent){
 const initial=await processInfo(pid);let current=initial;
 for(let i=0;i<32;i++){
  if(current.pid===parent)return initial;
  need(current.parent>1&&current.parent!==current.pid,'API_PASS_APPLICATION_CHILD_CHANGED');
  current=await processInfo(current.parent);
 }
 need(false,'API_PASS_APPLICATION_CHILD_CHANGED');
}
async function listener(pid,port){
 const inodes=new Set();
 for(const name of await readdir('/proc/'+pid+'/fd')){
  try{const target=await readlink('/proc/'+pid+'/fd/'+name),match=/^socket:\[(\d+)\]$/.exec(target);if(match)inodes.add(match[1]);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const address='0100007F:'+port.toString(16).toUpperCase().padStart(4,'0');
 const lines=(await readFile('/proc/'+pid+'/net/tcp','utf8')).trim().split('\n').slice(1);
 need(lines.some(line=>{const fields=line.trim().split(/\s+/);return fields[1]===address&&fields[3]==='0A'&&inodes.has(fields[9]);}),
  'API_PASS_APPLICATION_LISTENER_CHANGED');
}
function sessionAt(url){
 return new Promise((resolve,reject)=>{
  const request=httpRequest({hostname:'127.0.0.1',port:Number(url.port||80),path:'/api/session',method:'GET',
   headers:{Authorization:'Bearer '+url.hash.slice(1),Accept:'application/json'},timeout:5000},response=>{
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)response.destroy(new Error('API_PASS_APPLICATION_SESSION_TOO_LARGE'));else chunks.push(chunk);});
   response.once('error',reject);response.once('end',()=>{try{
    need(response.statusCode===200,'API_PASS_APPLICATION_SESSION_UNAVAILABLE');resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   }catch(error){reject(error);}});
  });
  request.once('timeout',()=>request.destroy(new Error('API_PASS_APPLICATION_SESSION_TIMEOUT')));
  request.once('error',reject);request.end();
 });
}
/** Called by the original asynchronous stdout observer with its actual child PID. */
export async function apiPassWorkspaceStartup(request,operationDirectory,text,context={}){
 if(request.command!==COMMAND||typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
 let value;try{value=JSON.parse(text);}catch{return null;}
 if(value?.schema!==START||value.status!=='LISTENING')return null;
 const {identity}=await retainedLaunch(request,operationDirectory);await exactSources(identity);
 const executed=await executedSources(request,identity);
 const launchFile=join(identity.directory,'api-pass-workspace-launch.json');
 need(value.launchFile===launchFile&&UUID.test(value.instanceId??'')&&UUID.test(value.workspaceId??''),
  'API_PASS_APPLICATION_STARTUP_CHANGED');
 await privateFile(launchFile);const launch=await readJSON(launchFile);
 need(launch.schema===START&&launch.status==='LISTENING'&&launch.instanceId===value.instanceId&&
  launch.workspaceId===value.workspaceId&&(identity.workspaceId===null||launch.workspaceId===identity.workspaceId)&&
  launch.processId===value.processId&&launch.directory===identity.directory&&launch.configFile===identity.configurationFile&&
  launch.configSha256===identity.configurationSha256&&launch.expectedWorkspaceSha256===identity.workspaceSha256&&
  launch.source?.entry===executed.entry&&launch.source.sha256===identity.entrySha256&&
  launch.source.runtimeDirectory===identity.runtimeDirectory&&launch.url===value.url&&
  Number.isFinite(Date.parse(launch.startedAt)),'API_PASS_APPLICATION_STARTUP_CHANGED');
 if(identity.approvalModule)need(launch.approval?.module===identity.approvalModule&&
  launch.approval.sha256===identity.approvalSha256,'API_PASS_APPLICATION_APPROVAL_SOURCE_CHANGED');
 if(identity.approvalMode==='browser')need(launch.approval?.mode==='ORIGINAL_BROWSER_BROKER','API_PASS_APPLICATION_APPROVAL_SOURCE_CHANGED');
 if(identity.approvalMode==='terminal')need(launch.approval?.mode==='ORIGINAL_TERMINAL','API_PASS_APPLICATION_APPROVAL_SOURCE_CHANGED');
 const url=new URL(value.url),port=Number(url.port||80);
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
  url.pathname==='/'&&/^[#][A-Za-z0-9_-]{43}$/.test(url.hash)&&port>=1&&port<=65535&&
  (identity.port===0||port===identity.port),'API_PASS_APPLICATION_URL_CHANGED');
 need(Number.isSafeInteger(context.pid)&&context.pid>1,'API_PASS_APPLICATION_CHILD_CONTEXT_REQUIRED');
 const before=await belongsTo(value.processId,context.pid);await listener(value.processId,port);
 const session=await sessionAt(url),state=await stateAt(identity.directory);
 need(session.schema==='stellar-forge.sf101.api-pass-workspace-session.v1'&&session.workspaceId===value.workspaceId&&
  state?.id===value.workspaceId,'API_PASS_APPLICATION_SESSION_CHANGED');
 const after=await processInfo(value.processId);
 need(before.started===after.started&&before.parent===after.parent,'API_PASS_APPLICATION_PROCESS_CHANGED');
 return {url:url.href,links:[],original:{schema:START,workspaceId:value.workspaceId,instanceId:value.instanceId,
  directory:identity.directory,configurationFile:identity.configurationFile,configurationSha256:identity.configurationSha256,
  source:launch.source,selectedSource:{sourceRoot:identity.sourceRoot,entry:identity.entry,sourceFiles:identity.sourceFiles},
  executedSource:executed,approval:launch.approval,process:{id:value.processId,parent:after.parent,start:after.started},
  launchFile,port,startedAt:launch.startedAt}};
}
