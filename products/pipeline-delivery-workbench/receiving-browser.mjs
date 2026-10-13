// SPDX-License-Identifier: MIT
// Exercise the original Staff UI around the retained Dagster/dbt result.
import {readFile,mkdir,open,rename,lstat} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {acquireLease} from './managed.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'PIPELINE_RECEIVING_BROWSER'});};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>new Date().toISOString();
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(p){return JSON.parse(await readFile(p,'utf8'));}
async function identity(p){const b=await readFile(p);return{bytes:b.length,sha256:hash(b)};}
async function verify(p,d){const a=await identity(p);need(a.bytes===d.bytes&&a.sha256===d.sha256,'The original browser artifact differs: '+p);}
async function write(p,b,{immutable=false}={}){
  b=Buffer.isBuffer(b)?b:Buffer.from(b);
  await mkdir(dirname(p),{recursive:true,mode:0o700});
  if(immutable&&await exists(p)){need((await readFile(p)).equals(b),'The exact browser artifact is already selected: '+p);return;}
  const tmp=p+'.writing-'+randomUUID(),f=await open(tmp,'wx',0o600);
  try{await f.writeFile(b);await f.sync();}finally{await f.close();}
  await rename(tmp,p);const d=await open(dirname(p),'r');try{await d.sync();}finally{await d.close();}
}
const save=(p,v,o)=>write(p,JSON.stringify(v,null,2)+'\n',o);
function child(root,p){const r=relative(root,p);need(r&&r!=='..'&&!r.startsWith('../')&&!isAbsolute(r),'Keep browser artifacts in the selected original directory.');return r.split('\\').join('/');}

