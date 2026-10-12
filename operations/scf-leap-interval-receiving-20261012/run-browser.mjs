// MIT. One rendered receiving journey over the original Leap HTTP owner.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const SCHEMA='stellar-forge.leap-interval-workspace.v1';
const COLLECTIONS=['imports','mappings','batches','missing_snapshots','api_receipts','meters','original_files','files','exports'];
const ACTIONS=new Set(['batch.submit','batch.refresh','batch.reconcile']);
const SHA=/^[a-f0-9]{64}$/;
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>String(name).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,180)||'record';
const stamp=()=>new Date().toISOString();
async function readJson(path){return JSON.parse(await fs.readFile(path,'utf8'));}
async function hashFile(path){const hash=createHash('sha256');let bytes=0;for await(const block of createReadStream(path)){hash.update(block);bytes+=block.length;}return{bytes,sha256:hash.digest('hex')};}
async function writeJson(path,value){
 await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
 const temporary=path+'.'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await fs.rename(temporary,path);
 const directory=await fs.open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
}
function originalUrl(text){
 const url=new URL(text.trim());assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');
 assert(!url.username&&!url.password&&url.hash.length>1,'Use the original private loopback connection.');
 return{origin:url.origin,token:decodeURIComponent(url.hash.slice(1)),href:url.href};
}
async function request(connection,path,{method='GET',body,headers={},timeout=180000}={}){
 const url=new URL(path,connection.origin);assert.equal(url.origin,connection.origin);
 return await new Promise((yes,no)=>{
  const req=http.request(url,{method,headers:{Authorization:'Bearer '+connection.token,Origin:connection.origin,...headers,...(body!==undefined?{'Content-Length':Buffer.byteLength(body)}:{})}},response=>yes(response));
  req.once('error',no);req.setTimeout(timeout,()=>req.destroy(new Error('The original owner response timed out.')));
  if(body!==undefined)req.end(body);else req.end();
 });
}
async function api(connection,path,options={}){
 const response=await request(connection,path,options),chunks=[];let size=0;
 for await(const block of response){size+=block.length;if(size>64*1024*1024){response.destroy();throw new Error('The complete original JSON exceeds the receiving capacity.');}chunks.push(block);}
 const bytes=Buffer.concat(chunks);let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('The original owner did not return complete JSON.');}
 if(response.statusCode<200||response.statusCode>=300)throw Object.assign(new Error(value.error?.message??'Original HTTP '+response.statusCode),{status:response.statusCode,code:value.error?.code,original:value});
 return value;
}
async function pageAll(connection,path,parameters={}){
 const items=[];let expected;
 for(let offset=0;;){
  const reply=await api(connection,path+'?'+new URLSearchParams({...parameters,offset,limit:500}));
  assert(Array.isArray(reply.items)&&Number.isSafeInteger(reply.total),'The original paged contract changed.');
  if(expected===undefined)expected=reply.total;else assert.equal(reply.total,expected,'The retained collection changed during receiving.');
  assert.equal(reply.offset,offset);items.push(...reply.items);
  if(items.length===expected)return items;
  assert(reply.items.length>0&&items.length<expected,'The original page ended before its total.');offset+=reply.items.length;
 }
}
async function receivePages(connection,path,parameters,destination){
 await fs.mkdir(dirname(destination),{recursive:true,mode:0o700});
 const temporary=destination+'.'+randomUUID()+'.tmp',out=await fs.open(temporary,'wx',0o600);let count=0,total;
 try{
  for(let offset=0;;){
   const reply=await api(connection,path+'?'+new URLSearchParams({...parameters,offset,limit:500}));
   assert(Array.isArray(reply.items)&&Number.isSafeInteger(reply.total));assert.equal(reply.offset,offset);
   if(total===undefined)total=reply.total;else assert.equal(reply.total,total,'The retained page total changed.');
   for(const row of reply.items)await out.write(JSON.stringify(row)+'\n');count+=reply.items.length;
   if(count===total)break;assert(reply.items.length>0&&count<total,'The original complete page sequence ended early.');offset+=reply.items.length;
  }
  await out.sync();
 }finally{await out.close();}
 await fs.rename(temporary,destination);return{path:destination,count,format:'ndjson',...await hashFile(destination)};
}
async function receiveFile(connection,metadata,directory){
 assert(metadata&&SHA.test(metadata.sha256)&&Number.isSafeInteger(metadata.bytes)&&metadata.bytes>=0,'Use original complete file metadata.');
 const url=new URL(metadata.download_url,connection.origin);assert.equal(url.origin,connection.origin);assert(['/api/file','/api/export'].includes(url.pathname));
 const path=join(directory,metadata.sha256+'-'+safe(metadata.name));
 try{const existing=await hashFile(path);assert.deepEqual(existing,{bytes:metadata.bytes,sha256:metadata.sha256});return{...metadata,path};}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(directory,{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';
 const response=await request(connection,url.pathname+url.search);
 if(response.statusCode!==200){response.resume();throw new Error('The original file returned HTTP '+response.statusCode);}
 if(response.headers['content-length']!==undefined)assert.equal(Number(response.headers['content-length']),metadata.bytes);
 const out=createWriteStream(temp,{flags:'wx',mode:0o600});
 try{await pipeline(response,out);const actual=await hashFile(temp);assert.deepEqual(actual,{bytes:metadata.bytes,sha256:metadata.sha256});
  const handle=await fs.open(temp,'r');try{await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,path);return{...metadata,path};
 }catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
}

export async function runLeapBrowser(options){
 const output=resolve(options.outputDirectory),configuration=options.input;
 assert(configuration&&Array.isArray(configuration.sources)&&Array.isArray(configuration.mappings)&&Array.isArray(configuration.batches));
 await fs.mkdir(output,{recursive:true,mode:0o700});
 const connection=originalUrl(await fs.readFile(options.connectionFile,'utf8'));
 const journalPath=join(output,'browser-journal.json');
 let journal;try{journal=await readJson(journalPath);}catch(error){if(error.code!=='ENOENT')throw error;}
 const semantics={configuration:configuration.configuration,sources:configuration.sources.map(({path,...row})=>row),mappings:configuration.mappings,batches:configuration.batches,missingScopes:configuration.missingScopes??[]};
 const inputSha256=digest(stable(semantics));
 if(journal)assert.equal(journal.inputSha256,inputSha256,'Keep the same reviewed original receiving input.');
 else journal={schema:'stellar-forge.leap-browser-receiving.v1',operationId:configuration.operationId,inputSha256,startedAt:stamp(),steps:{},pageErrors:[],downloads:[],collections:{},batches:{},mappings:{},missingSnapshots:{}};
 const save=()=>writeJson(journalPath,journal);
 const sourceState=await api(connection,'/api/state');assert.equal(sourceState.schema,SCHEMA);
 if(journal.workspaceId)assert.equal(sourceState.workspace_id,journal.workspaceId);else journal.workspaceId=sourceState.workspace_id;
 const launch=await api(connection,'/api/launch');assert.equal(launch.status,'READY');assert.equal(launch.workspace_id,journal.workspaceId);assert.equal(launch.origin,connection.origin);
 journal.attempts??=[];journal.attempts.push({at:stamp(),previousStatus:journal.status,previousError:journal.error,previousPageErrors:journal.pageErrors??[],previousRouteError:journal.routeError});delete journal.error;delete journal.routeError;journal.pageErrors=[];
 journal.launch={...launch};journal.mode=options.mode??'operate';journal.status='RUNNING';await save();
 const pw=await import(pathToFileURL(resolve(options.playwright)).href);
 let browser,context,page,activeStep=null;
 async function renderReady(revision){
  await page.waitForFunction(({identity,revision})=>{
   const ready=document.querySelector('#workspace-short')?.textContent===identity&&document.querySelector('#refresh')?.disabled===false;
   return ready&&(revision===undefined||document.querySelector('#revision-badge')?.textContent==='Revision '+revision);
  },{identity:journal.workspaceId,revision},{timeout:180000});
 }
 async function refreshUi(){await page.locator('#refresh').click();const state=await api(connection,'/api/state');await renderReady(state.revision);}
 async function goto(section){
  const collection={sources:'imports',mappings:'mappings',batches:'batches',missing:'missing_snapshots',jobs:'api_receipts'}[section];
  const waiting=collection?page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/list'&&new URL(r.url()).searchParams.get('collection')===collection,{timeout:180000}):null;waiting?.catch(()=>{});
  await page.locator('nav [data-section="'+section+'"]').click();await page.locator('#section-'+section).waitFor({state:'visible'});
  if(waiting){const response=await waiting;assert(response.ok());const data=await response.json();await page.waitForFunction(({id,text})=>document.getElementById(id)?.textContent===text,{id:section==='jobs'?'provider-total':collection+'-total',text:data.total+' retained'});}
 }
 async function selectItem(section,collection,id){
  await goto(section);
  for(let count=0;count<10000;count++){
   const button=page.locator('button[data-select="'+collection+'"][data-id="'+id+'"]:visible');
   if(await button.count()){await button.first().click();break;}
   const next=page.locator('button[data-page="'+collection+'"]:visible').last();
   if(!await next.count()||await next.isDisabled()){
    await refreshUi();if(await button.count()){await button.first().click();break;}
    throw new Error('The original selected item was not present in its complete table: '+collection+'/'+id);
   }
   const waiting=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/list'&&new URL(r.url()).searchParams.get('collection')===collection,{timeout:180000});waiting.catch(()=>{});
   await next.click();await waiting;
  }
  if(collection==='batches'){
   await page.waitForFunction(value=>document.querySelector('#batch-id')?.textContent===value,id);
   await page.waitForFunction(value=>{try{return JSON.parse(document.querySelector('#batch-detail details pre')?.textContent??'null')?.id===value;}catch{return false;}},id);
  }
  if(collection==='imports')await page.waitForFunction(value=>document.querySelector('#import-id')?.textContent===value,id);
  await renderReady();
 }
 async function saveResponse(name,response){
  const path=join(output,'operations',safe(name)+'.json');await writeJson(path,response);const identity=await hashFile(path);
  journal.steps[name]={...journal.steps[name],status:'COMPLETED',completedAt:stamp(),response:{path,...identity}};await save();return response;
 }
 async function recovered(name){
  const step=journal.steps[name];if(!step?.request)return null;
  let operation;
  try{operation=await api(connection,'/api/operation?'+new URLSearchParams({id:step.request.requestId}));}
  catch(error){if(error.status!==404)throw error;operation={status:'NOT_FOUND'};}
  if(operation.status==='COMPLETED'){
   const response={request_id:operation.id,revision:operation.revision,result:operation.result};
   if(step.status==='COMPLETED'){const prior=await readJson(step.response.path);assert.equal(stable(prior),stable(response),'The original completed request result changed.');return prior;}
   return await saveResponse(name,response);
  }
  if(operation.status==='FAILED')throw Object.assign(new Error(operation.error?.message??'The original operation failed.'),{original:operation});
  if(operation.status==='NOT_FOUND'||operation.status==='INTERRUPTED'&&operation.recoverable===true){
   if(operation.status==='NOT_FOUND'){const state=await api(connection,'/api/state');assert.equal(state.revision,step.request.expectedRevision,'An absent request needs its originally reviewed revision.');}
   let body,headers;
   if(step.request.kind==='action'){body=Buffer.from(JSON.stringify(step.request.body));headers={'Content-Type':'application/json'};}
   else{const source=configuration.sources.find(row=>row.sha256===step.request.source.sha256&&row.format===step.request.source.format);assert(source,'The original raw source is no longer in the reviewed input.');
    const identity=await hashFile(source.path);assert.equal(identity.sha256,step.request.source.sha256);assert.equal(identity.bytes,step.request.source.bytes);
    body=await fs.readFile(source.path);headers={'Content-Type':'application/octet-stream','X-Leap-Name':encodeURIComponent(step.request.source.name),'X-Leap-Format':step.request.source.format,'X-Leap-Revision':String(step.request.expectedRevision),'X-Leap-Request-Id':step.request.requestId,'X-Leap-Sha256':identity.sha256};
   }
   const response=await api(connection,step.request.path,{method:'POST',headers,body});return await saveResponse(name,response);
  }
  throw Object.assign(new Error('The original request is '+operation.status+'; retain it before another phase.'),{original:operation});
 }
 async function mutate(name,intent,trigger){
  const old=journal.steps[name];if(old)assert.equal(stable(old.intent),stable(intent),'The original step input changed.');
  if(old?.request){const result=await recovered(name);await refreshUi();return result;}
  journal.steps[name]={intent,status:'PREPARED',preparedAt:stamp()};await save();activeStep={name,intent};
  const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===(intent.kind==='action'?'/api/action':'/api/upload'),{timeout:240000});waiting.catch(()=>{});
  try{
   await trigger();const reply=await waiting;const response=await reply.json();
   if(!reply.ok())throw Object.assign(new Error(response.error?.message??'The original action returned HTTP '+reply.status()),{original:response});
   assert(journal.steps[name].request,'The exact original request was not journaled before dispatch.');
   assert.equal(response.request_id,journal.steps[name].request.requestId);
   const saved=await saveResponse(name,response);await renderReady(response.revision);return saved;
  }finally{activeStep=null;}
 }
 async function action(name,actionName,payload,section,editor,form,{review=false}={}){
  return await mutate(name,{kind:'action',action:actionName,payload},async()=>{
   await goto(section);await page.locator('#'+editor).fill(JSON.stringify(payload,null,2));
   if(review)await page.locator('#submit-reviewed').check();
   await page.locator('#'+form+' button[type="submit"],#'+form+' button[data-mutation]').first().click();
  });
 }
 async function browserDownload(metadata,scope,label){
  const expected=await receiveFile(connection,metadata,join(output,'original-files'));
  const button=page.locator('#'+scope+' button[data-download]:visible').filter({hasText:metadata.name}).first();
  assert(await button.count(),'The original download is not exposed in the displayed receiving pane.');
  const waiting=page.waitForEvent('download',{timeout:240000});waiting.catch(()=>{});
  await button.click();const download=await waiting,path=join(output,'browser-downloads',safe(label)+'-'+safe(metadata.name));await fs.mkdir(dirname(path),{recursive:true,mode:0o700});await download.saveAs(path);
  const observed=await hashFile(path);assert.deepEqual(observed,{bytes:metadata.bytes,sha256:metadata.sha256});
  const value={label,path,name:metadata.name,...observed,originalPath:expected.path};journal.downloads.push(value);await save();return value;
 }
 try{
  browser=await pw.chromium.launch({executablePath:resolve(options.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
  page=await context.newPage();page.on('pageerror',error=>journal.pageErrors.push({at:stamp(),message:error.message}));
  await page.route('**/api/**',async route=>{
   const req=route.request();if(req.method()!=='POST'){await route.continue();return;}
   try{
    assert(activeStep,'A mutation has no active original receiving step.');
    const step=journal.steps[activeStep.name],path=new URL(req.url()).pathname,bytes=req.postDataBuffer()??Buffer.alloc(0),headers=req.headers();
    assert(!step.request,'This active step already has an original request identity.');
    if(activeStep.intent.kind==='action'){
     assert.equal(path,'/api/action');const body=JSON.parse(bytes.toString('utf8'));assert.equal(body.action,activeStep.intent.action);assert.equal(stable(body.payload),stable(activeStep.intent.payload));
     step.request={kind:'action',path,requestId:body.request_id,expectedRevision:body.expected_revision,body};
    }else{
     assert.equal(path,'/api/upload');const source=activeStep.intent.source;
     assert.equal(digest(bytes),source.sha256);assert.equal(bytes.length,source.bytes);
     assert.equal(decodeURIComponent(headers['x-leap-name']),source.name);assert.equal(headers['x-leap-format'],source.format);
     step.request={kind:'upload',path,requestId:headers['x-leap-request-id'],expectedRevision:Number(headers['x-leap-revision']),source};
    }
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(step.request.requestId));assert(Number.isSafeInteger(step.request.expectedRevision));
    step.status='DISPATCHED';step.dispatchedAt=stamp();await save();await route.continue();
   }catch(error){journal.routeError={message:error.message,step:activeStep?.name};await save().catch(()=>{});await route.abort('failed');}
  });
  await page.goto(connection.href,{waitUntil:'domcontentloaded',timeout:180000});await renderReady(sourceState.revision);
  if((options.mode??'operate')==='operate'){
   await action('configuration','configuration.save',configuration.configuration,'overview','configuration-json','configuration-form');
   for(const [index,source]of configuration.sources.entries()){
    assert(SHA.test(source.sha256)&&['leap-load','utility-profile','evidence'].includes(source.format));const actual=await hashFile(source.path);assert.equal(actual.sha256,source.sha256);if(source.bytes!==undefined)assert.equal(actual.bytes,source.bytes);
    const selected={name:source.name??basename(source.path),format:source.format,sha256:actual.sha256,bytes:actual.bytes};
    const reply=await mutate('source-'+index,{kind:'upload',source:selected},async()=>{await goto('sources');await page.locator('#upload-format').selectOption(source.format);await page.locator('#upload-file').setInputFiles({name:selected.name,mimeType:'application/octet-stream',buffer:await fs.readFile(source.path)});await page.locator('#upload-form button[data-mutation]').click();});
    assert.equal(reply.result.id,source.sha256);
   }
   for(const item of configuration.mappings){
    assert(typeof item.key==='string'&&item.value?.schema==='stellar-forge.leap-interval-mapping.v1');
    const reply=await action('mapping-'+item.key,'mapping.save',item.value,'mappings','mapping-json','mapping-form');journal.mappings[item.key]=reply.result.id;await save();
   }
   for(const scope of configuration.missingScopes??[]){
    const reply=await action('missing-'+scope.key,'missing.refresh',scope.payload,'missing','missing-json','missing-form');journal.missingSnapshots[scope.key]=reply.result.id;await save();
   }
   for(const item of configuration.batches){
    assert(typeof item.key==='string'&&Array.isArray(item.prepare?.source_ids));assert(journal.mappings[item.mappingKey],'Use a reviewed retained mapping key.');
    const payload={...item.prepare,mapping_id:journal.mappings[item.mappingKey]};
    if(item.prepare.mapping_id)assert.equal(item.prepare.mapping_id,payload.mapping_id);
    if(item.correctionOfKey){assert(journal.batches[item.correctionOfKey]);payload.correction_of=journal.batches[item.correctionOfKey].id;}
    if(item.missingScopeKey){assert(journal.missingSnapshots[item.missingScopeKey]);payload.missing_snapshot_id=journal.missingSnapshots[item.missingScopeKey];}
    const prepared=await action('prepare-'+item.key,'batch.prepare',payload,'batches','prepare-json','prepare-form');
    journal.batches[item.key]={id:prepared.result.id,prepared:prepared.result};await save();
    await selectItem('batches','batches',prepared.result.id);
    for(const [index,command]of (item.providerActions??[]).entries()){
     assert(ACTIONS.has(command.action),'Only the explicitly reviewed original batch provider action may run.');
     const value={...(command.payload??{}),batch_id:prepared.result.id};if(command.payload?.batch_id)assert.equal(command.payload.batch_id,value.batch_id);
     const kind=command.action.slice(6);
     await action('provider-'+item.key+'-'+index,command.action,value,'jobs',kind+'-json',kind+'-form',{review:kind==='submit'});
    }
    const current=await api(connection,'/api/item?'+new URLSearchParams({collection:'batches',id:prepared.result.id}));
    journal.batches[item.key].current=current;
    if(item.expected?.status)assert.equal(current.status,item.expected.status);
    for(const key of ['row_count','issue_count','meter_count'])if(item.expected?.[key]!==undefined)assert.equal(current[key],item.expected[key]);
    await save();
   }
   const selectedKey=configuration.deliveryBatchKey??configuration.batches.at(-1)?.key;assert(journal.batches[selectedKey],'Select the original delivery batch.');
   journal.deliveryBatchKey=selectedKey;journal.deliveryBatchId=journal.batches[selectedKey].id;
   await selectItem('batches','batches',journal.deliveryBatchId);
   const exported=await action('customer-export','package.export',{batch_id:journal.deliveryBatchId},'delivery','export-json','export-form');
   journal.export=exported.result;await save();
   await browserDownload(exported.result,'section-delivery','complete-portable');
  }else{
   assert(options.expected,'Read-only cold receiving requires the original expected identities.');
   assert.equal(sourceState.workspace_id,options.expected.workspaceId);
   journal.deliveryBatchId=options.expected.deliveryBatchId;journal.export=options.expected.export??null;
  }
  for(const collection of COLLECTIONS){
   const list=await pageAll(connection,'/api/list',{collection}),complete=[];
   for(const item of list){
    const id=item.id??item.job_id;assert(id,'An original retained item lacks its identity.');
    complete.push(await api(connection,'/api/item?'+new URLSearchParams({collection,id})));
   }
   const path=join(output,'records',collection+'.json');await writeJson(path,complete);journal.collections[collection]={count:complete.length,path,...await hashFile(path)};
  }
  const batches=await readJson(journal.collections.batches.path);journal.batchRecords={};
  for(const batch of batches){
   const rows=await receivePages(connection,'/api/rows',{batch_id:batch.id},join(output,'records','rows-'+batch.id+'.ndjson'));
   const issues=await receivePages(connection,'/api/issues',{batch_id:batch.id},join(output,'records','issues-'+batch.id+'.ndjson'));assert.equal(rows.count,batch.row_count);
   journal.batchRecords[batch.id]={batch,rows,issues};
  }
  for(const snapshot of await readJson(journal.collections.missing_snapshots.path))await receivePages(connection,'/api/missing',{snapshot_id:snapshot.id},join(output,'records','missing-'+snapshot.id+'.ndjson'));
  journal.files=[];
  for(const metadata of await readJson(journal.collections.files.path))journal.files.push(await receiveFile(connection,metadata,join(output,'original-files')));
  if(journal.export&&(options.mode??'operate')==='operate')journal.portable=await receiveFile(connection,journal.export,join(output,'original-files'));
  const firstSource=(await readJson(journal.collections.imports.path))[0];
  if(firstSource){await selectItem('sources','imports',firstSource.id);await browserDownload(firstSource,'section-sources','original-source');}
  await selectItem('batches','batches',journal.deliveryBatchId);const batch=journal.batchRecords[journal.deliveryBatchId].batch;
  await browserDownload(batch.upload,'section-batches','prepared-upload');
  await fs.mkdir(join(output,'screenshots'),{recursive:true,mode:0o700});
  await page.screenshot({path:join(output,'screenshots','batch-review-desktop.png'),fullPage:true});
  await goto('jobs');await page.screenshot({path:join(output,'screenshots','provider-evidence-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await goto('batches');await page.screenshot({path:join(output,'screenshots','batch-review-mobile.png'),fullPage:true});
  journal.finalState=await api(connection,'/api/state');
  assert.equal(journal.finalState.workspace_id,journal.workspaceId);
  if((options.mode??'operate')==='inspect'){
   assert.equal(journal.finalState.revision,sourceState.revision,'Read-only browser receiving changed the original revision.');
   assert.deepEqual(batches.map(row=>({id:row.id,upload:row.upload.sha256,row_count:row.row_count,mapping_id:row.mapping_id})).sort((a,b)=>a.id.localeCompare(b.id)),options.expected.batches);
  }
  assert.equal(journal.pageErrors.length,0,'The rendered original operator reported a page error.');
  journal.status='PASS';journal.completedAt=stamp();
 }catch(error){
  journal.status='FAILED';journal.error={message:error.message,code:error.code,original:error.original,stack:error.stack};journal.failedAt=stamp();
  if(page)await page.screenshot({path:join(output,'browser-failure.png'),fullPage:true}).catch(()=>{});
  throw error;
 }finally{
  activeStep=null;if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  journal.browserClosed=true;await save();
 }
 return{passed:journal.status==='PASS',report:journalPath,workspaceId:journal.workspaceId,revision:journal.finalState?.revision,deliveryBatchId:journal.deliveryBatchId,portable:journal.portable,files:journal.files?.length,batches:Object.values(journal.batchRecords??{}).map(row=>({id:row.batch.id,upload:row.batch.upload.sha256,row_count:row.batch.row_count,mapping_id:row.batch.mapping_id})).sort((a,b)=>a.id.localeCompare(b.id)),browserClosed:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 runLeapBrowser(await readJson(process.argv[2])).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:error.code??'LEAP_RECEIVING',message:error.message}));process.exitCode=1;});
}
