import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {chromium}=require(config.playwright);
const key=(await fs.readFile(path.join(config.workspace,'access.key'),'utf8')).trim();
const result={operationId:config.operationId,caseId:config.case.id,version:config.case.version,
  amendmentId:config.amendment.id,revision:config.amendment.revision,screenshots:[],findings:[],pageErrors:[]};
const check=(value,message)=>{if(!value)throw new Error(message);};
const browser=await chromium.launch({executablePath:config.chromium,headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage']});
let context;
const saved='[data-amend-calendar-scope="saved"]';
async function open(page){
  page.on('pageerror',error=>result.pageErrors.push(error.message.split(key).join('[access redacted]')));
  await page.goto(config.url+'/#access='+key,{waitUntil:'domcontentloaded'});
  await page.locator('#plan-select option').first().waitFor({state:'attached'});
  await page.locator('#plan-select').selectOption(config.case.planId);
  await page.locator('[data-tab="operations"]').click();
  await page.locator('[name="caseSelect"]').selectOption(config.case.id);
  await page.locator('[data-ops-tab="amendments"]').click();
  await page.locator('[data-amend-action="open"][data-id="'+config.amendment.id+'"]').click();
  await page.locator(saved).waitFor();
}
async function screenshot(page,name){
  await page.screenshot({path:path.join(config.output,name+'.png'),fullPage:true});
  result.screenshots.push(name+'.png');
  const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  if(widths.document>widths.viewport+2)result.findings.push({kind:'page-overflow',name,...widths});
}
async function native(page){
  return page.evaluate(async args=>{
    const access=sessionStorage.getItem('sf47.access');
    const [c,a]=await Promise.all([
      fetch('/api/operations/'+args.caseId,{headers:{Authorization:'Bearer '+access}}),
      fetch('/api/operations/'+args.caseId+'/amendments/'+args.amendmentId+'?revision='+args.revision,
        {headers:{Authorization:'Bearer '+access}})
    ]);
    if(!c.ok||!a.ok)throw new Error('Original amendment HTTP '+c.status+'/'+a.status);
    return {current:await c.json(),detail:await a.json()};
  },{caseId:config.case.id,amendmentId:config.amendment.id,revision:config.amendment.revision});
}
try{
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  await open(page);
  const original=await native(page);
  check(original.detail.calendarImpact.impactSha256===config.impactSha256,'The browser opened another native amendment calendar.');
  check(await page.locator(saved+' tbody tr').count()===original.detail.calendarImpact.entries.length,
    'The complete native agenda did not reach the page.');
  await screenshot(page,'amendment-calendar-desktop');
  await page.locator(saved+' [data-amend-calendar-filter]').selectOption('changed');
  check(await page.locator(saved+' tbody tr:not([hidden])').count()===original.detail.calendarImpact.summary.changedEntries,
    'The changed-entry view differs from the native comparison.');
  const waiting=page.waitForEvent('download');
  await page.locator(saved+' [data-amend-action="calendar-export"]').click();
  const download=await waiting;
  await download.saveAs(path.join(config.output,'browser-amendment-calendars.zip'));
  result.download='browser-amendment-calendars.zip';
  await page.locator('.plan-amendments[aria-busy="false"]').waitFor();
  await page.locator(saved+' [data-amend-calendar-filter]').selectOption('all');
  const source=original.detail.calendarImpact.entries.find(row=>row.before?.kind==='DELIVERABLE');
  if(source){
    const target=page.locator(saved+' [data-amend-action="calendar-open"][data-calendar-entry="'+source.id.replaceAll('"','\\"')+'"]');
    await target.click();
    await page.locator('.completion-desk[aria-busy="false"]').waitFor();
    check(await page.locator('[name="completionTranche"]').inputValue()===String(source.tranche),'The source opened another tranche.');
    check(await page.locator('[name="completionAsOfDate"]').inputValue()===original.detail.calendarImpact.asOfDate,
      'The source opened another comparison clock date.');
    result.completionSource={tranche:source.tranche,costId:source.before.costId,asOfDate:original.detail.calendarImpact.asOfDate};
    await screenshot(page,'amendment-current-completion-desktop');
    await page.locator('[data-ops-tab="amendments"]').click();
    await page.locator(saved).waitFor();
  }
  await page.setViewportSize({width:390,height:844});
  await screenshot(page,'amendment-calendar-phone');
  await context.close();context=null;
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const reopened=await context.newPage();
  await open(reopened);
  const received=await native(reopened);
  check(received.current.program.id===config.case.id&&received.current.program.version===config.case.version,
    'Reopening the original saved case changed its native identity or version.');
  check(received.detail.calendarImpact.impactSha256===config.impactSha256,'Reopening changed the frozen calendar comparison.');
  await screenshot(reopened,'amendment-calendar-reopened');
  result.savedCaseReopened=true;
  result.browserVersion=browser.version();
  result.status=result.findings.length||result.pageErrors.length?'REPAIR_REQUIRED':'COMPLETE';
}catch(error){
  result.status='REPAIR_REQUIRED';
  result.findings.push({kind:'native-browser',message:String(error.stack||error).split(key).join('[access redacted]')});
}finally{
  if(context)await context.close();
  await browser.close();
  await fs.writeFile(path.join(config.output,'browser-result.json'),JSON.stringify(result,null,2)+'\n');
}
if(result.status!=='COMPLETE')process.exitCode=1;
