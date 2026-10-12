// SPDX-License-Identifier: MIT
// Recovery control over the separately owned original collection listener.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,readdir,rename,unlink,lstat} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {isDeepStrictEqual as same} from 'node:util';
import {initializationDirectory as privateDirectory,initializationBytes as privateBytes,
  optionalInitializationBytes as optionalBytes,retainInitializationRecord as retainRecord}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {collectionsWorkspaceUrl,COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA,
  COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/launch.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {nativeCollectionRecoveryOperations} from './native-collections-recovery-schema.mjs';
export {nativeCollectionRecoveryActions,nativeCollectionRecoverySchema} from './native-collections-recovery-schema.mjs';

export const NATIVE_COLLECTION_RECOVERY_SCHEMA='stellar-forge.mcp-native-collection-recovery.v1';
export const NATIVE_COLLECTION_RECOVERY_PROFILE='stellar-forge.mcp-native-collection-recovery-profile.v1';
const SCHEMA=NATIVE_COLLECTION_RECOVERY_SCHEMA;
const JOURNAL='stellar-forge.sf88.collection-recovery-operation.v1';
const STATUS='stellar-forge.sf88.collections-workspace.v1';
const STORE='stellar-forge.sf88.collections.v1';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MEMBER=/^(manifest\.json|objects\/[0-9]{6}\.gcm)$/;
const PASS=/^[A-Z][A-Z0-9_]{4,63}$/;
const KINDS=['SNAPSHOT','VERIFY','RESTORE'],TERMINAL=['COMPLETED','FAILED','CANCELLED'];
const MAX_JSON=32*1024*1024,MAX_TOOL=256*1024,MAX_FILE=2*1024**3+64;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const encoded=v=>Buffer.from(JSON.stringify(v));
const fail=code=>{throw new InputError(code);};
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
const safeCode=e=>/^[A-Z0-9_]{1,160}$/.test(e?.code??'')?e.code:'MCP_COLLECTION_RECOVERY_FAILED';
function fields(value,allowed){
  need(object(value)&&Object.keys(value).every(k=>allowed.includes(k)),'MCP_COLLECTION_RECOVERY_ARGUMENTS_INVALID');
  return value;
}
function alias(v){need(typeof v==='string'&&ALIAS.test(v),'MCP_COLLECTION_RECOVERY_ALIAS_REQUIRED');return v;}
function hash(v){need(typeof v==='string'&&HASH.test(v),'MCP_COLLECTION_RECOVERY_HASH_REQUIRED');return v;}
function uuid(v){need(typeof v==='string'&&UUID.test(v),'MCP_COLLECTION_RECOVERY_REQUEST_ID_REQUIRED');return v;}
function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&v!=='/'&&!v.includes('\0'),
    'MCP_COLLECTION_RECOVERY_PRIVATE_PATH_REQUIRED');return v;
}
function inside(root,path){const r=relative(root,path);return r===''||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);}
function parse(raw){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('MCP_COLLECTION_RECOVERY_JSON_INVALID');}
}
async function json(path,max=65536){return parse(await privateBytes(path,max));}
function page(items,body={}){
  const offset=body.offset??0,limit=body.limit??25;
  need(Number.isSafeInteger(offset)&&offset>=0&&offset<=items.length&&
    Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_COLLECTION_RECOVERY_PAGE_INVALID');
  return {items:items.slice(offset,offset+limit),offset,total:items.length,
    nextOffset:offset+limit<items.length?offset+limit:null};
}
function pathMap(value){
  need(object(value)&&Object.keys(value).length<=500,'MCP_COLLECTION_RECOVERY_REGISTRATION_INVALID');
  return Object.fromEntries(Object.entries(value).map(([key,path])=>[alias(key),absolute(path)]));
}
function profileValue(value,manifest,mode,connectionFile){
  fields(value,['schema','label','stateRoot','bundle','passEnv','python','kinds','afterRestore']);
  need(value.schema===NATIVE_COLLECTION_RECOVERY_PROFILE,'MCP_COLLECTION_RECOVERY_PROFILE_INVALID');
  const stateRoot=absolute(value.stateRoot),bundle=absolute(value.bundle);
  need(!inside(stateRoot,bundle)&&!inside(bundle,stateRoot),'MCP_COLLECTION_RECOVERY_BUNDLE_OVERLAPS_TARGET');
  need(!inside(stateRoot,manifest.directory)&&!inside(stateRoot,manifest.workspace),
    'MCP_COLLECTION_RECOVERY_NATIVE_BUYER_INSIDE_TARGET');
  need(Array.isArray(value.kinds)&&value.kinds.length>0&&value.kinds.length<=3&&
    new Set(value.kinds).size===value.kinds.length&&value.kinds.every(v=>KINDS.includes(v)),
    'MCP_COLLECTION_RECOVERY_PROFILE_KINDS_REQUIRED');
  if(value.kinds.includes('SNAPSHOT'))need(mode==='COLLECTIONS','MCP_COLLECTION_RECOVERY_SOURCE_LISTENER_REQUIRED');
  if(value.kinds.includes('RESTORE'))need(mode==='RECEIVING'&&!inside(stateRoot,connectionFile),
    'MCP_COLLECTION_RECOVERY_SEPARATE_RECEIVER_REQUIRED');
  const passEnv=value.passEnv??'SF88_BACKUP_PASSPHRASE',python=absolute(value.python??'/usr/bin/python3');
  need(typeof passEnv==='string'&&PASS.test(passEnv),'MCP_COLLECTION_RECOVERY_PASSPHRASE_NAME_INVALID');
  need(value.label===undefined||typeof value.label==='string'&&value.label.length<=240,
    'MCP_COLLECTION_RECOVERY_PROFILE_LABEL_INVALID');
  let afterRestore;
  if(value.afterRestore!==undefined){
    fields(value.afterRestore,['name','sources','buyers']);
    need(value.kinds.includes('RESTORE'),'MCP_COLLECTION_RECOVERY_RESTORE_PROFILE_REQUIRED');
    afterRestore={name:alias(value.afterRestore.name),
      sources:pathMap(value.afterRestore.sources??{}),buyers:pathMap(value.afterRestore.buyers??{})};
  }
  return {schema:value.schema,label:value.label??'',stateRoot,bundle,passEnv,python,kinds:[...value.kinds],
    ...(afterRestore?{afterRestore}:{})};
}
function launch(value){
  let original=value;
  if([COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA,COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA]
    .includes(value?.original?.schema))original={...value.original,state:'LISTENING',url:value.url};
  need(original?.state==='LISTENING'&&Number.isSafeInteger(original.pid)&&original.pid>0,
    'MCP_COLLECTION_RECOVERY_ORIGINAL_LAUNCH_REQUIRED');
  const address=collectionsWorkspaceUrl(original.url);
  need(address,'MCP_COLLECTION_RECOVERY_LOOPBACK_LAUNCH_REQUIRED');
  const url=new URL(address),token=url.hash.slice(1);url.hash='';
  let selection;
  if(original.schema===COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA){
    need(['BROWSER','TERMINAL'].includes(original.approvalMode),'MCP_COLLECTION_RECOVERY_ORIGINAL_LAUNCH_REQUIRED');
    selection={mode:'COLLECTIONS',directory:absolute(original.directory),queueRoot:absolute(original.queueRoot),
      approvalMode:original.approvalMode,journalDirectory:join(original.directory,'recovery')};
  }else{
    need(original.schema===COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA,
      'MCP_COLLECTION_RECOVERY_ORIGINAL_LAUNCH_REQUIRED');
    selection={mode:'RECEIVING',journalDirectory:absolute(original.receivingDirectory)};
  }
  return {url,token,pid:original.pid,selection};
}
function publicProfile(name,value){
  return {name,sha256:value.sha256,bytes:value.bytes,label:value.value.label,kinds:value.value.kinds,
    passphraseConfiguredByHost:true,afterRestoreCollection:value.value.afterRestore?.name??null};
}
function compactResult(value){
  if(!object(value))return null;
  const p=value.application?.profile;
  return {...pick(value,['status','recordSha256','bundle','collectionCount','requestCount','publicationRecovered',
    'archiveWarning','reopenError','executionStarted','originalStateRetained']),
    target:value.target?pick(value.target,['state']):null,
    reopened:value.reopened?{...pick(value.reopened,['directory','queueRoot','requests','unresolvedAttempts','executionStarted']),
      collections:value.reopened.collections??[]}:null,
    application:p?{schema:value.application.schema,operationId:value.application.operationId,
      profile:{...pick(p,['schema','directory','queueRoot','stateRoot','headerSha256','reviewSha256']),
        collections:(p.collections??[]).map(v=>pick(v,['id','name','itemCount','state','manifestSha256','statusSha256'])),
        requestCount:p.jobs?.length??value.requestCount??null}}:null,
    encryptedFiles:Array.isArray(value.encryptedFiles)?value.encryptedFiles.map(v=>pick(v,['name','path','bytes','sha256'])):null};
}
function publicOperation(view,profileName,profileSha256,body={},summary=false){
  const result=view.result??null,p=result?.application?.profile,collections=p?.collections??[];
  const selected=summary?{items:[],offset:0,total:collections.length,nextOffset:collections.length?0:null}:page(collections,body);
  return {...pick(view,['requestId','kind','state','createdAt','completedAt','persistenceError','source','reused']),
    profile:profileName,profileSha256,error:view.error?pick(view.error,['code']):null,
    progress:(summary?(view.progress??[]).slice(-1):view.progress??[]).map(v=>pick(v,['at','phase','stage','state','bytes','files','completed','total'])),
    result:result?{...pick(result,['status','recordSha256','collectionCount','requestCount','publicationRecovered',
      'archiveWarning','reopenError','executionStarted','originalStateRetained']),
      target:result.target?pick(result.target,['state']):null,
      sourceReviewSha256:p?.reviewSha256??null,
      collectionCount:result.collectionCount??p?.collections?.length??null,
      requestCount:result.requestCount??p?.requestCount??p?.jobs?.length??null,
      collections:selected.items.map(v=>pick(v,['id','name','itemCount','state','manifestSha256'])),
      collectionOffset:selected.offset,totalCollections:selected.total,nextCollectionOffset:selected.nextOffset,
      reopened:result.reopened?{...pick(result.reopened,['requests','executionStarted']),
        unresolvedAttemptCount:result.reopened.unresolvedAttempts?.length??0}:null}:null,
    executionStarted:false};
}

/** Host registration stores exact profile bytes. Calls borrow, never start or stop, the original host. */
export function createNativeCollectionRecovery({manifest,registerCollections,isClosed=()=>false}={}){
  need(object(manifest),'MCP_COLLECTION_RECOVERY_NATIVE_WORKSPACE_REQUIRED');
  manifest=structuredClone(manifest);
  const nativeRoot=absolute(manifest.directory),root=join(nativeRoot,'collection-recovery');
  const workspaces=join(root,'workspaces'),operations=join(root,'operations'),connections=join(root,'connections');
  const reader=createSavedFileReader(),shutdown=new AbortController(),pending=new Set();
  const documents=new Map(),validatedRegistrations=new Map();let documentBytes=0;
  let closed=false;
  async function document(path,maximum=65536,optional=false){
    let before;
    try{await privateDirectory(dirname(path));before=await lstat(path,{bigint:true});}
    catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
    need(before.isFile()&&(before.mode&0o077n)===0n&&
      (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid()))&&before.size<=BigInt(maximum),
      'MCP_COLLECTION_RECOVERY_PRIVATE_FILE_REQUIRED');
    const keys=['dev','ino','size','mtimeNs','ctimeNs'],stamp=keys.map(k=>String(before[k])).join(':');
    const prior=documents.get(path);
    if(prior?.stamp===stamp)return prior;
    const raw=await privateBytes(path,maximum),after=await lstat(path,{bigint:true});
    need(keys.every(k=>before[k]===after[k]),'MCP_COLLECTION_RECOVERY_RETAINED_FILE_CHANGED');
    const current={value:parse(raw),sha256:sha(raw),bytes:raw.length,stamp};
    if(prior)documentBytes-=prior.bytes;
    documents.delete(path);documents.set(path,current);documentBytes+=current.bytes;
    while(documents.size>32||documentBytes>32*1024*1024){
      const key=documents.keys().next().value;documentBytes-=documents.get(key).bytes;documents.delete(key);
    }
    return current;
  }
  const available=()=>need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
  async function roots(create=false){
    await privateDirectory(nativeRoot);
    if(!create&&await optionalBytes(join(root,'format.json'),1024)===null)return false;
    for(const path of [root,workspaces,operations,connections])await privateDirectory(path,{create});
    if(create)await retainRecord(join(root,'format.json'),{schema:SCHEMA},{resume:true});
    need((await json(join(root,'format.json'))).schema===SCHEMA,'MCP_COLLECTION_RECOVERY_FORMAT_CHANGED');
    return true;
  }
  async function request(connection,path,body,signal){
    available();signal?.throwIfAborted();
    const options={method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+connection.token,Origin:connection.url.origin},
      signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])])};
    if(body!==undefined){
      const raw=encoded(body);need(raw.length<=256*1024,'MCP_COLLECTION_RECOVERY_REQUEST_TOO_LARGE');
      options.headers['Content-Type']='application/json';options.body=raw;
    }
    let response,raw;
    try{
      response=await fetch(new URL(path,connection.url),options);
      const declared=response.headers.get('content-length');
      need(declared===null||/^[0-9]+$/.test(declared)&&Number(declared)<=MAX_JSON,
        'MCP_COLLECTION_RECOVERY_RESPONSE_TOO_LARGE');
      const chunks=[];let size=0;
      for await(const part of response.body??[]){
        size+=part.length;need(size<=MAX_JSON,'MCP_COLLECTION_RECOVERY_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part));
      }
      need(declared===null||size===Number(declared),'MCP_COLLECTION_RECOVERY_RESPONSE_INCOMPLETE');
      raw=Buffer.concat(chunks,size);
    }catch(error){
      signal?.throwIfAborted();
      if(/^MCP_COLLECTION_RECOVERY_RESPONSE_/.test(error.code??''))throw error;
      fail(body===undefined?'MCP_COLLECTION_RECOVERY_SERVICE_UNAVAILABLE':
        'MCP_COLLECTION_RECOVERY_REPLY_UNCERTAIN_USE_ORIGINAL_REQUEST_ID');
    }
    const value=parse(raw);
    if(!response.ok)fail(/^[A-Z0-9_]{1,160}$/.test(value?.error??'')?value.error:'MCP_COLLECTION_RECOVERY_HTTP_'+response.status);
    return value;
  }
  async function journal(record){
    await privateDirectory(record.journalDirectory);
    const retained=await document(join(record.journalDirectory,'recovery.json'),65536),value=retained.value;
    need(value.schema===JOURNAL&&value.directory===record.journalDirectory&&retained.sha256===record.journalSha256,
      'MCP_COLLECTION_RECOVERY_ORIGINAL_JOURNAL_CHANGED');
    await privateDirectory(join(record.journalDirectory,'operations'));
  }
  async function connect(record,signal){
    const connection=launch(await json(record.connectionFile));
    need(same(connection.selection,record.selection),'MCP_COLLECTION_RECOVERY_ORIGINAL_LAUNCH_CHANGED');
    await journal(record);
    const state=await request(connection,'/api/status',undefined,signal);
    need(state.schema===STATUS&&state.recoveryDirectory===record.journalDirectory&&
      ['COLLECTIONS','RECEIVING'].includes(state.mode),'MCP_COLLECTION_RECOVERY_ORIGINAL_LISTENER_CHANGED');
    need(state.recoveryApi>=1&&state.connectionApi>=1,'MCP_COLLECTION_RECOVERY_CURRENT_HOST_REQUIRED');
    if(record.selection.mode==='COLLECTIONS')need(state.mode==='COLLECTIONS'&&
      state.directory===record.selection.directory&&state.queueRoot===record.selection.queueRoot&&
      state.paymentApproval===(record.selection.approvalMode==='BROWSER'?'original-browser':'original-terminal'),
      'MCP_COLLECTION_RECOVERY_ORIGINAL_LISTENER_CHANGED');
    return {...connection,state};
  }
  async function registered(name){
    alias(name);need(await roots(),'MCP_COLLECTION_RECOVERY_NOT_REGISTERED');
    const retained=await document(join(workspaces,name+'.json'),8*1024*1024),record=retained.value;
    if(validatedRegistrations.get(name)===retained.sha256)return record;
    need(record.schema===SCHEMA&&record.name===name&&record.nativeWorkspace===nativeRoot&&
      object(record.profiles),'MCP_COLLECTION_RECOVERY_REGISTRATION_CHANGED');
    absolute(record.connectionFile);absolute(record.journalDirectory);hash(record.journalSha256);
    for(const [key,p]of Object.entries(record.profiles)){
      alias(key);absolute(p.path);hash(p.sha256);
      need(typeof p.rawBase64==='string'&&Number.isSafeInteger(p.bytes)&&p.bytes>=1&&p.bytes<=65536,
        'MCP_COLLECTION_RECOVERY_PROFILE_CHANGED');
      const raw=Buffer.from(p.rawBase64,'base64');
      need(raw.toString('base64')===p.rawBase64&&raw.length===p.bytes&&sha(raw)===p.sha256&&
        same(profileValue(parse(raw),manifest,record.selection.mode,record.connectionFile),p.value),
        'MCP_COLLECTION_RECOVERY_PROFILE_CHANGED');
    }
    validatedRegistrations.set(name,retained.sha256);
    return record;
  }
  async function register(description={}){
    available();fields(description,['name','connectionFile','profiles']);
    const name=alias(description.name),connectionFile=absolute(description.connectionFile);
    const selected=launch(await json(connectionFile));
    need(object(description.profiles)&&Object.keys(description.profiles).length>=1&&
      Object.keys(description.profiles).length<=64,'MCP_COLLECTION_RECOVERY_PROFILES_REQUIRED');
    const raw=await privateBytes(join(selected.selection.journalDirectory,'recovery.json'),65536),head=parse(raw);
    need(head.schema===JOURNAL&&head.directory===selected.selection.journalDirectory,
      'MCP_COLLECTION_RECOVERY_ORIGINAL_JOURNAL_CHANGED');
    const profiles={};
    for(const [name,path]of Object.entries(description.profiles)){
      alias(name);absolute(path);const raw=await privateBytes(path,65536);
      const value=profileValue(parse(raw),manifest,selected.selection.mode,connectionFile);
      if(value.kinds.includes('RESTORE'))need(!inside(value.stateRoot,selected.selection.journalDirectory)&&
        !inside(selected.selection.journalDirectory,value.stateRoot),'MCP_COLLECTION_RECOVERY_SEPARATE_RECEIVER_REQUIRED');
      profiles[name]={path,bytes:raw.length,sha256:sha(raw),rawBase64:raw.toString('base64'),value};
    }
    const record={schema:SCHEMA,name,nativeWorkspace:nativeRoot,connectionFile,selection:selected.selection,
      journalDirectory:selected.selection.journalDirectory,journalSha256:sha(raw),profiles};
    need(encoded(record).length<=8*1024*1024,'MCP_COLLECTION_RECOVERY_REGISTRATION_TOO_LARGE');
    await connect(record);await roots(true);
    await retainRecord(join(workspaces,name+'.json'),record,{resume:true});
    return {schema:SCHEMA,name,state:'ORIGINAL_RECOVERY_SERVICE_REGISTERED',mode:record.selection.mode,
      profiles:Object.entries(profiles).map(([key,p])=>publicProfile(key,p))};
  }
  function selectedProfile(record,body){
    const name=alias(body.profile),p=record.profiles[name];
    need(p&&p.sha256===hash(body.expectedProfileSha256),'MCP_COLLECTION_RECOVERY_PROFILE_CHANGED');
    return {name,...p};
  }
  function matches(profile,request){
    const o=request?.options,p=profile.value;
    if(!KINDS.includes(request?.kind)||!(p.kinds.includes(request.kind)||request.kind==='VERIFY'&&p.kinds.includes('RESTORE'))||!object(o)||o.passEnv!==p.passEnv)return false;
    if(request.kind==='SNAPSHOT')return o.stateRoot===p.stateRoot&&o.output===p.bundle&&
      o.quiesced===true&&HASH.test(o.expectedReviewSha256??'');
    return o.bundle===p.bundle&&o.python===p.python&&
      (o.expected===undefined||HASH.test(o.expected))&&
      (o.expectedStateRoot===undefined||o.expectedStateRoot===p.stateRoot)&&
      (request.kind!=='RESTORE'||o.expectedStateRoot===p.stateRoot&&HASH.test(o.expected??''));
  }
  async function operationDirectory(record,id,create=false){
    const parent=join(operations,record.name),path=join(parent,uuid(id));
    await privateDirectory(parent,{create});await privateDirectory(path,{create});return path;
  }
  function validateRequest(record,profile,request,id){
    need(request?.schema===JOURNAL&&request.requestId===id&&matches(profile,request)&&
      request.selection===JSON.stringify(request.options),'MCP_COLLECTION_RECOVERY_ORIGINAL_OPERATION_CHANGED');
  }
  async function cached(record,profile,id){
    let value;
    try{value=(await document(join(await operationDirectory(record,id),'terminal.json'),MAX_JSON)).value;}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    need(value.schema===SCHEMA&&value.workspace===record.name&&value.profile===profile.name&&
      value.profileSha256===profile.sha256&&value.journalSha256===record.journalSha256&&
      HASH.test(value.sourceRequestSha256??'')&&HASH.test(value.sourceResultSha256??''),
      'MCP_COLLECTION_RECOVERY_RETAINED_RESULT_CHANGED');
    validateRequest(record,profile,value.request,id);
    need(TERMINAL.includes(value.state),'MCP_COLLECTION_RECOVERY_RETAINED_RESULT_CHANGED');
    return {...value,source:'retained-terminal'};
  }
  async function original(record,profile,id){
    uuid(id);let reqDoc,resDoc;
    try{
      await journal(record);
      const path=join(record.journalDirectory,'operations',id);await privateDirectory(path);
      reqDoc=await document(join(path,'request.json'),65536);
      resDoc=await document(join(path,'result.json'),MAX_JSON,true);
    }catch(error){if(error.code!=='ENOENT')throw error;return cached(record,profile,id);}
    const request=reqDoc.value;validateRequest(record,profile,request,id);
    if(!resDoc)return {request,requestId:id,kind:request.kind,createdAt:request.createdAt,
      state:'LIVE_STATE_UNOBSERVED',source:'original-request',result:null};
    const result=resDoc.value;
    const prior=await cached(record,profile,id);
    if(prior){
      need(prior.sourceRequestSha256===reqDoc.sha256&&prior.sourceResultSha256===resDoc.sha256,
        'MCP_COLLECTION_RECOVERY_ORIGINAL_RESULT_CHANGED');
      return {...prior,source:'original-journal'};
    }
    need(result.schema===JOURNAL&&result.requestId===id&&result.selection===request.selection&&
      TERMINAL.includes(result.state),'MCP_COLLECTION_RECOVERY_ORIGINAL_RESULT_CHANGED');
    const terminal={schema:SCHEMA,workspace:record.name,profile:profile.name,profileSha256:profile.sha256,
      journalSha256:record.journalSha256,sourceRequestSha256:reqDoc.sha256,sourceResultSha256:resDoc.sha256,
      request,requestId:id,kind:request.kind,createdAt:request.createdAt,state:result.state,
      completedAt:result.completedAt,result:compactResult(result.result),error:result.error??null};
    if(terminal.state==='COMPLETED'&&terminal.result?.application?.profile)
      need(terminal.result.application.profile.stateRoot===profile.value.stateRoot,
        'MCP_COLLECTION_RECOVERY_TARGET_BINDING_CHANGED');
    await retainRecord(join(await operationDirectory(record,id,true),'terminal.json'),terminal,{resume:true});
    return {...terminal,source:'original-journal'};
  }
  async function observed(record,profile,id,signal){
    const saved=await original(record,profile,id);
    if(saved&&TERMINAL.includes(saved.state))return saved;
    try{
      const connection=await connect(record,signal),live=await request(connection,'/api/recovery/'+uuid(id),undefined,signal);
      validateRequest(record,profile,{schema:live.schema,requestId:live.requestId,kind:live.kind,
        options:live.options,selection:JSON.stringify(live.options)},id);
      const durable=await original(record,profile,id);
      return durable&&TERMINAL.includes(durable.state)?durable:{...live,source:'original-listener'};
    }catch(error){
      if(error.code==='MCP_COLLECTION_RECOVERY_SERVICE_UNAVAILABLE'&&saved)return saved;
      throw error;
    }
  }
  async function completed(record,profile,id,expected){
    const saved=await original(record,profile,id);
    need(saved?.state==='COMPLETED'&&saved.result?.recordSha256===hash(expected)&&
      saved.result.application?.profile?.stateRoot===profile.value.stateRoot&&
      saved.result.bundle===profile.value.bundle,'MCP_COLLECTION_RECOVERY_COMPLETED_ORIGINAL_REQUIRED');
    return saved;
  }
  function filesOf(saved){
    const bundle=absolute(saved.result.bundle),files=saved.result.encryptedFiles;
    need(Array.isArray(files)&&files.length>=1&&files.length<=10001&&new Set(files.map(v=>v?.name)).size===files.length,
      'MCP_COLLECTION_RECOVERY_ENCRYPTED_FILES_REQUIRED');
    for(const file of files)need(MEMBER.test(file?.name??'')&&file.path===join(bundle,file.name)&&
      Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&HASH.test(file.sha256??''),
      'MCP_COLLECTION_RECOVERY_ENCRYPTED_FILE_CHANGED');
    need(files.some(v=>v.name==='manifest.json'&&v.bytes<=MAX_JSON),'MCP_COLLECTION_RECOVERY_MANIFEST_REQUIRED');
    return files;
  }
  async function atomicConnection(path,value){
    const bytes=encoded(value),temporary=join(dirname(path),'.launch-'+randomUUID());
    let handle;
    try{
      handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      await rename(temporary,path);
      const directory=await open(dirname(path),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
    }finally{await handle?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async function openRestored(record,profile,id,expected,signal){
    const saved=await completed(record,profile,id,expected),p=saved.result.application.profile;
    need(saved.kind==='RESTORE'&&saved.result.reopened&&!saved.result.reopenError,
      'MCP_COLLECTION_RECOVERY_SUCCESSFUL_RESTORE_REQUIRED');
    const connection=await connect(record,signal);
    if(connection.state.mode==='RECEIVING'){
      await request(connection,'/api/recovery/'+id+'/open',{},signal);
    }else need(connection.state.directory===p.directory&&connection.state.queueRoot===p.queueRoot,
      'MCP_COLLECTION_RECOVERY_DIFFERENT_COLLECTION_ALREADY_OPEN');
    const current=await request(connection,'/api/connection',undefined,signal);
    need(current?.schema===COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA&&current.state==='LISTENING'&&
      current.pid===connection.pid&&current.directory===p.directory&&current.queueRoot===p.queueRoot&&
      current.url===connection.url.origin+'/#'+connection.token&&['BROWSER','TERMINAL'].includes(current.approvalMode),
      'MCP_COLLECTION_RECOVERY_ORIGINAL_CONNECTION_CHANGED');
    const header=await privateBytes(join(p.directory,'collections.json'),65536),head=parse(header);
    need(sha(header)===p.headerSha256&&head.schema===STORE&&head.queueRoot===p.queueRoot,
      'MCP_COLLECTION_RECOVERY_RESTORED_STORE_CHANGED');
    const list=await request(connection,'/api/collections',undefined,signal);
    need(Array.isArray(list.collections)&&p.collections.every(selected=>
      list.collections.some(v=>v.id===selected.id&&v.manifestSha256===selected.manifestSha256)),
      'MCP_COLLECTION_RECOVERY_RESTORED_COLLECTIONS_CHANGED');
    const parent=join(connections,record.name);await privateDirectory(parent,{create:true});
    const folder=join(parent,id);await privateDirectory(folder,{create:true});
    const connectionFile=join(folder,'connection.json'),raw=encoded(current);
    await retainRecord(join(folder,sha(raw)+'.json'),current,{resume:true});
    await atomicConnection(connectionFile,current);
    let registration=null;
    if(profile.value.afterRestore){
      need(typeof registerCollections==='function','MCP_COLLECTION_RECOVERY_COLLECTION_REGISTRAR_REQUIRED');
      try{registration=await registerCollections({...profile.value.afterRestore,connectionFile});}
      catch(error){registration={state:'REGISTRATION_FAILED',error:safeCode(error),retry:'OPEN_SAME_ORIGINAL_RESTORE'};}
    }
    return {requestId:id,recordSha256:expected,opened:true,connectionRetained:true,
      collectionWorkspace:profile.value.afterRestore?.name??null,registration,
      collections:list.collections.slice(0,25).map(v=>pick(v,['id','name','state','manifestSha256','itemCount'])),
      totalCollections:list.collections.length,nextCollectionOffset:list.collections.length>25?25:null,
      restorationRepeated:false,executionStarted:false};
  }
  async function openedConnection(name,id){
    const record=await registered(name),folder=join(connections,record.name,uuid(id));
    const connectionFile=join(folder,'connection.json'),raw=await privateBytes(connectionFile,65536);
    const current=launch(parse(raw));
    need(current.selection.mode==='COLLECTIONS','MCP_COLLECTION_RECOVERY_ORIGINAL_CONNECTION_REQUIRED');
    return {schema:SCHEMA,workspace:record.name,requestId:id,connectionFile,sha256:sha(raw),bytes:raw.length};
  }
  async function perform(args={},context={}){
    available();fields(args,['action','recoveryWorkspace','recoveryOperation','recoveryRequest']);
    need(args.action==='collection-recovery'&&object(context)&&
      (context.signal===undefined||context.signal instanceof AbortSignal),'MCP_COLLECTION_RECOVERY_ARGUMENTS_INVALID');
    const operation=args.recoveryOperation,spec=nativeCollectionRecoveryOperations[operation],body=args.recoveryRequest??{};
    need(spec,'MCP_COLLECTION_RECOVERY_OPERATION_REQUIRED');fields(body,Object.keys(spec.properties));
    need(spec.required.every(key=>Object.hasOwn(body,key)),'MCP_COLLECTION_RECOVERY_OPERATION_FIELDS_REQUIRED');
    if(operation==='workspaces'){
      if(!await roots())return {schema:SCHEMA,operation,...page([],body)};
      const entries=(await readdir(workspaces,{withFileTypes:true})).filter(v=>v.isFile()&&
        v.name.endsWith('.json')&&ALIAS.test(v.name.slice(0,-5))).sort((a,b)=>a.name.localeCompare(b.name));
      const selection=page(entries,body),items=[];
      for(const item of selection.items){const record=await registered(item.name.slice(0,-5));
        items.push({name:record.name,mode:record.selection.mode,profiles:Object.keys(record.profiles).length});}
      return {schema:SCHEMA,operation,...selection,items};
    }
    const record=await registered(args.recoveryWorkspace);
    const result=value=>{
      const output={schema:SCHEMA,workspace:record.name,operation,value};
      need(encoded(output).length<=MAX_TOOL,'MCP_COLLECTION_RECOVERY_TOOL_PAGE_TOO_LARGE');return structuredClone(output);
    };
    if(operation==='profiles')return result(page(Object.entries(record.profiles)
      .map(([key,p])=>publicProfile(key,p)),body));
    if(operation==='history'){
      let rows,source,total,nextOffset;
      try{
        const c=await connect(record,context.signal),view=await request(c,'/api/recovery/history',body,context.signal);
        need(view.schema===JOURNAL&&Array.isArray(view.rows),'MCP_COLLECTION_RECOVERY_ORIGINAL_JOURNAL_CHANGED');
        rows=view.rows;source='original-listener';total=view.total;nextOffset=view.hasMore?view.offset+rows.length:null;
      }catch(error){
        if(!['MCP_COLLECTION_RECOVERY_SERVICE_UNAVAILABLE','ENOENT'].includes(error.code))throw error;
        let entries=[];try{entries=await readdir(join(operations,record.name),{withFileTypes:true});}
        catch(e){if(e.code!=='ENOENT')throw e;}
        const all=[];
        for(const entry of entries.filter(v=>v.isDirectory()&&UUID.test(v.name))){
          for(const [name,p]of Object.entries(record.profiles)){
            let saved;try{saved=await cached(record,{name,...p},entry.name);}
            catch(e){if(e.code==='MCP_COLLECTION_RECOVERY_RETAINED_RESULT_CHANGED')continue;throw e;}
            if(saved){all.push(saved);break;}
          }
        }
        all.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||a.requestId.localeCompare(b.requestId));
        const selected=page(all,body);rows=selected.items;source='retained-terminal';
        total=selected.total;nextOffset=selected.nextOffset;
      }
      const items=[];let outsideRegisteredProfiles=0;
      for(const row of rows){
        const request=row.request??{kind:row.kind,options:row.options};
        const found=Object.entries(record.profiles).find(([,p])=>matches(p,request));
        if(!found){outsideRegisteredProfiles++;continue;}
        const [name,p]=found;items.push(publicOperation({...row,source},name,p.sha256,{},true));
      }
      return result({source,offset:body.offset??0,total,nextOffset,outsideRegisteredProfiles,items});
    }
    const profile=selectedProfile(record,body);
    if(operation==='review'){
      need(profile.value.kinds.includes('SNAPSHOT'),'MCP_COLLECTION_RECOVERY_CAPTURE_PROFILE_REQUIRED');
      const c=await connect(record,context.signal),value=await request(c,'/api/recovery/review',
        {stateRoot:profile.value.stateRoot},context.signal),p=value.profile;
      need(p?.stateRoot===profile.value.stateRoot&&HASH.test(p.reviewSha256??''),
        'MCP_COLLECTION_RECOVERY_SOURCE_REVIEW_CHANGED');
      return result({profile:profile.name,profileSha256:profile.sha256,reviewSha256:p.reviewSha256,
        ...(()=>{const selected=page(p.collections??[],body);return {collections:selected.items.map(v=>pick(v,['id','name','state','itemCount','manifestSha256'])),
          collectionOffset:selected.offset,totalCollections:selected.total,nextCollectionOffset:selected.nextOffset};})(),
        requestCount:p.jobs?.length??0,retainedInputCount:p.retainedInputs?.length??0,
        missingInputCount:p.missing?.length??0,operatorCount:p.operators?.length??0,
        restoreMode:p.restoreMode,walletEnvironmentExported:false,automaticExecution:false});
    }
    const id=uuid(body.requestId);
    if(operation==='inspect')return result(publicOperation(await observed(record,profile,id,context.signal),profile.name,profile.sha256,body));
    if(operation==='start'){
      need(profile.value.kinds.includes(body.kind),'MCP_COLLECTION_RECOVERY_PROFILE_KIND_NOT_SELECTED');
      const p=profile.value;let options;
      if(body.kind==='SNAPSHOT'){
        need(body.quiesced===true&&body.verifiedRequestId===undefined&&body.expectedRecordSha256===undefined,
          'MCP_COLLECTION_RECOVERY_QUIESCED_SOURCE_REVIEW_REQUIRED');
        options={passEnv:p.passEnv,stateRoot:p.stateRoot,output:p.bundle,
          expectedReviewSha256:hash(body.expectedReviewSha256),quiesced:true};
      }else{
        need(body.expectedReviewSha256===undefined&&body.quiesced===undefined,
          'MCP_COLLECTION_RECOVERY_ARGUMENTS_INVALID');
        options={passEnv:p.passEnv,bundle:p.bundle,python:p.python,
          ...(body.expectedRecordSha256===undefined?{}:{expected:hash(body.expectedRecordSha256)}),
          expectedStateRoot:p.stateRoot};
        if(body.kind==='RESTORE'){
          const verified=await completed(record,profile,uuid(body.verifiedRequestId),body.expectedRecordSha256);
          need(verified.kind==='VERIFY','MCP_COLLECTION_RECOVERY_COMPLETED_VERIFICATION_REQUIRED');
        }else need(body.kind==='VERIFY'&&body.verifiedRequestId===undefined,'MCP_COLLECTION_RECOVERY_ARGUMENTS_INVALID');
      }
      const binding={schema:SCHEMA,workspace:record.name,profile:profile.name,profileSha256:profile.sha256,
        journalSha256:record.journalSha256,requestId:id,kind:body.kind,options,
        ...(body.verifiedRequestId?{verifiedRequestId:body.verifiedRequestId}:{})};
      await retainRecord(join(await operationDirectory(record,id,true),'selection.json'),binding,{resume:true});
      const prior=await original(record,profile,id);
      if(prior){
        need(prior.request.kind===body.kind&&same(prior.request.options,options),
          'MCP_COLLECTION_RECOVERY_REQUEST_CHANGED');
        return result(publicOperation({...await observed(record,profile,id,context.signal),reused:true},profile.name,profile.sha256));
      }
      const c=await connect(record,context.signal),view=await request(c,'/api/recovery/start',
        {requestId:id,kind:body.kind,options},context.signal);
      validateRequest(record,profile,{schema:view.schema,requestId:view.requestId,kind:view.kind,
        options:view.options,selection:JSON.stringify(view.options)},id);
      return result(publicOperation(view,profile.name,profile.sha256));
    }
    if(operation==='cancel'||operation==='resume'){
      const before=await original(record,profile,id);
      need(before,'MCP_COLLECTION_RECOVERY_ORIGINAL_OPERATION_NOT_FOUND');
      if(TERMINAL.includes(before.state))return result(publicOperation({...before,reused:true},profile.name,profile.sha256));
      const c=await connect(record,context.signal),view=await request(c,'/api/recovery/'+id+'/'+operation,{},context.signal);
      return result(publicOperation(view,profile.name,profile.sha256));
    }
    if(operation==='open')return result(await openRestored(record,profile,id,hash(body.expectedRecordSha256),context.signal));
    const saved=await completed(record,profile,id,body.expectedRecordSha256),files=filesOf(saved);
    if(operation==='files'){
      const manifest=files.find(v=>v.name==='manifest.json');
      // The original operation authenticated this manifest and every cipher member.
      // Pin its current bytes here; each requested member is independently verified by the native range reader.
      await reader({destination:manifest.path,bytes:manifest.bytes,sha256:manifest.sha256},{maxBytes:1});
      const selected=page(files,body);
      return result({requestId:id,recordSha256:body.expectedRecordSha256,
        manifest:pick(manifest,['name','bytes','sha256']),memberVerification:'ON_ORIGINAL_FILE_READ',...selected,
        items:selected.items.map(v=>pick(v,['name','bytes','sha256']))});
    }
    need(operation==='file'&&MEMBER.test(body.filename??''),'MCP_COLLECTION_RECOVERY_FILE_REQUIRED');
    const file=files.find(v=>v.name===body.filename);
    need(file?.sha256===hash(body.expectedFileSha256),'MCP_COLLECTION_RECOVERY_ENCRYPTED_FILE_CHANGED');
    const chunk=await reader({destination:file.path,bytes:file.bytes,sha256:file.sha256},body);
    context.signal?.throwIfAborted();available();
    return result({requestId:id,recordSha256:body.expectedRecordSha256,filename:file.name,
      manifestSha256:files.find(v=>v.name==='manifest.json').sha256,
      file:pick(chunk,['bytes','sha256','byteOffset','returnedBytes','encoding','data','nextByteOffset','verifiedSavedFile'])});
  }
  async function track(task){
    available();const promise=Promise.resolve().then(task);pending.add(promise);
    try{return await promise;}finally{pending.delete(promise);}
  }
  return {register:v=>track(()=>register(v)),openedConnection:(name,id)=>track(()=>openedConnection(name,id)),
    call:(args,context)=>track(()=>perform(args,context)),
    async close(){if(closed)return;closed=true;shutdown.abort();await Promise.allSettled([...pending]);documents.clear();validatedRegistrations.clear();}};
}
