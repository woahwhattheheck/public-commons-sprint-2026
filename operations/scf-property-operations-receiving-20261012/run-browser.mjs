// MIT. Read-only receiving of the original Property Operations browser while its owner stays open.
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {identity,need,now,writeJSON,view,directory} from './io.mjs';
export async function receivePropertyBrowser({url,createdAt,propertyId,outputDirectory,playwrightModule,executablePath}){
 need(typeof url==='string'&&new URL(url).hostname==='127.0.0.1'&&isAbsolute(playwrightModule)&&isAbsolute(executablePath),'PROPERTY_BROWSER_INPUT');
 const playwright=await import(pathToFileURL(resolve(playwrightModule)));
 need(playwright.chromium?.launch,'PROPERTY_BROWSER_RUNTIME');
 const executable=await identity(executablePath),source=await identity(playwrightModule);
 await directory(outputDirectory,{create:true});let browser=null,context=null,primary=null;const errors=[],rejected=[],requests=[],pages=[];
 try{
  browser=await playwright.chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),target=new URL(request.url());
   if(target.protocol==='data:'||target.protocol==='blob:')return route.continue();
   if(target.origin!==new URL(url).origin){rejected.push({method:request.method(),url:target.origin+target.pathname});return route.abort();}
   if(!['GET','HEAD'].includes(request.method())){
    let body;try{body=request.postDataJSON();}catch{}
    if(target.pathname!=='/api/action'||!['property.get','property.operation','property.candidates','property.resource.publisher'].includes(body?.action)){
     rejected.push({method:request.method(),path:target.pathname,action:body?.action??null});return route.abort();
    }
   }
   requests.push({method:request.method(),path:target.pathname});return route.continue();
  });
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#connection-status')?.textContent==='Local workspace',null,{timeout:60000});
  const observed=await page.evaluate(async token=>{const res=await fetch('/api/state',{headers:{authorization:'Bearer '+token}});if(!res.ok)throw Error('Native state not readable');return res.json();},new URL(url).hash.slice(1));
  need(observed.createdAt===createdAt&&observed.property.id===propertyId,'PROPERTY_BROWSER_WORKSPACE_CHANGED');
  const sections=['source','capture','editions','query','merchant','publisher','exports','property'];
  for(const section of sections){
   await page.locator('button[data-section="'+section+'"]').click();
   await page.locator('#section-'+section).waitFor({state:'visible'});
   const detail=await page.locator('#section-'+section).innerText();need(detail.trim().length>0,'PROPERTY_BROWSER_EMPTY_SECTION');
   pages.push({section,characters:detail.length,visible:true});
  }
  let fullDownload=null;
  const exported=observed.exports.at(-1);
  if(exported?.files?.length){
   const file=[...exported.files].sort((a,b)=>b.bytes-a.bytes)[0];
   await page.locator('button[data-section="exports"]').click();
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),
    page.locator('[data-export-id="'+exported.id+'"][data-export-filename="'+file.name+'"]').click()]);
   const target=join(outputDirectory,'Original_'+file.name);await download.saveAs(target);
   const got=await identity(target);need(got.bytes===file.bytes&&got.sha256===file.sha256,'PROPERTY_BROWSER_DOWNLOAD_CHANGED');
   fullDownload={exportId:exported.id,name:file.name,...got};
  }
  await page.locator('button[data-section="property"]').click();
  for(const tab of ['sources','identity','inspections','handover']){
   await page.locator('.property-tabs button[data-tab="'+tab+'"]').click();await page.locator('[data-property-tab="'+tab+'"]').waitFor({state:'visible'});
   pages.push({section:'property/'+tab,characters:(await page.locator('[data-property-tab="'+tab+'"]').innerText()).length,visible:true});
  }
  await page.locator('.property-tabs button[data-tab="sources"]').click();
  await page.screenshot({path:join(outputDirectory,'Property_Desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(outputDirectory,'Property_Mobile.png'),fullPage:true});
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  need(errors.length===0&&rejected.length===0,'PROPERTY_BROWSER_READ_FAILED');
  const report={schema:'stellar-forge.property-browser-receiving.v1',status:'COMPLETE',createdAt,propertyId,source,executable,
   sections:pages,fullDownload,requests,pageErrors:errors,rejectedRequests:rejected,dimensions,domainWrites:0,completedAt:now()};
  await writeJSON(join(outputDirectory,'Browser_Receiving.json'),report);return report;
 }catch(error){primary=error;throw error;}
 finally{
  const failures=[];try{if(context)await context.close();}catch(error){failures.push(view(error));}
  try{if(browser)await browser.close();}catch(error){failures.push(view(error));}
  if(failures.length){if(primary)primary.closeErrors=failures;else throw Object.assign(new Error('The original receiving browser did not close.'),{code:'PROPERTY_BROWSER_CLOSE',closeErrors:failures});}
 }
}
