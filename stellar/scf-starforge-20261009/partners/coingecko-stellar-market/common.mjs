// MIT. Shared product values; native payment authority stays with Starforge.
import {createHash, randomUUID} from 'node:crypto';
export const SCHEMA = 'stellar-forge.coingecko-market.v1';
export const LIMITS = Object.freeze({uploadBytes:15000000, restoreBytes:67108864,
  restoreExpandedBytes:268435456, pageSize:100, responseBytes:15000000});
export class MarketError extends Error {
  constructor(code, message=code, status=400, details={}) {
    super(message); this.name='MarketError';this.code=code;this.status=status;Object.assign(this,details);
  }
}
export const fail=(code,message,status,details)=>{throw new MarketError(code,message,status,details)};
export const need=(ok,code,message,status,details)=>{if(!ok)fail(code,message,status,details)};
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const uuid=()=>randomUUID();
export const now=()=>new Date().toISOString();
export const jsonBytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
export const clone=x=>structuredClone(x);
export function text(value,name,max=2000,{empty=false}={}) {
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length),'INVALID_FIELD',name+' is required and must fit '+max+' characters');
  need(!value.includes('\0'),'INVALID_FIELD',name+' contains an invalid character');return value;
}
export function integer(value,name,min=0,max=Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,'INVALID_INTEGER',name+' must be an integer from '+min+' to '+max);return value;
}
export function id(value,name='id') {
  need(typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value),'INVALID_ID',name+' is invalid');return value;
}
export function enumValue(value,values,name) {
  need(values.includes(value),'INVALID_FIELD',name+' must be one of '+values.join(', '));return value;
}
export function base64(value,maximum=LIMITS.uploadBytes) {
  need(typeof value==='string'&&value.length<=Math.ceil(maximum/3)*4+4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
    'INVALID_FILE','File content must be canonical base64 within the declared limit');
  const b=Buffer.from(value,'base64');need(b.length<=maximum&&b.toString('base64')===value,'INVALID_FILE');return b;
}
export function page(query={}) {
  const offset=Number(query.offset??0),limit=Number(query.limit??25);
  return {offset:integer(offset,'offset',0),limit:integer(limit,'limit',1,LIMITS.pageSize),
    q:typeof query.q==='string'?query.q.trim().toLocaleLowerCase():''};
}
export function origin(value,{empty=false,allowLocal=false}={}) {
  if(empty&&value==='')return '';
  let u;try{u=new URL(value)}catch{fail('INVALID_ORIGIN','Enter a complete HTTPS origin')}
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  need(u.origin===value&&!u.username&&!u.password&&!u.hash&&!u.search&&
    (u.protocol==='https:'||(allowLocal&&local&&u.protocol==='http:')),
    'INVALID_ORIGIN','Enter only the HTTPS origin, without a path or credentials');
  return u.origin;
}
export function prefix(value='/api/v3/stellar') {
  need(typeof value==='string'&&/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(value)&&value.length<=256,
    'INVALID_PREFIX','Use a path prefix such as /api/v3/stellar');return value;
}
export function utf8(bytes) {
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('INVALID_UTF8','Source bytes are not UTF-8')}
}
export function safeName(value) {
  return text(value,'filename',240).replace(/[\/\\\r\n]/g,'_');
}
export function errorView(error) {
  return {code:error?.code??'OPERATION_FAILED',message:String(error?.message??error).slice(0,3000)};
}
