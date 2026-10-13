#!/usr/bin/env node
// MIT. Complete original-source correction editor, exact connected replay and fresh customer receiving.
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,stat,chmod} from 'node:fs/promises';
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
 readHumanServicesDirectoryWorksheet,iterateHumanServicesDirectoryWorksheet,
 downloadHumanServicesDirectoryWorksheetFile,downloadHumanServicesDirectoryWorksheet,
 downloadHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport,
 getDirectoryWorksheetReconciliationRecord,directoryWorksheetReconciliationRows,
 prepareDirectoryWorksheetReconciliation,reviewDirectoryWorksheetReconciliation} from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';
const OPERATION='SCF-DIRECTORY-WORKSHEET-RECONCILIATION-CLIENTS-450E-20261013';
const NATIVE_SCHEMA='stellar-forge.directory-worksheet-reconciliation-operated.v1';
const RESULT_SCHEMA='stellar-forge.directory-worksheet-reconciliation-clients-operated.v1';
const JOURNEY_SCHEMA='stellar-forge.directory-worksheet-reconciliation-clients-journey.v1';
const HERE=dirname(fileURLToPath(import.meta.url)),timeout={timeoutMs:600000};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=x=>typeof x==='string'&&new RegExp(SHA).test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const required=(condition,message)=>need(condition,'DIRECTORY_WORKSHEET_RECEIVING',message);
const PRIVATE_MUTABLE=new Set(['acquisitions','receives']);
export function originalDirectoryWorksheetReconciliationReceiving(value){
 required(value?.schema===NATIVE_SCHEMA&&value.operation==='SCF-DIRECTORY-WORKSHEET-RECONCILIATION-450E-20261013'&&
  value.completedAt&&new RegExp(UUID).test(value.workspaceId||'')&&object(value.recordIds)&&
  object(value.originalDirectoryRecordHashes)&&object(value.baselineRecordHashes)&&object(value.cases)&&
  Array.isArray(value.connectedInputs?.replay)&&hash(value.workspacePacket?.sha256),
  'Keep the completed native three-way reconciliation, original UUID and complete packet.');
 for(const key of ['originalWorksheetId','originalReturnId','originalEditionId','currentEditionId'])
  required(hash(value[key]),'Keep the actual original worksheet and explicitly selected current edition: '+key);
 required(Array.isArray(value.bindings)&&value.bindings.length>0,
  'Keep the exact complete original-to-current row bindings selected by the native course.');
 return value;
}
export async function directoryWorksheetsReady(page){
 await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
 await page.locator('[data-nav="worksheets"]').click();
 await page.waitForSelector('[data-worksheet-operator-ready="true"]',{timeout:120000});
}
export async function main(argv=process.argv.slice(2)){
 const args={};
 for(let i=0;i<argv.length;i+=2){
  required(['--native-receiving','--native-sha256','--native-archive','--workspace','--out','--chromium','--playwright'].includes(argv[i])&&
   argv[i+1]&&!Object.hasOwn(args,argv[i]),'Use --native-receiving NATIVE_JSON --native-sha256 SHA --native-archive COMPLETE_NATIVE_ZIP --workspace PRIVATE_WORKSPACE --out PRIVATE_OUTPUT --chromium EXISTING_EXECUTABLE [--playwright MODULE].');
  args[argv[i]]=argv[i]==='--native-sha256'?argv[i+1]:absolute(argv[i+1]);
 }
 for(const key of ['--native-receiving','--native-sha256','--native-archive','--workspace','--out','--chromium'])required(args[key],key+' is required');
 process.umask(0o077);
 const out=args['--out'];await mkdir(out,{recursive:true,mode:0o700});await privateDirectory(out);
 const raw=await readSourceFile(args['--native-receiving'],{maxBytes:64*1024*1024}),
  native=originalDirectoryWorksheetReconciliationReceiving(JSON.parse(raw.toString('utf8')));
 required(hash(args['--native-sha256'])&&digest(raw)===args['--native-sha256'],'Keep the unchanged original native result.');
 const originalArchive={file:args['--native-archive'],...await fileIdentity(args['--native-archive'],{maxBytes:2147483648})};
 required(originalArchive.bytes===native.workspacePacket.bytes&&originalArchive.sha256===native.workspacePacket.sha256,'Keep the exact native result workspacePacket.');
 const alias='corrections',journalPath=join(out,'WORKSHEET_RECONCILIATION_CLIENTS_JOURNEY.json'),sourceFiles={};
 for(const name of ['operate_correction_worksheet_reconciliation_clients.mjs','public/directory-worksheet-reconciliation.mjs',
  'directory_correction_worksheet_reconciliation.py','directory_correction_worksheet_reconciliation_schema.py',
  'directory-correction-worksheet-reconciliation-schema.json','operate_correction_worksheet_reconciliation.py',
  'public/directory-correction-worksheets.mjs',
  'public/directory-correction-worksheet-customer.html','public/directory-correction-worksheet-customer.js',
  'public/directory-correction-worksheet-customer.css','public/directory-correction-worksheets.css','directory_correction_worksheets.py',
  'directory_correction_worksheets_schema.py','directory-correction-worksheets-schema.json','public/directory-corrections.mjs',
  'public/directory-corrections.css','public/app.js','directory_corrections.py',
  'directory_corrections_schema.py','directory-corrections-schema.json','directory_server.py',
  'directory_receiving.py','directory_workspace.py','connected/catalog.mjs','connected/runtime.mjs','connected/client.mjs'])
  sourceFiles[name]=await fileIdentity(join(HERE,name),{maxBytes:4*1024*1024});
 const binding={operation:OPERATION,nativeSha256:digest(raw),nativeBytes:raw.length,workspaceId:native.workspaceId,
  workspace:args['--workspace'],output:out,sourceFiles,nativePacket:{bytes:originalArchive.bytes,sha256:originalArchive.sha256}};
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
   object(state.directory.collections)&&state.directory.collections.correctionWorksheets,
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
   const correction=/^\/api\/directory\/corrections\/(prepare|preview|apply|export)$/.exec(url.pathname),
    worksheet=/^\/api\/directory\/correction-worksheets\/(prepare|export|imports|review)$/.exec(url.pathname),
    receive=/^\/api\/directory\/correction-worksheets\/imports\/([0-9a-f]{64})\/content$/.exec(url.pathname);
   const reconciliation=/^\/api\/directory\/correction-worksheet-reconciliations\/(prepare|review|export)$/.exec(url.pathname);
   const action=reconciliation?'reconciliation-'+reconciliation[1]:correction?'correction-'+correction[1]:worksheet?'worksheet-'+(worksheet[1]==='imports'?'import':worksheet[1]):receive?'worksheet-receive':null;
   if(!action){attempt.blockedWrites.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
   const key=activeUI?.keys?.[action]??(activeUI?.action===action?activeUI.key:null);
   required(key,'Keep the exact original worksheet UI request before dispatch: '+action);
   const body=request.postDataBuffer()??Buffer.alloc(0),
    input=receive?{importId:receive[1],bytes:body.length,sha256:digest(body)}:request.postDataJSON(),
    old=journal.ui.steps[key];
   if(old)required(old.action===action&&same(old.input,input),'Keep the exact interrupted worksheet UI input.');
   else{
    journal.ui.steps[key]={action,input,path:url.pathname,method:request.method(),state:'prepared',preparedAt:now()};
    if(receive){
     const file=join(out,'browser','original-uploads',key+'.json');await privateChild(dirname(file));
     await writeFile(file,body,{mode:0o600,flag:'wx'});
     journal.ui.steps[key].originalFile={file,...await fileIdentity(file,{maxBytes:33554432})};
    }
   }
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
  await directoryWorksheetsReady(page);
  required((await page.locator('#workspace-id').textContent())===native.workspaceId,'Open the exact original workspace UUID.');
 }

 async function openCorrectionRecord(page,kind,id){
  await page.locator('[data-testid="dcw-history"]').click();
  await page.locator('[data-testid="dcw-library-kind"]').selectOption(kind);
  await page.locator('[data-testid="dcw-library-query"]').fill(id);
  await page.locator('[data-testid="dcw-library-read"]').click();
  await page.locator('[data-testid="dcw-record-'+id+'"]').click();
  await page.locator('[data-testid="dcw-review"][data-correction-record-id="'+id+'"]').waitFor({timeout:120000});
 }
 async function screenshot(page,name){
  const file=join(out,name);await page.screenshot({path:file,fullPage:false});await chmod(file,0o600);
  return {file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
 }
 async function openWorksheetRecord(page,kind,id){
  await page.locator('[data-testid="dws-view-history"]').click();
  await page.locator('[data-testid="dws-library-kind"]').selectOption(kind);
  await page.locator('[data-testid="dws-read-library"]').click();
  let found=false;
  for(let pageNo=0;pageNo<100000;pageNo++){
   const target=page.locator('[data-testid="dws-record-'+id+'"]');
   if(await target.count()){await target.click();found=true;break;}
   const next=page.getByRole('button',{name:'Next',exact:true});
   required(await next.count(),'The original worksheet record is absent from the complete library.');
   await next.click();
  }
  required(found,'Find the exact original worksheet record.');
  await page.locator('[data-worksheet-record-id="'+id+'"]').waitFor({timeout:120000});
 }
 async function finishUIResponse(key,response){
  const value=await response.json();required(response.ok()&&hash(value?.id),'Complete original UI request failed: '+key);
  const row=journal.ui.steps[key];required(row?.state==='prepared','Retain original UI request before response.');
  row.value=value;row.state='complete';row.completedAt=now();await checkpoint();return value;
 }
 async function replayUI(page,key){
  const row=journal.ui.steps[key];required(row,'Select the retained original UI request.');
  if(row.state==='complete')return row.value;
  const original=row.originalFile?await checkedFile(row.originalFile):null;
  const data=original?(await readFile(original.file)).toString('base64'):null;
  activeUI={key,action:row.action};
  try{
   const reply=await page.evaluate(async({path,method,input,data})=>{
    const token=sessionStorage.getItem('directory.operator.'+location.origin);
    const body=data===null?JSON.stringify(input):Uint8Array.from(atob(data),x=>x.charCodeAt(0));
    const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});
    return {ok:response.ok,status:response.status,text:await response.text()};
   },{path:row.path,method:row.method,input:row.input,data});
   required(reply.ok,'Original UI request replay failed: '+reply.status+' '+reply.text);
   const value=JSON.parse(reply.text);required(hash(value.id),'Original replay has no immutable identity.');
   row.value=value;row.state='complete';row.completedAt=now();await checkpoint();return value;
  }finally{activeUI=null;}
 }
 async function worksheetMutation(page,key,action,click){
  const old=journal.ui.steps[key];if(old)return replayUI(page,key);
  const suffix=action==='worksheet-import'?'imports':action.slice('worksheet-'.length);
  activeUI={key,action};
  try{const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/directory/correction-worksheets/'+suffix&&r.request().method()==='POST',{timeout:600000});
   await click();return await finishUIResponse(key,await pending);
  }finally{activeUI=null;}
 }
 async function reconciliationMutation(page,key,action,click){
  const old=journal.ui.steps[key];if(old)return replayUI(page,key);
  required(['prepare','review','export'].includes(action),'Use the exact native reconciliation action.');
  activeUI={key,action:'reconciliation-'+action};
  try{
   const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/directory/correction-worksheet-reconciliations/'+action&&r.request().method()==='POST',{timeout:600000});
   await click();return await finishUIResponse(key,await pending);
  }finally{activeUI=null;}
 }
 async function reconciliationReady(page){
  await page.locator('[data-nav="reconciliation"]').click();
  await page.waitForSelector('[data-reconciliation-ready="true"]',{timeout:120000});
 }
 async function worksheetDownload(page,buttonTest,file,label){
  const pending=page.waitForEvent('download',{timeout:120000});await page.locator('[data-testid="'+buttonTest+'"]').click();
  const download=await pending;await privateChild(dirname(file));await download.saveAs(file);await chmod(file,0o600);
  required(!await download.failure(),'Receive the complete '+label+'.');
  return checkedFile({file,...await fileIdentity(file,{maxBytes:67108864})});
 }
 async function extractCustomer(packet,key){
  const root=join(out,'offline',key);await privateChild(root);
  const script=String.raw`
import hashlib,json,os,pathlib,sys,zipfile
archive,root=sys.argv[1:];root=pathlib.Path(root)
with zipfile.ZipFile(archive) as z:
 names=z.namelist()
 if len(names)!=len(set(names)):raise ValueError("Repeated original ZIP member")
 result={}
 for name in ("customer.html","worksheet.json"):
  if name not in names:raise ValueError("Missing whole customer member")
  info=z.getinfo(name)
  if info.file_size>67108864:raise ValueError("Complete customer member exceeds bound")
  raw=z.read(info);target=root/name
  if target.exists():
   if target.is_symlink() or target.read_bytes()!=raw:raise ValueError("Original customer file differs")
  else:
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,"wb") as f:f.write(raw)
  os.chmod(target,0o600)
  result[name]={"file":str(target),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
 print(json.dumps(result))
`;
  const python=process.env.SF30_DIRECTORY_PYTHON||process.env.SF30_REFERRAL_PYTHON||process.env.SF30_ELTSS_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
  const response=await promisify(execFile)(python,['-c',script,packet.file,root],{maxBuffer:1048576});
  const files=JSON.parse(response.stdout.trim());for(const file of Object.values(files))await checkedFile(file);
  return files;
 }
 async function offlineRound(page,worksheet,packet){
  const old=journal.ui.offline;if(old?.state==='complete'){await checkedFile(old.returned);return old;}
  const files=await extractCustomer(packet,'authored'),document=await readJSON(files['worksheet.json'].file);
  required(document.worksheetId===worksheet.id&&document.workspaceId===native.workspaceId&&document.editionId===worksheet.editionId,'Original portable worksheet differs.');
  const csv=document.rows.find(r=>r.representation==='csv'),jsonRow=document.rows.find(r=>r.representation==='json');
  required(csv&&jsonRow,'Operate actual CSV and JSON whole rows.');
  let offline=journal.ui.offline??={state:'prepared',files,worksheetId:worksheet.id,returnedAt:now()};
  await checkpoint();
  const customer=await context.newPage();
  try{
   await customer.goto(pathToFileURL(files['customer.html'].file).href,{waitUntil:'domcontentloaded'});
   await customer.locator('[data-worksheet-ready="true"]').waitFor();
   const description=csv.headers.findIndex(x=>x==='description');required(description>=0,'Select the actual published CSV description column.');
   const cells=[...csv.cells];cells[description]=cells[description]+'\nReviewed customer worksheet: "complete original values".';
   await customer.locator('[data-testid="worksheet-row-'+csv.rowKey+'"]').click();
   await customer.locator('[data-testid="worksheet-cells"]').fill(JSON.stringify(cells,null,2));
   await customer.locator('[data-testid="worksheet-reason"]').fill('Explicit authored customer CSV description proposal; preserve every other physical cell.');
   await customer.locator('[data-testid="worksheet-retain"]').click();
   await customer.locator('[data-testid="worksheet-row-'+jsonRow.rowKey+'"]').click();
   const source=jsonRow.valueJson,at=source.lastIndexOf('}');required(at>=0&&!source.includes('"worksheetClientNull"')&&!source.includes('"worksheetClientKept"'),'Keep the unchanged lexical original object.');
   const parsed=JSON.parse(source),comma=Object.keys(parsed).length?',':'';
   const proposed=source.slice(0,at)+comma+'"worksheetClientNull":null,"worksheetClientKept":"unaccepted customer proposal"'+source.slice(at);
   await customer.locator('[data-testid="worksheet-json"]').fill(proposed);
   await customer.locator('[data-testid="worksheet-reason"]').fill('Explicit authored null and separately reviewable field proposal; original numeric tokens remain unchanged.');
   await customer.locator('[data-testid="worksheet-retain"]').click();
   await customer.locator('[data-testid="worksheet-returned-by"]').fill('450E authored offline customer course');
   await customer.locator('[data-testid="worksheet-returned-at"]').fill(offline.returnedAt);
   await customer.locator('[data-testid="worksheet-note"]').fill('Authored full worksheet return; no actual external customer acceptance.');
   offline.working=await worksheetDownload(customer,'worksheet-save-working',join(out,'browser','Customer_Working.json'),'customer working file');
   await customer.close();
   const reopened=await context.newPage();
   try{
    await reopened.goto(pathToFileURL(files['customer.html'].file).href,{waitUntil:'domcontentloaded'});
    await reopened.locator('[data-worksheet-ready="true"]').waitFor();
    await reopened.locator('[data-testid="worksheet-open-file"]').setInputFiles(offline.working.file);
    await reopened.waitForFunction(()=>document.querySelector('[data-testid="worksheet-returned-by"]')?.value==='450E authored offline customer course');
    required(await reopened.locator('[data-testid="worksheet-returned-by"]').inputValue()==='450E authored offline customer course','Restore the exact complete offline working file.');
    offline.image=await screenshot(reopened,'Worksheet_Offline_Customer.png');
    offline.returned=await worksheetDownload(reopened,'worksheet-return',join(out,'browser','Customer_Returned.json'),'complete authored returned file');
   }finally{await reopened.close();}
   const returned=await readJSON(offline.returned.file);
   required(returned.worksheetId===worksheet.id&&returned.editionId===worksheet.editionId&&returned.workspaceId===native.workspaceId&&
    returned.candidates.length===2&&returned.candidates.find(x=>x.rowKey===jsonRow.rowKey).valueJson===proposed&&
    same(returned.candidates.find(x=>x.rowKey===csv.rowKey).cells,cells),'Retain exact complete customer values.');
   offline.state='complete';offline.completedAt=now();offline.originalRows={csv:csv.rowKey,json:jsonRow.rowKey};
   await checkpoint();return offline;
  }finally{await customer.close().catch(()=>{});}
 }

 async function openReconciliationRecord(page,kind,id){
  await reconciliationReady(page);
  await page.locator('[data-testid="dwrc-view-history"]').click();
  await page.locator('[data-testid="dwrc-history-kind"]').selectOption(kind);
  await page.locator('[data-testid="dwrc-read-history"]').click();
  for(let pageNo=0;pageNo<100000;pageNo++){
   const pick=page.locator('[data-testid="dwrc-open-'+id+'"]');
   if(await pick.count()){await pick.click();break;}
   const next=page.getByRole('button',{name:'Next',exact:true}).first();
   required(await next.count()&&!await next.isDisabled(),'Find the exact complete reconciliation record.');
   await next.click();
  }
  await page.locator('[data-reconciliation-record-id="'+id+'"][data-reconciliation-record-kind="'+kind+'"]').waitFor({timeout:120000});
 }
 async function comparisonFile(record,key){
  const received=await packetFile(key,'directory_correction_worksheet_reconciliation_file',
   {collection:'correctionWorksheetReconciliations',recordId:record.id,fileKind:'comparison'},record.files.comparison);
  const text=await readFile(received.artifact.file,'utf8'),lines=text.split('\n');
  if(lines.at(-1)==='')lines.pop();
  required(lines.every(Boolean),'Keep every complete original comparison record.');
  const changes=lines.map(JSON.parse);
  required(changes.length===record.summary.changes&&new Set(changes.map(x=>x.changeId)).size===changes.length,
   'The original comparison file contains every change exactly once.');
  return changes;
 }
 async function browserAuthoring(){
  if(journal.ui.state==='complete')return;
  const {page,attempt}=await openBrowser('worksheet-reconciliation-authoring');
  try{
   await go(page,args['--workspace']);
   const worksheet=await read(client,'directory_record',{collection:'correctionWorksheets',recordId:native.originalWorksheetId});
   required(worksheet.id===native.originalWorksheetId&&worksheet.editionId===native.originalEditionId,
    'Use the exact original worksheet and its original edition for the authored customer return.');
   await openWorksheetRecord(page,'correctionWorksheets',worksheet.id);
   const exported=await worksheetMutation(page,'export','worksheet-export',()=>page.locator('[data-testid="dws-export"]').click());
   const packet=await packetFile('browser/customer-package','directory_export_file',{exportId:exported.id},exported.file);
   const offline=await offlineRound(page,worksheet,packet.artifact);
   let imported,returned;
   if(journal.ui.steps.intake)imported=await replayUI(page,'intake');
   if(journal.ui.steps.receive)returned=await replayUI(page,'receive');
   if(!returned){
    await openWorksheetRecord(page,'correctionWorksheets',worksheet.id);
    await page.locator('[data-testid="dws-open-intake"]').click();
    await page.locator('[data-testid="dws-intake-actor"]').fill('450E complete worksheet browser course');
    await page.locator('[data-testid="dws-intake-note"]').fill('Preserve this complete authored customer returned file.');
    await page.locator('[data-testid="dws-return-file"]').setInputFiles(offline.returned.file);
    await page.waitForFunction(()=>![...document.querySelectorAll('[data-testid="dws-receive"]')].some(x=>x.disabled));
    activeUI={keys:{'worksheet-import':'intake','worksheet-receive':'receive'}};
    try{
     const importWait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/directory/correction-worksheets/imports'&&r.request().method()==='POST',{timeout:600000});
     const receiveWait=page.waitForResponse(r=>/\/api\/directory\/correction-worksheets\/imports\/[0-9a-f]{64}\/content$/.test(new URL(r.url()).pathname)&&r.request().method()==='PUT',{timeout:600000});
     await page.locator('[data-testid="dws-receive"]').click();
     const importResponse=await importWait;
     if(journal.ui.steps.intake.state==='complete'){
      const v=await importResponse.json();required(importResponse.ok()&&v.id===imported.id,'Reuse the exact saved intake.');
     }else imported=await finishUIResponse('intake',importResponse);
     returned=await finishUIResponse('receive',await receiveWait);
    }finally{activeUI=null;}
   }

   required(returned.worksheetId===native.originalWorksheetId&&returned.id!==native.originalReturnId,
    'Retain this separately authored original customer return without replacing the native example.');
   await reconciliationReady(page);
   let prepared;
   if(journal.ui.steps.reconciliationPrepare)prepared=await replayUI(page,'reconciliationPrepare');
   else{
    await page.locator('[data-testid="dwrc-return-id"]').fill(returned.id);
    await page.locator('[data-testid="dwrc-open-return"]').click();
    await page.locator('[data-testid="dwrc-current-edition"]').fill(native.currentEditionId);
    await page.locator('[data-testid="dwrc-open-edition"]').click();
    await page.locator('[data-testid="dwrc-label"]').fill('Authored customer return reconciled against the explicitly selected current edition');
    await page.locator('[data-testid="dwrc-actor"]').fill('450E complete three-way browser course');
    await page.locator('[data-testid="dwrc-note"]').fill('Keep the whole original return, full current references and explicit decisions.');
    await page.locator('[data-testid="dwrc-predecessor"]').fill(native.preparation.input.predecessorId||'');
    for(const binding of native.bindings){
     required(binding.current&&same(binding.original,
      native.preparation.input.bindings.find(x=>x.rowKey===binding.rowKey)?.original),
      'Use the retained full original-to-current native binding.');
     const current=await read(client,'directory_edition_row',
      {editionId:native.currentEditionId,sourceId:binding.current.sourceId,recordId:binding.current.recordId});
     required(['sourceId','recordId','rowSha256','resourceSha256','memberSha256'].every(k=>current[k]===binding.current[k]),
      'The current row must reopen in the explicitly selected edition with its complete five-part reference.');
     await page.locator('[data-testid="dwrc-match-'+binding.rowKey+'"]').click();
     await page.locator('[data-testid="dwrc-query"]').fill('');
     await page.locator('[data-testid="dwrc-table"]').fill(current.table);
     await page.locator('[data-testid="dwrc-search"]').click();
     let selected=false;
     for(let pageNo=0;pageNo<100000;pageNo++){
      const pick=page.locator('[data-testid="dwrc-select-'+current.recordId+'"][data-current-source-id="'+current.sourceId+'"]');
      if(await pick.count()){await pick.click();selected=true;break;}
      const next=page.getByRole('button',{name:'Next',exact:true}).last();
      required(await next.count()&&!await next.isDisabled(),'Find the explicitly selected current row in its complete edition pages.');
      await next.click();
     }
     required(selected,'Select the exact original current row.');
     await page.locator('[data-testid="dwrc-binding-reason-'+binding.rowKey+'"]').fill(binding.reason);
    }
    prepared=await reconciliationMutation(page,'reconciliationPrepare','prepare',()=>page.locator('[data-testid="dwrc-prepare"]').click());
   }
   required(prepared.returnId===returned.id&&prepared.worksheetId===worksheet.id&&
    prepared.currentEditionId===native.currentEditionId&&same(prepared.bindings,native.bindings),
    'The browser preparation must retain every explicitly chosen original/current reference.');
   await openReconciliationRecord(page,'correctionWorksheetReconciliations',prepared.id);
   await page.locator('[data-testid="dwrc-full-file"]').click();
   const changes=await comparisonFile(prepared,'browser/reconciliation-complete-comparison');
   required(changes.some(x=>x.representation==='csv'&&x.state==='conflict')&&
    changes.some(x=>x.pointer==='/worksheetClientNull'&&x.base.present===false&&
     x.proposed.present===true&&x.proposed.valueJson==='null'&&x.current.present===false&&x.state==='proposable'),
    'Read the actual current CSV conflict and clean absent-to-null customer proposal.');
   let review;
   if(journal.ui.steps.reconciliationReview)review=await replayUI(page,'reconciliationReview');
   else{
    await page.locator('[data-testid="dwrc-review-label"]').fill('Explicit complete current-edition customer decisions');
    await page.locator('[data-testid="dwrc-review-actor"]').fill('450E complete three-way browser course');
    await page.locator('[data-testid="dwrc-review-note"]').fill('Accept the reviewed CSV conflict and explicit JSON null; keep the other current field absence.');
    for(const change of changes){
     const control=page.locator('[data-testid="dwrc-decision-'+change.changeId+'"]');
     while(!await control.count()){
      const next=page.getByRole('button',{name:'Next',exact:true}).first();
      required(await next.count()&&!await next.isDisabled(),'Review every complete customer change.');
      await next.click();
     }
     const decision=change.pointer==='/worksheetClientKept'?'keep-current':'accept-proposed';
     await control.selectOption(decision);
     await page.locator('[data-testid="dwrc-reason-'+change.changeId+'"]').fill(
      decision==='keep-current'?'Explicitly keep the current field absence.':
      'Explicitly accept the full proposed value after reading base, proposal and current.');
    }
    journal.ui.working=await worksheetDownload(page,'dwrc-save-working',join(out,'browser','Three_Way_Working.json'),'complete three-way working review');
    await checkpoint();await page.reload({waitUntil:'domcontentloaded'});
    await directoryWorksheetsReady(page);await reconciliationReady(page);
    await page.locator('[data-testid="dwrc-working-import"]').setInputFiles(journal.ui.working.file);
    await page.locator('[data-reconciliation-record-id="'+prepared.id+'"]').waitFor({timeout:120000});
    review=await reconciliationMutation(page,'reconciliationReview','review',()=>page.locator('[data-testid="dwrc-save-review"]').click());
   }
   required(hash(review.planId)&&review.reconciliationId===prepared.id&&review.currentEditionId===native.currentEditionId&&
    review.outcome==='plan-prepared','Retain the ordinary current-edition plan from the explicit three-way decisions.');
   const reviewed=await packetFile('browser/reconciliation-complete-decisions','directory_correction_worksheet_reconciliation_file',
    {collection:'correctionWorksheetReconciliationReviews',recordId:review.id,fileKind:'decisions'},review.files.decisions);
   const decisions=(await readFile(reviewed.artifact.file,'utf8')).trimEnd().split('\n').filter(Boolean).map(JSON.parse);
   required(decisions.length===changes.length&&decisions.every(x=>x.decision===
    (x.pointer==='/worksheetClientKept'?'keep-current':'accept-proposed')),
    'The full saved decisions must match every explicit browser choice.');
   await openReconciliationRecord(page,'correctionWorksheetReconciliationReviews',review.id);
   await page.locator('[data-testid="dwrc-open-plan"]').click();
   await page.locator('[data-testid="dcw-review"][data-correction-record-id="'+review.planId+'"]').waitFor({timeout:120000});
   let preview,correction;
   if(journal.ui.steps.preview)preview=await replayUI(page,'preview');
   else{
    activeUI={key:'preview',action:'correction-preview'};
    try{
     const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/directory/corrections/preview'&&r.request().method()==='POST',{timeout:600000});
     await page.locator('[data-testid="dcw-preview"]').click();
     preview=await finishUIResponse('preview',await wait);
    }finally{activeUI=null;}
   }
   await openCorrectionRecord(page,'correctionPreviews',preview.id);
   await page.locator('[data-testid="dcw-review-actor"]').fill('450E explicit worksheet correction acceptance');
   if(journal.ui.steps.apply)correction=await replayUI(page,'apply');
   else{
    activeUI={key:'apply',action:'correction-apply'};
    try{
     const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/directory/corrections/apply'&&r.request().method()==='POST',{timeout:600000});
     await page.locator('[data-testid="dcw-apply"]').click();
     correction=await finishUIResponse('apply',await wait);
    }finally{activeUI=null;}
   }

   required(correction.beforeEditionId===native.currentEditionId&&correction.planId===review.planId,
    'The accepted browser correction must derive from the explicitly selected current edition.');
   journal.ui.cases.authored={editionId:worksheet.editionId,currentEditionId:native.currentEditionId,
    worksheetId:worksheet.id,importId:imported.id,returnId:returned.id,reconciliationId:prepared.id,reviewId:review.id,
    planId:review.planId,previewId:preview.id,correctionId:correction.id,acceptedEditionId:correction.editionId,
    candidateEditionId:correction.editionId,comparisonId:correction.comparisonId};
   journal.ui.screenshot=await screenshot(page,'Worksheet_Current_Edition_Reviewed.png');
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,
    'Complete the actual offline customer, current-edition review and correction without untracked writes or browser errors.');
   journal.ui.state='complete';journal.ui.completedAt=now();await checkpoint();
  }finally{await closeBrowser(attempt);}
 }

 async function verifyNative(){
  for(const[collection,ids]of Object.entries(native.recordIds)){
   if(PRIVATE_MUTABLE.has(collection))continue;
   for(const recordId of ids){
    const observed=await call('native/records/'+collection+'/'+recordId,'directory_record',{collection,recordId});
    required(observed.value.id===recordId,'Retain every immutable completed native record.');
    const expected=native.baselineRecordHashes[collection+'/'+recordId]??native.originalDirectoryRecordHashes[collection+'/'+recordId];
    if(expected)required(observed.response.sha256===expected,'Preserve the complete source-defined original record bytes.');
   }
  }
  const prepared=await read(client,'directory_record',
   {collection:'correctionWorksheetReconciliations',recordId:native.preparation.record.id});
  required(same(prepared,native.preparation.record)&&same(prepared.bindings,native.bindings)&&
   prepared.currentEditionId===native.currentEditionId&&prepared.returnId===native.originalReturnId,
   'Reopen the exact original native comparison and explicitly selected edition.');
  for(const [key,row]of Object.entries(native.cases)){
   const review=await read(client,'directory_record',
    {collection:'correctionWorksheetReconciliationReviews',recordId:row.review.record.id});
   const correction=await read(client,'directory_record',{collection:'corrections',recordId:row.correction.correctionId});
   required(review.reconciliationId===row.preparation.record.id&&review.planId===row.correction.planId&&
    correction.previewId===row.correction.previewId&&correction.editionId===row.correction.acceptedEditionId&&
    correction.beforeEditionId===row.preparation.record.currentEditionId,
    'Reopen the full native current-edition comparison → explicit decisions → accepted correction: '+key);
  }
 }
 async function connectedCourse(){
  for(const row of native.connectedInputs.replay){
   required(['reconciliation','correction'].includes(row.family)&&object(row.input),
    'Replay only exact complete original native requests.');
   const prefix=row.family==='reconciliation'?'correction_worksheet_reconciliation_':'correction_',
    action='directory_'+prefix+row.action,input={[prefix+row.action]:row.input};
   const received=await call('native-replay/'+row.key,action,input);
   required(received.value.id===row.expectedRecordId,'Exact native request replay returned another record: '+row.key);
   if(row.family==='reconciliation'&&['prepare','review'].includes(row.action)){
    const invokeTyped=row.action==='prepare'?prepareDirectoryWorksheetReconciliation:reviewDirectoryWorksheetReconciliation,
     typed=await invokeTyped({client,workspace:alias,input:row.input,requestOptions:timeout});
    required(typed.record.id===row.expectedRecordId&&same(typed.record,received.value),
     'The typed SDK must retain the same complete original native request result.');
    await observedJSON('native-replay/'+row.key+'-typed.json',typed,x=>x.record);
   }
   journal.connected.replay[row.key]={action,recordId:received.value.id,result:received.result};await checkpoint();
  }
  const worksheetCollections=['correctionWorksheets','correctionWorksheetImports','correctionWorksheetReturns','correctionWorksheetReviews'],
   reconciliationCollections=['correctionWorksheetReconciliations','correctionWorksheetReconciliationReviews'];
  for(const collectionName of worksheetCollections){
   for(const selected of await collection(client,collectionName)){
    const recordId=selected.id,readKey=collectionName+'/'+recordId,
     observed=await readHumanServicesDirectoryWorksheet({client,workspace:alias,collection:collectionName,recordId,requestOptions:timeout});
    journal.connected.reads[readKey]=await observedJSON('worksheets/'+readKey+'/record.json',observed,x=>x.record);await checkpoint();
    try{
     for await(const{page,result}of iterateHumanServicesDirectoryWorksheet({client,workspace:alias,collection:collectionName,recordId,limit:25,requestOptions:timeout}))
      await observedJSON('worksheets/'+readKey+'/pages/'+page.offset+'.json',{page,result},x=>x.page);
    }catch(error){
     if(error.code!=='HUMAN_SERVICES_DIRECTORY_WORKSHEET_PAGE_REJECTED')throw error;
     journal.connected.pageFallbacks??={};journal.connected.pageFallbacks[readKey]={code:error.code,details:error.details??null};await checkpoint();
    }
    for(const[fileKind,expected]of Object.entries(observed.record.files))
     await packetFile('worksheets/'+readKey+'/'+fileKind,'directory_correction_worksheet_file',
      {collection:collectionName,recordId,fileKind},expected);
    if(collectionName==='correctionWorksheets'){
     const document=await packetFile('worksheets/'+readKey+'/document','directory_correction_worksheet_file',
      {collection:collectionName,recordId,fileKind:'worksheet'},null),value=await readJSON(document.artifact.file);
     required(value.worksheetId===recordId&&value.workspaceId===native.workspaceId&&value.editionId===selected.editionId,
      'Retain the complete original portable worksheet document.');
    }
   }
  }
  for(const collectionName of reconciliationCollections){
   for(const selected of await collection(client,collectionName)){
    const recordId=selected.id,readKey=collectionName+'/'+recordId,
     observed=await getDirectoryWorksheetReconciliationRecord({client,workspace:alias,collection:collectionName,recordId,requestOptions:timeout});
    required(same(observed.record,selected),'Reopen the complete original typed reconciliation record.');
    journal.connected.reads[readKey]=await observedJSON('reconciliations/'+readKey+'/record.json',observed,x=>x.record);await checkpoint();
    try{
     for await(const{page,result}of directoryWorksheetReconciliationRows({
      client,workspace:alias,collection:collectionName,recordId,limit:25,requestOptions:timeout}))
      await observedJSON('reconciliations/'+readKey+'/pages/'+page.offset+'.json',{page,result},x=>x.page);
    }catch(error){
     if(error.code!=='HUMAN_SERVICES_DIRECTORY_RECONCILIATION_PAGE_REJECTED')throw error;
     journal.connected.pageFallbacks??={};journal.connected.pageFallbacks[readKey]={code:error.code,details:error.details??null};await checkpoint();
    }
    for(const[fileKind,expected]of Object.entries(observed.record.files))
     await packetFile('reconciliations/'+readKey+'/'+fileKind,'directory_correction_worksheet_reconciliation_file',
      {collection:collectionName,recordId,fileKind},expected);
    const reconciliationId=collectionName==='correctionWorksheetReconciliations'?recordId:selected.reconciliationId,
     reviewId=collectionName==='correctionWorksheetReconciliationReviews'?recordId:null;
    const exported=await call('reconciliation-exports/'+readKey,'directory_correction_worksheet_reconciliation_export',{
     correction_worksheet_reconciliation_export:{reconciliationId,reviewId,actor:'450E complete reconciliation client receiving',
      label:'Complete original/current comparison '+recordId,note:'Complete original worksheet, customer return, current bindings and selected explicit decisions.'}});
    const file=await packetFile('reconciliation-packages/'+readKey,'directory_export_file',{exportId:exported.value.id},exported.value.file);
    journal.connected.exports[readKey]={record:exported.value,file:file.artifact};await checkpoint();
   }
  }
  for(const collectionName of ['correctionPlans','correctionPreviews','corrections']){
   for(const selected of await collection(client,collectionName)){
    const recordId=selected.id,
     observed=await readHumanServicesDirectoryCorrection({client,workspace:alias,collection:collectionName,recordId,requestOptions:timeout});
    for await(const{page,result}of iterateHumanServicesDirectoryCorrection({client,workspace:alias,collection:collectionName,recordId,limit:25,requestOptions:timeout}))
     await observedJSON('corrections/'+collectionName+'/'+recordId+'/pages/'+page.offset+'.json',{page,result},x=>x.page);
    for(const[fileKind,expected]of Object.entries(observed.record.files))
     await packetFile('corrections/'+collectionName+'/'+recordId+'/'+fileKind,'directory_correction_file',
      {collection:collectionName,recordId,fileKind},expected);
    if(collectionName!=='corrections')continue;
    for(const editionId of [selected.beforeEditionId,selected.editionId])
     await packetFile('indices/editions/'+editionId,'directory_index_file',{collection:'editions',recordId:editionId},null);
    await packetFile('indices/comparisons/'+selected.comparisonId,'directory_index_file',{collection:'comparisons',recordId:selected.comparisonId},null);
    await packetFile('changes/'+selected.comparisonId,'directory_comparison_changes_file',{comparisonId:selected.comparisonId},null);
    for(const pair of selected.sources)
     for(const[sourceId,expected]of [[pair.sourceId,pair.originalFile],[pair.derivedSourceId,pair.derivedFile]])
      await packetFile('source-files/'+sourceId,'directory_source_file',{sourceId},expected);
   }
  }
  journal.connected.state='complete';journal.connected.completedAt=now();await checkpoint();
 }

 async function observeReopenedBrowser(workspace,label){
  const {page,attempt}=await openBrowser(label,{readOnly:true});
  try{
   await go(page,workspace);
   for(const row of Object.values(journal.ui.cases)){
    await directoryWorksheetsReady(page);
    for(const[kind,id]of [['correctionWorksheets',row.worksheetId],['correctionWorksheetImports',row.importId],
     ['correctionWorksheetReturns',row.returnId]])await openWorksheetRecord(page,kind,id);
    await openReconciliationRecord(page,'correctionWorksheetReconciliations',row.reconciliationId);
    await openReconciliationRecord(page,'correctionWorksheetReconciliationReviews',row.reviewId);
   }
   for(const row of Object.values(native.cases)){
    await openReconciliationRecord(page,'correctionWorksheetReconciliations',row.preparation.record.id);
    await openReconciliationRecord(page,'correctionWorksheetReconciliationReviews',row.review.record.id);
   }
   await openReconciliationRecord(page,'correctionWorksheetReconciliationReviews',native.keepCurrentReview.record.id);
   const image=await screenshot(page,label+'.png');
   required(attempt.errors.length===0&&attempt.blockedWrites.length===0,
    'Reopen the complete original return, current comparison and decision histories without another mutation.');
   return {image,cases:journal.ui.cases,nativeCases:Object.keys(native.cases),readOnly:true,allStagesReopened:true};
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
  for(const collectionName of ['correctionWorksheets','correctionWorksheetImports','correctionWorksheetReturns','correctionWorksheetReviews',
   'correctionWorksheetReconciliations','correctionWorksheetReconciliationReviews','correctionPlans','correctionPreviews','corrections'])
   for(const id of Object.keys(expected[collectionName]??{})){
    const fn=['correctionWorksheetReconciliations','correctionWorksheetReconciliationReviews'].includes(collectionName)?
     getDirectoryWorksheetReconciliationRecord:collectionName.startsWith('correctionWorksheet')?
     readHumanServicesDirectoryWorksheet:readHumanServicesDirectoryCorrection;
    const full=await fn({client:receiverClient,workspace:alias,collection:collectionName,recordId:id,requestOptions:timeout});
    required(full.record.id===id,'Customer full original worksheet/current-edition decision did not reopen.');
   }
  for(const collectionName of ['sources','editions','comparisons'])
   for(const id of Object.keys(expected[collectionName]??{})){
    await packetFile('customer-indices/'+collectionName+'/'+id,'directory_index_file',{collection:collectionName,recordId:id},null,{who:receiverClient});
    if(collectionName==='sources')
     await packetFile('customer-original-sources/'+id,'directory_source_file',{sourceId:id},null,{who:receiverClient});
   }
  await receiverClient.close();receiverClient=null;await receiverOwner.close();receiverOwner=null;
  receiverOwner=new HumanServicesDirectoryConnection(config.workspaces.corrections);await receiverOwner.open();
  receiverClient=await openHumanServicesDirectoryLocalClient({connection,exportsDirectory:join(out,'customer-exports')});
  await inventory(receiverClient,'customer-cold-reopened',expected);
  const observation=await observeReopenedBrowser(target,'Worksheet_Customer_Reopened');
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
  lease=await operationLease(join(out,'worksheet-reconciliation-clients.lock'));
  journal=await readJSON(journalPath,true);
  if(journal)required(journal.schema===JOURNEY_SCHEMA&&same(journal.binding,binding),'Resume the original complete source and native result.');
  else journal={schema:JOURNEY_SCHEMA,operation:OPERATION,binding,createdAt:now(),calls:{},downloads:{},
   ui:{state:'prepared',steps:{},files:{},cases:{}},connected:{state:'prepared',replay:{},reads:{},histories:{},exports:{}},
   browserAttempts:[],failures:[]};
  await checkpoint();
  if(journal.result){
   await checkedFile(journal.result);const result=await readJSON(journal.result.file);await checkedFile(result.workspacePacket);
   required(result.schema===RESULT_SCHEMA&&result.nativeSha256===binding.nativeSha256,'The completed original result changed.');
   emit('DIRECTORY_WORKSHEET_RECONCILIATION_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket,recovered:true});
   return result;
  }
  const initialConnection=join(out,'native-intake-connection.json'),initialConfiguration={schema:CONNECTION_SCHEMA,
   workspaces:{corrections:{directory:args['--workspace'],label:'Original complete worksheet client workspace',allowStart:true,
    inputs:{'native-workspace':{file:originalArchive.file,sha256:originalArchive.sha256,label:'Exact completed native worksheet workspace'}}}}};
  const previousInitial=await readJSON(initialConnection,true);
  if(previousInitial)required(same(previousInitial,initialConfiguration),'Keep the exact original native packet selection.');
  else await saveJSON(initialConnection,initialConfiguration,true);
  const initialConfig=await readHumanServicesDirectoryConfiguration(initialConnection);
  owner=new HumanServicesDirectoryConnection(initialConfig.workspaces.corrections);await owner.open();
  client=await openHumanServicesDirectoryLocalClient({connection:initialConnection,exportsDirectory:join(out,'initial-exports')});
  const imported=await client.call('directory_workspace_import',{workspace:alias,input:'native-workspace',expectedSha256:originalArchive.sha256},timeout);
  required(imported.native?.ok&&imported.retention?.state==='COMPLETE','Receive the original completed native worksheet workspace.');
  const importedValue=await readHumanServicesDirectoryValue({client,result:imported});
  required(importedValue.workspaceId===native.workspaceId&&importedValue.archiveSha256===originalArchive.sha256&&importedValue.reconstructed===true,
   'Restore the exact native worksheet packet and original UUID.');
  const nativeReceipt=await read(client,'directory_record',{collection:'receives',recordId:originalArchive.sha256});
  required(nativeReceipt.kind==='workspace'&&nativeReceipt.state==='complete'&&nativeReceipt.workspaceId===native.workspaceId&&nativeReceipt.archiveSha256===originalArchive.sha256,
   'Retain the original complete native import receipt.');
  journal.nativeReceive=await observedJSON('native/Original_Receive.json',nativeReceipt,
   r=>({id:r.id,workspaceId:r.workspaceId,archiveSha256:r.archiveSha256,kind:r.kind,state:r.state,completed:r.completed}));
  journal.nativeReturnFiles??={};
  for(const row of native.connectedInputs.replay){
   if(row.family!=='worksheet'||row.action!=='receive')continue;
   required(hash(row.importId)&&hash(row.expectedRecordId)&&row.file&&hash(row.file.sha256),'Keep the full original returned-file replay binding.');
   const selected=await read(client,'directory_record',{collection:'correctionWorksheetReturns',recordId:row.expectedRecordId});
   required(selected.importId===row.importId&&selected.files.original.bytes===row.file.bytes&&selected.files.original.sha256===row.file.sha256,
    'The original native return differs from the frozen replay input.');
   const received=await packetFile('native-return-originals/'+row.key,'directory_correction_worksheet_file',
    {collection:'correctionWorksheetReturns',recordId:row.expectedRecordId,fileKind:'original'},selected.files.original);
   journal.nativeReturnFiles[row.key]=received.artifact;await checkpoint();
  }
  await client.close();client=null;
  const connection=join(out,'worksheet-merchant-connection.json'),configuration={schema:CONNECTION_SCHEMA,
   workspaces:{corrections:{directory:args['--workspace'],label:'Complete worksheet operator and Merchant course',allowStart:true,
    inputs:Object.fromEntries(Object.entries(journal.nativeReturnFiles).map(([key,file])=>['native-'+key,
     {file:file.file,sha256:file.sha256,label:'Exact original native returned file '+key}]))}}};
  const previous=await readJSON(connection,true);
  if(previous)required(same(previous,configuration),'Keep all original Merchant return-file aliases.');
  else await saveJSON(connection,configuration,true);
  await startMerchant(connection);
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
  journal.reopened=await observeReopenedBrowser(args['--workspace'],'Worksheet_Merchant_Reopened');await checkpoint();
  const packet=await packetFile('complete-correction-workspace','directory_workspace_packet',{},null);
  journal.sourceWorkspacePacket=packet.artifact;await checkpoint();
  await client.close();client=null;await merchant.close();merchant=null;await owner.close();owner=null;
  await receiveCustomer(journal.sourceWorkspacePacket,journal.finalRecords);
  journal.completedAt??=now();await checkpoint();
  const result={schema:RESULT_SCHEMA,operation:OPERATION,completedAt:journal.completedAt,...binding,
   sourceRoot:HERE,nativeReceiving:{file:args['--native-receiving'],bytes:raw.length,sha256:digest(raw)},
   nativeWorksheetResult:native.nativeWorksheetResult,originalCases:native.cases,
   originalWorksheetId:native.originalWorksheetId,originalReturnId:native.originalReturnId,
   originalEditionId:native.originalEditionId,currentEditionId:native.currentEditionId,
   originalDirectoryRecordHashes:native.originalDirectoryRecordHashes,baselineRecordHashes:native.baselineRecordHashes,
   correctionRecordIds:Object.keys(journal.finalRecords.corrections),recordIds:Object.fromEntries(Object.entries(journal.finalRecords).map(([kind,rows])=>[kind,Object.keys(rows)])),
   browser:journal.ui,connected:journal.connected,
   reopened:journal.reopened,customer:journal.customer,sourceWorkspacePacket:journal.sourceWorkspacePacket,
   workspacePacket:journal.workspacePacket,
   allOriginalRecordsRetained:true,journal:journalPath,
   meaning:'Explicitly authored offline customer worksheet, complete unchanged returned file, explicit matching to the selected current edition, original/proposed/current comparison and complete decisions, separate correction preview and acceptance, full SDK/MCP receiving and cold reopened customer workspace. Original source bytes and historical editions remain retained. No external publisher update, customer acceptance or live service availability is inferred.'};
  journal.result=await jsonFile('OPERATED_DIRECTORY_WORKSHEET_RECONCILIATION_CLIENTS.json',result);await checkpoint();
  emit('DIRECTORY_WORKSHEET_RECONCILIATION_CLIENTS_COMPLETE',{result:journal.result,workspacePacket:result.workspacePacket});return result;
 }catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack,resources:await memory()});await checkpoint();}
  emit('DIRECTORY_WORKSHEET_RECONCILIATION_CLIENTS_INTERRUPTED',{journal:journalPath,error:{code:error.code||error.name,message:error.message}});throw error;
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await receiverClient?.close().catch(()=>{});await receiverOwner?.close().catch(()=>{});
  await client?.close().catch(()=>{});await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  try{if(journal)await checkpoint();}finally{await lease?.close();}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write((error.stack||error.message)+'\n');process.exitCode=1;});
