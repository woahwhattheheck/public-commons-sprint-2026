// MIT. Actual desktop and phone receiving through the original Huwise browser.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { privateDirectory, optionalJSON, fileInfo, keepFile, atomicJSON, equal, failure } from './opendatasoft-facilitator-files.mjs';

const FILES=[
  {button:'Download native review',name:'facilitator-review.json',filename:id=>'facilitator-review-'+id+'.json'},
  {button:'Download source binding',name:'facilitator-source.json',filename:id=>'facilitator-source-'+id+'.json'},
  {button:'Download operating guide',name:'FACILITATORS.md',filename:()=> 'HUWISE-FACILITATORS.md'}
];
const VIEWPORTS=[{name:'desktop',width:1440,height:1000},{name:'phone',width:390,height:844}];
function check(condition,code,message){if(!condition)throw failure(code,message);}
function publicURL(value){const u=new URL(value);return u.pathname+u.search;}
async function screenshot(page,path){
  const pending=path+'.'+randomUUID()+'.png';
  try {
    await page.screenshot({path:pending,fullPage:true,animations:'disabled'});
    return await keepFile(pending,path);
  } finally {await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

/** Reads every selected review through the real UI. It performs no review,
 * stage, seller activation or purchase. The surrounding native programme owns
 * those operations and supplies their exact returned files for comparison. */
export async function receiveFacilitatorBrowser({url,directory,reviews,playwrightModule,executablePath,
  launchArgs=[],signal,onProgress=()=>{}}={}) {
  check(Array.isArray(reviews)&&reviews.length>0&&reviews.every(value=>/^[a-f0-9]{64}$/.test(value.reviewId)&&Array.isArray(value.files)),
    'HUWISE_BROWSER_INPUT','Supply the original received reviews and their exact file descriptors.');
  check(typeof playwrightModule==='string'&&typeof executablePath==='string'&&Array.isArray(launchArgs)&&launchArgs.every(value=>typeof value==='string'),
    'HUWISE_BROWSER_RUNTIME','Use the host-provided Playwright module and existing browser executable.');
  const originalURL=new URL(url);
  check(originalURL.protocol==='http:'&&originalURL.hostname==='127.0.0.1'&&/^[A-Za-z0-9_-]{32,256}$/.test(originalURL.hash.slice(1)),
    'HUWISE_BROWSER_URL','Use the complete private browser link from the original merchant host.');
  directory=await privateDirectory(directory);
  const resultPath=join(directory,'browser-receiving.json');
  const binding={schema:'stellar-forge.opendatasoft-facilitator-browser-binding.v1',
    reviews:reviews.map(value=>({reviewId:value.reviewId,sourceSha256:value.sourceSha256,
      files:value.files.map(file=>({name:file.name,bytes:file.bytes,sha256:file.sha256}))})),
    viewports:VIEWPORTS,
    playwright:await fileInfo(resolve(playwrightModule),16777216)};
  let record=await optionalJSON(resultPath);
  if(record&&!equal(record.binding,binding))throw failure('HUWISE_BROWSER_BINDING_CHANGED','The browser receiving belongs to different original reviews or a different Playwright entry.');
  record??={schema:'stellar-forge.opendatasoft-facilitator-browser-receiving.v1',binding,
    startedAt:new Date().toISOString(),state:'PREPARING',steps:[],files:[],attempts:[]};
  if(record.state==='COMPLETE'){
    for(const file of record.files)check(equal(await fileInfo(join(directory,file.name),file.bytes),{bytes:file.bytes,sha256:file.sha256}),
      'HUWISE_BROWSER_REOPEN','An original browser download or screenshot differs from its completed receipt.');
    return record;
  }
  const attempt={id:randomUUID(),startedAt:new Date().toISOString(),state:'STARTING',steps:[],files:[]};
  record.attempts.push(attempt);await atomicJSON(resultPath,record);
  const prefix=join(directory,'attempt-'+attempt.id);await privateDirectory(prefix);
  const progress=async(name,details={})=>{
    const step={name,at:new Date().toISOString(),...details};attempt.steps.push(step);record.steps.push(step);
    await atomicJSON(resultPath,record);await onProgress(step);
  };
  const retain=async(name,info)=>{const file={name:'attempt-'+attempt.id+'/'+name,...info};attempt.files.push(file);record.files.push(file);await atomicJSON(resultPath,record);return file;};
  let browser,context,closePromise;
  const apiErrors=[],pageErrors=[],mutations=[];
  const close=()=>closePromise??=(async()=>{try{await context?.close();context=null;}finally{await browser?.close();browser=null;}})();
  const aborted=()=>{void close().catch(()=>{});};
  try {
    signal?.throwIfAborted();
    const imported=await import(pathToFileURL(resolve(playwrightModule)).href);
    const chromium=imported.chromium??imported.default?.chromium;
    check(chromium&&typeof chromium.launch==='function','HUWISE_BROWSER_RUNTIME','The selected installed module does not expose Chromium.');
    browser=await chromium.launch({executablePath:resolve(executablePath),headless:true,args:[...launchArgs]});
    signal?.addEventListener('abort',aborted,{once:true});signal?.throwIfAborted();
    record.browserVersion=browser.version();attempt.state='RUNNING';await atomicJSON(resultPath,record);
    context=await browser.newContext({viewport:{width:VIEWPORTS[0].width,height:VIEWPORTS[0].height},acceptDownloads:true});
    const page=await context.newPage();
    page.on('pageerror',error=>pageErrors.push({name:error.name,message:error.message}));
    page.on('response',response=>{try{const u=new URL(response.url());if(u.origin===originalURL.origin&&u.pathname.startsWith('/api/')&&response.status()>=400)apiErrors.push({path:publicURL(u),status:response.status()});}catch{}});
    page.on('request',request=>{try{const u=new URL(request.url());if(u.origin===originalURL.origin&&u.pathname.startsWith('/api/')&&request.method()!=='GET')mutations.push({method:request.method(),path:publicURL(u)});}catch{}});
    const selected=async review=>{
      await page.waitForFunction(id=>new URL(location.href).searchParams.get('review')===id&&document.querySelector('#selected')?.textContent.includes(id),review.reviewId,{timeout:30000});
      const text=await page.locator('#selected').innerText();
      check(text.includes(review.captureSha256)&&text.includes(review.merchantExportId),'HUWISE_BROWSER_SOURCE','The displayed review lost its complete original capture or merchant identity.');
      const all=await page.locator('#selected details').allTextContents();
      check(all.some(value=>value.includes('Complete native review'))&&all.some(value=>value.includes('Complete provider supported response')),
        'HUWISE_BROWSER_NATIVE','The full native response is not present in the original browser.');
    };
    for(const viewport of VIEWPORTS){
      signal?.throwIfAborted();await page.setViewportSize({width:viewport.width,height:viewport.height});
      for(const review of reviews){
        const destination=new URL('/facilitators',originalURL);destination.searchParams.set('review',review.reviewId);destination.hash=originalURL.hash;
        await page.goto(destination.href,{waitUntil:'domcontentloaded'});await selected(review);
        await page.locator('#selected details').filter({has:page.locator('summary',{hasText:'Complete native review'})}).evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
        const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
        check(dimensions.documentWidth<=dimensions.width+1,'HUWISE_BROWSER_LAYOUT','The actual report exceeds the selected viewport; keep its received partial operation.');
        await progress('review_opened',{viewport:viewport.name,reviewId:review.reviewId,dimensions});
        const stem=viewport.name+'-'+review.reviewId;
        await retain(stem+'.png',await screenshot(page,join(prefix,stem+'.png')));
        for(const item of FILES){
          signal?.throwIfAborted();
          const expected=review.files.find(file=>file.name===item.name);
          check(expected,'HUWISE_BROWSER_FILE','The exact native export omitted a required facilitator file.');
          const [downloaded]=await Promise.all([page.waitForEvent('download',{timeout:30000}),
            page.getByRole('button',{name:item.button,exact:true}).click()]);
          check(downloaded.suggestedFilename()===item.filename(review.reviewId),'HUWISE_BROWSER_FILENAME','The displayed review download used another filename.');
          const pending=join(prefix,'.download-'+randomUUID());
          let info;
          try {
            await downloaded.saveAs(pending);
            const nativeError=await downloaded.failure();check(nativeError===null,'HUWISE_BROWSER_DOWNLOAD',nativeError??'The browser download did not finish.');
            info=await keepFile(pending,join(prefix,stem+'-'+item.name),expected);
          } finally {await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});await downloaded.delete();}
          const file=await retain(stem+'-'+item.name,info);
          await progress('complete_file_downloaded',{viewport:viewport.name,reviewId:review.reviewId,file});
        }
        await page.reload({waitUntil:'domcontentloaded'});await selected(review);
        await progress('saved_review_reopened',{viewport:viewport.name,reviewId:review.reviewId});
      }
      const last=reviews.at(-1);await page.locator('#history-filter').fill(last.reviewId);
      for(let pageNumber=0;await page.locator('#history .review-choice').count()===0;pageNumber++){
        check(pageNumber<10000&&await page.locator('#history-more').isVisible(),'HUWISE_BROWSER_HISTORY','The complete native history does not contain its returned review.');
        await page.locator('#history-more').click();
        await page.waitForFunction(()=>!document.querySelector('#history-more').disabled,{timeout:30000});
      }
      await page.locator('#history .review-choice').filter({hasText:last.reviewId}).click();await selected(last);
      await progress('history_selected',{viewport:viewport.name,reviewId:last.reviewId});
      await page.locator('#history-filter').fill('');
    }
    check(apiErrors.length===0&&pageErrors.length===0,'HUWISE_BROWSER_ERROR','The original browser returned a failed API response or script error.');
    check(mutations.length===0,'HUWISE_BROWSER_MUTATION','The read/download receiving unexpectedly dispatched a native mutation.');
    record.observedRequests={apiErrors,pageErrors,mutations};attempt.state='COMPLETE';attempt.completedAt=new Date().toISOString();
    await close();record.teardownComplete=true;record.state='COMPLETE';record.completedAt=new Date().toISOString();
    await atomicJSON(resultPath,record);return record;
  } catch(error) {
    attempt.state=signal?.aborted?'INTERRUPTED':'FAILED';attempt.error={code:error.code??error.name,message:error.message};record.state=attempt.state;
    await atomicJSON(resultPath,record).catch(()=>{});throw error;
  } finally {
    record.observedRequests={apiErrors,pageErrors,mutations};
    signal?.removeEventListener('abort',aborted);
    try {await close();record.teardownComplete=true;} catch(error){record.teardownComplete=false;record.closeError={code:error.code??error.name,message:error.message};throw error;}
    finally {await atomicJSON(resultPath,record);}
  }
}
