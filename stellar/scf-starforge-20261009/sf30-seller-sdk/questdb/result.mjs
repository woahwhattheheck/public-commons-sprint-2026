// MIT. Streaming native JSON rows with retained numeric tokens and CSV quote semantics.
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fail, object, own, canonical, integralDecimal, decimalParts } from './common.mjs';

export class SourceNumber {
  constructor(text){this.text=text;Object.freeze(this);}
  toJSON(){return this.text;}
}
export function parseExactJson(text) {
  try{return JSON.parse(text,(_key,value,context)=>{
    if(typeof value!=='number')return value;
    if(typeof context?.source!=='string')throw fail('QUESTDB_EXACT_JSON_RUNTIME_REQUIRED','Use Node 22.5 or later with JSON.parse source context.');
    return new SourceNumber(context.source);
  });}catch(issue){if(issue?.code)throw issue;throw fail('QUESTDB_RESPONSE_JSON_INVALID');}
}
function exactJsonText(value) {
  if(value instanceof SourceNumber)return value.text;
  if(Array.isArray(value))return'['+value.map(exactJsonText).join(',')+']';
  if(object(value))return'{'+Object.keys(value).map(key=>JSON.stringify(key)+':'+exactJsonText(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const plainMetadata=value=>value instanceof SourceNumber?value.text:Array.isArray(value)?value.map(plainMetadata):
  object(value)?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,plainMetadata(child)])):value;
