// MIT. Continue the original operated publisher through full working-copy receiving.
import {readFile,mkdir,open,link,unlink,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,v)=>i%2?a:[...a,[x,v[i+1]]],[]));
for(const key of ['--source','--commissioning','--directory','--chromium','--playwright'])if(!args[key])throw new Error('Required '+key);
const root=resolve(args['--directory']),source=resolve(args['--source']),prior=resolve(args['--commissioning']);
await mkdir(root,{recursive:true,mode:0o700});
const sha=x=>createHash('sha256').update(x).digest('hex'),read=async p=>JSON.parse(await readFile(p,'utf8'));
const resultPath=join(root,'RESULT.json'),acceptedPath=join(root,'COMPLETE-ACCEPTED.json'),dispatchPath=join(root,'COURSE-DISPATCHED.json');
const need=(x,m)=>{if(!x)throw new Error(m);},encoded=value=>JSON.stringify(value,null,2)+'\n';
async function optional(file){try{return await read(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function original(file,value){
 const body=encoded(value),temporary=file+'.'+randomUUID()+'.stage';
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
 try{
  try{await link(temporary,file);}
  catch(error){if(error.code!=='EEXIST'||await readFile(file,'utf8')!==body)throw error;}
  await syncDirectory(dirname(file));
 }finally{await unlink(temporary).catch(()=>{});}
}
const inputBytes=await readFile(join(prior,'commissioning-result.json')),requestBytes=await readFile(join(prior,'request.json'));
const input=JSON.parse(inputBytes.toString('utf8')),request=JSON.parse(requestBytes.toString('utf8'));
const selectedFiles=[
 'products/webhook-feed/runtime.mjs',
 'stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/workspace.mjs',
 ...['app.mjs','index.html','style.css'].map(name=>'stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/public/'+name)
],selectedSources={};
for(const path of selectedFiles){const bytes=await readFile(join(source,path));selectedSources[path]={bytes:bytes.length,sha256:sha(bytes)};}
const receiverBytes=await readFile(fileURLToPath(import.meta.url));
const binding={schema:'stellar-forge.webhook-publisher-working-receiving-binding.v1',
 storeId:input.storeId,originalOperation:input.operationId,
 commissioning_sha256:sha(inputBytes),request_sha256:sha(requestBytes),
 receiver_sha256:sha(receiverBytes),selected_sources:selectedSources};
const outputNames=['Publisher_Working_Copy.json','Publisher_Received_Working_Copy.json','publisher-working-desktop.png','publisher-working-narrow.png'];
async function verifiedCompletion(value){
 need(value?.schema==='stellar-forge.webhook-publisher-working-receiving.v1'&&value.state==='COMPLETE'&&
  value.storeId===binding.storeId&&value.originalOperation===binding.originalOperation&&
  typeof value.completedAt==='string'&&Number.isFinite(Date.parse(value.completedAt))&&
  value.sourceSaveRecovered===true&&value.sourceCopiesRetained===true&&
  value.feedProjectionRetained===true&&value.heterogeneousPlanRetained===true&&
  value.nativeWritesOnImport===0&&Array.isArray(value.errors)&&value.errors.length===0,
  'Retain the exact completed original publisher course.');
 need(Array.isArray(value.files)&&value.files.length===outputNames.length&&
  new Set(value.files.map(file=>file.name)).size===outputNames.length&&
  value.files.every(file=>outputNames.includes(file.name)),'Retain every original complete output.');
 for(const file of value.files){const info=await lstat(join(root,file.name));need(info.isFile()&&!info.isSymbolicLink(),'Retained output must remain a regular original file.');const body=await readFile(join(root,file.name));need(body.length===file.bytes&&sha(body)===file.sha256,'Retained complete output changed');}
 return value;
}
async function publishCompletion(value){
 await verifiedCompletion(value);
 await original(acceptedPath,{schema:'stellar-forge.webhook-publisher-working-accepted.v1',binding,result:value});
 await original(resultPath,value);
 return value;
}
const {operationLease}=await import(pathToFileURL(join(source,'stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs')));
const lease=await operationLease(join(prior,'.commissioning.lock'));
let host,browser;
try{
 const accepted=await optional(acceptedPath);
 if(accepted)need(accepted.schema==='stellar-forge.webhook-publisher-working-accepted.v1'&&encoded(accepted.binding)===encoded(binding),'The original accepted completion binding changed.');
 const completed=await optional(resultPath);
 if(completed){
  await verifiedCompletion(completed);
  if(accepted)need(encoded(accepted.result)===encoded(completed),'The accepted completed result changed.');
  console.log(JSON.stringify(completed));
 }else if(accepted){
  await publishCompletion(accepted.result);console.log(JSON.stringify(accepted.result));
 }else {
  const dispatched=await optional(dispatchPath);
  need(!dispatched,'This original course was already dispatched without a retained accepted completion. Preserve its outputs and reconcile the same course; do not replay its native saves.');
  for(const name of outputNames){try{await lstat(join(root,name));throw new Error('Original receiving output already exists without a complete accepted result. Reconcile that original course before another dispatch.');}catch(error){if(error.code!=='ENOENT')throw error;}}
  await original(dispatchPath,{schema:'stellar-forge.webhook-publisher-working-dispatch.v1',binding,startedAt:new Date().toISOString()});
 const sourceSecret=await read(join(prior,'source-secret.json'));process.env[request.source.secretEnv]=sourceSecret.secret;
 const {startWebhookOperations}=await import(pathToFileURL(join(source,'products/webhook-feed/runtime.mjs')));
 host=await startWebhookOperations({directory:join(prior,'customer'),port:0,expectedStoreId:input.storeId});
 const {chromium}=createRequire(import.meta.url)(resolve(args['--playwright']));
 browser=await chromium.launch({executablePath:resolve(args['--chromium']),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[],context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(host.session.url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#source-save')?.disabled===false);
 await page.locator('#source-list .item').filter({hasText:'/webhooks/'+request.source.id}).getByRole('button',{name:'Edit',exact:true}).click();
 const originalKey=await page.locator('#source-draft-list').inputValue();
 await page.locator('#source-form [name="label"]').fill('Publisher receiving — preserved working label');
 await page.locator('#new-source').click();
 await page.locator('#source-form [name="id"]').fill('second-draft');
 await page.locator('#source-form [name="label"]').fill('Incomplete original second source');
 const secondKey=await page.locator('#source-draft-list').inputValue();
 await page.locator('#source-draft-list').selectOption(originalKey);
 await page.locator('#refresh').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));
 need(await page.locator('#source-form [name="label"]').inputValue()==='Publisher receiving — preserved working label','Switch/refresh replaced authored source input');
 await page.locator('#source-save').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Saved source'));
 // Lose only the browser response after the original native writer commits.
 await page.route('**/api/source',async route=>{await route.fetch();await route.abort('failed');},{times:1});
 await page.locator('#source-form [name="label"]').fill('Publisher receiving — exact uncertain save');
 await page.locator('#source-save').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));
 need(await page.locator('#source-save').isDisabled(),'Uncertain save allowed a new request');
 await page.locator('#source-inspect').click();await page.waitForFunction(()=>document.querySelector('#draft-review-summary').textContent.includes('currently saved'));
 need(host.store.definition('source',request.source.id).label==='Publisher receiving — exact uncertain save','Original native save did not commit');
 await page.locator('#source-draft-list').selectOption(secondKey);
 need(await page.locator('#source-form [name="label"]').inputValue()==='Incomplete original second source','Incomplete second source was lost');
 await page.locator('[data-tab="feeds"]').click();
 await page.locator('#feed-list .item').filter({hasText:request.feed.label}).getByRole('button',{name:'Edit',exact:true}).click();
 await page.locator('#feed-form [name="description"]').fill('Complete retained projection review');
 await page.locator('#feed-page-bytes').fill('2097152');await page.locator('#add-field').click();
 await page.locator('#projection-fields tr').last().locator('input').nth(0).fill('reviewField');
 await page.locator('#projection-fields tr').last().locator('input').nth(1).fill('/data/review');
 await page.locator('[data-tab="deployment"]').click();
 const payment={scheme:'exact',network:'stellar:testnet',amount:'7',asset:'SOURCE_SELECTED_ASSET',payTo:'SOURCE_SELECTED_ADDRESS',maxTimeoutSeconds:300};
 const plan={schema:'stellar-forge.webhook-feed-merchant.v1',publicOrigin:'https://example.invalid',feeds:[{feedId:request.feed.id,payment},{feedId:'second-authored-draft',paymentOptions:[{...payment,amount:'13'},{...payment,amount:'29'}]}]};
 await page.locator('#plan-json').fill(JSON.stringify(plan,null,2));await page.locator('#refresh').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));
 need(JSON.stringify(JSON.parse(await page.locator('#plan-json').inputValue()))===JSON.stringify(plan),'Full heterogeneous working plan changed');
 await page.locator('[data-tab="working"]').click();
 await page.locator('#working-title').fill('Original publisher customer receiving');
 const promise=page.waitForEvent('download');await page.locator('#working-export').click();await (await promise).saveAs(join(root,'Publisher_Working_Copy.json'));
 const retained=await read(join(root,'Publisher_Working_Copy.json'));
 need(retained.storeId===input.storeId&&retained.drafts.some(d=>d.attempts.some(a=>a.reconciled)),'Complete working-copy request recovery missing');
 await page.screenshot({path:join(root,'publisher-working-desktop.png'),fullPage:true});
 await context.close();
 const cold=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}}),received=await cold.newPage();received.on('pageerror',error=>errors.push(error.message));
 await received.goto(host.session.url,{waitUntil:'networkidle'});await received.waitForFunction(()=>document.querySelector('#source-save')?.disabled===false);
 await received.locator('[data-tab="working"]').click();await received.locator('#working-file').setInputFiles(join(root,'Publisher_Working_Copy.json'));
 await received.waitForFunction(()=>!document.querySelector('#working-import-review').hidden);
 let nativeWrites=0;received.on('request',r=>{if(r.method()==='POST')nativeWrites++;});
 await received.locator('#working-import').click();await received.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Original complete working copy'));
 need(nativeWrites===0,'Import dispatched a native write');
 await received.locator('[data-tab="deployment"]').click();need(JSON.stringify(JSON.parse(await received.locator('#plan-json').inputValue()))===JSON.stringify(plan),'Cold receive lost heterogeneous plan');
 await received.locator('[data-tab="feeds"]').click();need(await received.locator('#feed-page-bytes').inputValue()==='2097152','Cold receive lost page-byte draft');
 need(await received.locator('#projection-fields tr').last().locator('input').nth(0).inputValue()==='reviewField','Cold receive lost ordered projection');
 await received.locator('[data-tab="sources"]').click();need(await received.locator('#source-form [name="label"]').inputValue()==='Incomplete original second source','Cold receive lost selected source draft');
 await received.screenshot({path:join(root,'publisher-working-narrow.png'),fullPage:true});
 await received.locator('[data-tab="working"]').click();
 const again=received.waitForEvent('download');await received.locator('#working-export').click();await (await again).saveAs(join(root,'Publisher_Received_Working_Copy.json'));
 const reopened=await read(join(root,'Publisher_Received_Working_Copy.json'));need(reopened.id!==retained.id&&JSON.stringify(reopened.drafts)===JSON.stringify(retained.drafts),'Independent receiving replaced the complete original drafts');
 await cold.close();await browser.close();browser=null;await host.close();host=null;
 need(!errors.length,'Browser errors: '+errors.join('; '));
 const files=[];for(const name of ['Publisher_Working_Copy.json','Publisher_Received_Working_Copy.json','publisher-working-desktop.png','publisher-working-narrow.png']){const body=await readFile(join(root,name));files.push({name,bytes:body.length,sha256:sha(body)});}
 const result={schema:'stellar-forge.webhook-publisher-working-receiving.v1',state:'COMPLETE',completedAt:new Date().toISOString(),storeId:input.storeId,originalOperation:input.operationId,drafts:retained.drafts.length,sourceSaveRecovered:true,sourceCopiesRetained:true,feedProjectionRetained:true,heterogeneousPlanRetained:true,nativeWritesOnImport:nativeWrites,files,errors};
 await publishCompletion(result);console.log(JSON.stringify(result));
 }
}finally{await browser?.close().catch(()=>{});await host?.close().catch(()=>{});await lease.close();}
