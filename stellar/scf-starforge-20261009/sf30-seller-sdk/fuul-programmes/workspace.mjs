// MIT. Complete Fuul programme, event, allocation and claim workspace.
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeValue,decodeValue} from '../stellar-indexer/common.mjs';
import {
 STATE_SCHEMA,SOURCE_SCHEMA,EDITION_SCHEMA,TABLES,files,now,own,plain,clone,digest,canonical,jsonBytes,
 need,integer,text,identifier,selected,hash,withLock,descriptor,publicError,randomUUID,
 sealed,verified,publicConnection,initialize,readState,recoverState,intent,replay,revision,commitState,
 mutate,retainJSON,readDescriptor,readRecord,safeFilename
} from './common.mjs';
import {openFuulSource,prepareFuulAction,sendFuulAction,parseFuulJSON,parseFuulCSV,matchFuulClaimTransaction} from './native.mjs';
import {normalizeFuulProgramme,normalizeFuulRecords,prepareFuulEvent,matchFuulPipeline,reconcileFuulProgramme,compareFuulReconciliations,buildFuulReport} from './reconciliation.mjs';
export const FUUL_WORKSPACE_SCHEMA=STATE_SCHEMA;
const PROVIDERS=['fuul','stellar','activity','document'];
const OPERATION_TABLES=['events','batches','actions'];
const clean=value=>clone(value);
function derivedId(value){
 const hex=digest(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
function unique(value,label){
 need(Array.isArray(value),'INVALID_ARGUMENT','Supply '+label+' as an array.');
 need(new Set(value).size===value.length,'INVALID_ARGUMENT','Select each '+label+' once.');return value;
}
function versioned(table,id,version){
 const record=selected(table,id,'Programme'),n=version??record.currentVersion;integer(n,'programme version',1);
 const entry=record.versions.find(row=>row.version===n);need(entry,'VERSION_NOT_FOUND','Select a retained programme version.');return entry;
}
async function originalVersion(directory,state,id,version){return verified(await readRecord(directory,versioned(state.programmes,id,version)),'Original programme');}
function privateSecrets(value,result=[]){
 if(!plain(value))return result;
 for(const [key,item] of Object.entries(value)){
  if(/authorization|cookie|api.?key|token|password|secret/i.test(key)&&typeof item==='string'&&item)result.push(item);
  else if(plain(item))privateSecrets(item,result);
 }
 return result;
}
function opaqueRequest(request){
 const value=clone(request??{});
 if(plain(value.headers))for(const key of Object.keys(value.headers))if(/authorization|cookie|api[-_]key|token/i.test(key))delete value.headers[key];
 if(value.url){try{const url=new URL(value.url);url.username='';url.password='';
   for(const key of [...url.searchParams.keys()])if(/key|token|secret|auth|password/i.test(key))url.searchParams.delete(key);value.url=url.href;}catch{delete value.url;}}
 return value;
}
function errorStatus(error){return {code:String(error?.code??'NATIVE_SOURCE_ERROR'),message:String(error?.message??'The original operation failed.'),details:clone(error?.details??{})};}
function sourceFormat({provider,format,contentType,filename}){
 if(provider==='document')return 'document';
 need(format===undefined||format===null||format===''||['json','csv'].includes(format),'INVALID_SOURCE_FORMAT','Select original JSON or CSV.');
 const selected=format||(provider==='activity'&&(/(?:text|application)\/csv/i.test(contentType??'')||/\.csv$/i.test(filename??''))?'csv':'json');
 need(selected!=='csv'||provider==='activity','INVALID_SOURCE_FORMAT','Original Fuul and Stellar sources use their native JSON response.');
 return selected;
}
function parseSource(body,format){return format==='csv'?parseFuulCSV(body):parseFuulJSON(body);}
function projectionAt(value,pointer){
 if(pointer===null||pointer==='')return Array.isArray(value)?value:[value];
 need(typeof pointer==='string'&&pointer.startsWith('/'),'INVALID_RECORDS_PATH','Use the original JSON pointer.');
 let current=value;
 for(const item of pointer.slice(1).split('/')){
  need(!/~(?:[^01]|$)/.test(item),'INVALID_RECORDS_PATH','The original JSON pointer is malformed.');
  const key=item.replace(/~1/g,'/').replace(/~0/g,'~');
  need((plain(current)||Array.isArray(current))&&own(current,key),'RECORDS_PATH_NOT_FOUND','The selected original record was not found.',{pointer});
  current=current[key];
 }
 return Array.isArray(current)?current:[current];
}
function range(args={}){
 return {offset:integer(args.offset??0,'offset'),limit:integer(args.limit??100,'limit',1,1000)};
}
function rowsPage(rows,args={}){
 const {offset,limit}=range(args);return {rows:rows.slice(offset,offset+limit),offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null};
}
function orderedRows(table,args={}){
 let rows=Object.values(table);
 if(args.programmeId)rows=rows.filter(row=>row.programmeId===args.programmeId||row.id===args.programmeId);
 if(args.status)rows=rows.filter(row=>row.status===args.status||row.deliveryState===args.status);
 if(args.query){const query=String(args.query).toLocaleLowerCase();rows=rows.filter(row=>[row.id,row.name,row.label,row.eventName,row.dedupId,row.projectId,row.userIdentifier,row.operation].some(value=>String(value??'').toLocaleLowerCase().includes(query)));}
 return rows.sort((a,b)=>String(b.updatedAt??b.createdAt??b.observedAt??'').localeCompare(String(a.updatedAt??a.createdAt??a.observedAt??''))||String(a.id).localeCompare(String(b.id)));
}
function compactRow(table,row){
 const value=clone(row);
 if(table==='captures'){value.sourceCount=row.sources.length;value.attemptCount=row.attempts.length;delete value.sources;delete value.attempts;}
 if(OPERATION_TABLES.includes(table)){value.attemptCount=row.attempts?.length??0;value.conflictCount=row.conflicts?.length??0;delete value.attempts;delete value.conflicts;delete value.decisions;
  if(value.inflight)value.inflight={attemptId:row.inflight.attemptId,args:row.inflight.args,startedAt:row.inflight.startedAt};}
 if(table==='programmes'){value.versionCount=row.versions.length;value.versions=row.versions.slice(-3);}
 if(table==='sources'){delete value.request;delete value.response;}
 if(table==='runs'){value.taskCount=row.tasks.length;delete value.tasks;}
 if(Array.isArray(value.eventIds)){value.eventCount=value.eventIds.length;delete value.eventIds;}
 return value;
}
function summarizeState(state,connections=[]){
 const result={schema:state.schema,workspaceId:state.workspaceId,createdAt:state.createdAt,updatedAt:state.updatedAt,revision:state.revision,head:state.head,profile:clone(state.profile),connections:connections.map(clone),counts:{},pages:{}};
 for(const table of TABLES){const rows=orderedRows(state[table]);result.counts[table]=rows.length;
  const page=rowsPage(rows,{limit:100});result[table]=Object.fromEntries(page.rows.map(row=>[row.id,compactRow(table,row)]));
  result.pages[table]={offset:0,limit:100,total:page.total,nextOffset:page.nextOffset};}
 result.eventStates={};for(const row of Object.values(state.events))result.eventStates[row.status]=(result.eventStates[row.status]??0)+1;
 return result;
}
async function recordsFor(directory,state,sourceIds){
 const records=[];for(const id of sourceIds){const source=selected(state.sources,id,'Source');
  if(source.projectionFile)records.push(...await readRecord(directory,source.projectionFile));}return records;
}
async function retainSource(directory,state,{id=randomUUID(),captureId=null,programmeId=null,programmeVersion=null,provider,kind,network,
 connection=null,sourceScope=null,label,request={},response={},body,originalBodyFile=null,records,recordsPath=null,
 observedAt=now(),error=null,runtime=null,runtimeConfiguration=null,projectionRequest=null,format='json'}){
 need(Buffer.isBuffer(body),'INVALID_SOURCE','Supply complete original source bytes.');
 const root='sources/'+id,bodyFile=originalBodyFile??await files.writeNew(directory,root+'/original.body',body);
 need(bodyFile.bytes===body.length&&bodyFile.sha256===digest(body),'SOURCE_CHANGED','The original source differs from its retained bytes.');
 const requestFile=await retainJSON(directory,root+'/request.json',opaqueRequest(request));
 const responseFile=await retainJSON(directory,root+'/response.json',clean({status:response.status??null,headers:response.headers??{},body:bodyFile,bodyComplete:response.bodyComplete??true,
  startedAt:response.startedAt??null,elapsedMs:response.elapsedMs??null,observedAt,error:error?errorStatus(error):null}));
 let projected=[],projectionError=null;
 try{
  if(provider!=='document'&&!error){
   projected=await normalizeFuulRecords({provider,kind,records,sourceId:id,captureId,sourceScope:sourceScope??id,observedAt,network,
    rawBody:body,recordsPath,format,runtime:runtimeConfiguration,contracts:connection?.contracts??connection?.nativeSource?.contracts??[],request:projectionRequest??request,response:{status:response.status??null,bodyComplete:response.bodyComplete??true},status:response.status??null,projectId:connection?.projectId??null});
   need(Array.isArray(projected),'INVALID_NATIVE_PROJECTION','The original projection must return an array of records.');
   const used=projected.map(row=>row.runtime??row.projection?.runtime).filter(Boolean);if(!runtime&&used.length)runtime=used[0];
   for(const item of used)need(canonical(item)===canonical(runtime),'RUNTIME_CHANGED','One source must retain one original runtime.');
  }
 }catch(problem){projectionError=errorStatus(problem);projected=[];}
 const projectionFile=await retainJSON(directory,root+'/projection.json',projected);
 const manifest=sealed({schema:SOURCE_SCHEMA,id,captureId,programmeId,programmeVersion,provider,kind,network,connection:clone(connection),
  sourceScope:sourceScope??id,label:label??kind,observedAt,requestFile,responseFile,bodyFile,projectionFile,recordsPath,format,
  projectionRequest:opaqueRequest(projectionRequest??request),runtime:runtime?clone(runtime):null,
  nativeRecords:Array.isArray(records)?records.length:0,selectedRecords:projected.length,error:error?errorStatus(error):projectionError});
 const file=await retainJSON(directory,root+'/source.json',manifest);
 state.sources[id]={id,captureId,programmeId,programmeVersion,provider,kind,network,sourceScope:manifest.sourceScope,label:manifest.label,observedAt,
  bodyFile,projectionFile,file,sha256:manifest.sha256,nativeRecords:manifest.nativeRecords,selectedRecords:projected.length,error:manifest.error,runtime:manifest.runtime};
 return {source:state.sources[id],projected,error:manifest.error};
}
export async function inspectFuulWorkspace({directory,allowMissing=false}){
 try{return summarizeState(await readState(directory));}catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openFuulWorkspace({directory,connections={},profile={},signal,applicationDirectory}={}){
 await initialize(directory,profile);
 const connectionMap=new Map();
 for(const [alias,input] of Object.entries(connections)){
  const configuration=clone(input);
  if(configuration.provider==='stellar'){
   const original=configuration.runtime??{};
   configuration.runtime={...original,installationDirectory:original.installationDirectory??configuration.installationDirectory??applicationDirectory??fileURLToPath(new URL('.',import.meta.url)),
    runtimeDirectory:original.runtimeDirectory??configuration.runtimeDirectory??join(directory+'.runtimes',derivedId(alias)),
    expectedManifestSha256:original.expectedManifestSha256??configuration.expectedManifestSha256};
  }
  const summary=publicConnection(alias,configuration),adapter=openFuulSource(configuration);
  const native=typeof adapter.descriptor==='function'?adapter.descriptor():adapter.descriptor??adapter.describe?.();
  need(plain(native),'INVALID_NATIVE_SOURCE','The native adapter must expose its original source descriptor.');
  Object.assign(summary,{sourceScope:native.id??digest(jsonBytes(native)),nativeSource:clone(native),network:native.network??summary.network,projectId:native.projectId??summary.projectId,contracts:native.contracts??configuration.contracts??null});
  connectionMap.set(alias,{summary,private:configuration,adapter});
 }
 let closed=false;
 const check=()=>need(!closed,'WORKSPACE_CLOSED','Reopen the Fuul programme workspace.');
 function connection(alias,expected){
  const value=connectionMap.get(alias);need(value,'CONNECTION_REQUIRED','Configure the original named private connection.',{alias});
  if(expected)need(canonical(value.summary)===canonical(expected),'CONNECTION_CHANGED','The selected original project, network or service differs.',{alias});
  return value;
 }
 function forProgramme(value,programme){
  if(value.summary.projectId!==null)need(value.summary.projectId===programme.definition.projectId,'PROJECT_MISMATCH','Select the original programme project connection.');
  need(value.summary.network===programme.definition.network,'NETWORK_MISMATCH','Select the original programme network connection.');return value;
 }
 async function describe(){check();return summarizeState(await readState(directory),[...connectionMap.values()].map(value=>value.summary));}
 async function list(args){
  check();need(TABLES.includes(args.table),'INVALID_TABLE','Select an existing workspace table.');
  const state=await readState(directory),page=rowsPage(orderedRows(state[args.table],args),args);
  return {workspaceId:state.workspaceId,revision:state.revision,table:args.table,...page,rows:page.rows.map(row=>compactRow(args.table,row))};
 }
 async function sourceCatalog(){
  check();return [...connectionMap.values()].map(value=>({connection:clone(value.summary),catalog:typeof value.adapter.catalog==='function'?value.adapter.catalog():clone(value.adapter.catalog??[])}));
 }
 async function profileSave(args){
  check();return mutate(directory,'profile.save',args,async state=>{
   need(plain(args.profile),'INVALID_ARGUMENT','Supply the workspace profile.');text(args.profile.name,'workspace name');
   state.profile=clone(args.profile);return {profile:state.profile};
  });
 }
 async function programmeSave(args){
  check();return mutate(directory,'programme.save',args,async state=>{
   const id=args.programmeId??randomUUID();identifier(id);
   const previous=args.programmeId?selected(state.programmes,id,'Programme'):null,version=(previous?.currentVersion??0)+1;
   if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected programme version',1),'PROGRAMME_VERSION_CONFLICT','The selected programme has advanced.',{currentVersion:previous?.currentVersion??0});
   const definition=normalizeFuulProgramme(args.definition),name=text(args.name??definition.name,'programme name');
   for(const sourceId of definition.providerSourceIds??[]){const source=selected(state.sources,sourceId,'Original configuration source');
    need(source.programmeId===null||source.programmeId===id,'PROGRAMME_SOURCE_MISMATCH','Use original configuration belonging to this programme.');}
   const body=sealed({schema:'stellar-forge.fuul-programmes.programme.v1',id,version,name,definition,createdAt:now()});
   const file=await retainJSON(directory,'programmes/'+id+'/'+version+'.json',body);
   const entry={id,version,name,projectId:definition.projectId,network:definition.network,sha256:body.sha256,file,createdAt:body.createdAt,
    currencyCount:definition.currencies.length,mappingCount:definition.mappings.length,providerSourceIds:definition.providerSourceIds??[]};
   state.programmes[id]={id,name,projectId:definition.projectId,network:definition.network,currentVersion:version,updatedAt:body.createdAt,versions:[...(previous?.versions??[]),entry]};
   return {programmeId:id,version,programme:entry};
  });
 }
 async function programmeRead({programmeId,version}){check();return originalVersion(directory,await readState(directory),programmeId,version);}
 async function sourceImport(args){
  check();return mutate(directory,'source.import',args,async state=>{
   need(PROVIDERS.includes(args.provider),'INVALID_SOURCE','Select Fuul, Stellar, original activity or a document source.');
   text(args.kind??'document','source kind',100);need(typeof args.bodyBase64==='string','INVALID_SOURCE','Supply the complete source as base64.');
   const body=Buffer.from(args.bodyBase64,'base64');need(body.toString('base64')===args.bodyBase64,'INVALID_SOURCE','Use canonical complete base64.');
   const recordsPath=args.recordsPath??null,format=sourceFormat(args);let records=[],error=null;
   if(args.provider!=='document')try{records=projectionAt(parseSource(body,format).value,recordsPath);}catch(problem){error=errorStatus(problem);}
   const programme=args.programmeId?await originalVersion(directory,state,args.programmeId,args.programmeVersion):null;
   const chosen=args.connectionAlias?connection(args.connectionAlias):null;
   if(chosen){need(chosen.summary.provider===args.provider,'INVALID_CONNECTION','Select the original source provider.');if(programme)forProgramme(chosen,programme);}
   if(args.provider==='activity')text(args.sourceScope,'original customer activity source scope',1024);
   const retained=await retainSource(directory,state,{programmeId:programme?.id??null,programmeVersion:programme?.version??null,provider:args.provider,kind:args.kind??'document',
    network:args.network??chosen?.summary.network??programme?.definition.network??null,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??null,
    label:args.label??args.filename??args.kind??'Original source',body,records,recordsPath,format,sourceScope:args.sourceScope??chosen?.summary.sourceScope??null,
    request:args.request??{source:'operator-file',filename:args.filename??null},response:{status:args.status??null,headers:{'content-type':args.contentType??'application/json'},bodyComplete:true},error});
   return {sourceId:retained.source.id,source:retained.source};
  });
 }
 async function sourceProject(args){
  check();return mutate(directory,'source.project',args,async state=>{
   const original=selected(state.sources,args.sourceId,'Original source'),full=verified(await readRecord(directory,original));
   const provider=args.provider??original.provider,format=sourceFormat({provider,format:args.format??(full.format==='document'?undefined:full.format)});
   const body=await readDescriptor(directory,original.bodyFile),records=projectionAt(parseSource(body,format).value,args.recordsPath??null);
   const alias=args.connectionAlias??(provider===original.provider?full.connection?.alias:null),chosen=alias?connection(alias,args.connectionAlias?undefined:full.connection):null;
   need(PROVIDERS.includes(provider),'INVALID_SOURCE','Select an original source provider.');
   if(chosen)need(chosen.summary.provider===provider,'INVALID_CONNECTION','Select the original source provider.');
   const retained=await retainSource(directory,state,{programmeId:original.programmeId,programmeVersion:original.programmeVersion,provider,kind:args.kind??original.kind,
    network:args.network??original.network,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??null,label:args.label??original.label,
    body,originalBodyFile:original.bodyFile,records,recordsPath:args.recordsPath??null,format,sourceScope:args.sourceScope??full.sourceScope,
    response:await readRecord(directory,full.responseFile),request:{source:'original-source-projection',sourceId:original.id,bodySha256:original.bodyFile.sha256},projectionRequest:full.projectionRequest??await readRecord(directory,full.requestFile),
    observedAt:original.observedAt});
   return {sourceId:retained.source.id,originalSourceId:original.id,source:retained.source};
  });
 }
 async function sourceRead(args){
  check();const state=await readState(directory),source=selected(state.sources,args.sourceId,'Source');
  const full=verified(await readRecord(directory,source)),records=source.projectionFile?await readRecord(directory,source.projectionFile):[];
  return {source:full,...rowsPage(records,args)};
 }
 async function sourceFile({sourceId,part='body',offset=0,length=1024*1024}){
  check();const source=selected((await readState(directory)).sources,sourceId,'Source'),full=verified(await readRecord(directory,source));
  const names={body:'bodyFile',request:'requestFile',response:'responseFile',projection:'projectionFile'};
  need(part==='manifest'||own(names,part),'INVALID_ARGUMENT','Select the body, projection, request, response or manifest.');
  const file=part==='manifest'?source.file:full[names[part]];integer(offset,'offset');integer(length,'length',1,4*1024*1024);
  const result=await files.sourceFileRange(directory,file,offset,length);
  return {sourceId,part,file,offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }


 async function retainExchanges(state,exchanges,context,root){
  const sourceIds=[];let index=0;
  for(const exchange of exchanges??[]){
   need(Buffer.isBuffer(exchange.response?.body),'INVALID_NATIVE_SOURCE','Each native exchange must retain its original bytes.');
   const id=derivedId(root+':exchange:'+index++);
   const saved=await retainSource(directory,state,{...context,id,kind:exchange.kind??context.kind,request:exchange.request??{},
    response:exchange.response,body:exchange.response.body,records:exchange.records??[],recordsPath:exchange.recordsPath??null,
    observedAt:exchange.response.observedAt??now(),error:exchange.error??null,runtime:exchange.runtime??null});
   sourceIds.push(saved.source.id);
  }
  return sourceIds;
 }
 async function captureStart(args){
  check();return mutate(directory,'capture.start',args,async state=>{
   const programme=await originalVersion(directory,state,args.programmeId,args.programmeVersion),chosen=forProgramme(connection(args.connectionAlias),programme),read=clone(args.read);
   need(plain(read)&&typeof read.kind==='string','INVALID_ARGUMENT','Select an original native read.');
   const id=randomUUID(),capture={id,programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
    name:text(args.name??read.kind,'capture name'),provider:chosen.summary.provider,connectionAlias:args.connectionAlias,connection:clone(chosen.summary),
    read,nextRead:clone(read),status:'READY',paused:false,sources:[],attempts:[],inflight:null,run:null,lastError:null,createdAt:now(),updatedAt:now()};
   state.captures[id]=capture;return {captureId:id,capture:compactRow('captures',capture)};
  });
 }
 async function captureRead({captureId,...args}){
  check();const capture=selected((await readState(directory)).captures,captureId,'Capture');
  return {capture:compactRow('captures',capture),sources:rowsPage(capture.sources,args),attempts:rowsPage(capture.attempts,args)};
 }
 async function persistNativeResult(root,result,pending){
  need(Buffer.isBuffer(result.response?.body),'INVALID_NATIVE_SOURCE','The native service must return its original response bytes.');
  const bodyFile=await files.writeNew(directory,root+'/response.body',result.response.body);
  const recordsFile=Array.isArray(result.records)?await retainJSON(directory,root+'/native-records.json',result.records):null,exchanges=[];
  let index=0;
  for(const exchange of result.exchanges??[]){
   need(Buffer.isBuffer(exchange.response?.body),'INVALID_NATIVE_SOURCE','Each native exchange must preserve its original response.');
   const exchangeFile=await files.writeNew(directory,root+'/exchanges/'+index+'/response.body',exchange.response.body);
   const rowsFile=Array.isArray(exchange.records)?await retainJSON(directory,root+'/exchanges/'+index+'/records.json',exchange.records):null;
   exchanges.push(clean({...exchange,records:undefined,recordsFile:rowsFile,request:opaqueRequest(exchange.request),
    response:{...exchange.response,body:undefined,bodyFile:exchangeFile}}));index++;
  }
  const saved=clean({request:opaqueRequest(result.request??pending.read??{}),response:{...result.response,body:undefined,bodyFile},
   recordsFile,recordsPath:result.recordsPath??null,continuation:result.continuation??{done:true,next:null},runtime:result.runtime??null,
   error:result.error??null,outcome:result.outcome??null,exchanges,receivedAt:now()});
  await retainJSON(directory,root+'/native-result.json',saved);return saved;
 }
 async function materializeExchanges(saved){
  const output=[];for(const exchange of saved.exchanges??[])output.push({...exchange,
   records:exchange.recordsFile?await readRecord(directory,exchange.recordsFile):[],
   response:{...exchange.response,body:await readDescriptor(directory,exchange.response.bodyFile)}});
  return output;
 }
 async function captureNext(args){
  check();identifier(args.captureId);
  return withLock(directory,'capture-'+args.captureId+'.lock',async()=>{
   const begun=await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);if(prior)return {completed:prior};
    let capture=selected(before.captures,args.captureId,'Capture');
    if(capture.inflight){
     need(capture.inflight.args.requestId===args.requestId&&capture.inflight.intentSha256===intent('capture.next',args).intentSha256,
      'CAPTURE_INFLIGHT','Continue the original capture request.',{originalArguments:capture.inflight.args});
    }else{
     revision(before,args);need(['READY','RUNNING'].includes(capture.status)&&!capture.paused,'CAPTURE_STATE','Resume the selected capture before its next page.',{status:capture.status});
     connection(capture.connectionAlias,capture.connection);
     const next=clone(before),working=next.captures[capture.id];working.inflight={attemptId:randomUUID(),args:clone(args),
      intentSha256:intent('capture.next',args).intentSha256,read:clone(working.nextRead),startedAt:now()};
     working.status='RUNNING';working.updatedAt=now();
     await commitState(directory,before,next,'capture.next.begin',args,{captureId:capture.id,attemptId:working.inflight.attemptId},{recordRequest:false});capture=working;
    }
    return {capture:clone(capture),pending:clone(capture.inflight)};
   });
   if(begun.completed)return begun.completed;
   const {capture,pending}=begun,root='captures/'+capture.id+'/attempts/'+pending.attemptId;let saved;
   try{saved=await files.readJSON(directory,root+'/native-result.json');}catch(error){
    if(error.code!=='ENOENT')throw error;let orphan=null;
    try{orphan=await descriptor(directory,root+'/response.body');}catch(problem){if(problem.code!=='ENOENT')throw problem;}
    if(orphan){
     saved={request:opaqueRequest(pending.read),response:{status:null,headers:{},bodyFile:orphan,bodyComplete:false,startedAt:pending.startedAt},
      recordsFile:null,recordsPath:null,continuation:{done:false,next:pending.read},exchanges:[],receivedAt:now(),
      error:{code:'NATIVE_ATTEMPT_RECOVERED',message:'The original source body survived before response metadata was committed; this read continues as a new retained attempt.'}};
     await retainJSON(directory,root+'/native-result.json',saved);
    }else{
     const chosen=connection(capture.connectionAlias,capture.connection);let result;
     try{result=await chosen.adapter.read({...pending.read,signal});}catch(problem){
      result={request:pending.read,response:{status:null,headers:{},body:Buffer.alloc(0),bodyComplete:false},records:[],
       continuation:{done:false,next:pending.read},error:publicError(problem,privateSecrets(chosen.private))};
     }
     saved=await persistNativeResult(root,result,pending);
    }
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.next',args);if(prior)return prior;
    const next=clone(before),working=selected(next.captures,capture.id,'Capture');
    need(working.inflight?.attemptId===pending.attemptId&&working.inflight.intentSha256===pending.intentSha256,'CAPTURE_INFLIGHT_CHANGED','The original capture request changed.');
    let nativeError=saved.error??null,records=[];
    const body=await readDescriptor(directory,saved.response.bodyFile);
    if(!nativeError)try{records=saved.recordsFile?await readRecord(directory,saved.recordsFile):projectionAt(parseFuulJSON(body).value,saved.recordsPath);}catch(problem){nativeError=errorStatus(problem);}
    if(!nativeError&&!saved.continuation?.done&&working.attempts.some(item=>canonical(item.read)===canonical(saved.continuation.next)))
     nativeError={code:'CYCLIC_NATIVE_CURSOR',message:'The original provider returned a previously retained continuation.'};
    const context={captureId:capture.id,programmeId:capture.programmeId,programmeVersion:capture.programmeVersion,provider:capture.provider,kind:pending.read.kind,
     network:capture.connection.network,connection:capture.connection,sourceScope:capture.connection.sourceScope,label:capture.name,
     runtimeConfiguration:connectionMap.get(capture.connectionAlias)?.private.runtime??null};
    const exchangeIds=await retainExchanges(next,await materializeExchanges(saved),context,root);
    const retained=await retainSource(directory,next,{...context,id:pending.attemptId,request:saved.request,response:saved.response,body,originalBodyFile:saved.response.bodyFile,
     records,recordsPath:saved.recordsPath,observedAt:saved.response.observedAt??saved.receivedAt,error:nativeError,runtime:saved.runtime??null});
    if(retained.source.runtime)working.runtime=clone(retained.source.runtime);
    nativeError=retained.error;
    const attempt={id:pending.attemptId,requestId:args.requestId,startedAt:pending.startedAt,finishedAt:now(),read:pending.read,
     sourceId:retained.source.id,exchangeSourceIds:exchangeIds,responseStatus:saved.response.status??null,error:nativeError};
    working.attempts.push(attempt);working.sources.push(...exchangeIds,retained.source.id);working.updatedAt=now();working.inflight=null;working.lastError=nativeError;
    if(nativeError?.code==='NATIVE_ATTEMPT_RECOVERED')working.status='READY';
    else if(nativeError)working.status='FAILED';
    else if(saved.continuation?.done){working.status='COMPLETE';working.nextRead=null;working.completedAt=now();}
    else{need(plain(saved.continuation?.next),'INVALID_NATIVE_CONTINUATION','The native source must return its complete next read.');working.nextRead=clone(saved.continuation.next);working.status='READY';}
    if(working.paused&&working.status!=='COMPLETE')working.status='PAUSED';
    return commitState(directory,before,next,'capture.next',args,{captureId:capture.id,status:working.status,sourceId:retained.source.id,source:retained.source,attempt,error:nativeError});
   });
  });
 }
 async function capturePause(args){
  check();return mutate(directory,'capture.pause',args,async state=>{
   const row=selected(state.captures,args.captureId,'Capture');row.paused=true;if(row.status!=='COMPLETE')row.status='PAUSED';row.updatedAt=now();
   return {captureId:row.id,status:row.status,originalRun:row.run?.args??null,originalAttempt:row.inflight?.args??null};
  });
 }
 async function captureResume(args){
  check();return mutate(directory,'capture.resume',args,async state=>{
   const row=selected(state.captures,args.captureId,'Capture');connection(row.connectionAlias,row.connection);row.paused=false;
   if(row.status!=='COMPLETE'){row.status=row.inflight?'RUNNING':'READY';row.lastError=null;}row.updatedAt=now();
   return {captureId:row.id,status:row.status,originalRun:row.run?.args??null,originalAttempt:row.inflight?.args??null};
  });
 }
 async function captureRun(args){
  check();const start=await withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.run',args);if(prior)return {completed:prior};
   const row=selected(before.captures,args.captureId,'Capture');
   if(row.run){need(row.run.args.requestId===args.requestId&&row.run.intentSha256===intent('capture.run',args).intentSha256,'CAPTURE_RUN_ACTIVE','Continue the original complete capture run.',{originalArguments:row.run.args});return {};}
   revision(before,args);const next=clone(before);next.captures[row.id].run={args:clone(args),intentSha256:intent('capture.run',args).intentSha256,startedAt:now()};
   await commitState(directory,before,next,'capture.run.begin',args,{captureId:row.id},{recordRequest:false});return {};
  });
  if(start.completed)return start.completed;
  for(;;){
   check();const state=await readState(directory),row=selected(state.captures,args.captureId,'Capture');
   if(signal?.aborted&&!row.paused&&row.status!=='COMPLETE')try{
    return await capturePause({captureId:row.id,requestId:derivedId(args.requestId+':drain:'+state.revision),expectedRevision:state.revision});
   }catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
   if(row.status==='COMPLETE')return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'capture.run',args);if(prior)return prior;
    const next=clone(before),current=selected(next.captures,row.id,'Capture');current.run={...current.run,finishedAt:now()};
    return commitState(directory,before,next,'capture.run',args,{captureId:row.id,status:'COMPLETE',sources:current.sources.length,attempts:current.attempts.length,completedAt:current.completedAt});
   });
   if(['PAUSED','FAILED'].includes(row.status))return {workspaceId:state.workspaceId,revision:state.revision,requestId:args.requestId,captureId:row.id,status:row.status,error:row.lastError,originalArguments:row.run.args};
   const nextArgs=row.inflight?.args??{captureId:row.id,requestId:derivedId(args.requestId+':page:'+row.attempts.length),expectedRevision:state.revision};
   try{await captureNext(nextArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
  }
 }


 async function eventPrepare(args){
  check();return mutate(directory,'event.prepare',args,async state=>{
   const programme=await originalVersion(directory,state,args.programmeId,args.programmeVersion),chosen=forProgramme(connection(args.connectionAlias),programme);
   need(chosen.summary.provider==='fuul','INVALID_CONNECTION','Select the original Fuul event connection.');
   const sourceIds=unique(args.sourceIds??Object.values(state.sources).filter(row=>row.programmeId===programme.id).map(row=>row.id),'source IDs');
   for(const id of sourceIds){const source=selected(state.sources,id,'Original activity source');need(source.programmeId===null||source.programmeId===programme.id,'PROGRAMME_SOURCE_MISMATCH','Select activity from this programme.');}
   const all=await recordsFor(directory,state,sourceIds),wanted=args.recordIds?new Set(unique(args.recordIds,'record IDs')):null;
   if(wanted)for(const id of wanted)need(all.some(row=>row.id===id),'NOT_FOUND','The selected original activity record is absent.',{recordId:id});
   const records=all.filter(row=>!wanted||wanted.has(row.id)),mapping=programme.definition.mappings.find(item=>item.id===args.mappingId);
   need(mapping,'MAPPING_REQUIRED','Select an original programme event mapping.');
   const eligible=records.filter(row=>(!mapping.provider||mapping.provider===row.provider)&&(!mapping.kind||mapping.kind===row.kind));
   const prepared=[],reused=[],conflicts=[],rejected=[];
   for(const record of eligible){
    let native;
    try{native=await prepareFuulEvent({programme,record,mappingId:args.mappingId,dedupId:args.dedupIds?.[record.id]});}
    catch(problem){rejected.push({recordId:record.id,sourceId:record.sourceId,error:errorStatus(problem)});continue;}
    need(plain(native)&&plain(native.body)&&plain(native.correlation),'INVALID_EVENT','The original mapping must return its complete native event and correlation.');
    need(native.projectId===programme.definition.projectId&&native.network===programme.definition.network,'PROJECT_MISMATCH','The native event changed the selected project or network.');
    const body=jsonBytes(native.body),bodySha256=digest(body),key=digest(jsonBytes({projectId:native.projectId,network:native.network,name:native.body.name,dedupId:native.body.dedup_id}));
    const prior=Object.values(state.events).find(row=>row.eventKey===key);
    if(prior){
     if(prior.bodySha256===bodySha256){reused.push(prior.id);continue;}
     const conflictId=randomUUID(),conflictBody=await files.writeNew(directory,'events/'+prior.id+'/conflicts/'+conflictId+'/request.body',body);
     const conflict=sealed({schema:'stellar-forge.fuul-programmes.event-conflict.v1',id:conflictId,eventId:prior.id,eventKey:key,
      programmeId:programme.id,programmeVersion:programme.version,sourceId:record.sourceId,sourceRecordId:record.id,native,
      originalBodySha256:prior.bodySha256,bodyFile:conflictBody,bodySha256,createdAt:now()});
     const file=await retainJSON(directory,'events/'+prior.id+'/conflicts/'+conflictId+'/conflict.json',conflict);
     prior.conflicts.push({id:conflictId,sourceId:record.sourceId,sourceRecordId:record.id,file,bodySha256,createdAt:conflict.createdAt});
     prior.paused=true;prior.updatedAt=now();conflicts.push({eventId:prior.id,conflictId,bodySha256,originalBodySha256:prior.bodySha256});continue;
    }
    const id=randomUUID(),root='events/'+id,bodyFile=await files.writeNew(directory,root+'/request.body',body);
    const request={method:'POST',path:'/api/v1/events',bodyFile,bodySha256};
    const manifest=sealed({schema:'stellar-forge.fuul-programmes.event-intent.v1',id,kind:'event',operation:'event.send',eventKey:key,
     nativeEventKey:native.eventKey,programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
     projectId:native.projectId,network:native.network,connectionAlias:args.connectionAlias,connection:chosen.summary,request,
     correlation:native.correlation,native,sourceId:record.sourceId,sourceRecordId:record.id,mappingId:args.mappingId,createdAt:now()});
    const file=await retainJSON(directory,root+'/event.json',manifest);
    state.events[id]={id,programmeId:programme.id,programmeVersion:programme.version,projectId:native.projectId,network:native.network,eventKey:key,
     nativeEventKey:native.eventKey,eventName:native.body.name,dedupId:native.body.dedup_id,userIdentifier:native.body.user.identifier,
     correlation:clone(native.correlation),sourceId:record.sourceId,sourceRecordId:record.id,mappingId:args.mappingId,
     connectionAlias:args.connectionAlias,connection:clone(chosen.summary),bodyFile,bodySha256,file,
     status:'READY',paused:false,batchId:null,attempts:[],inflight:null,conflicts:[],decisions:[],pipelineSourceIds:[],observations:[],
     createdAt:manifest.createdAt,updatedAt:manifest.createdAt};
    prepared.push(id);
   }
   return {programmeId:programme.id,mappingId:args.mappingId,sourceIds,selectedRecords:records.length,eligibleRecords:eligible.length,
    eventIds:prepared,reusedEventIds:reused,conflicts,rejected};
  });
 }
 async function batchPrepare(args){
  check();return mutate(directory,'batch.prepare',args,async state=>{
   const ids=unique(args.eventIds,'event IDs');need(ids.length>0&&ids.length<=100,'INVALID_BATCH','Select one to 100 original events.');
   const rows=ids.map(id=>selected(state.events,id,'Event')),first=rows[0];connection(first.connectionAlias,first.connection);
   const payload=[];
   for(const row of rows){
    need(row.status==='READY'&&!row.paused&&!row.inflight&&!row.batchId,'EVENT_STATE','Select ready events without an existing batch.',{eventId:row.id,status:row.status,batchId:row.batchId});
    need(row.projectId===first.projectId&&row.network===first.network&&row.connectionAlias===first.connectionAlias&&canonical(row.connection)===canonical(first.connection),
     'BATCH_SCOPE_MISMATCH','A native batch belongs to one exact project, network and event connection.');
    const original=verified(await readRecord(directory,row)),body=await readDescriptor(directory,original.request.bodyFile);
    need(digest(body)===row.bodySha256,'SOURCE_CHANGED','The original event body differs.');
    payload.push(JSON.parse(body.toString('utf8')));
   }
   const id=randomUUID(),body=jsonBytes(payload),bodyFile=await files.writeNew(directory,'batches/'+id+'/request.body',body);
   const manifest=sealed({schema:'stellar-forge.fuul-programmes.batch-intent.v1',id,kind:'batch',operation:'event.batch',
    programmeId:first.programmeId,programmeVersion:first.programmeVersion,projectId:first.projectId,network:first.network,
    connectionAlias:first.connectionAlias,connection:first.connection,eventIds:ids,eventBodyHashes:rows.map(row=>({id:row.id,sha256:row.bodySha256})),
    request:{method:'POST',path:'/api/v1/events/batch',bodyFile,bodySha256:digest(body)},createdAt:now()});
   const file=await retainJSON(directory,'batches/'+id+'/batch.json',manifest);
   state.batches[id]={id,kind:'batch',programmeId:first.programmeId,programmeVersion:first.programmeVersion,projectId:first.projectId,network:first.network,
    connectionAlias:first.connectionAlias,connection:clone(first.connection),eventIds:ids,bodyFile,bodySha256:digest(body),file,
    status:'READY',paused:false,attempts:[],inflight:null,decisions:[],createdAt:manifest.createdAt,updatedAt:manifest.createdAt};
   for(const row of rows)row.batchId=id;
   return {batchId:id,eventIds:ids,batch:compactRow('batches',state.batches[id])};
  });
 }
 async function queueRead({table,id,...args}){
  check();need(OPERATION_TABLES.includes(table),'INVALID_TABLE','Select events, batches or actions.');
  const row=selected((await readState(directory))[table],id,'Original operation');
  const attempts=[];for(const item of rowsPage(row.attempts??[],args).rows)attempts.push(verified(await readRecord(directory,item.file)));
  const conflicts=[];for(const item of rowsPage(row.conflicts??[],args).rows)conflicts.push(verified(await readRecord(directory,item.file)));
  return {table,row:compactRow(table,row),original:verified(await readRecord(directory,row)),attempts,conflicts,
   attemptPage:rowsPage(row.attempts??[],args),conflictPage:rowsPage(row.conflicts??[],args),decisions:rowsPage(row.decisions??[],args)};
 }
 async function queueFile({table,id,attemptId,part='request',offset=0,length=1024*1024}){
  check();need(OPERATION_TABLES.includes(table),'INVALID_TABLE','Select an original event, batch or action.');
  const row=selected((await readState(directory))[table],id,'Original operation');let file,contentType='application/json',filename=table+'-'+id+'-'+part+'.json';
  if(part==='request')file=row.bodyFile;
  else if(part==='manifest')file=row.file;
  else{
   need(['response','attempt'].includes(part),'INVALID_ARGUMENT','Select request, response, attempt or manifest.');
   const entry=row.attempts.find(item=>item.id===attemptId);need(entry,'NOT_FOUND','Select an original dispatch attempt.');
   if(part==='attempt')file=entry.file;else{const attempt=verified(await readRecord(directory,entry.file));file=attempt.response.bodyFile;contentType=attempt.response.headers?.['content-type']??'application/octet-stream';filename=table+'-'+id+'-'+attemptId+'-response.bin';}
  }
  need(file,'FILE_NOT_FOUND','This original operation has no selected file.');integer(offset,'offset');integer(length,'length',1,4*1024*1024);
  const result=await files.sourceFileRange(directory,file,offset,length);
  return {table,id,attemptId:attemptId??null,part,file,filename,contentType,offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }
 async function queuePause(args){
  check();return mutate(directory,'queue.pause',args,async state=>{
   need(OPERATION_TABLES.includes(args.table),'INVALID_TABLE','Select an original operation.');
   const row=selected(state[args.table],args.id,'Operation');row.paused=true;row.updatedAt=now();
   return {table:args.table,id:row.id,status:row.status,paused:true,originalAttempt:row.inflight?.args??null};
  });
 }
 async function queueResume(args){
  check();return mutate(directory,'queue.resume',args,async state=>{
   need(OPERATION_TABLES.includes(args.table),'INVALID_TABLE','Select an original operation.');
   const row=selected(state[args.table],args.id,'Operation');connection(row.connectionAlias,row.connection);row.paused=false;row.updatedAt=now();
   return {table:args.table,id:row.id,status:row.status,paused:false,originalAttempt:row.inflight?.args??null};
  });
 }
 async function dispatch(args){
  check();need(OPERATION_TABLES.includes(args.table),'INVALID_TABLE','Select an original event, batch or action.');identifier(args.id);
  const preparedRow=await withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),existing=replay(before,'queue.next',args);if(existing)return {completed:existing};
   const row=selected(before[args.table],args.id,'Original operation');
   if((row.prerequisiteIds??[]).length&&!row.inflight){
    if(row.prerequisiteRun)need(row.prerequisiteRun.args.requestId===args.requestId&&row.prerequisiteRun.intentSha256===intent('queue.next',args).intentSha256,
     'ACTION_RUN_ACTIVE','Continue the original prepared action and its prerequisites.',{originalArguments:row.prerequisiteRun.args});
    else{
     revision(before,args);need(row.status==='READY'&&!row.paused,'OPERATION_STATE','Select a ready original action.');
     const next=clone(before),working=next[args.table][row.id];working.prerequisiteRun={args:clone(args),intentSha256:intent('queue.next',args).intentSha256,startedAt:now()};
     await commitState(directory,before,next,'queue.next.plan',args,{table:args.table,id:row.id},{recordRequest:false});return clone(working);
    }
   }
   return clone(row);
  });
  if(preparedRow.completed)return preparedRow.completed;
  for(const childId of preparedRow.prerequisiteIds??[]){
   for(;;){
    const current=await readState(directory),parent=selected(current[args.table],args.id,'Operation'),child=selected(current.actions,childId,'Prerequisite');
    if(['ACCEPTED','OBSERVED'].includes(child.status))break;
    if(parent.paused||signal?.aborted||child.paused||!['READY','SENDING'].includes(child.status))return {workspaceId:current.workspaceId,revision:current.revision,table:args.table,id:args.id,status:parent.status,
     prerequisiteId:childId,prerequisiteStatus:child.status,originalArguments:args};
    const childArgs=child.inflight?.args??{table:'actions',id:childId,requestId:derivedId(args.requestId+':prerequisite:'+childId),expectedRevision:current.revision};
    try{await dispatch(childArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
   }
  }
  return withLock(directory,args.table+'-'+args.id+'.lock',async()=>{
   const begun=await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'queue.next',args);if(prior)return {completed:prior};
    let row=selected(before[args.table],args.id,'Original operation'),created=false;
    if(row.inflight){
     need(row.inflight.args.requestId===args.requestId&&row.inflight.intentSha256===intent('queue.next',args).intentSha256,'OPERATION_INFLIGHT','Continue the original dispatch request.',{originalArguments:row.inflight.args});
    }else{
     if(!(row.prerequisiteIds??[]).length)revision(before,args);
     else{
      need(row.prerequisiteRun?.args.requestId===args.requestId&&row.prerequisiteRun.intentSha256===intent('queue.next',args).intentSha256,'ACTION_RUN_ACTIVE','Continue the original complete prepared action.');
      for(const childId of row.prerequisiteIds)need(['ACCEPTED','OBSERVED'].includes(before.actions[childId].status),'PREREQUISITE_PENDING','Complete the original prerequisite before the selected action.');
     }
     need(row.status==='READY'&&!row.paused,'OPERATION_STATE','Select a ready original operation.',{status:row.status,paused:row.paused});
     if(args.table==='events')need(!row.batchId,'EVENT_BATCHED','Dispatch this event through its original batch.',{batchId:row.batchId});
     if(args.table==='batches')for(const id of row.eventIds){const member=selected(before.events,id,'Batch member');need(member.batchId===row.id&&!member.paused&&!member.inflight&&['READY','FAILED','UNCERTAIN','BATCH_OBSERVED'].includes(member.status),'BATCH_MEMBER_CHANGED','A selected original batch member changed.',{eventId:id,status:member.status});}
     connection(row.connectionAlias,row.connection);const next=clone(before),working=next[args.table][row.id];
     working.inflight={attemptId:randomUUID(),args:clone(args),intentSha256:intent('queue.next',args).intentSha256,startedAt:now()};
     working.status='SENDING';working.updatedAt=now();
     if(args.table==='batches')for(const id of working.eventIds){next.events[id].status='SENDING';next.events[id].updatedAt=now();}
     await commitState(directory,before,next,'queue.next.begin',args,{table:args.table,id:row.id,attemptId:working.inflight.attemptId},{recordRequest:false});row=working;created=true;
    }
    return {row:clone(row),pending:clone(row.inflight),created};
   });
   if(begun.completed)return begun.completed;
   const {row,pending,created}=begun,root=args.table+'/'+row.id+'/attempts/'+pending.attemptId;let saved;
   try{saved=await files.readJSON(directory,root+'/native-result.json');}catch(error){
    if(error.code!=='ENOENT')throw error;let orphan=null;
    try{orphan=await descriptor(directory,root+'/response.body');}catch(problem){if(problem.code!=='ENOENT')throw problem;}
    if(!created||orphan){
     const bodyFile=orphan??await files.writeNew(directory,root+'/response.body',Buffer.alloc(0));
     saved={request:{source:'original-interrupted-dispatch',id:row.id,bodySha256:row.bodySha256},
      response:{status:null,headers:{},bodyFile,bodyComplete:false,startedAt:pending.startedAt,observedAt:now()},recordsFile:null,
      outcome:{status:'UNCERTAIN',effect:'original-dispatch-outcome',mutationObserved:false,pipelineRequired:args.table!=='actions'},exchanges:[],
      error:{code:'DISPATCH_OUTCOME_UNKNOWN',message:'The original request began before the process stopped; its completed provider response was not retained.'},receivedAt:now()};
     await retainJSON(directory,root+'/native-result.json',saved);
    }else{
     const chosen=connection(row.connectionAlias,row.connection),original=verified(await readRecord(directory,row)),body=await readDescriptor(directory,original.request.bodyFile);
     need(digest(body)===row.bodySha256,'SOURCE_CHANGED','The original request differs from its retained body.');
     const action={...original,request:{...original.request,body:body.length?JSON.parse(body.toString('utf8')):null,bodyBytes:body}};let result;
     try{result=await sendFuulAction({connection:chosen.private,action,signal});}
     catch(problem){result={request:{method:original.request.method,path:original.request.path,bodySha256:row.bodySha256},
      response:{status:null,headers:{},body:Buffer.alloc(0),bodyComplete:false},outcome:{status:'UNCERTAIN',effect:original.operation,mutationObserved:false,pipelineRequired:args.table!=='actions'},
      error:publicError(problem,privateSecrets(chosen.private)),records:[]};}
     saved=await persistNativeResult(root,result,pending);
    }
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'queue.next',args);if(prior)return prior;
    const next=clone(before),working=selected(next[args.table],row.id,'Original operation');
    need(working.inflight?.attemptId===pending.attemptId,'OPERATION_INFLIGHT_CHANGED','The original dispatch intent changed.');
    const nativeStatus=saved.outcome?.status??'UNCERTAIN';
    need(['ACCEPTED','DUPLICATE','BATCH_OBSERVED','UNCERTAIN','FAILED'].includes(nativeStatus),'INVALID_NATIVE_OUTCOME','The native outcome has an unsupported state.');
    const http=saved.response.status,complete=saved.response.bodyComplete===true;
    let status=(['ACCEPTED','BATCH_OBSERVED'].includes(nativeStatus)&&!(complete&&Number.isInteger(http)&&http>=200&&http<300))?'UNCERTAIN':nativeStatus;
    if(status==='DUPLICATE'&&http!==409)status='UNCERTAIN';
    const original=verified(await readRecord(directory,row));
    const context={programmeId:row.programmeId,programmeVersion:row.programmeVersion,provider:row.connection.provider,kind:original.operation,
     network:row.network,connection:row.connection,sourceScope:row.connection.sourceScope,label:original.operation,runtimeConfiguration:connectionMap.get(row.connectionAlias)?.private.runtime??null};
    const exchangeIds=await retainExchanges(next,await materializeExchanges(saved),context,root);
    const records=saved.recordsFile?await readRecord(directory,saved.recordsFile):[];
    const source=await retainSource(directory,next,{...context,id:pending.attemptId,body:await readDescriptor(directory,saved.response.bodyFile),originalBodyFile:saved.response.bodyFile,
     request:saved.request,response:saved.response,records,recordsPath:saved.recordsPath??null,observedAt:saved.response.observedAt??saved.receivedAt,error:saved.error??null,runtime:saved.runtime??null});
    const attempt=sealed({schema:'stellar-forge.fuul-programmes.dispatch-attempt.v1',id:pending.attemptId,table:args.table,operationId:row.id,
     requestId:args.requestId,startedAt:pending.startedAt,finishedAt:now(),status,outcome:saved.outcome??null,request:saved.request,response:saved.response,
     sourceId:source.source.id,exchangeSourceIds:exchangeIds,error:saved.error??null});
    const file=await retainJSON(directory,root+'/attempt.json',attempt);
    working.attempts.push({id:attempt.id,requestId:args.requestId,status,startedAt:attempt.startedAt,finishedAt:attempt.finishedAt,responseStatus:http,sourceId:source.source.id,file,error:attempt.error});
    working.status=status;working.inflight=null;working.updatedAt=now();working.lastError=attempt.error;working.lastOutcome=saved.outcome??null;
    if(saved.runtime)working.runtime=clone(saved.runtime);
    if(args.table==='batches')for(const id of working.eventIds){const member=next.events[id];member.status=status==='ACCEPTED'?'BATCH_OBSERVED':status;member.updatedAt=now();member.lastBatchAttemptId=attempt.id;}
    return commitState(directory,before,next,'queue.next',args,{table:args.table,id:row.id,status,attemptId:attempt.id,sourceId:source.source.id,outcome:saved.outcome??null,error:attempt.error,paused:working.paused});
   });
  });
 }
 async function queueResolve(args){
  check();return mutate(directory,'queue.resolve',args,async state=>{
   need(OPERATION_TABLES.includes(args.table),'INVALID_TABLE','Select an original operation.');
   const row=selected(state[args.table],args.id,'Operation');need(!row.inflight,'OPERATION_INFLIGHT','Recover the original in-flight request before resolving its outcome.');
   need(['retry','cancel','observed','unbatch','keep-original'].includes(args.outcome),'INVALID_ARGUMENT','Select retry, cancel, observed, unbatch or keep-original.');
   text(args.actor,'decision actor',255);text(args.reason,'decision reason',4000);
   const sourceIds=unique(args.sourceIds??[],'outcome source IDs');for(const id of sourceIds){const source=selected(state.sources,id,'Original outcome source');
    need(source.programmeId===null||source.programmeId===row.programmeId,'PROGRAMME_SOURCE_MISMATCH','Select sources belonging to the original programme.');}
   let match=null;
   if(args.outcome==='observed'){
    need(sourceIds.length>0,'SOURCE_REFERENCE_REQUIRED','Select the retained original provider outcome.');
    if(args.table==='events'){
     const original=verified(await readRecord(directory,row));match=await matchFuulPipeline({event:{...row,...original},records:await recordsFor(directory,state,sourceIds)});
     need(match.matched&&match.created===true&&match.bodyMatches!==false,'PIPELINE_NOT_MATCHED','Select the exact original event pipeline.',{match});
    }else if(args.table==='batches')need(false,'INDIVIDUAL_PIPELINES_REQUIRED','Observe every original event through its exact pipeline.');
    else{
     const original=verified(await readRecord(directory,row));
     if(original.operation==='stellar.claim'){
      match=await matchFuulClaimTransaction({action:{...row,...original},records:await recordsFor(directory,state,sourceIds)});
      need(match.matched&&match.status==='SUCCESS','CLAIM_TRANSACTION_NOT_MATCHED','Select the original successful claim transaction.',{match});
     }
    }
   }
   if(args.outcome==='retry'){need(['FAILED','UNCERTAIN','CANCELED'].includes(row.status),'OPERATION_STATE','Retry a failed, uncertain or canceled original request.');row.status='READY';}
   if(args.outcome==='cancel'){need(!['ACCEPTED','OBSERVED','DUPLICATE'].includes(row.status),'OPERATION_STATE','Cancel an unfinished original operation.');row.status='CANCELED';}
   if(args.outcome==='observed'){row.status='OBSERVED';if(match){if(args.table==='events'){row.pipeline=match;row.pipelineSourceIds=[...new Set([...(row.pipelineSourceIds??[]),...sourceIds])];}else{row.transactionObservation=match;row.transactionSourceIds=[...new Set([...(row.transactionSourceIds??[]),...sourceIds])];}}}
   if(args.outcome==='unbatch'){
    need(args.table==='batches'&&['READY','FAILED','CANCELED'].includes(row.status),'OPERATION_STATE','Release members from a batch whose original request is ready, failed or canceled.');
    for(const id of row.eventIds){const member=selected(state.events,id,'Batch member');need(member.batchId===row.id&&!member.inflight,'BATCH_MEMBER_CHANGED','The original member changed.');
     member.batchId=null;if(['READY','FAILED','CANCELED'].includes(member.status))member.status='READY';member.updatedAt=now();}
    row.status='CANCELED';
   }
   if(args.outcome==='keep-original'){need(args.table==='events'&&row.conflicts.length>0,'EVENT_CONFLICT_REQUIRED','Select an event with retained changed bodies.');row.paused=false;}
   const decision=sealed({schema:'stellar-forge.fuul-programmes.operation-decision.v1',id:randomUUID(),table:args.table,operationId:row.id,
    outcome:args.outcome,actor:args.actor,reason:args.reason,sourceIds,match,createdAt:now()});
   const file=await retainJSON(directory,args.table+'/'+row.id+'/decisions/'+decision.id+'.json',decision);
   row.decisions.push({id:decision.id,file,outcome:decision.outcome,createdAt:decision.createdAt});row.updatedAt=now();
   return {table:args.table,id:row.id,status:row.status,decisionId:decision.id};
  });
 }


 async function actionCatalog(){
  check();return [...connectionMap.values()].map(value=>({connection:clone(value.summary),
   catalog:typeof value.adapter.actionCatalog==='function'?value.adapter.actionCatalog():clone(value.adapter.actionCatalog??[])}));
 }
 const encodePrepared=encodeValue,decodePrepared=decodeValue;
 async function actionPrepare(args){
  check();identifier(args.requestId);
  return withLock(directory,'preparation-'+args.requestId+'.lock',async()=>{
   const initial=await readState(directory),prior=replay(initial,'action.prepare',args);if(prior)return prior;
   revision(initial,args);
   const programme=await originalVersion(directory,initial,args.programmeId,args.programmeVersion),chosen=forProgramme(connection(args.connectionAlias),programme);
   text(args.operation,'original action',100);need(plain(args.input),'INVALID_ARGUMENT','Supply the complete original action input.');
   const intentHash=intent('action.prepare',args).intentSha256,root='preparations/'+args.requestId;let native;
   try{
    const saved=verified(await files.readJSON(directory,root+'/prepared.json'),'Original prepared action');
    need(saved.intentSha256===intentHash&&saved.programmeSha256===programme.sha256&&canonical(saved.connection)===canonical(chosen.summary),'PREPARATION_CHANGED','Continue this action with its original preparation arguments.');
    native=decodePrepared(saved.native);
   }catch(error){
    if(error.code!=='ENOENT')throw error;
    try{native=await prepareFuulAction({connection:chosen.private,operation:args.operation,input:clone(args.input),programme,signal});}
    catch(problem){native={preparationFailure:publicError(problem,privateSecrets(chosen.private)),observations:problem.observations??[]};}
    need(plain(native)&&(plain(native.request)||native.preparationFailure),'INVALID_NATIVE_ACTION','The native preparation must return its complete original request or original failure.');
    await retainJSON(directory,root+'/prepared.json',sealed({schema:'stellar-forge.fuul-programmes.preparation.v1',intentSha256:intentHash,
     programmeSha256:programme.sha256,connection:chosen.summary,native:encodePrepared(native),createdAt:now()}));
   }
   return mutate(directory,'action.prepare',args,async state=>{
    const current=await originalVersion(directory,state,programme.id,programme.version);
    need(current.sha256===programme.sha256,'PROGRAMME_CHANGED','The original programme changed while the provider configuration was read.');
    if(native.preparationFailure){
     const sourceIds=await retainExchanges(state,native.observations??[],{programmeId:programme.id,programmeVersion:programme.version,provider:chosen.summary.provider,
      kind:args.operation,network:chosen.summary.network,connection:chosen.summary,sourceScope:chosen.summary.sourceScope,label:args.operation+' preparation',
      runtimeConfiguration:chosen.private.runtime??null},root+'/failed');
     return {preparationId:args.requestId,status:'FAILED',sourceIds,error:native.preparationFailure};
    }
    async function save(value,id,parentActionId=null){
     need(plain(value.request)&&typeof value.request.method==='string'&&typeof value.request.path==='string','INVALID_NATIVE_ACTION','Each prepared action needs its original method and path.');
     const operation=value.operation??value.kind; text(operation,'prepared native operation',100);
     const hasBody=own(value.request,'body')&&value.request.body!==undefined||value.request.bodyBytes!==undefined;
     const body=value.request.bodyBytes!==undefined?Buffer.from(value.request.bodyBytes):hasBody?jsonBytes(value.request.body):Buffer.alloc(0);
     if(value.request.bodyBytes!==undefined){
      need(!value.request.bodySha256||digest(body)===value.request.bodySha256,'REQUEST_CHANGED','The native prepared request bytes differ.');
      if(own(value.request,'body'))need(canonical(JSON.parse(body.toString('utf8')))===canonical(value.request.body),'REQUEST_CHANGED','The native prepared body differs from its original bytes.');
     }
     const bodyFile=await files.writeNew(directory,'actions/'+id+'/request.body',body),prerequisiteIds=[];
     let index=0;for(const child of value.prerequisites??[]){const childId=derivedId(id+':prerequisite:'+index++);await save(child,childId,id);prerequisiteIds.push(childId);}
     const sourceIds=await retainExchanges(state,value.observations??value.exchanges??[],{programmeId:programme.id,programmeVersion:programme.version,provider:chosen.summary.provider,
      kind:operation,network:chosen.summary.network,connection:chosen.summary,sourceScope:chosen.summary.sourceScope,label:operation+' preparation',runtimeConfiguration:chosen.private.runtime??null},'actions/'+id+'/preparation');
     const manifest=sealed({...clean({...value,observations:undefined,exchanges:undefined,prerequisites:undefined,request:undefined}),
      schema:'stellar-forge.fuul-programmes.action-intent.v1',id,kind:'action',operation,programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
      projectId:programme.definition.projectId,network:programme.definition.network,connectionAlias:args.connectionAlias,connection:chosen.summary,parentActionId,prerequisiteIds,preparationSourceIds:sourceIds,
      request:{...opaqueRequest({...value.request,body:undefined,bodyBytes:undefined}),hasBody,bodyFile,bodySha256:digest(body)},createdAt:now()});
     const file=await retainJSON(directory,'actions/'+id+'/action.json',manifest);
     state.actions[id]={id,kind:'action',operation,programmeId:programme.id,programmeVersion:programme.version,projectId:programme.definition.projectId,network:programme.definition.network,
      connectionAlias:args.connectionAlias,connection:clone(chosen.summary),bodyFile,bodySha256:digest(body),file,preparationSourceIds:sourceIds,
      prerequisiteIds,parentActionId,status:'READY',paused:false,attempts:[],inflight:null,decisions:[],runtime:value.runtime??null,createdAt:manifest.createdAt,updatedAt:manifest.createdAt};
    }
    const id=derivedId(args.requestId+':action');await save(native,id);
    return {actionId:id,action:compactRow('actions',state.actions[id])};
   });
  });
 }
 async function eventObserve(args){
  check();identifier(args.eventId);
  const begun=await withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,'event.observe',args);if(prior)return {completed:prior};
   const row=selected(before.events,args.eventId,'Event');
   let observation=(row.observations??[]).find(item=>item.requestId===args.requestId);
   if(observation){
    need(observation.intentSha256===intent('event.observe',args).intentSha256,'REQUEST_ID_CONFLICT','The original event observation has different arguments.');
    return {event:clone(row),observation:clone(observation)};
   }
   revision(before,args);const chosen=connection(args.connectionAlias??row.connectionAlias);
   need(chosen.summary.provider==='fuul'&&chosen.summary.projectId===row.projectId&&chosen.summary.network===row.network,'PROJECT_MISMATCH','Observe the event using its original Fuul project and network.');
   const next=clone(before),captureId=derivedId(args.requestId+':pipeline'),read={kind:'pipeline',filters:{dedup_id:row.dedupId,event_name:row.eventName}};
   const programme=await originalVersion(directory,before,row.programmeId,row.programmeVersion);
   next.captures[captureId]={id:captureId,programmeId:row.programmeId,programmeVersion:row.programmeVersion,programmeSha256:programme.sha256,
    name:row.eventName+' / '+row.dedupId,provider:'fuul',connectionAlias:args.connectionAlias??row.connectionAlias,connection:clone(chosen.summary),
    read,nextRead:read,status:'READY',paused:false,sources:[],attempts:[],inflight:null,run:null,lastError:null,createdAt:now(),updatedAt:now()};
   observation={requestId:args.requestId,intentSha256:intent('event.observe',args).intentSha256,args:clone(args),captureId,startedAt:now()};
   next.events[row.id].observations.push(observation);
   await commitState(directory,before,next,'event.observe.begin',args,{eventId:row.id,captureId},{recordRequest:false});
   return {event:clone(next.events[row.id]),observation};
  });
  if(begun.completed)return begun.completed;
  const {event,observation}=begun;
  for(;;){
   const state=await readState(directory),capture=selected(state.captures,observation.captureId,'Pipeline capture');
   if(capture.status==='COMPLETE')break;
   if(capture.paused||capture.status==='FAILED'||signal?.aborted)return {workspaceId:state.workspaceId,revision:state.revision,requestId:args.requestId,eventId:event.id,captureId:capture.id,status:capture.status,error:capture.lastError,originalArguments:args};
   const nextArgs=capture.inflight?.args??{captureId:capture.id,requestId:derivedId(args.requestId+':pipeline-page:'+capture.attempts.length),expectedRevision:state.revision};
   try{await captureNext(nextArgs);}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}
  }
  return withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,'event.observe',args);if(prior)return prior;
   const next=clone(before),row=selected(next.events,event.id,'Event'),capture=selected(next.captures,observation.captureId,'Pipeline capture');
   const original=verified(await readRecord(directory,row)),records=await recordsFor(directory,next,capture.sources),match=await matchFuulPipeline({event:{...row,...original},records});
   row.pipelineSourceIds=[...new Set([...(row.pipelineSourceIds??[]),...capture.sources])];row.pipeline=clone(match);row.updatedAt=now();
   const selectedObservation=row.observations.find(item=>item.requestId===args.requestId);selectedObservation.finishedAt=now();selectedObservation.result=clone(match);
   if(match.matched&&match.created===true&&match.bodyMatches!==false&&!row.inflight&&['UNCERTAIN','FAILED','BATCH_OBSERVED','DUPLICATE'].includes(row.status)){
    row.status='OBSERVED';row.observedAt=now();
   }
   if(match.bodyMatches===false)row.paused=true;
   return commitState(directory,before,next,'event.observe',args,{eventId:row.id,captureId:capture.id,status:row.status,pipeline:match,sourceIds:capture.sources});
  });
 }
 async function runStart(args){
  check();return mutate(directory,'run.start',args,async state=>{
   need(['event-delivery','event-observation','action-dispatch'].includes(args.kind),'INVALID_RUN','Select event delivery, event observation or action dispatch.');
   const programme=await originalVersion(directory,state,args.programmeId,args.programmeVersion);
   const table=args.kind==='action-dispatch'?'actions':'events';
   let ids=unique(args.ids??Object.values(state[table]).filter(row=>row.programmeId===programme.id&&
    (args.kind==='event-observation'||(row.status==='READY'&&!row.paused&&!row.parentActionId&&!row.batchId))).map(row=>row.id),'selected operation IDs');
   for(const id of ids){const row=selected(state[table],id,'Selected operation');need(row.programmeId===programme.id,'PROGRAMME_MISMATCH','Select operations belonging to this programme.');}
   const id=randomUUID(),tasks=[],batchSize=integer(args.batchSize??100,'batch size',1,100);
   if(args.kind==='event-delivery'){
    const groups=new Map();for(const eventId of ids){const row=state.events[eventId];need(row.status==='READY'&&!row.paused&&!row.batchId&&!row.inflight,'EVENT_STATE','Select unbatched ready events.');
     const key=row.connectionAlias+':'+digest(jsonBytes(row.connection));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(eventId);}
    for(const group of groups.values())for(let offset=0;offset<group.length;offset+=batchSize)tasks.push({id:derivedId(id+':task:'+tasks.length),eventIds:group.slice(offset,offset+batchSize),status:'READY',result:null});
   }else for(const objectId of ids)tasks.push({id:derivedId(id+':task:'+tasks.length),objectId,status:'READY',result:null});
   const manifest=sealed({schema:'stellar-forge.fuul-programmes.run.v1',id,kind:args.kind,programmeId:programme.id,programmeVersion:programme.version,
    ids,batchSize,connectionAlias:args.connectionAlias??null,tasks:tasks.map(row=>clone(row)),createdAt:now()});
   const file=await retainJSON(directory,'runs/'+id+'/run.json',manifest);
   state.runs[id]={id,kind:args.kind,name:text(args.name??programme.name+' '+args.kind,'run name'),programmeId:programme.id,programmeVersion:programme.version,
    connectionAlias:args.connectionAlias??null,tasks,position:0,status:tasks.length?'READY':'COMPLETE',paused:false,execution:null,lastError:null,
    createdAt:manifest.createdAt,updatedAt:manifest.createdAt,file};
   return {runId:id,run:compactRow('runs',state.runs[id])};
  });
 }
 async function runRead({runId,...args}){
  check();const row=selected((await readState(directory)).runs,runId,'Run');return {run:compactRow('runs',row),...rowsPage(row.tasks,args)};
 }
 async function runPause(args){
  check();return mutate(directory,'run.pause',args,async state=>{const row=selected(state.runs,args.runId,'Run');row.paused=true;if(row.status!=='COMPLETE')row.status='PAUSED';row.updatedAt=now();
   return {runId:row.id,status:row.status,originalArguments:row.execution?.args??null};});
 }
 async function runResume(args){
  check();return mutate(directory,'run.resume',args,async state=>{const row=selected(state.runs,args.runId,'Run');row.paused=false;if(row.status!=='COMPLETE')row.status='READY';row.lastError=null;row.updatedAt=now();
   return {runId:row.id,status:row.status,originalArguments:row.execution?.args??null};});
 }
 async function runExecute(args){
  check();identifier(args.runId);
  return withLock(directory,'run-'+args.runId+'.lock',async()=>{
   const started=await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.execute',args);if(prior)return {completed:prior};
    const row=selected(before.runs,args.runId,'Run');
    if(row.execution){need(row.execution.args.requestId===args.requestId&&row.execution.intentSha256===intent('run.execute',args).intentSha256,'RUN_ACTIVE','Continue the original complete run.',{originalArguments:row.execution.args});return {};}
    revision(before,args);const next=clone(before),working=next.runs[row.id];working.execution={args:clone(args),intentSha256:intent('run.execute',args).intentSha256,startedAt:now()};
    working.status=working.paused?'PAUSED':'RUNNING';await commitState(directory,before,next,'run.execute.begin',args,{runId:row.id},{recordRequest:false});return {};
   });
   if(started.completed)return started.completed;
   for(;;){
    check();const current=await readState(directory),run=selected(current.runs,args.runId,'Run');
    if(run.paused||signal?.aborted)return {workspaceId:current.workspaceId,revision:current.revision,runId:run.id,status:run.paused?'PAUSED':'INTERRUPTED',position:run.position,total:run.tasks.length,originalArguments:args};
    if(run.position>=run.tasks.length)return withLock(directory,'writer.lock',async()=>{
     await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.execute',args);if(prior)return prior;
     const next=clone(before),row=next.runs[run.id];row.status='COMPLETE';row.updatedAt=now();row.completedAt=now();
     return commitState(directory,before,next,'run.execute',args,{runId:run.id,status:'COMPLETE',tasks:row.tasks.length,completedAt:row.completedAt});
    });
    const task=run.tasks[run.position];let result,error=null;
    try{
     if(run.kind==='event-delivery'){
      let table,id;
      if(task.eventIds.length===1){table='events';id=task.eventIds[0];}
      else{
       const selected=await readState(directory),prepared=await batchPrepare({eventIds:task.eventIds,requestId:derivedId(task.id+':prepare'),expectedRevision:selected.revision});
       table='batches';id=prepared.batchId;
      }
      const selected=await readState(directory),row=selected[table][id];
      if(['ACCEPTED','DUPLICATE','BATCH_OBSERVED','OBSERVED'].includes(row.status))result={table,id,status:row.status};
      else if(row.paused||!['READY','SENDING'].includes(row.status))result={table,id,status:row.status,error:row.lastError??null};
      else result=await dispatch(row.inflight?.args??{table,id,requestId:derivedId(task.id+':dispatch'),expectedRevision:selected.revision});
     }else if(run.kind==='event-observation'){
      const selected=await readState(directory);
      result=await eventObserve({eventId:task.objectId,...(run.connectionAlias?{connectionAlias:run.connectionAlias}:{}),
       requestId:derivedId(task.id+':observe'),expectedRevision:selected.revision});
     }else{
      const selected=await readState(directory),row=selected.actions[task.objectId];
      if(['ACCEPTED','OBSERVED'].includes(row.status))result={table:'actions',id:row.id,status:row.status};
      else if(row.paused||!['READY','SENDING'].includes(row.status))result={table:'actions',id:row.id,status:row.status,error:row.lastError??null};
      else result=await dispatch(row.inflight?.args??row.prerequisiteRun?.args??{table:'actions',id:row.id,requestId:derivedId(task.id+':dispatch'),expectedRevision:selected.revision});
     }
    }catch(problem){if(problem.code==='REVISION_CONFLICT')continue;error=errorStatus(problem);}
    const complete=!error&&(run.kind==='event-observation'?Boolean(result?.pipeline):['ACCEPTED','DUPLICATE','BATCH_OBSERVED','OBSERVED'].includes(result?.status));
    await withLock(directory,'writer.lock',async()=>{
     await recoverState(directory);const before=await readState(directory),next=clone(before),working=next.runs[run.id];
     need(working.position===run.position,'RUN_CHANGED','The original run position changed.');
     working.tasks[run.position].result=clean(result??null);working.tasks[run.position].error=error;working.tasks[run.position].status=complete?'COMPLETE':'WAITING';
     if(complete){working.position++;working.status=working.paused?'PAUSED':'RUNNING';}
     else{working.status='WAITING';working.lastError=error??result?.error??{code:'ORIGINAL_OPERATION_PENDING',message:'Review or resume the original operation shown in this run.'};}
     working.updatedAt=now();
     await commitState(directory,before,next,'run.step',{requestId:randomUUID(),expectedRevision:before.revision,runId:run.id,position:run.position},
      {runId:run.id,position:working.position,status:working.status});
    });
    if(!complete){const latest=await readState(directory);return {workspaceId:latest.workspaceId,revision:latest.revision,runId:run.id,status:'WAITING',
     position:run.position,result,error,originalArguments:args};}
   }
  });
 }


 async function decisionSave(args){
  check();return mutate(directory,'decision.save',args,async state=>{
   const programme=await originalVersion(directory,state,args.programmeId,args.programmeVersion);
   need(['exclude','include','link'].includes(args.action),'INVALID_DECISION','Select exclude, include or an explicit original-reference link.');
   text(args.actor,'decision actor',255);text(args.reason,'decision reason',4000);
   const source=selected(state.sources,args.sourceId,'Original decision source');
   need(source.programmeId===null||source.programmeId===programme.id,'PROGRAMME_SOURCE_MISMATCH','Select an original source for this programme.');
   const records=source.projectionFile?await readRecord(directory,source.projectionFile):[],record=records.find(row=>row.id===args.recordId);
   need(record,'NOT_FOUND','The selected original record is absent.');
   let link=null;
   if(args.action==='link'){
    need(plain(args.link)&&Object.keys(args.link).length>0,'INVALID_DECISION','Supply the selected original reference.');
    const fields=['eventId','dedupId','eventName','payoutId','transactionHash'];
    need(Object.keys(args.link).every(key=>fields.includes(key)),'INVALID_DECISION','Use event, payout or transaction references.');
    for(const [key,value] of Object.entries(args.link))text(value,key,1024);link=clone(args.link);
   }
   if(args.supersedes){const previous=selected(state.decisions,args.supersedes,'Previous decision');
    need(previous.programmeId===programme.id&&previous.recordId===record.id,'DECISION_MISMATCH','Supersede a decision for this programme and original record.');}
   const id=randomUUID(),decision=sealed({schema:'stellar-forge.fuul-programmes.decision.v1',id,programmeId:programme.id,programmeVersion:programme.version,
    programmeSha256:programme.sha256,sourceId:source.id,recordId:record.id,action:args.action,link,actor:args.actor,reason:args.reason,supersedes:args.supersedes??null,createdAt:now()});
   const file=await retainJSON(directory,'decisions/'+id+'.json',decision);
   state.decisions[id]={id,programmeId:programme.id,programmeVersion:programme.version,sourceId:source.id,recordId:record.id,action:decision.action,link,
    actor:decision.actor,reason:decision.reason,supersedes:decision.supersedes,createdAt:decision.createdAt,file,sha256:decision.sha256};
   return {decisionId:id,decision:clone(state.decisions[id])};
  });
 }
 async function decisionRead({decisionId}){check();return verified(await readRecord(directory,selected((await readState(directory)).decisions,decisionId,'Decision')));}
 async function reconcileCreate(args){
  check();return mutate(directory,'reconciliation.create',args,async state=>{
   const programme=await originalVersion(directory,state,args.programmeId,args.programmeVersion);
   const sourceIds=unique(args.sourceIds??[...new Set([...(programme.definition.providerSourceIds??[]),...Object.values(state.sources).filter(row=>row.programmeId===programme.id).map(row=>row.id)])],'source IDs');
   for(const id of sourceIds){const source=selected(state.sources,id,'Original source');need(source.programmeId===null||source.programmeId===programme.id,'PROGRAMME_MISMATCH','Select sources from this programme.');}
   const records=await recordsFor(directory,state,sourceIds),recordIds=new Set(records.map(row=>row.id));
   const decisionIds=unique(args.decisionIds??Object.values(state.decisions).filter(row=>row.programmeId===programme.id&&recordIds.has(row.recordId)).map(row=>row.id),'decision IDs'),decisions=[];
   for(const id of decisionIds){const row=selected(state.decisions,id,'Decision');need(row.programmeId===programme.id&&recordIds.has(row.recordId),'DECISION_MISMATCH','Select decisions for the original records in this edition.');decisions.push(verified(await readRecord(directory,row)));}
   const events=[],actions=[];
   for(const row of Object.values(state.events).filter(row=>row.programmeId===programme.id)){
    const original=verified(await readRecord(directory,row));events.push({...clone(row),...original,body:original.native.body});
   }
   for(const row of Object.values(state.actions).filter(row=>row.programmeId===programme.id)){
    const original=verified(await readRecord(directory,row)),body=await readDescriptor(directory,row.bodyFile);actions.push({...clone(row),...original,body:body.length?JSON.parse(body.toString('utf8')):null});
   }
   const asOf=args.asOf??now();need(typeof asOf==='string'&&Number.isFinite(Date.parse(asOf)),'INVALID_ARGUMENT','Supply an ISO date and time.');
   const data=await reconcileFuulProgramme({programme,records,events,actions,decisions,asOf});
   need(plain(data)&&['events','pipelines','allocations','movements','claims','exceptions'].every(key=>Array.isArray(data[key])),'INVALID_RECONCILIATION','The native reconciliation must preserve every event, allocation and claim section.');
   const id=randomUUID(),edition=sealed({schema:EDITION_SCHEMA,id,kind:'reconciliation',name:text(args.name??programme.name+' operating edition','edition name'),
    programme:{id:programme.id,version:programme.version,sha256:programme.sha256},sourceIds,decisionIds,asOf,createdAt:now(),
    sourceWarnings:sourceIds.filter(sourceId=>state.sources[sourceId].error).map(sourceId=>({sourceId,error:state.sources[sourceId].error})),data});
   const file=await retainJSON(directory,'reconciliations/'+id+'.json',edition);
   state.reconciliations[id]={id,name:edition.name,programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,
    sourceIds,decisionIds,asOf,createdAt:edition.createdAt,summary:clone(data.summary),sourceWarnings:edition.sourceWarnings,file,sha256:edition.sha256};
   return {reconciliationId:id,reconciliation:clone(state.reconciliations[id])};
  });
 }
 async function fullEdition(id){return verified(await readRecord(directory,selected((await readState(directory)).reconciliations,id,'Reconciliation')));}
 async function editionRead({reconciliationId,section,...args}){
  check();const edition=await fullEdition(reconciliationId);
  if(section){need(Array.isArray(edition.data[section]),'INVALID_SECTION','Select events, pipelines, allocations, movements, claims or exceptions.');return {edition:{...edition,data:undefined},section,...rowsPage(edition.data[section],args)};}
  const data=clone(edition.data),pages={};for(const [key,value] of Object.entries(data))if(Array.isArray(value)){const page=rowsPage(value,args);data[key]=page.rows;pages[key]={offset:page.offset,limit:page.limit,total:page.total,nextOffset:page.nextOffset};}
  return {...edition,data,pages};
 }
 async function editionFile({reconciliationId,offset=0,length=1024*1024}){
  check();const row=selected((await readState(directory)).reconciliations,reconciliationId,'Reconciliation');
  integer(offset,'offset');integer(length,'length',1,4*1024*1024);const result=await files.sourceFileRange(directory,row.file,offset,length);
  return {reconciliationId,file:row.file,filename:'fuul-edition-'+reconciliationId+'.json',contentType:'application/json',offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }
 async function compare({leftId,rightId}){
  check();const [left,right]=await Promise.all([fullEdition(leftId),fullEdition(rightId)]);
  need(left.programme.id===right.programme.id,'PROGRAMME_MISMATCH','Compare retained editions of the same programme.');
  return {leftId,rightId,...await compareFuulReconciliations(left.data,right.data)};
 }
 async function reportCreate(args){
  check();return mutate(directory,'report.create',args,async state=>{
   const edition=verified(await readRecord(directory,selected(state.reconciliations,args.reconciliationId,'Reconciliation')));
   const programme=await originalVersion(directory,state,edition.programme.id,edition.programme.version);
   need(programme.sha256===edition.programme.sha256,'SOURCE_CHANGED','The original edition programme differs.');
   const formats=unique(args.formats??['html','json','csv'],'report formats');
   need(formats.length>0&&formats.every(format=>['html','json','csv'].includes(format)),'INVALID_ARGUMENT','Select HTML, JSON or CSV reports.');
   const id=randomUUID(),members=[];let scope=null;
   for(const format of formats){
    const artifact=await buildFuulReport({edition:edition.data,programme,format,projectId:args.projectId,userIdentifier:args.userIdentifier});
    need(typeof artifact.body==='string'||Buffer.isBuffer(artifact.body),'INVALID_REPORT','The report renderer must return its full artifact body.');
    const body=Buffer.isBuffer(artifact.body)?artifact.body:Buffer.from(artifact.body,'utf8'),filename=safeFilename(artifact.filename);
    const file=await files.writeNew(directory,'reports/'+id+'/files/'+filename,body);
    if(scope)need(canonical(scope)===canonical(artifact.scope),'REPORT_SCOPE_CHANGED','Every report format must use the same original scope.');
    scope=clone(artifact.scope);members.push({format,filename,contentType:artifact.contentType,file,bytes:body.length,sha256:digest(body)});
   }
   const report=sealed({schema:'stellar-forge.fuul-programmes.report.v1',id,name:text(args.name??edition.name+' report','report name'),
    programmeId:programme.id,programmeVersion:programme.version,programmeSha256:programme.sha256,reconciliationId:edition.id,reconciliationSha256:edition.sha256,
    projectId:args.projectId??programme.definition.projectId,userIdentifier:args.userIdentifier??null,scope,formats,files:members,createdAt:now()});
   const file=await retainJSON(directory,'reports/'+id+'/report.json',report);
   state.reports[id]={id,name:report.name,programmeId:programme.id,programmeVersion:programme.version,reconciliationId:edition.id,projectId:report.projectId,userIdentifier:report.userIdentifier,
    scope,formats,files:members,createdAt:report.createdAt,file,sha256:report.sha256};
   return {reportId:id,report:clone(state.reports[id])};
  });
 }
 async function reportRead({reportId}){check();return verified(await readRecord(directory,selected((await readState(directory)).reports,reportId,'Report')));}
 async function reportFile({reportId,format='html',offset=0,length=1024*1024}){
  check();const report=await reportRead({reportId}),member=report.files.find(row=>row.format===format);
  need(member,'REPORT_FORMAT_NOT_FOUND','Select a retained report format.',{formats:report.formats});
  integer(offset,'offset');integer(length,'length',1,4*1024*1024);const result=await files.sourceFileRange(directory,member.file,offset,length);
  return {reportId,format,filename:member.filename,contentType:member.contentType,file:member.file,offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }
 async function runtimeSelections(){
  check();const state=await readState(directory),used=new Map();
  for(const row of [...Object.values(state.sources),...Object.values(state.captures),...Object.values(state.actions)]){
   if(!row.runtime)continue;const existing=used.get(row.runtime.id);need(!existing||existing.manifestSha256===row.runtime.manifestSha256,'RUNTIME_CHANGED','One original runtime ID names different manifests.');used.set(row.runtime.id,row.runtime);
  }
  const selections=[];
  for(const runtime of used.values()){
   const aliases=new Set([...Object.values(state.captures),...Object.values(state.actions)].filter(row=>row.runtime?.id===runtime.id).map(row=>row.connectionAlias));
   for(const row of Object.values(state.sources).filter(row=>row.runtime?.id===runtime.id)){const original=await readRecord(directory,row);if(original.connection?.alias)aliases.add(original.connection.alias);}
   let chosen=null;
   for(const alias of aliases){
    const config=connectionMap.get(alias)?.private.runtime;if(!config)continue;
    need(config.retained===undefined||Array.isArray(config.retained),'INVALID_RUNTIME_CONFIGURATION','Supply retained runtime generations as an array.');
    const retained=config.retained?.find(item=>item.id===runtime.id&&(item.expectedManifestSha256??item.manifestSha256)===runtime.manifestSha256);
    if(retained){const selectedDirectory=retained.runtimeDirectory??retained.directory;text(selectedDirectory,'retained runtime directory',4096);chosen={directory:selectedDirectory,expectedManifestSha256:runtime.manifestSha256};break;}
    if(config.runtimeDirectory&&(!config.expectedManifestSha256||config.expectedManifestSha256===runtime.manifestSha256))chosen={directory:config.runtimeDirectory,expectedManifestSha256:runtime.manifestSha256};
   }
   need(chosen,'RUNTIME_SOURCE_REQUIRED','Bind the original retained SDK runtime used by this source.',{runtime,connectionAliases:[...aliases]});selections.push(chosen);
  }
  return selections;
 }
 async function close(){
  if(closed)return;closed=true;
  const results=await Promise.allSettled([...connectionMap.values()].filter(value=>value.adapter.close).map(value=>value.adapter.close()));
  const error=results.find(result=>result.status==='rejected');if(error)throw error.reason;
 }
 return {describe,list,sourceCatalog,actionCatalog,profileSave,programmeSave,programmeRead,sourceImport,sourceProject,sourceRead,sourceFile,
  captureStart,captureRead,captureNext,captureRun,capturePause,captureResume,eventPrepare,eventObserve,batchPrepare,queueRead,queueFile,queuePause,queueResume,queueResolve,dispatch,
  actionPrepare,runStart,runRead,runExecute,runPause,runResume,decisionSave,decisionRead,reconcileCreate,editionRead,editionFile,compare,reportCreate,reportRead,reportFile,runtimeSelections,close};
}
