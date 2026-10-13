#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The original complete customer result becomes an independently reopenable Installation input.
import {join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readProfile} from '../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/profiles.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {initializationDirectory as directory,initializationBytes as bytes,optionalInitializationBytes as optionalBytes,
 retainInitializationFile as retainFile,initializationJson as json}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {downloadNativeAnalysisEventDelivery,reopenNativeAnalysisEventDelivery} from './native-analysis-events-download.mjs';
import {EVENT_INDEX_NAME,parseEventDownloadIndex,eventIndexBytes,eventObject as object,eventNeed as need,eventHash as sha,eventCanonical}
 from './native-analysis-events-contract.mjs';
import {EVENT_INSTALLATION_SCHEMA,EVENT_INSTALLATION_PROFILE,composeEventInstallation} from './native-analysis-events-installation-core.mjs';
const REQUEST='prepare-request.json',COMPLETE='preparation.json',MAX_INPUT=2*1024*1024;
const ORIGINALS=['source/seed.json','source/bindings.json','source/profile.json'];
const OUTPUTS=['derived-bindings.json','EVENT_CUSTOMER_SOURCE.json','EVENT_CUSTOMER_SOURCE.md',
 'installation-input.json','installation-preview-input.json','WORKORDER.md'];
const FIELDS=['analysisWorkspace','programme','deliveryId','expectedIndexSha256'];
const decode=raw=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
function parse(raw){let value;try{value=JSON.parse(decode(raw));}catch{need(false,'INSTALLATION_JSON_REQUIRED');}return value;}
function pathRoot(value){
 need(typeof value==='string'&&value.length>0&&!value.includes('\0')&&resolve(value)!=='/','INSTALLATION_DIRECTORY_REQUIRED');
 return resolve(value);
}
function separate(a,b){need(a!==b&&!a.startsWith(b+'/')&&!b.startsWith(a+'/'),'INSTALLATION_SEPARATE_DIRECTORY_REQUIRED');}
function identity(name,raw){return {name,bytes:raw.length,sha256:sha(raw)};}
function same(actual,expected){return eventCanonical(actual)===eventCanonical(expected);}
function requestSelection(request,options){
 need(object(request)&&request.schema===EVENT_INSTALLATION_SCHEMA+'.request'&&object(request.selection)&&
 Array.isArray(request.inputs)&&request.inputs.length===3,'INSTALLATION_REQUEST_REQUIRED');
 const result={...request.selection};
 for(const field of FIELDS)need(options[field]===undefined||options[field]===result[field],'INSTALLATION_SELECTION_CHANGED');
 return result;
}
async function withPreparation(destination,operation){
 const root=pathRoot(destination);await directory(root,{create:true});const lease=await acquireStateLease(root);
 let primary;
 try{lease.assertHeld();return await operation(root,lease);}
 catch(error){primary=error;throw error;}
 finally{try{await lease.close();}catch(error){const failure=primary??error;failure.close=()=>lease.close();
 if(primary)primary.closeError=error;throw failure;}}
}
async function retainedInputs(root,request){
 const all={};
 need(request.inputs.every((file,i)=>object(file)&&file.name===ORIGINALS[i]&&
 Number.isSafeInteger(file.bytes)&&file.bytes>=1&&file.bytes<=MAX_INPUT&&/^[a-f0-9]{64}$/.test(file.sha256)),
 'INSTALLATION_INPUT_IDENTITY_CHANGED');
 for(const file of request.inputs){const raw=await bytes(join(root,file.name),MAX_INPUT);
 need(raw.length===file.bytes&&sha(raw)===file.sha256,'INSTALLATION_INPUT_CHANGED');all[file.name]=raw;}
 return all;
}
async function localIndex(root,selected){
 await directory(root);const raw=await bytes(join(root,EVENT_INDEX_NAME),65536);
 const index=parseEventDownloadIndex(raw,selected.deliveryId);
 need(index.programme===selected.programme&&index.index_sha256===selected.expectedIndexSha256,
 'INSTALLATION_DELIVERY_CHANGED');return {raw,index};
}
async function verifyPrepared(root,lease,options,requestRaw){
 const request=parse(requestRaw),selected=requestSelection(request,options),inputs=await retainedInputs(root,request);
 const raw=await bytes(join(root,COMPLETE),MAX_INPUT),complete=parse(raw);
 need(object(complete)&&complete.schema===EVENT_INSTALLATION_SCHEMA&&complete.state==='PREPARED'&&
 complete.requestSha256===sha(requestRaw)&&same(complete.selection,selected)&&
 Array.isArray(complete.outputs)&&complete.outputs.length===OUTPUTS.length,'INSTALLATION_COMPLETION_CHANGED');
 for(let i=0;i<OUTPUTS.length;i++){
 options.signal?.throwIfAborted();lease.assertHeld();const file=complete.outputs[i];
 need(object(file)&&file.name===OUTPUTS[i]&&Number.isSafeInteger(file.bytes)&&file.bytes>=1&&file.bytes<=MAX_INPUT&&
 /^[a-f0-9]{64}$/.test(file.sha256),'INSTALLATION_OUTPUT_IDENTITY_CHANGED');
 const value=await bytes(join(root,file.name),MAX_INPUT);
 need(value.length===file.bytes&&sha(value)===file.sha256,'INSTALLATION_OUTPUT_CHANGED');
 }
 const delivery=await reopenNativeAnalysisEventDelivery({...selected,directory:join(root,'delivery'),signal:options.signal});
 const {index}=await localIndex(join(root,'delivery'),selected);
 need(index.workspace_id===request.workspaceId&&same(complete.eventIndex,index),'INSTALLATION_DELIVERY_CHANGED');
 const source=parse(await bytes(join(root,'EVENT_CUSTOMER_SOURCE.json'),MAX_INPUT));
 need(same(source.installationSelection,parse(inputs['source/seed.json']).source)&&
 source.workshareCaseId===parse(inputs['source/bindings.json']).workshareCaseId&&same(source.eventIndex,index),
 'INSTALLATION_ORIGINAL_SOURCE_CHANGED');
 lease.assertHeld();return {...complete,directory:root,delivery,offline:true,
 preparationFile:join(root,COMPLETE),preparationBytes:raw.length,preparationSha256:sha(raw)};
}
function localClient(root,index,analysisWorkspace,signal){
 const read=createSavedFileReader();
 return {analysisWorkspace,endpoint:'urn:stellar-forge:received-event-source:'+index.workspace_id,
 async call(operation,args,options={}){
 const active=options.signal??signal;active?.throwIfAborted();
 need(args?.programme===index.programme&&args?.delivery_id===index.delivery_id,'INSTALLATION_DELIVERY_CHANGED');
 if(operation==='event-delivery-index')return index;
 need(operation==='event-delivery-file'&&args.index_sha256===index.index_sha256,'INSTALLATION_READ_ONLY_SOURCE_REQUIRED');
 const file=index.files.find(file=>file.name===args.filename);
 need(file&&args.sha256===file.sha256,'INSTALLATION_FILE_CHANGED');
 await directory(root);
 const part=await read({destination:join(root,file.name),bytes:file.bytes,sha256:file.sha256,contentType:file.mime},
 {byteOffset:args.byteOffset,maxBytes:args.maxBytes});
 active?.throwIfAborted();
 return {workspace_id:index.workspace_id,programme:index.programme,delivery_id:index.delivery_id,
 index_sha256:index.index_sha256,filename:file.name,file:part};
 }};
}
async function firstInputs(root,options){
 const original=join(root,'source');await directory(original,{create:true});
 const result={};
 for(const [name,key]of [['seed','seedPath'],['bindings','bindingsPath']]){
 const path=join(original,name+'.json'),prior=await optionalBytes(path,MAX_INPUT);
 need(prior!==null||typeof options[key]==='string','INSTALLATION_'+name.toUpperCase()+'_REQUIRED');
 const raw=typeof options[key]==='string'?await bytes(resolve(options[key]),MAX_INPUT):prior;
 need(prior===null||prior.equals(raw),'INSTALLATION_INPUT_CHANGED');
 parse(raw);await retainFile(path,raw,{resume:true});result['source/'+name+'.json']=raw;
 }
 const path=join(original,'profile.json');let raw=await optionalBytes(path,MAX_INPUT);
 if(raw===null){const installed=readProfile(EVENT_INSTALLATION_PROFILE);raw=await readFile(installed.source.path);
 need(raw.length===installed.source.bytes&&sha(raw)===installed.source.sha256,'INSTALLATION_PROFILE_CHANGED');
 await retainFile(path,raw,{resume:true});}
 const profile=parse(raw);need(profile?.id===EVENT_INSTALLATION_PROFILE,'INSTALLATION_PROFILE_CHANGED');
 result['source/profile.json']=raw;return result;
}
/** Copy the whole selected delivery and original case inputs before native preparation. */
export async function prepareNativeAnalysisEventInstallation(options={}){
 return withPreparation(options.directory,async(root,lease)=>{
 options.signal?.throwIfAborted();
 const existing=await optionalBytes(join(root,REQUEST),MAX_INPUT);
 let request,requestRaw=existing,selected,inputs,index;
 if(existing!==null){
 request=parse(existing);selected=requestSelection(request,options);inputs=await retainedInputs(root,request);
 for(const [name,key]of [['seed','seedPath'],['bindings','bindingsPath']])
 if(options[key]!==undefined)need((await bytes(resolve(options[key]),MAX_INPUT)).equals(inputs['source/'+name+'.json']),
 'INSTALLATION_INPUT_CHANGED');
 const completed=await optionalBytes(join(root,COMPLETE),MAX_INPUT);
 if(completed!==null)return verifyPrepared(root,lease,options,existing);
 }else{
 selected=Object.fromEntries(FIELDS.map(field=>[field,options[field]]));
 inputs=await firstInputs(root,options);
 }
 // The original writer publishes this root index only after all sixteen files.
 // Its completed private copy can finish preparation independently after a crash.
 const localRaw=existing===null?null:await optionalBytes(join(root,'delivery',EVENT_INDEX_NAME),65536);
 let source=null;
 if(localRaw!==null){
 await reopenNativeAnalysisEventDelivery({...selected,directory:join(root,'delivery'),signal:options.signal});
 index=(await localIndex(join(root,'delivery'),selected)).index;
 }else{
 source=pathRoot(options.sourceDirectory??request?.originalSourceDirectory);
 separate(root,source);
 await reopenNativeAnalysisEventDelivery({...selected,directory:source,signal:options.signal});
 index=(await localIndex(source,selected)).index;
 }
 if(request)need(request.workspaceId===index.workspace_id,'INSTALLATION_WORKSPACE_CHANGED');
 else{
 request={schema:EVENT_INSTALLATION_SCHEMA+'.request',selection:selected,workspaceId:index.workspace_id,
 originalSourceDirectory:source,inputs:ORIGINALS.map(name=>identity(name,inputs[name]))};
 requestRaw=json(request);await retainFile(join(root,REQUEST),requestRaw,{resume:true});
 }
 const result=composeEventInstallation(parse(inputs['source/seed.json']),parse(inputs['source/profile.json']),
 parse(inputs['source/bindings.json']),index,{analysisWorkspace:selected.analysisWorkspace});
 // A partial copy uses the unchanged original writer and exact selected source.
 lease.assertHeld();
 if(localRaw===null)await downloadNativeAnalysisEventDelivery({...selected,directory:join(root,'delivery'),signal:options.signal,
 client:localClient(source,index,selected.analysisWorkspace,options.signal),onProgress:options.onProgress});
 const received=(await localIndex(join(root,'delivery'),selected)).index;
 need(same(received,index),'INSTALLATION_DELIVERY_CHANGED');
 const output=[json(result.derivedBindings),json(result.source),Buffer.from(result.sourceMarkdown),
 json(result.prepared.document),json(result.prepared.preview),Buffer.from(result.workorder)];
 need(output[3].length<=128*1024,'INSTALLATION_DOCUMENT_TOO_LARGE');
 const outputs=[];
 for(let i=0;i<OUTPUTS.length;i++){options.signal?.throwIfAborted();lease.assertHeld();
 need(output[i].length<=MAX_INPUT,'INSTALLATION_OUTPUT_TOO_LARGE');
 await retainFile(join(root,OUTPUTS[i]),output[i],{resume:true});outputs.push(identity(OUTPUTS[i],output[i]));}
 const complete={schema:EVENT_INSTALLATION_SCHEMA,state:'PREPARED',requestSha256:sha(requestRaw),selection:selected,
 eventIndex:received,workshareCaseId:result.prepared.workshareCaseId,installationSource:result.prepared.source,
 inputs:request.inputs,outputs,selections:result.prepared.selections,implementation:result.prepared.implementation,
 requiredInputs:result.prepared.inputs,sourceFiles:result.prepared.sourceFiles};
 lease.assertHeld();await retainFile(join(root,COMPLETE),json(complete),{resume:true});
 return verifyPrepared(root,lease,options,requestRaw);
 });
}
/** Open every original retained file and prepared document without the producer host. */
export async function reopenNativeAnalysisEventInstallation(options={}){
 return withPreparation(options.directory,async(root,lease)=>{
 const requestRaw=await bytes(join(root,REQUEST),MAX_INPUT);return verifyPrepared(root,lease,options,requestRaw);
 });
}
function parseArgs(argv){
 const [command,...args]=argv;
 const allowed={prepare:['--directory','--source','--workspace','--programme','--delivery','--index-sha256','--seed','--bindings'],
 reopen:['--directory','--workspace','--programme','--delivery','--index-sha256']};
 need(Object.hasOwn(allowed,command)&&args.length%2===0,'INSTALLATION_ARGUMENTS_INVALID');
 const fields={};
 for(let i=0;i<args.length;i+=2){need(allowed[command].includes(args[i])&&!Object.hasOwn(fields,args[i])&&args[i+1],
 'INSTALLATION_ARGUMENTS_INVALID');fields[args[i]]=args[i+1];}
 return {command,options:{directory:fields['--directory'],sourceDirectory:fields['--source'],
 analysisWorkspace:fields['--workspace'],programme:fields['--programme'],deliveryId:fields['--delivery'],
 expectedIndexSha256:fields['--index-sha256'],seedPath:fields['--seed'],bindingsPath:fields['--bindings']}};
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--help'){
 process.stdout.write('Original Event Analysis customer Installation receiving.\n'+
 'prepare --directory PRIVATE_OUTPUT --source COMPLETE_DELIVERY --workspace ALIAS --programme NAME --delivery UUID32 --index-sha256 SHA256 --seed ORIGINAL_SEED.json --bindings ORIGINAL_BINDINGS.json\n'+
 'Repeat prepare --directory PRIVATE_OUTPUT to continue its retained original request.\n'+
 'reopen --directory PRIVATE_OUTPUT [--workspace ALIAS --programme NAME --delivery UUID32 --index-sha256 SHA256]\n');return 0;}
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const {command,options}=parseArgs(argv);options.signal=controller.signal;
 const result=await(command==='prepare'?prepareNativeAnalysisEventInstallation(options):reopenNativeAnalysisEventInstallation(options));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(error){const code=controller.signal.aborted?'MCP_ANALYSIS_EVENT_INSTALLATION_INTERRUPTED':
 ['ENOSPC','EDQUOT'].includes(error?.code)?'MCP_ANALYSIS_EVENT_INSTALLATION_STORAGE_FULL':
 /^[A-Z0-9_]{1,200}$/.test(error?.code??'')?error.code:'MCP_ANALYSIS_EVENT_INSTALLATION_FAILED';
 process.stderr.write(code+'\n');return 1;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
