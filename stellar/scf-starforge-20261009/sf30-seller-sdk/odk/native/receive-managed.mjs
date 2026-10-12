#!/usr/bin/env node
// MIT. One original installed ODK managed-workspace receiving operation.
import {readFile,writeFile,mkdir,open,rename,unlink,stat,realpath,link} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,dirname,isAbsolute,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export const MANAGED_RECEIVING_SCHEMA='stellar-forge.odk-managed-receiving.v1';
export const MANAGED_RECEIVING_OPERATION='CB57-ODK-MANAGED-RECEIVING';
const SOURCE_COMMIT='738f8a1ee03154817c4c4aa354002ab774292d52';
const FIELD_PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/odk/';
const PINNED={
  'managed.mjs':'0e0bc413b10c03e74f543cb5cab7563f14841a5d',
  'connection.mjs':'d1be050e04d5227f60e2616dfb1e0ba9831a601d',
  'application-provider.mjs':'37736b0f258a0b3505fa5e456935d44a5c761157',
  'mcp.mjs':'a5f451168e0309c70ca4f053d4db6a899366eded',
  'index.mjs':'792aa5f59cc263d2a95e3e6f1c43786e5d15523c',
  'index.html':'5ab22e85d266b5b84d7a55b4e8841d637fb20b8e',
  'ui.mjs':'70263883aefef76afea6ebe91ae4bd2e5ce62994',
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
function requireValue(value,code,message){if(!value)throw Object.assign(new Error(message||code),{code});}
function describe(error){return {code:error.code||'CENTRAL_MANAGED_RECEIVING',message:String(error.message||error).slice(0,4000)};}
const formatted=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const identity=(operation,kind)=>'managed-'+digest(operation+'\n'+kind).slice(0,40);
function safeMember(base,path){
  requireValue(typeof path==='string'&&path&&!isAbsolute(path),'CENTRAL_MANAGED_PACKAGE','Use the original package-relative entry.');
  const target=resolve(base,path),rel=relative(base,target);
  requireValue(rel&&!rel.startsWith('..'+String.fromCharCode(47))&&rel!=='..'&&!isAbsolute(rel),
    'CENTRAL_MANAGED_PACKAGE','Keep entries inside the selected installed package.');
  return target;
}
async function bytesReceipt(path){const file=await open(path,'r');try{
  const before=await file.stat();requireValue(before.isFile(),'CENTRAL_MANAGED_FILE','Use a complete regular original file.');
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let length=0;
  while(length<before.size){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-length),length);
    requireValue(bytesRead>0,'CENTRAL_MANAGED_FILE','The selected original file was truncated.');
    hash.update(buffer.subarray(0,bytesRead));length+=bytesRead;}
  const after=await file.stat();
  requireValue(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),
    'CENTRAL_MANAGED_FILE_CHANGED','The original file changed during receiving.');
  return {path,bytes:length,sha256:hash.digest('hex')};
}finally{await file.close();}}
async function save(path,value){const raw=formatted(value),temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
  await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  return {path,bytes:raw.length,sha256:digest(raw)};}
