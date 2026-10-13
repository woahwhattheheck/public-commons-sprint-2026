// MIT. One actual original operator journey; published HDF Group values are unchanged.
import {createRequire} from 'node:module';
import {readFile,readlink,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {exact,json,privateDirectory,sha,verifiedFile} from '../custody.mjs';

async function identity(pid){
 const raw=await readFile('/proc/'+pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
 return {pid,startTicks:fields[19],pgid:Number(fields[2]),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),namespace:await readlink('/proc/'+pid+'/ns/pid')};
}
export async function browserJourney({server,root,attempt,intentSha256,editions,imported,arrays,deliveries,playwrightModule,chromiumExecutable,signal}){
 const playwright=playwrightModule?createRequire(import.meta.url)(resolve(playwrightModule)):await import('playwright');
 let browserServer,browser,context;const errors=[],screens=[],browserAttempt=randomUUID();
 const output=await privateDirectory(join(root,'browser',browserAttempt),{create:true});
 const owners=await privateDirectory(join(root,'browser-owners'),{create:true});
 const abort=()=>{void browserServer?.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  signal.throwIfAborted();
  browserServer=await playwright.chromium.launchServer({headless:true,...(chromiumExecutable?{executablePath:resolve(chromiumExecutable)}:{}),
    args:['--disable-dev-shm-usage',...(process.getuid?.()===0?['--no-sandbox']:[])]});
  const child=browserServer.process(),owned=await identity(child.pid);
  if(owned.pid!==owned.pgid)throw new Error('The actual owned Chromium process is not its recorded group leader.');
  await exact(join(owners,browserAttempt+'.json'),json({schema:'stellar-forge.hdf5-browser-owner.v1',directory:root,intentSha256,
    attempt:browserAttempt,journeyAttempt:attempt,identity:owned}));
  signal.throwIfAborted();
  browser=await playwright.chromium.connect(browserServer.wsEndpoint());
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.locator('#counts').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#counts').textContent.length>0);
  const action=async(form,expected)=>{
   const response=page.waitForResponse(response=>{
    if(!response.url().endsWith('/api/action')||response.request().method()!=='POST')return false;
    try{return response.request().postDataJSON().action===expected;}catch{return false;}
   });
   await page.locator('#'+form+' button[type="submit"],#'+form+' button:not([type])').first().click();
   const received=await response,body=await received.json();if(!received.ok())throw new Error(expected+': '+(body.message??body.error));return body;
  };
  const known=async id=>{try{return await server.workbench.call('operation.get',{ident:id});}catch(error){if(error.status===404)return null;throw error;}};
  const resume=async id=>{
   await page.locator('[data-tab="operations"]').click();await page.locator('#operation-form [name="ident"]').fill(id);
   await action('operation-form','operation.get');
   const response=page.waitForResponse(r=>r.url().endsWith('/api/action')&&r.request().postDataJSON()?.action==='operation.resume');
   await page.locator('#resume-operation').click();const reply=await response;if(!reply.ok())throw new Error('Original browser operation did not resume: '+await reply.text());
   await page.waitForFunction(()=>!document.querySelector('#resume-operation').disabled);
  };
  await page.locator('#sources-table button').filter({hasText:'HDF Group gzip array example'}).click();
  await page.locator('#versions-table button').first().waitFor();await page.locator('#versions-table button').first().click();
  await page.locator('#links-table button').filter({hasText:'DS1'}).click();
  await page.waitForFunction(()=>document.querySelector('#object-title').textContent==='/DS1');
  await page.locator('#select-object').click();
  const selectionOperation='hdfgroup-browser-select',extractOperation='hdfgroup-browser-extract';
  let selection;
  if(await known(selectionOperation)){await resume(selectionOperation);selection=(await known(selectionOperation)).result;}
  else{
   await page.locator('#selection-form [name="axes"]').fill(JSON.stringify([{start:'1',count:'4',stride:'2',block:'2'},{start:'2',count:'5',stride:'3',block:'1'}]));
   await page.locator('#selection-form [name="operation"]').fill(selectionOperation);
   selection=await action('selection-form','selection.save');
  }
  if(await known(extractOperation))await resume(extractOperation);
  else{
   await page.locator('[data-tab="selections"]').click();
   await page.locator('#extract-form [name="selection_id"]').fill(selection.id);
   await page.locator('#extract-form [name="operation"]').fill(extractOperation);
   const extracted=await action('extract-form','selection.extract');
   if(extracted.id!==editions.gzip.id)throw new Error('Actual browser selection produced a different original edition.');
  }
  await page.locator('[data-tab="results"]').click();await page.locator('#result-form [name="edition"]').fill(editions.gzip.id);
  await action('result-form','result.page');await page.waitForFunction(()=>document.querySelector('#value-table tbody tr')!==null);
  await page.locator('#query-form [name="query"]').fill('limit=7');const query=await action('query-form','dataset.query');
  if(query.native.status!==200||query.native.body.rows.length!==7)throw new Error('The actual operator query did not return its exact first page.');
  const exportOperation='hdfgroup-browser-export';
  let delivered;
  if(await known(exportOperation)){await resume(exportOperation);delivered=(await known(exportOperation)).result;}
  else{
   await page.locator('#export-form [name="operation"]').fill(exportOperation);delivered=await action('export-form','edition.export');
  }
  if(delivered.archive.sha256!==deliveries.gzip.archive.sha256)throw new Error('The actual operator exported different selected source bytes.');
  const url=server.origin+'/api/artifact?delivery='+exportOperation;
  const head=await fetch(url,{method:'HEAD',headers:{authorization:'Bearer '+server.token},signal});
  if(!head.ok()||Number(head.headers.get('content-length'))!==delivered.archive.bytes)throw new Error('Original operator HEAD differs from retained packet.');
  const ranged=await fetch(url,{headers:{authorization:'Bearer '+server.token,range:'bytes=0-1023'},signal});
  const bytes=Buffer.from(await ranged.arrayBuffer());
  const original=await verifiedFile(delivered.path,delivered.archive);
  try{const wanted=Buffer.alloc(1024);await original.handle.read(wanted,0,1024,0);if(ranged.status!==206||!wanted.equals(bytes))throw new Error('Original operator range differs from exact archive.');}
  finally{await original.handle.close();}
  const receiveOperation='hdfgroup-browser-receive';
  if(await known(receiveOperation))await resume(receiveOperation);
  else{
   await page.locator('[data-tab="receive"]').click();
   await page.locator('#receive-form [name="file"]').setInputFiles(delivered.path);
   await page.locator('#receive-form [name="expected_sha"]').fill(delivered.archive.sha256);
   await page.locator('#receive-form [name="operation"]').fill(receiveOperation);
   const received=await action('receive-form','edition.receive');
   if(!received.reconstructed||received.editionId!==editions.gzip.id)throw new Error('Original operator receiving did not reconstruct the selected edition.');
  }
  await page.locator('[data-tab="operations"]').click();await page.locator('#operation-form [name="ident"]').fill(receiveOperation);
  await action('operation-form','operation.get');
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'phone',width:390,height:844}]){
   await page.setViewportSize({width:viewport.width,height:viewport.height});
   for(const tab of ['sources','array','selections','results','publisher','receive','operations']){
    signal.throwIfAborted();
    const collection={selections:'selections',results:'editions',operations:'operations'}[tab];
    const pending=collection?page.waitForResponse(response=>{
     if(!response.url().endsWith('/api/action'))return false;
     try{const body=response.request().postDataJSON();return body.action==='records'&&body.payload.kind===collection;}catch{return false;}
    }):null;
    await page.locator('[data-tab="'+tab+'"]').click();
    await page.locator('[data-panel="'+tab+'"]').waitFor({state:'visible'});
    if(pending){
     const response=await pending;if(!response.ok())throw new Error('The current '+tab+' records read failed before capture.');
     const body=await response.json();
     await page.waitForFunction(({selector,count})=>{
      const root=document.querySelector(selector);return root&&!root.textContent.includes('Loading records')&&
       (count?root.querySelectorAll('tbody tr').length===count:root.querySelector('.empty')!==null);
     },{selector:'#'+collection+'-table',count:body.items.length});
    }
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const width=await page.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
    if(width.content>width.viewport+1)throw new Error('Original '+tab+' page exceeds the '+viewport.name+' viewport.');
    const filename=viewport.name+'-'+tab+'.png',bytes=await page.screenshot({path:join(output,filename),fullPage:true});
    screens.push({filename,viewport:viewport.name,tab,bytes:bytes.length,sha256:sha(bytes)});
   }
  }
  if(errors.length)throw new Error('Actual operator script errors: '+errors.join('; '));
  const result={schema:'stellar-forge.hdf5-browser-result.v1',intentSha256,attempt:browserAttempt,inputVersions:Object.fromEntries(Object.entries(imported).map(([kind,value])=>[kind,value.version.id])),
   editionId:editions.gzip.id,operationIds:[selectionOperation,extractOperation,exportOperation,receiveOperation],
   archive:delivered.archive,headBytes:Number(head.headers.get('content-length')),rangeBytes:bytes.length,screenshots:screens,scriptErrors:errors};
  await exact(join(output,'browser-result.json'),json(result));return result;
 }finally{
  signal.removeEventListener('abort',abort);
  const closed=[];for(const owner of [context,browser,browserServer])if(owner)try{await owner.close();}catch(error){closed.push(error);}
  if(closed.length)throw new AggregateError(closed,'The original browser owners did not all close normally.');
 }
}
