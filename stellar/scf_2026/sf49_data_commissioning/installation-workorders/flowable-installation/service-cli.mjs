#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Original authenticated Source Desk invokes this complete retained family once. */
import {resolve,relative,isAbsolute} from 'node:path';
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializationBytes} from '../../../../scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {createFlowableInstallationService} from './service.mjs';

const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_SOURCE_DESK_INPUT'});};
const inside=(parent,child)=>{const p=relative(parent,child);return p===''||!isAbsolute(p)&&p!=='..'&&!p.startsWith('../');};
export async function main(argv=process.argv.slice(2)){
 const options={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i];need(['--directory','--input'].includes(key)&&typeof argv[i+1]==='string'&&argv[i+1]&&!options[key],
   'Use complete unique --directory and --input absolute paths.');options[key]=argv[i+1];
 }
 need(options['--directory']&&options['--input'],'Select the original private source directory and complete input.');
 for(const value of Object.values(options))need(isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),'Use canonical absolute original host paths.');
 const raw=await initializationBytes(options['--input'],8*1024*1024);
 const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 need(request&&typeof request==='object'&&!Array.isArray(request)&&Object.keys(request).every(k=>['action','input','context'].includes(k))&&
  request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.context&&
  Object.keys(request.context).every(k=>['caseId','workspaceDirectory'].includes(k)),
  'Retain the complete declared original Source Desk invocation.');
 const context=request.context;
 need(/^operation-[a-f0-9]{32}$/.test(context.caseId??'')&&typeof context.workspaceDirectory==='string'&&
  isAbsolute(context.workspaceDirectory)&&resolve(context.workspaceDirectory)===context.workspaceDirectory,
  'Select the actual original customer case and workspace.');
 need(await realpath(context.workspaceDirectory)===context.workspaceDirectory&&
  inside(context.workspaceDirectory,options['--directory'])&&inside(context.workspaceDirectory,options['--input']),
  'Keep the complete invocation and sidecar inside the original private customer workspace.');
 if(['template','prepare'].includes(request.action))
  need(request.input.nativeCaseId===context.caseId,'Keep this complete preparation bound to the selected original customer case.');
 if(['following-compare','following-prepare'].includes(request.action))
  need(request.input.native?.source?.caseId===context.caseId,'Keep the full private native snapshot in this original case.');
 else need(request.input.native===undefined,'Native saved rows are accepted only by the following-edition family.');
 if(request.action==='import-file')need(typeof request.input.path==='string'&&isAbsolute(request.input.path)&&
  resolve(request.input.path)===request.input.path&&inside(context.workspaceDirectory,request.input.path),
  'Import only the original workspace-owned staged source file.');
 const actions=new Set(['import-file','catalogue','inspect','template','prepare','following-compare','following-prepare','get','list','file','source-file']);
 need(actions.has(request.action),'Use a supported original Flowable source operation.');
 const controller=new AbortController(),stop=()=>controller.abort(new Error('Original Source Desk operation interrupted.'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let service,result,primary;
 try{
  service=await createFlowableInstallationService({directory:options['--directory'],signal:controller.signal});
  switch(request.action){
   case 'import-file':result=await service.importFile(request.input);break;
   case 'catalogue':result=await service.catalogue(request.input);break;
   case 'inspect':result=await service.inspect(request.input);break;
   case 'template':result=await service.template(request.input);break;
   case 'prepare':result=await service.prepare(request.input);break;
   case 'following-compare':result=await service.followingCompare(request.input);break;
   case 'following-prepare':result=await service.followingPrepare(request.input);break;
   case 'get':result=await service.get(request.input.requestId);break;
   case 'list':result=await service.list(request.input);break;
   case 'file':result=await service.file(request.input.fileId);break;
   case 'source-file':result=await service.sourceFile(request.input);break;
  }
  if(['file','source-file'].includes(request.action)){
   const d=result.descriptor;need(inside(options['--directory'],result.path),'Retain only a complete original service-owned file.');
   result={path:result.path,file:{...d,id:d.fileId,filename:d.name}};
  }
 }catch(error){primary=error;}
 finally{
  try{await service?.close();}catch(error){primary=primary?new AggregateError([primary,error],'The original source operation or its owner did not close.'):error;}
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }
 if(primary){primary.requestId=request.input.requestId;throw primary;}
 return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{
  process.stderr.write(JSON.stringify({state:'ERROR',code:error.code??'FLOWABLE_SOURCE_DESK_FAILED',
   message:String(error.message),...(Number.isInteger(error.status)&&[400,409,413,415,422].includes(error.status)?{status:error.status}:{}),...(error.requestId?{requestId:error.requestId}:{})})+'\n');process.exitCode=2;
 });
