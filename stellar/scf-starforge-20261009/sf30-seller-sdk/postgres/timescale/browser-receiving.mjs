#!/usr/bin/env node
// MIT. Receive an already completed native Timescale operation in its original browser.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat, chmod, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { absolute, bytes, digest, identity, readPrivate, readJson, createFile, atomicJson,
  privateDirectory, hashPrivate, acquireWorkspace, fault, stamp } from '../publisher/files.mjs';
import { inspectTimescalePackage } from './package.mjs';

const SCHEMA='stellar-forge.timescale-browser-receiving.v1';
const MAX_RECORD=67108864;
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function requireValue(value,code){if(!value)throw fault(code);}
function equal(actual,expected,code){requireValue(identity(actual)===identity(expected),code);}
function resultOf(record,name){
  const selected=record.phases[name];
  requireValue(selected?.state==='COMPLETE'&&selected.result,'TIMESCALE_BROWSER_NATIVE_PHASE_INCOMPLETE');
  return selected.result;
}
async function browserEngine(playwright){
  if(playwright?.chromium?.launch)return playwright;
  absolute(playwright,'Playwright module');
  const selected=await lstat(playwright);
  return import(pathToFileURL(selected.isDirectory()?join(playwright,'index.mjs'):playwright).href);
}
async function runTimescaleBrowserReceiving({url,nativeResult,outputDirectory,playwright,chromium}){
  const address=new URL(url);
  requireValue(address.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(address.hostname)&&
    address.pathname==='/'&&!address.search&&!address.hash&&!address.username&&!address.password,'TIMESCALE_BROWSER_LOCAL_LISTENER_REQUIRED');
  const origin=address.origin;
  absolute(nativeResult,'original native result');absolute(outputDirectory);absolute(chromium,'Chromium executable');
  const originalBytes=await readPrivate(nativeResult,MAX_RECORD),original=JSON.parse(originalBytes.toString('utf8'));
  requireValue(original.schema==='stellar-forge.timescale-native-demo.v1'&&original.complete===true,'TIMESCALE_BROWSER_NATIVE_DEMO_REQUIRED');
  const before=resultOf(original,'before'),after=resultOf(original,'after'),publication=resultOf(original,'select'),
    extraction=resultOf(original,'extract'),customer=resultOf(original,'reopen-and-original-customer');
  requireValue(original.native.extversion==='2.30.2'&&customer.workspaceId===original.customer.workspaceId,'TIMESCALE_BROWSER_NATIVE_BINDING_CHANGED');
  const binding={nativeResult,nativeSha256:digest(originalBytes),nativeBytes:originalBytes.length,
    nativeId:original.id,namespace:original.namespace,workspaceId:customer.workspaceId};
  await privateDirectory(outputDirectory,true);
  const release=await acquireWorkspace(outputDirectory);
  const recordPath=join(outputDirectory,'browser-receiving.json'),downloadDirectory=join(outputDirectory,'downloads');
  let record,browser,context,page,saveQueue=Promise.resolve(),routeFailure;
  const errors=[],httpFailures=[],mutations=[];
  const save=()=>{const snapshot=structuredClone(record);saveQueue=saveQueue.then(()=>atomicJson(outputDirectory,'browser-receiving.json',snapshot));return saveQueue;};
  try{
    if(await exists(recordPath)){
      record=await readJson(recordPath,MAX_RECORD);
      requireValue(record.schema===SCHEMA,'TIMESCALE_BROWSER_RECORD_SCHEMA');
      equal(record.binding,binding,'TIMESCALE_BROWSER_BINDING_CHANGED');
      if(record.complete){
        await inspectTimescalePackage(record.export.operation.data.result.directory,record.export.operation.data.result.manifestDigest);
        for(const file of record.downloads??[]){
          const found=await hashPrivate(file.path,MAX_RECORD);
          requireValue(found.hash===file.sha256&&found.bytes===file.bytes,'TIMESCALE_BROWSER_RETAINED_FILE_CHANGED');
        }
        return {complete:true,reused:true,record:recordPath,workspaceId:binding.workspaceId,export:record.export.operation.data.result};
      }
    }else{
      record={schema:SCHEMA,id:randomUUID(),createdAt:stamp(),binding,complete:false,phases:{},downloads:[],
        export:{directory:join(outputDirectory,'browser-package')}};
      await createFile(recordPath,bytes(record));
    }
    await privateDirectory(downloadDirectory,true);
    record.attempts=(record.attempts??0)+1;record.listener=origin;record.startedAt=stamp();await save();
    async function phase(name,work){
      const previous=record.phases[name];
      record.phases[name]={state:'RUNNING',startedAt:stamp(),attempts:(previous?.attempts??0)+1};await save();
      try{
        const result=await work();
        record.phases[name]={...record.phases[name],state:'COMPLETE',completedAt:stamp(),result};await save();
        process.stdout.write(JSON.stringify({phase:'browser-'+name,state:'COMPLETE',record:recordPath})+'\n');return result;
      }catch(error){
        record.phases[name]={...record.phases[name],state:'FAILED',error:{code:error.code??'TIMESCALE_BROWSER_PHASE_FAILED',message:error.message}};
        await save();throw error;
      }
    }
    const engine=await browserEngine(playwright);
    browser=await engine.chromium.launch({headless:true,executablePath:chromium,args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1100}});
    page=await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>errors.push({message:error.message,at:stamp()}));
    page.on('response',response=>{
      if(response.url().startsWith(origin+'/')&&response.status()>=400)
        httpFailures.push({url:response.url(),status:response.status(),at:stamp()});
    });
    page.on('request',request=>{
      if(request.url().startsWith(origin+'/api/')&&!['GET','HEAD'].includes(request.method()))
        mutations.push({method:request.method(),path:new URL(request.url()).pathname,at:stamp()});
    });
    const storageKey='sf.timescale.'+binding.workspaceId;
    const clientState=()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null'),storageKey);
    if(record.clientState){
      await context.addInitScript(({key,value,origin})=>{
        if(location.origin===origin&&!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(value));
      },{key:storageKey,value:record.clientState,origin});
    }
    // Persist the browser's exact request before forwarding it to the real listener.
    // A restarted receiving driver continues this identity, including its version.
    await page.route(origin+'/api/timescale/export',async route=>{
      const request=route.request();
      if(request.method()!=='POST'){await route.continue();return;}
      try{
        const input=request.postDataJSON();
        requireValue(input.outputDirectory===record.export.directory,'TIMESCALE_BROWSER_EXPORT_DIRECTORY_CHANGED');
        if(record.export.request)equal(input,record.export.request,'TIMESCALE_BROWSER_EXPORT_REQUEST_CHANGED');
        else record.export.request=input;
        record.clientState=await clientState();await save();await route.continue();
      }catch(error){routeFailure=error;await route.abort('failed');}
    });
    async function ready(){
      await page.waitForSelector('#timescale-workspace');
      await page.waitForFunction(()=>{const button=document.querySelector('#ts-capture button[type=submit]');return button&&!button.disabled;},undefined,{timeout:600000});
    }
    async function read(path,missing=false){
      const response=await page.request.get(origin+path),value=await response.json();
      if(missing&&response.status()===404)return null;
      if(!response.ok())throw fault(value.error??'TIMESCALE_BROWSER_HTTP_ERROR',value.message??String(response.status()));
      return value;
    }
    async function clickRead(locator,path){
      const responsePromise=page.waitForResponse(response=>response.url()===origin+path&&response.request().method()==='GET');
      await locator.click();const response=await responsePromise;
      requireValue(response.ok(),'TIMESCALE_BROWSER_READ_FAILED');return response.json();
    }
    async function keepDownload(trigger,name,expected){
      const downloadPromise=page.waitForEvent('download');await trigger();const download=await downloadPromise;
      const temporary=join(downloadDirectory,'.incoming-'+randomUUID()),path=join(downloadDirectory,name);
      await download.saveAs(temporary);await chmod(temporary,0o600);
      const actual=await hashPrivate(temporary,MAX_RECORD);
      requireValue(actual.bytes===expected.bytes&&actual.hash===expected.sha256,'TIMESCALE_BROWSER_DOWNLOAD_CHANGED');
      if(await exists(path)){
        const retained=await hashPrivate(path,MAX_RECORD);
        requireValue(retained.bytes===actual.bytes&&retained.hash===actual.hash,'TIMESCALE_BROWSER_OUTPUT_COLLISION');
        await unlink(temporary);
      }else await rename(temporary,path);
      const result={path,bytes:actual.bytes,sha256:actual.hash,suggestedFilename:download.suggestedFilename()};
      record.downloads=record.downloads.filter(file=>file.path!==path);record.downloads.push(result);await save();return result;
    }
    async function openEdition(selected){
      await page.locator('#ts-edition').selectOption(selected.editionId);
      const edition=await clickRead(page.locator('#ts-open-edition'),'/api/timescale/edition?id='+encodeURIComponent(selected.editionId));
      requireValue(edition.value.id===selected.editionId&&edition.record.digest===selected.digest,'TIMESCALE_BROWSER_EDITION_CHANGED');
      await page.waitForFunction(id=>document.querySelector('#ts-aggregate')?.options.length>1&&
        JSON.parse(sessionStorage.getItem('sf.timescale.'+id)||'null')?.editionId===document.querySelector('#ts-edition').value,binding.workspaceId);
      return edition;
    }
    async function tableRows(area){return area.locator('table tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)));}
    async function shownOperation(id){
      await page.waitForFunction(id=>{
        const nodes=document.querySelectorAll('#timescale-workspace pre');
        try{const row=JSON.parse(nodes[nodes.length-1].textContent);return row.id===id&&!['RUNNING','DISPATCHING'].includes(row.state);}catch{return false;}
      },id,{timeout:600000});
      return JSON.parse(await page.locator('#timescale-workspace pre').last().textContent());
    }
    await phase('original-listener',async()=>{
      const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await ready();
      requireValue(response?.status()===200,'TIMESCALE_BROWSER_PAGE_FAILED');
      const status=await read('/api/timescale/status?limit=100');
      requireValue(status.id===binding.workspaceId&&status.editions.total===2,'TIMESCALE_BROWSER_WRONG_WORKSPACE');
      record.browserVersion=browser.version();
      return {url:page.url(),browserVersion:record.browserVersion,title:await page.title(),workspaceId:status.id,editions:status.editions.total};
    });
    let afterEdition;
    await phase('original-editions',async()=>{
      const retained=[];
      for(const selected of [before,after]){
        const edition=await openEdition(selected);
        const file=await keepDownload(()=>page.locator('#ts-download-edition').click(),selected.editionId+'.json',
          {bytes:edition.record.bytes,sha256:edition.record.digest});
        retained.push({id:edition.value.id,title:edition.record.title,aggregateCount:edition.catalog.length,file});
        if(selected===after)afterEdition=edition;
      }
      return retained;
    });
    const aggregate=afterEdition.catalog.find(row=>row.schema===original.namespace&&row.name==='hourly');
    requireValue(aggregate,'TIMESCALE_BROWSER_ORIGINAL_AGGREGATE_MISSING');
    await phase('aggregate-and-native-tables',async()=>{
      await page.locator('#ts-aggregate').selectOption(aggregate.key);
      await page.locator('#ts-time-column').selectOption('bucket');
      const fields={start:original.originalInputs.window.start,end:original.originalInputs.window.end,timezone:'UTC',
        title:'October usage',owner:'Native product operator',note:'Receive the original native refresh, schedule, exact aggregate and published customer output.'};
      for(const[key,value]of Object.entries(fields))await page.locator('#ts-'+key).fill(value);
      requireValue(await page.locator('#ts-time-type').inputValue()==='timestamp with time zone','TIMESCALE_BROWSER_TIME_TYPE_CHANGED');
      equal(await page.locator('#ts-window .ts-checks input:checked').evaluateAll(inputs=>inputs.map(input=>input.value)),
        ['bucket','line','samples','total'],'TIMESCALE_BROWSER_COLUMNS_CHANGED');
      const area=page.locator('#timescale-workspace > details').filter({has:page.locator('#ts-table')});
      if(!await area.evaluate(element=>element.open))await area.locator('summary').click();
      const tables=[];
      for(const[name,table]of Object.entries(afterEdition.value.tables)){
        await page.locator('#ts-search').fill('');await page.locator('#ts-table').selectOption(name);
        const rows=[];let pages=0;
        while(true){
          rows.push(...await tableRows(area));pages++;
          if(!await page.locator('#ts-rows-next').isEnabled())break;
          await page.locator('#ts-rows-next').click();
        }
        const expected=table.rows.map(row=>row.map(value=>value===null?'NULL':String(value)));
        equal(rows,expected,'TIMESCALE_BROWSER_NATIVE_TABLE_INCOMPLETE');
        tables.push({name,columns:table.columns.map(column=>column.name),rows:rows.length,pages,displaySha256:identity(rows)});
      }
      const needle=String(resultOf(original,'native-source').jobId);
      await page.locator('#ts-table').selectOption('jobs');await page.locator('#ts-search').fill(needle);
      const expected=afterEdition.value.tables.jobs.rows.filter(row=>row.some(value=>value!==null&&String(value).toLocaleLowerCase().includes(needle.toLocaleLowerCase())))
        .slice(0,40).map(row=>row.map(value=>value===null?'NULL':String(value)));
      equal(await tableRows(area),expected,'TIMESCALE_BROWSER_NATIVE_SEARCH_INCOMPLETE');
      return {aggregateKey:aggregate.key,timeColumn:'bucket',window:original.originalInputs.window,tables,search:{table:'jobs',query:needle,shown:expected.length}};
    });
    await phase('complete-edition-comparison',async()=>{
      const area=page.locator('#timescale-workspace > details').filter({has:page.locator('#ts-before')});
      if(!await area.evaluate(element=>element.open))await area.locator('summary').click();
      await page.locator('#ts-before').selectOption(before.editionId);await page.locator('#ts-after').selectOption(after.editionId);
      const path='/api/timescale/compare?before='+encodeURIComponent(before.editionId)+'&after='+encodeURIComponent(after.editionId);
      const comparison=await clickRead(area.getByRole('button',{name:'Compare complete editions',exact:true}),path);
      await page.waitForFunction(count=>document.querySelectorAll('#timescale-workspace .ts-decisions fieldset').length===count,comparison.changes.length);
      const actual=await area.locator('fieldset').evaluateAll(fields=>fields.map(field=>({
        key:field.dataset.key,...JSON.parse(field.querySelector('pre').textContent)
      })));
      equal(actual,comparison.changes.map(change=>({key:change.key,identity:change.identity,fields:change.fields})),'TIMESCALE_BROWSER_COMPARISON_INCOMPLETE');
      return {before:comparison.before,after:comparison.after,digest:comparison.digest,changes:actual.length};
    });
    await phase('original-plans-and-native-result',async()=>{
      const plans=[];
      for(const[name,kind]of [['prepare-second','refresh'],['prepare-job','job'],['select','projection']]){
        const expected=resultOf(original,name);
        await page.locator('#ts-plan').selectOption(expected.planId);
        const plan=await clickRead(page.locator('#ts-open-plan'),'/api/timescale/plan?id='+encodeURIComponent(expected.planId));
        requireValue(plan.id===expected.planId&&plan.digest===expected.digest&&plan.kind===kind,'TIMESCALE_BROWSER_PLAN_CHANGED');
        plans.push({id:plan.id,kind:plan.kind,digest:plan.digest});
      }
      const operationId=original.requestIds['second-verify'];
      const link=page.locator('#timescale-workspace a[href="/api/timescale/record?operation='+operationId+'"]');
      const operation=await clickRead(link.locator('..').getByRole('button',{name:'Open',exact:true}),'/api/timescale/operation?id='+encodeURIComponent(operationId));
      requireValue(operation.state==='COMPLETE'&&operation.data.result.matches===true,'TIMESCALE_BROWSER_NATIVE_VERIFICATION_CHANGED');
      await shownOperation(operationId);
      const reference=operation.data.result.native;
      const downloaded=await keepDownload(()=>link.click(),reference.sha256+'.json',{bytes:reference.bytes,sha256:reference.sha256});
      return {plans,operationId,nativeResult:downloaded,counts:operation.data.result.counts};
    });
    await phase('original-published-customer-output',async()=>{
      const runButtons=page.locator('#runs button');
      requireValue(await runButtons.count()===1,'TIMESCALE_BROWSER_ORIGINAL_RUN_LIST_CHANGED');
      const detail=await clickRead(runButtons.first(),'/api/run?id='+encodeURIComponent(extraction.runId));
      requireValue(detail.run.id===extraction.runId&&detail.run.state==='PUBLISHED','TIMESCALE_BROWSER_PUBLICATION_CHANGED');
      await page.locator('#preview-query').fill('limit=50');
      const preview=await clickRead(page.locator('#preview-form button[type=submit]'),'/api/run?id='+encodeURIComponent(extraction.runId)+'&query='+encodeURIComponent('limit=50'));
      equal(preview.preview,customer.completeCustomerPage,'TIMESCALE_BROWSER_CUSTOMER_OUTPUT_CHANGED');
      await page.waitForFunction(()=>document.querySelector('#run-state')?.textContent==='published');
      const rendered=await tableRows(page.locator('#preview'));
      const expected=customer.completeCustomerPage.rows.map(row=>customer.completeCustomerPage.fields.map(name=>row[name]===null?'NULL':String(row[name])));
      equal(rendered,expected,'TIMESCALE_BROWSER_CUSTOMER_DISPLAY_CHANGED');
      requireValue(rendered.some(row=>row.includes('9007199254740996.50')),'TIMESCALE_BROWSER_EXACT_DECIMAL_CHANGED');
      return {runId:extraction.runId,state:preview.run.state,publication:preview.run.data.publication,completeCustomerPage:preview.preview,renderedRows:rendered.length};
    });
    await phase('browser-export-and-reopen',async()=>{
      if(record.export.request){
        const saved=await clientState()??{};
        saved.pending={path:'export',input:record.export.request};saved.lastOperation=record.export.request.requestId;
        await page.evaluate(({key,value})=>sessionStorage.setItem(key,JSON.stringify(value)),{key:storageKey,value:saved});
        await page.reload({waitUntil:'domcontentloaded'});await ready();
        const retained=await read('/api/timescale/operation?id='+encodeURIComponent(record.export.request.requestId),true);
        if(retained?.state!=='COMPLETE'){
          const responsePromise=page.waitForResponse(response=>response.url()===origin+'/api/timescale/export'&&response.request().method()==='POST');
          await page.locator('#ts-continue').click();
          const response=await responsePromise;requireValue(response.status()===202,'TIMESCALE_BROWSER_EXPORT_FAILED');
        }
      }else{
        await page.locator('#ts-output').fill(record.export.directory);
        const responsePromise=page.waitForResponse(response=>response.url()===origin+'/api/timescale/export'&&response.request().method()==='POST');
        await page.locator('#ts-export button[type=submit]').click();
        const response=await responsePromise;
        if(routeFailure)throw routeFailure;
        requireValue(response.status()===202,'TIMESCALE_BROWSER_EXPORT_FAILED');
      }
      requireValue(record.export.request,'TIMESCALE_BROWSER_EXPORT_ID_MISSING');
      const operation=await shownOperation(record.export.request.requestId);
      requireValue(operation.state==='COMPLETE','TIMESCALE_BROWSER_EXPORT_INCOMPLETE');
      record.export.operation=operation;await save();
      const inspected=await inspectTimescalePackage(operation.data.result.directory,operation.data.result.manifestDigest);
      requireValue(inspected.workspaceId===binding.workspaceId,'TIMESCALE_BROWSER_EXPORT_WORKSPACE_CHANGED');
      // Exercise persistence with an actual unsaved column selection, then restore all
      // original publication columns before leaving this same operator page.
      const total=page.locator('#ts-window .ts-checks input[value="total"]');
      await total.uncheck();
      const saved=await clientState();
      record.clientState=saved;await save();
      await page.reload({waitUntil:'domcontentloaded'});await ready();
      const reopened=await clientState();
      for(const key of ['aggregate','time-column','time-type','start','end','timezone','title','owner','note','table','search','before','after','plan','output'])
        equal(reopened.fields[key],saved.fields[key],'TIMESCALE_BROWSER_CLIENT_STATE_CHANGED');
      equal(reopened.columns,saved.columns,'TIMESCALE_BROWSER_COLUMN_SELECTION_CHANGED');
      requireValue(!await total.isChecked(),'TIMESCALE_BROWSER_COLUMN_SELECTION_LOST');
      const area=page.locator('#timescale-workspace > details').filter({has:page.locator('#ts-table')});
      const table=afterEdition.value.tables[saved.fields.table.value],needle=saved.fields.search.value.toLocaleLowerCase();
      const expected=table.rows.filter(row=>!needle||row.some(value=>value!==null&&String(value).toLocaleLowerCase().includes(needle)))
        .slice(saved.tableOffset,saved.tableOffset+40).map(row=>row.map(value=>value===null?'NULL':String(value)));
      equal(await tableRows(area),expected,'TIMESCALE_BROWSER_REOPENED_TABLE_INCOMPLETE');
      await total.check();record.clientState=await clientState();await save();
      const final=await read('/api/timescale/status?limit=100');
      requireValue(final.id===binding.workspaceId&&final.editions.total===2&&!final.active,'TIMESCALE_BROWSER_ORIGINAL_WORKSPACE_CHANGED');
      return {requestId:operation.id,workspaceId:inspected.workspaceId,manifestDigest:inspected.manifestDigest,
        packageDirectory:inspected.directory,files:inspected.files,bytes:inspected.bytes,restoredColumns:record.clientState.columns,
        reopenedEdition:reopened.editionId,reopenedPlan:reopened.planId,originalEditions:final.editions.total};
    });
    requireValue(mutations.every(item=>item.method==='POST'&&item.path==='/api/timescale/export'),'TIMESCALE_BROWSER_UNEXPECTED_MUTATION');
    requireValue(errors.length===0,'TIMESCALE_BROWSER_PAGE_ERRORS');
    if(routeFailure)throw routeFailure;
    // A failed optional image does not relabel successful native/browser work.
    try{
      const path=join(outputDirectory,'timescale-operator.png');
      await page.locator('#timescale-workspace').scrollIntoViewIfNeeded();
      await page.screenshot({path,fullPage:false});await chmod(path,0o600);
      const file=await hashPrivate(path,MAX_RECORD);record.image={path,bytes:file.bytes,sha256:file.hash};
    }catch(error){record.image={saved:false,error:{code:error.code??'TIMESCALE_BROWSER_IMAGE_UNAVAILABLE'}};}
    record.complete=true;record.completedAt=stamp();record.pageErrors=errors;record.httpFailures=httpFailures;record.mutations=mutations;
    record.clientState=await clientState();await save();
    return {complete:true,record:recordPath,workspaceId:binding.workspaceId,browserVersion:record.browserVersion,
      export:record.export.operation.data.result,downloads:record.downloads.length};
  }catch(error){
    if(record){record.complete=false;record.failedAt=stamp();record.error={code:error.code??'TIMESCALE_BROWSER_RECEIVING_FAILED',message:error.message};
      record.pageErrors=errors;record.httpFailures=httpFailures;record.mutations=mutations;await save().catch(()=>{});}
    throw error;
  }finally{
    await saveQueue.catch(()=>{});
    try{await context?.close();}finally{try{await browser?.close();}finally{await release();}}
  }
}
async function main(argv=process.argv.slice(2)){
  const values={};
  while(argv.length){const key=argv.shift(),value=argv.shift();
    if(!['--url','--native-result','--directory','--playwright','--chromium'].includes(key)||!value||values[key])throw fault('TIMESCALE_BROWSER_USAGE');
    values[key]=value;
  }
  for(const key of ['--url','--native-result','--directory','--playwright','--chromium'])if(!values[key])throw fault('TIMESCALE_BROWSER_USAGE');
  const result=await runTimescaleBrowserReceiving({url:values['--url'],nativeResult:values['--native-result'],
    outputDirectory:values['--directory'],playwright:values['--playwright'],chromium:values['--chromium']});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
export { runTimescaleBrowserReceiving, main };
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'TIMESCALE_BROWSER_RECEIVING_FAILED'})+'\n');process.exitCode=1;});
