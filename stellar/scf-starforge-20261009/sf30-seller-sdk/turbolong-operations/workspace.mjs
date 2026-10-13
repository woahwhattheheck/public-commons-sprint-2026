// MIT. Complete operating periods, original acquisitions, incidents and correction history.
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 files,now,own,plain,clone,digest,canonical,jsonBytes,need,integer,text,identifier,hash,
 privateDirectory,withLock,descriptor,copyDescriptor,publicError,randomUUID,sealed,verified,
 SOURCE_SCHEMA,EDITION_SCHEMA,TABLES,readState,recoverState,initialize,intent,replay,revision,commitState,mutate,
 readDescriptor,readRecord,retainJSON,publicPayload,publicRuntimePin,safeFilename,isoTime,TERMINAL_OPERATIONS
} from './common.mjs';
import {openTurbolongConnection} from './native.mjs';
import {TURBOLONG_ACTIONS,getTurbolongAction,validateTurbolongArguments} from './catalogue.mjs';
import {validateTurbolongPeriod,analyseTurbolongPeriod,renderTurbolongReport} from './period-analysis.mjs';

const PAGE_MAX=1000;
const INCIDENT_STATES=new Set(['OPEN','TRIAGED','INVESTIGATING','MITIGATED','RESOLVED']);
const CORRECTION_STATES=new Set(['PROPOSED','IN_PROGRESS','AWAITING_OUTCOME','IMPLEMENTED','VERIFIED','REJECTED']);
const FINAL_ACQUISITIONS=new Set(['COMPLETE','CANCELED']);
function copy(value){return clone(value);}
function argumentsBody(args){const value=copy(args);delete value.requestId;delete value.expectedRevision;return value;}
function argumentHash(args){return digest(jsonBytes(argumentsBody(args)));}
function ordered(rows){return Object.values(rows).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||String(a.id??a.exportId).localeCompare(String(b.id??b.exportId)));}
function requireRow(state,table,id){const row=state[table][identifier(id)];need(row,'NOT_FOUND','The selected '+table+' record is absent.',{id});return row;}
function versionAt(row,number){number=number??row.currentVersion;integer(number,'version',1);
 const version=row.versions.find(item=>item.version===number);need(version,'VERSION_NOT_FOUND','The selected saved version is absent.');return version;}
function periodAt(state,id,version){const row=requireRow(state,'periods',id);return {row,version:versionAt(row,version)};}
function vaultAt(state,id,version){const row=requireRow(state,'vaults',id);return {row,version:versionAt(row,version)};}
function scopeFor(state,args){
 const period=args.periodId?periodAt(state,args.periodId,args.periodVersion):null;
 const vault=args.vaultId?vaultAt(state,args.vaultId,args.vaultVersion):null;
 const network=period?.version.definition.network??vault?.version.definition.network??args.network??null;
 need(!period||!vault||period.version.definition.network===vault.version.definition.network,'NETWORK_MISMATCH','The period and vault use different networks.');
 return {periodId:period?.row.id??null,periodVersion:period?.version.version??null,periodSha256:period?.version.sha256??null,
  period:period?copy(period.version.definition):null,vaultId:vault?.row.id??null,vaultVersion:vault?.version.version??null,
  vaultSha256:vault?.version.sha256??null,vault:vault?copy(vault.version.definition):null,network};
}
function versionedInput(value,label){need(plain(value),'INVALID_ARGUMENT','Supply the complete '+label+' definition.');return copy(publicPayload(value));}
function namedProfile(value){const profile=versionedInput(value,'workspace profile');if(profile.name!==undefined)text(profile.name,'workspace name',256);return profile;}
function runtimeFrom(...items){for(const item of items){if(item?.id&&item?.manifestSha256&&item?.version)return publicRuntimePin(item);}return null;}
function sourceArguments(action,input,scope){
 const args=versionedInput(input??{},'native action');
 const definition=getTurbolongAction(action),properties=definition.inputSchema.properties??{};
 if(scope.network){if(args.network!==undefined)need(args.network===scope.network,'NETWORK_MISMATCH','The native action must retain the selected period network.');
  if(own(properties,'network')||definition.inputSchema.additionalProperties===true)args.network=scope.network;}
 if(scope.period)for(const key of ['startsAt','endsAt'])if(own(properties,key)){
  if(args[key]!==undefined)need(isoTime(args[key],key)===scope.period[key],'PERIOD_SCOPE_CHANGED','The native action must use the selected complete period bounds.');
  args[key]=scope.period[key];}
 validateTurbolongArguments(action,args);return args;
}
function nativeRequestScope(request,row){
 need(plain(request)&&request.action===row.action,'NATIVE_REQUEST_CHANGED','The prepared native action differs.');
 need(request.connection?.network===undefined||!row.network||request.connection.network===row.network,'NETWORK_MISMATCH','The attached connection belongs to another network.');
 need(request.args?.network===undefined||!row.network||request.args.network===row.network,'NETWORK_MISMATCH','The native request changed its selected network.');
 for(const key of ['startsAt','endsAt'])if(row.scope.period&&request.args?.[key]!==undefined)
  need(isoTime(request.args[key],key)===row.scope.period[key],'PERIOD_SCOPE_CHANGED','The prepared native request changed its frozen period.');
 publicPayload(request);return request;
}
function readOnlyAction(definition,args){return definition.readOnly===true&&definition.mutates!==true&&
 !(definition.conditionalMutations??[]).some(item=>args[item.argument]===item.equals);}
