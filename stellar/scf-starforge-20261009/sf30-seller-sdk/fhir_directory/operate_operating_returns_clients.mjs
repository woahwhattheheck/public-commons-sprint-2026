#!/usr/bin/env node
// MIT. Complete return editor, exact connected replay and fresh customer receiving.
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
 readHumanServicesDirectoryValue,readHumanServicesDirectoryOperatingPlan,
 readHumanServicesDirectoryOperatingReturn,changeHumanServicesDirectoryOperatingReturn,
 iterateHumanServicesDirectoryOperatingReturn,downloadHumanServicesDirectoryOperatingReturnFile,
 downloadHumanServicesDirectoryOperatingReturn,downloadHumanServicesDirectoryExport,
 reopenHumanServicesDirectoryExport} from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';
import {operatingPlanDraft,saveOperatingPlanRevision,forkOperatingPlan,createOperatingStep}
 from '../../distribution/discovery/operating-plan.mjs';
const OPERATION='SCF-DIRECTORY-CUSTOMER-RETURN-CLIENTS-450E-20261013';
const NATIVE_SCHEMA='stellar-forge.directory-operating-returns-operated.v1';
const RESULT_SCHEMA='stellar-forge.directory-operating-returns-clients-operated.v1';
const JOURNEY_SCHEMA='stellar-forge.directory-operating-returns-clients-journey.v1';
const HERE=dirname(fileURLToPath(import.meta.url)),timeout={timeoutMs:600000};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=x=>typeof x==='string'&&new RegExp(SHA).test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const required=(condition,message)=>need(condition,'DIRECTORY_CUSTOMER_RETURN_RECEIVING',message);
const PRIVATE_MUTABLE=new Set(['acquisitions','receives']);
export function originalDirectoryOperatingReturnsReceiving(value){
 required(value?.schema===NATIVE_SCHEMA&&value.operation==='SCF-DIRECTORY-CUSTOMER-RETURN-450E-20261013'&&
  value.completedAt&&new RegExp(UUID).test(value.workspaceId||'')&&
  Array.isArray(value.returnRecordIds)&&value.returnRecordIds.length&&value.returnRecordIds.every(hash)&&
  ['preparedReturnId','completedReturnId','appliedReturnId','latestPlanRecordId'].every(k=>hash(value[k]))&&
  value.connectedInputs?.prepare&&value.connectedInputs?.apply&&hash(value.workspacePacket?.sha256)&&
  value.restoration?.reopened===true&&value.restoration?.allOriginalRecordsEqual===true,
  'Select the actual completed native return course, exact original UUID and complete editable packet.');
 return value;
}
export async function directoryOperatingReturnsReady(page){
 await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
 await page.locator('[data-nav="operatingReturns"]').click();
 await page.waitForSelector('[data-operating-returns-ready="true"]',{timeout:120000});
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
  native=originalDirectoryOperatingReturnsReceiving(JSON.parse(raw.toString('utf8')));
 const alias='returns',journalPath=join(out,'OPERATING_RETURNS_CLIENTS_JOURNEY.json'),sourceFiles={};
 for(const name of ['operate_operating_returns_clients.mjs','public/directory-operating-returns.mjs',
  'public/directory-operating-returns.css','public/app.js','directory_operating_returns.py',
  'directory_operating_return_bridge.mjs','directory-operating-returns-schema.json','directory_server.py',
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
   name:'Complete original Directory returned-procedure receiving'});
  const tokenEnv='DIRECTORY_CUSTOMER_RETURN_MCP_CODE',environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
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
   const found=/^\/api\/directory\/operating-returns\/(prepare|revise|complete|apply|receive|export)$/.exec(url.pathname);
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
  await directoryOperatingReturnsReady(page);
  required((await page.locator('#workspace-id').textContent())===native.workspaceId,'Open the exact original workspace UUID.');
 }
 async function openRecord(page,id){
  const search=page.getByRole('searchbox',{name:'Find returned procedures'});
  await search.fill(id);await search.dispatchEvent('change');
  await page.locator('[data-testid="dor-record-'+id+'"]').click();
  await page.locator('[data-testid="dor-rows"]').waitFor({state:'visible',timeout:120000});
 }
 async function uiMutation(page,key,action,click){
  const old=journal.ui.steps[key];
  if(old){
   if(old.state!=='complete'){
    const received=await changeHumanServicesDirectoryOperatingReturn({client,workspace:alias,action:old.action,input:old.input,requestOptions:timeout});
    old.value=received.saved;old.reconciliation=received.result;old.state='complete';old.completedAt=now();await checkpoint();
   }
   await openRecord(page,old.value.record.id);return old.value;
  }
  activeUI={key,action};
  try{
   const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/directory/operating-returns/'+action&&
    response.request().method()==='POST',{timeout:600000});
   await click();const response=await waiting,value=await response.json();
   required(response.ok()&&hash(value?.record?.id),'The original browser action did not complete: '+action);
   const row=journal.ui.steps[key];required(row&&row.state==='prepared','The exact original browser request was not retained.');
   row.value=value;row.state='complete';row.completedAt=now();await checkpoint();
   await page.locator('[data-testid="dor-rows"]').waitFor({state:'visible',timeout:120000});
   return value;
  }finally{activeUI=null;}
 }
 async function screenshot(page,name){
  const file=join(out,name);await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
  return {file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
 }
 async function browserAuthoring(){
  if(journal.ui.state==='complete'){for(const row of Object.values(journal.ui.files))await checkedFile(row);return;}
  const {page,attempt}=await openBrowser('complete-return-authoring');
  try{
   await go(page,args['--workspace']);
   if(!journal.ui.incoming){
    const original=await readHumanServicesDirectoryOperatingPlan({client,workspace:alias,
      recordId:native.latestPlanRecordId,requestOptions:timeout});
    journal.ui.createdAt??=now();
    const fork=forkOperatingPlan(original.document,{id:original.document.id+'-browser-return',savedAt:journal.ui.createdAt}),
     draft=operatingPlanDraft(fork);
    draft.content.title='Browser receiving — complete returned Directory procedure';
    draft.content.notes+='\n\nExplicitly authored browser receiving example; no external response is implied.';
    draft.content.steps.push(createOperatingStep({id:'browser-complete-return-review',
      title:'Review the complete returned procedure',instruction:'Retain all source histories and explicit reviewed choices.',
      inputs:'The original complete native Directory and returned procedure.',
      expectedResult:'The full reviewed history reopens in the received customer workspace.',owner:'450E browser receiving'}));
    const incoming=saveOperatingPlanRevision(fork,draft,{savedAt:journal.ui.createdAt});
    journal.ui.incoming=await jsonFile('browser/Original_Authored_Returned_Plan.json',incoming);
    journal.ui.reviewId='directory-browser-return-450e-20261013';await checkpoint();
   }
   if(!journal.ui.steps.prepare){
    await page.locator('[data-testid="dor-new"]').click();
    await page.locator('[data-testid="dor-actor"]').fill('450E complete browser return receiving');
    await page.locator('[data-testid="dor-action-note"]').fill('Explicitly authored original browser course.');
    await page.locator('[data-testid="dor-current-record"]').fill(native.latestPlanRecordId);
    await page.locator('[data-testid="dor-incoming-file"]').setInputFiles(journal.ui.incoming.file);
    await page.locator('[data-testid="dor-review-id"]').fill(journal.ui.reviewId);
    await page.locator('[data-testid="dor-reviewer"]').fill('450E browser receiving');
    await page.locator('[data-testid="dor-notes"]').fill('Keep the complete current and incoming histories.');
   }
   const prepared=await uiMutation(page,'prepare','prepare',()=>page.locator('[data-testid="dor-prepare"]').click());
   if(!journal.ui.steps.review){
    const full=await readHumanServicesDirectoryOperatingReturn({client,workspace:alias,
      recordId:prepared.record.id,requestOptions:timeout});
    const row=full.comparison.rows.find(row=>row.kind==='step-presence'&&row.stepId==='browser-complete-return-review');
    required(row&&object(row.incoming),'The authored complete added step must have an original comparison row.');
    // Navigate actual complete UI pages until the exact selected original row is visible.
    for(let count=0;count<1000;count++){
     if(await page.locator('[data-return-key="'+row.key+'"]').count())break;
     const next=page.locator('[data-testid="dor-next"]');required(await next.count(),'The complete comparison row was not exposed.');
     await next.click();await page.waitForTimeout(25);
    }
    let container=page.locator('[data-return-key="'+row.key+'"]');
    await container.locator('[data-testid="dor-choice"]').selectOption('custom');
    await container.locator('[data-testid="dor-custom-value"]').fill('{"unfinished":');
    const downloadWait=page.waitForEvent('download');await page.locator('[data-testid="dor-save-draft"]').click();
    const download=await downloadWait,draftPath=join(out,'browser','Unfinished_Original_Return_Working.json');
    await download.saveAs(draftPath);await chmod(draftPath,0o600);
    journal.ui.files.unfinished={file:draftPath,...await fileIdentity(draftPath,{maxBytes:256*1024*1024})};
    const working=await readJSON(draftPath);
    required(working.choices[row.key].raw==='{"unfinished":','The complete working file lost unfinished JSON.');
    await page.reload({waitUntil:'domcontentloaded'});await directoryOperatingReturnsReady(page);
    for(let count=0;count<1000&&!await page.locator('[data-return-key="'+row.key+'"]').count();count++)
      await page.locator('[data-testid="dor-next"]').click();
    container=page.locator('[data-return-key="'+row.key+'"]');
    required(await container.locator('[data-testid="dor-custom-value"]').inputValue()==='{"unfinished":',
      'Browser reload must preserve the complete unfinished original choice.');
    await container.locator('[data-testid="dor-custom-value"]').fill(JSON.stringify(row.incoming,null,2));
    await container.locator('[data-testid="dor-choice-note"]').fill('Explicitly reviewed complete incoming step, retained as a custom whole-step choice.');
    journal.ui.unfinishedChoicePreserved=true;await checkpoint();
   }
   const reviewed=await uiMutation(page,'review','revise',()=>page.locator('[data-testid="dor-save-review"]').click());
   const full=await readHumanServicesDirectoryOperatingReturn({client,workspace:alias,recordId:reviewed.record.id,requestOptions:timeout});
   required(full.comparison.ready&&full.comparison.unresolved.length===0,'Every original choice must be resolved before completion.');
   const completed=await uiMutation(page,'complete','complete',()=>page.locator('[data-testid="dor-complete"]').click());
   await page.locator('[data-testid="dor-read-head"]').click();
   await page.waitForFunction(()=>Boolean(document.querySelector('[data-testid="dor-expected-record"]')?.value));
   const applied=await uiMutation(page,'apply','apply',()=>page.locator('[data-testid="dor-apply"]').click());
   required(applied.record.predecessorRecordId===completed.record.id&&hash(applied.plan?.id),'Keep complete intent and actual native plan receipt.');
   journal.ui.recordId=applied.record.id;journal.ui.planRecordId=applied.plan.id;
   journal.ui.files.desktop=await screenshot(page,'Return_Operator_Desktop.png');
   await page.setViewportSize({width:390,height:844});
   required(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'The complete return operator must fit the mobile viewport.');
   journal.ui.files.mobile=await screenshot(page,'Return_Operator_Mobile.png');
   for(const format of ['json','html','plan']){
    const wait=page.waitForEvent('download');await page.locator('[data-testid="dor-export-'+format+'"]').click();
    const downloaded=await wait,file=join(out,'browser','Original_UI_Return.'+(format==='html'?'html':format+'.json'));
    await downloaded.saveAs(file);await chmod(file,0o600);
    journal.ui.files[format]={file,...await fileIdentity(file,{maxBytes:512*1024*1024})};
   }
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,'The full browser journey produced errors or an unintended write.');
   journal.ui.state='complete';journal.ui.completedAt=now();await checkpoint();
  }finally{await closeBrowser(attempt);}
 }
 async function verifyNative(){
  for(const [kind,ids]of Object.entries(native.recordIds)){
   if(PRIVATE_MUTABLE.has(kind))continue;
   for(const id of ids)required(journal.originalRecords[kind]?.[id],'Missing original native '+kind+'/'+id);
  }
  for(const id of native.returnRecordIds){
   const full=await readHumanServicesDirectoryOperatingReturn({client,workspace:alias,recordId:id,requestOptions:timeout});
   required(full.record.workspaceId===native.workspaceId&&full.record.currentRecordId===native.currentPlanRecordId,
    'The native return is bound to another saved plan or workspace.');
  }
 }
 async function connectedCourse(){
  const schemaArgs=humanServicesDirectoryActions.schema.inputSchema.properties?.workspace?{workspace:alias}:{},
   catalogue=await client.call('schema',schemaArgs,timeout);
  const expected=Object.keys(humanServicesDirectoryActions);
  required(expected.every(name=>JSON.stringify(catalogue).includes(name)),'The original connected catalogue must include every action.');
  journal.connected.catalogue=await observedJSON('connected/Complete_Catalogue.json',catalogue);
  const replay=[['prepare',native.connectedInputs.prepare,native.preparedReturnId],
   ...native.connectedInputs.revisions.map((input,index)=>['revise',input,null]),
   ['complete',native.connectedInputs.complete,native.completedReturnId],
   ['apply',native.connectedInputs.apply,native.appliedReturnId],
   ['apply',native.connectedInputs.historicalApply,native.historicalReturnId],
   ['receive',native.connectedInputs.receive,native.receivedReturnId]];
  for(let index=0;index<replay.length;index++){
   const [action,input,id]=replay[index],key='connected-replay-'+index;
   if(journal.connected.replay[key])continue;
   const result=await changeHumanServicesDirectoryOperatingReturn({client,workspace:alias,action,input,requestOptions:timeout});
   required(result.saved.reused&&(!id||result.saved.record.id===id),'Exact accepted native action replay changed its original result.');
   journal.connected.replay[key]=await jsonFile('connected/'+key+'.json',result);await checkpoint();
  }
  const rows=await collection(client,'operatingPlanReturns');
  for(const record of rows){
   const full=await readHumanServicesDirectoryOperatingReturn({client,workspace:alias,recordId:record.id,requestOptions:timeout});
   let count=0;
   for await(const {page,result}of iterateHumanServicesDirectoryOperatingReturn({client,workspace:alias,
    recordId:record.id,limit:2,requestOptions:timeout})){
    await observedJSON('connected/pages/'+record.id+'/'+page.offset+'.json',{page,result},value=>value.page);
    for(const row of page.rows)required(same(row,full.comparison.rows[count++]),'A complete original comparison row changed.');
   }
   required(count===full.comparison.rows.length,'Retain every original comparison row.');
   journal.connected.reads[record.id]=await observedJSON('connected/reviews/'+record.id+'.json',full,
    value=>({record:value.record,review:value.review,comparison:value.comparison,input:value.input}));
   for(const kind of ['review','comparison','input'])
    await packetFile('return-'+record.id+'-'+kind,'directory_operating_return_file',
     {recordId:record.id,fileKind:kind},record.files[kind]);
   const plan=await readHumanServicesDirectoryOperatingPlan({client,workspace:alias,
    recordId:record.appliedPlanRecordId??record.currentRecordId,revision:1,requestOptions:timeout});
   journal.connected.histories[record.id]=await observedJSON('connected/histories/'+record.id+'.json',plan,
    value=>({document:value.document,basis:value.basis,input:value.input,draft:value.draft}));
   await checkpoint();
  }
  for(const format of ['json','html','plan']){
   const key='reviewed-'+format;
   if(journal.connected.exports[key]){
    const previous=journal.connected.exports[key];
    await reopenHumanServicesDirectoryExport({workspace:alias,exportId:previous.result.exportId,
     expectedManifestSha256:previous.result.manifestSha256,directory:previous.receipt.directory});continue;
   }
   journal.connected.exports[key]=await downloadHumanServicesDirectoryOperatingReturn({client,workspace:alias,
    input:{recordId:journal.ui.recordId,format,actor:'450E connected receiving',note:'Full local receiving through the original transport.'},
    directory:join(out,'connected','exports',format),requestOptions:timeout});
   await checkpoint();
  }
  journal.connected.state='complete';await checkpoint();
 }
 async function observeReopenedBrowser(workspace,label,recordId){
  const {page,attempt}=await openBrowser(label,{readOnly:true});
  try{
   await go(page,workspace);await openRecord(page,recordId);
   const image=await screenshot(page,label+'.png');
   await page.locator('[data-testid="dor-predecessor"]').click();
   await page.locator('[data-testid="dor-rows"]').waitFor();
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,'Reopening must preserve original records without authoring another review.');
   return {image,recordId,predecessorReopened:true,readOnly:true};
  }finally{await closeBrowser(attempt);}
 }
 async function receiveCustomer(packet,expected){
  const target=join(out,'customer-workspace'),connection=join(out,'customer-connection.json');
  const configuration={schema:CONNECTION_SCHEMA,workspaces:{returns:{directory:target,
   label:'Complete received customer returned-procedure workspace',allowStart:true,
   inputs:{'complete-workspace':{file:packet.file,sha256:packet.sha256,label:'Original complete reviewed workspace'}}}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep the exact customer original packet selection.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  receiverOwner=new HumanServicesDirectoryConnection(config.workspaces.returns);await receiverOwner.open();
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
  for(const id of Object.keys(expected.operatingPlanReturns)){
   const full=await readHumanServicesDirectoryOperatingReturn({client:receiverClient,workspace:alias,recordId:id,requestOptions:timeout});
   required(full.record.id===id,'Customer full original review did not reopen.');
  }
  const observation=await observeReopenedBrowser(target,'Return_Customer_Reopened',journal.ui.recordId);
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
  lease=await operationLease(join(out,'operating-returns-clients.lock'));
  journal=await readJSON(journalPath,true);
  if(journal)required(journal.schema===JOURNEY_SCHEMA&&same(journal.binding,binding),'Resume the original complete source and native result.');
  else journal={schema:JOURNEY_SCHEMA,operation:OPERATION,binding,createdAt:now(),calls:{},downloads:{},
   ui:{state:'prepared',steps:{},files:{}},connected:{state:'prepared',replay:{},reads:{},histories:{},exports:{}},
   browserAttempts:[],failures:[]};
  await checkpoint();
  if(journal.result){
   await checkedFile(journal.result);const result=await readJSON(journal.result.file);await checkedFile(result.workspacePacket);
   required(result.schema===RESULT_SCHEMA&&result.nativeSha256===binding.nativeSha256,'The completed original result changed.');
   emit('DIRECTORY_OPERATING_RETURNS_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket,recovered:true});
   return result;
  }
  const connection=join(out,'returns-connection.json'),configuration={schema:CONNECTION_SCHEMA,
   workspaces:{returns:{directory:args['--workspace'],label:'Original complete returned-procedure workspace',allowStart:true}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep the selected original workspace.');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  owner=new HumanServicesDirectoryConnection(config.workspaces.returns);await owner.open();await startMerchant(connection);
  if(!journal.originalRecords){
   const before=await inventory(client,'original');journal.originalRecords=before.records;journal.originalInventory=before.file;await checkpoint();
  }
  await verifyNative();await browserAuthoring();await connectedCourse();
  const final=await inventory(client,'final',journal.finalRecords??null);journal.finalRecords??=final.records;await checkpoint();
  for(const [kind,rows]of Object.entries(journal.originalRecords))
   for(const [id,identity]of Object.entries(rows))required(same(final.records[kind]?.[id],identity),'Original native record changed.');
  await client.close();client=null;await merchant.close();merchant=null;
  await startMerchant(connection);await inventory(client,'merchant-reopened',journal.finalRecords);
  journal.reopened=await observeReopenedBrowser(args['--workspace'],'Return_Merchant_Reopened',journal.ui.recordId);await checkpoint();
  const packet=await packetFile('complete-return-workspace','directory_workspace_packet',{},null);
  journal.sourceWorkspacePacket=packet.artifact;await checkpoint();
  await client.close();client=null;await merchant.close();merchant=null;await owner.close();owner=null;
  await receiveCustomer(journal.sourceWorkspacePacket,journal.finalRecords);
  journal.completedAt??=now();await checkpoint();
  const result={schema:RESULT_SCHEMA,operation:OPERATION,completedAt:journal.completedAt,...binding,
   sourceRoot:HERE,nativeReceiving:{file:args['--receiving'],bytes:raw.length,sha256:digest(raw)},
   originalDirectoryReceiving:native.originalDirectoryReceiving,originalReturnIds:native.returnRecordIds,
   returnRecordIds:Object.keys(journal.finalRecords.operatingPlanReturns),browser:journal.ui,connected:journal.connected,
   reopened:journal.reopened,customer:journal.customer,sourceWorkspacePacket:journal.sourceWorkspacePacket,
   workspacePacket:journal.workspacePacket,
   allOriginalRecordsRetained:true,journal:journalPath,
   meaning:'Explicitly authored browser review, full SDK/MCP receiving and reopened customer workspace. No external customer response, provider acquisition or plan-step execution is inferred.'};
  journal.result=await jsonFile('OPERATED_DIRECTORY_OPERATING_RETURNS_CLIENTS.json',result);await checkpoint();
  emit('DIRECTORY_OPERATING_RETURNS_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket});return result;
 }catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack,resources:await memory()});await checkpoint();}
  emit('DIRECTORY_OPERATING_RETURNS_CLIENTS_INTERRUPTED',{journal:journalPath,error:{code:error.code||error.name,message:error.message}});throw error;
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await receiverClient?.close().catch(()=>{});await receiverOwner?.close().catch(()=>{});
  await client?.close().catch(()=>{});await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  try{if(journal)await checkpoint();}finally{await lease?.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write((error.stack||error.message)+'\n');process.exitCode=1;});
