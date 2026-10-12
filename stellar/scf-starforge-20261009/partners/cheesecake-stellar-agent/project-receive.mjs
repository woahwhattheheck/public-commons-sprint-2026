// MIT. Verified offline receiving, original-owner restoration and scoped live reattachment.
import { join, dirname, relative } from 'node:path';
import { mkdtemp, mkdir, readdir, rm, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inspectHandoff } from './application.mjs';
import { inspectRemoteMcp,verifyRemoteMcpQuoteBinding } from './remote-mcp.mjs';
import { PROJECT,RECEIVED,need,object,absolute,member,inside,sha,json,checkSignal,exists,privateDirectory,
  readBytes,readJSON,digest,copyFile,publishBytes,ensureParents,syncDirectory,originalModule,
  encrypted,validateCapturedFiles } from './project-files.mjs';

const SF88='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/';
const NATIVE='stellar-forge/mcp-paid-agent/';
const hashPattern=/^[a-f0-9]{64}$/;
function componentOptions(component,directory,options) {
  return {bundle:join(directory,'project',member(component.member)),passphraseEnv:options.passphraseEnv,
    expectedManifestSha256:component.manifestSha256,expectedRecordSha256:component.recordSha256,
    temporaryDirectory:dirname(directory),environment:options.environment??process.env,signal:options.signal};
}
async function copiedHandoff(payload,record,directory) {
  await privateDirectory(directory,{create:true});
  const prefix=record.config.handoffDirectory;
  for(const item of record.files.filter(row=>inside(prefix,row.path))){
    const name=relative(prefix,item.path);member(name);
    const target=join(directory,name);await ensureParents(dirname(target));
    await copyFile(join(payload,item.member),target);
  }
  return inspectHandoff(directory);
}
async function verifyRecord(payload,record,{sourceRoot,environment,passphraseEnv,signal,temporary}) {
  need(object(record)&&record.schema===PROJECT&&object(record.config)&&object(record.application)&&
    record.restoreMode==='ORIGINAL_CANONICAL_PATHS'&&record.walletEnvironmentExported===false&&
    record.config.schema==='stellar-forge.application-config.v1'&&
    Array.isArray(record.references)&&record.references.length<=64&&
    Array.isArray(record.components)&&record.components.length<=2,
    'APPLICATION_PROJECT_RECORD_INVALID');
  absolute(record.configFile);absolute(record.sourceRoot);
  for(const name of ['runtimeDirectory','stateDirectory','handoffDirectory','projectProfile'])
    absolute(record.config[name]);
  need(hashPattern.test(record.configurationSha256)&&hashPattern.test(record.profileSha256)&&
    typeof record.application.subject==='string'&&record.application.subject===record.config.subject&&
    record.application.identity?.applicationId===record.config.applicationId,
    'APPLICATION_PROJECT_IDENTITY_CHANGED');
  await validateCapturedFiles(payload,record,{signal});
  const byPath=new Map(record.files.map(file=>[file.path,file]));
  const configuration=byPath.get(record.configFile),profile=byPath.get(record.profileFile);
  need(configuration?.sha256===record.configurationSha256&&profile?.sha256===record.profileSha256&&
    isDeepStrictEqual(await readJSON(join(payload,configuration.member)),record.config),
    'APPLICATION_PROJECT_CONFIGURATION_CHANGED');
  const handoff=await copiedHandoff(payload,record,join(temporary,'handoff-verified'));
  need(record.application.identity.handoffId===handoff.manifest.handoffId&&
    record.application.identity.manifestSha256===handoff.manifestSha256,'APPLICATION_PROJECT_HANDOFF_CHANGED');
  const selected=new Map([...handoff.requests].map(([id,row])=>[id,row.view]));
  let remote;
  if(record.config.remoteMcp){
    const file=byPath.get(record.config.remoteMcp);need(file,'APPLICATION_PROJECT_REMOTE_SELECTION_MISSING');
    remote=await inspectRemoteMcp(join(payload,file.member),{sourceRoot});
    need(remote.sourceSha256===record.application.identity.remoteMcp?.sourceSha256,
      'APPLICATION_PROJECT_REMOTE_SELECTION_CHANGED');
    for(const [id,row]of remote.requests){need(!selected.has(id),'APPLICATION_PROJECT_IDENTITY_CHANGED');selected.set(id,row.view);}
  }
  need(Array.isArray(record.application.requests)&&record.application.requests.length===selected.size&&
    new Set(record.application.requests.map(row=>row.intentId)).size===selected.size,
    'APPLICATION_PROJECT_REQUESTS_CHANGED');
  for(const key of ['reviews','outcomes','spending','results']){
    need(Array.isArray(record.application[key])&&record.application[key].length<=selected.size&&
      new Set(record.application[key].map(row=>row.intentId)).size===record.application[key].length&&
      record.application[key].every(row=>selected.has(row.intentId)),'APPLICATION_PROJECT_VIEW_INVALID');
  }
  const reviews=new Map(record.application.reviews.map(row=>[row.intentId,row.value]));
  for(const request of record.application.requests){
    let original=selected.get(request.intentId);need(original,'APPLICATION_PROJECT_REQUESTS_CHANGED');
    const entry=remote?.requests.get(request.intentId);
    if(entry){
      const retained=byPath.get(join(record.config.stateDirectory,'remote-mcp',
        sha(Buffer.from(request.intentId))+'.json')),review=reviews.get(request.intentId);
      if(review){
        need(retained&&review.review?.native?.mode==='remote-mcp'&&object(review.review.native.quote),
          'APPLICATION_PROJECT_REMOTE_QUOTE_REQUIRED');
        const nativeRecord=await readJSON(join(payload,retained.member),256*1024,true);
        need(nativeRecord.subject===record.application.subject,'APPLICATION_PROJECT_REMOTE_SUBJECT_CHANGED');
        const quote=verifyRemoteMcpQuoteBinding({applicationId:record.config.applicationId,
          sourceSha256:remote.sourceSha256,entry,record:nativeRecord,quote:review.review.native.quote,mcpJson:remote.mcpJson});
        need(hashPattern.test(quote.invocation.inputSchemaSha256)&&
          review.binding?.intentId===request.intentId&&review.binding.quoteId===nativeRecord.quoteId&&
          review.binding.configSha256===entry.view.configSha256&&
          review.binding.bodySha256===entry.view.bodySha256&&
          review.binding.ticketSha256===nativeRecord.ticketSha256,
          'APPLICATION_PROJECT_REMOTE_QUOTE_CHANGED');
        // A selected schema may be learned from discovery. The retained original
        // quote binds that hash to this UUID, invocation and complete payment terms.
        original={...original,inputSchemaSha256:quote.invocation.inputSchemaSha256};
        for(const [key,value]of Object.entries(original))
          need(isDeepStrictEqual(review.request?.[key],value),'APPLICATION_PROJECT_REMOTE_REVIEW_CHANGED');
      }else need(!retained&&request.state?.state==='AVAILABLE','APPLICATION_PROJECT_REMOTE_QUOTE_REQUIRED');
    }
    for(const [key,value]of Object.entries(original))need(isDeepStrictEqual(request[key],value),
      'APPLICATION_PROJECT_REQUESTS_CHANGED');
  }
  for(const result of record.application.results){
    need(/^results\/[a-f0-9]{64}\.response$/.test(result.member)&&
      result.member==='results/'+sha(Buffer.from(result.intentId))+'.response'&&
      result.artifact?.result?.file?.sha256===result.sha256&&result.artifact.result.file.bytes===result.bytes&&
      result.bytes>=0&&result.bytes<=2097152,'APPLICATION_PROJECT_RESULT_CHANGED');
    const identity=await digest(join(payload,result.member),{privateOnly:true,signal});
    need(identity.bytes===result.bytes&&identity.sha256===result.sha256,'APPLICATION_PROJECT_RESULT_CHANGED');
  }
  const kinds=new Set(),verified=[];
  for(const component of record.components){
    need(['http','mcp'].includes(component.kind)&&!kinds.has(component.kind)&&
      component.member==='components/'+component.kind&&hashPattern.test(component.manifestSha256)&&
      hashPattern.test(component.recordSha256),'APPLICATION_PROJECT_COMPONENT_INVALID');
    kinds.add(component.kind);
    const bundle=join(payload,component.member),actual=await digest(join(bundle,'manifest.json'),{privateOnly:true,signal});
    need(actual.sha256===component.manifestSha256,'APPLICATION_PROJECT_COMPONENT_CHANGED');
    if(component.kind==='mcp'){
      const native=await originalModule(sourceRoot,NATIVE+'native-spend-recovery.mjs');
      const value=await native.verifyNativeMcpSpendingRecovery({bundle,passphraseEnv,
        expectedManifestSha256:component.manifestSha256,expectedRecordSha256:component.recordSha256,
        temporaryDirectory:temporary,environment,signal});
      need(isDeepStrictEqual(value.owner,component.owner)&&isDeepStrictEqual(value.checkpoint,component.checkpoint)&&
        (value.ledgerState??'INITIALIZED')===(component.ledgerState??'INITIALIZED'),
        'APPLICATION_PROJECT_COMPONENT_CHANGED');
      verified.push({kind:'mcp',value});
    }else{
      const native=await originalModule(sourceRoot,SF88+'workspace-recovery.mjs');let originalRecord;
      const value=await native.verifyWorkspaceRecovery({bundle,passEnv:passphraseEnv,expected:component.recordSha256},
        {environment,signal,inspectSnapshot:({record:original})=>{originalRecord=original;}});
      need(isDeepStrictEqual(originalRecord.plan,component.plan)&&
        isDeepStrictEqual(value.checkpoint,component.checkpoint),'APPLICATION_PROJECT_COMPONENT_CHANGED');
      verified.push({kind:'http',value,record:originalRecord});
    }
  }
  need(Boolean(record.config.remoteMcp)===kinds.has('mcp')&&(!record.config.operatorProfile||kinds.has('http')),
    'APPLICATION_PROJECT_FINANCIAL_COMPONENT_REQUIRED');
  return {verified};
}
async function openedBundle(options,operation) {
  const {bundle,sourceRoot,passphraseEnv,signal}=options,environment=options.environment??process.env;
  absolute(bundle);absolute(sourceRoot);await privateDirectory(bundle);
  const observed=await digest(join(bundle,'manifest.json'),{privateOnly:true,signal});
  if(options.expectedManifestSha256!==undefined)need(options.expectedManifestSha256===observed.sha256,
    'APPLICATION_PROJECT_SELECTED_MANIFEST_CHANGED');
  const temporary=await mkdtemp(join(options.temporaryDirectory??dirname(bundle),'.project-open-'));
  try{
    const extracted=join(temporary,'contents');
    await encrypted(sourceRoot,'restore',{bundle,output:extracted,passphraseEnv},{environment,signal});
    need((await digest(join(bundle,'manifest.json'),{privateOnly:true,signal})).sha256===observed.sha256,
      'APPLICATION_PROJECT_SELECTED_MANIFEST_CHANGED');
    const payload=join(extracted,'project'),raw=await readBytes(join(payload,'project.json'),16*1024**2,true);
    const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),recordSha256=sha(raw);
    if(options.expectedRecordSha256!==undefined)need(options.expectedRecordSha256===recordSha256,
      'APPLICATION_PROJECT_SELECTED_RECORD_CHANGED');
    const verification=await verifyRecord(payload,record,{sourceRoot,environment,passphraseEnv,signal,temporary});
    return await operation({temporary,extracted,payload,record,recordSha256,manifestSha256:observed.sha256,...verification});
  }finally{await rm(temporary,{recursive:true,force:true});}
}
export async function verifyApplicationProject(options) {
  return openedBundle(options,async opened=>({schema:PROJECT,status:'APPLICATION_PROJECT_VERIFIED',
    record:opened.record,recordSha256:opened.recordSha256,manifestSha256:opened.manifestSha256,
    components:opened.verified.map(row=>({kind:row.kind,...row.value}))}));
}
async function copyEncryptedBundle(source,destination,expected,signal) {
  await privateDirectory(destination,{create:true});await privateDirectory(join(destination,'objects'),{create:true});
  const raw=await readBytes(join(source,'manifest.json'),12*1024**2,true);
  need(sha(raw)===expected,'APPLICATION_PROJECT_SELECTED_MANIFEST_CHANGED');
  const manifest=JSON.parse(raw),objects=manifest.entries.filter(item=>item.kind==='file').map(item=>item.object);
  need(objects.length<=10000&&new Set(objects).size===objects.length&&
    objects.every(name=>/^objects\/[0-9]{6}\.gcm$/.test(name)),'APPLICATION_PROJECT_ENCRYPTED_MANIFEST_INVALID');
  for(const name of objects)await copyFile(join(source,name),join(destination,name),{signal});
  await publishBytes(join(destination,'manifest.json'),raw);
}
export async function receiveApplicationProject(options) {
  const directory=absolute(options.directory);await privateDirectory(dirname(directory));
  need(!(await exists(directory)),'APPLICATION_PROJECT_RECEIVING_DIRECTORY_EXISTS');
  return openedBundle(options,async opened=>{
    // The encrypted original travels with the receiver, so later restores authenticate it again.
    await encrypted(options.sourceRoot,'restore',{bundle:options.bundle,output:directory,
      passphraseEnv:options.passphraseEnv},{environment:options.environment,signal:options.signal});
    try{
      need(sha(await readBytes(join(directory,'project/project.json'),16*1024**2,true))===opened.recordSha256,
        'APPLICATION_PROJECT_SELECTED_RECORD_CHANGED');
      await copyEncryptedBundle(options.bundle,join(directory,'backup'),opened.manifestSha256,options.signal);
      const receiver={schema:RECEIVED,createdAt:new Date().toISOString(),applicationId:opened.record.config.applicationId,
        originalSubject:opened.record.config.subject,operationId:opened.record.operationId,
        recordSha256:opened.recordSha256,manifestSha256:opened.manifestSha256,
        sourceRoot:absolute(options.sourceRoot),passphraseEnv:options.passphraseEnv};
      await publishBytes(join(directory,'receiver.json'),json(receiver));
      await syncDirectory(directory);
      return {...receiver,schema:PROJECT,status:'APPLICATION_PROJECT_RECEIVED',directory,
        requests:opened.record.application.requests.length,
        resultBytes:opened.record.application.results.reduce((n,row)=>n+row.bytes,0),
        financialOwners:opened.verified.map(row=>({kind:row.kind,...row.value})),
        originalConfigFile:opened.record.configFile};
    }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  });
}
async function received(directory) {
  await privateDirectory(absolute(directory));
  const receiver=await readJSON(join(directory,'receiver.json'),65536,true),
    raw=await readBytes(join(directory,'project/project.json'),16*1024**2,true);
  need(receiver.schema===RECEIVED&&hashPattern.test(receiver.recordSha256)&&hashPattern.test(receiver.manifestSha256)&&
    sha(raw)===receiver.recordSha256,'APPLICATION_PROJECT_RECEIVER_CHANGED');
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(record.schema===PROJECT&&record.config.applicationId===receiver.applicationId&&
    record.operationId===receiver.operationId,'APPLICATION_PROJECT_RECEIVER_CHANGED');
  return {receiver,record,payload:join(directory,'project')};
}
async function referenceState(record,{allowMissingNative=false}={}) {
  const results=[];
  for(const row of record.references){
    absolute(row.path);need(Number.isSafeInteger(row.bytes)&&hashPattern.test(row.sha256),'APPLICATION_PROJECT_REFERENCE_INVALID');
    if(!await exists(row.path)){results.push({...row,status:'MISSING'});continue;}
    const current=await digest(row.path);
    results.push({...row,status:current.bytes===row.bytes&&current.sha256===row.sha256?'MATCHED':'CHANGED'});
  }
  return results;
}
async function pathsState(record,mode) {
  const paths=[];
  for(const file of record.files){
    if(!await exists(file.path)){paths.push({path:file.path,role:file.role,status:'MISSING'});continue;}
    if(mode==='reattach'&&file.role==='application'){
      paths.push({path:file.path,role:file.role,status:'CURRENT_NATIVE_STATE'});continue;
    }
    const current=await digest(file.path,{privateOnly:true});
    paths.push({path:file.path,role:file.role,status:current.bytes===file.bytes&&current.sha256===file.sha256?'MATCHED':'COLLISION'});
  }
  return paths;
}
export async function inspectReceivedApplicationProject({directory,sourceRoot,mode='restore'}={}) {
  need(['restore','reattach'].includes(mode),'APPLICATION_PROJECT_MODE_INVALID');
  absolute(sourceRoot);
  const {record,receiver}=await received(directory),references=await referenceState(record),paths=await pathsState(record,mode);
  return {schema:PROJECT,status:'APPLICATION_PROJECT_RECEIVING_REVIEW',mode,applicationId:record.config.applicationId,
    originalSubject:record.config.subject,operationId:record.operationId,recordSha256:receiver.recordSha256,
    manifestSha256:receiver.manifestSha256,receivedAt:receiver.createdAt,originalConfigFile:record.configFile,
    runtimeDirectory:record.config.runtimeDirectory,sourceRoot:record.sourceRoot,
    requests:record.application.requests.length,resultBytes:record.application.results.reduce((n,row)=>n+row.bytes,0),
    references,paths,financialOwners:record.components.map(item=>({kind:item.kind,ledger:item.ledger,
      stateRoot:item.stateRoot,ledgerState:item.ledgerState??'INITIALIZED',checkpoint:item.checkpoint,checkpoints:item.checkpoints,
      owner:item.owner??null,recordSha256:item.recordSha256})),
    passphraseEnv:receiver.passphraseEnv,
    walletEnvironment:record.components.find(item=>item.kind==='mcp')?.owner?.signerSecretEnv??null,
    restoreMode:'ORIGINAL_CANONICAL_PATHS',receivingMode:'VERIFIED_OFFLINE_RESULTS'};
}
async function verifyCurrentHttp(component,original,{directory,sourceRoot,environment,passphraseEnv,signal,allowAdvanced}) {
  const native=await originalModule(sourceRoot,SF88+'workspace-recovery.mjs');
  const temp=await mkdtemp(join(dirname(directory),'.project-current-http-')),bundle=join(temp,'current');
  try{
    const plan=component.plan;
    await native.snapshotWorkspaceRecovery({directory:plan.directory,stateRoot:plan.stateRoot,
      operators:(plan.operators??[]).map(row=>row.directory),output:bundle,quiesced:true,passEnv:passphraseEnv},
      {environment,signal});
    const result=await native.verifyWorkspaceRecovery({bundle,passEnv:passphraseEnv},{environment,signal,
      inspectSnapshot:async({record,map})=>{
        const owners=[plan,...(plan.operators??[])];
        for(const owner of owners){
          const expected=(original.record.checkpoints??[]).find(row=>row.directory===owner.directory)?.checkpoint??
            original.record.checkpoint;
          const current=(record.checkpoints??[]).find(row=>row.directory===owner.directory)?.checkpoint??record.checkpoint;
          need(current.sequence>=expected.sequence,'APPLICATION_PROJECT_PRESENT_HISTORY_CHANGED');
          if(!allowAdvanced)need(isDeepStrictEqual(current,expected),'APPLICATION_PROJECT_PRESENT_HISTORY_CHANGED');
          const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(map(owner.ledger),{readOnly:true});
          try{
            const mac=expected.sequence===0?'0'.repeat(64):
              db.prepare('SELECT mac FROM journal WHERE sequence=?').get(expected.sequence)?.mac;
            need(mac===expected.journalMac,'APPLICATION_PROJECT_PRESENT_HISTORY_CHANGED');
          }finally{db.close();}
          for(const path of [owner.policy,owner.keys]){
            const name=relative(plan.stateRoot,path),wanted=original.record.files.find(row=>row.path===name);
            const actual=record.files.find(row=>row.path===name);
            need(wanted&&actual&&wanted.sha256===actual.sha256&&wanted.size===actual.size,
              'APPLICATION_PROJECT_PRESENT_OWNER_CHANGED');
          }
        }
      }});
    return {kind:'http',status:'APPLICATION_PROJECT_HTTP_OWNER_ATTACHED',...result};
  }finally{await rm(temp,{recursive:true,force:true});}
}
async function publishCaptured(file,payload) {
  await ensureParents(dirname(file.path));
  if(await exists(file.path)){
    const observed=await digest(file.path,{privateOnly:true});
    need(observed.bytes===file.bytes&&observed.sha256===file.sha256,'APPLICATION_PROJECT_PATH_COLLISION');return 'EXISTING';
  }
  const temporary=join(dirname(file.path),'.project-restore-'+randomUUID());
  try{
    const copied=await copyFile(join(payload,file.member),temporary);
    need(copied.bytes===file.bytes&&copied.sha256===file.sha256,'APPLICATION_PROJECT_CAPTURE_CHANGED');
    try{await link(temporary,file.path);}
    catch(error){if(error.code!=='EEXIST')throw error;const existing=await digest(file.path,{privateOnly:true});
      need(existing.bytes===file.bytes&&existing.sha256===file.sha256,'APPLICATION_PROJECT_PATH_COLLISION');return 'EXISTING';}
    await syncDirectory(dirname(file.path));return 'CREATED';
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function restoreApplicationProject(options) {
  const directory=absolute(options.directory),{receiver,record}=await received(directory),
    environment=options.environment??process.env,mode=options.mode??'restore',
    passphraseEnv=options.passphraseEnv??receiver.passphraseEnv;
  need(hashPattern.test(options.expectedRecordSha256??'')&&options.expectedRecordSha256===receiver.recordSha256,
    'APPLICATION_PROJECT_SELECTED_RECORD_REQUIRED');
  need(['restore','reattach'].includes(mode),'APPLICATION_PROJECT_MODE_INVALID');
  const selected={...options,environment,passphraseEnv,bundle:join(directory,'backup'),
    expectedManifestSha256:receiver.manifestSha256,expectedRecordSha256:receiver.recordSha256,
    temporaryDirectory:dirname(directory)};
  return openedBundle(selected,async verified=>{
    const plan=await inspectReceivedApplicationProject({directory,sourceRoot:options.sourceRoot,mode});
    need(plan.references.every(row=>row.status==='MATCHED'||row.status==='MISSING'&&
      record.components.some(component=>component.kind==='http'&&inside(component.plan.stateRoot,row.path))),
      'APPLICATION_PROJECT_HOST_REFERENCES_REQUIRED');
    need(plan.paths.every(row=>row.status!=='COLLISION'),'APPLICATION_PROJECT_PATH_COLLISION');
    if(mode==='reattach')need(plan.paths.every(row=>row.status!=='MISSING'),
      'APPLICATION_PROJECT_CURRENT_STATE_REQUIRED');
    const components=[],created=[];
    try{
      for(const component of record.components){
        checkSignal(options.signal);
        if(component.kind==='http'){
          const native=await originalModule(options.sourceRoot,SF88+'workspace-recovery.mjs');
          const target=component.plan.stateRoot,hasState=await exists(target)&&(await readdir(target)).length>0;
          if(hasState){
            components.push(await verifyCurrentHttp(component,verified.verified.find(row=>row.kind==='http'),
              {directory,sourceRoot:options.sourceRoot,environment,passphraseEnv,signal:options.signal,allowAdvanced:mode==='reattach'}));
          }else{
            need(mode==='restore','APPLICATION_PROJECT_CURRENT_STATE_REQUIRED');await ensureParents(dirname(target));
            const result=await native.restoreWorkspaceRecovery({bundle:join(verified.payload,component.member),
              passEnv:passphraseEnv,expected:component.recordSha256},{environment,signal:options.signal});
            need(result.status==='BUYER_STATE_RESTORED'&&!result.nativeReopenErrors?.length,
              'APPLICATION_PROJECT_NATIVE_REOPEN_FAILED');
            components.push({kind:'http',...result});
          }
        }else{
          const native=await originalModule(options.sourceRoot,NATIVE+'native-spend-recovery.mjs');
          const current=componentOptions(component,directory,{...options,environment,passphraseEnv});
          if(mode==='reattach'){
            need(typeof native.verifyCurrentNativeMcpSpendingOwner==='function',
              'APPLICATION_PROJECT_CURRENT_OWNER_VERIFIER_REQUIRED');
            components.push({kind:'mcp',...await native.verifyCurrentNativeMcpSpendingOwner(current)});
          }else{
            for(const path of [component.owner.stateDirectory,dirname(component.owner.ledger),
              dirname(component.owner.policy),dirname(component.owner.configFile)])await ensureParents(path);
            components.push({kind:'mcp',...await native.restoreNativeMcpSpendingRecovery(current)});
          }
        }
      }
      if(mode==='restore'){
        for(const path of record.directories)await ensureParents(path);
        // The configuration is published last; the original source selection then sees a complete project.
        const files=[...record.files].sort((a,b)=>Number(a.path===record.configFile)-Number(b.path===record.configFile));
        for(const file of files){checkSignal(options.signal);
          if(await publishCaptured(file,verified.payload)==='CREATED')created.push(file.path);}
      }
      need((await referenceState(record)).every(row=>row.status==='MATCHED'),
        'APPLICATION_PROJECT_HOST_REFERENCES_REQUIRED');
      const receipt={schema:PROJECT,status:mode==='restore'?'APPLICATION_PROJECT_RESTORED':'APPLICATION_PROJECT_CURRENT_HOST_VERIFIED',
        mode,recordSha256:receiver.recordSha256,manifestSha256:receiver.manifestSha256,
        applicationId:record.config.applicationId,configFile:record.configFile,components,created,
        restoredAt:new Date().toISOString()};
      await publishBytes(join(directory,'receiving-'+randomUUID()+'.json'),json(receipt));
      return receipt;
    }catch(error){
      if(created.length||components.length)error.recovery={schema:PROJECT,status:'APPLICATION_PROJECT_RESTORE_INCOMPLETE',created,components};
      throw error;
    }
  });
}
async function verifyLiveBindings(loaded,record,context) {
  need(isDeepStrictEqual(loaded.config,record.config)&&
    loaded.launchBinding?.configFile===record.configFile&&
    loaded.launchBinding?.configurationSha256===record.configurationSha256,
    'APPLICATION_PROJECT_LIVE_CONFIGURATION_CHANGED');
  need(loaded.config.applicationId===record.config.applicationId&&loaded.config.subject===record.config.subject&&
    loaded.application.identity.handoffId===record.application.identity.handoffId&&
    loaded.application.identity.manifestSha256===record.application.identity.manifestSha256&&
    (loaded.application.identity.remoteMcp?.sourceSha256??null)===(record.application.identity.remoteMcp?.sourceSha256??null),
    'APPLICATION_PROJECT_LIVE_IDENTITY_CHANGED');
  const current=await loaded.application.requests(context);
  need(current.requests.length===record.application.requests.length,'APPLICATION_PROJECT_LIVE_SELECTION_CHANGED');
  for(const saved of record.application.reviews){
    const actual=await loaded.application.retainedReview(context,saved.intentId),binding=saved.value.binding;
    for(const key of ['intentId','configSha256','bodySha256'])
      need(actual.binding?.[key]===binding?.[key],'APPLICATION_PROJECT_LIVE_BINDING_CHANGED');
    if(binding?.quoteId)need(actual.binding.quoteId===binding.quoteId,
      'APPLICATION_PROJECT_LIVE_QUOTE_CHANGED');
  }
}
export async function withRestoredApplicationProject(options,operation) {
  need(typeof operation==='function','APPLICATION_PROJECT_CALLBACK_REQUIRED');
  const {record,receiver}=await received(options.directory);
  const outcome=await restoreApplicationProject({...options,expectedRecordSha256:options.expectedRecordSha256??receiver.recordSha256});
  const nativeComponent=record.components.find(component=>component.kind==='mcp');
  const open=async environment=>{
    const {loadApplication}=await import('./configuration.mjs');
    const loaded=await loadApplication(record.configFile,{environment});
    try{
      await verifyLiveBindings(loaded,record,loaded.context);
      return await operation({...loaded,recovery:outcome});
    }finally{await loaded.close();}
  };
  if(!nativeComponent)return open(options.environment??process.env);
  const native=await originalModule(options.sourceRoot,NATIVE+'native-spend-recovery.mjs');
  return native.withNativeMcpSpendingRecoveryEnvironment(componentOptions(nativeComponent,options.directory,
    {...options,passphraseEnv:options.passphraseEnv??receiver.passphraseEnv}),({environment})=>open(environment));
}
/** The original VerifiedFile decodes and exports captured bytes; no merchant or signer is opened. */
export async function openReceivedApplicationProject({directory,sourceRoot,subject,authorize,environment=process.env,passphraseEnv}={}) {
  need(typeof authorize==='function'&&typeof subject==='string'&&subject.length>0,
    'APPLICATION_HOST_AUTHORIZATION_REQUIRED');
  const opened=await received(directory),{record,receiver}=opened;
  const native=await originalModule(sourceRoot,SF88+'node/result.mjs');
  const requests=new Map(record.application.requests.map(row=>[row.intentId,row]));
  const results=new Map(record.application.results.map(row=>[row.intentId,row]));
  const byKind=kind=>new Map(record.application[kind].map(row=>[row.intentId,row.value]));
  const reviews=byKind('reviews'),outcomes=byKind('outcomes'),spending=byKind('spending');
  let closed=false,live=null,liveTask,releaseLive,transition,closeTask;
  const active=new Set();
  function track(operation){
    need(!closed,'APPLICATION_PROJECT_CLOSED');
    const task=Promise.resolve().then(operation);
    active.add(task);
    const done=()=>active.delete(task);task.then(done,done);
    return task;
  }
  function beginTransition(operation){
    need(!transition&&!live,'APPLICATION_PROJECT_TRANSITION_RUNNING');
    const task=track(operation);transition=task;
    const done=()=>{if(transition===task)transition=null;};task.then(done,done);
    return task;
  }
  async function permitted(context,action,request){
    need(!closed&&object(context)&&typeof context.subject==='string','APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
    const fresh=await received(directory);need(fresh.receiver.recordSha256===receiver.recordSha256,
      'APPLICATION_PROJECT_RECEIVER_CHANGED');
    need(await authorize({context:structuredClone(context),action,applicationId:record.config.applicationId,
      request:request?structuredClone(request):null})===true,'APPLICATION_AUTHORIZATION_DENIED');
    need(!closed,'APPLICATION_PROJECT_CLOSED');
  }
  class CapturedFile extends native.VerifiedFile {
    constructor(row){super();this.row=row;}
    _metadata(){return {path:join(directory,'project',this.row.member),bytes:this.row.bytes,sha256:this.row.sha256};}
  }
  const application={
    get identity(){return live?.application.identity??structuredClone(record.application.identity);},
    get readOnly(){return !live;},
    get projectCapabilities(){return {mode:live?'RESTORED_LIVE':'RECEIVED',actions:['inspect','restore','reattach','open','close-live']};},
    selectedIntentIds:Object.freeze([...requests.keys()]),
    responseByteLimit(intentId){return requests.get(intentId)?.responseByteLimit??(requests.get(intentId)?.requestKind==='mcp'?2097152:1048576);},
    supportsAction(action){return live?live.application.supportsAction?.(action):action==='spending'&&spending.size>0;},
    async requests(context){return track(async()=>{
      await permitted(context,'list',null);
      if(live)return live.application.requests(context);
      const selected=[];
      for(const request of requests.values()){
        try{await permitted(context,'status',request);selected.push(structuredClone(request));}
        catch(error){if(error.code!=='APPLICATION_AUTHORIZATION_DENIED')throw error;}
      }
      return {applicationId:record.config.applicationId,handoffId:record.application.identity.handoffId,requests:selected,
        project:{mode:'RECEIVED',recordSha256:receiver.recordSha256}};
    });},
    async call(context,action,intentId,options={}){return track(async()=>{
      const request=requests.get(intentId);need(request,'APPLICATION_REQUEST_NOT_SELECTED');
      await permitted(context,action,request);
      if(live)return live.application.call(context,action,intentId,options);
      need(['review','status','recover','read','export','spending'].includes(action),'APPLICATION_PROJECT_LIVE_HOST_REQUIRED');
      if(action==='review')return structuredClone(reviews.get(intentId)??{request,binding:null,
        review:{native:{mode:'UNPREPARED_AT_CAPTURE'},archived:true}});
      if(action==='status'||action==='recover')return structuredClone(outcomes.get(intentId)??{intentId,state:'AVAILABLE'});
      if(action==='spending')return {...structuredClone(outcomes.get(intentId)),spending:structuredClone(spending.get(intentId)??null)};
      const row=results.get(intentId);need(row,'RESULT_NOT_AVAILABLE');
      const file=new CapturedFile(row);
      if(action==='export')return {intentId,exported:{destination:await file.saveAs(absolute(options.destination),{signal:options.signal}),
        bytes:row.bytes,sha256:row.sha256}};
      const format=options.format??'json',limit=options.limitBytes??application.responseByteLimit(intentId);
      need(['json','text','base64','file'].includes(format)&&Number.isSafeInteger(limit)&&limit>=1&&
        limit<=application.responseByteLimit(intentId),'APPLICATION_READ_OPTIONS_INVALID');
      const artifact=structuredClone(row.artifact);artifact.format=format;artifact.partial=false;
      if(format==='file')await file.verify({signal:options.signal});
      else{
        const raw=await file.bytes({limit,signal:options.signal});
        artifact.data=format==='base64'?raw.toString('base64'):
          format==='json'?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):
          new TextDecoder('utf-8',{fatal:true}).decode(raw);
      }
      return artifact;
    });},
    async project(context,action,options={}){
      need(['inspect','restore','reattach','open','close-live'].includes(action),'APPLICATION_PROJECT_ACTION_INVALID');
      if(action==='inspect'||action==='close-live')return track(async()=>{
        await permitted(context,'project-'+action,null);
        if(action==='inspect')return inspectReceivedApplicationProject({directory,sourceRoot,mode:options.mode??'restore'});
        // An opening transition owns the future live release callback. Wait until it has
        // either installed that callback or failed before asking the operator to close.
        await transition?.catch(()=>{});
        releaseLive?.();await liveTask;
        return {schema:PROJECT,status:'APPLICATION_PROJECT_LIVE_CLOSED'};
      });
      // Reserve the transition synchronously, before host authorization can suspend.
      // close() can therefore drain every accepted operation and a concurrent open
      // cannot start a second original owner while the first is awaiting permission.
      return beginTransition(async()=>{
        await permitted(context,'project-'+action,null);
        const settings={directory,sourceRoot,environment,passphraseEnv:passphraseEnv??receiver.passphraseEnv,
          expectedRecordSha256:options.expectedRecordSha256,mode:action==='reattach'?'reattach':options.mode??'restore',
          signal:options.signal};
        if(action!=='open')return restoreApplicationProject(settings);
        need(context.subject===record.config.subject,'APPLICATION_PROJECT_ORIGINAL_SUBJECT_REQUIRED');
        let ready,failed;
        const opened=new Promise((accept,reject)=>{ready=accept;failed=reject;});
        liveTask=withRestoredApplicationProject(settings,async loaded=>{
          need(!closed,'APPLICATION_PROJECT_CLOSED');
          live=loaded;
          await new Promise(resolve=>{
            releaseLive=resolve;
            ready({schema:PROJECT,status:'APPLICATION_PROJECT_LIVE_OPEN',recovery:loaded.recovery,
              identity:loaded.application.identity});
          });
        }).catch(error=>{failed(error);throw error;}).finally(()=>{live=null;releaseLive=null;liveTask=null;});
        liveTask.catch(()=>{});
        return opened;
      });
    },
    close(){
      if(closeTask)return closeTask;
      closed=true;
      // Releasing a live host starts its original broker cancellation before pending
      // request drains. An opening host sees closed before its callback is exposed.
      releaseLive?.();
      closeTask=(async()=>{
        await Promise.allSettled([...active]);
        releaseLive?.();await liveTask?.catch(()=>{});
      })();
      return closeTask;
    },
  };
  return application;
}
