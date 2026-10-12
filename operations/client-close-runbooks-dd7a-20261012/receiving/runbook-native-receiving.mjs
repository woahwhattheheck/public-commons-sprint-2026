// MIT. One original accounting/runbook browser and CLI receiving operation.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat,readdir,cp,realpath,open,unlink} from 'node:fs/promises';
import {join,resolve,dirname,relative,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const PIN='8ac7de1d9d7ba43561ba84abae9a43759dafd9b3';
const PREFIX='stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace';
const OPERATION='SCF-CLIENT-CLOSE-RUNBOOKS-DD7A-20261012';
const UI_BLOBS={
  'public/runbooks.html':'71f5b330bd03ff01035f2aec8a02124f39db86c2',
  'public/runbooks.mjs':'4edfa5e031ab8247a90935765c8d23cd5ae5b05e',
  'public/runbooks.css':'8b2f252aab861ebea287232ca64ef98473b9e617'
};
const BUILDER_SHA='14bcf808d1d903e397df700fd05e2f9e13fc9da4c83fe3fdb213f740d75e521d';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function fileHash(path){const digest=createHash('sha256');for await(const bytes of createReadStream(path))digest.update(bytes);return digest.digest('hex');}
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const schema='stellar-forge.runbook-native-receiving.v1';
async function maybeJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(path,bytes){
  const tmp=path+'.'+randomUUID()+'.pending',fd=await open(tmp,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  await rename(tmp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
}
async function exact(path,bytes){
  try{assert.deepEqual(await readFile(path),bytes,'Existing retained bytes differ: '+path);return;}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(path,bytes,{flag:'wx',mode:0o600});
}
async function inventory(root){
  const items=[];
  const walk=async(path)=>{
    for(const name of (await readdir(path)).sort()){
      const file=join(path,name),info=await lstat(file);
      assert.ok(!info.isSymbolicLink(),'Original retained source must not redirect: '+file);
      if(info.isDirectory())await walk(file);
      else {assert.ok(info.isFile());const bytes=await readFile(file);items.push({path:relative(root,file).split(sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});}
    }
  };await walk(root);return items;
}
function routeIdentity(path){
  if(path==='/api/runbooks/books/save')return {kind:'edition_saved',target:null};
  if(path==='/api/runbooks/files')return {kind:'file_retained',target:null};
  if(path==='/api/runbooks/cycles')return {kind:'cycle_created',target:null};
  if(path==='/api/runbooks/receive')return {kind:'packet_received',target:null};
  const match=path.match(/^\/api\/runbooks\/cycles\/([^/]+)\/(work|submit|review)$/);
  assert.ok(match,'Use one original native runbook mutation route');
  return {kind:{work:'procedure_saved',submit:'preparation_submitted',review:'review_saved'}[match[2]],target:decodeURIComponent(match[1])};
}

export async function runRunbookReceiving(config){
  assert.equal(config.operationId??OPERATION,OPERATION);
  assert.equal(config.sourceCommit??PIN,PIN,'Use the frozen whole product source');
  const sourceRoot=await realpath(resolve(config.sourceRoot));
  const directory=resolve(config.directory);
  assert.ok(directory!==sourceRoot&&!directory.startsWith(sourceRoot+sep),'Retain private operation data outside the source checkout');
  await mkdir(directory,{recursive:true,mode:0o700});
  assert.equal(await realpath(directory),directory);
  const rootInfo=await lstat(directory);assert.equal(rootInfo.mode&0o077,0,'Use a private receiving directory');
  const statePath=join(directory,'operation.json');
  const input={
    schema,operationId:OPERATION,sourceCommit:PIN,sourceRoot,
    dependencyPackageJson:await realpath(resolve(config.dependencyPackageJson)),
    playwrightModule:await realpath(resolve(config.playwrightModule)),
    chromiumPath:await realpath(resolve(config.chromiumPath)),
    originalBuilder:await realpath(resolve(config.originalBuilder??join(dirname(fileURLToPath(import.meta.url)),'original-merchant-operation.mjs'))),
    directory,nativeRecord:config.nativeRecord?resolve(config.nativeRecord):null
  };
  assert.equal((await exec('git',['-C',sourceRoot,'rev-parse','HEAD'])).stdout.trim(),PIN);
  await exec('git',['-C',sourceRoot,'diff','--quiet',PIN,'--']);
  const sourceRows=[];
  for(const name of ['runbooks-workspace.mjs','runbooks-cli.mjs','RUNBOOKS.md','server.mjs','public/index.html',...Object.keys(UI_BLOBS)]){
    const path=join(sourceRoot,PREFIX,name),bytes=await readFile(path);
    const entry=(await exec('git',['-C',sourceRoot,'ls-tree',PIN,'--',PREFIX+'/'+name])).stdout.trim();
    const expected=entry.split(/\s+/)[2];assert.match(expected??'',/^[a-f0-9]{40}$/);
    assert.equal(gitBlob(bytes),expected,'Runtime source differs from the pinned original: '+name);
    if(UI_BLOBS[name])assert.equal(expected,UI_BLOBS[name]);
    sourceRows.push({path:PREFIX+'/'+name,bytes:bytes.length,blob:expected,sha256:hash(bytes)});
  }
  assert.equal(hash(await readFile(input.originalBuilder)),BUILDER_SHA);
  const sdkRequire=createRequire(input.dependencyPackageJson);
  const sdkModule=sdkRequire.resolve('@stellar/stellar-sdk');
  input.runtime={node:process.version,nodePath:process.execPath,stellarModule:sdkModule,
    chromiumSha256:await fileHash(input.chromiumPath)};
  input.source=sourceRows;
  await exact(join(directory,'input.json'),json(input));
  let state=await maybeJson(statePath);
  if(state){assert.equal(state.schema,schema);assert.equal(state.inputSha256,hash(json(input)));}
  else state={schema,operationId:OPERATION,inputSha256:hash(json(input)),sourceCommit:PIN,
    startedAt:new Date().toISOString(),phases:{},mutations:{},ids:{},downloads:{},observations:[],pageErrors:[],intentionalReplyLosses:[],result:'PREPARED'};
  let writes=Promise.resolve();
  const save=()=>{const bytes=json(state);const task=writes.then(()=>atomic(statePath,bytes));writes=task;return task;};
  const phase=async(name,fn)=>{
    if(state.phases[name]?.status==='COMPLETE')return state.phases[name].value;
    state.activePhase=name;state.phases[name]={...(state.phases[name]||{}),status:'RUNNING',startedAt:state.phases[name]?.startedAt??new Date().toISOString()};await save();
    const value=await fn();state.phases[name]={...state.phases[name],status:'COMPLETE',finishedAt:new Date().toISOString(),value:value??null};await save();
    process.stdout.write(JSON.stringify({operationId:OPERATION,phase:name,status:'COMPLETE',value})+'\n');return value;
  };
  if(state.result==='PASS')return state;
  const originalRoot=join(directory,'original-merchant');
  const original=await phase('original-merchant',async()=>{
    const prior=await maybeJson(join(originalRoot,'operation.json'));
    if(prior){assert.equal(prior.result,'PASS','Continue the original partially saved merchant operation before receiving');return prior;}
    try{await lstat(originalRoot);assert.fail('Original merchant directory exists without its retained result');}catch(error){if(error.code!=='ENOENT')throw error;}
    const {runOriginalMerchantOperation}=await import(pathToFileURL(input.originalBuilder).href);
    return runOriginalMerchantOperation({sourceRoot,directory:originalRoot,dependencyPackageJson:input.dependencyPackageJson,sourceCommit:PIN});
  });
  assert.equal(original.result,'PASS');assert.ok(original.runId&&original.closedHandoffId);
  state.ids.runId=original.runId;state.ids.handoffId=original.closedHandoffId;
  const originalWorkspace=join(originalRoot,'workspace');
  const aDir=join(directory,'workspace-original'),bDir=join(directory,'workspace-receiving');
  await mkdir(join(directory,'out'),{recursive:true,mode:0o700});
  await mkdir(join(directory,'cli'),{recursive:true,mode:0o700});
  const originalInventory=await phase('copy-original-stopped-workspace',async()=>{
    const files=await inventory(originalWorkspace);
    for(const target of [aDir,bDir]){
      let exists=false;try{await lstat(target);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!exists)await cp(originalWorkspace,target,{recursive:true,errorOnExist:true,force:false});
      assert.deepEqual(await inventory(target),files,'Copied stopped workspace must preserve every original input');
    }
    return files;
  });
  const nativeInputs=await phase('bind-original-merchant-inputs',async()=>({
    workspaceSha256:hash(json(originalInventory)),
    events:hash(await readFile(join(originalRoot,'outbox','events.ndjson'))),
    proof:hash(await readFile(join(originalRoot,'proofs','original-sf86.json'))),
    terms:hash(await readFile(join(originalRoot,'terms.json')))
  }));
  const {startAccountingWorkspace}=await import(pathToFileURL(join(sourceRoot,PREFIX,'server.mjs')).href);
  const {chromium}=await import(pathToFileURL(input.playwrightModule).href);
  let app,context,page,workspaceName,activeMutation=null;
  const responseJson=async response=>{
    const bytes=Buffer.from(await response.arrayBuffer());let value;try{value=JSON.parse(bytes);}catch{throw new Error('Native response is not complete JSON, HTTP '+response.status);}
    return {status:response.status,ok:response.ok,value};
  };
  const api=async(path,body)=>responseJson(await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error'}));
  const get=async(path)=>{const r=await api(path);assert.equal(r.ok,true,JSON.stringify(r.value));return r.value;};
  const idle=async()=>{
    await page.locator('#busy-status').waitFor({state:'hidden',timeout:30000});
    await page.waitForFunction(()=>!document.querySelector('#refresh')?.disabled,{timeout:30000});
  };
  const draftSaved=async()=>{await page.waitForFunction(()=>!/Saving private draft/.test(document.querySelector('#draft-status')?.textContent||''),{timeout:30000});};
  const openPage=async()=>{
    await page.goto(app.url+'/runbooks.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#workspace-id')?.title?.length>10,{timeout:30000});
    await idle();assert.equal(await page.locator('#workspace-id').getAttribute('title'),state.ids[workspaceName+'WorkspaceId']);
  };
  const switchWorkspace=async(name)=>{
    if(app&&workspaceName===name)return;
    await app?.close();app=null;
    app=await startAccountingWorkspace({directory:name==='original'?aDir:bDir,port:state.port||0});
    workspaceName=name;state.port=Number(new URL(app.url).port);
    const current=await get('/api/runbooks');const expected=state.ids[name+'WorkspaceId'];
    if(expected)assert.equal(current.workspaceId,expected);else state.ids[name+'WorkspaceId']=current.workspaceId;
    if(state.ids.originalWorkspaceId&&state.ids.receivingWorkspaceId)assert.notEqual(state.ids.originalWorkspaceId,state.ids.receivingWorkspaceId);
    await save();
    if(page)await openPage();
  };
  const openBook=async(id)=>{
    await idle();await page.locator('#book-search').fill('');
    const data=await get('/api/runbooks'),book=data.runbooks.find(row=>row.id===id);assert.ok(book);
    await page.locator('#book-list button').filter({has:page.locator('strong',{hasText:book.name})}).click();
    await page.locator('#book-detail h1').waitFor({state:'visible'});await idle();
    assert.equal((await get('/api/runbooks/books/'+id)).runbook.id,id);
  };
  const openCycle=async(id)=>{
    await idle();await page.locator('#cycle-search').fill('');await page.locator('#cycle-phase').selectOption('');
    const cycle=(await get('/api/runbooks/cycles/'+id)).cycle;
    await page.locator('#cycle-list button').filter({has:page.locator('strong',{hasText:cycle.label})}).click();
    await page.getByRole('heading',{name:cycle.label,exact:true}).waitFor({state:'visible'});await idle();
    await page.waitForFunction(path=>document.querySelector('#cycle-detail a[download]')?.getAttribute('href')===path,'/api/runbooks/cycles/'+id+'/packet');
    return cycle;
  };
  const reconcileMutation=async(key)=>{
    const row=state.mutations[key];if(!row?.input)return null;
    assert.equal(row.input.workspaceId,state.ids[workspaceName+'WorkspaceId']);
    const found=await api('/api/runbooks/operations/'+row.input.requestId);
    if(found.ok){
      const op=found.value.operation;
      assert.equal(op.kind,row.kind);assert.equal(op.target,row.target);assert.equal(op.requestSha256,row.requestSha256);
      row.result=op.result;row.status='COMMITTED';await save();return row.result;
    }
    assert.equal(found.status,404,JSON.stringify(found.value));assert.equal(found.value.error,'RUNBOOK_OPERATION_NOT_FOUND');
    if(row.response?.value?.applied===false)return null;
    return null;
  };
  const settleRecovery=async(expectedId)=>{
    if(await page.locator('#recovery').isVisible()){
      if(expectedId&&!(await page.locator('#recovery').textContent()).includes(expectedId))return;
      const button=page.locator('#recovery').getByRole('button',{name:'Check saved result',exact:true});
      if(await button.count())await button.click();else await page.locator('#recovery').getByRole('button',{name:'Complete saved recovery',exact:true}).click();
      await idle();await page.locator('#recovery').waitFor({state:'hidden'});
    }
  };
  const uiMutation=async(key,path,click,{rejectCode,lostReply=false}={})=>{
    if(state.mutations[key]?.input){
      const prior=await reconcileMutation(key);
      if(prior){await settleRecovery(state.mutations[key].input.requestId);return prior;}
      const row=state.mutations[key];
      if(row.response?.value?.applied===false){
        assert.equal(row.response.value.error,rejectCode,'Original mutation was explicitly rejected');return row.response.value;
      }
      await openPage();
      assert.equal(await page.locator('#recovery').isVisible(),true,'Original uncertain browser request must remain in IndexedDB');
      activeMutation={key,path,replaying:true,lostReply:false};
      try{
        await page.locator('#recovery').getByRole('button',{name:'Retry original save',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#recovery')?.hidden,{timeout:30000});await idle();
        const saved=await reconcileMutation(key);assert.ok(saved,'Exact replay must commit the original request');return saved;
      }finally{activeMutation=null;}
    }
    let resolveReply,rejectReply;
    const reply=new Promise((resolve,reject)=>{resolveReply=resolve;rejectReply=reject;});reply.catch(()=>{});
    const timeout=setTimeout(()=>rejectReply(new Error('The browser did not complete native mutation '+key)),45000);
    activeMutation={key,path,lostReply,resolveReply,rejectReply};
    try{
      await click();const returned=await reply;
      if(rejectCode){assert.equal(returned.ok,false);assert.equal(returned.value.error,rejectCode);assert.equal(returned.value.applied,false);await idle();return returned.value;}
      assert.equal(returned.ok,true,JSON.stringify(returned.value));
      if(lostReply){
        await page.locator('#recovery').waitFor({state:'visible'});await idle();
        await page.reload({waitUntil:'domcontentloaded'});await idle();
        await settleRecovery(state.mutations[key].input.requestId);
      }else await idle();
      await page.locator('#recovery').waitFor({state:'hidden'});
      const saved=await reconcileMutation(key);assert.ok(saved);return saved;
    }finally{clearTimeout(timeout);activeMutation=null;}
  };
  const installRoute=async()=>{
    await context.route('**/api/runbooks/**',async route=>{
      const request=route.request();
      if(request.method()!=='POST'){await route.continue();return;}
      const selected=activeMutation;
      if(!selected){await route.abort('failed');throw new Error('An unassigned browser mutation was attempted');}
      try{
        const path=new URL(request.url()).pathname;assert.equal(path,selected.path);
        const body=request.postDataJSON(),identity=routeIdentity(path);
        const requestSha256=hash(Buffer.from(canonical({...identity,input:body})));
        const existing=state.mutations[selected.key];
        if(existing?.input){assert.deepEqual(body,existing.input);assert.equal(requestSha256,existing.requestSha256);}
        else state.mutations[selected.key]={...identity,path,input:body,requestSha256,workspaceName,status:'PREPARED',preparedAt:new Date().toISOString()};
        await save();
        const response=await route.fetch({maxRetries:0}),bytes=await response.body();
        const value=JSON.parse(bytes),returned={status:response.status(),ok:response.ok(),value};
        state.mutations[selected.key].response=returned;
        state.mutations[selected.key].replySha256=hash(bytes);
        state.mutations[selected.key].status=response.ok()?'REPLY_RECEIVED':value.applied===false?'REJECTED':'UNCERTAIN';
        await save();
        if(selected.lostReply){state.intentionalReplyLosses.push(selected.key);await save();await route.abort('failed');}
        else await route.fulfill({response,body:bytes});
        selected.resolveReply?.(returned);
      }catch(error){selected.rejectReply?.(error);await route.abort('failed').catch(()=>{});}
    });
  };
  const setActor=async name=>{await idle();await page.locator('#operator-name').fill(name);await draftSaved();};
  const cli=async(args,{stopped=false}={})=>{
    const selector=stopped?['--workspace',workspaceName==='original'?aDir:bDir]:['--url',app.url];
    const result=await exec(process.execPath,[join(sourceRoot,PREFIX,'server.mjs'),'runbooks',...args,...selector],{maxBuffer:16*1024*1024});
    return JSON.parse(result.stdout);
  };
  const download=async(key,cycleId,format)=>{
    const path=join(directory,'out',key);
    if(state.downloads[key]){const bytes=await readFile(path);assert.equal(hash(bytes),state.downloads[key].sha256);return bytes;}
    const suffix={packet:'packet',print:'print',tasks:'tasks.csv'}[format];
    const href='/api/runbooks/cycles/'+cycleId+'/'+suffix;
    await page.waitForFunction(href=>!!document.querySelector('a[href="'+href+'"]'),href);
    const event=page.waitForEvent('download');await page.locator('a[href="'+href+'"]').click();
    const item=await event;assert.equal(await item.failure(),null);
    const bytes=await readFile(await item.path());await exact(path,bytes);
    state.downloads[key]={path,bytes:bytes.length,sha256:hash(bytes),suggestedFilename:item.suggestedFilename(),cycleId,format};await save();return bytes;
  };
  const screenshot=async(name,width=1440)=>{
    await page.setViewportSize({width,height:1000});await idle();
    await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.evaluate(()=>({
      viewport:innerWidth,width:document.documentElement.scrollWidth,
      body:document.body.scrollWidth,
      offenders:[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&(r.left<-.5||r.right>innerWidth+.5);}).slice(0,15).map(n=>({tag:n.tagName,id:n.id,className:n.className,width:n.getBoundingClientRect().width}))
    }));
    const path=join(directory,'out',name+'.png');await page.screenshot({path,fullPage:true});
    state.observations.push({name,metrics,path,sha256:hash(await readFile(path))});await save();
    assert.ok(metrics.width<=width+1&&metrics.body<=width+1,JSON.stringify({name,...metrics}));
  };


  const BOOK='Merchant close preparation and reviewer handover';
  const CLIENT='Native merchant receiving';
  const PERIOD='October 2026 retained merchant close';
  const NEXT='November 2026 local continuation';
  const FILE_PERIOD='October 2026 close from retained client files';
  const FILE_NEXT='November 2026 close from explicitly selected files';
  const PREPARER='Receiving preparer',REVIEWER='Receiving reviewer';
  const STEP1='Reconcile the selected original close';
  const STEP2='Resolve and hand over open items';
  const NOTE_RESOURCE='Reviewer instructions';
  const FILE_RESOURCE='Original retained close file';
  const DESCRIPTION='Use the selected original close input, record the preparation, return corrections to the preparer, and retain the approved handover for the next period.';
  const INSTRUCTION1='Read the exact selected handoff and its frozen adjustment totals. Preserve gross receipts separately from returned amounts. Retain the source file and identify the selected handoff and accountant revision in the work note.';
  const INSTRUCTION2='Identify open items, assign the next action and owner, and record whether each item is complete or needs an explicit reviewer exception.';
  const COMBINED_INSTRUCTION=INSTRUCTION1+'\nThe operator also checks that the source run and closed-period ID agree with the selected original handoff.';
  const resourceCards=()=>page.locator('#author-resources .editor-card');
  const stepCards=()=>page.locator('#author-steps .editor-card');
  const currentCycle=async id=>(await get('/api/runbooks/cycles/'+id)).cycle;
  const schedule=async({bookId=state.ids.bookId,editionId=state.ids.editionId,label,dueDate='2026-11-15',previousCycleId,mode='accountant'}={})=>{
    if(previousCycleId){await openCycle(previousCycleId);await page.getByRole('button',{name:'Start following period',exact:true}).click();}
    else {await idle();await page.locator('#new-cycle').click();}
    await page.locator('#view-schedule').waitFor({state:'visible'});await idle();
    if(await page.locator('#schedule-book').inputValue()!==bookId){
      await page.locator('#schedule-book').selectOption(bookId);
      await page.waitForFunction(id=>!!document.querySelector('#schedule-edition option[value="'+id+'"]'),editionId);await idle();
    }
    await page.locator('#schedule-edition').selectOption(editionId);
    await page.locator('#schedule-source-kind').selectOption(mode);
    await page.locator('#schedule-label').fill(label);
    await page.locator('#schedule-due').fill(dueDate);
    await page.locator('#schedule-preparer').fill(PREPARER);
    await page.locator('#schedule-reviewer').fill(REVIEWER);
    if(mode==='accountant'){
      await page.locator('#schedule-handoff').selectOption(state.ids.handoffId);
      await page.locator('#schedule-accountant-revision').selectOption('initial');
      const sources=await get('/api/runbooks/sources'),selected=sources.handoffs.find(row=>row.id===state.ids.handoffId);
      assert.ok(selected?.closeId,'Use the original closed-period handoff');
      await page.locator('#schedule-close').selectOption(selected.closeId);state.ids.closeId=selected.closeId;await save();
    }
    await draftSaved();
  };
  const saveTask=async(key,cycleId,stepIndex,status,note,{attach=false}={})=>{
    if(state.mutations[key]?.input)return uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/work',()=>{});
    const step=(await currentCycle(cycleId)).edition.steps[stepIndex];
    await openCycle(cycleId);
    await page.locator('#cycle-step-nav button').nth(stepIndex).click();await idle();
    await page.getByRole('heading',{name:step.title,exact:true}).waitFor({state:'visible'});
    const row=state.mutations[key];
    if(!row?.input){
      await setActor(PREPARER);
      await page.locator('#cycle-step').getByLabel('Task status',{exact:true}).selectOption(status);
      await page.locator('#cycle-step').getByLabel('Work performed, result or reason',{exact:true}).fill(note);
      if(attach)await page.locator('#cycle-step .check-row').filter({hasText:state.originalFile.name}).locator('input[type=checkbox]').check();
      await draftSaved();
    }
    await uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/work',()=>page.getByRole('button',{name:'Save task preparation',exact:true}).click());
    const saved=(await currentCycle(cycleId)).work[step.id];assert.equal(saved.status,status);assert.equal(saved.note,note);
    if(attach)assert.ok(saved.fileIds.includes(state.ids.fileId));
    return saved;
  };
  const submit=async(key,cycleId,note)=>{
    if(state.mutations[key]?.input)return uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/submit',()=>{});
    await openCycle(cycleId);await setActor(PREPARER);
    if(!state.mutations[key]?.input)await page.locator('#cycle-preparation').getByLabel('Preparation handover note',{exact:true}).fill(note);
    const result=await uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/submit',()=>page.getByRole('button',{name:'Submit preparation for review',exact:true}).click());
    assert.equal((await currentCycle(cycleId)).phase,'IN_REVIEW');return result;
  };
  const review=async(key,cycleId,decision,note,{accept=false}={})=>{
    if(state.mutations[key]?.input)return uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/review',()=>{});
    await openCycle(cycleId);await setActor(REVIEWER);
    if(!state.mutations[key]?.input){
      await page.locator('#cycle-review').getByLabel('Review decision',{exact:true}).selectOption(decision);
      await page.locator('#cycle-review').getByLabel('Review note',{exact:true}).fill(note);
      if(accept)await page.locator('#cycle-review input[type=checkbox]').check();
    }
    const result=await uiMutation(key,'/api/runbooks/cycles/'+cycleId+'/review',()=>page.getByRole('button',{name:'Record review decision',exact:true}).click());
    assert.equal((await currentCycle(cycleId)).phase,decision==='APPROVE'?'APPROVED':'CHANGES_REQUESTED');return result;
  };
  const checkPacket=(bytes,cycleId,{mode='accountant'}={})=>{
    const packet=JSON.parse(bytes),{sha256,...payload}=packet;
    assert.equal(sha256,hash(Buffer.from(canonical(payload))));
    assert.equal(packet.cycle.id,cycleId);assert.equal(packet.cycle.phase,'APPROVED');assert.equal(packet.cycle.source.kind,mode);
    assert.equal(packet.cycle.editionId,state.ids.editionId);
    for(const row of [...packet.attachments,...packet.sourceFiles]){
      const body=Buffer.from(row.content,'base64');assert.equal(body.length,row.bytes);assert.equal(hash(body),row.sha256);
    }
    assert.ok(packet.attachments.some(file=>file.id===state.ids.fileId&&file.sha256===state.originalFile.sha256));
    if(mode==='accountant'){
      assert.equal(packet.cycle.source.handoffId,state.ids.handoffId);
      assert.equal(packet.cycle.source.runId,state.ids.runId);
      assert.equal(packet.cycle.source.accountantRevisionId,'initial');
      assert.equal(packet.cycle.source.periodCloseId,state.ids.closeId);
      const originalHandoff=JSON.parse(Buffer.from(packet.sourceFiles.find(row=>row.name==='handoff.json').content,'base64'));
      assert.equal(originalHandoff.rows[0].adjustments.grossAmountAtomic,'100');
      assert.equal(originalHandoff.rows[0].adjustments.refundedAmountAtomic,'40');
      assert.equal(originalHandoff.rows[0].adjustments.remainingAmountAtomic,'60');
      assert.equal(packet.cycle.submissions.length,2);assert.equal(packet.cycle.reviews.length,2);
      assert.deepEqual(packet.cycle.reviews.map(row=>row.decision),['RETURN','APPROVE']);
    }else{
      assert.equal(packet.sourceFiles.length,0);
      assert.deepEqual(packet.cycle.source.files.map(row=>row.id),[state.ids.fileId]);
      const {sha256:sourceHash,...source}=packet.cycle.source;
      assert.equal(sourceHash,hash(Buffer.from(canonical(source))));
    }
    return packet;
  };
  try{
    await switchWorkspace('original');
    context=await chromium.launchPersistentContext(join(directory,'browser-profile'),{
      executablePath:input.chromiumPath,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
      args:['--no-sandbox','--disable-dev-shm-usage']
    });
    page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>{state.pageErrors.push({at:new Date().toISOString(),message:error.message,stack:error.stack});save().catch(()=>{});});
    await installRoute();await openPage();
    await phase('select-original-file',async()=>{
      const selected=app.accountant.row(state.ids.handoffId);
      const metadata=selected.files.find(file=>file.name.endsWith('.csv'))??selected.files.find(file=>file.name==='handoff.json');
      assert.ok(metadata,'The original accountant handoff contains its native working file');
      const file=await app.accountant.file(state.ids.handoffId,metadata.name,{revisionId:'initial'});
      assert.equal(hash(file.bytes),metadata.sha256);
      const target=join(directory,'out','original-'+metadata.name);await exact(target,file.bytes);
      state.originalFile={path:target,name:metadata.name,bytes:file.bytes.length,sha256:hash(file.bytes),type:file.type.split(';')[0]};await save();
      return state.originalFile;
    });
    await phase('author-and-original-file-upload',async()=>{
      await setActor(PREPARER);await page.locator('#new-runbook').click();
      await page.locator('#view-author').waitFor({state:'visible'});await idle();
      while(await resourceCards().count()<1){await page.locator('#add-resource').click();await idle();}
      let card=resourceCards().nth(0);
      await card.getByLabel('Resource title',{exact:true}).fill(FILE_RESOURCE);
      await card.getByLabel('Resource type',{exact:true}).selectOption('file');await idle();card=resourceCards().nth(0);
      if(!state.mutations['source-file-upload']?.input)await card.locator('input[type=file]').setInputFiles(state.originalFile.path);
      const saved=await uiMutation('source-file-upload','/api/runbooks/files',()=>resourceCards().nth(0).getByRole('button',{name:'Upload document',exact:true}).click());
      state.ids.fileId=saved.file.id;assert.equal(saved.file.sha256,state.originalFile.sha256);await save();
      return {file:saved.file};
    });
    await phase('author-private-draft-and-reload',async()=>{
      await page.locator('#new-runbook').click();await page.locator('#view-author').waitFor({state:'visible'});await idle();
      await page.locator('#author-name').fill(BOOK);await page.locator('#author-client').fill(CLIENT);await page.locator('#author-description').fill(DESCRIPTION);
      while(await resourceCards().count()<2){await page.locator('#add-resource').click();await idle();}
      let note=resourceCards().nth(1);await note.getByLabel('Resource title',{exact:true}).fill(NOTE_RESOURCE);
      await note.getByLabel('Resource type',{exact:true}).selectOption('note');note=resourceCards().nth(1);
      await note.getByLabel('Working note',{exact:true}).fill('Read the original amounts and source identifiers. A reviewer returns unclear work to the preparer and explicitly accepts any required open item with its owner and next action.');
      while(await stepCards().count()<2){await page.locator('#add-step').click();await idle();}
      for(const [index,title,instructions]of [[0,STEP1,INSTRUCTION1],[1,STEP2,INSTRUCTION2]]){
        const card=stepCards().nth(index);await card.getByLabel('Task title',{exact:true}).fill(title);await card.getByLabel('Instructions',{exact:true}).fill(instructions);
        await card.getByLabel('Required for period preparation',{exact:true}).check();
        for(const resource of [FILE_RESOURCE,NOTE_RESOURCE])await card.locator('.check-row').filter({hasText:resource}).locator('input[type=checkbox]').check();
      }
      await draftSaved();await page.reload({waitUntil:'domcontentloaded'});await idle();
      await page.locator('#view-author').waitFor({state:'visible'});
      assert.equal(await page.locator('#author-name').inputValue(),BOOK);
      assert.equal(await page.locator('#author-description').inputValue(),DESCRIPTION);
      assert.equal(await stepCards().nth(0).getByLabel('Instructions',{exact:true}).inputValue(),INSTRUCTION1);
      assert.equal(await resourceCards().nth(0).getByLabel('Retained document',{exact:true}).inputValue(),state.ids.fileId);
      await screenshot('runbook-procedure-draft-desktop');
      return {steps:2,resources:2,privateDraftReopened:true};
    });
    await phase('save-edition-after-lost-reply',async()=>{
      const saved=await uiMutation('edition-initial','/api/runbooks/books/save',()=>page.getByRole('button',{name:'Save edition',exact:true}).click(),{lostReply:true});
      state.ids.bookId=saved.runbookId;state.ids.editionId=saved.editionId;await save();
      const book=(await get('/api/runbooks/books/'+saved.runbookId)).runbook;assert.equal(book.editions.length,1);
      const edition=book.editions[0];assert.equal(edition.steps.length,2);assert.equal(edition.resources.length,2);
      state.ids.stepIds=edition.steps.map(step=>step.id);await save();
      return {runbookId:saved.runbookId,editionId:saved.editionId,originalRequest:state.mutations['edition-initial'].input.requestId};
    });
    await phase('create-accountant-period',async()=>{
      await setActor(PREPARER);
      if(!state.mutations['accountant-period']?.input)await schedule({label:PERIOD});
      const saved=await uiMutation('accountant-period','/api/runbooks/cycles',()=>page.getByRole('button',{name:'Create period',exact:true}).click());
      state.ids.accountantCycleId=saved.cycleId;await save();
      const cycle=await currentCycle(saved.cycleId);assert.equal(cycle.phase,'DRAFT');assert.equal(cycle.source.kind,'accountant');assert.equal(cycle.source.handoffId,state.ids.handoffId);
      assert.equal(cycle.source.source.adjustments.sha256,(await app.accountant.readHandoff(state.ids.handoffId)).source.adjustments.sha256);
      return {cycleId:saved.cycleId,source:cycle.source};
    });
    await phase('first-preparation',async()=>{
      await saveTask('prepare-original-close',state.ids.accountantCycleId,0,'COMPLETE','Reviewed original gross 100, verified returned 40 and remaining 60 in the selected frozen close.',{attach:true});
      await saveTask('prepare-open-item',state.ids.accountantCycleId,1,'BLOCKED','The next-period source has not arrived. Receiving preparer owns its selection on 2026-11-01; reviewer approval explicitly retains this follow-up.');
      await submit('submit-first',state.ids.accountantCycleId,'Original close prepared; the next-period input remains an assigned open item.');
      return {cycleId:state.ids.accountantCycleId,phase:'IN_REVIEW'};
    });
    await phase('return-correct-resubmit-approve',async()=>{
      await review('review-return',state.ids.accountantCycleId,'RETURN','Include the exact original handoff ID and accountant revision in the reconciliation work note.');
      const corrected='Reviewed gross 100, verified returned 40 and remaining 60. Original handoff '+state.ids.handoffId+', accountant revision initial, source run '+state.ids.runId+'.';
      await saveTask('prepare-corrected-close',state.ids.accountantCycleId,0,'COMPLETE',corrected,{attach:true});
      await submit('submit-corrected',state.ids.accountantCycleId,'The returned source identification is now recorded; the assigned next-period input remains explicit.');
      await review('review-approved',state.ids.accountantCycleId,'APPROVE','Accepted the required open item: Receiving preparer will select the original November source when it arrives, before starting that close.',{accept:true});
      const cycle=await currentCycle(state.ids.accountantCycleId);assert.equal(cycle.phase,'APPROVED');assert.equal(cycle.submissions.length,2);assert.equal(cycle.reviews.length,2);
      assert.equal(cycle.submissions[0].work[state.ids.stepIds[0]].note.includes(state.ids.handoffId),false);
      assert.equal(cycle.submissions[1].work[state.ids.stepIds[0]].note,corrected);
      assert.deepEqual(cycle.reviews[1].acceptedExceptions,[state.ids.stepIds[1]]);
      await openCycle(cycle.id);await screenshot('runbook-approved-close-desktop');
      await screenshot('runbook-approved-close-390',390);
      await page.setViewportSize({width:1440,height:1000});
      return {cycleId:cycle.id,submissions:2,reviews:2,exception:state.ids.stepIds[1]};
    });


    await phase('open-next-edition-private-draft',async()=>{
      await openBook(state.ids.bookId);await page.getByRole('button',{name:'Create next edition',exact:true}).click();
      await page.locator('#view-author').waitFor({state:'visible'});await idle();
      await page.locator('#author-description').fill(DESCRIPTION+'\nDraft clarification: retain the closed-period identity alongside each reviewer handover.');
      await stepCards().nth(0).getByLabel('Instructions',{exact:true}).fill(COMBINED_INSTRUCTION);
      await draftSaved();
      return {basis:state.ids.editionId};
    });
    await phase('original-cli-concurrent-edition',async()=>{
      const initial=(await get('/api/runbooks/books/'+state.ids.bookId)).runbook.editions.find(row=>row.id===state.ids.editionId);
      const cliInput={actor:REVIEWER,runbookId:state.ids.bookId,expectedEditionId:state.ids.editionId,
        name:initial.name,client:initial.client,description:DESCRIPTION+'\nReviewer clarification: retain the selected source run and original closed-period ID.',
        steps:initial.steps.map((step,index)=>({...step,instructions:index===0?COMBINED_INSTRUCTION:step.instructions})),resources:initial.resources};
      const inputPath=join(directory,'cli','reviewer-edition-input.json'),preparedPath=join(directory,'cli','reviewer-edition-request.json');
      await exact(inputPath,json(cliInput));
      const existing=await maybeJson(preparedPath);
      if(!existing)await cli(['prepare','--action','save','--input',inputPath,'--out',preparedPath]);
      const prepared=JSON.parse(await readFile(preparedPath,'utf8'));
      assert.equal(prepared.input.workspaceId,state.ids.originalWorkspaceId);
      assert.equal(prepared.requestSha256,hash(Buffer.from(canonical({kind:prepared.kind,target:prepared.target,input:prepared.input}))));
      let reconciled=await cli(['reconcile','--prepared',preparedPath]);
      if(reconciled.status==='NOT_FOUND')await cli(['execute','--prepared',preparedPath]);
      reconciled=await cli(['reconcile','--prepared',preparedPath]);assert.equal(reconciled.status,'COMMITTED');
      assert.equal(reconciled.operation.requestSha256,prepared.requestSha256);
      const replay=await cli(['execute','--prepared',preparedPath]);assert.equal(replay.duplicate,true);
      state.ids.cliEditionId=reconciled.operation.result.editionId;
      state.cliPrepared={path:preparedPath,sha256:hash(await readFile(preparedPath)),requestId:prepared.input.requestId};await save();
      const book=(await get('/api/runbooks/books/'+state.ids.bookId)).runbook;assert.equal(book.editions.length,2);
      assert.equal((await currentCycle(state.ids.accountantCycleId)).editionId,state.ids.editionId);
      return {editionId:state.ids.cliEditionId,requestId:prepared.input.requestId,reconciled:true,replayed:true};
    });
    await phase('browser-stale-revision-correction',async()=>{
      await uiMutation('edition-stale','/api/runbooks/books/save',()=>page.getByRole('button',{name:'Save edition',exact:true}).click(),{rejectCode:'STALE_WORKSPACE'});
      if(!state.mutations['edition-corrected']?.input){
        if(await page.locator('#recovery').isVisible()){
          await page.locator('#recovery').getByRole('button',{name:'Review current source and correct',exact:true}).click();
          await page.getByRole('button',{name:'Use current source and return to draft',exact:true}).waitFor({state:'visible'});await idle();
          await page.getByRole('button',{name:'Use current source and return to draft',exact:true}).click();
          await page.locator('#recovery').waitFor({state:'hidden'});await idle();
        }else{await page.locator('#new-runbook').click();await idle();}
        await page.locator('#author-description').fill(DESCRIPTION+'\nReviewer clarification: retain the selected source run and original closed-period ID.\nMerged preparation clarification: retain that identity alongside each handover.');
        await stepCards().nth(0).getByLabel('Instructions',{exact:true}).fill(COMBINED_INSTRUCTION);await draftSaved();
      }
      const result=await uiMutation('edition-corrected','/api/runbooks/books/save',()=>page.getByRole('button',{name:'Save edition',exact:true}).click());
      state.ids.latestEditionId=result.editionId;await save();
      assert.notEqual(state.mutations['edition-stale'].input.requestId,state.mutations['edition-corrected'].input.requestId);
      assert.equal(state.mutations['edition-corrected'].input.expectedEditionId,state.ids.cliEditionId);
      const book=(await get('/api/runbooks/books/'+state.ids.bookId)).runbook;assert.equal(book.editions.length,3);assert.equal(book.latestEditionId,result.editionId);
      const frozen=await currentCycle(state.ids.accountantCycleId);assert.equal(frozen.editionId,state.ids.editionId);
      assert.equal(frozen.edition.steps[0].instructions,INSTRUCTION1);
      return {rejectedRequestId:state.mutations['edition-stale'].input.requestId,newEditionId:result.editionId,frozenEditionId:frozen.editionId};
    });
    await phase('approved-period-native-downloads',async()=>{
      await openCycle(state.ids.accountantCycleId);
      const packetBytes=await download('approved-accountant-close.json',state.ids.accountantCycleId,'packet');
      const packet=checkPacket(packetBytes,state.ids.accountantCycleId);
      const printable=await download('approved-accountant-close.html',state.ids.accountantCycleId,'print');
      const tasks=await download('approved-accountant-close-tasks.csv',state.ids.accountantCycleId,'tasks');
      assert.ok(printable.toString('utf8').includes(state.ids.accountantCycleId));
      assert.ok(tasks.toString('utf8').includes(STEP1)&&tasks.toString('utf8').includes('BLOCKED'));
      const cliPacket=join(directory,'out','approved-accountant-cli.json');
      const command=await cli(['download','--id',state.ids.accountantCycleId,'--format','packet','--out',cliPacket]);
      assert.equal(command.file.sha256,hash(packetBytes));assert.deepEqual(await readFile(cliPacket),packetBytes);
      const filePath=join(directory,'out','cli-original-close-file');
      const file=await cli(['file','--id',state.ids.fileId,'--out',filePath]);
      assert.equal(file.file.sha256,state.originalFile.sha256);
      return {packetSha256:packet.sha256,bytes:packetBytes.length,sourceFiles:packet.sourceFiles.length,attachments:packet.attachments.length};
    });
    await phase('retain-original-workspace-next-period-draft',async()=>{
      await setActor(PREPARER);await schedule({label:'Original workspace private following-period draft',previousCycleId:state.ids.accountantCycleId});
      await draftSaved();await page.reload({waitUntil:'domcontentloaded'});await idle();
      await page.locator('#view-schedule').waitFor({state:'visible'});
      assert.equal(await page.locator('#schedule-label').inputValue(),'Original workspace private following-period draft');
      return {workspaceId:state.ids.originalWorkspaceId,label:'Original workspace private following-period draft'};
    });
    await switchWorkspace('receiving');
    await phase('same-port-workspace-isolation',async()=>{
      assert.equal(await page.locator('#workspace-id').getAttribute('title'),state.ids.receivingWorkspaceId);
      assert.equal(await page.locator('#recovery').isVisible(),false);
      assert.equal(await page.locator('#view-schedule').isVisible(),false);
      assert.equal(await page.locator('#schedule-label').inputValue(),'');
      const root=await get('/api/runbooks');assert.equal(root.cycles.length,0);assert.equal(root.runbooks.length,0);
      return {port:state.port,originalWorkspaceId:state.ids.originalWorkspaceId,receivingWorkspaceId:state.ids.receivingWorkspaceId};
    });
    await phase('receive-approved-original-packet',async()=>{
      await setActor(REVIEWER);
      if(!state.mutations['receive-accountant']?.input){
        await page.locator('[data-go=receive]').click();await idle();
        await page.locator('#receive-file').setInputFiles(join(directory,'out','approved-accountant-close.json'));
      }
      const result=await uiMutation('receive-accountant','/api/runbooks/receive',()=>page.locator('#receive-form button[type=submit]').click());
      assert.equal(result.cycleId,state.ids.accountantCycleId);
      assert.equal(result.received.sha256,state.downloads['approved-accountant-close.json'].sha256);
      const cycle=await currentCycle(result.cycleId);assert.equal(cycle.readOnly,true);assert.equal(cycle.originWorkspaceId,state.ids.originalWorkspaceId);
      await openCycle(cycle.id);
      assert.equal(await page.getByRole('button',{name:'Save task preparation',exact:true}).count(),0);
      const received=await download('received-approved-accountant-close.json',cycle.id,'packet');
      assert.equal(hash(received),state.downloads['approved-accountant-close.json'].sha256);
      const first=JSON.parse(await readFile(join(directory,'out','approved-accountant-close.json'),'utf8'));
      assert.deepEqual(cycle.edition,first.edition);assert.deepEqual(cycle.source,first.cycle.source);
      return {cycleId:cycle.id,readOnly:true,originalPacketSha256:hash(received)};
    });
    await phase('fresh-local-next-accountant-period',async()=>{
      await setActor(PREPARER);
      if(!state.mutations['next-accountant-period']?.input){
        await openCycle(state.ids.accountantCycleId);await page.getByRole('button',{name:'Start following period',exact:true}).click();await idle();
        assert.equal(await page.locator('#schedule-handoff').inputValue(),'');
        assert.equal(await page.locator('#schedule-accountant-revision').inputValue(),'');
        await schedule({label:NEXT,dueDate:'2026-12-15'});
      }
      const result=await uiMutation('next-accountant-period','/api/runbooks/cycles',()=>page.getByRole('button',{name:'Create period',exact:true}).click());
      state.ids.nextAccountantCycleId=result.cycleId;await save();
      const cycle=await currentCycle(result.cycleId);assert.equal(cycle.previousCycleId,state.ids.accountantCycleId);assert.equal(cycle.readOnly,false);
      assert.equal(cycle.source.originWorkspaceId,state.ids.receivingWorkspaceId);
      assert.ok(Object.values(cycle.work).every(work=>work.status==='PENDING'&&work.note===''&&work.fileIds.length===0));
      assert.equal(cycle.submissions.length,0);assert.equal(cycle.reviews.length,0);
      return {cycleId:cycle.id,previousCycleId:cycle.previousCycleId,freshWork:true,source:cycle.source};
    });
    await phase('create-original-client-files-close',async()=>{
      await setActor(PREPARER);
      if(!state.mutations['files-period']?.input){
        await schedule({label:FILE_PERIOD,mode:'files'});
        await page.locator('#schedule-source-label').fill('October close source selected from the retained client working file');
        await page.locator('#schedule-source-note').fill('Use the original '+state.originalFile.name+' file carried in the received close. Its retained byte hash is '+state.originalFile.sha256+'.');
        await page.locator('#schedule-source-files .check-row').filter({hasText:state.originalFile.name}).locator('input[type=checkbox]').check();
        assert.equal(await page.locator('#schedule-handoff').isDisabled(),true);
        await draftSaved();await page.reload({waitUntil:'domcontentloaded'});await idle();
        assert.equal(await page.locator('#schedule-source-kind').inputValue(),'files');
        assert.equal(await page.locator('#schedule-source-files input[type=checkbox]:checked').count(),1);
      }
      const result=await uiMutation('files-period','/api/runbooks/cycles',()=>page.getByRole('button',{name:'Create period',exact:true}).click());
      state.ids.filesCycleId=result.cycleId;await save();
      const cycle=await currentCycle(result.cycleId);assert.equal(cycle.source.kind,'files');assert.equal(Object.hasOwn(cycle.source,'handoffId'),false);
      assert.equal(cycle.source.files[0].id,state.ids.fileId);assert.equal(cycle.source.files[0].sha256,state.originalFile.sha256);
      return {cycleId:cycle.id,source:cycle.source};
    });
    await phase('prepare-review-client-files-close',async()=>{
      await saveTask('files-reconcile',state.ids.filesCycleId,0,'COMPLETE','Read the selected original client close file '+state.originalFile.name+' and retained its exact source hash '+state.originalFile.sha256+'.',{attach:true});
      await saveTask('files-open-items',state.ids.filesCycleId,1,'NOT_APPLICABLE','This file-only receiving period has no additional open-item collection. The selected original document is the complete scope of this preparation.');
      await submit('files-submit',state.ids.filesCycleId,'Prepared the selected client file with explicit original byte identity.');
      await review('files-approve',state.ids.filesCycleId,'APPROVE','Reviewed the selected original file and its scope. No required blocked exceptions remain.');
      const cycle=await currentCycle(state.ids.filesCycleId);assert.equal(cycle.phase,'APPROVED');
      await openCycle(cycle.id);await screenshot('runbook-client-files-close-desktop');
      await screenshot('runbook-client-files-close-390',390);await page.setViewportSize({width:1440,height:1000});
      const packet=checkPacket(await download('approved-client-files-close.json',cycle.id,'packet'),cycle.id,{mode:'files'});
      await download('approved-client-files-close.html',cycle.id,'print');await download('approved-client-files-close-tasks.csv',cycle.id,'tasks');
      return {cycleId:cycle.id,packetSha256:packet.sha256,sourceFiles:packet.sourceFiles.length,attachments:packet.attachments.length};
    });
    await phase('receiving-workspace-reopen',async()=>{
      await app.close();app=null;workspaceName=null;await switchWorkspace('receiving');
      const cycle=await currentCycle(state.ids.filesCycleId);assert.equal(cycle.phase,'APPROVED');
      const received=await api('/api/runbooks/cycles/'+state.ids.accountantCycleId);assert.equal(received.value.cycle.readOnly,true);
      await openCycle(state.ids.filesCycleId);
      return {workspaceId:state.ids.receivingWorkspaceId,approvedCycleId:cycle.id,receivedCycleId:state.ids.accountantCycleId};
    });
    await switchWorkspace('original');
    await phase('restore-original-draft-after-workspace-switch',async()=>{
      await page.locator('#view-schedule').waitFor({state:'visible'});
      assert.equal(await page.locator('#schedule-label').inputValue(),'Original workspace private following-period draft');
      assert.equal(await page.locator('#schedule-source-kind').inputValue(),'accountant');
      await page.locator('#schedule-discard').click();await idle();
      const book=(await get('/api/runbooks/books/'+state.ids.bookId)).runbook;assert.equal(book.latestEditionId,state.ids.latestEditionId);
      return {workspaceId:state.ids.originalWorkspaceId,originalDraftRestored:true,latestEditionId:book.latestEditionId};
    });
    await phase('receive-client-files-packet-in-original-workspace',async()=>{
      await setActor(REVIEWER);
      if(!state.mutations['receive-files']?.input){await page.locator('[data-go=receive]').click();await page.locator('#receive-file').setInputFiles(join(directory,'out','approved-client-files-close.json'));}
      const result=await uiMutation('receive-files','/api/runbooks/receive',()=>page.locator('#receive-form button[type=submit]').click());
      assert.equal(result.cycleId,state.ids.filesCycleId);
      const book=(await get('/api/runbooks/books/'+state.ids.bookId)).runbook;assert.equal(book.latestEditionId,state.ids.latestEditionId);assert.equal(book.editions.length,3);
      const cycle=await currentCycle(state.ids.filesCycleId);assert.equal(cycle.readOnly,true);assert.equal(cycle.source.kind,'files');
      await openCycle(cycle.id);
      const bytes=await download('received-client-files-close.json',cycle.id,'packet');
      assert.equal(hash(bytes),state.downloads['approved-client-files-close.json'].sha256);
      return {cycleId:cycle.id,latestEditionPreserved:book.latestEditionId,packetSha256:hash(bytes)};
    });
    await phase('next-original-files-period',async()=>{
      await setActor(PREPARER);
      if(!state.mutations['next-files-period']?.input){
        await openCycle(state.ids.filesCycleId);await page.getByRole('button',{name:'Start following period',exact:true}).click();await idle();
        assert.equal(await page.locator('#schedule-source-kind').inputValue(),'files');
        assert.equal(await page.locator('#schedule-source-label').inputValue(),'');
        assert.equal(await page.locator('#schedule-source-files input[type=checkbox]:checked').count(),0);
        await schedule({label:FILE_NEXT,dueDate:'2026-12-15',mode:'files'});
        await page.locator('#schedule-source-label').fill('Following receiving period selected original close file');
        await page.locator('#schedule-source-note').fill('This continuation explicitly selects the existing retained file again; the previous period supplies procedure context.');
        await page.locator('#schedule-source-files .check-row').filter({hasText:state.originalFile.name}).locator('input[type=checkbox]').check();
      }
      const result=await uiMutation('next-files-period','/api/runbooks/cycles',()=>page.getByRole('button',{name:'Create period',exact:true}).click());
      state.ids.nextFilesCycleId=result.cycleId;await save();
      const cycle=await currentCycle(result.cycleId);assert.equal(cycle.previousCycleId,state.ids.filesCycleId);
      assert.equal(cycle.readOnly,false);assert.equal(cycle.source.originWorkspaceId,state.ids.originalWorkspaceId);
      assert.ok(Object.values(cycle.work).every(work=>work.status==='PENDING'&&work.note===''));
      await openCycle(cycle.id);await screenshot('runbook-following-files-period-390',390);
      return {cycleId:cycle.id,previousCycleId:cycle.previousCycleId,freshSourceSelection:true};
    });
    await phase('same-original-stopped-owner-cli',async()=>{
      await context.close();context=null;page=null;await app.close();app=null;
      const cycle=await cli(['cycle','--id',state.ids.nextFilesCycleId],{stopped:true});assert.equal(cycle.cycle.phase,'DRAFT');
      const originalResult=await cli(['reconcile','--prepared',state.cliPrepared.path],{stopped:true});
      assert.equal(originalResult.status,'COMMITTED');assert.equal(originalResult.operation.result.editionId,state.ids.cliEditionId);
      const target=join(directory,'out','stopped-owner-received-files-packet.json');
      const file=await cli(['download','--id',state.ids.filesCycleId,'--format','packet','--out',target],{stopped:true});
      assert.equal(file.file.sha256,state.downloads['approved-client-files-close.json'].sha256);
      const final=await cli(['status'],{stopped:true});assert.equal(final.workspaceId,state.ids.originalWorkspaceId);
      return {workspaceId:final.workspaceId,cycles:final.cycles.length,receivedPacketSha256:file.file.sha256,originalPreparedRequestId:originalResult.operation.id};
    });
    assert.deepEqual(await inventory(originalWorkspace),originalInventory,'Original native merchant workspace stayed exact');
    assert.equal(hash(await readFile(join(originalRoot,'outbox','events.ndjson'))),nativeInputs.events);
    assert.equal(hash(await readFile(join(originalRoot,'proofs','original-sf86.json'))),nativeInputs.proof);
    assert.equal(hash(await readFile(join(originalRoot,'terms.json'))),nativeInputs.terms);
    assert.equal(state.pageErrors.length,0,JSON.stringify(state.pageErrors));
    state.result='PASS';state.finishedAt=new Date().toISOString();state.activePhase=null;await save();
    process.stdout.write(JSON.stringify({operationId:OPERATION,result:'PASS',directory,ids:state.ids,phases:Object.keys(state.phases).length,downloads:Object.keys(state.downloads).length,observations:state.observations.length})+'\n');
    return state;
  }catch(error){
    state.result='NEEDS_CONTINUATION';state.error={message:error.message,code:error.code??null,stack:error.stack,phase:state.activePhase,at:new Date().toISOString()};
    if(page){try{await page.screenshot({path:join(directory,'out','receiving-interruption.png'),fullPage:true});state.interruptionPage={url:page.url(),body:(await page.locator('body').innerText()).slice(0,16000)};}catch{}}
    await save();throw error;
  }finally{
    activeMutation=null;await context?.close().catch(()=>{});await app?.close().catch(()=>{});await writes;
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  assert.equal(process.argv.length,3,'Provide one original receiving configuration JSON path');
  runRunbookReceiving(JSON.parse(await readFile(resolve(process.argv[2]),'utf8'))).catch(error=>{process.stderr.write((error.stack??error.message)+'\n');process.exitCode=1;});
}
