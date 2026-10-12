// MIT. Zotero Web API v3 source-selection contracts; no remote writes.
import {createHash} from 'node:crypto';
export const SCHEMA = Object.freeze({
  profile:'stellar-forge.zotero-profile.v1', edition:'stellar-forge.zotero-edition.v1',
  documentSet:'stellar-forge.zotero-document-set.v1', project:'stellar-forge.zotero-project.v1',
  capture:'stellar-forge.zotero-capture.v1', portable:'stellar-forge.zotero-workspace-transfer.v1',
  connection:'stellar-forge.zotero-workspace-connection.v1', api:'stellar-forge.zotero-workspace-api.v1',
});
export const LIMIT = Object.freeze({page:16*1024*1024, capture:64*1024*1024,
  transfer:256*1024*1024, metadata:16*1024*1024, items:50000, pages:2000,
  control:1024*1024, histories:100000});
export class ZoteroError extends Error {
  constructor(code, details={}) {super(code);this.name='ZoteroError';this.code=code;this.details=details;}
}
export function need(ok,code,details={}) {if(!ok)throw new ZoteroError(code,details);}
export const plain = value => value!==null && typeof value==='object' && !Array.isArray(value);
export const clone = value => structuredClone(value);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export function json(value) {
  return Buffer.from(JSON.stringify(value,(_key,item)=>{
    need(item!==undefined && typeof item!=='bigint' && typeof item!=='function' &&
      typeof item!=='symbol' && (typeof item!=='number'||Number.isFinite(item)),'ZOTERO_JSON_VALUE_INVALID');
    return item;
  },2)+'\n');
}
export function parse(bytes) {
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw new ZoteroError('ZOTERO_JSON_INVALID');}
}
export function text(value,code,max=4000,empty=false) {
  need(typeof value==='string' && value.length<=max && !value.includes('\0') &&
    (empty||value.trim().length>0),code);return value;
}
export function id(value,code='ZOTERO_ID_INVALID') {
  need(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value),code);return value;
}
export function requestId(value) {
  need(typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    'ZOTERO_REQUEST_UUID_REQUIRED');return value.toLowerCase();
}
export function key(value) {
  need(typeof value==='string' && /^[A-Z0-9]{8}$/.test(value),'ZOTERO_OBJECT_KEY_INVALID');return value;
}
export function revision(value,{zero=false}={}) {
  need(Number.isSafeInteger(value)&&value>=(zero?0:1),'ZOTERO_REVISION_REQUIRED');return value;
}
export function library(value) {
  need(plain(value)&&['users','groups'].includes(value.type)&&typeof value.id==='string'&&/^[1-9][0-9]{0,19}$/.test(value.id),
    'ZOTERO_LIBRARY_SELECTION_INVALID');
  return {type:value.type,id:value.id};
}
export function libraryIdentity(value) {const v=library(value);return 'web-v3:'+v.type+':'+v.id;}
export function profile(value) {
  need(plain(value),'ZOTERO_PROFILE_REQUIRED');
  need(value.schema===undefined||value.schema===SCHEMA.profile,'ZOTERO_PROFILE_SCHEMA_INVALID');
  const apiKeyEnv=value.apiKeyEnv??null;
  need(apiKeyEnv===null||typeof apiKeyEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv),
    'ZOTERO_KEY_ENV_INVALID');
  const scope=value.scope??{collectionKeys:[],includeDescendants:true};
  need(plain(scope)&&Array.isArray(scope.collectionKeys)&&scope.collectionKeys.length<=1000&&
    typeof (scope.includeDescendants??true)==='boolean','ZOTERO_SCOPE_INVALID');
  const collectionKeys=[...new Set(scope.collectionKeys.map(key))];
  const bounded=(name,defaultValue,min,max)=>{const v=value[name]??defaultValue;
    need(Number.isSafeInteger(v)&&v>=min&&v<=max,'ZOTERO_PROFILE_LIMIT_INVALID',{field:name});return v;};
  return {schema:SCHEMA.profile,title:text(value.title,'ZOTERO_PROFILE_TITLE_REQUIRED',240),
    library:library(value.library),apiKeyEnv,
    sourceTerms:text(value.sourceTerms,'ZOTERO_SOURCE_TERMS_REQUIRED',20000),
    scope:{collectionKeys,includeDescendants:scope.includeDescendants??true},
    includeTrashed:value.includeTrashed===true,
    timeoutMs:bounded('timeoutMs',30000,1000,120000),
    maxPageBytes:bounded('maxPageBytes',LIMIT.page,1024,LIMIT.page),
    maxCaptureBytes:bounded('maxCaptureBytes',LIMIT.capture,1024,LIMIT.capture),
    maxItems:bounded('maxItems',LIMIT.items,1,LIMIT.items)};
}
export function baseURL(selection) {const v=library(selection);return 'https://api.zotero.org/'+v.type+'/'+v.id;}
export function collectionScope(value,collections) {
  need(plain(value)&&Array.isArray(value.collectionKeys),'ZOTERO_SCOPE_INVALID');
  const selected=new Set(value.collectionKeys.map(key)),byKey=new Map(collections.map(c=>[c.key,c]));
  for(const k of selected)need(byKey.has(k),'ZOTERO_COLLECTION_NOT_IN_EDITION',{key:k});
  if(value.includeDescendants!==false) {
    let changed=true;
    while(changed){changed=false;for(const c of collections)if(c.data.parentCollection&&selected.has(c.data.parentCollection)&&!selected.has(c.key)){selected.add(c.key);changed=true;}}
  }
  return selected;
}
export function safeFilename(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value)&&!value.includes('..'),
    'ZOTERO_FILENAME_INVALID');return value;
}
export function safeCode(error) {
  return /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ZOTERO_OPERATION_FAILED';
}
export function objectReference(value) {
  need(plain(value)&&/^[a-f0-9]{64}$/.test(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0,
    'ZOTERO_OBJECT_REFERENCE_INVALID');return {sha256:value.sha256,bytes:value.bytes};
}

export function captureTransport(value,{customFetch=false}={}) {
  if(value===undefined||value===null){
    need(!customFetch,'ZOTERO_CUSTOM_TRANSPORT_IDENTITY_REQUIRED');
    return {schema:'stellar-forge.zotero-capture-transport.v1',mode:'zotero-web-api-v3',endpoint:'https://api.zotero.org'};
  }
  need(plain(value)&&value.mode==='local-protocol-exercise'&&customFetch,'ZOTERO_CAPTURE_TRANSPORT_INVALID');
  const endpoint=new URL(value.endpoint);
  need(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&endpoint.port&&endpoint.pathname==='/'&&
    !endpoint.search&&!endpoint.hash&&!endpoint.username&&!endpoint.password,'ZOTERO_PROTOCOL_EXERCISE_LOOPBACK_REQUIRED');
  return {schema:'stellar-forge.zotero-capture-transport.v1',mode:'local-protocol-exercise',
    id:id(value.id),endpoint:endpoint.origin,sourceReference:text(value.sourceReference,'ZOTERO_PROTOCOL_SOURCE_REQUIRED',4000)};
}
