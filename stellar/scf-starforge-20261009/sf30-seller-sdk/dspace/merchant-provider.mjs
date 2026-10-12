// MIT. Original DSpace HTTP operator tools inside the maintained merchant MCP host.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exact,failure,identifier,line,plain,privateSupportDirectory,writePrivate} from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {connectDspaceOperator,validateDspaceScope,inspectDspaceInput,readDspaceInput,DSPACE_MAX_INPUT_BYTES} from './client.mjs';

export const DSPACE_OPERATOR_CONNECTION_SCHEMA='stellar-forge.dspace-operator-connection.v1';
export const DSPACE_DOWNLOAD_SCHEMA='stellar-forge.dspace-operator-download.v1';
const DOWNLOAD_ID=/^dspace-download-[a-f0-9]{64}$/;
const HASH=/^[a-f0-9]{64}$/;
const REQUEST=/^[A-Za-z0-9_.:-]{8,128}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',minLength:1,maxLength:160};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const request={type:'string',pattern:'^[A-Za-z0-9_.:-]{8,128}$'};
const uuid={type:'string',format:'uuid'};
const object={type:'object',additionalProperties:true};
const integer={type:'integer',minimum:0};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:100}};
const scope={type:'object',properties:{operatorId:id,instanceId:id,projectKey:id,workspaceId:id},
  required:['operatorId','instanceId','projectKey','workspaceId'],additionalProperties:false};
const mutation={operationId:request,expectedRevision:integer,actor:{type:'string',minLength:1,maxLength:256}};
const rights={type:'object',properties:{attribution:{type:'string',minLength:1,maxLength:16000},
  basis:{type:'string',minLength:1,maxLength:16000},reference:{type:'string',format:'uri'}},
  required:['attribution','basis'],additionalProperties:false};
const sourceChoice={type:'object',properties:{sourceId:id,uuid,objectSha256:hash},
  required:['sourceId','uuid','objectSha256'],additionalProperties:false};
const read={readOnly:true,idempotent:true};
const downloadKinds=['project','source','dataset','config','comparison','sources','editions','reviews','comparisons','publications'];

function count(value,min,max,label){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_PARAMS',label+' is outside the supported range.');
  return value;
}
function hostPath(value,base){
  if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value))throw failure('CONFIGURATION_ERROR','Declare original paths in the private DSpace connection file.');
  return path.resolve(base,value);
}
function jsonObject(bytes){
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!plain(value))throw failure('CONFIGURATION_ERROR','Use a complete JSON object.');
  return value;
}
/** Resolve host declarations without opening a model or starting an operator. */
export async function readDspaceOperatorConfiguration(filename){
  filename=path.resolve(filename);
  const raw=jsonObject((await readDspaceInput(filename,{privateFile:true,maximum:1024*1024})).bytes);
  exact(raw,['schema','operators','downloadByteBudget'],['schema','operators']);
  if(raw.schema!==DSPACE_OPERATOR_CONNECTION_SCHEMA||!plain(raw.operators)||
      Object.keys(raw.operators).length<1||Object.keys(raw.operators).length>32)
    throw failure('CONFIGURATION_ERROR','Declare 1–32 original DSpace operators.');
  const downloadByteBudget=count(raw.downloadByteBudget??1024*1024*1024,1,Number.MAX_SAFE_INTEGER,'Retained download byte budget');
  const operators=Object.create(null),seen=new Set(),base=path.dirname(filename);
  for(const [name,input] of Object.entries(raw.operators)){
    identifier(name,'DSpace operator alias');
    exact(input,['label','launchFile','operatorId','inputs'],['launchFile']);
    const launchFile=hostPath(input.launchFile,base),directory=path.dirname(launchFile);
    if(path.basename(launchFile)!=='operator-launch.json')throw failure('CONFIGURATION_ERROR','Declare the original operator-launch.json file.');
    await privateSupportDirectory(directory);
    if(await fsp.realpath(directory)!==directory||seen.has(launchFile))throw failure('CONFIGURATION_ERROR','Give each original canonical operator one alias.');
    seen.add(launchFile);
    if(input.operatorId!==undefined&&(typeof input.operatorId!=='string'||!REQUEST.test(input.operatorId)))
      throw failure('CONFIGURATION_ERROR','Pin the original persistent operator ID returned by its launch.');
    if(input.inputs!==undefined&&(!plain(input.inputs)||Object.keys(input.inputs).length>32))
      throw failure('CONFIGURATION_ERROR','Declare up to32 named original input files.');
    const inputs=Object.create(null);
    for(const [key,item] of Object.entries(input.inputs??{})){
      identifier(key,'DSpace input alias');
      exact(item,['label','kind','file','sha256'],['kind','file']);
      if(!['source','workspace'].includes(item.kind)||item.sha256!==undefined&&!HASH.test(item.sha256))
        throw failure('CONFIGURATION_ERROR','An input is an original source capture or complete workspace with an optional exact SHA256.');
      const file=hostPath(item.file,base),st=await fsp.lstat(file);
      if(!st.isFile()||st.isSymbolicLink()||st.size>DSPACE_MAX_INPUT_BYTES||await fsp.realpath(file)!==file)
        throw failure('CONFIGURATION_ERROR','Declare a regular canonical original input within256 MiB.');
      inputs[key]={label:line(item.label??key),kind:item.kind,file,sha256:item.sha256};
    }
    operators[name]={label:line(input.label??name),launchFile,directory,operatorId:input.operatorId,inputs};
  }
  return {operators,downloadByteBudget};
}

