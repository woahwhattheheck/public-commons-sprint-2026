#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createReadStream,constants as fsConstants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {hostname} from 'node:os';
import {dirname,basename,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

async function rehearsalBrowserMain(argv) {
  // Copyright 2026 TokenJunkieLabs. Original UI caller for saved native rehearsals.
  const ID = /^[0-9a-f]{64}$/;
  const STEP_IDS = ['study','geography','parameters','alternatives','calculation','maps','comparison','delivery','transfer'];
  const SINGLE_SELECTION = ['source_collection_id','grid_id','profile_id','baseline_run_id','comparison_id','delivery_id','spatial_review_id','backup_task_id','restore_task_id'];
  const now = () => new Date().toISOString();
  const copy = x => JSON.parse(JSON.stringify(x));
  const canonical = value => JSON.stringify((function order(x) {
    if (Array.isArray(x)) return x.map(order);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, order(x[k])]));
    return x;
  })(value));
  const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
  const equal = (a,b) => canonical(a) === canonical(b);
  const fail = (code, message) => { const error = new Error(message); error.publicCode = code; throw error; };
  const exists = async path => { try { await fs.access(path); return true; } catch(error) { if(error.code === 'ENOENT') return false; throw error; } };
  const readJSON = async path => JSON.parse(await fs.readFile(path,'utf8'));
  const pause = async ms => { await new Promise(resolve => setTimeout(resolve,ms)); checkRunning(); };
  const waitFor = async (condition, code, timeout=30000) => {
    const end = Date.now()+timeout;
    while(Date.now()<end) { checkRunning(); const value=await condition(); checkRunning(); if(value) return value; await pause(150); }
    fail(code,'The original browser step is still incomplete; resume this same input.');
  };
  async function atomic(path, bytes) {
    await fs.mkdir(dirname(path),{recursive:true,mode:0o700});
    const temporary = path+'.'+randomUUID()+'.tmp';
    const handle=await fs.open(temporary,'wx',0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(temporary,path); const directory=await fs.open(dirname(path),'r'); try { await directory.sync(); } finally { await directory.close(); } }
    finally { await fs.rm(temporary,{force:true}); }
  }
  const writeJSON = (path,value) => atomic(path,canonical(value)+'\n');
  async function hashFile(path) {
    const st=await fs.lstat(path);
    if(!st.isFile()||st.isSymbolicLink()) fail('REGULAR_FILE_REQUIRED','A retained artifact must be an original regular file.');
    const h=createHash('sha256'); let bytes=0;
    for await(const part of createReadStream(path)) { bytes+=part.length; h.update(part); }
    return {bytes,sha256:h.digest('hex')};
  }
  function validId(value) { if(typeof value!=='string'||!ID.test(value)) fail('ORIGINAL_ID_REQUIRED','Choose the complete original case and workspace identities.'); return value; }
  let context=null,page=null,settings=null,connection=null,output=null,privateDirectory=null,progress=null,lockHandle=null,lockPath=null;
  let uiErrors=[];
  let stopRequested=null,contextClosing=null,activeRecording=null,retainInterruptedRecording=null;
  const activeRequests=new Set();
  function checkRunning() {
    if(stopRequested) fail('BROWSER_INTERRUPTED','The original browser received '+stopRequested.signal+'.');
  }
  async function closeActiveContext() {
    if(context) {
      const closing=context;context=null;page=null;
      const pending=closing.close();contextClosing=pending;
      try { await pending; }
      finally { if(contextClosing===pending)contextClosing=null; }
    } else if(contextClosing) await contextClosing;
  }
  function requestStop(signal) {
    if(stopRequested)return;
    stopRequested={signal,requested_at:now()};
    for(const request of activeRequests)
      request.destroy(Object.assign(new Error('Original browser stop requested.'),{publicCode:'BROWSER_INTERRUPTED'}));
    void closeActiveContext().catch(error=>{stopRequested.close_error=String(error.message||error);});
  }
  const stopHandlers=new Map(['SIGTERM','SIGINT'].map(signal=>[signal,()=>requestStop(signal)]));
  for(const [signal,handler]of stopHandlers)process.on(signal,handler);
  try {
    if(argv.length!==1||!isAbsolute(argv[0])) fail('INPUT_REQUIRED','Pass one absolute path to the complete browser input JSON.');
    settings=await readJSON(argv[0]);
    checkRunning();
    const fields=['schema','operation_id','connection_file','rehearsal_id','sender_workspace','receiver_workspace','output_directory','playwright_module','executable'];
    const acceptedFields=settings?.customer_review?[...fields,'customer_review']:fields;
    if(!settings||!equal(Object.keys(settings).sort(),acceptedFields.sort())||settings.schema!=='upstate.rehearsal-browser-input/v1'||
       !/^[A-Za-z0-9_-]{16,100}$/.test(settings.operation_id||'')) fail('INPUT_SCHEMA','Select the original browser receiving input.');
    for(const key of ['rehearsal_id','sender_workspace','receiver_workspace']) validId(settings[key]);
    if(settings.sender_workspace===settings.receiver_workspace) fail('DISTINCT_RECEIVER','Select the independently restored original workspace.');
    for(const key of ['connection_file','output_directory','playwright_module','executable'])
      if(typeof settings[key]!=='string'||!isAbsolute(settings[key])) fail('ABSOLUTE_PATH_REQUIRED','Use the existing absolute runtime, connection and output paths.');
    output=resolve(settings.output_directory); privateDirectory=join(output,'private');
    for(const path of [output,privateDirectory,join(output,'media'),join(output,'results'),join(output,'downloads')]) await fs.mkdir(path,{recursive:true,mode:0o700});
    connection=await readJSON(settings.connection_file);
    let operatorURL,origin;
    try { operatorURL=new URL(connection.operator_url); origin=new URL(connection.origin); }
    catch { fail('CONNECTION_FORMAT','Select the exact original operator startup JSON.'); }
    const fragments=new URLSearchParams(operatorURL.hash.slice(1)),tokens=fragments.getAll('token');
    if(operatorURL.protocol!=='http:'||operatorURL.hostname!=='127.0.0.1'||!operatorURL.port||
       operatorURL.username||operatorURL.password||operatorURL.search||!['','/'].includes(operatorURL.pathname)||
       origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.port!==operatorURL.port||
       origin.username||origin.password||origin.search||origin.hash||!['','/'].includes(origin.pathname)||
       tokens.length!==1||!tokens[0]||[...fragments.keys()].some(k=>k!=='token')||
       validId(connection.workspace_key)!==settings.sender_workspace)
      fail('CONNECTION_IDENTITY','The startup connection must be the same original loopback operator and sender.');
    const privateBinding={schema:'upstate.rehearsal-browser-origin/v1',operation_id:settings.operation_id,origin:origin.origin,
      sender_workspace:settings.sender_workspace,receiver_workspace:settings.receiver_workspace,rehearsal_id:settings.rehearsal_id};
    const originFile=join(privateDirectory,'origin.json');
    if(await exists(originFile)) { if(!equal(await readJSON(originFile),privateBinding)) fail('ORIGIN_CHANGED','Reopen this same original loopback origin so its saved browser requests remain available.'); }
    else await writeJSON(originFile,privateBinding);
    lockPath=join(privateDirectory,'caller.lock');
    const lockValue={schema:'upstate.rehearsal-browser-lock/v1',host:hostname(),pid:process.pid,operation_id:settings.operation_id,started_at:now()};
    try { lockHandle=await fs.open(lockPath,'wx',0o600); }
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      const previous=await readJSON(lockPath);
      if(previous.schema!==lockValue.schema||previous.host!==lockValue.host||previous.operation_id!==settings.operation_id||!Number.isSafeInteger(previous.pid)||previous.pid<1)
        fail('CALLER_ALREADY_ACTIVE','The retained caller lock belongs to an existing receiving process.');
      let alive=true;
      try { process.kill(previous.pid,0); } catch(signalError) { if(signalError.code==='ESRCH') alive=false; else throw signalError; }
      if(alive) fail('CALLER_ALREADY_ACTIVE','The same browser receiving process is already running.');
      await fs.unlink(lockPath); lockHandle=await fs.open(lockPath,'wx',0o600);
    }
    await lockHandle.writeFile(canonical(lockValue)+'\n'); await lockHandle.sync();
    const binding={schema:settings.schema,operation_id:settings.operation_id,rehearsal_id:settings.rehearsal_id,
      sender_workspace:settings.sender_workspace,receiver_workspace:settings.receiver_workspace,
      ...(settings.customer_review?{customer_review:{manifest:settings.customer_review.manifest,selected:settings.customer_review.selected}}:{})};
    const progressPath=join(output,'results','browser-progress.json');
    progress=await exists(progressPath)?await readJSON(progressPath):{
      schema:'upstate.rehearsal-browser-progress/v1',binding,started_at:now(),actions:{},captures:{},controls:{},phases:{},uploads:{},recordings:[],status:'RUNNING'
    };
    if(progress.schema!=='upstate.rehearsal-browser-progress/v1'||!equal(progress.binding,binding)) fail('PROGRESS_IDENTITY','The retained browser journey belongs to a different case.');
    const checkpoint=async()=>{progress.updated_at=now();await writeJSON(progressPath,progress);};
    const receiptFile=async(label,value)=>{const path=join(output,'results',label+'.json');await writeJSON(path,value);return {path:relative(output,path),...await hashFile(path)};};
    const publicPath = path => {
      const rel=relative(output,resolve(path));
      if(!rel||rel.startsWith('..'+sep)||isAbsolute(rel)||rel.split(sep).includes('private')) fail('PUBLIC_ARTIFACT_PATH','A customer artifact must be inside the selected output directory.');
      return rel.split(sep).join('/');
    };
    async function verifyArtifact(member) {
      if(!member||typeof member.path!=='string'||member.path.includes('\\')||member.path.split('/').includes('..')||member.path.split('/').includes('private')||isAbsolute(member.path))
        fail('ARTIFACT_PATH','The retained browser artifact has an invalid path.');
      const path=join(output,member.path),actual=await hashFile(path);
      if(actual.bytes!==member.bytes||actual.sha256!==member.sha256) fail('ARTIFACT_IDENTITY','The retained actual browser artifact changed.');
      return path;
    }
    async function publicFile(path, label, suffix) {
      const actual=await hashFile(path);
      if(!actual.bytes) fail('EMPTY_MEDIA','The actual browser returned an empty artifact.');
      const destination=join(output,'media',label+'-'+actual.sha256.slice(0,16)+suffix);
      if(await exists(destination)) {
        if(!equal(await hashFile(destination),actual)) fail('MEDIA_COLLISION','The retained media filename has different bytes.');
      } else {
        await fs.copyFile(path,destination,fsConstants.COPYFILE_EXCL);
        await fs.chmod(destination,0o600);
        const handle=await fs.open(destination,'r');try{await handle.sync();}finally{await handle.close();}
      }
      return {path:publicPath(destination),filename:basename(destination),...actual};
    }
    retainInterruptedRecording=async()=>{
      if(!activeRecording||activeRecording.attempt.state==='complete')return;
      const {video,attempt}=activeRecording;
      attempt.state=stopRequested?'interrupted':'failed';attempt.ended_at=now();
      attempt.interruption=copy(stopRequested||{reason:'browser_error',requested_at:now()});
      try {
        const path=await video.path();
        attempt.file=await publicFile(path,'interrupted-operator-walkthrough','.webm');
      } catch(error) {
        attempt.finalization_error=String(error.message||error);
      }
      activeRecording=null;
    };
    function api(route,parameters={}) {
      checkRunning();
      const path=route+'?'+new URLSearchParams(parameters);
      if(!route.startsWith('/api/')||/[\r\n]/.test(path)) fail('ORIGINAL_API','Choose an original operator read.');
      return new Promise((resolveRead,reject)=>{
        const request=httpRequest({hostname:'127.0.0.1',port:Number(origin.port),path,method:'GET',
          headers:{Authorization:'Bearer '+tokens[0],Accept:'application/json'}},response=>{
          const chunks=[];let bytes=0;
          response.on('data',part=>{bytes+=part.length;if(bytes>64*1024*1024) response.destroy(Object.assign(new Error('Complete original response exceeds 64 MiB.'),{publicCode:'RESPONSE_CAPACITY'}));else chunks.push(part);});
          response.on('error',reject);
          response.on('end',()=>{try{
            if(response.statusCode!==200) fail('OPERATOR_READ_HTTP_'+response.statusCode,'The original operator could not complete this read.');
            resolveRead(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          }catch(error){reject(error);}});
        });
        activeRequests.add(request);request.once('close',()=>activeRequests.delete(request));
        request.setTimeout(60000,()=>request.destroy(Object.assign(new Error('Original operator read timed out.'),{publicCode:'OPERATOR_READ_TIMEOUT'})));
        request.on('error',reject);request.end();
      });
    }
    const current=async(workspace=settings.sender_workspace)=>{
      const response=await api('/api/rehearsals/record',{workspace,id:settings.rehearsal_id});
      if(response.record?.id!==settings.rehearsal_id||!ID.test(response.record.record_sha256||'')||
         !Number.isSafeInteger(response.current_revision)||response.current_revision!==response.record.revision||
         !Array.isArray(response.history)||!response.completion||!equal(response.record.steps.map(x=>x.id),STEP_IDS))
        fail('ORIGINAL_RECORD','The full original saved rehearsal response is incomplete.');
      return response;
    };
    const recordFields=record=>({title:record.title,operator:record.operator,audience:record.audience,mode:record.mode,
      selection:copy(record.selection),notes:record.notes||'',science_notes:record.science_notes||''});
    const normalizedSelection=selection=>{
      const result={alternative_run_ids:copy(selection.alternative_run_ids||[])};
      for(const key of SINGLE_SELECTION) if(selection[key])result[key]=selection[key];
      return result;
    };
    const matchesFields=(record,fields)=>equal({...recordFields(record),selection:normalizedSelection(record.selection)},
      {...fields,selection:normalizedSelection(fields.selection)});
    if(await exists(join(output,'result.json'))) {
      const result=await readJSON(join(output,'result.json'));
      if(result.state!=='COMPLETE'||result.rehearsal_id!==settings.rehearsal_id||!equal(result.binding,binding))
        fail('RESULT_IDENTITY','The retained browser result belongs to a different operation.');
      for(const file of result.files) await verifyArtifact(file);
      const latest=await current();
      if(latest.record.record_sha256!==result.sender.record_sha256) fail('COMPLETED_CASE_CHANGED','The saved case changed after this completed browser delivery.');
      process.stdout.write(canonical({state:'COMPLETE',operation_id:settings.operation_id,rehearsal_id:settings.rehearsal_id,result:'result.json',reused:true})+'\n');
      return result;
    }
    if(!progress.initial) {
      const sender=await current(),receiver=await current(settings.receiver_workspace);
      if(sender.record.active_step) fail('ACTIVE_NATIVE_STEP','Complete the original native receiving step before its browser walkthrough.');
      if(sender.record.project_id!==receiver.record.project_id) fail('PROJECT_IDENTITY','The receiving copy must retain the same original scientific project.');
      progress.initial={sender:await receiptFile('sender-before-browser',sender),receiver:await receiptFile('receiver-before-browser',receiver),
        sender_revision:sender.record.revision,sender_record_sha256:sender.record.record_sha256,
        receiver_revision:receiver.record.revision,receiver_record_sha256:receiver.record.record_sha256,fields:recordFields(sender.record)};
      await checkpoint();
    }
    const original=await readJSON(await verifyArtifact(progress.initial.sender));
    const originalReceiver=await readJSON(await verifyArtifact(progress.initial.receiver));
    await fs.access(settings.playwright_module);await fs.access(settings.executable,fsConstants.X_OK);
    const imported=await import(pathToFileURL(settings.playwright_module).href);
    const chromium=imported.chromium||imported.default?.chromium;
    if(!chromium?.launchPersistentContext) fail('PLAYWRIGHT_RUNTIME','Use the existing Playwright module with Chromium support.');
    const profile=join(privateDirectory,'profile');
    async function launch(recordingDirectory=null,recordingAttempt=null) {
      checkRunning();
      context=await chromium.launchPersistentContext(profile,{
        executablePath:settings.executable,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},
        ...(recordingDirectory?{recordVideo:{dir:recordingDirectory,size:{width:1440,height:1000}}}:{})
      });
      checkRunning();
      context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
      page=context.pages()[0]||await context.newPage();
      if(recordingAttempt){const video=page.video();if(video)activeRecording={video,attempt:recordingAttempt};}
      // Other retained pages are closed only within this caller-owned private profile.
      for(const other of context.pages())if(other!==page)await other.close();
      page.on('pageerror',error=>uiErrors.push({observed_at:now(),message:String(error.stack||error)}));
      await page.goto(connection.operator_url,{waitUntil:'domcontentloaded'});
      await waitFor(async()=>await page.locator('#workspace-select option[value="'+settings.sender_workspace+'"]').count(),'OPERATOR_OPEN');
      await selectWorkspace(settings.sender_workspace);
    }
    async function closeBrowser() {
      await closeActiveContext();
      if(uiErrors.length) {await writeJSON(join(privateDirectory,'browser-errors.json'),uiErrors);}
    }
    const locator=selector=>{checkRunning();return page.locator(selector);};
    async function click(selector) {
      const target=locator(selector).first();
      await target.waitFor({state:'visible'});
      await waitFor(()=>target.isEnabled(),'CONTROL_DISABLED');
      checkRunning();await target.click();
    }
    async function closeDialogs() {
      for(const [dialog,button] of [['#form-dialog','[data-action="form-close"]'],['#detail-dialog','[data-action="detail-close"]']])
        if(await locator(dialog).evaluate(el=>el.open)) await click(dialog+' '+button);
    }
    async function selectWorkspace(workspace) {
      await closeDialogs();
      if(await locator('#workspace-select').inputValue()!==workspace) await locator('#workspace-select').selectOption(workspace);
      await waitFor(()=>locator('#workspace-select').inputValue().then(value=>value===workspace),'WORKSPACE_REOPEN');
      await waitFor(async()=>{const value=await api('/api/state',{workspace});return value.workspace_key===workspace;},'WORKSPACE_STATE');
    }
    async function browserState(workspace=settings.sender_workspace) {
      return page.evaluate(async workspace=>{
        if(typeof indexedDB.databases==='function'&&!(await indexedDB.databases()).some(x=>x.name==='upstate-operator-rehearsal'))return null;
        return new Promise((resolveRead,reject)=>{
          const request=indexedDB.open('upstate-operator-rehearsal');
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{
            const db=request.result;
            if(!db.objectStoreNames.contains('workspaces')){db.close();resolveRead(null);return;}
            const tx=db.transaction('workspaces','readonly'),get=tx.objectStore('workspaces').get(location.origin+'|'+workspace);
            let value=null;get.onsuccess=()=>{value=get.result||null;};
            tx.oncomplete=()=>{db.close();resolveRead(value);};
            tx.onerror=()=>{db.close();reject(tx.error);};
          };
        });
      },workspace);
    }
    async function openRehearsal(workspace=settings.sender_workspace) {
      await selectWorkspace(workspace);await click('[data-view="rehearsal"]');
      await waitFor(async()=>await locator('[data-rehearsal-root] .rh-project-line code').textContent()===workspace,'REHEARSAL_MOUNT');
      const expected=await current(workspace);
      await click('[data-rh="inventory"]');
      const search=locator('[name="inventory_search"]');if(await search.count())await search.fill('');
      await click('[data-rh="open"][data-id="'+settings.rehearsal_id+'"]');
      await waitFor(async()=>{const state=await browserState(workspace);return state?.selection?.id===settings.rehearsal_id&&state.selection.revision>=expected.record.revision;},'SAVED_REHEARSAL_OPEN');
      await waitFor(()=>locator('[data-rh="tab"][data-tab="prepare"]').isVisible(),'REHEARSAL_READY');
      return current(workspace);
    }
    async function tab(name) {await click('[data-rh="tab"][data-tab="'+name+'"]');}
    async function step(id) {await tab('walkthrough');await click('[data-rh="step"][data-step="'+id+'"]');}
    async function readDraft() {return await waitFor(async()=>{const state=await browserState();return state?.drafts?.[settings.rehearsal_id];},'DRAFT_READY');}
    async function fillFields(fields) {
      await tab('prepare');
      for(const name of ['title','operator','audience','notes','science_notes']) {
        await locator('[data-rh-form="prepare"] [name="'+name+'"]').fill(fields[name]||'');
        await waitFor(async()=>equal((await readDraft()).fields[name],fields[name]||''),'DRAFT_RETAINED');
      }
      await locator('[name="mode"][value="'+fields.mode+'"]').check();
      await waitFor(async()=>(await readDraft()).fields.mode===fields.mode,'MODE_RETAINED');
      for(const key of SINGLE_SELECTION) {
        await locator('[name="selection.'+key+'"]').selectOption(fields.selection[key]||'');
        await waitFor(async()=>((await readDraft()).fields.selection[key]||null)===(fields.selection[key]||null),'SELECTION_RETAINED');
      }
      const selected=fields.selection.alternative_run_ids||[];
      const choices=await locator('[name="alternative_run_ids"]').evaluateAll(nodes=>nodes.map(x=>x.value));
      for(const id of selected)if(!choices.includes(id))fail('ALTERNATIVE_MISSING','A selected original run is absent from the original chooser.');
      // Clear and select in the original order; comparison identities retain that order.
      for(const id of choices) await locator('[name="alternative_run_ids"][value="'+id+'"]').uncheck();
      for(const id of selected) await locator('[name="alternative_run_ids"][value="'+id+'"]').check();
      await waitFor(async()=>equal((await readDraft()).fields.selection.alternative_run_ids||[],selected),'ALTERNATIVES_RETAINED');
    }
    async function stepDraft(id) {
      return await waitFor(async()=>{const value=await browserState();return value?.stepDrafts?.[settings.rehearsal_id+':'+id];},'STEP_DRAFT_READY');
    }
    async function stepNote(id,note) {
      await locator('[name="step_note"]').fill(note);
      await waitFor(async()=>(await stepDraft(id)).note===note,'STEP_NOTE_RETAINED');
    }
    function checkTask(task,entry) {
      if(task.schema!=='upstate.operator-task/v1'||task.workspace!==settings.sender_workspace||task.action!==entry.action||
         !equal(task.payload,entry.payload)||task.request_sha256!==digest({workspace:task.workspace,action:task.action,payload:task.payload})||
         task.id!==digest({workspace:task.workspace,operation_id:task.operation_id}))
        fail('TASK_IDENTITY','The browser result must match the full original saved request and native task.');
      if(entry.task_id&&entry.task_id!==task.id)fail('TASK_CHANGED','The native task identity changed during receiving.');
    }
    async function mutate(label,action,prepare,arm) {
      checkRunning();
      let entry=progress.actions[label];
      if(entry?.state==='complete') {
        const task=await readJSON(await verifyArtifact(entry.receipt));checkTask(task,entry);return task;
      }
      await openRehearsal();
      if(!entry) {
        const state=await browserState();
        if(state?.pending)fail('EXISTING_REQUEST','Reconcile the existing original browser request before preparing a different action.');
        const payload=await prepare();
        entry=progress.actions[label]={action,payload:copy(payload),before_operations:(state?.receipts||[]).map(x=>x.request?.operation_id),
          created_at:now(),state:'prepared',request:null,task_id:null};
        await checkpoint();
      }
      let reconciliationUsed=false,resumeUsed=false,clicked=false;
      const end=Date.now()+10*60*1000;
      while(Date.now()<end) {
        checkRunning();
        const state=await browserState();
        const all=[...(state?.receipts||[]),...(state?.pending?[state.pending]:[])];
        const candidates=all.filter(row=>row.request?.workspace===settings.sender_workspace&&row.request.action===entry.action&&equal(row.request.payload,entry.payload)&&
          (entry.request?row.request.operation_id===entry.request.operation_id:!entry.before_operations.includes(row.request.operation_id)));
        if(candidates.length>1)fail('REQUEST_AMBIGUITY','More than one retained browser operation matches this original action.');
        const retained=candidates[0];
        if(retained) {
          if(!entry.request){entry.request=copy(retained.request);entry.state='retained';await checkpoint();}
          if(retained.task_id) {
            const task=await api('/api/task',{id:validId(retained.task_id)});
            checkTask(task,entry);entry.task_id=task.id;entry.native_state=task.state;await checkpoint();
            if(task.state==='complete'&&!state.pending) {
              entry.receipt=await receiptFile('action-'+label,task);entry.state='complete';entry.completed_at=now();await checkpoint();return task;
            }
            if(['failed','interrupted','cancelled'].includes(task.state)) {
              if(!resumeUsed&&await locator('[data-rh="resume"]').isVisible()&&await locator('[data-rh="resume"]').isEnabled()) {
                resumeUsed=true;await click('[data-rh="resume"]');
              } else if(resumeUsed&&task.state==='failed') fail('NATIVE_TASK_FAILED','The original task remains failed after its exact native continuation.');
            }
          }
          if(state.pending&&!reconciliationUsed&&await locator('[data-rh="reconcile"]').isVisible()&&await locator('[data-rh="reconcile"]').isEnabled()) {
            reconciliationUsed=true;await click('[data-rh="reconcile"]');
          }
        } else if(!clicked) {
          if(state?.pending)fail('DIFFERENT_PENDING_REQUEST','Another original browser request is pending in this workspace.');
          await arm(entry.payload);
          clicked=true;
        }
        await pause(250);
      }
      fail('ORIGINAL_TASK_PENDING','The original browser task remains retained; resume this same input to receive its actual completion.');
    }
    async function saveCase(label,fields) {
      return mutate(label,'rehearsal.save',async()=>{
        const currentRecord=(await current()).record;
        if(currentRecord.active_step)fail('ACTIVE_TEACHING_STEP','Complete the active teaching step before changing the saved case.');
        await fillFields(fields);const draft=await readDraft();
        return {...copy(draft.fields),id:settings.rehearsal_id,expected_revision:draft.base_revision};
      },async payload=>{
        const latest=(await current()).record;
        if(latest.revision!==payload.expected_revision)fail('REVISION_CONFLICT','The saved case changed before this frozen preparation was dispatched.');
        await fillFields(payload);const d=await readDraft();
        if(!equal({...d.fields,id:settings.rehearsal_id,expected_revision:d.base_revision},payload))fail('DRAFT_CHANGED','The retained preparation differs from the complete frozen original fields.');
        await click('[data-rh-form="prepare"] button[type="submit"]');
      });
    }
    async function screenshot(label,metadata={}) {
      if(progress.captures[label]) {await verifyArtifact(progress.captures[label]);return progress.captures[label];}
      await page.evaluate(()=>document.fonts.ready);
      const temporary=join(privateDirectory,label+'-'+randomUUID()+'.png');
      await page.screenshot({path:temporary,fullPage:true,animations:'disabled'});
      const member=await publicFile(temporary,label,'.png');await fs.unlink(temporary);
      const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
        heading:document.querySelector('#detail-dialog[open] #detail-title')?.textContent||document.querySelector('#content h1,#content h2')?.textContent||'',view:location.hash.slice(1)}));
      const rec=await current(await locator('#workspace-select').inputValue());
      progress.captures[label]={...member,captured_at:now(),workspace:await locator('#workspace-select').inputValue(),
        rehearsal_id:settings.rehearsal_id,revision:rec.record.revision,record_sha256:rec.record.record_sha256,...metrics,...metadata};
      await checkpoint();return progress.captures[label];
    }
    async function preservedCase(label,fields) {
      await closeBrowser();await launch();const reopened=await openRehearsal();
      if(!matchesFields(reopened.record,fields))fail('SAVED_FIELDS_DIFFER','Reopening changed the complete saved preparation.');
      progress.phases[label]={state:'complete',record:await receiptFile(label,reopened),reopened_at:now()};
      await tab('prepare');await screenshot(label,{meaning:'Actual saved preparation after closing and reopening the original persistent browser.'});await checkpoint();
    }
    async function inspectControl(id,index,control) {
      const key=id+'-'+index;
      if(progress.controls[key])return;
      await openRehearsal();await step(id);
      const selector='[data-rh="control"][data-control="'+index+'"]';
      const beforeErrors=await locator('#global-error').textContent();
      await click(selector);
      let outcome=null;
      await waitFor(async()=>{
        if(control.type==='view'&&await locator('[data-view="'+control.view+'"]').getAttribute('aria-current')==='page')return outcome={state:'opened',surface:'view',view:control.view};
        if(await locator('#form-dialog').evaluate(el=>el.open))return outcome={state:'opened',surface:'form',title:await locator('#form-title').textContent()};
        if(await locator('#detail-dialog').evaluate(el=>el.open))return outcome={state:'opened',surface:'record',title:await locator('#detail-title').textContent()};
        if(control.kind==='tasks'&&await locator('#task-panel').isVisible())return outcome={state:'opened',surface:'task'};
        const message=await locator('#global-error').textContent();
        if(message&&message!==beforeErrors&&await locator('#global-error').isVisible())return outcome={state:'unavailable',message};
        const inline=locator('[data-rehearsal-root] .rh-alert[role="alert"]');
        if(await inline.count()&&await inline.first().isVisible())return outcome={state:'unavailable',message:await inline.first().innerText()};
        return false;
      },'NATIVE_CONTROL_RESPONSE');
      // Opening a native form exposes its real controls; submission stays with the original native case programme.
      const fields=await page.locator('#form-dialog[open] [name],#detail-dialog[open] [name]').evaluateAll(nodes=>nodes.map(el=>({
        name:el.name,type:el.type||el.tagName.toLowerCase(),value:el.type==='file'?null:el.value,
        required:!!el.required,disabled:!!el.disabled,choices:el.tagName==='SELECT'?[...el.options].map(x=>({value:x.value,label:x.textContent,disabled:x.disabled})):undefined
      })));
      let originalItem=null;
      if(control.type==='item'&&control.kind!=='tasks')originalItem=await api('/api/item',{workspace:settings.sender_workspace,kind:control.kind,id:control.id});
      const file=await screenshot('control-'+key,{step_id:id,control:copy(control),outcome,meaning:'Actual original control opened during the saved case walkthrough.'});
      progress.controls[key]={step_id:id,control:copy(control),outcome,fields,
        ...(originalItem?{original:await receiptFile('control-'+key+'-record',originalItem)}:{}),screenshot:file.path,inspected_at:now()};
      await checkpoint();await closeDialogs();
    }
    await launch();
    if(!progress.phases.saved_edits) {
      const fields=copy(progress.initial.fields);
      const note='Browser walkthrough '+settings.operation_id+': saved preparation reopened, original scientific controls inspected, and case selection restored before handover.';
      fields.notes=fields.notes?fields.notes+'\n\n'+note:note;
      progress.edited_fields=fields;await checkpoint();
      await saveCase('saved-edits',fields);
      await preservedCase('saved_edits',fields);
    }
    if(!progress.phases.changed_case) {
      const fields=copy(progress.edited_fields);
      // A source-only preparation uses the existing source and deliberately clears dependent outputs.
      // It demonstrates real selection/completion changes without inventing a model result.
      fields.selection={alternative_run_ids:[]};
      if(progress.initial.fields.selection.source_collection_id)fields.selection.source_collection_id=progress.initial.fields.selection.source_collection_id;
      if(equal(normalizedSelection(fields.selection),normalizedSelection(progress.initial.fields.selection)))fields.selection={alternative_run_ids:[]};
      if(equal(normalizedSelection(fields.selection),normalizedSelection(progress.initial.fields.selection)))fail('SCIENTIFIC_CASE_REQUIRED','The selected original case needs an actual source, grid, profile or run before demonstrating a changed scientific selection.');
      progress.changed_fields=fields;await checkpoint();
      await saveCase('changed-case',fields);await preservedCase('changed_case',fields);
      const changed=await current();
      progress.phases.changed_case.completion=copy(changed.completion);await checkpoint();
    }
    if(!progress.phases.restored_case) {
      await saveCase('restored-case',progress.edited_fields);await preservedCase('restored_case',progress.edited_fields);
      const restored=await current();
      if(!equal(restored.completion,original.completion))fail('COMPLETION_RESTORE','The restored scientific selection must retain the original current-case completion.');
      progress.phases.restored_case.completion=copy(restored.completion);await checkpoint();
    }
    if(!progress.phases.controls) {
      const detail=await openRehearsal();
      for(const lesson of detail.record.steps) {
        await step(lesson.id);
        await screenshot('lesson-'+lesson.id,{step_id:lesson.id,meaning:'Original teaching instructions, current evidence and retained attempt history.'});
        for(let index=0;index<lesson.controls.length;index++)await inspectControl(lesson.id,index,lesson.controls[index]);
        await openRehearsal();
      }
      for(const name of ['prepare','evidence','history','export']){await tab(name);await screenshot('desktop-'+name);}
      progress.phases.controls={state:'complete',inspected_at:now(),controls:Object.keys(progress.controls).length};await checkpoint();
    }
    if(!progress.phases.mobile) {
      await page.setViewportSize({width:390,height:844});await openRehearsal();
      for(const name of ['prepare','walkthrough','evidence','export']) {
        await tab(name);
        if(name==='walkthrough')await step('calculation');
        await screenshot('mobile-'+name,{meaning:'Actual narrow-screen rendering of the original saved case.'});
      }
      await page.setViewportSize({width:1440,height:1000});
      progress.phases.mobile={state:'complete',captured_at:now()};await checkpoint();
    }
    if(!progress.phases.receiver) {
      const received=await openRehearsal(settings.receiver_workspace);
      if(received.record.record_sha256!==progress.initial.receiver_record_sha256||!equal(received.record,originalReceiver.record))
        fail('RECEIVER_CHANGED','The independent original receiving note changed during the sender walkthrough.');
      await tab('evidence');await screenshot('independent-receiver',{meaning:'The independently restored original scientific workspace and retained receiving note.'});
      progress.phases.receiver={state:'complete',record:await receiptFile('receiver-opened',received),opened_at:now()};await checkpoint();await openRehearsal();
    }
    if(!progress.phases.recording) {
      await closeBrowser();
      const attempt={id:randomUUID(),started_at:now(),state:'started',frames:[]};progress.recordings.push(attempt);await checkpoint();
      const directory=join(privateDirectory,'recordings',attempt.id);await fs.mkdir(directory,{recursive:true,mode:0o700});
      await launch(directory,attempt);const video=page.video();if(!video)fail('VIDEO_UNAVAILABLE','The existing Chromium context did not start its actual video recording.');
      activeRecording={video,attempt};
      for(const view of ['sources','profiles','runs','spatial','comparisons','deliveries']) {
        await closeDialogs();await click('[data-view="'+view+'"]');
        await waitFor(()=>locator('[data-view="'+view+'"]').getAttribute('aria-current').then(value=>value==='page'),'VIDEO_VIEW');
        await page.evaluate(()=>document.fonts.ready);await pause(1800);attempt.frames.push({view,displayed_at:now()});
      }
      await openRehearsal();await step('calculation');await pause(1800);attempt.frames.push({view:'rehearsal',step_id:'calculation',displayed_at:now()});
      await tab('evidence');await pause(1800);attempt.frames.push({view:'rehearsal',tab:'evidence',displayed_at:now()});
      if(settings.customer_review) {
        const {runCustomerReviewChapter}=await import('../source_tools/simulated_customer_review_browser.mjs');
        const captureCustomer=async(label,metadata)=>{
          if(progress.captures[label]){await verifyArtifact(progress.captures[label]);return progress.captures[label];}
          await page.evaluate(()=>document.fonts.ready);checkRunning();
          const temporary=join(privateDirectory,label+'-'+randomUUID()+'.png');
          await page.screenshot({path:temporary,fullPage:true,animations:'disabled'});
          const member=await publicFile(temporary,label,'.png');await fs.unlink(temporary);
          const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},heading:document.querySelector('h1')?.textContent||''}));
          progress.captures[label]={...member,...metrics,...metadata,captured_at:now(),workspace:settings.sender_workspace,rehearsal_id:settings.rehearsal_id};
          await checkpoint();return progress.captures[label];
        };
        progress.phases.customer_review=await runCustomerReviewChapter({
          page,choice:settings.customer_review,output,checkRunning,capture:captureCustomer,checkpoint,progress,pause});
        await checkpoint();
        await page.goto(connection.operator_url,{waitUntil:'domcontentloaded'});
        await waitFor(async()=>await page.locator('#workspace-select option[value="'+settings.sender_workspace+'"]').count(),'OPERATOR_RETURN');
        await openRehearsal();await tab('evidence');
        attempt.frames.push({view:'customer_review_handback',customer_ids:settings.customer_review.selected,displayed_at:now()});
      }
      await closeBrowser();const path=await video.path();const member=await publicFile(path,'operator-walkthrough','.webm');
      attempt.state='complete';attempt.ended_at=now();attempt.file=member;
      progress.phases.recording={state:'complete',...member,started_at:attempt.started_at,ended_at:attempt.ended_at,frames:copy(attempt.frames)};
      await checkpoint();activeRecording=null;await launch();
    }
    async function uploadMedia(member,stepId) {
      const path=await verifyArtifact(member),key=member.sha256;
      if(progress.uploads[key])return progress.uploads[key];
      await openRehearsal();await step(stepId);
      const state=await browserState(),draft=await stepDraft(stepId);
      const existing=(draft.uploads||[]).find(x=>x.sha256===member.sha256&&x.bytes===member.bytes&&x.filename===member.filename);
      if(existing){progress.uploads[key]=copy(existing);await checkpoint();return existing;}
      if(state.uploadPending&&!equal({sha256:state.uploadPending.file.sha256,bytes:state.uploadPending.file.bytes,filename:state.uploadPending.file.filename},
        {sha256:member.sha256,bytes:member.bytes,filename:member.filename}))
        fail('ORIGINAL_UPLOAD_PENDING','Reselect the exact original media retained for the active upload.');
      await locator('[name="media_file"]').setInputFiles(path);await click('[data-rh="upload-media"]');
      const uploaded=await waitFor(async()=>{
        const currentDraft=await stepDraft(stepId);
        return (currentDraft.uploads||[]).find(x=>x.sha256===member.sha256&&x.bytes===member.bytes&&x.filename===member.filename);
      },'ORIGINAL_MEDIA_PENDING',120000);
      progress.uploads[key]=copy(uploaded);await checkpoint();return uploaded;
    }
    if(!progress.phases.media_attached) {
      const stepId='study';
      const members=[...Object.values(progress.captures),progress.phases.recording];
      await mutate('media-begin','rehearsal.begin',async()=>{
        const detail=await current();await step(stepId);
        const note='Demonstrating the saved browser workflow for '+settings.operation_id+'.';
        await stepNote(stepId,note);
        return {id:settings.rehearsal_id,expected_revision:detail.record.revision,step_id:stepId,note};
      },async payload=>{
        await step(stepId);await stepNote(stepId,payload.note);
        const latest=await current(),state=await browserState();
        if(state?.pending||state?.uploadPending)
          fail('ORIGINAL_REQUEST_PENDING','Reconcile the retained original action or media upload before this frozen step.');
        const visible=state?.selection,draft=state?.stepDrafts?.[settings.rehearsal_id+':'+stepId];
        const actual={id:visible?.id,expected_revision:visible?.revision,step_id:visible?.step,note:draft?.note||''};
        if(latest.record.id!==payload.id||latest.record.revision!==payload.expected_revision||
           latest.record.active_step||!equal(actual,payload))
          fail('FROZEN_MEDIA_BEGIN_CHANGED','The current teaching revision or retained step draft differs from the original prepared begin request. Preserve that request before continuing.');
        await click('[data-rh="begin"]');
      });
      for(const member of members)await uploadMedia(member,stepId);
      const note='Actual browser walkthrough '+settings.operation_id+'. The saved edits were reopened, the scientific selection was changed and restored, all nine teaching steps and their native controls were inspected, the independent receiver was opened, and desktop/narrow-screen screenshots and a Chromium recording were retained. Scientific outcomes and physical units remain those of the original saved evidence. Controls opened: '+Object.keys(progress.controls).length+'.';
      await mutate('media-record','rehearsal.record',async()=>{
        const detail=await current();await step(stepId);await stepNote(stepId,note);
        for(const node of await locator('[name="task_ids"]:checked').all())await node.uncheck();
        await waitFor(async()=>(await stepDraft(stepId)).task_ids.length===0,'MEDIA_TASK_SELECTION');
        const uploads=(await stepDraft(stepId)).uploads||[];
        for(const member of members)if(!uploads.some(x=>x.sha256===member.sha256&&x.bytes===member.bytes))fail('MEDIA_SELECTION','Every actual capture must be selected in the original step draft.');
        const live=Array.isArray(detail.live.steps)?detail.live.steps.find(x=>x.id===stepId):detail.live.steps?.[stepId];
        const ready=!!(live||detail.record.steps.find(x=>x.id===stepId))?.ready;
        return {id:settings.rehearsal_id,expected_revision:detail.record.revision,step_id:stepId,outcome:ready?'observed':'deferred',
          task_ids:[],upload_ids:uploads.map(x=>x.id),note:ready?note:note+' The native source-study evidence remains incomplete in this saved case.'};
      },async payload=>{
        await step(stepId);await stepNote(stepId,payload.note);
        const latest=await current(),state=await browserState();
        if(state?.pending||state?.uploadPending)
          fail('ORIGINAL_REQUEST_PENDING','Reconcile the retained original action or media upload before this frozen observation.');
        const visible=state?.selection,draft=state?.stepDrafts?.[settings.rehearsal_id+':'+stepId];
        const actual={id:visible?.id,expected_revision:visible?.revision,step_id:visible?.step,
          outcome:payload.outcome,task_ids:copy(draft?.task_ids||[]),upload_ids:(draft?.uploads||[]).map(x=>x.id),note:draft?.note||''};
        if(!['observed','deferred'].includes(payload.outcome)||latest.record.id!==payload.id||
           latest.record.revision!==payload.expected_revision||latest.record.active_step?.step_id!==payload.step_id||
           !equal(actual,payload))
          fail('FROZEN_MEDIA_RECORD_CHANGED','The current teaching revision, task selection or retained media selection differs from the original prepared observation. Preserve that request before continuing.');
        await click('[data-rh="record-'+payload.outcome+'"]');
      });
      const detail=await current(),files=detail.record.steps.flatMap(x=>x.attempts.flatMap(a=>a.files||[]));
      for(const member of members)if(!files.some(x=>x.sha256===member.sha256&&x.bytes===member.bytes))fail('RECORDED_MEDIA_MISSING','The actual saved attempt must include every original capture.');
      progress.phases.media_attached={state:'complete',revision:detail.record.revision,record_sha256:detail.record.record_sha256,files:members.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256}))};await checkpoint();
    }
    if(!progress.phases.download) {
      const task=await mutate('browser-export','rehearsal.export',async()=>{const detail=await current();await tab('export');return{id:settings.rehearsal_id,revision:detail.record.revision};},
        async payload=>{
          await tab('export');
          const latest=await current(),state=await browserState();
          if(state?.pending||state?.uploadPending)
            fail('ORIGINAL_REQUEST_PENDING','Reconcile the retained original action or media upload before this frozen export.');
          const actual={id:state?.selection?.id,revision:state?.selection?.revision};
          if(latest.record.id!==payload.id||latest.record.revision!==payload.revision||!equal(actual,payload))
            fail('FROZEN_EXPORT_CHANGED','The displayed teaching edition differs from the original prepared export. Preserve that request before continuing.');
          await click('[data-rh="export"]');
        });
      await openRehearsal();await tab('export');
      const state=await browserState(),index=(state.receipts||[]).findIndex(x=>x.task_id===task.id);
      if(index<0)fail('EXPORT_RECEIPT_MISSING','The complete native export must remain in the original browser receipt history.');
      await click('[data-rh="refresh-receipt"][data-index="'+index+'"]');
      const fresh=await api('/api/task',{id:task.id});
      const packet=fresh.result?.files?.packet;
      const ticket=(fresh._downloads||[]).find(x=>x.sha256===packet?.sha256&&x.bytes===packet?.bytes);
      if(!ticket||!ID.test(ticket.id||'')||ticket.url!=='/api/file/'+ticket.id||!ID.test(ticket.sha256||'')||!Number.isSafeInteger(ticket.bytes))
        fail('NATIVE_PACKET_TICKET','The complete native packet must have its original authenticated file ticket.');
      const href=ticket.url+'?download=1';
      const responsePromise=page.waitForResponse(response=>{const url=new URL(response.url());return url.origin===origin.origin&&url.pathname===ticket.url&&url.search==='?download=1';});
      const downloadPromise=page.waitForEvent('download');
      await click('a[href="'+href+'"][download]');
      const [download,response]=await Promise.all([downloadPromise,responsePromise]);
      if(response.status()!==200)fail('DOWNLOAD_HTTP','The original browser download did not return the complete native packet.');
      const headers=await response.allHeaders();
      if(Number(headers['content-length'])!==ticket.bytes||headers.etag!=='"'+ticket.sha256+'"')
        fail('DOWNLOAD_HEADER_IDENTITY','The actual browser response differs from the native file ticket.');
      const file=join(output,'downloads','walkthrough-'+ticket.sha256+'.zip');
      if(await exists(file)) {const actual=await hashFile(file);if(actual.bytes!==ticket.bytes||actual.sha256!==ticket.sha256)fail('DOWNLOAD_COLLISION','The existing native packet differs from the original ticket.');}
      else await download.saveAs(file);
      if(await download.failure())fail('DOWNLOAD_INCOMPLETE','The browser did not finish its original native packet download.');
      const actual=await hashFile(file);
      if(actual.bytes!==ticket.bytes||actual.sha256!==ticket.sha256)fail('DOWNLOAD_BYTES','The browser download differs from the complete original packet.');
      progress.phases.download={state:'complete',file:{path:publicPath(file),...actual},ticket:{id:ticket.id,filename:ticket.filename,bytes:ticket.bytes,sha256:ticket.sha256},
        response:{status:response.status(),content_length:Number(headers['content-length']),etag:headers.etag},
        task_id:task.id,revision:fresh.result.revision,record_sha256:fresh.result.record_sha256,suggested_filename:download.suggestedFilename(),completed_at:now()};
      await checkpoint();
    }
    const final=await current(),receiver=await current(settings.receiver_workspace);
    if(!matchesFields(final.record,progress.edited_fields)||final.record.active_step)fail('FINAL_CASE','The completed browser walkthrough must preserve the original scientific selection and finish its media attempt.');
    if(!equal(receiver.record,originalReceiver.record))fail('INDEPENDENT_RECEIVER_CHANGED','The original independent receiving note must remain intact.');
    if(progress.phases.download.record_sha256!==final.record.record_sha256)fail('FINAL_PACKET_REVISION','The downloaded packet must contain the current complete media-bearing rehearsal revision.');
    const recordReceipt=await receiptFile('sender-after-browser',final);
    const files=[recordReceipt,progress.initial.sender,progress.initial.receiver,...Object.values(progress.captures).map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),
      {path:progress.phases.recording.path,bytes:progress.phases.recording.bytes,sha256:progress.phases.recording.sha256},progress.phases.download.file,
      ...Object.values(progress.actions).map(x=>x.receipt),...Object.values(progress.controls).filter(x=>x.original).map(x=>x.original),
      ...['saved_edits','changed_case','restored_case','receiver'].map(x=>progress.phases[x].record),
      ...progress.recordings.filter(x=>x.file).map(x=>({path:x.file.path,bytes:x.file.bytes,sha256:x.file.sha256})),
      ...(progress.customer_review?.downloads||[])];
    const unique=[...new Map(files.map(x=>[x.path,x])).values()];
    for(const member of unique)await verifyArtifact(member);
    await closeBrowser();
    checkRunning();progress.status='COMPLETE';progress.completed_at=now();await checkpoint();
    const result={schema:'upstate.rehearsal-browser-result/v1',state:'COMPLETE',binding,operation_id:settings.operation_id,rehearsal_id:settings.rehearsal_id,
      started_at:progress.started_at,completed_at:progress.completed_at,
      sender:{workspace:settings.sender_workspace,revision:final.record.revision,record_sha256:final.record.record_sha256},
      receiver:{workspace:settings.receiver_workspace,revision:receiver.record.revision,record_sha256:receiver.record.record_sha256},
      scientific_completion:copy(final.completion),phases:copy(progress.phases),controls:copy(progress.controls),files:unique,
      meaning:'The existing browser completed the saved-edit/reopen, changed-selection/restore, scientific-control review, desktop/mobile media, original UI upload and verified native packet download on this same rehearsal. Scientific completion and unavailable controls are recorded from their actual native evidence.'};
    await writeJSON(join(output,'result.json'),result);
    process.stdout.write(canonical({state:'COMPLETE',operation_id:settings.operation_id,rehearsal_id:settings.rehearsal_id,result:'result.json',
      revision:final.record.revision,media_files:Object.keys(progress.captures).length+1,inspected_controls:Object.keys(progress.controls).length})+'\n');
    return result;
  } catch(error) {
    try { await closeActiveContext(); } catch(closeError) {
      if(stopRequested)stopRequested.close_error=String(closeError.message||closeError);
    }
    if(retainInterruptedRecording)try{await retainInterruptedRecording();}catch{}
    if(stopRequested) {
      error.publicCode='BROWSER_INTERRUPTED';
      if(progress) {
        progress.interruptions=progress.interruptions||[];
        progress.interruptions.push(copy(stopRequested));
      }
    }
    // Full diagnostics stay with the caller-owned private profile and connection.
    if(privateDirectory) {
      try {await writeJSON(join(privateDirectory,'last-error.json'),{observed_at:now(),message:String(error.message||error),stack:String(error.stack||''),browser_errors:uiErrors});}catch{}
      if(progress&&output)try{progress.status=stopRequested?'INTERRUPTED':'INCOMPLETE';progress.last_error={code:error.publicCode||'BROWSER_CALLER_ERROR',observed_at:now()};
        await writeJSON(join(output,'results','browser-progress.json'),progress);}catch{}
    }
    process.stderr.write(canonical({state:stopRequested?'INTERRUPTED':'INCOMPLETE',operation_id:/^[A-Za-z0-9_-]{16,100}$/.test(settings?.operation_id||'')?settings.operation_id:null,rehearsal_id:ID.test(settings?.rehearsal_id||'')?settings.rehearsal_id:null,
      code:error.publicCode||'BROWSER_CALLER_ERROR',message:'The complete original browser state is retained. Continue with this same receiving input.'})+'\n');
    process.exitCode=stopRequested?130:1;return null;
  } finally {
    try{await closeActiveContext();}catch{}
    for(const [signal,handler]of stopHandlers)process.off(signal,handler);
    if(lockHandle){try{await lockHandle.close();}catch{}try{await fs.unlink(lockPath);}catch{}}
  }
}

await rehearsalBrowserMain(process.argv.slice(2));
