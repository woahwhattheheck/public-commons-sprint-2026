#!/usr/bin/env node
// MIT. Complete original-source correction editor, exact connected replay and fresh customer receiving.
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,stat,chmod} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
 from '../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {HumanServicesDirectoryConnection,readHumanServicesDirectoryConfiguration} from './connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,MANIFEST_NAME,canonical,SHA,UUID} from './connected/contracts.mjs';
import {humanServicesDirectoryActions} from './connected/catalog.mjs';
import {initializeHumanServicesDirectoryMerchant} from './connected/setup.mjs';
import {openHumanServicesDirectoryMerchantClient,openHumanServicesDirectoryLocalClient,
 readHumanServicesDirectoryValue,changeHumanServicesDirectoryCorrection,
 readHumanServicesDirectoryCorrection,iterateHumanServicesDirectoryCorrection,
 downloadHumanServicesDirectoryCorrectionFile,downloadHumanServicesDirectoryCorrection,
 downloadHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport} from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';
const OPERATION='SCF-DIRECTORY-CORRECTION-CLIENTS-450E-20261013';
const NATIVE_SCHEMA='stellar-forge.directory-corrections-operated.v1';
const RESULT_SCHEMA='stellar-forge.directory-correction-clients-operated.v1';
const JOURNEY_SCHEMA='stellar-forge.directory-correction-clients-journey.v1';
const HERE=dirname(fileURLToPath(import.meta.url)),timeout={timeoutMs:600000};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=x=>typeof x==='string'&&new RegExp(SHA).test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const required=(condition,message)=>need(condition,'DIRECTORY_CORRECTION_RECEIVING',message);
const PRIVATE_MUTABLE=new Set(['acquisitions','receives']);
export function originalDirectoryCorrectionsReceiving(value){
 required(value?.schema===NATIVE_SCHEMA&&value.operation==='SCF-DIRECTORY-CORRECTIONS-450E-20261013'&&
  value.completedAt&&new RegExp(UUID).test(value.workspaceId||'')&&object(value.recordIds)&&
  object(value.originalDirectoryRecordHashes)&&object(value.cases)&&Object.keys(value.cases).length&&
  Array.isArray(value.connectedInputs?.replay)&&value.connectedInputs.replay.length&&
  hash(value.workspacePacket?.sha256),'Select the completed native correction course, its original UUID and complete editable packet.');
 for(const [key,row]of Object.entries(value.cases))
  required(['editionId','planId','previewId','correctionId','comparisonId','candidateEditionId'].every(k=>hash(row[k])),
   'Keep every original native correction case identity: '+key);
 for(const row of value.connectedInputs.replay)
  required(typeof row.key==='string'&&/^[a-zA-Z0-9_.-]+$/.test(row.key)&&
   ['prepare','preview','apply','export'].includes(row.action)&&object(row.input)&&hash(row.expectedRecordId),
   'Keep the original accepted native input and expected record.');
 required(new Set(value.connectedInputs.replay.map(row=>row.key)).size===value.connectedInputs.replay.length,
  'Retain unique original replay keys.');
 return value;
}
export async function directoryCorrectionsReady(page){
 await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
 await page.locator('[data-nav="corrections"]').click();
 await page.waitForSelector('[data-directory-corrections-ready="true"]',{timeout:120000});
}
export async function main(argv=process.argv.slice(2)){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  required(['--receiving','--workspace','--out','--chromium','--playwright'].includes(argv[i])&&
   argv[i+1]&&!Object.hasOwn(args,argv[i]),'Use --receiving NATIVE_JSON --workspace RECEIVED_WORKSPACE --out PRIVATE_OUTPUT --chromium EXISTING_EXECUTABLE [--playwright MODULE].');
  args[argv[i]]=absolute(argv[i+1]);
 }
 for(const key of ['--receiving','--workspace','--out','--chromium'])required(args[key],key+' is required');
 process.umask(0o077);
 const out=args['--out'];await mkdir(out,{recursive:true,mode:0o700});await privateDirectory(out);
 const raw=await readSourceFile(args['--receiving'],{maxBytes:64*1024*1024}),
  native=originalDirectoryCorrectionsReceiving(JSON.parse(raw.toString('utf8')));
 const alias='corrections',journalPath=join(out,'CORRECTION_CLIENTS_JOURNEY.json'),sourceFiles={};
 for(const name of ['operate_correction_clients.mjs','public/directory-corrections.mjs',
  'public/directory-corrections.css','public/app.js','directory_corrections.py',
  'directory_corrections_schema.py','directory-corrections-schema.json','directory_server.py',
  'directory_receiving.py','directory_workspace.py','connected/catalog.mjs','connected/runtime.mjs','connected/client.mjs'])
  sourceFiles[name]=await fileIdentity(join(HERE,name),{maxBytes:4*1024*1024});
 const binding={operation:OPERATION,nativeSha256:digest(raw),nativeBytes:raw.length,workspaceId:native.workspaceId,
  workspace:args['--workspace'],output:out,sourceFiles};
 let journal,lease,owner,merchant,client,browser,context,receiverOwner,receiverClient,activeUI=null;
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
   object(state.directory.collections)&&state.directory.collections.corrections,
   'Open the complete original Directory and correction workspace.');
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

 async function operatorDescriptor(workspace){
  const descriptor=await readJSON(join(workspace,'directory','operator-connection.json'));
  required(descriptor.schema===OPERATOR_SCHEMA&&descriptor.active&&descriptor.workspaceId===native.workspaceId&&
   typeof descriptor.url==='string'&&typeof descriptor.accessToken==='string',
   'Keep the original active Directory operator and workspace identity.');
  return descriptor;
 }
 async function browserModule(){
  if(args['--playwright'])return import(pathToFileURL(args['--playwright']).href);
  const require=createRequire(import.meta.url),modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||
   '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
  return require(join(modules,'playwright'));
 }
 async function memory(){
  const value={at:now(),pid:process.pid};
  for(const name of ['memory.current','memory.max','memory.peak','memory.events','pids.current','pids.max']){
   try{value[name]=(await readFile('/sys/fs/cgroup/'+name,'utf8')).trim();}
   catch(error){value[name]={unavailable:error.code||error.message};}
  }
  return value;
 }
 async function startMerchant(connection){
  const setup=await initializeHumanServicesDirectoryMerchant({directory:join(out,'merchant'),connection,
   name:'Complete original Directory correction receiving'});
  const tokenEnv='DIRECTORY_CORRECTION_MCP_CODE',environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
  merchant=await startMerchantMcp({configPath:setup.configuration,port:0,tokenEnv,environment});
  client=await openHumanServicesDirectoryMerchantClient({url:merchant.url,tokenEnv,environment});
  return setup;
 }
 async function read(who,action,input){return (await invoke(who,action,input)).value;}
 async function openBrowser(phase,{readOnly=false}={}){
  const executable=await stat(args['--chromium']);required(executable.isFile()&&(executable.mode&0o111),'Use existing executable Chromium.');
  const {chromium}=await browserModule(),attempt={phase,before:await memory(),startedAt:now(),errors:[],blockedWrites:[]};
  journal.browserAttempts.push(attempt);await checkpoint();
  browser=await chromium.launch({headless:true,executablePath:args['--chromium'],args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
  page.on('pageerror',error=>attempt.errors.push({at:now(),message:error.message}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(['GET','HEAD'].includes(request.method()))return route.continue();
   if(readOnly){attempt.blockedWrites.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
   const found=/^\/api\/directory\/corrections\/(prepare|preview|apply|export)$/.exec(url.pathname);
   if(!found){attempt.blockedWrites.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
   if(found[1]==='export')return route.continue();
   required(activeUI&&activeUI.action===found[1],'Every authored UI mutation must retain its exact original request first.');
   const input=request.postDataJSON(),old=journal.ui.steps[activeUI.key];
   if(old)required(old.action===found[1]&&same(old.input,input),'Keep the exact interrupted original browser input.');
   else journal.ui.steps[activeUI.key]={action:found[1],input,state:'prepared',preparedAt:now()};
   await checkpoint();return route.continue();
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
  await directoryCorrectionsReady(page);
  required((await page.locator('#workspace-id').textContent())===native.workspaceId,'Open the exact original workspace UUID.');
 }

 async function openRecord(page,kind,id){
  await page.locator('[data-testid="dcw-history"]').click();
  await page.locator('[data-testid="dcw-library-kind"]').selectOption(kind);
  await page.locator('[data-testid="dcw-library-query"]').fill(id);
  await page.locator('[data-testid="dcw-library-read"]').click();
  await page.locator('[data-testid="dcw-record-'+id+'"]').click();
  await page.locator('[data-testid="dcw-review"][data-correction-record-id="'+id+'"]').waitFor({timeout:120000});
 }
 async function uiMutation(page,key,action,click){
  const old=journal.ui.steps[key],kind={prepare:'correctionPlans',preview:'correctionPreviews',apply:'corrections'}[action];
  required(kind,'Use a declared authored correction step.');
  if(old){
   if(old.state!=='complete'){
    const received=await changeHumanServicesDirectoryCorrection({client,workspace:alias,action:old.action,input:old.input,requestOptions:timeout});
    old.value=received.record;old.reconciliation=received.result;old.state='complete';old.completedAt=now();await checkpoint();
   }
   await openRecord(page,kind,old.value.id);return old.value;
  }
  activeUI={key,action};
  try{
   const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/directory/corrections/'+action&&
    response.request().method()==='POST',{timeout:600000});
   await click();const response=await waiting,value=await response.json();
   required(response.ok()&&hash(value?.id),'The original browser correction did not complete: '+action);
   const row=journal.ui.steps[key];required(row&&row.state==='prepared','The full original browser input must be retained before dispatch.');
   row.value=value;row.state='complete';row.completedAt=now();await checkpoint();
   await page.locator('[data-testid="dcw-review"][data-correction-record-id="'+value.id+'"]').waitFor({timeout:120000});
   return value;
  }finally{activeUI=null;}
 }
 async function screenshot(page,name){
  const file=join(out,name);await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
  return {file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
 }
 async function workingDownload(page,key){
  const pending=page.waitForEvent('download',{timeout:120000});
  await page.locator('[data-testid="dcw-working-download"]').click();const original=await pending;
  const file=join(out,'browser',key+'.json');await privateChild(dirname(file));await original.saveAs(file);await chmod(file,0o600);
  required(!await original.failure(),'Receive the full original browser working file.');
  const value=JSON.parse(await readFile(file,'utf8'));
  required(value.schema==='stellar-forge.directory-corrections-working.v1'&&value.workspaceId===native.workspaceId,
   'Retain the complete original browser draft.');
  return {descriptor:{file,...await fileIdentity(file,{maxBytes:33554432})},value};
 }
 async function browserAuthoring(){
  if(journal.ui.state==='complete'){for(const row of Object.values(journal.ui.files))await checkedFile(row);return;}
  const {page,attempt}=await openBrowser('complete-original-correction-authoring');
  try{
   await go(page,args['--workspace']);
   const originals=native.connectedInputs.replay.filter(row=>row.action==='prepare');
   required(originals.length>0,'The completed native course must retain original accepted plan inputs.');
   // Each native case contributes an explicit authored browser copy. Original plans remain untouched.
   for(const original of originals){
    const key=original.key,caseRow=journal.ui.cases[key]??(journal.ui.cases[key]={originalPlanId:original.expectedRecordId});
    if(caseRow.state==='complete')continue;
    if(!journal.ui.steps[key+'-prepare']){
     await openRecord(page,'correctionPlans',original.expectedRecordId);
     await page.locator('[data-testid="dcw-plan-draft"]').click();
     await page.locator('[data-testid="dcw-label"]').fill('Browser correction '+key+' — explicitly authored receiving');
     await page.locator('[data-testid="dcw-actor"]').fill('450E browser correction receiving');
     await page.locator('[data-testid="dcw-note"]').fill('Authored local copy of the exact original native correction case. No publisher update or live service availability is implied.');
     await page.locator('[data-testid="dcw-edit-0"]').click();
     const edit=original.input.edits[0];
     required(edit&&['json-set','json-remove','csv-cell','csv-row'].includes(edit.action),'Keep the original first edit.');
     await page.locator('[data-testid="dcw-action"]').selectOption(edit.action);
     if(edit.action.startsWith('json-')){
      await page.locator('[data-testid="dcw-pointer"]').fill(edit.pointer);
      if(edit.action==='json-set')await page.locator('[data-testid="dcw-value-json"]').fill(edit.valueJson);
     }else if(edit.action==='csv-cell'){
      await page.locator('[data-testid="dcw-column"]').fill(String(edit.column));
      await page.locator('[data-testid="dcw-cell"]').fill(edit.value);
     }else await page.locator('[data-testid="dcw-cells"]').fill(JSON.stringify(edit.cells,null,2));
     const reason=edit.reason+'\nExplicit original browser review of this exact retained value.';
     await page.locator('[data-testid="dcw-reason"]').fill(reason);
     const before=await workingDownload(page,key+'-unfinished');
     required(before.value.editor?.reason===reason&&before.value.editor.action===edit.action,
      'The complete unfinished original editor must travel with its exact input.');
     journal.ui.files[key+'-unfinished']=before.descriptor;await checkpoint();
     await page.reload({waitUntil:'domcontentloaded'});await directoryCorrectionsReady(page);
     required(await page.locator('[data-testid="dcw-reason"]').inputValue()===reason,
      'A cold page reload must retain the unfinished original editing value.');
     await page.locator('[data-testid="dcw-working-file"]').setInputFiles(before.descriptor.file);
     await page.waitForFunction(reason=>document.querySelector('[data-testid="dcw-reason"]')?.value===reason,reason,{timeout:120000});
     await page.locator('[data-testid="dcw-add-edit"]').click();
     const complete=await workingDownload(page,key+'-complete');
     required(complete.value.edits.length===original.input.edits.length&&complete.value.edits[0].reason===reason&&
      complete.value.editionId===original.input.editionId&&complete.value.editor===null,
      'The entire ordered request must remain available before save.');
     journal.ui.files[key+'-complete']=complete.descriptor;caseRow.working=complete.descriptor;await checkpoint();
    }
    const plan=await uiMutation(page,key+'-prepare','prepare',()=>page.locator('[data-testid="dcw-prepare"]').click());
    const preview=await uiMutation(page,key+'-preview','preview',()=>page.locator('[data-testid="dcw-preview"]').click());
    await page.locator('[data-testid="dcw-review-actor"]').fill('450E browser correction receiving');
    await page.locator('[data-testid="dcw-review-note"]').fill('Accept the exact reviewed browser candidate; preserve every original source and edition.');
    const correction=await uiMutation(page,key+'-apply','apply',()=>page.locator('[data-testid="dcw-apply"]').click());
    required(preview.planId===plan.id&&correction.previewId===preview.id&&
     correction.editionId===preview.candidateEditionId&&correction.beforeEditionId===plan.editionId,
     'The accepted browser correction must be the exact reviewed candidate.');
    Object.assign(caseRow,{planId:plan.id,previewId:preview.id,correctionId:correction.id,
     editionId:plan.editionId,candidateEditionId:preview.candidateEditionId,comparisonId:preview.comparisonId,
     state:'complete',completedAt:now()});await checkpoint();
   }
   // Continue an accepted derived directory-capture source through the same operator.
   const successorKey='accepted-edition-successor';
   const original=originals.find(row=>row.input.edits[0]?.action==='csv-cell');
   required(original,'The actual native course retains the original physical CSV-cell case.');
   const parent=journal.ui.cases[original.key];
   const successor=journal.ui.cases[successorKey]??(journal.ui.cases[successorKey]={parentCorrectionId:parent.correctionId});
   if(successor.state!=='complete'){
    if(!journal.ui.steps[successorKey+'-prepare']){
     const accepted=await read(client,'directory_record',{collection:'corrections',recordId:parent.correctionId});
     const originalEdit=original.input.edits[0],before=await read(client,'directory_source_row',
      {sourceId:originalEdit.sourceId,recordId:originalEdit.recordId});
     const pair=accepted.sources.find(row=>row.sourceId===originalEdit.sourceId);
     required(pair,'Retain the accepted original-to-derived source relation.');
     let offset=0,selected=null,total;
     while(true){
      const pageValue=await read(client,'directory_edition_rows',
       {editionId:accepted.editionId,table:before.table,offset,limit:100});
      required(pageValue.offset===offset&&Array.isArray(pageValue.rows)&&Number.isSafeInteger(pageValue.total)&&
       (total===undefined||total===pageValue.total),'Read every exact derived source row page.');
      total=pageValue.total;
      for(const row of pageValue.rows)if(row.sourceId===pair.derivedSourceId&&row.memberName==='source/'+before.memberName&&
       row.pointer===before.pointer&&row.rowOrdinal===before.rowOrdinal){
       required(selected===null,'The accepted original row must resolve to exactly one derived row.');selected=row;
      }
      if(pageValue.nextOffset===null)break;
      required(pageValue.rows.length>0&&pageValue.nextOffset===offset+pageValue.rows.length,
       'Follow contiguous original derived-row pages.');offset=pageValue.nextOffset;
     }
     required(selected,'The complete accepted source must retain the selected original row position.');
     const row=await read(client,'directory_edition_row',
      {editionId:accepted.editionId,sourceId:selected.sourceId,recordId:selected.recordId});
     required(row.protocol==='hsds'&&Array.isArray(row.cells)&&typeof row.cells[originalEdit.column]==='string',
      'The derived correction source must expose the original physical CSV row.');
     const authored=row.cells[originalEdit.column]+'\nExplicit subsequent local correction from the accepted edition.';
     await openRecord(page,'corrections',parent.correctionId);
     await page.locator('[data-testid="dcw-accepted-successor"]').click();
     required(await page.locator('[data-testid="dcw-edition"]').inputValue()===accepted.editionId,
      'Continue the exact accepted edition rather than the earlier source plan.');
     await page.locator('[data-testid="dcw-table"]').fill(before.table);
     await page.locator('[data-testid="dcw-query"]').fill(String(before.nativeId??''));
     await page.locator('[data-testid="dcw-read-rows"]').click();
     await page.locator('[data-testid="dcw-row-'+selected.recordId+'"]').click();
     await page.locator('[data-testid="dcw-action"]').selectOption('csv-cell');
     await page.locator('[data-testid="dcw-column"]').fill(String(originalEdit.column));
     await page.locator('[data-testid="dcw-cell"]').fill(authored);
     await page.locator('[data-testid="dcw-reason"]').fill('Explicit continuation from an accepted derived directory-capture source; preserve its complete earlier correction history.');
     await page.locator('[data-testid="dcw-add-edit"]').click();
     await page.locator('[data-testid="dcw-label"]').fill('Browser accepted-edition successor — original source retained');
     await page.locator('[data-testid="dcw-actor"]').fill('450E browser correction receiving');
     const working=await workingDownload(page,successorKey);
     required(working.value.editionId===accepted.editionId&&working.value.predecessorId===accepted.id&&
      working.value.edits.length===1&&working.value.edits[0].sourceId===pair.derivedSourceId,
      'The complete successor input must bind its accepted predecessor and derived original row.');
     journal.ui.files[successorKey]=working.descriptor;successor.working=working.descriptor;await checkpoint();
    }
    const plan=await uiMutation(page,successorKey+'-prepare','prepare',()=>page.locator('[data-testid="dcw-prepare"]').click());
    const preview=await uiMutation(page,successorKey+'-preview','preview',()=>page.locator('[data-testid="dcw-preview"]').click());
    await page.locator('[data-testid="dcw-review-actor"]').fill('450E browser correction receiving');
    await page.locator('[data-testid="dcw-review-note"]').fill('Accept the exact successor candidate with its original accepted predecessor retained.');
    const accepted=await uiMutation(page,successorKey+'-apply','apply',()=>page.locator('[data-testid="dcw-apply"]').click());
    required(plan.predecessorId===parent.correctionId&&plan.editionId===parent.candidateEditionId&&
     accepted.predecessorId===parent.correctionId&&accepted.beforeEditionId===parent.candidateEditionId&&
     accepted.editionId===preview.candidateEditionId,'Keep the complete accepted correction chain.');
    Object.assign(successor,{planId:plan.id,previewId:preview.id,correctionId:accepted.id,editionId:plan.editionId,
     candidateEditionId:preview.candidateEditionId,comparisonId:preview.comparisonId,state:'complete',completedAt:now()});
    await checkpoint();
   }
   const last=Object.values(journal.ui.cases).at(-1);
   required(last?.correctionId,'Retain the complete authored browser correction.');
   await openRecord(page,'corrections',last.correctionId);
   journal.ui.files.desktop=await screenshot(page,'Correction_Desktop.png');
   await page.setViewportSize({width:390,height:844});
   journal.ui.files.mobile=await screenshot(page,'Correction_Mobile.png');
   required(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The complete operator must remain usable at390px.');
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,'The complete correction editor must finish without page errors or unrelated writes.');
   journal.ui.state='complete';journal.ui.completedAt=now();await checkpoint();
  }finally{await closeBrowser(attempt);}
 }
 async function verifyNative(){
  for(const [key,row]of Object.entries(native.cases)){
   const plan=await call('native/'+key+'/plan','directory_record',{collection:'correctionPlans',recordId:row.planId}),
    preview=await call('native/'+key+'/preview','directory_record',{collection:'correctionPreviews',recordId:row.previewId}),
    correction=await call('native/'+key+'/correction','directory_record',{collection:'corrections',recordId:row.correctionId});
   required(plan.value.editionId===row.editionId&&preview.value.planId===row.planId&&
    preview.value.candidateEditionId===row.candidateEditionId&&preview.value.comparisonId===row.comparisonId&&
    correction.value.previewId===row.previewId&&correction.value.editionId===row.candidateEditionId&&
    correction.value.beforeEditionId===row.editionId,'The completed native correction basis changed: '+key);
  }
 }
 async function connectedCourse(){
  for(const row of native.connectedInputs.replay){
   const key='native-replay/'+row.key;
   const received=await call(key,'directory_correction_'+row.action,{['correction_'+row.action]:row.input});
   required(received.value.id===row.expectedRecordId,'Exact native request replay returned another record: '+row.key);
   journal.connected.replay[row.key]={action:row.action,recordId:received.value.id,result:received.result};await checkpoint();
  }
  const cases={...Object.fromEntries(Object.entries(native.cases).map(([k,v])=>['native-'+k,v])),
   ...Object.fromEntries(Object.entries(journal.ui.cases).map(([k,v])=>['browser-'+k,v]))};
  for(const [key,selected]of Object.entries(cases)){
   for(const [collection,recordId]of [['correctionPlans',selected.planId],['correctionPreviews',selected.previewId],['corrections',selected.correctionId]]){
    const readKey=key+'/'+collection;
    if(!journal.connected.reads[readKey]){
     const readback=await readHumanServicesDirectoryCorrection({client,workspace:alias,collection,recordId,requestOptions:timeout});
     journal.connected.reads[readKey]=await jsonFile('corrections/'+readKey+'/record.json',readback);await checkpoint();
    }
    for await(const {page,result}of iterateHumanServicesDirectoryCorrection({client,workspace:alias,collection,recordId,limit:25,requestOptions:timeout})){
     await observedJSON('corrections/'+readKey+'/pages/'+page.offset+'.json',{page,result},value=>value.page);
    }
    const files=collection==='correctionPlans'?['input']:['changes','review'];
    for(const fileKind of files){
     const record=(await call('complete-records/'+collection+'/'+recordId,'directory_record',{collection,recordId})).value;
     await packetFile('corrections/'+readKey+'/'+fileKind,'directory_correction_file',{collection,recordId,fileKind},record.files[fileKind]);
    }
   }
   const plan=(await call('complete-records/correctionPlans/'+selected.planId,'directory_record',{collection:'correctionPlans',recordId:selected.planId})).value,
    correction=(await call('complete-records/corrections/'+selected.correctionId,'directory_record',{collection:'corrections',recordId:selected.correctionId})).value;
   for(const editionId of [selected.editionId,selected.candidateEditionId])
    await packetFile('indices/editions/'+editionId,'directory_index_file',{collection:'editions',recordId:editionId},null);
   await packetFile('indices/comparisons/'+selected.comparisonId,'directory_index_file',{collection:'comparisons',recordId:selected.comparisonId},null);
   await packetFile('changes/'+selected.comparisonId,'directory_comparison_changes_file',{comparisonId:selected.comparisonId},null);
   for(const selectedSource of correction.sources){
    for(const [sourceId,expected]of [[selectedSource.sourceId,selectedSource.originalFile],[selectedSource.derivedSourceId,selectedSource.derivedFile]])
     await packetFile('source-files/'+sourceId,'directory_source_file',{sourceId},expected);
   }
   const input={correctionId:correction.id,actor:'450E complete correction client receiving',label:'Complete correction receiving '+key,note:'Retain original and derived source files, ordered changes and exact accepted candidate.'};
   const exported=await call('correction-exports/'+key,'directory_correction_export',{correction_export:input});
   required(exported.value.kind==='correction'&&exported.value.recordId===correction.id,'Keep the exact native correction packet.');
   const downloaded=await packetFile('correction-packets/'+key,'directory_export_file',{exportId:exported.value.id},exported.value.file);
   journal.connected.exports[key]={record:exported.value,file:downloaded.artifact};await checkpoint();
  }
  journal.connected.state='complete';journal.connected.completedAt=now();await checkpoint();
 }
 async function observeReopenedBrowser(workspace,label){
  const {page,attempt}=await openBrowser(label,{readOnly:true});
  try{
   await go(page,workspace);
   for(const row of Object.values(journal.ui.cases)){
    for(const [kind,id]of [['correctionPlans',row.planId],['correctionPreviews',row.previewId],['corrections',row.correctionId]])
     await openRecord(page,kind,id);
   }
   const image=await screenshot(page,label+'.png');
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,'Reopen all original correction stages without authoring another candidate.');
   return {image,cases:journal.ui.cases,readOnly:true,allStagesReopened:true};
  }finally{await closeBrowser(attempt);}
 }
 async function receiveCustomer(packet,expected){
  const target=join(out,'customer-workspace'),connection=join(out,'customer-connection.json');
  const configuration={schema:CONNECTION_SCHEMA,workspaces:{corrections:{directory:target,
   label:'Complete received customer source-correction workspace',allowStart:true,
   inputs:{'complete-workspace':{file:packet.file,sha256:packet.sha256,label:'Original complete reviewed workspace'}}}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep the exact customer original packet selection.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  receiverOwner=new HumanServicesDirectoryConnection(config.workspaces.corrections);await receiverOwner.open();
  receiverClient=await openHumanServicesDirectoryLocalClient({connection,exportsDirectory:join(out,'customer-exports')});
  const imported=await receiverClient.call('directory_workspace_import',
   {workspace:alias,input:'complete-workspace',expectedSha256:packet.sha256},timeout);
  required(imported.native?.ok&&imported.retention?.state==='COMPLETE','Complete customer receiving failed.');
  const value=await readHumanServicesDirectoryValue({client:receiverClient,result:imported});
  required(value.workspaceId===native.workspaceId&&value.archiveSha256===packet.sha256&&value.reconstructed===true,
   'The original complete customer workspace was not reconstructed.');
  const receiveRow=await read(receiverClient,'directory_record',{collection:'receives',recordId:packet.sha256});
  required(receiveRow.id===packet.sha256&&receiveRow.archiveSha256===packet.sha256&&receiveRow.kind==='workspace'&&
   receiveRow.state==='complete'&&receiveRow.workspaceId===native.workspaceId,
   'Retain the actual complete native customer receive receipt.');
  const current=await inventory(receiverClient,'customer',expected);
  for(const collection of ['correctionPlans','correctionPreviews','corrections'])
   for(const id of Object.keys(expected[collection]??{})){
    const full=await readHumanServicesDirectoryCorrection({client:receiverClient,workspace:alias,collection,recordId:id,requestOptions:timeout});
    required(full.record.id===id,'Customer full original correction did not reopen.');
   }
  const observation=await observeReopenedBrowser(target,'Correction_Customer_Reopened');
  const customerPacket=await packetFile('complete-received-customer-workspace','directory_workspace_packet',{},null,{who:receiverClient});
  journal.customer={workspace:target,workspaceId:native.workspaceId,archiveSha256:packet.sha256,
   completeRecords:current.count,allOriginalRecordsEqual:true,reopened:true,browser:observation,
   workspacePacket:customerPacket.artifact,
   receive:await observedJSON('customer/Original_Receive.json',receiveRow,
    row=>({workspaceId:row.workspaceId,archiveSha256:row.archiveSha256,kind:row.kind,state:row.state,id:row.id,completed:row.completed}))};
  journal.workspacePacket=customerPacket.artifact;
  await checkpoint();
 }
 try{
  lease=await operationLease(join(out,'correction-clients.lock'));
  journal=await readJSON(journalPath,true);
  if(journal)required(journal.schema===JOURNEY_SCHEMA&&same(journal.binding,binding),'Resume the original complete source and native result.');
  else journal={schema:JOURNEY_SCHEMA,operation:OPERATION,binding,createdAt:now(),calls:{},downloads:{},
   ui:{state:'prepared',steps:{},files:{},cases:{}},connected:{state:'prepared',replay:{},reads:{},histories:{},exports:{}},
   browserAttempts:[],failures:[]};
  await checkpoint();
  if(journal.result){
   await checkedFile(journal.result);const result=await readJSON(journal.result.file);await checkedFile(result.workspacePacket);
   required(result.schema===RESULT_SCHEMA&&result.nativeSha256===binding.nativeSha256,'The completed original result changed.');
   emit('DIRECTORY_CORRECTION_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket,recovered:true});
   return result;
  }
  const connection=join(out,'corrections-connection.json'),configuration={schema:CONNECTION_SCHEMA,
   workspaces:{corrections:{directory:args['--workspace'],label:'Original complete source-correction workspace',allowStart:true}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep the selected original workspace.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  owner=new HumanServicesDirectoryConnection(config.workspaces.corrections);await owner.open();await startMerchant(connection);
  if(!journal.originalRecords){
   const before=await inventory(client,'original');journal.originalRecords=before.records;journal.originalInventory=before.file;await checkpoint();
  }
  for(const [key,sha256]of Object.entries(native.originalDirectoryRecordHashes)){
   const at=key.indexOf('/'),collection=key.slice(0,at),recordId=key.slice(at+1);
   required(at>0&&hash(recordId)&&hash(sha256),'Keep the exact inherited original record hash map.');
   const observed=await call('original-basis/'+collection+'/'+recordId,'directory_record',{collection,recordId},{fresh:true});
   required(observed.response.sha256===sha256,'An original completed Directory record changed: '+key);
  }
  await verifyNative();await browserAuthoring();await connectedCourse();
  const final=await inventory(client,'final',journal.finalRecords??null);journal.finalRecords??=final.records;await checkpoint();
  for(const [kind,rows]of Object.entries(journal.originalRecords))
   for(const [id,identity]of Object.entries(rows))required(same(final.records[kind]?.[id],identity),'Original native record changed.');
  await client.close();client=null;await merchant.close();merchant=null;
  await startMerchant(connection);await inventory(client,'merchant-reopened',journal.finalRecords);
  journal.reopened=await observeReopenedBrowser(args['--workspace'],'Correction_Merchant_Reopened');await checkpoint();
  const packet=await packetFile('complete-correction-workspace','directory_workspace_packet',{},null);
  journal.sourceWorkspacePacket=packet.artifact;await checkpoint();
  await client.close();client=null;await merchant.close();merchant=null;await owner.close();owner=null;
  await receiveCustomer(journal.sourceWorkspacePacket,journal.finalRecords);
  journal.completedAt??=now();await checkpoint();
  const result={schema:RESULT_SCHEMA,operation:OPERATION,completedAt:journal.completedAt,...binding,
   sourceRoot:HERE,nativeReceiving:{file:args['--receiving'],bytes:raw.length,sha256:digest(raw)},
   originalDirectoryReceiving:native.originalDirectoryReceiving,originalCases:native.cases,
   correctionRecordIds:Object.keys(journal.finalRecords.corrections),recordIds:Object.fromEntries(Object.entries(journal.finalRecords).map(([kind,rows])=>[kind,Object.keys(rows)])),
   browser:journal.ui,connected:journal.connected,
   reopened:journal.reopened,customer:journal.customer,sourceWorkspacePacket:journal.sourceWorkspacePacket,
   workspacePacket:journal.workspacePacket,
   allOriginalRecordsRetained:true,journal:journalPath,
   meaning:'Explicitly authored original-row correction, full SDK/MCP file receiving and reopened customer workspace. Original source bytes and historical editions remain retained. No external publisher update, customer acceptance or live service availability is inferred.'};
  journal.result=await jsonFile('OPERATED_DIRECTORY_CORRECTION_CLIENTS.json',result);await checkpoint();
  emit('DIRECTORY_CORRECTION_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket});return result;
 }catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack,resources:await memory()});await checkpoint();}
  emit('DIRECTORY_CORRECTION_CLIENTS_INTERRUPTED',{journal:journalPath,error:{code:error.code||error.name,message:error.message}});throw error;
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await receiverClient?.close().catch(()=>{});await receiverOwner?.close().catch(()=>{});
  await client?.close().catch(()=>{});await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  try{if(journal)await checkpoint();}finally{await lease?.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write((error.stack||error.message)+'\n');process.exitCode=1;});