class Journey{
  constructor(options){
    this.o=options;this.directory=resolve(options.directory);this.context=null;this.page=null;this.lease=null;
    this.running=null;this.closing=false;this.closed=false;this.routes=new Set();this.routeError=null;this.serial=Promise.resolve();
  }
  run(){need(!this.closing&&!this.closed,'The retained browser owner is closing.');return this.running??=(this.execute());}
  assertOpen(){need(!this.closing&&!this.closed,'No new work may begin after browser closure was requested.');if(this.routeError)throw this.routeError;}
  async persist(){const value=JSON.parse(JSON.stringify(this.state));this.serial=this.serial.then(()=>save(join(this.directory,'browser-operation.json'),value));return this.serial;}
  async retain(p){const name=child(this.directory,p),d={path:name,...await identity(p)};this.state.files[name]=d;await this.persist();return d;}
  async artifact(name,value){const p=join(this.directory,name);await save(p,value,{immutable:true});await this.retain(p);return value;}
  async step(name,fn){this.assertOpen();if(this.state.steps[name]?.complete)return this.state.steps[name].value;const value=await fn();this.state.steps[name]={complete:true,value};await this.persist();return value;}
  async until(fn,message){for(let i=0;i<600;i++){this.assertOpen();const v=await fn();if(v)return v;await delay(100);}throw new Error(message);}
  async capture(name){
    const p=join(this.directory,'screens',name+'.png');
    if(this.state.files[child(this.directory,p)]){await verify(p,this.state.files[child(this.directory,p)]);return this.state.files[child(this.directory,p)];}
    if(await exists(p)){const s=await lstat(p),bytes=await readFile(p);need(s.isFile()&&!s.isSymbolicLink()&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The owned published screenshot is incomplete.');return this.retain(p);}
    const b=await this.page.screenshot({fullPage:true});await write(p,b,{immutable:true});return this.retain(p);
  }
  async get(endpoint){
    const r=await this.page.request.get(this.o.origin+endpoint);try{const value=await r.json();need(r.ok(),value.error?.message||'The original UI read failed.');return value;}finally{await r.dispose();}
  }
  async read(action,payload){return(await this.get('/api/read?action='+encodeURIComponent(action)+'&payload='+encodeURIComponent(JSON.stringify(payload)))).result;}
  async pending(){return this.page.evaluate(()=>new Promise((yes,no)=>{
    const q=indexedDB.open('pipeline-staff',1);q.onerror=()=>no(q.error);q.onsuccess=()=>{const d=q.result,r=d.transaction('kv','readonly').objectStore('kv').get('pending');r.onsuccess=()=>{yes(r.result??null);d.close();};r.onerror=()=>{no(r.error);d.close();};};
  }));}
  async lastResponse(){return this.page.evaluate(()=>new Promise((yes,no)=>{
    const q=indexedDB.open('pipeline-staff',1);q.onerror=()=>no(q.error);q.onsuccess=()=>{const d=q.result,r=d.transaction('kv','readonly').objectStore('kv').get('lastResponse');r.onsuccess=()=>{yes(r.result??null);d.close();};r.onerror=()=>{no(r.error);d.close();};};
  }));}
  async route(route){
    const q=route.request(),url=new URL(q.url());
    if(url.origin!==this.o.origin||q.method()!=='POST'||!['/api/invoke','/api/receive','/api/open'].includes(url.pathname))return route.continue();
    try{
      this.assertOpen();
      const raw=q.postData()??'',body=JSON.parse(raw);
      need(this.o.editDescription!==undefined&&url.pathname==='/api/invoke'&&body.action==='project.update'&&body.payload.id===this.o.projectId&&body.payload.description===this.o.editDescription,
        'The receiving browser may issue only its selected original project update.');
      const old=this.state.request;
      if(old)need(old.raw===raw&&old.endpoint===url.pathname,'Keep the original lost-acknowledgement request exactly.');
      else{
        this.state.request={endpoint:url.pathname,raw,requestId:body.request_id,sha256:hash(raw)};
        await write(join(this.directory,'request.json'),raw,{immutable:true});await this.retain(join(this.directory,'request.json'));await this.persist();
      }
      const response=await route.fetch();
      try{
        const bytes=await response.body(),value=JSON.parse(bytes.toString('utf8'));
        if(response.status()>=500||value.outcome_unknown){await this.artifact('unresolved-'+hash(bytes)+'.json',{status:response.status(),body:value});await route.fulfill({response});return;}
        need(response.ok()&&value.request_id===body.request_id,'The exact browser update must complete successfully.');
        const resultPath=join(this.directory,'response.json');
        if(await exists(resultPath))need(same(await json(resultPath),value),'Replay must retain the original completed Staff response.');
        else await write(resultPath,bytes,{immutable:true});
        await this.retain(resultPath);
        if(!this.state.lostAcknowledgement){
          this.state.lostAcknowledgement={requestId:body.request_id,response:{...await identity(resultPath)},at:now()};
          await this.persist();await route.abort('failed');return;
        }
        this.state.replayed=true;await this.persist();await route.fulfill({response});
      }finally{await response.dispose();}
    }catch(error){this.routeError=error;await route.abort('failed').catch(()=>{});throw error;}
  }
  async launch(){
    this.assertOpen();const module=await import(pathToFileURL(this.o.playwright).href);this.assertOpen();
    const playwright=module.chromium?module:module.default;
    // run() remains owned until this acquisition resolves; close() awaits run().
    this.context=await playwright.chromium.launchPersistentContext(join(this.directory,'profile'),{
      executablePath:this.o.chromium,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
      args:['--disable-dev-shm-usage']});
    this.assertOpen();this.page=await this.context.newPage();this.assertOpen();
    this.page.on('pageerror',e=>{this.state.pageErrors.push({message:e.message,at:now()});});
    await this.page.route('**/api/**',route=>{
      const p=this.route(route);this.routes.add(p);p.catch(e=>{this.routeError=e;}).finally(()=>this.routes.delete(p));return p;
    });
    const capability=(await readFile(this.o.capabilityFile,'utf8')).trim();need(capability.length>=40,'Read the original private Staff capability.');
    await this.page.goto(this.o.origin+'/',{waitUntil:'domcontentloaded'});
    const session=this.page.locator('#session-screen');
    if(await session.isVisible()){
      await this.capture('desktop-session');
      if(!this.state.steps['session-error']){
        await this.page.locator('#session-key').fill('invalid-receiving-session');
        await this.page.locator('#session-connect').click();
        await this.until(async()=>Boolean(await this.page.locator('#session-error').textContent()),'The invalid session result was not rendered.');
        await this.capture('desktop-session-error');this.state.steps['session-error']={complete:true,value:true};await this.persist();
      }
      await this.page.locator('#session-key').fill(capability);await this.page.locator('#session-connect').click();
    }
    await this.page.locator('#shell').waitFor({state:'visible',timeout:60000});
    await this.until(async()=>Boolean((await this.get('/api/state')).selection),'The original selected writer is not ready.');
  }
  async closeOwners(){
    if(this.context){await this.context.close();this.context=null;this.page=null;}
    await Promise.allSettled([...this.routes]);await this.serial;
  }
  async project(){
    const p=await this.read('project.get',{id:this.o.projectId});
    await this.page.locator('#project-filter').fill('');
    let button=this.page.locator('#projects .project-item').filter({hasText:p.project.label}).first();
    while(!await button.count()&&await this.page.locator('#projects-more').isVisible())await this.page.locator('#projects-more').click();
    await button.click();await this.page.locator('#project-title').waitFor({state:'visible'});
    need((await this.page.locator('#project-title').textContent()).includes(p.project.label),'The rendered project differs.');return p;
  }
  async download(name,action,expected){
    const p=join(this.directory,'downloads',name),key=child(this.directory,p);
    if(this.state.files[key]){await verify(p,this.state.files[key]);if(expected)need(same({bytes:this.state.files[key].bytes,sha256:this.state.files[key].sha256},expected),'The saved download selection differs.');return this.state.files[key];}
    if(await exists(p)){const s=await lstat(p);need(s.isFile()&&!s.isSymbolicLink(),'The retained browser download changed type.');const d=await identity(p);if(expected)need(d.bytes===expected.bytes&&d.sha256===expected.sha256,'The completed original download differs.');return this.retain(p);}
    const wait=this.page.waitForEvent('download',{timeout:60000});await action();const event=await wait;
    need(!await event.failure(),'The actual browser download failed.');
    const tmp=p+'.download';await mkdir(dirname(p),{recursive:true,mode:0o700});await event.saveAs(tmp);
    const d=await identity(tmp);if(expected)need(d.bytes===expected.bytes&&d.sha256===expected.sha256,'The browser must download every original byte.');
    const f=await open(tmp,'r');try{await f.sync();}finally{await f.close();}
    await rename(tmp,p);const dir=await open(dirname(p),'r');try{await dir.sync();}finally{await dir.close();}
    return this.retain(p);
  }
  async edit(){
    if(this.o.editDescription===undefined)return null;
    return this.step('lost-acknowledgement-edit',async()=>{
      if(!this.state.request){
        await this.project();await this.page.locator('#edit-project').click();
        await this.page.locator('#project-notes').fill(this.o.editDescription);
        await this.page.locator('#project-form').getByRole('button',{name:'Save project',exact:true}).click();
      }
      await this.until(()=>this.state.lostAcknowledgement,'The exact original update has not reached its retained completed response.');
      const body=JSON.parse(this.state.request.raw),pending=await this.pending();
      if(pending)need(pending.request_id===body.request_id&&pending.body===this.state.request.raw,'The UI retained another request.');
      if(!this.state.replayed){
        await this.capture('desktop-original-request-pending');
        await this.closeOwners();this.assertOpen();await this.launch();
        // Original boot may resolve the exact IndexedDB request automatically.
        if(await this.pending())await this.page.locator('#resume-request').click();
        else if(!this.state.replayed){
          await this.page.evaluate(async ({endpoint,raw})=>{
            const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:raw});await r.text();
          },{endpoint:this.state.request.endpoint,raw:this.state.request.raw});
          await this.page.reload({waitUntil:'domcontentloaded'});
        }
      }
      await this.until(async()=>this.state.replayed&&!await this.pending(),'The original saved request remains pending.');
      const receipt=await this.read('request.get',{request_id:body.request_id}),p=await this.project();
      need(receipt.request_id===body.request_id&&p.project.description===this.o.editDescription,'The original native request or actual project update differs.');
      await this.artifact('native-request-receipt.json',receipt);
      const stored=await this.lastResponse();if(stored)await this.artifact('browser-last-response.json',stored);
      return{requestId:body.request_id,revision:receipt.revision,description:p.project.description,lostAcknowledgement:true,replayed:true};
    });
  }
  async screens(){
    return this.step('full-rendered-workflow',async()=>{
      const p=await this.project(),run=await this.read('run.get',{id:this.o.runId});
      need(run.project_id===this.o.projectId&&run.dagster_run_id===this.o.dagsterRunId&&run.outcome_sha256===this.o.outcomeSha256&&run.state==='succeeded','The browser must inspect the original completed native run.');
      const result={screens:[],downloads:[],nativeRunId:run.dagster_run_id};
      for(const width of [1440,390]){
        await this.page.setViewportSize({width,height:1000});
        for(const tab of ['source','contract','binding','runs','compare','reviews','releases']){
          await this.page.locator('#tabs [data-tab="'+tab+'"]').click();
          if(tab==='source'){
            await this.page.locator('#source-files .file-item').filter({hasText:/^README\.md/}).first().click();
            const file=await this.read('file.read',{edition_id:p.edition.id,path:'README.md'});
            await this.until(async()=>await this.page.locator('#file-editor').inputValue()===file.content,'The complete saved source did not render.');
            result.downloads.push(await this.download('README.md',()=>this.page.locator('#file-download').click(),{bytes:file.bytes,sha256:file.sha256}));
          }
          if(tab==='runs'){
            await this.page.locator('#run-filter').selectOption('');
            await this.page.locator('#runs-table').getByRole('button',{name:run.id,exact:true}).click();
            await this.until(async()=>(await this.page.locator('#run-summary').textContent()).includes(run.dagster_run_id),'The retained Dagster identity is absent from the actual screen.');
          }
          result.screens.push(await this.capture(width+'-'+tab));
          const overflow=await this.page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
          need(overflow.width<=overflow.viewport+2,'The original application has horizontal page overflow at '+width+'px; repair the source before delivery.');
        }
        await this.page.locator('#project-filter').fill('no-such-original-project-'+this.o.runId);
        result.screens.push(await this.capture(width+'-empty-filter'));await this.page.locator('#project-filter').fill('');
        await this.page.locator('#show-receiving').click();result.screens.push(await this.capture(width+'-receiving'));
        await this.page.locator('#receiving-back').click();await this.project();
      }
      await this.page.setViewportSize({width:1440,height:1000});
      await this.page.locator('#tabs [data-tab="runs"]').click();
      await this.page.locator('#runs-table').getByRole('button',{name:run.id,exact:true}).click();
      for(const file of run.outcome.evaluation.artifact_files){
        result.downloads.push(await this.download('native-'+hash(file.path).slice(0,12)+'-'+file.path.split('/').at(-1),
          ()=>this.page.locator('#run-artifacts .artifact-row').filter({hasText:file.path}).getByRole('button',{name:'Download original artifact',exact:true}).click(),
          {bytes:file.bytes,sha256:file.sha256}));
      }
      result.downloads.push(await this.download('native-outcome.json',()=>this.page.locator('#run-outcome').click()));
      need(same(await json(join(this.directory,'downloads','native-outcome.json')),run.outcome),'The downloaded complete native outcome differs.');
      await this.page.locator('#show-audit').click();await this.page.locator('#json-dialog').waitFor({state:'visible'});
      result.downloads.push(await this.download('complete-workspace-history.json',()=>this.page.locator('#json-dialog-download').click()));
      await this.page.locator('#json-dialog [data-close]').click();
      await this.artifact('rendered-original-native.json',{run,project:p,result});
      return result;
    });
  }
  async reports(){
    const reports=[];
    for(const [i,path]of (this.o.reportDirectories??[]).entries()){
      const full=resolve(path),index=join(full,'index.html');
      need(await exists(index),'Open the actual extracted handover HTML.');
      await this.page.goto(pathToFileURL(index).href,{waitUntil:'load'});
      for(const width of [1440,390]){
        await this.page.setViewportSize({width,height:1000});reports.push(await this.capture('handover-'+i+'-'+width));
        need((await this.page.locator('body').textContent()).includes(this.o.dagsterRunId),'The outgoing report must display the original Dagster ID.');
      }
      await this.page.getByRole('link',{name:'Complete selected records',exact:true}).click();
      const record=await json(join(full,'records.json'));need(record.run.dagster_run_id===this.o.dagsterRunId,'The reopened handover records differ.');
      await this.artifact('handover-'+i+'-records.json',record);
    }
    return reports;
  }
  async execute(){
    await mkdir(this.directory,{recursive:true,mode:0o700});this.assertOpen();
    this.lease=await acquireLease(join(this.directory,'browser.lock'));this.assertOpen();
    const selected={origin:this.o.origin,projectId:this.o.projectId,runId:this.o.runId,dagsterRunId:this.o.dagsterRunId,outcomeSha256:this.o.outcomeSha256,
      capabilityFile:resolve(this.o.capabilityFile),playwright:resolve(this.o.playwright),chromium:resolve(this.o.chromium),
      editDescription:this.o.editDescription??null,reportDirectories:(this.o.reportDirectories??[]).map(p=>resolve(p))};
    const op=join(this.directory,'browser-operation.json'),candidate=join(this.directory,'browser-candidate.json'),resultPath=join(this.directory,'browser-result.json');
    this.state=await exists(op)?await json(op):{schema:'stellar-forge.pipeline-delivery-browser-operation.v1',selected,steps:{},files:{},pageErrors:[],createdAt:now()};
    need(same(this.state.selected,selected),'Keep the original browser selection, runtime, origin and edit.');
    if(await exists(candidate)||await exists(resultPath)){
      const result=await json(await exists(candidate)?candidate:resultPath);need(same(result.selected,selected)&&result.status==='complete','The final browser candidate differs.');
      for(const file of result.files)await verify(join(this.directory,file.path),file);
      if(await exists(resultPath))need(same(await json(resultPath),result),'The published browser result differs.');
      await save(resultPath,result,{immutable:true});return result;
    }
    if(await exists(op))need(this.o.resume===true,'Resume the retained original browser course explicitly.');
    await this.persist();
    try{
      await this.launch();const state=await this.get('/api/state');
      await this.step('initial-selected-writer',()=>this.artifact('initial-selected-writer.json',state));
      const edited=await this.edit(),rendered=await this.screens(),reports=await this.reports();
      await this.closeOwners();
      need(!this.routeError,'A retained original browser route failed.');
      need(this.state.pageErrors.length===0,'Repair actual page script errors before customer delivery.');
      this.state.completedAt??=now();await this.persist();
      const result={schema:'stellar-forge.pipeline-delivery-browser-result.v1',status:'complete',selected,completedAt:this.state.completedAt,
        edited,rendered,reports,pageErrors:this.state.pageErrors,files:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),
        inspection:'The receiving operator must open the actual PNGs and outgoing archive/report before customer presentation; source review and capture alone do not satisfy visual inspection.'};
      await save(candidate,result,{immutable:true});await save(resultPath,result,{immutable:true});return result;
    }finally{await this.closeOwners();}
  }
  close(){
    if(this.closed)return Promise.resolve();if(this.closingPromise)return this.closingPromise;this.closing=true;
    this.closingPromise=(async()=>{if(this.running)await this.running.catch(()=>{});
      await this.closeOwners();if(this.lease){await this.lease.close();this.lease=null;}this.closed=true;
    })().finally(()=>{this.closingPromise=null;});return this.closingPromise;
  }
}
export function openPipelineReceivingBrowser(options){return new Journey(options);}
