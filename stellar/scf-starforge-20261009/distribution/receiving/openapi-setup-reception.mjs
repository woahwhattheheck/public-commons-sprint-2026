// MIT. Receive reviewed connection setup through the original Applications lifecycle.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { receiveOpenApiManagedApplication } from './openapi-managed-reception.mjs';

const ROOT='stellar/scf-starforge-20261009/';
const SCHEMA='stellar-forge.openapi-setup-reception.v1';
const MAX_SOURCE=4*1024*1024, MAX_RECORD=32*1024*1024;
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>digest(JSON.stringify(canonical(value)));
const same=(a,b)=>identity(a)===identity(b);
const moduleAt=(root,path)=>import(pathToFileURL(join(root,ROOT+path)).href);
function need(value,code) {
  if(!value)throw Object.assign(new Error(code),{code});
}
function absolute(value) {
  need(typeof value==='string' && isAbsolute(value) && resolve(value)===value &&
    !/[\x00-\x1f\x7f]/.test(value),'OPENAPI_SETUP_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function fields(value,allowed) {
  need(plain(value) && Object.keys(value).every(key=>allowed.includes(key)),
    'OPENAPI_SETUP_RECEIVING_CONFIGURATION_CHANGED');
}
async function absent(path) {
  try{await lstat(path);return false;}catch(error){if(error.code!=='ENOENT')throw error;return true;}
}
async function originalBytes(path,maximum,{privateFile=false}={}) {
  absolute(path);
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();
    need(before.isFile() && before.nlink===1 && before.size>0 && before.size<=maximum &&
      !(before.mode&(privateFile?0o077:0o022)) && await realpath(path)===path &&
      (!privateFile || process.getuid===undefined || before.uid===process.getuid()),
      'OPENAPI_SETUP_RECEIVING_ORIGINAL_FILE_REQUIRED');
    const raw=await handle.readFile(),after=await handle.stat();
    need(raw.length===before.size && after.size===before.size &&
      after.mtimeMs===before.mtimeMs && after.ctimeMs===before.ctimeMs,
      'OPENAPI_SETUP_RECEIVING_SOURCE_CHANGED');
    return raw;
  } finally {await handle.close();}
}
const profileSummary=rows=>rows.map(row=>({alias:row.alias,directoryEnv:row.directoryEnv,
  profileSha256:row.profileSha256,callbackUri:row.callbackUri??null}))
  .sort((a,b)=>a.alias.localeCompare(b.alias));
const grants=rows=>rows.map(row=>({alias:row.alias,directoryEnv:row.directoryEnv,
  profileSha256:row.profileSha256,grantId:row.grant?.id??null,grantState:row.grant?.state??null,
  hasRefreshToken:row.grant?.hasRefreshToken===true,scopes:row.grant?.scopes??[]}))
  .sort((a,b)=>a.alias.localeCompare(b.alias));
const contextFor=settings=>({
  environmentFile:settings.environmentFile??null,
  connectionsFile:settings.oauthConnectionsFile??null,
  port:settings.port,allowLoopbackOAuth:settings.allowLoopbackOAuth===true,
});
const installedIdentity=value=>({directory:value.directory,installationId:value.installationId,
  sourceCommit:value.sourceCommit,sourceManifestSha256:value.sourceManifestSha256,
  profileId:value.profileId,profileSha256:value.profileSha256,lockSha256:value.lockSha256});

/**
 * Consume actual source files and actual reviewed client registrations. The same
 * retained receiver imports them, publishes their original private stores and
 * editions, and enters the existing full managed launch/stop/reopen receiver.
 *
 * setup.editions contains complete original review entries, not generated sample
 * definitions. Each edition includes registeredCallbacks [{alias,uri}], actor,
 * reference and callbacksRegistered:true. Later editions may contain an actual
 * reviewed source/client revision with its original replacesProfileSha256.
 */
