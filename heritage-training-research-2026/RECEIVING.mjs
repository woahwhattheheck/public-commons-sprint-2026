import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {receiveResearch,rows,summary,reportHtml,stable} from './model.mjs';
import {sha256} from './source-table-workspace.mjs';
import {receiveArchive,archiveFiles} from './io.mjs';
import {renderApplication} from './render.mjs';
const root=resolve(process.argv[2]||'.'),out=resolve(process.argv[3]||join(root,'operation'));
if(out===root||root.startsWith(out+'/')||out.startsWith(root+'/dist/'))throw Error('Receiving output must preserve the source and built application.');
await mkdir(out,{recursive:true});
const pwPath=process.env.PLAYWRIGHT_MODULE;if(!pwPath)throw Error('Set PLAYWRIGHT_MODULE to the actual installed Playwright module.');
const pw=await import(pathToFileURL(pwPath).href),chromium=pw.chromium??pw.default?.chromium;if(!chromium)throw Error('Installed Playwright does not expose Chromium.');
const html=await readFile(join(root,'dist/index.html'),'utf8'),documents=new Map([['/',html]]),server=createServer((req,res)=>{const body=documents.get(req.url);if(body===undefined){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('#status').filter({hasText:'Original source and local working copy loaded.'}).waitFor();
 const original=await receiveResearch(await readFile(join(root,'dist/project.json'),'utf8'));
 async function choose(target,label,path){const event=target.waitForEvent('filechooser');await target.getByRole('button',{name:label,exact:true}).click();await (await event).setFiles(path);}
 const qualification=rows(original,'qualifications')[0];if(!qualification)throw Error('Original public qualification seed is absent.');
 await page.locator('[data-view=tables]').click();await page.locator('#table-choice').selectOption('qualifications');await choose(page,'Receive source dataset',join(root,'examples/documented-identity-mapping.json'));await page.locator('#status').filter({hasText:'Mapping selected.'}).waitFor();await choose(page,'Choose dataset file',join(root,'examples/documented-identity-selection.csv'));await page.locator('#status').filter({hasText:'Original dataset, full mapping, exact selected rows and receiving history saved.'}).waitFor();
 await page.locator('#table-choice').selectOption('sources');await page.locator('#record-choice').selectOption('S02');const notes=page.locator('#record-editor [name=notes]'),originalNotes=await notes.inputValue();
 await notes.fill(originalNotes+' Original notice bytes and deadline offsets were opened from the delivered source package during this receiving.');
 const draftEvent=page.waitForEvent('download');await page.locator('#download-edit').click();const draftDownload=await draftEvent,draftPath=join(out,'original-source-working-copy.json');await draftDownload.saveAs(draftPath);const draft=JSON.parse(await readFile(draftPath,'utf8'));if(!draft.draft?.values.notes.endsWith('during this receiving.'))throw Error('Current visible source edit was not retained in the download.');
 await page.locator('[data-view=overview]').click();await page.locator('[data-view=receiving]').click();const retained=page.locator('#saved-drafts button').filter({hasText:'sources'});await retained.click();if((await page.locator('#record-editor [name=notes]').inputValue())!==draft.draft.values.notes)throw Error('Retained source edit was lost across navigation.');
 await page.locator('#record-editor button[type=submit]').click();await page.locator('#status').filter({hasText:'Record saved with its complete new source edition.'}).waitFor();
 await page.locator('[data-view=reviews]').click();await page.locator('#review-table').selectOption('qualifications');await page.locator('#review-target').selectOption(qualification.id);
 await page.locator('[name=topic]').fill('source_scope');await page.locator('[name=decision]').selectOption('needs_information');await page.locator('[name=actor]').fill('E496 internal source receiving');
 await page.locator('[name=rationale]').fill('The retained public qualification source identifies this qualification. Provider delivery, site and learner observations require their own source selection; this receiving decision does not classify the whole qualification as a heritage programme.');
 await page.locator('#review-form button[type=submit]').click();await page.locator('#status').filter({hasText:'Research decision and its exact source closure saved.'}).waitFor();
 await page.locator('[data-view=analysis]').click();await page.locator('[name=label]').fill('Original source and provision baseline');await page.locator('[name=actor]').fill('E496 internal source receiving');await page.locator('[name=as_of]').fill('2026-10-13');await page.locator('#analysis-form button').click();await page.locator('#status').filter({hasText:'Complete analysis and historical source selection saved.'}).waitFor();
 const views=[];
 for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});
 for(const section of ['overview','tables','reviews','analysis','history','receiving']){
 await page.locator('[data-view="'+section+'"]').click();await page.locator('#main h1').waitFor();await page.evaluate(()=>document.fonts.ready);
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error('Page-level horizontal overflow at '+width+' in '+section);
 const path=join(out,section+'-'+width+'.png');await page.screenshot({path,fullPage:true});views.push({section,width,path});
 }
 }
 await page.setViewportSize({width:1440,height:1000});const downloadPromise=page.waitForEvent('download');await page.locator('#save-zip').click();const download=await downloadPromise,archive=join(out,'Heritage_Training_Original_Worked_Application.zip');await download.saveAs(archive);
 const received=await receiveArchive(new Uint8Array(await readFile(archive)));await receiveResearch(received.project);if(received.project.researchSourceIntakes?.length!==1)throw Error('The original source dataset and mapping receipt were not retained.');
 if(rows(received.project,'reviews').length!==rows(original,'reviews').length+1||rows(received.project,'runs').length!==rows(original,'runs').length+1)throw Error('The actual original operator review and run are not retained.');
 await writeFile(join(out,'worked-project.json'),JSON.stringify(received.project,null,2)+'\n');
 const second=await browser.newContext({viewport:{width:390,height:900},acceptDownloads:true}),receiver=await second.newPage();
 await receiver.goto(url,{waitUntil:'domcontentloaded'});await receiver.locator('#status').filter({hasText:'Original source and local working copy loaded.'}).waitFor();await receiver.locator('[data-view=receiving]').click();await choose(receiver,'Open project or ZIP',archive);await receiver.locator('#status').filter({hasText:'Complete original source and historical results received.'}).waitFor();
 await receiver.locator('[data-view=analysis]').click();await receiver.locator('#run-list button').filter({hasText:'Original source and provision baseline'}).click();await receiver.locator('#run-detail h2').waitFor();await receiver.screenshot({path:join(out,'fresh-receiving-390.png'),fullPage:true});
 const pDownload=receiver.waitForEvent('download');await receiver.locator('#save-project').click();const pd=await pDownload;await pd.saveAs(join(out,'received-project.json'));const receivedAgain=await receiveResearch(await readFile(join(out,'received-project.json'),'utf8'));
 if(stable(receivedAgain)!==stable(received.project))throw Error('Fresh receiving changed the full editable project.');
 const reportEvent=receiver.waitForEvent('download');await receiver.getByRole('button',{name:'Download complete report',exact:true}).click();const reportDownload=await reportEvent,reportPath=join(out,'Original_Source_And_Provision_Baseline.html');await reportDownload.saveAs(reportPath);const reportBody=await readFile(reportPath,'utf8'),run=rows(received.project,'runs').at(-1);if(reportBody!==reportHtml(run))throw Error('Actual downloaded report differs from its saved analysis.');
 documents.set('/report/',reportBody);
 const inventory=JSON.parse(await readFile(join(root,'SOURCE_FILES.json'),'utf8')),sourceFiles=await Promise.all(inventory.files.map(async path=>({path,content:await readFile(join(root,path),'utf8')}))),coldHtml=renderApplication(received.project,sourceFiles);
 if(await sha256(coldHtml)!==received.manifest.files.find(x=>x.path==='index.html')?.sha256)throw Error('Cold-opening application differs from the actual downloaded ZIP member.');
 documents.set('/received/',coldHtml);await second.close();await context.close();
 const cold=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),opened=await cold.newPage();opened.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){await opened.setViewportSize({width,height:1000});await opened.goto(url+'report/',{waitUntil:'domcontentloaded'});await opened.locator('h1').filter({hasText:run.label}).waitFor();await opened.screenshot({path:join(out,'downloaded-report-'+width+'.png'),fullPage:true});views.push({section:'downloaded-report',width,path:join(out,'downloaded-report-'+width+'.png')});}
 await opened.goto(url+'received/',{waitUntil:'domcontentloaded'});await opened.locator('#status').filter({hasText:'Original source and local working copy loaded.'}).waitFor();await opened.locator('[data-view=analysis]').click();await opened.locator('#run-list button').filter({hasText:run.label}).click();await opened.locator('#run-detail h2').waitFor();await opened.screenshot({path:join(out,'cold-opened-application-390.png'),fullPage:true});views.push({section:'cold-opened-application',width:390,path:join(out,'cold-opened-application-390.png')});await cold.close();
 if(errors.length)throw Error('Actual application errors: '+errors.join('; '));
 const result={schema:'tjlabs.heritage-training-original-receiving.v1',projectId:received.project.id,originalProjectId:original.id,originalIntakeCount:received.project.researchSourceIntakes.length,reviewCount:rows(received.project,'reviews').length,runCount:rows(received.project,'runs').length,sourceSummary:await summary(received.project),views,archive,completeOriginalHistory:true,freshReceivingExact:true,recordEditRetainedAcrossNavigation:true,actualFileChoosers:true,downloadedReportExact:true,coldApplicationMatchesArchive:true};
 await writeFile(join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
