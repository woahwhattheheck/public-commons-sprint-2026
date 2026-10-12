// SPDX-License-Identifier: MIT
// Fixed host inputs; reading configuration opens no publisher, capture or listener.
import {resolve,dirname} from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {exact,failure,fileBytes,identifier,line,plain} from './host-files.mjs';
export const FRICTIONLESS_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.frictionless-workspace-connection.v1';
const fail=message=>{throw failure('CONFIGURATION_ERROR',message);};
function publicURL(value){
 let url;try{url=new URL(value);}catch{fail('Use a complete HTTPS public descriptor or reference URL.');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>/(?:token|credential|signature|secret|password|authorization|^key$|^sig$)/i.test(k)))
  fail('Use public HTTPS source inputs without embedded credentials or capability parameters.');
 return url.href;
}
async function privateFile(path,maximum){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>maximum||await realpath(path)!==path||
  process.platform!=='win32'&&(info.mode&0o077||process.getuid&&info.uid!==process.getuid()))
  fail('Use an owned canonical private source file within its original byte bound.');
 return path;
}
function strings(value,maximum,what){
 if(!Array.isArray(value)||value.length>maximum||value.some(x=>typeof x!=='string'||!x||x.length>2048||/[\x00-\x1f\x7f]/.test(x))||new Set(value).size!==value.length)
  fail('Declare distinct '+what+' within the supported bound.');
 return value;
}
export async function readFrictionlessWorkspaceConfig(path,{publishers}={}){
 path=resolve(path);await privateFile(path,1048576);
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fileBytes(path,1048576)));
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 if(raw.schema!==FRICTIONLESS_WORKSPACE_CONNECTION_SCHEMA||!plain(raw.workspaces)||Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
  fail('Declare one to 32 original Frictionless source workspaces.');
 const workspaces=Object.create(null),used=new Set();
 for(const [alias,value]of Object.entries(raw.workspaces)){
  identifier(alias,'Frictionless source workspace');exact(value,['label','publisher','inputs'],['publisher']);
  const publisher=identifier(value.publisher,'Publisher alias'),original=publishers?.workspaces?.[publisher];
  if(!original||original.kind!=='frictionless'||used.has(publisher))fail('Bind each original Frictionless publisher to one source workbench.');
  if(value.inputs!==undefined&&(!plain(value.inputs)||Object.keys(value.inputs).length>64))fail('Declare at most 64 original source inputs.');
  const inputs=Object.create(null);
  for(const [name,input]of Object.entries(value.inputs??{})){
   identifier(name,'Source input alias');if(name==='current')fail('The current input is reserved for the original selected publisher source.');
   exact(input,['kind','label','path','url','resources','references','timeoutSeconds'],['kind']);
   if(!['descriptor','source-archive'].includes(input.kind)||Number(Object.hasOwn(input,'path'))+Number(Object.hasOwn(input,'url'))!==1)
    fail('Choose an original descriptor path/HTTPS URL, or a retained source-archive path.');
   if(input.kind==='source-archive'&&(input.url!==undefined||input.resources!==undefined||input.references!==undefined||input.timeoutSeconds!==undefined))
    fail('A source archive already contains its original resource and reference selection.');
   const item={kind:input.kind,label:line(input.label??name,'Source input label')};
   if(input.path!==undefined){
    if(typeof input.path!=='string'||!input.path||input.path.includes('\0'))fail('Supply an original source file path.');
    item.path=await privateFile(resolve(dirname(path),input.path),input.kind==='descriptor'?8*1024*1024:256*1024*1024);
   }else item.url=publicURL(input.url);
   if(input.resources!==undefined)item.resources=strings(input.resources,256,'resource names');
   if(input.references!==undefined)item.references=strings(input.references,20,'reference URLs').map(publicURL);
   if(input.timeoutSeconds!==undefined){
    if(!Number.isSafeInteger(input.timeoutSeconds)||input.timeoutSeconds<1||input.timeoutSeconds>300)fail('Use a source request timeout from 1 to 300 seconds.');
    item.timeoutSeconds=input.timeoutSeconds;
   }
   inputs[name]=item;
  }
  used.add(publisher);workspaces[alias]={label:line(value.label??alias,'Workspace label'),publisher,directory:original.directory,inputs};
 }
 return{workspaces};
}