export async function receiveOpenApiConnectionSetup(config,{
  onProgress=()=>{},signal,
}={}) {
  fields(config,['runtimeDirectory','expectedSourceCommit','expectedManifest','legacy',
    'receptionDirectory','applicationWorkspace','bootstrapSourceRoot','label','homeId',
    'settings','setup']);
  for(const name of ['runtimeDirectory','receptionDirectory'])absolute(config[name]);
  need(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit??'') &&
    /^[a-f0-9]{64}$/.test(config.expectedManifest??''),
    'OPENAPI_SETUP_RECEIVING_INSTALLED_SOURCE_REQUIRED');
  fields(config.legacy,['runtimeDirectory','expectedSourceCommit','expectedManifest']);
  absolute(config.legacy.runtimeDirectory);
  need(/^[a-f0-9]{40}$/.test(config.legacy.expectedSourceCommit??'') &&
    /^[a-f0-9]{64}$/.test(config.legacy.expectedManifest??''),
    'OPENAPI_SETUP_RECEIVING_LEGACY_SOURCE_REQUIRED');
  fields(config.settings,['outputParent','port','environmentFile','oauthConnectionsFile','allowLoopbackOAuth']);
  absolute(config.settings.outputParent);
  for(const key of ['environmentFile','oauthConnectionsFile'])
    if(config.settings[key]!=null)absolute(config.settings[key]);
  need(Number.isInteger(config.settings.port) && config.settings.port>=1024 &&
    config.settings.port<=65535 && (config.settings.allowLoopbackOAuth===undefined ||
      typeof config.settings.allowLoopbackOAuth==='boolean'),
    'OPENAPI_SETUP_RECEIVING_REGISTERED_PORT_REQUIRED');
  fields(config.setup,['sources','editions','policy']);
  need(Array.isArray(config.setup.sources) && config.setup.sources.length<=64 &&
    Array.isArray(config.setup.editions) && config.setup.editions.length>0 &&
    config.setup.editions.length<=64,'OPENAPI_SETUP_RECEIVING_COMPLETE_PLAN_REQUIRED');
  const policy=config.setup.policy??{};
  fields(policy,['directory','grantRoot','allowLoopbackOAuth']);
  for(const key of ['directory','grantRoot'])if(policy[key]!==undefined)absolute(policy[key]);
  need(policy.allowLoopbackOAuth===undefined || typeof policy.allowLoopbackOAuth==='boolean',
    'OPENAPI_SETUP_RECEIVING_HOST_POLICY_REQUIRED');
  for(const source of config.setup.sources) {
    fields(source,['path','sha256','label']);absolute(source.path);
    need(/^[a-f0-9]{64}$/.test(source.sha256??'') &&
      typeof source.label==='string' && source.label.length>0 && source.label.length<=160,
      'OPENAPI_SETUP_RECEIVING_ORIGINAL_SOURCE_REQUIRED');
  }
  for(const edition of config.setup.editions) {
    fields(edition,['entries','registeredCallbacks','actor','reference','callbacksRegistered']);
    need(Array.isArray(edition.entries) && edition.entries.length>0 && edition.entries.length<=64 &&
      Array.isArray(edition.registeredCallbacks) &&
      edition.registeredCallbacks.length===edition.entries.length &&
      typeof edition.actor==='string' && edition.actor.length>0 && edition.actor.length<=160 &&
      typeof edition.reference==='string' && edition.reference.length<=2000 &&
      edition.callbacksRegistered===true,
      'OPENAPI_SETUP_RECEIVING_REGISTERED_CLIENT_PLAN_REQUIRED');
    for(const row of edition.registeredCallbacks) {
      fields(row,['alias','uri']);
      need(typeof row.alias==='string' && typeof row.uri==='string',
        'OPENAPI_SETUP_RECEIVING_REGISTERED_CALLBACK_REQUIRED');
    }
    need(new Set(edition.registeredCallbacks.map(row=>row.alias)).size===edition.entries.length,
      'OPENAPI_SETUP_RECEIVING_REGISTERED_CALLBACK_REQUIRED');
  }
  const bootstrapSourceRoot=absolute(config.bootstrapSourceRoot??
    join(config.runtimeDirectory,'package','source'));
  const applicationWorkspace=absolute(config.applicationWorkspace??
    join(config.receptionDirectory,'runtime-workspace'));
  const {inspectMerchantRuntime}=await moduleAt(bootstrapSourceRoot,'sf46-release/runtime-package.mjs');
  const installed=await inspectMerchantRuntime(config.runtimeDirectory,
    {expectedManifest:config.expectedManifest,load:false});
  const legacy=await inspectMerchantRuntime(config.legacy.runtimeDirectory,
    {expectedManifest:config.legacy.expectedManifest,load:false});
  need(installed.sourceCommit===config.expectedSourceCommit &&
    legacy.sourceCommit===config.legacy.expectedSourceCommit &&
    await absent(join(legacy.sourceRoot,ROOT+'sf61-openapi-seller-import/workspace/managed-launch.mjs')),
    'OPENAPI_SETUP_RECEIVING_INSTALLED_SELECTION_CHANGED');
  const [{createRuntimeWorkspace,openRuntimeWorkspace},
    {makePrivate,privateDirectory,saveJSON,operationLease}]=await Promise.all([
    moduleAt(bootstrapSourceRoot,'distribution/runtime-workspace/model.mjs'),
    moduleAt(bootstrapSourceRoot,'distribution/runtime-workspace/storage.mjs'),
  ]);
  try{await makePrivate(config.receptionDirectory);}
  catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(config.receptionDirectory);}
  const lease=await operationLease(join(config.receptionDirectory,'setup-receiving.lock'));
  const receiptPath=join(config.receptionDirectory,'openapi-setup-reception.json');
  let journal,model,failure,result,stage='OPEN_SETUP_RECEIVING';
  const persist=async()=>{
    journal.updatedAt=new Date().toISOString();
    need(Buffer.byteLength(JSON.stringify(journal))<=MAX_RECORD,
      'OPENAPI_SETUP_RECEIVING_RECORD_LIMIT');
    await saveJSON(receiptPath,journal,true);
  };
  const progress=value=>onProgress({stage,...value});
  const aborted=()=>{
    if(signal?.aborted)throw Object.assign(new Error('OPENAPI_SETUP_RECEIVING_ABORTED'),
      {code:'OPENAPI_SETUP_RECEIVING_ABORTED'});
  };
  const call=(action,context,input={})=>model.applicationsOpenApiSetup({
    action,runtimeId:journal.runtimeId,context,input,
  });
  const catalog=async context=>{
    const value=await call('catalog',context);
    need(value.enabled===true && !value.contextError,'OPENAPI_SETUP_RECEIVING_CONTEXT_UNAVAILABLE');
    need(!value.pending,'OPENAPI_SETUP_RECEIVING_ORIGINAL_COMMAND_PENDING');
    return value;
  };
  // A row contains only the original command metadata. Source bytes are reread
  // from the pinned file when no durable import exists; they are never copied
  // into this receiver journal or substituted into a retained backend operation.
  const execute=async(row,{sourceText,status:knownStatus}={})=>{
    aborted();
    const status=knownStatus??await call('status',row.context,{requestId:row.input.requestId});
    let output;
    if(status.operation) {
      need(status.operation.requestId===row.input.requestId &&
        status.operation.action===(row.action==='import-source'?'source.import':row.action),
        'OPENAPI_SETUP_RECEIVING_REQUEST_CHANGED');
      output=status.operation.state==='completed'?status.operation.result:
        await call('recover',row.context,{requestId:row.input.requestId});
    } else {
      need(row.resultSha256===undefined,'OPENAPI_SETUP_RECEIVING_ORIGINAL_RESULT_MISSING');
      output=await call(row.action,row.context,{
        ...row.input,...(sourceText===undefined?{}:{sourceText}),
      });
    }
    const actual=identity(output);
    if(row.resultSha256)need(row.resultSha256===actual,'OPENAPI_SETUP_RECEIVING_RESULT_CHANGED');
    else {row.resultSha256=actual;row.completedAt=new Date().toISOString();await persist();}
    return output;
  };
  const command=async(key,action,context,input)=>{
    let row=journal.commands[key];
    if(!row) {
      const current=await catalog(context);
      row={action,context,input:{...input,requestId:randomUUID(),expectedRevision:current.revision}};
      journal.commands[key]=row;await persist();
    } else need(row.action===action && same(row.context,context) &&
      Object.entries(input).every(([name,value])=>same(row.input[name],value)),
      'OPENAPI_SETUP_RECEIVING_COMMAND_CHANGED');
    return row;
  };
  try {
    const selection={configurationSha256:identity(config),bootstrapSourceRoot,applicationWorkspace,
      installed:installedIdentity(installed),legacy:installedIdentity(legacy)};
    try {
      journal=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
        await originalBytes(receiptPath,MAX_RECORD,{privateFile:true})));
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    if(journal)need(journal.schema===SCHEMA && same(journal.selection,selection),
      'OPENAPI_SETUP_RECEIVING_SELECTION_CHANGED');
    else {
      need(await absent(config.settings.outputParent),'OPENAPI_SETUP_RECEIVING_NEW_PROJECT_FOLDER_REQUIRED');
      journal={schema:SCHEMA,createdAt:new Date().toISOString(),selection,
        commands:{},sources:[],editions:[],initialEditionId:null};
      await saveJSON(receiptPath,journal);
    }
    if(journal.completedAt)return journal;
    aborted();
    if(await absent(join(applicationWorkspace,'workspace.json'))) {
      need(!config.applicationWorkspace,'OPENAPI_SETUP_RECEIVING_EXISTING_WORKSPACE_MISSING');
      await createRuntimeWorkspace({directory:applicationWorkspace});
    }
    model=await openRuntimeWorkspace({directory:applicationWorkspace,openApiSetupPolicy:policy});
    need(typeof model.applicationsOpenApiSetup==='function',
      'OPENAPI_SETUP_RECEIVING_CURRENT_CONSOLE_REQUIRED');
    const attached=await model.attach({directory:installed.directory,label:config.label??'API connections'});
    if(journal.runtimeId)need(journal.runtimeId===attached.runtimeId,'OPENAPI_SETUP_RECEIVING_RUNTIME_CHANGED');
    else {journal.runtimeId=attached.runtimeId;await persist();}
    let context=contextFor(config.settings);
    if(!journal.initialCatalog) {
      const current=await catalog(context);
      journal.initialEditionId=current.currentEditionId;
      journal.initialCatalog={revision:current.revision,workspaceId:current.workspaceId};
      await persist();
    }

    for(let index=0;index<config.setup.sources.length;index++) {
      stage='IMPORT_ORIGINAL_SOURCE';aborted();
      const selected=config.setup.sources[index],key='source-'+index;
      let row=journal.commands[key],raw,sourceText;
      const retainedStatus=row?await call('status',row.context,{requestId:row.input.requestId}):null;
      if(!retainedStatus?.operation) {
        raw=await originalBytes(selected.path,MAX_SOURCE);
        need(digest(raw)===selected.sha256,'OPENAPI_SETUP_RECEIVING_SOURCE_CHANGED');
        sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
        need(Buffer.from(sourceText,'utf8').equals(raw),'OPENAPI_SETUP_RECEIVING_UTF8_SOURCE_CHANGED');
      }
      row=await command(key,'import-source',context,{label:selected.label});
      const imported=await execute(row,{sourceText,status:retainedStatus});
      need(imported.source.id===selected.sha256 && imported.source.sha256===selected.sha256 &&
        Number.isSafeInteger(imported.source.bytes) && imported.source.bytes>0 &&
        imported.source.bytes<=MAX_SOURCE && (!raw || imported.source.bytes===raw.length),
        'OPENAPI_SETUP_RECEIVING_IMPORTED_SOURCE_CHANGED');
      const inspected=await call('inspect-source',context,{sourceId:selected.sha256});
      need(inspected.source.id===selected.sha256 && inspected.source.sha256===selected.sha256 &&
        inspected.source.bytes===imported.source.bytes && Array.isArray(inspected.choices),
        'OPENAPI_SETUP_RECEIVING_ORIGINAL_INSPECTION_CHANGED');
      const retained={id:selected.sha256,bytes:imported.source.bytes,requestId:row.input.requestId,
        choicesSha256:identity(inspected.choices)};
      if(journal.sources[index])need(same(journal.sources[index],retained),
        'OPENAPI_SETUP_RECEIVING_SOURCE_CHOICES_CHANGED');
      else {journal.sources[index]=retained;await persist();}
      progress({sourceId:selected.sha256,bytes:imported.source.bytes});
    }

    for(let index=0;index<config.setup.editions.length;index++) {
      stage='REVIEW_REGISTERED_CONNECTIONS';aborted();
      const selected=config.setup.editions[index];
      let edition=journal.editions[index];
      if(!edition) {
        const current=await catalog(context);
        const review=await call('review',context,{expectedRevision:current.revision,
          baseEditionId:current.currentEditionId,entries:selected.entries});
        const callbacks=review.entries.map(row=>({alias:row.alias,uri:row.callbackUri}))
          .sort((a,b)=>a.alias.localeCompare(b.alias));
        need(same(callbacks,[...selected.registeredCallbacks].sort((a,b)=>a.alias.localeCompare(b.alias))),
          'OPENAPI_SETUP_RECEIVING_CALLBACK_REGISTRATION_CHANGED');
        edition={reviewId:review.reviewId,reviewSha256:identity(review),
          profiles:profileSummary(review.entries),changes:review.changes,
          context,requestId:randomUUID(),expectedRevision:review.revision};
        journal.editions[index]=edition;
        journal.commands['edition-'+index]={action:'commit',context,input:{
          requestId:edition.requestId,expectedRevision:edition.expectedRevision,
          reviewId:edition.reviewId,actor:selected.actor,reference:selected.reference,
          callbacksRegistered:true,
        }};
        await persist();
      }
      need(same(edition.context,context),'OPENAPI_SETUP_RECEIVING_EDITION_CONTEXT_CHANGED');
      stage='COMMIT_REGISTERED_CONNECTIONS';
      const row=journal.commands['edition-'+index];
      need(row && row.input.reviewId===edition.reviewId &&
        row.input.requestId===edition.requestId,'OPENAPI_SETUP_RECEIVING_ORIGINAL_REVIEW_MISSING');
      const committed=await execute(row);
      need(committed.operation.requestId===edition.requestId &&
        committed.operation.state==='completed' && committed.edition.id===committed.prepared.editionId &&
        same(profileSummary(committed.edition.entries),edition.profiles),
        'OPENAPI_SETUP_RECEIVING_COMMITTED_EDITION_CHANGED');
      if(edition.id)need(edition.id===committed.edition.id && same(edition.prepared,committed.prepared),
        'OPENAPI_SETUP_RECEIVING_PREPARED_SETTINGS_CHANGED');
      else {edition.id=committed.edition.id;edition.prepared=committed.prepared;await persist();}
      // This repeats the exact completed command, including its old revision.
      // It must return the retained result and cannot initialize another store.
      if(!edition.replayedAt) {
        const replay=await call('commit',row.context,row.input);
        need(identity(replay)===row.resultSha256,'OPENAPI_SETUP_RECEIVING_UNCHANGED_REPLAY_CHANGED');
        edition.replayedAt=new Date().toISOString();await persist();
      }
      const status=await call('status',context,{editionId:edition.id});
      need(status.edition.id===edition.id && same(status.prepared,edition.prepared) &&
        same(profileSummary(status.edition.entries),edition.profiles),
        'OPENAPI_SETUP_RECEIVING_SAVED_EDITION_CHANGED');
      const grantState=grants(status.connections);
      if(edition.grants)need(same(edition.grants,grantState),'OPENAPI_SETUP_RECEIVING_GRANT_CHANGED');
      else {edition.grants=grantState;await persist();}
      if(!edition.downloads) {
        const downloads=[];
        for(const kind of ['profile-review','registry','source-manifest','operator-plan']) {
          const file=await call('download',context,{editionId:edition.id,kind});
          need(typeof file.filename==='string' && !/[\/\\]/.test(file.filename) &&
            typeof file.content==='string' && typeof file.mime==='string',
            'OPENAPI_SETUP_RECEIVING_HANDOVER_CHANGED');
          downloads.push({kind,filename:file.filename,mime:file.mime,
            bytes:Buffer.byteLength(file.content),sha256:digest(file.content)});
        }
        edition.downloads=downloads;await persist();
      }
      context=contextFor(edition.prepared.settings);
      progress({editionId:edition.id,profileCount:edition.profiles.length,changes:edition.changes});
    }

    const finalEdition=journal.editions.at(-1);
    const previousId=journal.editions.length>1?journal.editions.at(-2).id:journal.initialEditionId;
    if(previousId && previousId!==finalEdition.id) {
      stage='REOPEN_PREVIOUS_EDITION';
      for(const [key,editionId] of [['select-previous',previousId],['restore-final',finalEdition.id]]) {
        const row=await command(key,'activate',context,{editionId});
        const activated=await execute(row);
        need(activated.prepared.editionId===editionId,'OPENAPI_SETUP_RECEIVING_ACTIVATED_EDITION_CHANGED');
        if(editionId===finalEdition.id)need(same(activated.prepared,finalEdition.prepared),
          'OPENAPI_SETUP_RECEIVING_FINAL_SETTINGS_CHANGED');
      }
      journal.previousEditionReopened=previousId;await persist();
    }
    stage='CHECK_RETAINED_ORIGINAL_STORES';
    for(const edition of journal.editions) {
      const status=await call('status',context,{editionId:edition.id});
      need(same(status.prepared,edition.prepared) && same(grants(status.connections),edition.grants),
        'OPENAPI_SETUP_RECEIVING_RETAINED_STORE_CHANGED');
    }
    if(!journal.setupCompletedAt) {
      journal.setupCompletedAt=new Date().toISOString();await persist();
    }
    await model.close();model=null;
    stage='RECEIVE_ORIGINAL_MANAGED_APPLICATION';aborted();
    const received=await receiveOpenApiManagedApplication({
      runtimeDirectory:config.runtimeDirectory,expectedSourceCommit:config.expectedSourceCommit,
      expectedManifest:config.expectedManifest,legacy:config.legacy,
      receptionDirectory:config.receptionDirectory,applicationWorkspace,bootstrapSourceRoot,
      ...(config.label?{label:config.label}:{}),...(config.homeId?{homeId:config.homeId}:{}),
      settings:{outputParent:config.settings.outputParent,...finalEdition.prepared.settings},
    },{signal,onProgress:value=>progress({managed:value})});
    need(received.completedAt && received.selection.applicationWorkspace===applicationWorkspace &&
      received.selection.settings.oauthConnectionsFile===finalEdition.prepared.settings.oauthConnectionsFile &&
      received.selection.settings.environmentFile===finalEdition.prepared.settings.environmentFile,
      'OPENAPI_SETUP_RECEIVING_ORIGINAL_MANAGED_RESULT_CHANGED');
    journal.managed={applicationId:received.applicationId,completedAt:received.completedAt,
      receiptPath:join(config.receptionDirectory,'openapi-managed-reception.json'),
      operations:received.passes.map(pass=>({name:pass.name,requestId:pass.requestId,
        openedAt:pass.opened.observedAt,stoppedAt:pass.stoppedAt}))};
    stage='COMPLETED';journal.completedAt=new Date().toISOString();delete journal.issue;
    await persist();result=journal;
    progress({phase:'COMPLETED',applicationId:received.applicationId,editionId:finalEdition.id});
  } catch(error) {
    failure=error;
    if(journal) {
      journal.issue={stage,code:error.code??'OPENAPI_SETUP_RECEIVING_FAILED',at:new Date().toISOString()};
      await persist().catch(()=>{});
    }
  } finally {
    const cleanup=[];
    if(model)try{await model.close();}catch(error){cleanup.push(error);}
    try{await lease.close();}catch(error){cleanup.push(error);}
    if(cleanup.length)throw new AggregateError([...(failure?[failure]:[]),...cleanup],
      'The original setup receiver could not close its workspace or retained lease.');
  }
  if(failure)throw failure;
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  need(process.argv.length===3,'OPENAPI_SETUP_RECEIVING_CONFIGURATION_REQUIRED');
  const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
    await originalBytes(resolve(process.argv[2]),MAX_RECORD,{privateFile:true})));
  const lifetime=new AbortController(),stop=()=>lifetime.abort();
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    const result=await receiveOpenApiConnectionSetup(config,{signal:lifetime.signal,
      onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
    process.stdout.write(JSON.stringify({schema:SCHEMA,status:'COMPLETED',
      applicationId:result.managed.applicationId,
      sourceCommit:result.selection.installed.sourceCommit,
      sourceManifestSha256:result.selection.installed.sourceManifestSha256,
      sourceIds:result.sources.map(source=>source.id),
      editionIds:result.editions.map(edition=>edition.id),
      previousEditionReopened:result.previousEditionReopened??null,
      managed:result.managed})+'\n');
  } finally {process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
