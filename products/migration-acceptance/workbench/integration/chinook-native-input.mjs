// SPDX-License-Identifier: MIT
// Additive intake for E496's complete source. Original product retains all native execution.
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {parseExactJSON} from '../vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs';
import {atomicJson,identity} from '../vendor/dlt/vendor/sling/core/common.mjs';
import {compilePipeline} from '../vendor/dlt/pipeline/plan.mjs';
export const SOURCE_COMMIT='7f67772503d71ba90f19283c38e93923addb43fa';
export const TABLES=['Album','Artist','Customer','Employee','Genre','Invoice','InvoiceLine','MediaType','Playlist','PlaylistTrack','Track'];
const UPSTREAM_PINS=[{"path":"upstream/ChinookDatabase/DataSources/Chinook_PostgreSql.sql","bytes":600200,"sha256":"e3fde5c1a5b51a2a91429a702c9ca6e69ba56e6c7f5e112724d70c3d03db695e"},{"path":"upstream/ChinookDatabase/DataSources/Chinook_Sqlite.sql","bytes":595545,"sha256":"caf31d698a4a79c628215b552dfe6575e71be052ae02b8f18e763498f55f5d44"},{"path":"upstream/LICENSE.md","bytes":1117,"sha256":"5064d720db431474b0a0b0cef9d2b5e362b6c6f80602b35c6443b07cbc979f77"},{"path":"upstream/README.md","bytes":3183,"sha256":"f8c04f76f7887110731e4cb2286dcb9de4b23db99b88c0ca548652b8cafebd9c"},{"path":"upstream/ChinookDatabase/DataSources/ChinookData.json","bytes":1897482,"sha256":"2998161de437518e3447e779c7ce7418f081895e388081bff315f3c258752d8c"},{"path":"upstream/ChinookDatabase/DataSources/ChinookDataSet.xsd","bytes":38540,"sha256":"e1921f1af7480f6face77cb54ab4aff5a16824c422f79a14ad9d932af46ed042"},{"path":"upstream/ChinookDatabase/DataSources/ChinookDatabase.tt","bytes":15877,"sha256":"4aaa7c745846c74e1284fcf466eba4c89f2e53de107bd3c3e15700c9216b9ede"},{"path":"upstream/ChinookDatabase/DdlStrategies/AbstractDdlStrategy.cs","bytes":4691,"sha256":"19846fc510019f077ae715a48f42842cb1ad996bf6c1258f9f774cb73ba28aa8"},{"path":"upstream/ChinookDatabase/DdlStrategies/SqliteStrategy.cs","bytes":2012,"sha256":"9af24399ae22442c0ac2a8ea18389667596ee15cfa8ee55617087fcf7a237694"},{"path":"upstream/ChinookDatabase/Utilities/DataSetHelper.cs","bytes":2482,"sha256":"0926104dfe90ea68f20809ed85c6e2cc22a1e78d794fc033b73c1e3a70932a50"}];
const SHA=/^[a-f0-9]{64}$/;
export function check(ok,message){if(!ok)throw new Error(message);}
export function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
export function json(value){return JSON.stringify(value,null,2)+'\n';}
export function pin(bytes){return {bytes:bytes.length,sha256:hash(bytes)};}
export function normalizedName(name){check(typeof name==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(name),'Explicit original Chinook identifier required.');
  const value=name.replace(/([A-Z]+)([A-Z][a-z])/g,'$1_$2').replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
  check(/^[a-z][a-z0-9_]{0,62}$/.test(value),'Mapped native identifier is outside the maintained engine contract.');return value;}
