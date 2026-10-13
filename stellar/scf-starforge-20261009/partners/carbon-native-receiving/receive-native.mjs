#!/usr/bin/env node
// MIT. Native operator receiving over the complete original Merchant applications.
// It creates useful source/workspace/report outputs and preserves every receiving edit.
import {readFile,writeFile,mkdir,access,appendFile,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicJSON,writeArtifact,exists,nativeProcess,nativeResources,prepareNativeRecovery,recoverBrowserJourney} from './recovery.mjs';

const options={};
for(let i=2;i<process.argv.length;i++){
  const name=process.argv[i];
  if(name==='--keep-open'){options.keepOpen=true;continue;}
  if(!name.startsWith('--')||!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw new Error('Use named options with their complete values.');
  options[name.slice(2)]=process.argv[++i];
}
const sourceRoot=resolve(options['source-root']||fileURLToPath(new URL('../',import.meta.url)));
if(!options.output)throw new Error('Provide --output with a new private receiving directory.');
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Use the existing Node 22 or newer runtime.');
const output=resolve(options.output),appRoot=join(sourceRoot,'stellar/scf-starforge-20261009/partners');
const moduleAt=(kind,file)=>import(pathToFileURL(join(appRoot,kind,file)).href);
const {jsonIdentity,fileIdentity,writeJSONFile}=await moduleAt('cfce-givecredit-statements','native-json.mjs');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const actor=options.actor||'Native receiving operator';
const operation='SCF-CARBON-NATIVE-8D45-20261012';
const recovery=await prepareNativeRecovery({resumeFrom:options['resume-from'],output,sourceRoot,operation});
const result={...(recovery.recovered||{}),schema:'stellar-forge.carbon-native-receiving.v1',operation,startedAt:new Date().toISOString(),
  node:process.version,platform:process.platform,actor,sourceRoot,sourceIdentity:recovery.source.identity,output,status:'running',
  process:await nativeProcess(),artifacts:recovery.recovered?.artifacts||[],stages:recovery.recovered?.stages||[],
  workspaces:recovery.recovered?.workspaces||{},errors:recovery.recovered?.errors||[],...(recovery.resume?{resume:recovery.resume}:{})};
delete result.completedAt;delete result.delivery;
const services=[];
let browser=null,chromiumProcess=null,delivery=null;
const completed=name=>result.stages.findLast(row=>row.name===name&&row.status==='complete');
const requestsPath=join(output,'receiving-requests.json');
const requests=await exists(requestsPath)?await readJSON(requestsPath):{};
if(recovery.resume&&!result.artifacts.some(row=>row.path===recovery.resume.retainedReceipt))
  result.artifacts.push({path:recovery.resume.retainedReceipt,bytes:recovery.resume.originalReceiptBytes,sha256:recovery.resume.originalReceiptSha256});
async function requestFor(key,value){
  const intent=sha256(JSON.stringify(value));let row=requests[key];
  need(!row||row.intentSha256===intent,'Preserve the original intent for receiving request '+key+'.');
  if(!row){row=requests[key]={requestId:randomUUID(),intentSha256:intent,createdAt:new Date().toISOString()};await atomicJSON(requestsPath,requests);}
  return row.requestId;
}
async function observation(context){
  const row=await nativeResources({operation,...context});
  await appendFile(join(output,'native-resources.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});
  result.lastResources=row;return row;
}
async function save(path,value){
  need(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Keep artifact paths inside this receiving output.');
  const target=join(output,path),json=!Buffer.isBuffer(value)&&typeof value!=='string';
  const identity={path,...(json?jsonIdentity(value,{pretty:true,newline:true}):{bytes:Buffer.byteLength(value),sha256:sha256(value)})};
  const write=()=>json?writeJSONFile(target,value,{pretty:true,newline:true}):writeArtifact(target,value);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  const prior=result.artifacts.find(row=>row.path===path);
  if(prior)need(prior.bytes===identity.bytes&&prior.sha256===identity.sha256,'The retained artifact identity changed: '+path);
  if(recovery.resume&&await exists(target)){
    const original=await fileIdentity(target,Number.MAX_SAFE_INTEGER),same=original.bytes===identity.bytes&&original.sha256===identity.sha256;
    if(!same){
      need(!prior,'Preserve the original saved artifact: '+path);
      let preserved=join(output,'recovery/unrecorded',original.sha256,path);
      await mkdir(dirname(preserved),{recursive:true,mode:0o700});
      if(await exists(preserved))preserved+='.'+randomUUID();
      await rename(target,preserved);await write();
      result.resume.preservedUnrecorded||=[];result.resume.preservedUnrecorded.push({path,retained:preserved,...original});
    }
  }else await write();
  if(!prior)result.artifacts.push(identity);
  await checkpoint();return identity;
}
async function checkpoint(){await atomicJSON(join(output,'receiving.json'),result);}
async function stage(name,work,{reuse=true}={}){
  const prior=completed(name);
  if(recovery.resume&&reuse&&prior){
    prior.reusedAt=new Date().toISOString();prior.reusedFrom=recovery.resume.originalReceiptSha256;
    console.log(JSON.stringify({operation,stage:name,status:'reused',at:prior.reusedAt}));await checkpoint();return prior.value;
  }
  const row={name,status:'running',startedAt:new Date().toISOString()};result.stages.push(row);
  console.log(JSON.stringify({operation,stage:name,status:'running',at:row.startedAt}));
  await observation({stage:name,status:'running'});await checkpoint();
  try{const value=await work();Object.assign(row,{status:'complete',completedAt:new Date().toISOString(),value});
    await observation({stage:name,status:'complete'});await checkpoint();return value;}
  catch(error){Object.assign(row,{status:'interrupted',error:{code:error.code||null,message:error.message}});
    await observation({stage:name,status:'interrupted'});await checkpoint();throw error;}
}
async function retainedHandover(path,readCurrent){
  if(recovery.resume&&await exists(join(output,path)))return readJSON(join(output,path));
  const value=await readCurrent();await save(path,value);return value;
}
async function fetchOriginal(url){
  const response=await fetch(url),content=await response.text();
  need(response.ok,'Native route '+url+' returned HTTP '+response.status+': '+content.slice(0,300));
  return {content,type:response.headers.get('content-type'),status:response.status};
}
async function closeServices({strict=false}={}){const failures=[];for(const service of services.splice(0).reverse())try{await service.close();}catch(error){failures.push(error);result.errors.push({stage:'close',message:error.message});}if(strict&&failures.length)throw new AggregateError(failures,'Close the original native services before reopening their workspaces.');}
async function captureBrowser(browserRoot=output,artifactPrefix=''){
  const candidates=[options.chromium,process.env.CHROMIUM_BIN,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome'].filter(Boolean);
  let executable;
  for(const candidate of candidates)try{await access(candidate);executable=candidate;break;}catch{}
  need(executable,'Set --chromium to the existing native Chromium executable for the browser receiving stage.');
  const profile=join(browserRoot,'browser-profile');await mkdir(profile,{mode:0o700});
  const child=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,
    ...(process.getuid?.()===0?['--no-sandbox']:[]),'about:blank'],{stdio:['ignore','ignore','pipe']});
  chromiumProcess=child;
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000);});
  child.on('error',error=>{stderr+=error.message;});
  let port;
  for(let attempt=0;attempt<120;attempt++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}await delay(250);}
  need(port,'Chromium did not expose its local DevTools endpoint: '+stderr);
  const version=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  const socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});
  let seq=0;const pending=new Map(),events=[];
  socket.addEventListener('message',event=>{
    const value=JSON.parse(String(event.data));
    if(value.id){const item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}
    else if(value.method==='Runtime.exceptionThrown'||value.method==='Network.loadingFailed'||value.method==='Browser.downloadWillBegin'||value.method==='Browser.downloadProgress')events.push(value);
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  const target=await call('Target.createTarget',{url:'about:blank'}),attached=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const sessionId=attached.sessionId;
  await call('Runtime.enable',{},sessionId);await call('Network.enable',{},sessionId);await call('Page.enable',{},sessionId);
  const evaluate=async expression=>{
    const value=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(value.exceptionDetails)throw new Error(value.exceptionDetails.text+' '+(value.exceptionDetails.exception?.description||''));
    return value.result?.value;
  };
  const until=async expression=>{for(let i=0;i<120;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(error.message))throw error;}await delay(250);}throw new Error('Browser did not reach: '+expression);};
  return {version:version.Browser,events,
    command:(method,params={})=>call(method,params),sessionCommand:(method,params={})=>call(method,params,sessionId),
    async open(url,{mobile=false}={}){
      await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1000,deviceScaleFactor:1,mobile},sessionId);
      await call('Page.navigate',{url},sessionId);
      await until("location.href === "+JSON.stringify(url)+" && Boolean(document.querySelector('#main h1,#main h2')) && !document.querySelector('#main').innerText.includes('Opening workspace')");
    },
    evaluate,until,
    async image(name){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);
      const bytes=Buffer.from(shot.data,'base64'),path=artifactPrefix?artifactPrefix+'/'+name:name,target=join(output,path);
      await mkdir(dirname(target),{recursive:true,mode:0o700});await writeArtifact(target,bytes);
      result.artifacts.push({path,bytes:bytes.length,sha256:sha256(bytes)});await checkpoint();},
    async close(){try{await call('Browser.close');}catch{}socket.close();if(child.exitCode===null)child.kill('SIGTERM');await Promise.race([exited,delay(10000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}chromiumProcess=null;}
  };
}

