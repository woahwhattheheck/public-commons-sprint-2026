import { grantsWorkspaceTools, alias, nativeId, hash, UUID, read, page, requestId, expectedRevision, shortText, query, fields, exportKinds, string, publisherExportKinds, ID, HASH, strings } from './catalog/grantsgov-workspace.mjs';
export { grantsWorkspaceTools } from './catalog/grantsgov-workspace.mjs';
// MIT. Agent tools over the original Grants.gov source, qualification and publisher workspace.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { identifier, failure } from './host-files.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { privateDirectory, readPrivate, object, digest, identity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

export const GRANTS_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.grantsgov-workspace-connection.v1';
export const GRANTS_EXPORT_MANIFEST_SCHEMA='stellar-forge.grantsgov-mcp-export.v1';
export const GRANTS_EXPORT_MANIFEST_NAME='grants-export-manifest.json';

















const json=value=>Buffer.from(JSON.stringify(value)+'\n');
function exact(value,allowed,required=[]){
  if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))||
    required.some(key=>!Object.hasOwn(value,key)))throw failure('INVALID_PARAMS','Use the declared original fields: '+allowed.join(', ')+'.');
}
function checked(value,pattern,label){
  if(typeof value!=='string'||!pattern.test(value))throw failure('INVALID_PARAMS','Use the original '+label+'.');
  return value;
}
function count(value,min,max,label){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_PARAMS',label+' is outside its supported range.');
  return value;
}
function label(value,fallback){
  value??=fallback;if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))
    throw failure('CONFIGURATION_ERROR','Use a short host label.');
  return value.trim();
}
async function hostDirectory(value,base){
  if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value))throw failure('CONFIGURATION_ERROR','Declare an original private directory.');
  const path=resolve(base,value);
  if(await realpath(path)!==path)throw failure('CONFIGURATION_ERROR','Use canonical original directory paths.');
  await privateDirectory(path);return path;
}
function named(value){
  if(value===undefined)return [];
  if(!object(value)||Object.keys(value).length>100)throw failure('CONFIGURATION_ERROR','Declare at most 100 named host inputs.');
  return Object.entries(value).map(([key,item])=>[identifier(key,'Host alias'),item]);
}
function publisherRuntime(value={}){
  exact(value,['port','facilitator','allowLocalFacilitator']);
  count(value.port??0,0,65535,'Seller port');
  if(value.allowLocalFacilitator!==undefined&&typeof value.allowLocalFacilitator!=='boolean')
    throw failure('CONFIGURATION_ERROR','allowLocalFacilitator must be a Boolean.');
  if(value.facilitator!==undefined){
    let url;try{url=new URL(value.facilitator);}catch{throw failure('CONFIGURATION_ERROR','Choose the original facilitator URL.');}
    if(url.username||url.password||url.search||url.hash||
      url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&value.allowLocalFacilitator===true))
      throw failure('CONFIGURATION_ERROR','Choose the configured HTTPS or explicit loopback facilitator.');
  }
  return {...value,port:value.port??0};
}
/** Host configuration contains original aliases, public merchant terms and
 * retained source paths. Reading it opens no provider, signer or workspace. */
