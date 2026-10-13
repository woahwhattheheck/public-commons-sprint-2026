#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import C from './stove-operations-core.cjs';
import Examples from './stove-operations-examples.cjs';
const root=dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2),mode=argv.shift(),options={};
for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||argv[i+1]===undefined||options[argv[i]])throw Error('Use unique --name value pairs.');options[argv[i]]=argv[i+1];}
const required=name=>{if(!options[name])throw Error('Missing '+name);return options[name];};
const exactText=raw=>{const value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);if(!Buffer.from(value).equals(raw))throw Error('Original UTF-8 bytes changed.');return value;};
const read=async path=>exactText(await readFile(resolve(path)));
const json=async path=>JSON.parse(await read(path));
const catalogue=await json(options['--catalogue']??join(root,'source-catalogue.json'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
async function save(path,value){const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});return {path,bytes:bytes.length,sha256:sha(bytes)};}
const load=async()=>C.importWorkspace(await read(required('--workspace')),catalogue);
async function operatedExample(destination){
 const {workspace,walkthrough,operations}=await Examples.buildAsync(C,catalogue);
 const files=[];
 files.push(await save(join(destination,'worked-workspace.json'),C.exportWorkspace(workspace)));
 files.push(await save(join(destination,'walkthrough.json'),JSON.stringify(walkthrough,null,2)+'\n'));
 files.push(await save(join(destination,'original-operations.json'),JSON.stringify(operations,null,2)+'\n'));
 files.push(await save(join(destination,'operating-register.html'),C.reportHTML(workspace)));
 files.push(await save(join(destination,'operating-register.csv'),C.exportCSV(workspace)));
 for(const file of workspace.attachments)files.push(await save(join(destination,'originals',file.name),C.attachmentBytes(workspace,file.id)));
 for(const handover of workspace.handovers)files.push(await save(join(destination,'handovers',handover.jobId+'-edition-'+handover.edition+'.html'),C.handoverHTML(workspace,handover.id)));
 const reopened=C.importWorkspace(await read(join(destination,'worked-workspace.json')),catalogue);
 if(C.exportWorkspace(reopened)!==C.exportWorkspace(workspace))throw Error('Complete receiving changed the operated workspace.');
 return {schema:'commons.stove-operated-source.v1',workspaceId:workspace.id,revision:workspace.revision,summary:C.summary(workspace),sourceOperationOnly:true,renderedAcceptance:false,files};
}
try{
 let result;
 if(mode==='example'){const destination=resolve(required('--output'));result=await operatedExample(destination);await save(join(destination,'operation-result.json'),JSON.stringify(result,null,2)+'\n');}
 else if(mode==='new'){const workspace=C.create(catalogue,{title:options['--title']??'Stove survey-to-handover workspace'});result=await save(resolve(required('--output')),C.exportWorkspace(workspace));}
 else if(mode==='receive'){const workspace=C.importWorkspace(await read(required('--input')),catalogue);result=await save(resolve(required('--output')),C.exportWorkspace(workspace));}
 else if(mode==='apply'){const workspace=await load(),command=await json(required('--command'));result=await save(resolve(required('--output')),C.exportWorkspace(C.mutate(workspace,command)));}
 else if(mode==='review'){const workspace=await load(),kind=required('--kind'),id=options['--id'];if(kind==='survey')result=C.reviewSurvey(workspace,id);else if(kind==='quote')result=C.reviewQuote(workspace,id);else if(kind==='visit')result=C.reviewVisit(workspace,id);else if(kind==='handover')result=C.reviewHandover(workspace,await json(required('--input')));else if(kind==='import')result=C.reviewImport(workspace,await json(required('--input')));else throw Error('Review kind: survey, quote, visit, handover or import.');await save(resolve(required('--output')),JSON.stringify(result,null,2)+'\n');}
 else if(mode==='report'){const workspace=await load(),destination=resolve(required('--output'));result={html:await save(join(destination,'operating-register.html'),C.reportHTML(workspace,options['--operator'])),csv:await save(join(destination,'operating-register.csv'),C.exportCSV(workspace,options['--operator']))};}
 else if(mode==='attachment'){const workspace=await load();result=await save(resolve(required('--output')),C.attachmentBytes(workspace,required('--id')));}
 else if(mode==='handover'){const workspace=await load();result=await save(resolve(required('--output')),C.handoverHTML(workspace,required('--id')));}
 else throw Error('Command: new, example, receive, apply, review, report, attachment or handover. All output files must be new paths.');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(JSON.stringify({code:error.code??'STOVE_OPERATION_FAILED',message:error.message})+'\n');process.exitCode=1;}
