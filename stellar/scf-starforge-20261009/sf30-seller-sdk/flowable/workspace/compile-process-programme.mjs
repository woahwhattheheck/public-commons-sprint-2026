#!/usr/bin/env node
// MIT. Author one complete operator programme from the selected original BPMN source.
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {buildFlowableProcessProgramme} from './process-programme.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function original(path,maximum=16*1024*1024){
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const a=await h.stat();need(a.isFile()&&a.size<=maximum,'Select a complete ordinary original source file: '+path);
  const raw=await h.readFile(),b=await h.stat();
  need(a.dev===b.dev&&a.ino===b.ino&&a.size===raw.length&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs,
   'Original source changed during receiving: '+path);
  return {raw,text:new TextDecoder('utf-8',{fatal:true}).decode(raw)};
 }finally{await h.close();}
}
function name(value){need(typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..'),
 'Use a complete relative source name.');return value;}
export async function compileProcessProgramme(configurationPath,outputPath){
 configurationPath=resolve(configurationPath);outputPath=resolve(outputPath);
 const configuration=await original(configurationPath,1024*1024),config=JSON.parse(configuration.text);
 need(config.schema==='stellar-forge.flowable-process-programme-compile.v1','Select a process programme compile configuration.');
 const fields=new Set(['schema','catalog','inputs','operation','roles','familyKeys','migrateKeys','delegationKey','tenantId']);
 need(Object.keys(config).every(k=>fields.has(k)),'The original compile configuration contains an undeclared field.');
 need(typeof config.catalog==='string'&&config.inputs&&typeof config.inputs==='object'&&!Array.isArray(config.inputs),
  'Select the original catalogue and all original typed input paths.');
 const directory=dirname(configurationPath),catalogPath=resolve(directory,config.catalog),catalog=await original(catalogPath),value=JSON.parse(catalog.text);
 const members={},inputs={},inventory=[];
 function retain(member,source,path,mediaType){
  name(member);need(!Object.hasOwn(members,member),'Two source files selected the same portable name.');
  members[member]={text:source.text,bytes:source.raw.length,sha256:sha(source.raw),mediaType,contentBase64:source.raw.toString('base64')};
  inventory.push({name:member,path,bytes:source.raw.length,sha256:members[member].sha256});
 }
 retain('process-catalog.json',catalog,catalogPath,'application/json');
 need(Array.isArray(value.resources),'The complete original catalogue resources are required.');
 for(const item of value.resources){
  const filename=name(item.filename),path=resolve(dirname(catalogPath),filename);
  retain(filename,await original(path),path,'application/xml');
 }
 for(const [key,input]of Object.entries(config.inputs)){
  need(typeof input==='string','Select one complete original typed-input path per process family.');
  const path=resolve(directory,input),member='inputs/'+name(key)+'.json';
  retain(member,await original(path),path,'application/json');inputs[key]=member;
 }
 const programme=buildFlowableProcessProgramme({catalogText:catalog.text,members,inputs,operation:config.operation,roles:config.roles,
  familyKeys:config.familyKeys,migrateKeys:config.migrateKeys,delegationKey:config.delegationKey,tenantId:config.tenantId});
 const raw=Buffer.from(JSON.stringify(programme,null,2)+'\n'),temporary=join(dirname(outputPath),'.'+basename(outputPath)+'.'+randomUUID()+'.pending');
 const h=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  try{await link(temporary,outputPath);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await original(outputPath,32*1024*1024);
   need(existing.raw.equals(raw),'The existing programme contains another source edition; select a new output filename.');
  }
  const parent=await open(dirname(outputPath),constants.O_RDONLY|constants.O_DIRECTORY);
  try{await parent.sync();}finally{await parent.close();}
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {schema:'stellar-forge.flowable-process-programme-compiled.v1',operation:programme.key,
  configuration:{path:configurationPath,bytes:configuration.raw.length,sha256:sha(configuration.raw)},
  output:{path:outputPath,bytes:raw.length,sha256:sha(raw)},steps:programme.steps.length,sources:inventory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{need(process.argv.length===4,'Usage: node compile-process-programme.mjs CONFIGURATION.json OUTPUT.programme.json');
  process.stdout.write(JSON.stringify(await compileProcessProgramme(process.argv[2],process.argv[3]),null,2)+'\n');
 }catch(error){process.stderr.write(JSON.stringify({error:error.code??'FLOWABLE_PROCESS_PROGRAMME_COMPILE',message:error.message})+'\n');process.exitCode=1;}
}
