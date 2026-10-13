// SPDX-License-Identifier: MIT
// Actual original grant, learning and study controls with complete retained handovers.
import {readFile,open,mkdir,lstat,realpath,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {readConnection} from './connection.mjs';
import {acquireLease} from './managed.mjs';

const SCHEMA='stellar-forge.grant-analyst-browser-receiving.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'GRANT_ANALYST_BROWSER_RECEIVING'});};
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

export function createGrantAnalystReceivingBrowser(options){return new BrowserCourse(options);}
export class BrowserCourse{
  constructor(options){
    this.o=options;this.root=resolve(options.directory);this.path=join(this.root,'browser-operation.json');
    this.context=null;this.contextAcquisition=null;this.lease=null;this.leaseAcquisition=null;this.page=null;
    this.pageAcquisitions=new Set();this.contextWasOpened=false;this.recoveringEdit=false;this.routes=new Set();this.routeHandler=null;this.closing=null;this.writeTail=Promise.resolve();this.stopping=false;this.stopClosing=null;
  }
  requestStop(signal){
    this.stopping=true;
    this.stopClosing??=this.closeContext().catch(error=>{
      if(this.state){this.state.errors.push({type:'stop-closure',message:error.message,signal,at:now()});void this.save().catch(()=>{});}
    });
  }
  checkStopping(){need(!this.stopping,'The selected original browser course is stopping.');}
  save(){const snapshot=JSON.parse(JSON.stringify(this.state));const p=this.writeTail.then(()=>save(this.path,snapshot,{immutable:false}));this.writeTail=p.catch(()=>{});return p;}
  async phase(name,run){this.checkStopping();if(this.state.phases[name]?.complete)return this.state.phases[name].value;
    this.state.activePhase=name;await this.save();try{await this.o.onProgress?.({phase:name});}catch{}
    const value=await run();this.state.phases[name]={complete:true,at:now(),value};await this.save();this.checkStopping();return value;}
  async retain(row){await verify(row);this.state.files[row.path]=row;await this.save();return row;}
  async publishCandidate(name,producer){
    const candidatePath=join(this.root,'candidates',name+'.json');
    let candidate;
    if(await exists(candidatePath))candidate=await json(candidatePath);
    else{
      const produced=await producer(),raw=produced.bytes;
      candidate={schema:'stellar-forge.grant-analyst-browser-artifact.v1',name,bytes:raw.length,sha256:hash(raw),
        base64:raw.toString('base64'),metadata:produced.metadata??{}};
      await save(candidatePath,candidate);
    }
    need(candidate.schema==='stellar-forge.grant-analyst-browser-artifact.v1'&&candidate.name===name,'Keep the same browser artifact candidate.');
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
      const token=sessionStorage.getItem('tjlabs-grant-analyst-private-connection');
      if(!token)throw Error('The actual original console token is absent.');
      const response=await fetch(route,{method:body===undefined?'GET':'POST',
        headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value=await response.json();
      if(!response.ok&&!allowError)throw Error(value.error??'Original native request failed.');
      return allowError?{status:response.status,value}:value;
    },{route,body,allowError});
  }
  async enter(){
    const c=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
      applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
    need(c.value.actor===this.o.actor&&c.value.workspaceId===this.o.workspaceId,'Preserve the original selected workspace and actor.');
    if(this.state.origin!==c.value.origin){
      this.state.origins??=[];this.state.origins.push({origin:c.value.origin,instanceId:c.value.instanceId,at:now()});
      this.state.origin=c.value.origin;await this.save();
    }
    await this.page.goto(c.value.origin+'/#'+c.token,{waitUntil:'domcontentloaded'});
    await this.page.locator('#workspace-id').filter({hasText:this.o.workspaceId}).waitFor();
    await this.page.waitForFunction(()=>typeof current!=='undefined'&&current&&typeof learningData!=='undefined'&&learningData&&typeof studiesData!=='undefined'&&studiesData);
    const state=await this.api('/api/state');
    need(state.id===this.o.workspaceId,'The page opened another original workspace.');
    return state;
  }
  async installActionRoute(){
    this.noteRoute='**/api/cycle-action';
    this.routeHandler=route=>{
      const task=(async()=>{
        const request=route.request();if(request.method()!=='POST')return route.continue();
        const wire=request.postDataJSON(),{requestId,...body}=wire;
        need(typeof requestId==='string'&&same(body,this.o.operation.body),'The original selected action body changed.');
        if(this.state.edit?.wire)need(same(wire,this.state.edit.wire),'Resume the same saved original request.');
        else{
          const pending=await this.page.evaluate(()=>pending);
          need(pending?.action==='cycle-action'&&same(pending.body,wire),'The UI must durably select its original request before dispatch.');
          this.state.edit={wire,pending,attempts:[]};await this.save();
          await this.retain(await save(join(this.root,'original-action-request.json'),{action:'cycle-action',body,requestId,pending}));
        }
        const number=this.state.edit.attempts.length;
        this.state.edit.attempts.push({number,startedAt:now(),state:'dispatched'});await this.save();
        const response=await route.fetch({timeout:120000}),raw=await response.body(),value=JSON.parse(raw.toString('utf8'));
        const captured=await this.publishCandidate('action-response-'+number+'.json',async()=>({bytes:raw,metadata:{status:response.status(),route:'/api/cycle-action'}}));
        Object.assign(this.state.edit.attempts[number],{state:'response-retained',response:captured,status:response.status()});await this.save();
        need(response.ok(),'The original action update failed.');
        const {reused,...result}=value;
        if(this.state.edit.result)need(same(result,this.state.edit.result),'The original same-request result changed.');
        else this.state.edit.result=result;
        if(!this.state.edit.acknowledgementLost){this.state.edit.acknowledgementLost=true;await this.save();return route.abort('failed');}
        need(reused===true,'The retained original request must replay rather than add another action revision.');
        this.state.edit.replayed=true;await this.save();return route.fulfill({response,body:raw});
      })();this.routes.add(task);task.finally(()=>this.routes.delete(task)).catch(()=>{});return task;
    };
    await this.page.route(this.noteRoute,this.routeHandler);
  }
  async restorePending(){
    const retained=this.state.edit.pending;
    need(retained&&retained.action==='cycle-action','Keep the actual original UI request.');
    await this.page.evaluate(async({retained,workspaceId})=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tjlabs-grant-analyst',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('requests');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try{await new Promise((resolve,reject)=>{const tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests'),key='pending:'+workspaceId;
        const r=store.get(key);r.onsuccess=()=>{if(r.result&&JSON.stringify(r.result)!==JSON.stringify(retained)){tx.abort();return;}store.put(retained,key);};
        tx.oncomplete=resolve;tx.onabort=()=>reject(Error('A different original UI request is retained.'));tx.onerror=()=>reject(tx.error);});}
      finally{db.close();}
    },{retained,workspaceId:this.o.workspaceId});
    await this.page.reload({waitUntil:'domcontentloaded'});
    await this.page.locator('#pending').waitFor({state:'visible'});
    need(await this.page.locator('#pending-summary').textContent().then(x=>x.includes(retained.body.requestId)),'Original retry did not reopen.');
  }
  async actionEdit(){
    await this.enter();await this.installActionRoute();
    if(!this.state.edit?.wire){
      const retained=await this.page.evaluate(()=>pending);
      need(!retained,'Reconcile the original outstanding UI request before this selected receiving action.');
      await this.page.locator('#learning-cycle').selectOption(this.o.operation.body.cycle);
      const index=this.baseline.learning.cycles.find(x=>x.id===this.o.operation.body.cycle).actions.findIndex(x=>x.id===this.o.operation.body.action);
      need(index>=0,'Selected original action is absent.');
      await this.page.locator('#learning-actions tr').nth(index).getByRole('button').click();
      const body=this.o.operation.body;
      for(const [id,key]of[['action-title','title'],['action-owner','owner'],['action-due','dueOn'],['action-criteria','successCriteria']])
        need(await this.page.locator('#'+id).inputValue()===body[key],'The action form differs from its retained original definition.');
      need(await this.page.locator('#action-status').inputValue()===body.status,'The technical action note must preserve its original status.');
      await this.page.locator('#action-reviewer').fill(body.reviewer);
      await this.page.locator('#action-note').fill(body.note);await this.page.locator('#action-evidence').fill(body.evidence);
      await this.screenshot('action-note-draft.png');
      await this.page.locator('#cycle-action-form button[type=submit]').click();
      await this.page.locator('#notice.error').waitFor();
      await this.page.locator('#pending').waitFor({state:'visible'});
      await this.screenshot('saved-action-lost-acknowledgement.png');
    }
    if(!this.state.edit.replayed){
      await this.restorePending();await this.page.locator('#retry').click();
      await this.page.locator('#pending').waitFor({state:'hidden'});
      need(this.state.edit.replayed,'The same retained browser request has not returned its original replay result.');
    }
    await this.page.unroute(this.noteRoute,this.routeHandler);this.routeHandler=null;
    const actual=await this.api('/api/learning'),body=this.o.operation.body;
    const cycle=actual.cycles.find(x=>x.id===body.cycle),action=cycle?.actions.find(x=>x.id===body.action);
    const before=this.baseline.learning.cycles.find(x=>x.id===body.cycle).actions.find(x=>x.id===body.action);
    need(action&&action.revisions.length===before.revisions.length+1&&same(action.revisions.slice(0,-1),before.revisions),'The original action history did not append exactly once.');
    const last=action.revisions.at(-1);
    for(const key of ['title','owner','dueOn','successCriteria','status','reviewer','note','evidence'])need(last[key]===body[key],'Saved action field differs: '+key);
    const operation={action:'cycle-action',body,requestId:this.state.edit.wire.requestId};
    const output={operation,result:this.state.edit.result,attempts:this.state.edit.attempts,action};
    await this.retain(await save(join(this.root,'original-action-recovered.json'),output));
    await this.page.locator('#learning-cycle').selectOption(body.cycle);
    await this.page.locator('#learning-history details').filter({has:this.page.locator('summary',{hasText:body.action+' · complete action history'})}).locator('summary').click();
    await this.screenshot('saved-action-complete-history.png');
    return output;
  }
  async grantViews(){
    await this.enter();const output=[];
    for(let index=0;index<this.baseline.state.editions.length;index++){
      const entry=this.baseline.state.editions[index];await this.page.locator('#edition').selectOption(entry.id);
      await this.page.waitForFunction(id=>report?.edition.id===id,entry.id);
      const pages=[],seen=new Set();let offset=0;
      for(;;){const row=await this.api('/api/report?'+new URLSearchParams({edition:entry.id,offset:String(offset),limit:'2'}));
        need(row.workspace===this.o.workspaceId&&row.edition.sha256===entry.sha256&&row.offset===offset,'Original report page identity differs.');
        for(const grant of row.rows){need(!seen.has(grant.grantId),'Original report repeated a row.');seen.add(grant.grantId);}
        pages.push(row);if(row.nextOffset===null)break;need(row.nextOffset>offset,'Original cursor did not advance.');offset=row.nextOffset;}
      need(seen.size===entry.grants,'The full original grant population was not read.');
      const full={...pages[0],rows:pages.flatMap(x=>x.rows)};delete full.matched;delete full.offset;delete full.nextOffset;delete full.createdAt;
      const expected=this.baseline.reports.find(x=>x.edition.id===entry.id);
      need(same(full,expected),'Complete original report changed while operating the console.');
      const retained=await this.retain(await save(join(this.root,'grant-report-'+index+'.json'),{pages,complete:full}));
      const source=await this.downloaded('source-'+index+'.json',()=>this.page.locator('#source-download').click());
      need(source.bytes===entry.bytes&&source.sha256===entry.sha256,'Original source download changed literal bytes.');
      const csv=await this.downloaded('reviewed-grants-'+index+'.csv',()=>this.page.locator('#csv').click());
      await this.page.locator('#grant-rows tr').first().getByRole('button').click();
      await this.page.locator('#review-panel details summary').click();
      const detail=await this.screenshot('grant-'+index+'-original-values.png');
      await this.page.locator('#close-review').click();
      await this.page.locator('#search').fill('__installed_receiving_no_matching_grant__');
      await this.page.getByText('No matching grants',{exact:true}).waitFor();
      const empty=await this.screenshot('grant-'+index+'-empty-search.png');
      await this.page.locator('#search').fill('');await this.page.waitForFunction(n=>report?.matched===n,entry.grants);
      await this.page.locator('#show-codebook').click();
      need(await this.page.locator('#question').inputValue()===expected.codebook.question,'Current codebook did not reopen.');
      const codebook=await this.screenshot('grant-'+index+'-codebook.png');await this.page.locator('#show-codebook').click();
      await this.page.locator('#baseline').selectOption(entry.id);await this.page.locator('#candidate').selectOption(entry.id);
      await this.page.locator('#compare').click();await this.page.locator('#comparison-export').waitFor({state:'visible'});
      const compared=await this.api('/api/compare?'+new URLSearchParams({baseline:entry.id,candidate:entry.id}));
      need(compared.counts.unchanged===entry.grants&&compared.counts.changed===0&&compared.counts.added===0&&compared.counts.removed===0,'Original full comparison differs.');
      const comparison=await this.downloaded('source-comparison-'+index+'.json',()=>this.page.locator('#comparison-export').click());
      await this.reopenJson(comparison,'comparison-'+index,compared);
      output.push({edition:entry.id,rows:entry.grants,retained,source,csv,detail,empty,codebook,comparison});
    }
    return output;
  }
  async learningViews(){
    const actual=await this.api('/api/learning'),output=[];
    for(const cycle of actual.cycles){
      await this.page.locator('#learning-cycle').selectOption(cycle.id);
      need(await this.page.locator('#learning-actions tr').count()===cycle.actions.length,'Complete action population is missing.');
      const details=this.page.locator('#learning-history details');
      for(let i=0;i<await details.count();i++)await details.nth(i).locator('summary').click();
      const name='learning-'+output.length;
      output.push({id:cycle.id,actions:cycle.actions.length,reviews:cycle.reviews.length,
        desktop:await this.screenshot(name+'-desktop.png'),mobile:await this.narrow(name+'-mobile.png')});
    }
    const saved=await this.downloaded('complete-learning-cycles.json',()=>this.page.locator('#learning-json').click());
    await this.reopenJson(saved,'learning-json',actual);
    const csv=await this.downloaded('learning-actions.csv',()=>this.page.locator('#learning-csv').click());
    const markdown=await this.downloaded('learning-decisions.md',()=>this.page.locator('#learning-markdown').click());
    return{cycles:output,json:saved,csv,markdown};
  }
  async studyViews(){
    const actual=await this.api('/api/studies'),output=[];
    if(!actual.studies.length){need(await this.page.locator('#study-summary').textContent().then(x=>x.includes('No commissioned study')),'The empty commissioned-study state did not render.');
      return{studies:[],empty:await this.screenshot('no-commissioned-study.png')};}
    for(const study of actual.studies){
      await this.page.locator('#study-select').selectOption(study.id);
      need(await this.page.locator('#study-answers tr').count()===study.currentQuestions.questions.length,'Complete original question matrix is missing.');
      need(await this.page.locator('#study-evidence tr').count()===study.currentEvidence.length,'Complete evidence register is missing.');
      const files=[];
      for(let i=0;i<study.currentEvidence.length;i++){
        const item=study.currentEvidence[i];if(!item.document)continue;
        const file=await this.downloaded('study-'+output.length+'-evidence-'+i+'.bin',()=>this.page.locator('#study-evidence tr').nth(i).getByRole('button',{name:'Download '+item.document.name,exact:true}).click());
        need(file.bytes===item.document.bytes&&file.sha256===item.document.sha256,'Original evidence attachment changed.');
        files.push({evidence:item.id,number:item.number,file});
      }
      const releases=[];
      for(let i=0;i<study.releases.length;i++){
        const release=study.releases[i],panel=this.page.locator('#study-releases .study-release').nth(i),downloads={};
        for(const [format,label,extension]of[['json','JSON','json'],['markdown','MD','md'],['csv','CSV','csv']])
          downloads[format]=await this.downloaded('study-'+output.length+'-release-'+i+'.'+extension,()=>panel.getByRole('button',{name:'Download '+label,exact:true}).click());
        const retained=await this.api('/api/study-release?'+new URLSearchParams({study:study.id,release:release.id,format:'json'}));
        await this.reopenJson(downloads.json,'study-'+output.length+'-release-'+i,retained);
        releases.push({id:release.id,audience:release.audience,sha256:release.sha256,downloads});
      }
      await this.page.locator('#study-edit-scope').click();const scope=await this.screenshot('study-'+output.length+'-scope.png');
      await this.page.locator('#study-edit-questions').click();const matrix=await this.screenshot('study-'+output.length+'-questions.png');
      await this.page.locator('#study-new-release').click();await this.page.locator('#study-release-audience').selectOption('external');
      need(await this.page.locator('#study-public-title').inputValue()===''&&!(await this.page.locator('#study-anonymous').isChecked()),'External disclosure must require new explicit reviewed text.');
      const disclosure=await this.screenshot('study-'+output.length+'-external-disclosure-form.png');
      await this.page.locator('#study-select').dispatchEvent('change');
      const history=this.page.locator('#commissioned-study > details');await history.locator('summary').click();
      output.push({id:study.id,revision:study.revision,files,releases,scope,matrix,disclosure,
        desktop:await this.screenshot('study-'+output.length+'-desktop.png'),mobile:await this.narrow('study-'+output.length+'-mobile.png')});
    }
    return{studies:output};
  }
  async downloaded(name,click,page=this.page){
    const directory=join(this.root,'candidates');await privateDirectory(directory);
    const descriptorPath=join(directory,name+'.download.json'),closedPath=join(directory,name+'.download.closed');
    let candidate;
    if(await exists(descriptorPath))candidate=await json(descriptorPath);
    else{
      const partial=join(directory,name+'.downloading');
      if(await exists(partial)){await rename(partial,partial+'.interrupted-'+randomUUID());await syncDirectory(directory);}
      need(!await exists(closedPath),'A closed download must retain its original candidate descriptor.');
      const waiting=page.waitForEvent('download',{timeout:120000});waiting.catch(()=>{});
      await click();const download=await waiting;
      need(!await download.failure(),'The complete original download failed.');
      const stream=await download.createReadStream();need(stream,'The original complete download stream is absent.');
      const file=await open(partial,'wx',0o600),digest=createHash('sha256');let count=0;
      try{
        for await(const chunk of stream){count+=chunk.length;need(count<=1024**3+64*1024**2,'The selected original complete archive exceeds its native capacity.');digest.update(chunk);await file.writeFile(chunk);}
        await file.sync();
      }finally{stream.destroy?.();await file.close();}
      candidate={schema:'stellar-forge.grant-analyst-browser-download.v1',name,
        path:closedPath,partial,bytes:count,sha256:digest.digest('hex'),
        metadata:{filename:download.suggestedFilename(),url:download.url()}};
      await verify({...candidate,path:partial});
      // The full closed descriptor precedes publication. A lost rename is
      // reconciled from this exact complete part; an unclosed part is retained.
      await save(descriptorPath,candidate);
    }
    need(candidate.schema==='stellar-forge.grant-analyst-browser-download.v1'&&candidate.name===name&&
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

  async reopenText(file,name){
    await verify(file);need(file.bytes<=32*1024**2,'Select a text report within its original complete-response limit.');
    const text=await readFile(file.path,'utf8'),acquisition=this.context.newPage();this.pageAcquisitions.add(acquisition);let page;
    try{page=await acquisition;}finally{this.pageAcquisitions.delete(acquisition);}
    try{await page.setContent('<!doctype html><meta charset="utf-8"><title>Retained original report</title><style>body{font:15px/1.5 system-ui;margin:24px;color:#202124;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Retained original report</h1><pre></pre>');
      await page.locator('pre').evaluate((node,value)=>{node.textContent=value;},text);
      need(await page.locator('pre').textContent()===text,'Complete report text did not reopen.');
      const desktop=await this.screenshot(name+'-opened.png',page);return{file,desktop};
    }finally{await page.close();}
  }
  async journey(){
    const initial=await this.phase('original-desktop-and-narrow',async()=>({
      desktop:await this.screenshot('workspace-desktop.png'),mobile:await this.narrow('workspace-mobile.png')}));
    const edit=this.o.operation?await this.phase('original-action-request-recovery',()=>this.actionEdit()):null;
    const grants=await this.phase('complete-original-source-reports',()=>this.grantViews());
    const learning=await this.phase('complete-learning-history',()=>this.learningViews());
    const studies=await this.phase('complete-commissioned-study-history',()=>this.studyViews());
    const textReports=await this.phase('complete-report-reopening',async()=>{
      const opened=[await this.reopenText(learning.csv,'learning-actions'),await this.reopenText(learning.markdown,'learning-decisions')];
      for(let i=0;i<grants.length;i++)opened.push(await this.reopenText(grants[i].csv,'reviewed-grants-'+i));
      for(let i=0;i<studies.studies.length;i++)for(let j=0;j<studies.studies[i].releases.length;j++){
        const downloads=studies.studies[i].releases[j].downloads;
        opened.push(await this.reopenText(downloads.markdown,'study-'+i+'-release-'+j+'-markdown'));
        opened.push(await this.reopenText(downloads.csv,'study-'+i+'-release-'+j+'-csv'));
      }return opened;});
    const handover=await this.phase('complete-original-handover-download',async()=>this.downloaded('complete-analyst-handover.zip',()=>this.page.locator('#export').click()));
    const final={state:await this.api('/api/state'),learning:await this.api('/api/learning'),studies:await this.api('/api/studies')};
    await this.retain(await save(join(this.root,'final-browser-projection.json'),final));
    return{initial,edit,grants,learning,studies,textReports,handover};
  }
  async run(){
    await privateDirectory(this.root);this.checkStopping();
    try{
      this.leaseAcquisition=acquireLease(join(this.root,'browser-operation'));
      this.lease=await this.leaseAcquisition;this.leaseAcquisition=null;this.checkStopping();
      await verify(this.o.baseline);this.baseline=await json(this.o.baseline.path);
      need(this.baseline.state.id===this.o.workspaceId,'Browser baseline belongs to another original workspace.');
      const selected=JSON.parse(JSON.stringify({actor:this.o.actor,workspaceDirectory:this.o.workspaceDirectory,
        workspaceId:this.o.workspaceId,applicationDirectory:this.o.applicationDirectory,
        sourceManifestSha256:this.o.sourceManifestSha256,baseline:this.o.baseline,operation:this.o.operation??null,
        browser:this.o.chromium,playwright:this.o.playwright,source:this.o.source,
        ...(this.o.extension===undefined?{}:{extension:this.o.extension})}));
      this.state=await exists(this.path)?await json(this.path):null;
      if(this.state)need(this.state.schema===SCHEMA&&same(this.state.selection,selected),'The original browser selection changed.');
      const candidatePath=join(this.root,'browser-candidate.json'),resultPath=join(this.root,'browser-result.json');
      if(await exists(candidatePath)||await exists(resultPath)){
        const candidate=await json(await exists(candidatePath)?candidatePath:resultPath);
        need(this.state&&same(candidate.selection,selected)&&candidate.schema==='stellar-forge.grant-analyst-browser-result.v1'&&
          candidate.state==='COMPLETE'&&typeof candidate.ownersClosedAt==='string','The closed browser result selected another course.');
        for(const row of candidate.files)await verify(row);
        await save(resultPath,candidate);this.state.status='complete';
        this.state.result={path:resultPath,bytes:(await readFile(resultPath)).length,sha256:hash(await readFile(resultPath))};await this.save();
        return{...candidate,resultFile:this.state.result};
      }
      const current=await readConnection(this.o.connectionFile,{directory:this.o.workspaceDirectory,
        applicationDirectory:this.o.applicationDirectory,sourceManifestSha256:this.o.sourceManifestSha256});
      need(current.value.workspaceId===this.o.workspaceId,'Preserve the selected original native workspace.');
      this.state??={schema:SCHEMA,selection:selected,origin:current.value.origin,origins:[{origin:current.value.origin,instanceId:current.value.instanceId,at:now()}],
        startedAt:now(),phases:{},files:{},errors:[],status:'running'};
      await this.save();
      this.checkStopping();const module=await import(pathToFileURL(this.o.playwright).href),chromium=module.chromium??module.default?.chromium;
      need(chromium,'Select the actual installed Playwright module.');this.checkStopping();
      this.contextAcquisition=chromium.launchPersistentContext(join(this.root,'profile'),{
        executablePath:this.o.chromium,headless:true,args:['--no-sandbox'],viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
      this.context=await this.contextAcquisition;this.contextAcquisition=null;this.contextWasOpened=true;this.checkStopping();
      this.state.ownersClosedAt=null;await this.save();
      this.page=this.context.pages()[0]??await this.context.newPage();this.page.setDefaultTimeout(60000);
      this.page.on('pageerror',error=>{this.state.errors.push({type:'pageerror',message:error.message,at:now()});void this.save().catch(()=>{});});
      await this.enter();
      const journey=await this.journey();
      need(journey&&typeof journey==='object'&&!Array.isArray(journey)&&!['schema','state','selection','origins','completedAt','ownersClosedAt','files','pageErrors','resultFile'].some(key=>Object.hasOwn(journey,key)),'A journey must preserve the original completion and owner fields.');
      await this.closeContext();
      const candidate={schema:'stellar-forge.grant-analyst-browser-result.v1',state:'COMPLETE',selection:selected,
        origins:this.state.origins,...journey,completedAt:now(),ownersClosedAt:this.state.ownersClosedAt,
        files:Object.values(this.state.files),pageErrors:this.state.errors};
      need(!candidate.pageErrors.some(e=>e.type==='pageerror'),'Repair actual page errors before completing the receiving course.');
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
      if(this.stopClosing)await this.stopClosing;
      for(;;){try{await this.closeContext();break;}catch(error){
        if(this.state){this.state.errors.push({type:'closure',message:error.message,at:now()});await this.save().catch(()=>{});}
        process.stderr.write(JSON.stringify({state:'GRANT_ANALYST_BROWSER_CLOSING',message:error.message})+'\n');await delay(1000);
      }}
      await this.writeTail;
      if(this.leaseAcquisition){try{this.lease=await this.leaseAcquisition;}finally{this.leaseAcquisition=null;}}
      if(this.lease){await this.lease.close();this.lease=null;}
    })().finally(()=>{this.closing=null;});return this.closing;
  }
}
