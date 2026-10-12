// SPDX-License-Identifier: MIT
// Original Analysis plans, publication jobs and exact retained handover files.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {initializationDirectory as directory, optionalInitializationBytes as optionalBytes,
  retainInitializationRecord as retainRecord, retainInitializationFile as retainFile}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';

const SCHEMA='stellar-forge.analysis-lineage.v1';
const INDEX='stellar-forge.analysis-lineage-downloads.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_JSON=64*1024*1024,MAX_FILE=128*1024*1024,MAX_INDEX=65536;
const PAGE_BYTES=192*1024;
const FILES=['events.json','handover.zip','manifest.json','native-bindings.json',
  'plan.json','receipts.json','report.html'];
const operations=new Set(['lineage-configuration','lineage-jobs','lineage-review',
  'lineage-save-plan','lineage-plans','lineage-plan','lineage-publish',
  'lineage-publication','lineage-cancel','lineage-downloads','lineage-file']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const code=suffix=>'MCP_ANALYSIS_LINEAGE_'+suffix;
const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>structuredClone(value);
const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
function check(value,pattern,suffix){
  need(typeof value==='string'&&pattern.test(value),code(suffix));return value;
}
function integer(value,min=0,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,code('INTEGER_INVALID'));return value;
}
function fields(value,required,optional=[]){
  need(object(value)&&required.every(k=>Object.hasOwn(value,k))&&
    Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),code('FIELDS_INVALID'));
}
function text(value,max,{empty=false,multiline=false}={}){
  need(typeof value==='string'&&Array.from(value).length<=max&&(empty||value.trim().length>0)&&
    !((multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value)),code('TEXT_INVALID'));
  return value;
}
function stopped(signal){if(signal?.aborted)throw Object.assign(new Error(code('CALL_INTERRUPTED')),{code:code('CALL_INTERRUPTED')});}
function origin(value){
  text(value,2048);let url;try{url=new URL(value);}catch{need(false,code('ORIGIN_INVALID'));}
  need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&
    url.pathname==='/'&&!url.search&&!url.hash,code('ORIGIN_INVALID'));return value;
}
function query(value){
  const entries=Object.entries(value).filter(([,v])=>v!==undefined);
  return entries.length?'?'+new URLSearchParams(entries.map(([k,v])=>[k,String(v)])):'';
}
function pageOptions(body){
  const collection=body.collection??'summary',offset=body.offset??0,limit=body.limit??25;
  need(['summary','jobs','datasets','events'].includes(collection),code('COLLECTION_INVALID'));
  integer(offset);integer(limit,1,100);
  need(collection!=='summary'||offset===0,code('SUMMARY_OFFSET_INVALID'));
  return {collection,offset,limit};
}
function pick(value,keys){
  return Object.fromEntries(keys.filter(k=>Object.hasOwn(value??{},k)).map(k=>[k,copy(value[k])]));
}
function preview(value,maximum=256){
  if(typeof value!=='string')return value;
  const points=Array.from(value);
  return points.length<=maximum?value:{preview:points.slice(0,maximum).join(''),
    characters:points.length,complete:false};
}
function detailMetadata(value){
  if(!object(value))return {};
  const result={},omitted=[];
  for(const [key,item]of Object.entries(value)){
    if(key==='sql'||object(item)||Array.isArray(item)){omitted.push(key);continue;}
    result[key]=preview(item);
  }
  return {...result,...(omitted.length?{omitted_fields:omitted,complete:false}:{})};
}
function datasetMetadata(value){
  need(object(value),code('DATASET_INVALID'));
  const facets=object(value.facets)?value.facets:{};
  return {namespace:preview(value.namespace),name:preview(value.name),
    facet_names:Object.keys(facets),analysis:detailMetadata(facets.stellarForge_analysis),
    ...(Array.isArray(facets.schema?.fields)?{schema_field_count:facets.schema.fields.length}:{})};
}
function jobMetadata(value){
  need(object(value),code('JOB_METADATA_INVALID'));
  return {...pick(value,['id','kind','run_id','created_at','finished_at']),
    input_count:Array.isArray(value.inputs)?value.inputs.length:0,
    output_count:Array.isArray(value.outputs)?value.outputs.length:0,
    reviewed_parent_count:Array.isArray(value.reviewed_parent_job_ids)?value.reviewed_parent_job_ids.length:0,
    reviewed_parent_job_ids:(value.reviewed_parent_job_ids??[]).slice(0,10),
    reviewed_parents_complete:(value.reviewed_parent_job_ids??[]).length<=10,
    detail:detailMetadata(value.detail)};
}
function eventMetadata(value){
  need(object(value)&&object(value.run)&&object(value.job),code('EVENT_INVALID'));
  const facets=object(value.run.facets)?value.run.facets:{};
  return {...pick(value,['eventType','eventTime']),runId:value.run.runId,
    job:{namespace:preview(value.job.namespace),name:preview(value.job.name)},
    input_count:Array.isArray(value.inputs)?value.inputs.length:0,
    output_count:Array.isArray(value.outputs)?value.outputs.length:0,
    run_facet_names:Object.keys(facets),job_facet_names:Object.keys(value.job.facets??{}),
    source_job_id:facets.stellarForge_analysis?.native_job_id??null,
    retrospective:facets.stellarForge_analysis?.retrospective??null};
}
function summary(value){
  need(object(value),code('SUMMARY_INVALID'));
  const result=pick(value,['workspace_id','root_job_id','job_count','dataset_count','event_count','events_bytes','include_sql']);
  const warnings=value.warnings??[];need(Array.isArray(warnings),code('SUMMARY_INVALID'));
  result.warnings=warnings.slice(0,20).map(v=>preview(v,512));
  result.warning_count=warnings.length;result.warnings_complete=warnings.length<=20;
  return result;
}
function boundSummary(value,record){
  need(object(value)&&value.workspace_id===record.workspaceId,code('WORKSPACE_CHANGED'));
  check(value.root_job_id,ID,'JOB_ID_REQUIRED');
  for(const key of ['job_count','dataset_count','event_count','events_bytes'])integer(value[key]);
  return summary(value);
}
function planMetadata(value,record,{listing=false}={}){
  need(object(value)&&value.schema===SCHEMA&&value.workspace_id===record.workspaceId,code('PLAN_BINDING_CHANGED'));
  check(value.id,ID,'PLAN_ID_REQUIRED');check(value.plan_sha256,HASH,'PLAN_DIGEST_REQUIRED');
  check(value.snapshot_sha256,HASH,'SNAPSHOT_DIGEST_REQUIRED');check(value.events_sha256,HASH,'EVENT_DIGEST_REQUIRED');
  integer(value.events_bytes,1,16*1024*1024);integer(value.sequence,1);
  need(object(value.request)&&value.request.id===value.id&&object(value.target),code('PLAN_BINDING_CHANGED'));
  check(value.target.workspace_id,UUID,'COLLECTOR_ID_REQUIRED');origin(value.target.reviewed_endpoint);
  need(value.operation_id==='analysis-'+record.workspaceId+'-'+value.id&&
    value.source_name==='analysis-lineage-'+value.id+'.json'&&
    value.source_url==='urn:stellar-forge:analysis:'+record.workspaceId+':lineage:'+value.id,code('PLAN_BINDING_CHANGED'));
  const result=pick(value,['schema','projection_schema','id','workspace_id','created_at','snapshot_sha256',
    'events_sha256','events_bytes','operation_id','source_name','source_url','target','plan_sha256','sequence','publication']);
  result.summary=boundSummary(value.summary,record);
  if(listing)result.request_summary=pick(value.request,['id','job_id','connection','expected_workspace_id','title','include_sql']);
  else result.request=copy(value.request);
  return result;
}
function projected(value,body,record,{plan=false}={}){
  const {collection,offset,limit}=pageOptions(body);
  const result=plan?planMetadata(value,record):{
    snapshot_sha256:check(value?.snapshot_sha256,HASH,'SNAPSHOT_DIGEST_REQUIRED'),
    events_sha256:check(value?.events_sha256,HASH,'EVENT_DIGEST_REQUIRED'),
    events_bytes:integer(value?.events_bytes,1,16*1024*1024),
    summary:boundSummary(value?.summary,record)};
  const counts={};
  for(const key of ['jobs','datasets','events']){
    need(Array.isArray(value[key]),code('COLLECTION_INVALID'));counts[key]=value[key].length;
  }
  result.collections=counts;
  result.projection={kind:'metadata',collection,full_files:['events.json','native-bindings.json','plan.json']};
  if(collection==='summary')return result;
  const all=value[collection];need(offset<=all.length,code('PAGE_OFFSET_INVALID'));
  const transform=collection==='jobs'?jobMetadata:collection==='datasets'?datasetMetadata:eventMetadata;
  const items=[];let bytes=size(result)+1024;
  for(const item of all.slice(offset,offset+limit)){
    const kept=transform(item),length=size(kept)+1;
    if(bytes+length>PAGE_BYTES)break;
    items.push(kept);bytes+=length;
  }
  need(items.length>0||offset===all.length,code('ITEM_TOO_LARGE_USE_ORIGINAL_FILE'));
  result[collection]=items;
  result.projection={...result.projection,offset,limit,returned:items.length,total:all.length,
    next_offset:offset+items.length<all.length?offset+items.length:null};
  return result;
}
function history(value,body,transform){
  need(object(value)&&Array.isArray(value.items),code('HISTORY_INVALID'));
  const limit=body.limit??25;integer(limit,1,100);
  if(value.next_before!==null&&value.next_before!==undefined)integer(value.next_before,1);
  const items=[];let bytes=1024;
  for(const item of value.items.slice(0,limit)){
    const kept=transform(item);integer(kept.sequence,1);
    const length=size(kept)+1;if(bytes+length>PAGE_BYTES)break;
    items.push(kept);bytes+=length;
  }
  need(items.length>0||value.items.length===0,code('ITEM_TOO_LARGE_USE_ORIGINAL_FILE'));
  return {items,next_before:items.length<value.items.length?items.at(-1).sequence:value.next_before??null};
}
// The authoritative index contains only fixed ASCII field names and safe integers.
// This equals the original Python sorted-key UTF-8 JSON encoding, with no whitespace.
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function checkedIndex(value,record,expected){
  fields(value,['schema','workspace_id','plan_id','plan_sha256','events_sha256','manifest_sha256','files','index_sha256']);
  need(value.schema===INDEX&&value.workspace_id===record.workspaceId&&value.plan_id===expected.plan_id,code('INDEX_BINDING_CHANGED'));
  for(const key of ['plan_sha256','events_sha256','manifest_sha256','index_sha256'])check(value[key],HASH,'INDEX_DIGEST_REQUIRED');
  if(expected.plan_sha256!==undefined)need(value.plan_sha256===expected.plan_sha256,code('PLAN_DIGEST_CHANGED'));
  if(expected.index_sha256!==undefined)need(value.index_sha256===expected.index_sha256,code('INDEX_CHANGED'));
  need(Array.isArray(value.files)&&value.files.length===FILES.length,code('FILE_INDEX_INVALID'));
  const names=new Set();
  for(const item of value.files){
    fields(item,['name','bytes','sha256','mime']);need(FILES.includes(item.name)&&!names.has(item.name),code('FILE_INDEX_INVALID'));
    names.add(item.name);integer(item.bytes,0,MAX_FILE);check(item.sha256,HASH,'FILE_DIGEST_REQUIRED');text(item.mime,160);
  }
  need(value.files.find(v=>v.name==='events.json').sha256===value.events_sha256&&
    value.files.find(v=>v.name==='manifest.json').sha256===value.manifest_sha256,code('INDEX_SOURCE_CHANGED'));
  const {index_sha256:ignored,...selected}=value;
  need(sha(Buffer.from(canonical(selected),'utf8'))===value.index_sha256&&size(value)<=MAX_INDEX,code('INDEX_DIGEST_CHANGED'));
  return value;
}

