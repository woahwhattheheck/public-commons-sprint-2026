// MIT. Full offline laboratory operator receiving against the original completed worker outputs.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory } from '../jobs/inputs/files.mjs';
import { writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, sha256, normalizeDecisions } from './model.mjs';
import { parseReviewTable } from './decisions.mjs';
import { labProfile } from './profiles.mjs';
import { receiveLabReconciliationBrowser } from './receiving-reconciliation.mjs';
const equal=(a,b,message)=>{if(canonicalJson(a)!==canonicalJson(b))throw Error(message);};
async function immutable(path,bytes){
  await privateDirectory(dirname(path));
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const retained=await readFile(path);equal(sha256(retained),sha256(bytes),'A retained browser output differs: '+path);}
}
async function downloaded(page,action,path){
  const pending=page.waitForEvent('download');await action();const download=await pending;
  const failure=await download.failure();if(failure)throw Error('The original browser download failed: '+failure);
  const source=await download.path(),bytes=await readFile(source);await immutable(path,bytes);
  return {bytes,filename:download.suggestedFilename(),sha256:sha256(bytes)};
}
export async function receiveLabBrowser({directory,configuration,families,signal}={}){
  if(!configuration?.playwrightModule||!configuration?.executablePath)
    throw Error('Select the existing Playwright module and installed Chromium executable for this same receiving operation.');
  const modulePath=await realpath(resolve(configuration.playwrightModule));
  const module=await import(pathToFileURL(modulePath.endsWith('.mjs')||modulePath.endsWith('.js')?modulePath:join(modulePath,'index.mjs')).href);
  const chromium=module.chromium??module.default?.chromium;if(!chromium)throw Error('The installed browser module exposes no Chromium runtime.');
  const assets=new Map(),mime={'html':'text/html; charset=utf-8','json':'application/json','csv':'text/csv','tsv':'text/tab-separated-values',
    'zip':'application/zip','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xls':'application/vnd.ms-excel','md':'text/plain; charset=utf-8'};
  for(const [family,state]of Object.entries(families)){
    const retained=state.iterations.reviewed;if(!retained?.completedAt)throw Error('Receive every original reviewed output first.');
    for(const file of retained.files)assets.set('/'+family+'/'+file.path,{...file,absolute:join(retained.extractedDirectory,file.path)});
  }
  const server=createServer((request,response)=>{
    let path;try{path=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400).end();return;}
    if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405).end();return;}
    const file=assets.get(path);if(!file){response.writeHead(404).end();return;}
    response.writeHead(200,{'content-type':mime[file.path.split('.').at(-1)]??'application/octet-stream','content-length':file.bytes,'cache-control':'no-store'});
    if(request.method==='HEAD'){response.end();return;}const stream=createReadStream(file.absolute);stream.on('error',()=>response.destroy());stream.pipe(response);
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const origin='http://127.0.0.1:'+server.address().port;
  const output=join(directory,'browser');await privateDirectory(output);
  let browser;
  const pageErrors=[],results=[];
  try{
    const args=configuration.args??[];if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'))throw Error('Select actual installed Chromium launch arguments.');
    let env;
    if(configuration.tempDirectory){
      const temp=resolve(configuration.tempDirectory);await privateDirectory(temp);env={...process.env,TMPDIR:await realpath(temp)};
    }
    browser=await chromium.launch({headless:true,executablePath:await realpath(resolve(configuration.executablePath)),args,...(env?{env}:{})});
    const cancelled=()=>browser.close().catch(()=>{});signal?.addEventListener('abort',cancelled,{once:true});
    try{
      const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
      const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
      for(const [name,state]of Object.entries(families)){
        signal?.throwIfAborted();const retained=state.iterations.reviewed,root=join(output,name);await privateDirectory(root);
        const response=await page.goto(origin+'/'+name+'/report.html',{waitUntil:'load'});
        if(!response||response.status()!==200)throw Error('The original offline report did not open.');
        const reportBytes=await response.body(),reportMeta=retained.files.find(file=>file.path==='report.html');
        equal(sha256(reportBytes),reportMeta.sha256,'The browser received different report bytes.');
        await page.locator('#records-body').waitFor();
        await page.screenshot({path:join(root,'desktop.png'),fullPage:false});
        const exports=[];
        const links=await page.locator('.downloads a[download]').evaluateAll(elements=>elements.map(element=>({
          path:element.getAttribute('href'),label:element.textContent.trim()})));
        for(let index=0;index<links.length;index++){
          const link=links[index],expected=retained.files.find(file=>file.path===link.path);
          if(!expected)throw Error('A visible report download has no original member: '+link.path);
          const file=await downloaded(page,()=>page.locator('.downloads a[download]').nth(index).click(),
            join(root,'downloads',link.path));
          equal({bytes:file.bytes.length,sha256:file.sha256},{bytes:expected.bytes,sha256:expected.sha256},'A visible browser download differs: '+link.label);
          exports.push({path:link.path,filename:file.filename,bytes:file.bytes.length,sha256:file.sha256});
        }
        const source=JSON.parse(await readFile(join(retained.extractedDirectory,'source/manifest.json'),'utf8'));
        const tables=JSON.parse(await readFile(join(retained.extractedDirectory,'source/rows.json'),'utf8'));
        const delivery={source,tables,profile:labProfile(source.profile.id)};
        const originalDoc=JSON.parse(await readFile(join(retained.extractedDirectory,'decisions.json'),'utf8'));
        const rows=tables.reduce((n,table)=>n+table.rows.length,0);
        let draftResult=null;
        if(rows){
          await page.locator('.row-open').first().click();
          const field=await page.locator('.apply-choice').first().getAttribute('data-field');
          const firstRow=tables.flatMap(table=>table.rows.map(row=>({table,row})))[0];
          const reason='Retain the exact original cell during browser receiving and keep its native laboratory interpretation unchanged.';
          await page.locator('.action').first().selectOption('keep');
          await page.locator('.reason').first().fill(reason);await page.locator('.apply-choice').first().click();
          const expectedChoices=originalDoc.decisions.filter(choice=>!(choice.recordId===firstRow.row.recordId&&choice.field===field));
          expectedChoices.push({recordId:firstRow.row.recordId,rowSha256:firstRow.row.rowSha256,field,before:firstRow.row.values[field],action:'keep',reason});
          const expected=normalizeDecisions(delivery,{...originalDoc,decisions:expectedChoices});
          const draft=await downloaded(page,()=>page.locator('#download-json').click(),join(root,'browser-decisions.json'));
          const document=normalizeDecisions(delivery,JSON.parse(draft.bytes));equal(document,expected,'The browser changed the exact original Keep decision.');
          const table=await downloaded(page,()=>page.locator('#download-csv').click(),join(root,'browser-decisions.csv'));
          equal(parseReviewTable(delivery,table.bytes.toString('utf8'),{format:'csv'}),expected,'The browser CSV lost a source-bound decision.');
          await page.locator('#load-json').setInputFiles({name:'browser-decisions.json',mimeType:'application/json',buffer:draft.bytes});
          await page.getByText('The complete saved decision file is open against its original source rows.',{exact:true}).waitFor();
          const reopened=await downloaded(page,()=>page.locator('#download-json').click(),join(root,'browser-reopened-decisions.json'));
          equal(normalizeDecisions(delivery,JSON.parse(reopened.bytes)),expected,'The original saved browser decision did not reopen.');
          draftResult={decisions:expected.decisions.length,documentSha256:sha256(canonicalJson(expected)),
            json:{bytes:draft.bytes.length,sha256:draft.sha256},csv:{bytes:table.bytes.length,sha256:table.sha256},reopened:true};
        }
        await page.locator('[data-tab="issues"]').click();
        await page.locator('[data-tab="lineage"]').click();
        await page.locator('[data-tab="source"]').click();
        await page.locator('[data-tab="records"]').click();
        await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:join(root,'mobile.png'),fullPage:false});
        const width=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
        if(width.page>width.viewport+2)throw Error('The mobile operator page exceeds the viewport.');
        await page.setViewportSize({width:1440,height:1000});
        await page.reload({waitUntil:'load'});
        const after=await downloaded(page,()=>page.locator('#download-json').click(),join(root,'original-after-reload.json'));
        equal(normalizeDecisions(delivery,JSON.parse(after.bytes)),normalizeDecisions(delivery,originalDoc),'Reload changed the immutable completed decision edition.');
        const crossProfile=retained.manifest.reconciliation?await receiveLabReconciliationBrowser({page,origin,family:name,retained,
          directory:join(root,'cross-profile'),downloaded,signal}):null;
        results.push({family:name,sourceSha256:source.sourceSha256,reviewSha256:retained.manifest.reviewSha256,crossProfile,
          rows,downloads:exports,editor:draftResult,immutableReload:true,desktop:join(root,'desktop.png'),mobile:join(root,'mobile.png'),
          nativePreparation:retained.manifest.nativePreparation});
      }
      await context.close();
    }finally{signal?.removeEventListener('abort',cancelled);}
    if(pageErrors.length)throw Error('The operator report raised a browser error: '+pageErrors.join('; '));
    return {completedAt:new Date().toISOString(),families:results,pageErrors,viewport:{desktop:[1440,1000],mobile:[390,844]}};
  }finally{
    try{await browser?.close();}finally{server.closeAllConnections?.();await new Promise(yes=>server.close(yes));}
  }
}
