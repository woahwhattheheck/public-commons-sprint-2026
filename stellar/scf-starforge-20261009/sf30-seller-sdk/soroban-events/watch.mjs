import { promises as fs, constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sorobanWorkspaceFiles } from './engine.mjs';
import { clone, digest, integer, requireValue, SorobanEventsError, stableJSON, textValue } from './rpc.mjs';
import {
  prepareSorobanPublication, appendSorobanEdition, inspectSorobanPublication,
  snapshotSorobanPublication, restoreSorobanPublication,
} from './publish.mjs';

const { privateDirectory, filePath, readJSON, readFile, writeNew, replaceJSON, acquireLock, relativeFile, sourceFileRange } = sorobanWorkspaceFiles;
const SCHEMA = 'stellar-forge.soroban-events.watches.v1';
const EXPORT_SCHEMA = 'stellar-forge.soroban-events.watch-export.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const now = () => new Date().toISOString();
const jsonBytes = (value) => Buffer.from(JSON.stringify(value,null,2)+'\n');
const own = (object,key) => Object.hasOwn(object,key);
const checkedId = (id,label='watchId') => { requireValue(typeof id==='string' && UUID.test(id),'INVALID_ARGUMENT',label+' must be a UUID'); return id; };
function selected(map,id,label='Watch') {
  requireValue(typeof id==='string' && own(map,id),'NOT_FOUND',label+' was not found');
  return map[id];
}
function errorData(error) {
  return { code: error.code ?? 'WATCH_OPERATION_FAILED', message: error.message ?? 'Recurring source operation failed',
    details: clone(error.details ?? {}), at: now() };
}
function alias(value,label) {
  requireValue(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value),'INVALID_ARGUMENT',label+' must be a configured host alias');
  return value;
}
function publicationConfig(input) {
  if (input===null || input===undefined) return null;
  requireValue(input && typeof input==='object' && !Array.isArray(input),'INVALID_ARGUMENT','publication must be a configured publication target');
  requireValue(typeof input.directory==='string' && isAbsolute(input.directory) && resolve(input.directory)===input.directory,
    'INVALID_DIRECTORY','Publication directory must be an absolute normalized private host path');
  const result={directory:input.directory};
  for(const key of ['feedId','sourceId']) if(input[key]!==undefined) {
    requireValue(typeof input[key]==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input[key]),'INVALID_ARGUMENT',key+' is invalid');
    result[key]=input[key];
  }
  for(const key of ['label','description']) if(input[key]!==undefined) result[key]=textValue(input[key],key,key==='description'?2000:200);
  return result;
}
function configuration(input,previous=null) {
  const get=(key,fallback)=>own(input,key)?input[key]:previous?.[key]??fallback;
  const recovery=get('recoveryConnectionAlias',null);
  return {
    windowLedgers:integer(get('windowLedgers',5000),'windowLedgers',1,1000000),
    pollIntervalMs:integer(get('pollIntervalMs',5000),'pollIntervalMs',1000,86400000),
    connectionAlias:alias(get('connectionAlias','default'),'connectionAlias'),
    recoveryConnectionAlias:recovery===null?null:alias(recovery,'recoveryConnectionAlias'),
    publication:publicationConfig(get('publication',null)),
  };
}
function requireConnection(connections,name,network=null) {
  const connection=connections.find((entry)=>entry.alias===name);
  requireValue(connection,'CONNECTION_REQUIRED','Configure the selected private host RPC connection alias',{alias:name});
  requireValue(network===null || connection.network===network,'RPC_NETWORK_MISMATCH','Recovery and primary connections must select the same original network',{alias:name,network});
  return connection;
}
function requirePlan(description,planId,version) {
  const plan=description.plans.find((entry)=>entry.id===planId);
  requireValue(plan,'PLAN_VERSION_NOT_FOUND','Select an existing saved plan');
  const original=plan.versions.find((entry)=>entry.version===(version??plan.currentVersion));
  requireValue(original,'PLAN_VERSION_NOT_FOUND','The saved original plan version was not found');
  return original;
}
function markStatus(watch,status) {
  watch.status=watch.desiredState==='PAUSED' && status==='RUNNING'?'PAUSING':status;
  watch.updatedAt=now();
}
function portable(value) {
  if(Array.isArray(value))return value.map(portable);
  if(value===null || typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value))
    if(!['directory','sourceDirectory','destination','publicationDirectory','connectionFile','connectionsFile','recoveryDirectory'].includes(key)) result[key]=portable(item);
  return result;
}
async function exists(directory,name) {
  try { await readFile(directory,name); return true; } catch(error) {if(error.code==='ENOENT')return false; throw error;}
}
function delay(ms,signal) {
  if(signal?.aborted)return Promise.resolve();
  return new Promise((resolveDelay)=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolveDelay();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
  });
}
function childRequest(watch,window,stage,sequence=1) {
  return {requestId:'watch.'+watch.id+'.'+window.id+'.'+stage+'.'+sequence};
}
function targetFor(watch,publication) {
  if(!publication)return null;
  let existing=Object.values(watch.publicationTargets).find((entry)=>entry.directory===publication.directory);
  const currentId=watch.configurations.at(-1)?.publicationTargetId;
  if(!existing&&currentId&&watch.publicationTargets[currentId]?.directory===null)existing=watch.publicationTargets[currentId];
  if(existing) {
    const feedId=existing.publication?.feedId??existing.config.feedId,sourceId=existing.publication?.sourceId??existing.config.sourceId;
    requireValue((publication.feedId===undefined||feedId===undefined||publication.feedId===feedId)&&
      (publication.sourceId===undefined||sourceId===undefined||publication.sourceId===sourceId),
      'PUBLICATION_SELECTION_CONFLICT','An existing target keeps its original feed and source identity');
    existing.directory=publication.directory;existing.config={...existing.config,...publication};
    return existing;
  }
  const id=randomUUID();
  const target={id,directory:publication.directory,config:clone(publication),createdAt:now(),publication:null};
  watch.publicationTargets[id]=target;
  return target;
}
function configRecord(watch,connection,recoveryConnection) {
  const target=targetFor(watch,watch.config.publication);
  return {version:watch.configVersion,planVersion:watch.planVersion,config:clone(watch.config),
    connection:clone(connection),recoveryConnection:clone(recoveryConnection),
    publicationTargetId:target?.id??null,changedAt:now()};
}
function requestInput(input) {
  requireValue(input && typeof input==='object','INVALID_ARGUMENT','Operation arguments are required');
  const args=clone(input),requestId=textValue(args.requestId,'requestId',200);
  requireValue(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestId),'INVALID_ARGUMENT','requestId uses unsupported characters');
  integer(args.expectedRevision,'expectedRevision',0,Number.MAX_SAFE_INTEGER);
  const body={...args};delete body.requestId;delete body.expectedRevision;
  return {args,requestId,body};
}

