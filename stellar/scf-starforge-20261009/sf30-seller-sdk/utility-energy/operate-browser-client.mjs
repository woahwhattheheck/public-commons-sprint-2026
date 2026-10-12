#!/usr/bin/env node
// MIT. Operate the actual utility browser, customer client and original CLI.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,lstat,rename,rm,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {openUtilityWorkspace} from './utility-client.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const {values}=parseArgs({options:{
  'operation-dir':{type:'string'},out:{type:'string'},chromium:{type:'string'},playwright:{type:'string'}
}});
if(!values['operation-dir']||!values.out)throw new Error(
  'Use --operation-dir with the completed operate-example.py output and --out with a new private receiving directory.');
const original=resolve(values['operation-dir']),out=resolve(values.out);
const core=JSON.parse(await readFile(join(original,'operation.json'),'utf8'));
if(core.schema!=='stellar-forge.utility-original-operation.v1'||core.status!=='COMPLETE')
  throw new Error('Continue from the complete original utility source/customer operation.');
await mkdir(out,{mode:0o700});
await mkdir(join(out,'logs'),{mode:0o700});
await mkdir(join(out,'downloads'),{mode:0o700});
await mkdir(join(out,'screens'),{mode:0o700});
const report={schema:'stellar-forge.utility-browser-client-operation.v1',
  started_at:new Date().toISOString(),status:'STARTED',source_operation:join(original,'operation.json'),steps:[]};
