// MIT. Explicit local aliases over existing original Carbon workspaces and files.
import {lstat,realpath} from 'node:fs/promises';
import {dirname,join,relative,isAbsolute,sep} from 'node:path';
import {KINDS} from './catalog.mjs';
import {need,exact,plain,identifier,pathValue,privateDirectory,readJSON,identity,fileIdentity} from './files.mjs';
export const CONNECTION_SCHEMA='stellar-forge.carbon-customer-connection.v1';
export function localURL(value){
 const url=new URL(value);
 need(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port&&
  !url.username&&!url.password&&!url.search&&!url.hash,'CARBON_LOCAL_URL','Select the original explicit loopback Applications URL.');
 return url.origin;
}
function outside(path,directory){const r=relative(directory,path);return r==='..'||r.startsWith('..'+sep)||isAbsolute(r);}
export async function readCarbonCustomerConfiguration(path){
 path=pathValue(path);const raw=await readJSON(path),base=dirname(path);exact(raw,['schema','workspaces','destinations'],['schema','workspaces']);
 need(raw.schema===CONNECTION_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'CARBON_CONFIGURATION','Declare 1–32 original Carbon workspace aliases.');
 const workspaces=Object.create(null),destinations=Object.create(null),seen=new Set();
 for(const[alias,v]of Object.entries(raw.workspaces)){
  identifier(alias,'workspace alias');exact(v,['kind','label','directory','workspaceId','mode','url','files','accountingDirectory','accountingWorkspaceId','accountingSourcesSha256'],['kind','directory','workspaceId']);
  need(KINDS.includes(v.kind)&&['managed','owned'].includes(v.mode??'managed'),'CARBON_CONFIGURATION','Select a Carbon application kind and managed or owned attachment.');
  const directory=await privateDirectory(pathValue(v.directory,base));need(!seen.has(directory),'CARBON_CONFIGURATION','Configure each original workspace directory once.');seen.add(directory);
  need(typeof v.workspaceId==='string'&&v.workspaceId.length>0&&v.workspaceId.length<=160,'CARBON_WORKSPACE_ID','Retain the initialized original workspace identity.');
  const mode=v.mode??'managed',files=Object.create(null);
  need(v.files===undefined||plain(v.files)&&Object.keys(v.files).length<=256,'CARBON_FILES','Configure up to 256 original files.');
  for(const[name,input]of Object.entries(v.files??{})){
   identifier(name,'source alias');const source=pathValue(input,base),info=await lstat(source,{bigint:true});
   need(info.isFile()&&!info.isSymbolicLink()&&await realpath(source)===source,'CARBON_SOURCE_FILE','Configure a canonical original regular file.');
   files[name]={path:source,identity:fileIdentity(info)};
  }
  if(mode==='managed')need(v.url,'CARBON_LOCAL_URL','Managed mode selects the current original Applications startup URL.');
  else need(v.url===undefined,'CARBON_CONFIGURATION','Owned mode starts the original server on an available loopback port.');
  let accounting;
  if(v.accountingDirectory!==undefined){
   need(v.kind==='stellarcarbon'&&mode==='owned'&&/^[a-f0-9]{64}$/.test(v.accountingWorkspaceId??'')&&/^[a-f0-9]{64}$/.test(v.accountingSourcesSha256??''),
    'CARBON_ACCOUNTING_BINDING','Owned invoice preparation requires the original accounting workspace and both reviewed binding hashes.');
   accounting={directory:await privateDirectory(pathValue(v.accountingDirectory,base)),workspaceId:v.accountingWorkspaceId,sourcesSha256:v.accountingSourcesSha256};
  }else need(v.accountingWorkspaceId===undefined&&v.accountingSourcesSha256===undefined,'CARBON_ACCOUNTING_BINDING','Keep accounting identity with its original selected directory.');
  workspaces[alias]={kind:v.kind,label:v.label??alias,directory,workspaceId:v.workspaceId,mode,url:mode==='managed'?localURL(v.url):undefined,files,accounting,identity:identity(await lstat(directory))};
 }
 need(raw.destinations===undefined||plain(raw.destinations)&&Object.keys(raw.destinations).length<=64,'CARBON_DESTINATIONS','Configure up to 64 independent customer receiving aliases.');
 for(const[alias,input]of Object.entries(raw.destinations??{})){
  identifier(alias,'receiving alias');need(!workspaces[alias],'CARBON_ALIAS','A receiver alias must differ from original workspace aliases.');
  const path=pathValue(input,base),parent=await privateDirectory(dirname(path));
  need([...seen].every(directory=>outside(path,directory)),'CARBON_DESTINATION','Select a separate destination outside every original workspace.');
  need(!Object.values(destinations).some(v=>!outside(path,v.path)||!outside(v.path,path)),'CARBON_DESTINATION','Keep receiver destinations separate.');
  destinations[alias]={path,parent,identity:identity(await lstat(parent))};
 }
 return {schema:CONNECTION_SCHEMA,workspaces,destinations};
}