async function readOptional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function immutable(path,value){
  const raw=formatted(value),old=await readOptional(path);
  if(old){requireValue(stable(old)===stable(value),'CENTRAL_MANAGED_REVIEW_CHANGED','Keep the original retained receiving input.');
    return bytesReceipt(path);}
  const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try{
    try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
    try{await link(temporary,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const retained=await readOptional(path);
      requireValue(retained&&stable(retained)===stable(value),'CENTRAL_MANAGED_REVIEW_CHANGED','Keep the original retained receiving input.');
    }
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
    return bytesReceipt(path);
  }finally{await unlink(temporary).catch(()=>{});}
}
async function pause(ms){await new Promise(resolve=>setTimeout(resolve,ms));}
async function absent(path){try{await stat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
function initialAgreement(operation){return {
  schema:'stellar-forge.central-source-agreement.v1',opportunity_id:operation,
  name:'Original managed operator receiving — source selection pending',
  customer_decisions:{accountable_project_owner:'Managed receiving operator',technical_receiver:'Receiving operator',
    authorized_central_origin:null,project_id:null,selected_forms:[],reporting_timezone:'UTC',periods:[],
    late_edit_policy:'current-state-at-capture',review_state_inclusion:'all',metric_definitions:[],
    approved_output_fields:[],media_retention_selection:'complete-selected-capture'},
  processing:{reviewStates:'all',lateEdits:'current-state-at-capture',portableSource:'complete-selected-capture'},
  kickoff:{status:'proposed',start:null},
  operator_note:'This saved draft exercises the installed operator. No Central service, form selection, capture, customer acceptance or delivery date is asserted.'
};}
function projection(core,commissioning,warehouse){
  return {workspaceId:core.id,createdAt:core.createdAt,connections:core.connections,plans:core.plans,
    captures:core.captures,reviews:core.reviews,exports:core.exports,reports:core.reports,
    drafts:commissioning.drafts,hostReceipts:commissioning.hostReceipts,inspections:commissioning.inspections,
    commissions:commissioning.commissions,approvals:warehouse.approvals,operations:warehouse.operations,
    warehouseProfiles:warehouse.profiles};
}
async function download(url,token,path,expected,signal){
  const old=await absent(path)?null:await bytesReceipt(path);
  if(old){requireValue(old.bytes===expected.bytes&&old.sha256===expected.sha256,
    'CENTRAL_MANAGED_DOWNLOAD_CHANGED','The retained original download differs.');return old;}
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',
    signal:signal??AbortSignal.timeout(120000)});
  requireValue(response.ok,'CENTRAL_MANAGED_DOWNLOAD','The original authenticated download failed: '+response.status);
  const temporary=path+'.partial',file=await open(temporary,'w',0o600),hash=createHash('sha256');let count=0;
  try{for await(const chunk of response.body){
    count+=chunk.length;requireValue(count<=expected.bytes,'CENTRAL_MANAGED_DOWNLOAD','Original download is too large.');
    hash.update(chunk);await file.writeFile(chunk);}
    requireValue(count===expected.bytes&&hash.digest('hex')===expected.sha256,
      'CENTRAL_MANAGED_DOWNLOAD','Original archive bytes or SHA-256 differ.');await file.sync();
  }finally{await file.close();}
  await rename(temporary,path);return bytesReceipt(path);
}
async function waitClosed(child,closed,milliseconds){
  const timer={};try{return await Promise.race([closed,new Promise(resolve=>{timer.id=setTimeout(()=>resolve(null),milliseconds);})]);}
  finally{clearTimeout(timer.id);}
}
async function stopChild(owner){
  if(!owner)return;
  let result=owner.exit??await waitClosed(owner.child,owner.closed,1);
  if(!result){owner.child.kill('SIGTERM');result=await waitClosed(owner.child,owner.closed,15000);}
  if(!result){owner.child.kill('SIGKILL');result=await waitClosed(owner.child,owner.closed,15000);}
  requireValue(result,'CENTRAL_MANAGED_CLOSE','The exact managed child did not close.');
  owner.exit=result;return result;
}
async function startChild({node,bin,directory,operator,logDirectory,phase,restoreArchive,restoreSha256,onStart,onOwned,checkOpen}){
  const args=['odk-central-workspace','--workspace',directory,'--operator',operator,
    ...(restoreArchive?['--restore-archive',restoreArchive,'--restore-sha256',restoreSha256]:[])];
  const stdout=await open(join(logDirectory,phase+'.stdout'),'a',0o600);let stderr;
  try{stderr=await open(join(logDirectory,phase+'.stderr'),'a',0o600);}
  catch(error){await stdout.close();throw error;}
  let child,owner,succeeded=false,failure=null;
  try{
    checkOpen();
    child=spawn(node,[bin,...args],{stdio:['ignore','pipe',stderr.fd],env:{...process.env},windowsHide:true});
    const closed=new Promise(resolve=>{child.once('error',error=>resolve({code:null,signal:null,error:describe(error)}));
      child.once('close',(code,signal)=>resolve({code,signal}));});
    owner={child,closed,args,directory,phase,exit:null};closed.then(value=>{owner.exit=value;});onOwned(owner);
    let text='',settled=false,resolveStartup,rejectStartup;
    const startup=new Promise((resolve,reject)=>{resolveStartup=resolve;rejectStartup=reject;});
    let logWrites=Promise.resolve(),logError=null;
    owner.closeLogs=()=>owner.logsClosing??=(async()=>{await logWrites;const results=await Promise.allSettled([stdout.close(),stderr.close()]);
      const error=logError??results.find(value=>value.status==='rejected')?.reason;if(error)throw error;})();
    child.stdout.on('data',chunk=>{
      logWrites=logWrites.then(()=>stdout.writeFile(chunk)).catch(error=>{logError??=error;});
      if(settled)return;text+=chunk.toString('utf8');
      if(text.length>1048576){settled=true;rejectStartup(Object.assign(new Error('Managed startup exceeded one MiB.'),{code:'CENTRAL_MANAGED_STARTUP'}));return;}
      for(;;){const end=text.indexOf('\n');if(end<0)break;const line=text.slice(0,end);text=text.slice(end+1);
        if(!line.startsWith('{"schema":"stellar-forge.odk-central-workspace-startup.v1",'))continue;
        try{const value=JSON.parse(line);settled=true;resolveStartup(value);}catch(error){settled=true;rejectStartup(error);}break;}
    });
    closed.then(value=>{if(!settled){settled=true;rejectStartup(Object.assign(new Error('Original managed child closed before startup.'),{code:'CENTRAL_MANAGED_STARTUP',result:value}));}});
    const timeout=setTimeout(()=>{if(!settled){settled=true;rejectStartup(Object.assign(new Error('Original managed startup exceeded 60 seconds.'),{code:'CENTRAL_MANAGED_STARTUP'}));}},60000);
    try{owner.startup=await startup;}finally{clearTimeout(timeout);}
    checkOpen();await onStart?.(owner);succeeded=true;
    return owner;
  }catch(error){failure=error;if(owner)await stopChild(owner).catch(closeError=>{error.cleanup=describe(closeError);});throw error;}
  finally{if(!succeeded)try{if(owner?.closeLogs)await owner.closeLogs();else await Promise.allSettled([stdout.close(),stderr.close()]);}
    catch(error){if(failure)failure.logCleanup=describe(error);else throw error;}}
}
async function browserJourney({chromium,executablePath,directory,owner,workspaceId,archive,resultDirectory,draft,onContext,checkOpen}){
  const errors=[],httpErrors=[],context=await chromium.launchPersistentContext(directory,{
    headless:true,executablePath,viewport:{width:1365,height:1000},acceptDownloads:true});
  onContext(context);
  try{
    checkOpen();
    const page=context.pages()[0]??await context.newPage(),origin=owner.startup.origin;
    page.on('pageerror',error=>errors.push(String(error.message||error)));
    page.on('response',response=>{if(response.status()>=500)httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      return url.origin===origin||['data:','about:'].includes(url.protocol)?route.continue():route.abort();
    });
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
    await page.goto(owner.startup.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(id=>document.getElementById('identity')?.textContent.includes(id),workspaceId);
    const field=join(resultDirectory,'field-workspace.png');await page.screenshot({path:field,fullPage:true});
    await page.getByRole('button',{name:'Customer commissioning',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/commissioning/');
    await page.waitForFunction(id=>document.body.innerText.includes(id),workspaceId);
    await page.locator('#draft-select').selectOption(draft.id);
    await page.locator('#load-draft').click();
    await page.waitForFunction(revision=>document.getElementById('draft-revision')?.textContent.includes('Loaded draft revision '+revision),draft.revision);
    const shown=JSON.parse(await page.locator('#full-agreement').inputValue());
    requireValue(stable(shown)===stable(draft.agreement),'CENTRAL_MANAGED_BROWSER_DRAFT','The original browser did not show the complete saved agreement.');
    const commissioning=join(resultDirectory,'commissioning.png');await page.screenshot({path:commissioning,fullPage:true});
    const commissionText=(await page.locator('body').innerText()).slice(0,16000);
    await page.goto(owner.startup.warehouseUrl,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(id=>document.body.innerText.includes(id),workspaceId);
    const warehouse=join(resultDirectory,'warehouse.png');await page.screenshot({path:warehouse,fullPage:true});
    const warehouseText=(await page.locator('body').innerText()).slice(0,16000);
    await page.goto(owner.startup.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(id=>document.getElementById('identity')?.textContent.includes(id),workspaceId);
    await page.getByRole('button',{name:'Portable workspace',exact:true}).click();
    const row=page.locator('#archive-list tr').filter({hasText:archive.id});
    const action=row.getByRole('button',{name:'central-workspace.tar.gz',exact:true});
    await action.waitFor({state:'visible'});
    const event=page.waitForEvent('download',{timeout:45000});await action.click();const received=await event;
    const path=join(resultDirectory,'browser-central-workspace.tar.gz');await received.saveAs(path);
    requireValue(await received.failure()===null,'CENTRAL_MANAGED_BROWSER_DOWNLOAD','Original browser download failed.');
    const file=await bytesReceipt(path);
    requireValue(file.bytes===archive.expected.bytes&&file.sha256===archive.expected.sha256,
      'CENTRAL_MANAGED_BROWSER_DOWNLOAD','The real browser received different original archive bytes.');
    requireValue(errors.length===0&&httpErrors.length===0,'CENTRAL_MANAGED_BROWSER',
      'The original browser reported errors: '+JSON.stringify({errors,httpErrors}));
    return {browserVersion:context.browser()?.version()??null,field:await bytesReceipt(field),
      commissioning:await bytesReceipt(commissioning),warehouse:await bytesReceipt(warehouse),
      archive:file,commissioningText:commissionText,warehouseText,httpErrors,pageErrors:errors};
  }finally{await context.close();onContext(null);}
}
function cliOptions(argv){
  const fields=new Set(['package','work-directory','playwright','chromium','operation-id']);
  const values={};
  for(let index=0;index<argv.length;index+=2){const flag=argv[index];
    requireValue(flag?.startsWith('--')&&fields.has(flag.slice(2))&&!Object.hasOwn(values,flag.slice(2))&&argv[index+1],
      'CENTRAL_MANAGED_ARGUMENT','Use each declared option once with its exact value.');
    values[flag.slice(2)]=argv[index+1];}
  for(const name of ['package','work-directory','playwright','chromium'])
    requireValue(typeof values[name]==='string'&&isAbsolute(values[name]),'CENTRAL_MANAGED_ARGUMENT','Supply absolute '+name+'.');
  requireValue(!values['operation-id']||values['operation-id']===MANAGED_RECEIVING_OPERATION,
    'CENTRAL_MANAGED_OPERATION','Continue the existing original managed receiving operation.');
  return {packageDirectory:resolve(values.package),directory:resolve(values['work-directory']),
    playwright:resolve(values.playwright),chromium:resolve(values.chromium),operationId:MANAGED_RECEIVING_OPERATION};
}
export async function receiveManagedWorkspace(input){
  requireValue(Number(process.versions.node.split('.')[0])>=24,'CENTRAL_MANAGED_NODE','Use the selected existing Node.js 24 or newer.');
  const operation=input.operationId??MANAGED_RECEIVING_OPERATION,root=resolve(input.directory);
  requireValue(operation===MANAGED_RECEIVING_OPERATION,'CENTRAL_MANAGED_OPERATION','Keep this original managed receiving operation.');
  await mkdir(root,{recursive:true,mode:0o700});
  const rootInformation=await stat(root);
  requireValue(rootInformation.isDirectory()&&!(rootInformation.mode&0o077)&&
    (!process.getuid||rootInformation.uid===process.getuid())&&await realpath(root)===root,
    'CENTRAL_MANAGED_DIRECTORY','Choose the canonical original owned private receiving directory.');
  requireValue(process.env.CENTRAL_MANAGED_RECEIVING_LOCK_PARENT===String(process.ppid),
    'CENTRAL_MANAGED_OWNER','Use the original Python receiving entry, which holds the same OS file lock for this programme.');
  const lockValue={operationId:operation,pid:process.pid,parentPid:process.ppid,startedAt:new Date().toISOString()};
  let active=null,activeBrowser=null,mcp=null,client=null,reopenedOwner=null,primary=null,stopping=false;
  const checkOpen=()=>requireValue(!stopping,'CENTRAL_MANAGED_CANCELLED','The original receiving owner requested a stop.');
  const stop=()=>{stopping=true;active?.child.kill('SIGTERM');activeBrowser?.close().catch(()=>{});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGHUP',stop);
  const journalPath=join(root,'operation.json');
  let journal=await readOptional(journalPath);
  const paths={original:join(root,'original-workspace'),received:join(root,'received-workspace'),
    output:join(root,'delivery'),private:join(root,'private'),logs:join(root,'private','logs'),
    browser:join(root,'private','browser'),retained:join(root,'private','retained-files')};
  const closeActive=async()=>{if(!active)return;const owner=active;let failure;
    try{
      const exit=await stopChild(owner);
      requireValue(exit.code===0,'CENTRAL_MANAGED_CLOSE','The original managed child did not close successfully: '+JSON.stringify(exit));
      requireValue(await absent(join(owner.directory,'odk.connection.json')),'CENTRAL_MANAGED_CLOSE','The closed original listener still has its live connection file.');
      return {phase:owner.phase,pid:owner.child.pid,exit};
    }catch(error){failure=error;throw error;}
    finally{
      try{await owner.closeLogs?.();}
      catch(error){if(failure)failure.logCleanup=describe(error);else throw error;}
      finally{if(owner.exit&&active===owner)active=null;}
    }};
  try{
    for(const directory of Object.values(paths))await mkdir(directory,{recursive:true,mode:0o700});
    const packageDirectory=await realpath(input.packageDirectory),packagePath=join(packageDirectory,'package.json');
    const packageRaw=await readFile(packagePath),pkg=JSON.parse(packageRaw),entry=pkg.exports?.['./seller/odk'];
    const entryPath=typeof entry==='string'?entry:entry?.import;
    const sdkPath=safeMember(packageDirectory,entryPath),sdkDirectory=dirname(sdkPath);
    const binPath=safeMember(packageDirectory,typeof pkg.bin==='string'?pkg.bin:pkg.bin?.starforge);
    const manifestPath=join(packageDirectory,'manifest.json'),manifestReceipt=await bytesReceipt(manifestPath);
    const selectedSources=[];
    for(const [name,expected]of Object.entries(PINNED)){
      const path=join(sdkDirectory,name),raw=await readFile(path),sha=createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex');
      requireValue(sha===expected,'CENTRAL_MANAGED_SOURCE_CHANGED','Select the reviewed installed '+name+' from '+SOURCE_COMMIT+'.');
      selectedSources.push({path:FIELD_PREFIX+name,blobSha:sha,bytes:raw.length,sha256:digest(raw)});
    }
    const sdk=await import(pathToFileURL(sdkPath).href),application=await import(pathToFileURL(join(sdkDirectory,'application-provider.mjs')).href);
    const browserModule=await import(pathToFileURL(input.playwright).href),chromium=browserModule.chromium??browserModule.default?.chromium;
    requireValue(chromium?.launchPersistentContext,'CENTRAL_MANAGED_BROWSER','Choose the existing Playwright module.');
    requireValue((await stat(input.chromium)).isFile(),'CENTRAL_MANAGED_BROWSER','Choose the existing browser executable.');
    const request={schema:MANAGED_RECEIVING_SCHEMA,operationId:operation,sourceCommit:SOURCE_COMMIT,
      package:{name:pkg.name,version:pkg.version,packageSha256:digest(packageRaw),manifest:manifestReceipt.sha256,
        source:selectedSources},runtime:{node:process.execPath,nodeVersion:process.version,
        playwright:input.playwright,chromium:input.chromium},
      ids:{draft:identity(operation,'draft'),first:identity(operation,'first-draft'),second:identity(operation,'second-draft'),
        receiver:identity(operation,'receiving-draft'),archive:identity(operation,'archive'),file:identity(operation,'retained-file')},
      initialAgreement:initialAgreement(operation)};
    await immutable(join(paths.private,'request.json'),request);
    const requestSha256=digest(formatted(request));
    if(journal)requireValue(journal.requestSha256===requestSha256&&journal.operationId===operation,
      'CENTRAL_MANAGED_REVIEW_CHANGED','Continue the exact original source/runtime/request selection.');
    else journal={schema:MANAGED_RECEIVING_SCHEMA,operationId:operation,requestSha256,startedAt:new Date().toISOString(),steps:{}};
    journal.lastOwner=lockValue;await save(journalPath,journal);
    const record=async(name,value)=>{checkOpen();journal.steps[name]={...value,recordedAt:new Date().toISOString()};await save(journalPath,journal);return value;};
    const first={id:request.ids.draft,requestId:request.ids.first,expectedRevision:0,agreement:request.initialAgreement};
    const edited={...request.initialAgreement,operator_note:'The installed SDK and typed operator reviewed this same saved draft. Original Central source, forms, periods and authorization remain pending.'};
    const receivedAgreement={...edited,receiving_note:'The receiving operator reopened this original agreement and retained a later editable edition.'};
    const start=async(directory,phase,archive)=>{
      checkOpen();active=await startChild({checkOpen,onOwned:owner=>{active=owner;},node:process.execPath,bin:binPath,directory,operator:'CB57 original managed receiving',
        logDirectory:paths.logs,phase,...(archive?{restoreArchive:archive.path,restoreSha256:archive.sha256}:{}),
        onStart:async owner=>{
          const bound=await application.centralApplicationStartup({command:'odk-central-workspace',args:owner.args.slice(1),inputs:[]},
            JSON.stringify(owner.startup));
          requireValue(bound?.workspaceId===owner.startup.workspaceId,'CENTRAL_MANAGED_STARTUP','Applications did not accept its original managed startup.');
          await record(phase+'-startup',{workspaceId:bound.workspaceId,instanceId:owner.startup.instanceId,pid:owner.child.pid,
            connectionSha256:owner.startup.connectionSha256,origin:owner.startup.origin,warehouse:bound.original.warehouse,
            receivedArchive:bound.original.receivedArchive??null});
        }});
      checkOpen();client=await sdk.connectCentralWorkspace({directory,connectionFile:join(directory,'odk.connection.json')});return active;
    };
    const configurationPath=join(paths.private,'merchant.json');
    const hostConfiguration={schema:sdk.ODK_MCP_CONNECTION_SCHEMA,workspaces:{original:{
      label:'Original managed receiving',directory:paths.original,connections:{},merchants:{},runtimes:{}}}};
    await immutable(configurationPath,hostConfiguration);
    const host=await sdk.readCentralWorkspaceConfiguration(configurationPath);
    const tools=sdk.odkWorkspaceTools((name,description,properties,required,annotations)=>({name,description,properties,required,annotations}));
    for(const name of ['merchant_odk_connect','merchant_odk_backup','merchant_odk_commissioning_draft_save',
      'merchant_odk_warehouse_state','merchant_odk_file_retain','merchant_odk_file'])
      requireValue(tools.some(tool=>tool.name===name),'CENTRAL_MANAGED_CATALOG','Missing original typed operation '+name+'.');
    await record('installed-source',{package:request.package,toolCount:tools.length,
      command:'odk-central-workspace',sdkExport:'./seller/odk',manifest:manifestReceipt});
    if(!journal.steps['original-closed']){
      await start(paths.original,'original');
      const core=await client.state(),commission=await client.commissioningState(),warehouse=await client.warehouseState();
      requireValue(core.id===commission.workspaceId&&core.id===warehouse.workspaceId,
        'CENTRAL_MANAGED_NAMESPACES','All original namespaces must share one workspace.');
      requireValue(core.connections.length===0&&core.captures.length===0&&core.running.length===0,
        'CENTRAL_MANAGED_PROVIDER_SCOPE','This managed-only operation has no provider acquisition.');
      await record('same-workspace',{workspaceId:core.id,fieldSchema:core.schema,commissioningSchema:commission.schema,
        warehouseSchema:warehouse.schema,profiles:warehouse.profiles,providerCalls:0});
      const saved=await client.commissioningSaveDraft(first);
      requireValue(stable(saved.agreement)===stable(first.agreement)&&saved.readiness.ready===false,
        'CENTRAL_MANAGED_DRAFT','The complete incomplete agreement must remain editable with its missing decisions.');
      const repeated=await client.commissioningSaveDraft(first);
      requireValue(stable(repeated)===stable(saved),'CENTRAL_MANAGED_DRAFT_REPLAY','The original draft request replay changed its result.');
      await record('sdk-draft',{request:first,result:saved,replayed:true});
      mcp=new sdk.MerchantCentralWorkspaces({exportsDirectory:paths.retained,odkWorkspaces:host});
      const connected=await mcp.call('merchant_odk_connect',{workspace:'original',expectedInstanceId:active.startup.instanceId});
      requireValue(connected.workspaceId===core.id,'CENTRAL_MANAGED_MCP','The typed operator attached to a different workspace.');
      const second={id:request.ids.draft,requestId:request.ids.second,expectedRevision:saved.revision,agreement:edited};
      const typed=await mcp.call('merchant_odk_commissioning_draft_save',{workspace:'original',...second});
      const typedReplay=await mcp.call('merchant_odk_commissioning_draft_save',{workspace:'original',...second});
      requireValue(stable(typed)===stable(typedReplay)&&stable(typed.agreement)===stable(edited),
        'CENTRAL_MANAGED_MCP_REPLAY','Typed same-request replay did not preserve the complete draft.');
      const typedState=await mcp.call('merchant_odk_commissioning_state',{workspace:'original',offset:0,limit:1});
      const typedWarehouse=await mcp.call('merchant_odk_warehouse_state',{workspace:'original',offset:0,limit:1});
      requireValue(typedState.workspaceId===core.id&&typedWarehouse.workspaceId===core.id&&typedState.pages?.drafts?.total===1,
        'CENTRAL_MANAGED_MCP','Typed state must preserve native identity and explicit paging.');
      await record('typed-draft',{request:second,result:typed,commissioning:typedState,warehouse:typedWarehouse});
      const archive=await mcp.call('merchant_odk_backup',{workspace:'original',id:request.ids.archive});
      const again=await mcp.call('merchant_odk_backup',{workspace:'original',id:request.ids.archive});
      requireValue(archive.id===again.id&&stable(archive.files)===stable(again.files)&&stable(archive.receipts)===stable(again.receipts)&&archive.files.includes('central-workspace.tar.gz'),
        'CENTRAL_MANAGED_ARCHIVE','The exact native archive request did not replay its original result.');
      const expected=archive.receipts['central-workspace.tar.gz'];
      const descriptor=await client.exportFile({id:archive.id,path:'central-workspace.tar.gz'});
      requireValue(descriptor.sha256===expected.sha256&&descriptor.bytes===expected.bytes,
        'CENTRAL_MANAGED_ARCHIVE','The native source descriptor differs from its archive receipt.');
      const downloadPath='/api/files/export/'+encodeURIComponent(archive.id)+'?path='+encodeURIComponent('central-workspace.tar.gz');
      const receipt=await sdk.readCentralConnection(active.startup.connectionFile);
      const downloaded=await download(active.startup.origin+downloadPath,receipt.token,
        join(paths.output,'central-workspace.tar.gz'),expected);
      const retainedInput={workspace:'original',requestId:request.ids.file,downloadPath,expectedSha256:expected.sha256,expectedBytes:expected.bytes};
      const retained=await mcp.call('merchant_odk_file_retain',retainedInput);
      const retainedAgain=await mcp.call('merchant_odk_file_retain',retainedInput);
      requireValue(retained.fileId===retainedAgain.fileId&&retained.sha256===expected.sha256&&retained.bytes===expected.bytes,
        'CENTRAL_MANAGED_RETAINED_FILE','The original retained file changed on exact replay.');
      await record('archive',{id:archive.id,result:archive,descriptor,expected,downloaded,retained,retainedInput});
      const original=projection(await client.state(),await client.commissioningState(),await client.warehouseState());
      await immutable(join(paths.private,'original-projection.json'),original);
      await record('original-projection',{value:original,sha256:digest(formatted(original))});
      if(!journal.steps.browser){
        const browser=await browserJourney({chromium,executablePath:input.chromium,directory:paths.browser,owner:active,
          workspaceId:core.id,archive:{id:archive.id,expected},resultDirectory:paths.output,draft:typed,
          checkOpen,onContext:value=>{activeBrowser=value;}});
        await record('browser',browser);
      }
      client.close();client=null;
      const closed=await closeActive();
      const chunk=await mcp.call('merchant_odk_file',{workspace:'original',fileId:retained.fileId,
        expectedSha256:retained.sha256,offset:0,limit:196608});
      requireValue(chunk&&typeof chunk==='object','CENTRAL_MANAGED_RETAINED_FILE','The original file must remain readable after its application closes.');
      if(chunk.readId)await mcp.call('merchant_odk_file_release',{workspace:'original',readId:chunk.readId});
      await record('retained-after-close',{fileId:retained.fileId,sha256:retained.sha256,bytes:retained.bytes,response:chunk});
      await mcp.close();mcp=null;await record('original-closed',closed);
    }
    const original=journal.steps['original-projection'].value,archive=journal.steps.archive.downloaded;
    requireValue((await bytesReceipt(archive.path)).sha256===archive.sha256,'CENTRAL_MANAGED_ARCHIVE','Keep the original received archive bytes.');
    const receivingInput={id:request.ids.draft,requestId:request.ids.receiver,
      expectedRevision:journal.steps['typed-draft'].result.revision,agreement:receivedAgreement};
    if(!journal.steps['receiving-closed']){
      await start(paths.received,'received',archive);
      const state=await client.state(),commission=await client.commissioningState(),warehouse=await client.warehouseState();
      requireValue(state.id===original.workspaceId&&state.receivedArchive?.archiveSha256===archive.sha256&&
        state.receivedArchive.workspaceId===original.workspaceId,'CENTRAL_MANAGED_RESTORE','The original archive identity was not received.');
      const current=projection(state,commission,warehouse),withoutDraft=value=>({...value,drafts:[]});
      requireValue(stable(withoutDraft(current))===stable(withoutDraft(original)),
        'CENTRAL_MANAGED_RESTORE','Original retained source and namespace history changed after restore.');
      const draft=commission.drafts.find(row=>row.id===request.ids.draft);
      requireValue(draft&&(stable(draft)===stable(original.drafts[0])||stable(draft.agreement)===stable(receivedAgreement)),
        'CENTRAL_MANAGED_RESTORE','The original complete agreement was not reopened.');
      const editedOnReceiver=await client.commissioningSaveDraft(receivingInput);
      requireValue(stable(editedOnReceiver.agreement)===stable(receivedAgreement),'CENTRAL_MANAGED_RESTORE','Receiving-side editable work was not retained.');
      await record('receiving-draft',{request:receivingInput,result:editedOnReceiver,receivedArchive:state.receivedArchive});
      client.close();client=null;await record('receiving-closed',await closeActive());
    }
    if(!journal.steps['restore-replay-closed']){
      await start(paths.received,'restore-replay',archive);
      const state=await client.state(),commission=await client.commissioningState();
      const draft=commission.drafts.find(row=>row.id===request.ids.draft);
      requireValue(state.id===original.workspaceId&&state.receivedArchive.archiveSha256===archive.sha256&&
        stable(draft)===stable(journal.steps['receiving-draft'].result),
        'CENTRAL_MANAGED_RESTORE_REPLAY','Repeating the original archive must preserve later receiving work.');
      await record('restore-replay',{workspaceId:state.id,currentWorkspaceRevision:state.revision,
        receivedArchive:state.receivedArchive,draft});
      client.close();client=null;await record('restore-replay-closed',await closeActive());
    }
    reopenedOwner=await sdk.openCentralWarehouse({directory:paths.received});
    const cold=reopenedOwner.commissioning.state(),draft=cold.drafts.find(row=>row.id===request.ids.draft);
    requireValue(cold.workspaceId===original.workspaceId&&stable(draft)===stable(journal.steps['receiving-draft'].result),
      'CENTRAL_MANAGED_COLD_REOPEN','Cold original Store reopening changed the retained receiving edition.');
    await reopenedOwner.close();reopenedOwner=null;
    await record('cold-reopen',{workspaceId:cold.workspaceId,revision:cold.revision,draftRevision:draft.revision,closed:true});
    checkOpen();
    const delivery={schema:MANAGED_RECEIVING_SCHEMA,operationId:operation,status:'COMPLETE',sourceCommit:SOURCE_COMMIT,
      source:request.package,runtime:{node:process.execPath,nodeVersion:process.version,browserVersion:journal.steps.browser.browserVersion},
      originalWorkspaceId:original.workspaceId,originalDirectory:paths.original,receivedDirectory:paths.received,
      nativeProviderCapture:false,nativeWarehouseImport:false,
      completed:['installed-command','Applications-startup-binding','same-store-three-namespaces','SDK-draft-and-exact-replay',
        'typed-draft-and-exact-replay','typed-archive-and-exact-replay','retained-file-and-replay','three-browser-interfaces',
        'browser-original-download','retained-file-after-stop','native-archive-restore','receiving-edit',
        'same-archive-replay-preserves-receiving-edit','cold-reopen','all-owned-handles-closed'],
      archive:journal.steps.archive.downloaded,retainedFile:journal.steps.archive.retained,
      screenshots:['field','commissioning','warehouse'].map(k=>journal.steps.browser[k]),
      browserArchive:journal.steps.browser.archive,
      draft:{id:request.ids.draft,originalRevision:journal.steps['typed-draft'].result.revision,receivedRevision:draft.revision},
      owners:[journal.steps['original-closed'],journal.steps['receiving-closed'],journal.steps['restore-replay-closed']],
      completedAt:journal.completedAt??new Date().toISOString()};
    await save(join(paths.output,'managed-receiving.json'),delivery);
    await save(join(paths.output,'agreements.json'),{original:request.initialAgreement,reviewed:edited,received:receivedAgreement});
    journal.status='COMPLETE';journal.completedAt=delivery.completedAt;journal.result=delivery;await save(journalPath,journal);
    return delivery;
  }catch(error){primary=error;if(journal){journal.status='INTERRUPTED';journal.error=describe(error);await save(journalPath,journal).catch(()=>{});}throw error;}
  finally{
    const errors=[];
    try{client?.close();}catch(error){errors.push(describe(error));}
    try{await mcp?.close();}catch(error){errors.push(describe(error));}
    try{await closeActive();}catch(error){errors.push(describe(error));}
    try{await reopenedOwner?.close();}catch(error){errors.push(describe(error));}
    try{await activeBrowser?.close();}catch(error){errors.push(describe(error));}
    process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);
    if(errors.length){if(primary)primary.cleanup=errors;
      else throw Object.assign(new Error('Original receiving cleanup failed.'),{code:'CENTRAL_MANAGED_CLEANUP',details:errors});}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  receiveManagedWorkspace(cliOptions(process.argv.slice(2))).then(result=>{
    process.stdout.write(JSON.stringify({schema:result.schema,operationId:result.operationId,status:result.status,
      workspaceId:result.originalWorkspaceId,archive:result.archive,completed:result.completed.length})+'\n');
  }).catch(error=>{process.stderr.write(JSON.stringify({error:describe(error),cleanup:error.cleanup??null})+'\n');process.exitCode=1;});
