// MIT. Exact original RIS documents and declared export provenance.
import {digest,jsonBytes,parseJson,need,object} from '../../node/store.mjs';
import {parseRisDocument} from './parser.mjs';

import {RIS_SOURCE_SCHEMA,RIS_EDITION_SCHEMA,RIS_PREVIEW_SCHEMA,RIS_LIMITS,RIS_PARSER_VERSION} from './constants.mjs';
export {RIS_SOURCE_SCHEMA,RIS_EDITION_SCHEMA,RIS_PREVIEW_SCHEMA,RIS_LIMITS,RIS_PARSER_VERSION};
export const clone=value=>structuredClone(value);
export const sha=bytes=>digest(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));
export const plain=value=>object(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function exact(value,keys,code='RIS_INPUT_FIELDS_INVALID'){
  need(plain(value)&&Object.keys(value).every(key=>keys.includes(key)),code);return value;
}
export function text(value,name,maximum,{empty=false}={}){
  need(typeof value==='string'&&value.length<=maximum&&(empty||value.trim().length>0)&&
    !value.includes('\u0000'),name);return value;
}
export function time(value,name,{nullable=false}={}){
  if(nullable&&value===null)return null;
  need(typeof value==='string'&&Number.isFinite(Date.parse(value)),name);return value;
}
export function integer(value,name,min=0,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,name);return value;
}
export function canonical(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){need(Number.isFinite(value),'RIS_NONFINITE_VALUE');return JSON.stringify(value);}
  if(Array.isArray(value)){
    need(Object.keys(value).length===value.length,'RIS_SPARSE_ARRAY');
    return '['+value.map(canonical).join(',')+']';
  }
  need(plain(value),'RIS_JSON_VALUE_REQUIRED');
  const keys=Object.keys(value).sort();
  need(!keys.some(key=>['__proto__','prototype','constructor'].includes(key)),'RIS_JSON_KEY_INVALID');
  return '{'+keys.map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const valueSha=value=>sha(canonical(value));
