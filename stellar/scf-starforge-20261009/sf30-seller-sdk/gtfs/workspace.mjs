// MIT. Whole GTFS authoring over the original Frictionless publisher, schedules and retained-file reader.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir, rename, unlink, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { openPostgresSchedule } from '../postgres/publisher/schedule.mjs';
import { frictionlessPublisherDriver } from '../frictionless/driver.mjs';
import { prepareFrictionlessRelease, stageFrictionlessRelease } from '../frictionless/release.mjs';
import { object, absolute, privateDirectory, acquireWorkspace, bytes, digest, identity, readPrivate,
  readJson, hashPrivate, createFile, atomicJson, syncDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { GTFS_WORKSPACE_SCHEMA, GTFS_ZIP_MAX_BYTES, inspectGtfsArchive, compileGtfsEdition,
  inspectGtfsEdition, readGtfsRows, readGtfsSourceRows, compareGtfsEditions, runGtfsArchiveCommand } from './source.mjs';

export const GTFS_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const GTFS_SHA256 = /^[a-f0-9]{64}$/;
const STATE_MAX = 16 * 1024 * 1024;
const INPUT_MAX = 1024 * 1024;
const FILE_MAX = 8 * 1024 * 1024 * 1024;
const KINDS = new Set(['retainFeed','createEdition','compareEditions','saveDecision','selectEdition','prepareRelease','stageRelease']);
const PUBLISHER = Object.freeze({ directory:'publisher', sourceFile:'selected-source.json', targetDirectory:'dataset' });
const driver = Object.freeze({ ...frictionlessPublisherDriver, sourceName:'GTFS Schedule' });
const copy = value => structuredClone(value);
const only = (value, fields, required = []) => {
  if (!object(value) || Object.keys(value).some(key=>!fields.includes(key)) || required.some(key=>!Object.hasOwn(value,key)))
    throw fault('GTFS_INPUT_INVALID','Use this operation’s declared fields.');
};
const uuid = value => { if (!GTFS_UUID.test(value ?? '')) throw fault('GTFS_ID_REQUIRED','Use the retained UUID.'); return value; };
const sha = value => { if (!GTFS_SHA256.test(value ?? '')) throw fault('GTFS_SHA256_REQUIRED','Use the exact displayed SHA-256.'); return value; };
const note = (value,label,maximum=2000,empty=false) => {
  if (typeof value !== 'string' || value.length>maximum || value.includes('\0') || !empty && !value.trim())
    throw fault('GTFS_TEXT_REQUIRED','Enter '+label+'.');
  return value.trim();
};
const safeError = issue => ({code:/^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code??'')?issue.code:'GTFS_OPERATION_FAILED',
  message:typeof issue?.message==='string'?issue.message.slice(0,2000):'The native operation did not complete.'});
async function exists(path) { try { await lstat(path); return true; } catch (issue) { if(issue.code==='ENOENT')return false; throw issue; } }
function page(list, offset=0, limit=25) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw fault('GTFS_PAGE_INVALID','Use a nonnegative offset and 1–100 records.');
  return {items:copy(list.slice(offset,offset+limit)),offset,limit,total:list.length,next:offset+limit<list.length?offset+limit:null};
}
async function finishLinkedPublication(path,content) {
  const original=await lstat(path);
  if(original.nlink===1)return;
  if(!original.isFile()||original.isSymbolicLink()||original.mode&0o077||original.nlink!==2||original.size!==content.length)
    throw fault('GTFS_PRIVATE_ARTIFACT_REQUIRED','The original private publication is not a recoverable retained file.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true}),raw=await handle.readFile(),after=await handle.stat({bigint:true});
    if(!raw.equals(content)||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
      throw fault('GTFS_RETAINED_INPUT_CHANGED','The interrupted original publication differs from the retained request.',409);
    const prefix=basename(path)+'.pending-';
    let recovered=false;
    for(const name of await readdir(dirname(path))) {
      if(!name.startsWith(prefix)||!GTFS_UUID.test(name.slice(prefix.length)))continue;
      const candidate=join(dirname(path),name),stat=await lstat(candidate);
      if(stat.isFile()&&!stat.isSymbolicLink()&&BigInt(stat.dev)===before.dev&&BigInt(stat.ino)===before.ino) {
        await unlink(candidate);recovered=true;break;
      }
    }
    if(!recovered)throw fault('GTFS_PRIVATE_ARTIFACT_REQUIRED','The original publication has an unrelated hard link.');
    await syncDirectory(dirname(path));
  } finally {await handle.close();}
}
async function sameFile(path, content) {
  if(await exists(path)) {
    await finishLinkedPublication(path,content);
    const original=await readPrivate(path,Math.max(content.length,1));
    if(!original.equals(content))throw fault('GTFS_RETAINED_INPUT_CHANGED','This original request already retains different bytes.',409);
    return;
  }
  await privateDirectory(dirname(path),true);
  const temporary=path+'.pending-'+randomUUID();
  try {
    await createFile(temporary,content);
    try { await link(temporary,path); }
    catch(issue) {
      if(issue.code!=='EEXIST')throw issue;
      if(!(await readPrivate(path,Math.max(content.length,1))).equals(content))
        throw fault('GTFS_RETAINED_INPUT_CHANGED','The retained request differs from its original bytes.',409);
    }
  } finally { await unlink(temporary).catch(issue=>{if(issue.code!=='ENOENT')throw issue;}); }
  await syncDirectory(dirname(path));
}
export async function readGtfsInputFile(path) {
  path=absolute(resolve(path),'original GTFS ZIP');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size<1n||before.size>BigInt(GTFS_ZIP_MAX_BYTES))
      throw fault('GTFS_INPUT_SIZE','Choose one complete original ZIP of at most 16 MiB.');
    const content=await file.readFile(),after=await file.stat({bigint:true});
    if(BigInt(content.length)!==before.size||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
      throw fault('GTFS_INPUT_CHANGED','The original ZIP changed during reading.');
    return content;
  } finally { await file.close(); }
}
function validState(value) {
  if(!object(value)||value.schema!==GTFS_WORKSPACE_SCHEMA||!GTFS_UUID.test(value.id??'')||
     !Number.isSafeInteger(value.revision)||value.revision<0||identity(value.publisher)!==identity(PUBLISHER))
    throw fault('GTFS_WORKSPACE_INVALID','Reopen a complete original GTFS workspace.');
  for(const key of ['feeds','editions','comparisons','decisions','releases','exports']) {
    if(!Array.isArray(value[key])||value[key].length>20000||value[key].some(item=>!object(item)||!GTFS_UUID.test(item.id??''))||
      new Set(value[key].map(item=>item.id)).size!==value[key].length)
      throw fault('GTFS_WORKSPACE_INVALID','The retained GTFS history is inconsistent.');
  }
  if(!object(value.requests)||Object.keys(value.requests).length>20000||
    Object.keys(value.requests).some(key=>!GTFS_UUID.test(key))||
    value.pending!==null&&(!object(value.pending)||!GTFS_UUID.test(value.pending.requestId??'')||!KINDS.has(value.pending.kind)||
      !GTFS_SHA256.test(value.pending.payloadHash??'')||!object(value.pending.payload)))
    throw fault('GTFS_WORKSPACE_INVALID','The retained original operation journal is inconsistent.');
  if(value.selectedEditionId!==null&&!value.editions.some(item=>item.id===value.selectedEditionId))
    throw fault('GTFS_WORKSPACE_INVALID','The selected original edition is missing.');
  return value;
}


