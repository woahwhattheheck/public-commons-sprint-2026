// MIT. Bind the actual original source, workspace identity and selected interpreter.
import {realpath,access,open,readFile,readlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_SCHEMA,SOURCE_SHA256,BINDING_SCHEMA,CONNECTION_SCHEMA,STARTUP_SCHEMA,UUID,sha,canonical,need,bytes,jsonFile,absolute,realDirectory,privateParent,localUrl} from './contract.mjs';
export const defaultSourceDirectory=join(dirname(fileURLToPath(import.meta.url)),'app');
export async function inspectSource(sourceDirectory=defaultSourceDirectory){
 sourceDirectory=(await realDirectory(absolute(sourceDirectory))).path;
 const selectionPath=join(sourceDirectory,'source-selection.json'),selectionRaw=await bytes(selectionPath,2*1024*1024),selection=JSON.parse(selectionRaw);
 need(selection.schema===SOURCE_SCHEMA&&selection.sha256===SOURCE_SHA256&&Array.isArray(selection.files)&&selection.files.length===169,'SOURCE_SELECTION','Use this complete original 170-file application edition.');
 const copy={...selection};delete copy.sha256;need(sha(canonical(copy))===selection.sha256,'SOURCE_SELECTION');
 const sourceFiles=[{path:selectionPath,bytes:selectionRaw.length,sha256:sha(selectionRaw)}],seen=new Set();
 for(const item of selection.files){
  need(typeof item.path==='string'&&!item.path.includes('\\')&&!item.path.startsWith('/')&&item.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!seen.has(item.path),'SOURCE_PATH');seen.add(item.path);
  const path=join(sourceDirectory,item.path);need(await realpath(path)===path,'SOURCE_PATH');const raw=await bytes(path);
  need(raw.length===item.bytes&&sha(raw)===item.sha256,'SOURCE_CHANGED',item.path);sourceFiles.push({path,bytes:raw.length,sha256:item.sha256});
 }
 return {sourceDirectory,selection,sourceFiles};
}
export async function inspectBinding({workspaceDirectory,sourceDirectory=defaultSourceDirectory,pythonExecutable='/usr/bin/python3',nodeExecutable=process.execPath,pairedWorkspaceDirectory,pairedWorkspaceId,connectionFile,receivingDirectory}){
 const workspace=await realDirectory(absolute(workspaceDirectory),{privateOnly:true});
 const {sourceDirectory:resolvedSource,selection,sourceFiles}=await inspectSource(sourceDirectory);sourceDirectory=resolvedSource;
 const creationPath=join(workspace.path,'creation.json'),creationBytes=await bytes(creationPath,1024*1024),creation=JSON.parse(creationBytes);
 need(creation.schema==='geocove.highway-creation.v1'&&UUID.test(creation.id)&&typeof creation.createdAt==='string','WORKSPACE');
 const database=await open(join(workspace.path,'workspace.sqlite3'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{need((await database.stat()).isFile(),'WORKSPACE');}finally{await database.close();}
 pythonExecutable=absolute(pythonExecutable);need(await realpath(dirname(pythonExecutable))===dirname(pythonExecutable),'EXECUTABLE_PARENT');
 const pythonTarget=await realpath(pythonExecutable);await access(pythonExecutable,constants.X_OK);
 const interpreter=await bytes(pythonTarget,512*1024*1024);
 let pythonConfiguration=null;const configuration=join(dirname(dirname(pythonExecutable)),'pyvenv.cfg');
 try{const raw=await bytes(configuration,1024*1024);pythonConfiguration={path:configuration,bytes:raw.length,sha256:sha(raw)};}catch(error){if(error.code!=='ENOENT')throw error;}
 nodeExecutable=absolute(nodeExecutable);need(await realpath(dirname(nodeExecutable))===dirname(nodeExecutable),'EXECUTABLE_PARENT');
 const nodeTarget=await realpath(nodeExecutable);await access(nodeExecutable,constants.X_OK);
 const nodeBytes=await bytes(nodeTarget,512*1024*1024);
 need(Boolean(pairedWorkspaceDirectory)===Boolean(pairedWorkspaceId),'PAIRED_BINDING','Select both the existing original paired directory and its 32-hex warehouse identity.');
 let paired=null;
 if(pairedWorkspaceDirectory){
  const directory=(await realDirectory(absolute(pairedWorkspaceDirectory),{privateOnly:true})).path;
  need(/^[a-f0-9]{32}$/.test(pairedWorkspaceId),'PAIRED_ID');
  const h=await open(join(directory,'warehouse.duckdb'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await h.stat();need(info.isFile()&&info.nlink===1&&(info.mode&0o077)===0,'PAIRED_DATABASE');}finally{await h.close();}
  paired={directory,workspaceId:pairedWorkspaceId,duckdbVersion:'1.5.6'};
 }
 connectionFile=absolute(connectionFile??join(workspace.path,'highway-field-operations-connection.json'));await privateParent(connectionFile);
 receivingDirectory=absolute(receivingDirectory??join(dirname(workspace.path),'received-workspaces'));
 const receiver=await realDirectory(receivingDirectory,{missing:true,privateOnly:true});
 const relation=relative(workspace.path,receivingDirectory),back=relative(receivingDirectory,workspace.path);
 need(relation&&back&&(relation==='..'||relation.startsWith('../'))&&(back==='..'||back.startsWith('../')),'RECEIVING_OVERLAP','Choose a separate receiving directory.');
 if(!receiver.exists)await realDirectory(dirname(receivingDirectory),{privateOnly:true});
 const binding={schema:BINDING_SCHEMA,workspaceDirectory:workspace.path,workspaceId:creation.id,createdAt:creation.createdAt,
 creation:{path:creationPath,bytes:creationBytes.length,sha256:sha(creationBytes)},sourceDirectory,sourceSha256:selection.sha256,
 sourceFiles,python:{executable:pythonExecutable,resolvedExecutable:pythonTarget,bytes:interpreter.length,sha256:sha(interpreter),configuration:pythonConfiguration},node:{executable:nodeExecutable,resolvedExecutable:nodeTarget,bytes:nodeBytes.length,sha256:sha(nodeBytes)},paired,connectionFile,receivingDirectory};
 return {binding,bindingSha256:sha(canonical(binding))};
}
export async function verifyProcess(value){
 const identity=value.process;
 need(identity&&Number.isSafeInteger(identity.visiblePid)&&identity.visiblePid>0&&identity.namespacePid===value.pid&&
 typeof identity.startTicks==='string','PROCESS');
 const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),namespace=await readlink('/proc/self/ns/pid');
 need(boot===identity.bootId&&namespace===identity.pidNamespace,'PROCESS_NAMESPACE','The original service process is outside this verified namespace.');
 const base='/proc/'+identity.visiblePid,data=await readFile(base+'/stat','utf8');
 need(Number(data.slice(0,data.indexOf(' ')))===identity.visiblePid&&data.slice(data.lastIndexOf(')')+2).split(/\s+/)[19]===identity.startTicks&&
 await readlink(base+'/ns/pid')===identity.pidNamespace,'PROCESS_CHANGED','The original managed process has stopped or changed.');
 return identity;
}
export async function readConnection(file,expected={}){
 const value=await jsonFile(absolute(file),1024*1024,{privateOnly:true});
 need(value.schema===CONNECTION_SCHEMA&&value.state==='LISTENING'&&UUID.test(value.instanceId??'')&&UUID.test(value.applicationRequestId??''),'CONNECTION','The original managed service is not listening.');
 need(value.sourceSha256===SOURCE_SHA256&&Number.isSafeInteger(value.pid)&&value.pid>0,'CONNECTION');localUrl(value.url);
 for(const [key,want]of Object.entries(expected))need(value[key]===want,'CONNECTION_CHANGED','The saved connection differs: '+key);
 await verifyProcess(value);return value;
}
export async function verifyAnnouncement(file,announcement,expected){
 need(announcement.schema===STARTUP_SCHEMA,'STARTUP');
 const saved=await readConnection(file,expected);
 for(const key of ['instanceId','applicationRequestId','bindingSha256','workspaceId','workspaceDirectory','sourceSha256','pid','url'])need(saved[key]===announcement[key],'STARTUP_CHANGED');
 need(canonical(saved.process)===canonical(announcement.process),'STARTUP_CHANGED');
 const url=localUrl(saved.url),requestUrl=new URL('/api/state',url);const response=await fetch(requestUrl,{headers:{'Authorization':'Bearer '+url.hash.slice(1)},redirect:'error',signal:AbortSignal.timeout(30000)});
 need(response.ok,'STARTUP_NOT_READY');const state=await response.json();
 need(state.state?.id===saved.workspaceId&&state.directory===saved.workspaceDirectory&&state.sourceSha256===saved.sourceSha256,'STARTUP_CHANGED');
 return {saved,state};
}
