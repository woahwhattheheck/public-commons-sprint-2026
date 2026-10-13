// SPDX-License-Identifier: MIT
// Actual original staff portal controls, saved-request replay and rendered handover.
import {readFile,open,mkdir,lstat,realpath,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readConnection} from './connection.mjs';
import {acquireLease} from './managed.mjs';

const SCHEMA='stellar-forge.staff-portal-browser-receiving.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'STAFF_PORTAL_BROWSER_RECEIVING'});};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>new Date().toISOString();
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function syncDirectory(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function bytes(path,raw,{immutable=true}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(immutable&&await exists(path)){need((await readFile(path)).equals(raw),'The saved browser artifact differs.');return{path,bytes:raw.length,sha256:hash(raw)};}
  const temporary=path+'.writing-'+randomUUID(),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
  try{if(immutable){try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(path)).equals(raw),'The original browser artifact changed.');}}
    else await rename(temporary,path);await syncDirectory(dirname(path));}
  finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return{path,bytes:raw.length,sha256:hash(raw)};
}
const save=(path,value,options)=>bytes(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),options);
async function verify(row){const actual=await readFile(row.path);need(actual.length===row.bytes&&hash(actual)===row.sha256,'A completed browser artifact changed.');}
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const st=await lstat(path);need(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(path)===path&&!(st.mode&0o077)&&(!process.getuid||st.uid===process.getuid()),'Use the original private browser directory.');}

