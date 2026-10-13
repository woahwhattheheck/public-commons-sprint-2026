#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Whole original Event Analysis delivery over the existing retained-file writer.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRetainedDownload} from '../mcp-merchant-operator/retained-download.mjs';
import {initializationDirectory as directory,optionalInitializationBytes as optionalBytes,
 retainInitializationFile as retainFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {nativeEventConnection,receiveNativeAnalysisEventInput} from './native-analysis-events-client.mjs';
import {EVENT_INDEX_NAME,EVENT_MAX_FILE,EVENT_ID,EVENT_HASH,EVENT_NAME,eventObject as object,eventNeed as need,
 eventHash as sha,eventIndexBytes,validateEventDownloadIndex,parseEventDownloadIndex} from './native-analysis-events-contract.mjs';
const PREFIX='native_analysis_events',RESULT='stellar-forge.analysis-event-download.v1';
const STATE='stellar-forge.analysis-event-download-state.v1',ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function selection(options){
 need(typeof options.analysisWorkspace==='string'&&ALIAS.test(options.analysisWorkspace)&&
 typeof options.programme==='string'&&EVENT_NAME.test(options.programme)&&
 typeof options.deliveryId==='string'&&EVENT_ID.test(options.deliveryId),'DELIVERY_SELECTION_REQUIRED');
}
function reviewed(index,options){
 selection(options);validateEventDownloadIndex(index,{programme:options.programme,deliveryId:options.deliveryId});
 need(typeof options.expectedIndexSha256==='string'&&EVENT_HASH.test(options.expectedIndexSha256)&&
 index.index_sha256===options.expectedIndexSha256,'REVIEWED_INDEX_REQUIRED');
}
function root(value){
 need(typeof value==='string'&&value.length>0&&!value.includes('\0')&&resolve(value)!=='/','DIRECTORY_REQUIRED');return resolve(value);
}
function describe(index){
 return {workspaceId:index.workspace_id,programme:index.programme,deliveryId:index.delivery_id,
 acceptedOperationId:index.accepted_operation_id,selectedEditionId:index.edition_id,reviewSha256:index.review_sha256,
 workspaceProgrammeEditionId:index.workspace_programme_edition_id,workspaceProgrammeRevision:index.workspace_programme_revision,
 indexSha256:index.index_sha256,workspaceArchiveSha256:index.files.find(x=>x.name==='Event_Analysis_Workspace.zip').sha256};
}
async function saved(root,deliveryId){
 try{await directory(root);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 let raw=await optionalBytes(join(root,EVENT_INDEX_NAME),65536);
 if(raw===null){
 const controls=join(root,'download-state');
 try{await directory(controls);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 raw=await optionalBytes(join(controls,EVENT_INDEX_NAME),65536);
 }
 return raw===null?null:{raw,index:parseEventDownloadIndex(raw,deliveryId)};
}
async function current(client,options){
 return validateEventDownloadIndex(await client.call('event-delivery-index',
 {programme:options.programme,delivery_id:options.deliveryId},{signal:options.signal}),
 {programme:options.programme,deliveryId:options.deliveryId});
}
const sameKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function adapt(client,index,alias){
 const raw=eventIndexBytes(index),manifestSha256=sha(raw),
 manifestFile={name:EVENT_INDEX_NAME,bytes:raw.length,sha256:manifestSha256};
 return {endpoint:'urn:stellar-forge:analysis-events:'+index.workspace_id+':'+index.programme+':'+index.delivery_id+':'+index.index_sha256+':'+alias,
 async call(name,args,options={}){
 need(object(options),'CALL_OPTIONS_INVALID');
 const {requestSignal,...nativeOptions}=options;
 need(requestSignal===undefined||nativeOptions.signal===undefined||
 requestSignal===nativeOptions.signal,'CALL_SIGNAL_CONFLICT');
 if(requestSignal!==undefined)nativeOptions.signal=requestSignal;
 need(object(args)&&args.exportId===index.delivery_id,'DELIVERY_SELECTION_CHANGED');
 if(name===PREFIX+'_manifest'){
 need(sameKeys(args,['exportId']),'DOWNLOAD_ARGUMENTS_INVALID');
 return {state:'MANIFEST_RETAINED',exportId:index.delivery_id,manifestFile};
 }
 need(name===PREFIX+'_file'&&sameKeys(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit'])&&
 args.expectedManifestSha256===manifestSha256&&Number.isSafeInteger(args.offset)&&args.offset>=0&&
 Number.isSafeInteger(args.limit)&&args.limit>=1&&args.limit<=65536,'DOWNLOAD_CHUNK_CHANGED');
 const file=args.file===EVENT_INDEX_NAME?manifestFile:index.files.find(x=>x.name===args.file);
 need(file&&file.sha256===args.expectedSha256&&args.offset<=file.bytes,'DOWNLOAD_FILE_CHANGED');
 const size=Math.min(args.limit,file.bytes-args.offset);let data;
 if(args.file===EVENT_INDEX_NAME)data=raw.subarray(args.offset,args.offset+size).toString('base64');
 else{
 need(client,'DOWNLOAD_INCOMPLETE');
 const value=await client.call('event-delivery-file',{programme:index.programme,delivery_id:index.delivery_id,
 index_sha256:index.index_sha256,filename:file.name,sha256:file.sha256,byteOffset:args.offset,maxBytes:args.limit},nativeOptions);
 const part=value?.file;
 need(value?.workspace_id===index.workspace_id&&value.programme===index.programme&&value.delivery_id===index.delivery_id&&
 value.index_sha256===index.index_sha256&&value.filename===file.name&&part?.verifiedSavedFile===true&&
 part.sha256===file.sha256&&part.bytes===file.bytes&&part.contentType===file.mime&&part.byteOffset===args.offset&&
 part.returnedBytes===size&&part.encoding==='base64'&&part.nextByteOffset===(args.offset+size<file.bytes?args.offset+size:null),'DOWNLOAD_CHUNK_CHANGED');
 const body=Buffer.from(part.data,'base64');need(body.length===size&&body.toString('base64')===part.data,'DOWNLOAD_ENCODING_INVALID');
 data=part.data;
 }
 return {exportId:index.delivery_id,manifestSha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
 offset:args.offset,bytesRead:size,encoding:'base64',data,nextOffset:args.offset+size<file.bytes?args.offset+size:null};
 }};
}
const transport=createRetainedDownload({manifestName:EVENT_INDEX_NAME,parseManifest:parseEventDownloadIndex,
 maximumBytes:EVENT_MAX_FILE,maximumManifestBytes:65536,maximumCheckpointBytes:65536,
 stateSchema:STATE,resultSchema:RESULT,toolPrefix:PREFIX,errorPrefix:'MCP_ANALYSIS_EVENT',
 clientName:'starforge-analysis-events',readLease:false,
 validateExportId:value=>need(typeof value==='string'&&EVENT_ID.test(value),'DELIVERY_ID_REQUIRED'),describe});
export async function inspectNativeAnalysisEventDelivery(options={}){
 selection(options);const client=await nativeEventConnection(options),index=await current(client,options),raw=eventIndexBytes(index);
 return {schema:RESULT,state:'REVIEW',analysisWorkspace:options.analysisWorkspace,...describe(index),index,
 indexFile:{name:EVENT_INDEX_NAME,bytes:raw.length,sha256:sha(raw)}};
}
export async function downloadNativeAnalysisEventDelivery(options={}){
 selection(options);const destination=root(options.directory),retained=await saved(destination,options.deliveryId);
 const client=await nativeEventConnection(options),index=retained?.index??await current(client,options);
 reviewed(index,options);
 const chunkSize=options.chunkSize??65536;need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=65536,'CHUNK_SIZE_INVALID');
 const result=await transport.download({client:adapt(client,index,options.analysisWorkspace),exportId:index.delivery_id,
 directory:destination,expectedManifestSha256:sha(eventIndexBytes(index)),signal:options.signal,chunkSize,onProgress:options.onProgress});
 return {...result,analysisWorkspace:options.analysisWorkspace,indexFile:join(destination,EVENT_INDEX_NAME)};
}
/** Verify every member from the retained index with no MCP or original host call. */
export async function reopenNativeAnalysisEventDelivery(options={}){
 selection(options);const destination=root(options.directory);await directory(destination);
 const retained=await saved(destination,options.deliveryId);need(retained,'ORIGINAL_DOWNLOAD_REQUIRED');reviewed(retained.index,options);
 return transport.lockedDownload(destination,async context=>{
 await transport.loadContext(context,retained.raw,retained.index.delivery_id,
 adapt(null,retained.index,options.analysisWorkspace).endpoint);
 for(const file of retained.index.files){
 options.signal?.throwIfAborted();context.lease.assertHeld();
 await transport.verifiedFile(join(destination,file.name),file,options.signal);
 context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
 }
 await transport.checkpoint(context);context.lease.assertHeld();
 await retainFile(join(destination,EVENT_INDEX_NAME),retained.raw,{resume:true});
 return {schema:RESULT,state:'COMPLETE',directory:destination,exportId:retained.index.delivery_id,
 ...describe(retained.index),analysisWorkspace:options.analysisWorkspace,offline:true,resumed:true,
 resumedBytes:retained.index.files.reduce((n,f)=>n+f.bytes,0),files:retained.index.files.length,
 bytes:retained.index.files.reduce((n,f)=>n+f.bytes,0),indexFile:join(destination,EVENT_INDEX_NAME)};
 });
}
function argsFor(argv){
 const [command,...rest]=argv,common=['--url','--workspace','--programme','--delivery','--token-env'];
 const allowed={inspect:common,download:[...common,'--dir','--index-sha256','--chunk-size'],
 reopen:['--workspace','--programme','--delivery','--dir','--index-sha256'],
 input:['--url','--workspace','--workspace-id','--input','--dir','--ndjson','--manifest','--token-env']};
 need(Object.hasOwn(allowed,command)&&rest.length%2===0,'ARGUMENTS_INVALID');const values={};
 for(let i=0;i<rest.length;i+=2){need(allowed[command].includes(rest[i])&&!Object.hasOwn(values,rest[i])&&rest[i+1],'ARGUMENTS_INVALID');values[rest[i]]=rest[i+1];}
 return {command,options:{url:values['--url'],analysisWorkspace:values['--workspace'],programme:values['--programme'],
 deliveryId:values['--delivery'],directory:values['--dir'],expectedIndexSha256:values['--index-sha256'],
 expectedWorkspaceId:values['--workspace-id'],inputId:values['--input'],ndjsonPath:values['--ndjson'],manifestPath:values['--manifest'],
 tokenEnv:values['--token-env'],...(values['--chunk-size']===undefined?{}:{chunkSize:Number(values['--chunk-size'])})}};
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length===1&&argv[0]==='--help'){
 process.stdout.write('Original Event programmes native MCP receiving.\n'+
 'input --url MCP_URL --workspace ALIAS --workspace-id UUID32 --input UUID32 --dir PRIVATE_DIR [--ndjson ORIGINAL_FILE --manifest ORIGINAL_MANIFEST] [--token-env NAME]\n'+
 'inspect --url MCP_URL --workspace ALIAS --programme NAME --delivery UUID32 [--token-env NAME]\n'+
 'download --url MCP_URL --workspace ALIAS --programme NAME --delivery UUID32 --dir PRIVATE_DIR --index-sha256 SHA256 [--token-env NAME] [--chunk-size 1..65536]\n'+
 'reopen --workspace ALIAS --programme NAME --delivery UUID32 --dir PRIVATE_DIR --index-sha256 SHA256\n');return 0;
 }
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
 const {command,options}=argsFor(argv);options.signal=controller.signal;
 const result=await(command==='input'?receiveNativeAnalysisEventInput(options):command==='inspect'?
 inspectNativeAnalysisEventDelivery(options):command==='download'?downloadNativeAnalysisEventDelivery(options):reopenNativeAnalysisEventDelivery(options));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(error){
 const code=controller.signal.aborted?'MCP_ANALYSIS_EVENT_INTERRUPTED':
 ['ENOSPC','EDQUOT'].includes(error?.code)?'MCP_ANALYSIS_EVENT_STORAGE_FULL':
 /^[A-Z0-9_]{1,200}$/.test(error?.code??'')?error.code:'MCP_ANALYSIS_EVENT_RECEIVING_FAILED';
 process.stderr.write(code+'\n');return 1;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
