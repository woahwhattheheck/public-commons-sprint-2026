// MIT. Actual industrial WQX scientific form, complete downloads and independent receiving.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, chmod, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { privateDirectory, atomicJson } from '../../routescan/quota.mjs';
import { startWaterQualityWorkspace } from '../workspace.mjs';
import { readStandardizedReview, exportStandardizedReview } from './workflow.mjs';
import { scientificFile, scientificJson, scientificRetain, scientificReceipt, completeScientificPhase,
  checkScientificCohort, SCIENTIFIC_FORMATS } from './receiving.mjs';

const transport={request:async()=>{throw new Error('Keep the retained original scientific capture.');}};
const gc=()=>globalThis.gc?.();
export async function receiveScientificBrowser(value) {
  const prior=await scientificReceipt(value,'browser');if(prior)return prior;
  const native=await scientificReceipt(value,'native');assert(native);
  const directory=await privateDirectory(join(value.root,'browser')),temporary=await privateDirectory(join(directory,'temporary'));
  const progressFile=join(directory,'progress.json');
  const progress=await scientificJson(progressFile)??{requestSha256:value.requestSha256,downloads:{},screenshots:{},stages:[]};
  assert.equal(progress.requestSha256,value.requestSha256);
  const checkpoint=async stage=>{progress.stages.push(stage);await atomicJson(directory,'progress.json',progress);};
  const {chromium}=createRequire(import.meta.url)(value.original.playwrightModule??'playwright');
  const browser=await chromium.launch({headless:true,executablePath:value.original.chromiumExecutable,
    args:['--no-sandbox','--disable-dev-shm-usage',...(value.original.chromiumArgs??[])],
    env:{...process.env,TMPDIR:temporary,...(value.original.chromiumLibraryPath?
      {LD_LIBRARY_PATH:value.original.chromiumLibraryPath+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')}:{})}});
  let workspace,context,page;
  const errors=[];
  async function idle(){await page.waitForFunction(()=>document.getElementById('sa-controls').disabled===false,{},{timeout:600000});}
  async function stop(){await context?.close();context=null;page=null;await workspace?.close();workspace=null;gc();}
  async function start(project) {
    workspace=await startWaterQualityWorkspace({directory:project,port:0,transport});
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    page=await context.newPage();page.setDefaultTimeout(600000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(workspace.url,{waitUntil:'domcontentloaded'});
    await page.locator('[data-tab="standardized-analysis"]').click();await idle();
  }
  async function responseFor(action,path,method='POST') {
    const waiting=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()===method,{timeout:600000});
    await action();const response=await waiting,value=await response.json();
    assert(response.ok(),value.error?.message??value.error??('The scientific UI request failed: '+path));await idle();return value;
  }
  async function openReview(id) {
    const row=page.locator('#sa-saved .record').filter({has:page.locator('p').filter({hasText:id+' ·'})});
    return responseFor(()=>row.getByRole('button',{name:'Open scientific review',exact:true}).click(),
      '/api/standardized-analysis/'+encodeURIComponent(id),'GET');
  }
  async function download(format) {
    if(progress.downloads[format]){const file=await scientificFile(progress.downloads[format].file);
      assert.equal(file.sha256,progress.downloads[format].sha256);return progress.downloads[format];}
    const selector='#sa-downloads a[href="/api/standardized-analysis/'+value.ids.current+'/'+format+'"]';
    const waiting=page.waitForEvent('download');await page.locator(selector).click();
    const downloaded=await waiting,name=downloaded.suggestedFilename();assert.equal(name,basename(name));assert(!name.includes('\\'));
    const temporaryFile=join(temporary,randomUUID()),target=join(directory,name);
    try {
      await downloaded.saveAs(temporaryFile);await chmod(temporaryFile,0o600);assert.equal(await downloaded.failure(),null);
      const observed=await scientificFile(temporaryFile);
      assert.equal(observed.sha256,native.exports[format].sha256);assert.equal(observed.bytes,native.exports[format].bytes);
      try{await copyFile(temporaryFile,target,constants.COPYFILE_EXCL);await chmod(target,0o600);}
      catch(error){if(error.code!=='EEXIST')throw error;}
      const retained=await scientificFile(target);assert.equal(retained.sha256,observed.sha256);
      progress.downloads[format]=retained;await checkpoint('download-'+format);return retained;
    } finally {await unlink(temporaryFile).catch(error=>{if(error.code!=='ENOENT')throw error;});await downloaded.delete();}
  }
  async function inspectDisplay(role) {
    assert((await page.locator('#sa-metrics').textContent()).includes('1035'));
    await page.locator('#sa-search').fill('wqx-record-e7dcd103f470f706bc66c0589322d6de9cc4925e950981da060ab9c41c2bfbb4');
    const text=await page.locator('#sa-observations').textContent();assert(text.includes('4.65')&&text.includes('4650')&&text.includes('ug/L'));
    await page.locator('#sa-observations button').click();
    const row=JSON.parse(await page.locator('#sa-row-json').textContent());
    assert.equal(row.reporting.limits[0].value,'60');assert.equal(row.limits[0].value,'0.06');
    await page.locator('#sa-search').fill('');await page.locator('#sa-row-filter').selectOption('censored');
    assert((await page.locator('#sa-rows-page').textContent()).startsWith('452 rows'));
    await page.locator('#sa-row-filter').selectOption('all');await page.locator('#sa-group-representation').selectOption('original');
    assert((await page.locator('#sa-groups-page').textContent()).startsWith('279 rows'));
    await page.locator('#sa-group-representation').selectOption('reviewed');
    assert(await page.locator('#sa-comparison').isVisible());
    for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]]) {
      await page.setViewportSize({width,height});
      const dimensions=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert(dimensions.page<=dimensions.viewport,'The scientific workspace exceeds its mobile viewport.');
      const screenshot=join(directory,role+'-'+name+'.png');
      if(!progress.screenshots[role+'-'+name])
        progress.screenshots[role+'-'+name]=await scientificRetain(screenshot,await page.screenshot({fullPage:true}));
    }
    await page.setViewportSize({width:1440,height:1000});await checkpoint(role+'-display');
  }
  try {
    await start(value.author);
    let current=await openReview(value.ids.current);assert.equal(current.reviewSha256,native.quarter.reviewSha256);checkScientificCohort(current);current=null;gc();
    await inspectDisplay('author');
    const existing=(await workspace.project.read())&&await scientificJson(join(value.author,'standardized-analysis',value.ids.browser+'.json'));
    if(!existing) {
      await page.locator('#sa-new').click();
      await page.locator('#sa-id').fill(value.ids.browser);
      await page.locator('#sa-title').fill('Potomac browser review — March against January');
      await page.locator('#sa-previous').selectOption('');
      await page.locator('#sa-start').fill('2025-03-01');await page.locator('#sa-end').fill('2025-03-31');
      await page.locator('#sa-baseline-start').fill('2025-01-01');await page.locator('#sa-baseline-end').fill('2025-01-31');
      assert(await page.locator('#sa-save').isDisabled());assert(await page.locator('#sa-downloads').isHidden());
      let preview=await responseFor(()=>page.locator('#sa-preview').click(),'/api/standardized-analysis/preview');
      assert.equal(preview.analysis.inventory.selectedRows,418);assert.equal(preview.analysis.reviewed.baseline.inventory.selectedRows,140);
      assert.equal(preview.analysis.reviewed.comparison.filter(row=>row.comparable).length,64);preview=null;gc();
      assert(!(await page.locator('#sa-save').isDisabled()));
      let saved=await responseFor(()=>page.locator('#sa-save').click(),'/api/standardized-analysis');
      checkScientificCohort(saved,{period:true,comparison:false});progress.browserReview={reviewId:saved.reviewId,reviewSha256:saved.reviewSha256};saved=null;gc();
      assert(await page.locator('#sa-save').isDisabled());
    } else {checkScientificCohort(existing,{period:true,comparison:false});progress.browserReview={reviewId:existing.reviewId,reviewSha256:existing.reviewSha256};}
    await openReview(value.ids.current);
    for(const format of SCIENTIFIC_FORMATS)await download(format);
    await stop();
    // The original authoring listener is closed before the independent receiving listener starts.
    const receivingDirectory=join(value.root,'browser-received-project');
    await start(receivingDirectory);
    const receivedFile=join(receivingDirectory,'standardized-analysis',value.ids.current+'.json');
    let received=await scientificJson(receivedFile);
    if(!received) {
      await page.locator('#sa-receive-file').evaluate(element=>{for(let node=element.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});
      await page.locator('#sa-receive-file').setInputFiles(progress.downloads.bundle.file);
      received=await responseFor(()=>page.locator('#sa-receive-form button[type="submit"]').click(),'/api/standardized-analysis/receive');
    } else await openReview(value.ids.current);
    assert.equal(received.reviewSha256,native.quarter.reviewSha256);checkScientificCohort(received);received=null;gc();
    await inspectDisplay('receiver');
    for(const format of SCIENTIFIC_FORMATS) {
      let file=await exportStandardizedReview({project:workspace.project,reviewId:value.ids.current,format});
      const expected=native.exports[format];
      // This is the full original server export, independently recomputed after receiving.
      const {createHash}=await import('node:crypto');
      assert.equal(createHash('sha256').update(file.bytes).digest('hex'),expected.sha256);assert.equal(file.bytes.length,expected.bytes);file=null;gc();
    }
    await stop();await start(receivingDirectory);
    let cold=await openReview(value.ids.current);assert.equal(cold.reviewSha256,native.quarter.reviewSha256);checkScientificCohort(cold);cold=null;gc();
    assert.deepEqual(errors,[],'The native scientific browser emitted an application error.');
    await checkpoint('complete-cold-reopen');
    await stop();
    const files=[...Object.values(progress.downloads),...Object.values(progress.screenshots)];
    return completeScientificPhase(value,'browser',{review:progress.browserReview,current:native.quarter,
      exportedFormats:SCIENTIFIC_FORMATS.length,receiver:receivingDirectory,errors,stages:progress.stages},files);
  } finally {try{await stop();}finally{await browser.close();}}
}
