// MIT. Lossless views of retained JSON; numeric tokens remain exact strings.
import {createHash} from 'node:crypto';
export class InvoiceError extends Error {
  constructor(code,message,details={}){super(message);this.name='InvoiceError';this.code=code;this.details=details;}
}
export const need=(condition,code,message,details={})=>{if(!condition)throw new InvoiceError(code,message,details);};
export const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
export function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const sha256=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:canonical(value)).digest('hex');
export const text=(value,name,maximum=2048)=>{need(typeof value==='string'&&value.length>0&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value),'INVALID_ARGUMENT',name+' must be nonempty text.');return value;};
export const object=(value,name)=>{need(value!==null&&typeof value==='object'&&!Array.isArray(value),'INVALID_ARGUMENT',name+' must be an object.');return value;};
export const list=(value,name)=>{need(Array.isArray(value),'INVALID_ARGUMENT',name+' must be an array.');return value;};
export const pointerPart=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
export function atPointer(value,path){
  need(typeof path==='string'&&(path===''||path.startsWith('/')),'INVALID_RECORDS_PATH','Select an original JSON pointer.');
  if(path==='')return value;
  for(const segment of path.slice(1).split('/')){
    need(!/~(?:[^01]|$)/.test(segment),'INVALID_RECORDS_PATH','The original JSON pointer is malformed.');
    const key=segment.replace(/~1/g,'/').replace(/~0/g,'~');
    need(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'RECORDS_PATH_MISSING','The retained JSON pointer does not exist.',{path});
    value=value[key];
  }
  return value;
}
export function parseInvoiceJSON(body,{maximumBytes=64*1024*1024,maximumDepth=128,maximumNodes=2000000}={}){
  const raw=Buffer.isBuffer(body)?body:Buffer.from(body);
  need(raw.length<=maximumBytes,'SOURCE_TOO_LARGE','The original JSON exceeds the selected parser bound.');
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new InvoiceError('INVALID_SOURCE_JSON','The original source is not valid UTF-8.');}
  let offset=0,nodes=0;const numericLexemes=Object.create(null);
  const invalid=message=>{throw new InvoiceError('INVALID_SOURCE_JSON',message,{offset});};
  const space=()=>{while(offset<source.length&&/[ \t\n\r]/.test(source[offset]))offset++;};
  function string(){
    const start=offset++;let escaped=false;
    while(offset<source.length){
      const char=source[offset++];
      if(escaped){escaped=false;continue;}
      if(char==='\\'){escaped=true;continue;}
      if(char==='"'){try{return JSON.parse(source.slice(start,offset));}catch{invalid('A source string is malformed.');}}
      if(char.charCodeAt(0)<32)invalid('A source string contains an unescaped control character.');
    }
    invalid('The source string ended before its closing quote.');
  }
  function value(path,depth){
    if(++nodes>maximumNodes||depth>maximumDepth)invalid('The original JSON exceeds its structural bound.');
    space();const char=source[offset];
    if(char==='"')return string();
    if(char==='{'){
      offset++;space();const result=Object.create(null);
      if(source[offset]==='}'){offset++;return result;}
      for(;;){
        space();if(source[offset]!=='"')invalid('An object key must be a JSON string.');
        const key=string();need(!Object.hasOwn(result,key),'DUPLICATE_JSON_KEY','The source contains an ambiguous duplicate JSON key.',{path,key});
        space();if(source[offset++]!==':')invalid('An object key requires a colon.');
        result[key]=value(path+'/'+pointerPart(key),depth+1);space();
        const next=source[offset++];if(next==='}')return result;if(next!==',')invalid('The source object is incomplete.');
      }
    }
    if(char==='['){
      offset++;space();const result=[];
      if(source[offset]===']'){offset++;return result;}
      for(;;){result.push(value(path+'/'+result.length,depth+1));space();const next=source[offset++];if(next===']')return result;if(next!==',')invalid('The source array is incomplete.');}
    }
    for(const [token,result] of [['true',true],['false',false],['null',null]])if(source.startsWith(token,offset)){offset+=token.length;return result;}
    const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if(match){need(match[0].length<=2048,'INVALID_SOURCE_JSON','A native number exceeds the supported exact lexical size.');offset+=match[0].length;numericLexemes[path]=match[0];return match[0];}
    invalid('The source contains an invalid JSON value.');
  }
  const result=value('',0);space();if(offset!==source.length)invalid('The source contains trailing bytes after its JSON value.');
  return {value:result,numericLexemes,bodySha256:sha256(raw),bytes:raw.length};
}
export function decimalParts(value,name='amount'){
  need(typeof value==='string'&&value.length<=2048,'INVALID_AMOUNT',name+' must be exact decimal text.');
  const match=/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  need(match,'INVALID_AMOUNT',name+' must be exact decimal text.');
  const exponent=Number(match[4]||0);need(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=1000,'INVALID_AMOUNT','The decimal exponent is outside the supported exact range.');
  let coefficient=BigInt(match[2]+(match[3]||''));if(match[1]==='-')coefficient=-coefficient;
  const scale=(match[3]||'').length-exponent;
  return {coefficient,scale};
}
export function decimalUnits(value,decimals,name='amount'){
  need(Number.isSafeInteger(decimals)&&decimals>=0&&decimals<=255,'INVALID_ASSET','The selected asset precision is invalid.');
  const {coefficient,scale}=decimalParts(value,name),shift=decimals-scale;
  if(shift>=0)return coefficient*10n**BigInt(shift);
  const divisor=10n**BigInt(-shift);need(coefficient%divisor===0n,'AMOUNT_PRECISION_MISMATCH','The original amount exceeds the selected asset precision.',{name,decimals,amount:value});
  return coefficient/divisor;
}
export function formatUnits(units,decimals){
  let amount=BigInt(units),sign='';if(amount<0n){sign='-';amount=-amount;}
  if(decimals===0)return sign+amount;
  const body=amount.toString().padStart(decimals+1,'0');return sign+body.slice(0,-decimals)+'.'+body.slice(-decimals);
}
export function integerText(value,name,{hex=false,maximum=null}={}){
  const selected=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
  need(typeof selected==='string'&&(hex?/^(?:0x[0-9a-fA-F]+|0|[1-9]\d*)$/:/^(?:0|[1-9]\d*)$/).test(selected),'INVALID_INTEGER',name+' requires exact nonnegative integer text.');
  const result=BigInt(selected);need(maximum===null||result<=BigInt(maximum),'INVALID_INTEGER',name+' exceeds its native range.');return result.toString();
}
export function canonicalHash(value){
  if(typeof value!=='string')return null;
  return /^(?:0x)?[0-9a-fA-F]{64}$/.test(value)?'0x'+value.replace(/^0x/,'').toLowerCase():null;
}
export function iso(value,name,{nullable=false}={}){
  if(nullable&&(value===undefined||value===null||value===''))return null;
  need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)),'INVALID_TIMESTAMP',name+' must include an explicit timezone.');
  return new Date(value).toISOString();
}
