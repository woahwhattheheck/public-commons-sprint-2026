/** Operate the actual original Area extraction UI in an isolated browser.
 * Host supplies its authorized Operator URL and original Playwright installation.
 * This source does not override browser/network policy or operate another session.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const sha=data=>createHash('sha256').update(data).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message);};
const save=async(file,value)=>{
  const temporary=file+'.pending-'+randomUUID();
  let stream;
  try{
    stream=await fs.open(temporary,'wx');
    await stream.writeFile(JSON.stringify(value,null,2)+'\n');
    await stream.sync();await stream.close();stream=null;
    await fs.rename(temporary,file);
    const directory=await fs.open(path.dirname(file),'r');
    try{await directory.sync();}finally{await directory.close();}
  }finally{await stream?.close().catch(()=>{});await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export async function receiveAreaBrowser(config){
  const {operatorUrl,workspaceKey,analysisId,extractionId,outputDirectory,playwrightModule,executablePath,receivedDirectory}=config;
  need([workspaceKey,analysisId,extractionId].every(hex),'Use exact original workspace, Area and extraction identities.');
  const url=new URL(operatorUrl),token=new URLSearchParams(url.hash.slice(1)).get('token');
  need(['http:','https:'].includes(url.protocol)&&token,'Supply the authorized original Operator URL with its capability fragment.');
  need(typeof outputDirectory==='string'&&typeof playwrightModule==='string','Choose output and installed Playwright paths.');
  const output=path.resolve(outputDirectory);
  await fs.mkdir(output,{recursive:true});
  const selection={schema:'upstate.area-browser-receiving/v1',origin:url.origin,workspaceKey,analysisId,extractionId,
    receiverSha256:sha(await fs.readFile(new URL(import.meta.url)))};
  const prior=await fs.readFile(path.join(output,'selection.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  need(!prior||JSON.stringify(prior)===JSON.stringify(selection),'This output retains another browser selection; use a new output directory.');
  await save(path.join(output,'selection.json'),selection);
  let browser,context,primaryError;
  const artifacts=[],errors=[];
  try{
    const playwright=await import(pathToFileURL(path.resolve(playwrightModule)).href);
    const chromium=playwright.chromium||playwright.default?.chromium;
    need(chromium,'The supplied original module has no Chromium launcher.');
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}: {})});
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    context.on('page',opened=>opened.on('pageerror',error=>errors.push({kind:'pageerror',message:error.message})));
    const page=await context.newPage();
    async function api(route,body){
      const target=new URL(route,url.origin);need(target.origin===url.origin,'Keep API reads on the selected Operator origin.');
      const response=await context.request.post(target.href,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},data:{workspace:workspaceKey,...body}});
      need(response.ok(),'Original API failed '+response.status()+' at '+target.pathname+': '+await response.text());
      return response.json();
    }
    const original=await api('/api/spatial/regions/result',{id:analysisId});
    const extract=await api('/api/spatial/regions/extract',{id:extractionId});
    need(original.id===analysisId&&original.workspace_key===workspaceKey,'Original Area belongs to another Workspace.');
    need(extract.id===extractionId&&extract.analysis_id===analysisId&&extract.workspace_key===workspaceKey,'Extraction is not bound to this actual Area.');
    need(extract.identity?.selection?.title===null&&extract.identity?.selection?.notes==='',
      'The ordinary UI button uses default title/notes. Select that exact default extraction for this replay course; inspect custom editions through their saved history without claiming button replay.');
    async function shot(name,width){
      await page.setViewportSize({width,height:1000});
      await page.locator('.spatial-regions').scrollIntoViewIfNeeded();
      const file=path.join(output,name+'-'+width+'.png');
      await page.screenshot({path:file,fullPage:true});
      const data=await fs.readFile(file);artifacts.push({path:path.basename(file),bytes:data.length,sha256:sha(data),kind:'screenshot',viewport:{width,height:1000}});
    }
    async function openOriginal(){
      await page.setViewportSize({width:1440,height:1000});
      await page.goto(operatorUrl,{waitUntil:'domcontentloaded'});
      await page.locator('#workspace-select option[value="'+workspaceKey+'"]').waitFor({state:'attached'});
      await page.locator('#workspace-select').selectOption(workspaceKey);
      await page.locator('[data-view="spatial"]').first().click();
      await page.locator('.spatial-regions').waitFor();
      await page.locator('[data-region-input="search"]').fill(analysisId);
      await page.locator('[data-region-action="open"][data-id="'+analysisId+'"]').click();
      await page.locator('[data-region-action="extract"][data-analysis="'+analysisId+'"]').waitFor();
      await page.locator('[data-region-action="open-extract"][data-id="'+extractionId+'"]').first().click();
      await page.locator('.region-extraction .region-downloads a').first().waitFor();
    }
    await openOriginal();
    // Actual ordinary control: restore the original saved Area, not a manufactured view.
    await page.locator('[data-region-action="reopen"]').click();
    await page.waitForFunction(title=>document.querySelector('[data-region-input="title"]')?.value===title,original.request.title);
    for(const width of [1440,390]){
      await shot('saved-area',width);
      await page.locator('[data-region-input="search"]').fill('__no_retained_area_matches__');
      await page.waitForFunction(()=>document.querySelector('[data-region-history]')?.textContent.includes('No saved analysis matches'));
      await shot('empty-search',width);
      await page.locator('[data-region-input="search"]').fill(analysisId);
    }
    // Retain the actual UI-generated UUID/body before allowing its one network request.
    const dispatchFile=path.join(output,'dispatch.json');
    let dispatch=await fs.readFile(dispatchFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    const taskMatches=item=>item&&hex(item.id)&&item.workspace===workspaceKey&&item.action==='spatial.region.extract'
      &&JSON.stringify(item.payload)===JSON.stringify({analysis_id:analysisId});
    async function readTask(id){
      const endpoint=new URL('/api/task',url.origin);endpoint.searchParams.set('id',id);
      const read=await context.request.get(endpoint.href,{headers:{Authorization:'Bearer '+token}});
      need(read.ok(),'Could not reopen original extraction task.');return read.json();
    }
    let task;
    if(dispatch){
      need(dispatch.analysisId===analysisId&&dispatch.extractionId===extractionId&&dispatch.workspaceKey===workspaceKey,'The retained browser dispatch belongs to another original selection.');
      if(dispatch.task?.id){
        task=await readTask(dispatch.task.id);
      }else{
        need(dispatch.state==='DISPATCHING'&&dispatch.request?.operation_id,'Retained browser dispatch is incomplete; inspect it before another click.');
        const endpoint=new URL('/api/state',url.origin);endpoint.searchParams.set('workspace',workspaceKey);
        const response=await context.request.get(endpoint.href,{headers:{Authorization:'Bearer '+token}});
        need(response.ok(),'Could not inspect the original task history after an uncertain acknowledgment.');
        const state=await response.json();
        const matches=(state.tasks||[]).filter(item=>taskMatches(item)&&item.operation_id===dispatch.request.operation_id);
        need(matches.length===1,'The original dispatch acknowledgment is uncertain. Retain dispatch.json and resolve its exact operation UUID/alias in the original task history; this course will not redispatch.');
        task=await readTask(matches[0].id);
        dispatch={...dispatch,state:'ACCEPTED',task,recovery:'original operation UUID in retained task history'};
        await save(dispatchFile,dispatch);
      }
    }else{
      let rejectBlocked;
      const blocked=new Promise((resolve,reject)=>{rejectBlocked=reject;});
      const route=async request=>{
        try{
          const body=request.request().postDataJSON();
          need(request.request().method()==='POST'&&body.workspace===workspaceKey&&body.action==='spatial.region.extract'
            &&JSON.stringify(body.payload)===JSON.stringify({analysis_id:analysisId})&&typeof body.operation_id==='string',
            'The Area control attempted a different original action.');
          dispatch={state:'DISPATCHING',workspaceKey,analysisId,extractionId,request:body};
          await save(dispatchFile,dispatch);
          await request.continue();
        }catch(error){rejectBlocked(error);await request.abort();}
      };
      await page.route(url.origin+'/api/actions',route);
      try{
        const accepted=Promise.race([page.waitForResponse(response=>response.url()===url.origin+'/api/actions'&&response.request().method()==='POST'),blocked]);
        accepted.catch(()=>{});
        await page.locator('[data-region-action="extract"][data-analysis="'+analysisId+'"]').click();
        const response=await accepted,body=await response.json();
        need(response.ok()&&taskMatches(body),'UI did not retain its original extraction action: '+JSON.stringify(body.error||body));
        task=body;dispatch={...dispatch,state:'ACCEPTED',task};
        await save(dispatchFile,dispatch);
      }finally{await page.unroute(url.origin+'/api/actions',route);}
    }
    need(taskMatches(task),'The retained task does not match the original Area extraction request.');
    const deadline=Date.now()+120000;
    let current=task;
    while(!['complete','failed','cancelled','interrupted'].includes(current.state)){
      need(Date.now()<deadline,'Extraction remains active. Its exact accepted task is retained in dispatch.json; resume this receiving course without another click.');
      await new Promise(resolve=>setTimeout(resolve,500));
      current=await readTask(task.id);need(taskMatches(current),'Original task identity changed during readback.');
    }
    await save(dispatchFile,{...dispatch,state:'OBSERVED',task:current});
    need(current.state==='complete'&&current.result?.id===extractionId,'Original extraction task did not reuse the selected edition: '+JSON.stringify(current.error||current.state));
    await openOriginal();
    const downloads=path.join(output,'downloads');await fs.mkdir(downloads,{recursive:true});
    const expected=new Map((extract._downloads||[]).map(item=>[item.url,item]));
    const anchors=page.locator('.region-extraction .region-downloads a');
    for(let index=0;index<await anchors.count();index++){
      const anchor=anchors.nth(index),href=await anchor.getAttribute('href'),destination=new URL(href,url.origin);
      const item=expected.get(destination.pathname);
      need(item&&destination.origin===url.origin,'Visible extraction link has no original ticket.');
      const [download]=await Promise.all([page.waitForEvent('download'),anchor.click()]);
      need(!(await download.failure()),'Original download failed.');
      const target=path.join(downloads,path.basename(item.filename));
      await download.saveAs(target);
      const data=await fs.readFile(target);
      need(data.length===item.bytes&&sha(data)===item.sha256,'Downloaded original file differs: '+item.filename);
      artifacts.push({path:path.relative(output,target),bytes:data.length,sha256:sha(data),kind:'download',label:item.label});
    }
    need((await anchors.count())===expected.size,'Some original extraction downloads were not operated.');
    // Recipient-open the real readable HTML, including the received portable catalogue.
    const reports=(extract._downloads||[]).filter(item=>item.filename==='AREA_REPORT.html');
    for(const item of reports){
      const report=await context.newPage();
      await report.goto(pathToFileURL(path.join(downloads,path.basename(item.filename))).href,{waitUntil:'load'});
      for(const width of [1440,390]){
        await report.setViewportSize({width,height:1000});
        const file=path.join(output,'report-'+width+'.png');await report.screenshot({path:file,fullPage:true});
        const data=await fs.readFile(file);artifacts.push({path:path.basename(file),bytes:data.length,sha256:sha(data),kind:'screenshot',viewport:{width,height:1000}});
      }
      await report.close();
    }
    if(receivedDirectory){
      const catalogue=await context.newPage();
      await catalogue.goto(pathToFileURL(path.join(path.resolve(receivedDirectory),'OPEN_GIS.html')).href,{waitUntil:'load'});
      for(const width of [1440,390]){
        await catalogue.setViewportSize({width,height:1000});
        const file=path.join(output,'portable-gis-'+width+'.png');await catalogue.screenshot({path:file,fullPage:true});
        const data=await fs.readFile(file);artifacts.push({path:path.basename(file),bytes:data.length,sha256:sha(data),kind:'screenshot',viewport:{width,height:1000}});
      }
      await catalogue.close();
    }
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.spatial-regions').waitFor();
    await page.locator('[data-region-input="search"]').fill(analysisId);
    await page.locator('[data-region-action="open"][data-id="'+analysisId+'"]').click();
    await page.locator('[data-region-action="open-extract"][data-id="'+extractionId+'"]').first().click();
    await page.locator('.region-extraction .region-downloads a').first().waitFor();
    await shot('reopened',390);
    need(errors.length===0,'Actual application raised a browser error: '+JSON.stringify(errors));
    const result={...selection,browserCourseComplete:true,task_id:task.id,artifacts,errors,
      visibleInspection:'pending: producing owner must LOOK at every retained screenshot, actual QGIS layers and all outgoing attachments'};
    await save(path.join(output,'result.json'),result);return result;
  }catch(error){
    primaryError=error;
    await save(path.join(output,'failure.json'),{...selection,error:{name:error.name,message:error.message,stack:error.stack},artifacts,errors}).catch(()=>{});
    throw error;
  }finally{
    let cleanupError;
    try{await context?.close();}catch(error){cleanupError=error;}
    try{await browser?.close();}catch(error){cleanupError||=error;}
    if(cleanupError&&!primaryError)throw cleanupError;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  console.log(JSON.stringify(await receiveAreaBrowser(config),null,2));
}