export function columnType(column){
  const t=column.declaredType.toUpperCase();
  if(t.includes('INT'))return {data_type:'bigint',cellType:'integer'};
  const d=/^NUMERIC\((\d+),(\d+)\)$/.exec(t);
  if(d){check(d[1]==='10'&&d[2]==='2','Retain the original declared reference monetary domain.');return {data_type:'decimal',cellType:'decimal',precision:10,scale:2};}
  check(t==='DATETIME'||/^(?:N?VARCHAR|N?CHAR|TEXT)(?:\(\d+\))?$/.test(t),'Unreviewed original source type: '+t);
  // Original worker coerce(timestamp) assigns UTC to naive text. Local timestamps stay text.
  return {data_type:'text',cellType:'text'};
}
function typed(value,column){
  if(value===null){check(column.nullable&&!column.primaryKeyOrder,'Null in a required original field.');return {type:'null'};}
  const type=columnType(column).cellType;check(typeof value==='string','Reference scalar must remain exact original text or numeric token.');
  if(type==='integer')check(/^-?(?:0|[1-9]\d*)$/.test(value),'Invalid exact integer token.');
  if(type==='decimal')check(/^-?\d{1,8}\.\d{2}$/.test(value),'Invalid original NUMERIC(10,2) value.');
  return {type,value};
}
function safePath(path){check(typeof path==='string'&&path!==''&&!path.includes('\\')&&!path.startsWith('/')&&path.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe original source member.');return path;}
function descriptor(source){return {path:source.path,bytes:source.bytes,sha256:source.sha256};}
/** Takes complete bytes retained by original E496 receiver, not an inferred source snapshot. */
export function prepareReference({manifestBytes,files}){
  check(Buffer.isBuffer(manifestBytes)&&files instanceof Map,'Supply original manifest bytes and all original member buffers.');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  check(manifest.schema==='commons.complete-original-source-delivery.v1'&&manifest.sourceCommit===SOURCE_COMMIT,'Select the original complete Chinook receiving manifest.');
  check(typeof manifest.operationId==='string'&&Array.isArray(manifest.files),'Original source operation identity is missing.');
  const members=new Map();
  for(const d of manifest.files){safePath(d.path);check(!members.has(d.path)&&Number.isSafeInteger(d.bytes)&&d.bytes>=0&&SHA.test(d.sha256),'Original manifest member is invalid or repeated.');
    const raw=files.get(d.path);check(Buffer.isBuffer(raw)&&raw.length===d.bytes&&hash(raw)===d.sha256,'Complete original member mismatch: '+d.path);members.set(d.path,{...descriptor(d),raw});}
  check(files.size===members.size,'Unselected source bytes must not enter the complete received cohort.');
  for(const d of UPSTREAM_PINS){const f=members.get(d.path);check(f&&f.bytes===d.bytes&&f.sha256===d.sha256,'Pinned complete upstream source differs: '+d.path);}
  const read=path=>{check(members.has(path),'Original receiving is missing '+path);return members.get(path).raw.toString('utf8');};
  const schema=JSON.parse(read('SCHEMA.json')),result=JSON.parse(read('SOURCE_RECEIVING_RESULT.json')),contract=JSON.parse(read('MIGRATION_ACCEPTANCE_CONTRACT.json'));
  check(schema.schema==='commons.original-relational-schema.v1'&&schema.sourceCommit===SOURCE_COMMIT,'Original relational schema differs.');
  check(result.status==='SOURCE_RECEIVED'&&result.operationId===manifest.operationId&&result.sourceCommit===SOURCE_COMMIT,'Source SQLite receiving must actually complete before preparing target input.');
  check(result.unexpectedDifferenceCount===0&&result.foreignKeyViolationCount===0&&result.unbalancedInvoiceCount===0&&JSON.stringify(result.integrityCheck)==='["ok"]','Original SQLite source has unresolved findings.');
  check(contract.schema==='commons.migration.reference-acceptance-contract.v1'&&contract.sourceBasis==='published-upstream-SQLite-edition'&&contract.sourceCommit===SOURCE_COMMIT,'Keep the original SQL-edition comparison boundary.');
  check(Array.isArray(schema.tables)&&schema.tables.length===11&&JSON.stringify(schema.tables.map(x=>x.table).sort())===JSON.stringify(TABLES),'Keep all eleven original source objects.');
  check(JSON.stringify(contract.tables)===JSON.stringify(schema.tables),'Acceptance contract and actual schema differ.');
  const tables=[],generated=[];
  for(const table of schema.tables){
    check(Array.isArray(table.columns)&&table.columns.length&&Array.isArray(table.primaryKey)&&table.primaryKey.length,'Keep original complete columns and ordered keys.');
    const names=table.columns.map(c=>c.name),mapped=names.map(normalizedName);
    check(new Set(names).size===names.length&&new Set(mapped).size===mapped.length,'Column mapping collapses original fields.');
    check(table.primaryKey.every(k=>names.includes(k)),'Original primary key selects an absent column.');
    const path='tables/native/'+table.table+'.jsonl',source=members.get(path);check(source,'Actual SQLite full table is missing.');
    const lines=source.raw.toString('utf8').split('\n');if(lines.at(-1)==='')lines.pop();
    check(lines.every(x=>x.trim().length),'Unexpected empty source record.');
    const rows=lines.map((line,index)=>{const row=parseExactJSON(line);check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===names.length&&names.every(n=>Object.hasOwn(row,n)),'Complete source field set differs at '+table.table+'/'+index);
      return table.columns.map(c=>typed(row[c.name],c));});
    const summary=result.tables.find(x=>x.table===table.table);
    check(summary&&summary.rows===rows.length&&summary.nativeJsonlSha256===source.sha256,'Original observed table count or hash differs.');
    const expected={schema:'dlthub.expected-table.v1',table:normalizedName(table.table),complete:true,rowCount:rows.length,
      columns:table.columns.map(c=>({name:c.name,type:c.declaredType,nullable:c.nullable,originalDeclaredType:c.declaredType})),rows,
      sourceBoundary:{sourceCommit:SOURCE_COMMIT,operationId:manifest.operationId,path,sha256:source.sha256,bytes:source.bytes,mode:'full published SQLite population; no target-derived expected rows'}};
    const raw=Buffer.from(json(expected)),out={path:'expected/'+table.table+'.json',raw,...pin(raw)};
    generated.push(out);
    tables.push({originalTable:table.table,nativeTable:normalizedName(table.table),schema:table,source:descriptor(source),expected:descriptor(out),rowCount:rows.length,
      fieldMap:Object.fromEntries(names.map((n,i)=>[n,mapped[i]]))});
  }
  check(tables.reduce((n,t)=>n+t.rowCount,0)===result.totalRows,'Complete source total differs.');
  const outputPaths=['DELIVERY_MANIFEST.json',...members.keys(),...generated.map(f=>f.path),'integration/REFERENCE_BINDING.json','integration/INTAKE_REQUESTS.json'];
  check(new Set(outputPaths).size===outputPaths.length,'Generated supporting paths collide with original received members.');
  const binding={schema:'definian.chinook-native-input.v1',sourceCommit:SOURCE_COMMIT,sourceOperationId:manifest.operationId,
    sourceManifest:{path:'DELIVERY_MANIFEST.json',...pin(manifestBytes)},sourceFiles:[...members.values()].map(descriptor),tables,
    sourceMeaning:'Published Chinook reference; fictitious customers/employees and generated sales, not Definian customer data.',
    decisions:[{id:'explicit-source-to-native-identifiers',rule:'Recorded original column to normalized dlt column map; values and keys unchanged.'},
      {id:'source-local-datetime-as-text',rule:'Preserve source-local DATETIME text exactly; no timezone inferred or injected.'},
      {id:'declared-decimal10-scale2',rule:'Original decimal strings decoded by the maintained worker to Decimal and native DECIMAL(10,2).'},
      {id:'complete-populations',rule:'No filter, deduplication, case fold, trim, implicit null conversion or generated target population.'}],
    originalContract:members.get('MIGRATION_ACCEPTANCE_CONTRACT.json').sha256,
    originalLineage:descriptor(members.get('SOURCE_TO_NATIVE_LINEAGE.jsonl')),
    originalTransformations:descriptor(members.get('GENERATOR_TRANSFORMATIONS.jsonl')),
    originalInvoiceControls:descriptor(members.get('controls/INVOICE_CONTROL_POPULATION.json')),
    originalGroupedControls:descriptor(members.get('controls/GROUPED_EXACT_CONTROLS.json'))};
  binding.bindingSha256=hash(Buffer.from(json(binding)));
  return {binding,files:[{path:'DELIVERY_MANIFEST.json',raw:manifestBytes,...pin(manifestBytes)},...[...members.values()],...generated],
    sourceInvoiceControls:JSON.parse(read('controls/INVOICE_CONTROL_POPULATION.json')),sourceGroupedControls:JSON.parse(read('controls/GROUPED_EXACT_CONTROLS.json'))};
}
/** Read-only: verifies regular files, complete path closure, and before/after identity. */
export function readReferenceDirectory(directory){
  const root=resolve(directory);check(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink()&&realpathSync(root)===root,'Use the original non-symlink reference directory.');
  function read(path){safePath(path);const full=join(root,path);let cursor=root;for(const part of path.split('/')){cursor=join(cursor,part);check(!lstatSync(cursor).isSymbolicLink(),'Source path contains a symbolic link.');}
    check(relative(root,realpathSync(full)).split(sep)[0]!=='..','Source member leaves the original root.');
    const before=lstatSync(full);check(before.isFile(),'Original source member must be a regular file.');const raw=readFileSync(full),after=lstatSync(full);
    check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&raw.length===after.size,'Source changed while reading.');return raw;}
  const manifestBytes=read('DELIVERY_MANIFEST.json'),manifest=JSON.parse(manifestBytes.toString('utf8')),files=new Map();
  check(Array.isArray(manifest.files),'Original source manifest lacks its inventory.');for(const d of manifest.files){check(!files.has(d.path),'Repeated original source path.');files.set(d.path,read(d.path));}
  return prepareReference({manifestBytes,files});
}
/** Bind only actual retained original source IDs returned by the existing product. */
export function buildPipelineInput(prepared,{sourceIds,expectedSourceIds,pipelineName,datasetName,title='Chinook complete relational reference',phase='baseline'}){
  check(prepared?.binding?.schema==='definian.chinook-native-input.v1','Select complete prepared reference input.');
  const resources=[],acceptance=[];
  for(const t of prepared.binding.tables){
    const sourceId=sourceIds[t.originalTable],expectedSourceId=expectedSourceIds[t.originalTable];
    check(typeof sourceId==='string'&&typeof expectedSourceId==='string'&&sourceId!==expectedSourceId,'Supply the actual source and independently prepared expected IDs for every object.');
    resources.push({name:t.nativeTable,tableName:t.nativeTable,sourceId,format:'ndjson',fieldMap:t.fieldMap,
      columns:t.schema.columns.map(c=>{const {cellType,...hint}=columnType(c);return {name:t.fieldMap[c.name],...hint,nullable:c.nullable&&!c.primaryKeyOrder};}),
      primaryKey:t.schema.primaryKey.map(k=>t.fieldMap[k]),writeDisposition:'replace',schemaContract:{tables:'evolve',columns:'freeze',data_type:'freeze'},maxTableNesting:0,
      notes:'Complete original '+t.originalTable+' at '+t.source.sha256+'; source-local dates stay text.'});
    acceptance.push({table:t.nativeTable,expectedSourceId,primaryKey:t.schema.primaryKey.map(k=>t.fieldMap[k]),
      columns:t.schema.columns.map(c=>({name:t.fieldMap[c.name],left:c.name,right:t.fieldMap[c.name],cellType:columnType(c).cellType})),ignoredRightColumns:['_dlt_load_id','_dlt_id']});
  }
  const input={schema:'dlthub.pipeline-input.v1',pipelineName,datasetName,title,phase,resources,acceptance,
    limits:{maxRows:Math.max(1,...prepared.binding.tables.map(t=>t.rowCount)),maxBytes:536870912,workers:1},
    sourceBoundary:'Complete original SQLite populations from E496; original JSON/generator transformations remain separately retained.',
    sourceEvidence:[{kind:'definian-reference-input-binding',...prepared.binding}],notes:'Prepared native mapping only. Original operator reviews, runs and decides acceptance.'};
  // Invoke the maintained production compiler now; do not introduce an alternate plan language.
  const compiled=compilePipeline(input);check(compiled.ready,'Original pipeline compiler requires further review.');
  return {input,compiled};
}

