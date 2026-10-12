// MIT. Complete portable workspace export, conflict-preserving merge and native reopen.
import { constants, createReadStream, openSync, readSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, lstat, link, rm, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { clone, now } from '../opensearch/workspace/store.mjs';
import { PROFILE_ID, normalizedDocument, data, fail, canonical, digest } from './core.mjs';
import { TABLES, TABLE_KEYS, MAX_PACKAGE_BYTES } from './workspace.mjs';

export const PACKAGE_SCHEMA='stellar-forge.supplier-orders-package.v1';
const SNAPSHOT_SCHEMA='stellar-forge.supplier-orders-snapshot.v1';
const MAX_LINE_BYTES=256*1024*1024,MAX_NATIVE_OUTPUT=40*1024*1024;
const PYTHON=fileURLToPath(new URL('./archive.py',import.meta.url));
const decode=row=>JSON.parse(row.record_json);
const withoutSeal=record=>{const {sha256,...value}=record;return value;};
const own=Object.prototype.hasOwnProperty;

function nativeArchive(mode,source,destination){
  return new Promise((resolve,reject)=>{
    const executable=process.env.STARFORGE_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
    const child=spawn(executable,[PYTHON,mode,source,destination],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const stdout=[],stderr=[];let out=0,err=0,fault=null,killTimer=null;
    const stop=error=>{if(!fault)fault=error;
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');if(!killTimer){killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);killTimer.unref?.();}}};
    child.on('error',error=>{if(!fault)fault=error;});
    child.stdout.on('data',chunk=>{out+=chunk.length;if(out>MAX_NATIVE_OUTPUT)stop(Object.assign(new Error('The complete package manifest exceeds the supported output size.'),{code:'ORDER_PACKAGE_MANIFEST_TOO_LARGE'}));else stdout.push(chunk);});
    child.stderr.on('data',chunk=>{const left=1024*1024-err;if(left>0){const part=chunk.subarray(0,left);stderr.push(part);err+=part.length;}});
    child.on('close',code=>{
      if(killTimer)clearTimeout(killTimer);
      if(fault){reject(fault);return;}
      if(code!==0){let detail;try{detail=JSON.parse(Buffer.concat(stderr).toString('utf8')).error;}catch{}
        const error=new Error(detail?.message??(Buffer.concat(stderr).toString('utf8')||'Native package operation failed.'));error.code=detail?.code??'ORDER_PACKAGE_NATIVE_FAILED';reject(error);return;}
      try{resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')));}catch(error){error.code='ORDER_PACKAGE_NATIVE_RESULT_INVALID';reject(error);}
    });
  });
}
function writeAll(fd,buffer){let offset=0;while(offset<buffer.length){const n=writeSync(fd,buffer,offset,buffer.length-offset);if(!n)fail('ORDER_PACKAGE_WRITE_FAILED','The complete workspace snapshot could not be written.',507);offset+=n;}}
function rowKey(table,row){return TABLE_KEYS[table].map(column=>row[column]);}
function lookup(db,table,row){
  const keys=TABLE_KEYS[table];return db.prepare('SELECT * FROM '+table+' WHERE '+keys.map(key=>key+'=?').join(' AND ')).get(...keys.map(key=>row[key]));
}
function futureBranchHistory(db,table,row){
  if(table==='supplier_order_history'){const current=db.prepare('SELECT revision FROM supplier_order_heads WHERE order_id=?').get(row.order_id);return current&&row.revision>current.revision;}
  if(table==='supplier_order_draft_history'){const current=db.prepare('SELECT revision FROM supplier_order_drafts WHERE id=?').get(row.draft_id);return current&&row.revision>current.revision;}
  return false;
}

function insert(db,table,row){
  const columns=TABLES[table];db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(column=>row[column]));
}
function completeRow(table,row){
  if(!own.call(TABLES,table)||!row||typeof row!=='object'||Array.isArray(row)||canonical(Object.keys(row).sort())!==canonical([...TABLES[table]].sort()))
    fail('ORDER_PACKAGE_ROW_INVALID','The package contains an unsupported complete workspace row.');
  for(const column of TABLES[table]){
    const value=row[column];if(column==='record_json'){if(typeof value!=='string')fail('ORDER_PACKAGE_RECORD_INVALID','Retain the full original record JSON.');}
    else if(['revision','sequence'].includes(column)){if(!Number.isSafeInteger(value)||value<1)fail('ORDER_PACKAGE_REVISION_INVALID','Retain the positive original revision or sequence.');}
    else if(typeof value!=='string'||value.includes('\0')||value.length>10000)fail('ORDER_PACKAGE_KEY_INVALID','Invalid original workspace key.');
  }
  let record;try{record=JSON.parse(row.record_json);}catch{fail('ORDER_PACKAGE_RECORD_INVALID','The complete record is not valid JSON.');}data(record);
  if(!record||typeof record!=='object'||Array.isArray(record))fail('ORDER_PACKAGE_RECORD_INVALID','Retain the complete original record object.');
  const idField=table==='supplier_order_heads'||table==='supplier_order_history'?'orderId':table==='supplier_order_draft_history'?'id':'id';
  const keyValue=table==='supplier_order_heads'||table==='supplier_order_history'?row.order_id:table==='supplier_order_draft_history'?row.draft_id:row.id;
  if(record[idField]!==keyValue)fail('ORDER_PACKAGE_KEY_DIFFERS','The row key differs from its complete original record.',422,{table,key:rowKey(table,row)});
  if(row.revision!==undefined&&record.revision!==row.revision||row.sequence!==undefined&&record.sequence!==row.sequence)
    fail('ORDER_PACKAGE_REVISION_DIFFERS','The row revision differs from its complete original record.');
  if(['supplier_order_documents','supplier_order_drafts','supplier_order_draft_history'].includes(table)&&digest(withoutSeal(record))!==record.sha256)
    fail('ORDER_PACKAGE_RECORD_CHANGED','The complete immutable document or draft differs from its saved seal.',422,{table,key:rowKey(table,row)});
  if(table==='supplier_order_documents'){
    normalizedDocument(record.document);
    if(record.kind!==row.kind||record.businessKey!==row.business_key)fail('ORDER_PACKAGE_DOCUMENT_DIFFERS','The indexed document identity differs from its original record.');
  }
  if(table==='supplier_order_selections'&&(record.orderId!==row.order_id||record.documentId!==row.document_id))fail('ORDER_PACKAGE_SELECTION_DIFFERS','The indexed selection differs from the original record.');
  if(table==='supplier_order_files'&&(!/^[a-f0-9]{64}$/.test(record.id)||record.id!==record.sha256||!Number.isSafeInteger(record.bytes)||record.bytes<0||record.kind!==row.kind))fail('ORDER_PACKAGE_FILE_INVALID','Invalid immutable complete file record.');
  if(table==='supplier_order_heads'||table==='supplier_order_history'){
    if(!Array.isArray(record.selectionIds)||record.selectionIds.some(id=>typeof id!=='string'))fail('ORDER_PACKAGE_CURRENT_SELECTION_INVALID','Retain the exact original current document-selection IDs.');
  }
  return record;
}
async function* lines(path){
  let pieces=[],length=0;
  for await(const chunk of createReadStream(path,{highWaterMark:1024*1024,flags:constants.O_RDONLY|constants.O_NOFOLLOW})){
    let start=0,index;
    while((index=chunk.indexOf(10,start))>=0){
      const part=chunk.subarray(start,index);pieces.push(part);length+=part.length;
      if(length>MAX_LINE_BYTES)fail('ORDER_PACKAGE_ROW_TOO_LARGE','A complete normalized workspace row exceeds 256 MiB.');
      yield Buffer.concat(pieces,length).toString('utf8');pieces=[];length=0;start=index+1;
    }
    if(start<chunk.length){const part=chunk.subarray(start);pieces.push(part);length+=part.length;if(length>MAX_LINE_BYTES)fail('ORDER_PACKAGE_ROW_TOO_LARGE','A complete normalized workspace row exceeds 256 MiB.');}
  }
  if(length)fail('ORDER_PACKAGE_SNAPSHOT_INCOMPLETE','The complete workspace snapshot must end with its original newline.');
}
function* synchronousLines(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),chunk=Buffer.allocUnsafe(1024*1024);
  let parts=[],length=0;
  try{
    for(;;){const count=readSync(fd,chunk,0,chunk.length,null);if(!count)break;let start=0;
      for(let end=0;end<count;end++)if(chunk[end]===10){
        const part=Buffer.from(chunk.subarray(start,end));parts.push(part);length+=part.length;
        if(length>MAX_LINE_BYTES)fail('ORDER_PACKAGE_ROW_TOO_LARGE','A complete workspace row exceeds 256 MiB.');
        yield Buffer.concat(parts,length).toString('utf8');parts=[];length=0;start=end+1;}
      if(start<count){const part=Buffer.from(chunk.subarray(start,count));parts.push(part);length+=part.length;if(length>MAX_LINE_BYTES)fail('ORDER_PACKAGE_ROW_TOO_LARGE','A complete workspace row exceeds 256 MiB.');}}
    if(length)fail('ORDER_PACKAGE_SNAPSHOT_INCOMPLETE','The complete snapshot has no final newline.');
  }finally{closeSync(fd);}
}

async function hashFile(path){
  const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW})){hash.update(part);bytes+=part.length;}
  return{bytes,sha256:hash.digest('hex')};
}
export async function writeSupplierOrderPackage(workspace,output){
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  const temporary=await mkdtemp(join(workspace.root,'incoming','export-')),snapshot=join(temporary,'workspace.jsonl');
  const fileSources={},fileRecords=new Map(),counts={},hash=createHash('sha256');let bytes=0,header;
  const fd=openSync(snapshot,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{
    workspace.store.transaction(()=>{
      header={schema:SNAPSHOT_SCHEMA,profileId:PROFILE_ID,workspaceId:workspace.store.id,supplierIdentity:workspace.supplierIdentity(),createdAt:now(),tables:TABLES,keys:TABLE_KEYS};
      const append=value=>{const chunk=Buffer.from(JSON.stringify(value)+'\n');if(chunk.length>MAX_LINE_BYTES)fail('ORDER_PACKAGE_ROW_TOO_LARGE','A complete normalized workspace row exceeds 256 MiB.');bytes+=chunk.length;if(bytes>MAX_PACKAGE_BYTES)fail('ORDER_PACKAGE_TOO_LARGE','The complete workspace exceeds 8 GiB.');hash.update(chunk);writeAll(fd,chunk);};
      append({header});
      for(const [table,columns] of Object.entries(TABLES)){
        counts[table]=0;
        const where=table==='supplier_order_files'?" WHERE kind<>'package'":'';
        const statement=workspace.db.prepare('SELECT '+columns.join(',')+' FROM '+table+where+' ORDER BY '+TABLE_KEYS[table].join(','));
        for(const row of statement.iterate()){append({table,row});counts[table]++;
          if(table==='supplier_order_files'){const record=decode(row);fileRecords.set(record.id,record);fileSources['files/'+record.sha256+'.bin']=join(workspace.root,'files',record.sha256+'.bin');}}
      }
      counts.operations=0;
      for(const row of workspace.db.prepare("SELECT record_json FROM operations WHERE kind LIKE 'supplier-orders-%' ORDER BY created_at,id").iterate()){
        append({operation:JSON.parse(row.record_json)});counts.operations++;}
      append({end:{workspaceId:header.workspaceId,tableCounts:counts}});
    });
    fsyncSync(fd);
  }finally{closeSync(fd);}
  try{
    const entries=[{path:'workspace.jsonl',bytes,sha256:hash.digest('hex')}];
    for(const record of [...fileRecords.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256))){
      const path=fileSources['files/'+record.sha256+'.bin'],info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size!==record.bytes)fail('ORDER_PACKAGE_FILE_CHANGED','An original complete source file is unavailable.',409,{fileId:record.id});
      entries.push({path:'files/'+record.sha256+'.bin',bytes:record.bytes,sha256:record.sha256});
    }
    const totalBytes=entries.reduce((sum,entry)=>sum+entry.bytes,0);if(totalBytes>MAX_PACKAGE_BYTES)fail('ORDER_PACKAGE_TOO_LARGE','The complete workspace exceeds 8 GiB.');
    const manifest={schema:PACKAGE_SCHEMA,profileId:PROFILE_ID,workspaceId:header.workspaceId,supplierIdentity:header.supplierIdentity,createdAt:header.createdAt,tableCounts:counts,totalBytes,entries,
      retention:{originalSources:'complete',documents:'all revisions',drafts:'all revisions',currentSelections:'exact ordered IDs',foreignHistory:'complete',generatedPackageFiles:'regenerated; archive files are not nested'}};
    const descriptor=join(temporary,'descriptor.json');await writeFile(descriptor,JSON.stringify({manifest,sources:{'workspace.jsonl':snapshot,...fileSources}}),{flag:'wx',mode:0o600});
    return await nativeArchive('pack',descriptor,output);
  }finally{await rm(temporary,{recursive:true,force:true});}
}
function supplierMatches(workspace,identity){
  const current=workspace.supplierIdentity();return !current||!identity||current.value===identity.value;
}
function retainForeign(workspace,{table,row,sourceWorkspaceId,packageSha256,reason}){
  const original={sourceWorkspaceId,sourceTable:table,originalKey:table==='operations'?[row.id]:rowKey(table,row),originalRow:clone(row)};
  const id=digest(original);
  if(workspace.db.prepare('SELECT id FROM supplier_order_foreign_records WHERE id=?').get(id))return id;
  const record={id,...original,packageSha256,reason,receivedAt:now()};
  insert(workspace.db,'supplier_order_foreign_records',{id,source_workspace:sourceWorkspaceId,source_table:table,record_json:JSON.stringify(record)});return id;
}
export async function readSupplierOrderPackage(workspace,path,{mode='merge',requestId,packageSha256}={}){
  if(!['merge','inspect'].includes(mode))fail('ORDER_PACKAGE_MODE_INVALID','Choose merge or inspect.');
  const directory=await mkdtemp(join(workspace.root,'incoming','receive-'));
  try{
    const {manifest}=await nativeArchive('unpack',path,directory),snapshot=join(directory,'workspace.jsonl');
    const incomingFiles=new Map(manifest.entries.filter(entry=>entry.path.startsWith('files/')).map(entry=>[entry.sha256,entry]));
    const seen=new Set(),counts={},documents=new Set(),selections=new Map(),heads=[],sources=[],drafts=[];
    let header=null,ended=false,totalRows=0,operationCount=0;
    const plan={mode,sourceWorkspaceId:manifest.workspaceId,workspaceId:workspace.store.id,packageSha256,added:{},preserved:{},foreign:{},operations:0,canMerge:true};
    for await(const line of lines(snapshot)){
      let value;try{value=JSON.parse(line);}catch{fail('ORDER_PACKAGE_SNAPSHOT_INVALID','The complete workspace snapshot contains invalid JSON.');}
      if(!header){
        header=value.header;if(!header||header.schema!==SNAPSHOT_SCHEMA||header.profileId!==PROFILE_ID||header.workspaceId!==manifest.workspaceId||canonical(header.tables)!==canonical(TABLES)||canonical(header.keys)!==canonical(TABLE_KEYS)||canonical(header.supplierIdentity)!==canonical(manifest.supplierIdentity))fail('ORDER_PACKAGE_HEADER_INVALID','The complete snapshot does not match the package manifest.');
        plan.canMerge=supplierMatches(workspace,header.supplierIdentity);continue;
      }
      if(ended)fail('ORDER_PACKAGE_SNAPSHOT_TRAILING','Unexpected data after the complete snapshot end.');
      if(value.end){ended=true;if(value.end.workspaceId!==header.workspaceId||canonical(value.end.tableCounts)!==canonical(manifest.tableCounts))fail('ORDER_PACKAGE_COUNTS_DIFFER','The complete snapshot and manifest disagree.');continue;}
      if(value.operation){data(value.operation);if(typeof value.operation.id!=='string'||!String(value.operation.kind).startsWith('supplier-orders-'))fail('ORDER_PACKAGE_OPERATION_INVALID','Retain only original supplier-order operations.');operationCount++;plan.operations++;continue;}
      const {table,row}=value,record=completeRow(table,row),key=canonical([table,rowKey(table,row)]);
      if(seen.has(key))fail('ORDER_PACKAGE_DUPLICATE_ROW','The complete snapshot repeats an original table key.');seen.add(key);totalRows++;counts[table]=(counts[table]??0)+1;
      const existing=lookup(workspace.db,table,row);
      if(futureBranchHistory(workspace.db,table,row))plan.foreign[table]=(plan.foreign[table]??0)+1;
      else if(!existing)plan.added[table]=(plan.added[table]??0)+1;
      else if(canonical(existing)===canonical(row))plan.preserved[table]=(plan.preserved[table]??0)+1;
      else plan.foreign[table]=(plan.foreign[table]??0)+1;
      if(table==='supplier_order_documents'){
        documents.add(record.id);sources.push(record.source);
        const issuer=record.document.header.supplierId;if(issuer&&issuer!==header.supplierIdentity?.value)fail('ORDER_PACKAGE_SUPPLIER_DIFFERS','A document issuer differs from the original package supplier.');
      }
      if(table==='supplier_order_sources')sources.push(record);
      if(table==='supplier_order_selections')selections.set(record.id,{orderId:record.orderId,documentId:record.documentId});
      if(table==='supplier_order_heads'||table==='supplier_order_history')heads.push({orderId:record.orderId,documentId:record.documentId,selectionIds:record.selectionIds});
      if(table==='supplier_order_drafts'||table==='supplier_order_draft_history')drafts.push({orderIds:record.orderIds,sourceOrderDocuments:record.sourceOrderDocuments});
      if(table==='supplier_order_files'){
        const entry=incomingFiles.get(record.sha256);if(record.kind==='package'||!entry||entry.bytes!==record.bytes)fail('ORDER_PACKAGE_FILE_MISSING','The complete original file record has no matching archive member.');
      }
    }
    if(!ended)fail('ORDER_PACKAGE_SNAPSHOT_INCOMPLETE','The complete workspace snapshot has no end record.');
    for(const table of Object.keys(TABLES))counts[table]=counts[table]??0;counts.operations=operationCount;
    if(canonical(counts)!==canonical(manifest.tableCounts))fail('ORDER_PACKAGE_COUNTS_DIFFER','The complete retained row count differs from the manifest.');
    for(const source of sources){const file=incomingFiles.get(source.sha256);if(!file||file.bytes!==source.bytes||source.fileId!==source.sha256)fail('ORDER_PACKAGE_ORIGINAL_MISSING','An original document source is absent from this complete package.');}
    for(const head of heads){if(!documents.has(head.documentId))fail('ORDER_PACKAGE_ORIGINAL_MISSING','A retained order selection has no original ORDER document.');
      for(const id of head.selectionIds){const selection=selections.get(id);if(!selection||selection.orderId!==head.orderId||!documents.has(selection.documentId))fail('ORDER_PACKAGE_SELECTION_MISSING','A retained order selection is missing its complete original document.');}}
    for(const selection of selections.values())if(!documents.has(selection.documentId))fail('ORDER_PACKAGE_DOCUMENT_MISSING','A retained selection document is absent.');
    for(const draft of drafts)for(const original of draft.sourceOrderDocuments??[])if(!documents.has(original.id))fail('ORDER_PACKAGE_DRAFT_SOURCE_MISSING','A saved draft is missing an original source order.');
    plan.rows=totalRows;plan.files=incomingFiles.size;plan.tableCounts=counts;
    if(mode==='inspect')return{schema:'stellar-forge.supplier-orders-receiving.v1',...plan};
    if(!plan.canMerge)fail('ORDER_PACKAGE_SUPPLIER_DIFFERS','This package belongs to a different original supplier. Receive it into that supplier’s workspace.',409,{workspaceSupplier:workspace.supplierIdentity(),incomingSupplier:header.supplierIdentity});
    for(const [sha,entry] of incomingFiles){
      const original=join(directory,entry.path),destination=join(workspace.root,'files',sha+'.bin');
      try{await link(original,destination);}catch(error){if(error.code!=='EEXIST')throw error;const current=await lstat(destination);if(!current.isFile()||current.isSymbolicLink())fail('ORDER_PACKAGE_FILE_CONFLICT','A retained file path is not an original regular file.',409);const check=await hashFile(destination);if(check.bytes!==entry.bytes||check.sha256!==sha)fail('ORDER_PACKAGE_FILE_CONFLICT','A retained complete file differs from its original identity.',409);}
    }
    const folder=await open(join(workspace.root,'files'),'r');try{await folder.sync();}finally{await folder.close();}
    // Merge the already validated original stream in one transaction without a second SQLite copy.
    return workspace.store.transaction(()=>{
        if(!supplierMatches(workspace,header.supplierIdentity))fail('ORDER_PACKAGE_SUPPLIER_DIFFERS','The workspace supplier changed while this complete package was being received.',409);
        if(!workspace.supplierIdentity()&&header.supplierIdentity)workspace.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('supplier_order_issuer',JSON.stringify(header.supplierIdentity));
        const result={schema:'stellar-forge.supplier-orders-receiving.v1',...plan,added:{},preserved:{},foreign:{},foreignRecordIds:[],receivedAt:now(),currentState:'Existing current order selections and drafts preserved; absent records imported.'};
        const touchedOrders=new Set(),touchedDocuments=new Set();
        for(const line of synchronousLines(snapshot)){
          const value=JSON.parse(line);if(!value.row&&!value.operation)continue;
          if(value.operation){result.foreignRecordIds.push(retainForeign(workspace,{table:'operations',row:value.operation,sourceWorkspaceId:header.workspaceId,packageSha256,reason:'Original operation history retained; receiving does not restart its producer.'}));continue;}
          const {table,row}=value,existing=lookup(workspace.db,table,row);
          if(futureBranchHistory(workspace.db,table,row)){result.foreignRecordIds.push(retainForeign(workspace,{table,row,sourceWorkspaceId:header.workspaceId,packageSha256,reason:'Incoming later history belongs to another branch; current operator can continue its own revision sequence.'}));result.foreign[table]=(result.foreign[table]??0)+1;}
          else if(!existing){insert(workspace.db,table,row);result.added[table]=(result.added[table]??0)+1;
            if(table==='supplier_order_heads')touchedOrders.add(row.order_id);if(table==='supplier_order_documents')touchedDocuments.add(row.id);}
          else if(canonical(existing)===canonical(row))result.preserved[table]=(result.preserved[table]??0)+1;
          else{const foreignId=retainForeign(workspace,{table,row,sourceWorkspaceId:header.workspaceId,packageSha256,reason:['supplier_order_heads','supplier_order_drafts'].includes(table)?'Retained incoming branch; existing operator current state preserved.':'Retained complete divergent original history.'});result.foreign[table]=(result.foreign[table]??0)+1;result.foreignRecordIds.push(foreignId);}
        }
        for(const id of touchedDocuments)workspace.indexDocument(workspace.document({id}));
        for(const id of touchedOrders)workspace.indexOrder(id);
        const id=digest([packageSha256,header.workspaceId,workspace.store.id,requestId]),record={id,...result};
        insert(workspace.db,'supplier_order_receivings',{id,created_at:result.receivedAt,record_json:JSON.stringify(record)});
        return record;
      });
  }finally{await rm(directory,{recursive:true,force:true});}
}
