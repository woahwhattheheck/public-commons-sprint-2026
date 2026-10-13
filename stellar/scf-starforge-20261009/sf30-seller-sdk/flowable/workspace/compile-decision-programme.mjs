#!/usr/bin/env node
// MIT. Author one complete operator programme from the selected original DMN source.
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {buildFlowableDecisionProgramme} from './decision-programme.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function original(path,maximum=16*1024*1024){
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const a=await h.stat();need(a.isFile()&&a.size<=maximum,'Select a complete ordinary original source file: '+path);
  const raw=await h.readFile(),b=await h.stat();
  need(a.dev===b.dev&&a.ino===b.ino&&a.size===raw.length&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs,
   'Original source changed during receiving: '+path);
  return {raw,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)};
 }finally{await h.close();}
}
function name(value){need(typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..'),
 'Use a complete relative source name.');return value;}
export async function compileDecisionProgramme(configurationPath,outputPath){
 configurationPath=resolve(configurationPath);outputPath=resolve(outputPath);
 const configuration=await original(configurationPath,1024*1024),config=JSON.parse(configuration.text);
 need(config.schema==='stellar-forge.flowable-decision-programme-compile.v1','Select a decision programme compile configuration.');
 const fields=new Set(['schema','catalog','operation','familyKeys','tenantId']);
 need(Object.keys(config).every(k=>fields.has(k)),'The original compile configuration contains an undeclared field.');
 need(typeof config.catalog==='string',
  'Select the complete original decision catalogue and its embedded typed cases.');
 const directory=dirname(configurationPath),catalogPath=resolve(directory,config.catalog),catalog=await original(catalogPath),value=JSON.parse(catalog.text);
 const members={},inventory=[];
 function retain(member,source,path,mediaType){
  name(member);need(!Object.hasOwn(members,member),'Two source files selected the same portable name.');
  members[member]={text:source.text,bytes:source.raw.length,sha256:sha(source.raw),mediaType,contentBase64:source.raw.toString('base64')};
  inventory.push({name:member,path,bytes:source.raw.length,sha256:members[member].sha256});
 }
 retain('decision-catalog.json',catalog,catalogPath,'application/json');
 need(Array.isArray(value.families),'The complete original decision families are required.');
 for(const family of value.families){
  need(Array.isArray(family.files),'Each original decision family retains its source files.');
  for(const item of family.files){
   const filename=name(item.filename);
   need(!filename.includes('/'),'The original decision source is one native filename.');
   const path=resolve(dirname(catalogPath),filename);
   retain(filename,await original(path),path,'application/xml');
  }
 }
 const programme=buildFlowableDecisionProgramme({catalogText:catalog.text,members,operation:config.operation,
  familyKeys:config.familyKeys,tenantId:config.tenantId});
 const raw=Buffer.from(JSON.stringify(programme,null,2)+'\n'),temporary=join(dirname(outputPath),'.'+basename(outputPath)+'.'+randomUUID()+'.pending');
 need(raw.length<=16*1024*1024,'The complete programme exceeds the original 16 MiB intake limit.');
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
 return {schema:'stellar-forge.flowable-decision-programme-compiled.v1',operation:programme.key,
  configuration:{path:configurationPath,bytes:configuration.raw.length,sha256:sha(configuration.raw)},
  output:{path:outputPath,bytes:raw.length,sha256:sha(raw)},steps:programme.steps.length,sources:inventory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{need(process.argv.length===4,'Usage: node compile-decision-programme.mjs CONFIGURATION.json OUTPUT.programme.json');
  process.stdout.write(JSON.stringify(await compileDecisionProgramme(process.argv[2],process.argv[3]),null,2)+'\n');
 }catch(error){process.stderr.write(JSON.stringify({error:error.code??'FLOWABLE_DECISION_PROGRAMME_COMPILE',message:error.message})+'\n');process.exitCode=1;}
}
