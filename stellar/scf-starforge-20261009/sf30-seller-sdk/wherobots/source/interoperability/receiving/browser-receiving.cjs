'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{createRequire}=require('node:module'),assert=require('node:assert/strict');
const playwrightModules=process.env.PLAYWRIGHT_NODE_MODULES||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
const requireRuntime=createRequire(path.join(playwrightModules,'..','package.json'));
const {chromium}=requireRuntime('playwright');
const [source,out,python,chrome]=process.argv.slice(2);
if(!source||!out||!python||!chrome)throw Error('Pass original source, retained output, SDK Python and installed Chrome');
const result=JSON.parse(fs.readFileSync(path.join(out,'operation.json'),'utf8'));
const selectedSourceBytes=fs.readFileSync(path.join(out,'selected-source.json'));const selectedSource=JSON.parse(selectedSourceBytes);
const output=path.join(out,'browser');fs.mkdirSync(output,{recursive:true});
const priorResult=path.join(output,'browser-receiving.json');if(fs.existsSync(priorResult)){const history=path.join(output,'attempt-history');fs.mkdirSync(history,{recursive:true});const previous=fs.readFileSync(priorResult);fs.writeFileSync(path.join(history,crypto.createHash('sha256').update(previous).digest('hex')+'.json'),previous);}
const errors=[],resources=[],phases=[],downloads=[],allRows=[];
let browserInstance=null,currentServer=null;
const report={schema:'starforge.wherobots.browser-receiving.v1',sourceRevision:selectedSource.revision,sourceManifestSha256:sha(selectedSourceBytes),startedAt:new Date().toISOString(),originalResultSha256:sha(fs.readFileSync(path.join(out,'operation.json'))),source_workspace_id:result.source_workspace_id,customer_workspace_id:result.customer_workspace_id,workflow_id:result.workflow_id,phases,downloads,errors,resources};
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function save(name,value){const target=path.join(output,name);fs.writeFileSync(target+'.next',JSON.stringify(value,null,2)+'\n');fs.renameSync(target+'.next',target);}
function phase(name,details={}){phases.push({name,at:new Date().toISOString(),...details});save('browser-receiving.json',report);console.log(JSON.stringify({phase:name,...details}));}
function clean(value){return String(value).replace(/https?:\/\/[^\s]+/g,'[local address]');}
async function child(command,args,options={}){return await new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd:source,env:process.env,...options});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.once('error',reject);p.once('exit',(code,signal)=>{if(code!==0)reject(Error('Native child '+code+'/'+signal+': '+clean(stderr.slice(-2000))));else resolve(stdout);});});}
async function startServer(workspace){
 const p=spawn(python,['-u','-B',path.join(source,'operate.py'),'--workspace',workspace,'serve','--host','127.0.0.1','--port','0'],{cwd:source,env:process.env,stdio:['ignore','pipe','pipe']});
 let stderr='',buffer='';p.stderr.on('data',b=>stderr+=b);
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Original server startup did not return its address')),30000);
  p.once('error',e=>{clearTimeout(timer);reject(e);});
  p.once('exit',(code,signal)=>{clearTimeout(timer);reject(Error('Original server ended '+code+'/'+signal+': '+clean(stderr.slice(-1500))));});
  p.stdout.on('data',b=>{buffer+=b;for(const line of buffer.split('\n')){try{const v=JSON.parse(line);if(v.url){clearTimeout(timer);resolve(v);return;}}catch{}}});
 });
 currentServer={process:p,workspace,address:ready.url,workspace_id:ready.workspace_id};
 return currentServer;
}
async function stopServer(){
 const server=currentServer;if(!server)return;
 if(server.process.exitCode===null){server.process.kill('SIGINT');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{server.process.kill('SIGTERM');reject(Error('Original loopback server did not close promptly'));},15000);server.process.once('exit',()=>{clearTimeout(timer);resolve();});});}
 currentServer=null;
}
async function launch(width=1280){
 browserInstance=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--renderer-process-limit=1']});
 report.chromium=browserInstance.version();
 const context=await browserInstance.newContext({viewport:{width,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(clean(e.message)));
 page.on('response',r=>{if(r.status()>=400)resources.push({status:r.status(),path:new URL(r.url()).pathname});});
 page.on('requestfailed',r=>{const reason=r.failure()?.errorText;if(reason&&!reason.includes('ERR_ABORTED'))resources.push({path:new URL(r.url()).pathname,error:reason});});
 await page.goto(currentServer.address,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#connection')?.textContent.startsWith('Connected'));
 return page;
}
async function closeBrowser(){if(browserInstance){await browserInstance.close();browserInstance=null;}}
async function waitWorkflow(page){await page.locator('#content h2').filter({hasText:'GeoParquet source interoperability'}).waitFor();await page.getByRole('heading',{name:'Original source and transformation',exact:true}).waitFor();}
async function getJSON(page,route){return await page.evaluate(async route=>{const response=await fetch('/api/'+route);if(!response.ok)throw Error('Original read '+response.status);return await response.json();},route);}
async function originalDownload(page,link,name,expected){
 const pending=page.waitForEvent('download');await link.click();const item=await pending;
 const target=path.join(output,name);await item.saveAs(target);const bytes=fs.readFileSync(target),entry={name,bytes:bytes.length,sha256:sha(bytes),suggestedFilename:item.suggestedFilename()};
 if(expected){assert.equal(entry.bytes,expected.bytes,'Original downloaded length');assert.equal(entry.sha256,expected.sha256,'Original downloaded source hash');}
 downloads.push(entry);return target;
}
async function openEdition(page,id,dataset){
 await page.locator('#editions button[data-id="'+id+'"]').click();
 await page.locator('#content h2').filter({hasText:'Received output edition'}).waitFor();
 await page.waitForFunction(id=>document.querySelector('#content .identity')?.textContent===id,id);
 if(dataset)await page.selectOption('#dataset-select',dataset);
 await page.waitForFunction(()=>!!document.querySelector('#row-position')?.textContent);
}
function displayedCell(value){
 if(value===null)return'null';
 if(typeof value!=='object')return String(value);
 for(const key of ['$number','$decimal','$integer'])if(Object.hasOwn(value,key))return value[key];
 if(Object.hasOwn(value,'$binary'))return'[binary · '+value.encoding+'] '+value.$binary;
 if(Object.hasOwn(value,'$timestamp'))return value.$timestamp+' '+value.unit+(value.timezone?' · '+value.timezone:'');
 return JSON.stringify(value);
}
async function rowsAfter(page,editionId,datasetId,offset,trigger){
 const rowsPath='/api/editions/'+encodeURIComponent(editionId)+'/rows';
 const [response]=await Promise.all([
  page.waitForResponse(response=>{
   const url=new URL(response.url());
   return response.request().method()==='GET'&&url.origin===new URL(currentServer.address).origin&&url.pathname===rowsPath&&url.searchParams.get('dataset')===datasetId&&url.searchParams.get('offset')===String(offset)&&url.searchParams.get('limit')==='100';
  }),
  trigger()
 ]);
 assert.equal(response.status(),200,'Original dataset row response');
 const body=await response.json();
 assert.ok(Array.isArray(body.rows),'Original rows are an array');
 const columns=(body.columns||[...new Set(body.rows.flatMap(row=>Object.keys(row)))]).map(column=>typeof column==='string'?column:column.name);
 const matrix=body.rows.map(row=>columns.map(column=>Object.hasOwn(row,column)?displayedCell(row[column]):'missing'));
 const position=body.total?(offset+1)+'–'+(offset+body.rows.length)+' of '+body.total:'0 rows';
 await page.waitForFunction(expected=>{
  if(document.querySelector('#dataset-select')?.value!==expected.datasetId||document.querySelector('#content .identity')?.textContent!==expected.editionId)return false;
  if(document.querySelector('#row-position')?.textContent!==expected.position)return false;
  const headers=Array.from(document.querySelectorAll('#rows thead th'),cell=>cell.textContent);
  const rows=Array.from(document.querySelectorAll('#rows tbody tr'),row=>Array.from(row.cells,cell=>cell.textContent));
  return JSON.stringify(headers)===JSON.stringify(expected.headers)&&JSON.stringify(rows)===JSON.stringify(expected.matrix)&&document.querySelector('[data-action="next-rows"]')?.disabled===expected.nextDisabled;
 },{editionId,datasetId,position,headers:body.rows.length?columns:[],matrix,nextDisabled:body.next_offset===null});
 return{body,position};
}
async function readAllRows(page,editionId,dataset){
 let offset=0;
 let received=await rowsAfter(page,editionId,dataset.id,offset,()=>page.selectOption('#dataset-select',dataset.id));
 const total=received.body.total,rows=[],positions=[],sourcePages=[];
 for(;;){
  assert.equal(received.body.total,total,'Dataset total remains bound to its edition');
  positions.push(received.position);
  sourcePages.push({offset,body:received.body});
  rows.push(...await page.locator('#rows tbody tr').evaluateAll(rs=>rs.map(row=>Array.from(row.cells,c=>c.textContent))));
  const next=received.body.next_offset;
  if(next===null)break;
  assert.ok(Number.isSafeInteger(next)&&next>offset,'Original row cursor advances');
  offset=next;
  received=await rowsAfter(page,editionId,dataset.id,offset,()=>page.locator('[data-action="next-rows"]').click());
 }
 assert.equal(rows.length,total,'Every original row displayed for '+dataset.id);
 const headers=await page.locator('#rows thead th').allTextContents();
 allRows.push({editionId,datasetId:dataset.id,total,columns:headers,positions,rows,sourcePages});
 save('complete-browser-rows.json',allRows);
 return{datasetId:dataset.id,rows:rows.length,pages:positions.length,columns:headers.length,position:positions.at(-1)};
}
async function main(){
 await startServer(path.join(out,'customer-workspace'));let page=await launch();
 await waitWorkflow(page);
 const workflow=await getJSON(page,'workflows/'+result.workflow_id);
 assert.equal(workflow.definition.schema,'starforge.wherobots.source-interoperability.v1');
 assert.equal(workflow.definition.outputs.length,4);
 assert.equal(workflow.definition.sources.length,7);
 phase('original_collection_opened',{workspace_id:currentServer.workspace_id,datasets:workflow.definition.outputs.map(d=>({id:d.id,format:d.format})),originalSources:workflow.definition.sources.length});
 await originalDownload(page,page.getByRole('link',{name:'native_receiving.py',exact:true}),'original-native-receiving.py',workflow.definition.job.script.object);
 await originalDownload(page,page.getByRole('link',{name:'Original source manifest',exact:true}),'original-source-manifest.json',workflow.definition.input_manifest.object);
 for(const sourceItem of workflow.definition.sources){
  const link=page.locator('#content a[href^="/api/objects/'+sourceItem.object.sha256+'"]').first();
  const ext=sourceItem.id.startsWith('parquet-')?'.parquet':sourceItem.id==='csv'?'.csv':sourceItem.id==='license'?'.txt':'.json';
  await originalDownload(page,link,'original-'+sourceItem.id+ext,sourceItem.object);
 }
 phase('all_original_files_downloaded',{files:downloads.length,bytes:downloads.reduce((n,x)=>n+x.bytes,0)});
 for(const editionId of [result.before_edition_id,result.after_edition_id]){
  const edition=await getJSON(page,'editions/'+editionId);
  await openEdition(page,editionId);
  const summaries=[];
  for(const dataset of edition.datasets)summaries.push(await readAllRows(page,editionId,dataset));
  phase('complete_received_edition_read',{editionId,sourceBinding:edition.source_binding_sha256,datasets:summaries});
 }
 await openEdition(page,result.after_edition_id);
 await page.locator('#compare-form select[name="left_id"]').selectOption(result.before_edition_id);
 await page.getByRole('button',{name:'Compare every row',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Complete edition comparison saved.'));
 await page.getByRole('heading',{name:'Complete edition comparison',exact:true}).waitFor();
 const reportPath=await originalDownload(page,page.getByRole('link',{name:'Download complete comparison report',exact:true}),'complete-comparison.json',result.comparison.report_object);
 const changesPath=await originalDownload(page,page.getByRole('link',{name:'Download every row change',exact:true}),'complete-row-changes.ndjson',result.comparison.changes_object);
 report.comparison=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 phase('native_complete_comparison_downloaded',{comparisonId:result.comparison.id,changesBytes:fs.statSync(changesPath).size});
 for(const operationId of ['original-geoparquet-1.0.0','original-geoparquet-1.1.0']){
  await page.locator('#operations button[data-id="'+operationId+'"]').click();
  await page.getByRole('heading',{name:'Source receiving operation',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open receiving progress',exact:true}).click();
  await page.locator('#operation-detail').waitFor({state:'visible'});
  const operation=await getJSON(page,'operations/'+operationId);
  assert.equal(operation.native_run_id,null);
  phase('original_receiving_operation_opened',{operationId,state:operation.state,sourceRevision:operation.review_sha256});
 }
 await page.locator('#workflows button[data-id="'+result.workflow_id+'"]').click();await waitWorkflow(page);
 const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export complete handover',exact:true}).click();
 const handover=await exported;const handoverPath=path.join(output,'browser-complete-handover.zip');await handover.saveAs(handoverPath);
 const handoverBytes=fs.readFileSync(handoverPath);downloads.push({name:'browser-complete-handover.zip',bytes:handoverBytes.length,sha256:sha(handoverBytes),suggestedFilename:handover.suggestedFilename()});
 report.browserHandover=downloads.at(-1);
 phase('complete_customer_handover_exported',report.browserHandover);
 await page.screenshot({path:path.join(output,'internal-desktop.png'),fullPage:true});
 await closeBrowser();await stopServer();
 phase('original_browser_and_customer_server_closed');
 const receiver=path.join(out,'browser-customer-workspace');
 const initialized=JSON.parse(await child(python,['-B',path.join(source,'operate.py'),'--workspace',receiver,'init','--title','Independent browser customer receiving']));
 assert.notEqual(initialized.workspace_id,result.customer_workspace_id);
 await startServer(receiver);page=await launch(390);
 await page.locator('#package-file').waitFor({state:'attached'});
 await page.setInputFiles('#package-file',handoverPath);
 await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Handover received.'));
 await waitWorkflow(page);
 const received=await getJSON(page,'state');
 assert.equal(received.workspace_id,initialized.workspace_id);assert.equal(received.workflows.length,1);assert.equal(received.editions.length,2);
 assert.deepEqual(received.editions.map(x=>x.id).sort(),[result.before_edition_id,result.after_edition_id].sort());
 const receivedWorkflow=await getJSON(page,'workflows/'+result.workflow_id);
 assert.equal(receivedWorkflow.definition.input_manifest.object.sha256,workflow.definition.input_manifest.object.sha256);
 phase('fresh_customer_imported_in_browser',{workspace_id:received.workspace_id,originalEditions:received.editions.map(x=>x.id),sourceManifest:receivedWorkflow.definition.input_manifest.object.sha256});
 await openEdition(page,result.after_edition_id,'coordinate-envelopes');
 const receivedEdition=await getJSON(page,'editions/'+result.after_edition_id);
 const mobileRows=await readAllRows(page,result.after_edition_id,receivedEdition.datasets.find(x=>x.id==='coordinate-envelopes'));
 const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 assert.ok(layout.document<=390,'Mobile outer document fits 390px');
 report.mobile={...layout,...mobileRows};
 await page.screenshot({path:path.join(output,'internal-mobile.png'),fullPage:true});
 await closeBrowser();await stopServer();
 phase('fresh_receiver_closed',{mobile:report.mobile});
 await startServer(receiver);page=await launch(390);await waitWorkflow(page);
 const reopened=await getJSON(page,'state');assert.equal(reopened.workspace_id,initialized.workspace_id);
 await openEdition(page,result.before_edition_id,'countries');
 const reopenedEdition=await getJSON(page,'editions/'+result.before_edition_id);
 assert.equal(reopenedEdition.source_binding_sha256,phases.find(x=>x.name==='complete_received_edition_read'&&x.editionId===result.before_edition_id).sourceBinding);
 report.receiver={workspace_id:reopened.workspace_id,editions:reopened.editions.map(e=>e.id),workflow:result.workflow_id,reopened:true};
 phase('same_independent_customer_reopened',report.receiver);
 await closeBrowser();await stopServer();
 assert.deepEqual(errors,[],'Original browser application errors');assert.deepEqual(resources,[],'Original browser resource errors');
 report.completedAt=new Date().toISOString();report.complete=true;
 phase('full_browser_receiving_complete',{downloads:downloads.length,datasetViews:allRows.length,chromium:report.chromium});
}
main().catch(error=>{report.failure={message:clean(error.message),stack:clean(error.stack)};phase('browser_receiving_interrupted',report.failure);process.exitCode=1;}).finally(async()=>{await closeBrowser().catch(()=>{});await stopServer().catch(()=>{});save('browser-receiving.json',report);});
