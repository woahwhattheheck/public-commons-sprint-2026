// MIT. Original buyer receiving phase for the existing native Operations journey.
// Invoke in the original owner's process only after its CLI server has drained.
import {readFile,writeFile,mkdir,lstat,realpath,open,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const digest = raw => createHash('sha256').update(raw).digest('hex');
const gitBlob = raw => createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  value && typeof value==='object' ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value);
const need = (test,message) => {if(!test)throw Object.assign(new Error(message),{code:'BUYER_AGENT_RECEIVING_CONFLICT'});};
const PINNED = {
  'stellar/scf_2026/sf47_budget_model/workspace/agent-contracts.mjs':'9bed2f1855649c5dc07d205a704e1932edb55467',
  'stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs':'a6fe73a2e59adfd95c13edd3b68264d50b7aae1c',
  'stellar-forge/mcp-merchant-operator/grant-workspace.mjs':'6eb6a763f8886894f6ed8a0f7d36958ef6acfc76',
  'stellar-forge/mcp-merchant-operator/catalog/grant-workspace.mjs':'ae644bd15fa7c72c5ced90ceaac47d974484a1cc'
};
async function regular(file) {
  const before=await lstat(file,{bigint:true});
  need(before.isFile()&&!before.isSymbolicLink()&&await realpath(file)===file,'Select a complete original regular file: '+file);
  const fd=await open(file,'r');
  try {
    const bytes=await fd.readFile(),after=await fd.stat({bigint:true});
    need(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]),'Original file changed during its read.');
    return bytes;
  } finally {await fd.close();}
}
async function optional(file) {
  try{return await regular(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  need(stat.isDirectory()&&(stat.mode&0o077)===0&&await realpath(path)===path,'Select an original private directory without aliases.');
  return path;
}
async function retain(file,bytes,{immutable=false}={}) {
  const raw=Buffer.isBuffer(bytes)?bytes:json(bytes),temporary=file+'.writing-'+randomUUID();
  const fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
  try {
    if(immutable) {
      try{await link(temporary,file);}
      catch(error){if(error.code!=='EEXIST')throw error;need((await regular(file)).equals(raw),'Retained identity already contains different original bytes.');}
    } else await rename(temporary,file);
    const directory=await open(dirname(file),'r');
    try{await directory.sync();}finally{await directory.close();}
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {path:file,bytes:raw.length,sha256:digest(raw)};
}
function selection(value) {
  return {program:value.program,plan:value.plan,records:value.records,sources:value.sources,
    forecasts:value.forecasts,portfolios:value.portfolios,reviews:value.reviews,completionPlans:value.completionPlans};
}
async function receiveFile(provider,alias,snapshot,destination) {
  need(snapshot.retention?.state==='COMPLETE'&&snapshot.id&&/^[a-f0-9]{64}$/.test(snapshot.file?.sha256),
    'The native response must retain its complete file before receiving.');
  const pieces=[];let offset=0,readId=null,pages=0;
  try {
    while(true) {
      const part=await provider.call('merchant_grant_file_read',{workspace:alias,snapshotId:snapshot.id,
        expectedSha256:snapshot.file.sha256,offset,limit:65536,...(readId?{readId}:{})});
      need(part.offset===offset&&part.file.sha256===snapshot.file.sha256&&part.file.bytes===snapshot.file.bytes&&part.encoding==='base64',
        'A returned native file page has another source identity.');
      const bytes=Buffer.from(part.data,'base64');
      need(bytes.length===part.bytesRead&&part.data===bytes.toString('base64'),'A native file page has incomplete base64 bytes.');
      pieces.push(bytes);pages++;offset+=bytes.length;readId=part.readId;
      if(part.nextOffset===null){readId=null;break;}
      need(part.nextOffset===offset&&bytes.length>0,'The original byte cursor did not advance.');
    }
  } finally {
    if(readId)await provider.call('merchant_grant_file_release',{workspace:alias,snapshotId:snapshot.id,readId});
  }
  const bytes=Buffer.concat(pieces);
  need(bytes.length===snapshot.file.bytes&&digest(bytes)===snapshot.file.sha256,'The complete native file differs from its original response.');
  const file=await retain(destination,bytes);
  return {bytes,file,pages,snapshot};
}
async function rows(provider,alias,snapshot,pointer) {
  let offset=0,count=null,pages=0;const result=[];
  while(true) {
    const page=await provider.call('merchant_grant_rows',{workspace:alias,snapshotId:snapshot.id,
      expectedSha256:snapshot.file.sha256,pointer,offset,limit:2});
    need(page.offset===offset&&!page.largeRow,'Use the complete original response for a row larger than the retained page limit.');
    need(count===null||count===page.count,'The retained array count changed.');count=page.count;pages++;
    result.push(...page.rows);offset+=page.rows.length;
    if(page.nextOffset===null)break;
    need(page.nextOffset===offset&&page.rows.length>0,'The original row cursor did not advance.');
  }
  need(result.length===count,'The complete native row selection is missing rows.');
  return {rows:result,pages,count};
}
async function history(client,caseId) {
  const events=[];let after=0;
  while(true) {
    const response=await client.read('case-history',{caseId,after,limit:200});
    const value=response.value;
    need(Array.isArray(value.events),'The original case history is missing.');
    events.push(...value.events);
    if(value.nextAfter===null)break;
    need(Number.isSafeInteger(value.nextAfter)&&value.nextAfter>after,'The original history cursor did not advance.');
    after=value.nextAfter;
  }
  return events;
}
export async function receiveBuyerWithAgent(input) {
  need(input&&typeof input==='object'&&!Array.isArray(input),'Use the original receiving configuration.');
  const allowed=['schema','operationId','sourceRoot','sourceHead','workspaceDirectory','outputDirectory','caseId',
    'originalHandoffPath','sourceSha256','purchaseId','deploymentId','actor','nodeExecutable','pythonExecutable','cohort'];
  need(Object.keys(input).every(key=>allowed.includes(key)),'The receiving configuration contains an unknown field.');
  need(input.schema==='sf47.native-buyer-agent-phase.v1','Use the original buyer agent phase schema.');
  for(const key of ['sourceRoot','workspaceDirectory','outputDirectory','originalHandoffPath','nodeExecutable','pythonExecutable'])
    need(typeof input[key]==='string'&&isAbsolute(input[key])&&resolve(input[key])===input[key],'Use an exact absolute '+key+'.');
  need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,75}$/.test(input.operationId),'Retain the original operation ID, up to76 characters.');
  need(/^[a-f0-9]{40}$/.test(input.sourceHead)&&/^[a-f0-9]{64}$/.test(input.sourceSha256),'Retain the exact source commit and original handoff SHA.');
  for(const[key,prefix]of [['caseId','operation'],['purchaseId','purchase'],['deploymentId','deployment']])
    need(new RegExp('^'+prefix+'-[a-f0-9]{32}$').test(input[key]),'Select the existing original '+key+'.');
  need(typeof input.actor==='string'&&input.actor.trim()&&input.actor.length<=300,'Retain the named original operator.');
  need(await realpath(input.nodeExecutable)===await realpath(process.execPath),'Run this phase with the declared original Node executable.');
  const output=await privateDirectory(input.outputDirectory),configFile=join(output,'phase-input.json');
  await retain(configFile,input,{immutable:true});
  const prior=await optional(join(output,'NATIVE_BUYER_AGENT_RESULT.json'));
  if(prior) {
    const result=JSON.parse(prior);
    if(result.complete===true) {
      need(result.inputSha256===digest(json(input)),'The completed phase belongs to another original input.');
      for(const artifact of result.artifacts) {
        const bytes=await regular(artifact.path);
        need(bytes.length===artifact.bytes&&digest(bytes)===artifact.sha256,'A completed native artifact differs.');
      }
      return result;
    }
  }
  const handoff=await regular(input.originalHandoffPath);
  need(digest(handoff)===input.sourceSha256,'The original Inbox handoff differs from its accepted SHA.');
  need(handoff.length<=8*1024*1024,'The complete original buyer source exceeds the native8MiB limit.');
  const sourceFiles=[];
  for(const[path,expected]of Object.entries(PINNED)) {
    const bytes=await regular(join(input.sourceRoot,path));
    need(gitBlob(bytes)===expected,'Use the complete original buyer/cohort agent source: '+path);
    sourceFiles.push({path,gitBlob:expected,sha256:digest(bytes),bytes:bytes.length});
  }
  const runtime=await import(pathToFileURL(join(input.sourceRoot,'stellar-forge/mcp-merchant-operator/grant-workspace.mjs')).href);
  const clientModule=await import(pathToFileURL(join(input.sourceRoot,'stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs')).href);
  need(runtime.grantWorkspaceTools.length===58&&['merchant_grant_cohort_seed','merchant_grant_cohort_preview','merchant_grant_cohort_prepare'].every(name=>runtime.grantWorkspaceTools.some(tool=>tool.name===name)),
    'Use the complete original 58-tool buyer/cohort catalogue.');
  const alias='original',exportsDirectory=await privateDirectory(join(output,'retained'));
  const connectionFile=join(output,'connection.json');
  await retain(connectionFile,{schema:runtime.GRANT_WORKSPACE_CONNECTION_SCHEMA,workspaces:{[alias]:{
    directory:input.workspaceDirectory,pythonExecutable:input.pythonExecutable,allowStart:true,label:'Original buyer operating case',
    inputs:{handoff:{file:input.originalHandoffPath,sha256:input.sourceSha256,kind:'buyer-operations',mediaType:'application/json'}}
  }}},{immutable:true});
  const originalNode=process.env.SF47_BUYER_NODE;
  process.env.SF47_BUYER_NODE=input.nodeExecutable;
  let provider=null,client=null,result=null,phaseError=null,cohortResult=null;const shutdownErrors=[],artifacts=[];
  const saveArtifact=async(name,bytes,immutable=true)=>{
    const row=await retain(join(output,name),bytes,{immutable});artifacts.push(row);return row;
  };
  const openOriginal=async()=>{
    const config=await runtime.readGrantWorkspaceConfiguration(connectionFile);
    provider=new runtime.MerchantGrantWorkspaces({grantWorkspaces:config,exportsDirectory});
    const opened=await provider.call('merchant_grant_open',{workspace:alias,
      expectedSelectionSha256:config.workspaces[alias].selectionSha256});
    const binding=await clientModule.inspectGrantAgentBinding({directory:input.workspaceDirectory,
      pythonExecutable:input.pythonExecutable,allowStart:false,label:'Original buyer receiving client'});
    client=new clientModule.GrantWorkspaceClient(binding);await client.open({expectedSelectionSha256:binding.selectionSha256});
    need(client.summary.instanceId===opened.instanceId,'The client and MCP provider must use the same original service.');
    return {instanceId:opened.instanceId,selectionSha256:binding.selectionSha256};
  };
  const closeOriginal=async()=>{
    if(client){await client.close();client=null;}
    if(provider){await provider.close();provider=null;}
  };
  try {
    const firstService=await openOriginal();
    const current=(await client.read('case',{caseId:input.caseId})).value;
    need(current.program.id===input.caseId,'The receiving case differs.');
    const purchase=current.records.purchases.find(row=>row.id===input.purchaseId);
    need(purchase&&purchase.deploymentId===input.deploymentId&&current.records.deployments.some(row=>row.id===input.deploymentId),
      'Keep the existing original purchase and deployment selection.');
    const baselineFile=join(output,'original-case-before-agent.json');
    const baselineRaw=await optional(baselineFile);
    const baseline=baselineRaw?JSON.parse(baselineRaw):current;
    if(!baselineRaw)await saveArtifact('original-case-before-agent.json',current);
    const historyFile=join(output,'original-history-before-agent.json');
    const historyRaw=await optional(historyFile);
    const originalHistory=historyRaw?JSON.parse(historyRaw):await history(client,input.caseId);
    if(!historyRaw)await saveArtifact('original-history-before-agent.json',originalHistory);
    const intentFile=join(output,'original-receiving-request.json');
    let intent=await optional(intentFile);
    let previewFilePages=0,previewRowPages=0,previewSnapshot=null;
    if(!intent) {
      const selected={workspace:alias,caseId:input.caseId,expectedVersion:current.program.version,
        input:{hostInput:'handoff'},expectedInputSha256:input.sourceSha256,filename:basename(input.originalHandoffPath)};
      previewSnapshot=await provider.call('merchant_grant_buyer_preview',selected);
      const complete=await receiveFile(provider,alias,previewSnapshot,join(output,'original-mcp-preview.json'));
      artifacts.push(complete.file);previewFilePages=complete.pages;
      const preview=JSON.parse(complete.bytes);
      const typed=await client.buyerPreview(input.caseId,current.program.version,handoff,selected.filename);
      need(typed.value.previewSha256===preview.previewSha256&&preview.source.sha256===input.sourceSha256,
        'The typed client and MCP provider must preview the same complete original source.');
      const rowResult=await rows(provider,alias,previewSnapshot,'/rows');previewRowPages=rowResult.pages;
      need(canonical(rowResult.rows)===canonical(preview.rows),'Complete MCP rows differ from the original native preview.');
      const matched=preview.rows.filter(row=>row.suggestedPurchaseId===input.purchaseId||
        (row.matches??[]).some(item=>item.id===input.purchaseId));
      need(matched.length===1&&!matched[0].identityConflicts?.length&&matched[0].receiving!=='CONFLICT',
        'Review the selected original Inbox identity before receiving.');
      need(matched[0].suggestedPurchaseId===input.purchaseId||
        (matched[0].matches??[]).some(row=>(typeof row==='string'?row:row.id??row.purchaseId)===input.purchaseId),
        'The original handoff does not identify the selected existing purchase.');
      const body={expectedVersion:current.program.version,requestId:input.operationId+'.buyer-receive',
        actor:input.actor,note:'Receive the same retained original buyer observation through its agent interface.',
        filename:selected.filename,expectedPreviewSha256:preview.previewSha256,deploymentId:input.deploymentId,
        selections:[{jobId:matched[0].jobId,purchaseId:input.purchaseId}]};
      const request={schema:'sf47.native-buyer-agent-request.v1',inputSha256:digest(json(input)),
        caseId:input.caseId,sourceSha256:input.sourceSha256,body};
      await saveArtifact('preview-receiving.json',{snapshot:previewSnapshot,previewFilePages,previewRowPages},false);
      await saveArtifact('original-receiving-request.json',request);intent=json(request);
    }
    const request=JSON.parse(intent);
    need(request.inputSha256===digest(json(input))&&request.caseId===input.caseId&&request.sourceSha256===input.sourceSha256,
      'Continue the exact original saved receiving request.');
    const receiptSnapshot=await provider.call('merchant_grant_buyer_receive',{workspace:alias,caseId:input.caseId,
      input:{hostInput:'handoff'},expectedInputSha256:input.sourceSha256,...request.body});
    const receiptFile=await receiveFile(provider,alias,receiptSnapshot,join(output,'original-native-receipt.json'));
    artifacts.push(receiptFile.file);const receipt=JSON.parse(receiptFile.bytes);
    need(receipt.kind==='buyerReceiving'&&receipt.unchanged===true,
      'The already-received original source must return its original association without another case version.');
    const replay=await client.buyerReceive(input.caseId,handoff,request.body);
    need(canonical(replay.value)===canonical(receipt),'The typed same-request recovery differs from the original native result.');
    await saveArtifact('original-typed-replay.json',replay.value);
    const after=(await client.read('case',{caseId:input.caseId})).value;
    need(canonical(selection(after))===canonical(selection(baseline)),'Receiving an attached historical source changed the current original case.');
    need(canonical(await history(client,input.caseId))===canonical(originalHistory),'The repeated source changed the original case history.');
    if(input.cohort) {
      const selected=input.cohort;
      need(selected.request?.action==='cohort.prepare'&&selected.receipt?.recordId===selected.reviewId,
        'Use the original browser cohort request and exact committed review.');
      const review=(await client.read('review',{caseId:input.caseId,reviewId:selected.reviewId})).value;
      need(review.purpose==='COHORT_EVALUATION'&&review.cohort.previewSha256===selected.request.data.expectedPreviewSha256,
        'The original cohort preparation and reviewed source differ.');
      const seededSnapshot=await provider.call('merchant_grant_cohort_seed',{workspace:alias,caseId:input.caseId,
        expectedVersion:after.program.version,tranche:review.cohort.inputs.tranche});
      const seed=await receiveFile(provider,alias,seededSnapshot,join(output,'original-cohort-seed.json'));artifacts.push(seed.file);
      const previewSnapshot=await provider.call('merchant_grant_cohort_preview',{workspace:alias,caseId:input.caseId,
        expectedVersion:after.program.version,inputs:review.cohort.inputs});
      const previewFile=await receiveFile(provider,alias,previewSnapshot,join(output,'original-cohort-agent-preview.json'));
      artifacts.push(previewFile.file);const measured=JSON.parse(previewFile.bytes);
      const typedPreview=await client.cohortPreview(input.caseId,after.program.version,review.cohort.inputs);
      need(canonical(typedPreview.value)===canonical(measured)&&
        measured.source.measurementSha256===review.cohort.source.measurementSha256,
        'The original typed and MCP cohort readers disagree about the retained source.');
      const {action,data,...envelope}=selected.request,body={...envelope,inputs:data.inputs,expectedPreviewSha256:data.expectedPreviewSha256};
      const replaySnapshot=await provider.call('merchant_grant_cohort_prepare',{workspace:alias,caseId:input.caseId,...body});
      const replayFile=await receiveFile(provider,alias,replaySnapshot,join(output,'original-cohort-prepare-replay.json'));artifacts.push(replayFile.file);
      const typedReplay=await client.cohortPrepare(input.caseId,body);
      need(canonical(JSON.parse(replayFile.bytes))===canonical(selected.receipt)&&
        canonical(typedReplay.value)===canonical(selected.receipt),'The original cohort request did not replay its first committed result.');
      const observedRows=await rows(provider,alias,previewSnapshot,'/observations');
      need(canonical(observedRows.rows)===canonical(measured.observations),'The original cohort evidence rows were truncated.');
      const cohortSnapshot=await provider.call('merchant_grant_export',{workspace:alias,kind:'cohort',caseId:input.caseId,reviewId:selected.reviewId});
      const cohortBundle=await receiveFile(provider,alias,cohortSnapshot,join(output,'Original_Cohort_Agent_Evidence.zip'));artifacts.push(cohortBundle.file);
      const typedBundle=await client.download('cohort',{caseId:input.caseId,reviewId:selected.reviewId});
      need(typedBundle.bytes.equals(cohortBundle.bytes)&&cohortBundle.file.sha256===selected.bundle.sha256,
        'The original browser, typed client and MCP cohort downloads differ.');
      const latest=(await client.read('case',{caseId:input.caseId})).value;
      need(canonical(selection(latest))===canonical(selection(after))&&canonical(await history(client,input.caseId))===canonical(originalHistory),
        'Replaying the original cohort altered the retained operating case or history.');
      cohortResult={reviewId:selected.reviewId,requestId:selected.request.requestId,caseVersion:latest.program.version,
        previewSha256:measured.previewSha256,measurementSha256:measured.source.measurementSha256,
        observations:observedRows.count,observationPages:observedRows.pages,completeExportPages:cohortBundle.pages,
        bundle:cohortBundle.file,originalPrepareReplayed:true};
    }
    const source=after.sources.find(row=>row.buyerHandoff?.sourceSha256===input.sourceSha256);
    need(source,'The original received source association is missing.');
    const sourceSnapshot=await provider.call('merchant_grant_export',{workspace:alias,kind:'source',caseId:input.caseId,sourceId:source.id});
    const sourceFile=await receiveFile(provider,alias,sourceSnapshot,join(output,'original-buyer-source.json'));
    artifacts.push(sourceFile.file);need(sourceFile.bytes.equals(handoff),'The original source bytes changed through the agent receiver.');
    const caseSnapshot=await provider.call('merchant_grant_case',{workspace:alias,caseId:input.caseId});
    const caseFile=await receiveFile(provider,alias,caseSnapshot,join(output,'complete-case-after-agent.json'));
    artifacts.push(caseFile.file);
    const purchases=await rows(provider,alias,caseSnapshot,'/records/purchases');
    need(canonical(purchases.rows)===canonical(after.records.purchases),'The paged original purchase records differ.');
    const bundleSnapshot=await provider.call('merchant_grant_export',{workspace:alias,kind:'case',caseId:input.caseId});
    const bundle=await receiveFile(provider,alias,bundleSnapshot,join(output,'Original_Buyer_Agent_Complete_Case.zip'));
    artifacts.push(bundle.file);
    await closeOriginal();
    const reopenedService=await openOriginal();
    const reopened=(await client.read('case',{caseId:input.caseId})).value;
    need(canonical(selection(reopened))===canonical(selection(after)),'The original case changed when its managed service reopened.');
    const oldSnapshot=await receiveFile(provider,alias,sourceSnapshot,join(output,'original-buyer-source.json'));
    need(oldSnapshot.bytes.equals(handoff),'The retained original MCP snapshot changed across service restart.');
    await closeOriginal();
    const previewReceipt=JSON.parse(await regular(join(output,'preview-receiving.json')));
    const retainedArtifacts=[...new Map(artifacts.map(row=>[row.path,row])).values()];
    for(const name of ['original-case-before-agent.json','original-history-before-agent.json','original-receiving-request.json',
      'preview-receiving.json','original-mcp-preview.json']) {
      const path=join(output,name),bytes=await regular(path);
      if(!retainedArtifacts.some(row=>row.path===path))retainedArtifacts.push({path,bytes:bytes.length,sha256:digest(bytes)});
    }
    result={schema:'sf47.native-buyer-agent-result.v1',complete:true,completedAt:new Date().toISOString(),
      operationId:input.operationId,inputSha256:digest(json(input)),sourceHead:input.sourceHead,sourceFiles,
      caseId:input.caseId,caseVersion:after.program.version,purchaseId:input.purchaseId,deploymentId:input.deploymentId,
      originalSourceId:source.id,originalSourceSha256:input.sourceSha256,originalSourceBytes:handoff.length,
      requestId:request.body.requestId,receipt,cohort:cohortResult,toolCount:runtime.grantWorkspaceTools.length,
      previewFilePages:previewReceipt.previewFilePages,previewRowPages:previewReceipt.previewRowPages,
      purchaseRowPages:purchases.pages,purchaseCount:purchases.count,completeExportPages:bundle.pages,
      managedServices:[firstService,reopenedService],bundle:bundle.file,artifacts:retainedArtifacts,
      allOwnedServicesClosed:true,resultFile:join(output,'NATIVE_BUYER_AGENT_RESULT.json')};
    await retain(join(output,'NATIVE_BUYER_AGENT_RESULT.json'),result);
    return result;
  } catch(error) {
    phaseError=error;
    await retain(join(output,'LAST_NATIVE_FAILURE.json'),{at:new Date().toISOString(),
      operationId:input.operationId,code:error.code??null,message:error.message,
      requestRetained:Boolean(await optional(join(output,'original-receiving-request.json')))}).catch(()=>{});
    throw error;
  } finally {
    if(client)try{await client.close();}catch(error){shutdownErrors.push({owner:'borrowed-client',code:error.code??null,message:error.message});}
    if(provider)try{await provider.close();}catch(error){shutdownErrors.push({owner:'original-provider',code:error.code??null,message:error.message});}
    if(originalNode===undefined)delete process.env.SF47_BUYER_NODE;else process.env.SF47_BUYER_NODE=originalNode;
    if(shutdownErrors.length) {
      await retain(join(output,'SHUTDOWN_ERRORS.json'),shutdownErrors).catch(()=>{});
      if(!phaseError)throw Object.assign(new Error('Close the same original managed service before continuing the browser.'),{shutdownErrors});
    }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  need(process.argv.length===3,'Use node buyer-agent-receiving.mjs PRIVATE_PHASE_INPUT.json');
  receiveBuyerWithAgent(JSON.parse(await regular(resolve(process.argv[2])))).then(
    value=>process.stdout.write(JSON.stringify({complete:value.complete,caseId:value.caseId,caseVersion:value.caseVersion,
      sourceSha256:value.originalSourceSha256,result:value.resultFile})+'\n'),
    error=>{process.stderr.write(JSON.stringify({code:error.code??null,message:error.message})+'\n');process.exitCode=1;});
}
