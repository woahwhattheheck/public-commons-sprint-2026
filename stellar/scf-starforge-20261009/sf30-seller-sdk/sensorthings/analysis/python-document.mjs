// MIT. Complete original SensorThings source editions into the existing Python Analysis document intake.
import {open,link,unlink} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readOwned,privateDirectory,syncDir} from '../../stellar-expert/store.mjs';
import {identity,json,stable,fault} from '../contract.mjs';
import {tableColumns,tableRows} from '../domain.mjs';
import {numericEligibility} from './model.mjs';
import {exportEdition,validateSourceEdition,openPrivateFile,hashHeldFile,inspectRetainedFile} from '../portable.mjs';

export const PYTHON_INTAKE_SCHEMA='stellar-forge.sensorthings-python-intake.v1';
export const PYTHON_SOURCE_SCHEMA='stellar-forge.sensorthings-python-source.v1';
export const PYTHON_DOCUMENT_LIMITS=Object.freeze({
  documentBytes:32*1024*1024,originalBytes:32*1024*1024,totalBytes:256*1024*1024,
  originals:32,archivePartBytes:16*1024*1024,rows:1000000
});
const TABLES=['observations','components','entities','observation_index','numeric_eligibility'];
const DERIVED_COLUMNS=Object.freeze({
  observation_index:['occurrence_id','original_key','original_key_state','semantic_sha256','source_page_sha256','source_pointer'],
  numeric_eligibility:['occurrence_id','eligible','reason','method']
});
function projectedColumns(table){return DERIVED_COLUMNS[table]??tableColumns(table);}
async function* projectedRows(store,edition,table){
  if(!DERIVED_COLUMNS[table]){yield* tableRows(store,edition,table);return;}
  for await(const item of tableRows(store,edition,'observations')){
    if(table==='observation_index'){
      const original=item.original;
      if(!original||!HASH.test(original.semanticHash??'')||
          !(original.key===null||typeof original.key==='string')||original.occurrenceId!==item.row.occurrence_id)
        throw error('ORIGINAL_IDENTITY','The original observation key, semantic identity and occurrence must remain available.');
      yield {row:{occurrence_id:item.row.occurrence_id,original_key:original.key??'',
        original_key_state:original.key===null?'missing':'value',semantic_sha256:original.semanticHash,
        source_page_sha256:item.row.source_page_sha256,source_pointer:item.row.source_pointer}};
    }else{
      const eligibility=numericEligibility(item.row);
      yield {row:{occurrence_id:item.row.occurrence_id,eligible:String(eligibility.eligible),
        reason:eligibility.reason??'eligible',method:'original-sensorthings-analysis-numericEligibility'}};
    }
  }
}
const HASH=/^[a-f0-9]{64}$/,OP=/^[A-Za-z0-9_-]{8,100}$/;
const sha=body=>createHash('sha256').update(body).digest('hex');
const error=(code,message)=>fault('ANALYSIS_PYTHON_'+code,message,409);
const noSecretsUrl=value=>{
  try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;
    u.search='';u.hash='';return u.href;} catch{return null;}
};
function counted(record,maximum){
  if(!record||!Number.isSafeInteger(record.bytes)||record.bytes<0||record.bytes>maximum||!HASH.test(record.sha256??''))
    throw error('FILE_IDENTITY','Select a complete original file within the existing Analysis source capacity.');
  return record;
}
async function retained(directory,record){
  counted(record,PYTHON_DOCUMENT_LIMITS.totalBytes);
  if(!/^files\/[a-f0-9]{64}\.(?:json|bin)$/.test(record.path??'')||record.path.split('/')[1].split('.')[0]!==record.sha256)
    throw error('CONTENT_ADDRESS','The prepared source file must retain its original content address.');
  await inspectRetainedFile(join(directory,record.path),{expectedBytes:record.bytes,expectedSha256:record.sha256,
    maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
}
async function publishTemp(directory,temporary,physical,extension,contentType){
  const relative='files/'+physical.sha256+'.'+extension,target=join(directory,relative);
  try {await link(temporary,target);await syncDir(dirname(target));}
  catch(e){if(e.code!=='EEXIST')throw e;
    await inspectRetainedFile(target,{expectedBytes:physical.bytes,expectedSha256:physical.sha256,
      maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});}
  await inspectRetainedFile(target,{expectedBytes:physical.bytes,expectedSha256:physical.sha256,
    maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
  // Only this completed temporary duplicate is retired; unfinished writes remain.
  await unlink(temporary);await syncDir(dirname(temporary));
  return {path:relative,...physical,contentType};
}
async function immutableBody(store,directory,body,extension='json',contentType='application/json'){
  const record={path:'files/'+sha(body)+'.'+extension,bytes:body.length,sha256:sha(body),contentType};
  await store.immutable(join(directory,record.path),body);await retained(directory,record);return record;
}
async function prepareTables(store,edition,directory){
  const temporary=join(directory,'tables-'+randomUUID()+'.partial'),file=await open(temporary,'wx',0o600),
    digest=createHash('sha256');let bytes=0,total=0;const tables={};
  const write=async value=>{
    const body=Buffer.from(value);bytes+=body.length;
    if(bytes>PYTHON_DOCUMENT_LIMITS.documentBytes)
      throw error('DOCUMENT_CAPACITY','The complete source-and-analysis document exceeds the original Analysis JSON document capacity of 32 MiB. All original source and unfinished output remain retained.');
    await file.writeFile(body);digest.update(body);
  };
  try {
    await write('{');
    for(let index=0;index<TABLES.length;index++){
      const table=TABLES[index],columns=projectedColumns(table);let count=0;
      if(!Array.isArray(columns)||!columns.length)throw error('TABLE_CONTRACT','The original SensorThings table columns are unavailable.');
      await write((index?',':'')+JSON.stringify(table)+':[');
      for await(const item of projectedRows(store,edition,table)){
        if(++total>PYTHON_DOCUMENT_LIMITS.rows)throw error('ROW_CAPACITY','The complete source projection exceeds the original Analysis row capacity.');
        const row={};
        for(const column of columns){
          if(typeof item.row[column]!=='string')throw error('SOURCE_CELL','The original projected source cell must remain exact text.');
          row[column]=item.row[column];
        }
        await write((count?',':'')+JSON.stringify(row));count++;
      }
      await write(']');tables[table]={collection:'/'+table,rows:count,columns:[...columns]};
    }
    await write('}\n');await file.sync();
  }finally{await file.close();}
  const document=await publishTemp(directory,temporary,{bytes,sha256:digest.digest('hex')},'json','application/json');
  return {document,tables};
}
async function retainArchive(store,directory,receipt){
  const record=counted(receipt.file,PYTHON_DOCUMENT_LIMITS.totalBytes);
  if(record.relativePath!=='exports/'+receipt.id+'/'+record.filename||!/^sensorthings-[a-f0-9]{16}-source\.ndjson\.gz$/.test(record.filename??''))
    throw error('ORIGINAL_EXPORT_PATH','Use the original complete source export receipt.');
  const held=await openPrivateFile(join(store.root,record.relativePath),{
    expectedBytes:record.bytes,maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
  const parts=[],whole=createHash('sha256');let position=0;
  try {
    while(position<record.bytes){
      const length=Math.min(PYTHON_DOCUMENT_LIMITS.archivePartBytes,record.bytes-position),
        buffer=Buffer.alloc(length);let received=0;
      while(received<length){
        const r=await held.handle.read(buffer,received,length-received,position+received);
        if(!r.bytesRead)throw error('SOURCE_TRUNCATED','The complete original source archive ended early.');
        received+=r.bytesRead;
      }
      whole.update(buffer);
      const part=await immutableBody(store,directory,buffer,'bin','application/octet-stream');
      parts.push({...part,role:'source-archive-part-'+String(parts.length+1).padStart(4,'0'),offset:position});
      position+=length;
      if(parts.length+3>PYTHON_DOCUMENT_LIMITS.originals)
        throw error('ORIGINALS_CAPACITY','The complete source archive exceeds the original Analysis document attachment capacity.');
    }
    if(whole.digest('hex')!==record.sha256)throw error('SOURCE_CHANGED','The complete original source archive changed during retention.');
    await hashHeldFile(held.handle,{expectedBytes:record.bytes,expectedSha256:record.sha256,
      maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
  }finally{await held.handle.close();}
  return {filename:record.filename,bytes:record.bytes,sha256:record.sha256,
    manifestSha256:receipt.manifestSha256,exportId:receipt.id,parts};
}
async function readCompleted(directory,expected){
  let raw;
  try {raw=await readOwned(join(directory,'python-source.json'),4*1024*1024);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  const record=JSON.parse(raw.toString('utf8'));
  for(const [key,value] of Object.entries(expected))
    if(stable(record[key])!==stable(value))throw error('REQUEST_REUSED','This prepared Python source belongs to another original selection.');
  if(record.schema!==PYTHON_SOURCE_SCHEMA||!Array.isArray(record.files))throw error('RECEIPT','The prepared source receipt differs.');
  for(const file of record.files){
    if(!/^(?:source\.json|intake\.json|files\/[a-f0-9]{64}\.(?:json|bin))$/.test(file.file??''))
      throw error('FILE_SELECTION','The prepared source contains an unexpected selected file.');
    await inspectRetainedFile(join(directory,file.file),{expectedBytes:file.bytes,expectedSha256:file.sha256,
      maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
  }
  return record;
}
/** Called by the ORIGINAL SensorThings reserve/complete owner.
 * exportReceipt is the returned edition.export result, whose id differs from
 * the caller's operationId. Every provider body and connector receipt remains
 * in that complete original archive. This function never captures or pays.
 */
export async function preparePythonSource(store,{edition,exportReceipt,id,createdAt}){
  if(!OP.test(id??'')||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))
    throw error('OPERATION','Use the retained original preparation identity and creation time.');
  validateSourceEdition(edition);
  if(exportReceipt?.schema!=='stellar-forge.sensorthings-transfer-receipt.v1'||
      exportReceipt.editionId!==edition.id||!OP.test(exportReceipt.id??''))
    throw error('ORIGINAL_EXPORT','Select the existing complete export of this exact source edition.');
  const saved=JSON.parse((await readOwned(join(store.root,'exports',exportReceipt.id,'transfer.json'),4*1024*1024)).toString('utf8'));
  if(stable(saved)!==stable(exportReceipt))throw error('ORIGINAL_EXPORT_CHANGED','The selected completed source export differs from its original receipt.');
  const reopened=await exportEdition(store,{edition,reviews:[],id:exportReceipt.id,createdAt:exportReceipt.createdAt});
  if(stable(reopened)!==stable(exportReceipt))throw error('ORIGINAL_EXPORT_CHANGED','The original source export did not reopen unchanged.');
  const relativeDirectory='analysis-python/'+id,directory=join(store.root,relativeDirectory);
  await privateDirectory(directory,{create:true});await privateDirectory(join(directory,'files'),{create:true});
  const expected={id,createdAt,editionId:edition.id,exportId:exportReceipt.id,
    exportSha256:exportReceipt.file.sha256,originalWorkspaceId:exportReceipt.originalWorkspaceId};
  const completed=await readCompleted(directory,expected);if(completed)return completed;
  const {document,tables}=await prepareTables(store,edition,directory),
    archive=await retainArchive(store,directory,exportReceipt),
    editionFile=await immutableBody(store,directory,json(edition)),
    exportFile=await immutableBody(store,directory,json(exportReceipt));
  const meaning={
    schema:'stellar-forge.sensorthings-python-meaning.v1',editionId:edition.id,scope:edition.scope,
    sourceLicense:edition.source.license,
    projection:'The unchanged SensorThings tableRows iterator produced all observations, components and entities; every projected cell remains a string. Two separately identified derived collections retain the original observation key/semantic hash and the original numericEligibility classification.',
    comparison:'The derived identity index uses original typed stream/observation keys and semantic hashes, including stream meaning and relationships. Duplicate keys remain ambiguous and missing keys remain unkeyed. An observed-only row is not labelled as provider insertion or deletion.',
    numericEligibility:'The original retained scalar analysis classifier selects explicitly declared numeric or count observations with original JSON-number results and explicit phenomenon instants that are representable by the original browser view. Its exact reason accompanies every observation. Original result text remains unchanged; mathematical summaries do not parse browser floats.',
    numbers:'Original numeric JSON lexemes remain text alongside declared observation type, result type/state, unit, source page hash, pointer and original observation JSON. Workbook cells preserve this source precision.',
    categories:'Categorical result codes are categories. Counts and observed adjacent code changes are descriptive; no duration, availability, occupancy or uptime is inferred.',
    components:'Multidatastream result positions retain original array indices and their declared type/property/unit associations. No implicit scalar conversion is performed.',
    time:'Original source time literals remain available with the original normalized UTC fields. Capture clocks and source-observed clocks remain distinct.',
    complete:'The complete retained edition/export closure is present. The document completion flag separately records whether the selected provider traversal finished; an atomic provider snapshot is not asserted.',
    sourceArchive:{...archive,parts:archive.parts.map(({offset,bytes,sha256,path})=>({offset,bytes,sha256,path}))}
  };
  const meaningFile=await immutableBody(store,directory,json(meaning));
  const originals=[
    ...archive.parts.map(({offset,...part})=>part),
    {...editionFile,role:'original-source-edition'},
    {...exportFile,role:'original-source-export-receipt'},
    {...meaningFile,role:'projection-and-source-interpretation'}
  ];
  const unique=new Map([document,...originals].map(r=>[r.path,r]));
  if(originals.length>PYTHON_DOCUMENT_LIMITS.originals||[...unique.values()].reduce((n,r)=>n+r.bytes,0)>PYTHON_DOCUMENT_LIMITS.totalBytes)
    throw error('TOTAL_CAPACITY','The complete source document and every original exceed the existing Analysis source capacity.');
  const sourceUrl=noSecretsUrl(edition.source.serviceUrl);
  const source={
    schema:'stellar-forge.analysis-source-document.v1',title:String(edition.plan.label||edition.source.label||'SensorThings source edition').slice(0,200),
    format:'json',document,originals,complete:edition.scope.traversalCompleted===true&&edition.scope.status==='SELECTED_QUERY_TRAVERSED',
    provenance:{kind:sourceUrl?'public-source':'operator-file',publisher:String(edition.source.label||'SensorThings source').slice(0,200),
      capturedAt:edition.createdAt,scope:('Original source edition '+edition.id+'; '+edition.scope.status).slice(0,500),
      description:'Complete immutable source edition '+edition.id+' from capture '+edition.captureId+'. The original query, request URLs, raw response bodies, connector receipts, metadata and source-license terms are retained in the complete source archive. All three original lossless table projections and two explicitly derived identity/classification tables are present. '+meaning.numbers+' '+meaning.categories,
      ...(sourceUrl?{sourceUrl}:{})}
  };
  const sourceBytes=json(source),sourceRecord={file:'source.json',bytes:sourceBytes.length,sha256:sha(sourceBytes),contentType:'application/json'};
  await store.immutable(join(directory,'source.json'),sourceBytes);
  const intake={schema:PYTHON_INTAKE_SCHEMA,...expected,source:sourceRecord,document,tables,archive,
    scope:edition.scope,comparisonScope:{source:edition.source.serviceUrl,streams:edition.plan.streams.map(x=>({kind:x.kind,url:x.url})),query:edition.plan.observationQuery},sourceLicense:edition.source.license,meaning:meaningFile,
    files:[sourceRecord,...[...unique.values()].map(({path,bytes,sha256,contentType})=>({file:path,bytes,sha256,contentType}))]};
  const intakeBytes=json(intake),intakeRecord={file:'intake.json',bytes:intakeBytes.length,sha256:sha(intakeBytes),contentType:'application/json'};
  await store.immutable(join(directory,'intake.json'),intakeBytes);
  const result={schema:PYTHON_SOURCE_SCHEMA,...expected,relativeDirectory,documentId:sourceRecord.sha256,
    tables,sourceComplete:source.complete,sourceArchive:{bytes:archive.bytes,sha256:archive.sha256,parts:archive.parts.length},
    files:[...intake.files,intakeRecord]};
  await store.immutable(join(directory,'python-source.json'),json(result));
  return await readCompleted(directory,expected);
}
export async function pythonSourceFile(store,record,file){
  if(record?.schema!==PYTHON_SOURCE_SCHEMA||!OP.test(record.id??'')||record.relativeDirectory!=='analysis-python/'+record.id)
    throw error('FILE_OWNER','Select a retained original Python source preparation.');
  const selected=record.files?.find(x=>x.file===file);
  if(!selected||!record.files.every(x=>/^(?:source\.json|intake\.json|files\/[a-f0-9]{64}\.(?:json|bin))$/.test(x.file??'')))
    throw error('FILE_SELECTION','Choose an existing exact prepared source file.');
  const path=join(store.root,record.relativeDirectory,selected.file);
  await inspectRetainedFile(path,{expectedBytes:selected.bytes,expectedSha256:selected.sha256,maximum:PYTHON_DOCUMENT_LIMITS.totalBytes});
  return {path,...selected,filename:basename(selected.file),mime:selected.contentType};
}
