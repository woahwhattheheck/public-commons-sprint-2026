#!/usr/bin/env node
// MIT. Read the complete original foreign-key results through the operator and Merchant,
// then receive and reopen the same editable workspace in a separate private destination.
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,stat,chmod,open,link,unlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
 from '../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {HumanServicesDirectoryConnection,readHumanServicesDirectoryConfiguration} from './connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,MANIFEST_NAME,canonical,SHA,UUID,MAX_PACKET_BYTES}
 from './connected/contracts.mjs';
import {humanServicesDirectoryActions,directoryForeignKeyQueries} from './connected/catalog.mjs';
import {initializeHumanServicesDirectoryMerchant} from './connected/setup.mjs';
import {openHumanServicesDirectoryMerchantClient,openHumanServicesDirectoryLocalClient,
 readHumanServicesDirectoryValue,readHumanServicesDirectoryOperatingPlan,
 downloadHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport,
 iterateHumanServicesDirectoryForeignKeys}
 from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';

const OPERATION='SCF-DIRECTORY-CONFORMANCE-FOREIGN-KEYS-CLIENTS-450E-20261013';
const NATIVE_OPERATION='SCF-DIRECTORY-CONFORMANCE-FOREIGN-KEYS-450E-20261013';
const NATIVE_SCHEMA='stellar-forge.directory-foreign-keys-operated.v1';
const RESULT_SCHEMA='stellar-forge.directory-foreign-keys-clients-operated.v1';
const JOURNEY_SCHEMA='stellar-forge.directory-foreign-keys-clients-journey.v1';
const EDITION='stellar-forge.directory-conformance.hsds-foreign-keys.20261013';
const ROW_SCHEMA='stellar-forge.directory-conformance-foreign-keys.v1';
const CASES=['original-csv','authored-description-successor','original-tabular-json','original-nested-json',
 'two-original-editions','service-only-edition','selected-service-with-original-context','authored-empty-organization-table'];
const FK={outcomes:{tail:'foreign-keys',action:'directory_conformance_foreign_keys',file:'foreignKeys',kind:'outcome',count:'outcomeRows'},
 candidates:{tail:'foreign-key-candidates',action:'directory_conformance_foreign_key_candidates',file:'foreignKeyCandidates',kind:'candidate',count:'candidateRows'},
 matches:{tail:'foreign-key-matches',action:'directory_conformance_foreign_key_matches',file:'foreignKeyMatches',kind:'match',count:'matchRows'}};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=value=>typeof value==='string'&&new RegExp(SHA).test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const required=(condition,detail)=>need(condition,'DIRECTORY_FOREIGN_KEYS_RECEIVING',detail);
const keyset=value=>Object.keys(value).sort();
const PRIVATE_MUTABLE=new Set(['acquisitions','receives']);
const HERE=dirname(fileURLToPath(import.meta.url));
const timeout={timeoutMs:600000};

