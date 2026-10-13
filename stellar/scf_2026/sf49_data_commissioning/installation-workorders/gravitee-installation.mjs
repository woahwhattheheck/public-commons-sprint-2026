#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Receive complete original files; native mutations stay in the existing apps. */
import {readFile,open,lstat,realpath,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {writeImmutableBytes} from '../../../../products/gravitee-merchant/store.mjs';
import {readProfile} from './profiles.mjs';
import {graviteeInstallationTemplate,prepareGraviteeInstallation,inspectGraviteeInstallation} from './gravitee-installation-core.mjs';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const usage='gravitee-installation inspect --packet ORIGINAL_HANDOVER.json\n'+
 'gravitee-installation template --packet ORIGINAL_HANDOVER.json --case ORIGINAL_OPERATIONS_SHOW.json --seed ORIGINAL_WORKSHARE_SEED.json --out PRIVATE_DIRECTORY\n'+
 'gravitee-installation prepare --packet ORIGINAL_HANDOVER.json --case ORIGINAL_OPERATIONS_SHOW.json --seed ORIGINAL_WORKSHARE_SEED.json --bindings ORIGINAL_BINDINGS.json --selection SELECTED_COHORT.json --cohort-source ORIGINAL_SOURCE_ID --out PRIVATE_DIRECTORY';
async function read(path,max=8*1024*1024){
 const file=resolve(path),handle=await open(file,'r');
 try{
  const before=await handle.stat(),named=await lstat(file);
  if(!before.isFile()||named.isSymbolicLink()||before.size>max||named.dev!==before.dev||named.ino!==before.ino)throw new Error('Use the complete original regular file: '+file);
  const raw=await handle.readFile(),after=await handle.stat(),latest=await lstat(file);
  if(raw.length>max||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k])||latest.dev!==after.dev||latest.ino!==after.ino)throw new Error('The original file changed during reading: '+file);
  return{raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),identity:{bytes:raw.length,sha256:hash(raw)}};
 }finally{await handle.close();}
}
async function directory(path){
 const value=resolve(path);await mkdir(value,{recursive:true,mode:0o700});
 const info=await lstat(value);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)||await realpath(value)!==value)throw new Error('Use a private 0700 output directory without symlink ancestors.');
 return value;
}
export async function main(argv=process.argv.slice(2)){
 const [command,...args]=argv,options={};if(!['inspect','template','prepare'].includes(command))throw new Error(usage);
 for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!['packet','case','seed','bindings','selection','cohort-source','out'].includes(key)||!args[i+1]||options[key])throw new Error(usage);options[key]=args[i+1];}
 const needed=command==='inspect'?['packet']:command==='template'?['packet','case','seed','out']:['packet','case','seed','bindings','selection','cohort-source','out'];
 if(needed.some(key=>!options[key])||Object.keys(options).some(key=>!needed.includes(key)))throw new Error(usage);
 const packet=await read(options.packet,512*1024*1024);
 if(command==='inspect'){const value=inspectGraviteeInstallation(packet.raw);console.log(JSON.stringify(value,null,2));return value;}
 const caseInput=await read(options.case),seed=await read(options.seed),profile=readProfile('gravitee-commissioning');
 const output=await directory(options.out),lease=await operationLease(join(output,'gravitee-installation.lock'));
 try{
  const emitted=[];
  const retain=async(name,raw)=>{await writeImmutableBytes(join(output,name),raw);const file={path:name,bytes:raw.length,sha256:hash(raw)};emitted.push(file);return file;};
  const sourceIdentities={packet:packet.identity,case:caseInput.identity,seed:seed.identity,profile:profile.source};
  await retain('Gravitee_Complete_Original_Handover.json',packet.raw);
  await retain('Original_Operations_Case.json',caseInput.raw);
  await retain('Original_Workshare_Seed.json',seed.raw);
  let value;
  if(command==='template'){
   value=graviteeInstallationTemplate({raw:packet.raw,caseValue:caseInput.value,seed:seed.value,profile:profile.value});
   await retain('Selected_Gravitee_Cohort.json',encode(value.selection));await retain('bindings.json',encode(value.bindings));
   await retain('Gravitee_Complete_Source_Report.json',encode(value.source));
  }else{
   const bindings=await read(options.bindings),selection=await read(options.selection);
   sourceIdentities.bindings=bindings.identity;sourceIdentities.selection=selection.identity;
   value=prepareGraviteeInstallation({raw:packet.raw,caseValue:caseInput.value,seed:seed.value,profile:profile.value,bindings:bindings.value,selectionRaw:selection.raw,cohortSourceId:options['cohort-source']});
   const document=encode(value.prepared.document);if(document.length>128*1024)throw new Error('The complete Installation document exceeds its original 128 KiB limit.');
   await retain('Original_Bindings.json',bindings.raw);await retain('Selected_Gravitee_Cohort.json',selection.raw);
   await retain('installation-input.json',document);await retain('installation-preview-input.json',encode(value.prepared.preview));
   await retain('WORKORDER.md',Buffer.from(value.workorder));await retain('Gravitee_Complete_Source_Report.json',encode(value.source));
   await retain('Gravitee_Installation_Cohort.json',encode(value.snapshot));
   await retain('preparation.json',encode({...value.prepared,bindings:value.bindings}));
  }
  const receipt={schema:'stellar-forge.gravitee-installation-local-receiving.v1',command,sourceIdentities,outputs:[...emitted],
    workspaceId:value.source.package.workspaceId,caseId:seed.value.source.caseId,
    nativeMutation:'Preparation only; original Installation preview/save/receive and Gravitee requests keep their original identities.'};
  const saved=await retain('Gravitee_Installation_Receiving.json',encode(receipt));
  console.log(JSON.stringify({...receipt,receipt:saved},null,2));return receipt;
 }finally{await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({code:error.code??'GRAVITEE_INSTALLATION_INPUT',message:String(error.message)}));process.exitCode=1;});
