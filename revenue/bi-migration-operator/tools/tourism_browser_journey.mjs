// Operate the original tourism screens, then continue the restored workspace.
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';

const channel=createInterface({input:process.stdin,crlfDelay:Infinity});
const input=channel[Symbol.asyncIterator]();
const receive=async()=>{const next=await input.next();if(next.done)throw new Error('The receiving controller ended.');return JSON.parse(next.value);};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const first=await receive();
const requirements=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,process.env.PLAYWRIGHT_NODE_MODULES].filter(Boolean);
let playwright;
for(const directory of requirements){try{playwright=createRequire(path.join(directory,'package.json'))('playwright');break;}catch(_){}}
if(!playwright){try{playwright=createRequire(import.meta.url)('playwright');}catch(_){throw new Error('Use the existing installed Playwright module through CODEX_PRIMARY_RUNTIME_NODE_MODULES or PLAYWRIGHT_NODE_MODULES.');}}
const browser=await playwright.chromium.launch({executablePath:first.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run']});
const context=await browser.newContext({viewport:{width:1510,height:1080},colorScheme:'light',locale:'en-US',acceptDownloads:true});
const page=await context.newPage(),pageErrors=[],actions=[];
page.setDefaultTimeout(30000);
page.on('pageerror',error=>pageErrors.push(String(error)));
page.on('request',request=>{
 if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/action/')){
  try{actions.push({action:new URL(request.url()).pathname.split('/').at(-1),body:request.postDataJSON()});}catch(_){}
 }
});
const click=action=>page.locator('[data-action="'+action+'"]').click();
async function saved(action,work){
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/action/'+action&&response.request().method()==='POST');
 await work();const response=await pending,body=await response.json();
 if(!response.ok())throw new Error(action+': '+JSON.stringify(body));
 await page.waitForFunction(()=>document.body.dataset.busy!=='true');
 if(pageErrors.length)throw new Error(pageErrors.join('\n'));
 return body.record;
}
async function openTourism(url){
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#connection').filter({hasText:'Workspace connected'}).waitFor();
 await page.locator('[data-tab="tourism"]').click();
 await page.locator('#page-title').filter({hasText:'Tourism reporting'}).waitFor();
}
async function pane(name){
 await page.locator('[data-action="tourism-pane"][data-pane="'+name+'"]').first().click();
 await page.locator('.tourism-tabs [data-pane="'+name+'"][aria-pressed="true"]').waitFor();
}
async function fill(id,text){await page.locator('#'+id).fill(String(text));}
async function download(button,filename){
 const pending=page.waitForEvent('download');await button.click();const file=await pending;await file.saveAs(filename);
 const failed=await file.failure();if(failed)throw new Error('Download failed: '+failed);return filename;
}
try{
 await mkdir(first.output,{recursive:true});
 const configuration=JSON.parse(await readFile(first.configurationPath,'utf8')),sourceBytes=await readFile(first.sourcePath);
 await openTourism(first.url);await pane('sources');
 await page.locator('#tourism-import-file').setInputFiles({name:'record.json',mimeType:'application/json',buffer:sourceBytes});
 await page.getByText('Selected record.json · '+sourceBytes.length.toLocaleString()+' bytes',{exact:true}).waitFor();
 await fill('tourism-import-label','Overland Park original public collections and budget');
 const source=await saved('tourism.source.prepare',()=>click('tourism-import'));
 await fill('tourism-source-review',configuration.source_review_note);
 const accepted=await saved('tourism.source.accept',()=>click('tourism-accept-source'));
 send({phase:'SOURCE_RETAINED',tables:accepted.payload.tables,original_sha256:accepted.payload.original.digest});
 await pane('funds');
 const fundFields={label:'label',code:'fund_code',jurisdiction:'jurisdiction',currency:'currency',unit:'minor_unit',period:'opening_period',opening:'opening_cash',reserve:'reserve',timezone:'timezone',basis:'opening_basis',numerator:'allocation_numerator',denominator:'allocation_denominator',allocation:'allocation_basis',url:'source_url',annual:'annual_plan'};
 for(const [id,key]of Object.entries(fundFields))await fill('tourism-fund-'+id,configuration.fund[key]);
 const fund=await saved('tourism.fund.save',()=>click('tourism-fund-save'));
 await pane('plans');
 await page.locator('#tourism-plan-fund').selectOption(fund.id+'~'+fund.revision);
 await page.locator('[data-tourism-source-choice="'+accepted.id+'"]').selectOption(accepted.id+'~'+accepted.revision);
 await page.locator('#tourism-budget-options option[value="'+configuration.plan.budget_id+'"]').waitFor({state:'attached'});
 const planFields={label:'label',start:'start',asof:'as_of',window:'comparison_months',growth:'growth_bps',downside:'downside_bps',upside:'upside_bps',budget:'budget_id',assumptions:'assumptions'};
 for(const [id,key]of Object.entries(planFields))await fill('tourism-plan-'+id,configuration.plan[key]);
 await page.locator('#tourism-plan-method').selectOption(configuration.plan.method);
 await fill('tourism-plan-annual',configuration.fund.annual_plan);
 const prepared=await saved('tourism.period.prepare',()=>click('tourism-plan-prepare'));
 await page.getByRole('heading',{name:'Quarterly reporting',exact:true}).waitFor();
 send({phase:'REPORT_PREPARED',issues:prepared.payload.issues.length,as_of:prepared.payload.as_of});
 for(const control of await page.locator('[data-tourism-ack]').all())await control.check();
 await fill('tourism-report-review','Reviewed the original KDOR monthly and distribution columns, all four published VisitOP budget statuses, their retained arithmetic differences and the proposed-budget opening basis. Forecast sensitivity uses the stated prior-year method and the selected August 2026 source cutoff.');
 const reviewed=await saved('tourism.period.review',()=>click('tourism-review'));
 const finalized=await saved('tourism.period.finalize',()=>click('tourism-finalize'));
 const exported=await saved('tourism.period.export',()=>click('tourism-export'));
 const reportZip=path.join(first.output,'Tourism_Reporting_Complete.zip');
 await download(page.locator('[data-action="download"][data-sha="'+exported.payload.package.digest+'"]').first(),reportZip);
 await page.evaluate(()=>window.scrollTo({top:0}));
 await page.screenshot({path:path.join(first.output,'Tourism_Report.png'),fullPage:false});
 send({phase:'REPORT_FINALIZED_AND_DOWNLOADED',report_sha256:finalized.payload.report.digest,package_sha256:exported.payload.package.digest,files:exported.payload.files});
 await click('tourism-recovery');
 await fill('backup-password',first.passphrase);await fill('backup-label','Tourism original receiving');
 const backup=await saved('backup.create',()=>click('backup'));
 const backupPath=path.join(first.output,'Tourism_Workspace.bi-backup');
 await download(page.locator('[data-action="download-backup"][data-id="'+backup.id+'"]'),backupPath);
 await writeFile(path.join(first.output,'browser-actions.private.json'),JSON.stringify(actions));
 const produced={phase:'INITIAL_COMPLETE',source:{kind:accepted.kind,id:accepted.id,revision:accepted.revision},fund:{kind:fund.kind,id:fund.id,revision:fund.revision},period:{kind:finalized.kind,id:finalized.id,revision:finalized.revision},export:{kind:exported.kind,id:exported.id,revision:exported.revision},report_zip:reportZip,backup:backupPath,page_errors:pageErrors};
 await writeFile(path.join(first.output,'browser-produced.private.json'),JSON.stringify(produced,null,2));send(produced);
 const next=await receive();if(next.phase!=='COLD_REOPEN')throw new Error('Expected the original cold receiving continuation.');
 await openTourism(next.url);await pane('reports');
 await page.locator('[data-action="tourism-report-open"][data-id="'+finalized.id+'"]').click();
 await page.getByRole('heading',{name:'Finalized report edition',exact:true}).waitFor();
 await page.getByText('Reopen this report for a new review',{exact:true}).click();
 await fill('tourism-reopen-note','Receiving operator reopened the same original finalized report after encrypted workspace restoration.');
 const reopened=await saved('tourism.period.reopen',()=>click('tourism-reopen'));
 const receivedZip=path.join(first.output,'Tourism_Reporting_Received.zip');
 await download(page.locator('[data-action="download"][data-sha="'+exported.payload.package.digest+'"]').first(),receivedZip);
 const actualHash=createHash('sha256').update(await readFile(receivedZip)).digest('hex');
 if(actualHash!==exported.payload.package.digest)throw new Error('The receiving download differs from the original retained export.');
 if(reopened.id!==finalized.id||reopened.revision!==finalized.revision+1||reopened.payload.state!=='PREPARED')throw new Error('The receiving browser did not reopen the original report revision.');
 if(pageErrors.length)throw new Error(pageErrors.join('\n'));
 const result={phase:'COLD_COMPLETE',reopened:{kind:reopened.kind,id:reopened.id,revision:reopened.revision},received_export_sha256:actualHash,page_errors:pageErrors,browser_version:browser.version()};
 await writeFile(path.join(first.output,'browser-received.private.json'),JSON.stringify(result,null,2));send(result);
}finally{channel.close();process.stdin.pause();await context.close();await browser.close();}
