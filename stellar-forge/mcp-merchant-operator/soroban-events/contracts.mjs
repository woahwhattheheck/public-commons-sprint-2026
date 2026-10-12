// MIT. Soroban event merchant identities and original source manifests.
import {createHash} from 'node:crypto';
export const TOOL_PREFIX='merchant_soroban_events_';
export const CONNECTION_SCHEMA='stellar-forge.soroban-events-connection.v1';
export const MANIFEST_SCHEMA='stellar-forge.soroban-events.source-export.v1';
export const MANIFEST_NAME='manifest.json';
export const MAX_FILE_BYTES=8*1024*1024*1024;
export const MAX_MANIFEST_BYTES=64*1024*1024;
export const MAX_JSON_BYTES=128*1024*1024;
export const MAX_REQUEST_BYTES=2*1024*1024;
export const ALIAS='^[a-z0-9][a-z0-9_-]{0,63}$';
export const SHA='^[a-f0-9]{64}$';
export const UUID='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export function need(value,code='SOROBAN_EVENTS_INVALID_PARAMS',message='Use the declared Soroban event selection.'){
  if(!value)throw Object.assign(new Error(message),{code});
}
export function checked(value,pattern,label){
  need(typeof value==='string'&&new RegExp(pattern).test(value),'SOROBAN_EVENTS_INVALID_PARAMS','Invalid '+label+'.');
  return value;
}
export function text(value,label='Text',maximum=240){
  need(typeof value==='string'&&value.trim().length>0&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),
    'SOROBAN_EVENTS_INVALID_PARAMS','Use nonempty single-line '+label+'.');
  return value;
}
export function exact(value,allowed,required=[]){
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)));
  return value;
}
export function relativeFile(value){
  need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/^[\/]/.test(value)&&
    !/[\\:\u0000-\u001f\u007f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')&&
    value.split('/').length<=32&&value!=='download-state'&&!value.startsWith('download-state/'),
    'SOROBAN_EVENTS_FILE_INVALID','Choose an exact canonical path from the original source manifest.');
  return value;
}
/** Adapt file names for the existing receiver; the saved manifest bytes stay original. */
export function parseSorobanEventsManifest(bytes,exportId){
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_MANIFEST_BYTES,'SOROBAN_EVENTS_MANIFEST_INVALID');
  let manifest;try{manifest=decode(bytes);}catch{need(false,'SOROBAN_EVENTS_MANIFEST_INVALID');}
  need(plain(manifest)&&manifest.schema===MANIFEST_SCHEMA&&manifest.exportId===checked(exportId,SHA,'export ID')&&
    typeof manifest.editionId==='string'&&new RegExp(UUID).test(manifest.editionId)&&Array.isArray(manifest.files),
    'SOROBAN_EVENTS_MANIFEST_INVALID');
  const seen=new Set();let total=0;
  const files=manifest.files.map(file=>{
    need(plain(file),'SOROBAN_EVENTS_MANIFEST_INVALID');
    const name=relativeFile(file.path);
    need(name!==MANIFEST_NAME&&!seen.has(name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&
      file.bytes<=MAX_FILE_BYTES&&typeof file.sha256==='string'&&new RegExp(SHA).test(file.sha256)&&
      typeof file.contentType==='string'&&file.contentType.length>0,
      'SOROBAN_EVENTS_MANIFEST_INVALID');
    seen.add(name);total+=file.bytes;
    need(Number.isSafeInteger(total),'SOROBAN_EVENTS_MANIFEST_INVALID');
    return {...file,name};
  });
  need(files.length>0&&manifest.fileCount===files.length&&manifest.bytes===total,'SOROBAN_EVENTS_MANIFEST_INVALID');
  return {...manifest,files};
}
