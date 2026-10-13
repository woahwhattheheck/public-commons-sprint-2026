// SPDX-License-Identifier: MIT
// Actual original catalogue, implementation and approval controls with complete retained exports.
import {readFile,open,mkdir,lstat,realpath,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readConnection} from './connection.mjs';
import {acquireLease} from './managed.mjs';

const SCHEMA='stellar-forge.catalogue-delivery-browser-receiving.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'CATALOGUE_DELIVERY_BROWSER_RECEIVING'});};
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
async function verify(row){
  const before=await lstat(row.path);need(before.isFile()&&!before.isSymbolicLink()&&await realpath(row.path)===row.path,'Keep an ordinary complete browser artifact.');
  const file=await open(row.path,'r'),digest=createHash('sha256');let count=0;
  try{for await(const chunk of file.createReadStream({autoClose:false})){digest.update(chunk);count+=chunk.length;}
    const after=await file.stat();need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&count===after.size,'The browser artifact changed while reading.');
  }finally{await file.close();}
  need(count===row.bytes&&digest.digest('hex')===row.sha256,'A completed browser artifact changed.');
}
async function privateDirectory(path){await mkdir(path,{recursive:true,mode:0o700});const st=await lstat(path);need(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(path)===path&&!(st.mode&0o077)&&(!process.getuid||st.uid===process.getuid()),'Use the original private browser directory.');}

