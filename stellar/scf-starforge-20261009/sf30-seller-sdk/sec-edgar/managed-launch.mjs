// MIT. Managed launch binding for the original SEC capture store and operator workspace.
import { constants } from 'node:fs';
import { open,lstat,readdir,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileEdgarMerchant } from './config.mjs';
import { openEdgarStore } from './source.mjs';
import { WORKSPACE_SCHEMA } from './workspace.mjs';
import { absolute,privateDirectory,saveJSON,processIdentity,canonical,digest,json,need } from '../../distribution/runtime-workspace/storage.mjs';

export const SEC_EDGAR_STARTUP='stellar-forge.sec-edgar-workspace-startup.v1';
export const SEC_EDGAR_PROBE='stellar-forge.sec-edgar-workspace-listener.v1';
export const SEC_EDGAR_LAUNCH_FILE='managed-launch.json';
const hash=value=>digest(json(canonical(value)));
const same=(left,right)=>hash(left)===hash(right);
const versionName=revision=>String(revision).padStart(12,'0')+'.json';

/** Private launch/revision records retain their original file bytes and owner. */
export async function secEdgarPrivateJson(path,maximum=65536){
 const file=await open(absolute(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();
  need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size<=maximum&&
   (process.getuid===undefined||before.uid===process.getuid()),'APPLICATION_SEC_PRIVATE_RECORD_REQUIRED');
  const bytes=await file.readFile(),after=await file.stat();
  need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
   'APPLICATION_SEC_RECORD_CHANGED');
  return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bytes,sha256:digest(bytes)};
 }finally{await file.close();}
}
async function directoryIdentity(directory,{optional=false}={}){
 directory=absolute(directory);
 let info;
 try{await privateDirectory(directory);info=await lstat(directory,{bigint:true});}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 need(await realpath(directory)===directory,'APPLICATION_SEC_REAL_DIRECTORY_REQUIRED');
 return {directory,device:String(info.dev),inode:String(info.ino)};
}
export async function secEdgarWorkspaceIdentity(directory,{optional=false}={}){
 directory=absolute(directory);
 const folder=await directoryIdentity(directory,{optional});
 if(!folder)return null;
 const path=join(directory,'versions',versionName(0));
 let first;
 try{first=await secEdgarPrivateJson(path,8*1024*1024);}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 const value=first.value;
 need(value.schema===WORKSPACE_SCHEMA&&value.revision===0&&typeof value.workspaceId==='string'&&
  value.workspaceId.length<=128&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt)),
 'APPLICATION_SEC_WORKSPACE_INVALID');
 const identity={schema:WORKSPACE_SCHEMA,...folder,workspaceId:value.workspaceId,createdAt:value.createdAt,initialRevisionSha256:first.sha256};
 return {...identity,sha256:hash(identity)};
}
export async function secEdgarStoreIdentity(directory,{optional=false}={}){
 const folder=await directoryIdentity(absolute(directory),{optional});
 if(!folder)return null;
 const identity={schema:'stellar-forge.sec-edgar-store-binding.v1',...folder};
 return {...identity,sha256:hash(identity)};
}

/** Review immutable original revisions and their selected original source editions. */
export async function reviewSecEdgarInputs({directory,storeDirectory,optional=false}={}){
 directory=absolute(directory);storeDirectory=absolute(storeDirectory);
 const workspace=await secEdgarWorkspaceIdentity(directory,{optional});
 const store=await secEdgarStoreIdentity(storeDirectory,{optional});
 const files=[];
 if(!workspace)return {workspace,store,selection:null,files};
 const versions=join(directory,'versions');
 const names=(await readdir(versions)).filter(name=>/^\d{12}\.json$/.test(name)).sort();
 const latestName=names.at(-1);
 need(latestName,'APPLICATION_SEC_WORKSPACE_INVALID');
 const firstPath=join(versions,versionName(0)),currentPath=join(versions,latestName);
 files.push(firstPath);if(currentPath!==firstPath)files.push(currentPath);
 const loaded=await secEdgarPrivateJson(currentPath,8*1024*1024),current=loaded.value;
 need(current.schema===WORKSPACE_SCHEMA&&Number.isSafeInteger(current.revision)&&current.revision>=0&&
  versionName(current.revision)===latestName&&current.workspaceId===workspace.workspaceId&&current.createdAt===workspace.createdAt,
 'APPLICATION_SEC_WORKSPACE_INVALID');
 const editions=new Map();
 let productCount=0;
 if(current.config!==null){
  need(store&&current.configSha256===digest(JSON.stringify(current.config)),'APPLICATION_SEC_SOURCE_REVIEW_CHANGED');
  const compiled=compileEdgarMerchant(current.config),source=await openEdgarStore(storeDirectory);
  productCount=compiled.products.length;
  try{
   for(const product of compiled.products){
    await source.query(product.editionId,product,product.example);
    if(!editions.has(product.editionId)){
     const {record}=await source.getEdition(product.editionId);
     editions.set(record.id,record);
     files.push(join(storeDirectory,'editions',record.id+'.json'),join(storeDirectory,'blobs',record.sourceSha256+'.json'));
    }
   }
  }finally{await source.close();}
 }else need(current.configSha256===null,'APPLICATION_SEC_SOURCE_REVIEW_CHANGED');
 const sourceBindingSha256=hash([...editions.values()].sort((a,b)=>a.id.localeCompare(b.id)));
 const selection={schema:'stellar-forge.sec-edgar-source-review.v1',revision:current.revision,
  configSha256:current.configSha256,revisionSha256:loaded.sha256,sourceBindingSha256,
  editionCount:editions.size,productCount};
 return {workspace,store,selection:{...selection,sha256:hash(selection)},files:[...new Set(files)]};
}

