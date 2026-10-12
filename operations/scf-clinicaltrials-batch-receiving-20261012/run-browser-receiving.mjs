// MIT. Operate the original public PRS examples through the complete batch browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(value,message)=>{if(!value)throw new Error(message);};
export async function runBatchReceiving({consoleUrl,sourceRoot,exampleDirectory,outputDirectory}) {
  await fs.mkdir(outputDirectory,{recursive:true,mode:0o700});
  const require=createRequire(process.env.SCF_PLAYWRIGHT_PACKAGE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
  const {chromium}=require('playwright');
  const url=new URL(consoleUrl),token=url.hash.slice(1).replace(/^token=/,'');
  const report={schema:'stellar-forge.clinicaltrials-batch-browser.v1',startedAt:new Date().toISOString(),phases:[],pageErrors:[],downloads:[]};
  const save=()=>fs.writeFile(path.join(outputDirectory,'browser-operation.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  const phase=async(name,value={})=>{report.phases.push({phase:name,at:new Date().toISOString(),...value});await save();};
  let browser,context,page;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.SCF_BROWSER_EXECUTABLE||'/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell',
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=1']});
    context=await browser.newContext({viewport:{width:1380,height:960},acceptDownloads:true});
    page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
    await page.goto(consoleUrl,{waitUntil:'domcontentloaded',timeout:90000});
    await page.getByRole('button',{name:'05 / Batch receiving',exact:true}).click();
    await page.locator('#section-batch').waitFor({state:'visible'});
    const read=route=>page.evaluate(async({route,token})=>{
      const r=await fetch(route,{headers:{Authorization:'Bearer '+token}});
      const value=await r.json();if(!r.ok)throw new Error(JSON.stringify(value));return value;
    },{route,token});
    const action=async(name,trigger)=>{
      const ready=page.waitForResponse(response=>{
        if(!response.url().endsWith('/api/clinical/action')||response.request().method()!=='POST')return false;
        try{return response.request().postDataJSON().action===name;}catch{return false;}
      },{timeout:180000});ready.catch(()=>{});
      await trigger();const response=await ready,value=await response.json();
      check(response.ok(),name+': '+JSON.stringify(value));return value;
    };
    const state=await read('/api/state');check(state.prs.length===0&&state.batches.length===0,'Operate a new original example workspace');
    const names=['1234.xml','study_file.xml','ct_safety_upload.xml'],sources={};
    for(const name of names){const bytes=await fs.readFile(path.join(exampleDirectory,name));sources[name]={bytes:bytes.length,sha256:sha(bytes)};}
    const entries=[
      {key:'EXAMPLE-PROTOCOL-A',file:'1234.xml',schema:'protocol',label:'Original published protocol',...sources['1234.xml'],sourceLinks:[]},
      {key:'EXAMPLE-PROTOCOL-B',file:'1234.xml',schema:'protocol',label:'Second client reference to the same original input',...sources['1234.xml'],sourceLinks:[]},
      {key:'EXAMPLE-FULL-STUDY',file:'study_file.xml',schema:'protocol',label:'Original published whole-study XML',...sources['study_file.xml'],sourceLinks:[]},
      {key:'EXAMPLE-PARTIAL-SAFETY',file:'ct_safety_upload.xml',schema:'results',label:'Original published partial safety upload',...sources['ct_safety_upload.xml'],sourceLinks:[]},
    ];
    await page.locator('#batch-name').fill('Published PRS examples — disclosure receiving');
    await page.locator('#batch-reviewer').fill('TokenJunkieLabs receiving operator');
    await page.locator('#batch-note').fill('Original eudract 1.1.1 published example files. Client references demonstrate duplicate intake and exception review; original source and GPL-2 license accompany the receiving packet.');
    await page.getByText('Client manifest and original study links',{exact:true}).click();
    await page.locator('#batch-manifest').fill(JSON.stringify({entries}));
    await page.locator('#batch-files').setInputFiles(names.map(name=>path.join(exampleDirectory,name)));
    await page.waitForFunction(()=>document.querySelectorAll('#batch-intake-table tbody tr').length===4,undefined,{timeout:90000});
    await page.locator('#batch-retain-files').click();
    await page.waitForFunction(()=>!document.querySelector('#batch-create').disabled,undefined,{timeout:180000});
    let response=await action('batch.create',()=>page.locator('#batch-create').click());
    const batchId=response.result.id;report.batchId=batchId;report.input=entries;
    check(response.result.entries.length===4&&response.result.summary.uniqueInputs===3,'Original duplicate receiving identity');
    check(response.state.prs.length===3,'The same input bytes must be retained once');
    await phase('original_batch_intake',{batchId,entries:4,distinctInputs:3,documents:response.state.prs.map(x=>({id:x.id,schema:x.report.schemaKind,valid:x.report.schemaValid,legacy:x.report.legacyElements.length}))});
    const open=async key=>{
      await page.locator('#batch-table').getByRole('button',{name:key,exact:true}).click();
      await page.waitForFunction(key=>document.getElementById('batch-entry-title').textContent.startsWith(key+' —'),key);
      const batch=await read('/api/clinical/batch?batchId='+encodeURIComponent(batchId));
      const entry=batch.entries.find(x=>x.key===key);check(entry,'Original client reference exists');
      return read('/api/clinical/batch-entry?batchId='+encodeURIComponent(batchId)+'&entryId='+entry.id);
    };
    let current=await open('EXAMPLE-PROTOCOL-A');
    const legacy=current.document.report.legacyElements;
    check(legacy.length>0,'The original published protocol includes deprecated occurrences for reviewed modernization');
    await page.locator('#batch-plan-form').locator('xpath=..').evaluate(element=>{element.open=true;});
    for(const element of legacy){
      const row=page.locator('#batch-legacy-rows tr').filter({has:page.locator('[data-choice]')}).filter({has:page.locator('strong',{hasText:element.ruleId})});
      const exact=page.locator('#batch-legacy-rows tr[data-element-id="'+element.elementId+'"]');
      await exact.locator('[data-choice]').selectOption('remove');
      await exact.locator('[data-reason]').fill('Remove this explicitly reviewed deprecated occurrence from the published example. Its original value remains in the input and retained modernization plan.');
    }
    await page.locator('#batch-plan-reviewer').fill('TokenJunkieLabs receiving operator');
    await page.locator('#batch-plan-rationale').fill('Prepare the published legacy protocol against the retained current PRS schema; preserve exact input and each original decision.');
    response=await action('batch.plan',()=>page.locator('#batch-plan-form button[type=submit]').click());
    report.planId=response.result.references.planId;check(report.planId,'Original plan retained');
    await page.waitForFunction(()=>!document.getElementById('batch-apply-plan').disabled);
    response=await action('batch.apply',()=>page.locator('#batch-apply-plan').click());
    check(response.result.entry.inputDocumentId===sources['1234.xml'].sha256,'Input preserved after modernization');
    check(response.result.entry.documentId!==sources['1234.xml'].sha256,'Original engine retained a separate reviewed candidate');
    await phase('original_modernization',{planId:report.planId,input:sources['1234.xml'].sha256,candidate:response.result.entry.documentId,findings:response.result.entry.findings.length});
    current=await open('EXAMPLE-PROTOCOL-A');
    const previewSection=page.locator('#batch-preview-form').locator('xpath=..');
    await previewSection.evaluate(element=>{element.open=true;});
    await page.locator('#batch-preview-base').selectOption(sources['study_file.xml'].sha256);
    await page.locator('#batch-preview-reviewer').fill('TokenJunkieLabs receiving operator');
    response=await action('batch.preview',()=>page.locator('#batch-preview-form button[type=submit]').click());
    report.previewId=response.result.references.previewId;report.previewCandidate=response.result.references.candidateId;
    await page.locator('#batch-preview-result').getByRole('button',{name:'Read retained composition',exact:true}).click();
    await page.locator('#batch-preview-result').getByRole('button',{name:'Use this composed candidate',exact:true}).waitFor();
    await page.locator('#batch-candidate-form').locator('xpath=..').evaluate(element=>{element.open=true;});
    await page.locator('#batch-candidate-reviewer').fill('TokenJunkieLabs receiving operator');
    await page.locator('#batch-candidate-note').fill('Select the original engine’s reviewed composition of these two related published protocol examples; retain both original documents and its source-unit findings.');
    response=await action('batch.select',()=>page.locator('#batch-preview-result').getByRole('button',{name:'Use this composed candidate',exact:true}).click());
    check(response.result.entry.previewId===report.previewId,'Selected composition remains bound to its original preview');
    await phase('original_upload_composition',{previewId:report.previewId,candidate:response.result.entry.documentId,findings:response.result.entry.findings});
    async function disposition(key,intended,note){
      const detail=await open(key);
      const blocking=detail.entry.findings.some(f=>f.blocking);
      const decision=intended==='ready'&&blocking?'follow-up':intended;
      await page.locator('#batch-decision').selectOption(decision);
      await page.locator('#batch-decision-reviewer').fill('TokenJunkieLabs receiving operator');
      await page.locator('#batch-decision-note').fill(note+(blocking?' Original blocking findings remain selected for follow-up.':''));
      const result=await action('batch.review',()=>page.locator('#batch-review-form button[type=submit]').click());
      check(result.result.entry.review.decision===decision,'Actual disposition retained');
      return {key,decision,reviewId:result.result.entry.review.id,contextSha256:result.result.entry.contextSha256,documentId:result.result.entry.documentId};
    }
    report.dispositions=[];
    report.dispositions.push(await disposition('EXAMPLE-PROTOCOL-A','ready','Reviewed original modernization and composition, current XML inspection and preserved input history for this technical receiving example.'));
    report.dispositions.push(await disposition('EXAMPLE-PROTOCOL-B','exclude','The same exact published input is retained under a second client reference; this reference is excluded from the selected preparation scope while its original remains available.'));
    report.dispositions.push(await disposition('EXAMPLE-FULL-STUDY','ready','Reviewed the original whole-study example and its retained inspection for technical handover. Original deprecated values and source findings remain explicit in this source-preserving entry.'));
    report.dispositions.push(await disposition('EXAMPLE-PARTIAL-SAFETY','follow-up','Retained original partial safety upload for source-unit and base-document review before a complete customer update is selected.'));
    await phase('row_dispositions',{dispositions:report.dispositions});
    await page.locator('#batch-filter').selectOption('follow-up');
    check(await page.locator('#batch-table tbody tr').count()>=1,'Follow-up queue renders retained findings');
    await page.locator('#batch-filter').selectOption('all');
    response=await action('batch.export',()=>page.locator('#batch-export').click());
    report.export=response.result;check(report.export.kind==='prs-batch','Original dedicated batch export');
    await page.locator('#batch-exports').getByRole('button',{name:'disclosure-batch.zip',exact:true}).first().waitFor();
    const namesToRead=['disclosure-batch.zip','batch-register.csv','exceptions.csv','clinicaltrials-workspace.zip','HANDOVER.md'];
    for(const name of namesToRead){
      const expected=report.export.files.find(file=>file.name===name);check(expected,'Declared '+name);
      const ready=page.waitForEvent('download',{timeout:180000});ready.catch(()=>{});
      await page.locator('#batch-exports').getByRole('button',{name,exact:true}).first().click();
      const download=await ready;await download.saveAs(path.join(outputDirectory,name));
      const bytes=await fs.readFile(path.join(outputDirectory,name));
      check(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'Exact original download '+name);
      report.downloads.push({name,bytes:bytes.length,sha256:sha(bytes)});await save();
    }
    await page.locator('#batch-table').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(outputDirectory,'batch-desktop.png'),fullPage:true});
    await page.setViewportSize({width:412,height:915});
    await page.locator('#batch-table').scrollIntoViewIfNeeded();
    const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    check(layout.document<=layout.viewport+1,'Mobile page keeps its wide tables inside their scroll containers');
    await page.screenshot({path:path.join(outputDirectory,'batch-mobile.png'),fullPage:true});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'05 / Batch receiving',exact:true}).click();
    await page.locator('#batch-table').getByRole('button',{name:'EXAMPLE-PROTOCOL-A',exact:true}).waitFor();
    const reopened=await read('/api/clinical/batch?batchId='+encodeURIComponent(batchId));
    check(reopened.entries.length===4&&reopened.entries.every(entry=>entry.review),'Same browser session reopens the original reviewed batch');
    check(report.pageErrors.length===0,'Browser page errors: '+report.pageErrors.join('; '));
    report.finalBatch=reopened;report.passed=true;report.completedAt=new Date().toISOString();
    await phase('browser_reopen_complete',{batchId,layout,pageErrors:report.pageErrors});
    return report;
  }catch(error){
    report.passed=false;report.error={name:error.name,message:error.message,stack:error.stack};
    if(page){try{report.notice=await page.locator('#notice').innerText();await page.screenshot({path:path.join(outputDirectory,'batch-operation-failure.png'),fullPage:true});}catch{}}
    await save();throw error;
  }finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await save();}
}
