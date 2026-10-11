// MIT. Bitwave Data Fusion representation of the original accountant handoff.
// All financial/source values remain exact strings. The accountant engine owns returns.
import {createHash,randomUUID} from 'node:crypto';
import {CSV_COLUMNS,PROTECTED_COLUMNS,EDITABLE_COLUMNS,inspectHandoff,validateHandoff,validateRevision} from './engine.mjs';

export const BITWAVE_PLAN_SCHEMA='stellar-forge.bitwave-data-source.v1';
export const BITWAVE_CAPTURE_SCHEMA='stellar-forge.bitwave-data-source-capture.v1';
export const BITWAVE_COLUMNS=Object.freeze(['accountantExportRowId','accountantExportId','accountantRevisionId','accountantRevisionSha256',...CSV_COLUMNS]);
export const BITWAVE_SOURCE_COLUMNS=Object.freeze(BITWAVE_COLUMNS.filter(name=>!EDITABLE_COLUMNS.includes(name)));
export const BITWAVE_DOCS=Object.freeze([
  {title:'Loaded data sources: create, schema and row batches',url:'https://docs.bitwave.io/docs/api-loaded-data-sources'},
  {title:'Retrieve rows: native table rows and pagination',url:'https://docs.bitwave.io/docs/get-datasource-rows'},
  {title:'API authentication',url:'https://docs.bitwave.io/reference/gettoken'},
  {title:'Bitwave original transaction exports',url:'https://docs.bitwave.io/docs/transactions-export-1'},
]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const bitwaveHash=value=>createHash('sha256').update(value).digest('hex');
export function bitwaveCheck(ok,code,message,status=400){if(!ok)throw Object.assign(new Error(message),{code,status});}
export function bitwaveCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){bitwaveCheck(Number.isFinite(value),'INVALID_BITWAVE_RECORD','A record has a non-finite number.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(bitwaveCanonical).join(',')+']';
  bitwaveCheck(object(value),'INVALID_BITWAVE_RECORD','Use JSON records.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+bitwaveCanonical(value[key])).join(',')+'}';
}
const sealed=body=>({...body,integrity:{sha256:bitwaveHash(bitwaveCanonical(body))}});
const copy=value=>JSON.parse(bitwaveCanonical(value));
const cell=value=>value===undefined||value===null?'':String(value);
export function bitwaveText(value,name,maximum=160,{empty=false}={}){
  bitwaveCheck(typeof value==='string'&&value.length<=maximum&&(empty||value.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'INVALID_BITWAVE_FIELD','Check '+name+'.');return value;
}
export function bitwaveId(value){bitwaveCheck(typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value),'INVALID_BITWAVE_ID','Choose a retained Bitwave record.');return value;}
export function bitwaveTargetId(value,name='data source ID'){
  bitwaveCheck(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value),'INVALID_BITWAVE_TARGET','Use the exact native '+name+'.');return value;
}

