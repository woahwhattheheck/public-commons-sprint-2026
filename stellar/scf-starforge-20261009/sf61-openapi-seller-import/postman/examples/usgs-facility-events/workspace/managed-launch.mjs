// MIT. Original customer workspace and immutable installed-source launch reader.
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESK_SCHEMA, STARTUP_SCHEMA, hash, need, uuid, now } from './model.mjs';
import { startFacilityServer } from './server.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const FILES=['cli.mjs','managed-launch.mjs','server.mjs','store.mjs','model.mjs','provider.mjs','browser-assets.json',
  'public/index.html','public/app.mjs','public/styles.css','../report-core.mjs','../facilities.example.json','../historical-response.json',
  '../../../../../distribution/browser-assets.mjs'];
function absolute(value){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!/[\x00-\x1f\x7f]/.test(value),'Choose an absolute canonical workspace or source directory.');
  return value;
}
const uid=()=>process.geteuid?.()??process.getuid?.();
async function regular(file,maximum=64*1024*1024,privateFile=false){
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat();need(before.isFile()&&before.size<=maximum,'Select a regular original source file.');
    if(privateFile)need(!(before.mode&0o077)&&(uid()===undefined||before.uid===uid()),'The original launch file must remain private to its operator.');
    need(await realpath(file)===resolve(file),'Select the original real file path.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'A source file changed while it was being read.');
    return bytes;
  }finally{await handle.close();}
}
async function sourceSnapshot(directory){
  absolute(directory);need(await realpath(directory)===directory,'Select the original real source directory.');
  const files=[];
  for(const name of FILES){const bytes=await regular(resolve(directory,name));files.push({name,bytes:bytes.length,sha256:hash(bytes)});}
  return {files,sha256:hash(files)};
}
export async function inspectFacilityWorkspace(value){
  const directory=absolute(value),info=await lstat(directory);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(directory)===directory,'Choose the original real workspace directory.');
  const manifestFile=join(directory,'workspace.json');
  let manifest;
  try{manifest=JSON.parse(await regular(manifestFile,16384));}
  catch(error){if(error.code!=='ENOENT')throw error;return {directory,initialized:false,manifestFile:null,transferFiles:[]};}
  need(manifest.schema===DESK_SCHEMA&&typeof manifest.id==='string','This directory belongs to another application.');
  const transferFiles=[];
  for(const name of ['facility-desk.sqlite','facility-desk.sqlite-wal']){
    const file=join(directory,name);
    try{const stat=await lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'Use the original regular workspace database.');transferFiles.push(file);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {directory,initialized:true,workspaceId:manifest.id,manifestFile,transferFiles};
}
async function saveLaunch(file,value){
  const temp=file+'.'+uuid()+'.tmp';
  try{
    const handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
    await rename(temp,file);
    const directory=await open(dirname(file),'r');
    try{await directory.sync();}finally{await directory.close();}
  }
  finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function startManagedFacility({workspace,port=0,sourceDirectory=resolve(HERE),launchSourceDirectory=resolve(HERE),fetch}={}){
  workspace=absolute(resolve(workspace));sourceDirectory=absolute(resolve(sourceDirectory));launchSourceDirectory=absolute(resolve(launchSourceDirectory));
  const source=await sourceSnapshot(sourceDirectory),launch=sourceDirectory===launchSourceDirectory?source:await sourceSnapshot(launchSourceDirectory);
  need(source.sha256===launch.sha256,'The reviewed source differs from the actual installed launch source.');
  const privateLaunch=join(workspace,'facility-launch.json');let announcement;
  const running=await startFacilityServer({workspace,port,sourceIdentity:{sha256:source.sha256,files:source.files},fetch,
    beforeStoreClose:async()=>{
      if(announcement)await saveLaunch(privateLaunch,{...announcement,state:'STOPPED',stoppedAt:now()});
    }});
  try{
    const manifestBytes=await regular(join(workspace,'workspace.json'),16384,true);
    announcement={schema:STARTUP_SCHEMA,state:'LISTENING',directory:workspace,sourceDirectory,launchSourceDirectory,
      workspaceId:running.store.manifest.id,workspaceFileSha256:hash(manifestBytes),sourceFiles:source.files,sourceSha256:source.sha256,
      pid:process.pid,instanceId:uuid(),privateLaunch,url:running.url,startedAt:now()};
    await saveLaunch(privateLaunch,announcement);
    return {...running,announcement};
  }catch(error){
    // All failures after listener acquisition drain the server and release its original lease.
    try{await running.close();}catch(cleanupError){if(error.cause===undefined)error.cause=cleanupError;}
    throw error;
  }
}

export async function readFacilityLaunch({directory,sourceDirectory,launchSourceDirectory,pid,instanceId}){
  directory=absolute(directory);sourceDirectory=absolute(sourceDirectory);launchSourceDirectory=absolute(launchSourceDirectory);
  const privateLaunch=join(directory,'facility-launch.json'),value=JSON.parse(await regular(privateLaunch,65536,true));
  need(value.schema===STARTUP_SCHEMA&&value.state==='LISTENING'&&value.directory===directory&&value.sourceDirectory===sourceDirectory&&
    value.launchSourceDirectory===launchSourceDirectory&&value.privateLaunch===privateLaunch&&value.pid===pid&&value.instanceId===instanceId,
    'The original customer workspace launch changed.');
  need(Number.isSafeInteger(pid)&&pid>0&&typeof instanceId==='string','The original process identity is missing.');
  process.kill(pid,0);
  const manifestBytes=await regular(join(directory,'workspace.json'),16384,true),manifest=JSON.parse(manifestBytes);
  need(manifest.schema===DESK_SCHEMA&&manifest.id===value.workspaceId&&hash(manifestBytes)===value.workspaceFileSha256,'The original customer workspace identity changed.');
  const source=await sourceSnapshot(sourceDirectory),launch=sourceDirectory===launchSourceDirectory?source:await sourceSnapshot(launchSourceDirectory);
  need(source.sha256===value.sourceSha256&&launch.sha256===source.sha256&&hash(value.sourceFiles)===source.sha256,'The original launched source changed.');
  const url=new URL(value.url);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port||80)>=1&&Number(url.port||80)<=65535&&url.pathname==='/'&&!url.search&&!url.username&&!url.password&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash),'The original launch URL is not the private local workspace.');
  return value;
}
