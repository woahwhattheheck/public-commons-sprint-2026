#!/usr/bin/env node
// MIT. Manual full Runtime procedure receiving course; never a default test/CI task.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, link, unlink, realpath, lstat } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const OPERATION = 'SCF-RUNTIME-OPERATING-PROCEDURES-RD12-20261013';
const SCHEMA = 'commons.runtime-operating-procedures.receiving.v1';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => assert.deepEqual(a,b);
const stamp = () => new Date().toISOString();
async function optional(path) { try { return JSON.parse(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT')return null; throw e; } }
async function syncDirectory(path) { const h=await open(path,'r'); try { await h.sync(); } finally { await h.close(); } }
async function privateDirectory(path) {
  try { await mkdir(path,{mode:0o700}); await syncDirectory(dirname(path)); }
  catch(e) { if(e.code!=='EEXIST')throw e; }
  const s=await lstat(path);
  assert(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o077),'Use a private real operating-case directory.');
  assert.equal(await realpath(path),path);
  if(process.getuid)assert.equal(s.uid,process.getuid());
  return path;
}
async function publish(path,content,replace=false) {
  const raw=Buffer.isBuffer(content)?content:Buffer.from(content), temporary=path+'.partial-'+randomUUID();
  let h;
  try {
    h=await open(temporary,'wx',0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;
    if(replace)await rename(temporary,path);
    else {
      try { await link(temporary,path); }
      catch(e) { if(e.code!=='EEXIST')throw e; assert.equal(digest(await readFile(path)),digest(raw),'The original saved output differs: '+path); }
    }
  } finally {
    if(h)await h.close();
    try{await unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}
    await syncDirectory(dirname(path));
  }
}
async function immutable(path,value) {
  const existing=await optional(path); if(existing)return existing;
  await publish(path,json(value));return value;
}
function checkPrefix(before,after) {
  same(after.requests.slice(0,before.requests.length),before.requests);
  same(after.plan,before.plan);
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.workspaceId,before.workspaceId);
  assert.equal(after.requests.at(-1).action,'receive');
}
function captureBodies(record,plan) {
  const files=new Map();
  for(const revision of record.plan.revisions)for(const step of revision.steps)for(const f of step.files??[])files.set(f.id,f);
  return record.captures.map(c=>{
    const bytes=plan.operatingFileBytes(files.get(c.fileId));
    assert.equal(digest(bytes),c.sha256);assert.equal(bytes.length,c.bytes);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  });
}
export async function runRuntimeProcedureReceiving(options) {
  assert(options?.source&&options?.operation,'Supply complete Runtime source and an absolute retained operating case.');
  const source=resolve(options.source), root=resolve(options.operation);
  assert.equal(root,options.operation,'--operation must be an absolute original directory.');
  await privateDirectory(root);
  const storage=await import(pathToFileURL(join(source,'storage.mjs')).href);
  let original,receiver,cold,caseState,workspaceModel;
  const logs=await privateDirectory(join(root,'logs')), requests=await privateDirectory(join(root,'requests')),
    results=await privateDirectory(join(root,'results')), output=await privateDirectory(join(root,'handover'));
  const attempt=randomUUID(), attemptStarted=stamp(), attemptFile=join(logs,attempt+'.json');
  const retainedOptions={
    source,directory:options.workspace?resolve(options.workspace):join(root,'original-workspace'),
    receiver:options.receiver?resolve(options.receiver):join(root,'receiving-workspace'),
    coldReceiver:options.coldReceiver?resolve(options.coldReceiver):join(root,'cold-receiving-workspace'),
    sourceFile:options.sourceFile?resolve(options.sourceFile):join(dirname(source),'discovery','operating-plan.mjs'),
    selection:options.selection??{},
  };
  assert.equal(new Set([retainedOptions.directory,retainedOptions.receiver,retainedOptions.coldReceiver]).size,3,'Use three distinct original workspace directories.');
  async function step(name,callback) {
    const path=join(results,name+'.json'), done=await optional(path);if(done)return done;
    const value=await callback();
    await publish(join(results,name+'.provenance-'+attempt+'.json'),json({attempt,completedAt:stamp(),sourceIdentities}));
    await publish(path,json(value));return value;
  }
  async function request(name,prepare) {
    const path=join(requests,name+'.json'), retained=await optional(path);
    if(retained)return retained;
    const input=await prepare();await publish(path,json(input));return input;
  }
  async function mutate(name,api,method,prepare) {
    return step(name,async()=>api[method](await request(name,prepare)));
  }
  async function expect(name,callback,code) {
    return step(name,async()=>{
      try { await callback(); } catch(error) {
        assert.equal(error.code,code);return {code,observedAt:stamp()};
      }
      throw new Error('The original operation unexpectedly accepted '+name);
    });
  }
  async function cli(name,args,recoverOutput=null) {
    return step(name,async()=>{
      const intentPath=join(requests,name+'-cli-intent.json'), prior=await optional(intentPath);
      const intent={args,source,operation:OPERATION};
      if(prior)same(prior,intent);
      if(recoverOutput){
        let existing=null;try{existing=await readFile(recoverOutput.path);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(existing){
          assert(prior,'The output predates this original CLI intent.');
          assert.equal(digest(existing),digest(Buffer.from(recoverOutput.content)),'Keep the original incomplete CLI output and reconcile it before continuation.');
          return {args,recovered:true,value:{output:recoverOutput.path,sha256:digest(existing),bytes:existing.length}};
        }
      }
      if(!prior)await publish(intentPath,json(intent));
      const logId=name+'-'+randomUUID(), stdout=join(logs,logId+'.stdout'),stderr=join(logs,logId+'.stderr');
      const out=await open(stdout,'wx',0o600),err=await open(stderr,'wx',0o600);
      let result;
      try {
        result=await new Promise((resolveResult,reject)=>{
          const child=spawn(process.execPath,[join(source,'cli.mjs'),...args],{
            cwd:root,env:{...process.env,COMMONS_ORIGINAL_COURSE_GUARD_FD:'3'},
            stdio:['ignore',out.fd,err.fd,lease.fd],
          });
          child.once('error',reject);child.once('close',(code,signal)=>resolveResult({code,signal}));
        });
        await out.sync();await err.sync();
      } finally { await out.close();await err.close(); }
      assert.equal(result.code,0,'Original CLI failed; complete output is retained at '+stderr);
      const info=await lstat(stdout);assert(info.size<=257*1024*1024,'CLI output exceeds the native complete-document capacity.');
      const value=JSON.parse(await readFile(stdout,'utf8'));
      return {args,stdout,stderr,...result,value};
    });
  }
  const sourceIdentities=[];
  const lease=await storage.operationLease(join(root,'receiving.guard'));
  try {
    for(const relative of ['operating-procedures.mjs','storage.mjs','model.mjs','cli.mjs','../discovery/operating-plan.mjs','../discovery/operating-plan-return.mjs']) {
      const raw=await readFile(resolve(source,relative));
      sourceIdentities.push({path:relative,bytes:raw.length,sha256:digest(raw)});
    }
    const selectedBytes=await readFile(retainedOptions.sourceFile);
    assert(selectedBytes.length<=24*1024*1024,'Choose a complete source file within the original OperatingFile capacity.');
    caseState=await immutable(join(root,'case.json'),{
      schema:SCHEMA,operation:OPERATION,createdAt:stamp(),options:retainedOptions,
      selectedSource:{bytes:selectedBytes.length,sha256:digest(selectedBytes)},
      ids:Object.fromEntries(['create','attach','record','receive','receiverRecord','localSave','returnedReview','apply','coldReceive','reusedChanged','staleSave'].map(k=>[k,randomUUID()])),
    });
    assert.equal(caseState.schema,SCHEMA);assert.equal(caseState.operation,OPERATION);
    same(caseState.options,retainedOptions);
    same(caseState.selectedSource,{bytes:selectedBytes.length,sha256:digest(selectedBytes)});
    await publish(attemptFile,json({attempt,operation:OPERATION,startedAt:attemptStarted,sourceIdentities,phase:'RUNNING'}));
    const model=await import(pathToFileURL(join(source,'model.mjs')).href);
    // The nested workspace helper consumes this exact original module.
    workspaceModel=model;
    const plan=await import(pathToFileURL(join(dirname(source),'discovery','operating-plan.mjs')).href);
    const returns=await import(pathToFileURL(join(dirname(source),'discovery','operating-plan-return.mjs')).href);
    original=await openWorkspace(retainedOptions.directory,Boolean(options.workspace));
    receiver=await openWorkspace(retainedOptions.receiver,Boolean(options.receiver));
    cold=await openWorkspace(retainedOptions.coldReceiver,Boolean(options.coldReceiver));
    const ids=caseState.ids;
    assert.equal(new Set([original.config.workspaceId,receiver.config.workspaceId,cold.config.workspaceId]).size,3,'Use independent original workspace identities.');
    const priorWorkspaces=await step('workspace-identities',async()=>({original:original.config,receiver:receiver.config,cold:cold.config}));
    for(const [name,item] of Object.entries({original,receiver,cold})){
      assert.equal(item.config.workspaceId,priorWorkspaces[name].workspaceId,'The retained workspace identity changed.');
      assert.equal(item.config.directory,priorWorkspaces[name].directory);
    }
    const created=await mutate('01-create',original.api,'runtimeProcedureCreate',async()=>({
      requestId:ids.create,title:'Complete Runtime operating procedure receiving',owner:'Original receiving operator',
      customer:'Internal operating course',purpose:'Receive complete selected Runtime records and original returned plan history.',
      selection:retainedOptions.selection,
    }));
    const attached=await mutate('02-attach-source',original.api,'runtimeProcedureSave',async()=>{
      const draft=plan.operatingPlanDraft(created.record.plan);
      const file=plan.createOperatingFile({id:'complete-course-source',name:basename(retainedOptions.sourceFile),mediaType:'application/octet-stream',bytes:selectedBytes,note:'Complete original file selected for this retained operating course.'});
      const next=plan.addOperatingFile(draft,'perform-runtime-work',file);
      next.content.steps.find(s=>s.id==='perform-runtime-work').instruction='Read the complete selected source, retain its operating decision, and receive returned work in the same procedure.';
      return {requestId:ids.attach,procedureId:ids.create,expectedSha256:created.recordSha256,draft:next};
    });
    await expect('03-stale-save',()=>original.api.runtimeProcedureSave({
      requestId:ids.staleSave,procedureId:ids.create,expectedSha256:created.recordSha256,draft:plan.operatingPlanDraft(created.record.plan),
    }),'RUNTIME_PROCEDURE_CHANGED');
    await expect('04-reused-request',async()=>original.api.runtimeProcedureCreate({
      ...await request('01-create',()=>{throw new Error('Original request missing');}),title:'Different work under the same request',
    }),'RUNTIME_PROCEDURE_REQUEST_REUSED');
    const recorded=await mutate('05-record-original',original.api,'runtimeProcedureRecord',async()=>({
      requestId:ids.record,procedureId:ids.create,expectedSha256:attached.recordSha256,stepId:'perform-runtime-work',
      status:'completed',recordedResult:'Original source was received for the complete operating course.',
      owner:'Original receiving operator',selection:retainedOptions.selection,
    }));
    const received=await mutate('06-receive-original',receiver.api,'runtimeProcedureReceive',async()=>({
      requestId:ids.receive,document:recorded.record,
    }));
    checkPrefix(recorded.record,received.record);
    const receiverRecorded=await mutate('07-independent-record',receiver.api,'runtimeProcedureRecord',async()=>({
      requestId:ids.receiverRecord,procedureId:ids.create,expectedSha256:received.recordSha256,stepId:'review-receiving',
      status:'completed',recordedResult:'The independent receiving operator reopened complete source and saved the receiving observation.',
      owner:'Independent receiving operator',selection:{},
    }));
    const local=await mutate('08-local-edit',original.api,'runtimeProcedureSave',async()=>{
      const draft=plan.operatingPlanDraft(recorded.record.plan);
      draft.content.steps.find(s=>s.id==='perform-runtime-work').recordedResult='Original operator completed the local handover review.';
      return {requestId:ids.localSave,procedureId:ids.create,expectedSha256:recorded.recordSha256,draft};
    });
    const incoming=await step('09-complete-returned-plan',async()=>{
      const fork=plan.forkOperatingPlan(receiverRecorded.record.plan,{id:'returned-'+ids.returnedReview});
      const draft=plan.operatingPlanDraft(fork),s=draft.content.steps.find(s=>s.id==='perform-runtime-work');
      s.recordedResult='Independent operator returned the complete revised work for explicit review.';
      // General carried files may have later complete editions; native source-capture bytes remain immutable.
      const newBytes=await readFile(join(source,'operating-procedures.mjs'));
      s.files=s.files.map(file=>file.id==='complete-course-source'
        ?plan.createOperatingFile({id:file.id,name:'operating-procedures.mjs',mediaType:'text/javascript',bytes:newBytes,note:'Full current receiver source returned as a later carried-file edition.'}):file);
      return {plan:plan.saveOperatingPlanRevision(fork,draft),source:{bytes:newBytes.length,sha256:digest(newBytes)}};
    });
    let reviewed=await mutate('10-review-return',original.api,'runtimeProcedureReturn',async()=>({
      requestId:ids.returnedReview,procedureId:ids.create,expectedSha256:local.recordSha256,
      incoming:incoming.plan,reviewer:'Original receiving operator',notes:'Review the complete independent return, source captures and changed carried-file edition.',
    }));
    const firstComparison=reviewed.returnComparisons.find(r=>r.reviewId===ids.returnedReview).comparison;
    assert(firstComparison.rows.some(row=>row.conflict),'This course must retain an actual conflicting returned change.');
    for(let index=0;index<firstComparison.rows.length;index++){
      const row=firstComparison.rows[index],before=reviewed,name='11-decision-'+String(index+1).padStart(3,'0');
      reviewed=await mutate(name,original.api,'runtimeProcedureDecide',async()=>({
        requestId:randomUUID(),procedureId:ids.create,expectedSha256:before.recordSha256,
        reviewId:ids.returnedReview,key:row.key,decision:{take:'incoming',note:'Receive this complete original returned value.'},
      }));
    }
    const applied=await mutate('12-apply-return',original.api,'runtimeProcedureApply',async()=>({
      requestId:ids.apply,procedureId:ids.create,expectedSha256:reviewed.recordSha256,reviewId:ids.returnedReview,
    }));
    await step('13-replay-apply',async()=>{
      const repeated=await original.api.runtimeProcedureApply(await request('12-apply-return',()=>{throw new Error('Original apply request missing');}));
      assert(repeated.reused);same(repeated.record,applied.record);return {reused:true,recordSha256:repeated.recordSha256};
    });
    const bodies=captureBodies(applied.record,plan);
    assert(bodies.some(c=>c.workspaceId===original.config.workspaceId));
    assert(bodies.some(c=>c.workspaceId===receiver.config.workspaceId),'Applying the return must retain the independent native capture.');
    for(const originalCapture of recorded.record.captures)assert(applied.record.captures.some(c=>JSON.stringify(c)===JSON.stringify(originalCapture)));
    const oldFiles=applied.record.plan.revisions.flatMap(r=>r.steps.flatMap(s=>s.files??[])).filter(f=>f.id==='complete-course-source');
    assert(oldFiles.some(f=>digest(plan.operatingFileBytes(f))===caseState.selectedSource.sha256));
    assert(oldFiles.some(f=>digest(plan.operatingFileBytes(f))===incoming.source.sha256));
    const exported=await step('14-export-complete',async()=>{
      const document=await original.api.runtimeProcedureExport({procedureId:ids.create,format:'json'});
      const html=await original.api.runtimeProcedureExport({procedureId:ids.create,format:'html'});
      const returned=await original.api.runtimeProcedureExport({procedureId:ids.create,format:'html',reviewId:ids.returnedReview});
      same(JSON.parse(document.content),applied.record);
      assert.equal(digest(Buffer.from(document.content)),document.sha256);
      assert(html.content.includes('sandbox="allow-downloads"'));
      await publish(join(output,'complete-procedure.json'),document.content);
      await publish(join(output,'complete-procedure.html'),html.content);
      await publish(join(output,'returned-work.html'),returned.content);
      return {json:{path:join(output,'complete-procedure.json'),sha256:document.sha256,bytes:document.bytes},
        html:{path:join(output,'complete-procedure.html'),sha256:html.sha256,bytes:html.bytes},
        returned:{path:join(output,'returned-work.html'),sha256:returned.sha256,bytes:returned.bytes}};
    });
    await request('15-cold-cli-receive',async()=>({requestId:ids.coldReceive,document:JSON.parse(await readFile(exported.json.path,'utf8'))}));
    const cliReceived=await cli('15-cold-cli-receive',['procedure-receive','--workspace',retainedOptions.coldReceiver,'--request',join(requests,'15-cold-cli-receive.json')]);
    checkPrefix(applied.record,cliReceived.value.record);
    await step('16-cold-reopen',async()=>{
      await cold.api.close();cold.api=await model.openRuntimeWorkspace({directory:retainedOptions.coldReceiver});
      const reopened=await cold.api.runtimeProcedureRead({procedureId:ids.create});
      same(reopened.record,cliReceived.value.record);
      const repeated=await cold.api.runtimeProcedureReceive(await request('15-cold-cli-receive',()=>{throw new Error('Original receive missing');}));
      assert(repeated.reused);same(repeated.record,reopened.record);
      const state=await cold.api.runtimeProceduresState();
      assert(state.procedures.some(p=>p.id===ids.create));
      return {recordSha256:reopened.recordSha256,recordRevision:reopened.record.revision,requestReplay:true,workspaceId:cold.config.workspaceId};
    });
    const planOutput=join(output,'complete-plan.json');
    await cli('17-cli-plan-export',['procedure-export','--workspace',retainedOptions.coldReceiver,'--procedure-id',ids.create,'--format','plan-json','--output',planOutput],{path:planOutput,content:json(applied.record.plan)});
    same(JSON.parse(await readFile(planOutput,'utf8')),applied.record.plan);
    // A cached stage receipt does not prove the current workspace or outgoing bytes.
    // Reopen and verify these original retained objects on every successful invocation.
    const currentOriginal=await original.api.runtimeProcedureRead({procedureId:ids.create});
    const currentReturning=await receiver.api.runtimeProcedureRead({procedureId:ids.create});
    const currentCold=await cold.api.runtimeProcedureRead({procedureId:ids.create});
    same(currentOriginal.record,applied.record);
    same(currentReturning.record,receiverRecorded.record);
    same(currentCold.record,cliReceived.value.record);
    same(captureBodies(currentOriginal.record,plan),bodies);
    for(const item of Object.values(exported)){
      const raw=await readFile(item.path);assert.equal(raw.length,item.bytes);assert.equal(digest(raw),item.sha256);
    }
    same(JSON.parse(await readFile(planOutput,'utf8')),applied.record.plan);
    const previousCompletion=await optional(join(root,'result.json'));
    if(previousCompletion?.phase==='COMPLETE'){
      await publish(join(logs,'retained-completion-'+digest(Buffer.from(json(previousCompletion)))+'.json'),json(previousCompletion));
    }
    const report={schema:SCHEMA,operation:OPERATION,phase:'COMPLETE',attempt,completedAt:stamp(),
      completionMode:previousCompletion?.phase==='COMPLETE'?'ORIGINAL_COMPLETION_REVALIDATED':'ORIGINAL_COURSE_COMPLETED',
      priorCompletion:previousCompletion?.phase==='COMPLETE'?{attempt:previousCompletion.attempt,completedAt:previousCompletion.completedAt,sourceIdentities:previousCompletion.sourceIdentities}:null,
      currentVerification:{at:stamp(),sourceIdentities,originalRecordSha256:currentOriginal.recordSha256,returningRecordSha256:currentReturning.recordSha256,coldRecordSha256:currentCold.recordSha256},
      stageExecutionProvenance:'Each first completed stage keeps its own source/attempt in results/*.provenance-*.json. Cached stages remain those original executions.',

      caseDirectory:root,procedureId:ids.create,workspaceIds:{original:original.config.workspaceId,receiver:receiver.config.workspaceId,cold:cold.config.workspaceId},
      recordRevision:applied.record.revision,planRevisions:applied.record.plan.revisions.length,captures:applied.record.captures.length,
      reviewedReturnId:ids.returnedReview,conflicts:firstComparison.rows.filter(r=>r.conflict).map(r=>r.key),
      completeSourceVersions:[caseState.selectedSource,incoming.source],sourceIdentities,outputs:exported,
      receivedPlan:planOutput,checks:{originalRequestReplay:true,compareAndSwap:true,changedRequestRefused:true,wholeHistoricalFiles:true,
        independentCaptureAdopted:true,completeReturnedReview:true,exactApplyReplay:true,receiveHistoryAppended:true,coldReopen:true,nativeCLI:true}};
    await publish(join(root,'result.json'),json(report),true);
    await publish(attemptFile,json({...report,startedAt:attemptStarted}),true);
    return report;
  } catch(error) {
    await publish(attemptFile,json({attempt,operation:OPERATION,startedAt:attemptStarted,failedAt:stamp(),phase:'INTERRUPTED',
      sourceIdentities,error:{code:error.code??null,message:String(error.message??error),stack:error.stack??null}}),true).catch(()=>{});
    throw error;
  } finally {
    for(const item of [original,receiver,cold])if(item)await item.api.close().catch(()=>{});
    await lease.close();
  }
  // Function declarations retain this single imported source module throughout the course.
  async function openWorkspace(path,explicit) {
    let config=await optional(join(path,'workspace.json'));
    if(!config){
      assert(!explicit,'The supplied original workspace has no complete config; continue its retained initialization first.');
      try{await lstat(path);throw new Error('The original workspace initialization is incomplete at '+path);}
      catch(error){if(error.code!=='ENOENT')throw error;}
      config=await workspaceModel.createRuntimeWorkspace({directory:path});
    }
    assert.equal(config.directory,path);assert.equal(config.schema,'stellar-forge.runtime-workspace.v1');
    return {config,api:await workspaceModel.openRuntimeWorkspace({directory:path})};
  }
}
function parse(argv) {
  const names=new Map([['--source','source'],['--operation','operation'],['--workspace','workspace'],['--receiver','receiver'],['--cold-receiver','coldReceiver'],['--source-file','sourceFile'],['--selection','selectionFile']]);
  const options={};
  for(let i=0;i<argv.length;i+=2){assert(names.has(argv[i])&&argv[i+1]&&!Object.hasOwn(options,names.get(argv[i])),'Use a supported option once with its full value.');options[names.get(argv[i])]=argv[i+1];}
  return options;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options=parse(process.argv.slice(2));
  if(options.selectionFile){options.selection=JSON.parse(await readFile(resolve(options.selectionFile),'utf8'));delete options.selectionFile;}
  runRuntimeProcedureReceiving(options).then(result=>process.stdout.write(json(result))).catch(error=>{
    process.stderr.write(json({operation:OPERATION,error:error.code??'RECEIVING_FAILED',message:error.message}));process.exitCode=1;
  });
}
