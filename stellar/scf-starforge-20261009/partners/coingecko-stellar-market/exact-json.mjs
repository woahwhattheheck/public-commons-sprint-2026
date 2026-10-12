// MIT. Retain original JSON number lexemes; arithmetic uses decimal integers.
import {need, fail, utf8} from './common.mjs';
const pointer=(base,key)=>base+'/'+String(key).replace(/~/g,'~0').replace(/\//g,'~1');
export {pointer};
export function parseExactJSON(bytes,{maximumNodes=300000}={}) {
  const source=typeof bytes==='string'?bytes:utf8(bytes);
  let at=0,nodes=0;const numbers=Object.create(null),spans=Object.create(null),duplicates=[];
  const ws=()=>{while(at<source.length&&/[\x20\t\r\n]/.test(source[at]))at++};
  function string() {
    const start=at++;let escaped=false;
    while(at<source.length) {
      const ch=source[at++];
      if(!escaped&&ch==='"') {
        try{return JSON.parse(source.slice(start,at))}catch{fail('INVALID_JSON','Invalid JSON string')}
      }
      if(!escaped&&ch==='\\')escaped=true;else escaped=false;
    }
    fail('INVALID_JSON','Unterminated JSON string');
  }
  function value(path,depth) {
    ws();need(++nodes<=maximumNodes&&depth<=80,'JSON_TOO_COMPLEX','Response JSON exceeds the indexing limit');
    const start=at,ch=source[at];let result,type;
    if(ch==='"'){result=string();type='string'}
    else if(ch==='{'||ch==='[') {
      const object=ch==='{',end=object?'}':']';at++;ws();result=object?Object.create(null):[];type=object?'object':'array';
      if(source[at]!==end)for(let index=0;;index++) {
        let key=index;
        if(object){need(source[at]==='"','INVALID_JSON','Object key must be a string');key=string();ws();need(source[at++]===':','INVALID_JSON','Object colon missing')}
        if(object&&Object.hasOwn(result,key))duplicates.push(pointer(path,key));
        result[key]=value(pointer(path,key),depth+1);ws();
        if(source[at]===end)break;
        need(source[at++ ]===',','INVALID_JSON','JSON separator missing');ws();
      }
      need(source[at++]===end,'INVALID_JSON','JSON container is incomplete');
    } else if(source.startsWith('true',at)){at+=4;result=true;type='boolean'}
    else if(source.startsWith('false',at)){at+=5;result=false;type='boolean'}
    else if(source.startsWith('null',at)){at+=4;result=null;type='null'}
    else {
      const matched=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(at));
      need(matched,'INVALID_JSON','JSON value is invalid');result=matched[0];at+=result.length;type='number';numbers[path]=result;
    }
    spans[path]={start,end:at,type};return result;
  }
  const decoded=value('',0);ws();need(at===source.length,'INVALID_JSON','Unexpected trailing source bytes');
  return {value:decoded,numbers,spans,duplicates,source};
}
export function originalJSONFragment(parsed,path) {
  const span=parsed.spans[path];need(span,'SOURCE_FIELD_ABSENT','The original JSON field is absent');
  return Buffer.from(parsed.source.slice(span.start,span.end));
}
export function decimal(value) {
  if(typeof value!=='string')return null;
  const m=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value);
  if(!m||value.length>4096)return null;
  const exponent=Number(m[4]??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>4096)return null;
  let coefficient=BigInt((m[1]||'')+m[2]+(m[3]??'')),scale=(m[3]?.length??0)-exponent;
  if(scale<0){coefficient*=10n**BigInt(-scale);scale=0}
  return {coefficient,scale};
}
function format(coefficient,scale) {
  if(coefficient===0n)return '0';
  const negative=coefficient<0n;if(negative)coefficient=-coefficient;
  let digits=coefficient.toString();
  if(scale){digits=digits.padStart(scale+1,'0');digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);digits=digits.replace(/0+$/,'').replace(/\.$/,'')}
  return (negative?'-':'')+digits;
}
export function decimalDifference(before,after) {
  const a=decimal(before),b=decimal(after);if(!a||!b)return null;
  const scale=Math.max(a.scale,b.scale);
  return format(b.coefficient*10n**BigInt(scale-b.scale)-a.coefficient*10n**BigInt(scale-a.scale),scale);
}
export function decimalCompare(a,b) {
  const difference=decimalDifference(a,b);return difference===null?null:difference==='0'?0:difference.startsWith('-')?-1:1;
}
