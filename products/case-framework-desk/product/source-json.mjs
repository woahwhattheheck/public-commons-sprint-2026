// MIT. Reuses the maintained Flowable lossless JSON reader; see SOURCE_MAP.json.
const own=(value,key)=>Object.hasOwn(value,key);
function losslessJson(source){
 let i=0;
 const space=()=>{while(/\s/u.test(source[i]??'')&&i<source.length)i++;};
 function parse(){
  space();const ch=source[i];
  if(ch==='"'){const start=i++;let escaped=false;for(;i<source.length;i++){const c=source[i];if(!escaped&&c==='"'){i++;return JSON.parse(source.slice(start,i));}if(!escaped&&c==='\\')escaped=true;else escaped=false;}throw new Error('Unterminated string');}
  if(ch==='['){i++;const result=[];space();if(source[i]===']'){i++;return result;}for(;;){result.push(parse());space();if(source[i]===']'){i++;return result;}if(source[i++]!==',')throw new Error('Array separator');}}
  if(ch==='{'){i++;const result=Object.create(null);space();if(source[i]==='}'){i++;return result;}for(;;){const key=parse();if(typeof key!=='string'||own(result,key))throw new Error('Object key');space();if(source[i++]!==':')throw new Error('Object separator');result[key]=parse();space();if(source[i]==='}'){i++;return result;}if(source[i++]!==',')throw new Error('Object separator');}}
  for(const [literal,value]of [['true',true],['false',false],['null',null]])if(source.startsWith(literal,i)){i+=literal.length;return value;}
  const number=source.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
  if(number){i+=number.length;const [mantissa,exponent='0']=number.toLowerCase().split('e'),negative=mantissa[0]==='-',unsigned=negative?mantissa.slice(1):mantissa,parts=unsigned.split('.');let coefficient=(parts[0]+(parts[1]??'')).replace(/^0+/u,''),power=BigInt(exponent)-BigInt(parts[1]?.length??0);if(!coefficient)return{number:'0',exponent:'0'};const zeros=coefficient.match(/0+$/u)?.[0].length??0;if(zeros){coefficient=coefficient.slice(0,-zeros);power+=BigInt(zeros);}return{number:(negative?'-':'')+coefficient,exponent:String(power)};}
  throw new Error('JSON token');
 }
 const result=parse();space();if(i!==source.length)throw new Error('Trailing JSON');return result;
}
export function readExactJSON(source){
 if(typeof source!=='string'||new TextEncoder().encode(source).length>1024*1024)throw Error('Each original CASE package is limited to 1 MiB.');
 const value=JSON.parse(source);
 return {value,exact:losslessJson(source)};
}

export function readCASEEnvelope(source,maxBytes=16*1024*1024){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)throw Error('Select an envelope bound from 1 byte through 32 MiB.');
 if(typeof source!=='string'||new TextEncoder().encode(source).length>maxBytes)throw Error('Complete CASE envelope exceeds its selected byte bound.');
 const value=JSON.parse(source);
 return {value,exact:losslessJson(source)};
}
