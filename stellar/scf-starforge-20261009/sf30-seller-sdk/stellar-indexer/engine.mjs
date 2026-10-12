import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  files, now, clone, digest, canonical, jsonBytes, plain, own, need, integer, text, identifier, selected,
  privateDirectory, exists, withLock, publicError, encodeValue, decodeValue, displayValue, descriptor, collectFiles, StellarIndexerError,
  connection as normalizeConnection, publicConnection,
} from './common.mjs';
import { METHODS, SDK_VERSION, methodFor, normalizeQuery, pinArguments, invokeNativePage } from './sdk-native.mjs';
import { retainIndexerRuntime, verifyIndexerRuntime } from './runtime.mjs';
import { IndexerReceiving } from './receiving.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.stellar-indexer.workspace.v1';
const INDEXER_SOURCE = dirname(fileURLToPath(import.meta.url));
const UNCHANGED = Symbol('unchanged');
const unchanged = (value) => ({[UNCHANGED]:true,value});
const summary = (capture) => {
  const value=clone(capture);delete value.pages;delete value.attempts;
  return {...value,pageCount:capture.pages.length,attemptCount:capture.attempts.length};
};
function requestInput(input) {
  need(plain(input),'INVALID_ARGUMENT','Supply operation arguments.');
  const {requestId,expectedRevision,...args}=input;
  return {requestId:text(requestId,'request ID',250),expectedRevision,args,digest:digest(canonical(encodeValue(args)))};
}
function stateShape(state) {
  need(state?.schema===WORKSPACE_SCHEMA,'WORKSPACE_SCHEMA','Select the original Stellar Indexer workspace.');
  identifier(state.id);integer(state.revision,'workspace revision');
  for(const key of ['queries','captures','editions','exports','requests','runtimes'])
    need(plain(state[key]),'WORKSPACE_SCHEMA','The original workspace has an invalid '+key+' collection.');
  return state;
}
function versionBody(version) {
  const value=clone(version);delete value.sha256;return value;
}
export function validateQueryVersion(version) {
  identifier(version.queryId);integer(version.version,'query version',1);
  methodFor(version.method);
  need(digest(jsonBytes(versionBody(version)))===version.sha256,'QUERY_SOURCE_CHANGED','The saved query differs from its original pinned version.');
  if(version.receivedSourceVersion) {
    const original=version.receivedSourceVersion,native=versionBody(version);
    identifier(original.queryId);integer(original.version,'original query version',1);
    delete native.receivedSourceVersion;native.queryId=original.queryId;
    need(original.version===version.version&&digest(jsonBytes(native))===original.sha256,'QUERY_SOURCE_CHANGED',
      'The received query must preserve the complete original native version.');
  }
  return version;
}
function selectedVersion(state,id,number) {
  const query=selected(state.queries,id,'Query');
  const version=query.versions.find(item=>item.version===(number??query.currentVersion));
  need(version,'QUERY_VERSION_MISSING','The selected original query version is missing.');return validateQueryVersion(version);
}
function checkedRuntime(runtime) {
  need(typeof runtime.id==='string'&&/^[a-f0-9]{64}$/.test(runtime.id)&&typeof runtime.directory==='string',
    'SDK_RUNTIME_IDENTITY','The original runtime must return its complete content identity.');
  return {id:runtime.id,directory:runtime.directory,manifestSha256:runtime.manifestSha256,
    entrypoint:runtime.entrypoint,entrypoints:runtime.entrypoints};
}
export async function inspectStellarIndexerWorkspace({directory,allowMissing=false}={}) {
  try {
    const state=stateShape(await files.readJSON(directory,'workspace.json'));
    return {exists:true,id:state.id,workspaceId:state.id,revision:state.revision,directory};
  }catch(error) {
    if(allowMissing&&error.code==='ENOENT')return {exists:false,directory};
    throw error;
  }
}
class StellarIndexerWorkspace {
  #directory;#connections;#changes=Promise.resolve();#running=new Map();#controllers=new Map();#closed=false;#receiving;#installationDirectory;
  constructor({directory,connections,eventWorkspace,eventWatches,installationDirectory=INDEXER_SOURCE}) {
    this.#directory=directory;
    need(typeof installationDirectory==='string'&&installationDirectory.trim()&&!installationDirectory.includes('\0'),
      'INVALID_RUNTIME_INSTALLATION','Select the actual installed dependency project directory.');
    this.#installationDirectory=resolve(installationDirectory);
    need(plain(connections??{}),'INVALID_CONNECTION','Named connections must be an object.');
    this.#connections=new Map(Object.entries(connections??{}).map(([alias,input])=>[alias,normalizeConnection(alias,input)]));
    this.#receiving=new IndexerReceiving({
      directory,sourceDirectory:INDEXER_SOURCE,eventWorkspace,eventWatches,
      state:()=>this.#state(),edit:(work)=>this.#edit(work),
      intent:(action,input,prepare)=>this.#intent(action,input,prepare),
      finish:(id,result)=>this.#finish(id,result),
      ensureEdition:(id)=>this.#ensureEdition(id),
      connection:(alias)=>this.#connection(alias),
      captureSummary:summary,validateQueryVersion,
    });
  }
  get directory(){return this.#directory;}
  async initialize() {
    await privateDirectory(this.#directory);
    await withLock(this.#directory,'writer.lock',async()=>{
      if(!await exists(this.#directory,'workspace.json')) {
        await files.replaceJSON(this.#directory,'workspace.json',{
          schema:WORKSPACE_SCHEMA,id:randomUUID(),revision:0,createdAt:now(),sdkVersion:SDK_VERSION,
          queries:{},captures:{},editions:{},exports:{},requests:{},runtimes:{},applications:{},sourceHistory:{},
        });
      }
      stateShape(await files.readJSON(this.#directory,'workspace.json'));
    });
    return this;
  }
  #connection(alias) {
    need(this.#connections.has(alias),'CONNECTION_REQUIRED','Configure the selected private SDK connection on this host.',{alias});
    return this.#connections.get(alias);
  }
  async #state(){return stateShape(await files.readJSON(this.#directory,'workspace.json'));}
  #edit(work) {
    const pending=this.#changes.then(()=>withLock(this.#directory,'writer.lock',async()=>{
      const state=await this.#state(),result=await work(state);
      if(result?.[UNCHANGED])return result.value;
      state.revision+=1;state.updatedAt=now();
      await files.replaceJSON(this.#directory,'workspace.json',state);
      return typeof result==='function'?result(state.revision):result;
    }));
    this.#changes=pending.catch(()=>{});return pending;
  }
  async #intent(action,input,prepare) {
    need(!this.#closed,'WORKSPACE_CLOSED','Reopen the workspace before starting another operation.');
    const request=requestInput(input),id=digest(request.requestId);
    return this.#edit(async state=>{
      if(own(state.requests,id)) {
        const previous=state.requests[id];
        need(previous.action===action&&previous.inputSha256===request.digest,'REQUEST_CONFLICT',
          'This request ID already belongs to different original arguments.',{requestId:request.requestId});
        return unchanged(clone(previous));
      }
      integer(request.expectedRevision,'expectedRevision');
      need(state.revision===request.expectedRevision,'REVISION_CONFLICT','Refresh the workspace before starting this operation.',
        {expected:request.expectedRevision,actual:state.revision});
      const context=await prepare(state,request.args);
      const saved={id,requestId:request.requestId,action,inputSha256:request.digest,args:displayValue(request.args),nativeArgs:encodeValue(request.args),
        context,createdAt:now(),result:null};
      state.requests[id]=saved;return clone(saved);
    });
  }
  async #finish(id,result) {
    return this.#edit(state=>{
      need(own(state.requests,id),'REQUEST_MISSING','The original operation request is missing.');
      const request=state.requests[id];
      if(request.result)return unchanged(clone(request.result));
      request.result={...clone(result),revision:state.revision+1};request.completedAt=now();
      return clone(request.result);
    });
  }
  async describe() {
    const state=await this.#state();
    return {workspaceId:state.id,revision:state.revision,sdkVersion:SDK_VERSION,
      queries:Object.values(state.queries).map(clone),captures:Object.values(state.captures).map(summary),
      editions:Object.values(state.editions).map(clone),exports:Object.values(state.exports).map(clone),
      connections:[...this.#connections.values()].map(publicConnection),methods:clone(METHODS)};
  }
  async querySave(input) {
    const request=await this.#intent('query-save',input,(state,args)=>{
      const selectedConnection=this.#connection(args.connectionAlias),normalized=normalizeQuery(args,selectedConnection);
      const id=randomUUID(),version={...normalized,queryId:id,version:1,createdAt:now()};
      version.sha256=digest(jsonBytes(version));
      const query={id,name:normalized.name,currentVersion:1,versions:[version]};
      state.queries[id]=query;return {query};
    });
    return request.result??this.#finish(request.id,{query:request.context.query});
  }
  async queryConfigure(input) {
    const request=await this.#intent('query-configure',input,(state,args)=>{
      const current=selected(state.queries,args.queryId,'Query'),previous=selectedVersion(state,current.id);
      const selectedConnection=this.#connection(args.connectionAlias??previous.connectionAlias);
      const merged={...previous,...args,args:args.args??decodeValue(previous.nativeArgs),sdkOptions:args.sdkOptions??previous.sdkOptions,
        pagination:args.pagination??previous.pagination};
      const normalized=normalizeQuery(merged,selectedConnection);
      need(normalized.network===previous.network,'QUERY_NETWORK_CHANGED','Create a new saved query for a different Stellar network.');
      const version={...normalized,queryId:current.id,version:current.currentVersion+1,createdAt:now()};
      version.sha256=digest(jsonBytes(version));
      current.name=version.name;current.currentVersion=version.version;current.versions.push(version);
      return {query:clone(current)};
    });
    return request.result??this.#finish(request.id,{query:request.context.query});
  }
  async captureStart(input) {
    const request=await this.#intent('capture-start',input,(state,args)=>{
      const query=clone(selectedVersion(state,args.queryId,args.queryVersion)),selectedConnection=this.#connection(query.connectionAlias);
      need(selectedConnection.network===query.network,'CONNECTION_NETWORK_CHANGED','The native connection must match the selected query network.');
      const id=randomUUID(),at=now();
      const capture={id,sourceWorkspaceId:state.id,queryId:query.queryId,queryVersion:query.version,query,
        frozenArgs:pinArguments(query,at),network:query.network,connectionAlias:selectedConnection.alias,
        connection:publicConnection(selectedConnection),bindings:[{connection:publicConnection(selectedConnection),at}],
        status:'READY',desiredState:'RUNNING',nextPage:query.pagination.startPage??0,rowCount:0,sourceCount:0,
        pages:[],attempts:[],activeAttemptId:null,runtimeId:null,runtimeGeneration:randomUUID(),editionId:null,createdAt:at,updatedAt:at,
        completedAt:null,lastError:null};
      state.captures[id]=capture;return {capture:summary(capture)};
    });
    return request.result??this.#finish(request.id,{capture:request.context.capture});
  }
  async capturePause(input) {
    const request=await this.#intent('capture-pause',input,(state,args)=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      capture.desiredState='PAUSED';
      if(capture.status!=='COMPLETE')capture.status='PAUSED';
      capture.updatedAt=now();return {capture:summary(capture)};
    });
    this.#controllers.get(input.captureId)?.abort(new StellarIndexerError('CAPTURE_PAUSED','The operator paused the native capture.'));
    return request.result??this.#finish(request.id,{capture:request.context.capture});
  }
  async captureResume(input) {
    const request=await this.#intent('capture-resume',input,(state,args)=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      if(capture.status==='COMPLETE')return {capture:summary(capture)};
      const chosen=this.#connection(args.connectionAlias??capture.connectionAlias);
      need(chosen.network===capture.network,'CONNECTION_NETWORK_CHANGED','Continue the original capture on its selected Stellar network.');
      capture.connectionAlias=chosen.alias;capture.connection=publicConnection(chosen);
      capture.bindings.push({connection:publicConnection(chosen),at:now()});
      capture.desiredState='RUNNING';capture.status='READY';capture.lastError=null;capture.updatedAt=now();
      return {capture:summary(capture)};
    });
    return request.result??this.#finish(request.id,{capture:request.context.capture});
  }
  async status({captureId}) {
    const state=await this.#state(),capture=selected(state.captures,captureId,'Capture');
    return {capture:{...clone(capture),pageCount:capture.pages.length,attemptCount:capture.attempts.length},revision:state.revision};
  }
  async edition({editionId}) {
    const state=await this.#state(),edition=selected(state.editions,editionId,'Edition');
    await files.sourceFileRange(this.#directory,edition.file,0,1);
    return {edition:clone(edition),revision:state.revision};
  }
  async #runtime(capture) {
    if(capture.runtimeId) {
      const state=await this.#state();
      need(own(state.runtimes,capture.runtimeId),'SDK_RUNTIME_MISSING','The original capture runtime is missing.');
      const selectedRuntime=state.runtimes[capture.runtimeId];
      return verifyIndexerRuntime({directory:selectedRuntime.directory,expectedManifestSha256:selectedRuntime.manifestSha256});
    }
    const generation=capture.runtimeGeneration??await this.#edit(state=>{
      const current=selected(state.captures,capture.id,'Capture');
      current.runtimeGeneration=current.runtimeGeneration??randomUUID();
      return current.runtimeGeneration;
    });
    identifier(generation);
    const runtime=await retainIndexerRuntime({directory:join(this.#directory,'runtimes',generation),
      installationDirectory:this.#installationDirectory});
    const saved=checkedRuntime(runtime);
    await this.#edit(state=>{
      const current=selected(state.captures,capture.id,'Capture');
      need(current.runtimeGeneration===generation&&(current.runtimeId===null||current.runtimeId===runtime.id),
        'SDK_RUNTIME_CHANGED','The native capture already selected a different runtime generation.');
      if(!own(state.runtimes,runtime.id))state.runtimes[runtime.id]=saved;
      current.runtimeId=runtime.id;
    });
    return runtime;
  }
  async #prepareAttempt(captureId) {
    return this.#edit(state=>{
      const capture=selected(state.captures,captureId,'Capture');
      if(capture.activeAttemptId) {
        const previous=capture.attempts.find(attempt=>attempt.id===capture.activeAttemptId);
        need(previous,'CAPTURE_JOURNAL_CHANGED','The original active native attempt is missing.');
        previous.phase='INTERRUPTED';previous.interruptedAt=now();
      }
      const attempt={id:randomUUID(),number:capture.attempts.length+1,page:capture.nextPage,
        phase:'PREPARED',connection:clone(capture.connection),createdAt:now(),runtimeId:capture.runtimeId,
        directory:null,result:null,error:null};
      attempt.directory='captures/'+capture.id+'/attempts/'+attempt.id;
      capture.attempts.push(attempt);capture.activeAttemptId=attempt.id;capture.status='RUNNING';capture.updatedAt=now();
      return clone(attempt);
    });
  }
  async #commitPage(captureId,attempt,result) {
    need(result.schema==='stellar-forge.stellar-indexer.native-page.v1'&&result.page===attempt.page,
      'NATIVE_RESULT_CHANGED','The retained native result differs from its original page.');
    const resultFile=await descriptor(this.#directory,attempt.directory+'/result.json','application/json');
    const sourceFiles=await collectFiles(join(this.#directory,attempt.directory));
    return this.#edit(state=>{
      const capture=selected(state.captures,captureId,'Capture'),stored=capture.attempts.find(item=>item.id===attempt.id);
      need(stored&&capture.activeAttemptId===attempt.id&&capture.nextPage===attempt.page,
        'CAPTURE_JOURNAL_CHANGED','The original native page selection changed before commit.');
      need(result.method===capture.query.method&&result.runtimeId===capture.runtimeId,
        'NATIVE_RESULT_CHANGED','The native result selected different SDK source or query.');
      integer(result.rowCount,'native row count');integer(result.sourceCount,'native source count');
      need(Array.isArray(result.rows)&&result.rows.length===result.rowCount,'NATIVE_RESULT_CHANGED','The native row count differs.');
      const prior=capture.pages.at(-1),repeated=Boolean(result.sourceCount>0&&prior?.primarySourceSha256&&
        prior.primarySourceSha256===result.primarySourceSha256&&methodFor(capture.query.method).pagination);
      stored.result=resultFile;stored.files=sourceFiles;stored.finishedAt=result.finishedAt;
      capture.activeAttemptId=null;capture.updatedAt=now();
      if(repeated) {
        const error={code:'NATIVE_PAGING_REPEATED',
          message:'The provider repeated an earlier source page. The complete attempt is retained; resume the same page with the selected connection.',
          at:now(),page:result.page};
        stored.phase='FAILED';stored.error=error;
        capture.status='FAILED';capture.lastError=error;
        return {capture:clone(capture),repeated:true,done:false};
      }
      const page={number:capture.pages.length+1,page:result.page,attemptId:attempt.id,rowOffset:capture.rowCount,
        rowCount:result.rowCount,sourceCount:result.sourceCount,result:resultFile,
        primarySourceSha256:result.primarySourceSha256,coverage:clone(result.coverage),completedAt:result.finishedAt};
      capture.pages.push(page);capture.rowCount+=result.rowCount;capture.sourceCount+=result.sourceCount;
      capture.nextPage+=1;
      stored.phase='COMMITTED';stored.error=null;
      const done=capture.query.pagination.mode==='once'||result.sourceExhausted;
      if(done) {
        capture.status='COMPLETE';capture.completedAt=result.finishedAt;capture.desiredState='PAUSED';
        capture.editionId=capture.editionId??randomUUID();
      }else capture.status=capture.desiredState==='PAUSED'?'PAUSED':'READY';
      return {capture:clone(capture),repeated,done};
    });
  }
  async #ensureEdition(captureId) {
    const state=await this.#state(),capture=selected(state.captures,captureId,'Capture');
    if(capture.status!=='COMPLETE')return null;
    if(capture.editionId&&own(state.editions,capture.editionId))return clone(state.editions[capture.editionId]);
    need(capture.editionId,'CAPTURE_JOURNAL_CHANGED','The completed capture is missing its edition identity.');
    const edition={schema:'stellar-forge.stellar-indexer.edition.v1',id:capture.editionId,
      sourceWorkspaceId:capture.sourceWorkspaceId,captureId:capture.id,queryId:capture.queryId,queryVersion:capture.queryVersion,
      method:capture.query.method,network:capture.network,query:clone(capture.query),frozenArgs:clone(capture.frozenArgs),
      runtimeId:capture.runtimeId,rowCount:capture.rowCount,sourceCount:capture.sourceCount,
      pageCount:capture.pages.length,pages:clone(capture.pages),completedAt:capture.completedAt,
      observation:'Native live API pages in their original request order.'};
    const file=await files.writeNew(this.#directory,'editions/'+edition.id+'/edition.json',jsonBytes(edition));
    const saved={...edition,sha256:file.sha256,file};
    await this.#edit(current=>{
      const original=selected(current.captures,captureId,'Capture');
      need(original.editionId===edition.id&&canonical(original.pages)===canonical(capture.pages),
        'CAPTURE_JOURNAL_CHANGED','The original completed capture changed during edition creation.');
      if(own(current.editions,edition.id)) {
        need(current.editions[edition.id].sha256===saved.sha256,'EDITION_CONFLICT','An existing original edition has different bytes.');
        return unchanged(null);
      }
      current.editions[edition.id]=saved;return null;
    });
    return saved;
  }
  captureRun(input) {
    identifier(input?.captureId);
    need(!this.#closed,'WORKSPACE_CLOSED','Reopen the workspace before running a capture.');
    if(this.#running.has(input.captureId))return this.#running.get(input.captureId);
    const promise=this.#run(input).finally(()=>this.#running.delete(input.captureId));
    this.#running.set(input.captureId,promise);return promise;
  }
  async #run({captureId,signal,maxPages}) {
    if(maxPages!==undefined)integer(maxPages,'maxPages',1);
    let release;
    try{release=await files.acquireLock(this.#directory,'capture-'+captureId+'.lock');}
    catch(error){if(error.code==='WORKSPACE_BUSY')throw new StellarIndexerError('CAPTURE_BUSY','This original capture already has a native runner.');throw error;}
    const controller=new AbortController();this.#controllers.set(captureId,controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let timer,runtime,application,count=0;
    try {
      timer=setInterval(()=>{this.#state().then(state=>{
        const capture=selected(state.captures,captureId,'Capture');
        if(capture.desiredState==='PAUSED'&&capture.status!=='COMPLETE')
          controller.abort(new StellarIndexerError('CAPTURE_PAUSED','The operator paused the original capture.'));
      }).catch(error=>controller.abort(error));},500);
      timer.unref?.();
      while(true) {
        let capture=(await this.status({captureId})).capture;
        if(capture.status==='COMPLETE')return {capture:summary(capture),edition:await this.#ensureEdition(captureId),
          revision:(await this.#state()).revision};
        if(capture.desiredState==='PAUSED'||combined.aborted||capture.status==='FAILED')
          return {capture:summary(capture),edition:null,revision:(await this.#state()).revision};
        if(maxPages!==undefined&&count>=maxPages) {
          await this.#edit(state=>{const current=selected(state.captures,captureId,'Capture');
            current.desiredState='PAUSED';current.status='PAUSED';current.updatedAt=now();});
          return {capture:summary((await this.status({captureId})).capture),edition:null,revision:(await this.#state()).revision};
        }
        if(capture.activeAttemptId) {
          const pending=capture.attempts.find(item=>item.id===capture.activeAttemptId);
          need(pending,'CAPTURE_JOURNAL_CHANGED','The original pending attempt is missing.');
          if(await exists(this.#directory,pending.directory+'/result.json')) {
            const result=await files.readJSON(this.#directory,pending.directory+'/result.json');
            await this.#commitPage(captureId,pending,result);count+=1;continue;
          }
        }
        const chosen=this.#connection(capture.connectionAlias);
        need(canonical(publicConnection(chosen))===canonical(capture.connection),'CONNECTION_SELECTION_CHANGED',
          'The selected provider changed. Resume with its explicit same-network alias before continuing.');
        const attempt=await this.#prepareAttempt(captureId);
        await privateDirectory(join(this.#directory,attempt.directory));
        try {
          capture=(await this.status({captureId})).capture;
          application=application??await this.#receiving.retainApplicationSource();
          runtime=runtime??await this.#runtime(capture);
          await this.#edit(state=>{
            const current=selected(state.captures,captureId,'Capture'),stored=current.attempts.find(item=>item.id===attempt.id);
            stored.runtimeId=runtime.id;stored.applicationId=application.id;stored.phase='RUNNING';
          });
          capture=(await this.status({captureId})).capture;
          const result=await invokeNativePage({runtime,capture,page:attempt.page,connection:chosen,
            directory:join(this.#directory,attempt.directory),signal:combined});
          await this.#commitPage(captureId,attempt,result);count+=1;
        }catch(error) {
          const recorded=publicError(error,[chosen.consumerToken]);
          const retained=await collectFiles(join(this.#directory,attempt.directory));
          await this.#edit(state=>{
            const current=selected(state.captures,captureId,'Capture'),stored=current.attempts.find(item=>item.id===attempt.id);
            stored.phase=combined.aborted?'INTERRUPTED':'FAILED';stored.error=recorded;stored.finishedAt=now();stored.files=retained;
            current.activeAttemptId=null;current.lastError=recorded;current.updatedAt=now();
            current.status=combined.aborted?(current.desiredState==='PAUSED'?'PAUSED':'READY'):'FAILED';
          });
          return {capture:summary((await this.status({captureId})).capture),edition:null,revision:(await this.#state()).revision};
        }
      }
    }finally{
      clearInterval(timer);this.#controllers.delete(captureId);await release();
    }
  }
  async rows({captureId,editionId,offset=0,limit=100}={}) {
    integer(offset,'offset');integer(limit,'limit',1,10000);
    need(Boolean(captureId)!==Boolean(editionId),'INVALID_ARGUMENT','Select one capture or edition.');
    const state=await this.#state(),selectedObject=editionId?selected(state.editions,editionId,'Edition'):selected(state.captures,captureId,'Capture');
    const pages=selectedObject.pages,total=selectedObject.rowCount,result=[];
    for(const page of pages) {
      if(page.rowOffset+page.rowCount<=offset||page.rowOffset>=offset+limit)continue;
      await files.sourceFileRange(this.#directory,page.result,0,1);
      const source=await files.readJSON(this.#directory,page.result.path);
      const start=Math.max(0,offset-page.rowOffset),end=Math.min(page.rowCount,offset+limit-page.rowOffset);
      for(let index=start;index<end;index++)result.push({...clone(source.rows[index]),
        index:page.rowOffset+index,page:page.page,attemptId:page.attemptId});
    }
    return {rows:result,total,offset,nextOffset:offset+result.length<total?offset+result.length:null};
  }
  async compare({beforeEditionId,afterEditionId,offset=0,limit=100}={}) {
    integer(offset,'offset');integer(limit,'limit',1,10000);
    const state=await this.#state(),before=selected(state.editions,beforeEditionId,'Edition'),after=selected(state.editions,afterEditionId,'Edition');
    need(before.method===after.method&&before.network===after.network,'EDITION_SELECTION_MISMATCH',
      'Compare original editions from the same SDK method and Stellar network.');
    const collect=async edition=>{
      const map=new Map();
      for(const page of edition.pages) {
        await files.sourceFileRange(this.#directory,page.result,0,1);
        const native=await files.readJSON(this.#directory,page.result.path);
        for(let index=0;index<native.rows.length;index++) {
          const row=native.rows[index],record={...row,index:page.rowOffset+index,page:page.page,attemptId:page.attemptId};
          if(!map.has(row.key))map.set(row.key,[]);map.get(row.key).push(record);
        }
      }return map;
    };
    const left=await collect(before),right=await collect(after),changes=[];
    let identical=0,duplicateKeys=0;
    for(const key of [...new Set([...left.keys(),...right.keys()])].sort()) {
      const a=[...(left.get(key)??[])],b=[...(right.get(key)??[])];
      if(a.length>1||b.length>1)duplicateKeys+=1;
      for(let index=a.length-1;index>=0;index--) {
        const equal=b.findIndex(row=>row.sha256===a[index].sha256);
        if(equal>=0){a.splice(index,1);b.splice(equal,1);identical+=1;}
      }
      if(!a.length&&!b.length)continue;
      changes.push({key,kind:!a.length?'added':!b.length?'removed':'changed',before:a,after:b});
    }
    const tally={added:0,removed:0,changed:0};
    for(const change of changes)tally[change.kind]+=1;
    return {summary:{beforeEditionId,afterEditionId,beforeRows:before.rowCount,afterRows:after.rowCount,
      identicalOccurrences:identical,duplicateKeys,...tally,queryChanged:before.query.sha256!==after.query.sha256,
      beforeQuery:before.query,afterQuery:after.query},changes:changes.slice(offset,offset+limit),total:changes.length,
      offset,nextOffset:offset+limit<changes.length?offset+limit:null};
  }
  sourceExport(input){return this.#receiving.sourceExport(input);}
  sourceReceive(input){return this.#receiving.sourceReceive(input);}
  sourceFile(input){return this.#receiving.sourceFile(input);}
  deliveryExport(input){return this.#receiving.deliveryExport(input);}
  deliveryReceive(input){return this.#receiving.deliveryReceive(input);}
  async close() {
    this.#closed=true;
    for(const controller of this.#controllers.values())
      controller.abort(new StellarIndexerError('HOST_CLOSED','The operator host is closing; the original capture remains resumable.'));
    await Promise.allSettled([...this.#running.values()]);await this.#changes;
  }
}
export async function openStellarIndexerWorkspace(options={}) {
  return new StellarIndexerWorkspace(options).initialize();
}