/** Called inside the original owner's already-open Workspace lease. Never opens a second writer or starts a native job. */
export async function retainReferenceInputs(workspace,actor,{projectId,operationId,prepared}){
  check(typeof operationId==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(operationId),'Use one original stable intake operation ID.');
  check(workspace.store.exists(projectId),'Select the existing original product project.');
  const {bindingSha256,...body}=prepared.binding;check(hash(Buffer.from(json(body)))===bindingSha256,'Prepared source mapping changed.');
  // A completed intake travels as a normal immutable source in the original archive.
  // Adopt its exact original requests on a portable reopen; never reconstruct old revision guards.
  const current=workspace.store.get(projectId);
  for(const candidate of current.sources.filter(x=>x.role==='definian-intake-requests')){
    const raw=workspace.store.objects.read(candidate.sha256,candidate.bytes);
    check(raw.length===candidate.bytes&&hash(raw)===candidate.sha256,'Retained intake journal bytes differ.');
    const ledger=JSON.parse(raw.toString('utf8'));
    if(ledger.operationId!==operationId||ledger.projectId!==projectId)continue;
    check(ledger.schema==='definian.original-source-retention.v1'&&ledger.mappingSha256===bindingSha256,'Original intake operation selects another source edition.');
    const expectedFiles=[...prepared.files,{path:'integration/REFERENCE_BINDING.json',raw:Buffer.from(json(prepared.binding))}];
    check(Array.isArray(ledger.receipts)&&ledger.receipts.length===expectedFiles.length,'Retained intake request set is incomplete.');
    const byPath=Object.create(null);
    for(let i=0;i<expectedFiles.length;i++){
      const f=expectedFiles[i],r=ledger.receipts[i],actual=pin(f.raw);
      check(r.path===f.path&&r.source.sha256===actual.sha256&&r.source.bytes===actual.bytes&&r.request.projectId===projectId&&r.intent.operationId===operationId,'Retained original intake request selection differs.');
      const original=workspace.store.request(actor.id,r.request.requestId,r.request);
      check(original&&original.result.sourceId===r.source.id&&original.view.revision===r.result.revision,'Original saved intake request is absent or differs.');
      const selected=current.sources.find(x=>x.id===r.source.id);
      check(selected&&selected.sha256===actual.sha256&&selected.bytes===actual.bytes,'Received original source is missing.');
      byPath[f.path]=r.source.id;
    }
    const sourceIds={},expectedSourceIds={};for(const t of prepared.binding.tables){sourceIds[t.originalTable]=byPath[t.source.path];expectedSourceIds[t.originalTable]=byPath[t.expected.path];}
    return {schema:'definian.original-product-input-binding.v1',workspaceInstanceId:workspace.store.instanceId,sourceWorkspaceInstanceId:ledger.workspaceInstanceId,projectId,operationId,mappingSha256:bindingSha256,
      sourceIds,expectedSourceIds,bindingSourceId:byPath['integration/REFERENCE_BINDING.json'],ledgerSourceId:candidate.id,receipts:ledger.receipts,byPath,nativeJobStarted:false,completedOriginalIntakeAdopted:true};
  }
  const receipts=[],byPath=Object.create(null);
  async function retain(file,role){
    check(file.raw.length===file.bytes&&hash(file.raw)===file.sha256,'Source bytes changed before original retention.');
    const requestId='definian_'+identity({actorId:actor.id,projectId,operationId,path:file.path,role}).slice(0,48);
    const uploadId='definian_'+identity({actorId:actor.id,requestId,sha256:file.sha256}).slice(0,48);
    const intent={schema:'definian.original-intake-intent.v1',projectId,operationId,sourceMappingSha256:bindingSha256,path:file.path,bytes:file.bytes,sha256:file.sha256,role};
    const requestPath=join(workspace.directory,'cli-requests',identity({actorId:actor.id,requestId})+'.json');
    let input;
    if(existsSync(requestPath)){check(!lstatSync(requestPath).isSymbolicLink(),'Retain the original ordinary request journal.');const old=JSON.parse(readFileSync(requestPath,'utf8'));
      check(old.intentSha256===identity(intent),'Original intake request names another full source edition.');input=old.input;}
    else{
      input={projectId,requestId,expectedRevision:workspace.store.head(projectId),action:'source.retain',
        payload:{uploadId,title:file.path,role,url:'',notes:'Complete original Definian reference intake '+operationId+'; mapping '+bindingSha256}};
      atomicJson(requestPath,{schema:'tjlabs.sling-cli-request.v1',actorId:actor.id,requestId,intentSha256:identity(intent),input,intent},{immutable:true});
    }
    const previous=workspace.store.request(actor.id,requestId,input);
    if(!previous){
      let current=await workspace.uploads.start(actor,{uploadId,filename:file.path.split('/').at(-1),mediaType:file.path.endsWith('.json')?'application/json':file.path.endsWith('.jsonl')?'application/x-ndjson':'application/octet-stream',bytes:file.bytes,sha256:file.sha256});
      while(current.offset<file.bytes){const start=current.offset,end=Math.min(start+8*1024*1024,file.bytes),chunk=file.raw.subarray(start,end);
        current=await workspace.uploads.chunk(actor,uploadId,{start,end:end-1,total:file.bytes,sha256:hash(chunk)},chunk);}
      await workspace.uploads.finish(actor,uploadId);
    }
    const result=await workspace.dispatch(actor,input),sourceId=result.result?.sourceId;
    const selected=workspace.store.get(projectId).sources.find(x=>x.id===sourceId);
    check(selected&&selected.bytes===file.bytes&&selected.sha256===file.sha256,'Original source retention result does not bind the full selected bytes.');
    receipts.push({path:file.path,request:input,intent,result:{sourceId,revision:result.view.revision},source:{id:sourceId,...descriptor(file)}});
    byPath[file.path]=sourceId;return sourceId;
  }
  // Every raw source, SQLite database, schema, lineage and control report is retained.
  for(const file of prepared.files)await retain(file,'definian-reference-'+hash(Buffer.from(file.path)).slice(0,24));
  const bindingRaw=Buffer.from(json(prepared.binding)),bindingFile={path:'integration/REFERENCE_BINDING.json',raw:bindingRaw,...pin(bindingRaw)};
  await retain(bindingFile,'definian-reference-binding');
  // Full exact previous request inputs survive portable product receiving as an ordinary source.
  // The final ledger retention request remains in the original CLI journal and product request history.
  const ledger={schema:'definian.original-source-retention.v1',workspaceInstanceId:workspace.store.instanceId,projectId,operationId,mappingSha256:bindingSha256,receipts:[...receipts]};
  const ledgerRaw=Buffer.from(json(ledger));const ledgerSourceId=await retain({path:'integration/INTAKE_REQUESTS.json',raw:ledgerRaw,...pin(ledgerRaw)},'definian-intake-requests');
  const sourceIds={},expectedSourceIds={};for(const t of prepared.binding.tables){sourceIds[t.originalTable]=byPath[t.source.path];expectedSourceIds[t.originalTable]=byPath[t.expected.path];}
  return {schema:'definian.original-product-input-binding.v1',workspaceInstanceId:workspace.store.instanceId,projectId,operationId,mappingSha256:bindingSha256,
    sourceIds,expectedSourceIds,bindingSourceId:byPath[bindingFile.path],ledgerSourceId,receipts,byPath,nativeJobStarted:false};
}