export function createBitwavePlan({handoff,revision=null,id=randomUUID(),name,actor,orgId,description='',batchSize=250,createdAt=new Date().toISOString()}={}){
  validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
  bitwaveId(id);bitwaveText(name,'name');bitwaveText(actor,'operator',1000);bitwaveText(description,'description',2000,{empty:true});bitwaveTargetId(orgId,'organization ID');
  bitwaveCheck(Number.isInteger(batchSize)&&batchSize>=1&&batchSize<=250,'INVALID_BITWAVE_BATCH','Choose 1 to 250 rows per request.');
  bitwaveCheck(Number.isFinite(Date.parse(createdAt)),'INVALID_BITWAVE_TIME','Use a valid creation time.');
  const meta={handoffId:handoff.id,sourceRunId:handoff.source.runId,sourceReportSha256:handoff.source.reportSha256,
    sourcePeriodCloseId:handoff.source.periodClose?.id,sourcePeriodCloseSha256:handoff.source.periodClose?.sha256,sourcePeriodCloseRevision:handoff.source.periodClose?.revision};
  const rows=inspectHandoff(handoff,revision).rows.map(item=>{
    const row={accountantExportRowId:bitwaveHash('stellar-forge.bitwave-row.v1\n'+id+'\n'+item.rowId),accountantExportId:id,
      accountantRevisionId:revision?.id??'',accountantRevisionSha256:revision?.integrity.sha256??''};
    for(const key of CSV_COLUMNS){
      row[key]=cell(Object.hasOwn(meta,key)?meta[key]:key==='rowId'?item.rowId:key==='sourceRowSha256'?item.sourceRowSha256:
        EDITABLE_COLUMNS.includes(key)?item[key]:Object.hasOwn(item.label,key)?item.label[key]:item.original[key]);
    }
    return row;
  });
  bitwaveCheck(rows.length>0,'EMPTY_BITWAVE_SOURCE','Choose a handoff containing original merchant events.');
  const schemaColumns=BITWAVE_COLUMNS.map(name=>({name,type:'stringType'}));
  const batches=[];
  for(let offset=0;offset<rows.length;offset+=batchSize){
    const index=batches.length+1,selected=rows.slice(offset,offset+batchSize),body={rows:selected};
    batches.push({index,offset,rowCount:selected.length,sha256:bitwaveHash(bitwaveJson(body)),file:'add-rows-'+String(index).padStart(4,'0')+'.json'});
  }
  return sealed({schema:BITWAVE_PLAN_SCHEMA,id,name,actor,orgId,description,createdAt,batchSize,
    handoffId:handoff.id,handoffSha256:handoff.integrity.sha256,accountantRevisionId:revision?.id??null,
    accountantRevisionSha256:revision?.integrity.sha256??null,source:copy(handoff.source),summary:copy(handoff.summary),
    rowCount:rows.length,idFieldName:'accountantExportRowId',schemaColumns,batches,rows,docs:copy(BITWAVE_DOCS)});
}
export function validateBitwavePlan(plan){
  bitwaveCheck(object(plan)&&plan.schema===BITWAVE_PLAN_SCHEMA&&object(plan.integrity),'INVALID_BITWAVE_PLAN','Choose a retained Bitwave plan.');
  const {integrity,...body}=plan;
  bitwaveCheck(bitwaveHash(bitwaveCanonical(body))===integrity.sha256,'BITWAVE_PLAN_CHANGED','The saved data-source plan changed.',409);
  bitwaveId(plan.id);bitwaveTargetId(plan.orgId,'organization ID');
  bitwaveCheck(Array.isArray(plan.rows)&&plan.rowCount===plan.rows.length&&plan.rows.length<=22000,'INVALID_BITWAVE_ROWS','The plan has an invalid source count.');
  return plan;
}
export const bitwaveJson=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
export function bitwaveCreateRequest(plan){validateBitwavePlan(plan);return {data:{name:plan.name,description:plan.description,type:'loaded',idFieldName:plan.idFieldName,schema:copy(plan.schemaColumns)}};}
export function bitwaveBatchRequest(plan,index){
  validateBitwavePlan(plan);const batch=plan.batches.find(item=>item.index===index);
  bitwaveCheck(batch,'BITWAVE_BATCH_NOT_FOUND','Choose a retained request batch.',404);
  return {rows:copy(plan.rows.slice(batch.offset,batch.offset+batch.rowCount))};
}