export function originalDirectoryForeignKeysReceiving(value){
 required(value?.schema===NATIVE_SCHEMA&&value.operation===NATIVE_OPERATION&&value.completedAt&&
  value.implementationEdition===EDITION&&new RegExp(UUID).test(value.workspaceId||''),
  'Select the complete actual native declared-key result and its original workspace UUID.');
 for(const field of ['planIds','assessmentIds','reviewIds']){
  required(object(value[field])&&same(keyset(value[field]),[...CASES].sort())&&
   Object.values(value[field]).every(hash),'Keep all eight original '+field+' selections.');
 }
 required(object(value.editionIds)&&Object.values(value.editionIds).every(hash)&&hash(value.comparisonId)&&
  Array.isArray(value.sourceIds)&&value.sourceIds.every(hash)&&
  Array.isArray(value.authoredSourceIds)&&value.authoredSourceIds.every(hash)&&
  same(keyset(value.summaries),[...CASES].sort()),'Keep the complete original source, edition and comparison selections.');
 required(hash(value.workspacePacket?.sha256)&&Number.isSafeInteger(value.workspacePacket.bytes)&&
  value.workspacePacket.bytes>0&&hash(value.workspacePacket.registrySha256)&&
  value.restoration?.workspaceId===value.workspaceId&&value.restoration.allOriginalCollectionsEqual===true,
  'Receive the actual complete native workspace packet and successful original restoration.');
 required(value.observations?.ambiguousOriginalOutcome?.kind==='outcome'&&
  Array.isArray(value.observations.everyOriginalAmbiguousMatch)&&value.authoredTableDeletion?.otherOriginalBytesUnchanged===true,
  'Keep the native original relationship observations and the explicit authored deletion.');
 return value;
}
export async function directoryForeignKeysReady(page){
 await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
 await page.locator('[data-nav="conformance"]').click();
 await page.locator('[data-testid="conformance-tab-assessments"]').waitFor({state:'visible',timeout:120000});
}
export async function main(argv=process.argv.slice(2)){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  required(['--receiving','--workspace','--out','--chromium','--playwright'].includes(key)&&
   value&&!value.startsWith('--')&&!Object.hasOwn(args,key),
   'Use --receiving OPERATED_DIRECTORY_FOREIGN_KEYS.json --workspace RECEIVED_ORIGINAL_WORKSPACE --out PRIVATE_OUTPUT --chromium EXECUTABLE [--playwright MODULE].');
  args[key]=absolute(value);
 }
 for(const key of ['--receiving','--workspace','--out','--chromium'])required(args[key],key+' is required.');
 process.umask(0o077);
 const out=args['--out'];await mkdir(out,{recursive:true,mode:0o700});await privateDirectory(out);
 const nativeRaw=await readSourceFile(args['--receiving'],{maxBytes:64*1024*1024}),
  native=originalDirectoryForeignKeysReceiving(JSON.parse(nativeRaw.toString('utf8')));
 const alias='foreignkeys',journalPath=join(out,'FOREIGN_KEYS_CLIENTS_JOURNEY.json');
 const sourceFiles={};
 for(const name of ['operate_foreign_key_clients.mjs','public/directory-conformance-foreign-keys.mjs',
  'public/conformance.mjs','public/app.js','connected/catalog.mjs','connected/runtime.mjs',
  'connected/client.mjs','connected/client.d.mts','directory-conformance-schema.json',
  'directory_conformance.py','directory_conformance_foreign_keys.py','directory_server.py',
  'directory_receiving.py','directory_workspace.py','directory_operating_plans.py'])
  sourceFiles[name]=await fileIdentity(join(HERE,name),{maxBytes:4*1024*1024});
 const binding={operation:OPERATION,nativeSha256:digest(nativeRaw),nativeBytes:nativeRaw.length,
  workspaceId:native.workspaceId,workspace:args['--workspace'],output:out,sourceFiles};
 let journal,lease,owner,merchant,client,browser,context,receiverOwner,receiverClient;
 const emit=(stage,value={})=>process.stdout.write(JSON.stringify({stage,operation:OPERATION,...value})+'\n');
 async function checkpoint(){journal.updatedAt=now();await saveJSON(journalPath,journal,true);}
 async function privateChild(path){await mkdir(path,{recursive:true,mode:0o700});await privateDirectory(path);return path;}
 async function checkedFile(value,maxBytes=2147483648){
  required(value?.file&&hash(value.sha256)&&Number.isSafeInteger(value.bytes),'Keep a complete received file descriptor.');
  const actual=await fileIdentity(value.file,{maxBytes});
  required(actual.bytes===value.bytes&&actual.sha256===value.sha256,'The complete retained file changed: '+value.file);
  return {file:value.file,...actual};
 }
 async function jsonFile(name,value){
  const file=join(out,name);await privateChild(dirname(file));
  const previous=await readJSON(file,true);
  if(previous!==null&&previous!==undefined)required(same(previous,value),'Preserve the original completed observation: '+name);
  else await saveJSON(file,value,true);
  return {file,...await fileIdentity(file,{maxBytes:128*1024*1024})};
 }
 async function observedJSON(name,value,select=value=>value){
  const file=join(out,name),previous=await readJSON(file,true);
  if(previous!==null&&previous!==undefined){
   required(same(select(previous),select(value)),'The original observed record changed: '+name);
   return {file,...await fileIdentity(file,{maxBytes:128*1024*1024})};
  }
  return jsonFile(name,value);
 }
 async function readSaved(row){await checkedFile(row.file);return JSON.parse(await readFile(row.file.file,'utf8'));}
 async function invoke(who,action,input){
  const result=await who.call(action,{workspace:alias,...input},timeout);
  required(result.native?.ok&&result.retention?.state==='COMPLETE',action+' did not retain its full native response.');
  const value=await readHumanServicesDirectoryValue({client:who,result});
  const info=await who.call('manifest',{workspace:alias,exportId:result.exportId},timeout);
  required(info.state==='MANIFEST_RETAINED'&&info.exportId===result.exportId&&
   info.manifestFile?.sha256===result.manifestSha256&&info.manifest.workspaceId===native.workspaceId,
   'Keep the complete original response manifest.');
  const original=info.manifest.files.find(file=>file.name==='original-response.json');
  required(original&&hash(original.sha256),'The full source-defined response is required.');
  return {result,value,response:original};
 }
 async function call(key,action,input,{who=client,fresh=false}={}){
  let row=journal.calls[key];
  if(row){
   required(row.action===action&&same(row.input,input),'Resume the exact original read: '+key);
   if(row.state==='complete'&&!fresh)return readSaved(row);
  }else journal.calls[key]=row={action,input,state:'prepared',preparedAt:now()};
  await checkpoint();
  const returned=await invoke(who,action,input);
  if(row.state==='complete'){
   const previous=await readSaved(row);
   required(previous.response.sha256===returned.response.sha256&&
    previous.response.bytes===returned.response.bytes,'A source-defined immutable read changed: '+key);
   return returned;
  }
  row.file=await jsonFile('calls/'+key+'.json',returned);row.state='complete';row.completedAt=now();
  await checkpoint();return returned;
 }
 async function read(who,action,input){return (await invoke(who,action,input)).value;}
 async function collection(who,kind){
  const rows=[];let offset=0,total;
  while(true){
   const page=await read(who,'directory_records',{collection:kind,offset,limit:100});
   required(page.offset===offset&&Array.isArray(page.rows)&&Number.isSafeInteger(page.total)&&
    page.total>=0&&(total===undefined||total===page.total),'The complete '+kind+' registry page changed.');
   total=page.total;rows.push(...page.rows);
   if(page.nextOffset===null){required(rows.length===total,'Receive all '+kind+' records.');break;}
   required(page.rows.length>0&&page.nextOffset===offset+page.rows.length&&page.nextOffset<total,
    'Follow the original contiguous '+kind+' registry pages.');offset=page.nextOffset;
  }
  required(new Set(rows.map(row=>row.id)).size===rows.length,'An original registry ID was repeated.');
  return rows;
 }
 async function inventory(who,label,expected=null){
  const state=await read(who,'directory_state',{});
  required(state.workspaceId===native.workspaceId&&state.directory?.workspaceId===native.workspaceId&&
   object(state.directory.collections)&&state.directory.collections.operatingPlans,
   'Open the complete original Directory, conformance and Operating Plans workspace.');
  const current={};let count=0;
  for(const kind of Object.keys(state.directory.collections).sort()){
   if(PRIVATE_MUTABLE.has(kind))continue;
   const rows=await collection(who,kind);
   required(rows.length===state.directory.collections[kind].total,'The original registry changed while receiving '+kind+'.');
   current[kind]={};
   for(const row of rows){
    const observation=await call('records/'+kind+'/'+row.id,'directory_record',
     {collection:kind,recordId:row.id},{who,fresh:true});
    required(observation.value.id===row.id,'The requested original record ID changed.');
    current[kind][row.id]={bytes:observation.response.bytes,sha256:observation.response.sha256};count++;
   }
  }
  if(expected)required(same(current,expected),'Complete original Directory records or procedure histories changed.');
  const file=await jsonFile('inventories/'+label+'.json',{workspaceId:native.workspaceId,records:current,count,
   meaning:'Every immutable Directory record is read through its complete source-defined JSON bytes. Acquisitions and receiver-local receipts retain their native mutable semantics.'});
  return {records:current,file,count};
 }
 async function nativeSelections(){
  const sourceIds=[...native.sourceIds,...native.authoredSourceIds];
  for(const id of sourceIds)required(journal.originalRecords.sources?.[id],'The original source is missing: '+id);
  for(const id of Object.values(native.editionIds))required(journal.originalRecords.editions?.[id],'The original edition is missing: '+id);
  required(journal.originalRecords.conformanceComparisons?.[native.comparisonId],'The original comparison is missing.');
  const cases={};
  for(const key of CASES){
   const assessment=(await call('records/conformanceAssessments/'+native.assessmentIds[key],
    'directory_record',{collection:'conformanceAssessments',recordId:native.assessmentIds[key]},{fresh:true})).value;
   required(assessment.planId===native.planIds[key]&&assessment.summary?.foreignKeys?.implementationEdition===EDITION&&
    same(assessment.summary,native.summaries[key]),'The original selected assessment changed: '+key);
   for(const file of ['foreignKeys','foreignKeyCandidates','foreignKeyMatches','foreignKeyCoverage'])
    required(hash(assessment.files?.[file]?.sha256),'Keep every original declared-key file: '+key+'/'+file);
   const plan=(await call('records/conformancePlans/'+native.planIds[key],'directory_record',
    {collection:'conformancePlans',recordId:native.planIds[key]},{fresh:true})).value;
   const review=(await call('records/conformanceReviews/'+native.reviewIds[key],'directory_record',
    {collection:'conformanceReviews',recordId:native.reviewIds[key]},{fresh:true})).value;
   required(plan.subjectId===assessment.subjectId&&plan.subjectKind===assessment.subjectKind&&
    review.assessmentId===assessment.id,'The original plan, subject and review binding changed: '+key);
   cases[key]={assessment,plan,review};
  }
  return cases;
 }
 async function packetFile(key,action,input,expected,{who=client}={}){
  let row=journal.downloads[key];
  if(row)required(row.action===action&&same(row.input,input)&&same(row.expected,expected??null),
   'Keep the selected complete-file request and descriptor: '+key);
  else journal.downloads[key]=row={action,input,expected:expected??null,state:'prepared',preparedAt:now()};
  if(row.state==='complete'){
   const reopened=await reopenHumanServicesDirectoryExport({workspace:alias,exportId:row.result.exportId,
    expectedManifestSha256:row.result.manifestSha256,directory:row.receipt.directory});
   required(reopened.state==='REOPENED'&&reopened.workspaceId===native.workspaceId,'Reopen the complete original file.');
   await checkedFile(row.artifact);return row;
  }
  if(!row.result||!row.result.native?.ok||row.result.retention?.state!=='COMPLETE'){
   if(row.result){row.failedResults??=[];row.failedResults.push({at:now(),result:row.result});}
   row.result=await who.call(action,{workspace:alias,...input},timeout);await checkpoint();
  }
  required(row.result.native?.ok&&row.result.retention?.state==='COMPLETE','The original complete file was not retained: '+key);
  row.receipt=await downloadHumanServicesDirectoryExport({client:who,workspace:alias,exportId:row.result.exportId,
   expectedManifestSha256:row.result.manifestSha256,directory:join(out,'downloads',key)});
  await checkpoint();
  const manifest=await readJSON(join(row.receipt.directory,MANIFEST_NAME));
  required(manifest.workspaceId===native.workspaceId,'The received original file changed workspace.');
  const payloadName=manifest.source?.payloadFile||'original-response.json',
   artifact=manifest.files.find(file=>file.name===payloadName);
  required(artifact&&!['original-request.json','original-input.json','original-artifact.json'].includes(payloadName),
   'Select the original runtime-declared complete payload.');
  if(expected)required(artifact.sha256===expected.sha256&&artifact.bytes===expected.bytes,
   'The complete original native file differs from its descriptor: '+key);
  row.artifact={file:join(row.receipt.directory,artifact.name),bytes:artifact.bytes,sha256:artifact.sha256};
  await checkedFile(row.artifact);
  row.reopened=await reopenHumanServicesDirectoryExport({workspace:alias,exportId:row.result.exportId,
   expectedManifestSha256:row.result.manifestSha256,directory:row.receipt.directory});
  required(row.reopened.state==='REOPENED','Reopen every received member before completing its receipt.');
  row.state='complete';row.completedAt=now();await checkpoint();return row;
 }

 async function retainPageExport(label,offset,who,result,page){
  const key=label+'/'+String(offset).padStart(8,'0');
  journal.pageExports??={};
  let row=journal.pageExports[key];
  if(!row){
   journal.pageExports[key]=row={state:'prepared',result,preparedAt:now()};await checkpoint();
  }
  if(row.state!=='complete'){
   row.receipt=await downloadHumanServicesDirectoryExport({client:who,workspace:alias,
    exportId:row.result.exportId,expectedManifestSha256:row.result.manifestSha256,
    directory:join(out,'page-exports',key)});
   await checkpoint();
   const manifest=await readJSON(join(row.receipt.directory,MANIFEST_NAME)),
    original=manifest.files.find(file=>file.name==='original-response.json');
   required(manifest.workspaceId===native.workspaceId&&original&&hash(original.sha256),
    'Retain the complete source-defined relationship page.');
   row.original={file:join(row.receipt.directory,original.name),bytes:original.bytes,sha256:original.sha256};
   await checkedFile(row.original,4*1024*1024);
   row.state='complete';row.completedAt=now();await checkpoint();
  }
  const reopened=await reopenHumanServicesDirectoryExport({workspace:alias,exportId:row.result.exportId,
   expectedManifestSha256:row.result.manifestSha256,directory:row.receipt.directory});
  required(reopened.state==='REOPENED'&&reopened.workspaceId===native.workspaceId,
   'Reopen the complete original relationship-page receipt.');
  await checkedFile(row.original,4*1024*1024);
  required(same(await readJSON(row.original.file),page),'The original relationship page changed while resuming.');
  return row.original;
 }

 async function pages(assessment,view,{filters={},label=assessment.id+'/'+view,who=client}={}){
  const spec=FK[view],counts={},ids=createHash('sha256'),first={};let total=0,pageCount=0,previousTotal;
  required(spec,'Select the original relationship page kind.');
  for await(const {page,result}of iterateHumanServicesDirectoryForeignKeys({
   client:who,workspace:alias,assessmentId:assessment.id,kind:view,filters,limit:100,requestOptions:timeout})){
   required(previousTotal===undefined||previousTotal===page.total,'The original selected relationship total changed.');
   previousTotal=page.total;
   for(const row of page.rows){
    required(row.schema===ROW_SCHEMA&&row.kind===spec.kind&&hash(row.id),'Keep the original complete relationship row kind.');
    if(view==='outcomes')required(Number.isSafeInteger(row.candidateCount)&&row.candidateCount>=0&&
     typeof row.constraintOutcome==='string'&&typeof row.resolutionOutcome==='string','Keep existence and resolution separately.');
    if(row.ref)required(hash(row.ref.sourceId)&&hash(row.ref.recordId),'Keep the complete native original row reference.');
    if(view==='matches')required(hash(row.outcomeId)&&hash(row.candidateId)&&hash(row.sourceRef?.recordId)&&
     hash(row.targetRef?.recordId),'Keep both sides of every exact match.');
    ids.update(row.id+'\n');counts[row.state||'match']=(counts[row.state||'match']||0)+1;
    first[row.state||'match']??=row;total++;
   }
   const original=await retainPageExport(label,page.offset,who,result,page);
   const selected=await observedJSON('pages/'+label+'/'+String(page.offset).padStart(8,'0')+'.json',
    {result,page,original},value=>value.page);
   journal.pages[label]??={files:[]};
   if(!journal.pages[label].files.some(file=>file.file===selected.file))journal.pages[label].files.push(selected);
   pageCount++;await checkpoint();
  }
  required(previousTotal===total,'Read every original selected relationship.');
  if(Object.keys(filters).length===0)required(total===assessment.summary.foreignKeys[spec.count],
   'The complete relationship pages differ from the saved native summary.');
  const observation={assessmentId:assessment.id,view,filters,rows:total,pages:pageCount,
   originalOrdinalIdsSha256:ids.digest('hex'),states:counts,first};
  const old=journal.pages[label]?.observation;
  if(old)required(same(old,observation),'The complete original relationship reading changed: '+label);
  journal.pages[label]??={files:[]};journal.pages[label].observation=observation;await checkpoint();return observation;
 }

 async function completeConnected(cases){
  const schemaArgs=humanServicesDirectoryActions.schema.inputSchema.properties?.workspace?{workspace:alias}:{};
  const catalogue=await client.call('schema',schemaArgs,timeout),expectedTools=Object.values(humanServicesDirectoryActions).map(row=>row.name).sort();
  required(Array.isArray(catalogue.tools)&&same(catalogue.tools.map(row=>row.name).sort(),expectedTools),
   'Open the complete installed Directory, conformance and Operating Plans tool catalogue.');
  journal.catalogue=await observedJSON('FOREIGN_KEYS_CONNECTED_CATALOGUE.json',catalogue);
  const nativeCatalogue=(await call('native-catalogue','directory_catalogue',{})).value;
  for(const selected of directoryForeignKeyQueries)required(
   same(nativeCatalogue.conformanceCatalogue.querySchemas[selected.key],selected.schemaValue),
   'Keep the exact source-native foreign-key query schema: '+selected.key);
  await checkpoint();
  for(const id of [...native.sourceIds,...native.authoredSourceIds]){
   const record=(await call('records/sources/'+id,'directory_record',{collection:'sources',recordId:id},{fresh:true})).value;
   await packetFile('sources/'+id+'/original','directory_source_file',{sourceId:id},record.originalFile);
   await packetFile('sources/'+id+'/index','directory_index_file',{collection:'sources',recordId:id},record.indexFile);
  }
  for(const id of Object.values(native.editionIds)){
   const record=(await call('records/editions/'+id,'directory_record',{collection:'editions',recordId:id},{fresh:true})).value;
   await packetFile('editions/'+id+'/index','directory_index_file',{collection:'editions',recordId:id},record.indexFile);
  }
  for(const [key,selected]of Object.entries(cases)){
   for(const [collection,record]of [['conformanceAssessments',selected.assessment],['conformanceReviews',selected.review]])
    for(const [fileKind,descriptor]of Object.entries(record.files))
     await packetFile('cases/'+key+'/'+collection+'/'+fileKind,'directory_conformance_file',
      {collection,recordId:record.id,fileKind},descriptor);
   for(const view of Object.keys(FK))await pages(selected.assessment,view);
   const coverageFile=journal.downloads['cases/'+key+'/conformanceAssessments/foreignKeyCoverage'].artifact;
   const coverage=await readJSON(coverageFile.file);
   required(coverage.schema===ROW_SCHEMA&&coverage.subjectId===selected.assessment.subjectId&&
    coverage.subjectKind===selected.assessment.subjectKind,'The complete coverage belongs to another selected subject.');
   for(const [name,value]of Object.entries(selected.assessment.summary.foreignKeys))
    required(same(value,coverage[name]),'Complete native coverage differs from its saved summary: '+key+'/'+name);
   journal.coverage[key]={file:coverageFile,declaredForeignKeys:coverage.declaredForeignKeys,
    selectedDeclarations:coverage.selectedDeclarations,originalDatapackageVersion:coverage.originalDatapackageVersion,
    tableDomains:coverage.tableDomains,states:coverage.states};
   await checkpoint();
  }
  const comparison=(await call('records/conformanceComparisons/'+native.comparisonId,'directory_record',
   {collection:'conformanceComparisons',recordId:native.comparisonId},{fresh:true})).value;
  for(const [fileKind,descriptor]of Object.entries(comparison.files))
   await packetFile('comparison/'+fileKind,'directory_conformance_file',
    {collection:'conformanceComparisons',recordId:comparison.id,fileKind},descriptor);
  const ambiguous=native.observations.ambiguousOriginalOutcome,assessment=cases['two-original-editions'].assessment;
  const edges=await pages(assessment,'matches',{filters:{outcomeId:ambiguous.id},label:'original-ambiguous-matches'});
  required(edges.rows===ambiguous.candidateCount&&edges.rows===native.observations.everyOriginalAmbiguousMatch.length&&
   ambiguous.constraintOutcome==='pass'&&ambiguous.resolutionOutcome==='ambiguous',
   'Keep every exact target while preserving the original existence result.');
  const candidates=await pages(assessment,'candidates',{
   filters:{groupId:ambiguous.candidateGroupId},label:'original-ambiguous-target-group'});
  required(candidates.rows>=edges.rows,'Receive the complete original target group, including every matching target.');
  for(const match of native.observations.everyOriginalAmbiguousMatch){
   const byCandidate=await pages(assessment,'matches',{
    filters:{candidateId:match.candidateId},label:'original-candidate-'+match.candidateId});
   required(byCandidate.rows>0,'The original candidate lost its relationship edge.');
  }
  for(const [caseName,filters,name]of [
   ['original-csv',{table:'location',state:'missing-target'},'original-missing-targets'],
   ['original-tabular-json',{table:'service_area',state:'null-reference'},'original-null-reference'],
   ['authored-empty-organization-table',{table:'service',state:'missing-target'},'authored-empty-target-table']])
   await pages(cases[caseName].assessment,'outcomes',{filters,label:name});
  await procedureHistories(client,'original');
  journal.connectedAt??=now();await checkpoint();
  emit('DIRECTORY_FOREIGN_KEYS_CONNECTED_READS_COMPLETE',{cases:CASES.length,
   completeFiles:Object.keys(journal.downloads).length,pageSelections:Object.keys(journal.pages).length});
 }
 async function procedureHistories(who,label){
  const original=journal.originalRecords.operatingPlans||{},result={};
  for(const id of Object.keys(original)){
   const value=await readHumanServicesDirectoryOperatingPlan({client:who,workspace:alias,recordId:id,requestOptions:timeout});
   required(value.document?.revisions?.length>0,'Keep the complete original OperatingPlan document.');
   const first=await readHumanServicesDirectoryOperatingPlan({
    client:who,workspace:alias,recordId:id,revision:1,requestOptions:timeout});
   required(first.document.id===value.document.id&&same(first.document,value.document)&&
    first.draft.baseRevision===value.document.revisions.length,'Reopen original historical revisions against the same saved head.');
   const retained=await observedJSON('operating-plans/'+id+'.json',
    {document:value.document,basis:value.basis,input:value.input,
     historicalDraft:first.draft,latestDraft:value.draft});
   result[id]={file:retained,planId:value.document.id,revisions:value.document.revisions.length,
    originalHistoricalBaseRevision:first.draft.baseRevision};
  }
  journal.histories[label]=result;await checkpoint();return result;
 }
 async function operatorDescriptor(workspace){
  const descriptor=await readJSON(join(workspace,'directory','operator-connection.json'));
  required(descriptor.schema===OPERATOR_SCHEMA&&descriptor.active&&descriptor.workspaceId===native.workspaceId&&
   typeof descriptor.url==='string'&&typeof descriptor.accessToken==='string',
   'Keep the original active Directory operator and workspace identity.');
  return descriptor;
 }
 async function startMerchant(connection){
  const setup=await initializeHumanServicesDirectoryMerchant({directory:join(out,'merchant'),connection,
   name:'Complete original Directory foreign-key receiving'});
  const tokenEnv='DIRECTORY_FOREIGN_KEYS_MCP_CODE',environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
  merchant=await startMerchantMcp({configPath:setup.configuration,port:0,tokenEnv,environment});
  client=await openHumanServicesDirectoryMerchantClient({url:merchant.url,tokenEnv,environment});
  return setup;
 }
 async function reopenMerchant(connection,cases){
  const before=await operatorDescriptor(args['--workspace']);
  await client.close();client=null;await merchant.close();merchant=null;
  await startMerchant(connection);
  const after=await operatorDescriptor(args['--workspace']);
  required(before.workspaceId===after.workspaceId&&before.url===after.url&&before.accessToken===after.accessToken,
   'The separately owned original Directory operator must survive Merchant close/reopen.');
  const sourceInventory=await inventory(client,'merchant-reopened',journal.originalRecords);
  for(const [key,selected]of Object.entries(cases)){
   for(const [view,spec]of Object.entries(FK)){
    const page=await read(client,spec.action,{assessmentId:selected.assessment.id,offset:0,limit:25});
    required(page.total===selected.assessment.summary.foreignKeys[spec.count]&&page.assessmentId===selected.assessment.id,
     'The re-opened Merchant client lost original relationship results.');
    await observedJSON('merchant-reopened/'+key+'-'+view+'.json',page);
   }
  }
  await procedureHistories(client,'merchant-reopened');
  journal.merchantReopen={workspaceId:native.workspaceId,sameOriginalOperator:true,inventory:sourceInventory.file,
   cases:CASES.length,readAt:journal.merchantReopen?.readAt||now()};
  await checkpoint();
 }
 async function memory(){
  const value={at:now(),pid:process.pid};
  for(const name of ['memory.current','memory.max','memory.peak','memory.events','pids.current','pids.max']){
   try{value[name]=(await readFile('/sys/fs/cgroup/'+name,'utf8')).trim();}
   catch(error){value[name]={unavailable:error.code||error.message};}
  }
  return value;
 }
 async function browserModule(){
  if(args['--playwright'])return import(pathToFileURL(args['--playwright']).href);
  const require=createRequire(import.meta.url),modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||
   '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
  return require(join(modules,'playwright'));
 }
 async function openBrowser(phase){
  const executable=await stat(args['--chromium']);
  required(executable.isFile()&&(executable.mode&0o111)!==0,'Select the actual existing Chromium executable.');
  const {chromium}=await browserModule();
  const attempt={phase,startedAt:now(),before:await memory(),errors:[],blockedWrites:[]};
  journal.browserAttempts.push(attempt);await checkpoint();
  browser=await chromium.launch({headless:true,executablePath:args['--chromium'],
   args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
  page.on('pageerror',error=>attempt.errors.push({at:now(),message:error.message}));
  await page.route('**/api/**',async route=>{
   const request=route.request();
   if(request.method()==='GET'||request.method()==='HEAD')return route.continue();
   attempt.blockedWrites.push({at:now(),method:request.method(),path:new URL(request.url()).pathname});
   return route.abort('blockedbyclient');
  });
  return {page,attempt};
 }
 async function closeBrowser(attempt){
  await context?.close();context=null;await browser?.close();browser=null;
  if(attempt){attempt.after=await memory();attempt.closedAt=now();await checkpoint();}
 }
 async function go(page,workspace){
  const descriptor=await operatorDescriptor(workspace);
  await page.goto(descriptor.url+'#'+descriptor.accessToken,{waitUntil:'domcontentloaded',timeout:120000});
  await directoryForeignKeysReady(page);
  required((await page.locator('#workspace-id').textContent())===native.workspaceId,
   'The browser opened a different original workspace.');
 }
 async function openAssessment(page,record){
  await page.locator('[data-testid="conformance-tab-assessments"]').click();
  const panel=page.locator('section.panel').filter({
   has:page.getByRole('heading',{name:'Saved complete assessments',exact:true})});
  await panel.locator('input[type="search"]').fill(record.id);
  const pending=page.waitForResponse(response=>{
   const url=new URL(response.url());
   return response.request().method()==='GET'&&url.pathname==='/api/directory/conformanceAssessments'&&url.searchParams.get('query')===record.id;
  },{timeout:120000});
  await panel.getByRole('button',{name:'Search',exact:true}).click();
  required((await pending).ok(),'The exact saved assessment search failed.');
  await page.locator('[data-conformance-record-id="'+record.id+'"]').click();
  await page.waitForSelector('[data-foreign-key-assessment="'+record.id+'"][data-foreign-keys-ready="true"]',{timeout:180000});
 }
 function browserRoot(page,id){return page.locator('[data-foreign-key-assessment="'+id+'"]');}
 async function viewReady(page,id,view,offset=0){
  await page.waitForFunction(({id,view,offset})=>{
   const root=document.querySelector('[data-foreign-key-assessment="'+id+'"]');
   const body=root?.querySelector('[data-testid="foreign-key-results"]');
   return body&&body.getAttribute('aria-busy')!=='true'&&body.dataset.view===view&&Number(body.dataset.offset)===offset;
  },{id,view,offset},{timeout:180000});
 }
 async function screenshot(page,name){
  const file=join(out,'screens',name+'.png');await privateChild(dirname(file));
  await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
  return {file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
 }

 async function browserResponse(response,name,expected){
  required(response.ok(),'The original browser read failed: '+new URL(response.url()).pathname);
  const raw=await response.body(),value=JSON.parse(raw.toString('utf8'));
  if(expected!==undefined)required(same(value,expected),'The browser changed the complete original native response.');
  const file=await jsonFile('browser-http/'+name+'.json',{path:new URL(response.url()).pathname,
   query:new URL(response.url()).search,status:response.status(),bytes:raw.length,sha256:digest(raw),
   bodyBase64:raw.toString('base64'),value});
  return {value,file};
 }
 async function browserSelection(page,assessment,view,filters={}){
  const root=browserRoot(page,assessment.id),spec=FK[view];
  required(spec,'Choose the exact original browser relationship page.');
  if(await root.locator('[data-testid="foreign-key-view"]').inputValue()!==view){
   await root.locator('[data-testid="foreign-key-view"]').selectOption(view);
   await viewReady(page,assessment.id,view);
  }
  for(const name of ['table','state','ruleId','sourceId','recordId','groupId','outcomeId','candidateId']){
   const input=root.locator('[data-testid="foreign-key-filter-'+name+'"]');
   if(await input.isEnabled())await input.fill(filters[name]??'');
  }
  await root.getByLabel('Relationship page size',{exact:true}).fill('25');
  const pending=page.waitForResponse(response=>{
   const url=new URL(response.url());
   return response.request().method()==='GET'&&url.pathname==='/api/directory/conformance/assessments/'+assessment.id+'/'+spec.tail&&
    url.searchParams.get('offset')==='0'&&url.searchParams.get('limit')==='25'&&
    Object.entries(filters).every(([key,value])=>url.searchParams.get(key)===String(value));
  },{timeout:180000});
  await root.locator('[data-testid="foreign-key-filter-submit"]').click();
  const response=await pending;await viewReady(page,assessment.id,view);
  return response;
 }
 async function browserPages(page,assessment,view,name,filters={}){
  let response=await browserSelection(page,assessment,view,filters),offset=0,total=0,pages=0;
  const root=browserRoot(page,assessment.id),observations=[];
  while(true){
   const expected=await read(client,FK[view].action,{assessmentId:assessment.id,...filters,offset,limit:25});
   const observed=await browserResponse(response,name+'/'+view+'/'+String(offset).padStart(8,'0'),expected);
   await viewReady(page,assessment.id,view,offset);
   const body=root.locator('[data-testid="foreign-key-results"]');
   required(Number(await body.getAttribute('data-total'))===expected.total,'The displayed original total changed.');
   const visible=await body.locator('tbody > tr').evaluateAll(rows=>rows.map(row=>row.dataset.recordId));
   required(same(visible,expected.rows.map(row=>row.id)),'The original relationship rows changed order or identity in the browser.');
   if(view==='outcomes'){
    for(const row of expected.rows){
     const displayed=body.locator('tr[data-record-id="'+row.id+'"]');
     required((await displayed.locator('td').nth(2).textContent()).trim()===row.constraintOutcome&&
      (await displayed.locator('td').nth(3).textContent()).includes(row.resolutionOutcome),
      'The operator must distinguish the original existence result from identity resolution.');
    }
   }
   observations.push({offset,rows:expected.rows.length,file:observed.file});total+=expected.rows.length;pages++;
   if(expected.nextOffset===null){required(total===expected.total,'Read every selected UI relationship page.');break;}
   const next=expected.nextOffset;
   const pending=page.waitForResponse(r=>{
    const u=new URL(r.url());return r.request().method()==='GET'&&
     u.pathname==='/api/directory/conformance/assessments/'+assessment.id+'/'+FK[view].tail&&u.searchParams.get('offset')===String(next);
   },{timeout:180000});
   await body.getByRole('button',{name:'Next',exact:true}).click();
   response=await pending;offset=next;await viewReady(page,assessment.id,view,offset);
  }
  return {assessmentId:assessment.id,view,filters,rows:total,pages,observations};
 }
 async function browserDownload(page,trigger,name,expected){
  const pending=page.waitForEvent('download',{timeout:600000});await trigger();
  const download=await pending,file=join(out,'browser-files',name);
  await privateChild(dirname(file));await download.saveAs(file);await chmod(file,0o600);
  required(!(await download.failure()),'Receive the complete browser download.');
  const actual={file,...await fileIdentity(file,{maxBytes:2147483648})};
  if(expected)required(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,
   'The browser download differs from the complete original file: '+name);
  return actual;
 }
 async function browserCoverage(page,assessment,name){
  const root=browserRoot(page,assessment.id);
  await root.locator('[data-testid="foreign-key-view"]').selectOption('coverage');
  await viewReady(page,assessment.id,'coverage');
  const caseKey=Object.keys(native.assessmentIds).find(key=>native.assessmentIds[key]===assessment.id);
  required(caseKey&&journal.coverage[caseKey]?.file,'Select the complete original coverage file.');
  const expected=await readJSON(journal.coverage[caseKey].file.file);
  const domains=root.locator('section.panel').filter({has:page.getByRole('heading',{name:'Original table domains',exact:true})});
  const rows=await domains.locator('tbody > tr').evaluateAll(rows=>rows.map(row=>Array.from(row.cells,cell=>cell.textContent)));
  required(rows.length===expected.tableDomains.length,'Display every original selected and excluded table domain.');
  for(let i=0;i<rows.length;i++){
   const domain=expected.tableDomains[i],row=rows[i];
   required(row[0]===domain.sourceId&&row[1].includes(domain.table)&&
    row[2].includes(domain.selected?'selected':'outside selected edition')&&row[2].includes(domain.coverage||''),
    'The operator must display the exact original table selection and coverage.');
   if(domain.tableRows!==undefined&&domain.tableRows!==null)
    required(row[3]===Number(domain.tableRows).toLocaleString('en-US'),'Preserve the original table row count, including zero.');
  }
  return {assessmentId:assessment.id,tableDomains:expected.tableDomains.length,
   explicitEmpty:expected.tableDomains.filter(row=>row.tableRows===0).length,
   selected:expected.tableDomains.filter(row=>row.selected).length,
   outsideSelection:expected.tableDomains.filter(row=>row.selected===false).length};
 }
 async function sourceRowUI(page,assessment,outcome,name){
  const ref=outcome.ref,root=browserRoot(page,assessment.id);
  const exact=await read(client,'directory_source_row',{sourceId:ref.sourceId,recordId:ref.recordId});
  const pending=page.waitForResponse(response=>response.request().method()==='GET'&&
   new URL(response.url()).pathname==='/api/directory/sources/'+ref.sourceId+'/rows/'+ref.recordId,{timeout:180000});
  await root.locator('tr[data-record-id="'+outcome.id+'"]').getByRole('button',{name:'Open original row',exact:true}).click();
  const observed=await browserResponse(await pending,name,exact);
  await page.locator('#record-dialog[open]').waitFor();
  required((await page.locator('#dialog-content pre.json').first().textContent())===exact.json,
   'The original row must preserve its complete source JSON text and numeric tokens.');
  await page.locator('#dialog-close').click();
  return {sourceId:ref.sourceId,recordId:ref.recordId,rowSha256:exact.rowSha256,file:observed.file};
 }
 async function browserDrilldown(page,cases,name){
  const assessment=cases['two-original-editions'].assessment,
   original=native.observations.ambiguousOriginalOutcome;
  await openAssessment(page,assessment);
  let response=await browserSelection(page,assessment,'outcomes',{state:'ambiguous'});
  const expected=await read(client,FK.outcomes.action,{assessmentId:assessment.id,state:'ambiguous',offset:0,limit:25});
  await browserResponse(response,name+'/ambiguous-outcomes',expected);
  required(expected.rows.some(row=>row.id===original.id),'The original ambiguous example must remain on its first ordered page.');
  const root=browserRoot(page,assessment.id),row=root.locator('tr[data-record-id="'+original.id+'"]');
  await row.locator('[data-testid="foreign-key-outcome-detail"]').click();
  await page.locator('#record-dialog[open]').waitFor();
  const full=await page.locator('#dialog-content details[open] > pre.json').last().textContent();
  required(same(JSON.parse(full),original),'The complete original outcome detail changed.');
  await page.locator('#dialog-close').click();
  const originalRow=await sourceRowUI(page,assessment,original,name+'/original-child');
  const pending=page.waitForResponse(r=>{
   const u=new URL(r.url());return r.request().method()==='GET'&&u.pathname==='/api/directory/conformance/assessments/'+assessment.id+'/foreign-key-matches'&&u.searchParams.get('outcomeId')===original.id;
  },{timeout:180000});
  await row.locator('[data-testid="foreign-key-outcome-matches"]').click();
  response=await pending;await viewReady(page,assessment.id,'matches');
  const matches=await read(client,FK.matches.action,{assessmentId:assessment.id,outcomeId:original.id,offset:0,limit:25});
  await browserResponse(response,name+'/all-ambiguous-matches',matches);
  required(matches.total===original.candidateCount&&matches.rows.length===native.observations.everyOriginalAmbiguousMatch.length&&
   same(matches.rows,native.observations.everyOriginalAmbiguousMatch),
   'Retain every original ambiguous match rather than selecting one target.');
  const firstMatch=matches.rows[0];
  await root.locator('tr[data-record-id="'+firstMatch.id+'"]').locator('[data-testid="foreign-key-match-detail"]').click();
  await page.locator('#record-dialog[open]').waitFor();
  const matched=JSON.parse(await page.locator('#dialog-content details[open] > pre.json').last().textContent());
  required(same(matched,firstMatch),'The match detail must retain both complete original source references.');
  await page.locator('#dialog-close').click();
  const group=await browserPages(page,assessment,'candidates',name+'/target-group',{groupId:original.candidateGroupId});
  const candidate=native.observations.everyOriginalAmbiguousMatch[0].candidateId;
  const uses=await browserPages(page,assessment,'matches',name+'/candidate-uses',{candidateId:candidate});
  required(group.rows>=original.candidateCount&&uses.rows>0,'Keep the complete group and all candidate uses.');
  return {originalOutcomeId:original.id,existence:original.constraintOutcome,resolution:original.resolutionOutcome,
   matches:matches.total,groupRows:group.rows,candidateUses:uses.rows,originalRow};
 }
 async function readHistoricalUI(page,name){
  const older=(native.originalAssessmentReadback||[]).find(record=>!record.files?.foreignKeyCoverage&&record.summary);
  if(older){
   const record=(await call('records/conformanceAssessments/'+older.id,'directory_record',
    {collection:'conformanceAssessments',recordId:older.id},{fresh:true})).value;
   await page.locator('[data-testid="conformance-tab-assessments"]').click();
   const panel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Saved complete assessments',exact:true})});
   await panel.locator('input[type="search"]').fill(record.id);
   await panel.getByRole('button',{name:'Search',exact:true}).click();
   await page.locator('[data-conformance-record-id="'+record.id+'"]').click();
   await page.locator('[data-testid="conformance-assessment-workbench"]').waitFor({state:'visible',timeout:180000});
   required(await page.locator('[data-foreign-key-assessment="'+record.id+'"]').count()===0,
    'The current UI must not assign foreign-key results to an earlier assessment.');
   if(record.family==='hsds-3.3.1')await page.getByRole('heading',{name:'Original relationship assessment',exact:true}).waitFor();
   journal.historicalUI={recordId:record.id,files:record.files,summary:record.summary,
    image:await screenshot(page,name+'/Original_Assessment_Edition')};
  }
  const plans=Object.keys(journal.originalRecords.operatingPlans||{});
  if(plans.length){
   const id=plans[0],full=await readHumanServicesDirectoryOperatingPlan({
    client,workspace:alias,recordId:id,revision:1,requestOptions:timeout});
   await page.locator('[data-nav="operatingPlans"]').click();
   await page.waitForSelector('[data-operating-plans-ready="true"]',{timeout:180000});
   if(!await page.locator('[data-record-id="'+id+'"]').count()){
    await page.getByLabel('Find saved procedure',{exact:true}).fill(id);
    await page.getByLabel('Find saved procedure',{exact:true}).press('Tab');
   }
   await page.locator('[data-record-id="'+id+'"]').click();
   await page.locator('[data-testid="dop-history"]').selectOption('1');
   await page.waitForFunction(title=>document.querySelector('[data-testid="dop-edit-title"]')?.value===title,
    full.draft.content.title,{timeout:180000});
   journal.procedureUI={recordId:id,planId:full.document.id,revision:1,
    originalHistoricalBaseRevision:full.draft.baseRevision,image:await screenshot(page,name+'/Original_Procedure_History')};
   await page.getByRole('button',{name:'Discard working edits',exact:true}).click();
  }
  await checkpoint();
 }
 async function browserPhase(phase,cases,{workspace=args['--workspace'],complete=true}={}){
  const previous=journal.browser[phase];
  if(previous?.state==='complete'){
   for(const file of previous.files)await checkedFile(file);
   return previous;
  }
  const {page,attempt}=await openBrowser(phase);
  const name=phase+'/attempt-'+String(journal.browserAttempts.length).padStart(4,'0');
  const result={state:'reading',workspaceId:native.workspaceId,cases:{},files:[],startedAt:now()};
  try{
   await go(page,workspace);
   for(const key of complete?CASES:['two-original-editions','authored-empty-organization-table']){
    const assessment=cases[key].assessment;await openAssessment(page,assessment);
    const caseResult={assessmentId:assessment.id,views:{}};
    for(const view of Object.keys(FK)){
     if(complete)caseResult.views[view]=await browserPages(page,assessment,view,name+'/'+key);
     else{
      const response=await browserSelection(page,assessment,view);
      const expected=await read(client,FK[view].action,{assessmentId:assessment.id,offset:0,limit:25});
      caseResult.views[view]=await browserResponse(response,name+'/'+key+'/'+view,expected);
     }
     if(complete){
      const file=await browserDownload(page,
       ()=>browserRoot(page,assessment.id).locator('[data-testid="foreign-key-download-'+view+'"]').click(),
       name+'/'+key+'-'+view+'.jsonl',assessment.files[FK[view].file]);
      result.files.push(file);
     }
    }
    caseResult.coverage=await browserCoverage(page,assessment,name+'/'+key);
    if(complete)result.files.push(await browserDownload(page,
     ()=>browserRoot(page,assessment.id).locator('[data-testid="foreign-key-download-coverage"]').click(),
     name+'/'+key+'-coverage.json',assessment.files.foreignKeyCoverage));
    await browserRoot(page,assessment.id).locator('[data-testid="foreign-key-results"]').scrollIntoViewIfNeeded();
    result.files.push(await screenshot(page,name+'/'+key+'-coverage'));
    result.cases[key]=caseResult;
   }
   result.drilldown=await browserDrilldown(page,cases,name+'/drilldown');
   for(const [label,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
    await page.setViewportSize(viewport);
    const root=browserRoot(page,cases['two-original-editions'].assessment.id);
    await root.locator('[data-testid="foreign-key-results"]').scrollIntoViewIfNeeded();
    const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,
     workspace:document.querySelector('#workspace-id')?.textContent}));
    required(layout.width<=layout.viewport+1&&layout.workspace===native.workspaceId,
     'The complete operator must remain usable within the selected desktop or phone viewport.');
    result[label]=layout;result.files.push(await screenshot(page,name+'/'+label));
   }
   await page.setViewportSize({width:1440,height:1000});
   if(phase==='merchant-reopened'){
    await readHistoricalUI(page,name);
    await page.locator('[data-nav="handoff"]').click();
    await page.waitForSelector('[data-testid="directory-workspace-download"]',{timeout:180000});
    result.workspacePacket=await browserDownload(page,
     ()=>page.locator('[data-testid="directory-workspace-download"]').click(),
     name+'/Directory_Foreign_Keys_Browser_Complete_Editable_Workspace.zip');
    required(result.workspacePacket.bytes<=MAX_PACKET_BYTES,
     'The selected workspace exceeds the maintained connected receive limit; retain this complete native download.');
    result.files.push(result.workspacePacket);
   }
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,
    'The read-only browser journey encountered an application error or attempted a native write.');
   result.state='complete';result.completedAt=now();journal.browser[phase]=result;await checkpoint();
   return result;
  }finally{await closeBrowser(attempt);}
 }

 async function preserveNativeInput(){
  const file=join(out,'originals','OPERATED_DIRECTORY_FOREIGN_KEYS.json');await privateChild(dirname(file));
  try{
   const previous=await fileIdentity(file,{maxBytes:64*1024*1024});
   required(previous.bytes===nativeRaw.length&&previous.sha256===binding.nativeSha256,
    'Preserve the complete unchanged original native result.');
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   const pending=file+'.pending-'+randomBytes(8).toString('hex'),handle=await open(pending,'wx',0o600);
   try{await handle.writeFile(nativeRaw);await handle.sync();}finally{await handle.close();}
   await link(pending,file);await unlink(pending);
  }
  return {file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
 }
 async function receiveCustomer(cases){
  const packet=journal.workspacePacket;await checkedFile(packet);
  required(packet.bytes<=MAX_PACKET_BYTES,'Use the complete native route for archives larger than the connected receiver supports.');
  const target=join(out,'received-workspace'),connection=join(out,'received-connection.json');
  const configuration={schema:CONNECTION_SCHEMA,workspaces:{foreignkeys:{
   directory:target,label:'Complete original Directory relationship receiving',allowStart:true,
   inputs:{'complete-workspace':{file:packet.file,sha256:packet.sha256,
    label:'The exact browser-received editable Directory workspace'}}}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep the exact original receiving file and private destination.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  receiverOwner=new HumanServicesDirectoryConnection(config.workspaces.foreignkeys);await receiverOwner.open();
  receiverClient=await openHumanServicesDirectoryLocalClient({connection,exportsDirectory:join(out,'received-native-exports')});
  const imported=await receiverClient.directoryWorkspaceImport({
   workspace:alias,input:'complete-workspace',expectedSha256:packet.sha256},timeout);
  required(imported.native?.ok&&imported.retention?.state==='COMPLETE',
   'The original native full workspace receiver did not complete.');
  const value=await readHumanServicesDirectoryValue({client:receiverClient,result:imported});
  required(value.workspaceId===native.workspaceId&&value.archiveSha256===packet.sha256&&value.reconstructed===true,
   'The complete original Directory import changed its archive or workspace UUID.');
  // The response's state is the full workspace state. Completion lives in the original receives row.
  const receipt=(await invoke(receiverClient,'directory_record',{collection:'receives',recordId:packet.sha256})).value;
  required(receipt.id===packet.sha256&&receipt.archiveSha256===packet.sha256&&receipt.kind==='workspace'&&
   receipt.state==='complete'&&receipt.workspaceId===native.workspaceId,
   'Require the actual completed native receiving row for this exact archive.');
  const received=await inventory(receiverClient,'customer-received',journal.originalRecords);
  const oldClient=client;client=receiverClient;
  try{
   for(const selected of Object.values(cases)){
    const record=(await invoke(receiverClient,'directory_record',{
     collection:'conformanceAssessments',recordId:selected.assessment.id})).value;
    required(same(record,selected.assessment),'Preserve the exact assessment record and complete file descriptors.');
    for(const view of Object.keys(FK)){
     const result=await pages(record,view,{who:receiverClient,label:'customer/'+record.id+'/'+view});
     const original=journal.pages[record.id+'/'+view].observation;
     required(result.originalOrdinalIdsSha256===original.originalOrdinalIdsSha256&&
      result.rows===original.rows&&same(result.states,original.states),
      'Complete customer receiving changed the original indexed relationships.');
    }
    // Read all four files through the received native index/file owner as well.
    for(const fileKind of ['foreignKeys','foreignKeyCandidates','foreignKeyMatches','foreignKeyCoverage'])
     await packetFile('customer/'+record.id+'/'+fileKind,'directory_conformance_file',
      {collection:'conformanceAssessments',recordId:record.id,fileKind},record.files[fileKind],{who:receiverClient});
   }
   await procedureHistories(receiverClient,'customer-received');
   const browserResult=await browserPhase('customer-received',cases,{workspace:target,complete:false});
   const exported=await packetFile('customer-complete-workspace','directory_workspace_packet',{},null,{who:receiverClient});
   const receiveIdentity=row=>({id:row.id,archiveSha256:row.archiveSha256,workspaceId:row.workspaceId,
    kind:row.kind,state:row.state,completed:row.completed});
   const record=await observedJSON('CUSTOMER_FOREIGN_KEYS_RECEIVING.json',receipt,receiveIdentity);
   const current={workspace:target,workspaceId:native.workspaceId,archiveSha256:packet.sha256,
    completedReceipt:record,completeOriginalInventory:received.file,originalImmutableRecords:received.count,
    allOriginalRecordsEqual:true,allRelationshipIndicesReopened:true,originalProcedureHistories:Object.keys(journal.histories['customer-received']),
    browser:browserResult,workspacePacket:exported.artifact,completedAt:journal.customer?.completedAt||now()};
   if(journal.customer)required(same(current,journal.customer),'Preserve the original completed customer receiving.');
   journal.customer=current;await checkpoint();return current;
  }finally{client=oldClient;}
 }
 async function completeResult(cases){
  journal.completedAt??=now();await checkpoint();
  const result={schema:RESULT_SCHEMA,operation:OPERATION,completedAt:journal.completedAt,
   implementationEdition:EDITION,workspaceId:native.workspaceId,workspace:journal.customer.workspace,
   sourceWorkspace:args['--workspace'],sourceRoot:HERE,nativeReceiving:journal.nativeReceiving,
   nativeOperation:native.operation,nativeSha256:binding.nativeSha256,originalNativeWorkspacePacket:native.workspacePacket,
   sourceIds:native.sourceIds,authoredSourceIds:native.authoredSourceIds,editionIds:native.editionIds,
   planIds:native.planIds,assessmentIds:native.assessmentIds,reviewIds:native.reviewIds,
   comparisonId:native.comparisonId,summaries:native.summaries,observations:native.observations,
   authoredTableDeletion:native.authoredTableDeletion,sourceFiles:binding.sourceFiles,
   originalRecordInventory:journal.originalInventory,originalRecordHashes:journal.originalRecords,
   originalOperatingPlanHistories:journal.histories.original,originalAssessmentReadback:native.originalAssessmentReadback,
   coverage:journal.coverage,pageSelections:journal.pages,pageExports:journal.pageExports,downloads:journal.downloads,
   browser:journal.browser,merchantReopen:journal.merchantReopen,customerReceiving:journal.customer,
   historicalUI:journal.historicalUI??null,procedureUI:journal.procedureUI??null,
   workspacePacket:journal.customer.workspacePacket,browserWorkspacePacket:journal.workspacePacket,
   catalogue:journal.catalogue,browserAttempts:journal.browserAttempts,journal:journalPath,
   meaning:'Complete read-only operator and SDK/MCP receiving of the eight actual source-owned relationship assessments. '+
    'Every original outcome, target candidate, match, declaration, source file and selected table coverage is retained. '+
    'The existing Directory and OperatingPlan records remain exact. A separately received customer workspace reopens all '+
    'original indices and histories; receiver-local completion records are new native custody evidence. '+
    'No source acquisition, assessment, finding decision, procedure execution or production certification is inferred.'};
  journal.result=await jsonFile('OPERATED_DIRECTORY_FOREIGN_KEYS_CLIENTS.json',result);await checkpoint();
  return result;
 }
 try{
  lease=await operationLease(join(out,'foreign-keys-clients.lock'));
  const savedJournal=await readJSON(journalPath,true);
  if(savedJournal)required(savedJournal.schema===JOURNEY_SCHEMA&&savedJournal.operation===OPERATION&&same(savedJournal.binding,binding),
   'Resume the same exact native result, source edition, workspace and output directory.');
  journal=savedJournal??{schema:JOURNEY_SCHEMA,operation:OPERATION,binding,createdAt:now(),calls:{},downloads:{},
   pages:{},coverage:{},histories:{},browser:{},browserAttempts:[],failures:[]};
  journal.nativeReceiving??=await preserveNativeInput();await checkedFile(journal.nativeReceiving);await checkpoint();
  if(journal.result){
   await checkedFile(journal.result);const result=await readJSON(journal.result.file);
   required(result.schema===RESULT_SCHEMA&&result.operation===OPERATION&&result.nativeSha256===binding.nativeSha256&&
    result.workspaceId===native.workspaceId,'The completed original client result changed.');
   await checkedFile(result.workspacePacket);
   for(const item of [...Object.values(journal.downloads),...Object.values(journal.pageExports||{})]){
    required(item.state==='complete','A completed operation must retain every selected complete download.');
    await reopenHumanServicesDirectoryExport({workspace:alias,exportId:item.result.exportId,
     expectedManifestSha256:item.result.manifestSha256,directory:item.receipt.directory});
   }
   emit('DIRECTORY_FOREIGN_KEYS_CLIENTS_COMPLETE',{result:journal.result,workspaceId:native.workspaceId,
    workspacePacket:result.workspacePacket,recovered:true});return result;
  }
  const connection=join(out,'foreign-keys-connection.json'),configuration={schema:CONNECTION_SCHEMA,
   workspaces:{foreignkeys:{directory:args['--workspace'],label:'Original complete Directory relationship assessments',allowStart:true}}};
  const old=await readJSON(connection,true);
  if(old)required(same(old,configuration),'Keep the original host-selected Directory workspace.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  owner=new HumanServicesDirectoryConnection(config.workspaces.foreignkeys);await owner.open();
  await startMerchant(connection);
  const original=await inventory(client,'original',journal.originalRecords??null);
  journal.originalRecords??=original.records;journal.originalInventory??=original.file;await checkpoint();
  const cases=await nativeSelections();
  await completeConnected(cases);
  await browserPhase('original-operator',cases);
  await reopenMerchant(connection,cases);
  const finalBrowser=await browserPhase('merchant-reopened',cases,{complete:false});
  required(finalBrowser.workspacePacket,'Retain the complete editable workspace from the re-opened browser.');
  journal.workspacePacket??=finalBrowser.workspacePacket;await checkedFile(journal.workspacePacket);
  await packetFile('original-connected-complete-workspace','directory_workspace_packet',{},null);
  await inventory(client,'original-after-browser',journal.originalRecords);await checkpoint();
  // The source operation is now fully observed. Release its owned processes before opening the fresh customer.
  await client.close();client=null;await merchant.close();merchant=null;await owner.close();owner=null;
  await receiveCustomer(cases);
  const result=await completeResult(cases);
  emit('DIRECTORY_FOREIGN_KEYS_CLIENTS_COMPLETE',{result:journal.result,workspaceId:native.workspaceId,
   workspacePacket:result.workspacePacket,cases:CASES.length,completeFiles:Object.keys(journal.downloads).length});
  return result;
 }catch(error){
  if(journal){
   journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack,
    resources:await memory()});await checkpoint();
  }
  emit('DIRECTORY_FOREIGN_KEYS_CLIENTS_INTERRUPTED',{journal:journalPath,
   error:{code:error.code||error.name,message:error.message}});
  throw error;
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await receiverClient?.close().catch(()=>{});await receiverOwner?.close().catch(()=>{});
  await client?.close().catch(()=>{});await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  try{if(journal)await checkpoint();}finally{await lease?.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write((error.stack||error.message)+'\n');process.exitCode=1;});
