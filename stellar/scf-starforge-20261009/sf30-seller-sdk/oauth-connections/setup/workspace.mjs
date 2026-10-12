// MIT. Immutable setup editions over the original private files, lock and grant store.
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath, link, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readPrivate, readJson, createFile, syncDirectory,
  atomicJson, bytes, stamp } from '../../postgres/publisher/files.mjs';
import { withConnectionLock } from '../../sheets/auth/store.mjs';
import { initializeOAuthConnection, oauthConnectionStatus } from '../store.mjs';
import { HOST_CONNECTIONS_SCHEMA, normalizeOAuthHostConnections, readOAuthHostConnections,
  inspectOAuthHostDirectory } from '../host.mjs';
import { normalizeOAuthProfile, oauthProfileIdentity } from '../profile.mjs';
import { applicationEnvironment } from '../../../distribution/runtime-workspace/application-environment.mjs';
import { oauthSetupProviderId } from './providers.mjs';
import { SETUP_SCHEMA, MAX_SOURCE_BYTES, MAX_ENTRIES, MAX_REVIEW_BYTES, limits, fail, need, fields, text, revision,
  requestId, sourceId, normalizeContext, callbackUri, inspectSetupSource, normalizeNewDefinition,
  normalizeDesiredEntries, publicEntry, setupError, plain, hex, envName, identity, digest } from './model.mjs';

