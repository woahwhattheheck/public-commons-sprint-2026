#!/usr/bin/env node
// MIT. Receive one complete original native customer source into the existing Installation preparer.
import {join,resolve,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readProfile} from './profiles.mjs';
import {bindingTemplate} from './prepare-core.mjs';
import {acquireStateLease} from '../../../scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {initializationDirectory as directory,initializationBytes as bytes,optionalInitializationBytes as optionalBytes,
  retainInitializationFile as retain,initializationJson as json} from '../../../scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {OPENFEMA_INSTALLATION_SCHEMA as SCHEMA,OPENFEMA_INSTALLATION_PROFILE as PROFILE,hash,need,parse,same,identity,
  inspectOpenFemaInstallationSource,composeOpenFemaInstallation} from './openfema-installation-core.mjs';
const MAX_ARCHIVE=1024*1024*1024,MAX_FILE=256*1024*1024,MAX_JSON=2*1024*1024,MAX_OUTPUT=32*1024*1024;
const OUTPUTS=['derived-bindings.json','OPENFEMA_CUSTOMER_SOURCE.json','OPENFEMA_CUSTOMER_SOURCE.md','installation-input.json','installation-preview-input.json','WORKORDER.md'];
const FIXED=['source/OpenFEMA_Complete_Workspace.zip','source/seed.json','source/bindings.json','source/profile.json','source/attachments.json'];
const ordinary=name=>typeof name==='string'&&name.length>0&&name.length<=1024&&!/^[\\/]|[\\:\x00-\x1f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const limit=name=>name===FIXED[0]?MAX_ARCHIVE:name.startsWith('attachments/')?MAX_FILE:MAX_JSON;
async function parent(root,name){
 need(ordinary(name),'Keep a complete ordinary relative member name.');
 const parts=name.split('/');parts.pop();let current=root;
 for(const part of parts){current=join(current,part);await directory(current,{create:true});}
}
async function write(root,name,body){
 await parent(root,name);await retain(join(root,name),body,{resume:true});return identity(name,body);
}
async function readSelected(root,file){
 need(file&&ordinary(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=limit(file.name)&&/^[a-f0-9]{64}$/.test(file.sha256),
   'Keep each complete selected input identity.');
 const body=await bytes(join(root,file.name),limit(file.name));
 need(body.length===file.bytes&&hash(body)===file.sha256,'The retained original input changed: '+file.name);
 return body;
}
async function owned(destination,fn){
 need(typeof destination==='string'&&destination.length>0&&!destination.includes('\0'),'Select the owned private preparation directory.');
 const root=resolve(destination);await directory(root,{create:true});const lease=await acquireStateLease(root);
 let primary;
 try{lease.assertHeld();return await fn(root,lease);}
 catch(error){primary=error;throw error;}
 finally{try{await lease.close();}catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}}
}
function checkSelection(request,options){
 need(request?.schema===SCHEMA+'.request'&&typeof request.deliveryId==='string'&&/^[a-f0-9]{64}$/.test(request.archiveSha256)&&
  Array.isArray(request.inputs)&&request.inputs.length>=FIXED.length&&request.inputs.length<=FIXED.length+256,
  'Use the complete original preparation request.');
 need(FIXED.every((name,i)=>request.inputs[i]?.name===name)&&new Set(request.inputs.map(x=>x.name)).size===request.inputs.length&&
  request.inputs.slice(FIXED.length).every(x=>x.name.startsWith('attachments/')),
  'Keep the full original seed, bindings, profile, source and working-file inventory.');
 for(const [option,key]of [['deliveryId','deliveryId'],['expectedArchiveSha256','archiveSha256']])
  need(options[option]===undefined||options[option]===request[key],'The selected original delivery/archive changed.');
}
function checkAttachments(selection,source){
 need(selection&&selection.schema===SCHEMA+'.attachments'&&selection.workspaceId===source.workspaceId&&
  selection.deliveryId===source.delivery.id&&Array.isArray(selection.files)&&selection.files.length<=256,
  'Bind additional complete working files to the selected original workspace and delivery.');
 const names=new Set();let total=0;
 for(const file of selection.files){
  need(file&&ordinary(file.name)&&!names.has(file.name)&&typeof file.purpose==='string'&&file.purpose.length>0&&file.purpose.length<=4000&&
    Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&/^[a-f0-9]{64}$/.test(file.sha256)&&
    typeof file.path==='string'&&resolve(file.path)===file.path&&!file.path.includes('\0'),'Retain exact original working-file names, purpose, private path and byte identities.');
  names.add(file.name);total+=file.bytes;
 }
 need(total<=MAX_ARCHIVE,'The complete additional working files exceed the one-GiB receiving allowance.');
 return selection.files.map(file=>({name:'attachments/'+file.name,bytes:file.bytes,sha256:file.sha256,purpose:file.purpose,sourcePath:file.path}));
}
async function originalInputs(options){
 need(options.archivePath&&options.seedPath&&options.bindingsPath,'Select the original archive, complete native seed and explicit operator bindings.');
 const archive=await bytes(resolve(options.archivePath),MAX_ARCHIVE);
 const inspected=inspectOpenFemaInstallationSource(archive,options);
 const seed=await bytes(resolve(options.seedPath),MAX_JSON),bindings=await bytes(resolve(options.bindingsPath),MAX_JSON);
 const installed=readProfile(PROFILE),profile=await readFile(installed.source.path);
 need(profile.length===installed.source.bytes&&hash(profile)===installed.source.sha256,'The installed complete profile changed.');
 const selection=options.attachmentsPath?await bytes(resolve(options.attachmentsPath),MAX_JSON):
  json({schema:SCHEMA+'.attachments',workspaceId:inspected.source.workspaceId,deliveryId:options.deliveryId,files:[]});
 const attachments=checkAttachments(parse(selection),inspected.source);
 // Validate native composition before retaining a preparation request.
 composeOpenFemaInstallation(parse(seed),parse(profile),parse(bindings),inspected.source,{attachments});
 const bodies=new Map([[FIXED[0],archive],[FIXED[1],seed],[FIXED[2],bindings],[FIXED[3],profile],[FIXED[4],selection]]);
 const paths=[options.archivePath,options.seedPath,options.bindingsPath,null,options.attachmentsPath??null];
 const inputs=FIXED.map((name,i)=>({...identity(name,bodies.get(name)),sourcePath:paths[i]?resolve(paths[i]):null})).concat(attachments);
 return {inspected,bodies,request:{schema:SCHEMA+'.request',deliveryId:options.deliveryId,archiveSha256:options.expectedArchiveSha256,
  workspaceId:inspected.source.workspaceId,inputs}};
}
async function receiveInputs(root,request,options,bodies,lease){
 const overrides=new Map([[FIXED[0],options.archivePath],[FIXED[1],options.seedPath],[FIXED[2],options.bindingsPath],[FIXED[4],options.attachmentsPath]]);
 for(const file of request.inputs){
  options.signal?.throwIfAborted();lease.assertHeld();
  const prior=await optionalBytes(join(root,file.name),limit(file.name));
  if(prior!==null){need(prior.length===file.bytes&&hash(prior)===file.sha256,'Retain the selected original input '+file.name);
   if(overrides.get(file.name)!==undefined){
    const candidate=await bytes(resolve(overrides.get(file.name)),limit(file.name));
    need(candidate.equals(prior),'The explicitly supplied input differs from this original preparation.');
   }
   continue;
  }
  const origin=overrides.get(file.name)??file.sourcePath;
  const raw=bodies?.get(file.name)??(origin?await bytes(resolve(origin),limit(file.name)):null);
  need(raw!==null&&raw.length===file.bytes&&hash(raw)===file.sha256,'Receive the complete unchanged original input '+file.name);
  await write(root,file.name,raw);
 }
}
async function sourceFromRetained(root,request){
 const archive=await readSelected(root,request.inputs[0]);
 const inspected=inspectOpenFemaInstallationSource(archive,{deliveryId:request.deliveryId,expectedArchiveSha256:request.archiveSha256});
 need(inspected.source.workspaceId===request.workspaceId,'Keep the selected original native workspace.');
 const selection=parse(await readSelected(root,request.inputs[4]));
 const attachments=checkAttachments(selection,inspected.source);
 need(same(attachments,request.inputs.slice(FIXED.length)),'The complete additional working-file selection changed.');
 for(const file of attachments)await readSelected(root,file);
 return {inspected,attachments};
}
async function verify(root,lease,options,requestRaw){
 const request=parse(requestRaw);checkSelection(request,options);
 for(const file of request.inputs)await readSelected(root,file);
 const supplied=[[FIXED[0],options.archivePath],[FIXED[1],options.seedPath],[FIXED[2],options.bindingsPath],[FIXED[4],options.attachmentsPath]];
 for(const [name,path]of supplied)if(path!==undefined){const selected=request.inputs.find(x=>x.name===name);const raw=await bytes(resolve(path),limit(name));need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'The explicitly supplied input differs from this original preparation.');}
 const {inspected,attachments}=await sourceFromRetained(root,request);
 const completeRaw=await bytes(join(root,'preparation.json'),MAX_JSON),complete=parse(completeRaw);
 need(complete?.schema===SCHEMA&&complete.state==='PREPARED'&&complete.requestSha256===hash(requestRaw)&&
  complete.archiveSha256===request.archiveSha256&&complete.deliveryId===request.deliveryId&&
  same(complete.inputs,request.inputs)&&Array.isArray(complete.outputs),'Retain the original complete preparation outcome.');
 const expectedNames=['delivery/OpenFEMA_Project_Delivery.zip',...inspected.source.files.map(x=>'delivery/files/'+x.name),...OUTPUTS];
 need(same(complete.outputs.map(x=>x.name),expectedNames),'Retain every complete original customer member and native output.');
 for(const file of complete.outputs){
  options.signal?.throwIfAborted();lease.assertHeld();
  need(ordinary(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_ARCHIVE&&/^[a-f0-9]{64}$/.test(file.sha256),'Retain complete output identities.');
  const raw=await bytes(join(root,file.name),MAX_ARCHIVE);
  need(raw.length===file.bytes&&hash(raw)===file.sha256,'The complete prepared output changed: '+file.name);
  if(file.name==='delivery/OpenFEMA_Project_Delivery.zip')need(raw.equals(inspected.customerArchive),'Retain the exact selected native customer ZIP.');
  if(file.name.startsWith('delivery/files/'))need(raw.equals(inspected.files.get(file.name.slice(15))),'Retain every original customer file unchanged.');
 }
 const seed=parse(await readSelected(root,request.inputs[1])),bindings=parse(await readSelected(root,request.inputs[2])),profile=parse(await readSelected(root,request.inputs[3]));
 const composed=composeOpenFemaInstallation(seed,profile,bindings,inspected.source,{attachments});
 need(complete.workspaceId===request.workspaceId&&complete.workshareCaseId===composed.prepared.workshareCaseId&&
  same(complete.installationSource,composed.prepared.source)&&same(complete.selections,composed.prepared.selections),
  'The completed preparation metadata differs from its original case, Workshare and selected source.');
 const rebuilt=[json(composed.derivedBindings),json(composed.source),Buffer.from(composed.sourceMarkdown),json(composed.prepared.document),json(composed.prepared.preview),Buffer.from(composed.workorder)];
 for(let i=0;i<OUTPUTS.length;i++)need((await bytes(join(root,OUTPUTS[i]),MAX_OUTPUT)).equals(rebuilt[i]),'The prepared native output differs from its complete original inputs: '+OUTPUTS[i]);
 const annex=parse(await bytes(join(root,'OPENFEMA_CUSTOMER_SOURCE.json'),MAX_OUTPUT));
 need(same(annex.delivery,inspected.source.delivery)&&same(annex.archive,inspected.source.archive)&&same(annex.attachments,attachments)&&
  same(annex.installationSelection,parse(await readSelected(root,request.inputs[1])).source),'Retain original source and native Installation selection.');
 return {...complete,directory:root,preparationSha256:hash(completeRaw),preparationBytes:completeRaw.length,offline:true};
}
export async function prepareOpenFemaInstallation(options={}){
 return owned(options.directory,async(root,lease)=>{
  options.signal?.throwIfAborted();
  let requestRaw=await optionalBytes(join(root,'prepare-request.json'),MAX_JSON),request,bodies=null;
  if(requestRaw!==null){request=parse(requestRaw);checkSelection(request,options);
   if(await optionalBytes(join(root,'preparation.json'),MAX_JSON)!==null)return verify(root,lease,options,requestRaw);
  }else{
   const first=await originalInputs(options);request=first.request;bodies=first.bodies;requestRaw=json(request);
   // These two source-owned inputs have no external private origin. Retain them
   // before the original request so an interrupted receiver can finish offline.
   await write(root,FIXED[3],bodies.get(FIXED[3]));await write(root,FIXED[4],bodies.get(FIXED[4]));
   await write(root,'prepare-request.json',requestRaw);
  }
  await receiveInputs(root,request,options,bodies,lease);bodies=null;
  const {inspected,attachments}=await sourceFromRetained(root,request);
  const seed=parse(await readSelected(root,request.inputs[1])),bindings=parse(await readSelected(root,request.inputs[2])),profile=parse(await readSelected(root,request.inputs[3]));
  const composed=composeOpenFemaInstallation(seed,profile,bindings,inspected.source,{attachments});
  const outputs=[await write(root,'delivery/OpenFEMA_Project_Delivery.zip',inspected.customerArchive)];
  for(const [name,raw]of inspected.files){options.signal?.throwIfAborted();lease.assertHeld();outputs.push(await write(root,'delivery/files/'+name,raw));}
  const values=[json(composed.derivedBindings),json(composed.source),Buffer.from(composed.sourceMarkdown),json(composed.prepared.document),json(composed.prepared.preview),Buffer.from(composed.workorder)];
  need(values[3].length<=128*1024,'The whole native Installation document exceeds its original128KiB allowance.');
  for(let i=0;i<OUTPUTS.length;i++){need(values[i].length<=MAX_OUTPUT,'Retain the complete output within32MiB.');lease.assertHeld();outputs.push(await write(root,OUTPUTS[i],values[i]));}
  const complete={schema:SCHEMA,state:'PREPARED',requestSha256:hash(requestRaw),workspaceId:request.workspaceId,archiveSha256:request.archiveSha256,
   deliveryId:request.deliveryId,inputs:request.inputs,outputs,workshareCaseId:composed.prepared.workshareCaseId,
   installationSource:composed.prepared.source,selections:composed.prepared.selections};
  await write(root,'preparation.json',json(complete));return verify(root,lease,options,requestRaw);
 });
}
export async function reopenOpenFemaInstallation(options={}){
 return owned(options.directory,async(root,lease)=>verify(root,lease,options,await bytes(join(root,'prepare-request.json'),MAX_JSON)));
}
export async function templateOpenFemaInstallation(options={}){
 return owned(options.directory,async(root)=>{
  need(options.seedPath,'Select the complete original installation-workshare-seed.');
  const seed=parse(await bytes(resolve(options.seedPath),MAX_JSON)),profile=readProfile(PROFILE);
  const binding=bindingTemplate(seed,profile.value);
  need(typeof binding.workshareCaseId==='string'&&binding.workshareCaseId.length>0,'Select the original customer Workshare seed.');
  const output=await write(root,'bindings.json',json(binding));
  return {...output,directory:root,profile:profile.source,selection:binding.selection};
 });
}
export async function main(argv=process.argv.slice(2)){
 const [command,...rest]=argv,options={};
 need(['template','inspect','prepare','reopen'].includes(command),'Use openfema-installation template|inspect|prepare|reopen.');
 const keys={directory:'directory',archive:'archivePath','archive-sha256':'expectedArchiveSha256',delivery:'deliveryId',seed:'seedPath',bindings:'bindingsPath',attachments:'attachmentsPath'};
 for(let i=0;i<rest.length;i+=2){const key=rest[i]?.slice(2);need(rest[i]?.startsWith('--')&&keys[key]&&rest[i+1]&&!rest[i+1].startsWith('--')&&options[keys[key]]===undefined,'Use complete unique --name value arguments.');options[keys[key]]=rest[i+1];}
 if(command==='template'){
  need(Object.keys(options).every(k=>['directory','seedPath'].includes(k)),'Prepare the original bindings using --directory and --seed.');
  console.log(JSON.stringify(await templateOpenFemaInstallation(options),null,2));
 }else if(command==='inspect'){
  need(options.archivePath&&!options.directory&&!options.seedPath&&!options.bindingsPath&&!options.attachmentsPath,'Inspect the original archive with --archive --archive-sha256 and --delivery.');
  console.log(JSON.stringify(inspectOpenFemaInstallationSource(await bytes(resolve(options.archivePath),MAX_ARCHIVE),options).source,null,2));
 }else{
  if(command==='reopen')need(Object.keys(options).every(k=>['directory','deliveryId','expectedArchiveSha256'].includes(k)),'Reopen the full received private directory without external source paths.');
  console.log(JSON.stringify(await(command==='prepare'?prepareOpenFemaInstallation:reopenOpenFemaInstallation)(options),null,2));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
