// MIT. Exact operator values and complete source identity.
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
export const uuid=randomUUID;
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const clone=value=>JSON.parse(JSON.stringify(value));
export function need(ok,code,details={}){if(!ok)throw Object.assign(new Error(code),{code,details});}
export function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function keys(v,allowed,required=allowed){need(object(v),'OBJECT_REQUIRED');need(Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),'EXACT_FIELDS_REQUIRED',{allowed,required});}
export function canonical(v){if(v===null||typeof v==='boolean')return JSON.stringify(v);if(typeof v==='string'){need(v.isWellFormed(),'INVALID_UNICODE');return JSON.stringify(v);}if(typeof v==='number'){need(Number.isSafeInteger(v),'EXACT_INTEGER_TEXT_REQUIRED');return String(v);}if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';need(object(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),'JSON_VALUE_REQUIRED');return '{'+Object.keys(v).sort().map(k=>canonical(k)+':'+canonical(v[k])).join(',')+'}';}
export const identity=value=>hash(canonical(value));
export function text(v,max=4096){need(typeof v==='string'&&v.length>0&&v.length<=max&&v.isWellFormed()&&!v.includes('\0'),'TEXT_REQUIRED');return v;}
export function integer(v,kind){need(typeof v==='string'&&/^-?(0|[1-9][0-9]*)$/.test(v)&&v!=='-0','EXACT_INTEGER_TEXT_REQUIRED');const n=BigInt(v);need(kind==='u32'?n>=0n&&n<2n**32n:kind==='u64'?n>=0n&&n<2n**64n:n>=-(2n**127n)&&n<2n**127n,'INTEGER_RANGE',{kind});return v;}
export function address(v){need(typeof v==='string'&&/^[GC][A-Z2-7]{55}$/.test(v),'STELLAR_ADDRESS_REQUIRED');return v;}
export function sha(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'SHA256_REQUIRED');return v;}
export function decode64(v){need(typeof v==='string','COMPLETE_BASE64_REQUIRED');const b=Buffer.from(v,'base64');need(b.toString('base64')===v,'COMPLETE_BASE64_REQUIRED');return b;}
export function secretEqual(a,b){a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&timingSafeEqual(a,b);}
export function jsonInput(raw){const v=JSON.parse(raw);canonical(v);return v;}
