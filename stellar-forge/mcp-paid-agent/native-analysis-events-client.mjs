// SPDX-License-Identifier: MIT
// Named original event operations plus complete durable input receiving.
import {join,resolve} from 'node:path';
import {openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {initializationDirectory as directory,initializationBytes as bytes,optionalInitializationBytes as optionalBytes,
 retainInitializationFile as retainFile,retainInitializationRecord as retainRecord}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {EVENT_ID,EVENT_NAME,EVENT_HASH,EVENT_MAX_RECORD,eventObject as object,eventNeed as need,eventHash as sha,eventCanonical}
 from './native-analysis-events-contract.mjs';
const NATIVE='stellar-forge.mcp-native-analysis.v1',INPUT='stellar-forge.analysis-event-input-receiving.v1';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,LIMITS={ndjson:33554432,manifest:4194304};
const FILES={ndjson:'original-events.ndjson',manifest:'original-events.ndjson.manifest.json'};
export async function openNativeAnalysisEventsClient({url,analysisWorkspace,tokenEnv,environment,signal}={}){
 need(typeof analysisWorkspace==='string'&&ALIAS.test(analysisWorkspace),'WORKSPACE_ALIAS_REQUIRED');
 const client=await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'MCP_ANALYSIS_EVENT',
 clientName:'starforge-analysis-events',maximumResponseBytes:512*1024});
 return {endpoint:client.endpoint,analysisWorkspace,async call(operation,request={},options={}){
 need(object(options),'CALL_OPTIONS_INVALID');
 const {signal:requestSignal,...transportOptions}=options;
 need(requestSignal===undefined||transportOptions.requestSignal===undefined||
 requestSignal===transportOptions.requestSignal,'CALL_SIGNAL_CONFLICT');
 if(requestSignal!==undefined)transportOptions.requestSignal=requestSignal;
 const value=await client.call('sf43_discover_review_and_pay',{action:'analysis',analysisWorkspace,
 analysisOperation:operation,analysisRequest:request},transportOptions);
 need(object(value)&&value.schema===NATIVE&&value.analysisWorkspace===analysisWorkspace&&value.operation===operation&&
 object(value.result),'ORIGINAL_RESPONSE_CHANGED');return value.result;
 }};
}
export async function nativeEventConnection(options){
 need(typeof options.analysisWorkspace==='string'&&ALIAS.test(options.analysisWorkspace),'WORKSPACE_ALIAS_REQUIRED');
 if(options.client!==undefined){
 need(object(options.client)&&options.client.analysisWorkspace===options.analysisWorkspace&&
 typeof options.client.call==='function'&&typeof options.client.endpoint==='string'&&options.url===undefined,'CLIENT_REQUIRED');
 return options.client;
 }
 return openNativeAnalysisEventsClient(options);
}
function selected(options){
 need(typeof options.inputId==='string'&&EVENT_ID.test(options.inputId)&&
 typeof options.expectedWorkspaceId==='string'&&EVENT_ID.test(options.expectedWorkspaceId),'INPUT_IDENTITY_REQUIRED');
 need(typeof options.directory==='string'&&resolve(options.directory)!=='/','INPUT_DIRECTORY_REQUIRED');
 return resolve(options.directory);
}
function status(value,request){
 need(object(value)&&value.id===request.inputId&&value.workspace_id===request.workspaceId&&
 eventCanonical(value.files)===eventCanonical(request.files)&&object(value.received)&&typeof value.complete==='boolean','INPUT_SELECTION_CHANGED');
 for(const kind of Object.keys(LIMITS))need(Number.isSafeInteger(value.received[kind])&&value.received[kind]>=0&&
 value.received[kind]<=request.files[kind].bytes,'INPUT_OFFSET_CHANGED');
 need(value.complete===Object.keys(LIMITS).every(kind=>value.received[kind]===request.files[kind].bytes),'INPUT_STATE_CHANGED');
 return value;
}
/** Save both complete original files before first dispatch; replay their same native input. */
export async function receiveNativeAnalysisEventInput(options={}){
 const root=selected(options);await directory(root,{create:true});
 const original=await optionalBytes(join(root,'input-request.json'),65536);
 let request,raw={};
 if(original!==null){
 try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}catch{need(false,'RETAINED_INPUT_CHANGED');}
 need(request.schema===INPUT&&request.analysisWorkspace===options.analysisWorkspace&&
 request.workspaceId===options.expectedWorkspaceId&&request.inputId===options.inputId&&object(request.files),'RETAINED_INPUT_CHANGED');
 for(const [kind,max]of Object.entries(LIMITS)){
 raw[kind]=await bytes(join(root,FILES[kind]),max);
 need(request.files[kind]?.bytes===raw[kind].length&&request.files[kind]?.sha256===sha(raw[kind]),'RETAINED_INPUT_CHANGED');
 const supplied=options[kind+'Path'];
 if(supplied!==undefined)need((await bytes(resolve(supplied),max)).equals(raw[kind]),'ORIGINAL_INPUT_REQUIRED');
 }
 }else{
 need(typeof options.ndjsonPath==='string'&&typeof options.manifestPath==='string','BOTH_ORIGINAL_FILES_REQUIRED');
 const files={};
 for(const [kind,max]of Object.entries(LIMITS)){
 options.signal?.throwIfAborted();const path=resolve(options[kind+'Path']);
 raw[kind]=await bytes(path,max);
 const name=options[kind+'Name']??path.split('/').at(-1);
 need(typeof name==='string'&&Array.from(name).length>=1&&Array.from(name).length<=240&&!/[\x00-\x1f\x7f]/.test(name),'INPUT_NAME_INVALID');
 files[kind]={name,bytes:raw[kind].length,sha256:sha(raw[kind])};
 }
 request={schema:INPUT,analysisWorkspace:options.analysisWorkspace,workspaceId:options.expectedWorkspaceId,
 inputId:options.inputId,files};
 // Exact publication accepts an interrupted identical partial preparation.
 for(const kind of Object.keys(LIMITS))await retainFile(join(root,FILES[kind]),raw[kind],{resume:true});
 await retainRecord(join(root,'input-request.json'),request,{resume:true});
 }
 const client=await nativeEventConnection(options);
 const overview=await client.call('event-overview',{limit:1,programme_limit:1},{signal:options.signal});
 need(overview.workspace_id===request.workspaceId,'ORIGINAL_WORKSPACE_CHANGED');
 let current=status(await client.call('event-input-create',{id:request.inputId,files:request.files},
 {signal:options.signal}),request);
 for(const kind of Object.keys(LIMITS)){
 while(current.received[kind]<raw[kind].length){
 options.signal?.throwIfAborted();
 const offset=current.received[kind],part=raw[kind].subarray(offset,offset+65536);
 current=status(await client.call('event-input-chunk',{id:request.inputId,kind,offset,
 base64:part.toString('base64'),sha256:sha(part)},{signal:options.signal}),request);
 need(current.received[kind]>=offset+part.length,'INPUT_ACKNOWLEDGEMENT_CHANGED');
 await options.onProgress?.({inputId:request.inputId,kind,received:current.received[kind],bytes:raw[kind].length});
 }
 }
 need(current.complete,'COMPLETE_INPUT_REQUIRED');
 const receipt={schema:INPUT,state:'COMPLETE',analysisWorkspace:request.analysisWorkspace,
 workspaceId:request.workspaceId,inputId:request.inputId,files:request.files};
 await retainRecord(join(root,'input-received.json'),receipt,{resume:true});
 return {...receipt,directory:root};
}
/** Recover one complete selected API record; changed live state cannot mix its ranges. */
export async function readNativeAnalysisEventRecord(options={}){
 const client=await nativeEventConnection(options),selected=options.record;
 need(object(selected)&&selected.schema==='stellar-forge.analysis-event-record.v1'&&
 EVENT_ID.test(selected.workspace_id??'')&&EVENT_HASH.test(selected.sha256??'')&&
 Number.isSafeInteger(selected.bytes)&&selected.bytes>=1&&selected.bytes<=EVENT_MAX_RECORD,'RECORD_REQUIRED');
 const chunks=[];let offset=0;
 while(offset<selected.bytes){
 options.signal?.throwIfAborted();const size=Math.min(65536,selected.bytes-offset);
 const value=await client.call('event-record-file',{kind:selected.kind,record_id:selected.record_id,
 sha256:selected.sha256,bytes:selected.bytes,byteOffset:offset,maxBytes:size},{signal:options.signal});
 const part=value?.file;
 need(value?.workspace_id===selected.workspace_id&&value.kind===selected.kind&&value.record_id===selected.record_id&&
 value.sha256===selected.sha256&&part?.verifiedSavedFile===true&&part.sha256===selected.sha256&&part.bytes===selected.bytes&&
 part.byteOffset===offset&&part.returnedBytes===size&&part.encoding==='base64'&&
 part.nextByteOffset===(offset+size<selected.bytes?offset+size:null),'RECORD_CHUNK_CHANGED');
 const raw=Buffer.from(part.data,'base64');need(raw.length===size&&raw.toString('base64')===part.data,'RECORD_CHUNK_CHANGED');
 chunks.push(raw);offset+=raw.length;
 }
 const raw=Buffer.concat(chunks);need(raw.length===selected.bytes&&sha(raw)===selected.sha256,'RECORD_CHANGED');
 // Original JSON tokens remain intact. The caller chooses its lossless parser.
 return {record:{...selected},bytes:raw,text:new TextDecoder('utf-8',{fatal:true}).decode(raw)};
}


