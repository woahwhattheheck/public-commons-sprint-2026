// MIT. Read-only browser receiving on the original GridFabric HTTP owner.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function runBrowser({connection,outputDirectory,workspaceId,revision,playwrightPackage,executablePath,expectedFiles=[]}){
  requireValue(playwrightPackage&&executablePath,'Select the existing Playwright entry module and Chromium executable explicitly.');
  const output=resolve(outputDirectory);mkdirSync(output,{recursive:true,mode:0o700});
  const playwright=await import(pathToFileURL(resolve(playwrightPackage)));
  let browser=null,context=null,page=null,primaryError=null;
  const errors=[],blocked=[],report={schema:'stellar-forge.gridfabric-read-only-browser-receiving.v1',
    status:'RUNNING',workspace_id:workspaceId,revision,started_at:new Date().toISOString(),sections:[],collections:[],downloads:[],page_errors:errors,blocked_mutations:blocked};
  const checkpoint=()=>writeFileSync(join(output,'Browser_Receiving.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  async function ready(){
    await page.waitForFunction(({workspaceId,revision})=>{
      const id=document.getElementById('workspace-id'),rev=document.getElementById('workspace-revision');
      return id?.textContent===workspaceId&&rev?.textContent==='Revision '+revision&&!document.body.classList.contains('busy');
    },{workspaceId,revision},{timeout:120000});
  }
  async function originalPage(collection,offset=0,limit=100){
    await page.locator('nav [data-section="records"]').click();
    await page.locator('#record-collection').selectOption(collection);
    await page.locator('#record-scope').fill('');await page.locator('#record-tag').fill('');
    await page.locator('#record-offset').fill(String(offset));await page.locator('#record-limit').selectOption(String(limit));
    await page.locator('#record-order').selectOption('asc');
    const response=page.waitForResponse(result=>{
      const url=new URL(result.url());return result.request().method()==='GET'&&
        ['/api/page','/api/host/page'].includes(url.pathname)&&url.searchParams.get('collection')===collection&&url.searchParams.get('offset')===String(offset);
    },{timeout:120000});response.catch(()=>{});
    await page.locator('#record-filter button[type="submit"]').click();
    const original=await response;requireValue(original.status()===200,'The original browser page failed.');
    const value=await original.json();
    await page.waitForFunction(({rows,total})=>{
      const table=document.querySelectorAll('#record-table tbody tr'),count=document.getElementById('record-count');
      return !document.body.classList.contains('busy')&&table.length===rows&&count?.textContent.includes(total?'of '+total:'No records');
    },{rows:value.rows.length,total:value.total},{timeout:120000});
    requireValue(value.collection===collection&&value.offset===offset,'The original rendered collection differs.');
    report.collections.push({collection,total:value.total,offset:value.offset,rows:value.rows.length});checkpoint();return value;
  }
  try{
    browser=await playwright.chromium.launch({executablePath:resolve(executablePath),headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
    report.browser_started=true;
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    page=await context.newPage();
    page.on('pageerror',error=>{errors.push(error.message);checkpoint();});
    await page.route('**/api/**',async route=>{
      const request=route.request();
      if(request.method()!=='GET'){blocked.push({method:request.method(),path:new URL(request.url()).pathname});checkpoint();await route.abort('blockedbyclient');}
      else await route.continue();
    });
    await page.goto(connection.origin+'/#'+connection.token,{waitUntil:'domcontentloaded',timeout:120000});await ready();
    const sections=await page.locator('nav button[data-section]').evaluateAll(nodes=>nodes.map(node=>node.dataset.section));
    for(const name of sections){
      await page.locator('nav [data-section="'+name+'"]').click();
      requireValue(await page.locator('#section-'+name).isVisible(),'The original section is not visible: '+name);
      requireValue(await page.locator('nav [data-section="'+name+'"]').getAttribute('aria-current')==='page','The active original navigation label differs.');
      report.sections.push(name);
    }
    for(const collection of ['instances','sources','mappings','events','device_actions','reports','management_operations','callbacks','callback_deliveries','source_issues']){
      const value=await originalPage(collection);
      if(value.rows.length&&collection!=='source_issues'){
        await page.locator('#record-table button[data-row="0"]').click();
        await page.waitForFunction(({id})=>{
          const pane=document.getElementById('inspector'),body=document.getElementById('inspector-json');
          return pane&&!pane.hidden&&body?.textContent.includes(id)&&!document.body.classList.contains('busy');
        },{id:value.rows[0].id},{timeout:120000});
        await page.locator('#inspector-close').click();
      }
    }
    const rows=await originalPage('source_rows',0,100);
    if(rows.total>100)await originalPage('source_rows',Math.floor((rows.total-1)/100)*100,100);
    const reports=await originalPage('report_rows',0,100);
    if(reports.total>100)await originalPage('report_rows',Math.floor((reports.total-1)/100)*100,100);
    const files=await originalPage('host_files',0,1000);
    const target=[...expectedFiles].filter(item=>/Plaid_Report_Response/.test(item.name)).sort((a,b)=>b.bytes-a.bytes)[0]||
      [...expectedFiles].sort((a,b)=>b.bytes-a.bytes)[0];
    requireValue(target,'The completed browser receiving has no original file to download.');
    let selected=files,index=selected.rows.findIndex(row=>row.sha256===target.sha256),offset=0;
    while(index<0&&selected.next_offset!==null){
      offset=selected.next_offset;selected=await originalPage('host_files',offset,1000);index=selected.rows.findIndex(row=>row.sha256===target.sha256);
    }
    requireValue(index>=0,'The exact complete original download is absent from the browser file catalogue.');
    const download=page.waitForEvent('download',{timeout:180000});download.catch(()=>{});
    await page.locator('#record-table button[data-row="'+index+'"]').click();
    const received=await download,filename=join(output,'Browser_Original_'+target.sha256+'.utf8');
    await received.saveAs(filename);requireValue(!await received.failure(),'The browser download failed.');
    const full=readFileSync(filename);requireValue(full.length===target.bytes&&digest(full)===target.sha256,'The whole browser download differs from its retained original file.');
    report.downloads.push({name:target.name,path:filename,bytes:full.length,sha256:target.sha256});
    await ready();await page.locator('nav [data-section="reports"]').click();
    await page.screenshot({path:join(output,'GridFabric_Desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('nav [data-section="recovery"]').click();
    requireValue(await page.locator('#pending-summary').isVisible(),'The saved-action receiving panel is not visible on mobile.');
    await page.screenshot({path:join(output,'GridFabric_Mobile.png'),fullPage:true});
    const stateResponse=await page.request.get(connection.origin+'/api/state',{headers:{Authorization:'Bearer '+connection.token,Origin:connection.origin}});
    requireValue(stateResponse.status()===200,'The original final browser state could not be read.');
    const final=await stateResponse.json();
    requireValue(final.workspace_id===workspaceId&&final.revision===revision,'The read-only browser changed the original revision.');
    requireValue(errors.length===0&&blocked.length===0,'The browser reported an error or attempted a mutation.');
    report.status='COMPLETE';report.completed_at=new Date().toISOString();checkpoint();return report;
  }catch(error){
    primaryError=error;report.status='INCOMPLETE';report.error={message:error.message};
    try{await page.screenshot({path:join(output,'GridFabric_Browser_Failure.png'),fullPage:true});}catch{}
    checkpoint();throw error;
  }finally{
    const closeErrors=[];
    try{
      if(context)await context.close();
    }catch(error){closeErrors.push({owner:'context',message:error.message});}
    finally{
      try{
        if(browser){await browser.close();report.browser_closed=true;report.closed_at=new Date().toISOString();}
      }catch(error){closeErrors.push({owner:'browser',message:error.message});}
    }
    if(closeErrors.length){report.close_errors=closeErrors;report.status='INCOMPLETE';}
    checkpoint();
    if(!primaryError&&closeErrors.length)throw Object.assign(new Error('The original browser owner did not close completely.'),{closeErrors});
  }
}
