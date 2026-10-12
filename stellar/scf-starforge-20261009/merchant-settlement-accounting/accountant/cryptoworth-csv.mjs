// MIT. Exact customer-owned CSV layouts and decimal/date representations.
import {createHash} from 'node:crypto';

export const CRYPTOWORTH_FILE_BYTES=64*1024*1024;
export const CRYPTOWORTH_MAX_ROWS=50000;
export const CRYPTOWORTH_REQUIRED_ROLES=Object.freeze(['date','cryptoId','type','amountOne','amountOneType','amountTwo','amountTwoType']);
export const CRYPTOWORTH_OPTIONAL_ROLES=Object.freeze(['transactionHash','ledgerId','connectionId','rowId','note']);
export const CRYPTOWORTH_DATE_FORMATS=Object.freeze(['ISO_UTC','UTC_SECONDS','UTC_DATE','ZONE_SECONDS','ZONE_DATE']);
export const CRYPTOWORTH_LABELS=Object.freeze({date:'Date Time (UTC)',cryptoId:'Crypto Id',type:'Type',amountOne:'Amount One',amountOneType:'Amount One_Type',amountTwo:'Amount Two',amountTwoType:'Amount Two_Type'});
export class CryptoworthError extends Error{
  constructor(code,message,status=400,details){super(message);this.name='CryptoworthError';this.code=code;this.status=status;if(details!==undefined)this.details=details;}
}
export const cwCheck=(ok,code,message,status=400,details)=>{if(!ok)throw new CryptoworthError(code,message,status,details);};
export const cwObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const cwHash=v=>createHash('sha256').update(v).digest('hex');
export function cwCanonical(v){
  if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
  if(typeof v==='number'){cwCheck(Number.isFinite(v),'INVALID_CRYPTOWORTH_RECORD','Use finite JSON numbers.');return JSON.stringify(v);}
  if(Array.isArray(v))return '['+v.map(cwCanonical).join(',')+']';
  cwCheck(cwObject(v),'INVALID_CRYPTOWORTH_RECORD','Use complete JSON-compatible records.');
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+cwCanonical(v[k])).join(',')+'}';
}
export const cwJson=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export const cwSeal=v=>({...v,integrity:{sha256:cwHash(cwCanonical(v))}});
export function cwVerify(v,schema){
  cwCheck(cwObject(v)&&v.schema===schema&&/^[a-f0-9]{64}$/.test(v.integrity?.sha256??''),'INVALID_CRYPTOWORTH_RECORD','Choose a retained '+schema+' record.');
  const {integrity,...body}=v;cwCheck(cwHash(cwCanonical(body))===integrity.sha256,'CRYPTOWORTH_RECORD_CHANGED','The retained record contents changed.',409);return v;
}
export function cwText(v,label,max=1000,empty=false){
  cwCheck(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
    'INVALID_CRYPTOWORTH_FIELD','Check '+label+' (text, at most '+max+' characters).');return v;
}
export function cwId(v){cwCheck(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(v),'INVALID_CRYPTOWORTH_ID','Use a retained identifier.');return v;}
export function cwInstant(v,label='timestamp'){
  cwCheck(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v),'INVALID_CRYPTOWORTH_DATE','Use an exact UTC '+label+'.');
  const date=new Date(v);cwCheck(Number.isFinite(date.getTime()),'INVALID_CRYPTOWORTH_DATE','Check '+label+'.');
  const normalized=v.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+(fraction??'').padEnd(3,'0')+'Z');
  cwCheck(date.toISOString()===normalized,'INVALID_CRYPTOWORTH_DATE','Check the calendar fields in '+label+'.');return normalized;
}
export function cwDecode(file,{max=CRYPTOWORTH_FILE_BYTES}={}){
  cwCheck(cwObject(file),'CRYPTOWORTH_FILE_REQUIRED','Choose the original file.');
  const name=cwText(file.name,'file name',240);cwCheck(!/[\\/\r\n]/.test(name)&&name!=='.'&&name!=='..','INVALID_CRYPTOWORTH_FILENAME','Use the original file name without a directory.');
  const value=file.dataBase64;cwCheck(typeof value==='string'&&value.length<=Math.ceil(max*4/3)+4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'INVALID_CRYPTOWORTH_UPLOAD','Choose a complete original file within its size limit.');
  const bytes=Buffer.from(value,'base64');cwCheck(bytes.length>0&&bytes.length<=max&&bytes.toString('base64')===value,'INVALID_CRYPTOWORTH_UPLOAD','Choose a complete original file within its size limit.');return {name,bytes,sha256:cwHash(bytes)};
}
export function cwUtf8(bytes){
  try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);cwCheck(!text.includes('\0'),'INVALID_CRYPTOWORTH_CSV','A CSV file contains a NUL character.');return text;}
  catch(error){if(error instanceof CryptoworthError)throw error;throw new CryptoworthError('INVALID_CRYPTOWORTH_UTF8','Choose a UTF-8 CSV file.');}
}
function parseWith(text,delimiter){
  const bom=text.startsWith('\uFEFF');if(bom)text=text.slice(1);
  const rows=[];let row=[],value='',quoted=false,closed=false,started=false,line=1,startLine=1,newline=null;
  const field=()=>{row.push(value);value='';closed=false;started=false;cwCheck(row.length<=200,'CRYPTOWORTH_COLUMN_LIMIT','The CSV supports up to 200 columns.');};
  const record=()=>{field();rows.push({rowNumber:rows.length+1,lineNumber:startLine,values:row});row=[];cwCheck(rows.length<=CRYPTOWORTH_MAX_ROWS+1,'CRYPTOWORTH_ROW_LIMIT','The CSV supports up to '+CRYPTOWORTH_MAX_ROWS+' data rows.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=c;if(c==='\n'||(c==='\r'&&text[i+1]!=='\n'))line++;}}
    else if(c===delimiter)field();
    else if(c==='\r'||c==='\n'){const ending=c==='\r'&&text[i+1]==='\n'?'\r\n':c;if(ending==='\r\n')i++;newline??=ending;record();line++;startLine=line;}
    else if(closed)throw new CryptoworthError('INVALID_CRYPTOWORTH_CSV','Unexpected text after a closing quote on line '+line+'.');
    else if(c==='"'){cwCheck(!started&&value==='','INVALID_CRYPTOWORTH_CSV','A quote occurs inside an unquoted CSV field on line '+line+'.');quoted=true;started=true;}
    else{value+=c;started=true;}
    cwCheck(value.length<=32000,'CRYPTOWORTH_FIELD_LIMIT','A CSV field exceeds 32,000 characters.');
  }
  cwCheck(!quoted,'INVALID_CRYPTOWORTH_CSV','The CSV ends inside a quoted field.');
  if(closed||started||value.length||row.length)record();
  while(rows.length&&rows.at(-1).values.every(v=>v===''))rows.pop();
  cwCheck(rows.length>0,'CRYPTOWORTH_HEADER_REQUIRED','Choose a file with its original CSV header.');
  const headers=rows.shift().values;cwCheck(headers.length>=1&&headers.every(v=>v.trim().length>0),'CRYPTOWORTH_HEADER_REQUIRED','Every original CSV column needs a name.');
  cwCheck(new Set(headers).size===headers.length,'DUPLICATE_CRYPTOWORTH_HEADER','The CSV repeats a column name.');
  return {headers,records:rows,delimiter,newline:newline??'\r\n',bom};
}
export function readCryptoworthCsv(bytes,{delimiter}={}){
  const raw=Buffer.from(bytes);cwCheck(raw.length>0&&raw.length<=CRYPTOWORTH_FILE_BYTES,'CRYPTOWORTH_FILE_SIZE','Choose a CSV up to 64 MiB.');
  const text=cwUtf8(raw);let parsed;
  if(delimiter!==undefined){cwCheck([',',';','\t'].includes(delimiter),'INVALID_CRYPTOWORTH_DELIMITER','Choose comma, semicolon or tab.');parsed=parseWith(text,delimiter);}
  else{
    const candidates=[];for(const d of [',',';','\t'])try{candidates.push(parseWith(text,d));}catch{}
    cwCheck(candidates.length,'INVALID_CRYPTOWORTH_CSV','Choose a complete CSV file and its delimiter.');
    candidates.sort((a,b)=>b.headers.length-a.headers.length);
    cwCheck(candidates.length===1||candidates[0].headers.length>candidates[1].headers.length,'CRYPTOWORTH_DELIMITER_REQUIRED','Choose the actual delimiter for this file.');
    parsed=candidates[0];
  }
  return {...parsed,sha256:cwHash(raw),bytes:raw.length};
}
export function inspectCryptoworthTemplate(file,options={}){
  const {name,bytes}=cwDecode(file),parsed=readCryptoworthCsv(bytes,options);
  cwCheck(parsed.records.every(r=>r.values.length===parsed.headers.length),'CRYPTOWORTH_TEMPLATE_ROW_LENGTH','A template sample row has a different field count from its header.');
  return {template:{name,sha256:parsed.sha256,bytes:parsed.bytes,headers:parsed.headers,delimiter:parsed.delimiter,newline:parsed.newline,bom:parsed.bom,
    sampleRows:parsed.records.slice(0,5).map(r=>r.values),sampleRowCount:parsed.records.length},requiredRoles:CRYPTOWORTH_REQUIRED_ROLES,
    suggestedColumns:Object.fromEntries(Object.entries(CRYPTOWORTH_LABELS).filter(([,label])=>parsed.headers.includes(label)))};
}
export function cwColumns(headers,value,{input=true}={}){
  cwCheck(cwObject(value),'CRYPTOWORTH_COLUMNS_REQUIRED','Map the actual source column names.');
  const required=input?CRYPTOWORTH_REQUIRED_ROLES:['date','cryptoId','type','amountOne'];
  const allowed=new Set([...CRYPTOWORTH_REQUIRED_ROLES,...CRYPTOWORTH_OPTIONAL_ROLES]),used=new Set(),columns={};
  for(const [role,column]of Object.entries(value)){
    cwCheck(allowed.has(role)&&typeof column==='string'&&headers.includes(column),'INVALID_CRYPTOWORTH_COLUMN','Bind '+role+' to an actual column in this file.');
    cwCheck(!used.has(column),'DUPLICATE_CRYPTOWORTH_COLUMN','A column is assigned to more than one role.');used.add(column);columns[role]=column;
  }
  cwCheck(required.every(role=>columns[role]),'CRYPTOWORTH_COLUMNS_REQUIRED','Map every required '+(input?'native import':'received export')+' role.',400,{required});return columns;
}
export function cwDateMapping(value){
  cwCheck(cwObject(value)&&CRYPTOWORTH_DATE_FORMATS.includes(value.format),'CRYPTOWORTH_DATE_FORMAT_REQUIRED','Choose the actual date representation.');
  const timeZone=cwText(value.timeZone,'account timezone',100);
  try{new Intl.DateTimeFormat('en',{timeZone}).format(new Date(0));}catch{throw new CryptoworthError('INVALID_CRYPTOWORTH_TIMEZONE','Choose a valid IANA account timezone.');}
  cwCheck(!value.format.startsWith('UTC_')&&value.format!=='ISO_UTC'||timeZone==='UTC','CRYPTOWORTH_UTC_REQUIRED','Select UTC for an explicitly UTC date representation.');
  return {format:value.format,timeZone,precision:value.format.endsWith('_DATE')?'day':value.format==='ISO_UTC'?'millisecond':'second'};
}
const formatters=new Map();
function civilParts(instant,timeZone){
  let formatter=formatters.get(timeZone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});if(formatters.size>100)formatters.clear();formatters.set(timeZone,formatter);}
  const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return p.year.padStart(4,'0')+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+':'+p.second;
}
export function cwFormatDate(instant,mapping){
  const value=cwInstant(instant,'native transfer timestamp');
  if(mapping.format==='ISO_UTC')return value;
  const text=mapping.format.startsWith('UTC_')?value.slice(0,19).replace('T',' '):civilParts(value,mapping.timeZone);
  return mapping.format.endsWith('_DATE')?text.slice(0,10):text;
}
export function cwReadDate(value,mapping){
  cwText(value,'received date',100);
  if(mapping.format==='ISO_UTC')return cwInstant(value,'received transaction timestamp');
  const dateOnly=mapping.format.endsWith('_DATE'),pattern=dateOnly?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  cwCheck(pattern.test(value),'INVALID_CRYPTOWORTH_RECEIVED_DATE','The received date differs from its selected representation.');
  const checkValue=dateOnly?value+'T00:00:00Z':value.replace(' ','T')+'Z';cwInstant(checkValue,'received calendar fields');return value;
}
export function cwScale(value){cwCheck(Number.isSafeInteger(value)&&value>=0&&value<=30,'INVALID_CRYPTOWORTH_SCALE','Choose an integer asset decimal scale from 0 to 30.');return value;}
export function atomicToCryptoworth(value,scale){
  cwCheck(typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value),'INVALID_CRYPTOWORTH_ATOMIC','Retain the original positive atomic integer string.');cwScale(scale);
  if(scale===0)return value;const padded=value.padStart(scale+1,'0');return padded.slice(0,-scale)+'.'+padded.slice(-scale);
}
export function cryptoworthToAtomic(value,scale,{groupSeparator='',allowNegative=false}={}){
  cwScale(scale);cwText(value,'decimal quantity',100);
  cwCheck(groupSeparator===''||groupSeparator===',','INVALID_CRYPTOWORTH_GROUP_SEPARATOR','Choose the actual amount grouping convention.');
  let v=value,negative=false;if(v.startsWith('-')){cwCheck(allowNegative,'CRYPTOWORTH_AMOUNT_SIGN','An unsigned quantity is negative.');negative=true;v=v.slice(1);}
  cwCheck(!v.startsWith('+')&&v!==''&&!/[eE\s]/.test(v),'INVALID_CRYPTOWORTH_QUANTITY','Use an exact decimal quantity without exponent or whitespace.');
  if(groupSeparator===','&&v.includes(',')){cwCheck(/^[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?$/.test(v),'INVALID_CRYPTOWORTH_QUANTITY','Check the grouped decimal quantity.');v=v.replaceAll(',','');}
  cwCheck(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v),'INVALID_CRYPTOWORTH_QUANTITY','Use the exact decimal quantity.');
  let [whole,fraction='']=v;cwCheck(fraction.slice(scale).split('').every(c=>c==='0'),'CRYPTOWORTH_QUANTITY_PRECISION','The received quantity cannot be represented in the selected atomic scale.');
  fraction=fraction.slice(0,scale).padEnd(scale,'0');const atomic=(whole+fraction).replace(/^0+(?=\d)/,'');
  cwCheck(atomic.length<=39,'CRYPTOWORTH_QUANTITY_RANGE','The quantity exceeds the original amount range.');
  return {atomic,negative:negative&&atomic!=='0'};
}
export function writeCryptoworthCsv(headers,rows,{delimiter=',',newline='\r\n',bom=false}={}){
  cwCheck([',',';','\t'].includes(delimiter)&&['\n','\r\n','\r'].includes(newline),'INVALID_CRYPTOWORTH_LAYOUT','Use the retained CSV delimiter and line ending.');
  const quote=value=>{const text=value===null||value===undefined?'':String(value);return text.includes(delimiter)||/["\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  return Buffer.from((bom?'\uFEFF':'')+[headers,...rows].map(row=>{cwCheck(Array.isArray(row)&&row.length===headers.length,'CRYPTOWORTH_ROW_LENGTH','A generated row differs from the original header.');return row.map(quote).join(delimiter);}).join(newline)+newline);
}
