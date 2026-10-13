#!/usr/bin/env node
// Assemble the existing nine-section OTF proposal and the original issuer workbook.
import { readFile, writeFile, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { check, render } from './vendor-core.mjs';
import { validateVendorAttachments } from './vendor-attachments.mjs';
import { buildIssuerBudget, ISSUER_TEMPLATE } from './issuer-budget.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const encode=s=>Buffer.from(s,'utf8');
const json=x=>JSON.stringify(x,null,2)+'\n';
export function prepareVendorPackage(doc,template,inputBytes=encode(json(doc))) {
  const quality=check(doc),budget=buildIssuerBudget(template,doc);
  for(const key of budget.mapping.missing)if(!quality.needs.includes(key))quality.needs.push(key);
  const contentComplete=quality.needs.length===0&&quality.warnings.length===0;
  const submissionIssues=[];let submission=null,attachments={files:[],manifest:[]};
  try{attachments=validateVendorAttachments(doc,hash);}catch(e){submissionIssues.push(e.message);}
  if(contentComplete&&submissionIssues.length===0){try{submission=render(doc,quality,{audience:'submission',attachments:attachments.manifest});}catch(e){submissionIssues.push(e.message);}}
  const submissionComplete=contentComplete&&submissionIssues.length===0;
  const outputs={
    'proposal-review.md':encode(render(doc,quality)),
    [budget.mapping.output.file]:budget.bytes,
    'budget-mapping.json':encode(json(budget.mapping)),
    'vendor-input.json':inputBytes,
    'readiness.json':encode(json({
      schema:'otf-rrf-vendor-readiness/v2',
      issuer:'https://www.opentech.fund/news/open-technology-fund-requests-proposals-for-the-rapid-response-fund/',
      deadline:'2026-11-23 23:59 EST',
      completeness:contentComplete?'CONTENT_COMPLETE':'INCOMPLETE',
      submissionEdition:submissionComplete?'INCLUDED':'AWAITING_SOURCE_FIELDS',submissionIssues,
      missing:quality.needs,warnings:quality.warnings,
      budget:{file:budget.mapping.output.file,sha256:budget.mapping.output.sha256},
      sourceTemplate:{file:ISSUER_TEMPLATE.file,sha256:ISSUER_TEMPLATE.sha256}
    }))
  };
  for(const attachment of attachments.files)outputs[attachment.name]=attachment.bytes;
  const submissionFiles={};
  if(submissionComplete){outputs['proposal-submission.md']=encode(submission);for(const name of ['proposal-submission.md',budget.mapping.output.file,...attachments.files.map(file=>file.name)])submissionFiles[name]=outputs[name];outputs['submission-files.json']=encode(json({schema:'commons.otf-submission-files.v1',files:Object.entries(submissionFiles).map(([name,bytes])=>({name,bytes:bytes.length,sha256:hash(bytes)}))}));}
  return {outputs,quality,budget:budget.mapping,contentComplete,submissionComplete,submissionIssues,submissionFiles,attachments:attachments.manifest};
}
async function existing(path) {
  try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function retainExact(path,content,requestId) {
  const target=await existing(path);
  if(target){if(!target.equals(Buffer.from(content)))throw Error('Existing output differs: '+path);return 'reused';}
  // Each invocation has its own temporary inode; concurrent same-input builds
  // cannot truncate a file after another caller has linked it into place.
  const temporary=join(dirname(path),'.otf-'+requestId+'-'+randomUUID()+'.partial');
  await writeFile(temporary,content,{flag:'wx',mode:0o600});
  try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;const current=await readFile(path);if(!current.equals(Buffer.from(content)))throw Error('Concurrent output differs: '+path);}
  await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  return 'written';
}
export async function materializeVendorPackage(directory,prepared,source={}) {
  const entries=Object.entries(prepared.outputs).sort(([a],[b])=>a.localeCompare(b));
  const plan={schema:'otf-rrf-vendor-build/v1',source,files:entries.map(([name,b])=>({name,bytes:b.length,sha256:hash(b)}))};
  const planBytes=encode(json(plan)),requestId=hash(planBytes);
  try{await mkdir(directory,{recursive:false,mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const names=await readdir(directory),allowed=new Set(['operation.json','complete.json',...entries.map(([n])=>n)]);
  for(const name of names)if(!allowed.has(name)&&!name.startsWith('.otf-'+requestId+'-'))throw Error('Destination contains a different operation: '+name);
  await retainExact(join(directory,'operation.json'),planBytes,requestId);
  const results=[];
  for(const [name,content] of entries)results.push({name,state:await retainExact(join(directory,name),content,requestId)});
  const completed={schema:'otf-rrf-vendor-build-complete/v1',requestId,files:plan.files};
  await retainExact(join(directory,'complete.json'),encode(json(completed)),requestId);
  return {requestId,outDir:directory,status:prepared.contentComplete?'CONTENT_COMPLETE':'INCOMPLETE',submissionEdition:prepared.submissionComplete?'INCLUDED':'AWAITING_SOURCE_FIELDS',missing:prepared.quality.needs.length,warnings:prepared.quality.warnings.length,files:results};
}
async function main(){
  const [input,flag,dir,...tail]=process.argv.slice(2);
  if(!input||flag!=='--out-dir'||!dir||!(tail.length===0||(tail.length===2&&tail[0]==='--template')))throw Error('Usage: node assemble.mjs VENDOR.json --out-dir OUTPUT_DIRECTORY [--template ORIGINAL.xlsx]');
  const inputBytes=await readFile(resolve(input)),doc=JSON.parse(inputBytes);
  const template=await readFile(tail.length?resolve(tail[1]):join(root,'sources',ISSUER_TEMPLATE.file));
  const prepared=prepareVendorPackage(doc,template,inputBytes);
  const output=await materializeVendorPackage(resolve(dir),prepared,{inputSha256:hash(inputBytes),templateSha256:hash(template)});
  process.stdout.write(json(output));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write('Vendor package: '+e.message+'\n');process.exitCode=1;});
