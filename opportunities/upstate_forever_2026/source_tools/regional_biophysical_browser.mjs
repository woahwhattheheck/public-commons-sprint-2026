/** Borrow one existing authorized page; never launches a browser, solver or competing operator. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function keep(file,raw){await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,raw,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||!Buffer.from(await fs.readFile(file)).equals(Buffer.from(raw)))throw e;}}
async function json(file,value){return keep(file,Buffer.from(JSON.stringify(value,null,2)+'\n'));}
async function read(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function exists(file){try{await fs.stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function downloaded(page,click,file){const waiter=page.waitForEvent('download');await click();const item=await waiter;if(await item.failure())throw Error('Original browser download failed');const stream=await item.createReadStream(),chunks=[];for await(const b of stream)chunks.push(b);const raw=Buffer.concat(chunks);await keep(file,raw);return {path:path.basename(file),bytes:raw.length,sha256:digest(raw)};}
async function ownLock(python,file,operation_id){
  if(typeof python!=='string'||!python)throw Error('Supply the current receiving owner\'s original Python executable for the POSIX operation lock.');
  const script="import fcntl,json,os,sys\np=sys.argv[1]\nf=os.open(p,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nos.ftruncate(f,0)\nos.write(f,(json.dumps({'pid':os.getpid(),'operation_id':sys.argv[2]})+'\\n').encode())\nos.fsync(f)\nprint('LOCKED',flush=True)\nsys.stdin.buffer.read()\nos.close(f)\n";
  const child=spawn(python,['-u','-c',script,file,operation_id],{stdio:['pipe','pipe','pipe']});
  let output='',error='',settled=false;
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  child.stdin.on('error',failure=>{error+=' '+failure.message;});
  child.stderr.setEncoding('utf8');child.stderr.on('data',x=>error+=x);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(!settled){settled=true;child.stdin.end();child.kill('SIGTERM');reject(Error('Original operation lock did not admit within ten seconds.'));}},10000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',x=>{output+=x;if(!settled&&output.includes('LOCKED\n')){settled=true;clearTimeout(timer);resolve();}});
    completion.then(result=>{if(!settled){settled=true;clearTimeout(timer);reject(Error('The original operation lock is owned or unavailable: '+error+' '+JSON.stringify(result)));}},failure=>{if(!settled){settled=true;clearTimeout(timer);reject(failure);}});
  });
  let released=false;
  return async()=>{if(released)return;released=true;child.stdin.end();const result=await completion;if(result.code!==0)throw Error('Original operation lock closure failed: '+error+' '+JSON.stringify(result));};
}
export async function runRegionalBiophysicalCourse(page,{url,definition,out,operation_id,python,allow_navigation=false}){
  if(!page||!operation_id||!definition)throw Error('Supply the existing authorized page and authored original definition.');
  const root=path.resolve(out);await fs.mkdir(root,{recursive:true});
  const release=await ownLock(python,path.join(root,'.browser-course.lock'),operation_id);
  const previousViewport=page.viewportSize();let reportPage=null,routeHandler=null,routeFailure=null;
  const input={schema:'upstate.regional-biophysical-browser-input/v1',operation_id,url,definition};
  try{
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
    let captured=null,prepareOperation=prepareRequest?.operation_id||null;
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
      prepareOperation=captured.request.operation_id;
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
    const requestCard=desk.locator('.rb-request').filter({has:page.locator('button[data-rb-action="retry"][data-id="'+prepareOperation+'"]')});
    const openSaved=requestCard.locator('[data-rb-action="saved"]');
    await openSaved.waitFor({timeout:600000});const selectedId=await openSaved.getAttribute('data-id');await openSaved.click();
    await page.waitForFunction(expected=>{try{return JSON.parse(document.querySelector('[data-rb-detail] pre')?.textContent||'null')?.id===expected;}catch{return false;}},selectedId);
    await desk.locator('[data-rb-detail] pre').waitFor();
    const record=JSON.parse(await desk.locator('[data-rb-detail] pre').textContent());
    if(record.workspace_id!==project||canonical(record.original_definition)!==canonical(definition))throw Error('The original task retained a different scientific selection.');
    const scientificRecord={...record};delete scientificRecord.workspace_key;delete scientificRecord._downloads;
    await json(path.join(root,'saved-selection.json'),scientificRecord);
    let exportOperation=(await exists(exportRequestFile))?(await read(exportRequestFile)).operation_id:null;
    routeHandler=async route=>{
      let body;try{body=route.request().postDataJSON();}catch{}
      if(body?.action!=='regional-biophysical.export'||body.workspace!==workspace){await route.continue();return;}
      try{
        if(body.payload?.id!==record.id)throw Error('The export request changed the selected source record.');
        await json(exportRequestFile,body);exportOperation=body.operation_id;
        await route.continue();
      }catch(error){routeFailure=error;await route.abort('failed').catch(()=>{});}
    };
    await page.route('**/api/actions',routeHandler);
    await desk.locator('[data-rb-action="export"]').click();
    // The exact immutable export task may finish asynchronously; open its same saved selection again.
    await page.waitForFunction(()=>document.querySelector('[data-rb-message]')?.textContent?.length>0,{},{timeout:600000});
    if(!exportOperation)throw Error('No original export request identity was retained.');
    await page.waitForFunction(expected=>[...document.querySelectorAll('.rb-request')].some(n=>n.querySelector('button[data-rb-action="retry"]')?.dataset.id===expected&&n.textContent.includes('regional-biophysical.export')&&n.textContent.includes('complete'))||document.querySelector('[data-rb-message]')?.dataset.error==='true',exportOperation,{timeout:600000});
    if(routeFailure)throw routeFailure;
    if(await desk.locator('[data-rb-message]').getAttribute('data-error')==='true')throw Error(await desk.locator('[data-rb-message]').textContent());
    await page.unroute('**/api/actions',routeHandler);routeHandler=null;
    await openSaved.click();
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
    if(await reportLink.count()){const inline=new URL(await reportLink.getAttribute('href'),page.url());inline.searchParams.delete('download');await reportPage.goto(inline.href);}
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
    const failures=[];
    if(routeHandler)try{await page.unroute('**/api/actions',routeHandler);}catch(e){failures.push(e);}
    if(reportPage&&!reportPage.isClosed())try{await reportPage.close();}catch(e){failures.push(e);}
    if(previousViewport&&!page.isClosed())try{await page.setViewportSize(previousViewport);}catch(e){failures.push(e);}
    try{await release();}catch(e){failures.push(e);}
    if(failures.length)throw new AggregateError(failures,'The original borrowed-browser operation did not fully close.');
  }
}
const list=x=>Array.isArray(x)?x:[];
