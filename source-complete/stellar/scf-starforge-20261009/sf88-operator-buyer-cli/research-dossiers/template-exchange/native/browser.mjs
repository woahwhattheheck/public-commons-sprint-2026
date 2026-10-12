// MIT. Read the operated template flow through the original host/browser page.
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export async function runTemplateExchangeBrowser({page,templateUrl,dossierId,revision,selection,runDirectory,signal}){
 need(page&&templateUrl&&dossierId&&selection?.releaseId,'TEMPLATE_EXISTING_BROWSER_SELECTION_REQUIRED');
 need(!signal?.aborted,'TEMPLATE_OPERATION_CANCELLED');const url=new URL(templateUrl);url.searchParams.set('dossierId',dossierId);
 const directory=resolve(runDirectory,'template-browser');await fs.mkdir(directory,{recursive:true});
 const errors=[];const listener=e=>errors.push(String(e.message??e));page.on('pageerror',listener);
 const abort=()=>page.close().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 try{
  await page.setViewportSize({width:1440,height:1000});await page.goto(url.toString(),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(({id,revision})=>window.templateExchangeApp?.revision>=revision&&document.getElementById('dossier')?.value===id,{id:dossierId,revision},{timeout:30000});
  const selected=await page.evaluate(selection=>{
   const app=window.templateExchangeApp,r=app.records;
   return {revision:app.revision,release:r.releases.find(x=>x.id===selection.releaseId),
    review:r['return-reviews'].find(x=>x.id===selection.returnReviewId),
    draft:r.drafts.find(x=>x.id===selection.draftId)};
  },selection);
  need(selected.release&&selected.review&&selected.draft,'TEMPLATE_BROWSER_SELECTED_RECORD_MISSING');
  await page.locator('[data-panel="returns"]').click();await page.locator('#review-return').selectOption(selection.returnId);
  await page.locator('#return-select-form button').click();
  await page.waitForFunction(()=>document.getElementById('return-review')?.textContent.length>50);
  const returnView=join(directory,'client-return-desktop.png');await page.screenshot({path:returnView,fullPage:true});
  await page.locator('[data-panel="draft"]').click();await page.locator('#draft-review').selectOption(selection.returnReviewId);
  await page.waitForFunction(()=>document.getElementById('draft-sets')?.textContent.includes('Original result sets'));
  const draftView=join(directory,'native-draft-desktop.png');await page.screenshot({path:draftView,fullPage:true});
  await page.locator('[data-panel="history"]').click();await page.locator('#history-kind').selectOption('release');
  await page.locator('#history-record').selectOption(selection.releaseId);await page.locator('#history-open').click();
  await page.waitForFunction(()=>document.getElementById('history-summary')?.textContent.includes('Download original workbook'));
  const waiting=page.waitForEvent('download',{timeout:30000});await page.locator('#history-summary button').filter({hasText:'Download original workbook'}).click();
  const download=await waiting,path=join(directory,'downloaded-reviewed-release.xlsx');await download.saveAs(path);
  const body=await fs.readFile(path),sha256=createHash('sha256').update(body).digest('hex');
  need(body.length===selected.release.workbook.bytes&&sha256===selected.release.workbook.sha256,'TEMPLATE_BROWSER_DOWNLOAD_CHANGED');
  await page.setViewportSize({width:390,height:844});await page.locator('[data-panel="returns"]').click();
  const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
  need(overflow.body<=overflow.viewport+1,'TEMPLATE_MOBILE_PAGE_OVERFLOW');
  const mobile=join(directory,'client-return-mobile.png');await page.screenshot({path:mobile,fullPage:true});
  need(errors.length===0,'TEMPLATE_BROWSER_PAGE_ERROR');
  const result={schema:'sf88-template-browser-result/v1',dossierId,revision:selected.revision,selection,url:url.origin+url.pathname+url.search,
   sourceDownload:{path,bytes:body.length,sha256},screenshots:[returnView,draftView,mobile],viewport:overflow,pageErrors:errors,
   visualReview:'Screenshots retained for the receiving owner; image generation alone is not a visual acceptance.'};
  await fs.writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
 }finally{page.off('pageerror',listener);signal?.removeEventListener('abort',abort);}
}
