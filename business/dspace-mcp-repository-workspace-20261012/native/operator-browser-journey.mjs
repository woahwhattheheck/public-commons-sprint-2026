#!/usr/bin/env node
/**
 * Complete operator receiving journey against the original Workspace, HTTP server,
 * browser and pinned MCP SDK. Imports the actual captured DSpace cohort. Remote
 * write receiving is the separate original native receiving operation.
 *
 * node native/operator-browser-journey.mjs --output ./receiving/operator-browser
 *   [--browser /absolute/path/to/chromium]
 *   [--playwright /absolute/path/to/playwright]
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startServer} from '../server.mjs';
import {NativeBridge} from '../bridge.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const options={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--output','--browser','--playwright'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Supply --output, with optional --browser and --playwright paths.');
  options[process.argv[i].slice(2)]=process.argv[i+1];
}
const output=resolve(options.output||join(root,'receiving/operator-browser'));
await mkdir(output,{recursive:true});
const resultPath=join(output,'result.json'), progressPath=join(output,'progress.json');
const require=createRequire(import.meta.url);
const {chromium}=require(options.playwright||(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright'));
const firstUuid='0157eef4-2dc8-4ddd-8124-94cdabc15f6e';
const personUuid='1b19bcc0-4f83-446d-95b7-ec0c806d1578';
const collectionUuid='dd1240ae-d7dd-405c-bdc3-d6c960609433';
const actor='Repository operator receiving';
const phases=[], pageErrors=[];
const saved={schema:'dspace-operator-browser-receiving/v1',started_at:new Date().toISOString(),status:'RUNNING',phases};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let server,receiver,browser,context,page;
async function mark(name,data={}){
  phases.push({name,status:'PASS',finished_at:new Date().toISOString(),...data});
  await writeFile(progressPath,JSON.stringify(saved,null,2)+'\n');
  process.stdout.write(JSON.stringify({phase:name,...data})+'\n');
}
async function waitIdle(target=page){
  await target.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
}
async function action(name,interact,target=page){
  const responsePromise=target.waitForResponse(r=>new URL(r.url()).pathname==='/api/actions/'+name&&r.request().method()==='POST');
  await interact();
  const response=await responsePromise, value=await response.json();
  assert.equal(response.ok(),true,name+': '+JSON.stringify(value));
  await waitIdle(target);
  return value;
}
async function nav(name,target=page){await target.locator('[data-view="'+name+'"]').click();}
async function downloadFrom(interact,path,target=page){
  const pending=target.waitForEvent('download');await interact();const download=await pending;
  await download.saveAs(path);assert.equal(await download.failure(),null);return await readFile(path);
}
function objects(ws){
  const items=new Map();
  for(const summary of ws.state().captures){
    const capture=ws.read('captures',summary.id,{offset:0,limit:100});
    for(const object of capture.objects||[])if(object.type==='item')items.set(object.uuid,object);
  }
  return items;
}
async function fillOperator(target){
  await target.locator('#workspace-id').filter({hasText:/Revision/}).waitFor();
  await target.locator('#operator-name').fill(actor);
}
async function screenshot(target,name){
  await target.screenshot({path:join(output,name),fullPage:true});
  const sizes=await target.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(sizes.document<=sizes.viewport+1,JSON.stringify(sizes));
}
async function openFirst(){
  await nav('records');await page.locator('#record-scope').selectOption('');
  await page.locator('#record-filter').fill(firstUuid);
  await page.locator('#record-index .record-select').filter({hasText:firstUuid}).click();
  await page.locator('[data-form="metadata"]').waitFor();
}
try{
  // A complete receiving run gets its own output directory. Preserve any previous
  // directory and pass a different --output when validating a changed source.
  server=await startServer({directory:join(output,'original-workspace')});
  assert.equal(server.workspace.state().captures.length,0,'Use an empty receiving output directory.');
  browser=await chromium.launch({headless:true,...(options.browser?{executablePath:resolve(options.browser)}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(server.address);await fillOperator(page);
  await nav('handover');
  const imports=[];
  for(const filename of ['public-reader-source.json','linked-person-source.json']){
    const original=join(root,'source-captures',filename);
    await page.locator('#source-import-file').setInputFiles(original);
    imports.push(await action('import-capture',()=>page.locator('#source-import-form button').click()));
  }
  const initial=server.workspace.state(), items=objects(server.workspace), first=items.get(firstUuid), person=items.get(personUuid);
  assert.ok(first&&person,'Both actual publication and linked Person must be retained.');
  const nativeBridge=new NativeBridge(initial.profiles[0]);
  await nativeBridge.open();assert.equal(nativeBridge.tools.length,15);await nativeBridge.close();
  const originalAuthors=structuredClone(first.metadata['dc.contributor.author']);
  assert.equal(originalAuthors.length,85);
  assert.ok(originalAuthors.some(v=>v.authority==='virtual::1019'));
  assert.equal(person.metadata['person.familyName'][0].value,'Antoniou');
  const nativeCaptures=initial.captures.map(c=>server.workspace.read('captures',c.id,{offset:0,limit:100}));
  const sourceRequests=nativeCaptures.flatMap(c=>c.requests||[]);
  assert.ok(sourceRequests.length>=27);
  assert.ok(sourceRequests.some(r=>r.status===null),'Unknown provider status remains unknown.');
  await mark('original-sdk-and-source',{tools:15,captures:initial.captures.length,items:items.size,requests:sourceRequests.length,authors_on_first:originalAuthors.length});

  await nav('records');await page.locator('#record-scope').selectOption(collectionUuid);
  await page.waitForFunction(()=>document.querySelectorAll('#record-index .record-select').length===44);
  const selectedUuids=await page.locator('#record-index .record-select small').allTextContents();
  await page.locator('#select-filtered-records').click();
  await page.getByLabel('Selection name',{exact:true}).fill('Publications 2 · complete original cohort');
  const selectionResult=await action('save-selection',()=>page.getByRole('button',{name:'Save selected items',exact:true}).click());
  const selection=server.workspace.read('selections',selectionResult.selection_id,{offset:0,limit:100});
  assert.equal(selection.members.length,44);
  const cohort=selection.members.map(m=>items.get(m.uuid));
  assert.equal(cohort.reduce((n,o)=>n+Object.values(o.metadata).reduce((a,v)=>a+(Array.isArray(v)?v.length:0),0),0),1216);
  assert.equal(cohort.reduce((n,o)=>n+(o.metadata['dc.contributor.author']||[]).length,0),408);
  await mark('complete-cohort-selection',{selection_id:selectionResult.selection_id,items:44,metadata_values:1216,authors:408});

  await openFirst();
  const authorSection=page.locator('section.metadata-field').filter({has:page.locator('h4').filter({hasText:/^dc\.contributor\.author$/})});
  await page.getByText('dc.contributor.author · 85 values',{exact:true}).click();
  const linkedRow=authorSection.locator('.metadata-value').filter({hasText:'virtual::1019'});
  assert.equal(await linkedRow.count(),1);
  assert.equal(await linkedRow.locator('textarea').getAttribute('readonly'),'');
  assert.equal(await linkedRow.getByRole('button',{name:'Remove',exact:true}).isDisabled(),true);
  const ordinary=authorSection.locator('textarea:not([readonly])');
  assert.ok(await ordinary.count()>0);
  const title=page.locator('textarea[data-field="dc.title"]').first();
  const titleLanguage=page.getByLabel('dc.title language 1',{exact:true});
  await titleLanguage.fill('en');
  const revisedTitle=first.metadata['dc.title'][0].value+' · reviewed repository metadata';
  await title.fill(revisedTitle);
  await page.getByLabel('Metadata plan name',{exact:true}).fill('Review original publication title');
  const titleResult=await action('prepare-plan',()=>page.getByRole('button',{name:'Prepare metadata change',exact:true}).click());
  const titlePlan=server.workspace.read('plans',titleResult.plan_id);
  assert.equal(titlePlan.steps.length,1);
  const titleOperation=titlePlan.steps[0].args.operations.find(p=>p.path==='/metadata/dc.title');
  assert.equal(titleOperation.value[0].language,'en');assert.equal(titleOperation.value[0].value,revisedTitle);
  assert.equal(titlePlan.steps[0].args.operations.some(p=>p.path.includes('contributor.author')),false);
  assert.deepEqual(objects(server.workspace).get(firstUuid).metadata['dc.contributor.author'],originalAuthors);
  await page.getByLabel('Review note',{exact:true}).fill('Reviewed the complete original title and its language. Linked and ordinary authors retain their exact native values.');
  await action('review-plan',()=>page.getByRole('button',{name:'Approve this plan',exact:true}).click());
  assert.equal(server.workspace.read('plans',titleResult.plan_id).status,'APPROVED');
  await screenshot(page,'01-reviewed-publication-desktop.png');
  await mark('publication-editor-and-review',{plan_id:titleResult.plan_id,preserved_authors:85,preserved_virtual_authors:originalAuthors.filter(v=>v.authority?.startsWith('virtual::')).length});

  await openFirst();
  await page.getByText('dc.contributor.author · 85 values',{exact:true}).click();
  await authorSection.locator('.metadata-value').filter({hasText:'virtual::1019'}).getByRole('button',{name:'Open linked item',exact:true}).click();
  await page.locator('#record-detail h3').filter({hasText:'Antonis Antoniou'}).first().waitFor();
  const job=page.locator('textarea[data-field="person.jobTitle"]').first();
  assert.equal(await job.isEditable(),true);
  await job.fill('Researcher · repository profile reviewed');
  await page.getByLabel('Metadata plan name',{exact:true}).fill('Review actual linked Person metadata');
  const personResult=await action('prepare-plan',()=>page.getByRole('button',{name:'Prepare metadata change',exact:true}).click());
  const personPlan=server.workspace.read('plans',personResult.plan_id);
  assert.equal(personPlan.steps[0].subject_id,personUuid);
  assert.equal(personPlan.steps[0].args.operations[0].path,'/metadata/person.jobTitle');
  await mark('actual-linked-person-edit',{person_uuid:personUuid,plan_id:personResult.plan_id});

  await nav('handover');
  await page.locator('#selection-list .record-card').filter({hasText:'Publications 2 · complete original cohort'}).getByRole('button',{name:'Open selection',exact:true}).click();
  await page.getByText('Batch metadata operation',{exact:true}).click();
  await page.getByLabel('Metadata field',{exact:true}).fill('dc.description');
  await page.getByLabel('Complete replacement value array',{exact:true}).fill(JSON.stringify([{value:'Reviewed collection description',language:'en',authority:null,confidence:-1,place:0}]));
  const batchResult=await action('prepare-plan',()=>page.getByRole('button',{name:'Prepare selection metadata plan',exact:true}).click());
  const batch=server.workspace.read('plans',batchResult.plan_id);
  assert.equal(batch.steps.length,44);
  assert.equal(new Set(batch.steps.map(s=>s.subject_id)).size,44);
  assert.ok(batch.steps.every(s=>s.source_capture_id&&s.args.operations[0].path==='/metadata/dc.description'));
  await mark('complete-cohort-operation',{plan_id:batchResult.plan_id,steps:44});

  await nav('handover');
  await page.getByText('Receive a supporting file',{exact:true}).click();
  const supportingPath=join(root,'source-captures/public-reader/manifest.json'), supportingBytes=await readFile(supportingPath);
  await page.locator('#supporting-file').setInputFiles(supportingPath);
  const assetResult=await action('upload-asset',()=>page.getByRole('button',{name:'Retain supporting file',exact:true}).click());
  const asset=server.workspace.state().assets.find(a=>a.id===assetResult.asset_id);
  assert.equal(asset.sha256,sha(supportingBytes));
  const receivedAsset=await downloadFrom(()=>page.locator('#asset-list .file-row').filter({hasText:asset.sha256}).getByRole('button',{name:'Download exact file',exact:true}).click(),join(output,'received-original-manifest.json'));
  assert.deepEqual(receivedAsset,supportingBytes);
  await mark('original-file-retaining-and-download',{asset_id:asset.id,bytes:supportingBytes.length,sha256:asset.sha256});

  const lostName='Recovered original cohort selection';
  let interruptedInput;
  await page.route('**/api/actions/save-selection',async route=>{
    interruptedInput=route.request().postDataJSON();
    const committed=await route.fetch();assert.equal(committed.ok(),true);
    await route.abort('failed');
  },{times:1});
  await nav('records');await page.locator('#record-filter').fill('');await page.locator('#record-scope').selectOption(collectionUuid);
  await page.locator('#select-filtered-records').click();await page.getByLabel('Selection name',{exact:true}).fill(lostName);
  await page.getByRole('button',{name:'Save selected items',exact:true}).click();
  await nav('activity');
  await page.locator('#pending-request-list .record-card').filter({hasText:'save selection'}).waitFor();
  await page.reload();await page.locator('#workspace-id').filter({hasText:/Revision/}).waitFor();await nav('activity');
  const replay=await action('save-selection',()=>page.locator('#pending-request-list .record-card').filter({hasText:interruptedInput.operationId}).getByRole('button',{name:'Retry saved request',exact:true}).click());
  assert.equal(replay.replayed,true);
  assert.equal(server.workspace.state().selections.filter(s=>s.name===lostName).length,1);
  await mark('lost-response-reopen-and-original-replay',{operation_id:interruptedInput.operationId,selection_id:replay.selection_id});

  await nav('activity');
  const captureSummary=server.workspace.state().captures[0];
  await page.locator('#activity-table tr').filter({hasText:captureSummary.id}).getByRole('button',{name:'Inspect',exact:true}).click();
  const nativeCapture=server.workspace.read('captures',captureSummary.id,{offset:0,limit:100});
  const originalResponse=nativeCapture.requests.find(r=>r.body_sha256);
  const responseCard=page.locator('#activity-detail article').filter({hasText:originalResponse.body_sha256}).first();
  const downloadedResponse=await downloadFrom(()=>responseCard.getByRole('button',{name:'Download exact response bytes',exact:true}).click(),join(output,'received-original-response.json'));
  assert.equal(sha(downloadedResponse),originalResponse.body_sha256);
  await mark('native-response-download',{request_id:originalResponse.id,bytes:downloadedResponse.length,sha256:originalResponse.body_sha256});

  await nav('handover');await screenshot(page,'02-complete-handover-desktop.png');
  const beforeExport=server.workspace.state(), archivePath=join(output,'complete-workspace.sqlite');
  const archiveBytes=await downloadFrom(()=>page.locator('#export-workspace').click(),archivePath);
  assert.equal(archiveBytes.subarray(0,16).toString(),'SQLite format 3\0');
  const archiveSha=sha(archiveBytes);
  await mark('complete-native-archive-download',{bytes:archiveBytes.length,sha256:archiveSha});

  receiver=await startServer({directory:join(output,'receiving-workspace')});
  const receivePage=await context.newPage();receivePage.setDefaultTimeout(25000);receivePage.on('pageerror',error=>pageErrors.push(error.message));
  await receivePage.goto(receiver.address);await fillOperator(receivePage);await nav('handover',receivePage);
  let receivingInput;
  await receivePage.route('**/api/receiving/archive',async route=>{
    receivingInput=JSON.parse(decodeURIComponent(route.request().headers()['x-workspace-metadata']));
    const committed=await route.fetch();assert.equal(committed.ok(),true);
    await route.abort('failed');
  },{times:1});
  await receivePage.locator('#import-file').setInputFiles(archivePath);await receivePage.locator('#preview-import').click();
  await nav('activity',receivePage);
  await receivePage.locator('#pending-request-list .record-card').filter({hasText:'receive archive'}).waitFor();
  await receivePage.reload();await receivePage.locator('#workspace-id').filter({hasText:/Revision/}).waitFor();await nav('activity',receivePage);
  await receivePage.locator('#pending-request-list .record-card').filter({hasText:receivingInput.receiving_id}).getByRole('button',{name:'Recover received archive',exact:true}).click();
  await receivePage.locator('#import-review').filter({hasText:archiveSha}).waitFor();
  let restoreInput;
  await receivePage.route('**/api/actions/restore-file',async route=>{
    restoreInput=route.request().postDataJSON();const committed=await route.fetch();
    assert.equal(committed.ok(),true);await route.abort('failed');
  },{times:1});
  await receivePage.getByRole('button',{name:'Restore into this empty workspace',exact:true}).click();
  await nav('activity',receivePage);
  await receivePage.locator('#pending-request-list .record-card').filter({hasText:'restore file'}).waitFor();
  const restoreReplay=await action('restore-file',()=>receivePage.locator('#pending-request-list .record-card').filter({hasText:restoreInput.operationId}).getByRole('button',{name:'Retry saved request',exact:true}).click(),receivePage);
  assert.equal(restoreReplay.replayed,true);
  const receivedState=receiver.workspace.state();
  for(const key of ['captures','profiles','selections','plans','executions','assets'])assert.deepEqual(receivedState[key],beforeExport[key],key+' complete receiving');
  assert.deepEqual(objects(receiver.workspace),objects(server.workspace));
  assert.equal(receiver.workspace.read('plans',titleResult.plan_id).review.actor,actor);
  await mark('binary-receiving-and-restoring-recovery',{receiving_id:receivingInput.receiving_id,restore_operation_id:restoreInput.operationId,records:restoreReplay.records,files:restoreReplay.files,sha256:archiveSha});

  await nav('records',receivePage);await receivePage.locator('#record-filter').fill(personUuid);
  await receivePage.locator('#record-index .record-select').filter({hasText:personUuid}).click();
  await receivePage.setViewportSize({width:390,height:844});await screenshot(receivePage,'03-linked-person-mobile.png');
  await nav('handover',receivePage);await screenshot(receivePage,'04-received-handover-mobile.png');
  const originalPort=new URL(server.address).port;
  await page.close();await server.close();server=null;
  server=await startServer({directory:join(output,'original-workspace'),port:Number(originalPort)});
  const reopened=await context.newPage();reopened.setDefaultTimeout(25000);reopened.on('pageerror',error=>pageErrors.push(error.message));
  await reopened.goto(server.address);await reopened.locator('#workspace-id').filter({hasText:/Revision/}).waitFor();
  assert.deepEqual(server.workspace.state(),beforeExport);
  await nav('changes',reopened);
  await reopened.locator('#plan-index .record-select').filter({hasText:'Review original publication title'}).click();
  await reopened.locator('#plan-detail').filter({hasText:'APPROVED'}).waitFor();
  assert.deepEqual(pageErrors,[]);
  await mark('process-reopen-desktop-and-mobile',{reopened_revision:server.workspace.state().revision,page_errors:pageErrors.length,viewports:['1440x1000','390x844']});
  saved.status='PASS';saved.finished_at=new Date().toISOString();saved.workspace=server.workspace.state();saved.archive={filename:'complete-workspace.sqlite',bytes:archiveBytes.length,sha256:archiveSha};
  await writeFile(resultPath,JSON.stringify(saved,null,2)+'\n');process.stdout.write(JSON.stringify({status:'PASS',result:resultPath})+'\n');
}catch(error){
  saved.status='FAILED';saved.failed_at=new Date().toISOString();saved.error={message:error.message,stack:error.stack};saved.page_errors=pageErrors;
  await writeFile(resultPath,JSON.stringify(saved,null,2)+'\n');
  if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});
  process.stderr.write(error.stack+'\n');process.exitCode=1;
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(receiver)await receiver.close().catch(()=>{});
  if(server)await server.close().catch(()=>{});
}
