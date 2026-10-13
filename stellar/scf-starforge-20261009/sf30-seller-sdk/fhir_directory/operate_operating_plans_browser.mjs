#!/usr/bin/env node
// MIT. Complete native editor, connected client and original-history receiving.
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,stat,chmod} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {HumanServicesDirectoryConnection,readHumanServicesDirectoryConfiguration} from './connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,canonical,SHA,MANIFEST_NAME} from './connected/contracts.mjs';
import {humanServicesDirectoryActions} from './connected/catalog.mjs';
import {initializeHumanServicesDirectoryMerchant} from './connected/setup.mjs';
import {
 openHumanServicesDirectoryMerchantClient,openHumanServicesDirectoryLocalClient,
 readHumanServicesDirectoryValue,readHumanServicesDirectoryOperatingPlan,
 downloadHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport,
 downloadHumanServicesDirectoryOperatingPlan
} from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';

const OPERATION='SCF-DIRECTORY-OPERATING-PLANS-CLIENTS-450E-20261012';
const RESULT_SCHEMA='stellar-forge.directory-operating-plans-clients-operated.v1';
const NATIVE_SCHEMA='stellar-forge.directory-operating-plans-operated.v1';
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const selectedRecord=value=>value?.record?.id??value?.id;
const requiredHash=value=>typeof value==='string'&&new RegExp(SHA).test(value);

