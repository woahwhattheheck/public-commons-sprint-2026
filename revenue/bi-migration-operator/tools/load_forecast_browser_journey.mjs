// Continue the original load-review screens through complete package receiving and cold restoration.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';

const channel=createInterface({input:process.stdin,crlfDelay:Infinity}),input=channel[Symbol.asyncIterator]();
const receive=async()=>{const n=await input.next();if(n.done)throw Error('The original receiving controller ended.');return JSON.parse(n.value);};
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const first=await receive();
let playwright;
for(const directory of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,process.env.PLAYWRIGHT_NODE_MODULES].filter(Boolean)){
 try{playwright=createRequire(path.join(directory,'package.json'))('playwright');break;}catch(_){}
}
if(!playwright)playwright=createRequire(import.meta.url)('playwright');
const browser=await playwright.chromium.launch({executablePath:first.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run']});
const context=await browser.newContext({viewport:{width:1510,height:1080},colorScheme:'light',locale:'en-US',acceptDownloads:true});
const page=await context.newPage(),errors=[],actions=[];
page.setDefaultTimeout(30000);
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/action/'))actions.push({action:new URL(r.url()).pathname.split('/').at(-1),body:r.postDataJSON()});});
const click=a=>page.locator('[data-action="'+a+'"]').click();
const field=id=>page.locator('[id="'+id+'"]');
const fill=(id,v)=>field(id).fill(String(v));
async function choose(id,v){await field(id).selectOption(v);await page.waitForFunction(()=>document.body.dataset.busy!=='true');}
const ref=r=>({kind:r.kind,id:r.id,revision:r.revision});
const value=r=>r.id+'@'+r.revision;
const hash=async filename=>createHash('sha256').update(await readFile(filename)).digest('hex');
async function saved(action,work){
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action/'+action&&r.request().method()==='POST');
 await work();const response=await pending,body=await response.json();
 if(!response.ok())throw Error(action+': '+JSON.stringify(body));
 await page.waitForFunction(()=>document.body.dataset.busy!=='true');
 if(errors.length)throw Error(errors.join('\n'));
 return body.record;
}
async function openLoad(url){
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#connection').filter({hasText:'Workspace connected'}).waitFor();
 await page.locator('[data-tab="load"]').click();
 await page.locator('#page-title').filter({hasText:'Load forecasts'}).waitFor();
}
async function pane(name){
 await page.locator('.lf-nav [data-pane="'+name+'"]').click();
 await page.locator('.lf-nav [data-pane="'+name+'"].active').waitFor();
}
async function download(button,name){
 const waiting=page.waitForEvent('download');await button.click();const d=await waiting;
 const filename=path.join(first.output,name);await d.saveAs(filename);
 const failed=await d.failure();if(failed)throw Error(failed);return filename;
}
async function remember(){await writeFile(path.join(first.output,'browser-actions.private.json'),JSON.stringify(actions));}
try{
 await mkdir(first.output,{recursive:true});
 await openLoad(first.url);await pane('sources');
 await choose('lf-source-select',value(first.packet));
 await field('lf-source-table').waitFor();
 if(await field('lf-source-table').inputValue()!=='observations'||await page.locator('.lf-table tbody tr').count()<1)throw Error('The structured original observation is not visible.');
 await choose('lf-source-select',value(first.current));
 await page.getByRole('heading',{name:'PJM 2026 original load forecast data',exact:true}).waitFor();
 await page.locator('summary').filter({hasText:'Source description'}).click();
 const basisId='lf-map-0-defaults.basis',originalBasis=await field(basisId).inputValue();
 await fill(basisId,originalBasis+' ');
 await fill('lf-meta-vintage','2026 annual forecast — analyst source review');
 if(!await page.locator('[data-action="lf-accept"]').isDisabled())throw Error('Unsaved source edits can be accepted.');
 await saved('load.source.describe',()=>click('lf-describe'));
 if(await field(basisId).inputValue()!==originalBasis+' '||!await page.locator('[data-action="lf-accept"]').isDisabled())throw Error('Saving metadata lost the mapping draft or accepted old mapping.');
 const mapped=await saved('load.source.map',()=>click('lf-map'));
 await fill('lf-source-note','Reviewed the complete original PJM workbook, explicit YEAR and MONTH cells, selected named areas and GWh energy values. Named areas remain separate.');
 if(await field('lf-missing-ack').count())await field('lf-missing-ack').check();
 const current=await saved('load.source.accept',()=>click('lf-accept'));
 send({phase:'ORIGINAL_SOURCES_ACCEPTED',rows:current.payload.row_count,original_sha256:current.payload.original.digest});
 await pane('plans');await click('lf-new-plan');await page.waitForFunction(()=>document.body.dataset.busy!=='true');
 await choose('lf-plan-baseline',value(first.baseline));
 await choose('lf-plan-current',value(current));
 for(const [key,v]of Object.entries({label:'PJM monthly energy forecast editions — 2025 and 2026',client:'Pennsylvania resource-adequacy source review',prepared_for:'Analyst and receiving operator',first_year:2025,last_year:2046,purpose:'Compare the published monthly energy forecasts for the exact selected PJM areas and original year/month cells.',assumptions:'Each named area stays separate. Original YEAR/MONTH cells form calendar months; published GWh converts exactly to MWh. Only compatible common observations are compared; unmatched horizons remain visible. Monthly endpoint CAGR can reflect seasonality and is not an independent demand model or an accuracy score.'}))await fill('lf-plan-'+key,v);
 const prepared=await saved('load.review.prepare',()=>click('lf-prepare-review'));
 await page.locator('[data-action="lf-row-decision"]').first().click();
 await fill('lf-decision-note','Retained this original source observation and its explicit year/month identity for analyst review.');
 await click('lf-save-row-decision');
 for(const a of await page.locator('[data-lf-issue]').all())await a.check();
 const conclusion='Reviewed the complete original source editions, selected monthly energy definitions, unit conversion and different published horizons. The original adjustment and independent forecasting responsibilities remain visible.';
 await fill('lf-review-note',conclusion);
 await saved('load.review.decide',()=>click('lf-decide'));
 await fill('lf-review-note',conclusion+' No total across overlapping areas is calculated.');
 if(!await page.locator('[data-action="lf-finalize"]').isDisabled())throw Error('Unsaved reviewer decisions can be finalized.');
 await saved('load.review.decide',()=>click('lf-decide'));
 const finalized=await saved('load.review.finalize',()=>click('lf-finalize'));
 const exported=await saved('load.review.export',()=>click('lf-export'));
 const zip=await download(page.locator('[data-action="lf-download-export"][data-id="'+exported.id+'"][data-file="package"]'),'Load_Forecast_Review_Complete.zip');
 if(await hash(zip)!==exported.payload.package.digest)throw Error('The original complete download differs.');
 await page.evaluate(()=>window.scrollTo({top:0}));
 await page.screenshot({path:path.join(first.output,'Load_Forecast_Review.png')});
 await remember();
 send({phase:'INITIAL_COMPLETE',source:ref(current),review:ref(finalized),export:ref(exported),zip,files:exported.payload.files,package_sha256:exported.payload.package.digest,report_sha256:finalized.payload.report.digest});
 const next=await receive();if(next.phase!=='RECEIVE_PACKAGE')throw Error('Expected the original complete-package continuation.');
 await openLoad(next.url);await pane('receiving');
 await field('lf-receive-file').setInputFiles(zip);
 const received=await saved('load.delivery.receive',()=>click('lf-receive'));
 const adopted=await saved('load.delivery.adopt',()=>click('lf-adopt'));
 await fill('lf-plan-label','Receiving analyst — original PJM monthly energy editions');
 const receivedReview=await saved('load.review.prepare',()=>click('lf-prepare-review'));
 await pane('receiving');
 const receivedZip=await download(page.locator('[data-action="lf-download-received"]'),'Load_Forecast_Review_Received.zip');
 if(await hash(receivedZip)!==exported.payload.package.digest)throw Error('Receiving changed the original complete file.');
 await page.locator('[data-tab="delivery"]').click();
 await fill('backup-password',first.passphrase);await fill('backup-label','Load forecast original receiving');
 const backup=await saved('backup.create',()=>click('backup'));
 const backupFile=await download(page.locator('[data-action="download-backup"][data-id="'+backup.id+'"]'),'Load_Analyst_Workspace.bi-backup');
 await remember();
 send({phase:'RECEIVING_COMPLETE',received:ref(received),adopted:ref(adopted),review:ref(receivedReview),backup:backupFile,package_sha256:await hash(receivedZip)});
 const cold=await receive();if(cold.phase!=='COLD_REOPEN')throw Error('Expected the original restored-workspace continuation.');
 await openLoad(cold.url);await pane('receiving');
 await choose('lf-received-select',value(adopted));
 const coldZip=await download(page.locator('[data-action="lf-download-received"]'),'Load_Forecast_Review_Cold.zip');
 if(await hash(coldZip)!==exported.payload.package.digest)throw Error('Cold restoration changed the retained delivery.');
 await click('lf-open-adopted');
 await fill('lf-plan-label','Cold receiving operator — editable PJM monthly energy review');
 const plan=await saved('load.plan.save',()=>click('lf-save-plan'));
 await pane('receiving');await page.evaluate(()=>window.scrollTo({top:0}));
 await page.screenshot({path:path.join(first.output,'Load_Forecast_Receiving.png')});
 if(errors.length)throw Error(errors.join('\n'));
 await remember();
 send({phase:'COLD_COMPLETE',plan:ref(plan),package_sha256:await hash(coldZip),browser_version:browser.version(),browser_errors:errors});
}finally{channel.close();process.stdin.pause();await context.close();await browser.close();}