export function createCatalogueDeliveryReceivingBrowser(options){return new BrowserCourse(options);}
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
      candidate={schema:'stellar-forge.catalogue-delivery-browser-artifact.v1',name,bytes:raw.length,sha256:hash(raw),
        base64:raw.toString('base64'),metadata:produced.metadata??{}};
      await save(candidatePath,candidate);
    }
    need(candidate.schema==='stellar-forge.catalogue-delivery-browser-artifact.v1'&&candidate.name===name,'Keep the same browser artifact candidate.');
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

  async api(route,body,{allowError=false}={}){
    return this.page.evaluate(async({route,body,allowError})=>{
      const token=document.querySelector('meta[name="workspace-token"]')?.content;
      if(!token)throw Error('The actual original workspace token is absent.');
      const response=await fetch(route,{method:body===undefined?'GET':'POST',
        headers:{'X-Workspace-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw Error('Original response is incomplete JSON.');}
      if(!response.ok&&!allowError)throw Error(value.error?.message??'Original request failed.');
      return allowError?{status:response.status,value}:value;
    },{route,body,allowError});
  }
  async enter(path='/'){
    const c=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
      applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
    need(c.value.actor===this.o.actor&&c.value.worker===false,'Preserve the selected actor and offline receiving worker state.');
    if(this.state.origin!==c.value.origin){
      this.state.origins??=[];this.state.origins.push({origin:c.value.origin,instanceId:c.value.instanceId,at:now()});
      this.state.origin=c.value.origin;await this.save();
    }
    await this.page.goto(c.value.origin+path,{waitUntil:'domcontentloaded'});
    await this.page.locator('meta[name="workspace-token"]').waitFor({state:'attached'});
    const status=await this.api('/api/status');
    need(status.workspace===this.o.workspaceDirectory&&status.service.worker_enabled===false,'The page opened another original workspace or live worker.');
    return status;
  }
  async readReview(id){return this.api('/api/approval/records/'+id);}
  async installNoteRoute(){
    const path='/api/approval/records/'+this.o.note.recordId+'/notes';
    this.noteRoute='**'+path;
    this.routeHandler=route=>{
      const task=(async()=>{
        const request=route.request();if(request.method()!=='POST')return route.continue();
        const body=request.postDataJSON();
        need(body.notes===this.o.note.text&&body.revision===this.o.note.before.revision,'The selected original note request changed.');
        if(this.state.edit?.request)need(same(body,this.state.edit.request),'Resume the same saved notes request.');
        else{
          this.state.edit={request:body,before:this.o.note.before,attempts:[]};await this.save();
          await this.retain(await save(join(this.root,'original-note-request.json'),{route:path,request:body,before:this.o.note.before}));
        }
        const attempt=this.state.edit.attempts.length;
        this.state.edit.attempts.push({number:attempt,startedAt:now(),state:'dispatched'});await this.save();
        const response=await route.fetch({timeout:120000}),raw=await response.body(),value=JSON.parse(raw.toString('utf8'));
        const captured=await this.publishCandidate('note-response-'+attempt+'.json',async()=>({bytes:raw,metadata:{status:response.status(),route:path}}));
        Object.assign(this.state.edit.attempts[attempt],{state:'response-retained',response:captured,status:response.status()});await this.save();
        need(response.ok()&&value.id===this.o.note.recordId,'The original notes save failed.');
        if(this.state.edit.result)need(same(value,this.state.edit.result),'Original notes result changed.');
        else this.state.edit.result=value;
        if(!this.state.edit.acknowledgementLost){
          this.state.edit.acknowledgementLost=true;await this.save();return route.abort('failed');
        }
        await this.save();return route.fulfill({response,body:raw});
      })();this.routes.add(task);task.finally(()=>this.routes.delete(task)).catch(()=>{});return task;
    };
    await this.page.route(this.noteRoute,this.routeHandler);
  }
  checkNote(current){
    const before=this.o.note.before,expected=structuredClone(before);
    const history=current.notes_history;
    need(Array.isArray(history)&&history.length===before.notes_history.length+1&&
      same(history.slice(0,-1),before.notes_history)&&history.at(-1).notes===this.o.note.text&&typeof history.at(-1).saved_at==='string',
      'The local review note must append one exact original history row.');
    Object.assign(expected,{notes:this.o.note.text,notes_history:history,revision:before.revision+1,updated_at:current.updated_at});
    need(same(current,expected),'The local note changed another original review field.');
    return current;
  }
  async localEdit(){
    await this.enter('/approval?record='+this.o.note.recordId);
    await this.page.locator('[data-view="review"]').click();await this.page.locator('#notes').waitFor();
    const first=(await this.readReview(this.o.note.recordId)).record;
    if(same(first,this.o.note.before)){
      await this.installNoteRoute();
      await this.page.locator('#notes').fill(this.o.note.text);
      await this.screenshot('review-note-draft.png');
      await this.page.locator('[data-action="notes"]').click();
      // Original UI catches the lost acknowledgement and reloads the saved
      // record. It has revisioned notes, not a fictional idempotency endpoint.
      await this.page.locator('#notice .error').waitFor();
      await this.screenshot('original-note-lost-response.png');
    }else{
      need(this.state.edit?.request,'The selected review changed before this browser saved its original request.');
      this.checkNote(first);
    }
    const observed=this.checkNote((await this.readReview(this.o.note.recordId)).record);
    if(this.state.edit?.result)need(same(observed,this.state.edit.result),'Observed original note differs from the actual saved HTTP result.');
    else{
      need(this.state.edit?.request,'No original note request can be recovered.');
      this.state.edit.observedResult=observed;
    }
    this.state.edit.resolution={kind:this.state.edit.result?'saved-response-and-original-read':'exact-original-revision-and-history',
      revision:observed.revision,at:now()};await this.save();
    if(this.routeHandler){await this.page.unroute(this.noteRoute,this.routeHandler);this.routeHandler=null;}
    await this.page.reload({waitUntil:'domcontentloaded'});await this.page.locator('[data-view="review"]').click();
    await this.page.locator('#notes').waitFor();need(await this.page.locator('#notes').inputValue()===this.o.note.text,'Saved review notes did not reopen.');
    await this.page.locator('[data-view="history"]').click();
    await this.page.getByText(this.o.note.text,{exact:true}).waitFor();
    await this.screenshot('saved-note-history.png');
    const output={request:this.state.edit.request,resolution:this.state.edit.resolution,record:observed,attempts:this.state.edit.attempts};
    await this.retain(await save(join(this.root,'original-note-recovered.json'),output));
    return output;
  }
  async downloaded(name,click){
    const directory=join(this.root,'candidates');await privateDirectory(directory);
    const descriptorPath=join(directory,name+'.download.json'),closedPath=join(directory,name+'.download.closed');
    let candidate;
    if(await exists(descriptorPath))candidate=await json(descriptorPath);
    else{
      const partial=join(directory,name+'.downloading');
      if(await exists(partial)){await rename(partial,partial+'.interrupted-'+randomUUID());await syncDirectory(directory);}
      need(!await exists(closedPath),'A closed download must retain its original candidate descriptor.');
      const waiting=this.page.waitForEvent('download',{timeout:120000});waiting.catch(()=>{});
      await click();const download=await waiting;
      need(!await download.failure(),'The complete original download failed.');
      const stream=await download.createReadStream();need(stream,'The original complete download stream is absent.');
      const file=await open(partial,'wx',0o600),digest=createHash('sha256');let count=0;
      try{
        for await(const chunk of stream){count+=chunk.length;need(count<=2*1024**3+64*1024**2,'The selected original complete archive exceeds its native capacity.');digest.update(chunk);await file.writeFile(chunk);}
        await file.sync();
      }finally{stream.destroy?.();await file.close();}
      candidate={schema:'stellar-forge.catalogue-delivery-browser-download.v1',name,
        path:closedPath,partial,bytes:count,sha256:digest.digest('hex'),
        metadata:{filename:download.suggestedFilename(),url:download.url()}};
      await verify({...candidate,path:partial});
      // The full closed descriptor precedes publication. A lost rename is
      // reconciled from this exact complete part; an unclosed part is retained.
      await save(descriptorPath,candidate);
    }
    need(candidate.schema==='stellar-forge.catalogue-delivery-browser-download.v1'&&candidate.name===name&&
      candidate.path===closedPath&&candidate.partial===join(directory,name+'.downloading'),'Keep the original complete download candidate.');
    if(!await exists(closedPath)){await verify({...candidate,path:candidate.partial});await rename(candidate.partial,closedPath);await syncDirectory(directory);}
    await verify(candidate);
    const target=join(this.root,'artifacts',name);await privateDirectory(dirname(target));
    try{await link(closedPath,target);}catch(error){if(error.code!=='EEXIST')throw error;}
    await syncDirectory(dirname(target));await verify({...candidate,path:target});
    const published={path:target,bytes:candidate.bytes,sha256:candidate.sha256};
    await this.retain(published);await this.retain({path:descriptorPath,bytes:(await readFile(descriptorPath)).length,sha256:hash(await readFile(descriptorPath))});
    return{...published,metadata:candidate.metadata};
  }
  async narrow(name){
    await this.page.setViewportSize({width:390,height:844});
    try{return await this.screenshot(name);}finally{await this.page.setViewportSize({width:1440,height:1000});}
  }
  async reopenJson(file,name,expected){
    const raw=await readFile(file.path),parsed=JSON.parse(raw.toString('utf8'));need(same(parsed,expected),'Reopened original JSON differs.');
    const acquisition=this.context.newPage();this.pageAcquisitions.add(acquisition);let page;
    try{page=await acquisition;}finally{this.pageAcquisitions.delete(acquisition);}
    try{await page.goto(pathToFileURL(file.path).href,{waitUntil:'load'});await page.locator('body').waitFor();
      return{file,desktop:await this.screenshot(name+'-desktop.png',page),parsed:true};
    }finally{await page.close();}
  }
  async catalogueViews(){
    const result={sources:[],jobs:[]};await this.enter('/');
    await this.page.locator('#service-state').waitFor();
    need((await this.page.locator('#service-state').innerText())==='Manual advancement','The independent receiving worker is running.');
    await this.page.locator('#source-search').fill('__no_selected_source__');
    result.empty=await this.screenshot('catalogue-empty-search.png');
    await this.page.locator('#source-search').fill('');
    for(const [index,item]of this.o.approvals.entries()){
      await this.page.locator('[data-tab="sources"]').click();
      await this.page.locator('#sources-list [data-record-id="'+item.sourceId+'"]').click();
      await this.page.locator('#source-detail code').filter({hasText:item.sha256}).waitFor();
      const source=await this.api('/api/records/sources/'+item.sourceId);
      need(source.row_count===item.rows&&source.bytes===item.bytes&&source.sha256===item.sha256,'The browser opened another complete edition.');
      const csv=await this.downloaded('source-'+(index+1)+'.csv',()=>this.page.locator('a[href="/api/sources/'+item.sourceId+'/download"]').click());
      need(csv.bytes===item.bytes&&csv.sha256===item.sha256,'The actual browser CSV lost original bytes.');
      const details=this.page.locator('#source-detail details').filter({has:this.page.locator('summary').filter({hasText:'Complete saved record'})});
      if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
      const record=await this.downloaded('source-'+(index+1)+'.json',()=>details.getByRole('button',{name:'Download record JSON',exact:true}).click());
      const reopened=await this.reopenJson(record,'source-'+(index+1),source);
      result.sources.push({sourceId:item.sourceId,csv,record,reopened,desktop:await this.screenshot('source-'+(index+1)+'-desktop.png'),
        mobile:await this.narrow('source-'+(index+1)+'-mobile.png')});
      await this.page.locator('[data-tab="jobs"]').click();
      await this.page.locator('[data-job-id="'+item.jobId+'"]').click();
      const job=await this.api('/api/records/jobs/'+item.jobId);need(job.state==='DONE'&&job.source_id===item.sourceId,'The original delivery is not complete.');
      const saved=await this.publishCandidate('delivery-job-'+(index+1)+'.json',async()=>({bytes:Buffer.from(JSON.stringify(job,null,2)+'\n'),metadata:{jobId:job.id}}));
      result.jobs.push({job:saved,desktop:await this.screenshot('delivery-job-'+(index+1)+'-desktop.png')});
    }
    for(const tab of ['targets','plans','feeds']){
      await this.page.locator('[data-tab="'+tab+'"]').click();result[tab]=await this.screenshot('catalogue-'+tab+'-desktop.png');
    }
    return result;
  }
  async implementationView(){
    await this.enter('/implementation');
    const record=await this.api('/api/implementations/'+this.o.implementationId);
    const label=record.profile.customer+' · '+record.profile.producer_family;
    await this.page.locator('#implementation-list').getByRole('button',{name:label,exact:true}).click();
    await this.page.locator('#implementation-detail').getByText('Configuration '+record.id+' · revision '+record.revision,{exact:true}).waitFor();
    const result={desktop:await this.screenshot('implementation-desktop.png'),mobile:await this.narrow('implementation-mobile.png'),comparisons:[]};
    for(const resource of record.profile.resources){
      const file=await this.downloaded('comparison-'+resource.key+'.csv',()=>this.page.locator(
        'a[href="/api/implementations/'+record.id+'/comparisons/'+resource.key+'"]').click());
      const expected=record.bindings[resource.key].comparison;
      need(file.bytes===expected.bytes&&file.sha256===expected.sha256,'Complete identifier comparison differs.');
      result.comparisons.push(file);
    }
    await this.page.locator('#profile-form details').last().locator('summary').click();
    const profile=await this.downloaded('implementation-profile.json',()=>this.page.locator('#save-profile').click());
    result.profile=profile;result.reopened=await this.reopenJson(profile,'implementation-profile',record.profile);
    await this.page.getByRole('button',{name:'Export whole implementation',exact:true}).click();
    await this.page.locator('#implementation-downloads a').first().waitFor();
    result.archive=await this.downloaded('implementation.zip',()=>this.page.locator('#implementation-downloads a').first().click());
    return result;
  }
  async approvalViews(){
    const result=[];
    for(const [index,item]of this.o.approvals.entries()){
      await this.enter('/approval?record='+item.recordId);
      await this.page.locator('[data-view="review"]').click();await this.page.locator('#notes').waitFor();
      const view=await this.readReview(item.recordId);
      need(view.record.source.sha256===item.sha256&&view.record.delivery_job_id===item.jobId,'The original review points at another source.');
      const saved=await this.publishCandidate('approval-record-'+(index+1)+'.json',async()=>({
        bytes:Buffer.from(JSON.stringify(view,null,2)+'\n'),metadata:{recordId:item.recordId}}));
      const row={record:saved,desktop:await this.screenshot('approval-'+(index+1)+'-desktop.png'),mobile:await this.narrow('approval-'+(index+1)+'-mobile.png')};
      await this.page.locator('[data-view="history"]').click();row.history=await this.screenshot('approval-'+(index+1)+'-history.png');
      await this.page.locator('[data-view="exports"]').click();
      const key='approval-export-'+item.recordId;
      this.state.exports??={};
      let selected=this.state.exports[key];
      if(!selected){
        selected={recordId:item.recordId,revision:view.record.revision,beforeIds:(await this.api('/api/approval/records/'+item.recordId+'/exports')).map(x=>x.id)};
        this.state.exports[key]=selected;await this.save();
      }
      need(selected.revision===view.record.revision,'Keep the exact original browser export revision.');
      let exports=await this.api('/api/approval/records/'+item.recordId+'/exports');
      if(!selected.response){
        let added=exports.filter(x=>!selected.beforeIds.includes(x.id));
        if(!added.length){
          await this.page.locator('[data-action="export"]').click();
          await this.page.getByRole('link',{name:/Download .* bytes/}).first().waitFor();
          exports=await this.api('/api/approval/records/'+item.recordId+'/exports');
          added=exports.filter(x=>!selected.beforeIds.includes(x.id));
        }
        need(added.length===1,'Resolve the exact original browser export before continuing.');
        selected.response=added[0];await this.save();
      }
      need(exports.some(x=>same(x,selected.response)),'The retained original approval export changed.');
      row.archive=await this.downloaded('approval-'+(index+1)+'.zip',()=>this.page.locator('a[href="'+selected.response.download_url+'"]').click());
      need(row.archive.bytes===selected.response.bytes&&row.archive.sha256===selected.response.sha256,'The actual approval ZIP differs from its retained original descriptor.');
      result.push(row);
    }
    return result;
  }

  async run(){
    await privateDirectory(this.root);
    try{
      this.leaseAcquisition=acquireLease(join(this.root,'browser-operation'));
      this.lease=await this.leaseAcquisition;this.leaseAcquisition=null;
      const selected=JSON.parse(JSON.stringify({actor:this.o.actor,workspaceDirectory:this.o.workspaceDirectory,
        applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256,
        implementationId:this.o.implementationId,approvals:this.o.approvals,note:this.o.note,
        browser:this.o.chromium,playwright:this.o.playwright,source:this.o.source}));
      this.state=await exists(this.path)?await json(this.path):null;
      if(this.state)need(this.state.schema===SCHEMA&&same(this.state.selection,selected),'The original browser selection changed.');
      const candidatePath=join(this.root,'browser-candidate.json'),resultPath=join(this.root,'browser-result.json');
      if(await exists(candidatePath)||await exists(resultPath)){
        const candidate=await json(await exists(candidatePath)?candidatePath:resultPath);
        need(this.state&&same(candidate.selection,selected)&&candidate.schema==='stellar-forge.catalogue-delivery-browser-result.v1'&&
          candidate.state==='COMPLETE'&&typeof candidate.ownersClosedAt==='string','The closed browser result selected another course.');
        for(const row of candidate.files)await verify(row);
        await save(resultPath,candidate);this.state.status='complete';
        this.state.result={path:resultPath,bytes:(await readFile(resultPath)).length,sha256:hash(await readFile(resultPath))};await this.save();
        return{...candidate,resultFile:this.state.result};
      }
      const current=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
        applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
      need(current.value.worker===false,'This receiving course adopts the original native result with its worker disabled.');
      this.state??={schema:SCHEMA,selection:selected,origin:current.value.origin,origins:[{origin:current.value.origin,instanceId:current.value.instanceId,at:now()}],
        startedAt:now(),phases:{},files:{},errors:[],status:'running'};
      await this.save();
      const module=await import(pathToFileURL(this.o.playwright).href),chromium=module.chromium??module.default?.chromium;
      need(chromium,'Select the actual installed Playwright module.');
      this.contextAcquisition=chromium.launchPersistentContext(join(this.root,'profile'),{
        executablePath:this.o.chromium,headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
      this.context=await this.contextAcquisition;this.contextAcquisition=null;this.contextWasOpened=true;
      this.state.ownersClosedAt=null;await this.save();
      this.page=this.context.pages()[0]??await this.context.newPage();this.page.setDefaultTimeout(60000);
      this.page.on('pageerror',error=>{this.state.errors.push({type:'pageerror',message:error.message,at:now()});void this.save().catch(()=>{});});
      await this.enter();
      const edit=await this.phase('original-local-note-recovery',()=>this.localEdit());
      const catalogue=await this.phase('complete-catalogue-editions-and-jobs',()=>this.catalogueViews());
      const implementation=await this.phase('complete-implementation-export-and-profile-reopen',()=>this.implementationView());
      const approval=await this.phase('both-original-native-reviews-and-full-exports',()=>this.approvalViews());
      const final=this.checkNote((await this.readReview(this.o.note.recordId)).record);
      await this.retain(await save(join(this.root,'final-browser-review.json'),final));
      await this.closeContext();
      const candidate={schema:'stellar-forge.catalogue-delivery-browser-result.v1',state:'COMPLETE',selection:selected,
        origins:this.state.origins,edit,catalogue,implementation,approval,completedAt:now(),ownersClosedAt:this.state.ownersClosedAt,
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
    if(this.page&&this.routeHandler){await this.page.unroute(this.noteRoute,this.routeHandler);this.routeHandler=null;}
    if(this.context){await this.context.close();this.context=null;this.page=null;}
    if(this.state&&this.contextWasOpened){this.state.ownersClosedAt=now();this.contextWasOpened=false;await this.save();}
  }
  close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      for(;;){try{await this.closeContext();break;}catch(error){
        if(this.state){this.state.errors.push({type:'closure',message:error.message,at:now()});await this.save().catch(()=>{});}
        process.stderr.write(JSON.stringify({state:'CATALOGUE_DELIVERY_BROWSER_CLOSING',message:error.message})+'\n');await delay(1000);
      }}
      await this.writeTail;
      if(this.leaseAcquisition){try{this.lease=await this.leaseAcquisition;}finally{this.leaseAcquisition=null;}}
      if(this.lease){await this.lease.close();this.lease=null;}
    })().finally(()=>{this.closing=null;});return this.closing;
  }
}
