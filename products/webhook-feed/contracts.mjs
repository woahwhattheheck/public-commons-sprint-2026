// MIT. Adapt the original signed-webhook store and snapshot formats.
import {createHash} from 'node:crypto';
export const PREFIX='merchant_webhook_feed_';
export const CONNECTION_SCHEMA='stellar-forge.webhook-feed-operator-connection.v1';
export const SESSION_SCHEMA='stellar-forge.webhook-feed-operator-session.v1';
export const MANIFEST_SCHEMA='stellar-forge.webhook-feed-download.v1';
export const MANIFEST_NAME='download.json';
export const MAX_FILE_BYTES=8*1024*1024*1024;
export const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const SHA=/^[a-f0-9]{64}$/;
export const STORE=/^[a-f0-9]{32}$/;
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const decode=value=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
export function need(value,code,message=code){if(!value)throw Object.assign(new Error(message),{code});}
export function exact(value,keys,required=[]){need(plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),'WEBHOOK_OPERATIONS_INVALID_INPUT','Use the declared fields for this operation.');return value;}
export function id(value,label='name'){need(typeof value==='string'&&ID.test(value),'WEBHOOK_OPERATIONS_INVALID_INPUT','Use a valid '+label+'.');return value;}
export function hash(value){need(typeof value==='string'&&SHA.test(value),'WEBHOOK_OPERATIONS_HASH_REQUIRED');return value;}
export function parseSnapshotManifest(bytes,exportId){
 const value=decode(bytes);id(exportId,'snapshot name');
 need(value.schema===MANIFEST_SCHEMA&&value.exportId===exportId&&STORE.test(value.storeId??'')&&SHA.test(value.originalManifestSha256??'')&&Array.isArray(value.files)&&value.files.length===2,'WEBHOOK_OPERATIONS_MANIFEST_INVALID');
 need(value.files[0].name==='snapshot.json'&&value.files[1].name==='events.sqlite','WEBHOOK_OPERATIONS_MANIFEST_INVALID');
 for(const file of value.files)need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE_BYTES&&SHA.test(file.sha256??''),'WEBHOOK_OPERATIONS_MANIFEST_INVALID');
 need(value.files[0].sha256===value.originalManifestSha256&&value.bytes===value.files.reduce((sum,item)=>sum+item.bytes,0),'WEBHOOK_OPERATIONS_MANIFEST_INVALID');
 return value;
}
