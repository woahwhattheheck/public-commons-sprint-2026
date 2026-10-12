#!/usr/bin/env node
// MIT. One retained original operation: HTTP capture → review → Research → two receiving generations.
// It uses the maintained native APIs and unchanged upstream software fixtures, never a live customer library.
import {join,resolve,isAbsolute} from 'node:path';
import {readFile,open,chmod} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {privateDirectory,writeJson,readJson,writeBytes,readBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {openDossierStore} from '../../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import {startZoteroWorkspace} from '../server.mjs';
import {createZoteroClient,loadZoteroConnection} from '../client.mjs';
import {receiveWorkspace} from '../workspace.mjs';
import {makeDocumentSet} from '../source.mjs';
import {SCHEMA,LIMIT,need,json,parse,sha256,safeCode} from '../contracts.mjs';
import {loadProtocolSources,startProtocolSource,LIBRARY,ROOT_COLLECTION,OTHER_COLLECTION} from './protocol-source.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const H=bytes=>createHash('sha256').update(bytes).digest('hex');
function argumentsOf(args){
  const result={};for(const value of args){const m=/^--([a-z-]+)=(.*)$/.exec(value);
    need(m&&!Object.hasOwn(result,m[1]),'ZOTERO_EXAMPLE_ARGUMENT_INVALID');result[m[1]]=m[2];}return result;
}
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'ZOTERO_EXAMPLE_ABSOLUTE_PATH_REQUIRED');return value;}
async function cli(args){
  return new Promise((yes,no)=>{
    const child=spawn(process.execPath,[join(ROOT,'cli.mjs'),...args],{stdio:['ignore','pipe','pipe'],env:process.env});
    const out=[],err=[];let size=0;
    child.stdout.on('data',b=>{size+=b.length;if(size>4*1024*1024)child.kill('SIGTERM');else out.push(b);});
    child.stderr.on('data',b=>{if(err.reduce((n,x)=>n+x.length,0)<32768)err.push(b);});
    child.once('error',no);child.once('close',(code,signal)=>{
      if(code!==0)return no(Object.assign(new Error('ZOTERO_EXAMPLE_CLI_FAILED'),{code:'ZOTERO_EXAMPLE_CLI_FAILED',
        details:{exitCode:code,signal,stderr:Buffer.concat(err).toString().slice(-3000)}}));
      const lines=Buffer.concat(out).toString('utf8').trim().split('\n');try{yes(JSON.parse(lines.at(-1)));}catch(error){no(error);}
    });
  });
}
export async function main(args=process.argv.slice(2)){
  const selected=argumentsOf(args),operation=absolute(selected.operation);
  const statePath=join(operation,'NATIVE-STATE.json'),resultPath=join(operation,'NATIVE-RESULT.json');
  await privateDirectory(operation);await privateDirectory(join(operation,'files'));await privateDirectory(join(operation,'screens'));
  const fd=await open(join(operation,'controller.sqlite'),FS.O_RDWR|FS.O_CREAT|FS.O_NOFOLLOW,0o600);await fd.close();
  await chmod(join(operation,'controller.sqlite'),0o600);
  const lock=new DatabaseSync(join(operation,'controller.sqlite'));
  let state,app,source,browser,context,page,stopping=false,failure=null,outcome=null,alreadyComplete=false;
  const clients=new Set();let sourceSummary=null;
  const halt=()=>{stopping=true;browser?.close().catch(()=>{});};
  process.once('SIGINT',halt);process.once('SIGTERM',halt);
  const check=()=>need(!stopping,'ZOTERO_EXAMPLE_CANCELLED');
  try{
    lock.exec('CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY);BEGIN EXCLUSIVE;');
    state=await readJson(statePath,LIMIT.transfer).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
    if(state?.status==='COMPLETE'){
      outcome=await readJson(resultPath,LIMIT.transfer);alreadyComplete=true;return outcome;
    }
    if(!state){state={schema:'commons.zotero-native-receiving.v1',runId:randomUUID(),operation,
      workspace:join(operation,'workspace'),research:join(operation,'research'),status:'RUNNING',startedAt:new Date().toISOString(),
      requests:{},phases:{},ui:{views:[]},sourceGenerations:[]};await writeJson(statePath,state);}
    need(state.operation===operation&&state.workspace===join(operation,'workspace'),'ZOTERO_EXAMPLE_OPERATION_CHANGED');
    const save=()=>writeJson(statePath,state);
    const codeFiles=['contracts.mjs','store.mjs','source.mjs','capture.mjs','workspace.mjs','transfer.mjs','server.mjs','client.mjs','cli.mjs',
      'examples/protocol-source.mjs','examples/NATIVE_RECEIVING.mjs','public/app.mjs','public/style.css'];
    const code={};for(const path of codeFiles){const bytes=await readFile(join(ROOT,path));code[path]={bytes:bytes.length,sha256:H(bytes)};}
    const codeSha=H(json(code));
    if(state.sourceGenerations.at(-1)?.sha256!==codeSha){state.sourceGenerations.push({sha256:codeSha,at:new Date().toISOString(),files:code});await save();}
    async function request(name){if(!state.requests[name]){state.requests[name]=randomUUID();await save();}return state.requests[name];}
    async function phase(name,work){
      check();if(state.phases[name]?.status==='COMPLETE')return state.phases[name].result;
      state.phases[name]={...state.phases[name],status:'RUNNING',startedAt:state.phases[name]?.startedAt??new Date().toISOString()};await save();
      const result=await work();check();
      state.phases[name]={...state.phases[name],status:'COMPLETE',completedAt:new Date().toISOString(),result};await save();
      process.stdout.write(JSON.stringify({operation:state.runId,phase:name,status:'COMPLETE'})+'\n');return result;
    }
    async function artifact(name,bytes){
      const path=join(operation,'files',name),body=Buffer.from(bytes);
      try{await writeBytes(path,body,{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;
        const old=await readBytes(path,LIMIT.transfer);need(H(old)===H(body),'ZOTERO_EXAMPLE_ARTIFACT_CHANGED');}
      return {path,bytes:body.length,sha256:H(body)};
    }
    async function until(read,predicate,timeout=30000){
      const end=Date.now()+timeout;
      for(;;){check();const value=await read();if(predicate(value))return value;need(Date.now()<end,'ZOTERO_EXAMPLE_EXPECTED_STATE_TIMEOUT');await pause(80);}
    }
    const sources=await loadProtocolSources();
    await phase('original-source',async()=>({original:sources.original,items:sources.items.length,collections:sources.collections.length,
      protocol:'Authored local HTTP v3 exercise, zero live Zotero reads',reference:sources.reference}));
    source=await startProtocolSource({sources,runId:state.runId,port:state.protocolPort??0});
    const currentPort=Number(new URL(source.endpoint).port);
    if(state.protocolPort)need(state.protocolPort===currentPort,'ZOTERO_EXAMPLE_SOURCE_PORT_CHANGED');
    else {state.protocolPort=currentPort;await save();}
    const dossierStore=await openDossierStore(state.research);
    const research=await phase('original-research-question',async()=>{
      const title='Zotero source review '+state.runId,found=(await dossierStore.list()).filter(d=>d.title===title);
      need(found.length<=1,'ZOTERO_EXAMPLE_DOSSIER_AMBIGUOUS');
      let record=found.length?await dossierStore.getMetadata(found[0].id):await dossierStore.create({title,
        description:'Local protocol exercise using the original Research source-bundle and complete portable history.',projection:'metadata'});
      const questionText='Which original Zotero item fields and collection memberships changed in this retained review? '+state.runId;
      let question=record.questions.find(q=>q.text===questionText);
      if(!question){record=await dossierStore.addQuestion(record.id,{text:questionText,expectedRevision:record.revision,projection:'metadata'});
        question=record.questions.find(q=>q.text===questionText);}
      return {id:record.id,questionId:question.id,revision:record.revision};
    });
    check();
    app=await startZoteroWorkspace({directory:state.workspace,dossierStore,fetchImpl:source.fetchImpl,environment:source.environment,transport:source.transport});
    const client=createZoteroClient(await loadZoteroConnection(app.connectionFile));clients.add(client);
    await client.verify();
    const retainedCaptures=(await client.state()).records.capture.rows;
    source.setVersion(Math.max(20,...retainedCaptures.flatMap(c=>[c.libraryVersion??20,c.observedVersion??20])));
    const profile=await phase('selected-library-profile',async()=>{
      const result=await client.invoke('profile.save',{id:'profile:'+state.runId,expectedRevision:0,definition:{
        title:'Original Zotero software fixture library',library:LIBRARY,apiKeyEnv:'ZOTERO_NATIVE_EXERCISE_KEY',
        sourceTerms:'Unchanged Zotero itemJSON.js software fixture under its accompanying AGPL notice. The envelopes, collection membership and review changes are authored local protocol exercise data; no scholarly or live-library claim.',
        scope:{collectionKeys:[],includeDescendants:true},includeTrashed:true}},await request('profile'));
      return {id:result.value.id,revision:result.value.revision};
    });
    async function prepareCapture(label){
      const r=await client.invoke('capture.prepare',{profileId:profile.id,profileRevision:profile.revision},await request(label));
      return r.value.id;
    }
    async function settleCapture(id,label){
      for(let n=0;n<40;n++){
        check();await app.workspace.waitCapture(id);
        let c=await client.invoke('capture.get',{id});
        if(['COMPLETE','SOURCE_CHANGED','ERROR','CANCELLED'].includes(c.status))return c;
        if(c.notBefore&&Date.parse(c.notBefore)>Date.now()){
          const delay=Date.parse(c.notBefore)-Date.now();need(delay<10000,'ZOTERO_EXAMPLE_RETRY_NOT_YET_ELIGIBLE');await pause(delay+30);
        }
        if(!c.active)await client.invoke('capture.control',{id,operation:'resume'},await request(label+':resume:'+c.attempt+':'+c.revision));
      }throw Object.assign(new Error('ZOTERO_EXAMPLE_CAPTURE_NOT_SETTLED'),{code:'ZOTERO_EXAMPLE_CAPTURE_NOT_SETTLED'});
    }
    const changed=await phase('changed-source-attempt',async()=>{
      source.mode({change:true});const id=await prepareCapture('changed-capture');
      const value=await settleCapture(id,'changed-capture');
      need(value.status==='SOURCE_CHANGED'&&value.documents.length>=2,'ZOTERO_EXAMPLE_CHANGED_SOURCE_NOT_RETAINED');
      return {id,attempt:value.attempt,status:value.status,documents:value.documents.length};
    });
    const captured=await phase('complete-consistent-restart',async()=>{
      source.mode({backoff:true});
      let c=await client.invoke('capture.get',{id:changed.id});
      if(c.status==='SOURCE_CHANGED')await client.invoke('capture.control',{id:changed.id,operation:'restart'},await request('changed-restart'));
      c=await settleCapture(changed.id,'complete-restart');
      need(c.status==='COMPLETE'&&c.attempt===2&&c.attempts[0].documents.length>=2&&c.counts.items===sources.items.length,
        'ZOTERO_EXAMPLE_COMPLETE_CAPTURE_MISSING');
      const e=await client.invoke('edition.get',{id:c.editionId});
      need(e.coverage.mode==='CAPTURED_PROTOCOL_EXERCISE'&&e.coverage.transport.mode==='local-protocol-exercise'&&
        e.counts.items===sources.items.length&&e.counts.collections===sources.collections.length,'ZOTERO_EXAMPLE_COVERAGE_CHANGED');
      return {id:c.id,editionId:e.id,items:e.counts.items,collections:e.counts.collections,documents:e.documents.length,
        attempts:c.attempts.length+1,coverage:e.coverage};
    });
    await phase('cancel-restart-original-command-replay',async()=>{
      source.mode({hold:true});
      const id=await prepareCapture('cancel-capture'),cancelId=await request('cancel-original');
      let c=await client.invoke('capture.get',{id});
      if(c.attempt===1&&!['CANCELLED','COMPLETE'].includes(c.status)){
        if(!c.active)await client.invoke('capture.control',{id,operation:'resume'},await request('cancel-resume:'+c.revision));
        await source.heldRequest();await client.invoke('capture.control',{id,operation:'cancel'},cancelId);await app.workspace.waitCapture(id);
      }
      c=await client.invoke('capture.get',{id});
      if(c.attempt===1){need(c.status==='CANCELLED','ZOTERO_EXAMPLE_CANCEL_NOT_RETAINED');
        await client.invoke('capture.control',{id,operation:'restart'},await request('cancel-restart'));}
      c=await client.invoke('capture.get',{id});
      if(c.status!=='COMPLETE'){
        if(!c.active)await client.invoke('capture.control',{id,operation:'resume'},await request('successor-resume:'+c.revision));
        await source.heldRequest();
        const before=await client.invoke('capture.get',{id});
        await client.invoke('capture.control',{id,operation:'cancel'},cancelId);
        const after=await client.invoke('capture.get',{id});
        need(after.attempt===2&&after.active&&!after.cancelRequested&&after.revision===before.revision,
          'ZOTERO_EXAMPLE_OLD_CANCEL_AFFECTED_SUCCESSOR');
        source.release();
      }
      c=await settleCapture(id,'cancel-finish');
      need(c.status==='COMPLETE'&&c.attempt===2,'ZOTERO_EXAMPLE_SUCCESSOR_CAPTURE_INCOMPLETE');
      return {id,attempt:c.attempt,status:c.status,originalCancelId:cancelId,successorUnaffected:true};
    });
    source.mode({});
    const intake=await phase('original-documents-cli-intake',async()=>{
      const bytes=makeDocumentSet({library:LIBRARY,sourceReference:sources.reference,documents:[
        {name:'collections-original.json',kind:'collections',bytes:sources.documents.collections},
        {name:'items-original.json',kind:'items',bytes:sources.documents.items}]});
      const file=await artifact('original-document-set.json',bytes);
      const result=await cli(['import','--connection',app.connectionFile,'--profile',profile.id,'--profile-revision',String(profile.revision),
        '--file',file.path,'--request-id',await request('import-original')]);
      need(result.value.coverage.mode==='RETAINED_DOCUMENT_SELECTION'&&result.value.coverage.complete===false,
        'ZOTERO_EXAMPLE_IMPORTED_COVERAGE_CHANGED');
      return {file,editionId:result.value.id};
    });
    await phase('revised-profile-retains-selected-scope',async()=>{
      const prior=await client.invoke('record.get',{kind:'profile',id:profile.id,revision:profile.revision});
      const r=await client.invoke('profile.save',{id:profile.id,expectedRevision:profile.revision,definition:{...prior,
        title:'Explicit receiving collection scope',scope:{collectionKeys:[OTHER_COLLECTION],includeDescendants:false}}},await request('profile-scope'));
      const imported=await client.importDocuments(await readBytes(intake.file.path,LIMIT.transfer),{
        profileId:r.value.id,profileRevision:r.value.revision,requestId:await request('import-same-source-new-scope')});
      const edition=await client.invoke('edition.get',{id:imported.value.id});
      need(edition.id!==intake.editionId&&edition.label===r.value.title&&edition.scope.collectionKeys[0]===OTHER_COLLECTION,
        'ZOTERO_EXAMPLE_PROFILE_SCOPE_LOST');
      const p=await client.invoke('project.save',{title:'Explicit scoped edition '+state.runId,editionId:edition.id},await request('scope-project'));
      need(p.value.scope.collectionKeys[0]===OTHER_COLLECTION,'ZOTERO_EXAMPLE_DEFAULT_PROJECT_SCOPE_LOST');
      return {profileRevision:r.value.revision,editionId:edition.id,projectId:p.value.id,scope:p.value.scope};
    });
    const review=await phase('changed-fields-collection-project',async()=>{
      const changedBytes=makeDocumentSet({library:LIBRARY,sourceReference:sources.reference+'; authored changed edition',documents:[
        {name:'collections-original.json',kind:'collections',bytes:sources.documents.collections},
        {name:'items-revised.json',kind:'items',bytes:sources.documents.revised}]});
      const file=await artifact('revised-document-set.json',changedBytes);
      const imported=await client.importDocuments(changedBytes,{profileId:profile.id,profileRevision:profile.revision,
        requestId:await request('import-revised')});
      const p=await client.invoke('project.save',{title:'Original full metadata review '+state.runId,description:'Retained source review.',
        editionId:imported.value.id,scope:{collectionKeys:[],includeDescendants:true},findings:[]},await request('review-project'));
      const edited=await client.invoke('project.save',{id:p.value.id,expectedRevision:p.value.revision,findings:[{
        id:'finding-native-'+state.runId,title:'Exact field and membership change',
        text:'The authored revised journal fixture retains its original key and full creator fields while its title and collection membership change.',
        itemKeys:[sources.journal]}],decisions:{[sources.journal]:{selected:true,classification:'background',
          note:'Reviewed against both exact original JSON documents.'}}},await request('review-decisions'));
      const comparison=await client.invoke('edition.compare',{before:intake.editionId,after:imported.value.id},await request('compare'));
      const full=await client.download({kind:'comparison',id:comparison.value.id}),parsed=parse(full.bytes);
      const changed=parsed.items.changed.find(r=>r.key===sources.journal);
      need(changed?.fields.some(f=>f.path==='/data/collections')&&changed.fields.some(f=>f.path==='/data/creators')&&
        parsed.items.removed.some(r=>r.key===sources.removed)&&parsed.items.added.some(r=>r.key==='NEWITEM1'),
        'ZOTERO_EXAMPLE_FULL_METADATA_COMPARISON_MISSING');
      return {file,editionId:imported.value.id,projectId:edited.value.id,projectRevision:edited.value.revision,
        comparisonId:comparison.value.id,comparison:await artifact('comparison.json',full.bytes),summary:comparison.value.summary};
    });
    const handoff=await phase('original-research-receive-and-request-identity',async()=>{
      const prepared=await client.invoke('research.prepare',{projectId:review.projectId,projectRevision:review.projectRevision,
        dossierId:research.id,questionId:research.questionId},await request('research-prepare'));
      const preview=prepared.value.preview;
      need(Number.isSafeInteger(preview.expectedRevision),'ZOTERO_EXAMPLE_PREPARED_RESEARCH_REVISION_MISSING');
      const op=await request('research-receive');
      const first=app.workspace.receiveHandoff({id:prepared.value.id,expectedDossierRevision:preview.expectedRevision},op);
      const changed=app.workspace.receiveHandoff({id:prepared.value.id,expectedDossierRevision:preview.expectedRevision+1},op);
      const results=await Promise.allSettled([first,changed]);
      need(results[0].status==='fulfilled'&&results[1].status==='rejected'&&results[1].reason.code==='ZOTERO_REQUEST_INPUT_CHANGED',
        'ZOTERO_EXAMPLE_HANDOFF_UUID_INPUT_NOT_BOUND');
      const receipt=results[0].value;
      need(receipt.status==='RECEIVED'&&receipt.result.sourceBundleSha256===prepared.value.object.sha256,
        'ZOTERO_EXAMPLE_RESEARCH_RECEIPT_MISSING');
      const replay=await client.invoke('research.receive',{id:prepared.value.id,expectedDossierRevision:preview.expectedRevision},op);
      need(replay.result.editionId===receipt.result.editionId,'ZOTERO_EXAMPLE_RESEARCH_REPLAY_CHANGED');
      return {id:prepared.value.id,receipt:receipt.result,source:await artifact('research-source-bundle.json',
        (await client.download({kind:'handoff',id:prepared.value.id})).bytes)};
    });
    const browserErrors=[];
    async function ensureBrowser(){
      if(browser)return;
      check();need(selected.playwright&&selected.chromium,'ZOTERO_EXAMPLE_BROWSER_SELECTION_REQUIRED');
      const loaded=await import(pathToFileURL(absolute(selected.playwright)).href),engine=loaded.chromium??loaded.default?.chromium;
      need(engine,'ZOTERO_EXAMPLE_PLAYWRIGHT_UNAVAILABLE');
      browser=await engine.launch({executablePath:absolute(selected.chromium),headless:true,args:[
        '--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
      check();context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      page=await context.newPage();page.on('pageerror',error=>browserErrors.push(String(error.message).replace(/#token=[a-f0-9]{64}/g,'#token=REDACTED')));
      await page.goto(app.url);await page.locator('#connection').filter({hasText:app.workspace.identity.workspaceId}).waitFor();
    }
    async function navigate(name){
      check();const control=page.locator('#navigation').getByRole('button',{name,exact:true});await control.click();
      await page.waitForFunction(label=>[...document.querySelectorAll('#navigation button')].some(b=>b.textContent===label&&!b.disabled),name);
    }
    await phase('operator-ui-review-original-files',async()=>{
      await ensureBrowser();await navigate('Projects');
      await page.getByLabel('Saved project',{exact:true}).selectOption(review.projectId);
      let current=await client.invoke('record.get',{kind:'project',id:review.projectId});
      const description='Original source reviewed in the complete operator UI '+state.runId;
      if(current.description!==description){
        await page.getByText('Edit project · revision '+current.revision,{exact:true}).waitFor();
        await page.getByLabel('Project description',{exact:true}).fill(description);
        await page.getByRole('button',{name:'Save project revision',exact:true}).click();
        current=await until(()=>client.invoke('record.get',{kind:'project',id:review.projectId}),p=>p.description===description);
      }
      const decisionNote='Original item '+sources.journal+' reviewed through the operator UI '+state.runId;
      if(current.decisions[sources.journal]?.note!==decisionNote){
        await page.getByLabel('Decision note for '+sources.journal,{exact:true}).fill(decisionNote);
        await page.getByLabel('Classification for '+sources.journal,{exact:true}).selectOption('background');
        await page.getByRole('button',{name:'Save visible decision changes',exact:true}).click();
        current=await until(()=>client.invoke('record.get',{kind:'project',id:review.projectId}),p=>p.decisions[sources.journal]?.note===decisionNote);
      }
      await navigate('Editions');
      await page.getByLabel('Edition for original document download',{exact:true}).selectOption(review.editionId);
      await page.getByLabel('Original document filename',{exact:true}).fill('items-revised.json');
      const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download original document',exact:true}).click();
      const download=await waiting,path=join(operation,'files','ui-items-revised.json');await download.saveAs(path);
      const bytes=await readFile(path);need(H(bytes)===H(sources.documents.revised),'ZOTERO_EXAMPLE_UI_SOURCE_BYTES_CHANGED');
      return {projectId:review.projectId,projectRevision:current.revision,description,decisionNote,
        originalDownload:{path,bytes:bytes.length,sha256:H(bytes)}};
    });
    await phase('operator-ui-research-delivery',async()=>{
      await ensureBrowser();await navigate('Research delivery');
      await page.getByLabel('Saved project',{exact:true}).selectOption(review.projectId);
      const current=await client.invoke('record.get',{kind:'project',id:review.projectId});
      const find=async()=>((await client.state()).records.handoff.rows).find(h=>h.projectId===review.projectId&&h.projectRevision===current.revision);
      let saved=await find();
      if(!saved){
        await page.getByLabel('Original Research dossier',{exact:true}).selectOption(research.id);
        await page.getByLabel('Original dossier question',{exact:true}).selectOption(research.questionId);
        await page.getByRole('button',{name:'Prepare Research source bundle',exact:true}).click();
        saved=await until(find,Boolean);
      }
      if(saved.status!=='RECEIVED'){
        await navigate('Research delivery');
        const row=page.locator('tr').filter({hasText:saved.object.sha256});
        await row.getByRole('button',{name:'Receive in original dossier',exact:true}).click();
        saved=await until(()=>client.invoke('record.get',{kind:'handoff',id:saved.id}),h=>h.status==='RECEIVED');
      }
      return {id:saved.id,projectRevision:current.revision,receipt:saved.result};
    });
    await phase('eight-desktop-eight-mobile-views',async()=>{
      await ensureBrowser();
      for(const [label,size]of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
        await page.setViewportSize(size);
        for(const name of ['Overview','Libraries','Capture and intake','Editions','Projects','Changes','Research delivery','Receiving']){
          const key=label+':'+name;if(state.ui.views.some(v=>v.key===key))continue;
          await navigate(name);await page.locator('#main h1').waitFor();
          const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
          need(!overflow,'ZOTERO_EXAMPLE_UI_HORIZONTAL_OVERFLOW',{view:name,width:size.width});
          const filename=label+'-'+name.toLowerCase().replaceAll(' ','-')+'.png',path=join(operation,'screens',filename);
          await page.screenshot({path,fullPage:false});
          state.ui.views.push({key,width:size.width,path,sha256:H(await readFile(path))});await save();
        }
      }
      need(browserErrors.length===0,'ZOTERO_EXAMPLE_BROWSER_ERRORS',{errors:browserErrors});
      return {views:state.ui.views,errors:browserErrors};
    });
    const firstPacket=await phase('complete-cli-export',async()=>{
      const op=await request('export-first'),path=join(operation,'files','receiver-generation-1.json');
      const result=await cli(['export','--connection',app.connectionFile,'--request-id',op,'--out',path]);
      const bytes=await readBytes(path,LIMIT.transfer),packet=parse(bytes);
      need(packet.research.length===1&&packet.research[0].id===research.id,'ZOTERO_EXAMPLE_RESEARCH_NOT_EXPORTED');
      const replay=await client.exportWorkspace(op);need(replay.sha256===result.sha256,'ZOTERO_EXAMPLE_EXPORT_REPLAY_CHANGED');
      return {...result,requestId:op,researchRevision:packet.research[0].revision};
    });
    const receiver=await phase('operator-ui-independent-receiving',async()=>{
      const name='second-operator',directory=join(state.workspace,'received',name);
      let marker=await readJson(join(directory,'receiving.json')).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
      if(marker?.status!=='COMPLETE'){
        await ensureBrowser();await navigate('Receiving');
        await page.getByLabel('Complete workspace packet',{exact:true}).setInputFiles(firstPacket.path);
        await page.getByLabel('Receiving workspace name',{exact:true}).fill(name);
        await page.getByRole('button',{name:'Receive full packet',exact:true}).click();
        marker=await until(()=>readJson(join(directory,'receiving.json')).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)),m=>m?.status==='COMPLETE');
      }
      need(marker.packetSha256===firstPacket.sha256,'ZOTERO_EXAMPLE_UI_RECEIVER_INPUT_CHANGED');
      const opened=await client.openReceiver(name),received=createZoteroClient(opened.connection);clients.add(received);
      await received.verify();const value=await received.state();
      need(value.workspaceId===app.workspace.identity.workspaceId&&value.research.some(r=>r.id===research.id),'ZOTERO_EXAMPLE_RECEIVED_IDENTITIES_CHANGED');
      const replay=await client.receiveWorkspace(await readBytes(firstPacket.path,LIMIT.transfer),{name,requestId:marker.requestId});
      need(replay.receipt.replayed&&replay.connection.instanceId===opened.connection.instanceId,'ZOTERO_EXAMPLE_ACTIVE_RECEIVER_REPLAY_CHANGED');
      return {name,directory,requestId:marker.requestId,workspaceId:value.workspaceId,researchId:research.id,researchRevision:firstPacket.researchRevision};
    });
    if(browser){await browser.close();browser=null;context=null;page=null;}
    const secondPacket=await phase('receiver-original-research-edit-and-reexport',async()=>{
      const opened=await client.openReceiver(receiver.name),child=createZoteroClient(opened.connection);clients.add(child);
      const original=await openDossierStore(join(receiver.directory,'research'));
      let record=await original.getMetadata(research.id);
      const description='Independent receiving operator reviewed the same original Research dossier '+state.runId;
      if(record.description!==description)record=await original.update(record.id,{description,expectedRevision:record.revision,projection:'metadata'});
      const file=await child.exportWorkspace(await request('export-second')),packet=parse(file.bytes);
      need(packet.research.length===1&&packet.research[0].revision===record.revision&&record.revision>firstPacket.researchRevision,
        'ZOTERO_EXAMPLE_SECOND_GENERATION_RESEARCH_LOST');
      const old=await client.exportWorkspace(firstPacket.requestId);need(old.sha256===firstPacket.sha256,'ZOTERO_EXAMPLE_ACCEPTED_EXPORT_CHANGED');
      return {...await artifact('receiver-generation-2.json',file.bytes),researchRevision:record.revision,description,
        originalResearchOrigins:packet.research[0].origins};
    });
    // Close every original host before the independent CLI receiving/reopen.
    for(const c of clients)c.close();clients.clear();
    await app.close();app=null;sourceSummary=source.summary();await source.close();source=null;
    const third=await phase('independent-cli-third-generation',async()=>{
      const directory=join(operation,'third-operator'),op=await request('receive-third');
      const receipt=await cli(['receive','--state',directory,'--file',secondPacket.path,'--request-id',op]);
      const original=await openDossierStore(join(directory,'research')),record=await original.getMetadata(research.id);
      need(record.revision===secondPacket.researchRevision&&record.description===secondPacket.description,
        'ZOTERO_EXAMPLE_THIRD_GENERATION_HISTORY_LOST');
      return {directory,requestId:op,receipt,researchId:record.id,researchRevision:record.revision};
    });
    await phase('cold-reopen-original-requests-and-files',async()=>{
      app=await startZoteroWorkspace({directory:third.directory});
      const child=createZoteroClient(await loadZoteroConnection(app.connectionFile));clients.add(child);await child.verify();
      const record=await child.invoke('record.get',{kind:'project',id:review.projectId});
      const original=await child.invoke('research.get',{id:research.id});
      need(record.decisions[sources.journal].note===state.phases['operator-ui-review-original-files'].result.decisionNote&&
        original.revision===third.researchRevision,'ZOTERO_EXAMPLE_COLD_REOPEN_CHANGED');
      const file=await child.download({kind:'edition',id:review.editionId,role:'document',name:'items-revised.json'});
      need(file.sha256===H(sources.documents.revised),'ZOTERO_EXAMPLE_COLD_SOURCE_CHANGED');
      const handoffState=await child.invoke('record.get',{kind:'handoff',id:handoff.id});
      const preview=await child.invoke('research.preview',{id:handoff.id});
      need(preview.expectedRevision===original.revision&&handoffState.result.editionId===handoff.receipt.editionId,
        'ZOTERO_EXAMPLE_RECEIVED_HANDOFF_BINDING_CHANGED');
      const further=await child.exportWorkspace(await request('export-third')),packet=parse(further.bytes);
      need(packet.research.length===1&&packet.research[0].revision===third.researchRevision,'ZOTERO_EXAMPLE_COLD_REEXPORT_LOST');
      return {workspaceId:app.workspace.identity.workspaceId,projectId:record.id,projectRevision:record.revision,
        originalResearchRevision:original.revision,sourceSha256:file.sha256,export:await artifact('receiver-generation-3.json',further.bytes)};
    });
    outcome={schema:'commons.zotero-native-receiving-result.v1',status:'PASS',runId:state.runId,operation,
      completedAt:new Date().toISOString(),node:process.version,sourceGenerations:state.sourceGenerations,
      source:sources.original,protocol:sourceSummary,phases:state.phases,views:state.ui.views,
      liveZoteroRequests:0,customerCalls:0,remoteWrites:0,payments:0};
  }catch(error){
    failure=error;
    if(state){state.status='CONTINUATION_REQUIRED';state.lastError={code:safeCode(error),details:error.details??{}};
      await writeJson(statePath,state).catch(()=>{});}
  }finally{
    const cleanup=[];
    for(const c of clients){try{c.close();}catch(error){cleanup.push(error);}}
    if(browser){try{await browser.close();}catch(error){cleanup.push(error);}}
    if(app){try{await app.close();}catch(error){cleanup.push(error);}}
    if(source){try{sourceSummary=source.summary();await source.close();}catch(error){cleanup.push(error);}}
    if(!failure&&cleanup.length)failure=new AggregateError(cleanup,'ZOTERO_EXAMPLE_CLEANUP_FAILED');
    if(state&&!alreadyComplete){state.closedAt=new Date().toISOString();state.ownedChildrenClosed=cleanup.length===0;
      if(!failure&&outcome){outcome.closedAt=state.closedAt;outcome.ownedChildrenClosed=true;state.status='COMPLETE';
        await writeJson(resultPath,outcome);await writeJson(statePath,state);}
      else {state.status='CONTINUATION_REQUIRED';state.lastError={code:safeCode(failure),details:failure?.details??{}};await writeJson(statePath,state).catch(()=>{});}}
    try{lock.exec('ROLLBACK');}catch{}lock.close();
    process.off('SIGINT',halt);process.off('SIGTERM',halt);
  }
  if(failure)throw failure;
  process.stdout.write(JSON.stringify({status:outcome.status,runId:outcome.runId,phases:Object.keys(outcome.phases).length,
    result:resultPath,ownedChildrenClosed:true,liveZoteroRequests:0,remoteWrites:0,payments:0})+'\n');
  return outcome;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  process.stderr.write(JSON.stringify({error:safeCode(error),details:error.details??{}})+'\n');process.exitCode=1;
});
