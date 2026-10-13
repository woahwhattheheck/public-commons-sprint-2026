// MIT. Source-owned Pollar partner configuration, complete original operations and customer outcomes.
import {promises as fs} from 'node:fs';
import {resolve,join} from 'node:path';
import {
 files,now,own,plain,clone,digest,canonical,jsonBytes,need,integer,text,identifier,selected,hash,
 privateDirectory,withLock,descriptor,publicError,randomUUID,sealed,verified,inside,
 SOURCE_SCHEMA,EDITION_SCHEMA,TABLES,readState,recoverState,initialize,intent,replay,revision,commitState,mutate,
 readDescriptor,readRecord,retainJSON,assertOriginalHistory,html,publicPayload,publicRuntimePin,publicConfiguration,
 TERMINAL_OPERATIONS,OPERATION_STATES
} from './common.mjs';
import {openPollarOperatorConnection} from './native.mjs';
import {POLLAR_BROWSER_ACTIONS,validatePollarArguments,publicPollarArguments} from './catalogue.mjs';

const PAGE_MAX=1000;
function copy(value){return clone(value);}
function pin(value){return value?publicRuntimePin(value):null;}
function cleanArgs(args){const result=copy(args);delete result.requestId;delete result.expectedRevision;return result;}
function outputRows(rows,{after,limit=100}={}){
 integer(limit,'limit',1,PAGE_MAX);
 let at=0;if(after){const id=identifier(after);at=rows.findIndex(item=>item.id===id)+1;need(at>0,'CURSOR_NOT_FOUND','The original page cursor is absent.');}
 const page=rows.slice(at,at+limit);
 return {rows:copy(page),nextCursor:at+page.length<rows.length?page.at(-1).id:null,total:rows.length};
}
function versionAt(row,version){
 need(row,'NOT_FOUND','The selected original record does not exist.');
 const number=version??row.currentVersion;integer(number,'version',1);
 const found=row.versions.find(item=>item.version===number);
 need(found,'VERSION_NOT_FOUND','The original saved version is absent.');return found;
}
function appVersion(state,id,version){
 const row=state.applications[identifier(id)],v=versionAt(row,version);
 return {row,version:v};
}
function findOperation(state,id){
 const row=state.operations[identifier(id)];need(row,'NOT_FOUND','The original operation does not exist.');return row;
}
function ordered(rows){return Object.values(rows).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??'')||a.id.localeCompare(b.id));}
function operationResult(row){return {operation:copy(row)};}
function requestIntent(args){const value=cleanArgs(args);delete value.expectedRevision;return digest(jsonBytes(value));}
function knownState(state){need(OPERATION_STATES.has(state),'INVALID_NATIVE_OUTCOME','The native operation outcome is invalid.');return state;}
function bodyBytes(response){
 if(response?.bodyBase64===undefined)return null;
 need(typeof response.bodyBase64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.bodyBase64),
  'INVALID_NATIVE_SOURCE','The original response bytes must be canonical base64.');
 const bytes=Buffer.from(response.bodyBase64,'base64');
 need(bytes.toString('base64')===response.bodyBase64,'INVALID_NATIVE_SOURCE','The original response encoding differs.');return bytes;
}
function catalogueRows(value){
 const rows=Array.isArray(value)?value:Array.isArray(value?.actions)?value.actions:Array.isArray(value?.methods)?value.methods:[];
 return rows.map(row=>typeof row==='string'?{action:row}:copy(row));
}
function actionName(row){return row.action??row.name??row.id;}
function validateSchema(schema,value,path='arguments'){
 if(!schema)return;
 if(schema.anyOf){need(schema.anyOf.some(branch=>{try{validateSchema(branch,value,path);return true;}catch{return false;}}),
  'INVALID_ARGUMENT',path+' does not match the original action input.');return;}
 if(schema.enum)need(schema.enum.some(item=>canonical(item)===canonical(value)),'INVALID_ARGUMENT',path+' is not one of the original supported choices.');
 if(schema.type){const types=Array.isArray(schema.type)?schema.type:[schema.type];need(types.some(type=>
  type==='null'?value===null:type==='object'?plain(value):type==='array'?Array.isArray(value):
  type==='integer'?Number.isSafeInteger(value):typeof value===type),'INVALID_ARGUMENT',path+' has a different original input type.');}
 if(plain(value)){for(const key of schema.required??[])need(own(value,key),'INVALID_ARGUMENT',path+'.'+key+' is required.');
  for(const [key,item]of Object.entries(value)){if(schema.additionalProperties===false)need(own(schema.properties??{},key),'INVALID_ARGUMENT',path+'.'+key+' is not declared.');
   if(schema.properties?.[key])validateSchema(schema.properties[key],item,path+'.'+key);}}
 if(Array.isArray(value)&&schema.items)value.forEach((item,index)=>validateSchema(schema.items,item,path+'['+index+']'));
 if(typeof value==='string'){if(schema.minLength!==undefined)need(value.length>=schema.minLength,'INVALID_ARGUMENT',path+' is too short.');
  if(schema.maxLength!==undefined)need(value.length<=schema.maxLength,'INVALID_ARGUMENT',path+' is too long.');
  if(schema.pattern)need(new RegExp(schema.pattern).test(value),'INVALID_ARGUMENT',path+' does not match the original format.');}
 if(typeof value==='number'){if(schema.minimum!==undefined)need(value>=schema.minimum,'INVALID_ARGUMENT',path+' is below the supported minimum.');
  if(schema.maximum!==undefined)need(value<=schema.maximum,'INVALID_ARGUMENT',path+' is above the supported maximum.');}
}
function profileInput(value){
 need(plain(value),'INVALID_PROFILE','Supply a complete workspace profile.');publicPayload(value);
 if(value.name!==undefined)text(value.name,'workspace name',256);return copy(value);
}
function intentPrivateFields(value){
 publicPayload(value);
 need(plain(value),'INVALID_ARGUMENT','Supply an original JSON argument object.');return copy(value);
}
function sourcePublicRequest(request){
 publicPayload(request);return copy(request);
}
function csv(rows,columns){
 const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
 return columns.map(cell).join(',')+'\r\n'+rows.map(row=>columns.map(key=>cell(typeof row[key]==='object'?JSON.stringify(row[key]):row[key])).join(',')).join('\r\n')+'\r\n';
}
export async function inspectPollarPartnerWorkspace({directory,allowMissing=false}){
 const root=resolve(directory);
 try{const state=await readState(root);return {...state,counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(state[table]).length]))};}
 catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openPollarPartnerWorkspace({directory,connections={},profile={},browserCatalogue=POLLAR_BROWSER_ACTIONS,runtimeSelections=[]}={}){
 need(typeof directory==='string'&&directory.length>0,'WORKSPACE_REQUIRED','Select the original partner workspace directory.');
 directory=resolve(directory);await initialize(directory,profileInput(profile));
 need(plain(connections),'INVALID_CONNECTION','Supply the private named connection map.');
 const services=new Map(),running=new Set();let closed=false;
 async function service(name){
  text(name,'private connection alias',160);need(own(connections,name),'CONNECTION_NOT_FOUND','The selected private connection is not attached.',{connection:name});
  if(!services.has(name))services.set(name,Promise.resolve(openPollarOperatorConnection({connection:connections[name]})));
  return services.get(name);
 }
 async function state(){need(!closed,'WORKSPACE_CLOSED','The partner workspace is closed.');
  return withLock(directory,'writer.lock',async()=>{await recoverState(directory);return readState(directory);});}
 async function describe(){
  const current=await state(),rows={};for(const table of TABLES)rows[table]=ordered(current[table]).slice(-100).reverse();
  const attached=[];
  for(const name of Object.keys(connections).sort()){
   try{const connection=await service(name);attached.push({alias:name,...copy(await connection.describe())});}
   catch(error){attached.push({alias:name,error:publicError(error)});}
  }
  return {schema:current.schema,workspaceId:current.workspaceId,revision:current.revision,head:current.head,
   profile:copy(current.profile),counts:Object.fromEntries(TABLES.map(table=>[table,Object.keys(current[table]).length])),
   ...rows,connections:attached};
 }
 async function catalog({connection}={}){
  if(connection){const original=await service(connection);return {connection,actions:catalogueRows(await original.catalog())};}
  return {browser:catalogueRows(browserCatalogue),connections:await Promise.all(Object.keys(connections).sort().map(async alias=>{
   try{return {alias,actions:catalogueRows(await (await service(alias)).catalog())};}catch(error){return {alias,error:publicError(error)};}
  }))};
 }
 async function profileSave(args){return mutate(directory,'profile.save',args,async next=>{next.profile={...next.profile,...profileInput(args.profile)};return {profile:copy(next.profile)};});}
 async function applicationSave(args){
  const configuration=publicConfiguration(args.configuration),name=text(args.name,'partner application name',256),runtime=pin(args.runtime);
  need(!configuration.runtimeId||runtime?.id===configuration.runtimeId,'RUNTIME_SOURCE_CHANGED','The original application runtime identity differs.');
  need(!configuration.runtimeManifestSha256||runtime?.manifestSha256===configuration.runtimeManifestSha256,'RUNTIME_SOURCE_CHANGED','The original application runtime manifest differs.');
  return mutate(directory,'application.save',args,async next=>{
   const id=args.applicationId?identifier(args.applicationId):randomUUID(),existing=next.applications[id];
   if(existing)need(existing.originalApplicationId===configuration.applicationId&&existing.network===configuration.stellarNetwork,
    'APPLICATION_IDENTITY_CHANGED','A saved application keeps its original provider identity and network.');
   const number=(existing?.currentVersion??0)+1,at=now();
   const version=sealed({id:randomUUID(),applicationId:id,version:number,name,configuration,runtime,createdAt:at});
   const row=existing??{id,originalApplicationId:configuration.applicationId,network:configuration.stellarNetwork,createdAt:at,versions:[]};
   row.currentVersion=number;row.name=name;row.updatedAt=at;row.versions.push(version);next.applications[id]=row;
   return {application:copy(row),version:copy(version)};
  });
 }
 async function applicationRead({applicationId,version}){const current=await state(),found=appVersion(current,applicationId,version);
  return {workspaceId:current.workspaceId,revision:current.revision,application:copy(found.row),version:copy(found.version)};}
 async function page({table,after,limit,applicationId,participantId,status}={}){
  need(TABLES.includes(table),'INVALID_TABLE','Select a retained partner workspace table.');
  const current=await state();let rows=ordered(current[table]);
  if(applicationId)rows=rows.filter(row=>row.applicationId===applicationId||table==='applications'&&row.id===applicationId);
  if(participantId)rows=rows.filter(row=>row.participantId===participantId||table==='participants'&&row.id===participantId);
  if(status)rows=rows.filter(row=>row.status===status||row.state===status);
  return {workspaceId:current.workspaceId,revision:current.revision,...outputRows(rows,{after,limit})};
 }
 async function participantVerify(args,{accessToken}={}){
  text(accessToken,'original ephemeral SDK access token',32768);
  const before=await state(),app=appVersion(before,args.applicationId,args.applicationVersion);
  const original=await service(args.connection);
  const observation=await original.verifySession({accessToken,signal:args.signal});
  const raw=observation?.response?.bodyBase64?JSON.parse(Buffer.from(observation.response.bodyBase64,'base64').toString('utf8')):null;
  const verifiedUser=observation.content??observation.result?.content??observation.result??observation.verification??raw?.content;
  need(plain(verifiedUser)&&typeof verifiedUser.userId==='string','SESSION_NOT_VERIFIED','The original provider did not verify this SDK user.');
  need(verifiedUser.applicationId===app.version.configuration.applicationId&&verifiedUser.network===app.version.configuration.stellarNetwork,
   'SESSION_APPLICATION_MISMATCH','The original session belongs to a different application or network.');
  publicPayload(verifiedUser);
  const keep={...args};delete keep.signal;
  return mutate(directory,'participant.verify',keep,async next=>{
   const fixed=appVersion(next,args.applicationId,args.applicationVersion);
   need(fixed.version.sha256===app.version.sha256,'APPLICATION_SOURCE_CHANGED','The application selection changed during verification.');
   const found=Object.values(next.participants).find(row=>row.applicationId===args.applicationId&&row.userId===verifiedUser.userId);
   const id=found?.id??randomUUID(),sourceId=randomUUID();
   const proof={schema:SOURCE_SCHEMA,id:sourceId,kind:'session.verification',applicationId:args.applicationId,
    applicationVersion:app.version.version,participantId:id,at:now(),request:sourcePublicRequest(observation.request??{method:'POST',path:'/v1/tokens/verify',token:'[redacted]'}),
    response:copy(observation.response??null),verification:copy(verifiedUser)};
   const record=await retainJSON(directory,'sources/'+sourceId+'/source.json',proof);
   next.sources[sourceId]={id:sourceId,kind:proof.kind,applicationId:args.applicationId,participantId:id,createdAt:proof.at,file:record};
   const participant={...(found??{id,applicationId:args.applicationId,userId:verifiedUser.userId,createdAt:proof.at}),
    applicationVersion:app.version.version,network:verifiedUser.network,verification:copy(verifiedUser),
    verificationSourceId:sourceId,verifiedAt:proof.at,updatedAt:proof.at};
   next.participants[id]=participant;return {participant:copy(participant),source:copy(next.sources[sourceId])};
  });
 }
 async function operationPrepare(args){
  need(['native','browser'].includes(args.mode),'INVALID_MODE','Select original browser SDK or operator connection.');
  const current=await state(),prior=replay(current,'operation.prepare',args);if(prior)return prior;
  revision(current,args);
  const app=appVersion(current,args.applicationId,args.applicationVersion);
  text(args.action,'original action',160);const input=intentPrivateFields(args.args??{});
  let request=null,action=null;
  if(args.mode==='native'){
   const original=await service(args.connection),rows=catalogueRows(await original.catalog());
   action=rows.find(row=>actionName(row)===args.action);need(action,'ACTION_NOT_FOUND','The original connection does not declare this action.');
   validateSchema(action.inputSchema,input);request=sourcePublicRequest(await original.prepare({action:args.action,args:input}));
   const originalId=app.version.configuration.applicationId,network=app.version.configuration.stellarNetwork;
   if(request.connection?.applicationId!==undefined&&request.connection.applicationId!==null)
    need(request.connection.applicationId===originalId,'APPLICATION_SCOPE_MISMATCH','The original connection belongs to another selected application.');
   if(request.connection?.network!==undefined&&request.connection.network!==null)
    need(request.connection.network===network,'APPLICATION_SCOPE_MISMATCH','The original connection belongs to another selected network.');
   if(args.action.startsWith('mcp.')&&typeof request.args?.id==='string')
    need(request.args.id===originalId,'APPLICATION_SCOPE_MISMATCH','The original scoped MCP request identifies another selected application.');
  }else{
   action=catalogueRows(browserCatalogue).find(row=>actionName(row)===args.action);
   need(action,'ACTION_NOT_FOUND','The original browser SDK does not declare this action.');
   // Authentication secrets stay in the original browser SDK. Its public
   // operation input can omit ephemeral fields declared by the native bridge.
   if(!(action.sensitiveInputs?.length))validatePollarArguments(args.action,input,{surface:'browser'});
  }
  return mutate(directory,'operation.prepare',args,async next=>{
   const selected=appVersion(next,args.applicationId,args.applicationVersion);
   need(selected.version.sha256===app.version.sha256,'APPLICATION_SOURCE_CHANGED','The selected application version changed.');
   if(args.participantId){const participant=next.participants[identifier(args.participantId)];
    need(participant?.applicationId===args.applicationId,'PARTICIPANT_SCOPE_MISMATCH','Select a verified participant from this application.');}
   const id=randomUUID(),at=now(),runtime=pin(args.runtime??app.version.runtime);
   const row={id,applicationId:args.applicationId,applicationVersion:app.version.version,applicationSha256:app.version.sha256,
    originalApplicationId:app.version.configuration.applicationId,network:app.version.configuration.stellarNetwork,
    participantId:args.participantId??null,mode:args.mode,connection:args.mode==='native'?args.connection:null,
    action:args.action,args:input,catalogue:copy(action),request,requestSha256:request?digest(jsonBytes(request)):null,
    runtime,state:'PREPARED',paused:false,createdAt:at,updatedAt:at,attemptIds:[],sourceIds:[],outcomes:[],providerIds:{},
    createdByRequestId:args.requestId,nextRequest:null,pagination:null,execution:null};
   next.operations[id]=row;return operationResult(row);
  });
 }
 async function operationRead({operationId}){const current=await state();return {workspaceId:current.workspaceId,revision:current.revision,operation:copy(findOperation(current,operationId))};}
 async function retainOutcome(operation,attempt,outcome){
  need(plain(outcome)&&plain(outcome.outcome),'INVALID_NATIVE_OUTCOME','The original adapter must return its complete outcome.');
  knownState(outcome.outcome.state);const sourceId=attempt.sourceId;
  const request=sourcePublicRequest(outcome.request??attempt.request),response=copy(outcome.response??null);
  const bytes=bodyBytes(response);let body=null;
  if(bytes){body=await files.writeNew(directory,'sources/'+sourceId+'/response.bin',bytes);
   delete response.bodyBase64;response.body=body;}
  const source=sealed({schema:SOURCE_SCHEMA,id:sourceId,operationId:operation.id,attemptId:attempt.id,
   applicationId:operation.applicationId,participantId:operation.participantId,kind:operation.action,
   runtime:operation.runtime,createdAt:attempt.startedAt,request,response,outcome:copy(outcome.outcome),
   pagination:copy(outcome.pagination??null),selection:copy(outcome.selection??null),observations:copy(outcome.observations??null)});
  const file=await retainJSON(directory,'sources/'+sourceId+'/source.json',source);
  return {id:sourceId,operationId:operation.id,attemptId:attempt.id,applicationId:operation.applicationId,
   participantId:operation.participantId,createdAt:attempt.startedAt,kind:operation.action,runtime:operation.runtime,file,
   body:body??null,outcome:copy(outcome.outcome),pagination:copy(outcome.pagination??null)};
 }
 async function retainedOutcome(source){
  const value=await readRecord(directory,source);verified(value,'Original operation source');
  const response=copy(value.response);
  if(response?.body){response.bodyBase64=(await readDescriptor(directory,response.body)).toString('base64');delete response.body;}
  return {request:copy(value.request),response,outcome:copy(value.outcome),pagination:copy(value.pagination),
   selection:copy(value.selection),observations:copy(value.observations)};
 }
 async function finishAttempt(args,attempt,source,fullOutcome,{reconcile=false}={}){
  return withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),operation=findOperation(before,args.operationId);
   const completed=replay(before,reconcile?'operation.reconcile':'operation.run',args);if(completed)return completed;
   const after=copy(before),row=after.operations[operation.id],original=after.attempts[attempt.id];
   need(original?.requestSha256===attempt.requestSha256,'OPERATION_SOURCE_CHANGED','The original attempt selection changed.');
   after.sources[source.id]=source;
   if(!row.sourceIds.includes(source.id))row.sourceIds.push(source.id);
   original.sourceId=source.id;original.finishedAt=now();original.state=fullOutcome.outcome.state;original.outcome=copy(fullOutcome.outcome);
   row.state=knownState(fullOutcome.outcome.state);row.updatedAt=original.finishedAt;
   row.providerIds={...row.providerIds,...copy(fullOutcome.outcome.providerIds??fullOutcome.selection?.providerIds??{})};
   row.outcomes.push({attemptId:attempt.id,sourceId:source.id,at:original.finishedAt,...copy(fullOutcome.outcome)});
   row.pagination=copy(fullOutcome.pagination??null);row.nextRequest=copy(fullOutcome.pagination?.nextRequest??null);
   if(row.nextRequest)sourcePublicRequest(row.nextRequest);
   row.lastSourceId=source.id;row.lastError=fullOutcome.outcome.error??null;
   if(row.execution){row.execution.completedAttemptIds??=[];if(!row.execution.completedAttemptIds.includes(attempt.id))row.execution.completedAttemptIds.push(attempt.id);}
   const operationName=reconcile?'operation.reconcile':'operation.run';
   const result=await commitState(directory,before,after,operationName,args,operationResult(row));
   return result;
  });
 }
 async function dispatchOne(args,{reconcile=false,signal}={}){
  identifier(args.operationId);intent(reconcile?'operation.reconcile':'operation.run',args);
  return withLock(directory,'operation-'+args.operationId+'.lock',async()=>{
   let current=await state(),operation=findOperation(current,args.operationId);
   const method=reconcile?'operation.reconcile':'operation.run',prior=replay(current,method,args);if(prior)return prior;
   need(operation.mode==='native','BROWSER_OPERATION','Resume this original operation in the customer browser.');
   let attempt=operation.attemptIds.map(id=>current.attempts[id]).find(row=>row.requestId===args.requestId);
   if(attempt){
    need(attempt.intentSha256===requestIntent(args),'REQUEST_ID_CONFLICT','This attempt request names different arguments.');
    try{
     const saved=await files.readJSON(directory,'attempts/'+attempt.id+'/outcome.json');
     const source=await retainOutcome(operation,attempt,saved);
     return finishAttempt(args,attempt,source,saved,{reconcile:method==='operation.reconcile'});
    }catch(error){if(error.code!=='ENOENT')throw error;}
    try{
     const file=await files.readJSON(directory,'sources/'+attempt.sourceId+'/source.json');
     const source={id:file.id,file:await descriptor(directory,'sources/'+file.id+'/source.json','application/json'),
      operationId:file.operationId,attemptId:file.attemptId,applicationId:file.applicationId,participantId:file.participantId,
      createdAt:file.createdAt,kind:file.kind,runtime:file.runtime,body:file.response?.body??null,
      outcome:file.outcome,pagination:file.pagination};
     const full=await retainedOutcome(source);return finishAttempt(args,attempt,source,full,{reconcile});
    }catch(error){if(error.code!=='ENOENT')throw error;}
    // This attempt crossed the retained dispatch boundary; only the original
    // provider reconciliation may determine an uncertain mutation's outcome.
    reconcile=true;
   }else{
    revision(current,args);need(!operation.paused,'OPERATION_PAUSED','Resume the retained operation before running.');
    if(!reconcile)need(operation.state==='PREPARED'||Boolean(operation.nextRequest)&&operation.state==='COMPLETE',
     'OUTCOME_RECONCILIATION_REQUIRED','Reconcile the original pending or uncertain operation before another dispatch.');
    const after=copy(current),row=after.operations[operation.id],at=now();
    const previousAttempts=[...operation.attemptIds].reverse().map(id=>current.attempts[id]);
    const unresolved=previousAttempts.find(item=>!TERMINAL_OPERATIONS.has(item.state));
    const request=copy(reconcile?(unresolved?.request??previousAttempts[0]?.request??operation.request):(operation.nextRequest??operation.request));
    attempt={id:randomUUID(),sourceId:randomUUID(),operationId:row.id,applicationId:row.applicationId,
     requestId:args.requestId,intentSha256:requestIntent(args),kind:reconcile?'reconcile':'dispatch',
     request,requestSha256:digest(jsonBytes(request)),state:'RUNNING',startedAt:at,finishedAt:null};
    after.attempts[attempt.id]=attempt;row.attemptIds.push(attempt.id);row.state='RUNNING';row.updatedAt=at;
    await commitState(directory,current,after,method,args,operationResult(row),{recordRequest:false});
    current=after;operation=row;
   }
   const original=await service(operation.connection);let outcome;
   try{
    if(reconcile)outcome=await original.reconcile({operation:{...copy(operation),attempt:copy(attempt),
      sources:await Promise.all(operation.sourceIds.map(id=>retainedOutcome(current.sources[id])))},signal});
    else outcome=await original.perform({request:copy(attempt.request),signal});
   }catch(error){
    outcome={request:copy(attempt.request),response:null,outcome:{state:'UNCERTAIN',error:publicError(error)},
     observations:Array.isArray(error.observations)?copy(error.observations):null};
   }
   const ephemeral=outcome.ephemeral;outcome={...outcome};delete outcome.ephemeral;
   await retainJSON(directory,'attempts/'+attempt.id+'/outcome.json',outcome);
   const source=await retainOutcome(operation,attempt,outcome);
   // An original run whose response was lost is acknowledged under its initial
   // method/request, even when native reconciliation performed the recovery.
   const completed=await finishAttempt(args,attempt,source,outcome,{reconcile:method==='operation.reconcile'});
   return ephemeral===undefined?completed:{...completed,ephemeral};
  });
 }
 async function operationRun(args,options={}){const promise=dispatchOne(args,options);running.add(promise);try{return await promise;}finally{running.delete(promise);}}
 async function operationReconcile(args,options={}){const promise=dispatchOne(args,{...options,reconcile:true});running.add(promise);try{return await promise;}finally{running.delete(promise);}}
 async function operationPause(args){return mutate(directory,'operation.pause',args,async next=>{const row=findOperation(next,args.operationId);row.paused=true;row.updatedAt=now();return operationResult(row);});}
 async function operationResume(args){return mutate(directory,'operation.resume',args,async next=>{const row=findOperation(next,args.operationId);
  row.paused=false;row.updatedAt=now();return operationResult(row);});}
 async function operationCancel(args){return mutate(directory,'operation.cancel',args,async next=>{const row=findOperation(next,args.operationId);
  need(row.state==='PREPARED'&&row.attemptIds.length===0,'OUTCOME_RECONCILIATION_REQUIRED','A dispatched provider operation must be reconciled before changing its outcome.');
  row.paused=true;row.state='CANCELED';row.updatedAt=now();return operationResult(row);});}

 async function browserStart(args){
  return mutate(directory,'browser.start',args,async next=>{
   const row=findOperation(next,args.operationId);need(row.mode==='browser','INVALID_MODE','Select an original browser operation.');
   need(!row.paused,'OPERATION_PAUSED','Resume this original browser operation before continuing.');
   need(row.state==='PREPARED','OUTCOME_RECONCILIATION_REQUIRED','Reconcile the browser operation already dispatched.');
   const at=now(),attempt={id:randomUUID(),operationId:row.id,applicationId:row.applicationId,requestId:args.requestId,
    intentSha256:requestIntent(args),kind:'browser',request:{action:row.action,args:copy(row.args),operationId:row.id},
    state:'RUNNING',startedAt:at,sourceId:null,finishedAt:null};
   attempt.requestSha256=digest(jsonBytes(attempt.request));next.attempts[attempt.id]=attempt;
   row.attemptIds.push(attempt.id);row.state='RUNNING';row.updatedAt=at;
   return {operation:copy(row),attempt:copy(attempt)};
  });
 }
 async function browserOutcome(args){
  const outcome=copy(args.outcome);need(plain(outcome),'INVALID_NATIVE_OUTCOME','Supply the complete original SDK outcome.');
  need(outcome.operationId===args.operationId,'OPERATION_IDENTITY_MISMATCH','The browser outcome belongs to another original operation.');
  knownState(outcome.state);publicPayload(outcome);
  return mutate(directory,'browser.outcome',args,async next=>{
   const row=findOperation(next,args.operationId);need(row.mode==='browser'&&row.action===outcome.action,'OPERATION_IDENTITY_MISMATCH','The original browser action differs.');
   const attempt=next.attempts[identifier(args.attemptId)];
   need(attempt?.operationId===row.id&&attempt.kind==='browser','OPERATION_IDENTITY_MISMATCH','Select the original browser dispatch attempt.');
   const outcomeHash=digest(jsonBytes(outcome));
   const previous=row.outcomes.find(item=>item.attemptId===attempt.id&&item.sha256===outcomeHash);
   if(previous)return {operation:copy(row),source:copy(next.sources[previous.sourceId]),identicalObservation:true};
   const sourceId=randomUUID(),at=now();
   const record=sealed({schema:SOURCE_SCHEMA,id:sourceId,operationId:row.id,attemptId:attempt.id,
    applicationId:row.applicationId,participantId:row.participantId,kind:row.action,
    runtime:row.runtime,createdAt:at,provenance:'original-browser-sdk-observation',
    request:copy(attempt.request),response:{result:copy(outcome.result??null)},
    outcome:copy(outcome),observations:copy(outcome.observations??null)});
   const file=await retainJSON(directory,'sources/'+sourceId+'/source.json',record);
   const source={id:sourceId,operationId:row.id,attemptId:attempt.id,applicationId:row.applicationId,
    participantId:row.participantId,createdAt:at,kind:row.action,runtime:row.runtime,file};
   next.sources[sourceId]=source;row.sourceIds.push(sourceId);row.lastSourceId=sourceId;
   row.outcomes.push({attemptId:attempt.id,sourceId,sha256:outcomeHash,at,state:outcome.state,providerIds:copy(outcome.providerIds??{})});
   row.providerIds={...row.providerIds,...copy(outcome.providerIds??{})};row.state=outcome.state;row.updatedAt=at;
   attempt.state=outcome.state;attempt.sourceId=sourceId;attempt.finishedAt=TERMINAL_OPERATIONS.has(outcome.state)?at:null;
   return {operation:copy(row),source:copy(source)};
  });
 }
 async function browserObserved(args){
  // After native session verification, retain a login that completed before a
  // customer host session existed. Original local IDs and public body survive.
  const input=intentPrivateFields(args.args??{}),outcome=copy(args.outcome);
  identifier(args.operationId);need(outcome?.operationId===args.operationId&&outcome.action===args.action,
   'OPERATION_IDENTITY_MISMATCH','The observed SDK result differs from the original local action.');
  knownState(outcome.state);publicPayload(outcome);
  const action=catalogueRows(browserCatalogue).find(row=>actionName(row)===args.action);
  need(action?.category==='auth'||action?.resultKind==='auth-state','INVALID_OBSERVATION','Use this receiving route for original onboarding observations.');
  return mutate(directory,'browser.observed',args,async next=>{
   const app=appVersion(next,args.applicationId,args.applicationVersion),participant=next.participants[identifier(args.participantId)];
   need(participant?.applicationId===args.applicationId,'PARTICIPANT_SCOPE_MISMATCH','Select the actual verified application participant.');
   const existing=next.operations[args.operationId];
   if(existing){need(existing.mode==='browser'&&existing.action===args.action&&existing.participantId===args.participantId&&
     canonical(existing.args)===canonical(input),'OPERATION_IDENTITY_MISMATCH','The original local operation ID is already bound differently.');
    return operationResult(existing);}
   const at=now(),sourceId=randomUUID(),attemptId=randomUUID(),runtime=pin(args.runtime??app.version.runtime);
   const attempt={id:attemptId,operationId:args.operationId,applicationId:args.applicationId,requestId:args.requestId,kind:'browser',
    startedAt:args.startedAt??at,finishedAt:TERMINAL_OPERATIONS.has(outcome.state)?at:null,state:outcome.state,sourceId,
    request:{action:args.action,args:input,operationId:args.operationId}};
   attempt.requestSha256=digest(jsonBytes(attempt.request));
   const record=sealed({schema:SOURCE_SCHEMA,id:sourceId,kind:args.action,operationId:args.operationId,attemptId,
    applicationId:args.applicationId,participantId:args.participantId,runtime,createdAt:at,provenance:'original-browser-onboarding-observation',
    request:copy(attempt.request),response:{result:copy(outcome.result??null)},outcome,observations:copy(outcome.observations??null)});
   const file=await retainJSON(directory,'sources/'+sourceId+'/source.json',record);
   next.sources[sourceId]={id:sourceId,kind:args.action,operationId:args.operationId,attemptId,applicationId:args.applicationId,
    participantId:args.participantId,runtime,createdAt:at,file};next.attempts[attemptId]=attempt;
   const row={id:args.operationId,applicationId:args.applicationId,applicationVersion:app.version.version,
    applicationSha256:app.version.sha256,originalApplicationId:app.version.configuration.applicationId,network:app.version.configuration.stellarNetwork,
    participantId:args.participantId,mode:'browser',connection:null,action:args.action,args:input,catalogue:copy(action),runtime,
    state:outcome.state,paused:false,createdAt:attempt.startedAt,updatedAt:at,attemptIds:[attemptId],sourceIds:[sourceId],
    outcomes:[{attemptId,sourceId,at,state:outcome.state,sha256:digest(jsonBytes(outcome))}],providerIds:copy(outcome.providerIds??{}),
    createdByRequestId:args.requestId,lastSourceId:sourceId};
   next.operations[row.id]=row;return operationResult(row);
  });
 }
 async function operationCollect(args,{signal}={}){
  identifier(args.operationId);if(args.maxPages!==undefined&&args.maxPages!==null)integer(args.maxPages,'maxPages',1,Number.MAX_SAFE_INTEGER);
  const work=withLock(directory,'collection-'+args.operationId+'.lock',async()=>{
   await mutate(directory,'operation.collect.prepare',args,async next=>{
    const row=findOperation(next,args.operationId);need(row.mode==='native','INVALID_MODE','Use the original browser history collector for browser operations.');
    need(row.catalogue.mode==='read'||row.catalogue.mutates===false,'COLLECTION_READ_REQUIRED','Complete paging is available for original read operations.');
    need(!row.paused,'OPERATION_PAUSED','Resume the selected original operation.');
    if(row.execution&&!['COMPLETE','CANCELED'].includes(row.execution.state)){
     need(row.execution.requestId===args.requestId&&canonical(row.execution.args)===canonical(cleanArgs(args)),
      'OPERATION_RUNNING','Continue the original complete-page execution and its frozen arguments.',{requestId:row.execution.requestId});
    }else row.execution={requestId:args.requestId,args:cleanArgs(args),state:'RUNNING',childRequests:[],completedAttemptIds:[],createdAt:now()};
    return operationResult(row);
   });
   let reason=null;
   while(!signal?.aborted){
    const current=await state(),operation=findOperation(current,args.operationId),execution=operation.execution;
    need(execution?.requestId===args.requestId&&canonical(execution.args)===canonical(cleanArgs(args)),
     'OPERATION_SOURCE_CHANGED','The original page execution differs.');
    if(operation.paused){reason='operator-paused';break;}
    if(['PENDING','UNCERTAIN','FAILED'].includes(operation.state)){reason='original-outcome-awaiting-reconciliation';break;}
    if(args.maxPages!==undefined&&args.maxPages!==null&&execution.childRequests.length>=args.maxPages){reason='selected-page-limit';break;}
    if(operation.state==='COMPLETE'&&!operation.nextRequest){reason='provider-complete';break;}
    let child=execution.childRequests.at(-1);
    if(!child||current.requests[child]){
     const request=randomUUID(),dispatchId=randomUUID();
     await mutate(directory,'operation.collect.next',{requestId:request,expectedRevision:current.revision,operationId:operation.id},async next=>{
      const selected=next.operations[operation.id].execution;
      need(selected.requestId===args.requestId,'OPERATION_SOURCE_CHANGED','The original collector changed.');
      selected.childRequests.push(dispatchId);selected.state='RUNNING';return operationResult(next.operations[operation.id]);
     });
     child=dispatchId;
    }
    const fresh=await state();
    await operationRun({requestId:child,expectedRevision:fresh.revision,operationId:operation.id},{signal});
   }
   if(signal?.aborted)reason='host-stopped';
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),operation=findOperation(before,args.operationId);
    need(operation.execution?.requestId===args.requestId,'OPERATION_SOURCE_CHANGED','The original collector changed.');
    const done=operation.state==='COMPLETE'&&!operation.nextRequest,executionState=done||reason==='selected-page-limit'?'COMPLETE':'PAUSED';
    const after=copy(before),row=after.operations[operation.id];
    row.execution.state=executionState;row.execution.reason=done?'provider-complete':reason;
    row.execution.updatedAt=now();if(executionState==='COMPLETE')row.execution.completedAt=row.execution.updatedAt;
    const result=await commitState(directory,before,after,'operation.collect.checkpoint',
     {requestId:randomUUID(),expectedRevision:before.revision,operationId:operation.id,originalRequestId:args.requestId},
     {operation:copy(row),complete:done,continuation:{requestId:args.requestId,operationId:args.operationId,...(args.maxPages!==undefined?{maxPages:args.maxPages}:{})}});
    return result;
   });
  });
  running.add(work);try{return await work;}finally{running.delete(work);}
 }
 async function sourceRead({sourceId}){
  const current=await state(),source=current.sources[identifier(sourceId)];need(source,'NOT_FOUND','The retained source is absent.');
  return {workspaceId:current.workspaceId,revision:current.revision,source:copy(source),record:await readRecord(directory,source)};
 }
 async function sourceFile({sourceId,part='source',offset=0,length=196608}){
  const current=await state(),source=current.sources[identifier(sourceId)];need(source,'NOT_FOUND','The retained source is absent.');
  const file=part==='source'?source.file:part==='response'?source.body:null;
  need(file,'SOURCE_PART_NOT_FOUND','Choose an original source or response file.');
  integer(offset,'offset',0);integer(length,'length',1,4*1024*1024);
  const result=await files.sourceFileRange(directory,file,offset,length);
  return {...result,path:file.path,bytes:file.bytes,sha256:file.sha256,contentType:part==='source'?'application/json':'application/octet-stream'};
 }
 async function snapshotCreate(args){
  const name=text(args.name,'snapshot name',256);
  return mutate(directory,'snapshot.create',args,async next=>{
   const app=appVersion(next,args.applicationId,args.applicationVersion);
   const ids=args.operationIds??Object.values(next.operations).filter(row=>row.applicationId===args.applicationId&&
    (!args.participantId||row.participantId===args.participantId)).map(row=>row.id);
   need(Array.isArray(ids),'INVALID_SELECTION','Select the complete original operations.');
   const rows=[...new Set(ids)].map(id=>findOperation(next,id));
   need(rows.every(row=>row.applicationId===args.applicationId&&(!args.participantId||row.participantId===args.participantId)),
    'SNAPSHOT_SCOPE_MISMATCH','The selected operations cross the chosen original application or participant.');
   const sourceIds=[...new Set(rows.flatMap(row=>row.sourceIds))],sources=[];
   for(const id of sourceIds){const retained=next.sources[id];need(retained,'SOURCE_REQUIRED','An operation source is missing.');sources.push({source:copy(retained),record:await readRecord(directory,retained)});}
   const id=randomUUID(),at=now();
   const payload=sealed({schema:EDITION_SCHEMA,id,name,applicationId:args.applicationId,applicationVersion:app.version.version,
    applicationSha256:app.version.sha256,originalApplicationId:app.version.configuration.applicationId,network:app.version.configuration.stellarNetwork,
    participantId:args.participantId??null,createdAt:at,sourceWorkspaceId:next.workspaceId,sourceRevision:next.revision,
    application:copy(app.version),participants:ordered(next.participants).filter(row=>row.applicationId===args.applicationId&&
      (!args.participantId||row.id===args.participantId)),operations:copy(rows),
    attempts:rows.flatMap(row=>row.attemptIds).map(id=>copy(next.attempts[id])),sources,
    decisions:ordered(next.decisions).filter(row=>row.applicationId===args.applicationId&&(!args.participantId||row.participantId===args.participantId))});
   const file=await retainJSON(directory,'snapshots/'+id+'/snapshot.json',payload);
   const snapshot={id,name,applicationId:args.applicationId,applicationVersion:app.version.version,participantId:args.participantId??null,
    createdAt:at,operationIds:rows.map(row=>row.id),sourceIds,file,sha256:payload.sha256,
    runtime:app.version.runtime??null,counts:{operations:rows.length,sources:sourceIds.length,
     pending:rows.filter(row=>!TERMINAL_OPERATIONS.has(row.state)).length}};
   next.snapshots[id]=snapshot;return {snapshot:copy(snapshot)};
  });
 }
 async function snapshotRead({snapshotId}){const current=await state(),row=current.snapshots[identifier(snapshotId)];need(row,'NOT_FOUND','The selected snapshot is absent.');
  return {workspaceId:current.workspaceId,revision:current.revision,snapshot:copy(row),record:await readRecord(directory,row)};}
 async function decisionSave(args){return mutate(directory,'decision.save',args,async next=>{
  appVersion(next,args.applicationId);if(args.operationId)need(findOperation(next,args.operationId).applicationId===args.applicationId,'DECISION_SCOPE_MISMATCH','The decision crosses applications.');
  const row=sealed({id:randomUUID(),applicationId:args.applicationId,participantId:args.participantId??null,
   operationId:args.operationId??null,decision:text(args.decision,'decision',160),note:args.note===undefined?'':text(args.note,'note',20000),createdAt:now()});
  row.file=await retainJSON(directory,'decisions/'+row.id+'/decision.json',row);next.decisions[row.id]=row;return {decision:copy(row)};
 });}
 async function reportCreate(args){
  return mutate(directory,'report.create',args,async next=>{
   const snapshot=next.snapshots[identifier(args.snapshotId)];need(snapshot,'NOT_FOUND','Select the original complete snapshot.');
   const body=await readRecord(directory,snapshot);verified(body,'Original snapshot');
   const id=randomUUID(),at=now(),name=text(args.name??snapshot.name,'report name',256);
   const rows=body.operations.map(row=>({operationId:row.id,action:row.action,mode:row.mode,state:row.state,paused:row.paused,
    participantId:row.participantId,createdAt:row.createdAt,updatedAt:row.updatedAt,providerIds:row.providerIds,sourceIds:row.sourceIds}));
   const data={schema:'stellar-forge.pollar-partner.report-data.v1',id,name,snapshotId:snapshot.id,snapshotSha256:body.sha256,
    applicationId:body.applicationId,originalApplicationId:body.originalApplicationId,network:body.network,
    participantId:body.participantId,createdAt:at,participants:body.participants,operations:rows,decisions:body.decisions,
    sources:body.sources.map(item=>({source:copy(item.source),outcome:copy(item.record.outcome)}))};
   const rendered='<!doctype html><html lang="en"><meta charset="utf-8"><title>'+html(name)+'</title><style>body{font:15px system-ui;color:#202020;max-width:1100px;margin:40px auto;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#555}</style><h1>'+html(name)+'</h1><p>'+html(body.originalApplicationId)+' · '+html(body.network)+'</p><p>Original snapshot '+html(snapshot.id)+' · '+html(body.createdAt)+'</p><table><thead><tr><th>Action</th><th>Original operation</th><th>Outcome</th><th>Provider identities</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+html(row.action)+'</td><td>'+html(row.operationId)+'</td><td>'+html(row.state)+(row.paused?' · paused':'')+'</td><td><pre>'+html(JSON.stringify(row.providerIds,null,2))+'</pre></td></tr>').join('')+'</tbody></table><h2>Complete retained observations</h2><pre>'+html(JSON.stringify(data,null,2))+'</pre></html>';
   const output=[['json','partner-operations.json','application/json',jsonBytes(data)],['csv','partner-operations.csv','text/csv',Buffer.from(csv(rows,['operationId','action','mode','state','paused','participantId','createdAt','updatedAt','providerIds','sourceIds']))],
    ['html','report.html','text/html; charset=utf-8',Buffer.from(rendered)]],members=[];
   for(const [format,filename,contentType,bytes]of output){const file=await files.writeNew(directory,'reports/'+id+'/'+filename,bytes);
    members.push({format,filename,contentType,file,bytes:file.bytes,sha256:file.sha256});}
   const report=sealed({schema:'stellar-forge.pollar-partner.report.v1',id,name,applicationId:body.applicationId,
    applicationVersion:body.applicationVersion,participantId:body.participantId,snapshotId:body.id,snapshotSha256:body.sha256,
    scope:{operationIds:rows.map(row=>row.operationId),sourceIds:body.sources.map(item=>item.source.id),participantId:body.participantId},
    formats:members.map(item=>item.format),files:members,createdAt:at});
   report.file=await retainJSON(directory,'reports/'+id+'/report.json',report);next.reports[id]=report;return {report:copy(report)};
  });
 }
 async function reportRead({reportId}){const current=await state(),row=current.reports[identifier(reportId)];need(row,'NOT_FOUND','The original report is absent.');
  return {workspaceId:current.workspaceId,revision:current.revision,report:copy(row),record:await readRecord(directory,row)};}
 async function reportFile({reportId,format='html',offset=0,length=196608}){
  const current=await state(),row=current.reports[identifier(reportId)];need(row,'NOT_FOUND','The original report is absent.');
  const member=format==='manifest'?{file:row.file,contentType:'application/json',filename:'report.json'}:row.files.find(item=>item.format===format);
  need(member,'REPORT_FORMAT_NOT_FOUND','Choose one of the original report formats.');
  const result=await files.sourceFileRange(directory,member.file,offset,length);
  return {...result,path:member.filename,bytes:member.file.bytes,sha256:member.file.sha256,contentType:member.contentType};
 }
 async function runtimes(){
  const available=typeof runtimeSelections==='function'?await runtimeSelections():runtimeSelections;
  need(Array.isArray(available),'INVALID_RUNTIME_SOURCE','Supply complete original runtime selections.');return copy(available);
 }
 async function close(){if(closed)return;await Promise.allSettled([...running]);closed=true;
  for(const entry of services.values()){try{await (await entry).close?.();}catch{}}
 }
 return Object.freeze({directory,describe,catalog,profileSave,applicationSave,applicationRead,page,participantVerify,
  operationPrepare,operationRead,operationRun,operationReconcile,operationPause,operationResume,operationCancel,operationCollect,
  browserStart,browserOutcome,browserObserved,sourceRead,sourceFile,snapshotCreate,snapshotRead,decisionSave,reportCreate,reportRead,reportFile,
  runtimeSelections:runtimes,readState:state,close});
}
