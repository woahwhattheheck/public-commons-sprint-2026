// MIT. Lossless views of retained JSON; numeric tokens remain exact strings.
import {createHash} from 'node:crypto';
export class FuulError extends Error {
  constructor(code,message,details={}){super(message);this.name='FuulError';this.code=code;this.details=details;}
}
export const need=(condition,code,message,details={})=>{if(!condition)throw new FuulError(code,message,details);};
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
/** Parse original UTF-8 activity CSV without converting any cell to a number. */
export function parseFuulCSV(body,{maximumBytes=64*1024*1024,maximumRows=2000000,maximumColumns=16384}={}){
 const raw=Buffer.isBuffer(body)?body:Buffer.from(body);
 need(raw.length<=maximumBytes,'SOURCE_TOO_LARGE','The original CSV exceeds the selected parser bound.');
 let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new FuulError('INVALID_SOURCE_CSV','The original CSV is not valid UTF-8.');}
 if(source.startsWith('\uFEFF'))source=source.slice(1);
 need(!source.includes('\0'),'INVALID_SOURCE_CSV','The original CSV contains a NUL byte.');
 const value=[];let headers=null,row=[],cell='',state='start',pending=false;
 function field(){row.push(cell);cell='';state='start';need(row.length<=maximumColumns,'SOURCE_TOO_LARGE','The original CSV has too many columns.');}
 function record(){
  field();
  if(headers===null){headers=row;need(headers.length>0&&headers.every(item=>item.trim().length>0),'INVALID_SOURCE_CSV','CSV headers must be nonempty.');need(new Set(headers).size===headers.length,'INVALID_SOURCE_CSV','CSV headers must be unique.');}
  else{need(row.length===headers.length,'INVALID_SOURCE_CSV','Every original CSV row must match its header width.',{row:value.length+2,expected:headers.length,actual:row.length});const item={};for(let i=0;i<headers.length;i++)Object.defineProperty(item,headers[i],{value:row[i],enumerable:true,writable:true,configurable:true});value.push(item);need(value.length<=maximumRows,'SOURCE_TOO_LARGE','The original CSV exceeds the selected row bound.');}
  row=[];pending=false;
 }
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(state==='quoted'){pending=true;if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else state='closed';}else cell+=ch;continue;}
  if(ch===','){field();pending=true;continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&source[i+1]==='\n')i++;record();continue;}
  need(state!=='closed','INVALID_SOURCE_CSV','A quoted CSV field must be followed by a delimiter or line ending.',{offset:i});
  if(ch==='"'){need(state==='start','INVALID_SOURCE_CSV','A quote may only begin an original CSV field.',{offset:i});state='quoted';pending=true;}
  else{state='unquoted';cell+=ch;pending=true;}
 }
 need(state!=='quoted','INVALID_SOURCE_CSV','The original CSV ends inside a quoted field.');
 if(pending||row.length||cell.length||state==='closed')record();
 need(headers!==null,'INVALID_SOURCE_CSV','The original CSV must contain a header record.');
 return {value,numericLexemes:{},bodySha256:sha256(raw)};
}
export function parseFuulJSON(body,{maximumBytes=64*1024*1024,maximumDepth=128,maximumNodes=2000000}={}){
  const raw=Buffer.isBuffer(body)?body:Buffer.from(body);
  need(raw.length<=maximumBytes,'SOURCE_TOO_LARGE','The original JSON exceeds the selected parser bound.');
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new FuulError('INVALID_SOURCE_JSON','The original source is not valid UTF-8.');}
  let offset=0,nodes=0;const numericLexemes=Object.create(null);
  const invalid=message=>{throw new FuulError('INVALID_SOURCE_JSON',message,{offset});};
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

export function fuulNetwork(value){
  const main='Public Global Stellar Network ; September 2015',test='Test SDF Network ; September 2015';
  if(value==='stellar:pubnet'||value==='pubnet'||value==='mainnet'||value===main)return {network:'stellar:pubnet',chainIdentifier:148,passphrase:main};
  if(value==='stellar:testnet'||value==='testnet'||value===test)return {network:'stellar:testnet',chainIdentifier:1481,passphrase:test};
  throw new FuulError('INVALID_NETWORK','Select the original Stellar public or test network.');
}
export function stellarAddress(value,name='Stellar address',{kind='any'}={}){
  text(value,name,56);need(/^[GC][A-Z2-7]{55}$/.test(value),'INVALID_STELLAR_ADDRESS',name+' must be an original account or contract StrKey.');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',out=[];let bits=0,acc=0;
  for(const char of value){acc=(acc<<5)|alphabet.indexOf(char);bits+=5;while(bits>=8){bits-=8;out.push((acc>>>bits)&255);}}
  need(out.length===35&&bits===0,'INVALID_STELLAR_ADDRESS',name+' has an invalid encoded length.');
  const version=out[0];need((kind!=='account'||version===48)&&(kind!=='contract'||version===16)&&(version===48||version===16),'INVALID_STELLAR_ADDRESS',name+' has the wrong StrKey type.');
  let crc=0;for(const byte of out.slice(0,33)){crc^=byte<<8;for(let i=0;i<8;i++)crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;}
  need(out[33]===(crc&255)&&out[34]===(crc>>>8),'INVALID_STELLAR_ADDRESS',name+' has an invalid StrKey checksum.');
  return value;
}
export function safeInteger(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  const number=typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value)?Number(value):value;
  need(Number.isSafeInteger(number)&&number>=minimum&&number<=maximum,'INVALID_INTEGER',name+' is outside its native range.');return number;
}
export function jsonNative(value,seen=new Set()){
  if(typeof value==='bigint')return value.toString();
  if(value===undefined)return null;
  if(value===null||typeof value!=='object')return value;
  need(!seen.has(value),'CYCLIC_NATIVE_VALUE','The native view contains a cyclic value.');seen.add(value);
  try{
    if(value instanceof Uint8Array)return {encoding:'base64',bytes:Buffer.from(value).toString('base64')};
    if(value instanceof Map)return {entries:[...value].map(([key,item])=>[jsonNative(key,seen),jsonNative(item,seen)])};
    if(Array.isArray(value))return value.map(item=>jsonNative(item,seen));
    if(value instanceof Date)return value.toISOString();
    if(typeof value.toXdr==='function')return {encoding:'xdr-base64',xdr:value.toXdr('base64')};
    if(typeof value.toXDR==='function')return {encoding:'xdr-base64',xdr:value.toXDR('base64')};
    if(typeof value.contractId==='function')return value.contractId();
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,jsonNative(item,seen)]));
  }finally{seen.delete(value);}
}
