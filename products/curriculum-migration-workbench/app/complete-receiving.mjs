// Receive the original whole application through CLI, generated SDK and browser.
import {readFile,writeFile,mkdir,lstat,realpath,open,link,unlink,rename,readdir} from 'node:fs/promises';
import {fstatSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import * as Model from './model.mjs';
import * as Curriculum from './curriculum-migration.mjs';
import {generateSdk} from './generate-sdk.mjs';

const OP='curriculum-migration-complete-receiving-20261013',STORAGE='curriculum-migration-workbench.v1';
const actor='TJLabs engineering — published example receiving';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=Model.canonical,equal=(a,b)=>canonical(a)===canonical(b);
const need=(ok,message)=>{if(!ok)throw Error(message);};
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const exists=async p=>lstat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
async function regular(p){const s=await lstat(p);need(s.isFile()&&!s.isSymbolicLink(),'Expected an original regular file: '+p);return readFile(p);}
async function read(p){return JSON.parse(await regular(p));}
async function identity(p){const b=await regular(p);return {bytes:b.length,sha256:sha(b)};}
async function atomic(p,value){
  const temporary=join(dirname(p),'.'+randomUUID()+'.partial'),bytes=Buffer.isBuffer(value)?value:json(value);
  const f=await open(temporary,'wx',0o600);
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
  await rename(temporary,p);const directory=await open(dirname(p),'r');try{await directory.sync();}finally{await directory.close();}
}
async function retain(p,value){
  const bytes=Buffer.isBuffer(value)?value:json(value);
  if(await exists(p)){need((await regular(p)).equals(bytes),'Preserve differing retained output: '+p);return;}
  const temporary=join(dirname(p),'.'+randomUUID()+'.partial'),f=await open(temporary,'wx',0o600);
  try{await f.writeFile(bytes);await f.sync();await f.close();
    try{await link(temporary,p);}catch(e){if(e.code!=='EEXIST')throw e;need((await regular(p)).equals(bytes),'Concurrent retained output differs: '+p);}
  }finally{await f.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function contained(directory,path){return !isAbsolute(path)&&path.split('/').every(s=>s&&s!=='.'&&s!=='..')&&!/[\\\u0000-\u001f]/.test(path)&&resolve(directory,path).startsWith(directory+'/');}
const jobPath=process.env.CURRICULUM_RECEIVING_JOB;
need(jobPath,'Run this programme through its original run-receiving.py owner.');
const job=await read(jobPath),root=await realpath(job.sourceRoot),out=await realpath(job.workDir);
need(job.schema==='curriculum-receiving-intent.v2'&&job.operation===OP&&resolve(jobPath)===join(out,'intent.json'),'The original receiving intent differs.');
const held=Number(process.env.CURRICULUM_RECEIVING_LOCK_FD),heldInfo=fstatSync(held),namedInfo=await lstat(join(out,'complete-receiving.lock'));
need(Number.isInteger(held)&&heldInfo.isFile()&&heldInfo.dev===namedInfo.dev&&heldInfo.ino===namedInfo.ino,'Keep the original inherited receiving lease.');
const intentSha256=sha(await regular(jobPath));
for(const f of job.sources){need(contained(root,f.path)&&equal(await identity(join(root,f.path)),{bytes:f.bytes,sha256:f.sha256}),'Original source changed: '+f.path);}
need(equal(await identity(job.workspace.path),{bytes:job.workspace.bytes,sha256:job.workspace.sha256}),'The selected input workspace changed.');
if(job.bulkOptions)need(equal(await identity(job.bulkOptions.path),{bytes:job.bulkOptions.bytes,sha256:job.bulkOptions.sha256}),'The reviewed BULK choices changed.');
const initial=Curriculum.receiveCurriculumWorkspace(await read(join(root,'initial-workspace.json')));
need(initial.cases.length===25,'The complete original 25-case course is required.');
const packet=await read(job.workspace.path);
const supplied=packet.format==='curriculum-workspace-export.v1'?(need(packet.sha256===sha(Buffer.from(canonical(packet.workspace))),'The supplied complete workspace checksum differs.'),packet.workspace):packet;
const source=Curriculum.receiveCurriculumWorkspace(supplied);
need(source.id===initial.id&&equal(source.history.slice(0,initial.history.length),initial.history),'Preserve the original workspace and source history.');
for(const e of initial.editions)need(equal(source.editions.find(x=>x.id===e.id),e),'The original published contract edition changed.');
for(const c of initial.cases){const present=source.cases.find(x=>x.id===c.id);need(present&&present.operationKey===c.operationKey&&present.sourceEditionId===c.sourceEditionId&&equal(present.responses.original,c.responses.original),'An original published case changed: '+c.id);}
const bulk=job.bulkOptions?await read(job.bulkOptions.path):null;
if(bulk){
  const c=source.cases.find(x=>x.id===bulk.caseId);
  need(c?.operationKey==='BULK'&&bulk.namespaces&&Array.isArray(bulk.mappings)&&['accepted','changes-required'].includes(bulk.decision?.outcome)&&typeof bulk.decision.note==='string'&&bulk.decision.note.trim(),'Select an actual saved BULK case, explicit namespaces, occurrence mappings and engineering decision.');
  for(const lane of ['original','candidate'])need(['captured-http','operator-file'].includes(c.responses[lane]?.provenance?.kind),'BULK receiving requires the retained actual response/file provenance in each lane.');
  need(typeof bulk.namespaces.original==='string'&&bulk.namespaces.original.trim()&&typeof bulk.namespaces.candidate==='string'&&bulk.namespaces.candidate.trim(),'Retain both explicit dataset namespaces.');
}
const paths={stages:join(out,'stages'),steps:join(out,'steps'),attempts:join(out,'attempts')};
for(const p of Object.values(paths))await mkdir(p,{recursive:true,mode:0o700});
const files=[];
async function record(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await retain(path,value);return {path:relative(out,path),...await identity(path)};}
async function verifyFiles(rows){
  need(Array.isArray(rows),'Retain the complete receiving file inventory.');const seen=new Set();
  for(const f of rows){need(contained(out,f.path)&&!seen.has(f.path)&&equal(await identity(join(out,f.path)),{bytes:f.bytes,sha256:f.sha256}),'Completed receiving output changed: '+f.path);seen.add(f.path);}
}
const finalPath=join(out,'result.json');
if(await exists(finalPath)){
  const prior=await read(finalPath);
  need(prior.operation===OP&&prior.schema==='curriculum-complete-receiving.v2'&&prior.intentSha256===intentSha256,'Preserve the previous programme result and reconcile its original source before continuation.');
  if(prior.status==='COMPLETE'){await verifyFiles(prior.files);console.log(JSON.stringify({...prior,recovered:true}));process.exit(0);}
}
async function stage(name,fn){
  const path=join(paths.stages,name+'.json');
  if(await exists(path)){const old=await read(path);need(old.operation===OP&&old.intentSha256===intentSha256&&old.name===name&&old.status==='COMPLETE','Original stage identity changed.');await verifyFiles(old.files);files.push(...old.files,{path:relative(out,path),...await identity(path)});return old.value;}
  const got=await fn(),value={operation:OP,intentSha256,name,status:'COMPLETE',completedAt:new Date().toISOString(),value:got.value,files:got.files};
  await verifyFiles(value.files);await retain(path,value);files.push(...got.files,{path:relative(out,path),...await identity(path)});return got.value;
}
const run=args=>{const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=256'}});need(!r.error&&r.status===0,args.join(' ')+'\n'+(r.error?.message||r.stderr));return r.stdout;};
const require=createRequire(import.meta.url);
const modules=[job.nodeModules,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules',join(root,'node_modules')].filter(Boolean);
function dependency(name){try{return require(name);}catch{}for(const base of modules){try{return require(resolve(base,name));}catch{}}throw Error('Existing dependency unavailable: '+name);}
const stopped={signal:null};let context,receiver,browser,server;
function stop(signal){stopped.signal??=signal;context?.close().catch(()=>{});receiver?.close().catch(()=>{});browser?.close().catch(()=>{});}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop(signal));
function active(){need(!stopped.signal,'Original receiving was interrupted by '+stopped.signal);}
let attempt;
try{
  const validations=await stage('original-contracts',async()=>{
    const values=initial.cases.map(c=>{const e=initial.editions.find(x=>x.id===c.sourceEditionId),op=Model.operations(e).find(o=>o.key===c.operationKey),media=op.responses[String(c.responses.original.status)].content[c.responses.original.contentType||'application/json'];return {id:c.id,validation:Model.validate(c.responses.original.body,media.schema||media,e.surface)};});
    need(values.every(v=>v.validation.valid),'A published example differs from its pinned contract.');
    return {value:{count:values.length},files:[await record(join(out,'original-validations.json'),values)]};
  });
  active();
  await stage('cli-receiving',async()=>{
    const list=[],summary=JSON.parse(run(['cli.mjs','summary','--workspace',job.workspace.path]));
    list.push(await record(join(out,'original-summary.json'),summary));
    const path=join(out,'cli-received.json');
    if(!await exists(path))run(['cli.mjs','receive','--workspace',job.workspace.path,'--out',path]);
    const received=await read(path);need(equal(Curriculum.receiveCurriculumWorkspace(received.workspace),source),'CLI receiving changed the original workspace.');
    need(received.sha256===sha(Buffer.from(canonical(source))),'CLI export fingerprint differs.');
    list.push({path:relative(out,path),...await identity(path)});
    return {value:{revision:source.revision},files:list};
  });
  active();
  await stage('typescript-compilation',async()=>{
    const sdk=generateSdk(initial.editions[0]),list=[];await mkdir(join(out,'sdk'),{recursive:true,mode:0o700});
    for(const f of sdk.files){need(contained(join(out,'sdk'),f.path),'SDK path differs.');list.push(await record(join(out,'sdk',f.path),Buffer.from(f.content)));}
    const ts=dependency('typescript'),program=ts.createProgram([join(out,'sdk/client.ts'),join(out,'sdk/types.ts')],{noEmit:true,strict:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']});
    const diagnostics=ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),...(d.file?{file:d.file.fileName}:{}),...(d.start!==undefined?{start:d.start}:{})}));
    need(!diagnostics.length,'Generated TypeScript requires correction: '+JSON.stringify(diagnostics));
    list.push(await record(join(out,'typescript-diagnostics.json'),diagnostics));return {value:{files:sdk.files.length},files:list};
  });
  active();
  const browserResult=await stage('browser-course',async()=>{
    const previous=(await readdir(paths.attempts)).filter(n=>/^attempt-\d{6}$/.test(n)).map(n=>Number(n.slice(8)));
    const number=Math.max(0,...previous)+1;need(number<1000000,'Preserve the original attempt history.');
    attempt=join(paths.attempts,'attempt-'+String(number).padStart(6,'0'));await mkdir(attempt,{mode:0o700});
    const list=[],errors=[],c=initial.cases.find(x=>x.operationKey==='GET /key-stages');need(c,'The original key-stage course is absent.');need(source.cases.find(x=>x.id===c.id)?.targetEditionId===c.targetEditionId,'Keep the original key-stage target edition for this published-example course.');
    const html=await regular(join(root,'curriculum-migration-workbench.html'));
    const addressPath=join(out,'browser-origin.json'),priorAddress=await exists(addressPath)?await read(addressPath):null;
    if(priorAddress)need(priorAddress.operation===OP&&priorAddress.intentSha256===intentSha256,'Preserve a different browser origin.');
    server=createServer((req,res)=>{if(req.url!=='/'&&req.url!=='/favicon.ico'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(priorAddress?.port||0,'127.0.0.1',done);});
    const port=server.address().port,url='http://127.0.0.1:'+port+'/';
    await retain(addressPath,{operation:OP,intentSha256,port});list.push({path:relative(out,addressPath),...await identity(addressPath)});
    const {chromium}=dependency('playwright'),launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(job.chromium?{executablePath:job.chromium.path}:{})};
    const selectedExecutable=job.chromium?.path||chromium.executablePath(),runtime={executable:await realpath(selectedExecutable),...await identity(await realpath(selectedExecutable))};
    if(job.chromium)need(runtime.bytes===job.chromium.bytes&&runtime.sha256===job.chromium.sha256,'The existing selected Chromium body changed.');
    await retain(join(out,'browser-runtime.json'),runtime);list.push({path:'browser-runtime.json',...await identity(join(out,'browser-runtime.json'))});
    context=await chromium.launchPersistentContext(join(out,'browser-profile'),{...launch,viewport:{width:1440,height:1000},acceptDownloads:true});
    const page=context.pages()[0]||await context.newPage();for(const old of context.pages())if(old!==page)await old.close();
    page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('[data-case]').first().waitFor();
    const browserState=async()=>Curriculum.receiveCurriculumWorkspace(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE));
    let stateRaw=await page.evaluate(key=>localStorage.getItem(key),STORAGE);
    // A new profile opens the embedded original. Import the selected genuine workspace
    // through the visible receiver before the first retained mutation.
    const seed=join(out,'selected-workspace.json');
    await retain(seed,{format:'curriculum-workspace-export.v1',sha256:sha(Buffer.from(canonical(source))),workspace:source});list.push({path:'selected-workspace.json',...await identity(seed)});
    if(!stateRaw){
      need(!(await readdir(paths.steps)).some(n=>n.endsWith('.json')),'Browser profile state disappeared after a retained action; restore this original profile before continuing.');
      await page.locator('#receive-workspace').setInputFiles(seed);
      await page.waitForFunction(key=>!!localStorage.getItem(key),STORAGE);
    }
    let current=await browserState();
    const stepRows=(await readdir(paths.steps)).filter(n=>/^\d{2}-.*\.json$/.test(n)).sort();
    let chain=source,pending=null;
    for(const name of stepRows){const item=await read(join(paths.steps,name));
      need(item.operation===OP&&item.intentSha256===intentSha256&&equal(item.before,chain),'Retained browser action history changed.');
      if(item.after){need(!pending,'A completed action follows an unresolved original action.');Curriculum.receiveCurriculumWorkspace(item.after);chain=item.after;}else{need(!pending,'More than one original browser action is pending.');pending=item;}
    }
    if(pending)need(equal(current,chain)||current.revision===chain.revision+1,'An interrupted browser action has an unrelated current revision.');
    else need(equal(current,chain),'The retained browser workspace differs from its accepted action history.');
    need(await page.locator('[data-case]').count()===source.cases.length,'The complete original case list did not load.');
    await page.locator('#engineer').fill(actor);
    const step=(name,spec,compute,action)=>async()=>{
      active();const path=join(paths.steps,name+'.json');
      let item=await exists(path)?await read(path):null;
      if(item){need(item.operation===OP&&item.intentSha256===intentSha256&&equal(item.spec,spec),'The original browser action selection changed.');}
      else{item={operation:OP,intentSha256,name,spec,before:await browserState(),createdAt:new Date().toISOString()};await retain(path,item);}
      if(item.after){const event=item.after.history.at(-1);need(item.after.revision===item.before.revision+1&&equal(item.after.history.slice(0,-1),item.before.history)&&event.actor===actor&&equal(compute(item.before,{actor:event.actor,at:event.at}),item.after),'The completed original browser action changed.');list.push({path:relative(out,path),...await identity(path)});return item.after;}
      let actual=await browserState(),primary;
      if(equal(actual,item.before)){
        try{await action();}catch(error){primary=error;}
        actual=await browserState().catch(()=>null);
      }
      if(!actual){if(primary)throw primary;throw Error('The original browser action outcome is unavailable.');}
      need(actual.revision===item.before.revision+1&&equal(actual.history.slice(0,-1),item.before.history),'Reconcile the original browser action before another click.');
      const event=actual.history.at(-1);need(event.actor===actor,'The original browser action actor differs.');
      const expected=compute(item.before,{actor:event.actor,at:event.at});
      need(equal(expected,actual),'The original browser mutation differs from its selected exact model operation.');
      item={...item,after:actual,completedAt:new Date().toISOString()};await atomic(path,item);
      list.push({path:relative(out,path),...await identity(path)});return actual;
    };
    const response={status:200,body:c.responses.original.body,headers:{},contentType:'application/json',provenance:{kind:'published-example',label:'Verification reuse of the original published key-stage response example'}};
    await step('01-key-stage-response',{caseId:c.id,response},(w,at)=>Model.saveResponse(w,c.id,'candidate',response,at),async()=>{
      await page.locator('[data-case="'+c.id+'"]').click();await page.locator('#candidate-status').fill('200');await page.locator('#candidate-headers').fill('{}');
      await page.locator('#candidate-body').fill(JSON.stringify(response.body,null,2));await page.locator('#candidate-source').fill(response.provenance.label);await page.locator('#candidate-kind').selectOption(response.provenance.kind);await page.locator('[data-save-response="candidate"]').click();
    })();
    await step('02-key-stage-compare',{caseId:c.id},(w,at)=>Model.compareCase(w,c.id,at),async()=>{await page.locator('[data-case="'+c.id+'"]').click();await page.locator('#compare').click();})();
    const decision={outcome:'accepted',note:'The published key-stage example was saved, compared and received intact in this application run.'};
    await step('03-key-stage-decision',{caseId:c.id,...decision},(w,at)=>Model.decide(w,c.id,{runId:w.cases.find(x=>x.id===c.id).runs.at(-1).id,...decision},at),async()=>{
      await page.locator('[data-case="'+c.id+'"]').click();need(await page.locator('.badge').innerText()==='MATCH','Actual browser comparison did not match the retained published response.');
      await page.locator('#decision').selectOption(decision.outcome);await page.locator('#decision-note').fill(decision.note);await page.locator('#save-decision').click();
    })();
    let bulkValue={status:'PENDING_INPUT',reason:'No complete original BULK workspace and reviewed choices were supplied.'};
    async function selectBulk(){
      await page.locator('[data-tab="curriculum"]').click();
      await page.getByLabel('Bulk case',{exact:true}).selectOption(bulk.caseId);
      await page.getByLabel('Original namespace',{exact:true}).fill(bulk.namespaces.original);
      await page.getByLabel('Candidate namespace',{exact:true}).fill(bulk.namespaces.candidate);
      // Selecting the case starts its current mapping draft; replace it explicitly.
      const remove=page.getByRole('button',{name:'Remove',exact:true});
      while(await remove.count())await remove.first().click();
      for(const mapping of bulk.mappings){
        await page.getByRole('button',{name:'Add occurrence mapping',exact:true}).click();
        await page.getByLabel('Kind',{exact:true}).last().selectOption(mapping.kind);
        await page.getByLabel('Original pointer',{exact:true}).last().fill(mapping.from);
        await page.getByLabel('Candidate pointer',{exact:true}).last().fill(mapping.to);
        await page.getByLabel('Reason',{exact:true}).last().fill(mapping.reason);
      }
    }
    if(bulk){
      const planned=await step('04-bulk-plan',bulk,(w,at)=>Curriculum.planCurriculumCase(w,bulk.caseId,{namespaces:bulk.namespaces,mappings:bulk.mappings},at),async()=>{await selectBulk();await page.getByRole('button',{name:'Create migration plan',exact:true}).click();})();
      const planId=planned.cases.find(x=>x.id===bulk.caseId).curriculumPlans.at(-1).id;
      const decided=await step('05-bulk-decision',{caseId:bulk.caseId,planId,...bulk.decision},(w,at)=>Curriculum.decideCurriculumPlan(w,bulk.caseId,{planId,...bulk.decision},at),async()=>{
        await selectBulk();await page.getByLabel('Plan edition',{exact:true}).selectOption(planId);await page.getByLabel('Decision note',{exact:true}).fill(bulk.decision.note);
        await page.getByRole('button',{name:bulk.decision.outcome==='accepted'?'Accept reviewed plan':'Require changes',exact:true}).click();
      })();
      const plan=decided.cases.find(x=>x.id===bulk.caseId).curriculumPlans.find(x=>x.id===planId);
      bulkValue={status:'COMPLETE',caseId:bulk.caseId,planId,result:plan.status,summary:plan.comparison.summary,decision:bulk.decision};
      list.push(await record(join(attempt,'bulk-plan.json'),plan),await record(join(attempt,'bulk-review-rows.json'),Curriculum.curriculumReviewRows(plan)));
      await page.screenshot({path:join(attempt,'curriculum-desktop.png'),fullPage:true});list.push({path:relative(out,join(attempt,'curriculum-desktop.png')),...await identity(join(attempt,'curriculum-desktop.png'))});
    }
    async function download(selector,name){
      const [item]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);const path=join(attempt,name);await item.saveAs(path);list.push({path:relative(out,path),...await identity(path)});return path;
    }
    await page.locator('[data-case="'+c.id+'"]').click();
    const workspacePath=await download('#export-workspace','browser-workspace.json'),exported=await read(workspacePath);
    need(exported.sha256===sha(Buffer.from(canonical(exported.workspace)))&&equal(Curriculum.receiveCurriculumWorkspace(exported.workspace),await browserState()),'Browser export changed the complete current workspace.');
    await page.screenshot({path:join(attempt,'case-desktop.png'),fullPage:true});list.push({path:relative(out,join(attempt,'case-desktop.png')),...await identity(join(attempt,'case-desktop.png'))});
    await page.locator('[data-tab="contracts"]').click();await page.locator('#contract-edition').selectOption(initial.editions[0].id);
    await download('#sdk','browser-sdk.zip');await page.screenshot({path:join(attempt,'contracts-desktop.png'),fullPage:true});list.push({path:relative(out,join(attempt,'contracts-desktop.png')),...await identity(join(attempt,'contracts-desktop.png'))});
    await download('#download-source','browser-complete-application.zip');
    // Independent profile receives the exact export through the actual UI, then
    // closes its entire browser process and cold-reopens the same saved profile.
    await context.close();context=null;
    const receivingProfile=join(attempt,'independent-profile');
    receiver=await chromium.launchPersistentContext(receivingProfile,{...launch,viewport:{width:1440,height:1000},acceptDownloads:true});
    let receivingPage=receiver.pages()[0]||await receiver.newPage();receivingPage.on('pageerror',e=>errors.push(e.message));
    await receivingPage.goto(url,{waitUntil:'domcontentloaded'});await receivingPage.locator('[data-case]').first().waitFor();await receivingPage.locator('#receive-workspace').setInputFiles(workspacePath);
    await receivingPage.waitForFunction(({key,revision})=>JSON.parse(localStorage.getItem(key)||'null')?.revision===revision,{key:STORAGE,revision:exported.workspace.revision});
    let after=Curriculum.receiveCurriculumWorkspace(await receivingPage.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE));
    need(equal(after,exported.workspace),'Independent receiving changed the complete workspace.');
    await receiver.close();receiver=null;
    receiver=await chromium.launchPersistentContext(receivingProfile,{...launch,viewport:{width:390,height:844},acceptDownloads:true});
    receivingPage=receiver.pages()[0]||await receiver.newPage();receivingPage.on('pageerror',e=>errors.push(e.message));
    await receivingPage.goto(url,{waitUntil:'domcontentloaded'});await receivingPage.locator('[data-case]').first().waitFor();
    after=Curriculum.receiveCurriculumWorkspace(await receivingPage.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE));need(equal(after,exported.workspace),'Cold reopening changed the original received workspace.');
    await receivingPage.locator('[data-case="'+c.id+'"]').click();need(await receivingPage.locator('.badge').innerText()==='MATCH','The received original comparison is absent.');
    await receivingPage.screenshot({path:join(attempt,'case-mobile.png'),fullPage:true});list.push({path:relative(out,join(attempt,'case-mobile.png')),...await identity(join(attempt,'case-mobile.png'))});
    const dimensions=await receivingPage.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth}));need(dimensions.body<=dimensions.viewport,'Mobile layout overflows its viewport: '+JSON.stringify(dimensions));
    if(bulk){await receivingPage.locator('[data-tab="curriculum"]').click();await receivingPage.getByLabel('Bulk case',{exact:true}).selectOption(bulk.caseId);await receivingPage.getByLabel('Plan edition',{exact:true}).selectOption(bulkValue.planId);await receivingPage.screenshot({path:join(attempt,'curriculum-mobile.png'),fullPage:true});list.push({path:relative(out,join(attempt,'curriculum-mobile.png')),...await identity(join(attempt,'curriculum-mobile.png'))});}
    need(!errors.length,'Browser application errors: '+errors.join('\n'));
    await receiver.close();receiver=null;
    list.push(await record(join(attempt,'closed-received-workspace.json'),after),await record(join(attempt,'browser-errors.json'),errors));
    return {value:{caseId:c.id,revision:after.revision,runs:after.cases.find(x=>x.id===c.id).runs.length,dimensions,coldReopen:true,bulk:bulkValue},files:list};
  });
  active();
  for(const f of job.sources)need(equal(await identity(join(root,f.path)),{bytes:f.bytes,sha256:f.sha256}),'Original source changed during the course.');
  const result={schema:'curriculum-complete-receiving.v2',operation:OP,intentSha256,status:'COMPLETE',completedAt:new Date().toISOString(),sourceEdition:initial.editions[0].id,caseCount:initial.cases.length,workspaceCaseCount:source.cases.length,
    phases:[{name:'original-contracts',...validations,status:'COMPLETE'},{name:'cli-receiving',status:'COMPLETE'},{name:'typescript-compilation',status:'COMPLETE'},{name:'browser-edit-compare-decision-export-receive',caseId:browserResult.caseId,status:'COMPLETE'},{name:'sdk-and-whole-application-download',status:'COMPLETE'},{name:'mobile-layout',...browserResult.dimensions,status:'COMPLETE'},{name:'independent-cold-reopen',status:'COMPLETE'},{name:'curriculum-bulk',...browserResult.bulk}],files};
  await verifyFiles(files);await atomic(finalPath,result);console.log(JSON.stringify(result));
}catch(error){
  const value={schema:'curriculum-complete-receiving.v2',operation:OP,intentSha256,status:'INCOMPLETE',completedAt:new Date().toISOString(),signal:stopped.signal,error:{name:error.name,message:error.message,stack:error.stack},files};
  console.error(JSON.stringify(value));try{await atomic(finalPath,value);if(attempt)await atomic(join(attempt,'incomplete-result.json'),value);}catch(saveError){console.error(JSON.stringify({operation:OP,state:'RESULT_SAVE_FAILED',primary:value.error,error:saveError.message}));}process.exitCode=1;
}finally{
  for(const owned of [context,receiver,browser])if(owned)try{await owned.close();}catch(error){console.error(JSON.stringify({operation:OP,state:'BROWSER_CLOSE_FAILED',error:error.message}));process.exitCode=1;}
  if(server)await new Promise(done=>server.close(done));
}
