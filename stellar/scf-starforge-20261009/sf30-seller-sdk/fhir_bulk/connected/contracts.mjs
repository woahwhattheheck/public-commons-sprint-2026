// MIT. Native FHIR operator formats and complete retained file identities.
import {createHash} from 'node:crypto';
export const CONNECTION_SCHEMA='stellar-forge.fhir-bulk-merchant-connection.v1';
export const OPERATOR_SCHEMA='stellar-forge.fhir-bulk-operator-connection.v1';
export const WORKSPACE_SCHEMA='stellar-forge.fhir-bulk-workspace.v1';
export const EXPORT_SCHEMA='stellar-forge.fhir-bulk-merchant-export.v1';
export const RESULT_SCHEMA='stellar-forge.fhir-bulk-merchant-result.v1';
export const TOOL_PREFIX='merchant_fhir_bulk_';
export const MANIFEST_NAME='fhir-bulk-manifest.json';
export const MAX_PACKET_BYTES=512*1024*1024;
export const MAX_RESPONSE_BYTES=64*1024*1024;
export const MAX_JSON_INPUT=131072;
export {MAX_RETAINED_CHUNK_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const UUID='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const SHA='^[0-9a-f]{64}$';
export const ALIAS='^[a-z0-9][a-z0-9_-]{0,63}$';
export const OPERATION_ID='^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$';
export const SOURCE_FILE_ID='^[0-9a-f]{64}(?::[0-9a-f]{64})?$';
export const RESOURCE_TYPE='^[A-Z][A-Za-z0-9]{0,63}$';
export const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const failure=(code,message=code,details)=>Object.assign(new Error(message),{code,...(details?{details}:{})});
export function need(value,code,message,details){if(!value)throw failure(code,message,details);}
export function decode(bytes){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('FHIR_BULK_JSON_INVALID','The complete original response is not UTF-8 JSON.');}
}
export function exact(value,allowed,required=[]){
  need(plain(value) && Object.keys(value).every(k=>allowed.includes(k)) && required.every(k=>Object.hasOwn(value,k)),
    'FHIR_BULK_INPUT_INVALID','Use only the declared fields: '+allowed.join(', ')+'.');
}
export function text(value,label='Text',maximum=240){
  need(typeof value==='string' && value.trim() && value.length<=maximum && !/[\x00-\x1f\x7f]/.test(value),
    'FHIR_BULK_INPUT_INVALID',label+' must be nonempty text without control characters.');return value;
}
export function checked(value,pattern,label){
  need(typeof value==='string' && new RegExp(pattern).test(value),'FHIR_BULK_INPUT_INVALID','Select the exact '+label+'.');
  return value;
}
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!plain(value))return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export function manifestIdentity(value){
  const copy={...value};delete copy.exportId;return digest(Buffer.from(JSON.stringify(canonical(copy))));
}
export function parseFhirExport(bytes,expectedId){
  need(bytes.length<=65000,'FHIR_BULK_MANIFEST_INVALID');
  const value=decode(bytes);
  exact(value,['schema','exportId','workspace','workspaceId','instanceId','kind','source','files'],
    ['schema','exportId','workspace','workspaceId','instanceId','kind','source','files']);
  checked(value.exportId,SHA,'export ID');checked(value.workspace,ALIAS,'workspace alias');
  checked(value.workspaceId,UUID,'workspace ID');checked(value.instanceId,UUID,'operator instance');
  need(value.schema===EXPORT_SCHEMA && value.exportId===manifestIdentity(value) &&
    (expectedId===undefined || expectedId===value.exportId) && plain(value.source) &&
    ['native-response','source-file','source-packet','dataset','dataset-packet','comparison-file','workspace-packet'].includes(value.kind) &&
    Array.isArray(value.files) && value.files.length>=1 && value.files.length<=4,
    'FHIR_BULK_MANIFEST_INVALID','Select the complete original FHIR export manifest.');
  const names=new Set();let total=0;
  for(const file of value.files){
    exact(file,['name','bytes','sha256','contentType'],['name','bytes','sha256','contentType']);
    need(typeof file.name==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(file.name) &&
      file.name!==MANIFEST_NAME && !names.has(file.name) && Number.isSafeInteger(file.bytes) &&
      file.bytes>=0 && file.bytes<=MAX_PACKET_BYTES,'FHIR_BULK_MANIFEST_INVALID');
    names.add(file.name);checked(file.sha256,SHA,'file SHA256');text(file.contentType,'Content type',200);
    total+=file.bytes;
  }
  need(total<=MAX_PACKET_BYTES+MAX_RESPONSE_BYTES,'FHIR_BULK_MANIFEST_INVALID');
  return value;
}
export function jsonPointer(value,pointer=''){
  need(typeof pointer==='string' && pointer.length<=4000 && (!pointer || pointer.startsWith('/')),
    'FHIR_BULK_POINTER_INVALID','Use an RFC6901 pointer into the selected original JSON response.');
  for(const bit of pointer?pointer.slice(1).split('/'):[]){
    need(!/~(?![01])/.test(bit),'FHIR_BULK_POINTER_INVALID');
    const key=bit.replace(/~1/g,'/').replace(/~0/g,'~');
    need(value!==null && typeof value==='object' && Object.hasOwn(value,key) &&
      (!Array.isArray(value) || /^(0|[1-9][0-9]*)$/.test(key)),'FHIR_BULK_POINTER_NOT_FOUND');
    value=value[key];
  }
  return value;
}
