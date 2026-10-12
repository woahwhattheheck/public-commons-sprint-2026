// MIT. Whole application capture, composed with the original SF88 and native MCP recovery owners.
import { join, dirname } from 'node:path';
import { mkdtemp, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inspectHandoff } from './application.mjs';
import { inspectRemoteMcp } from './remote-mcp.mjs';
import { PROJECT,PROFILE,APPLICATION_PATH,need,object,absolute,inside,sha,json,checkSignal,exists,
  privateDirectory,readBytes,readJSON,digest,publishBytes,originalModule,applicationSources,
  encrypted,capturePaths,syncDirectory,passphrase } from './project-files.mjs';

const SF88='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/';
const NATIVE='stellar-forge/mcp-paid-agent/';
const operationId=value=>{
  need(typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value),
    'APPLICATION_PROJECT_OPERATION_ID_INVALID');return value;
};
const componentSummary=component=>({kind:component.kind,manifestSha256:component.manifestSha256,
  recordSha256:component.recordSha256,checkpoint:component.checkpoint??null,
  checkpoints:component.checkpoints??null,ledger:component.ledger??null,stateRoot:component.stateRoot??null});
export async function readProjectProfile(file) {
  const raw=await readBytes(absolute(file),65536,true),profile=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(object(profile)&&profile.schema===PROFILE&&Object.keys(profile).every(key=>
    ['schema','exportsDirectory','passphraseEnv','httpRecovery','nativeMcpHost'].includes(key)),
    'APPLICATION_PROJECT_PROFILE_INVALID');
  absolute(profile.exportsDirectory);
  need(typeof profile.passphraseEnv==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(profile.passphraseEnv),
    'APPLICATION_PROJECT_PASSPHRASE_ENV_REQUIRED');
  if(profile.nativeMcpHost)absolute(profile.nativeMcpHost);
  if(profile.httpRecovery){
    const value=profile.httpRecovery;
    need(object(value)&&Object.keys(value).every(key=>['directory','stateRoot','operators'].includes(key)),
      'APPLICATION_PROJECT_HTTP_PROFILE_INVALID');
    absolute(value.directory);absolute(value.stateRoot);
    need(value.operators===undefined||Array.isArray(value.operators)&&value.operators.length<=32&&
      value.operators.every(path=>typeof path==='string'),'APPLICATION_PROJECT_HTTP_PROFILE_INVALID');
    for(const path of value.operators??[])absolute(path);
  }
  return {profile,profileFile:file,profileSha256:sha(raw)};
}
export async function inspectApplicationProject({configFile,config,sourceRoot,environment=process.env}={}) {
  absolute(configFile);absolute(sourceRoot);
  const raw=await readBytes(configFile,65536,true),saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(config)need(isDeepStrictEqual(saved,config),'APPLICATION_CONFIGURATION_CHANGED');
  config=saved;
  need(config.schema==='stellar-forge.application-config.v1'&&config.projectProfile,
    'APPLICATION_PROJECT_PROFILE_REQUIRED');
  const selected=await readProjectProfile(config.projectProfile),{profile}=selected;
  await privateDirectory(config.stateDirectory);await privateDirectory(profile.exportsDirectory);
  need(!inside(config.stateDirectory,profile.exportsDirectory)&&!inside(config.handoffDirectory,profile.exportsDirectory),
    'APPLICATION_PROJECT_EXPORT_OVERLAPS_STATE');
  const handoff=await inspectHandoff(config.handoffDirectory),references=await applicationSources(sourceRoot);
  for(const file of [config.authorizationModule].filter(Boolean))references.push({path:file,...await digest(file)});
  const components=[];
  if(profile.httpRecovery){
    const original=await originalModule(sourceRoot,SF88+'workspace-recovery.mjs');
    const plan=await original.inspectWorkspaceRecovery({...profile.httpRecovery,operators:profile.httpRecovery.operators??[]});
    need(!inside(plan.stateRoot,profile.exportsDirectory),'APPLICATION_PROJECT_EXPORT_OVERLAPS_STATE');
    components.push({kind:'http',plan,ledger:plan.ledger,stateRoot:plan.stateRoot});
  }
  if(config.operatorProfile){
    const operatorProfile=await readJSON(config.operatorProfile,65536,true);
    const contract=await originalModule(sourceRoot,SF88+'config.mjs');
    const request=[...handoff.requests.values()][0];
    const owner=contract.execution({...request.config,...operatorProfile}).owner;
    const plans=components.filter(item=>item.kind==='http').flatMap(item=>[item.plan,...(item.plan.operators??[])]);
    need(plans.some(plan=>plan.ledger===owner.ledger&&plan.policy===owner.policy),
      'APPLICATION_PROJECT_HTTP_OWNER_NOT_SELECTED');
    if(operatorProfile.signerModule)references.push({path:operatorProfile.signerModule,...await digest(operatorProfile.signerModule)});
  }
  let remote;
  if(config.remoteMcp){
    remote=await inspectRemoteMcp(config.remoteMcp,{sourceRoot});
    need(profile.nativeMcpHost,'APPLICATION_PROJECT_NATIVE_HOST_REQUIRED');
    const original=await originalModule(sourceRoot,NATIVE+'native-spend-recovery.mjs');
    const inspected=await original.inspectNativeMcpSpendingRecovery({configFile:profile.nativeMcpHost,environment}),owner=inspected.owner;
    references.push({path:remote.config.operatorModule,...await digest(remote.config.operatorModule)});
    components.push({kind:'mcp',owner,inspected,ledger:owner.ledger,stateRoot:owner.stateDirectory});
  }else need(!profile.nativeMcpHost,'APPLICATION_PROJECT_REMOTE_SELECTION_REQUIRED');
  return {schema:PROJECT,status:'APPLICATION_PROJECT_INSPECTED',configFile,configurationSha256:sha(raw),config,
    sourceRoot,...selected,applicationId:config.applicationId,subject:config.subject,
    handoffId:handoff.manifest.handoffId,manifestSha256:handoff.manifestSha256,
    remoteMcpSourceSha256:remote?.sourceSha256??null,
    references:[...new Map(references.map(item=>[item.path,item])).values()],components,
    passphraseAvailable:typeof environment[profile.passphraseEnv]==='string'&&Buffer.byteLength(environment[profile.passphraseEnv])>=16};
}
function publicInspection(selected) {
  return {schema:PROJECT,status:selected.status,applicationId:selected.applicationId,subject:selected.subject,
    handoffId:selected.handoffId,configurationSha256:selected.configurationSha256,
    profileSha256:selected.profileSha256,exportsDirectory:selected.profile.exportsDirectory,
    passphraseEnv:selected.profile.passphraseEnv,passphraseAvailable:selected.passphraseAvailable,
    remoteMcpSourceSha256:selected.remoteMcpSourceSha256,
    financialOwners:selected.components.map(item=>({kind:item.kind,ledger:item.ledger,stateRoot:item.stateRoot,
      ...(item.kind==='mcp'?{owner:item.owner}: {operatorDirectories:[item.plan.directory,...(item.plan.operators??[]).map(x=>x.directory)]})})),
    restoreMode:'ORIGINAL_CANONICAL_PATHS',receivingMode:'VERIFIED_OFFLINE_RESULTS'};
}
function summary(record,recordSha256,manifestSha256,bundle) {
  return {schema:PROJECT,status:'APPLICATION_PROJECT_CREATED',bundle,operationId:record.operationId,
    createdAt:record.createdAt,applicationId:record.application.identity.applicationId,recordSha256,manifestSha256,
    requests:record.application.requests.length,resultBytes:record.application.results.reduce((n,row)=>n+row.bytes,0),
    components:record.components.map(componentSummary)};
}
async function capturedView(application,context,payload,signal) {
  const listing=await application.requests(context);
  need(listing.requests.length===application.selectedIntentIds.length,
    'APPLICATION_PROJECT_COMPLETE_HOST_AUTHORITY_REQUIRED');
  const reviews=[],outcomes=[],results=[],spending=[];
  await privateDirectory(join(payload,'results'),{create:true});
  for(const request of listing.requests){
    checkSignal(signal);
    if(request.state?.state==='AVAILABLE')continue;
    const intentId=request.intentId;
    const outcome=await application.call(context,'status',intentId,{signal});
    need(outcome.state!=='APPLICATION_OPERATION_RUNNING','APPLICATION_PROJECT_OPERATION_RUNNING');
    outcomes.push({intentId,value:outcome});
    // Read the original saved review directly; expired quotes keep their original UUID.
    const review=await application.retainedReview(context,intentId);
    reviews.push({intentId,value:review});
    if(request.requestKind==='mcp'){
      const observation=await application.call(context,'spending',intentId,{signal});
      spending.push({intentId,value:observation.spending});
      // The original provider may refresh a durable reservation during this read.
      outcomes[outcomes.length-1]={intentId,value:await application.call(context,'status',intentId,{signal})};
    }
    const current=outcomes[outcomes.length-1].value;
    if(current.operation?.resultRecoverable!==true&&current.result?.delivery?.status!=='SAVED')continue;
    const artifact=await application.call(context,'read',intentId,{format:'base64',
      limitBytes:application.responseByteLimit?.(intentId)??1048576,signal});
    need(typeof artifact.data==='string'&&artifact.partial===false,'APPLICATION_PROJECT_COMPLETE_RESULT_REQUIRED');
    const raw=Buffer.from(artifact.data,'base64'),file=artifact.result?.file;
    need(file&&file.bytes===raw.length&&file.sha256===sha(raw),'APPLICATION_PROJECT_RESULT_CHANGED');
    const name=sha(Buffer.from(intentId))+'.response',member='results/'+name;
    await publishBytes(join(payload,member),raw);
    const {data,...metadata}=artifact;
    results.push({intentId,member,bytes:raw.length,sha256:sha(raw),artifact:metadata});
  }
  return {identity:structuredClone(application.identity),subject:context.subject,
    requests:listing.requests,reviews,outcomes,spending,results};
}
function checkpointRows(component) {
  if(component.kind==='mcp')return [{ledger:component.ledger,checkpoint:component.checkpoint}];
  if(Array.isArray(component.checkpoints))return component.checkpoints.map(item=>({
    ledger:item.ledger??item.database,checkpoint:item.checkpoint??item}));
  return [{ledger:component.ledger,checkpoint:component.checkpoint}];
}
function equalFinancialCheckpoints(components) {
  const ledgers=new Map();
  for(const component of components)for(const row of checkpointRows(component)){
    if(!row.ledger)continue;
    need(object(row.checkpoint)&&row.checkpoint.outcome==='JOURNAL_CONSISTENT',
      'APPLICATION_PROJECT_FINANCIAL_CHECKPOINT_REQUIRED');
    const prior=ledgers.get(row.ledger);
    need(!prior||isDeepStrictEqual(prior,row.checkpoint),'APPLICATION_PROJECT_SHARED_LEDGER_ADVANCED');
    ledgers.set(row.ledger,row.checkpoint);
  }
}
async function snapshot({application,context,selected,environment,signal,id}) {
  const {profile}=selected,bundle=join(profile.exportsDirectory,id);
  passphrase(environment,profile.passphraseEnv);
  const locking=await originalModule(selected.sourceRoot,SF88+'private-directory-lock.mjs');
  const release=await locking.lockPrivateDirectory({directory:profile.exportsDirectory,filename:'.project-export.lock',
    namespace:'stellar-application-project',busyCode:'APPLICATION_PROJECT_EXPORT_RUNNING',unavailableCode:'APPLICATION_PROJECT_LOCK_UNAVAILABLE'});
  let temporary;
  try {
    if(await exists(bundle)){
      const {verifyApplicationProject}=await import('./project-receive.mjs');
      const old=await verifyApplicationProject({bundle,sourceRoot:selected.sourceRoot,
        passphraseEnv:profile.passphraseEnv,environment,signal,temporaryDirectory:profile.exportsDirectory});
      need(old.record.operationId===id&&old.record.configurationSha256===selected.configurationSha256,
        'APPLICATION_PROJECT_OPERATION_ID_COLLISION');
      return summary(old.record,old.recordSha256,old.manifestSha256,bundle);
    }
    temporary=await mkdtemp(join(profile.exportsDirectory,'.project-capture-'));
    const payload=join(temporary,'payload');await privateDirectory(payload,{create:true});
    if(selected.config.remoteMcp)need(application.spendingConfigurationFile===profile.nativeMcpHost,
      'APPLICATION_PROJECT_ACTUAL_NATIVE_HOST_REQUIRED');
    const view=await capturedView(application,context,payload,signal);
    const components=[];
    await privateDirectory(join(payload,'components'),{create:true});
    for(const item of selected.components){
      checkSignal(signal);
      const member='components/'+item.kind,output=join(payload,member);let result;
      if(item.kind==='http'){
        const native=await originalModule(selected.sourceRoot,SF88+'workspace-recovery.mjs');
        result=await native.snapshotWorkspaceRecovery({...profile.httpRecovery,
          operators:profile.httpRecovery.operators??[],output,quiesced:true,passEnv:profile.passphraseEnv},{environment,signal});
        need(result.status==='BUYER_STATE_BACKUP_CREATED','APPLICATION_PROJECT_NATIVE_CAPTURE_FAILED');
      }else{
        const native=await originalModule(selected.sourceRoot,NATIVE+'native-spend-recovery.mjs');
        result=await native.snapshotNativeMcpSpendingRecovery({configFile:profile.nativeMcpHost,output,
          passphraseEnv:profile.passphraseEnv,quiesced:true,operationId:id,environment,signal});
      }
      if(item.kind==='mcp'){
        need(result.configSha256===item.inspected.configSha256&&result.policySha256===item.inspected.policySha256&&
          isDeepStrictEqual(result.owner,item.owner)&&Array.isArray(result.boundRequestReferences),
          'APPLICATION_PROJECT_ACTUAL_NATIVE_OWNER_CHANGED');
        for(const observation of view.spending){
          const reviewed=view.reviews.find(row=>row.intentId===observation.intentId),quoteId=reviewed?.value.binding?.quoteId;
          if(!observation.value?.reservation)continue;
          const reference=result.boundRequestReferences.find(row=>row.request_id===quoteId);
          need(reference&&reference.request_sha256===observation.value.request_sha256&&
            reference.actor===item.owner.actor&&reference.service===item.owner.service&&
            (observation.value.reservation.state!=='settled'||reference.reservationState==='settled'),
            'APPLICATION_PROJECT_NATIVE_RESERVATION_MISSING');
        }
      }
      const manifest=await digest(join(output,'manifest.json'),{privateOnly:true,signal});
      components.push({kind:item.kind,member,manifestSha256:manifest.sha256,recordSha256:result.recordSha256,
        checkpoint:result.checkpoint??null,checkpoints:result.operators?.map(row=>({ledger:row.ledger,checkpoint:row.checkpoint}))??null,
        ledger:item.ledger,stateRoot:item.stateRoot,
        ...(item.kind==='http'?{plan:item.plan}:{owner:item.owner}),native:result});
    }
    equalFinancialCheckpoints(components);
    const roots=[{path:selected.configFile,role:'configuration'},
      {path:selected.profileFile,role:'configuration'},
      {path:selected.config.stateDirectory,role:'application'},
      {path:selected.config.handoffDirectory,role:'handoff'},
      ...['operatorProfile','remoteMcp'].filter(key=>selected.config[key]).map(key=>({path:selected.config[key],role:'configuration'}))];
    const captured=await capturePaths({roots,destination:join(payload,'files'),signal,
      quoteDatabase:selected.config.remoteMcp?join(selected.config.stateDirectory,'remote-mcp/quotes/quotes.sqlite'):null});
    const current=await inspectApplicationProject({configFile:selected.configFile,config:selected.config,
      sourceRoot:selected.sourceRoot,environment});
    need(current.configurationSha256===selected.configurationSha256&&current.profileSha256===selected.profileSha256&&
      current.manifestSha256===selected.manifestSha256&&current.remoteMcpSourceSha256===selected.remoteMcpSourceSha256&&
      isDeepStrictEqual(current.references,selected.references),'APPLICATION_PROJECT_SOURCE_CHANGED');
    const record={schema:PROJECT,operationId:id,createdAt:new Date().toISOString(),configFile:selected.configFile,
      configurationSha256:selected.configurationSha256,config:selected.config,profileFile:selected.profileFile,
      profileSha256:selected.profileSha256,sourceRoot:selected.sourceRoot,references:selected.references,
      application:view,...captured,components,walletEnvironmentExported:false,restoreMode:'ORIGINAL_CANONICAL_PATHS'};
    const raw=json(record),recordSha256=sha(raw);
    await publishBytes(join(payload,'project.json'),raw);
    const plan=join(temporary,'plan.json'),encryptedOutput=join(temporary,'encrypted');
    await publishBytes(plan,json({schema:'stellar-forge.merchant-recovery-plan.v1',roots:[{name:'project',path:payload}]}));
    await encrypted(selected.sourceRoot,'snapshot',{plan,output:encryptedOutput,passphraseEnv:profile.passphraseEnv},{environment,signal});
    const manifestSha256=(await digest(join(encryptedOutput,'manifest.json'),{privateOnly:true})).sha256;
    checkSignal(signal);
    need(!(await exists(bundle)),'APPLICATION_PROJECT_PATH_COLLISION');
    await mkdir(bundle,{mode:0o700});
    await rename(encryptedOutput,bundle);await syncDirectory(profile.exportsDirectory);
    const result=summary(record,recordSha256,manifestSha256,bundle);
    await publishBytes(join(profile.exportsDirectory,id+'.receipt.json'),json(result),{allowExact:true});
    return result;
  }finally{
    if(temporary)await rm(temporary,{recursive:true,force:true});
    await release();
  }
}
/** All public operations pass this drain gate. The original app still owns authorization and execution. */
export async function attachApplicationProject({application,configFile,configurationSha256,config,sourceRoot,
  authorize,environment=process.env}={}) {
  need(typeof authorize==='function','APPLICATION_HOST_AUTHORIZATION_REQUIRED');
  let closed=false,phase='open',closing,exporting;const active=new Set();
  const selected=()=>inspectApplicationProject({configFile,config,sourceRoot,environment});
  async function permitted(context,action){
    need(object(context)&&typeof context.subject==='string'&&context.subject.length>0,
      'APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
    need(await authorize({context:structuredClone(context),action:'project-'+action,
      applicationId:config.applicationId,request:null})===true,'APPLICATION_AUTHORIZATION_DENIED');
  }
  async function tracked(operation,action){
    need(!closed,'APPLICATION_PROJECT_CLOSED');
    need(phase==='open'||phase==='draining'&&['cancel','status','list'].includes(action),'APPLICATION_PROJECT_CAPTURE_RUNNING');
    const running=Promise.resolve().then(operation);active.add(running);
    try{return await running;}finally{active.delete(running);}
  }
  return {...application,
    projectCapabilities:{mode:'LIVE',actions:['inspect','snapshot','archives']},
    requests(context){return tracked(()=>application.requests(context),'list');},
    call(context,action,intentId,options){return tracked(()=>application.call(context,action,intentId,options),action);},
    async project(context,action,options={}){
      need(['inspect','snapshot','archives'].includes(action),'APPLICATION_PROJECT_ACTION_INVALID');
      need(object(options)&&Object.keys(options).every(key=>(action==='inspect'?['mode','signal']:
        action==='snapshot'?['operationId','signal']:['signal']).includes(key)),
        'APPLICATION_OPTIONS_INVALID');
      need(!closed,'APPLICATION_PROJECT_CLOSED');await permitted(context,action);
      const current=await selected();
      need(current.configurationSha256===configurationSha256,'APPLICATION_CONFIGURATION_CHANGED');
      if(action==='inspect')return publicInspection(current);
      if(action==='archives'){
        const rows=[];
        for(const name of(await readdir(current.profile.exportsDirectory)).sort()){
          if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.receipt\.json$/.test(name))continue;
          const row=await readJSON(join(current.profile.exportsDirectory,name),65536,true);
          if(row.schema===PROJECT&&row.applicationId===config.applicationId)rows.push(row);
        }
        return {schema:PROJECT,archives:rows};
      }
      need(phase==='open','APPLICATION_PROJECT_CAPTURE_RUNNING');phase='draining';
      exporting=(async()=>{
        while(active.size){
          checkSignal(options.signal);let abort;
          const interrupted=new Promise((_,reject)=>{abort=()=>reject(Object.assign(new Error('APPLICATION_PROJECT_INTERRUPTED'),
            {code:'APPLICATION_PROJECT_INTERRUPTED'}));options.signal?.addEventListener('abort',abort,{once:true});
            if(options.signal?.aborted)abort();});
          try{await Promise.race([Promise.allSettled([...active]),interrupted]);}
          finally{options.signal?.removeEventListener('abort',abort);}
        }
        phase='capturing';checkSignal(options.signal);await permitted(context,action);
        return snapshot({application,context,selected:current,environment,signal:options.signal,id:operationId(options.operationId??randomUUID())});
      })();
      try{return await exporting;}finally{exporting=null;phase='open';}
    },
    close(){
      if(closing)return closing;closed=true;
      closing=(async()=>{await Promise.allSettled([...active,...(exporting?[exporting]:[])]);
        await application.close();})();
      return closing;
    },
  };
}
