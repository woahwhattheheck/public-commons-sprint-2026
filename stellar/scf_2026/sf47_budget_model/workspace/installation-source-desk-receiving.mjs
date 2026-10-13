#!/usr/bin/env node
// Original Source Preparation Desk receiving over the maintained SF47 application.
// Business requests are made by the real browser controls. The parent Python
// programme owns the original server, kernel lease and complete child drain.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,link,unlink,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,basename,resolve,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bindingTemplate,prepareInstallation,renderWorkorder} from '../../sf49_data_commissioning/installation-workorders/prepare-core.mjs';
import {composeCustomerProgramme,programmeFiles} from '../../sf49_data_commissioning/installation-workorders/customer-programme-core.mjs';
import {receiveCustomerEditions,verifyCustomerEditions} from './installation-source-editions-receiving.mjs';

const SCHEMA='stellar-forge.installation-source-desk-receiving.v1';
const DESK_SCHEMA='stellar-forge.installation-source-desk.v1';
const MAX=192*1024*1024;
const need=(value,message)=>{if(!value)throw new Error(message);};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const stable=value=>JSON.stringify(ordered(value));
const pretty=value=>Buffer.from(JSON.stringify(ordered(value),null,2)+'\n');
const same=(a,b)=>stable(a)===stable(b);
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const cancelled={value:false};
const stop=()=>{cancelled.value=true;};
const check=()=>need(!cancelled.value,'The original browser receiving was interrupted.');
function emit(value){try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}}
function inside(root,path){const name=relative(root,path);need(name&&name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name),
  'Keep each complete receiving artifact in its original selected directory.');return name;}
async function privateDirectory(path){
  path=resolve(path);await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&!(info.mode&0o077)&&
    (!process.getuid||info.uid===process.getuid()),'Keep the original owned private receiving directory.');
  return path;
}
async function regular(path,maximum=MAX){
  path=resolve(path);const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size<=maximum,'Choose one complete bounded regular file.');
    const chunks=[];let size=0,position=0;
    while(true){const chunk=Buffer.alloc(Math.min(262144,maximum-size+1));const {bytesRead}=await handle.read(chunk,0,chunk.length,position);
      if(!bytesRead)break;position+=bytesRead;size+=bytesRead;need(size<=maximum,'The original complete file exceeds its bound.');
      chunks.push(chunk.subarray(0,bytesRead));}
    const after=await handle.stat(),named=await lstat(path);
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&
      before.ctimeMs===after.ctimeMs&&named.dev===before.dev&&named.ino===before.ino&&size===before.size,
      'The original complete file changed during its retained read.');
    return Buffer.concat(chunks,size);
  }finally{await handle.close();}
}
async function receipt(path,maximum=MAX){
  path=resolve(path);const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size<=maximum,'Choose the complete original regular file.');
    const hash=createHash('sha256');let size=0;const buffer=Buffer.alloc(262144);
    while(true){const {bytesRead}=await handle.read(buffer,0,buffer.length,size);if(!bytesRead)break;
      size+=bytesRead;need(size<=maximum,'The original file exceeds its declared bound.');hash.update(buffer.subarray(0,bytesRead));}
    const after=await handle.stat(),named=await lstat(path);
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&
      before.ctimeMs===after.ctimeMs&&named.dev===before.dev&&named.ino===before.ino&&size===before.size,
      'The original artifact changed while its complete hash was read.');
    return {path,filename:basename(path),bytes:size,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
async function sync(path){const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}}
async function retain(path,raw){
  path=resolve(path);raw=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
  if(await exists(path)){need((await regular(path)).equals(raw),'Keep the original complete receiving file: '+path);await sync(dirname(path));return receipt(path);}
  const temporary=resolve(dirname(path),'.'+basename(path)+'-'+randomUUID());
  const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  try{try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;
      need((await regular(path)).equals(raw),'The original complete file already exists with different bytes.');}
    await sync(dirname(path));
  }finally{await unlink(temporary);await sync(dirname(path));}
  need((await regular(path)).equals(raw),'The whole published output did not reopen.');return receipt(path);
}
async function replaceJSON(path,value){
  const raw=pretty(value),temporary=resolve(dirname(path),'.'+basename(path)+'-'+randomUUID());
  await retain(temporary,raw);await rename(temporary,path);await sync(dirname(path));
  need((await regular(path)).equals(raw),'The complete receiving report did not reopen.');
}
async function object(path,maximum=MAX){const value=JSON.parse((await regular(path,maximum)).toString('utf8'));
  need(value&&typeof value==='object'&&!Array.isArray(value),'Use a complete retained JSON object.');return value;}
async function verifyReceipt(selected,maximum=MAX){need(same(await receipt(selected.path,maximum),selected),
  'Keep the exact retained original file, length and SHA-256.');}
async function prepareProfile(input){
  need(input.mode==='prepare-profile'&&input.profile?.id&&input.seed&&isAbsolute(input.output),
    'Select the complete original profile and native seed.');
  const source=await regular(input.profile.path,2*1024*1024);
  need(source.length===input.profile.bytes&&sha(source)===input.profile.sha256&&
    same(JSON.parse(source),input.profile.profile),'The original installed profile changed before preparation.');
  const bindings=bindingTemplate(input.seed,input.profile.profile);
  if(input.bindings!==undefined&&input.bindings!==null){
    need(input.bindings&&typeof input.bindings==='object'&&!Array.isArray(input.bindings),
      'Keep the original optional profile bindings as a complete object.');
    for(const [key,original]of Object.entries(input.bindings)){
      need(Object.hasOwn(bindings,key),'The original selection contains an unsupported Installation binding: '+key+'.');
      if(['schema','profile','selection','workshareCaseId'].includes(key))
        need(same(bindings[key],original),'The original selection differs from this fresh Installation seed identity: '+key+'.');
      else bindings[key]=structuredClone(original);
    }
  }
  const value=prepareInstallation(input.seed,input.profile.profile,bindings);
  if(input.programmeInputs){
    const programme=composeCustomerProgramme({seed:input.seed,document:value.document,profile:input.profile.profile,...input.programmeInputs});
    value.document=structuredClone(programme.document);value.preview.document=structuredClone(programme.document);
    value.customerProgramme=programme;
  }
  const output=await retain(input.output,pretty(value));
  emit({schema:SCHEMA,mode:'prepare-profile',state:'COMPLETE',output});
  return value;
}