try{
  await observation({stage:'Native continuation selection',status:'running'});await checkpoint();
  const [carbonStore,carbonServer,carbonClient,carbonEngine,giveStore,giveServer,giveClient,giveEngine,giveSource,giveLedger]=await Promise.all([
    moduleAt('stellarcarbon-statements','store.mjs'),moduleAt('stellarcarbon-statements','server.mjs'),
    moduleAt('stellarcarbon-statements','client.mjs'),moduleAt('stellarcarbon-statements','engine.mjs'),
    moduleAt('cfce-givecredit-statements','store.mjs'),moduleAt('cfce-givecredit-statements','server.mjs'),
    moduleAt('cfce-givecredit-statements','client.mjs'),moduleAt('cfce-givecredit-statements','engine.mjs'),
    moduleAt('cfce-givecredit-statements','source.mjs'),moduleAt('cfce-givecredit-statements','ledger.mjs')
  ]);
  const handover=await readJSON(options['carbon-handover']||join(sourceRoot,'receiving/stellarcarbon-current-handover.json'));
  const expected=await readJSON(join(sourceRoot,'receiving/expected-worked-manifest.json'));
  await stage('Receive both original carbon editions and saved statement versions',async()=>{
    const directory=join(output,'stellarcarbon');
    const workspace=await exists(join(directory,'workspace.json'))?await carbonStore.StellarcarbonWorkspace.open(directory):
      await carbonStore.StellarcarbonWorkspace.create(directory,{handover});
    const state=await workspace.snapshot();carbonStore.verifySources(state);
    need(state.editions.length===2,'Receive both original source editions.');
    result.workspaces.stellarcarbon={directory:workspace.directory,workspaceId:state.workspaceId};
    await workspace.close();
    return {editions:state.editions.map(source=>({id:source.id,sha256:source.sha256})),statementVersions:state.statements.map(row=>({id:row.id,versions:row.versions.length}))};
  });
  const savedAccounting=completed('Original maintained accounting case and linked draft preparation')?.value||
    (recovery.resume&&await exists(join(output,'accounting/case-result.json'))?await readJSON(join(output,'accounting/case-result.json')):null);
  const accountingDirectory=options['accounting-directory']?resolve(options['accounting-directory']):savedAccounting?.directory;
  const accountingWorkspaceId=options['expected-accounting-workspace-id']||savedAccounting?.binding?.workspaceId;
  const accountingSourcesSha256=options['expected-accounting-sources-sha256']||savedAccounting?.binding?.sourcesSha256;
  if(savedAccounting?.binding){
    need(!options['expected-accounting-workspace-id']||options['expected-accounting-workspace-id']===savedAccounting.binding.workspaceId,'Continue the same saved accounting workspace.');
    need(!options['expected-accounting-sources-sha256']||options['expected-accounting-sources-sha256']===savedAccounting.binding.sourcesSha256,'Continue the original accounting source binding.');
  }
  const carbon=await carbonServer.createStellarcarbonServer({directory:join(output,'stellarcarbon'),
    accountingDirectory,expectedAccountingWorkspaceId:accountingWorkspaceId,expectedAccountingSourcesSha256:accountingSourcesSha256});services.push(carbon);
  const carbonAPI=new carbonClient.StellarcarbonClient({baseUrl:new URL('/api',carbon.url).href});
  await carbonAPI.state();
  const carbonState=await carbon.workspace.snapshot();
  const current=carbonState.editions.find(row=>row.id==='source-mainnet-20261012'),prior=carbonState.editions.find(row=>row.id==='source-backup-20260414');
  need(current&&prior,'The current and original baseline source editions must remain available.');
  await stage('Original source pages, contribution details and edition comparison',async()=>{
    for(const edition of [prior,current]){
      const detail=await carbonAPI.edition(edition.id);
      for(const table of Object.keys(edition.tables)){
        let offset=0,count=0;
        do{const page=await carbonAPI.table(edition.id,table,{offset,limit:100});count+=page.items.length;offset=page.nextOffset;}while(offset!==null);
        need(count===edition.tables[table].length,'The native source page count changed: '+table);
      }
      const originals=[...(detail.files||[]).map(row=>({url:row.url,name:row.name})),
        ...(detail.responses||[]).map((row,i)=>({url:row.file,name:'response-'+i+'.json'}))];
      for(const row of originals){const file=await fetchOriginal(new URL(row.url,carbon.url));await save('original-sources/'+edition.id+'/'+row.name,file.content);}
    }
    const comparison=await carbonAPI.compare(prior.id,current.id);await save('stellarcarbon-edition-comparison.json',comparison);
    for(const table of ['distribution_txs','minted_blocks'])need(comparison.tables[table].comparisonStatus==='unavailable'&&comparison.tables[table].counts.removed===null,'Unacquired tables must remain unavailable: '+table);
    need(comparison.tables.sink_status.counts.added===2&&comparison.tables.sink_status.counts.changed===0,'The two original added allocation rows must be preserved.');
    need(comparison.tables.retirements.counts.changed===8,'Retain all eight reported instrument-metadata changes.');
    for(const hash of ['5d9f0355c3703c953e3a44cd0a666bc96f39b617ac1cfcef12300c37bc562384','7ebff3d29d20201a1d9f90ada73bb0db6f80736e91095030ad1dfd99fee95ec7'])
      await save('contribution-'+hash+'.json',await carbonAPI.contribution(hash,{editionId:current.id}));
    await save('retirement-153331.json',await carbonAPI.retirement('153331',{editionId:current.id}));
    return {currentContributions:current.tables.sinking_txs.length,currentCertificates:current.tables.retirements.length,currentAllocations:current.tables.sink_status.length};
  });
  await stage('Export the exact November and July customer statements',async()=>{
    for(const [period,id,version] of [['november','statement-november-2025',2],['july','statement-july-2026',1]]){
      const report=await carbonAPI.statement(id,version);
      const totals=expected.reports[period].totals;
      for(const key of ['carbon','allocated','remaining'])need(report.totals[key]===totals[key],'Source-derived '+period+' total changed: '+key);
      for(const file of expected.files.filter(row=>row.path.startsWith(period+'/'))){
        const name=file.path.split('/').at(-1),original=await fetchOriginal(carbonAPI.statementFileUrl(id,version,name));
        need(Buffer.byteLength(original.content)===file.bytes&&sha256(original.content)===file.sha256,'Worked export changed: '+file.path);
        await save('statements/'+file.path,original.content);
      }
    }
    return {november:{version:2,...expected.reports.november.totals},july:{version:1,...expected.reports.july.totals}};
  });
  need(!options['accounting-config']||accountingDirectory,'Use the selected original accounting directory with its case configuration.');
  const {prepareOriginalAccountingCase}=await import(pathToFileURL(join(sourceRoot,'receiving/accounting-case.mjs')).href);
  const accountingConfig=!savedAccounting&&options['accounting-config']?await readJSON(resolve(options['accounting-config'])):undefined;
  result.accounting=await stage('Original maintained accounting case and linked draft preparation',()=>savedAccounting||prepareOriginalAccountingCase({
    service:carbon,client:carbonAPI,sourceRoot,config:accountingConfig,save,actor,requestFor,
    readSaved:async path=>{
      const target=join(output,path);if(!await exists(target))return undefined;
      const value=await readFile(target,'utf8');return path.endsWith('.json')?JSON.parse(value):value;
    }}));
  if(savedAccounting?.binding&&accountingDirectory)result.accounting={...result.accounting,directory:accountingDirectory};
  const carbonHandover=await retainedHandover('stellarcarbon-complete-handover.json',async()=>JSON.parse((await fetchOriginal(carbonAPI.handoverUrl())).content));
  let receivedCarbon=result.workspaces.stellarcarbonReceived;
  await stage('Independent carbon receiving and the next operator edit',async()=>{
    const oldName=(await carbonAPI.state()).name;
    const directory=join(output,'stellarcarbon-received');
    if(await exists(join(directory,'workspace.json'))){
      const reopened=await carbonServer.createStellarcarbonServer({directory});services.push(reopened);
      receivedCarbon={directory,workspaceId:reopened.workspace.state.workspaceId,url:reopened.url};
    }else receivedCarbon=await carbonAPI.receive(directory,carbonHandover);
    const client=new carbonClient.StellarcarbonClient({baseUrl:new URL('/api',receivedCarbon.url).href});
    const state=await client.state(),name=carbonHandover.workspace.name+' · received by '+actor;
    if(state.name!==name)await client.apply('settings',{name},{revision:state.revision,
      requestId:await requestFor('independent-carbon-name',{workspaceId:state.workspaceId,name}),actor});
    need((await carbonAPI.state()).name===oldName,'Receiving edited the original workspace.');
    const report=await client.statement('statement-november-2025',2);
    need(report.totals.allocated==='1.177'&&report.totals.remaining==='0.000','The received statement changed.');
    await save('stellarcarbon-received-handover.json',JSON.parse((await fetchOriginal(client.handoverUrl())).content));
    result.workspaces.stellarcarbonReceived=receivedCarbon;return {directory:receivedCarbon.directory,url:receivedCarbon.url,editable:true};
  });

  receivedCarbon=result.workspaces.stellarcarbonReceived;
  const giveDirectory=join(output,'givecredit');
  const giveWorkspace=await exists(join(giveDirectory,'workspace.json'))?await giveStore.GiveCreditWorkspace.open(giveDirectory):
    await giveStore.GiveCreditWorkspace.create(giveDirectory,{name:'GiveCredit donor and initiative statements'});
  await giveWorkspace.close();
  const give=await giveServer.createGiveCreditServer({directory:join(output,'givecredit')});services.push(give);
  const giveAPI=new giveClient.GiveCreditClient(give.url,{actor});
  let giveState=await giveAPI.state();
  result.workspaces.givecredit=give.startup;
  const giveImport=async(source,label)=>{
    const digest=giveStore.sourceDigest(source),state=await give.workspace.readonlySnapshot(),existing=state.editions.find(row=>row.sha256===digest);
    if(existing)return {edition:{id:existing.id,label:existing.label},alreadyPresent:true};
    giveState=await giveAPI.state();return giveAPI.import({source,label},{revision:giveState.revision,
      requestId:await requestFor('source:'+digest,{sourceSha256:digest,label})});
  };
  const priorCarbon=await giveImport(giveSource.receiveCarbon(prior,{network:'mainnet'}),'Original Stellarcarbon backup · April 14, 2026');
  const currentCarbon=await giveImport(giveSource.receiveCarbon(current,{network:'mainnet'}),'Complete Stellarcarbon mainnet edition · October 12, 2026');
  let registry=null,ledger=null;
  const ledgerStage=await stage('Whole GiveCredit original source intake and ledger acquisition',async()=>{
    if(options['registry-source']){registry=await readJSON(resolve(options['registry-source']));await giveImport(registry,'Original authorized GiveCredit registry edition');}
    const priorLedgerFile=join(output,'givecredit-ledger-source.json');
    if(recovery.resume&&await exists(priorLedgerFile))ledger=await readJSON(priorLedgerFile);
    else if(options['ledger-source'])ledger=await readJSON(resolve(options['ledger-source']));
    else{
      const retainedOptions=join(output,'givecredit-capture-options.json');
      const input=options['capture-options']?await readJSON(resolve(options['capture-options'])):
        await exists(retainedOptions)?await readJSON(retainedOptions):{};
      if(!await exists(retainedOptions))await atomicJSON(retainedOptions,input);
      if(options['sdk-module'])input.sdk=await import(pathToFileURL(resolve(options['sdk-module'])).href);
      if(registry)input.registrySource=registry;
      const {CaptureCheckpointStore,readCaptureCheckpoint}=await moduleAt('cfce-givecredit-statements','checkpoint.mjs');
      const checkpointPath=join(output,'givecredit-ledger-capture-checkpoint.json');
      const checkpointStore=await CaptureCheckpointStore.open(join(output,'givecredit-ledger-checkpoints'),{legacyPath:checkpointPath,expectedKind:'ledger'});
      const checkpointSelection=options['capture-checkpoint']?resolve(options['capture-checkpoint']):
        recovery.resume&&await exists(checkpointStore.manifestPath)?checkpointStore.directory:
        recovery.resume&&await exists(checkpointPath)?checkpointPath:null;
      let checkpointIssue=null;
      if(checkpointSelection){
        try{input.checkpoint=await readCaptureCheckpoint(checkpointSelection);}
        catch(error){
          if(options['capture-checkpoint']||checkpointSelection===checkpointStore.directory||!input.originalLedgerSources?.length)throw error;
          const original=await readFile(checkpointSelection),name='recovery/incomplete-ledger-checkpoint-'+sha256(original)+'.json';
          await save(name,original);
          checkpointIssue={path:checkpointSelection,retained:name,bytes:original.length,sha256:sha256(original),message:error.message,
            continuation:'Reacquire the same selected source using its retained complete original ledger responses.'};
        }
      }
      result.capture={options:options['capture-options']?resolve(options['capture-options']):retainedOptions,checkpoint:checkpointSelection,checkpointIssue,status:'running'};
      await observation({stage:'GiveCredit source capture',phase:'before-capture',checkpoint:checkpointSelection});await checkpoint();
      input.checkpointMode='borrowed';
      input.onProgress=async progress=>{
        if(progress.checkpoint){result.capture.storage=await checkpointStore.save(progress.checkpoint,{phase:progress.phase});result.capture.checkpoint=checkpointStore.manifestPath;}
        const context={stage:'GiveCredit source capture',phase:progress.phase,rows:progress.rows||null,
          hash:progress.hash||null,account:progress.account||null,ledger:progress.ledger||null};
        await observation(context);await checkpoint();console.log(JSON.stringify({operation,...context,at:new Date().toISOString()}));
      };
      try{
        if(input.checkpoint?.metadata?.status==='complete'){
          giveSource.validateSourceEdition(input.checkpoint);await giveLedger.validateLedgerCheckpointSelection(input.checkpoint,input);ledger=input.checkpoint;
          result.capture.storage=await checkpointStore.save(ledger,{phase:'complete-reused'});result.capture.checkpoint=checkpointStore.manifestPath;
        }else ledger=await giveLedger.captureLedger(input);
      }catch(error){
        if(error.checkpoint){result.capture.storage=await checkpointStore.save(error.checkpoint,{phase:'interrupted'});result.capture.checkpoint=checkpointStore.manifestPath;}
        result.capture.status='interrupted';throw error;
      }finally{checkpointStore.releaseMemory();}
      result.capture.status='complete';await observation({stage:'GiveCredit source capture',phase:'complete'});await checkpoint();
    }
    const imported=await giveImport(ledger,'Complete native GiveCredit ledger edition');
    ledger=(await give.workspace.readonlySnapshot()).editions.find(row=>row.id===imported.edition.id);
    await save('givecredit-ledger-source.json',ledger);
    const comparison=await giveAPI.compare(priorCarbon.edition.id,currentCarbon.edition.id);await save('givecredit-carbon-edition-comparison.json',comparison);
    const pools=await giveAPI.pools({editionId:ledger.id});await save('givecredit-contract-pools.json',pools);
    const choices=await giveAPI.choices({ledgerEditionId:ledger.id,carbonEditionId:currentCarbon.edition.id});
    await save('givecredit-source-choices.json',choices);
    return {ledgerEditionId:ledger.id,counts:Object.fromEntries(Object.entries(ledger.tables).map(([key,rows])=>[key,rows.length])),
      originalDonorPayments:choices.donorPayments.length,sourcePayouts:choices.payouts.length,status:ledger.metadata.status};
  });
  ledger=ledger||(await give.workspace.readonlySnapshot()).editions.find(row=>row.id===ledgerStage.ledgerEditionId);
  need(ledger&&ledger.sha256===giveStore.sourceDigest(ledger),'Reopen the exact retained GiveCredit ledger edition.');
  let giveStatement;
  const statementStage=await stage('Create the native GiveCredit period statement and all nine exports',async()=>{
    const state=await give.workspace.readonlySnapshot(),payments=giveEngine.nativePayments(ledger);
    const dates=payments.map(row=>row.createdAt.slice(0,10)).sort();
    const fromDate=options.from||ledger.metadata.selection?.from?.slice(0,10)||dates[0]||ledger.metadata.startedAt.slice(0,10);
    const last=dates.at(-1)||ledger.metadata.completedAt.slice(0,10);
    const beforeDate=options.before||ledger.metadata.selection?.before?.slice(0,10)||new Date(Date.parse(last+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const registryEdition=state.editions.find(row=>row.kind==='registry');
    const spec={title:'GiveCredit native donor contributions',basis:'LEDGER_CLOSED',fromDate,beforeDate,
      ledgerEditionId:ledger.id,carbonEditionId:currentCarbon.edition.id,...(registryEdition?{registryEditionId:registryEdition.id}:{}),
      note:'Original native donor calls and source-observed contract pool activity in this retained ledger edition.'};
    const identical=state.statements.filter(row=>row.versions[0]&&Object.entries(spec).every(([key,value])=>JSON.stringify(row.versions[0].spec[key])===JSON.stringify(value)));
    need(identical.length<2,'Choose the original retained native statement when the saved workspace contains multiple exact matches.');
    if(identical.length)giveStatement={statementId:identical[0].id,statement:identical[0].versions[0]};
    else giveStatement=await giveAPI.apply('statement',spec,{revision:state.revision,
      requestId:await requestFor('native-period-statement',spec)});
    result.giveStatementId=giveStatement.statementId;await checkpoint();
    for(const name of ['statement.html','statement.json','donations.csv','payments.csv','receipt-records.csv','payout-funding.csv','carbon-contributions.csv','carbon-allocations.csv','retirement-register.csv']){
      const file=await fetchOriginal(giveAPI.statementFileURL(giveStatement.statementId,name,1));await save('givecredit-statements/'+name,file.content);
    }
    return {statementId:giveStatement.statementId,totals:giveStatement.statement.totals,basis:spec.basis,fromDate,beforeDate};
  });
  if(!giveStatement)giveStatement={statementId:statementStage.statementId,statement:await giveAPI.statement(statementStage.statementId,1)};
  const giveHandover=await retainedHandover('givecredit-complete-handover.json',async()=>JSON.parse((await fetchOriginal(giveAPI.handoverURL())).content));
  let receivedGive=result.workspaces.givecreditReceived;
  await stage('Independent GiveCredit receiving and the next operator edit',async()=>{
    const before=await giveAPI.state(),directory=join(output,'givecredit-received');
    if(await exists(join(directory,'workspace.json'))){
      const reopened=await giveServer.createGiveCreditServer({directory});services.push(reopened);receivedGive=reopened.startup;
    }else receivedGive=await giveAPI.receive(directory,giveHandover);
    const client=new giveClient.GiveCreditClient(receivedGive.url,{actor}),state=await client.state();
    need(state.workspaceId!==before.workspaceId,'The independently received GiveCredit workspace needs its own identity.');
    const name=giveHandover.workspace.name+' · received by '+actor;
    if(state.name!==name)await client.apply('settings',{name},{revision:state.revision,
      requestId:await requestFor('independent-givecredit-name',{workspaceId:state.workspaceId,name})});
    need((await giveAPI.state()).name===before.name,'Receiving edited the original GiveCredit workspace.');
    await client.statement(giveStatement.statementId,1);
    await save('givecredit-received-handover.json',JSON.parse((await fetchOriginal(client.handoverURL())).content));
    result.workspaces.givecreditReceived=receivedGive;return {directory:receivedGive.directory,workspaceId:receivedGive.workspaceId,url:receivedGive.url,editable:true};
  });
  receivedGive=result.workspaces.givecreditReceived;
  let browserJourney,browserPrefix=result.browserArtifactsPrefix||'';
  const browserStage=await stage('Operate the complete customer, source, statement and receiving workflows in Chromium',async()=>{
    let browserCarbon={url:carbon.url,client:carbonAPI},browserGive={url:give.url,client:giveAPI},browserRoot=output;
    const priorBrowserRoot=join(output,browserPrefix);
    if(recovery.resume&&(browserPrefix||await exists(join(priorBrowserRoot,'browser-profile'))||await exists(join(priorBrowserRoot,'browser-actions')))){
      // Preserve the partial browser-edited stores. A new complete browser attempt
      // starts from the actual pre-browser handovers; accounting is not replayed.
      await closeServices({strict:true});
      result.browserAttempts||=[];
      await mkdir(join(output,'browser-attempts'),{recursive:true,mode:0o700});
      let sequence=result.browserAttempts.length+1;
      while(true){
        browserPrefix='browser-attempts/'+String(sequence++).padStart(3,'0');
        browserRoot=join(output,browserPrefix);
        try{await mkdir(browserRoot,{mode:0o700});break;}
        catch(error){if(error.code!=='EEXIST')throw error;}
      }
      result.browserAttempts.push({prefix:browserPrefix,startedAt:new Date().toISOString(),preservedPreviousPrefix:result.browserArtifactsPrefix||'',
        carbonHandover:'stellarcarbon-complete-handover.json',giveCreditHandover:'givecredit-complete-handover.json',
        reason:'Continue the complete browser workflow from retained pre-browser handovers while preserving the interrupted attempt.'});
      result.browserArtifactsPrefix=browserPrefix;await checkpoint();
      const carbonCopy=await carbonStore.StellarcarbonWorkspace.create(join(browserRoot,'stellarcarbon'),{handover:carbonHandover});await carbonCopy.close();
      const giveCopy=await giveStore.GiveCreditWorkspace.create(join(browserRoot,'givecredit'),{handover:giveHandover});await giveCopy.close();
      const carbonService=await carbonServer.createStellarcarbonServer({directory:carbonCopy.directory});services.push(carbonService);
      const giveService=await giveServer.createGiveCreditServer({directory:giveCopy.directory});services.push(giveService);
      browserCarbon={url:carbonService.url,client:new carbonClient.StellarcarbonClient({baseUrl:new URL('/api',carbonService.url).href})};
      browserGive={url:giveService.url,client:new giveClient.GiveCreditClient(giveService.url,{actor})};
      await browserCarbon.client.state();await browserGive.client.state();
    }
    result.browserArtifactsPrefix=browserPrefix;await checkpoint();
    browser=await captureBrowser(browserRoot,browserPrefix);
    const {operateCarbonBrowsers}=await import(pathToFileURL(join(sourceRoot,'receiving/browser-actions.mjs')).href);
    browserJourney=await operateCarbonBrowsers({browser,
      carbon:{...browserCarbon,currentSource:current,priorSource:prior},
      give:{...browserGive,ledger,currentCarbonId:currentCarbon.edition.id,priorCarbonId:priorCarbon.edition.id,statementId:giveStatement.statementId},
      output:browserRoot,save:(path,value)=>save(browserPrefix?browserPrefix+'/'+path:path,value),actor});
    result.workspaces.stellarcarbonBrowserReceived=browserJourney.carbonReceived;
    result.workspaces.givecreditBrowserReceived=browserJourney.giveReceived;
    await save(browserPrefix?browserPrefix+'/browser-observations.json':'browser-observations.json',{version:browser.version,events:browser.events});
    need(!browser.events.some(row=>row.method==='Runtime.exceptionThrown'),'A browser script exception needs source repair.');
    return {browser:browser.version,artifactPrefix:browserPrefix,actions:browserJourney.actions,downloads:browserJourney.downloads,
      screenshots:browserJourney.screenshots,received:browserJourney.received,
      carbonStatementId:browserJourney.carbonStatementId,giveStatementId:browserJourney.giveStatementId};
  });
  if(!browserJourney)browserJourney=await recoverBrowserJourney(output,browserStage,result.workspaces,browserPrefix);
  await closeServices({strict:true});
  await stage('Close and reopen both independently received native workspaces',async()=>{
    const carbonReopened=await carbonStore.StellarcarbonWorkspace.open(receivedCarbon.directory);
    let giveReopened;
    try{
      giveReopened=await giveStore.GiveCreditWorkspace.open(receivedGive.directory);
      const carbonState=await carbonReopened.snapshot(),giveState=await giveReopened.readonlySnapshot();
      need(carbonEngine.statementVersion(carbonState,'statement-november-2025',2).totals.allocated==='1.177','The persisted carbon statement changed.');
      need(giveEngine.statementVersion(giveState,giveStatement.statementId,1).totals.paymentRecords===giveStatement.statement.totals.paymentRecords,'The persisted donor statement changed.');
      return {carbonRevision:carbonState.revision,giveCreditRevision:giveState.revision,carbonSources:carbonState.editions.length,giveCreditSources:giveState.editions.length};
    }finally{await carbonReopened.close();if(giveReopened)await giveReopened.close();}
  },{reuse:false});
  await stage('Reopen the browser-received workspaces and their next editable state',async()=>{
    const expectedCarbon=await readJSON(join(output,browserPrefix,'browser-actions/stellarcarbon/received-after-edit.json'));
    const expectedGive=await readJSON(join(output,browserPrefix,'browser-actions/givecredit/received-after-edit.json'));
    const reopenedCarbon=await carbonStore.StellarcarbonWorkspace.open(browserJourney.carbonReceived.directory);
    let reopenedGive;
    try{
      reopenedGive=await giveStore.GiveCreditWorkspace.open(browserJourney.giveReceived.directory);
      const carbonState=await reopenedCarbon.snapshot(),giveState=await reopenedGive.readonlySnapshot();
      const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
        value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
      need(canonical(carbonState)===canonical(expectedCarbon.workspace),'The persisted browser-received carbon workspace changed.');
      need(canonical(giveState)===canonical(expectedGive.workspace),'The persisted browser-received GiveCredit workspace changed.');
      for(const source of [prior,current])need(carbonState.editions.some(row=>row.id===source.id&&row.sha256===source.sha256),'An original carbon edition was lost on browser receiving.');
      need(giveState.editions.some(row=>row.id===ledger.id&&row.sha256===ledger.sha256),'The original ledger edition changed on browser receiving.');
      for(const version of [1,2]){
        carbonEngine.statementVersion(carbonState,browserJourney.carbonStatementId,version);
        giveEngine.statementVersion(giveState,giveStatement.statementId,version);
      }
      need(carbonEngine.statementVersion(carbonState,'statement-november-2025',2).totals.remaining==='0.000','The original current November statement changed.');
      await save((browserPrefix?browserPrefix+'/':'')+'browser-actions/reopened-workspaces.json',{stellarcarbon:carbonState,givecredit:giveState});
      return {stellarcarbon:{directory:reopenedCarbon.directory,workspaceId:carbonState.workspaceId,revision:carbonState.revision,
        customerId:browserJourney.carbonCustomerId,customerVersion:carbonState.customers.find(row=>row.id===browserJourney.carbonCustomerId).version,
        statementId:browserJourney.carbonStatementId,versions:2,sources:carbonState.editions.length},
        givecredit:{directory:reopenedGive.directory,workspaceId:giveState.workspaceId,name:giveState.name,revision:giveState.revision,
        statementId:giveStatement.statementId,versions:2,sources:giveState.editions.length}};
    }finally{await reopenedCarbon.close();if(reopenedGive)await reopenedGive.close();}
  },{reuse:false});
  if(result.accounting?.binding&&result.accounting.invoiceId)await stage('Reopen the original linked accounting draft and retained schedules',async()=>{
    const {prepareReceivablesServer}=await import(pathToFileURL(join(sourceRoot,'stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/server.mjs')).href);
    const reopened=await prepareReceivablesServer({directory:result.accounting.directory,port:0,expectedWorkspaceId:result.accounting.binding.workspaceId,expectedSourcesSha256:result.accounting.binding.sourcesSha256});
    try{const invoice=await reopened.receivables.detail(result.accounting.invoiceId);
      need(invoice.invoice.status===result.accounting.invoiceStatus,'The original linked invoice changed during receiving.');
      if(result.accounting.previewSha256)need((await reopened.receivables.preview(result.accounting.invoiceId)).previewSha256===result.accounting.previewSha256,'The persisted invoice draft changed.');
      const plans=[];for(const row of result.accounting.existingPlans||[])plans.push(await reopened.paymentPlans.detail(row.id));
      if(result.accounting.planDraft)plans.push(await reopened.paymentPlans.detail(result.accounting.planDraft.id));
      await save('accounting/reopened-original-case.json',{invoice,plans});return {invoiceId:invoice.invoice.id,status:invoice.invoice.status,plans:plans.length};
    }finally{await reopened.close();}
  },{reuse:false});
  if(browser){await browser.close();browser=null;}
  const archivePath=resolve(options['archive-path']||output+'.tar.gz');
  result.status='complete';result.completedAt=new Date().toISOString();result.accountingCaseStatus=result.accounting?.status||'native-source-selection';
  result.delivery={archive:archivePath,descriptor:archivePath+'.json',state:'Closed native workspaces and complete original source'};
  await checkpoint();
  console.log(JSON.stringify({operation,stage:'Preserve the whole closed native receiving archive',status:'running',archive:archivePath}));
  const {finalizeNativeReceiving}=await import(pathToFileURL(join(sourceRoot,'receiving/finalize-native.mjs')).href);
  delivery=await finalizeNativeReceiving({outputDirectory:output,sourceRoot,archivePath,operation,createdAt:result.completedAt});
  const delivered={archive:delivery.archive,archiveBytes:delivery.bytes,archiveSha256:delivery.sha256,descriptor:delivery.receiptPath,members:delivery.memberCount};
  if(options.keepOpen){
    const first=await carbonServer.createStellarcarbonServer({directory:browserJourney.carbonReceived.directory});services.push(first);
    const second=await giveServer.createGiveCreditServer({directory:browserJourney.giveReceived.directory});services.push(second);
    const reopenedURLs={stellarcarbon:first.url,givecredit:second.url};
    await writeFile(output+'.live-reopened.json',JSON.stringify({operation,status:'open',...reopenedURLs,...delivered},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({operation,status:'complete',receivingFile:join(output,'receiving.json'),...reopenedURLs,...delivered}));
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }else console.log(JSON.stringify({operation,status:'complete',receivingFile:join(output,'receiving.json'),artifacts:result.artifacts.length,...delivered}));
}catch(error){
  const failure={code:error.code||null,message:error.message,stack:error.stack,archiveCheckpoint:error.archiveCheckpoint||null};
  if(delivery){
    await writeFile(output+'.post-archive-error.json',JSON.stringify({operation,archive:delivery.archive,sha256:delivery.sha256,error:failure},null,2)+'\n',{flag:'wx',mode:0o600});
    console.error(JSON.stringify({operation,status:'archive-complete-live-reopen-interrupted',archive:delivery.archive,error:error.message}));
  }else{
    result.status='interrupted';result.errors.push(failure);await checkpoint();
    console.error(JSON.stringify({operation,status:result.status,receivingFile:join(output,'receiving.json'),error:error.message,archiveCheckpoint:error.archiveCheckpoint||null}));
  }
  process.exitCode=1;
}finally{if(browser)await browser.close();if(chromiumProcess&&chromiumProcess.exitCode===null)chromiumProcess.kill('SIGTERM');await closeServices();}