/** The parent owns request cancellation and drains all HTTP/file publication work. */
export function createNativeLineageActions({reads,parse}={}){
  need(typeof reads==='function'&&typeof parse==='function',code('ORIGINAL_FILE_HELPERS_REQUIRED'));
  async function cache(record,planId,indexSha){
    check(record?.workspaceId,ID,'WORKSPACE_ID_REQUIRED');
    need(typeof record.nativeWorkspace==='string'&&resolve(record.nativeWorkspace)===record.nativeWorkspace,
      code('ORIGINAL_WORKSPACE_REQUIRED'));
    let path=record.nativeWorkspace;await directory(path);
    for(const part of ['analysis','lineage-files',record.workspaceId,planId,indexSha]){
      path=join(path,part);await directory(path,{create:true});
    }
    return path;
  }
  async function retainIndex(value,record,expected){
    const index=checkedIndex(value,record,expected);
    const path=await cache(record,index.plan_id,index.index_sha256);
    await retainRecord(join(path,'index.json'),index,{resume:true});
    return {index,path};
  }
  function originalJob(value,identifier,request){
    need(object(value)&&value.id===identifier&&value.kind==='lineage-publish'&&object(value.request),code('ORIGINAL_PUBLICATION_REQUIRED'));
    check(value.request.plan_id,ID,'PLAN_ID_REQUIRED');check(value.request.plan_sha256,HASH,'PLAN_DIGEST_REQUIRED');
    if(request)need(value.request.id===request.id&&value.request.plan_id===request.plan_id&&
      value.request.plan_sha256===request.plan_sha256,code('PUBLICATION_REQUEST_CHANGED'));
    return value;
  }
  async function file({body,record,get,getBytes,signal}){
    fields(body,['plan_id','plan_sha256','index_sha256','filename','sha256'],['byteOffset','maxBytes']);
    check(body.plan_id,ID,'PLAN_ID_REQUIRED');
    for(const key of ['plan_sha256','index_sha256','sha256'])check(body[key],HASH,'FILE_DIGEST_REQUIRED');
    need(FILES.includes(body.filename),code('FILENAME_INVALID'));
    if(body.byteOffset!==undefined)integer(body.byteOffset);
    if(body.maxBytes!==undefined)integer(body.maxBytes,1,65536);
    stopped(signal);
    const path=await cache(record,body.plan_id,body.index_sha256);
    const saved=await optionalBytes(join(path,'index.json'),MAX_INDEX);
    let index,fresh=false;
    if(saved!==null)index=checkedIndex(parse(saved),record,body);
    else{
      index=checkedIndex(await get('/api/lineage/plans/'+body.plan_id+'/downloads',{maximum:MAX_INDEX}),record,body);
      stopped(signal);await retainRecord(join(path,'index.json'),index,{resume:true});fresh=true;
    }
    const selected=index.files.find(v=>v.name===body.filename);
    need(selected.sha256===body.sha256,code('FILE_SELECTION_CHANGED'));
    const source={destination:join(path,selected.name),bytes:selected.bytes,sha256:selected.sha256,contentType:selected.mime};
    const result=value=>({planId:index.plan_id,workspaceId:index.workspace_id,planSha256:index.plan_sha256,
      indexSha256:index.index_sha256,filename:selected.name,file:value});
    try{return result(await reads(source,body));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    stopped(signal);
    if(!fresh)checkedIndex(await get('/api/lineage/plans/'+body.plan_id+'/downloads',{maximum:MAX_INDEX}),record,body);
    const raw=await getBytes('/api/lineage/plans/'+body.plan_id+'/file'+query({name:selected.name,sha256:selected.sha256}),selected.bytes);
    need(Buffer.isBuffer(raw)&&raw.length===selected.bytes&&sha(raw)===selected.sha256,code('FILE_BYTES_CHANGED'));
    stopped(signal);
    await retainFile(source.destination,raw,{resume:true});
    // The original reader reopens a private stable descriptor, verifies the complete
    // hash once per exact file stamp, and emits its unchanged bounded base64 range.
    return result(await reads(source,body));
  }
  return {
    handles:operation=>operations.has(operation),
    async call({operation,body,record,get,post,getBytes,signal}){
      need(operations.has(operation)&&object(body)&&object(record)&&
        typeof get==='function'&&typeof post==='function'&&typeof getBytes==='function',code('ORIGINAL_TRANSPORT_REQUIRED'));
      check(record.workspaceId,ID,'WORKSPACE_ID_REQUIRED');
      if(operation==='lineage-file')return file({body,record,get,post,getBytes,signal});
      if(operation==='lineage-configuration'){
        fields(body,[]);
        const value=await get('/api/lineage/configuration');
        need(object(value)&&value.schema===SCHEMA&&value.workspace_id===record.workspaceId&&
          typeof value.can_publish==='boolean'&&Array.isArray(value.connections)&&value.connections.length<=64&&
          Array.isArray(value.supported_jobs),code('CONFIGURATION_INVALID'));
        for(const item of value.connections){
          check(item?.name,NAME,'CONNECTION_ALIAS_REQUIRED');check(item?.workspace_id,UUID,'COLLECTOR_ID_REQUIRED');
          text(item.label,160);integer(item.request_timeout_ms,1000,300000);
          need(typeof item.token_configured==='boolean'&&typeof item.available==='boolean',code('CONFIGURATION_INVALID'));
          if(item.endpoint!==undefined)origin(item.endpoint);
        }
        return value;
      }
      if(operation==='lineage-jobs'||operation==='lineage-plans'){
        fields(body,[],['before','limit']);if(body.before!==undefined)integer(body.before,1);
        if(body.limit!==undefined)integer(body.limit,1,100);
        const value=await get('/api/lineage/'+(operation==='lineage-jobs'?'jobs':'plans')+query(body),{maximum:MAX_JSON});
        return history(value,body,item=>operation==='lineage-plans'?{
          ...planMetadata(item,record,{listing:true}),projection:{kind:'plan-summary',request_complete:false}
        }:(check(item?.id,ID,'JOB_ID_REQUIRED'),copy(item)));
      }
      if(operation==='lineage-review'){
        fields(body,['job_id'],['include_sql','collection','offset','limit']);check(body.job_id,ID,'JOB_ID_REQUIRED');pageOptions(body);
        if(body.include_sql!==undefined)need(typeof body.include_sql==='boolean',code('SQL_SELECTION_INVALID'));
        const request=pick(body,['job_id','include_sql']);
        return projected(await post('/api/lineage/review',request,{maximum:MAX_JSON}),body,record);
      }
      if(operation==='lineage-save-plan'){
        fields(body,['id','job_id','expected_snapshot_sha256','connection','expected_workspace_id','title','note'],['include_sql']);
        check(body.id,ID,'PLAN_ID_REQUIRED');check(body.job_id,ID,'JOB_ID_REQUIRED');
        check(body.expected_snapshot_sha256,HASH,'SNAPSHOT_DIGEST_REQUIRED');check(body.connection,NAME,'CONNECTION_ALIAS_REQUIRED');
        check(body.expected_workspace_id,UUID,'COLLECTOR_ID_REQUIRED');text(body.title,160);text(body.note,4000,{empty:true,multiline:true});
        if(body.include_sql!==undefined)need(typeof body.include_sql==='boolean',code('SQL_SELECTION_INVALID'));
        const value=await post('/api/lineage/plans',copy(body),{maximum:MAX_JSON});
        need(value?.id===body.id&&value?.request?.job_id===body.job_id&&
          value.snapshot_sha256===body.expected_snapshot_sha256&&value.target?.workspace_id===body.expected_workspace_id,
          code('PLAN_BINDING_CHANGED'));
        return projected(value,{},record,{plan:true});
      }
      if(operation==='lineage-plan'){
        fields(body,['plan_id'],['collection','offset','limit']);check(body.plan_id,ID,'PLAN_ID_REQUIRED');pageOptions(body);
        const value=await get('/api/lineage/plans/'+body.plan_id,{maximum:MAX_JSON});
        need(value?.id===body.plan_id,code('PLAN_BINDING_CHANGED'));
        return projected(value,body,record,{plan:true});
      }
      if(operation==='lineage-downloads'){
        fields(body,['plan_id']);check(body.plan_id,ID,'PLAN_ID_REQUIRED');stopped(signal);
        const value=await get('/api/lineage/plans/'+body.plan_id+'/downloads',{maximum:MAX_INDEX});
        stopped(signal);return (await retainIndex(value,record,body)).index;
      }
      if(operation==='lineage-publish'){
        fields(body,['id','plan_id','plan_sha256']);check(body.id,ID,'PUBLICATION_ID_REQUIRED');
        check(body.plan_id,ID,'PLAN_ID_REQUIRED');check(body.plan_sha256,HASH,'PLAN_DIGEST_REQUIRED');
        const plan=await get('/api/lineage/plans/'+body.plan_id,{maximum:MAX_JSON});
        planMetadata(plan,record);
        need(plan.id===body.plan_id&&plan.plan_sha256===body.plan_sha256,code('PLAN_BINDING_CHANGED'));
        if(plan.publication!==null&&plan.publication!==undefined){
          need(plan.publication.job_id===body.id,code('USE_ORIGINAL_PUBLICATION_JOB'));
          const retained=originalJob(await get('/api/jobs/'+body.id,{maximum:MAX_JSON}),body.id,body);
          if(retained.status==='COMPLETE')return retained;
          // Every explicit continuation reads the original job first. The original
          // Analysis start/resume rules decide whether its same request may proceed.
        }
        return originalJob(await post('/api/start/lineage-publish',copy(body),{maximum:MAX_JSON}),body.id,body);
      }
      if(operation==='lineage-publication'){
        fields(body,['id']);check(body.id,ID,'PUBLICATION_ID_REQUIRED');
        return originalJob(await get('/api/jobs/'+body.id,{maximum:MAX_JSON}),body.id);
      }
      fields(body,['id']);check(body.id,ID,'PUBLICATION_ID_REQUIRED');
      const progress=await post('/api/lineage/publications/'+body.id+'/cancel',{},{maximum:MAX_JSON});
      need(object(progress)&&progress.job_id===body.id&&typeof progress.state==='string'&&
        typeof progress.cancel_requested==='boolean'&&Array.isArray(progress.observations),code('PUBLICATION_PROGRESS_CHANGED'));
      return progress;
    }
  };
}