function initialization(value) {
  only(value,['schema','workspaceId','title'],['schema','workspaceId','title']);
  if(value.schema!=='stellar-forge.gtfs-initialization.v1')throw fault('GTFS_INITIALIZATION_CHANGED','Reopen the original workspace initialization.');
  uuid(value.workspaceId);note(value.title,'the original workspace title',128);
  if(value.title!==value.title.trim())throw fault('GTFS_INITIALIZATION_CHANGED');
  return value;
}
function initialState(value,marker) {
  validState(value);
  only(value,['schema','id','title','createdAt','revision','publisher','selectedEditionId','selection',
    'feeds','editions','comparisons','decisions','releases','exports','requests','pending'],
    ['schema','id','title','createdAt','revision','publisher','selectedEditionId','selection',
      'feeds','editions','comparisons','decisions','releases','exports','requests','pending']);
  if(!marker||value.id!==marker.workspaceId||value.title!==marker.title||value.revision!==0||
    value.selectedEditionId!==null||value.selection!==null||value.pending!==null||
    ['feeds','editions','comparisons','decisions','releases','exports'].some(key=>value[key].length)||
    Object.keys(value.requests).length||typeof value.createdAt!=='string'||
    !Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt)
    throw fault('GTFS_INITIALIZATION_CHANGED','The interrupted first workspace publication differs from its original initialization.',409);
  return value;
}
/** Inspect complete first-publication bytes without changing them. Only the
 * acquired root writer may finish their original matching staging link. */
async function readLaunchRecord(path,maximum,validate,{reconcile=false}={}) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let raw,value,linked;
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.mode&0o077n||![1n,2n].includes(before.nlink)||before.size<1n||before.size>BigInt(maximum))
      throw fault('GTFS_PRIVATE_ARTIFACT_REQUIRED','The original launch record is not a complete private file.');
    raw=await handle.readFile();
    const after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
    if(BigInt(raw.length)!==before.size||['dev','ino','size','mtimeNs','ctimeNs','nlink'].some(key=>before[key]!==after[key])||
      named.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino)
      throw fault('GTFS_INITIALIZATION_CHANGED','The original launch record changed while being inspected.',409);
    linked=before.nlink===2n;
    value=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),linked);
    if(linked) {
      if(!raw.equals(bytes(value)))throw fault('GTFS_INITIALIZATION_CHANGED','The interrupted launch publication is not its complete original bytes.',409);
      const prefix=basename(path)+'.pending-';
      let matched=false;
      for(const name of await readdir(dirname(path))) {
        if(!name.startsWith(prefix)||!GTFS_UUID.test(name.slice(prefix.length)))continue;
        const candidate=await lstat(join(dirname(path),name),{bigint:true});
        if(candidate.isFile()&&!candidate.isSymbolicLink()&&candidate.dev===before.dev&&candidate.ino===before.ino) {
          matched=true;break;
        }
      }
      const final=await handle.stat({bigint:true});
      if(!matched||['dev','ino','size','mtimeNs','ctimeNs','nlink'].some(key=>before[key]!==final[key]))
        throw fault('GTFS_PRIVATE_ARTIFACT_REQUIRED','The original launch record has no matching unchanged staging publication.');
    }
  } finally {await handle.close();}
  if(linked&&reconcile) {
    await finishLinkedPublication(path,raw);
    if(!(await readPrivate(path,maximum)).equals(raw))throw fault('GTFS_INITIALIZATION_CHANGED');
  }
  return value;
}
/** Read the original launch identity without taking a writer lease or creating state. */
export async function inspectGtfsLaunch(directory) {
  directory=absolute(resolve(directory),'GTFS workspace');
  if(!await exists(directory))return {schema:'stellar-forge.gtfs-launch-selection.v1',state:'NEW',directory,workspaceId:null};
  await privateDirectory(directory);
  const markerFile=join(directory,'initialization.json'),stateFile=join(directory,'workspace.json');
  const marker=await exists(markerFile)?await readLaunchRecord(markerFile,INPUT_MAX,initialization):null;
  if(await exists(stateFile)) {
    const state=await readLaunchRecord(stateFile,STATE_MAX,(value,linked)=>linked?initialState(value,marker):validState(value));
    return {schema:'stellar-forge.gtfs-launch-selection.v1',state:'SAVED',directory,workspaceId:state.id,
      revision:state.revision,title:state.title};
  }
  if(marker)return {schema:'stellar-forge.gtfs-launch-selection.v1',state:'INITIALIZING',directory,
    workspaceId:marker.workspaceId,title:marker.title};
  const names=await readdir(directory);
  if(names.some(name=>name!=='publisher.lock'&&
    !(name.startsWith('initialization.json.pending-')&&GTFS_UUID.test(name.slice('initialization.json.pending-'.length)))))
    throw fault('GTFS_INITIALIZATION_DIRECTORY_CHANGED','Select a new private directory or a complete original GTFS workspace.');
  return {schema:'stellar-forge.gtfs-launch-selection.v1',state:'NEW',directory,workspaceId:null};
}

/** Opening owns one root lease and one original publisher. The scheduler and
 * browser borrow those native objects; all publisher mutation stays in its model. */
