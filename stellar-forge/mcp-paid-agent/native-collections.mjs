// SPDX-License-Identifier: MIT
// Agent access to the ORIGINAL separately owned SF88 collection browser and inbox.
import {createHash} from 'node:crypto';
import {readdir,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {initializationDirectory as privateDirectory,initializationBytes as privateBytes,
  optionalInitializationBytes as optionalBytes,retainInitializationRecord as retainRecord}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {openWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/workspace.mjs';
import {collectionsWorkspaceUrl,COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/launch.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {nativeCollectionOperations,nativeCollectionActions} from './native-collections-schema.mjs';
export {nativeCollectionActions,nativeCollectionsSchema} from './native-collections-schema.mjs';

const SCHEMA='stellar-forge.mcp-native-collections.v1';
const STORE='stellar-forge.sf88.collections.v1';
const STATUS='stellar-forge.sf88.collections-workspace.v1';
const EXPORT='stellar-forge.sf88.collection-export.v1';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const HASH=/^[a-f0-9]{64}$/;
const HEX_ID=/^[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILES=['collection.json','results.json','requests.csv','review.html','manifest.json'];
const MAX_JSON=32*1024*1024,MAX_TOOL=256*1024,MAX_REQUEST=256*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encoded=value=>Buffer.from(JSON.stringify(value));
const fail=code=>{throw new InputError(code);};
const named=value=>{need(typeof value==='string'&&ALIAS.test(value),'MCP_COLLECTION_ALIAS_REQUIRED');return value;};
const id=value=>{need(typeof value==='string'&&ID.test(value),'MCP_COLLECTION_ID_REQUIRED');return value;};
const hash=value=>{need(typeof value==='string'&&HASH.test(value),'MCP_COLLECTION_HASH_REQUIRED');return value;};
const hexId=value=>{need(typeof value==='string'&&HEX_ID.test(value),'MCP_COLLECTION_EXPORT_OR_REVIEW_ID_REQUIRED');return value;};
const requestId=value=>{need(typeof value==='string'&&UUID.test(value),'MCP_COLLECTION_REQUEST_ID_REQUIRED');return value;};
const intent=value=>{need(typeof value==='string'&&value.length>=1&&value.length<=128&&!/[\0\r\n]/.test(value),
  'MCP_COLLECTION_INTENT_REQUIRED');return value;};
function absolute(value){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!value.includes('\0'),
    'MCP_COLLECTION_PRIVATE_PATH_REQUIRED');return value;
}
function fields(value,allowed){
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),'MCP_COLLECTION_ARGUMENTS_INVALID');return value;
}
function parse(bytes){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('MCP_COLLECTION_JSON_INVALID');}
}
async function json(path,maximum=65536){return parse(await privateBytes(path,maximum));}
function slice(items,body={},offsetKey='offset',limitKey='limit'){
  const offset=body[offsetKey]??0,limit=body[limitKey]??25;
  need(Number.isSafeInteger(offset)&&offset>=0&&offset<=items.length&&
    Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_COLLECTION_PAGE_INVALID');
  return {items:items.slice(offset,offset+limit),offset,total:items.length,
    nextOffset:offset+limit<items.length?offset+limit:null};
}
function publicUrl(value){
  try{
    const url=new URL(value);url.username='';url.password='';
    for(const key of [...url.searchParams.keys()])
      if(/token|secret|credential|password|authorization|signature|api.?key/i.test(key))url.searchParams.set(key,'[configured]');
    return url.href;
  }catch{return null;}
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
function publicOperation(value){
  return {...pick(value,['intentId','method','expect','acceptIndex','orderReference']),
    url:publicUrl(value?.url),headerNames:Object.keys(value?.headers??{}),
    bodyConfigured:Boolean(value?.bodyFile),ticketConfigured:Boolean(value?.ticketFile)};
}
function publicJob(value){
  if(!plain(value))return null;
  const outcome=value.outcome;
  return {...pick(value,['state','createdAt','retry']),
    attempt:value.attempt?pick(value.attempt,['id','kind','startedAt']):null,
    outcome:plain(outcome)?{...pick(outcome,['status','httpStatus','settlement','receipt','paymentResponse','interrupted']),
      ...(outcome.error?{error:pick(outcome.error,['code'])}:{}),
      ...(outcome.responseFile?{responseFile:pick(outcome.responseFile,['status','bytes','sha256','contentType'])}:{})}:null,
    recovery:plain(value.recovery)?pick(value.recovery,['status','state','observationStatus','transaction','network']):null,
    lastError:value.lastError?pick(value.lastError,['code']):null};
}
function sourceAlias(record,path){
  return Object.entries(record.sources).find(([,source])=>source.path===path)?.[0]??null;
}
function publicItem(record,value){
  return {...pick(value,['index','intentId','state','error','body']),
    source:{alias:sourceAlias(record,value.sourceConfig?.path),
      ...pick(value.sourceConfig,['sha256','bytes'])},
    operation:publicOperation(value.operation),
    ticket:value.ticket?pick(value.ticket,['schema','sha256','bytes','kind','method','resource','operationId']):null,
    job:publicJob(value.job)};
}
function summary(value){
  return pick(value,['schema','id','name','state','createdAt','manifestSha256','previewSha256','itemCount','totals','error']);
}
function snapshot(record,value,body={}){
  const selected=slice(value.items??[],body),history=slice(value.runs??[],body,'runOffset','runLimit');
  return {...summary(value),items:selected.items.map(item=>publicItem(record,item)),
    itemOffset:selected.offset,totalItems:selected.total,nextItemOffset:selected.nextOffset,
    runs:history.items.map(run=>({...pick(run,['runId','state','startedAt']),
      completedAt:run.result?.completedAt??null,intentCount:run.intentIds?.length??0,
      resultCount:run.result?.results?.length??0})),
    runOffset:history.offset,totalRuns:history.total,nextRunOffset:history.nextOffset,
    ...(value.action?{action:value.action}:{})};
}
function runView(record,value){
  if(value===null)return null;
  need(plain(value),'MCP_COLLECTION_RUN_INVALID');
  const {workspaceByIntent,...view}=value;
  return {...view,workspaceByIntent:Object.fromEntries(Object.entries(workspaceByIntent??{}).map(([key,path])=>
    [key,Object.entries(record.buyers).find(([,buyer])=>buyer.directory===path)?.[0]??'unregistered']))};
}
function connectionFrom(value){
  let original=value;
  if(value?.original?.schema===COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA)
    original={...value.original,state:'LISTENING',url:value.url};
  need(original?.schema===COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA&&original.state==='LISTENING'&&
    Number.isSafeInteger(original.pid)&&original.pid>0&&['BROWSER','TERMINAL'].includes(original.approvalMode),
    'MCP_COLLECTION_ORIGINAL_LAUNCH_REQUIRED');
  const selected=collectionsWorkspaceUrl(original.url);
  need(selected,'MCP_COLLECTION_LOOPBACK_LAUNCH_REQUIRED');
  const url=new URL(selected),token=url.hash.slice(1);url.hash='';
  return {url,token,original:{directory:absolute(original.directory),queueRoot:absolute(original.queueRoot),
    approvalMode:original.approvalMode}};
}
async function responseBytes(response,maximum){
  const declared=response.headers.get('content-length');
  if(declared!==null)need(/^[0-9]+$/.test(declared)&&Number(declared)<=maximum,'MCP_COLLECTION_RESPONSE_TOO_LARGE');
  const chunks=[];let size=0;
  try{
    for await(const chunk of response.body??[]){
      size+=chunk.length;need(size<=maximum,'MCP_COLLECTION_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));
    }
  }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  need(declared===null||size===Number(declared),'MCP_COLLECTION_RESPONSE_INCOMPLETE');
  return Buffer.concat(chunks,size);
}

/** Register only trusted host files; every agent operation uses the original live service or its exact saved export. */
export function createNativeCollections({manifest,isClosed=()=>false}={}){
  need(plain(manifest),'MCP_COLLECTION_NATIVE_WORKSPACE_REQUIRED');
  const nativeRoot=absolute(manifest.directory),root=join(nativeRoot,'collections');
  const aliases=join(root,'workspaces'),reviews=join(root,'reviews'),responses=join(root,'responses');
  const reads=createSavedFileReader(),shutdown=new AbortController(),pending=new Set();
  let closed=false;
  const available=()=>need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
  async function roots(create=false){
    await privateDirectory(nativeRoot);
    if(!create&&(await optionalBytes(join(root,'format.json'),1024))===null)return false;
    await privateDirectory(root,{create});await privateDirectory(aliases,{create});await privateDirectory(reviews,{create});
    await privateDirectory(responses,{create});
    if(create)await retainRecord(join(root,'format.json'),{schema:SCHEMA},{resume:true});
    need((await json(join(root,'format.json'))).schema===SCHEMA,'MCP_COLLECTION_FORMAT_CHANGED');return true;
  }
  async function request(connection,route,body,signal){
    available();
    const options={method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+connection.token,Origin:connection.url.origin},
      signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])])};
    if(body!==undefined){
      const raw=encoded(body);need(raw.length<=MAX_REQUEST,'MCP_COLLECTION_REQUEST_TOO_LARGE');
      options.headers['Content-Type']='application/json';options.body=raw;
    }
    let response,raw;
    try{
      response=await fetch(new URL(route,connection.url),options);
      raw=await responseBytes(response,MAX_JSON);
    }catch(error){
      if(error?.code==='MCP_COLLECTION_RESPONSE_TOO_LARGE'||error?.code==='MCP_COLLECTION_RESPONSE_INCOMPLETE')throw error;
      fail(body===undefined?'MCP_COLLECTION_SERVICE_UNAVAILABLE':'MCP_COLLECTION_REPLY_UNCERTAIN_REOPEN_ORIGINAL_OPERATION');
    }
    const value=parse(raw);
    if(!response.ok)fail(/^[A-Z0-9_]{1,120}$/.test(value?.error??'')?value.error:'MCP_COLLECTION_HTTP_'+response.status);
    return value;
  }
  async function storeIdentity(directory,queueRoot){
    await privateDirectory(directory);await privateDirectory(queueRoot);
    const raw=await privateBytes(join(directory,'collections.json'),65536),value=parse(raw);
    need(value.schema===STORE&&value.queueRoot===queueRoot,
      'MCP_COLLECTION_ORIGINAL_STORE_CHANGED');
    return sha(raw);
  }
  async function connect(record,signal){
    const connection=connectionFrom(await json(record.connectionFile));
    need(connection.original.directory===record.directory&&connection.original.queueRoot===record.queueRoot&&
      connection.original.approvalMode===record.approvalMode,'MCP_COLLECTION_ORIGINAL_LAUNCH_CHANGED');
    need(await storeIdentity(record.directory,record.queueRoot)===record.storeSha256,'MCP_COLLECTION_ORIGINAL_STORE_CHANGED');
    const state=await request(connection,'/api/status',undefined,signal);
    need(state.schema===STATUS&&state.directory===record.directory&&state.queueRoot===record.queueRoot&&
      state.paymentApproval===(record.approvalMode==='BROWSER'?'original-browser':'original-terminal'),
      'MCP_COLLECTION_ORIGINAL_LISTENER_CHANGED');
    return {...connection,state};
  }
  async function registered(alias){
    named(alias);need(await roots(),'MCP_COLLECTION_NOT_REGISTERED');
    const record=await json(join(aliases,alias+'.json'),256*1024);
    need(record.schema===SCHEMA&&record.name===alias&&record.nativeWorkspace===nativeRoot&&
      plain(record.sources)&&plain(record.buyers),'MCP_COLLECTION_REGISTRATION_CHANGED');
    absolute(record.directory);absolute(record.queueRoot);absolute(record.connectionFile);hash(record.storeSha256);
    need(await storeIdentity(record.directory,record.queueRoot)===record.storeSha256,'MCP_COLLECTION_ORIGINAL_STORE_CHANGED');
    return record;
  }
  async function buyerIdentity(path){
    const directory=absolute(path);await privateDirectory(directory);
    const current=await openWorkspace(['--dir',directory]);
    return {directory,manifestSha256:sha(await privateBytes(join(directory,'workspace.json'),65536)),
      configSha256:sha(await privateBytes(current.configPath,65536)),
      network:current.manifest.network,payer:current.manifest.payer,
      request:publicOperation(current.config.operation)};
  }
  async function checkBuyer(value){
    const current=await buyerIdentity(value.directory);
    need(current.manifestSha256===value.manifestSha256&&current.configSha256===value.configSha256,
      'MCP_COLLECTION_ORIGINAL_BUYER_CHANGED');return current.directory;
  }
  async function register(description={}){
    available();fields(description,['name','connectionFile','sources','buyers']);
    const name=named(description.name),connectionFile=absolute(description.connectionFile);
    const connection=connectionFrom(await json(connectionFile));
    const selectedSources=description.sources??{},selectedBuyers=description.buyers??
      (typeof manifest.workspace==='string'?{primary:manifest.workspace}:{});
    need(plain(selectedSources)&&Object.keys(selectedSources).length<=500&&
      plain(selectedBuyers)&&Object.keys(selectedBuyers).length<=500,'MCP_COLLECTION_REGISTRATION_INVALID');
    const sources={},buyers={};
    for(const [alias,path]of Object.entries(selectedSources)){
      named(alias);absolute(path);const raw=await privateBytes(path,65536);
      sources[alias]={path,sha256:sha(raw),bytes:raw.length};
    }
    for(const [alias,path]of Object.entries(selectedBuyers)){named(alias);buyers[alias]=await buyerIdentity(path);}
    const record={schema:SCHEMA,name,nativeWorkspace:nativeRoot,connectionFile,...connection.original,
      storeSha256:await storeIdentity(connection.original.directory,connection.original.queueRoot),sources,buyers};
    await connect(record);await roots(true);
    await retainRecord(join(aliases,name+'.json'),record,{resume:true});
    return {schema:SCHEMA,name,status:'ORIGINAL_COLLECTION_WORKSPACE_REGISTERED',storeSha256:record.storeSha256,
      sourceCount:Object.keys(sources).length,buyerCount:Object.keys(buyers).length};
  }
  async function readReview(record,body){
    const reviewId=hexId(body.reviewId),saved=await json(join(reviews,record.name,reviewId+'.json'),MAX_JSON);
    need(saved.schema===SCHEMA&&saved.workspace===record.name&&saved.storeSha256===record.storeSha256&&
      saved.preview?.reviewId===reviewId&&saved.preview.previewSha256===hash(body.expectedPreviewSha256),
      'MCP_COLLECTION_ORIGINAL_REVIEW_CHANGED');
    return saved;
  }
  function previewView(record,preview,body){
    const page=slice(preview.items,body);
    return {schema:preview.schema,reviewId:preview.reviewId,previewSha256:preview.previewSha256,
      itemCount:preview.itemCount,totals:preview.totals,items:page.items.map(item=>publicItem(record,item)),
      offset:page.offset,total:page.total,nextOffset:page.nextOffset};
  }
  async function exportMetadata(record,body){
    const identifier=hexId(body.exportId),collectionId=id(body.id),expected=hash(body.expectedManifestSha256);
    const directory=join(record.directory,'exports',identifier);
    await privateDirectory(join(record.directory,'exports'));await privateDirectory(directory);
    const raw=await privateBytes(join(directory,'manifest.json'),65536),value=parse(raw);
    need(value.schema===EXPORT&&value.id===collectionId&&value.manifestSha256===expected&&
      Array.isArray(value.files)&&value.files.length===4&&new Set(value.files.map(file=>file?.name)).size===4&&
      value.files.every(file=>FILES.slice(0,4).includes(file?.name)&&HASH.test(file.sha256??'')&&
        Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_JSON),'MCP_COLLECTION_EXPORT_CHANGED');
    return {directory,schema:value.schema,id:value.id,manifestSha256:value.manifestSha256,
      exportId:identifier,completedAt:value.completedAt,
      files:[...value.files,{name:'manifest.json',bytes:raw.length,sha256:sha(raw)}]};
  }
  function responseKey(record,body){
    return sha(encoded({workspace:record.name,id:id(body.id),
      manifestSha256:hash(body.expectedManifestSha256),intentId:intent(body.intentId),
      responseSha256:hash(body.expectedResponseSha256)}));
  }
  async function readOriginalResponse(record,body,saved){
    need(saved.schema===SCHEMA&&saved.workspace===record.name&&saved.storeSha256===record.storeSha256&&
      saved.id===body.id&&saved.intentId===body.intentId&&saved.manifestSha256===body.expectedManifestSha256&&
      saved.file?.sha256===body.expectedResponseSha256,'MCP_COLLECTION_RESPONSE_CHANGED');
    const file=saved.file;absolute(file.path);
    need(await realpath(dirname(file.path))===dirname(file.path),'MCP_COLLECTION_RESPONSE_CHANGED');
    return {id:saved.id,intentId:saved.intentId,filename:file.name,manifestSha256:saved.manifestSha256,
      file:await reads({destination:file.path,bytes:file.bytes,sha256:file.sha256},body)};
  }
  async function perform(args={},context={}){
    available();fields(args,['action','collectionWorkspace','collectionOperation','collectionRequest']);
    need(args.action==='collections'&&plain(context)&&
      (context.signal===undefined||context.signal instanceof AbortSignal),'MCP_COLLECTION_ARGUMENTS_INVALID');
    const operation=args.collectionOperation,body=args.collectionRequest??{};
    need(Object.hasOwn(nativeCollectionOperations,operation),'MCP_COLLECTION_OPERATION_REQUIRED');
    const spec=nativeCollectionOperations[operation];fields(body,Object.keys(spec.properties));
    need(spec.required.every(key=>Object.hasOwn(body,key)),'MCP_COLLECTION_OPERATION_FIELDS_REQUIRED');
    if(operation==='workspaces'){
      if(!await roots())return {schema:SCHEMA,operation,...slice([],body)};
      const entries=(await readdir(aliases,{withFileTypes:true})).filter(entry=>entry.isFile()&&
        entry.name.endsWith('.json')&&ALIAS.test(entry.name.slice(0,-5))).sort((a,b)=>a.name.localeCompare(b.name));
      const page=slice(entries,body),items=[];
      for(const entry of page.items){
        const record=await registered(entry.name.slice(0,-5));
        items.push({name:record.name,storeSha256:record.storeSha256,approvalMode:record.approvalMode,
          sourceCount:Object.keys(record.sources).length,buyerCount:Object.keys(record.buyers).length});
      }
      return {schema:SCHEMA,operation,...page,items};
    }
    const record=await registered(args.collectionWorkspace);
    const result=value=>{
      const output={schema:SCHEMA,workspace:record.name,operation,value};
      need(encoded(output).length<=MAX_TOOL,'MCP_COLLECTION_TOOL_PAGE_TOO_LARGE');return output;
    };
    if(operation==='sources')return result(slice(Object.entries(record.sources).sort(([a],[b])=>a.localeCompare(b))
      .map(([name,source])=>({name,sha256:source.sha256,bytes:source.bytes})),body));
    if(operation==='buyers')return result(slice(Object.entries(record.buyers).sort(([a],[b])=>a.localeCompare(b))
      .map(([name,buyer])=>({name,...pick(buyer,['network','payer','manifestSha256','configSha256','request'])})),body));
    if(operation==='review')return result(previewView(record,(await readReview(record,body)).preview,body));
    if(operation==='export-status'){
      const {directory,...value}=await exportMetadata(record,body);return result(value);
    }
    if(operation==='export-file'){
      const exported=await exportMetadata(record,body);
      need(FILES.includes(body.filename),'MCP_COLLECTION_EXPORT_FILE_REQUIRED');
      const file=exported.files.find(file=>file.name===body.filename);
      need(file.sha256===hash(body.expectedFileSha256),'MCP_COLLECTION_EXPORT_CHANGED');
      return result({id:exported.id,exportId:exported.exportId,manifestSha256:exported.manifestSha256,
        filename:file.name,file:await reads({destination:join(exported.directory,file.name),bytes:file.bytes,
          sha256:file.sha256,contentType:file.name.endsWith('.json')?'application/json':
            file.name.endsWith('.csv')?'text/csv': 'text/html'},body)});
    }
    if(operation==='response-file'){
      const key=responseKey(record,body);
      const raw=await optionalBytes(join(responses,record.name,key+'.json'),65536);
      // This is the original verified source descriptor, so later ranges and
      // browser shutdown need neither another HTTP read nor another purchase.
      if(raw!==null)return result(await readOriginalResponse(record,body,parse(raw)));
    }
    const connection=await connect(record,context.signal);
    const get=route=>request(connection,route,undefined,context.signal);
    const post=(route,value)=>request(connection,route,value,context.signal);
    const route=()=>'/api/collections/'+encodeURIComponent(id(body.id));
    if(operation==='collections'){
      const value=await get('/api/collections');
      need(value.schema===STORE&&value.directory===record.directory&&value.queueRoot===record.queueRoot&&
        Array.isArray(value.collections),'MCP_COLLECTION_ORIGINAL_STORE_CHANGED');
      const page=slice(value.collections,body);return result({...page,items:page.items.map(summary)});
    }
    if(operation==='preview'){
      need(Array.isArray(body.sources)&&body.sources.length>=1&&body.sources.length<=500&&
        new Set(body.sources).size===body.sources.length,'MCP_COLLECTION_SOURCES_REQUIRED');
      const configFiles=[];
      for(const alias of body.sources){
        named(alias);need(Object.hasOwn(record.sources,alias),'MCP_COLLECTION_SOURCE_NOT_REGISTERED');
        const source=record.sources[alias],raw=await privateBytes(absolute(source.path),65536);
        need(raw.length===source.bytes&&sha(raw)===source.sha256,'MCP_COLLECTION_REGISTERED_SOURCE_CHANGED');
        configFiles.push(source.path);
      }
      const preview=await post('/api/preview',{configFiles});hexId(preview.reviewId);hash(preview.previewSha256);
      await privateDirectory(join(reviews,record.name),{create:true});
      await retainRecord(join(reviews,record.name,preview.reviewId+'.json'),
        {schema:SCHEMA,workspace:record.name,storeSha256:record.storeSha256,sources:body.sources,preview},{resume:true});
      return result(previewView(record,preview,body));
    }
    if(operation==='create'){
      id(body.id);need(typeof body.name==='string'&&body.name.length>=1&&body.name.length<=160,'MCP_COLLECTION_NAME_REQUIRED');
      hash(body.expectedPreviewSha256);
      // Inspect the original stable ID first; a successful create may have lost its reply and consumed its browser review.
      let prior;
      try{prior=await get(route());}catch(error){if(error.code!=='COLLECTION_NOT_FOUND')throw error;}
      if(prior&&prior.state!=='PREPARING'){
        need(prior.previewSha256===body.expectedPreviewSha256&&prior.name===body.name,'MCP_COLLECTION_CREATE_CONFLICT');
        return result({...snapshot(record,prior),reused:true});
      }
      await readReview(record,body);
      return result(snapshot(record,await post('/api/collections',body)));
    }
    if(operation==='inspect')return result(snapshot(record,await get(route()),body));
    if(operation==='run-status'){
      if(body.requestId!==undefined)requestId(body.requestId);
      if(body.requestId!==undefined)need(connection.state.agentApi>=1,'MCP_COLLECTION_CURRENT_HOST_REQUIRED');
      const value=await get(body.requestId===undefined?'/api/run':'/api/runs/'+body.requestId);
      return result({run:runView(record,value.run)});
    }
    if(operation==='pause'||operation==='approval'){
      const selected=requestId(body.requestId);
      const value=operation==='pause'?await post('/api/runs/'+selected+'/pause',{}):
        await get('/api/runs/'+selected+'/approvals/'+encodeURIComponent(intent(body.intentId)));
      return result({...value,run:runView(record,value.run)});
    }
    hash(body.expectedManifestSha256);
    if(operation==='run'){
      need(connection.state.agentApi>=1,'MCP_COLLECTION_CURRENT_HOST_REQUIRED');
      requestId(body.requestId);
      need(Array.isArray(body.intentIds)&&body.intentIds.length>=1&&body.intentIds.length<=500&&
        new Set(body.intentIds).size===body.intentIds.length,'MCP_COLLECTION_INTENTS_REQUIRED');
      body.intentIds.forEach(intent);
      const selected={id:body.id,expectedManifestSha256:body.expectedManifestSha256,
        intentIds:body.intentIds,requestId:body.requestId};
      const buyer=async alias=>{
        named(alias);need(Object.hasOwn(record.buyers,alias),'MCP_COLLECTION_BUYER_NOT_REGISTERED');
        return checkBuyer(record.buyers[alias]);
      };
      if(body.workspaceByIntent!==undefined)
        need(plain(body.workspaceByIntent)&&Object.keys(body.workspaceByIntent).every(key=>body.intentIds.includes(key)),
          'MCP_COLLECTION_WORKSPACE_MAP_INVALID');
      const mapping=Object.entries(body.workspaceByIntent??{});
      need(body.workspace===undefined||mapping.length===0,'MCP_COLLECTION_WORKSPACE_MAP_INVALID');
      if(body.workspace!==undefined)selected.workspace=await buyer(body.workspace);
      else if(mapping.length===0&&Object.hasOwn(record.buyers,'primary'))selected.workspace=await buyer('primary');
      if(body.workspaceByIntent!==undefined){
        const entries=[];
        for(const [key,alias]of mapping)entries.push([key,await buyer(alias)]);
        selected.workspaceByIntent=Object.fromEntries(entries);
      }
      const {id:ignored,...input}=selected;
      return result({run:runView(record,(await post(route()+'/run',input)).run)});
    }
    if(operation==='export'){
      need(connection.state.agentApi>=1,'MCP_COLLECTION_CURRENT_HOST_REQUIRED');hexId(body.exportId);
      const saved=await post(route()+'/export',{expectedManifestSha256:body.expectedManifestSha256,exportId:body.exportId});
      const exported=await exportMetadata(record,body);
      need(saved.directory===exported.directory,'MCP_COLLECTION_EXPORT_CHANGED');
      const {directory,...value}=exported;return result(value);
    }
    if(operation==='response-file'){
      intent(body.intentId);hash(body.expectedResponseSha256);
      const saved=await post(route()+'/response',{expectedManifestSha256:body.expectedManifestSha256,
        intentId:body.intentId,expectedResponseSha256:body.expectedResponseSha256});
      need(saved.intentId===body.intentId&&saved.manifestSha256===body.expectedManifestSha256&&
        saved.sha256===body.expectedResponseSha256,'MCP_COLLECTION_RESPONSE_CHANGED');
      const receipt={schema:SCHEMA,workspace:record.name,storeSha256:record.storeSha256,
        id:body.id,intentId:body.intentId,manifestSha256:body.expectedManifestSha256,
        file:pick(saved,['name','path','bytes','sha256'])};
      const value=await readOriginalResponse(record,body,receipt);
      await privateDirectory(join(responses,record.name),{create:true});
      await retainRecord(join(responses,record.name,responseKey(record,body)+'.json'),receipt,{resume:true});
      return result(value);
    }
    need(['enqueue','cancel','recover'].includes(operation),'MCP_COLLECTION_OPERATION_REQUIRED');
    const {id:ignored,...input}=body;
    return result(snapshot(record,await post(route()+'/'+operation,input)));
  }
  async function track(task){
    available();const promise=Promise.resolve().then(task);pending.add(promise);
    try{return await promise;}finally{pending.delete(promise);}
  }
  return {
    register:description=>track(()=>register(description)),
    call:(args,context)=>track(()=>perform(args,context)),
    async close(){if(closed)return;closed=true;shutdown.abort();await Promise.allSettled([...pending]);}
  };
}