export function createStaffPortalReceivingBrowser(options){return new BrowserCourse(options);}
class BrowserCourse{
  constructor(options){
    this.o=options;this.root=resolve(options.directory);this.path=join(this.root,'browser-operation.json');
    this.context=null;this.contextAcquisition=null;this.lease=null;this.leaseAcquisition=null;this.page=null;
    this.pageAcquisitions=new Set();this.contextWasOpened=false;this.recoveringEdit=false;this.routes=new Set();this.routeHandler=null;this.closing=null;this.writeTail=Promise.resolve();
  }
  save(){const snapshot=JSON.parse(JSON.stringify(this.state));const p=this.writeTail.then(()=>save(this.path,snapshot,{immutable:false}));this.writeTail=p.catch(()=>{});return p;}
  async phase(name,run){if(this.state.phases[name]?.complete)return this.state.phases[name].value;
    this.state.activePhase=name;await this.save();try{await this.o.onProgress?.({phase:name});}catch{}
    const value=await run();this.state.phases[name]={complete:true,at:now(),value};await this.save();return value;}
  async retain(row){await verify(row);this.state.files[row.path]=row;await this.save();return row;}
  async publishCandidate(name,producer){
    const candidatePath=join(this.root,'candidates',name+'.json');
    let candidate;
    if(await exists(candidatePath))candidate=await json(candidatePath);
    else{
      const produced=await producer(),raw=produced.bytes;
      candidate={schema:'stellar-forge.staff-portal-browser-artifact.v1',name,bytes:raw.length,sha256:hash(raw),
        base64:raw.toString('base64'),metadata:produced.metadata??{}};
      await save(candidatePath,candidate);
    }
    need(candidate.schema==='stellar-forge.staff-portal-browser-artifact.v1'&&candidate.name===name,'Keep the same browser artifact candidate.');
    const raw=Buffer.from(candidate.base64,'base64');
    need(raw.toString('base64')===candidate.base64&&raw.length===candidate.bytes&&hash(raw)===candidate.sha256,'The retained complete browser bytes changed.');
    const target=join(this.root,'artifacts',name),published=await bytes(target,raw);
    await this.retain(published);return{...published,metadata:candidate.metadata};
  }
  async screenshot(name,page=this.page,{fullPage=true}={}){
    return this.publishCandidate(name,async()=>{
      const before=await page.evaluate(()=>({scrollY,scrollX,activeElement:document.activeElement?.id??null,
        viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}}));
      await page.evaluate(()=>{document.activeElement?.blur?.();scrollTo(0,0);});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const after=await page.evaluate(()=>({scrollY,scrollX,viewport:{width:innerWidth,height:innerHeight},
        document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
        overflow:[...document.querySelectorAll('body *')].filter(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2&&s.position!=='fixed'&&!n.closest('table,pre,[class*="scroll"]');}).slice(0,30).map(n=>({tag:n.tagName,id:n.id,className:String(n.className)}))}));
      return{bytes:await page.screenshot({fullPage}),metadata:{before,after,fullPage}};
    });
  }
  async api(route,body,workspaceId=this.o.workspaceId){
    return this.page.evaluate(async({route,body,workspaceId})=>{
      const sessionResponse=await fetch('/api/session');const session=await sessionResponse.json();
      if(!session.authenticated)throw Error('The original browser session is not authenticated.');
      const response=await fetch(route,{method:body===undefined?'GET':'POST',
        headers:{'X-DAM-Workspace-ID':workspaceId,...(body===undefined?{}:{'Content-Type':'application/json','X-DAM-CSRF':session.csrfToken})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const raw=await response.text();let value;try{value=JSON.parse(raw);}catch{throw Error('Original response is not complete JSON.');}
      if(!response.ok)throw Error(value.error?.message??'Original request failed.');
      return value;
    },{route,body,workspaceId});
  }
  async enter(){
    const c=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
      applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
    need(c.value.actor===this.o.actor,'Retain the original browser actor.');
    need(c.value.origin===this.state.origin,'The original browser origin changed; preserve its pending storage before selecting a new origin.');
    await this.page.goto(c.value.origin+'/portal',{waitUntil:'domcontentloaded'});
    const session=await this.page.evaluate(()=>fetch('/api/session').then(r=>r.json()));
    if(session.authenticated&&session.actor!==this.o.actor){
      await this.page.evaluate(async s=>{await fetch('/api/lock',{method:'POST',headers:{'Content-Type':'application/json','X-DAM-CSRF':s.csrfToken},body:'{}'});},session);
      await this.page.reload({waitUntil:'domcontentloaded'});
    }
    await this.page.waitForFunction(()=>document.querySelector('#login-form')||document.querySelector('#workspace-choice'));
    if(await this.page.locator('#login-form').count()){
      await this.page.locator('#actor').fill(this.o.actor);
      await this.page.locator('#accessKey').fill(c.token);
      await this.page.locator('#login-form button[type=submit],#login-form button.primary').click();
    }
    await this.page.locator('#workspace-choice').waitFor();
    if(await this.page.locator('#workspace-choice').inputValue()!==this.o.workspaceId)
      await this.page.locator('#workspace-choice').selectOption(this.o.workspaceId);
    await this.page.waitForFunction(id=>document.querySelector('#workspace-choice')?.value===id,this.o.workspaceId);
    const selected=await this.api('/api/state');
    need(selected.workspace.id===this.o.workspaceId,'The browser selected another original workspace.');
    return selected;
  }
  async pending(record=null){
    return this.page.evaluate(async record=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dam-migration-operator-v1',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('pending',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('pending',record?'readwrite':'readonly'),store=tx.objectStore('pending');
        let value;
        if(record){const r=store.get(record.key);r.onsuccess=()=>{if(r.result&&JSON.stringify(r.result)!==JSON.stringify(record)){tx.abort();return;}store.put(record);value=record;};}
        else{const r=store.getAll();r.onsuccess=()=>{value=r.result;};}
        tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error??Error('Another original pending operation is retained.'));tx.onerror=()=>{};
      });}finally{db.close();}
    },record);
  }
  async installEditRoute(){
    this.routeHandler=route=>{
      const task=(async()=>{
        const request=route.request();
        if(request.method()!=='POST')return route.continue();
        let body;try{body=request.postDataJSON();}catch{return route.continue();}
        if(body?.action!=='project.configure')return route.continue();
        need(body.payload?.notes===this.o.notes,'The original browser attempted another selected edit.');
        need(request.headers()['x-dam-workspace-id']===this.o.workspaceId,'The original browser mutation changed workspace.');
        if(this.state.edit?.request)need(same(body,this.state.edit.request),'The saved original browser request changed.');
        else{
          const pending=(await this.pending()).find(row=>row.requestId===body.requestId);
          need(pending&&same(pending.body,body)&&pending.workspaceId===this.o.workspaceId&&pending.actor===this.o.actor,'The actual original browser did not retain its complete request.');
          this.state.edit={request:body,record:pending,attempts:[]};await this.save();
          await this.retain(await save(join(this.root,'edit-request.json'),{workspaceId:this.o.workspaceId,actor:this.o.actor,request:body,record:pending}));
        }
        const attempt=this.state.edit.attempts.length;
        this.state.edit.attempts.push({number:attempt,startedAt:now(),state:'dispatched'});await this.save();
        const response=await route.fetch({timeout:120000}),raw=await response.body(),value=JSON.parse(raw.toString('utf8'));
        const descriptor=await this.publishCandidate('edit-attempt-'+attempt+'.json',async()=>({bytes:raw,metadata:{status:response.status(),requestId:body.requestId}}));
        this.state.edit.attempts[attempt]={...this.state.edit.attempts[attempt],state:'response-retained',response:descriptor,status:response.status()};await this.save();
        need(response.ok()&&value.ok===true,'The original browser edit did not succeed.');
        if(this.state.edit.result)need(same(this.state.edit.result,value),'Original request replay returned another saved result.');
        else{this.state.edit.result=value;await this.save();}
        if(!this.state.edit.acknowledgementLost&&!this.recoveringEdit){
          this.state.edit.acknowledgementLost=true;await this.save();await route.abort('failed');
        }else await route.fulfill({response,body:raw});
      })();
      this.routes.add(task);task.finally(()=>this.routes.delete(task)).catch(()=>{});return task;
    };
    await this.page.route('**/api/mutate',this.routeHandler);
  }
  async localEdit(){
    await this.page.goto(this.state.origin+'/migration',{waitUntil:'domcontentloaded'});
    await this.page.getByRole('button',{name:'Configure project',exact:true}).waitFor();
    await this.installEditRoute();
    if(!this.state.edit?.request){
      const current=await this.api('/api/state');
      need(current.project.notes===this.o.beforeNotes,'The exact pre-edit notes changed.');
      await this.page.getByRole('button',{name:'Configure project',exact:true}).click();
      const dialog=this.page.getByRole('dialog',{name:'Configure project',exact:true});
      await dialog.getByLabel('Project notes',{exact:true}).fill(this.o.notes);
      await this.screenshot('project-notes-draft.png');
      await dialog.getByRole('button',{name:'Save project configuration',exact:true}).click();
      await this.page.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(x=>x.textContent.trim()));
      if(await dialog.count())await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    need(this.state.edit?.record,'The original browser edit has no durable request.');
    const original=this.state.edit;
    const observed=await this.api('/api/portal/operation',{kind:'mutate',request:original.request});
    if(observed.status==='COMPLETED'){
      if(original.result)need(same(original.result,observed.response),'Native operation lookup differs from the original saved response.');
      else{original.result=observed.response;await this.save();}
    }else need(observed.status==='NOT_RECORDED','Unexpected original request status.');
    // Restore only the exact original caller record when a prior context ended.
    this.recoveringEdit=true;
    await this.pending(original.record);
    await this.page.reload({waitUntil:'domcontentloaded'});
    await this.page.getByRole('button',{name:'Recover original request',exact:true}).waitFor();
    await this.screenshot('original-request-recovery.png');
    await this.page.getByRole('button',{name:'Recover original request',exact:true}).click();
    await this.page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent==='Recover original request'));
    const state=await this.api('/api/state'),receipt=await this.api('/api/portal/operation',{kind:'mutate',request:original.request});
    need(receipt.status==='COMPLETED'&&same(receipt.response,this.state.edit.result),'The recovered original operation did not retain its exact full result.');
    need(state.project.notes===this.o.notes&&state.workspace.id===this.o.workspaceId,'Original saved edit did not reopen.');
    const pending=await this.pending();need(!pending.some(row=>row.requestId===original.request.requestId),'The completed original request remains pending.');
    await this.page.unroute('**/api/mutate',this.routeHandler);this.routeHandler=null;
    await this.retain(await save(join(this.root,'edit-complete.json'),{request:original.request,result:receipt.response,state}));
    return{request:original.request,result:receipt.response,revision:state.workspace.revision,notes:state.project.notes};
  }
  async downloaded(name,click){
    return this.publishCandidate(name,async()=>{
      const waiting=this.page.waitForEvent('download',{timeout:120000});await click();const download=await waiting;
      const failure=await download.failure();need(!failure,'The complete original browser download failed.');
      const stream=await download.createReadStream();need(stream,'The complete browser download is absent.');
      const chunks=[];let count=0;for await(const chunk of stream){count+=chunk.length;need(count<=1124073472,'The original download exceeds its selected bound.');chunks.push(chunk);}
      return{bytes:Buffer.concat(chunks),metadata:{filename:download.suggestedFilename(),url:download.url()}};
    });
  }
  async reportPreview(file,name){
    const acquisition=this.context.newPage();this.pageAcquisitions.add(acquisition);let page;
    try{page=await acquisition;}finally{this.pageAcquisitions.delete(acquisition);}
    try{await page.goto(pathToFileURL(file.path).href,{waitUntil:'load'});await page.locator('body').waitFor();
      const text=await page.locator('body').innerText();need(text.trim().length>100,'The actual full report is empty.');
      await this.screenshot(name+'-desktop.png',page);await page.setViewportSize({width:390,height:844});await this.screenshot(name+'-mobile.png',page);
      return{file,textBytes:Buffer.byteLength(text),title:await page.title()};
    }finally{await page.close();}
  }
  async views(){
    const result={};await this.enter();
    for(const tab of ['intake','mappings','pages','review','returns','demos','costs','delivery']){
      await this.page.locator('[data-tab="'+tab+'"]').click();await this.page.locator('#main h2').waitFor();
      result['portal-'+tab]={heading:await this.page.locator('#main h2').first().innerText(),
        screenshot:await this.screenshot('portal-'+tab+'-desktop.png')};
    }
    await this.page.setViewportSize({width:390,height:844});result.portalMobile=await this.screenshot('portal-delivery-mobile.png');await this.page.setViewportSize({width:1440,height:1000});
    for(const view of ['migration','insights','editorial']){
      await this.page.goto(this.state.origin+'/'+view,{waitUntil:'domcontentloaded'});
      const ready=view==='migration'?'#page':view==='insights'?'#sidebar':'#workspace-bar';
      await this.page.locator(ready).waitFor();
      if(view==='migration'){
        await this.page.getByRole('button',{name:'Original sources',exact:true}).click();
        await this.page.getByRole('button',{name:'Assets and files',exact:true}).click();
      }else if(view==='insights'){
        const choices=this.page.locator('.run-choice');
        need(await choices.count()>0,'The original saved analytics runs are absent.');await choices.first().click();
        await this.page.locator('#page').waitFor();
      }else{
        const originalFilter=this.page.locator('#filter');await originalFilter.fill('__no_matching_record__');await this.screenshot('editorial-empty-filter.png');await originalFilter.fill('');
        const choices=this.page.locator('#queue button');if(await choices.count())await choices.first().click();
      }
      result[view]={desktop:await this.screenshot(view+'-desktop.png')};
      await this.page.setViewportSize({width:390,height:844});result[view].mobile=await this.screenshot(view+'-mobile.png');
      await this.page.setViewportSize({width:1440,height:1000});
    }
    await this.enter();await this.page.locator('[data-tab="delivery"]').click();
    result.downloads={};
    for(const [kind,format]of [['handover','html'],['handover','json'],['pages','csv'],['differences','csv'],['pricing','html'],['demonstrations','html']]){
      const href='/api/portal/report?kind='+kind+'&format='+format;
      result.downloads[kind+'-'+format]=await this.downloaded(kind+'.'+format,()=>this.page.locator('a[href="'+href+'"]').click());
    }
    result.downloads.operating=await this.downloaded('complete-operating.zip',()=>this.page.locator('a[href="/api/portal/download?kind=delivery"]').click());
    result.downloads.workspace=await this.downloaded('complete-workspace.zip',()=>this.page.locator('a[href="/api/download?kind=workspace"]').click());
    result.reports={};for(const kind of ['handover','pricing','demonstrations'])
      result.reports[kind]=await this.reportPreview(result.downloads[kind+'-html'],kind);
    return result;
  }
  async run(){
    await privateDirectory(this.root);
    try{
      this.leaseAcquisition=acquireLease(join(this.root,'browser-operation'));
      this.lease=await this.leaseAcquisition;this.leaseAcquisition=null;
      const selected=JSON.parse(JSON.stringify({workspaceId:this.o.workspaceId,actor:this.o.actor,
        workspaceDirectory:this.o.workspaceDirectory,applicationDirectory:this.o.applicationDirectory,
        sourceManifestSha256:this.o.sourceManifestSha256,beforeNotes:this.o.beforeNotes,notes:this.o.notes,
        browser:this.o.chromium,playwright:this.o.playwright,source:this.o.source}));
      this.state=await exists(this.path)?await json(this.path):null;
      if(this.state)need(this.state.schema===SCHEMA&&same(this.state.selection,selected),'The original browser selection changed.');
      const candidatePath=join(this.root,'browser-candidate.json'),resultPath=join(this.root,'browser-result.json');
      if(await exists(candidatePath)||await exists(resultPath)){
        const candidate=await json(await exists(candidatePath)?candidatePath:resultPath);
        need(this.state&&same(candidate.selection,selected)&&candidate.schema==='stellar-forge.staff-portal-browser-result.v1'&&
          candidate.state==='COMPLETE'&&typeof candidate.ownersClosedAt==='string','The closed browser result selected another course.');
        for(const row of candidate.files)await verify(row);
        await save(resultPath,candidate);this.state.status='complete';
        this.state.result={path:resultPath,bytes:(await readFile(resultPath)).length,sha256:hash(await readFile(resultPath))};await this.save();
        return{...candidate,resultFile:this.state.result};
      }
      const current=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
        applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
      this.state??={schema:SCHEMA,selection:selected,origin:current.value.origin,
        startedAt:now(),phases:{},files:{},errors:[],status:'running'};
      need(this.state.origin===current.value.origin,'Keep the original browser origin and pending IndexedDB.');
      await this.save();
      const module=await import(pathToFileURL(this.o.playwright).href),chromium=module.chromium??module.default?.chromium;
      need(chromium,'Select the actual installed Playwright module.');
      this.contextAcquisition=chromium.launchPersistentContext(join(this.root,'profile'),{
        executablePath:this.o.chromium,headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
      this.context=await this.contextAcquisition;this.contextAcquisition=null;this.contextWasOpened=true;
      this.state.ownersClosedAt=null;await this.save();
      this.page=this.context.pages()[0]??await this.context.newPage();
      this.page.setDefaultTimeout(60000);
      this.page.on('pageerror',error=>{this.state.errors.push({type:'pageerror',message:error.message,at:now()});void this.save().catch(()=>{});});
      await this.enter();
      const edit=await this.phase('original-local-edit-and-replay',()=>this.localEdit());
      const views=await this.phase('complete-original-views-downloads-and-reopen',()=>this.views());
      const actual=await this.api('/api/state');need(actual.project.notes===this.o.notes,'The final original browser edit changed.');
      await this.retain(await save(join(this.root,'final-browser-state.json'),actual));
      await this.closeContext();
      const candidate={schema:'stellar-forge.staff-portal-browser-result.v1',state:'COMPLETE',selection:selected,
        origin:this.state.origin,edit,views,completedAt:now(),ownersClosedAt:this.state.ownersClosedAt,
        files:Object.values(this.state.files),pageErrors:this.state.errors};
      need(!candidate.pageErrors.some(e=>e.type==='pageerror'),'Repair the actual original page error before completing the browser course.');
      for(const row of candidate.files)await verify(row);
      await save(candidatePath,candidate);await save(resultPath,candidate);
      this.state.status='complete';this.state.result={path:resultPath,bytes:(await readFile(resultPath)).length,sha256:hash(await readFile(resultPath))};await this.save();
      return{...candidate,resultFile:this.state.result};
    }catch(error){if(this.state){this.state.errors.push({type:'course',message:error.message,at:now()});await this.save();}throw error;}
    finally{await this.close();}
  }
  async closeContext(){
    if(this.contextAcquisition){try{this.context=await this.contextAcquisition;this.contextWasOpened=true;}finally{this.contextAcquisition=null;}}
    await Promise.allSettled([...this.pageAcquisitions]);
    for(;;){
      await Promise.allSettled([...this.routes]);if(!this.routes.size)break;
    }
    if(this.page&&this.routeHandler){await this.page.unroute('**/api/mutate',this.routeHandler);this.routeHandler=null;}
    if(this.context){await this.context.close();this.context=null;this.page=null;}
    if(this.state&&this.contextWasOpened){this.state.ownersClosedAt=now();this.contextWasOpened=false;await this.save();}
  }
  close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      for(;;){try{await this.closeContext();break;}catch(error){
        if(this.state){this.state.errors.push({type:'closure',message:error.message,at:now()});await this.save().catch(()=>{});}
        process.stderr.write(JSON.stringify({state:'STAFF_PORTAL_BROWSER_CLOSING',message:error.message})+'\n');await delay(1000);
      }}
      await this.writeTail;
      if(this.leaseAcquisition){try{this.lease=await this.leaseAcquisition;}finally{this.leaseAcquisition=null;}}
      if(this.lease){await this.lease.close();this.lease=null;}
    })().finally(()=>{this.closing=null;});return this.closing;
  }
}
