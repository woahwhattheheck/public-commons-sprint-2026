// MIT. Complete original FHIR operations through the native workspace owner.
import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {RetainedFileReads} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {FhirConnection} from './connection.mjs';
import {fhirMerchantTools,validateFhirArguments} from './catalog.mjs';
import {directory,readSourceFile,immutable,retainFile,regular,fileIdentity,inputSnapshot} from './files.mjs';
import {TOOL_PREFIX,EXPORT_SCHEMA,RESULT_SCHEMA,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,
  ALIAS,SHA,plain,need,checked,decode,encode,digest,manifestIdentity,parseFhirExport,jsonPointer} from './contracts.mjs';
export {fhirMerchantTools} from './catalog.mjs';
const part=value=>encodeURIComponent(value);
const path=(...parts)=>'/api/'+parts.map(part).join('/');
function query(target,values){
  const params=new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
  return target+(params.size?'?'+params:'');
}
function preview(value){
  if(Buffer.byteLength(JSON.stringify(value))<=20000)return {value,completeValue:true};
  const summary=plain(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    Array.isArray(item)?{kind:'array',items:item.length,pointer:'/'+key.replace(/~/g,'~0').replace(/\//g,'~1')}:
      typeof item==='string'?{kind:'string',characters:item.length}:
      plain(item)?{kind:'object',keys:Object.keys(item)}:item])):
    {kind:Array.isArray(value)?'array':typeof value,...(Array.isArray(value)?{items:value.length}:{})};
  return {preview:summary,completeValue:false};
}
function nativeRoute(action,args){
  const get=target=>({method:'GET',target}),post=(target,input)=>({method:'POST',target,input});
  const direct={operator:'operator',state:'state',catalogue:'catalogue',auth_profiles:'auth-profiles'};
  if(direct[action])return get(path(direct[action]));
  const records={connection:['connections','connectionId'],discovery:['discoveries','discoveryId'],
    group_page:['group-pages','groupPageId'],export:['exports','exportId'],operation:['operations','operationId'],
    source:['sources','sourceId'],plan:['plans','planId'],build:['builds','buildId']};
  if(records[action]){const [collection,key]=records[action];return get(path(collection,args[key]));}
  const saves={connection_save:['connections','connection'],export_save:['exports','export'],
    compose:['compositions','composition'],plan_save:['plans','plan']};
  if(saves[action]){const [collection,key]=saves[action];return post(path(collection),args[key]);}
  if(action==='discover')return post(path('connections',args.connectionId,'discover'),{});
  if(action==='groups')return post(path('connections',args.connectionId,'groups'),args.url?{url:args.url}:{});
  if(action==='export_advance')return post(path('exports',args.exportId,'advance'),{operationId:args.operationId});
  if(action==='operation_status')return post(path('operations',args.operationId,'status'),{statusUrl:args.statusUrl,reason:args.reason});
  if(action==='operation_receive_capture')return post(path('operations',args.operationId,'receive-capture'),
    {sourceId:args.sourceId,reason:args.reason});
  if(action==='operation_cancel')return post(path('operations',args.operationId,'cancel'),{requestId:args.requestId});
  if(action==='source_members')return get(path('sources',args.sourceId,'members'));
  if(action==='source_rows')return get(query(path('sources',args.sourceId,'rows'),
    {resourceType:args.resourceType,kind:args.kind,offset:args.offset,limit:args.limit,query:args.query}));
  if(action==='source_row')return get(path('sources',args.sourceId,'rows',args.fileId,args.line));
  if(action==='source_file')return {...get(path('sources',args.sourceId,'files',args.member)),
    kind:'source-file',filename:args.member.endsWith('.json')?'fhir-source-member.json':args.member.endsWith('.zip')?'fhir-original-capture.zip':'fhir-original-source-member.ndjson'};
  if(action==='source_packet')return {...get(path('sources',args.sourceId,'packet')),kind:'source-packet',filename:'fhir-original-source.zip'};
  if(action==='mapping_default')return post(path('sources',args.sourceId,'mapping'),
    {resourceType:args.resourceType,...(args.name?{name:args.name}:{})});
  if(action==='mapping_preview')return post(path('sources',args.sourceId,'preview'),
    {plan:args.plan,...(args.limit===undefined?{}:{limit:args.limit})});
  if(action==='build_create')return post(path('builds'),{sourceId:args.sourceId,planId:args.planId});
  if(action==='build_query')return get(query(path('builds',args.buildId,'query'),args.query??{}));
  if(action==='build_dataset')return {...get(path('builds',args.buildId,'dataset')),kind:'dataset',filename:'fhir-dataset.zip'};
  if(action==='build_packet')return {...get(path('builds',args.buildId,'packet')),kind:'dataset-packet',filename:'fhir-customer-packet.zip'};
  if(action==='comparison_create')return post(path('comparisons'),{beforeId:args.beforeId,afterId:args.afterId});
  if(action==='comparison_changes')return get(query(path('comparisons',args.comparisonId,'changes'),{offset:args.offset,limit:args.limit}));
  if(action==='comparison_file')return {...get(path('comparisons',args.comparisonId,'file')),
    kind:'comparison-file',filename:'fhir-edition-changes.jsonl'};
  if(action==='workspace_packet')return {...get(path('workspace','packet')),kind:'workspace-packet',filename:'fhir-editable-workspace.zip'};
  return null;
}
export class MerchantFhirBulk {
  #config;#clients=new Map();#pending=new Set();#queues=new Map();
  #readers=new RetainedFileReads({errorPrefix:'FHIR_BULK'});#closing=false;#close=null;
  constructor(config){this.#config=config;}
  get summary(){
    return {configured:Boolean(this.#config.fhirBulk),workspaces:Object.entries(this.#config.fhirBulk?.workspaces??{}).map(([workspace,b])=>({
      workspace,label:b.label,workspaceId:this.#clients.get(workspace)?.summary.workspaceId??b.workspaceId,
      allowStart:b.allowStart,selectionSha256:b.selectionSha256,
      inputs:Object.entries(b.inputs).map(([input,v])=>({input,label:v.label,sha256:v.sha256,bytes:v.bytes}))})),
      clients:[...this.#clients].map(([workspace,c])=>({workspace,...c.summary})),...this.#readers.summary};
  }
  #binding(alias){
    checked(alias,ALIAS,'workspace alias');const selected=this.#config.fhirBulk?.workspaces?.[alias];
    need(selected,'FHIR_BULK_NOT_CONFIGURED','Choose an original host-declared FHIR workspace.');return selected;
  }
  #client(alias){
    const selected=this.#binding(alias);
    if(!this.#clients.has(alias))this.#clients.set(alias,new FhirConnection(selected));
    return this.#clients.get(alias);
  }
  async #root(alias){
    this.#binding(alias);
    return directory(join(await directory(join(this.#config.exportsDirectory,'fhir-bulk')),alias));
  }
  async #capture(alias,original,args,route){
    const binary=Boolean(original.file),kind=binary?route.kind:'native-response',
      bodies=[binary?{name:route.filename,file:original.file,contentType:original.contentType}:
        {name:'original-response.json',bytes:original.bytes,contentType:original.contentType},
        {name:'original-request.json',bytes:encode({action:route.action,method:route.method,target:route.target,
          arguments:args}),contentType:'application/json'}],
      source={action:route.action,method:route.method,status:original.status,ok:original.ok,
        requestSha256:digest(bodies[1].bytes),...(args.operationId?{operationId:args.operationId}:{}),
        ...(args.requestId?{requestId:args.requestId}:{}),
        ...(original.previousWorkspaceId?{previousWorkspaceId:original.previousWorkspaceId}:{})},
      manifest={schema:EXPORT_SCHEMA,workspace:alias,workspaceId:original.workspaceId,instanceId:original.instanceId,
        kind,source,files:bodies.map(body=>({name:body.name,bytes:body.file?.bytes??body.bytes.length,
          sha256:body.file?.sha256??digest(body.bytes),contentType:body.contentType}))};
    manifest.exportId=manifestIdentity(manifest);
    const manifestBytes=encode(manifest);parseFhirExport(manifestBytes,manifest.exportId);
    const descriptor={schema:RESULT_SCHEMA,state:original.ok?'COMPLETED':'REJECTED',workspace:alias,
      workspaceId:original.workspaceId,instanceId:original.instanceId,kind,source,exportId:manifest.exportId,
      native:{ok:original.ok,status:original.status,headers:original.headers},manifestSha256:digest(manifestBytes),
      manifestFile:{name:MANIFEST_NAME,bytes:manifestBytes.length,sha256:digest(manifestBytes)},
      files:manifest.files,...(original.value===undefined?{}:preview(original.value))};
    try{
      const root=await this.#root(alias),files=await directory(join(root,'files')),exports=await directory(join(root,'exports'));
      for(const [index,body] of bodies.entries()){
        const destination=join(files,manifest.files[index].sha256);
        if(body.file)await retainFile(body.file,destination);else await immutable(destination,body.bytes);
      }
      await immutable(join(exports,manifest.exportId+'.json'),manifestBytes);
    }catch(error){
      // Only this request's complete temporary spool is disposable here.
      // A content-addressed file already linked into files/ remains retained.
      if(original.file)await unlink(original.file.path).catch(cleanup=>{if(cleanup.code!=='ENOENT')
        error.cleanupCode=cleanup.code??cleanup.name;});
      return {...descriptor,exportId:null,retention:{state:'FAILED',code:error.code??error.name,...(error.cleanupCode?{cleanupCode:error.cleanupCode}:{}),
        recovery:route.method==='POST'?'Read the original saved operation or retained content identity after restoring storage.':
          'Repeat the same original read after restoring export storage.'}};
    }
    return {...descriptor,retention:{state:'COMPLETE'}};
  }
  async #manifest(alias,id,expected){
    this.#binding(alias);checked(id,SHA,'retained export ID');
    const root=await this.#root(alias),bytes=await readSourceFile(join(root,'exports',id+'.json'),{privateFile:true,maxBytes:65000}),
      sha256=digest(bytes),manifest=parseFhirExport(bytes,id);
    need(manifest.workspace===alias && (expected===undefined || checked(expected,SHA,'manifest SHA256')===sha256),
      'FHIR_BULK_EXPORT_CHANGED','Select the original export and exact manifest identity.');
    return {root,bytes,sha256,manifest};
  }
  async #selectedFile(saved,name){
    const item=saved.manifest.files.find(file=>file.name===name);
    need(item,'FHIR_BULK_FILE_NOT_FOUND','Choose a file declared in the original retained manifest.');
    return {...item,path:join(saved.root,'files',item.sha256)};
  }
  async #body(saved,name){
    const item=await this.#selectedFile(saved,name);
    need(item.bytes<=MAX_RESPONSE_BYTES,'FHIR_BULK_JSON_LIMIT','Use complete-file receiving for binary files.');
    const bytes=await readSourceFile(item.path,{privateFile:true,maxBytes:item.bytes});
    need(bytes.length===item.bytes && digest(bytes)===item.sha256,'FHIR_BULK_RETAINED_CHANGED');return {bytes,item};
  }
  async #json(alias,args){
    const saved=await this.#manifest(alias,args.exportId,args.expectedManifestSha256),{bytes}=await this.#body(saved,args.file);
    need(bytes.length<=MAX_RESPONSE_BYTES,'FHIR_BULK_JSON_LIMIT');
    const original=jsonPointer(decode(bytes),args.pointer??''),offset=args.offset??0,limit=args.limit??50;
    let value,total,type;
    if(Array.isArray(original)){total=original.length;value=original.slice(offset,offset+limit);type='array';}
    else if(plain(original)){const entries=Object.entries(original);total=entries.length;value=entries.slice(offset,offset+limit);type='object-entries';}
    else if(typeof original==='string'){total=original.length;value=original.slice(offset,offset+limit);type='string';}
    else{need(offset===0,'FHIR_BULK_POINTER_RANGE');total=1;value=original;type=original===null?'null':typeof original;}
    need(offset<=total,'FHIR_BULK_POINTER_RANGE');
    const result={workspace:alias,exportId:args.exportId,manifestSha256:saved.sha256,file:args.file,
      pointer:args.pointer??'',type,offset,total,value,nextOffset:offset+limit<total?offset+limit:null};
    if(Buffer.byteLength(JSON.stringify(result))>65536)return {...result,value:undefined,
      valueAvailableInOriginalFile:true,message:'Download the complete original file to read this selected value.'};
    return result;
  }
  async #do(action,args){
    if(action==='workspaces')return this.summary;
    if(action==='schema')return {schema:'stellar-forge.fhir-bulk-merchant-api.v1',tools:fhirMerchantTools,
      nativeWorkspace:'stellar-forge.fhir-bulk-workspace.v1',nativeSource:'stellar-forge.fhir-bulk-source.v1',
      nativeMapping:'stellar-forge.fhir-bulk-mapping.v1',maximumPacketBytes:MAX_PACKET_BYTES,
      recovery:'Read the same saved operation ID after an uncertain acquisition reply. Advance and adopt_status use the original native state machine.',
      files:'Every completed response has full original-response and original-request files. File ranges and resumable receiving use the maintained merchant file protocol.'};
    const alias=args.workspace;
    if(action==='manifest'){
      const saved=await this.#manifest(alias,args.exportId);
      return {state:'MANIFEST_RETAINED',workspace:alias,exportId:args.exportId,
        manifestFile:{name:MANIFEST_NAME,bytes:saved.bytes.length,sha256:saved.sha256},manifest:saved.manifest};
    }
    if(action==='file_release'){
      this.#binding(alias);await this.#readers.release(alias+':'+args.exportId,args.readId);
      return {state:'RELEASED',workspace:alias,exportId:args.exportId,readId:args.readId};
    }
    if(action==='file'){
      const saved=await this.#manifest(alias,args.exportId,args.expectedManifestSha256),isManifest=args.file===MANIFEST_NAME;
      const file=isManifest?{name:MANIFEST_NAME,bytes:saved.bytes.length,sha256:saved.sha256,contentType:'application/json'}:
        await this.#selectedFile(saved,args.file);
      need(file.sha256===args.expectedSha256,'FHIR_BULK_FILE_CHANGED');
      const result=await this.#readers.read({scope:alias+':'+args.exportId,key:args.file,kind:'fhir-bulk',
        directory:saved.root,expectedSha256:file.sha256,offset:args.offset??0,limit:args.limit??65536,readId:args.readId,
        load:async()=>{
          if(isManifest)return {name:file.name,type:file.contentType,bytes:saved.bytes};
          const {handle,info}=await regular(file.path,{privateFile:true,maxBytes:file.bytes});
          try{
            need(Number(info.size)===file.bytes,'FHIR_BULK_FILE_CHANGED');
            return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.contentType};
          }catch(error){await handle.close();throw error;}
        }});
      return {workspace:alias,exportId:args.exportId,manifestSha256:saved.sha256,...result};
    }
    if(action==='json')return this.#json(alias,args);
    const client=this.#client(alias);
    if(action==='operator_open')return {workspace:alias,...await client.open()};
    if(action==='operator_release')return {workspace:alias,...await client.release()};
    if(['source_import','packet_import','workspace_import','receive_export'].includes(action)){
      const root=await this.#root(alias),spool=await directory(join(root,'pending'));
      let upload,kind,sourceIdentity;
      if(action==='receive_export'){
        const saved=await this.#manifest(args.sourceWorkspace,args.exportId,args.expectedManifestSha256);
        const allowed={source:'source-packet',packet:'dataset-packet',workspace:'workspace-packet'};
        need(saved.manifest.kind===allowed[args.kind],'FHIR_BULK_RECEIVING_KIND_CHANGED');
        const original=saved.manifest.files.find(file=>file.name.endsWith('.zip'));
        need(original,'FHIR_BULK_RECEIVING_FILE_NOT_FOUND');
        const file=await this.#selectedFile(saved,original.name);
        upload={...await inputSnapshot({file:file.path,bytes:file.bytes,sha256:file.sha256},spool),name:file.name,label:args.label??file.name};
        kind=args.kind;sourceIdentity={workspace:args.sourceWorkspace,exportId:args.exportId,
          manifestSha256:saved.sha256,sha256:original.sha256};
      }else{
        upload=await client.hostInput(args.input,spool,args.expectedSha256);
        kind={source_import:'source',packet_import:'packet',workspace_import:'workspace'}[action];
        sourceIdentity={input:args.input,sha256:upload.sha256};
      }
      const target=kind==='workspace'?path('workspace','packet'):kind==='packet'?path('packets'):path('sources');
      try{
        const original=await client.request('POST',target,{upload,adoptWorkspace:kind==='workspace',
          headers:kind==='source'?{'x-source-name':encodeURIComponent(upload.name),
            'x-source-label':encodeURIComponent(args.label??upload.label)}:{}});
        return await this.#capture(alias,original,{...args,received:sourceIdentity},{action,method:'POST',target});
      }finally{await unlink(upload.path).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
    const route=nativeRoute(action,args);need(route,'FHIR_BULK_TOOL_UNKNOWN');
    const root=route.filename?await this.#root(alias):null;
    let expected;
    if(action==='source_file'){
      const members=await client.request('GET',path('sources',args.sourceId,'members'));
      if(!members.ok)return this.#capture(alias,members,args,{action,method:'GET',target:path('sources',args.sourceId,'members')});
      need(Array.isArray(members.value),'FHIR_BULK_MEMBERS_INVALID');
      expected=members.value.find(item=>item.name===args.member);
      need(expected,'FHIR_BULK_FILE_NOT_FOUND');
    }
    const original=await client.request(route.method,route.target,{input:route.input,
      ...(root?{outputDirectory:await directory(join(root,'pending'))}:{}),operationId:args.operationId});
    if(expected && original.ok){
      const bytes=original.file?.bytes??original.bytes.length,sha256=original.file?.sha256??digest(original.bytes);
      if(bytes!==expected.bytes || expected.sha256 && sha256!==expected.sha256){
        if(original.file)await unlink(original.file.path).catch(()=>{});
        need(false,'FHIR_BULK_SOURCE_FILE_CHANGED');
      }
    }
    return this.#capture(alias,original,args,{...route,action});
  }
  call(name,args={}){
    need(!this.#closing,'FHIR_BULK_CLOSING');
    const action=validateFhirArguments(name,args),independent=['workspaces','schema','manifest','file','file_release','json'].includes(action);
    const previous=independent?Promise.resolve():(this.#queues.get(args.workspace)??Promise.resolve());
    const promise=previous.catch(()=>{}).then(()=>this.#do(action,args));this.#pending.add(promise);
    if(!independent)this.#queues.set(args.workspace,promise);
    promise.finally(()=>{this.#pending.delete(promise);if(this.#queues.get(args.workspace)===promise)this.#queues.delete(args.workspace);}).catch(()=>{});
    return promise;
  }
  close(){
    if(this.#close)return this.#close;this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([this.#readers.close(),...[...this.#clients.values()].map(client=>client.close())]),
        failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
      if(failures.length)throw failures.length===1?failures[0]:Object.assign(new AggregateError(failures,
        'Original FHIR connection cleanup is incomplete.'),{code:'FHIR_BULK_CLOSE_INCOMPLETE'});
    })().catch(error=>{this.#close=null;throw error;});return this.#close;
  }
}