export const equal=(left,right)=>canonical(left)===canonical(right);
export function descriptor(value,name='RIS_SOURCE_DESCRIPTOR_INVALID'){
  exact(value,['sha256','bytes'],name);
  need(/^[a-f0-9]{64}$/.test(value.sha256),'RIS_SOURCE_HASH_INVALID');
  integer(value.bytes,name,0,RIS_LIMITS.editionBytes);return clone(value);
}
export function decodeBase64(value,{maximum=RIS_LIMITS.documentBytes,name='RIS_DOCUMENT_BYTES_INVALID'}={}){
  need(typeof value==='string'&&value.length<=Math.ceil(maximum/3)*4&&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),name);
  const bytes=Buffer.from(value,'base64');
  need(bytes.length<=maximum&&bytes.toString('base64')===value,name);return bytes;
}
function url(value){
  text(value,'RIS_SOURCE_URL_INVALID',8000,{empty:true});
  if(value==='')return value;
  let parsed;try{parsed=new URL(value);}catch{need(false,'RIS_SOURCE_URL_INVALID');}
  need(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'RIS_SOURCE_URL_INVALID');
  return value;
}
function declaration(value){
  exact(value,['database','query','exportedAt','retrievedAt','url','sourceReference','sourceTerms','notes','provenance'],
    'RIS_DECLARATION_INVALID');
  const provenance=value.provenance??{};
  canonical(provenance);
  need(Buffer.byteLength(canonical(provenance))<=RIS_LIMITS.provenanceBytes,'RIS_PROVENANCE_TOO_LARGE');
  return {database:text(value.database,'RIS_DATABASE_REQUIRED',500),
    query:text(value.query??'','RIS_QUERY_INVALID',20000,{empty:true}),
    exportedAt:time(value.exportedAt??null,'RIS_EXPORT_TIME_INVALID',{nullable:true}),
    retrievedAt:time(value.retrievedAt??null,'RIS_RETRIEVAL_TIME_INVALID',{nullable:true}),
    url:url(value.url??''),sourceReference:text(value.sourceReference??'','RIS_SOURCE_REFERENCE_INVALID',4000,{empty:true}),
    sourceTerms:text(value.sourceTerms,'RIS_DOCUMENT_SOURCE_TERMS_REQUIRED',20000),
    notes:text(value.notes??'','RIS_DECLARATION_NOTES_INVALID',100000,{empty:true}),provenance:clone(provenance)};
}
export function createRisDocument(input){
  exact(input,['filename','encoding','declaration','bodyBase64','sha256','bytes'],'RIS_DOCUMENT_INPUT_INVALID');
  const filename=text(input.filename,'RIS_FILENAME_INVALID',240);
  need(!/[\/\\\u0000-\u001f\u007f]/.test(filename)&&!['.','..'].includes(filename),'RIS_FILENAME_INVALID');
  const encoding=input.encoding??'utf-8';
  need(['utf-8','windows-1252','utf-16le','utf-16be'].includes(encoding),'RIS_ENCODING_INVALID');
  const body=decodeBase64(input.bodyBase64),bodySha256=sha(body);
  need(input.sha256===undefined||input.sha256===bodySha256,'RIS_DOCUMENT_CHANGED');
  need(input.bytes===undefined||input.bytes===body.length,'RIS_DOCUMENT_CHANGED');
  const metadata={filename,encoding,declaration:declaration(input.declaration),bytes:body.length,sha256:bodySha256};
  return {id:'risdoc_'+valueSha(metadata),...metadata,bodyBase64:input.bodyBase64};
}
export function createRisSource(input){
  exact(input,['label','preparedAt','sourceReference','sourceTerms','documents'],'RIS_SOURCE_INPUT_INVALID');
  need(Array.isArray(input.documents)&&input.documents.length>0&&input.documents.length<=RIS_LIMITS.documents,
    'RIS_DOCUMENT_COUNT_INVALID');
  const documents=input.documents.map(createRisDocument);
  need(new Set(documents.map(row=>row.id)).size===documents.length,'RIS_DOCUMENT_DUPLICATE');
  const total=documents.reduce((sum,row)=>sum+row.bytes,0);
  need(total<=RIS_LIMITS.totalDocumentBytes,'RIS_DOCUMENT_TOTAL_TOO_LARGE');
  const source={schema:RIS_SOURCE_SCHEMA,parser:RIS_PARSER_VERSION,
    label:text(input.label,'RIS_LABEL_REQUIRED',240),preparedAt:time(input.preparedAt,'RIS_PREPARATION_TIME_REQUIRED'),
    sourceReference:text(input.sourceReference??'','RIS_SOURCE_REFERENCE_INVALID',4000,{empty:true}),
    sourceTerms:text(input.sourceTerms,'RIS_SOURCE_TERMS_REQUIRED',20000),documents};
  const bytes=jsonBytes(source);need(bytes.length<=RIS_LIMITS.sourceBytes,'RIS_SOURCE_TOO_LARGE');
  // Parsing happens before the original blob writer can retain a prepared source.
  const parsed=analyzeRisSource(source);
  return {source,bytes,descriptor:{bytes:bytes.length,sha256:sha(bytes)},analysis:parsed};
}
export function validateRisSource(value){
  exact(value,['schema','parser','label','preparedAt','sourceReference','sourceTerms','documents'],'RIS_SOURCE_INVALID');
  need(value.schema===RIS_SOURCE_SCHEMA&&value.parser===RIS_PARSER_VERSION,'RIS_SOURCE_SCHEMA_INVALID');
  need(Array.isArray(value.documents),'RIS_DOCUMENT_COUNT_INVALID');
  const input={label:value.label,preparedAt:value.preparedAt,sourceReference:value.sourceReference,
    sourceTerms:value.sourceTerms,documents:value.documents.map(row=>{
      exact(row,['id','filename','encoding','declaration','bytes','sha256','bodyBase64'],'RIS_DOCUMENT_INVALID');
      const {id,...rest}=row;const checked=createRisDocument(rest);need(id===checked.id,'RIS_DOCUMENT_ID_CHANGED');return rest;
    })};
  const prepared=createRisSource(input);
  need(equal(prepared.source,value),'RIS_SOURCE_DECLARATION_CHANGED');return prepared;
}
export function inspectRisSource(input){
  const rawBytes=Buffer.isBuffer(input)?input:typeof input==='string'?Buffer.from(input,'utf8'):jsonBytes(input);
  need(rawBytes.length<=RIS_LIMITS.sourceBytes,'RIS_SOURCE_TOO_LARGE');
  const checked=validateRisSource(parseJson(rawBytes));
  return {...checked,bytes:rawBytes,descriptor:{bytes:rawBytes.length,sha256:sha(rawBytes)}};
}
export function analyzeRisSource(source){
  let recordCount=0,lineCount=0;const records=[],documents=[],diagnostics=[];
  for(const document of source.documents){
    const body=decodeBase64(document.bodyBase64),parsed=parseRisDocument(body,{encoding:document.encoding});
    need(body.length===document.bytes&&sha(body)===document.sha256,'RIS_DOCUMENT_CHANGED');
    lineCount+=parsed.lineCount;
    need(lineCount<=RIS_LIMITS.totalLines,'RIS_TOTAL_LINE_COUNT_LIMIT');
    need(diagnostics.length+parsed.diagnostics.length<=RIS_LIMITS.diagnostics,'RIS_DIAGNOSTIC_COUNT_LIMIT');
    const documentRecords=[];
    for(const original of parsed.records){
      recordCount++;need(recordCount<=RIS_LIMITS.records,'RIS_RECORD_LIMIT');
      const id='risrec_'+valueSha({documentId:document.id,ordinal:original.ordinal,sha256:original.sha256});
      const row={...original,id,documentId:document.id,documentFilename:document.filename,
        database:document.declaration.database,query:document.declaration.query,
        encoding:document.encoding,sourceTerms:document.declaration.sourceTerms};
      records.push(row);documentRecords.push(id);
    }
    for(const issue of parsed.diagnostics)diagnostics.push({...issue,documentId:document.id,
      id:'risdiag_'+valueSha({documentId:document.id,...issue})});
    documents.push({id:document.id,filename:document.filename,encoding:document.encoding,
      declaration:clone(document.declaration),bytes:document.bytes,sha256:document.sha256,
      bomBytes:parsed.bomBytes,lineCount:parsed.lineCount,recordIds:documentRecords,
      completeRecords:parsed.records.filter(row=>row.complete).length,unparsedSegments:clone(parsed.unparsedSegments)});
  }
  return {parser:RIS_PARSER_VERSION,documents,records,diagnostics,
    counts:{documents:documents.length,records:records.length,
      completeRecords:records.filter(row=>row.complete).length,
      malformedRecords:records.filter(row=>!row.complete).length,
      originalBytes:source.documents.reduce((sum,row)=>sum+row.bytes,0)}};
}
export function originalRecordBytes(source,record){
  const document=source.documents.find(row=>row.id===record.documentId);
  need(document,'RIS_DOCUMENT_NOT_FOUND');
  const body=decodeBase64(document.bodyBase64),selected=body.subarray(record.start,record.end);
  need(selected.length===record.bytes&&sha(selected)===record.sha256,'RIS_RECORD_CHANGED');return selected;
}