function countText(value) {
  const text=value instanceof SourceNumber?value.text:typeof value==='number'?String(value):value;
  if(typeof text!=='string'||!/^(0|[1-9][0-9]*)$/.test(text))throw fail('QUESTDB_RESPONSE_COUNT_INVALID');
  return text;
}
export function describeNativeColumns(columns) {
  if(!Array.isArray(columns)||!columns.length||columns.length>128)throw fail('QUESTDB_RESPONSE_COLUMNS_INVALID');
  const names=new Set();
  return columns.map(column=>{
    if(!object(column)||typeof column.name!=='string'||!column.name||column.name.length>255||
        typeof column.type!=='string'||column.type.length>256||names.has(column.name))throw fail('QUESTDB_RESPONSE_COLUMNS_INVALID');
    names.add(column.name);
    const type=column.type.toUpperCase();
    if(['BINARY','RECORD','LONG128'].includes(type))throw fail('QUESTDB_TYPE_NOT_EXPORTABLE',
      'The native HTTP representation cannot preserve '+type+'; use an explicit reviewed textual projection.');
    return{name:column.name,type:column.type,
      valueEncoding:type.includes('[]')||type==='ARRAY'?'json-text-with-original-numeric-lexemes':
        type==='BOOLEAN'?'boolean':type==='NULL'?'null':'source-text',
      ...(type==='TIMESTAMP_NS'?{timestampPrecision:9}:type==='TIMESTAMP'?{timestampPrecision:6}:type==='DATE'?{timestampPrecision:3}:{}),
      counts:{null:0,value:0}};
  });
}
export function nativeRow(values,columns) {
  if(!Array.isArray(values)||values.length!==columns.length)throw fail('QUESTDB_RESPONSE_ROW_INVALID');
  const row=Object.create(null);
  values.forEach((value,index)=>{
    const column=columns[index],type=column.type.toUpperCase();
    if(value===null){column.counts.null++;row[column.name]=null;return;}
    column.counts.value++;
    if(type==='NULL')throw fail('QUESTDB_RESPONSE_TYPE_CHANGED');
    if(type==='BOOLEAN'){
      if(typeof value!=='boolean')throw fail('QUESTDB_RESPONSE_TYPE_CHANGED');row[column.name]=value;return;
    }
    if(value instanceof SourceNumber){row[column.name]=value.text;return;}
    if(typeof value==='string'){row[column.name]=value;return;}
    if(Array.isArray(value)&&(type.includes('[]')||type==='ARRAY')){row[column.name]=exactJsonText(value);return;}
    throw fail('QUESTDB_RESPONSE_TYPE_CHANGED');
  });
  return row;
}
export function canonicalCsvLine(values) {
  return values.map(value=>value===null?'':typeof value==='boolean'?String(value):
    '"'+String(value).replace(/"/g,'""')+'"').join(',')+'\r\n';
}
export function createQuestDbResponseReader({columns:expected,maxRows=1000000,maxRowBytes=1048576,
  maxMetadataBytes=1048576,onRow=async()=>{},onColumns=async()=>{}}={}) {
  let buffer='',state='root',key=null,mayEnd=true,seenDataset=false,ended=false,scan=null;
  const metadata=Object.create(null),keys=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});
  let nativeColumns=null,rowCount=0,metadataBytes=0;
  const rowHash=createHash('sha256');
  const trim=()=>{const match=/^\s*/.exec(buffer)[0].length;if(match)buffer=buffer.slice(match);};
  function valueEnd(final=false) {
    if(!buffer.length)return null;
    if(!scan)scan={position:0,quoted:false,escaped:false,depth:0,kind:buffer[0]};
    const complex=scan.kind==='['||scan.kind==='{',string=scan.kind==='"';
    for(let i=scan.position;i<buffer.length;i++) {
      const ch=buffer[i];
      if(scan.quoted){
        if(scan.escaped){scan.escaped=false;continue;}
        if(ch==='\\'){scan.escaped=true;continue;}
        if(ch==='"'){scan.quoted=false;if(string){scan=null;return i+1;}}
        continue;
      }
      if(ch==='"'){scan.quoted=true;continue;}
      if(complex){
        if(ch==='['||ch==='{'){scan.depth++;if(scan.depth>64)throw fail('QUESTDB_RESPONSE_DEPTH_LIMIT');}
        if(ch===']'||ch==='}'){scan.depth--;if(scan.depth===0){scan=null;return i+1;}}
      }else if(!string && (ch===','||ch===']'||ch==='}'||/\s/.test(ch))){scan=null;return i;}
    }
    scan.position=buffer.length;
    if(Buffer.byteLength(buffer)>(state==='dataset'?maxRowBytes:maxMetadataBytes))throw fail('QUESTDB_RESPONSE_VALUE_TOO_LARGE');
    if(final && !complex && !string){scan=null;return buffer.length;}
    return null;
  }
  async function consume(final=false) {
    while(true) {
      if(!scan)trim();
      if(!buffer.length)return;
      if(state==='done'){if(buffer.trim())throw fail('QUESTDB_RESPONSE_TRAILING_BYTES');buffer='';return;}
      if(state==='root'){if(buffer[0]!=='{')throw fail('QUESTDB_RESPONSE_OBJECT_REQUIRED');buffer=buffer.slice(1);state='key';mayEnd=true;continue;}
      if(state==='key'){
        if(!scan && buffer[0]==='}'){if(!mayEnd)throw fail('QUESTDB_RESPONSE_JSON_INVALID');buffer=buffer.slice(1);state='done';continue;}
        if(!scan && buffer[0]!=='"')throw fail('QUESTDB_RESPONSE_JSON_INVALID');
        const end=valueEnd(final);if(end===null)return;
        key=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end);
        if(keys.has(key))throw fail('QUESTDB_RESPONSE_DUPLICATE_FIELD');keys.add(key);state='colon';continue;
      }
      if(state==='colon'){if(buffer[0]!==':')throw fail('QUESTDB_RESPONSE_JSON_INVALID');buffer=buffer.slice(1);state='value';continue;}
      if(state==='value' && key==='dataset'){
        if(buffer[0]!=='['||seenDataset)throw fail('QUESTDB_RESPONSE_DATASET_INVALID');
        seenDataset=true;buffer=buffer.slice(1);state='dataset';mayEnd=true;
        nativeColumns=describeNativeColumns(metadata.columns);
        if(expected && (expected.length!==nativeColumns.length || expected.some((name,index)=>name!==nativeColumns[index].name)))
          throw fail('QUERY_COLUMN_MISMATCH');
        await onColumns(structuredClone(nativeColumns));continue;
      }
      if(state==='dataset'){
        if(!scan && buffer[0]===']'){if(!mayEnd)throw fail('QUESTDB_RESPONSE_JSON_INVALID');buffer=buffer.slice(1);state='after';continue;}
        if(!scan && buffer[0]!=='[')throw fail('QUESTDB_RESPONSE_ROW_INVALID');
        const end=valueEnd(final);if(end===null)return;
        const original=buffer.slice(0,end);buffer=buffer.slice(end);
        if(Buffer.byteLength(original)>maxRowBytes)throw fail('QUESTDB_SOURCE_ROW_TOO_LARGE');
        const row=nativeRow(parseExactJson(original),nativeColumns);rowCount++;
        if(rowCount>maxRows)throw fail('QUESTDB_ROW_LIMIT_EXCEEDED','Narrow the complete source query or increase its reviewed extraction limit.',{maximum:maxRows,observed:rowCount});
        const ordered=nativeColumns.map(column=>row[column.name]);rowHash.update(canonical(ordered)+'\n');
        await onRow(row,structuredClone(nativeColumns),{rowCount});
        state='afterRow';continue;
      }
      if(state==='afterRow'){
        if(buffer[0]===','){buffer=buffer.slice(1);state='dataset';mayEnd=false;continue;}
        if(buffer[0]===']'){buffer=buffer.slice(1);state='after';continue;}
        throw fail('QUESTDB_RESPONSE_JSON_INVALID');
      }
      if(state==='value'){
        const end=valueEnd(final);if(end===null)return;
        const text=buffer.slice(0,end);buffer=buffer.slice(end);metadataBytes+=Buffer.byteLength(text);
        if(metadataBytes>maxMetadataBytes)throw fail('QUESTDB_RESPONSE_METADATA_TOO_LARGE');
        metadata[key]=parseExactJson(text);state='after';continue;
      }
      if(state==='after'){
        if(buffer[0]===','){buffer=buffer.slice(1);state='key';mayEnd=false;continue;}
        if(buffer[0]==='}'){buffer=buffer.slice(1);state='done';continue;}
        throw fail('QUESTDB_RESPONSE_JSON_INVALID');
      }
      throw fail('QUESTDB_RESPONSE_STATE_INVALID');
    }
  }
  return{
    async feed(chunk){if(ended)throw fail('QUESTDB_RESPONSE_ALREADY_ENDED');buffer+=decoder.decode(chunk,{stream:true});await consume();},
    async end({complete=false}={}){
      if(ended)throw fail('QUESTDB_RESPONSE_ALREADY_ENDED');ended=true;buffer+=decoder.decode();await consume(true);
      if(state!=='done'||buffer.trim())throw fail('QUESTDB_RESPONSE_INCOMPLETE');
      if(typeof metadata.error==='string')throw fail('QUESTDB_PROVIDER_ERROR',metadata.error,{provider:plainMetadata(metadata)});
      if(!seenDataset||!nativeColumns)throw fail('QUESTDB_RESPONSE_DATASET_REQUIRED');
      const reportedCount=countText(metadata.count);
      if(BigInt(reportedCount)<BigInt(rowCount))throw fail('QUESTDB_RESPONSE_COUNT_MISMATCH');
      if(complete && BigInt(reportedCount)!==BigInt(rowCount))throw fail('QUESTDB_CAPTURE_INCOMPLETE',
        'The server returned fewer rows than its native count; increase the server response limit or narrow the source query.',
        {rowCount,reportedCount});
      const timestamp=metadata.timestamp instanceof SourceNumber?Number(metadata.timestamp.text):-1;
      if(!Number.isSafeInteger(timestamp)||timestamp<-1||timestamp>=nativeColumns.length)throw fail('QUESTDB_TIMESTAMP_METADATA_INVALID');
      return{rowCount,reportedCount,columnTypes:nativeColumns,designatedTimestampIndex:timestamp,
        orderedRowsSha256:rowHash.digest('hex'),metadata:plainMetadata(metadata),complete:BigInt(reportedCount)===BigInt(rowCount)};
    }
  };
}
export async function* readCapturedRows(file,{sha256,bytes,maxRowBytes=1048576,signal}={}) {
  const stream=createReadStream(file,{flags:constants.O_RDONLY|(constants.O_NOFOLLOW??0),highWaterMark:65536,signal});
  const hash=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,pending='';
  try{
    for await(const chunk of stream){
      total+=chunk.length;if(bytes!==undefined&&total>bytes)throw fail('QUESTDB_CAPTURE_CHANGED');hash.update(chunk);
      pending+=decoder.decode(chunk,{stream:true});let end;
      while((end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        if(!line)throw fail('QUESTDB_CAPTURE_ROW_INVALID');
        if(Buffer.byteLength(line)>maxRowBytes)throw fail('QUESTDB_CAPTURE_ROW_TOO_LARGE');
        const value=JSON.parse(line);if(!object(value))throw fail('QUESTDB_CAPTURE_ROW_INVALID');yield value;
      }
      if(Buffer.byteLength(pending)>maxRowBytes)throw fail('QUESTDB_CAPTURE_ROW_TOO_LARGE');
    }
    pending+=decoder.decode();if(pending)throw fail('QUESTDB_CAPTURE_INCOMPLETE');
    if(bytes!==undefined&&total!==bytes||sha256!==undefined&&hash.digest('hex')!==sha256)throw fail('QUESTDB_CAPTURE_CHANGED');
  }finally{stream.destroy();}
}
export function createNativeCsvReader({columns,onRow=()=>{},maxRowBytes=1048576}={}) {
  const decoder=new TextDecoder('utf-8',{fatal:true});let field='',row=[],quoted=false,inQuote=false,afterQuote=false,started=false,skipLF=false,rowBytes=0,headers=null,rowCount=0;
  const rowHash=createHash('sha256');
  function cell(){row.push({value:field,quoted});field='';quoted=false;afterQuote=false;started=false;}
  function record(){
    cell();const cells=row;row=[];rowBytes=0;
    if(!headers){headers=cells.map(value=>value.value);if(columns&&(headers.length!==columns.length||headers.some((name,index)=>name!==columns[index].name)))throw fail('QUESTDB_NATIVE_CSV_COLUMNS_CHANGED');return;}
    if(cells.length!==headers.length)throw fail('QUESTDB_NATIVE_CSV_COLUMNS_CHANGED');
    const values=cells.map((cell,index)=>{
      if(cell.value===''&&!cell.quoted)return null;
      const type=columns?.[index]?.type?.toUpperCase();
      if(type==='BOOLEAN'){if(!['true','false'].includes(cell.value))throw fail('QUESTDB_NATIVE_CSV_BOOLEAN_INVALID');return cell.value==='true';}
      return cell.value;
    });
    rowCount++;rowHash.update(canonical(values)+'\n');onRow(Object.fromEntries(headers.map((name,index)=>[name,values[index]])));
  }
  function feedText(text) {
    for(const ch of text){
      if(skipLF){skipLF=false;if(ch==='\n')continue;}
      rowBytes+=Buffer.byteLength(ch);if(rowBytes>maxRowBytes)throw fail('QUESTDB_NATIVE_CSV_ROW_TOO_LARGE');
      if(inQuote){
        if(ch==='"'){inQuote=false;afterQuote=true;}else field+=ch;
        continue;
      }
      if(afterQuote){
        if(ch==='"'){field+='"';inQuote=true;afterQuote=false;continue;}
        if(ch===','){cell();continue;}
        if(ch==='\r'||ch==='\n'){record();skipLF=ch==='\r';continue;}
        throw fail('QUESTDB_NATIVE_CSV_INVALID');
      }
      if(ch==='"'){if(started||field)throw fail('QUESTDB_NATIVE_CSV_INVALID');quoted=true;inQuote=true;started=true;continue;}
      if(ch===','){cell();continue;}
      if(ch==='\r'||ch==='\n'){record();skipLF=ch==='\r';continue;}
      field+=ch;started=true;
    }
  }
  return{feed(chunk){feedText(decoder.decode(chunk,{stream:true}));},end(){
    feedText(decoder.decode());if(inQuote)throw fail('QUESTDB_NATIVE_CSV_INCOMPLETE');
    if(started||field||row.length||afterQuote)record();
    if(!headers)throw fail('QUESTDB_NATIVE_CSV_HEADER_REQUIRED');
    return{rowCount,headers,orderedRowsSha256:rowHash.digest('hex'),nullEncoding:'unquoted-empty',emptyStringEncoding:'quoted-empty'};
  }};
}