// Encode only when producing the accountant's spreadsheet format. The native
// Data Fusion JSON above carries the original plain value without display escapes.
const longNumeric=value=>/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(value)&&value.replace(/\D/g,'').length>15;
const escaped=value=>/^['\t\r\n]/.test(value)||/^\s*[=+\-@]/u.test(value)||longNumeric(value)?"'"+value:value;
const csvCell=value=>'"'+escaped(cell(value)).replace(/"/g,'""')+'"';
export function bitwaveRowsCsv(rows,columns=BITWAVE_COLUMNS){return Buffer.from([columns.map(csvCell).join(','),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(','))].join('\r\n')+'\r\n','utf8');}

export function readBitwavePage(bytes){
  bitwaveCheck(Buffer.isBuffer(bytes)||bytes instanceof Uint8Array,'INVALID_BITWAVE_PAGE','Use the exact downloaded JSON file.');
  bitwaveCheck(bytes.length>0&&bytes.length<=64*1024*1024,'BITWAVE_PAGE_SIZE','A native page must be nonempty and at most 64 MiB.');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{bitwaveCheck(false,'INVALID_BITWAVE_JSON','The downloaded page must be valid UTF-8 JSON.');}
  bitwaveCheck(object(value)&&Array.isArray(value.items),'INVALID_BITWAVE_PAGE','Use the native table-rows response with its items array.');
  bitwaveCheck(value.items.length<=50000,'BITWAVE_ROW_LIMIT','A capture supports up to 50,000 source rows.');
  bitwaveCheck(value.items.every(object),'BITWAVE_NAMED_ROWS_REQUIRED','Use the native GET table-rows response with named row fields.');
  if(value.totalRows!==undefined)bitwaveCheck(Number.isSafeInteger(value.totalRows)&&value.totalRows>=0,'INVALID_BITWAVE_TOTAL','The native totalRows is not a nonnegative exact integer.');
  const token=value.nextPageToken??value.pageToken??value.bqPageToken??null;
  bitwaveCheck(token===null||typeof token==='string','INVALID_BITWAVE_CURSOR','The native page cursor must be text.');
  return {value,items:value.items,totalRows:value.totalRows??null,nextPageToken:token||null,truncated:value.truncated===true};
}

export function compareBitwavePages(plan,pageBytes){
  validateBitwavePlan(plan);
  bitwaveCheck(Array.isArray(pageBytes)&&pageBytes.length>0&&pageBytes.length<=500,'BITWAVE_PAGES_REQUIRED','Choose 1 to 500 ordered native response pages.');
  bitwaveCheck(pageBytes.reduce((n,bytes)=>n+bytes.length,0)<=64*1024*1024,'BITWAVE_CAPTURE_SIZE','A capture supports up to 64 MiB of native pages.');
  const pages=pageBytes.map(readBitwavePage),received=pages.flatMap(page=>page.items);
  bitwaveCheck(received.length<=50000,'BITWAVE_ROW_LIMIT','A capture supports up to 50,000 rows.');
  const issues=[],totals=new Set(pages.map(page=>page.totalRows).filter(total=>total!==null));
  if(totals.size>1)issues.push({code:'TOTAL_CHANGED',message:'The native total changed between pages. Capture the table again after the current changes finish.'});
  const total=totals.size===1?[...totals][0]:null;
  if(total!==null&&total!==received.length)issues.push({code:'INCOMPLETE_ROW_COUNT',message:'Received '+received.length+' rows; the native table reports '+total+'.'});
  if(pages.at(-1).nextPageToken)issues.push({code:'MORE_PAGES',message:'The last response has a next-page token. Retain the remaining native pages.'});
  if(pages.some(page=>page.truncated))issues.push({code:'TRUNCATED_NATIVE_PAGE',message:'A native response reports truncated data.'});
  if(total===null)issues.push({code:'NATIVE_TOTAL_UNAVAILABLE',message:'The native totalRows field is absent; capture completeness is not established.'});
  const byId=new Map(),unknown=[];
  const expected=new Map(plan.rows.map(row=>[row.accountantExportRowId,row]));
  for(let index=0;index<received.length;index++){
    const row=received[index],key=row.accountantExportRowId;
    if(typeof key!=='string'||!expected.has(key)){unknown.push({rowId:typeof row.rowId==='string'?row.rowId:null,status:'UNKNOWN',sourceRow:index+1,expected:null,received:row,changes:[]});continue;}
    const values=byId.get(key)??[];values.push({row,index});byId.set(key,values);
  }
  const items=[],matched=[];
  for(const original of plan.rows){
    const candidates=byId.get(original.accountantExportRowId)??[];
    if(!candidates.length){items.push({rowId:original.rowId,status:'MISSING',expected:original,received:null,changes:[]});continue;}
    if(candidates.length!==1){items.push({rowId:original.rowId,status:'DUPLICATE',expected:original,received:candidates.map(item=>item.row),changes:[],occurrences:candidates.length});continue;}
    const incoming=candidates[0].row,changes=[];
    for(const field of BITWAVE_SOURCE_COLUMNS)if(typeof incoming[field]!=='string'||incoming[field]!==original[field])changes.push({field,expected:original[field],received:incoming[field]??null});
    for(const field of EDITABLE_COLUMNS)if(typeof incoming[field]!=='string')changes.push({field,expected:'text',received:incoming[field]??null});
    const status=changes.length?'CHANGED':'MATCHED';
    const item={rowId:original.rowId,status,expected:original,received:incoming,changes};items.push(item);
    if(status==='MATCHED')matched.push(Object.fromEntries(CSV_COLUMNS.map(key=>[key,incoming[key]])));
  }
  const count=status=>items.filter(item=>item.status===status).length;
  const summary={expectedRows:plan.rows.length,receivedRows:received.length,matchedRows:count('MATCHED'),changedRows:count('CHANGED'),missingRows:count('MISSING'),
    unknownRows:unknown.length,duplicateRows:count('DUPLICATE'),totalRows:total,pages:pages.length};
  const status=issues.length?'PARTIAL':'COMPLETE';
  const body={schema:BITWAVE_CAPTURE_SCHEMA,planId:plan.id,planSha256:plan.integrity.sha256,status,summary,issues,items:[...items,...unknown]};
  return {comparison:sealed(body),csvBytes:bitwaveRowsCsv(matched,CSV_COLUMNS)};
}

/** Merge remote edits against the exported revision and the current local return. */
export function prepareBitwaveReturn(plan,comparison,handoff,currentRevision=null){
  validateBitwavePlan(plan);validateHandoff(handoff);if(currentRevision)validateRevision(handoff,currentRevision);
  bitwaveCheck(handoff.id===plan.handoffId&&handoff.integrity.sha256===plan.handoffSha256&&comparison.planSha256===plan.integrity.sha256,
    'BITWAVE_RETURN_SOURCE_CHANGED','Choose the original handoff and comparison for this export.',409);
  const current=new Map(inspectHandoff(handoff,currentRevision).rows.map(row=>[row.rowId,row])),rows=[],editConflicts=[];
  for(const item of comparison.items){
    if(item.status!=='MATCHED')continue;
    const now=current.get(item.rowId),next={...item.received},fields=[];
    for(const field of EDITABLE_COLUMNS){
      const before=item.expected[field],incoming=item.received[field],local=cell(now[field]);
      if(incoming===before)next[field]=local;
      else if(local!==before&&local!==incoming)fields.push({field,exported:before,current:local,received:incoming});
    }
    if(fields.length)editConflicts.push({code:'ACCOUNTANT_EDIT_CONFLICT',rowId:item.rowId,fields,message:'The accountant and returned source changed the same field differently.'});
    else rows.push(next);
  }
  return {csvBytes:bitwaveRowsCsv(rows,CSV_COLUMNS),editConflicts,matchedRows:rows.length};
}
