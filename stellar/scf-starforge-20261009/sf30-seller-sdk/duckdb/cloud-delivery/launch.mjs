// MIT. Saved launches open the original DuckDB workspace and Cloud edition store.
import {constants} from 'node:fs';
import {open,realpath,access,lstat,readdir} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {WorkspaceError,readSavedWorkspaceIdentity} from '../workspace/store.mjs';
import {createDuckdbWorkspace,publicIssue} from '../workspace/model.mjs';
import {startDuckdbWorkspace} from '../workspace/server.mjs';
import {emptyCloudSource} from './model.mjs';
import {privateDirectory,atomicJson,readJson,readBytes} from './files.mjs';

export const CLOUD_STARTUP_SCHEMA='stellar-forge.coinmetrics-cloud-startup.v1';
export const CLOUD_LAUNCH_FILES=Object.freeze([
  'contract.mjs','files.mjs','store.mjs','model.mjs','native.mjs','native.py','uploads.mjs','launch.mjs',
  'public/app.mjs','public/style.css','../workspace/model.mjs','../workspace/store.mjs','../workspace/server.mjs',
  '../workspace/authoring.mjs','../workspace/public/app.mjs','../workspace/public/index.html','../workspace/public/author.mjs',
  '../workspace/public/style.css','../workbench/bootstrap.mjs','../../source_bundle_archive.py'
]);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function cloudDirectory(value){
  if(typeof value!=='string'||!value||value.length>8192||!isAbsolute(value)||resolve(value)!==value||/[\x00-\x1f\x7f]/.test(value))
    throw new WorkspaceError('CLOUD_CANONICAL_DIRECTORY_REQUIRED');
  return value;
}
export async function inspectCloudWorkspace(directory,{workspaceId}={}){
  directory=cloudDirectory(directory);
  const result=await readSavedWorkspaceIdentity(directory);
  if(workspaceId!==undefined&&(!UUID.test(workspaceId)||result.workspaceId!==workspaceId))
    throw new WorkspaceError('CLOUD_WORKSPACE_IDENTITY_CHANGED',409);
  return {...result,schema:'stellar-forge.cloud-launch-workspace.v1'};
}
async function pin(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size>4194304n)throw new WorkspaceError('CLOUD_LAUNCH_SOURCE_INVALID');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key])||BigInt(bytes.length)!==after.size)
      throw new WorkspaceError('CLOUD_LAUNCH_SOURCE_CHANGED',409);
    return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{await file.close();}
}
export async function inspectCloudLaunchSource(directory=fileURLToPath(new URL('./',import.meta.url)),{expectedSha256}={}){
  directory=resolve(directory);if(await realpath(directory)!==directory)throw new WorkspaceError('CLOUD_CANONICAL_DIRECTORY_REQUIRED');
  const files=[];for(const name of CLOUD_LAUNCH_FILES)files.push({name,...await pin(join(directory,name))});
  const sha256=createHash('sha256').update(JSON.stringify(files)).digest('hex');
  if(expectedSha256!==undefined&&(!SHA.test(expectedSha256)||expectedSha256!==sha256))
    throw new WorkspaceError('CLOUD_LAUNCH_SOURCE_CHANGED',409);
  return {directory,files,sha256};
}
export async function initializeCloudWorkspace({directory,python='python3',environment=process.env}={}){
  directory=cloudDirectory(directory);let saved;
  try{saved=await inspectCloudWorkspace(directory);}catch(error){
    if(error.code!=='ENOENT'&&error.code!=='SAVED_WORKSPACE_SOURCE_REQUIRED')throw error;
  }
  if(saved)return {...saved,state:'REOPENED',source:await inspectCloudLaunchSource()};
  await privateDirectory(directory);
  const marker=join(directory,'.cloud-initialization.json'),complete=join(directory,'.cloud-initialized.json');
  const request={schema:'stellar-forge.cloud-initialization.v1',directory};
  try{await readJson(complete);throw new WorkspaceError('CLOUD_INITIALIZED_DATABASE_MISSING',409);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let original;
  try{original=await readJson(marker);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(original){
    if(JSON.stringify(original)!==JSON.stringify(request))throw new WorkspaceError('CLOUD_INITIALIZATION_CHANGED',409);
  }else{
    // A first interrupted atomic publication may leave only its exact own staging bytes.
    const expected=Buffer.from(JSON.stringify(request,null,2)+'\n');
    for(const name of await readdir(directory)){
      if(!/^\.cloud-initialization\.json\.[a-f0-9-]{36}\.tmp$/.test(name)||
         !(await readBytes(join(directory,name),expected.length)).equals(expected))
        throw new WorkspaceError('CLOUD_EMPTY_INITIALIZATION_DIRECTORY_REQUIRED',409);
    }
    await atomicJson(marker,request);
  }
  const sourceFile=await emptyCloudSource(directory);
  const model=await createDuckdbWorkspace({directory,sourceFile,python,environment});
  try{
    const initialized=await inspectCloudWorkspace(directory);
    await atomicJson(complete,{schema:'stellar-forge.cloud-initialized.v1',directory,workspaceId:initialized.workspaceId});
    return {...initialized,state:'INITIALIZED',source:await inspectCloudLaunchSource()};
  }finally{await model.close();}
}
export async function startCloudLaunch({directory,workspaceId,sourceSha256,port=0,python='python3',
  environment=process.env,sellerPort=0,operationsPort=0,availabilityDirectory}={}){
  if(!UUID.test(workspaceId??'')||!SHA.test(sourceSha256??''))throw new WorkspaceError('CLOUD_REVIEWED_LAUNCH_REQUIRED');
  const selected=await inspectCloudWorkspace(directory,{workspaceId}),source=await inspectCloudLaunchSource(undefined,{expectedSha256:sourceSha256});
  const session=await startDuckdbWorkspace({directory,sourceFile:selected.sourceFile,port,python,environment,sellerPort,operationsPort,availabilityDirectory});
  try{
    const current=await inspectCloudWorkspace(directory,{workspaceId});
    if(session.model.workspaceId!==workspaceId||current.workspaceId!==selected.workspaceId)
      throw new WorkspaceError('CLOUD_WORKSPACE_IDENTITY_CHANGED',409);
    return {...session,announcement:{schema:CLOUD_STARTUP_SCHEMA,state:'READY',url:session.url,
      directory,workspaceId,instanceId:session.instanceId,pid:process.pid,sourceSha256:source.sha256,sourceFiles:source.files}};
  }catch(error){await session.close();throw error;}
}
const HELP='starforge cloud-workspace init|inspect|serve --directory PRIVATE_DIRECTORY [--python PYTHON]\n'+
  'serve --workspace-id UUID --source-sha256 SHA256 --startup-json [--port 0]\n'+
  'init creates one empty original Cloud/DuckDB workspace. inspect/reopen retain its UUID.\n'+
  'Source selection, query authoring, reviews, packages and receiving use this same workspace.';
export async function main(argv=process.argv.slice(2)){
  if(argv.length===0||argv.includes('--help')){process.stdout.write(HELP+'\n');return null;}
  const {values:v,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    directory:{type:'string'},python:{type:'string'},'workspace-id':{type:'string'},'source-sha256':{type:'string'},
    port:{type:'string',default:'0'},'startup-json':{type:'boolean',default:false}
  }});
  if(positionals.length!==1||!['init','inspect','serve'].includes(positionals[0]))throw new WorkspaceError('CLOUD_COMMAND_INVALID');
  const directory=cloudDirectory(resolve(v.directory??''));
  if(!v.directory)throw new WorkspaceError('CLOUD_DIRECTORY_REQUIRED');
  if(positionals[0]==='init'){
    const result=await initializeCloudWorkspace({directory,python:v.python});process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  if(positionals[0]==='inspect'){
    const result={workspace:await inspectCloudWorkspace(directory,{workspaceId:v['workspace-id']}),source:await inspectCloudLaunchSource()};
    process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  if(!v['startup-json']||!/^(0|[1-9][0-9]{0,4})$/.test(v.port)||Number(v.port)>65535)throw new WorkspaceError('CLOUD_COMMAND_INVALID');
  const session=await startCloudLaunch({directory,workspaceId:v['workspace-id'],sourceSha256:v['source-sha256'],python:v.python,port:Number(v.port)});
  process.stdout.write(JSON.stringify(session.announcement)+'\n');
  const close=()=>void session.close().catch(error=>{process.stderr.write(JSON.stringify(publicIssue(error))+'\n');process.exitCode=1;});
  process.once('SIGINT',close);process.once('SIGTERM',close);return session;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify(publicIssue(error))+'\n');process.exitCode=1;});