class SorobanEventWatches {
  #workspace; #directory; #workspaceId; #tail=Promise.resolve(); #closing=false;
  #controller=new AbortController(); #running=new Set();
  constructor(workspace,directory) { this.#workspace=workspace;this.#directory=directory; }
  get directory(){return this.#directory;}
  async initialize() {
    const native=await this.#workspace.describe();this.#workspaceId=native.workspaceId;
    await privateDirectory(this.#directory);
    const release=await acquireLock(this.#directory,'control.lock');
    try {
      let state;
      try {state=await readJSON(this.#directory,'watches.json');}
      catch(error) {
        if(error.code!=='ENOENT')throw error;
        state={schema:SCHEMA,workspaceId:native.workspaceId,revision:0,createdAt:now(),watches:{},exports:{},requests:{}};
        await writeNew(this.#directory,'watches.json',jsonBytes(state));
      }
      requireValue(state.schema===SCHEMA && state.workspaceId===native.workspaceId,'WATCH_WORKSPACE_MISMATCH','Recurring services belong to this original event workspace');
    } finally {await release();}
    return this;
  }
  async #state() {
    const state=await readJSON(this.#directory,'watches.json');
    requireValue(state.schema===SCHEMA && state.workspaceId===this.#workspaceId,'WATCH_WORKSPACE_MISMATCH','Recurring service state belongs to another event workspace');
    return state;
  }
  async #control(operation) {
    const run=this.#tail.then(async()=>{
      let release;
      for(let attempt=0;attempt<40;attempt+=1) {
        try {release=await acquireLock(this.#directory,'control.lock');break;}
        catch(error) {if(error.code!=='WORKSPACE_BUSY'||attempt===39)throw error;await delay(25);}
      }
      try {
        const state=await this.#state(),result=await operation(state);
        state.revision+=1;await replaceJSON(this.#directory,'watches.json',state);
        return typeof result==='function'?result(state.revision):result;
      } finally {await release?.();}
    });
    this.#tail=run.catch(()=>{});return run;
  }
  #envelope(state,extra={}) {return {workspaceId:state.workspaceId,revision:state.revision,...clone(extra)};}
  async #mutate(kind,input,operation) {
    requireValue(!this.#closing,'WATCH_CLOSED','Recurring service workspace is closing');
    const {args,requestId,body}=requestInput(input),hash=digest(stableJSON({kind,body}));
    return this.#control(async(state)=>{
      const previous=own(state.requests,requestId)?state.requests[requestId]:null;
      if(previous) {
        requireValue(previous.kind===kind&&previous.inputSha256===hash,'REQUEST_CONFLICT','requestId belongs to different original watch arguments');
        if(previous.result)return clone(previous.result);
        throw new SorobanEventsError('WATCH_REQUEST_PENDING','This original long operation is still pending');
      }
      requireValue(state.revision===args.expectedRevision,'REVISION_CONFLICT','Recurring service controls changed; reload before changing this selection',{expectedRevision:args.expectedRevision,actualRevision:state.revision});
      const result=await operation(state,args);
      const response={workspaceId:state.workspaceId,revision:state.revision+1,...clone(result)};
      state.requests[requestId]={id:requestId,kind,inputSha256:hash,startedAt:now(),completedAt:now(),result:response};
      return response;
    });
  }
  async #intent(kind,input,context) {
    requireValue(!this.#closing,'WATCH_CLOSED','Recurring service workspace is closing');
    const {args,requestId,body}=requestInput(input),hash=digest(stableJSON({kind,body}));
    return this.#control((state)=>{
      const previous=own(state.requests,requestId)?state.requests[requestId]:null;
      if(previous) {
        requireValue(previous.kind===kind&&previous.inputSha256===hash,'REQUEST_CONFLICT','requestId belongs to different original watch arguments');
        return clone(previous);
      }
      requireValue(state.revision===args.expectedRevision,'REVISION_CONFLICT','Recurring service controls changed; reload before exporting or receiving',{expectedRevision:args.expectedRevision,actualRevision:state.revision});
      const request={id:requestId,kind,inputSha256:hash,startedAt:now(),context:context(state,args)};
      state.requests[requestId]=request;return clone(request);
    });
  }
  async #finish(requestId,result) {
    return this.#control((state)=>{
      const request=selected(state.requests,requestId,'Original request');
      if(request.result)return clone(request.result);
      request.result={workspaceId:state.workspaceId,revision:state.revision+1,...clone(result)};
      request.completedAt=now();return clone(request.result);
    });
  }
  async #change(watchId,operation) {
    return this.#control((state)=>{
      const watch=selected(state.watches,watchId);operation(watch,state);
      watch.updatedAt=now();
      return (revision)=>({workspaceId:state.workspaceId,revision,watch:clone(watch)});
    });
  }
  async describe() {
    const [state,native]=await Promise.all([this.#state(),this.#workspace.describe()]);
    return this.#envelope(state,{watches:Object.values(state.watches),exports:Object.values(state.exports),connections:native.connections??[]});
  }
  async watchStatus({watchId}) {
    const state=await this.#state();return this.#envelope(state,{watch:selected(state.watches,watchId)});
  }
  async watchSave(input) {
    const native=await this.#workspace.describe(),plan=requirePlan(native,input.planId,input.planVersion),config=configuration(input);
    const connection=requireConnection(native.connections??[],config.connectionAlias);
    const recovery=config.recoveryConnectionAlias?requireConnection(native.connections,config.recoveryConnectionAlias,connection.network):null;
    const startLedger=input.startLedger??plan.startLedger??null,endLedger=input.endLedger??null;
    if(startLedger!==null)integer(startLedger,'startLedger');
    if(endLedger!==null)integer(endLedger,'endLedger',2,4294967296);
    requireValue(startLedger===null||endLedger===null||endLedger>startLedger,'INVALID_RANGE','Service endLedger must follow its first selected ledger');
    textValue(input.name,'Service name');
    return this.#mutate('watch-save',input,(state,args)=>{
      const watch={id:randomUUID(),name:args.name,planId:plan.id,planVersion:plan.version,sourceWorkspaceId:state.workspaceId,
        network:connection.network,configVersion:1,config,configurations:[],desiredState:'PAUSED',status:'PAUSED',
        initialLedger:startLedger,nextLedger:startLedger,endLedger,active:null,windows:[],publicationTargets:{},publication:null,
        recovery:null,pauseVersion:0,lastError:null,createdAt:now(),updatedAt:now()};
      watch.configurations.push(configRecord(watch,connection,recovery));state.watches[watch.id]=watch;return {watch};
    });
  }
  async watchConfigure(input) {
    const state=await this.#state(),current=selected(state.watches,input.watchId),native=await this.#workspace.describe();
    const plan=requirePlan(native,current.planId,input.planVersion??current.planVersion),config=configuration(input,current.config);
    const connection=requireConnection(native.connections??[],config.connectionAlias,current.network);
    const recovery=config.recoveryConnectionAlias?requireConnection(native.connections,config.recoveryConnectionAlias,current.network):null;
    const endLedger=own(input,'endLedger')?input.endLedger:current.endLedger;
    if(endLedger!==null)integer(endLedger,'endLedger',2,4294967296);
    if(input.name!==undefined)textValue(input.name,'Service name');
    return this.#mutate('watch-configure',input,(saved,args)=>{
      const watch=selected(saved.watches,args.watchId);
      requireValue(endLedger===null||((watch.nextLedger===null||endLedger>=watch.nextLedger)&&(!watch.active?.endLedger||endLedger>=watch.active.endLedger)),
        'INVALID_RANGE','Service endLedger cannot precede its retained or active original range');
      if(args.name!==undefined)watch.name=args.name;
      watch.planVersion=plan.version;watch.config=config;watch.endLedger=endLedger;watch.configVersion+=1;
      watch.configurations.push(configRecord(watch,connection,recovery));
      if(watch.status==='COMPLETE'&&(endLedger===null||watch.nextLedger<endLedger))watch.status=watch.desiredState==='RUNNING'?'RUNNING':'PAUSED';
      watch.updatedAt=now();return {watch};
    });
  }
  async watchStart(input) {
    return this.#mutate('watch-start',input,(state,args)=>{
      const watch=selected(state.watches,args.watchId);watch.desiredState='RUNNING';watch.lastStartedAt=now();
      if(watch.status!=='COMPLETE')watch.status='RUNNING';
      watch.updatedAt=now();return {watch};
    });
  }
  async watchPause(input) {
    return this.#mutate('watch-pause',input,(state,args)=>{
      const watch=selected(state.watches,args.watchId);watch.desiredState='PAUSED';watch.pauseVersion+=1;
      watch.status=watch.active?.inFlight?'PAUSING':watch.status==='COMPLETE'?'COMPLETE':'PAUSED';
      watch.updatedAt=now();return {watch};
    });
  }
  async watchRepair(input) {
    const state=await this.#state(),current=selected(state.watches,input.watchId),native=await this.#workspace.describe();
    requireValue(Array.isArray(input.editionIds??[])&&(input.editionIds??[]).length<=10000,'INVALID_ARGUMENT','editionIds must be a list of retained source editions');
    const editionIds=[...new Set(input.editionIds??[])];editionIds.forEach((id)=>checkedId(id,'editionId'));
    const recoveryAlias=own(input,'recoveryConnectionAlias')?input.recoveryConnectionAlias:current.config.recoveryConnectionAlias;
    if(recoveryAlias!==null)requireConnection(native.connections??[],alias(recoveryAlias,'recoveryConnectionAlias'),current.network);
    requireValue(editionIds.length>0||recoveryAlias,'RECOVERY_SOURCE_REQUIRED','Select retained original editions or a configured compatible archive connection');
    for(const id of editionIds) {
      const edition=selected(Object.fromEntries(native.editions.map((entry)=>[entry.id,entry])),id,'Edition');
      this.#validateRecoveryEdition(current,edition);
    }
    return this.#mutate('watch-repair',input,(saved,args)=>{
      const watch=selected(saved.watches,args.watchId);
      watch.recovery={id:randomUUID(),editionIds,connectionAlias:recoveryAlias,requestedAt:now()};
      watch.lastError=null;watch.updatedAt=now();return {watch};
    });
  }
  #validateRecoveryEdition(watch,edition) {
    const expectedVersion=watch.active?.planVersion??watch.planVersion;
    const origin=edition.sourceOriginWorkspaceId??edition.receivedFrom?.workspaceId??this.#workspaceId;
    requireValue(edition.planId===watch.planId&&edition.planVersion===expectedVersion&&edition.network===watch.network&&origin===watch.sourceWorkspaceId,
      'RECOVERY_SELECTION_MISMATCH','Recovery edition must select the original logical source, network and pinned plan version');
    requireValue(edition.endLedger>edition.startLedger,'RECOVERY_SOURCE_INVALID','Recovery edition must retain a complete original ledger interval');
  }

  async #engineCall(method,args,requestId) {
    for(let attempt=0;attempt<4;attempt+=1) {
      const description=await this.#workspace.describe();
      try {return await this.#workspace[method]({...clone(args),requestId,expectedRevision:description.revision});}
      catch(error) {if(error.code!=='REVISION_CONFLICT'||attempt===3)throw error;}
    }
  }
  async #prepareWindow(watchId) {
    const native=await this.#workspace.describe();
    return this.#change(watchId,(watch)=>{
      if(watch.active)return;
      if(watch.endLedger!==null&&watch.nextLedger!==null&&watch.nextLedger>=watch.endLedger){watch.status='COMPLETE';return;}
      const config=watch.configurations.find((entry)=>entry.version===watch.configVersion);
      const repair=watch.recovery;
      const connectionAlias=repair?.connectionAlias??watch.config.connectionAlias;
      const connection=requireConnection(native.connections??[],connectionAlias,watch.network);
      watch.active={id:randomUUID(),configVersion:watch.configVersion,planId:watch.planId,planVersion:watch.planVersion,
        sourceWorkspaceId:watch.sourceWorkspaceId,network:watch.network,connectionAlias,connection:clone(connection),
        publicationTargetId:config.publicationTargetId,publication:clone(watch.config.publication),
        startLedger:watch.nextLedger,endLedger:null,selectedEndLedger:watch.endLedger,maxLedgers:watch.config.windowLedgers,
        phase:'CAPTURE',captureId:null,editionId:null,requests:[],pending:null,supersededCaptureIds:[],
        eventCount:0,inFlight:false,createdAt:now()};
      markStatus(watch,'RUNNING');
    });
  }
  async #retainedRepair(watchId) {
    const current=(await this.watchStatus({watchId})).watch;
    if(!current.recovery?.editionIds.length)return false;
    const candidates=[];
    for(const id of current.recovery.editionIds) {
      const result=await this.#workspace.edition({editionId:id});this.#validateRecoveryEdition(current,result.edition);candidates.push(result.edition);
    }
    candidates.sort((a,b)=>a.startLedger-b.startLedger||b.endLedger-a.endLedger);
    const boundary=current.nextLedger??current.initialLedger??candidates[0]?.startLedger;
    const edition=candidates.find((entry)=>entry.startLedger<=boundary&&entry.endLedger>boundary);
    requireValue(edition,'RECOVERY_RANGE_GAP','Retained source editions do not cover the next required ledger',{nextLedger:boundary,intervals:candidates.map((entry)=>({editionId:entry.id,startLedger:entry.startLedger,endLedger:entry.endLedger}))});
    if(current.endLedger!==null)requireValue(edition.endLedger<=current.endLedger,'RECOVERY_RANGE_MISMATCH','Recovery edition extends beyond the selected service end; select a native edition of the required interval');
    const capture=(await this.#workspace.captureStatus({captureId:edition.captureId})).capture;
    requireValue(capture.status==='COMPLETE','RECOVERY_SOURCE_INVALID','Recovery edition capture is incomplete');
    await this.#change(watchId,(watch)=>{
      requireValue(watch.recovery?.id===current.recovery.id,'REVISION_CONFLICT','The selected recovery source changed');
      const previous=watch.active;
      const config=watch.configurations.find((entry)=>entry.version===(previous?.configVersion??watch.configVersion));
      const discarded=[...(previous?.supersededCaptureIds??[]),...(previous?.captureId&&previous.captureId!==capture.id?[previous.captureId]:[])];
      watch.active={...(previous??{}),id:previous?.id??randomUUID(),configVersion:config.version,
        planId:edition.planId,planVersion:edition.planVersion,sourceWorkspaceId:watch.sourceWorkspaceId,network:edition.network,
        connectionAlias:capture.connectionAlias??null,connection:clone(capture.connection),
        publicationTargetId:config.publicationTargetId,publication:clone(config.config.publication),
        startLedger:edition.startLedger,endLedger:edition.endLedger,coveredFromLedger:boundary,
        phase:'PUBLISH',captureId:capture.id,editionId:edition.id,editionSha256:edition.sha256,eventCount:edition.eventCount,
        requests:previous?.requests??[],pending:null,supersededCaptureIds:[...new Set(discarded)],
        recovery:'RETAINED_EDITION',inFlight:false,createdAt:previous?.createdAt??now()};
      watch.recovery.editionIds=watch.recovery.editionIds.filter((id)=>id!==edition.id);
      if(watch.recovery.editionIds.length===0)watch.recovery=null;
      watch.lastError=null;markStatus(watch,'RUNNING');
    });
    return true;
  }
  async #switchConnection(watchId,name,reason) {
    const native=await this.#workspace.describe();
    await this.#change(watchId,(watch)=>{
      const active=watch.active;requireValue(active,'WATCH_WINDOW_MISSING','The original active window is missing');
      const connection=requireConnection(native.connections??[],name,watch.network);
      active.connectionAlias=name;active.connection=clone(connection);
      active.phase='CAPTURE';active.pending=null;active.recovery=reason;
      active.recoveryConnectionAlias=null;active.inFlight=false;watch.lastError=null;
      if(watch.recovery?.connectionAlias===name&&!watch.recovery.editionIds.length)watch.recovery=null;
      markStatus(watch,'RUNNING');
    });
  }
  async #processWindow(watchId,signal) {
    for(let step=0;step<16;step+=1) {
      let watch=(await this.watchStatus({watchId})).watch,active=watch.active;
      if(!active)return false;
      if(signal.aborted)return false;
      if(active.phase==='CAPTURE') {
        if(!active.pending&&watch.recovery?.editionIds.length) {
          await this.#retainedRepair(watchId);continue;
        }
        const repairAlias=active.recoveryConnectionAlias??watch.recovery?.connectionAlias;
        if(!active.pending&&repairAlias&&repairAlias!==active.connectionAlias) {
          await this.#switchConnection(watchId,repairAlias,'ARCHIVE_CURSOR_CONTINUATION');continue;
        }
        if(active.captureId&&!active.pending) {
          const retained=await this.#workspace.captureStatus({captureId:active.captureId});
          if(retained.capture.status==='COMPLETE') {
            await this.#change(watchId,(row)=>{row.active.phase='EDITION';row.active.startLedger=retained.capture.startLedger;
              row.active.endLedger=retained.capture.endLedger;row.active.eventCount=retained.capture.eventCount;});
            continue;
          }
        }
        if(!active.pending) {
          await this.#change(watchId,(row)=>{
            const current=row.active,method=current.captureId?'captureResume':'captureStart';
            const args=current.captureId?{captureId:current.captureId,connectionAlias:current.connectionAlias}:{planId:current.planId,planVersion:current.planVersion,
              connectionAlias:current.connectionAlias,sourceOriginWorkspaceId:current.sourceWorkspaceId,
              selection:{startLedger:current.startLedger,endLedger:current.endLedger??current.selectedEndLedger,maxLedgers:current.maxLedgers}};
            const pending={...childRequest(row,current,'capture',current.requests.filter((entry)=>entry.stage==='capture').length+1),
              method,args,stage:'capture',createdAt:now()};
            current.pending=pending;current.requests.push(clone(pending));current.inFlight=true;markStatus(row,'RUNNING');
          });
          watch=(await this.watchStatus({watchId})).watch;active=watch.active;
        } else await this.#change(watchId,(row)=>{row.active.inFlight=true;markStatus(row,'RUNNING');});
        let result;
        try { result=await this.#engineCall(active.pending.method,active.pending.args,active.pending.requestId); }
        catch(error) {
          if(error.code==='CONNECTION_REQUIRED') {
            const native=await this.#workspace.describe();
            const original=native.captures.find((entry)=>entry.createdByRequestId===active.pending.requestId);
            if(original)await this.#change(watchId,(row)=>{row.active.captureId=original.id;});
            const replacement=active.recoveryConnectionAlias??watch.recovery?.connectionAlias;
            if(replacement) {await this.#switchConnection(watchId,replacement,'RECEIVED_HOST_CURSOR_CONTINUATION');continue;}
          }
          throw error;
        }
        const capture=(await this.#workspace.captureStatus({captureId:result.capture.id})).capture;
        await this.#change(watchId,(row)=>{
          const current=row.active;current.captureId=capture.id;current.pending=null;current.inFlight=false;
          current.captureStatus=capture.status;current.cursor=capture.cursor;current.eventCount=capture.eventCount;
          if(capture.startLedger!==null){current.startLedger=capture.startLedger;current.endLedger=capture.endLedger;}
          current.latestLedger=capture.latestLedger;current.lastError=clone(capture.lastError);
          if(capture.status==='COMPLETE'){current.phase='EDITION';row.lastError=null;markStatus(row,'RUNNING');}
          else {
            row.lastError=clone(capture.lastError);
            row.status=capture.lastError?.code==='RETENTION_GAP'?'RETENTION_GAP':capture.status==='WAITING_FOR_LEDGER'?'WAITING_FOR_LEDGER':'INTERRUPTED';
          }
        });
        if(capture.status==='COMPLETE')continue;
        const current=(await this.watchStatus({watchId})).watch;
        const recovery=current.recovery?.connectionAlias??current.config.recoveryConnectionAlias;
        if(capture.lastError?.code==='RETENTION_GAP'&&recovery&&recovery!==current.active.connectionAlias) {
          if(current.active.connectionAlias===current.config.connectionAlias)
            await this.#change(watchId,(row)=>{row.active.lastPrimaryRetentionGap=clone(capture.lastError);});
          await this.#switchConnection(watchId,recovery,'RETENTION_ARCHIVE_CURSOR_CONTINUATION');continue;
        }
        if(capture.status==='WAITING_FOR_LEDGER'&&current.active.connectionAlias!==current.config.connectionAlias) {
          if(current.active.primaryContinuationCursor!==capture.cursor) {
            await this.#change(watchId,(row)=>{row.active.primaryContinuationCursor=capture.cursor;});
            await this.#switchConnection(watchId,current.config.connectionAlias,'PRIMARY_CURSOR_CONTINUATION');continue;
          }
          if(current.active.lastPrimaryRetentionGap)
            await this.#change(watchId,(row)=>{row.status='RETENTION_GAP';row.lastError=clone(row.active.lastPrimaryRetentionGap);});
        }
        return false;
      }
      if(active.phase==='EDITION') {
        if(!active.pending) {
          await this.#change(watchId,(row)=>{
            const current=row.active,pending={...childRequest(row,current,'edition'),method:'editionCreate',
              args:{captureId:current.captureId,name:row.name+' '+current.startLedger+'–'+(current.endLedger-1)},stage:'edition',createdAt:now()};
            current.pending=pending;current.requests.push(clone(pending));current.inFlight=true;
          });
          watch=(await this.watchStatus({watchId})).watch;active=watch.active;
        }
        const result=await this.#engineCall(active.pending.method,active.pending.args,active.pending.requestId);
        await this.#change(watchId,(row)=>{
          const current=row.active;current.editionId=result.edition.id;current.editionSha256=result.edition.sha256;
          current.eventCount=result.edition.eventCount;current.pending=null;current.inFlight=false;current.phase='PUBLISH';
        });
        continue;
      }
      if(active.phase==='PUBLISH') {
        let publication=null;
        if(active.publicationTargetId) {
          const target=selected(watch.publicationTargets,active.publicationTargetId,'Publication target');
          requireValue(target.directory,'PUBLICATION_TARGET_REQUIRED','Select a private publication directory for this received service before starting',{publicationTargetId:target.id});
          await this.#change(watchId,(row)=>{row.active.inFlight=true;});
          if(target.recoveryDirectory&&!await exists(target.directory,'publication.json')) await restoreSorobanPublication({directory:target.recoveryDirectory,destination:target.directory});
          if(await exists(target.directory,'publication.json'))
            publication=await appendSorobanEdition({workspace:this.#workspace,workspaceDirectory:this.#workspace.directory,editionId:active.editionId,directory:target.directory});
          else publication=await prepareSorobanPublication({workspace:this.#workspace,workspaceDirectory:this.#workspace.directory,editionId:active.editionId,...target.config,directory:target.directory});
          const expectedScope={workspaceId:watch.sourceWorkspaceId,network:watch.network,planId:watch.planId};
          requireValue(stableJSON(publication.publication.scope)===stableJSON(expectedScope),'PUBLICATION_SELECTION_CONFLICT','Original publication belongs to another logical source');
        }
        const edition=(await this.#workspace.edition({editionId:active.editionId})).edition;
        await this.#change(watchId,(row)=>{
          const current=row.active;
          const expected=row.nextLedger??current.coveredFromLedger??current.startLedger;
          requireValue(current.startLedger<=expected&&current.endLedger>expected,'WATCH_RANGE_GAP','Completed source does not cover the next required service ledger',{nextLedger:expected,startLedger:current.startLedger,endLedger:current.endLedger});
          const completed={...clone(current),phase:'COMPLETE',inFlight:false,pending:null,editionSha256:edition.sha256,
            eventCount:edition.eventCount,publication:publication?clone(publication):null,completedAt:now()};
          if(publication) {
            const target=selected(row.publicationTargets,current.publicationTargetId,'Publication target');
            target.publication=clone(publication.publication);target.lastEditionId=edition.id;target.lastWindowId=current.id;target.updatedAt=now();
            row.publication={targetId:target.id,...clone(publication)};
          }
          row.initialLedger??=expected;row.nextLedger=current.endLedger;row.windows.push(completed);
          row.active=null;row.lastError=null;
          row.status=row.endLedger!==null&&row.nextLedger>=row.endLedger?'COMPLETE':row.desiredState==='PAUSED'?'PAUSED':'RUNNING';
        });
        return true;
      }
      throw new SorobanEventsError('WATCH_PHASE_INVALID','The retained source window has an unsupported phase');
    }
    throw new SorobanEventsError('WATCH_RECOVERY_LOOP','The selected recovery sources did not advance this original window');
  }
  async #runWindows({watchId,signal,maxWindows,onlyRunning=false}) {
    checkedId(watchId);integer(maxWindows,'maxWindows',1,1000);
    let release;
    try {release=await acquireLock(this.#directory,'runner-'+watchId+'.lock');}
    catch(error) {
      if(error.code!=='WORKSPACE_BUSY')throw error;
      return {...await this.watchStatus({watchId}),completedWindows:[],busy:true};
    }
    const completedWindows=[];
    try {
      const initial=(await this.watchStatus({watchId})).watch,pauseVersion=initial.pauseVersion;
      for(let index=0;index<maxWindows;index+=1) {
        if(signal.aborted)break;
        let watch=(await this.watchStatus({watchId})).watch;
        if((onlyRunning&&watch.desiredState!=='RUNNING')||watch.pauseVersion!==pauseVersion)break;
        if(watch.status==='COMPLETE'&&!watch.active)break;
        if(watch.recovery?.editionIds.length&&!watch.active?.pending)await this.#retainedRepair(watchId);
        await this.#prepareWindow(watchId);watch=(await this.watchStatus({watchId})).watch;
        if(!watch.active)break;
        const id=watch.active.id;
        if(!await this.#processWindow(watchId,signal))break;
        const finished=(await this.watchStatus({watchId})).watch.windows.find((entry)=>entry.id===id);
        if(finished)completedWindows.push(finished);
      }
    } catch(error) {
      await this.#change(watchId,(watch)=>{
        if(watch.active)watch.active.inFlight=false;
        watch.lastError=errorData(error);watch.status=error.code==='RETENTION_GAP'?'RETENTION_GAP':'INTERRUPTED';
      });
    } finally {
      try {
        await this.#change(watchId,(watch)=>{
          if(watch.active)watch.active.inFlight=false;
          if(watch.desiredState==='PAUSED'&&watch.status==='PAUSING')watch.status='PAUSED';
        });
      } finally {await release();}
    }
    return {...await this.watchStatus({watchId}),completedWindows,busy:false};
  }
  watchRun({watchId,signal,maxWindows=1}={}) {
    requireValue(!this.#closing,'WATCH_CLOSED','Recurring service workspace is closing');
    const combined=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
    const task=this.#runWindows({watchId,signal:combined,maxWindows});
    this.#running.add(task);task.finally(()=>this.#running.delete(task)).catch(()=>{});return task;
  }
  run({watchId,signal}={}) {
    requireValue(!this.#closing,'WATCH_CLOSED','Recurring service workspace is closing');
    if(watchId!==undefined)checkedId(watchId);
    const combined=signal?AbortSignal.any([signal,this.#controller.signal]):this.#controller.signal;
    const task=(async()=>{
      const due=new Map();
      while(!combined.aborted) {
        const state=await this.#state(),rows=Object.values(state.watches).filter((watch)=>(watchId===undefined||watch.id===watchId)&&watch.desiredState==='RUNNING'&&watch.status!=='COMPLETE');
        let waitMs=1000;
        for(const watch of rows) {
          if(combined.aborted)break;
          const generation=[watch.configVersion,watch.pauseVersion,watch.lastStartedAt??''].join(':');
          const retained=due.get(watch.id),next=retained?.generation===generation?retained.at:0,remaining=next-Date.now();
          if(remaining>0){waitMs=Math.min(waitMs,remaining);continue;}
          await this.#runWindows({watchId:watch.id,signal:combined,maxWindows:1,onlyRunning:true});
          const updated=(await this.watchStatus({watchId:watch.id})).watch;
          due.set(watch.id,{at:Date.now()+updated.config.pollIntervalMs,generation:[updated.configVersion,updated.pauseVersion,updated.lastStartedAt??''].join(':')});
        }
        await delay(waitMs,combined);
      }
    })();
    this.#running.add(task);task.finally(()=>this.#running.delete(task)).catch(()=>{});return task;
  }

  async #copyNative(stage,exported,kind,id,descriptors) {
    const prefix='sources/'+exported.id,manifestBytes=await readFile(exported.directory,'manifest.json');
    requireValue(digest(manifestBytes)===exported.manifestSha256,'SOURCE_MISMATCH','Native source manifest changed while exporting the service');
    descriptors.push(await writeNew(stage,prefix+'/manifest.json',manifestBytes));
    for(const descriptor of exported.manifest.files)
      descriptors.push(await copyExact(exported.directory,descriptor,stage,prefix+'/'+descriptor.path));
    return {kind,id,exportId:exported.id,path:prefix,manifestSha256:exported.manifestSha256};
  }
  watchExport(input) {return this.#track(()=>this.#export(input));}
  watchReceive(input) {return this.#track(()=>this.#receive(input));}
  #track(operation) {
    requireValue(!this.#closing,'WATCH_CLOSED','Recurring service workspace is closing');
    const task=operation();this.#running.add(task);task.finally(()=>this.#running.delete(task)).catch(()=>{});return task;
  }
  async #export(input) {
    const request=await this.#intent('watch-export',input,(state,args)=>{
      checkedId(args.watchId);selected(state.watches,args.watchId);
      return {watchId:args.watchId,stageId:randomUUID(),watch:null,exported:null};
    });
    if(request.result)return request.result;
    let release;
    try {release=await acquireLock(this.#directory,'runner-'+request.context.watchId+'.lock');}
    catch(error) {
      if(error.code!=='WORKSPACE_BUSY')throw error;
      throw new SorobanEventsError('WATCH_BUSY','The active native window is draining; retry this same export request to retain its complete checkpoint');
    }
    try {
      let context=request.context;
      if(context.exported) {
        const exported=context.exported,stage=join(this.#directory,'staging','export-'+context.stageId);
        if(!await exists(exported.directory,'manifest.json')&&await exists(stage,'manifest.json')) {
          requireValue(digest(await readFile(stage,'manifest.json'))===exported.manifestSha256,'SOURCE_MISMATCH','Assembled service source manifest changed before publication');
          for(const descriptor of exported.manifest.files)await sourceFileRange(stage,descriptor,0,1);
          await privateDirectory(join(this.#directory,'exports'));await fs.rename(stage,exported.directory);
        }
        if(await exists(exported.directory,'manifest.json')) {
          requireValue(digest(await readFile(exported.directory,'manifest.json'))===exported.manifestSha256,'SOURCE_MISMATCH','Published service source manifest changed');
          await this.#control((state)=>{state.exports[exported.id]=clone(exported);});
          return await this.#finish(request.id,{export:exported});
        }
        throw new SorobanEventsError('SOURCE_MISSING','The assembled original export is missing its complete private source files');
      }
      if(context.watch) {
        await fs.rm(join(this.#directory,'staging','export-'+context.stageId),{recursive:true,force:true});
        await this.#control((state)=>{
          const stored=selected(state.requests,request.id,'Original export request');
          stored.context={watchId:context.watchId,stageId:randomUUID(),watch:null,exported:null};context=clone(stored.context);
        });
      }
      const current=(await this.watchStatus({watchId:context.watchId})).watch;
      if(current.active?.pending?.stage==='edition') {
        const pending=current.active.pending,result=await this.#engineCall(pending.method,pending.args,pending.requestId);
        await this.#change(current.id,(watch)=>{
          requireValue(watch.active?.pending?.requestId===pending.requestId,'REVISION_CONFLICT','The retained edition operation changed before export');
          watch.active.editionId=result.edition.id;watch.active.editionSha256=result.edition.sha256;
          watch.active.eventCount=result.edition.eventCount;watch.active.pending=null;watch.active.inFlight=false;watch.active.phase='PUBLISH';
        });
      }
      if(!context.watch) {
        const native=await this.#workspace.describe();
        await this.#control((state)=>{
          const stored=selected(state.requests,request.id,'Original export request'),watch=clone(selected(state.watches,context.watchId));
          if(watch.active?.pending?.stage==='capture'&&!watch.active.captureId) {
            const capture=native.captures.find((entry)=>entry.createdByRequestId===watch.active.pending.requestId);
            if(capture)watch.active.captureId=capture.id;
          }
          if(watch.active)watch.active.inFlight=false;
          const versions=new Set([watch.planVersion,...watch.configurations.map((entry)=>entry.planVersion),
            ...watch.windows.map((entry)=>entry.planVersion),...(watch.active?[watch.active.planVersion]:[])]);
          stored.context.watch=watch;stored.context.originRevision=state.revision;
          stored.context.plans=[...versions].map((version)=>clone(requirePlan(native,watch.planId,version)));
          context=clone(stored.context);
        });
      }
      if(context.exported&&await exists(context.exported.directory,'manifest.json')) {
        await this.#control((state)=>{state.exports[context.exported.id]=clone(context.exported);});
        return await this.#finish(request.id,{export:context.exported});
      }
      const stage=join(this.#directory,'staging','export-'+context.stageId);await privateDirectory(stage);
      const descriptors=[],sources=[],watch=context.watch,native=await this.#workspace.describe();
      const editionIds=[...new Set([...watch.windows.map((entry)=>entry.editionId),...(watch.active?.editionId?[watch.active.editionId]:[])])];
      const capturedByEdition=new Set();
      for(const editionId of editionIds) {
        const edition=native.editions.find((entry)=>entry.id===editionId);
        requireValue(edition,'SOURCE_MISSING','A retained service edition is missing from its original workspace',{editionId});
        capturedByEdition.add(edition.captureId);
        const exported=await this.#engineCall('sourceExport',{editionId},'watch-export.'+digest(request.id+'.generation.'+context.stageId+'.edition.'+editionId));
        sources.push(await this.#copyNative(stage,exported.export,'edition',editionId,descriptors));
      }
      const captureIds=new Set();
      for(const window of [...watch.windows,...(watch.active?[watch.active]:[])]) {
        if(window.captureId&&!capturedByEdition.has(window.captureId))captureIds.add(window.captureId);
        for(const id of window.supersededCaptureIds??[])if(!capturedByEdition.has(id))captureIds.add(id);
      }
      for(const captureId of captureIds) {
        const exported=await this.#engineCall('captureSourceExport',{captureId},'watch-export.'+digest(request.id+'.generation.'+context.stageId+'.capture.'+captureId));
        sources.push(await this.#copyNative(stage,exported.export,'capture',captureId,descriptors));
      }
      const snapshots=[];
      for(const target of Object.values(watch.publicationTargets)) {
        const prefix='publications/'+target.id,snapshotDirectory=join(stage,prefix);
        let recovery;
        if(await exists(snapshotDirectory,'recovery.json')) recovery=await readJSON(snapshotDirectory,'recovery.json');
        else if(target.directory&&await exists(target.directory,'publication.json')) {
          await fs.rm(snapshotDirectory,{recursive:true,force:true});
          await privateDirectory(join(stage,'publications'));
          recovery=await snapshotSorobanPublication({directory:target.directory,destination:snapshotDirectory});
        } else if(target.recoveryDirectory) {
          const original=await readJSON(target.recoveryDirectory,'recovery.json');
          await privateDirectory(snapshotDirectory);
          for(const [name,descriptor] of Object.entries(original.files))
            await copyExact(target.recoveryDirectory,{path:name,...descriptor,contentType:name.endsWith('.json')?'application/json':'application/octet-stream'},snapshotDirectory,name);
          await writeNew(snapshotDirectory,'recovery.json',await readFile(target.recoveryDirectory,'recovery.json'));
          recovery=original;
        } else continue;
        const bytes=await readFile(snapshotDirectory,'recovery.json');
        const expectedScope={workspaceId:watch.sourceWorkspaceId,network:watch.network,planId:watch.planId};
        requireValue(stableJSON(recovery.scope)===stableJSON(expectedScope),'PUBLICATION_SELECTION_CONFLICT','Original publisher snapshot selects a different logical service source');
        descriptors.push({path:prefix+'/recovery.json',bytes:bytes.length,sha256:digest(bytes),contentType:'application/json'});
        for(const [name,descriptor] of Object.entries(recovery.files)) {
          relativeFile(name);
          const declared={path:name,...descriptor,contentType:name.endsWith('.json')?'application/json':'application/octet-stream'};
          await sourceFileRange(snapshotDirectory,declared,0,1);
          descriptors.push({...declared,path:prefix+'/'+name});
        }
        for(const retained of recovery.editions) {
          const edition=native.editions.find((entry)=>entry.id===retained.editionId);
          requireValue(edition&&edition.source.sha256===retained.sourceSha256,'SOURCE_MISSING',
            'Retain the original native source for every edition present in this publisher snapshot',{editionId:retained.editionId});
          if(!sources.some((entry)=>entry.kind==='edition'&&entry.id===edition.id)) {
            const exported=await this.#engineCall('sourceExport',{editionId:edition.id},
              'watch-export.'+digest(request.id+'.generation.'+context.stageId+'.publisher-edition.'+edition.id));
            sources.push(await this.#copyNative(stage,exported.export,'edition',edition.id,descriptors));
          }
        }
        snapshots.push({targetId:target.id,path:prefix,manifestSha256:digest(bytes),storeId:recovery.storeId,scope:clone(recovery.scope)});
      }
      const source={schema:'stellar-forge.soroban-events.watch-source.v1',createdAt:request.startedAt,
        origin:{workspaceId:this.#workspaceId,revision:context.originRevision},
        watch:portable(watch),plans:context.plans,sources,snapshots};
      const metadata=await writeNew(stage,'watch.json',jsonBytes(source));descriptors.push(metadata);
      descriptors.sort((a,b)=>a.path.localeCompare(b.path));
      const exportId=digest(stableJSON({schema:EXPORT_SCHEMA,workspaceId:this.#workspaceId,watchId:watch.id,files:descriptors}));
      const manifest={schema:EXPORT_SCHEMA,exportId,watchId:watch.id,files:descriptors,fileCount:descriptors.length,
        bytes:descriptors.reduce((sum,file)=>sum+file.bytes,0)};
      const manifestBytes=jsonBytes(manifest);await writeNew(stage,'manifest.json',manifestBytes);
      const directory=join(this.#directory,'exports',exportId);await privateDirectory(join(this.#directory,'exports'));
      const exported={id:exportId,directory,watchId:watch.id,manifest,manifestSha256:digest(manifestBytes),createdAt:request.startedAt};
      await this.#control((state)=>{selected(state.requests,request.id,'Original export request').context.exported=clone(exported);});
      try {await fs.rename(stage,directory);}
      catch(error) {
        if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;
        requireValue((await readFile(directory,'manifest.json')).equals(manifestBytes),'SOURCE_CONFLICT','An existing service export differs from this original source');
        await fs.rm(stage,{recursive:true,force:true});
      }
      await this.#control((state)=>{state.exports[exportId]=clone(exported);});
      return await this.#finish(request.id,{export:exported});
    } finally {await release();}
  }
  async sourceFile({exportId,path,offset=0,length=null}) {
    const state=await this.#state(),exported=selected(state.exports,exportId,'Service export');
    const descriptor=path==='manifest.json'?{path,sha256:exported.manifestSha256,contentType:'application/json'}:
      exported.manifest.files.find((entry)=>entry.path===path);
    requireValue(descriptor,'NOT_FOUND','File is not part of the original selected service export');
    return sourceFileRange(exported.directory,descriptor,offset,length);
  }
  async #receive(input) {
    const request=await this.#intent('watch-receive',input,()=>({operationId:randomUUID(),manifestSha256:null}));
    if(request.result)return request.result;
    const expected=request.context.manifestSha256??input.expectedManifestSha256;
    const bundle=await readWatchBundle(input.sourceDirectory,expected),{manifest,manifestBytes,source}=bundle;
    if(!request.context.manifestSha256)await this.#control((state)=>{
      selected(state.requests,request.id,'Original receive request').context.manifestSha256=digest(manifestBytes);
    });
    let release;
    try {release=await acquireLock(this.#directory,'runner-'+source.watch.id+'.lock');}
    catch(error) {
      if(error.code!=='WORKSPACE_BUSY')throw error;
      throw new SorobanEventsError('WATCH_BUSY','The current native window is draining; retry this same receiving request afterward');
    }
    try {
      const retainedDirectory=join(this.#directory,'received',manifest.exportId);await privateDirectory(retainedDirectory);
      for(const descriptor of manifest.files)await copyExact(input.sourceDirectory,descriptor,retainedDirectory,descriptor.path);
      await writeNew(retainedDirectory,'manifest.json',manifestBytes);
      for(const plan of source.plans)
        await this.#engineCall('planReceive',{plan},'watch-receive.'+digest(request.id+'.plan.'+plan.id+'.'+plan.version));
      for(const native of source.sources.filter((entry)=>entry.kind==='capture')) {
        await this.#engineCall('captureSourceReceive',{sourceDirectory:join(retainedDirectory,native.path),expectedManifestSha256:native.manifestSha256},
          'watch-receive.'+digest(request.id+'.capture.'+native.exportId));
      }
      for(const native of source.sources.filter((entry)=>entry.kind==='edition')) {
        await this.#engineCall('sourceReceive',{sourceDirectory:join(retainedDirectory,native.path),expectedManifestSha256:native.manifestSha256},
          'watch-receive.'+digest(request.id+'.edition.'+native.exportId));
      }
      const native=await this.#workspace.describe(),incoming=clone(source.watch);
      validateServiceSources(incoming,source,native,this.#workspaceId);
      const state=await this.#state(),previous=own(state.watches,incoming.id)?state.watches[incoming.id]:null;
      const retainPrevious=previous?preferExistingWatch(previous,incoming):false;
      if(retainPrevious) {
        const result=await this.#change(incoming.id,(watch)=>{
          watch.desiredState='PAUSED';watch.pauseVersion+=1;
          watch.status=watch.status==='COMPLETE'?'COMPLETE':'PAUSED';
          watch.receivedFrom={workspaceId:watch.sourceWorkspaceId,fromWorkspaceId:source.origin.workspaceId,
            exportId:manifest.exportId,manifestSha256:digest(manifestBytes)};
        });
        return await this.#finish(request.id,{watch:result.watch,received:true,retainedNewer:true});
      }
      const connectionAlias=input.connectionAlias??'default',recoveryAlias=input.recoveryConnectionAlias??null;
      alias(connectionAlias,'connectionAlias');if(recoveryAlias!==null)alias(recoveryAlias,'recoveryConnectionAlias');
      const available=(native.connections??[]).find((entry)=>entry.alias===connectionAlias);
      if(available)requireValue(available.network===incoming.network,'RPC_NETWORK_MISMATCH','Receiving host alias must select the original service network');
      const recovery= recoveryAlias===null?null:(native.connections??[]).find((entry)=>entry.alias===recoveryAlias);
      if(recovery)requireValue(recovery.network===incoming.network,'RPC_NETWORK_MISMATCH','Receiving archive alias must select the original service network');
      if(input.publicationDirectory!==undefined&&input.publicationDirectory!==null)
        requireValue(typeof input.publicationDirectory==='string'&&isAbsolute(input.publicationDirectory)&&resolve(input.publicationDirectory)===input.publicationDirectory,
          'INVALID_DIRECTORY','Select an absolute normalized private publication receiving base');
      for(const target of Object.values(incoming.publicationTargets)) {
        const snapshot=source.snapshots.find((entry)=>entry.targetId===target.id);
        target.directory=null;
        target.config=portable(target.config);
        target.recoveryDirectory=snapshot?join(retainedDirectory,snapshot.path):null;
        if(input.publicationDirectory) {
          await privateDirectory(input.publicationDirectory);
          const directory=join(input.publicationDirectory,target.id+'-'+(snapshot?.manifestSha256??manifest.exportId).slice(0,12));
          target.directory=directory;target.config={...target.config,directory};
          if(snapshot) {
            if(!await exists(directory,'publication.json'))
              await restoreSorobanPublication({directory:target.recoveryDirectory,destination:directory});
            const restored=await inspectSorobanPublication({directory});
            requireValue(restored.publication.storeId===snapshot.storeId&&stableJSON(restored.publication.scope)===stableJSON(snapshot.scope),
              'PUBLICATION_SELECTION_CONFLICT','Receiving publication differs from the original preserved publisher');
            target.publication=clone(restored.publication);
          }
        }
      }
      const oldCurrent=incoming.configurations.find((entry)=>entry.version===incoming.configVersion);
      const currentTarget=oldCurrent.publicationTargetId?incoming.publicationTargets[oldCurrent.publicationTargetId]:null;
      incoming.config={...incoming.config,connectionAlias,recoveryConnectionAlias:recoveryAlias,
        publication:currentTarget?.directory?{...currentTarget.config,directory:currentTarget.directory}:null};
      incoming.configVersion+=1;
      incoming.configurations.push({version:incoming.configVersion,planVersion:incoming.planVersion,config:clone(incoming.config),
        connection:available?clone(available):{alias:connectionAlias,network:incoming.network},
        recoveryConnection:recovery?clone(recovery):null,publicationTargetId:oldCurrent.publicationTargetId,changedAt:now(),received:true});
      if(incoming.active) {
        incoming.active.inFlight=false;
        if(incoming.active.pending)incoming.active.requests.push({...incoming.active.pending,receivedPending:true,receivedAt:now()});
        incoming.active.pending=null;
        if(incoming.active.phase==='CAPTURE'&&incoming.active.captureId) {
          const capture=native.captures.find((entry)=>entry.id===incoming.active.captureId);
          if(capture?.status==='COMPLETE'){incoming.active.phase='EDITION';incoming.active.startLedger=capture.startLedger;incoming.active.endLedger=capture.endLedger;}
          else {
            incoming.active.connectionAlias=available?connectionAlias:recovery?recoveryAlias:connectionAlias;
            if(available??recovery)incoming.active.connection=clone(available??recovery);
            incoming.active.recoveryConnectionAlias=null;
          }
        } else if(incoming.active.phase==='CAPTURE') {
          incoming.active.connectionAlias=connectionAlias;
          if(available)incoming.active.connection=clone(available);
        }
      }
      incoming.recovery=null;incoming.desiredState='PAUSED';incoming.status=incoming.status==='COMPLETE'?'COMPLETE':'PAUSED';
      incoming.pauseVersion+=1;incoming.lastError=null;incoming.updatedAt=now();
      incoming.receivedFrom={workspaceId:incoming.sourceWorkspaceId,fromWorkspaceId:source.origin.workspaceId,
        exportId:manifest.exportId,manifestSha256:digest(manifestBytes)};
      await this.#control((saved)=>{
        const latest=own(saved.watches,incoming.id)?saved.watches[incoming.id]:null;
        if(latest)requireValue(!preferExistingWatch(latest,incoming),'REVISION_CONFLICT','Local service progressed while receiving its source');
        saved.watches[incoming.id]=clone(incoming);
      });
      return await this.#finish(request.id,{watch:incoming,received:true,retainedNewer:false});
    } finally {await release();}
  }
  async close() {
    if(this.#closing)return;
    this.#closing=true;this.#controller.abort();
    await Promise.allSettled([...this.#running]);await this.#tail;
  }
}
export async function openSorobanEventWatches({workspace,directory}={}) {
  requireValue(workspace&&typeof workspace.describe==='function'&&typeof workspace.directory==='string',
    'INVALID_ARGUMENT','Use the already-open original Soroban event workspace');
  return new SorobanEventWatches(workspace,directory??join(workspace.directory,'watches')).initialize();
}

async function copyExact(sourceDirectory,descriptor,targetDirectory,targetRelative) {
  relativeFile(descriptor.path);relativeFile(targetRelative);
  await sourceFileRange(sourceDirectory,descriptor,0,1);
  const source=await filePath(sourceDirectory,descriptor.path),target=await filePath(targetDirectory,targetRelative,true);
  const expected={...descriptor,path:targetRelative};
  try {await sourceFileRange(targetDirectory,expected,0,1);return expected;}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  const temporary=targetRelative+'.pending-'+randomUUID(),path=await filePath(targetDirectory,temporary,true);
  try {
    await fs.copyFile(source,path,constants.COPYFILE_EXCL);await fs.chmod(path,0o600);
    await sourceFileRange(targetDirectory,{...descriptor,path:temporary},0,1);
    const handle=await fs.open(path,'r');try{await handle.sync();}finally{await handle.close();}
    try{await fs.link(path,target);}
    catch(error){if(error.code!=='EEXIST')throw error;await sourceFileRange(targetDirectory,expected,0,1);}
  } finally {await fs.unlink(path).catch((error)=>{if(error.code!=='ENOENT')throw error;});}
  return expected;
}
async function readWatchBundle(directory,expectedManifestSha256) {
  requireValue(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory&&await fs.realpath(directory)===directory,
    'INVALID_DIRECTORY','Select the original complete service source directory');
  const manifestBytes=await readFile(directory,'manifest.json'),manifest=JSON.parse(manifestBytes);
  if(expectedManifestSha256!==undefined) {
    requireValue(typeof expectedManifestSha256==='string'&&HASH.test(expectedManifestSha256),'INVALID_ARGUMENT','expectedManifestSha256 must be a lowercase SHA-256');
    requireValue(digest(manifestBytes)===expectedManifestSha256,'SOURCE_MISMATCH','The original service manifest changed before receiving');
  }
  requireValue(manifest.schema===EXPORT_SCHEMA&&HASH.test(manifest.exportId??'')&&UUID.test(manifest.watchId??'')&&
    Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=1000000&&manifest.fileCount===manifest.files.length,
    'SOURCE_MANIFEST','Unsupported or incomplete recurring service source manifest');
  const files=new Map();let total=0;
  for(const descriptor of manifest.files) {
    relativeFile(descriptor.path);
    requireValue(descriptor.path!=='manifest.json'&&!files.has(descriptor.path)&&HASH.test(descriptor.sha256??'')&&
      Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0,'SOURCE_MANIFEST','Service manifest has an invalid or repeated source file');
    await sourceFileRange(directory,descriptor,0,1);files.set(descriptor.path,descriptor);total+=descriptor.bytes;
  }
  requireValue(Number.isSafeInteger(manifest.bytes)&&manifest.bytes===total&&files.has('watch.json'),'SOURCE_MANIFEST','Service source inventory or byte total differs');
  const source=await readJSON(directory,'watch.json'),watch=source.watch;
  requireValue(source.schema==='stellar-forge.soroban-events.watch-source.v1'&&UUID.test(source.origin?.workspaceId??'')&&
    UUID.test(watch?.id??'')&&watch.id===manifest.watchId&&UUID.test(watch.sourceWorkspaceId??'')&&UUID.test(watch.planId??'')&&
    Array.isArray(source.plans)&&Array.isArray(source.sources)&&Array.isArray(source.snapshots)&&
    Array.isArray(watch.windows)&&Array.isArray(watch.configurations)&&watch.publicationTargets&&typeof watch.publicationTargets==='object',
    'SOURCE_SCHEMA','Recurring source identity or operation history is invalid');
  requireValue(manifest.exportId===digest(stableJSON({schema:EXPORT_SCHEMA,workspaceId:source.origin.workspaceId,watchId:watch.id,files:manifest.files})),
    'SOURCE_MISMATCH','Service source identity differs from its retained manifest');
  const expected=new Set(['watch.json']),sourceIds=new Set(),snapshotIds=new Set();
  for(const item of source.sources) {
    requireValue(['edition','capture'].includes(item.kind)&&UUID.test(item.id??'')&&HASH.test(item.exportId??'')&&
      HASH.test(item.manifestSha256??'')&&item.path==='sources/'+item.exportId&&!sourceIds.has(item.kind+':'+item.id),
      'SOURCE_SCHEMA','Native source export selection is invalid or repeated');
    sourceIds.add(item.kind+':'+item.id);
    const nativeBytes=await readFile(directory,item.path+'/manifest.json'),native=JSON.parse(nativeBytes);
    requireValue(digest(nativeBytes)===item.manifestSha256&&native.exportId===item.exportId&&
      native.schema==='stellar-forge.soroban-events.'+(item.kind==='edition'?'source-export':'capture-export')+'.v1'&&
      native[item.kind==='edition'?'editionId':'captureId']===item.id&&Array.isArray(native.files),
      'SOURCE_MANIFEST','Native source manifest differs from its original service selection');
    expected.add(item.path+'/manifest.json');
    for(const descriptor of native.files) {
      const path=item.path+'/'+relativeFile(descriptor.path),outer=files.get(path);
      requireValue(outer&&outer.bytes===descriptor.bytes&&outer.sha256===descriptor.sha256,
        'SOURCE_MANIFEST','Original native source file differs from the service inventory',{path});
      expected.add(path);
    }
  }
  for(const snapshot of source.snapshots) {
    requireValue(UUID.test(snapshot.targetId??'')&&!snapshotIds.has(snapshot.targetId)&&snapshot.path==='publications/'+snapshot.targetId&&
      HASH.test(snapshot.manifestSha256??'')&&own(watch.publicationTargets,snapshot.targetId),'SOURCE_SCHEMA','Original publication snapshot selection is invalid');
    snapshotIds.add(snapshot.targetId);
    const bytes=await readFile(directory,snapshot.path+'/recovery.json'),recovery=JSON.parse(bytes);
    requireValue(digest(bytes)===snapshot.manifestSha256&&recovery.storeId===snapshot.storeId&&stableJSON(recovery.scope)===stableJSON(snapshot.scope),
      'SOURCE_MANIFEST','Original publisher snapshot differs from its preserved selection');
    expected.add(snapshot.path+'/recovery.json');
    for(const [name,descriptor] of Object.entries(recovery.files)) {
      const path=snapshot.path+'/'+relativeFile(name),outer=files.get(path);
      requireValue(outer&&outer.bytes===descriptor.bytes&&outer.sha256===descriptor.sha256,'SOURCE_MANIFEST','Original publisher file differs from its retained manifest',{path});
      expected.add(path);
    }
  }
  requireValue(expected.size===files.size&&[...expected].every((path)=>files.has(path)),'SOURCE_MANIFEST','Service export has missing or undeclared native files');
  return {manifest,manifestBytes,source,files};
}
function validateServiceSources(watch,source,native,receivingWorkspaceId) {
  integer(watch.planVersion,'planVersion');integer(watch.configVersion,'configVersion');integer(watch.pauseVersion,'pauseVersion',0,Number.MAX_SAFE_INTEGER);
  const plans=new Map(source.plans.map((plan)=>[plan.version,plan]));
  requireValue(plans.size===source.plans.length&&source.plans.every((plan)=>plan.id===watch.planId)&&plans.has(watch.planVersion),
    'SOURCE_PLAN_MISMATCH','Service saved plan history is incomplete');
  const configurations=new Map();
  for(const config of watch.configurations) {
    integer(config.version,'configVersion');requireValue(!configurations.has(config.version)&&plans.has(config.planVersion),'SOURCE_PLAN_MISMATCH','Service configuration version is repeated or lacks its original plan');
    integer(config.config?.windowLedgers,'windowLedgers',1,1000000);integer(config.config?.pollIntervalMs,'pollIntervalMs',1000,86400000);
    if(config.publicationTargetId!==null)requireValue(UUID.test(config.publicationTargetId??'')&&own(watch.publicationTargets,config.publicationTargetId),'SOURCE_PUBLICATION_MISMATCH','Service configuration lost its original publication selection');
    configurations.set(config.version,config);
  }
  requireValue(configurations.has(watch.configVersion)&&configurations.get(watch.configVersion).planVersion===watch.planVersion,
    'SOURCE_PLAN_MISMATCH','Current service configuration differs from its pinned saved plan');
  if(watch.initialLedger!==null)integer(watch.initialLedger,'initialLedger');
  if(watch.nextLedger!==null)integer(watch.nextLedger,'nextLedger',1,4294967296);
  if(watch.endLedger!==null)integer(watch.endLedger,'endLedger',2,4294967296);
  let boundary=watch.initialLedger;
  const ids=new Set(),captureById=new Map(native.captures.map((entry)=>[entry.id,entry]));
  for(const window of [...watch.windows,...(watch.active?[watch.active]:[])]) {
    checkedId(window.id,'windowId');requireValue(!ids.has(window.id),'SOURCE_WINDOW_MISMATCH','Service repeats an original window');ids.add(window.id);
    const config=configurations.get(window.configVersion);
    requireValue(config&&window.planId===watch.planId&&window.planVersion===config.planVersion&&window.sourceWorkspaceId===watch.sourceWorkspaceId&&
      window.network===watch.network&&window.publicationTargetId===config.publicationTargetId,'SOURCE_SELECTION_MISMATCH','Window differs from its original pinned service selection');
    const capture=window.captureId?captureById.get(window.captureId):null;
    if(window.captureId)requireValue(capture&&capture.planId===window.planId&&capture.planVersion===window.planVersion&&
      capture.connection.network===watch.network&&(capture.sourceOriginWorkspaceId??source.origin.workspaceId)===watch.sourceWorkspaceId,
      'SOURCE_SELECTION_MISMATCH','Window capture differs from its original logical source and pinned plan');
    if(window.editionId) {
      const edition=native.editions.find((entry)=>entry.id===window.editionId);
      requireValue(edition&&edition.captureId===window.captureId&&edition.planVersion===window.planVersion&&
        edition.startLedger===window.startLedger&&edition.endLedger===window.endLedger&&
        (window.editionSha256===undefined||edition.sha256===window.editionSha256)&&
        (edition.sourceOriginWorkspaceId??edition.receivedFrom?.workspaceId??receivingWorkspaceId)===watch.sourceWorkspaceId,
        'SOURCE_SELECTION_MISMATCH','Service window differs from its retained original edition');
    }
    if(window!==watch.active) {
      requireValue(window.phase==='COMPLETE'&&window.editionId&&Number.isSafeInteger(window.startLedger)&&Number.isSafeInteger(window.endLedger),
        'SOURCE_WINDOW_MISMATCH','Completed service window lacks its original full edition');
      boundary??=window.coveredFromLedger??window.startLedger;
      requireValue(window.startLedger<=boundary&&window.endLedger>boundary&&(window.coveredFromLedger===undefined||window.coveredFromLedger===boundary),
        'SOURCE_RANGE_GAP','Service history omits a required original ledger interval',{nextLedger:boundary,windowId:window.id});
      boundary=window.endLedger;
    } else if(window.startLedger!==null&&boundary!==null)
      requireValue(window.startLedger<=boundary&&(window.endLedger===null||window.endLedger>boundary),'SOURCE_RANGE_GAP','Active source window no longer covers the next required ledger');
    for(const captureId of window.supersededCaptureIds??[])requireValue(captureById.has(captureId),'SOURCE_MISSING','Original superseded capture is missing from the complete source');
  }
  requireValue(boundary===watch.nextLedger,'SOURCE_RANGE_GAP','Service checkpoint differs from its complete original ledger history');
  for(const target of Object.values(watch.publicationTargets)) {
    checkedId(target.id,'publicationTargetId');
    if(target.publication || watch.windows.some((window)=>window.publicationTargetId===target.id&&window.publication))
      requireValue(source.snapshots.some((snapshot)=>snapshot.targetId===target.id),'SOURCE_PUBLICATION_MISMATCH','Complete service source omitted its original publisher recovery state');
  }
  for(const snapshot of source.snapshots)
    requireValue(stableJSON(snapshot.scope)===stableJSON({workspaceId:watch.sourceWorkspaceId,network:watch.network,planId:watch.planId}),
      'SOURCE_PUBLICATION_MISMATCH','Original publisher belongs to a different logical source');
}
function preferExistingWatch(previous,incoming) {
  requireValue(previous.id===incoming.id&&previous.sourceWorkspaceId===incoming.sourceWorkspaceId&&previous.planId===incoming.planId&&previous.network===incoming.network,
    'SOURCE_CONFLICT','An existing recurring service uses a different logical source');
  const common=Math.min(previous.windows.length,incoming.windows.length);
  for(let index=0;index<common;index+=1) {
    const a=previous.windows[index],b=incoming.windows[index];
    requireValue(a.id===b.id&&a.editionId===b.editionId&&a.editionSha256===b.editionSha256&&a.planVersion===b.planVersion&&
      a.startLedger===b.startLedger&&a.endLedger===b.endLedger,'SOURCE_CONFLICT','Original service window histories diverge');
  }
  if(previous.windows.length!==incoming.windows.length)return previous.windows.length>incoming.windows.length;
  if(previous.active&&incoming.active)
    requireValue(previous.active.id===incoming.active.id&&previous.active.planVersion===incoming.active.planVersion,
      'SOURCE_CONFLICT','Original active service windows diverge');
  if(previous.active&&!incoming.active)return true;
  if(!previous.active&&incoming.active)return false;
  return previous.updatedAt>=incoming.updatedAt;
}
