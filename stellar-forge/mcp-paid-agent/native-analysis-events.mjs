// SPDX-License-Identifier: MIT
// Complete agent use of the original private Event programmes service.
import {join,resolve} from 'node:path';
import {initializationDirectory as directory,initializationBytes as bytes,
 retainInitializationFile as retainFile,retainInitializationRecord as retainRecord}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {nativeEventOperations} from './native-analysis-events-schema.mjs';
import {EVENT_DOWNLOAD_SCHEMA,EVENT_MAX_RECORD,EVENT_MAX_FILE,EVENT_ID,EVENT_HASH,EVENT_NAME,
 EVENT_FILES,eventObject as object,eventNeed as need,eventHash as sha,eventCanonical,eventMime,
 validateEventDownloadIndex} from './native-analysis-events-contract.mjs';
const ROOT='/api/event-programmes',RECORD='stellar-forge.analysis-event-record.v1';
const INPUT_LIMITS={ndjson:32*1024*1024,manifest:4*1024*1024};
const check=(value,pattern,code)=>{need(typeof value==='string'&&pattern.test(value),code);return value;};
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>{need(Number.isSafeInteger(value)&&value>=min&&value<=max,'INTEGER_INVALID');return value;};
const copy=value=>structuredClone(value);
const preview=value=>{let part=value.slice(0,160);return /[\uD800-\uDBFF]$/.test(part)?part.slice(0,-1):part;};
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,copy(value[key])]));
const query=value=>{const list=Object.entries(value).filter(([,v])=>v!==undefined);return list.length?'?'+new URLSearchParams(list.map(([k,v])=>[k,String(v)])):'';};
function fields(value,required,optional=[]){
 need(object(value)&&required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),'FIELDS_INVALID');
}
function label(value,maximum){
 need(typeof value==='string'&&Array.from(value).length>=1&&Array.from(value).length<=maximum&&
 !/[\x00-\x1f\x7f]/.test(value),'LABEL_INVALID');return value;
}
function programme(value,record,name){
 need(object(value)&&value.schema==='stellar-forge.event-feed-analysis-programme.v1'&&value.workspace_id===record.workspaceId&&
 EVENT_NAME.test(value.name??'')&&(name===undefined||value.name===name),'PROGRAMME_CHANGED');
 integer(value.revision);need(Array.isArray(value.history),'PROGRAMME_CHANGED');
 return {...pick(value,['schema','name','workspace_id','revision','pending','report_name','workbook_name']),
 accepted:value.accepted?pick(value.accepted,['operation_id','edition_id','version_id','review_sha256']):null,history_count:value.history.length};
}
function action(value,record,id){
 need(object(value)&&value.workspace_id===record.workspaceId&&EVENT_ID.test(value.id??'')&&
 EVENT_NAME.test(value.programme??'')&&(id===undefined||value.id===id)&&object(value.request)&&
 ['review','apply','refresh-review','deliver'].includes(value.request.action),'ACTION_CHANGED');
 check(value.request.operation_id,EVENT_ID,'OPERATION_ID_REQUIRED');
 const result=pick(value,['id','programme','workspace_id','created_at','updated_at','status','attempts','error']);
 result.request=pick(value.request,['action','operation_id','input_id','review_sha256']);
 if(value.progress)result.progress=pick(value.progress,['phase','id','kind','status','message']);
 if(object(value.result))result.result=pick(value.result,['schema','operation_id','accepted_operation_id','edition_id',
 'review_sha256','version_id','report_name','workbook_name','workbook_job_id','workspace_archive_job_id',
 'workspace_programme_revision','workspace_programme_edition_id']);
 return result;
}
function input(value,record,id,expected){
 need(object(value)&&value.workspace_id===record.workspaceId&&value.id===id&&object(value.files)&&object(value.received)&&
 typeof value.complete==='boolean','INPUT_CHANGED');
 fields(value.files,['ndjson','manifest']);
 for(const [kind,maximum]of Object.entries(INPUT_LIMITS)){
 const file=value.files[kind];fields(file,['name','bytes','sha256']);label(file.name,240);
 integer(file.bytes,0,maximum);check(file.sha256,EVENT_HASH,'FILE_DIGEST_REQUIRED');
 integer(value.received[kind],0,file.bytes);
 if(expected)need(eventCanonical(file)===eventCanonical(expected[kind]),'INPUT_SELECTION_CHANGED');
 }
 need(value.complete===Object.keys(INPUT_LIMITS).every(kind=>value.received[kind]===value.files[kind].bytes),'INPUT_CHANGED');
 return value;
}

