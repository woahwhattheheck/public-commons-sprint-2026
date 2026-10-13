// MIT. One browser arm of the original issued-expense to Grant Operations receiving case.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=()=>new Date().toISOString();
const plain=value=>JSON.parse(JSON.stringify(value));
const timeout=(promise,ms,message)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(message)),ms);
  promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const atomicJSON=async(filename,value)=>{
  const temporary=filename+'.writing';
  const handle=await open(temporary,'w',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await rename(temporary,filename);
};
const optionalJSON=async filename=>{
  try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
};

export async function runExpenseAttributionBrowser({
  origin,token,caseId,planId,sourceFile,sourceName,work,chromiumExecutable,playwrightModule
}){
  assert.equal(typeof token,'string','The original local access token is required.');
  assert.ok(token.length>0,'The original local access token is empty.');
  assert.match(caseId,/^operation-[a-f0-9]{32}$/,'Select the original receiving case.');
  assert.equal(typeof planId,'string','Select the original imported plan.');
  for(const [name,value] of Object.entries({sourceFile,work,chromiumExecutable}))
    assert.ok(typeof value==='string'&&path.isAbsolute(value),name+' must name an actual absolute host path.');
  const base=new URL(origin);
  assert.ok(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password,'Use the original application origin.');
  assert.equal(base.pathname,'/','The browser receives the original application root.');
  assert.equal(base.search,'','The application origin has no query.');
  assert.equal(base.hash,'','The access token is supplied separately.');
  origin=base.origin;
  const input=await readFile(sourceFile);
  sourceName=sourceName||path.basename(sourceFile);
  assert.equal(sourceName,path.basename(sourceName),'Retain the original filename without directories.');
  assert.ok(input.length>0&&input.length<=8*1024*1024,'Select the complete original issued source.');
  assert.ok((await stat(chromiumExecutable)).isFile(),'The selected installed Chromium is unavailable.');
  const directory=path.join(work,'expense-attribution-browser');
  await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=path.join(directory,'tmp');
  const priorTemporary=Object.fromEntries(['TMPDIR','TMP','TEMP'].map(name=>[name,process.env[name]]));
  await mkdir(temporary,{recursive:true,mode:0o700});
  const reportFile=path.join(directory,'browser-receiving.json');
  const stateFile=path.join(directory,'browser-private-state.json');
  const binding={operationId:'grant-issued-expense-attribution-f232-20261012',caseId,planId,
    source:{name:sourceName,bytes:input.length,sha256:sha(input)}};
  let report=await optionalJSON(reportFile),saved=await optionalJSON(stateFile);
  const continuing=Boolean(report||saved);
  const previouslyPassed=report?.status==='PASS';
  const previousCompletedAt=report?.completedAt;
  if(report){
    assert.equal(report.schema,'stellar-forge.grant-expense-browser-receiving.v1','The retained browser report has another schema.');
    for(const key of ['operationId','caseId','planId'])assert.equal(report[key],binding[key],'The retained browser report selects another '+key+'.');
    assert.deepEqual(report.source,binding.source,'The retained browser report selects another original source.');
  }
  if(saved){
    assert.equal(saved.schema,'stellar-forge.grant-expense-browser-state.v1','The retained private browser state has another schema.');
    assert.deepEqual(saved.binding,binding,'The retained private browser state selects another case, plan or original source.');
  }else if(report){
    assert.equal(report.status,'PASS','An older interrupted browser report needs its original private browser storage and complete requests before continuation.');
  }
  report??={schema:'stellar-forge.grant-expense-browser-receiving.v1',...binding,
    startedAt:stamp(),status:'RUNNING',phases:[],requests:[],requestIds:[],screenshots:[],downloads:[],pageErrors:[],attempts:[]};
  saved??={schema:'stellar-forge.grant-expense-browser-state.v1',binding:plain(binding),origin,
    storage:{localStorage:[],sessionStorage:[]},commands:[],selectedLines:null,drafts:{},checks:{}};
  for(const item of [...report.downloads,...report.screenshots]){
    assert.equal(typeof item.path,'string','The retained browser output path is invalid.');
    item.path=path.join(directory,path.basename(item.path));
  }
  report.attempts??=[];
  const attempt={number:report.attempts.length+1,startedAt:stamp(),origin,status:'RUNNING'};
  report.attempts.push(attempt);
  if(report.status==='FAILED')report.previousFailures=[...(report.previousFailures||[]),
    {at:report.completedAt,error:report.error,attempt:attempt.number-1}];
  report.status='RUNNING';delete report.error;delete report.completedAt;
  const redact=value=>String(value).split(token).join('[local access]');
  let browser,context,page,finalCase,firstLine,secondLine,sourceReceipt,saveReceipt,reviewReceipt;
  let persistence=Promise.resolve();
  let restoringEditor=true,reopeningEditor=null;
  async function readStoredEditor(){
    if(!page||page.isClosed()||new URL(page.url()).origin!==origin)return null;
    const selected=await page.evaluate(async({caseId})=>{
      const {currentStaffContext,staffDeskStorageKey}=await import('/staff-session.mjs');
      const operator=currentStaffContext();
      if(!operator?.installationId||!operator?.staffId)return null;
      const key=staffDeskStorageKey('sf47.issued-expense.'+caseId,operator);
      const databaseName=staffDeskStorageKey('sf47-issued-expense-desks-v1',operator);
      const database=await new Promise((resolve,reject)=>{
        const request=indexedDB.open(databaseName,1);
        let absent=false;
        request.onupgradeneeded=()=>{absent=true;request.transaction.abort();};
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>absent?resolve(null):reject(request.error);
        request.onblocked=()=>reject(new Error('The original expense editor database is unavailable.'));
      });
      if(!database)return {key,operator,editor:null};
      try{
        const editor=await new Promise((resolve,reject)=>{
          const tx=database.transaction(['desks','sources'],'readonly');
          const request=tx.objectStore('desks').get(caseId);
          let value=null;
          request.onsuccess=()=>{
            value=request.result??null;
            if(value?.fileMeta){
              const source=tx.objectStore('sources').get(value.fileMeta.sha256);
              source.onsuccess=()=>{
                if(!source.result)return;
                if(source.result.sha256!==value.fileMeta.sha256||source.result.bytes!==value.fileMeta.bytes){
                  tx.abort();return;
                }
                value.file={filename:value.fileMeta.filename,contentBase64:source.result.contentBase64};
                if(value.pending?.body?.action==='expense.receive'&&!value.pending.body.data.contentBase64)
                  value.pending.body.data.contentBase64=source.result.contentBase64;
              };
            }
          };
          tx.oncomplete=()=>resolve(value);
          tx.onabort=tx.onerror=()=>reject(tx.error||new Error('The retained original expense source changed.'));
        });
        return {key,operator,editor};
      }finally{database.close();}
    },{caseId});
    if(selected?.editor){
      assert.equal(selected.editor.caseId,caseId,'The retained editor selects another original case.');
      if(selected.editor.file){
        const bytes=Buffer.from(selected.editor.file.contentBase64,'base64');
        assert.equal(bytes.length,selected.editor.fileMeta.bytes,'The retained original file length changed.');
        assert.equal(sha(bytes),selected.editor.fileMeta.sha256,'The retained original file bytes changed.');
      }
    }
    return selected;
  }
  async function waitStoredEditor(predicate,message){
    for(let attempt=0;attempt<150;attempt++){
      const value=(await readStoredEditor())?.editor;
      if(value&&predicate(value))return value;
      await page.waitForTimeout(100);
    }
    throw new Error(message);
  }
  function completeRetainedEditor(value){
    if(!value)return null;
    const editorState=plain(value);
    assert.equal(editorState.caseId,caseId,'The original complete editor selects another case.');
    if(editorState.pending){
      const command=saved.commands.find(row=>row.body.requestId===editorState.pending.body?.requestId);
      assert.ok(command,'The retained editor contains a request outside this original receiving operation.');
      assert.equal(editorState.pending.sha256,command.canonicalSha256,'The retained original request digest changed.');
      const retainedBody=plain(editorState.pending.body);
      if(retainedBody.action==='expense.receive'&&!retainedBody.data.contentBase64)
        retainedBody.data.contentBase64=command.body.data.contentBase64;
      assert.deepEqual(retainedBody,command.body,'The retained complete original request fields changed.');
      editorState.pending.body=plain(command.body);
      editorState.pending.uncertain=true;
    }
    if(editorState.fileMeta&&!editorState.file){
      if(editorState.pending?.body?.action==='expense.receive'){
        editorState.file={filename:editorState.fileMeta.filename,contentBase64:editorState.pending.body.data.contentBase64};
      }else if(editorState.fileMeta.sha256===report.source.sha256){
        assert.equal(editorState.fileMeta.bytes,input.length);
        editorState.file={filename:editorState.fileMeta.filename,contentBase64:input.toString('base64')};
      }
    }
    if(editorState.file){
      const bytes=Buffer.from(editorState.file.contentBase64,'base64');
      assert.equal(bytes.length,editorState.fileMeta.bytes);
      assert.equal(sha(bytes),editorState.fileMeta.sha256,'The complete reopening source bytes changed.');
      assert.equal(editorState.file.filename,editorState.fileMeta.filename);
    }
    return editorState;
  }
  async function captureStorage(){
    if(!page||page.isClosed())return;
    const current=await page.evaluate(()=>({
      origin:location.origin,
      localStorage:Object.entries(localStorage).filter(([key])=>key.startsWith('sf47.')),
      sessionStorage:Object.entries(sessionStorage).filter(([key])=>key.startsWith('sf47.')&&key!=='sf47.access'&&!key.startsWith('sf47.receiving.restore.'))
    }));
    if(current.origin===origin){
      saved.origin=origin;saved.storage={localStorage:current.localStorage,sessionStorage:current.sessionStorage};
      if(!restoringEditor){
        const selected=await readStoredEditor();
        if(selected?.editor){
          saved.editorState=plain(selected.editor);saved.editorKey=selected.key;saved.editorOperator=plain(selected.operator);
        }
      }
    }
  }
  function persist({capture=true}={}){
    const task=async()=>{
      if(capture&&page&&!page.isClosed())try{await captureStorage();}catch(error){
        report.storageObservations??=[];report.storageObservations.push({at:stamp(),attempt:attempt.number,message:redact(error.message)});
      }
      saved.updatedAt=stamp();
      await atomicJSON(stateFile,saved);
      const bytes=await readFile(stateFile);
      report.privateState={path:stateFile,bytes:bytes.length,sha256:sha(bytes)};
      await atomicJSON(reportFile,report);
    };
    const next=persistence.then(task,task);persistence=next.catch(()=>{});return next;
  }
  const completed=name=>report.phases.some(row=>row.name===name);
  const phase=async(name,detail={})=>{
    if(!restoringEditor)await checkpointEditor();
    if(!completed(name))report.phases.push({name,at:stamp(),attempt:attempt.number,...plain(detail)});
    await persist();
    process.stdout.write(JSON.stringify({type:'GRANT_EXPENSE_BROWSER_PHASE',name,caseId,attempt:attempt.number,...detail})+'\n');
  };
  const responseReads=[];
  const requestEndpoint='/api/operations/'+caseId;
  const legacyKey='sf47.issued-expense.'+caseId;
  const browserStorage=()=>saved.storage.localStorage.filter(([key])=>key!==legacyKey&&!key.startsWith(legacyKey+':staff:'));
  const actor='F232 original grant receiving';
  let interceptionError=null,resolveCommitted,rejectCommitted;
  const committed=new Promise((resolve,reject)=>{resolveCommitted=resolve;rejectCommitted=reject;});
  committed.catch(()=>{});
  function commandFor(actionName){
    const rows=saved.commands.filter(row=>row.body.action===actionName);
    assert.ok(rows.length<=1,'This browser operation has more than one original '+actionName+' request.');
    return rows[0]||null;
  }
  function acceptReceipt(command,receipt,observedBy){
    assert.equal(receipt?.id,caseId,'The original receipt selects another case.');
    assert.equal(receipt.action,command.body.action,'The original receipt selects another action.');
    assert.ok(Number.isInteger(receipt.version)&&receipt.version>=command.body.expectedVersion,'The original receipt version is invalid.');
    if(command.receipt)assert.deepEqual(command.receipt,receipt,'The original UUID returned a different committed receipt.');
    command.receipt=plain(receipt);command.status='COMMITTED';command.observedBy=observedBy;command.observedAt=stamp();
    if(command.body.action==='expense.receive'){
      sourceReceipt={requestId:command.body.requestId,...receipt};report.sourceReceipt=plain(sourceReceipt);
    }
    if(command.body.action==='expense.save'){
      saveReceipt={requestId:command.body.requestId,bodySha256:command.bodySha256,...receipt};
      report.lostResponse??={request:plain(command.body),at:stamp(),mode:'same-request-receipt-recovered'};
      report.lostResponse.receipt=plain(saveReceipt);
    }
    if(command.body.action==='expense.review'){
      reviewReceipt={requestId:command.body.requestId,...receipt};report.reviewReceipt=plain(reviewReceipt);
    }
  }
  async function readReceipt(command){
    const response=await context.request.post(origin+requestEndpoint+'/expense-request',{
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},data:command.body,maxRetries:0});
    const value=await response.json();
    assert.ok(response.ok(),'The original request receipt read failed: '+response.status());
    assert.equal(value.caseId,caseId);assert.equal(value.requestId,command.body.requestId);
    assert.ok(Number.isInteger(value.currentVersion));
    report.requests.push({at:stamp(),attempt:attempt.number,endpoint:requestEndpoint+'/expense-request',
      action:command.body.action,requestId:command.body.requestId,expectedVersion:command.body.expectedVersion,
      bodySha256:command.bodySha256,httpStatus:response.status(),receipt:plain(value),readOnly:true,
      observation:'same-original-private-browser-context'});
    if(value.status==='COMMITTED')acceptReceipt(command,value.receipt,'original receipt reader');
    else{
      assert.equal(value.status,'NOT_RECORDED','The original request reader returned an unknown status.');
      assert.ok(!command.receipt,'An original committed request disappeared from the selected case.');
      command.status='NOT_RECORDED';command.currentVersion=value.currentVersion;
    }
    await persist({capture:false});
    return value;
  }
  function restorePending(command){
    const current=saved.editorState;
    if(current?.pending?.body?.requestId===command.body.requestId){
      saved.editorState=completeRetainedEditor(current);return;
    }
    assert.ok(command.browserEditor?.pending?.body?.requestId===command.body.requestId,
      'The complete original browser request storage is unavailable.');
    saved.editorState=completeRetainedEditor(command.browserEditor);
  }
  async function reconcilePending(){
    const pending=(await readStoredEditor())?.editor?.pending;
    if(pending){
      const command=saved.commands.find(row=>row.body.requestId===pending.body?.requestId);
      assert.ok(command,'The saved editor contains another original operation.');
      assert.equal(pending.sha256,command.canonicalSha256);
      assert.deepEqual(pending.body,command.body,'The actual stored original request changed.');
    }
    if(!pending)return;
    const command=saved.commands.find(row=>row.body.requestId===pending.body.requestId);
    assert.ok(command,'The browser contains a request outside this selected receiving operation.');
    const result=await readReceipt(command);
    if(result.status==='NOT_RECORDED'){
      assert.equal(result.currentVersion,command.body.expectedVersion,
        'The original unrecorded request needs review against the changed case before continuation.');
      if(command.body.action==='expense.receive'){
        await desk().locator('[data-expense-file]').setInputFiles({
          name:sourceName,mimeType:sourceName.endsWith('.zip')?'application/zip':'application/json',buffer:input});
        await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
      }
      await action('recover').click();
      if(command.body.action==='expense.save'){
        await timeout(committed,30000,'The original retained save did not return its controlled response-loss receipt.');
        if(interceptionError)throw interceptionError;
        await openCase(true);
        await reconcilePending();
      }
    }else await action('recover').click();
    await waitStoredEditor(value=>!value.pending,'The retained original request did not finish its durable reconciliation.');
    await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
    await readReceipt(command);
    assert.equal(command.status,'COMMITTED','The original retained request is still unrecorded.');
  }
  async function inspectCase(){
    const value=await page.evaluate(async({endpoint})=>{
      const {staffRequest,currentStaffContext}=await import('/staff-session.mjs');
      return staffRequest(endpoint,undefined,{staffContext:currentStaffContext()});
    },{endpoint:requestEndpoint});
    assert.equal(value.program.id,caseId,'The browser read another original case.');
    assert.equal(value.program.planId,planId,'The browser read a different original plan.');
    return value;
  }
  async function waitCase(predicate,message){
    let current;
    for(let attempt=0;attempt<80;attempt++){
      current=await inspectCase();
      if(predicate(current))return current;
      await page.waitForTimeout(100);
    }
    throw new Error(message);
  }
  async function snapshot(name){
    const filename=path.join(directory,name+'.png');
    await page.screenshot({path:filename,fullPage:true});
    const bytes=await readFile(filename);
    const prior=report.screenshots.find(row=>row.name===name);
    const metadata={name,path:filename,bytes:bytes.length,sha256:sha(bytes),attempt:attempt.number};
    if(prior)Object.assign(prior,metadata);else report.screenshots.push(metadata);
    await persist();
  }
  function desk(){return page.locator('.expense-desk');}
  function action(name){return desk().locator('[data-expense-action="'+name+'"]');}
  function editor(){return desk().locator('[data-expense-editor]');}
  async function checkpointEditor(){
    await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
    const started=page.waitForEvent('download',{timeout:30000});
    await action('download-desk').click();
    const download=await started;
    assert.equal(await download.failure(),null,'The complete original editor download failed.');
    const number=(report.editorCheckpoints?.length??0)+1;
    const filename=path.join(directory,'original-expense-editor-'+attempt.number+'-'+number+'.json');
    await download.saveAs(filename);
    const bytes=await readFile(filename),editorState=JSON.parse(bytes.toString('utf8'));
    assert.equal(editorState.caseId,caseId,'The complete editor download selects another case.');
    assert.equal(editorState.schema,'sf47.issued-expense-editor.v1');
    const normalized=value=>{
      const result=plain(value);delete result.storageSequence;
      result.file??=null;result.receiveNote??='';return result;
    };
    await waitStoredEditor(value=>canonical(normalized(value))===canonical(normalized(editorState)),
      'The current original drafts did not finish saving before the browser checkpoint.');
    saved.editorState=plain(editorState);
    report.editorCheckpoints??=[];report.editorCheckpoints.push({at:stamp(),path:filename,bytes:bytes.length,
      sha256:sha(bytes),attempt:attempt.number});
    await persist({capture:false});
  }
  async function openCase(reload=false){
    if(reload){await checkpointEditor();await page.reload({waitUntil:'domcontentloaded'});}
    else await page.goto(origin+'/#access='+encodeURIComponent(token),{waitUntil:'domcontentloaded'});
    await page.locator('#plan-select').waitFor({state:'visible'});
    await page.locator('#plan-select').selectOption(planId);
    await page.locator('#sections [data-tab="operations"]').click();
    const cases=page.locator('[name="caseSelect"]');
    await cases.waitFor({state:'visible'});
    await cases.selectOption(caseId);
    const cashNavigation=page.locator('details[data-nav-group="cash"]');
    await cashNavigation.waitFor({state:'visible'});
    if(!await cashNavigation.evaluate(element=>element.open))await cashNavigation.locator(':scope > summary').click();
    await cashNavigation.locator('[data-nav-section="expenses"]').click();
    await desk().waitFor({state:'visible'});
    const recording=page.locator('[name="recordingActor"]');
    await recording.fill(actor);
    await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
    assert.equal(await cases.inputValue(),caseId,'The original case selector changed.');
    if(restoringEditor){
      if(reopeningEditor){
        const retained=completeRetainedEditor(reopeningEditor);
        const preceding=page.waitForEvent('download',{timeout:30000});
        await action('open-desk').click();
        await desk().locator('[data-expense-desk-file]').setInputFiles({
          name:'Original_Issued_Expense_Complete_Desk.json',mimeType:'application/json',
          buffer:Buffer.from(JSON.stringify(retained)+'\n')});
        const previous=await preceding;
        const previousPath=path.join(directory,'expense-before-original-reopen-'+attempt.number+'.json');
        await previous.saveAs(previousPath);
        const bytes=await readFile(previousPath);
        report.reopeningCopies??=[];report.reopeningCopies.push({at:stamp(),path:previousPath,
          bytes:bytes.length,sha256:sha(bytes),attempt:attempt.number});
        await waitStoredEditor(value=>{
          const strip=value=>{
            const copy=plain(value);delete copy.storageSequence;
            copy.receiveNote??='';copy.file??=null;return copy;
          };
          return canonical(strip(value))===canonical(strip(retained));
        },'The complete original expense editor was not received into current browser storage.');
        await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
      }
      restoringEditor=false;reopeningEditor=null;
      await persist();
    }
  }
  async function chooseLine(line){
    const candidate=desk().locator('[data-expense-action="select-line"]');
    const index=await candidate.evaluateAll((nodes,ident)=>nodes.findIndex(node=>
      node.dataset.workspace===ident.workspaceId&&node.dataset.line===ident.sourceLineId),line);
    assert.ok(index>=0,'The current original line is absent from the rendered register.');
    await candidate.nth(index).click();
    await editor().waitFor({state:'visible'});
    assert.ok((await editor().innerText()).includes(line.sourceLineId),'The original selected line did not open.');
  }
  async function draftValues(){
    return editor().evaluate(form=>({
      memo:form.querySelector('[data-expense-split] [name="memo"]').value,
      costId:form.querySelector('[data-expense-split] [name="costId"]').value,
      nativeAmount:form.querySelector('[data-expense-split] [name="nativeAmount"]').value,
      note:form.elements.namedItem('expenseNote').value
    }));
  }
  async function fillDraft(memo,note){
    const cost=editor().locator('[data-expense-split] [name="costId"]').first();
    const options=await cost.locator('option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,text:node.textContent})).filter(row=>row.value));
    assert.ok(options.length,'The original case has no selectable work package.');
    await cost.selectOption(options[0].value);
    await editor().locator('[data-expense-split] [name="memo"]').first().fill(memo);
    await editor().locator('[name="expenseNote"]').fill(note);
    await editor().locator('[name="valuationMode"]').selectOption('NONE');
    const values=await draftValues();
    assert.match(values.nativeAmount,/^[1-9][0-9]*$/,'The original expense requires a positive native amount.');
    return values;
  }
  async function saveDownload(name,filename,check){
    const existing=report.downloads.find(row=>row.action===name);
    if(existing){
      try{
        const bytes=await readFile(existing.path);
        if(bytes.length===existing.bytes&&sha(bytes)===existing.sha256){if(check)await check(bytes);return existing;}
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const started=page.waitForEvent('download',{timeout:30000});
    await action(name).click();
    const download=await started;
    const failure=await download.failure();
    assert.equal(failure,null,'The original export failed: '+failure);
    const destination=path.join(directory,filename);
    await download.saveAs(destination);
    const bytes=await readFile(destination);
    assert.ok(bytes.length>0,'The original export is empty.');
    if(check)await check(bytes);
    const metadata={action:name,path:destination,name:download.suggestedFilename(),bytes:bytes.length,sha256:sha(bytes)};
    if(existing)Object.assign(existing,metadata);else report.downloads.push(metadata);
    await persist();
    return metadata;
  }
  try{
    for(const name of ['TMPDIR','TMP','TEMP'])process.env[name]=temporary;
    const selectedModule=playwrightModule||process.env.PLAYWRIGHT_MODULE;
    let moduleSpecifier=selectedModule||'playwright';
    if(selectedModule&&path.isAbsolute(selectedModule)){
      const entry=(await stat(selectedModule)).isDirectory()?createRequire(import.meta.url).resolve(selectedModule):selectedModule;
      moduleSpecifier=pathToFileURL(entry).href;
    }
    const imported=await import(moduleSpecifier);
    const chromium=imported.chromium||imported.default?.chromium;
    assert.ok(chromium,'The selected original Playwright module has no Chromium launcher.');
    browser=await chromium.launch({
      executablePath:chromiumExecutable,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage'],
      env:{...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary}
    });
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,
      storageState:{cookies:[],origins:[{origin,localStorage:browserStorage()}]}});
    const initialResponse=await context.request.get(origin+requestEndpoint,{headers:{Authorization:'Bearer '+token},maxRetries:0});
    assert.ok(initialResponse.ok(),'The original case cannot be opened with the supplied access.');
    const initialCase=await initialResponse.json();
    assert.equal(initialCase.program?.id,caseId);assert.equal(initialCase.program?.planId,planId);
    if(previouslyPassed){
      const exports=['export-html','export-csv','export-case'];
      for(const name of exports){
        const entry=report.downloads.find(row=>row.action===name);
        assert.ok(entry,'The completed original browser report is missing an export.');
        const bytes=await readFile(entry.path);
        assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256,
          'The original completed browser export changed.');
      }
      report.status='PASS';report.completedAt=previousCompletedAt||report.attempts.findLast(row=>row.status==='PASS')?.completedAt||report.startedAt;
      attempt.status='PASS';attempt.completedAt=stamp();attempt.reopenedCompleteOriginal=true;
      report.reopenedAt=attempt.completedAt;
      await persist({capture:false});
      return {...report,reportFile};
    }
    for(const command of saved.commands)await readReceipt(command);
    const unresolved=saved.commands.filter(row=>row.status!=='COMMITTED');
    assert.ok(unresolved.length<=1,'The original browser retains more than one unresolved operation.');
    if(!saved.editorState){
      const candidates=saved.storage.localStorage.filter(([key])=>key===legacyKey||key.startsWith(legacyKey+':staff:'));
      const selected=candidates.find(([key])=>key===saved.editorKey)||candidates.find(([key])=>key===legacyKey);
      assert.ok(selected||!candidates.length,'Select the original retained operator editor before resuming this receiving case.');
      if(selected)saved.editorState=JSON.parse(selected[1]);
    }
    if(unresolved.length)restorePending(unresolved[0]);
    reopeningEditor=completeRetainedEditor(saved.editorState);
    const restoreId=attempt.startedAt+'-'+attempt.number;
    await context.addInitScript(({selectedOrigin,localValues,sessionValues,restoreId})=>{
      if(location.origin!==selectedOrigin)return;
      const marker='sf47.receiving.restore.original-expense';
      if(sessionStorage.getItem(marker)===restoreId)return;
      for(const [key,value] of localValues)localStorage.setItem(key,value);
      for(const [key,value] of sessionValues)sessionStorage.setItem(key,value);
      sessionStorage.setItem(marker,restoreId);
    },{selectedOrigin:origin,localValues:browserStorage(),sessionValues:saved.storage.sessionStorage,restoreId});
    page=await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror',error=>{report.pageErrors.push({at:stamp(),attempt:attempt.number,message:redact(error.stack||error.message)});});
    page.on('request',request=>{
      const url=new URL(request.url());
      if(request.method()!=='POST'||![requestEndpoint+'/command',requestEndpoint+'/expense-request'].includes(url.pathname))return;
      try{
        const body=request.postDataJSON();
        report.requests.push({at:stamp(),attempt:attempt.number,endpoint:url.pathname,action:body.action,requestId:body.requestId,
          expectedVersion:body.expectedVersion,bodySha256:sha(Buffer.from(request.postData()||''))});
        if(body.requestId&&!report.requestIds.includes(body.requestId))report.requestIds.push(body.requestId);
      }catch(error){report.pageErrors.push({at:stamp(),attempt:attempt.number,message:'Original request inspection: '+redact(error.message)});}
    });
    page.on('response',response=>{
      const url=new URL(response.url());
      if(![requestEndpoint+'/command',requestEndpoint+'/expense-request'].includes(url.pathname))return;
      const reader=(async()=>{
        try{
          const body=response.request().postDataJSON(),value=await response.json();
          const request=report.requests.findLast(row=>row.requestId===body.requestId&&row.endpoint===url.pathname&&!Object.hasOwn(row,'httpStatus'));
          if(request){request.httpStatus=response.status();request.receipt=value;}
          const command=saved.commands.find(row=>row.body.requestId===body.requestId);
          if(command&&response.ok()){
            if(url.pathname.endsWith('/command'))acceptReceipt(command,value,'original browser command response');
            else if(value.status==='COMMITTED')acceptReceipt(command,value.receipt,'original browser receipt reader');
          }
          await persist();
        }catch(error){
          if(response.status()<400)report.pageErrors.push({at:stamp(),attempt:attempt.number,message:'Original response inspection: '+redact(error.message)});
        }
      })();
      responseReads.push(reader);
    });
    await page.route('**'+requestEndpoint+'/command',async route=>{
      const request=route.request();
      let body;
      try{body=request.postDataJSON();}catch{await route.abort('failed');return;}
      try{
        assert.ok(['expense.receive','expense.save','expense.review'].includes(body.action),'The receiving browser dispatched an unrelated original mutation.');
        const bodySha256=sha(Buffer.from(request.postData()||''));
        let command=commandFor(body.action);
        if(command){
          assert.equal(command.body.requestId,body.requestId,'A continuation generated a replacement original request ID.');
          assert.equal(command.canonicalSha256,sha(Buffer.from(canonical(body))),'The retained complete original request changed.');
          assert.deepEqual(command.body,body,'The retained original request fields changed.');
          assert.ok(!command.receipt,'The browser attempted to resend an already committed original request.');
        }else{
          command={body:plain(body),bodySha256,canonicalSha256:sha(Buffer.from(canonical(body))),preparedAt:stamp(),status:'PREPARED',dispatchAttempts:[]};
          saved.commands.push(command);
        }
        await captureStorage();
        const editorState=saved.editorState;
        assert.equal(editorState?.pending?.body?.requestId,body.requestId,'The original browser did not retain this request before dispatch.');
        assert.equal(editorState.pending.sha256,sha(Buffer.from(canonical(body))),'The saved original browser request fingerprint differs.');
        command.browserEditor=plain(editorState);
        command.status='DISPATCHING';
        command.dispatchAttempts.push({at:stamp(),attempt:attempt.number});
        if(body.action==='expense.save'){
          saved.controlledSaveRequestId??=body.requestId;
          assert.equal(saved.controlledSaveRequestId,body.requestId,'The controlled original save identity changed.');
        }
        await persist({capture:false});
        if(body.action!=='expense.save'){await route.continue();return;}
        const response=await route.fetch({maxRetries:0,maxRedirects:0}),receipt=await response.json();
        assert.ok(response.ok(),'The original save did not commit before its response-loss observation.');
        assert.equal(receipt.version,body.expectedVersion+1);
        acceptReceipt(command,receipt,'original command completed; browser response withheld');
        report.lostResponse={request:plain(body),receipt:plain(saveReceipt),at:stamp(),
          mode:'controlled-response-aborted',attempt:attempt.number};
        await persist({capture:false});
        await route.abort('failed');
        resolveCommitted(saveReceipt);
      }catch(error){
        interceptionError=error;rejectCommitted(error);
        try{await route.abort('failed');}catch{}
      }
    });
    await phase('original-browser-open',{sourceSha256:report.source.sha256,continuing});
    await openCase();
    let before=await inspectCase();
    assert.equal(before.program.state,'OPEN','The original case must remain open for this receiving continuation.');
    if(before.expenseAttribution.sources.some(row=>row.fileSha256===report.source.sha256))
      assert.ok(commandFor('expense.receive')?.receipt||report.sourceReceipt,
        'A first browser invocation must receive its own selected original source.');
    await reconcilePending();
    before=await inspectCase();
    if(!before.expenseAttribution.sources.some(row=>row.fileSha256===report.source.sha256)){
      assert.ok(!commandFor('expense.receive'),'The retained receiving request must reconcile before another source action.');
      await desk().locator('[data-expense-file]').setInputFiles({
        name:sourceName,mimeType:sourceName.endsWith('.zip')?'application/zip':'application/json',buffer:input});
      await action('preview').click();
      await desk().locator('[data-expense-receive]').waitFor({state:'visible'});
      await snapshot('01-original-issued-source-review');
      await phase('original-source-preview',{filename:sourceName,sha256:report.source.sha256});
      await desk().locator('[name="receiveNote"]').fill('Receive the exact issued buyer source into this original grant delivery case.');
      await action('receive').click();
    }
    const received=await waitCase(value=>value.expenseAttribution.sources.some(row=>row.fileSha256===report.source.sha256)&&value.expenseAttribution.lines.length>=2,
      'The original source receiving did not retain its issued lines.');
    await page.waitForFunction(()=>document.querySelectorAll('.expense-desk [data-expense-action="select-line"]').length>=2&&document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
    await Promise.allSettled(responseReads);
    const sourceCommand=commandFor('expense.receive');
    if(sourceCommand&&!sourceCommand.receipt)await readReceipt(sourceCommand);
    assert.ok(sourceReceipt||report.sourceReceipt,'The original source receipt was not retained.');
    sourceReceipt??=report.sourceReceipt;
    const choices=await desk().locator('[data-expense-action="select-line"]').evaluateAll(nodes=>nodes.map(node=>({
      workspaceId:node.dataset.workspace,sourceLineId:node.dataset.line,
      kind:node.closest('tr').querySelector('td').textContent,
      amount:node.closest('tr').querySelectorAll('td')[1].querySelector('strong').textContent
    })));
    if(saved.selectedLines){
      assert.equal(saved.selectedLines.length,2);
      [firstLine,secondLine]=saved.selectedLines;
      for(const line of saved.selectedLines){
        const current=choices.find(row=>row.workspaceId===line.workspaceId&&row.sourceLineId===line.sourceLineId);
        assert.deepEqual(current,line,'A retained original issued line changed before its browser continuation.');
      }
    }else{
      firstLine=choices.find(row=>/^expense/i.test(row.kind)&&/^[1-9][0-9]*$/.test(row.amount));
      assert.ok(firstLine,'The original issued register has no positive expense line.');
      secondLine=choices.find(row=>(row.sourceLineId!==firstLine.sourceLineId||row.workspaceId!==firstLine.workspaceId)&&/^[1-9][0-9]*$/.test(row.amount));
      assert.ok(secondLine,'The original issued register needs a distinct line for its retained-draft journey.');
      saved.selectedLines=plain([firstLine,secondLine]);
    }
    report.selectedLines=plain(saved.selectedLines);
    await phase('original-source-received',{...sourceReceipt,lines:choices.length});
    if(!commandFor('expense.save')){
      await chooseLine(firstLine);
      if(saved.drafts.A)assert.deepEqual(await draftValues(),saved.drafts.A,'The retained first-line draft changed before continuation.');
      else{
        saved.drafts.A=await fillDraft('Original expense A: retained work-package allocation.','Original expense A: retain this source review note through switching and reopening.');
        await checkpointEditor();
      }
      await chooseLine(secondLine);
      if(saved.drafts.B)assert.deepEqual(await draftValues(),saved.drafts.B,'The retained second-line draft changed before continuation.');
      else{
        saved.drafts.B=await fillDraft('Original expense B: independent draft.','Original expense B: independently retained source review note.');
        await checkpointEditor();
      }
      await chooseLine(firstLine);
      assert.deepEqual(await draftValues(),saved.drafts.A,'Switching back lost the first original line draft or note.');
      await openCase(true);
      await chooseLine(firstLine);
      assert.deepEqual(await draftValues(),saved.drafts.A,'Reopening the browser lost the retained first-line draft or note.');
      await chooseLine(secondLine);
      assert.deepEqual(await draftValues(),saved.drafts.B,'Reopening the browser lost the retained second-line draft or note.');
      await chooseLine(firstLine);
      await snapshot('02-retained-line-draft-and-note');
      saved.checks.originalDraftSwitch=true;
      await phase('line-drafts-switched-and-reopened',{lineA:firstLine.sourceLineId,lineB:secondLine.sourceLineId,costId:saved.drafts.A.costId});
      await action('save').click();
      await timeout(committed,30000,'The original allocation save did not reach its one controlled response loss.');
      if(interceptionError)throw interceptionError;
      await waitStoredEditor(value=>value.pending?.body?.requestId===saveReceipt.requestId,
        'The original response-loss request was not durably retained.');
      await page.waitForFunction(()=>document.querySelector('.expense-desk')?.getAttribute('aria-busy')==='false');
      await snapshot('03-original-save-response-recovery');
      await phase('original-save-committed-response-lost',{requestId:saveReceipt.requestId,recordId:saveReceipt.recordId,version:saveReceipt.version});
      await openCase(true);
    }else{
      const originalSave=commandFor('expense.save');
      if(!originalSave.receipt)await readReceipt(originalSave);
      assert.equal(originalSave.status,'COMMITTED','The original allocation request remains unresolved.');
      assert.ok(saved.checks.originalDraftSwitch&&saved.drafts.A&&saved.drafts.B,
        'The original pre-save draft-switch history is incomplete.');
      await phase('original-save-committed-response-lost',{requestId:saveReceipt.requestId,recordId:saveReceipt.recordId,version:saveReceipt.version,continued:true});
    }
    await reconcilePending();
    await desk().locator('.expense-pending').waitFor({state:'detached'});
    const savedCase=await waitCase(value=>value.expenseAttribution.attributions.some(row=>row.id===saveReceipt.recordId),
      'The original committed allocation did not reopen.');
    const attributions=savedCase.expenseAttribution.attributions.filter(row=>
      row.source.workspaceId===firstLine.workspaceId&&row.source.sourceLineId===firstLine.sourceLineId);
    assert.equal(attributions.length,1,'The original source line acquired a duplicate allocation.');
    assert.equal(attributions[0].id,saveReceipt.recordId);
    if(!commandFor('expense.review')?.receipt)
      assert.equal(savedCase.program.version,saveReceipt.version,'The retained case changed after its original save.');
    const recovered=report.requests.filter(row=>row.endpoint.endsWith('/expense-request')&&row.requestId===saveReceipt.requestId);
    assert.ok(recovered.length,'The original receipt reader did not reconcile the retained UUID.');
    await chooseLine(firstLine);
    if(!commandFor('expense.review')){
      const currentNote=await editor().locator('[name="expenseNote"]').inputValue();
      const preparedReview='Review the retained original native allocation and its selected work package.';
      assert.ok(currentNote===''||(saved.checks.reviewNotePrepared&&currentNote===preparedReview),
        'The accepted allocation restored an obsolete unsaved note.');
      assert.equal(await editor().locator('[data-expense-split] [name="memo"]').first().inputValue(),saved.drafts.A.memo);
    }
    assert.equal(attributions[0].allocations[0].nativeAmount,firstLine.amount);
    await phase('same-original-request-reconciled',{requestId:saveReceipt.requestId,recordId:saveReceipt.recordId,version:savedCase.program.version});
    if(!commandFor('expense.review')){
      await editor().locator('[name="expenseNote"]').fill('Review the retained original native allocation and its selected work package.');
      saved.checks.reviewNotePrepared=true;
      await persist();
      await desk().locator('[data-expense-transition="expense.review"]').click();
    }else if(!commandFor('expense.review').receipt)await reconcilePending();
    finalCase=await waitCase(value=>value.expenseAttribution.attributions.find(row=>row.id===saveReceipt.recordId)?.state==='REVIEWED',
      'The original attribution review did not commit.');
    await Promise.allSettled(responseReads);
    const reviewCommand=commandFor('expense.review');
    assert.ok(reviewCommand,'The original review request is absent.');
    if(!reviewCommand.receipt)await readReceipt(reviewCommand);
    const reviewed=finalCase.expenseAttribution.attributions.find(row=>row.id===saveReceipt.recordId);
    assert.equal(reviewed.review.actor,actor);
    assert.equal(reviewed.review.contentSha256,reviewed.contentSha256);
    assert.equal(reviewCommand.receipt.recordId,reviewed.id);
    reviewReceipt={requestId:reviewCommand.body.requestId,...reviewCommand.receipt,contentSha256:reviewed.contentSha256};
    report.reviewReceipt=reviewReceipt;
    await chooseLine(secondLine);
    assert.deepEqual(await draftValues(),saved.drafts.B,'Reviewing the first line discarded the other original line draft.');
    await chooseLine(firstLine);
    await snapshot('04-reviewed-original-attribution');
    await phase('original-allocation-reviewed',reviewReceipt);
    await saveDownload('export-html','expense-attribution.html',bytes=>{
      const html=bytes.toString('utf8');
      assert.ok(html.includes(firstLine.sourceLineId),'The readable review omits the original issued line.');
      assert.ok(html.includes(reviewed.id),'The readable review omits the retained attribution.');
    });
    await saveDownload('export-csv','expense-attributions.csv',bytes=>{
      const csv=bytes.toString('utf8');
      assert.ok(csv.includes(reviewed.id),'The allocation CSV omits the retained attribution.');
      assert.ok(csv.includes(firstLine.sourceLineId),'The allocation CSV omits the original source identity.');
    });
    await saveDownload('export-case','operations-case.zip',bytes=>{
      assert.equal(bytes.subarray(0,2).toString('ascii'),'PK','The original complete-case export is not a ZIP archive.');
    });
    await phase('original-readable-csv-and-complete-case-exported',{downloads:report.downloads.length});
    await Promise.allSettled(responseReads);
    assert.deepEqual(report.pageErrors.filter(row=>row.attempt===attempt.number),[],'The original page reported an uncaught browser error in this continuation.');
    attempt.status='PASS';attempt.completedAt=stamp();
    report.status='PASS';report.completedAt=stamp();report.finalVersion=finalCase.program.version;
    report.attributionId=saveReceipt.recordId;report.sourceReceipt=sourceReceipt;
    await persist();
    return {...report,reportFile};
  }catch(error){
    report.status='FAILED';report.completedAt=stamp();report.error=redact(error.stack||error.message);
    attempt.status='FAILED';attempt.completedAt=report.completedAt;attempt.error=report.error;
    if(page&&!page.isClosed())try{await snapshot('failure-original-browser-attempt-'+attempt.number);}catch{}
    await Promise.allSettled(responseReads);
    await persist();
    error.receivingReport=reportFile;
    throw error;
  }finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    for(const [name,value] of Object.entries(priorTemporary)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    assert.equal(process.argv.length,3,'Usage: node expense-attribution-browser.mjs /absolute/private-browser-input.json');
    const filename=path.resolve(process.argv[2]);
    const options=JSON.parse(await readFile(filename,'utf8'));
    const result=await runExpenseAttributionBrowser(options);
    process.stdout.write(JSON.stringify({type:'GRANT_EXPENSE_BROWSER_RESULT',...result})+'\n');
  }catch(error){
    process.stderr.write(JSON.stringify({type:'GRANT_EXPENSE_BROWSER_FAILURE',message:error.message,reportFile:error.receivingReport||null})+'\n');
    process.exitCode=1;
  }
}
