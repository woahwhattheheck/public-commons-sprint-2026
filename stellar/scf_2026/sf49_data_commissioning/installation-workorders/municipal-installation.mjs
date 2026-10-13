#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Prepare the complete original municipal project for its existing Installation. */
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readProfile} from './profiles.mjs';
import {municipalInstallationTemplate,prepareMunicipalInstallation,renderMunicipalSource,same,MAX_SOURCE} from './municipal-installation-core.mjs';
import {need,encoded,parse,identity,privateDirectory,retain,originalInput,originalUnchanged,nativeMunicipal,regular,operationLease} from './municipal-installation-io.mjs';
const usage='municipal-installation inspect --archive ORIGINAL_HANDOVER.zip [--python /actual/python]\n'+
'municipal-installation template --archive ORIGINAL_HANDOVER.zip --case ORIGINAL_CASE.json --seed ORIGINAL_WORKSHARE_SEED.json --out PRIVATE_DIRECTORY [--python /actual/python]\n'+
'municipal-installation prepare --archive ORIGINAL_HANDOVER.zip --case ORIGINAL_CASE.json --seed ORIGINAL_WORKSHARE_SEED.json --bindings BINDINGS.json --selection SELECTED_PROJECTS.json --selection-source ORIGINAL_SOURCE_ID --out PRIVATE_DIRECTORY [--python /actual/python]';
export async function main(argv=process.argv.slice(2)){
 const [command,...args]=argv,options={};need(['inspect','template','prepare'].includes(command),usage);
 for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');need(['archive','case','seed','bindings','selection','selection-source','out','python'].includes(key)&&args[i+1]&&!Object.hasOwn(options,key),usage);options[key]=args[i+1];}
 const required=command==='inspect'?['archive']:command==='template'?['archive','case','seed','out']:['archive','case','seed','bindings','selection','selection-source','out'];
 need(required.every(k=>options[k])&&Object.keys(options).every(k=>[...required,'python'].includes(k)),usage);
 options.python??='python3';
 for(const k of ['archive','case','seed','bindings','selection','out'])if(options[k])options[k]=resolve(options[k]);
 if(command==='inspect'){
  const before=await regular(options.archive,MAX_SOURCE),source=nativeMunicipal(options.python,'inspect',options.archive);
  need(same(identity(before),source.archive),'The native original archive differs from the selected file.');
  await originalUnchanged(options.archive,before,MAX_SOURCE);console.log(JSON.stringify(source,null,2));return source;
 }
 const output=await privateDirectory(options.out),lease=await operationLease(join(output,'municipal-installation.lock'));
 try{
  await retain(join(output,'Original_Arguments.json'),encoded({command,...options}));
  const rows=[],take=async(name,key,max=MAX_SOURCE)=>{const row=await originalInput(output,name,options[key],max);rows.push({key,...row});return row;};
  const archive=await take('Municipal_Complete_Original_Handover.zip','archive');
  const caseInput=await take('Original_Operations_Case.json','case'),seed=await take('Original_Workshare_Seed.json','seed');
  const source=nativeMunicipal(options.python,'inspect',archive.retained);need(same(source.archive,archive.identity),'Native source and retained original bytes differ.');
  const profile=readProfile('municipal-assets'),emitted=[];
  const emit=async(name,raw)=>{const row=await retain(join(output,name),raw);emitted.push({...row,path:name});};
  for(const row of rows)emitted.push({path:row.retained.slice(output.length+1),...row.identity});
  await emit('Original_Installation_Profile.json',encoded(profile.value));
  let value,selection;
  if(command==='template'){
   value=municipalInstallationTemplate({source,seed:parse(seed.raw),caseValue:parse(caseInput.raw),profile:profile.value});selection=value.selection;
   await emit('Selected_Municipal_Projects.json',encoded(selection));await emit('bindings.json',encoded(value.bindings));
  }else{
   const bindings=await take('Original_Bindings.json','bindings'),selected=await take('Selected_Municipal_Projects.json','selection');
   emitted.push({path:'Original_Bindings.json',...bindings.identity},{path:'Selected_Municipal_Projects.json',...selected.identity});selection=parse(selected.raw);
   value=prepareMunicipalInstallation({source,seed:parse(seed.raw),caseValue:parse(caseInput.raw),profile:profile.value,bindings:parse(bindings.raw),selectionRaw:selected.raw,selectionSourceId:options['selection-source']});
   const doc=encoded(value.prepared.document);need(doc.length<=128*1024,'The complete Installation document exceeds its native 128 KiB allowance.');
   await emit('installation-input.json',doc);await emit('installation-preview-input.json',encoded(value.prepared.preview));
   await emit('WORKORDER.md',Buffer.from(value.workorder));
   await emit('Municipal_Installation_Projects.json',encoded(value.snapshot));
   await emit('preparation.json',encoded({...value.prepared,bindings:value.bindings}));
  }
  await emit('Municipal_Complete_Source_Report.json',encoded(source));
  await emit('Municipal_Complete_Source_Report.html',Buffer.from(renderMunicipalSource(source,selection)));
  for(const row of rows)await originalUnchanged(options[row.key],row.raw);
  const receipt={schema:'stellar-forge.municipal-installation-local-receiving.v1',command,
   sourceIdentities:Object.fromEntries(rows.map(row=>[row.key,row.identity])),profile:profile.source,outputs:emitted,
   workspace:source.workspace,caseId:parse(seed.raw).source.caseId,
   nativeMutation:'Prepared for the original Installation preview/save; existing municipal requests, revisions and outcomes remain unchanged.'};
  await retain(join(output,'Municipal_Installation_Receiving.json'),encoded(receipt));console.log(JSON.stringify(receipt,null,2));return receipt;
 }finally{await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({code:error.code??'MUNICIPAL_INSTALLATION_INPUT',message:String(error.message)}));process.exitCode=1;});