function terminalPage(row){return ['COMPLETED','PARTIAL'].includes(row.state)&&!row.nextRequest&&!row.continuationError&&row.pagination?.complete!==false;}
function observationBytes(part){
 if(part?.bodyBase64===undefined)return null;
 need(typeof part.bodyBase64==='string','INVALID_NATIVE_SOURCE','Native response bytes require base64.');
 const bytes=Buffer.from(part.bodyBase64,'base64');
 need(bytes.toString('base64')===part.bodyBase64,'INVALID_NATIVE_SOURCE','Native response bytes have a noncanonical encoding.');
 if(part.bytes!==undefined)need(part.bytes===bytes.length,'NATIVE_SOURCE_CHANGED','Native response size differs.');
 if(part.sha256!==undefined)need(part.sha256===digest(bytes),'NATIVE_SOURCE_CHANGED','Native response digest differs.');
 return bytes;
}
async function retainNativeBody(directory,path,part){
 if(part?.bodyBase64!==undefined)return files.writeNew(directory,path,observationBytes(part));
 if(!Array.isArray(part?.chunks))return null;
 integer(part.bytes,'native artifact bytes',0);hash(part.sha256);
 try{const existing=await descriptor(directory,path);need(existing.bytes===part.bytes&&existing.sha256===part.sha256,'NATIVE_SOURCE_CHANGED','The retained artifact differs.');return existing;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const target=await files.filePath(directory,path,true),temporary=target+'.pending-'+randomUUID(),fd=await fs.open(temporary,'wx',0o600),sum=createHash('sha256');
 let offset=0;
 try{
  for(const chunk of part.chunks){
   need(chunk.offset===offset,'NATIVE_SOURCE_CHANGED','The original artifact chunks are not contiguous.');
   const bytes=observationBytes(chunk);need(bytes,'INVALID_NATIVE_SOURCE','Each original artifact chunk needs bytes.');
   await fd.writeFile(bytes);sum.update(bytes);offset+=bytes.length;need(offset<=part.bytes,'NATIVE_SOURCE_CHANGED','The artifact exceeds its original size.');
  }
  need(offset===part.bytes&&sum.digest('hex')===part.sha256,'NATIVE_SOURCE_CHANGED','The complete artifact differs from its original hash.');
  await fd.sync();await fd.close();
  try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;
   const present=await descriptor(directory,path);need(present.bytes===part.bytes&&present.sha256===part.sha256,'NATIVE_SOURCE_CHANGED','Another artifact occupies this source path.');}
  const parent=await fs.open(dirname(target),'r');try{await parent.sync();}finally{await parent.close();}
  return {path,bytes:part.bytes,sha256:part.sha256,mode:0o600,contentType:'application/octet-stream'};
 }finally{await fd.close().catch(()=>{});await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function scopeFields(row){return {periodId:row.periodId??null,periodVersion:row.periodVersion??null,
 periodSha256:row.periodSha256??null,vaultId:row.vaultId??null,vaultVersion:row.vaultVersion??null,vaultSha256:row.vaultSha256??null,network:row.network??null};}
function planQueries(definition,scope){
 need(Array.isArray(definition.queries)&&definition.queries.length>0,'INVALID_ACQUISITION','Add at least one complete original query.');
 return definition.queries.map((query,index)=>{
  need(plain(query),'INVALID_ACQUISITION','Each query must retain its connection, action and native arguments.');
  const connection=text(query.connection,'query connection',160),action=text(query.action,'native action',160);
  const args=sourceArguments(action,query.args??{},scope),catalogue=getTurbolongAction(action);
  need(readOnlyAction(catalogue,args),'READ_ONLY_ACQUISITION_REQUIRED','Scheduled acquisition accepts native reads; prepare and run corrective writes explicitly.',{action,index});
  if(query.maxPages!==undefined&&query.maxPages!==null)integer(query.maxPages,'maxPages',1);
  return {...copy(query),name:query.name??catalogue.title,connection,action,args,...(query.maxPages===undefined?{}:{maxPages:query.maxPages})};
 });
}
export async function inspectTurbolongOperationsWorkspace({directory,allowMissing=false}){
 try{const state=await readState(resolve(directory));return {...state,counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(state[table]).length]))};}
 catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openTurbolongOperationsWorkspace({directory,connections={},profile={},runtimeSelections=[]}={}){
 need(typeof directory==='string'&&directory.length>0,'WORKSPACE_REQUIRED','Select the operations workspace directory.');
 directory=resolve(directory);await initialize(directory,namedProfile(profile));need(plain(connections),'INVALID_CONNECTION','Supply the named private connection map.');
 const services=new Map(),running=new Set();let closed=false;
 async function service(name){
  text(name,'private connection alias',160);need(own(connections,name),'CONNECTION_NOT_FOUND','Attach the selected private connection.',{connection:name});
  if(!services.has(name)){const promised=Promise.resolve(openTurbolongConnection({connection:connections[name]})).catch(error=>{services.delete(name);throw error;});services.set(name,promised);}
  return services.get(name);
 }
 async function state(){need(!closed,'WORKSPACE_CLOSED','The operations workspace is closed.');
  return withLock(directory,'writer.lock',async()=>{await recoverState(directory);return readState(directory);});}
 async function tracked(work){running.add(work);try{return await work;}finally{running.delete(work);}}
 async function describe(){
  const current=await state(),rows={};for(const table of TABLES)rows[table]=ordered(current[table]).slice(-100).reverse();
  const attached=[];for(const alias of Object.keys(connections).sort()){
   try{const native=await (await service(alias)).describe();attached.push({alias,...copy(native.connection??native)});}
   catch(error){attached.push({alias,error:publicError(error)});}
  }
  return {schema:current.schema,workspaceId:current.workspaceId,revision:current.revision,head:current.head,profile:copy(current.profile),
   counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(current[table]).length])),...rows,connections:attached};
 }
 async function catalog(){return {actions:copy(TURBOLONG_ACTIONS)};}
 async function page({table,after=null,limit=100,periodId,vaultId,state:status}={}){
  need(TABLES.includes(table),'INVALID_TABLE','Choose an operations record table.');integer(limit,'limit',1,PAGE_MAX);
  const current=await state();let rows=ordered(current[table]).reverse();
  if(periodId)rows=rows.filter(row=>row.periodId===periodId||table==='periods'&&row.id===periodId);
  if(vaultId)rows=rows.filter(row=>row.vaultId===vaultId||table==='vaults'&&row.id===vaultId);
  if(status)rows=rows.filter(row=>(row.state??row.status??row.desiredState)===status);
  let at=0;if(after){at=rows.findIndex(row=>(row.id??row.exportId)===after)+1;need(at>0,'CURSOR_NOT_FOUND','The selected page cursor is absent.');}
  const selected=rows.slice(at,at+limit);return {workspaceId:current.workspaceId,revision:current.revision,table,rows:copy(selected),
   nextCursor:at+selected.length<rows.length?(selected.at(-1).id??selected.at(-1).exportId):null,total:rows.length};
 }
 async function profileSave(args){return mutate(directory,'profile.save',args,async next=>{next.profile={...next.profile,...namedProfile(args.profile)};return {profile:copy(next.profile)};});}
 async function versionSave(table,key,method,args,definition){
  return mutate(directory,method,args,async next=>{
   const id=args[key]?identifier(args[key]):randomUUID(),previous=next[table][id],at=now();
   const version=sealed({id:randomUUID(),version:(previous?.currentVersion??0)+1,name:text(args.name??definition.name??definition.symbol,table+' name',256),
    definition:copy(definition),createdAt:at,createdByRequestId:args.requestId});
   const file=await retainJSON(directory,table+'/'+id+'/versions/'+String(version.version).padStart(8,'0')+'.json',version);
   const row=previous??{id,createdAt:at,versions:[]};row.name=version.name;row.updatedAt=at;row.currentVersion=version.version;row.versions.push({...version,file});
   next[table][id]=row;return {[table==='periods'?'period':table==='vaults'?'vault':'acquisition']:copy(row),version:copy(version)};
  });
 }
 async function periodSave(args){const definition=validateTurbolongPeriod(versionedInput(args.definition,'operating period'));return versionSave('periods','periodId','period.save',args,definition);}
 async function periodRead({periodId,version}){const current=await state(),row=requireRow(current,'periods',periodId);
  return {workspaceId:current.workspaceId,revision:current.revision,period:copy(row),version:copy(versionAt(row,version))};}
 async function vaultSave(args){
  const definition=versionedInput(args.definition,'vault');need(['mainnet','testnet'].includes(definition.network),'INVALID_NETWORK','Select the vault network.');
  text(definition.name??definition.symbol??args.name,'vault name',256);
  for(const key of ['strategyId','poolId','shareTokenId'])if(definition[key]!==undefined)
   need(/^C[A-Z2-7]{55}$/.test(definition[key]),'INVALID_CONTRACT','Use the original contract ID.',{field:key});
  need(definition.strategyId||definition.poolId||definition.shareTokenId,'INVALID_VAULT','Keep at least one original strategy, pool or share-token ID.');
  if(definition.runtime)definition.runtime=publicRuntimePin(definition.runtime);
  return versionSave('vaults','vaultId','vault.save',args,definition);
 }
 async function vaultRead({vaultId,version}){const current=await state(),row=requireRow(current,'vaults',vaultId);
  return {workspaceId:current.workspaceId,revision:current.revision,vault:copy(row),version:copy(versionAt(row,version))};}
 async function operationPrepare(args){
  intent('operation.prepare',args);
  return tracked(withLock(directory,'prepare-'+args.requestId+'.lock',async()=>{
   let current=await state();const prior=replay(current,'operation.prepare',args);if(prior)return prior;
   let row=Object.values(current.operations).find(item=>item.preparation?.requestId===args.requestId);
   if(row)need(row.preparation.intentSha256===argumentHash(args),'REQUEST_ID_CONFLICT','The retained preparation belongs to different arguments.');
   else{
    revision(current,args);const scope=scopeFor(current,args),action=text(args.action,'native action',160),connection=text(args.connection,'connection',160);
    const input=sourceArguments(action,args.args??{},scope),native=await service(connection),description=await native.describe();
    need(!scope.network||(description.connection??description).network===scope.network,'NETWORK_MISMATCH','The attached connection belongs to another operating network.');
    const id=args.operationId?identifier(args.operationId):randomUUID(),old=current.operations[id];
    if(old)need(old.attemptIds.length===0&&old.state==='FAILED'&&old.preparation?.failed&&old.action===action&&
      old.connection===connection&&canonical(old.args)===canonical(input)&&canonical(old.scope)===canonical(scope),
      'OPERATION_SOURCE_CHANGED','Only the same undispatched failed preparation can be continued.');
    const at=now();row=old?copy(old):{id,...scopeFields(scope),scope,connection,action,args:input,catalogue:copy(getTurbolongAction(action)),
     createdAt:at,createdByRequestId:args.requestId,attemptIds:[],sourceIds:[],outcomes:[],preparationHistory:[],
     acquisitionId:args.acquisitionId??null,correctionId:args.correctionId??null,paused:false,nextRequest:null,pagination:null,runtime:null};
    if(args.acquisitionId)requireRow(current,'acquisitions',args.acquisitionId);
    if(args.correctionId)requireRow(current,'corrections',args.correctionId);
    row.state='PREPARING';row.updatedAt=at;row.preparation={requestId:args.requestId,intentSha256:argumentHash(args),startedAt:at,failed:false,sourceId:randomUUID()};
    const after=copy(current);after.operations[id]=row;
    await withLock(directory,'writer.lock',async()=>{await recoverState(directory);const before=await readState(directory);revision(before,args);
     need(before.head===current.head,'REVISION_CONFLICT','The workspace changed while preparing its original selection.');
     return commitState(directory,before,after,'operation.prepare',args,{operation:copy(row)},{recordRequest:false});});
   }
   const selectionPath='operations/'+row.id+'/preparations/'+args.requestId;let prepared,errorRecord;
   try{prepared=await files.readJSON(directory,selectionPath+'/prepared.json');}
   catch(error){if(error.code!=='ENOENT')throw error;
    try{errorRecord=await files.readJSON(directory,selectionPath+'/failure.json');}catch(missing){if(missing.code!=='ENOENT')throw missing;}
    if(!errorRecord)try{prepared=await (await service(row.connection)).prepare({action:row.action,args:copy(row.args),requestId:args.requestId});nativeRequestScope(prepared,row);
     await retainJSON(directory,selectionPath+'/prepared.json',prepared);
    }catch(failure){
     errorRecord={at:now(),error:publicError(failure),observations:copy(failure.observations??failure.details?.observations??failure.detail?.observations??(failure.details?.observation?[failure.details.observation]:failure.detail?.observation?[failure.detail.observation]:[])),runtime:runtimeFrom(failure.runtime,failure.details?.runtime,failure.detail?.runtime)};
     await retainJSON(directory,selectionPath+'/failure.json',errorRecord);
    }
   }
   const failureSource=errorRecord?await retainOutcome(row,{id:null,sourceId:row.preparation.sourceId??args.requestId,request:null,startedAt:row.preparation.startedAt},
    {status:'FAILED',content:{kind:'preparation.failure',stage:'PREPARATION',action:row.action,error:errorRecord.error},observations:errorRecord.observations??[],runtime:errorRecord.runtime??null}):null;
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'operation.prepare',args);if(prior)return prior;
    const after=copy(before),selected=requireRow(after,'operations',row.id);
    need(selected.preparation?.requestId===args.requestId,'OPERATION_SOURCE_CHANGED','The retained preparation changed.');
    selected.preparationHistory.push({requestId:args.requestId,at:now(),prepared:prepared?await descriptor(directory,selectionPath+'/prepared.json','application/json'):null,
     failure:errorRecord?await descriptor(directory,selectionPath+'/failure.json','application/json'):null,
     runtime:runtimeFrom(prepared?.runtime,prepared?.original?.runtime,errorRecord?.runtime),sourceId:failureSource?.id??null});
    if(failureSource){after.sources[failureSource.id]={...failureSource,stage:'PREPARATION',preparationRequestId:args.requestId};
     if(!selected.sourceIds.includes(failureSource.id))selected.sourceIds.push(failureSource.id);}
    if(errorRecord){selected.state='FAILED';selected.preparation.failed=true;selected.lastError=errorRecord.error;}
    else{nativeRequestScope(prepared,selected);selected.request=copy(prepared);selected.runtime=runtimeFrom(prepared.runtime,prepared.original?.runtime);
     selected.state='PREPARED';selected.lastError=null;selected.preparation.preparedRequestSha256=prepared.requestSha256??digest(jsonBytes(prepared));}
    selected.updatedAt=now();return commitState(directory,before,after,'operation.prepare',args,{operation:copy(selected),...(errorRecord?{error:errorRecord.error}:{})});
   });
  }));
 }
 async function operationRead({operationId}){const current=await state(),row=requireRow(current,'operations',operationId);
  return {workspaceId:current.workspaceId,revision:current.revision,operation:copy(row),
   attempts:row.attemptIds.map(id=>copy(current.attempts[id])),sources:row.sourceIds.map(id=>copy(current.sources[id]))};}
 async function retainOutcome(operation,attempt,outcome){
  need(plain(outcome)&&['COMPLETED','FAILED','UNCERTAIN','PARTIAL','PENDING'].includes(outcome.status),'INVALID_NATIVE_OUTCOME','Native outcome must preserve its original status.');
  const native=copy(outcome),members=[];
  for(let index=0;index<(native.observations??[]).length;index++){
   const observation=native.observations[index];
   for(const part of ['request','response']){const file=await retainNativeBody(directory,'sources/'+attempt.sourceId+'/observations/'+String(index).padStart(6,'0')+'/'+part+'.bin',observation[part]);if(!file)continue;
    members.push({observationId:observation.id??null,index,part,file,contentType:part==='response'?(observation.response.headers?.['content-type']??'application/octet-stream'):'application/octet-stream'});
    observation[part]={...observation[part],body:file};delete observation[part].bodyBase64;delete observation[part].chunks;}
  }
  const runtime=runtimeFrom(outcome.runtime,outcome.original?.runtime,operation.runtime);
  const record=sealed({schema:SOURCE_SCHEMA,id:attempt.sourceId,...scopeFields(operation),kind:outcome.content?.kind??operation.catalogue.resultKind,
   action:operation.action,operationId:operation.id,attemptId:attempt.id,acquisitionId:operation.acquisitionId??null,
   createdAt:attempt.startedAt,observedAt:outcome.observations?.[0]?.observedAt??attempt.startedAt,connection:operation.connection,runtime,
   request:copy(attempt.request),native,members});
  const file=await retainJSON(directory,'sources/'+attempt.sourceId+'/source.json',record);
  return {id:attempt.sourceId,...scopeFields(operation),operationId:operation.id,attemptId:attempt.id,acquisitionId:operation.acquisitionId??null,
   kind:record.kind,action:operation.action,createdAt:attempt.startedAt,observedAt:record.observedAt,connection:operation.connection,runtime,
   state:outcome.status,coverage:copy(outcome.pagination?.coverage??outcome.content?.coverage??null),pagination:copy(outcome.pagination??null),file,members};
 }
 async function sourceOutcome(row){const record=verified(await readRecord(directory,row),'Native source');
  const native=copy(record.native);for(const observation of native.observations??[])for(const part of ['request','response'])if(observation[part]?.body){
   observation[part].bodyBase64=(await readDescriptor(directory,observation[part].body)).toString('base64');delete observation[part].body;}
  return native;
 }
 async function finishAttempt(method,args,attempt,source,outcome,nextRequest,continuationError=null){
  return withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,method,args);if(prior)return prior;
   const after=copy(before),row=requireRow(after,'operations',args.operationId),retained=after.attempts[attempt.id];
   need(retained?.requestSha256===attempt.requestSha256,'OPERATION_SOURCE_CHANGED','The original dispatch request changed.');
   after.sources[source.id]=source;if(!row.sourceIds.includes(source.id))row.sourceIds.push(source.id);
   retained.sourceId=source.id;retained.finishedAt=now();retained.state=outcome.status;retained.runtime=source.runtime;
   retained.outcome={status:outcome.status,content:copy(outcome.content??null),pagination:copy(outcome.pagination??null),original:copy(outcome.original??null)};
   row.state=outcome.status;row.updatedAt=retained.finishedAt;row.lastSourceId=source.id;row.pagination=copy(outcome.pagination??null);
   row.nextRequest=nextRequest?copy(nextRequest):null;row.continuationError=continuationError;row.runtime=source.runtime??row.runtime;
   row.outcomes.push({attemptId:attempt.id,sourceId:source.id,at:retained.finishedAt,status:outcome.status,pagination:copy(outcome.pagination??null)});
   row.lastError=outcome.content?.error??continuationError??null;
   return commitState(directory,before,after,method,args,{operation:copy(row),source:copy(source)});
  });
 }
 async function dispatchOne(args,{reconcile=false,signal}={}){
  const method=reconcile?'operation.reconcile':'operation.run';intent(method,args);identifier(args.operationId);
  return withLock(directory,'operation-'+args.operationId+'.lock',async()=>{
   let current=await state(),operation=requireRow(current,'operations',args.operationId),prior=replay(current,method,args);if(prior)return prior;
   need(operation.request,'NATIVE_PREPARATION_REQUIRED','Complete the original native preparation before dispatch.');
   let attempt=operation.attemptIds.map(id=>current.attempts[id]).find(item=>item.requestId===args.requestId);
   if(attempt){need(attempt.intentSha256===argumentHash(args)&&attempt.method===method,'REQUEST_ID_CONFLICT','The original attempt belongs to another request.');}
   else{
    revision(current,args);need(!operation.paused,'OPERATION_PAUSED','Resume this original operation before continuing.');
    if(!reconcile)need(operation.state==='PREPARED'||Boolean(operation.nextRequest)&&['COMPLETED','PARTIAL'].includes(operation.state),
     'OUTCOME_RECONCILIATION_REQUIRED','Reconcile the retained pending or uncertain native outcome before dispatching again.');
    const previous=[...operation.attemptIds].reverse().map(id=>current.attempts[id]),unresolved=previous.find(item=>!['COMPLETED','FAILED','PARTIAL'].includes(item.state));
    const request=copy(reconcile?(unresolved?.request??previous[0]?.request??operation.request):(operation.nextRequest??operation.request));
    nativeRequestScope(request,operation);
    attempt={id:randomUUID(),sourceId:randomUUID(),operationId:operation.id,...scopeFields(operation),requestId:args.requestId,method,
     intentSha256:argumentHash(args),kind:reconcile?'reconcile':'dispatch',request,requestSha256:digest(jsonBytes(request)),
     state:'RUNNING',startedAt:now(),finishedAt:null,runtime:runtimeFrom(request.runtime,request.original?.runtime,operation.runtime)};
    await withLock(directory,'writer.lock',async()=>{
     await recoverState(directory);const before=await readState(directory);revision(before,args);
     const after=copy(before),row=requireRow(after,'operations',operation.id);
     need(canonical(row)===canonical(operation),'OPERATION_SOURCE_CHANGED','The selected operation changed before dispatch.');
     after.attempts[attempt.id]=attempt;row.attemptIds.push(attempt.id);row.state='RUNNING';row.updatedAt=attempt.startedAt;
     await commitState(directory,before,after,method,args,{operation:copy(row)},{recordRequest:false});
     current=after;operation=row;
    });
   }
   let outcome;
   try{outcome=await files.readJSON(directory,'attempts/'+attempt.id+'/outcome.json');}
   catch(error){if(error.code!=='ENOENT')throw error;
    const original=await service(operation.connection);
    // An existing retained attempt may already have reached the provider.
    let dispatchReceipt;
    try{dispatchReceipt=await files.readJSON(directory,'attempts/'+attempt.id+'/dispatch.json');}catch(missing){if(missing.code!=='ENOENT')throw missing;}
    const needsReconciliation=reconcile||Boolean(dispatchReceipt);
    if(!dispatchReceipt)await retainJSON(directory,'attempts/'+attempt.id+'/dispatch.json',{schema:'stellar-forge.turbolong-operations.dispatch.v1',
     operationId:operation.id,attemptId:attempt.id,requestId:args.requestId,requestSha256:attempt.requestSha256,kind:needsReconciliation?'reconcile':'dispatch',at:now()});
    if(!dispatchReceipt){const handle=await fs.open(join(directory,'attempts',attempt.id),'r');try{await handle.sync();}finally{await handle.close();}}
    try{
     if(needsReconciliation)outcome=await original.reconcile({operation:{...copy(operation),request:copy(attempt.request),attempt:copy(attempt),
       sources:await Promise.all(operation.sourceIds.map(id=>sourceOutcome(current.sources[id])))},signal});
     else outcome=await original.perform({request:copy(attempt.request),signal});
    }catch(failure){outcome={status:'UNCERTAIN',content:{kind:operation.catalogue.resultKind,error:publicError(failure)},
     observations:copy(failure.observations??failure.detail?.observations??(failure.detail?.observation?[failure.detail.observation]:[])),
     ...(failure.runtime?{runtime:failure.runtime}:{})};}
    if(!plain(outcome)||!['COMPLETED','FAILED','UNCERTAIN','PARTIAL','PENDING'].includes(outcome.status))
     outcome={status:'UNCERTAIN',content:{kind:operation.catalogue.resultKind,error:{code:'INVALID_NATIVE_OUTCOME',message:'The native transport did not return a recognized outcome.'},returned:outcome??null},observations:[]};
    outcome={...outcome};delete outcome.ephemeral;
    await retainJSON(directory,'attempts/'+attempt.id+'/outcome.json',outcome);
    // Ephemeral transport material is never part of this workspace source.
   }
   const source=await retainOutcome(operation,attempt,outcome);let nextRequest=null,continuationError=null;
   if(outcome.pagination?.nextArgs&&outcome.pagination.complete!==true){
    const nextPath='attempts/'+attempt.id+'/next-request.json';
    try{nextRequest=await files.readJSON(directory,nextPath);}
    catch(error){if(error.code!=='ENOENT')throw error;
     try{const nextArgs=sourceArguments(operation.action,outcome.pagination.nextArgs,operation.scope);
      nextRequest=await (await service(operation.connection)).prepare({action:operation.action,args:nextArgs,requestId:attempt.id+':next'});
      nativeRequestScope(nextRequest,operation);await retainJSON(directory,nextPath,nextRequest);
     }catch(failure){continuationError=publicError(failure);}
    }
   }
   return finishAttempt(method,args,attempt,source,outcome,nextRequest,continuationError);
  });
 }
 async function operationRun(args,options={}){return tracked(dispatchOne(args,options));}
 async function operationReconcile(args,options={}){return tracked(dispatchOne(args,{...options,reconcile:true}));}
 async function operationPause(args){return mutate(directory,'operation.pause',args,async next=>{
  const row=requireRow(next,'operations',args.operationId);row.paused=true;row.updatedAt=now();return {operation:copy(row)};});}
 async function operationResume(args){return mutate(directory,'operation.resume',args,async next=>{
  const row=requireRow(next,'operations',args.operationId);need(row.state!=='CANCELED','OPERATION_CANCELED','Prepare a new selection after cancellation.');
  row.paused=false;row.updatedAt=now();return {operation:copy(row)};});}
 async function operationCancel(args){return mutate(directory,'operation.cancel',args,async next=>{
  const row=requireRow(next,'operations',args.operationId);need(row.attemptIds.length===0,'OUTCOME_RECONCILIATION_REQUIRED','A dispatched operation retains its actual outcome; pause or reconcile it.');
  row.paused=true;row.state='CANCELED';row.updatedAt=now();return {operation:copy(row)};});}

 async function operationCollect(args,{signal}={}){
  identifier(args.operationId);intent('operation.collect',args);
  if(args.maxPages!==undefined&&args.maxPages!==null)integer(args.maxPages,'maxPages',1);
  return tracked(withLock(directory,'collect-'+args.operationId+'.lock',async()=>{
   await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory);if(replay(before,'operation.collect',args))return;
    const original=requireRow(before,'operations',args.operationId);
    need(readOnlyAction(original.catalogue,original.args),'READ_ONLY_ACQUISITION_REQUIRED','Complete automatic paging requires an original read-only action.');
    if(original.execution&&!['COMPLETE','CANCELED'].includes(original.execution.state)){
     need(original.execution.requestId===args.requestId&&canonical(original.execution.args)===canonical(argumentsBody(args)),
      'OPERATION_RUNNING','Resume the original collector and its retained arguments.',{continuation:original.execution.requestArgs});return;
    }
    revision(before,args);need(!original.paused,'OPERATION_PAUSED','Resume the operation before collecting.');
    const after=copy(before),row=after.operations[original.id];
    row.execution={requestId:args.requestId,args:argumentsBody(args),requestArgs:copy(args),state:'RUNNING',childRequests:[],createdAt:now(),updatedAt:now()};
    await commitState(directory,before,after,'operation.collect',args,{operation:copy(row)},{recordRequest:false});
   });
   let reason=null;
   while(!signal?.aborted){
    const current=await state(),prior=replay(current,'operation.collect',args);if(prior)return prior;
    const operation=requireRow(current,'operations',args.operationId),execution=operation.execution;
    need(execution?.requestId===args.requestId&&canonical(execution.args)===canonical(argumentsBody(args)),'OPERATION_SOURCE_CHANGED','The original collector selection changed.');
    if(operation.paused){reason='operator-paused';break;}
    let child=execution.childRequests.at(-1);const pending=child&&!current.requests[child];
    if(!pending){
     if(terminalPage(operation)){reason='provider-complete';break;}
     if(['PENDING','UNCERTAIN','FAILED','RUNNING','PREPARING'].includes(operation.state)||operation.continuationError){
      reason='original-outcome-awaiting-reconciliation';break;}
     if(args.maxPages!==undefined&&args.maxPages!==null&&execution.childRequests.length>=args.maxPages){reason='selected-page-limit';break;}
     child=randomUUID();const internal={requestId:randomUUID(),expectedRevision:current.revision,operationId:operation.id,collectorRequestId:args.requestId,childRequestId:child};
     await mutate(directory,'operation.collect.next',internal,async next=>{
      const selected=next.operations[operation.id].execution;need(selected.requestId===args.requestId,'OPERATION_SOURCE_CHANGED','The original collector changed.');
      selected.childRequests.push(child);selected.state='RUNNING';selected.updatedAt=now();return {operation:copy(next.operations[operation.id])};
     });
    }
    const fresh=await state();await operationRun({requestId:child,expectedRevision:fresh.revision,operationId:operation.id},{signal});
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'operation.collect',args);if(prior)return prior;
    const after=copy(before),row=requireRow(after,'operations',args.operationId),complete=terminalPage(row);
    need(row.execution?.requestId===args.requestId,'OPERATION_SOURCE_CHANGED','The original collector changed.');
    const selectedComplete=complete||reason==='selected-page-limit';row.execution.state=selectedComplete?'COMPLETE':'PAUSED';
    row.execution.reason=complete?'provider-complete':reason??'interrupted';row.execution.updatedAt=now();
    if(selectedComplete)row.execution.completedAt=row.execution.updatedAt;
    const response={operation:copy(row),complete,selectionComplete:selectedComplete,continuation:copy(row.execution.requestArgs)};
    return selectedComplete?commitState(directory,before,after,'operation.collect',args,response):
     commitState(directory,before,after,'operation.collect.checkpoint',{requestId:randomUUID(),expectedRevision:before.revision,
      operationId:row.id,originalRequestId:args.requestId},response);
   });
  }));
 }
 async function acquisitionSave(args){
  const input=versionedInput(args.definition,'acquisition'),current=await state(),scope=scopeFor(current,input);
  need(scope.periodId,'PERIOD_REQUIRED','Select the complete operating period before saving its acquisition.');
  if(input.cadenceSeconds!==undefined&&input.cadenceSeconds!==null)integer(input.cadenceSeconds,'cadenceSeconds',1,366*86400);
  const queries=planQueries(input,scope).map(query=>{
   if(query.vaultId){const selectedScope=scopeFor(current,{periodId:scope.periodId,periodVersion:scope.periodVersion,vaultId:query.vaultId,vaultVersion:query.vaultVersion});
    return {...query,vaultVersion:selectedScope.vaultVersion,args:sourceArguments(query.action,query.args,selectedScope)};}
   return query;
  });
  const definition={...input,periodId:scope.periodId,periodVersion:scope.periodVersion,periodSha256:scope.periodSha256,network:scope.network,
   startsAt:scope.period.startsAt,endsAt:scope.period.endsAt,cadenceSeconds:input.cadenceSeconds??null,queries};
  return mutate(directory,'acquisition.save',args,async next=>{
   const p=periodAt(next,definition.periodId,definition.periodVersion);need(p.version.sha256===definition.periodSha256,'PERIOD_SCOPE_CHANGED','The acquisition period changed.');
   const id=args.acquisitionId?identifier(args.acquisitionId):randomUUID(),previous=next.acquisitions[id],at=now();
   const version=sealed({id:randomUUID(),version:(previous?.currentVersion??0)+1,name:text(args.name??input.name,'acquisition name',256),definition,createdAt:at});
   const file=await retainJSON(directory,'acquisitions/'+id+'/versions/'+String(version.version).padStart(8,'0')+'.json',version);
   const row=previous??{id,createdAt:at,versions:[],cycles:[],operationIds:[],paused:true,desiredState:'PAUSED',execution:null,nextRunAt:null};
   row.name=version.name;row.updatedAt=at;row.currentVersion=version.version;row.versions.push({...version,file});row.periodId=definition.periodId;
   row.periodVersion=definition.periodVersion;row.network=definition.network;next.acquisitions[id]=row;
   return {acquisition:copy(row),version:copy(version)};
  });
 }
 async function acquisitionRead({acquisitionId,version}){const current=await state(),row=requireRow(current,'acquisitions',acquisitionId);
  return {workspaceId:current.workspaceId,revision:current.revision,acquisition:copy(row),version:copy(versionAt(row,version)),
   operations:[...new Set([...row.operationIds,...(row.execution?.queries??[]).map(item=>item.operationId)])].filter(id=>current.operations[id]).map(id=>copy(current.operations[id]))};}
 async function acquisitionStart(args){return mutate(directory,'acquisition.start',args,async next=>{
  const row=requireRow(next,'acquisitions',args.acquisitionId);row.paused=false;row.desiredState='RUNNING';row.nextRunAt=args.nextRunAt?isoTime(args.nextRunAt,'nextRunAt'):now();
  row.updatedAt=now();if(row.execution&&row.execution.state==='PAUSED')row.execution.state='RUNNING';return {acquisition:copy(row)};
 });}
 async function acquisitionPause(args){return mutate(directory,'acquisition.pause',args,async next=>{
  const row=requireRow(next,'acquisitions',args.acquisitionId);row.paused=true;row.desiredState='PAUSED';row.updatedAt=now();
  if(row.execution&&!FINAL_ACQUISITIONS.has(row.execution.state))row.execution.state='PAUSED';return {acquisition:copy(row)};
 });}
 async function acquisitionRun(args,{signal}={}){
  identifier(args.acquisitionId);intent('acquisition.run',args);
  return tracked(withLock(directory,'acquisition-'+args.acquisitionId+'.lock',async()=>{
   await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory);if(replay(before,'acquisition.run',args))return;
    const original=requireRow(before,'acquisitions',args.acquisitionId);
    if(original.execution&&!FINAL_ACQUISITIONS.has(original.execution.state)){
     need(original.execution.requestId===args.requestId&&canonical(original.execution.args)===canonical(argumentsBody(args)),
      'ACQUISITION_RUNNING','Continue the retained acquisition request and complete frozen selection.',{continuation:original.execution.requestArgs});return;
    }
    revision(before,args);const selected=versionAt(original,args.version),after=copy(before),row=after.acquisitions[original.id],at=now();
    row.execution={id:randomUUID(),requestId:args.requestId,args:argumentsBody(args),requestArgs:copy(args),state:'RUNNING',
     version:selected.version,versionSha256:selected.sha256,definition:copy(selected.definition),createdAt:at,updatedAt:at,queryIndex:0,
     queries:selected.definition.queries.map((query,index)=>({index,query:copy(query),operationId:randomUUID(),prepareRequestId:randomUUID(),
      collectRequestId:randomUUID(),state:'PENDING'}))};
    row.paused=false;row.desiredState='RUNNING';row.updatedAt=at;
    await commitState(directory,before,after,'acquisition.run',args,{acquisition:copy(row)},{recordRequest:false});
   });
   let reason=null;
   while(!signal?.aborted){
    const current=await state(),prior=replay(current,'acquisition.run',args);if(prior)return prior;
    const acquisition=requireRow(current,'acquisitions',args.acquisitionId),execution=acquisition.execution;
    need(execution?.requestId===args.requestId,'ACQUISITION_SOURCE_CHANGED','The retained acquisition request changed.');
    if(acquisition.paused||acquisition.desiredState==='PAUSED'){reason='operator-paused';break;}
    if(execution.queryIndex>=execution.queries.length){reason='selected-queries-complete';break;}
    const query=execution.queries[execution.queryIndex],definition=execution.definition;
    const originalRequest={requestId:query.prepareRequestId,expectedRevision:current.revision,operationId:query.operationId,
     acquisitionId:acquisition.id,periodId:definition.periodId,periodVersion:definition.periodVersion,
     ...(query.query.vaultId?{vaultId:query.query.vaultId,vaultVersion:query.query.vaultVersion}:{}),
     connection:query.query.connection,action:query.query.action,args:copy(query.query.args)};
    if(!current.requests[query.prepareRequestId])await operationPrepare(originalRequest);
    let fresh=await state(),operation=requireRow(fresh,'operations',query.operationId);
    if(operation.state==='FAILED'&&!operation.request){reason='native-preparation-failed';break;}
    if(operation.paused){reason='original-operation-paused';break;}
    const collectArgs={requestId:query.collectRequestId,expectedRevision:fresh.revision,operationId:operation.id,
     ...(query.query.maxPages===undefined?{}:{maxPages:query.query.maxPages})};
    const collected=await operationCollect(collectArgs,{signal});
    if(!collected.selectionComplete){reason='original-outcome-awaiting-reconciliation';break;}
    fresh=await state();await mutate(directory,'acquisition.query.complete',{requestId:randomUUID(),expectedRevision:fresh.revision,
     acquisitionId:acquisition.id,executionId:execution.id,queryIndex:query.index},async next=>{
      const row=next.acquisitions[acquisition.id],selected=row.execution;
      need(selected.id===execution.id&&selected.queryIndex===query.index,'ACQUISITION_SOURCE_CHANGED','The acquisition cursor changed.');
      const item=selected.queries[query.index];item.state=collected.complete?'COMPLETE':'PARTIAL';item.completedAt=now();
      item.operationId=operation.id;item.sourceIds=copy(next.operations[operation.id].sourceIds);
      if(!row.operationIds.includes(operation.id))row.operationIds.push(operation.id);
      selected.queryIndex++;selected.updatedAt=now();row.updatedAt=selected.updatedAt;return {acquisition:copy(row)};
    });
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'acquisition.run',args);if(prior)return prior;
    const after=copy(before),row=requireRow(after,'acquisitions',args.acquisitionId),execution=row.execution;
    need(execution?.requestId===args.requestId,'ACQUISITION_SOURCE_CHANGED','The original acquisition selection changed.');
    const complete=execution.queryIndex===execution.queries.length,at=now();
    execution.state=complete?'COMPLETE':'PAUSED';execution.reason=reason??'interrupted';execution.updatedAt=at;row.updatedAt=at;
    if(complete){
     execution.completedAt=at;row.cycles.push(copy(execution));
     const cadence=execution.definition.cadenceSeconds,periodEnded=Date.now()>=Date.parse(execution.definition.endsAt);
     row.nextRunAt=cadence&&!periodEnded?new Date(Date.now()+cadence*1000).toISOString():null;
     row.desiredState=row.nextRunAt?'RUNNING':'COMPLETE';row.paused=false;
    }else{row.desiredState='PAUSED';row.paused=true;}
    const response={acquisition:copy(row),complete,continuation:copy(execution.requestArgs)};
    return complete?commitState(directory,before,after,'acquisition.run',args,response):
     commitState(directory,before,after,'acquisition.checkpoint',{requestId:randomUUID(),expectedRevision:before.revision,
      acquisitionId:row.id,originalRequestId:args.requestId},response);
   });
  }));
 }
 async function sourceImport(args,{file}={}){
  intent('source.import',args);const current=await state(),prior=replay(current,'source.import',args);if(prior)return prior;
  revision(current,args);const scope=scopeFor(current,args);need(scope.periodId,'PERIOD_REQUIRED','Select the operating period for this source.');
  const name=safeFilename(args.name),kind=text(args.kind,'source kind',160),id=args.sourceId?identifier(args.sourceId):args.requestId;
  let input,original;
  if(file){need(typeof file==='string'&&isAbsolute(file),'INVALID_SOURCE','Select an absolute original source file.');
   const actual=await fs.realpath(file),stat=await fs.lstat(file);need(stat.isFile()&&!stat.isSymbolicLink(),'INVALID_SOURCE','Select a regular original file.');
   original={directory:dirname(actual),file:await descriptor(dirname(actual),basename(actual),args.contentType??'application/octet-stream')};
   hash(args.expectedSha256);need(original.file.sha256===args.expectedSha256,'SOURCE_CHANGED','The selected original file differs from its digest.');
  }else{input=typeof args.bodyBase64==='string'?observationBytes({bodyBase64:args.bodyBase64}):Buffer.from(typeof args.content==='string'?args.content:(need(false,'INVALID_SOURCE','Supply original file bytes or complete UTF-8 content.'),''),'utf8');
   if(args.expectedSha256)need(digest(input)===hash(args.expectedSha256),'SOURCE_CHANGED','The selected original source differs from its digest.');}
  let record,selectedFile;
  try{record=verified(await files.readJSON(directory,'sources/'+id+'/source.json'),'Imported source');
   need(record.importIntentSha256===argumentHash(args),'SOURCE_CONFLICT','This source identifier belongs to another import.');
   selectedFile=await descriptor(directory,'sources/'+id+'/source.json','application/json');await files.sourceFileRange(directory,record.body,0,1);
  }catch(error){if(error.code!=='ENOENT')throw error;
   const bodyPath='sources/'+id+'/'+name;
   const body=original?await copyDescriptor(original.directory,original.file,directory,bodyPath):await files.writeNew(directory,bodyPath,input);
   if(original){const target=await files.filePath(directory,bodyPath);await fs.chmod(target,original.file.mode);}
   const at=now(),runtime=args.runtime?publicRuntimePin(args.runtime):null;
   record=sealed({schema:SOURCE_SCHEMA,id,...scopeFields(scope),kind,createdAt:at,observedAt:args.observedAt?isoTime(args.observedAt,'observedAt'):at,
    provenance:'operator-selected-original-file',body,name,contentType:args.contentType??'application/octet-stream',importIntentSha256:argumentHash(args),
    coverage:copy(publicPayload(args.coverage??{kind:'operator-selected-file',complete:null})),runtime,notes:args.notes??''});
   selectedFile=await retainJSON(directory,'sources/'+id+'/source.json',record);
  }
  return mutate(directory,'source.import',args,async next=>{
   const selectedScope=scopeFor(next,args);need(selectedScope.periodSha256===record.periodSha256&&(selectedScope.vaultSha256??null)===(record.vaultSha256??null),
    'PERIOD_SCOPE_CHANGED','The selected import period or vault changed; use its original version.');
   need(!next.sources[id],'SOURCE_CONFLICT','This source identifier is already retained.');
   const row={id,...scopeFields(record),kind,createdAt:record.createdAt,observedAt:record.observedAt,provenance:record.provenance,
    file:selectedFile,body:record.body,name,contentType:record.contentType,coverage:record.coverage,runtime:record.runtime,
    operationId:null,attemptId:null,connection:null};
   next.sources[id]=row;return {source:copy(row)};
  });
 }
 async function sourceRead({sourceId}){const current=await state(),source=requireRow(current,'sources',sourceId);
  return {workspaceId:current.workspaceId,revision:current.revision,source:copy(source),record:await readRecord(directory,source)};}
 async function sourceFile({sourceId,part='source',path,index=0,offset=0,length=196608}={}){
  const current=await state(),row=requireRow(current,'sources',sourceId);integer(offset,'offset',0);integer(length,'length',1,4*1024*1024);
  let file,contentType='application/octet-stream';
  if(path){const candidates=[{file:row.file,contentType:'application/json'},...(row.body?[{file:row.body,contentType:row.contentType}]:[]),...(row.members??[])];
   const match=candidates.find(item=>item.file.path===path);need(match,'SOURCE_PART_NOT_FOUND','Select a declared original source member.');({file,contentType}=match);
  }else if(part==='source'){file=row.file;contentType='application/json';}
  else if(part==='body'&&row.body){file=row.body;contentType=row.contentType;}
  else{integer(index,'observation index',0);const match=(row.members??[]).find(item=>item.index===index&&item.part===part);file=match?.file;contentType=match?.contentType??contentType;}
  need(file,'SOURCE_PART_NOT_FOUND','Select a retained source, body, request or response member.');
  const result=await files.sourceFileRange(directory,file,offset,length);
  return {...result,path:file.path,bytes:file.bytes,sha256:file.sha256,contentType};
 }
 async function incidentSave(args){
  const input=versionedInput(args.incident,'incident'),status=input.status??'OPEN';need(INCIDENT_STATES.has(status),'INVALID_INCIDENT_STATUS','Select an incident status.');
  text(input.title,'incident title',512);
  return mutate(directory,'incident.save',args,async next=>{
   const scope=scopeFor(next,input),id=args.incidentId?identifier(args.incidentId):randomUUID(),previous=next.incidents[id],at=now();
   need(scope.periodId,'PERIOD_REQUIRED','Select the incident operating period.');
   if(previous)need(previous.periodId===scope.periodId&&previous.periodVersion===scope.periodVersion,'INCIDENT_SCOPE_CHANGED','An incident remains attached to its original period version.');
   for(const sourceId of input.sourceIds??[]){const source=requireRow(next,'sources',sourceId);need(source.periodId===scope.periodId,'INCIDENT_SCOPE_CHANGED','A linked source belongs to another period.');}
   if(previous&&previous.status==='RESOLVED'&&status!=='RESOLVED'){
    delete input.resolvedAt;delete input.closedAt;
   }
   const entry=sealed({id:randomUUID(),...input,...scopeFields(scope),status,at,requestId:args.requestId});
   const file=await retainJSON(directory,'incidents/'+id+'/history/'+entry.id+'.json',entry);
   const row=previous??{id,...scopeFields(scope),createdAt:at,history:[]};row.title=input.title;row.status=status;row.updatedAt=at;
   for(const [key,value]of Object.entries(input))if(!['id','history','createdAt','updatedAt','periodId','periodVersion','periodSha256','vaultId','vaultVersion','vaultSha256','network'].includes(key))row[key]=copy(value);
   if(previous&&status!=='RESOLVED'){delete row.resolvedAt;delete row.closedAt;}
   row.severity=input.severity??'medium';row.sourceIds=copy(input.sourceIds??[]);row.note=input.note??'';row.history.push({...entry,file});next.incidents[id]=row;
   return {incident:copy(row)};
  });
 }
 async function incidentRead({incidentId}){const current=await state();return {workspaceId:current.workspaceId,revision:current.revision,incident:copy(requireRow(current,'incidents',incidentId))};}
 async function correctionSave(args){
  const input=versionedInput(args.correction,'correction'),status=input.status??'PROPOSED';need(CORRECTION_STATES.has(status),'INVALID_CORRECTION_STATUS','Select a correction status.');
  text(input.title,'correction title',512);
  return mutate(directory,'correction.save',args,async next=>{
   const scope=scopeFor(next,input),id=args.correctionId?identifier(args.correctionId):randomUUID(),previous=next.corrections[id],at=now();
   need(scope.periodId,'PERIOD_REQUIRED','Select the correction operating period.');
   if(previous)need(previous.periodId===scope.periodId&&previous.periodVersion===scope.periodVersion,'CORRECTION_SCOPE_CHANGED','A correction remains attached to its original period version.');
   for(const incidentId of input.incidentIds??[])need(requireRow(next,'incidents',incidentId).periodId===scope.periodId,'CORRECTION_SCOPE_CHANGED','A linked incident belongs to another period.');
   for(const operationId of input.operationIds??[])need(requireRow(next,'operations',operationId).periodId===scope.periodId,'CORRECTION_SCOPE_CHANGED','A linked operation belongs to another period.');
   for(const sourceId of input.sourceIds??[])need(requireRow(next,'sources',sourceId).periodId===scope.periodId,'CORRECTION_SCOPE_CHANGED','A linked source belongs to another period.');
   const entry=sealed({id:randomUUID(),...input,...scopeFields(scope),status,at,requestId:args.requestId});
   const file=await retainJSON(directory,'corrections/'+id+'/history/'+entry.id+'.json',entry);
   const row=previous??{id,...scopeFields(scope),createdAt:at,history:[]};
   for(const key of ['action','operation','target','sourceId','rowId','rowKey','reason','harvestId','replacementSourceId'])if(!own(input,key))delete row[key];
   for(const [key,value]of Object.entries(input))if(!['id','history','createdAt','updatedAt','periodId','periodVersion','periodSha256','vaultId','vaultVersion','vaultSha256','network'].includes(key))row[key]=copy(value);
   row.title=input.title;row.status=status;row.updatedAt=at;row.note=input.note??'';
   row.incidentIds=copy(input.incidentIds??[]);row.operationIds=copy(input.operationIds??[]);row.sourceIds=copy(input.sourceIds??[]);
   row.history.push({...entry,file});next.corrections[id]=row;return {correction:copy(row)};
  });
 }
 async function correctionRead({correctionId}){const current=await state();return {workspaceId:current.workspaceId,revision:current.revision,correction:copy(requireRow(current,'corrections',correctionId))};}

 async function buildRecord(table,method,args,select,produce){
  intent(method,args);
  return tracked(withLock(directory,method.replace(/\./g,'-')+'-'+args.requestId+'.lock',async()=>{
   let row;
   await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,method,args);if(prior){row={replay:prior};return;}
    row=Object.values(before[table]).find(item=>item.createdByRequestId===args.requestId);
    if(row){need(row.intentSha256===argumentHash(args),'REQUEST_ID_CONFLICT','The original build request has different arguments.');return;}
    revision(before,args);const selection=await select(before),id=randomUUID(),at=now();
    const engine=await fs.readFile(new URL('./period-analysis.mjs',import.meta.url));
    const original=sealed({schema:'stellar-forge.turbolong-operations.build-selection.v1',id,method,
     workspaceId:before.workspaceId,sourceRevision:before.revision,sourceHead:before.head,createdAt:at,
     engineSha256:digest(engine),selection});
    const selectionFile=await retainJSON(directory,table+'/'+id+'/selection.json',original);
    row={id,name:selection.name??table,...scopeFields(selection),createdAt:at,updatedAt:at,createdByRequestId:args.requestId,
     intentSha256:argumentHash(args),state:'BUILDING',selectionFile,selectionSha256:original.sha256,engineSha256:original.engineSha256};
    const after=copy(before);after[table][id]=row;
    await commitState(directory,before,after,method,args,{[table==='analyses'?'analysis':'report']:copy(row)},{recordRequest:false});
   });
   if(row.replay)return row.replay;
   const saved=verified(await readRecord(directory,row.selectionFile),'Build selection');
   need(saved.sha256===row.selectionSha256,'SOURCE_CHANGED','The original build input changed.');
   const completedPath=table+'/'+row.id+'/completed.json';let produced;
   try{produced=await files.readJSON(directory,completedPath);}
   catch(missing){if(missing.code!=='ENOENT')throw missing;
    try{
     const engine=await fs.readFile(new URL('./period-analysis.mjs',import.meta.url));
     need(digest(engine)===saved.engineSha256,'ANALYSIS_SOURCE_CHANGED','Use the original selected analysis source or create a new edition.');
     produced=await produce(copy(row),saved.selection,saved);await retainJSON(directory,completedPath,produced);
    }catch(error){
     const at=now(),failureId=randomUUID(),failure=await retainJSON(directory,table+'/'+row.id+'/failures/'+failureId+'.json',
      {id:failureId,at,error:publicError(error),selectionSha256:row.selectionSha256});
     await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory),after=copy(before),selected=after[table][row.id];
      selected.state='FAILED';selected.lastError=publicError(error);selected.failures??=[];selected.failures.push(failure);selected.updatedAt=at;
      await commitState(directory,before,after,method+'.failure',{requestId:randomUUID(),expectedRevision:before.revision,originalRequestId:args.requestId},
       {[table==='analyses'?'analysis':'report']:copy(selected)});
     });throw error;
    }
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,method,args);if(prior)return prior;
    const after=copy(before),selected=after[table][row.id];
    need(selected?.selectionSha256===row.selectionSha256,'SOURCE_CHANGED','The saved build selection changed.');
    Object.assign(selected,copy(produced),{state:'COMPLETE',updatedAt:now(),lastError:null});
    return commitState(directory,before,after,method,args,{[table==='analyses'?'analysis':'report']:copy(selected)});
   });
  }));
 }
 async function analysisCreate(args){
  return buildRecord('analyses','analysis.create',args,async current=>{
   const scope=scopeFor(current,args);need(scope.periodId,'PERIOD_REQUIRED','Select the complete operating period.');
   const ids=args.sourceIds??ordered(current.sources).filter(row=>row.periodId===scope.periodId&&row.periodVersion===scope.periodVersion).map(row=>row.id);
   need(Array.isArray(ids),'INVALID_SELECTION','Select complete original source IDs.');
   const sources=[...new Set(ids)].map(id=>requireRow(current,'sources',id));
   need(sources.every(row=>row.periodId===scope.periodId&&row.periodVersion===scope.periodVersion),'PERIOD_SCOPE_CHANGED','Select sources from this exact operating period version.');
   const vaultIds=args.vaultIds??[...new Set(sources.map(row=>row.vaultId).filter(Boolean))];
   const vaults=vaultIds.map(id=>{
    const row=requireRow(current,'vaults',id),selectedVersion=args.vaultVersions?.[id]??sources.find(source=>source.vaultId===id)?.vaultVersion??row.currentVersion;
    const version=versionAt(row,selectedVersion);need(version.definition.network===scope.network,'NETWORK_MISMATCH','The selected vault uses another network.');
    return {id:row.id,name:version.name,version:version.version,sha256:version.sha256,...copy(version.definition)};
   });
   const incidentIds=args.incidentIds??Object.values(current.incidents).filter(row=>row.periodId===scope.periodId&&row.periodVersion===scope.periodVersion).map(row=>row.id);
   const correctionIds=args.correctionIds??Object.values(current.corrections).filter(row=>row.periodId===scope.periodId&&row.periodVersion===scope.periodVersion).map(row=>row.id);
   const incidents=incidentIds.map(id=>copy(requireRow(current,'incidents',id))),corrections=correctionIds.map(id=>copy(requireRow(current,'corrections',id)));
   need([...incidents,...corrections].every(row=>row.periodId===scope.periodId&&row.periodVersion===scope.periodVersion),'PERIOD_SCOPE_CHANGED','Linked incident or correction belongs to another period version.');
   return {...scope,name:text(args.name??scope.period.name,'analysis name',256),vaults,sources:copy(sources),incidents,corrections};
  },async(row,selection,original)=>{
   const sources=[];
   for(const retained of selection.sources){
    const record=verified(await readRecord(directory,retained),'Original operating source');
    if(record.native){
     const observation=record.native.observations?.find(item=>item.response?.body)??record.native.observations?.[0],body=observation?.response?.body;
     sources.push({id:retained.id,kind:record.kind,sha256:retained.file.sha256,
      ...(body?{bodyBase64:(await readDescriptor(directory,body)).toString('base64'),bodySha256:body.sha256}:{}),
      content:copy(record.native.content??null),observedAt:record.observedAt,coverage:copy(record.native.pagination?.coverage??record.native.content?.coverage??null),
      operationId:record.operationId,acquisitionId:record.acquisitionId,action:record.action,network:record.network,periodId:record.periodId,vaultId:record.vaultId,
      request:copy(observation?.request??null),original:{...(plain(record.native.original)?copy(record.native.original):{}),source:copy(retained.file),artifacts:copy(record.members)},
      observations:copy(record.native.observations??[]),runtime:record.runtime});
    }
    else sources.push({id:retained.id,kind:record.kind,sha256:retained.body.sha256,
     bodyBase64:(await readDescriptor(directory,record.body)).toString('base64'),observedAt:record.observedAt,coverage:copy(record.coverage??null),
     operationId:null,contentType:record.contentType,network:record.network,periodId:record.periodId,vaultId:record.vaultId,runtime:record.runtime});
   }
   const analysis=await analyseTurbolongPeriod({period:copy(selection.period),vaults:copy(selection.vaults),sources,
    incidents:copy(selection.incidents),corrections:copy(selection.corrections)});
   const runtimes=[...new Map(selection.sources.filter(source=>source.runtime).map(source=>[source.runtime.id,source.runtime])).values()];
   const record=sealed({schema:EDITION_SCHEMA,id:row.id,name:selection.name,...scopeFields(selection),createdAt:row.createdAt,
    sourceWorkspaceId:original.workspaceId,sourceRevision:original.sourceRevision,sourceHead:original.sourceHead,
    engineSha256:original.engineSha256,selectionSha256:original.sha256,period:copy(selection.period),
    sourceIds:selection.sources.map(source=>source.id),sourcePins:selection.sources.map(source=>({id:source.id,file:source.file,runtime:source.runtime??null})),
    vaults:copy(selection.vaults),incidents:copy(selection.incidents),corrections:copy(selection.corrections),runtimes,analysis});
   const file=await retainJSON(directory,'analyses/'+row.id+'/analysis.json',record);
   return {file,sha256:record.sha256,summary:copy(analysis.summary??{}),sourceIds:record.sourceIds,sourceRevision:original.sourceRevision,
    vaultIds:selection.vaults.map(vault=>vault.id),incidentIds:selection.incidents.map(item=>item.id),correctionIds:selection.corrections.map(item=>item.id),runtimes};
  });
 }
 async function analysisRead({analysisId}){const current=await state(),row=requireRow(current,'analyses',analysisId);
  return {workspaceId:current.workspaceId,revision:current.revision,analysis:copy(row),record:row.file?await readRecord(directory,row):null};}
 async function analysisFile({analysisId,offset=0,length=196608}){const current=await state(),row=requireRow(current,'analyses',analysisId);
  need(row.file,'ANALYSIS_PENDING','The selected analysis has not completed.');
  const result=await files.sourceFileRange(directory,row.file,offset,length);return {...result,path:row.file.path,bytes:row.file.bytes,sha256:row.file.sha256,contentType:'application/json'};}
 async function reportCreate(args){
  return buildRecord('reports','report.create',args,async current=>{
   const selected=requireRow(current,'analyses',args.analysisId);need(selected.state==='COMPLETE'&&selected.file,'ANALYSIS_PENDING','Select a complete analysis edition.');
   const record=verified(await readRecord(directory,selected),'Analysis edition');
   const formats=args.formats??null;if(formats)need(Array.isArray(formats)&&formats.every(value=>['json','html','csv'].includes(value))&&formats.length>0,
    'INVALID_REPORT_FORMAT','Choose HTML, JSON or CSV report formats.');
   return {...scopeFields(record),name:text(args.name??record.name,'report name',256),analysisId:selected.id,analysisFile:copy(selected.file),
    analysisSha256:record.sha256,formats};
  },async(row,selection,original)=>{
   const analysis=verified(await readRecord(directory,selection.analysisFile),'Analysis edition');
   need(analysis.sha256===selection.analysisSha256,'SOURCE_CHANGED','The report analysis edition changed.');
   const rendered=await renderTurbolongReport(analysis.analysis,{name:selection.name});
   need(Array.isArray(rendered.files)&&rendered.files.length>0,'INVALID_REPORT','The native renderer returned no report files.');
   const members=[],seen=new Set();
   for(const output of rendered.files){
    const filename=safeFilename(output.path),format=filename.endsWith('.html')?'html':filename.endsWith('.csv')?'csv':'json';
    need(filename!=='report.json'&&!seen.has(filename),'INVALID_REPORT','Report output conflicts with its reserved metadata or another member.');
    seen.add(filename);if(selection.formats&&!selection.formats.includes(format))continue;
    const bytes=Buffer.isBuffer(output.content)?output.content:Buffer.from(output.content,'utf8');
    need(output.bytes===bytes.length&&output.sha256===digest(bytes),'INVALID_REPORT','The original rendered report member differs from its descriptor.',{filename});
    const file=await files.writeNew(directory,'reports/'+row.id+'/'+filename,bytes);
    members.push({format,filename,contentType:output.contentType,file,bytes:file.bytes,sha256:file.sha256});
   }
   need(members.length>0,'INVALID_REPORT_FORMAT','The selected report formats are unavailable.');
   const metadata=sealed({schema:'stellar-forge.turbolong-operations.report.v1',id:row.id,name:selection.name,...scopeFields(selection),
    analysisId:selection.analysisId,analysisSha256:selection.analysisSha256,createdAt:row.createdAt,selectionSha256:original.sha256,
    scope:{periodId:analysis.periodId,periodVersion:analysis.periodVersion,sourceIds:analysis.sourceIds,vaultIds:analysis.vaults.map(item=>item.id)},
    summary:copy(rendered.summary??analysis.analysis.summary??{}),formats:[...new Set(members.map(item=>item.format))],files:members});
   const file=await retainJSON(directory,'reports/'+row.id+'/report.json',metadata);
   return {...metadata,file};
  });
 }
 async function reportRead({reportId}){const current=await state(),row=requireRow(current,'reports',reportId);
  return {workspaceId:current.workspaceId,revision:current.revision,report:copy(row),record:row.file?await readRecord(directory,row):null};}
 async function reportFile({reportId,format='html',filename,offset=0,length=196608}){
  const current=await state(),row=requireRow(current,'reports',reportId);need(row.file,'REPORT_PENDING','The selected report is not yet complete.');
  const member=format==='manifest'?{file:row.file,filename:'report.json',contentType:'application/json'}:
   filename?row.files.find(item=>item.filename===filename):row.files.find(item=>item.format===format);
  need(member,'REPORT_FORMAT_NOT_FOUND','Choose a complete report member by format or file name.');
  const result=await files.sourceFileRange(directory,member.file,offset,length);
  return {...result,path:member.filename,bytes:member.file.bytes,sha256:member.file.sha256,contentType:member.contentType};
 }
 async function runtimes(){const selected=typeof runtimeSelections==='function'?await runtimeSelections():runtimeSelections;
  need(Array.isArray(selected),'INVALID_RUNTIME_SOURCE','Supply the trusted complete runtime selections.');return copy(selected);}
 async function close(){if(closed)return;await Promise.allSettled([...running]);closed=true;for(const entry of services.values())try{await(await entry).close?.();}catch{}}
 return Object.freeze({directory,describe,catalog,page,profileSave,periodSave,periodRead,vaultSave,vaultRead,
  acquisitionSave,acquisitionRead,acquisitionStart,acquisitionPause,acquisitionRun,
  operationPrepare,operationRead,operationRun,operationReconcile,operationPause,operationResume,operationCancel,operationCollect,
  sourceImport,sourceRead,sourceFile,incidentSave,incidentRead,correctionSave,correctionRead,
  analysisCreate,analysisRead,analysisFile,reportCreate,reportRead,reportFile,runtimeSelections:runtimes,readState:state,close});
}
