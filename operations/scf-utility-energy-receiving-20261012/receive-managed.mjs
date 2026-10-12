// MIT. Original Utility managed Applications and complete customer receiving.
import { readFile, realpath, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { runUtilityEnergyMcpJourney, utilityEnergySourceIdentity } from './receive-mcp.mjs';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.utility-applications-receiving.v1';
const run = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value,message) => { if (!value) throw new Error(message); };
const moduleAt = (root,file) => import(pathToFileURL(join(root,ROOT+file)).href);
async function fileHash(path) {
  const handle=await open(path,'r');
  try { const digest=createHash('sha256');
    for await(const chunk of handle.createReadStream({autoClose:false})) digest.update(chunk);
    return digest.digest('hex');
  } finally {await handle.close();}
}

/**
 * Receives an existing customer workspace through the original Applications
 * review/save/adopt/start/stop/recover APIs. The selected runtime is a completed
 * original installation. This operation never imports a second customer store.
 */
export async function receiveUtilityEnergyApplications(config,{onProgress=()=>{},onOpen}={}) {
  for(const key of ['runtimeDirectory','workspaceDirectory','pythonExecutable','receivingDirectory'])
    need(typeof config[key]==='string' && isAbsolute(config[key]),'Choose an absolute '+key+'.');
  if(config.sourcePacket) {
    need(isAbsolute(config.sourcePacket) && /^[a-f0-9]{64}$/.test(config.packetSha256??''),
      'Bind the original source packet to its exact SHA256.');
    need(await fileHash(config.sourcePacket)===config.packetSha256,'The original complete customer packet changed.');
  }
  const sourceManifest=config.sourceManifest ?? fileURLToPath(new URL('./source-manifest.json',import.meta.url));
  const declaration=typeof sourceManifest==='string' ? JSON.parse(await readFile(sourceManifest,'utf8')) : sourceManifest;
  need(declaration?.schema==='stellar-forge.utility-receiving-source.v1','Choose the original receiving source declaration.');
  const workspaceDirectory=await realpath(config.workspaceDirectory);
  const bootstrap=config.bootstrapSourceRoot ?? join(config.runtimeDirectory,'package','source');
  const {inspectMerchantRuntime}=await moduleAt(bootstrap,'sf46-release/runtime-package.mjs');
  const runtime=await inspectMerchantRuntime(config.runtimeDirectory,{load:false});
  if(config.expectedSourceCommit) need(runtime.sourceCommit===config.expectedSourceCommit,'The selected installed source changed.');
  const {createRuntimeWorkspace,openRuntimeWorkspace}=
    await moduleAt(runtime.sourceRoot,'distribution/runtime-workspace/model.mjs');
  const {makePrivate,privateDirectory,readJSON,saveJSON,operationLease,canonical}=
    await moduleAt(runtime.sourceRoot,'distribution/runtime-workspace/storage.mjs');
  const {applicationEnvironment}=
    await moduleAt(runtime.sourceRoot,'distribution/runtime-workspace/application-command.mjs');
  const {managedCommandAlive}=
    await moduleAt(runtime.sourceRoot,'distribution/runtime-workspace/managed-workspace.mjs');
  const {openUtilityWorkspace}=await moduleAt(runtime.sourceRoot,'sf30-seller-sdk/utility-energy/utility-client.mjs');
  const {environment}=await applicationEnvironment(config.environmentFile);
  const inspectBinding=async()=>{
    const observed=await run(config.pythonExecutable,[
      join(runtime.sourceRoot,ROOT+'sf30-seller-sdk/utility-energy/cli.py'),
      '--workspace',workspaceDirectory,'binding'
    ],{encoding:'utf8',env:{...environment,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000,maxBuffer:65536});
    return JSON.parse(observed.stdout);
  };
  const original=await inspectBinding();
  need(original.schema==='stellar-forge.utility-managed-binding.v1' &&
    original.applicationSchema==='stellar-forge.utility-workspace.v1',
    'Use the complete original Utility producer and retained workspace.');
  try {await makePrivate(config.receivingDirectory);}
  catch(error) {if(error.code!=='EEXIST') throw error;await privateDirectory(config.receivingDirectory);}
  const lease=await operationLease(join(config.receivingDirectory,'receiving.lock'));
  const receiptPath=join(config.receivingDirectory,'receiving.json');
  const selection={
    runtimeDirectory:runtime.directory,sourceCommit:runtime.sourceCommit,installationId:runtime.installationId,
    sourceManifestSha256:runtime.sourceManifestSha256,sourceDeclarationSha256:hash(JSON.stringify(canonical(declaration))),
    sourcePacketSha256:config.packetSha256??null,workspaceDirectory,pythonExecutable:config.pythonExecutable,
    bindingSha256:original.sha256,environmentFile:config.environmentFile??null,
    applicationWorkspace:config.applicationWorkspace??join(config.receivingDirectory,'applications'),
    connectionFile:join(config.receivingDirectory,'console-url'),
    expected:config.expected??null,reviewId:config.reviewId??null,exportId:config.exportId??null,
    finalExport:config.finalExport===true
  };
  let journal,model,stage='OPEN';
  try {
    journal=await readJSON(receiptPath,true);
    if(journal) {
      need(journal.schema===SCHEMA && JSON.stringify(canonical(journal.selection))===JSON.stringify(canonical(selection)),
        'Continue the same receiving directory with its original selection.');
      if(journal.completedAt) return journal;
    } else {
      journal={schema:SCHEMA,createdAt:new Date().toISOString(),selection,saveRequestId:randomUUID(),
        passes:['first-open','reopen'].map(name=>({name,requestId:randomUUID()}))};
      await saveJSON(receiptPath,journal);
    }
    const persist=async()=>{journal.updatedAt=new Date().toISOString();await saveJSON(receiptPath,journal,true);};
    const progress=phase=>onProgress({stage,phase,applicationId:journal.applicationId??null});
    try {await readFile(join(selection.applicationWorkspace,'workspace.json'));}
    catch(error) {
      if(error.code!=='ENOENT'||config.applicationWorkspace)throw error;
      await createRuntimeWorkspace({directory:selection.applicationWorkspace});
    }
    model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
    const attached=await model.attach({directory:runtime.directory,label:'Original Utility customer'});
    const application=async()=>{
      const item=(await model.applicationsState()).applications.find(row=>row.id===journal.applicationId);
      need(item,'The saved original Utility application is missing.');return item;
    };
    const waitFor=async(accept,recover)=>{
      const began=Date.now(),attempted=new Set();let nextProgress=began;
      for(;;) {
        const item=await application();
        if(accept(item))return item;
        const operation=item.current??item.adoption;
        const recoverable=operation&&['PENDING','QUEUED','INTERRUPTED'].includes(operation.phase);
        const alive=operation?.state?await managedCommandAlive(operation.state):false;
        if(recoverable&&!operation.active&&!alive&&recover&&!attempted.has(operation.id)) {
          attempted.add(operation.id);await recover(item);continue;
        }
        need(!['FAILED','UNAVAILABLE'].includes(item.phase)&&item.adoption?.phase!=='FAILED',
          'Read the failed original operation and continue its retained receiving.');
        need(Date.now()-began<180000,'The original operation remains recorded; resume this same receiving directory.');
        if(Date.now()>=nextProgress){progress(item.phase);nextProgress=Date.now()+15000;}
        await delay(500);
      }
    };
    if(!journal.reviewId) {
      stage='REVIEW';
      const reviewed=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'utility-energy',
        label:config.label??'Retained UtilityAPI and Green Button customer',
        ...(config.homeId?{homeId:config.homeId}:{}),
        settings:{workspaceDirectory,pythonExecutable:config.pythonExecutable,connectionFile:selection.connectionFile,port:0,
          ...(config.environmentFile?{environmentFile:config.environmentFile}:{})}});
      need(reviewed.command.command==='utility-energy','The original source-owned Utility command changed.');
      journal.reviewId=reviewed.id;await persist();
    }
    if(!journal.applicationId) {
      stage='SAVE';
      const saved=await model.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.reviewId});
      journal.applicationId=saved.applicationId;await persist();
      if(saved.connectionError)throw new Error(saved.connectionError.message);
    }
    stage='ADOPT';
    await model.applicationsConnect({applicationId:journal.applicationId});
    const adopted=await application();
    if(!adopted.release&&adopted.adoption&&!adopted.adoption.active) {
      const operation=adopted.adoption;
      if(operation.phase==='QUEUED')await model.resumeQueued(operation.id);
      else if(operation.phase==='INTERRUPTED')await model.recoverManagedOperation(operation.id);
    }
    await waitFor(item=>Boolean(item.release),async item=>{
      if(item.adoption?.id)await model.recoverManagedOperation(item.adoption.id);
    });
    for(const pass of journal.passes) {
      if(pass.stoppedAt)continue;
      await model.close();model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
      if(!pass.opened) {
        stage='START_'+pass.name;
        if(!pass.reviewId) {
          pass.reviewId=(await model.applicationsStartReview({applicationId:journal.applicationId})).id;await persist();
        }
        const current=await application();
        const recover=()=>model.applicationsRecover({applicationId:journal.applicationId,operationId:pass.requestId});
        if(!current.runs.some(item=>item.id===pass.requestId))
          await model.applicationsStart({applicationId:journal.applicationId,requestId:pass.requestId,reviewId:pass.reviewId});
        else if(['PENDING','QUEUED','INTERRUPTED'].includes(current.current?.phase)&&!current.current.active)await recover();
        const active=await waitFor(item=>item.current?.id===pass.requestId&&Boolean(item.current.privateUrl),recover);
        const url=new URL(active.current.privateUrl);
        need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),
          'The original managed console URL is missing.');
        need((await readFile(selection.connectionFile,'utf8')).trim()===url.href,
          'The managed connection file differs from its original console.');
        const client=await openUtilityWorkspace({connectionFile:selection.connectionFile,
          expectedBindingSha256:selection.bindingSha256,expectedWorkspace:workspaceDirectory});
        let launch,state,after;
        const passDirectory=join(config.receivingDirectory,pass.name);await mkdir(passDirectory,{recursive:true,mode:0o700});
        try {
          launch=await client.launch();state=await client.state();
          need(launch.schema==='stellar-forge.utility-workspace-launch.v1'&&
            launch.bindingSha256===selection.bindingSha256&&launch.workspace===workspaceDirectory,
            'The original live Utility binding changed.');
          const identity=utilityEnergySourceIdentity(state);
          const identitySha=hash(JSON.stringify(canonical(identity)));
          const expected=selection.expected;
          if(expected?.sourceIdentitySha256)need(identitySha===expected.sourceIdentitySha256,'The reviewed original Utility source changed.');
          if(expected?.importIds)need(JSON.stringify([...expected.importIds].sort())===
            JSON.stringify(state.imports.map(row=>row.id).sort()),'The original source import set changed.');
          if(expected?.reviewIds)need(JSON.stringify([...expected.reviewIds].sort())===
            JSON.stringify(state.reviews.map(row=>row.id).sort()),'The original interval review set changed.');
          if(expected?.buildId)need(state.active_build===expected.buildId,'The original selected native edition changed.');
          if(expected?.snapshot) {
            const build=await client.read('/api/build',{id:expected.buildId??state.active_build});
            need(build.native?.snapshot===expected.snapshot||build.snapshot===expected.snapshot,
              'The original native dataset snapshot changed.');
          }
          const first=journal.passes[0].opened;
          if(first)need(first.sourceIdentitySha256===identitySha,'The original source changed across managed reopen.');
          await saveJSON(join(passDirectory,'original-state.json'),state,true);
          // The same receiving journal reuses its original final-export request and
          // immutable downloaded files when the managed owner opens a second time.
          stage='MCP_'+pass.name;
          const mcp=await runUtilityEnergyMcpJourney({sourceRoot:runtime.sourceRoot,workspaceDirectory,
            consoleUrlFile:selection.connectionFile,outputDirectory:join(config.receivingDirectory,'mcp'),
            sourceManifest:declaration,workspaceAlias:'customer',reviewId:selection.reviewId??undefined,
            exportId:selection.exportId??undefined,finalExport:selection.finalExport,
            expectedSourceIdentitySha256:identitySha});
          need(mcp.passed===true&&mcp.toolCount===22,'The complete original Utility MCP receiving did not finish.');
          await saveJSON(join(passDirectory,'mcp-receiving.json'),mcp,true);
          stage='VIEW_'+pass.name;
          const rendered=onOpen?await onOpen({pass:pass.name,model,runtime,applicationId:journal.applicationId,
            applicationWorkspace:selection.applicationWorkspace,consoleUrl:url.href,consoleUrlFile:selection.connectionFile,
            workspaceDirectory,state,receivingDirectory:passDirectory,mcp}):null;
          if(rendered)need(rendered.passed===true||rendered.status==='COMPLETE','The original browser view has not completed.');
          after=await client.state();
          need(hash(JSON.stringify(canonical(utilityEnergySourceIdentity(after))))===identitySha,
            'The original reviewed source changed during managed receiving.');
          pass.opened={at:new Date().toISOString(),sourceIdentity:identity,sourceIdentitySha256:identitySha,
            bindingSha256:launch.bindingSha256,executedSourceRoot:launch.sourceRoot,
            privateUrlSha256:hash(url.href),listener:url.origin,pid:launch.pid,parser:launch.parser,
            nativeExportId:mcp.nativeExportId,toolCount:mcp.toolCount,toolNames:mcp.toolNames,
            mcpDirectory:join(config.receivingDirectory,'mcp'),downloads:mcp.downloads.map(row=>({
              selection:row.selection,exportId:row.exportId,manifestSha256:row.manifestSha256,
              bytes:row.bytes,state:row.state,reopened:row.reopened})),rendered};
        } finally {await client.close();}
        await persist();progress('OPEN');
      }
      stage='STOP_'+pass.name;
      await model.applicationsStop({applicationId:journal.applicationId,operationId:pass.requestId});
      const stopped=await waitFor(item=>item.phase==='STOPPED'&&item.current?.id===pass.requestId&&!item.current.active);
      need((await inspectBinding()).sha256===selection.bindingSha256,'The retained workspace binding changed after stop.');
      try {await readFile(selection.connectionFile);throw new Error('The stopped console retained its connection file.');}
      catch(error){if(error.code!=='ENOENT')throw error;}
      let pidEnded=false;
      try {process.kill(pass.opened.pid,0);}
      catch(error){if(error.code==='ESRCH')pidEnded=true;else throw error;}
      need(pidEnded,'The original Utility process has not ended.');
      const listenerClosed=await new Promise(done=>{
        const request=httpRequest(new URL('/api/launch',pass.opened.listener),{agent:false},response=>{
          response.resume();response.once('end',()=>done(false));
        });
        request.once('error',error=>done(error.code==='ECONNREFUSED'));
        request.setTimeout(3000,()=>{request.destroy();done(false);});request.end();
      });
      need(listenerClosed,'The original Utility listener has not closed.');
      pass.stoppedAt=new Date().toISOString();pass.phase=stopped.current.phase;
      pass.closed={connectionFileRemoved:true,pidEnded,listenerClosed};await persist();progress('STOPPED');
    }
    for(const key of ['sourceIdentitySha256','bindingSha256'])
      need(journal.passes[0].opened[key]===journal.passes[1].opened[key],
        'The original retained customer changed across reopen: '+key);
    need(journal.passes[0].opened.privateUrlSha256!==journal.passes[1].opened.privateUrlSha256,
      'The original console session did not reopen.');
    journal.completedAt=new Date().toISOString();journal.status='COMPLETE';journal.passed=true;
    delete journal.issue;await persist();return journal;
  } catch(error) {
    if(journal){journal.issue={stage,at:new Date().toISOString(),code:error.code??null,message:String(error.message).slice(0,1000)};
      await saveJSON(receiptPath,journal,true).catch(()=>{});}
    throw error;
  } finally {if(model)await model.close();await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const result=await receiveUtilityEnergyApplications(config,{onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify({status:result.status,passed:result.passed,applicationId:result.applicationId,
    sourceCommit:result.selection.sourceCommit,bindingSha256:result.selection.bindingSha256,passes:result.passes})+'\n');
}