export async function secEdgarProcess(){
 const start=await processIdentity();
 need(start,'APPLICATION_SEC_PROCESS_IDENTITY_REQUIRED','Use the original Linux managed runtime.');
 return {pid:process.pid,ppid:process.ppid,start};
}
export function secEdgarPrivateUrl(value,selectedPort=0){
 let url;try{url=new URL(value);}catch{need(false,'APPLICATION_SEC_PRIVATE_URL_INVALID');}
 const fragment=new URLSearchParams(url.hash.slice(1)),key=fragment.get('session');
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&
  Number(url.port)>0&&Number(url.port)<=65535&&(!selectedPort||Number(url.port)===selectedPort)&&
  [...fragment.keys()].length===1&&typeof key==='string'&&/^[A-Za-z0-9_-]{32,200}$/.test(key),
 'APPLICATION_SEC_PRIVATE_URL_INVALID');
 return {url:url.href,origin:url.origin,key};
}
export async function prepareSecEdgarLaunch({directory,storeDirectory,expectedWorkspace,expectedStore,expectedReview}={}){
 const selected=await reviewSecEdgarInputs({directory,storeDirectory,optional:true});
 for(const [expected,value,code]of [
  [expectedWorkspace,selected.workspace,'APPLICATION_SEC_WORKSPACE_CHANGED'],
  [expectedStore,selected.store,'APPLICATION_SEC_STORE_CHANGED'],
  [expectedReview,selected.selection,'APPLICATION_SEC_SOURCE_REVIEW_CHANGED']]){
  if(expected!==undefined)need(expected===(value?.sha256??'new'),code,'Review the current original SEC inputs before launch.');
 }
 return {directory:absolute(directory),storeDirectory:absolute(storeDirectory),...selected};
}
export async function secEdgarWorkspaceProbe(workspace){
 const selected=await reviewSecEdgarInputs({directory:workspace.directory,storeDirectory:workspace.storeDirectory});
 return {schema:SEC_EDGAR_PROBE,workspace:selected.workspace,store:selected.store,selection:selected.selection,process:await secEdgarProcess()};
}
export async function announceSecEdgarWorkspace(service,launch){
 need(service.workspace&&service.server?.listening,'APPLICATION_SEC_LISTENER_REQUIRED');
 const {workspace,store,selection,process:original}=await secEdgarWorkspaceProbe(service.workspace);
 need(workspace.directory===launch.directory&&store.directory===launch.storeDirectory&&
  (!launch.workspace||same(workspace,launch.workspace))&&(!launch.store||same(store,launch.store))&&
  (!launch.selection||same(selection,launch.selection)),'APPLICATION_SEC_LAUNCH_CHANGED');
 const selected=secEdgarPrivateUrl(service.url),address=service.server.address();
 need(address&&address.address==='127.0.0.1'&&address.port===Number(new URL(selected.url).port),
  'APPLICATION_SEC_LISTENER_CHANGED');
 const value={schema:SEC_EDGAR_STARTUP,status:'SEC_EDGAR_WORKSPACE_READY',launchId:randomUUID(),
  workspace,store,selection,process:original,url:selected.url};
 await saveJSON(join(workspace.directory,SEC_EDGAR_LAUNCH_FILE),value,true);
 return value;
}
