#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Portable complete prior/current/later source custody; no native Installation writer.
import {mkdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {regular,operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {settleFlowableInstallationFile as settle,retainFlowableInstallationFile as retain} from './flowable-installation-receiving.mjs';
import {catalogueFlowableInstallationSource} from './flowable-installation-source.mjs';
import {reopenFlowableInstallation} from './flowable-installation.mjs';
import {hash,same,ordinary,identity,flowableSourceSelection} from './flowable-installation-core.mjs';
import {FLOWABLE_FOLLOWING_SCHEMA as SCHEMA,compareFlowableInstallationFollowing,applyFlowableInstallationFollowing,followingDigest} from './flowable-installation-following-core.mjs';
const MAX=256*1024*1024,JSON_MAX=64*1024*1024,TOTAL=8*1024*1024*1024,MAX_DEPTH=24;
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const parse=x=>JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(x));
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_SOURCE_DESK_INPUT',status:422});};
const inside=(a,b)=>{const p=relative(a,b);return p===''||!isAbsolute(p)&&p!=='..'&&!p.startsWith('../');};
async function directory(path){
 await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
 need(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o077)&&await realpath(path)===path&&
  (process.getuid===undefined||s.uid===process.getuid()),'Keep complete preparations in owned private directories.');
 return path;
}
async function raw(path,maximum=MAX){await settle(path,null,maximum);return regular(path,maximum);}
async function optional(path,maximum=MAX){try{return await raw(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function put(root,name,body){
 need(ordinary(name)&&body.length<=MAX,'Retain an ordinary complete preparation member within its limit.');
 const parts=name.split('/');let d=root;for(const p of parts.slice(0,-1))d=await directory(join(d,p));
 await retain(join(root,name),body);return identity(name,body);
}
async function owned(options,fn){
 need(options&&typeof options.directory==='string'&&options.directory===resolve(options.directory),'Select the full absolute private preparation directory.');
 const root=await directory(options.directory),lease=await operationLease(join(root,'following.lock'));let primary;
 try{options.signal?.throwIfAborted();return await fn(root);}
 catch(error){primary=error;throw error;}
 finally{try{await lease.close();}catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}}
}
function depth(options){need(Number.isSafeInteger(options.depth??0)&&(options.depth??0)<=MAX_DEPTH,'Keep the complete following chain within 24 retained editions.');return options.depth??0;}
export async function reopenFlowableInstallationPreparation(options={}){
 const level=depth(options),meta=parse(await raw(join(options.directory,'preparation.json'),JSON_MAX));
 return meta.schema===SCHEMA?reopenFlowableInstallationFollowing({...options,depth:level}):reopenFlowableInstallation(options);
}
async function inventory(prepared){
 const names=new Map();
 for(const row of [...prepared.inputs,...prepared.outputs,{name:'prepare-request.json'},{name:'preparation.json'}]){
  need(ordinary(row.name),'Keep every complete preparation member path.');
  const body=await raw(join(prepared.directory,row.name));
  if(row.sha256)need(row.bytes===body.length&&row.sha256===hash(body),'A complete original preparation member changed.');
  const value=identity(row.name,body);if(names.has(row.name))need(same(names.get(row.name),value),'A retained member has conflicting source identities.');
  names.set(row.name,value);
 }
 return [...names.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
async function receive(root,prefix,prepared,files,signal){
 for(const file of files){
  signal?.throwIfAborted();const body=await raw(join(prepared.directory,file.name));
  need(body.length===file.bytes&&hash(body)===file.sha256,'Keep the exact selected whole preparation.');
  await put(root,prefix+'/'+file.name,body);
 }
}
const ref=row=>({id:row.id,revision:row.revision,sha256:row.sha256});
export async function inspectFlowableFollowingLineage(prior,later,signal){
 const archive=await raw(join(later.directory,later.archive.name));
 const catalogue=await catalogueFlowableInstallationSource(archive,{expectedArchiveSha256:later.source.archive.sha256,signal});
 const found=catalogue.programmes.find(x=>x.record.id===prior.source.programme.record.id&&x.record.revision===prior.source.programme.record.revision);
 need(found&&same(found.record,prior.source.programme.record),'The later archive omits or changes the exact earlier programme record.');
 return{workspaceId:catalogue.workspaceId,previousProgrammeRecord:found.record};
}
function build(prior,later,request){
 const comparison=compareFlowableInstallationFollowing({prior,later,native:request.native,selection:request.selection,lineage:request.lineage});
 const applied=applyFlowableInstallationFollowing(comparison,request.review);
 const following={schema:SCHEMA,priorPreparation:{directory:'prior',preparationSha256:prior.preparationSha256},
  laterPreparation:{directory:'later',preparationSha256:later.preparationSha256},
  baselineInstallation:ref(comparison.native.baseline),currentInstallation:ref(comparison.native.current),
  comparisonSha256:comparison.basisSha256,reviewSha256:applied.reviewSha256};
 const sourceRaw=encode(later.source),selection={...flowableSourceSelection(later.source,identity('FLOWABLE_CUSTOMER_SOURCE.json',sourceRaw)),following};
 const markdown='# Following Flowable customer Installation\n\n'+
  'Original Installation: '+following.currentInstallation.id+'; current revision '+following.currentInstallation.revision+
  '; reviewed baseline revision '+following.baselineInstallation.revision+'.\n\n'+
  'This is an explicit source and binding reconciliation. The original native Preview and Save own the actual next revision. No work, acceptance, funding or engine request is performed by this preparation.\n\n'+
  'Keep prior/ and later/ intact, including every preparation.json, prepare-request.json, full Flowable workspace archive, selected native record, source and review. FLOWABLE_FOLLOWING.json retains the complete comparison, choices, both saved native rows and the recorded review.\n\n'+
  'Review the complete installation-input.json and preview it against the current original case. Save deliberately to the same Installation ID using the expected revision. If the case or saved Installation changes, create a new comparison; do not alter this retained request or replay native work.\n\n'+
  'Baseline/current saved Installation histories and both full Flowable archives must be independently received together. Compact selections do not replace their bytes. Original workshare/commercial/acceptance state stays current; later source discrepancies remain visible in the retained comparison.\n\n'+
  'Recorded reviewer: '+applied.review.reviewer+'\n\n'+applied.review.note+'\n';
 const bodies=new Map([
  ['FLOWABLE_CUSTOMER_SOURCE.json',sourceRaw],['FLOWABLE_SOURCE_SELECTION.json',encode(selection)],
  ['FLOWABLE_FOLLOWING.json',encode({schema:SCHEMA+'.delivery',comparison,review:applied.review,reviewSha256:applied.reviewSha256})],
  ['installation-input.json',encode(applied.document)],['installation-preview-input.json',encode(applied.preview)],
  ['WORKORDER.md',Buffer.from(markdown)]
 ]);
 return{comparison,applied,following,bodies};
}
async function verify(root,options,requestRaw){
 const request=parse(requestRaw);need(request.schema===SCHEMA+'.request'&&Array.isArray(request.inputs)&&request.inputs.length>0&&
  new Set(request.inputs.map(x=>x.name)).size===request.inputs.length,'Keep the complete original following preparation request.');
 let total=0;
 for(const file of request.inputs){
  need(ordinary(file.name)&&(file.name.startsWith('prior/')||file.name.startsWith('later/'))&&
   Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX&&/^[a-f0-9]{64}$/.test(file.sha256),
   'Retain complete prior and later preparation identities.');
  options.signal?.throwIfAborted();const body=await raw(join(root,file.name));
  need(body.length===file.bytes&&hash(body)===file.sha256,'A complete following input changed: '+file.name);total+=file.bytes;
 }
 need(total<=TOTAL,'The whole joined preparation exceeds the existing eight-GiB receiving limit.');
 const level=depth(options);
 const prior=await reopenFlowableInstallationPreparation({directory:join(root,'prior'),signal:options.signal,depth:level+1});
 const later=await reopenFlowableInstallation({directory:join(root,'later'),signal:options.signal});
 const expectedInputs=[...(await inventory(prior)).map(x=>({...x,name:'prior/'+x.name})),
  ...(await inventory(later)).map(x=>({...x,name:'later/'+x.name}))];
 need(same(expectedInputs,request.inputs),'Retain all complete nested metadata and source files, with no omitted originals.');
 need(prior.preparationSha256===request.priorPreparationSha256&&later.preparationSha256===request.laterPreparationSha256,
  'The exact original preparation editions changed.');
 need(same(request.lineage,await inspectFlowableFollowingLineage(prior,later,options.signal)),'Retain the original source history lineage.');
 const made=build(prior,later,request),completeRaw=await raw(join(root,'preparation.json'),JSON_MAX),complete=parse(completeRaw);
 need(complete.schema===SCHEMA&&complete.state==='PREPARED'&&complete.requestSha256===hash(requestRaw)&&
  same(complete.inputs,request.inputs)&&same(complete.following,made.following)&&same(complete.installationSource,made.applied.installationSource)&&
  complete.workshareCaseId===made.applied.workshareCaseId&&same(complete.selections,later.selections),
  'The whole following preparation metadata differs from its exact original source.');
 const outputs=[];
 for(const [name,body]of made.bodies){
  const retained=await raw(join(root,name));need(retained.equals(body),'The retained following output differs: '+name);
  outputs.push(identity(name,body));
 }
 const expected={schema:SCHEMA,state:'PREPARED',requestSha256:hash(requestRaw),inputs:request.inputs,outputs,
  workspaceId:later.source.workspaceId,archiveSha256:later.source.archive.sha256,
  programmeId:later.source.programme.record.id,programmeRevision:later.source.programme.record.revision,
  programmeSha256:later.source.programme.programmeSha256,basisSha256:later.source.programme.basisSha256,
  installationSource:made.applied.installationSource,workshareCaseId:made.applied.workshareCaseId,
  selections:later.selections,following:made.following};
 need(same(expected,complete),'Retain every complete following output and the exact reproduced source, programme, archive and native summary.');
 return{...complete,directory:root,preparationSha256:hash(completeRaw),preparationBytes:completeRaw.length,offline:true,
  archive:{name:'later/'+later.archive.name,bytes:later.archive.bytes,sha256:later.archive.sha256},
  source:later.source,preview:made.applied.preview,document:made.applied.document,comparison:made.comparison,review:made.applied.review};
}
export async function prepareFlowableInstallationFollowing(options={}){
 return owned(options,async root=>{
  depth(options);
  for(const path of [options.priorPreparationDirectory,options.laterPreparationDirectory])
   need(typeof path==='string'&&path===resolve(path)&&!inside(root,path)&&!inside(path,root),
    'Keep the two complete source preparations separate from the new owned output directory.');
  const prior=await reopenFlowableInstallationPreparation({directory:options.priorPreparationDirectory,signal:options.signal,depth:(options.depth??0)+1});
  const later=await reopenFlowableInstallation({directory:options.laterPreparationDirectory,signal:options.signal});
  const priorFiles=await inventory(prior),laterFiles=await inventory(later);
  const inputs=[...priorFiles.map(x=>({...x,name:'prior/'+x.name})),...laterFiles.map(x=>({...x,name:'later/'+x.name}))];
  need(inputs.reduce((n,x)=>n+x.bytes,0)<=TOTAL,'Retain the full joined source within the original eight-GiB limit.');
  const request={schema:SCHEMA+'.request',priorPreparationSha256:prior.preparationSha256,laterPreparationSha256:later.preparationSha256,
   native:options.native,selection:options.selection,review:options.review,lineage:await inspectFlowableFollowingLineage(prior,later,options.signal),inputs};
  const made=build(prior,later,request),requestRaw=encode(request);
  need(requestRaw.length<=JSON_MAX,'Retain the full comparison input within 64 MiB.');
  await put(root,'prepare-request.json',requestRaw);
  if(await optional(join(root,'preparation.json'),JSON_MAX))return verify(root,options,requestRaw);
  await receive(root,'prior',prior,priorFiles,options.signal);await receive(root,'later',later,laterFiles,options.signal);
  const outputs=[];for(const [name,body]of made.bodies)outputs.push(await put(root,name,body));
  const complete={schema:SCHEMA,state:'PREPARED',requestSha256:hash(requestRaw),inputs,outputs,
   workspaceId:later.source.workspaceId,archiveSha256:later.source.archive.sha256,
   programmeId:later.source.programme.record.id,programmeRevision:later.source.programme.record.revision,
   programmeSha256:later.source.programme.programmeSha256,basisSha256:later.source.programme.basisSha256,
   installationSource:made.applied.installationSource,workshareCaseId:made.applied.workshareCaseId,
   selections:later.selections,following:made.following};
  await put(root,'preparation.json',encode(complete));return verify(root,options,requestRaw);
 });
}
export async function reopenFlowableInstallationFollowing(options={}){
 return owned(options,async root=>verify(root,options,await awaitRaw(root)));
}
async function awaitRaw(root){return raw(join(root,'prepare-request.json'),JSON_MAX);}
export async function main(argv=process.argv.slice(2)){
 const [command,...rest]=argv,options={};
 need(['prepare','reopen'].includes(command),'Use following prepare|reopen with complete source inputs.');
 const keys={'directory':'directory','prior':'priorPreparationDirectory','later':'laterPreparationDirectory','input':'input'};
 for(let i=0;i<rest.length;i+=2){const k=rest[i]?.slice(2);need(rest[i]?.startsWith('--')&&keys[k]&&rest[i+1]&&!options[keys[k]],'Use unique complete --name value arguments.');options[keys[k]]=rest[i+1];}
 let result;
 if(command==='prepare'){
  need(options.input,'Use --input containing full native, selection and explicit review.');
  const input=parse(await raw(resolve(options.input),JSON_MAX));delete options.input;
  result=await prepareFlowableInstallationFollowing({...options,native:input.native,selection:input.selection,review:input.review});
 }else{need(Object.keys(options).every(k=>k==='directory'),'Cold reopen only needs the retained full --directory.');result=await reopenFlowableInstallationFollowing(options);}
 return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().then(x=>process.stdout.write(JSON.stringify(x)+'\n')).catch(error=>{console.error(error.message);process.exitCode=2;});
