// Complete named-staff browser operation against the original local Grant Operations server.
import fs from 'node:fs/promises';
import path from 'node:path';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const module=await import(process.env.SF47_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js');
const chromium=module.chromium||module.default?.chromium;
const output=path.join(cfg.output,'browser');
await fs.mkdir(output,{recursive:true,mode:0o700});
const require=(value,message)=>{if(!value)throw new Error(message);};
let browser,context,page,stage='launch';
const views=[],errors=[];
const result={schema:'stellar-forge.sf47-staff-browser-receiving.v1',views,errors};
async function snapshot(name,width=1440){
  await page.setViewportSize({width,height:1000});
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
  const size=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
  require(size.documentWidth<=size.width+2,name+' has horizontal document overflow.');
  views.push({name,width,path:'browser/'+name+'.png'});
}
async function saved(action,click){
  const pending=page.waitForResponse(response=>{
    if(response.request().method()!=='POST'||!response.url().endsWith('/command'))return false;
    try{return response.request().postDataJSON()?.action===action;}catch{return false;}
  });
  await click();
  const response=await pending;
  const value=await response.json();
  require(response.ok(),action+' failed: '+JSON.stringify(value));
  return value;
}
async function signIn(name){
  if(context)await context.close();
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.addInitScript(({planId,caseId})=>sessionStorage.setItem('sf47.operations.case.'+planId,caseId),
                             {planId:cfg.planId,caseId:cfg.caseId});
  page=await context.newPage();
  page.on('pageerror',error=>errors.push({stage,message:error.message}));
  page.on('response',response=>{if(response.status()>=500)errors.push({stage,status:response.status(),path:new URL(response.url()).pathname});});
  await page.goto(cfg.origin+'/team',{waitUntil:'networkidle'});
  await page.locator('#login-form [name=staffId]').fill(name);
  await page.locator('#login-form [name=accessCode]').fill(cfg.profiles[name].code);
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#signed-in').waitFor({state:'visible'});
  await page.locator('#sign-out').waitFor({state:'visible'});
}
async function operations(){
  await page.goto(cfg.origin+'/',{waitUntil:'networkidle'});
  await page.locator('[data-tab=operations]').click();
  await page.locator('[name=caseSelect]').waitFor();
  if(await page.locator('[name=caseSelect]').inputValue()!==cfg.caseId){
    await page.locator('[name=caseSelect]').selectOption(cfg.caseId);
  }
  await page.locator('[data-ops-tab=overview]').waitFor();
}
async function transition(command,id,note){
  await page.locator('[data-ops-action=transition][data-command="'+command+'"][data-id="'+id+'"]').click();
  await page.locator('[data-ops-form] [name=operationNote]').fill(note);
  return saved(command,()=>page.locator('[data-ops-form] button[type=submit]').click());
}
async function board(){return page.evaluate(async()=>{const r=await fetch('/api/staff/workboard');if(!r.ok)throw Error('Could not open own work');return r.json();});}
async function currentCase(){return page.evaluate(async(id)=>{const r=await fetch('/api/operations/'+id);if(!r.ok)throw Error('Could not open assigned case');return r.json();},cfg.caseId);}
try{
  browser=await chromium.launch({executablePath:process.env.SF47_CHROMIUM||'/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium',
    headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  result.browserVersion=browser.version();
  stage='contributor';
  await signIn('case-contributor');
  await snapshot('01-contributor-work');
  await snapshot('02-contributor-mobile',390);
  await page.setViewportSize({width:1440,height:1000});
  let own=(await board()).cases.find(c=>c.program.id===cfg.caseId);
  let work=own.work.find(w=>w.description==='Complete the staff browser handover');
  let invoice=own.invoices.find(i=>i.number==='STAFF-BROWSER-001');
  if(!work){
    const sourceBytes=Buffer.from('Staff browser handover: original contributor attachment for the operating walkthrough.\n');
    const sourcePath=path.join(output,'staff-browser-work.txt');
    await fs.writeFile(sourcePath,sourceBytes,{mode:0o600});
    await page.locator('[data-action=source-new]').click();
    await page.locator('#source-form [name=file]').setInputFiles(sourcePath);
    const source=await saved('source.add',()=>page.locator('#source-form button[type=submit]').click());
    await page.locator('#work-editor').waitFor({state:'hidden'});
    await page.locator('[data-action=work-new]').click();
    await page.locator('#record-form [name=description]').fill('Complete the staff browser handover');
    await page.locator('#record-form [name=costId]').selectOption(cfg.packageId);
    await page.locator('#record-form [name=hours]').fill('1.25');
    await page.locator('#record-form [name=startDate]').fill('2026-10-12');
    await page.locator('#record-form [name=endDate]').fill('2026-10-12');
    await page.locator('#record-form [name=fundingBasis]').selectOption('INTERNAL');
    await page.locator('#record-form [name=sourceIds][value="'+source.recordId+'"]').check();
    await page.locator('#record-form [name=sourceNote]').fill('Original browser receiving work source');
    await snapshot('03-work-entry');
    const created=await saved('work.save',()=>page.locator('#record-form button[type=submit]').click());
    await page.locator('#work-editor').waitFor({state:'hidden'});
    own=(await board()).cases.find(c=>c.program.id===cfg.caseId);
    work=own.work.find(w=>w.id===created.recordId);
  }
  result.workId=work.id;
  if(work.state==='LOGGED'){
    page.once('dialog',dialog=>dialog.accept('Submit the complete staff browser handover'));
    await saved('work.submit',()=>page.locator('[data-action=work-submit][data-id="'+work.id+'"]').click());
  }
  if(!invoice){
    await page.locator('[data-action=invoice-new]').click();
    await page.locator('#record-form [name=number]').fill('STAFF-BROWSER-001');
    await page.locator('#record-form [name=issuedDate]').fill('2026-10-12');
    await page.locator('#record-form [name=dueDate]').fill('2026-10-26');
    await page.locator('#record-form [name=lineDescription]').fill('Completed staff browser handover');
    await page.locator('#record-form [name=lineAmount]').fill('125.00');
    await page.locator('#record-form [name=lineCost]').selectOption(cfg.packageId);
    await page.locator('#record-form [name=lineWork][value="'+work.id+'"]').check();
    await page.locator('#record-form [name=sourceNote]').fill('Original browser receiving invoice');
    await snapshot('04-invoice-entry');
    const created=await saved('invoice.save',()=>page.locator('#record-form button[type=submit]').click());
    await page.locator('#work-editor').waitFor({state:'hidden'});
    own=(await board()).cases.find(c=>c.program.id===cfg.caseId);
    invoice=own.invoices.find(i=>i.id===created.recordId);
  }
  result.invoiceId=invoice.id;
  stage='reviewer';
  await signIn('case-reviewer');
  await operations();
  await page.locator('[data-ops-tab=work]').click();
  require(await page.locator('[data-ops-action=record][data-kind=work]').first().isDisabled(),
          'Reviewer has an enabled work writer.');
  const reviewed=await currentCase();
  if(reviewed.records.work.find(w=>w.id===work.id).state==='SUBMITTED'){
    await transition('work.accept',work.id,'Accept the complete staff browser handover');
  }
  await snapshot('05-reviewer-work');
  await snapshot('06-reviewer-mobile',390);
  stage='finance';
  await signIn('finance-operator');
  await operations();
  await page.locator('[data-ops-tab=invoices]').click();
  const financial=await currentCase();
  if(financial.records.invoices.find(i=>i.id===invoice.id).state==='RECEIVED'){
    await transition('invoice.review',invoice.id,'Review the original staff browser invoice');
  }
  await snapshot('07-finance-invoices');
  await page.locator('[data-ops-tab=cash]').click();
  const beforeCash=await currentCase();
  let cash=beforeCash.records.cash.find(c=>c.externalRef==='STAFF-BROWSER-PAYMENT-125'&&c.state==='OBSERVED');
  if(!cash){
    await page.locator('[data-ca-action=new]').click();
    await page.locator('[data-ca-field=date]').fill('2026-10-12');
    await page.locator('[data-ca-field=direction]').selectOption('OUT');
    await page.locator('[data-ca-field=category]').selectOption('INVOICE');
    await page.locator('[data-ca-field=externalRef]').fill('STAFF-BROWSER-PAYMENT-125');
    await page.locator('[data-ca-field=amount]').fill('125.00');
    await page.locator('[data-ca-field=currency]').fill('USD');
    await page.locator('[data-ca-action=add-allocation]').click();
    await page.locator('[data-ca-field="allocations.0.invoiceId"]').selectOption(invoice.id);
    await page.locator('[data-ca-field="allocations.0.amountUsd"]').fill('125.00');
    await page.locator('[data-ca-field=draftReason]').fill('Settle the original browser receiving invoice');
    await page.locator('[data-ca-action=review]').click();
    await snapshot('08-finance-cash-review');
    const savedCash=await saved('cash.record',()=>page.locator('[data-ca-action=save]').click());
    cash=(await currentCase()).records.cash.find(c=>c.id===savedCash.recordId);
  }
  result.paymentId=cash.id;
  await snapshot('09-finance-cash');
  await snapshot('10-finance-mobile',390);
  stage='final-review';
  await signIn('case-reviewer');
  await operations();
  await page.locator('[data-ops-tab=reviews]').click();
  await page.locator('[data-ops-action=freeze-review]').click();
  await page.locator('[data-ops-form] [name=operationNote]').fill('Review the complete staff operating case and settled browser invoice');
  const review=await saved('review',()=>page.locator('[data-ops-form] button[type=submit]').click());
  result.reviewId=review.recordId;
  stage='lead-handover';
  await signIn('delivery-lead');
  await operations();
  await page.locator('[data-ops-tab=reviews]').click();
  await page.locator('[data-ops-action=close-review][data-id="'+review.recordId+'"]').click();
  await page.locator('[data-ops-form] [name=operationNote]').fill('Close the exact reviewed delivery and payment record');
  await saved('close',()=>page.locator('[data-ops-form] button[type=submit]').click());
  await page.locator('[data-ops-action=reopen]').click();
  await page.locator('[data-ops-form] [name=operationNote]').fill('Continue operating the delivered team workspace');
  await saved('reopen',()=>page.locator('[data-ops-form] button[type=submit]').click());
  await snapshot('11-lead-review');
  const final=await currentCase();
  require(final.report.cash.invoiceLiabilityUsd==='375.00'&&final.report.cash.openInvoiceUsd==='0.00',
          'The final browser case has another invoice balance.');
  result.finalVersion=final.program.version;
  await page.goto(cfg.origin+'/team',{waitUntil:'networkidle'});
  await page.locator('#staff-admin').waitFor({state:'visible'});
  require(await page.locator('#profiles').innerText().then(text=>text.includes('Finance operator')),'The admin roster is unavailable.');
  await snapshot('12-team-administration');
  await snapshot('13-team-mobile',390);
  await page.setViewportSize({width:1440,height:1000});
  const downloading=page.waitForEvent('download');
  await page.locator('#backup').click();
  const download=await downloading;
  await download.saveAs(path.join(cfg.output,'browser-installation.zip'));
  result.installationArchive='browser-installation.zip';
  stage='contributor-settlement';
  await signIn('case-contributor');
  const paid=(await board()).cases.find(c=>c.program.id===cfg.caseId);
  require(paid.invoiceBalances.length===2&&paid.invoiceBalances.every(row=>row.openUsd==='0.00'),
          'The contributor cannot see the two settled invoices.');
  await snapshot('14-contributor-settled');
  await snapshot('15-contributor-settled-mobile',390);
  const recordsDownload=page.waitForEvent('download');
  await page.locator('#download-work').click();
  await (await recordsDownload).saveAs(path.join(output,'contributor-original-records.json'));
  require(errors.length===0,'The staff browser reported application errors: '+JSON.stringify(errors));
  await fs.writeFile(path.join(cfg.output,'browser-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({result:'COMPLETE',views:views.length,workId:result.workId,invoiceId:result.invoiceId,
    paymentId:result.paymentId,finalVersion:result.finalVersion,browserVersion:result.browserVersion}));
}catch(error){
  result.failedStage=stage;result.failure=error.stack||String(error);
  if(page){
    try{await page.screenshot({path:path.join(output,'interrupted-page.png'),fullPage:true});}catch{}
    try{await fs.writeFile(path.join(output,'interrupted-page.html'),await page.content(),{mode:0o600});}catch{}
  }
  await fs.writeFile(path.join(cfg.output,'browser-interrupted.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  throw error;
}finally{
  if(context)await context.close();
  if(browser)await browser.close();
}
