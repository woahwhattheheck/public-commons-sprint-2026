/** Borrow one existing authorized page; never launches a browser, solver or competing operator. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function keep(file,raw){await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,raw,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||!Buffer.from(await fs.readFile(file)).equals(Buffer.from(raw)))throw e;}}
async function json(file,value){return keep(file,Buffer.from(JSON.stringify(value,null,2)+'\n'));}
async function read(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function exists(file){try{await fs.stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function downloaded(page,click,file){const waiter=page.waitForEvent('download');await click();const item=await waiter;if(await item.failure())throw Error('Original browser download failed');const stream=await item.createReadStream(),chunks=[];for await(const b of stream)chunks.push(b);const raw=Buffer.concat(chunks);await keep(file,raw);return {path:path.basename(file),bytes:raw.length,sha256:digest(raw)};}
export async function runRegionalBiophysicalCourse(page,{url,definition,out,operation_id,allow_navigation=false}){
  if(!page||!operation_id||!definition)throw Error('Supply the existing authorized page and authored original definition.');
  const root=path.resolve(out);await fs.mkdir(root,{recursive:true});
  const lock=path.join(root,'.browser-course.lock'),fd=await fs.open(lock,'wx');
  const previousViewport=page.viewportSize();let reportPage=null,routeHandler=null,routeFailure=null;
  const input={schema:'upstate.regional-biophysical-browser-input/v1',operation_id,url,definition};
  try{
    await fd.writeFile(JSON.stringify({pid:process.pid,operation_id}));await fd.sync();
    await json(path.join(root,'input.json'),input);
    if(await exists(path.join(root,'result.json')))return read(path.join(root,'result.json'));
    if(page.url()!==url){if(!allow_navigation)throw Error('The existing page is not the authorized operator URL.');await page.goto(url);}
    await page.locator('[data-view="regional-biophysical"]').click();
    const desk=page.locator('[data-rb-workspace]');await desk.waitFor();
    const workspace=await desk.getAttribute('data-rb-workspace'),project=await desk.getAttribute('data-rb-project');
    if(!workspace||!project)throw Error('The actual operator workspace is not ready.');
    const pendingFile=path.join(root,'pending-working.json'),unfinishedFile=path.join(root,'unfinished-working.json');
    let working;
    if(await exists(pendingFile))working=await read(pendingFile);
    else working={schema:'upstate.regional-biophysical-working/v1',workspace_key:workspace,project_id:project,instance:crypto.randomUUID(),definition,requests:[],selected_id:'',experiment:{baseline_run_id:'',scenario_ids:[]}};
    const requestFile=path.join(root,'original-prepare-request.json'),exportRequestFile=path.join(root,'original-export-request.json');
    for(const [file,action] of [[requestFile,'regional-biophysical.prepare'],[exportRequestFile,'regional-biophysical.export']]){
      if(!await exists(file))continue;
      const r=await read(file);
      if(r.workspace!==workspace||r.action!==action||(action==='regional-biophysical.prepare'&&canonical(r.payload.definition)!==canonical(definition)))throw Error('Retained dispatched request belongs to another input.');
      const found=list(working.requests).find(x=>x.operation_id===r.operation_id);
      if(found&&(found.action!==action||canonical(found.payload)!==canonical(r.payload)))throw Error('Retained original request bytes disagree.');
      if(!found)working.requests.push({operation_id:r.operation_id,action:r.action,payload:r.payload,signature:canonical({action:r.action,payload:r.payload}),created_at:'retained original dispatch'});
    }
    if(working.project_id!==project||working.workspace_key!==workspace)throw Error('Existing operation belongs to another original project.');
    const selectedImport=path.join(root,'resume-working-'+digest(canonical(working))+'.json');
    await json(selectedImport,working);
    await desk.locator('[data-rb-working]').setInputFiles(selectedImport);
    await page.waitForFunction(expected=>document.querySelector('[data-rb-field="title"]')?.value===expected,working.definition.title);
    await desk.locator('[data-rb-action="preview"]').click();
    await desk.locator('[data-rb-action="prepare"]').waitFor();
    const preview=JSON.parse(await desk.locator('[data-rb-preview] pre').textContent());
    if(canonical(preview.definition)!==canonical(working.definition))throw Error('Visible preview differs from the actual authored working selection.');
    await json(path.join(root,'preview.json'),preview);
    const prepareRequest=list(working.requests).find(x=>x.action==='regional-biophysical.prepare');
    let captured=null;
    if(!prepareRequest){
      routeHandler=async route=>{
        let body;try{body=route.request().postDataJSON();}catch{}
        if(body?.action!=='regional-biophysical.prepare'||body.workspace!==workspace){await route.continue();return;}
        try{
          await json(requestFile,body);
          const response=await route.fetch();const raw=await response.body();
          if(!response.ok()){await route.fulfill({response,body:raw});return;}
          captured={request:body,response:JSON.parse(raw.toString('utf8'))};
          await json(path.join(root,'actual-accepted-task.json'),captured);
          await route.abort('failed');
        }catch(error){routeFailure=error;await route.abort('failed').catch(()=>{});}
      };
      await page.route('**/api/actions',routeHandler);
      await desk.locator('[data-rb-action="prepare"]').click();
      await page.waitForFunction(()=>{const n=document.querySelector('[data-rb-message]');return n?.dataset.error==='true';});
      await page.unroute('**/api/actions',routeHandler);routeHandler=null;
      if(routeFailure)throw routeFailure;
      if(!captured?.response?.id)throw Error('No actual original task was accepted; preserve this input and inspect provider outcome.');
      await downloaded(page,()=>desk.locator('[data-rb-action="working"]').click(),pendingFile);
      const pending=await read(pendingFile),request=list(pending.requests).find(x=>x.operation_id===captured.request.operation_id);
      if(!request||canonical(request.payload)!==canonical(captured.request.payload))throw Error('The working file did not retain the exact original request.');
      // A real reload exercises recovery before retry, without recreating the original intent.
      await page.reload();await page.locator('[data-view="regional-biophysical"]').click();await desk.waitFor();
      await desk.locator('[data-rb-working]').setInputFiles(pendingFile);
      await desk.locator('[data-rb-action="retry"][data-id="'+request.operation_id+'"]').waitFor();
      await desk.locator('[data-rb-action="retry"][data-id="'+request.operation_id+'"]').click();
    }else{
      await desk.locator('[data-rb-action="retry"][data-id="'+prepareRequest.operation_id+'"]').click();
    }
    const openSaved=desk.locator('[data-rb-action="saved"]').last();
    await openSaved.waitFor({timeout:600000});await openSaved.click();
    await desk.locator('[data-rb-detail] pre').waitFor();
    const record=JSON.parse(await desk.locator('[data-rb-detail] pre').textContent());
    if(record.workspace_id!==project||canonical(record.original_definition)!==canonical(definition))throw Error('The original task retained a different scientific selection.');
    await json(path.join(root,'saved-selection.json'),record);
    routeHandler=async route=>{
      let body;try{body=route.request().postDataJSON();}catch{}
      if(body?.action!=='regional-biophysical.export'||body.workspace!==workspace){await route.continue();return;}
      try{
        if(body.payload?.id!==record.id)throw Error('The export request changed the selected source record.');
        await json(exportRequestFile,body);
        await route.continue();
      }catch(error){routeFailure=error;await route.abort('failed').catch(()=>{});}
    };
    await page.route('**/api/actions',routeHandler);
    await desk.locator('[data-rb-action="export"]').click();
    // The exact immutable export task may finish asynchronously; open its same saved selection again.
    await page.waitForFunction(()=>[...document.querySelectorAll('.rb-request')].some(n=>n.textContent.includes('regional-biophysical.export')&&n.textContent.includes('complete'))||document.querySelector('[data-rb-message]')?.dataset.error==='true',{},{timeout:600000});
    if(routeFailure)throw routeFailure;
    if(await desk.locator('[data-rb-message]').getAttribute('data-error')==='true')throw Error(await desk.locator('[data-rb-message]').textContent());
    await page.unroute('**/api/actions',routeHandler);routeHandler=null;
    await desk.locator('[data-rb-action="saved"]').last().click();
    await desk.locator('[data-rb-detail] a').first().waitFor();
    const downloads={};
    for(const [label,match,name] of [['selection','Complete source-bound selection','selection.json'],['report','Readable regional profile','report.html'],['package','Original sources and editable native profiles','Regional_Profile.zip']]){
      const file=path.join(root,'attachments',name);
      const item=await downloaded(page,()=>desk.getByRole('link',{name:match,exact:true}).click(),file);
      downloads[label]={...item,path:'attachments/'+name};
    }
    const selected=await read(path.join(root,'attachments','selection.json'));
    if(selected.id!==record.id)throw Error('The actual downloaded selection differs from the displayed original.');
    await page.setViewportSize({width:1365,height:900});await page.screenshot({path:path.join(root,'regional-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'regional-phone.png'),fullPage:true});
    const unfinishedTitle=definition.title+' — unfinished review';
    await desk.locator('[data-rb-field="title"]').fill(unfinishedTitle);
    if(!await exists(unfinishedFile))await downloaded(page,()=>desk.locator('[data-rb-action="working"]').click(),unfinishedFile);
    const unfinished=await read(unfinishedFile);
    if(unfinished.definition.title!==unfinishedTitle||unfinished.selected_id!==record.id)throw Error('The actual unfinished working file lost its saved selection or draft.');
    await page.reload();await page.locator('[data-view="regional-biophysical"]').click();await desk.waitFor();
    await desk.locator('[data-rb-working]').setInputFiles(unfinishedFile);
    await page.waitForFunction(expected=>document.querySelector('[data-rb-field="title"]')?.value===expected,unfinishedTitle);
    reportPage=await page.context().newPage();
    const reportLink=desk.getByRole('link',{name:'Readable regional profile',exact:true});
    if(await reportLink.count())await reportPage.goto(await reportLink.getAttribute('href'));
    else await reportPage.goto(pathToFileURL(path.join(root,'attachments','report.html')).href);
    await reportPage.getByRole('heading',{name:record.title,exact:true}).waitFor();
    if(await reportPage.locator('tbody tr').count()<record.retained_preview.selected_entries.length)throw Error('The readable report omits selected scientific rows.');
    await reportPage.setViewportSize({width:1365,height:900});
    await reportPage.screenshot({path:path.join(root,'regional-report.png'),fullPage:true});
    await reportPage.close();reportPage=null;
    const result={schema:'upstate.regional-biophysical-browser/v1',operation_id,project_id:project,workspace_key:workspace,
      selection_id:record.id,profile_id:record.profile_id,downloads,unfinished_working:'unfinished-working.json',
      snapshots:['regional-desktop.png','regional-phone.png','regional-report.png'],original_request_replayed:true};
    await json(path.join(root,'result.json'),result);return result;
  }finally{
    if(routeHandler)await page.unroute('**/api/actions',routeHandler);
    if(reportPage&&!reportPage.isClosed())await reportPage.close();
    if(previousViewport&&!page.isClosed())await page.setViewportSize(previousViewport);
    await fd.close();await fs.unlink(lock);
  }
}
const list=x=>Array.isArray(x)?x:[];
