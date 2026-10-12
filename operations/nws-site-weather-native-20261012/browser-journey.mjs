// Whole original NWS operator workflow; run inside the retained native customer operation.
import {readFile,writeFile,mkdir,rename,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.NWS_PLAYWRIGHT_MODULE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const present=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function save(file,value){
 const tmp=file+'.next',f=await open(tmp,'w',0o600);
 try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
 await rename(tmp,file);
}
export async function createNwsBrowser({getServer,sourceCommit,sourcePackageFile,artifactDirectory}){
 await mkdir(artifactDirectory,{recursive:true,mode:0o700});
 const temporary=join(artifactDirectory,'runtime-tmp');await mkdir(temporary,{recursive:true,mode:0o700});
 const journalFile=join(artifactDirectory,'journal.json'),journal=await present(journalFile)??{
  schema:'stellar-forge.nws-operating-browser.v1',sourceCommit,steps:[],files:[],errors:[],startedAt:new Date().toISOString()
 };
 need(journal.sourceCommit===sourceCommit,'Continue the same reviewed NWS source selection.');
 const checkpoint=async(name,detail={})=>{journal.steps.push({name,...detail,at:new Date().toISOString()});await save(journalFile,journal);process.stdout.write(JSON.stringify({phase:name,...detail})+'\n');};
 const environment={...process.env,TMPDIR:temporary};
 delete environment.SCF_ROUTESCAN_BUYER_SECRET;delete environment.SCF_ROUTESCAN_FEE_SECRET;
 const browser=await chromium.launch({
  executablePath:process.env.NWS_CHROMIUM_EXECUTABLE??'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
  headless:true,env:environment,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--renderer-process-limit=1']
 });
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>journal.errors.push({message:e.message,at:new Date().toISOString()}));
 const settled=()=>page.waitForFunction(()=>typeof S!=='undefined'&&S.schema&&S.view&&!S.refreshing&&!S.operationBusy&&!S.modal?.busy);
 const current=()=>page.evaluate(async()=>{const r=await fetch('/api/view',{headers:{authorization:'Bearer '+sessionStorage.getItem('nws:'+location.origin+':token')},cache:'no-store'});if(!r.ok)throw Error('Original workspace view '+r.status);return r.json();});
 const nav=async section=>{await page.locator('nav [data-view="'+section+'"]').click();await settled();};
 const refresh=async()=>{await page.locator('#refresh').click();await settled();return current();};
 async function openCurrent(){
  await page.goto(getServer().url);await settled();const view=await current();
  if(journal.workspaceId)need(view.workspaceId===journal.workspaceId,'Reopen the same original NWS workspace.');
  else{journal.workspaceId=view.workspaceId;await save(journalFile,journal);}
  return view;
 }
 async function form(kind,{id}={}){
  if(await page.locator('#dialog[open]').count())await page.locator('#dialog-close').click();
  const selector='[data-op="form"][data-kind="'+kind+'"]'+(id?'[data-id="'+id+'"]':'');
  await page.locator(selector).first().click();await page.locator('#dialog[open] #operation-form').waitFor();
 }
 const fill=async(name,value)=>{const control=page.locator('#f-'+name);const tag=await control.evaluate(n=>n.tagName);if(tag==='SELECT')await control.selectOption(String(value));else if(await control.getAttribute('type')==='checkbox')await control.setChecked(Boolean(value));else await control.fill(String(value));};
 async function actionResponse(action,click,{status=200}={}){
  const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/action'&&r.request().postDataJSON()?.action===action,{timeout:120000});
  await click();const response=await pending,body=await response.json();await settled();
  need(response.status()===status,action+' returned '+response.status()+': '+JSON.stringify(body));return body;
 }
 const submit=(action,options)=>actionResponse(action,()=>page.locator('#operation-form button[type="submit"]').click(),options);
 async function direct(name,action,payload){
  const server=getServer(),view=await server.app.view();
  return server.app.action({action,payload,expectedRevision:view.revision,operationId:'nws-native-browser-'+name});
 }
 async function download(button,name){
  const pending=page.waitForEvent('download');await button.click();const file=await pending,path=join(artifactDirectory,name);await file.saveAs(path);
  const bytes=await readFile(path),entry={name,path,bytes:bytes.length,sha256:hash(bytes)};
  const prior=journal.files.findIndex(x=>x.name===name);if(prior>=0)journal.files[prior]=entry;else journal.files.push(entry);await save(journalFile,journal);return entry;
 }
 async function layout(name,{capture=false}={}){
  const found=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth}));
  need(found.pageWidth<=found.width+1&&found.bodyWidth<=found.width+1,'Page overflow in '+name+': '+JSON.stringify(found));
  if(capture)await page.screenshot({path:join(artifactDirectory,name+'.png'),fullPage:true});
  await checkpoint('LAYOUT_'+name,found);
 }
 async function originalSource(){
  let view=await openCurrent();
  if(!journal.siteId){
   const existing=view.sites.find(s=>s.label==='Washington Monument operations');
   if(existing)journal.siteId=existing.id;
   else{
    await nav('portfolio');await form('site.save');
    for(const [name,value]of Object.entries({label:'Washington Monument operations',owner:'Field operations',latitude:38.8894,longitude:-77.0352,stationId:'KDCA',note:'Review the exact point mapping, selected station, observation interval and alert coverage before a site briefing.'}))await fill(name,value);
    const saved=await submit('site.save');journal.siteId=saved.result.id;
   }
   await save(journalFile,journal);
  }
  view=await refresh();
  if(journal.lostImport&&!journal.lostImportRecovered){
   const request={...journal.lostImport.request,payload:{...journal.lostImport.request.payload,bundle:JSON.parse(await readFile(sourcePackageFile,'utf8'))}};
   const recovered=await getServer().app.action(request);
   need(recovered.reused===true,'Recover the original source-import operation after an interrupted native run.');
   journal.captureId=recovered.result.captureId;journal.lostImportRecovered=true;await save(journalFile,journal);view=await refresh();
  }
  if(!journal.captureId){
   const existing=view.captures.find(c=>c.site.id===journal.siteId&&c.label==='Original NWS source — 2026-10-12');
   if(existing)journal.captureId=existing.id;
   else{
    await nav('captures');await form('capture.import');
    await fill('siteId',journal.siteId);await fill('label','Original NWS source — 2026-10-12');await page.locator('#f-file').setInputFiles(sourcePackageFile);
    let dropped=false;
    const routeHandler=async route=>{
     const request=route.request().postDataJSON();
     if(!dropped&&request?.action==='capture.import'){
      dropped=true;const response=await route.fetch(),body=await response.json();need(response.ok(),'The original source import must save before interrupting its reply.');
      const {bundle,...payload}=request.payload;
      journal.lostImport={request:{...request,payload},result:body.result};await save(journalFile,journal);await route.abort('failed');
     }else await route.continue();
    };
    await page.route('**/api/action',routeHandler);
    await page.locator('#operation-form button[type="submit"]').click();await page.waitForFunction(()=>S.modal&&!S.modal.busy&&document.getElementById('dialog-error').textContent.length>0);
    await page.unroute('**/api/action',routeHandler);
    const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('nws:'+location.origin+':dialog')));
    need(draft.pending.operationId===journal.lostImport.request.operationId&&!Object.hasOwn(draft.pending.payload,'bundle')&&JSON.stringify(draft).length<2048&&/^[0-9a-f]{64}$/.test(draft.sourcePackage.sha256),'Retain the original source action and compact source fingerprint across a lost reply.');
    await page.reload();await settled();await page.locator('[data-op="restore-form"]').click();await page.locator('#dialog[open]').waitFor();
    need(await page.locator('#f-label').inputValue()==='Original NWS source — 2026-10-12','Reload must retain the entered source label.');
    await page.locator('#f-file').setInputFiles(sourcePackageFile);
    const imported=await submit('capture.import');need(imported.reused===true&&imported.operationId===journal.lostImport.request.operationId,'Reselecting the same source package must recover the original import.');
    journal.captureId=imported.result.captureId;journal.lostImportRecovered=true;
    await checkpoint('ORIGINAL_SOURCE_IMPORT_RELOADED',{operationId:imported.operationId,captureId:journal.captureId,retainedFormBytes:Buffer.byteLength(JSON.stringify(draft)),sourcePackageSha256:draft.sourcePackage.sha256});
   }
   await save(journalFile,journal);
  }
  await getServer().app.waitForCaptures();view=await refresh();
  const capture=view.captures.find(c=>c.id===journal.captureId);
  need(capture?.state==='COMPLETE','The complete retained source capture must finish: '+JSON.stringify(capture?.error));
  journal.editionId=capture.editionId;
  if(view.selectedEditionId!==journal.editionId)await direct('select-original','edition.select',{editionId:journal.editionId});
  view=await refresh();const edition=view.selectedEdition;
  need(edition.complete&&edition.pageCount===10,'Retain the complete selected ten-response source edition.');
  const counts=Object.fromEntries(edition.summary.tables.map(t=>[t.id,t.rows]));
  need(counts.forecast===14&&counts.hourly===156&&counts.stations===54&&counts.alerts===3&&counts['active-alerts']===0,'Original source table counts differ.');
  need(Date.parse(edition.query.observationStart)===Date.parse('2026-10-12T03:45:00Z')&&Date.parse(edition.query.observationEnd)===Date.parse('2026-10-12T04:15:00Z'),'Use the original finite observation interval.');
  await checkpoint('ORIGINAL_SOURCE_EDITION_COMPLETE',{siteId:journal.siteId,captureId:capture.id,editionId:edition.id,pageCount:edition.pageCount,counts,station:edition.station?.id});
  await nav('weather');
  for(const table of ['forecast','hourly','grid','observations','latest','active-alerts','alerts','stations']){
   await page.locator('#f-weather-table').selectOption(table);
   await page.waitForFunction(t=>S.rows?.table===t&&S.rows?.editionId===S.view.selectedEditionId,table);
   const rows=await page.evaluate(()=>S.rows);
   need(rows.total===counts[table],table+' complete source count differs.');
   await layout('desktop-'+table,{capture:['forecast','observations'].includes(table)});
   if(rows.total>100){
    await page.locator('[data-op="next-rows"]').click();
    await page.waitForFunction(()=>S.rows?.offset===100);
    need((await page.evaluate(()=>S.rows)).offset===100,'Original weather table page did not advance.');
   }
  }
  await page.locator('#f-weather-table').selectOption('forecast');await page.waitForFunction(()=>S.rows?.table==='forecast');
  await page.locator('[data-op="source"]').first().click();await page.locator('#source-dialog[open]').waitFor();
  need((await page.locator('#source-body').innerText()).includes('properties'),'Read the actual original NWS response.');
  await download(page.locator('#source-downloads [data-op="raw-download"]').first(),'Original_NWS_Forecast_Response.json');
  await page.locator('#source-close').click();
  const subject='Observation interval and source coverage',note='Reviewed the original NWS point and KDCA station mapping. The selected observations cover 2026-10-12 03:45–04:15 UTC. The complete source package also retains the supplementary recent-observation response. Forecast, grid and alert fields remain in their original units and timestamps.';
  await nav('notes');view=await current();
  if(journal.lostNote&&!journal.lostNoteRecovered){
   const recovered=await getServer().app.action(journal.lostNote.request);
   need(recovered.reused===true,'Recover the original committed review operation.');
   journal.lostNoteRecovered=true;await save(journalFile,journal);await refresh();
  }
  if(!view.annotations.some(n=>n.editionId===journal.editionId&&n.subject===subject)){
   await form('annotation.save');await fill('editionId',journal.editionId);await fill('subject',subject);await fill('status','reviewed');await fill('note',note);
   let dropped=false;
   const routeHandler=async route=>{
    const request=route.request().postDataJSON();
    if(!dropped&&request?.action==='annotation.save'){
     dropped=true;const response=await route.fetch(),body=await response.json();need(response.ok(),'Original review must save before its response is interrupted.');
     journal.lostNote={request,result:body.result};await save(journalFile,journal);await route.abort('failed');
    }else await route.continue();
   };
   await page.route('**/api/action',routeHandler);
   await page.locator('#operation-form button[type="submit"]').click();await page.waitForFunction(()=>S.modal&&!S.modal.busy&&document.getElementById('dialog-error').textContent.length>0);
   await page.unroute('**/api/action',routeHandler);await page.reload();await settled();
   await page.locator('[data-op="restore-form"]').click();await page.locator('#dialog[open]').waitFor();
   need(await page.locator('#f-note').inputValue()===note,'Retain the complete operator draft across reload.');
   const recovered=await submit('annotation.save');need(recovered.reused===true,'The unchanged saved form must recover the same committed operation.');
   journal.lostNoteRecovered=true;await save(journalFile,journal);
  }
  view=await refresh();need(view.annotations.filter(n=>n.editionId===journal.editionId&&n.subject===subject).length===1,'The recovered review must remain one original note.');
  if(!journal.conflictReviewed){
   await nav('notes');await form('annotation.save');await fill('editionId',journal.editionId);
   await fill('subject','Shift briefing');await fill('status','follow_up');const draft='Carry the reviewed site edition into the next operations briefing. Recheck current active alerts before work begins.';await fill('note',draft);
   await direct('second-review','annotation.save',{editionId:journal.editionId,subject:'Source handover',note:'The retained source package includes the complete returned station catalog, raw grid intervals and original observation quality-control values.',status:'reviewed'});
   await submit('annotation.save',{status:409});
   need(await page.locator('#f-note').inputValue()===draft,'A concurrent workspace change must retain the entered review.');
   await page.locator('#review-latest').click();await page.locator('#adopt-latest:not([disabled])').waitFor();
   await page.locator('#adopt-latest').click();need(await page.locator('#f-note').inputValue()===draft,'Reviewing the latest workspace must retain the entered note.');
   await submit('annotation.save');journal.conflictReviewed=true;await checkpoint('CONCURRENT_REVIEW_DRAFT_RECOVERED');
  }
  for(const [format,name]of [['source-package','Original_NWS_Source_Package.json'],['csv','NWS_Forecast_Review.csv'],['report','NWS_Operations_Review.html']]){
   await nav('receiving');view=await current();let item=view.exports.find(x=>x.editionId===journal.editionId&&x.format===format&&x.table==='forecast');
   if(!item){await form('export.create');await fill('editionId',journal.editionId);await fill('table','forecast');await fill('format',format);item=(await submit('export.create')).result;}
   await nav('receiving');await download(page.locator('[data-op="download"][data-url="'+item.downloadUrl+'"]').first(),name);
   if(format==='source-package'){journal.portableSourceFile=join(artifactDirectory,name);journal.sourceExportId=item.id;await save(journalFile,journal);}
  }
  const portable=JSON.parse(await readFile(journal.portableSourceFile,'utf8'));
  need(portable.pages.length===11,'The portable source must preserve all ten selected responses and the supplementary original response.');
  if(!journal.portableCaptureId){
   await nav('captures');await form('capture.import');await fill('siteId',journal.siteId);await fill('label','Reopened complete source handover');
   await page.locator('#f-file').setInputFiles(journal.portableSourceFile);
   journal.portableCaptureId=(await submit('capture.import')).result.captureId;await save(journalFile,journal);
  }
  await getServer().app.waitForCaptures();view=await refresh();const imported=view.captures.find(c=>c.id===journal.portableCaptureId);
  need(imported?.state==='COMPLETE','The actual exported source package must reopen completely.');journal.portableEditionId=imported.editionId;
  if(!journal.portableCompared){
   await nav('editions');await form('edition.compare');await fill('leftId',journal.editionId);await fill('rightId',journal.portableEditionId);await fill('table','forecast');
   const compared=(await submit('edition.compare')).result;
   const count=value=>Array.isArray(value)?value.length:value??0;
   need(count(compared.added)===0&&count(compared.removed)===0&&count(compared.changed)===0,'Portable receiving must preserve the original forecast values.');
   journal.portableCompared=true;await checkpoint('SOURCE_HANDOVER_REOPENED_AND_COMPARED',{original:journal.editionId,reopened:journal.portableEditionId});
  }
  await direct('select-for-publication','edition.select',{editionId:journal.editionId});await refresh();await nav('publishing');
  view=await current();let dataset=view.datasets.find(d=>d.editionId===journal.editionId&&d.table==='forecast');
  if(!dataset){await form('dataset.prepare');await fill('editionId',journal.editionId);await fill('table','forecast');await fill('name','Washington Monument — original NWS forecast');dataset=(await submit('dataset.prepare')).result;}
  journal.datasetId=dataset.id;journal.snapshot=dataset.snapshot;need(dataset.rows===14&&dataset.columns.length===29,'Prepare all fourteen original forecast records and twenty-nine source columns.');await save(journalFile,journal);
  await nav('publishing');await form('dataset.query',{id:dataset.id});
  await fill('query','limit=7&where_table=forecast&sort=validFromUtc&fields=siteId,recordId,validFrom,validFromUtc,value,unitCode,detailsJson');
  const first=(await submit('dataset.query')).result;need(first.page.returned===7&&first.page.total===14&&first.page.nextCursor,'Use the original first dataset page and opaque continuation.');
  const second=await actionResponse('dataset.query',()=>page.locator('[data-op="query-next"]').click());
  need(second.result.page.returned===7&&second.result.page.nextCursor===null,'Read the complete original second dataset page.');
  await checkpoint('ORIGINAL_DATASET_AND_CURSOR_QUERY_COMPLETE',{datasetId:dataset.id,snapshot:dataset.snapshot,rows:dataset.rows,columns:dataset.columns.length});
  for(const section of ['portfolio','captures','weather','editions','notes','publishing','receiving']){
   await nav(section);await layout('desktop-'+section,{capture:['portfolio','publishing'].includes(section)});
  }
  await page.setViewportSize({width:390,height:844});
  for(const section of ['portfolio','captures','weather','editions','notes','publishing','receiving']){
   await nav(section);await layout('mobile-'+section,{capture:['portfolio','weather','receiving'].includes(section)});
  }
  await page.setViewportSize({width:1280,height:900});
  await save(journalFile,journal);return {workspaceId:journal.workspaceId,siteId:journal.siteId,editionId:journal.editionId,datasetId:dataset.id,snapshot:dataset.snapshot,rows:dataset.rows,sourcePackageFile:journal.portableSourceFile};
 }
 async function publish({origin,path,payment}){
  await openCurrent();await nav('publishing');let view=await current(),release=view.releases.find(r=>r.id===journal.releaseId)??view.releases.find(r=>r.datasetId===journal.datasetId);
  if(!release){
   await form('release.prepare',{id:journal.datasetId});await fill('datasetId',journal.datasetId);
   for(const [name,value]of Object.entries({origin,path,...payment}))await fill(name,value);
   release=(await submit('release.prepare')).result;
  }
  journal.releaseId=release.id;await save(journalFile,journal);need(release.mode==='NATIVE_X402','Prepare the original native payment release.');
  view=await refresh();let state=view.releases.find(r=>r.id===release.id);
  if(state.selection.active!==release.id){await form('release.activate',{id:release.id});await submit('release.activate');}
  await refresh();await form('release.start',{id:release.id});const started=(await submit('release.start')).result;
  need(started.publisher.releases.runtime.state==='RUNNING','The original NWS publisher must be running.');
  await checkpoint('ORIGINAL_RELEASE_OPERATED_IN_CONSOLE',{releaseId:release.id,snapshot:release.snapshot,generation:started.selection.generation});
  return {releaseId:release.id,listener:started.publisher.releases.runtime.observed.listener,publisher:started.publisher,selection:started.selection};
 }
 async function receive(intentIds){
  await openCurrent();await nav('receiving');let view=await current(),receipt=view.receipts.find(r=>JSON.stringify(r.intentIds)===JSON.stringify(intentIds));
  if(!receipt){
   await form('buyer.inspect');await fill('intentIds',intentIds.join('\n'));const inspected=(await submit('buyer.inspect')).result;
   need(inspected.items.length===intentIds.length,'Inspect every original buyer intent in page order.');
   await page.locator('[data-op="receive-selected"]').first().click();await page.locator('#dialog[open]').waitFor();
   receipt=(await submit('buyer.receive')).result;
  }
  journal.receiptId=receipt.id;await save(journalFile,journal);need(receipt.downloads.length===5,'Receive the five original SF88/SF100 customer files.');
  await nav('receiving');
  for(const item of receipt.downloads){
   const saved=await download(page.locator('[data-op="download"][data-url="'+item.downloadUrl+'"]').first(),'Customer_'+item.name);
   need(saved.bytes===item.bytes&&saved.sha256===item.sha256,'Download the exact original customer file '+item.name);
  }
  await layout('customer-receiving',{capture:true});
  await nav('portfolio');view=await current();const site=view.sites.find(s=>s.id===journal.siteId);
  if(site.active)await actionResponse('site.archive',()=>page.locator('[data-op="archive-site"][data-id="'+site.id+'"]').click());
  await actionResponse('site.save',()=>page.locator('[data-op="reopen-site"][data-id="'+site.id+'"]').click());
  view=await refresh();need(view.sites.find(s=>s.id===site.id)?.active===true&&view.sites.length===1,'Reopen the same archived site.');
  await checkpoint('ORIGINAL_CUSTOMER_RECEIVING_COMPLETE',{receiptId:receipt.id,files:receipt.downloads.map(x=>({name:x.name,bytes:x.bytes,sha256:x.sha256})),siteId:site.id});
  return receipt;
 }
 async function reopened(){
  const view=await openCurrent();
  need(view.receipts.some(r=>r.id===journal.receiptId)&&view.datasets.some(d=>d.id===journal.datasetId&&d.snapshot===journal.snapshot),'Retain original merchant and customer identities after close and reopen.');
  need(view.sites.find(s=>s.id===journal.siteId)?.active===true,'Reopen the original active site.');
  await nav('receiving');await layout('reopened-customer-receiving',{capture:true});
  await checkpoint('ORIGINAL_WORKSPACE_REOPENED',{workspaceId:view.workspaceId,revision:view.revision,editionId:journal.editionId,receiptId:journal.receiptId});
  return view;
 }
 return {source:originalSource,publish,receive,reopened,page,journal,
  async close(){
   journal.finishedAt=new Date().toISOString();journal.state=journal.receiptId&&journal.steps.some(s=>s.name==='ORIGINAL_WORKSPACE_REOPENED')?'COMPLETE':'CONTINUABLE';
   await save(journalFile,journal);await browser.close();need(journal.errors.length===0,'The original operator browser reported an application error.');
   return journal;
  }
 };
}
