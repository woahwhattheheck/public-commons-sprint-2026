// MIT. Complete retained institutional settlement workspace.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  STATE_SCHEMA,SOURCE_SCHEMA,EDITION_SCHEMA,TABLES,files,now,own,plain,clone,digest,canonical,jsonBytes,
  need,integer,text,identifier,selected,hash,privateDirectory,withLock,descriptor,publicError,randomUUID,
  sealed,verified,publicConnection,initialize,readState,recoverState,intent,replay,revision,commitState,
  mutate,retainJSON,readDescriptor,readRecord,html,safeFilename
} from './common.mjs';
import {openSDPSource} from './sdp-native.mjs';
import {openHorizonSource} from './horizon-native.mjs';
import {
  normalizeSettlementPolicy,planSettlement,reconcileSettlement,buildPartnerReport,normalizeProviderRecords
} from './reconciliation.mjs';
export const SETTLEMENT_WORKSPACE_SCHEMA=STATE_SCHEMA;
const LIST_KINDS=new Set(['payments','operations','transactions']);
function versioned(table,id,version){
  const record=selected(table,id),number=version??record.currentVersion;
  integer(number,'version',1);
  const entry=record.versions.find(value=>value.version===number);
  need(entry,'VERSION_NOT_FOUND','Select a retained original version.',{id,version:number});return entry;
}
function unique(values,label){
  need(Array.isArray(values),'INVALID_ARGUMENT','Supply '+label+' as an array.');
  need(new Set(values).size===values.length,'INVALID_ARGUMENT','Select each '+label+' only once.');
  return values;
}
function sourceIdentity(connection){return digest(jsonBytes(connection));}
function numberLedger(value,label){
  if(typeof value==='string'&&/^\d+$/.test(value))value=Number(value);
  return integer(value,label,1,4294967295);
}
function selection(value={}){
  need(plain(value),'INVALID_SELECTION','Supply a ledger selection.');
  return {fromLedger:value.fromLedger==null?null:numberLedger(value.fromLedger,'fromLedger'),
    throughLedger:value.throughLedger==null?null:numberLedger(value.throughLedger,'throughLedger')};
}
function projectOriginal(value,recordsPath){
  if(recordsPath===null)return [value];
  need(typeof recordsPath==='string','INVALID_ARGUMENT','Select the original records path.');
  const keys=recordsPath===''?[]:recordsPath.startsWith('/')?recordsPath.slice(1).split('/').map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~')):recordsPath.split('.');
  let current=value;
  for(const key of keys){
    need(plain(current)&&own(current,key),'RECORDS_PATH_NOT_FOUND','The selected original record array was not found.',{recordsPath});
    current=current[key];
  }
  need(Array.isArray(current),'RECORDS_PATH_NOT_ARRAY','Select an original record array, or null for one original object.');
  return current;
}
function defaultRecordsPath(provider,kind){
  if(provider==='horizon')return LIST_KINDS.has(kind)?'/_embedded/records':null;
  if(['payments','disbursements','disbursementReceivers','receivers'].includes(kind))return '/data';
  if(['assets','wallets','distributionWallets','distributionWalletAudit'].includes(kind))return '';
  return null;
}
function opaqueRequest(request){
  const value=clone(request??{});
  if(plain(value.headers))for(const key of Object.keys(value.headers))if(/authorization|cookie|api[-_]key|token/i.test(key))delete value.headers[key];
  return value;
}
function derivedId(value){
  const hex=digest(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
function errorStatus(error){return {code:String(error?.code??'NATIVE_SOURCE_ERROR'),message:String(error?.message??'The source could not be read.'),details:clone(error?.details??{})};}
function summarizeState(state,connections){
  return {...clone(state),requests:undefined,connections:connections.map(clone),
    counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(state[table]).length]))};
}
async function originalVersion(directory,table,id,version){
  const selectedVersion=versioned(table,id,version);
  return verified(await readRecord(directory,selectedVersion),'Saved version');
}
async function recordsFor(directory,state,sourceIds){
  const records=[];
  for(const sourceId of sourceIds){
    const source=selected(state.sources,sourceId,'Source');
    if(source.projectionFile)records.push(...await readRecord(directory,source.projectionFile));
  }
  return records;
}
async function retainSource(directory,state,{
  id=randomUUID(),captureId=null,provider,kind,network,connection=null,label,
  request={},response={},body,originalBodyFile=null,records,recordsPath=null,sourceScope=null,observedAt=now(),selection:bounds=null,error=null
}){
  need(Buffer.isBuffer(body),'INVALID_SOURCE','Supply the complete original source bytes.');
  const root='sources/'+id,bodyFile=originalBodyFile??await files.writeNew(directory,root+'/original.body',body);
  need(bodyFile.bytes===body.length&&bodyFile.sha256===digest(body),'SOURCE_CHANGED','The original native response differs from its retained bytes.');
  const requestFile=await retainJSON(directory,root+'/request.json',opaqueRequest(request));
  const responseFile=await retainJSON(directory,root+'/response.json',{status:response.status??null,headers:response.headers??{},
    body:bodyFile,observedAt,bodyComplete:response.bodyComplete??true,startedAt:response.startedAt??null,elapsedMs:response.elapsedMs??null,error:error?errorStatus(error):null});
  let projected=[],projectionError=null,excludedCount=0,crossedBoundary=false;
  try{
    if(provider!=='document'&&!error){
      projected=normalizeProviderRecords({provider,kind,records,sourceId:id,captureId,sourceScope:sourceScope??id,observedAt,network});
      need(Array.isArray(projected),'INVALID_NATIVE_PROJECTION','The native projection must retain a record array.');
      if(provider==='horizon'&&LIST_KINDS.has(kind)&&bounds){
        const order=bounds.order??request.filters?.order??request.order??'asc';
        projected=projected.filter(row=>{
          const original=row.original??{},raw=row.projection?.ledger??original.ledger??original.transaction?.ledger;
          const ledger=numberLedger(raw,'original joined transaction ledger');
          if(order==='asc'&&bounds.throughLedger!==null&&ledger>bounds.throughLedger)crossedBoundary=true;
          if(order==='desc'&&bounds.fromLedger!==null&&ledger<bounds.fromLedger)crossedBoundary=true;
          const include=(bounds.fromLedger===null||ledger>=bounds.fromLedger)&&(bounds.throughLedger===null||ledger<=bounds.throughLedger);
          if(!include)excludedCount++;return include;
        });
      }
    }
  }catch(problem){projectionError=errorStatus(problem);projected=[];}
  const projectionFile=await retainJSON(directory,root+'/projection.json',projected);
  const source=sealed({schema:SOURCE_SCHEMA,id,captureId,sourceScope:sourceScope??id,provider,kind,network,connection:clone(connection),label:label??kind,
    observedAt,requestFile,responseFile,bodyFile,projectionFile,recordsPath,
    nativeRecords:Array.isArray(records)?records.length:0,selectedRecords:projected.length,
    selection:bounds?{...clone(bounds),excludedCount,crossedBoundary}:null,error:error?errorStatus(error):projectionError});
  const file=await retainJSON(directory,root+'/source.json',source);
  state.sources[id]={id,captureId,sourceScope:sourceScope??id,provider,kind,network,label:source.label,observedAt,
    bodyFile,projectionFile,file,sha256:source.sha256,nativeRecords:source.nativeRecords,
    selectedRecords:projected.length,selection:source.selection,error:source.error};
  return {source:state.sources[id],projected,crossedBoundary,error:source.error};
}
function defaultBody(name,data){return {name,...clone(data)};}
export async function inspectSettlementWorkspace({directory,allowMissing=false}){
  try{const state=await readState(directory);return summarizeState(state,[]);}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openSettlementWorkspace({directory,connections={},profile={},signal}){
  await initialize(directory,profile);
  const connectionMap=new Map();
  for(const [alias,configuration] of Object.entries(connections)){
    const summary=publicConnection(alias,configuration);
    const native=(summary.provider==='sdp'?openSDPSource(configuration):openHorizonSource(configuration)).describe();
    Object.assign(summary,{sourceScope:native.id,nativeSource:native});
    connectionMap.set(alias,{summary,private:clone(configuration)});
  }
  let closed=false;
  const check=()=>need(!closed,'WORKSPACE_CLOSED','Reopen the settlement workspace.');
  function connection(alias,expected){
    const result=connectionMap.get(alias);
    need(result,'CONNECTION_REQUIRED','Configure the original named private source connection.',{alias});
    if(expected)need(sourceIdentity(result.summary)===sourceIdentity(expected),'CONNECTION_CHANGED',
      'The selected source connection differs from this capture.',{alias});
    return result;
  }
  function sourceAdapter(alias,expected){
    const result=connection(alias,expected),configuration={...result.private,network:result.summary.network};
    return result.summary.provider==='sdp'?openSDPSource(configuration):openHorizonSource(configuration);
  }
  async function describe(){
    check();const state=await readState(directory);
    return summarizeState(state,[...connectionMap.values()].map(value=>value.summary));
  }
  async function sourceCatalog(){
    check();return [...connectionMap.entries()].map(([alias,value])=>({connection:value.summary,catalog:sourceAdapter(alias).describe()}));
  }
  async function profileSave(args){
    check();return mutate(directory,'profile.save',args,async state=>{
      const value=clone(args.profile);need(plain(value),'INVALID_ARGUMENT','Supply the workspace profile.');
      text(value.name,'workspace name');if(value.organization!==undefined)need(typeof value.organization==='string','INVALID_ARGUMENT','Use an organization name.');
      state.profile=value;return {profile:clone(value)};
    });
  }
  async function policySave(args){
    check();return mutate(directory,'policy.save',args,async state=>{
      const id=args.policyId??randomUUID();identifier(id);
      const previous=args.policyId?selected(state.policies,id,'Policy'):null,version=(previous?.currentVersion??0)+1;
      if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected policy version',1),'POLICY_VERSION_CONFLICT','The selected policy advanced after it was opened.',{expectedVersion:args.expectedVersion,currentVersion:previous?.currentVersion});
      const definition=normalizeSettlementPolicy(args.definition),name=text(args.name??definition.name,'policy name');
      const body=sealed({schema:'stellar-forge.settlement-audit.policy.v1',id,version,name,definition,createdAt:now()});
      const file=await retainJSON(directory,'policies/'+id+'/'+version+'.json',body);
      const entry={id,version,name,sha256:body.sha256,file,createdAt:body.createdAt};
      state.policies[id]={id,name,currentVersion:version,versions:[...(previous?.versions??[]),entry]};
      return {policyId:id,version,policy:entry};
    });
  }
  async function policyRead({policyId,version}){
    check();const state=await readState(directory);return originalVersion(directory,state.policies,policyId,version);
  }
  async function batchSave(args){
    check();return mutate(directory,'batch.save',args,async state=>{
      const id=args.batchId??randomUUID();identifier(id);
      const previous=args.batchId?selected(state.batches,id,'Settlement batch'):null,version=(previous?.currentVersion??0)+1;
      if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected batch version',1),'BATCH_VERSION_CONFLICT','The selected settlement advanced after it was opened.',{expectedVersion:args.expectedVersion,currentVersion:previous?.currentVersion});
      const input=clone(args.definition);need(plain(input),'INVALID_ARGUMENT','Supply the complete settlement definition.');
      const policy=await originalVersion(directory,state.policies,input.policyId,input.policyVersion);
      const policyReference={id:policy.id,version:policy.version,sha256:policy.sha256,definition:policy.definition};
      planSettlement({id,policy:policyReference,revenue:input.revenue,participants:input.participants,
        contributions:input.contributions??[],assignments:input.assignments??[]});
      const body=sealed({schema:'stellar-forge.settlement-audit.batch.v1',id,version,name:text(args.name??input.name,'settlement name'),
        definition:{...input,policyId:policy.id,policyVersion:policy.version},createdAt:now()});
      const file=await retainJSON(directory,'batches/'+id+'/'+version+'.json',body);
      const entry={id,version,name:body.name,policyId:policy.id,policyVersion:policy.version,sha256:body.sha256,file,createdAt:body.createdAt};
      state.batches[id]={id,name:body.name,currentVersion:version,versions:[...(previous?.versions??[]),entry]};
      return {batchId:id,version,batch:entry};
    });
  }
  async function batchRead({batchId,version}){
    check();const state=await readState(directory);return originalVersion(directory,state.batches,batchId,version);
  }
  async function sourceImport(args){
    check();return mutate(directory,'source.import',args,async state=>{
      need(['sdp','horizon','document'].includes(args.provider),'INVALID_SOURCE','Select SDP, Horizon or an original document.');
      text(args.kind??'document','source kind',100);text(args.label??args.kind??'Original document','source label');
      need(typeof args.bodyBase64==='string','INVALID_SOURCE','Supply the complete source as base64.');
      const body=Buffer.from(args.bodyBase64,'base64');
      need(body.toString('base64')===args.bodyBase64,'INVALID_SOURCE','Use complete canonical base64.');
      const recordsPath=args.recordsPath===undefined?defaultRecordsPath(args.provider,args.kind):args.recordsPath;
      let records=[],error=null;
      if(args.provider!=='document'){
        try{records=projectOriginal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),recordsPath);}catch(problem){error=errorStatus(problem);}
      }
      const result=await retainSource(directory,state,{provider:args.provider,kind:args.kind??'document',network:args.network??null,
        label:args.label,body,records,recordsPath,sourceScope:args.sourceScope??null,request:args.request??{source:'operator-file',filename:args.filename??null},
        response:{status:args.status??null,headers:{'content-type':args.contentType??'application/json'}},error});
      return {sourceId:result.source.id,source:result.source};
    });
  }
  async function sourceProject(args){
    check();return mutate(directory,'source.project',args,async state=>{
      const original=selected(state.sources,args.sourceId,'Original source');
      const body=await readDescriptor(directory,original.bodyFile);
      const records=projectOriginal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),args.recordsPath);
      const result=await retainSource(directory,state,{provider:args.provider??original.provider,kind:args.kind??original.kind,
        network:args.network??original.network,label:args.label??original.label,body,records,recordsPath:args.recordsPath,sourceScope:args.sourceScope??original.sourceScope,
        request:{source:'original-source-projection',sourceId:original.id,bodySha256:original.bodyFile.sha256},
        observedAt:original.observedAt});
      return {sourceId:result.source.id,originalSourceId:original.id,source:result.source};
    });
  }
  async function sourceRead({sourceId}){
    check();const state=await readState(directory);const source=selected(state.sources,sourceId,'Source');
    return {source:await readRecord(directory,source),records:source.projectionFile?await readRecord(directory,source.projectionFile):[]};
  }
  async function sourceFile({sourceId,part='body',offset=0,length=1024*1024}){
    check();const state=await readState(directory),source=selected(state.sources,sourceId,'Source'),full=await readRecord(directory,source);
    const names={body:'bodyFile',request:'requestFile',response:'responseFile',projection:'projectionFile',manifest:'file'};
    need(own(names,part),'INVALID_ARGUMENT','Select body, request, response, projection or manifest.');
    const item=part==='manifest'?source.file:full[names[part]];
    integer(offset,'offset');integer(length,'length',1,8*1024*1024);
    const body=await readDescriptor(directory,item);
    need(offset<=body.length,'INVALID_RANGE','The source offset exceeds its original length.');
    const fragment=body.subarray(offset,Math.min(body.length,offset+length));
    return {sourceId,part,file:item,offset,bytes:fragment.length,eof:offset+fragment.length===body.length,base64:fragment.toString('base64')};
  }
  async function captureStart(args){
    check();return mutate(directory,'capture.start',args,async state=>{
      const selectedConnection=connection(args.connectionAlias),read=clone(args.read);
      need(plain(read)&&typeof read.kind==='string','INVALID_ARGUMENT','Select an original native read.');
      const id=randomUUID(),bounds=selection(args.selection);
      need(bounds.fromLedger===null||bounds.throughLedger===null||bounds.fromLedger<=bounds.throughLedger,
        'INVALID_SELECTION','The final ledger must include the first ledger.');
      const capture={id,name:text(args.name??read.kind,'capture name'),provider:selectedConnection.summary.provider,
        connection:selectedConnection.summary,connectionAlias:args.connectionAlias,read,
        selection:bounds,status:'READY',createdAt:now(),updatedAt:now(),
        rootObserved:selectedConnection.summary.provider!=='horizon',rootSourceId:null,
        nextRead:read,sources:[],attempts:[],inflight:null,run:null,lastError:null};
      state.captures[id]=capture;return {captureId:id,capture:clone(capture)};
    });
  }
  async function captureNext(args){
    check();identifier(args.captureId);
    return withLock(directory,'capture-'+args.captureId+'.lock',async()=>{
      const begun=await withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);
        if(prior)return {completed:prior};
        let capture=selected(before.captures,args.captureId,'Capture');
        if(capture.inflight){
          need(capture.inflight.args.requestId===args.requestId&&capture.inflight.intentSha256===intent('capture.next',args).intentSha256,
            'CAPTURE_INFLIGHT','Continue the original capture request.',{originalArguments:capture.inflight.args});
        }else{
          revision(before,args);
          need(['READY','RUNNING'].includes(capture.status),'CAPTURE_STATE','Resume a paused or failed capture before reading its next page.',{status:capture.status});
          const next=clone(before),working=next.captures[capture.id],attemptId=randomUUID();
          working.inflight={attemptId,args:clone(args),intentSha256:intent('capture.next',args).intentSha256,
            read:clone(working.rootObserved?working.nextRead:{kind:'root'}),startedAt:now(),rootObservation:!working.rootObserved};
          working.status='RUNNING';working.updatedAt=now();
          await commitState(directory,before,next,'capture.next.begin',args,{captureId:capture.id,attemptId},{recordRequest:false});
          capture=next.captures[capture.id];
        }
        return {capture:clone(capture),pending:clone(capture.inflight)};
      });
      if(begun.completed)return begun.completed;
      const {capture,pending}=begun,path='captures/'+capture.id+'/attempts/'+pending.attemptId;
      let saved;
      try{saved=await files.readJSON(directory,path+'/native-result.json');}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        let orphan=null;
        try{orphan=await descriptor(directory,path+'/response.body');}catch(problem){if(problem.code!=='ENOENT')throw problem;}
        if(orphan){
          // A process stopped after preserving the original bytes and before
          // acknowledging their HTTP metadata. Keep this attempt as observed;
          // its continuation gets a new attempt and never overwrites the body.
          saved={request:opaqueRequest(pending.read),response:{status:null,headers:{},bodyFile:orphan,bodyComplete:false,
              startedAt:pending.startedAt,observedAt:pending.startedAt,elapsedMs:null},
            recordsPath:defaultRecordsPath(capture.provider,pending.read.kind),continuation:{done:false,next:pending.read},
            error:{code:'NATIVE_ATTEMPT_RECOVERED',message:'The original response bytes survived an interrupted capture before its HTTP metadata was committed. The same original read continues in a new attempt.',details:{}},
            receivedAt:pending.startedAt};
        }else{
          let result;
          try{result=await sourceAdapter(capture.connectionAlias,capture.connection).read({...pending.read,signal});}
          catch(problem){
            result={request:pending.read,response:{status:null,headers:{},body:Buffer.alloc(0),bodyComplete:false},value:null,records:[],
              continuation:{done:false,next:pending.read},error:publicError(problem,[connectionMap.get(capture.connectionAlias)?.private?.apiKey,
                connectionMap.get(capture.connectionAlias)?.private?.token,connectionMap.get(capture.connectionAlias)?.private?.bearerToken])};
          }
          need(Buffer.isBuffer(result.response?.body),'INVALID_NATIVE_SOURCE','The native adapter must return its original response bytes.');
          const bodyFile=await files.writeNew(directory,path+'/response.body',result.response.body);
          saved={request:opaqueRequest(result.request),response:{status:result.response.status,headers:result.response.headers,bodyFile,bodyComplete:result.response.bodyComplete,
              startedAt:result.response.startedAt??null,observedAt:result.response.observedAt??null,elapsedMs:result.response.elapsedMs??null},
            recordsPath:defaultRecordsPath(capture.provider,pending.read.kind),continuation:result.continuation,error:result.error??null,receivedAt:now()};
        }
        await retainJSON(directory,path+'/native-result.json',saved);
      }
      return withLock(directory,'writer.lock',async()=>{
        await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);
        if(prior)return prior;
        const next=clone(before),working=selected(next.captures,capture.id,'Capture');
        need(working.inflight?.attemptId===pending.attemptId&&working.inflight.intentSha256===pending.intentSha256,
          'CAPTURE_INFLIGHT_CHANGED','The original capture intent changed while its source was being read.');
        const paused=working.status==='PAUSED',body=await readDescriptor(directory,saved.response.bodyFile);
        let nativeError=saved.error,parsedValue=null,originalRecords=[];
        if(!nativeError){try{parsedValue=JSON.parse(body.toString('utf8'));originalRecords=projectOriginal(parsedValue,saved.recordsPath);}
          catch(problem){nativeError=errorStatus(problem);}}
        if(!nativeError&&!pending.rootObservation&&working.sources.some(id=>next.sources[id]?.kind===pending.read.kind&&
          next.sources[id]?.bodyFile.sha256===saved.response.bodyFile.sha256&&originalRecords.length>0))
          nativeError={code:'REPEATED_NATIVE_PAGE',message:'The original provider repeated a nonempty page.',details:{bodySha256:saved.response.bodyFile.sha256}};
        if(!nativeError&&!pending.rootObservation&&!saved.continuation?.done&&working.attempts.some(item=>canonical(item.read)===canonical(saved.continuation.next)))
          nativeError={code:'CYCLIC_NATIVE_CURSOR',message:'The original provider returned a previously captured continuation.',details:{next:saved.continuation.next}};
        if(pending.rootObservation&&!nativeError){
          try{
            const latest=numberLedger(parsedValue?.history_latest_ledger,'Horizon history_latest_ledger');
            const elder=integer(parsedValue?.history_elder_ledger,'Horizon history_elder_ledger',0,4294967295);
            if(working.selection.throughLedger===null)working.selection.throughLedger=latest;
            need(working.selection.throughLedger<=latest,'LEDGER_NOT_AVAILABLE','The selected final ledger is newer than the original Horizon history.',{latest});
            need(working.selection.fromLedger===null||working.selection.fromLedger>=elder,
              'HISTORY_RANGE_UNAVAILABLE','The selected first ledger precedes this Horizon service’s original retained history.',{requestedFirstLedger:working.selection.fromLedger,oldestAvailableLedger:elder});
            need(working.selection.fromLedger===null||working.selection.fromLedger<=working.selection.throughLedger,
              'INVALID_SELECTION','The selected first ledger follows the retained Horizon boundary.');
            working.rootObserved=true;working.snapshotLedger=latest;working.oldestAvailableLedger=elder;
          }catch(error){nativeError=errorStatus(error);}
        }
        const retained=await retainSource(directory,next,{id:pending.attemptId,captureId:capture.id,provider:capture.provider,
          kind:pending.read.kind,network:capture.connection.network,connection:capture.connection,label:capture.name,
          request:saved.request,response:saved.response,body,sourceScope:capture.connection.sourceScope,originalBodyFile:saved.response.bodyFile,records:originalRecords,
          observedAt:saved.response.observedAt??saved.receivedAt,selection:pending.rootObservation?null:{...working.selection,order:pending.read.filters?.order??'asc'},error:nativeError});
        nativeError=retained.error;
        const attempt={id:pending.attemptId,requestId:pending.args.requestId,startedAt:pending.startedAt,
          receivedAt:saved.receivedAt,finishedAt:now(),sourceId:retained.source.id,
          read:pending.read,responseStatus:saved.response.status,error:nativeError};
        working.attempts.push(attempt);working.sources.push(retained.source.id);
        if(nativeError?.code==='NATIVE_ATTEMPT_RECOVERED'){working.status='READY';working.lastError=nativeError;}
        else if(pending.rootObservation&&!nativeError){working.rootSourceId=retained.source.id;working.status='READY';}
        else if(nativeError){working.status='FAILED';working.lastError=nativeError;}
        else if(saved.continuation?.done||retained.crossedBoundary){working.status='COMPLETE';working.nextRead=null;working.completedAt=now();working.lastError=null;}
        else{
          need(plain(saved.continuation?.next),'INVALID_NATIVE_CONTINUATION','The original source did not return its next request.');
          working.nextRead=clone(saved.continuation.next);working.status='READY';working.lastError=null;
        }
        if(paused&&working.status!=='COMPLETE')working.status='PAUSED';
        working.inflight=null;working.updatedAt=now();
        return commitState(directory,before,next,'capture.next',args,{captureId:capture.id,status:working.status,
          sourceId:retained.source.id,source:retained.source,attempt,error:nativeError});
      });
    });
  }
  async function capturePause(args){
    check();return mutate(directory,'capture.pause',args,async state=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      if(capture.status!=='COMPLETE')capture.status='PAUSED';
      capture.updatedAt=now();return {captureId:capture.id,status:capture.status,originalRun:capture.run?.args??null};
    });
  }
  async function captureResume(args){
    check();return mutate(directory,'capture.resume',args,async state=>{
      const capture=selected(state.captures,args.captureId,'Capture');
      if(capture.status!=='COMPLETE'){connection(capture.connectionAlias,capture.connection);capture.status=capture.inflight?'RUNNING':'READY';capture.lastError=null;}
      capture.updatedAt=now();return {captureId:capture.id,status:capture.status,originalRun:capture.run?.args??null};
    });
  }
  async function captureRun(args){
    check();
    const start=await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory);
      const prior=replay(before,'capture.run',args);if(prior)return {completed:prior};
      const capture=selected(before.captures,args.captureId,'Capture');
      if(capture.run){
        need(capture.run.args.requestId===args.requestId&&capture.run.intentSha256===intent('capture.run',args).intentSha256,
          'CAPTURE_RUN_ACTIVE','Continue the original complete capture run.',{originalArguments:capture.run.args});
        return {};
      }
      revision(before,args);const next=clone(before);
      next.captures[capture.id].run={args:clone(args),intentSha256:intent('capture.run',args).intentSha256,startedAt:now()};
      await commitState(directory,before,next,'capture.run.begin',args,{captureId:capture.id},{recordRequest:false});return {};
    });
    if(start.completed)return start.completed;
    for(;;){
      check();const state=await readState(directory),capture=selected(state.captures,args.captureId,'Capture');
      if(signal?.aborted&&['READY','RUNNING'].includes(capture.status)){
        try{return await capturePause({captureId:capture.id,requestId:derivedId(args.requestId+':operator-drain:'+state.revision),expectedRevision:state.revision});}
        catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
      }
      if(capture.status==='COMPLETE'){
        return withLock(directory,'writer.lock',async()=>{
          await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.run',args);if(prior)return prior;
          const next=clone(before),current=selected(next.captures,args.captureId,'Capture');
          need(current.status==='COMPLETE','CAPTURE_STATE','The original capture state changed.');
          current.run={...current.run,finishedAt:now()};
          return commitState(directory,before,next,'capture.run',args,{captureId:current.id,status:current.status,
            sources:clone(current.sources),attempts:current.attempts.length,completedAt:current.completedAt});
        });
      }
      if(['PAUSED','FAILED'].includes(capture.status))return {workspaceId:state.workspaceId,revision:state.revision,
        requestId:args.requestId,captureId:capture.id,status:capture.status,error:capture.lastError,originalArguments:capture.run.args};
      const nextArgs=capture.inflight?.args??{captureId:capture.id,requestId:derivedId(args.requestId+':'+String(capture.attempts.length)),
        expectedRevision:state.revision};
      try{await captureNext(nextArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
    }
  }
  async function planCreate(args){
    check();return mutate(directory,'plan.create',args,async state=>{
      const batch=await originalVersion(directory,state.batches,args.batchId,args.batchVersion);
      const policy=await originalVersion(directory,state.policies,batch.definition.policyId,batch.definition.policyVersion);
      const id=randomUUID(),input=batch.definition;
      const data=planSettlement({id,policy:{id:policy.id,version:policy.version,sha256:policy.sha256,definition:policy.definition},
        revenue:input.revenue,participants:input.participants,contributions:input.contributions??[],assignments:input.assignments??[]});
      const body=sealed({schema:EDITION_SCHEMA,kind:'plan',id,name:args.name??batch.name,createdAt:now(),
        batchId:batch.id,batchVersion:batch.version,policyId:policy.id,policyVersion:policy.version,
        sourceVersions:{batchSha256:batch.sha256,policySha256:policy.sha256},data});
      const file=await retainJSON(directory,'plans/'+id+'/plan.json',body);
      state.plans[id]={id,name:body.name,batchId:batch.id,batchVersion:batch.version,createdAt:body.createdAt,
        policyId:policy.id,policyVersion:policy.version,sha256:body.sha256,file,totals:clone(data.totals)};
      return {planId:id,plan:state.plans[id]};
    });
  }
  async function correctionAdd(args){
    check();return mutate(directory,'correction.add',args,async state=>{
      const plan=selected(state.plans,args.planId,'Plan'),correction=clone(args.correction);
      need(plain(correction)&&['assign','exclude','note'].includes(correction.kind),'INVALID_CORRECTION','Select assign, exclude or note.');
      text(correction.reason,'correction reason',4000);
      const id=randomUUID(),body=sealed({...correction,schema:'stellar-forge.settlement-audit.correction.v1',
        id,planId:plan.id,createdAt:now()});
      const file=await retainJSON(directory,'corrections/'+id+'.json',body);
      state.corrections[id]={id,planId:plan.id,kind:body.kind,reason:body.reason,createdAt:body.createdAt,sha256:body.sha256,file};
      return {correctionId:id,correction:state.corrections[id]};
    });
  }
  async function reconcileCreate(args){
    check();return mutate(directory,'reconciliation.create',args,async state=>{
      const planEntry=selected(state.plans,args.planId,'Plan'),plan=verified(await readRecord(directory,planEntry));
      const sourceIds=unique(args.sourceIds??Object.keys(state.sources).filter(id=>['sdp','horizon'].includes(state.sources[id].provider)),'source identifiers');
      const correctionIds=unique(args.correctionIds??Object.keys(state.corrections).filter(id=>state.corrections[id].planId===plan.id),'correction identifiers');
      const corrections=[];
      for(const id of correctionIds){
        const entry=selected(state.corrections,id,'Correction');need(entry.planId===plan.id,'CORRECTION_PLAN_MISMATCH','Select corrections for this plan.');
        corrections.push(verified(await readRecord(directory,entry)));
      }
      const records=await recordsFor(directory,state,sourceIds),id=randomUUID();
      const observedAt=args.asOf??now();
      const data=reconcileSettlement({plan:plan.data,records,assignments:args.assignments??[],corrections,asOf:observedAt});
      const body=sealed({schema:EDITION_SCHEMA,kind:'reconciliation',id,name:args.name??plan.name,createdAt:now(),
        planId:plan.id,planSha256:plan.sha256,sourceIds,correctionIds,assignments:clone(args.assignments??[]),
        coverage:sourceIds.map(sourceId=>{const source=state.sources[sourceId];return {sourceId,provider:source.provider,kind:source.kind,
          captureId:source.captureId,captureStatus:source.captureId?state.captures[source.captureId]?.status:null,
          observedAt:source.observedAt,selectedRecords:source.selectedRecords,error:source.error,sha256:source.sha256};}),data});
      const file=await retainJSON(directory,'reconciliations/'+id+'/reconciliation.json',body);
      state.reconciliations[id]={id,name:body.name,planId:plan.id,createdAt:body.createdAt,sha256:body.sha256,file,
        sourceIds,correctionIds,summary:clone(data.summary)};
      return {reconciliationId:id,reconciliation:state.reconciliations[id]};
    });
  }
  async function editionRead({kind,id}){
    check();const tables={plan:'plans',reconciliation:'reconciliations',report:'reports',correction:'corrections'};
    need(own(tables,kind),'INVALID_ARGUMENT','Select a plan, reconciliation, report or correction.');
    const state=await readState(directory);return verified(await readRecord(directory,selected(state[tables[kind]],id,'Edition')));
  }
  async function compare({leftId,rightId}){
    check();const state=await readState(directory);
    const left=verified(await readRecord(directory,selected(state.reconciliations,leftId,'First reconciliation')));
    const right=verified(await readRecord(directory,selected(state.reconciliations,rightId,'Following reconciliation')));
    const key=item=>item.comparisonKey??canonical([item.phase,item.role,item.participantId??null]);
    const l=new Map(left.data.legs.map(item=>[key(item),item])),r=new Map(right.data.legs.map(item=>[key(item),item]));
    const legs=[];
    for(const id of new Set([...l.keys(),...r.keys()])){
      const before=l.get(id)??null,after=r.get(id)??null;
      if(canonical(before)!==canonical(after))legs.push({comparisonKey:id,before,after,change:!before?'ADDED':!after?'REMOVED':'CHANGED'});
    }
    return {left:{id:left.id,planId:left.planId,sha256:left.sha256,createdAt:left.createdAt},
      right:{id:right.id,planId:right.planId,sha256:right.sha256,createdAt:right.createdAt},
      samePlan:left.planId===right.planId,summary:{left:left.data.summary,right:right.data.summary},
      legs,sourceChanges:{added:right.sourceIds.filter(id=>!left.sourceIds.includes(id)),removed:left.sourceIds.filter(id=>!right.sourceIds.includes(id))},
      correctionChanges:{added:right.correctionIds.filter(id=>!left.correctionIds.includes(id)),removed:left.correctionIds.filter(id=>!right.correctionIds.includes(id))}};
  }
  async function reportCreate(args){
    check();return mutate(directory,'report.create',args,async state=>{
      const reconciliation=verified(await readRecord(directory,selected(state.reconciliations,args.reconciliationId,'Reconciliation')));
      const plan=verified(await readRecord(directory,selected(state.plans,reconciliation.planId,'Plan')));
      const id=randomUUID(),root='reports/'+id;
      const jsonReport=buildPartnerReport({plan:plan.data,reconciliation:reconciliation.data,partnerId:args.partnerId,format:'json'});
      const csvReport=buildPartnerReport({plan:plan.data,reconciliation:reconciliation.data,partnerId:args.partnerId,format:'csv'});
      const content=[];
      for(const report of [jsonReport,csvReport]){
        need(Buffer.isBuffer(report.content),'INVALID_REPORT','The native report must provide its complete content bytes.');
        safeFilename(report.filename);
        const file=await files.writeNew(directory,root+'/'+report.filename,report.content);
        content.push({...file,filename:report.filename,contentType:report.contentType});
      }
      const reportData=jsonReport.data??JSON.parse(jsonReport.content.toString('utf8'));
      const page=reportHTML({name:args.name??plan.name,partnerId:args.partnerId,createdAt:now(),data:reportData,
        planId:plan.id,reconciliationId:reconciliation.id,sourceCount:reconciliation.sourceIds.length});
      const htmlFile=await files.writeNew(directory,root+'/settlement-report.html',Buffer.from(page,'utf8'));
      content.push({...htmlFile,filename:'settlement-report.html',contentType:'text/html; charset=utf-8'});
      const body=sealed({schema:EDITION_SCHEMA,kind:'report',id,name:args.name??plan.name,createdAt:now(),partnerId:args.partnerId??null,
        planId:plan.id,reconciliationId:reconciliation.id,planSha256:plan.sha256,reconciliationSha256:reconciliation.sha256,
        files:content,data:reportData});
      const file=await retainJSON(directory,root+'/report.json',body);
      state.reports[id]={id,name:body.name,partnerId:body.partnerId,planId:plan.id,reconciliationId:reconciliation.id,
        createdAt:body.createdAt,sha256:body.sha256,file,files:content};
      return {reportId:id,report:state.reports[id]};
    });
  }
  async function reportFile({reportId,filename}){
    check();const state=await readState(directory),report=selected(state.reports,reportId,'Report');
    const item=report.files.find(file=>file.filename===filename);
    need(item,'NOT_FOUND','Select a retained report file.');
    return {file:item,body:await readDescriptor(directory,item)};
  }
  async function close(){closed=true;}
  return {directory,describe,sourceCatalog,profileSave,policySave,policyRead,batchSave,batchRead,
    sourceImport,sourceProject,sourceRead,sourceFile,captureStart,captureNext,capturePause,captureResume,captureRun,
    planCreate,correctionAdd,reconcileCreate,editionRead,compare,reportCreate,reportFile,close};
}
export function reportHTML({name,partnerId,createdAt,data,planId,reconciliationId,sourceCount}){
  const legs=Array.isArray(data.legs)?data.legs:Array.isArray(data.reconciliation?.legs)?data.reconciliation.legs:[];
  const exceptions=Array.isArray(data.exceptions)?data.exceptions:Array.isArray(data.reconciliation?.exceptions)?data.reconciliation.exceptions:[];
  const summary=data.summary??data.reconciliation?.summary??{};
  const rows=legs.map(leg=>'<tr><td>'+html(leg.phase)+'</td><td>'+html(leg.role)+'</td><td>'+html(leg.participantId??leg.toAccount)+'</td><td class="number">'+html(leg.amount)+'</td><td>'+html(leg.status??'')+'</td><td>'+html((leg.matches??[]).map(item=>item.transactionHash??item.recordId??item.id??'').join('; '))+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+html(name)+'</title><style>'+
    ':root{font-family:Arial,Helvetica,sans-serif;color:#1b1b1b;background:#fff}body{max-width:1180px;margin:40px auto;padding:0 24px;line-height:1.45}h1{font-size:27px;margin-bottom:6px}h2{font-size:18px;margin-top:32px}.meta{color:#555;font-size:13px}.summary{border:1px solid #aaa;padding:16px;white-space:pre-wrap;font:13px ui-monospace,monospace}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:9px 7px;overflow-wrap:anywhere}th{background:#eee}.number{text-align:right;font-variant-numeric:tabular-nums}details{margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}footer{margin-top:32px;border-top:1px solid #aaa;padding-top:12px;font-size:12px;color:#555}@media print{body{max-width:none;margin:0;padding:0}details{display:none}thead{display:table-header-group}tr{break-inside:avoid}}'+
    '</style><main><h1>'+html(name)+'</h1><p class="meta">'+html(partnerId?'Partner '+partnerId:'Settlement programme')+' · '+html(createdAt)+
    '</p><h2>Settlement position</h2><div class="summary">'+html(JSON.stringify(summary,null,2))+'</div>'+
    '<h2>Revenue distribution and driver payouts</h2><table><thead><tr><th>Stage</th><th>Role</th><th>Recipient</th><th class="number">Amount</th><th>Status</th><th>Original payment reference</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<h2>Exceptions and corrections</h2>'+(exceptions.length?'<pre>'+html(JSON.stringify(exceptions,null,2))+'</pre>':'<p>No exceptions in this retained report edition.</p>')+
    '<details><summary>Complete report data</summary><pre>'+html(JSON.stringify(data,null,2))+'</pre></details>'+
    '<footer>Plan '+html(planId)+' · Reconciliation '+html(reconciliationId)+' · '+html(sourceCount)+' retained source responses. Amounts use the asset’s exact decimal units.</footer></main></html>';
}
