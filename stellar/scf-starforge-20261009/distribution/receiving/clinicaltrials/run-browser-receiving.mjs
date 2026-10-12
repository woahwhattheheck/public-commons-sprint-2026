import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(process.env.SCF_PLAYWRIGHT_PACKAGE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function runClinicalTrialsBrowserJourney({consoleUrl,prsConsoleUrl,sourceRoot,outputDirectory}){
 await mkdir(outputDirectory,{recursive:true,mode:0o700});
 const report={schema:'stellar-forge.clinicaltrials-browser-journey.v1',startedAt:new Date().toISOString(),steps:[],actions:[],downloads:[],pageErrors:[]};
 const save=async()=>writeFile(join(outputDirectory,'journey.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const browser=await chromium.launch({executablePath:process.env.SCF_BROWSER_EXECUTABLE || '/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=1']});
 let page;
 const record=async(name,value={})=>{report.steps.push({name,...value});await save();};
 async function attach(url){
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  const opened=await context.newPage();opened.setDefaultTimeout(20000);
  opened.on('pageerror',e=>report.pageErrors.push(String(e.message)));
  await opened.goto(url,{waitUntil:'domcontentloaded'});
  await opened.waitForFunction(()=>document.getElementById('workspace-summary')?.textContent.includes('Revision '));
  return opened;
 }
 async function state(p,url){
  const u=new URL(url),r=await p.request.get(u.origin+'/api/state',{headers:{Authorization:'Bearer '+u.hash.slice(1),Origin:u.origin}});
  check(r.status()===200,'Original authenticated state is unavailable');return r.json();
 }
 async function read(p,trigger,pathname){
  const ready=p.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==='GET',{timeout:90000});ready.catch(()=>{});
  await trigger();const response=await ready;check(response.status()===200,'Original read failed: '+pathname+' HTTP'+response.status());return response.json();
 }
 async function act(p,name,trigger){
  const ready=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/clinical/action'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===name,{timeout:120000});ready.catch(()=>{});
  await trigger();const response=await ready,body=await response.json();check(response.status()===200,'Original action '+name+' failed: '+JSON.stringify(body));
  report.actions.push({action:name,requestId:response.request().postDataJSON().requestId,revision:body.state.revision});
  await p.waitForFunction(()=>Boolean(document.querySelector('[data-write]:not(:disabled)')));
  await save();return body;
 }
 async function download(p,trigger,expected){
  const ready=p.waitForEvent('download',{timeout:120000});ready.catch(()=>{});
  await trigger();const item=await ready,target=join(outputDirectory,'download-'+report.downloads.length+'-'+item.suggestedFilename());await item.saveAs(target);
  const bytes=await readFile(target),entry={name:item.suggestedFilename(),bytes:bytes.length,sha256:sha(bytes)};
  if(expected){check(entry.bytes===expected.bytes&&entry.sha256===expected.sha256,'Browser download differs from original '+expected.name);entry.nativeName=expected.name;}
  report.downloads.push(entry);await save();return entry;
 }
 try{
  page=await attach(consoleUrl);let current=await state(page,consoleUrl);const capture=current.capture;
  check(capture.status==='completed'&&capture.rowCount===165,'The original full cohort did not reopen');
  check(current.builds.find(x=>x.id===current.activeBuild)?.native.snapshot==='ade2c08954dc92830e14d152290d2543a8c6bd7335dbb949bf57a4e605a4b0a4','Native original snapshot changed');
  const reviewIds=JSON.stringify(current.reviews);
  for(const id of ['7f82857ab38977b3fea662d329fbb66175c891726507a1309661ca4f3cf7ce3c','01577be1c3e1105ff0beb101b707539a1832cf9670dc7268b9f8a694901c3522'])check(reviewIds.includes(id),'The saved original review is missing');
  report.review={id:'7f82857ab38977b3fea662d329fbb66175c891726507a1309661ca4f3cf7ce3c',nctId:'NCT03529110'};
  await record('original_portable_source_and_reviews',{captureId:capture.id,rows:capture.rowCount,reviews:2,snapshot:'ade2c08954dc92830e14d152290d2543a8c6bd7335dbb949bf57a4e605a4b0a4'});
  await page.locator('[data-section=exports]').click();
  const exported=await act(page,'package.export',()=>page.locator('#package-export').click());
  report.exportId=exported.result.id;
  for(const name of ['dataset.csv','dataset.json','source.json','query.json','clinicaltrials-workspace.zip','RECEIVING.md']){
    const file=exported.result.files.find(x=>x.name===name);check(file,'Missing complete customer file '+name);
    const row=page.locator('#export-files tbody tr').filter({has:page.getByText(name,{exact:true})});
    await download(page,()=>row.getByRole('button',{name:'Download',exact:true}).click(),file);
  }
  await record('whole_customer_browser_exports',{exportId:exported.result.id,files:exported.result.files.length});
  await page.locator('[data-section=publisher]').click();
  const opened=await act(page,'publisher.status',()=>page.locator('#pub-open').click());
  check(opened.state.publisher&&await page.locator('#pub-export option').count()>0,'Original publisher or retained export selector is absent');
  await record('original_publisher_reopen',{drafts:opened.state.publisher.drafts.candidates.length});
  await page.locator('#pub-export').selectOption(exported.result.directory);
  const prepared=await act(page,'publisher.prepare',()=>page.locator('#pub-prepare-form button[type=submit]').click());
  const draft=prepared.result.draft;check(draft.dataset.snapshot===exported.result.snapshot,'Original publisher prepared a different snapshot');
  await download(page,()=>page.locator('[data-pub-download-draft-csv="'+draft.id+'"]').click(),exported.result.files.find(x=>x.name==='dataset.csv'));
  await page.locator('[data-publisher-view=release]').click();
  await page.locator('#pub-release-draft').selectOption(draft.id);
  const releaseId='clinical-daiichi-20261012';
  await page.locator('#pub-release-id').fill(releaseId);
  await page.locator('#pub-release-label').fill('Daiichi public registry receiving');
  await page.locator('#pub-release-port').fill('0');
  const staged=await act(page,'publisher.release.stage',()=>page.locator('#pub-release-form button[type=submit]').click());
  const activated=await act(page,'publisher.release.activate',()=>page.locator('[data-pub-activate-release="'+releaseId+'"]').click());
  const inspected=await act(page,'publisher.release.inspect',()=>page.locator('[data-pub-inspect-release="'+releaseId+'"]').click());
  check(activated.state.publisher.releases.state.active===releaseId,'The original retained release was not selected');
  check(JSON.stringify(inspected.result).includes(exported.result.snapshot),'Retained release inspection lost the original dataset snapshot');
  report.publisher={draftId:draft.id,releaseId,generation:activated.state.publisher.releases.state.generation,sourceFiles:exported.result.files.length,packageDirectory:prepared.result.packageDirectory};
  await record('original_publication_source_receiving',report.publisher);
  await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('workspace-summary')?.textContent.includes('165 captured studies'));
  await page.locator('[data-section=studies]').click();await page.locator('#study-search').fill('NCT03529110');
  await read(page,()=>page.locator('#study-search-form button[type=submit]').click(),'/api/clinical/studies');
  check((await page.locator('#studies-table').textContent()).includes('follow-up'),'Retained review is missing after mobile reload');
  await record('same_session_mobile_reopen',{width:390,reviewId:report.review.id});
  await page.context().close();page=null;
  if(prsConsoleUrl){
    const xmlPage=await attach(prsConsoleUrl);page=xmlPage;
    await xmlPage.locator('[data-section=prs]').click();
    const xmlPath=join(sourceRoot,'stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials/prs/examples/eudract_pkg/1234.xml');
    await xmlPage.locator('#prs-file').setInputFiles(xmlPath);
    const uploadedReady=xmlPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/clinical/prs-upload',{timeout:90000});uploadedReady.catch(()=>{});
    await xmlPage.locator('#prs-upload-form button[type=submit]').click();const uploadedResponse=await uploadedReady,uploaded=await uploadedResponse.json();
    check(uploadedResponse.status()===201,'Original XML import failed');
    const original=uploaded.result;check(original.report.schemaValid,'Original publisher XML does not validate against its source XSD');
    await xmlPage.locator('#prs-reviewer').fill('1FB3 internal XML example receiving');
    await xmlPage.locator('#prs-rationale').fill('Review the original eudract_pkg example against the retained NLM deprecated-element profile.');
    const decisions=original.report.legacyElements.map(x=>({elementId:x.elementId,action:'remove',reason:'Internal example modernization: the retained original NLM profile identifies this exact scoped element as deprecated; preserve its value in the unchanged original and reviewed plan.'}));
    await xmlPage.locator('#prs-decisions').fill(JSON.stringify(decisions));
    const planned=await act(xmlPage,'prs.plan',()=>xmlPage.locator('#prs-plan-form button[type=submit]').click());
    const applied=await act(xmlPage,'prs.apply',()=>xmlPage.locator('#prs-apply').click());
    await xmlPage.locator('#prs-preview-base').selectOption(original.id);
    await xmlPage.locator('#prs-preview-incoming').selectOption(applied.result.document.id);
    await xmlPage.locator('#prs-preview-reviewer').fill('1FB3 internal XML example receiving');
    const preview=await act(xmlPage,'prs.preview',()=>xmlPage.locator('#prs-preview-form button[type=submit]').click());
    const reread=await read(xmlPage,()=>xmlPage.locator('#prs-read-preview').click(),'/api/clinical/prs-preview');
    check(reread.id===preview.result.previewId&&reread.baseDocumentId===original.id,'Retained composed preview identity changed');
    report.prs={originalId:original.id,planId:planned.result.id,candidateId:applied.result.document.id,previewId:preview.result.previewId,legacyOccurrences:decisions.length,source:'Original eudract_pkg publisher example, separate internal XML workspace'};
    await download(xmlPage,()=>xmlPage.locator('#prs-download-xml').click());
    await record('original_xml_reviewed_candidate_and_preview',report.prs);
    await xmlPage.context().close();page=null;
  }
  check(report.pageErrors.length===0,'The rendered operator reported page errors');
  report.passed=true;report.closed=true;report.finishedAt=new Date().toISOString();await save();return report;
 }catch(error){
  report.passed=false;report.error=String(error.message||error);
  if(page){report.notice=await page.locator('#notice').textContent().catch(()=>null);await page.screenshot({path:join(outputDirectory,'operator-failure.png'),fullPage:false}).catch(()=>{});}
  await save();throw error;
 }finally{await browser.close();}
}
