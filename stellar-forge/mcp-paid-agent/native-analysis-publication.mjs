// SPDX-License-Identifier: MIT
// Existing Analysis Dataset jobs and exact retained native file indexes.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {isDeepStrictEqual as same} from 'node:util';
import {initializationDirectory as directory,optionalInitializationBytes as optionalBytes,
  retainInitializationFile as retainFile}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';

const SCHEMA='stellar-forge.analysis-dataset-publications.v1';
const PACKAGE_INDEX='stellar-forge.analysis-dataset-publication-downloads.v1';
const SOURCE_INDEX='stellar-forge.analysis-publication-source-files.v1';
const CACHE='stellar-forge.analysis-dataset-file-cache.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const ACTION=/^[a-z][a-z0-9-]{0,79}$/;
const MiB=1024*1024,MAX_JSON=64*MiB,MAX_INDEX=20*MiB,MAX_SOURCE_INDEX=8*MiB;
const MAX_FILE=128*MiB,MAX_SOURCE_FILES=512*MiB,MAX_CACHE=MAX_JSON+MiB;
const PAGE_BYTES=192*1024;
const PACKAGE_FILES=['datapackage.json','data.json','publication.zip','recipe.json','manifest.json','report.html'];
const SOURCE_FILES=new Set(['manifest.json','source.tar.gz','source-edition.json','capture-inspection.json','RECEIVING.md']);
const PACKAGE_KEYS=['schema','workspace_id','job_id','recipe_id','recipe_sha256','source','files'];
const SOURCE_KEYS=['schema','workspace_id','job_id','package_id','package_index_sha256',
  'native_workspace_id','export_id','source_hash','manifest_sha256','native_manifest_sha256','files'];
const operations=new Set(['dataset-configuration','dataset-exports','dataset-recipes','dataset-jobs',
  'dataset-source-jobs','dataset-review','dataset-save-recipe','dataset-recipe','dataset-prepare',
  'dataset-job','dataset-cancel','dataset-source','dataset-source-read','dataset-package',
  'dataset-downloads','dataset-file']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const code=suffix=>'MCP_ANALYSIS_PUBLICATION_'+suffix;
const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>structuredClone(value);
const bytes=value=>Buffer.from(JSON.stringify(value),'utf8');
const size=value=>bytes(value).length;
function cacheJson(value){
  if(Array.isArray(value))return '['+value.map(cacheJson).join(',')+']';
  if(object(value))return '{'+Object.keys(value).map(k=>JSON.stringify(k)+':'+cacheJson(value[k])).join(',')+'}';
  // Keep a parsed negative zero when retaining the enriched index. The original
  // raw index bytes remain the content-address authority for all numeric tokens.
  if(typeof value==='number'&&Object.is(value,-0))return '-0';
  return JSON.stringify(value);
}
const cacheBytes=value=>Buffer.from(cacheJson(value),'utf8');
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value??{},k)).map(k=>[k,copy(value[k])]));
function check(value,pattern,suffix){
  need(typeof value==='string'&&pattern.test(value),code(suffix));return value;
}
function integer(value,min=0,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,code('INTEGER_INVALID'));return value;
}
function count(value){
  need((Number.isSafeInteger(value)&&value>=0)||
    (object(value)&&value.encoding==='json-integer'&&typeof value.text==='string'&&/^[0-9]+$/.test(value.text)),
    code('COUNT_INVALID'));return value;
}
function fields(value,required,optional=[]){
  need(object(value)&&required.every(k=>Object.hasOwn(value,k))&&
    Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),code('FIELDS_INVALID'));
}
function text(value,maximum,{empty=false}={}){
  need(typeof value==='string'&&Array.from(value).length<=maximum&&(empty||value.length>0)&&
    !/[\x00-\x1f\x7f]/.test(value),code('TEXT_INVALID'));return value;
}
function stopped(signal){
  if(signal?.aborted)throw Object.assign(new Error(code('CALL_INTERRUPTED')),{code:code('CALL_INTERRUPTED')});
}
function endpoint(value){
  text(value,4096);let url;try{url=new URL(value);}catch{need(false,code('ENDPOINT_INVALID'));}
  need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash,
    code('ENDPOINT_INVALID'));return value;
}
function query(value){
  const items=Object.entries(value).filter(([,v])=>v!==undefined);
  return items.length?'?'+new URLSearchParams(items.map(([k,v])=>[k,String(v)])):'';
}
function relative(value){
  text(value,1024);
  need(!value.startsWith('/')&&!value.includes('\\')&&value.split('/').every(v=>v!==''&&v!=='.'&&v!=='..'),
    code('FILE_RELATIVE_INVALID'));return value;
}
function sourceFilename(value){
  if(SOURCE_FILES.has(value))return true;
  if(typeof value!=='string'||!value.startsWith('reviews/')||!value.endsWith('.json'))return false;
  return UUID.test(value.slice(8,-5));
}
function mode(body){
  if(body.source!==undefined)need(typeof body.source==='boolean',code('SOURCE_SELECTION_INVALID'));
  return body.source??false;
}
function route(id,source){
  return '/api/publication/'+(source?'source-jobs/':'jobs/')+id;
}
function originalKeys(source){return source?SOURCE_KEYS:PACKAGE_KEYS;}
function rawFilename(source){return source?'files-index.json':'downloads.json';}
function rawLimit(source){return source?MAX_SOURCE_INDEX:MAX_INDEX;}

