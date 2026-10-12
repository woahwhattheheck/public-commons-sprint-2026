// Continue the original managed Support receiving operation through native SF47.
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {operateGrantCompletion,verifyReceivedGrantCompletion,verifyGrantCompletionAgent} from './grant-completion-native.mjs';
const execute=promisify(execFile);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function receiveGrantSupport({selected,context,handoffPath,merchantCaseId,incidentId,note}) {
  const source=join(selected.sourceRoot,'stellar/scf_2026/sf47_budget_model');
  const launcher=join(source,'workspace/launcher.mjs'),scenario=join(source,'sf10_current_candidate.json');
  const root=join(selected.work,'grant-support-'+randomUUID());
  const stage=join(selected.stage,'grant-support');
  await fs.mkdir(root,{mode:0o700});await fs.mkdir(stage,{recursive:true,mode:0o700});
  let report={schema:'stellar-forge.sf47-support-receiving-operation.v1',sourcePin:selected.sourceCommit,
    merchantCaseId,incidentId,startedAt:new Date().toISOString(),status:'RUNNING',stages:[],browserErrors:[]};
  const resultPath=join(stage,'result.json');
  const save=async()=>{const temporary=resultPath+'.saving-'+randomUUID();
    await fs.writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await fs.rename(temporary,resultPath);};
  const mark=async(stageName,detail={})=>{report.stages.push({stage:stageName,at:new Date().toISOString(),...detail});await save();await note('grant support: '+stageName,detail);};
  const raw=await fs.readFile(handoffPath),file={filename:'managed-merchant-support.json',contentBase64:raw.toString('base64')};
  report.handoff={path:handoffPath,bytes:raw.length,sha256:sha(raw)};
  let retained;
  try{retained=JSON.parse(await fs.readFile(resultPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(retained?.supportPrepared){
    assert.equal(retained.schema,report.schema);assert.equal(retained.merchantCaseId,merchantCaseId);assert.equal(retained.incidentId,incidentId);
    assert.equal(retained.handoff.sha256,report.handoff.sha256);assert.equal(retained.handoff.bytes,raw.length);
    report={...retained,status:'RUNNING',resumedAt:new Date().toISOString(),currentSourcePin:selected.sourceCommit};
    if(retained.currentSourcePin!==selected.sourceCommit&&retained.sourcePin!==selected.sourceCommit){
      report.sourceRevisions=[...(retained.sourceRevisions||[]),{sourcePin:selected.sourceCommit,at:report.resumedAt}];
    }
  }
  const cli=async(workspace,args)=>{const result=await execute(process.execPath,[launcher,'operations','--workspace',workspace,'--scenario',scenario,...args],
    {env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:24*1024*1024,timeout:30000});return JSON.parse(result.stdout);};
  const workspace=join(stage,'original-workspace'),receivedWorkspace=join(stage,'reopened-workspace');
  report.workspace=workspace;report.reopenedWorkspace=receivedWorkspace;
  let server,page;
  async function start(workspace){
    const announced=defer();
    const child=spawn(process.execPath,[launcher,'serve','--workspace',workspace,'--scenario',scenario,'--port','0'],
      {env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',closed=false,exitCode=null;
    const completed=new Promise(resolve=>child.once('close',code=>{closed=true;exitCode=code;resolve(code);announced.reject(Error('Native grant listener exited before startup: '+stderr));}));
    child.once('error',error=>announced.reject(error));
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-16000);});
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString();let end;
      while((end=stdout.indexOf('\n'))>=0){
        const line=stdout.slice(0,end);stdout=stdout.slice(end+1);
        try{const value=JSON.parse(line);if(value.url&&value.access_file)announced.resolve(value);}catch{}
      }
    });
    const timer=setTimeout(()=>announced.reject(Error('The original grant listener did not announce startup.')),20000);
    let announcement;
    try{announcement=await announced.promise;}catch(error){child.kill('SIGTERM');await Promise.race([completed,pause(5000)]);throw error;}finally{clearTimeout(timer);}
    const access=await fs.readFile(announcement.access_file,'utf8');
    const matched=access.match(/href="([^"]+)"/);assert.ok(matched,'original access link');
    const url=new URL(matched[1].replaceAll('&amp;','&'));assert.equal(url.hostname,'127.0.0.1');
    const token=new URLSearchParams(url.hash.slice(1)).get('access');assert.ok(token);
    const api=async(path,body,options={})=>{
      const response=await fetch(new URL(path,url.origin),{method:body===undefined?'GET':'POST',
        headers:{authorization:'Bearer '+token,...(body===undefined?{}:{Origin:url.origin,'content-type':options.raw?'application/zip':'application/json'}),...options.headers},
        ...(body===undefined?{}:{body:options.raw?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
      if(options.bytes&&response.ok)return Buffer.from(await response.arrayBuffer());
      const result=await response.json();
      if(!response.ok)throw Object.assign(Error(result.error?.message||JSON.stringify(result)),{status:response.status,code:result.error?.code});
      return result;
    };
    return {workspace,url:url.href,api,child,completed,get closed(){return closed;},get exitCode(){return exitCode;},
      async stop(){if(!closed)child.kill('SIGTERM');await Promise.race([completed,pause(15000)]);
        if(!closed){child.kill('SIGKILL');await completed;}assert.equal(exitCode,0,stderr);}};
  }
  async function open(current,caseId){
    page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message));
    await page.goto(current.url);await page.locator('[data-tab="operations"]').click();
    await page.locator('[name="caseSelect"]').selectOption(caseId);
    await page.locator('[data-ops-tab="support"]').click();
    await page.locator('[data-support-file]').waitFor();
    return page;
  }
  async function finishReceiving(checkpoint){
    const {caseId,generic,accepted,receivedSource,history}=checkpoint;
    report.completion=await operateGrantCompletion({selected,context,server,caseId,stage,note,page});
    let current=await server.api('/api/operations/'+caseId);
    const archivePath=join(stage,'received-operations.zip');
    let archive;
    if(report.archive){
      assert.equal(report.archive.path,archivePath);assert.equal(report.archive.caseId,caseId);
      assert.equal(report.archive.version,current.program.version,'same frozen export version');
      archive=await fs.readFile(archivePath);assert.equal(archive.length,report.archive.bytes);assert.equal(sha(archive),report.archive.sha256);
    }else{
      report.archivePreparation??={caseId,version:current.program.version};
      assert.equal(report.archivePreparation.caseId,caseId);assert.equal(report.archivePreparation.version,current.program.version);
      await save();
      try{archive=await fs.readFile(archivePath);}catch(error){
        if(error.code!=='ENOENT')throw error;
        archive=await server.api('/api/operations/'+caseId+'/export.zip',undefined,{bytes:true});
        const temporary=archivePath+'.saving-'+randomUUID();await fs.writeFile(temporary,archive,{mode:0o600});
        try{await fs.link(temporary,archivePath);}finally{await fs.unlink(temporary);}
      }
      report.archive={path:archivePath,bytes:archive.length,sha256:sha(archive),caseId,version:current.program.version};await save();
    }
    await mark('concurrent case change retained the draft and re-previewed the current revision',{caseId,version:current.program.version,eventCount:history.events.length});
    await page.close();page=null;await server.stop();server=null;
    const cliPreviewPath=join(root,'cli-preview.json');
    await cli(workspace,['support-preview','--case',caseId,'--expected-version',String(current.program.version),'--file',handoffPath,'--output',cliPreviewPath]);
    const cliPreview=JSON.parse(await fs.readFile(cliPreviewPath,'utf8'));
    const cliReceipt=await cli(workspace,['support-receive','--case',caseId,'--expected-version',String(current.program.version),
      '--file',handoffPath,'--expected-preview-sha256',cliPreview.previewSha256,'--deployment',accepted.recordId,
      '--actor','Native CLI receiving operator','--request-id','support-native-cli-receive','--note','Reopen the already received original source.']);
    assert.equal(cliReceipt.unchanged,true);assert.equal(cliReceipt.version,current.program.version);
    const imported=await cli(receivedWorkspace,['import','--file',archivePath,'--name','Received support case reopened',
      '--actor','Native receiving operator','--request-id','support-native-import']);
    server=await start(receivedWorkspace);const received=await server.api('/api/operations/'+imported.id);
    const original=received.sources.find(row=>row.id===generic.recordId);
    assert.deepEqual(original.supportHandoff,receivedSource.supportHandoff);
    assert.deepEqual((await server.api('/api/operations/'+imported.id+'/sources/'+generic.recordId,undefined,{bytes:true})),raw);
    await open(server,imported.id);
    await page.getByRole('button',{name:'Open review',exact:true}).click();await page.locator('[data-support-review-json]').waitFor({state:'attached'});
    assert.equal(await page.locator('.support-review code').first().textContent(),sha(raw));
    assert.deepEqual(report.browserErrors,[]);
    await page.screenshot({path:join(stage,'merchant-support-received.png')});
    report.completionReceiving=await verifyReceivedGrantCompletion({server,caseId:imported.id,page,stage,completion:report.completion});
    await page.close();page=null;await server.stop();server=null;
    report.cliReceipt=cliReceipt;report.imported=imported;report.retainedDirectory=stage;
    report.agentCompletion=await verifyGrantCompletionAgent({selected,grant:report,stage,note});
    await mark('original CLI and case import reopened the same support source and rendered report',{originalCaseId:caseId,reopenedCaseId:imported.id,sourceCount:received.sources.length});
    report.status='COMPLETE';report.completedAt=new Date().toISOString();await save();
    return report;
  }
  try{
    server=await start(workspace);
    if(report.supportPrepared){
      const checkpoint=report.supportPrepared,current=await server.api('/api/operations/'+checkpoint.caseId);
      assert.equal(current.program.mode,'WALKTHROUGH');assert.equal(current.plan.contentSha256,checkpoint.planSha256);
      assert.ok(current.program.version>=checkpoint.sourceVersion);
      await open(server,checkpoint.caseId);
      return await finishReceiving(checkpoint);
    }
    const plans=(await server.api('/api/plans')).plans;assert.ok(plans.length);
    const plan=await server.api('/api/plans/'+plans[0].id);
    const opened=await server.api('/api/operations',{name:'Managed support native receiving',mode:'WALKTHROUGH',
      planId:plan.id,selectedRevision:plan.revision,expectedContentSha256:plan.contentSha256,calendarStart:'2027-12-01',
      actor:'Native support receiving operator',requestId:randomUUID()});
    const caseId=opened.id,command='/api/operations/'+caseId+'/command',preview='/api/operations/'+caseId+'/support-preview';
    report.caseId=caseId;
    const generic=await server.api(command,{expectedVersion:opened.version,requestId:randomUUID(),
      actor:'Native support receiving operator',note:'Retain the original managed support source before receiving its deployment.',
      action:'source.add',data:{filename:'original-source.bin',mediaType:'application/octet-stream',kind:'other',
        sourceUrl:'',observedAt:new Date().toISOString(),contentBase64:file.contentBase64}});
    const firstPreview=await server.api(preview,{expectedVersion:generic.version,...file});
    const repeatedPreview=await server.api(preview,{expectedVersion:generic.version,...file});
    assert.equal(firstPreview.previewSha256,repeatedPreview.previewSha256);
    assert.ok(firstPreview.retainedSourceIds.includes(generic.recordId));
    report.previewSha256=firstPreview.previewSha256;
    await mark('original runtime review is repeatable and finds the retained generic source',{caseId,version:generic.version,sourceId:generic.recordId});
    await open(server,caseId);
    await page.locator('[name="recordingActor"]').fill('Native support receiving operator');
    await page.locator('[data-support-file]').setInputFiles({name:file.filename,mimeType:'application/json',buffer:raw});
    await page.locator('[data-support-form]').waitFor();
    await page.locator('[name="deploymentId"]').selectOption('__new__');
    await page.locator('[data-support-form] [name="name"]').fill('Original managed merchant runtime');
    await page.locator('[data-support-form] [name="operator"]').fill('Native support receiving operator');
    await page.locator('[data-support-form] [name="state"]').selectOption('INSTALLED');
    await page.locator('[data-support-form] [name="releaseRef"]').fill(selected.sourceCommit);
    await page.locator('[data-support-form] [name="caseRef"]').fill(merchantCaseId);
    await page.locator('[data-support-form] [name="note"]').fill('Retain the actual managed incident and recovery capture.');
    const reached=defer(),release=defer();let dropped=false,accepted,firstBody,replayBody;
    await page.route('**/api/operations/'+caseId+'/command',async route=>{
      const body=route.request().postDataJSON();
      if(body.action==='support.receive'&&!dropped){
        dropped=true;firstBody=body;
        try{const response=await route.fetch();assert.equal(response.status(),200);accepted=await response.json();reached.resolve();
          await release.promise;await route.abort('failed');}catch(error){reached.reject(error);throw error;}
      }else{if(body.action==='support.receive'&&!replayBody)replayBody=body;await route.continue();}
    });
    await page.getByRole('button',{name:'Receive support into this case',exact:true}).click();
    await reached.promise;
    await page.locator('[data-ops-tab="delivery"]').click();
    release.resolve();
    await page.locator('[data-ops-tab="support"]').click();
    await page.getByRole('button',{name:'Retry same save',exact:true}).click();
    await page.getByRole('button',{name:'Open review',exact:true}).waitFor();
    assert.deepEqual(replayBody,firstBody);
    let current=await server.api('/api/operations/'+caseId);
    assert.equal(current.program.version,accepted.version);
    assert.equal(current.sources.length,2);assert.equal(current.records.deployments.length,1);
    const receivedSource=current.sources.find(row=>row.id===generic.recordId);
    assert.equal(receivedSource.filename,'original-source.bin');assert.equal(receivedSource.kind,'other');
    assert.equal(receivedSource.supportHandoff.sourceSha256,sha(raw));
    assert.equal(receivedSource.supportHandoff.reports.length,1);
    const download=await server.api('/api/operations/'+caseId+'/sources/'+generic.recordId,undefined,{bytes:true});
    assert.deepEqual(download,raw);
    report.accepted=accepted;report.replayedRequestSha256=sha(JSON.stringify(firstBody));
    await mark('actual save response loss survived tab navigation and recovered the same receipt',{caseId,version:current.program.version,sourceCount:current.sources.length});
    await page.unroute('**/api/operations/'+caseId+'/command');
    await page.locator('[data-support-file]').setInputFiles({name:file.filename,mimeType:'application/json',buffer:raw});
    await page.locator('[data-support-form]').waitFor();
    await page.locator('[name="deploymentId"]').selectOption(accepted.recordId);
    await page.locator('[data-support-form] [name="note"]').fill('Retained draft after concurrent case review.');
    const reviewReceipt=await server.api(command,{expectedVersion:current.program.version,requestId:randomUUID(),
      actor:'Concurrent native reviewer',note:'Review the original received source and deployment before follow-up.',action:'review',data:{}});
    const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/command')&&response.status()===409);
    const refreshed=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/support-preview')&&response.status()===200);
    await page.getByRole('button',{name:'Receive support into this case',exact:true}).click();
    await rejected;const refreshedPreview=await (await refreshed).json();
    assert.equal(refreshedPreview.version,reviewReceipt.version);
    await page.locator('[data-support-form]').waitFor();
    assert.equal(await page.locator('[data-support-form] [name="note"]').inputValue(),'Retained draft after concurrent case review.');
    assert.equal(await page.locator('[name="deploymentId"]').inputValue(),accepted.recordId);
    const unchangedResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/command')&&response.status()===200);
    await page.getByRole('button',{name:'Receive support into this case',exact:true}).click();
    const unchanged=await (await unchangedResponse).json();assert.equal(unchanged.unchanged,true);assert.equal(unchanged.version,reviewReceipt.version);
    current=await server.api('/api/operations/'+caseId);assert.equal(current.sources.length,2);
    const history=await server.api('/api/operations/'+caseId+'/history');
    const supportEvent=history.events.find(event=>event.action==='support.receive');
    assert.equal(supportEvent.sourceChange.before.filename,'original-source.bin');
    assert.equal(supportEvent.sourceChange.after.supportHandoff.sourceSha256,sha(raw));
    report.supportPrepared={schema:'stellar-forge.sf47-support-receiving-checkpoint.v1',caseId,generic,accepted,receivedSource,history,
      sourceVersion:current.program.version,planSha256:current.plan.contentSha256,completedAt:new Date().toISOString()};
    await save();
    return await finishReceiving(report.supportPrepared);
  }catch(error){report.status='FAILED';report.error=String(error.stack||error);await save();throw error;}
  finally{await page?.close().catch(()=>{});if(server)await server.stop().catch(async error=>{report.cleanupError=error.message;await save();});}
}
