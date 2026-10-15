#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,domainToASCII} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import triageModule from '../source/contact-route-triage.cjs';
import publication from '../source/source-publication.cjs';
const toolRoot=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==4)throw Error('Usage: node native/triage-contact-route.mjs ORIGINAL_INPUT_JSON NEW_OUTPUT_DIRECTORY');
const inputPath=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const stat=await fs.lstat(inputPath);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('Use one ordinary complete input up to 64 MiB.');
const inputBytes=await fs.readFile(inputPath),inputText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(inputBytes);
if(!Buffer.from(inputText).equals(inputBytes))throw Error('Input must preserve exact UTF-8 bytes.');
const input=JSON.parse(inputText);
const hash=value=>{const b=Buffer.from(value);return {bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
const api=triageModule.createContactRouteTriage({encode:s=>new Uint8Array(Buffer.from(s)),hash:s=>hash(s).sha256,domainToASCII});
const report=api.triage(input),files={
 'input/original-input.json':inputText,
 'report/contact-route-triage.json':JSON.stringify(report,null,2)+'\n',
 'report/CONTACT_ROUTE_REVIEW.md':api.render(report)
};
const originals=[...input.documents,...input.dns];
for(let i=0;i<originals.length;i++)files['originals/'+String(i+1).padStart(3,'0')+(originals[i].format==='html'?'.html':originals[i].format==='dns-json'?'.json':'.txt')]=originals[i].body;
files['originals/index.json']=JSON.stringify(originals.map((s,i)=>({id:s.id,url:s.url,retrievedAt:s.retrievedAt??null,...(s.retrievedDate?{retrievedDate:s.retrievedDate}:{}),format:s.format,path:'originals/'+String(i+1).padStart(3,'0')+(s.format==='html'?'.html':s.format==='dns-json'?'.json':'.txt'),...hash(s.body)})),null,2)+'\n';
async function collect(relative){
 for(const item of await fs.readdir(path.join(toolRoot,relative),{withFileTypes:true})){
  const rel=relative+'/'+item.name;
  if(item.isSymbolicLink())throw Error('Tool source links are not accepted.');
  if(item.isDirectory())await collect(rel);
  else if(item.isFile())files[rel]=await fs.readFile(path.join(toolRoot,rel),'utf8');
  else throw Error('Unsupported tool source member.');
 }
}
await collect('runtime');
for(const rel of ['source/contact-route-triage.cjs','source/CONTACT_ROUTE_TRIAGE.md','source/source-publication.cjs','native/triage-contact-route.mjs','course/contact-route-triage.cjs','course/contact-route-example.json'])
 files[rel]=await fs.readFile(path.join(toolRoot,rel),'utf8');
files['README.md']='# Retained contact-route review\n\nRead report/CONTACT_ROUTE_REVIEW.md. input/original-input.json and originals/ retain the complete selected public source and DNS observations; any original delivery evidence remains in the input and is private. No message or form was sent and no customer record was changed.\n\nReproduce into a separate new directory:\n\n    node native/triage-contact-route.mjs input/original-input.json /absolute/new-route-review\n\nRun the generic authored source course with node course/contact-route-triage.cjs. Read source/CONTACT_ROUTE_TRIAGE.md for scope, raw evidence and existing delivery-receiver integration. Public examples are authored reserved domains, not real customers.\n';
const sourceReal=await fs.realpath(toolRoot),outputReal=path.join(await fs.realpath(path.dirname(output)),path.basename(output));
if(outputReal===sourceReal||outputReal.startsWith(sourceReal+path.sep)||inputPath===outputReal||inputPath.startsWith(outputReal+path.sep))throw Error('Keep a new independent output outside original inputs and tool source.');
const bank={schema:'commons.contact-route-source.v1',caseReference:input.caseReference,checkedAt:input.checkedAt,input:hash(inputBytes),reportSha256:report.sha256,
 files,manifest:Object.entries(files).map(([path,body])=>({path,...hash(body)}))};
const bankBody=JSON.stringify(bank,null,2)+'\n';
const op=await publication.createPublication({fs,path,hash,encode:(v,e)=>Buffer.from(v,e),randomId:randomUUID,syncDirectories:process.platform!=='win32'}).open({
 output,binding:{schema:'commons.contact-route-publication.v1',input:hash(inputBytes),complete_source:hash(bankBody)},recordedAt:input.checkedAt});
const receipt=await op.publish([...Object.entries(files).map(([path,body])=>({path,body})),{path:'complete-source.json',body:bankBody}]);
console.log(JSON.stringify({output,reportSha256:report.sha256,recoveryState:report.recovery.state,publishedCandidates:report.routes.length,source:hash(bankBody),publication:receipt},null,2));