/** Large native arrays remain available in their original service/files.
 * Projections explicitly name their count, omitted fields and full source route. */
function short(value,maximum=384){
  if(typeof value!=='string')return copy(value);
  if(value.length<=maximum)return value;
  let characters=0,preview='';
  for(const point of value){if(characters<maximum)preview+=point;characters++;}
  return characters<=maximum?value:{preview,characters,complete:false};
}
const PRIORITY=['schema','id','kind','mode','ok','state','status','outcome','unknown','uncertain','error',
  'cancel_requested','job_id','jobId','workspace_id','workspaceId','native_workspace_id','native_request_id',
  'request_id','requestId','operation_id','operationId','run_id','runId','plan_id','planId',
  'package_id','packageId','index_sha256','indexSha256','sha256','source_hash','sourceHash',
  'request','original_request','result','native','operation','run','progress','target','connection','source','data'];
function metadata(value,depth=0,budget={left:512}){
  if(budget.left--<=0)return {projection:'omitted-metadata',complete:false,
    type:Array.isArray(value)?'array':value===null?'null':typeof value,
    ...(Array.isArray(value)?{count:value.length}:object(value)?{field_count:Object.keys(value).length}:{})};
  if(!object(value)&&!Array.isArray(value))return short(value);
  if(object(value)&&value.encoding==='json-integer'&&typeof value.text==='string')return copy(value);
  if(Array.isArray(value)){
    const keep=depth<4?Math.min(value.length,3):0;
    return {projection:'array-metadata',count:value.length,items:value.slice(0,keep).map(v=>metadata(v,depth+1,budget)),
      returned:keep,complete:false,all_items_represented:keep===value.length};
  }
  const keys=Object.keys(value);
  const ordered=[...PRIORITY.filter(k=>Object.hasOwn(value,k)),...keys.filter(k=>!PRIORITY.includes(k))];
  const selected=depth<5?ordered.slice(0,32):ordered.filter(k=>!object(value[k])&&!Array.isArray(value[k])).slice(0,32);
  const result=Object.fromEntries(selected.map(k=>[k,metadata(value[k],depth+1,budget)]));
  const omitted=keys.filter(k=>!selected.includes(k));
  return {values:result,projection:'object-metadata',field_count:keys.length,
    omitted_fields:omitted.slice(0,64),omitted_field_count:omitted.length,
    omitted_fields_complete:omitted.length<=64,complete:false};
}
function nativeStates(value){
  const entries=[],seen=new Set();
  const visit=(item,path,depth)=>{
    if(!object(item)||depth>8||seen.has(item))return;seen.add(item);
    const selected=pick(item,['id','kind','mode','ok','state','status','outcome','unknown','uncertain',
      'cancel_requested','job_id','jobId','native_request_id','operation_id','operationId','run_id','runId']);
    if(Object.keys(selected).length)entries.push({path,value:selected});
    for(const key of ['result','native','operation','run','progress','data','error','receipt','accepted'])
      if(object(item[key]))visit(item[key],path+'/'+key,depth+1);
  };
  visit(value,'',0);
  return entries;
}
function bounded(value,full,kind='native-result'){
  if(size(value)<=PAGE_BYTES)return value;
  let projected=metadata(value);
  let result={projection:{kind,complete:false,original_bytes:size(value),full_result:full},
    identities:pick(value,['schema','id','kind','status','state','workspace_id','job_id','recipe_id','recipe_sha256',
      'package_id','index_sha256','native_request_id','created_at','finished_at','sequence','name','revision']),
    native_states:nativeStates(value),metadata:projected};
  if(size(result)>PAGE_BYTES){
    result.metadata={projection:'top-level-field-metadata',complete:false,
      fields:Object.entries(value).map(([name,v])=>({name,type:Array.isArray(v)?'array':v===null?'null':typeof v,
        ...(Array.isArray(v)?{count:v.length}:{}),...(object(v)?{field_count:Object.keys(v).length}:{})}))};
  }
  need(size(result)<=PAGE_BYTES,code('RESULT_METADATA_TOO_LARGE_USE_ORIGINAL_SERVICE'));
  return result;
}
function sourceBinding(source,record){
  need(object(source)&&source.workspace_id===record.workspaceId,code('SOURCE_WORKSPACE_CHANGED'));
  check(source.query_export_id,ID,'QUERY_EXPORT_REQUIRED');
  check(source.manifest_sha256,HASH,'SOURCE_DIGEST_REQUIRED');
  check(source.binding_sha256,HASH,'SOURCE_BINDING_REQUIRED');count(source.row_count);
  need(Array.isArray(source.columns),code('SOURCE_COLUMNS_REQUIRED'));
  return {...pick(source,['workspace_id','query_export_id','manifest_sha256','binding_sha256','row_count','created_at']),
    column_count:source.columns.length};
}
function historyRow(item,collection,record){
  need(object(item),code('HISTORY_INVALID'));integer(item.sequence,1);
  if(item.id!==undefined)check(item.id,ID,'JOB_ID_REQUIRED');
  if(item.workspace_id!==undefined)need(item.workspace_id===record.workspaceId,code('WORKSPACE_CHANGED'));
  const fixed=pick(item,['sequence','id','kind','status','name','revision','created_at','finished_at',
    'recipe_id','recipe_sha256','manifest_sha256','binding_sha256','row_count','rows','bytes']);
  const result={...fixed,projection:{kind:collection+'-metadata',complete:false,
    original_fields:Object.keys(item),full_result:collection==='recipes'&&item.id?
      {operation:'dataset-recipe',arguments:{recipe_id:item.id}}:
      item.id?{operation:'dataset-job',arguments:{id:item.id},http_path:'/api/jobs/'+item.id}:
        {http_path:'/api/publication/'+collection}}};
  if(Object.hasOwn(item,'head'))result.head=copy(item.head);
  for(const key of ['label','error'])if(Object.hasOwn(item,key))result[key]=metadata(item[key]);
  for(const key of ['request','result','source','recipe','progress'])if(Object.hasOwn(item,key)){
    result[key+'_metadata']=metadata(item[key]);result[key+'_native_states']=nativeStates(item[key]);
  }
  return {sequence:item.sequence,...bounded(result,result.projection.full_result,'history-row-metadata')};
}
function history(value,body,collection,record){
  need(object(value)&&Array.isArray(value.items),code('HISTORY_INVALID'));
  const limit=body.limit??25;integer(limit,1,100);
  if(value.next_before!==null&&value.next_before!==undefined)integer(value.next_before,1);
  const items=[];let consumed=0;
  for(const item of value.items.slice(0,limit)){
    const selected=historyRow(item,collection,record);
    if(size({items:[...items,selected]})+2048>PAGE_BYTES)break;
    items.push(selected);consumed++;
  }
  need(items.length>0||value.items.length===0,code('HISTORY_ITEM_TOO_LARGE_USE_ORIGINAL_SERVICE'));
  const shortened=consumed<value.items.length;
  return {items,next_before:shortened?value.items[consumed-1].sequence:value.next_before??null,
    projection:{kind:collection+'-metadata',complete:false,returned:items.length,
      native_page_count:value.items.length,full_result:{http_path:'/api/publication/'+collection+query(body)}}};
}
function checkedIndex(value,record,expected){
  need(object(value),code('INDEX_INVALID'));
  const source=expected.source;
  need(value.schema===(source?SOURCE_INDEX:PACKAGE_INDEX)&&value.workspace_id===record.workspaceId&&
    value.job_id===expected.id&&originalKeys(source).every(k=>Object.hasOwn(value,k)),code('INDEX_BINDING_CHANGED'));
  check(value.index_sha256,HASH,'INDEX_DIGEST_REQUIRED');
  if(expected.index_sha256!==undefined)need(value.index_sha256===expected.index_sha256,code('INDEX_CHANGED'));
  need(Array.isArray(value.files),code('FILE_INDEX_INVALID'));
  if(source){
    need(value.files.length>=1&&value.files.length<=10000,code('FILE_INDEX_INVALID'));
    const hasPackage=value.package_id!==null;
    need(hasPackage===(value.package_index_sha256!==null),code('PACKAGE_BINDING_CHANGED'));
    if(hasPackage){check(value.package_id,ID,'PACKAGE_ID_REQUIRED');check(value.package_index_sha256,HASH,'PACKAGE_DIGEST_REQUIRED');}
    check(value.native_workspace_id,UUID,'NATIVE_WORKSPACE_REQUIRED');check(value.export_id,UUID,'EXPORT_ID_REQUIRED');
    for(const key of ['source_hash','manifest_sha256','native_manifest_sha256'])check(value[key],HASH,'SOURCE_DIGEST_REQUIRED');
  }else{
    check(value.recipe_id,ID,'RECIPE_ID_REQUIRED');check(value.recipe_sha256,HASH,'RECIPE_DIGEST_REQUIRED');
    sourceBinding(value.source,record);
    need(value.files.length===PACKAGE_FILES.length,code('FILE_INDEX_INVALID'));
  }
  let total=0,last='';const names=new Set();
  for(const [ordinal,item]of value.files.entries()){
    need(object(item),code('FILE_INDEX_INVALID'));
    fields(item,['name','relative','bytes','sha256','mime'],source?[]:['visibility']);
    relative(item.relative);integer(item.bytes);check(item.sha256,HASH,'FILE_DIGEST_REQUIRED');text(item.mime,160);
    need(!names.has(item.name),code('DUPLICATE_FILE'));names.add(item.name);
    if(source){
      need(sourceFilename(item.name)&&item.relative==='files/'+item.name&&item.name>last,code('SOURCE_FILE_INVALID'));
      last=item.name;
    }else{
      need(item.name===PACKAGE_FILES[ordinal]&&item.visibility===(ordinal<3?'public':'private'),code('PACKAGE_FILE_INVALID'));
    }
    total+=item.bytes;integer(total);
  }
  if(source){
    need(total<=MAX_SOURCE_FILES,code('SOURCE_FILES_TOO_LARGE'));
    need(names.has('manifest.json')&&names.has('source.tar.gz')&&
      value.files.find(v=>v.name==='manifest.json').sha256===value.native_manifest_sha256,
      code('SOURCE_MANIFEST_CHANGED'));
  }
  return value;
}
function verifyRaw(raw,index,record,expected,parse){
  need(Buffer.isBuffer(raw)&&raw.length<=rawLimit(expected.source)&&sha(raw)===index.index_sha256,code('INDEX_BYTES_CHANGED'));
  const original=parse(raw);fields(original,originalKeys(expected.source));
  checkedIndex({...original,index_sha256:index.index_sha256},record,expected);
  for(const key of originalKeys(expected.source))need(same(original[key],index[key]),code('INDEX_HTTP_BYTES_DIFFER'));
  return original;
}
function indexBinding(index,record,source){
  if(source)return pick(index,['package_id','package_index_sha256','native_workspace_id','export_id',
    'source_hash','manifest_sha256','native_manifest_sha256']);
  return {recipe_id:index.recipe_id,recipe_sha256:index.recipe_sha256,source:sourceBinding(index.source,record)};
}
function sourceRequest(body,{reading=false}={}){
  fields(body,reading?['connection','action','args','reviewed_endpoint','expected_workspace_id']:
    ['id','connection','action','args','reviewed_endpoint','expected_workspace_id'],['package_id','index_sha256']);
  if(!reading)check(body.id,ID,'JOB_ID_REQUIRED');
  check(body.connection,ALIAS,'CONNECTION_ALIAS_REQUIRED');check(body.action,ACTION,'SOURCE_ACTION_REQUIRED');
  need(object(body.args),code('SOURCE_ARGUMENTS_REQUIRED'));endpoint(body.reviewed_endpoint);
  check(body.expected_workspace_id,UUID,'NATIVE_WORKSPACE_REQUIRED');
  need(Object.hasOwn(body,'package_id')===Object.hasOwn(body,'index_sha256'),code('PACKAGE_BINDING_REQUIRED'));
  if(body.package_id!==undefined){check(body.package_id,ID,'PACKAGE_ID_REQUIRED');check(body.index_sha256,HASH,'PACKAGE_DIGEST_REQUIRED');}
  return body;
}
function originalJob(value,id,request,kind){
  need(object(value)&&value.id===id&&['dataset-package','dataset-source'].includes(value.kind)&&
    object(value.request)&&typeof value.status==='string',code('ORIGINAL_JOB_REQUIRED'));
  if(kind!==undefined)need(value.kind===kind,code('JOB_KIND_CHANGED'));
  const original=value.kind==='dataset-source'?value.request.original_request:value.request;
  need(object(original)&&original.id===id,code('ORIGINAL_REQUEST_REQUIRED'));
  if(request!==undefined)need(same(original,request),code('ORIGINAL_REQUEST_CHANGED'));
  return value;
}
function jobView(value,id){
  return bounded(value,{operation:'dataset-job',arguments:{id},http_path:'/api/jobs/'+id},'original-analysis-job');
}