const JSON_LIMIT=64*1024*1024;
const HOST_EDITION = Symbol('original host setup edition');
function retainedBytes(value,maximum=JSON_LIMIT) {
  const raw=bytes(value);
  need(raw.length<=maximum,'INPUT_INVALID','This setup record exceeds its retained size limit. Review a smaller complete service family.');
  return raw;
}
const CHILDREN=['sources','reviews','editions','receipts'];
const FILES=['connections.json','profiles.json','review.json','source-manifest.json','environment.json','operator-plan.md'];
const schema=name=>'stellar-forge.oauth-setup-'+name+'.v1';
const own=(value,key)=>Object.hasOwn(value,key);
const ownerUid=()=>process.geteuid?.()??process.getuid?.();
const eq=(a,b)=>identity(a)===identity(b);
const id=value=>{need(hex(value),'INPUT_INVALID','Select an exact setup record identity.');return value;};
const valuePath=(directory,value)=>join(directory,id(value));
const optional=async path=>{
  try{return await readJson(path,JSON_LIMIT);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
};
async function directoryIdentity(path,{create=false}={}) {
  absolute(path);
  if(create) {
    await privateDirectory(dirname(path));
    try{await mkdir(path,{mode:0o700});await syncDirectory(dirname(path));}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  await privateDirectory(path);
  const stat=await lstat(path);
  need(ownerUid()===undefined || stat.uid===ownerUid(),'DIRECTORY_CHANGED',
    'Use the original private setup directory owned by this operator.',409);
  return {path,device:String(stat.dev),inode:String(stat.ino),uid:stat.uid};
}
async function readOwned(path,maximum=JSON_LIMIT) {
  const stat=await lstat(path);
  need(!stat.isSymbolicLink() && (ownerUid()===undefined || stat.uid===ownerUid()),
    'DIRECTORY_CHANGED','A retained setup file no longer belongs to this private workspace.',409);
  return readPrivate(path,maximum);
}
async function immutable(path,content) {
  const expected=Buffer.isBuffer(content)?content:Buffer.from(content);
  const verify=async()=>{
    const current=await readOwned(path,Math.max(JSON_LIMIT,expected.length));
    need(current.equals(expected),'EDITION_CHANGED','A retained immutable setup file changed.',409);
  };
  try{await verify();return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(dirname(path),'.write-'+randomUUID());
  let failure;
  try {
    await createFile(temporary,expected);
    try{await link(temporary,path);}
    catch(error){if(error.code!=='EEXIST')throw error;await verify();}
    await syncDirectory(dirname(path));
  } catch(error) { failure=error; throw error; }
  finally {
    try{await unlink(temporary);await syncDirectory(dirname(path));}
    catch(error){if(error.code!=='ENOENT' && !failure)throw error;}
  }
}
async function privateEnvironment(context) {
  // Invoke the original Applications validator first, then retain only its declared
  // file entries after an exact byte-hash check. Never serialize inherited process.env.
  let original;
  try{original=await applicationEnvironment(context.environmentFile??undefined);}
  catch{fail('CONTEXT_CHANGED','Read the current original private environment JSON before preparing this setup.',409);}
  let declared={};
  if(context.environmentFile) {
    let raw;
    try{raw=await readPrivate(context.environmentFile,65536);}
    catch{fail('CONTEXT_CHANGED','The selected private environment file is unavailable.',409);}
    need(digest(raw)===original.sha256,'CONTEXT_CHANGED',
      'The private environment file changed while it was being reviewed.',409);
    declared=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }
  return {declared,effective:{...original.environment},sha256:original.sha256};
}
async function registryFile(path) {
  if(!path)return {connections:[],sha256:null};
  let raw,connections;
  try {
    absolute(path);
    const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const before=await handle.stat();
      need(before.isFile() && !(before.mode&0o022) && before.size<=65536 &&
        await realpath(path)===path,'CONTEXT_CHANGED','Use the current original host registry file.',409);
      raw=await handle.readFile();const after=await handle.stat();
      need(raw.length===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs &&
        before.ctimeMs===after.ctimeMs,'CONTEXT_CHANGED','The original registry changed while reading.',409);
    }finally{await handle.close();}
    connections=await readOAuthHostConnections(path);
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    need(parsed.schema===HOST_CONNECTIONS_SCHEMA && eq(normalizeOAuthHostConnections(parsed.connections),connections),
      'CONTEXT_CHANGED','The original registry changed while reading.',409);
  }catch(error){
    if(error.code?.startsWith('OAUTH_SETUP_'))throw error;
    fail('CONTEXT_CHANGED','Read the original registered host configuration before preparing another edition.',409);
  }
  return {connections,sha256:digest(raw)};
}
function summary(entry) {
  const {id,sequence,createdAt,reviewId,requestId,entryCount,registrySha256,environmentSha256}=entry;
  return {id,sequence,createdAt,reviewId,requestId,entryCount,registrySha256,environmentSha256};
}
const pendingView=pending=>pending?{action:pending.action,requestId:pending.requestId,
  inputHash:pending.inputHash,phase:pending.phase}:null;
function publicReview(review) {
  return {schema:schema('review'),reviewId:review.id,revision:review.revision,
    baseEditionId:review.baseEditionId,contextBinding:review.contextBinding,
    entries:review.entries.map(publicEntry),changes:review.changes,
    environmentNames:review.environmentNames,callbackUris:review.entries.map(entry=>entry.callbackUri),
    files:FILES.map(path=>({path,role:path==='environment.json'?'private environment; not a download':'operator source/registry review'}))};
}
function publicEdition(edition) {
  return {...summary(edition),schema:schema('edition'),runtimeBinding:edition.runtimeBinding,
    entries:edition.entries.map(publicEntry),sources:edition.sources,review:edition.review,
    changes:edition.changes,files:edition.files.map(({path,bytes,sha256,private:privateFile})=>
      ({path,bytes,sha256,private:privateFile})),context:edition.context};
}
function prepared(directory,edition) {
  return {editionId:edition.id,registrySha256:edition.registrySha256,environmentSha256:edition.environmentSha256,
    settings:{oauthConnectionsFile:join(directory,'editions',edition.id,'connections.json'),
      environmentFile:join(directory,'editions',edition.id,'environment.json'),
      port:edition.context.port,allowLoopbackOAuth:edition.context.allowLoopbackOAuth}};
}
function validateState(state,roots,ownerWorkspaceId) {
  need(plain(state) && state.schema===SETUP_SCHEMA && typeof state.workspaceId==='string' &&
    state.ownerWorkspaceId===ownerWorkspaceId && eq(state.roots,roots) &&
    Number.isSafeInteger(state.revision) && state.revision>=0 &&
    Array.isArray(state.sources) && Array.isArray(state.editions) &&
    (state.currentEditionId===null || hex(state.currentEditionId)) &&
    (state.pending===null || plain(state.pending)),'DIRECTORY_CHANGED',
    'The retained setup workspace identity or private root changed.',409);
  for(const source of state.sources)need(hex(source.id)&&source.id===source.sha256 &&
    Number.isSafeInteger(source.bytes)&&source.bytes>0&&source.bytes<=MAX_SOURCE_BYTES,
    'SOURCE_CHANGED','A retained source identity is invalid.',409);
  for(const edition of state.editions)need(hex(edition.id)&&hex(edition.editionSha256),
    'EDITION_CHANGED','A retained edition identity is invalid.',409);
  need(new Set(state.sources.map(x=>x.id)).size===state.sources.length &&
    new Set(state.editions.map(x=>x.id)).size===state.editions.length &&
    (state.currentEditionId===null || state.editions.some(x=>x.id===state.currentEditionId)),
    'EDITION_CHANGED','A retained setup index is inconsistent.',409);
  return state;
}
async function sourceRecord(directory,state,source) {
  const record=state.sources.find(value=>value.id===sourceId(source));
  need(record,'SOURCE_INVALID','Import this exact source before selecting its operations.');
  const raw=await readOwned(join(directory,'sources',record.id+'.source'),MAX_SOURCE_BYTES);
  need(raw.length===record.bytes && digest(raw)===record.sha256,'SOURCE_CHANGED','The retained original source changed.',409);
  return {record,raw,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)};
}
async function checkedEdition(directory,state,editionId,{checkConnections=true}={}) {
  const indexed=state.editions.find(value=>value.id===id(editionId));
  need(indexed,'EDITION_CHANGED','Select an existing immutable setup edition.',409);
  const root=valuePath(join(directory,'editions'),editionId);
  await directoryIdentity(root);
  const raw=await readOwned(join(root,'edition.json'));
  need(digest(raw)===indexed.editionSha256,'EDITION_CHANGED','The immutable edition record changed.',409);
  const edition=JSON.parse(raw);
  need(edition.schema===schema('edition') && edition.id===indexed.id && eq(summary(edition),summary(indexed)) &&
    Array.isArray(edition.files) && edition.files.length===FILES.length &&
    eq(edition.files.map(value=>value.path).sort(),[...FILES].sort()) &&
    Array.isArray(edition.entries) && edition.entries.length===edition.entryCount,
    'EDITION_CHANGED','The immutable edition no longer matches its index.',409);
  for(const file of edition.files) {
    const body=await readOwned(join(root,file.path));
    need(body.length===file.bytes && digest(body)===file.sha256,'EDITION_CHANGED',
      'An immutable setup edition file changed.',409);
  }
  need(edition.files.find(f=>f.path==='connections.json').sha256===edition.registrySha256 &&
    edition.files.find(f=>f.path==='environment.json').sha256===edition.environmentSha256,
    'EDITION_CHANGED','The retained registry/environment identities do not match.',409);
  const registry=await readOAuthHostConnections(join(root,'connections.json'));
  need(eq(registry,edition.entries.map(({alias,directoryEnv})=>({alias,directoryEnv}))),
    'EDITION_CHANGED','The retained aliases no longer match their reviewed profiles.',409);
  const env=await privateEnvironment({environmentFile:join(root,'environment.json')});
  need(env.sha256===edition.environmentSha256,'EDITION_CHANGED','The retained environment changed.',409);
  for(const entry of edition.entries) {
    need(env.declared[entry.directoryEnv]===entry.directory,'EDITION_CHANGED',
      'The retained environment no longer names the reviewed private connection.',409);
    if(checkConnections) await checkConnection(entry,edition.context.allowLoopbackOAuth);
  }
  for(const source of edition.sources)await sourceRecord(directory,state,source.id);
  return edition;
}
async function checkConnection(entry,allowLoopback) {
  let directory,status;
  try {
    directory=await inspectOAuthHostDirectory(entry.directory,{directoryEnv:entry.directoryEnv,ownerUid:ownerUid()});
    status=await oauthConnectionStatus(entry.directory,{allowLoopback});
  }catch{fail('DIRECTORY_CHANGED','A reviewed private connection is unavailable or changed.',409);}
  need(eq(directory,entry.directoryIdentity) && status.profileSha256===entry.profileSha256 &&
    eq(status.profile,entry.profile),'DIRECTORY_CHANGED','A reviewed private connection identity changed.',409);
  return status;
}


async function contextSnapshot(directory,state,context,runtimeBinding,policy) {
  const selected=normalizeContext(context);
  need(!selected.allowLoopbackOAuth || policy.allowLoopbackOAuth===true,'CALLBACK_INVALID',
    'This receiving host must explicitly permit local development OAuth providers.');
  const environment=await privateEnvironment(selected),registry=await registryFile(selected.connectionsFile);
  const baseEntries=[],directories=new Set();
  let authored;
  const known=state.editions.find(entry=>selected.connectionsFile===join(directory,'editions',entry.id,'connections.json'));
  if(known)authored=await checkedEdition(directory,state,known.id);
  for(const row of registry.connections) {
    const path=environment.effective[row.directoryEnv];
    let dir,status;
    try {
      dir=await inspectOAuthHostDirectory(path,{directoryEnv:row.directoryEnv,ownerUid:ownerUid()});
      status=await oauthConnectionStatus(path,{allowLoopback:selected.allowLoopbackOAuth});
    }catch{fail('DIRECTORY_CHANGED','A selected original registry alias does not resolve to its valid private connection.',409);}
    need(!directories.has(path),'ENVIRONMENT_CONFLICT','Original aliases must resolve to distinct private connection directories.',409);
    directories.add(path);
    const prior=authored?.entries.find(entry=>entry.alias===row.alias && entry.profileSha256===status.profileSha256);
    baseEntries.push({...row,directory:path,directoryIdentity:dir,profileSha256:status.profileSha256,
      profile:status.profile,sourceId:status.profile.source.sha256,
      callbackUri:selected.port>=1024?callbackUri(status.profile,status.profileSha256,selected.port):null,
      grant:{id:status.grant.id,state:status.grant.state},...(prior?.definition?{definition:prior.definition}:{})});
  }
  const binding=identity({context:selected,runtimeBinding,roots:state.roots,
    policy:{allowLoopbackOAuth:policy.allowLoopbackOAuth===true},
    environmentSha256:environment.sha256,registrySha256:registry.sha256,
    entries:baseEntries.map(({alias,directoryEnv,directory,directoryIdentity,profileSha256})=>
      ({alias,directoryEnv,directory,directoryIdentity,profileSha256}))});
  return {context:selected,environment,registry,baseEntries,binding};
}
function environmentFor(snapshot,entries) {
  const declared=new Map(Object.entries(snapshot.environment.declared));
  const directoryNames=new Set([...snapshot.baseEntries,...entries].map(entry=>entry.directoryEnv));
  for(const entry of entries) {
    need(!['HOME','CODEX_HOME'].includes(entry.directoryEnv),'ENVIRONMENT_CONFLICT',
      'Directory references cannot replace original reserved home settings.',409);
    const old=snapshot.environment.effective[entry.directoryEnv];
    const declaredOld=snapshot.baseEntries.some(base=>base.directoryEnv===entry.directoryEnv && base.directory===old);
    need(old===undefined || old===entry.directory || declaredOld,'ENVIRONMENT_CONFLICT',
      'A selected directory name already holds another environment value. Choose a distinct name.',409);
    declared.set(entry.directoryEnv,entry.directory);
    if(entry.profile.clientSecretEnv) {
      const name=entry.profile.clientSecretEnv,value=snapshot.environment.effective[name];
      need(!directoryNames.has(name) && typeof value==='string' && value.length>0 && !value.includes('\0'),
        'ENVIRONMENT_CONFLICT','Each confidential client needs its existing separate private secret reference.',409);
    }
  }
  const value=Object.fromEntries([...declared].sort(([a],[b])=>a.localeCompare(b)));
  const raw=bytes(value);
  need(declared.size<=128 && raw.length<=65536,'ENVIRONMENT_CONFLICT',
    'The composed private environment must fit the original 128-name, 64 KiB Applications file limit.',409);
  return {value,raw,sha256:digest(raw),names:[...declared.keys()].sort()};
}
async function desiredDefinition(raw, sourceText, context, options) {
  if (own(raw, 'provider')) {
    need(options.providers, 'PROVIDER_UNAVAILABLE',
      'Use the selected runtime\'s original provider registration adapter.', 409);
    return options.providers.normalizeDefinition(raw, sourceText, {context});
  }
  return normalizeNewDefinition(raw, sourceText, {allowLoopback:context.allowLoopbackOAuth});
}
async function makeReview(directory,state,context,input,options) {
  fields(input,['expectedRevision','baseEditionId','entries'],'registry review');
  need(revision(input.expectedRevision)===state.revision,'REVISION_CHANGED','Refresh the setup before reviewing changed selections.',409);
  need((input.baseEditionId??null)===state.currentEditionId,'REVISION_CHANGED','Select the current setup edition before reviewing another.',409);
  const snapshot=await contextSnapshot(directory,state,context,options.runtimeBinding,options.policy);
  const desired=normalizeDesiredEntries(input.entries),entries=[],sources=new Map();
  for(const requested of desired) {
    if(own(requested,'retainAlias')) {
      const base=snapshot.baseEntries.find(entry=>entry.alias===requested.retainAlias);
      need(base && base.profileSha256===requested.expectedProfileSha256,'CONTEXT_CHANGED',
        'Select the exact current profile for each retained alias.',409);
      entries.push({...base,kind:'retained',callbackUri:callbackUri(base.profile,base.profileSha256,snapshot.context.port),
        existingGrant:base.grant});
      continue;
    }
    let original=sources.get(requested.sourceId);
    if(!original){original=await sourceRecord(directory,state,requested.sourceId);sources.set(requested.sourceId,original);}
    const normalized=await desiredDefinition(requested,original.text,snapshot.context,options);
    const old=snapshot.baseEntries.find(entry=>entry.alias===requested.alias);
    need(!old || old.profileSha256===normalized.profileSha256 ||
      requested.replacesProfileSha256===old.profileSha256,'PROFILE_REPLACEMENT_REQUIRED',
      'Review the exact existing profile before replacing this registered alias.',409);
    need(requested.replacesProfileSha256===undefined || old &&
      requested.replacesProfileSha256===old.profileSha256,'PROFILE_REPLACEMENT_REQUIRED',
      'The selected replacement profile no longer matches this current alias.',409);
    let entry={kind:'initialize',alias:requested.alias,directoryEnv:requested.directoryEnv,...normalized,
      callbackUri:callbackUri(normalized.profile,normalized.profileSha256,snapshot.context.port),
      directory:join(options.grantRoot,identity({workspaceId:state.workspaceId,alias:requested.alias,
        profileSha256:normalized.profileSha256})),directoryIdentity:null};
    if(old?.profileSha256===normalized.profileSha256) {
      entry={...entry,kind:'retained',directory:old.directory,directoryIdentity:old.directoryIdentity,existingGrant:old.grant};
    } else {
      // An earlier immutable edition may already own this exact alias/profile.
      let marker;
      try{marker=await optional(join(entry.directory,'setup-owner.json'));}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(marker) {
        need(eq(marker,storeOwner(state,entry)),'DIRECTORY_CHANGED',
          'The planned connection path is owned by another setup profile.',409);
        try {
          entry.directoryIdentity=await inspectOAuthHostDirectory(entry.directory,{directoryEnv:entry.directoryEnv,ownerUid:ownerUid()});
          const status=await oauthConnectionStatus(entry.directory,{allowLoopback:snapshot.context.allowLoopbackOAuth});
          need(status.profileSha256===entry.profileSha256,'DIRECTORY_CHANGED','An owned prior connection changed profile.',409);
          entry.kind='retained';entry.existingGrant={id:status.grant.id,state:status.grant.state};
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
    }
    entries.push(entry);
  }
  entries.sort((a,b)=>a.alias.localeCompare(b.alias));
  try{normalizeOAuthHostConnections(entries.map(({alias,directoryEnv})=>({alias,directoryEnv})));}
  catch{fail('INPUT_INVALID','Use unique aliases and directory environment references across the complete desired registry.');}
  need(new Set(entries.map(entry=>entry.directory)).size===entries.length,'ENVIRONMENT_CONFLICT',
    'The desired aliases must retain separate original connection directories.',409);
  const environment=environmentFor(snapshot,entries),changes=[];
  for(const entry of entries) {
    const before=snapshot.baseEntries.find(base=>base.alias===entry.alias);
    changes.push({alias:entry.alias,kind:!before?'added':before.profileSha256===entry.profileSha256 &&
      before.directoryEnv===entry.directoryEnv?'retained':'replaced',
      ...(before?{beforeProfileSha256:before.profileSha256}:{}),afterProfileSha256:entry.profileSha256});
  }
  for(const before of snapshot.baseEntries)if(!entries.some(entry=>entry.alias===before.alias))
    changes.push({alias:before.alias,kind:'removed',beforeProfileSha256:before.profileSha256});
  const plan={schema:schema('review'),workspaceId:state.workspaceId,revision:state.revision,
    baseEditionId:state.currentEditionId,context:snapshot.context,contextBinding:snapshot.binding,
    runtimeBinding:options.runtimeBinding,entries,changes,environmentNames:environment.names,
    environmentSha256:environment.sha256,sourceIds:[...new Set(entries.map(entry=>entry.sourceId))]
      .filter(source=>state.sources.some(value=>value.id===source)).sort()};
  await options.validateReview?.({entries,context:plan.context,runtimeBinding:options.runtimeBinding});
  plan.id=identity(plan);
  await immutable(join(directory,'reviews',plan.id+'.json'),retainedBytes(plan,MAX_REVIEW_BYTES));
  return publicReview(plan);
}
function storeOwner(state,entry) {
  return {schema:schema('store-owner'),workspaceId:state.workspaceId,alias:entry.alias,profileSha256:entry.profileSha256};
}
async function initializeEntry(state,entry,allowLoopback) {
  if(entry.kind==='retained') {
    await checkConnection(entry,allowLoopback);
    return entry;
  }
  try{await mkdir(entry.directory,{mode:0o700});await syncDirectory(dirname(entry.directory));}
  catch(error){if(error.code!=='EEXIST')throw error;}
  await directoryIdentity(entry.directory);
  const owner=storeOwner(state,entry),marker=await optional(join(entry.directory,'setup-owner.json'));
  if(marker)need(eq(marker,owner),'DIRECTORY_CHANGED','The planned private connection is owned by a different setup.',409);
  else {
    const children=await readdir(entry.directory);
    need(children.length===0,'DIRECTORY_CHANGED',
      'An existing unowned connection directory cannot be initialized or replaced.',409);
    await immutable(join(entry.directory,'setup-owner.json'),bytes(owner));
  }
  const status=await initializeOAuthConnection(entry.directory,{profile:entry.profile,allowLoopback});
  need(status.profileSha256===entry.profileSha256,'DIRECTORY_CHANGED','Original initialization returned another profile.',409);
  const directoryIdentity=await inspectOAuthHostDirectory(entry.directory,{directoryEnv:entry.directoryEnv,ownerUid:ownerUid()});
  return {...entry,directoryIdentity};
}
async function retainedReview(directory,state,reviewId) {
  const plan=await optional(join(directory,'reviews',id(reviewId)+'.json'));
  need(plan && plan.schema===schema('review') && plan.id===reviewId &&
    plan.workspaceId===state.workspaceId,'REVIEW_CHANGED','Select the original retained registry review.',409);
  const {id:stored,...payload}=plan;
  need(identity(payload)===stored,'REVIEW_CHANGED','The retained review content changed.',409);
  return plan;
}
function commandBody(action,input) {
  if (action === 'source.provider') {
    fields(input, ['requestId', 'expectedRevision', 'provider', 'sourceSha256'], 'native provider source import');
    requestId(input.requestId); revision(input.expectedRevision);
    oauthSetupProviderId(input.provider); sourceId(input.sourceSha256);
    return {requestId:input.requestId, expectedRevision:input.expectedRevision,
      provider:input.provider, sourceId:input.sourceSha256};
  }
  if(action==='source.import') {
    fields(input,['requestId','expectedRevision','label','sourceText'],'source import');
    requestId(input.requestId);revision(input.expectedRevision);text(input.label,'source label',160);
    need(typeof input.sourceText==='string' && input.sourceText.isWellFormed() &&
      Buffer.byteLength(input.sourceText)>0 && Buffer.byteLength(input.sourceText)<=MAX_SOURCE_BYTES,
      'SOURCE_INVALID','Import an original UTF-8 source up to 4 MiB.');
    return {requestId:input.requestId,expectedRevision:input.expectedRevision,label:input.label,
      sourceId:digest(Buffer.from(input.sourceText)),sourceBytes:Buffer.byteLength(input.sourceText)};
  }
  if(action==='commit') {
    fields(input,['requestId','expectedRevision','reviewId','actor','reference','callbacksRegistered'],'setup commit');
    requestId(input.requestId);revision(input.expectedRevision);id(input.reviewId);
    text(input.actor,'reviewing operator',160);text(input.reference??'','review reference',2000,true);
    need(input.callbacksRegistered===true,'CALLBACK_INVALID','Confirm the exact displayed callback registrations.');
    return {...input,reference:input.reference??''};
  }
  fields(input,['requestId','expectedRevision','editionId'],'edition activation');
  requestId(input.requestId);revision(input.expectedRevision);id(input.editionId);
  return {...input};
}

 
async function verifyPlan(directory,state,plan,options) {
  need(!plan.context.allowLoopbackOAuth || options.policy.allowLoopbackOAuth===true,'CALLBACK_INVALID',
    'The original local-provider setup still requires its receiving-host permission.');
  need(eq(plan.runtimeBinding,options.runtimeBinding),'SOURCE_CHANGED',
    'Resume this setup with its original selected runtime and source identity.',409);
  for(const source of plan.sourceIds)await sourceRecord(directory,state,source);
  for(const entry of plan.entries) {
    let normalized;
    try{normalized=normalizeOAuthProfile(entry.profile,{allowLoopback:plan.context.allowLoopbackOAuth});}
    catch{fail('REVIEW_CHANGED','A retained reviewed profile is invalid.',409);}
    need(eq(normalized,entry.profile) && oauthProfileIdentity(normalized)===entry.profileSha256 &&
      callbackUri(normalized,entry.profileSha256,plan.context.port)===entry.callbackUri,
      'REVIEW_CHANGED','A retained profile or callback no longer matches its source review.',409);
    if(entry.definition) {
      const source=await sourceRecord(directory,state,entry.sourceId);
      const derived=await desiredDefinition(entry.definition,source.text,plan.context,options);
      need(eq(derived.profile,entry.profile),'SOURCE_CHANGED','The reviewed profile no longer matches its exact source.',409);
    }
    if(entry.kind==='retained')await checkConnection(entry,plan.context.allowLoopbackOAuth);
  }
  await options.validateReview?.({entries:plan.entries,context:plan.context,runtimeBinding:options.runtimeBinding});
}
async function validatePrepared(directory,edition,options) {
  need(!edition.context.allowLoopbackOAuth || options.policy.allowLoopbackOAuth===true,'CALLBACK_INVALID',
    'This local-provider edition requires explicit receiving-host permission.');
  await options.validatePrepared?.({prepared:prepared(directory,edition),entries:edition.entries,
    context:edition.context,runtimeBinding:options.runtimeBinding});
}
function planMarkdown(plan,editionId,actor,reference) {
  const json=value=>JSON.stringify(value,null,2).replaceAll(String.fromCharCode(96),'\\u0060');
  return '# OpenAPI connection setup\n\nThis immutable edition prepares registered profiles and original private stores. It does not authorize an account or publish a merchant.\n\n'+
    '1. Apply the returned registry, private environment and listener port to the existing API merchant application.\n'+
    '2. Save through Applications, review its current start inputs, connect and start the original managed workspace.\n'+
    '3. Open its connection controls to authorize the selected account and review the returned grant. Select that current grant before compiling a merchant.\n'+
    '4. Source or client changes use a separate reviewed profile/store. Selecting a previous setup edition never rolls back tokens or changes an already running application.\n\n'+
    'Exact reviewed edition and callback registrations:\n\n~~~json\n'+json({editionId,actor,reference,
      connections:plan.entries.map(({alias,directoryEnv,sourceId,profileSha256,callbackUri})=>
        ({alias,directoryEnv,sourceId,profileSha256,callbackUri})),changes:plan.changes})+'\n~~~\n\n'+
    'The private environment file preserves original declared values plus the reviewed directory references. It is deliberately unavailable through normal downloads. Keep full workspace recovery private.\n';
}
async function commitEdition(directory,state,command,options) {
  const plan=await retainedReview(directory,state,command.input.reviewId);
  need(plan.revision===command.input.expectedRevision && plan.contextBinding===command.contextBinding,
    'REVIEW_CHANGED','Resume the exact original setup review.',409);
  await verifyPlan(directory,state,plan,options);
  const editionId=command.editionId,root=join(directory,'editions',editionId);
  await directoryIdentity(root,{create:true});
  const environmentPath=join(root,'environment.json');
  let environmentRaw;
  try{environmentRaw=await readOwned(environmentPath,65536);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(environmentRaw) {
    need(digest(environmentRaw)===plan.environmentSha256,'EDITION_CHANGED','The retained private environment edition changed.',409);
  } else {
    // Before this checkpoint exists, all original review inputs must still match.
    const snapshot=await contextSnapshot(directory,state,command.context,command.runtimeBinding,options.policy);
    need(snapshot.binding===plan.contextBinding,'CONTEXT_CHANGED',
      'The reviewed source registry or environment changed before its private copy was retained.',409);
    const environment=environmentFor(snapshot,plan.entries);
    need(environment.sha256===plan.environmentSha256,'CONTEXT_CHANGED','The reviewed environment composition changed.',409);
    environmentRaw=environment.raw;
    await immutable(environmentPath,environmentRaw);
  }
  const entries=[];
  for(const entry of plan.entries)entries.push(await initializeEntry(state,entry,plan.context.allowLoopbackOAuth));
  const registry={schema:HOST_CONNECTIONS_SCHEMA,
    connections:normalizeOAuthHostConnections(entries.map(({alias,directoryEnv})=>({alias,directoryEnv})))};
  const sources=plan.sourceIds.map(value=>state.sources.find(source=>source.id===value));
  const review={...publicReview(plan),actor:command.input.actor,reference:command.input.reference,
    callbacksRegistered:true,at:command.at};
  const outputs=new Map([
    ['connections.json',bytes(registry)],
    ['profiles.json',bytes({schema:schema('profiles'),entries:entries.map(publicEntry)})],
    ['review.json',bytes(review)],
    ['source-manifest.json',bytes({schema:schema('source-manifest'),sources,
      externalProfileSources:entries.filter(entry=>!plan.sourceIds.includes(entry.sourceId))
        .map(({alias,sourceId,profileSha256})=>({alias,sourceId,profileSha256}))})],
    ['environment.json',environmentRaw],
    ['operator-plan.md',Buffer.from(planMarkdown(plan,editionId,command.input.actor,command.input.reference))],
  ]);
  for(const [name,content] of outputs)await immutable(join(root,name),content);
  const files=[...outputs].map(([path,body])=>({path,bytes:body.length,sha256:digest(body),private:path==='environment.json'}));
  const edition={schema:schema('edition'),id:editionId,sequence:state.editions.length+1,createdAt:command.at,
    reviewId:plan.id,requestId:command.requestId,entryCount:entries.length,
    registrySha256:digest(outputs.get('connections.json')),environmentSha256:digest(environmentRaw),
    runtimeBinding:plan.runtimeBinding,context:plan.context,entries,sources,review:{
      actor:command.input.actor,reference:command.input.reference,callbacksRegistered:true,at:command.at},
    changes:plan.changes,files};
  const editionRaw=retainedBytes(edition);
  await immutable(join(root,'edition.json'),editionRaw);
  const indexed={...summary(edition),editionSha256:digest(editionRaw)};
  await checkedEdition(directory,{...state,editions:[...state.editions,indexed]},edition.id);
  await validatePrepared(directory,edition,options);
  return {delta:{kind:'edition',edition:indexed},
    result:{schema:schema('commit'),revision:state.revision+1,edition:publicEdition(edition),
      prepared:prepared(directory,edition),operation:{requestId:command.requestId,action:'commit',state:'completed'}}};
}
async function executeCommand(directory,state,command,options) {
  if(command.action==='commit')return commitEdition(directory,state,command,options);
  if(['source.import','source.provider'].includes(command.action)) {
    const retained=command.action==='source.provider'?command.providerSource:command.input;
    need(retained && Number.isSafeInteger(retained.sourceBytes) && retained.sourceBytes>0,
      'SOURCE_CHANGED','The original source import metadata is unavailable.',409);
    const raw=await readOwned(join(directory,'sources',command.input.sourceId+'.source'),MAX_SOURCE_BYTES);
    need(raw.length===retained.sourceBytes && digest(raw)===command.input.sourceId,
      'SOURCE_CHANGED','The original imported source is missing or changed.',409);
    const viewed=inspectSetupSource(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
    const source=state.sources.find(value=>value.id===command.input.sourceId)??{
      id:command.input.sourceId,sha256:command.input.sourceId,bytes:raw.length,label:retained.label,
      title:viewed.inspection.title,importedAt:command.at};
    return {delta:{kind:'source',source},result:{revision:state.revision+1,source,...viewed,
      ...(command.action==='source.provider'?{provider:command.input.provider,
        factorySha256:retained.factorySha256}:{})}};
  }
  const edition=await checkedEdition(directory,state,command.input.editionId);
  await validatePrepared(directory,edition,options);
  return {delta:{kind:'activate',editionId:edition.id},result:{schema:schema('activation'),
    revision:state.revision+1,edition:publicEdition(edition),prepared:prepared(directory,edition),
    operation:{requestId:command.requestId,action:'activate',state:'completed'}}};
}
function receiptPath(directory,request) {
  return join(directory,'receipts',identity({requestId:requestId(request)})+'.json');
}
async function retainedReceipt(directory,request) {
  const receipt=await optional(receiptPath(directory,request));
  if(!receipt)return null;
  need(receipt.schema===schema('receipt') && receipt.command?.requestId===request &&
    plain(receipt.delta) && plain(receipt.result),'EDITION_CHANGED','A retained setup receipt is invalid.',409);
  const {receiptSha256,...payload}=receipt;
  need(identity(payload)===receiptSha256,'EDITION_CHANGED','A retained setup receipt changed.',409);
  return receipt;
}
async function finishCommand(directory,state,command,options) {
  need(state.pending?.requestId===command.requestId && state.pending.inputHash===command.inputHash &&
    state.revision===command.input.expectedRevision,'REVISION_CHANGED','The retained setup publication state changed.',409);
  let receipt=await retainedReceipt(directory,command.requestId);
  if(receipt)need(eq(receipt.command,command),'REQUEST_CHANGED','The retained receipt belongs to another exact command.',409);
  else {
    const complete=await executeCommand(directory,state,command,options);
    const payload={schema:schema('receipt'),command,...complete,completedAt:stamp()};
    receipt={...payload,receiptSha256:identity(payload)};
    await immutable(receiptPath(directory,command.requestId),retainedBytes(receipt));
  }
  const next={...state,revision:state.revision+1,updatedAt:receipt.completedAt,pending:null};
  if(receipt.delta.kind==='source') {
    const source=receipt.delta.source;
    if(!next.sources.some(value=>value.id===source.id))next.sources=[...next.sources,source];
    await sourceRecord(directory,next,source.id);
  } else if(receipt.delta.kind==='edition') {
    next.editions=[...next.editions,receipt.delta.edition];
    next.currentEditionId=receipt.delta.edition.id;
    const edition=await checkedEdition(directory,next,next.currentEditionId);
    await validatePrepared(directory,edition,options);
  } else {
    need(receipt.delta.kind==='activate','EDITION_CHANGED','The retained setup action has no valid publication.',409);
    next.currentEditionId=receipt.delta.editionId;
    const edition=await checkedEdition(directory,next,next.currentEditionId);
    await validatePrepared(directory,edition,options);
  }
  need(receipt.result.revision===next.revision,'EDITION_CHANGED','The retained result revision is inconsistent.',409);
  retainedBytes(next);
  await atomicJson(directory,'setup.json',next);
  return receipt.result;
}
async function mutate(directory,state,action,context,input,options) {
  const normalized=commandBody(action,input),selected=normalizeContext(context);
  const inputHash=identity({action,context:selected,runtimeBinding:options.runtimeBinding,input:normalized});
  const prior=await retainedReceipt(directory,normalized.requestId);
  if(prior && state.pending?.requestId!==normalized.requestId) {
    need(prior.command.action===action && prior.command.inputHash===inputHash,'REQUEST_CHANGED',
      'This request ID belongs to another exact setup command. Use retained status or recovery.',409);
    return prior.result;
  }
  let command=state.pending;
  if(command) {
    need(command.requestId===normalized.requestId,'COMMAND_PENDING',
      'Resume the existing retained setup command before beginning another mutation.',423);
    need(command.action===action && command.inputHash===inputHash,'REQUEST_CHANGED',
      'Retry this request unchanged, or use recovery to resume its retained original inputs.',409);
  } else {
    need(normalized.expectedRevision===state.revision,'REVISION_CHANGED','Refresh the current setup before preparing another command.',409);
    need(!prior,'REQUEST_CHANGED','The retained request already has a completed result.',409);
    let contextBinding=null,providerSource;
    if(action==='commit') {
      const plan=await retainedReview(directory,state,normalized.reviewId);
      need(plan.revision===state.revision && plan.baseEditionId===state.currentEditionId &&
        eq(plan.runtimeBinding,options.runtimeBinding),'REVISION_CHANGED','Review the current original registry before creating an edition.',409);
      const snapshot=await contextSnapshot(directory,state,selected,options.runtimeBinding,options.policy);
      need(snapshot.binding===plan.contextBinding,'CONTEXT_CHANGED','The original registry, environment or runtime changed after review.',409);
      need(environmentFor(snapshot,plan.entries).sha256===plan.environmentSha256,'CONTEXT_CHANGED','The reviewed environment changed.',409);
      await verifyPlan(directory,state,plan,options);
      contextBinding=plan.contextBinding;
    } else if(action==='activate') {
      const edition=await checkedEdition(directory,state,normalized.editionId);
      await validatePrepared(directory,edition,options);
    }
    else {
      // Retain original bytes before the pending journal; an unreferenced source
      // object is inert and can be reused by the same import after a lost write.
      let sourceText=input.sourceText;
      if (action==='source.provider') {
        need(options.providers,'PROVIDER_UNAVAILABLE','Use the selected original provider source adapter.',409);
        const original=await options.providers.source(normalized.provider,normalized.sourceId);
        sourceText=original.sourceText;
        need(digest(Buffer.from(sourceText))===normalized.sourceId &&
          Buffer.byteLength(sourceText)===original.source.bytes,
          'SOURCE_CHANGED','The original provider descriptor changed before import.',409);
        providerSource={sourceBytes:original.source.bytes,label:original.label,
          factorySha256:original.factorySha256};
      }
      inspectSetupSource(sourceText);
      await immutable(join(directory,'sources',normalized.sourceId+'.source'),Buffer.from(sourceText));
    }
    command={schema:schema('command'),requestId:normalized.requestId,action,inputHash,
      input:normalized,context:selected,runtimeBinding:options.runtimeBinding,contextBinding,
      at:stamp(),phase:'prepared',...(providerSource?{providerSource}:{}),...(action==='commit'?{
        editionId:identity({workspaceId:state.workspaceId,requestId:normalized.requestId,inputHash})}:{})};
    state={...state,pending:command};
    retainedBytes(state);
    try{await atomicJson(directory,'setup.json',state);}
    catch{fail('RECOVERY_REQUIRED','Read this request status before retrying; retaining its pending journal has an uncertain outcome.',409);}
  }
  try{return await finishCommand(directory,state,command,options);}
  catch(error){
    if(error.code==='OAUTH_SETUP_REQUEST_CHANGED')throw error;
    fail('RECOVERY_REQUIRED','The exact setup command is retained. Use Resume retained operation after restoring any changed original inputs.',409);
  }
}


async function readOperation(directory,state,requested,runtimeBinding) {
  const receipt=await retainedReceipt(directory,requested);
  const pending=state.pending?.requestId===requested?state.pending:null;
  const command=pending??receipt?.command;
  if(!command)return null;
  need(eq(command.runtimeBinding,runtimeBinding),'SOURCE_CHANGED',
    'Select the original runtime to read or resume this retained setup request.',409);
  return {requestId:command.requestId,action:command.action,inputHash:command.inputHash,
    state:pending?'pending':'completed',
    ...(pending?{phase:receipt?'publication_retained':pending.phase}:{result:receipt.result})};
}
async function route(directory,state,action,context,input,options) {
  if (action===HOST_EDITION) return hostEdition(directory,state,input,options);
  if(action==='catalog') {
    fields(input,[],'setup catalog');
    let snapshot,contextError=null;
    try{snapshot=await contextSnapshot(directory,state,context,options.runtimeBinding,options.policy);}
    catch(error){const safe=setupError(error);contextError={code:safe.code,message:safe.message};}
    const unavailable=new Set((snapshot?.baseEntries??[]).map(entry=>entry.directoryEnv));
    return {schema:schema('catalog'),enabled:true,workspaceId:state.workspaceId,revision:state.revision,
      currentEditionId:state.currentEditionId,sources:state.sources,
      editions:state.editions.map(summary),baseEntries:(snapshot?.baseEntries??[]).map(entry=>({
        alias:entry.alias,directoryEnv:entry.directoryEnv,profileSha256:entry.profileSha256,profile:entry.profile,
        callbackUri:entry.callbackUri,grant:entry.grant,
        entry:{retainAlias:entry.alias,expectedProfileSha256:entry.profileSha256},
        ...(entry.definition?{definition:entry.definition}:{})})),
      clientSecretEnvs:Object.keys(snapshot?.environment.effective??{}).filter(name=>
        envName(name) && !['HOME','CODEX_HOME'].includes(name) && !unavailable.has(name) &&
        typeof snapshot.environment.effective[name]==='string' && snapshot.environment.effective[name].length>0).sort(),
      limits,providers:options.providers?await options.providers.catalog():[],
      policy:{allowLoopbackOAuth:options.policy.allowLoopbackOAuth===true},contextError,
      runtimeBinding:options.runtimeBinding,pending:pendingView(state.pending)};
  }
  if(action==='source.inspect') {
    fields(input,['sourceId'],'source inspection');
    const source=await sourceRecord(directory,state,input.sourceId);
    return {source:source.record,...inspectSetupSource(source.text)};
  }
  if(action==='review') {
    need(!state.pending,'COMMAND_PENDING','Resume the current setup command before preparing a different review.',423);
    return makeReview(directory,state,context,input,options);
  }
  if(['source.import','source.provider','commit','activate'].includes(action))return mutate(directory,state,action,context,input,options);
  if(action==='recover') {
    fields(input,['requestId'],'retained setup recovery');requestId(input.requestId);
    const operation=await readOperation(directory,state,input.requestId,options.runtimeBinding);
    need(operation,'REQUEST_UNKNOWN','No retained command exists for this request. Re-select the original source if its import never reached the journal.',409);
    if(operation.state==='completed')return operation.result;
    need(state.pending?.requestId===input.requestId,'COMMAND_PENDING','Resume the currently retained setup request.',423);
    need(!state.pending.context.allowLoopbackOAuth || options.policy.allowLoopbackOAuth===true,
      'CALLBACK_INVALID','The original local-provider recovery needs its receiving host permission.');
    try{return await finishCommand(directory,state,state.pending,options);}
    catch(error){
      if(error.code==='OAUTH_SETUP_REQUEST_CHANGED' || error.code==='OAUTH_SETUP_SOURCE_CHANGED')throw error;
      fail('RECOVERY_REQUIRED','This exact setup command remains retained. Restore its original reviewed inputs and resume again.',409);
    }
  }
  if(action==='status') {
    fields(input,['editionId','requestId'],'setup status');
    const operation=input.requestId===undefined?null:await readOperation(directory,state,requestId(input.requestId),options.runtimeBinding);
    const basic={revision:state.revision,currentEditionId:state.currentEditionId,
      edition:null,prepared:null,connections:[],pending:pendingView(state.pending),operation};
    // Request lookup remains available when the current form reverted or a different
    // edition needs repair. Its own original receipt is the authority for recovery.
    if(input.requestId!==undefined && input.editionId===undefined)return basic;
    const selected=input.editionId??state.currentEditionId;
    if(selected===null)return basic;
    const edition=await checkedEdition(directory,state,selected);
    const connections=[];
    for(const entry of edition.entries)connections.push({alias:entry.alias,directoryEnv:entry.directoryEnv,
      ...await checkConnection(entry,edition.context.allowLoopbackOAuth)});
    return {...basic,edition:publicEdition(edition),prepared:prepared(directory,edition),connections};
  }
  if(action==='download') {
    fields(input,['editionId','kind'],'setup download');
    const names={'profile-review':'profiles.json',registry:'connections.json',
      'source-manifest':'source-manifest.json','operator-plan':'operator-plan.md'};
    need(own(names,input.kind),'INPUT_INVALID','Choose a public profile, registry, source manifest or operator plan download.');
    const edition=await checkedEdition(directory,state,input.editionId,{checkConnections:false});
    const name=names[input.kind],raw=await readOwned(join(directory,'editions',edition.id,name));
    return {filename:'oauth-setup-'+edition.id.slice(0,12)+'-'+name,
      mime:name.endsWith('.md')?'text/markdown; charset=utf-8':'application/json',
      content:new TextDecoder('utf-8',{fatal:true}).decode(raw)};
  }
  fail('INPUT_INVALID','Choose a supported setup action.');
}

async function hostEdition(directory,state,input,options) {
  fields(input,['editionId','alias','expectedProfileSha256'],'host edition selection');
  id(input.editionId);
  need(typeof input.alias==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(input.alias) &&
    hex(input.expectedProfileSha256),'INPUT_INVALID','Select the exact reviewed edition, alias and profile.');
  const edition=await checkedEdition(directory,state,input.editionId);
  await validatePrepared(directory,edition,options);
  const entry=edition.entries.find(value=>value.alias===input.alias);
  need(entry && entry.profileSha256===input.expectedProfileSha256,'PROFILE_CHANGED',
    'The selected immutable edition contains a different alias or profile.',409);
  const provider=entry.profile.provider?.kind==='intuit-quickbooks'?'quickbooks':
    entry.profile.provider?.kind==='xero-accounting'?'xero':null;
  need(provider && options.providers,'PROVIDER_UNAVAILABLE',
    'Select a reviewed original QuickBooks or Xero profile supported by this runtime.',409);
  const original=await options.providers.source(provider,entry.sourceId);
  need(original.source.sha256===entry.profile.source.sha256 &&
    original.source.scheme===entry.profile.source.scheme,'SOURCE_CHANGED',
    'The native accounting source no longer matches this selected setup profile.',409);
  const environment=await privateEnvironment({environmentFile:join(directory,'editions',edition.id,'environment.json')});
  need(environment.sha256===edition.environmentSha256,'EDITION_CHANGED',
    'The immutable environment changed while resolving its native accounting selection.',409);
  const status=await checkConnection(entry,edition.context.allowLoopbackOAuth);
  const selectionRoot=options.selectionRoot??join(options.ownerDirectory,'oauth-accounting');
  absolute(selectionRoot);
  need(selectionRoot!==options.ownerDirectory && [directory,options.grantRoot].every(root=>
    selectionRoot!==root && !selectionRoot.startsWith(root+'/') && !root.startsWith(selectionRoot+'/')),
    'DIRECTORY_CHANGED','Keep native accounting selections separate from setup editions and grant stores.',409);
  const selectionRootIdentity=await directoryIdentity(selectionRoot,{create:true});
  const selectionKey=identity({workspaceId:state.workspaceId,alias:entry.alias,profileSha256:entry.profileSha256});
  const selectionDirectory=join(selectionRoot,selectionKey);
  await directoryIdentity(selectionDirectory,{create:true});
  const marker={schema:schema('accounting-selection-owner'),ownerWorkspaceId:state.ownerWorkspaceId,
    workspaceId:state.workspaceId,provider,alias:entry.alias,profileSha256:entry.profileSha256,selectionKey};
  const markerPath=join(selectionDirectory,'setup-owner.json');
  const previous=await optional(markerPath);
  if(previous)need(eq(previous,marker),'DIRECTORY_CHANGED',
    'The native accounting selection directory belongs to a different setup profile.',409);
  else {
    need((await readdir(selectionDirectory)).length===0,'DIRECTORY_CHANGED',
      'An unowned existing selection directory cannot be adopted implicitly.',409);
    await immutable(markerPath,bytes(marker));
  }
  const selectionDirectoryIdentity=await directoryIdentity(selectionDirectory);
  return {
    schema:schema('host-edition'),ownerWorkspaceId:state.ownerWorkspaceId,workspaceId:state.workspaceId,
    revision:state.revision,currentEditionId:state.currentEditionId,
    edition:summary(edition),runtimeBinding:options.runtimeBinding,provider,
    prepared:prepared(directory,edition),
    registry:{path:join(directory,'editions',edition.id,'connections.json'),sha256:edition.registrySha256,
      connections:edition.entries.map(({alias,directoryEnv})=>({alias,directoryEnv}))},
    environmentFile:{path:join(directory,'editions',edition.id,'environment.json'),sha256:edition.environmentSha256},
    environment:{...environment.effective},entry:structuredClone(entry),status,
    selection:{directory:selectionDirectory,key:selectionKey,owner:marker,
      rootIdentity:selectionRootIdentity,directoryIdentity:selectionDirectoryIdentity},
  };
}

/**
 * Host-only private binding. It is deliberately unreachable from string action
 * routes and ordinary download handlers. The caller must never serialize its
 * environment field to HTTP, normal command output, logs or a public artifact.
 * Resolving prepares only the owned empty company/tenant selection directory;
 * original native selection helpers retain all grant and company write authority.
 */
export function resolveOAuthSetupEdition(options,input) {
  return oauthSetupAction(options,{action:HOST_EDITION,input});
}

/** The caller owns these destinations; HTTP adapters must not accept path overrides. */
export async function oauthSetupAction({
  directory,grantRoot,ownerDirectory,ownerWorkspaceId,runtimeBinding=null,policy={},validateReview,validatePrepared,
  providers,selectionRoot,
}={}, {action,context={},input={}}={}) {
  try {
    absolute(directory);absolute(grantRoot);absolute(ownerDirectory);
    need(directory!==grantRoot && !directory.startsWith(grantRoot+'/') && !grantRoot.startsWith(directory+'/'),
      'DIRECTORY_CHANGED','Keep setup editions and private grant stores in separate host-owned directories.',409);
    text(ownerWorkspaceId,'original workspace identity',160);
    need(runtimeBinding===null || plain(runtimeBinding),'INPUT_INVALID','Use the original installed runtime identity.');
    fields(policy,['allowLoopbackOAuth'],'receiving host policy');
    need(policy.allowLoopbackOAuth===undefined || typeof policy.allowLoopbackOAuth==='boolean',
      'INPUT_INVALID','Use an explicit host local-provider policy.');
    await directoryIdentity(ownerDirectory);
    await directoryIdentity(directory,{create:true});
    await directoryIdentity(grantRoot,{create:true});
    need([validateReview,validatePrepared].every(value=>value===undefined || typeof value==='function'),
      'INPUT_INVALID','Use receiving-host runtime validators supplied by the original application facade.');
    need(providers===undefined || providers && ['catalog','source','normalizeDefinition']
      .every(name=>typeof providers[name]==='function'),'INPUT_INVALID',
      'Use the original trusted provider adapter supplied by the receiving host.');
    const options={directory,grantRoot,ownerDirectory,ownerWorkspaceId,runtimeBinding,policy,validateReview,
      validatePrepared,providers,selectionRoot};
    return await withConnectionLock(directory,async()=>{
      const roots={owner:await directoryIdentity(ownerDirectory),
        setup:await directoryIdentity(directory),grants:await directoryIdentity(grantRoot)};
      let state=await optional(join(directory,'setup.json'));
      if(state)validateState(state,roots,ownerWorkspaceId);
      else {
        for(const name of CHILDREN) {
          const path=join(directory,name);await directoryIdentity(path,{create:true});
          need((await readdir(path)).length===0,'DIRECTORY_CHANGED',
            'This setup has retained files but no original workspace identity. Restore its original setup record.',409);
        }
        need((await readdir(grantRoot)).length===0,'DIRECTORY_CHANGED',
          'This grant root already has retained stores. Restore its original setup identity instead of replacing it.',409);
        state={schema:SETUP_SCHEMA,workspaceId:randomUUID(),ownerWorkspaceId,roots,
          createdAt:stamp(),updatedAt:stamp(),revision:0,sources:[],editions:[],currentEditionId:null,pending:null};
        await atomicJson(directory,'setup.json',state);
      }
      for(const name of CHILDREN)await directoryIdentity(join(directory,name));
      return route(directory,state,action,context,input,options);
    },{name:'oauth-setup.lock',waitSeconds:30});
  } catch(error) {
    if(error.code==='SHEETS_OAUTH_CONNECTION_BUSY')fail('COMMAND_PENDING','The original setup writer is still running. Read its status before retrying.',423);
    throw setupError(error);
  }
}
