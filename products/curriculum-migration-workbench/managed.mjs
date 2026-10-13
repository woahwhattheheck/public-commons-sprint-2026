#!/usr/bin/env node
// MIT. One original managed store/server lifetime through Applications.
import {readFile,mkdir,realpath,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {saveJSON} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {createStore,openStore} from './store.mjs';
import {startServer} from './server.mjs';
import {managedPage} from './browser.mjs';
import {inspectBinding,inspectSource,defaultSourceDirectory,processIdentity,verifyAnnouncement} from './binding.mjs';
import {absolute,need,canonical,UUID,realDirectory,bytes,jsonFile,CONNECTION_SCHEMA,STARTUP_SCHEMA} from './contract.mjs';
function options(argv){const o={};for(let i=0;i<argv.length;i+=2){const k=argv[i],v=argv[i+1];need(/^--[a-z][a-z-]*$/.test(k??'')&&typeof v==='string'&&!Object.hasOwn(o,k),'ARGUMENTS');o[k]=v;}return o;}
function allowed(o,names){need(Object.keys(o).every(k=>names.includes(k)),'ARGUMENTS');}
function snapshot(value){return value;}
async function outputBytes(data,path){
 path=absolute(path);await realDirectory(dirname(path),{privateOnly:true});const body=Buffer.from(data);
 async function existing(){try{const prior=await bytes(path,160*1024*1024,{privateOnly:true});need(prior.equals(body),'OUTPUT_CHANGED','Existing original output differs.');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 if(await existing())return;
 const {open,link,unlink}=await import('node:fs/promises'),{constants}=await import('node:fs');
 const temporary=path+'.pending-'+randomUUID();let handle=null;
 try{
  handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST'||!await existing())throw e;}
 }finally{
  if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{await parent.sync();}finally{await parent.close();}
 }
}
async function output(value,path){const data=JSON.stringify(value,null,2)+'\n';if(path)await outputBytes(data,path);else console.log(data);}
async function serve(selected,{requestId,port}){
 need(UUID.test(requestId??''),'REQUEST');let store,server,connection,closed=false,signal=false,wake;
 const shutdownSignal=new Promise(resolve=>{wake=resolve;}),stop=()=>{signal=true;wake();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 let primary=null;
 try{
  store=await openStore({directory:selected.binding.workspaceDirectory});
  need(store.identity.id===selected.binding.storeId,'STORE_CHANGED');
  need(!signal,'START_INTERRUPTED');
  const token=randomBytes(32).toString('hex'),portPath=join(store.directory,'managed-port.json');
  let priorPort;try{priorPort=await jsonFile(portPath,65536,{privateOnly:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  if(priorPort){need(priorPort.schema==='stellar-forge.curriculum-migration-port.v1'&&priorPort.storeId===store.identity.id&&Number.isSafeInteger(priorPort.port)&&priorPort.port>0&&priorPort.port<=65535,'PORT_RECORD');need(port===0||port===priorPort.port,'PORT_CHANGED','Use this managed store original port; browser pending requests belong to its exact local origin.');port=priorPort.port;}
  server=await startServer({store,sourceDirectory:selected.binding.sourceDirectory,token,port,sourceSha256:selected.binding.sourceSha256,renderPage:()=>managedPage({sourceDirectory:selected.binding.sourceDirectory,store,sourceSha256:selected.binding.sourceSha256})});
  need(!signal,'START_INTERRUPTED');
  const actualPort=Number(new URL(server.origin).port);
  if(!priorPort)await saveJSON(portPath,{schema:'stellar-forge.curriculum-migration-port.v1',storeId:store.identity.id,port:actualPort});
  const processRecord=await processIdentity();
  connection={schema:CONNECTION_SCHEMA,state:'LISTENING',instanceId:randomUUID(),applicationRequestId:requestId,bindingSha256:selected.bindingSha256,storeId:store.identity.id,workspaceId:store.identity.id,workspaceDirectory:store.directory,sourceSha256:selected.binding.sourceSha256,pid:process.pid,process:processRecord,connectionFile:selected.binding.connectionFile,url:server.origin+'/#'+token,startedAt:new Date().toISOString()};
  const history=join(store.directory,'connections');try{await mkdir(history,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await realDirectory(history,{privateOnly:true});
  let previous;try{previous=await jsonFile(selected.binding.connectionFile,1024*1024,{privateOnly:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous){need(UUID.test(previous.instanceId??''),'CONNECTION');await saveJSON(join(history,previous.instanceId+'.json'),previous);}
  await saveJSON(selected.binding.connectionFile,connection,true);
  const announcement={...connection,schema:STARTUP_SCHEMA};await verifyAnnouncement(selected.binding.connectionFile,announcement,{storeId:store.identity.id,workspaceDirectory:store.directory,applicationRequestId:requestId,bindingSha256:selected.bindingSha256});
  need(!signal,'START_INTERRUPTED');console.log(canonical(announcement));await shutdownSignal;
 }catch(error){primary=error;}
 finally{
  const errors=[];if(server)try{await server.close();}catch(e){errors.push(e);}
  if(store)try{await store.close();}catch(e){errors.push(e);}
  closed=errors.length===0;
  if(connection&&closed)try{await saveJSON(connection.connectionFile,{...connection,state:'STOPPED',stoppedAt:new Date().toISOString()},true);}catch(e){errors.push(e);}
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
  if(primary||errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Curriculum managed lifetime did not complete: '+[...(primary?[primary]:[]),...errors].map(e=>e.message).join('; '));
 }
 return{closed};
}
export async function main(argv=process.argv.slice(2)){
 const args=[...argv],action=args.shift();if(!action||action==='--help'){console.log('curriculum-migration-workbench create|binding|serve|state|branches|branch|command|receive|export|report|history|download|request. Use OPERATING.md; preserve original branch identity, complete inputs and first results.');return;}
 need(Number(process.versions.node.split('.')[0])>=20,'NODE_VERSION','Node 20 or later is required.');
 const o=options(args),workspaceDirectory=absolute(o['--workspace']);
 if(action==='create'){
  allowed(o,['--workspace','--id','--title','--at','--snapshot','--source-directory']);
  need(UUID.test(o['--id']??'')&&o['--title']&&o['--at'],'CREATE');
  const source=await inspectSource(o['--source-directory']??defaultSourceDirectory);
  const input=await jsonFile(o['--snapshot']?absolute(o['--snapshot']):join(source.sourceDirectory,'initial-workspace.json'),160*1024*1024);
  
  const created=await createStore({directory:workspaceDirectory,id:o['--id'],title:o['--title'],createdAt:o['--at'],initialSnapshot:snapshot(input)});
  console.log(canonical(created));return created;
 }
 if(action==='binding'||action==='serve'){
  allowed(o,['--workspace','--source-directory','--connection-file','--port','--expected-binding-sha256','--application-request-id']);
  const selected=await inspectBinding({workspaceDirectory,sourceDirectory:o['--source-directory']??defaultSourceDirectory,connectionFile:o['--connection-file']});
  if(action==='binding'){console.log(canonical(selected));return selected;}
  need(o['--expected-binding-sha256']===selected.bindingSha256,'BINDING_CHANGED');
  const port=Number(o['--port']??0);need(/^(0|[1-9][0-9]*)$/.test(o['--port']??'0')&&Number.isSafeInteger(port)&&port<=65535,'PORT');
  return serve(selected,{requestId:o['--application-request-id'],port});
 }
 allowed(o,['--workspace','--input','--output']);need(['state','branches','branch','command','receive','export','report','history','download','request'].includes(action),'COMMAND');
 const input=o['--input']?await jsonFile(absolute(o['--input']),160*1024*1024):undefined;
 const store=await openStore({directory:workspaceDirectory});try{
  let result;
  if(action==='state')result=store.identity;
  else if(action==='branches')result=await store.list();
  else {need(input&&typeof input==='object','INPUT','Use a complete retained JSON operation input.');
   if(action==='branch')result=await store.read(input.id);
   else if(action==='command')result=await store.command(input);
   else if(action==='receive')result=await store.create(input);
   else if(action==='export')result=await store.exportBranch(input);
   else if(action==='report')result=await store.report(input);
   else if(action==='history')result=await store.history(input);
   else if(action==='download')result=await store.download(input);
   else if(action==='request')result=await store.request(input.requestId);
  }
  if(action==='download'){need(o['--output'],'OUTPUT','Select a complete output file for binary download.');await outputBytes(result.bytes,o['--output']);console.log(canonical({branch:result.branch,descriptor:result.descriptor}));}
  else await output(result,o['--output']);return result;
 }finally{await store.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===await realpath(process.argv[1]).catch(()=>process.argv[1]))main().catch(error=>{console.error(JSON.stringify({error:{code:error.code??'CURRICULUM_MIGRATION',message:error.message}}));process.exitCode=1;});