async function completeInspection(options,operation,selection,schema){
 need(EVENT_ID.test(options.inputId??'')&&EVENT_ID.test(options.expectedWorkspaceId??''),'INPUT_IDENTITY_REQUIRED');
 const client=await nativeEventConnection(options),result=await client.call(operation,{id:options.inputId,...selection},{signal:options.signal});
 need(result?.workspace_id===options.expectedWorkspaceId&&result.input_id===options.inputId&&result.schema===schema&&
 result.complete_record?.record_id===options.inputId&&result.complete_record.workspace_id===options.expectedWorkspaceId&&
 result.complete_record.kind===(operation==='event-input-fields'?'fields':'values'),'INPUT_INSPECTION_CHANGED');
 const full=await readNativeAnalysisEventRecord({...options,url:undefined,client,record:result.complete_record});
 const value=JSON.parse(full.text);
 need(value.schema===schema&&value.workspace_id===options.expectedWorkspaceId&&value.input_id===options.inputId&&
 value.edition_id===result.edition_id&&eventCanonical(value.original_files)===eventCanonical(result.original_files),
 'INPUT_INSPECTION_CHANGED');
 if(operation==='event-input-fields')need(Array.isArray(value.fields)&&value.field_count===value.fields.length,'COMPLETE_FIELDS_REQUIRED');
 else need(value.pointer===selection.pointer&&value.offset===selection.offset&&value.limit===selection.limit&&
 Array.isArray(value.rows),'FIELD_VALUES_CHANGED');
 return {...full,value};
}
/** Receive the complete source catalogue, including every exact path and preview descriptor. */
export function inspectNativeAnalysisEventFields(options={}){
 return completeInspection(options,'event-input-fields',{},'stellar-forge.event-feed-payload-fields.v1');
}
/** Receive one full original event page with complete native text values. */
export function inspectNativeAnalysisEventFieldValues(options={}){
 const selected={pointer:options.pointer,offset:options.offset??0,limit:options.limit??25};
 return completeInspection(options,'event-input-values',selected,'stellar-forge.event-feed-payload-values.v1');
}