export async function readGrantsWorkspaceConfiguration(path){
  path=resolve(path);
  if(await realpath(path)!==path)throw failure('CONFIGURATION_ERROR','Use the canonical private connection file.');
  const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivate(path,1024*1024)));
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==GRANTS_WORKSPACE_CONNECTION_SCHEMA||!object(raw.workspaces)||
    !Object.keys(raw.workspaces).length||Object.keys(raw.workspaces).length>32)
    throw failure('CONFIGURATION_ERROR','Declare 1–32 Grants.gov workspaces.');
  const workspaces=Object.create(null),seen=new Set(),base=dirname(path);
  for(const [key,input]of Object.entries(raw.workspaces)){
    identifier(key,'Grants.gov workspace alias');
    exact(input,['label','directory','sources','merchants','buyerWorkspaces','runtime'],['directory']);
    const directory=await hostDirectory(input.directory,base);
    if(seen.has(directory))throw failure('CONFIGURATION_ERROR','Give each original directory one workspace alias.');
    seen.add(directory);
    const sources=Object.create(null),merchants=Object.create(null),buyers=Object.create(null),buyerDirectories=new Set();
    for(const [name,item]of named(input.sources)){
      exact(item,['label','kind','file','sha256'],['kind','file','sha256']);
      if(!['capture','edition','workspace'].includes(item.kind)||typeof item.file!=='string')
        throw failure('CONFIGURATION_ERROR','Choose a complete capture, edition or workspace source packet.');
      const file=resolve(base,item.file),stat=await lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||await realpath(file)!==file||stat.size>256*1024*1024)
        throw failure('CONFIGURATION_ERROR','Choose a retained regular source packet up to 256 MiB.');
      sources[name]={label:label(item.label,name),kind:item.kind,file,
        sha256:checked(item.sha256,HASH,'retained source SHA256')};
    }
    for(const [name,item]of named(input.merchants)){
      exact(item,['label','origin','path','payment','defaultLimit','maxLimit'],['origin','payment']);
      let origin;try{origin=new URL(item.origin);}catch{throw failure('CONFIGURATION_ERROR','Choose the original HTTPS merchant origin.');}
      if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||
        !object(item.payment))throw failure('CONFIGURATION_ERROR','Declare the original public merchant origin and terms.');
      if(item.path!==undefined&&(typeof item.path!=='string'||!/^\/[A-Za-z0-9/_-]+$/.test(item.path)))
        throw failure('CONFIGURATION_ERROR','Use the original dataset route.');
      const defaultLimit=count(item.defaultLimit??50,1,250,'Default page size');
      const maxLimit=count(item.maxLimit??100,defaultLimit,250,'Maximum page size');
      merchants[name]={label:label(item.label,name),origin:origin.origin,path:item.path??'/grant-opportunities',
        payment:structuredClone(item.payment),defaultLimit,maxLimit};
    }
    for(const [name,item]of named(input.buyerWorkspaces)){
      exact(item,['label','directory'],['directory']);
      const buyerDirectory=await hostDirectory(item.directory,base);
      if(buyerDirectories.has(buyerDirectory))throw failure('CONFIGURATION_ERROR','Give each original payer directory one alias.');
      buyerDirectories.add(buyerDirectory);buyers[name]={label:label(item.label,name),directory:buyerDirectory};
    }
    workspaces[key]={label:label(input.label,key),directory,sources,merchants,buyerWorkspaces:buyers,
      runtime:publisherRuntime(input.runtime)};
  }
  return {schema:GRANTS_WORKSPACE_CONNECTION_SCHEMA,workspaces};
}

