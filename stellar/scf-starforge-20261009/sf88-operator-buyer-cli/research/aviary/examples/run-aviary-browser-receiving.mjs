#!/usr/bin/env node
/** Complete browser receiving of the public Aviary source and its original saved operation. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const args={};
for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw new Error('Use --name value arguments');args[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['application','workspace','provider-workspace','operation-id','out'])if(!args[key])throw new Error('Missing --'+key);
const out=path.resolve(args.out),application=path.resolve(args.application),workspace=path.resolve(args.workspace);
await mkdir(out,{recursive:true,mode:0o700});await mkdir(path.join(out,'tmp'),{recursive:true,mode:0o700});
const sourceModule=args['playwright-module']||process.env.PLAYWRIGHT_MODULE;
const pw=sourceModule?await import(pathToFileURL(path.resolve(sourceModule)).href):require('playwright');
const chromium=pw.chromium||pw.default?.chromium;
const python=args.python||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result={schema:'commons.aviary.complete-browser-receiving.v1',operationId:'AVIARY-BROWSER-RECEIVING-6BA15-20261012',startedAt:new Date().toISOString(),state:'RUNNING',phases:[],pageErrors:[],consoleErrors:[],screenshots:[]};
const resultPath=path.join(out,'browser-receiving-result.json');
let browser,context,page,server,serverExit,origin,serverLog='',serverError='',serverNumber=0,heldRelease=null;
const retained=await readFile(resultPath,'utf8').then(JSON.parse).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
if(retained?.state==='PASS'){
 for(const record of [retained.nativePackage,retained.publicWorkspaceExport,...retained.screenshots]){const body=await readFile(record.path);if(body.length!==record.bytes||hash(body)!==record.sha256)throw new Error('Completed browser artifact changed: '+record.path);}
 console.log(JSON.stringify({state:'PASS',reused:true,result:resultPath,publicWorkspaceId:retained.publicWorkspaceId,providerWorkspaceId:retained.providerWorkspaceId}));process.exit(0);
}
function expect(condition,message){if(!condition)throw new Error(message);}
async function persist(){const temporary=resultPath+'.partial';await writeFile(temporary,JSON.stringify(result,null,2)+'\n',{mode:0o600});await rename(temporary,resultPath);}
async function mark(name,detail={}){result.phases.push({name,at:new Date().toISOString(),...detail});await persist();console.log(JSON.stringify({phase:name,...detail}));}
async function fileRecord(filename){const body=await readFile(filename);return {path:filename,bytes:body.length,sha256:hash(body)};}
async function request(route){const response=await fetch(origin+route,{signal:AbortSignal.timeout(30000)});const value=await response.json();expect(response.ok,'HTTP '+response.status+' '+JSON.stringify(value));return value;}
async function freePort(){const socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}
async function openServer(app,root){
 const port=await freePort();serverLog='';serverError='';serverNumber++;
 server=spawn(python,['-B',path.join(app,'aviary.py'),'serve','--workspace',root,'--port',String(port)],{cwd:app,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:path.join(out,'tmp')},stdio:['ignore','pipe','pipe']});
 serverExit=new Promise(resolve=>server.once('exit',(code,signal)=>resolve({code,signal})));
 server.stdout.on('data',part=>serverLog+=part);server.stderr.on('data',part=>serverError+=part);
 const started=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Original application startup timed out: '+serverError)),30000);server.stdout.on('data',chunk=>{text+=chunk;const split=text.indexOf('\n');if(split>=0){clearTimeout(timer);try{resolve(JSON.parse(text.slice(0,split)));}catch(error){reject(error);}}});server.once('error',error=>{clearTimeout(timer);reject(error);});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Original application startup exited '+code+': '+serverError));});});
 origin=started.url;await mark('server-opened',{workspace:root,application:app,pid:server.pid,origin});
}
async function closeServer(){
 if(!server)return;
 const child=server,exit=serverExit;
 child.kill('SIGINT');let timer;
 const ended=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Original application server drain timed out')),15000);})]).finally(()=>clearTimeout(timer));
 server=null;
 await writeFile(path.join(out,'server-'+serverNumber+'.stdout.log'),serverLog);
 await writeFile(path.join(out,'server-'+serverNumber+'.stderr.log'),serverError);
 expect(ended.code===0,'Original server drain failed '+JSON.stringify(ended));
 await mark('server-drained',{pid:child.pid,...ended});
}
async function openPage(){
 if(page){await page.close();page=null;}
 page=await context.newPage();page.setDefaultTimeout(25000);
 page.on('pageerror',error=>result.pageErrors.push(error.message));
 page.on('console',entry=>{if(entry.type()==='error'&&!entry.text().includes('favicon.ico'))result.consoleErrors.push(entry.text());});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('#metrics .metric').first().waitFor();await page.waitForFunction(()=>document.getElementById('mappingDirty').textContent.includes('All choices saved'));
}
async function postByUI(route,trigger){
 const observed=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='POST');
 await trigger();const response=await observed;const value=await response.json();expect(response.ok(),'Original UI request '+route+' failed '+JSON.stringify(value));return value;
}
async function saved(){await page.waitForFunction(()=>document.getElementById('mappingDirty').textContent.startsWith('All choices saved'));return (await request('/api/state')).status;}
async function jobByUI(route,trigger){
 const accepted=await postByUI(route,trigger);expect(accepted.job?.id,'Original queued job identity absent');
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  const jobs=await request('/api/jobs'),job=jobs.jobs.find(value=>value.id===accepted.job.id);
  if(job&&['COMPLETED','FAILED','INTERRUPTED'].includes(job.state)){expect(job.state==='COMPLETED','Original job failed '+JSON.stringify(job));return job;}
  await sleep(100);
 }
 throw new Error('Original queued job did not finish within the receiving interval');
}
async function downloadJob(job,name){
 await page.locator('[data-tab=delivery]').click();
 const basename=path.basename(job.result.output);
 const link=page.locator('#artifactList a').filter({hasText:basename});
 await link.waitFor();
 const event=page.waitForEvent('download');await link.click();const download=await event;
 const filename=path.join(out,name);await download.saveAs(filename);await download.delete();
 const captured=await fileRecord(filename),original=await fileRecord(job.result.output);
 expect(captured.sha256===original.sha256&&captured.bytes===original.bytes,'Browser download differs from completed original job');
 return captured;
}
async function screenshot(name,width,height){
 await page.setViewportSize({width,height});await page.screenshot({path:path.join(out,name),fullPage:true});
 const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
 expect(dimensions.document<=dimensions.viewport+1,'Page overflows its viewport '+JSON.stringify(dimensions));
 const record={...(await fileRecord(path.join(out,name))),width,height,dimensions};result.screenshots.push(record);await persist();return record;
}
async function cli(argv,label){
 const child=spawn(python,['-B',...argv],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:path.join(out,'tmp')},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 await writeFile(path.join(out,label+'.stdout.json'),stdout);await writeFile(path.join(out,label+'.stderr.log'),stderr);
 expect(ended.code===0,'Original CLI failed '+label+': '+stderr);return JSON.parse(stdout);
}
await persist();
try{
 const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=1'],env:{...process.env,TMPDIR:path.join(out,'tmp')}};
 if(args['browser-executable'])options.executablePath=path.resolve(args['browser-executable']);
 browser=await chromium.launch(options);context=await browser.newContext({viewport:{width:1365,height:950},acceptDownloads:true});
 await openServer(application,workspace);await openPage();
 const original=(await request('/api/state')).status;
 result.publicWorkspaceId=original.workspace.id;result.source=original.source;result.initialMappingRevision=original.mapping.revision;
 await mark('original-public-source-open',{workspaceId:original.workspace.id,sourceFiles:original.source.files.length,sourceBytes:original.source.bytes,mappingRevision:original.mapping.revision});
 await page.locator('[data-tab=mapping]').click();
 const keys=await postByUI('/api/assign-keys',()=>page.locator('#assignKeys').click());await saved();
 let current=(await request('/api/state')).status;
 expect(Object.keys(current.mapping.document.keyMaps.resources).length===2&&Object.keys(current.mapping.document.keyMaps.media).length===3,'Original public identifiers were not assigned completely');
 await mark('original-keys-assigned',{revision:keys.revision,keyMaps:current.mapping.document.keyMaps});
 const firstNote='Public USGS collection reviewed from original publisher pages and captured media.';
 const laterNote=firstNote+' Operator retained a later mapping note while the original save completed.';
 await page.locator('#mappingNote').fill(firstNote);
 let reached;const captured=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>heldRelease=resolve);
 const intercept=async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const response=await route.fetch();reached({status:response.status(),body:await response.json()});await gate;await route.fulfill({response});
 };
 await page.route('**/api/mapping',intercept);
 await page.locator('#saveMapping').click();const savedFirst=await captured;
 expect(savedFirst.status===200,'Captured original save failed');
 await page.locator('#mappingNote').fill(laterNote);heldRelease();heldRelease=null;
 await page.waitForFunction(()=>!document.getElementById('saveMapping').disabled&&document.getElementById('mappingDirty').textContent.startsWith('Unsaved'));
 await page.unroute('**/api/mapping',intercept);
 expect(await page.locator('#mappingNote').inputValue()===laterNote,'Later operator input was replaced by earlier save');
 const actualFirst=(await request('/api/state')).status;
 expect(actualFirst.mapping.document.note===firstNote,'Original first save body differs');
 await postByUI('/api/mapping',()=>page.locator('#saveMapping').click());current=await saved();
 expect(current.mapping.document.note===laterNote,'Later operator input did not save');
 await mark('inflight-mapping-edit-retained',{firstRevision:actualFirst.mapping.revision,finalRevision:current.mapping.revision});
 await page.locator('[data-tab=preview]').click();await page.locator('#previewRows input').first().waitFor();
 const originalRowKey=(await page.locator('#previewRows input').first().getAttribute('aria-label')).replace('Include source row ','');
 page.once('dialog',dialog=>dialog.accept('Temporary receiving review: retain the original resource while excluding it from this saved selection.'));
 await page.locator('#previewRows input').first().uncheck();
 await postByUI('/api/mapping',()=>page.locator('#saveReview').click());await saved();
 let preview=await request('/api/preview?table=resources');
 expect(preview.counts.resources===1,'Saved resource exclusion was not applied');
 await mark('reasoned-source-exclusion-saved',{originalKey:originalRowKey,counts:preview.counts,excluded:preview.excluded});
 await page.locator('#refreshPreview').click();
 const restoredRow=page.getByRole('checkbox',{name:'Include source row '+originalRowKey,exact:true});await restoredRow.check();
 await postByUI('/api/mapping',()=>page.locator('#saveReview').click());current=await saved();
 const expectedCounts={resources:2,media:3,transcripts:1,indexes:2,supplemental:2};
 const inspected={};
 for(const [kind,count] of Object.entries(expectedCounts)){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview'&&response.request().method()==='POST');
  if(await page.locator('#previewKind').inputValue()===kind)await page.locator('#refreshPreview').click();else await page.locator('#previewKind').selectOption(kind);
  const response=await pending,document=await response.json();expect(response.ok(),'Record table preview failed '+kind);
  expect(document.counts[kind]===count&&document.tables[kind].length===count,'Original source table count differs '+kind);
  expect(document.ready,'Original public mapping is not ready: '+JSON.stringify(document.issues));inspected[kind]=count;
 }
 expect(isDeepStrictEqual(current.source,original.source),'Original source bytes changed during review');
 await mark('all-five-tables-reviewed',{counts:inspected,revision:current.mapping.revision,originalSourceRetained:true});
 await page.locator('[data-tab=delivery]').click();
 const packageJob=await jobByUI('/api/package',()=>page.locator('#buildPackage').click());
 result.nativePackage=await downloadJob(packageJob,'USGS_Aviary_Native_Package.zip');result.nativePackage.selectionRevision=packageJob.result.revision;
 await mark('native-package-downloaded',{...result.nativePackage});
 await page.waitForFunction(()=>!document.getElementById('exportWorkspace').disabled);
 const exportJob=await jobByUI('/api/export',()=>page.locator('#exportWorkspace').click());
 result.publicWorkspaceExport=await downloadJob(exportJob,'USGS_Aviary_Complete_Workspace.zip');
 await mark('complete-workspace-downloaded',result.publicWorkspaceExport);
 await page.locator('[data-tab=overview]').click();await screenshot('aviary-public-desktop.png',1365,950);
 await page.locator('[data-tab=preview]').click();await page.locator('#previewKind').selectOption('media');await page.locator('#previewRows tr').first().waitFor();
 await screenshot('aviary-public-mobile.png',390,844);
 await page.close();page=null;await closeServer();
 const received=await cli([path.join(application,'aviary.py'),'receive','--source',result.publicWorkspaceExport.path,'--output',path.join(out,'received-public')],'public-cold-receive');
 expect(received.status.workspace.id===original.workspace.id,'Cold received public workspace changed identity');
 await openServer(received.application,received.workspace);await openPage();
 const reopened=(await request('/api/state')).status;
 expect(reopened.workspace.id===original.workspace.id&&reopened.mapping.revision===current.mapping.revision&&isDeepStrictEqual(reopened.source,original.source),'Cold public source, mapping or identity changed');
 await mark('cold-public-workspace-opened',{workspaceId:reopened.workspace.id,revision:reopened.mapping.revision,sourceBytes:reopened.source.bytes});
 await page.close();page=null;await closeServer();
 await openServer(application,path.resolve(args['provider-workspace']));await openPage();
 const providerOriginal=(await request('/api/state')).status;
 const retained=providerOriginal.runs.find(run=>run.id===args['operation-id']);expect(retained,'Original completed receiving operation absent');
 expect(retained.actions.length&&retained.actions.every(action=>action.state==='COMPLETE'),'Original provider operation has unfinished actions');
 result.providerWorkspaceId=providerOriginal.workspace.id;result.originalProviderActions=retained.actions.map(action=>({key:action.action_key,state:action.state,id:action.provider_id}));
 await page.locator('[data-tab=transfer]').click();await page.locator('#savedOperation').selectOption(retained.id);
 await page.waitForFunction(id=>document.getElementById('runSummary').textContent.includes(id)&&!document.getElementById('runMigration').disabled,retained.id);
 await page.locator('#newOperation').click();
 const draft={baseUrl:'https://receiving-draft.aviaryplatform.com',organizationId:'456',collectionId:'789',tokenEnv:'AVIARY_RECEIVING_DRAFT_TOKEN',operationId:'public-usgs-browser-draft'};
 for(const [id,value] of Object.entries(draft))await page.locator('#'+id).fill(value);
 await page.locator('#savedOperation').selectOption(retained.id);
 await page.waitForFunction(()=>!document.getElementById('runMigration').disabled);
 await page.locator('#newOperation').click();
 for(const [id,value] of Object.entries(draft))expect(await page.locator('#'+id).inputValue()===value,'New target draft was replaced while viewing saved operation: '+id);
 await page.locator('#savedOperation').selectOption(retained.id);
 await page.waitForFunction(()=>!document.getElementById('runMigration').disabled);
 const providerAfter=(await request('/api/state')).status;
 expect(isDeepStrictEqual(providerAfter.runs,providerOriginal.runs),'Original provider operation changed during browser review');
 await screenshot('aviary-original-migration-desktop.png',1365,950);
 await screenshot('aviary-original-migration-mobile.png',390,844);
 await mark('original-provider-ids-and-draft-retained',{workspaceId:providerOriginal.workspace.id,operationId:retained.id,actions:result.originalProviderActions,targetDraftRetained:true});
 await page.close();page=null;await closeServer();
 expect(result.pageErrors.length===0,'Browser application errors: '+JSON.stringify(result.pageErrors));
 result.state='PASS';result.completedAt=new Date().toISOString();await persist();
}catch(error){
 result.state='FAILED';result.error={name:error.name,message:error.message,stack:error.stack};await persist();
 if(page){try{await page.screenshot({path:path.join(out,'aviary-browser-failure.png'),fullPage:true});}catch{}}
 throw error;
}finally{
 if(heldRelease)heldRelease();
 if(page){try{await page.close();}catch{}}
 if(server){try{await closeServer();}catch(error){result.cleanupError=error.message;await persist();}}
 if(context)await context.close();if(browser)await browser.close();
}
console.log(JSON.stringify({state:result.state,result:resultPath,publicWorkspaceId:result.publicWorkspaceId,providerWorkspaceId:result.providerWorkspaceId,phases:result.phases.length,screenshots:result.screenshots.length}));