/** The original Analysis parent owns HTTP, cancellation, file-reader lifetime and drain. */
export function createNativePublicationActions({reads,parse}={}){
  need(typeof reads==='function'&&typeof parse==='function',code('ORIGINAL_FILE_HELPERS_REQUIRED'));
  async function cachePath(record,id,indexSha){
    check(record?.workspaceId,ID,'WORKSPACE_ID_REQUIRED');check(id,ID,'JOB_ID_REQUIRED');
    check(indexSha,HASH,'INDEX_DIGEST_REQUIRED');
    need(typeof record.nativeWorkspace==='string'&&resolve(record.nativeWorkspace)===record.nativeWorkspace,
      code('ORIGINAL_WORKSPACE_REQUIRED'));
    let path=record.nativeWorkspace;await directory(path);
    for(const part of ['analysis','dataset-files',record.workspaceId,id,indexSha]){
      path=join(path,part);await directory(path,{create:true});
    }
    return path;
  }
  async function savedIndex(path,record,expected){
    const saved=await optionalBytes(join(path,'index-record.json'),MAX_CACHE);
    if(saved===null)return null;
    const retained=parse(saved);
    fields(retained,['schema','workspaceId','jobId','source','indexSha256','indexViewSha256','index','indexFile']);
    need(retained.schema===CACHE&&retained.workspaceId===record.workspaceId&&retained.jobId===expected.id&&
      retained.source===expected.source&&retained.indexSha256===expected.index_sha256,code('CACHE_BINDING_CHANGED'));
    check(retained.indexViewSha256,HASH,'CACHE_DIGEST_REQUIRED');
    need(sha(cacheBytes(retained.index))===retained.indexViewSha256,code('CACHED_INDEX_CHANGED'));
    const index=checkedIndex(retained.index,record,expected);
    fields(retained.indexFile,['filename','bytes','sha256','contentType']);
    need(retained.indexFile.filename===rawFilename(expected.source)&&
      retained.indexFile.sha256===index.index_sha256&&retained.indexFile.contentType==='application/json',
      code('CACHED_INDEX_FILE_CHANGED'));
    integer(retained.indexFile.bytes,0,rawLimit(expected.source));
    const raw=await optionalBytes(join(path,retained.indexFile.filename),rawLimit(expected.source));
    // The raw file was synced before the completed record. Its absence after that
    // sentinel is corruption, rather than permission to replace a saved index.
    need(raw!==null&&raw.length===retained.indexFile.bytes,code('CACHED_INDEX_FILE_MISSING'));
    verifyRaw(raw,index,record,expected,parse);
    return {path,index,indexFile:copy(retained.indexFile)};
  }
  async function captureIndex(record,expected,{get,getBytes,signal,index:observed}){
    const selected=checkedIndex(observed??await get(route(expected.id,expected.source)+'/downloads',
      {maximum:MAX_INDEX}),record,expected);
    const bound={...expected,index_sha256:selected.index_sha256};
    const path=await cachePath(record,bound.id,bound.index_sha256);
    const retained=await savedIndex(path,record,bound);
    if(retained){
      for(const key of originalKeys(bound.source))need(same(retained.index[key],selected[key]),code('INDEX_CHANGED'));
      return retained;
    }
    stopped(signal);
    const filename=rawFilename(bound.source),existing=await optionalBytes(join(path,filename),rawLimit(bound.source));
    const raw=existing??await getBytes(route(bound.id,bound.source)+'/file'+
      query({name:filename,sha256:selected.index_sha256}),rawLimit(bound.source));
    verifyRaw(raw,selected,record,bound,parse);
    stopped(signal);
    if(existing===null)await retainFile(join(path,filename),raw,{resume:true});
    const indexFile={filename,bytes:raw.length,sha256:selected.index_sha256,contentType:'application/json'};
    const recordBytes=cacheBytes({schema:CACHE,workspaceId:record.workspaceId,jobId:bound.id,source:bound.source,
      indexSha256:selected.index_sha256,indexViewSha256:sha(cacheBytes(selected)),index:selected,indexFile});
    need(recordBytes.length<=MAX_CACHE,code('INDEX_CACHE_TOO_LARGE'));
    try{await retainFile(join(path,'index-record.json'),recordBytes,{resume:true});}
    catch(error){
      if(error.code!=='INITIALIZATION_SOURCE_CHANGED')throw error;
      // Concurrent captures may carry different additional HTTP metadata for the
      // same exact raw index. Preserve the first completed, fully verified view.
      const first=await savedIndex(path,record,bound);
      need(first!==null,code('INDEX_CACHE_INCOMPLETE'));
      for(const key of originalKeys(bound.source))need(same(first.index[key],selected[key]),code('INDEX_CHANGED'));
      return first;
    }
    return {path,index:selected,indexFile};
  }
  async function downloads({body,record,get,getBytes,signal}){
    fields(body,['id'],['source','offset','limit']);check(body.id,ID,'JOB_ID_REQUIRED');
    const source=mode(body),offset=body.offset??0,limit=body.limit??25;
    integer(offset);integer(limit,1,100);stopped(signal);
    const retained=await captureIndex(record,{id:body.id,source},{get,getBytes,signal});
    const {index,indexFile}=retained,total=index.files.length;
    need(offset<=total,code('PAGE_OFFSET_INVALID'));
    const files=index.files.slice(offset,offset+limit);
    return {workspaceId:index.workspace_id,jobId:index.job_id,source,indexSha256:index.index_sha256,indexFile,
      fileCount:total,files:copy(files),
      page:{offset,limit,total,nextOffset:offset+files.length<total?offset+files.length:null},
      binding:indexBinding(index,record,source)};
  }
  async function file({body,record,get,getBytes,signal}){
    fields(body,['id','index_sha256','filename','sha256'],['source','byteOffset','maxBytes']);
    check(body.id,ID,'JOB_ID_REQUIRED');check(body.index_sha256,HASH,'INDEX_DIGEST_REQUIRED');
    check(body.sha256,HASH,'FILE_DIGEST_REQUIRED');
    const source=mode(body);
    need(body.filename===rawFilename(source)||(source?sourceFilename(body.filename):PACKAGE_FILES.includes(body.filename)),
      code('FILENAME_INVALID'));
    if(body.byteOffset!==undefined)integer(body.byteOffset);
    if(body.maxBytes!==undefined)integer(body.maxBytes,1,65536);
    const expected={id:body.id,source,index_sha256:body.index_sha256};
    const path=await cachePath(record,body.id,body.index_sha256);
    let retained=await savedIndex(path,record,expected),fresh=false;
    if(retained===null){
      stopped(signal);retained=await captureIndex(record,expected,{get,getBytes,signal});fresh=true;
    }
    const {index,indexFile}=retained;
    const selected=body.filename===indexFile.filename?
      {name:indexFile.filename,bytes:indexFile.bytes,sha256:indexFile.sha256,mime:indexFile.contentType}:
      index.files.find(item=>item.name===body.filename);
    need(selected&&selected.sha256===body.sha256,code('FILE_SELECTION_CHANGED'));
    need(selected.bytes<=MAX_FILE,code('LARGE_FILE_USE_PYTHON_DATASET_DOWNLOAD'));
    need((body.byteOffset??0)<=selected.bytes,code('FILE_OFFSET_INVALID'));
    let destination;
    if(selected.name===indexFile.filename)destination=join(path,indexFile.filename);
    else{
      await directory(join(path,'files'),{create:true});
      destination=join(path,'files',selected.sha256);
    }
    const descriptor={destination,bytes:selected.bytes,sha256:selected.sha256,contentType:selected.mime};
    const response=value=>({workspaceId:index.workspace_id,jobId:index.job_id,source,
      indexSha256:index.index_sha256,filename:selected.name,file:value});
    const readBody={byteOffset:body.byteOffset??0,maxBytes:body.maxBytes??65536};
    try{return response(await reads(descriptor,readBody));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    need(selected.name!==indexFile.filename,code('CACHED_INDEX_FILE_MISSING'));
    stopped(signal);
    if(!fresh){
      const current=checkedIndex(await get(route(body.id,source)+'/downloads',{maximum:MAX_INDEX}),record,expected);
      for(const key of originalKeys(source))need(same(index[key],current[key]),code('INDEX_CHANGED'));
    }
    const raw=await getBytes(route(body.id,source)+'/file'+query({name:selected.name,sha256:selected.sha256}),selected.bytes);
    need(Buffer.isBuffer(raw)&&raw.length===selected.bytes&&sha(raw)===selected.sha256,code('FILE_BYTES_CHANGED'));
    stopped(signal);
    await retainFile(destination,raw,{resume:true});
    return response(await reads(descriptor,readBody));
  }
  async function continueJob(body,kind,{get,post,signal}){
    let previous=null;
    try{previous=originalJob(await get('/api/jobs/'+body.id,{maximum:MAX_JSON}),body.id,body,kind);}
    catch(error){
      // A failed transport, generic 404, or rejected authorization is not proof
      // that this original Analysis request is absent.
      if(error.code!=='ANALYSIS_JOB_NOT_FOUND')throw error;
    }
    if(previous!==null){
      const original=originalJob(previous,body.id,body,kind);
      if(original.status==='COMPLETE')return jobView(original,body.id);
    }
    stopped(signal);
    const current=originalJob(await post('/api/start/'+kind,copy(body),{maximum:MAX_JSON}),body.id,body,kind);
    // No late signal check can demote the original authoritative success.
    return jobView(current,body.id);
  }
  function recipeView(value,record,id){
    need(object(value)&&value.id===id&&object(value.recipe)&&object(value.source),code('RECIPE_BINDING_CHANGED'));
    check(value.name,NAME,'RECIPE_NAME_REQUIRED');check(value.recipe_sha256,HASH,'RECIPE_DIGEST_REQUIRED');
    integer(value.revision,1);sourceBinding(value.source,record);
    need(value.recipe.workspace_id===record.workspaceId,code('RECIPE_WORKSPACE_CHANGED'));
    return bounded(value,{operation:'dataset-recipe',arguments:{recipe_id:id},
      http_path:'/api/publication/recipes/'+id},'original-recipe');
  }
  return {
    handles:operation=>operations.has(operation),
    async call({operation,body,record,get,post,getBytes,signal}){
      need(operations.has(operation)&&object(body)&&object(record)&&typeof get==='function'&&
        typeof post==='function'&&typeof getBytes==='function',code('ORIGINAL_TRANSPORT_REQUIRED'));
      check(record.workspaceId,ID,'WORKSPACE_ID_REQUIRED');
      if(operation==='dataset-file')return file({body,record,get,getBytes,signal});
      if(operation==='dataset-downloads')return downloads({body,record,get,getBytes,signal});
      if(operation==='dataset-configuration'){
        fields(body,[]);
        const value=await get('/api/publication/configuration',{maximum:MAX_JSON});
        need(object(value)&&value.schema===SCHEMA&&value.workspace_id===record.workspaceId&&
          typeof value.bridge_available==='boolean'&&Array.isArray(value.connections),code('CONFIGURATION_INVALID'));
        for(const item of value.connections){
          need(object(item),code('CONFIGURATION_INVALID'));check(item.name,ALIAS,'CONNECTION_ALIAS_REQUIRED');
          check(item.workspace_id,UUID,'NATIVE_WORKSPACE_REQUIRED');endpoint(item.url);text(item.label,160);
        }
        for(const key of ['source_actions','source_reads','representations','public_files','private_files'])
          need(Array.isArray(value[key]),code('CONFIGURATION_INVALID'));
        integer(value.max_resource_bytes,1);integer(value.max_native_projection_fields,1);
        return bounded(value,{http_path:'/api/publication/configuration'},'configuration-metadata');
      }
      if(['dataset-exports','dataset-recipes','dataset-jobs','dataset-source-jobs'].includes(operation)){
        fields(body,[],['before','limit']);if(body.before!==undefined)integer(body.before,1);
        if(body.limit!==undefined)integer(body.limit,1,100);
        const collection=operation.slice(8);
        const value=await get('/api/publication/'+collection+query(body),{maximum:MAX_JSON});
        return history(value,body,collection,record);
      }
      if(operation==='dataset-review'){
        fields(body,['query_export_id'],['manifest_sha256','sample_rows']);
        check(body.query_export_id,ID,'QUERY_EXPORT_REQUIRED');
        if(body.manifest_sha256!==undefined)check(body.manifest_sha256,HASH,'SOURCE_DIGEST_REQUIRED');
        if(body.sample_rows!==undefined)integer(body.sample_rows,0,100);
        const value=await post('/api/publication/review',copy(body),{maximum:MAX_JSON});
        need(object(value)&&value.schema===SCHEMA&&value.workspace_id===record.workspaceId&&
          value.source?.query_export_id===body.query_export_id,code('REVIEW_BINDING_CHANGED'));
        const binding=sourceBinding(value.source,record);
        if(body.manifest_sha256!==undefined)need(binding.manifest_sha256===body.manifest_sha256,code('SOURCE_CHANGED'));
        need(object(value.preview)&&Array.isArray(value.preview.rows)&&value.preview.encoding==='sqlite-scalars-v1'&&
          value.preview.returned===value.preview.rows.length&&typeof value.preview.complete==='boolean',
          code('PREVIEW_INVALID'));
        count(value.preview.total_rows);
        if(size(value)<=PAGE_BYTES)return value;
        const result={schema:value.schema,workspace_id:value.workspace_id,label:short(value.label),source:binding,
          representations:copy(value.representations),
          preview:{...pick(value.preview,['total_rows','encoding']),rows:[],returned:0,complete:false},
          projection:{kind:'review-preview',complete:false,native_returned:value.preview.returned,
            source_columns_complete:false,column_count:value.source.columns.length,
            full_result:{http_path:'/api/publication/review',method:'POST',arguments:copy(body)},
            full_source:{query_export_id:body.query_export_id,manifest_sha256:binding.manifest_sha256}}};
        for(const row of value.preview.rows){
          if(size({...result,preview:{...result.preview,rows:[...result.preview.rows,row]}})+1024>PAGE_BYTES)break;
          result.preview.rows.push(copy(row));
        }
        result.preview.returned=result.preview.rows.length;
        result.preview.complete=value.preview.complete&&result.preview.returned===value.preview.returned;
        result.projection.rows_complete=result.preview.returned===value.preview.returned;
        result.projection.omitted_preview_rows=value.preview.returned-result.preview.returned;
        return result;
      }
      if(operation==='dataset-save-recipe'){
        fields(body,['id','name','expected_revision','recipe']);check(body.id,ID,'RECIPE_ID_REQUIRED');
        check(body.name,NAME,'RECIPE_NAME_REQUIRED');integer(body.expected_revision);
        need(object(body.recipe),code('RECIPE_REQUIRED'));
        const value=await post('/api/publication/recipes',copy(body),{maximum:MAX_JSON});
        need(value?.id===body.id&&value.name===body.name&&value.revision===body.expected_revision+1,
          code('RECIPE_BINDING_CHANGED'));
        if(Object.hasOwn(value,'request'))need(same(value.request,body),code('ORIGINAL_REQUEST_CHANGED'));
        return recipeView(value,record,body.id);
      }
      if(operation==='dataset-recipe'){
        fields(body,['recipe_id']);check(body.recipe_id,ID,'RECIPE_ID_REQUIRED');
        return recipeView(await get('/api/publication/recipes/'+body.recipe_id,{maximum:MAX_JSON}),record,body.recipe_id);
      }
      if(operation==='dataset-prepare'){
        fields(body,['id','recipe_id','recipe_sha256']);check(body.id,ID,'JOB_ID_REQUIRED');
        check(body.recipe_id,ID,'RECIPE_ID_REQUIRED');check(body.recipe_sha256,HASH,'RECIPE_DIGEST_REQUIRED');
        return continueJob(body,'dataset-package',{get,post,signal});
      }
      if(operation==='dataset-source'){
        sourceRequest(body);return continueJob(body,'dataset-source',{get,post,signal});
      }
      if(operation==='dataset-source-read'){
        sourceRequest(body,{reading:true});
        const value=await post('/api/publication/source-read',copy(body),{maximum:MAX_JSON});
        need(object(value)&&value.mode==='ANALYSIS_PUBLICATION_BRIDGE'&&value.ok===true&&
          value.workspace_id===record.workspaceId&&value.action===body.action&&object(value.result)&&
          value.connection?.name===body.connection&&value.connection?.endpoint===body.reviewed_endpoint&&
          value.connection?.workspace_id===body.expected_workspace_id,code('SOURCE_READ_BINDING_CHANGED'));
        check(value.id,ID,'JOB_ID_REQUIRED');check(value.native_request_id,UUID,'NATIVE_REQUEST_REQUIRED');
        need((value.package_id??null)===(body.package_id??null)&&
          (value.index_sha256??null)===(body.index_sha256??null),code('PACKAGE_BINDING_CHANGED'));
        return bounded(value,{operation:'dataset-source-read',arguments:copy(body),
          http_path:'/api/publication/source-read',method:'POST'},'native-source-read');
      }
      if(operation==='dataset-job'){
        fields(body,['id']);check(body.id,ID,'JOB_ID_REQUIRED');
        return jobView(originalJob(await get('/api/jobs/'+body.id,{maximum:MAX_JSON}),body.id),body.id);
      }
      if(operation==='dataset-cancel'){
        fields(body,['id']);check(body.id,ID,'JOB_ID_REQUIRED');
        const job=originalJob(await get('/api/jobs/'+body.id,{maximum:MAX_JSON}),body.id);
        const progress=await post(route(body.id,job.kind==='dataset-source')+'/cancel',{},{maximum:MAX_JSON});
        need(object(progress)&&progress.job_id===body.id&&typeof progress.cancel_requested==='boolean'&&
          Array.isArray(progress.observations),code('JOB_PROGRESS_CHANGED'));
        if(progress.state!==undefined)need(typeof progress.state==='string',code('JOB_PROGRESS_CHANGED'));
        return bounded(progress,{operation:'dataset-job',arguments:{id:body.id},
          http_path:'/api/jobs/'+body.id},'native-cancellation-progress');
      }
      fields(body,['id']);check(body.id,ID,'JOB_ID_REQUIRED');
      const value=await get('/api/publication/jobs/'+body.id+'/package',{maximum:MAX_JSON});
      need(object(value)&&object(value.index),code('PACKAGE_VIEW_INVALID'));
      checkedIndex(value.index,record,{id:body.id,source:false});
      return bounded(value,{operation:'dataset-package',arguments:{id:body.id},
        http_path:'/api/publication/jobs/'+body.id+'/package',
        files:['downloads.json','recipe.json','manifest.json','report.html']},'native-package-view');
    }
  };
}
