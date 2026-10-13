// SPDX-License-Identifier: MIT
// Shared exact-file contract for the original Event programmes agent handover.
import {createHash} from 'node:crypto';
export const EVENT_DOWNLOAD_SCHEMA='stellar-forge.analysis-event-downloads.v1';
export const EVENT_INDEX_NAME='event-download-index.json';
export const EVENT_MAX_FILE=1024*1024*1024;
export const EVENT_MAX_RECORD=64*1024*1024;
export const EVENT_ID=/^[a-f0-9]{32}$/;
export const EVENT_HASH=/^[a-f0-9]{64}$/;
export const EVENT_NAME=/^[A-Za-z][A-Za-z0-9_]{0,23}$/;
export const EVENT_FILES=Object.freeze([
 'Event_Analysis.xlsx','Event_Workbook_Handover.zip','Event_Report.html','Event_Report.json',
 'Event_Report_Tables.zip','Complete_Event_Table.jsonl','Complete_Event_Table.csv',
 'Complete_Event_Table_Manifest.json','Original_events.ndjson','Original_events.ndjson.manifest.json',
 'Reviewed_customer_window.json','Customer_programme.json','Event_Analysis_Workspace.zip',
 'Event_Analysis_Workspace_Manifest.json','Open_and_use.md','Event_Analysis_Delivery.json'
].sort());
export const eventObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function eventNeed(value,code){if(!value)throw Object.assign(new Error('MCP_ANALYSIS_EVENT_'+code),{code:'MCP_ANALYSIS_EVENT_'+code});}
export const eventHash=raw=>createHash('sha256').update(raw).digest('hex');
export function eventCanonical(value){
 return Array.isArray(value)?'['+value.map(eventCanonical).join(',')+']':eventObject(value)?
 '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+eventCanonical(value[key])).join(',')+'}':JSON.stringify(value);
}
export const eventIndexBytes=value=>Buffer.from(eventCanonical(value)+'\n');
export const eventMime=name=>name.endsWith('.zip')?'application/zip':name.endsWith('.xlsx')?
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':name.endsWith('.html')?
 'text/html;charset=utf-8':name.endsWith('.json')?'application/json':name.endsWith('.ndjson')||name.endsWith('.jsonl')?
 'application/x-ndjson':'text/plain;charset=utf-8';
export function validateEventDownloadIndex(index,{workspaceId,programme,deliveryId}={}){
 const need=eventNeed,hash=value=>typeof value==='string'&&EVENT_HASH.test(value);
 need(eventObject(index)&&index.schema===EVENT_DOWNLOAD_SCHEMA&&EVENT_ID.test(index.workspace_id??'')&&
 EVENT_ID.test(index.delivery_id??'')&&EVENT_ID.test(index.accepted_operation_id??'')&&EVENT_NAME.test(index.programme??''),
 'DOWNLOAD_IDENTITY_INVALID');
 need((workspaceId===undefined||index.workspace_id===workspaceId)&&(programme===undefined||index.programme===programme)&&
 (deliveryId===undefined||index.delivery_id===deliveryId),'DOWNLOAD_SELECTION_CHANGED');
 need(hash(index.edition_id)&&hash(index.review_sha256)&&hash(index.workspace_programme_edition_id)&&hash(index.index_sha256)&&
 Number.isSafeInteger(index.workspace_programme_revision)&&index.workspace_programme_revision>=1,'DOWNLOAD_EDITION_INVALID');
 need(Array.isArray(index.files)&&index.files.length===EVENT_FILES.length&&
 JSON.stringify(index.files.map(file=>file?.name))===JSON.stringify(EVENT_FILES),'COMPLETE_DELIVERY_FILES_REQUIRED');
 for(const file of index.files)need(eventObject(file)&&Object.keys(file).length===4&&
 Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=EVENT_MAX_FILE&&hash(file.sha256)&&
 file.mime===eventMime(file.name),'DOWNLOAD_FILE_CHANGED');
 const {index_sha256,...body}=index;
 need(eventHash(Buffer.from(eventCanonical(body)))===index_sha256&&eventIndexBytes(index).length<=65536,'DOWNLOAD_INDEX_CHANGED');
 return index;
}
export function parseEventDownloadIndex(raw,deliveryId){
 eventNeed(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=65536,'DOWNLOAD_INDEX_CHANGED');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{eventNeed(false,'DOWNLOAD_INDEX_CHANGED');}
 validateEventDownloadIndex(value,{deliveryId});
 eventNeed(eventIndexBytes(value).equals(raw),'DOWNLOAD_INDEX_CHANGED');
 return value;
}
