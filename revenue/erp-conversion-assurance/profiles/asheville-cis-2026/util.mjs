// MIT. Exact decimals, complete CSV intake and private atomic file operations.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {WorkspaceError} from '../../scap-workspace/mapping.mjs';
export const need=(value,message,code='UTILITY_INPUT_INVALID',status=400)=>{if(!value)throw new WorkspaceError(code,message,status);};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export const iso=()=>new Date().toISOString();
export const text=(value,label,max=500,optional=false)=>{need(typeof value==='string'&&value.length<=max&&(optional||value.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),`${label} must be text of at most ${max} characters.`);return value;};
export function decimal(value,scale=6,label='Decimal') {
  need(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&value.length<80,`${label} must be an exact decimal string.`);
  const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');
  need(fraction.length<=scale,`${label} permits at most ${scale} decimal places.`);
  return (negative?-1n:1n)*(BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0')));
}
export function format(value,scale=2){const n=BigInt(value),sign=n<0n?'-':'',digits=(n<0n?-n:n).toString().padStart(scale+1,'0');return scale?sign+digits.slice(0,-scale)+'.'+digits.slice(-scale):sign+digits;}
export function rounded(n,d,mode='half_up'){need(d>0n,'A positive denominator is required.');need(['half_up','half_even'].includes(mode),'Select the reviewed rounding convention.');const sign=n<0n?-1n:1n,a=n<0n?-n:n,q=a/d,r=a%d;return sign*(q+(r*2n>d||(r*2n===d&&(mode==='half_up'||q%2n===1n))?1n:0n));}
export function date(value,label='Date'){need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,`${label} must be a real YYYY-MM-DD date.`);return value;}
export const day=value=>Date.parse(date(value)+'T00:00:00Z')/86400000;
const dayFormatters=new Map(),clockFormatters=new Map(),midnights=new Map();
const dayFormatter=timeZone=>{if(!dayFormatters.has(timeZone))dayFormatters.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}));return dayFormatters.get(timeZone);};
const clockFormatter=timeZone=>{if(!clockFormatters.has(timeZone))clockFormatters.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));return clockFormatters.get(timeZone);};
export function localDay(value,timeZone){need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),'Read timestamps need an explicit UTC offset.');const parts=dayFormatter(timeZone).formatToParts(new Date(value));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
export function zone(value){try{dayFormatter(value).format();}catch{need(false,'Select a valid IANA time zone.');}return value;}
export function midnight(value,timeZone){const key=timeZone+'|'+value;if(midnights.has(key))return midnights.get(key);const target=Date.parse(date(value)+'T00:00:00Z');let t=target;for(let i=0;i<4;i++){const p=Object.fromEntries(clockFormatter(timeZone).formatToParts(new Date(t)).map(v=>[v.type,v.value]));const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);t+=target-local;}if(midnights.size>4096)midnights.clear();midnights.set(key,t);return t;}
export function parseCsvRecords(bytes) {
  let source;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{need(false,'CSV input must be valid UTF-8.');}
  const bom=source.startsWith('\ufeff'),records=[],spans=[];let row=[],rowSpans=[],field='',quoted=false,closed=false,start=bom?1:0,newline=null;
  const finishField=end=>{row.push(field);rowSpans.push({start,end});field='';closed=false;};
  const finishRow=()=>{records.push(row);spans.push(rowSpans);row=[];rowSpans=[];};
  for(let i=start;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c===','){finishField(i);start=i+1;}
    else if(c==='\r'||c==='\n'){finishField(i);const separator=c==='\r'&&source[i+1]==='\n'?'\r\n':c;newline??=separator;if(separator==='\r\n')i++;finishRow();start=i+1;}
    else if(c==='"'){need(!field&&!closed,'A CSV quote must begin its field.');quoted=true;}
    else{need(!closed,'Unexpected text after a closing CSV quote.');field+=c;}
    need(field.length<=1024*1024&&row.length<1000&&records.length<=200000,'The CSV exceeds the field, column or 200,000-row intake limit.');
  }
  need(!quoted,'The CSV ends inside a quoted field.');if(field||row.length||closed){finishField(source.length);finishRow();}
  return {source,records,spans,bom,newline:newline??'\r\n'};
}
export function parseCsv(bytes) {
  const parsed=parseCsvRecords(bytes),rows=parsed.records;need(rows.length>0,'The CSV needs a header.');const headers=rows.shift().map(v=>v.trim());need(headers.length&&headers.every(v=>v&&v.length<=160)&&new Set(headers).size===headers.length,'CSV headers must be nonempty and unique.');
  return {headers,rows:rows.filter(r=>!(r.length===1&&r[0]==='')).map((r,i)=>{need(r.length===headers.length,`CSV record ${i+2} has ${r.length} fields; expected ${headers.length}.`);return Object.fromEntries(headers.map((h,n)=>[h,r[n]]));})};
}
export function parseTable(bytes,kind='csv'){
  if(kind==='csv')return parseCsv(bytes);need(kind==='json','Choose CSV or JSON table input.');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{need(false,'The source is not valid UTF-8 JSON.');}
  const rows=Array.isArray(value)?value:value?.rows??value?.features;need(Array.isArray(rows)&&rows.length<=200000,'JSON needs an array, rows array, or GeoJSON features array within 200,000 records.');
  const headers=new Set(),mapped=rows.map((r,i)=>{need(r&&typeof r==='object'&&!Array.isArray(r),`JSON record ${i+1} must be an object.`);const input=r.attributes??r.properties??r,output={};for(const[k,v]of Object.entries(input)){need(typeof v!=='number'||Number.isSafeInteger(v)||!Number.isInteger(v),`JSON record ${i+1} contains an unsafe integer. Export identifiers as strings.`);output[k]=typeof v==='string'?v:v==null?'':typeof v==='object'?json(v):String(v);headers.add(k);}if(r.geometry){output.geometry=json(r.geometry);headers.add('geometry');}return output;});
  return {headers:[...headers],rows:mapped};
}
export function csv(rows,columns){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';return Buffer.from([columns.map(quote).join(','),...rows.map(r=>columns.map(k=>quote(r[k])).join(','))].join('\r\n')+'\r\n');}
export async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'The workspace must be a private directory owned by this operating-system account.','UTILITY_DIRECTORY_INVALID');}
export async function atomic(path,bytes){const temporary=join(dirname(path),'.utility-'+randomUUID());let handle;try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}}finally{await handle?.close().catch(()=>{});await rm(temporary,{force:true});}}
