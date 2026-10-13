// MIT. Exact Curriculum source/store/process binding for supported Applications.
import {realpath,access,readFile,readlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_SCHEMA,SOURCE_SHA256,BINDING_SCHEMA,CONNECTION_SCHEMA,STARTUP_SCHEMA,UUID,sha,canonical,need,bytes,jsonFile,absolute,realDirectory,privateParent,localUrl} from './contract.mjs';
export const defaultSourceDirectory=join(dirname(fileURLToPath(import.meta.url)),'app');
export async function inspectSource(sourceDirectory=defaultSourceDirectory){
 sourceDirectory=(await realDirectory(absolute(sourceDirectory))).path;
 const path=join(sourceDirectory,'source-selection.json'),raw=await bytes(path,2*1024*1024),selection=JSON.parse(raw);
 need(selection.schema===SOURCE_SCHEMA&&selection.sha256===SOURCE_SHA256&&Array.isArray(selection.files)&&selection.files.length===20,'SOURCE_SELECTION');
 const copy={...selection};delete copy.sha256;need(sha(canonical(copy))===selection.sha256,'SOURCE_SELECTION');
 const sourceFiles=[{path,bytes:raw.length,sha256:sha(raw)}],seen=new Set();let total=0;
 for(const f of selection.files){need(typeof f.path==='string'&&!f.path.includes('\\')&&!f.path.startsWith('/')&&f.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!seen.has(f.path),'SOURCE_PATH');seen.add(f.path);
  const target=join(sourceDirectory,f.path);need(await realpath(target)===target,'SOURCE_PATH');const data=await bytes(target,16*1024*1024);total+=data.length;need(total<=64*1024*1024,'SOURCE_CAPACITY');need(data.length===f.bytes&&sha(data)===f.sha256,'SOURCE_CHANGED',f.path);sourceFiles.push({path:target,bytes:data.length,sha256:f.sha256});}
 return{sourceDirectory,selection,sourceFiles};
}
export async function inspectBinding({workspaceDirectory,sourceDirectory=defaultSourceDirectory,connectionFile}){
 const directory=(await realDirectory(absolute(workspaceDirectory),{privateOnly:true})).path,source=await inspectSource(sourceDirectory);
 const creationPath=join(directory,'creation.json'),raw=await bytes(creationPath,1024*1024,{privateOnly:true}),creation=JSON.parse(raw);
 need(creation.schema==='stellar-forge.curriculum-migration-store.v1'&&UUID.test(creation.id??'')&&creation.directory===directory&&typeof creation.title==='string'&&typeof creation.createdAt==='string'&&typeof creation.defaultBranchId==='string','STORE');
 const nodeExecutable=process.execPath,nodeTarget=await realpath(nodeExecutable);await access(nodeExecutable,constants.X_OK);const nodeRaw=await bytes(nodeTarget,512*1024*1024);
 connectionFile=absolute(connectionFile??join(directory,'curriculum-migration-connection.json'));await privateParent(connectionFile);
 need(!source.sourceFiles.some(f=>f.path===connectionFile)&&connectionFile!==creationPath&&connectionFile!==join(directory,'service.lock'),'CONNECTION_PATH');
 try{const prior=await jsonFile(connectionFile,1024*1024,{privateOnly:true});need(prior.schema===CONNECTION_SCHEMA&&prior.workspaceDirectory===directory&&prior.storeId===creation.id,'CONNECTION_PATH','Existing path belongs to another original file or managed store.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const binding={schema:BINDING_SCHEMA,workspaceDirectory:directory,storeId:creation.id,workspaceId:creation.id,creation:{path:creationPath,bytes:raw.length,sha256:sha(raw)},sourceDirectory:source.sourceDirectory,sourceSha256:source.selection.sha256,sourceFiles:source.sourceFiles,node:{executable:nodeExecutable,resolvedExecutable:nodeTarget,bytes:nodeRaw.length,sha256:sha(nodeRaw)},connectionFile};
 return{binding,bindingSha256:sha(canonical(binding))};
}
export async function processIdentity(){
 const text=await readFile('/proc/self/stat','utf8'),visiblePid=Number(text.slice(0,text.indexOf(' '))),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
 need(Number.isSafeInteger(visiblePid)&&visiblePid>0&&fields[19]&&fields[0]!=='Z','PROCESS');
 return{visiblePid,namespacePid:process.pid,startTicks:fields[19],bootId:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),pidNamespace:await readlink('/proc/self/ns/pid')};
}
export async function verifyProcess(value){
 const id=value.process;need(id&&Number.isSafeInteger(id.visiblePid)&&id.visiblePid>0&&id.namespacePid===value.pid,'PROCESS');
 need((await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()===id.bootId&&await readlink('/proc/self/ns/pid')===id.pidNamespace,'PROCESS_NAMESPACE');
 const path='/proc/'+id.visiblePid,text=await readFile(path+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
 need(Number(text.slice(0,text.indexOf(' ')))===id.visiblePid&&fields[19]===id.startTicks&&fields[0]!=='Z'&&await readlink(path+'/ns/pid')===id.pidNamespace,'PROCESS_CHANGED');return id;
}
export async function readConnection(file,expected={}){
 const value=await jsonFile(absolute(file),1024*1024,{privateOnly:true});
 need(value.schema===CONNECTION_SCHEMA&&value.state==='LISTENING'&&value.sourceSha256===SOURCE_SHA256&&UUID.test(value.instanceId??'')&&UUID.test(value.applicationRequestId??'')&&UUID.test(value.storeId??''),'CONNECTION');
 localUrl(value.url);for(const[k,v]of Object.entries(expected))need(value[k]===v,'CONNECTION_CHANGED',k);await verifyProcess(value);return value;
}
export async function verifyAnnouncement(file,announcement,expected){
 need(announcement.schema===STARTUP_SCHEMA,'STARTUP');const saved=await readConnection(file,expected);
 for(const key of ['instanceId','applicationRequestId','bindingSha256','storeId','workspaceId','workspaceDirectory','sourceSha256','pid','url'])need(saved[key]===announcement[key],'STARTUP_CHANGED');
 need(canonical(saved.process)===canonical(announcement.process),'STARTUP_CHANGED');
 const u=localUrl(saved.url),response=await fetch(new URL('/api/state',u),{headers:{Authorization:'Bearer '+u.hash.slice(1)},redirect:'error',signal:AbortSignal.timeout(30000)});
 need(response.ok,'STARTUP_NOT_READY');const envelope=await response.json(),state=envelope.result;need(envelope.ok===true&&state?.id===saved.storeId&&state.directory===saved.workspaceDirectory&&state.sourceSha256===saved.sourceSha256,'STARTUP_CHANGED');
 return{saved,state};
}
