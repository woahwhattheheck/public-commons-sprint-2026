// Whole original EPA_ECHO operator workflow; run inside the retained native customer operation.
import {readFile,writeFile,mkdir,rename,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.EPA_ECHO_PLAYWRIGHT_MODULE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const hash=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const present=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function save(file,value){
 const tmp=file+'.next',f=await open(tmp,'w',0o600);
 try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
 await rename(tmp,file);
}
export async function createEchoBrowser({getServer,sourceCommit,sourcePackageFile,artifactDirectory,facilityIds}){
 await mkdir(artifactDirectory,{recursive:true,mode:0o700});
 const temporary=join(artifactDirectory,'runtime-tmp');await mkdir(temporary,{recursive:true,mode:0o700});
 const journalFile=join(artifactDirectory,'journal.json'),journal=await present(journalFile)??{
  schema:'stellar-forge.epa-echo-operating-browser.v1',sourceCommit,steps:[],files:[],errors:[],startedAt:new Date().toISOString()
 };
 need(journal.sourceCommit===sourceCommit,'Continue the same reviewed EPA ECHO source selection.');
 need(Array.isArray(facilityIds)&&facilityIds.length===4&&new Set(facilityIds).size===4,'Use the four original selected FRS identities.');
 const checkpoint=async(name,detail={})=>{journal.steps.push({name,...detail,at:new Date().toISOString()});await save(journalFile,journal);process.stdout.write(JSON.stringify({phase:name,...detail})+'\n');};
 const environment={...process.env,TMPDIR:temporary};
 delete environment.SCF_ROUTESCAN_BUYER_SECRET;delete environment.SCF_ROUTESCAN_FEE_SECRET;
 const browser=await chromium.launch({
  executablePath:process.env.EPA_ECHO_CHROMIUM_EXECUTABLE??'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
  headless:true,env:environment,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--renderer-process-limit=1']
 });
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>journal.errors.push({message:e.message,at:new Date().toISOString()}));
 const settled=()=>page.waitForFunction(()=>typeof S!=='undefined'&&S.schema&&S.view&&!S.refreshing&&!S.operationBusy&&!S.modal?.busy);
 const current=()=>page.evaluate(async()=>{const r=await fetch('/api/view',{headers:{authorization:'Bearer '+sessionStorage.getItem('epa-echo:session:'+location.origin)},cache:'no-store'});if(!r.ok)throw Error('Original workspace view '+r.status);return r.json();});
 const nav=async section=>{await page.locator('nav [data-view="'+section+'"]').click();await settled();};
 const refresh=async()=>{await page.locator('#refresh').click();await settled();return current();};
 async function openCurrent(){
  await page.goto(getServer().url);await settled();const view=await current();
  if(journal.workspaceId)need(view.workspaceId===journal.workspaceId,'Reopen the same original EPA_ECHO workspace.');
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
  return server.app.action({action,payload,expectedRevision:view.revision,operationId:'epa-echo-native-browser-'+name});
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

 async function prepareDataset(table,name){
  let view=await refresh(),dataset=view.datasets.find(d=>d.editionId===journal.editionId&&d.table===table);
  if(!dataset){
   await nav('publishing');await form('dataset.prepare');await fill('editionId',journal.editionId);await fill('table',table);await fill('name',name);
   dataset=(await submit('dataset.prepare')).result;
  }
  need(typeof dataset.id==='string'&&typeof dataset.snapshot==='string','Retain the original '+table+' dataset identity.');
  journal.datasets??={};journal.datasets[table]={id:dataset.id,snapshot:dataset.snapshot,rows:dataset.rows};await save(journalFile,journal);
  return dataset;
 }
 async function queryDataset(dataset,query){
  await nav('publishing');await form('dataset.query',{id:dataset.id});await fill('query',query);
  return (await submit('dataset.query')).result;
 }
 async function originalSource(){
  let view=await openCurrent();
  if(!journal.portfolioId){
   let item=view.portfolios.find(p=>p.label==='District wastewater facility portfolio');
   if(!item){
    await nav('portfolio');await form('portfolio.save');
    for(const [name,value]of Object.entries({label:'District wastewater facility portfolio',customer:'Water infrastructure source review',
      owner:'Facility programme team',facilityIds:facilityIds.join('\n'),
      note:'Retain the four original DC NAICS 221320 facility identities. Review original EPA permits, programme-specific reporting periods, inspections and enforcement fields before a staff handover.'}))await fill(name,value);
    item=(await submit('portfolio.save')).result;
   }
   need(JSON.stringify(item.facilityIds)===JSON.stringify(facilityIds),'The saved portfolio must preserve the original ordered FRS selection.');
   journal.portfolioId=item.id;await save(journalFile,journal);
  }
  if(journal.lostImport&&!journal.lostImportRecovered){
   const request={...journal.lostImport.request,payload:{...journal.lostImport.request.payload,bundle:JSON.parse(await readFile(sourcePackageFile,'utf8'))}};
   const recovered=await getServer().app.action(request);
   need(recovered.reused===true,'Recover the original source-import operation after a disconnected operating process.');
   journal.captureId=recovered.result.captureId;journal.lostImportRecovered=true;await save(journalFile,journal);
  }
  view=await refresh();
  if(!journal.captureId){
   const existing=view.captures.find(c=>(c.portfolio?.id??c.portfolioId??c.portfolio)===journal.portfolioId&&c.label==='Original EPA reports — 2026-10-12');
   if(existing)journal.captureId=existing.id;
   else{
    await nav('captures');await form('capture.import');await fill('portfolioId',journal.portfolioId);await fill('label','Original EPA reports — 2026-10-12');await page.locator('#f-file').setInputFiles(sourcePackageFile);
    let dropped=false;
    const routeHandler=async route=>{
     const request=route.request().postDataJSON();
     if(!dropped&&request?.action==='capture.import'){
      dropped=true;const response=await route.fetch(),body=await response.json();
      need(response.ok(),'The original EPA import must save before its selected reply interruption.');
      const {bundle,...payload}=request.payload;
      journal.lostImport={request:{...request,payload},result:body.result};await save(journalFile,journal);await route.abort('failed');
     }else await route.continue();
    };
    await page.route('**/api/action',routeHandler);
    await page.locator('#operation-form button[type="submit"]').click();
    await page.waitForFunction(()=>S.modal&&!S.modal.busy&&document.getElementById('dialog-error').textContent.length>0);
    await page.unroute('**/api/action',routeHandler);
    const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(storageKey+'dialog')));
    need(draft.workspaceId===journal.workspaceId&&draft.pending.operationId===journal.lostImport.request.operationId&&
      !Object.hasOwn(draft.pending.payload,'bundle')&&JSON.stringify(draft).length<4096&&/^[0-9a-f]{64}$/.test(draft.sourcePackage.sha256),
      'Retain the exact original operation and compact source fingerprint before reloading.');
    await page.reload();await settled();await page.locator('[data-op="restore-form"]').click();await page.locator('#dialog[open]').waitFor();
    need(await page.locator('#f-label').inputValue()==='Original EPA reports — 2026-10-12','Retain the full original source label.');
    await page.locator('#f-file').setInputFiles(sourcePackageFile);
    const recovered=await submit('capture.import');
    need(recovered.reused===true&&recovered.operationId===journal.lostImport.request.operationId,'The same source must recover the exact original import.');
    journal.captureId=recovered.result.captureId;journal.lostImportRecovered=true;
    await checkpoint('ORIGINAL_SOURCE_IMPORT_RECOVERED',{operationId:recovered.operationId,captureId:journal.captureId,retainedDraftBytes:Buffer.byteLength(JSON.stringify(draft))});
   }
   await save(journalFile,journal);
  }
  await getServer().app.waitForCaptures();view=await refresh();
  const capture=view.captures.find(c=>c.id===journal.captureId);
  need(capture?.state==='COMPLETE','The complete original EPA source capture must finish: '+JSON.stringify(capture?.error));
  journal.editionId=capture.editionId;
  if(view.selectedEditionId!==journal.editionId)await direct('select-original','edition.select',{editionId:journal.editionId});
  view=await refresh();const edition=view.selectedEdition;
  need(edition.complete&&(edition.pageCount??edition.pages.length)===8,'Retain all eight original source responses.');
  const actualIds=edition.selection?.facilityIds??edition.portfolio?.facilityIds??edition.facilitySummaries?.map(f=>f.facilityId);
  need(JSON.stringify(actualIds)===JSON.stringify(facilityIds),'The report edition must contain the exact selected four FRS identities.');
  const schema=await getServer().app.schema();need(schema.tables.length===8,'Use all eight declared original EPA tables.');
  journal.counts={};
  const expectedCounts={facilities:4,permits:25,compliance:10,quarters:4836,inspections:54,enforcement:8,metadata:6624,'source-fields':9300};
  await nav('facilities');
  for(const definition of schema.tables){
   await page.locator('#f-report-table').selectOption(definition.id);
   await page.waitForFunction(t=>S.rows?.table===t&&S.rows?.editionId===S.view.selectedEditionId,definition.id);
   let rows=await page.evaluate(()=>S.rows);journal.counts[definition.id]=rows.total;
   need(rows.total===expectedCounts[definition.id],'Preserve the complete original source count for '+definition.id);
   need(JSON.stringify(rows.columns)===JSON.stringify(definition.columns),'The original table columns must match its source descriptor: '+definition.id);
   const full=await getServer().app.rows(edition.id,{table:definition.id,offset:0,limit:250000}),received=full.rows;
   need(full.total===rows.total&&received.length===rows.total&&JSON.stringify(received.slice(0,rows.rows.length))===JSON.stringify(rows.rows),'Read the complete original table and the displayed first page in '+definition.id);
   if(rows.total>100){
    await page.locator('[data-op="next-rows"]').click();await page.waitForFunction(()=>S.rows?.offset===100);rows=await page.evaluate(()=>S.rows);
    need(JSON.stringify(rows.rows)===JSON.stringify(received.slice(100,200)),'The original table browser must advance by its retained page offset.');
   }
   if(definition.id==='facilities')need(received.length===4&&new Set(received.map(r=>r.facilityId)).size===4,'Use the four complete selected facility rows.');
   if(definition.id==='permits')need(received.filter(r=>!r.statute).length>0,'Retain original FRS/ICIS rows with an empty statute.');
   if(definition.id==='compliance')journal.isoExample=received.find(r=>r.periodEndIso)?.periodEndIso??null;
   if(definition.id==='permits')journal.permitExample=received.find(r=>r.facilityId===facilityIds[0])??received[0];
   await save(join(artifactDirectory,'Original_'+definition.id+'.json'),rows.total?{editionId:edition.id,columns:definition.columns,rows:received}:rows);
   await layout('desktop-table-'+definition.id,{capture:['facilities','compliance'].includes(definition.id)});
  }
  await page.locator('#f-report-table').selectOption('facilities');await page.waitForFunction(()=>S.rows?.table==='facilities');
  for(const facilityId of facilityIds){
   await page.locator('[data-op="facility-detail"][data-id="'+facilityId+'"]').first().click();await page.locator('#source-dialog[open]').waitFor();
   const detail=await getServer().app.facility(edition.id,facilityId);
   need(detail.facilityId===facilityId&&detail.editionId===edition.id&&detail.report&&Array.isArray(detail.report.Permits),
     'Read the complete original facility report '+facilityId);
   const file=await download(page.locator('#source-downloads [data-op="download"]').first(),'Original_Facility_'+facilityId+'.json');
   const saved=JSON.parse(await readFile(file.path,'utf8'));
   need(JSON.stringify(saved.report)===JSON.stringify(detail.report),'Browser facility download must preserve the full original decoded report.');
   await page.locator('#source-close').click();
  }
  for(let index=0;index<edition.pages.length;index++){
   const source=edition.pages[index],raw=await getServer().app.raw(edition.id,index,{wire:false});
   const nativeBytes=Buffer.isBuffer(raw)?raw:raw.bytes;
   need(Buffer.isBuffer(nativeBytes)&&hash(nativeBytes)===source.sha256,'Read the exact original body bytes for page '+index);
  }
  await page.locator('[data-op="source"]').first().click();await page.locator('#source-dialog[open]').waitFor();
  await download(page.locator('#source-downloads [data-op="raw-download"]').first(),'Original_EPA_Response.json');await page.locator('#source-close').click();
  await nav('portfolio');view=await refresh();
  const originalSearch=view.searches.find(s=>s.imported&&s.sourceCaptureId===journal.captureId&&s.state==='COMPLETE');
  need(originalSearch,'The original imported facility query must remain an operable saved search.');
  journal.searchId=originalSearch.id;await save(journalFile,journal);
  await page.locator('[data-op="search-open"][data-id="'+originalSearch.id+'"]').click();
  await page.waitForFunction(id=>S.searchPage?.search?.id===id,journal.searchId);
  const searchRows=await page.evaluate(()=>S.searchPage);
  need(searchRows.total===4&&searchRows.rows.length===4&&new Set(searchRows.rows.map(r=>r.facilityId)).size===4,'Read all four original imported search rows.');
  await checkpoint('ALL_ORIGINAL_REPORTS_AND_TABLES_OPENED',{portfolioId:journal.portfolioId,editionId:edition.id,facilityIds,counts:journal.counts,pages:edition.pages.length});

  await nav('reviews');view=await current();
  if(!journal.reviewId){
   let review=view.reviews.find(r=>r.subject==='Programme reporting periods');
   if(!review){
    await form('review.save');
    for(const [name,value]of Object.entries({portfolioId:journal.portfolioId,editionId:journal.editionId,facilityId:facilityIds[0],subject:'Programme reporting periods',
      note:'Review each original statute and SourceID against its own reporting period. Preserve blank statute crossreferences and contextual map neighbours separately from the selected facilities.',
      owner:'Facility programme team',dueDate:'2026-10-19',status:'follow_up'}))await fill(name,value);
    review=(await submit('review.save')).result;
   }
   journal.reviewId=review.id;await save(journalFile,journal);
  }
  if(!journal.reviewUpdated){
   await form('review.save',{id:journal.reviewId});await fill('status','reviewed');
   await fill('note','Reviewed the four original DFRs and all eight tables. Programme histories retain their own source periods and extract dates; the original raw dates and valid date-only ISO columns are available side by side.');
   await submit('review.save');journal.reviewUpdated=true;await save(journalFile,journal);
  }
  view=await refresh();const review=view.reviews.find(r=>r.id===journal.reviewId);
  need(review.owner==='Facility programme team'&&review.dueDate==='2026-10-19'&&review.status==='reviewed'&&review.history.length>=1,'Preserve the original staff review, owner, due date and change history.');
  if(!journal.conflictReviewed){
   await form('review.save');await fill('portfolioId',journal.portfolioId);await fill('editionId',journal.editionId);
   const draft='Carry the original source edition, reporting periods and complete customer files into the staff handover.';
   await fill('subject','Portfolio handover');await fill('owner','Receiving operator');await fill('dueDate','2026-10-20');await fill('note',draft);
   await direct('concurrent-source-review','review.save',{portfolioId:journal.portfolioId,editionId:journal.editionId,subject:'Original source scope',note:'All four requested FRS report identities remain selected; related map points stay contextual.',status:'reviewed',owner:'Source reviewer',dueDate:'2026-10-19'});
   await submit('review.save',{status:409});need(await page.locator('#f-note').inputValue()===draft,'Keep the entered staff draft after a peer changes the workspace.');
   await page.locator('#review-latest').click();await page.locator('#adopt-latest:not([disabled])').waitFor();await page.locator('#adopt-latest').click();await submit('review.save');
   journal.conflictReviewed=true;await checkpoint('STAFF_HISTORY_AND_CONCURRENT_DRAFT_COMPLETED',{reviewId:journal.reviewId});
  }
  for(const [format,name]of [['source-package','Original_EPA_Source_Package.json'],['json','Original_EPA_Edition.json'],['csv','Original_EPA_Facilities.csv'],['report','EPA_Facility_Portfolio_Review.html']]){
   await nav('receiving');view=await current();let item=view.exports.find(x=>x.editionId===journal.editionId&&x.format===format&&x.table==='facilities');
   if(!item){await form('export.create');await fill('editionId',journal.editionId);await fill('table','facilities');await fill('format',format);item=(await submit('export.create')).result;}
   await nav('receiving');const file=await download(page.locator('[data-op="download"][data-url="'+item.downloadUrl+'"]').first(),name);
   need(file.bytes===item.bytes&&file.sha256===item.sha256,'Download the exact saved '+format+' edition export.');
   if(format==='source-package'){journal.portableSourceFile=file.path;journal.sourceExportId=item.id;await save(journalFile,journal);}
  }
  if(!journal.portableCaptureId){
   await nav('captures');await form('capture.import');await fill('portfolioId',journal.portfolioId);await fill('label','Reopened original EPA source handover');
   await page.locator('#f-file').setInputFiles(journal.portableSourceFile);
   journal.portableCaptureId=(await submit('capture.import')).result.captureId;await save(journalFile,journal);
  }
  await getServer().app.waitForCaptures();view=await refresh();const reopened=view.captures.find(c=>c.id===journal.portableCaptureId);
  need(reopened?.state==='COMPLETE','The full original exported EPA source package must reimport completely.');
  journal.portableEditionId=reopened.editionId;await save(journalFile,journal);
  if(!journal.portableCompared){
   for(const table of schema.tables.map(t=>t.id)){
    await nav('editions');await form('edition.compare');await fill('leftId',journal.editionId);await fill('rightId',journal.portableEditionId);await fill('table',table);
    const compared=(await submit('edition.compare')).result,count=v=>Array.isArray(v)?v.length:Number(v??0);
    need(count(compared.added)===0&&count(compared.removed)===0&&count(compared.changed)===0,'The two complete retained-source editions must have zero source changes in '+table);
   }
   journal.portableCompared=true;await checkpoint('TWO_COMPLETE_SOURCE_EDITIONS_COMPARED',{original:journal.editionId,reopened:journal.portableEditionId,tables:8});
  }
  await direct('select-publication','edition.select',{editionId:journal.editionId});await refresh();
  const dataset=await prepareDataset('facilities','District wastewater facilities — original EPA reports');
  need(dataset.rows===4,'Publish the four original facility records.');
  const first=await queryDataset(dataset,'limit=2&sort=facilityId&fields=facilityId,facilityName,state,permitCount,programmes');
  need(first.page.total===4&&first.page.returned===2&&first.page.nextCursor,'Read the first original two-row dataset page.');
  const second=(await actionResponse('dataset.query',()=>page.locator('[data-op="query-next"]').click())).result;
  need(second.page.returned===2&&second.page.nextCursor===null,'Read the final original facility page.');
  const permits=await prepareDataset('permits','Original EPA programme and permit records');
  const permitQuery=new URLSearchParams({limit:'100',where_facilityId:facilityIds[0],fields:'facilityId,statute,sourceId,expirationDate,expirationDateIso'});
  const permitResult=await queryDataset(permits,permitQuery.toString());
  need(permitResult.rows.every(r=>r.facilityId===facilityIds[0]),'The original permit equality filter must retain the selected FRS identifier.');
  const compliance=await prepareDataset('compliance','Original EPA programme reporting periods');
  need(journal.isoExample,'The original reports must supply a valid source reporting date.');
  const isoQuery=new URLSearchParams({limit:'100',gte_periodEndIso:journal.isoExample,sort:'periodEndIso',fields:'facilityId,statute,sourceId,periodEnd,periodEndIso,currentAsOf,currentAsOfIso'});
  const periodResult=await queryDataset(compliance,isoQuery.toString());
  need(periodResult.rows.length>0&&periodResult.rows.every(r=>r.periodEndIso>=journal.isoExample),'Query the original source periods by their exact ISO date columns.');
  journal.datasetId=dataset.id;journal.snapshot=dataset.snapshot;await save(journalFile,journal);
  await checkpoint('ORIGINAL_DATASET_QUERY_AND_CURSOR_COMPLETE',{datasets:journal.datasets,customerRows:4,customerPages:2,periodThreshold:journal.isoExample});
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:width===390?844:900});
   for(const section of ['portfolio','captures','facilities','editions','reviews','publishing','receiving']){
    await nav(section);await layout((width===390?'mobile-':'desktop-')+section,{capture:['portfolio','facilities','publishing','receiving'].includes(section)});
   }
  }
  await page.setViewportSize({width:1280,height:900});await save(journalFile,journal);
  return {workspaceId:journal.workspaceId,portfolioId:journal.portfolioId,editionId:journal.editionId,datasetId:dataset.id,snapshot:dataset.snapshot,rows:4,sourcePackageFile:journal.portableSourceFile};
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
  need(started.publisher.releases.runtime.state==='RUNNING','The original EPA ECHO publisher must be running.');
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
  journal.receiptId=receipt.id;await save(journalFile,journal);
  need(receipt.downloads.length===5&&receipt.dataset.rows===4&&JSON.stringify(receipt.intentIds)===JSON.stringify(intentIds),
    'Receive the five original files for four facilities in the original two-page order.');
  await nav('receiving');
  for(const item of receipt.downloads){
   const file=await download(page.locator('[data-op="download"][data-url="'+item.downloadUrl+'"]').first(),'Customer_'+item.name);
   need(file.bytes===item.bytes&&file.sha256===item.sha256,'Download the exact original customer '+item.name);
  }
  await layout('customer-receiving',{capture:true});
  await nav('portfolio');view=await current();const portfolio=view.portfolios.find(p=>p.id===journal.portfolioId);
  if(!journal.portfolioReopened){
   if(portfolio.active)await actionResponse('portfolio.archive',()=>page.locator('[data-op="archive-portfolio"][data-id="'+portfolio.id+'"]').click());
   await actionResponse('portfolio.save',()=>page.locator('[data-op="reopen-portfolio"][data-id="'+portfolio.id+'"]').click());
   journal.portfolioReopened=true;await save(journalFile,journal);
  }
  view=await refresh();need(view.portfolios.find(p=>p.id===portfolio.id)?.active===true,'Reopen the same original saved portfolio.');
  await checkpoint('ORIGINAL_CUSTOMER_RECEIVING_COMPLETE',{receiptId:receipt.id,rows:receipt.dataset.rows,intentIds:receipt.intentIds,files:receipt.downloads.map(x=>({name:x.name,bytes:x.bytes,sha256:x.sha256}))});
  return receipt;
 }
 async function portable(){
  await openCurrent();await nav('receiving');let view=await current();
  if(!journal.workspaceExportId){
   const response=await actionResponse('workspace.export',()=>page.locator('[data-op="workspace-export"]').click());
   journal.workspaceExportId=response.result.id;await save(journalFile,journal);
  }
  view=await refresh();const item=view.exports.find(x=>x.id===journal.workspaceExportId);
  need(item?.kind==='workspace','Retain the full original workspace export.');
  const file=await download(page.locator('[data-op="download"][data-url="'+item.downloadUrl+'"]').first(),'Original_EPA_Workspace.json');
  need(file.bytes===item.bytes&&file.sha256===item.sha256,'Download the exact complete portable workspace.');
  journal.workspacePackageFile=file.path;journal.workspacePackageSha256=file.sha256;await save(journalFile,journal);
  const bundle=JSON.parse(await readFile(file.path,'utf8'));
  need(bundle.schema==='stellar-forge.epa-echo-workspace-package.v1'&&bundle.state.workspaceId===journal.workspaceId&&
    bundle.state.reviews.some(r=>r.id===journal.reviewId)&&bundle.state.receipts.some(r=>r.id===journal.receiptId),
    'Carry the original reviews, customer receipt and workspace identity into the portable package.');
  if(journal.lostReceive&&!journal.receivedWorkspaceId){
   const recovered=await getServer().app.action({...journal.lostReceive.request,payload:{bundle}});
   need(recovered.reused===true,'Recover the original complete workspace receiving operation.');
   journal.receivedWorkspaceId=recovered.result.id;await save(journalFile,journal);
  }
  if(!journal.receivedWorkspaceId){
   await form('workspace.receive');await page.locator('#f-file').setInputFiles(file.path);
   let dropped=false;
   const routeHandler=async route=>{
    const request=route.request().postDataJSON();
    if(!dropped&&request?.action==='workspace.receive'){
     dropped=true;const response=await route.fetch(),body=await response.json();
     need(response.ok(),'Commit the original whole workspace before its reply is interrupted.');
     journal.lostReceive={request:{...request,payload:{}},result:body.result};await save(journalFile,journal);await route.abort('failed');
    }else await route.continue();
   };
   await page.route('**/api/action',routeHandler);await page.locator('#operation-form button[type="submit"]').click();
   await page.waitForFunction(()=>S.modal&&!S.modal.busy&&document.getElementById('dialog-error').textContent.length>0);await page.unroute('**/api/action',routeHandler);
   const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(storageKey+'dialog')));
   need(draft.pending.operationId===journal.lostReceive.request.operationId&&!Object.hasOwn(draft.pending.payload,'bundle')&&JSON.stringify(draft).length<4096,
     'Retain the exact original workspace receiving request compactly.');
   await page.reload();await settled();await page.locator('[data-op="restore-form"]').click();await page.locator('#dialog[open]').waitFor();
   await page.locator('#f-file').setInputFiles(file.path);
   const recovered=await submit('workspace.receive');
   need(recovered.reused===true&&recovered.operationId===journal.lostReceive.request.operationId,'Reselect and recover the same original portable workspace.');
   journal.receivedWorkspaceId=recovered.result.id;await save(journalFile,journal);
  }
  await nav('receiving');await page.locator('[data-op="received-open"][data-id="'+journal.receivedWorkspaceId+'"]').click();
  await page.waitForFunction(id=>S.received?.receipt?.id===id,journal.receivedWorkspaceId);
  const received=await page.evaluate(()=>S.received);
  need(received.readonly===true&&received.state.workspaceId===journal.workspaceId&&received.files.length===bundle.files.length&&
    received.editions.some(e=>e.id===journal.editionId)&&received.editions.some(e=>e.id===journal.portableEditionId),
    'Reopen the full selected original workspace and both complete source editions.');
  const inspectedKinds=new Set();
  for(const original of received.files){
   if(inspectedKinds.has(original.kind))continue;inspectedKinds.add(original.kind);
   const input=page.locator('#f-received-filter');await input.fill(original.path);
   await page.waitForTimeout(220);
   await page.locator('[data-op="received-file"][data-path="'+original.path+'"]').first().click();await page.locator('#source-dialog[open]').waitFor();
   const downloaded=await download(page.locator('#source-downloads [data-op="download"]').first(),'Received_'+inspectedKinds.size+'_'+original.path.split('/').at(-1));
   need(downloaded.bytes===original.bytes&&downloaded.sha256===original.sha256,'Download the manifest-selected original workspace file '+original.path);
   await page.locator('#source-close').click();
  }
  await page.locator('#f-received-filter').fill('');await page.waitForTimeout(220);
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:width===390?844:900});
   await layout(width===390?'mobile-complete-workspace':'desktop-complete-workspace',{capture:true});
  }
  await page.setViewportSize({width:1280,height:900});
  await checkpoint('COMPLETE_ORIGINAL_WORKSPACE_RECEIVED',{receivedWorkspaceId:journal.receivedWorkspaceId,
    originalWorkspaceId:journal.workspaceId,sourceRevision:received.receipt.sourceRevision,files:received.files.length,
    fileKinds:[...inspectedKinds],packageBytes:file.bytes,packageSha256:file.sha256,operationId:journal.lostReceive.request.operationId});
  return {receivedWorkspaceId:journal.receivedWorkspaceId,workspacePackageFile:file.path,originalReceiveRequest:journal.lostReceive.request};
 }
 async function reopened(){
  const view=await openCurrent();
  need(view.receipts.some(r=>r.id===journal.receiptId)&&view.datasets.some(d=>d.id===journal.datasetId&&d.snapshot===journal.snapshot)&&
    view.receivedWorkspaces.some(r=>r.id===journal.receivedWorkspaceId),'Reopen the same original merchant, customer and received workspace identities.');
  need(view.portfolios.find(p=>p.id===journal.portfolioId)?.active===true,'Reopen the original active facility portfolio.');
  const original=view.reviews.find(r=>r.id===journal.reviewId);
  need(original.owner==='Facility programme team'&&original.history.length>=1,'Retain the original review history after server restart.');
  await nav('receiving');await page.locator('[data-op="received-open"][data-id="'+journal.receivedWorkspaceId+'"]').click();
  await page.waitForFunction(id=>S.received?.receipt?.id===id,journal.receivedWorkspaceId);
  await layout('reopened-customer-workspace',{capture:true});
  await checkpoint('ORIGINAL_WORKSPACE_REOPENED',{workspaceId:view.workspaceId,revision:view.revision,editionId:journal.editionId,receiptId:journal.receiptId,receivedWorkspaceId:journal.receivedWorkspaceId});
  return view;
 }
 return {source:originalSource,publish,receive,portable,reopened,page,journal,
  async close(){
   journal.finishedAt=new Date().toISOString();journal.state=journal.receiptId&&journal.receivedWorkspaceId&&journal.steps.some(s=>s.name==='ORIGINAL_WORKSPACE_REOPENED')?'COMPLETE':'CONTINUABLE';
   await save(journalFile,journal);await browser.close();need(journal.errors.length===0,'The original EPA operator browser reported an application error.');
   return journal;
  }
 };
}