const definitions=new Map(grantsWorkspaceTools((name,_description,properties={},required=[])=>({name,properties,required})).map(value=>[value.name,value]));
function paged(items,input={}){
  const offset=count(input.offset??0,0,items.length,'Offset'),limit=count(input.limit??50,1,250,'Page size'),snapshot=identity(items);
  if(offset>0&&input.expectedSnapshot===undefined)throw failure('GRANTS_SNAPSHOT_REQUIRED','Continue with the returned original list snapshot.');
  if(input.expectedSnapshot!==undefined&&input.expectedSnapshot!==snapshot)
    throw failure('GRANTS_LIST_CHANGED','The saved list changed. Read its first page again.');
  const selected=items.slice(offset,offset+limit);
  return {items:selected,total:items.length,offset,limit,snapshot,nextOffset:offset+selected.length<items.length?offset+selected.length:null};
}
export class MerchantGrantsWorkspaces{
  #config;#entries=new Map();#opening=new Map();#pending=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'GRANTS'});
  constructor(config){this.#config=config;}
  get summary(){
    return {configured:Boolean(this.#config.grantsWorkspaces),closing:this.#closing,...this.#reads.summary,
      workspaces:Object.entries(this.#config.grantsWorkspaces?.workspaces??{}).map(([workspace,value])=>{
        const entry=this.#entries.get(workspace);
        return {workspace,label:value.label,open:Boolean(entry),opening:this.#opening.has(workspace),
          closing:Boolean(entry?.closing),instanceId:entry?.instanceId??null,browserUrl:entry?.service.url??null,
          sources:Object.entries(value.sources).map(([source,item])=>({source,label:item.label,kind:item.kind,sha256:item.sha256})),
          merchantProfiles:Object.entries(value.merchants).map(([profile,item])=>({profile,label:item.label})),
          buyerWorkspaces:Object.entries(value.buyerWorkspaces).map(([id,item])=>({id,label:item.label}))};
      })};
  }
  #definition(alias){
    identifier(alias,'Grants.gov workspace alias');
    const selected=this.#config.grantsWorkspaces?.workspaces?.[alias];
    if(!selected)throw failure('GRANTS_WORKSPACE_NOT_CONFIGURED','Choose an alias from merchant_grants_workspaces.');
    return selected;
  }
  #entry(alias){
    this.#definition(alias);const entry=this.#entries.get(alias);
    if(!entry)throw failure('GRANTS_WORKSPACE_NOT_OPEN','Open the original Grants.gov workspace first.');
    if(entry.closing)throw failure('GRANTS_WORKSPACE_CLOSING','The original workspace is draining.');
    return entry;
  }
  #scope(entry,exportId){return 'grants:'+entry.alias+':'+this.#definition(entry.alias).directory+':'+exportId;}
  #visible(entry,value){
    const selected=this.#definition(entry.alias),paths=[selected.directory,
      ...Object.values(selected.buyerWorkspaces).map(value=>value.directory)].sort((a,b)=>b.length-a.length);
    const walk=value=>typeof value==='string'?paths.reduce((text,path)=>text.split(path).join('[workspace]'),value):
      Array.isArray(value)?value.map(walk):object(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['data','dataBase64'].includes(key)?item:walk(item)])):value;
    return walk(value);
  }
  async #state(entry){
    const state=await entry.workspace.snapshot();
    return {workspace:entry.alias,workspaceId:state.id,schema:state.schema,name:state.name,revision:state.revision,
      instanceId:entry.instanceId,browserUrl:entry.service.url,createdAt:state.createdAt,updatedAt:state.updatedAt,
      counts:Object.fromEntries(['queries','captures','editions','reviews','merchants','exports'].map(key=>[key,state[key].length])),
      jobs:state.jobs,captures:state.captures.filter(item=>item.running||['queued','interrupted','paused','error'].includes(item.status)),
      columns:state.columns,attribution:state.attribution,buyerWorkspaces:state.buyerWorkspaces};
  }
  async #open(alias){
    const selected=this.#definition(alias);
    if(this.#entries.has(alias))return this.#state(this.#entry(alias));
    if(this.#opening.has(alias))return this.#opening.get(alias);
    const opening=(async()=>{
      const [{openGrantsWorkspace},{startGrantsServer,grantsAction}]=await Promise.all([
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/workspace.mjs'),
        import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/server.mjs')]);
      let workspace,service;
      try{
        await hostDirectory(selected.directory,'/');
        workspace=await openGrantsWorkspace({directory:selected.directory,
          buyerWorkspaces:Object.entries(selected.buyerWorkspaces).map(([id,value])=>({id,directory:value.directory}))});
        service=await startGrantsServer({workspace,directory:selected.directory,port:0});
        if(this.#closing)throw failure('GRANTS_WORKSPACE_CLOSING','The merchant operator is closing.');
        const entry={alias,workspace,service,grantsAction,instanceId:service.instanceId,pending:new Set(),scopes:new Set(),closing:null};
        this.#entries.set(alias,entry);return this.#state(entry);
      }catch(error){
        await Promise.allSettled([service?.close(),workspace?.close()]);throw error;
      }
    })();
    this.#opening.set(alias,opening);
    try{return await opening;}finally{this.#opening.delete(alias);}
  }
  #closeEntry(entry){
    if(!entry.closing)entry.closing=(async()=>{
      await Promise.allSettled([...entry.pending]);
      for(const scope of entry.scopes)await this.#reads.closeScope(scope);
      const state=await entry.workspace.snapshot();
      const outcomes=await Promise.allSettled([entry.service.close(),entry.workspace.close()]);
      if(outcomes.some(value=>value.status==='rejected'))throw failure('GRANTS_SHUTDOWN_INCOMPLETE','An original owned application reported an incomplete shutdown.');
      if(this.#entries.get(entry.alias)===entry)this.#entries.delete(entry.alias);
      return {workspace:entry.alias,workspaceId:state.id,instanceId:entry.instanceId,state:'CLOSED'};
    })();
    return entry.closing;
  }
  async #manifest(entry,exportId){
    checked(exportId,HASH,'export digest');const state=await entry.workspace.snapshot();
    const file=state.exports.find(item=>item.id===exportId);
    if(!file)throw failure('GRANTS_EXPORT_NOT_FOUND','Choose an original export from the workspace inventory.');
    if(file.sha256!==exportId||!/^[a-z0-9-]+-[a-f0-9]{64}\.[a-z]+$/.test(file.name)||
      !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>256000000)
      throw failure('GRANTS_EXPORT_CHANGED','The native export descriptor differs.');
    const manifest={schema:GRANTS_EXPORT_MANIFEST_SCHEMA,exportId,workspaceId:state.id,
      kind:file.kind,files:[{name:file.name,bytes:file.bytes,sha256:file.sha256}]};
    const bytes=json(manifest),manifestSha256=digest(bytes);
    return {manifest,bytes,manifestSha256,file,manifestFile:{
      name:GRANTS_EXPORT_MANIFEST_NAME,bytes:bytes.length,sha256:manifestSha256}};
  }
  async #file(entry,input){
    const saved=await this.#manifest(entry,input.exportId);
    if(input.expectedManifestSha256!==undefined&&input.expectedManifestSha256!==saved.manifestSha256)
      throw failure('GRANTS_EXPORT_CHANGED','Use the original receiving manifest digest.');
    if(((input.offset??0)>0||input.readId)&&input.expectedManifestSha256===undefined)
      throw failure('GRANTS_EXPORT_HASH_REQUIRED','Continue with the original receiving manifest digest.');
    const isManifest=input.file===GRANTS_EXPORT_MANIFEST_NAME;
    if(!isManifest&&input.file!==saved.file.name)throw failure('GRANTS_EXPORT_FILE_NOT_FOUND','Choose the original manifest or its retained file name.');
    const scope=this.#scope(entry,input.exportId);entry.scopes.add(scope);
    const result=await this.#reads.read({scope,key:input.exportId+':'+input.file,kind:saved.file.kind,
      directory:entry.workspace.directory,readId:input.readId,expectedSha256:input.expectedSha256,
      offset:input.offset??0,limit:input.limit??65536,load:async()=>{
        if(isManifest)return {name:GRANTS_EXPORT_MANIFEST_NAME,type:'application/json',bytes:saved.bytes};
        const parts=[];let offset=0;
        while(true){
          const part=await entry.workspace.readExport(input.exportId,{offset,limit:8*1024*1024});
          if(part.file.name!==saved.file.name||part.file.sha256!==saved.file.sha256||part.file.bytes!==saved.file.bytes||
            part.offset!==offset)throw failure('GRANTS_EXPORT_CHANGED','The retained original export changed during its read.');
          const bytes=Buffer.from(part.data,'base64');
          if(bytes.length!==part.bytesRead||bytes.toString('base64')!==part.data)throw failure('GRANTS_EXPORT_CHANGED','The native export chunk differs.');
          parts.push(bytes);offset+=bytes.length;if(part.nextOffset===null)break;
          if(part.nextOffset!==offset||!bytes.length)throw failure('GRANTS_EXPORT_CHANGED','The native export continuation differs.');
        }
        const bytes=Buffer.concat(parts,offset);
        if(offset!==saved.file.bytes||digest(bytes)!==saved.file.sha256)throw failure('GRANTS_EXPORT_CHANGED','The complete native export differs.');
        return {name:saved.file.name,bytes};
      }});
    return {workspace:entry.alias,exportId:input.exportId,manifestSha256:saved.manifestSha256,...result};
  }
  async #dispatch(entry,name,input){
    const call=(action,payload=input)=>entry.grantsAction(entry.workspace,action,payload);
    switch(name){
      case 'merchant_grants_status':return this.#state(entry);
      case 'merchant_grants_inventory':{
        if(!['queries','captures','editions','reviews','merchants','exports'].includes(input.kind))
          throw failure('INVALID_PARAMS','Choose a saved inventory kind.');
        return {kind:input.kind,...paged((await entry.workspace.snapshot())[input.kind],input)};
      }
      case 'merchant_grants_query_save':return call('query.save');
      case 'merchant_grants_query':{
        const found=(await entry.workspace.snapshot()).queries.find(value=>value.id===input.queryId);
        if(!found)throw failure('GRANTS_QUERY_NOT_FOUND','Choose a saved original query.');
        return found;
      }
      case 'merchant_grants_capture':return call('capture.start');
      case 'merchant_grants_capture_status':return call('capture.status');
      case 'merchant_grants_pause':return call('capture.pause');
      case 'merchant_grants_source_import':{
        const selected=this.#definition(entry.alias).sources[identifier(input.source,'Source alias')];
        if(!selected)throw failure('GRANTS_SOURCE_NOT_CONFIGURED','Choose an original retained source handle.');
        if(await realpath(selected.file)!==selected.file)throw failure('GRANTS_SOURCE_CHANGED','The retained source path changed.');
        const bytes=await readPrivate(selected.file,256*1024*1024);
        if(digest(bytes)!==selected.sha256)throw failure('GRANTS_SOURCE_CHANGED','The source packet differs from its configured digest.');
        const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        return call(selected.kind==='capture'?'capture.import':selected.kind==='edition'?'edition.receive':'workspace.restore',
          {requestId:input.requestId,packet,name:input.name??selected.label});
      }
      case 'merchant_grants_edition_create':return call('edition.create');
      case 'merchant_grants_edition':{
        const {rows,...summary}=await entry.workspace.edition(input.editionId);
        return {...summary,rowCount:rows.length};
      }
      case 'merchant_grants_opportunities':
        if((input.offset??0)>0&&input.expectedSnapshot===undefined)throw failure('GRANTS_SNAPSHOT_REQUIRED','Continue with the original opportunity page snapshot.');
        return call('opportunity.list');
      case 'merchant_grants_opportunity':return call('opportunity.read');
      case 'merchant_grants_review_save':return call('review.save');
      case 'merchant_grants_compare':return call('edition.compare');
      case 'merchant_grants_workshare':return {format:input.format??'md',text:await call('workshare.read')};
      case 'merchant_grants_merchant':{
        const {profile,...selection}=input;
        let merchant={};
        if(profile!==undefined){
          const selected=this.#definition(entry.alias).merchants[identifier(profile,'Merchant profile')];
          if(!selected)throw failure('GRANTS_MERCHANT_NOT_CONFIGURED','Choose a configured merchant profile.');
          const {label,...config}=selected;merchant=config;
        }
        return call('merchant.create',{...merchant,...selection});
      }
      case 'merchant_grants_preview':return call('merchant.preview');
      case 'merchant_grants_export':return call('export.create');
      case 'merchant_grants_manifest':{
        const saved=await this.#manifest(entry,input.exportId);
        return {state:'MANIFEST_RETAINED',exportId:input.exportId,workspaceId:saved.manifest.workspaceId,
          kind:saved.file.kind,manifestFile:saved.manifestFile,files:saved.manifest.files};
      }
      case 'merchant_grants_file':return this.#file(entry,input);
      case 'merchant_grants_file_release':
        await this.#reads.release(this.#scope(entry,input.exportId),input.readId);
        return {exportId:input.exportId,readId:input.readId,state:'RELEASED'};
      case 'merchant_grants_publisher_status':return call('publisher.status',{});
      case 'merchant_grants_publisher_prepare':return call('publisher.prepare');
      case 'merchant_grants_publisher_preview':return call('publisher.preview');
      case 'merchant_grants_publisher_review':return call('publisher.reviewDraft');
      case 'merchant_grants_publish':return call('publisher.publish');
      case 'merchant_grants_snapshot':{
        const {action,...payload}=input;
        if(!['activate','collect'].includes(action))throw failure('INVALID_PARAMS','Choose activate or collect.');
        return call(action==='activate'?'publisher.activateSnapshot':'publisher.collect',payload);
      }
      case 'merchant_grants_release':{
        const {action,...payload}=input;
        if(!['stage','inspect','activate','rollback','start','stop'].includes(action))
          throw failure('INVALID_PARAMS','Choose an original SF82 release operation.');
        return call('publisher.release.'+action,action==='stage'?{...payload,runtime:this.#definition(entry.alias).runtime}:payload);
      }
      case 'merchant_grants_buyer_review':return call('publisher.buyer.review');
      case 'merchant_grants_buyer_prepare':return call('publisher.buyer.prepare');
      case 'merchant_grants_buyer_session':return call('publisher.buyer.session');
      case 'merchant_grants_buyer':{
        const {action,...payload}=input;
        if(!['run','recover','account','export'].includes(action))throw failure('INVALID_PARAMS','Choose an original buyer continuation.');
        return call('publisher.buyer.'+action,payload);
      }
      case 'merchant_grants_publisher_export':return call('publisher.export');
      default:throw failure('TOOL_NOT_FOUND','Unknown Grants.gov workspace operation.');
    }
  }
  async call(name,args={}){
    if(this.#closing)throw failure('GRANTS_OPERATOR_CLOSING','The Grants.gov operator is closing.');
    const definition=definitions.get(name);
    if(!definition)throw failure('TOOL_NOT_FOUND','Unknown Grants.gov workspace operation.');
    exact(args,Object.keys(definition.properties),definition.required);
    if(name==='merchant_grants_workspaces')return this.summary;
    const {workspace:alias,...input}=args;this.#definition(alias);
    if(name==='merchant_grants_open')return this.#open(alias);
    const entry=this.#entry(alias);
    if(name==='merchant_grants_close'){
      if(checked(input.instanceId,UUID,'owned instance ID')!==entry.instanceId)
        throw failure('GRANTS_INSTANCE_CHANGED','Close the exact owned instance shown by status.');
      return this.#closeEntry(entry);
    }
    const operation=this.#dispatch(entry,name,input);
    entry.pending.add(operation);this.#pending.add(operation);
    try{return this.#visible(entry,await operation);}
    finally{entry.pending.delete(operation);this.#pending.delete(operation);}
  }
  close(){
    if(!this.#close){
      this.#closing=true;
      this.#close=(async()=>{
        await Promise.allSettled([...this.#opening.values()]);
        await Promise.allSettled([...this.#pending]);
        const results=await Promise.allSettled([...this.#entries.values()].map(entry=>this.#closeEntry(entry)));
        await this.#reads.close();
        if(results.some(value=>value.status==='rejected'))throw failure('GRANTS_SHUTDOWN_INCOMPLETE','An original Grants.gov application is still draining.');
      })();
    }
    return this.#close;
  }
}
