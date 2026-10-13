// MIT. Pure report editorial identities and complete canonical JSON records.
import {createHash} from 'node:crypto';
export const REPORT_REVIEW_ID=/^[a-f0-9]{32}$/;
export const REPORT_REVIEW_SHA=/^[a-f0-9]{64}$/;
export const REPORT_REVIEW_ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const REPORT_REVIEW_MAX_RETURN=16*1024*1024;
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
export function need(ok,message,code='REPORT_REVIEW_ARGUMENT_INVALID'){if(!ok)throw Object.assign(new TypeError(message),{code});}
export function canonical(x){
 if(x===null||typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
 if(typeof x==='number'){need(Number.isFinite(x),'Retain finite original JSON numbers.');return JSON.stringify(x);}
 if(Array.isArray(x))return'['+Array.from(x,v=>canonical(v)).join(',')+']';
 need(plain(x),'Retain a complete JSON value.');
 return'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
export const encode=x=>Buffer.from(canonical(x)+'\n');
export const digest=x=>createHash('sha256').update(x).digest('hex');
export function identity(x){need(typeof x==='string'&&REPORT_REVIEW_ID.test(x),'Use the original 32-character identity.');return x;}
