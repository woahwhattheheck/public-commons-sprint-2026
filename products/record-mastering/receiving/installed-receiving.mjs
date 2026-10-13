#!/usr/bin/env node
// MIT. One retained installed receiving case over the original product and native owners.
import { readFile, writeFile, mkdir, stat, realpath, open, rename, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { createReceivingApplicationLifetime } from './application-lifetime.mjs';

const CASE_SCHEMA='stellar-forge.record-mastering-installed-receiving.v1';
const BASE='stellar/scf-starforge-20261009/';
const nativeRelative=BASE+'sf30-seller-sdk/record-mastering/';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--case')throw Error('Use --case ABSOLUTE_PRIVATE_JSON');
const originalCasePath=resolve(args[1]),caseBytes=await readFile(originalCasePath),selection=JSON.parse(caseBytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const need=(ok,message)=>{if(!ok)throw Error(message);};
need(selection.schema===CASE_SCHEMA&&typeof selection.operationId==='string'&&
 /^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$/.test(selection.operationId),'Invalid original receiving identity');
for(const key of ['directory','runtimeDirectory','playwright','chromium'])
 need(typeof selection[key]==='string'&&selection[key]===resolve(selection[key]),'Require absolute '+key);
need(/^[a-f0-9]{40}$/.test(selection.sourceCommit),'Pin the selected upstream source commit');
const root=selection.directory,runtime=selection.runtimeDirectory,packageSource=join(runtime,'package','source');
await mkdir(root,{recursive:true,mode:0o700});
need(await realpath(root)===root&&((await stat(root)).mode&0o077)===0,'Use a private real receiving directory');
const source=path=>pathToFileURL(join(packageSource,path)).href;
const storage=await import(source(BASE+'distribution/runtime-workspace/storage.mjs'));
const lease=await storage.operationLease(join(root,'receiving.lock'));
let browser=null,mcp=null,mcpTransport=null,nativeClient=null,finish=null;
let selectionBound=false,stopping=false;
const stopReceiving=()=>{stopping=true;};
process.on('SIGINT',stopReceiving);process.on('SIGTERM',stopReceiving);
try{
const infoPath=join(root,'receiving.json'),stepDirectory=join(root,'steps');
await mkdir(stepDirectory,{mode:0o700,recursive:true});
async function readJSON(path,optional=false){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
async function atomic(path,value){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temporary=path+'.pending-'+randomUUID();let fd=null,parent=null,owned=false,primary=null;
 const cleanup=[];
 try{
  fd=await open(temporary,'wx',0o600);owned=true;
  await fd.writeFile(typeof value==='string'?value:json(value));await fd.sync();
  await fd.close();fd=null;await rename(temporary,path);owned=false;
 }catch(error){primary=error;}
 finally{
  if(fd)try{await fd.close();}catch(error){cleanup.push(error);}
  if(owned)try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')cleanup.push(error);}
  try{parent=await open(dirname(path),'r');await parent.sync();}catch(error){cleanup.push(error);}
  finally{if(parent)try{await parent.close();}catch(error){cleanup.push(error);}}
 }
 if(primary){if(cleanup.length)primary.cleanupErrors=[...(primary.cleanupErrors??[]),...cleanup];throw primary;}
 if(cleanup.length===1)throw cleanup[0];if(cleanup.length)throw new AggregateError(cleanup,'Original receiving file cleanup failed.');
}
let record=await readJSON(infoPath,true);
if(record){need(record.schema===CASE_SCHEMA&&record.selectionSha256===sha(caseBytes),'Keep the exact original receiving selection');}
else{
 record={schema:CASE_SCHEMA,operationId:selection.operationId,selectionSha256:sha(caseBytes),
  selection,createdAt:new Date().toISOString(),state:'RUNNING',completed:[]};
 await atomic(join(root,'case.json'),caseBytes.toString('utf8'));await atomic(infoPath,record);
}
selectionBound=true;
async function checkpoint(){record.owner=await storage.processIdentity();record.updatedAt=new Date().toISOString();await atomic(infoPath,record);}
async function step(name,request,action){
 need(!stopping,'The original receiving course is stopping before another step.');
 const path=join(stepDirectory,name+'.json');let saved=await readJSON(path,true);
 if(saved?.state==='COMPLETE')return saved.result;
 if(!saved){const input=typeof request==='function'?await request():request;
  saved={schema:CASE_SCHEMA+'.step',name,request:input,requestSha256:sha(json(input)),createdAt:new Date().toISOString(),state:'RETAINED'};
  await atomic(path,saved);
 }
 need(saved.name===name&&saved.requestSha256===sha(json(saved.request)),'Receiving request changed: '+name);
 saved.state='RUNNING';saved.owner=await storage.processIdentity();saved.startedAt??=new Date().toISOString();await atomic(path,saved);
 try{
  const result=await action(saved.request);saved.result=result??null;saved.state='COMPLETE';saved.completedAt=new Date().toISOString();delete saved.error;
  await atomic(path,saved);if(!record.completed.includes(name))record.completed.push(name);await checkpoint();
  process.stdout.write(json({operation:selection.operationId,completed:name,total:record.completed.length}));return saved.result;
 }catch(e){saved.state='INTERRUPTED';saved.error={code:e.code??'RECEIVING_ERROR',message:e.message};await atomic(path,saved);throw e;}
}
const workspace=join(root,'mastering'),operator=join(root,'operator'),product=join(root,'product'),inputs=join(root,'inputs');
const alias='customer',requestId=name=>'installed-'+name,columns=['name','email','company','phone','balance','postal_code'];
let Product,Client,portable;
const seedApply=async(name,action,make)=>step('seed-'+name,async()=>({
 action,input:{...(await make()),expectedRevision:nativeClient.invoke('status').revision,requestId:requestId(name)}
}),req=>nativeClient.invoke(req.action,req.input));
function decoded(result){
 if(result.isError)throw Object.assign(Error(JSON.stringify(result.content)),{code:'MCP_TOOL_ERROR'});
 if(result.structuredContent!==undefined)return result.structuredContent;
 for(const c of result.content??[])if(c.type==='text'){try{return JSON.parse(c.text);}catch{}}
 throw Error('Native MCP result has no complete structured object');
}
async function connectMcp(){
 if(mcp)return;
 const [{Client:McpClient},{StdioClientTransport}]=await Promise.all([
  import(pathToFileURL(join(runtime,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href),
  import(pathToFileURL(join(runtime,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href)
 ]);
 mcpTransport=new StdioClientTransport({command:process.execPath,
  args:[join(packageSource,'stellar-forge/mcp-merchant-operator/stdio.mjs'),'--config',join(product,'merchant.json')],
  env:Object.fromEntries(Object.entries(process.env).filter(([,v])=>typeof v==='string')),stderr:'pipe'});
 mcp=new McpClient({name:'record-mastering-original-installed-receiving',version:'1.0.0'},{capabilities:{}});
 await mcp.connect(mcpTransport);
}
async function tool(name,argumentsValue={}){await connectMcp();return decoded(await mcp.callTool({name,arguments:argumentsValue}));}
async function mcpStep(name,toolName,request){return step(name,request,q=>tool(toolName,q));}
async function status(){return Product.masteringProductStatus({directory:product});}
async function waitFor(label,predicate,maximum=180000){
 const started=Date.now();let last=null;
 while(Date.now()-started<maximum){need(!stopping,'The original receiving course is stopping.');last=await predicate();if(last.done)return last.value;await pause(500);}
 throw Object.assign(Error('Retained '+label+' is still incomplete'),{code:'RECEIVING_WAIT_TIMEOUT',last:last?.summary});
}
const productAPI={PRODUCT_SCHEMA:'stellar-forge.record-mastering-product.v1'};
for(const method of ['masteringProductStatus','startMasteringProduct','stopMasteringProduct'])productAPI[method]=async input=>{
 Product??=await import(source('products/record-mastering/workspace.mjs'));return Product[method](input);
};
const lifetime=createReceivingApplicationLifetime({root,selection,stepDirectory,product,Product:productAPI,readJSON,
 saveJSON:storage.saveJSON,operationId:storage.operationId,openRuntimeWorkspace:async input=>{const m=await import(source(BASE+'distribution/runtime-workspace/model.mjs'));return m.openRuntimeWorkspace(input);},
 need,pause,sha,json,shouldStop:()=>stopping});
async function ensureApplication(baseSlot){
 const slot=await lifetime.chooseSlot(baseSlot);
 const readyPath=join(root,'application-'+slot+'-ready.json');
 const stopped=await readJSON(join(stepDirectory,'application-'+slot+'-stop.json'),true);
 if(stopped?.state==='COMPLETE'){
  const retained=await readJSON(readyPath);
  need(retained.operationId===stopped.request.operationId,'Keep the original stopped application identity');
  await lifetime.closeRun(slot,retained.operationId);return{...retained,slot};
 }
 const selected=await step('application-'+slot+'-start',()=>({directory:product,requestId:randomUUID()}),q=>{lifetime.enter(slot,q);return Product.startMasteringProduct(q);});
 const id=selected.operationId??selected.requestId;need(typeof id==='string','Original start did not return an operation identity');
 const startedRecord=await readJSON(join(stepDirectory,'application-'+slot+'-start.json'));
 record.application={applicationId:(await status()).saved.applicationId,operationId:id,slot};await checkpoint();
 const observed=await status();const same=observed.application?.runs?.find(x=>x.id===id);
 if(same&&!same.active&&same.phase==='INTERRUPTED')
  await Product.recoverMasteringProduct({directory:product,operationId:id});
 const result=await waitFor('original application '+id,async()=>{
  const value=await status(),run=value.application?.runs?.find(x=>x.id===id);
  if(run?.result&&(['FAILED','CANCELLED'].includes(run.phase)||(!run.active&&['EXITED','LAUNCH_FAILED'].includes(run.result.state))))throw Object.assign(Error('Original application ended: '+JSON.stringify(run.result)),{code:'APPLICATION_RECEIVING_FAILED',applicationRun:{operationId:id,phase:run.phase,result:run.result}});
  return{done:Boolean(run?.active&&run.privateUrl),value:{operationId:id,applicationId:value.saved.applicationId,url:run?.privateUrl,status:value,slot},summary:run};
 });
 await atomic(readyPath,result);await atomic(join(root,'current-application.json'),result);return result;
}
async function stopApplication(slot,id){
 const proof=await lifetime.closeRun(slot,id);
 need(proof&&proof.operationId===id,'Retain the original positive application closure.');
 await step('application-'+slot+'-stop',{directory:product,operationId:id},async()=>proof);
 return status();
}
async function archiveRead(name,manifest){
 const final=join(root,'downloads',name),chunks=join(root,'download-parts',name);await mkdir(chunks,{recursive:true,mode:0o700});
 const fd=await open(final+'.pending','w',0o600);let offset=0,hash=createHash('sha256');
 try{
  while(offset<manifest.bytes){
   const part=await mcpStep(name+'-chunk-'+offset,'merchant_mastering_file_read',{workspace:alias,sha256:manifest.sha256,offset,limit:65536});
   const bytes=Buffer.from(part.base64,'base64');need(part.offset===offset&&part.totalBytes===manifest.bytes&&part.bytes===bytes.length&&sha(bytes)===part.chunkSha256,'Native export chunk changed');
   await fd.write(bytes,0,bytes.length,offset);hash.update(bytes);offset+=bytes.length;
   need(bytes.length>0&&(part.nextOffset===null?offset===manifest.bytes:part.nextOffset===offset),'Native chunk continuation changed');
  }
  await fd.sync();
 }finally{await fd.close();}
 need(hash.digest('hex')===manifest.sha256,'Complete native export digest differs');await rename(final+'.pending',final);
 return{path:final,bytes:manifest.bytes,sha256:manifest.sha256};
}
async function openBrowser(url){
 if(browser)await browser.close();
 const {chromium}=await import(pathToFileURL(selection.playwright).href);
 browser=await chromium.launchPersistentContext(join(root,'browser-profile'),{executablePath:selection.chromium,
  args:['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=1'],headless:true,viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const page=browser.pages()[0]??await browser.newPage();await page.goto(url,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Record mastering',exact:true}).waitFor();return page;
}
// Closure retains the receiving lease until every actual owned resource ends.
let finishing=null;
finish=()=>{
 if(finishing)return finishing;
 const report=value=>{try{process.stderr.write(json(value));}catch{}};
 finishing=(async()=>{
  const closeOwned=async(label,read,clear)=>{
   if(!read())return;
   for(;;)try{await read().close();clear();break;}
    catch(error){report({operation:selection.operationId,state:label+'_CLOSE_PENDING',error:{code:error.code,message:error.message}});await pause(500);}
  };
  for(;;){
   const outcomes=await Promise.allSettled([
    closeOwned('BROWSER',()=>browser,()=>{browser=null;}),
    closeOwned('MCP_CLIENT',()=>mcp,()=>{mcp=null;}),
    closeOwned('MCP_TRANSPORT',()=>mcpTransport,()=>{mcpTransport=null;}),
    closeOwned('NATIVE_CLIENT',()=>nativeClient,()=>{nativeClient=null;}),
    selectionBound?lifetime.close():Promise.resolve()
   ]);
   const failures=outcomes.filter(x=>x.status==='rejected');if(!failures.length)return;
   for(const x of failures)report({operation:selection.operationId,state:'OWNED_CLOSE_PENDING',message:x.reason?.message??String(x.reason)});
   await pause(500);
  }
 })().finally(()=>{finishing=null;});return finishing;
};
try{
 if(record.state==='COMPLETE'){process.stdout.write(json({operation:selection.operationId,state:'COMPLETE',result:join(root,'RESULT.json'),reopened:true}));}
 else{
  await checkpoint();
  const {inspectRuntimeInstall}=await import(source(BASE+'distribution/runtime-install.mjs'));
  const runtimeState=await step('installed-runtime',{directory:runtime,commit:selection.sourceCommit},async q=>{
   const value=await inspectRuntimeInstall({directory:q.directory,load:true,source:true});
   need(value.ready===true,'Select the original READY installed runtime');
   const manifest=await readJSON(join(runtime,'package','manifest.json'));
   need(manifest.sourceCommit===q.commit&&manifest.sourceSelection?.id==='record-mastering-workspace','Select the original installed Record Mastering product archive');
   return{inspection:value,manifest:{sourceCommit:manifest.sourceCommit,sourceSelection:manifest.sourceSelection,sourceFiles:manifest.files.length}};
  });
  Product=await import(source('products/record-mastering/workspace.mjs'));
  ({RecordMasteringClient:Client}=await import(source(nativeRelative+'client.mjs')));
  portable=await import(source(nativeRelative+'portable.mjs'));
  await step('original-project-create',{directory:workspace,title:'Installed Record Mastering receiving — original worked example'},q=>{
   const client=new Client({directory:q.directory,create:!existsSync(join(q.directory,'mastering.sqlite')),title:q.title});
   try{const state=client.invoke('status');need(state.title===q.title,'Retain this case original workspace');return state;}finally{client.close();}
  });
  nativeClient=new Client({directory:workspace});
  const crm=await seedApply('crm','feed.create',()=>({name:'CRM contacts',keyColumns:['ContactID'],mapping:{name:'Name',email:'Email',company:'Company',phone:'Phone',balance:'Balance'}}));
  const originalCsv=file=>readFile(join(packageSource,nativeRelative,'example',file));
  const crmEdition=await seedApply('crm-source','source.import',async()=>({feedId:crm.feedId,label:'October customer export',base64:(await originalCsv('crm.csv')).toString('base64')}));
  await seedApply('crm-active','source.activate',()=>({editionId:crmEdition.editionId,planSha256:nativeClient.invoke('refresh',{editionId:crmEdition.editionId,limit:1}).planSha256}));
  const billing=await seedApply('billing','feed.create',()=>({name:'Billing customers',keyColumns:['CustomerRef'],mapping:{name:'FullName',email:'EmailAddress',company:'Organization',phone:'Phone',balance:'Amount',postal_code:'Postal'}}));
  const billingEdition=await seedApply('billing-source','source.import',async()=>({feedId:billing.feedId,label:'October customer export',base64:(await originalCsv('billing.csv')).toString('base64')}));
  await seedApply('billing-active','source.activate',()=>({editionId:billingEdition.editionId,planSha256:nativeClient.invoke('refresh',{editionId:billingEdition.editionId,limit:1}).planSha256}));
  await seedApply('matching','rules.save',()=>({rules:[{field:'email',normalize:'email'}]}));
  const merged=await seedApply('merge','entity.merge',()=>{
   const group=nativeClient.invoke('groups',{limit:500}).items.find(g=>g.value==='mara@example.test');
   need(group,'Original example matching group missing');return{entityIds:nativeClient.invoke('group',{groupId:group.id,limit:500}).items.map(e=>e.id),groupId:group.id};
  });
  const billingChoice=field=>{const e=nativeClient.invoke('entity',{entityId:merged.entityId}),r=e.records.find(r=>r.feedId===billing.feedId&&!r.missing);need(r,'Original billing row missing');return{entityId:e.id,field,mode:'source',recordId:r.id};};
  for(const field of ['name','phone','balance'])await seedApply('choose-'+field,'field.choose',()=>billingChoice(field));
  await seedApply('initial-delivery','delivery.create',()=>({title:'Initial customer dataset',mode:'all',columns}));
  const corrected=await seedApply('billing-correction','source.import',async()=>({feedId:billing.feedId,label:'October corrections',base64:(await originalCsv('billing-corrections.csv')).toString('base64')}));
  await seedApply('correction-active','source.activate',()=>({editionId:corrected.editionId,planSha256:nativeClient.invoke('refresh',{editionId:corrected.editionId,limit:1}).planSha256}));
  await seedApply('correct-balance','field.choose',()=>billingChoice('balance'));
  await seedApply('corrected-delivery','delivery.create',()=>({title:'Corrected customer dataset',mode:'all',columns}));
  await seedApply('reviewed-name','field.choose',()=>({entityId:merged.entityId,field:'name',mode:'custom',value:'Mara Ellis'}));
  await seedApply('review-note','entity.annotate',()=>({entityId:merged.entityId,label:'Mara Ellis',note:'Reviewed original CRM and billing values. Other candidate groups remain for review.'}));
  await seedApply('reviewed-delivery','delivery.create',()=>({title:'Reviewed customer dataset',mode:'all',columns}));
  await mkdir(inputs,{recursive:true,mode:0o700});await mkdir(join(root,'downloads'),{recursive:true,mode:0o700});
  const baseline=await step('original-input-workspace',()=>({output:join(inputs,'original-workspace.mastering.gz'),expectedRevision:nativeClient.invoke('status').revision}),q=>{
   if(existsSync(q.output))return{...portable.hashFile(q.output),path:q.output};
   const value=portable.workspaceFile(nativeClient.workspace,q.output,{expectedRevision:q.expectedRevision});return{...portable.hashFile(q.output),path:q.output,result:value};
  });
  const originalBinding=await step('original-binding',{},()=>nativeClient.invoke('binding'));
  nativeClient.close();nativeClient=null;
  await step('operator-create',{directory:operator},async q=>{
   const {createRuntimeWorkspace,openRuntimeWorkspace}=await import(source(BASE+'distribution/runtime-workspace/model.mjs'));
   if(existsSync(join(q.directory,'workspace.json'))){const m=await openRuntimeWorkspace(q);try{return await m.state();}finally{await m.close();}}
   return createRuntimeWorkspace(q);
  });
  await step('prepare-request',{},async()=>{
   const value={schema:Product.REQUEST_SCHEMA,runtimeDirectory:runtime,runtimeWorkspaceDirectory:operator,workspaceDirectory:workspace,
    label:'Record mastering — installed receiving',alias,port:0,inputs:{
     crm:{path:join(packageSource,nativeRelative,'example/crm.csv')},
     original:{path:baseline.path,sha256:baseline.sha256}}};
   const path=join(root,'product-request.json');await atomic(path,value);return{path,value};
  });
  const prep=await step('product-review',()=>({directory:product,requestFile:join(root,'product-request.json'),requestId:randomUUID()}),q=>Product.prepareMasteringProduct(q));
  need(prep.phase==='REVIEWED'||prep.phase==='SAVED','Original product review incomplete');
  const saved=await step('product-save',{directory:product},q=>Product.saveMasteringProduct(q));
  await step('product-connect',{directory:product},q=>Product.connectMasteringProduct(q));
  await waitFor('original runtime adoption',async()=>{const s=await status();return{done:Boolean(s.application?.release)&&s.application.connectionReady===true,value:s,summary:s.application?.adoption};});
  const live=await ensureApplication('first');
  await step('browser-use',{entityId:merged.entityId,note:'Received through the original installed Applications browser.'},async q=>{
   const before=await tool('merchant_mastering_query',{workspace:alias,action:'entity',input:{entityId:q.entityId}});
   const page=await openBrowser(live.url);const failures=[];page.on('pageerror',e=>failures.push(e.message));
   await page.getByRole('button',{name:'Mara Ellis',exact:true}).click();
   await page.getByLabel('Working note',{exact:true}).waitFor();
   if(before.note!==q.note){await page.getByLabel('Working note',{exact:true}).fill(q.note);await page.getByRole('button',{name:'Save record details',exact:true}).click();await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));}
   const after=await tool('merchant_mastering_query',{workspace:alias,action:'entity',input:{entityId:q.entityId}});
   need(after.note===q.note,'Original browser note was not retained');
   await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.screenshot({path:join(root,'record-mastering-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:join(root,'record-mastering-mobile.png'),fullPage:true});
   const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
   need(geometry.scroll<=geometry.width+1,'Record Mastering browser exceeds the mobile viewport');
   need(failures.length===0,'Original browser raised an error: '+failures.join('; '));
   await browser.close();browser=null;return{entityId:q.entityId,note:after.note,geometry,screenshots:['record-mastering-desktop.png','record-mastering-mobile.png']};
  });
  await step('merchant-tools',{},async()=>{
   await connectMcp();const list=await mcp.listTools(),selected=list.tools.map(t=>t.name).filter(n=>n.startsWith('merchant_mastering_'));
   const expected=['workspaces','query','apply','input','import','export','file_read','receive'].map(n=>'merchant_mastering_'+n);
   need(expected.every(n=>selected.includes(n))&&selected.length===8,'Original eight-tool catalogue differs');return{tools:selected};
  });
  await mcpStep('merchant-workspaces','merchant_mastering_workspaces',{});
  const inspected=await mcpStep('merchant-input','merchant_mastering_input',{workspace:alias,input:'crm',csv:true});
  const imported=await mcpStep('merchant-import','merchant_mastering_import',async()=>({workspace:alias,input:'crm',expectedSha256:inspected.sha256,feedId:crm.feedId,label:'Installed operator source refresh',
   expectedRevision:(await tool('merchant_mastering_query',{workspace:alias,action:'status'})).revision,requestId:requestId('merchant-import')}));
  const plan=await mcpStep('merchant-refresh-review','merchant_mastering_query',{workspace:alias,action:'refresh',input:{editionId:imported.editionId,limit:500}});
  await mcpStep('merchant-activate','merchant_mastering_apply',async()=>({workspace:alias,action:'source.activate',input:{editionId:imported.editionId,planSha256:plan.planSha256,
   expectedRevision:(await tool('merchant_mastering_query',{workspace:alias,action:'status'})).revision,requestId:requestId('merchant-activate')}}));
  const delivery=await mcpStep('merchant-delivery','merchant_mastering_apply',async()=>({workspace:alias,action:'delivery.create',input:{title:'Installed customer delivery',mode:'all',columns,
   expectedRevision:(await tool('merchant_mastering_query',{workspace:alias,action:'status'})).revision,requestId:requestId('merchant-delivery')}}));
  const exportRevision=await step('export-revision',{},()=>tool('merchant_mastering_query',{workspace:alias,action:'status'}));
  const workspaceExport=await step('product-workspace-export',()=>({directory:product,kind:'workspace',expectedRevision:exportRevision.revision,requestId:randomUUID()}),q=>Product.exportMasteringProduct(q));
  const deliveryExport=await step('product-delivery-export',()=>({directory:product,kind:'delivery',deliveryId:delivery.deliveryId,expectedRevision:exportRevision.revision,requestId:randomUUID()}),q=>Product.exportMasteringProduct(q));
  await step('workspace-transfer',{manifest:workspaceExport},q=>archiveRead('workspace.mastering.gz',q.manifest));
  await step('delivery-transfer',{manifest:deliveryExport},q=>archiveRead('master-delivery.gz',q.manifest));
  const received=await mcpStep('merchant-receive','merchant_mastering_receive',{workspace:alias,input:'original',expectedSha256:baseline.sha256,name:'review-team'});
  need((received.workspaceId??received.id)===originalBinding.workspaceId,'Independent receiving changed the original workspace identity');
  await mcpStep('receiver-edit','merchant_mastering_apply',async()=>({workspace:received.workspace,action:'entity.annotate',input:{entityId:merged.entityId,label:'Mara Ellis',note:'Independent receiving team note.',
   expectedRevision:(await tool('merchant_mastering_query',{workspace:received.workspace,action:'status'})).revision,requestId:requestId('receiver-note')}}));
  const originalBeforeLater=await mcpStep('sender-before-later','merchant_mastering_query',{workspace:alias,action:'entity',input:{entityId:merged.entityId}});
  need(originalBeforeLater.note==='Received through the original installed Applications browser.','Receiver edit replaced sender state');
  await mcpStep('sender-later-edit','merchant_mastering_apply',async()=>({workspace:alias,action:'entity.annotate',input:{entityId:merged.entityId,label:'Mara Ellis',note:'Later sender work remains separate from the exported edition.',
   expectedRevision:(await tool('merchant_mastering_query',{workspace:alias,action:'status'})).revision,requestId:requestId('sender-later-note')}}));
  await step('retained-export-replay',{},async()=>{
   const previous=await readJSON(join(stepDirectory,'product-workspace-export.json')),replayed=await Product.exportMasteringProduct(previous.request);
   need(replayed.sha256===workspaceExport.sha256&&replayed.bytes===workspaceExport.bytes,'Same export request no longer returns its original package');return replayed;
  });
  if(mcp)await mcp.close();mcp=null;mcpTransport=null;
  await stopApplication(live.slot??'first',live.operationId);
  const reopened=await ensureApplication('reopen');
  await step('cold-browser-reopen',{},async()=>{const page=await openBrowser(reopened.url);await page.getByRole('button',{name:'Mara Ellis',exact:true}).click();
   const note=await page.getByLabel('Working note',{exact:true}).inputValue();need(note==='Later sender work remains separate from the exported edition.','Cold browser did not reopen later work');
   await browser.close();browser=null;return{note,applicationId:reopened.applicationId,operationId:reopened.operationId};});
  await step('cold-merchant-reopen',{},async()=>{
   const workspaces=await tool('merchant_mastering_workspaces');
   need(workspaces.workspaces.some(x=>x.workspace===received.workspace),'Original received alias did not reopen');
   const sender=await tool('merchant_mastering_query',{workspace:alias,action:'status'}),receiver=await tool('merchant_mastering_query',{workspace:received.workspace,action:'entity',input:{entityId:merged.entityId}});
   need(sender.id===originalBinding.workspaceId&&receiver.note==='Independent receiving team note.','Cold source/receiver state differs');
   return{sender,receivedAlias:received.workspace,receiverNote:receiver.note};
  });
  await step('independent-export-reopen',{archive:join(root,'downloads','workspace.mastering.gz'),directory:join(root,'independent-customer'),sha256:workspaceExport.sha256},async q=>{
   if(!existsSync(join(q.directory,'mastering.sqlite')))await Client.receiveFile(q.archive,q.directory,{expectedSha256:q.sha256});
   const c=new Client({directory:q.directory});
   try{const s=c.invoke('status'),e=c.invoke('entity',{entityId:merged.entityId});
    need(s.id===originalBinding.workspaceId&&s.revision===exportRevision.revision,'Independent archive did not retain its selected revision');
    need(e.note==='Received through the original installed Applications browser.','Later sender work leaked into the older export');
    return{s,note:e.note,archive:portable.hashFile(q.archive)};
   }finally{c.close();}
  });
  if(mcp)await mcp.close();mcp=null;mcpTransport=null;
  const stopped=await stopApplication(reopened.slot??'reopen',reopened.operationId);
  const final={schema:CASE_SCHEMA+'.result',operationId:selection.operationId,completedAt:new Date().toISOString(),
   sourceCommit:selection.sourceCommit,sourceSelection:'record-mastering-workspace',originalBinding,
   applicationId:stopped.saved.applicationId,applicationRuns:[live.operationId,reopened.operationId],
   workspaceExport,deliveryExport,receivedWorkspace:received.workspace,completedSteps:record.completed,
   screenshots:[join(root,'record-mastering-desktop.png'),join(root,'record-mastering-mobile.png')],
   finalProduct:stopped,customerArchives:[join(root,'downloads','workspace.mastering.gz'),join(root,'downloads','master-delivery.gz')]};
  await atomic(join(root,'RESULT.json'),final);record.state='COMPLETE';record.result='RESULT.json';delete record.error;await checkpoint();
  process.stdout.write(json({operation:selection.operationId,state:'COMPLETE',steps:record.completed.length,result:join(root,'RESULT.json')}));
 }
}catch(e){
 record.state='INTERRUPTED';record.error={code:e.code??'RECEIVING_ERROR',message:e.message,stack:e.stack,...(e.applicationRun?{applicationRun:e.applicationRun}:{})};
 try{await checkpoint();}catch(persistError){record.error.persistenceError={code:persistError.code,message:persistError.message};}
 try{process.stderr.write(json({operation:selection.operationId,state:record.state,error:record.error,result:infoPath}));}catch{}
 process.exitCode=1;
}finally{await finish();}
}finally{
 process.off('SIGINT',stopReceiving);process.off('SIGTERM',stopReceiving);
 if(finish)await finish();
 await lease.close();
}
