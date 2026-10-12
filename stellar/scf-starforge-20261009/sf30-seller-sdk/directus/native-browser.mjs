#!/usr/bin/env node
// MIT. Complete operator walk against the original running Directus customer service.
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startDirectusOperator} from './server.mjs';
import {receiveDirectusWorkspace} from './workspace.mjs';
import {saveExact,copyExact,exists,digest,privateDirectory,readJson,acquireWorkspace} from '../dspace/merchant-files.mjs';

export async function runDirectusBrowser({input,directory}={}){
  if(!input||typeof input!=='object'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(input.operationId??'')||
      typeof input.customerDirectory!=='string'||typeof input.playwright!=='string'||typeof input.chromium!=='string')
    throw new TypeError('Supply the original customer directory, operation ID, retained Playwright and Chromium paths.');
  directory=resolve(directory);await privateDirectory(directory,true);
  const unlock=await acquireWorkspace(directory);
  let service,browser,context;
  const output=join(directory,'BROWSER_RESULT.json');
  try{
    const customerDirectory=resolve(input.customerDirectory);
    const customer=await readJson(resolve(input.customerResult??join(customerDirectory,'CUSTOMER_RESULT.json')),8*1024*1024);
    const customerIntent=await readJson(join(customerDirectory,'customer-intent.json'),8*1024*1024),original=customerIntent.input;
    assert.equal(customer.status,'PASS');assert.equal(customer.operationId,original.operationId);
    const intent={schema:'stellar-forge.directus-native-browser-intent.v1',input,directory,
      customerOperation:customer.operationId,customerProjectSha256:customer.project_sha256,customerDeliverySha256:customer.delivery_sha256};
    await saveExact(join(directory,'browser-intent.json'),intent);
    if(await exists(output)){
      const completed=await readJson(output,8*1024*1024);
      for(const file of completed.images){const raw=await readFile(join(directory,file.path));assert.equal(digest(raw),file.sha256);assert.equal(raw.length,file.bytes);}
      return {...completed,replayed:true};
    }
    const projectBytes=await readFile(customer.project);assert.equal(digest(projectBytes),customer.project_sha256);
    const receivedDirectory=join(directory,'editable-project');
    const received=await receiveDirectusWorkspace({file:customer.project,directory:receivedDirectory});await received.close();
    service=await startDirectusOperator({directory:join(directory,'operator'),workspaceDirectory:receivedDirectory});
    const modulePath=input.playwright.endsWith('.mjs')||input.playwright.endsWith('.js')?input.playwright:join(input.playwright,'index.mjs');
    const {chromium}=await import(pathToFileURL(resolve(modulePath)).href);
    browser=await chromium.launch({executablePath:resolve(input.chromium),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
    const page=await context.newPage(),pageErrors=[],httpErrors=[],images=[],steps=[];
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).pathname!=='/favicon.ico')
      httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
    const state=()=>page.evaluate(async()=>{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('State '+response.status());return response.json();});
    const field=(form,name)=>page.locator('#'+form+' [name="'+name+'"]');
    const op=phase=>'browser-'+digest(Buffer.from(input.operationId+'\n'+phase)).slice(0,48);
    async function fill(form,name,value){
      const node=field(form,name);
      if(!await node.isVisible())await node.locator('xpath=ancestor::details[1]').locator('summary').first().click();
      await node.fill(String(value));
    }
    async function step(name,values={}){
      const result={name,recorded_at:new Date().toISOString(),...values};steps.push(result);
      process.stdout.write(JSON.stringify({phase:'browser-'+name,...values})+'\n');
    }
    async function submit(form,path){
      const expected=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST');
      await page.locator('#'+form+' button').first().click();
      const response=await expected,body=await response.json();
      assert.ok(response.ok(),JSON.stringify(body));return body;
    }
    async function clickPost(selector,path){
      const expected=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST');
      await page.locator(selector).click();const response=await expected,body=await response.json();
      assert.ok(response.ok(),JSON.stringify(body));return body;
    }
    async function refreshed(){
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');
      await page.locator('#refresh').click();await response;
      await page.waitForFunction(()=>document.querySelector('#workspace-status').textContent.includes('revision'));
      return state();
    }
    async function native(form,phase,values){
      for(const [name,value]of Object.entries(values))await fill(form,name,value);
      await field(form,'operationId').fill(op(phase));
      await submit(form,'/api/native');
      await page.waitForFunction(id=>{
        const text=document.querySelector('#native-status').textContent;
        return text.startsWith(id+' · ')&&!text.endsWith('running');
      },op(phase),{timeout:180000});
      const status=await page.locator('#native-status').textContent();
      assert.ok(status.endsWith('complete'),status+' '+await page.locator('#native-result').textContent());
      const result=JSON.parse(await page.locator('#native-result').textContent());
      await page.waitForFunction(()=>document.querySelector('#activity').textContent==='');
      return result;
    }
    async function screenshot(name,width,anchor){
      await page.setViewportSize({width,height:width<500?844:1000});
      if(anchor)await page.locator(anchor).scrollIntoViewIfNeeded();else await page.evaluate(()=>scrollTo(0,0));
      const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,
        bodyWidth:document.body.scrollWidth,focus:document.activeElement?.tagName}));
      assert.ok(layout.width<=layout.viewport+2,'Document overflow '+JSON.stringify(layout));
      const path=name+'.png';await page.screenshot({path:join(directory,path),fullPage:false,animations:'disabled'});
      const bytes=await readFile(join(directory,path));images.push({path,width,bytes:bytes.length,sha256:digest(bytes),layout});
    }
    await page.goto(service.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('#workspace-status').textContent.includes('revision'));
    let current=await state();assert.equal(current.id,customer.workspace_id);
    if(current.operator.selected!=='original'){
      await page.locator('#project').selectOption('original');
      await page.waitForFunction(()=>document.querySelector('#project').value==='original');
      current=await state();
    }
    await page.locator('#actor').fill(original.actor??'Directus native customer');
    if(!current.connection.authenticated||current.connection.baseUrl!==original.baseUrl){
      assert.ok(process.env.DIRECTUS_TOKEN,'The original private admin token is required for the native operator walk.');
      await field('connection-form','baseUrl').fill(original.baseUrl);
      await field('connection-form','token').fill(process.env.DIRECTUS_TOKEN);
      await submit('connection-form','/api/connection');
      await page.waitForFunction(()=>document.querySelector('#connection-form [name="token"]').value==='');
    }
    assert.ok(current.sources.length>=2&&current.editions.length>=2);
    const initial=current.editions.find(e=>e.snapshot===customer.snapshot),successor=current.editions.find(e=>e.snapshot===customer.successor_snapshot);
    assert.ok(initial&&successor);
    await page.locator('#source-list tbody button').last().click();
    await page.waitForFunction(()=>!document.querySelector('#source-detail').hidden);
    const searched=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/items'&&new URL(r.url()).searchParams.get('search')===original.item);
    await page.locator('#item-search').fill(original.item);await page.locator('#item-search').press('Tab');await searched;
    await page.waitForFunction(key=>[...document.querySelectorAll('#items tbody tr')].some(row=>row.cells[0]?.textContent===key),original.item);
    const rowIndex=await page.locator('#items tbody tr').evaluateAll((rows,key)=>rows.findIndex(row=>row.cells[0]?.textContent===key),original.item);
    await page.locator('#items tbody tr').nth(rowIndex).getByRole('button',{name:'Original item'}).click();
    const originalItem=JSON.parse(await page.locator('#history-detail').textContent());assert.equal(String(originalItem.key),original.item);
    await step('received-original-source',{workspaceId:current.id,initialSnapshot:initial.snapshot,successorSnapshot:successor.snapshot,item:originalItem.key});

    const draft=await native('draft-create-form','create',{collection:original.collection,item:original.item,
      key:'browser-'+digest(Buffer.from(input.operationId)).slice(0,24),name:'Operator customer review'});
    const versionId=draft.native.versionId;assert.ok(versionId);
    const saved=await native('draft-save-form','save',{versionId,patchJson:original.patchJson});
    assert.equal(await field('draft-save-form','patchJson').inputValue(),original.patchJson);
    const compared=await native('draft-compare-form','compare',{versionId});
    assert.equal(await field('draft-promote-form','mainHash').inputValue(),compared.native.mainHash??'');
    assert.equal(await field('draft-promote-form','expectedVersionSha256').inputValue(),compared.native.versionSha256);
    const promoted=await native('draft-promote-form','promote',{versionId});
    assert.equal(String(promoted.native.item),original.item);
    await step('native-draft-editor',{versionId,item:promoted.native.item,patchSha256:digest(Buffer.from(original.patchJson)),
      comparedVersionSha256:compared.native.versionSha256,originalPatchTextPreserved:true});
    await screenshot('directus-native-drafts-desktop',1440,'#drafts');

    const capture=await native('capture-form','capture',{collection:original.collection,name:'Browser customer '+input.operationId,
      pageSize:original.capturePageSize??100,query:JSON.stringify(original.query??{})});
    const captureId=capture.source.id;
    await page.locator('#edition-source').selectOption(captureId);
    await page.waitForFunction(id=>document.querySelector('#field-choices').dataset.source===id,captureId);
    for(const checkbox of await page.locator('#field-choices input').all())await checkbox.setChecked(original.fields.includes(await checkbox.getAttribute('value')));
    const editionName='Operator customer '+digest(Buffer.from(input.operationId)).slice(0,16);
    current=await state();let edition=current.editions.find(e=>e.name===editionName);
    if(!edition){
      await field('edition-form','name').fill(editionName);
      await field('edition-form','attribution').fill(original.rights.attribution);
      await field('edition-form','rights').fill(original.rights.basis);
      if(original.rights.reference)await field('edition-form','reference').fill(original.rights.reference);
      await field('edition-form','previousEditionId').selectOption(successor.id);
      await fill('edition-form','nativeOperationIds',['create','save','compare','promote'].map(op).join('\n'));
      const result=await submit('edition-form','/api/action');edition=result.edition;
      await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Edition saved.');
    }
    current=await refreshed();edition=current.editions.find(e=>e.id===edition.id);assert.ok(edition);
    await field('review-form','editionId').selectOption(edition.id);
    const reviewNote='Reviewed through the actual browser from the original native collection, exact fields, source scope and distribution basis.';
    if(!current.reviews.some(r=>r.edition_id===edition.id&&r.decision==='approved'&&r.comment===reviewNote)){
      await field('review-form','decision').selectOption('approved');await field('review-form','comment').fill(reviewNote);
      await submit('review-form','/api/action');await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Review saved.');
    }
    await field('review-form','editionId').selectOption(edition.id);
    if((await state()).selected_edition_id!==edition.id){
      await clickPost('#select-edition','/api/action');
      await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Approved edition selected.');
    }
    current=await state();
    if(!current.comparisons.some(c=>c.before_id===initial.id&&c.after_id===edition.id)){
      await field('compare-editions-form','beforeId').selectOption(initial.id);await field('compare-editions-form','afterId').selectOption(edition.id);
      await submit('compare-editions-form','/api/action');
      await page.waitForFunction(()=>document.querySelector('#edition-comparison').textContent.includes('counts'));
    }
    await field('query-form','editionId').selectOption(edition.id);await field('query-form','query').fill('{"limit":"2"}');
    const query=await submit('query-form','/api/query');
    assert.equal(query.dataset.snapshot,edition.snapshot);assert.equal(query.rows.length,2);assert.ok(query.page.total>=3);
    assert.equal(query.semantics.schema,'stellar-forge.directus-semantics.v1');
    await step('browser-edition-review-query',{editionId:edition.id,snapshot:edition.snapshot,rows:query.page.total,fields:original.fields});
    await screenshot('directus-edition-desktop',1440,'#query-form');

    const packageDirectory=join(directory,'merchant-package'),versionDirectory=join(directory,'versions'),stageDirectory=join(directory,'native-stage');
    await field('merchant-form','editionId').selectOption(edition.id);
    for(const [name,value]of Object.entries({directory:packageDirectory,versionDirectory,origin:original.origin??'https://directus-customer.example',
      path:original.resourcePath??'/directus-data',payment:JSON.stringify(original.payment)}))await field('merchant-form',name).fill(value);
    const prepared=await submit('merchant-form','/api/merchant');assert.equal(prepared.snapshot,edition.snapshot);
    await field('serve-form','directory').fill(packageDirectory);await field('serve-form','stageDirectory').fill(stageDirectory);
    const served=await submit('serve-form','/api/merchant');assert.ok(served.url);
    await field('buyer-form','directory').fill(packageDirectory);await field('buyer-form','seller').fill(served.url);
    await field('buyer-form','query').fill('{"limit":"2"}');
    const offer=await submit('buyer-form','/api/buyer');assert.equal(offer.snapshot,edition.snapshot);
    await page.locator('#buyer-form summary').click();
    for(const [name,value]of Object.entries({intentId:op('buyer'),acceptIndex:String(original.acceptIndex??0),offerSha256:offer.offerSha256,
      destination:join(directory,'prepared-buyer.json')}))await field('buyer-form',name).fill(value);
    const buyer=await clickPost('#prepare-buyer','/api/buyer');assert.equal(buyer.snapshot,edition.snapshot);

    current=await refreshed();
    const acquiredSession=current.project_runtime.sessions.find(item=>item.snapshot===customer.snapshot);
    assert.ok(acquiredSession,'The complete customer project includes its original acquisition.');
    await page.locator('[data-project-session="'+acquiredSession.id+'"]').click();
    assert.equal(await field('receive-buyer-form','sessionDirectory').inputValue(),acquiredSession.directory);
    await field('save-session-form','buyerId').selectOption(acquiredSession.buyerId);
    await field('save-session-form','directory').fill(acquiredSession.directory);
    const savedSession=await submit('save-session-form','/api/buyer');
    assert.equal(savedSession.id,acquiredSession.id);
    const originalSessionStatus=await clickPost('[data-project-session-inspect="'+acquiredSession.id+'"]','/api/buyer');
    assert.equal(originalSessionStatus.status,'COMPLETE');assert.equal(originalSessionStatus.snapshot,customer.snapshot);
    await field('receive-buyer-form','destination').fill(join(directory,'customer-delivery'));
    await field('receive-buyer-form','includeSourceCaptures').check();
    const delivery=await submit('receive-buyer-form','/api/buyer');
    assert.equal(delivery.manifest.sha256,customer.delivery_sha256);
    const inspected=await clickPost('#inspect-delivery','/api/buyer');assert.equal(inspected.manifest.sha256,delivery.manifest.sha256);
    await step('browser-merchant-and-customer',{snapshot:edition.snapshot,offerSha256:offer.offerSha256,
      receivedOriginalCustomerSha256:delivery.manifest.sha256,rows:delivery.manifest.acquisition.rows,pages:delivery.manifest.acquisition.pages});
    await screenshot('directus-publishing-desktop',1440,'#receive-buyer-form');
    await clickPost('#stop-seller','/api/merchant');

    await screenshot('directus-overview-mobile',390,null);
    await page.locator('nav a[href="#drafts"]').focus();await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).hash,'#drafts');await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id??null,name:document.activeElement?.getAttribute('name')??null}));
    assert.notEqual(focus.tag,'BODY');await screenshot('directus-drafts-mobile',390,'#drafts');
    await screenshot('directus-publishing-mobile',390,'#receive-buyer-form');
    await step('mobile-and-keyboard',{viewport:390,focus,images:images.length});

    await page.setViewportSize({width:1440,height:1000});
    current=await refreshed();
    const downloadEvent=page.waitForEvent('download');await page.locator('#project-download').click();
    const download=await downloadEvent,downloadPath=await download.path(),raw=await readFile(downloadPath);
    assert.equal(await download.failure(),null);
    const project={bytes:raw.length,sha256:digest(raw)},retainedProject=join(directory,'Directus_Operator_Project.sqlite3');
    await copyExact(downloadPath,retainedProject,project);
    const expectedReceive=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/receive'&&response.request().method()==='POST');
    await page.locator('#receive-project').setInputFiles(retainedProject);
    const receiveResponse=await expectedReceive,receiveResult=await receiveResponse.json();assert.ok(receiveResponse.ok(),JSON.stringify(receiveResult));
    await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Complete project received and opened.');
    const transferred=await state();
    assert.equal(transferred.id,current.id);assert.equal(transferred.revision,current.revision);
    assert.equal(transferred['native-events'].length,current['native-events'].length);
    assert.ok(transferred.operator.selected.startsWith('received-'));
    await field('query-form','editionId').selectOption(edition.id);const reopenedQuery=await submit('query-form','/api/query');
    assert.equal(reopenedQuery.dataset.snapshot,edition.snapshot);
    const retainedCounts=Object.fromEntries(['merchant-packages','buyer-configurations','customer-deliveries','buyer-sessions']
      .map(kind=>{assert.equal(transferred[kind].length,current[kind].length);return [kind,transferred[kind].length];}));
    const originalPublisher=transferred.project_runtime.merchants.find(item=>item.edition.snapshot===customer.snapshot);
    const originalDelivery=transferred.project_runtime.deliveries.find(item=>item.deliverySha256===customer.delivery_sha256);
    const savedBuyer=transferred.project_runtime.buyers[0];assert.ok(originalPublisher&&originalDelivery&&savedBuyer);
    const receivedSession=transferred.project_runtime.sessions.find(item=>item.id===acquiredSession.id);
    assert.ok(receivedSession);assert.notEqual(receivedSession.directory,acquiredSession.directory);
    await page.locator('[data-project-session="'+receivedSession.id+'"]').click();
    assert.equal(await field('receive-buyer-form','sessionDirectory').inputValue(),receivedSession.directory);
    const receivedSessionStatus=await clickPost('[data-project-session-inspect="'+receivedSession.id+'"]','/api/buyer');
    assert.equal(receivedSessionStatus.sessionId,originalSessionStatus.sessionId);
    assert.equal(receivedSessionStatus.status,'COMPLETE');
    assert.equal(receivedSessionStatus.completedPages,originalSessionStatus.completedPages);
    const oldPublisher=current.project_runtime.merchants.find(item=>item.id===originalPublisher.id);
    assert.notEqual(originalPublisher.versionDirectory,oldPublisher.versionDirectory);
    await page.locator('[data-project-merchant="'+originalPublisher.id+'"]').click();
    assert.equal(await field('serve-form','directory').inputValue(),originalPublisher.directory);
    const receivedSeller=await submit('serve-form','/api/merchant');
    assert.equal(receivedSeller.current.current,customer.successor_snapshot);
    const receivedDelivery=await clickPost('[data-project-delivery="'+originalDelivery.id+'"]','/api/buyer');
    assert.equal(receivedDelivery.manifest.sha256,customer.delivery_sha256);
    const buyerDownloadEvent=page.waitForEvent('download');
    await page.locator('[data-project-buyer="'+savedBuyer.id+'"]').click();
    const buyerDownload=await buyerDownloadEvent;assert.equal(await buyerDownload.failure(),null);
    const downloadedBuyer=await readFile(await buyerDownload.path()),originalBuyer=await readFile(savedBuyer.configuration);
    assert.deepEqual(downloadedBuyer,originalBuyer);
    await screenshot('directus-received-publishing-desktop',1440,'#project-merchants');
    await screenshot('directus-received-publishing-mobile',390,'#project-merchants');
    await clickPost('#stop-seller','/api/merchant');
    await step('complete-project-download-receive',{projectSha256:project.sha256,projectBytes:project.bytes,
      workspaceId:transferred.id,revision:transferred.revision,nativeEvents:transferred['native-events'].length,
      retainedArtifacts:retainedCounts,receivedServingSnapshot:receivedSeller.current.current,
      receivedSessionId:receivedSession.id,receivedSessionPages:receivedSessionStatus.completedPages,
      receivedDeliverySha256:receivedDelivery.manifest.sha256,downloadedBuyerSha256:digest(downloadedBuyer)});

    await context.close();context=null;await browser.close();browser=null;
    await service.close();service=null;
    service=await startDirectusOperator({directory:join(directory,'operator'),workspaceDirectory:receivedDirectory});
    const reopened=service.state();assert.equal(reopened.id,transferred.id);assert.equal(reopened.revision,transferred.revision);
    assert.equal(reopened.operator.selected,transferred.operator.selected);
    await step('received-operator-restart',{workspaceId:reopened.id,revision:reopened.revision,project:reopened.operator.selected});
    assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);
    const result={schema:'stellar-forge.directus-native-browser-result.v1',status:'PASS',operationId:input.operationId,
      finished_at:new Date().toISOString(),customerOperationId:customer.operationId,workspaceId:reopened.id,revision:reopened.revision,
      nativeVersionId:versionId,editionId:edition.id,snapshot:edition.snapshot,project:retainedProject,projectSha256:project.sha256,
      receivedCustomerSha256:delivery.manifest.sha256,source:service.launch,images,steps,pageErrors,httpErrors};
    await saveExact(output,result);return result;
  }finally{
    try{await context?.close();}finally{try{await browser?.close();}finally{try{await service?.close();}finally{await unlock();}}}
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),flags={};
  if(args.length%2)throw new TypeError('Use --input ORIGINAL_BROWSER.json --out PRIVATE_BROWSER_DIRECTORY.');
  for(let i=0;i<args.length;i+=2){if(!['--input','--out'].includes(args[i])||flags[args[i]])throw new TypeError('Use --input and --out once.');flags[args[i]]=args[i+1];}
  if(!flags['--input']||!flags['--out'])throw new TypeError('Use --input ORIGINAL_BROWSER.json --out PRIVATE_BROWSER_DIRECTORY.');
  const input=JSON.parse(await readFile(resolve(flags['--input']),'utf8'));
  runDirectusBrowser({input,directory:flags['--out']}).then(result=>process.stdout.write(JSON.stringify(result)+'\n'),
    error=>{process.stderr.write(JSON.stringify({error:error.code??'DIRECTUS_BROWSER_FAILURE',message:error.message,stack:error.stack})+'\n');process.exitCode=1;});
}