const owned=new Set(),borrowers=new Set();let browser;
const node=process.execPath,python=process.env.SF30_UTILITY_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
const environment={...process.env,SF30_UTILITY_PYTHON:python,SF30_XML_NODE:node,PYTHONDONTWRITEBYTECODE:'1'};
async function saveReport(){
  const staging=join(out,'operation.next.json');
  await writeFile(staging,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await rename(staging,join(out,'operation.json'));
}
async function step(name,result){
  report.steps.push({name,at:new Date().toISOString(),result});await saveReport();
  process.stdout.write(JSON.stringify({step:name,at:new Date().toISOString()})+'\n');
}
function requireResult(condition,message){if(!condition)throw new Error(message);}
async function identity(file){
  const info=await lstat(file);requireResult(info.isFile()&&!info.isSymbolicLink(),'Receive an original regular file.');
  const hash=createHash('sha256');let bytes=0;
  for await(const data of createReadStream(file)){bytes+=data.length;hash.update(data);}
  return {bytes,sha256:hash.digest('hex')};
}
async function jsonFile(name,value){
  const path=join(out,name);await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});return identity(path);
}
function processJob(command,args,name){
  const stdout=createWriteStream(join(out,'logs',name+'.stdout'),{mode:0o600,flags:'wx'});
  const stderr=createWriteStream(join(out,'logs',name+'.stderr'),{mode:0o600,flags:'wx'});
  const child=spawn(command,args,{cwd:here,env:environment,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  const chunks=[];let length=0;
  child.stdout.on('data',data=>{length+=data.length;if(length<=32*1024*1024)chunks.push(data);});
  let settled=false;
  const done=new Promise((resolveDone,rejectDone)=>{
    child.once('error',error=>{settled=true;rejectDone(error);});
    child.once('close',(code,signal)=>{settled=true;resolveDone({code,signal,stdout:Buffer.concat(chunks).toString('utf8')});});
  });
  done.catch(()=>{});
  const job={child,done,name,get settled(){return settled;}};
  owned.add(job);return job;
}
async function command(args,name){
  const job=processJob(node,[join(here,'cli.mjs'),...args],name);
  const result=await job.done;owned.delete(job);
  requireResult(result.code===0,'Original CLI failed: '+name+'; inspect its retained stdout/stderr.');
  return JSON.parse(result.stdout.trim());
}
async function stop(job){
  if(!job||!owned.has(job))return;
  if(!job.settled)job.child.kill('SIGTERM');
  let stopped=await Promise.race([job.done.then(()=>true,()=>true),delay(15000).then(()=>false)]);
  if(!stopped){job.child.kill('SIGKILL');await job.done.catch(()=>{});}
  owned.delete(job);
}
async function start(workspace,name){
  const connectionFile=join(out,name+'.connection');
  const job=processJob(node,[join(here,'cli.mjs'),'--workspace',workspace,'serve',
    '--port','0','--startup-format','json','--connection-file',connectionFile],name);
  const deadline=Date.now()+30000;let url;
  while(Date.now()<deadline){
    if(job.settled)throw new Error('Original utility operator ended during startup: '+name);
    try{url=(await readFile(connectionFile,'utf8')).trim();break;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(100);
  }
  requireResult(Boolean(url),'Original utility operator did not publish its connection file: '+name);
  const client=await openUtilityWorkspace({connectionFile});borrowers.add(client);
  const state=await client.state();
  requireResult(state.applicationSchema==='stellar-forge.utility-workspace.v1','Original application identity differs.');
  return {job,client,url,connectionFile,workspace};
}
async function finishOperator(operator){
  if(operator.client.close)await operator.client.close();
  borrowers.delete(operator.client);await stop(operator.job);
  try{await lstat(operator.connectionFile);throw new Error('The closed original operator retained its private connection file.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
async function loadBrowser(){
  if(values.playwright){const loaded=await import(pathToFileURL(resolve(values.playwright)).href);return loaded.default||loaded;}
  const require=createRequire(import.meta.url),attempts=[];
  for(const name of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&
    join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'),'playwright',
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&
    join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright-core'),'playwright-core'].filter(Boolean)){
    try{return require(name);}catch(error){attempts.push(name+': '+error.message);}
  }
  throw new Error('Use the existing Playwright installation with --playwright /absolute/index.mjs. '+attempts.join('\n'));
}
async function ready(page){
  await page.waitForFunction(()=>{
    const status=document.querySelector('#status');
    return status&&(status.textContent==='Workspace updated.'||status.dataset.error==='true');
  },null,{timeout:180000});
  const problem=await page.locator('#status').getAttribute('data-error');
  if(problem==='true')throw new Error(await page.locator('#status').innerText());
}
async function pageOf(page,name){
  await page.locator('[data-page="'+name+'"]').click();
  await page.locator('#page-'+name).waitFor({state:'visible'});
}
async function responseFor(page,path,method,trigger,action){
  const waiting=page.waitForResponse(response=>{
    const request=response.request();
    if(new URL(response.url()).pathname!==path||request.method()!==method)return false;
    if(action){try{return JSON.parse(request.postData()).action===action;}catch{return false;}}
    return true;
  },{timeout:180000});
  waiting.catch(()=>{});
  await trigger();const response=await waiting,body=await response.json();
  requireResult(response.ok(),'Original browser request failed: '+path+' '+JSON.stringify(body));
  await ready(page);return body;
}
async function uiAct(page,action,trigger){
  const response=await responseFor(page,'/api/action','POST',trigger,action);
  const revision=response.state.revision;
  await page.waitForFunction(expected=>document.querySelector('#revision').textContent==='Revision '+expected,revision);
  return response.result;
}
async function download(page,trigger,name,expected){
  const waiting=page.waitForEvent('download',{timeout:180000});waiting.catch(()=>{});await trigger();
  const received=await waiting,target=join(out,'downloads',name);
  await received.saveAs(target);await chmod(target,0o600);
  const actual=await identity(target);
  if(expected)requireResult(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,
    'The browser received different original file bytes: '+name);
  await ready(page);return {name,path:target,...actual};
}
async function screen(page,name){
  const path=join(out,'screens',name+'.png');await page.screenshot({path,fullPage:true});await chmod(path,0o600);
  return {path,...await identity(path)};
}
async function originalBrowserQuery(page,build){
  await pageOf(page,'dataset');await page.locator('#query-build').selectOption(build);
  await page.locator('#query-params').fill(JSON.stringify({limit:'100',sort:'start_utc'}));
  let result=await uiAct(page,'dataset.query',()=>page.locator('#query-form button[type="submit"]').click());
  let count=0;const pages=[],keys=new Set();let snapshot;
  while(true){
    requireResult(result.response.status===200,'The original browser dataset query failed.');
    const body=result.response.body;snapshot??=body.dataset.snapshot;
    requireResult(snapshot===body.dataset.snapshot,'The browser query crossed native snapshots.');
    for(const row of body.rows){requireResult(!keys.has(row.logical_key),'A browser page repeated an interval.');keys.add(row.logical_key);}
    count+=body.rows.length;pages.push(body.page);
    if(body.page.nextCursor===null)break;
    result=await uiAct(page,'dataset.query',()=>page.locator('#query-next').click());
  }
  return {rows:count,pages,snapshot};
}
async function customerQuery(client,build){
  let query={limit:'100',sort:'start_utc'},total=0;const pages=[],keys=new Set();let snapshot;
  while(true){
    const result=(await client.query(build,query)).result;
    requireResult(result.response.status===200,'Original customer query failed.');
    const body=result.response.body;snapshot??=body.dataset.snapshot;
    requireResult(snapshot===body.dataset.snapshot,'Customer query snapshot changed.');
    for(const row of body.rows){requireResult(!keys.has(row.logical_key),'Customer paging repeated an interval.');keys.add(row.logical_key);}
    total+=body.rows.length;pages.push(body.page);
    if(body.page.nextCursor===null)break;
    query={...query,cursor:body.page.nextCursor};
  }
  return {rows:total,pages,snapshot};
}
await saveReport();
try{
  const playwright=await loadBrowser();
  const executablePath=values.chromium||process.env.SF30_UTILITY_BROWSER;
  browser=await playwright.chromium.launch({headless:true,...(executablePath?{executablePath}:{}),
    args:['--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),browserErrors=[];
  page.on('pageerror',error=>browserErrors.push(error.stack||String(error)));
  const seller=await start(join(original,'seller'),'seller-browser');
  await page.goto(seller.url);await ready(page);
  const initial=await seller.client.state();
  requireResult(initial.imports.length===20&&initial.reviews.length>=2,'Continue from the complete original operating workspace.');
  const full=initial.imports.find(item=>item.provider==='greenbutton'&&item.counts.intervals===1340);
  const day=initial.imports.find(item=>item.provider==='greenbutton'&&item.counts.intervals===96);
  requireResult(full&&day,'Both complete original Green Button editions are required.');
  const originals=[];
  for(let i=0;i<initial.imports.length;i++){
    const item=initial.imports[i],row=page.locator('#imports tbody tr').nth(i);
    const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/import'&&
      new URL(response.url()).searchParams.get('id')===item.id);
    await row.getByRole('button',{name:'Inspect',exact:true}).click();
    const retained=await (await waiting).json();await page.locator('#inspect-dialog').waitFor({state:'visible'});
    requireResult(retained.source_sha256===item.source_sha256,'The original source inspection changed.');
    await page.locator('#inspect-close').click();await ready(page);
    originals.push(await download(page,()=>row.getByRole('button',{name:'Original',exact:true}).click(),
      'original-'+String(i+1).padStart(2,'0')+(item.provider==='greenbutton'?'.xml':'.json'),
      {bytes:item.bytes,sha256:item.source_sha256}));
  }
  const collections=[];
  for(const kind of ['interval','meter','bill','charge','resource']){
    await page.locator('#browse-kind').selectOption(kind);
    const result=await responseFor(page,'/api/records','GET',()=>page.locator('#browse-form button[type="submit"]').click());
    collections.push({kind,total:result.total,first_page:result.rows.length,next_offset:result.next_offset});
  }
  await step('browser-original-source-receiving',{imports:originals,collections,
    screen:await screen(page,'01-original-sources')});
  await pageOf(page,'review');
  for(const checkbox of await page.locator('#review-imports input').all())await checkbox.check();
  await responseFor(page,'/api/series','GET',()=>page.locator('#series-refresh').click());
  await page.locator('#review-priority').selectOption(full.id);
  while(await page.locator('#review-priority').evaluate((element,id)=>
    Array.from(element.options).findIndex(option=>option.value===id),full.id)>0)
    await page.locator('#priority-up').click();
  await page.locator('#review-priority').selectOption(day.id);
  while(await page.locator('#review-priority').evaluate((element,id)=>
    Array.from(element.options).findIndex(option=>option.value===id),day.id)>1)
    await page.locator('#priority-up').click();
  await page.locator('#review-priority').selectOption([full.id,day.id]);
  await page.locator('#review-name').fill('Browser customer receiving of complete original utility sources');
  const preview=await uiAct(page,'analysis.preview',()=>page.locator('#review-form button[type="submit"]').click());
  requireResult(preview.report.selected_rows===1340&&preview.report.equivalent_and_corrected.length===96,
    'The browser source choice did not preserve the full original dataset and day provenance.');
  await page.locator('#reviewer').fill('Original browser customer receiving');
  await page.locator('#review-note').fill(
    'Review all original sources, prefer the full Green Button edition, retain all 96 equivalent day references, and receive the complete native customer workspace.');
  await page.locator('#ack-issues').check();
  const review=await uiAct(page,'review.save',()=>page.locator('#save-review-form button[type="submit"]').click());
  await step('browser-source-decision',{review_id:review.id,preview_id:preview.id,
    selected_rows:preview.report.selected_rows,equivalent_intervals:preview.report.equivalent_and_corrected.length,
    issues:preview.report.issues,screen:await screen(page,'02-interval-review')});
  await pageOf(page,'dataset');await page.locator('#build-review').selectOption(review.id);
  const build=await uiAct(page,'edition.build',()=>page.locator('#build-form button[type="submit"]').click());
  await page.locator('#compare-before').selectOption(initial.active_build);
  await page.locator('#compare-after').selectOption(build.id);
  const compared=await uiAct(page,'edition.compare',()=>page.locator('#compare-form button[type="submit"]').click());
  const queried=await originalBrowserQuery(page,build.id);
  requireResult(queried.rows===1340&&queried.snapshot===build.native.snapshot,'Browser query did not receive all original native rows.');
  await step('browser-native-edition-and-every-page',{build,comparison:compared,query:queried});
  await pageOf(page,'billing');await page.locator('#bill-review').selectOption(review.id);
  const bills=await uiAct(page,'bills.reconcile',()=>page.locator('#reconcile-form button[type="submit"]').click());
  await step('browser-original-bill-reconciliation',bills);
  await pageOf(page,'delivery');await page.locator('#export-review').selectOption(review.id);
  const delivery=await uiAct(page,'package.export',()=>page.locator('#export-form button[type="submit"]').click());
  const deliveryState=await seller.client.state(),deliveryIndex=deliveryState.exports.findIndex(item=>item.id===delivery.id);
  const fullDelivery=await download(page,()=>page.locator('#exports tbody tr').nth(deliveryIndex)
    .getByRole('button',{name:'Download all',exact:true}).click(),'browser-customer-delivery.zip');
  const portable=await download(page,()=>page.locator('#portable').click(),'browser-utility-workspace.zip');
  const manifest=await seller.client.exportManifest(delivery.id);
  const clientFiles=[];
  for(const name of ['dataset.csv','dataset.json','native-project.zip']){
    const member=manifest.files.find(item=>item.name===name);
    if(!member)continue;
    clientFiles.push(await seller.client.downloadFile(delivery.id,name,join(out,'downloads','client-'+name)));
  }
  requireResult(clientFiles.some(item=>item.path.endsWith('.csv'))&&clientFiles.some(item=>item.path.endsWith('dataset.json')),
    'Receive the original generated dataset and configuration through the customer client.');
  await step('browser-and-client-complete-delivery',{delivery_id:delivery.id,
    files:manifest.files,archive:fullDelivery,portable,client_files:clientFiles,
    screen:await screen(page,'03-customer-delivery')});
  await pageOf(page,'publisher');
  const publisher=await responseFor(page,'/api/publisher-state','GET',()=>page.locator('#publisher-refresh').click());
  await pageOf(page,'history');
  const history=await responseFor(page,'/api/operations','GET',()=>page.locator('#operations-refresh').click());
  await step('original-publisher-and-operation-history',{publisher,operations:history.operations.length});
  await page.setViewportSize({width:390,height:844});await pageOf(page,'delivery');
  await step('compact-customer-view',{screen:await screen(page,'04-compact-delivery')});
  await page.close();await context.close();await finishOperator(seller);
  const coldSeller=await command(['--workspace',join(original,'seller'),'status'],'seller-cli-reopen');
  requireResult(coldSeller.active_build===build.id,'The original CLI did not reopen the browser edition.');
  const customerWorkspace=join(out,'customer');
  await command(['--workspace',customerWorkspace,'init'],'customer-cli-init');
  const customer=await start(customerWorkspace,'customer-browser');
  const receivingContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const receivingPage=await receivingContext.newPage();
  receivingPage.on('pageerror',error=>browserErrors.push(error.stack||String(error)));
  await receivingPage.goto(customer.url);await ready(receivingPage);await pageOf(receivingPage,'delivery');
  await receivingPage.locator('#restore-file').setInputFiles(portable.path);
  const restored=await responseFor(receivingPage,'/api/restore','POST',()=>receivingPage.locator('#restore-form button[type="submit"]').click());
  const received=await customer.client.state();
  requireResult(received.imports.length===20&&received.reviews.length===initial.reviews.length+1&&received.active_build===build.id,
    'The browser receiving did not reopen all original sources, reviews and selected native edition.');
  const customerRows=await customerQuery(customer.client,build.id);
  requireResult(customerRows.rows===1340&&customerRows.snapshot===queried.snapshot,
    'The customer client did not receive the same complete native dataset.');
  await receivingPage.locator('#refresh').click();await ready(receivingPage);
  await pageOf(receivingPage,'delivery');await receivingPage.locator('#export-review').selectOption(review.id);
  const receivedDelivery=await uiAct(receivingPage,'package.export',()=>receivingPage.locator('#export-form button[type="submit"]').click());
  const receivedState=await customer.client.state();
  const receivedIndex=receivedState.exports.findIndex(item=>item.id===receivedDelivery.id);
  const receivedZip=await download(receivingPage,()=>receivingPage.locator('#exports tbody tr').nth(receivedIndex)
    .getByRole('button',{name:'Download all',exact:true}).click(),'customer-reopened-delivery.zip');
  await step('cold-browser-and-client-customer-receiving',{restored:restored.result,
    imports:received.imports.length,reviews:received.reviews.length,builds:received.builds.length,
    query:customerRows,delivery:receivedDelivery,archive:receivedZip,
    screen:await screen(receivingPage,'05-reopened-customer')});
  await receivingPage.close();await receivingContext.close();await finishOperator(customer);
  const cliStatus=await command(['--workspace',customerWorkspace,'status'],'customer-cli-reopen');
  const cliQuery=await command(['--workspace',customerWorkspace,'query','--build',build.id,
    '--params',JSON.stringify({limit:'100',sort:'start_utc'})],'customer-cli-query');
  requireResult(cliStatus.active_build===build.id&&cliQuery.response.body.page.total===1340&&
    cliQuery.response.body.dataset.snapshot===queried.snapshot,'The original CLI did not retain the received customer dataset.');
  requireResult(browserErrors.length===0,'The original browser raised an exception: '+browserErrors.join('\n'));
  await browser.close();browser=null;
  await step('original-cli-reopen-and-owned-process-close',{active_build:cliStatus.active_build,
    query_page:cliQuery.response.body.page,snapshot:cliQuery.response.body.dataset.snapshot,browser_errors:browserErrors});
  report.status='COMPLETE';report.completed_at=new Date().toISOString();await saveReport();
  process.stdout.write(JSON.stringify({status:report.status,operation:join(out,'operation.json'),
    customer_workspace:customerWorkspace,delivery:receivedZip.path})+'\n');
}catch(error){
  report.status='FAILED';report.failed_at=new Date().toISOString();report.error=error.message;report.stack=error.stack;
  await saveReport();throw error;
}finally{
  for(const client of borrowers)if(client.close)await client.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  for(const job of [...owned])await stop(job);
}
