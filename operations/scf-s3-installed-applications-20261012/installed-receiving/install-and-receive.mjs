// MIT. Continue one published S3 Applications receiving through the original offline installer.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, open, mkdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareRuntimeInstall, recoverRuntime, inspectRuntimeInstall, installRuntime } from './bootstrap/runtime-install.mjs';
import { describeRuntimeLock } from './bootstrap/runtime-transfer-lock.mjs';

const encode=value=>JSON.stringify(value,null,2)+'\n';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
import { writeNew, atomicJson as atomic } from '../retained-files.mjs';
async function command(argv,{log,env={}}={}){
  const file=await open(log,'a',0o600);
  try{
    return await new Promise((resolvePromise,reject)=>{
      const child=spawn(argv[0],argv.slice(1),{stdio:['ignore',file.fd,file.fd],env:{...process.env,...env}});
      child.once('error',reject);child.once('exit',(code,signal)=>resolvePromise({code,signal}));
    });
  }finally{await file.sync();await file.close();}
}
export async function installAndReceive(config){
  assert.equal(config.schema,'stellar-forge.s3-installed-receiving-input.v1');
  for(const key of ['root','archive','publicTransferDirectory','awsLock','awsCache','fixtureModule','playwrightPackage','chromiumExecutable'])
    assert.equal(resolve(config[key]),config[key],'Use an absolute '+key);
  assert.match(config.operationId,/^[a-z0-9][a-z0-9._-]{1,127}$/);
  assert.match(config.expectedSourceCommit,/^[0-9a-f]{40}$/);
  assert.match(config.expectedManifest,/^[0-9a-f]{64}$/);
  assert.match(config.archiveSha256,/^[0-9a-f]{64}$/);
  const root=config.root;
  await mkdir(root,{recursive:true,mode:0o700});
  assert.equal(await realpath(root),root);
  await writeNew(join(root,'original-input.json'),encode(config));
  const journalPath=join(root,'installed-receiving.json');
  const prior=await exists(journalPath)?await read(journalPath):null;
  if(prior?.state==='COMPLETE'){
    assert.equal(prior.operationId,config.operationId);
    assert.equal(prior.inputSha256,sha(encode(config)));
    const resultPath=join(root,'merchant-reception','managed-s3-reception.json');
    assert.equal(prior.receiving?.state,'COMPLETE');assert.equal(prior.receiving?.result,resultPath);
    const retained=await readFile(resultPath);
    assert.equal(sha(retained),prior.receiving.resultSha256,'The original customer result changed');
    const customer=JSON.parse(retained);
    assert.equal(customer.state,'COMPLETE');assert.equal(customer.operationId,config.operationId);
    const actual=await inspectRuntimeInstall({directory:prior.runtimeDirectory,load:true,source:true,python:config.python??'python3'});
    assert.equal(actual.ready,true);assert.equal(actual.sourceCommit,config.expectedSourceCommit);
    return prior;
  }
  if(prior)await writeNew(join(root,'attempt-'+prior.attemptId+'.json'),encode(prior));
  const journal={schema:'stellar-forge.s3-installed-receiving.v1',operationId:config.operationId,
    attemptId:randomUUID(),previousAttemptId:prior?.attemptId??null,state:'RUNNING',
    startedAt:new Date().toISOString(),inputSha256:sha(encode(config)),
    runtimeGeneration:prior?.runtimeGeneration??0,runtimeDirectory:prior?.runtimeDirectory??join(root,'runtime-0'),
    steps:[],originalSource:{archive:config.archive,sha256:config.archiveSha256,
      sourceCommit:config.expectedSourceCommit,manifestSha256:config.expectedManifest}};
  const record=async(phase,detail={})=>{
    journal.phase=phase;journal.steps.push({phase,at:new Date().toISOString(),...detail});
    await atomic(journalPath,journal);process.stdout.write(encode({phase,state:journal.state,...detail}));
  };
  try{
    const archive=await readFile(config.archive);
    assert.equal(sha(archive),config.archiveSha256,'Original public source archive changed');
    await record('selected-original-source',{bytes:archive.length,sha256:config.archiveSha256});
    let runtimeDirectory=journal.runtimeDirectory;
    if(!await exists(runtimeDirectory)){
      await record('preparing-original-runtime',{runtimeDirectory});
      await prepareRuntimeInstall({directory:runtimeDirectory,archive:config.archive,sha256:config.archiveSha256,
        native:true,features:['s3'],operator:true,pins:{'@stellar/stellar-sdk':'16.3.0'},python:config.python??'python3'});
    }else if(!await exists(join(runtimeDirectory,'runtime-install.json'))){
      const previousDirectory=runtimeDirectory;
      journal.runtimeGeneration+=1;runtimeDirectory=join(root,'runtime-'+journal.runtimeGeneration);
      assert.equal(await exists(runtimeDirectory),false,'A recovery target already exists; inspect its retained original journal');
      journal.runtimeDirectory=runtimeDirectory;
      await record('recovering-original-preparation',{previousDirectory,runtimeDirectory});
      await recoverRuntime({from:previousDirectory,directory:runtimeDirectory,install:false,python:config.python??'python3'});
    }
    const prepared=await inspectRuntimeInstall({directory:runtimeDirectory,load:false,source:true,python:config.python??'python3'});
    assert.equal(prepared.sourceCommit,config.expectedSourceCommit);
    const plan=await read(join(runtimeDirectory,'runtime-install.json'));
    assert.equal(plan.source.manifestSha256,config.expectedManifest);
    const profile=await read(join(runtimeDirectory,'runtime-profile.json'));
    assert.equal(profile.selection.native,true);assert.deepEqual(profile.selection.features,['s3']);
    assert.equal(profile.selection.operator,true);
    await record('original-runtime-prepared',{runtimeDirectory,installationId:prepared.installationId,
      profileId:prepared.profileId,sourceCommit:prepared.sourceCommit,manifestSha256:config.expectedManifest});
    const offlineDirectory=join(root,'offline-'+journal.runtimeGeneration);
    const offlineInput={schema:'stellar-forge.s3-original-offline-input.v1',operationId:config.operationId,
      publicTransferDirectory:config.publicTransferDirectory,directory:offlineDirectory,
      awsLock:config.awsLock,awsCache:config.awsCache,packageJson:join(runtimeDirectory,'package.json'),npm:config.npm??'npm'};
    const offlineInputPath=join(root,'offline-input-'+journal.runtimeGeneration+'.json');
    await writeNew(offlineInputPath,encode(offlineInput));
    const code=await command([config.python??'python3','-B',new URL('./receive-original-offline-inputs.py',import.meta.url).pathname,offlineInputPath],
      {log:join(root,'offline-'+journal.runtimeGeneration+'.log'),env:{PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(code.code,0,'Original offline dependency intake failed; inspect its retained log');
    const intake=await read(join(offlineDirectory,'result.json'));
    const lockBytes=await readFile(intake.lockPath),packageJson=await read(join(runtimeDirectory,'package.json'));
    assert.equal(sha(lockBytes),intake.lockSha256);
    const lock=JSON.parse(lockBytes),inventory=describeRuntimeLock(lock,packageJson);
    assert.equal(inventory.supported,true,JSON.stringify(inventory.problems));
    const runtimeLock=join(runtimeDirectory,'package-lock.json');
    if(prepared.status!=='READY')await writeNew(runtimeLock,lockBytes);
    await record('original-offline-graph',{lockSha256:intake.lockSha256,
      selectedPackageLocations:inventory.packageLocations,selectedArchives:inventory.publicArtifacts,
      cache:intake.cache,originalCachePlan:intake.originalCachePlan});
    const ready=await installRuntime({directory:runtimeDirectory,offline:true,cache:intake.cache,npm:config.npm??'npm'});
    assert.equal(ready.status,'READY');assert.equal(ready.ready,true);
    const actual=await inspectRuntimeInstall({directory:runtimeDirectory,load:true,source:true,python:config.python??'python3'});
    assert.equal(actual.ready,true);assert.equal(actual.sourceCommit,config.expectedSourceCommit);
    await record('original-installer-ready',{runtimeDirectory,installationId:actual.installationId,
      profileId:actual.profileId,sourceCommit:actual.sourceCommit,lockSha256:actual.lockSha256,sourceVerified:actual.sourceVerified});
    const receivingInput={schema:'stellar-forge.s3-managed-reception-input.v1',operationId:config.operationId,
      runtimeDirectory,sourceRoot:actual.sourceRoot,receptionDirectory:join(root,'merchant-reception'),
      fixtureModule:config.fixtureModule,playwrightPackage:config.playwrightPackage,
      chromiumExecutable:config.chromiumExecutable,expectedSourceCommit:config.expectedSourceCommit,
      expectedManifest:config.expectedManifest};
    await writeNew(join(root,'merchant-receiving-input.json'),encode(receivingInput));
    const {receiveS3MerchantApplication}=await import(new URL('../receive-s3-merchant-application.mjs',import.meta.url).href);
    const received=await receiveS3MerchantApplication(receivingInput);
    assert.equal(received.state,'COMPLETE');
    journal.receiving={state:received.state,operationId:received.operationId,
      result:join(root,'merchant-reception','managed-s3-reception.json'),
      resultSha256:sha(await readFile(join(root,'merchant-reception','managed-s3-reception.json')))};
    journal.state='COMPLETE';journal.completedAt=new Date().toISOString();
    await record('installed-customer-receiving-complete',journal.receiving);
    return journal;
  }catch(error){
    journal.state='FAILED';journal.failedAt=new Date().toISOString();
    journal.error={code:error.code??error.name,message:error.message};
    await atomic(journalPath,journal).catch(()=>{});
    throw error;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const result=await installAndReceive(await read(resolve(process.argv[2])));
  process.stdout.write(encode({state:result.state,result:join(result.runtimeDirectory,'..','installed-receiving.json')}));
}