export function dspaceOperatorTools(tool){
  const scoped=values=>({operator:alias,scope,...values});
  const change=values=>scoped({...mutation,...values});
  return [
    tool('merchant_dspace_status','List declared original operators and source inputs, or page the state of an explicitly bound original project. All collections have total and nextOffset.',{operator:alias,scope,...page},[],read),
    tool('merchant_dspace_bind','Borrow the already running declared operator through its verified private launch. Return the actual persistent operator, running instance, project and workspace. Explicit reconnect replaces only this borrowed client.',{operator:alias,reconnect:{type:'boolean'}},['operator'],read),
    tool('merchant_dspace_select_project','Explicitly select a retained project using the supplied original scope. Return the new complete scope for later calls.',scoped({key:id}),['operator','scope','key'],{idempotent:true}),
    tool('merchant_dspace_record','Read a retained source, edition, review, comparison or publication. Original long arrays are paged with totals; complete original records remain available through download.',scoped({kind:{enum:['sources','editions','reviews','comparisons','publications']},id,...page}),['operator','scope','kind','id'],read),
    tool('merchant_dspace_items','Page the original source item variants and exact object hashes. Choose all retained objects or the original captured collection scope.',scoped({sourceId:id,selection:{enum:['all','collection']},search:{type:'string',maxLength:1024},...page}),['operator','scope','sourceId'],read),
    tool('merchant_dspace_item','Inspect an exact original item variant. Without field, list all metadata fields and value counts; with field, page its unmodified value/property arrays, including linked virtual values.',scoped({sourceId:id,uuid,objectSha256:hash,field:{type:'string',maxLength:256},...page}),['operator','scope','sourceId','uuid','objectSha256'],read),
    tool('merchant_dspace_operation','Inspect the same original committed request after an interrupted reply. The request fingerprint and input/result stay attached to its original project; long original input arrays are paged.',scoped({operationId:request,...page}),['operator','scope','operationId'],read),
    tool('merchant_dspace_inputs','List host-declared input aliases, or hash one complete original input before importing/receiving it. Model arguments never select filesystem paths.',{operator:alias,input:alias},['operator'],read),
    tool('merchant_dspace_import','Import the complete SHA-pinned host-declared source capture through the original HTTP action. Keep the same actor, revision, bytes and operation ID for a permitted retry.',change({input:alias,expectedSha256:hash}),['operator','scope','input','expectedSha256','operationId','expectedRevision','actor']),
    tool('merchant_dspace_save_edition','Create an immutable native dataset projection from exact original source/UUID/object-hash choices, selected metadata fields and explicit attribution/distribution basis. Original field/value arrays are preserved by the existing engine.',change({name:{type:'string',minLength:1,maxLength:128},mode:{enum:['items','metadata-values']},
      selection:{type:'array',minItems:1,maxItems:10000,items:sourceChoice},
      metadataFields:{type:'array',minItems:1,maxItems:256,items:{type:'string',minLength:1,maxLength:256}},rights,previousEditionId:id}),
      ['operator','scope','operationId','expectedRevision','actor','name','mode','selection','metadataFields','rights']),
    tool('merchant_dspace_review_edition','Save a named approval or requested correction of the exact retained edition SHA. The latest review governs its native merchant export.',change({editionId:id,editionSha256:hash,decision:{enum:['approved','needs-changes']},comment:{type:'string',minLength:1,maxLength:32000}}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','editionSha256','decision','comment']),
    tool('merchant_dspace_select_edition','Select an exact edition with its latest matching approved review. Return the original dataset snapshot.',change({editionId:id,reviewId:id}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','reviewId']),
    tool('merchant_dspace_compare','Retain the native before/after edition comparison, preserving substantive and source-provenance changes separately.',change({beforeId:id,afterId:id}),
      ['operator','scope','operationId','expectedRevision','actor','beforeId','afterId']),
    tool('merchant_dspace_query','Use the original native dataset query and cursor on a retained edition. Preserve dataset.snapshot and page.nextCursor across the original returned pages.',scoped({editionId:id,query:object}),['operator','scope','editionId'],read),
    tool('merchant_dspace_record_publication','Attach an actual original merchant publication receipt whose snapshot matches this edition. This records the supplied original receipt through the existing model.',change({editionId:id,publication:object}),
      ['operator','scope','operationId','expectedRevision','actor','editionId','publication']),
    tool('merchant_dspace_receive','Stream one complete SHA-pinned host-declared SQLite project through the original receiver. Preserve the receiving operation ID across lost replies; return the selected received project and its new binding.',scoped({input:alias,expectedSha256:hash,operationId:request}),
      ['operator','scope','input','expectedSha256','operationId']),
    tool('merchant_dspace_download','Retain a complete original export in host-owned private storage and return its immutable receiving manifest. Its exact file remains readable after project selection or operator restart.',scoped({kind:{enum:downloadKinds},id,expectedSha256:hash}),
      ['operator','scope','kind'],read),
    tool('merchant_dspace_download_read','Read the exact retained receiving manifest without opening or changing the original operator.',{operator:alias,downloadId:{type:'string',pattern:DOWNLOAD_ID.source}},
      ['operator','downloadId'],read),
    tool('merchant_dspace_file','Receive a retained original file in SHA-pinned chunks. Continue with readId and nextOffset; the host streams one immutable snapshot and returns exact complete-file metadata.',{
      operator:alias,downloadId:{type:'string',pattern:DOWNLOAD_ID.source},expectedSha256:hash,readId:uuid,offset:integer,
      limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['operator','downloadId','expectedSha256'],read),
    tool('merchant_dspace_file_release','Release one unfinished retained-file read while keeping its original complete export.',{operator:alias,downloadId:{type:'string',pattern:DOWNLOAD_ID.source},readId:uuid},
      ['operator','downloadId','readId'],{idempotent:true})
  ];
}
const definitions=new Map(dspaceOperatorTools((name,description,properties,required=[])=>({name,properties,required})).map(d=>[d.name,d]));
function paged(values,offset=0,limit=20){
  const items=values.slice(offset,offset+limit);
  return {items,page:{offset,limit,total:values.length,nextOffset:offset+items.length<values.length?offset+items.length:null}};
}
function pageFields(value,fields,offset,limit){
  const output={...value},pages={...value?.pages};
  for(const field of fields)if(Array.isArray(value[field])){const selected=paged(value[field],offset,limit);output[field]=selected.items;pages[field]=selected.page;}
  if(Object.keys(pages).length)output.pages=pages;
  return output;
}
function stateView(state,offset,limit){
  return pageFields(state,['sources','editions','reviews','comparisons','publications'],offset,limit);
}
const itemSummary=item=>({uuid:item.uuid,objectSha256:item.object_sha256,name:item.name,entity_type:item.entity_type,
  fields:item.fields,metadata_count:item.metadata_count,in_scope:item.in_scope,origins:item.origins});
function recordView(kind,record,offset,limit){
  const output=pageFields(record,['selection','requests','files','original_files','conflicting_uuids'],offset,limit);
  if(kind==='sources')output.items=record.items.map(itemSummary);
  return output;
}
function itemView(item,{field,offset=0,limit=20}){
  const {metadata,...object}=item.object;
  const fields=Object.entries(metadata??{}).map(([name,values])=>({field:name,count:values.length,
    linkedValueCount:values.filter(v=>typeof v.authority==='string'&&v.authority.startsWith('virtual::')).length}));
  if(field!==undefined&&!Object.hasOwn(metadata,field))throw failure('DSPACE_METADATA_FIELD','Choose a field observed in this exact original item.');
  const values=field===undefined?null:paged(metadata[field],offset,limit);
  return {...itemSummary(item),object,metadata:{fields,...(values?{field,values:values.items,page:values.page}:{valuesAvailable:true})}};
}
function downloadIdentity(value){
  return 'dspace-download-'+sha(JSON.stringify([DSPACE_DOWNLOAD_SCHEMA,value.operatorId,value.projectKey,value.workspaceId,
    value.kind,value.recordId,value.file.filename,value.file.contentType,value.file.bytes,value.file.sha256]));
}

export class MerchantDspaceOperators {
  #config;#handles=new Map();#identities=new Map();#pending=new Set();#closing=false;#close;#reads;
  constructor(config){
    this.#config=config;
    this.#reads=new RetainedFileReads({errorPrefix:'DSPACE',maxSnapshotBytes:config.dspaceOperators?.downloadByteBudget??1024*1024*1024});
  }
  get summary(){return {configured:Boolean(this.#config.dspaceOperators),connected:[...this.#handles.keys()],
    pending:this.#pending.size,closing:this.#closing,...this.#reads.summary};}
  #declared(name){
    identifier(name,'DSpace operator alias');
    const entry=this.#config.dspaceOperators?.operators?.[name];
    if(!entry)throw failure('DSPACE_OPERATOR_NOT_CONFIGURED','Choose an original alias from merchant_dspace_status.');
    return entry;
  }
  async #client(name,reconnect=false){
    const entry=this.#declared(name);
    if(reconnect&&this.#handles.has(name)){
      const old=this.#handles.get(name);this.#handles.delete(name);
      await old.then(client=>client.close(),()=>{});
    }
    if(!this.#handles.has(name)){
      const opening=connectDspaceOperator({launchFile:entry.launchFile,directory:entry.directory,
        operatorId:entry.operatorId??this.#identities.get(name)});
      this.#handles.set(name,opening);
      opening.then(client=>this.#identities.set(name,client.scope.operatorId),()=>{
        if(this.#handles.get(name)===opening)this.#handles.delete(name);
      });
    }
    return this.#handles.get(name);
  }
  async #cache(name){
    this.#declared(name);
    await privateSupportDirectory(this.#config.exportsDirectory);
    const root=path.join(this.#config.exportsDirectory,'dspace-operators',name);
    await fsp.mkdir(root,{recursive:true,mode:0o700});await privateSupportDirectory(root);
    if(await fsp.realpath(root)!==root)throw failure('DSPACE_DOWNLOAD_PATH','Use the original canonical private export directory.');
    return root;
  }
  #input(name,key,kind){
    const entry=this.#declared(name);identifier(key,'DSpace input alias');
    const input=entry.inputs[key];
    if(!input||kind&&input.kind!==kind)throw failure('DSPACE_INPUT_NOT_CONFIGURED','Choose a declared original '+(kind??'input')+' file.');
    return input;
  }
  async #inspectInput(name,key){
    const input=this.#input(name,key),actual=await inspectDspaceInput(input.file);
    if(input.sha256&&input.sha256!==actual.sha256)throw failure('DSPACE_INPUT_CHANGED','The original input differs from its host-pinned SHA256.');
    return {input:key,label:input.label,kind:input.kind,...actual};
  }
  async #manifest(name,id){
    if(!DOWNLOAD_ID.test(id??''))throw failure('INVALID_PARAMS','Use an original DSpace download ID.');
    const root=await this.#cache(name),file=path.join(root,id+'.json');
    const value=jsonObject((await readDspaceInput(file,{privateFile:true,maximum:128*1024})).bytes);
    if(value.schema!==DSPACE_DOWNLOAD_SCHEMA||!plain(value.file)||value.downloadId!==id||downloadIdentity(value)!==id||
        !HASH.test(value.file?.sha256)||!Number.isSafeInteger(value.file?.bytes)||value.file.bytes<0)
      throw failure('DSPACE_DOWNLOAD_MANIFEST','The original retained download manifest changed.');
    const declared=this.#declared(name);
    if(declared.operatorId&&declared.operatorId!==value.operatorId||this.#identities.has(name)&&this.#identities.get(name)!==value.operatorId)
      throw failure('DSPACE_DOWNLOAD_OPERATOR','This download belongs to a different original operator.');
    return {root,value};
  }
  async #retain(name,client,args){
    const root=await this.#cache(name),file=await client.download({kind:args.kind,id:args.id??'',scope:args.scope,
      directory:root,expectedSha256:args.expectedSha256,maximumBytes:this.#config.dspaceOperators?.downloadByteBudget??1024*1024*1024});
    const manifest={schema:DSPACE_DOWNLOAD_SCHEMA,operatorId:file.scope.operatorId,sourceInstanceId:file.scope.instanceId,
      projectKey:file.scope.projectKey,workspaceId:file.scope.workspaceId,kind:file.kind,recordId:file.id,
      file:{filename:file.filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256},createdAt:new Date().toISOString()};
    manifest.downloadId=downloadIdentity(manifest);
    try{await writePrivate(path.join(root,manifest.downloadId+'.json'),manifest);}
    catch(error){if(error.code!=='EEXIST')throw error;return (await this.#manifest(name,manifest.downloadId)).value;}
    return manifest;
  }
  async #file(name,args){
    const {root,value}=await this.#manifest(name,args.downloadId);
    if(args.expectedSha256!==value.file.sha256)throw failure('DSPACE_DOWNLOAD_CHANGED','Receive the exact SHA256 from this original manifest.');
    return this.#reads.read({scope:name+'/'+value.downloadId,key:value.file.sha256,kind:value.kind,directory:root,
      expectedSha256:value.file.sha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      loadFile:async()=>({path:path.join(root,value.file.sha256+'.data'),name:value.file.filename,
        type:value.file.contentType,bytes:value.file.bytes})});
  }
  async #dispatch(name,args){
    const pageTool=['merchant_dspace_status','merchant_dspace_record','merchant_dspace_items','merchant_dspace_item','merchant_dspace_operation'].includes(name);
    const offset=pageTool?count(args.offset??0,0,Number.MAX_SAFE_INTEGER,'Offset'):0,limit=pageTool?count(args.limit??20,1,100,'Page limit'):20;
    if(name==='merchant_dspace_status'&&!args.operator){
      if(args.scope)throw failure('INVALID_PARAMS','Choose the declared operator for this scope.');
      return {configured:Boolean(this.#config.dspaceOperators),operators:Object.entries(this.#config.dspaceOperators?.operators??{})
        .map(([alias,entry])=>({operator:alias,label:entry.label,operatorId:entry.operatorId??this.#identities.get(alias)??null,
          connected:this.#handles.has(alias),inputs:Object.entries(entry.inputs).map(([input,value])=>({input,label:value.label,kind:value.kind}))})),
        retained:this.#reads.summary};
    }
    const entry=this.#declared(args.operator);
    if(name==='merchant_dspace_inputs'){
      if(args.input)return this.#inspectInput(args.operator,args.input);
      return {operator:args.operator,inputs:Object.entries(entry.inputs).map(([input,value])=>({input,label:value.label,kind:value.kind,pinnedSha256:value.sha256??null}))};
    }
    if(name==='merchant_dspace_download_read')return (await this.#manifest(args.operator,args.downloadId)).value;
    if(name==='merchant_dspace_file')return this.#file(args.operator,args);
    if(name==='merchant_dspace_file_release'){
      if(!DOWNLOAD_ID.test(args.downloadId))throw failure('INVALID_PARAMS','Use the original download ID.');
      return this.#reads.release(args.operator+'/'+args.downloadId,args.readId);
    }
    if(name==='merchant_dspace_bind'){
      if(args.reconnect!==undefined&&typeof args.reconnect!=='boolean')throw failure('INVALID_PARAMS','reconnect must be a Boolean.');
      const client=await this.#client(args.operator,args.reconnect===true),state=await client.state();
      return {operator:args.operator,scope:client.scope,state:stateView(state,0,20),
        source:{serverSha256:client.launch.serverSha256},borrowed:true};
    }
    if(!args.scope)throw failure('DSPACE_SCOPE_REQUIRED','Bind the existing operator and use its full returned project scope.');
    validateDspaceScope(args.scope);
    const client=await this.#client(args.operator);
    const base={scope:args.scope},payload=keys=>Object.fromEntries(keys.filter(k=>Object.hasOwn(args,k)).map(k=>[k,args[k]]));
    const change=(action,keys)=>client.dispatch(action,payload(['operationId','expectedRevision','actor',...keys]),base);
    switch(name){
      case 'merchant_dspace_status':return stateView(await client.state(base),offset,limit);
      case 'merchant_dspace_select_project':{const result=await client.selectProject({...base,key:args.key});return {...result,state:stateView(result.state,0,20)};}
      case 'merchant_dspace_record':return recordView(args.kind,await client.record({...base,kind:args.kind,id:args.id,offset,limit}),offset,limit);
      case 'merchant_dspace_items':return client.items({...base,...payload(['sourceId','selection','search']),offset,limit});
      case 'merchant_dspace_item':return itemView(await client.item({...base,...payload(['sourceId','uuid','objectSha256'])}),{...args,offset,limit});
      case 'merchant_dspace_operation':{
        const value=await client.operation({...base,operationId:args.operationId});
        return {...value,input:pageFields(value.input,['selection'],offset,limit)};
      }
      case 'merchant_dspace_import':{
        const input=this.#input(args.operator,args.input,'source');
        if(input.sha256&&input.sha256!==args.expectedSha256)throw failure('DSPACE_INPUT_CHANGED','Use the host-pinned original source hash.');
        return client.importSource({...base,...payload(['operationId','expectedRevision','actor']),file:input.file,expectedSha256:args.expectedSha256});
      }
      case 'merchant_dspace_save_edition':return change('save-edition',['name','mode','selection','metadataFields','rights','previousEditionId']);
      case 'merchant_dspace_review_edition':return change('review-edition',['editionId','editionSha256','decision','comment']);
      case 'merchant_dspace_select_edition':return change('select-edition',['editionId','reviewId']);
      case 'merchant_dspace_compare':return change('compare-editions',['beforeId','afterId']);
      case 'merchant_dspace_query':return client.query({...base,editionId:args.editionId,query:args.query??{}});
      case 'merchant_dspace_record_publication':return change('record-publication',['editionId','publication']);
      case 'merchant_dspace_receive':{
        const input=this.#input(args.operator,args.input,'workspace');
        if(input.sha256&&input.sha256!==args.expectedSha256)throw failure('DSPACE_INPUT_CHANGED','Use the host-pinned original receiving hash.');
        const result=await client.receiveWorkspace({...base,file:input.file,expectedSha256:args.expectedSha256,operationId:args.operationId});
        return {...result,state:stateView(result.state,0,20)};
      }
      case 'merchant_dspace_download':return this.#retain(args.operator,client,args);
      default:throw failure('TOOL_NOT_FOUND','Unknown DSpace operator tool.');
    }
  }
  async call(name,args={}){
    if(this.#closing)throw failure('OPERATOR_CLOSING','The borrowed DSpace adapter is closing.');
    const definition=definitions.get(name);if(!definition)throw failure('TOOL_NOT_FOUND','Unknown DSpace operator tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    const pending=this.#dispatch(name,args);this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){
    if(!this.#close){
      this.#closing=true;this.#close=(async()=>{
        await Promise.allSettled([...this.#pending]);
        const outcomes=await Promise.allSettled([...this.#handles.values()].map(p=>p.then(client=>client.close(),()=>{})));
        outcomes.push(...await Promise.allSettled([this.#reads.close()]));
        const errors=outcomes.filter(r=>r.status==='rejected').map(r=>r.reason);
        if(errors.length)throw new AggregateError(errors,'Borrowed DSpace clients and retained reads reported shutdown errors.');
      })();
    }
    return this.#close;
  }
}

/** Host CLI receiver for one complete retained MCP file; destination is never a tool argument. */
export async function receiveDspaceMerchantFile({merchant,operator,downloadId,expectedSha256,destination,chunkBytes=MAX_RETAINED_CHUNK_BYTES}){
  if(!merchant||typeof merchant.call!=='function'||typeof destination!=='string'||!HASH.test(expectedSha256??''))
    throw failure('INVALID_PARAMS','Use the original merchant client, retained file identity, SHA256 and a host receiving destination.');
  count(chunkBytes,1,MAX_RETAINED_CHUNK_BYTES,'File chunk size');
  const manifest=await merchant.call('merchant_dspace_download_read',{operator,downloadId});
  if(manifest.file.sha256!==expectedSha256)throw failure('DSPACE_DOWNLOAD_CHANGED','The selected manifest has different original bytes.');
  destination=path.resolve(destination);await privateSupportDirectory(path.dirname(destination));
  if(await fsp.realpath(path.dirname(destination))!==path.dirname(destination))throw failure('DSPACE_DOWNLOAD_PATH','Use a canonical private receiving directory.');
  try{
    const existing=await inspectDspaceInput(destination,{maximum:manifest.file.bytes,privateFile:true});
    if(existing.bytes!==manifest.file.bytes||existing.sha256!==expectedSha256)throw failure('DSPACE_DOWNLOAD_CHANGED','The destination contains another original file.');
    return {file:destination,...manifest.file,downloadId,replayed:true};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const part=destination+'.'+downloadId+'.part',receipt=part+'.json';
  const identity={downloadId,sha256:expectedSha256,bytes:manifest.file.bytes,operatorId:manifest.operatorId,workspaceId:manifest.workspaceId};
  try{await writePrivate(receipt,identity);}
  catch(error){if(error.code!=='EEXIST')throw error;const old=jsonObject((await readDspaceInput(receipt,{privateFile:true,maximum:65536})).bytes);
    if(json(old)!==json(identity))throw failure('DSPACE_DOWNLOAD_CHANGED','This partial receiving file belongs to another original download.');}
  let handle,readId,offset=0,completed=false;
  try{
    try{handle=await fsp.open(part,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);}
    catch(error){if(error.code!=='EEXIST')throw error;
      const actual=await inspectDspaceInput(part,{maximum:manifest.file.bytes,privateFile:true});offset=actual.bytes;
      handle=await fsp.open(part,fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW??0));}
    while(offset<manifest.file.bytes){
      const response=await merchant.call('merchant_dspace_file',{operator,downloadId,expectedSha256,offset,limit:chunkBytes,...(readId?{readId}:{})});
      if(response.file.sha256!==expectedSha256||response.file.bytes!==manifest.file.bytes||response.offset!==offset||response.encoding!=='base64')
        throw failure('DSPACE_DOWNLOAD_CHANGED','The retained chunk belongs to another original file.');
      const bytes=Buffer.from(response.data,'base64');
      if(bytes.toString('base64')!==response.data||bytes.length!==response.bytesRead||!bytes.length||
          offset+bytes.length>manifest.file.bytes||response.nextOffset!==(offset+bytes.length<manifest.file.bytes?offset+bytes.length:null))
        throw failure('DSPACE_DOWNLOAD_CHUNK','The original retained chunk is incomplete or inconsistent.');
      let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,offset+written);written+=result.bytesWritten;}
      offset+=bytes.length;readId=response.readId;
    }
    await handle.sync();await handle.close();handle=null;
    const received=await inspectDspaceInput(part,{maximum:manifest.file.bytes,privateFile:true});
    if(received.bytes!==manifest.file.bytes||received.sha256!==expectedSha256)throw failure('DSPACE_DOWNLOAD_CHANGED','The complete received bytes differ from the original manifest.');
    try{await fsp.link(part,destination);}catch(error){if(error.code!=='EEXIST')throw error;
      const existing=await inspectDspaceInput(destination,{maximum:manifest.file.bytes,privateFile:true});
      if(existing.sha256!==expectedSha256||existing.bytes!==manifest.file.bytes)throw failure('DSPACE_DOWNLOAD_CHANGED','Another file appeared at the receiving destination.');}
    completed=true;return {file:destination,...manifest.file,downloadId,replayed:false};
  }finally{
    await handle?.close();
    if(readId)await merchant.call('merchant_dspace_file_release',{operator,downloadId,readId}).catch(()=>{});
    if(completed){await fsp.unlink(part).catch(()=>{});await fsp.unlink(receipt).catch(()=>{});}
  }
}