function inspection(value,record,id,schema){
 need(object(value)&&value.schema===schema&&value.workspace_id===record.workspaceId&&value.input_id===id&&
 object(value.original_files)&&object(value.source)&&object(value.receiver),'INPUT_INSPECTION_CHANGED');
 check(value.edition_id,EVENT_HASH,'SOURCE_EDITION_REQUIRED');integer(value.events);
 check(value.receiver.cli_sha256,EVENT_HASH,'SOURCE_RECEIVER_REQUIRED');check(value.receiver.core_sha256,EVENT_HASH,'SOURCE_RECEIVER_REQUIRED');
 for(const [kind,maximum]of Object.entries(INPUT_LIMITS)){
 const file=value.original_files[kind];need(object(file),'INPUT_INSPECTION_CHANGED');
 integer(file.bytes,0,maximum);check(file.sha256,EVENT_HASH,'SOURCE_DIGEST_REQUIRED');
 }
 return pick(value,['schema','workspace_id','input_id','edition_id','source','original_files','events','through_sequence','pages','receiver']);
}

function recordIdentity(kind,id){
 need(['overview','programme','action','fields','values'].includes(kind),'RECORD_KIND_INVALID');
 if(kind==='overview')need(id==='overview','RECORD_ID_REQUIRED');
 else check(id,kind==='programme'?EVENT_NAME:EVENT_ID,'RECORD_ID_REQUIRED');
}
function page(array,offset=0,limit=25,transform=x=>x){
 need(Array.isArray(array),'COLLECTION_REQUIRED');integer(offset,0,array.length);integer(limit,1,100);
 return {items:array.slice(offset,offset+limit).map(transform),total:array.length,
 next_offset:offset+limit<array.length?offset+limit:null};
}
/** Parent service owns its capability, call cancellation and all native jobs. */
export function createNativeEventActions({reads,parse}={}){
 need(typeof reads==='function'&&typeof parse==='function','ORIGINAL_FILE_HELPERS_REQUIRED');
 const handles=operation=>Object.hasOwn(nativeEventOperations,operation);
 async function cache(record,kind,id){
 check(record?.workspaceId,EVENT_ID,'WORKSPACE_ID_REQUIRED');recordIdentity(kind,id);
 need(typeof record.nativeWorkspace==='string'&&resolve(record.nativeWorkspace)===record.nativeWorkspace,'ORIGINAL_HOST_REQUIRED');
 let path=record.nativeWorkspace;await directory(path);
 for(const part of ['analysis','event-records',record.workspaceId,kind,id]){path=join(path,part);await directory(path,{create:true});}
 return path;
 }
 async function retain(raw,record,kind,id){
 need(Buffer.isBuffer(raw)&&raw.length>=1&&raw.length<=EVENT_MAX_RECORD,'RECORD_SIZE_INVALID');
 const descriptor={schema:RECORD,workspace_id:record.workspaceId,kind,record_id:id,bytes:raw.length,sha256:sha(raw)};
 const path=await cache(record,kind,id);
 await retainFile(join(path,descriptor.sha256+'.json'),raw,{resume:true});
 await retainRecord(join(path,descriptor.sha256+'.record.json'),descriptor,{resume:true});
 return descriptor;
 }
 async function snapshot(record,kind,id,request,project){
 const raw=await request(),value=parse(raw),result=project(value);
 return {...result,complete_record:await retain(raw,record,kind,id)};
 }
 async function readRecord(body,record){
 recordIdentity(body.kind,body.record_id);check(body.sha256,EVENT_HASH,'RECORD_DIGEST_REQUIRED');
 integer(body.bytes,1,EVENT_MAX_RECORD);
 const path=await cache(record,body.kind,body.record_id);
 const meta=parse(await bytes(join(path,body.sha256+'.record.json'),4096));
 need(meta.schema===RECORD&&meta.workspace_id===record.workspaceId&&meta.kind===body.kind&&
 meta.record_id===body.record_id&&meta.bytes===body.bytes&&meta.sha256===body.sha256,'RECORD_CHANGED');
 return {...meta,file:await reads({destination:join(path,body.sha256+'.json'),bytes:body.bytes,sha256:body.sha256,
 contentType:'application/json'},body)};
 }
 async function delivery(record,get,body){
 check(body.programme,EVENT_NAME,'PROGRAMME_REQUIRED');check(body.delivery_id,EVENT_ID,'DELIVERY_ID_REQUIRED');
 const saved=await get(ROOT+'/actions/'+body.delivery_id,{maximum:EVENT_MAX_RECORD});
 action(saved,record,body.delivery_id);
 need(saved.programme===body.programme&&saved.status==='COMPLETE'&&saved.request.action==='deliver','COMPLETE_DELIVERY_REQUIRED');
 const value=saved.result;
 need(object(value)&&value.schema==='stellar-forge.event-feed-analysis-delivery.v1'&&value.programme===body.programme&&
 value.workspace_id===record.workspaceId&&value.operation_id===body.delivery_id,'DELIVERY_CHANGED');
 need(Array.isArray(value.files),'COMPLETE_DELIVERY_FILES_REQUIRED');
 const index={schema:EVENT_DOWNLOAD_SCHEMA,workspace_id:record.workspaceId,programme:body.programme,
 delivery_id:body.delivery_id,accepted_operation_id:value.accepted_operation_id,edition_id:value.edition_id,
 review_sha256:value.review_sha256,workspace_programme_edition_id:value.workspace_programme_edition_id,
 workspace_programme_revision:value.workspace_programme_revision,
 files:value.files.map(file=>({name:file.name,bytes:file.bytes,sha256:file.sha256,mime:eventMime(file.name)}))
 .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
 index.index_sha256=sha(Buffer.from(eventCanonical(index)));
 return validateEventDownloadIndex(index,{workspaceId:record.workspaceId,programme:body.programme,deliveryId:body.delivery_id});
 }
 async function call({operation,body,record,get,post,getBytes,postBytes,signal}){
 need(handles(operation)&&object(body)&&object(record)&&typeof get==='function'&&typeof post==='function'&&
 typeof getBytes==='function'&&typeof postBytes==='function','ORIGINAL_TRANSPORT_REQUIRED');
 const spec=nativeEventOperations[operation];fields(body,spec.required,Object.keys(spec.properties).filter(k=>!spec.required.includes(k)));
 signal?.throwIfAborted();
 if(operation==='event-record-file')return readRecord(body,record);
 if(operation==='event-overview'){
 for(const key of ['actions_before','inputs_before'])if(body[key]!==undefined)integer(body[key],1);
 const limit=body.limit??25;integer(limit,1,100);
 return snapshot(record,'overview','overview',()=>getBytes(ROOT+query({
 actions_before:body.actions_before,inputs_before:body.inputs_before,limit}),EVENT_MAX_RECORD),value=>{
 need(object(value)&&value.workspace_id===record.workspaceId&&Array.isArray(value.programmes)&&
 Array.isArray(value.actions)&&Array.isArray(value.inputs),'OVERVIEW_CHANGED');
 const programmes=page(value.programmes,body.programme_offset??0,body.programme_limit??25,x=>programme(x,record));
 const actions=value.actions.map(x=>action(x,record)),inputs=value.inputs.map(x=>{
 check(x.id,EVENT_ID,'INPUT_ID_REQUIRED');return pick(x,['id','files','created_at']);});
 return {workspace_id:record.workspaceId,active:value.active,source_receiver_available:value.source_receiver_available,
 programmes,actions,inputs,next_actions:value.next_actions,next_inputs:value.next_inputs};
 });
 }
 if(operation==='event-input-create'){
 check(body.id,EVENT_ID,'INPUT_ID_REQUIRED');fields(body.files,['ndjson','manifest']);
 for(const [kind,max]of Object.entries(INPUT_LIMITS)){const file=body.files[kind];fields(file,['name','bytes','sha256']);
 label(file.name,240);integer(file.bytes,0,max);check(file.sha256,EVENT_HASH,'FILE_DIGEST_REQUIRED');}
 return input(await post(ROOT+'/inputs',copy(body)),record,body.id,body.files);
 }
 if(operation==='event-input')return input(await get(ROOT+'/inputs/'+check(body.id,EVENT_ID,'INPUT_ID_REQUIRED')),record,body.id);

 if(operation==='event-input-fields'){
 check(body.id,EVENT_ID,'INPUT_ID_REQUIRED');integer(body.field_limit??25,1,50);
 return snapshot(record,'fields',body.id,()=>getBytes(ROOT+'/inputs/'+body.id+'/fields',EVENT_MAX_RECORD),value=>{
 const selected=inspection(value,record,body.id,'stellar-forge.event-feed-payload-fields.v1');
 need(Array.isArray(value.fields)&&value.field_count===value.fields.length,'COMPLETE_FIELDS_REQUIRED');
 return {...selected,field_count:value.field_count,fields:page(value.fields,body.field_offset??0,body.field_limit??25,row=>{
 need(object(row)&&typeof row.pointer==='string'&&typeof row.selectable==='boolean'&&object(row.types)&&
 Array.isArray(row.examples),'FIELD_COVERAGE_CHANGED');
 integer(row.present,0,value.events);integer(row.missing,0,value.events);
 need(row.present+row.missing===value.events,'FIELD_COVERAGE_CHANGED');
 return {...pick(row,['present','missing','types','selectable','examples']),pointer:row.selectable?row.pointer:preview(row.pointer),
 pointer_preview:!row.selectable};
 })};
 });
 }
 if(operation==='event-input-values'){
 check(body.id,EVENT_ID,'INPUT_ID_REQUIRED');
 need(typeof body.pointer==='string'&&body.pointer.length<=2000&&
 (body.pointer===''||body.pointer.startsWith('/'))&&!/~(?:[^01]|$)/.test(body.pointer),'PAYLOAD_POINTER_REQUIRED');
 integer(body.offset??0);integer(body.limit??25,1,100);
 const selected={pointer:body.pointer,offset:body.offset??0,limit:body.limit??25};
 return snapshot(record,'values',body.id,()=>postBytes(ROOT+'/inputs/'+body.id+'/inspect',selected,EVENT_MAX_RECORD),value=>{
 const original=inspection(value,record,body.id,'stellar-forge.event-feed-payload-values.v1');
 need(value.pointer===selected.pointer&&value.offset===selected.offset&&value.limit===selected.limit&&
 value.total===value.events&&Array.isArray(value.rows)&&value.rows.length<=selected.limit,'FIELD_VALUES_CHANGED');
 return {...original,...pick(value,['pointer','offset','limit','total','next_offset']),rows:value.rows.map(row=>{
 need(object(row)&&object(row.event)&&['missing','null','string','number','boolean','object','array'].includes(row.state)&&
 (row.text===null||typeof row.text==='string'),'FIELD_VALUES_CHANGED');
 return {...pick(row,['index','event','state','value_bytes','value_sha256']),text_preview:row.text===null?null:preview(row.text),
 text_truncated:typeof row.text==='string'&&preview(row.text)!==row.text};
 })};
 });
 }

 if(operation==='event-input-chunk'){
 check(body.id,EVENT_ID,'INPUT_ID_REQUIRED');need(Object.hasOwn(INPUT_LIMITS,body.kind),'FILE_KIND_REQUIRED');
 integer(body.offset);check(body.sha256,EVENT_HASH,'CHUNK_DIGEST_REQUIRED');
 need(typeof body.base64==='string'&&body.base64.length<=87384,'CHUNK_ENCODING_INVALID');
 const raw=Buffer.from(body.base64,'base64');need(raw.length>0&&raw.length<=65536&&raw.toString('base64')===body.base64&&sha(raw)===body.sha256,'CHUNK_CHANGED');
 return input(await post(ROOT+'/inputs/'+body.id+'/'+body.kind,pick(body,['offset','base64','sha256'])),record,body.id);
 }
 if(operation==='event-programme'){
 check(body.programme,EVENT_NAME,'PROGRAMME_REQUIRED');
 return snapshot(record,'programme',body.programme,()=>getBytes(ROOT+'/named/'+body.programme,EVENT_MAX_RECORD),value=>{
 need(object(value)&&Array.isArray(value.operations),'PROGRAMME_CHANGED');
 return {programme:programme(value.programme,record,body.programme),
 operations:page(value.operations,body.offset??0,body.limit??25,x=>{
 check(x.id,EVENT_ID,'OPERATION_ID_REQUIRED');
 return {...pick(x,['id','kind']),review_sha256:x.review?.review_sha256??null,
 edition_id:x.applied?.accepted?.edition_id??null,has_delivery:object(x.delivery),
 prior_customer_attempts:x.prior_customer_attempts?.length??0};
 })};
 });
 }
 if(operation==='event-action'){
 check(body.id,EVENT_ID,'ACTION_ID_REQUIRED');
 return snapshot(record,'action',body.id,()=>getBytes(ROOT+'/actions/'+body.id,EVENT_MAX_RECORD),value=>action(value,record,body.id));
 }
 if(operation==='event-delivery-index')return delivery(record,get,body);
 if(operation==='event-delivery-file'){
 check(body.index_sha256,EVENT_HASH,'INDEX_DIGEST_REQUIRED');check(body.sha256,EVENT_HASH,'FILE_DIGEST_REQUIRED');
 need(EVENT_FILES.includes(body.filename),'DELIVERY_FILE_REQUIRED');
 const index=await delivery(record,get,body),file=index.files.find(x=>x.name===body.filename);
 need(index.index_sha256===body.index_sha256&&file.sha256===body.sha256,'DELIVERY_SELECTION_CHANGED');
 const root=join(record.database,'event-browser-deliveries'),folder=join(root,body.delivery_id);
 // Resolve only from the host-registered received database; retained sender paths are provenance.
 await directory(record.database);await directory(root);await directory(folder);
 const manifest=index.files.find(x=>x.name==='Event_Analysis_Delivery.json');
 await reads({destination:join(folder,manifest.name),bytes:manifest.bytes,sha256:manifest.sha256,
 contentType:manifest.mime},{maxBytes:1});
 return {workspace_id:record.workspaceId,programme:index.programme,delivery_id:index.delivery_id,
 index_sha256:index.index_sha256,filename:file.name,
 file:await reads({destination:join(folder,file.name),bytes:file.bytes,sha256:file.sha256,contentType:file.mime},body)};
 }
 check(body.programme,EVENT_NAME,'PROGRAMME_REQUIRED');check(body.id,EVENT_ID,'ACTION_ID_REQUIRED');
 check(body.operation_id,EVENT_ID,'OPERATION_ID_REQUIRED');need(body.resume===undefined||typeof body.resume==='boolean','RESUME_REQUIRED');
 const actionName=operation.slice('event-'.length),request={id:body.id,operation_id:body.operation_id,action:actionName};
 if(body.resume!==undefined)request.resume=body.resume;
 if(actionName==='review'){
 check(body.input_id,EVENT_ID,'INPUT_ID_REQUIRED');fields(body.mapping,['fields'],['schema']);
 need(body.mapping.schema===undefined||body.mapping.schema==='stellar-forge.event-feed-analysis-mapping.v1','MAPPING_SCHEMA_INVALID');
 need(Array.isArray(body.mapping.fields)&&body.mapping.fields.length<=100,'FIELD_MAPPING_REQUIRED');
 for(const field of body.mapping.fields){fields(field,['name','pointer']);check(field.name,/^[A-Za-z][A-Za-z0-9_]{0,47}$/,'FIELD_NAME_INVALID');
 need(typeof field.pointer==='string'&&field.pointer.length<=2000&&(field.pointer===''||field.pointer.startsWith('/'))&&
 !/~(?:[^01]|$)/.test(field.pointer),'FIELD_POINTER_INVALID');}
 request.input_id=body.input_id;request.mapping=copy(body.mapping);
 }else if(actionName==='apply'||actionName==='refresh-review'){
 check(body.review_sha256,EVENT_HASH,'REVIEW_REQUIRED');
 need(typeof body.note==='string'&&body.note.trim()&&Buffer.byteLength(body.note)<=8000,'DECISION_NOTE_REQUIRED');
 request.review_sha256=body.review_sha256;request.note=body.note;
 if(actionName==='apply'){need(body.columns===undefined||object(body.columns),'WORKBOOK_COLUMNS_INVALID');
 request.columns=copy(body.columns??{});need(Buffer.byteLength(JSON.stringify(request.columns))<=512*1024,'WORKBOOK_COLUMNS_INVALID');}
 }else need(actionName==='deliver'&&body.id!==body.operation_id,'FRESH_DELIVERY_ID_REQUIRED');
 return snapshot(record,'action',body.id,()=>postBytes(ROOT+'/named/'+body.programme+'/actions',request,EVENT_MAX_RECORD),value=>{
 const result=action(value,record,body.id);
 need(value.programme===body.programme&&value.request.action===actionName&&value.request.operation_id===body.operation_id,'ACTION_SELECTION_CHANGED');
 return result;
 });
 }
 return {handles,call};
}