export function originalDirectoryOperatingPlansReceiving(value){
 need(value?.schema===NATIVE_SCHEMA&&value.workspaceId&&requiredHash(value.planRecordId)&&
   requiredHash(value.copyRecordId)&&Array.isArray(value.operatingPlanRecordIds)&&value.operatingPlanRecordIds.length&&
   value.operatingPlanRecordIds.every(requiredHash)&&value.connectedInputs?.preview&&value.recordIds&&
   value.workspacePacket?.bytes>0&&requiredHash(value.workspacePacket?.sha256),
   'DIRECTORY_OPERATING_NATIVE_RESULT_REQUIRED','Select the complete original native Operating Plans result.');
 return value;
}
export async function directoryOperatingPlansReady(page){
 await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
 await page.locator('[data-nav="operatingPlans"]').click();
 await page.waitForSelector('[data-operating-plans-ready="true"]',{timeout:120000});
}
export async function main(argv=process.argv.slice(2)){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  need(['--receiving','--workspace','--out','--chromium','--playwright'].includes(key)&&value&&
    !value.startsWith('--')&&!Object.hasOwn(args,key),'DIRECTORY_OPERATING_CLIENTS_ARGUMENTS',
    'Use --receiving OPERATED_DIRECTORY_OPERATING_PLANS.json --workspace ORIGINAL_PLAN_WORKSPACE --out PRIVATE_OUTPUT --chromium EXECUTABLE [--playwright MODULE].');
  args[key]=absolute(value);
 }
 for(const key of ['--receiving','--workspace','--out','--chromium'])
  need(args[key],'DIRECTORY_OPERATING_CLIENTS_ARGUMENTS',key);
 process.umask(0o077);
 await mkdir(args['--out'],{recursive:true,mode:0o700});await privateDirectory(args['--out']);
 const out=args['--out'],raw=await readSourceFile(args['--receiving'],{maxBytes:64*1024*1024}),
  native=originalDirectoryOperatingPlansReceiving(JSON.parse(raw.toString('utf8')));
 const binding={nativeSha256:digest(raw),nativeBytes:raw.length,workspaceId:native.workspaceId,
  workspace:args['--workspace'],operation:OPERATION};
 const journalPath=join(out,'OPERATING_PLANS_CLIENTS_JOURNEY.json');
 const emit=(stage,value={})=>process.stdout.write(JSON.stringify({stage,operation:OPERATION,...value})+'\n');
 let journal,lease,owner,merchant,client,browser,context,receiverOwner,receiverClient;
 const workspaceAlias='procedures';
 const requestOptions={timeoutMs:600000};
 async function checkpoint(){journal.updatedAt=now();await saveJSON(journalPath,journal,true);}
 async function jsonFile(name,value){
  const file=join(out,name);await mkdir(dirname(file),{recursive:true,mode:0o700});
  const previous=await readJSON(file,true);
  if(previous)need(same(previous,value),'DIRECTORY_OPERATING_OUTPUT_CHANGED',name);
  else await saveJSON(file,value,true);
  return {file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
 }
 // Reobserving an immutable native document can produce a new transport receipt.
 // Preserve the first complete receipt while comparing the source-defined values.
 async function observedJSON(name,value,select=value=>value){
  const file=join(out,name),previous=await readJSON(file,true);
  if(previous){
   need(same(select(previous),select(value)),'DIRECTORY_OPERATING_IMMUTABLE_OBSERVATION_CHANGED',name);
   return {file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
  }
  return jsonFile(name,value);
 }
 const planValues=value=>Object.fromEntries(['document','draft','basis','input'].map(key=>[key,value[key]]));
 async function checkedFile(value){
  const actual=await fileIdentity(value.file,{maxBytes:2147483648});
  need(actual.bytes===value.bytes&&actual.sha256===value.sha256,
    'DIRECTORY_OPERATING_COMPLETE_FILE_CHANGED',value.file);
  return {file:value.file,...actual};
 }
 async function call(key,action,input,{fresh=false}={}){
  let row=journal.calls[key];
  if(row){
   need(row.action===action&&same(row.input,input),'DIRECTORY_OPERATING_REQUEST_CHANGED',key);
   if(row.state==='complete'&&!fresh){await checkedFile(row.file);return JSON.parse(await readFile(row.file.file,'utf8'));}
  }else journal.calls[key]=row={action,input,state:'prepared',preparedAt:now()};
  await checkpoint();
  const result=await client.call(action,input,requestOptions);row.result=result;await checkpoint();
  need(result.retention?.state==='COMPLETE'&&result.native?.ok,
    'DIRECTORY_OPERATING_NATIVE_CALL_FAILED',action);
  const value=await readHumanServicesDirectoryValue({client,result});
  if(row.state==='complete'&&fresh){
   await checkedFile(row.file);const original=JSON.parse(await readFile(row.file.file,'utf8'));
   need(same(original.value,value),'DIRECTORY_OPERATING_IMMUTABLE_RESPONSE_CHANGED',key);
   return {result,value};
  }
  row.file=await jsonFile('calls/'+key+'.json',{result,value});
  row.state='complete';row.completedAt=now();await checkpoint();return {result,value};
 }
 async function read(action,input){
  const result=await client.call(action,{workspace:workspaceAlias,...input},requestOptions);
  need(result.retention?.state==='COMPLETE'&&result.native?.ok,'DIRECTORY_OPERATING_NATIVE_READ_FAILED',action);
  return readHumanServicesDirectoryValue({client,result});
 }
 async function records(){
  const rows=[];let offset=0,total;
  while(true){
   const page=await read('directory_records',{collection:'operatingPlans',offset,limit:100});
   need(page.offset===offset&&Array.isArray(page.rows)&&Number.isSafeInteger(page.total)&&
    (total===undefined||total===page.total),'DIRECTORY_OPERATING_COLLECTION_CHANGED');
   rows.push(...page.rows);total=page.total;
   if(page.nextOffset===null){need(rows.length===total,'DIRECTORY_OPERATING_COLLECTION_INCOMPLETE');break;}
   need(page.nextOffset===offset+page.rows.length&&page.nextOffset>offset,
    'DIRECTORY_OPERATING_CURSOR_CHANGED');offset=page.nextOffset;
  }
  need(new Set(rows.map(r=>r.id)).size===rows.length,'DIRECTORY_OPERATING_RECORD_REPEATED');
  return rows;
 }
 async function record(id){return read('directory_record',{collection:'operatingPlans',recordId:id});}
 async function verifyOriginals(){
  const state=await read('directory_state',{});
  need(state.workspaceId===native.workspaceId&&state.directory.workspaceId===native.workspaceId,
    'DIRECTORY_OPERATING_UUID_CHANGED');
  const rows=await records(),ids=new Set(rows.map(r=>r.id));
  need(native.operatingPlanRecordIds.every(id=>ids.has(id)),'DIRECTORY_OPERATING_ORIGINAL_HISTORY_MISSING');
  for(const [key,expected]of Object.entries(native.originalDirectoryRecordHashes)){
   const at=key.indexOf('/'),collection=key.slice(0,at),recordId=key.slice(at+1);
   const result=await client.call('directory_record',{workspace:workspaceAlias,collection,recordId},requestOptions);
   need(result.retention?.state==='COMPLETE'&&result.native?.ok,
    'DIRECTORY_OPERATING_ORIGINAL_DIRECTORY_READ_FAILED',key);
   const info=await client.call('manifest',{workspace:workspaceAlias,exportId:result.exportId},requestOptions),
    originalFile=info.manifest?.files?.find(file=>file.name==='original-response.json');
   // The original XML Handler emits the exact source.jbytes record, including its LF.
   // The complete client validates every retained byte; do not reserialize through JS.
   need(info.state==='MANIFEST_RETAINED'&&info.exportId===result.exportId&&
    info.manifestFile?.sha256===result.manifestSha256&&originalFile?.sha256===expected,
    'DIRECTORY_OPERATING_ORIGINAL_DIRECTORY_CHANGED',key);
   const original=await readHumanServicesDirectoryValue({client,result});
   need(original.id===recordId,'DIRECTORY_OPERATING_ORIGINAL_RECORD_ID_CHANGED',key);
  }
  return {state,rows};
 }
 async function findAccepted(planId,action,accept){
  for(const row of await records()){
   if(row.planId!==planId||row.action!==action)continue;
   const input=await read('directory_operating_input',{recordId:row.id});
   if(accept(input,row))return {record:row,input};
  }
  return null;
 }
 async function openRecordUI(page,id){
  const selector='[data-record-id="'+id+'"]';
  if(!await page.locator(selector).count()){
   await page.getByLabel('Find saved procedure',{exact:true}).fill(id);
   await page.getByLabel('Find saved procedure',{exact:true}).press('Tab');
   await page.waitForSelector(selector,{timeout:120000});
  }
  await page.locator(selector).click();
  await page.waitForFunction(id=>{
   const button=document.querySelector('[data-record-id="'+id+'"]');
   return button?.getAttribute('aria-current')==='true'&&
    !document.querySelector('.dop-status')?.textContent.includes('Reading or saving');
  },id,{timeout:120000});
 }
 async function uiPost(page,key,action,trigger){
  journal.ui.requests[key]??={state:'prepared',action,preparedAt:now()};await checkpoint();
  const target='/api/directory/operating-plans/'+action;
  const promise=page.waitForResponse(response=>response.request().method()==='POST'&&
    new URL(response.url()).pathname===target,{timeout:600000});
  await trigger();const response=await promise,value=await response.json(),input=response.request().postDataJSON();
  need(response.ok(),'DIRECTORY_OPERATING_BROWSER_NATIVE_REJECTED',JSON.stringify(value));
  journal.ui.requests[key]={state:'complete',action,input,value,status:response.status(),completedAt:now()};
  await checkpoint();
  await page.waitForFunction(()=>!document.querySelector('.dop-status')?.textContent.includes('Reading or saving'),
    undefined,{timeout:120000});
  return value;
 }
 async function browserModule(){
  if(args['--playwright'])return import(pathToFileURL(args['--playwright']).href);
  const require=createRequire(import.meta.url),modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
  return require(join(modules,'playwright'));
 }
 async function openBrowser(){
  const executable=await stat(args['--chromium']);
  need(executable.isFile()&&(executable.mode&0o111)!==0,'DIRECTORY_OPERATING_CHROMIUM_REQUIRED');
  const {chromium}=await browserModule();
  browser=await chromium.launch({headless:true,executablePath:args['--chromium'],
    args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
  page.on('pageerror',error=>journal.ui.errors.push({at:now(),message:error.message}));
  return page;
 }
 async function closeBrowser(){
  await context?.close();context=null;await browser?.close();browser=null;
 }
 async function operatorDescriptor(workspace){
  const value=await readJSON(join(workspace,'directory','operator-connection.json'));
  need(value.schema===OPERATOR_SCHEMA&&value.active&&value.workspaceId===native.workspaceId,
    'DIRECTORY_OPERATING_OPERATOR_CHANGED');
  return value;
 }
 async function go(page,workspace){
  const operator=await operatorDescriptor(workspace);
  await page.goto(operator.url+'#'+operator.accessToken,{waitUntil:'domcontentloaded',timeout:120000});
  await directoryOperatingPlansReady(page);
  return operator;
 }
 async function draftDownload(page,name){
  const pending=page.waitForEvent('download',{timeout:120000});
  await page.locator('[data-testid="dop-download-draft"]').click();
  const downloaded=await pending,file=join(out,name);
  await downloaded.saveAs(file);await chmod(file,0o600);
  need(!(await downloaded.failure()),'DIRECTORY_OPERATING_BROWSER_DRAFT_FAILED');
  const value=JSON.parse(await readFile(file,'utf8'));
  need(value.schema==='stellar-forge.directory-operating-editor.v1'&&value.workspaceId===native.workspaceId&&
    value.draft?.schema==='stellar-forge.operating-plan-draft.v1',
    'DIRECTORY_OPERATING_BROWSER_DRAFT_CHANGED');
  return {file:await checkedFile({file,...await fileIdentity(file,{maxBytes:64*1024*1024})}),value};
 }
 async function browseAuthoring(){
  if(journal.ui.state==='authored'||journal.ui.state==='complete'){
   for(const row of Object.values(journal.ui.files))await checkedFile(row);
   return;
  }
  const page=await openBrowser();await go(page,args['--workspace']);
  journal.ui.input??={...structuredClone(native.connectedInputs.preview),
   id:'directory-browser-procedure-'+native.workspaceId.slice(0,8),
   title:'Directory team procedure — complete browser receiving',
   savedAt:now(),outputDirectory:join(out,'procedure-exports'),
   note:'Authored through the original Operating Plans editor; original source and human review boundaries remain visible.'};
  await checkpoint();
  const input=journal.ui.input;
  let prepared=await findAccepted(input.id,'preview',value=>same(value,input));
  if(prepared){
   journal.ui.preparedRecordId=prepared.record.id;await checkpoint();await openRecordUI(page,prepared.record.id);
  }else{
   await page.locator('[data-testid="dop-open-draft"]').setInputFiles({
    name:'Original_Directory_Procedure_Input.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
   await page.waitForFunction(id=>document.querySelector('[data-testid="dop-plan-id"]')?.value===id,input.id);
   const preview=await uiPost(page,'preview','preview',()=>page.locator('[data-testid="dop-preview"]').click());
   journal.ui.preparedRecordId=preview.record.id;await checkpoint();
  }
  let accepted=await findAccepted(input.id,'create',value=>same(value,{...input,previewRecordId:journal.ui.preparedRecordId}));
  if(accepted){journal.ui.initialRecordId=accepted.record.id;await checkpoint();await openRecordUI(page,accepted.record.id);}
  else{
   const created=await uiPost(page,'create','create',()=>page.locator('[data-testid="dop-create"]').click());
   need(created.record.preparedFromId===journal.ui.preparedRecordId,'DIRECTORY_OPERATING_BROWSER_PREVIEW_CHANGED');
   journal.ui.initialRecordId=created.record.id;await checkpoint();
  }
  if(!journal.ui.draft){
   let added=journal.ui.requests.step?.value;
   if(!added){
    await page.locator('[data-testid="dop-registration"]').selectOption('command:human-services-directory');
    added=await uiPost(page,'step','step',()=>page.locator('[data-testid="dop-add-step"]').click());
   }else{
    const original=await readHumanServicesDirectoryOperatingPlan({client,workspace:workspaceAlias,
     recordId:journal.ui.initialRecordId,requestOptions});
    const draft=structuredClone(original.draft);draft.content.steps.push(added);
    const editor={schema:'stellar-forge.directory-operating-editor.v1',workspaceId:native.workspaceId,
     recordId:journal.ui.initialRecordId,create:input,draft,selectedStep:added.id};
    await page.locator('[data-testid="dop-open-draft"]').setInputFiles({
      name:'Recovered_Original_Procedure_Draft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(editor))});
   }
   await page.waitForSelector('[data-step-id="'+added.id+'"]',{timeout:120000});
   await page.locator('[data-step-id="'+added.id+'"]').click();
   await page.locator('[data-testid="dop-step-title"]').fill('Reopen the complete procedure in the receiving workspace');
   await page.locator('[data-testid="dop-step-work"]').fill('Receive the full editable Directory packet, inspect every original plan revision and retain the receiving receipt. Use the native command only when performing that separately selected task.');
   await page.locator('[data-testid="dop-step-inputs"]').fill(JSON.stringify({
    originalWorkspaceId:native.workspaceId,originalPlanRecordId:native.planRecordId,
    originalNativeResultSha256:binding.nativeSha256},null,2));
   await page.locator('[data-testid="dop-step-status"]').selectOption('planned');
   await page.locator('[data-testid="dop-step-result"]').fill('');
   await page.locator('[data-testid="dop-step-down"]').isDisabled().then(async disabled=>{
    if(disabled)await page.locator('[data-testid="dop-step-up"]').click();
   });
   await page.locator('details').filter({has:page.locator('[data-testid="dop-edit-title"]')})
     .evaluateAll(elements=>elements.forEach(el=>{el.open=true;}));
   await page.locator('[data-testid="dop-edit-title"]').fill(input.title+' — reviewed handover');
   const downloaded=await draftDownload(page,'Complete_Browser_Working_Draft.json');
   journal.ui.draft=downloaded.value;journal.ui.files.workingDraft=downloaded.file;await checkpoint();
  }
  let edited=await findAccepted(input.id,'save',(value,row)=>row.predecessorRecordId===journal.ui.initialRecordId&&
    same(value.draft,journal.ui.draft.draft));
  if(edited){journal.ui.recordId=edited.record.id;await checkpoint();await openRecordUI(page,edited.record.id);}
  else{
   await page.locator('[data-testid="dop-open-draft"]').setInputFiles({
    name:'Complete_Reviewed_Procedure_Draft.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(journal.ui.draft))});
   await page.waitForFunction(title=>document.querySelector('[data-testid="dop-edit-title"]')?.value===title,
    journal.ui.draft.draft.content.title,{timeout:120000});
   const saved=await uiPost(page,'save','save',()=>page.locator('[data-testid="dop-save"]').click());
   journal.ui.recordId=saved.record.id;await checkpoint();
  }
  const historical=await read('directory_operating_draft',{recordId:journal.ui.recordId,revision:1});
  await page.locator('[data-testid="dop-history"]').selectOption('1');
  await page.waitForFunction(title=>document.querySelector('[data-testid="dop-edit-title"]')?.value===title,
    historical.content.title,{timeout:120000});
  journal.ui.historicalDraft={revision:1,baseRevision:historical.baseRevision,recordId:journal.ui.recordId,
    verifiedAt:now()};await checkpoint();
  await page.getByRole('button',{name:'Discard working edits',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('[data-record-id="'+id+'"]')?.getAttribute('aria-current')==='true'&&
    !document.querySelector('.dop-status')?.textContent.includes('Reading or saving'),journal.ui.recordId);
  const copyId=input.id+'-receiving';
  let copied=await findAccepted(copyId,'copy',value=>value.recordId===journal.ui.recordId&&value.id===copyId);
  if(copied){journal.ui.copyRecordId=copied.record.id;await checkpoint();await openRecordUI(page,copied.record.id);}
  else{
   await page.locator('[data-testid="dop-copy-id"]').fill(copyId);
   const value=await uiPost(page,'copy','copy',()=>page.locator('[data-testid="dop-copy"]').click());
   journal.ui.copyRecordId=value.record.id;await checkpoint();
  }
  const copyDocument=await read('directory_operating_document',{recordId:journal.ui.copyRecordId});
  await page.locator('[data-testid="dop-import-file"]').setInputFiles({
   name:'Complete_Original_Procedure_History.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify(copyDocument))});
  await page.waitForFunction(()=>document.querySelector('[data-testid="dop-import-json"]')?.value.length>0);
  const received=await uiPost(page,'receive-prefix','receive',()=>page.locator('[data-testid="dop-receive"]').click());
  need(received.reused&&received.record.id===journal.ui.copyRecordId,
   'DIRECTORY_OPERATING_BROWSER_HISTORY_CHANGED');
  for(const format of ['json','markdown','html']){
   const pending=page.waitForEvent('download',{timeout:180000});
   const selected=await uiPost(page,'export-'+format,'export',
    ()=>page.locator('[data-testid="dop-export-'+format+'"]').click());
   const download=await pending,file=join(out,'Browser_Operating_Plan.'+{json:'json',markdown:'md',html:'html'}[format]);
   await download.saveAs(file);await chmod(file,0o600);
   need(!(await download.failure()),'DIRECTORY_OPERATING_BROWSER_FILE_FAILED');
   const full={file,...await fileIdentity(file,{maxBytes:128*1024*1024})};
   need(full.bytes===selected.file.bytes&&full.sha256===selected.file.sha256,
    'DIRECTORY_OPERATING_BROWSER_FILE_CHANGED');
   journal.ui.files[format]=full;await checkpoint();
  }
  for(const [name,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
   await page.setViewportSize(viewport);
   const file=join(out,'Directory_Operating_Plans_'+name+'.png');
   await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
   journal.ui.files[name]={file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
   const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
    workspace:document.querySelector('#workspace-id')?.textContent}));
   need(layout.width+1>=layout.documentWidth&&layout.workspace===native.workspaceId,
    'DIRECTORY_OPERATING_BROWSER_LAYOUT_CHANGED');
   journal.ui[name]=layout;await checkpoint();
  }
  need(journal.ui.errors.length===0,'DIRECTORY_OPERATING_BROWSER_ERROR',JSON.stringify(journal.ui.errors));
  journal.ui.state='authored';journal.ui.authoredAt=now();await checkpoint();
  await closeBrowser();emit('DIRECTORY_OPERATING_BROWSER_AUTHORED',{recordId:journal.ui.recordId,copyRecordId:journal.ui.copyRecordId});
 }
 async function startMerchant(connection){
  const setup=await initializeHumanServicesDirectoryMerchant({directory:join(out,'merchant'),connection,
    name:'Human Services Directory original operating procedures'});
  const tokenEnv='DIRECTORY_OPERATING_PLANS_MCP_CODE',environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
  merchant=await startMerchantMcp({configPath:setup.configuration,port:0,tokenEnv,environment});
  client=await openHumanServicesDirectoryMerchantClient({url:merchant.url,tokenEnv,environment});
  return setup;
 }
 async function connected(connection){
  if(journal.connected.state==='complete')return;
  const catalogue=await client.schema(),expected=Object.values(humanServicesDirectoryActions).map(row=>row.name).sort();
  need(Array.isArray(catalogue.tools)&&same(catalogue.tools.map(r=>r.name).sort(),expected),
    'DIRECTORY_OPERATING_COMPLETE_CATALOGUE_CHANGED');
  journal.connected.catalogue=await jsonFile('OPERATING_PLANS_CONNECTED_CATALOGUE.json',catalogue);await checkpoint();
  const requests=[
   ['preview','directory_operating_plan_preview','operating_plan_create','preparedRecordId'],
   ['create','directory_operating_plan_create','operating_plan_create','initialRecordId'],
   ['save','directory_operating_plan_save','operating_plan_save','planRecordId'],
   ['copy','directory_operating_plan_copy','operating_plan_copy',null],
   ['receiveSuccessor','directory_operating_plan_receive','operating_plan_receive','copyRecordId'],
   ['step','directory_operating_plan_step','operating_plan_step',null],
   ['compare','directory_operating_plan_compare','operating_plan_compare',null]
  ];
  for(const [key,action,inputKey,expectedKey]of requests){
   const result=await call('native-replay-'+key,action,
    {workspace:workspaceAlias,[inputKey]:native.connectedInputs[key]});
   if(expectedKey)need(selectedRecord(result.value)===native[expectedKey],
    'DIRECTORY_OPERATING_NATIVE_REPLAY_CHANGED',key);
  }
  for(const id of [native.planRecordId,native.copyRecordId,journal.ui.recordId,journal.ui.copyRecordId]){
   const full=await readHumanServicesDirectoryOperatingPlan({client,workspace:workspaceAlias,recordId:id,requestOptions});
   journal.connected.reads[id]=await observedJSON('reopened/'+id+'.json',full,planValues);await checkpoint();
   for(const format of ['json','markdown','html']){
    const key=id+'-'+format;
    if(!journal.connected.downloads[key]){
     const value=await downloadHumanServicesDirectoryOperatingPlan({client,workspace:workspaceAlias,
      input:{recordId:id,format,actor:'450E complete connected procedure receiving',
       note:'Complete saved original procedure and native basis remain unchanged.'},
      directory:join(out,'connected-files',key),requestOptions});
     journal.connected.downloads[key]=value;await checkpoint();
    }
    const value=journal.connected.downloads[key];
    value.reopened=await reopenHumanServicesDirectoryExport({workspace:workspaceAlias,
     exportId:value.result.exportId,expectedManifestSha256:value.result.manifestSha256,directory:value.receipt.directory});
    need(value.reopened.state==='REOPENED','DIRECTORY_OPERATING_CONNECTED_FILE_REOPEN_FAILED');
   }
  }
  const before=await operatorDescriptor(args['--workspace']);
  await client.close();client=null;await merchant.close();merchant=null;
  await startMerchant(connection);
  const after=await operatorDescriptor(args['--workspace']);
  need(after.workspaceId===before.workspaceId&&after.url===before.url&&after.accessToken===before.accessToken,
    'DIRECTORY_OPERATING_MERCHANT_REOPEN_CHANGED','The separately owned original operator must survive Merchant close/reopen.');
  const reopened=await readHumanServicesDirectoryOperatingPlan({client,workspace:workspaceAlias,
   recordId:journal.ui.copyRecordId,revision:1,requestOptions});
  need(reopened.draft.baseRevision===reopened.document.revisions.length,
    'DIRECTORY_OPERATING_HISTORICAL_REOPEN_CHANGED');
  journal.connected.merchantReopen={sameOriginalOperator:true,workspaceId:after.workspaceId,
    planId:reopened.document.id,revision:reopened.document.revisions.length,historicalBaseRevision:reopened.draft.baseRevision};
  journal.connected.reopened=await observedJSON('CONNECTED_REOPENED_PROCEDURE.json',reopened,planValues);
  journal.connected.state='complete';journal.connected.completedAt=now();await checkpoint();
  emit('DIRECTORY_OPERATING_CONNECTED_COMPLETE',{downloads:Object.keys(journal.connected.downloads).length});
 }
 async function finalBrowserPacket(){
  if(journal.ui.workspacePacket){await checkedFile(journal.ui.workspacePacket);return;}
  const page=await openBrowser();await go(page,args['--workspace']);
  await openRecordUI(page,journal.ui.copyRecordId);
  const expected=await read('directory_operating_document',{recordId:journal.ui.copyRecordId});
  const draft=await read('directory_operating_draft',{recordId:journal.ui.copyRecordId,revision:1});
  await page.locator('[data-testid="dop-history"]').selectOption('1');
  await page.waitForFunction(title=>document.querySelector('[data-testid="dop-edit-title"]')?.value===title,
    draft.content.title);
  need(draft.baseRevision===expected.revisions.length,'DIRECTORY_OPERATING_REOPENED_UI_REVISION_CHANGED');
  journal.ui.secondOpening={workspaceId:native.workspaceId,planId:expected.id,revision:expected.revisions.length,
    originalRevision:1,currentBaseRevision:draft.baseRevision,observedAt:now()};await checkpoint();
  await page.getByRole('button',{name:'Discard working edits',exact:true}).click();
  await page.locator('[data-nav="handoff"]').click();
  await page.waitForSelector('[data-testid="directory-workspace-download"]',{timeout:120000});
  const pending=page.waitForEvent('download',{timeout:600000});
  await page.locator('[data-testid="directory-workspace-download"]').click();
  const download=await pending,file=join(out,'Directory_Operating_Plans_Browser_Editable_Workspace.zip');
  await download.saveAs(file);await chmod(file,0o600);
  need(!(await download.failure()),'DIRECTORY_OPERATING_BROWSER_WORKSPACE_FAILED');
  journal.ui.workspacePacket={file,...await fileIdentity(file,{maxBytes:512*1024*1024})};
  journal.ui.state='complete';journal.ui.completedAt=now();await checkpoint();await closeBrowser();
 }
 async function completeConnectedWorkspace(){
  if(journal.connected.workspaceDownload){
   const old=journal.connected.workspaceDownload;
   old.reopened=await reopenHumanServicesDirectoryExport({workspace:workspaceAlias,exportId:old.result.exportId,
    expectedManifestSha256:old.result.manifestSha256,directory:old.receipt.directory});return;
  }
  let result=journal.connected.workspaceResult;
  if(!result){
   result=await client.directoryWorkspacePacket({workspace:workspaceAlias},requestOptions);
   journal.connected.workspaceResult=result;await checkpoint();
  }
  need(result.native?.ok&&result.retention?.state==='COMPLETE','DIRECTORY_OPERATING_CONNECTED_WORKSPACE_REQUIRED');
  const receipt=await downloadHumanServicesDirectoryExport({client,workspace:workspaceAlias,exportId:result.exportId,
   expectedManifestSha256:result.manifestSha256,directory:join(out,'connected-complete-workspace')});
  const reopened=await reopenHumanServicesDirectoryExport({workspace:workspaceAlias,exportId:result.exportId,
   expectedManifestSha256:result.manifestSha256,directory:receipt.directory});
  journal.connected.workspaceDownload={result,receipt,reopened};await checkpoint();
 }
 async function receiveCustomer(){
  const packet=journal.ui.workspacePacket;await checkedFile(packet);
  const target=join(out,'received-workspace'),connection=join(out,'received-connection.json'),
   configuration={schema:CONNECTION_SCHEMA,workspaces:{procedures:{
    directory:target,label:'Complete received original Directory procedures',allowStart:true,
    inputs:{'complete-procedures':{file:packet.file,sha256:packet.sha256,label:'Complete browser received editable workspace'}}}}};
  const previous=await readJSON(connection,true);
  if(previous)need(same(previous,configuration),'DIRECTORY_OPERATING_RECEIVING_INPUT_CHANGED');
  else await saveJSON(connection,configuration,true);
  const readConfiguration=await readHumanServicesDirectoryConfiguration(connection);
  receiverOwner=new HumanServicesDirectoryConnection(readConfiguration.workspaces.procedures);await receiverOwner.open();
  receiverClient=await openHumanServicesDirectoryLocalClient({connection,exportsDirectory:join(out,'received-native-exports')});
  const input={workspace:workspaceAlias,input:'complete-procedures',expectedSha256:packet.sha256};
  const imported=await receiverClient.directoryWorkspaceImport(input);
  need(imported.native?.ok&&imported.retention?.state==='COMPLETE',
    'DIRECTORY_OPERATING_COMPLETE_CUSTOMER_RECEIVING_FAILED');
  const value=await readHumanServicesDirectoryValue({client:receiverClient,result:imported});
  need(value.workspaceId===native.workspaceId&&value.archiveSha256===packet.sha256,
    'DIRECTORY_OPERATING_CUSTOMER_UUID_CHANGED');
  const ids=journal.finalRecordIds;
  for(const id of ids){
   const full=await readHumanServicesDirectoryOperatingPlan({client:receiverClient,workspace:workspaceAlias,recordId:id,requestOptions});
   const original=await readHumanServicesDirectoryOperatingPlan({client,workspace:workspaceAlias,recordId:id,requestOptions});
   need(same(full.document,original.document)&&same(full.basis,original.basis)&&same(full.input,original.input),
    'DIRECTORY_OPERATING_CUSTOMER_HISTORY_CHANGED',id);
  }
  const receiverStateResult=await receiverClient.directoryState({workspace:workspaceAlias});
  const receiverState=await readHumanServicesDirectoryValue({client:receiverClient,result:receiverStateResult});
  need(receiverState.workspaceId===native.workspaceId&&receiverState.directory.workspaceId===native.workspaceId,
    'DIRECTORY_OPERATING_RECEIVED_STATE_CHANGED');
  const receivedDraft=await readHumanServicesDirectoryOperatingPlan({client:receiverClient,workspace:workspaceAlias,
   recordId:journal.ui.copyRecordId,revision:1,requestOptions});
  if(journal.receiving){
   need(journal.receiving.workspace===target&&journal.receiving.workspaceId===native.workspaceId&&
    journal.receiving.archiveSha256===packet.sha256&&journal.receiving.originalHistories===ids.length&&
    journal.receiving.originalHistoricalBaseRevision===receivedDraft.draft.baseRevision,
    'DIRECTORY_OPERATING_ORIGINAL_RECEIVING_CHANGED');
   await checkedFile(journal.receiving.record);await checkedFile(journal.receiving.image);
   return;
  }
  const page=await openBrowser();await go(page,target);await openRecordUI(page,journal.ui.copyRecordId);
  await page.locator('[data-testid="dop-history"]').selectOption('1');
  await page.waitForFunction(title=>document.querySelector('[data-testid="dop-edit-title"]')?.value===title,
    receivedDraft.draft.content.title);
  const file=join(out,'Directory_Operating_Plans_Received_Customer.png');
  await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
  const image={file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
  await closeBrowser();
  const receiveIdentity=row=>({workspaceId:row.workspaceId,archiveSha256:row.archiveSha256,
    kind:row.kind,state:row.state,id:row.id});
  journal.receiving={workspace:target,workspaceId:native.workspaceId,archiveSha256:packet.sha256,
   result:imported,originalHistories:ids.length,allDocumentsAndInputsEqual:true,
   originalHistoricalBaseRevision:receivedDraft.draft.baseRevision,reopened:true,image,
   record:await observedJSON('CUSTOMER_RECEIVING_RESULT.json',value,receiveIdentity)};
  await checkpoint();
 }
 try{
  lease=await operationLease(join(out,'operating-plans-clients.lock'));
  journal=await readJSON(journalPath,true);
  if(journal)need(journal.operation===OPERATION&&same(journal.binding,binding),
    'DIRECTORY_OPERATING_CLIENTS_SELECTION_CHANGED');
  else journal={schema:'stellar-forge.directory-operating-plans-clients-journey.v1',
   operation:OPERATION,binding,startedAt:now(),calls:{},failures:[],
   ui:{state:'prepared',files:{},requests:{},errors:[]},
   connected:{state:'prepared',reads:{},downloads:{}}};
  await checkpoint();
  const connection=join(out,'operating-plans-connection.json'),
   configuration={schema:CONNECTION_SCHEMA,workspaces:{procedures:{
    directory:args['--workspace'],label:'Original Directory operating procedures',allowStart:true}}};
  const old=await readJSON(connection,true);
  if(old)need(same(old,configuration),'DIRECTORY_OPERATING_CONFIGURATION_CHANGED');
  else await saveJSON(connection,configuration,true);
  const config=await readHumanServicesDirectoryConfiguration(connection);
  owner=new HumanServicesDirectoryConnection(config.workspaces.procedures);await owner.open();
  await startMerchant(connection);await verifyOriginals();
  if(journal.result){
   await checkedFile(journal.result);
   const complete=JSON.parse(await readFile(journal.result.file,'utf8'));
   need(complete.schema===RESULT_SCHEMA&&complete.operation===OPERATION&&
    complete.nativeSha256===binding.nativeSha256&&complete.workspaceId===binding.workspaceId,
    'DIRECTORY_OPERATING_COMPLETED_RESULT_CHANGED');
   await checkedFile(complete.workspacePacket);
   emit('DIRECTORY_OPERATING_PLANS_CLIENTS_COMPLETE',{result:journal.result,
    workspaceId:native.workspaceId,workspacePacket:complete.workspacePacket,recovered:true});
   return complete;
  }
  await browseAuthoring();
  await connected(connection);await verifyOriginals();await finalBrowserPacket();await completeConnectedWorkspace();
  journal.finalRecordIds=(await records()).map(r=>r.id);await checkpoint();
  await receiveCustomer();await verifyOriginals();
  journal.completedAt??=now();await checkpoint();
  const result={schema:RESULT_SCHEMA,operation:OPERATION,completedAt:journal.completedAt,...binding,
   sourceRoot:dirname(fileURLToPath(import.meta.url)),
   nativeReceiving:{file:args['--receiving'],bytes:raw.length,sha256:digest(raw)},
   originalDirectoryReceiving:native.originalDirectoryReceiving,
   originalDirectoryRecordHashes:native.originalDirectoryRecordHashes,
   originalOperatingPlanRecordIds:native.operatingPlanRecordIds,operatingPlanRecordIds:journal.finalRecordIds,
   browser:journal.ui,connected:journal.connected,receiving:journal.receiving,
   workspacePacket:journal.ui.workspacePacket,
   journal:journalPath,
   meaning:'Complete local procedure authoring, SDK/MCP calls and customer workspace receiving. The original Directory and OperatingPlan histories remain exact; planned commands and human delivery steps were not executed.'};
  journal.result=await jsonFile('OPERATED_DIRECTORY_OPERATING_PLANS_CLIENTS.json',result);await checkpoint();
  emit('DIRECTORY_OPERATING_PLANS_CLIENTS_COMPLETE',{result:journal.result,
   workspaceId:native.workspaceId,workspacePacket:result.workspacePacket,originalHistories:journal.finalRecordIds.length});
  return result;
 }catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack});await checkpoint();}
  emit('DIRECTORY_OPERATING_PLANS_CLIENTS_INTERRUPTED',{error:{code:error.code||error.name,message:error.message},journal:journalPath});
  throw error;
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await receiverClient?.close().catch(()=>{});await receiverOwner?.close().catch(()=>{});
  await client?.close().catch(()=>{});await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  await lease?.close();if(journal)await checkpoint();
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||error.name,message:error.message}})+'\n');process.exitCode=1;});