class BrowserReceiving{
  constructor(input,inputSha,access){
    this.input=input;this.inputSha=inputSha;this.access=access;
    this.root=resolve(input.directory);this.path=resolve(input.output);
    this.context=null;this.page=null;this.owned=new Set();this.tail=Promise.resolve();this.networkFailure=null;this.stopping=false;
    this.prefix='/api/operations/'+input.caseId;
    this.deskPrefix=this.prefix+'/installation-sources';
  }
  async initialize(){
    need(this.path===resolve(this.root,'report.json'),'Keep the original browser report path.');
    await privateDirectory(this.root);this.networkRoot=await privateDirectory(resolve(this.root,'requests'));
    this.downloadRoot=await privateDirectory(resolve(this.root,'downloads'));
    this.attempt=await privateDirectory(resolve(this.root,'attempt-'+randomUUID()));
    this.profileRoot=await privateDirectory(resolve(this.root,'profile'));
    this.url=new URL(this.access.url);
    need(this.url.protocol==='http:'&&this.url.hostname==='127.0.0.1'&&this.url.port&&!this.url.username&&!this.url.password&&
      !this.url.search&&!this.url.hash&&['','/'].includes(this.url.pathname)&&/^[A-Za-z0-9_-]{32,128}$/.test(this.access.token),
      'Use the original private SF47 loopback listener and access key.');
    const selection={operationId:this.input.operationId,caseId:this.input.caseId,planId:this.input.planId,
      inputSha256:this.inputSha,selectionSha256:this.input.selectionSha256,origin:this.url.origin,
      runtime:this.input.runtime,workspace:this.input.workspace};
    const selectedPath=resolve(this.root,'browser-selection.json');
    await retain(selectedPath,pretty(selection));
    this.report=await exists(this.path)?await object(this.path):{
      schema:SCHEMA,state:'RUNNING',lifetimes:'OPEN',...selection,phases:{},artifacts:{},requests:{},captures:{},installations:[],browserDraftId:null};
    need(this.report.schema===SCHEMA&&Object.entries(selection).every(([key,value])=>same(this.report[key],value)),
      'Keep the original browser operation, full source, runtime and local origin.');
    if(await exists(this.path))await retain(resolve(this.attempt,'prior-browser-report.json'),await regular(this.path));
    for(const selected of Object.values(this.report.artifacts))await verifyReceipt(selected);
    for(const [name,selected]of Object.entries(this.input.runtime))await verifyReceipt(selected,300*1024*1024);
    for(const original of Object.values(this.input.originalFiles))await verifyReceipt(original.receipt,8*1024*1024);
    await this.remember(selectedPath);await this.save();
  }
  async remember(path){
    path=resolve(path);const key=inside(this.root,path),value=await receipt(path),prior=this.report.artifacts[key];
    need(!prior||same(prior,value),'A complete original browser artifact changed.');
    this.report.artifacts[key]=value;return value;
  }
  save(){const snapshot=structuredClone(this.report);
    const pending=this.tail.catch(()=>{}).then(()=>replaceJSON(this.path,snapshot));this.tail=pending;return pending;}
  own(promise){this.owned.add(promise);promise.then(()=>this.owned.delete(promise),()=>this.owned.delete(promise));return promise;}
  async api(path){
    need(path.startsWith(this.prefix)||path==='/api/operations/installation-source-profiles',
      'Read only the original selected case or installed profile catalogue.');
    const response=await fetch(new URL(path,this.url),{headers:{authorization:'Bearer '+this.access.token},
      signal:AbortSignal.timeout(60000)});
    const raw=Buffer.from(await response.arrayBuffer());need(raw.length<=32*1024*1024,'The complete native read exceeded its limit.');
    let value;try{value=JSON.parse(raw);}catch{throw new Error('The original native response was not complete JSON.');}
    if(!response.ok)throw Object.assign(new Error(value.error?.message||'The original native read failed.'),{status:response.status,code:value.error?.code});
    return value;
  }
  async draft(){need(this.report.browserDraftId,'Retain the original browser-created source identity first.');
    return this.api(this.deskPrefix+'/'+this.report.browserDraftId);}
  async stage(name,action){
    check();if(this.networkFailure)throw this.networkFailure;
    if(this.report.phases[name])return this.report.phases[name];
    const value=await action();await this.rememberSession();this.report.phases[name]=value??{complete:true};await this.save();
    emit({schema:SCHEMA,operationId:this.input.operationId,phase:name,state:'COMPLETE'});return value;
  }
  async network(route){
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==this.url.origin){await route.abort('blockedbyclient');return;}
    if(this.stopping){await route.abort('aborted');return;}
    if(request.method()!=='POST'){await route.continue();return;}
    let body;try{body=request.postDataJSON();}catch{await route.continue();return;}
    if(!body?.requestId){await route.continue();return;}
    need(url.pathname===this.prefix+'/command'||url.pathname.startsWith(this.deskPrefix+'/'),
      'Keep each browser business request on its original native case.');
    const entry={method:request.method(),path:url.pathname,body};
    const key=sha(Buffer.from(body.requestId)),requestPath=resolve(this.networkRoot,key+'.request.json');
    await retain(requestPath,pretty(entry));await this.remember(requestPath);
    const earlier=this.report.requests[body.requestId];
    need(!earlier||earlier.requestSha256===sha(pretty(entry)),'A browser retry changed its original complete request.');
    this.report.requests[body.requestId]={...earlier,requestSha256:sha(pretty(entry)),requestPath,state:earlier?.state||'PENDING'};
    if(body.action==='create'&&url.pathname.startsWith(this.deskPrefix+'/')){
      const id=url.pathname.slice(this.deskPrefix.length+1);
      need(/^source-desk-[a-f0-9]{32}$/.test(id)&&(!this.report.browserDraftId||this.report.browserDraftId===id),
        'Keep the first browser-created preparation identity.');
      this.report.browserDraftId=id;
    }
    await this.rememberSession();await this.save();
    const response=await route.fetch({timeout:0});
    try{
      const raw=await response.body();need(raw.length<=16*1024*1024,'The complete original browser receipt exceeds its native bound.');
      let value;try{value=JSON.parse(raw);}catch{throw new Error('The original browser receipt was interrupted.');}
      const responsePath=resolve(this.networkRoot,key+'.response-'+sha(raw)+'.json');
      await retain(responsePath,raw);await this.remember(responsePath);
      const record=this.report.requests[body.requestId];
      if(record.result&&response.ok())need(same(record.result,value),'Same-request browser replay returned another native receipt.');
      record.responses??=[];if(!record.responses.some(x=>x.path===responsePath))record.responses.push({path:responsePath,status:response.status(),sha256:sha(raw),bytes:raw.length});
      if(response.ok()){record.state='RECORDED';record.result=value;record.resultSha256=sha(Buffer.from(stable(value)));}
      else{record.state='REJECTED';record.error=value;}
      const faultKey=body.action==='selection.save'?'fault':body.action==='edition.apply'?'editionFault':null;
      const withhold=faultKey&&this.report[faultKey]?.state==='ARMED';
      if(withhold){need(response.ok(),'The original selected request must commit before its response is deliberately interrupted.');
        this.report[faultKey]={...this.report[faultKey],state:'RESPONSE_WITHHELD',requestId:body.requestId,responsePath};}
      await this.save();
      if(withhold)await route.abort('failed');else await route.fulfill({response,body:raw});
    }finally{await response.dispose();}
  }
  async launch(){
    const imported=await import(pathToFileURL(this.input.runtime.playwright.path).href);
    const chromium=imported.chromium??imported.default?.chromium;need(chromium,'Use the selected original Playwright Chromium provider.');
    this.context=await chromium.launchPersistentContext(this.profileRoot,{
      executablePath:this.input.runtime.chromium.path,headless:true,acceptDownloads:true,
      downloadsPath:resolve(this.attempt,'browser-downloads'),viewport:{width:1440,height:1000},
      serviceWorkers:'block',args:['--disable-features=FileSystemAccessLocal'],timeout:60000,
      env:{...process.env,TMPDIR:await privateDirectory(resolve(this.root,'tmp'))}});
    this.context.setDefaultTimeout(30000);
    await this.context.route('**/*',route=>{
      const task=this.network(route).catch(async error=>{this.networkFailure??=error;try{await route.abort('failed');}catch{}throw error;});
      this.own(task).catch(()=>{});return task;
    });
    if(this.report.sessionSnapshot){
      await verifyReceipt(this.report.sessionSnapshot);
      const original=await object(this.report.sessionSnapshot.path,32*1024*1024);
      need(original.origin===this.url.origin&&original.operationId===this.input.operationId,
        'Keep the browser session attached to its original saved operation and origin.');
      await this.context.addInitScript(value=>{
        const marker='installation-receiving-restored-'+value.attempt;
        if(location.origin===value.origin&&!sessionStorage.getItem(marker)){
          for(const [key,text]of Object.entries(value.values))sessionStorage.setItem(key,text);
          sessionStorage.setItem(marker,'yes');
        }
      },{...original,attempt:basename(this.attempt)});
    }
    this.page=this.context.pages()[0]??await this.context.newPage();
    this.page.on('dialog',dialog=>{
      const allowed=dialog.type()==='confirm'&&this.confirmation===dialog.message();
      this.own(allowed?dialog.accept():dialog.dismiss()).catch(()=>{});
    });
    this.page.on('pageerror',error=>{this.report.pageErrors??=[];this.report.pageErrors.push({name:error.name,message:error.message});});
    await this.page.goto(this.url.origin+'/#access='+this.access.token,{waitUntil:'domcontentloaded'});
    await this.navigate();
  }
  async navigate(){
    await this.page.locator('#workbench').waitFor({state:'visible'});
    const plans=this.page.locator('#plan-select');
    if(await plans.inputValue()!==this.input.planId)await plans.selectOption(this.input.planId);
    await this.page.locator('[data-tab="operations"]').click();
    const cases=this.page.locator('select[name="caseSelect"]');await cases.waitFor({state:'visible'});
    if(await cases.inputValue()!==this.input.caseId)await cases.selectOption(this.input.caseId);
    need(await cases.inputValue()===this.input.caseId,'The browser opened a different original operating case.');
    await this.page.locator('input[name="recordingActor"]').fill(this.input.actor);
    await this.page.waitForFunction(()=>document.querySelector('.operations')?.getAttribute('aria-busy')!=='true');
    const navigation=this.page.locator('[data-ops-navigation]');
    await navigation.waitFor({state:'visible'});
    const toggle=navigation.locator('[data-nav-toggle]');
    if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
    const group=navigation.locator('details[data-nav-group]:has([data-nav-section="installations"])');
    need(await group.count()===1,'Keep the original Installation section in its current navigation group.');
    if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
    await group.locator('[data-nav-section="installations"]').click();
    const recovery=this.page.locator('[data-installation-action="recover"]');
    if(await recovery.count()){
      const retained=await this.installationSession();
      const original=retained.pending?.body??retained.accepted?.pending?.body;
      need(original?.requestId&&this.report.requests[original.requestId],
        'Keep an unrelated original Installation request with its existing owner.');
      await recovery.click();await recovery.waitFor({state:'hidden'});
    }
    await this.page.locator('[data-installation-action="source-open"]').click();
    await this.page.locator('[data-source-new-title]').waitFor({state:'visible'});
    await this.idle();
    if(this.report.browserDraftId){
      await this.recoverWorkingCopy();
      await this.recoverPending();
      const selected=this.page.locator('[data-source-action="draft-open"][data-id="'+this.report.browserDraftId+'"]');
      if(await selected.count()&&await selected.getAttribute('aria-current')!=='page'){await selected.click();await this.idle();}
    }
  }
  async idle(){
    await this.page.waitForFunction(()=>{
      const root=document.querySelector('[data-source-status]')?.parentElement;
      return root&&root.getAttribute('aria-busy')!=='true';
    });
    if(this.networkFailure)throw this.networkFailure;
  }
  async click(action,attributes=''){
    check();await this.page.locator('[data-source-action="'+action+'"]'+attributes).click();await this.idle();
  }
  async tab(name){await this.click('tab','[data-tab="'+name+'"]');}
  async field(name,value){const node=this.page.locator('[data-source-field="'+name+'"]');
    if(await node.evaluate(el=>el.tagName)==='SELECT')await node.selectOption(String(value??''));else await node.fill(String(value??''));}
  async adoptPendingSourceRequest(active,{legacy=false}={}){
    if(active.pendingId&&this.report.requests[active.pendingId])return;
    const planPin=this.report.customerEditions?.plan;
    if(!active.pendingId&&(legacy||!planPin||!this.report.phases['11-explicit-successor-and-unfinished-working-reopen']))return;
    const wanted=!this.report.phases['12-original-edition-apply-and-request-recovery']?
      {action:'edition.apply',revision:planPin?.target.revision}:
      !this.report.phases['13-successor-native-preparation-and-complete-downloads']?
        {action:'prepare',revision:this.report.customerEditions?.transition?.draftRevision}:null;
    if(!active.pendingId&&!wanted)return;
    need(active.draftId===this.report.browserDraftId&&active.scope?.caseId===this.input.caseId&&
      active.scope.planId===this.input.planId,'Keep an unobserved request in this original source draft and case.');
    const original=await this.page.evaluate(async selected=>{
      const staff=await import('/staff-session.mjs'),context=staff.currentStaffContext();
      const base=selected.scope.caseId+':'+selected.scope.planId+':'+selected.scope.createdAt;
      const key=selected.legacy?base:staff.staffDeskStorageKey(base,context);
      return new Promise((resolveResult,reject)=>{
        let failed=false;const fail=error=>{failed=true;reject(error);};
        const opening=indexedDB.open('sf47.installation-source-desk',1);
        opening.onupgradeneeded=()=>{opening.transaction.abort();fail(new Error('Keep the original private source journal.'));};
        opening.onerror=()=>fail(opening.error||new Error('The original source journal could not reopen.'));
        opening.onblocked=()=>fail(new Error('The original source journal is busy.'));
        opening.onsuccess=()=>{
          const db=opening.result;if(failed){db.close();return;}let copy=null,request=null,problem=null;const candidates=[];
          const tx=db.transaction('records','readonly'),store=tx.objectStore('records');
          const a=store.get(key+':'+(selected.legacy?'working':'copy:'+selected.copyId));
          const prefix=key+':request:';
          const b=selected.pendingId?store.get(prefix+selected.pendingId):
            store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
          a.onsuccess=()=>{copy=a.result;};
          b.onsuccess=()=>{if(selected.pendingId)request=b.result;else{
            const cursor=b.result;if(cursor){candidates.push(cursor.value);cursor.continue();}
          }};
          for(const read of [a,b])read.onerror=()=>{problem=read.error;tx.abort();};
          tx.oncomplete=()=>{db.close();resolveResult({journalKey:key,staffContext:context,copy,request,candidates});};
          tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('The complete original request read failed.'));};
          tx.onerror=()=>{};
        };
      });
    },{...active,legacy});
    const copy=original.copy,state=legacy?copy:copy?.state,orphan=!active.pendingId;
    if(orphan){
      const candidates=original.candidates.filter(value=>value?.schema===DESK_SCHEMA&&
        value.caseId===this.input.caseId&&value.draftId===active.draftId&&value.body?.actor===this.input.actor&&
        value.body.action===wanted.action&&value.body.expectedRevision===wanted.revision&&value.state!=='REJECTED'&&
        !(copy?.requests||[]).some(saved=>saved.body?.requestId===value.body.requestId&&
          same(saved.body,value.body)&&saved.requestSha256===value.requestSha256&&saved.receipt));
      need(candidates.length<=1,'Preserve the ambiguous original journal requests without selecting a replacement UUID.');
      if(!candidates.length)return;
      original.request=candidates[0];
    }
    const request=original.request,body=request?.body,pendingId=orphan?body?.requestId:active.pendingId;
    need(copy?.schema===DESK_SCHEMA&&same(copy.scope,active.scope)&&
      state?.draftId===active.draftId&&(orphan?!state.pendingId:state.pendingId===active.pendingId)&&
      (legacy||copy.workingCopySchema==='stellar-forge.installation-source-working-copy.v1'&&
        copy.copyId===active.copyId&&copy.sourceDraftId===active.draftId),
      'The private retained copy differs from the actual original pending editor.');
    need(request?.schema===DESK_SCHEMA&&request.caseId===this.input.caseId&&request.draftId===active.draftId&&
      body?.requestId===pendingId&&/^source-[a-f0-9-]{36}$/.test(body.requestId)&&
      same(Object.keys(body).sort(),['action','actor','data','expectedRevision','note','requestId'])&&
      body.actor===this.input.actor&&typeof body.note==='string'&&body.note===state.note&&
      Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>0&&
      request.requestSha256===sha(Buffer.from(stable({schema:DESK_SCHEMA,caseId:request.caseId,
        draftId:request.draftId,body}))),
      'Preserve the exact original request UUID, case, draft, operator, note, revision and full body hash.');
    if(original.staffContext?.staffId&&original.staffContext.staffId!=='owner')
      need(original.staffContext.actor===body.actor,'Recover with the original staff actor.');
    if(!legacy){
      need(same(copy.staffContext,original.staffContext)&&Array.isArray(copy.requests)&&
        (orphan||copy.pendingRequest?.body?.requestId===body.requestId&&same(copy.pendingRequest.body,body)&&
          copy.pendingRequest.requestSha256===request.requestSha256&&copy.requests.some(x=>x.body?.requestId===body.requestId&&
            same(x.body,body)&&x.requestSha256===request.requestSha256)),
        'Keep the same private staff copy and its complete original pending request.');
    }
    const pins=this.report.customerEditions,plan=pins?.plan;
    need(plan?.caseId===this.input.caseId&&plan.target?.draftId===active.draftId&&
      this.report.phases['11-explicit-successor-and-unfinished-working-reopen']?.planSha256===plan.sha256&&
      same(state.editionWork?.plan,plan)&&same(plan.selection,this.input.sourceSelection),
      'Only this course’s frozen complete customer-edition plan can adopt an unobserved request.');
    need(!(await this.requests(body.action)).some(x=>x.requestId!==body.requestId&&
        (body.action!=='prepare'||x.entry.body.expectedRevision===body.expectedRevision)),
      'Keep the already observed original request instead of adopting another UUID.');
    if(body.action==='edition.apply'){
      need(same(body.data,{plan})&&body.expectedRevision===plan.target.revision&&
        this.report.editionFault?.state==='ARMED'&&!this.report.editionFault.requestId&&
        !this.report.phases['12-original-edition-apply-and-request-recovery'],
        'Keep the exact original armed successor request and its frozen target revision.');
    }else if(body.action==='prepare'){
      const transition=pins.transition,accepted=this.report.phases['12-original-edition-apply-and-request-recovery'];
      need(transition&&same(accepted?.transition,transition)&&accepted.requestId===pins.requestId&&
        same(state.editionWork?.applied,transition)&&body.expectedRevision===transition.draftRevision&&
        !this.report.phases['13-successor-native-preparation-and-complete-downloads'],
        'Prepare only the original accepted successor and its exact native revision.');
      const historical=await this.api(this.deskPrefix+'/'+active.draftId+'?revision='+transition.draftRevision);
      need(historical.id===active.draftId&&historical.caseId===this.input.caseId&&
        historical.revision===transition.draftRevision&&same(historical.selection,plan.selection)&&
        same(historical.files,plan.resultFiles)&&historical.editionTransitions.some(x=>same(x,transition)),
        'The complete accepted successor changed before its original native preparation.');
      const catalogue=await this.api('/api/operations/installation-source-profiles'),profiles={};
      for(const selected of plan.selection.cases){
        const profile=catalogue.profiles.find(x=>x.id===selected.profile);
        need(profile?.sha256,'Keep every original installed customer profile.');profiles[profile.id]=profile.sha256;
      }
      const engine=catalogue.sourceFormats?.find(x=>x.schema===plan.selection.schema)?.engine??
        (plan.selection.schema==='stellar-forge.installation-source-selection.v1'?catalogue.engine:null);
      need(engine?.sha256&&same(body.data,{expectedEngineSha256:engine.sha256,
        expectedSelectionSha256:sha(Buffer.from(stable(plan.selection))),expectedProfiles:profiles}),
        'The original preparation must retain the current installed engine, complete selection and every profile pin.');
    }else throw new Error('Keep other unobserved source actions with their original receiving owner.');
    const value={schema:'stellar-forge.installation-source-journal-adoption.v1',operationId:this.input.operationId,
      scope:active.scope,copyId:legacy?null:active.copyId,legacy,...original};
    const evidenceRaw=pretty(value),evidencePath=resolve(this.networkRoot,'journal-before-post-'+sha(evidenceRaw)+'.json');
    await retain(evidencePath,evidenceRaw);const evidence=await this.remember(evidencePath);
    const entry={method:'POST',path:this.deskPrefix+'/'+active.draftId,body:structuredClone(body)};
    const raw=pretty(entry),requestPath=resolve(this.networkRoot,sha(Buffer.from(body.requestId))+'.request.json');
    await retain(requestPath,raw);await this.remember(requestPath);
    const prior=this.report.requests[body.requestId];
    need(!prior||prior.requestSha256===sha(raw),'Keep the complete original request if transport observed it meanwhile.');
    this.report.requests[body.requestId]={...prior,requestSha256:sha(raw),requestPath,
      state:prior?.state||'PENDING',journalAdoption:evidence};
    await this.rememberSession();await this.save();
    if(orphan){
      // The original request can precede the pending-copy commit. Restore it
      // through the existing complete-file UI; never write the journal directly.
      const visible=await this.working('before-unobserved-request-adoption',{fresh:true});
      need(visible.copyId===active.copyId&&!visible.state?.pendingId&&visible.state?.note===body.note&&
        same(visible.state.editionWork?.plan,plan)&&visible.sourceDraftId===active.draftId,
        'Preserve any editor change made after the original journal read.');
      const incoming=structuredClone(visible),prior=incoming.requests.find(x=>x.body?.requestId===body.requestId);
      need(!prior||same(prior.body,body)&&prior.requestSha256===request.requestSha256,
        'Keep both conflicting original request copies.');
      incoming.requests=incoming.requests.filter(x=>x.body?.requestId!==body.requestId);
      incoming.requests.push(structuredClone(request));incoming.pendingRequest=structuredClone(request);
      incoming.state.pendingId=body.requestId;
      const bytes=pretty(incoming),path=resolve(this.networkRoot,'working-original-request-'+sha(bytes)+'.json');
      await retain(path,bytes);await this.remember(path);await this.save();
      await this.downloads(async()=>{
        await this.page.locator('[data-source-working-file]').setInputFiles(path);await this.idle();
      },[null],'before-original-request-'+basename(this.attempt)+'-'+randomUUID());
      const selected=await this.page.locator('[data-source-copy-id][data-source-scope]').evaluate(el=>({
        draftId:el.dataset.sourceDraftId,pendingId:el.dataset.sourcePendingId,scope:JSON.parse(el.dataset.sourceScope)}));
      need(selected.draftId===active.draftId&&selected.pendingId===body.requestId&&same(selected.scope,active.scope),
        'The original complete-file reader did not restore the retained pending request.');
      await this.rememberSession();await this.save();
    }
  }
  async recoverWorkingCopy(){
    const copy=this.page.locator('[data-source-copy-id][data-source-scope]');
    if(!await copy.count())return;
    need(await copy.count()===1,'Select the one original Source Desk working copy.');
    const active=await copy.evaluate(el=>({copyId:el.dataset.sourceCopyId,draftId:el.dataset.sourceDraftId,pendingId:el.dataset.sourcePendingId,
      scope:JSON.parse(el.dataset.sourceScope)}));
    need(active.scope?.caseId===this.input.caseId&&active.scope.planId===this.input.planId,
      'Keep the complete working copy in its original operating case and plan.');
    if(active.draftId===this.report.browserDraftId){
      await this.adoptPendingSourceRequest(active);
      need(!active.pendingId||this.report.requests[active.pendingId],
        'Keep another operator’s pending source request with its original receiving owner.');
      return;
    }
    const legacy=this.page.locator('[data-source-action="working-open-legacy"]');
    if(!await legacy.count()||await legacy.getAttribute('data-legacy-draft-id')!==this.report.browserDraftId)return;
    need(!active.pendingId||this.report.requests[active.pendingId],
      'Retain the other pending working copy with its existing receiving owner.');
    const prior=await this.page.evaluate(scope=>new Promise((resolveResult,reject)=>{
      const key=scope.caseId+':'+scope.planId+':'+scope.createdAt;
      let failed=false;const fail=error=>{failed=true;reject(error);};
      const opening=indexedDB.open('sf47.installation-source-desk',1);
      opening.onupgradeneeded=()=>{opening.transaction.abort();fail(new Error('Keep the original retained source journal.'));};
      opening.onerror=()=>fail(opening.error||new Error('The original source journal could not reopen.'));
      opening.onblocked=()=>fail(new Error('The original source journal is busy.'));
      opening.onsuccess=()=>{
        const db=opening.result;if(failed){db.close();return;}let value=null,request=null,problem=null;
        const tx=db.transaction('records','readonly'),store=tx.objectStore('records'),read=store.get(key+':working');
        read.onsuccess=()=>{value=read.result;if(value?.pendingId){
          const pending=store.get(key+':request:'+value.pendingId);pending.onsuccess=()=>{request=pending.result;};
          pending.onerror=()=>{problem=pending.error;tx.abort();};}};
        read.onerror=()=>{problem=read.error;tx.abort();};
        tx.oncomplete=()=>{db.close();resolveResult({value,request});};
        tx.onabort=()=>{db.close();reject(problem||tx.error||new Error('The complete original source journal read failed.'));};
        tx.onerror=()=>{};
      };
    }),active.scope);
    need(prior.value?.schema===DESK_SCHEMA&&same(prior.value.scope,active.scope)&&
      prior.value.draftId===this.report.browserDraftId,
      'Keep the original complete source working copy and its case identity.');
    if(prior.value.pendingId){
      await this.adoptPendingSourceRequest({draftId:prior.value.draftId,pendingId:prior.value.pendingId,scope:active.scope},{legacy:true});
      const record=this.report.requests[prior.value.pendingId],request=prior.request;
      need(record&&request?.schema===DESK_SCHEMA&&request.caseId===this.input.caseId&&
        request.draftId===this.report.browserDraftId&&request.body?.requestId===prior.value.pendingId&&
        request.requestSha256===sha(Buffer.from(stable({schema:DESK_SCHEMA,caseId:request.caseId,
          draftId:request.draftId,body:request.body}))),
        'Recover the complete original retained source request before receiving this working copy.');
      const entry=await object(record.requestPath);
      need(record.requestSha256===sha(pretty(entry))&&same(entry.body,request.body)&&
        entry.path===this.deskPrefix+'/'+request.draftId,
        'The retained source request differs from the original receiving operation.');
    }
    const raw=pretty({schema:'stellar-forge.installation-source-legacy-receiving.v1',scope:active.scope,...prior});
    need(raw.length<=MAX,'Keep the complete original legacy working-copy input within the receiving limit.');
    const source=resolve(this.networkRoot,'legacy-working-'+sha(raw)+'.json');
    await retain(source,raw);const original=await this.remember(source);
    const preceding=await this.downloads(()=>this.click('working-open-legacy'),[null],
      'working-before-legacy-'+basename(this.attempt)+'-'+randomUUID());
    const opened=await copy.evaluate(el=>({draftId:el.dataset.sourceDraftId,pendingId:el.dataset.sourcePendingId,
      scope:JSON.parse(el.dataset.sourceScope)}));
    need(opened.draftId===this.report.browserDraftId&&same(opened.scope,active.scope)&&
      (opened.pendingId||null)===(prior.value.pendingId||null),
      'Receiving must preserve the complete original draft and pending request identities.');
    this.report.workingCopyRecoveries??=[];
    this.report.workingCopyRecoveries.push({original,preceding,pendingId:prior.value.pendingId??null,
      draftId:this.report.browserDraftId,at:new Date().toISOString()});await this.save();
  }
  async recoverPending(){
    await this.recoverWorkingCopy();
    const status=this.page.locator('[data-source-action="request-status"]');
    if(!await status.count()){await this.reconcileSourceReceipts();return;}
    const unresolved=Object.values(this.report.requests).filter(x=>x.state!=='RECORDED');
    await this.click('request-status');
    if(await this.page.locator('[data-source-action="request-retry"]').count()){
      // The actual browser retains the original UUID/body. Its own exact status
      // check and original-request path control retry; this driver supplies none.
      await this.click('request-retry');
    }
    need(!await this.page.locator('[data-source-action="request-status"]').count(),
      'Retain the original browser request and its native error before continuing.');
    await this.reconcileSourceReceipts();
    this.report.reconciliations??=[];this.report.reconciliations.push({priorUnresolved:unresolved.length,at:new Date().toISOString()});await this.save();
  }
  async reconcileSourceReceipts(){
    for(const [requestId,record]of Object.entries(this.report.requests)){
      if(record.state==='RECORDED')continue;
      const entry=await object(record.requestPath);
      if(!entry.path.startsWith(this.deskPrefix+'/'))continue;
      const status=await this.api(entry.path+'/requests/'+encodeURIComponent(requestId));
      if(status.state!=='RECORDED')continue;
      const draftId=entry.path.slice(this.deskPrefix.length+1),value=status.result;
      need(value.requestId===requestId&&value.requestSha256===sha(Buffer.from(stable({
        schema:DESK_SCHEMA,caseId:this.input.caseId,draftId,body:entry.body})))&&value.draft?.id===draftId,
        'The recovered native status belongs to another complete original request.');
      const path=resolve(this.networkRoot,sha(Buffer.from(requestId))+'.reconciled-'+sha(pretty(status))+'.json');
      await retain(path,pretty(status));await this.remember(path);
      record.state='RECORDED';record.result=value;record.resultSha256=sha(Buffer.from(stable(value)));
      record.reconciliation={path,sha256:sha(pretty(status)),bytes:pretty(status).length};
      const faultKey=entry.body.action==='selection.save'?'fault':entry.body.action==='edition.apply'?'editionFault':null;
      if(faultKey&&this.report[faultKey]?.state==='ARMED'){
        need(!record.responses?.length,'Preserve the actually observed earlier response.');
        this.report[faultKey]={...this.report[faultKey],state:'ORIGINAL_RESPONSE_LOST',requestId,reconciliationPath:path};
      }
    }
    await this.save();
  }
  async capture(label){
    if(this.report.captures[label]){
      for(const value of this.report.captures[label])await verifyReceipt(value);return this.report.captures[label];
    }
    const values=[];
    for(const [name,width]of [['desktop',1440],['phone',390]]){
      await this.page.setViewportSize({width,height:1000});
      const path=resolve(this.attempt,label+'-'+name+'.png');await this.page.screenshot({path,fullPage:true});
      values.push(await this.remember(path));
    }
    await this.page.setViewportSize({width:1440,height:1000});
    this.report.captures[label]=values;await this.save();return values;
  }
  async rememberSession(){
    if(!this.page||this.page.isClosed()||new URL(this.page.url()).origin!==this.url.origin)return;
    const values=await this.page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage)
      .filter(key=>key.startsWith('sf47.')&&key!=='sf47.access').map(key=>[key,sessionStorage.getItem(key)])));
    const raw=pretty({origin:this.url.origin,operationId:this.input.operationId,values});
    need(raw.length<=32*1024*1024,'The complete original browser session exceeds its retained bound.');
    const path=resolve(this.networkRoot,'session-'+sha(raw)+'.json');await retain(path,raw);
    this.report.sessionSnapshot=await this.remember(path);
  }
  async readDownload(download,expected,label){
    const problem=await download.failure();need(!problem,'The actual browser download failed: '+problem);
    const name=download.suggestedFilename();
    need(!expected?.filename||expected.filename===name,'The actual browser download changed its original filename.');
    const directory=await privateDirectory(resolve(this.downloadRoot,label));
    need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,249}$/.test(name),'Keep the original bounded download filename.');
    const destination=resolve(directory,name),temporary=resolve(directory,'.'+name+'-'+randomUUID());
    let stream=null,handle=null,total=0;const digest=createHash('sha256');
    try{
      stream=await download.createReadStream();need(stream,'The original complete download stream is unavailable.');
      handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      for await(const raw of stream){total+=raw.length;need(total<=(expected?.bytes??MAX),'The download exceeds the original full length.');
        digest.update(raw);await handle.writeFile(raw);}
      const checksum=digest.digest('hex');
      need(!expected||total===expected.bytes&&checksum===expected.sha256,'The complete downloaded bytes differ from their native receipt.');
      await handle.sync();await handle.close();handle=null;
      if(await exists(destination)){const old=await receipt(destination);need(old.bytes===total&&old.sha256===checksum,
        'Keep the earlier complete downloaded artifact.');}
      else{await link(temporary,destination);await sync(directory);}
      const value=await this.remember(destination);need(value.bytes===total&&value.sha256===checksum,'The complete download did not reopen.');
      await this.save();return value;
    }finally{
      if(stream)stream.destroy();
      if(handle)await handle.close();
      if(await exists(temporary)){await unlink(temporary);await sync(directory);}
      await download.delete();
    }
  }
  async downloads(click,expected,label){
    need(Array.isArray(expected)&&expected.length>0,'Select the complete expected download set.');
    const unnamed=expected.length===1&&expected[0]===null;
    const remaining=new Map(unnamed?[]:expected.map(value=>[value?.filename,value]));
    need(unnamed||remaining.size===expected.length&&[...remaining.keys()].every(value=>typeof value==='string'&&value.length),
      'Each expected complete download needs its own distinct original filename.');
    const count=expected.length,arrived=[];let done=false,resolveEvent,rejectEvent,timer,problem=null;
    const waiting=new Promise((resolveResult,reject)=>{resolveEvent=resolveResult;rejectEvent=reject;});
    const receive=download=>{
      try{
        const name=download.suggestedFilename();
        need(arrived.length<count,'The browser returned an extra download outside the selected complete set.');
        need(unnamed||remaining.has(name),'The browser repeated or changed an expected download filename.');
        const match=unnamed?null:remaining.get(name);if(!unnamed)remaining.delete(name);
        arrived.push({download,match});
        if(arrived.length===count){done=true;resolveEvent(arrived);}
      }catch(error){problem??=error;rejectEvent(error);}
    };
    this.page.on('download',receive);timer=setTimeout(()=>rejectEvent(new Error('The complete original browser download did not arrive.')),60000);
    try{
      const [downloads]=await Promise.all([waiting,Promise.resolve().then(click)]);
      const result=[];
      for(const {download,match}of downloads)result.push(await this.readDownload(download,match,label));
      if(problem)throw problem;
      need(downloads.length===count&&remaining.size===0,'The browser did not return every selected complete download.');
      return result;
    }finally{
      this.page.off('download',receive);clearTimeout(timer);if(!done)rejectEvent(new Error('The original download observation was closed.'));
    }
  }

  async confirmClick(action,message,attributes=''){
    need(!this.confirmation,'Finish the original explicit browser confirmation first.');
    this.confirmation=message;
    try{return await this.click(action,attributes);}finally{this.confirmation=null;}
  }
  async details(summary){const value=this.page.locator('details').filter({has:this.page.locator('summary').filter({hasText:summary})}).first();
    if(!await value.evaluate(el=>el.open))await value.locator('summary').first().click();}
  async installationSession(){return this.page.evaluate(key=>{
    const value=sessionStorage.getItem(key);return value?JSON.parse(value):{};
  },'sf47.installations.'+this.input.caseId);}
  async nativeIdle(){await this.page.waitForFunction(()=>{
    const value=document.querySelector('[data-installation-editor]')?.closest('[aria-busy]')??document.querySelector('.installation-desk');
    return !value||value.getAttribute('aria-busy')!=='true';
  });if(this.networkFailure)throw this.networkFailure;}
  async working(label,{fresh=false}={}){
    if(fresh)label+='-'+basename(this.attempt)+'-'+randomUUID();
    this.report.workingSnapshots??={};
    if(this.report.workingSnapshots[label]){
      await verifyReceipt(this.report.workingSnapshots[label]);
      return object(this.report.workingSnapshots[label].path);
    }
    const [file]=await this.downloads(()=>this.click('working-download'),[null],label+'-'+basename(this.attempt));
    const value=await object(file.path);
    need(value.sourceDraftId===this.report.browserDraftId&&value.scope?.caseId===this.input.caseId&&
      value.scope.planId===this.input.planId,'The complete working download belongs to another original source desk.');
    this.report.workingSnapshots[label]=file;await this.save();return value;
  }
  async requests(action){
    const result=[];
    for(const [requestId,record]of Object.entries(this.report.requests)){
      const entry=await object(record.requestPath);
      need(entry.body.requestId===requestId&&sha(pretty(entry))===record.requestSha256,
        'The retained browser request changed its full original body.');
      if(entry.body.action===action)result.push({requestId,record,entry});
    }
    return result;
  }
  async currentPreparation(){
    const draft=await this.draft();
    need(draft.preparations.length===1,'Keep the original single full browser preparation and its request.');
    const row=draft.preparations[0];
    const value=await this.api(this.deskPrefix+'/'+draft.id+'/preparations/'+row.id);
    need(value.caseId===this.input.caseId&&value.draftId===draft.id&&value.id===row.id,
      'The actual complete preparation belongs to a different source selection.');
    const expected=this.input.sourceSelection.cases;
    need(value.report.cases.length===expected.length,'The browser preparation omitted an original customer.');
    for(const selected of expected){
      const received=value.report.cases.find(x=>x.caseId===selected.caseId);
      need(received?.planSha256===selected.planSha256&&received.profile===selected.profile&&
        String(received.completeEffort.hours)===String(selected.effortTotal.hours),
        'The complete browser preparation changed original scope, effort or customer profile.');
    }
    return value;
  }
  async checkFiles(){
    const draft=await this.draft(),originals=Object.entries(this.input.originalFiles);
    need(draft.files.length===originals.length,'The browser source draft does not contain the complete original cohort.');
    for(const [name,input]of originals){
      const row=draft.files.find(x=>x.filename===name),selected=input.selection;
      need(row&&row.sha256===input.receipt.sha256&&row.bytes===input.receipt.bytes&&
        row.sourceUrl===selected.sourceUrl&&row.observedAt===selected.observedAt&&
        row.mediaType===(selected.mediaType??'application/json'),
        'The actual browser upload changed its full original bytes or provenance.');
    }
    return draft;
  }
  async create(){
    if(!this.report.browserDraftId){
      await this.page.locator('[data-source-new-title]').fill('Original customer source handover · '+this.input.operationId);
      await this.click('new');await this.recoverPending();
    }
    const draft=await this.draft();
    need(draft.caseId===this.input.caseId&&draft.id===this.report.browserDraftId,
      'Retain the first browser-created source preparation.');
    await this.capture('01-source-desk');
    return {draftId:draft.id,revision:draft.revision};
  }
  async uploads(){
    await this.tab('files');
    for(const [name,input]of Object.entries(this.input.originalFiles)){
      const current=await this.draft(),selected=input.selection;
      const existing=current.files.find(x=>x.filename===name);
      if(existing){need(existing.sha256===input.receipt.sha256&&existing.bytes===input.receipt.bytes&&
          existing.sourceUrl===selected.sourceUrl&&existing.observedAt===selected.observedAt&&
          existing.mediaType===(selected.mediaType??'application/json'),'Keep the original already-uploaded full input.');continue;}
      await this.page.locator('[data-source-upload]').setInputFiles(input.receipt.path);
      await this.field('upload.filename',name);
      await this.field('upload.mediaType',selected.mediaType??'application/json');
      await this.field('upload.sourceUrl',selected.sourceUrl);
      await this.field('upload.observedAt',selected.observedAt);
      await this.click('upload');await this.recoverPending();
      const after=await this.draft();
      need(after.files.some(x=>x.filename===name&&x.sha256===input.receipt.sha256&&x.bytes===input.receipt.bytes),
        'The full original file did not reach the native source draft.');
    }
    const current=await this.checkFiles();
    const first=current.files[0];
    await this.downloads(()=>this.click('file-download','[data-id="'+first.id+'"]'),[first],'original-input');
    for(const selected of this.input.sourceSelection.cases){
      const original=selected.handover??selected.packet;
      const file=current.files.find(x=>x.filename===original.filename);
      await this.click('inspect','[data-id="'+file.id+'"]');
      await this.details('Complete original JSON, unchanged');
      const displayed=await this.page.locator('.source-desk-inspection details').filter({
        has:this.page.locator('summary').filter({hasText:'Complete original JSON, unchanged'})}).locator('pre').textContent();
      need(sha(Buffer.from(displayed))===file.sha256,'The inspection did not display the entire original JSON.');
      await this.capture('02-original-'+selected.caseId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,90));
      await this.click('inspect-close');
    }
    await this.capture('02-complete-files');return {files:current.files};
  }
  async selection(){
    await this.tab('mapping');
    const draft=await this.draft();
    if(draft.selection===null){
      await this.details('Complete editable native source selection');
      await this.field('work.selectionText',JSON.stringify(this.input.sourceSelection,null,2)+'\n');
      // Each guided row opens the actual complete original phase inspection,
      // including the explicitly selected phase-ID amendment where present.
      for(const [index,selected]of this.input.sourceSelection.cases.entries()){
        await this.click('case-edit','[data-index="'+index+'"]');
        const snapshot=await this.working('mapping-'+index);
        const form=snapshot.caseForm;
        need(form?.packet?.caseId===selected.caseId&&form.packet.planSha256===selected.planSha256&&
          form.phaseRows.length===selected.productionEffort.length&&
          form.phaseRows.every(x=>selected.productionEffort.some(y=>y.phaseId===x.phaseId&&String(y.hours)===String(x.hours))),
          'The complete guided mapping changed the selected original customer or phase effort.');
        await this.capture('03-complete-mapping-'+index);
        await this.confirmClick('case-cancel','Keep the complete saved selection and replace these unsaved mapping fields?');
        need(!await this.page.locator('[data-source-field="caseForm.caseId"]').count(),
          'Close the original read-only mapping review before saving its complete selection.');
      }
      this.report.fault??={state:'ARMED',kind:'selection-response-after-native-commit'};
      need(this.report.fault.state==='ARMED','Recover the original selection request before another save.');
      await this.save();await this.click('save-selection');
      need(this.report.fault.state==='RESPONSE_WITHHELD',
        'The actual original save response was not captured before its interruption.');
      await this.capture('04-original-request-recovery');
      await this.recoverPending();
    }
    const current=await this.draft();
    need(same(current.selection,this.input.sourceSelection),'The recovered complete mapping differs from its exact original selection.');
    need(['RESPONSE_WITHHELD','ORIGINAL_RESPONSE_LOST'].includes(this.report.fault?.state)&&this.report.requests[this.report.fault.requestId]?.state==='RECORDED',
      'The original interrupted selection request has no retained native acceptance.');
    const original=this.report.requests[this.report.fault.requestId];
    const status=await this.api(this.deskPrefix+'/'+current.id+'/requests/'+encodeURIComponent(this.report.fault.requestId));
    need(status.state==='RECORDED'&&same(status.result,original.result),
      'The original unread browser response did not reconcile to its complete saved receipt.');
    await this.capture('04-recovered-selection');
    return {requestId:this.report.fault.requestId,revision:current.revision,selectionSha256:sha(Buffer.from(stable(current.selection)))};
  }
  async preparation(){
    await this.tab('mapping');
    let draft=await this.draft();
    need(same(draft.selection,this.input.sourceSelection),'Keep the exact original saved source selection.');
    if(!draft.preparations.length){await this.click('prepare');await this.recoverPending();}
    const prepared=await this.currentPreparation();
    await this.tab('outputs');await this.click('preparation-open','[data-id="'+prepared.id+'"]');
    for(const file of prepared.files)
      await this.downloads(()=>this.click('output-download','[data-filename="'+file.filename+'"]'),[file],'prepared-output');
    const archive=await this.api(this.deskPrefix+'/'+draft.id+'/preparations/'+prepared.id+'/archive?describe=1');
    need(archive.preparationId===prepared.id,'The whole browser archive changed its original preparation.');
    await this.downloads(()=>this.click('archive-download'),[archive],'prepared-archive');
    await this.capture('05-complete-preparation');
    return {id:prepared.id,selectionSha256:prepared.selectionSha256,files:prepared.files,archive};
  }
  async attachment(){
    const prepared=await this.currentPreparation();await this.tab('outputs');
    await this.click('preparation-open','[data-id="'+prepared.id+'"]');
    let current=await this.draft();
    if(!current.attachments.length){await this.click('attach');await this.recoverPending();current=await this.draft();}
    need(current.attachments.length===1,'Retain the original one complete browser attachment.');
    const attached=current.attachments[0];
    need(attached.preparationId===prepared.id&&attached.sources.length===prepared.files.length,
      'The complete browser cohort was not attached atomically.');
    const native=await this.api(this.prefix);
    for(const source of attached.sources){
      const actual=native.sources.find(x=>x.id===source.sourceId);
      need(actual?.sha256===source.sha256&&actual.bytes===source.bytes,
        'The actual original case lost an attached complete source.');
    }
    await this.capture('06-attached-original-cohort');return attached;
  }
  async profile(){
    await this.tab('installation');
    const selected=this.input.sourceSelection.cases[0];
    await this.field('profileWork.workshareCaseId',selected.caseId);
    await this.field('profileWork.profileId',selected.profile);
    // The original complete binding template contains no guessed deployment,
    // payment or customer endpoint. Only explicit source bindings are applied.
    const before=await this.working('profile-before',{fresh:true});
    if(!before.profileWork?.seed)await this.click('profile-seed');
    if(selected.bindings){
      const applied=await this.working('profile-selected-bindings',{fresh:true});
      const complete=JSON.parse(applied.profileWork.bindingsText);
      for(const [key,value]of Object.entries(selected.bindings))
        need(Object.hasOwn(complete,key)&&same(complete[key],value),
          'The complete UI binding changed an explicitly selected original field: '+key+'.');
    }
    if(!before.profileWork?.preview)await this.click('profile-preview');
    const working=await this.working('complete-profile-preview'),work=working.profileWork;
    need(work?.prepared&&work.preview&&work.seed.source.caseId===this.input.caseId&&
      work.workshareCaseId===selected.caseId&&work.profileId===selected.profile&&
      work.prepared.document.workshare.planSha256===selected.planSha256&&
      same(work.preview.document,work.prepared.document),
      'The original profile preview changed its complete customer or commercial scope.');
    if(selected.programme){
      const programme=work.prepared.customerProgramme;
      need(programme?.workshareCaseId===selected.caseId&&programme.planSha256===selected.planSha256&&
        Array.isArray(programme.customerRows)&&programme.customerRows.length>0&&
        same(programme.document,work.prepared.document),
        'Keep the complete original customer programme with its native Installation.');
    }
    const programmeMarkdown=work.prepared.customerProgramme?programmeFiles(work.prepared.customerProgramme).get('CUSTOMER_PROGRAMME.md'):'';
    const raw=Buffer.from(JSON.stringify(work.prepared,null,2)+'\n'),
      markdown=Buffer.from(renderWorkorder(work.prepared)+(programmeMarkdown?'\n\n'+programmeMarkdown:''));
    await this.downloads(()=>this.click('profile-download'),[
      {filename:'INSTALLATION_PREPARATION.json',bytes:raw.length,sha256:sha(raw)},
      {filename:'INSTALLATION_WORKORDER.md',bytes:markdown.length,sha256:sha(markdown)}
    ],'complete-profile');
    await this.capture('07-complete-profile');
    return {working:this.report.workingSnapshots['complete-profile-preview'],workshareCaseId:selected.caseId,
      planSha256:selected.planSha256,documentSha256:sha(Buffer.from(stable(work.prepared.document)))};
  }
  async receiveInstallation(){
    const selected=this.input.sourceSelection.cases[0];
    const retained=await object(this.report.phases['07-complete-native-profile'].working.path);
    const prepared=retained.profileWork.prepared;
    let records=await this.requests('installation.save');
    need(records.length<=1,'Keep the first actual browser Installation request instead of creating another.');
    if(!records.length){
      const session=await this.installationSession();
      const candidate=session.drafts?.[session.draftKey];
      if(!(session.mode==='edit'&&candidate&&same(candidate.document,prepared.document))){
        await this.tab('installation');
        await this.click('profile-apply');
      }
      await this.page.locator('[data-installation-editor]').waitFor({state:'visible'});
      const actual=await this.installationSession(),draft=actual.drafts?.[actual.draftKey];
      need(draft&&draft.installationId===null&&same(draft.document,prepared.document),
        'The original Installation editor did not receive the complete reviewed Workshare.');
      await this.capture('08-original-installation-editor');
      await this.page.locator('[data-installation-note]').fill(
        'Receive the complete original source workshare for '+selected.caseId+'; actual customer commissioning selections remain retained.');
      await this.page.locator('[data-installation-action="preview"]').click();await this.nativeIdle();
      await this.page.locator('[data-installation-action="save"]').waitFor({state:'visible'});
      await this.page.locator('[data-installation-action="save"]').click();await this.nativeIdle();
      records=await this.requests('installation.save');
    }
    need(records.length===1,'Keep the exact original native Installation save.');
    const pending=records[0];
    if(pending.record.state!=='RECORDED'){
      const recovery=this.page.locator('[data-installation-action="recover"]');
      need(await recovery.count(),'The original native request needs reconciliation before another Installation.');
      await recovery.click();await this.nativeIdle();
    }
    const accepted=this.report.requests[pending.requestId];
    need(accepted.state==='RECORDED'&&accepted.result?.recordId,'The original native save remains unresolved.');
    const result=accepted.result,row=await this.api(this.prefix+'/installations/'+result.recordId+'?revision='+result.revision);
    need(row.id===result.recordId&&row.revision===result.revision&&row.sha256===result.sha256&&
      same(row.preview.document,prepared.document)&&row.preview.document.workshare.planSha256===selected.planSha256,
      'The saved native Installation differs from its complete original reviewed document.');
    const savedPath=resolve(this.networkRoot,'saved-installation-'+row.id+'-'+row.revision+'.json');
    const immutable=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='current'));
    await retain(savedPath,pretty(immutable));await this.remember(savedPath);
    this.report.installations=[{id:row.id,revision:row.revision,sha256:row.sha256,requestId:pending.requestId,
      workshareCaseId:selected.caseId,planSha256:selected.planSha256}];
    await this.rememberSession();await this.save();
    await this.capture('08-native-saved-installation');return this.report.installations[0];
  }
  async history(){
    await this.page.locator('[data-installation-action="source-open"]').click();await this.idle();
    await this.tab('history');
    const records=await this.requests('file.add');
    need(records.length,'Keep the original file upload history.');
    const first=records[0].record.result;
    need(first?.draft?.revision&&first.result?.file,'The original first complete file receipt is unavailable.');
    await this.page.locator('[data-source-revision]').fill(String(first.draft.revision));await this.click('revision-open');
    const history=await this.working('earlier-complete-revision');
    need(history.selectedRevision===first.draft.revision&&same(history.saved,first.draft),
      'The historical view changed its exact earlier complete native revision.');
    await this.tab('files');
    await this.downloads(()=>this.click('file-download','[data-id="'+first.result.file.id+'"]'),[first.result.file],'earlier-original-input');
    await this.capture('09-complete-earlier-history');
    await this.click('current-open');await this.tab('history');
    await this.working('final-complete-working');
    await this.capture('09-current-source-history');
    return {earlierRevision:first.draft.revision,currentRevision:(await this.draft()).revision};
  }
  async verify(){
    const current=await this.checkFiles();
    need(same(current.selection,this.input.sourceSelection),'The current full source selection changed.');
    for(const [requestId,record]of Object.entries(this.report.requests)){
      const original=await object(record.requestPath);
      need(original.body.requestId===requestId&&sha(pretty(original))===record.requestSha256,
        'A full original browser request changed.');
      need(record.state==='RECORDED','Reconcile every original browser request before completing.');
      if(original.path.startsWith(this.deskPrefix+'/')){
        const result=await this.api(original.path+'/requests/'+encodeURIComponent(requestId));
        need(result.state==='RECORDED'&&same(result.result,record.result),'The original full Source Desk receipt changed.');
      }else{
        const result=record.result;
        const row=await this.api(this.prefix+'/installations/'+result.recordId+'?revision='+result.revision);
        need(row.sha256===result.sha256&&same(row.preview.document,original.body.data.document),
          'The complete original native save no longer matches its request.');
      }
    }
    for(const original of [...this.input.installations,...this.report.installations]){
      const current=await this.api(this.prefix+'/installations/'+original.id+'?revision='+original.revision);
      need(current.sha256===original.sha256,'An earlier complete Installation edition changed during receiving.');
    }
    await verifyCustomerEditions(this,{need,same,sha,stable,object,verifyReceipt});
    for(const file of Object.values(this.report.artifacts))await verifyReceipt(file);
    this.report.sourceDraftSha256=sha(Buffer.from(stable(current)));
    this.report.sourceDraftRevision=current.revision;
    const path=resolve(this.networkRoot,'final-source-draft-'+this.report.sourceDraftSha256+'.json');
    await retain(path,pretty(current));await this.remember(path);
    need(!this.networkFailure,'An original browser request failed outside the selected response interruption.');
    need(!this.report.pageErrors?.length,'The original application reported a browser script error. Preserve its complete report.');
    return current;
  }
  async close(){
    this.stopping=true;
    if(this.context){await this.context.close();this.context=null;this.page=null;}
    while(this.owned.size)await Promise.allSettled([...this.owned]);
    await this.tail;
  }
  async run(){
    let failure=null;
    try{
      await this.initialize();
      if(this.report.state==='COMPLETE'&&this.report.phases['14-edition-history-and-final-working-reopen']){
        need(this.report.lifetimes==='CLOSED','Keep the original completed browser close receipt.');
        await this.verify();
      }else{
      this.report.state='RUNNING';this.report.lifetimes='OPEN';await this.save();
      await this.launch();
      await this.stage('01-original-source-desk',()=>this.create());
      await this.stage('02-every-original-file',()=>this.uploads());
      await this.stage('03-guided-mapping-and-original-request-recovery',()=>this.selection());
      await this.stage('05-full-native-preparation-and-downloads',()=>this.preparation());
      await this.stage('06-atomic-original-case-attachment',()=>this.attachment());
      await this.stage('07-complete-native-profile',()=>this.profile());
      await this.stage('08-original-installation-edit-and-save',()=>this.receiveInstallation());
      await this.stage('09-earlier-source-history-and-working-download',()=>this.history());
      await receiveCustomerEditions(this,{need,same,sha,stable,object,pretty});
      await this.verify();
      }
    }catch(error){
      failure=error;
      if(this.report){this.report.state='INTERRUPTED';this.report.error={name:error.name,message:error.message,
        status:error.status??null,code:error.code??null};}
    }finally{
      let closed=false;
      try{await this.close();closed=true;}catch(error){
        failure??=error;
        if(this.report){this.report.state='INTERRUPTED';this.report.closeError={name:error.name,message:error.message};}
      }
      if(this.report){
        this.report.lifetimes=closed?'CLOSED':'UNCONFIRMED';
        if(!failure)this.report.state='COMPLETE';
        try{await this.save();}catch(error){failure??=error;emit({state:'REPORT_PUBLICATION_FAILED',message:error.message});}
      }
    }
    if(failure)throw failure;
    return this.report;
  }
}

async function main(){
  const [inputPath,accessPath,...extra]=process.argv.slice(2);
  need(inputPath&&extra.length===0,'Pass the complete original input path and, for browser mode, its private access file.');
  const raw=await regular(inputPath,32*1024*1024),input=JSON.parse(raw.toString('utf8'));
  if(input.mode==='prepare-profile'){need(!accessPath,'The original profile preparation takes one full input.');await prepareProfile(input);return;}
  need(input.schema===SCHEMA&&input.mode==='browser'&&accessPath,'Use the original complete browser input and private listener.');
  const access=await object(accessPath,4096),run=new BrowserReceiving(input,sha(raw),access);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
    const report=await run.run();
    emit({schema:SCHEMA,state:report.state,lifetimes:report.lifetimes,operationId:input.operationId,
      phases:Object.keys(report.phases).length,artifacts:Object.keys(report.artifacts).length,report:await receipt(run.path)});
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{emit({schema:SCHEMA,state:'INTERRUPTED',error:{name:error.name,message:error.message,
    status:error.status??null,code:error.code??null}});process.exitCode=1;});
}
