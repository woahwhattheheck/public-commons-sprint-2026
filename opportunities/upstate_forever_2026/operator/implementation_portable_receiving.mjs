#!/usr/bin/env node
/* One operated acceptance journey for the exact ES-FIELD12 portable artifact. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const argv = process.argv.slice(2), options = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || !argv[i + 1]) throw Error('Arguments are --html FILE --out DIRECTORY [--playwright-module FILE] [--chromium FILE].');
  options[argv[i].slice(2)] = argv[i + 1];
}
for (const key of Object.keys(options)) if (!['html','out','playwright-module','chromium'].includes(key)) throw Error('Unknown option: ' + key);
if (!options.html || !options.out) throw Error('Provide the actual saved HTML and a new private output directory.');
const htmlPath = path.resolve(options.html), output = path.resolve(options.out);
const expected = {bytes:285878, sha256:'a69e977cefd9122bc3885d21f5b21cfa15f640964e2f7d78d89a54a1081a7f94'};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const html = await fs.readFile(htmlPath);
assert.equal(html.length, expected.bytes, 'Original portable artifact bytes');
assert.equal(digest(html), expected.sha256, 'Original portable artifact SHA256');
await fs.mkdir(output, {recursive:false});
const playwright = options['playwright-module']
  ? await import(pathToFileURL(path.resolve(options['playwright-module'])).href)
  : await import('playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw Error('The provided original Playwright module does not expose chromium.');
const result = {
  schema:'upstate.implementation-browser-acceptance/v1',
  operation:'ES-FIELD12-PORTABLE-BROWSER-20261013',
  purpose:'A clearly labeled browser acceptance plan operated through the shipped controls.',
  input:{path:htmlPath,...expected},
  host:os.hostname(), node:process.version,
  chromium_executable:options.chromium || chromium.executablePath(),
  playwright_module:options['playwright-module'] || 'playwright',
  started_at:new Date().toISOString(), complete:false,
  steps:[], downloads:[], screenshots:[], layout:[], console_errors:[], page_errors:[]
};
const writeResult = async () => fs.writeFile(path.join(output,'acceptance-result.json'), JSON.stringify(result,null,2)+'\n');
let browser, context, page, currentStep = 'launch';
const fileRecord = async file => {const bytes=await fs.readFile(file); return {path:file,bytes:bytes.length,sha256:digest(bytes)};};
async function recordStep(name, work) {
  currentStep=name;
  const start=new Date().toISOString();
  await work();
  result.steps.push({name,started_at:start,completed_at:new Date().toISOString()});
  await writeResult();
}
function button(action, extra='') { return page.locator('[data-impl="'+action+'"]'+extra).first(); }
function form() { return page.locator('dialog[open] form[data-impl-form]'); }
async function fill(name,value) { await form().locator('[name="'+name+'"]').fill(String(value)); }
async function select(name,value) { await form().locator('[name="'+name+'"]').selectOption(String(value)); }
async function submit() {
  const invalid = await form().evaluate(node => [...node.elements].filter(x => x.willValidate && !x.checkValidity()).map(x => ({name:x.name,message:x.validationMessage})));
  assert.deepEqual(invalid, [], 'The operated form is valid: '+JSON.stringify(invalid));
  await form().locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('dialog[open]') || !!document.querySelector('dialog[open] [role="alert"]'));
  const error=await page.locator('dialog[open] [role="alert"]').allTextContents();
  assert.deepEqual(error, [], 'Form result: '+error.join('\n'));
  assert.equal(await page.locator('dialog[open]').count(),0);
}
async function tab(name) { await button('tab','[data-tab="'+name+'"]').click(); }
async function snapshot() { return page.evaluate(() => JSON.parse(JSON.stringify(window.implementationWorkbench.plan))); }
async function saveDownload(action, name, extra='') {
  const ready = page.waitForEvent('download');
  await button(action,extra).click();
  const download=await ready, destination=path.join(output,name);
  await download.saveAs(destination);
  assert.equal(await download.failure(),null,'Complete original browser download');
  const record={...(await fileRecord(destination)),suggested_filename:download.suggestedFilename(),action};
  result.downloads.push(record);
  return destination;
}
async function screen(name) {
  const destination=path.join(output,name);
  await page.screenshot({path:destination,fullPage:true});
  result.screenshots.push(await fileRecord(destination));
}
async function inspectLayout(view) {
  const state=await page.evaluate(() => {
    const root=document.documentElement, width=innerWidth;
    const dialog=document.querySelector('dialog[open]');
    const box=dialog?.getBoundingClientRect();
    const visibleButtons=[...document.querySelectorAll('.iw-header button,.iw-toolbar button,.iw-tabs button')]
      .filter(n=>n.getClientRects().length).map(n=>({label:n.textContent.trim(),rect:n.getBoundingClientRect().toJSON()}));
    const tableWraps=[...document.querySelectorAll('.iw-table-wrap')].map(n=>({client_width:n.clientWidth,scroll_width:n.scrollWidth,overflow_x:getComputedStyle(n).overflowX}));
    return {viewport:{width,height:innerHeight},document_width:root.scrollWidth,body_width:document.body.scrollWidth,
      dialog:box?{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width}:null,
      visible_buttons:visibleButtons,table_wraps:tableWraps};
  });
  result.layout.push({view,...state});
  assert.ok(state.document_width<=state.viewport.width+2, view+' has page-wide horizontal overflow');
  if(state.dialog) assert.ok(state.dialog.left>=-1 && state.dialog.right<=state.viewport.width+1,view+' dialog extends outside phone width');
  for(const wrap of state.table_wraps) if(wrap.scroll_width>wrap.client_width+2) assert.ok(['auto','scroll'].includes(wrap.overflow_x),view+' long table has no horizontal scrolling');
}
try {
  browser=await chromium.launch({headless:true,...(options.chromium?{executablePath:path.resolve(options.chromium)}:{})});
  result.browser_version=browser.version();
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await context.newPage();
  page.on('pageerror',error=>result.page_errors.push({message:error.message,stack:error.stack}));
  page.on('console',message=>{if(message.type()==='error')result.console_errors.push(message.text());});
  page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
  await recordStep('open exact portable artifact',async()=>{
    await page.goto(pathToFileURL(htmlPath).href,{waitUntil:'load'});
    await page.waitForFunction(()=>window.implementationWorkbench?.plan && document.querySelector('[data-impl="new"]'));
    assert.equal(await page.locator('.iw-header h2').count(),1);
  });
  await recordStep('new named plan and complete method workflow',async()=>{
    await button('new').click();
    await button('settings').click();
    await fill('title','Acceptance — FIELD12 portable — 2026-10-13');
    await fill('description','Browser acceptance workflow. All work, cost and field entries in this plan are acceptance inputs.');
    await fill('start_date','2026-10-13');
    await submit();
    await button('method').click();
    await select('method_id','riparian-buffer');
    await submit();
    const plan=await snapshot();
    result.plan_id=plan.id; result.method_task_ids=plan.tasks.map(x=>x.id);
    assert.ok(plan.tasks.length>1,'The complete method creates its multi-step workflow');
    await tab('tasks');
    await button('edit','[data-collection="tasks"]').click();
    await fill('assignee','Acceptance operator');
    await fill('duration_days','2');
    await select('status','in_progress');
    await fill('progress_pct','25');
    await fill('notes','Acceptance input: inspect assigned work and original method dependencies.');
    await submit();
    const changed=(await snapshot()).tasks[0];
    assert.equal(changed.duration_days,2);
    assert.equal(changed.assignee,'Acceptance operator');
    assert.equal(changed.progress_pct,25);
    result.edited_task_id=changed.id;
  });
  await recordStep('three exact-cent cost entries and editable reopen',async()=>{
    await tab('budget');
    for(const [kind,amount] of [['budget','12.34'],['commitment','5.00'],['actual','3.25']]) {
      await button('add','[data-collection="budget_lines"]').click();
      await select('kind',kind);
      await fill('label','Acceptance '+kind);
      await fill('amount',amount);
      await fill('reference','Acceptance input');
      await select('task_id',result.edited_task_id);
      await submit();
    }
    const plan=await snapshot();
    assert.deepEqual(plan.budget_lines.map(x=>[x.kind,x.amount_minor]),[['budget',1234],['commitment',500],['actual',325]]);
    await button('edit','[data-collection="budget_lines"]').click();
    assert.equal(await form().locator('[name="amount"]').inputValue(),'12.34');
    await fill('label','Acceptance budget reopened');
    await submit();
    await screen('desktop-costs.png');
    await inspectLayout('desktop costs');
  });
  await recordStep('site and completed acceptance visit',async()=>{
    await tab('sites');
    await button('add','[data-collection="sites"]').click();
    await fill('label','Acceptance site');
    await submit();
    result.site_id=(await snapshot()).sites[0].id;
    await tab('field');
    await button('add','[data-collection="visits"]').click();
    await select('site_id',result.site_id);
    await fill('planned_date','2026-10-13');
    await fill('visited_at','2026-10-13T09:30:00Z');
    await fill('observer','Acceptance operator');
    await select('status','complete');
    await fill('notes','Browser acceptance entry for this product journey.');
    await submit();
    result.visit_id=(await snapshot()).visits[0].id;
  });
  const acceptanceFile=path.join(output,'acceptance-field-marker.png');
  const acceptanceBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMICAj4DwAD1AHw410Q2gAAAABJRU5ErkJggg==','base64');
  await fs.writeFile(acceptanceFile,acceptanceBytes);
  await recordStep('original field file attached to its visit',async()=>{
    await tab('field');
    await page.locator('[data-iw-evidence="add"][data-collection="visits"][data-id="'+result.visit_id+'"]').click();
    const capture=page.locator('dialog[open] form[data-iw-evidence-form]');
    await capture.locator('[name="evidence_files"]').setInputFiles(acceptanceFile);
    await capture.locator('[name="evidence_label"]').fill('Acceptance original image');
    await capture.locator('button[type="submit"]').click();
    await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
    const plan=await snapshot(),link=plan.source_links.find(row=>row.sha256===digest(acceptanceBytes));
    assert.ok(link,'Captured original has its actual SHA256');
    assert.equal(link.size_bytes,acceptanceBytes.length);
    assert.ok(plan.visits.find(row=>row.id===result.visit_id).evidence_refs.includes(link.id));
    result.evidence_source_id=link.id;
  });
  await recordStep('structured field form with integers and original quantity units',async()=>{
    await button('field-form').click();
    await select('fieldform_template','buffer-followup');
    await page.waitForSelector('dialog[open] [name="answer__inspected_plants"]');
    await select('visit_id',result.visit_id);
    await fill('collected_at','2026-10-13T09:30:00Z');
    await select('kind','inspection');
    await select('task_id',result.edited_task_id);
    await fill('answer__inspected_plants','10');
    await fill('answer__living_plants','9');
    await fill('answer__plant_count_basis','Acceptance input: ten inspected individuals.');
    await fill('answer__observed_cover','90');
    await fill('answer__observed_cover__unit','percent');
    await fill('answer__replacement_needs','Acceptance input: review follow-up entry.');
    await form().locator('[name="answer__photo_refs"][value="'+result.evidence_source_id+'"]').check();
    await submit();
    const plan=await snapshot(), activity=plan.activities.at(-1);
    result.activity_id=activity.id; result.observation_ids=plan.observations.map(x=>x.id);
    assert.equal(activity.visit_id,result.visit_id);
    assert.equal(activity.site_id,result.site_id);
    assert.equal(activity.form_response.template.id,'buffer-followup');
    assert.deepEqual(activity.form_response.answers.inspected_plants,{value:10,unit:'1',original_text:'10'});
    assert.deepEqual(activity.form_response.answers.living_plants,{value:9,unit:'1',original_text:'9'});
    assert.deepEqual(activity.form_response.answers.observed_cover,{value:90,unit:'percent',original_text:'90'});
    assert.equal(activity.form_response.raw_answers.observed_cover__unit,'percent');
    assert.deepEqual(activity.form_response.answers.photo_refs.references,[result.evidence_source_id]);
    assert.ok(activity.evidence_refs.includes(result.evidence_source_id));
    assert.ok(plan.observations.every(x=>x.activity_id===activity.id));
    assert.ok(plan.observations.some(x=>x.value===90&&x.unit==='percent'&&x.original_text==='90'));
    assert.ok(plan.observations.some(x=>x.result_type==='text'&&x.value===null&&x.original_text.includes('Acceptance input')));
    await screen('desktop-field-records.png');
    await inspectLayout('desktop field records');
  });
  let originalJSON, originalDocument;
  await recordStep('JSON export import and browser-draft continuity',async()=>{
    await button('save').click();
    originalJSON=await saveDownload('export-json','acceptance-plan-original.json');
    originalDocument=JSON.parse(await fs.readFile(originalJSON,'utf8'));
    assert.equal(originalDocument.id,result.plan_id);
    await button('new').click();
    assert.notEqual((await snapshot()).id,result.plan_id);
    await page.locator('[data-impl-file]').setInputFiles(originalJSON);
    await page.waitForFunction(id=>window.implementationWorkbench.plan.id===id,result.plan_id);
    assert.deepEqual(await snapshot(),originalDocument,'Complete original JSON survives visible file import');
    await button('save').click();
    const roundtrip=await saveDownload('export-json','acceptance-plan-roundtrip.json');
    assert.equal(await fs.readFile(roundtrip,'utf8'),await fs.readFile(originalJSON,'utf8'),'Export/import preserves the complete JSON document');
    await page.reload({waitUntil:'load'});
    await page.waitForSelector('[data-impl-change="plan"]');
    await page.locator('[data-impl-change="plan"]').selectOption(result.plan_id);
    await page.waitForFunction(id=>window.implementationWorkbench.plan.id===id,result.plan_id);
    assert.deepEqual(await snapshot(),originalDocument,'Browser reload retains the saved original plan and all relationships');
  });
  await recordStep('complete original-file ZIP reopens in a fresh browser context',async()=>{
    await tab('handover');
    const ready=page.waitForEvent('download');
    await page.locator('[data-iw-evidence="export"]').click();
    const emitted=await ready,bundlePath=path.join(output,'acceptance-complete-files.zip');
    await emitted.saveAs(bundlePath);assert.equal(await emitted.failure(),null);
    result.downloads.push({...await fileRecord(bundlePath),action:'evidence-export',suggested_filename:emitted.suggestedFilename()});
    const restoredContext=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
    try{
      const restored=await restoredContext.newPage();
      restored.on('pageerror',error=>result.page_errors.push({message:error.message,stack:error.stack,source:'file-package-restore'}));
      await restored.goto(pathToFileURL(htmlPath).href,{waitUntil:'load'});
      await restored.waitForSelector('[data-impl-change="plan"]');
      await restored.locator('[data-impl="tab"][data-tab="handover"]').click();
      await restored.locator('[data-iw-evidence-bundle]').setInputFiles(bundlePath);
      await restored.waitForFunction(id=>window.implementationWorkbench.plan.id===id,result.plan_id);
      assert.deepEqual(await restored.evaluate(()=>window.implementationWorkbench.plan),originalDocument,'Complete plan survives independent file-package import');
      await restored.locator('[data-iw-evidence="preview"][data-id="'+result.evidence_source_id+'"]').click();
      await restored.waitForFunction(()=>{const image=document.querySelector('dialog[open] .iw-evidence-preview');return image?.complete&&image.naturalWidth===1;});
      await restored.screenshot({path:path.join(output,'desktop-original-image.png'),fullPage:true});
      result.screenshots.push(await fileRecord(path.join(output,'desktop-original-image.png')));
      await restored.locator('dialog[open] [data-impl="close-dialog"]').click();
      const downloadReady=restored.waitForEvent('download');
      await restored.locator('[data-iw-evidence="download"][data-id="'+result.evidence_source_id+'"]').click();
      const original=await downloadReady,destination=path.join(output,'acceptance-restored-field-marker.png');
      await original.saveAs(destination);assert.equal(await original.failure(),null);
      assert.deepEqual(await fs.readFile(destination),acceptanceBytes,'The original attachment bytes survive ZIP and fresh browser restore');
      result.downloads.push({...await fileRecord(destination),action:'restored-original',suggested_filename:original.suggestedFilename()});
      await restored.screenshot({path:path.join(output,'desktop-file-handover.png'),fullPage:true});
      result.screenshots.push(await fileRecord(path.join(output,'desktop-file-handover.png')));
    }finally{await restoredContext.close();}
  });
  await recordStep('complete CSV and readable HTML handover',async()=>{
    await tab('handover');
    for(const collection of ['tasks','budget_lines','activities','observations']) {
      const file=await saveDownload('csv','acceptance-'+collection+'.csv','[data-collection="'+collection+'"]');
      const csv=await fs.readFile(file,'utf8');
      assert.ok(csv.length>0 && csv.includes('id'),collection+' CSV has original columns');
      if(collection==='activities') assert.ok(csv.includes('form_response')&&csv.includes('buffer-followup'),'Activity CSV carries the complete structured form');
      if(collection==='observations') assert.ok(csv.includes('percent')&&csv.includes('90'),'Observation CSV retains original quantity and unit');
      if(collection==='budget_lines') assert.ok(csv.includes('1234'),'Cost CSV retains integer cents');
    }
    const report=await saveDownload('report','acceptance-report.html');
    const reportPage=await context.newPage();
    reportPage.on('pageerror',error=>result.page_errors.push({message:error.message,stack:error.stack,source:'report'}));
    await reportPage.goto(pathToFileURL(report).href,{waitUntil:'load'});
    const text=await reportPage.locator('body').innerText();
    for(const expectedText of ['Acceptance — FIELD12 portable — 2026-10-13','Acceptance budget reopened','Acceptance site','percent','90','buffer-followup']) {
      assert.ok(text.includes(expectedText),'HTML report visibly retains '+expectedText);
    }
    const reportShot=path.join(output,'desktop-report.png');
    await reportPage.screenshot({path:reportShot,fullPage:true});
    result.screenshots.push(await fileRecord(reportShot));
    await reportPage.close();
  });
  await recordStep('desktop and 390px phone layout and controls',async()=>{
    await tab('overview');
    await screen('desktop-overview.png');
    await inspectLayout('desktop overview');
    await page.setViewportSize({width:390,height:844});
    await tab('field');
    await screen('phone-field-records.png');
    await inspectLayout('phone field records');
    await button('field-form').click();
    await select('fieldform_template','buffer-followup');
    await page.waitForSelector('dialog[open] [name="answer__inspected_plants"]');
    await screen('phone-structured-form.png');
    await inspectLayout('phone structured form');
    await button('close-dialog').click();
    await tab('handover');
    await screen('phone-handover.png');
    await inspectLayout('phone handover');
    const phoneJSON=await saveDownload('export-json','acceptance-plan-phone.json');
    assert.deepEqual(JSON.parse(await fs.readFile(phoneJSON,'utf8')),originalDocument,'Phone export preserves the same complete plan');
    assert.deepEqual(result.page_errors,[],'No browser page exceptions');
    assert.deepEqual(result.console_errors,[],'No browser console errors');
  });
  result.complete=true;
  result.completed_at=new Date().toISOString();
  await writeResult();
  console.log(JSON.stringify({complete:true,operation:result.operation,plan_id:result.plan_id,output,result:path.join(output,'acceptance-result.json')}));
} catch(error) {
  result.failed_step=currentStep;
  result.error={name:error.name,message:error.message,stack:error.stack};
  result.failed_at=new Date().toISOString();
  if(page) {
    try {await screen('failure.png');} catch {}
    try {await fs.writeFile(path.join(output,'failure-page.html'),await page.content());} catch {}
    try {await fs.writeFile(path.join(output,'failure-plan.json'),JSON.stringify(await snapshot(),null,2)+'\n');} catch {}
  }
  await writeResult();
  console.error(JSON.stringify({complete:false,failed_step:currentStep,error:result.error,output}));
  process.exitCode=1;
} finally {
  if(context) await context.close();
  if(browser) await browser.close();
}
