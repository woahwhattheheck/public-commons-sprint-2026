// SPDX-License-Identifier: MIT
// Actual original Hive UI receiving, with one retained browser owner.
import {readFile,open,mkdir,rename,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {acquireLease} from './managed.mjs';
const SCHEMA='stellar-forge.hive-routing-browser.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const same=(a,b)=>stable(a)===stable(b),now=()=>new Date().toISOString();
function need(ok,code,message,details={}){if(!ok)throw Object.assign(new Error(message),{code,details});}
async function privateDirectory(p){await mkdir(p,{recursive:true,mode:0o700});const st=await lstat(p);need(st.isDirectory()&&await realpath(p)===p&&(st.mode&0o077)===0&&(typeof process.getuid!=='function'||st.uid===process.getuid()),'HIVE_BROWSER_PRIVATE_DIRECTORY','Use an owned canonical mode0700 browser directory.');}
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(p){return JSON.parse(await readFile(p,'utf8'));}
async function digest(p){const fd=await open(p,'r');try{const a=await fd.stat();need(a.isFile(),'HIVE_BROWSER_FILE','Retain complete regular files.');const h=createHash('sha256'),b=Buffer.alloc(1024*1024);let n=0;while(n<a.size){const r=await fd.read(b,0,Math.min(b.length,a.size-n),n);need(r.bytesRead,'HIVE_BROWSER_FILE','Original file ended early.');h.update(b.subarray(0,r.bytesRead));n+=r.bytesRead;}const z=await fd.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===z[k]),'HIVE_BROWSER_FILE_CHANGED','The original file changed.');return{bytes:n,sha256:h.digest('hex')};}finally{await fd.close();}}
async function verify(p,d){const a=await digest(p);need(a.bytes===d.bytes&&a.sha256===d.sha256,'HIVE_BROWSER_FILE_CHANGED','Retained complete browser artifact differs.',{path:p});}
async function syncDir(p){const f=await open(p,'r');try{await f.sync();}finally{await f.close();}}
async function bytes(p,b,{immutable=false}={}){await mkdir(dirname(p),{recursive:true,mode:0o700});if(immutable&&await exists(p)){need((await readFile(p)).equals(b),'HIVE_BROWSER_RECORD_CHANGED','Preserve the exact first browser record.',{path:p});return;}const t=p+'.writing-'+randomUUID(),f=await open(t,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}await rename(t,p);await syncDir(dirname(p));}
async function save(p,v,o){await bytes(p,Buffer.from(JSON.stringify(v,null,2)+'\n'),o);}
function safe(root,p){const r=relative(root,p);need(r&&!r.startsWith('../')&&!isAbsolute(r),'HIVE_BROWSER_PATH','Use artifacts beneath this browser operation.');return r.split('\\').join('/');}
function serialError(e){return{code:e.code||'HIVE_BROWSER_FAILED',message:e.message,details:e.details||{}};}
function requireSelection(o){
  need(isAbsolute(o.directory)&&isAbsolute(o.operationRoot)&&isAbsolute(o.playwright)&&isAbsolute(o.chromium),'HIVE_BROWSER_SELECTION','Use the selected absolute operation and browser paths.');
  safe(o.operationRoot,o.directory);
  const u=new URL(o.origin);need(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.pathname==='/'&&!u.search&&!u.hash,'HIVE_BROWSER_ORIGIN','Use the existing private loopback operator origin.');
  need(/^[0-9a-f]{32}$/.test(o.workspaceId)&&/^[0-9a-f]{64}$/.test(o.sourceManifestSha256),'HIVE_BROWSER_SELECTION','Bind the original workspace and full installed source manifest.');
  need(Array.isArray(o.programmes)&&o.programmes.length===3&&same(o.programmes.map(x=>x.phase).sort(),['changed','initial','rollback']),'HIVE_BROWSER_PROGRAMMES','Retain the three original reference programmes.');
  for(const p of o.programmes)need(typeof p.id==='string'&&p.rows?.length===20&&new Set(p.rows.map(r=>r.id)).size===20&&p.rows.every(r=>r.body&&Number.isSafeInteger(r.body.bytes)&&/^[0-9a-f]{64}$/.test(r.body.sha256)),'HIVE_BROWSER_PROGRAMMES','Retain all sixty exact original response identities.');
  need(Array.isArray(o.editions)&&o.editions.length>=2&&o.editions.every(x=>typeof x.id==='string'&&x.files?.length),'HIVE_BROWSER_EDITIONS','Retain both full original editions.');
  need(isAbsolute(o.archive.path)&&Number.isSafeInteger(o.archive.bytes)&&/^[0-9a-f]{64}$/.test(o.archive.sha256)&&isAbsolute(o.receivingDirectory),'HIVE_BROWSER_ARCHIVE','Select the complete original archive and a named receiving path.');
  if(o.review)need(o.editions.some(e=>e.id===o.review.editionId)&&typeof o.review.note==='string'&&o.review.note.trim(),'HIVE_BROWSER_REVIEW','Bind the exact edition and complete review note.');
}
class HiveBrowser {
  constructor(options){this.o={...options,directory:resolve(options.directory),operationRoot:resolve(options.operationRoot),origin:new URL(options.origin).origin};this.directory=this.o.directory;this.context=null;this.browser=null;this.page=null;this.lease=null;this.running=null;this.closeTask=null;this.tasks=new Set();this.state=null;this.closing=false;}
  selection(){const o=this.o;return{schema:SCHEMA,sourceManifestSha256:o.sourceManifestSha256,origin:o.origin,workspaceId:o.workspaceId,programmes:o.programmes,editions:o.editions,archive:o.archive,receivingDirectory:o.receivingDirectory,review:o.review||null,playwright:o.playwright,chromium:o.chromium};}
  path(name){return join(this.directory,name);}
  async persist(){await save(this.path('browser-operation.json'),this.state);}
  async retain(name){const path=this.path(name),d=await digest(path);this.state.files[name]={path:name,...d};await this.persist();return this.state.files[name];}
  async record(name,value){await save(this.path(name),value,{immutable:true});return this.retain(name);}
  async readState(){const r=await this.context.request.get(this.o.origin+'/api/state');try{const b=await r.body();need(r.status()===200,'HIVE_BROWSER_HTTP','Original state request failed.',{status:r.status(),body:b.toString('utf8')});const v=JSON.parse(b);need(v.id===this.o.workspaceId&&Array.isArray(v.entities),'HIVE_BROWSER_WORKSPACE','The existing listener opened a different workspace.');return v;}finally{await r.dispose();}}
  async validateState(v){
    for(const p of this.o.programmes){const e=v.entities.find(x=>x.kind==='programme'&&x.id===p.id);need(e?.data.state==='complete'&&e.data.rows.length===20,'HIVE_BROWSER_PROGRAMME','The complete original programme is absent.');for(const r of p.rows){const a=e.data.rows.find(x=>x.id===r.id);need(a?.response&&same(a.response.body,r.body),'HIVE_BROWSER_RESPONSE','An original complete native response differs.',{programme:p.id,operation:r.id});}}
    for(const e of this.o.editions){const a=v.entities.find(x=>x.kind==='edition'&&x.id===e.id);need(a&&same(a.data.files,e.files),'HIVE_BROWSER_EDITION','The complete saved edition differs.');}
    const deployments=v.entities.filter(x=>x.kind==='deployment');need(deployments.length>=2,'HIVE_BROWSER_NATIVE','Original deployment history is absent.');
    need(deployments.every(x=>!['starting','running','ready','stopping'].includes(x.data.state)),'HIVE_BROWSER_NATIVE_LIVE','This completed-reference browser course requires the original native owners to be stopped; preserve the current owner instead of starting another course.');
  }
  assertOpen(){need(!this.closing,'HIVE_BROWSER_CLOSING','The retained browser owner is closing; no later work may start.');}
  async phase(name,fn){this.assertOpen();if(this.state.phases[name])return this.state.phases[name];const result=await fn();this.state.phases[name]=result??{complete:true};await this.persist();return this.state.phases[name];}
  async shot(name){const p=this.path('screens/'+name+'.png');await mkdir(dirname(p),{recursive:true,mode:0o700});await this.page.screenshot({path:p,fullPage:true});return this.retain('screens/'+name+'.png');}
  async gotoPane(name){this.assertOpen();await this.page.locator('nav [data-section="'+name+'"]').click();await this.page.locator('#'+name).waitFor({state:'visible'});need(await this.page.locator('nav [data-section="'+name+'"]').getAttribute('aria-current')==='page','HIVE_BROWSER_NAVIGATION','The original pane did not become current.');}
  async dialog(){await this.page.locator('#detail-dialog').waitFor({state:'visible'});}
  async closeDialog(){await this.page.locator('#close-detail').click();await this.page.locator('#detail-dialog').waitFor({state:'hidden'});}
  async download(link,name,expected){
    const pending=this.page.waitForEvent('download');await link.click();const d=await pending;const target=this.path('downloads/'+name),temporary=target+'.download-'+randomUUID();await mkdir(dirname(target),{recursive:true,mode:0o700});await d.saveAs(temporary);need(!(await d.failure()),'HIVE_BROWSER_DOWNLOAD','The complete original download failed.');await verify(temporary,expected);const f=await open(temporary,'r');try{await f.sync();}finally{await f.close();}
    if(await exists(target)){await verify(target,expected);await import('node:fs/promises').then(m=>m.unlink(temporary));}else{await rename(temporary,target);await syncDir(dirname(target));}
    return this.retain('downloads/'+name);
  }
  async reviewProof(intent){
    const v=await this.readState(),e=v.entities.find(x=>x.kind==='configuration-review'&&x.id===intent.data.edition),edition=v.entities.find(x=>x.kind==='edition'&&x.id===intent.data.edition);
    const matches=!!e&&e.data.edition===intent.data.edition&&e.data.editionRevision===edition?.revision&&e.data.note===intent.data.note&&same(e.data.decisions,intent.data.decisions);
    return{state:v,current:e||null,matches};
  }
  async review(){
    if(!this.o.review)return{performed:false};
    const intentPath=this.path('review/request.json'),resultPath=this.path('review/result.json');
    if(await exists(resultPath)){const r=await json(resultPath);await this.retain('review/request.json');await this.retain('review/result.json');const p=await this.reviewProof(await json(intentPath));need(p.matches&&p.current.revision===r.entity.revision,'HIVE_BROWSER_REVIEW_DRIFT','The completed original browser review is no longer current.');return r;}
    if(await exists(intentPath)){
      const intent=await json(intentPath);await this.retain('review/request.json');const p=await this.reviewProof(intent);
      if(p.matches){const r={kind:'recovered-effect',observedAt:now(),request:intent,entity:p.current,originalHttpResponseRetained:await exists(this.path('review/response.json'))};await this.record('review/result.json',r);return r;}
      need(this.o.resume===true,'HIVE_BROWSER_RESUME','Resume the original retained review explicitly.');
      need((p.current?.revision||null)===(intent.data.expected||null),'HIVE_BROWSER_REVIEW_CONFLICT','A different review now exists; preserve the pending original decision.');
      const response=await this.context.request.post(this.o.origin+'/api/action',{data:intent});try{const body=await response.body();await bytes(this.path('review/retry-response.bin'),body,{immutable:true});await this.retain('review/retry-response.bin');await this.record('review/retry-response.json',{status:response.status(),headers:response.headers(),body:await digest(this.path('review/retry-response.bin'))});const observed=await this.reviewProof(intent);need(observed.matches,'HIVE_BROWSER_REVIEW_UNCONFIRMED','The same original CAS review was not confirmed.',{status:response.status()});const r={kind:response.ok()?'confirmed-http':'recovered-effect',observedAt:now(),request:intent,entity:observed.current};await this.record('review/result.json',r);return r;}finally{await response.dispose();}
    }
    await this.gotoPane('editions');await this.page.locator('#config-edition').selectOption(this.o.review.editionId);await this.page.locator('#configuration-review textarea[name="note"]').fill(this.o.review.note);
    const before=await this.readState(),edition=before.entities.find(x=>x.kind==='edition'&&x.id===this.o.review.editionId),old=before.entities.find(x=>x.kind==='configuration-review'&&x.id===this.o.review.editionId);
    need(old&&edition,'HIVE_BROWSER_REVIEW','Review the existing fully reviewed original edition.');
    for(const d of old.data.decisions){const rows=this.page.locator('#feature-rows .review-row'),index=await rows.evaluateAll((items,feature)=>items.findIndex(x=>x.dataset.feature===feature),d.feature);need(index>=0,'HIVE_BROWSER_REVIEW','An original configuration feature is missing.');const row=rows.nth(index);await row.locator('select').selectOption(d.decision);await row.locator('textarea').fill(d.reason);}
    const expected={action:'configuration.review',data:{edition:this.o.review.editionId,decisions:old.data.decisions,note:this.o.review.note,expected:old.revision}};
    let captured=false,routeFailure=null;
    const handler=async route=>{const task=(async()=>{const request=route.request();if(request.method()!=='POST'){await route.continue();return;}const body=request.postDataJSON();if(body?.action!=='configuration.review'){await route.continue();return;}need(!captured&&same(body,expected),'HIVE_BROWSER_REVIEW_REQUEST','The rendered review differs from the selected original CAS request.');captured=true;await this.record('review/request.json',body);const response=await route.fetch();try{const raw=await response.body();await bytes(this.path('review/response.bin'),raw,{immutable:true});await this.retain('review/response.bin');await this.record('review/response.json',{status:response.status(),headers:response.headers(),body:await digest(this.path('review/response.bin'))});await route.fulfill({response,body:raw});}finally{await response.dispose();}})();this.tasks.add(task);try{await task;}catch(e){routeFailure=e;try{await route.abort('failed');}catch{}}finally{this.tasks.delete(task);}};
    await this.page.route('**/api/action',handler);
    try{await this.page.locator('#configuration-review button.primary').click();await this.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('configuration review saved')||document.querySelector('#status')?.classList.contains('error'));await Promise.all([...this.tasks]);if(routeFailure)throw routeFailure;need(captured,'HIVE_BROWSER_REVIEW_REQUEST','The actual review control did not dispatch its retained request.');const proof=await this.reviewProof(expected);need(proof.matches,'HIVE_BROWSER_REVIEW_UNCONFIRMED','The actual saved review was not confirmed.');const r={kind:'confirmed-http',observedAt:now(),request:expected,entity:proof.current};await this.record('review/result.json',r);return r;}finally{await this.page.unroute('**/api/action',handler);}
  }
  async screens(){
    const p=this.page;
    for(const width of [1440,390]){
      await p.setViewportSize({width,height:1000});
      for(const pane of ['editions','native','programme','cutover','delivery']){await this.gotoPane(pane);await this.shot(width+'-'+pane);}
      await this.gotoPane('editions');const first=this.o.editions[0];await p.locator('#change-edition').selectOption(first.id);const file=first.files[0];await p.locator('#change-file').selectOption(file.path);await p.waitForFunction(()=>{const e=document.querySelector('#changed-source');return e&&!e.disabled&&e.getAttribute('aria-busy')!=='true';});const original=await p.locator('#changed-source').inputValue();need(hash(Buffer.from(original))===file.sha256,'HIVE_BROWSER_EDITOR','The rendered editor does not contain the complete selected original file.');await p.locator('#stage-change').click();need((await p.locator('#changed-files-summary').innerText()).includes(file.path),'HIVE_BROWSER_EDITOR','The original complete-file staging control did not retain its file.');await this.shot(width+'-staged-editor');await p.locator('#changed-files-summary button').click();
      await this.gotoPane('programme');
      for(const programme of this.o.programmes){await p.locator('#result-programme').selectOption(programme.id);need(await p.locator('#result-rows tr').count()===20,'HIVE_BROWSER_PROGRAMMES','The rendered programme omits an original operation.');await p.locator('#result-rows tr').first().getByRole('button',{name:'Full response',exact:true}).click();await this.dialog();const body=await p.locator('#detail-body').textContent();need(hash(Buffer.from(body))===programme.rows[0].body.sha256,'HIVE_BROWSER_RESPONSE','The rendered full native response differs.');await this.shot(width+'-'+programme.phase+'-response');await this.closeDialog();}
      await this.gotoPane('native');const starts=await p.locator('#native-rows').getByRole('button',{name:'Start',exact:true}).count();need(starts>=2,'HIVE_BROWSER_START','Preserve the original explicit Start controls.');
      await this.gotoPane('cutover');need(/stopped|not serving|not running|earlier installation|closed/i.test(await p.locator('#active-deployment').innerText()),'HIVE_BROWSER_STOPPED','The actual operator must explain that the selected original router is stopped.');
      await this.shot(width+'-stopped-selection');
    }
    await p.setViewportSize({width:1440,height:1000});
    return{widths:[1440,390],panes:5,originalResponses:60,renderedResponseDialogs:6,explicitStartPreserved:true,visualInspection:'Required: the producing peer must open and look at these exact screenshots; automated capture does not establish presentation readiness.'};
  }
  async controls(){
    const p=this.page;await this.gotoPane('editions');const edition=this.o.editions[0],editionRow=p.locator('#edition-rows tr').filter({hasText:edition.id.slice(0,12)});need(await editionRow.count()===1,'HIVE_BROWSER_EDITION','Select the exact saved original edition.');await editionRow.getByRole('button',{name:'Open files',exact:true}).click();await this.dialog();need(await p.locator('#detail-body a').count()===edition.files.length,'HIVE_BROWSER_EDITION','The file browser omits an original edition member.');const first=edition.files[0];await this.download(p.locator('#detail-body').getByRole('link',{name:first.path,exact:true}),'edition-'+first.path.replace(/[^A-Za-z0-9._-]/g,'_'),first);await this.closeDialog();
    await this.gotoPane('programme');
    for(const programme of this.o.programmes){await p.locator('#result-programme').selectOption(programme.id);const row=p.locator('#result-rows tr').first();await this.download(row.getByRole('link',{name:'Download body',exact:true}),programme.phase+'-'+programme.rows[0].id+'.json',programme.rows[0].body);await row.getByRole('button',{name:'HTTP and request',exact:true}).click();await this.dialog();const record=JSON.parse(await p.locator('#detail-body').innerText());need(record.id===programme.rows[0].id&&same(record.response.body,programme.rows[0].body),'HIVE_BROWSER_REQUEST','The complete HTTP request record differs.');await this.closeDialog();}
    const baseline=this.o.programmes.find(x=>x.phase==='initial'),rollback=this.o.programmes.find(x=>x.phase==='rollback');await p.locator('#compare-baseline').selectOption(baseline.id);await p.locator('#compare-candidate').selectOption(rollback.id);await p.locator('#compare-form button').click();await p.locator('#comparison-view details').first().waitFor();need(await p.locator('#comparison-view details').count()===20,'HIVE_BROWSER_COMPARISON','The full existing rollback comparison omits operations.');await p.locator('#comparison-view details').first().locator('summary').click();await this.shot('full-rollback-comparison');
    await this.gotoPane('delivery');await p.locator('#verify-workspace').click();await this.dialog();const verification=JSON.parse(await p.locator('#detail-body').innerText());need(verification.id===this.o.workspaceId&&verification.verified===true,'HIVE_BROWSER_WORKSPACE','The actual workspace inspection failed.');await this.closeDialog();
    await p.locator('#receive-form [name="destination"]').fill(this.o.receivingDirectory);await p.locator('#receive-form [name="archive"]').fill(this.o.archive.path+'.unselected-missing');await p.locator('#receive-form [value="inspect"]').click();await p.waitForFunction(()=>document.querySelector('#status')?.classList.contains('error'));await this.shot('delivery-error');
    await p.locator('#receive-form [name="archive"]').fill(this.o.archive.path);await p.locator('#receive-form [value="inspect"]').click();await p.waitForFunction(()=>document.querySelector('#status')?.textContent==='Complete receiving edition inspected.');let result=JSON.parse(await p.locator('#receive-result pre').innerText());need(result.verified===true&&result.sha256===this.o.archive.sha256&&result.bytes===this.o.archive.bytes,'HIVE_BROWSER_ARCHIVE','The rendered archive inspection does not bind the complete original ZIP.');await this.record('archive-inspection.json',result);
    await p.locator('#receive-form [value="compare"]').click();await p.waitForFunction(()=>document.querySelector('#receive-result pre')?.textContent.includes('"relation"'));result=JSON.parse(await p.locator('#receive-result pre').innerText());need(['identical','current-forward','incoming-forward'].includes(result.relation),'HIVE_BROWSER_HISTORY','The actual archive lost its original shared history.');await this.record('archive-comparison.json',result);await p.locator('#receive-result summary').click();await this.shot('delivery-recovered');
    return{downloadedCompleteResponses:3,reviewControls:true,comparisonOperations:20,workspaceVerified:true,archiveInspected:true,errorRecovered:true};
  }
  async execute(){
    this.assertOpen();requireSelection(this.o);await privateDirectory(this.directory);this.assertOpen();this.lease=await acquireLease(this.path('browser.lock'));this.assertOpen();const selected=this.selection();
    if(await exists(this.path('browser-operation.json'))){this.state=await json(this.path('browser-operation.json'));need(same(this.state.selection,selected),'HIVE_BROWSER_SELECTION_CHANGED','Continue the same exact original browser operation.');need(this.o.resume,'HIVE_BROWSER_RESUME','Pass resume for the retained browser operation.');}
    else{this.state={schema:SCHEMA,selection:selected,createdAt:now(),state:'prepared',phases:{},files:{}};await this.persist();}
    for(const d of Object.values(this.state.files))await verify(this.path(d.path),d);
    const completedPath=await exists(this.path('browser-result.json'))?this.path('browser-result.json'):await exists(this.path('browser-candidate.json'))?this.path('browser-candidate.json'):null;
    if(completedPath){const result=await json(completedPath);need(result.schema===SCHEMA&&result.state==='complete'&&same(result.selection,selected),'HIVE_BROWSER_SELECTION_CHANGED','Retain the exact completed browser selection.');for(const d of result.files)await verify(this.path(d.path),d);await this.closeOwners();await save(this.path('browser-candidate.json'),result,{immutable:true});await save(this.path('browser-result.json'),result,{immutable:true});this.state.state='complete';this.state.result={path:'browser-result.json',...await digest(this.path('browser-result.json'))};await this.persist();return result;}
    const module=await import(pathToFileURL(this.o.playwright).href),chromium=module.chromium||module.default?.chromium;need(chromium,'HIVE_BROWSER_RUNTIME','Use the actual selected Playwright module.');
    this.assertOpen();this.browser=await chromium.launch({executablePath:this.o.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});this.assertOpen();this.context=await this.browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});this.assertOpen();this.page=await this.context.newPage();
    const errors=[];this.page.on('pageerror',e=>errors.push(e.message));
    let releaseLoading;const loading=new Promise(r=>releaseLoading=r);let intercepted=false;await this.page.route('**/api/state',async route=>{if(!intercepted){intercepted=true;await loading;}await route.continue();});
    const navigation=this.page.goto(this.o.origin,{waitUntil:'domcontentloaded'});this.tasks.add(navigation);
    try{await navigation;await this.shot('initial-loading');}finally{releaseLoading();this.tasks.delete(navigation);}
    await this.page.locator('#workspace-name').filter({hasText:/./}).waitFor();await this.page.waitForFunction(()=>!document.querySelector('#workspace-name')?.textContent.includes('Loading'));
    const initial=await this.readState();await this.validateState(initial);if(await exists(this.path('initial-state.json')))await this.retain('initial-state.json');else await this.record('initial-state.json',initial);
    this.state.state='running';await this.persist();
    await this.phase('01-review',()=>this.review());if(this.o.review){const proof=await this.reviewProof(await json(this.path('review/request.json')));need(proof.matches,'HIVE_BROWSER_REVIEW_DRIFT','The selected completed review must remain current.');}
    // Screens and read-only controls are safe to repeat within the same retained browser phase.
    await this.phase('02-screens',()=>this.screens());
    await this.phase('03-controls',()=>this.controls());
    const final=await this.readState();await this.validateState(final);await this.record('final-state.json',final);need(!errors.length,'HIVE_BROWSER_SCRIPT','The actual operator raised script errors.',{errors});
    await this.record('browser-errors.json',errors);await this.closeOwners();
    const result={schema:SCHEMA,state:'complete',selection:selected,workspaceId:final.id,revision:final.revision,completedAt:now(),phases:this.state.phases,files:Object.values(this.state.files).sort((a,b)=>a.path.localeCompare(b.path)),renderedInspection:'Screenshots captured; producing peer must inspect them and repair any actual visual issue before customer presentation.'};
    await save(this.path('browser-candidate.json'),result,{immutable:true});await save(this.path('browser-result.json'),result,{immutable:true});this.state.state='complete';this.state.result={path:'browser-result.json',...await digest(this.path('browser-result.json'))};await this.persist();return result;
  }
  run(){this.assertOpen();if(!this.running){this.running=this.execute().catch(async e=>{if(this.state){this.state.error=serialError(e);this.state.state='interrupted';try{await this.persist();}catch{}}throw e;});}return this.running;}
  async closeOwners(){await Promise.allSettled([...this.tasks]);if(this.context){await this.context.close();this.context=null;this.page=null;}if(this.browser){await this.browser.close();this.browser=null;}}
  close(){if(this.closeTask)return this.closeTask;this.closeTask=(async()=>{this.closing=true;try{if(this.running)await Promise.allSettled([this.running]);await this.closeOwners();if(this.lease){await this.lease.close();this.lease=null;}}finally{this.closeTask=null;}})();return this.closeTask;}
}
export function openHiveReceivingBrowser(options){return new HiveBrowser(options);}
