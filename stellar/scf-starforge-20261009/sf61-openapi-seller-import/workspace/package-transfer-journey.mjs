#!/usr/bin/env node
// MIT. One original authoring -> retained export -> receiving -> native release journey.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, rename, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './server.mjs';
import { readPackage, privateParent } from './model.mjs';
import { PACKAGE_EXPORT_MANIFEST, parseMerchantPackageExport } from './package-transfer.mjs';
import { initializeOpenApiWorkspaceMerchant } from '../../../../stellar-forge/mcp-merchant-operator/config.mjs';
import { startMerchantMcp } from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { openMerchantFileClient } from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { downloadOpenApiPackage, reopenOpenApiPackageDownload } from '../../../../stellar-forge/mcp-merchant-operator/openapi-workspace-client.mjs';

const OPERATION='ASTRA-D76C-SCF-PACKAGE-TRANSFER-20261012';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const retained=['ttlMs','maxEntries','maxBytes','maxEntryBytes'];
const retention=value=>Object.fromEntries(retained.map(key=>[key,value[key]]));
const file=async(path,content)=>writeFile(path,content,{flag:'wx',mode:0o600});
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const privateDirectory=async path=>{await mkdir(path,{mode:0o700});return path;};

export async function runPackageTransferJourney({parent,initialPackage,policyPackage}={}) {
  await privateParent(parent);
  const inputInitial=await readPackage(dirname(resolve(initialPackage)),basename(initialPackage));
  const inputPolicy=await readPackage(dirname(resolve(policyPackage)),basename(policyPackage));
  assert.ok(inputPolicy.sourceRevision?.operatingDecision,'Choose the actual retained policy package from the original native journey');
  const root=await mkdtemp(join(resolve(parent),'sf61-package-transfer-'));
  const senderRoot=await privateDirectory(join(root,'sender'));
  const receiverRoot=await privateDirectory(join(root,'receiver'));
  const hostFiles=await privateDirectory(join(root,'host-files'));
  const receivingParent=await privateDirectory(join(root,'downloads'));
  const downloadDirectory=join(receivingParent,'policy-package');
  const initialName=inputInitial.name,policyName=inputPolicy.name;
  assert.notEqual(initialName,policyName);
  await cp(inputInitial.folder,join(senderRoot,initialName),{recursive:true,force:false,errorOnExist:true});
  await cp(inputPolicy.folder,join(senderRoot,policyName),{recursive:true,force:false,errorOnExist:true});
  const originalReviews=join(dirname(inputPolicy.folder),'.cache-policy-reviews');
  if(await exists(originalReviews))await cp(originalReviews,join(senderRoot,'.cache-policy-reviews'),{recursive:true,force:false,errorOnExist:true});
  // Real package selection must remain complete beyond the legacy 200-directory prefix.
  for(let i=0;i<205;i++)await privateDirectory(join(senderRoot,'a-noise-'+String(i).padStart(3,'0')));
  await privateDirectory(join(senderRoot,'broken-package'));
  await file(join(senderRoot,'broken-package','keep.txt'),'An existing directory remains owned by its original contents.\n');
  const changedSource=JSON.parse(inputInitial.specText);
  changedSource.info.description='Native receiving journey: retained forecast contract documentation.';
  const changedText=json(changedSource);
  await file(join(hostFiles,'source.json'),inputInitial.specText);
  await file(join(hostFiles,'plan.json'),json(inputInitial.plan));
  await file(join(hostFiles,'changed-source.json'),changedText);
  const senderUrl=join(hostFiles,'sender-url.txt'),receiverUrl=join(hostFiles,'receiver-url.txt');
  const connection=join(hostFiles,'sf61-connection.json');
  const report={schema:'stellar-forge.package-transfer-native-journey.v1',operation:OPERATION,
    startedAt:new Date().toISOString(),node:process.version,root,steps:[],source:{},
    input:{initial:{name:initialName,id:inputInitial.manifest.id},policy:{name:policyName,id:inputPolicy.manifest.id,
      sourceRevisionSha256:inputPolicy.manifest.files['source-revision.json']}}};
  const sourceFiles=['model.mjs','package-transfer.mjs','package-transfer-http.mjs','server.mjs',
    'revisions.mjs','cache-policy-revisions.mjs','package-transfer-journey.mjs',
    '../../sf82-seller-pilot/releases.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/config.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/operator.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/serve.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/sf61-connection.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/openapi-workspace.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/openapi-workspace-client.mjs',
    '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs'];
  for(const path of sourceFiles)report.source[path]=sha(await readFile(new URL(path,import.meta.url)));
  const step=(name,details={})=>report.steps.push({name,completedAt:new Date().toISOString(),...details});
  const environment={...process.env,SF61_TRANSFER_MCP_TOKEN:randomBytes(32).toString('hex'),
    MCP_OAUTH_CONFIG:undefined,MCP_CLIENT_ORIGINS:''};
  let sender,receiver,mcp,client,configuration,mcpPort=0;
  const closeMcp=async()=>{
    if(mcp){const current=mcp;mcp=null;client=null;await current.close();}
  };
  const closeHosts=async()=>{
    const sessions=[sender,receiver].filter(Boolean);sender=null;receiver=null;
    const results=await Promise.allSettled(sessions.map(session=>session.close()));
    const errors=results.filter(value=>value.status==='rejected').map(value=>value.reason);
    if(errors.length)throw new AggregateError(errors,'Original SF61 hosts did not finish closing');
  };
  const openSender=async()=>{
    sender=await startWorkspace({parent:senderRoot,port:0,noSignals:true});
    await writeFile(senderUrl,sender.url+'\n',{mode:0o600});
  };
  const openReceiver=async()=>{
    receiver=await startWorkspace({parent:receiverRoot,port:0,noSignals:true});
    await writeFile(receiverUrl,receiver.url+'\n',{mode:0o600});
  };
  const openMcp=async()=>{
    mcp=await startMerchantMcp({configPath:configuration,port:mcpPort,
      tokenEnv:'SF61_TRANSFER_MCP_TOKEN',environment});
    mcpPort=Number(new URL(mcp.url).port);
    client=await openMerchantFileClient({url:mcp.url,tokenEnv:'SF61_TRANSFER_MCP_TOKEN',
      environment,errorPrefix:'OPENAPI',clientName:'sf61-native-package-transfer-journey'});
  };
  const call=(name,args)=>client.call('merchant_openapi_'+name,args);
  const native=async(name,args)=>(await call(name,args)).native;
  const api=async(session,path,body,status=200)=>{
    const response=await fetch(session.origin+path,{method:body===undefined?'GET':'POST',
      headers:{'x-workspace-token':session.token,Origin:session.origin,
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
    const value=await response.json();
    assert.equal(response.status,status,path+': '+JSON.stringify(value).slice(0,1500));
    return value;
  };
  try {
    await openSender();await openReceiver();
    await file(connection,json({schema:'stellar-forge.sf61-workspace-connection.v1',workspaces:{
      sender:{label:'Original API sender',consoleUrlFile:senderUrl,files:{
        source:{kind:'source',path:join(hostFiles,'source.json'),sha256:sha(inputInitial.specText)},
        plan:{kind:'plan',path:join(hostFiles,'plan.json'),sha256:sha(json(inputInitial.plan))},
        changed:{kind:'source',path:join(hostFiles,'changed-source.json'),sha256:sha(changedText)}
      }},
      receiver:{label:'Original API receiver',consoleUrlFile:receiverUrl,
        deliveries:{policy:{directory:downloadDirectory}}}
    }}));
    const initialized=await initializeOpenApiWorkspaceMerchant({directory:join(root,'merchant-mcp'),connection,
      name:'Original API native receiving journey'});
    configuration=initialized.configuration;
    await openMcp();
    const workspaces=await call('workspaces',{});
    assert.deepEqual(workspaces.workspaces.map(value=>value.workspace).sort(),['receiver','sender']);
    const found=[];let after;
    do {
      const page=await native('packages',{workspace:'sender',limit:1,...(after?{after}:{})});
      found.push(...page.packages.map(value=>value.name));after=page.nextCursor;
      assert.equal(page.complete,after===null);
    } while(after);
    assert.deepEqual(found.sort(),[initialName,policyName].sort());
    await api(sender,'/api/package-transfer/inspect?name=absent-package',undefined,404);
    await api(sender,'/api/package-transfer/inspect?name=broken-package',undefined,409);
    step('complete-original-inventory',{packages:found,unrelatedDirectories:205});

    const author={workspace:'sender',specFile:'source',planFile:'plan',expectedSourceSha256:sha(inputInitial.specText)};
    const inspected=await native('inspect',{workspace:'sender',specFile:'source'});
    assert.equal(inspected.sourceSha256,sha(inputInitial.specText));
    const preview=await native('preview',author);
    assert.equal(preview.routes.length,inputInitial.plan.operations.length);
    const authoredName='zz-api-authored';
    const saved=await native('save',{...author,name:authoredName});
    assert.equal(saved.recovered,false);
    const recovered=await native('save',{...author,name:authoredName});
    assert.equal(recovered.recovered,true);
    assert.equal(recovered.package.manifest.id,saved.package.manifest.id);
    const loaded=await native('load',{workspace:'sender',name:authoredName,includeSource:true});
    assert.equal(loaded.source.text,inputInitial.specText);
    assert.deepEqual(loaded.plan,inputInitial.plan);
    step('generic-source-inspect-preview-save-and-recover',{packageId:saved.package.manifest.id,
      sourceSha256:loaded.source.sha256,recovered:recovered.recovered});

    const decisions=inputInitial.plan.operations.map(row=>({routeId:row.id,action:'keep'}));
    const revisionInput={workspace:'sender',baseName:authoredName,specFile:'changed',
      expectedSourceSha256:sha(changedText),decisions};
    const review=await native('revision_review',revisionInput);
    assert.equal(review.ready,true);assert.equal(review.sourceChanged,true);
    const draftName='zz-contract-review';
    await native('revision_draft',{...revisionInput,name:draftName});
    const draft=await native('draft_load',{workspace:'sender',name:draftName,includeSource:true});
    assert.equal(draft.source.text,changedText);assert.equal(draft.review.ready,true);
    const revisionName='zz-api-revised';
    const revised=await native('revision_save',{...revisionInput,name:revisionName,
      expectedReviewSha256:review.reviewSha256,expectedRefreshReviewId:review.refreshReviewId});
    const revisionRecovery=await native('revision_save',{...revisionInput,name:revisionName,
      expectedReviewSha256:review.reviewSha256,expectedRefreshReviewId:review.refreshReviewId});
    assert.equal(revisionRecovery.recovered,true);
    await assert.rejects(native('revision_save',{...revisionInput,name:revisionName,
      decisions:decisions.map((row,index)=>index===0?{routeId:row.routeId,action:'drop'}:row),
      expectedReviewSha256:review.reviewSha256,expectedRefreshReviewId:review.refreshReviewId}),
      error=>error.code==='OPENAPI_PACKAGE_CONFLICT');
    const revisedPackage=await readPackage(senderRoot,revisionName);
    assert.equal(revisedPackage.specText,changedText);assert.deepEqual(revisedPackage.plan,inputInitial.plan);
    assert.equal(revisedPackage.sourceRevision.base.id,saved.package.manifest.id);
    step('original-source-revision-draft-save-and-recover',{packageId:revised.package.manifest.id,
      reviewSha256:review.reviewSha256,refreshReviewId:review.refreshReviewId,draft:draftName});

    const policyInspection=await native('package_inspect',{workspace:'sender',name:policyName});
    assert.deepEqual(policyInspection.sourceRevision,inputPolicy.sourceRevision);
    const reviews=await native('policy_reviews',{workspace:'sender',name:initialName});
    const policyReview=reviews.reviews.find(value=>value.name===policyName||value.candidate?.name===policyName);
    assert.ok(policyReview,'The original retained policy review must be present in its sender workspace');
    {
      const shown=await native('policy_show',{workspace:'sender',name:initialName,id:policyReview.id});
      assert.equal(shown.state,'SAVED');assert.equal(shown.saved.manifest.id,inputPolicy.manifest.id);
    }
    const exported=await call('export',{workspace:'sender',name:policyName,
      expectedPackageManifestSha256:policyInspection.manifestSha256});
    assert.equal(exported.state,'EXPORTED');
    const exportRecovery=await call('export',{workspace:'sender',name:policyName});
    assert.equal(exportRecovery.exportId,exported.exportId);assert.equal(exportRecovery.recovered,true);
    const manifest=parseMerchantPackageExport(Buffer.from(json(exported.manifest)),exported.exportId);
    assert.equal(manifest.package.id,inputPolicy.manifest.id);
    assert.ok(manifest.files.some(value=>value.name==='source-revision.json'));
    assert.ok(manifest.files.some(value=>value.name==='compiled/manifest.json'));
    const allowed=new Set(manifest.files.map(value=>value.name));
    assert.equal(allowed.has('compiled/pilot-runtime.json'),false);
    step('retain-complete-original-export',{exportId:exported.exportId,packageId:manifest.package.id,
      manifestSha256:exported.manifestFile.sha256,files:manifest.files.length,bytes:manifest.totalBytes,
      sourceRevisionSha256:manifest.package.sourceRevisionSha256,policyReviewId:policyReview?.id??null});

    let interrupted=false;
    const downloadOptions={url:mcp.url,workspace:'sender',exportId:exported.exportId,
      directory:downloadDirectory,expectedManifestSha256:exported.manifestFile.sha256,
      tokenEnv:'SF61_TRANSFER_MCP_TOKEN',environment,chunkSize:1024};
    await assert.rejects(downloadOpenApiPackage({...downloadOptions,onProgress:value=>{
      if(!interrupted&&value.file==='compiled/offers.json'&&value.bytes<value.total) {
        interrupted=true;throw Object.assign(new Error('Retain this original prefix across restart'),{code:'JOURNEY_DOWNLOAD_INTERRUPTION'});
      }
    }}),error=>error.code==='JOURNEY_DOWNLOAD_INTERRUPTION');
    assert.equal(interrupted,true);
    const checkpoint=JSON.parse(await readFile(join(downloadDirectory,'download-state','checkpoint.json'),'utf8'));
    assert.ok(checkpoint.files['compiled/offers.json'].bytes>0);
    await closeMcp();
    const oldSender=sender;sender=null;await oldSender.close();
    await rename(join(senderRoot,policyName),join(root,'relocated-policy-package'));
    await openSender();await openMcp();
    assert.equal(mcp.url,downloadOptions.url);
    const retainedManifest=await call('manifest',{workspace:'sender',exportId:exported.exportId});
    assert.equal(retainedManifest.manifestFile.sha256,exported.manifestFile.sha256);
    const exports=await call('exports',{workspace:'sender',limit:200});
    assert.ok(exports.exports.some(value=>value.exportId===exported.exportId));
    let resumedChunks=0;
    const complete=await downloadOpenApiPackage({...downloadOptions,onProgress:()=>{resumedChunks++;}});
    assert.equal(complete.state,'COMPLETE');assert.equal(complete.resumed,true);assert.ok(complete.resumedBytes>0);
    const reopened=await reopenOpenApiPackageDownload({directory:downloadDirectory,
      expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(reopened.state,'REOPENED');assert.equal(reopened.package.id,inputPolicy.manifest.id);
    const readStatus=(await call('manifest',{workspace:'sender',exportId:exported.exportId})).fileReads;
    assert.ok(readStatus.originalFileReads<=manifest.files.length+1);
    assert.ok(resumedChunks>readStatus.originalFileReads);
    assert.equal(readStatus.sessions.length,0);
    assert.equal(sha(await readFile(join(downloadDirectory,PACKAGE_EXPORT_MANIFEST))),exported.manifestFile.sha256);
    step('resume-original-nested-download-after-console-and-mcp-restart',{exportId:exported.exportId,
      resumedBytes:complete.resumedBytes,files:complete.files,bytes:complete.bytes,
      originalFileLoads:readStatus.originalFileReads,chunkReads:resumedChunks,receivingDirectory:downloadDirectory});

    // A complete local download is required; changed source bytes never publish a name.
    const downloadedPlan=join(downloadDirectory,'merchant-plan.json'),originalPlan=await readFile(downloadedPlan);
    await writeFile(downloadedPlan,Buffer.concat([originalPlan,Buffer.from('\n')]));
    await assert.rejects(native('receive',{workspace:'receiver',delivery:'policy',name:'changed-input',
      expectedManifestSha256:exported.manifestFile.sha256}));
    assert.equal(await exists(join(receiverRoot,'changed-input')),false);
    await writeFile(downloadedPlan,originalPlan);
    const collision=await privateDirectory(join(receiverRoot,'occupied'));
    const beforeCollision=await lstat(collision);
    await assert.rejects(native('receive',{workspace:'receiver',delivery:'policy',name:'occupied',
      expectedManifestSha256:exported.manifestFile.sha256}));
    const afterCollision=await lstat(collision);
    assert.equal(afterCollision.ino,beforeCollision.ino);assert.deepEqual(await readdir(collision),[]);
    const received=await native('receive',{workspace:'receiver',delivery:'policy',name:policyName,
      expectedManifestSha256:exported.manifestFile.sha256});
    const receiveRecovery=await native('receive',{workspace:'receiver',delivery:'policy',name:policyName,
      expectedManifestSha256:exported.manifestFile.sha256});
    assert.equal(received.recovered,false);assert.equal(receiveRecovery.recovered,true);
    assert.equal(received.package.id,inputPolicy.manifest.id);
    const restored=await readPackage(receiverRoot,policyName);
    assert.deepEqual(restored.manifest,inputPolicy.manifest);
    assert.deepEqual(restored.sourceRevision,inputPolicy.sourceRevision);
    assert.deepEqual(restored.plan,inputPolicy.plan);
    assert.equal(restored.specText,inputPolicy.specText);
    for(const entry of manifest.files)assert.equal(sha(await readFile(join(restored.folder,entry.name))),entry.sha256,entry.name);
    assert.deepEqual((await readdir(join(restored.folder,'compiled'))).sort(),['manifest.json','offers.json','seller-service.json']);
    assert.deepEqual(await readdir(join(restored.folder,'support')),[]);
    step('atomic-original-receiving-and-exact-retry',{packageId:received.package.id,
      manifestSha256:received.package.manifestSha256,recovered:receiveRecovery.recovered,
      sourceRevisionSha256:received.package.sourceRevisionSha256});

    await closeMcp();
    const oldReceiver=receiver;receiver=null;await oldReceiver.close();
    await openReceiver();await openMcp();
    const receivingLoad=await native('load',{workspace:'receiver',name:policyName,includeSource:true});
    assert.deepEqual(receivingLoad.sourceRevision,inputPolicy.sourceRevision);
    assert.deepEqual(receivingLoad.plan,inputPolicy.plan);
    const running=await native('start',{workspace:'receiver',name:policyName});
    assert.equal(running.state,'RUNNING');assert.equal(running.mode,'CHALLENGE_ONLY');
    const history=await native('cache_history',{workspace:'receiver',name:policyName});
    const captured=await native('cache_capture',{workspace:'receiver',name:policyName,expectedRevision:history.revision,
      label:'Received original package policy'});
    const inspection=captured.record.inspection;
    assert.equal(inspection.package.id,inputPolicy.manifest.id);
    for(const row of inputPolicy.plan.operations.filter(row=>row.cache))
      assert.deepEqual(retention(inspection.routes[row.id].limits),retention(row.cache));
    const offer=restored.manifest.preview.routes.find(row=>row.method==='GET');
    const unpaid=await fetch(new URL(new URL(offer.publicUrl).pathname,running.seller),{signal:AbortSignal.timeout(15000)});
    assert.equal(unpaid.status,402);await unpaid.body?.cancel();
    await assert.rejects(native('stop',{workspace:'receiver',runtimeId:randomUUID()}));
    const stillRunning=await native('status',{workspace:'receiver'});
    assert.equal(stillRunning.runtimeId,running.runtimeId);
    await native('stop',{workspace:'receiver',runtimeId:running.runtimeId});
    step('received-native-merchant-challenge-and-policy',{packageId:inspection.package.id,
      runtimeId:running.runtimeId,instanceId:inspection.instanceId,snapshotId:captured.record.id,
      policy:Object.fromEntries(inputPolicy.plan.operations.filter(row=>row.cache).map(row=>[row.id,retention(inspection.routes[row.id].limits)])),
      challengeStatus:unpaid.status});

    const initialStage=await native('stage',{workspace:'sender',name:authoredName,id:'initial-package',
      expectedPackageManifestSha256:saved.package.manifestSha256});
    const policyStage=await native('stage',{workspace:'receiver',name:policyName,id:'received-policy',
      expectedPackageManifestSha256:received.package.manifestSha256});
    assert.equal(initialStage.state,'STAGED');assert.equal(policyStage.state,'STAGED');
    assert.equal(initialStage.record.inputPackage.id,saved.package.manifest.id);
    assert.equal(policyStage.record.inputPackage.id,inputPolicy.manifest.id);
    assert.deepEqual(policyStage.record.inputPackage.sourceRevision,inputPolicy.sourceRevision);
    const originalRelease=await client.call('merchant_inspect',{id:'received-policy'});
    assert.ok(JSON.stringify(originalRelease).includes(inputPolicy.manifest.id));
    const comparison=await client.call('merchant_compare',{from:null,to:'received-policy'});
    assert.equal(comparison.after.digest,originalRelease.digest);
    await client.call('merchant_activate',{id:'received-policy',expectedDigest:originalRelease.digest,
      expectedGeneration:comparison.generation,reason:'Operate the reviewed complete receiving package'});
    const selected=await client.call('merchant_status',{});
    assert.equal(selected.state.active,'received-policy');
    const releaseRuntime=await client.call('merchant_start',{expectedDigest:originalRelease.digest,
      expectedGeneration:selected.state.generation});
    assert.equal(releaseRuntime.runtime.state,'RUNNING');
    assert.equal(releaseRuntime.runtime.observed.releaseId,'received-policy');
    assert.equal(releaseRuntime.runtime.observed.releaseDigest,originalRelease.digest);
    assert.equal(releaseRuntime.runtime.observed.mode,'CHALLENGE_ONLY');
    const releasedUnpaid=await fetch(new URL(new URL(offer.publicUrl).pathname,releaseRuntime.runtime.observed.listener),
      {signal:AbortSignal.timeout(15000)});
    assert.equal(releasedUnpaid.status,402);await releasedUnpaid.body?.cancel();
    const stoppedRelease=await client.call('merchant_stop',{instanceId:releaseRuntime.operator.instanceId});
    assert.equal(stoppedRelease.status.runtime.state,'STOPPED');
    assert.equal(stoppedRelease.status.operator.managesRunningSeller,false);
    assert.equal(stoppedRelease.status.operator.instanceId,null);
    step('original-sf82-stage-activate-start-and-stop',{initialRelease:initialStage.record.id,
      receivedRelease:policyStage.record.id,receivedDigest:policyStage.record.digest,
      packageId:policyStage.record.inputPackage.id,selectionGeneration:selected.state.generation,
      releaseChallengeStatus:releasedUnpaid.status,ownedShutdown:stoppedRelease.status.runtime.state});
    await closeMcp();await closeHosts();
    report.state='PASSED';report.completedAt=new Date().toISOString();
  } catch(error) {
    report.state='FAILED';report.failure={message:error.message,code:error.code,stack:error.stack};
    throw error;
  } finally {
    try{await closeMcp();}finally{
      try{await closeHosts();}finally{await file(join(root,'result.json'),json(report));}
    }
  }
  console.log(JSON.stringify({state:report.state,operation:OPERATION,result:join(root,'result.json'),
    steps:report.steps.length,node:report.node,source:report.source}));
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [parent,initialPackage,policyPackage,...extra]=process.argv.slice(2);
  if(!parent||!initialPackage||!policyPackage||extra.length) {
    console.error('Usage: node workspace/package-transfer-journey.mjs PRIVATE_OUTPUT_PARENT INITIAL_PACKAGE RETAINED_POLICY_PACKAGE');
    process.exitCode=1;
  } else runPackageTransferJourney({parent,initialPackage,policyPackage}).catch(error=>{
    console.error(error.stack??error.message);process.exitCode=1;
  });
}
