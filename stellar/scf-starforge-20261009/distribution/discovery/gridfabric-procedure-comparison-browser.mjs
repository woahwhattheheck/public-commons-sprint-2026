// MIT. Continue the original GridFabric receiving browser; never open a native owner.
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readGridFabricProcedureCapture} from './gridfabric-procedure-native.mjs';
import {compareGridFabricCaptures,receiveGridFabricComparison,renderGridFabricComparisonHTML} from './gridfabric-procedure-comparison.mjs';
import {exportGridProcedureArchive} from '../../sf30-seller-sdk/gridfabric-plaid/procedure-archive.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const identity=async path=>{const raw=await readFile(path);return{path,bytes:raw.length,sha256:digest(raw)};};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/**
 * Borrow one already-authenticated original procedures page from its existing owner.
 * This course reads originals, changes only that browser's comparison selection,
 * downloads complete editions and reloads the same page. It never closes the
 * borrowed page/context or dispatches a native operation.
 */
export async function receiveGridFabricComparisonBrowser({
  page,beforeDirectory,afterDirectory,beforeRequestId,afterRequestId,
  beforeReportId=null,afterReportId=null,outputDirectory
}){
  need(page&&UUID.test(beforeRequestId)&&UUID.test(afterRequestId),'Supply the original browser page and two saved request UUIDs.');
  const originalPath=new URL(page.url()).pathname;
  need(originalPath==='/procedures'||originalPath==='/procedures.html','Use the existing Customer procedures page.');
  const before=await readGridFabricProcedureCapture(resolve(beforeDirectory));
  const after=await readGridFabricProcedureCapture(resolve(afterDirectory));
  const expected=compareGridFabricCaptures(before,after,{beforeReportId,afterReportId});
  const output=resolve(outputDirectory);await mkdir(output,{mode:0o700});
  const result={schema:'stellar-forge.gridfabric-comparison-browser-receiving.v1',status:'RUNNING',
    beforeRequestId,afterRequestId,selection:expected.selection,
    before:expected.before.receipt,after:expected.after.receipt,startedAt:new Date().toISOString(),
    checks:[],artifacts:[],blockedMutations:[],pageErrors:[],cleanupErrors:[],
    visualInspection:{status:'REQUIRES_PRODUCER_LOOK',instruction:'Look at the actual populated desktop/narrow screenshots and downloaded report; record usability and content observations before client-ready.'}};
  const resultPath=join(output,'Comparison_Browser_Receiving.json');
  async function checkpoint(){const temp=resultPath+'.tmp';await writeFile(temp,JSON.stringify(result,null,2)+'\n',{mode:0o600});await rename(temp,resultPath);}
  await checkpoint();
  const viewport=page.viewportSize();
  let reportPage=null,primary=null,routed=false;
  const onError=error=>result.pageErrors.push(error.message);
  const route=async route=>{const request=route.request();
    if(!['GET','HEAD'].includes(request.method())){result.blockedMutations.push({method:request.method(),path:new URL(request.url()).pathname});await route.abort('blockedbyclient');}
    else await route.continue();
  };
  const idle=()=>page.waitForFunction(()=>!document.getElementById('controls')?.disabled&&
    document.getElementById('save-state')?.textContent==='Current browser work is saved',undefined,{timeout:120000});
  async function compare(){
    await page.getByRole('button',{name:'Compare selected reports',exact:true}).click();
    await page.locator('#comparison-result').waitFor({state:'visible',timeout:120000});await idle();
  }
  async function readBoth(){
    await page.getByRole('button',{name:'Read both original captures',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice')?.textContent.startsWith('Both full original captures are received.'),undefined,{timeout:120000});await idle();
  }
  async function download(label,name){
    const pending=page.waitForEvent('download',{timeout:180000});pending.catch(()=>{});
    await page.getByRole('button',{name:label,exact:true}).click();
    const item=await pending,path=join(output,name);await item.saveAs(path);
    need(!await item.failure(),'The original comparison download failed.');
    result.artifacts.push(await identity(path));await idle();return path;
  }
  async function screenshot(target,name){const path=join(output,name);await target.screenshot({path,fullPage:true});
    result.artifacts.push(await identity(path));await checkpoint();}
  try{
    page.on('pageerror',onError);await page.route('**/api/**',route);routed=true;
    await idle();await page.locator('[data-section="compare"]').click();
    await page.getByLabel('Original before request UUID',{exact:true}).fill(beforeRequestId);
    await page.getByLabel('Original after request UUID',{exact:true}).fill(afterRequestId);
    await readBoth();
    if(expected.selection.beforeReportId)await page.getByLabel('Original report',{exact:true}).nth(0).selectOption(expected.selection.beforeReportId);
    if(expected.selection.afterReportId)await page.getByLabel('Original report',{exact:true}).nth(1).selectOption(expected.selection.afterReportId);
    await compare();
    const jsonPath=await download('Download full comparison JSON','GridFabric_Report_Comparison.json');
    const original=JSON.parse(await readFile(jsonPath,'utf8'));
    receiveGridFabricComparison(original,before,after);
    need(equal(original,expected),'The browser comparison differs from the two original received captures.');
    result.checks.push('Full browser comparison equals the original offline model and all original report rows.');
    const htmlPath=await download('Download readable comparison report','GridFabric_Report_Comparison.html');
    need((await readFile(htmlPath,'utf8'))===renderGridFabricComparisonHTML(expected),'The complete downloaded HTML differs.');
    await page.setViewportSize({width:1440,height:1000});await screenshot(page,'Comparison_Desktop.png');
    await page.setViewportSize({width:390,height:844});await screenshot(page,'Comparison_Narrow.png');
    // Exact downloaded report, within the caller's original browser context.
    reportPage=await page.context().newPage();
    await reportPage.goto(pathToFileURL(htmlPath).href,{waitUntil:'load',timeout:120000});
    await reportPage.getByRole('heading',{name:'Measurement intervals',exact:true}).waitFor();
    await reportPage.setViewportSize({width:1440,height:1000});await screenshot(reportPage,'Downloaded_Report_Desktop.png');
    await reportPage.setViewportSize({width:390,height:844});await screenshot(reportPage,'Downloaded_Report_Narrow.png');
    await reportPage.close();reportPage=null;
    result.checks.push('Exact downloaded readable report opened with populated desktop and narrow views.');

    // All raw response/binary files travel in the two original archives.
    for(const [side,directory]of [['before',beforeDirectory],['after',afterDirectory]]){
      const archive=await exportGridProcedureArchive({directory:resolve(directory),outputFile:join(output,'GridFabric_'+side+'.gridprocedure.jsonl.gz')});
      result.artifacts.push({path:archive.path??archive.file??join(output,'GridFabric_'+side+'.gridprocedure.jsonl.gz'),bytes:archive.bytes,sha256:archive.sha256});
      if(archive.bytes<=64*1024*1024){
        const received=await download('Download complete '+side+' capture archive','Browser_'+side+'.gridprocedure.jsonl.gz');
        const actual=await identity(received);need(actual.bytes===archive.bytes&&actual.sha256===archive.sha256,'The complete browser archive differs from original native export.');
        result.checks.push('Complete '+side+' archive downloaded through the existing browser control.');
      }else result.checks.push('Complete '+side+' archive exported through the original streaming native path; browser file-picker streaming remains an explicit operator control.');
    }
    // Reload existing origin/IndexedDB. No complete result is trusted from local history.
    await page.reload({waitUntil:'domcontentloaded',timeout:120000});await idle();
    await page.locator('[data-section="compare"]').click();
    need(await page.getByLabel('Original before request UUID',{exact:true}).inputValue()===beforeRequestId&&
      await page.getByLabel('Original after request UUID',{exact:true}).inputValue()===afterRequestId,'Cold page lost the saved comparison selection.');
    await page.getByRole('button',{name:'Compare selected reports',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice')?.classList.contains('error'),undefined,{timeout:120000});
    need(await page.locator('#comparison-result').count()===0,'A cold page used saved capture responses without original receiving.');
    await page.getByLabel('Reopen full comparison JSON',{exact:true}).setInputFiles(jsonPath);
    await idle();await readBoth();await compare();
    const reopened=JSON.parse(await readFile(await download('Download full comparison JSON','Reopened_GridFabric_Report_Comparison.json'),'utf8'));
    need(equal(reopened,original),'The complete reopened comparison differs from the saved original.');
    result.checks.push('Cold selection survives; original read is required; saved JSON reopens in full.');
    need(result.blockedMutations.length===0&&result.pageErrors.length===0,'The comparison attempted a mutation or reported a browser error.');
    result.status='SOURCE_AND_BROWSER_RECEIVED';result.completedAt=new Date().toISOString();
  }catch(error){primary=error;result.status='INCOMPLETE';result.error={message:error.message,code:error.code??null};}
  finally{
    if(reportPage)try{await reportPage.close();}catch(error){result.cleanupErrors.push({owner:'downloaded-report-page',message:error.message});}
    if(routed)try{await page.unroute('**/api/**',route);}catch(error){result.cleanupErrors.push({owner:'comparison-route',message:error.message});}
    try{page.off('pageerror',onError);}catch(error){result.cleanupErrors.push({owner:'comparison-listener',message:error.message});}
    if(viewport)try{await page.setViewportSize(viewport);}catch(error){result.cleanupErrors.push({owner:'viewport',message:error.message});}
    if(result.cleanupErrors.length)result.status='INCOMPLETE';
    try{await checkpoint();}catch(error){if(!primary)primary=error;else result.cleanupErrors.push({owner:'receiving-record',message:error.message});}
  }
  if(primary)throw Object.assign(primary,{receiving:result});
  need(result.cleanupErrors.length===0,'The original borrowed browser cleanup is incomplete.');
  return result;
}
