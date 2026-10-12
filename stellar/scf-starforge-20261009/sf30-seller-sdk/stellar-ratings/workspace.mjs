// MIT. Complete Stellar registry, wallet and daily activity workspace.
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
import {openRatingsSource,parseRatingsJSON,parseRatingsCSV,prepareRatingsWalletPlan,prepareRatingsActivityPlan,prepareRatingsAccounts} from './native.mjs';
import {normalizeRatingsRegistry,normalizeWalletPolicy,normalizeRatingsRecords,reviewStellarWallet,buildStellarActivity,compareRatingsEditions,buildRatingsReport} from './reconciliation.mjs';
import {resolveRatingsRuntime} from './runtime.mjs';
import {ratingsNetwork} from './lossless-json.mjs';
export const RATINGS_WORKSPACE_SCHEMA=STATE_SCHEMA;
const PROVIDERS=['bluechip','horizon','stellar-expert','stellar','source','activity','document'];
const clean=value=>clone(value);
function derivedId(value){
 const hex=digest(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
function unique(value,label){
 need(Array.isArray(value),'INVALID_ARGUMENT','Supply '+label+' as an array.');
 need(new Set(value).size===value.length,'INVALID_ARGUMENT','Select each '+label+' once.');return value;
}
function versioned(table,id,version){
 const record=selected(table,id,'Registry'),n=version??record.currentVersion;integer(n,'registry version',1);
 const entry=record.versions.find(row=>row.version===n);need(entry,'VERSION_NOT_FOUND','Select a retained registry version.');return entry;
}
async function originalVersion(directory,state,id,version){return verified(await readRecord(directory,versioned(state.registries,id,version)),'Original registry');}
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
 const selected=format||(['activity','source'].includes(provider)&&(/(?:text|application)\/csv/i.test(contentType??'')||/\.csv$/i.test(filename??''))?'csv':'json');
 need(selected!=='csv'||['activity','source'].includes(provider),'INVALID_SOURCE_FORMAT','Native source responses retain their original format.');
 return selected;
}
function parseSource(body,format){return format==='csv'?parseRatingsCSV(body):parseRatingsJSON(body);}
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
 if(args.registryId)rows=rows.filter(row=>row.registryId===args.registryId||row.id===args.registryId);
 if(args.status)rows=rows.filter(row=>row.status===args.status);
 if(args.kind)rows=rows.filter(row=>row.kind===args.kind);
 if(args.query){const query=String(args.query).toLocaleLowerCase();rows=rows.filter(row=>[row.id,row.name,row.label,row.account,row.kind,row.network,row.utcDate,row.collectionId].some(value=>String(value??'').toLocaleLowerCase().includes(query)));}
 return rows.sort((a,b)=>String(b.updatedAt??b.createdAt??b.observedAt??'').localeCompare(String(a.updatedAt??a.createdAt??a.observedAt??''))||String(a.id).localeCompare(String(b.id)));
}
function compactRow(table,row){
 const value=clone(row);
 if(table==='captures'){value.sourceCount=row.sources.length;value.attemptCount=row.attempts.length;delete value.sources;delete value.attempts;}
 if(['registries','policies','collections'].includes(table)){value.versionCount=row.versions.length;value.versions=row.versions.slice(-3);}
 if(table==='sources'){delete value.request;delete value.response;}
 if(table==='runs'){value.taskCount=row.tasks?.length??0;delete value.tasks;delete value.planObservations;}
 if(table==='lookups')delete value.editionIds;
 return value;
}
function summarizeState(state,connections=[]){
 const result={schema:state.schema,workspaceId:state.workspaceId,createdAt:state.createdAt,updatedAt:state.updatedAt,revision:state.revision,head:state.head,profile:clone(state.profile),connections:connections.map(clone),counts:{},pages:{}};
 for(const table of TABLES){const rows=orderedRows(state[table]);result.counts[table]=rows.length;
  const page=rowsPage(rows,{limit:100});result[table]=Object.fromEntries(page.rows.map(row=>[row.id,compactRow(table,row)]));
  result.pages[table]={offset:0,limit:100,total:page.total,nextOffset:page.nextOffset};}
 return result;
}
async function recordsFor(directory,state,sourceIds){
 const records=[];for(const id of sourceIds){const source=selected(state.sources,id,'Source');
  if(source.projectionFile)records.push(...await readRecord(directory,source.projectionFile));}return records;
}
async function retainSource(directory,state,{id=randomUUID(),captureId=null,registryId=null,registryVersion=null,provider,kind,network,
 connection=null,sourceScope=null,label,request={},response={},body,originalBodyFile=null,records,recordsPath=null,
 observedAt=now(),error=null,runtime=null,runtimeConfiguration=null,projectionRequest=null,format='json',mapping=null}){
 need(Buffer.isBuffer(body),'INVALID_SOURCE','Supply complete original source bytes.');
 network=network===null||network===undefined||network==='global'?null:ratingsNetwork(network).network;
 const root='sources/'+id,bodyFile=originalBodyFile??await files.writeNew(directory,root+'/original.body',body);
 need(bodyFile.bytes===body.length&&bodyFile.sha256===digest(body),'SOURCE_CHANGED','The original source differs from its retained bytes.');
 const requestFile=await retainJSON(directory,root+'/request.json',opaqueRequest(request));
 const responseFile=await retainJSON(directory,root+'/response.json',clean({status:response.status??null,headers:response.headers??{},body:bodyFile,bodyComplete:response.bodyComplete??true,
  startedAt:response.startedAt??null,elapsedMs:response.elapsedMs??null,observedAt,error:error?errorStatus(error):null}));
 let projected=[],projectionError=null;
 try{
  if(provider!=='document'&&!error){
   projected=await normalizeRatingsRecords({provider,kind,records,sourceId:id,captureId,sourceScope:sourceScope??id,observedAt,network,
    rawBody:body,recordsPath,format,mapping,runtime:runtimeConfiguration,request:projectionRequest??request,response:{status:response.status??null,bodyComplete:response.bodyComplete??true},status:response.status??null});
   need(Array.isArray(projected),'INVALID_NATIVE_PROJECTION','The original projection must return an array of records.');
   const used=projected.map(row=>row.runtime??row.projection?.runtime).filter(Boolean);if(!runtime&&used.length)runtime=used[0];
   for(const item of used)need(canonical(item)===canonical(runtime),'RUNTIME_CHANGED','One source must retain one original runtime.');
  }
 }catch(problem){projectionError=errorStatus(problem);projected=[];}
 const projectionFile=await retainJSON(directory,root+'/projection.json',projected);
 const manifest=sealed({schema:SOURCE_SCHEMA,id,captureId,registryId,registryVersion,provider,kind,network,connection:clone(connection),
  sourceScope:sourceScope??id,label:label??kind,observedAt,requestFile,responseFile,bodyFile,projectionFile,recordsPath,format,mapping:clone(mapping),
  projectionRequest:opaqueRequest(projectionRequest??request),runtime:runtime?clone(runtime):null,
  nativeRecords:Array.isArray(records)?records.length:0,selectedRecords:projected.length,error:error?errorStatus(error):projectionError});
 const file=await retainJSON(directory,root+'/source.json',manifest);
 state.sources[id]={id,captureId,registryId,registryVersion,provider,kind,network,sourceScope:manifest.sourceScope,label:manifest.label,observedAt,
  bodyFile,projectionFile,file,sha256:manifest.sha256,nativeRecords:manifest.nativeRecords,selectedRecords:projected.length,error:manifest.error,runtime:manifest.runtime};
 return {source:state.sources[id],projected,error:manifest.error};
}
export async function inspectStellarRatingsWorkspace({directory,allowMissing=false}){
 try{return summarizeState(await readState(directory));}catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
}
export async function openStellarRatingsWorkspace({directory,connections={},profile={},signal,applicationDirectory,installationDirectory,runtime={}}={}){
 await initialize(directory,profile);
 const defaultRuntime={...clone(runtime),installationDirectory:runtime.installationDirectory??installationDirectory??applicationDirectory??fileURLToPath(new URL('.',import.meta.url))};
 const connectionMap=new Map();
 for(const [alias,input] of Object.entries(connections)){
  const configuration=clone(input);
  if(configuration.provider==='stellar'){
   const original={...defaultRuntime,...configuration.runtime};
   configuration.runtime={...original,installationDirectory:original.installationDirectory??configuration.installationDirectory??applicationDirectory??fileURLToPath(new URL('.',import.meta.url)),
    runtimeDirectory:original.runtimeDirectory??configuration.runtimeDirectory??join(directory+'.runtimes',derivedId(alias)),
    expectedManifestSha256:original.expectedManifestSha256??configuration.expectedManifestSha256};
  }
  const summary=publicConnection(alias,configuration),adapter=openRatingsSource(configuration);
  const native=typeof adapter.descriptor==='function'?adapter.descriptor():adapter.descriptor??adapter.describe?.();
  need(plain(native),'INVALID_NATIVE_SOURCE','The native adapter must expose its original source descriptor.');
  Object.assign(summary,{sourceScope:native.id??digest(jsonBytes(native)),nativeSource:clone(native),network:native.network??summary.network,projectId:native.projectId??summary.projectId,contracts:native.contracts??configuration.contracts??null});
  connectionMap.set(alias,{summary,private:configuration,adapter});
 }
 let closed=false;
 const check=()=>need(!closed,'WORKSPACE_CLOSED','Reopen the Stellar ratings workspace.');
 function connection(alias,expected){
  const value=connectionMap.get(alias);need(value,'CONNECTION_REQUIRED','Configure the original named private connection.',{alias});
  if(expected)need(canonical(value.summary)===canonical(expected),'CONNECTION_CHANGED','The selected original project, network or service differs.',{alias});
  return value;
 }
 function forRegistry(value,registry){
  if(value.summary.network!==null&&value.summary.network!=='global')
   need(value.summary.network===registry.definition.network,'NETWORK_MISMATCH','Select the registry network connection.');
  return value;
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
 async function registrySave(args){
  check();return mutate(directory,'registry.save',args,async state=>{
   const id=args.registryId??randomUUID();identifier(id);
   const previous=args.registryId?selected(state.registries,id,'Registry'):null,version=(previous?.currentVersion??0)+1;
   if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected registry version',1),'REGISTRY_VERSION_CONFLICT','The registry has advanced.',{currentVersion:previous?.currentVersion??0});
   const definition=normalizeRatingsRegistry(args.definition),name=text(args.name??definition.name,'registry name');
   for(const sourceId of new Set(definition.assets.flatMap(row=>row.sourceIds??[])))selected(state.sources,sourceId,'Original registry source');
   const body=sealed({schema:'stellar-forge.stellar-ratings.registry.v1',id,version,name,definition,createdAt:now()});
   const file=await retainJSON(directory,'registries/'+id+'/'+version+'.json',body);
   const entry={id,version,name,network:definition.network,assetCount:definition.assets.length,sha256:body.sha256,file,createdAt:body.createdAt};
   state.registries[id]={id,name,network:definition.network,currentVersion:version,updatedAt:body.createdAt,versions:[...(previous?.versions??[]),entry]};
   return {registryId:id,version,registry:entry};
  });
 }
 async function registryRead({registryId,version}){check();return originalVersion(directory,await readState(directory),registryId,version);}
 async function policySave(args){
  check();return mutate(directory,'policy.save',args,async state=>{
   const id=args.policyId??randomUUID();identifier(id);
   const previous=args.policyId?selected(state.policies,id,'Wallet policy'):null,version=(previous?.currentVersion??0)+1;
   if(args.expectedVersion!==undefined)need(previous?.currentVersion===integer(args.expectedVersion,'expected policy version',1),'POLICY_VERSION_CONFLICT','The selected policy has advanced.');
   const definition=normalizeWalletPolicy(args.definition),name=text(args.name??definition.name,'policy name');
   for(const sourceId of definition.methodologySourceIds??[])selected(state.sources,sourceId,'Original methodology source');
   const body=sealed({schema:'stellar-forge.stellar-ratings.policy.v1',id,version,name,definition,createdAt:now()});
   const file=await retainJSON(directory,'policies/'+id+'/'+version+'.json',body);
   const entry={id,version,name,sha256:body.sha256,file,createdAt:body.createdAt,minimumCoveragePercent:definition.minimumCoveragePercent,gradeBandCount:definition.gradeBands?.length??0};
   state.policies[id]={id,name,currentVersion:version,updatedAt:body.createdAt,versions:[...(previous?.versions??[]),entry]};
   return {policyId:id,version,policy:entry};
  });
 }
 async function policyRead({policyId,version}){check();return verified(await readRecord(directory,versioned((await readState(directory)).policies,policyId,version)),'Original wallet policy');}

 async function sourceImport(args){
  check();return mutate(directory,'source.import',args,async state=>{
   need(PROVIDERS.includes(args.provider),'INVALID_SOURCE','Select an original native, imported data or document source.');
   text(args.kind??'document','source kind',100);need(typeof args.bodyBase64==='string','INVALID_SOURCE','Supply the complete source as base64.');
   const body=Buffer.from(args.bodyBase64,'base64');need(body.toString('base64')===args.bodyBase64,'INVALID_SOURCE','Use canonical complete base64.');
   const recordsPath=args.recordsPath??null,format=sourceFormat(args);let records=[],error=null;
   if(args.provider!=='document')try{records=projectionAt(parseSource(body,format).value,recordsPath);}catch(problem){error=errorStatus(problem);}
   const registry=args.registryId?await originalVersion(directory,state,args.registryId,args.registryVersion):null;
   const chosen=args.connectionAlias?connection(args.connectionAlias):null;
   if(chosen){need(chosen.summary.provider===args.provider,'INVALID_CONNECTION','Select the original source provider.');if(registry)forRegistry(chosen,registry);}
   if(['activity','source'].includes(args.provider))text(args.sourceScope,'original customer activity source scope',1024);
   const retained=await retainSource(directory,state,{registryId:registry?.id??null,registryVersion:registry?.version??null,provider:args.provider,kind:args.kind??'document',
    network:args.network??chosen?.summary.network??registry?.definition.network??null,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??defaultRuntime,
    label:args.label??args.filename??args.kind??'Original source',body,records,recordsPath,format,mapping:args.mapping??null,sourceScope:args.sourceScope??chosen?.summary.sourceScope??null,
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
   const retained=await retainSource(directory,state,{registryId:original.registryId,registryVersion:original.registryVersion,provider,kind:args.kind??original.kind,
    network:args.network??original.network,connection:chosen?.summary??null,runtimeConfiguration:chosen?.private.runtime??defaultRuntime,label:args.label??original.label,
    body,originalBodyFile:original.bodyFile,records,recordsPath:args.recordsPath??null,format,mapping:args.mapping??full.mapping??null,sourceScope:args.sourceScope??full.sourceScope,
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
   const registry=await originalVersion(directory,state,args.registryId,args.registryVersion),chosen=forRegistry(connection(args.connectionAlias),registry),read=clone(args.read);
   need(plain(read)&&typeof read.kind==='string','INVALID_ARGUMENT','Select an original native read.');
   const id=randomUUID(),capture={id,registryId:registry.id,registryVersion:registry.version,registrySha256:registry.sha256,network:registry.definition.network,
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
   recordsFile,recordsPath:result.recordsPath??null,mapping:result.mapping??null,format:result.format??'json',continuation:result.continuation??{done:true,next:null},runtime:result.runtime??null,
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
    if(!nativeError)try{records=saved.recordsFile?await readRecord(directory,saved.recordsFile):projectionAt(parseRatingsJSON(body).value,saved.recordsPath);}catch(problem){nativeError=errorStatus(problem);}
    if(!nativeError&&!saved.continuation?.done&&working.attempts.some(item=>canonical(item.read)===canonical(saved.continuation.next)))
     nativeError={code:'CYCLIC_NATIVE_CURSOR',message:'The original provider returned a previously retained continuation.'};
    const context={captureId:capture.id,registryId:capture.registryId,registryVersion:capture.registryVersion,provider:capture.provider,kind:pending.read.kind,
     network:capture.network??capture.connection.network,connection:capture.connection,sourceScope:capture.connection.sourceScope,label:capture.name,
     runtimeConfiguration:connectionMap.get(capture.connectionAlias)?.private.runtime??defaultRuntime,mapping:saved.mapping??pending.read.mapping??null,format:saved.format??'json'};
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

 function utcDay(value,label='UTC date'){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),'INVALID_PERIOD','Supply '+label+' as YYYY-MM-DD.');
  const date=new Date(value+'T00:00:00.000Z');need(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value,'INVALID_PERIOD','Supply a real '+label+'.');return value;
 }
 function dayAfter(value){return new Date(new Date(utcDay(value)+'T00:00:00.000Z').getTime()+86400000).toISOString().slice(0,10);}
 function dailyPeriod(value){
  need(plain(value),'INVALID_PERIOD','Supply the complete UTC day.');const from=utcDay(String(value.from).slice(0,10)),to=utcDay(String(value.to).slice(0,10));
  need(to===dayAfter(from)&&(!value.timeZone||value.timeZone==='UTC'),'INVALID_PERIOD','Select one complete UTC day with its exclusive following boundary.');
  for(const [key,date] of [['from',from],['to',to]])need(value[key]===date||value[key]===date+'T00:00:00Z'||value[key]===date+'T00:00:00.000Z','INVALID_PERIOD','Daily collection boundaries must be midnight UTC.');
  return {from:from+'T00:00:00.000Z',to:to+'T00:00:00.000Z',timeZone:'UTC'};
 }
 async function pinnedPolicy(state,id,version){return verified(await readRecord(directory,versioned(state.policies,id,version)),'Original wallet policy');}
 function nativeConnections(){return Object.fromEntries([...connectionMap].map(([alias,row])=>[alias,row.private]));}
 async function internalCall(method,args){
  for(;;){const state=await readState(directory);try{return await method({...args,expectedRevision:state.revision});}catch(error){if(error.code==='REVISION_CONFLICT')continue;throw error;}}
 }
 function selectedDecisions(state,run){
  const rows=run.decisionIds.map(id=>selected(state.decisions,id,'Original attribution decision'));
  return rows.filter(row=>!rows.some(other=>other.supersedes===row.id)).map(clone);
 }
 function runCoverage(state,run){
  return [...clone(run.planCoverage??[]),...run.tasks.filter(task=>task.captureId).map(task=>{
   const capture=selected(state.captures,task.captureId,'Original capture');
   return {...clone(task.coverage??{}),captureId:capture.id,sourceIds:clone(capture.sources),status:capture.status,
    kind:task.coverage?.kind??task.kind,scope:task.coverage?.scope??(task.kind==='operations-window'?'network':'source'),
    assetId:task.assetId??task.coverage?.assetId??null,from:task.coverage?.from??run.period?.from??null,to:task.coverage?.to??run.period?.to??null};
  })];
 }
 async function runStart(args){
  check();return mutate(directory,'run.start',args,async state=>{
   need(['wallet','activity'].includes(args.kind),'INVALID_RUN','Choose a wallet review or daily activity collection.');
   const registry=await originalVersion(directory,state,args.registryId,args.registryVersion),policy=await pinnedPolicy(state,args.policyId,args.policyVersion);
   const mode=args.mode??'capture';need(['capture','retained'].includes(mode),'INVALID_RUN','Choose original capture or retained-source review.');
   const period=args.kind==='activity'?dailyPeriod(args.period):null;
   if(args.kind==='wallet')need(Array.isArray(args.addresses)&&args.addresses.length>0,'INVALID_ADDRESSES','Supply the original Stellar wallet addresses.');
   const sourceIds=[...new Set([...(args.sourceIds??[]),...registry.definition.assets.flatMap(row=>row.sourceIds??[]),...(policy.definition.methodologySourceIds??[])])];
   for(const id of sourceIds){const row=selected(state.sources,id,'Original source');if(row.network&&row.network!=='global')need(row.network===registry.definition.network,'NETWORK_MISMATCH','Select original sources from the registry network.');}
   const decisionIds=args.decisionIds??Object.values(state.decisions).filter(row=>row.registryId===registry.id&&row.registryVersion===registry.version&&sourceIds.includes(row.sourceId)).map(row=>row.id);
   unique(decisionIds,'attribution decisions');for(const id of decisionIds){const d=selected(state.decisions,id,'Attribution decision');need(d.registryId===registry.id&&d.registryVersion===registry.version,'REGISTRY_MISMATCH','Use attribution decisions for this exact registry version.');}
   if(args.previousEditionId){const previous=selected(state.editions,args.previousEditionId,'Previous edition');need(previous.kind===args.kind&&previous.network===registry.definition.network,'EDITION_MISMATCH','Choose a previous edition of the same network and result kind.');}
   const id=randomUUID(),at=now(),asOf=args.asOf??at;
   need(typeof asOf==='string'&&Number.isFinite(new Date(asOf).getTime()),'INVALID_TIME','Supply the original review source time.');
   const run={id,name:text(args.name??(args.kind==='wallet'?'Wallet review':'Daily activity '+period.from.slice(0,10)),'run name'),kind:args.kind,mode,
    registryId:registry.id,registryVersion:registry.version,registrySha256:registry.sha256,policyId:policy.id,policyVersion:policy.version,policySha256:policy.sha256,
    network:registry.definition.network,addresses:clone(args.addresses??[]),accounts:null,period,asOf:new Date(asOf).toISOString(),explicitAsOf:args.asOf!==undefined,requestedAsOf:args.asOf??null,connectionAliases:clone(args.connectionAliases??{}),
    collectionId:args.collectionId??null,collectionVersion:args.collectionVersion??null,sourceIds,decisionIds:clone(decisionIds),
    previousEditionId:args.previousEditionId??null,editionIds:[],editionId:null,lookupCounted:false,
    tasks:[],planObservations:[],planCoverage:[],plans:[],planFile:null,runtime:null,phase:'PLAN',status:'READY',paused:false,
    steps:[],inflight:null,execution:null,lastError:null,createdAt:at,updatedAt:at};
   need(plain(run.connectionAliases),'INVALID_CONNECTION','Supply named source selections.');
   for(const alias of Object.values(run.connectionAliases)){text(alias,'connection alias');forRegistry(connection(alias),registry);}
   if(run.collectionId)versioned(state.collections,run.collectionId,run.collectionVersion);
   state.runs[id]=run;return {runId:id,run:compactRow('runs',run)};
  });
 }
 async function runRead({runId,...args}){
  check();const state=await readState(directory),row=selected(state.runs,runId,'Run');
  return {run:compactRow('runs',row),tasks:rowsPage(row.tasks,args),steps:rowsPage(row.steps,args),planObservations:rowsPage(row.planObservations,args),
   sourceIds:rowsPage(row.sourceIds,args),originalArguments:row.execution?.args??row.inflight?.args??null};
 }
 async function retainPlanObservations(state,run,pending,plan){
  const sourceIds=[];
  for(let index=0;index<(plan.observations??[]).length;index++){
   const observation=plan.observations[index],chosen=observation.connectionAlias?connection(observation.connectionAlias):null;
   need(Buffer.isBuffer(observation.response?.body),'INVALID_NATIVE_PLAN','Preserve the complete original planning response.');
   const saved=await retainSource(directory,state,{id:derivedId(run.id+':plan:'+pending.attemptId+':'+index),registryId:run.registryId,registryVersion:run.registryVersion,
    provider:observation.provider??chosen?.summary.provider,kind:observation.kind??'network',network:observation.network??run.network,
    connection:chosen?.summary??null,sourceScope:observation.sourceScope??chosen?.summary.sourceScope??run.id,
    label:'Original '+(observation.kind??'network')+' selection',request:observation.request??{},response:observation.response,body:observation.response.body,
    records:observation.records??[],recordsPath:observation.recordsPath??null,observedAt:observation.response.observedAt??now(),
    runtime:observation.runtime??null,runtimeConfiguration:chosen?.private.runtime??defaultRuntime,
    error:observation.error??null,format:observation.format??'json',mapping:observation.mapping??null});
   sourceIds.push(saved.source.id);
  }
  return sourceIds;
 }
 async function runNext(args){
  check();identifier(args.runId);
  return withLock(directory,'run-'+args.runId+'.lock',async()=>{
   const begun=await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.next',args);if(prior)return {completed:prior};
    const row=selected(before.runs,args.runId,'Run');
    if(row.inflight){need(row.inflight.args.requestId===args.requestId&&row.inflight.intentSha256===intent('run.next',args).intentSha256,'RUN_INFLIGHT','Continue the original run step.',{originalArguments:row.inflight.args});return {run:clone(row),pending:clone(row.inflight)};}
    revision(before,args);need(!row.paused&&!['PAUSED','FAILED','WAITING_FOR_BOUNDARY','COMPLETE','PARTIAL'].includes(row.status),'RUN_STATE','Resume the retained run before continuing.',{status:row.status});
    const next=clone(before),working=next.runs[row.id];
    const task=working.phase==='CAPTURE'?working.tasks.find(item=>!['COMPLETE','FAILED'].includes(item.status)):null;
    if(working.phase==='CAPTURE'&&!task)working.phase='PUBLISH';
    working.inflight={attemptId:randomUUID(),args:clone(args),intentSha256:intent('run.next',args).intentSha256,phase:working.phase,taskId:task?.id??null,startedAt:now()};
    working.status='RUNNING';working.updatedAt=now();
    await commitState(directory,before,next,'run.next.begin',args,{runId:working.id,phase:working.phase},{recordRequest:false});
    return {run:clone(working),pending:clone(working.inflight)};
   });
   if(begun.completed)return begun.completed;
   const {run,pending}=begun,root='runs/'+run.id+'/steps/'+pending.attemptId;let outcome;
   try{outcome=decodeValue(await files.readJSON(directory,root+'/outcome.json'));}catch(error){
    if(error.code!=='ENOENT')throw error;
    try{
     const state=await readState(directory),registry=await originalVersion(directory,state,run.registryId,run.registryVersion),policy=await pinnedPolicy(state,run.policyId,run.policyVersion);
     need(registry.sha256===run.registrySha256&&policy.sha256===run.policySha256,'SOURCE_CHANGED','The pinned original registry or rating policy changed.');
     if(pending.phase==='PLAN'){
      let plan;
      if(run.mode==='retained'){
       const accounts=run.kind==='wallet'?await prepareRatingsAccounts({addresses:run.addresses,registry,runtime:defaultRuntime}):null;
       plan={accounts,tasks:[],observations:[],runtime:accounts?.runtime??null,phase:'READY'};
      }else{
       const input={registry,policy,addresses:run.addresses,period:run.period,connections:nativeConnections(),connectionAliases:run.connectionAliases,asOf:run.asOf,runtime:defaultRuntime,signal};
       plan=await(run.kind==='wallet'?prepareRatingsWalletPlan(input):prepareRatingsActivityPlan(input));
      }
      need(plain(plan)&&Array.isArray(plan.tasks),'INVALID_NATIVE_PLAN','The native plan must contain complete original source reads.');
      outcome={plan};
     }else if(pending.phase==='CAPTURE'){
      const task=run.tasks.find(item=>item.id===pending.taskId);need(task,'TASK_NOT_FOUND','The original run task is missing.');
      const capture=selected(state.captures,task.captureId,'Original capture');
      let result;
      if(capture.status==='COMPLETE')result={captureId:capture.id,status:capture.status};
      else if(['FAILED','PAUSED'].includes(capture.status))result={captureId:capture.id,status:capture.status,error:capture.lastError};
      else result=await internalCall(captureRun,capture.run?.args??{captureId:capture.id,requestId:derivedId(pending.attemptId+':capture')});
      outcome={captureResult:result};
     }else{
      const records=await recordsFor(directory,state,run.sourceIds),decisions=selectedDecisions(state,run);
      const previousEdition=run.previousEditionId?verified(await readRecord(directory,selected(state.editions,run.previousEditionId,'Previous edition'))):null;
      const input={registry,policy,records,decisions,asOf:run.explicitAsOf?run.asOf:now(),addresses:run.accounts??run.addresses,period:run.period,previousEdition,coverage:runCoverage(state,run)};
      const result=await(run.kind==='wallet'?reviewStellarWallet(input):buildStellarActivity(input));
      need(result?.kind===run.kind&&result.network===run.network,'INVALID_EDITION','The native result differs from the original selected network or kind.');
      outcome={result};
     }
    }catch(error){outcome={error:publicError(error,[...connectionMap.values()].flatMap(row=>privateSecrets(row.private))),
      ...(pending.phase==='PLAN'?{plan:{phase:'FAILED',observations:error.observations??[],runtime:error.runtime??null,tasks:[]}}:{})};}
    await retainJSON(directory,root+'/outcome.json',encodeValue(outcome));
   }
   return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.next',args);if(prior)return prior;
    const next=clone(before),working=selected(next.runs,run.id,'Run');
    need(working.inflight?.attemptId===pending.attemptId,'RUN_INFLIGHT_CHANGED','The original run step changed.');
    const outcomeFile=await descriptor(directory,root+'/outcome.json');
    working.steps.push({id:pending.attemptId,phase:pending.phase,taskId:pending.taskId,startedAt:pending.startedAt,finishedAt:now(),file:outcomeFile,error:outcome.error??null});
    working.inflight=null;working.updatedAt=now();working.lastError=outcome.error??null;
    if(outcome.error){
     if(pending.phase==='PLAN'&&outcome.plan){
      const plan=outcome.plan,observationIds=await retainPlanObservations(next,working,pending,plan);
      working.planObservations.push(...observationIds);working.sourceIds=[...new Set([...working.sourceIds,...observationIds])];
      working.plans.push({id:pending.attemptId,file:outcomeFile,sourceIds:observationIds,phase:'FAILED',error:outcome.error,createdAt:now()});working.planFile=outcomeFile;
      if(plan.runtime)working.runtime=clone(plan.runtime);
     }
     working.status='FAILED';
    }
    else if(pending.phase==='PLAN'){
     const plan=outcome.plan,observationIds=await retainPlanObservations(next,working,pending,plan);
     working.planObservations.push(...observationIds);working.sourceIds=[...new Set([...working.sourceIds,...observationIds])];
     working.plans.push({id:pending.attemptId,file:outcomeFile,sourceIds:observationIds,phase:plan.phase??'READY',createdAt:now()});working.planFile=outcomeFile;
     if(plan.runtime)working.runtime=clone(plan.runtime);if(plan.addresses??plan.accounts)working.accounts=clone(plan.addresses??plan.accounts);
     working.planCoverage=(plan.coverage??[]).map(row=>({...clone(row),sourceIds:[...new Set([...(row.sourceIds??[]),...observationIds])]}));
     if(plan.phase==='WAITING_FOR_BOUNDARY'){working.status='WAITING_FOR_BOUNDARY';working.phase='PLAN';working.nextBoundary=plan.nextBoundary??working.period?.to??null;}
     else{
      need(new Set(plan.tasks.map(item=>item.id)).size===plan.tasks.length,'INVALID_NATIVE_PLAN','Each original task must have a distinct source identity.');
      working.tasks=plan.tasks.map((task,index)=>{
       const chosen=connection(task.connectionAlias),captureId=derivedId(working.id+':plan:'+pending.attemptId+':task:'+task.id);
       const read=clone(task.read??{kind:task.kind,filters:task.filters??{},...(task.pageSize?{pageSize:task.pageSize}:{})});
       need(plain(read)&&typeof read.kind==='string','INVALID_NATIVE_PLAN','Each task must preserve its original complete read.');
       const created=now();
       next.captures[captureId]={id:captureId,registryId:working.registryId,registryVersion:working.registryVersion,registrySha256:working.registrySha256,network:working.network,
        name:task.name??task.kind,provider:chosen.summary.provider,connectionAlias:task.connectionAlias,connection:clone(chosen.summary),read,nextRead:clone(read),
        status:'READY',paused:working.paused,sources:[],attempts:[],inflight:null,run:null,lastError:null,runtime:plan.runtime??null,createdAt:created,updatedAt:created};
       return {...clone(task),id:String(task.id??index),captureId,status:'READY',required:task.required!==false,read};
      });
      working.phase=working.tasks.length?'CAPTURE':'PUBLISH';working.status='READY';delete working.nextBoundary;
     }
    }else if(pending.phase==='CAPTURE'){
     const task=working.tasks.find(item=>item.id===pending.taskId),capture=selected(next.captures,task.captureId,'Original capture');
     task.status=capture.status;task.error=capture.lastError??null;task.updatedAt=now();
     working.sourceIds=[...new Set([...working.sourceIds,...capture.sources])];if(capture.runtime&&!working.runtime)working.runtime=clone(capture.runtime);
     if(capture.status==='PAUSED'){working.paused=true;working.status='PAUSED';}
     else{working.status='READY';working.phase=working.tasks.every(item=>['COMPLETE','FAILED'].includes(item.status))?'PUBLISH':'CAPTURE';}
    }else{
     const result=outcome.result,id=derivedId(working.id+':edition:'+working.editionIds.length),at=now();working.asOf=result.asOf;
     const sourceErrors=working.tasks.filter(task=>task.status!=='COMPLETE').map(task=>({taskId:task.id,captureId:task.captureId,required:task.required,error:task.error??null,status:task.status}));
     const edition=sealed({...clone(result),schema:EDITION_SCHEMA,id,runId:working.id,createdAt:at,collectionId:working.collectionId,collectionVersion:working.collectionVersion,
      registryId:working.registryId,registryVersion:working.registryVersion,policyId:working.policyId,policyVersion:working.policyVersion,
      previousEditionId:working.editionId??working.previousEditionId,requestedAsOf:working.requestedAsOf,runtime:working.runtime,sourceIds:clone(working.sourceIds),decisionIds:clone(working.decisionIds),
      sourceErrors,coverageDetails:runCoverage(next,working),originalRequestId:working.execution?.args.requestId??pending.args.requestId});
     const file=await retainJSON(directory,'editions/'+id+'/edition.json',edition);
     next.editions[id]={id,runId:working.id,kind:working.kind,name:working.name,registryId:working.registryId,registryVersion:working.registryVersion,policyId:working.policyId,policyVersion:working.policyVersion,
      network:working.network,status:edition.status,asOf:working.asOf,period:working.period,utcDate:working.period?.from.slice(0,10)??null,
      collectionId:working.collectionId,collectionVersion:working.collectionVersion,sourceCount:working.sourceIds.length,issueCount:edition.issues?.length??0,
      sourceErrorCount:sourceErrors.length,runtime:working.runtime,file,sha256:edition.sha256,createdAt:at};
     if(working.kind==='wallet'&&!working.lookupCounted){
      for(const account of new Set(edition.successfulAccounts??[])){
       const lookupId=derivedId(working.network+':wallet-lookup:'+account),previous=next.lookups[lookupId];
       next.lookups[lookupId]={id:lookupId,network:working.network,account,count:(BigInt(previous?.count??'0')+1n).toString(),
        firstLookupAt:previous?.firstLookupAt??at,lastLookupAt:at,createdAt:previous?.createdAt??at,updatedAt:at,
        editionIds:[...(previous?.editionIds??[]),id]};
      }
      working.lookupCounted=true;
     }
     working.editionIds.push(id);working.editionId=id;working.phase='COMPLETE';working.status=sourceErrors.length?'PARTIAL':'COMPLETE';working.completedAt=at;
     if(working.collectionId){const collection=selected(next.collections,working.collectionId,'Collection'),day=working.period.from.slice(0,10);collection.editions??={};collection.editions[day]=[...(collection.editions[day]??[]),id];collection.updatedAt=at;}
    }
    if(working.paused&&!['COMPLETE','PARTIAL','FAILED','WAITING_FOR_BOUNDARY'].includes(working.status))working.status='PAUSED';
    return commitState(directory,before,next,'run.next',args,{runId:working.id,kind:working.kind,phase:working.phase,status:working.status,
     editionId:working.editionId,sourceCount:working.sourceIds.length,taskCount:working.tasks.length,completedTasks:working.tasks.filter(task=>task.status==='COMPLETE').length,
     failedTasks:working.tasks.filter(task=>task.status==='FAILED').length,error:working.lastError,nextBoundary:working.nextBoundary??null});
   });
  });
 }
 async function runPause(args){
  check();return mutate(directory,'run.pause',args,async state=>{
   const row=selected(state.runs,args.runId,'Run');row.paused=true;if(!['COMPLETE','PARTIAL'].includes(row.status))row.status='PAUSED';row.updatedAt=now();
   for(const task of row.tasks){const capture=selected(state.captures,task.captureId,'Original capture');if(capture.status!=='COMPLETE'){capture.paused=true;capture.status='PAUSED';capture.updatedAt=now();}}
   return {runId:row.id,status:row.status,originalArguments:row.execution?.args??null,originalStep:row.inflight?.args??null};
  });
 }
 async function runResume(args){
  check();return mutate(directory,'run.resume',args,async state=>{
   const row=selected(state.runs,args.runId,'Run');need(row.status!=='COMPLETE','RUN_COMPLETE','A completed review is retained as an immutable edition; start a new review for new sources.');
   row.paused=false;row.lastError=null;
   for(const task of row.tasks){const capture=selected(state.captures,task.captureId,'Original capture');connection(capture.connectionAlias,capture.connection);
    if(capture.status!=='COMPLETE'){capture.paused=false;capture.status=capture.inflight?'RUNNING':'READY';capture.lastError=null;task.status='READY';task.error=null;capture.updatedAt=now();}}
   if(row.status==='PARTIAL'){row.execution=null;row.phase=row.tasks.some(task=>task.status!=='COMPLETE')?'CAPTURE':'PUBLISH';}
   if(row.status==='WAITING_FOR_BOUNDARY')row.phase='PLAN';
   row.status=row.inflight?'RUNNING':'READY';row.updatedAt=now();
   return {runId:row.id,status:row.status,originalArguments:row.execution?.args??null,originalStep:row.inflight?.args??null,retainedEditionId:row.editionId};
  });
 }
 async function runContinue(args){
  check();const begun=await withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.continue',args);if(prior)return {completed:prior};
   const row=selected(before.runs,args.runId,'Run');
   if(row.execution){need(row.execution.args.requestId===args.requestId&&row.execution.intentSha256===intent('run.continue',args).intentSha256,'RUN_ACTIVE','Continue the original complete run.',{originalArguments:row.execution.args});return {};}
   revision(before,args);const next=clone(before);next.runs[row.id].execution={args:clone(args),intentSha256:intent('run.continue',args).intentSha256,startedAt:now()};
   await commitState(directory,before,next,'run.continue.begin',args,{runId:row.id},{recordRequest:false});return {};
  });
  if(begun.completed)return begun.completed;
  for(;;){
   check();const state=await readState(directory),row=selected(state.runs,args.runId,'Run');
   if(signal?.aborted&&!row.paused&&!['COMPLETE','PARTIAL'].includes(row.status)){await internalCall(runPause,{runId:row.id,requestId:derivedId(args.requestId+':drain:'+state.revision)});continue;}
   if(['COMPLETE','PARTIAL'].includes(row.status))return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'run.continue',args);if(prior)return prior;
    const next=clone(before),current=selected(next.runs,row.id,'Run');current.execution={...current.execution,finishedAt:now()};
    return commitState(directory,before,next,'run.continue',args,{runId:row.id,status:current.status,editionId:current.editionId,sourceCount:current.sourceIds.length,
     completedTasks:current.tasks.filter(task=>task.status==='COMPLETE').length,failedTasks:current.tasks.filter(task=>task.status==='FAILED').length,completedAt:current.completedAt});
   });
   if(['PAUSED','FAILED','WAITING_FOR_BOUNDARY'].includes(row.status)||row.paused)return {workspaceId:state.workspaceId,revision:state.revision,requestId:args.requestId,runId:row.id,status:row.status,error:row.lastError,nextBoundary:row.nextBoundary??null,originalArguments:row.execution.args};
   await internalCall(runNext,row.inflight?.args??{runId:row.id,requestId:derivedId(args.requestId+':step:'+row.steps.length)});
  }
 }
 async function completeReview(operation,args,kind){
  check();let state=await readState(directory),prior=replay(state,operation,args);if(prior)return prior;if(!state.requests[derivedId(args.requestId+':start')])revision(state,args);
  const started=await internalCall(runStart,{...args,kind,requestId:derivedId(args.requestId+':start')});
  state=await readState(directory);const row=selected(state.runs,started.runId,'Run');
  const result=await internalCall(runContinue,row.execution?.args??{runId:row.id,requestId:derivedId(args.requestId+':continue')});
  if(!['COMPLETE','PARTIAL'].includes(result.status))return {...result,requestId:args.requestId,originalArguments:clone(args)};
  return withLock(directory,'writer.lock',async()=>{
   await recoverState(directory);const before=await readState(directory),prior=replay(before,operation,args);if(prior)return prior;
   return commitState(directory,before,clone(before),operation,args,{runId:result.runId,status:result.status,editionId:result.editionId});
  });
 }
 const walletReview=args=>completeReview('wallet.review',args,'wallet');
 const activityCollect=args=>completeReview('activity.collect',args,'activity');

 async function collectionSave(args){
  check();return mutate(directory,'collection.save',args,async state=>{
   need(plain(args.definition),'INVALID_COLLECTION','Supply a daily collection definition.');
   const input=args.definition,registry=await originalVersion(directory,state,input.registryId,input.registryVersion),policy=await pinnedPolicy(state,input.policyId,input.policyVersion);
   const id=args.collectionId??randomUUID();identifier(id);const previous=args.collectionId?selected(state.collections,id,'Collection'):null,version=(previous?.currentVersion??0)+1;
   if(args.expectedVersion!==undefined)need(previous?.currentVersion===args.expectedVersion,'COLLECTION_VERSION_CONFLICT','The collection definition has advanced.');
   const launchDate=utcDay(input.launchDate,'accepted collection launch date'),sourceIds=unique(input.sourceIds??[],'original collection sources');
   for(const sourceId of sourceIds)selected(state.sources,sourceId,'Original collection source');
   const connectionAliases=clone(input.connectionAliases??{});need(plain(connectionAliases),'INVALID_CONNECTION','Supply named original source connections.');
   for(const alias of Object.values(connectionAliases))forRegistry(connection(alias),registry);
   const definition={name:text(args.name??input.name,'collection name'),registryId:registry.id,registryVersion:registry.version,registrySha256:registry.sha256,
    policyId:policy.id,policyVersion:policy.version,policySha256:policy.sha256,network:registry.definition.network,launchDate,timeZone:'UTC',cadence:'daily',
    connectionAliases,sourceIds:clone(sourceIds),enabled:input.enabled!==false};
   const body=sealed({schema:'stellar-forge.stellar-ratings.collection.v1',id,version,definition,createdAt:now()}),file=await retainJSON(directory,'collections/'+id+'/'+version+'.json',body);
   const entry={id,version,name:definition.name,registryId:registry.id,registryVersion:registry.version,network:definition.network,launchDate,sha256:body.sha256,file,createdAt:body.createdAt};
   state.collections[id]={id,name:definition.name,registryId:registry.id,network:definition.network,currentVersion:version,updatedAt:body.createdAt,versions:[...(previous?.versions??[]),entry],
    editions:clone(previous?.editions??{}),execution:clone(previous?.execution??null),executions:clone(previous?.executions??[])};
   return {collectionId:id,version,collection:entry};
  });
 }
 async function collectionRead({collectionId,version,...args}){
  check();const state=await readState(directory),row=selected(state.collections,collectionId,'Collection'),definition=verified(await readRecord(directory,versioned(state.collections,collectionId,version)),'Original collection definition');
  const dates=Object.entries(row.editions??{}).sort(([a],[b])=>b.localeCompare(a)).map(([utcDate,editionIds])=>({utcDate,editionIds,latestEditionId:editionIds.at(-1)}));
  return {collection:compactRow('collections',row),definition,dates:rowsPage(dates,args),execution:clone(row.execution??null)};
 }
 async function collectionPause(args){
  check();return mutate(directory,'collection.pause',args,async state=>{
   const row=selected(state.collections,args.collectionId,'Collection'),execution=row.execution;need(execution,'COLLECTION_IDLE','The collection has no active original operation.');
   execution.paused=true;if(execution.status!=='COMPLETE')execution.status='PAUSED';execution.updatedAt=now();
   const run=execution.pending?.runId?selected(state.runs,execution.pending.runId,'Original daily run'):null;
   if(run&&!['COMPLETE','PARTIAL'].includes(run.status)){
    run.paused=true;run.status='PAUSED';run.updatedAt=now();
    for(const task of run.tasks){const capture=selected(state.captures,task.captureId,'Original capture');if(capture.status!=='COMPLETE'){capture.paused=true;capture.status='PAUSED';capture.updatedAt=now();}}
   }
   return {collectionId:row.id,status:execution.status,originalArguments:execution.args,nextDate:execution.cursor,runId:run?.id??null};
  });
 }
 async function collectionResume(args){
  check();return mutate(directory,'collection.resume',args,async state=>{
   const row=selected(state.collections,args.collectionId,'Collection'),execution=row.execution;need(execution&&execution.status!=='COMPLETE','COLLECTION_IDLE','Start a new collection operation for following UTC days.');
   execution.paused=false;execution.status='READY';execution.updatedAt=now();
   const run=execution.pending?.runId?selected(state.runs,execution.pending.runId,'Original daily run'):null;
   if(run&&!['COMPLETE','PARTIAL'].includes(run.status)){
    run.paused=false;run.status=run.inflight?'RUNNING':'READY';run.lastError=null;run.updatedAt=now();
    for(const task of run.tasks){const capture=selected(state.captures,task.captureId,'Original capture');connection(capture.connectionAlias,capture.connection);
     if(capture.status!=='COMPLETE'){capture.paused=false;capture.status=capture.inflight?'RUNNING':'READY';capture.lastError=null;task.status='READY';task.error=null;capture.updatedAt=now();}}
   }
   return {collectionId:row.id,status:execution.status,originalArguments:execution.args,nextDate:execution.cursor,runId:run?.id??null};
  });
 }
 async function collectionRun(args){
  check();identifier(args.collectionId);
  return withLock(directory,'collection-'+args.collectionId+'.lock',async()=>{
   const begun=await withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory),prior=replay(before,'collection.run',args);if(prior)return {completed:prior};
    const original=selected(before.collections,args.collectionId,'Collection');
    if(original.execution&&original.execution.status!=='COMPLETE'){
     need(original.execution.args.requestId===args.requestId&&original.execution.intentSha256===intent('collection.run',args).intentSha256,'COLLECTION_ACTIVE','Continue the original complete collection operation.',{originalArguments:original.execution.args});return {};
    }
    revision(before,args);const selectedDefinition=verified(await readRecord(directory,versioned(before.collections,args.collectionId,args.version)),'Original collection definition'),definition=selectedDefinition.definition;
    need(definition.enabled,'COLLECTION_DISABLED','Save an enabled collection version before starting its daily reads.');
    const from=utcDay(args.from??definition.launchDate,'collection start date'),to=utcDay(args.to??now().slice(0,10),'exclusive collection end date');
    need(from>=definition.launchDate&&to>=from,'INVALID_PERIOD','Collect from the accepted launch date through the selected exclusive UTC boundary.');
    const next=clone(before),row=next.collections[original.id];
    if(row.execution)row.executions.push(clone(row.execution));
    row.execution={id:randomUUID(),version:selectedDefinition.version,definitionSha256:selectedDefinition.sha256,args:clone(args),intentSha256:intent('collection.run',args).intentSha256,
     from,to,cursor:from,repair:args.repair===true,status:'READY',paused:false,pending:null,results:[],startedAt:now(),updatedAt:now()};
    await commitState(directory,before,next,'collection.run.begin',args,{collectionId:row.id,from,to},{recordRequest:false});return {};
   });
   if(begun.completed)return begun.completed;
   for(;;){
    check();let state=await readState(directory),collection=selected(state.collections,args.collectionId,'Collection'),execution=collection.execution;
    if(signal?.aborted&&!execution.paused){await internalCall(collectionPause,{collectionId:collection.id,requestId:derivedId(args.requestId+':drain:'+state.revision)});continue;}
    if(execution.paused||['PAUSED','FAILED','WAITING_FOR_BOUNDARY'].includes(execution.status))return {workspaceId:state.workspaceId,revision:state.revision,collectionId:collection.id,status:execution.status,
     nextDate:execution.cursor,completedDates:execution.results.length,originalArguments:execution.args,runId:execution.pending?.runId??null,error:execution.lastError??null};
    if(execution.cursor>=execution.to)return withLock(directory,'writer.lock',async()=>{
     await recoverState(directory);const before=await readState(directory),prior=replay(before,'collection.run',args);if(prior)return prior;
     const next=clone(before),row=next.collections[collection.id],current=row.execution;
     current.status='COMPLETE';current.finishedAt=now();current.updatedAt=now();
     return commitState(directory,before,next,'collection.run',args,{collectionId:row.id,status:'COMPLETE',from:current.from,to:current.to,dates:current.results.length,
      createdEditions:current.results.filter(item=>!item.reused).length,reusedEditions:current.results.filter(item=>item.reused).length,results:current.results});
    });
    const day=execution.cursor,existing=(collection.editions?.[day]??[]).map(id=>selected(state.editions,id,'Original edition')).filter(row=>row.collectionVersion===execution.version).at(-1);
    if(!execution.pending&&existing&&!execution.repair){
     await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory),next=clone(before),current=next.collections[collection.id].execution;
      need(current.id===execution.id&&current.cursor===day&&!current.pending,'COLLECTION_CHANGED','The original daily cursor changed.');
      current.results.push({utcDate:day,editionId:existing.id,status:existing.status,reused:true});current.cursor=dayAfter(day);current.updatedAt=now();
      const stepArgs={collectionId:collection.id,requestId:derivedId(execution.id+':reuse:'+day),expectedRevision:before.revision};
      return commitState(directory,before,next,'collection.date.reuse',stepArgs,{collectionId:collection.id,utcDate:day,editionId:existing.id});
     });continue;
    }
    if(!execution.pending){
     await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory),next=clone(before),current=next.collections[collection.id].execution;
      need(current.id===execution.id&&current.cursor===day,'COLLECTION_CHANGED','The original daily cursor changed.');
      const definition=verified(await readRecord(directory,versioned(before.collections,collection.id,current.version)),'Original collection definition').definition;
      const previousIds=next.collections[collection.id].editions?.[new Date(new Date(day+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10)]??[];
      current.pending={utcDate:day,runId:null,startArguments:{kind:'activity',name:definition.name+' · '+day,registryId:definition.registryId,registryVersion:definition.registryVersion,
       policyId:definition.policyId,policyVersion:definition.policyVersion,period:{from:day,to:dayAfter(day),timeZone:'UTC'},connectionAliases:definition.connectionAliases,sourceIds:definition.sourceIds,
       collectionId:collection.id,collectionVersion:current.version,previousEditionId:previousIds.at(-1)??null,requestId:derivedId(current.id+':start:'+day)}};
      current.status='RUNNING';current.updatedAt=now();
      const stepArgs={collectionId:collection.id,requestId:derivedId(current.id+':date:'+day),expectedRevision:before.revision};
      return commitState(directory,before,next,'collection.date.begin',stepArgs,{collectionId:collection.id,utcDate:day});
     });state=await readState(directory);collection=selected(state.collections,args.collectionId,'Collection');execution=collection.execution;
    }
    if(!execution.pending.runId){
     const started=await internalCall(runStart,execution.pending.startArguments);
     await withLock(directory,'writer.lock',async()=>{
      await recoverState(directory);const before=await readState(directory),next=clone(before),current=next.collections[collection.id].execution;
      need(current.id===execution.id&&current.cursor===day,'COLLECTION_CHANGED','The original daily cursor changed.');
      current.pending.runId=started.runId;current.updatedAt=now();
      const stepArgs={collectionId:collection.id,requestId:derivedId(current.id+':bind:'+day),expectedRevision:before.revision};
      return commitState(directory,before,next,'collection.date.bind',stepArgs,{collectionId:collection.id,utcDate:day,runId:started.runId});
     });state=await readState(directory);collection=selected(state.collections,args.collectionId,'Collection');execution=collection.execution;
    }
    const run=selected(state.runs,execution.pending.runId,'Original daily run');
    const result=await internalCall(runContinue,run.execution?.args??{runId:run.id,requestId:derivedId(execution.id+':continue:'+day)});
    await withLock(directory,'writer.lock',async()=>{
     await recoverState(directory);const before=await readState(directory),next=clone(before),current=next.collections[collection.id].execution;
     need(current.id===execution.id&&current.cursor===day&&current.pending?.runId===run.id,'COLLECTION_CHANGED','The original daily run changed.');
     if(['COMPLETE','PARTIAL'].includes(result.status)){
      current.results.push({utcDate:day,runId:run.id,editionId:result.editionId,status:result.status,reused:false});current.pending=null;current.cursor=dayAfter(day);current.status=current.paused?'PAUSED':'READY';current.lastError=null;
     }else{current.status=result.status;current.lastError=result.error??null;if(result.status==='PAUSED')current.paused=true;}
     current.updatedAt=now();
     const stepArgs={collectionId:collection.id,requestId:derivedId(execution.id+':result:'+day+':'+before.revision),expectedRevision:before.revision};
     return commitState(directory,before,next,'collection.date.result',stepArgs,{collectionId:collection.id,utcDate:day,runId:run.id,status:result.status,editionId:result.editionId??null});
    });
   }
  });
 }
 async function decisionSave(args){
  check();return mutate(directory,'decision.save',args,async state=>{
   const registry=await originalVersion(directory,state,args.registryId,args.registryVersion),source=selected(state.sources,args.sourceId,'Original source');
   const records=await recordsFor(directory,state,[source.id]);need(records.some(row=>row.id===args.recordId),'RECORD_NOT_FOUND','Select an original retained source record.');
   need(['include','exclude','map'].includes(args.action),'INVALID_DECISION','Choose include, exclude or attribution mapping.');
   const mapping=clone(args.mapping??{});need(plain(mapping)&&Object.keys(mapping).every(key=>['assetId','account','pricingKey','bluechipSymbol'].includes(key)),'INVALID_MAPPING','Map original asset, wallet or source attribution.');
   if(mapping.assetId)need(registry.definition.assets.some(row=>row.id===mapping.assetId),'ASSET_NOT_FOUND','Choose an asset from this exact registry version.');
   if(args.supersedes){const previous=selected(state.decisions,args.supersedes,'Previous attribution decision');need(previous.registryId===registry.id&&previous.registryVersion===registry.version&&previous.recordId===args.recordId&&previous.sourceId===source.id,'DECISION_MISMATCH','Supersede a decision for the same original record and registry.');}
   const id=randomUUID(),body=sealed({schema:'stellar-forge.stellar-ratings.decision.v1',id,registryId:registry.id,registryVersion:registry.version,sourceId:source.id,recordId:args.recordId,
    action:args.action,mapping,actor:text(args.actor,'decision actor'),reason:text(args.reason,'decision reason',4000),supersedes:args.supersedes??null,createdAt:now()});
   const file=await retainJSON(directory,'decisions/'+id+'/decision.json',body);state.decisions[id]={...body,file};
   return {decisionId:id,decision:body};
  });
 }
 async function decisionRead({decisionId}){check();return verified(await readRecord(directory,selected((await readState(directory)).decisions,decisionId,'Attribution decision')),'Original attribution decision');}
 async function editionRead({editionId,section,...args}){
  check();const row=selected((await readState(directory)).editions,editionId,'Edition'),edition=verified(await readRecord(directory,row),'Original result edition');
  if(!section)return edition;
  need(['holdings','accounts','addresses','metrics','assets','holders','aggregates','issues','sourceIds','coverageDetails','sourceErrors'].includes(section)&&Array.isArray(edition[section]),'INVALID_SECTION','Choose a retained edition table.');
  return {editionId,section,...rowsPage(edition[section],args)};
 }
 async function editionFile({editionId,offset=0,length=1024*1024}){
  check();const row=selected((await readState(directory)).editions,editionId,'Edition');integer(offset,'offset');integer(length,'length',1,4*1024*1024);
  const result=await files.sourceFileRange(directory,row.file,offset,length);return {editionId,file:row.file,offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }
 async function editionCompare({leftEditionId,rightEditionId,...args}){
  check();const [left,right]=await Promise.all([editionRead({editionId:leftEditionId}),editionRead({editionId:rightEditionId})]),comparison=compareRatingsEditions(left,right);
  return {...comparison,changes:rowsPage(comparison.changes,args)};
 }
 async function reportCreate(args){
  check();return mutate(directory,'report.create',args,async state=>{
   const selectedEdition=selected(state.editions,args.editionId,'Original edition'),edition=verified(await readRecord(directory,selectedEdition),'Original result edition'),formats=unique(args.formats??['html','csv','json'],'report formats');
   need(formats.length>0&&formats.every(format=>['html','csv','json'].includes(format)),'INVALID_REPORT_FORMAT','Choose complete HTML, CSV or JSON report files.');
   const id=randomUUID(),members=[];let scope=null;
   for(const format of formats){
    const result=await buildRatingsReport({edition,format,assetId:args.assetId??null,account:args.account??null});
    need(typeof result.body==='string'||Buffer.isBuffer(result.body),'INVALID_REPORT','The complete original report body is required.');
    const filename=safeFilename(result.filename);need(filename!=='report.json','REPORT_PATH_CONFLICT','The report manifest has its own retained filename.');
    const file=await files.writeNew(directory,'reports/'+id+'/'+filename,Buffer.from(result.body));scope=clone(result.scope);
    members.push({format,filename,contentType:result.contentType,file,bytes:file.bytes,sha256:file.sha256});
   }
   const report=sealed({schema:'stellar-forge.stellar-ratings.report.v1',id,editionId:edition.id,kind:edition.kind,network:edition.network,
    registryId:selectedEdition.registryId,registryVersion:selectedEdition.registryVersion,policyId:selectedEdition.policyId,policyVersion:selectedEdition.policyVersion,
    name:text(args.name??selectedEdition.name+' report','report name'),formats,scope,files:members,createdAt:now()});
   const file=await retainJSON(directory,'reports/'+id+'/report.json',report);state.reports[id]={...report,file};
   return {reportId:id,report};
  });
 }
 async function reportRead({reportId}){check();return verified(await readRecord(directory,selected((await readState(directory)).reports,reportId,'Report')),'Original report');}
 async function reportFile({reportId,format='html',offset=0,length=1024*1024}){
  check();const report=await reportRead({reportId}),member=report.files.find(row=>row.format===format);need(member,'REPORT_FORMAT_NOT_FOUND','Select a retained complete report format.');
  integer(offset,'offset');integer(length,'length',1,4*1024*1024);
  const result=await files.sourceFileRange(directory,member.file,offset,length);
  return {reportId,format,filename:member.filename,contentType:member.contentType,file:member.file,offset,bytes:result.content.length,eof:result.complete,base64:result.content.toString('base64')};
 }
 async function lookupRead({network,account,offset=0,limit=100}={}){
  check();const state=await readState(directory);let rows=Object.values(state.lookups);
  if(network)rows=rows.filter(row=>row.network===network);if(account)rows=rows.filter(row=>row.account===account);
  rows.sort((a,b)=>BigInt(a.count)>BigInt(b.count)?-1:BigInt(a.count)<BigInt(b.count)?1:a.account.localeCompare(b.account));
  return {workspaceId:state.workspaceId,revision:state.revision,...rowsPage(rows,{offset,limit})};
 }
 async function popularRead({network,limit=10}={}){
  check();integer(limit,'popular wallet limit',1,1000);const state=await readState(directory);
  let rows=Object.values(state.lookups);if(network)rows=rows.filter(row=>row.network===network);
  rows.sort((a,b)=>BigInt(a.count)>BigInt(b.count)?-1:BigInt(a.count)<BigInt(b.count)?1:a.account.localeCompare(b.account));
  const wallets=[];
  for(let index=0;index<Math.min(rows.length,limit);index++){
   const row=rows[index],editionId=row.editionIds.at(-1),edition=editionId?verified(await readRecord(directory,selected(state.editions,editionId,'Original wallet edition'))):null;
   const account=edition?.accounts?.find(item=>item.account===row.account);
   wallets.push({account:row.account,network:row.network,rank:index+1,tier:index<10?'Top 10':index<100?'Top 100':'Top 1000',
    labels:clone(account?.labels??[]),lastLookupAt:row.lastLookupAt,editionId,asOf:edition?.asOf??null});
  }
  return {network:network??null,wallets,attribution:{label:'by Bluechip',url:'https://bluechip.org/'}};
 }

 async function runtimeSelections(){
  check();const state=await readState(directory),used=new Map();
  for(const row of ['sources','captures','runs','editions'].flatMap(table=>Object.values(state[table]))){
   if(!row.runtime)continue;const previous=used.get(row.runtime.id);
   need(!previous||previous.manifestSha256===row.runtime.manifestSha256,'RUNTIME_CHANGED','One runtime identity must have one original manifest.');
   used.set(row.runtime.id,row.runtime);
  }
  const selections=[];
  for(const runtime of used.values()){
   let found=null;
   for(const config of [defaultRuntime,...[...connectionMap.values()].map(row=>row.private.runtime).filter(Boolean)]){
    const retained=config.retained?.find(row=>row.id===runtime.id&&(row.expectedManifestSha256??row.manifestSha256)===runtime.manifestSha256);
    if(retained){found={directory:retained.runtimeDirectory??retained.directory,expectedManifestSha256:runtime.manifestSha256};break;}
    try{
     const selected=await resolveRatingsRuntime({...config,expectedManifestSha256:runtime.manifestSha256});
     const directory=selected.directory??selected.runtimeDirectory;
     if(directory){found={directory,expectedManifestSha256:runtime.manifestSha256};break;}
    }catch(error){if(!/RUNTIME|ENOENT/.test(error.code??''))throw error;}
   }
   need(found,'RUNTIME_SOURCE_REQUIRED','Bind the original retained Stellar runtime.',{runtime});selections.push(found);
  }
  return selections;
 }
 async function close(){
  if(closed)return;closed=true;
  const results=await Promise.allSettled([...connectionMap.values()].filter(row=>row.adapter.close).map(row=>row.adapter.close()));
  const failure=results.find(row=>row.status==='rejected');if(failure)throw failure.reason;
 }
 return {describe,list,sourceCatalog,profileSave,registrySave,registryRead,policySave,policyRead,sourceImport,sourceProject,sourceRead,sourceFile,
  captureStart,captureRead,captureNext,captureRun,capturePause,captureResume,
  runStart,runRead,runNext,runContinue,runPause,runResume,walletReview,activityCollect,
  collectionSave,collectionRead,collectionRun,collectionPause,collectionResume,decisionSave,decisionRead,
  editionRead,editionFile,editionCompare,reportCreate,reportRead,reportFile,lookupRead,popularRead,runtimeSelections,close};
}