export async function openGtfsWorkspace({directory,create=false,title='GTFS Schedule workspace',
  environment=process.env,exportsDirectory,seller=null,resource=null,releaseStore=null,
  expectedWorkspaceId,createIfMissing=false,startSchedule=true}={}) {
  if(typeof directory!=='string'||!directory)throw fault('GTFS_WORKSPACE_REQUIRED','Select the original private workspace directory.');
  directory=absolute(resolve(directory),'GTFS workspace');
  if(expectedWorkspaceId!==undefined)uuid(expectedWorkspaceId);
  if(createIfMissing&&(create||!expectedWorkspaceId))throw fault('GTFS_INITIALIZATION_ID_REQUIRED','Bind native create/reopen to one original workspace UUID.');
  if(create&&await exists(directory))throw fault('GTFS_WORKSPACE_EXISTS','Reopen this workspace or select a new private directory.',409);
  await privateDirectory(directory,create||createIfMissing);
  let state,rawPublisher,scheduler=null,active=null,closing=false,closePromise;
  const readers=new RetainedFileReads({errorPrefix:'GTFS_FILE'});
  exportsDirectory=absolute(resolve(exportsDirectory??directory+'.exports'),'GTFS exports directory');
  const exportsRelative=relative(directory,exportsDirectory);
  if(exportsRelative===''||!isAbsolute(exportsRelative)&&exportsRelative!=='..'&&!exportsRelative.startsWith('..'+sep))
    throw fault('GTFS_EXPORT_LOCATION','Keep complete workspace archives outside the workspace.');
  if(releaseStore!==null)releaseStore=absolute(resolve(releaseStore),'original SF82 release store');
  const releaseRoot=await acquireWorkspace(directory);
  const rootFile=(...parts)=>join(directory,...parts);
  const lookup=(kind,id)=>{uuid(id);const result=state[kind].find(item=>item.id===id);
    if(!result)throw fault('GTFS_RECORD_NOT_FOUND','Choose a retained '+kind+' record.',404);return result;};
  async function writeState(next) { validState(next);await atomicJson(directory,'workspace.json',next);state=next; }
  async function readAnchored(path,expected,maximum=INPUT_MAX) {
    const content=await readPrivate(path,maximum);
    if(digest(content)!==sha(expected))throw fault('GTFS_RECORD_CHANGED','The retained original record changed.',409);
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));
  }
  async function feed(id) {
    const saved=lookup('feeds',id),inspection=await readAnchored(rootFile('feeds',id,'inspection.json'),saved.inspectionSha256,STATE_MAX);
    if(inspection.feedSha256!==saved.feedSha256||inspection.feedBytes!==saved.feedBytes)
      throw fault('GTFS_RECORD_CHANGED','The retained feed inspection changed.',409);
    return {record:copy(saved),inspection};
  }
  async function edition(id) {
    const saved=lookup('editions',id),value=await readAnchored(rootFile('editions',id,'edition.json'),saved.editionSha256,STATE_MAX);
    if(value.feedSha256!==saved.feedSha256||value.captureSha256!==saved.captureSha256||value.selectionSha256!==saved.selectionSha256)
      throw fault('GTFS_RECORD_CHANGED','The retained edition differs from its saved review.',409);
    return {record:copy(saved),edition:value};
  }
  async function comparison(id) {
    const saved=lookup('comparisons',id);
    return {record:copy(saved),comparison:await readAnchored(rootFile('comparisons',id,'comparison.json'),saved.reportSha256,STATE_MAX)};
  }
  async function verifySelection() {
    if(state.pending)throw fault('GTFS_OPERATION_PENDING','Resume original request '+state.pending.requestId+' before changing publication.',409);
    if(!state.selectedEditionId||!state.selection)
      throw fault('GTFS_EDITION_SELECTION_REQUIRED','Retain a GTFS feed, create an edition and select it for publication.');
    const selected=await edition(state.selectedEditionId);
    const current=await readPrivate(rootFile('selected-source.json'),INPUT_MAX);
    if(digest(current)!==state.selection.sourceSha256||state.selection.editionId!==selected.record.id)
      throw fault('GTFS_SELECTED_SOURCE_CHANGED','Reopen the selected original edition and source binding.',409);
    return selected;
  }
  function available({pending=false}={}) {
    if(closing)throw fault('GTFS_WORKSPACE_CLOSING','This GTFS workspace is closing.',503);
    if(active)throw fault('GTFS_WORKSPACE_BUSY','The original '+active.kind+' operation is still running.',409);
    if(!pending&&state.pending)throw fault('GTFS_OPERATION_PENDING','Resume original request '+state.pending.requestId+'.',409);
  }
  function gate(kind,callback,{pauseScheduler=false,pending=false}={}) {
    available({pending});
    if(pauseScheduler&&(scheduler?.status().active||rawPublisher.status().active))
      throw fault('GTFS_PUBLICATION_ACTIVE','Let the current original publication finish before this workspace operation.',409);
    const operation={kind,controller:new AbortController(),promise:null};active=operation;
    operation.promise=(async()=>{
      let stopped=false;
      try {
        if(pauseScheduler&&scheduler) {
          const previous=scheduler;scheduler=null;stopped=true;await previous.close();
        }
        return await callback(operation.controller.signal);
      } finally {
        try {
          if(stopped&&!closing) {
            scheduler=await openPostgresSchedule({publisher});
            if(startSchedule&&!state.pending)scheduler.start();
          }
        } finally {if(active===operation)active=null;}
      }
    })();
    return operation.promise;
  }
  const publisher={
    get directory(){return rawPublisher.directory;},
    get settings(){return rawPublisher.settings;},
    sourceName:'GTFS Schedule',
    source:async()=>{await verifySelection();return rawPublisher.source();},
    status:(...args)=>{const current=rawPublisher.status(...args);return !current.active&&(active||state.pending)?
      {...current,active:{kind:active?.kind??'recovering GTFS source',id:state.pending?.requestId??null,progress:{}}}:current;},
    plan:(...args)=>rawPublisher.plan(...args),run:(...args)=>rawPublisher.run(...args),
    target:(...args)=>rawPublisher.target(...args),inspect:(...args)=>rawPublisher.inspect(...args),
    candidate:(...args)=>rawPublisher.candidate(...args),buyerOffer:(...args)=>rawPublisher.buyerOffer(...args),
    savePlan:input=>gate('saving the original publisher plan',async()=>{await verifySelection();return rawPublisher.savePlan(input);}),
    review:(...args)=>gate('reviewing the original publisher candidate',()=>rawPublisher.review(...args)),
    publish:(...args)=>gate('publishing the original candidate',()=>rawPublisher.publish(...args)),
    recover:(...args)=>gate('recovering the original publication',()=>rawPublisher.recover(...args)),
    prepareBuyer:(...args)=>gate('preparing the original buyer handoff',()=>rawPublisher.prepareBuyer(...args)),
    startExtraction(...args){
      available();
      const native=rawPublisher.startExtraction(...args);
      const operation={kind:'extracting the original source',controller:null,promise:null};active=operation;
      operation.promise=native.completion.finally(()=>{if(active===operation)active=null;});
      return {id:native.id,completion:operation.promise};
    },
    cancel:(...args)=>rawPublisher.cancel(...args),
    close:()=>close(),
  };
  Object.freeze(publisher);
  const schedule=Object.freeze({
    status:(...args)=>scheduler?scheduler.status(...args):{schema:'stellar-forge.postgres-schedule-status.v1',suspended:true,active:null},
    configure:(...args)=>{available();return scheduler.configure(...args);},
    enable:(...args)=>{available();return scheduler.enable(...args);},
    pause:(...args)=>{if(!scheduler)throw fault('GTFS_WORKSPACE_BUSY');return scheduler.pause(...args);},
    runNow:(...args)=>{available();return scheduler.runNow(...args);},
    continueRun:(...args)=>{available();return scheduler.continueRun(...args);},
    start:()=>{available();if(!scheduler)throw fault('GTFS_WORKSPACE_BUSY');scheduler.start();},
  });
  async function transact(kind,input,action) {
    only(input,['requestId','expectedRevision','payload'],['requestId','expectedRevision','payload']);
    uuid(input.requestId);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!object(input.payload)||bytes(input.payload).length>INPUT_MAX)
      throw fault('GTFS_INPUT_INVALID','Use the displayed revision and a bounded original request.');
    const payloadHash=identity({kind,expectedRevision:input.expectedRevision,payload:input.payload});
    const previous=state.requests[input.requestId];
    if(previous) {
      if(previous.payloadHash!==payloadHash||previous.kind!==kind)throw fault('GTFS_REQUEST_CONFLICT','This request UUID already describes another operation.',409);
      if(previous.state==='FAILED')throw fault(previous.error.code,previous.error.message,409);
      return {...copy(previous.result),reused:true};
    }
    return gate(kind,async signal=>{
      if(state.pending) {
        if(state.pending.requestId!==input.requestId||state.pending.payloadHash!==payloadHash||state.pending.kind!==kind)
          throw fault('GTFS_OPERATION_PENDING','Resume original request '+state.pending.requestId+'.',409);
      } else {
        if(input.expectedRevision!==state.revision)throw fault('GTFS_REVISION_CHANGED','Reload the current GTFS workspace revision.',409);
        if(Object.keys(state.requests).length>=20000)throw fault('GTFS_HISTORY_LIMIT','Export this complete workspace before creating a following workspace.');
        const retained={schema:'stellar-forge.gtfs-request.v1',requestId:input.requestId,kind,payloadHash,
          expectedRevision:input.expectedRevision,payload:copy(input.payload)};
        await sameFile(rootFile('requests',input.requestId+'.json'),bytes(retained));
        await writeState({...state,pending:{requestId:input.requestId,kind,payloadHash,
          baseRevision:input.expectedRevision,payload:copy(input.payload),createdAt:stamp()}});
      }
      try {
        const completed=await action(input.requestId,input.payload,signal);
        const result={...completed.result,requestId:input.requestId,revision:state.revision+1};
        const request={kind,payloadHash,state:'COMPLETE',completedAt:stamp(),result};
        await writeState({...state,...completed.patch,revision:state.revision+1,pending:null,
          requests:{...state.requests,[input.requestId]:request}});
        return copy(result);
      } catch(issue) {
        const error=safeError(issue);
        const retryable=/UNAVAILABLE|BUSY|TIMEOUT|CANCELLED|PROCESS_FAILED|UPLOAD_RETRY_REQUIRED/.test(error.code)||
          /^(EIO|ENOSPC|EDQUOT|EACCES|EMFILE|ENFILE|ENOMEM|EPIPE|ECONNRESET)$/.test(error.code);
        let complete=false;
        const file={retainFeed:['feeds',input.requestId,'inspection.json'],
          createEdition:['editions',input.requestId,'edition.json'],compareEditions:['comparisons',input.requestId,'comparison.json'],
          saveDecision:['decisions',input.requestId+'.json'],prepareRelease:['releases',input.requestId,'release.json']}[kind];
        if(file)complete=await exists(rootFile(...file)).catch(()=>true);
        if(kind==='selectEdition') {
          try {const current=await exists(rootFile('selected-source.json'))?
            digest(await readPrivate(rootFile('selected-source.json'),INPUT_MAX)):null;
            complete=current!==(state.selection?.sourceSha256??null);
          } catch {complete=true;}
        }
        if(kind==='stageRelease')complete=!/^PACKAGE_RELEASE_(RUNTIME|SOURCE_REQUIRED|LOCATION|ID_CHANGED)$/.test(error.code);
        if(retryable||complete)await writeState({...state,pending:{...state.pending,error}}).catch(()=>{});
        else await writeState({...state,revision:state.revision+1,pending:null,requests:{...state.requests,
          [input.requestId]:{kind,payloadHash,state:'FAILED',completedAt:stamp(),error}}}).catch(()=>{});
        throw issue;
      }
    },{pauseScheduler:true,pending:true});
  }

  async function perform(kind,id,payload,signal,feedBytes=null) {
    const env={env:environment,signal};
    if(kind==='retainFeed') {
      only(payload,['title','filename','feedSha256','feedBytes'],['title','filename','feedSha256','feedBytes']);
      note(payload.title,'a feed title',128);note(payload.filename,'the original ZIP filename',256);sha(payload.feedSha256);
      if(!Number.isSafeInteger(payload.feedBytes)||payload.feedBytes<1||payload.feedBytes>GTFS_ZIP_MAX_BYTES)
        throw fault('GTFS_INPUT_SIZE','The original feed must fit within 16 MiB.');
      const path=rootFile('feeds',id);await privateDirectory(path,true);
      if(feedBytes) {
        if(!Buffer.isBuffer(feedBytes)||feedBytes.length!==payload.feedBytes||digest(feedBytes)!==payload.feedSha256)
          throw fault('GTFS_SOURCE_CHANGED','The received ZIP differs from the reviewed source.');
        await sameFile(join(path,'original.gtfs.zip'),feedBytes);
      }
      if(!await exists(join(path,'original.gtfs.zip')))
        throw fault('GTFS_UPLOAD_RETRY_REQUIRED','Upload the same original ZIP with request '+id+' to complete this retained operation.',409);
      let inspected;
      if(await exists(join(path,'inspection.json'))) {
        inspected=await readJson(join(path,'inspection.json'),STATE_MAX);
        if(inspected.feedSha256!==payload.feedSha256||inspected.feedBytes!==payload.feedBytes)
          throw fault('GTFS_SOURCE_CHANGED','The original feed inspection differs.');
        const actual=await hashPrivate(join(path,'original.gtfs.zip'),GTFS_ZIP_MAX_BYTES);
        if(actual.hash!==payload.feedSha256||actual.bytes!==payload.feedBytes)throw fault('GTFS_SOURCE_CHANGED');
      } else {
        inspected=await inspectGtfsArchive(join(path,'original.gtfs.zip'),payload.feedSha256,env);
        await sameFile(join(path,'inspection.json'),bytes(inspected));
      }
      const saved={id,title:payload.title,filename:payload.filename,feedSha256:payload.feedSha256,
        feedBytes:payload.feedBytes,inspectionSha256:digest(await readPrivate(join(path,'inspection.json'),STATE_MAX)),
        createdAt:state.pending.createdAt};
      return {patch:{feeds:[saved,...state.feeds]},result:{feed:saved}};
    }
    if(kind==='createEdition') {
      only(payload,['feedId','recipe'],['feedId','recipe']);
      const original=await feed(payload.feedId);
      if(!object(payload.recipe)||payload.recipe.feedSha256!==original.record.feedSha256)
        throw fault('GTFS_SOURCE_CHANGED','Use the selected original feed hash in this edition.');
      const path=rootFile('editions',id),recipePath=rootFile('requests',id+'.selection.json');
      await sameFile(recipePath,bytes(payload.recipe));
      let compiled;
      if(await exists(join(path,'edition.json')))compiled=await inspectGtfsEdition(path,env);
      else compiled=await compileGtfsEdition(rootFile('feeds',payload.feedId,'original.gtfs.zip'),recipePath,path,env);
      if(compiled.feedSha256!==original.record.feedSha256)
        throw fault('GTFS_EDITION_CHANGED','The compiled edition has another original source.');
      const raw=await readPrivate(join(path,'edition.json'),STATE_MAX);
      const saved={id,feedId:payload.feedId,title:compiled.title,createdAt:state.pending.createdAt,
        feedSha256:compiled.feedSha256,selectionSha256:compiled.selectionSha256,
        captureSha256:compiled.captureSha256,sourceSha256:compiled.sourceSha256,editionSha256:digest(raw),
        resourceCount:compiled.resources.length,rows:compiled.resources.reduce((sum,item)=>sum+item.rows,0)};
      return {patch:{editions:[saved,...state.editions]},result:{edition:saved}};
    }
    if(kind==='compareEditions') {
      only(payload,['beforeId','afterId','beforeSha256','afterSha256'],['beforeId','afterId','beforeSha256','afterSha256']);
      const before=await edition(payload.beforeId),after=await edition(payload.afterId);
      if(before.record.editionSha256!==sha(payload.beforeSha256)||after.record.editionSha256!==sha(payload.afterSha256))
        throw fault('GTFS_EDITION_CHANGED','Compare the two exact retained edition reviews.',409);
      const path=rootFile('comparisons',id);
      let report;
      if(await exists(join(path,'comparison.json')))report=await readJson(join(path,'comparison.json'),STATE_MAX);
      else report=await compareGtfsEditions(rootFile('editions',payload.beforeId),rootFile('editions',payload.afterId),path,env);
      if(report.before.captureSha256!==before.record.captureSha256||report.after.captureSha256!==after.record.captureSha256)
        throw fault('GTFS_COMPARISON_CHANGED','The retained comparison describes different editions.',409);
      const changed=await hashPrivate(join(path,'changes.jsonl'),FILE_MAX);
      if(changed.hash!==report.changes.sha256||changed.bytes!==report.changes.bytes)throw fault('GTFS_COMPARISON_CHANGED');
      const saved={id,beforeId:payload.beforeId,afterId:payload.afterId,createdAt:state.pending.createdAt,
        reportSha256:digest(await readPrivate(join(path,'comparison.json'),STATE_MAX)),
        changesSha256:changed.hash,changesBytes:changed.bytes,
        resources:report.resources.map(({resource,added,removed,changed,unchanged,comparison})=>
          ({resource,added,removed,changed,unchanged,comparison}))};
      return {patch:{comparisons:[saved,...state.comparisons]},result:{comparison:saved}};
    }
    if(kind==='saveDecision') {
      only(payload,['subject','verdict','reviewer','note'],['subject','verdict','reviewer','note']);
      only(payload.subject,['kind','id','sha256'],['kind','id','sha256']);
      if(!['edition','comparison'].includes(payload.subject.kind)||!['accept','reject','defer'].includes(payload.verdict))
        throw fault('GTFS_DECISION_INVALID','Choose an edition or comparison and an explicit decision.');
      const subject=payload.subject.kind==='edition'?lookup('editions',payload.subject.id):lookup('comparisons',payload.subject.id);
      if(sha(payload.subject.sha256)!==(subject.editionSha256??subject.reportSha256))
        throw fault('GTFS_DECISION_SOURCE_CHANGED','Review the exact retained edition or comparison first.',409);
      const decision={schema:'stellar-forge.gtfs-decision.v1',id,createdAt:state.pending.createdAt,
        subject:copy(payload.subject),verdict:payload.verdict,reviewer:note(payload.reviewer,'the reviewer',128),
        note:note(payload.note,'a decision note',4000)};
      await sameFile(rootFile('decisions',id+'.json'),bytes(decision));
      const saved={id,...decision,sha256:digest(bytes(decision))};
      return {patch:{decisions:[saved,...state.decisions]},result:{decision:saved}};
    }
    if(kind==='selectEdition') {
      only(payload,['editionId','editionSha256'],['editionId','editionSha256']);
      const chosen=await edition(payload.editionId);
      if(chosen.record.editionSha256!==sha(payload.editionSha256))
        throw fault('GTFS_EDITION_CHANGED','Select the exact displayed original edition.',409);
      await inspectGtfsEdition(rootFile('editions',payload.editionId),env);
      const original=await readPrivate(rootFile('editions',payload.editionId,'source.json'),INPUT_MAX);
      if(digest(original)!==chosen.record.sourceSha256)throw fault('GTFS_EDITION_CHANGED');
      const selected=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
      selected.connection.file='editions/'+payload.editionId+'/capture/capture.json';
      const selectedBytes=bytes(selected),selectedSha256=digest(selectedBytes);
      if(await exists(rootFile('selected-source.json'))) {
        const current=digest(await readPrivate(rootFile('selected-source.json'),INPUT_MAX));
        if(current!==state.selection?.sourceSha256&&current!==selectedSha256)
          throw fault('GTFS_SELECTED_SOURCE_CHANGED','The current source binding differs from both the saved and requested edition.',409);
      }
      await atomicJson(directory,'selected-source.json',selected);
      return {patch:{selectedEditionId:payload.editionId,selection:{editionId:payload.editionId,sourceSha256:selectedSha256}},
        result:{selectedEditionId:payload.editionId,sourceSha256:selectedSha256,editionSha256:chosen.record.editionSha256}};
    }
    if(kind==='prepareRelease') {
      only(payload,['runId','payment','origin','path'],['runId','payment','origin']);
      uuid(payload.runId);
      const prepared=await prepareFrictionlessRelease({publisher:rawPublisher,runId:payload.runId,
        outputDirectory:rootFile('releases',id,'package'),payment:payload.payment,origin:payload.origin,path:payload.path??'/data'});
      const summary={schema:'stellar-forge.gtfs-release.v1',id,createdAt:state.pending.createdAt,
        runId:payload.runId,resource:prepared.resource,snapshot:prepared.snapshot,rowCount:prepared.rowCount,
        planId:prepared.planId,dataset:prepared.dataset,offers:prepared.offers,binding:prepared.binding};
      await sameFile(rootFile('releases',id,'release.json'),bytes(summary));
      const saved={id,createdAt:summary.createdAt,runId:summary.runId,snapshot:summary.snapshot,rowCount:summary.rowCount,
        releaseSha256:digest(bytes(summary))};
      return {patch:{releases:[saved,...state.releases]},result:{release:saved,summary}};
    }
    if(kind==='stageRelease') {
      only(payload,['releaseId','releaseSha256','id','label','runtime'],['releaseId','releaseSha256','id']);
      const chosen=lookup('releases',payload.releaseId);
      if(sha(payload.releaseSha256)!==chosen.releaseSha256)throw fault('GTFS_RELEASE_CHANGED','Stage the retained original release package.',409);
      await readAnchored(rootFile('releases',payload.releaseId,'release.json'),chosen.releaseSha256);
      if(!releaseStore)throw fault('GTFS_RELEASE_STORE_REQUIRED','Start this workspace with its configured original SF82 release store.');
      const staged=await stageFrictionlessRelease({packageDirectory:rootFile('releases',payload.releaseId,'package'),
        releaseDirectory:releaseStore,id:payload.id,label:payload.label??payload.id,runtime:payload.runtime??{port:0}});
      const {reused,...stableStaged}=staged;
      const receipt={schema:'stellar-forge.gtfs-staging.v1',id,releaseId:payload.releaseId,releaseSha256:chosen.releaseSha256,
        createdAt:state.pending.createdAt,original:stableStaged};
      await sameFile(rootFile('releases',payload.releaseId,'stage-'+id+'.json'),bytes(receipt));
      return {patch:{},result:receipt};
    }
    throw fault('GTFS_OPERATION_UNKNOWN');
  }
  const callRequest=(kind,input,data)=>{
    if(kind==='stageRelease'&&!releaseStore)throw fault('GTFS_RELEASE_STORE_REQUIRED','Configure the original SF82 release store before staging.');
    return transact(kind,input,(id,payload,signal)=>perform(kind,id,payload,signal,data));
  };
  function operation(requestId) {
    uuid(requestId);
    if(state.pending?.requestId===requestId)return {state:'PENDING',...copy(state.pending)};
    const saved=state.requests[requestId];if(!saved)throw fault('GTFS_REQUEST_NOT_FOUND','Choose a retained request.',404);
    return {requestId,...copy(saved)};
  }
  async function recoverRequest(requestId) {
    uuid(requestId);
    if(state.requests[requestId])return operation(requestId);
    if(state.pending?.requestId!==requestId)throw fault('GTFS_REQUEST_NOT_FOUND','Choose the retained pending request.',404);
    const {kind,payload,baseRevision}=state.pending;
    return callRequest(kind,{requestId,expectedRevision:baseRevision,payload:copy(payload)});
  }

  async function readExportRecord(path,requestId) {
    if((await lstat(path)).nlink!==1) {
      const held=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      let raw,saved;
      try {
        const before=await held.stat({bigint:true});
        if(!before.isFile()||before.nlink!==2n||before.mode&0o077n||before.size>BigInt(INPUT_MAX))
          throw fault('GTFS_EXPORT_JOURNAL_INVALID','Reopen the original private export journal.');
        raw=await held.readFile();
        const after=await held.stat({bigint:true});
        if(BigInt(raw.length)!==before.size||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
          throw fault('GTFS_EXPORT_JOURNAL_CHANGED','The original export journal changed during recovery.',409);
        saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
        if(saved.schema!=='stellar-forge.gtfs-export-request.v1'||saved.requestId!==requestId||
          !GTFS_UUID.test(saved.workspaceId??'')||!Number.isSafeInteger(saved.revision)||saved.revision<0||
          saved.payloadHash!==identity({workspaceId:saved.workspaceId,expectedRevision:saved.revision,requestId})||
          saved.state!=='PENDING')
          throw fault('GTFS_REQUEST_CONFLICT','The interrupted journal has another original export identity.',409);
      } finally {await held.close();}
      // A shared private exports directory can also retain another workspace's
      // archive. Its owning workspace alone reconciles that publication inode.
      if(saved.workspaceId!==state.id)return saved;
      await finishLinkedPublication(path,raw);
    }
    const saved=await readJson(path,INPUT_MAX);
    if(saved.schema!=='stellar-forge.gtfs-export-request.v1'||saved.requestId!==requestId)
      throw fault('GTFS_EXPORT_JOURNAL_INVALID','Use the original retained archive request.');
    return saved;
  }

  async function status({limit=25,feedsOffset=0,editionsOffset=0,comparisonsOffset=0,decisionsOffset=0,releasesOffset=0,exportsOffset=0}={}) {
    const exported=[];
    if(await exists(exportsDirectory)) {
      await privateDirectory(exportsDirectory);
      for(const name of await readdir(exportsDirectory)) {
        if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
        const item=await readExportRecord(join(exportsDirectory,name),name.slice(0,-5));
        if(item.workspaceId===state.id)exported.push(item);
      }
    }
    exported.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));
    return {schema:'stellar-forge.gtfs-workspace-status.v1',id:state.id,title:state.title,createdAt:state.createdAt,
      revision:state.revision,selectedEditionId:state.selectedEditionId,selection:copy(state.selection),
      active:active?{kind:active.kind}:null,pending:copy(state.pending),
      feeds:page(state.feeds,feedsOffset,limit),editions:page(state.editions,editionsOffset,limit),
      comparisons:page(state.comparisons,comparisonsOffset,limit),decisions:page(state.decisions,decisionsOffset,limit),
      releases:page(state.releases,releasesOffset,limit),exports:page(exported,exportsOffset,limit),
      publisher:rawPublisher.status({limit}),schedule:schedule.status({limit}),
      capabilities:{sourceRows:true,completeOriginalZip:true,exactDatedSchedules:true,frequencyWindows:true,
        completeWorkspaceArchive:true,releaseStore:Boolean(releaseStore)},reads:readers.summary};
  }

  const manifestCache=new Map(),pendingReads=new Set();
  function trackRead(action) {
    if(closing)throw fault('GTFS_WORKSPACE_CLOSING');
    const task=Promise.resolve().then(action);pendingReads.add(task);
    task.finally(()=>pendingReads.delete(task)).catch(()=>{});return task;
  }
  const mime=file=>file.endsWith('.zip')?'application/zip':file.endsWith('.tar.gz')?'application/gzip':
    file.endsWith('.csv')?'text/csv; charset=utf-8':file.endsWith('.jsonl')?'application/x-ndjson':
    file.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream';
  async function artifact(kind,id) {
    uuid(id);
    if(kind==='feed') {const saved=await feed(id);return {root:rootFile('feeds',id),anchor:saved.record.inspectionSha256};}
    if(kind==='edition') {const saved=await edition(id);return {root:rootFile('editions',id),anchor:saved.record.editionSha256};}
    if(kind==='comparison') {const saved=await comparison(id);return {root:rootFile('comparisons',id),anchor:saved.record.reportSha256};}
    if(kind==='decision') {
      const saved=lookup('decisions',id);await readAnchored(rootFile('decisions',id+'.json'),saved.sha256);
      return {root:rootFile('decisions'),single:id+'.json',anchor:saved.sha256};
    }
    if(kind==='release') {
      const saved=lookup('releases',id);await readAnchored(rootFile('releases',id,'release.json'),saved.releaseSha256);
      return {root:rootFile('releases',id),anchor:saved.releaseSha256,exclude:name=>/^stage-[a-f0-9-]{36}\.json$/.test(name)};
    }
    if(kind==='archive') {
      const saved=await readExportRecord(join(exportsDirectory,id+'.json'),id);
      if(saved.workspaceId!==state.id||saved.state!=='COMPLETE'||!GTFS_SHA256.test(saved.result?.archiveSha256??''))
        throw fault('GTFS_EXPORT_NOT_READY','Resume the original archive export request.',409);
      return {root:exportsDirectory,single:id+'.tar.gz',anchor:saved.result.archiveSha256,exact:saved.result};
    }
    throw fault('GTFS_ARTIFACT_KIND','Choose a retained feed, edition, comparison, decision, release or workspace archive.');
  }
  async function fullManifest(kind,id) {
    const selected=await artifact(kind,id),key=kind+':'+id+':'+selected.anchor;
    if(manifestCache.has(key))return manifestCache.get(key);
    if(kind==='edition')await inspectGtfsEdition(selected.root,{env:environment});
    const files=[];
    async function walk(path,prefix='') {
      await privateDirectory(path);
      const entries=(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
      for(const entry of entries) {
        if(!prefix&&selected.exclude?.(entry.name))continue;
        const name=prefix+entry.name;
        if(entry.isSymbolicLink()||entry.name==='.'||entry.name==='..'||/[\\\u0000-\u001f]/.test(entry.name))
          throw fault('GTFS_ARTIFACT_FILE_INVALID','A retained artifact contains an invalid file.');
        if(entry.isDirectory())await walk(join(path,entry.name),name+'/');
        else if(entry.isFile()) {
          const file=await hashPrivate(join(path,entry.name),FILE_MAX);
          files.push({file:name,bytes:file.bytes,sha256:file.hash,type:mime(name)});
          if(files.length>20000)throw fault('GTFS_ARTIFACT_FILE_LIMIT','This retained artifact exceeds its complete file limit.');
        } else throw fault('GTFS_ARTIFACT_FILE_INVALID','Retained artifacts contain only ordinary files.');
      }
    }
    if(selected.single) {
      const file=await hashPrivate(join(selected.root,selected.single),FILE_MAX);
      if(selected.exact&&(file.hash!==selected.exact.archiveSha256||file.bytes!==selected.exact.bytes))
        throw fault('GTFS_ARCHIVE_CHANGED','The complete original export changed.',409);
      files.push({file:selected.single,bytes:file.bytes,sha256:file.hash,type:mime(selected.single)});
    } else await walk(selected.root);
    const value={schema:'stellar-forge.gtfs-artifact-manifest.v1',workspaceId:state.id,kind,id,
      sourceSha256:selected.anchor,files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)};
    const result={...value,manifestSha256:identity(value)};
    if(manifestCache.size>=64)manifestCache.delete(manifestCache.keys().next().value);
    manifestCache.set(key,result);return result;
  }
  async function manifest({kind,id,offset=0,limit=100,expectedManifestSha256}={}) {
    const value=await fullManifest(kind,id);
    if(expectedManifestSha256!==undefined&&sha(expectedManifestSha256)!==value.manifestSha256)
      throw fault('GTFS_MANIFEST_CHANGED','Resume the same original artifact manifest.',409);
    const selected=page(value.files,offset,limit);
    return {...value,files:selected.items,pagination:{offset:selected.offset,limit:selected.limit,total:selected.total,next:selected.next}};
  }
  async function readFile(input) {
    only(input,['kind','id','file','expectedSha256','readId','offset','limit'],['kind','id','file','expectedSha256']);
    const expectedSha256=sha(input.expectedSha256),id=uuid(input.id);
    if(typeof input.file!=='string'||input.file.length>2048||input.file.includes('\0'))throw fault('GTFS_FILE_REQUIRED');
    return readers.read({scope:state.id,key:input.kind+':'+id+':'+input.file,kind:'gtfs-'+input.kind,
      directory,readId:input.readId,expectedSha256,offset:input.offset,limit:input.limit,
      load:async()=>{
        const all=await fullManifest(input.kind,id),file=all.files.find(item=>item.file===input.file);
        if(!file||file.sha256!==expectedSha256)throw fault('GTFS_FILE_CHANGED','Choose an exact file from this original artifact manifest.',409);
        const selected=await artifact(input.kind,id),path=join(selected.root,file.file);
        const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try {
          const stat=await handle.stat();
          if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size!==file.bytes)
            throw fault('GTFS_PRIVATE_ARTIFACT_REQUIRED','The retained file is not its original private ordinary file.');
          return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.file,type:file.type};
        } catch(issue) {await handle.close();throw issue;}
      }});
  }
  async function exportWorkspace(input) {
    only(input,['requestId','expectedRevision'],['requestId','expectedRevision']);uuid(input.requestId);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw fault('GTFS_REVISION_CHANGED');
    await privateDirectory(exportsDirectory,true);
    const recordPath=join(exportsDirectory,input.requestId+'.json'),archivePath=join(exportsDirectory,input.requestId+'.tar.gz');
    const payloadHash=identity({workspaceId:state.id,expectedRevision:input.expectedRevision,requestId:input.requestId});
    let record=await exists(recordPath)?await readExportRecord(recordPath,input.requestId):null;
    if(record&&(record.workspaceId!==state.id||record.payloadHash!==payloadHash))
      throw fault('GTFS_REQUEST_CONFLICT','This original archive request describes another workspace revision.',409);
    if(record?.state==='COMPLETE') {
      const actual=await hashPrivate(archivePath,FILE_MAX);
      if(actual.hash!==record.result.archiveSha256||actual.bytes!==record.result.bytes)throw fault('GTFS_ARCHIVE_CHANGED');
      return {...copy(record.result),requestId:input.requestId,reused:true};
    }
    return gate('exporting the complete GTFS workspace',async signal=>{
      if(state.pending)throw fault('GTFS_OPERATION_PENDING','Resume the retained workspace operation before export.',409);
      const current=await readPrivate(rootFile('workspace.json'),STATE_MAX),currentHash=digest(current);
      if(!record) {
        if(input.expectedRevision!==state.revision)throw fault('GTFS_REVISION_CHANGED','Export the currently displayed workspace revision.',409);
        record={schema:'stellar-forge.gtfs-export-request.v1',requestId:input.requestId,workspaceId:state.id,
          payloadHash,revision:state.revision,workspaceSha256:currentHash,createdAt:stamp(),state:'PENDING'};
        await sameFile(recordPath,bytes(record));
      }
      let result;
      if(await exists(archivePath)) {
        const original=await hashPrivate(archivePath,FILE_MAX);
        result=await runGtfsArchiveCommand(['inspect','--archive',archivePath,'--sha256',original.hash],{env:environment,signal});
      } else {
        if(currentHash!==record.workspaceSha256||state.revision!==record.revision)
          throw fault('GTFS_EXPORT_SOURCE_CHANGED','The saved export request refers to an earlier workspace state. Retain that request and export the current revision with a new UUID.',409);
        result=await runGtfsArchiveCommand(['export','--workspace',directory,'--output',archivePath,
          '--workspace-id',state.id],{env:environment,signal});
      }
      if(result.workspaceId!==state.id||result.workspaceJsonSha256!==record.workspaceSha256||result.revision!==record.revision)
        throw fault('GTFS_ARCHIVE_BINDING_CHANGED','The complete archive differs from its original workspace request.',409);
      record={...record,state:'COMPLETE',completedAt:stamp(),result:{...result,archiveFile:basename(archivePath)}};
      await atomicJson(exportsDirectory,basename(recordPath),record);
      return {...copy(record.result),requestId:input.requestId,reused:false};
    },{pauseScheduler:true});
  }
  async function close() {
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      let problem;
      try {
        active?.controller?.abort();
        const running=rawPublisher?.status().active;
        if(running?.kind==='extraction')rawPublisher.cancel(running.id);
        if(scheduler){const original=scheduler;scheduler=null;await original.close();}
        await active?.promise?.catch(()=>{});
        await Promise.allSettled([...pendingReads]);
        await readers.close();
      } catch(issue){problem=issue;}
      finally {try{await rawPublisher?.close();}finally{await releaseRoot();}}
      if(problem)throw problem;
    })();
    return closePromise;
  }
  try {
    const initialize=create||createIfMissing&&!await exists(rootFile('workspace.json'));
    if(initialize) {
      const titleValue=note(title,'the workspace title',128),initialId=expectedWorkspaceId??randomUUID();
      const marker={schema:'stellar-forge.gtfs-initialization.v1',workspaceId:initialId,title:titleValue};
      const markerPath=rootFile('initialization.json');
      if(!create) {
        const entries=await readdir(directory);
        if(!await exists(markerPath)&&entries.some(name=>name!=='publisher.lock'&&
          !(name.startsWith('initialization.json.pending-')&&GTFS_UUID.test(name.slice('initialization.json.pending-'.length)))))
          throw fault('GTFS_INITIALIZATION_DIRECTORY_CHANGED','Use the original new workspace directory or its retained initialization.');
      }
      await sameFile(markerPath,bytes(marker));
      state={schema:GTFS_WORKSPACE_SCHEMA,id:initialId,title:titleValue,createdAt:stamp(),
        revision:0,publisher:copy(PUBLISHER),selectedEditionId:null,selection:null,
        feeds:[],editions:[],comparisons:[],decisions:[],releases:[],exports:[],requests:{},pending:null};
      for(const name of ['feeds','editions','comparisons','decisions','releases','requests'])await privateDirectory(rootFile(name),true);
      await sameFile(rootFile('workspace.json'),bytes(state));
    } else {
      const markerPath=rootFile('initialization.json');
      const marker=await exists(markerPath)?await readLaunchRecord(markerPath,INPUT_MAX,value=>{
        initialization(value);
        if(expectedWorkspaceId!==undefined&&value.workspaceId!==expectedWorkspaceId)
          throw fault('GTFS_WORKSPACE_ID_CHANGED','The initialization differs from the reviewed original UUID.',409);
        return value;
      },{reconcile:true}):null;
      state=await readLaunchRecord(rootFile('workspace.json'),STATE_MAX,(value,linked)=>{
        const original=linked?initialState(value,marker):validState(value);
        if(expectedWorkspaceId!==undefined&&original.id!==expectedWorkspaceId)
          throw fault('GTFS_WORKSPACE_ID_CHANGED','The native workspace differs from the reviewed original UUID.',409);
        return original;
      },{reconcile:true});
    }
    if(expectedWorkspaceId!==undefined&&state.id!==expectedWorkspaceId)
      throw fault('GTFS_WORKSPACE_ID_CHANGED','The native workspace differs from the reviewed original UUID.',409);
    for(const name of ['feeds','editions','comparisons','decisions','releases','requests'])await privateDirectory(rootFile(name));
    if(!await exists(rootFile('publisher'))) {
      const temporary=rootFile('.publisher-initializing-'+randomUUID());
      const initialized=await openSourceDatasetPublisher({directory:temporary,create:true,sourceFile:rootFile('selected-source.json'),
        targetDirectory:rootFile('dataset'),environment,seller,resource},driver);
      await initialized.close();await rename(temporary,rootFile('publisher'));await syncDirectory(directory);
    }
    rawPublisher=await openSourceDatasetPublisher({directory:rootFile('publisher'),environment,seller,resource},driver);
    if(rawPublisher.settings.sourceFile!==rootFile('selected-source.json')||rawPublisher.settings.targetDirectory!==rootFile('dataset'))
      throw fault('GTFS_PUBLISHER_BINDING_CHANGED','Use the original received publisher runtime paths.',409);
    scheduler=await openPostgresSchedule({publisher});if(startSchedule&&!state.pending)scheduler.start();
    return Object.freeze({directory,exportsDirectory,get id(){return state.id;},get revision(){return state.revision;},
      publisher,schedule,status,identity:()=>({schema:'stellar-forge.gtfs-workspace-identity.v1',directory,
        workspaceId:state.id,revision:state.revision,pid:process.pid}),
      feed:id=>trackRead(()=>feed(id)),edition:id=>trackRead(()=>edition(id)),comparison:id=>trackRead(()=>comparison(id)),
      sourceRows:input=>trackRead(async()=>{const original=await feed(input.feedId);return readGtfsSourceRows(
        rootFile('feeds',input.feedId,'original.gtfs.zip'),original.record.feedSha256,input,{env:environment});}),
      rows:input=>trackRead(async()=>{await edition(input.editionId);return readGtfsRows(rootFile('editions',input.editionId),input,{env:environment});}),
      retainFeed:(input,content)=>callRequest('retainFeed',input,content),
      createEdition:input=>callRequest('createEdition',input),compareEditions:input=>callRequest('compareEditions',input),
      saveDecision:input=>callRequest('saveDecision',input),selectEdition:input=>callRequest('selectEdition',input),
      prepareRelease:input=>callRequest('prepareRelease',input),stageRelease:input=>callRequest('stageRelease',input),
      operation,recoverRequest,exportWorkspace,
      manifest:input=>trackRead(()=>manifest(input)),readFile:input=>trackRead(()=>readFile(input)),
      releaseRead:readId=>readers.release(state.id,uuid(readId)),close});
  } catch(issue) {
    try {await scheduler?.close();await rawPublisher?.close();await readers.close();}
    finally {await releaseRoot();}
    throw issue;
  }
}
