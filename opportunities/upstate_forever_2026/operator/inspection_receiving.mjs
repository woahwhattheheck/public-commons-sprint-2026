#!/usr/bin/env node
/** Use the original running operator and actual saved records; never submit a task. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const args={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i]?.startsWith('--')||!process.argv[i+1])throw Error('Supply --name value arguments.');args[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['workspace','directory','chromium','playwright'])if(!args[key])throw Error('Supply --'+key+' for the existing original operator.');
const incoming=new URL(process.env.UPSTATE_OPERATOR_URL||args.url||'');
if(!['http:','https:'].includes(incoming.protocol))throw Error('Use the original operator HTTP address.');
const auth=new URLSearchParams(incoming.hash.slice(1)),token=auth.get('token')||process.env.UPSTATE_OPERATOR_TOKEN;
if(!token)throw Error('Use the private original operator URL or its existing token environment binding.');
const origin=incoming.origin,base=new URL('/',origin);base.hash=new URLSearchParams({token}).toString();
const require=createRequire(import.meta.url),{chromium}=require(path.resolve(args.playwright));
const {scientificRecord}=await import(pathToFileURL(path.resolve(args.module||path.join(path.dirname(new URL(import.meta.url).pathname),'web/scientific_inspection.mjs'))));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=path.resolve(args.directory);await fs.mkdir(output,{recursive:true});
const attempt=await fs.mkdtemp(path.join(output,'inspection-'));
const result={schema:'upstate.scientific-inspection-receiving/v1',started_at:new Date().toISOString(),workspace:args.workspace,origin,attempt,records:[],screens:[],errors:[],blocked_mutations:[]};
let browser,context,page;
async function write(name,value){const body=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';await fs.writeFile(path.join(attempt,name),body,{flag:'wx'});return {path:name,bytes:Buffer.byteLength(body),sha256:digest(body)};}
async function read(api){const response=await context.request.get(origin+api,{headers:{Authorization:'Bearer '+token,'X-Workspace':args.workspace}});if(!response.ok())throw Error('Original operator GET failed: '+response.status()+' '+api);return response.json();}
async function screen(name,width){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(attempt,name),fullPage:false});const bytes=await fs.readFile(path.join(attempt,name));result.screens.push({path:name,width,height:900,bytes:bytes.length,sha256:digest(bytes),visually_viewed:false});}
async function download(label,name){const wait=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const file=await wait;await file.saveAs(path.join(attempt,name));const bytes=await fs.readFile(path.join(attempt,name));return {path:name,bytes:bytes.length,sha256:digest(bytes)};}
async function closeDetail(){if(await page.locator('#detail-dialog').evaluate(n=>n.open))await page.getByRole('button',{name:'Close details',exact:true}).click();}
async function openRecord(kind,id){await closeDetail();await page.locator('.sidebar [data-view="'+kind+'"]').click();await page.locator('[data-action="item"][data-kind="'+kind+'"][data-id="'+id+'"]').first().click();await page.locator('#detail-dialog[open] .scientific-downloads').waitFor();}
async function capture(kind,id,record,slug){
 await page.getByRole('button',{name:'Download readable inspection',exact:true}).waitFor();
 const html=await download('Download readable inspection',slug+'.html'),json=await download('Download original record JSON',slug+'.json');
 assert.deepStrictEqual(JSON.parse(await fs.readFile(path.join(attempt,json.path),'utf8')),scientificRecord(record),'The downloaded original record must equal this native saved edition.');
 await screen(slug+'-desktop.png',1440);await screen(slug+'-390.png',390);
 const raw=page.locator('#detail-body > details.technical').last();if(await raw.count()){assert.equal(await raw.getAttribute('open'),null,'Raw JSON must be optional on first open.');await raw.locator('summary').click();await raw.locator('summary').click();}
 result.records.push({kind,id,html,json});
}
try{
 browser=await chromium.launch({headless:true,executablePath:path.resolve(args.chromium),args:['--no-sandbox','--disable-dev-shm-usage']});
 context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900}});
 await context.route('**/api/**',async route=>{if(!['GET','HEAD'].includes(route.request().method())&&!(route.request().method()==='POST'&&new URL(route.request().url()).pathname==='/api/session')){result.blocked_mutations.push({method:route.request().method(),path:new URL(route.request().url()).pathname});return route.abort('blockedbyclient');}return route.continue();});
 page=await context.newPage();page.on('pageerror',error=>result.errors.push({kind:'pageerror',message:error.message}));
 await page.goto(base.href,{waitUntil:'domcontentloaded'});
 await page.locator('#workspace-select option[value="'+args.workspace+'"]').waitFor({state:'attached'});
 await page.locator('#workspace-select').selectOption(args.workspace);
 await page.waitForFunction(ws=>document.querySelector('#workspace-select')?.value===ws&&document.querySelector('#content')?.textContent.trim(),args.workspace);
 const moduleResponse=await context.request.get(origin+'/web/scientific_inspection.mjs');if(!moduleResponse.ok())throw Error('The current installed scientific inspection module is not served.');
 const moduleBytes=await moduleResponse.body();result.module={bytes:moduleBytes.length,sha256:digest(moduleBytes)};
 if(args['module-sha256'])assert.equal(result.module.sha256,args['module-sha256'],'Use the exact selected outgoing module.');
 const state=await read('/api/state?workspace='+encodeURIComponent(args.workspace));await write('original-state.json',state);
 const data=state.data||{},run=(data.runs||[]).find(r=>r.id===args.run)||(data.runs||[]).find(r=>r.state==='complete'&&Object.keys(r.artifacts||{}).length);
 if(!run)throw Error('Select an existing completed native run with actual retained artifacts. This receiving course does not create demonstration results.');
 const runRecord=await read('/api/item?workspace='+encodeURIComponent(args.workspace)+'&kind=runs&id='+encodeURIComponent(run.id));
 await openRecord('runs',run.id);
 await page.getByRole('heading',{name:'Where and when these results apply',exact:true}).waitFor();
 for(const artifact of Object.values(runRecord.artifacts||{})){const unit=artifact.sum_units||artifact.units;if(unit)assert.ok((await page.locator('#detail-body').innerText()).includes(unit),'Preserve native output units.');}
 await capture('runs',run.id,runRecord,'native-run');
 const collection=(data.sources||[]).find(s=>s.id===args.source)||(data.sources||[]).find(s=>s.entries?.some(e=>['raster','vector','table'].includes(e.kind)));
 if(!collection)throw Error('This original Workspace needs a retained source edition for inspection.');
 const source=collection.entries.find(e=>e.id===args['source-id'])||collection.entries.find(e=>['raster','vector','table'].includes(e.kind));
 await openRecord('sources',collection.id);
 let releasePreview,previewSeen;
 const previewGate=new Promise(resolve=>{releasePreview=resolve;}),previewStarted=new Promise(resolve=>{previewSeen=resolve;});
 const holdPreview=async route=>{const selected=new URL(route.request().url());if(selected.searchParams.get('source')===source.id){previewSeen();await previewGate;}await route.continue();};
 await context.route('**/api/source-info?**',holdPreview);
 let previewTimer;
 try{
  await page.locator('[data-action="source-inspect"][data-source="'+source.id+'"]').click();
  await Promise.race([previewStarted,new Promise((_,reject)=>{previewTimer=setTimeout(()=>reject(Error('The original source preview request did not start.')),30000);})]);
  await page.getByRole('heading',{name:'Reading the selected native file…',exact:true}).waitFor();
  await screen('original-source-loading-desktop.png',1440);await screen('original-source-loading-390.png',390);
 }finally{clearTimeout(previewTimer);releasePreview();await context.unroute('**/api/source-info?**',holdPreview);}
 await page.getByRole('button',{name:'Download readable inspection',exact:true}).waitFor();
 const sourceInfo=await read('/api/source-info?workspace='+encodeURIComponent(args.workspace)+'&collection='+encodeURIComponent(collection.id)+'&source='+encodeURIComponent(source.id));
 await capture('source-info',source.id,sourceInfo,'original-source');
 // A real transport interruption exercises the existing source-error view.
 await openRecord('sources',collection.id);await context.setOffline(true);
 await page.locator('[data-action="source-inspect"][data-source="'+source.id+'"]').click();
 await page.getByRole('heading',{name:'Original source could not be opened',exact:true}).waitFor();
 await screen('source-connection-error-desktop.png',1440);await screen('source-connection-error-390.png',390);
 await context.setOffline(false);await page.getByRole('button',{name:'Try reading this original source again',exact:true}).click();
 await page.getByRole('button',{name:'Download readable inspection',exact:true}).waitFor();
 const recovered=await download('Download original record JSON','original-source-after-connection-return.json');
 assert.deepStrictEqual(JSON.parse(await fs.readFile(path.join(attempt,recovered.path),'utf8')),scientificRecord(sourceInfo));
 result.source_recovery=recovered;
 const emptyRun=(data.runs||[]).find(r=>!Object.keys(r.artifacts||{}).length);
 if(emptyRun){await openRecord('runs',emptyRun.id);await page.getByText('No native export totals are retained for this run yet.',{exact:false}).waitFor();await screen('retained-run-without-results.png',1440);result.empty_result_run=emptyRun.id;}
 else result.empty_result_run={observed:false,reason:'No real retained run without artifacts exists in the selected Workspace; no result was fabricated.'};

 const task=(state.tasks||[]).find(t=>t.id===args.task)||(state.tasks||[]).find(t=>['failed','interrupted'].includes(t.state))||(state.tasks||[])[0];
 if(!task)throw Error('Select a retained original operation to inspect its actual saved payload and attempts.');
 await closeDetail();if(await page.locator('#task-panel').isHidden())await page.locator('.top-actions [data-action="tasks"]').click();
 await page.locator('[data-action="task-open"][data-id="'+task.id+'"]').click();await page.getByRole('heading',{name:'Operation and selected scientific inputs',exact:true}).waitFor();
 const taskRecord=await read('/api/task?workspace='+encodeURIComponent(args.workspace)+'&id='+encodeURIComponent(task.id));
 await capture('task',task.id,taskRecord,'original-operation');
 await context.close();context=null;
 // The export is its own document: no source service, profile or script import is used.
 for(const saved of result.records){
  const cold=await browser.newContext({viewport:{width:1440,height:900}}),offline=await cold.newPage();
  await cold.setOffline(true);await offline.goto(pathToFileURL(path.join(attempt,saved.html.path)).href,{waitUntil:'domcontentloaded'});
  await offline.locator('main.scientific-inspection h1').waitFor();
  assert.equal(await offline.locator('script').count(),0,'The readable inspection must open without a script runtime.');
  const previous=page;page=offline;await screen(saved.kind+'-cold-desktop.png',1440);await screen(saved.kind+'-cold-390.png',390);page=previous;
  await offline.locator('summary').first().click();await cold.close();
 }
 assert.deepStrictEqual(result.blocked_mutations,[],'Inspection must not attempt an application mutation.');
 if(result.errors.length)throw Error('The original operator emitted browser errors; review retained details before completion.');
 result.state='OPERATED_AWAITING_VISUAL_INSPECTION';result.ended_at=new Date().toISOString();
}catch(error){result.state='INCOMPLETE';result.errors.push({kind:'receiving',message:error.stack||error.message||String(error)});process.exitCode=1;}
finally{if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await write('receiving-result.json',result);console.log(JSON.stringify({state:result.state,directory:attempt,records:result.records.length,screens:result.screens.length,errors:result.errors}));}
